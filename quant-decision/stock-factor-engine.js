"use strict";

const { buildExecutionFeasibility } = require("./execution-feasibility");

const STOCK_FACTOR_VERSION = 4;
const STOCK_FACTOR_AUTHORITY = "unified_stock_factor_engine_v4";

const STOCK_FACTOR_SCHEMA = Object.freeze({
  hardGate: Object.freeze([
    "cycleAllowed",
    "themeAllowed",
    "modeAllowed",
    "dataComplete",
    "riskPassed",
    "executionFeasible",
    "upstreamGate",
  ]),
  participationValue: Object.freeze([
    "themePosition",
    "stockRole",
    "structureQuality",
    "liquidity",
    "t1Premium",
  ]),
  riskAdjustment: Object.freeze([
    "priceExhaustion",
    "negativeFeedback",
    "drawdown",
    "cancelCondition",
    "executionFeasibility",
  ]),
});

const LEADERSHIP_OVERALL_WEIGHTS = Object.freeze({
  "混沌": 0.25,
  "主升": 0.45,
  "震荡": 0.35,
  "冰点": 0.3,
  "退潮": 0,
});

const LEADERSHIP_COMPONENT_PROFILES = Object.freeze({
  low_launch_repair: Object.freeze({ initiative: 0.55, identity: 0.15, direction: 0.3 }),
  strengthening: Object.freeze({ initiative: 0.3, identity: 0.45, direction: 0.25 }),
  divergence_reflow: Object.freeze({ initiative: 0.4, identity: 0.3, direction: 0.3 }),
  stable: Object.freeze({ initiative: 0.35, identity: 0.35, direction: 0.3 }),
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function toNum(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, toNum(value)));
}

function buildRoleScore(stock, decisionKey, authority) {
  const role = clean(stock && stock.role);
  const setup = clean(stock && stock.setup);
  let score = 0;

  if (decisionKey === "主升") {
    if (authority.cycleLeader) score += 16;
    else if (authority.rollingCapacity) score += 12;
    else if (/补涨/.test(role)) score += 7;
    else if (/后排/.test(role)) score -= 4;
  } else if (decisionKey === "主升分歧") {
    if (authority.cycleLeader) score += 14;
    else if (authority.rollingCapacity) score += 12;
    else if (/补涨/.test(role)) score += 8;
    else if (/后排/.test(role)) score -= 5;
  } else if (decisionKey === "混沌") {
    if (authority.cycleLeader) score += 22;
    else if (authority.rollingCapacity) score += 5;
    else if (/补涨/.test(role)) score += 3;
    else if (/后排/.test(role)) score += /首板|二板|低位/.test(setup) ? 2 : -10;
  } else if (decisionKey === "震荡") {
    if (authority.coreAuthorized) score += 11;
    else if (/补涨/.test(role)) score += 8;
    else if (/后排/.test(role)) score += /低位|首板|二板/.test(setup) ? 4 : -6;
  } else if (decisionKey === "冰点") {
    if (authority.coreAuthorized) score += 12;
    else if (/补涨/.test(role)) score += 6;
    else if (/后排/.test(role)) score += /低位|首板|二板/.test(setup) ? 3 : -9;
  } else {
    if (authority.cycleLeader) score += 12;
    else if (authority.rollingCapacity) score += 10;
    else if (/补涨/.test(role)) score += 6;
    else if (/后排/.test(role)) score -= 4;
  }

  if (decisionKey === "主升") {
    if (/核心打板|分歧转强|打板/.test(setup)) score += 14;
    else if (/回流|承接/.test(setup)) score += 8;
    else if (/核心观察/.test(setup)) score += 5;
  } else if (decisionKey === "主升分歧") {
    if (/核心打板|分歧转强|回封/.test(setup)) score += 12;
    if (/回流|承接/.test(setup)) score += 10;
    if (/核心观察/.test(setup)) score += 7;
  } else if (decisionKey === "混沌") {
    if (/回流|弱转强|承接/.test(setup)) score += 14;
    if (/低位|首板|二板/.test(setup)) score += 10;
    if (/核心观察/.test(setup)) score += 8;
  } else if (decisionKey === "冰点") {
    if (/回流|弱转强|承接/.test(setup)) score += 13;
    if (/低位|首板|二板/.test(setup)) score += 12;
    if (/核心观察/.test(setup)) score += 8;
  } else {
    if (/回流|承接/.test(setup)) score += 10;
    if (/低位|首板|二板/.test(setup)) score += 6;
  }
  return score;
}

function buildTicketTypeScore(stock, decisionKey, authority) {
  const ticketType = clean(stock && stock.ticketType);
  let score = 0;
  if (/容量票/.test(ticketType)) {
    score += 6;
    if (decisionKey === "主升") score += 2;
    else if (decisionKey === "主升分歧") score += 4;
    else if (decisionKey === "混沌") score += 2;
    else if (decisionKey === "冰点" || decisionKey === "震荡") score += 4;
    if (authority.cycleLeader) score += 4;
    else if (authority.rollingCapacity) score += 1;
  } else if (/情绪龙头票/.test(ticketType)) {
    score += 8;
    if (decisionKey === "主升" || decisionKey === "主升分歧") score += 6;
    else if (decisionKey === "混沌") score += 2;
    if (authority.cycleLeader) score += 4;
  } else if (/补涨弹性票/.test(ticketType)) {
    score += 5;
    if (decisionKey === "混沌" || decisionKey === "冰点") score += 3;
  } else if (/趋势观察票/.test(ticketType)) {
    score += 3;
  }
  return score;
}

function buildMomentumScore(stock, decisionKey) {
  const changePct = toNum(stock && stock.changePct);
  const kline = isObject(stock && stock.klineProfile) ? stock.klineProfile : {};
  let score = 0;
  if (decisionKey === "主升") {
    if (changePct >= 9.5) score += 14;
    else if (changePct >= 5) score += 10;
    else if (changePct >= 2) score += 6;
    else if (changePct >= 0) score += 2;
    if (kline.newHigh) score += 4;
    if (kline.nearHigh20) score += 3;
    if (kline.wave && /三波|趋势/.test(clean(kline.wave))) score += 4;
    if (kline.chipComfort === "舒服") score += 2;
  } else if (decisionKey === "主升分歧") {
    if (changePct >= 7 && changePct <= 12) score += 11;
    else if (changePct >= 3 && changePct < 7) score += 8;
    else if (changePct >= 0 && changePct < 3) score += 5;
    else if (changePct < 0 && changePct >= -3) score += 2;
    if (kline.nearHigh20) score += 2;
  } else if (decisionKey === "混沌") {
    if (changePct >= 0 && changePct <= 6) score += 10;
    else if (changePct > 6 && changePct <= 10) score += 4;
    else if (changePct < 0 && changePct >= -3) score += 6;
    if (kline.wave && /一波|启动/.test(clean(kline.wave))) score += 4;
    if (toNum(kline.rise10) <= 15) score += 3;
    if (toNum(kline.pctFromHigh) <= 12) score += 2;
  } else if (decisionKey === "冰点") {
    if (changePct >= 0 && changePct <= 4) score += 10;
    else if (changePct < 0 && changePct >= -2) score += 6;
    if (kline.wave && /首板|一波|启动/.test(clean(kline.wave))) score += 4;
  } else {
    if (changePct >= 0 && changePct <= 7) score += 8;
    else if (changePct < 0 && changePct >= -3) score += 4;
  }
  return score;
}

function buildLiquidityScore(stock) {
  const turnover = toNum(stock && stock.turnoverRate);
  const volumeRatio = toNum(stock && stock.volumeRatio);
  const inflow = toNum(stock && stock.mainInflowYi);
  let score = 0;
  if (turnover >= 5 && turnover <= 20) score += 6;
  else if (turnover > 20) score += 3;
  else if (turnover > 0) score += 2;
  score += volumeRatioScorePoints(volumeRatio);
  if (inflow > 0) score += inflow >= 5 ? 4 : 2;
  if (stock && stock.inBothSources) score += 2;
  const heat = toNum(stock && stock.eastRank) || toNum(stock && stock.thsRank);
  if (heat > 0 && heat <= 10) score += 3;
  else if (heat > 0 && heat <= 30) score += 1;
  return score;
}

function volumeRatioScorePoints(value) {
  const volumeRatio = toNum(value);
  if (volumeRatio >= 1.2 && volumeRatio <= 3) return 4;
  if (volumeRatio > 3) return 2;
  if (volumeRatio >= 1) return 1;
  return 0;
}

function volumeRatioBand(value) {
  const ratio = finite(value);
  if (ratio === null || ratio <= 0) return "unknown";
  if (ratio < 1) return "shrink_below_1";
  if (ratio < 1.2) return "mild_below_1_2";
  if (ratio <= 3) return "normal_1_2_to_3";
  return "overheated_above_3";
}

function buildBacktestScore(stock) {
  const summary = isObject(stock && stock.backtest && stock.backtest.summary)
    ? stock.backtest.summary : null;
  if (!summary) return 0;
  let score = 0;
  if (toNum(summary.sampleCount) >= 8) score += 2;
  if (toNum(summary.winRate3d) >= 70) score += 3;
  else if (toNum(summary.winRate3d) >= 55) score += 1;
  if (toNum(summary.avgNextClose) > 0) score += 1;
  return score;
}

function leadershipOverallWeight(decisionKey) {
  if (decisionKey === "主升分歧") return LEADERSHIP_OVERALL_WEIGHTS["主升"];
  return LEADERSHIP_OVERALL_WEIGHTS[decisionKey] ?? LEADERSHIP_OVERALL_WEIGHTS["混沌"];
}

function leadershipComponentProfile(decisionKey, smallCycleKey) {
  const cycleText = `${clean(smallCycleKey)} ${clean(decisionKey)}`;
  if (/低位|启动|low.?launch/i.test(cycleText)) {
    return { key: "low_launch_repair", weights: LEADERSHIP_COMPONENT_PROFILES.low_launch_repair };
  }
  if (/加强|加速|strength|accelerat/i.test(cycleText)) {
    return { key: "strengthening", weights: LEADERSHIP_COMPONENT_PROFILES.strengthening };
  }
  if (/分歧|回流|diverg|reflow/i.test(cycleText)) {
    return { key: "divergence_reflow", weights: LEADERSHIP_COMPONENT_PROFILES.divergence_reflow };
  }
  if (/修复|repair/i.test(cycleText)) {
    return { key: "low_launch_repair", weights: LEADERSHIP_COMPONENT_PROFILES.low_launch_repair };
  }
  return { key: "stable", weights: LEADERSHIP_COMPONENT_PROFILES.stable };
}

function leadershipIdentityScore(leadership) {
  const levelScores = { L4: 100, L3: 75, L2: 50, L1: 25 };
  let score = levelScores[clean(leadership && leadership.level)] || 0;
  if (leadership && leadership.coreIdentityQualified === true) score = Math.max(score, 75);
  if (leadership && leadership.persistentRecognition === true) score = Math.max(score, 65);
  if (leadership && leadership.repairCoreQualified === true) score = Math.max(score, 55);
  return score;
}

function leadershipDirectionScore(leadership) {
  const direction = isObject(leadership && leadership.directionState) ? leadership.directionState : {};
  const core = direction.isCoreDirection === true || leadership && leadership.coreDirectionMatch === true;
  const resonance = direction.resonance === true;
  if (core && resonance) return 100;
  if (core) return 75;
  if (resonance) return 60;
  return 0;
}

function buildLeadershipWeighting(stock, decisionKey, smallCycleKey) {
  const leadership = isObject(stock && stock.leadership) ? stock.leadership : {};
  const initiative = isObject(leadership.initiative) ? leadership.initiative : {};
  const session = isObject(initiative.session) ? initiative.session : {};
  const qualityKey = clean(initiative.dataQualityKey);
  const intradayVerified = qualityKey.startsWith("exact_closing_")
    || !qualityKey && (/分时验证/.test(clean(initiative.dataQuality)) || session.verified === true);
  const evidenceWeight = qualityKey === "exact_closing_full_ohlc" ? 1
    : qualityKey === "exact_closing_price_series" ? 0.85
      : qualityKey === "partial_session" ? 0.55
        : intradayVerified ? Math.min(0.75, clamp(initiative.evidenceWeight, 0, 1) || 0.75)
          : 0.6;
  const scores = {
    initiative: clamp(initiative.score),
    identity: leadershipIdentityScore(leadership),
    direction: leadershipDirectionScore(leadership),
  };
  const profile = leadershipComponentProfile(decisionKey, smallCycleKey);
  const rawQualityScore = round2(
    scores.initiative * profile.weights.initiative
    + scores.identity * profile.weights.identity
    + scores.direction * profile.weights.direction,
  );
  const weightedQualityScore = rawQualityScore * evidenceWeight;
  const qualityScore = intradayVerified
    ? weightedQualityScore
    : Math.min(qualityKey === "partial_session" ? 50 : 60, weightedQualityScore);
  const overallWeight = leadershipOverallWeight(decisionKey);
  return {
    overallWeight,
    profileKey: profile.key,
    componentWeights: { ...profile.weights },
    componentScores: scores,
    rawQualityScore,
    evidenceWeight,
    evidenceQualityKey: qualityKey || (intradayVerified ? "legacy_verified_unknown_fields" : "closing_proxy"),
    evidenceQualityLabel: clean(initiative.dataQualityLabel || initiative.dataQuality) || "数据待确认",
    qualityScore: round2(qualityScore),
    comparableRoleScore: round2(qualityScore * 0.4),
    intradayVerified,
    dataQualityRule: qualityKey === "exact_closing_full_ohlc"
      ? "完整收盘分钟OHLC，领导力证据权重100%"
      : qualityKey === "exact_closing_price_series"
        ? "收盘分钟价格/成交序列，不含分钟OHLC，领导力证据权重85%（未校准）"
        : qualityKey === "partial_session"
          ? "仅覆盖部分交易时段，领导力质量分上限50且不能授予收盘交易资格"
          : intradayVerified
            ? "历史分时来源字段不完整，领导力证据权重最多75%"
            : "分时未验证，领导力质量分上限60，不单独授予交易资格",
  };
}

function buildLeadershipStructureScore(stock) {
  const grade = clean(stock && stock.leadership && stock.leadership.structure && stock.leadership.structure.grade);
  if (grade === "A") return 8;
  if (grade === "B") return 4;
  return 0;
}

function buildRiskAdjustment(stock, decisionKey, executionFeasibility) {
  const setup = clean(stock && stock.setup);
  const changePct = toNum(stock && stock.changePct);
  const kline = isObject(stock && stock.klineProfile) ? stock.klineProfile : {};
  const summary = isObject(stock && stock.backtest && stock.backtest.summary)
    ? stock.backtest.summary : null;
  const components = {
    priceExhaustion: 0,
    negativeFeedback: 0,
    drawdown: 0,
    cancelCondition: 0,
    executionFeasibility: Number(executionFeasibility && executionFeasibility.riskPenalty || 0),
  };
  if (/高位|兑现|加速/.test(setup)) {
    components.priceExhaustion = decisionKey === "冰点" ? -10
      : decisionKey === "混沌" ? -8
        : decisionKey === "主升分歧" ? -6 : -4;
  }
  if (decisionKey === "主升" && changePct < 0) components.negativeFeedback -= 4;
  else if (decisionKey === "主升分歧" && (changePct > 12 || changePct < -3)) components.negativeFeedback -= 6;
  else if (decisionKey === "混沌" && changePct < -3) components.negativeFeedback -= 7;
  else if (decisionKey === "冰点" && (changePct > 4 || changePct < -2)) components.negativeFeedback -= 8;
  else if (decisionKey === "震荡" && (changePct > 7 || changePct < -3)) components.negativeFeedback -= 5;
  if (decisionKey === "主升分歧" && kline.newHigh) components.priceExhaustion -= 2;
  if (decisionKey === "主升分歧" && kline.wave && /三波/.test(clean(kline.wave))) components.priceExhaustion -= 2;
  if ((decisionKey === "混沌" || decisionKey === "冰点") && kline.chipComfort === "套牢压力") {
    components.negativeFeedback -= 4;
  }
  if (decisionKey === "冰点" && kline.newHigh) components.priceExhaustion -= 2;
  if (stock && stock.leadership && stock.leadership.tradeState === "等回踩") components.priceExhaustion -= 10;
  if (summary && toNum(summary.worstDrawdown) <= -20) components.drawdown -= 2;
  if (stock && stock.gamePlan && stock.gamePlan.canGame === false) components.cancelCondition -= 3;
  return {
    score: round2(Object.values(components).reduce((sum, value) => sum + value, 0)),
    components,
  };
}

function buildUnifiedStockFactorDecision(input = {}) {
  const stock = isObject(input.stock) ? input.stock : {};
  const decisionKey = clean(input.decisionKey) || "混沌";
  const smallCycleKey = clean(input.smallCycleKey) || "平稳运行";
  const theme = isObject(input.themeEvidence) ? input.themeEvidence : {};
  const authority = isObject(input.roleAuthority) ? input.roleAuthority : {};
  const focusHit = toNum(theme.focusHit);
  const supportHit = toNum(theme.supportHit);
  const mainHit = toNum(theme.mainHit);
  const themeThreshold = Math.max(0, toNum(theme.threshold));
  const hardConceptFit = theme.focusRequired === false ? mainHit : focusHit;
  const upstreamGate = input.upstreamGate === true ? true : input.upstreamGate === false ? false : null;
  const leadershipWeighting = buildLeadershipWeighting(stock, decisionKey, smallCycleKey);
  const executionFeasibility = buildExecutionFeasibility(stock, {
    priceIntegrity: input.priceIntegrity,
  });
  const hardGate = {
    authority: STOCK_FACTOR_AUTHORITY,
    version: STOCK_FACTOR_VERSION,
    pass: true,
    checks: {
      cycleAllowed: input.cycleAllowed !== false,
      themeAllowed: hardConceptFit >= themeThreshold,
      modeAllowed: input.modeAllowed === true,
      dataComplete: input.dataComplete === true,
      riskPassed: input.riskPassed === true,
      executionFeasible: executionFeasibility.status !== "blocked",
      upstreamGate,
    },
    blockers: [],
  };
  if (!hardGate.checks.cycleAllowed) hardGate.blockers.push("当前周期不允许该模式");
  if (!hardGate.checks.themeAllowed) hardGate.blockers.push(`题材匹配${hardConceptFit}低于门槛${themeThreshold}`);
  if (!hardGate.checks.modeAllowed) hardGate.blockers.push("当前周期模式不允许");
  if (!hardGate.checks.dataComplete) hardGate.blockers.push("关键行情或K线数据不完整");
  if (!hardGate.checks.riskPassed) hardGate.blockers.push("风险闸门未通过");
  if (!hardGate.checks.executionFeasible) hardGate.blockers.push(...executionFeasibility.blockers);
  if (upstreamGate === false) hardGate.blockers.push("上游个股硬门槛未通过");
  hardGate.pass = hardGate.blockers.length === 0;
  const base = {
    version: STOCK_FACTOR_VERSION,
    authority: STOCK_FACTOR_AUTHORITY,
    factorSchema: STOCK_FACTOR_SCHEMA,
    decisionContext: { decisionKey, smallCycleKey },
    leadershipWeighting,
    executionFeasibility,
    hardGate,
    deduplication: {
      baseObservationScoreUsed: false,
      themeSignalsCombinedBy: "max",
      roleSignalsCombinedBy: "base_role_max_then_cycle_weighted_leadership_blend",
      positivePermissionBonus: false,
    },
  };
  if (!hardGate.pass) {
    return { ...base, participationValue: null, riskAdjustment: null, finalScore: null };
  }
  const survivorScore = Math.max(0, finite(input.survivorScore) ?? 0);
  const reflowBonus = Math.max(0, finite(input.reflowBonus) ?? 0);
  const baseRoleScore = Math.max(
    buildRoleScore(stock, decisionKey, authority),
    buildTicketTypeScore(stock, decisionKey, authority),
    survivorScore,
  );
  const stockRoleScore = round2(
    baseRoleScore * (1 - leadershipWeighting.overallWeight)
    + leadershipWeighting.comparableRoleScore * leadershipWeighting.overallWeight,
  );
  const participationComponents = {
    themePosition: Math.max(focusHit, supportHit, mainHit),
    stockRole: stockRoleScore,
    structureQuality: buildMomentumScore(stock, decisionKey) + buildLeadershipStructureScore(stock),
    liquidity: buildLiquidityScore(stock),
    t1Premium: buildBacktestScore(stock) + reflowBonus,
  };
  const participationScore = round2(Object.values(participationComponents).reduce((sum, value) => sum + value, 0));
  const riskAdjustment = buildRiskAdjustment(stock, decisionKey, executionFeasibility);
  return {
    ...base,
    participationValue: {
      score: participationScore,
      components: participationComponents,
      details: {
        stockRole: {
          baseRoleScore: round2(baseRoleScore),
          leadershipComparableScore: leadershipWeighting.comparableRoleScore,
          leadershipOverallWeight: leadershipWeighting.overallWeight,
          combinedScore: stockRoleScore,
        },
        liquidity: {
          volumeRatio: finite(stock && stock.volumeRatio),
          volumeRatioBand: volumeRatioBand(stock && stock.volumeRatio),
          volumeRatioPoints: volumeRatioScorePoints(stock && stock.volumeRatio),
          score: participationComponents.liquidity,
          rule: "量比低于1.2只降低参与价值；高于3按成交拥挤风险降分，不单项授予或否决交易权限",
        },
      },
    },
    riskAdjustment,
    finalScore: round2(participationScore + riskAdjustment.score),
  };
}

module.exports = {
  LEADERSHIP_COMPONENT_PROFILES,
  LEADERSHIP_OVERALL_WEIGHTS,
  STOCK_FACTOR_AUTHORITY,
  STOCK_FACTOR_SCHEMA,
  STOCK_FACTOR_VERSION,
  buildUnifiedStockFactorDecision,
};
