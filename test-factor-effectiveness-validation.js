"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { _internals } = require("./server");
const {
  normalizeTradingDate,
  snapshotTradingDate,
  loadHistoricalSnapshots,
  migrateHistoricalClosingSnapshot,
  buildHistoricalMigrationAudit,
  buildExactT1Pairs,
  buildOutcome,
  buildKlineOutcome,
  buildAllocatedPortfolioRow,
  cycleContext,
  factorEvidenceLabels,
  summarizeFactorEvidenceAudit,
  executionReplayForPick,
  summarizeExecutionReplayAudit,
  runFactorAblationStudy,
  runThresholdCalibrationStudy,
  replayHistoricalCounterfactualDecision,
  validateCounterfactualDecisionReplay,
  pairedComparison,
  validationAssessment,
  runFactorEffectivenessValidation,
} = require("./factor-effectiveness-validation");

test("交易日以供应商日期为准，文件名不能替代交易日", () => {
  assert.equal(normalizeTradingDate("20260821"), "2026-08-21");
  assert.equal(normalizeTradingDate("2026-08-21"), "2026-08-21");
  const result = snapshotTradingDate({
    market: { limitStats: { dates: { today: "20260710" } } },
    archiveMeta: { tradingDate: "2026-07-10" },
  });
  assert.equal(result.date, "2026-07-10");
  assert.equal(result.source, "market.limitStats.dates.today");
  assert.equal(result.conflict, false);
});

test("T+1 只按下一快照的供应商 prev 日期精确连接", () => {
  const record = (date, previousDate) => ({
    tradingDate: date,
    archivedAtTimestamp: Date.parse(`${date}T08:00:00.000Z`),
    snapshot: { market: { limitStats: { dates: { today: date, prev: previousDate } } } },
  });
  const records = [
    record("2026-08-05", "2026-08-04"),
    record("2026-08-07", "2026-08-06"),
    record("2026-08-10", "2026-08-07"),
  ];
  const result = buildExactT1Pairs(records);
  assert.deepEqual(result.pairs.map((pair) => [pair.currentDate, pair.nextDate]), [["2026-08-07", "2026-08-10"]]);
  assert(result.unmatched.some((row) => row.expectedPreviousDate === "2026-08-06"));
});

test("重复交易日记录失败关闭，不能由Map静默选择其中一份", () => {
  const duplicate = (fileName) => ({
    fileName,
    tradingDate: "2026-08-21",
    archivedAtTimestamp: Date.parse("2026-08-21T08:00:00.000Z"),
    snapshot: { market: { limitStats: { dates: { today: "20260821", prev: "20260820" } } } },
  });
  const result = buildExactT1Pairs([duplicate("a.json"), duplicate("b.json")]);
  assert.equal(result.pairs.length, 0);
  assert.equal(result.unmatched.length, 2);
  assert(result.unmatched.every((row) => row.reason === "duplicate_trading_date_snapshot"));
});

test("历史v5/v6迁移只接收同日收盘双榜元数据，并保持原始快照不变", () => {
  const loaded = loadHistoricalSnapshots(path.join(__dirname, "data", "history"));
  const eligibleRecord = loaded.records.find((record) => record.tradingDate === "2026-08-11");
  assert(loaded.rejected.some((row) => row.fileName === "2026-07-12.json"
    && row.reason === "filename_trading_date_mismatch"));
  const before = JSON.stringify(eligibleRecord.snapshot);
  const migrated = migrateHistoricalClosingSnapshot(eligibleRecord);
  assert.equal(migrated.eligible, true);
  assert.equal(migrated.executionAuthority, false);
  assert.equal(migrated.payload.validationMigration.syntheticMarketFacts, false);
  assert.equal(migrated.payload.generationContext.tradingDate, "2026-08-11");
  assert.equal(migrated.payload.themeLibrary.sourceMode, "historical-validation-reconstruction");
  assert.equal(JSON.stringify(eligibleRecord.snapshot), before, "迁移不得修改原始历史快照");

  const legacySnapshot = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "history", "2026-07-12.json"), "utf8"));
  const rejected = migrateHistoricalClosingSnapshot({
    tradingDate: "2026-07-10",
    fileName: "2026-07-12.json",
    snapshotKind: "closing",
    snapshot: legacySnapshot,
  });
  assert.equal(rejected.eligible, false);
  assert(rejected.blockers.includes("exact_closing_rank_metadata_missing"));
  assert.equal(rejected.payload, null);

  const audit = buildHistoricalMigrationAudit(loaded.records);
  assert.equal(audit.executionAuthority, false);
  assert(audit.envelopeEligibleCount > 0);
  assert(audit.envelopeRejectedCount > 0);
  assert.equal(audit.sourceSnapshotCount, loaded.records.length);
  assert.match(audit.rule, /无法.*T-1情绪初始状态保持不可用/);
});

test("结果标签校验 T 收盘与 T+1 昨收，不匹配时失败关闭", () => {
  const valid = buildOutcome(
    { code: "000001", price: 10 },
    { code: "000001", prevClose: 10, open: 10.2, high: 10.8, low: 9.8, price: 10.5 },
  );
  assert.equal(valid.valid, true);
  assert.equal(valid.closePct, 5);
  const invalid = buildOutcome(
    { code: "000001", price: 10 },
    { code: "000001", prevClose: 9, price: 10.5 },
  );
  assert.equal(invalid.valid, false);
  assert.equal(invalid.reason, "t_close_does_not_match_t1_prev_close");
});

test("独立日K只连接精确 T/T+1，且不回写排序特征", () => {
  const outcome = buildKlineOutcome(
    { code: "000001", price: 10 },
    {
      source: "test_qfq_kline",
      rows: [
        { date: "2026-08-20", open: 9.9, high: 10.1, low: 9.8, close: 10 },
        { date: "2026-08-21", open: 10.2, high: 10.8, low: 10.1, close: 10.5 },
      ],
    },
    "2026-08-20",
    "2026-08-21",
  );
  assert.equal(outcome.valid, true);
  assert.equal(outcome.source, "test_qfq_kline");
  assert.equal(outcome.closePct, 5);
});

test("排序比较以真正换票日计有效样本，不用相同结果虚增样本", () => {
  const row = (date, code, closePct) => ({
    tradingDate: date,
    valid: true,
    codes: [code],
    outcome: { valid: true, closePct },
  });
  const comparison = pairedComparison(
    [row("2026-08-20", "000001", 1), row("2026-08-21", "000003", -2)],
    [row("2026-08-20", "000001", 1), row("2026-08-21", "000002", 3)],
  );
  assert.equal(comparison.pairedDecisionDays, 2);
  assert.equal(comparison.changedDecisionDays, 1);
  assert.equal(comparison.unchangedDecisionDays, 1);
  assert.equal(comparison.changedMeanDeltaClosePct, -5);
  assert.equal(comparison.status, "insufficient_changed_samples");
});

test("严格组合使用initialPortfolioPct且保留空仓日", () => {
  const stocks = [
    { code: "000001", positionAllocation: { initialPortfolioPct: 10 } },
    { code: "000002", positionAllocation: { initialPortfolioPct: 20 } },
  ];
  const outcomes = new Map([
    ["000001", { valid: true, closePct: 10, gapPct: 2, highPct: 12, adversePct: -2, openToClosePct: 8 }],
    ["000002", { valid: true, closePct: -5, gapPct: -1, highPct: 3, adversePct: -6, openToClosePct: -4 }],
  ]);
  const allocated = buildAllocatedPortfolioRow("2026-08-20", "2026-08-21", stocks, outcomes, 5, { contractReady: true });
  assert.equal(allocated.valid, true);
  assert.equal(allocated.investedPortfolioPct, 30);
  assert.equal(allocated.cashReservePct, 70);
  assert.equal(allocated.outcome.closePct, 0);

  const cash = buildAllocatedPortfolioRow("2026-08-20", "2026-08-21", [], new Map(), 5, { contractReady: true });
  assert.equal(cash.valid, true);
  assert.equal(cash.cashOnly, true);
  assert.equal(cash.outcome.closePct, 0);

  const missingOutcome = buildAllocatedPortfolioRow("2026-08-20", "2026-08-21", stocks, new Map(), 5, { contractReady: true });
  assert.equal(missingOutcome.valid, false);
  assert.equal(missingOutcome.reason, "portfolio_outcome_coverage_incomplete");
});

test("周期分组只认v3统一决策链，禁止rawCycle回退", () => {
  assert.deepEqual(cycleContext({ market: { state: { rawCycle: "修复" } } }), {
    bigCycle: "未知",
    bigCycleSource: "missing",
    smallCycle: "未知",
    smallCycleSource: "missing",
  });
  const context = cycleContext({
    version: 3,
    authority: "canonical_stock_decision",
    marketStage: { bigCycle: { label: "震荡" }, smallCycle: { label: "小分歧" } },
  });
  assert.equal(context.bigCycle, "震荡");
  assert.equal(context.smallCycle, "小分歧");
});

test("评估固定Top3且不能仅凭样本数确认策略有效", () => {
  const comparison = (changedDecisionDays, delta) => ({
    changedDecisionDays,
    changedMeanDeltaClosePct: delta,
    positiveDeltaRatePct: 80,
  });
  const assessment = validationAssessment(
    { top1: comparison(100, 9), top3: comparison(100, 8), top5: comparison(100, 7) },
    { decisionDays: 100, investedDecisionDays: 100, invalidOutcomeDays: 0 },
  );
  assert.equal(assessment.primaryRankingK, 3);
  assert.equal(assessment.confirmationEligible, false);
  assert.equal(assessment.strategyEffectivenessConfirmed, false);
  assert.equal(assessment.effectivenessConfirmed, false);
});

test("T-1布尔条件全通过但权威来源伪造时仍失败关闭", () => {
  const load = (date) => JSON.parse(fs.readFileSync(path.join(__dirname, "data", "history", `${date}.json`), "utf8"));
  const payload = replayHistoricalCounterfactualDecision(load("2026-08-20"), load("2026-08-19"), null, true);
  const valid = validateCounterfactualDecisionReplay(payload, "2026-08-20", "2026-08-19");
  assert.equal(valid.replayReady, true);
  payload.unifiedDecisionChain.marketStage.previousEmotionStage.authority = "forged_authority";
  payload.unifiedDecisionChain.marketStage.previousEmotionStage.passed = true;
  payload.unifiedDecisionChain.marketStage.previousEmotionStage.exactPreviousTradingDay = true;
  payload.unifiedDecisionChain.marketStage.previousEmotionStage.crossDayVerified = true;
  const forged = validateCounterfactualDecisionReplay(payload, "2026-08-20", "2026-08-19");
  assert.equal(forged.replayReady, false);
  assert(forged.blockers.includes("exact_t1_emotion_authority_mismatch"));
});

test("validationOnly 固定旧 selected 短名单，正式执行默认行为保持隔离", () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "history", "2026-07-14.json"), "utf8"));
  const candidates = JSON.parse(JSON.stringify(snapshot.candidates));
  _internals.refreshCandidateFlowAndGate(candidates, snapshot.market.state, snapshot.market.limitStats);
  const result = _internals.buildBestPicks(
    candidates,
    snapshot.topicBoard,
    snapshot.market.state,
    snapshot.hotConcepts,
    snapshot.survivorBoard,
    [],
    snapshot.market.limitStats,
    null,
    snapshot.tomorrowOutlook,
    { validationMode: "ranking-study" },
  );
  assert.equal(result.validationOnly, true);
  assert.equal(result.studyScope, "relative_ranking_same_legacy_shortlist");
  assert.equal(result.factorUniverse.executionAuthority, false);
  assert(result.picks.every((pick) => pick.factorDecision && pick.factorDecision.hardGate.pass));
});

test("有效性报告冻结分时领导力、量比、执行可行性和市值分组标签", () => {
  const labels = factorEvidenceLabels({
    factorDecision: {
      authority: "unified_stock_factor_engine_v4",
      leadershipWeighting: { profileKey: "strengthening", overallWeight: 0.45, intradayVerified: true },
      participationValue: { details: { liquidity: { volumeRatioBand: "normal_1_2_to_3" } } },
      executionFeasibility: { status: "conditional", slippageRisk: "elevated" },
    },
    marketCapCarrier: { bucketKey: "100_300", regimeKey: "low_liquidity" },
  });
  assert.equal(labels.intradayLeadershipVerified, true);
  assert.equal(labels.volumeRatioBand, "normal_1_2_to_3");
  assert.equal(labels.executionFeasibilityStatus, "conditional");
  assert.equal(labels.marketCapBucket, "100_300");
  const audit = summarizeFactorEvidenceAudit([{ unifiedOrder: [{ factorEvidence: labels }] }]);
  assert.equal(audit.intradayLeadershipCoveragePct, 100);
  assert.equal(audit.executionFeasibilityStatusCounts.conditional, 1);
  assert.match(audit.interpretation, /不构成有效性确认/);
});

test("执行回放缺分钟条时保持不可用，不能用T+1日线冒充成交收益", () => {
  const replay = executionReplayForPick({
    code: "000001",
    executionReplayRule: {
      version: 1,
      referencePrice: 10,
      earliestTime: "09:35",
      latestTime: "10:00",
      maxGapPct: 3,
    },
  }, {
    valid: true,
    currentClose: 10,
    nextOpen: 10.2,
    nextHigh: 10.8,
    nextLow: 9.9,
    nextClose: 10.5,
  }, { series: {} }, "2026-08-22");
  assert.equal(replay.status, "unavailable");
  assert(replay.blockers.includes("intraday_execution_bars_missing"));
  assert.equal(replay.outcome, undefined);
  const audit = summarizeExecutionReplayAudit([{ unifiedOrder: [{ executionReplay: replay }] }]);
  assert.equal(audit.minuteBarCoverageCount, 0);
  assert.equal(audit.executionAuthority, false);
});

test("消融研究只改变一个分量并报告真实换票，不因单日结果自动改权重", () => {
  const factor = (finalScore, volumeRatioPoints) => ({
    finalScore,
    participationValue: {
      components: { themePosition: 0, stockRole: 0, structureQuality: 0, liquidity: volumeRatioPoints, t1Premium: 0 },
      details: {
        liquidity: { volumeRatioPoints },
        stockRole: { baseRoleScore: 0, leadershipComparableScore: 0, combinedScore: 0 },
      },
    },
    riskAdjustment: { components: { executionFeasibility: 0 } },
    leadershipWeighting: { qualityScore: 0 },
  });
  const study = runFactorAblationStudy([{
    tradingDate: "2026-08-20",
    nextDate: "2026-08-21",
    unifiedOrder: [
      { code: "A", factorDecision: factor(10, 4) },
      { code: "B", factorDecision: factor(9, 0) },
    ],
    outcomes: [
      { code: "A", valid: true, closePct: 1, gapPct: 0, highPct: 2, adversePct: -1, openToClosePct: 1 },
      { code: "B", valid: true, closePct: 3, gapPct: 0, highPct: 4, adversePct: -1, openToClosePct: 3 },
    ],
  }], 1);
  const volume = study.variants.volume_ratio.comparisonToBaseline;
  assert.equal(study.executionAuthority, false);
  assert.equal(volume.changedDecisionDays, 1);
  assert.equal(volume.changedMeanDeltaClosePct, 2);
  assert.equal(study.variants.volume_ratio.sufficientChangedSamples, false);
  assert.equal(study.variants.market_cap.comparisonToBaseline.changedDecisionDays, 0);
  const calibration = runThresholdCalibrationStudy([]);
  assert.equal(calibration.calibrationApplied, false);
  assert.equal(calibration.decision, "retain_current_parameters_insufficient_out_of_sample_evidence");
  assert.equal(calibration.currentParameters.marketAmountThresholdYi, 25000);
});

test("本地历史回放生成审计报告，但样本不足时绝不确认有效", () => {
  const historyDir = path.join(__dirname, "data", "history");
  const historyHashes = new Map(fs.readdirSync(historyDir)
    .filter((name) => /^20\d{2}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => [name, crypto.createHash("sha256").update(fs.readFileSync(path.join(historyDir, name))).digest("hex")]));
  const report = runFactorEffectivenessValidation({
    historyDir,
    outcomeCachePath: path.join(__dirname, "data", "factor-validation-outcomes.json"),
    generatedAt: "2026-08-23T00:00:00.000Z",
  });
  assert(report.dataAudit.jsonFileCount > 0);
  assert(report.dataAudit.rejectedSnapshots.every((row) => row.reason));
  assert(report.dataAudit.exactT1PairCount > 0);
  assert.equal(report.dataAudit.historicalMigration.executionAuthority, false);
  assert(report.rankingStudy.comparisons.top1.changedDecisionDays <= report.rankingStudy.comparisons.top1.pairedDecisionDays);
  assert(report.rankingStudy.comparisons.top5);
  assert.equal(report.rankingStudy.universe, "post_hard_gate_common_pool");
  assert(report.rankingStudy.factorEvidenceAudit);
  assert(report.rankingStudy.executionReplayAudit);
  assert.equal(report.dataAudit.minuteOutcomeCache.executionAuthority, false);
  assert.equal(report.dataAudit.minuteOutcomeCache.validPairCount, 39);
  assert.equal(report.rankingStudy.executionReplayAudit.minuteBarCoverageCount, 39);
  assert(report.rankingStudy.ablationStudy);
  assert(report.rankingStudy.ablationStudyTop1);
  assert(report.rankingStudy.thresholdCalibration);
  assert.equal(report.counterfactualReplayStudy.authority, "unified_decision_chain_v3");
  assert.equal(report.counterfactualReplayStudy.provenance, "counterfactual_current_engine_replay");
  assert.equal(report.counterfactualReplayStudy.asDecided, false);
  assert(report.counterfactualReplayStudy.summaries.top5);
  assert.equal(report.frozenDecisionStudy.asDecided, true);
  assert.equal(
    report.frozenDecisionStudy.receiptCount,
    report.dataAudit.decisionReceiptAudit.liveCanonicalCount,
  );
  assert(report.dataAudit.decisionReceiptAudit.legacyWithoutReceiptCount > 0);
  const liveReceiptIds = new Set(
    report.dataAudit.decisionReceiptAudit.records
      .filter((row) => row.liveCanonical)
      .map((row) => row.receiptId),
  );
  assert(report.frozenDecisionStudy.days.every((row) => liveReceiptIds.has(row.receiptId)));
  assert.equal(report.assessment.strategyEffectivenessConfirmed, false);
  assert.equal(report.assessment.effectivenessConfirmed, false);
  historyHashes.forEach((hash, name) => {
    const after = crypto.createHash("sha256").update(fs.readFileSync(path.join(historyDir, name))).digest("hex");
    assert.equal(after, hash, `历史原档不得被回放或审计改写:${name}`);
  });
});
