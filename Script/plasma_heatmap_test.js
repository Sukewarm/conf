/*
 * Plasma Rewards Heatmap for Loon (experimental v6)
 * Horizontal monthly calendar heatmap. Read-only.
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

  function coverage(history) {
    if (!history.length) return null;
    var a = new Date(history[0].capturedAt);
    var b = new Date(history[history.length - 1].capturedAt);
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
    return {
      start: new Date(a.getFullYear(), a.getMonth(), a.getDate()),
      end: new Date(b.getFullYear(), b.getMonth(), b.getDate())
    };
  }

  function quantile(a, q) {
    if (!a.length) return 0;
    var p = (a.length - 1) * q;
    var i = Math.floor(p);
    var r = p - i;
    return a[i + 1] === undefined ? a[i] : a[i] + r * (a[i + 1] - a[i]);
  }

  function thresholdsForMonth(month, daily) {
    var y = month.getFullYear();
    var m = month.getMonth();
    var end = new Date(y, m + 1, 0).getDate();
    var a = [];
    for (var day = 1; day <= end; day++) {
      var info = daily[dateKey(new Date(y, m, day))];
      if (info && info.earned > 0) a.push(info.earned);
    }
    a.sort(function (x, y2) { return x - y2; });
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

  function monthModel(month, daily, cov) {
    var y = month.getFullYear();
    var m = month.getMonth();
    var first = new Date(y, m, 1);
    var last = new Date(y, m + 1, 0);
    var startDow = first.getDay();
    var thresholds = thresholdsForMonth(month, daily);
    var today = new Date();
    var todayKey = dateKey(today);
    var cells = [];
    var earned = 0;
    var active = 0;
    var best = null;
    var data = {};

    for (var blank = 0; blank < startDow; blank++) {
      cells.push('<span class="cell blank" aria-hidden="true"></span>');
    }

    for (var day = 1; day <= last.getDate(); day++) {
      var dt = new Date(y, m, day);
      var key = dateKey(dt);
      var info = daily[key] || { earned: 0, net: 0, events: 0, referral: 0, cashback: 0, pending: 0, accrued: 0, paid: 0 };
      var known = !!(cov && dt >= cov.start && dt <= cov.end);
      var future = dt > today;
      var lv = known ? level(info.earned, thresholds) : 0;
      var cls = "cell ";
      if (future) cls += "future";
      else if (!known) cls += "unknown";
      else cls += "l" + lv;
      if (key === todayKey) cls += " today";

      if (known) {
        data[key] = info;
        if (info.earned > 0) {
          earned += info.earned;
          active += 1;
          if (!best || info.earned > best.earned) best = { day: day, earned: info.earned };
        }
      }

      cells.push('<button class="' + cls + '" data-k="' + key + '" aria-label="' + key + '"><span>' + day + '</span></button>');
    }

    var trailing = (7 - ((startDow + last.getDate()) % 7)) % 7;
    for (var t = 0; t < trailing; t++) {
      cells.push('<span class="cell blank" aria-hidden="true"></span>');
    }

    return {
      cells: cells.join(""),
      earned: earned,
      active: active,
      best: best,
      data: data,
      partial: !!(cov && cov.start > first && cov.start <= last),
      outside: !!(cov && (last < cov.start || first > cov.end))
    };
  }

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function css() {
    return ':root{--page:#000;--panel:#0d1117;--text:#f0f6fc;--muted:#8b949e;--border:#30363d;--l0:#161b22;--l1:#0e4429;--l2:#006d32;--l3:#26a641;--l4:#39d353;--blue:#58a6ff}' +
      '*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--page);color:var(--text)}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}' +
      'a{color:var(--muted);text-decoration:none}.shell{width:min(100%,620px);margin:0 auto;padding:calc(22px + env(safe-area-inset-top)) 16px calc(28px + env(safe-area-inset-bottom))}' +
      '.top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px}.top h1{margin:0;font-size:20px;font-weight:600}.top p{margin:5px 0 0;font-size:12px;color:var(--muted)}.top a{font-size:12px;padding-top:3px}' +
      '.summary{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;margin-bottom:18px}.month{font-size:12px;color:var(--muted);font-weight:600;letter-spacing:.07em}.amount{margin-top:7px;font-size:clamp(32px,8vw,44px);line-height:1;font-weight:600;letter-spacing:-1.4px;white-space:nowrap;font-variant-numeric:tabular-nums}.amount small{font-size:12px;color:var(--muted);letter-spacing:0}.meta{margin-top:9px;font-size:12px;color:var(--muted);line-height:1.55}.meta b{color:#c9d1d9;font-weight:500}.nav{display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden;flex:none}.nav a{width:34px;height:32px;display:grid;place-items:center;background:var(--panel);color:var(--text);font-size:18px}.nav a+a{border-left:1px solid var(--border)}' +
      '.note{margin:0 0 12px;color:#d29922;font-size:11px}.panel{background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:15px}.panelhead{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:15px;font-size:12px}.panelhead span:last-child{font-size:10px;color:var(--muted)}' +
      '.week{display:grid;grid-template-columns:repeat(7,24px);gap:6px;width:max-content;margin:0 auto 7px;color:var(--muted);font-size:9px;text-align:center}.calendar{display:grid;grid-template-columns:repeat(7,24px);grid-auto-rows:24px;gap:6px;width:max-content;margin:0 auto}.cell,.legend i{width:24px;height:24px;border:1px solid rgba(240,246,252,.06);border-radius:3px;background:var(--l0);padding:0;appearance:none;-webkit-appearance:none;position:relative}.cell span{font-size:9px;color:rgba(240,246,252,.72);line-height:1}.blank{visibility:hidden}.unknown{background:#090d12;border-color:#111820}.future{background:#05070a;border-color:#0d1117;opacity:.45}.l0{background:var(--l0)}.l1{background:var(--l1)}.l2{background:var(--l2)}.l3{background:var(--l3);box-shadow:0 0 4px rgba(38,166,65,.28)}.l4{background:var(--l4);box-shadow:0 0 8px rgba(57,211,83,.52)}.today{outline:1px solid var(--blue);outline-offset:1px}.cell.selected{outline:1px solid #f0f6fc;outline-offset:1px}.legend{display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:13px;color:var(--muted);font-size:10px}.legend i{width:10px;height:10px;border-radius:2px}.legend .l3{box-shadow:0 0 3px rgba(38,166,65,.25)}.legend .l4{box-shadow:0 0 5px rgba(57,211,83,.42)}' +
      '.detail{margin-top:14px;background:#05070a;border:1px solid #21262d;border-radius:6px;padding:13px 14px}.detaildate{font-size:11px;color:var(--muted)}.detailvalue{margin-top:5px;font-size:19px;font-weight:600;font-variant-numeric:tabular-nums}.detailmeta{margin-top:7px;font-size:11px;line-height:1.6;color:var(--muted);overflow-wrap:anywhere}footer{margin-top:14px;color:#484f58;font-size:10px}' +
      '@media(max-width:420px){.shell{padding-left:14px;padding-right:14px}.amount{font-size:clamp(30px,9vw,38px)}.panel{padding:14px 10px}.calendar,.week{grid-template-columns:repeat(7,22px);gap:6px}.cell{width:22px;height:22px}.week{font-size:8px}.legend i{width:10px;height:10px}}';
  }

  function page(store) {
    if (!store || !store.last || !store.history || store.history.length < 2) {
      return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#000"><style>' + css() + '</style></head><body><main class="shell"><section class="detail">No captured history yet.</section></main></body></html>';
    }

    var selected = parseMonth(requestUrl);
    var daily = buildDaily(store.history);
    var cov = coverage(store.history);
    var model = monthModel(selected, daily, cov);
    var prev = monthKey(addMonths(selected, -1));
    var next = monthKey(addMonths(selected, 1));
    var best = model.best ? (monthShort(selected) + ' ' + pad2(model.best.day) + ' · +' + fixed(model.best.earned) + ' USDT') : 'No activity';
    var range = cov ? (dateKey(cov.start) + ' → ' + dateKey(cov.end)) : '—';
    var note = '';
    if (model.partial) note = '<div class="note">Partial data · 本月早期记录已超出当前 100 条历史范围。</div>';
    else if (model.outside) note = '<div class="note">Outside range · 当前历史没有覆盖这个月份。</div>';

    var dataJson = JSON.stringify(model.data).replace(/</g, '\\u003c');

    return '<!doctype html><html lang="zh-CN"><head>' +
      '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
      '<meta name="theme-color" content="#000000"><meta name="color-scheme" content="dark">' +
      '<title>Plasma Heatmap</title><style>' + css() + '</style></head><body><main class="shell">' +
      '<header class="top"><div><h1>Reward activity</h1><p>Local Tracker history · read only</p></div><a href="http://plasma-dashboard.test/">Dashboard</a></header>' +
      '<section class="summary"><div><div class="month">' + monthShort(selected).toUpperCase() + ' ' + selected.getFullYear() + '</div>' +
      '<div class="amount">+' + fixed(model.earned) + ' <small>USDT</small></div>' +
      '<div class="meta">' + model.active + ' active days · Best <b>' + esc(best) + '</b></div></div>' +
      '<div class="nav"><a href="/?month=' + prev + '">‹</a><a href="/?month=' + next + '">›</a></div></section>' +
      note +
      '<section class="panel"><div class="panelhead"><span>Daily reward heatmap</span><span>' + esc(range) + '</span></div>' +
      '<div class="week"><span>SUN</span><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span></div>' +
      '<div class="calendar">' + model.cells + '</div>' +
      '<div class="legend"><span>Less</span><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>More</span></div></section>' +
      '<section class="detail" id="detail"><div class="detaildate">Select a day</div><div class="detailvalue">—</div><div class="detailmeta">Tap a square to inspect that day.</div></section>' +
      '<footer>Stored locally in Loon · ' + STORE_KEY + '</footer></main>' +
      '<script>(function(){var DATA=' + dataJson + ';var cells=document.querySelectorAll(".cell:not(.blank)");var detail=document.getElementById("detail");for(var i=0;i<cells.length;i++){cells[i].onclick=function(){for(var j=0;j<cells.length;j++)cells[j].classList.remove("selected");this.classList.add("selected");var k=this.getAttribute("data-k");var d=DATA[k];if(!d){detail.innerHTML="<div class=\\"detaildate\\">"+k+"</div><div class=\\"detailvalue\\">No captured history</div><div class=\\"detailmeta\\">Outside saved coverage or no future data.</div>";return;}function f(v){var n=Number(v);return isFinite(n)?n.toFixed(4):"—"}function sg(v){var n=Number(v);return isFinite(n)?(n>0?"+":"")+n.toFixed(4):"—"}detail.innerHTML="<div class=\\"detaildate\\">"+k+"</div><div class=\\"detailvalue\\">+"+f(d.earned)+" USDT</div><div class=\\"detailmeta\\">"+d.events+" changes · Referral +"+f(d.referral)+" · Cashback +"+f(d.cashback)+" · Net "+sg(d.net)+" · Paid "+sg(d.paid)+"</div>";}}})();</script>' +
      '</body></html>';
  }

  function respond(body) {
    $done({ response: { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" }, body: body } });
  }

  respond(page(readStore()));
})();
