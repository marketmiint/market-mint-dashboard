/* Market Mint account sync.
   Sign in with Google (Firebase, free Spark plan) and everything you do on the charts is kept in your own account:
   watchlists, price alerts, drawings on each stock, chart settings. It then shows up in every browser and device.
   Signed out = exactly as before (this browser only).

   How it works
   - The chart already saves to localStorage. This file watches those keys (setItem/removeItem) and copies each change
     to Firestore: users/{uid}/kv/{key} = { k, v (text or null when deleted), t (when it changed), u (server time) }.
   - On load it reads only what changed since this browser last synced (query u > last seen), then listens for live changes,
     so another device's edits arrive within seconds. Newest change of a key wins.
   - The first time a browser joins an account, its local data is merged with the account (lists, alerts, drawings are
     combined, nothing is thrown away), then the page reloads once.
   - Security rule on the database: a user can only read/write users/{their own uid}/**. */
(function () {
  if (window.MMSync) return;
  const CFG = { apiKey: "AIzaSyA7M5k7z3YuUrFB4CDp2oIRP13Bf-e5zPI", authDomain: "market-mint-7676e.firebaseapp.com",
    projectId: "market-mint-7676e", appId: "1:98647799731:web:8b39843860b1db46763dc6" };
  const G = "https://www.gstatic.com/firebasejs/10.14.1/";
  const SYNC = k => typeof k === "string" && (k === "mmwl" || k === "bo_watch" || k === "mmalerts" || k === "mmk1" || k.startsWith("mmkd:"));
  const TK = "mmsync_t", UK = "mmsync_uid", PK = "mmsync_p";   // key -> change time · last account this browser synced with · last server time seen
  const ls = window.localStorage, SP = Storage.prototype, rawSet = SP.setItem, rawDel = SP.removeItem;
  const jget = (k, d) => { try { return JSON.parse(ls.getItem(k) || "null") ?? d; } catch (e) { return d; } };
  let T = jget(TK, {}); if (typeof T !== "object" || Array.isArray(T)) T = {};
  const saveT = () => { try { rawSet.call(ls, TK, JSON.stringify(T)); } catch (e) {} };
  let user = null, col = null, applying = false, pend = {}, timer = null, ready = false, unsub = null, fb = null;
  const subs = [];
  const emit = () => subs.forEach(f => { try { f(user); } catch (e) {} });

  // ---- 1. notice every change the page makes to a synced key
  SP.setItem = function (k, v) {
    if (this !== ls || applying || !SYNC(k)) return rawSet.call(this, k, v);
    const old = ls.getItem(k); rawSet.call(this, k, v); if (old !== String(v)) touch(k);
  };
  SP.removeItem = function (k) {
    if (this !== ls || applying || !SYNC(k)) return rawDel.call(this, k);
    const had = ls.getItem(k) != null; rawDel.call(this, k); if (had) touch(k);
  };
  function touch(k) { T[k] = Date.now(); saveT(); if (user && ready) { pend[k] = 1; clearTimeout(timer); timer = setTimeout(flush, 1200); } }
  // a change made here, written straight to this browser (no echo back to the account)
  function put(k, v) {
    applying = true; try { v == null ? rawDel.call(ls, k) : rawSet.call(ls, k, v); } catch (e) {} applying = false;
    try { window.dispatchEvent(new StorageEvent("storage", { key: k, newValue: v ?? null })); } catch (e) {}
  }
  const docId = k => encodeURIComponent(k).replace(/\./g, "%2E");

  // ---- 2. send pending changes to the account
  async function flush() {
    if (!user || !col) return; const keys = Object.keys(pend); if (!keys.length) return; pend = {};
    const FV = fb.firestore.FieldValue;
    for (let i = 0; i < keys.length; i += 400) {
      const b = fb.firestore().batch();
      for (const k of keys.slice(i, i + 400)) b.set(col.doc(docId(k)), { k, v: ls.getItem(k), t: T[k] || Date.now(), u: FV.serverTimestamp() });
      try { await b.commit(); } catch (e) { keys.slice(i, i + 400).forEach(k => pend[k] = 1); setStatus("Could not save to your account (will retry)"); clearTimeout(timer); timer = setTimeout(flush, 15000); return; }
    }
    setStatus("");
  }
  addEventListener("pagehide", () => { if (Object.keys(pend).length) flush(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && Object.keys(pend).length) flush(); });

  // ---- 3. first time in this browser for this account: combine, never drop anything
  const uniq = a => [...new Set(a)];
  function merge(k, a, b) {   // a = this browser, b = account
    let A, B; try { A = JSON.parse(a); B = JSON.parse(b); } catch (e) { return b; }
    if (k === "bo_watch" && Array.isArray(A) && Array.isArray(B)) return JSON.stringify(uniq(B.concat(A)));
    if (k === "mmwl" && A && B && Array.isArray(A.lists) && Array.isArray(B.lists)) {
      const out = B.lists.map(l => Object.assign({}, l));
      for (const l of A.lists) { const m = out.find(x => x.id === l.id); if (!m) out.push(l); else if (Array.isArray(l.syms)) m.syms = uniq((m.syms || []).concat(l.syms)); }
      return JSON.stringify(Object.assign({}, A, B, { lists: out }));
    }
    if (k === "mmalerts" && A && B && Array.isArray(A.list) && Array.isArray(B.list)) {
      const key = x => x.id || [x.s, x.op, x.v].join("|"), seen = new Set(B.list.map(key));
      return JSON.stringify(Object.assign({}, A, B, { list: B.list.concat(A.list.filter(x => !seen.has(key(x)))) }));
    }
    if (k.startsWith("mmkd:") && Array.isArray(A) && Array.isArray(B)) { const s = new Set(B.map(x => JSON.stringify(x))); return JSON.stringify(B.concat(A.filter(x => !s.has(JSON.stringify(x))))); }
    return b;   // chart settings: the account's win
  }

  // ---- 4. receive changes (only those newer than what this browser has seen)
  function listen(first) {
    if (unsub) unsub();
    const P = first ? 0 : (+ls.getItem(PK) || 0);
    let q = col; if (P) q = col.where("u", ">", fb.firestore.Timestamp.fromMillis(P));
    let initial = true;
    unsub = q.onSnapshot(snap => {
      let changed = 0, maxU = +ls.getItem(PK) || 0; const seen = new Set();
      snap.docChanges().forEach(ch => {
        if (ch.type === "removed" || ch.doc.metadata.hasPendingWrites) return;
        const r = ch.doc.data(); if (!r || !SYNC(r.k)) return; seen.add(r.k);
        if (r.u && r.u.toMillis) maxU = Math.max(maxU, r.u.toMillis());
        const lv = ls.getItem(r.k), lt = T[r.k] || 0, rv = r.v ?? null;
        if (first && initial && lv != null && rv != null && lv !== rv) {
          const m = merge(r.k, lv, rv); if (m !== lv) { put(r.k, m); changed++; } if (m !== rv) pend[r.k] = 1; T[r.k] = Date.now(); return;
        }
        if ((r.t || 0) > lt) { if (rv !== lv) { put(r.k, rv); changed++; } T[r.k] = r.t; }
        else if (lt > (r.t || 0) && rv !== lv) pend[r.k] = 1;
      });
      if (initial && first) for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (SYNC(k) && !seen.has(k)) { T[k] = T[k] || Date.now(); pend[k] = 1; } }
      if (initial && !first) for (const k in T) if (T[k] > maxSeenLocal) pend[k] = 1;
      saveT(); try { rawSet.call(ls, PK, String(maxU)); } catch (e) {}
      const wasInitial = initial; initial = false; ready = true;
      flush();
      if (wasInitial && first) { rawSet.call(ls, UK, user.uid); if (changed) { setStatus("Your saved charts are loaded. Refreshing…"); setTimeout(() => location.reload(), 900); return; } }
      if (wasInitial) setStatus("");
    }, err => { setStatus("Sync is paused: " + (err && err.code || "error")); });
  }
  // changes made in this browser while it was offline / signed out of sync since the last visit
  let maxSeenLocal = +ls.getItem("mmsync_l") || 0;
  addEventListener("pagehide", () => { try { rawSet.call(ls, "mmsync_l", String(Date.now())); } catch (e) {} });

  // ---- 5. Firebase (loaded after the page is ready, from Google's free CDN)
  const load = src => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  let booting = null;
  function boot() {
    if (booting) return booting;
    booting = load(G + "firebase-app-compat.js").then(() => Promise.all([load(G + "firebase-auth-compat.js"), load(G + "firebase-firestore-compat.js")])).then(() => {
      fb = window.firebase; if (!fb.apps.length) fb.initializeApp(CFG);
      fb.auth().onAuthStateChanged(u => {
        user = u || null; ready = false;
        if (unsub) { unsub(); unsub = null; }
        if (user) { col = fb.firestore().collection("users").doc(user.uid).collection("kv"); listen(ls.getItem(UK) !== user.uid); }
        else col = null;
        draw(); emit();
      });
    }).catch(() => { booting = null; setStatus("Could not reach the sign-in service"); });
    return booting;
  }
  async function signIn() {
    try { await boot(); const p = new fb.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: "select_account" }); await fb.auth().signInWithPopup(p); }
    catch (e) { if (e && e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") alert("Sign-in did not work: " + (e.message || e.code || e)); }
  }
  async function signOut() {
    if (!fb) return; await flush();
    if (!confirm("Sign out? Your charts stay saved in your account. This browser keeps its own copy too.")) return;
    try { rawSet.call(ls, UK, ""); } catch (e) {} await fb.auth().signOut();
  }

  // ---- 6. the small account button (top right of the chart)
  let btn = null, menu = null, status = "";
  function setStatus(t) { status = t; if (menu && !menu.hidden) drawMenu(); if (btn) btn.title = user ? (t || "Signed in · your charts are saved to your account") : "Sign in with Google to save your charts in every browser"; }
  const css = `.mms-b{display:inline-flex;align-items:center;gap:6px;font-weight:700}
.mms-av{width:22px;height:22px;border-radius:50%;background:#0f8f55;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;overflow:hidden}
.mms-av img{width:100%;height:100%;object-fit:cover}
.mms-m{position:fixed;z-index:4000;background:#fff;color:#111827;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 12px 32px rgba(15,23,42,.18);padding:12px 14px;width:260px;font-size:13px;line-height:1.4}
.mms-m b{display:block;font-size:14px}.mms-m small{color:#6b7280;display:block;margin:6px 0 10px}
.mms-m button{width:100%;padding:8px;border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:700;cursor:pointer}
.mms-m .st{color:#b45309;margin:-4px 0 8px}`;
  const G_ICON = `<svg width="14" height="14" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-4z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.7-.4-4z"/></svg>`;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function draw() {
    if (!btn) return;
    if (!user) { btn.innerHTML = `<span class="mms-b">${G_ICON}<span class="hide-sm">Sign in</span></span>`; }
    else { const n = (user.displayName || user.email || "?").trim();
      btn.innerHTML = `<span class="mms-av">${user.photoURL ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">` : esc(n[0].toUpperCase())}</span>`; }
    setStatus(status);
  }
  function drawMenu() {
    menu.innerHTML = user
      ? `<b>${esc(user.displayName || "Signed in")}</b><div>${esc(user.email || "")}</div><small>Your watchlists, alerts, drawings and chart settings are saved to this account and show up in every browser where you sign in.</small>${status ? `<div class="st">${esc(status)}</div>` : ""}<button data-x="out">Sign out</button>`
      : `<b>Save your charts everywhere</b><small>Sign in with Google and your watchlists, alerts, drawings and chart settings are saved to your account, so they show up in Safari, Chrome and on your phone. Free. We only see your name and email.</small><button data-x="in">${G_ICON} Sign in with Google</button>`;
  }
  function mount() {
    const rt = document.querySelector(".ctop .rt"); if (!rt || btn) return;
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    btn = document.createElement("button"); btn.className = "bt"; btn.id = "acct"; btn.setAttribute("aria-label", "Your account"); rt.insertBefore(btn, rt.firstChild);
    menu = document.createElement("div"); menu.className = "mms-m"; menu.hidden = true; document.body.appendChild(menu);
    btn.onclick = e => { e.stopPropagation();
      if (!user && !menu.hidden) { menu.hidden = true; return; }
      if (!menu.hidden) { menu.hidden = true; return; }
      drawMenu(); menu.hidden = false; const r = btn.getBoundingClientRect(); menu.style.top = (r.bottom + 6) + "px"; menu.style.left = Math.max(8, Math.min(innerWidth - 270, r.right - 260)) + "px"; };
    menu.onclick = e => { e.stopPropagation(); const b = e.target.closest("[data-x]"); if (!b) return; menu.hidden = true; if (b.dataset.x === "in") signIn(); else signOut(); };
    document.addEventListener("click", () => { if (menu) menu.hidden = true; });
    draw();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
  // load Firebase right away if this browser was signed in before, otherwise a moment after the page is up (so the sign-in popup is never blocked)
  if (ls.getItem(UK)) boot(); else setTimeout(boot, 2500);

  window.MMSync = { signIn, signOut, user: () => user, onChange: f => subs.push(f), flush };
})();
