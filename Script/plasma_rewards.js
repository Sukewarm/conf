/**
 * Plasma One Rewards Tracker for Loon
 * - change mode only reacts to monetary changes
 * - local history only stores reward/payout amounts plus display labels/dates
 * - referral redemption/status fields are not persisted
 * - captured data is never sent to a third-party server
 */

(() => {
  const STORE_KEY = "plasma_rewards_tracker_v1";
  const HISTORY_LIMIT = 100;
  const EPSILON = 0.0000005;

  const arg = (typeof $argument !== "undefined" && $argument) ? $argument : {};
  const notifyMode = String(arg.notify || "change").toLowerCase(); // change | always | off

  function fixed(n, digits = 4) {
    const x = Number(n || 0);
    return Number.isFinite(x) ? x.toFixed(digits) : "0.0000";
  }

  function signed(n, digits = 4) {
    const x = Number(n || 0);
    if (!Number.isFinite(x) || Math.abs(x) < EPSILON) return "";
    return `${x > 0 ? "+" : ""}${x.toFixed(digits)}`;
  }

  function amount(v) {
    if (v == null) return 0;
    if (typeof v === "object" && v !== null && "amount" in v && "decimals" in v) {
      const raw = Number(v.amount);
      const decimals = Number(v.decimals || 0);
      if (Number.isFinite(raw) && Number.isFinite(decimals)) {
        return raw / Math.pow(10, decimals);
      }
    }
    if (typeof v === "object" && v !== null && "amount" in v) return amount(v.amount);
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  // Keep only reward/payout values and the labels/dates needed to display them.
  // Referral code, redeemed count, remaining count, redeemed_at, cash-out state, etc. are discarded.
  function sanitizeSnapshot(s) {
    if (!s || typeof s !== "object") return null;
    return {
      capturedAt: s.capturedAt || "",
      total: Number(s.total || 0),
      totalCashBack: Number(s.totalCashBack || 0),
      totalReferrals: Number(s.totalReferrals || 0),
      monthTotal: Number(s.monthTotal || 0),
      monthCashBack: Number(s.monthCashBack || 0),
      monthReferrals: Number(s.monthReferrals || 0),
      periodStart: s.periodStart || "",
      periodEnd: s.periodEnd || "",
      pending: Number(s.pending || 0),
      pendingLabel: s.pendingLabel || "Accruing",
      accrued: Number(s.accrued || 0),
      settlementLabel: s.settlementLabel || "Settlement",
      paid: Number(s.paid || 0),
      paidLabel: s.paidLabel || "Paid"
    };
  }

  function readStore() {
    try {
      const raw = $persistentStore.read(STORE_KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw);
      const history = Array.isArray(stored.history)
        ? stored.history.map(sanitizeSnapshot).filter(Boolean).slice(-HISTORY_LIMIT)
        : [];
      return {
        version: 2,
        first: sanitizeSnapshot(stored.first),
        previousChange: sanitizeSnapshot(stored.previousChange),
        last: sanitizeSnapshot(stored.last),
        history
      };
    } catch (e) {
      console.log(`[Plasma Rewards] readStore error: ${e}`);
      return null;
    }
  }

  function writeStore(obj) {
    try {
      return $persistentStore.write(JSON.stringify(obj), STORE_KEY);
    } catch (e) {
      console.log(`[Plasma Rewards] writeStore error: ${e}`);
      return false;
    }
  }

  function makeSnapshot(payload) {
    const data = payload && payload.data ? payload.data : {};
    const period = data.period_summary || {};
    const reward = data.rewards_card_summary || {};
    const payouts = data.payouts || {};
    const pending = payouts.pending || {};
    const accrued = payouts.accrued || {};
    const paid = payouts.paid || {};

    return sanitizeSnapshot({
      capturedAt: new Date().toISOString(),
      total: amount(reward.total),
      totalCashBack: amount(reward.cash_back),
      totalReferrals: amount(reward.referrals),
      monthTotal: amount(period.total),
      monthCashBack: amount(period.cash_back),
      monthReferrals: amount(period.referrals),
      periodStart: period.period_start || "",
      periodEnd: period.period_end || "",
      pending: amount(pending.amount),
      pendingLabel: pending.label || "Accruing",
      accrued: amount(accrued.amount),
      settlementLabel: accrued.label || "Settlement",
      paid: amount(paid.amount),
      paidLabel: paid.label || "Paid"
    });
  }

  function delta(now, prev) {
    if (!prev) {
      return { total: 0, monthTotal: 0, referrals: 0, monthReferrals: 0, pending: 0, accrued: 0, paid: 0 };
    }
    return {
      total: now.total - prev.total,
      monthTotal: now.monthTotal - prev.monthTotal,
      referrals: now.totalReferrals - prev.totalReferrals,
      monthReferrals: now.monthReferrals - prev.monthReferrals,
      pending: now.pending - prev.pending,
      accrued: now.accrued - prev.accrued,
      paid: now.paid - prev.paid
    };
  }

  // "change" means money changed. Labels, dates, referral state, timestamps, etc. do not trigger it.
  function moneyChanged(now, prev) {
    if (!prev) return true;
    const moneyFields = [
      "total", "totalCashBack", "totalReferrals",
      "monthTotal", "monthCashBack", "monthReferrals",
      "pending", "accrued", "paid"
    ];
    return moneyFields.some(k => Math.abs(Number(now[k] || 0) - Number(prev[k] || 0)) > EPSILON);
  }

  function summaryLines(s, d, first) {
    const lines = [];
    const totalDelta = d ? signed(d.total) : "";
    const paidDelta = d ? signed(d.paid) : "";
    const accruedDelta = d ? signed(d.accrued) : "";
    const pendingDelta = d ? signed(d.pending) : "";

    lines.push(`累计：${fixed(s.total)} USDT${totalDelta ? ` (${totalDelta})` : ""}`);
    lines.push(`${s.pendingLabel || "Accruing"}：${fixed(s.pending)}${pendingDelta ? ` (${pendingDelta})` : ""}`);
    lines.push(`${s.settlementLabel || "Settlement"}：${fixed(s.accrued)}${accruedDelta ? ` (${accruedDelta})` : ""}`);
    lines.push(`${s.paidLabel || "Paid"}：${fixed(s.paid)}${paidDelta ? ` (${paidDelta})` : ""}`);
    lines.push(`未支付：${fixed(s.pending + s.accrued)} USDT`);
    lines.push(`本月：${fixed(s.monthTotal)}｜邀请 ${fixed(s.monthReferrals)}｜返现 ${fixed(s.monthCashBack)}`);

    if (first) {
      const sinceFirst = s.total - Number(first.total || 0);
      if (Math.abs(sinceFirst) > EPSILON) lines.push(`开始抓取以来：${signed(sinceFirst)} USDT`);
    }

    return lines;
  }

  function notifySnapshot(s, d, first, force = false) {
    if (notifyMode === "off" && !force) return;
    const paidUp = d && d.paid > EPSILON;
    const title = paidUp ? "Plasma 已支付更新" : "Plasma Rewards 更新";
    const subtitle = paidUp
      ? `Paid +${fixed(d.paid)} USDT`
      : `${s.settlementLabel || "Settlement"} · ${fixed(s.accrued)} USDT`;
    $notification.post(title, subtitle, summaryLines(s, d, first).join("\n"));
  }

  function showSaved() {
    const store = readStore();
    if (!store || !store.last) {
      $notification.post("Plasma Rewards", "暂无抓取记录", "先打开 Plasma One，让 primaryCashBack 接口至少请求一次。插件不会修改接口响应。");
      $done();
      return;
    }
    const s = store.last;
    const d = store.previousChange ? delta(s, store.previousChange) : null;
    $notification.post("Plasma Rewards 当前记录", `最后金额变化：${s.capturedAt || "未知"}`, summaryLines(s, d, store.first).join("\n"));
    $done();
  }

  if (typeof $response === "undefined") {
    showSaved();
    return;
  }

  try {
    if (!$response.body) {
      $done({});
      return;
    }

    const payload = JSON.parse($response.body);
    if (!payload || payload.success !== true || !payload.data) {
      $done({});
      return;
    }

    const snapshot = makeSnapshot(payload);
    const oldStore = readStore() || {};
    const previous = oldStore.last || null;
    const first = oldStore.first || snapshot;
    const changed = moneyChanged(snapshot, previous);
    const d = delta(snapshot, previous);
    const history = Array.isArray(oldStore.history) ? oldStore.history.slice(-HISTORY_LIMIT) : [];

    let newStore;
    if (changed) {
      history.push(snapshot);
      while (history.length > HISTORY_LIMIT) history.shift();
      newStore = {
        version: 2,
        first,
        previousChange: previous || null,
        last: snapshot,
        history
      };
    } else {
      // Do not persist non-monetary changes from this response.
      // Rewriting the sanitized old store also removes referral/status fields left by older versions.
      newStore = {
        version: 2,
        first,
        previousChange: oldStore.previousChange || null,
        last: previous,
        history
      };
    }

    writeStore(newStore);

    console.log(`[Plasma Rewards] total=${fixed(snapshot.total)} | pending=${fixed(snapshot.pending)} | ${snapshot.settlementLabel}=${fixed(snapshot.accrued)} | paid=${fixed(snapshot.paid)} | moneyChanged=${changed}`);

    if (notifyMode === "always") {
      notifySnapshot(snapshot, d, first);
    } else if (notifyMode === "change" && changed) {
      notifySnapshot(snapshot, d, first);
    }
  } catch (e) {
    console.log(`[Plasma Rewards] parse error: ${e}`);
  }

  $done({});
})();
