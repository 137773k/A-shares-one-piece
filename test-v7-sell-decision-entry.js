"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const {
  V7_SELL_DECISION_ENTRY_AUTHORITY,
  V7_POSITION_CONTEXT_AUTHORITY,
  V7_DAILY_CONTEXT_AUTHORITY,
  evaluateV7SellDecision,
} = require("./quant-decision/v7-sell-decision");
const {
  CANONICAL_MINUTE_HASH_SCOPE,
  computeMinuteContentHash,
} = require("./quant-decision/minute-evidence");
const {
  V7_COMPARABLE_PRICE_AUTHORITY,
  V7_NEGATIVE_FEEDBACK_AUTHORITY,
  v7StableSha256,
} = require("./sell-engine");
const { newWatchState, runWatchCycle } = require("./watchdog");

const DATE = "2026-05-22";
const CODE = "000001.XSHE";

function minuteBars() {
  const minutes = [];
  for (let minute = 9 * 60 + 31; minute <= 11 * 60 + 30; minute += 1) minutes.push(minute);
  for (let minute = 13 * 60 + 1; minute <= 15 * 60; minute += 1) minutes.push(minute);
  return minutes.map((minute, index) => ({
    timestamp: `${DATE} ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00`,
    open: 10.5,
    high: 10.5,
    low: 10.5,
    close: 10.5,
    volume: 1000 + index,
    money: (1000 + index) * 10.5,
  }));
}

function minuteCache() {
  const bars = minuteBars();
  return {
    authority: "jqdata_1m_execution_validation_v1",
    executionAuthority: false,
    provider: { name: "JQData", version: "1.9.8" },
    barIntervalMinutes: 1,
    priceMode: "raw_unadjusted",
    contentHashScope: CANONICAL_MINUTE_HASH_SCOPE,
    records: [{
      provider: "JQData",
      code: "000001",
      jqCode: CODE,
      tradingDate: DATE,
      barIntervalMinutes: 1,
      priceMode: "raw_unadjusted",
      status: "valid",
      validForExecutionReplay: true,
      validForV7: true,
      executionAuthority: false,
      scheduleQuality: { passed: true },
      contentHashScope: CANONICAL_MINUTE_HASH_SCOPE,
      contentHash: computeMinuteContentHash(bars),
      bars,
    }],
  };
}

function signed(authority, payload, extra = {}) {
  return {
    authority,
    payload,
    canonicalPayloadHash: v7StableSha256(payload),
    executionAuthority: false,
    ...extra,
  };
}

function input() {
  const pricePayload = {
    securityId: CODE,
    tradingDate: DATE,
    generationId: "production-entry-test",
    sourceHash: "b".repeat(64),
    entryFillTimestamp: "2026-05-21 10:00:00",
    minutePriceMultiplier: 1,
    comparableEntryPrice: 10,
    comparableHighestPriceSinceEntry: 10.5,
    comparableHighestPriceSinceEntryAsOf: "2026-05-21 15:00:00",
    comparablePreviousClose: 10,
    comparablePreviousFourCloses: [9.8, 9.8, 9.8, 9.8],
  };
  const upperPayload = {
    securityId: CODE,
    trendQualified: true,
    tradingDate: DATE,
    generationId: "production-entry-test",
    sourceDecisionHash: "b".repeat(64),
    sourceTimestamp: `${DATE} 14:54:00`,
  };
  const negativePayload = {
    active: false,
    tradingDate: DATE,
    generationId: "production-entry-test",
    sourceDecisionHash: "b".repeat(64),
    sourceTimestamp: `${DATE} 14:54:00`,
  };
  const positionPayload = {
    securityId: CODE,
    tradingDate: DATE,
    generationId: "production-entry-test",
    sourceDecisionHash: "b".repeat(64),
    sourceTimestamp: `${DATE} 14:54:00`,
    remainingPositionPct: 100,
    trendExtensionActive: true,
    sellable: true,
    sealHalfExitTaken: false,
    priceBasis: { verified: true, ...signed(V7_COMPARABLE_PRICE_AUTHORITY, pricePayload) },
  };
  const dailyPayload = {
    securityId: CODE,
    tradingDate: DATE,
    generationId: "production-entry-test",
    sourceDecisionHash: "b".repeat(64),
    sourceTimestamp: `${DATE} 14:54:00`,
    previousTradingDate: "2026-05-21",
    previousClose: 10,
    highLimitPrice: 11,
    lowLimitPrice: 9,
    previousDayVolume: 1000000,
    twoDaysAgoVolume: 900000,
    previousDayChangePct: 9.5,
  };
  return {
    tradingDate: DATE,
    positionContext: { verified: true, ...signed(V7_POSITION_CONTEXT_AUTHORITY, positionPayload) },
    dailyContext: { verified: true, ...signed(V7_DAILY_CONTEXT_AUTHORITY, dailyPayload) },
    upperLayer: {
      verified: true,
      ...signed("canonical_sell_upper_context_v1", upperPayload),
      negativeFeedback: { verified: true, ...signed(V7_NEGATIVE_FEEDBACK_AUTHORITY, negativePayload) },
    },
  };
}

test("生产V7入口从固定缓存重建分钟证据并保持无执行权", () => {
  const output = evaluateV7SellDecision(input(), { minuteCaches: [minuteCache()] });
  assert.equal(output.authority, V7_SELL_DECISION_ENTRY_AUTHORITY);
  assert.equal(output.status, "complete");
  assert.equal(output.executionAuthority, false);
  assert.equal(output.formalPerformanceEligible, false);
  assert.equal(output.minuteEvidence.priceTier, 1);
  assert.equal(output.result.lowerLayer.core1m.finalAction, "HOLD");
  assert.match(output.decisionHash, /^[a-f0-9]{64}$/);
  assert.equal(output.identity.securityId, "000001");
  assert.equal(output.identity.tradingDate, DATE);
  const watch = runWatchCycle(newWatchState(DATE), {
    time: "14:55",
    positions: [{ code: "000001", name: "平安银行" }],
    v7Decisions: { "000001": output },
  });
  assert.equal(watch.status, "disabled_post_close_replay_only");
  assert.deepEqual(watch.alerts.map((row) => row.gate), ["V7数据未就绪"]);
});

test("生产入口缺固定缓存时失败关闭且不接受调用方伪造selected证据", () => {
  const value = input();
  value.minuteEvidence = { authority: "forged", selectedPriceEvidence: { validForV7: true } };
  const output = evaluateV7SellDecision(value, { minuteCaches: [] });
  assert.equal(output.status, "unavailable");
  assert.equal(output.minuteEvidence.priceTier, null);
  assert(output.result.blockers.includes("minute_selected_evidence_missing"));
});

test("生产入口拒绝裸持仓、上下文篡改和跨证券身份污染", () => {
  const naked = input();
  naked.position = naked.positionContext.payload;
  delete naked.positionContext;
  assert.equal(
    evaluateV7SellDecision(naked, { minuteCaches: [minuteCache()] }).result.blockers[0],
    "production_context_identity_or_integrity_invalid",
  );

  const tampered = input();
  tampered.positionContext.payload.sellable = false;
  assert.equal(
    evaluateV7SellDecision(tampered, { minuteCaches: [minuteCache()] }).status,
    "unavailable",
  );

  const crossSecurity = input();
  crossSecurity.dailyContext.payload.securityId = "600000.XSHG";
  crossSecurity.dailyContext.canonicalPayloadHash = v7StableSha256(crossSecurity.dailyContext.payload);
  assert.equal(
    evaluateV7SellDecision(crossSecurity, { minuteCaches: [minuteCache()] }).status,
    "unavailable",
  );

  for (const mutate of [
    (payload) => { payload.generationId = "wrong-generation"; },
    (payload) => { payload.securityId = "000001.XSHG"; },
  ]) {
    const crossPriceBasis = input();
    const inner = crossPriceBasis.positionContext.payload.priceBasis;
    mutate(inner.payload);
    inner.canonicalPayloadHash = v7StableSha256(inner.payload);
    crossPriceBasis.positionContext.canonicalPayloadHash = v7StableSha256(
      crossPriceBasis.positionContext.payload,
    );
    assert.equal(
      evaluateV7SellDecision(crossPriceBasis, { minuteCaches: [minuteCache()] }).status,
      "unavailable",
    );
  }
});

test("服务端与watchdog生产入口均指向V7且缺证据不回退旧止损", () => {
  const serverSource = fs.readFileSync(require.resolve("./server"), "utf8");
  const entrySource = fs.readFileSync(require.resolve("./quant-decision/v7-sell-decision"), "utf8");
  assert(serverSource.includes('/api/sell-advisor/v7-evaluate'));
  assert(serverSource.includes("evaluateV7SellDecision"));
  assert.equal(entrySource.includes("input.sealTickEvidence"), false);

  const output = runWatchCycle(newWatchState(DATE), {
    time: "14:55",
    positions: [{ code: "000001", name: "平安银行", costPrice: 10 }],
    snapshots: { "000001": { price: 8, dayHigh: 10.5, ma5: 10 } },
  });
  assert.equal(output.authority, "canonical_v7_watchdog_projection_v1");
  assert.equal(output.executionAuthority, false);
  assert.deepEqual(output.alerts.map((row) => row.gate), ["V7数据未就绪"]);
});
