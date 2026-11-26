/* Market Mint full chart (our own chart, no redirect to TradingView's site).
   Uses TradingView Lightweight Charts v5 (Apache-2.0, self-hosted as assets/lwc.js, loaded on first use).
   Needs mm.js first (MM.DATA, MM.live, MM.onLive).

   MMChart.open({
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
    const [h, r] = await Promise.all([getJ(DATA() + "charts/c/" + encodeURIComponent(sym) + ".json"),
      getJ(DATA() + "breakouts/all/r_" + encodeURIComponent(sym[0]) + ".json")]);
    const rows = o => o ? o.t.map((t, i) => ({ t, o: o.o[i], h: o.h[i], l: o.l[i], c: o.c[i], v: o.v[i] || 0 })).filter(x => x.c != null) : [];
    let d = h ? rows(h.d) : [];
    const w = h ? rows(h.w) : [];
    const rec = r && r.s && r.s[sym] ? rows(r.s[sym]) : [];
    const lastT = d.length ? d[d.length - 1].t : w.length ? w[w.length - 1].t : -1;
    d = d.concat(rec.filter(x => x.t > lastT));
    if (!d.length && !w.length) return null;
    for (const x of d) { if (x.o == null) x.o = x.c; if (x.h == null) x.h = Math.max(x.o, x.c); if (x.l == null) x.l = Math.min(x.o, x.c); }
    return (cache[sym] = { d, w });
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

  // ---------- modal
  let ui = null;
  function shell() {
    if (ui) return ui;
    const st = document.createElement("style");
    st.textContent = `
.mmc{position:fixed;inset:0;z-index:3000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:2vh 2vw}
.mmc[hidden]{display:none}
.mmc .bx{background:var(--card,#fff);color:var(--ink,#111827);border-radius:16px;width:min(1200px,100%);height:min(820px,96vh);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);font-family:Inter,system-ui,sans-serif}
.mmc .hd{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line,#e8eaef);flex-wrap:wrap}
.mmc .nm{font-weight:800;font-size:17px;line-height:1.2}.mmc .nm small{display:block;font-weight:500;font-size:12.5px;color:var(--muted,#6b7280)}
.mmc .px{margin-left:auto;text-align:right;font-variant-numeric:tabular-nums}.mmc .px b{font-size:19px}.mmc .px small{display:block;font-size:12px;color:var(--muted,#6b7280)}
.mmc .x{border:0;background:var(--soft,#f3f5f8);width:34px;height:34px;border-radius:10px;font-size:20px;cursor:pointer;color:var(--ink,#111827)}
.mmc .tb{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 16px;border-bottom:1px solid var(--line,#e8eaef);font-size:13px}
.mmc .seg{display:inline-flex;background:var(--soft,#f3f5f8);border-radius:9px;padding:2px}
.mmc .seg button,.mmc .tg{border:0;background:none;padding:5px 10px;border-radius:7px;font:inherit;font-weight:600;cursor:pointer;color:var(--muted,#6b7280)}
.mmc .seg button.on{background:var(--card,#fff);color:var(--ink,#111827);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.mmc .tg{border:1px solid var(--line,#e8eaef);display:inline-flex;align-items:center;gap:6px}.mmc .tg i{width:12px;height:3px;border-radius:2px;display:inline-block}
.mmc .tg.off{opacity:.45}
.mmc .lg{padding:6px 16px;font-size:12.5px;color:var(--muted,#6b7280);font-variant-numeric:tabular-nums;min-height:18px}
.mmc .lg b{color:var(--ink,#111827);font-weight:600}
.mmc .cv{position:relative;flex:1;min-height:0}
.mmc .cv .ov{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3}
.mmc .cv .bb{position:absolute;border:1.5px dashed #3b8a4c;background:rgba(59,138,76,.07);border-radius:3px}
.mmc .cv .bb span{position:absolute;left:4px;bottom:-18px;font-size:11px;font-weight:700;color:#3b8a4c}
.mmc .cv .bb.old{border-color:rgba(107,114,128,.6);background:rgba(107,114,128,.05)}.mmc .cv .bb.old span{color:#6b7280}
.mmc .msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted,#6b7280);font-size:14px}
.mmc .ft{padding:6px 16px 10px;font-size:11.5px;color:var(--muted,#6b7280)}
@media (max-width:700px){.mmc{padding:0}.mmc .bx{border-radius:0;height:100%}.mmc .hd{gap:8px;padding:10px 12px}.mmc .nm{flex:1;min-width:0}
  .mmc .px{order:3;margin-left:0;text-align:left;width:100%}.mmc .px b{font-size:17px}.mmc .px small{display:inline;margin-left:6px}
  .mmc .tb{gap:4px;padding:6px 12px}.mmc .seg button{padding:5px 7px}.mmc .tg{padding:4px 8px}.mmc .lg{padding:4px 12px}.mmc .ft{display:none}}`;
    document.head.appendChild(st);
    const el = document.createElement("div");
    el.className = "mmc"; el.hidden = true;
    el.innerHTML = `<div class="bx" role="dialog" aria-modal="true" aria-label="Price chart">
      <div class="hd"><div class="nm" id="mmcN"></div><div class="px" id="mmcP"></div>
        <button class="x" id="mmcF" title="Full screen" aria-label="Full screen" style="font-size:16px">⤢</button><button class="x" id="mmcX" aria-label="Close">×</button></div>
      <div class="tb"><span class="seg" id="mmcR">${["1M", "3M", "6M", "1Y", "2Y", "5Y", "Max"].map(r => `<button data-r="${r}">${r}</button>`).join("")}</span>
        <span class="seg" id="mmcI"><button data-i="d">Daily</button><button data-i="w">Weekly</button></span>
        <button class="tg" data-m="50"><i style="background:#2563eb"></i><span>50-day</span></button>
        <button class="tg" data-m="200"><i style="background:#d97706"></i><span>200-day</span></button>
        <button class="tg" data-m="lv"><i style="background:#3b8a4c"></i>Levels</button></div>
      <div class="lg" id="mmcL"></div>
      <div class="cv" id="mmcC"><div class="ov" id="mmcO"></div><div class="msg" id="mmcM">Loading chart…</div></div>
      <div class="ft">Daily candles for about 2 years, weekly before that. Today's candle follows the live price (a few minutes behind). For learning and research, not advice.</div></div>`;
    document.body.appendChild(el);
    const close = () => { el.hidden = true; document.body.style.overflow = ""; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); if (ui.chart) { ui.chart.remove(); ui.chart = null; } };
    el.addEventListener("click", e => { if (e.target === el) close(); });
    el.querySelector("#mmcX").onclick = close;
    el.querySelector("#mmcF").onclick = () => { const b = el.querySelector(".bx"); document.fullscreenElement ? document.exitFullscreen() : b.requestFullscreen && b.requestFullscreen().catch(() => {}); };
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !el.hidden) close(); });
    let prefs = {}; try { prefs = JSON.parse(localStorage.getItem("mmc") || "{}"); } catch (e) {}
    delete prefs.i;
    ui = { el, close, chart: null, st: Object.assign({ i: "d", m50: true, m200: true, lv: true }, prefs) };
    return ui;
  }

  async function open(opt) {
    const u = shell(), st = u.st, $ = id => u.el.querySelector("#" + id);
    u.opt = opt; st.r = opt.range || "6M"; st.i = "d";          // always open on daily candles
    $("mmcN").innerHTML = `${esc(opt.name || opt.sym)}<small>${esc(opt.sym)}${opt.ex && opt.ex !== "NSE" ? " · " + esc(opt.ex) : " · NSE"}</small>`;
    $("mmcP").innerHTML = ""; $("mmcL").innerHTML = ""; $("mmcO").innerHTML = "";
    $("mmcM").hidden = false; $("mmcM").textContent = "Loading chart…";
    u.el.hidden = false; document.body.style.overflow = "hidden";
    if (u.chart) { u.chart.remove(); u.chart = null; }
    let LW, D;
    try { [LW, D] = await Promise.all([lib(), load(opt.sym), window.MM && MM.live ? MM.live() : null]); } catch (e) { $("mmcM").textContent = "Could not load the chart."; return; }
    if (u.opt !== opt || u.el.hidden) return;
    if (!D) { $("mmcM").textContent = "No price history for this stock yet."; return; }
    $("mmcM").hidden = true;
    draw(LW, D, opt);
  }

  function draw(LW, D, opt) {
    const u = ui, st = u.st, $ = id => u.el.querySelector("#" + id), box = $("mmcC");
    const up = css("--up", "#0f8f55"), dn = css("--down", "#d0342c"), ink = css("--ink", "#111827"), mut = css("--muted", "#6b7280"), line = css("--line", "#e8eaef"), card = css("--card", "#ffffff");
    const chart = LW.createChart(box, {
      autoSize: true,
      layout: { background: { color: card }, textColor: mut, fontFamily: "Inter, system-ui, sans-serif", fontSize: 12, attributionLogo: true },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      rightPriceScale: { borderColor: line, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: line, rightOffset: 4, minBarSpacing: 0.5 },
      crosshair: { mode: LW.CrosshairMode.Normal },
      localization: { priceFormatter: p => Number(p).toLocaleString("en-IN", { maximumFractionDigits: p < 100 ? 2 : 1 }) }
    });
    u.chart = chart;
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
      u.el.querySelector('[data-m="50"] span').textContent = st.i === "w" ? "10-week" : "50-day";
      u.el.querySelector('[data-m="200"] span').textContent = st.i === "w" ? "40-week" : "200-day";
      // levels: pivot / stop lines + breakout and other markers
      plines.forEach(p => cs.removePriceLine(p)); plines = [];
      if (st.lv) for (const l of opt.lines || []) {
        if (l.price == null) continue;
        plines.push(cs.createPriceLine({ price: l.price, color: l.kind === "stop" ? dn : l.kind === "entry" ? ink : "#3b8a4c", lineWidth: 1,
          lineStyle: l.kind === "stop" ? LW.LineStyle.Dotted : LW.LineStyle.Dashed, axisLabelVisible: true, title: l.title || "" }));
      }
      const mk = st.lv ? (opt.marks || []).map(m => { const t = snap(dayNum(m.date)); return t == null ? null : {
        time: dayStr(t), position: m.kind === "up" ? "belowBar" : "aboveBar", shape: m.kind === "up" ? "arrowUp" : "circle",
        color: m.kind === "up" ? up : m.kind === "order" ? "#1f6fd1" : "#c98a0c", text: m.text || "" }; }).filter(Boolean)
        .sort((a, b) => a.time.localeCompare(b.time)) : [];
      if (markers) markers.setMarkers(mk); else markers = LW.createSeriesMarkers(cs, mk);
      head(L);
      legend(rows[rows.length - 1]);
    };
    const snap = t => { if (!rows.length || t > rows[rows.length - 1].t) return null; let lo = 0, hi = rows.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (rows[m].t < t) lo = m + 1; else hi = m; } return rows[lo].t; };
    const head = L => {
      const last = D.d[D.d.length - 1], prev = D.d[D.d.length - 2];
      const ch = prev ? (last.c / prev.c - 1) * 100 : null;
      const lv = L && last.t === dayNum(L.t.slice(0, 10)) && MM.liveOpen && MM.liveOpen(L);
      $("mmcP").innerHTML = `<b>${inr(last.c)}</b> <span style="color:${ch >= 0 ? up : dn};font-weight:700">${ch == null ? "" : (ch >= 0 ? "+" : "") + ch.toFixed(2) + "%"}</span>
        <small>${lv ? `<span style="color:${up};font-weight:700">● Live</span> · ${L.t.slice(11, 16)}` : "Close of " + fmtD(last.t)}</small>`;
    };
    const legend = x => { if (!x) return;
      $("mmcL").innerHTML = `${fmtD(x.t)}${st.i === "w" ? " (week)" : ""} · O <b>${inr(x.o)}</b> H <b>${inr(x.h)}</b> L <b>${inr(x.l)}</b> C <b>${inr(x.c)}</b>
        <span style="color:${x.c >= x.o ? up : dn}">${x.o ? ((x.c / x.o - 1) * 100).toFixed(2) + "%" : ""}</span> · Vol <b>${x.live ? "–" : vol(x.v)}</b>`; };
    // base boxes (drawn over the chart, follow zoom and scroll)
    const boxes = () => {
      const ov = $("mmcO"); if (!ov) return;
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
      u.el.querySelectorAll("#mmcR button").forEach(b => b.classList.toggle("on", b.dataset.r === st.r));
      u.el.querySelectorAll("#mmcI button").forEach(b => b.classList.toggle("on", b.dataset.i === st.i));
      u.el.querySelector('[data-m="50"]').classList.toggle("off", !st.m50);
      u.el.querySelector('[data-m="200"]').classList.toggle("off", !st.m200);
      u.el.querySelector('[data-m="lv"]').classList.toggle("off", !st.lv);
      try { localStorage.setItem("mmc", JSON.stringify({ m50: st.m50, m200: st.m200, lv: st.lv })); } catch (e) {}
    };
    // long ranges need weekly candles (daily goes back ~2 years)
    if ((st.r === "5Y" || st.r === "Max") && D.w.length) st.i = "w";
    fill(); btns(); setRange();
    $("mmcR").onclick = e => { const b = e.target.closest("button"); if (!b) return; st.r = b.dataset.r;
      const needW = (st.r === "5Y" || st.r === "Max") && D.w.length && st.i === "d";
      if (needW) { st.i = "w"; fill(); } btns(); setRange(); };
    $("mmcI").onclick = e => { const b = e.target.closest("button"); if (!b || b.dataset.i === st.i) return; st.i = b.dataset.i; fill(); btns(); setRange(); };
    u.el.querySelector(".tb").onclick = e => { const b = e.target.closest(".tg"); if (!b) return;
      const k = b.dataset.m; if (k === "50") st.m50 = !st.m50; else if (k === "200") st.m200 = !st.m200; else st.lv = !st.lv; fill(); btns(); boxes(); };
    chart.subscribeCrosshairMove(p => { if (!p || !p.time) { legend(rows[rows.length - 1]); return; }
      const t = dayNum(p.time), x = rows.find(r => r.t === t); if (x) legend(x); });
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => requestAnimationFrame(boxes));
    new ResizeObserver(() => requestAnimationFrame(boxes)).observe(box);
    setTimeout(boxes, 60);
    if (window.MM && MM.onLive && !u.liveHooked) {
      u.liveHooked = true;
      MM.onLive(() => { if (!ui.chart || ui.el.hidden || !ui.refresh) return; ui.refresh(); });
    }
    u.refresh = () => { const vr = chart.timeScale().getVisibleLogicalRange(); fill(); if (vr) chart.timeScale().setVisibleLogicalRange(vr); boxes(); };
  }

  window.MMChart = { open, load };
})();
