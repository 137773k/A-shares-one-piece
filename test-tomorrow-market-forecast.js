"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MARKET_PATH_KEYS,
  ACCELERATION_PATH_KEYS,
  buildTomorrowMarketForecast,
  buildSentimentCycle,
  assessAccelerationTransition,
  classifyCoreStage,
} = require("./tomorrow-market-forecast");

function probabilitySum(probabilities, keys) {
  return keys.reduce((sum, key) => sum + probabilities[key], 0);
}

function previousPayload(overrides = {}) {
  return {
    archiveMeta: {
      tradingDate: "2026-08-06",
      snapshotKind: "closing",
      ...(overrides.archiveMeta || {}),
    },
    market: {
      snapshot: {
        shszAmountYi: 20000,
        ...(overrides.snapshot || {}),
      },
      limitStats: {
        ztToday: 60,
        dtToday: 6,
        dates: { today: "20260806" },
        ...(overrides.limitStats || {}),
      },
    },
  };
}

function fixture(overrides = {}) {
  const snapshot = {
    avgIndexChange: 0.35,
    breadth: 0.52,
    shszAmountYi: 20500,
    indexStructures: [
      { code: "000001", trendKey: "sideways" },
      { code: "399001", trendKey: "repair" },
      { code: "399006", trendKey: "repair" },
      { code: "000688", trendKey: "sideways" },
    ],
    ...(overrides.snapshot || {}),
  };
  const limitStats = {
    ztToday: 62,
    ztPrev: 60,
    dtToday: 5,
    dtPrev: 6,
    dates: {
      today: "20260807",
      prev: "20260806",
      verified: true,
    },
    ...(overrides.limitStats || {}),
  };
  const state = {
    cycle: "震荡",
    structuralCycle: "震荡",
    dailyState: { key: "healthy_divergence", label: "健康分化" },
    profitEffect: { score: 58 },
    lossEffect: { score: 35 },
    ...(overrides.state || {}),
  };
  return {
    market: { snapshot, limitStats, state },
    candidates: overrides.candidates || [],
    bestPicks: overrides.bestPicks || [],
    selectedCandidateCode: overrides.selectedCandidateCode || null,
    fetchedAt: overrides.fetchedAt || "2026-08-09T12:00:00.000Z",
  };
}

function canonicalIndexCycle(shortKey = "partial_main_rise") {
  return {
    version: 1,
    method: "deterministic_multi_timeframe",
    structuralCycle: shortKey === "main_rise" ? "主升" : "混沌",
    mediumTerm: {
      key: shortKey === "main_rise" ? "main_rise" : "repair_candidate",
      cycleKey: shortKey === "main_rise" ? "main_rise" : "repair",
      label: shortKey === "main_rise" ? "中期主升" : "中期修复候选",
    },
    shortTerm: {
      key: shortKey,
      windowDays: 5,
      label: shortKey === "main_rise" ? "5日全市场主升" : "局部短线主升·全市场待共振",
    },
    dataQuality: { grade: "complete" },
  };
}

function canonicalEmotionCycle(stage = "climax", baselineKey = "diverge") {
  const labels = {
    acceleration: "加速",
    climax: "高潮",
    realization: "兑现",
    support: "承接",
    harmful: "非良性分歧",
    retreat: "退潮",
    unknown: "阶段待确认",
  };
  return {
    version: 1,
    method: "anchor_hcd_state_machine",
    calibrated: false,
    current: { key: stage, label: labels[stage], confidence: 68 },
    tomorrowBaseline: {
      key: baselineKey,
      label: baselineKey === "diverge" ? "兑现优先·先看承接" : baselineKey,
      reason: stage === "climax" ? "高潮后的第一预期是兑现，不预设继续加速" : "canonical基线",
      rank: 1,
    },
  };
}

test("rule prior is deterministic, explainable, and probabilities always sum to 100", () => {
  const payload = fixture();
  const options = { previousPayload: previousPayload() };
  const first = buildTomorrowMarketForecast(payload, options);
  const second = buildTomorrowMarketForecast(payload, options);

  assert.deepEqual(first, second);
  assert.equal(probabilitySum(first.probabilities, MARKET_PATH_KEYS), 100);
  assert.equal(first.method, "rule_prior");
  assert.equal(first.calibrated, false);
  assert.equal(first.scenarios.length, 3);
  assert.deepEqual(
    first.scenarios.map((item) => item.probability),
    MARKET_PATH_KEYS.map((key) => first.probabilities[key]),
  );
  assert.equal(first.dataQuality.exactPreviousTradingDay, true);
  assert.equal(first.tradingDate, "2026-08-07");
  assert.ok(first.evidence.every((item) => typeof item.detail === "string"));
  assert.ok(first.updateRules.some((item) => item.time === "09:25"));
  assert.ok(first.updateRules.some((item) => item.time === "09:35"));
});

test("missing fields stay unknown instead of being coerced to zero", () => {
  const missing = buildTomorrowMarketForecast({ fetchedAt: "2026-08-09T12:00:00.000Z" });
  const realZeroBreadth = buildTomorrowMarketForecast({
    market: {
      snapshot: { breadth: 0 },
      state: { cycle: "震荡" },
      limitStats: {},
    },
  });

  assert.equal(probabilitySum(missing.probabilities, MARKET_PATH_KEYS), 100);
  assert.equal(missing.dataQuality.grade, "insufficient");
  assert.equal(missing.dataQuality.coveragePct, 0);
  assert.equal(missing.tradingDate, null, "周末抓取时间不能冒充交易日");
  assert.equal(
    missing.evidence.find((item) => item.id === "market_breadth").effect,
    null,
  );
  assert.equal(
    realZeroBreadth.evidence.find((item) => item.id === "market_breadth").available,
    true,
    "真实的0上涨覆盖率是有效数据，不应和缺失混淆",
  );
  assert.ok(
    realZeroBreadth.probabilities.weaken > missing.probabilities.weaken,
    JSON.stringify({ missing: missing.probabilities, realZero: realZeroBreadth.probabilities }),
  );
});

test("missing or non-closing T-1 archive lowers confidence and disables turnover comparison", () => {
  const payload = fixture();
  const exact = buildTomorrowMarketForecast(payload, { previousPayload: previousPayload() });
  const intraday = buildTomorrowMarketForecast(payload, {
    previousPayload: previousPayload({ archiveMeta: { snapshotKind: "intraday" } }),
  });
  const wrongDate = buildTomorrowMarketForecast(payload, {
    previousPayload: previousPayload({ archiveMeta: { tradingDate: "2026-08-05" } }),
  });

  assert.equal(exact.dataQuality.exactPreviousTradingDay, true);
  assert.equal(intraday.dataQuality.exactPreviousTradingDay, false);
  assert.equal(wrongDate.dataQuality.exactPreviousTradingDay, false);
  assert.ok(exact.confidence > intraday.confidence);
  assert.ok(exact.confidence > wrongDate.confidence);
  assert.equal(
    intraday.evidence.find((item) => item.id === "turnover_comparison").available,
    false,
  );
  assert.equal(
    wrongDate.evidence.find((item) => item.id === "turnover_comparison").available,
    false,
  );
});

test("stronger index evidence monotonically raises strengthen prior and weaker evidence raises weaken prior", () => {
  const strong = fixture({
    snapshot: {
      avgIndexChange: 1.6,
      breadth: 0.72,
      shszAmountYi: 24500,
      indexStructures: [
        { trendKey: "uptrend" },
        { trendKey: "uptrend" },
        { trendKey: "uptrend" },
        { trendKey: "repair" },
      ],
    },
    limitStats: { ztToday: 82, ztPrev: 60, dtToday: 2, dtPrev: 6 },
    state: {
      structuralCycle: "震荡",
      dailyState: { key: "repair_strengthening", label: "修复加强" },
      profitEffect: { score: 76 },
      lossEffect: { score: 24 },
    },
  });
  const weak = fixture({
    snapshot: {
      avgIndexChange: -1.8,
      breadth: 0.24,
      shszAmountYi: 14000,
      indexStructures: [
        { trendKey: "downtrend" },
        { trendKey: "downtrend" },
        { trendKey: "bottoming" },
        { trendKey: "sideways" },
      ],
    },
    limitStats: { ztToday: 28, ztPrev: 60, dtToday: 18, dtPrev: 6 },
    state: {
      structuralCycle: "震荡",
      dailyState: { key: "retreat_candidate", label: "退潮候选" },
      profitEffect: { score: 25 },
      lossEffect: { score: 72 },
    },
  });
  const options = { previousPayload: previousPayload() };
  const strongForecast = buildTomorrowMarketForecast(strong, options);
  const weakForecast = buildTomorrowMarketForecast(weak, options);

  assert.ok(strongForecast.probabilities.strengthen > weakForecast.probabilities.strengthen);
  assert.ok(weakForecast.probabilities.weaken > strongForecast.probabilities.weaken);
});

test("recommended candidate cannot validate market strengthening by itself", () => {
  const base = fixture();
  const candidateOnly = fixture({
    candidates: [
      {
        code: "300001",
        name: "推荐票",
        emotionStage: "弱转强",
        emotionWeight: 100,
        changePct: 20,
      },
    ],
    selectedCandidateCode: "300001",
  });
  const options = { previousPayload: previousPayload() };
  const withoutCandidate = buildTomorrowMarketForecast(base, options);
  const withCandidate = buildTomorrowMarketForecast(candidateOnly, options);

  assert.equal(withCandidate.probabilities.strengthen, withoutCandidate.probabilities.strengthen);
  assert.match(
    withCandidate.evidence.find((item) => item.id === "core_emotion_basket").detail,
    /排除推荐票.*不能验证市场加强/,
  );
  assert.equal(withCandidate.sentimentCycle.aggregateStage, "unknown");
  assert.equal(
    withCandidate.sentimentCycle.coreBasket.selectedCandidateExcludedFromPositiveValidation,
    true,
  );

  const selectedAcceleration = fixture({
    state: { structuralCycle: "主升" },
    candidates: [{ code: "300001", emotionStage: "加速", emotionWeight: 100 }],
    selectedCandidateCode: "300001",
  });
  const sameCycleWithoutCandidate = fixture({ state: { structuralCycle: "主升" } });
  assert.deepEqual(
    buildTomorrowMarketForecast(selectedAcceleration, options).probabilities,
    buildTomorrowMarketForecast(sameCycleWithoutCandidate, options).probabilities,
    "推荐候选自身进入加速，也不能作为市场加强的独立评分信号",
  );
});

test("explicit selectedCandidateCode applies deterministic leave-one-out validation", () => {
  const options = { previousPayload: previousPayload() };
  const withoutCandidate = fixture({ state: { structuralCycle: "主升" } });
  const objectPicksCandidate = fixture({
    state: { structuralCycle: "主升" },
    candidates: [
      {
        code: "300476",
        name: "胜宏科技",
        emotionStage: "弱转强",
        emotionWeight: 100,
        changePct: 12.01,
      },
    ],
    selectedCandidateCode: "300476",
  });
  const first = buildTomorrowMarketForecast(objectPicksCandidate, options);
  const second = buildTomorrowMarketForecast(objectPicksCandidate, options);
  const baseline = buildTomorrowMarketForecast(withoutCandidate, options);

  assert.deepEqual(first, second, "显式selectedCandidateCode的leave-one-out结果必须确定");
  assert.deepEqual(
    first.probabilities,
    baseline.probabilities,
    "显式排除的候选票独强不能单独验证市场加强",
  );
  assert.equal(first.sentimentCycle.coreBasket.selectedCandidateCode, "300476");
  assert.equal(first.sentimentCycle.coreBasket.positiveIndependentCount, 0);
  assert.equal(first.sentimentCycle.items[0].selectedCandidate, true);
});

test("two independent high-impact cores may strengthen the emotion confirmation", () => {
  const one = fixture({
    candidates: [{ code: "000001", emotionStage: "弱转强", emotionWeight: 90 }],
  });
  const cohort = fixture({
    candidates: [
      { code: "000001", emotionStage: "弱转强", emotionWeight: 90 },
      { code: "000002", emotionStage: "分歧后承接", emotionWeight: 82 },
    ],
  });
  const options = { previousPayload: previousPayload() };
  const singleForecast = buildTomorrowMarketForecast(one, options);
  const cohortForecast = buildTomorrowMarketForecast(cohort, options);

  assert.ok(cohortForecast.probabilities.strengthen > singleForecast.probabilities.strengthen);
  assert.equal(cohortForecast.sentimentCycle.coreBasket.positiveIndependentCount, 2);
});

test("one core feedback stays isolated while two independent feedbacks count as expansion", () => {
  const one = buildSentimentCycle(
    { structuralCycle: "震荡" },
    [{ code: "000001", emotionStage: "negative_feedback", emotionWeight: 90 }],
  );
  const two = buildSentimentCycle(
    { structuralCycle: "震荡" },
    [
      { code: "000001", emotionStage: "negative_feedback", emotionWeight: 90 },
      { code: "000002", emotionStage: "negative_feedback", emotionWeight: 80 },
    ],
  );

  assert.equal(one.aggregateStage, "divergence");
  assert.equal(one.coreBasket.negativeFeedbackState.key, "isolated");
  assert.equal(two.aggregateStage, "negative_feedback");
  assert.equal(two.coreBasket.negativeFeedbackState.key, "expanding");
});

test("market phase is weighted, and the selected candidate is excluded from every market-level field", () => {
  const weighted = buildSentimentCycle(
    { structuralCycle: "震荡" },
    [
      ...Array.from({ length: 4 }, (_, index) => ({
        code: `60000${index}`,
        emotionStage: "expectation_overdrawn",
        emotionWeight: 75,
      })),
      { code: "000099", emotionStage: "divergence", emotionWeight: 78 },
    ],
  );
  const selectedOnly = buildSentimentCycle(
    { structuralCycle: "主升" },
    [{ code: "300476", emotionStage: "acceleration", emotionWeight: 100 }],
    "300476",
  );

  assert.equal(weighted.aggregateStage, "expectation_overdrawn");
  assert.match(weighted.aggregateStageLabel, /局部分歧/);
  assert.equal(weighted.coreBasket.divergenceState.key, "isolated");
  assert.equal(selectedOnly.aggregateStage, "unknown");
  assert.equal(selectedOnly.accelerationPath, null);
  assert.equal(selectedOnly.coreBasket.total, 0);
  assert.equal(selectedOnly.coreBasket.totalIncludingSelectedCandidate, 1);
  assert.equal(selectedOnly.coreBasket.counts.acceleration, 0);
  assert.equal(selectedOnly.coreBasket.countsIncludingSelectedCandidate.acceleration, 1);
});

test("acceleration transition changes with main-rise, range, and retreat regimes", () => {
  const mainRise = assessAccelerationTransition({ cycle: "主升" });
  const range = assessAccelerationTransition({ cycle: "震荡" });
  const retreat = assessAccelerationTransition({ cycle: "退潮" });

  assert.equal(mainRise.primary.key, "brief_divergence_then_consensus");
  assert.equal(range.primary.key, "range_divergence");
  assert.equal(retreat.primary.key, "harmful_divergence");
  [mainRise, range, retreat].forEach((result) => {
    assert.equal(probabilitySum(result.probabilities, ACCELERATION_PATH_KEYS), 100);
    assert.equal(result.method, "rule_prior");
    assert.equal(result.calibrated, false);
    assert.equal(result.scenarios.length, 3);
  });
});

test("divergence quality updates the cycle-conditioned acceleration path", () => {
  const benign = assessAccelerationTransition({
    cycle: "震荡",
    divergenceSize: "small",
    divergenceQuality: "benign",
  });
  const harmful = assessAccelerationTransition({
    cycle: "震荡",
    divergenceSize: "large",
    divergenceQuality: "harmful",
  });

  assert.ok(
    benign.probabilities.brief_divergence_then_consensus
      > harmful.probabilities.brief_divergence_then_consensus,
  );
  assert.ok(harmful.probabilities.harmful_divergence > benign.probabilities.harmful_divergence);
});

test("core stages require explicit lifecycle evidence instead of inferring from a large gain", () => {
  assert.equal(classifyCoreStage({ changePct: 20 }), "unknown");
  assert.equal(classifyCoreStage({ lifecycle: { currentStage: "加速" } }), "acceleration");
  assert.equal(classifyCoreStage({ negativeFeedback: true }), "negative_feedback");
});

test("payload canonical models own partial-main-rise regime and climax baseline", () => {
  const input = fixture({
    state: {
      cycle: "修复",
      structuralCycle: "修复",
      dailyState: { key: "repair_strengthening", label: "旧修复加强" },
    },
    candidates: [
      { code: "000701", emotionStage: "弱转强", emotionWeight: 95 },
      { code: "000702", emotionStage: "分歧后承接", emotionWeight: 90 },
    ],
  });
  input.premarketModels = {
    version: 2,
    indexCycleRegime: canonicalIndexCycle("partial_main_rise"),
    emotionCycle: canonicalEmotionCycle("climax", "diverge"),
  };
  const forecast = buildTomorrowMarketForecast(input, { previousPayload: previousPayload() });

  assert.equal(forecast.method, "rule_prior");
  assert.equal(forecast.calibrated, false);
  assert.equal(forecast.sentimentCycle.marketRegime.key, "chaos");
  assert.equal(forecast.sentimentCycle.marketRegime.label, "混沌");
  assert.equal(forecast.sentimentCycle.marketRegime.smallCycle.key, "partial_main_rise");
  assert.match(forecast.sentimentCycle.marketRegime.smallCycle.label, /局部短线主升/);
  assert.equal(forecast.sentimentCycle.aggregateStage, "climax");
  assert.equal(forecast.sentimentCycle.aggregateStageLabel, "高潮");
  assert.equal(forecast.sentimentCycle.stageSource, "canonical_emotion_cycle");
  assert.equal(forecast.sentimentCycle.baseline.key, "range_divergence");
  assert.match(forecast.sentimentCycle.baseline.label, /兑现优先/);
  assert.equal(forecast.sentimentCycle.expectedTransition.key, "range_divergence");
  assert.equal(forecast.primary.key, "range_divergence");
  assert.deepEqual(forecast.prior, { strengthen: 23, range_divergence: 53, weaken: 24 });
  assert.equal(forecast.sentimentCycle.coreBasket.legacyUsedForAggregate, false);
  assert.equal(forecast.sentimentCycle.coreBasket.legacyUsedForScoring, false);
  assert.equal(forecast.dataQuality.canonicalModels.indexCycleRegime.usable, true);
  assert.equal(forecast.dataQuality.canonicalModels.emotionCycle.usable, true);
  assert.match(forecast.evidence.find((row) => row.id === "cycle_prior").detail, /canonical indexCycleRegime/);
  assert.deepEqual(
    forecast.evidence.find((row) => row.id === "daily_state").effect,
    { strengthen: 0, range_divergence: 0, weaken: 0 },
    "legacy dailyState只可诊断，不能与canonical情绪重复计分",
  );
});

test("canonical strong-divergence phase outranks legacy acceleration and keeps divergence as the uncalibrated baseline", () => {
  const payload = fixture();
  payload.tomorrowDecision = payload.tomorrowDecision || {};
  const forecast = buildTomorrowMarketForecast(payload, {
    indexCycleRegime: canonicalIndexCycle("main_rise"),
    emotionCycle: {
      version: 2,
      method: "anchor_hcd_state_machine",
      current: {
        key: "realization",
        phaseKey: "strong_divergence",
        label: "强分歧",
      },
      tomorrowBaseline: {
        key: "diverge",
        label: "分歧延续优先",
        rank: 1,
      },
    },
  });

  assert.equal(forecast.sentimentCycle.aggregateStage, "strong_divergence");
  assert.equal(forecast.sentimentCycle.aggregateStageLabel, "强分歧");
  assert.equal(forecast.sentimentCycle.baseline.key, "range_divergence");
  assert.equal(forecast.sentimentCycle.baseline.label, "分歧延续优先");
  assert.doesNotMatch(JSON.stringify(forecast.sentimentCycle), /主阶段[^]{0,40}加速/);
});

test("options canonical models override legacy repair and legacy core stages cannot double-score", () => {
  const canonicalOptions = {
    previousPayload: previousPayload(),
    indexCycleRegime: canonicalIndexCycle("partial_main_rise"),
    emotionCycle: canonicalEmotionCycle("climax", "diverge"),
  };
  const positiveLegacy = fixture({
    state: { structuralCycle: "修复" },
    candidates: [
      { code: "000711", emotionStage: "弱转强", emotionWeight: 95 },
      { code: "000712", emotionStage: "分歧后承接", emotionWeight: 90 },
    ],
  });
  const negativeLegacy = fixture({
    state: { structuralCycle: "修复" },
    candidates: [
      { code: "000711", emotionStage: "negative_feedback", emotionWeight: 95 },
      { code: "000712", emotionStage: "negative_feedback", emotionWeight: 90 },
    ],
  });
  const positive = buildTomorrowMarketForecast(positiveLegacy, canonicalOptions);
  const negative = buildTomorrowMarketForecast(negativeLegacy, canonicalOptions);

  assert.equal(positive.sentimentCycle.marketRegime.key, "chaos");
  assert.equal(positive.sentimentCycle.marketRegime.source, "options.indexCycleRegime");
  assert.equal(positive.sentimentCycle.canonical.emotionCycle.source, "options.emotionCycle");
  assert.deepEqual(positive.probabilities, negative.probabilities);
  assert.deepEqual(
    positive.evidence.find((row) => row.id === "core_emotion_basket").effect,
    negative.evidence.find((row) => row.id === "core_emotion_basket").effect,
  );
  assert.match(
    positive.evidence.find((row) => row.id === "core_emotion_basket").detail,
    /legacy核心阶段未重复计分/,
  );
});

test("explicitly unavailable canonical models fail closed and lower confidence", () => {
  const legacyStrong = fixture({
    state: { structuralCycle: "主升" },
    candidates: [
      { code: "000721", emotionStage: "弱转强", emotionWeight: 95 },
      { code: "000722", emotionStage: "分歧后承接", emotionWeight: 90 },
    ],
  });
  const legacy = buildTomorrowMarketForecast(legacyStrong, { previousPayload: previousPayload() });
  const unavailable = buildTomorrowMarketForecast(legacyStrong, {
    previousPayload: previousPayload(),
    indexCycleRegime: { version: 1, method: "unavailable", available: false },
    emotionCycle: { version: 1, method: "unavailable", available: false },
  });

  assert.equal(unavailable.sentimentCycle.marketRegime.key, "unknown");
  assert.equal(unavailable.sentimentCycle.aggregateStage, "unknown");
  assert.equal(unavailable.sentimentCycle.baseline.key, "unknown");
  assert.equal(unavailable.sentimentCycle.coreBasket.legacyUsedForAggregate, false);
  assert.equal(unavailable.sentimentCycle.coreBasket.legacyUsedForScoring, false);
  assert.equal(unavailable.dataQuality.grade, "insufficient");
  assert.equal(unavailable.dataQuality.canonicalModels.indexCycleRegime.unavailable, true);
  assert.equal(unavailable.dataQuality.canonicalModels.emotionCycle.unavailable, true);
  assert.ok(unavailable.dataQuality.missingFields.includes("canonical_index_cycle"));
  assert.ok(unavailable.dataQuality.missingFields.includes("canonical_emotion_cycle"));
  assert.ok(unavailable.confidence <= 30);
  assert.equal(unavailable.confidenceLabel, "低");
  assert.ok(unavailable.confidence < legacy.confidence);
  assert.equal(unavailable.evidence.find((row) => row.id === "core_emotion_basket").effect, null);
  assert.equal(unavailable.method, "rule_prior");
  assert.equal(unavailable.calibrated, false);
  assert.equal(probabilitySum(unavailable.probabilities, MARKET_PATH_KEYS), 100);
});
