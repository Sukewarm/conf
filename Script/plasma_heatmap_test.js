/**
 * Plasma Rewards Heatmap for Loon (experimental)
 * Read-only. Reads plasma_rewards_tracker_v1 and renders a GitHub-style monthly heatmap.
 * This script never writes to persistentStore and never uploads stored data.
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

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeSnapshot(s) {
    if (!s || typeof s !== "object") return null;
    const total = num(s.total);
    if (total === null || !s.capturedAt) return null;
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
        ? stored.history.map(sanitizeSnapshot).filter(Boolean).sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt)).slice(-100)
        : [];
      return {
        version: Number(stored.version || 0),
        first: sanitizeSnapshot(stored.first),
        last: sanitizeSnapshot(stored.last),
        history
      };
    } catch (e) {
      console.log(`[Plasma Heatmap] read error: ${e}`);
      return null;
    }
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function dateKey(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function monthKey(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
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
      const delta = cur.total - prev.total;
      const refDelta = cur.totalReferrals - prev.totalReferrals;
      const cashDelta = cur.totalCashBack - prev.totalCashBack;
      const key = dateKey(curDate);
      if (!days[key]) days[key] = { earned: 0, net: 0, events: 0, referral: 0, cashback: 0 };
      days[key].net += delta;
      days[key].events += 1;
      if (delta > 0) days[key].earned += delta;
      if (refDelta > 0) days[key].referral += refDelta;
      if (cashDelta > 0) days[key].cashback += cashDelta;
    }
    return days;
  }

  function levelFor(value, max) {
    if (!(value > 0) || !(max > 0)) return 0;
    const r = value / max;
    if (r <= 0.10) return 1;
    if (r <= 0.30) return 2;
    if (r <= 0.60) return 3;
    return 4;
  }

  function monthModel(selected, daily, history) {
    const y = selected.getFullYear();
    const m = selected.getMonth();
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);
    const daysInMonth = end.getDate();
    const startWeekday = start.getDay();
    const totalSlots = startWeekday + daysInMonth;
    const weeks = Math.ceil(totalSlots / 7);

    let maxEarned = 0;
    let monthEarned = 0;
    let activeDays = 0;
    let best = null;

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(y, m, day);
      const info = daily[dateKey(d)] || { earned: 0, net: 0, events: 0, referral: 0, cashback: 0 };
      if (info.earned > 0) {
        activeDays += 1;
        monthEarned += info.earned;
        if (info.earned > maxEarned) maxEarned = info.earned;
        if (!best || info.earned > best.earned) best = { day, earned: info.earned };
      }
    }

    const cells = [];
    for (let week = 0; week < weeks; week++) {
      for (let dow = 0; dow < 7; dow++) {
        const slot = week * 7 + dow;
        const day = slot - startWeekday + 1;
        if (day < 1 || day > daysInMonth) {
          cells.push('<div class="cell blank" aria-hidden="true"></div>');
          continue;
        }
        const d = new Date(y, m, day);
        const key = dateKey(d);
        const info = daily[key] || { earned: 0, net: 0, events: 0, referral: 0, cashback: 0 };
        const level = levelFor(info.earned, maxEarned);
        const payload = [
          `${key}`,
          `${fixed(info.earned)} USDT 新增`,
          `${info.events} 次金额变化`,
          `邀请 +${fixed(info.referral)}`,
          `返现 +${fixed(info.cashback)}`
        ].join(" · ");
        cells.push(`<button class="cell lv${level}" data-date="${key}" data-earned="${fixed(info.earned)}" data-net="${fixed(info.net)}" data-events="${info.events}" data-ref="${fixed(info.referral)}" data-cash="${fixed(info.cashback)}" aria-label="${esc(payload)}" title="${esc(payload)}"></button>`);
      }
    }

    let coverage = null;
    if (history.length) {
      const firstDate = new Date(history[0].capturedAt);
      const lastDate = new Date(history[history.length - 1].capturedAt);
      if (!Number.isNaN(firstDate.getTime()) && !Number.isNaN(lastDate.getTime())) {
        coverage = { firstDate, lastDate };
      }
    }

    const incompleteStart = coverage && coverage.firstDate > start && coverage.firstDate <= end;
    const outsideCoverage = coverage && (end < new Date(coverage.firstDate.getFullYear(), coverage.firstDate.getMonth(), coverage.firstDate.getDate()) || start > coverage.lastDate);

    return { y, m, start, end, weeks, cells, monthEarned, activeDays, best, maxEarned, coverage, incompleteStart, outsideCoverage };
  }

  function monthName(d) {
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
  }

  function page(store) {
    if (!store || !store.last) {
      return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Plasma Heatmap</title><style>${css()}</style></head><body><main class="shell"><section class="empty"><div class="mark">▦</div><h1>没有可显示的数据</h1><p>先让 Plasma Rewards Tracker 成功抓到至少两次金额变化。</p></section></main></body></html>`;
    }

    const selected = parseSelectedMonth(requestUrl);
    const daily = buildDaily(store.history || []);
    const model = monthModel(selected, daily, store.history || []);
    const prev = monthKey(addMonths(selected, -1));
    const next = monthKey(addMonths(selected, 1));
    const bestText = model.best ? `${model.best.day} 日 · ${fixed(model.best.earned)}` : "—";
    const coverageText = model.coverage
      ? `${dateKey(model.coverage.firstDate)} → ${dateKey(model.coverage.lastDate)}`
      : "暂无历史范围";

    let warning = "";
    if (model.incompleteStart) {
      warning = `<div class="notice">这个月前半段早于当前保留的历史，热力图只代表现有记录，不会把缺失数据冒充成 0。</div>`;
    } else if (model.outsideCoverage) {
      warning = `<div class="notice">所选月份不在当前 100 条历史记录的覆盖范围内。</div>`;
    }

    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0d1117">
<title>Plasma Heatmap</title>
<style>${css()}</style>
</head>
<body>
<main class="shell">
  <header class="top">
    <div><div class="eyebrow">PLASMA · REWARD ACTIVITY</div><h1>奖励热力图</h1><p>GitHub 风格 · 每个格子代表一天</p></div>
    <a class="back" href="http://plasma-dashboard.test/">Dashboard</a>
  </header>

  <section class="card summary">
    <div><span>本月新增</span><strong>${fixed(model.monthEarned)} <small>USDT</small></strong></div>
    <div><span>活跃天数</span><strong>${model.activeDays} <small>天</small></strong></div>
    <div><span>最强一天</span><strong>${bestText}</strong></div>
  </section>

  ${warning}

  <section class="card heat-card">
    <div class="month-head">
      <a href="/?month=${prev}" aria-label="上个月">‹</a>
      <div><h2>${monthName(selected)}</h2><p>历史覆盖：${esc(coverageText)}</p></div>
      <a href="/?month=${next}" aria-label="下个月">›</a>
    </div>

    <div class="heat-wrap">
      <div class="weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>
      <div class="heat" style="--weeks:${model.weeks}">${model.cells.join("")}</div>
    </div>

    <div class="legend"><span>少</span><i class="lv0"></i><i class="lv1"></i><i class="lv2"></i><i class="lv3"></i><i class="lv4"></i><span>多</span></div>
  </section>

  <section class="card detail" id="detail">
    <div class="detail-date">点一个格子看看</div>
    <div class="detail-main">当天新增奖励会显示在这里</div>
    <div class="detail-grid">
      <div><span>金额变化</span><strong>—</strong></div>
      <div><span>邀请返利</span><strong>—</strong></div>
      <div><span>消费返现</span><strong>—</strong></div>
      <div><span>净变化</span><strong>—</strong></div>
    </div>
  </section>

  <footer>只读取 Loon 本机 <code>${STORE_KEY}</code> · 不写入 · 不上传 · 实验分支</footer>
</main>
<script>
(() => {
  const cells = document.querySelectorAll('.cell:not(.blank)');
  const detail = document.getElementById('detail');
  cells.forEach(cell => cell.addEventListener('click', () => {
    cells.forEach(x => x.classList.remove('selected'));
    cell.classList.add('selected');
    const date = cell.dataset.date;
    const earned = cell.dataset.earned;
    const net = cell.dataset.net;
    const events = cell.dataset.events;
    const ref = cell.dataset.ref;
    const cash = cell.dataset.cash;
    detail.innerHTML = '<div class="detail-date">' + date + '</div>' +
      '<div class="detail-main">+' + earned + ' USDT</div>' +
      '<div class="detail-grid">' +
      '<div><span>金额变化</span><strong>' + events + ' 次</strong></div>' +
      '<div><span>邀请返利</span><strong>+' + ref + '</strong></div>' +
      '<div><span>消费返现</span><strong>+' + cash + '</strong></div>' +
      '<div><span>净变化</span><strong>' + (Number(net) > 0 ? '+' : '') + net + '</strong></div>' +
      '</div>';
    detail.scrollIntoView({behavior:'smooth',block:'nearest'});
  }));
})();
</script>
</body>
</html>`;
  }

  function css() {
    return `
:root{color-scheme:light dark;--bg:#f6f8fa;--card:#fff;--text:#1f2328;--muted:#656d76;--border:#d0d7de;--shadow:0 1px 0 rgba(27,31,36,.04);--lv0:#ebedf0;--lv1:#9be9a8;--lv2:#40c463;--lv3:#30a14e;--lv4:#216e39;--accent:#0969da;--notice:#fff8c5}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--card:#161b22;--text:#e6edf3;--muted:#8b949e;--border:#30363d;--shadow:none;--lv0:#161b22;--lv1:#0e4429;--lv2:#006d32;--lv3:#26a641;--lv4:#39d353;--accent:#58a6ff;--notice:#2d2a12}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;-webkit-font-smoothing:antialiased}.shell{width:min(100%,820px);margin:0 auto;padding:calc(22px + env(safe-area-inset-top)) 16px calc(34px + env(safe-area-inset-bottom))}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px}.eyebrow{font-size:11px;letter-spacing:1.4px;font-weight:800;color:var(--muted)}h1{font-size:30px;letter-spacing:-.8px;margin:4px 0 3px}.top p{margin:0;color:var(--muted);font-size:13px}.back{color:var(--accent);text-decoration:none;font-weight:700;font-size:13px;padding:9px 0}.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:14px;box-shadow:var(--shadow)}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.summary div{min-width:0}.summary span,.detail-grid span{display:block;color:var(--muted);font-size:12px;margin-bottom:6px}.summary strong{font-size:21px;letter-spacing:-.4px}.summary small{font-size:11px;color:var(--muted)}.notice{background:var(--notice);border:1px solid var(--border);border-radius:10px;padding:11px 13px;font-size:12px;line-height:1.5;margin-bottom:14px}.month-head{display:grid;grid-template-columns:44px 1fr 44px;align-items:center;text-align:center;margin-bottom:16px}.month-head>a{display:flex;height:38px;align-items:center;justify-content:center;text-decoration:none;color:var(--text);font-size:28px;border-radius:8px}.month-head>a:active{background:var(--lv0)}.month-head h2{font-size:19px;margin:0 0 3px}.month-head p{margin:0;color:var(--muted);font-size:11px}.heat-wrap{display:flex;gap:8px;align-items:flex-start;overflow-x:auto;padding:2px 0 6px}.weekdays{display:grid;grid-template-rows:repeat(7,14px);gap:4px;flex:0 0 18px}.weekdays span{font-size:9px;color:var(--muted);height:14px;display:flex;align-items:center}.heat{display:grid;grid-template-rows:repeat(7,14px);grid-auto-flow:column;grid-auto-columns:14px;gap:4px;min-width:max-content}.cell{width:14px;height:14px;border:0;border-radius:3px;padding:0;outline:1px solid rgba(27,31,36,.05);outline-offset:-1px}.cell.blank{background:transparent;outline:0}.cell.lv0,.legend .lv0{background:var(--lv0)}.cell.lv1,.legend .lv1{background:var(--lv1)}.cell.lv2,.legend .lv2{background:var(--lv2)}.cell.lv3,.legend .lv3{background:var(--lv3)}.cell.lv4,.legend .lv4{background:var(--lv4)}button.cell{cursor:pointer;-webkit-tap-highlight-color:transparent}.cell.selected{box-shadow:0 0 0 2px var(--text);outline:0}.legend{display:flex;justify-content:flex-end;align-items:center;gap:4px;margin-top:12px;color:var(--muted);font-size:10px}.legend i{width:11px;height:11px;border-radius:2px}.detail{min-height:148px}.detail-date{font-size:12px;color:var(--muted);margin-bottom:4px}.detail-main{font-size:30px;font-weight:800;letter-spacing:-.8px;margin-bottom:16px}.detail-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.detail-grid strong{font-size:15px}footer{text-align:center;color:var(--muted);font-size:10px;line-height:1.6;padding:6px 0}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.empty{text-align:center;padding:60px 20px}.mark{font-size:42px}.empty h1{font-size:23px}.empty p{color:var(--muted)}
@media(max-width:560px){.summary{grid-template-columns:1fr 1fr}.summary div:last-child{grid-column:1/-1}.detail-grid{grid-template-columns:1fr 1fr}.card{padding:15px}.heat-card{padding:15px 12px}.top h1{font-size:27px}}
`;
  }

  function respond(body, contentType = "text/html; charset=utf-8") {
    $done({response:{status:200,headers:{"Content-Type":contentType,"Cache-Control":"no-store"},body}});
  }

  try {
    const store = readStore();
    respond(page(store));
  } catch (e) {
    console.log(`[Plasma Heatmap] render error: ${e}`);
    respond(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><pre>Plasma Heatmap render error\n${esc(String(e))}</pre>`);
  }
})();
