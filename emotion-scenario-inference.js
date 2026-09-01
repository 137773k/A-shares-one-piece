"use strict";

const EMOTION_SCENARIO_INFERENCE_VERSION = 1;
const EMOTION_SCENARIO_INFERENCE_METHOD = "same_generation_evidence_weighted_emotion_scenario_v1";

const SCENARIOS = Object.freeze([
  { key: "repair_or_consensus", label: "修复延续 / 重新一致" },
  { key: "divergence_continuation", label: "分歧延续" },
  { key: "negative_feedback_expansion", label: "负反馈扩散" },
]);

const GROUP_WEIGHTS = Object.freeze({
  core: 30,
  profitLoss: 30,
  persistence: 20,
  styleFunds: 10,
  structure: 10,
});

const CRITICAL_GROUPS = Object.freeze(["core", "profitLoss", "persistence"]);
const MIN_ACTIVE_WEIGHT = 80;
const MIN_PERCENTAGE_CONFIDENCE = 60;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function finite(value) {
  const number = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(number) ? number : null;
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Number(value || 0)));
}

function normalizedDate(value) {
  return text(value).replace(/[^0-9]/g, "").slice(0, 8);
}

function clone(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function expectedGeneration(input = {}) {
  const payload = object(input.payload);
  const explicit = object(input.generation);
  const nested = object(payload.generationContext);
  return {
    generationId: text(explicit.generationId || explicit.id || payload.generationId || nested.generationId),
    tradingDate: text(explicit.tradingDate || payload.tradingDate || nested.tradingDate),
    asOf: text(explicit.asOf || payload.asOf || nested.asOf),
  };
}

function sameGeneration(value, expected) {
  const source = object(value);
  const nested = object(source.generationContext || source.generation);
  const generationId = text(source.generationId || nested.generationId || nested.id);
  const tradingDate = text(source.tradingDate || nested.tradingDate);
  const asOf = text(source.asOf || nested.asOf);
  return generationId === expected.generationId
    && tradingDate === expected.tradingDate
    && asOf === expected.asOf;
}

function normalizeDistribution(rawInput) {
  const raw = {
    repair_or_consensus: Math.max(0, Number(rawInput.repair_or_consensus || 0)),
    divergence_continuation: Math.max(0, Number(rawInput.divergence_continuation || 0)),
    negative_feedback_expansion: Math.max(0, Number(rawInput.negative_feedback_expansion || 0)),
  };
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  const normalized = {};
  SCENARIOS.forEach(({ key }) => { normalized[key] = round(raw[key] / total * 100, 1); });
  const roundedTotal = round(Object.values(normalized).reduce((sum, value) => sum + value, 0), 1);
  const adjustment = round(100 - roundedTotal, 1);
  const largest = SCENARIOS.slice().sort((left, right) => raw[right.key] - raw[left.key])[0].key;
  normalized[largest] = round(normalized[largest] + adjustment, 1);
  return normalized;
}

function groupResult(key, label, status, distribution, coveragePct, reasons, sources = []) {
  return {
    key,
    label,
    weight: GROUP_WEIGHTS[key],
    status,
    coveragePct: round(clamp(coveragePct), 1),
    distribution: distribution || null,
    primaryScenario: distribution
      ? SCENARIOS.slice().sort((left, right) => distribution[right.key] - distribution[left.key])[0].key
      : null,
    reasons: list(reasons).map(text).filter(Boolean),
    sources: list(sources).map(text).filter(Boolean),
  };
}

function coreGroup(emotionCoreEvidence) {
  const evidence = object(emotionCoreEvidence);
  const strictRows = list(evidence.strictEmotionCores);
  const summary = object(evidence.summary);
  const influence = object(summary.influence);
  const path = object(evidence.emotionStagePath);
  const current = object(object(path.nodes).current);
  const scores = object(current.weightedScores);
  const positive = finite(influence.positiveTotal);
  const negative = finite(influence.negativeTotal);
  const codeSet = new Set(strictRows.map((row) => text(row && row.code)).filter(Boolean));
  const rowsValid = strictRows.length > 0
    && strictRows.length <= 5
    && codeSet.size === strictRows.length
    && strictRows.every((row) => finite(row && row.positiveInfluenceScore) !== null
      && finite(row && row.negativeInfluenceScore) !== null
      && row.selectionAuthority === false
      && row.executionAuthority === false);
  if (evidence.status !== "ready" || current.status !== "ready" || !rowsValid
    || positive === null || negative === null) {
    return groupResult("core", "市场情绪核心", "insufficient", null, 0, [
      "严格情绪核心、正负影响或当前收盘阶段不完整",
    ], ["emotionCoreEvidence"]);
  }
  const support = finite(scores.support_repair) || 0;
  const participating = finite(scores.participating) || 0;
  const divergence = finite(scores.divergence) || 0;
  const negativeFeedback = finite(scores.negative_feedback) || 0;
  const distribution = normalizeDistribution({
    repair_or_consensus: support + participating * 0.65 + positive * 0.25,
    divergence_continuation: divergence + Math.min(positive, negative) * 0.35,
    negative_feedback_expansion: negativeFeedback + negative * 0.25,
  });
  return groupResult("core", "市场情绪核心", distribution ? "ready" : "insufficient", distribution, 100, [
    `核心正面影响${round(positive)}，负面影响${round(negative)}`,
    `核心阶段加权：承接${round(support)}、分歧${round(divergence)}、负反馈${round(negativeFeedback)}`,
    `${strictRows.length}只具名情绪核心，按股票代码去重`,
  ], ["emotionCoreEvidence.strictEmotionCores", "emotionCoreEvidence.emotionStagePath.nodes.current"]);
}

function profitLossGroup(payload) {
  const state = object(object(payload.market).state);
  const context = object(state.emotionEffectContext);
  const profit = finite(object(context.scores).profit);
  const loss = finite(object(context.scores).loss);
  const profitCoverage = finite(object(context.profit).coveragePct);
  const lossCoverage = finite(object(context.loss).coveragePct);
  const coverage = profitCoverage === null || lossCoverage === null ? 0 : Math.min(profitCoverage, lossCoverage);
  if (context.status !== "ready" || profit === null || loss === null || coverage < 60) {
    return groupResult("profitLoss", "赚钱 / 亏钱效应", "insufficient", null, coverage, [
      "全市场赚钱与亏钱效应未达到最小覆盖率",
    ], ["market.state.emotionEffectContext"]);
  }
  const distribution = normalizeDistribution({
    repair_or_consensus: profit * 0.65 + (100 - loss) * 0.35,
    divergence_continuation: 100 - Math.abs(profit - loss),
    negative_feedback_expansion: loss * 0.65 + (100 - profit) * 0.35,
  });
  const observations = object(context.observations);
  return groupResult("profitLoss", "赚钱 / 亏钱效应", "ready", distribution, coverage, [
    `全市场赚钱效应${round(profit)}，亏钱效应${round(loss)}`,
    `涨停${finite(observations.limitUpCount) ?? "未知"}，跌停${finite(observations.limitDownCount) ?? "未知"}`,
    `赚钱/亏钱有效覆盖${round(coverage)}%`,
  ], ["market.state.emotionEffectContext"]);
}

function persistenceGroup(payload) {
  const emotionCycle = object(payload.emotionCycle);
  const window = object(object(emotionCycle.bigCycle).window);
  const metrics = object(window.metrics);
  const confirmation = object(window.confirmation);
  const profit = finite(metrics.weightedProfitScore);
  const loss = finite(metrics.weightedLossScore);
  const continuity = finite(metrics.weightedCoreContinuityScore);
  const completeDays = finite(metrics.completeDays);
  const windowDays = finite(window.windowDays);
  const coverage = windowDays && completeDays !== null ? clamp(completeDays / windowDays * 100) : 0;
  if (window.status !== "available" || profit === null || loss === null || continuity === null
    || coverage < 80 || confirmation.fullWindowComplete !== true) {
    return groupResult("persistence", "跨日持续性", "insufficient", null, coverage, [
      "五日情绪窗口或核心连续性证据不完整",
    ], ["emotionCycle.bigCycle.window"]);
  }
  const distribution = normalizeDistribution({
    repair_or_consensus: profit * 0.45 + (100 - loss) * 0.35 + continuity * 0.2,
    divergence_continuation: (100 - Math.abs(profit - loss)) * 0.65 + (100 - continuity) * 0.35,
    negative_feedback_expansion: loss * 0.45 + (100 - profit) * 0.35 + (100 - continuity) * 0.2,
  });
  return groupResult("persistence", "跨日持续性", "ready", distribution, coverage, [
    `五日加权赚钱${round(profit)}、亏钱${round(loss)}、核心连续性${round(continuity)}`,
    `最近两日状态：${list(confirmation.recentTwoStates).map(text).filter(Boolean).join(" / ") || "待确认"}`,
  ], ["emotionCycle.bigCycle.window"]);
}

function styleFundsGroup(payload) {
  const phase = object(payload.marketPhaseDetail);
  const preference = object(object(phase.decisionContext).speculationPreference);
  const confirmedItems = list(preference.items).filter((row) => row && row.status === "confirmed"
    && finite(row.score) !== null);
  if (preference.status !== "available" || preference.conclusionStatus !== "confirmed" || !confirmedItems.length) {
    return groupResult("styleFunds", "资金与炒作风格", "insufficient", null, 0, [
      "持续炒作偏好尚未确认",
    ], ["marketPhaseDetail.decisionContext.speculationPreference"]);
  }
  const averageScore = confirmedItems.reduce((sum, row) => sum + Number(row.score), 0) / confirmedItems.length;
  const parallelAdjustment = confirmedItems.length > 1 ? 15 : 0;
  const distribution = normalizeDistribution({
    repair_or_consensus: averageScore,
    divergence_continuation: Math.max(20, 100 - averageScore) + parallelAdjustment,
    negative_feedback_expansion: 100 - averageScore,
  });
  const sampleCount = confirmedItems.reduce((sum, row) => sum + Math.max(0, Number(row.sampleCount || 0)), 0);
  return groupResult("styleFunds", "资金与炒作风格", "ready", distribution, 100, [
    `已确认风格：${confirmedItems.map((row) => text(row.label)).filter(Boolean).join(" / ")}`,
    `风格规则均分${round(averageScore)}，样本合计${sampleCount}`,
    confirmedItems.length > 1 ? "多路径并行，保留分歧权重" : "单一路径占优",
  ], ["marketPhaseDetail.decisionContext.speculationPreference"]);
}

function axisTemplate(value, kind) {
  const key = text(value).toLowerCase();
  const repair = { repair_or_consensus: 60, divergence_continuation: 30, negative_feedback_expansion: 10 };
  const mainRise = { repair_or_consensus: 55, divergence_continuation: 35, negative_feedback_expansion: 10 };
  const divergence = { repair_or_consensus: 25, divergence_continuation: 60, negative_feedback_expansion: 15 };
  const negative = { repair_or_consensus: 10, divergence_continuation: 20, negative_feedback_expansion: 70 };
  if (/retreat|ice|decline|negative|weakening|退潮|冰点|下降|负反馈|转弱/.test(key)) return negative;
  if (/range|chaos|diverg|mixed|震荡|混沌|分歧/.test(key)) return divergence;
  if (/main_rise|partial_main_rise|主升/.test(key)) return mainRise;
  if (/repair|strength|support|修复|加强|承接/.test(key)) return repair;
  if (kind === "bigCycle" && /rise|up/.test(key)) return mainRise;
  return null;
}

function structureGroup(payload) {
  const phase = object(payload.marketPhaseDetail);
  const axes = [
    { key: "bigCycle", label: "情绪大周期", value: phase.structuralCycle || object(phase.structuralCycleDetail).key, weight: 40 },
    { key: "smallCycle", label: "小周期", value: object(phase.smallCycle).key || object(phase.smallCycle).label, weight: 25 },
    { key: "indexShort", label: "指数5日结构", value: object(phase.indexShortStructure).key || object(phase.indexShortStructure).label, weight: 20 },
    { key: "dailyRhythm", label: "当日节奏", value: object(phase.dailyRhythm).key || object(phase.dailyRhythm).label, weight: 15 },
  ];
  const raw = { repair_or_consensus: 0, divergence_continuation: 0, negative_feedback_expansion: 0 };
  let availableWeight = 0;
  const reasons = [];
  axes.forEach((axis) => {
    const template = axisTemplate(axis.value, axis.key);
    if (!template) return;
    availableWeight += axis.weight;
    SCENARIOS.forEach(({ key }) => { raw[key] += template[key] * axis.weight / 100; });
    reasons.push(`${axis.label}：${text(axis.value)}`);
  });
  if (availableWeight < 60) {
    return groupResult("structure", "指数与市场结构", "insufficient", null, availableWeight, [
      "情绪大周期、小周期或指数结构覆盖不足",
      ...reasons,
    ], ["marketPhaseDetail"]);
  }
  return groupResult("structure", "指数与市场结构", "ready", normalizeDistribution(raw), availableWeight, reasons, [
    "marketPhaseDetail.structuralCycle",
    "marketPhaseDetail.smallCycle",
    "marketPhaseDetail.indexShortStructure",
    "marketPhaseDetail.dailyRhythm",
  ]);
}

function confidenceLabel(score) {
  if (score >= 75) return "较高";
  if (score >= 60) return "中等";
  return "较低";
}

function unavailableEmotionScenarioInference(generation, reasonCodes = ["scenario_inference_unavailable"]) {
  const expected = object(generation);
  return {
    version: EMOTION_SCENARIO_INFERENCE_VERSION,
    method: EMOTION_SCENARIO_INFERENCE_METHOD,
    status: "unavailable",
    calibrated: false,
    probability: null,
    probabilityType: "model_implied_uncalibrated",
    generation: clone(expected, {}),
    generationId: text(expected.generationId),
    tradingDate: text(expected.tradingDate),
    asOf: text(expected.asOf),
    groupWeights: clone(GROUP_WEIGHTS, {}),
    groups: [],
    scenarios: [],
    primaryScenario: null,
    confidence: {
      score: null,
      label: "不可用",
      coveragePct: 0,
      agreementPct: null,
      separationPct: null,
      canShowPercentages: false,
    },
    guardrails: {
      observationOnly: true,
      emotionStageAuthority: false,
      selectionAuthority: false,
      executionAuthority: false,
      positionAuthority: false,
      probabilityAuthority: false,
      historicalCalibrationRequiredForProbabilityClaim: true,
    },
    integrity: {
      sameGeneration: false,
      scenarioWeightsSumTo100: false,
      groupWeightsSumTo100: true,
      noTradeAuthority: true,
    },
    dataQuality: {
      usable: false,
      failClosed: true,
      reasonCodes: list(reasonCodes).map(text).filter(Boolean),
    },
  };
}

function buildEmotionScenarioInference(input = {}) {
  const payload = object(input.payload);
  const expected = expectedGeneration(input);
  if (!expected.generationId || !expected.tradingDate || !expected.asOf) {
    return unavailableEmotionScenarioInference(expected, ["generation_incomplete"]);
  }
  const emotionCoreEvidence = object(input.emotionCoreEvidence
    || payload.emotionCoreEvidence
    || object(payload.tomorrowDecision).emotionCoreEvidence);
  const phase = object(payload.marketPhaseDetail);
  const emotionCycle = object(payload.emotionCycle);
  const effectTradingDate = normalizedDate(object(object(object(payload.market).state).emotionEffectContext).tradingDate);
  const lineageValid = sameGeneration(emotionCoreEvidence, expected)
    && sameGeneration(phase, expected)
    && sameGeneration(emotionCycle, expected)
    && (!effectTradingDate || effectTradingDate === normalizedDate(expected.tradingDate));
  if (!lineageValid) {
    return unavailableEmotionScenarioInference(expected, ["same_generation_evidence_required"]);
  }

  const groups = [
    coreGroup(emotionCoreEvidence),
    profitLossGroup(payload),
    persistenceGroup(payload),
    styleFundsGroup(payload),
    structureGroup(payload),
  ];
  const readyGroups = groups.filter((group) => group.status === "ready" && group.distribution);
  const readyKeys = new Set(readyGroups.map((group) => group.key));
  const missingCritical = CRITICAL_GROUPS.filter((key) => !readyKeys.has(key));
  const activeWeight = readyGroups.reduce((sum, group) => sum + group.weight, 0);
  const weightedCoverage = round(groups.reduce((sum, group) => (
    sum + group.weight * group.coveragePct / 100
  ), 0), 1);
  const rawScenarios = Object.fromEntries(SCENARIOS.map(({ key }) => [key, 0]));
  readyGroups.forEach((group) => {
    SCENARIOS.forEach(({ key }) => {
      rawScenarios[key] += group.distribution[key] * group.weight / 100;
    });
  });
  const distribution = activeWeight > 0 ? normalizeDistribution(rawScenarios) : null;
  if (missingCritical.length || activeWeight < MIN_ACTIVE_WEIGHT || !distribution) {
    const unavailable = unavailableEmotionScenarioInference(expected, [
      ...missingCritical.map((key) => `critical_group_missing:${key}`),
      ...(activeWeight < MIN_ACTIVE_WEIGHT ? ["active_group_weight_below_80"] : []),
    ]);
    unavailable.status = "insufficient";
    unavailable.groups = groups;
    unavailable.confidence.coveragePct = weightedCoverage;
    unavailable.integrity.sameGeneration = true;
    return unavailable;
  }

  const ranked = SCENARIOS.map((scenario) => ({
    ...scenario,
    modelWeightPct: distribution[scenario.key],
    probability: null,
    calibrated: false,
  })).sort((left, right) => right.modelWeightPct - left.modelWeightPct || left.key.localeCompare(right.key));
  ranked.forEach((scenario, index) => { scenario.rank = index + 1; });
  const primary = ranked[0];
  const second = ranked[1];
  const topGap = round(primary.modelWeightPct - second.modelWeightPct, 1);
  const winnerWeights = {};
  readyGroups.forEach((group) => {
    winnerWeights[group.primaryScenario] = (winnerWeights[group.primaryScenario] || 0) + group.weight;
  });
  const agreementPct = round(Math.max(...Object.values(winnerWeights)) / activeWeight * 100, 1);
  const separationPct = round(clamp(topGap * 4), 1);
  const previousNode = object(object(object(emotionCoreEvidence.emotionStagePath).nodes).previous);
  const previousLineageStatus = previousNode.status === "ready"
    ? "ready"
    : previousNode.status === "insufficient" ? "insufficient" : "unavailable";
  const lineageScore = previousLineageStatus === "ready" ? 100 : previousLineageStatus === "insufficient" ? 45 : 20;
  let confidenceScore = round(
    weightedCoverage * 0.35
    + agreementPct * 0.2
    + separationPct * 0.2
    + lineageScore * 0.25,
    1,
  );
  if (previousLineageStatus === "insufficient") confidenceScore = Math.min(confidenceScore, 65);
  if (previousLineageStatus === "unavailable") confidenceScore = Math.min(confidenceScore, 50);
  const canShowPercentages = confidenceScore >= MIN_PERCENTAGE_CONFIDENCE;
  const weightTotal = round(ranked.reduce((sum, row) => sum + row.modelWeightPct, 0), 1);
  const existingDecision = object(input.existingDecision || payload.tomorrowDecision);
  const baseline = object(existingDecision.tomorrowBaseline || object(phase).tomorrowBaseline);

  return {
    version: EMOTION_SCENARIO_INFERENCE_VERSION,
    method: EMOTION_SCENARIO_INFERENCE_METHOD,
    status: "ready",
    calibrated: false,
    probability: null,
    probabilityType: "model_implied_uncalibrated",
    label: "当下证据动态推演（未历史校准）",
    generation: clone(expected, {}),
    generationId: expected.generationId,
    tradingDate: expected.tradingDate,
    asOf: expected.asOf,
    groupWeights: clone(GROUP_WEIGHTS, {}),
    groups,
    scenarios: ranked,
    primaryScenario: clone(primary, null),
    confidence: {
      score: confidenceScore,
      label: confidenceLabel(confidenceScore),
      coveragePct: weightedCoverage,
      agreementPct,
      separationPct,
      topGap,
      previousLineageStatus,
      canShowPercentages,
      rule: "数据覆盖、证据组一致性、情景分离度与T-1严格核心血缘共同决定",
    },
    baseline: {
      key: text(baseline.key) || null,
      label: text(baseline.label) || null,
      status: text(baseline.status) || "baseline_unconfirmed",
      calibrated: false,
      probability: null,
    },
    guardrails: {
      observationOnly: true,
      emotionStageAuthority: false,
      selectionAuthority: false,
      executionAuthority: false,
      positionAuthority: false,
      probabilityAuthority: false,
      historicalCalibrationRequiredForProbabilityClaim: true,
    },
    integrity: {
      sameGeneration: true,
      scenarioWeightsSumTo100: Math.abs(weightTotal - 100) < 0.01,
      groupWeightsSumTo100: Object.values(GROUP_WEIGHTS).reduce((sum, value) => sum + value, 0) === 100,
      criticalGroupsReady: missingCritical.length === 0,
      noTradeAuthority: true,
      duplicateEvidenceGroupsCapped: true,
    },
    dataQuality: {
      usable: true,
      failClosed: false,
      activeGroupWeight: activeWeight,
      missingGroups: groups.filter((group) => group.status !== "ready").map((group) => group.key),
      reasonCodes: [],
    },
  };
}

function validateEmotionScenarioInference(value, generation = {}) {
  const inference = object(value);
  const expected = object(generation);
  if (inference.version !== EMOTION_SCENARIO_INFERENCE_VERSION
    || inference.method !== EMOTION_SCENARIO_INFERENCE_METHOD
    || inference.calibrated !== false
    || inference.probability !== null
    || !sameGeneration(inference, expected)) return false;
  const guardrails = object(inference.guardrails);
  if (guardrails.observationOnly !== true
    || guardrails.emotionStageAuthority !== false
    || guardrails.selectionAuthority !== false
    || guardrails.executionAuthority !== false
    || guardrails.positionAuthority !== false
    || guardrails.probabilityAuthority !== false
    || guardrails.historicalCalibrationRequiredForProbabilityClaim !== true) return false;
  if (!["ready", "insufficient", "unavailable"].includes(inference.status)) return false;
  if (inference.status !== "ready") return list(inference.scenarios).length === 0;
  const scenarios = list(inference.scenarios);
  const keys = scenarios.map((row) => text(row && row.key));
  const weights = scenarios.map((row) => finite(row && row.modelWeightPct));
  const ranks = scenarios.map((row) => finite(row && row.rank));
  const integrity = object(inference.integrity);
  return scenarios.length === SCENARIOS.length
    && new Set(keys).size === SCENARIOS.length
    && SCENARIOS.every(({ key }) => keys.includes(key))
    && weights.every((weight) => weight !== null && weight >= 0 && weight <= 100)
    && Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 100) < 0.01
    && ranks.slice().sort((a, b) => a - b).join(",") === "1,2,3"
    && scenarios.every((row) => row.probability === null && row.calibrated === false)
    && integrity.sameGeneration === true
    && integrity.scenarioWeightsSumTo100 === true
    && integrity.groupWeightsSumTo100 === true
    && integrity.criticalGroupsReady === true
    && integrity.noTradeAuthority === true;
}

module.exports = {
  EMOTION_SCENARIO_INFERENCE_VERSION,
  EMOTION_SCENARIO_INFERENCE_METHOD,
  SCENARIOS,
  GROUP_WEIGHTS,
  MIN_PERCENTAGE_CONFIDENCE,
  buildEmotionScenarioInference,
  unavailableEmotionScenarioInference,
  validateEmotionScenarioInference,
};
