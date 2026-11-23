/* Market Mint Scan - shared header (search + Tools menu) and helpers.
   Each page sets <body data-root="../"> (path back to the site root). */
(function () {
  const ROOT = document.body.dataset.root || "./";
  const ON_PAGES = location.hostname.endsWith("github.io");
  // big daily files live on the repo's "data" branch (force-pushed, so they never bloat the site)
  const DATA = ON_PAGES ? "https://raw.githubusercontent.com/marketmiint/market-mint-dashboard/data/" : ROOT + "_data/";
  const TG = "https://t.me/addlist/nbJ1it_56oo0MzM1";

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
  const fmtDate = iso => !iso ? "" : new Date(iso.slice(0, 10) + "T12:00:00+05:30").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  // ---------- search list (index.json), cached for the browser session
  let idxPromise = null;
  function index() {
    if (!idxPromise) {
      idxPromise = (async () => {
        try {
          const c = JSON.parse(sessionStorage.getItem("mm-idx") || "null");
          if (c && Date.now() - c.at < 30 * 60 * 1000) return c.d;
        } catch (e) {}
        const r = await fetch(DATA + "scan/index.json", { cache: "no-cache" });
        if (!r.ok) throw new Error("index " + r.status);
        const raw = await r.json();
        const cols = raw.cols;
        raw.list = raw.rows.map(a => Object.fromEntries(cols.map((k, i) => [k, a[i]])));
        delete raw.rows;
        try { sessionStorage.setItem("mm-idx", JSON.stringify({ at: Date.now(), d: raw })); } catch (e) {}
        return raw;
      })();
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

  // attach a suggestion box to any <input>; Enter opens the top match
  function attachSearch(input) {
    const box = document.createElement("div");
    box.className = "sugg"; box.hidden = true;
    input.parentElement.appendChild(box);
    let items = [], on = 0;
    const draw = () => {
      if (!input.value.trim()) { box.hidden = true; return; }
      box.innerHTML = items.length ? items.map((r, i) => `<a href="${stockUrl(r.s)}" class="${i === on ? "on" : ""}">
          <span class="l"><b>${esc(r.n)}</b><small>${esc(r.s)} · ${esc(r.i || "")}</small></span>
          <span class="r">${r.p != null ? inr(r.p) : ""}<br><span class="${cls(r.c)}">${pct(r.c, 2)}</span></span></a>`).join("")
        : `<div class="empty">No NSE company matches “${esc(input.value)}”.</div>`;
      box.hidden = false;
    };
    input.addEventListener("input", async () => {
      const d = await index().catch(() => null);
      items = d ? match(d.list, input.value) : []; on = 0; draw();
    });
    input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { on = Math.min(on + 1, items.length - 1); draw(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { on = Math.max(on - 1, 0); draw(); e.preventDefault(); }
      else if (e.key === "Enter" && items[on]) { location.href = stockUrl(items[on].s); }
      else if (e.key === "Escape") { box.hidden = true; input.blur(); }
    });
    input.addEventListener("focus", () => { if (input.value.trim()) draw(); index().catch(() => {}); });
    document.addEventListener("click", e => { if (!box.contains(e.target) && e.target !== input) box.hidden = true; });
  }

  const I = {
    earn: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
    order: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
    cal: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    bo: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    scr: '<path d="M3 5h18M6 12h12M10 19h4"/>',
    heat: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/>',
    mkt: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    rank: '<path d="M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21.1l1.5-7L2 9.3l7-.8z"/>',
  };
  const svg = p => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const TOOLS = [
    ["dashboard/?tab=results", "Earnings", "Every quarterly result, graded, with the share price move", I.earn],
    ["dashboard/?tab=orders", "Order wins", "Live order wins with size vs revenue and market cap", I.order],
    ["dashboard/?tab=calendar", "Results calendar", "Who reports results in the coming days", I.cal],
    ["breakouts/", "Breakout Desk", "Stocks forming, breaking out and climbing out of bases", I.bo],
    ["market/", "Market health", "Breadth, safety light, indices and industry ranks", I.mkt],
    ["rank/", "Mint Score ranks", "Every NSE stock rated 0–100, sortable by industry", I.rank],
    ["screener/", "Results screener", "Filter this season's results by growth and size", I.scr],
    ["heatmap/", "Results heatmap", "This season's results at a glance, by sector", I.heat],
  ];

  function header() {
    const h = document.createElement("header");
    h.className = "mm";
    h.innerHTML = `<div class="wrap bar">
      <a class="brand" href="${ROOT}"><img src="${ROOT}logo.png" alt=""><span>MARKET MINT</span></a>
      <label class="hs">${svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>').replace('width="18" height="18"', 'width="16" height="16"')}
        <input type="search" placeholder="Scan a stock, e.g. BEL or Cochin Shipyard" autocomplete="off" aria-label="Search stocks"></label>
      <nav class="nav navwrap">
        <button class="tbtn" aria-expanded="false" aria-haspopup="true">Tools <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m6 9 6 6 6-6"/></svg></button>
        <div class="tools-menu" hidden>${TOOLS.map(t => `<a href="${ROOT}${t[0]}"><span class="ic">${svg(t[3])}</span><span><b>${t[1]}</b><small>${t[2]}</small></span></a>`).join("")}</div>
        <a class="join" href="${TG}" target="_blank" rel="noopener">Join Telegram</a>
      </nav></div>`;
    document.body.prepend(h);
    const btn = h.querySelector(".tbtn"), menu = h.querySelector(".tools-menu");
    btn.addEventListener("click", e => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); });
    document.addEventListener("click", e => { if (!menu.contains(e.target)) { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); } });
    attachSearch(h.querySelector(".hs input"));
  }

  function footer() {
    const f = document.createElement("footer");
    f.className = "mmf wrap";
    f.innerHTML = `Market Mint · Numbers from NSE filings, NSE bhavcopy and Yahoo Finance; results history from 2019.
      For learning and research only, not a buy or sell call. <a href="${TG}" target="_blank" rel="noopener">Join us on Telegram</a>`;
    document.body.appendChild(f);
  }

  // simple SVG line chart; points = numbers; marks = [{i, label, kind}]
  function lineChart(points, { w = 760, h = 240, marks = [], labels = [] } = {}) {
    const P = { l: 8, r: 54, t: 12, b: 22 };
    const ok = points.filter(v => v != null);
    if (ok.length < 2) return "";
    let lo = Math.min(...ok), hi = Math.max(...ok);
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
    const lab = labels.map(([i, t]) => `<text x="${X(i)}" y="${h - 4}" font-size="11" fill="var(--muted)" text-anchor="${i === 0 ? "start" : i >= points.length - 1 ? "end" : "middle"}">${esc(t)}</text>`).join("");
    const mk = marks.filter(m => points[m.i] != null).map(m => {
      const x = X(m.i), y = Y(points[m.i]);
      return m.kind === "result"
        ? `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" transform="rotate(45 ${x} ${y})" fill="var(--teal)" stroke="var(--card)" stroke-width="2"><title>${esc(m.label)}</title></rect>`
        : `<circle cx="${x}" cy="${y}" r="5.5" fill="var(--amber)" stroke="var(--card)" stroke-width="2"><title>${esc(m.label)}</title></circle>`;
    }).join("");
    const last = ok[ok.length - 1];
    const area = d + `L${X(points.length - 1)} ${h - P.b}L${X(points.findIndex(v => v != null))} ${h - P.b}Z`;
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Price chart">
      <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".18"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      ${grid}<path d="${area}" fill="url(#g)"/><path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${X(points.length - 1)}" cy="${Y(last)}" r="3.5" fill="${col}"/>${mk}${lab}</svg>`;
  }

  window.MM = { ROOT, DATA, TG, esc, inr, crs, pct, cls, capOf, stockUrl, fmtDate, index, attachSearch, lineChart, TOOLS, svg };
  header();
  document.addEventListener("DOMContentLoaded", footer);
})();
