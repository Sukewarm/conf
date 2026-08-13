/*
 * Plasma Rewards Heatmap for Loon (experimental v7)
 * Rebuilt horizontal reward activity strip. Read-only.
 */
(function () {
  var STORE_KEY = "plasma_rewards_tracker_v1";
  var requestUrl = (typeof $request !== "undefined" && $request && $request.url)
    ? $request.url
    : "http://plasma-heatmap.test/";

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function fixed(v, digits) {
    var n = num(v);
    return n === null ? "—" : n.toFixed(digits == null ? 4 : digits);
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
      if (y >= 2000 && y <= 2200 && mon >= 1 && mon <= 12) {
        return new Date(y, mon - 1, 1);
      }
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
      var input = Array.isArray(stored.history) ? stored.history : [];
      var history = [];
      for (var i = 0; i < input.length; i++) {
        var row = snap(input[i]);
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
        out[key] = {
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
      var d = out[key];
      var totalDelta = cur.total - prev.total;
      var referralDelta = cur.totalReferrals - prev.totalReferrals;
      var cashbackDelta = cur.totalCashBack - prev.totalCashBack;

      d.events += 1;
      d.net += totalDelta;
      d.pending += cur.pending - prev.pending;
      d.accrued += cur.accrued - prev.accrued;
      d.paid += cur.paid - prev.paid;
      if (totalDelta > 0) d.earned += totalDelta;
      if (referralDelta > 0) d.referral += referralDelta;
      if (cashbackDelta > 0) d.cashback += cashbackDelta;
    }
    return out;
  }

  function coverage(history) {
    if (!history.length) return null;
    var first = new Date(history[0].capturedAt);
    var last = new Date(history[history.length - 1].capturedAt);
    if (isNaN(first.getTime()) || isNaN(last.getTime())) return null;
    return {
      start: new Date(first.getFullYear(), first.getMonth(), first.getDate()),
      end: new Date(last.getFullYear(), last.getMonth(), last.getDate())
    };
  }

  function quantile(values, q) {
    if (!values.length) return 0;
    var p = (values.length - 1) * q;
    var i = Math.floor(p);
    var r = p - i;
    return values[i + 1] === undefined ? values[i] : values[i] + r * (values[i + 1] - values[i]);
  }

  function thresholds(month, daily) {
    var values = [];
    var y = month.getFullYear();
    var m = month.getMonth();
    var end = new Date(y, m + 1, 0).getDate();
    for (var day = 1; day <= end; day++) {
      var info = daily[dateKey(new Date(y, m, day))];
      if (info && info.earned > 0) values.push(info.earned);
    }
    values.sort(function (a, b) { return a - b; });
    if (!values.length) return [0, 0, 0];
    return [quantile(values, 0.25), quantile(values, 0.50), quantile(values, 0.75)];
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
    var today = new Date();
    var todayKey = dateKey(today);
    var t = thresholds(month, daily);
    var cells = [];
    var labels = [];
    var data = {};
    var earned = 0;
    var active = 0;
    var best = null;

    for (var day = 1; day <= last.getDate(); day++) {
      var dt = new Date(y, m, day);
      var key = dateKey(dt);
      var info = daily[key] || {
        earned: 0, net: 0, events: 0, referral: 0, cashback: 0,
        pending: 0, accrued: 0, paid: 0
      };
      var known = !!(cov && dt >= cov.start && dt <= cov.end);
      var future = dt > today;
      var lv = known ? level(info.earned, t) : 0;
      var cls = "heat-cell ";
      if (future) cls += "future";
      else if (!known) cls += "unknown";
      else cls += "lv" + lv;
      if (key === todayKey) cls += " today";

      if (known) {
        data[key] = info;
        if (info.earned > 0) {
          earned += info.earned;
          active += 1;
          if (!best || info.earned > best.earned) best = { day: day, earned: info.earned };
        }
      }

      cells.push(
        '<button class="' + cls + '" data-k="' + key + '" style="--i:' + (day - 1) + '" aria-label="' + key + '"></button>'
      );

      var showLabel = day === 1 || day === last.getDate() || day % 5 === 0;
      labels.push('<span class="day-label' + (showLabel ? '' : ' ghost') + '">' + (showLabel ? day : '·') + '</span>');
    }

    return {
      cells: cells.join(""),
      labels: labels.join(""),
      data: data,
      earned: earned,
      active: active,
      best: best,
      days: last.getDate(),
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
    return ':root{--page:#000;--panel:#0b0f14;--text:#f0f6fc;--muted:#7d8590;--muted2:#484f58;--border:#21262d;--border2:#30363d;--lv0:#161b22;--lv1:#0e4429;--lv2:#006d32;--lv3:#26a641;--lv4:#39d353;--blue:#58a6ff}' +
      '*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--page);color:var(--text)}body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}' +
      'a{color:inherit;text-decoration:none}.shell{width:min(100%,760px);margin:0 auto;padding:calc(24px + env(safe-area-inset-top)) 16px calc(28px + env(safe-area-inset-bottom));opacity:0;transform:translateY(7px);animation:pageIn .48s cubic-bezier(.2,.75,.2,1) forwards}' +
      '.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:26px}.brand{font-size:12px;letter-spacing:.13em;font-weight:650;color:#c9d1d9}.dash{font-size:11px;color:var(--muted);transition:color .2s ease}.dash:active{color:var(--text)}' +
      '.stage{border:1px solid var(--border2);border-radius:10px;background:var(--panel);overflow:hidden}' +
      '.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;padding:19px 20px 17px}.hero-copy{min-width:0}.month{font-size:11px;letter-spacing:.12em;color:var(--muted);font-weight:650}.amount{margin-top:7px;font-size:clamp(34px,8.8vw,48px);line-height:.98;font-weight:650;letter-spacing:-1.7px;white-space:nowrap;font-variant-numeric:tabular-nums}.amount small{font-size:12px;color:var(--muted);letter-spacing:0;font-weight:550}.subline{margin-top:10px;font-size:11px;line-height:1.5;color:var(--muted);white-space:nowrap;overflow-x:auto;scrollbar-width:none}.subline::-webkit-scrollbar{display:none}.subline b{color:#c9d1d9;font-weight:550}' +
      '.nav{display:flex;flex:none;border:1px solid var(--border2);border-radius:7px;overflow:hidden;background:#0d1117}.nav a{width:36px;height:34px;display:grid;place-items:center;font-size:18px;color:#c9d1d9;transition:background .18s ease,color .18s ease,transform .18s ease}.nav a+a{border-left:1px solid var(--border2)}.nav a:active{background:#161b22;transform:scale(.94)}' +
      '.divider{height:1px;background:var(--border)}.activity{padding:17px 20px 16px}.activity-head{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:13px}.activity-head span:first-child{font-size:12px;font-weight:600}.coverage{font-size:10px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}' +
      '.heat-scroll{overflow-x:auto;overflow-y:visible;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:5px 2px 7px}.heat-scroll::-webkit-scrollbar{display:none}.heat-wrap{width:max-content;min-width:100%}.heat-row,.label-row{display:grid;grid-auto-flow:column;grid-auto-columns:12px;gap:4px;width:max-content}.heat-cell{width:12px;height:12px;padding:0;border:1px solid rgba(240,246,252,.055);border-radius:2px;background:var(--lv0);appearance:none;-webkit-appearance:none;opacity:0;transform:translateY(5px) scale(.86);animation:cellIn .34s cubic-bezier(.2,.9,.3,1) forwards;animation-delay:calc(90ms + var(--i) * 13ms);transition:transform .18s cubic-bezier(.2,.8,.2,1),box-shadow .18s ease,outline-color .18s ease,filter .18s ease}.heat-cell.lv0{background:var(--lv0)}.heat-cell.lv1{background:var(--lv1)}.heat-cell.lv2{background:var(--lv2)}.heat-cell.lv3{background:var(--lv3);box-shadow:0 0 4px rgba(38,166,65,.22)}.heat-cell.lv4{background:var(--lv4);box-shadow:0 0 7px rgba(57,211,83,.42)}.heat-cell.unknown{background:#090d12;border-color:#111820;opacity:.58}.heat-cell.future{background:#05070a;border-color:#0d1117;opacity:.32}.heat-cell.today{outline:1px solid var(--blue);outline-offset:2px}.heat-cell.selected{outline:1px solid #f0f6fc;outline-offset:2px;transform:translateY(-1px) scale(1.15);filter:brightness(1.08)}' +
      '.label-row{margin-top:7px;color:var(--muted2);font-size:8px;line-height:1;font-variant-numeric:tabular-nums}.day-label{text-align:center}.day-label.ghost{color:transparent}' +
      '.legend{display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:11px;color:var(--muted);font-size:9px}.legend i{width:9px;height:9px;border-radius:2px;border:1px solid rgba(240,246,252,.05)}.legend .lv0{background:var(--lv0)}.legend .lv1{background:var(--lv1)}.legend .lv2{background:var(--lv2)}.legend .lv3{background:var(--lv3);box-shadow:0 0 3px rgba(38,166,65,.2)}.legend .lv4{background:var(--lv4);box-shadow:0 0 5px rgba(57,211,83,.35)}' +
      '.detail-ribbon{display:flex;align-items:center;gap:18px;min-height:54px;padding:0 20px;border-top:1px solid var(--border);overflow-x:auto;scrollbar-width:none;white-space:nowrap;transition:opacity .15s ease,transform .15s ease}.detail-ribbon::-webkit-scrollbar{display:none}.detail-ribbon.swap{opacity:.18;transform:translateX(5px)}.detail-date{font-size:10px;color:var(--muted);min-width:76px}.detail-main{font-size:15px;font-weight:650;font-variant-numeric:tabular-nums;min-width:112px}.detail-item{font-size:10px;color:var(--muted)}.detail-item b{display:block;margin-top:3px;color:#c9d1d9;font-size:11px;font-weight:550;font-variant-numeric:tabular-nums}' +
      '.note{padding:10px 20px 0;color:#d29922;font-size:10px;line-height:1.45}.footer{margin-top:12px;text-align:center;color:#3f4751;font-size:9px;letter-spacing:.05em}' +
      '.leaving .shell{opacity:0;transform:translateY(3px);transition:opacity .14s ease,transform .14s ease}' +
      '@media(hover:hover){.heat-cell:hover{transform:translateY(-1px) scale(1.13);filter:brightness(1.1)}.dash:hover{color:var(--text)}.nav a:hover{background:#161b22}}' +
      '@media(max-width:520px){.shell{padding-left:12px;padding-right:12px}.hero{padding:17px 16px 15px}.activity{padding:15px 16px 14px}.detail-ribbon{padding:0 16px;gap:16px}.amount{font-size:clamp(32px,10vw,42px)}.coverage{display:none}.heat-row,.label-row{grid-auto-columns:12px;gap:4px}.stage{border-radius:9px}}' +
      '@media(prefers-reduced-motion:reduce){.shell,.heat-cell{animation:none;opacity:1;transform:none}.heat-cell,.nav a,.detail-ribbon{transition:none}}' +
      '@keyframes pageIn{to{opacity:1;transform:none}}@keyframes cellIn{to{opacity:1;transform:none}}';
  }

  function page(store) {
    if (!store || !store.last || !store.history || store.history.length < 2) {
      return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#000"><style>' + css() + '</style></head><body><main class="shell"><section class="stage"><div class="hero"><div class="hero-copy"><div class="month">PLASMA / REWARDS</div><div class="amount">NO DATA</div><div class="subline">Need at least two captured reward changes.</div></div></div></section></main></body></html>';
    }

    var selected = parseMonth(requestUrl);
    var daily = buildDaily(store.history);
    var cov = coverage(store.history);
    var model = monthModel(selected, daily, cov);
    var prev = monthKey(addMonths(selected, -1));
    var next = monthKey(addMonths(selected, 1));
    var bestText = model.best
      ? (monthShort(selected) + ' ' + pad2(model.best.day) + ' · +' + fixed(model.best.earned) + ' USDT')
      : 'No activity';
    var rangeText = cov ? (dateKey(cov.start) + ' → ' + dateKey(cov.end)) : '—';
    var note = '';
    if (model.partial) note = '<div class="note">Partial month: older activity has already fallen outside the saved 100-point history.</div>';
    else if (model.outside) note = '<div class="note">This month is outside the saved history range.</div>';

    var dataJson = JSON.stringify(model.data).replace(/</g, "\\u003c");
    var covStart = cov ? dateKey(cov.start) : '';
    var covEnd = cov ? dateKey(cov.end) : '';

    return '<!doctype html>' +
      '<html><head>' +
      '<meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
      '<meta name="theme-color" content="#000000">' +
      '<meta name="color-scheme" content="dark">' +
      '<title>Plasma Heatmap</title><style>' + css() + '</style></head><body>' +
      '<main class="shell">' +
      '<header class="top"><div class="brand">PLASMA / REWARDS</div><a class="dash" href="http://plasma-dashboard.test/">DASHBOARD</a></header>' +
      '<section class="stage">' +
      '<div class="hero"><div class="hero-copy">' +
      '<div class="month">' + monthShort(selected).toUpperCase() + ' ' + selected.getFullYear() + '</div>' +
      '<div class="amount"><span class="count" data-target="' + fixed(model.earned) + '">0.0000</span> <small>USDT</small></div>' +
      '<div class="subline"><b>' + model.active + ' active days</b>&nbsp;&nbsp;·&nbsp;&nbsp;Best ' + esc(bestText) + '</div>' +
      '</div><nav class="nav"><a class="month-link" href="/?month=' + prev + '" aria-label="Previous month">‹</a><a class="month-link" href="/?month=' + next + '" aria-label="Next month">›</a></nav></div>' +
      '<div class="divider"></div>' + note +
      '<div class="activity"><div class="activity-head"><span>Reward activity</span><span class="coverage">' + esc(rangeText) + '</span></div>' +
      '<div class="heat-scroll" id="heatScroll"><div class="heat-wrap"><div class="heat-row">' + model.cells + '</div><div class="label-row">' + model.labels + '</div></div></div>' +
      '<div class="legend"><span>Less</span><i class="lv0"></i><i class="lv1"></i><i class="lv2"></i><i class="lv3"></i><i class="lv4"></i><span>More</span></div></div>' +
      '<div class="detail-ribbon" id="detail"><span class="detail-date">Select a day</span><span class="detail-main">—</span><span class="detail-item">Tap a square to inspect activity.</span></div>' +
      '</section><div class="footer">READ ONLY · LOCAL LOON STORE</div></main>' +
      '<script>(function(){' +
      'var DATA=' + dataJson + ';var START=' + JSON.stringify(covStart) + ';var END=' + JSON.stringify(covEnd) + ';' +
      'var cells=document.querySelectorAll(".heat-cell");var detail=document.getElementById("detail");var scroll=document.getElementById("heatScroll");' +
      'function fmt(v){var n=Number(v);return isFinite(n)?n.toFixed(4):"—"}function sign(v){var n=Number(v);return isFinite(n)?(n>0?"+":"")+n.toFixed(4):"—"}' +
      'function render(cell){for(var i=0;i<cells.length;i++)cells[i].classList.remove("selected");cell.classList.add("selected");var k=cell.getAttribute("data-k");detail.classList.add("swap");setTimeout(function(){if(!START||k<START||k>END){detail.innerHTML="<span class=\\"detail-date\\">"+k+"</span><span class=\\"detail-main\\">No history</span><span class=\\"detail-item\\">Outside saved coverage</span>";}else{var d=DATA[k]||{earned:0,events:0,referral:0,cashback:0,net:0,paid:0};detail.innerHTML="<span class=\\"detail-date\\">"+k+"</span><span class=\\"detail-main\\">+"+fmt(d.earned)+" USDT</span><span class=\\"detail-item\\">Events<b>"+d.events+"</b></span><span class=\\"detail-item\\">Referral<b>+"+fmt(d.referral)+"</b></span><span class=\\"detail-item\\">Cashback<b>+"+fmt(d.cashback)+"</b></span><span class=\\"detail-item\\">Net<b>"+sign(d.net)+"</b></span><span class=\\"detail-item\\">Paid<b>"+sign(d.paid)+"</b></span>";}detail.classList.remove("swap");},110);}' +
      'for(var i=0;i<cells.length;i++){cells[i].addEventListener("click",function(){render(this);});}' +
      'var target=document.querySelector(".heat-cell.today")||document.querySelector(".heat-cell[data-k=\\"' + (monthKey(selected) === monthKey(new Date()) ? dateKey(new Date()) : dateKey(new Date(selected.getFullYear(), selected.getMonth() + 1, 0))) + '\\"]");if(scroll&&target){setTimeout(function(){scroll.scrollLeft=Math.max(0,target.offsetLeft-scroll.clientWidth*.58);},220);}' +
      'var counter=document.querySelector(".count");if(counter){var end=Number(counter.getAttribute("data-target"));if(isFinite(end)){var start=performance.now(),dur=620;function tick(now){var p=Math.min(1,(now-start)/dur);var e=1-Math.pow(1-p,3);counter.textContent=(end*e).toFixed(4);if(p<1)requestAnimationFrame(tick);}requestAnimationFrame(tick);}}' +
      'var links=document.querySelectorAll(".month-link");for(var j=0;j<links.length;j++){links[j].addEventListener("click",function(ev){ev.preventDefault();var href=this.getAttribute("href");document.documentElement.classList.add("leaving");setTimeout(function(){location.href=href;},135);});}' +
      '})();</script></body></html>';
  }

  function respond(body) {
    $done({
      response: {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
        },
        body: body
      }
    });
  }

  var store = readStore();
  respond(page(store));
})();