"use strict";

const EXECUTION_REPLAY_VERSION = 1;
const EXECUTION_REPLAY_AUTHORITY = "intraday_execution_replay_v1";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function minuteOf(value) {
  const match = String(value || "").match(/(\d{2}):?(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function round(value, digits = 4) {
  const number = finite(value);
  if (number === null) return null;
  const scale = 10 ** digits;
  return Math.round(number * scale) / scale;
}

function dailyBuyabilityObservation(outcome = {}) {
  const open = finite(outcome.open ?? outcome.nextOpen);
  const high = finite(outcome.high ?? outcome.nextHigh);
  const low = finite(outcome.low ?? outcome.nextLow);
  const previousClose = finite(outcome.previousClose ?? outcome.currentClose);
  const locked = [open, high, low].every((value) => value !== null)
    && Math.abs(open - high) <= 0.001
    && Math.abs(open - low) <= 0.001;
  return {
    observationOnly: true,
    executionAuthority: false,
    open,
    high,
    low,
    gapPct: previousClose && open ? round((open / previousClose - 1) * 100) : null,
    suspectedLockedSession: locked,
    rule: "日线只能观察整日是否近似锁价，不能证明盘中某一分钟可成交",
  };
}

function buildExecutionReplay(input = {}) {
  const rule = input.rule && typeof input.rule === "object" ? input.rule : null;
  const minuteBars = Array.isArray(input.minuteBars) ? input.minuteBars.filter(Boolean) : [];
  const dailyObservation = dailyBuyabilityObservation(input.dailyOutcome || {});
  const blockers = [];
  if (!rule || Number(rule.version || 0) < 1) blockers.push("machine_readable_trigger_rule_missing");
  if (!minuteBars.length) blockers.push("intraday_execution_bars_missing");
  const referencePrice = finite(rule && rule.referencePrice);
  if (referencePrice === null || referencePrice <= 0) blockers.push("reference_price_missing");
  const earliestMinute = minuteOf(rule && rule.earliestTime);
  const latestMinute = minuteOf(rule && rule.latestTime);
  if (earliestMinute === null || latestMinute === null || earliestMinute > latestMinute) blockers.push("execution_window_invalid");
  if (blockers.length) {
    return {
      version: EXECUTION_REPLAY_VERSION,
      authority: EXECUTION_REPLAY_AUTHORITY,
      status: "unavailable",
      executionAuthority: false,
      validOutcome: false,
      blockers,
      dailyBuyabilityObservation: dailyObservation,
      rule: "缺少机器触发或分钟成交条时不生成成交价、滑点和收益",
    };
  }

  const maxGapPct = finite(rule.maxGapPct);
  const maxEntryPrice = maxGapPct === null ? null : referencePrice * (1 + maxGapPct / 100);
  let cumulativeAmount = 0;
  let cumulativeVolume = 0;
  const orderedMinuteBars = minuteBars.slice().sort((left, right) => (
    (finite(left.minute) ?? minuteOf(left.time) ?? Infinity)
    - (finite(right.minute) ?? minuteOf(right.time) ?? Infinity)
  ));
  const normalized = orderedMinuteBars.map((bar) => {
    const amount = finite(bar.amount);
    const volume = finite(bar.volume);
    if (amount !== null && amount >= 0) cumulativeAmount += amount;
    if (volume !== null && volume >= 0) cumulativeVolume += volume;
    return {
      ...bar,
      minute: finite(bar.minute) ?? minuteOf(bar.time),
      open: finite(bar.open),
      close: finite(bar.close ?? bar.price),
      high: finite(bar.high),
      low: finite(bar.low),
      amount,
      volume,
      averagePrice: finite(bar.averagePrice)
        ?? (cumulativeVolume > 0 ? cumulativeAmount / cumulativeVolume : null),
    };
  }).filter((bar) => bar.minute !== null && bar.close !== null);
  const windowBars = normalized.filter((bar) => bar.minute >= earliestMinute && bar.minute <= latestMinute);
  const completeWindowBarCount = windowBars.filter((bar) => (
    bar.open !== null && bar.high !== null && bar.low !== null
  )).length;
  if (windowBars.length && completeWindowBarCount === 0) {
    return {
      version: EXECUTION_REPLAY_VERSION,
      authority: EXECUTION_REPLAY_AUTHORITY,
      status: "unavailable",
      executionAuthority: false,
      validOutcome: false,
      blockers: ["intraday_ohlc_missing"],
      dailyBuyabilityObservation: dailyObservation,
      rule: "分钟条缺少完整OHLC时不能证明价格发现或生成成交",
    };
  }
  const triggerIndex = windowBars.findIndex((bar) => {
    if (bar.open === null || bar.high === null || bar.low === null) return false;
    if (maxEntryPrice !== null && bar.close > maxEntryPrice) return false;
    if (rule.requirePositiveAmount !== false && !(bar.amount > 0)) return false;
    if (rule.requireAboveAveragePrice === true && (bar.averagePrice === null || bar.close < bar.averagePrice)) return false;
    const locked = bar.open !== null && bar.high !== null && bar.low !== null
      && Math.abs(bar.open - bar.high) <= 0.001 && Math.abs(bar.open - bar.low) <= 0.001;
    return !locked;
  });
  if (triggerIndex < 0) {
    return {
      version: EXECUTION_REPLAY_VERSION,
      authority: EXECUTION_REPLAY_AUTHORITY,
      status: "not_triggered",
      executionAuthority: false,
      validOutcome: true,
      triggered: false,
      windowBarCount: windowBars.length,
      dailyBuyabilityObservation: dailyObservation,
    };
  }

  const triggerBar = windowBars[triggerIndex];
  const normalizedTriggerIndex = normalized.indexOf(triggerBar);
  const nextBar = normalizedTriggerIndex >= 0 ? normalized[normalizedTriggerIndex + 1] : null;
  if (!nextBar) {
    return {
      version: EXECUTION_REPLAY_VERSION,
      authority: EXECUTION_REPLAY_AUTHORITY,
      status: "triggered_unfilled",
      executionAuthority: false,
      validOutcome: false,
      triggered: true,
      blockers: ["next_bar_missing_after_trigger"],
      trigger: {
        time: triggerBar.time || null,
        minute: triggerBar.minute,
        observedPrice: round(triggerBar.close),
        nextBarTime: null,
      },
      dailyBuyabilityObservation: dailyObservation,
      rule: "触发后没有下一根分钟K线，禁止使用同一根K线开盘价伪造成交",
    };
  }
  const barIntervalMinutes = finite(input.barIntervalMinutes)
    ?? finite(triggerBar.intervalMinutes)
    ?? Math.max(1, nextBar.minute - triggerBar.minute);
  const rawFillPrice = finite(nextBar.open);
  if (rawFillPrice === null || rawFillPrice <= 0) {
    return {
      version: EXECUTION_REPLAY_VERSION,
      authority: EXECUTION_REPLAY_AUTHORITY,
      status: "triggered_unfilled",
      executionAuthority: false,
      validOutcome: false,
      triggered: true,
      blockers: ["next_bar_open_missing"],
      trigger: {
        time: triggerBar.time || null,
        minute: triggerBar.minute,
        observedPrice: round(triggerBar.close),
        nextBarTime: nextBar.time || null,
      },
      dailyBuyabilityObservation: dailyObservation,
      rule: "下一根分钟K线缺少开盘价时禁止用收盘价或其他价格伪造成交",
    };
  }
  const slippageBps = Math.max(0, finite(input.slippageBps) ?? 0);
  const feeBps = Math.max(0, finite(input.feeBps) ?? 0);
  const fillPrice = rawFillPrice * (1 + slippageBps / 10000);
  const fillBlocker = maxEntryPrice !== null && rawFillPrice > maxEntryPrice
    ? "next_bar_open_exceeds_max_entry_price"
    : maxEntryPrice !== null && fillPrice > maxEntryPrice
      ? "slippage_adjusted_fill_exceeds_max_entry_price"
      : null;
  if (fillBlocker) {
    return {
      version: EXECUTION_REPLAY_VERSION,
      authority: EXECUTION_REPLAY_AUTHORITY,
      status: "triggered_unfilled",
      executionAuthority: false,
      validOutcome: false,
      triggered: true,
      blockers: [fillBlocker],
      trigger: {
        time: triggerBar.time || null,
        minute: triggerBar.minute,
        observedPrice: round(triggerBar.close),
        nextBarTime: nextBar.time || null,
      },
      attemptedFill: {
        rawFillPrice: round(rawFillPrice),
        slippageBps,
        fillPrice: round(fillPrice),
        maximumAllowedPrice: round(maxEntryPrice),
      },
      dailyBuyabilityObservation: dailyObservation,
      rule: "实际下一根开盘成交价或滑点后价格超过冻结上限时不成交",
    };
  }
  const markToMarketPrice = finite(input.exitPrice ?? (input.dailyOutcome && input.dailyOutcome.nextClose));
  const grossReturnPct = markToMarketPrice && fillPrice ? (markToMarketPrice / fillPrice - 1) * 100 : null;
  const netReturnPct = grossReturnPct === null ? null : grossReturnPct - feeBps / 100;
  return {
    version: EXECUTION_REPLAY_VERSION,
    authority: EXECUTION_REPLAY_AUTHORITY,
    status: "triggered",
    executionAuthority: false,
    validOutcome: true,
    triggered: true,
    trigger: {
      time: triggerBar.time || null,
      minute: triggerBar.minute,
      observedPrice: round(triggerBar.close),
      nextBarTime: nextBar.time || null,
    },
    fill: {
      method: "next_bar_open_conservative",
      barIntervalMinutes,
      rawFillPrice: round(rawFillPrice),
      slippageBps,
      feeBps,
      fillPrice: round(fillPrice),
    },
    outcome: {
      outcomeType: "same_session_close_mark_to_market_not_exit",
      realized: false,
      markToMarketPrice: round(markToMarketPrice),
      exitPrice: round(markToMarketPrice),
      grossReturnPct: round(grossReturnPct),
      netReturnPct: round(netReturnPct),
      rule: "入场日收盘仅作盯市和条件溢价诊断；A股T+1约束下不视为已实现卖出",
    },
    dailyBuyabilityObservation: dailyObservation,
    rule: `触发后按下一根${barIntervalMinutes ? `${barIntervalMinutes}分钟` : "分钟"}K线开盘价并叠加显式滑点情景；入场日收盘只盯市，不产生卖出或实盘执行权`,
  };
}

module.exports = {
  EXECUTION_REPLAY_VERSION,
  EXECUTION_REPLAY_AUTHORITY,
  dailyBuyabilityObservation,
  buildExecutionReplay,
};
