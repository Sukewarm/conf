/**
 * Plasma Rewards Heatmap for Loon (experimental v2)
 * Read-only. Reads plasma_rewards_tracker_v1 and renders a horizontal GitHub-style monthly heatmap.
 * Never writes to persistentStore and never uploads stored data.
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

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeSnapshot(s) {
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
        ? stored.history.map(sanitizeSnapshot).filter(Boolean).sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt)).slice(-100)
        : [];
      return {
        version: Number(stored.version || 0),
        first: sanitizeSnapshot(stored.first),
        last: sanitizeSnapshot(stored.last),
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

  function parseSelectedMonth(url) {
    const m = String(url || "").match(/[?&]month=(\d{4})-(\d{2})(?:&|$)/);
    if (m) {
      const y = Number(m[1]);
      const mon = Number(m[2]);
      if (y >= 2000 && y <= 2200 && mon >= 1 && mon <= 12) return new Date(y, mon - 1, 1);
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  function addMonths(d, n) {
    return new Date(d.getFullYear(), d.getMonth() + n, 1);
  }

  function buildDaily(history) {
    const days = {};
    if (!Array.isArray(history) || history.length < 2) return days;

    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const cur = history[i];
      const curDate = new Date(cur.capturedAt);
      if (Number.isNaN(curDate.getTime())) continue;

      const totalDelta = cur.total - prev.total;
      const referralDelta = cur.totalReferrals - prev.totalReferrals;
      const cashbackDelta = cur.totalCashBack - prev.totalCashBack;
      const pendingDelta = cur.pending - prev.pending;
      const accruedDelta = cur.accrued - prev.accrued;
      const paidDelta = cur.paid - prev.paid;
      const key = dateKey(curDate);

      if (!days[key]) {
        days[key] = {
          earned: 0,
          net: 0,
          events: 0,
          referral: 0,
          cashback: 0,
          pendingMove: 0,
          accruedMove: 0,
          paidMove: 0
        };
      }

      days[key].net += totalDelta;
      days[key].events += 1;
      if (totalDelta > 0) days[key].earned += totalDelta;
      if (referralDelta > 0) days[key].referral += referralDelta;
      if (cashbackDelta > 0) days[key].cashback += cashbackDelta;
      days[key].pendingMove += pendingDelta;
      days[key].accruedMove += accruedDelta;
      days[key].paidMove += paidDelta;
    }
    return days;
  }

  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return sorted[base + 1] !== undefined
      ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
      : sorted[base];
  }

  function thresholdsFor(values) {
    const positives = values.filter(v => v > 0).sort((a, b) => a - b);
    if (!positives.length) return [0, 0, 0];
    return [quantile(positives, 0.25), quantile(positives, 0.50), quantile(positives, 0.75)];
  }

  function levelFor(value, thresholds) {
    if (!(value > 0)) return 0;
    if (value <= thresholds[0]) return 1;
    if (value <= thresholds[1]) return 2;
    if (value <= thresholds[2]) return 3;
    return 4;
  }

  function coverageFor(history) {
    if (!history.length) return null;
    const firstDate = new Date(history[0].capturedAt);
    const lastDate = new Date(history[history.length - 1].capturedAt);
    if (Number.isNaN(firstDate.getTime()) || Number.isNaN(lastDate.getTime())) return null;
    return { firstDate: firstDate, lastDate: lastDate };
  }

  function monthModel(selected, daily, history) {
    const y = selected.getFullYear();
    const m = selected.getMonth();
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);
    const daysInMonth = end.getDate();
    const startWeekday = start.getDay();

    const monthValues = [];
    let monthEarned = 0;
    let activeDays = 0;
    let best = null;

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(y, m, day);
      const info = daily[dateKey(d)] || { earned: 0, net: 0, events: 0, referral: 0, cashback: 0, pendingMove: 0, accruedMove: 0, paidMove: 0 };
      monthValues.push(info.earned);
      if (info.earned > 0) {
        monthEarned += info.earned;
        activeDays += 1;
        if (!best || info.earned > best.earned) best = { day: day, earned: info.earned };
      }
    }

    const thresholds = thresholdsFor(monthValues);
    const cells = [];

    for (let i = 0; i < startWeekday; i++) {
      cells.push('<div class="cell blank" aria-hidden="true"></div>');
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(y, m, day);
      const key = dateKey(d);
      const info = daily[key] || { earned: 0, net: 0, events: 0, referral: 0, cashback: 0, pendingMove: 0, accruedMove: 0, paidMove: 0 };
      const level = levelFor(info.earned, thresholds);
      const today = dateKey(new Date()) === key ? " today" : "";
      const payload = key + " · " + fixed(info.earned) + " USDT · " + info.events + " 次变化";

      cells.push(
        '<button class="cell lv' + level + today + '"' +
        ' data-date="' + key + '"' +
        ' data-earned="' + fixed(info.earned) + '"' +
        ' data-net="' + fixed(info.net) + '"' +
        ' data-events="' + info.events + '"' +
        ' data-ref="' + fixed(info.referral) + '"' +
        ' data-cash="' + fixed(info.cashback) + '"' +
        ' data-pending="' + fixed(info.pendingMove) + '"' +
        ' data-accrued="' + fixed(info.accruedMove) + '"' +
        ' data-paid="' + fixed(info.paidMove) + '"' +
        ' aria-label="' + esc(payload) + '" title="' + esc(payload) + '">' +
        '<span class="daynum">' + day + '</span></button>'
      );
    }

    const totalSlots = startWeekday + daysInMonth;
    const trailing = (7 - (totalSlots % 7)) % 7;
    for (let i = 0; i < trailing; i++) {
      cells.push('<div class="cell blank" aria-hidden="true"></div>');
    }

    const coverage = coverageFor(history);
    const incompleteStart = coverage && coverage.firstDate > start && coverage.firstDate <= end;
    const outsideCoverage = coverage && (end < new Date(coverage.firstDate.getFullYear(), coverage.firstDate.getMonth(), coverage.firstDate.getDate()) || start > coverage.lastDate);

    return {
      y: y,
      m: m,
      start: start,
      end: end,
      cells: cells,
      monthEarned: monthEarned,
      activeDays: activeDays,
      best: best,
      thresholds: thresholds,
      coverage: coverage,
      incompleteStart: incompleteStart,
      outsideCoverage: outsideCoverage
    };
  }

  function monthName(d) {
    return d.getFullYear() + " 年 " + (d.getMonth() + 1) + " 月";
  }

  function coverageText(model) {
    if (!model.coverage) return "暂无历史范围";
    return dateKey(model.coverage.firstDate) + " → " + dateKey(model.coverage.lastDate);
  }

  function page(store) {
    if (!store || !store.last) {
      return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Plasma Heatmap</title><style>' + css() + '</style></head><body><main class="shell"><section class="empty"><div class="mark">◈</div><h1>NO DATA</h1><p>先让 Plasma Rewards Tracker 至少记录两次金额变化。</p></section></main></body></html>';
    }

    const selected = parseSelectedMonth(requestUrl);
    const daily = buildDaily(store.history || []);
    const model = monthModel(selected, daily, store.history || []);
    const prev = monthKey(addMonths(selected, -1));
    const next = monthKey(addMonths(selected, 1));
    const bestText = model.best ? (model.best.day + " 日 · " + fixed(model.best.earned)) : "—";

    let warning = "";
    if (model.incompleteStart) {
      warning = '<div class="notice"><b>PARTIAL DATA</b><span>这个月前半段早于目前保留的 100 条历史，缺失部分不会被当成 0。</span></div>';
    } else if (model.outsideCoverage) {
      warning = '<div class="notice"><b>OUTSIDE RANGE</b><span>所选月份不在当前历史覆盖范围内。</span></div>';
    }

    return '<!doctype html>' +
      '<html lang="zh-CN"><head>' +
      '<meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
      '<meta name="theme-color" content="#0d1117">' +
      '<title>Plasma Heatmap</title><style>' + css() + '</style></head><body>' +
      '<div class="scanline"></div>' +
      '<main class="shell">' +
      '<header class="top">' +
      '<div><div class="eyebrow">PLASMA // ACTIVITY MATRIX</div><h1>Reward Heatmap</h1><p>LOCAL HISTORY · READ ONLY</p></div>' +
      '<a class="dash" href="http://plasma-dashboard.test/">DASHBOARD ↗</a>' +
      '</header>' +

      '<section class="stats">' +
      '<article><span>MONTH EARNED</span><strong>' + fixed(model.monthEarned) + '</strong><small>USDT</small></article>' +
      '<article><span>ACTIVE DAYS</span><strong>' + model.activeDays + '</strong><small>DAYS</small></article>' +
      '<article><span>PEAK DAY</span><strong>' + bestText + '</strong><small>MAX</small></article>' +
      '</section>' +

      warning +

      '<section class="panel">' +
      '<div class="month-head">' +
      '<a class="nav" href="/?month=' + prev + '">‹</a>' +
      '<div><h2>' + monthName(selected) + '</h2><p>' + esc(coverageText(model)) + '</p></div>' +
      '<a class="nav" href="/?month=' + next + '">›</a>' +
      '</div>' +

      '<div class="weekday-row"><span>SUN</span><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span></div>' +
      '<div class="calendar">' + model.cells.join("") + '</div>' +
      '<div class="legend"><span>LESS</span><i class="lv0"></i><i class="lv1"></i><i class="lv2"></i><i class="lv3"></i><i class="lv4"></i><span>MORE</span></div>' +
      '</section>' +

      '<section class="detail" id="detail">' +
      '<div class="detail-kicker">SELECT A DAY</div>' +
      '<div class="detail-title">点击一个格子查看当天数据</div>' +
      '<div class="detail-grid">' +
      '<div><span>新增奖励</span><strong>—</strong></div>' +
      '<div><span>变化次数</span><strong>—</strong></div>' +
      '<div><span>邀请返利</span><strong>—</strong></div>' +
      '<div><span>消费返现</span><strong>—</strong></div>' +
      '</div></section>' +

      '<footer>LOCAL STORE · ' + STORE_KEY + ' · TEST BRANCH</footer>' +
      '</main>' +
      '<script>' + browserJs() + '</script></body></html>';
  }

  function browserJs() {
    return "(() => {" +
      "const cells=document.querySelectorAll('.cell:not(.blank)');" +
      "const detail=document.getElementById('detail');" +
      "function sign(v){const n=Number(v);return (n>0?'+':'')+Number(n||0).toFixed(4)}" +
      "cells.forEach(cell=>cell.addEventListener('click',()=>{" +
      "cells.forEach(x=>x.classList.remove('selected'));cell.classList.add('selected');" +
      "detail.innerHTML='<div class=\"detail-kicker\">'+cell.dataset.date+'</div>'+" +
      "'<div class=\"detail-title\">+'+cell.dataset.earned+' USDT</div>'+" +
      "'<div class=\"detail-grid\">'+" +
      "'<div><span>变化次数</span><strong>'+cell.dataset.events+' 次</strong></div>'+" +
      "'<div><span>邀请返利</span><strong>+'+cell.dataset.ref+'</strong></div>'+" +
      "'<div><span>消费返现</span><strong>+'+cell.dataset.cash+'</strong></div>'+" +
      "'<div><span>净变化</span><strong>'+sign(cell.dataset.net)+'</strong></div>'+" +
      "'</div>'+" +
      "'<div class=\"flow\"><span>Accruing '+sign(cell.dataset.pending)+'</span><span>Settlement '+sign(cell.dataset.accrued)+'</span><span>Paid '+sign(cell.dataset.paid)+'</span></div>';" +
      "}));" +
      "})();";
  }

  function css() {
    return `
:root{
  color-scheme:dark;
  --bg:#0d1117;--panel:#0f141b;--panel2:#161b22;--text:#e6edf3;--muted:#7d8590;
  --border:#30363d;--border2:#21262d;--cyan:#79c0ff;--glow:#58d68d;
  --lv0:#161b22;--lv1:#0e4429;--lv2:#006d32;--lv3:#26a641;--lv4:#39d353;
}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0;min-height:100vh;background:
  radial-gradient(circle at 18% -10%,rgba(47,129,247,.12),transparent 28%),
  radial-gradient(circle at 90% 10%,rgba(57,211,83,.08),transparent 24%),
  linear-gradient(180deg,#0d1117 0%,#090c10 100%);
  color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",ui-monospace,SFMono-Regular,Menlo,monospace;
  -webkit-font-smoothing:antialiased}
body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.18;background-image:
  linear-gradient(rgba(121,192,255,.04) 1px,transparent 1px),
  linear-gradient(90deg,rgba(121,192,255,.04) 1px,transparent 1px);background-size:28px 28px;mask-image:linear-gradient(to bottom,black,transparent 80%)}
.scanline{position:fixed;z-index:10;left:0;right:0;height:1px;top:0;background:linear-gradient(90deg,transparent,rgba(121,192,255,.26),transparent);box-shadow:0 0 14px rgba(121,192,255,.16);animation:scan 8s linear infinite;pointer-events:none;opacity:.5}
@keyframes scan{from{transform:translateY(0)}to{transform:translateY(100vh)}}
.shell{width:min(100%,760px);margin:0 auto;padding:calc(24px + env(safe-area-inset-top)) 16px calc(38px + env(safe-area-inset-bottom))}
.top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}.top h1{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif;font-size:31px;letter-spacing:-1px;margin:4px 0 4px}.top p{margin:0;color:var(--muted);font-size:11px;letter-spacing:1px}.eyebrow{color:#39d353;font-size:10px;font-weight:800;letter-spacing:1.8px;text-shadow:0 0 12px rgba(57,211,83,.25)}
.dash{color:var(--cyan);border:1px solid var(--border);background:rgba(22,27,34,.7);padding:9px 11px;border-radius:7px;text-decoration:none;font-size:10px;font-weight:800;letter-spacing:.6px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}.stats article{min-width:0;background:linear-gradient(180deg,rgba(22,27,34,.94),rgba(13,17,23,.9));border:1px solid var(--border);border-radius:8px;padding:13px;box-shadow:inset 0 1px rgba(255,255,255,.02)}.stats span,.stats small{display:block;color:var(--muted);font-size:9px;letter-spacing:.8px}.stats strong{display:block;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif;font-size:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:5px 0 2px;color:#f0f6fc}
.panel,.detail{position:relative;background:linear-gradient(180deg,rgba(15,20,27,.96),rgba(13,17,23,.97));border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:10px;box-shadow:0 16px 50px rgba(0,0,0,.22)}
.panel:before,.detail:before{content:"";position:absolute;left:13px;right:13px;top:-1px;height:1px;background:linear-gradient(90deg,transparent,rgba(121,192,255,.5),transparent)}
.month-head{display:grid;grid-template-columns:36px 1fr 36px;align-items:center;text-align:center;margin-bottom:14px}.month-head h2{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif;margin:0;font-size:19px;letter-spacing:-.3px}.month-head p{color:var(--muted);font-size:9px;margin:4px 0 0}.nav{display:grid;place-items:center;height:32px;color:var(--text);text-decoration:none;border:1px solid var(--border2);border-radius:6px;background:#161b22;font-size:22px}
.weekday-row,.calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}.weekday-row{margin-bottom:6px}.weekday-row span{text-align:center;color:#6e7681;font-size:8px;font-weight:800;letter-spacing:.6px}
.calendar{width:100%;direction:ltr}.cell{position:relative;appearance:none;border:1px solid rgba(240,246,252,.05);border-radius:5px;aspect-ratio:1/1;min-width:0;padding:0;cursor:pointer;transition:transform .12s ease,box-shadow .12s ease,border-color .12s ease,filter .12s ease;overflow:hidden}.cell.blank{background:transparent;border-color:transparent;pointer-events:none}.cell.lv0{background:var(--lv0);border-color:#21262d}.cell.lv1{background:var(--lv1)}.cell.lv2{background:var(--lv2)}.cell.lv3{background:var(--lv3)}.cell.lv4{background:var(--lv4)}
.cell:not(.blank):after{content:"";position:absolute;inset:0;background:linear-gradient(145deg,rgba(121,192,255,.10),transparent 38%,rgba(255,255,255,.02));pointer-events:none}.cell:hover,.cell.selected{transform:translateY(-2px) scale(1.035);z-index:2;border-color:rgba(121,192,255,.78);box-shadow:0 0 0 1px rgba(121,192,255,.22),0 0 18px rgba(57,211,83,.34);filter:saturate(1.08) brightness(1.06)}.cell.today{outline:1px solid rgba(121,192,255,.9);outline-offset:2px}.daynum{position:absolute;left:5px;top:4px;z-index:1;color:rgba(230,237,243,.38);font-size:9px;font-weight:700}.lv3 .daynum,.lv4 .daynum{color:rgba(255,255,255,.7)}
.legend{display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:12px;color:var(--muted);font-size:8px;letter-spacing:.5px}.legend i{display:block;width:11px;height:11px;border:1px solid rgba(240,246,252,.05);border-radius:2px}.legend .lv0{background:var(--lv0)}.legend .lv1{background:var(--lv1)}.legend .lv2{background:var(--lv2)}.legend .lv3{background:var(--lv3)}.legend .lv4{background:var(--lv4)}
.detail-kicker{font-size:9px;color:#39d353;letter-spacing:1.1px;font-weight:800}.detail-title{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif;font-size:24px;font-weight:800;margin:5px 0 13px}.detail-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.detail-grid>div{background:#0d1117;border:1px solid var(--border2);border-radius:7px;padding:10px}.detail-grid span{display:block;color:var(--muted);font-size:9px;margin-bottom:5px}.detail-grid strong{font-size:12px}.flow{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.flow span{color:#8b949e;border:1px solid var(--border2);background:#0d1117;padding:6px 8px;border-radius:5px;font-size:9px}
.notice{display:flex;gap:10px;align-items:flex-start;border:1px solid #634b16;background:rgba(99,75,22,.15);border-radius:8px;padding:10px 12px;margin-bottom:10px;color:#d29922;font-size:10px}.notice b{letter-spacing:.7px;white-space:nowrap}.notice span{color:#b8a66a}
footer{text-align:center;color:#484f58;font-size:8px;letter-spacing:.7px;padding-top:8px}.empty{text-align:center;padding:90px 20px}.mark{font-size:44px;color:#39d353;text-shadow:0 0 25px rgba(57,211,83,.35)}.empty h1{font-size:24px}.empty p{color:var(--muted);font-size:12px}
@media(max-width:520px){.shell{padding-left:12px;padding-right:12px}.top h1{font-size:27px}.stats article{padding:10px}.stats strong{font-size:16px}.panel,.detail{padding:13px}.weekday-row,.calendar{gap:4px}.daynum{font-size:8px;left:4px;top:3px}.detail-grid{grid-template-columns:1fr 1fr}.dash{font-size:8px;padding:8px}.month-head{grid-template-columns:32px 1fr 32px}.nav{height:30px}}
`;
  }

  const store = readStore();
  const html = page(store);
  $done({
    response: {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "Pragma": "no-cache"
      },
      body: html
    }
  });
})();
