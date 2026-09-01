"use strict";

/**
 * 市场周期统一契约。
 *
 * 大周期只允许五个互斥状态。修复、反弹、分歧、加强等描述只能进入
 * transition / smallCycle，不能再写入 bigCycle。
 */

const MARKET_CYCLE_CONTRACT_VERSION = 4;

const BIG_CYCLE_LABELS = Object.freeze({
  chaos: "混沌",
  main_rise: "主升",
  range: "震荡",
  retreat: "退潮",
  ice_point: "冰点",
});

const BIG_CYCLE_KEYS = Object.freeze(Object.keys(BIG_CYCLE_LABELS));
const BIG_CYCLE_VALUES = Object.freeze(Object.values(BIG_CYCLE_LABELS));

const TRANSITION_PRIORITIES = Object.freeze({
  none: 0,
  repair_observed: 1,
  range_pending_confirmation: 1,
  repair_strengthening: 2,
});

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function generationIdentity(value) {
  const source = objectValue(value);
  const context = objectValue(source.generationContext);
  const generation = objectValue(source.generation);
  return {
    generationId: clean(
      context.generationId
      || context.id
      || generation.generationId
      || generation.id
      || source.generationId,
    ) || null,
    tradingDate: clean(context.tradingDate || generation.tradingDate || source.tradingDate) || null,
    asOf: clean(context.asOf || generation.asOf || source.asOf || source.generatedAt) || null,
  };
}

function completeGeneration(value) {
  const identity = generationIdentity(value);
  return Boolean(identity.generationId && identity.tradingDate && identity.asOf);
}

function sameGeneration(left, right) {
  const a = generationIdentity(left);
  const b = generationIdentity(right);
  return completeGeneration(a)
    && completeGeneration(b)
    && a.generationId === b.generationId
    && a.tradingDate === b.tradingDate
    && a.asOf === b.asOf;
}

function transitionPriority(value) {
  const source = objectValue(value);
  return TRANSITION_PRIORITIES[clean(source.key).toLowerCase()] ?? -1;
}

function unavailableTransition(reasonCode, reason, expectedGeneration, rejected = []) {
  const generation = generationIdentity(expectedGeneration);
  return {
    key: "unavailable",
    label: "过渡节点待确认",
    status: "unavailable",
    from: null,
    to: null,
    observationOnly: true,
    evidence: [],
    reasonCode,
    reason,
    generationContext: completeGeneration(generation) ? generation : null,
    composition: {
      selectedSource: null,
      rejected,
      sameGenerationRequired: true,
      downgradePrevented: false,
    },
  };
}

/**
 * 合成多个过渡候选。只有完整同代的候选才能参与排序；
 * repair_strengthening 永远高于 repair_observed，输入顺序不能造成降级。
 * 错代或缺代次的强信号会被拒绝，最多保留已通过同代校验的较弱观察。
 */
function composeRepairTransition({ candidates, expectedGeneration } = {}) {
  const expected = generationIdentity(expectedGeneration);
  const rows = Array.isArray(candidates) ? candidates : [];
  const activeRows = rows
    .map((entry, index) => {
      const wrapper = objectValue(entry);
      const transition = objectValue(wrapper.transition || entry);
      const key = clean(transition.key).toLowerCase();
      const priority = transitionPriority(transition);
      const source = clean(wrapper.source || transition.source || `candidate_${index + 1}`);
      const ownGeneration = generationIdentity(transition);
      const fallbackGeneration = generationIdentity(wrapper.generationContext || wrapper.generation);
      const generation = {
        generationId: ownGeneration.generationId || fallbackGeneration.generationId,
        tradingDate: ownGeneration.tradingDate || fallbackGeneration.tradingDate,
        asOf: ownGeneration.asOf || fallbackGeneration.asOf,
      };
      const evidenceCount = Array.isArray(transition.evidence)
        ? transition.evidence.filter((item) => clean(item)).length
        : 0;
      return { transition, key, priority, source, generation, evidenceCount, index };
    })
    .filter((row) => row.priority >= 0 && row.key !== "none");

  if (!activeRows.length) {
    const inactive = rows
      .map((entry) => objectValue(objectValue(entry).transition || entry))
      .find((transition) => clean(transition.key).toLowerCase() === "none");
    return inactive ? { ...inactive } : repairTransition({});
  }

  if (!completeGeneration(expected)) {
    return unavailableTransition(
      "transition_generation_missing",
      "缺少完整 generationId、tradingDate 或 asOf，拒绝合成过渡节点",
      expected,
      activeRows.map((row) => ({ source: row.source, reasonCode: "expected_generation_missing" })),
    );
  }

  const rejected = [];
  const eligible = [];
  activeRows.forEach((row) => {
    if (!completeGeneration(row.generation)) {
      rejected.push({ source: row.source, key: row.key, reasonCode: "candidate_generation_missing" });
      return;
    }
    if (!sameGeneration(row.generation, expected)) {
      rejected.push({ source: row.source, key: row.key, reasonCode: "candidate_generation_mismatch" });
      return;
    }
    eligible.push(row);
  });

  if (!eligible.length) {
    const mismatch = rejected.some((row) => row.reasonCode === "candidate_generation_mismatch");
    return unavailableTransition(
      mismatch ? "transition_generation_mismatch" : "transition_generation_missing",
      mismatch ? "过渡候选与当前正式代次不一致，拒绝合成" : "过渡候选缺少完整代次，拒绝合成",
      expected,
      rejected,
    );
  }

  eligible.sort((left, right) => (
    right.priority - left.priority
    || right.evidenceCount - left.evidenceCount
    || left.index - right.index
  ));
  const selected = eligible[0];
  const normalizedFrom = normalizeBigCycle(selected.transition.from);
  const normalizedTo = normalizeBigCycle(selected.transition.to);
  const invalidTarget = clean(selected.transition.to) && !normalizedTo;
  if (invalidTarget) {
    rejected.push({
      source: selected.source,
      key: selected.key,
      reasonCode: "transition_target_not_canonical",
    });
    return unavailableTransition(
      "transition_target_not_canonical",
      "过渡目标不属于正式大周期五态，拒绝写入",
      expected,
      rejected,
    );
  }

  const highestRejectedPriority = rejected.reduce((highest, row) => (
    Math.max(highest, TRANSITION_PRIORITIES[row.key] ?? -1)
  ), -1);
  const pendingRange = eligible.find((row) => row.key === "range_pending_confirmation");
  const confirmationTarget = selected.transition.confirmationTarget
    || pendingRange && {
      key: "range_pending",
      label: clean(pendingRange.transition.label) || "震荡待确认",
    }
    || null;
  return {
    ...selected.transition,
    from: normalizedFrom || null,
    to: normalizedTo || null,
    generationId: expected.generationId,
    tradingDate: expected.tradingDate,
    asOf: expected.asOf,
    generationContext: expected,
    confirmationTarget,
    composition: {
      selectedSource: selected.source,
      selectedPriority: selected.priority,
      rejected,
      sameGenerationRequired: true,
      downgradePrevented: eligible.some((row) => row.priority < selected.priority),
      strongerRejected: highestRejectedPriority > selected.priority,
    },
  };
}

function normalizeBigCycleKey(value) {
  const raw = clean(value).toLowerCase();
  if (!raw) return null;

  // 这些是过渡/小周期复合标签，必须先拒绝，不能因为包含“主升”或
  // “冰点”等文字而被截断成大周期。
  if (/修复|repair|recovery|反弹|rebound|分歧|diverg|加强|strengthen|加速|acceleration|候选|candidate|待共振|partial/.test(raw)) {
    return null;
  }

  if (BIG_CYCLE_KEYS.includes(raw)) return raw;
  if (raw === "混沌" || raw === "混沌期" || raw === "chaos" || raw === "mixed") return "chaos";
  if (raw === "主升" || raw === "主升期" || raw === "mainrise" || raw === "main_rise" || raw === "markup") return "main_rise";
  if (raw === "震荡" || raw === "震荡期" || raw === "range" || raw === "sideways") return "range";
  if (raw === "退潮" || raw === "退潮期" || raw === "retreat" || raw === "mark_down" || raw === "mark-down") return "retreat";
  if (raw === "冰点" || raw === "冰点期" || raw === "ice" || raw === "ice_point") return "ice_point";
  return null;
}

function normalizeBigCycle(value) {
  const key = normalizeBigCycleKey(value);
  return key ? BIG_CYCLE_LABELS[key] : null;
}

function isCanonicalBigCycle(value) {
  return normalizeBigCycleKey(value) !== null;
}

function bigCycleItem(value, fallback = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const raw = source.key || source.label || value;
  const key = normalizeBigCycleKey(raw);
  if (!key) {
    return {
      key: "unavailable",
      label: "大周期待确认",
      status: "unavailable",
      source: clean(source.source || fallback.source),
      reason: clean(source.reason || fallback.reason || "大周期不属于统一五态枚举"),
    };
  }
  return {
    key,
    label: BIG_CYCLE_LABELS[key],
    status: clean(source.status || fallback.status || "canonical"),
    source: clean(source.source || fallback.source),
    reason: clean(source.reason || fallback.reason),
  };
}

function structuredSmallCycleSignal(value, source) {
  const key = clean(value).toLowerCase().replace(/[ -]+/g, "_");
  if (!key || key === "unknown" || key === "unavailable" || key === "structure_pending") return null;

  const exact = {
    strong_divergence: ["strong_divergence", "强分歧"],
    main_rise_strong_divergence: ["strong_divergence", "强分歧"],
    divergence: ["divergence", "分歧"],
    main_rise_divergence: ["divergence", "分歧"],
    realization: ["divergence", "分歧"],
    negative_feedback: ["weakening", "转弱"],
    weakening: ["weakening", "转弱"],
    weakening_structure: ["weakening", "转弱"],
    decline: ["weakening", "转弱"],
    weak_close: ["weakening", "转弱"],
    gap_fade: ["weakening", "转弱"],
    acceleration: ["acceleration", "加速"],
    strengthening: ["strengthening", "加强"],
    main_rise_strengthening: ["strengthening", "加强"],
    repair_strengthening: ["repair_strengthening", "修复加强"],
    support: ["support", "承接"],
    repair: ["repair", "修复"],
    repair_structure: ["repair", "修复"],
    recovery: ["repair", "修复"],
    rebound: ["repair", "修复"],
    range: ["range", "震荡"],
    range_structure: ["range", "震荡"],
    main_rise_consolidation: ["range", "震荡"],
    mixed: ["range", "震荡"],
    sideways: ["range", "震荡"],
  }[key];
  return exact ? { key: exact[0], label: exact[1], source } : null;
}

function smallCycleFromSignals({
  shortTerm,
  intraday,
  indexSubPhase,
  dailyState,
  profitEffect,
  lossEffect,
  tradeWindow,
} = {}) {
  const short = shortTerm && typeof shortTerm === "object" ? shortTerm : {};
  const intradayState = intraday && typeof intraday === "object" ? intraday : {};
  const session = intradayState.session && typeof intradayState.session === "object"
    ? intradayState.session
    : intradayState;
  const detail = indexSubPhase && typeof indexSubPhase === "object" ? indexSubPhase : {};
  const daily = dailyState && typeof dailyState === "object" ? dailyState : {};
  const profit = profitEffect && typeof profitEffect === "object" ? profitEffect : {};
  const loss = lossEffect && typeof lossEffect === "object" ? lossEffect : {};
  const windowState = tradeWindow && typeof tradeWindow === "object" ? tradeWindow : {};
  const shortMetrics = objectValue(short.metrics);
  const declaredShortWindowRaw = short.windowDays ?? shortMetrics.windowDays;
  const declaredShortWindow = declaredShortWindowRaw === null
    || declaredShortWindowRaw === undefined
    || declaredShortWindowRaw === ""
    ? null
    : Number(declaredShortWindowRaw);
  const legacyTenDayEvidence = /10日/.test(clean(short.label))
    || ["aboveMa10KnownCount", "aboveMa10Count", "aboveMa10Rate"]
      .some((key) => Object.prototype.hasOwnProperty.call(shortMetrics, key));
  const shortStructureAligned = declaredShortWindow === 5
    || (declaredShortWindow === null && !legacyTenDayEvidence);

  const shortKey = shortStructureAligned
    ? clean(short.key).toLowerCase().replace(/[ -]+/g, "_")
    : "";
  const sessionKey = clean(session.key).toLowerCase().replace(/[ -]+/g, "_");
  const detailKey = shortStructureAligned
    ? clean(detail.key).toLowerCase().replace(/[ -]+/g, "_")
    : "";
  const dailyKey = clean(daily.key).toLowerCase().replace(/[ -]+/g, "_");
  const strongSession = ["strong_close", "recovery_strong_close"].includes(sessionKey);
  const weakSession = ["weak_close", "gap_fade"].includes(sessionKey);
  const dailyStrengthening = dailyKey === "repair_strengthening";
  const dailyWeakening = ["retreat_candidate", "negative_feedback", "weakening"].includes(dailyKey);
  const dailyDivergence = ["healthy_divergence", "mixed_divergence"].includes(dailyKey);
  const detailDivergence = [
    "strong_divergence",
    "main_rise_strong_divergence",
    "divergence",
    "main_rise_divergence",
  ].includes(detailKey);
  const detailWeakening = ["negative_feedback", "weakening", "weakening_structure", "decline"].includes(detailKey);
  const coreGate = Array.isArray(windowState.marketGate)
    ? windowState.marketGate.find((item) => item && item.key === "core")
    : null;
  const coreConfirmed = Boolean(
    coreGate && coreGate.passed === true
    || Array.isArray(windowState.coreEvidence) && windowState.coreEvidence.length > 0,
  );

  // 小周期描述当日到1—3日的赚钱/亏钱节奏。指数5日结构保留为独立约束，
  // 不得再因为先匹配到 weakening_structure 而吞掉当日修复加强证据。
  let matched = null;
  if (dailyWeakening) {
    matched = { key: "weakening", label: "转弱", source: "dailyState.key" };
  } else if (detailDivergence || weakSession) {
    matched = structuredSmallCycleSignal(detailKey, "indexSubPhase.key")
      || { key: "divergence", label: "分歧", source: "intraday.key" };
  } else if (dailyStrengthening) {
    matched = {
      key: "repair_strengthening",
      label: "修复加强",
      source: strongSession ? "dailyState.key+intraday.key" : "dailyState.key",
    };
  } else if (dailyDivergence) {
    matched = {
      key: "divergence",
      label: dailyKey === "healthy_divergence" ? "良性分歧" : "分歧",
      source: "dailyState.key",
    };
  } else if (["main_rise", "partial_main_rise"].includes(shortKey)) {
    matched = ["strong_close", "recovery_strong_close"].includes(sessionKey)
      ? { key: "strengthening", label: "加强", source: "shortTerm.key+intraday.key" }
      : ["weak_close", "gap_fade"].includes(sessionKey)
        ? { key: "divergence", label: "分歧", source: "shortTerm.key+intraday.key" }
        : { key: "range", label: "震荡", source: "shortTerm.key" };
  }
  if (!matched && dailyKey === "repair") {
    matched = { key: "repair", label: "修复", source: "dailyState.key" };
  }
  if (!matched) {
    matched = [
      structuredSmallCycleSignal(detail.key, "indexSubPhase.key"),
      structuredSmallCycleSignal(short.key, "shortTerm.key"),
      structuredSmallCycleSignal(session.key, "intraday.key"),
    ].find(Boolean);
  }
  if (!matched) {
    return {
      key: "unavailable",
      label: "小周期待确认",
      status: "unavailable",
      source: "market_cycle_contract",
      observationOnly: true,
      reason: "缺少可识别的小周期节奏证据",
    };
  }
  const positiveRhythm = ["repair", "repair_strengthening", "strengthening", "support"].includes(matched.key);
  const structureConflict = positiveRhythm && (shortKey === "weakening" || detailWeakening);
  const confirmationStatus = matched.key === "repair_strengthening"
    ? coreConfirmed ? "core_confirmed" : "core_pending"
    : "not_applicable";
  return {
    version: MARKET_CYCLE_CONTRACT_VERSION,
    key: matched.key,
    label: matched.label,
    status: short.confirmed === false && !dailyKey ? "unavailable" : "observed",
    source: `market_cycle_contract:${matched.source}`,
    observationOnly: true,
    confirmation: {
      status: confirmationStatus,
      coreConfirmed,
      label: confirmationStatus === "core_confirmed"
        ? "核心主动性已确认"
        : confirmationStatus === "core_pending"
          ? "盘面增强，核心主动性待确认"
          : null,
    },
    indexStructure: {
      windowDays: shortStructureAligned && declaredShortWindow === 5 ? 5 : null,
      key: shortKey || null,
      label: shortStructureAligned ? clean(short.label) || "指数5日结构待确认" : "指数5日结构待确认",
      subPhaseKey: detailKey || null,
      subPhaseLabel: clean(detail.label) || null,
      conflict: structureConflict,
    },
    dailyRhythm: {
      key: dailyKey || null,
      label: clean(daily.label) || null,
      sessionKey: sessionKey || null,
      sessionLabel: clean(session.label) || null,
      profitLabel: clean(profit.label) || null,
      lossLabel: clean(loss.label) || null,
    },
    reason: Array.from(new Set([
      clean(daily.label),
      clean(session.label),
      shortStructureAligned ? clean(short.label) : "",
      shortStructureAligned ? clean(detail.label) : "",
      structureConflict ? "当日盘面增强，但指数5日结构尚未完成修复" : "",
      matched.key === "repair_strengthening" && !coreConfirmed ? "核心主动性尚未确认，不升级为全面转强" : "",
    ].filter(Boolean))).join("；"),
  };
}

function repairTransition({
  bigCycle,
  previousBigCycle,
  mediumTerm,
  shortTerm,
  dailyState,
  generationContext,
  generationId,
  tradingDate,
  asOf,
} = {}) {
  const current = normalizeBigCycle(bigCycle) || normalizeBigCycle(previousBigCycle);
  const medium = mediumTerm && typeof mediumTerm === "object" ? mediumTerm : {};
  const short = shortTerm && typeof shortTerm === "object" ? shortTerm : {};
  const daily = dailyState && typeof dailyState === "object" ? dailyState : {};
  const token = [medium.key, medium.label, short.key, short.label, daily.key, daily.label, daily.baseCycleHint]
    .map(clean)
    .join(" ")
    .toLowerCase();
  const repair = /repair|recovery|rebound|修复|反弹|回暖/.test(token);
  const strengthening = /candidate|strengthen|加强|扩张|主升候选/.test(token);
  const generation = generationIdentity(generationContext || { generationId, tradingDate, asOf });
  const withGeneration = completeGeneration(generation)
    ? {
        generationId: generation.generationId,
        tradingDate: generation.tradingDate,
        asOf: generation.asOf,
        generationContext: generation,
      }
    : {};
  if (!repair) {
    return {
      key: "none",
      label: "无周期切换",
      status: "not_active",
      from: current,
      to: null,
      observationOnly: true,
      evidence: [],
      ...withGeneration,
    };
  }
  const fromRetreat = current === "退潮" || current === "冰点";
  return {
    key: strengthening ? "repair_strengthening" : "repair_observed",
    label: strengthening
      ? fromRetreat
        ? "退潮后修复加强·进入混沌，震荡待确认"
        : "修复加强·等待大周期确认"
      : "修复观察·不改写大周期",
    status: "observed",
    from: current,
    to: strengthening
      ? fromRetreat
        ? "混沌"
        : current === "主升"
          ? null
          : "主升"
      : null,
    observationOnly: true,
    evidence: [clean(medium.label), clean(short.label), clean(daily.label)].filter(Boolean),
    confirmationTarget: strengthening && fromRetreat
      ? { key: "range_pending", label: "震荡待确认" }
      : null,
    ...withGeneration,
  };
}

module.exports = {
  MARKET_CYCLE_CONTRACT_VERSION,
  BIG_CYCLE_LABELS,
  BIG_CYCLE_KEYS,
  BIG_CYCLE_VALUES,
  normalizeBigCycleKey,
  normalizeBigCycle,
  isCanonicalBigCycle,
  bigCycleItem,
  smallCycleFromSignals,
  repairTransition,
  TRANSITION_PRIORITIES,
  generationIdentity,
  sameGeneration,
  transitionPriority,
  composeRepairTransition,
};
