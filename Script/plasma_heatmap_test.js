/**
 * Plasma Rewards Heatmap for Loon (experimental v3)
 * Minimal GitHub Dark UI. Read-only.
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

  function fixed(v, digits = 4) {
    const n = num(v);
    return n === null ? "—" : n.toFixed(digits);
  }

  function signed(v, digits = 4) {
    const n = num(v);
    if (n === null) return "—";
    if (Math.abs(n) < 0.0000005) return "0.0000";
    return (n > 0 ? "+" : "") + n.toFixed(digits);
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
      total,
      pending: num(s.pending) ?? 0,
      accrued: num(s.accrued) ?? 0,
      paid: num(s.paid) ?? 0,
      totalReferrals: num(s.totalReferrals) ?? 0,
      totalCashBack: num(s.totalCashBack) ?? 0
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
      return { first: snap(stored.first), last: snap(stored.last), history };
    } catch (e) {
      console.log("[Plasma Heatmap] read error: " + e);
      return null;
    }
  }

  function pad2(n) { return String(n).padStart(2, "0"); }
  function dateKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function monthKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
  function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

  function selectedMonth(url) {
    const m = String(url || "").match(/[?&]month=(\d{4})-(\d{2})(?:&|$)/);
    if (m) {
      const y = Number(m[1]);
      const mon = Number(m[2]);
      if (y >= 2000 && y <= 2200 && mon >= 1 && mon <= 12) return new Date(y, mon - 1, 1);
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  function buildDaily(history) {
    const days = Object.create(null);
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
    return sorted[i + 1] === undefined ? sorted[i] : sorted[i] + r * (sorted[i + 1] - sorted[i]);
  }

  function thresholds(values) {
    const p = values.filter(v => v > 0).sort((a, b) => a - b);
    if (!p.length) return [0, 0, 0];
    return [quantile(p, .25), quantile(p, .5), quantile(p, .75)];
  }

  function level(v, t) {
    if (!(v > 0)) return 0;
    if (v <= t[0]) return 1;
    if (v <= t[1]) return 2;
    if (v <= t[2]) return 3;
    return 4;
  }

  function coverage(history) {
    if (!history.length) return null;
    const first = new Date(history[0].capturedAt);
    const last = new Date(history[history.length - 1].capturedAt);
    if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return null;
    return { first, last };
  }

  function model(month, daily, history) {
    const y = month.getFullYear();
    const m = month.getMonth();
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);
    const count = end.getDate();
    const startDow = start.getDay();

    const values = [];
    let earned = 0;
    let active = 0;
    let best = null;

    for (let day = 1; day <= count; day++) {
      const info = daily[dateKey(new Date(y, m, day))] || { earned: 0 };
      values.push(info.earned || 0);
      if (info.earned > 0) {
        earned += info.earned;
        active++;
        if (!best || info.earned > best.earned) best = { day, earned: info.earned };
      }
    }

    const t = thresholds(values);
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push('<div class="day empty"></div>');

    const today = dateKey(new Date());
    for (let day = 1; day <= count; day++) {
      const d = new Date(y, m, day);
      const key = dateKey(d);
      const info = daily[key] || {
        earned: 0, net: 0, events: 0, referral: 0, cashback: 0,
        pending: 0, accrued: 0, paid: 0
      };
      const lv = level(info.earned, t);
      const isToday = key === today ? " today" : "";
      cells.push(
        `<button class="day lv${lv}${isToday}" data-date="${key}" data-earned="${fixed(info.earned)}" ` +
        `data-net="${fixed(info.net)}" data-events="${info.events}" data-ref="${fixed(info.referral)}" ` +
        `data-cash="${fixed(info.cashback)}" data-pending="${fixed(info.pending)}" ` +
        `data-accrued="${fixed(info.accrued)}" data-paid="${fixed(info.paid)}" ` +
        `aria-label="${esc(key + " +" + fixed(info.earned) + " USDT")}"><span>${day}</span></button>`
      );
    }

    const trailing = (7 - ((startDow + count) % 7)) % 7;
    for (let i = 0; i < trailing; i++) cells.push('<div class="day empty"></div>');

    const cov = coverage(history);
    const partial = !!(cov && cov.first > start && cov.first <= end);
    const outside = !!(cov && (end < new Date(cov.first.getFullYear(), cov.first.getMonth(), cov.first.getDate()) || start > cov.last));

    return { start, end, cells, earned, active, best, cov, partial, outside };
  }

  function monthTitle(d) {
    return `${d.getFullYear()} / ${pad2(d.getMonth() + 1)}`;
  }

  function page(store) {
    if (!store || !store.last || !store.history || store.history.length < 2) {
      return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0d1117"><title>Plasma Heatmap</title><style>${css()}</style></head><body><main><header><div class="brand">PLASMA / REWARDS</div></header><div class="nodata">NO DATA<br><span>至少需要两次金额变化记录。</span></div></main></body></html>`;
    }

    const month = selectedMonth(requestUrl);
    const daily = buildDaily(store.history);
    const m = model(month, daily, store.history);
    const prev = monthKey(addMonths(month, -1));
    const next = monthKey(addMonths(month, 1));
    const best = m.best ? `${pad2(m.best.day)} / ${fixed(m.best.earned)}` : "—";
    const range = m.cov ? `${dateKey(m.cov.first)} — ${dateKey(m.cov.last)}` : "—";

    let note = "";
    if (m.partial) note = `<div class="note">PARTIAL DATA · 本月早期记录已超出当前 100 条历史范围。</div>`;
    if (m.outside) note = `<div class="note">OUTSIDE RANGE · 当前历史没有覆盖这个月份。</div>`;

    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0d1117">
<meta name="color-scheme" content="dark">
<title>Plasma Heatmap</title>
<style>${css()}</style>
</head>
<body>
<main>
  <header>
    <div>
      <div class="brand">PLASMA / REWARDS</div>
      <div class="sub">LOCAL ACTIVITY</div>
    </div>
    <a class="dashboard" href="http://plasma-dashboard.test/">DASHBOARD</a>
  </header>

  <section class="summary">
    <div><label>MONTH</label><strong>${fixed(m.earned)}</strong><small>USDT</small></div>
    <div><label>ACTIVE</label><strong>${m.active}</strong><small>DAYS</small></div>
    <div><label>PEAK</label><strong>${best}</strong><small>DAY / USDT</small></div>
  </section>

  ${note}

  <section class="calendar-box">
    <div class="monthbar">
      <a href="/?month=${prev}">‹</a>
      <div><h1>${monthTitle(month)}</h1><p>${esc(range)}</p></div>
      <a href="/?month=${next}">›</a>
    </div>

    <div class="weekdays"><span>SUN</span><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span></div>
    <div class="calendar">${m.cells.join("")}</div>

    <div class="legend"><span>LESS</span><i class="lv0"></i><i class="lv1"></i><i class="lv2"></i><i class="lv3"></i><i class="lv4"></i><span>MORE</span></div>
  </section>

  <section class="detail" id="detail">
    <div class="detail-head"><span>SELECT A DAY</span><strong>—</strong></div>
    <div class="detail-main">点击格子查看当天变化</div>
    <div class="detail-grid">
      <div><label>EVENTS</label><strong>—</strong></div>
      <div><label>REFERRAL</label><strong>—</strong></div>
      <div><label>CASHBACK</label><strong>—</strong></div>
      <div><label>NET</label><strong>—</strong></div>
      <div><label>ACCRUING</label><strong>—</strong></div>
      <div><label>SETTLEMENT</label><strong>—</strong></div>
      <div><label>PAID</label><strong>—</strong></div>
    </div>
  </section>

  <footer>READ ONLY · ${STORE_KEY}</footer>
</main>
<script>
(() => {
  const all = Array.from(document.querySelectorAll('.day:not(.empty)'));
  const detail = document.getElementById('detail');
  all.forEach(cell => cell.addEventListener('click', () => {
    all.forEach(x => x.classList.remove('selected'));
    cell.classList.add('selected');
    const d = cell.dataset;
    detail.innerHTML =
      '<div class="detail-head"><span>' + d.date + '</span><strong>+' + d.earned + ' USDT</strong></div>' +
      '<div class="detail-main">DAILY ACTIVITY</div>' +
      '<div class="detail-grid">' +
      '<div><label>EVENTS</label><strong>' + d.events + '</strong></div>' +
      '<div><label>REFERRAL</label><strong>+' + d.ref + '</strong></div>' +
      '<div><label>CASHBACK</label><strong>+' + d.cash + '</strong></div>' +
      '<div><label>NET</label><strong>' + (Number(d.net) > 0 ? '+' : '') + d.net + '</strong></div>' +
      '<div><label>ACCRUING</label><strong>' + signedClient(d.pending) + '</strong></div>' +
      '<div><label>SETTLEMENT</label><strong>' + signedClient(d.accrued) + '</strong></div>' +
      '<div><label>PAID</label><strong>' + signedClient(d.paid) + '</strong></div>' +
      '</div>';
  }));
  function signedClient(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + v;
  }
})();
</script>
</body>
</html>`;
  }

  function css() {
    return `
:root{--bg:#0d1117;--panel:#0d1117;--text:#f0f6fc;--muted:#8b949e;--border:#30363d;--soft:#161b22;--blue:#58a6ff;--lv0:#161b22;--lv1:#0e4429;--lv2:#006d32;--lv3:#26a641;--lv4:#39d353}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
body{min-height:100vh}
a{color:inherit;text-decoration:none}
main{width:min(100%,760px);margin:0 auto;padding:calc(28px + env(safe-area-inset-top)) 18px calc(36px + env(safe-area-inset-bottom))}
header{height:48px;display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid var(--border);margin-bottom:26px}
.brand{font:600 13px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em}.sub{margin-top:5px;color:var(--muted);font:11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em}.dashboard{color:var(--muted);font:600 10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.07em}.dashboard:hover{color:var(--text)}
.summary{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--border);border-radius:6px;margin-bottom:14px}.summary>div{min-width:0;padding:16px 14px}.summary>div+div{border-left:1px solid var(--border)}label,.summary label{display:block;color:var(--muted);font:600 10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em}.summary strong{display:block;margin-top:7px;font-size:23px;line-height:1.05;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.summary small{display:block;margin-top:5px;color:var(--muted);font:9px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.05em}
.note{margin:0 0 14px;padding:9px 11px;border:1px solid var(--border);border-radius:4px;color:var(--muted);font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.calendar-box{border:1px solid var(--border);border-radius:6px;padding:16px;margin-bottom:14px}.monthbar{display:grid;grid-template-columns:28px 1fr 28px;align-items:center;margin-bottom:18px}.monthbar>a{height:28px;border:1px solid var(--border);border-radius:4px;display:grid;place-items:center;color:var(--muted);font-size:20px;line-height:1}.monthbar>a:hover{color:var(--text);border-color:#8b949e}.monthbar>div{text-align:center}.monthbar h1{margin:0;font:600 15px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em}.monthbar p{margin:5px 0 0;color:var(--muted);font:9px ui-monospace,SFMono-Regular,Menlo,monospace}
.weekdays,.calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}.weekdays{margin-bottom:6px}.weekdays span{text-align:center;color:#6e7681;font:600 8px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.03em}.day{position:relative;aspect-ratio:1;border:1px solid rgba(240,246,252,.05);border-radius:2px;padding:0;appearance:none;-webkit-appearance:none;background:var(--lv0);cursor:pointer;color:rgba(240,246,252,.55);font:500 clamp(8px,2.8vw,11px) ui-monospace,SFMono-Regular,Menlo,monospace}.day span{position:absolute;left:5px;top:4px}.day.empty{background:transparent;border-color:transparent;cursor:default}.day.lv1{background:var(--lv1)}.day.lv2{background:var(--lv2)}.day.lv3{background:var(--lv3);color:#d7fbe3}.day.lv4{background:var(--lv4);color:#07130b}.day:hover:not(.empty){outline:1px solid #8b949e;outline-offset:1px}.day.today{outline:1px solid var(--blue);outline-offset:1px}.day.selected{outline:1px solid var(--text);outline-offset:1px}
.legend{display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:14px;color:var(--muted);font:8px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em}.legend i{width:11px;height:11px;border-radius:2px;border:1px solid rgba(240,246,252,.05)}.legend .lv0{background:var(--lv0)}.legend .lv1{background:var(--lv1)}.legend .lv2{background:var(--lv2)}.legend .lv3{background:var(--lv3)}.legend .lv4{background:var(--lv4)}
.detail{border:1px solid var(--border);border-radius:6px;padding:16px}.detail-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.detail-head span{color:var(--muted);font:10px ui-monospace,SFMono-Regular,Menlo,monospace}.detail-head strong{font-size:16px;font-weight:600;font-variant-numeric:tabular-nums}.detail-main{margin:9px 0 15px;font:600 11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em}.detail-grid{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--border);border-left:1px solid var(--border)}.detail-grid>div{min-width:0;padding:11px;border-right:1px solid var(--border);border-bottom:1px solid var(--border)}.detail-grid strong{display:block;margin-top:6px;font:600 12px ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}.detail-grid label{font-size:8px}
footer{margin-top:14px;color:#484f58;text-align:center;font:8px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em}.nodata{margin-top:60px;color:var(--text);font:600 22px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace}.nodata span{color:var(--muted);font-size:11px;font-weight:400}
@media(max-width:520px){main{padding-left:12px;padding-right:12px}.summary>div{padding:13px 9px}.summary strong{font-size:19px}.calendar-box{padding:12px}.weekdays,.calendar{gap:4px}.detail-grid{grid-template-columns:repeat(2,1fr)}}`;
  }

  const store = readStore();
  $done({
    response: {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache"
      },
      body: page(store)
    }
  });
})();