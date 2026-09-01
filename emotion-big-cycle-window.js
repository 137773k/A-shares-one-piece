"use strict";

/**
 * Five-closing-day emotion big-cycle window.
 *
 * Boundary:
 * - pure function; no file, clock, index, theme or candidate access;
 * - observations are expected to be full-market closing observations;
 * - positive upgrades require a complete five-day window and confirmation on
 *   both latest trading days;
 * - retreat is a safety downgrade and may be emitted early only when the
 *   full-market loss score is expanding or remains elevated across days.
 */

const VERSION = 1;
const METHOD = "five_day_weighted_emotion_big_cycle_window_v1";
const WINDOW_DAYS = 5;
const WINDOW_WEIGHTS = Object.freeze([8, 12, 20, 25, 35]);

const STATE_LABELS = Object.freeze({
  main_rise: "主升",
  range: "震荡",
  chaos: "混沌",
  retreat: "退潮",
  ice_point: "冰点",
  unavailable: "不可用",
});

const THRESHOLDS = Object.freeze({
  mainRise: Object.freeze({
    weightedProfitMin: 65,
    weightedLossMax: 40,
    weightedCoreContinuityMin: 58,
    dailyProfitMin: 60,
    dailyLossMax: 45,
    dailyCoreContinuityMin: 52,
  }),
  range: Object.freeze({
    weightedProfitMin: 40,
    weightedProfitMax: 68,
    weightedLossMax: 58,
    weightedCoreContinuityMin: 35,
    dailyProfitMin: 38,
    dailyProfitMax: 70,
    dailyLossMax: 60,
    dailyCoreContinuityMin: 32,
  }),
  retreat: Object.freeze({
    lossMin: 62,
    expansionDeltaMin: 8,
    supportingProfitMax: 55,
    supportingCoreContinuityMax: 40,
    persistentProfitMax: 52,
    persistentCoreContinuityMax: 42,
  }),
  icePoint: Object.freeze({
    weightedProfitMax: 32,
    weightedLossMin: 68,
    weightedCoreContinuityMax: 28,
    dailyProfitMax: 35,
    dailyLossMin: 65,
    dailyCoreContinuityMax: 30,
    maximumLossExpansion: 5,
  }),
});

function finiteScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizedTradingDate(value) {
  const text = String(value || "").trim().slice(0, 10);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text
    ? text
    : null;
}

function normalizeObservation(value, inputIndex) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const tradingDate = normalizedTradingDate(source.tradingDate);
  const profitScore = finiteScore(source.profitScore);
  const lossScore = finiteScore(source.lossScore);
  const coreContinuityScore = finiteScore(source.coreContinuityScore);
  const complete = source.complete === true
    && Boolean(tradingDate)
    && profitScore !== null
    && lossScore !== null
    && coreContinuityScore !== null;
  return {
    tradingDate,
    profitScore,
    lossScore,
    coreContinuityScore,
    complete,
    inputIndex,
  };
}

function latestUniqueWindow(observations) {
  const normalized = (Array.isArray(observations) ? observations : [])
    .map(normalizeObservation)
    .filter((item) => item.tradingDate)
    .sort((left, right) => left.tradingDate.localeCompare(right.tradingDate)
      || left.inputIndex - right.inputIndex);
  const byDate = new Map();
  normalized.forEach((item) => byDate.set(item.tradingDate, item));
  return [...byDate.values()]
    .sort((left, right) => left.tradingDate.localeCompare(right.tradingDate))
    .slice(-WINDOW_DAYS);
}

function weightedMetric(window, field) {
  const offset = WINDOW_DAYS - window.length;
  let weighted = 0;
  let coverageWeight = 0;
  window.forEach((item, index) => {
    if (!item.complete) return;
    const score = finiteScore(item[field]);
    if (score === null) return;
    const weight = WINDOW_WEIGHTS[offset + index];
    weighted += score * weight;
    coverageWeight += weight;
  });
  return coverageWeight ? round(weighted / coverageWeight) : null;
}

function dailyState(observation) {
  if (!observation || !observation.complete) return "unavailable";
  const profit = observation.profitScore;
  const loss = observation.lossScore;
  const continuity = observation.coreContinuityScore;
  const main = THRESHOLDS.mainRise;
  if (profit >= main.dailyProfitMin
    && loss <= main.dailyLossMax
    && continuity >= main.dailyCoreContinuityMin) return "main_rise";
  const ice = THRESHOLDS.icePoint;
  if (profit <= ice.dailyProfitMax
    && loss >= ice.dailyLossMin
    && continuity <= ice.dailyCoreContinuityMax) return "ice_point";
  const range = THRESHOLDS.range;
  if (profit >= range.dailyProfitMin
    && profit <= range.dailyProfitMax
    && loss <= range.dailyLossMax
    && continuity >= range.dailyCoreContinuityMin) return "range";
  return "chaos";
}

function stateCandidate(key, reasonCode, confirmed, reason) {
  return {
    key,
    label: STATE_LABELS[key],
    status: key === "unavailable" ? "unavailable" : "candidate",
    confirmed: Boolean(confirmed),
    reasonCode,
    reason,
  };
}

function unavailableResult(window, reasonCode, reason, metrics = {}) {
  return {
    version: VERSION,
    method: METHOD,
    calibrated: false,
    status: "unavailable",
    key: "unavailable",
    label: STATE_LABELS.unavailable,
    candidate: stateCandidate("unavailable", reasonCode, false, reason),
    windowDays: WINDOW_DAYS,
    weights: [...WINDOW_WEIGHTS],
    observations: window.map(({ inputIndex, ...item }) => ({
      ...item,
      dailyState: dailyState(item),
    })),
    metrics,
    confirmation: {
      requiredRecentDays: 2,
      recentTwoComplete: false,
      recentTwoSameState: false,
      recentTwoStates: [],
    },
    evidence: [reason],
    blockers: [reasonCode],
    thresholds: THRESHOLDS,
    guardrails: guardrails(),
  };
}

function guardrails() {
  return {
    fullMarketObservationRequired: true,
    exactClosingObservationRequired: true,
    fiveDayWindowRequiredForUpgrade: true,
    ordinarySwitchRequiresTwoRecentDays: true,
    retreatRequiresLossExpansionOrPersistence: true,
    missingCannotUpgrade: true,
    noProbabilityOrWinRateClaim: true,
  };
}

function classifyEmotionBigCycleWindow(observations = []) {
  const window = latestUniqueWindow(observations);
  const completeCount = window.filter((item) => item.complete).length;
  const metrics = {
    observedDays: window.length,
    completeDays: completeCount,
    weightedProfitScore: weightedMetric(window, "profitScore"),
    weightedLossScore: weightedMetric(window, "lossScore"),
    weightedCoreContinuityScore: weightedMetric(window, "coreContinuityScore"),
    latestLossDelta: null,
  };
  if (!window.length) {
    return unavailableResult(window, "window_empty", "缺少五日情绪观察，不能生成大周期候选。", metrics);
  }

  const recentTwo = window.slice(-2);
  const recentTwoComplete = recentTwo.length === 2 && recentTwo.every((item) => item.complete);
  if (recentTwoComplete) {
    metrics.latestLossDelta = round(recentTwo[1].lossScore - recentTwo[0].lossScore);
  }
  if (!recentTwoComplete) {
    return unavailableResult(
      window,
      "recent_two_incomplete",
      "最近两个交易日证据不完整；缺失数据不能推动大周期切换。",
      metrics,
    );
  }

  const recentStates = recentTwo.map(dailyState);
  const recentTwoSameState = recentStates[0] === recentStates[1];
  const latest = recentTwo[1];
  const previous = recentTwo[0];
  const retreat = THRESHOLDS.retreat;
  const lossExpansion = latest.lossScore >= retreat.lossMin
    && metrics.latestLossDelta >= retreat.expansionDeltaMin
    && (latest.profitScore <= retreat.supportingProfitMax
      || latest.coreContinuityScore <= retreat.supportingCoreContinuityMax);
  const lossPersistence = previous.lossScore >= retreat.lossMin
    && latest.lossScore >= retreat.lossMin
    && ((previous.profitScore + latest.profitScore) / 2 <= retreat.persistentProfitMax
      || (previous.coreContinuityScore + latest.coreContinuityScore) / 2
        <= retreat.persistentCoreContinuityMax);

  const fullWindowComplete = window.length === WINDOW_DAYS && completeCount === WINDOW_DAYS;
  const ice = THRESHOLDS.icePoint;
  const icePointConfirmed = fullWindowComplete
    && recentStates.every((state) => state === "ice_point")
    && metrics.weightedProfitScore <= ice.weightedProfitMax
    && metrics.weightedLossScore >= ice.weightedLossMin
    && metrics.weightedCoreContinuityScore <= ice.weightedCoreContinuityMax
    && metrics.latestLossDelta <= ice.maximumLossExpansion;

  let candidate;
  const evidence = [
    `五日权重=${WINDOW_WEIGHTS.join("/")}`,
    `加权赚钱=${metrics.weightedProfitScore ?? "unknown"}`,
    `加权亏钱=${metrics.weightedLossScore ?? "unknown"}`,
    `加权核心连续性=${metrics.weightedCoreContinuityScore ?? "unknown"}`,
    `最近两日=${recentStates.map((state) => STATE_LABELS[state] || state).join("/")}`,
  ];

  if (lossExpansion) {
    candidate = stateCandidate(
      "retreat",
      "full_market_loss_expanding",
      true,
      `全市场亏钱强度升至${latest.lossScore}，较前一日扩大${metrics.latestLossDelta}分。`,
    );
    evidence.push(candidate.reason);
  } else if (icePointConfirmed) {
    candidate = stateCandidate(
      "ice_point",
      "two_day_extreme_freeze_confirmed",
      true,
      "极低赚钱、极高亏钱与核心连续性断裂连续两日成立，且亏钱扩散未继续加速。",
    );
    evidence.push(candidate.reason);
  } else if (lossPersistence) {
    candidate = stateCandidate(
      "retreat",
      "full_market_loss_persistent_two_days",
      true,
      "全市场高亏钱强度连续两个交易日存在，跨日持续确认退潮候选。",
    );
    evidence.push(candidate.reason);
  } else if (!fullWindowComplete) {
    return unavailableResult(
      window,
      "five_day_window_incomplete",
      `五日窗口仅${completeCount}/${WINDOW_DAYS}日完整；缺失数据不能升级为主升、震荡或冰点。`,
      metrics,
    );
  } else {
    const main = THRESHOLDS.mainRise;
    const mainRiseConfirmed = recentStates.every((state) => state === "main_rise")
      && metrics.weightedProfitScore >= main.weightedProfitMin
      && metrics.weightedLossScore <= main.weightedLossMax
      && metrics.weightedCoreContinuityScore >= main.weightedCoreContinuityMin;
    const range = THRESHOLDS.range;
    const rangeConfirmed = recentStates.every((state) => state === "range")
      && metrics.weightedProfitScore >= range.weightedProfitMin
      && metrics.weightedProfitScore <= range.weightedProfitMax
      && metrics.weightedLossScore <= range.weightedLossMax
      && metrics.weightedCoreContinuityScore >= range.weightedCoreContinuityMin;
    if (mainRiseConfirmed) {
      candidate = stateCandidate(
        "main_rise",
        "two_day_main_rise_confirmed",
        true,
        "五日加权结构通过，且最近两个交易日均满足主升条件。",
      );
    } else if (rangeConfirmed) {
      candidate = stateCandidate(
        "range",
        "two_day_range_confirmed",
        true,
        "五日加权结构通过，且最近两个交易日均满足震荡条件。",
      );
    } else {
      const chaosConfirmed = recentStates.every((state) => state === "chaos");
      candidate = stateCandidate(
        "chaos",
        recentTwoSameState ? "weighted_structure_conflicted" : "recent_two_switch_unconfirmed",
        chaosConfirmed,
        recentTwoSameState
          ? "最近两日同态但五日加权结构未通过对应周期门槛，保守归入混沌。"
          : "最近两个交易日未形成同一状态确认，普通切换尚未成立，保守归入混沌。",
      );
    }
    evidence.push(candidate.reason);
  }

  return {
    version: VERSION,
    method: METHOD,
    calibrated: false,
    status: "available",
    key: candidate.key,
    label: candidate.label,
    candidate,
    windowDays: WINDOW_DAYS,
    weights: [...WINDOW_WEIGHTS],
    observations: window.map(({ inputIndex, ...item }) => ({
      ...item,
      dailyState: dailyState(item),
    })),
    metrics,
    confirmation: {
      requiredRecentDays: 2,
      recentTwoComplete,
      recentTwoSameState,
      recentTwoStates: recentStates,
      lossExpansion,
      lossPersistence,
      fullWindowComplete,
    },
    evidence,
    blockers: [],
    thresholds: THRESHOLDS,
    guardrails: guardrails(),
  };
}

module.exports = {
  VERSION,
  METHOD,
  WINDOW_DAYS,
  WINDOW_WEIGHTS,
  THRESHOLDS,
  STATE_LABELS,
  classifyEmotionBigCycleWindow,
  buildEmotionBigCycleWindow: classifyEmotionBigCycleWindow,
};
