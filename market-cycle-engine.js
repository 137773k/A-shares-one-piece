"use strict";

/**
 * 市场赚钱/亏钱效应识别器。
 *
 * 这是一个无 IO、无缓存、无时间依赖的纯函数模块。它只描述“今天发生了
 * 什么”，不直接推进基础情绪周期，也不产生买卖结论。调用方可以在验证过
 * 上一交易日数据后，再把 dailyState 交给周期状态机。
 *
 * @param {Object} input
 * @param {Object} input.snapshot                  当日市场快照
 * @param {Object} input.limitStats                当日涨跌停统计
 * @param {Object} [input.previousSnapshot]        上一交易日市场快照
 * @param {Object} [input.previousLimit]           上一交易日涨跌停统计
 * @param {Object|Array} [input.leadership]        龙头/情绪锚点聚合信息或明细
 * @param {Object|Array} [input.directions]        方向赚钱效应聚合信息或明细
 * @returns {{version:number, profitEffect:Object, lossEffect:Object,
 *   dailyState:Object, evidence:Array, dataQuality:Object}}
 */

const ENGINE_VERSION = 5;
const EMOTION_EFFECT_CONTEXT_VERSION = 1;
const { buildIndexCycleRegime } = require("./index-cycle-regime");
const {
  normalizeBigCycle,
  repairTransition,
  smallCycleFromSignals,
} = require("./quant-decision/market-cycle-contract");

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFinite(...values) {
  for (const value of values) {
    const number = finite(value);
    if (number !== null) return number;
  }
  return null;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function normalizeRatio(value) {
  const number = finite(value);
  if (number === null) return null;
  if (number > 1 && number <= 100) return number / 100;
  return number;
}

function interpolate(value, stops) {
  const number = finite(value);
  if (number === null || !Array.isArray(stops) || !stops.length) return null;
  if (number <= stops[0][0]) return stops[0][1];
  for (let index = 1; index < stops.length; index += 1) {
    const [rightValue, rightScore] = stops[index];
    const [leftValue, leftScore] = stops[index - 1];
    if (number <= rightValue) {
      const ratio = (number - leftValue) / (rightValue - leftValue || 1);
      return leftScore + (rightScore - leftScore) * ratio;
    }
  }
  return stops[stops.length - 1][1];
}

function percent(value, digits = 0) {
  const number = finite(value);
  if (number === null) return "—";
  return `${(number * 100).toFixed(digits)}%`;
}

function signedPercent(value, digits = 2) {
  const number = finite(value);
  if (number === null) return "—";
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function safeRatio(current, previous) {
  const now = finite(current);
  const before = finite(previous);
  return now !== null && before !== null && before > 0 ? now / before : null;
}

function readBreadth(snapshot) {
  const direct = normalizeRatio(snapshot && firstFinite(
    snapshot.breadth,
    snapshot.upRatio,
    snapshot.advanceRatio,
  ));
  if (direct !== null) return clamp(direct, 0, 1);
  const up = firstFinite(snapshot && snapshot.upCount, snapshot && snapshot.advanceCount);
  const down = firstFinite(snapshot && snapshot.downCount, snapshot && snapshot.declineCount);
  return up !== null && down !== null && up + down > 0 ? up / (up + down) : null;
}

function readSnapshot(snapshot) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  return {
    index: firstFinite(source.avgIndexChange, source.indexChange, source.indexChangePct),
    breadth: readBreadth(source),
    amount: firstFinite(source.shszAmountYi, source.totalAmountYi, source.amountYi),
    largeGainCount: firstFinite(source.largeGainCount, source.up5Count, source.gain5Count),
    largeLossCount: firstFinite(source.largeLossCount, source.down5Count, source.loss5Count),
    date: source.tradingDate || source.date || source.dataDate || null,
  };
}

function readLimit(limitStats, previousLimit) {
  const source = limitStats && typeof limitStats === "object" ? limitStats : {};
  const previous = previousLimit && typeof previousLimit === "object" ? previousLimit : {};
  const explicitPrevious = Boolean(previousLimit && typeof previousLimit === "object");
  const currentUp = firstFinite(source.ztToday, source.limitUpCount, source.upLimitCount);
  const currentDown = firstFinite(source.dtToday, source.limitDownCount, source.downLimitCount);
  const previousUp = explicitPrevious
    ? firstFinite(previous.ztToday, previous.limitUpCount, previous.upLimitCount)
    : firstFinite(source.ztPrev, source.previousLimitUpCount);
  const previousDown = explicitPrevious
    ? firstFinite(previous.dtToday, previous.limitDownCount, previous.downLimitCount)
    : firstFinite(source.dtPrev, source.previousLimitDownCount);
  return {
    up: currentUp,
    down: currentDown,
    previousUp,
    previousDown,
    upComparisonKnown: currentUp !== null && previousUp !== null,
    downComparisonKnown: currentDown !== null && previousDown !== null,
    upRatio: safeRatio(currentUp, previousUp),
    downRatio: safeRatio(currentDown, previousDown),
    sealRate: normalizeRatio(firstFinite(source.sealRate, source.limitSealRate)),
    promotionRate: normalizeRatio(firstFinite(source.promotionRate, source.advanceRate)),
    date: source.dates && source.dates.today || source.tradingDate || source.date || null,
    previousDate: explicitPrevious
      ? previous.dates && previous.dates.today || previous.tradingDate || previous.date || null
      : source.dates && source.dates.prev || source.previousDate || null,
  };
}

function listFrom(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["items", "leaders", "stocks", "rows"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function average(values) {
  const rows = (values || []).map(finite).filter((value) => value !== null);
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : null;
}

function normalizeLeadership(leadership) {
  const source = leadership && !Array.isArray(leadership) && typeof leadership === "object"
    ? leadership
    : {};
  const items = listFrom(leadership);
  const derivedActive = items.filter((item) => {
    const initiative = firstFinite(
      item && item.initiativeScore,
      item && item.initiative && item.initiative.score,
    );
    return Boolean(item && (item.active === true || item.isActiveLeader === true))
      || (initiative !== null && initiative >= 60)
      || /主攻|主动|attack/i.test(String(item && (item.tradeState || item.role) || ""));
  }).length;
  const derivedBreakdown = items.filter((item) => Boolean(item && (
    item.structureBreak === true
    || item.breakdown === true
    || finite(item.changePct) !== null && finite(item.changePct) <= -7
  ))).length;
  const activeCount = firstFinite(
    source.activeLeaderCount,
    source.activeCount,
    source.attackCount,
    source.coreActiveCount,
    items.length ? derivedActive : null,
  );
  const breakdownCount = firstFinite(
    source.coreBreakdownCount,
    source.breakdownCount,
    source.negativeFeedbackCount,
    items.length ? derivedBreakdown : null,
  );
  const coreAvgChange = firstFinite(
    source.coreAvgChange,
    source.coreAvgChangePct,
    average(items.map((item) => item && item.changePct)),
  );
  let positiveRate = normalizeRatio(firstFinite(source.corePositiveRate, source.positiveRate));
  if (positiveRate === null && items.length) {
    const priced = items.map((item) => finite(item && item.changePct)).filter((value) => value !== null);
    positiveRate = priced.length ? priced.filter((value) => value > 0).length / priced.length : null;
  }
  const highBoardNegativeRate = normalizeRatio(firstFinite(
    source.highBoardNegativeRate,
    source.negativeRate,
    source.coreNegativeRate,
  ));
  const initiativeScore = firstFinite(source.initiativeScore, source.score);

  const profitParts = [];
  if (activeCount !== null) profitParts.push(interpolate(activeCount, [[0, 10], [1, 65], [2, 85], [3, 100]]));
  if (coreAvgChange !== null) profitParts.push(interpolate(coreAvgChange, [[-7, 0], [-2, 15], [0, 40], [3, 72], [7, 100]]));
  if (positiveRate !== null) profitParts.push(interpolate(positiveRate, [[0.2, 0], [0.4, 30], [0.55, 55], [0.7, 80], [0.9, 100]]));
  if (initiativeScore !== null) profitParts.push(clamp(initiativeScore));

  const lossParts = [];
  if (breakdownCount !== null) lossParts.push(interpolate(breakdownCount, [[0, 0], [1, 45], [2, 72], [3, 90], [5, 100]]));
  if (highBoardNegativeRate !== null) lossParts.push(interpolate(highBoardNegativeRate, [[0.1, 0], [0.3, 35], [0.5, 65], [0.75, 90], [1, 100]]));
  if (coreAvgChange !== null) lossParts.push(interpolate(coreAvgChange, [[-9, 100], [-5, 78], [-2, 48], [0, 22], [3, 0]]));

  return {
    available: profitParts.length > 0 || lossParts.length > 0,
    activeCount,
    breakdownCount,
    coreAvgChange,
    positiveRate,
    highBoardNegativeRate,
    profitScore: average(profitParts),
    lossScore: average(lossParts),
  };
}

function normalizeDirections(directions) {
  const source = directions && !Array.isArray(directions) && typeof directions === "object"
    ? directions
    : {};
  const items = listFrom(directions);
  const derivedActive = items.filter((item) => Boolean(item && (
    item.active === true
    || item.strong === true
    || firstFinite(item.activeLeaderCount, item.limitUpCount, item.limitCount) > 0
    || item.resonance === true
    || finite(item.changePct) !== null && finite(item.changePct) >= 1
  ))).length;
  const derivedWeak = items.filter((item) => Boolean(item && (
    item.weak === true
    || item.negativeSpread === true
    || finite(item.changePct) !== null && finite(item.changePct) <= -2
  ))).length;
  const activeCount = firstFinite(
    source.activeDirectionCount,
    source.profitableDirectionCount,
    source.strongDirectionCount,
    items.length ? derivedActive : null,
  );
  const weakCount = firstFinite(
    source.weakDirectionCount,
    source.negativeDirectionCount,
    items.length ? derivedWeak : null,
  );
  const totalCount = firstFinite(source.totalDirectionCount, items.length || null);
  const avgChange = firstFinite(source.avgChangePct, average(items.map((item) => item && item.changePct)));
  const spreadRate = normalizeRatio(firstFinite(source.profitSpreadRate, source.positiveRate));

  const profitParts = [];
  if (activeCount !== null) profitParts.push(interpolate(activeCount, [[0, 5], [1, 55], [2, 75], [4, 100]]));
  if (avgChange !== null) profitParts.push(interpolate(avgChange, [[-3, 0], [-1, 20], [0, 42], [1.5, 70], [4, 100]]));
  if (spreadRate !== null) profitParts.push(interpolate(spreadRate, [[0.15, 0], [0.35, 35], [0.55, 65], [0.75, 100]]));

  const lossParts = [];
  if (weakCount !== null && totalCount !== null && totalCount > 0) {
    lossParts.push(interpolate(weakCount / totalCount, [[0, 0], [0.3, 35], [0.5, 65], [0.8, 100]]));
  } else if (weakCount !== null) {
    lossParts.push(interpolate(weakCount, [[0, 0], [1, 35], [2, 65], [4, 100]]));
  }
  if (avgChange !== null) lossParts.push(interpolate(avgChange, [[-4, 100], [-2, 72], [0, 25], [2, 0]]));

  return {
    available: profitParts.length > 0 || lossParts.length > 0,
    activeCount,
    weakCount,
    totalCount,
    avgChange,
    spreadRate,
    profitScore: average(profitParts),
    lossScore: average(lossParts),
  };
}

function component(score, weight, value, available = score !== null) {
  return {
    score: available ? round1(clamp(score)) : null,
    weight,
    value: value === undefined ? null : value,
    available: Boolean(available),
  };
}

function weightedScore(components, fallback = 50) {
  const rows = Object.values(components || {}).filter((item) => item && item.available && finite(item.score) !== null);
  const totalWeight = rows.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  if (!totalWeight) return fallback;
  return round1(rows.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight);
}

function weightedContextScore(components) {
  const rows = Object.values(components || {}).filter((item) => item && Number(item.weight) > 0);
  const totalWeight = rows.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  const known = rows.filter((item) => item.available && finite(item.score) !== null);
  const knownWeight = known.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  return {
    // The whole-market context must never turn an unknown score into a neutral 50.
    score: knownWeight
      ? round1(known.reduce((sum, item) => sum + Number(item.score) * Number(item.weight || 0), 0) / knownWeight)
      : null,
    coveragePct: totalWeight ? round1((knownWeight / totalWeight) * 100) : 0,
    knownWeight,
    totalWeight,
    known: known.map((item) => item.key),
    missing: rows.filter((item) => !item.available || finite(item.score) === null).map((item) => item.key),
  };
}

function emotionContextComponent(key, score, weight, value, sourceFields) {
  return {
    key,
    score: finite(score) === null ? null : round1(clamp(score)),
    weight,
    value: value === undefined ? null : value,
    available: finite(score) !== null,
    sourceFields: Array.isArray(sourceFields) ? sourceFields.slice() : [],
  };
}

function wholeMarketSealRate(limitStats, limit) {
  if (limit.sealRate !== null) return limit.sealRate;
  const source = limitStats && typeof limitStats === "object" ? limitStats : {};
  const touched = firstFinite(
    source.ztHistory,
    source.limitUpTouchedCount,
    source.touchedLimitUpCount,
  );
  if (touched === null || limit.up === null || touched <= 0 || touched < limit.up) return null;
  return clamp(limit.up / touched, 0, 1);
}

/**
 * Build a candidate-independent whole-market emotion-effect context.
 *
 * This context deliberately excludes index direction, turnover direction,
 * candidate/leader samples and hot-direction samples. It is the minimal
 * market-wide evidence layer for a later emotion-stage state machine; it does
 * not itself advance the structural cycle or grant selection authority.
 */
function buildEmotionEffectContext(input = {}) {
  const safeInput = input && typeof input === "object" ? input : {};
  const current = readSnapshot(safeInput.snapshot);
  const previous = readSnapshot(safeInput.previousSnapshot);
  const limit = readLimit(safeInput.limitStats, safeInput.previousLimit);
  const sealRate = wholeMarketSealRate(safeInput.limitStats, limit);

  const upLevelScore = interpolate(limit.up, [[0, 0], [15, 20], [30, 45], [45, 62], [60, 78], [80, 92], [120, 100]]);
  let upTrendScore = interpolate(limit.upRatio, [[0.3, 0], [0.5, 15], [0.7, 35], [0.9, 60], [1, 70], [1.15, 88], [1.4, 100]]);
  if (upTrendScore !== null && limit.up !== null) upTrendScore *= clamp(limit.up / 40, 0.25, 1);
  const breadthProfit = interpolate(current.breadth, [[0.2, 5], [0.3, 20], [0.4, 40], [0.5, 60], [0.6, 80], [0.7, 100]]);
  const largeGainScore = interpolate(current.largeGainCount, [[0, 0], [50, 10], [100, 20], [250, 50], [500, 75], [900, 100]]);
  const sealScore = interpolate(sealRate, [[0.35, 5], [0.5, 35], [0.65, 65], [0.8, 100]]);

  const downLevelScore = interpolate(limit.down, [[0, 0], [3, 8], [5, 15], [8, 25], [12, 40], [18, 60], [25, 78], [40, 95], [60, 100]]);
  const downTrendScore = limit.downRatio !== null
    ? interpolate(limit.downRatio, [[0.25, 0], [0.5, 10], [0.8, 30], [1, 45], [1.2, 62], [1.5, 78], [2, 95], [3, 100]])
    : limit.downComparisonKnown && limit.previousDown === 0
      ? interpolate(limit.down, [[0, 0], [1, 35], [3, 62], [5, 78], [8, 92], [12, 100]])
      : null;
  const breadthStress = breadthProfit === null ? null : 100 - breadthProfit;
  const largeLossScore = interpolate(current.largeLossCount, [[0, 0], [20, 10], [50, 25], [100, 45], [200, 70], [400, 90], [700, 100]]);
  const bombStress = sealScore === null ? null : 100 - sealScore;

  const profitComponents = {
    limitUpLevel: emotionContextComponent("limitUpLevel", upLevelScore, 30, limit.up, ["market.limitStats.ztToday"]),
    limitUpTrend: emotionContextComponent("limitUpTrend", upTrendScore, 20, limit.upRatio, ["market.limitStats.ztToday", "previous.market.limitStats.ztToday"]),
    breadth: emotionContextComponent("breadth", breadthProfit, 20, current.breadth, ["market.snapshot.breadth"]),
    largeGainBreadth: emotionContextComponent("largeGainBreadth", largeGainScore, 15, current.largeGainCount, ["market.snapshot.largeGainCount"]),
    sealQuality: emotionContextComponent("sealQuality", sealScore, 15, sealRate, ["market.limitStats.sealRate", "market.limitStats.ztHistory"]),
  };
  const lossComponents = {
    limitDownLevel: emotionContextComponent("limitDownLevel", downLevelScore, 30, limit.down, ["market.limitStats.dtToday"]),
    limitDownTrend: emotionContextComponent("limitDownTrend", downTrendScore, 20, limit.downRatio, ["market.limitStats.dtToday", "previous.market.limitStats.dtToday"]),
    breadthStress: emotionContextComponent("breadthStress", breadthStress, 20, current.breadth, ["market.snapshot.breadth"]),
    largeLossBreadth: emotionContextComponent("largeLossBreadth", largeLossScore, 15, current.largeLossCount, ["market.snapshot.largeLossCount"]),
    bombStress: emotionContextComponent("bombStress", bombStress, 15, sealRate === null ? null : 1 - sealRate, ["market.limitStats.sealRate", "market.limitStats.ztHistory"]),
  };
  const profit = weightedContextScore(profitComponents);
  const loss = weightedContextScore(lossComponents);

  const criticalSignals = {
    limitUp: limit.up !== null,
    limitDown: limit.down !== null,
    breadth: current.breadth !== null,
  };
  const criticalKnownCount = Object.values(criticalSignals).filter(Boolean).length;
  const crossDayKnown = limit.upComparisonKnown && limit.downComparisonKnown;
  const ready = criticalKnownCount === 3
    && crossDayKnown
    && profit.coveragePct >= 70
    && loss.coveragePct >= 70;
  const anyUsable = profit.score !== null || loss.score !== null;
  const status = ready ? "ready"
    : criticalKnownCount >= 2 && anyUsable ? "partial"
      : "unavailable";
  const missingCritical = Object.entries(criticalSignals)
    .filter(([, available]) => !available)
    .map(([key]) => key);
  if (!crossDayKnown) missingCritical.push("exactPreviousLimitComparison");

  return {
    version: EMOTION_EFFECT_CONTEXT_VERSION,
    method: "whole_market_emotion_effect_v1",
    calibrated: false,
    status,
    tradingDate: limit.date || current.date || null,
    previousTradingDate: limit.previousDate || previous.date || null,
    scores: {
      profit: profit.score,
      loss: loss.score,
    },
    profit: {
      ...profit,
      components: profitComponents,
    },
    loss: {
      ...loss,
      components: lossComponents,
    },
    observations: {
      limitUpCount: limit.up,
      previousLimitUpCount: limit.previousUp,
      limitDownCount: limit.down,
      previousLimitDownCount: limit.previousDown,
      breadth: current.breadth,
      largeGainCount: current.largeGainCount,
      largeLossCount: current.largeLossCount,
      sealRate,
      bombRate: sealRate === null ? null : round1((1 - sealRate) * 100) / 100,
    },
    dataQuality: {
      status,
      criticalKnownCount,
      criticalSignalCount: 3,
      crossDayKnown,
      profitCoveragePct: profit.coveragePct,
      lossCoveragePct: loss.coveragePct,
      missingCritical,
      reason: ready
        ? "全市场涨跌停、跨日变化和上涨宽度满足最小情绪效应上下文"
        : status === "partial"
          ? "部分全市场情绪字段可用，动态重归一后仅供观察"
          : "关键全市场情绪字段不足，不生成可用分数",
    },
    guardrails: {
      wholeMarketOnly: true,
      indexDirectionExcluded: true,
      turnoverDirectionExcluded: true,
      candidateLeadershipExcluded: true,
      hotDirectionsExcluded: true,
      unknownFallback: null,
      dynamicWeightNormalization: true,
      selectionAuthority: false,
      note: "只描述全市场情绪效应，不推进周期、不生成候选或交易权限。",
    },
  };
}

function effectLevel(score, side) {
  if (side === "profit") {
    if (score >= 70) return { level: "strong", label: "赚钱效应强" };
    if (score >= 48) return { level: "moderate", label: "赚钱效应存在" };
    if (score >= 30) return { level: "weak", label: "赚钱效应偏弱" };
    return { level: "very_weak", label: "赚钱效应接近冰点" };
  }
  if (score >= 70) return { level: "severe", label: "亏钱效应严重" };
  if (score >= 50) return { level: "high", label: "亏钱效应偏强" };
  if (score >= 30) return { level: "moderate", label: "亏钱效应可控" };
  return { level: "low", label: "亏钱效应较低" };
}

function profitTrend(limit, current, previous) {
  const signals = [];
  if (limit.upRatio !== null) signals.push(clamp((limit.upRatio - 1) / 0.6, -1, 1) * 0.55);
  const breadthDelta = current.breadth !== null && previous.breadth !== null
    ? current.breadth - previous.breadth
    : null;
  if (breadthDelta !== null) signals.push(clamp(breadthDelta / 0.2, -1, 1) * 0.2);
  const indexDelta = current.index !== null && previous.index !== null ? current.index - previous.index : null;
  if (indexDelta !== null) signals.push(clamp(indexDelta / 1.5, -1, 1) * 0.15);
  if (!signals.length) return "unknown";
  const total = signals.reduce((sum, value) => sum + value, 0);
  return total >= 0.16 ? "improving" : total <= -0.16 ? "weakening" : "stable";
}

function lossTrend(limit, current, previous) {
  const signals = [];
  if (limit.downRatio !== null) signals.push(clamp((limit.downRatio - 1) / 0.75, -1, 1) * 0.65);
  else if (limit.downComparisonKnown && limit.previousDown === 0) {
    signals.push(limit.down === 0 ? 0 : clamp(limit.down / 5, 0, 1) * 0.65);
  }
  const lossDelta = current.largeLossCount !== null && previous.largeLossCount !== null
    ? safeRatio(current.largeLossCount, previous.largeLossCount)
    : null;
  if (lossDelta !== null) signals.push(clamp((lossDelta - 1) / 0.75, -1, 1) * 0.2);
  if (!signals.length) return "unknown";
  const total = signals.reduce((sum, value) => sum + value, 0);
  return total >= 0.16 ? "worsening" : total <= -0.16 ? "improving" : "stable";
}

function buildDataQuality(current, previous, limit, leadership, directions) {
  const checks = [
    ["index", current.index, 12],
    ["breadth", current.breadth, 12],
    ["amount", current.amount, 10],
    ["limitUp", limit.up, 13],
    ["limitDown", limit.down, 13],
    ["previousLimitUp", limit.previousUp, 11],
    ["previousLimitDown", limit.previousDown, 11],
    ["previousAmount", previous.amount, 8],
  ];
  const available = checks.filter(([, value]) => value !== null).map(([key]) => key);
  const missing = checks.filter(([, value]) => value === null).map(([key]) => key);
  let score = checks.reduce((sum, [, value, weight]) => sum + (value !== null ? weight : 0), 0);
  if (leadership.available) score += 5;
  if (directions.available) score += 5;
  score = Math.round(clamp(score));
  const previousTradingDayAvailable = [limit.previousUp, limit.previousDown, previous.amount]
    .filter((value) => value !== null).length >= 2;
  const issues = [];
  if (limit.up === null || limit.down === null) issues.push("缺少当日涨跌停数据，不能确认赚钱/亏钱效应强弱");
  if (!previousTradingDayAvailable) issues.push("缺少可靠的上一交易日对照，只能判断当日静态状态");
  if (current.index === null || current.breadth === null) issues.push("指数或涨跌家数缺失，市场广度结论已降级");
  if (current.amount === null || previous.amount === null) issues.push("成交额环比缺失，不能验证承接是否塌缩");
  if (!leadership.available) issues.push("未提供核心龙头/情绪锚点信息，不影响基础计算但降低结构判断精度");
  if (!directions.available) issues.push("未提供方向扩散信息，不影响基础计算但降低赚钱效应定位精度");
  const grade = score >= 85 ? "high" : score >= 65 ? "medium" : score >= 40 ? "low" : "insufficient";
  const label = grade === "high" ? "数据完整"
    : grade === "medium" ? "数据基本可用"
      : grade === "low" ? "数据有限"
        : "数据不足";
  return {
    score,
    grade,
    label,
    summary: `${label}（覆盖度${score}%）${previousTradingDayAvailable ? "，可做跨日比较" : "，不确认跨日周期变化"}`,
    previousTradingDayAvailable,
    previousDate: limit.previousDate || previous.date || null,
    available,
    missing,
    issues,
  };
}

function addEvidence(rows, code, side, direction, strength, text, values = {}) {
  rows.push({
    code,
    side,
    direction,
    strength: Math.round(clamp(strength)),
    text,
    values,
  });
}

function classifyDailyState(context) {
  const {
    current,
    previous,
    limit,
    leadership,
    directions,
    profitScore,
    lossScore,
    profitEffectTrend,
    lossEffectTrend,
    dataQuality,
  } = context;
  const upDeclining = limit.upRatio !== null && limit.upRatio < 0.9;
  const upCollapsed = limit.upRatio !== null && limit.upRatio <= 0.65;
  const downContracting = limit.downRatio !== null && limit.downRatio <= 0.8;
  const downNotExpanding = limit.down !== null && limit.previousDown !== null
    ? limit.down <= limit.previousDown + 1
    : null;
  const downExpanding = limit.down !== null && limit.previousDown !== null
    && ((limit.down - limit.previousDown >= 5 && limit.downRatio >= 1.25) || limit.down >= 25);
  const volumeRatio = safeRatio(current.amount, previous.amount);
  const volumeNotCollapsed = volumeRatio === null ? null : volumeRatio >= 0.85;
  const broadWeakness = current.index !== null && current.breadth !== null
    && current.index <= -0.6 && current.breadth <= 0.38;
  const profitStillPresent = (limit.up !== null && limit.up >= 35)
    || profitScore >= 45
    || (leadership.activeCount !== null && leadership.activeCount >= 1)
    || (directions.activeCount !== null && directions.activeCount >= 1);
  const coreNegativeSpread = (leadership.breakdownCount !== null && leadership.breakdownCount >= 2)
    || (leadership.highBoardNegativeRate !== null && leadership.highBoardNegativeRate >= 0.5)
    || (directions.weakCount !== null && directions.weakCount >= 2);
  const largeLossRatio = safeRatio(current.largeLossCount, previous.largeLossCount);
  const largeLossExpanding = largeLossRatio !== null && largeLossRatio >= 1.25;
  const negativeFeedbackExpanded = downExpanding || coreNegativeSpread || largeLossExpanding;
  const profitCollapsed = upCollapsed || (profitScore <= 32 && !profitStillPresent);
  const retreatCandidate = lossScore >= 65
    && profitScore <= 38
    && negativeFeedbackExpanded
    && profitCollapsed;
  const healthyDivergence = dataQuality.previousTradingDayAvailable
    && upDeclining
    && (downContracting || downNotExpanding === true)
    && profitStillPresent
    && volumeNotCollapsed !== false
    && lossScore < 60
    && !retreatCandidate;
  const strengthening = profitScore >= 65
    && lossScore <= 40
    && profitEffectTrend === "improving"
    && lossEffectTrend !== "worsening"
    && (current.breadth === null || current.breadth >= 0.48)
    && (current.index === null || current.index >= -0.1);
  const icePoint = profitScore <= 32
    && broadWeakness
    && limit.down !== null
    && limit.down >= 12
    && (downContracting || !negativeFeedbackExpanded)
    && !retreatCandidate;

  let state;
  if (dataQuality.grade === "insufficient" || (limit.up === null && limit.down === null)) {
    state = {
      key: "data_insufficient",
      label: "数据不足·不确认周期变化",
      summary: "关键涨跌停或跨日数据缺失，只保留静态观察，不推进基础情绪周期。",
      baseCycleHint: null,
      reasons: dataQuality.issues.slice(0, 3),
    };
  } else if (strengthening) {
    state = {
      key: "repair_strengthening",
      label: "修复加强",
      summary: "赚钱效应扩张、亏钱效应收缩，且市场广度同步改善。",
      baseCycleHint: "修复/回暖",
      reasons: [
        `赚钱效应${profitScore}分并继续改善`,
        `亏钱效应${lossScore}分，未出现扩散`,
        `涨停${limit.previousUp ?? "—"}→${limit.up ?? "—"}，跌停${limit.previousDown ?? "—"}→${limit.down ?? "—"}`,
      ],
    };
  } else if (healthyDivergence) {
    state = {
      key: "healthy_divergence",
      label: "健康分化·兑现",
      summary: "昨日强势批次兑现，但跌停未扩散、赚钱效应仍在、成交承接没有塌缩，不能直接定义为退潮。",
      baseCycleHint: "维持原基础周期",
      reasons: [
        `涨停${limit.previousUp}→${limit.up}，强势批次出现兑现`,
        `跌停${limit.previousDown}→${limit.down}，负反馈${downContracting ? "明显收缩" : "没有扩大"}`,
        volumeRatio === null ? "成交环比缺失，承接按待确认处理" : `成交保持上一交易日的${Math.round(volumeRatio * 100)}%`,
        `当前仍有${limit.up ?? "—"}只涨停，赚钱效应没有消失`,
      ],
    };
  } else if (retreatCandidate) {
    state = {
      key: "retreat_candidate",
      label: "负反馈扩散·退潮候选",
      summary: "亏钱效应明显扩散且赚钱效应同步坍缩；这是退潮候选，仍应由基础周期状态机按收盘/连续性规则确认。",
      baseCycleHint: "退潮候选",
      reasons: [
        `亏钱效应${lossScore}分并呈${lossEffectTrend === "worsening" ? "恶化" : "高位"}`,
        `赚钱效应仅${profitScore}分${upCollapsed ? "，涨停数量大幅收缩" : ""}`,
        downExpanding ? `跌停${limit.previousDown}→${limit.down}，负反馈明显扩散` : "核心或方向负反馈已扩散",
      ],
    };
  } else if (icePoint) {
    state = {
      key: "ice_point",
      label: "冰点观察",
      summary: "赚钱效应处于低位、市场广度冰冷，但负反馈没有继续扩张，开始观察止跌与修复信号。",
      baseCycleHint: "冰点",
      reasons: [
        `赚钱效应仅${profitScore}分`,
        `指数${signedPercent(current.index)}、上涨占比${percent(current.breadth)}`,
        downContracting ? `跌停${limit.previousDown}→${limit.down}，极端负反馈开始收缩` : `跌停${limit.down}只，负反馈处于高位`,
      ],
    };
  } else if (profitScore >= 55 && lossScore <= 48) {
    state = {
      key: "repair",
      label: "修复进行中",
      summary: "赚钱效应占优但尚未形成全面加强，继续验证持续性和方向扩散。",
      baseCycleHint: "修复/回暖",
      reasons: [`赚钱效应${profitScore}分`, `亏钱效应${lossScore}分`, "尚未同时满足加强条件"],
    };
  } else if (profitStillPresent && lossScore < 65) {
    state = {
      key: "mixed_divergence",
      label: "分化·赚钱效应仍在",
      summary: "市场内部强弱并存，暂不依据指数或上涨家数单独下调为退潮。",
      baseCycleHint: "维持原基础周期",
      reasons: [`赚钱效应${profitScore}分`, `亏钱效应${lossScore}分`, `涨停${limit.up ?? "—"}、跌停${limit.down ?? "—"}`],
    };
  } else {
    state = {
      key: "neutral",
      label: "弱势观察·等待确认",
      summary: "当前证据不足以确认修复加强、健康分化或退潮扩散，等待下一交易日验证。",
      baseCycleHint: "维持原基础周期",
      reasons: [`赚钱效应${profitScore}分`, `亏钱效应${lossScore}分`],
    };
  }

  const confidenceBase = dataQuality.score * 0.65;
  const stateEvidence = state.key === "data_insufficient" ? 0
    : ["repair_strengthening", "healthy_divergence", "retreat_candidate", "ice_point"].includes(state.key) ? 30 : 18;
  return {
    ...state,
    tone: ["repair_strengthening", "repair"].includes(state.key)
      ? "good"
      : ["retreat_candidate"].includes(state.key)
        ? "bad"
        : ["healthy_divergence", "mixed_divergence", "ice_point", "neutral"].includes(state.key)
          ? "warn"
          : "neutral",
    confidence: Math.round(clamp(confidenceBase + stateEvidence)),
    retreatCandidate: state.key === "retreat_candidate",
  };
}

function normalizeCycle(value) {
  return normalizeBigCycle(value);
}

function normalizeIndexStructures(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      code: String(item.code || "").trim(),
      name: String(item.name || item.code || "指数").trim(),
      close: finite(item.close),
      changePct: finite(item.changePct),
      ma5: finite(item.ma5),
      ma10: finite(item.ma10),
      ma20: finite(item.ma20),
      ma30: finite(item.ma30),
      ma60: finite(item.ma60),
      slope5: finite(item.slope5),
      slope10: finite(item.slope10),
      slope20: finite(item.slope20),
      distance20dLowPct: finite(item.distance20dLowPct),
      trendKey: String(item.trendKey || "unknown").trim(),
      trendLabel: String(item.trendLabel || "结构待确认").trim(),
    }));
}

/**
 * 指数环境只回答“大盘处在什么结构”，不读取题材热度、主线名称或个股强弱。
 * 这样主线三日容错只能保留题材观察资格，不能再把大盘周期强行写成主升。
 */
function analyzeIndexEnvironment(input = {}) {
  const snapshot = input.snapshot && typeof input.snapshot === "object" ? input.snapshot : {};
  const structures = normalizeIndexStructures(input.indexStructures || snapshot.indexStructures);
  let canonicalRegime = null;
  try {
    canonicalRegime = buildIndexCycleRegime({
      indexStructures: input.indexStructures || snapshot.indexStructures,
      snapshot,
      currentMarketState: { structuralCycle: input.previousCycle },
      generationContext: input.generationContext || snapshot.generationContext,
    });
  } catch (_) {
    canonicalRegime = null;
  }
  const breadth = readBreadth(snapshot);
  const avgIndexChange = firstFinite(snapshot.avgIndexChange, snapshot.indexChangePct);
  const previousCycle = normalizeCycle(input.previousCycle);
  const trendCounts = structures.reduce((result, item) => {
    const key = ["uptrend", "repair", "sideways", "bottoming", "downtrend"].includes(item.trendKey)
      ? item.trendKey
      : "unknown";
    result[key] = (result[key] || 0) + 1;
    return result;
  }, { uptrend: 0, repair: 0, sideways: 0, bottoming: 0, downtrend: 0, unknown: 0 });
  const coverage = structures.filter((item) => item.trendKey !== "unknown").length;
  const dailyKey = avgIndexChange === null
    ? "unknown"
    : avgIndexChange <= -0.65
      ? "divergence"
      : avgIndexChange >= 0.65
        ? "rebound"
        : "flat";

  let key = "index_mixed";
  let cycle = "混沌";
  let label = "指数震荡/分歧";
  let tone = "warn";

  if (coverage >= 2) {
    if (trendCounts.uptrend >= 2 && (avgIndexChange === null || avgIndexChange > -0.45) && (breadth === null || breadth >= 0.42)) {
      key = "index_uptrend";
      cycle = "主升";
      label = "指数上升结构";
      tone = "good";
    } else if (trendCounts.repair + trendCounts.bottoming >= 2 || (trendCounts.repair >= 1 && dailyKey === "rebound")) {
      key = "index_repair";
      cycle = previousCycle || "混沌";
      label = dailyKey === "divergence" ? "修复结构中的指数分歧" : "指数修复/回暖";
      tone = dailyKey === "divergence" ? "warn" : "good";
    } else if (trendCounts.downtrend >= 2) {
      const severe = avgIndexChange !== null && avgIndexChange <= -1 && breadth !== null && breadth < 0.36;
      key = severe ? "index_retreat" : "index_downtrend";
      cycle = severe ? "退潮" : "混沌";
      label = severe ? "指数下跌扩散" : dailyKey === "rebound" ? "下降结构中的反弹" : "指数下降/筑底";
      tone = severe ? "bad" : "warn";
    } else if (trendCounts.sideways >= 2) {
      key = "index_sideways";
      cycle = "震荡";
      label = dailyKey === "divergence" ? "指数震荡偏弱" : "指数区间震荡";
    }
  } else if (avgIndexChange !== null || breadth !== null) {
    // 没有K线结构时只给保守的日内口径，绝不由题材热度直接推出主升。
    if (avgIndexChange !== null && avgIndexChange <= -1.1 && breadth !== null && breadth < 0.3) {
      key = "index_retreat_unverified";
      cycle = "退潮";
      label = "指数与广度同步走弱";
      tone = "bad";
    } else if (avgIndexChange !== null && avgIndexChange >= 0.45 && breadth !== null && breadth >= 0.5) {
      key = "index_repair_unverified";
      cycle = previousCycle || "混沌";
      label = "指数日内修复（结构待验证）";
      tone = "good";
    } else {
      cycle = previousCycle && previousCycle !== "主升" ? previousCycle : "混沌";
      label = avgIndexChange !== null && avgIndexChange < -0.35 ? "指数分歧（结构待验证）" : "指数结构待验证";
    }
  } else if (previousCycle) {
    cycle = previousCycle;
    label = "指数数据不足，沿用上一收盘";
    tone = "neutral";
  }

  const canonicalStructuralCycle = String(canonicalRegime && canonicalRegime.structuralCycle || "").trim();
  const canonicalSubPhase = canonicalRegime && canonicalRegime.indexSubPhase
    && typeof canonicalRegime.indexSubPhase === "object"
    ? canonicalRegime.indexSubPhase
    : null;
  const canonicalMediumConfirmed = canonicalRegime && canonicalRegime.mediumTerm
    && canonicalRegime.mediumTerm.confirmed === true;
  const canonicalShortConfirmed = canonicalRegime && canonicalRegime.shortTerm
    && canonicalRegime.shortTerm.confirmed === true;
  // The session breadth/return describes today's rhythm; it must not erase an
  // independently confirmed MA5 main-rise structure.  This projection keeps
  // the legacy environment consumer aligned with index-cycle-regime, which is
  // the canonical multi-timeframe classifier.
  if (normalizeCycle(canonicalStructuralCycle) && canonicalShortConfirmed) {
    cycle = normalizeCycle(canonicalStructuralCycle);
    if (cycle === "主升" && canonicalSubPhase && canonicalSubPhase.key === "main_rise_strong_divergence") {
      key = "index_main_rise_strong_divergence";
      label = "主升结构内强分歧";
      tone = "warn";
    } else if (cycle === "主升") {
      key = "index_uptrend";
      label = "指数主升结构";
      tone = canonicalSubPhase && /divergence/.test(String(canonicalSubPhase.key || "")) ? "warn" : "good";
    } else if (cycle === "震荡") {
      key = "index_sideways";
      label = canonicalSubPhase && canonicalSubPhase.label || "指数区间震荡";
      tone = "warn";
    } else if (cycle === "退潮") {
      key = "index_retreat";
      label = canonicalSubPhase && canonicalSubPhase.label || "指数结构转弱";
      tone = "bad";
    } else if (cycle === "混沌") {
      const mediumKey = String(canonicalRegime.mediumTerm && canonicalRegime.mediumTerm.key || "");
      const rangePending = canonicalRegime.rangeConfirmation
        && canonicalRegime.rangeConfirmation.pending === true;
      key = mediumKey === "decline"
        ? "index_decline_candidate"
        : rangePending ? "index_range_pending" : "index_mixed";
      label = mediumKey === "decline"
        ? "中期下降·退潮待跨日确认"
        : rangePending ? "指数震荡待确认" : canonicalSubPhase && canonicalSubPhase.label || "指数混沌结构";
      tone = mediumKey === "decline" ? "bad" : "warn";
    }
  }

  const allA = snapshot.allA && typeof snapshot.allA === "object" ? snapshot.allA : {};
  const allAChangePct = finite(allA.changePct);
  const evidence = structures.slice(0, 4).map((item) => `${item.name}：${item.trendLabel}`);
  if (avgIndexChange !== null) evidence.unshift(`主要指数均值${signedPercent(avgIndexChange)}`);
  if (allAChangePct !== null) evidence.push(`同花顺全A${signedPercent(allAChangePct)}`);
  const environmentDailyState = /repair|rebound|修复|反弹|回暖/.test(`${key} ${label}`)
    ? { key: "repair", label }
    : null;
  const canonicalTransition = canonicalRegime && canonicalRegime.transition;
  const canonicalTransitionActive = canonicalTransition
    && !/^(none|not_active)$/.test(String(canonicalTransition.key || canonicalTransition.status || ""));
  const canonicalSmallCycle = canonicalRegime && canonicalRegime.smallCycle;
  const canonicalSmallCycleAvailable = canonicalSmallCycle && canonicalSmallCycle.status !== "unavailable";

  return {
    version: ENGINE_VERSION,
    key,
    cycle,
    structuralCycle: cycle,
    transition: canonicalTransitionActive
      ? { ...canonicalTransition }
      : repairTransition({
          bigCycle: cycle,
          previousBigCycle: previousCycle,
          mediumTerm: canonicalRegime && canonicalRegime.mediumTerm,
          shortTerm: canonicalRegime && canonicalRegime.shortTerm,
          dailyState: environmentDailyState,
        }),
    smallCycle: canonicalSmallCycleAvailable
      ? { ...canonicalSmallCycle }
      : smallCycleFromSignals({
          shortTerm: canonicalRegime && canonicalRegime.shortTerm,
          intraday: canonicalRegime && canonicalRegime.intraday,
          indexSubPhase: canonicalSubPhase,
          dailyState: environmentDailyState,
        }),
    indexSubPhase: canonicalSubPhase ? {
      key: String(canonicalSubPhase.key || "").trim() || null,
      label: String(canonicalSubPhase.label || "").trim() || null,
      structureIntact: canonicalSubPhase.structureIntact === true,
      intensity: String(canonicalSubPhase.intensity || "").trim() || "unknown",
    } : null,
    label,
    tone,
    dailyKey,
    verified: Boolean(canonicalMediumConfirmed && canonicalShortConfirmed),
    structureCoverage: canonicalRegime && canonicalRegime.mediumTerm
      && finite(canonicalRegime.mediumTerm.metrics && canonicalRegime.mediumTerm.metrics.knownIndexCount)
      || coverage,
    trendCounts,
    avgIndexChange,
    breadth,
    allAChangePct,
    summary: coverage >= 2
      ? `${label}；周期由指数K线结构定性，题材强弱只用于后续选方向。`
      : `${label}；当前缺少足够指数K线，只给保守口径。`,
    evidence,
    structures,
    mediumTerm: canonicalRegime && canonicalRegime.mediumTerm || null,
    shortTerm: canonicalRegime && canonicalRegime.shortTerm || null,
    intraday: canonicalRegime && canonicalRegime.intraday || null,
    rangeConfirmation: canonicalRegime && canonicalRegime.rangeConfirmation || null,
    generationContext: canonicalRegime && canonicalRegime.generationContext || null,
  };
}

function coreEvidenceRows(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((item) => {
    const leadership = item && item.leadership && typeof item.leadership === "object" ? item.leadership : {};
    const initiative = leadership.initiative && typeof leadership.initiative === "object" ? leadership.initiative : {};
    const cycleIdentity = leadership.cycleIdentity && typeof leadership.cycleIdentity === "object"
      ? leadership.cycleIdentity : {};
    const sessionIdentity = leadership.sessionIdentity && typeof leadership.sessionIdentity === "object"
      ? leadership.sessionIdentity : {};
    const roleText = [item && item.role, leadership.identity, leadership.levelLabel, item && item.ticketType]
      .map((text) => String(text || ""))
      .join(" ");
    const verifiedCycleCore = cycleIdentity.identityEstablished === true
      && cycleIdentity.activePrimary === true
      && ["confirmed", "retained"].includes(String(cycleIdentity.state || ""));
    const dailyHeightOnly = !verifiedCycleCore && (
      sessionIdentity.dailyHeight === true
      || item && item.roleKind === "dailyHeight"
      || item && item.dailyRole === "当日高度"
      || item && item.roleScope === "session" && /高度|龙头/.test(String(item.dailyRole || item.role || ""))
    );
    const scopedRoleCore = item && (
      item.roleKind === "cycleLeader" && item.roleScope === "cycle"
      || item.roleKind === "capacityCore" && item.roleScope === "rolling"
    );
    const recognized = !dailyHeightOnly && (
      verifiedCycleCore
      || leadership.coreIdentityQualified === true
      || leadership.repairCoreQualified === true
      || scopedRoleCore
    );
    const changePct = finite(item && item.changePct);
    const initiativeScore = firstFinite(item && item.initiativeScore, initiative.score);
    const active = recognized && (
      (changePct !== null && changePct >= 5)
      || (initiativeScore !== null && initiativeScore >= 55)
      || initiative.proactive === true
      || leadership.coreQualified === true
      || leadership.repairCoreQualified === true
    );
    return {
      code: String(item && (item.code || item.secCode) || "").trim(),
      name: String(item && (item.name || item.code) || "--").trim(),
      changePct,
      amountYi: finite(item && item.amountYi),
      role: String(item && item.role || leadership.identity || "核心观察").trim(),
      direction: String(item && (item.mainConcept || item.mainFamily || item.concept) || "").trim(),
      initiativeScore,
      recognized,
      dailyHeightOnly,
      verifiedCycleCore,
      active,
    };
  }).filter((item) => item.recognized && item.code);
}

function evaluateTradingDay(input = {}) {
  const snapshot = input.snapshot && typeof input.snapshot === "object" ? input.snapshot : {};
  const marketState = input.marketState && typeof input.marketState === "object" ? input.marketState : {};
  const limitStats = input.limitStats && typeof input.limitStats === "object" ? input.limitStats : {};
  const allA = snapshot.allA && typeof snapshot.allA === "object" ? snapshot.allA : {};
  const allAChangePct = finite(allA.changePct);
  const avgIndexChange = firstFinite(snapshot.avgIndexChange, snapshot.indexChangePct);
  const breadth = readBreadth(snapshot);
  const profitScore = firstFinite(input.profitEffect && input.profitEffect.score, marketState.profitEffect && marketState.profitEffect.score);
  const lossScore = firstFinite(input.lossEffect && input.lossEffect.score, marketState.lossEffect && marketState.lossEffect.score);
  const zt = firstFinite(limitStats.ztToday, limitStats.limitUpCount);
  const dt = firstFinite(limitStats.dtToday, limitStats.limitDownCount);
  const coreRows = coreEvidenceRows(input.candidates);
  const activeCores = coreRows.filter((item) => item.active).sort((a, b) => (b.changePct || 0) - (a.changePct || 0));
  const indexDivergence = avgIndexChange !== null && avgIndexChange <= -0.35;
  const allAResilient = allAChangePct !== null ? allAChangePct >= -0.35 : breadth !== null && breadth >= 0.5;
  const profitPresent = (profitScore !== null && profitScore >= 45) || (zt !== null && zt >= 35);
  const lossControlled = (lossScore === null || lossScore < 65) && (dt === null || dt < 18);
  const preemptive = indexDivergence && allAResilient && profitPresent && lossControlled && activeCores.length > 0;
  return {
    avgIndexChange,
    allAChangePct,
    breadth,
    profitScore,
    lossScore,
    zt,
    dt,
    indexDivergence,
    allAResilient,
    profitPresent,
    lossControlled,
    preemptive,
    coreRows,
    activeCores,
  };
}

/**
 * 短线交易窗口回答“现在有没有先手/确认/加仓资格”。
 * 它可以在指数分歧时转暖，但不能反过来改写指数基础周期。
 */
function analyzeTradingWindow(input = {}) {
  const current = evaluateTradingDay(input);
  const previous = evaluateTradingDay({
    snapshot: input.previousSnapshot,
    limitStats: input.previousLimit,
    candidates: input.previousCandidates,
    marketState: input.previousMarketState,
  });
  const currentDailyKey = String(input.dailyState && input.dailyState.key || "");
  const currentCoreCodes = new Set(current.activeCores.map((item) => item.code));
  const strengthenedCores = previous.activeCores.filter((item) => currentCoreCodes.has(item.code));
  const marketImproved = (
    current.avgIndexChange !== null
    && previous.avgIndexChange !== null
    && current.avgIndexChange >= previous.avgIndexChange + 0.35
  ) || (current.allAChangePct !== null && current.allAChangePct >= 0.35)
    || ["repair", "repair_strengthening"].includes(currentDailyKey);
  const confirmation = previous.preemptive
    && marketImproved
    && current.allAResilient
    && current.lossControlled
    && strengthenedCores.length > 0;
  const risk = !current.allAResilient
    && ((current.lossScore !== null && current.lossScore >= 65) || (current.dt !== null && current.dt >= 18));

  let key = "wait";
  let label = "等待短线窗口";
  let tone = "neutral";
  let allowNew = false;
  let allowAdd = false;
  let positionGuide = "0%–10%观察仓";
  let summary = "指数环境与短线赚钱效应尚未形成可执行组合。";

  if (risk) {
    key = "negative_feedback";
    label = "全A转弱·负反馈扩散";
    tone = "bad";
    positionGuide = "0%";
    summary = "指数与全A同步走弱，先防守，不用单票强势对抗市场。";
  } else if (confirmation) {
    key = "warming_confirmed";
    label = "回暖确认·核心加强";
    tone = "good";
    allowNew = true;
    allowAdd = true;
    positionGuide = "已有先手可确认后加仓；新仓不追一致高开";
    summary = `${strengthenedCores.map((item) => item.name).slice(0, 3).join("、")}延续走强，且指数/全A较昨日改善：昨天的先手逻辑得到确认。`;
  } else if (current.preemptive) {
    key = "preemptive_core";
    label = "指数分歧·全A抗跌，核心先手窗口";
    tone = "warn";
    allowNew = true;
    positionGuide = "10%–20%先手仓；不直接加满";
    summary = `指数仍在分歧，但全A/涨跌家数抗跌，${current.activeCores.map((item) => item.name).slice(0, 3).join("、")}率先走强：可博弈次日回暖。`;
  } else if (marketImproved && current.allAResilient && current.profitPresent) {
    key = "warming_watch";
    label = "市场回暖·等待核心确认";
    tone = "warn";
    positionGuide = "只观察，核心确认后再执行";
    summary = "全A与市场广度改善，但缺少昨日先手或同一核心连续加强证据，不把普涨直接当加仓信号。";
  }

  const coreEvidence = (confirmation ? strengthenedCores : current.activeCores).slice(0, 5);
  const marketGate = [
    {
      key: "index",
      passed: current.indexDivergence || marketImproved,
      label: current.indexDivergence ? "指数仍在分歧" : marketImproved ? "指数/全A较昨日改善" : "指数变化不明确",
    },
    {
      key: "all_a",
      passed: current.allAResilient,
      label: current.allAResilient ? "同花顺全A/市场广度抗跌" : "全A与市场广度转弱",
    },
    {
      key: "profit_loss",
      passed: current.profitPresent && current.lossControlled,
      label: current.profitPresent && current.lossControlled ? "赚钱效应仍在且负反馈可控" : "赚钱效应或负反馈未过关",
    },
    {
      key: "core",
      passed: coreEvidence.length > 0,
      label: coreEvidence.length ? `核心验证：${coreEvidence.map((item) => item.name).join("、")}` : "没有核心率先走强",
    },
  ];

  return {
    version: 1,
    key,
    label,
    tone,
    allowNew,
    allowAdd,
    positionGuide,
    summary,
    marketGate,
    coreEvidence,
    current,
    previous: {
      preemptive: previous.preemptive,
      avgIndexChange: previous.avgIndexChange,
      allAChangePct: previous.allAChangePct,
      breadth: previous.breadth,
      activeCores: previous.activeCores.slice(0, 5),
    },
    execution: {
      noPosition: allowNew
        ? key === "preemptive_core" ? "只做小仓先手，等次日回暖验证" : "等回踩/承接确认，不追一致高开"
        : "不开新仓，继续观察",
      holding: allowAdd
        ? "已有先手：环境回暖且同一核心加强后才加仓；任一条件失效则不加"
        : key === "preemptive_core" ? "已有仓只保留先手，不因单票封板直接加仓" : "没有确认信号，不加仓",
      cancel: "全A转弱、负反馈重新扩散，或核心开板后不能回封/失去主动性，立即取消。",
    },
  };
}

/**
 * 基础周期推进器：dailyState 描述今天，cycle 描述更慢的结构。
 * 没有真正上一交易日收盘快照时，只更新今日状态，不强制切换已有基础周期。
 */
function resolveStructuralCycle(input = {}) {
  const previousCycle = normalizeCycle(input.previousCycle);
  const legacyCycle = normalizeCycle(input.legacyCycle) || "混沌";
  const currentCycle = previousCycle || legacyCycle;
  const dailyState = input.dailyState && typeof input.dailyState === "object" ? input.dailyState : {};
  const dailyKey = String(dailyState.key || "neutral");
  const previousDailyKey = String(input.previousDailyState && input.previousDailyState.key || "");
  const profitScore = finite(input.profitEffect && input.profitEffect.score) ?? 50;
  const lossScore = finite(input.lossEffect && input.lossEffect.score) ?? 50;
  const historyFresh = input.historyFresh === true;
  const afterClose = input.afterClose !== false;
  const clearMainline = input.clearMainline === true;
  const heatConfirmed = input.heatConfirmed === true;
  const marketScore = finite(input.marketScore) ?? 0;
  const mainlineContinuityKnown = input.mainlineContinuityKnown === true;
  const mainlineContinuous = input.mainlineContinuous === true;
  const activeCoreKnown = input.activeCoreKnown === true;
  const activeCoreConfirmed = input.activeCoreConfirmed === true;
  const previousMainlineName = String(input.previousMainlineName || "").trim();
  const currentMainlineNames = Array.isArray(input.currentMainlineNames)
    ? input.currentMainlineNames.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const mainlineToleranceDays = Math.max(1, Math.round(finite(input.mainlineToleranceDays) ?? 3));
  const previousMainlineBreakDays = Math.max(0, Math.round(finite(input.previousMainlineBreakDays) ?? 0));
  const mainlineToleranceBaseCycle = normalizeCycle(input.mainlineToleranceBaseCycle);
  const mainlineAnchorKeys = Array.isArray(input.mainlineAnchorKeys)
    ? input.mainlineAnchorKeys.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const mainRiseBaseActive = currentCycle === "主升" || mainlineToleranceBaseCycle === "主升";
  const mainlineStrongAgain = mainlineContinuous && (!activeCoreKnown || activeCoreConfirmed);
  const mainlineObservationReady = afterClose
    && mainlineContinuityKnown
    && dailyKey !== "data_insufficient";
  // 观察日只在收盘后累计；盘中或数据不可校验时沿用上一收盘计数，避免刷新页面就重复加天数。
  const mainlineBreakDays = !mainRiseBaseActive
    ? 0
    : !mainlineObservationReady
      ? previousMainlineBreakDays
      : mainlineStrongAgain
        ? 0
        : previousMainlineBreakDays + 1;
  const mainlineToleranceActive = mainlineBreakDays > 0
    && mainlineBreakDays < mainlineToleranceDays;
  const mainlineToleranceExpired = mainlineBreakDays >= mainlineToleranceDays;
  const mainlineRecovered = mainlineObservationReady
    && mainlineStrongAgain
    && previousMainlineBreakDays > 0
    && mainRiseBaseActive;
  const indexEnvironment = input.indexEnvironment && typeof input.indexEnvironment === "object"
    ? input.indexEnvironment
    : {};
  const indexCycle = normalizeCycle(indexEnvironment.cycle);
  const indexVerified = indexEnvironment.verified === true && finite(indexEnvironment.structureCoverage) >= 2;
  const mediumKey = String(indexEnvironment.mediumTerm && indexEnvironment.mediumTerm.key || "").trim();
  const shortKey = String(indexEnvironment.shortTerm && indexEnvironment.shortTerm.key || "").trim();
  const breadth = normalizeRatio(indexEnvironment.breadth);
  const avgIndexChange = finite(indexEnvironment.avgIndexChange);
  const generationContext = input.generationContext && typeof input.generationContext === "object"
    ? input.generationContext
    : indexEnvironment.generationContext && typeof indexEnvironment.generationContext === "object"
      ? indexEnvironment.generationContext
      : null;
  const previousIndexEnvironment = input.previousIndexEnvironment && typeof input.previousIndexEnvironment === "object"
    ? input.previousIndexEnvironment
    : input.previousStructuralResolution && input.previousStructuralResolution.indexEnvironment
      && typeof input.previousStructuralResolution.indexEnvironment === "object"
      ? input.previousStructuralResolution.indexEnvironment
      : input.previousMarketState && input.previousMarketState.structuralResolution
        && input.previousMarketState.structuralResolution.indexEnvironment
        && typeof input.previousMarketState.structuralResolution.indexEnvironment === "object"
        ? input.previousMarketState.structuralResolution.indexEnvironment
        : input.previousDailyState && input.previousDailyState.indexEnvironment
          && typeof input.previousDailyState.indexEnvironment === "object"
          ? input.previousDailyState.indexEnvironment
          : null;
  const rangeSignal = (environment) => {
    if (!environment || typeof environment !== "object") return { known: false, qualified: false };
    const confirmation = environment.rangeConfirmation && typeof environment.rangeConfirmation === "object"
      ? environment.rangeConfirmation
      : {};
    const environmentShort = environment.shortTerm && typeof environment.shortTerm === "object"
      ? environment.shortTerm
      : {};
    const metrics = environmentShort.metrics && typeof environmentShort.metrics === "object"
      ? environmentShort.metrics
      : {};
    const confirmationWindow = finite(confirmation.windowDays);
    const shortWindow = finite(environmentShort.windowDays);
    const metricsWindow = finite(metrics.windowDays);
    const windowDays = confirmationWindow !== null
      ? confirmationWindow
      : shortWindow !== null ? shortWindow : metricsWindow;
    // 旧档案中的MA10多数条件不能静默冒充MA5同口径证据。
    if (windowDays !== 5) {
      return { known: false, qualified: false, windowDays, reason: "window_mismatch" };
    }
    if (typeof confirmation.currentQualified === "boolean") {
      return { known: true, qualified: confirmation.currentQualified, windowDays };
    }
    const knownCount = finite(metrics.aboveMa5KnownCount);
    const aboveCount = finite(metrics.aboveMa5Count);
    const aboveRate = finite(metrics.aboveMa5Rate);
    if (knownCount === null || aboveCount === null || aboveRate === null) {
      return { known: false, qualified: false, windowDays };
    }
    const environmentMediumKey = String(environment.mediumTerm && environment.mediumTerm.key || "").trim();
    const environmentShortKey = String(environmentShort.key || "").trim();
    return {
      known: true,
      windowDays,
      qualified: knownCount >= 4
        && aboveCount >= 3
        && aboveRate >= 0.75
        && !["decline", "unknown", ""].includes(environmentMediumKey)
        && !["weakening", "unknown", ""].includes(environmentShortKey),
    };
  };
  const currentRangeSignal = rangeSignal(indexEnvironment);
  const previousRangeSignal = rangeSignal(previousIndexEnvironment);
  const rangePendingTransition = {
    key: "range_pending_confirmation",
    label: "震荡待确认",
    status: "pending",
    from: currentCycle,
    to: "震荡",
    observationOnly: true,
    evidence: [
      currentRangeSignal.qualified ? "当前至少3/4主要指数站上5日线且短周期未转弱" : "当前MA5多数条件未确认",
      previousRangeSignal.known
        ? previousRangeSignal.qualified ? "上一收盘同口径条件成立" : "上一收盘同口径条件未成立"
        : "缺少上一收盘同口径MA5证据",
    ],
  };
  const rangeObservationTransition = dailyKey === "repair_strengthening"
    ? {
        ...rangePendingTransition,
        key: "repair_strengthening",
        label: "修复加强·震荡待确认",
      }
    : rangePendingTransition;

  const result = (cycle, reason, pending = false, transitionOverride = null) => {
    const resolvedCycle = normalizeCycle(cycle) || currentCycle;
    let transition = transitionOverride || repairTransition({
      bigCycle: resolvedCycle,
      previousBigCycle: previousCycle,
      mediumTerm: indexEnvironment.mediumTerm,
      shortTerm: indexEnvironment.shortTerm,
      dailyState,
    });
    // “修复加强”在混沌中只能指向震荡确认，不能把单日普涨写成主升候选。
    if (
      !transitionOverride
      && transition.key === "repair_strengthening"
      && resolvedCycle === "混沌"
      && transition.to === "主升"
    ) {
      transition = {
        ...transition,
        label: currentRangeSignal.qualified ? "修复加强·震荡待确认" : "修复加强·等待大周期确认",
        to: currentRangeSignal.qualified ? "震荡" : null,
      };
    }
    if (generationContext) transition = { ...transition, generationContext: { ...generationContext } };
    return ({
    version: ENGINE_VERSION,
    engineVersion: ENGINE_VERSION,
    cycle: normalizeCycle(cycle) || currentCycle,
    // Structural cycle and the current in-cycle session are orthogonal axes.
    // Keeping both prevents a strong-divergence day from overwriting an intact
    // main-rise structure (or being mislabeled as acceleration downstream).
    structuralCycle: normalizeCycle(cycle) || currentCycle,
    transition,
    smallCycle: smallCycleFromSignals({
      shortTerm: indexEnvironment.shortTerm,
      intraday: indexEnvironment.intraday,
      indexSubPhase: indexEnvironment.indexSubPhase,
      dailyState,
      profitEffect: input.profitEffect,
      lossEffect: input.lossEffect,
      tradeWindow: input.tradeWindow,
    }),
    indexSubPhase: indexEnvironment.indexSubPhase && typeof indexEnvironment.indexSubPhase === "object"
      ? {
        key: String(indexEnvironment.indexSubPhase.key || "").trim() || null,
        label: String(indexEnvironment.indexSubPhase.label || "").trim() || null,
        structureIntact: indexEnvironment.indexSubPhase.structureIntact === true,
        intensity: String(indexEnvironment.indexSubPhase.intensity || "").trim() || "unknown",
      }
      : null,
    previousCycle,
    changed: Boolean(previousCycle && normalizeCycle(cycle) && normalizeCycle(cycle) !== previousCycle),
    pending,
    reason,
    generationContext: generationContext ? { ...generationContext } : null,
    rangeConfirmation: {
      windowDays: 5,
      currentQualified: currentRangeSignal.known ? currentRangeSignal.qualified : null,
      previousQualified: previousRangeSignal.known ? previousRangeSignal.qualified : null,
      confirmed: resolvedCycle === "震荡" && currentRangeSignal.qualified && previousRangeSignal.qualified,
      pending: resolvedCycle !== "震荡" && currentRangeSignal.qualified,
      requiresPreviousClose: true,
    },
    mainlineContinuity: {
      known: mainlineContinuityKnown,
      continuous: mainlineContinuityKnown ? mainlineContinuous : null,
      previous: previousMainlineName || null,
      current: currentMainlineNames,
    },
    activeCore: {
      known: activeCoreKnown,
      confirmed: activeCoreKnown ? activeCoreConfirmed : null,
    },
    mainlineTolerance: {
      limit: mainlineToleranceDays,
      breakDays: mainlineBreakDays,
      remainingDays: mainlineToleranceActive ? mainlineToleranceDays - mainlineBreakDays : 0,
      active: mainlineToleranceActive,
      expired: mainlineToleranceExpired,
      recovered: mainlineRecovered,
      baseCycle: mainRiseBaseActive ? "主升" : null,
      anchor: previousMainlineName || null,
      anchorKeys: mainlineAnchorKeys,
    },
    mainlineWatch: {
      limit: mainlineToleranceDays,
      breakDays: mainlineBreakDays,
      remainingDays: mainlineToleranceActive ? mainlineToleranceDays - mainlineBreakDays : 0,
      active: mainlineToleranceActive,
      expired: mainlineToleranceExpired,
      recovered: mainlineRecovered,
      anchor: previousMainlineName || null,
      anchorKeys: mainlineAnchorKeys,
      scope: "theme-only",
      note: "三日容错只保留原题材观察资格，不参与指数周期、仓位或买点评分。",
    },
    indexEnvironment: indexEnvironment && Object.keys(indexEnvironment).length ? indexEnvironment : null,
  });
  };

  if (!afterClose) return result(currentCycle, "盘中指数K线结构尚未完整，只沿用上一收盘周期；短线窗口另行实时判断", true);
  if (dailyKey === "data_insufficient") return result(currentCycle, "关键数据不足，不推进基础周期", true);

  // 已有基础周期但缺少精确T-1时，不确认任何升降级；若当前MA5多数条件
  // 已成立，仍可把“震荡待确认”作为过渡观察输出。
  if (!historyFresh && previousCycle) {
    if (currentCycle === "混沌" && currentRangeSignal.qualified) {
      return result(currentCycle, "当前至少3/4主要指数站上5日线，但缺少精确T-1同口径证据；只记录震荡待确认", true, rangeObservationTransition);
    }
    return result(previousCycle, "缺少真正上一交易日收盘归档，只记录今日状态，不切换基础周期", true);
  }

  if (dailyKey === "retreat_candidate") {
    const extreme = lossScore >= 82 && profitScore <= 25;
    const consecutive = previousDailyKey === "retreat_candidate";
    if (historyFresh && (extreme || consecutive)) {
      return result("退潮", extreme ? "单日极端负反馈满足退潮确认" : "连续两个收盘负反馈扩散，确认退潮");
    }
    return result(currentCycle, "负反馈扩散仅为退潮候选，等待连续收盘或极端条件确认", true);
  }

  if (dailyKey === "ice_point") {
    if (historyFresh && (currentCycle === "退潮" || previousDailyKey === "retreat_candidate")) {
      return result("冰点", "退潮后赚钱效应极低且负反馈开始收缩，确认冰点");
    }
    return result(currentCycle, "出现冰点特征，但缺少退潮衔接证据，不跳跃切换基础周期", true);
  }

  const previousNonRetreatClose = Boolean(previousDailyKey)
    && previousDailyKey !== "retreat_candidate";
  const currentNonRetreatClose = dailyKey !== "retreat_candidate";
  const repairScoreGate = profitScore >= 55
    && lossScore <= 48
    && breadth !== null
    && breadth >= 0.48
    && avgIndexChange !== null
    && avgIndexChange >= -0.1;
  const repairStructureGate = ["repair", "repair_candidate"].includes(mediumKey)
    || dailyKey === "repair_strengthening";
  const retreatRecoveryConfirmed = ["退潮", "冰点"].includes(currentCycle)
    && historyFresh
    && previousNonRetreatClose
    && currentNonRetreatClose
    && repairScoreGate
    && repairStructureGate;
  if (retreatRecoveryConfirmed) {
    const recoveryTransition = {
      key: "repair_strengthening",
      label: "修复加强·震荡待确认",
      status: "confirmed",
      from: currentCycle,
      to: "混沌",
      observationOnly: false,
      confirmationTarget: { key: "range_pending", label: "震荡待确认" },
      evidence: [
        "连续两个收盘均非退潮候选",
        `赚钱效应${profitScore}分（门槛>=55）`,
        `亏钱效应${lossScore}分（门槛<=48）`,
        `上涨广度${percent(breadth, 1)}（门槛>=48%）`,
        `主要指数均值${signedPercent(avgIndexChange)}（门槛>=-0.10%）`,
        repairStructureGate ? "中期修复或当日修复加强成立" : null,
      ].filter(Boolean),
    };
    return result("混沌", "精确T-1连续修复滞回全部通过：退潮/冰点退出为混沌；震荡仍等待MA5跨日确认", false, recoveryTransition);
  }

  // 退潮/冰点不能凭单日普涨跳到震荡或主升。未通过上述完整滞回门槛时，
  // 只保留修复观察和小周期描述。
  if (["退潮", "冰点"].includes(currentCycle)) {
    const missing = [
      previousNonRetreatClose ? null : "上一收盘仍为退潮候选或缺失",
      currentNonRetreatClose ? null : "当前仍为退潮候选",
      profitScore >= 55 ? null : `赚钱效应${profitScore}<55`,
      lossScore <= 48 ? null : `亏钱效应${lossScore}>48`,
      breadth !== null && breadth >= 0.48 ? null : "上涨广度未达到48%",
      avgIndexChange !== null && avgIndexChange >= -0.1 ? null : "主要指数均值未达到-0.10%",
      repairStructureGate ? null : "中期修复/修复加强未确认",
    ].filter(Boolean);
    return result(currentCycle, `退潮/冰点修复滞回尚未全部通过：${missing.join("；")}`, true);
  }

  if (!["退潮", "冰点", "震荡"].includes(currentCycle) && currentRangeSignal.qualified) {
    if (historyFresh && previousRangeSignal.known && previousRangeSignal.qualified) {
      return result("震荡", "连续两个收盘至少3/4主要指数站上5日线，且短周期未转弱，确认震荡", false, {
        ...rangePendingTransition,
        key: "range_confirmed",
        label: "震荡确认",
        status: "confirmed",
        observationOnly: false,
      });
    }
    return result(currentCycle, "当前至少3/4主要指数站上5日线且短周期未转弱；上一收盘同口径证据不足，只到震荡待确认", true, rangeObservationTransition);
  }

  // 主升仍要求已验证的指数环境；真实 analyzeIndexEnvironment 只有在
  // 20/60日中期主升与5日全市场主升同时成立时才会输出该状态。
  if (indexVerified && indexCycle === "主升") {
    const suffix = mainlineToleranceActive
      ? `；${previousMainlineName || "原题材"}仍在题材观察第${mainlineBreakDays}/${mainlineToleranceDays}天，但不改写指数周期`
      : "";
    return result("主升", `${indexEnvironment.summary || indexEnvironment.label || "指数中短周期主升共振已确认"}${suffix}`);
  }

  const previousMediumKey = String(previousIndexEnvironment && previousIndexEnvironment.mediumTerm
    && previousIndexEnvironment.mediumTerm.key || "").trim();
  if (["主升", "震荡"].includes(currentCycle) && mediumKey === "decline") {
    if (historyFresh && previousMediumKey === "decline") {
      return result("混沌", "连续两个收盘均为中期下降结构，结束原大周期标签；负反馈尚未满足退潮确认");
    }
    return result(currentCycle, "中期下降结构首日确认或缺少上一收盘同口径证据，等待跨日确认；短期转弱不改写大周期", true);
  }

  if (dailyKey === "repair_strengthening") {
    return result(currentCycle, "赚钱效应扩张、亏钱效应收缩，只确认小周期修复加强；大周期维持原确认状态");
  }

  if (dailyKey === "repair") {
    return result(currentCycle, "赚钱效应占优，只确认小周期修复；不得据此改写大周期");
  }

  if (["healthy_divergence", "mixed_divergence"].includes(dailyKey)) {
    return result(currentCycle, "分化属于当日小周期状态，不直接改写大周期");
  }

  if (mainRiseBaseActive) {
    const fallbackCycle = indexCycle === "震荡" ? "震荡" : "混沌";
    return result(fallbackCycle, mainlineToleranceExpired
      ? `${previousMainlineName || "原题材"}三日观察结束；指数结构未确认主升，不再沿用旧标签`
      : `${previousMainlineName || "原题材"}只保留题材观察资格；指数结构未确认，基础周期不沿用主升`, mainlineToleranceActive);
  }

  return result(currentCycle, "证据不足以切换基础周期，维持原结构");
}

function analyzeMarketCycleEffects(input = {}) {
  const safeInput = input && typeof input === "object" ? input : {};
  const emotionEffectContext = buildEmotionEffectContext(safeInput);
  const current = readSnapshot(safeInput.snapshot);
  const previous = readSnapshot(safeInput.previousSnapshot);
  const limit = readLimit(safeInput.limitStats, safeInput.previousLimit);
  const leadership = normalizeLeadership(safeInput.leadership);
  const directions = normalizeDirections(safeInput.directions || safeInput.directionInfo);
  const volumeRatio = safeRatio(current.amount, previous.amount);

  const upLevelScore = interpolate(limit.up, [[0, 0], [15, 20], [30, 45], [45, 62], [60, 78], [80, 92], [120, 100]]);
  let upTrendScore = interpolate(limit.upRatio, [[0.3, 0], [0.5, 15], [0.7, 35], [0.9, 60], [1, 70], [1.15, 88], [1.4, 100]]);
  // 低位从 16 只回到 18 只不能等同于高位继续扩张，趋势贡献受绝对数量约束。
  if (upTrendScore !== null && limit.up !== null) upTrendScore *= clamp(limit.up / 40, 0.25, 1);
  const breadthProfit = interpolate(current.breadth, [[0.2, 5], [0.3, 20], [0.4, 40], [0.5, 60], [0.6, 80], [0.7, 100]]);
  const indexProfit = interpolate(current.index, [[-2, 0], [-1, 15], [-0.3, 35], [0, 50], [0.6, 75], [1.2, 100]]);
  const volumeProfit = interpolate(volumeRatio, [[0.65, 0], [0.8, 20], [0.9, 45], [1, 60], [1.1, 80], [1.25, 100]]);
  const boardScores = [
    limit.sealRate === null ? null : interpolate(limit.sealRate, [[0.35, 5], [0.5, 35], [0.65, 65], [0.8, 100]]),
    limit.promotionRate === null ? null : interpolate(limit.promotionRate, [[0.15, 5], [0.3, 40], [0.45, 70], [0.65, 100]]),
  ].filter((value) => value !== null);
  const boardScore = average(boardScores);
  const profitComponents = {
    limitUpLevel: component(upLevelScore, 25, limit.up),
    limitUpTrend: component(upTrendScore, 20, limit.upRatio),
    breadth: component(breadthProfit, 12, current.breadth),
    index: component(indexProfit, 8, current.index),
    volume: component(volumeProfit, 10, volumeRatio),
    leadership: component(leadership.profitScore, 15, leadership, leadership.profitScore !== null),
    directions: component(directions.profitScore, 10, directions, directions.profitScore !== null),
    boardQuality: component(boardScore, 8, { sealRate: limit.sealRate, promotionRate: limit.promotionRate }, boardScore !== null),
  };
  const profitScore = weightedScore(profitComponents);

  const downLevelScore = interpolate(limit.down, [[0, 0], [3, 8], [5, 15], [8, 25], [12, 40], [18, 60], [25, 78], [40, 95], [60, 100]]);
  const downTrendScore = interpolate(limit.downRatio, [[0.25, 0], [0.5, 10], [0.8, 30], [1, 45], [1.2, 62], [1.5, 78], [2, 95], [3, 100]]);
  const breadthStress = breadthProfit === null ? null : 100 - breadthProfit;
  const indexStress = indexProfit === null ? null : 100 - indexProfit;
  const volumeStress = volumeRatio === null ? null : interpolate(volumeRatio, [[0.6, 100], [0.75, 80], [0.85, 60], [0.95, 35], [1.05, 20], [1.2, 10]]);
  const largeLossRatio = safeRatio(current.largeLossCount, previous.largeLossCount);
  const largeLossStress = largeLossRatio === null ? null : interpolate(largeLossRatio, [[0.4, 0], [0.8, 25], [1, 45], [1.25, 70], [1.75, 100]]);
  const lossComponents = {
    limitDownLevel: component(downLevelScore, 25, limit.down),
    limitDownTrend: component(downTrendScore, 25, limit.downRatio),
    breadthStress: component(breadthStress, 12, current.breadth),
    indexStress: component(indexStress, 8, current.index),
    volumeStress: component(volumeStress, 8, volumeRatio),
    leadershipNegative: component(leadership.lossScore, 15, leadership, leadership.lossScore !== null),
    directionWeakness: component(directions.lossScore, 10, directions, directions.lossScore !== null),
    largeLossTrend: component(largeLossStress, 12, largeLossRatio),
  };
  const lossScore = weightedScore(lossComponents);
  const profitEffectTrend = profitTrend(limit, current, previous);
  const lossEffectTrend = lossTrend(limit, current, previous);
  const profitMeta = effectLevel(profitScore, "profit");
  const lossMeta = effectLevel(lossScore, "loss");
  const dataQuality = buildDataQuality(current, previous, limit, leadership, directions);
  const evidence = [];

  if (limit.up !== null) {
    addEvidence(
      evidence,
      "limit_up",
      "profit",
      limit.upRatio === null ? "neutral" : limit.upRatio >= 1 ? "positive" : "negative",
      upLevelScore,
      limit.previousUp === null ? `当日涨停${limit.up}只` : `涨停${limit.previousUp}→${limit.up}`,
      { current: limit.up, previous: limit.previousUp, ratio: limit.upRatio },
    );
  }
  if (limit.down !== null) {
    addEvidence(
      evidence,
      "limit_down",
      "loss",
      limit.downRatio === null ? "neutral" : limit.downRatio > 1 ? "negative" : "positive",
      downLevelScore,
      limit.previousDown === null ? `当日跌停${limit.down}只` : `跌停${limit.previousDown}→${limit.down}`,
      { current: limit.down, previous: limit.previousDown, ratio: limit.downRatio },
    );
  }
  if (current.breadth !== null) {
    addEvidence(evidence, "breadth", "context", current.breadth >= 0.5 ? "positive" : "negative", Math.abs((current.breadth - 0.5) * 200), `上涨占比${percent(current.breadth)}`, { breadth: current.breadth });
  }
  if (current.index !== null) {
    addEvidence(evidence, "index", "context", current.index >= 0 ? "positive" : "negative", Math.abs(current.index) * 35, `主要指数均值${signedPercent(current.index)}`, { avgIndexChange: current.index });
  }
  if (volumeRatio !== null) {
    addEvidence(evidence, "volume", "context", volumeRatio >= 0.85 ? "positive" : "negative", Math.abs(volumeRatio - 1) * 180, `成交额为上一交易日的${Math.round(volumeRatio * 100)}%`, { current: current.amount, previous: previous.amount, ratio: volumeRatio });
  }
  if (leadership.available) {
    addEvidence(evidence, "leadership", "context", leadership.lossScore > leadership.profitScore ? "negative" : "positive", Math.max(leadership.profitScore || 0, leadership.lossScore || 0), `主动核心${leadership.activeCount ?? "—"}只、结构破坏${leadership.breakdownCount ?? "—"}只`, leadership);
  }
  if (directions.available) {
    addEvidence(evidence, "directions", "context", directions.lossScore > directions.profitScore ? "negative" : "positive", Math.max(directions.profitScore || 0, directions.lossScore || 0), `活跃方向${directions.activeCount ?? "—"}个、弱势方向${directions.weakCount ?? "—"}个`, directions);
  }

  const profitReasons = evidence.filter((item) => item.side === "profit" || item.direction === "positive").map((item) => item.text).slice(0, 4);
  const lossReasons = evidence.filter((item) => item.side === "loss" || item.direction === "negative").map((item) => item.text).slice(0, 4);
  const profitEffect = {
    score: profitScore,
    ...profitMeta,
    trend: profitEffectTrend,
    summary: `${profitMeta.label}（${profitScore}分），趋势${profitEffectTrend === "improving" ? "改善" : profitEffectTrend === "weakening" ? "转弱" : profitEffectTrend === "stable" ? "平稳" : "待比较"}。`,
    reasons: profitReasons,
    components: profitComponents,
    tone: profitScore >= 48 ? "good" : profitScore >= 30 ? "warn" : "bad",
  };
  const lossEffect = {
    score: lossScore,
    ...lossMeta,
    trend: lossEffectTrend,
    summary: `${lossMeta.label}（${lossScore}分），趋势${lossEffectTrend === "worsening" ? "恶化" : lossEffectTrend === "improving" ? "收缩" : lossEffectTrend === "stable" ? "平稳" : "待比较"}。`,
    reasons: lossReasons,
    components: lossComponents,
    tone: lossScore < 30 ? "good" : lossScore < 50 ? "warn" : "bad",
  };
  const dailyState = classifyDailyState({
    current,
    previous,
    limit,
    leadership,
    directions,
    profitScore,
    lossScore,
    profitEffectTrend,
    lossEffectTrend,
    dataQuality,
  });

  return {
    version: ENGINE_VERSION,
    emotionEffectContext,
    profitEffect,
    lossEffect,
    dailyState,
    evidence,
    dataQuality: {
      ...dataQuality,
      tone: dataQuality.grade === "high" ? "good" : dataQuality.grade === "medium" ? "warn" : "bad",
    },
  };
}

module.exports = {
  ENGINE_VERSION,
  EMOTION_EFFECT_CONTEXT_VERSION,
  buildEmotionEffectContext,
  analyzeMarketCycleEffects,
  analyzeIndexEnvironment,
  analyzeTradingWindow,
  resolveStructuralCycle,
};
