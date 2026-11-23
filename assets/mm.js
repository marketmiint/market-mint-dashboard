/* Market Mint - shared header with section tabs (every page), phone bottom bar, stock search, logo tiles, helpers.
   Include with <script src=".../assets/mm.js"></script> at the top of <body>. It loads nav.css itself. */
(function () {
  const ME = document.currentScript;
  const ROOT = new URL("../", ME.src).href;                  // site root, absolute
  const ON_PAGES = location.hostname.endsWith("github.io");
  // big daily files live on the repo's "data" branch (force-pushed, so they never bloat the site)
  const DATA = ON_PAGES ? "https://raw.githubusercontent.com/marketmiint/market-mint-dashboard/data/" : ROOT + "_data/";
  const TG = "https://t.me/addlist/nbJ1it_56oo0MzM1";
  if (!document.querySelector('link[href$="assets/nav.css"]')) {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = ROOT + "assets/nav.css"; document.head.appendChild(l);
  }

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const inr = (v, d = 2) => v == null ? "–" : "₹" + Number(v).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
  const crs = v => {
    if (v == null) return "–";
    const a = Math.abs(v);
    if (a >= 100000) return "₹" + (v / 100000).toFixed(2) + " L Cr";
    if (a >= 1000) return "₹" + Math.round(v).toLocaleString("en-IN") + " Cr";
    return "₹" + (a >= 100 ? v.toFixed(0) : v.toFixed(1)) + " Cr";
  };
  const pct = (v, d = 1, sign = true) => v == null ? "–" : (sign && v > 0 ? "+" : "") + Number(v).toFixed(d) + "%";
  const cls = v => v == null ? "" : v > 0 ? "up" : v < 0 ? "down" : "";
  const capOf = m => !m ? "" : m >= 100000 ? "Large" : m >= 30000 ? "Mid" : m >= 5000 ? "Small" : "Micro";
  const stockUrl = s => ROOT + "s/?" + encodeURIComponent(s);
  const fmtDate = iso => !iso ? "" : new Date(String(iso).slice(0, 10) + "T12:00:00+05:30").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const fmtShort = iso => !iso ? "" : new Date(String(iso).slice(0, 10) + "T12:00:00+05:30").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const STAGE = { fresh: "Fresh breakout", climbing: "Climbing", forming: "Forming", played: "Played out", below: "Below base" };
  const stagePill = st => st ? `<span class="pill st-${esc(st)}">${STAGE[st] || esc(st)}</span>` : "";

  // logo tile: company icon if we have one, else a coloured letter tile
  function logo(s, name, has, size = "") {
    const h = [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
    const letters = esc(String(name || s).replace(/^the\s+/i, "").split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase());
    const tile = `background:hsl(${h} 70% 95%);color:hsl(${h} 45% 35%);border-color:hsl(${h} 40% 88%)`;
    if (has) return `<span class="mmlogo ${size}"><img src="${DATA}scan/logos/${encodeURIComponent(s)}.png" alt="" loading="lazy" onerror="this.parentNode.setAttribute('style','${tile}');this.replaceWith('${letters}')"></span>`;
    return `<span class="mmlogo ${size}" style="${tile}">${letters}</span>`;
  }
  // company cell: logo + name + small line
  const co = (s, n, has, sub, link = true) => `<${link ? `a href="${stockUrl(s)}"` : "span"} class="co">${logo(s, n, has)}<span class="t"><b>${esc(n)}</b>${sub != null ? `<small>${sub}</small>` : ""}</span></${link ? "a" : "span"}>`;

  async function getJSON(name) {
    const r = await fetch(DATA + "scan/" + name, { cache: "no-cache" });
    if (!r.ok) throw new Error(name + " " + r.status);
    return r.json();
  }

  // ---------- search list (index.json), cached for the browser session
  let idxPromise = null;
  function index() {
    if (!idxPromise) {
      idxPromise = (async () => {
        try {
          const c = JSON.parse(sessionStorage.getItem("mm-idx2") || "null");
          if (c && Date.now() - c.at < 30 * 60 * 1000) return c.d;
        } catch (e) {}
        const raw = await getJSON("index.json");
        const cols = raw.cols;
        raw.list = raw.rows.map(a => Object.fromEntries(cols.map((k, i) => [k, a[i]])));
        raw.by = {};
        delete raw.rows;
        try { sessionStorage.setItem("mm-idx2", JSON.stringify({ at: Date.now(), d: raw })); } catch (e) {}
        return raw;
      })().then(d => { d.by = Object.fromEntries(d.list.map(r => [r.s, r])); return d; });
    }
    return idxPromise;
  }

  function match(list, q) {
    q = q.trim().toUpperCase();
    if (!q) return [];
    const words = q.split(/\s+/);
    const out = [];
    for (const r of list) {
      const s = r.s, n = r.n.toUpperCase();
      let score = -1;
      if (s === q) score = 1000;
      else if (s.startsWith(q)) score = 600 - s.length;
      else if (n.startsWith(q)) score = 500;
      else if (words.every(w => n.includes(w) || s.includes(w))) score = 200;
      if (score >= 0) out.push([score + Math.log10((r.m || 1) + 1) * 10, r]);
    }
    return out.sort((a, b) => b[0] - a[0]).slice(0, 10).map(x => x[1]);
  }

  // suggestion box under any <input>; Enter opens the top match. onPick(row) overrides opening the stock page.
  function attachSearch(input, onPick) {
    const box = document.createElement("div");
    box.className = "sugg"; box.hidden = true;
    input.parentElement.style.position = input.parentElement.style.position || "relative";
    input.parentElement.appendChild(box);
    let items = [], on = 0;
    const draw = () => {
      if (!input.value.trim()) { box.hidden = true; return; }
      box.innerHTML = items.length ? items.map((r, i) => `<a href="${stockUrl(r.s)}" data-i="${i}" class="${i === on ? "on" : ""}">${logo(r.s, r.n, r.lg, "sm")}
          <span class="l"><b>${esc(r.n)}</b><small>${esc(r.s)} · ${esc(r.i || "")}</small></span>
          <span class="r">${r.p != null ? inr(r.p) : ""}<br><span class="${cls(r.c)}">${pct(r.c, 2)}</span></span></a>`).join("")
        : `<div class="empty">No NSE company matches “${esc(input.value)}”.</div>`;
      box.hidden = false;
    };
    const pick = r => { if (onPick) { onPick(r); input.value = ""; box.hidden = true; } else location.href = stockUrl(r.s); };
    box.addEventListener("click", e => { const a = e.target.closest("a[data-i]"); if (a && onPick) { e.preventDefault(); pick(items[+a.dataset.i]); } });
    input.addEventListener("input", async () => {
      const d = await index().catch(() => null);
      items = d ? match(d.list, input.value) : []; on = 0; draw();
    });
    input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { on = Math.min(on + 1, items.length - 1); draw(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { on = Math.max(on - 1, 0); draw(); e.preventDefault(); }
      else if (e.key === "Enter" && items[on]) { e.preventDefault(); pick(items[on]); }
      else if (e.key === "Escape") { box.hidden = true; input.blur(); }
    });
    input.addEventListener("focus", () => { if (input.value.trim()) draw(); index().catch(() => {}); });
    document.addEventListener("click", e => { if (!box.contains(e.target) && e.target !== input) box.hidden = true; });
  }

  const I = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    earn: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
    order: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    bo: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    mkt: '<path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 5-6"/>',
    rank: '<path d="M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21.1l1.5-7L2 9.3l7-.8z"/>',
    scr: '<path d="M3 5h18M6 12h12M10 19h4"/>',
    heat: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    srch: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  };
  const svg = (p, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  // [path, label, short label, icon, description]
  const TABS = [
    ["", "Home", "Home", I.home, "Search any stock, today's market"],
    ["earnings/", "Earnings", "Earnings", I.earn, "Every quarterly result, graded"],
    ["orders/", "Order wins", "Orders", I.order, "Live order wins and their size"],
    ["breakouts/", "Breakouts", "Breakouts", I.bo, "Stocks forming and breaking out"],
    ["market/", "Market & Indices", "Market", I.mkt, "Market health, indices, your own index"],
    ["rank/", "Mint Score", "Mint", I.rank, "Every stock rated 0–100"],
    ["screener/", "Results screener", "Screener", I.scr, "Filter this season's results"],
    ["heatmap/", "Results heatmap", "Heatmap", I.heat, "This season at a glance"],
  ];
  const here = (() => {
    const p = location.href.replace(/[?#].*$/, "");
    if (!p.startsWith(ROOT)) return "";
    const rest = p.slice(ROOT.length);
    if (rest.startsWith("s/") || rest.startsWith("stock/")) return "s/";
    if (rest.startsWith("dashboard/")) return "orders/";
    return (TABS.find(t => t[0] && rest.startsWith(t[0])) || [""])[0];
  })();

  function header() {
    const h = document.createElement("header");
    h.className = "mmh";
    h.innerHTML = `<div class="in"><div class="row1">
        <a class="brand" href="${ROOT}"><img src="${ROOT}logo.png" alt=""><span>MARKET MINT</span></a>
        <label class="hs">${svg(I.srch, 16)}<input type="search" placeholder="Search any NSE stock" autocomplete="off" aria-label="Search stocks"></label>
        <a class="join" href="${TG}" target="_blank" rel="noopener">Join Telegram</a></div>
      <nav class="tabs" aria-label="Sections">${TABS.map(t => `<a href="${ROOT}${t[0]}" class="${t[0] === here ? "on" : ""}">${svg(t[3])}${t[1]}</a>`).join("")}</nav></div>`;
    document.body.prepend(h);
    attachSearch(h.querySelector(".hs input"));
    // phone bottom bar: 4 main sections + More
    const main = TABS.slice(0, 4), rest = TABS.slice(4);
    const b = document.createElement("nav");
    b.className = "mmb"; b.setAttribute("aria-label", "Sections");
    b.innerHTML = main.map(t => `<a href="${ROOT}${t[0]}" class="${t[0] === here ? "on" : ""}">${svg(t[3])}${t[2]}</a>`).join("")
      + `<button class="${rest.some(t => t[0] === here) ? "on" : ""}">${svg(I.more)}More</button>`;
    const sh = document.createElement("div");
    sh.className = "mmsheet"; sh.hidden = true;
    sh.innerHTML = `<div class="box"><b>More sections</b>${rest.map(t => `<a href="${ROOT}${t[0]}"><span>${svg(t[3])}</span><div>${t[1]}<small>${t[4]}</small></div></a>`).join("")}</div>`;
    b.querySelector("button").onclick = () => { sh.hidden = false; };
    sh.onclick = e => { if (e.target === sh) sh.hidden = true; };
    document.body.append(b, sh);
  }

  function footer() {
    if (!document.body.dataset.root) return;
    const f = document.createElement("footer");
    f.className = "mmf wrap";
    f.innerHTML = `Market Mint · Numbers from NSE filings, NSE bhavcopy, niftyindices.com and Yahoo Finance; results history from 2019. Logos are the companies' own website icons.
      For learning and research only, not a buy or sell call. <a href="${TG}" target="_blank" rel="noopener">Join us on Telegram</a>`;
    document.body.appendChild(f);
  }

  // simple SVG line chart; points = numbers; marks = [{i, label, kind}]; base = draw a dotted line at this value
  function lineChart(points, { w = 760, h = 240, marks = [], labels = [], base = null, id = "g" } = {}) {
    const P = { l: 8, r: 54, t: 12, b: 22 };
    const ok = points.filter(v => v != null);
    if (ok.length < 2) return "";
    let lo = Math.min(...ok, base ?? Infinity), hi = Math.max(...ok, base ?? -Infinity);
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const X = i => P.l + i * (w - P.l - P.r) / (points.length - 1);
    const Y = v => P.t + (hi - v) * (h - P.t - P.b) / (hi - lo);
    const up = ok[ok.length - 1] >= ok[0];
    const col = up ? "var(--up)" : "var(--down)";
    let d = "";
    points.forEach((v, i) => { if (v != null) d += (d ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); });
    const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const v = hi - f * (hi - lo), y = Y(v);
      return `<line x1="${P.l}" x2="${w - P.r}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-dasharray="3 4"/><text x="${w - P.r + 6}" y="${y + 4}" font-size="11" fill="var(--muted)">${v >= 1000 ? Math.round(v).toLocaleString("en-IN") : v.toFixed(v >= 100 ? 0 : 1)}</text>`;
    }).join("");
    const bl = base != null ? `<line x1="${P.l}" x2="${w - P.r}" y1="${Y(base)}" y2="${Y(base)}" stroke="var(--amber)" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${P.l + 4}" y="${Y(base) - 5}" font-size="11" font-weight="700" fill="var(--amber)">pivot ${base.toFixed(1)}</text>` : "";
    const lab = labels.map(([i, t]) => `<text x="${X(i)}" y="${h - 4}" font-size="11" fill="var(--muted)" text-anchor="${i === 0 ? "start" : i >= points.length - 1 ? "end" : "middle"}">${esc(t)}</text>`).join("");
    const mk = marks.filter(m => points[m.i] != null).map(m => {
      const x = X(m.i), y = Y(points[m.i]);
      return m.kind === "result"
        ? `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" transform="rotate(45 ${x} ${y})" fill="var(--teal)" stroke="var(--card)" stroke-width="2"><title>${esc(m.label)}</title></rect>`
        : `<circle cx="${x}" cy="${y}" r="5.5" fill="var(--amber)" stroke="var(--card)" stroke-width="2"><title>${esc(m.label)}</title></circle>`;
    }).join("");
    const last = ok[ok.length - 1];
    const area = d + `L${X(points.length - 1)} ${h - P.b}L${X(points.findIndex(v => v != null))} ${h - P.b}Z`;
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Chart">
      <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".16"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      ${grid}<path d="${area}" fill="url(#${id})"/>${bl}<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${X(points.length - 1)}" cy="${Y(last)}" r="3.5" fill="${col}"/>${mk}${lab}</svg>`;
  }
  const spark = (a, w = 96, h = 30) => {
    if (!a || a.length < 2) return "";
    const lo = Math.min(...a), hi = Math.max(...a);
    const p = a.map((v, i) => (i ? "L" : "M") + (i * w / (a.length - 1)).toFixed(1) + " " + (h - 2 - (v - lo) / ((hi - lo) || 1) * (h - 4)).toFixed(1)).join("");
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block"><path d="${p}" fill="none" stroke="${a[a.length - 1] >= a[0] ? "var(--up)" : "var(--down)"}" stroke-width="1.6"/></svg>`;
  };

  // breakout stage of a price line (same rule as the server's scan_more.stage)
  function stageOf(sr) {
    sr = sr.filter(v => v != null);
    if (sr.length < 80) return null;
    const last = sr[sr.length - 1], sma50 = sr.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const pivot = Math.max(...sr.slice(-130, -10));
    const vs = last / pivot - 1;
    let st;
    if (last >= pivot) st = Math.min(...sr.slice(-11, -1)) < pivot ? "fresh" : last >= sma50 ? "climbing" : "played";
    else st = vs >= -0.15 && last >= sma50 * 0.97 ? "forming" : "below";
    return { stage: st, pivot, vs_pivot: vs };
  }

  window.MM = { ROOT, DATA, TG, esc, inr, crs, pct, cls, capOf, stockUrl, fmtDate, fmtShort, index, getJSON, attachSearch, lineChart, spark,
                TABS, svg, I, logo, co, STAGE, stagePill, stageOf };
  header();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", footer); else footer();
})();
