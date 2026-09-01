"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DECISION_OUTCOME_AUTHORITY,
  settleDecisionOutcome,
  inspectDecisionReceiptForSettlement,
  validateDecisionOutcome,
  hashStable,
} = require("./quant-decision/decision-outcome");
const {
  buildDecisionReceipt,
  validateDecisionReceipt,
  LIVE_CANONICAL_STATUS,
} = require("./quant-decision/decision-receipt");

function stock(code = "000001", overrides = {}) {
  return {
    code,
    name: `股票${code}`,
    rank: 1,
    positionAllocation: {
      relativeWeightPct: 100,
      initialPortfolioPct: 20,
      maximumPortfolioPct: 30,
    },
    executionReplayRule: {
      version: 1,
      authority: "canonical_next_day_trigger_window_v1",
      referencePrice: 10,
      earliestTime: "09:35",
      latestTime: "10:00",
      maxGapPct: 3,
      requirePositiveAmount: true,
      requireAboveAveragePrice: false,
    },
    ...overrides,
  };
}

function canonicalPayload(options = {}) {
  const stocks = options.stocks || [stock()];
  const authorized = options.authorized !== false;
  const generation = {
    generationId: "generation-1",
    tradingDate: "2026-08-21",
    asOf: "2026-08-21T15:30:00.000Z",
    aligned: true,
  };
  const result = {
    status: stocks.length ? "ready" : authorized ? "no_candidate" : "blocked",
    maxStocks: 5,
    selectedCount: stocks.length,
    selectedCodes: stocks.map((row) => row.code),
    stocks,
  };
  const marketStage = { status: "passed", passed: true };
  const authorization = {
    status: authorized ? "passed" : "blocked",
    passed: authorized,
    tradePermission: { allowNew: authorized, allowAdd: false },
    positionPermission: {
      positionCeilingPct: authorized ? 30 : 0,
      initialActivationPct: authorized ? 20 : 0,
    },
  };
  const observationStocks = options.observationStocks || [];
  const observationCandidates = {
    status: observationStocks.length ? "available" : "empty",
    observationOnly: true,
    executionAuthority: false,
    maxStocks: 5,
    selectedCount: observationStocks.length,
    selectedCodes: observationStocks.map((row) => row.code),
    stocks: observationStocks,
  };
  const chain = {
    version: 3,
    authority: "canonical_stock_decision",
    method: "strict_sequential_fail_closed_v1",
    generation: { ...generation },
    marketStage,
    authorization,
    profitEffect: authorized ? { status: "passed", passed: true } : { status: "not_evaluated", passed: false },
    theme: authorized ? { status: "passed", passed: true } : { status: "not_evaluated", passed: false },
    stockMode: authorized ? { status: "passed", passed: true } : { status: "not_evaluated", passed: false },
    stockSelectionContext: authorized ? { status: "passed", passed: true } : { status: "blocked", passed: false },
    steps: [],
    result,
    observationCandidates,
    integrity: {
      ok: true,
      failClosed: true,
      maxResultStocks: 5,
      noForcedCandidate: true,
      legacySelectedCanGrantMode: false,
      observationCandidatesCannotGrantExecution: true,
    },
  };
  const factors = {
    version: 6,
    method: "strict_sequential_decision_chain_v3",
    generation: { ...generation },
    marketStage,
    speculationPreference: {},
    profitEffects: {},
    permission: {
      final: { authority: "unified_decision_chain", allowNew: authorized },
      integrity: {
        source: "unified_decision_chain",
        chainValid: true,
        generationAligned: true,
      },
    },
    candidates: {
      finalResultCount: stocks.length,
      finalResultCodes: stocks.map((row) => row.code),
      maxFinalResults: 5,
      legacySelectedIsExecutionAuthority: false,
    },
    roleContract: {},
    factorRegistry: [],
    integrity: {
      ok: true,
      failClosed: true,
      legacySelectedIsNotExecution: true,
      observationCannotGrantPermission: true,
      strictSequentialDecisionChain: true,
      maxFiveFinalStocks: true,
      stockFactorEngineAligned: true,
      stockFactorEngineAuthority: "unified_stock_factor_engine_v4",
      stockFactorEngineVersion: 4,
    },
    decisionChain: chain,
  };
  const bestPicks = {
    selectionAuthority: "unified_decision_chain_v3",
    decisionChainVersion: 3,
    selectionContext: {
      authority: "canonical_market_phase_detail",
      generationId: generation.generationId,
      tradingDate: generation.tradingDate,
      asOf: generation.asOf,
    },
    picks: stocks.map((row) => ({
      code: row.code,
      name: row.name,
      price: row.executionReplayRule.referencePrice,
      priceIntegrity: { status: "verified", valid: true, price: row.executionReplayRule.referencePrice },
      executionReplayRule: row.executionReplayRule,
      buy: { mode: "回踩承接" },
      sell: { hardStop: { pctRange: [-5, -3] } },
      tomorrowExecution: { cancelConditions: ["跌破关键承接位"] },
    })),
  };
  return {
    generationContext: { version: 1, ...generation },
    unifiedDecisionChain: chain,
    unifiedQuantFactors: factors,
    bestPicks,
  };
}

function receipt(options = {}) {
  return buildDecisionReceipt(canonicalPayload(options), { snapshotKind: "closing" });
}

function nextSession(overrides = {}) {
  return {
    valid: true,
    authority: "provider_exact_previous_trading_date",
    tradingDate: "2026-08-24",
    previousTradingDate: "2026-08-21",
    executionAuthority: true,
    ...overrides,
  };
}

function daily(overrides = {}) {
  return {
    valid: true,
    code: "000001",
    nextTradingDate: "2026-08-24",
    source: "test_daily",
    currentTradingDate: "2026-08-21",
    currentClose: 10,
    nextOpen: 10.1,
    nextHigh: 10.8,
    nextLow: 9.9,
    nextClose: 10.7,
    priceDifferencePct: 0,
    executionAuthority: true,
    ...overrides,
  };
}

test("buildDecisionReceipt真实产物可直接进入结算器", () => {
  const built = receipt();
  assert.equal(built.status, LIVE_CANONICAL_STATUS, JSON.stringify(built.integrity.blockers));
  assert.equal(validateDecisionReceipt(built).valid, true);
  assert.equal(inspectDecisionReceiptForSettlement(built).ok, true);
});

test("只接受decision-receipt验证通过的live_canonical凭证", () => {
  const unavailable = buildDecisionReceipt({});
  const wrongAuthority = structuredClone(receipt());
  wrongAuthority.authority = "legacy_decision";
  const brokenIntegrity = structuredClone(receipt());
  brokenIntegrity.integrity.ok = false;
  const tamperedDecision = structuredClone(receipt());
  tamperedDecision.decision.result.stocks[0].name = "哈希后篡改";
  for (const badReceipt of [unavailable, wrongAuthority, brokenIntegrity, tamperedDecision]) {
    const outcome = settleDecisionOutcome({
      decisionReceipt: badReceipt,
      nextTradingDate: "2026-08-24",
      nextSessionEvidence: nextSession(),
      dailyOutcomes: { "000001": daily() },
      minuteOutcomes: { "000001": { valid: true, minuteBars: [] } },
    });
    assert.equal(outcome.status, "invalid_receipt");
    assert.equal(outcome.validOutcome, false);
    assert.equal(outcome.executionAuthority, false);
    assert.deepEqual(outcome.stocks, []);
  }
});

test("授权关闭且正式结果0只时按现金有效结算，不读取观察候选补票", () => {
  const decisionReceipt = receipt({
    stocks: [],
    authorized: false,
    observationStocks: [{
      code: "000001",
      name: "仅观察",
      observationOnly: true,
      executable: false,
      executionAuthority: false,
      tierKey: "reopen_candidate",
    }],
  });
  const outcome = settleDecisionOutcome({
    decisionReceipt,
    nextTradingDate: "2026-08-24",
    nextSessionEvidence: nextSession(),
  });
  assert.equal(outcome.status, "cash_only");
  assert.equal(outcome.validOutcome, true);
  assert.equal(outcome.cashOnly, true);
  assert.equal(outcome.cashOnlyReason, "trade_not_authorized");
  assert.deepEqual(outcome.stocks, []);
  assert.equal(outcome.portfolio.cashReserveAfterTriggersPct, 100);
  assert.equal(outcome.executionAuthority, false);
  assert.equal(validateDecisionOutcome(outcome, { decisionReceipt }).valid, true);
});

test("授权开放但正式结果0只同样按现金有效结算", () => {
  const decisionReceipt = receipt({ stocks: [] });
  const outcome = settleDecisionOutcome({
    decisionReceipt,
    nextTradingDate: "2026-08-24",
    nextSessionEvidence: nextSession(),
  });
  assert.equal(outcome.status, "cash_only");
  assert.equal(outcome.cashOnlyReason, "no_selected_stocks");
  assert.equal(outcome.validOutcome, true);
  assert.equal(outcome.portfolio.netReturnContributionPct, 0);
  assert.equal(validateDecisionOutcome(outcome, { decisionReceipt }).valid, true);
});

test("授权关闭却含正式股票的凭证视为损坏，不能结算", () => {
  const decisionReceipt = receipt({ authorized: false });
  const validation = validateDecisionReceipt(decisionReceipt);
  assert.equal(validation.valid, false);
  assert.equal(decisionReceipt.status, "unavailable");
  const outcome = settleDecisionOutcome({
    decisionReceipt,
    nextTradingDate: "2026-08-24",
    nextSessionEvidence: nextSession(),
  });
  assert.equal(outcome.status, "invalid_receipt");
  assert.deepEqual(outcome.stocks, []);
});

test("日线或分钟数据缺失时失败关闭，不生成完整组合收益", () => {
  const decisionReceipt = receipt();
  const missingDaily = settleDecisionOutcome({
    decisionReceipt,
    nextTradingDate: "2026-08-24",
    nextSessionEvidence: nextSession(),
    minuteOutcomes: {
      "000001": {
        valid: true,
        minuteBars: [
          { date: "2026-08-24", time: "09:35", open: 10.1, high: 10.3, low: 10, close: 10.2, amount: 1000 },
          { date: "2026-08-24", time: "09:40", open: 10.22, high: 10.4, low: 10.2, close: 10.3, amount: 1000 },
        ],
      },
    },
  });
  assert.equal(missingDaily.status, "incomplete");
  assert.equal(missingDaily.stocks[0].status, "data_missing");
  assert.equal(missingDaily.stocks[0].executionReplay, null);
  assert.equal(missingDaily.portfolio.netReturnContributionPct, null);
  assert.equal(validateDecisionOutcome(missingDaily, { decisionReceipt }).valid, true);

  const missingMinute = settleDecisionOutcome({
    decisionReceipt,
    nextTradingDate: "2026-08-24",
    nextSessionEvidence: nextSession(),
    dailyOutcomes: { "000001": daily() },
  });
  assert.equal(missingMinute.status, "incomplete");
  assert.equal(missingMinute.stocks[0].status, "data_missing");
  assert(missingMinute.stocks[0].blockers.includes("intraday_execution_bars_missing"));
  assert.equal(missingMinute.stocks[0].dailyOutcome.valid, true);
});

test("窗口内未满足触发规则时有效记录未触发并保持现金", () => {
  const outcome = settleDecisionOutcome({
    decisionReceipt: receipt(),
    nextTradingDate: "2026-08-24",
    nextSessionEvidence: nextSession(),
    dailyOutcomes: { "000001": daily() },
    minuteOutcomes: {
      "000001": {
        validForExecutionReplay: true,
        source: "test_minute",
        minuteBars: [
          { date: "2026-08-24", time: "09:35", open: 11, high: 11, low: 11, close: 11, amount: 1000 },
          { date: "2026-08-24", time: "09:40", open: 10.2, high: 10.3, low: 10.1, close: 10.2, amount: 0 },
        ],
      },
    },
  });
  assert.equal(outcome.status, "not_triggered");
  assert.equal(outcome.validOutcome, true);
  assert.equal(outcome.cashOnly, true);
  assert.equal(outcome.stocks[0].status, "not_triggered");
  assert.equal(outcome.stocks[0].triggered, false);
  assert.equal(outcome.portfolio.netReturnContributionPct, 0);
});

test("触发后按下一根分钟K线成交，计算显式滑点费用与仓位贡献", () => {
  const decisionReceipt = receipt();
  const outcome = settleDecisionOutcome({
    decisionReceipt,
    nextTradingDate: "2026-08-24",
    nextSessionEvidence: nextSession(),
    dailyOutcomes: { "000001": daily() },
    minuteOutcomes: {
      "000001": {
        validForExecutionReplay: true,
        source: "test_minute",
        minuteBars: [
          { date: "2026-08-24", time: "09:35", open: 10.1, high: 10.25, low: 10.05, close: 10.2, amount: 1200 },
          { date: "2026-08-24", time: "09:40", open: 10.22, high: 10.3, low: 10.2, close: 10.28, amount: 1500 },
        ],
      },
    },
    slippageBps: 5,
    feeBps: 8,
  });
  assert.equal(outcome.authority, DECISION_OUTCOME_AUTHORITY);
  assert.equal(outcome.status, "settled");
  assert.equal(outcome.validOutcome, true);
  assert.equal(outcome.cashOnly, false);
  assert.equal(outcome.stocks[0].status, "triggered");
  assert.equal(outcome.stocks[0].filled, true);
  assert.equal(outcome.stocks[0].executionReplay.fill.rawFillPrice, 10.22);
  assert(outcome.stocks[0].executionReplay.outcome.netReturnPct
    < outcome.stocks[0].executionReplay.outcome.grossReturnPct);
  assert.equal(outcome.portfolio.triggeredInitialPortfolioPct, 20);
  assert.equal(outcome.portfolio.cashReserveAfterTriggersPct, 80);
  assert(outcome.portfolio.netReturnContributionPct > 0);
  assert.equal(outcome.executionAuthority, false);
  assert.equal(outcome.stocks[0].executionAuthority, false);
  assert.equal(outcome.stocks[0].dailyOutcome.executionAuthority, undefined);
  assert.equal(outcome.nextSessionEvidence.executionAuthority, false);
  assert.equal(outcome.receiptBinding.receiptId, decisionReceipt.receiptId);
  assert.equal(outcome.receiptBinding.decisionHash, decisionReceipt.hashes.decisionHash);
  assert.deepEqual(validateDecisionOutcome(outcome, { decisionReceipt }), {
    valid: true,
    reasons: [],
    receiptId: decisionReceipt.receiptId,
    decisionHash: decisionReceipt.hashes.decisionHash,
    status: "settled",
  });
});

test("相同凭证和相同注入数据的结算完全幂等，decisionHash变化会改变绑定身份", () => {
  const options = {
    decisionReceipt: receipt(),
    nextTradingDate: "2026-08-24",
    nextSessionEvidence: nextSession(),
    dailyOutcomes: { "000001": daily() },
    minuteOutcomes: {
      "000001": {
        valid: true,
        minuteBars: [
          { date: "2026-08-24", time: "09:35", open: 10.1, high: 10.2, low: 10, close: 10.1, amount: 1000 },
          { date: "2026-08-24", time: "09:40", open: 10.15, high: 10.3, low: 10.1, close: 10.2, amount: 1200 },
        ],
      },
    },
  };
  const first = settleDecisionOutcome(options);
  const second = settleDecisionOutcome(structuredClone(options));
  assert.deepEqual(second, first);
  assert.equal(second.outcomeId, first.outcomeId);
  assert.equal(second.settlementHash, first.settlementHash);

  const changed = structuredClone(options);
  changed.decisionReceipt.hashes.decisionHash = "a".repeat(64);
  const changedOutcome = settleDecisionOutcome(changed);
  assert.notEqual(changedOutcome.outcomeId, first.outcomeId);
  assert.notEqual(changedOutcome.settlementHash, first.settlementHash);
  assert.equal(changedOutcome.receiptBinding.decisionHash, "a".repeat(64));
});

test("日期错配的注入数据不能参与结算", () => {
  const outcome = settleDecisionOutcome({
    decisionReceipt: receipt(),
    nextTradingDate: "2026-08-24",
    nextSessionEvidence: nextSession(),
    dailyOutcomes: { "000001": daily({ nextTradingDate: "2026-08-25" }) },
    minuteOutcomes: {
      "000001": {
        valid: true,
        minuteBars: [
          { date: "2026-08-24", time: "09:35", open: 10.1, high: 10.2, low: 10, close: 10.1, amount: 1000 },
        ],
      },
    },
  });
  assert.equal(outcome.status, "incomplete");
  assert.equal(outcome.stocks[0].status, "data_missing");
  assert(outcome.stocks[0].blockers.includes("daily_outcome_date_mismatch"));
});

test("nextTradingDate必须由精确上一交易日证据链接到凭证T日", () => {
  const decisionReceipt = receipt({ stocks: [], authorized: false });
  const outcome = settleDecisionOutcome({
    decisionReceipt,
    nextTradingDate: "2026-08-24",
    nextSessionEvidence: nextSession({ previousTradingDate: "2026-08-20" }),
  });
  assert.equal(outcome.status, "invalid_settlement_input");
  assert.equal(outcome.validOutcome, false);
  assert(outcome.blockers.includes("next_session_not_exact_t1"));
  assert.deepEqual(outcome.stocks, []);
  assert.equal(validateDecisionOutcome(outcome, { decisionReceipt }).valid, true);
});

test("T日收盘与凭证冻结参考价超过容差时价格完整性失败", () => {
  const outcome = settleDecisionOutcome({
    decisionReceipt: receipt(),
    nextTradingDate: "2026-08-24",
    nextSessionEvidence: nextSession(),
    dailyOutcomes: { "000001": daily({ currentClose: 10.2, priceDifferencePct: 0 }) },
    minuteOutcomes: {
      "000001": {
        valid: true,
        minuteBars: [
          { date: "2026-08-24", time: "09:35", open: 10.1, high: 10.2, low: 10, close: 10.1, amount: 1000 },
          { date: "2026-08-24", time: "09:40", open: 10.15, high: 10.3, low: 10.1, close: 10.2, amount: 1200 },
        ],
      },
    },
  });
  assert.equal(outcome.status, "incomplete");
  assert.equal(outcome.stocks[0].status, "data_missing");
  assert(outcome.stocks[0].blockers.includes("daily_reference_price_mismatch"));
  assert.equal(outcome.portfolio.netReturnContributionPct, null);
});

test("分钟质量或每根bar的T+1日期缺失时不能用于成交回放", () => {
  const outcome = settleDecisionOutcome({
    decisionReceipt: receipt(),
    nextTradingDate: "2026-08-24",
    nextSessionEvidence: nextSession(),
    dailyOutcomes: { "000001": daily() },
    minuteOutcomes: {
      "000001": {
        validForExecutionReplay: true,
        minuteBars: [
          { time: "09:35", open: 10.1, high: 10.2, low: 10, close: 10.1, amount: 1000 },
          { date: "2026-08-24", time: "09:40", open: 10.15, high: 10.3, low: 10.1, close: 10.2, amount: 1200 },
        ],
      },
    },
  });
  assert.equal(outcome.status, "incomplete");
  assert.equal(outcome.stocks[0].status, "data_missing");
  assert(outcome.stocks[0].blockers.includes("minute_bar_date_missing"));
});

test("结算读回校验能发现重算哈希后的股票替换，不能扩容或串票", () => {
  const decisionReceipt = receipt();
  const outcome = settleDecisionOutcome({
    decisionReceipt,
    nextTradingDate: "2026-08-24",
    nextSessionEvidence: nextSession(),
    dailyOutcomes: { "000001": daily() },
    minuteOutcomes: {
      "000001": {
        validForExecutionReplay: true,
        minuteBars: [
          { date: "2026-08-24", time: "09:35", open: 11, high: 11, low: 11, close: 11, amount: 1000 },
          { date: "2026-08-24", time: "09:40", open: 10.2, high: 10.3, low: 10.1, close: 10.2, amount: 0 },
        ],
      },
    },
  });
  assert.equal(validateDecisionOutcome(outcome, { decisionReceipt }).valid, true);

  const tampered = structuredClone(outcome);
  tampered.stocks[0].code = "600000";
  const withoutHash = structuredClone(tampered);
  delete withoutHash.settlementHash;
  tampered.settlementHash = hashStable(withoutHash);
  const validation = validateDecisionOutcome(tampered, { decisionReceipt });
  assert.equal(validation.valid, false);
  assert(validation.reasons.includes("outcome_expands_or_changes_receipt_stocks"));
});
