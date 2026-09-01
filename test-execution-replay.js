"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildExecutionReplay } = require("./quant-decision/execution-replay");

function rule(overrides = {}) {
  return {
    version: 1,
    referencePrice: 10,
    earliestTime: "09:35",
    latestTime: "10:00",
    maxGapPct: 3,
    requirePositiveAmount: true,
    requireAboveAveragePrice: false,
    ...overrides,
  };
}

test("缺少分钟条时日线只能作为可买性旁证，不生成成交收益", () => {
  const result = buildExecutionReplay({
    rule: rule(),
    dailyOutcome: { currentClose: 10, open: 11, high: 11, low: 11, nextClose: 11 },
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.validOutcome, false);
  assert(result.blockers.includes("intraday_execution_bars_missing"));
  assert.equal(result.dailyBuyabilityObservation.suspectedLockedSession, true);
  assert.equal(result.dailyBuyabilityObservation.executionAuthority, false);
  assert.equal(result.outcome, undefined);
});

test("真实分钟触发后按下一根K线开盘并叠加显式滑点费用情景", () => {
  const result = buildExecutionReplay({
    rule: rule(),
    minuteBars: [
      { time: "09:34", open: 10.2, high: 10.2, low: 10.2, close: 10.2, amount: 1000 },
      { time: "09:35", open: 10.1, high: 10.25, low: 10.05, close: 10.2, amount: 1200 },
      { time: "09:36", open: 10.22, high: 10.3, low: 10.2, close: 10.28, amount: 1500 },
    ],
    dailyOutcome: { currentClose: 10, open: 10.1, high: 10.8, low: 9.9, nextClose: 10.7 },
    exitPrice: 10.7,
    slippageBps: 5,
    feeBps: 8,
  });
  assert.equal(result.status, "triggered");
  assert.equal(result.trigger.time, "09:35");
  assert.equal(result.fill.rawFillPrice, 10.22);
  assert.equal(result.fill.method, "next_bar_open_conservative");
  assert.equal(result.fill.barIntervalMinutes, 1);
  assert(result.fill.fillPrice > result.fill.rawFillPrice);
  assert(result.outcome.netReturnPct < result.outcome.grossReturnPct);
  assert.equal(result.outcome.realized, false);
  assert.equal(result.outcome.outcomeType, "same_session_close_mark_to_market_not_exit");
  assert.equal(result.executionAuthority, false);
});

test("窗口内只有锁价或零成交分钟时保持未触发", () => {
  const result = buildExecutionReplay({
    rule: rule(),
    minuteBars: [
      { time: "09:35", open: 11, high: 11, low: 11, close: 11, amount: 1000 },
      { time: "09:36", open: 10.2, high: 10.3, low: 10.1, close: 10.2, amount: 0 },
    ],
    dailyOutcome: { currentClose: 10, open: 11, high: 11, low: 10.2, nextClose: 10.5 },
  });
  assert.equal(result.status, "not_triggered");
  assert.equal(result.triggered, false);
  assert.equal(result.validOutcome, true);
});

test("触发发生在窗口末端时必须使用窗口外下一根K线开盘成交", () => {
  const result = buildExecutionReplay({
    rule: rule({ latestTime: "10:00" }),
    minuteBars: [
      { time: "09:55", open: 10.4, high: 10.5, low: 10.35, close: 10.4, volume: 100, amount: 1040 },
      { time: "10:00", open: 10.3, high: 10.35, low: 10.15, close: 10.2, volume: 100, amount: 1020 },
      { time: "10:05", open: 10.25, high: 10.4, low: 10.2, close: 10.35, volume: 100, amount: 1035 },
    ],
    dailyOutcome: { currentClose: 10, open: 10.4, high: 10.8, low: 9.9, nextClose: 10.5 },
    exitPrice: 10.5,
  });
  assert.equal(result.status, "triggered");
  assert.equal(result.trigger.time, "10:00");
  assert.equal(result.trigger.nextBarTime, "10:05");
  assert.equal(result.fill.rawFillPrice, 10.25);
  assert.equal(result.fill.barIntervalMinutes, 5);
});

test("触发后缺少下一根K线时不能用同一根开盘价伪造成交", () => {
  const result = buildExecutionReplay({
    rule: rule(),
    minuteBars: [
      { time: "10:00", open: 10.3, high: 10.35, low: 10.15, close: 10.2, volume: 100, amount: 1020 },
    ],
    dailyOutcome: { currentClose: 10, open: 10.3, high: 10.35, low: 10.15, nextClose: 10.2 },
  });
  assert.equal(result.status, "triggered_unfilled");
  assert.equal(result.validOutcome, false);
  assert(result.blockers.includes("next_bar_missing_after_trigger"));
  assert.equal(result.fill, undefined);
});

test("下一根K线缺少开盘价时禁止用收盘价伪造成交", () => {
  const result = buildExecutionReplay({
    rule: rule(),
    minuteBars: [
      { time: "09:35", open: 10.1, high: 10.25, low: 10.05, close: 10.2, amount: 1200 },
      { time: "09:40", high: 10.4, low: 10.2, close: 10.3, amount: 1500 },
    ],
    dailyOutcome: { currentClose: 10, nextClose: 10.5 },
  });
  assert.equal(result.status, "triggered_unfilled");
  assert(result.blockers.includes("next_bar_open_missing"));
  assert.equal(result.fill, undefined);
});

test("下一根开盘价或滑点后价格超过冻结上限时不成交", () => {
  const base = {
    rule: rule({ maxGapPct: 3 }),
    dailyOutcome: { currentClose: 10, nextClose: 10.5 },
  };
  const rawTooHigh = buildExecutionReplay({
    ...base,
    minuteBars: [
      { time: "09:35", open: 10.1, high: 10.25, low: 10.05, close: 10.2, amount: 1200 },
      { time: "09:40", open: 10.31, high: 10.4, low: 10.2, close: 10.3, amount: 1500 },
    ],
  });
  assert.equal(rawTooHigh.status, "triggered_unfilled");
  assert(rawTooHigh.blockers.includes("next_bar_open_exceeds_max_entry_price"));

  const slippageTooHigh = buildExecutionReplay({
    ...base,
    minuteBars: [
      { time: "09:35", open: 10.1, high: 10.25, low: 10.05, close: 10.2, amount: 1200 },
      { time: "09:40", open: 10.3, high: 10.4, low: 10.2, close: 10.3, amount: 1500 },
    ],
    slippageBps: 5,
  });
  assert.equal(slippageTooHigh.status, "triggered_unfilled");
  assert(slippageTooHigh.blockers.includes("slippage_adjusted_fill_exceeds_max_entry_price"));
});

test("窗口分钟条全部缺少完整OHLC时结果不可用", () => {
  const result = buildExecutionReplay({
    rule: rule(),
    minuteBars: [
      { time: "09:35", close: 10.2, amount: 1200 },
      { time: "09:40", close: 10.3, amount: 1500 },
    ],
    dailyOutcome: { currentClose: 10, nextClose: 10.5 },
  });
  assert.equal(result.status, "unavailable");
  assert(result.blockers.includes("intraday_ohlc_missing"));
});
