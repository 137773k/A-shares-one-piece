"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DECISION_RECEIPT_AUTHORITY,
  DECISION_RECEIPT_VERSION,
  LIVE_CANONICAL_STATUS,
  UNAVAILABLE_STATUS,
  stableSerialize,
  sha256Hex,
  stableSha256,
  validateCanonicalSource,
  buildDecisionReceipt,
  validateDecisionReceipt,
} = require("./quant-decision/decision-receipt");

function fixture(options = {}) {
  const generation = {
    generationId: "2026-08-21:2026-08-21T15:32:25.611Z",
    tradingDate: "2026-08-21",
    asOf: "2026-08-21T15:32:25.611Z",
    aligned: true,
  };
  const resultStocks = options.resultStocks || [];
  const selectedCodes = resultStocks.map((stock) => stock.code);
  const ready = resultStocks.length > 0;
  const authorizationOpen = options.authorizationOpen === true || ready;
  const chain = {
    version: 3,
    authority: "canonical_stock_decision",
    method: "strict_sequential_fail_closed_v1",
    generation: { ...generation },
    marketStage: {
      status: "passed",
      passed: true,
      bigCycle: { key: "range", label: "震荡" },
      smallCycle: { key: "strengthening", label: "加强" },
      emotionStage: { key: "warming", label: "回暖" },
    },
    authorization: {
      status: authorizationOpen ? "passed" : "blocked",
      passed: authorizationOpen,
      tradePermission: {
        status: authorizationOpen ? "conditional" : "blocked",
        allowNew: authorizationOpen,
        allowAdd: false,
        reasons: authorizationOpen ? [] : ["短线交易窗口未通过"],
      },
      tradeValue: { key: authorizationOpen ? "conditional" : "none" },
      positionPermission: {
        status: authorizationOpen ? "conditional" : "blocked",
        positionCeilingPct: authorizationOpen ? 30 : 0,
        initialActivationPct: authorizationOpen ? 15 : 0,
      },
    },
    profitEffect: authorizationOpen ? { status: "passed", passed: true } : {
      status: "not_evaluated", passed: false,
    },
    theme: authorizationOpen ? { status: "passed", passed: true } : {
      status: "not_evaluated", passed: false,
    },
    stockMode: authorizationOpen ? { status: "passed", passed: true } : {
      status: "not_evaluated", passed: false,
    },
    stockSelectionContext: authorizationOpen ? {
      status: "passed",
      passed: true,
      authority: "canonical_market_phase_detail",
      ...generation,
    } : { status: "blocked", passed: false },
    observationCandidates: {
      status: "empty",
      observationOnly: true,
      executionAuthority: false,
      maxStocks: 5,
      selectedCount: 0,
      selectedCodes: [],
      stocks: [],
      groups: {},
    },
    result: {
      status: ready ? "ready" : authorizationOpen ? "no_candidate" : "blocked",
      maxStocks: 5,
      sourceCount: resultStocks.length,
      hardGateEligibleCount: resultStocks.length,
      selectedCount: resultStocks.length,
      selectedCodes,
      stocks: resultStocks,
      rejected: [],
      participationAndAllocation: {
        status: ready ? "available" : "not_applicable",
        positionCeilingPct: authorizationOpen ? 30 : 0,
        initialActivationPct: authorizationOpen ? 15 : 0,
      },
    },
    steps: [
      { order: 1, key: "market_stage", status: "passed" },
      { order: 2, key: "authorization", status: authorizationOpen ? "passed" : "blocked" },
      { order: 3, key: "profit_effect", status: authorizationOpen ? "passed" : "not_evaluated" },
      { order: 4, key: "theme", status: authorizationOpen ? "passed" : "not_evaluated" },
      { order: 5, key: "stock_mode", status: authorizationOpen ? "passed" : "not_evaluated" },
      { order: 6, key: "stock_hard_gate", status: ready ? "passed" : "blocked" },
      { order: 7, key: "result_stocks", status: ready ? "ready" : "blocked" },
      { order: 8, key: "participation_allocation", status: ready ? "available" : "not_applicable" },
    ],
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
    generation: {
      ...generation,
      snapshotKind: "closing",
    },
    marketStage: chain.marketStage,
    speculationPreference: { combined: { mode: "macro_micro_overlay" } },
    profitEffects: { tradeable: { status: authorizationOpen ? "available" : "empty" } },
    permission: {
      final: {
        authority: "unified_decision_chain",
        allowNew: authorizationOpen,
      },
      integrity: {
        source: "unified_decision_chain",
        chainValid: true,
        generationAligned: true,
      },
    },
    candidates: {
      universeCount: 200,
      legacySelectedCount: 2,
      finalResultCount: resultStocks.length,
      finalResultCodes: selectedCodes,
      maxFinalResults: 5,
      legacySelectedIsExecutionAuthority: false,
    },
    roleContract: { executionRole: "可执行/条件观察/仅复盘" },
    factorRegistry: [
      { id: "market.big_cycle", authority: "canonical" },
      { id: "result.max_five", authority: "canonical_stock_output" },
    ],
    integrity: {
      status: "valid",
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
    picks: resultStocks.map((stock) => ({
      code: stock.code,
      name: stock.name,
      price: 10,
      priceIntegrity: { status: "verified", valid: true, price: 10 },
      executionReplayRule: {
        version: 1,
        authority: "canonical_next_day_trigger_window_v1",
        referencePrice: 10,
        earliestTime: "09:35",
        latestTime: "10:00",
        maxGapPct: 3,
        requirePositiveAmount: true,
        requireAboveAveragePrice: false,
        executionAuthority: false,
      },
      buy: { mode: "回踩承接" },
      sell: { hardStop: { pctRange: [-5, -3] } },
      tomorrowExecution: { cancelConditions: ["跌破关键承接位"] },
    })),
  };
  return {
    generationContext: {
      version: 1,
      generationId: generation.generationId,
      tradingDate: generation.tradingDate,
      asOf: generation.asOf,
    },
    generationId: generation.generationId,
    tradingDate: generation.tradingDate,
    asOf: generation.asOf,
    unifiedDecisionChain: chain,
    unifiedQuantFactors: factors,
    bestPicks,
    // 这些都是旧迁移字段；无论值是什么都不能进入正式凭证结果。
    selected: [{ code: "999999", name: "旧selected伪候选" }],
    candidates: [{ code: "888888", selected: true }],
  };
}

function buildReceipt(payload, options = {}) {
  return buildDecisionReceipt(payload, { snapshotKind: "closing", ...options });
}

function resultStock(code = "600460") {
  return {
    rank: 1,
    code,
    name: "权威结果股",
    participationValue: { score: 82 },
    riskAdjustment: { score: -8 },
    riskAdjustedParticipationScore: 74,
    positionAllocation: {
      relativeWeightPct: 100,
      initialPortfolioPct: 15,
      maximumPortfolioPct: 30,
    },
  };
}

test("稳定序列化不受对象键插入顺序影响，SHA-256使用标准十六进制", () => {
  const left = { b: 2, a: { z: 1, x: 2 } };
  const right = { a: { x: 2, z: 1 }, b: 2 };
  assert.equal(stableSerialize(left), '{"a":{"x":2,"z":1},"b":2}');
  assert.equal(stableSerialize(left), stableSerialize(right));
  assert.equal(stableSha256(left), stableSha256(right));
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("正式结果为0只仍生成live_canonical凭证，旧selected不获得执行权", () => {
  const payload = fixture();
  const receipt = buildReceipt(payload);
  const validation = validateDecisionReceipt(receipt, { sourcePayload: payload });

  assert.equal(receipt.version, DECISION_RECEIPT_VERSION);
  assert.equal(receipt.authority, DECISION_RECEIPT_AUTHORITY);
  assert.equal(receipt.status, LIVE_CANONICAL_STATUS);
  assert.equal(receipt.generation.aligned, true);
  assert.equal(receipt.decision.result.status, "blocked");
  assert.equal(receipt.decision.result.selectedCount, 0);
  assert.deepEqual(receipt.decision.result.stocks, []);
  assert.equal(receipt.source.canonicalResultPath, "unifiedDecisionChain.result.stocks");
  assert.equal(receipt.source.legacySelectedIsExecutionAuthority, false);
  assert.match(receipt.hashes.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(receipt).includes("999999"), false);
  assert.equal(JSON.stringify(receipt).includes("888888"), false);
  assert.equal(validation.valid, true);
  assert.equal(validation.sourceHashVerified, true);
});

test("凭证只冻结统一链正式结果，保留参与价值与仓位配比", () => {
  const payload = fixture({ resultStocks: [resultStock()] });
  payload.bestPicks.picks.push({
    code: "999999",
    executionReplayRule: {
      version: 1,
      authority: "canonical_next_day_trigger_window_v1",
      referencePrice: 99,
      earliestTime: "09:35",
      latestTime: "10:00",
      maxGapPct: 3,
    },
  });
  const receipt = buildReceipt(payload);

  assert.equal(receipt.status, LIVE_CANONICAL_STATUS);
  assert.equal(receipt.decision.result.selectedCount, 1);
  assert.equal(receipt.decision.result.stocks[0].code, "600460");
  assert.equal(receipt.decision.result.stocks[0].riskAdjustedParticipationScore, 74);
  assert.equal(receipt.decision.result.stocks[0].positionAllocation.initialPortfolioPct, 15);
  assert.equal(receipt.decision.result.stocks[0].executionReplayRule.authority, "canonical_next_day_trigger_window_v1");
  assert.equal(receipt.decision.result.stocks[0].price, 10);
  assert.equal(receipt.decision.result.stocks[0].priceIntegrity.valid, true);
  assert.equal(receipt.decision.result.stocks[0].buy.mode, "回踩承接");
  assert.deepEqual(receipt.decision.result.stocks[0].cancelConditions, ["跌破关键承接位"]);
  assert.equal(receipt.decision.result.stocks.some((stock) => stock.code === "999999"), false);
  assert.equal(receipt.decision.factorSnapshot.candidates.legacySelectedCount, 2);
  assert.equal(receipt.decision.factorSnapshot.candidates.legacySelectedIsExecutionAuthority, false);
  assert.equal(validateDecisionReceipt(receipt).valid, true);
});

test("非空结果缺等码bestPick或缺机器回放规则时整张凭证失败关闭", () => {
  const noMatch = fixture({ resultStocks: [resultStock()] });
  noMatch.bestPicks.picks = [];
  const noMatchReceipt = buildReceipt(noMatch);
  assert.equal(noMatchReceipt.status, UNAVAILABLE_STATUS);
  assert(noMatchReceipt.integrity.blockers.includes("best_picks_result_match_missing_or_ambiguous"));
  assert.deepEqual(noMatchReceipt.decision.result.stocks, []);

  const noRule = fixture({ resultStocks: [resultStock()] });
  delete noRule.bestPicks.picks[0].executionReplayRule;
  const noRuleReceipt = buildReceipt(noRule);
  assert.equal(noRuleReceipt.status, UNAVAILABLE_STATUS);
  assert(noRuleReceipt.integrity.blockers.includes("execution_replay_rule_missing_or_invalid"));
  assert.deepEqual(noRuleReceipt.decision.result.stocks, []);
});

test("只有显式closing快照能生成live_canonical，intraday或unknown保持unavailable", () => {
  const payload = fixture();
  for (const snapshotKind of [undefined, "intraday", "unknown"]) {
    const receipt = buildDecisionReceipt(payload, { snapshotKind });
    assert.equal(receipt.status, UNAVAILABLE_STATUS, String(snapshotKind));
    assert(receipt.integrity.blockers.includes("snapshot_not_closing"), String(snapshotKind));
    assert.deepEqual(receipt.decision.result.stocks, []);
  }

  const live = buildReceipt(payload);
  assert.equal(live.source.snapshotKind, "closing");
  const wrongValidation = validateDecisionReceipt(live, { snapshotKind: "intraday" });
  assert.equal(wrongValidation.valid, false);
  assert(wrongValidation.reasons.includes("snapshot_not_closing"));
});

test("结果股仓位缺失、负值、单股反向或组合超授权均不能进入正式凭证", () => {
  const cases = [
    (stock) => { delete stock.positionAllocation.initialPortfolioPct; },
    (stock) => { stock.positionAllocation.relativeWeightPct = -1; },
    (stock) => { stock.positionAllocation.initialPortfolioPct = 31; },
    (stock) => { stock.positionAllocation.maximumPortfolioPct = 101; },
  ];
  cases.forEach((mutate) => {
    const payload = fixture({ resultStocks: [resultStock()] });
    mutate(payload.unifiedDecisionChain.result.stocks[0]);
    payload.unifiedQuantFactors.decisionChain = payload.unifiedDecisionChain;
    const receipt = buildReceipt(payload);
    assert.equal(receipt.status, UNAVAILABLE_STATUS);
    assert(receipt.integrity.blockers.includes("result_allocation_invalid"));
  });
});

test("相同权威输入生成完全相同的receiptId与哈希，生成后不受源对象突变影响", () => {
  const firstPayload = fixture({ resultStocks: [resultStock()] });
  const secondPayload = JSON.parse(JSON.stringify(firstPayload));
  const first = buildReceipt(firstPayload);
  const second = buildReceipt(secondPayload);
  assert.equal(first.receiptId, second.receiptId);
  assert.deepEqual(first.hashes, second.hashes);
  assert.equal(stableSerialize(first), stableSerialize(second));

  firstPayload.unifiedDecisionChain.result.stocks[0].name = "源对象后来被修改";
  assert.equal(first.decision.result.stocks[0].name, "权威结果股");
});

test("显式纠错lineage参与receiptHash，缺原因或指向自身时失败关闭", () => {
  const payload = fixture();
  const plain = buildReceipt(payload);
  const superseding = buildReceipt(payload, {
    lineage: {
      supersedesReceiptId: "2026-08-21:older-receipt",
      supersedeReason: "收盘供应商修正了最终成交额",
    },
  });
  assert.equal(superseding.status, LIVE_CANONICAL_STATUS);
  assert.equal(superseding.lineage.supersedesReceiptId, "2026-08-21:older-receipt");
  assert.equal(superseding.lineage.supersedeReason, "收盘供应商修正了最终成交额");
  assert.equal(superseding.hashes.decisionHash, plain.hashes.decisionHash);
  assert.notEqual(superseding.hashes.receiptHash, plain.hashes.receiptHash);
  assert.equal(validateDecisionReceipt(superseding).valid, true);

  const missingReason = buildReceipt(payload, {
    supersedesReceiptId: "2026-08-21:older-receipt",
  });
  assert.equal(missingReason.status, UNAVAILABLE_STATUS);
  assert(missingReason.integrity.blockers.includes("lineage_invalid"));
  assert.equal(missingReason.lineage, null);
  assert.equal(validateDecisionReceipt(missingReason).wellFormed, true);

  const selfSupersede = buildReceipt(payload, {
    supersedesReceiptId: plain.receiptId,
    supersedeReason: "错误地指向同一凭证",
  });
  assert.equal(selfSupersede.status, UNAVAILABLE_STATUS);
  assert(selfSupersede.integrity.blockers.includes("lineage_cannot_supersede_self"));
  assert.equal(selfSupersede.lineage, null);
  assert.equal(validateDecisionReceipt(selfSupersede).wellFormed, true);

  const tampered = JSON.parse(JSON.stringify(superseding));
  tampered.lineage.supersedeReason = "篡改后的原因";
  const tamperedValidation = validateDecisionReceipt(tampered);
  assert.equal(tamperedValidation.valid, false);
  assert(tamperedValidation.reasons.includes("receipt_hash_mismatch"));
});

test("任一版本、authority或同代校验失败都降级为unavailable且不伪造股票", () => {
  const cases = [
    ["chain version", (payload) => { payload.unifiedDecisionChain.version = 2; }, "unified_decision_chain_version_mismatch"],
    ["chain authority", (payload) => { payload.unifiedDecisionChain.authority = "legacy_picker"; }, "unified_decision_chain_authority_invalid"],
    ["factor version", (payload) => { payload.unifiedQuantFactors.version = 5; }, "unified_quant_factors_version_mismatch"],
    ["generation", (payload) => { payload.unifiedQuantFactors.generation.generationId = "2026-08-21:other"; }, "generation_not_aligned"],
  ];
  cases.forEach(([label, mutate, reason]) => {
    const payload = fixture({ resultStocks: [resultStock()] });
    mutate(payload);
    const receipt = buildReceipt(payload);
    assert.equal(receipt.status, UNAVAILABLE_STATUS, label);
    assert.equal(receipt.decision.result.status, UNAVAILABLE_STATUS, label);
    assert.equal(receipt.decision.result.authoritative, false, label);
    assert.deepEqual(receipt.decision.result.stocks, [], label);
    assert(receipt.integrity.blockers.includes(reason), label);
    const validation = validateDecisionReceipt(receipt);
    assert.equal(validation.valid, false, label);
    assert.equal(validation.wellFormed, true, label);
  });
});

test("统一因子内嵌决策链与权威链不一致时失败关闭", () => {
  const payload = fixture({ resultStocks: [resultStock()] });
  payload.unifiedQuantFactors.decisionChain = JSON.parse(JSON.stringify(payload.unifiedDecisionChain));
  payload.unifiedQuantFactors.decisionChain.result.stocks[0].code = "000001";
  const receipt = buildReceipt(payload);

  assert.equal(receipt.status, UNAVAILABLE_STATUS);
  assert(receipt.integrity.blockers.includes("unified_quant_factors_chain_mismatch"));
  assert.deepEqual(receipt.decision.result.stocks, []);
});

test("超过5只或结果代码不一致时不能生成live_canonical", () => {
  const sixStocks = Array.from({ length: 6 }, (_value, index) => resultStock(`60000${index}`));
  const tooMany = fixture({ resultStocks: sixStocks });
  const tooManyReceipt = buildReceipt(tooMany);
  assert.equal(tooManyReceipt.status, UNAVAILABLE_STATUS);
  assert(tooManyReceipt.integrity.blockers.includes("result_count_exceeds_limit"));

  const mismatch = fixture({ resultStocks: [resultStock()] });
  mismatch.unifiedDecisionChain.result.selectedCodes = ["000001"];
  mismatch.unifiedQuantFactors.decisionChain = mismatch.unifiedDecisionChain;
  const mismatchReceipt = buildReceipt(mismatch);
  assert.equal(mismatchReceipt.status, UNAVAILABLE_STATUS);
  assert(mismatchReceipt.integrity.blockers.includes("result_codes_or_count_mismatch"));
});

test("篡改冻结后的决策内容会被decisionHash和receiptHash同时发现", () => {
  const receipt = buildReceipt(fixture({ resultStocks: [resultStock()] }));
  const tampered = JSON.parse(JSON.stringify(receipt));
  tampered.decision.result.stocks[0].positionAllocation.initialPortfolioPct = 99;
  const validation = validateDecisionReceipt(tampered);

  assert.equal(validation.valid, false);
  assert(validation.reasons.includes("decision_hash_mismatch"));
  assert(validation.reasons.includes("receipt_hash_mismatch"));
});

test("缺失或循环源对象也返回可归档的unavailable凭证，不抛异常", () => {
  const missing = buildReceipt({ selected: [{ code: "999999" }] });
  assert.equal(missing.status, UNAVAILABLE_STATUS);
  assert.deepEqual(missing.decision.result.stocks, []);
  const missingValidation = validateDecisionReceipt(missing, {
    sourcePayload: { selected: [{ code: "999999" }] },
    snapshotKind: "closing",
  });
  assert.equal(missingValidation.wellFormed, true);
  assert.equal(missingValidation.sourceHashVerified, null);
  assert.equal(missing.hashes.sourceHash, null);

  const cyclic = fixture();
  cyclic.unifiedDecisionChain.circular = cyclic.unifiedDecisionChain;
  const cyclicReceipt = buildReceipt(cyclic);
  assert.equal(cyclicReceipt.status, UNAVAILABLE_STATUS);
  assert(cyclicReceipt.integrity.blockers.includes("source_serialization_failed"));
  assert.deepEqual(cyclicReceipt.decision.result.stocks, []);
});

test("canonical source检查器可单独用于归档前预检", () => {
  const valid = validateCanonicalSource(fixture(), { snapshotKind: "closing" });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.reasons, []);

  const invalid = fixture();
  invalid.unifiedQuantFactors.integrity.legacySelectedIsNotExecution = false;
  assert.equal(validateCanonicalSource(invalid, { snapshotKind: "closing" }).valid, false);
  assert(validateCanonicalSource(invalid, { snapshotKind: "closing" }).reasons.includes("unified_quant_factors_integrity_invalid"));
});
