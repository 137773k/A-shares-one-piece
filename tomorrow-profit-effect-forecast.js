"use strict";

/**
 * 次日赚钱效应规则路径（纯函数）。
 *
 * 目标边界：
 * 1. 只回答“明日短线赚钱效应如何演化”，不回答主要指数涨跌；
 * 2. 不读取大周期、主要指数均线、指数日涨跌或任何具体推荐股票；
 * 3. 只使用 T 收盘时已知的赚钱/亏钱效应、市场宽度、经校验的 T/T-1
 *    涨跌停与成交额，以及 canonical 情绪的分歧强度、质量和承接；
 * 4. 任一必需证据缺失时失败关闭，不用 0 或 legacy 标签回填；
 * 5. 输出是未校准规则权重，不是概率或历史胜率。
 */

const PROFIT_EFFECT_PATH_KEYS = Object.freeze([
  "strengthen",
  "healthy_divergence",
  "negative_feedback",
]);

const PROFIT_EFFECT_PATH_LABELS = Object.freeze({
  strengthen: "赚钱效应加强",
  healthy_divergence: "健康分化",
  negative_feedback: "负反馈扩散",
});

const NEUTRAL_RULE_PRIOR = Object.freeze({
  strengthen: 28,
  healthy_divergence: 46,
  negative_feedback: 26,
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value) {
  const digits = String(value == null ? "" : value).replace(/\D/g, "");
  if (digits.length !== 8) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizedToken(...values) {
  return values
    .map((value) => String(value == null ? "" : value).trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

function firstProvided(entries) {
  for (const entry of entries) {
    if (hasOwn(entry.owner, entry.key)) {
      return { supplied: true, value: entry.owner[entry.key], source: entry.source };
    }
  }
  return { supplied: false, value: null, source: "missing" };
}

function normalizeBreadth(snapshot) {
  const direct = finiteNumber(snapshot && snapshot.breadth);
  if (direct !== null && direct >= 0 && direct <= 1) return direct;
  const percent = finiteNumber(snapshot && snapshot.breadthPct);
  if (percent !== null && percent >= 0 && percent <= 100) return percent / 100;
  return null;
}

function normalizedScore(value) {
  const score = finiteNumber(value);
  return score !== null && score >= 0 && score <= 100 ? score : null;
}

function normalizedCount(value) {
  const count = finiteNumber(value);
  return count !== null && count >= 0 ? count : null;
}

function normalizeIntensity(value) {
  const token = normalizedToken(value && value.key, value && value.label, value);
  if (/^(not_applicable|none)$|非分歧阶段|不适用/.test(token)) return "not_applicable";
  if (/\blarge\b|大分歧|强分歧/.test(token)) return "large";
  if (/\bmedium\b|中等分歧|中分歧/.test(token)) return "medium";
  if (/\bsmall\b|小分歧/.test(token)) return "small";
  return "unknown";
}

function normalizeDivergenceQuality(value) {
  const token = normalizedToken(value && value.key, value && value.label, value);
  if (/^(not_applicable|none)$|非分歧阶段|不适用/.test(token)) return "not_applicable";
  if (/non[_ -]?benign|harmful|非良性|有害/.test(token)) return "non_benign";
  if (/\bbenign\b|healthy|良性/.test(token)) return "benign";
  if (/\bneutral\b|mixed|中性|待确认/.test(token)) return "neutral";
  return "unknown";
}

function normalizeSupport(value) {
  const token = normalizedToken(value && value.key, value && value.label, value);
  if (/\bstrong\b|承接强|强承接/.test(token)) return "strong";
  if (/\bweak\b|承接弱|弱承接/.test(token)) return "weak";
  if (/\bmixed\b|general|normal|承接一般|承接尚可|承接中性/.test(token)) return "mixed";
  return "unknown";
}

function inspectCanonicalEmotion(input) {
  if (!input.supplied) {
    return {
      supplied: false,
      usable: false,
      stageKnown: false,
      source: input.source,
      reason: "canonical emotionCycle未提供",
      intensity: "unknown",
      quality: "unknown",
      support: "unknown",
    };
  }
  const model = input.value;
  if (!isObject(model) || model.available === false || /unavailable/.test(String(model.method || "").toLowerCase())) {
    return {
      supplied: true,
      usable: false,
      stageKnown: false,
      source: input.source,
      reason: "canonical emotionCycle不可用",
      intensity: "unknown",
      quality: "unknown",
      support: "unknown",
    };
  }
  const current = isObject(model.current)
    ? model.current
    : (isObject(model.currentPhase) ? model.currentPhase : {});
  const dimensions = isObject(model.dimensions) ? model.dimensions : {};
  const stageToken = normalizedToken(current.phaseKey, current.key, current.label);
  const stageKnown = Boolean(stageToken) && !/unknown|unavailable|待确认/.test(stageToken);
  const intensityValue = isObject(current.divergenceIntensity)
    ? current.divergenceIntensity
    : dimensions.divergenceIntensity;
  const qualityValue = isObject(current.divergenceQuality)
    ? current.divergenceQuality
    : dimensions.divergenceQuality;
  const supportValue = isObject(current.supportState)
    ? current.supportState
    : dimensions.support;
  const intensity = normalizeIntensity(intensityValue);
  const quality = normalizeDivergenceQuality(qualityValue);
  const support = normalizeSupport(supportValue);
  const usable = stageKnown
    && intensity !== "unknown"
    && quality !== "unknown"
    && support !== "unknown";
  return {
    supplied: true,
    usable,
    stageKnown,
    source: input.source,
    reason: usable
      ? "canonical情绪分歧强度、质量与承接均可用"
      : "canonical情绪阶段或分歧强度、质量、承接存在缺失",
    current,
    intensity,
    quality,
    support,
  };
}

function extractContext(payload, options = {}) {
  const source = isObject(payload) ? payload : {};
  const market = isObject(source.market) ? source.market : {};
  const snapshot = isObject(options.snapshot)
    ? options.snapshot
    : (isObject(market.snapshot) ? market.snapshot : (isObject(source.snapshot) ? source.snapshot : {}));
  const limitStats = isObject(options.limitStats)
    ? options.limitStats
    : (isObject(market.limitStats) ? market.limitStats : (isObject(source.limitStats) ? source.limitStats : {}));
  const marketState = isObject(options.marketState)
    ? options.marketState
    : (isObject(market.state) ? market.state : (isObject(source.marketState) ? source.marketState : {}));
  const previousPayload = isObject(options.previousPayload)
    ? options.previousPayload
    : (isObject(source.previousPayload) ? source.previousPayload : null);
  const previousMarket = isObject(previousPayload && previousPayload.market) ? previousPayload.market : {};
  const previousSnapshot = isObject(options.previousSnapshot)
    ? options.previousSnapshot
    : (isObject(previousMarket.snapshot) ? previousMarket.snapshot : {});
  const previousLimitStats = isObject(options.previousLimitStats)
    ? options.previousLimitStats
    : (isObject(previousMarket.limitStats) ? previousMarket.limitStats : {});
  const premarketModels = isObject(source.premarketModels) ? source.premarketModels : {};
  const topLevelCoreEmotion = isObject(source.coreEmotion) ? source.coreEmotion : {};
  const tomorrowDecision = isObject(source.tomorrowDecision) ? source.tomorrowDecision : {};
  const decisionCoreEmotion = isObject(tomorrowDecision.coreEmotion) ? tomorrowDecision.coreEmotion : {};
  const emotionInput = firstProvided([
    { owner: options, key: "emotionCycle", source: "options.emotionCycle" },
    { owner: source, key: "emotionCycle", source: "payload.emotionCycle" },
    { owner: premarketModels, key: "emotionCycle", source: "payload.premarketModels.emotionCycle" },
    { owner: topLevelCoreEmotion, key: "emotionCycle", source: "payload.coreEmotion.emotionCycle" },
    { owner: decisionCoreEmotion, key: "emotionCycle", source: "payload.tomorrowDecision.coreEmotion.emotionCycle" },
  ]);
  return {
    source,
    snapshot,
    limitStats,
    marketState,
    previousPayload,
    previousSnapshot,
    previousLimitStats,
    previousTradingDay: options.previousTradingDay || source.previousTradingDay,
    canonicalEmotion: inspectCanonicalEmotion(emotionInput),
  };
}

function assessPreviousTradingDay(context) {
  const meta = isObject(context.previousTradingDay) ? context.previousTradingDay : {};
  const dates = isObject(context.limitStats && context.limitStats.dates) ? context.limitStats.dates : {};
  const previousDates = isObject(context.previousLimitStats && context.previousLimitStats.dates)
    ? context.previousLimitStats.dates
    : {};
  const archiveMeta = isObject(context.previousPayload && context.previousPayload.archiveMeta)
    ? context.previousPayload.archiveMeta
    : {};
  const expectedDate = normalizeDate(
    meta.expectedDate || meta.expectedPreviousTradingDate || (dates.verified === true ? dates.prev : ""),
  );
  const actualDate = normalizeDate(
    meta.actualDate || meta.previousArchiveDate || archiveMeta.tradingDate || previousDates.today,
  );
  const snapshotKind = String(meta.snapshotKind || archiveMeta.snapshotKind || "").trim().toLowerCase();
  const verified = meta.verified === true || meta.exactPreviousTradingDay === true || dates.verified === true;
  const exactArchive = Boolean(
    verified
    && expectedDate
    && actualDate
    && expectedDate === actualDate
    && snapshotKind === "closing"
    && isObject(context.previousSnapshot),
  );
  const providerPreviousDateVerified = Boolean(
    dates.verified === true
    && expectedDate
    && normalizeDate(dates.prev) === expectedDate,
  );
  let reason = "缺少经校验的精确T-1收盘归档";
  if (exactArchive) reason = `已匹配精确T-1收盘归档 ${actualDate}`;
  else if (expectedDate && actualDate && expectedDate !== actualDate) {
    reason = `期望T-1为${expectedDate}，实际归档为${actualDate}`;
  } else if (actualDate && snapshotKind !== "closing") {
    reason = `T-1快照类型为${snapshotKind || "unknown"}，不是收盘归档`;
  }
  return {
    exactArchive,
    providerPreviousDateVerified,
    expectedDate: expectedDate || null,
    actualDate: actualDate || null,
    snapshotKind: snapshotKind || null,
    reason,
  };
}

function addEffect(scores, effect) {
  PROFIT_EFFECT_PATH_KEYS.forEach((key) => {
    scores[key] += finiteNumber(effect && effect[key]) || 0;
  });
}

function normalizeWeights(scores) {
  const safeScores = Object.fromEntries(PROFIT_EFFECT_PATH_KEYS.map((key) => [key, Math.max(1, scores[key])]));
  const total = PROFIT_EFFECT_PATH_KEYS.reduce((sum, key) => sum + safeScores[key], 0);
  const raw = Object.fromEntries(PROFIT_EFFECT_PATH_KEYS.map((key) => [key, safeScores[key] * 100 / total]));
  const weights = Object.fromEntries(PROFIT_EFFECT_PATH_KEYS.map((key) => [key, Math.floor(raw[key])]));
  let remaining = 100 - PROFIT_EFFECT_PATH_KEYS.reduce((sum, key) => sum + weights[key], 0);
  const remainderOrder = [...PROFIT_EFFECT_PATH_KEYS].sort((left, right) => {
    const difference = (raw[right] - weights[right]) - (raw[left] - weights[left]);
    return difference || PROFIT_EFFECT_PATH_KEYS.indexOf(left) - PROFIT_EFFECT_PATH_KEYS.indexOf(right);
  });
  for (let index = 0; index < remaining; index += 1) {
    weights[remainderOrder[index % remainderOrder.length]] += 1;
  }
  return weights;
}

function profitLossEffect(profitScore, lossScore) {
  const margin = profitScore - lossScore;
  if (margin >= 30) return { strengthen: 12, healthy_divergence: 2, negative_feedback: -8 };
  if (margin >= 10) return { strengthen: 5, healthy_divergence: 6, negative_feedback: -4 };
  if (margin > -10) return { strengthen: 0, healthy_divergence: 8, negative_feedback: 1 };
  if (margin > -25) return { strengthen: -4, healthy_divergence: 4, negative_feedback: 8 };
  return { strengthen: -8, healthy_divergence: 0, negative_feedback: 14 };
}

function breadthEffect(breadth) {
  if (breadth >= 0.7) return { strengthen: 8, healthy_divergence: 4, negative_feedback: -5 };
  if (breadth >= 0.55) return { strengthen: 3, healthy_divergence: 7, negative_feedback: -3 };
  if (breadth >= 0.4) return { strengthen: 0, healthy_divergence: 9, negative_feedback: 1 };
  if (breadth >= 0.25) return { strengthen: -4, healthy_divergence: 5, negative_feedback: 9 };
  return { strengthen: -7, healthy_divergence: 2, negative_feedback: 15 };
}

function limitEffect(ztToday, dtToday, ztPrev, dtPrev) {
  const ztRatio = ztPrev > 0 ? ztToday / ztPrev : null;
  const dtChange = dtToday - dtPrev;
  if (ztRatio !== null && ztRatio >= 1.1 && dtToday <= dtPrev) {
    return { strengthen: 9, healthy_divergence: 3, negative_feedback: -7 };
  }
  if ((ztRatio !== null && ztRatio < 0.75) || dtChange >= Math.max(3, dtPrev * 0.5)) {
    return { strengthen: -6, healthy_divergence: 2, negative_feedback: 12 };
  }
  return { strengthen: 0, healthy_divergence: 7, negative_feedback: 1 };
}

function turnoverEffect(ratio) {
  if (ratio >= 1.08) return { strengthen: 8, healthy_divergence: 2, negative_feedback: -5 };
  if (ratio >= 0.92) return { strengthen: 1, healthy_divergence: 7, negative_feedback: -1 };
  if (ratio >= 0.75) return { strengthen: -7, healthy_divergence: 10, negative_feedback: 2 };
  return { strengthen: -6, healthy_divergence: 4, negative_feedback: 9 };
}

const INTENSITY_EFFECTS = Object.freeze({
  small: Object.freeze({ strengthen: 4, healthy_divergence: 4, negative_feedback: -3 }),
  medium: Object.freeze({ strengthen: -2, healthy_divergence: 9, negative_feedback: 3 }),
  large: Object.freeze({ strengthen: -6, healthy_divergence: 3, negative_feedback: 12 }),
  not_applicable: Object.freeze({ strengthen: 1, healthy_divergence: 4, negative_feedback: 0 }),
});

const QUALITY_EFFECTS = Object.freeze({
  benign: Object.freeze({ strengthen: 5, healthy_divergence: 5, negative_feedback: -5 }),
  neutral: Object.freeze({ strengthen: -2, healthy_divergence: 9, negative_feedback: 4 }),
  non_benign: Object.freeze({ strengthen: -6, healthy_divergence: 1, negative_feedback: 14 }),
  not_applicable: Object.freeze({ strengthen: 1, healthy_divergence: 4, negative_feedback: 0 }),
});

const SUPPORT_EFFECTS = Object.freeze({
  strong: Object.freeze({ strengthen: 8, healthy_divergence: 3, negative_feedback: -6 }),
  mixed: Object.freeze({ strengthen: -3, healthy_divergence: 10, negative_feedback: 2 }),
  weak: Object.freeze({ strengthen: -7, healthy_divergence: 1, negative_feedback: 15 }),
});

function buildTomorrowProfitEffectForecast(payload, options = {}) {
  const context = extractContext(payload, options);
  const previousAssessment = assessPreviousTradingDay(context);
  const scores = { ...NEUTRAL_RULE_PRIOR };
  const evidence = [];
  const addEvidence = (id, label, available, effect, detail, source) => {
    const row = {
      id,
      label,
      required: true,
      available: Boolean(available),
      effect: available && effect ? { ...effect } : null,
      detail: String(detail || ""),
      source: String(source || "unknown"),
    };
    evidence.push(row);
    if (row.available) addEffect(scores, row.effect);
  };

  const profitScore = normalizedScore(context.marketState && context.marketState.profitEffect && context.marketState.profitEffect.score);
  const lossScore = normalizedScore(context.marketState && context.marketState.lossEffect && context.marketState.lossEffect.score);
  if (profitScore !== null && lossScore !== null) {
    addEvidence(
      "profit_loss_effect",
      "T日赚钱与亏钱效应",
      true,
      profitLossEffect(profitScore, lossScore),
      `赚钱效应${profitScore.toFixed(1)}，亏钱效应${lossScore.toFixed(1)}，差值${(profitScore - lossScore).toFixed(1)}`,
      "market.state.profitEffect/lossEffect",
    );
  } else {
    addEvidence(
      "profit_loss_effect",
      "T日赚钱与亏钱效应",
      false,
      null,
      "赚钱效应分或亏钱效应分缺失/越界，禁止按0回填",
      "market.state.profitEffect/lossEffect",
    );
  }

  const breadth = normalizeBreadth(context.snapshot);
  if (breadth !== null) {
    addEvidence(
      "market_breadth",
      "T日市场宽度",
      true,
      breadthEffect(breadth),
      `上涨覆盖率${Math.round(breadth * 100)}%`,
      "market.snapshot.breadth",
    );
  } else {
    addEvidence("market_breadth", "T日市场宽度", false, null, "上涨覆盖率缺失/越界，禁止按0回填", "market.snapshot.breadth");
  }

  const limitStats = context.limitStats;
  const ztToday = normalizedCount(limitStats.ztToday ?? limitStats.limitUpCount);
  const dtToday = normalizedCount(limitStats.dtToday ?? limitStats.limitDownCount);
  const providerPrevZt = normalizedCount(limitStats.ztPrev ?? limitStats.previousLimitUpCount);
  const providerPrevDt = normalizedCount(limitStats.dtPrev ?? limitStats.previousLimitDownCount);
  const archivePrevZt = normalizedCount(context.previousLimitStats.ztToday ?? context.previousLimitStats.limitUpCount);
  const archivePrevDt = normalizedCount(context.previousLimitStats.dtToday ?? context.previousLimitStats.limitDownCount);
  const ztPrev = previousAssessment.providerPreviousDateVerified ? providerPrevZt : archivePrevZt;
  const dtPrev = previousAssessment.providerPreviousDateVerified ? providerPrevDt : archivePrevDt;
  const exactLimitComparison = Boolean(
    (previousAssessment.providerPreviousDateVerified || previousAssessment.exactArchive)
    && ztToday !== null
    && dtToday !== null
    && ztPrev !== null
    && dtPrev !== null,
  );
  if (exactLimitComparison) {
    addEvidence(
      "limit_comparison",
      "T/T-1涨跌停变化",
      true,
      limitEffect(ztToday, dtToday, ztPrev, dtPrev),
      `涨停${ztPrev}→${ztToday}，跌停${dtPrev}→${dtToday}`,
      previousAssessment.providerPreviousDateVerified ? "provider_verified_t1" : "closing_archive_t1",
    );
  } else {
    addEvidence(
      "limit_comparison",
      "T/T-1涨跌停变化",
      false,
      null,
      "缺少经交易日校验的完整T/T-1涨跌停数据",
      "verified_t1_required",
    );
  }

  const currentAmount = finiteNumber(context.snapshot.shszAmountYi ?? context.snapshot.totalAmountYi);
  const previousAmount = finiteNumber(context.previousSnapshot.shszAmountYi ?? context.previousSnapshot.totalAmountYi);
  const exactTurnoverComparison = previousAssessment.exactArchive
    && currentAmount !== null
    && currentAmount > 0
    && previousAmount !== null
    && previousAmount > 0;
  if (exactTurnoverComparison) {
    const ratio = currentAmount / previousAmount;
    addEvidence(
      "turnover_comparison",
      "T/T-1成交承接",
      true,
      turnoverEffect(ratio),
      `精确T-1成交额比${Math.round(ratio * 100)}%`,
      "closing_archive_t1",
    );
  } else {
    addEvidence(
      "turnover_comparison",
      "T/T-1成交承接",
      false,
      null,
      `${previousAssessment.reason}；成交额环比不得参与评分`,
      "closing_archive_t1_required",
    );
  }

  const emotion = context.canonicalEmotion;
  const intensityAvailable = emotion.stageKnown && INTENSITY_EFFECTS[emotion.intensity];
  addEvidence(
    "emotion_divergence_intensity",
    "canonical分歧强度",
    Boolean(intensityAvailable),
    intensityAvailable ? INTENSITY_EFFECTS[emotion.intensity] : null,
    intensityAvailable ? `分歧强度：${emotion.intensity}` : "canonical分歧强度缺失或不可识别",
    emotion.source,
  );
  const qualityAvailable = emotion.stageKnown && QUALITY_EFFECTS[emotion.quality];
  addEvidence(
    "emotion_divergence_quality",
    "canonical分歧质量",
    Boolean(qualityAvailable),
    qualityAvailable ? QUALITY_EFFECTS[emotion.quality] : null,
    qualityAvailable ? `分歧质量：${emotion.quality}` : "canonical分歧质量缺失或不可识别",
    emotion.source,
  );
  const supportAvailable = emotion.stageKnown && SUPPORT_EFFECTS[emotion.support];
  addEvidence(
    "emotion_support_quality",
    "canonical分歧承接",
    Boolean(supportAvailable),
    supportAvailable ? SUPPORT_EFFECTS[emotion.support] : null,
    supportAvailable ? `承接状态：${emotion.support}` : "canonical分歧承接缺失或不可识别",
    emotion.source,
  );

  const missingFields = evidence.filter((row) => !row.available).map((row) => row.id);
  const knownEvidenceCount = evidence.length - missingFields.length;
  const coveragePct = Math.round(knownEvidenceCount / evidence.length * 100);
  const available = missingFields.length === 0;
  const weights = available
    ? normalizeWeights(scores)
    : Object.fromEntries(PROFIT_EFFECT_PATH_KEYS.map((key) => [key, null]));
  const rankedKeys = available
    ? [...PROFIT_EFFECT_PATH_KEYS].sort((left, right) => {
      const difference = weights[right] - weights[left];
      return difference || PROFIT_EFFECT_PATH_KEYS.indexOf(left) - PROFIT_EFFECT_PATH_KEYS.indexOf(right);
    })
    : [];
  const primaryKey = rankedKeys[0] || "unavailable";
  const scenarios = PROFIT_EFFECT_PATH_KEYS.map((key) => ({
    key,
    label: PROFIT_EFFECT_PATH_LABELS[key],
    weight: weights[key],
    rank: available ? rankedKeys.indexOf(key) + 1 : null,
    calibrated: false,
  }));

  return {
    version: 1,
    target: "tomorrow_profit_effect",
    targetLabel: "次日赚钱效应路径",
    method: "deterministic_rule_weight",
    methodLabel: "规则权重（未历史校准）",
    calibrated: false,
    available,
    status: available ? "available" : "unavailable",
    tradingDate: normalizeDate(
      context.limitStats && context.limitStats.dates && context.limitStats.dates.today,
    ) || null,
    prior: { ...NEUTRAL_RULE_PRIOR },
    weights,
    primary: available
      ? {
        key: primaryKey,
        label: PROFIT_EFFECT_PATH_LABELS[primaryKey],
        weight: weights[primaryKey],
        calibrated: false,
      }
      : {
        key: "unavailable",
        label: "证据不足·不输出赚钱效应路径",
        weight: null,
        calibrated: false,
      },
    scenarios,
    evidence,
    dataQuality: {
      grade: available ? "complete" : "insufficient",
      failClosed: !available,
      exactPreviousTradingDay: previousAssessment.exactArchive,
      providerPreviousDateVerified: previousAssessment.providerPreviousDateVerified,
      expectedPreviousTradingDate: previousAssessment.expectedDate,
      previousArchiveDate: previousAssessment.actualDate,
      previousSnapshotKind: previousAssessment.snapshotKind,
      knownEvidenceCount,
      totalEvidenceCount: evidence.length,
      coveragePct,
      missingFields,
      canonicalEmotion: {
        supplied: emotion.supplied,
        usable: emotion.usable,
        source: emotion.source,
        reason: emotion.reason,
      },
      notes: [
        "权重只用于三条赚钱效应路径的规则排序，不是概率、胜率或收益承诺。",
        "大周期、主要指数均线、指数日涨跌和具体候选股票均不参与本模型。",
        previousAssessment.reason,
        available
          ? "全部必需T收盘证据可用。"
          : `缺少${missingFields.join("、")}，已失败关闭。`,
      ],
    },
  };
}

module.exports = {
  PROFIT_EFFECT_PATH_KEYS,
  PROFIT_EFFECT_PATH_LABELS,
  NEUTRAL_RULE_PRIOR,
  buildTomorrowProfitEffectForecast,
  normalizeDate,
  normalizeWeights,
};
