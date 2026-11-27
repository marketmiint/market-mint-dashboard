/* Market Mint full chart (our own chart, no redirect to TradingView's site).
   Uses TradingView Lightweight Charts v5 (Apache-2.0, self-hosted as assets/lwc.js, loaded on first use).
   Needs mm.js first (MM.DATA, MM.live, MM.onLive).

   MMChart.open(opt)  popup  ·  MMChart.mount(element, opt)  inside a page (returns false if no history file)
   opt = {
     sym: "MILKYMIST", name: "Milky Mist Dairy Food", ex: "NSE",
     lines: [{price: 342.4, title: "Pivot", kind: "pivot" | "stop" | "entry"}],
     bases: [{n: 1, from: "2026-10-01", to: "2026-11-24", pivot: 342.4, low: 259.25, on: true}],
     marks: [{date: "2026-11-25", text: "Breakout", kind: "up" | "order" | "result"}],
     range: "6M"
   })

   Data (site "data" branch, see breakout repo screen.py chart_files):
     charts/c/SYM.json        history to the end of last month: d = daily (~2 years), w = weekly before that
     breakouts/all/r_X.json   every day since then, symbols starting with X
   Days are numbers (days since 1970-01-01); columns t o h l c v. */
(function () {
  const ROOT = new URL("../", document.currentScript.src).href;
  let libP = null;
  const lib = () => libP || (libP = new Promise((ok, no) => {
    if (window.LightweightCharts) return ok(window.LightweightCharts);
    const s = document.createElement("script"); s.src = ROOT + "assets/lwc.js";
    s.onload = () => ok(window.LightweightCharts); s.onerror = () => no(new Error("chart library did not load"));
    document.head.appendChild(s);
  }));
  const DATA = () => (window.MM && MM.DATA) || "https://raw.githubusercontent.com/marketmiint/market-mint-dashboard/data/";
  const getJ = u => fetch(u, { cache: "no-cache" }).then(r => r.ok ? r.json() : null).catch(() => null);
  const dayNum = s => Math.round(Date.parse(s + "T00:00:00Z") / 86400000);
  const dayStr = n => new Date(n * 86400000).toISOString().slice(0, 10);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const inr = (x, d) => x == null ? "–" : "₹" + Number(x).toLocaleString("en-IN", { minimumFractionDigits: d ?? (x < 100 ? 2 : 1), maximumFractionDigits: d ?? (x < 100 ? 2 : 1) });
  const vol = v => v >= 1e7 ? (v / 1e7).toFixed(2) + " Cr" : v >= 1e5 ? (v / 1e5).toFixed(2) + " L" : Math.round(v).toLocaleString("en-IN");
  const fmtD = n => new Date(n * 86400000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const css = (k, f) => (getComputedStyle(document.documentElement).getPropertyValue(k) || "").trim() || f;

  // ---------- data
  const cache = {};
  async function load(sym) {
    if (cache[sym]) return cache[sym];
    const [h, r, ev] = await Promise.all([getJ(DATA() + "charts/c/" + encodeURIComponent(sym) + ".json"),
      getJ(DATA() + "breakouts/all/r_" + encodeURIComponent(sym[0]) + ".json"), getJ(DATA() + "events/" + encodeURIComponent(sym) + ".json")]);
    const rows = o => o ? o.t.map((t, i) => ({ t, o: o.o[i], h: o.h[i], l: o.l[i], c: o.c[i], v: o.v[i] || 0 })).filter(x => x.c != null) : [];
    let d = h ? rows(h.d) : [];
    const w = h ? rows(h.w) : [];
    const rec = r && r.s && r.s[sym] ? rows(r.s[sym]) : [];
    const lastT = d.length ? d[d.length - 1].t : w.length ? w[w.length - 1].t : -1;
    d = d.concat(rec.filter(x => x.t > lastT));
    if (!d.length && !w.length || !h && d.length < 60) return null;     // too little history: pages keep their simple chart
    for (const x of d) { if (x.o == null) x.o = x.c; if (x.h == null) x.h = Math.max(x.o, x.c); if (x.l == null) x.l = Math.min(x.o, x.c); }
    return (cache[sym] = { d, w, ev });
  }
  const wkKey = t => Math.floor((t + 3) / 7);              // Monday-start weeks (day 0 = Thursday 1 Jan 1970)
  function weekly(D) {
    const out = [];
    for (const x of D.w.concat(D.d)) {
      const k = wkKey(x.t), p = out[out.length - 1];
      if (p && p.k === k) { p.h = Math.max(p.h, x.h); p.l = Math.min(p.l, x.l); p.c = x.c; p.v += x.v; p.t = x.t; }
      else out.push({ k, t: x.t, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v });
    }
    return out;
  }
  function sma(rows, n) {
    const out = []; let s = 0;
    rows.forEach((x, i) => { s += x.c; if (i >= n) s -= rows[i - n].c; if (i >= n - 1) out.push({ time: dayStr(x.t), value: +(s / n).toFixed(2) }); });
    return out;
  }
  // today's live price (mm.js live prices): extend or update the last daily candle
  function liveBar(D, sym) {
    const L = window.MM && MM.live && MM._liveNow && MM._liveNow();
    if (!L || !L.s || !L.s[sym]) return null;
    const t = dayNum(L.t.slice(0, 10)), [p] = L.s[sym], last = D.d[D.d.length - 1];
    if (!last || t < last.t) return null;
    if (t === last.t) { last.c = p; last.h = Math.max(last.h, p); last.l = Math.min(last.l, p); }
    else D.d.push({ t, o: last.c, h: Math.max(last.c, p), l: Math.min(last.c, p), c: p, v: 0, live: true });
    return L;
  }

  // ---------- views: the same chart in a popup (MMChart.open) or inside a page (MMChart.mount)
  let styled = false;
  function style() {
    if (styled) return; styled = true;
    const st = document.createElement("style");
    st.textContent = `
.mmc{position:fixed;inset:0;z-index:3000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:2vh 2vw}
.mmc[hidden]{display:none}
.mmv{background:var(--card,#fff);color:var(--ink,#111827);display:flex;flex-direction:column;overflow:hidden;font-family:Inter,system-ui,sans-serif}
.mmc .mmv{border-radius:16px;width:min(1200px,100%);height:min(820px,96vh);box-shadow:0 20px 60px rgba(0,0,0,.3)}
.mmv.inl{height:470px;border-radius:inherit}
.mmv .hd{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line,#e8eaef);flex-wrap:wrap}
.mmv .nm{font-weight:800;font-size:17px;line-height:1.2}.mmv .nm small{display:block;font-weight:500;font-size:12.5px;color:var(--muted,#6b7280)}
.mmv .px{margin-left:auto;text-align:right;font-variant-numeric:tabular-nums}.mmv .px b{font-size:19px}.mmv .px small{display:block;font-size:12px;color:var(--muted,#6b7280)}
.mmv .x{border:0;background:var(--soft,#f3f5f8);width:34px;height:34px;border-radius:10px;font-size:20px;cursor:pointer;color:var(--ink,#111827)}
.mmv .tb{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 16px;border-bottom:1px solid var(--line,#e8eaef);font-size:13px}
.mmv .seg{display:inline-flex;background:var(--soft,#f3f5f8);border-radius:9px;padding:2px}
.mmv .seg button,.mmv .tg{border:0;background:none;padding:5px 10px;border-radius:7px;font:inherit;font-weight:600;cursor:pointer;color:var(--muted,#6b7280)}
.mmv .seg button.on{background:var(--card,#fff);color:var(--ink,#111827);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.mmv .tg{border:1px solid var(--line,#e8eaef);display:inline-flex;align-items:center;gap:6px}.mmv .tg i{width:12px;height:3px;border-radius:2px;display:inline-block}
.mmv .tg.off{opacity:.45}
.mmv a.xp{text-decoration:none;font-size:13px}.mmv .hd .xp{margin-left:0}
.mmv .xp{margin-left:auto;border:1px solid var(--line,#e8eaef);background:var(--card,#fff);color:var(--ink,#111827);padding:5px 11px;border-radius:8px;font:inherit;font-weight:700;cursor:pointer}
.mmv .lg{padding:6px 16px;font-size:12.5px;color:var(--muted,#6b7280);font-variant-numeric:tabular-nums;min-height:18px}
.mmv .lg b{color:var(--ink,#111827);font-weight:600}
.mmv .cv{position:relative;flex:1;min-height:0}
.mmv .cv .ov{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3}
.mmv .cv .bb{position:absolute;border:1.5px dashed #3b8a4c;background:rgba(59,138,76,.07);border-radius:3px}
.mmv .cv .bb span{position:absolute;left:4px;bottom:-18px;font-size:11px;font-weight:700;color:#3b8a4c}
.mmv .cv .bb.old{border-color:rgba(107,114,128,.6);background:rgba(107,114,128,.05)}.mmv .cv .bb.old span{color:#6b7280}
.mmv .msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted,#6b7280);font-size:14px}
.mmv .ft{padding:6px 16px 10px;font-size:11.5px;color:var(--muted,#6b7280)}
@media (max-width:700px){.mmc{padding:0}.mmc .mmv{border-radius:0;height:100%}.mmv .hd{gap:8px;padding:10px 12px}.mmv .nm{flex:1;min-width:0}
  .mmv .px{order:3;margin-left:0;text-align:left;width:100%}.mmv .px b{font-size:17px}.mmv .px small{display:inline;margin-left:6px}
  .mmv .tb{gap:4px;padding:6px 12px}.mmv .seg button{padding:5px 7px}.mmv .tg{padding:4px 8px}.mmv .lg{padding:4px 12px}.mmc .ft{display:none}
  .mmv.inl{height:420px}.mmv.inl .tg[data-m="lv"]{display:none}}`;
    document.head.appendChild(st);
  }
  const TB = `<div class="tb"><span class="seg rr">${["1M", "3M", "6M", "1Y", "2Y", "5Y", "Max"].map(r => `<button data-r="${r}">${r}</button>`).join("")}</span>
        <span class="seg ii"><button data-i="d">Daily</button><button data-i="w">Weekly</button></span>
        <button class="tg" data-m="50"><i style="background:#2563eb"></i><span>50-day</span></button>
        <button class="tg" data-m="200"><i style="background:#d97706"></i><span>200-day</span></button>
        <button class="tg" data-m="lv"><i style="background:#3b8a4c"></i>Levels</button>XP</div>
      <div class="lg"></div>
      <div class="cv"><div class="ov"></div><div class="msg">Loading chart…</div></div>`;
  const prefs = () => { let p = {}; try { p = JSON.parse(localStorage.getItem("mmc") || "{}"); } catch (e) {} delete p.i;
    return Object.assign({ i: "d", m50: true, m200: true, lv: true }, p); };
  const views = [];                                    // every chart on the page, refreshed together by live prices
  let liveHooked = false;
  function hookLive() {
    if (liveHooked || !window.MM || !MM.onLive) return; liveHooked = true;
    MM.onLive(() => views.forEach(v => { if (v.chart && v.refresh && !(v.modal && v.root.closest(".mmc").hidden)) v.refresh(); }));
  }

  let modal = null;
  function modalView() {
    if (modal) return modal;
    style();
    const el = document.createElement("div");
    el.className = "mmc"; el.hidden = true;
    el.innerHTML = `<div class="mmv" role="dialog" aria-modal="true" aria-label="Price chart">
      <div class="hd"><div class="nm"></div><div class="px"></div>
        <a class="xp ck" href="#" title="Open in the Charts page: drawing tools, indicators, all events">Open in Charts ↗</a><button class="x fs" title="Full screen" aria-label="Full screen" style="font-size:16px">⤢</button><button class="x cl" aria-label="Close">×</button></div>
      ${TB.replace("XP", "")}
      <div class="ft">Daily candles for about 2 years, weekly before that. Today's candle follows the live price (a few minutes behind). For learning and research, not advice.</div></div>`;
    document.body.appendChild(el);
    const v = { root: el.querySelector(".mmv"), modal: true, chart: null, st: prefs() };
    const close = () => { el.hidden = true; document.body.style.overflow = ""; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); if (v.chart) { v.chart.remove(); v.chart = null; } };
    el.addEventListener("click", e => { if (e.target === el) close(); });
    el.querySelector(".cl").onclick = close;
    el.querySelector(".fs").onclick = () => { document.fullscreenElement ? document.exitFullscreen() : v.root.requestFullscreen && v.root.requestFullscreen().catch(() => {}); };
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !el.hidden) close(); });
    v.show = () => { el.hidden = false; document.body.style.overflow = "hidden"; };
    v.isOpen = () => !el.hidden;
    views.push(v);
    return (modal = v);
  }

  // start a view: load data, then draw. Returns true when there is a chart, false when the stock has no history file.
  async function start(v, opt) {
    const q = s => v.root.querySelector(s);
    v.opt = opt; v.st.r = opt.range || "6M"; v.st.i = "d";          // always open on daily candles
    if (q(".nm")) q(".nm").innerHTML = `${esc(opt.name || opt.sym)}<small>${esc(opt.sym)}${opt.ex && opt.ex !== "NSE" ? " · " + esc(opt.ex) : " · NSE"}</small>`;
    if (q(".px")) q(".px").innerHTML = "";
    q(".lg").innerHTML = ""; q(".ov").innerHTML = "";
    if (q(".ck")) q(".ck").href = ROOT + "charts/?" + encodeURIComponent(opt.sym);
    q(".msg").hidden = false; q(".msg").textContent = "Loading chart…";
    if (v.chart) { v.chart.remove(); v.chart = null; }
    let LW, D;
    try { [LW, D] = await Promise.all([lib(), load(opt.sym), window.MM && MM.live ? MM.live() : null]); }
    catch (e) { q(".msg").textContent = "Could not load the chart."; return false; }
    if (v.opt !== opt || (v.modal && !v.isOpen())) return false;
    if (!D) { q(".msg").textContent = "No price history for this stock yet."; return false; }
    q(".msg").hidden = true;
    draw(LW, D, Object.assign({}, opt, { marks: withEvents(opt.marks || [], D.ev) }), v);
    hookLive();
    return true;
  }

  // every order win, result, split and bonus since 2005 (site/events.py), added to the page's own marks
  function withEvents(marks, ev) {
    if (!ev) return marks;
    const have = new Set(marks.map(m => m.kind + String(m.date).slice(0, 10)));
    const out = marks.slice(), add = (date, kind, text) => { if (!have.has(kind + date)) { have.add(kind + date); out.push({ date, kind, text }); } };
    const crs = v => v >= 1000 ? "₹" + Math.round(v).toLocaleString("en-IN") + " Cr" : "₹" + v + " Cr";
    for (const o of ev.o || []) add(o.d, "order", "Order" + (o.v ? " " + crs(o.v) : ""));
    for (const r of ev.r || []) add(r.d, "result", "Result" + (r.s != null ? " · sales " + (r.s > 0 ? "+" : "") + Math.round(r.s) + "%" : "") + (r.n != null ? " · profit " + (r.n > 0 ? "+" : "") + Math.round(r.n) + "%" : r.loss ? " · loss" : ""));
    for (const a of ev.a || []) if (a.k === "split" || a.k === "bonus") add(a.d, "split", a.tx);
    return out;
  }

  async function open(opt) {
    const v = modalView();
    v.show();
    return start(v, opt);
  }

  // inline chart inside a page element (stock pages). opt as for open(); the ⤢ button opens the same chart in the popup.
  async function mount(el, opt) {
    style();
    el.innerHTML = `<div class="mmv inl">${TB.replace("XP", `<a class="xp" href="${ROOT}charts/?${encodeURIComponent(opt.sym)}" title="Drawing tools, indicators, every order, result, split and bonus">Open in Charts ↗</a>`)}</div>`;
    const v = { root: el.querySelector(".mmv"), modal: false, chart: null, st: prefs() };
    views.push(v);
    return start(v, opt);
  }

  function draw(LW, D, opt, v) {
    const st = v.st, q = s => v.root.querySelector(s), box = q(".cv");
    const up = css("--up", "#0f8f55"), dn = css("--down", "#d0342c"), ink = css("--ink", "#111827"), mut = css("--muted", "#6b7280"), line = css("--line", "#e8eaef"), card = css("--card", "#ffffff");
    const chart = LW.createChart(box, {
      autoSize: true,
      layout: { background: { color: card }, textColor: mut, fontFamily: "Inter, system-ui, sans-serif", fontSize: 12, attributionLogo: true },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      rightPriceScale: { borderColor: line, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: line, rightOffset: 4, minBarSpacing: 0.5 },
      crosshair: { mode: LW.CrosshairMode.Normal },
      handleScroll: v.modal ? true : { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: v.modal ? true : { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
      localization: { priceFormatter: p => Number(p).toLocaleString("en-IN", { maximumFractionDigits: p < 100 ? 2 : 1 }) }
    });
    v.chart = chart;
    const cs = chart.addSeries(LW.CandlestickSeries, { upColor: up, downColor: dn, borderUpColor: up, borderDownColor: dn, wickUpColor: up, wickDownColor: dn, priceLineColor: mut });
    const vs = chart.addSeries(LW.HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const m50 = chart.addSeries(LW.LineSeries, { color: "#2563eb", lineWidth: 1.5, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    const m200 = chart.addSeries(LW.LineSeries, { color: "#d97706", lineWidth: 1.5, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    let rows = [], plines = [], markers = null;

    const fill = () => {
      const L = liveBar(D, opt.sym);
      rows = st.i === "w" ? weekly(D) : D.d;
      cs.setData(rows.map(x => ({ time: dayStr(x.t), open: x.o, high: x.h, low: x.l, close: x.c })));
      vs.setData(rows.map(x => ({ time: dayStr(x.t), value: x.v, color: x.c >= x.o ? "rgba(15,143,85,.35)" : "rgba(208,52,44,.35)" })));
      const n1 = st.i === "w" ? 10 : 50, n2 = st.i === "w" ? 40 : 200;
      m50.setData(sma(rows, n1)); m200.setData(sma(rows, n2));
      m50.applyOptions({ visible: st.m50 }); m200.applyOptions({ visible: st.m200 });
      q('[data-m="50"] span').textContent = st.i === "w" ? "10-week" : "50-day";
      q('[data-m="200"] span').textContent = st.i === "w" ? "40-week" : "200-day";
      // levels: pivot / stop lines + breakout, order and result markers
      plines.forEach(p => cs.removePriceLine(p)); plines = [];
      if (st.lv) for (const l of opt.lines || []) {
        if (l.price == null) continue;
        plines.push(cs.createPriceLine({ price: l.price, color: l.kind === "stop" ? dn : l.kind === "entry" ? ink : "#3b8a4c", lineWidth: 1,
          lineStyle: l.kind === "stop" ? LW.LineStyle.Dotted : LW.LineStyle.Dashed, axisLabelVisible: true, title: l.title || "" }));
      }
      const mk = st.lv ? (opt.marks || []).map(m => { const t = snap(dayNum(m.date)); return t == null ? null : {
        time: dayStr(t), position: m.kind === "up" ? "belowBar" : "aboveBar", shape: m.kind === "up" ? "arrowUp" : "circle",
        color: m.kind === "up" ? up : m.kind === "order" ? "#1f6fd1" : m.kind === "split" ? "#7c3aed" : "#c98a0c", text: m.kind === "up" ? m.text || "" : "", size: m.kind === "up" ? 1 : 0.6 }; }).filter(Boolean)
        .sort((a, b) => a.time.localeCompare(b.time)) : [];
      if (markers) markers.setMarkers(mk); else markers = LW.createSeriesMarkers(cs, mk);
      head(L);
      legend(rows[rows.length - 1]);
    };
    const snap = t => { if (!rows.length || t > rows[rows.length - 1].t || t < rows[0].t - 7) return null; let lo = 0, hi = rows.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (rows[m].t < t) lo = m + 1; else hi = m; } return rows[lo].t; };
    const head = L => {
      if (!q(".px")) return;
      const last = D.d[D.d.length - 1], prev = D.d[D.d.length - 2];
      const ch = prev ? (last.c / prev.c - 1) * 100 : null;
      const lv = L && last.t === dayNum(L.t.slice(0, 10)) && MM.liveOpen && MM.liveOpen(L);
      q(".px").innerHTML = `<b>${inr(last.c)}</b> <span style="color:${ch >= 0 ? up : dn};font-weight:700">${ch == null ? "" : (ch >= 0 ? "+" : "") + ch.toFixed(2) + "%"}</span>
        <small>${lv ? `<span style="color:${up};font-weight:700">● Live</span> · ${L.t.slice(11, 16)}` : "Close of " + fmtD(last.t)}</small>`;
    };
    const legend = x => { if (!x) return;
      q(".lg").innerHTML = `${fmtD(x.t)}${st.i === "w" ? " (week)" : ""} · O <b>${inr(x.o)}</b> H <b>${inr(x.h)}</b> L <b>${inr(x.l)}</b> C <b>${inr(x.c)}</b>
        <span style="color:${x.c >= x.o ? up : dn}">${x.o ? ((x.c / x.o - 1) * 100).toFixed(2) + "%" : ""}</span> · Vol <b>${x.live ? "–" : vol(x.v)}</b>`
        + (st.lv ? (opt.marks || []).filter(m => m.kind !== "up" && snap(dayNum(m.date)) === x.t)
          .map(m => ` · <b style="color:${m.kind === "order" ? "#1f6fd1" : m.kind === "split" ? "#7c3aed" : "#c98a0c"}">${esc(m.text || m.kind)}</b>`).join("") : ""); };
    // base boxes (drawn over the chart, follow zoom and scroll)
    const boxes = () => {
      const ov = q(".ov"); if (!ov || !v.chart) return;
      if (!st.lv || !(opt.bases || []).length) { ov.innerHTML = ""; return; }
      const ts = chart.timeScale(), w = box.clientWidth - (chart.priceScale("right").width() || 0);
      ov.innerHTML = opt.bases.map(b => {
        const a = snap(dayNum(b.from)), z = snap(dayNum(b.to)); if (a == null || z == null) return "";
        let x1 = ts.timeToCoordinate(dayStr(a)), x2 = ts.timeToCoordinate(dayStr(z));
        const y1 = cs.priceToCoordinate(b.pivot), y2 = cs.priceToCoordinate(b.low);
        if (x1 == null || x2 == null || y1 == null || y2 == null) return "";
        x1 = Math.max(0, x1); x2 = Math.min(w, x2); if (x2 <= x1) return "";
        return `<div class="bb ${b.on ? "" : "old"}" style="left:${x1}px;top:${y1}px;width:${x2 - x1}px;height:${Math.max(2, y2 - y1)}px"><span>B${b.n}</span></div>`;
      }).join("");
    };
    const setRange = () => {
      const r = st.r, last = rows[rows.length - 1].t;
      if (r === "Max") { chart.timeScale().fitContent(); return; }
      const days = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366, "2Y": 731, "5Y": 1827 }[r];
      const from = Math.max(rows[0].t, last - days);
      chart.timeScale().setVisibleRange({ from: dayStr(from), to: dayStr(last) });
    };
    const btns = () => {
      v.root.querySelectorAll(".rr button").forEach(b => b.classList.toggle("on", b.dataset.r === st.r));
      v.root.querySelectorAll(".ii button").forEach(b => b.classList.toggle("on", b.dataset.i === st.i));
      q('[data-m="50"]').classList.toggle("off", !st.m50);
      q('[data-m="200"]').classList.toggle("off", !st.m200);
      q('[data-m="lv"]').classList.toggle("off", !st.lv);
      try { localStorage.setItem("mmc", JSON.stringify({ m50: st.m50, m200: st.m200, lv: st.lv })); } catch (e) {}
    };
    // long ranges need weekly candles (daily goes back ~2 years)
    if ((st.r === "5Y" || st.r === "Max") && D.w.length) st.i = "w";
    fill(); btns(); setRange();
    q(".rr").onclick = e => { const b = e.target.closest("button"); if (!b) return; st.r = b.dataset.r;
      const needW = (st.r === "5Y" || st.r === "Max") && D.w.length && st.i === "d";
      if (needW) { st.i = "w"; fill(); } btns(); setRange(); };
    q(".ii").onclick = e => { const b = e.target.closest("button"); if (!b || b.dataset.i === st.i) return; st.i = b.dataset.i; fill(); btns(); setRange(); };
    q(".tb").onclick = e => { const b = e.target.closest(".tg"); if (!b) return;
      const k = b.dataset.m; if (k === "50") st.m50 = !st.m50; else if (k === "200") st.m200 = !st.m200; else st.lv = !st.lv; fill(); btns(); boxes(); };
    chart.subscribeCrosshairMove(p => { if (!p || !p.time) { legend(rows[rows.length - 1]); return; }
      const t = dayNum(p.time), x = rows.find(r => r.t === t); if (x) legend(x); });
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => requestAnimationFrame(boxes));
    let sized = box.clientWidth > 50;
    new ResizeObserver(() => { if (!sized && box.clientWidth > 50) { sized = true; setRange(); } requestAnimationFrame(boxes); }).observe(box);
    setTimeout(() => { setRange(); boxes(); }, 120);
    setTimeout(boxes, 60);
    v.refresh = () => { if (v.chart !== chart) return; const vr = chart.timeScale().getVisibleLogicalRange(); fill(); if (vr) chart.timeScale().setVisibleLogicalRange(vr); boxes(); };
  }

  window.MMChart = { open, mount, load };
})();
