/*
 * Plasma Rewards Heatmap for Loon (experimental v5)
 * Lightweight GitHub-contribution-style UI. Read-only.
 */
(function () {
  var STORE_KEY = "plasma_rewards_tracker_v1";
  var requestUrl = (typeof $request !== "undefined" && $request && $request.url)
    ? $request.url
    : "http://plasma-heatmap.test/";

  function num(v) {
    var x = Number(v);
    return isFinite(x) ? x : null;
  }

  function fixed(v, digits) {
    var x = num(v);
    return x === null ? "—" : x.toFixed(digits == null ? 4 : digits);
  }

  function snap(v) {
    if (!v || typeof v !== "object" || !v.capturedAt) return null;
    var total = num(v.total);
    if (total === null) return null;
    return {
      capturedAt: String(v.capturedAt),
      total: total,
      pending: num(v.pending) === null ? 0 : num(v.pending),
      accrued: num(v.accrued) === null ? 0 : num(v.accrued),
      paid: num(v.paid) === null ? 0 : num(v.paid),
      totalReferrals: num(v.totalReferrals) === null ? 0 : num(v.totalReferrals),
      totalCashBack: num(v.totalCashBack) === null ? 0 : num(v.totalCashBack)
    };
  }

  function readStore() {
    try {
      var raw = $persistentStore.read(STORE_KEY);
      if (!raw) return null;
      var stored = JSON.parse(raw);
      var list = Array.isArray(stored.history) ? stored.history : [];
      var history = [];
      for (var i = 0; i < list.length; i++) {
        var row = snap(list[i]);
        if (row) history.push(row);
      }
      history.sort(function (a, b) {
        return new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime();
      });
      if (history.length > 100) history = history.slice(history.length - 100);
      return { last: snap(stored.last), history: history };
    } catch (e) {
      console.log("[Plasma Heatmap] read error: " + e);
      return null;
    }
  }

  function pad2(v) {
    v = String(v);
    return v.length < 2 ? "0" + v : v;
  }

  function dateKey(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function monthKey(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }

  function monthShort(d) {
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  }

  function addMonths(d, n) {
    return new Date(d.getFullYear(), d.getMonth() + n, 1);
  }

  function parseMonth(url) {
    var m = String(url || "").match(/[?&]month=(\d{4})-(\d{2})(?:&|$)/);
    if (m) {
      var y = Number(m[1]);
      var mon = Number(m[2]);
      if (y >= 2000 && y <= 2200 && mon >= 1 && mon <= 12) return new Date(y, mon - 1, 1);
    }
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  function buildDaily(history) {
    var out = {};
    for (var i = 1; i < history.length; i++) {
      var prev = history[i - 1];
      var cur = history[i];
      var when = new Date(cur.capturedAt);
      if (isNaN(when.getTime())) continue;
      var key = dateKey(when);
      if (!out[key]) {
        out[key] = { earned: 0, net: 0, events: 0, referral: 0, cashback: 0, pending: 0, accrued: 0, paid: 0 };
      }
      var d = out[key];
      var td = cur.total - prev.total;
      var rd = cur.totalReferrals - prev.totalReferrals;
      var cd = cur.totalCashBack - prev.totalCashBack;
      d.events += 1;
      d.net += td;
      d.pending += cur.pending - prev.pending;
      d.accrued += cur.accrued - prev.accrued;
      d.paid += cur.paid - prev.paid;
      if (td > 0) d.earned += td;
      if (rd > 0) d.referral += rd;
      if (cd > 0) d.cashback += cd;
    }
    return out;
  }

  function quantile(a, q) {
    if (!a.length) return 0;
    var p = (a.length - 1) * q;
    var i = Math.floor(p);
    var r = p - i;
    return a[i + 1] === undefined ? a[i] : a[i] + r * (a[i + 1] - a[i]);
  }

  function thresholds(daily, year) {
    var a = [];
    for (var k in daily) {
      if (Object.prototype.hasOwnProperty.call(daily, k) && k.indexOf(String(year) + "-") === 0 && daily[k].earned > 0) {
        a.push(daily[k].earned);
      }
    }
    a.sort(function (x, y) { return x - y; });
    if (!a.length) return [0, 0, 0];
    return [quantile(a, .25), quantile(a, .5), quantile(a, .75)];
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
    var a = new Date(history[0].capturedAt);
    var b = new Date(history[history.length - 1].capturedAt);
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
    return { start: new Date(a.getFullYear(), a.getMonth(), a.getDate()), end: new Date(b.getFullYear(), b.getMonth(), b.getDate()) };
  }

  function monthStats(month, daily, cov) {
    var y = month.getFullYear();
    var m = month.getMonth();
    var start = new Date(y, m, 1);
    var end = new Date(y, m + 1, 0);
    var earned = 0;
    var active = 0;
    var best = null;
    for (var day = 1; day <= end.getDate(); day++) {
      var key = dateKey(new Date(y, m, day));
      var info = daily[key];
      if (info && info.earned > 0) {
        earned += info.earned;
        active += 1;
        if (!best || info.earned > best.earned) best = { day: day, earned: info.earned };
      }
    }
    return {
      earned: earned,
      active: active,
      best: best,
      partial: !!(cov && cov.start > start && cov.start <= end),
      outside: !!(cov && (end < cov.start || start > cov.end))
    };
  }

  function yearGraph(year, selectedMonth, daily, cov) {
    var jan = new Date(year, 0, 1);
    var dec = new Date(year, 11, 31);
    var start = new Date(jan);
    start.setDate(start.getDate() - start.getDay());
    var end = new Date(dec);
    end.setDate(end.getDate() + (6 - end.getDay()));
    var t = thresholds(daily, year);
    var totalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    var weeks = Math.ceil(totalDays / 7);
    var cells = [];
    var today = dateKey(new Date());
    var selected = monthKey(selectedMonth);

    for (var i = 0; i < totalDays; i++) {
      var d = new Date(start);
      d.setDate(start.getDate() + i);
      if (d.getFullYear() !== year) {
        cells.push('<span class="c blank"></span>');
        continue;
      }
      var key = dateKey(d);
      var info = daily[key] || { earned: 0 };
      var known = !!(cov && d >= cov.start && d <= cov.end);
      var lv = known ? level(info.earned || 0, t) : 0;
      var cls = "c " + (known ? ("l" + lv) : "unknown");
      if (key === today) cls += " today";
      cells.push('<button class="' + cls + '" data-k="' + key + '"></button>');
    }

    var labels = [];
    for (var mon = 0; mon < 12; mon++) {
      var first = new Date(year, mon, 1);
      var diff = Math.floor((first.getTime() - start.getTime()) / 86400000);
      var col = Math.floor(diff / 7) + 1;
      var mk = monthKey(first);
      labels.push('<span class="ml' + (mk === selected ? ' selected-month' : '') + '" data-m="' + mk + '" style="grid-column:' + col + ' / span 4">' + monthShort(first) + '</span>');
    }
    return { weeks: weeks, cells: cells.join(""), labels: labels.join("") };
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function css() {
    return ':root{--page:#000;--panel:#0d1117;--text:#f0f6fc;--muted:#8b949e;--border:#30363d;--l0:#161b22;--l1:#0e4429;--l2:#006d32;--l3:#26a641;--l4:#39d353;--blue:#58a6ff}' +
      '*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--page);color:var(--text)}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}' +
      'a{color:var(--muted);text-decoration:none}.shell{width:min(100%,920px);margin:auto;padding:calc(22px + env(safe-area-inset-top)) 16px calc(28px + env(safe-area-inset-bottom))}' +
      '.top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px}.top h1{margin:0;font-size:20px;font-weight:600}.top p{margin:5px 0 0;font-size:12px;color:var(--muted)}.top a{font-size:12px;padding-top:3px}' +
      '.summary{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-bottom:18px}.summary .copy{min-width:0}.month{font-size:12px;color:var(--muted);font-weight:600;letter-spacing:.06em}.amount{margin-top:7px;font-size:clamp(32px,8vw,44px);line-height:1;font-weight:600;letter-spacing:-1.4px;font-variant-numeric:tabular-nums;white-space:nowrap}.amount small{font-size:12px;color:var(--muted);letter-spacing:0}.meta{margin-top:10px;font-size:12px;color:var(--muted);line-height:1.55;overflow-wrap:anywhere}.meta b{color:#c9d1d9;font-weight:500}.nav{display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden;flex:none}.nav a{width:34px;height:32px;display:grid;place-items:center;background:var(--panel);color:var(--text);font-size:18px}.nav a+a{border-left:1px solid var(--border)}' +
      '.note{margin:0 0 12px;color:#d29922;font-size:11px}.panel{background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:14px}.panelhead{display:flex;justify-content:space-between;gap:12px;font-size:12px;margin-bottom:10px}.range{font-size:10px;color:var(--muted);font-variant-numeric:tabular-nums}.scroll{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;padding-bottom:4px}.inner{display:grid;grid-template-columns:28px max-content;gap:8px;width:max-content}.days{padding-top:18px;display:grid;grid-template-rows:repeat(7,11px);row-gap:3px;font-size:9px;color:var(--muted);line-height:11px;text-align:right}.main{width:max-content}.months{height:18px;display:grid;grid-template-columns:repeat(var(--weeks),11px);column-gap:3px;font-size:9px;color:var(--muted);line-height:11px}.ml{white-space:nowrap}.selected-month{color:#f0f6fc}.cells{display:grid;grid-template-rows:repeat(7,11px);grid-auto-flow:column;grid-auto-columns:11px;gap:3px}.c,.legend i{width:11px;height:11px;border:1px solid rgba(240,246,252,.05);border-radius:2px;background:var(--l0);padding:0;appearance:none;-webkit-appearance:none}.blank{visibility:hidden}.unknown{background:#090d12;border-color:#111820;opacity:.48}.l0{background:var(--l0)}.l1{background:var(--l1)}.l2{background:var(--l2)}.l3{background:var(--l3);box-shadow:0 0 3px rgba(38,166,65,.25)}.l4{background:var(--l4);box-shadow:0 0 6px rgba(57,211,83,.45)}.today{outline:1px solid var(--blue);outline-offset:1px}.c.selected{outline:1px solid #f0f6fc;outline-offset:1px}.legend{display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:10px;font-size:10px;color:var(--muted)}' +
      '.detail{margin-top:14px;background:#05070a;border:1px solid #21262d;border-radius:6px;padding:13px 14px}.detaildate{font-size:11px;color:var(--muted)}.detailvalue{margin-top:5px;font-size:19px;font-weight:600;font-variant-numeric:tabular-nums}.detailmeta{margin-top:7px;font-size:11px;line-height:1.6;color:var(--muted);overflow-wrap:anywhere}footer{margin-top:14px;color:#484f58;font-size:10px}' +
      '@media(max-width:560px){.shell{padding-left:14px;padding-right:14px}.summary{align-items:flex-start}.amount{font-size:clamp(30px,9vw,38px)}.panel{padding:12px 10px}.panelhead{flex-direction:column;gap:4px}}';
  }

  function page(store) {
    if (!store || !store.last || !store.history || store.history.length < 2) {
      return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#000"><style>' + css() + '</style></head><body><main class="shell"><div class="detail">No captured history yet.</div></main></body></html>';
    }
    var selected = parseMonth(requestUrl);
    var daily = buildDaily(store.history);
    var cov = coverage(store.history);
    var stats = monthStats(selected, daily, cov);
    var graph = yearGraph(selected.getFullYear(), selected, daily, cov);
    var prev = monthKey(addMonths(selected, -1));
    var next = monthKey(addMonths(selected, 1));
    var best = stats.best ? (monthShort(selected) + ' ' + pad2(stats.best.day) + ' · <b>+' + fixed(stats.best.earned) + ' USDT</b>') : 'No activity';
    var range = cov ? dateKey(cov.start) + ' → ' + dateKey(cov.end) : '—';
    var note = stats.partial ? '<div class="note">Partial month: earlier saved history has already rolled off.</div>' : (stats.outside ? '<div class="note">Selected month is outside the saved history range.</div>' : '');
    var yearData = {};
    for (var k in daily) {
      if (Object.prototype.hasOwnProperty.call(daily, k) && k.indexOf(String(selected.getFullYear()) + '-') === 0) yearData[k] = daily[k];
    }
    var dataJson = JSON.stringify(yearData);
    var covStart = cov ? dateKey(cov.start) : '';
    var covEnd = cov ? dateKey(cov.end) : '';

    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#000000"><meta name="color-scheme" content="dark"><title>Plasma Heatmap</title><style>' + css() + '</style></head><body><main class="shell">' +
      '<header class="top"><div><h1>Reward activity</h1><p>Local Tracker history · read only</p></div><a href="http://plasma-dashboard.test/">Dashboard</a></header>' +
      '<section class="summary"><div class="copy"><div class="month">' + monthShort(selected).toUpperCase() + ' ' + selected.getFullYear() + '</div><div class="amount">+' + fixed(stats.earned) + ' <small>USDT</small></div><div class="meta">' + stats.active + ' active days · Best ' + best + '</div></div><div class="nav"><a href="/?month=' + prev + '">‹</a><a href="/?month=' + next + '">›</a></div></section>' +
      note +
      '<section class="panel"><div class="panelhead"><span>' + selected.getFullYear() + ' reward activity</span><span class="range">' + esc(range) + '</span></div><div class="scroll" id="sc"><div class="inner" style="--weeks:' + graph.weeks + '"><div class="days"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div><div class="main"><div class="months">' + graph.labels + '</div><div class="cells">' + graph.cells + '</div></div></div></div><div class="legend"><span>Less</span><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>More</span></div></section>' +
      '<section class="detail" id="detail"><div class="detaildate">Select a day</div><div class="detailvalue">—</div><div class="detailmeta">Tap a square to inspect that day.</div></section><footer>Stored locally in Loon · ' + STORE_KEY + '</footer></main>' +
      '<script>(function(){var DATA=' + dataJson + ';var START=' + JSON.stringify(covStart) + ';var END=' + JSON.stringify(covEnd) + ';var cells=document.querySelectorAll(".c:not(.blank)");var detail=document.getElementById("detail");for(var i=0;i<cells.length;i++){cells[i].onclick=function(){for(var j=0;j<cells.length;j++)cells[j].classList.remove("selected");this.classList.add("selected");var k=this.getAttribute("data-k");if(!START||k<START||k>END){detail.innerHTML="<div class=\"detaildate\">"+k+"</div><div class=\"detailvalue\">No captured history</div><div class=\"detailmeta\">Outside saved coverage.</div>";return;}var d=DATA[k]||{earned:0,events:0,referral:0,cashback:0,net:0,paid:0};function f(v){var n=Number(v);return isFinite(n)?n.toFixed(4):"—"}function sg(v){var n=Number(v);return isFinite(n)?(n>0?"+":"")+n.toFixed(4):"—"}detail.innerHTML="<div class=\"detaildate\">"+k+"</div><div class=\"detailvalue\">+"+f(d.earned)+" USDT</div><div class=\"detailmeta\">"+d.events+" changes · Referral +"+f(d.referral)+" · Cashback +"+f(d.cashback)+" · Net "+sg(d.net)+" · Paid "+sg(d.paid)+"</div>";}}var sc=document.getElementById("sc");var target=document.querySelector(".ml[data-m=\"' + monthKey(selected) + '\"]");if(sc&&target){setTimeout(function(){sc.scrollLeft=Math.max(0,target.offsetLeft-55)},0)}})();</script></body></html>';
  }

  function respond(body) {
    $done({ response: { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" }, body: body } });
  }

  respond(page(readStore()));
})();