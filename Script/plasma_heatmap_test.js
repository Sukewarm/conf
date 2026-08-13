/**
 * Plasma Rewards Heatmap for Loon (experimental v4)
 * GitHub contribution-inspired UI. Read-only.
 * Reads plasma_rewards_tracker_v1 and never writes to persistentStore.
 */
(() => {
  const STORE_KEY = "plasma_rewards_tracker_v1";
  const requestUrl = (typeof $request !== "undefined" && $request && $request.url)
    ? $request.url
    : "http://plasma-heatmap.test/";

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function fixed(v, digits) {
    const n = num(v);
    return n === null ? "—" : n.toFixed(digits == null ? 4 : digits);
  }

  function signed(v, digits) {
    const n = num(v);
    if (n === null) return "—";
    if (Math.abs(n) < 0.0000005) return "0.0000";
    return (n > 0 ? "+" : "") + n.toFixed(digits == null ? 4 : digits);
  }

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function snap(s) {
    if (!s || typeof s !== "object" || !s.capturedAt) return null;
    const total = num(s.total);
    if (total === null) return null;
    return {
      capturedAt: String(s.capturedAt),
      total: total,
      pending: num(s.pending) === null ? 0 : num(s.pending),
      accrued: num(s.accrued) === null ? 0 : num(s.accrued),
      paid: num(s.paid) === null ? 0 : num(s.paid),
      totalReferrals: num(s.totalReferrals) === null ? 0 : num(s.totalReferrals),
      totalCashBack: num(s.totalCashBack) === null ? 0 : num(s.totalCashBack)
    };
  }

  function readStore() {
    try {
      const raw = $persistentStore.read(STORE_KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw);
      const history = Array.isArray(stored.history)
        ? stored.history.map(snap).filter(Boolean)
            .sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt))
            .slice(-100)
        : [];
      return {
        first: snap(stored.first),
        last: snap(stored.last),
        history: history
      };
    } catch (e) {
      console.log("[Plasma Heatmap] read error: " + e);
      return null;
    }
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function dateKey(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function monthKey(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }

  function monthShort(d) {
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return names[d.getMonth()];
  }

  function addMonths(d, n) {
    return new Date(d.getFullYear(), d.getMonth() + n, 1);
  }

  function parseSelectedMonth(url) {
    const m = String(url || "").match(/[?&]month=(\d{4})-(\d{2})(?:&|$)/);
    if (m) {
      const y = Number(m[1]);
      const mon = Number(m[2]);
      if (y >= 2000 && y <= 2200 && mon >= 1 && mon <= 12) {
        return new Date(y, mon - 1, 1);
      }
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  function buildDaily(history) {
    const days = Object.create(null);
    if (!Array.isArray(history)) return days;

    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const cur = history[i];
      const when = new Date(cur.capturedAt);
      if (Number.isNaN(when.getTime())) continue;

      const key = dateKey(when);
      if (!days[key]) {
        days[key] = {
          earned: 0,
          net: 0,
          events: 0,
          referral: 0,
          cashback: 0,
          pending: 0,
          accrued: 0,
          paid: 0
        };
      }

      const d = days[key];
      const totalDelta = cur.total - prev.total;
      const refDelta = cur.totalReferrals - prev.totalReferrals;
      const cashDelta = cur.totalCashBack - prev.totalCashBack;

      d.events += 1;
      d.net += totalDelta;
      d.pending += cur.pending - prev.pending;
      d.accrued += cur.accrued - prev.accrued;
      d.paid += cur.paid - prev.paid;
      if (totalDelta > 0) d.earned += totalDelta;
      if (refDelta > 0) d.referral += refDelta;
      if (cashDelta > 0) d.cashback += cashDelta;
    }

    return days;
  }

  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const p = (sorted.length - 1) * q;
    const i = Math.floor(p);
    const r = p - i;
    return sorted[i + 1] === undefined
      ? sorted[i]
      : sorted[i] + r * (sorted[i + 1] - sorted[i]);
  }

  function makeThresholds(values) {
    const positives = values.filter(v => v > 0).sort((a, b) => a - b);
    if (!positives.length) return [0, 0, 0];
    return [
      quantile(positives, 0.25),
      quantile(positives, 0.50),
      quantile(positives, 0.75)
    ];
  }

  function levelFor(v, t) {
    if (!(v > 0)) return 0;
    if (v <= t[0]) return 1;
    if (v <= t[1]) return 2;
    if (v <= t[2]) return 3;
    return 4;
  }

  function coverage(history) {
    if (!history || !history.length) return null;
    const first = new Date(history[0].capturedAt);
    const last = new Date(history[history.length - 1].capturedAt);
    if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return null;
    return { first: first, last: last };
  }

  function monthSummary(month, daily, cov) {
    const y = month.getFullYear();
    const m = month.getMonth();
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);
    const count = end.getDate();

    let earned = 0;
    let active = 0;
    let best = null;

    for (let day = 1; day <= count; day++) {
      const key = dateKey(new Date(y, m, day));
      const info = daily[key];
      if (info && info.earned > 0) {
        earned += info.earned;
        active += 1;
        if (!best || info.earned > best.earned) {
          best = { day: day, earned: info.earned };
        }
      }
    }

    const partial = !!(cov && cov.first > start && cov.first <= end);
    const outside = !!(cov && (end < new Date(cov.first.getFullYear(), cov.first.getMonth(), cov.first.getDate()) || start > cov.last));

    return {
      start: start,
      end: end,
      earned: earned,
      active: active,
      best: best,
      partial: partial,
      outside: outside
    };
  }

  function yearGraph(year, selectedMonth, daily, cov) {
    const jan1 = new Date(year, 0, 1);
    const dec31 = new Date(year, 11, 31);
    const graphStart = new Date(jan1);
    graphStart.setDate(graphStart.getDate() - graphStart.getDay());
    const graphEnd = new Date(dec31);
    graphEnd.setDate(graphEnd.getDate() + (6 - graphEnd.getDay()));

    const allValues = [];
    for (let d = new Date(jan1); d <= dec31; d.setDate(d.getDate() + 1)) {
      const info = daily[dateKey(d)];
      if (info && info.earned > 0) allValues.push(info.earned);
    }
    const thresholds = makeThresholds(allValues);

    const totalDays = Math.round((graphEnd.getTime() - graphStart.getTime()) / 86400000) + 1;
    const weeks = Math.ceil(totalDays / 7);
    const cells = [];
    const todayKey = dateKey(new Date());
    const selectedKey = monthKey(selectedMonth);

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(graphStart);
      d.setDate(graphStart.getDate() + i);
      const inYear = d.getFullYear() === year;
      if (!inYear) {
        cells.push('<span class="cell blank" aria-hidden="true"></span>');
        continue;
      }

      const key = dateKey(d);
      const info = daily[key] || {
        earned: 0, net: 0, events: 0, referral: 0, cashback: 0,
        pending: 0, accrued: 0, paid: 0
      };

      const known = !!(cov && d >= new Date(cov.first.getFullYear(), cov.first.getMonth(), cov.first.getDate()) && d <= new Date(cov.last.getFullYear(), cov.last.getMonth(), cov.last.getDate()));
      const future = d > new Date();
      const lv = known ? levelFor(info.earned, thresholds) : 0;
      const cls = [
        "cell",
        known ? ("lv" + lv) : "unknown",
        monthKey(d) === selectedKey ? "month-focus" : "",
        key === todayKey ? "today" : "",
        future ? "future" : ""
      ].filter(Boolean).join(" ");

      cells.push(
        '<button class="' + cls + '"' +
        ' data-date="' + key + '"' +
        ' data-known="' + (known ? "1" : "0") + '"' +
        ' data-earned="' + fixed(info.earned) + '"' +
        ' data-net="' + fixed(info.net) + '"' +
        ' data-events="' + info.events + '"' +
        ' data-ref="' + fixed(info.referral) + '"' +
        ' data-cash="' + fixed(info.cashback) + '"' +
        ' data-pending="' + fixed(info.pending) + '"' +
        ' data-accrued="' + fixed(info.accrued) + '"' +
        ' data-paid="' + fixed(info.paid) + '"' +
        ' data-month="' + monthKey(d) + '"' +
        ' aria-label="' + esc(key + (known ? (" +" + fixed(info.earned) + " USDT") : " no captured history") + '"></button>'
      );
    }

    const monthLabels = [];
    for (let m = 0; m < 12; m++) {
      const first = new Date(year, m, 1);
      const diff = Math.floor((first.getTime() - graphStart.getTime()) / 86400000);
      const weekIndex = Math.floor(diff / 7);
      monthLabels.push(
        '<span style="grid-column:' + (weekIndex + 1) + ' / span 4">' + monthShort(first) + '</span>'
      );
    }

    return {
      weeks: weeks,
      cells: cells,
      monthLabels: monthLabels
    };
  }

  function monthLabel(d) {
    return monthShort(d).toUpperCase() + " " + d.getFullYear();
  }

  function formatBest(month, best) {
    if (!best) return "No activity";
    return monthShort(month) + " " + pad2(best.day) + " · +" + fixed(best.earned) + " USDT";
  }

  function page(store) {
    if (!store || !store.last || !store.history || store.history.length < 2) {
      return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#000000"><meta name="color-scheme" content="dark"><title>Plasma Heatmap</title><style>' + css() + '</style></head><body><main class="shell"><header class="top"><div><h1>Reward activity</h1><p>Local Tracker history</p></div></header><section class="empty">No captured history yet.</section></main></body></html>';
    }

    const selected = parseSelectedMonth(requestUrl);
    const daily = buildDaily(store.history);
    const cov = coverage(store.history);
    const summary = monthSummary(selected, daily, cov);
    const graph = yearGraph(selected.getFullYear(), selected, daily, cov);
    const prev = monthKey(addMonths(selected, -1));
    const next = monthKey(addMonths(selected, 1));
    const bestText = formatBest(selected, summary.best);
    const rangeText = cov ? (dateKey(cov.first) + " → " + dateKey(cov.last)) : "—";

    let note = "";
    if (summary.partial) {
      note = '<div class="note">This month is only partially covered by the 100 saved history points.</div>';
    } else if (summary.outside) {
      note = '<div class="note">This month is outside the saved history range.</div>';
    }

    return '<!doctype html>' +
      '<html lang="zh-CN"><head>' +
      '<meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
      '<meta name="theme-color" content="#000000">' +
      '<meta name="color-scheme" content="dark">' +
      '<title>Plasma Heatmap</title>' +
      '<style>' + css() + '</style></head><body>' +
      '<main class="shell">' +

      '<header class="top">' +
      '<div><h1>Reward activity</h1><p>Local Tracker history · read only</p></div>' +
      '<a href="http://plasma-dashboard.test/">Dashboard</a>' +
      '</header>' +

      '<section class="month-summary">' +
      '<div class="summary-copy">' +
      '<div class="month-label">' + monthLabel(selected) + '</div>' +
      '<div class="amount">+' + fixed(summary.earned) + ' <span>USDT</span></div>' +
      '<div class="meta">' + summary.active + ' active days&nbsp;&nbsp;·&nbsp;&nbsp;Best ' + esc(bestText) + '</div>' +
      '</div>' +
      '<div class="month-nav"><a href="/?month=' + prev + '" aria-label="Previous month">‹</a><a href="/?month=' + next + '" aria-label="Next month">›</a></div>' +
      '</section>' +

      note +

      '<section class="graph-panel">' +
      '<div class="graph-head"><span>' + selected.getFullYear() + ' reward activity</span><span class="coverage">' + esc(rangeText) + '</span></div>' +
      '<div class="graph-scroll" id="graphScroll">' +
      '<div class="graph-inner" style="--weeks:' + graph.weeks + '">' +
      '<div class="weekday-labels"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>' +
      '<div class="graph-main">' +
      '<div class="month-labels">' + graph.monthLabels.join("") + '</div>' +
      '<div class="cells">' + graph.cells.join("") + '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="legend"><span>Less</span><i class="lv0"></i><i class="lv1"></i><i class="lv2"></i><i class="lv3"></i><i class="lv4"></i><span>More</span></div>' +
      '</section>' +

      '<section class="detail" id="detail">' +
      '<div class="detail-date">Select a day</div>' +
      '<div class="detail-value">—</div>' +
      '<div class="detail-meta">Tap a square to inspect that day.</div>' +
      '</section>' +

      '<footer>Stored locally in Loon · ' + STORE_KEY + '</footer>' +
      '</main>' +

      '<script>' +
      '(function(){' +
      'var cells=Array.prototype.slice.call(document.querySelectorAll(".cell:not(.blank)"));' +
      'var detail=document.getElementById("detail");' +
      'cells.forEach(function(cell){cell.addEventListener("click",function(){' +
      'cells.forEach(function(x){x.classList.remove("selected")});cell.classList.add("selected");' +
      'var d=cell.dataset;' +
      'if(d.known!=="1"){' +
      'detail.innerHTML="<div class=\"detail-date\">"+d.date+"</div><div class=\"detail-value\">No captured history</div><div class=\"detail-meta\">This day falls outside the saved history coverage.</div>";' +
      'return;}' +
      'detail.innerHTML="<div class=\"detail-date\">"+d.date+"</div>"+' +
      '"<div class=\"detail-value\">+"+d.earned+" USDT</div>"+' +
      '"<div class=\"detail-meta\">"+d.events+" changes · Referral +"+d.ref+" · Cashback +"+d.cash+" · Net "+sign(d.net)+" · Paid "+sign(d.paid)+"</div>";' +
      '});});' +
      'function sign(v){var n=Number(v);if(!isFinite(n))return "—";return (n>0?"+":"")+v;}' +
      'var scroll=document.getElementById("graphScroll");' +
      'var target=document.querySelector(".cell[data-month=\"' + monthKey(selected) + '\"]");' +
      'if(scroll&&target){setTimeout(function(){scroll.scrollLeft=Math.max(0,target.offsetLeft-72);},0);}' +
      '})();' +
      '</script>' +
      '</body></html>';
  }

  function css() {
    return `
:root{
  --page:#000000;
  --panel:#0d1117;
  --text:#f0f6fc;
  --muted:#8b949e;
  --border:#21262d;
  --border-strong:#30363d;
  --blue:#58a6ff;
  --lv0:#161b22;
  --lv1:#0e4429;
  --lv2:#006d32;
  --lv3:#26a641;
  --lv4:#39d353;
}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--page);color:var(--text)}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--muted);text-decoration:none}
a:active{opacity:.72}
.shell{width:min(100%,920px);margin:0 auto;padding:calc(24px + env(safe-area-inset-top)) 16px calc(32px + env(safe-area-inset-bottom))}
.top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:26px}
.top h1{margin:0;font-size:20px;line-height:1.25;font-weight:600;letter-spacing:-.2px}
.top p{margin:5px 0 0;color:var(--muted);font-size:12px}
.top>a{font-size:12px;padding-top:3px}
.month-summary{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:18px}
.summary-copy{min-width:0}
.month-label{color:var(--muted);font-size:12px;font-weight:600;letter-spacing:.08em}
.amount{margin-top:7px;font-size:clamp(31px,8vw,44px);line-height:1.05;font-weight:600;letter-spacing:-1.5px;font-variant-numeric:tabular-nums;white-space:nowrap}
.amount span{font-size:13px;color:var(--muted);letter-spacing:0;font-weight:500}
.meta{margin-top:9px;color:var(--muted);font-size:12px;line-height:1.6;overflow-wrap:anywhere}
.month-nav{display:flex;flex:none;border:1px solid var(--border-strong);border-radius:6px;overflow:hidden}
.month-nav a{width:34px;height:32px;display:grid;place-items:center;color:var(--text);font-size:18px;background:var(--panel)}
.month-nav a+a{border-left:1px solid var(--border-strong)}
.note{margin:0 0 12px;color:#d29922;font-size:11px;line-height:1.5}
.graph-panel{background:var(--panel);border:1px solid var(--border-strong);border-radius:6px;padding:14px 14px 12px}
.graph-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:10px;font-size:12px;color:var(--text)}
.coverage{color:var(--muted);font-size:10px;font-variant-numeric:tabular-nums}
.graph-scroll{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;padding-bottom:5px}
.graph-inner{display:grid;grid-template-columns:30px max-content;column-gap:8px;width:max-content;min-width:100%}
.weekday-labels{padding-top:19px;display:grid;grid-template-rows:repeat(7,10px);row-gap:3px;color:var(--muted);font-size:9px;line-height:10px}
.weekday-labels span{text-align:right}
.graph-main{width:max-content}
.month-labels{height:19px;display:grid;grid-template-columns:repeat(var(--weeks),10px);column-gap:3px;color:var(--muted);font-size:9px;line-height:12px}
.month-labels span{white-space:nowrap;overflow:visible}
.cells{display:grid;grid-template-rows:repeat(7,10px);grid-auto-flow:column;grid-auto-columns:10px;gap:3px;width:max-content}
.cell,.legend i{width:10px;height:10px;border:1px solid rgba(240,246,252,.04);border-radius:2px;background:var(--lv0);padding:0;appearance:none;-webkit-appearance:none}
.cell{cursor:pointer;transition:outline-color .12s ease,box-shadow .12s ease,opacity .12s ease}
.cell.blank{visibility:hidden}
.cell.unknown{background:#090d12;border-color:#111820;opacity:.52}
.cell.future{opacity:.22}
.cell.month-focus{opacity:1}
.cell.today{outline:1px solid var(--blue);outline-offset:1px}
.cell.selected{outline:1px solid #f0f6fc;outline-offset:1px}
.cell.lv1,.legend .lv1{background:var(--lv1)}
.cell.lv2,.legend .lv2{background:var(--lv2);box-shadow:0 0 3px rgba(0,109,50,.28)}
.cell.lv3,.legend .lv3{background:var(--lv3);box-shadow:0 0 4px rgba(38,166,65,.34)}
.cell.lv4,.legend .lv4{background:var(--lv4);box-shadow:0 0 7px rgba(57,211,83,.46)}
.cell.lv0,.legend .lv0{background:var(--lv0)}
@media(hover:hover){.cell:hover{outline:1px solid rgba(240,246,252,.75);outline-offset:1px}}
.legend{display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:10px;color:var(--muted);font-size:10px}
.detail{margin-top:14px;border:1px solid var(--border);border-radius:6px;padding:13px 14px;background:#05070a}
.detail-date{color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
.detail-value{margin-top:5px;font-size:18px;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.detail-meta{margin-top:7px;color:var(--muted);font-size:11px;line-height:1.6;overflow-wrap:anywhere}
footer{margin-top:14px;color:#484f58;font-size:10px}
.empty{margin-top:28px;border:1px solid var(--border);border-radius:6px;background:var(--panel);padding:24px;color:var(--muted);font-size:13px}
@media(max-width:560px){
  .shell{padding-left:14px;padding-right:14px}
  .month-summary{align-items:flex-start}
  .amount{font-size:clamp(29px,9.3vw,38px)}
  .graph-panel{padding:12px 10px 10px}
  .graph-head{align-items:flex-start;flex-direction:column;gap:4px}
  .coverage{font-size:9px}
  .meta{max-width:270px}
}
`;
  }

  function respond(body, contentType) {
    $done({
      response: {
        status: 200,
        headers: {
          "Content-Type": contentType || "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          "Pragma": "no-cache",
          "Expires": "0"
        },
        body: body
      }
    });
  }

  const store = readStore();
  respond(page(store));
})();