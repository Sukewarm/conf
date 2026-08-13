/**
 * Plasma Dashboard for Loon
 * Read-only local frontend for plasma_rewards_tracker_v1.
 * It never writes to persistentStore and never sends stored data anywhere.
 */
(() => {
  const STORE_KEY = "plasma_rewards_tracker_v1";
  const requestUrl = (typeof $request !== "undefined" && $request && $request.url) ? $request.url : "http://plasma-dashboard.test/";

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function fixed(v, digits = 4) {
    return num(v).toFixed(digits);
  }

  function signed(v, digits = 4) {
    const n = num(v);
    if (Math.abs(n) < 0.0000005) return "0.0000";
    return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeSnapshot(s) {
    if (!s || typeof s !== "object") return null;
    return {
      capturedAt: s.capturedAt || "",
      total: num(s.total),
      totalCashBack: num(s.totalCashBack),
      totalReferrals: num(s.totalReferrals),
      monthTotal: num(s.monthTotal),
      monthCashBack: num(s.monthCashBack),
      monthReferrals: num(s.monthReferrals),
      periodStart: s.periodStart || "",
      periodEnd: s.periodEnd || "",
      pending: num(s.pending),
      pendingLabel: s.pendingLabel || "Accruing",
      accrued: num(s.accrued),
      settlementLabel: s.settlementLabel || "Settlement",
      paid: num(s.paid),
      paidLabel: s.paidLabel || "Paid"
    };
  }

  function readStore() {
    try {
      const raw = $persistentStore.read(STORE_KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw);
      const history = Array.isArray(stored.history)
        ? stored.history.map(sanitizeSnapshot).filter(Boolean).slice(-100)
        : [];
      return {
        version: Number(stored.version || 0),
        first: sanitizeSnapshot(stored.first),
        previousChange: sanitizeSnapshot(stored.previousChange),
        last: sanitizeSnapshot(stored.last),
        history
      };
    } catch (e) {
      console.log(`[Plasma Dashboard] read error: ${e}`);
      return null;
    }
  }

  function localTime(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      });
    } catch (_) {
      return iso;
    }
  }

  function trendSvg(history) {
    const rows = Array.isArray(history) ? history.filter(x => x && Number.isFinite(num(x.total))) : [];
    if (rows.length < 2) {
      return '<div class="empty-small">至少需要 2 次金额变化后才会显示趋势。</div>';
    }

    const values = rows.map(x => num(x.total));
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const width = 720;
    const height = 220;
    const padX = 16;
    const padY = 18;
    const range = Math.max(max - min, 0.0001);
    const points = values.map((v, i) => {
      const x = padX + (i * (width - padX * 2)) / Math.max(values.length - 1, 1);
      const y = height - padY - ((v - min) / range) * (height - padY * 2);
      return [x, y];
    });
    const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    const last = points[points.length - 1];
    return `
      <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="累计奖励趋势">
        <line x1="16" y1="202" x2="704" y2="202" class="axis" />
        <path d="${path}" class="line" />
        <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="5" class="dot" />
      </svg>
      <div class="chart-meta"><span>最低 ${fixed(min)}</span><span>最高 ${fixed(max)}</span><span>${values.length} 个变化点</span></div>`;
  }

  function historyHtml(history) {
    if (!Array.isArray(history) || history.length === 0) {
      return '<div class="empty-small">还没有金额变化历史。</div>';
    }
    const start = Math.max(0, history.length - 20);
    const rows = [];
    for (let i = history.length - 1; i >= start; i--) {
      const cur = history[i];
      const prev = i > 0 ? history[i - 1] : null;
      const totalDelta = prev ? cur.total - prev.total : 0;
      const pendingDelta = prev ? cur.pending - prev.pending : 0;
      const accruedDelta = prev ? cur.accrued - prev.accrued : 0;
      const paidDelta = prev ? cur.paid - prev.paid : 0;
      rows.push(`
        <tr>
          <td class="time">${esc(localTime(cur.capturedAt))}</td>
          <td><strong>${fixed(cur.total)}</strong><small>${prev ? esc(signed(totalDelta)) : "起点"}</small></td>
          <td>${fixed(cur.pending)}<small>${prev ? esc(signed(pendingDelta)) : "—"}</small></td>
          <td>${fixed(cur.accrued)}<small>${prev ? esc(signed(accruedDelta)) : "—"}</small></td>
          <td>${fixed(cur.paid)}<small>${prev ? esc(signed(paidDelta)) : "—"}</small></td>
        </tr>`);
    }
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>时间</th><th>累计</th><th>Accruing</th><th>结算</th><th>Paid</th></tr></thead>
          <tbody>${rows.join("")}</tbody>
        </table>
      </div>`;
  }

  function page(store) {
    if (!store || !store.last) {
      return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Plasma Dashboard</title>
<style>${baseCss()}</style></head><body><main class="shell"><section class="empty"><div class="logo">P</div><h1>还没有可显示的数据</h1><p>先启用 Plasma Rewards Tracker，然后打开 Plasma One，让 <code>primaryCashBack</code> 至少成功抓取一次。</p><button onclick="location.reload()">重新读取</button></section></main></body></html>`;
    }

    const s = store.last;
    const first = store.first || s;
    const unpaid = s.pending + s.accrued;
    const sinceFirst = s.total - first.total;
    const hist = store.history || [];
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<title>Plasma Dashboard</title>
<style>${baseCss()}</style>
</head>
<body>
<main class="shell">
  <header class="topbar">
    <div><div class="eyebrow">LOCAL · READ ONLY</div><h1>Plasma Dashboard</h1><p>最后金额变化：${esc(localTime(s.capturedAt))}</p></div>
    <button class="refresh" onclick="location.reload()">刷新</button>
  </header>

  <section class="hero card">
    <div><div class="label">累计奖励</div><div class="hero-value">${fixed(s.total)} <span>USDT</span></div></div>
    <div class="since"><span>统计起点以来</span><strong class="${sinceFirst >= 0 ? "positive" : "negative"}">${esc(signed(sinceFirst))} USDT</strong></div>
  </section>

  <section class="grid three">
    <article class="card metric"><div class="label">${esc(s.pendingLabel)}</div><div class="value">${fixed(s.pending)}</div><div class="unit">USDT</div></article>
    <article class="card metric"><div class="label">${esc(s.settlementLabel)}</div><div class="value">${fixed(s.accrued)}</div><div class="unit">USDT</div></article>
    <article class="card metric"><div class="label">${esc(s.paidLabel)}</div><div class="value">${fixed(s.paid)}</div><div class="unit">USDT</div></article>
  </section>

  <section class="card unpaid"><div><div class="label">未支付</div><div class="value">${fixed(unpaid)} <span>USDT</span></div></div><div class="formula">${fixed(s.pending)} + ${fixed(s.accrued)}</div></section>

  <section class="card">
    <div class="section-head"><div><div class="label">本月奖励</div><h2>${fixed(s.monthTotal)} USDT</h2></div><div class="period">${esc(s.periodStart || "—")} → ${esc(s.periodEnd || "—")}</div></div>
    <div class="month-grid"><div><span>邀请返利</span><strong>${fixed(s.monthReferrals)}</strong></div><div><span>消费返现</span><strong>${fixed(s.monthCashBack)}</strong></div></div>
  </section>

  <section class="card">
    <div class="section-head"><div><div class="label">累计奖励趋势</div><h2>最近 ${hist.length} 次金额变化</h2></div></div>
    ${trendSvg(hist)}
  </section>

  <section class="card history">
    <div class="section-head"><div><div class="label">变化记录</div><h2>最近 20 条</h2></div><a href="/api">JSON API</a></div>
    ${historyHtml(hist)}
  </section>

  <footer>数据直接读取自 Loon 本机 <code>${STORE_KEY}</code>。此插件不写入、不上传。</footer>
</main>
</body>
</html>`;
  }

  function baseCss() {
    return `
:root{color-scheme:light dark;--bg:#f4f5f7;--card:rgba(255,255,255,.88);--text:#121316;--muted:#737780;--line:rgba(0,0,0,.08);--soft:#eceef2;--accent:#6d4aff;--positive:#128a52;--negative:#c43d4f;--shadow:0 12px 32px rgba(20,23,31,.07)}
@media(prefers-color-scheme:dark){:root{--bg:#0b0c0f;--card:rgba(25,27,32,.92);--text:#f4f5f8;--muted:#999eaa;--line:rgba(255,255,255,.09);--soft:#20232a;--accent:#9a84ff;--positive:#56d58e;--negative:#ff7788;--shadow:none}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text",system-ui,sans-serif;-webkit-font-smoothing:antialiased}button,a{font:inherit}.shell{width:min(100%,980px);margin:0 auto;padding:calc(22px + env(safe-area-inset-top)) 16px calc(32px + env(safe-area-inset-bottom))}.topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:18px}.topbar h1{font-size:30px;letter-spacing:-.9px;margin:2px 0 4px}.topbar p,.eyebrow{margin:0;color:var(--muted);font-size:13px}.eyebrow{font-size:11px;font-weight:800;letter-spacing:1.4px}.refresh,.empty button{border:0;background:var(--text);color:var(--bg);padding:10px 14px;border-radius:12px;font-weight:700;cursor:pointer}.card{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:20px;box-shadow:var(--shadow);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);margin-bottom:14px}.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding:24px}.label{color:var(--muted);font-size:13px;font-weight:700}.hero-value{font-size:43px;line-height:1.08;letter-spacing:-1.8px;font-weight:800;margin-top:7px}.hero-value span,.unpaid .value span{font-size:14px;letter-spacing:0;color:var(--muted);font-weight:700}.since{text-align:right;display:flex;flex-direction:column;gap:5px;color:var(--muted);font-size:12px}.since strong{font-size:18px}.positive{color:var(--positive)!important}.negative{color:var(--negative)!important}.grid{display:grid;gap:14px}.grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}.metric{margin:0}.metric .value{font-size:27px;font-weight:800;letter-spacing:-.7px;margin-top:9px}.unit{color:var(--muted);font-size:11px;margin-top:2px}.unpaid{display:flex;align-items:center;justify-content:space-between}.unpaid .value{font-size:31px;font-weight:800;margin-top:5px}.formula{font-variant-numeric:tabular-nums;color:var(--muted);font-size:13px}.section-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:14px}.section-head h2{font-size:21px;margin:4px 0 0;letter-spacing:-.45px}.section-head a{color:var(--accent);text-decoration:none;font-size:13px;font-weight:700}.period{color:var(--muted);font-size:12px}.month-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.month-grid>div{background:var(--soft);padding:14px;border-radius:15px;display:flex;align-items:center;justify-content:space-between}.month-grid span{color:var(--muted);font-size:13px}.month-grid strong{font-size:18px}.chart{width:100%;height:auto;display:block;overflow:visible}.axis{stroke:var(--line);stroke-width:1}.line{fill:none;stroke:var(--accent);stroke-width:4;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}.dot{fill:var(--accent)}.chart-meta{display:flex;justify-content:space-between;color:var(--muted);font-size:11px;margin-top:4px}.table-wrap{overflow:auto;margin:0 -4px -2px;padding:0 4px 2px}table{border-collapse:collapse;width:100%;min-width:690px;font-variant-numeric:tabular-nums}th,td{text-align:right;padding:12px 9px;border-bottom:1px solid var(--line);font-size:13px}th:first-child,td:first-child{text-align:left}th{color:var(--muted);font-size:11px}td small{display:block;color:var(--muted);font-size:10px;margin-top:3px}.time{color:var(--muted);white-space:nowrap}.empty-small{padding:26px 4px;text-align:center;color:var(--muted);font-size:13px}.empty{min-height:70vh;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}.empty .logo{width:58px;height:58px;border-radius:18px;background:var(--text);color:var(--bg);display:grid;place-items:center;font-size:28px;font-weight:900}.empty h1{margin:18px 0 8px}.empty p{max-width:520px;color:var(--muted);line-height:1.6}.empty button{margin-top:10px}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}footer{text-align:center;color:var(--muted);font-size:11px;padding:10px 0 0}
@media(max-width:680px){.shell{padding-left:12px;padding-right:12px}.topbar h1{font-size:27px}.hero{align-items:flex-start;flex-direction:column}.since{text-align:left}.hero-value{font-size:37px}.grid.three{grid-template-columns:1fr}.metric{display:grid;grid-template-columns:1fr auto;align-items:center}.metric .label{grid-column:1}.metric .value{grid-column:2;grid-row:1/3;margin:0}.metric .unit{grid-column:1}.unpaid{align-items:flex-start;flex-direction:column;gap:8px}.month-grid{grid-template-columns:1fr}.section-head{align-items:flex-start;flex-direction:column}.period{margin-top:-8px}}
`;
  }

  function respond(status, contentType, body) {
    $done({
      response: {
        status,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Pragma": "no-cache",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;"
        },
        body
      }
    });
  }

  try {
    const u = new URL(requestUrl);
    if (u.pathname === "/favicon.ico") {
      $done({ response: { status: 204, headers: { "Cache-Control": "no-store" }, body: "" } });
      return;
    }

    const store = readStore();
    if (u.pathname === "/api" || u.pathname === "/api/") {
      respond(200, "application/json; charset=utf-8", JSON.stringify({
        ok: !!(store && store.last),
        source: STORE_KEY,
        readOnly: true,
        data: store
      }, null, 2));
      return;
    }

    respond(200, "text/html; charset=utf-8", page(store));
  } catch (e) {
    console.log(`[Plasma Dashboard] fatal error: ${e}`);
    respond(500, "text/plain; charset=utf-8", `Plasma Dashboard error: ${String(e)}`);
  }
})();
