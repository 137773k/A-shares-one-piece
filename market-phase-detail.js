"use strict";

const {
  BIG_CYCLE_VALUES,
  normalizeBigCycle,
  repairTransition,
  composeRepairTransition,
  generationIdentity,
  smallCycleFromSignals,
} = require("./quant-decision/market-cycle-contract");

/**
 * 市场三轴阶段组合器。
 *
 * 这个模块只组合上游已经完成的结构判断，不以单日涨停数、市场宽度等
 * 辅助指标反向猜测周期。辅助指标只进入 evidence，避免数据缺失时把 null
 * 当成 0，也避免同一事实被多个模块用不同阈值重复分类。
 */

const MARKET_PHASE_DETAIL_VERSION = 5;

const ALLOWED_DIVERGENCE_SETUPS = Object.freeze([
  "周期核心分歧回流观察",
  "主线题材趋势核心分歧回流观察",
]);

const FORBIDDEN_SETUPS = Object.freeze([
  "追一致加速",
  "把当日高度或补涨当核心",
  "无承接抄底",
]);

const REQUIRED_SUPPORT_CHECKS = Object.freeze([
  "核心身份已由跨日地位确认",
  "分歧后出现真实承接",
  "核心重新带动同题材或同层级股票",
  "取消条件和最大风险已经明确",
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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

function text(value) {
  return String(value == null ? "" : value).trim();
}

function firstText(...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return "";
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item)).filter(Boolean))];
}

function normalizeRatio(value) {
  const number = finite(value);
  if (number === null) return null;
  if (number > 1 && number <= 100) return number / 100;
  return number;
}

function normalizedToken(...values) {
  return values.map((value) => text(value).toLowerCase()).filter(Boolean).join(" ");
}

function completeGenerationIdentity(value) {
  const generation = generationIdentity(value);
  return generation.generationId && generation.tradingDate && generation.asOf ? generation : null;
}

function firstCompleteGeneration(...values) {
  for (const value of values) {
    const generation = completeGenerationIdentity(value);
    if (generation) return generation;
  }
  return null;
}

function unavailableEmotionReason(emotionCycle, current) {
  const previous = isObject(emotionCycle.previous) ? emotionCycle.previous : {};
  const quality = isObject(emotionCycle.dataQuality) ? emotionCycle.dataQuality : {};
  const integrity = isObject(emotionCycle.integrity) ? emotionCycle.integrity : {};
  const explicitReason = firstText(current.reason, emotionCycle.reason, quality.reason, integrity.reason);
  const diagnosticRows = [
    explicitReason,
    previous.source,
    previous.reason,
    quality.status,
    quality.qualityTier,
    ...(Array.isArray(quality.reasonCodes) ? quality.reasonCodes : []),
    ...(Array.isArray(quality.notes) ? quality.notes : []),
    ...(Array.isArray(integrity.reasonCodes) ? integrity.reasonCodes : []),
  ];
  const token = normalizedToken(...diagnosticRows);

  if (/quarant|ineligible|quality[_ -]?(?:isolat|reject)|质量[^；，,]*隔离|隔离[^；，,]*质量/.test(token)) {
    return {
      code: "quality_quarantined",
      label: "T-1历史因质量门隔离，无法确认情绪阶段",
    };
  }
  if (/generation[^；，,]*(?:mismatch|failed)|generated[_ -]?at[_ -]?mismatch|same[_ -]?generation[^；，,]*(?:failed|mismatch)|同代[^；，,]*(?:失败|不一致|未通过)/.test(token)) {
    return {
      code: "same_generation_failed",
      label: "当前严格情绪证据同代校验失败，无法确认情绪阶段",
    };
  }
  if (/exact[_ -]?t-?1|not[_ -]?exact[_ -]?t-?1|t-?1[_ -]?state[_ -]?missing|缺少[^；，,]*t-?1|上一交易日[^；，,]*(?:缺|不可用)/i.test(token)) {
    return {
      code: "missing_exact_t1",
      label: "缺少可用的精确T-1收盘状态，无法确认情绪阶段",
    };
  }
  return {
    code: "current_evidence_insufficient",
    label: explicitReason || "当前严格情绪证据不足，无法确认情绪阶段",
  };
}

function structuralCycleFrom(emotionCycle) {
  const bigCycle = isObject(emotionCycle.bigCycle) ? emotionCycle.bigCycle : {};
  const direct = firstText(bigCycle.key, bigCycle.label);
  // 大周期只认情绪状态机的同代输出。指数均线、旧 marketState 和缓存兼容字段
  // 都只能作为风险证据，权威源缺失时必须失败关闭，不能替补出主升/退潮。
  const status = firstText(bigCycle.status, "unavailable").toLowerCase();
  return status === "unavailable" ? "未知" : normalizeBigCycle(direct) || "未知";
}

function structuralCycleDetailFrom(emotionCycle) {
  const bigCycle = isObject(emotionCycle.bigCycle) ? emotionCycle.bigCycle : {};
  const label = normalizeBigCycle(firstText(bigCycle.key, bigCycle.label));
  const status = firstText(bigCycle.status, label ? "canonical" : "unavailable");
  return {
    key: label ? firstText(bigCycle.key) : "unavailable",
    label: label || "大周期待确认",
    status,
    horizon: firstText(bigCycle.horizon),
    windowDays: Number.isFinite(Number(bigCycle.windowDays)) ? Number(bigCycle.windowDays) : null,
    window: isObject(bigCycle.window) ? { ...bigCycle.window } : null,
    source: firstText(bigCycle.source),
    reasonCode: firstText(bigCycle.reasonCode),
    reason: firstText(bigCycle.reason),
    evidence: stringList(bigCycle.evidence),
    generationContext: isObject(bigCycle.generationContext) ? { ...bigCycle.generationContext } : null,
    calibrated: bigCycle.calibrated === true,
  };
}

function mediumStructureFrom(regime) {
  const medium = isObject(regime.mediumTerm) ? regime.mediumTerm : {};
  const key = firstText(medium.key, medium.cycleKey, "unknown");
  const known = !/^(unknown|unavailable)$/i.test(key);
  return {
    key: known ? key : "unavailable",
    label: known ? firstText(medium.label, "中期结构待确认") : "中期结构待确认",
    confirmed: typeof medium.confirmed === "boolean" ? medium.confirmed : null,
    evidence: stringList(medium.evidence),
  };
}

function indexSubPhaseFrom(regime, structuralCycle) {
  const phase = isObject(regime.indexSubPhase) ? regime.indexSubPhase : {};
  const medium = isObject(regime.mediumTerm) ? regime.mediumTerm : {};
  const short = isObject(regime.shortTerm) ? regime.shortTerm : {};
  const quality = isObject(regime.dataQuality) ? regime.dataQuality : {};
  const key = firstText(phase.key);
  const label = firstText(phase.label);
  const token = normalizedToken(key, label);
  const pending = !token || /structure[_ -]?pending|^(?:unknown|unavailable)|待确认/.test(token);
  const structureEvidenceReady = structuralCycle !== "未知" && (
    short.confirmed === true
    || medium.confirmed === true
    || quality.grade === "complete"
  );

  if (/main[_ -]?rise[_ -]?strong[_ -]?divergence|主升内强分歧/.test(token)) {
    return {
      key: "main_rise_strong_divergence",
      label: "主升内强分歧",
      structureIntact: phase.structureIntact === true,
      intensity: "strong",
      evidence: stringList(phase.evidence),
    };
  }

  if (!pending && (key || label)) {
    return {
      key: key || "unknown",
      label: label || "指数细分阶段待确认",
      structureIntact: typeof phase.structureIntact === "boolean" ? phase.structureIntact : null,
      intensity: firstText(phase.intensity, "unknown"),
      evidence: stringList(phase.evidence),
    };
  }

  const nonMainRiseStructure = structureEvidenceReady ? ({
    震荡: { key: "range_structure", label: "震荡结构·暂无主升细分", intensity: "range" },
    混沌: { key: "chaos_structure", label: "混沌结构·等待方向形成", intensity: "mixed" },
    退潮: { key: "retreat_structure", label: "退潮结构·暂无主升细分", intensity: "weakening" },
    冰点: { key: "ice_point_structure", label: "冰点结构·等待止跌确认", intensity: "weakening" },
  }[structuralCycle] || null) : null;
  if (nonMainRiseStructure) {
    return {
      ...nonMainRiseStructure,
      structureIntact: false,
      verified: phase.verified === true || structureEvidenceReady,
      evidence: stringList(phase.evidence),
    };
  }

  return {
    key: "unavailable",
    label: "指数细分阶段待确认",
    structureIntact: null,
    intensity: "unknown",
    evidence: [],
  };
}

function emotionStageFrom(emotionCycle) {
  const current = isObject(emotionCycle.current)
    ? emotionCycle.current
    : isObject(emotionCycle.currentPhase)
      ? emotionCycle.currentPhase
      : isObject(emotionCycle.marketState)
        ? emotionCycle.marketState
        : {};
  const key = firstText(current.phaseKey, current.key, current.legacyKey);
  const label = firstText(current.label);
  const token = normalizedToken(key, label);
  const lifecycle = isObject(current.lifecycle) ? { ...current.lifecycle } : null;
  const phase = isObject(current.phase) ? { ...current.phase } : null;
  const divergenceIntensity = isObject(current.divergenceIntensity)
    ? { ...current.divergenceIntensity }
    : null;
  const divergenceQuality = isObject(current.divergenceQuality)
    ? { ...current.divergenceQuality }
    : null;
  const supportState = isObject(current.supportState) ? { ...current.supportState } : null;

  if (/strong[_ -]?divergence|强分歧/.test(token)) {
    return {
      key: "strong_divergence",
      label: firstText(divergenceIntensity && divergenceIntensity.label, "中等分歧"),
      confidence: finite(current.confidence),
      reason: text(current.reason),
      lifecycle,
      phase,
      divergenceIntensity,
      divergenceQuality,
      supportState,
    };
  }

  if (!key && !label || /^(unknown|unavailable)|待确认/.test(token)) {
    const unavailableReason = unavailableEmotionReason(emotionCycle, current);
    return {
      key: "unavailable",
      label: "情绪阶段待确认",
      confidence: null,
      reason: unavailableReason.label,
      reasonCode: unavailableReason.code,
    };
  }

  return {
    key: key || "unknown",
    label: label || "情绪阶段待确认",
    confidence: finite(current.confidence),
    reason: text(current.reason),
    lifecycle,
    phase,
    divergenceIntensity,
    divergenceQuality,
    supportState,
  };
}

function isUnavailablePhase(phase) {
  return !isObject(phase) || /^(unknown|unavailable)$/.test(text(phase.key).toLowerCase());
}

function unavailableTomorrowBaseline(reason) {
  return {
    key: "evidence_insufficient_defensive_observe",
    label: "证据不足·防守观察",
    status: "risk_default",
    rank: null,
    probability: null,
    calibrated: false,
    riskDefault: true,
    stageInferred: false,
    action: "暂不新开仓",
    checkpoints: ["09:25", "09:35"],
    reason: text(reason) || "阶段证据不足，执行层按风险默认处理",
  };
}

function buildTomorrowBaseline({
  available,
  structuralCycle,
  indexSubPhase,
  emotionStage,
  emotionCycle,
}) {
  if (!available) return unavailableTomorrowBaseline(emotionStage && emotionStage.reason);

  if (structuralCycle === "退潮" || emotionStage.key === "retreat") {
    return {
      key: "risk_control",
      label: "退潮期风险控制",
      status: "baseline_unconfirmed",
      rank: 1,
      probability: null,
      calibrated: false,
    };
  }

  if (
    structuralCycle === "主升"
    && indexSubPhase.key === "main_rise_strong_divergence"
    && emotionStage.key === "strong_divergence"
  ) {
    return {
      key: "divergence_continuation",
      label: "分歧延续优先",
      status: "baseline_unconfirmed",
      rank: 1,
      probability: null,
      calibrated: false,
    };
  }

  const upstream = isObject(emotionCycle.tomorrowBaseline) ? emotionCycle.tomorrowBaseline : {};
  return {
    key: firstText(upstream.key, "observe_and_confirm"),
    label: firstText(upstream.label, "次日路径盘前确认"),
    status: "baseline_unconfirmed",
    rank: finite(upstream.rank) || 1,
    probability: null,
    calibrated: false,
  };
}

function buildSelectionPolicy({ available, structuralCycle, emotionStage }) {
  if (!available) {
    return {
      mode: "unavailable",
      label: "证据不足，暂不新开仓",
      allowedSetups: [],
      forbiddenSetups: [...FORBIDDEN_SETUPS],
      requiredChecks: ["09:25复核核心主动性与承接", "09:35复核负反馈是否扩散"],
      checkpoints: ["09:25", "09:35"],
      allowImmediateEntry: false,
      canActivate: false,
      allowAdd: false,
      riskDefault: true,
      stageInferred: false,
    };
  }

  if (structuralCycle === "退潮" || emotionStage.key === "retreat") {
    return {
      mode: "blocked_new_entry",
      label: "退潮期停止新开仓",
      allowedSetups: [],
      forbiddenSetups: [...FORBIDDEN_SETUPS],
      requiredChecks: ["等待结构和情绪共同脱离退潮"],
    };
  }

  return {
    mode: "conditional_after_support",
    label: "只在真实承接出现后参与",
    allowedSetups: [...ALLOWED_DIVERGENCE_SETUPS],
    forbiddenSetups: [...FORBIDDEN_SETUPS],
    requiredChecks: [...REQUIRED_SUPPORT_CHECKS],
  };
}

function evidenceFrom(limitStats, snapshot) {
  const nestedLimitStats = isObject(snapshot.limitStats) ? snapshot.limitStats : {};
  return {
    limitUpCount: firstFinite(
      limitStats.limitUpCount,
      limitStats.upLimitCount,
      limitStats.ztToday,
      nestedLimitStats.limitUpCount,
      nestedLimitStats.ztToday,
      snapshot.limitUpCount,
    ),
    previousLimitUpCount: firstFinite(
      limitStats.previousLimitUpCount,
      limitStats.prevLimitUpCount,
      limitStats.ztPrev,
      nestedLimitStats.previousLimitUpCount,
      nestedLimitStats.ztPrev,
      snapshot.previousLimitUpCount,
    ),
    limitDownCount: firstFinite(
      limitStats.limitDownCount,
      limitStats.downLimitCount,
      limitStats.dtToday,
      nestedLimitStats.limitDownCount,
      nestedLimitStats.dtToday,
      snapshot.limitDownCount,
    ),
    previousLimitDownCount: firstFinite(
      limitStats.previousLimitDownCount,
      limitStats.prevLimitDownCount,
      limitStats.dtPrev,
      nestedLimitStats.previousLimitDownCount,
      nestedLimitStats.dtPrev,
      snapshot.previousLimitDownCount,
    ),
    breadth: normalizeRatio(firstFinite(snapshot.breadth, snapshot.upRate, snapshot.advanceRate)),
    avgIndexChange: firstFinite(snapshot.avgIndexChange, snapshot.averageIndexChange),
  };
}

function buildMarketPhaseDetail(input = {}) {
  const source = isObject(input) ? input : {};
  const indexCycleRegime = isObject(source.indexCycleRegime) ? source.indexCycleRegime : {};
  const emotionCycle = isObject(source.emotionCycle) ? source.emotionCycle : {};
  const limitStats = isObject(source.limitStats) ? source.limitStats : {};
  const snapshot = isObject(source.snapshot) ? source.snapshot : {};
  const marketState = isObject(source.marketState) ? source.marketState : {};
  const previousMarketState = isObject(source.previousMarketState) ? source.previousMarketState : {};
  const structuralResolution = isObject(marketState.structuralResolution)
    ? marketState.structuralResolution
    : {};
  const dailyState = isObject(marketState.dailyState) ? marketState.dailyState : {};
  const expectedGeneration = firstCompleteGeneration(
    source.generationContext,
    source,
    emotionCycle.generationContext,
    emotionCycle,
    snapshot.generationContext,
    snapshot,
  );
  const indexGeneration = firstCompleteGeneration(
    indexCycleRegime.generationContext,
    indexCycleRegime,
  );
  const structuralGeneration = firstCompleteGeneration(
    structuralResolution.generationContext,
    structuralResolution,
    marketState.generationContext,
    marketState,
  );
  const dailyGeneration = firstCompleteGeneration(
    dailyState.generationContext,
    dailyState,
    marketState.generationContext,
    marketState,
  );

  const mediumStructure = mediumStructureFrom(indexCycleRegime);
  const structuralCycleDetail = structuralCycleDetailFrom(emotionCycle);
  const structuralCycle = structuralCycleFrom(emotionCycle);
  const rawIndexStructuralCycle = isObject(indexCycleRegime.structuralCycle)
    ? firstText(indexCycleRegime.structuralCycle.key, indexCycleRegime.structuralCycle.label)
    : indexCycleRegime.structuralCycle;
  const indexStructuralCycle = normalizeBigCycle(rawIndexStructuralCycle) || "未知";
  const indexSubPhase = indexSubPhaseFrom(indexCycleRegime, indexStructuralCycle);
  const indexDerivedTransition = repairTransition({
    bigCycle: structuralCycle,
    previousBigCycle: previousMarketState.structuralCycle || previousMarketState.cycle,
    mediumTerm: indexCycleRegime.mediumTerm,
    shortTerm: indexCycleRegime.shortTerm,
    generationContext: indexGeneration,
  });
  const dailyDerivedTransition = repairTransition({
    bigCycle: structuralCycle,
    previousBigCycle: previousMarketState.structuralCycle || previousMarketState.cycle,
    dailyState,
    generationContext: dailyGeneration,
  });
  const transition = composeRepairTransition({
    expectedGeneration,
    candidates: [
      {
        transition: indexCycleRegime.transition,
        generationContext: indexGeneration,
        source: "indexCycleRegime.transition",
      },
      {
        transition: structuralResolution.transition,
        generationContext: structuralGeneration,
        source: "marketState.structuralResolution.transition",
      },
      {
        transition: indexDerivedTransition,
        generationContext: indexGeneration,
        source: "marketPhaseDetail.indexSignals",
      },
      {
        transition: dailyDerivedTransition,
        generationContext: dailyGeneration,
        source: "marketPhaseDetail.dailyState",
      },
    ],
  });
  const shortTermSource = isObject(indexCycleRegime.shortTerm) ? indexCycleRegime.shortTerm : {};
  const shortTermMetrics = isObject(shortTermSource.metrics) ? shortTermSource.metrics : {};
  const shortWindowDays = Number(shortTermSource.windowDays || shortTermMetrics.windowDays);
  const shortStructureAligned = shortWindowDays === 5;
  const smallCycle = isObject(indexCycleRegime.smallCycle) && shortStructureAligned
    ? { ...indexCycleRegime.smallCycle }
    : smallCycleFromSignals({
        shortTerm: indexCycleRegime.shortTerm,
        intraday: indexCycleRegime.intraday,
        indexSubPhase,
        dailyState: marketState.dailyState,
        profitEffect: marketState.profitEffect,
        lossEffect: marketState.lossEffect,
        tradeWindow: marketState.tradeWindow,
      });
  const indexShortStructure = {
    windowDays: shortStructureAligned ? 5 : null,
    key: shortStructureAligned ? String(shortTermSource.key || "unknown") : "unknown",
    label: shortStructureAligned ? String(shortTermSource.label || "指数5日结构待确认") : "指数5日结构待确认",
    status: shortStructureAligned && shortTermSource.confirmed !== false ? "observed" : "unavailable",
    source: shortStructureAligned ? "indexCycleRegime.shortTerm" : "indexCycleRegime.shortTerm:window_mismatch",
    conflictWithSmallCycle: shortStructureAligned
      && Boolean(smallCycle.indexStructure && smallCycle.indexStructure.conflict),
  };
  const intradaySession = isObject(indexCycleRegime.intraday && indexCycleRegime.intraday.session)
    ? indexCycleRegime.intraday.session
    : isObject(indexCycleRegime.intraday) ? indexCycleRegime.intraday : {};
  const dailyRhythm = {
    key: String(dailyState.key || "unknown"),
    label: String(dailyState.label || intradaySession.label || "当日节奏待确认"),
    status: dailyState.key ? "observed" : "unavailable",
    source: dailyState.key ? "marketState.dailyState" : "indexCycleRegime.intraday.session",
    sessionKey: String(intradaySession.key || "unknown"),
    sessionLabel: String(intradaySession.label || ""),
  };
  const emotionStage = emotionStageFrom(emotionCycle);
  const emotionAuthorityAvailable = structuralCycle !== "未知" && !isUnavailablePhase(emotionStage);
  const indexRiskAvailable = !isUnavailablePhase(indexSubPhase);
  // 指数轴缺失只会降低风险覆盖，不得反向抹掉已经成立的情绪大周期。
  const available = emotionAuthorityAvailable;
  const tomorrowBaseline = buildTomorrowBaseline({
    available,
    structuralCycle,
    indexSubPhase,
    emotionStage,
    emotionCycle,
  });
  const selectionPolicy = buildSelectionPolicy({ available, structuralCycle, emotionStage });

  return {
    version: MARKET_PHASE_DETAIL_VERSION,
    method: "deterministic_three_axis_composition",
    status: available ? "available" : "unavailable",
    mediumStructure,
    structuralCycle,
    structuralCycleDetail,
    indexStructuralCycle,
    structuralCycleAuthority: {
      source: firstText(emotionCycle.bigCycle && emotionCycle.bigCycle.source, "emotion_cycle_state_machine"),
      emotionDriven: true,
      indexCanOverride: false,
      fiveDayWindowRequired: true,
      fiveDayWindowComplete: structuralCycleDetail.windowDays === 5
        && structuralCycleDetail.window
        && structuralCycleDetail.window.status === "available",
      generationAligned: structuralCycleDetail.status !== "unavailable",
      reasonEvidencePreserved: Boolean(structuralCycleDetail.reason && structuralCycleDetail.evidence.length),
    },
    transition,
    smallCycle,
    indexShortStructure,
    dailyRhythm,
    indexSubPhase,
    emotionStage,
    tomorrowBaseline,
    selectionPolicy,
    evidence: evidenceFrom(limitStats, snapshot),
    integrity: {
      bigCycleCanonical: BIG_CYCLE_VALUES.includes(structuralCycle),
      repairCannotBeBigCycle: structuralCycle !== "修复",
      bigAndSmallSeparated: true,
      transitionTargetCanonical: !transition.to || BIG_CYCLE_VALUES.includes(transition.to),
      transitionGenerationAligned: transition.status === "not_active"
        || transition.composition && transition.composition.sameGenerationRequired === true
          && Boolean(transition.generationId),
      emotionAuthorityAvailable,
      fiveDayEmotionWindowReady: structuralCycleDetail.windowDays === 5
        && structuralCycleDetail.status !== "unavailable",
      indexRiskAvailable,
      indexMissingCannotOverrideBigCycle: true,
    },
  };
}

module.exports = {
  MARKET_PHASE_DETAIL_VERSION,
  buildMarketPhaseDetail,
  analyzeMarketPhaseDetail: buildMarketPhaseDetail,
};
