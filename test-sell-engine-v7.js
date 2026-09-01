"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  evaluateV7MinuteSell,
  V7_SELL_STRATEGY_AUTHORITY,
  V7_COMPARABLE_PRICE_AUTHORITY,
  V7_NEGATIVE_FEEDBACK_AUTHORITY,
  v7StableSha256,
} = require("./sell-engine");
const {
  CANONICAL_MINUTE_HASH_SCOPE,
  CANONICAL_SEAL_HASH_SCOPE,
  computeMinuteContentHash,
  computeSealTickContentHash,
  selectMinuteEvidence,
} = require("./quant-decision/minute-evidence");

const DATE = "2026-05-22";
const CODE = "000001.XSHE";

function sessionTimes() {
  const result = [];
  for (let minute = 9 * 60 + 31; minute <= 11 * 60 + 30; minute += 1) result.push(minute);
  for (let minute = 13 * 60 + 1; minute <= 15 * 60; minute += 1) result.push(minute);
  return result;
}

function hhmm(minute) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function bars(overrides = {}) {
  return sessionTimes().map((minute) => {
    const custom = overrides[hhmm(minute)] || {};
    const close = custom.close ?? 10.5;
    return {
      date: DATE,
      time: hhmm(minute),
      open: custom.open ?? close,
      high: custom.high ?? close,
      low: custom.low ?? close,
      close,
      volume: custom.volume ?? 100,
      amount: custom.amount ?? close * (custom.volume ?? 100),
    };
  });
}

function openStampedBars(overrides = {}) {
  return bars().map((row) => {
    const [hour, minute] = row.time.split(":").map(Number);
    const shifted = hour * 60 + minute - 1;
    const time = hhmm(shifted);
    const custom = overrides[time] || {};
    const close = custom.close ?? row.close;
    return {
      ...row,
      time,
      open: custom.open ?? close,
      high: custom.high ?? close,
      low: custom.low ?? close,
      close,
    };
  });
}

function minuteCandidate(rows, provider = "jqdata") {
  return {
    provider,
    code: CODE,
    tradingDate: DATE,
    barIntervalMinutes: 1,
    priceMode: "raw_unadjusted",
    executionAuthority: false,
    contentHashScope: CANONICAL_MINUTE_HASH_SCOPE,
    contentHash: computeMinuteContentHash(rows),
    bars: rows,
  };
}

function hierarchy(rows, sealTickEvidence = null) {
  return selectMinuteEvidence({
    code: CODE,
    tradingDate: DATE,
    candidates: [minuteCandidate(rows)],
    sealTickEvidence,
  });
}

function negativeFeedback(active = false, time = "14:54:00", overrides = {}) {
  const { payload: _ignoredPayload, ...outerOverrides } = overrides;
  const payload = {
    active,
    tradingDate: DATE,
    generationId: "test-generation",
    sourceDecisionHash: "b".repeat(64),
    sourceTimestamp: `${DATE} ${time}`,
    ...(overrides.payload || {}),
  };
  return {
    verified: true,
    authority: V7_NEGATIVE_FEEDBACK_AUTHORITY,
    payload,
    canonicalPayloadHash: v7StableSha256(payload),
    ...outerOverrides,
  };
}

function comparablePriceBasis(overrides = {}) {
  const payload = {
    securityId: CODE,
    tradingDate: DATE,
    generationId: "test-generation",
    sourceHash: "b".repeat(64),
    entryFillTimestamp: "2026-05-21 10:00:00",
    minutePriceMultiplier: 1,
    comparableEntryPrice: 10,
    comparableHighestPriceSinceEntry: 10.5,
    comparableHighestPriceSinceEntryAsOf: "2026-05-21 15:00:00",
    comparablePreviousClose: 10,
    comparablePreviousFourCloses: [9.8, 9.8, 9.8, 9.8],
    ...overrides,
  };
  return {
    verified: true,
    authority: V7_COMPARABLE_PRICE_AUTHORITY,
    payload,
    canonicalPayloadHash: v7StableSha256(payload),
  };
}

function sameDayPriceBasis(overrides = {}) {
  return comparablePriceBasis({
    entryFillTimestamp: `${DATE} 09:45:00`,
    comparableHighestPriceSinceEntry: 10,
    comparableHighestPriceSinceEntryAsOf: `${DATE} 09:45:00`,
    ...overrides,
  });
}

function upperContext(overrides = {}) {
  const { payload: _ignoredPayload, ...outerOverrides } = overrides;
  const payload = {
    trendQualified: true,
    tradingDate: DATE,
    generationId: "test-generation",
    sourceDecisionHash: "b".repeat(64),
    sourceTimestamp: `${DATE} 14:54:00`,
    ...(overrides.payload || {}),
  };
  return {
    authority: "canonical_sell_upper_context_v1",
    payload,
    canonicalPayloadHash: v7StableSha256(payload),
    negativeFeedback: negativeFeedback(),
    ...outerOverrides,
  };
}

function baseInput(rows, extra = {}) {
  return {
    tradingDate: DATE,
    minuteEvidence: hierarchy(rows),
    position: {
      code: CODE,
      tradingDate: DATE,
      generationId: "test-generation",
      entryPrice: 10,
      remainingPositionPct: 100,
      highestPriceSinceEntry: 10.5,
      trendExtensionActive: true,
      sellable: true,
      priceBasis: comparablePriceBasis(),
      ...(extra.position || {}),
    },
    dailyContext: {
      previousTradingDate: "2026-05-21",
      previousClose: 10,
      previousFourCloses: [9.8, 9.8, 9.8, 9.8],
      highLimitPrice: 11,
      lowLimitPrice: 9,
      previousDayVolume: 100000,
      twoDaysAgoVolume: 90000,
      previousDayChangePct: 9.5,
      ...(extra.dailyContext || {}),
    },
    upperLayer: upperContext(extra.upperLayer || {}),
    sealEvidence: extra.sealEvidence,
  };
}

test("V7使用Tier1完整1分钟证据并允许有浮盈趋势仓续持", () => {
  const result = evaluateV7MinuteSell(baseInput(bars()));
  assert.equal(result.authority, V7_SELL_STRATEGY_AUTHORITY);
  assert.equal(result.status, "complete");
  assert.equal(result.formalPerformanceEligible, false);
  assert.equal(result.authorityBindingStatus, "pending_validated_dataset_manifest_and_receipt_anchor");
  assert.equal(result.evidence.minuteTier, 1);
  assert.equal(result.lowerLayer.core1m.finalAction, "HOLD");
  assert.equal(result.lowerLayer.full1mTick.finalAction, "HOLD");
  assert.equal(result.lowerLayer.combineMetrics, false);
});

test("相对实际成交价精确亏损7%触发全卖，20cm不再放宽到12%", () => {
  const rows = bars({ "10:00": { open: 9.5, high: 9.5, low: 9.3, close: 9.4 } });
  const result = evaluateV7MinuteSell(baseInput(rows));
  assert.equal(result.lowerLayer.core1m.finalAction, "CREATE_FULL_EXIT_INTENT");
  assert.equal(result.lowerLayer.core1m.actualRemainingPositionPct, 100);
  assert.equal(result.lowerLayer.core1m.targetRemainingPositionPct, 0);
  assert.equal(result.lowerLayer.core1m.events.at(-1).key, "hard_stop_full_exit");
  assert.equal(result.lowerLayer.core1m.events.at(-1).triggerPrice, 9.3);
});

test("买入日触发止损只持久化全卖意图，不能伪造T+1卖出", () => {
  const rows = bars({ "10:00": { open: 9.5, high: 9.5, low: 9.3, close: 9.4 } });
  const result = evaluateV7MinuteSell(baseInput(rows, {
    position: { sellable: false, priceBasis: sameDayPriceBasis() },
  }));
  assert.equal(result.lowerLayer.core1m.status, "t1_locked_full_exit_pending");
  assert.equal(result.lowerLayer.core1m.finalAction, "PERSIST_FULL_EXIT_INTENT");
});

test("T+1只检查实际成交后的完整分钟，买入前低点不能生成卖出意图", () => {
  const rows = bars({
    "09:40": { open: 9.2, high: 9.2, low: 9.1, close: 9.2 },
  });
  const result = evaluateV7MinuteSell(baseInput(rows, {
    position: {
      sellable: false,
      priceBasis: sameDayPriceBasis({
        entryFillTimestamp: `${DATE} 10:30:00`,
        comparableHighestPriceSinceEntry: 10,
        comparableHighestPriceSinceEntryAsOf: `${DATE} 10:30:00`,
      }),
    },
  }));
  assert.equal(result.lowerLayer.core1m.status, "entry_day_t1_locked");
  assert.equal(result.lowerLayer.core1m.events.length, 0);
});

test("跌停只生成全卖委托并标记可能受阻，不视为已经成交", () => {
  const rows = bars({ "09:40": { open: 9, high: 9, low: 9, close: 9 } });
  const result = evaluateV7MinuteSell(baseInput(rows));
  assert.equal(result.lowerLayer.core1m.status, "exit_order_submitted");
  assert.equal(result.lowerLayer.core1m.exitBlockedPossible, true);
  assert.equal(result.lowerLayer.core1m.actualRemainingPositionPct, 100);
  assert.equal(result.lowerLayer.core1m.targetRemainingPositionPct, 0);
});

test("涨停回落按昨收百分点计算，连续5个完整1分钟未回封后跌破保护线全卖", () => {
  const rows = bars({
    "10:00": { open: 10.9, high: 11, low: 10.9, close: 11 },
    "10:01": { close: 10.6 },
    "10:02": { close: 10.6 },
    "10:03": { close: 10.6 },
    "10:04": { close: 10.6 },
    "10:05": { close: 10.6 },
  });
  const result = evaluateV7MinuteSell(baseInput(rows));
  assert.equal(result.lowerLayer.core1m.finalAction, "CREATE_FULL_EXIT_INTENT");
  assert.equal(result.lowerLayer.core1m.events.at(-1).key, "peak_profit_70_intraday_exit");
  assert.equal(result.lowerLayer.core1m.events.at(-1).profitProtectionPrice, 10.7);
});

test("14:55保护线只使用进入该分钟前的最高价，禁止同一分钟未来函数", () => {
  const rows = bars({ "14:55": { open: 10.5, high: 12, low: 10.5, close: 10.5 } });
  const result = evaluateV7MinuteSell(baseInput(rows, {
    position: { highestPriceSinceEntry: 10.5 },
    dailyContext: { highLimitPrice: 20 },
  }));
  assert.equal(result.lowerLayer.core1m.finalAction, "HOLD");
  assert.equal(result.lowerLayer.core1m.events.at(-1).profitProtectionPrice, 10.35);
});

test("权威负反馈时间戳晚于14:55时不可倒灌，按证据缺失防守退出", () => {
  const result = evaluateV7MinuteSell(baseInput(bars(), {
    upperLayer: {
      negativeFeedback: negativeFeedback(true, "15:01:00"),
    },
  }));
  assert.equal(result.lowerLayer.core1m.status, "incomplete_defensive_exit");
  assert(result.lowerLayer.core1m.blockers.includes("negative_feedback_evidence_missing"));
});

test("负反馈且MA5正乖离严格超过10%时全卖", () => {
  const rows = bars({ "14:55": { close: 11.2 } });
  const result = evaluateV7MinuteSell(baseInput(rows, {
    dailyContext: { highLimitPrice: 20 },
    upperLayer: {
      negativeFeedback: negativeFeedback(true),
    },
  }));
  assert.equal(result.lowerLayer.core1m.events.at(-1).key, "negative_feedback_overextended_exit");
});

test("14:55量超过前两日最大值且涨幅落后前日7个百分点判定放量滞涨", () => {
  const rows = bars({});
  rows.forEach((row) => { row.volume = 1000; row.amount = row.close * 1000; });
  const at1455 = rows.find((row) => row.time === "14:55");
  Object.assign(at1455, { open: 10.25, high: 10.25, low: 10.25, close: 10.25 });
  const result = evaluateV7MinuteSell(baseInput(rows, {
    dailyContext: { highLimitPrice: 20, previousDayChangePct: 9.5 },
  }));
  assert.equal(result.lowerLayer.core1m.events.at(-1).key, "volume_stagnation_exit");
});

function sealTicks() {
  const result = [];
  for (let seconds = 0; seconds <= 150; seconds += 5) {
    const totalSeconds = 10 * 60 * 60 + seconds;
    const time = `${String(Math.floor(totalSeconds / 3600)).padStart(2, "0")}:${String(Math.floor(totalSeconds / 60) % 60).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
    result.push({
      date: DATE,
      time,
      b1_p: 11,
      b1_v: seconds >= 120 ? 300 : 1000,
    });
  }
  return result;
}

test("封单剩余30%连续30秒只在FULL层卖当前仓位一半，CORE不混入", () => {
  const rows = bars();
  rows.filter((row) => row.time >= "10:00").forEach((row) => {
    Object.assign(row, { open: 11, high: 11, low: 11, close: 11, amount: row.volume * 11 });
  });
  const ticks = sealTicks();
  const sealCandidate = {
    evidenceType: "seal_tick",
    source: "jqdata_tick",
    code: CODE,
    tradingDate: DATE,
    skip: false,
    contentHashScope: CANONICAL_SEAL_HASH_SCOPE,
    contentHash: computeSealTickContentHash(ticks),
    ticks,
  };
  const input = baseInput(rows);
  input.minuteEvidence = hierarchy(rows, sealCandidate);
  const result = evaluateV7MinuteSell(input);
  assert.equal(result.status, "complete");
  assert.equal(result.lowerLayer.core1m.actualRemainingPositionPct, 100);
  assert.equal(result.lowerLayer.core1m.targetRemainingPositionPct, 100);
  assert.equal(result.lowerLayer.full1mTick.actualRemainingPositionPct, 100);
  assert.equal(result.lowerLayer.full1mTick.targetRemainingPositionPct, 50);
  assert.equal(result.lowerLayer.full1mTick.events[0].key, "seal_decay_partial_exit");
  assert.equal(result.lowerLayer.combineMetrics, false);
});

test("发生涨停但缺Tick时FULL不可评估，CORE仍可单列运行", () => {
  const rows = bars();
  rows.filter((row) => row.time >= "10:00").forEach((row) => {
    Object.assign(row, { open: 11, high: 11, low: 11, close: 11, amount: row.volume * 11 });
  });
  const result = evaluateV7MinuteSell(baseInput(rows));
  assert.equal(result.status, "core_only");
  assert.equal(result.lowerLayer.core1m.finalAction, "HOLD");
  assert.equal(result.lowerLayer.full1mTick.status, "unavailable");
  assert(result.lowerLayer.full1mTick.blockers.includes("seal_tick_evidence_missing"));
});

test("全卖意图没有成交回执时后续涨停仍必须要求封单Tick", () => {
  const rows = bars({
    "09:40": { open: 9.4, high: 9.4, low: 9.3, close: 9.35 },
    "14:00": { open: 11, high: 11, low: 11, close: 11 },
  });
  const result = evaluateV7MinuteSell(baseInput(rows));
  assert.equal(result.status, "core_only");
  assert.equal(result.lowerLayer.core1m.events.at(-1).key, "hard_stop_full_exit");
  assert.equal(result.lowerLayer.full1mTick.status, "unavailable");
  assert(result.lowerLayer.full1mTick.blockers.includes("seal_tick_evidence_missing"));
});

test("未经统一分钟证据层选择的直接bars不能绕过层级", () => {
  const result = evaluateV7MinuteSell({
    tradingDate: DATE,
    minuteEvidence: {
      status: "verified",
      valid: true,
      barIntervalMinutes: 1,
      priceMode: "raw_unadjusted",
      bars: bars(),
    },
  });
  assert.equal(result.status, "unavailable");
  assert(result.blockers.includes("minute_evidence_hierarchy_authority_invalid"));
});

test("伪造统一authority或篡改已选分钟条都不能绕过二次校验", () => {
  const forged = baseInput(bars());
  forged.minuteEvidence.selectedPriceEvidence.bars = forged.minuteEvidence.selectedPriceEvidence.bars.slice(0, 2);
  const forgedResult = evaluateV7MinuteSell(forged);
  assert.equal(forgedResult.status, "unavailable");
  assert(forgedResult.blockers.includes("minute_evidence_revalidation_failed"));

  const tampered = baseInput(bars());
  tampered.minuteEvidence.selectedPriceEvidence.bars[0].close += 0.01;
  const tamperedResult = evaluateV7MinuteSell(tampered);
  assert.equal(tamperedResult.status, "unavailable");
  assert(tamperedResult.blockers.includes("minute_evidence:minute_content_hash_mismatch"));
});

test("没有权威趋势身份时，微小浮盈不能自动升级为趋势仓", () => {
  const rows = bars({ "14:55": { close: 10.1 } });
  const result = evaluateV7MinuteSell(baseInput(rows, {
    position: { trendExtensionActive: false },
    upperLayer: { payload: { trendQualified: false } },
  }));
  assert.equal(result.lowerLayer.core1m.events.at(-1).key, "trend_extension_not_qualified");
});

test("当日量只等于前两日最大值时不构成放量滞涨", () => {
  const rows = bars();
  rows.forEach((row, index) => {
    row.volume = index < 100 ? 1000 : 0;
    row.amount = row.close * row.volume;
  });
  const result = evaluateV7MinuteSell(baseInput(rows, {
    dailyContext: { highLimitPrice: 20, previousDayVolume: 100000, twoDaysAgoVolume: 90000 },
  }));
  assert.notEqual(result.lowerLayer.core1m.events.at(-1).key, "volume_stagnation_exit");
});

test("T+1锁仓覆盖弱封、炸板和14:55规则，不生成任何减仓意图", () => {
  const rows = bars();
  rows.filter((row) => row.time >= "10:00").forEach((row) => {
    Object.assign(row, { open: 11, high: 11, low: 11, close: 11, amount: row.volume * 11 });
  });
  const ticks = sealTicks();
  const sealCandidate = {
    evidenceType: "seal_tick",
    source: "jqdata_tick",
    code: CODE,
    tradingDate: DATE,
    skip: false,
    contentHashScope: CANONICAL_SEAL_HASH_SCOPE,
    contentHash: computeSealTickContentHash(ticks),
    ticks,
  };
  const input = baseInput(rows, {
    position: { sellable: false, priceBasis: sameDayPriceBasis() },
  });
  input.minuteEvidence = hierarchy(rows, sealCandidate);
  const result = evaluateV7MinuteSell(input);
  assert.equal(result.lowerLayer.core1m.status, "entry_day_t1_locked");
  assert.equal(result.lowerLayer.full1mTick.status, "entry_day_t1_locked");
  assert.equal(result.lowerLayer.full1mTick.actualRemainingPositionPct, 100);
  assert.equal(result.lowerLayer.full1mTick.targetRemainingPositionPct, 100);
  assert.equal(result.lowerLayer.full1mTick.events.length, 0);
});

test("T+1不可卖日触及涨停但缺Tick时FULL也不要求封单证据", () => {
  const rows = bars();
  rows.filter((row) => row.time >= "10:00").forEach((row) => {
    Object.assign(row, { open: 11, high: 11, low: 11, close: 11, amount: row.volume * 11 });
  });
  const result = evaluateV7MinuteSell(baseInput(rows, {
    position: { sellable: false, priceBasis: sameDayPriceBasis() },
  }));
  assert.equal(result.status, "complete");
  assert.equal(result.lowerLayer.core1m.status, "entry_day_t1_locked");
  assert.equal(result.lowerLayer.full1mTick.status, "entry_day_t1_locked");
  assert.equal(result.evidence.sealTickAvailable, false);
});

test("Tick未覆盖首次封板到规则解决区间时FULL失败关闭", () => {
  const rows = bars();
  Object.assign(rows.find((row) => row.time === "10:00"), { open: 11, high: 11, low: 11, close: 11 });
  const ticks = Array.from({ length: 31 }, (_, second) => ({
    date: DATE,
    time: `14:00:${String(second).padStart(2, "0")}`,
    b1_p: 11,
    b1_v: 1000,
  }));
  const sealCandidate = {
    evidenceType: "seal_tick",
    source: "jqdata_tick",
    code: CODE,
    tradingDate: DATE,
    skip: false,
    contentHashScope: CANONICAL_SEAL_HASH_SCOPE,
    contentHash: computeSealTickContentHash(ticks),
    ticks,
  };
  const input = baseInput(rows);
  input.minuteEvidence = hierarchy(rows, sealCandidate);
  const result = evaluateV7MinuteSell(input);
  assert.equal(result.lowerLayer.full1mTick.status, "unavailable");
  assert(result.lowerLayer.full1mTick.blockers.some((reason) => (
    reason === "seal_tick_does_not_cover_first_limit_touch"
    || reason === "seal_initial_full_minute_not_covered"
  )));
});

test("炸板触发分钟不计入等待期，必须再经过5个完整一分钟未回封", () => {
  const rows = bars({
    "10:00": { open: 10.9, high: 11, low: 10.9, close: 11 },
    "10:01": { high: 10.8, low: 10.6, close: 10.7 },
    "10:02": { close: 10.7 },
    "10:03": { close: 10.7 },
    "10:04": { close: 10.7 },
    "10:05": { close: 10.7 },
    "10:06": { close: 10.7 },
  });
  const result = evaluateV7MinuteSell(baseInput(rows, {
    position: {
      entryPrice: 9,
      priceBasis: comparablePriceBasis({
        comparableEntryPrice: 9,
        comparableHighestPriceSinceEntry: 9,
      }),
    },
  }));
  const waitEvent = result.lowerLayer.core1m.events.find((event) => event.key === "limit_break_observed_above_protection");
  assert(waitEvent);
  assert.equal(waitEvent.at, "2026-05-22T02:06:00.000Z");
});

test("负反馈证据authority伪造时顶层传播incomplete而不是complete", () => {
  const result = evaluateV7MinuteSell(baseInput(bars(), {
    upperLayer: {
      negativeFeedback: {
        ...negativeFeedback(),
        authority: "forged_negative_feedback",
      },
    },
  }));
  assert.equal(result.status, "incomplete");
  assert(result.blockers.includes("negative_feedback_evidence_missing"));
});

test("15点后趋势资格不得倒灌14点55分继续持有", () => {
  const result = evaluateV7MinuteSell(baseInput(bars(), {
    upperLayer: {
      payload: { sourceTimestamp: `${DATE} 15:05:00` },
    },
  }));
  assert.equal(result.status, "incomplete");
  assert.equal(result.lowerLayer.core1m.status, "incomplete_defensive_exit");
  assert(result.lowerLayer.core1m.blockers.includes("sell_upper_context_invalid"));
  assert.equal(result.upperLayer.status, "invalid");
});

test("当日未来最高价不能预先注入70%浮盈保护线", () => {
  const result = evaluateV7MinuteSell(baseInput(bars(), {
    position: {
      priceBasis: comparablePriceBasis({
        comparableHighestPriceSinceEntry: 11,
        comparableHighestPriceSinceEntryAsOf: `${DATE} 14:00:00`,
      }),
    },
  }));
  assert.equal(result.status, "unavailable");
  assert(result.blockers.includes("highest_price_as_of_uses_current_session_future_data"));
});

test("历史最高价必须覆盖到上一完整交易日收盘", () => {
  const result = evaluateV7MinuteSell(baseInput(bars(), {
    position: {
      priceBasis: comparablePriceBasis({
        comparableHighestPriceSinceEntryAsOf: "2026-05-20 15:00:00",
      }),
    },
  }));
  assert.equal(result.status, "unavailable");
  assert(result.blockers.includes("highest_price_history_not_covered_through_previous_session_close"));
});

test("缺公司行动可比价格权威时V7整体不可用", () => {
  const result = evaluateV7MinuteSell(baseInput(bars(), {
    position: { priceBasis: { verified: false } },
  }));
  assert.equal(result.status, "unavailable");
  assert(result.blockers.includes("comparable_price_context_invalid"));
});

test("14:55分钟low穿越70%保护线后即使close收回也必须生成全卖意图", () => {
  const rows = bars({ "14:55": { open: 10.5, high: 10.6, low: 10.3, close: 10.5 } });
  const result = evaluateV7MinuteSell(baseInput(rows));
  assert.equal(result.lowerLayer.core1m.events.at(-1).key, "peak_profit_70_protection_exit");
  assert.equal(result.lowerLayer.core1m.finalAction, "CREATE_FULL_EXIT_INTENT");
});

test("调用方直接伪造sealEvidence不能绕过统一Tick证据层", () => {
  const rows = bars();
  rows.filter((row) => row.time >= "10:00").forEach((row) => {
    Object.assign(row, { open: 11, high: 11, low: 11, close: 11, amount: row.volume * 11 });
  });
  const input = baseInput(rows);
  input.sealEvidence = {
    verified: true,
    snapshots: sealTicks(),
    maxAllowedGapSeconds: 5,
  };
  const result = evaluateV7MinuteSell(input);
  assert.equal(result.lowerLayer.full1mTick.status, "unavailable");
  assert.equal(result.evidence.sealTickAvailable, false);
});

test("统一Tick证据在选择后被篡改也必须二次校验失败", () => {
  const rows = bars();
  rows.filter((row) => row.time >= "10:00").forEach((row) => {
    Object.assign(row, { open: 11, high: 11, low: 11, close: 11, amount: row.volume * 11 });
  });
  const sealCandidate = {
    evidenceType: "seal_tick",
    source: "jqdata_tick",
    code: CODE,
    tradingDate: DATE,
    skip: false,
    contentHashScope: CANONICAL_SEAL_HASH_SCOPE,
    contentHash: computeSealTickContentHash(sealTicks()),
    ticks: sealTicks(),
  };
  const input = baseInput(rows);
  input.minuteEvidence = hierarchy(rows, sealCandidate);
  input.minuteEvidence.sealTickEvidence.ticks[0].bid1Volume += 1;
  const result = evaluateV7MinuteSell(input);
  assert.equal(result.lowerLayer.full1mTick.status, "unavailable");
  assert(result.lowerLayer.full1mTick.blockers.includes("seal_tick_hierarchy_revalidation_failed"));
  assert(result.lowerLayer.full1mTick.blockers.includes("seal_tick_content_hash_mismatch"));
});

test("负反馈payload修改后未重算哈希必须失败关闭", () => {
  const evidence = negativeFeedback(false);
  evidence.payload.active = true;
  const result = evaluateV7MinuteSell(baseInput(bars(), {
    upperLayer: { negativeFeedback: evidence },
  }));
  assert.equal(result.status, "incomplete");
  assert(result.blockers.includes("negative_feedback_evidence_missing"));
});

test("除权日分钟原始价通过权威乘数转换后再与可比成本和MA5比较", () => {
  const rows = bars();
  rows.forEach((row) => {
    Object.assign(row, { open: 5.25, high: 5.25, low: 5.25, close: 5.25, amount: row.volume * 5.25 });
  });
  const result = evaluateV7MinuteSell(baseInput(rows, {
    position: {
      priceBasis: comparablePriceBasis({ minutePriceMultiplier: 2 }),
    },
    dailyContext: {
      previousClose: 5,
      highLimitPrice: 5.5,
      lowLimitPrice: 4.5,
    },
  }));
  assert.equal(result.lowerLayer.core1m.finalAction, "HOLD");
});

test("开盘时间戳分钟线按[barTime,barTime+60秒]校验首次封板Tick覆盖", () => {
  const rows = openStampedBars();
  rows.filter((row) => row.time >= "10:00").forEach((row) => {
    Object.assign(row, { open: 11, high: 11, low: 11, close: 11, amount: row.volume * 11 });
  });
  const ticks = [];
  for (let seconds = 30; seconds <= 180; seconds += 5) {
    const total = 10 * 3600 + seconds;
    ticks.push({
      date: DATE,
      time: `${String(Math.floor(total / 3600)).padStart(2, "0")}:${String(Math.floor(total / 60) % 60).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`,
      b1_p: 11,
      b1_v: seconds >= 150 ? 300 : 1000,
    });
  }
  const sealCandidate = {
    evidenceType: "seal_tick",
    source: "jqdata_tick",
    code: CODE,
    tradingDate: DATE,
    skip: false,
    contentHashScope: CANONICAL_SEAL_HASH_SCOPE,
    contentHash: computeSealTickContentHash(ticks),
    ticks,
  };
  const input = baseInput(rows);
  input.minuteEvidence = hierarchy(rows, sealCandidate);
  const result = evaluateV7MinuteSell(input);
  assert.equal(input.minuteEvidence.selectedPriceEvidence.timestampConvention, "BAR_START_ASIA_SHANGHAI");
  assert.equal(result.lowerLayer.full1mTick.status, "trend_hold");
  assert.equal(result.lowerLayer.full1mTick.targetRemainingPositionPct, 50);
});

test("BAR_START炸板分钟的Tick必须覆盖到该分钟结束", () => {
  const rows = openStampedBars({
    "14:50": { open: 11, high: 11, low: 11, close: 11 },
    "14:51": { open: 11, high: 11, low: 11, close: 11 },
    "14:52": { open: 11, high: 11, low: 10.9, close: 10.9 },
  });
  const ticks = [];
  for (let seconds = 14 * 3600 + 50 * 60; seconds <= 14 * 3600 + 52 * 60; seconds += 5) {
    ticks.push({
      date: DATE,
      time: `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`,
      b1_p: 11,
      b1_v: 1000,
    });
  }
  const sealCandidate = {
    evidenceType: "seal_tick",
    source: "jqdata_tick",
    code: CODE,
    tradingDate: DATE,
    skip: false,
    contentHashScope: CANONICAL_SEAL_HASH_SCOPE,
    contentHash: computeSealTickContentHash(ticks),
    ticks,
  };
  const input = baseInput(rows);
  input.minuteEvidence = hierarchy(rows, sealCandidate);
  const result = evaluateV7MinuteSell(input);
  assert.equal(result.lowerLayer.full1mTick.status, "unavailable");
  assert(result.lowerLayer.full1mTick.blockers.includes("seal_tick_coverage_ends_before_rule_resolution"));
});

test("BAR_START未炸板时Tick必须覆盖到策略14点55分截止", () => {
  const rows = openStampedBars();
  rows.filter((row) => row.time >= "14:50").forEach((row) => {
    Object.assign(row, { open: 11, high: 11, low: 11, close: 11, amount: row.volume * 11 });
  });
  const ticks = [];
  for (let seconds = 14 * 3600 + 50 * 60; seconds <= 14 * 3600 + 54 * 60; seconds += 5) {
    ticks.push({
      date: DATE,
      time: `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`,
      b1_p: 11,
      b1_v: 1000,
    });
  }
  const sealCandidate = {
    evidenceType: "seal_tick",
    source: "jqdata_tick",
    code: CODE,
    tradingDate: DATE,
    skip: false,
    contentHashScope: CANONICAL_SEAL_HASH_SCOPE,
    contentHash: computeSealTickContentHash(ticks),
    ticks,
  };
  const input = baseInput(rows);
  input.minuteEvidence = hierarchy(rows, sealCandidate);
  const result = evaluateV7MinuteSell(input);
  assert.equal(result.lowerLayer.full1mTick.status, "unavailable");
  assert(result.lowerLayer.full1mTick.blockers.includes("seal_tick_coverage_ends_before_rule_resolution"));

  const completeTicks = ticks.slice();
  for (let seconds = 14 * 3600 + 54 * 60 + 5; seconds <= 14 * 3600 + 55 * 60; seconds += 5) {
    completeTicks.push({
      date: DATE,
      time: `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`,
      b1_p: 11,
      b1_v: 1000,
    });
  }
  const completeCandidate = {
    ...sealCandidate,
    contentHash: computeSealTickContentHash(completeTicks),
    ticks: completeTicks,
  };
  const completeInput = baseInput(rows);
  completeInput.minuteEvidence = hierarchy(rows, completeCandidate);
  const completeResult = evaluateV7MinuteSell(completeInput);
  assert.equal(completeResult.lowerLayer.full1mTick.status, "trend_hold");
});

test("BAR_START只使用14点55分前已完成K线并固定按上海时区记录", () => {
  const rows = openStampedBars({
    "14:54": { open: 10.5, high: 10.5, low: 10.3, close: 10.5 },
    "14:55": { open: 9.2, high: 9.2, low: 9.2, close: 9.2 },
  });
  const result = evaluateV7MinuteSell(baseInput(rows));
  assert.equal(result.lowerLayer.core1m.events.at(-1).key, "peak_profit_70_protection_exit");
  assert.equal(result.lowerLayer.core1m.events.at(-1).at, "2026-05-22T06:55:00.000Z");
  assert.equal(result.lowerLayer.core1m.events.some((event) => event.key === "hard_stop_full_exit"), false);
});
