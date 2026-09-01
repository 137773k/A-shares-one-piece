"use strict";

const {
  normalizeBigCycle,
  normalizeBigCycleKey,
  repairTransition,
} = require("./quant-decision/market-cycle-contract");

/**
 * “明日决策”阅读层。
 *
 * 这里只组合已经存在的市场周期、短周期、炒作偏好和题材角色证据，
 * 用于把盘面语言展示得更直观。所有结论默认 observationOnly，不能
 * 覆盖严格核心情绪阶段、交易权限、候选池或概率判断。
 */

const TOMORROW_DECISION_CONTEXT_VERSION = 3;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value) {
  return String(value == null ? "" : value).trim();
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

function phaseIsAvailable(phase) {
  if (!isObject(phase)) return false;
  const token = `${text(phase.key)} ${text(phase.label)}`.toLowerCase();
  return Boolean(token.trim()) && !/unknown|unavailable|待确认/.test(token);
}

function limitEvidence(limitStats = {}) {
  const source = isObject(limitStats) ? limitStats : {};
  return {
    limitUpCount: finite(source.limitUpCount ?? source.upLimitCount ?? source.ztToday),
    previousLimitUpCount: finite(source.previousLimitUpCount ?? source.prevLimitUpCount ?? source.ztPrev),
    limitDownCount: finite(source.limitDownCount ?? source.downLimitCount ?? source.dtToday),
    previousLimitDownCount: finite(source.previousLimitDownCount ?? source.prevLimitDownCount ?? source.dtPrev),
  };
}

function bigCycleFrom({ marketPhaseDetail, marketState, previousMarketState }) {
  const phaseDetail = isObject(marketPhaseDetail) ? marketPhaseDetail : {};
  const detail = isObject(phaseDetail.structuralCycleDetail)
    ? phaseDetail.structuralCycleDetail : {};
  const label = normalizeBigCycle(detail.key || detail.label);
  const key = normalizeBigCycleKey(detail.key || detail.label);
  const status = text(detail.status || "unavailable");
  const windowDays = finite(detail.windowDays);
  const window = isObject(detail.window) ? { ...detail.window } : null;
  const windowReady = status !== "unavailable"
    && normalizeBigCycle(phaseDetail.structuralCycle) === label
    && detail.horizon === "rolling_5_trading_days"
    && windowDays === 5
    && window && window.status === "available";
  if (label && key && windowReady) {
    return {
      key,
      label,
      status,
      horizon: detail.horizon,
      windowDays,
      window,
      source: text(detail.source || "market_phase_detail.structuralCycleDetail"),
      reasonCode: text(detail.reasonCode),
      reason: text(detail.reason || "五日情绪大周期已完成确认。"),
      evidence: unique(detail.evidence),
      generationContext: isObject(detail.generationContext) ? { ...detail.generationContext } : null,
      calibrated: detail.calibrated === true,
      observationOnly: false,
    };
  }
  return {
    key: "unavailable",
    label: "大周期待确认",
    status: "unavailable",
    source: "five_day_emotion_big_cycle_window",
    observationOnly: false,
    reasonCode: detail.reasonCode || "five_day_window_unavailable",
    reason: detail.reason || "当前没有可验证的五日情绪大周期，失败关闭。",
    evidence: unique(detail.evidence),
    horizon: "rolling_5_trading_days",
    windowDays: 5,
    window,
    calibrated: false,
  };
}

function transitionFrom({ marketPhaseDetail, marketState, previousMarketState, limitStats, bigCycle }) {
  const phaseDetail = isObject(marketPhaseDetail) ? marketPhaseDetail : {};
  const currentState = isObject(marketState) ? marketState : {};
  const previousState = isObject(previousMarketState) ? previousMarketState : {};
  if (isObject(phaseDetail.transition)
    && text(phaseDetail.transition.key)
    && !/^(none|not_active)$/.test(text(phaseDetail.transition.key))) {
    return { ...phaseDetail.transition, observationOnly: true };
  }
  const limits = limitEvidence(limitStats);
  const previousLoss = isObject(previousState.lossEffect) ? previousState.lossEffect : {};
  const previousSevereStress = /severe|extreme|严重|冰点/.test(`${text(previousLoss.level)} ${text(previousLoss.label)}`)
    || finite(previousLoss.score) !== null && finite(previousLoss.score) >= 70
    || limits.previousLimitDownCount !== null && limits.previousLimitDownCount >= 80;
  const currentDaily = isObject(currentState.dailyState) ? currentState.dailyState : {};
  const currentRepair = /repair|rebound|修复|反弹|回暖/.test(`${text(currentDaily.key)} ${text(currentDaily.label)} ${text(currentDaily.baseCycleHint)}`);
  const crossDayImprovement = limits.limitUpCount !== null
    && limits.previousLimitUpCount !== null
    && limits.limitDownCount !== null
    && limits.previousLimitDownCount !== null
    && limits.limitUpCount > limits.previousLimitUpCount
    && limits.limitDownCount < limits.previousLimitDownCount;
  if (previousSevereStress && currentRepair && crossDayImprovement) {
    return {
      key: "ice_rebound",
      label: "冰点反弹观察",
      status: "observed",
      from: normalizeBigCycle(previousState.structuralCycle || previousState.cycle) || "冰点",
      to: "混沌",
      observationOnly: true,
      evidence: [`涨停${limits.previousLimitUpCount}→${limits.limitUpCount}`, `跌停${limits.previousLimitDownCount}→${limits.limitDownCount}`],
      reason: "冰点后的修复只记录为过渡，不直接改写大周期。",
    };
  }
  return repairTransition({
    bigCycle: bigCycle && bigCycle.label,
    previousBigCycle: previousState.structuralCycle || previousState.cycle,
    dailyState: currentDaily,
  });
}

function smallCycleFrom(indexCycleRegime) {
  const regime = isObject(indexCycleRegime) ? indexCycleRegime : {};
  if (isObject(regime.smallCycle) && phaseIsAvailable(regime.smallCycle)) {
    return { ...regime.smallCycle, observationOnly: true };
  }
  const shortTerm = isObject(regime.shortTerm) ? regime.shortTerm : {};
  const intraday = isObject(regime.intraday) ? regime.intraday : {};
  const fiveDay = isObject(intraday.fiveDay) ? intraday.fiveDay : {};
  const session = isObject(intraday.session) ? intraday.session : {};
  const subPhase = isObject(regime.indexSubPhase) ? regime.indexSubPhase : {};
  const shortKey = text(shortTerm.key).toLowerCase();
  const contextToken = `${text(fiveDay.key)} ${text(fiveDay.label)} ${text(session.key)} ${text(session.label)} ${text(subPhase.key)} ${text(subPhase.label)}`.toLowerCase();

  if (/range|sideways|震荡/.test(`${shortKey} ${text(shortTerm.label)}`)
    && /weakening|mixed|diverg|structure_pending|转弱|混合|分歧|待确认/.test(contextToken)) {
    return {
      key: "range_divergence",
      label: "震荡分歧",
      status: shortTerm.confirmed === false ? "unavailable" : "observed",
      source: "index_cycle_regime.shortTerm+intraday",
      observationOnly: true,
      reason: unique([text(shortTerm.label), text(fiveDay.label), text(session.label)]).join("；") || "短周期震荡，执行节奏出现分歧。",
    };
  }

  const mappings = [
    [/partial_main_rise|局部主升/, "partial_main_rise", "局部主升"],
    [/main_rise|主升/, "main_rise", "主升"],
    [/repair|rebound|修复|反弹/, "repair", "反弹修复"],
    [/weakening|decline|退潮|转弱/, "weakening", "转弱"],
    [/range|sideways|震荡/, "range", "震荡"],
  ];
  const token = `${shortKey} ${text(shortTerm.label)}`;
  const matched = mappings.find(([pattern]) => pattern.test(token));
  if (matched && shortTerm.confirmed !== false) {
    return {
      key: matched[1],
      label: matched[2],
      status: "observed",
      source: "index_cycle_regime.shortTerm",
      observationOnly: true,
      reason: text(shortTerm.label) || "来自指数短周期结构。",
    };
  }

  return {
    key: "unavailable",
    label: "小周期待确认",
    status: "unavailable",
    source: "index_cycle_regime.shortTerm",
    observationOnly: true,
    reason: "短周期结构证据不足。",
  };
}

function emotionViewFrom(marketPhaseDetail, smallCycle) {
  const phaseDetail = isObject(marketPhaseDetail) ? marketPhaseDetail : {};
  const phaseEmotion = isObject(phaseDetail.emotionStage) ? phaseDetail.emotionStage : {};
  if (phaseIsAvailable(phaseEmotion)) {
    return {
      key: text(phaseEmotion.key) || "observed",
      label: text(phaseEmotion.label),
      status: "observed",
      source: "market_phase_detail.emotion_stage",
      authority: "observation_only",
      observationOnly: true,
      reason: text(phaseEmotion.reason) || "当日阶段镜像只作节奏观察；严格核心证据是否形成由独立证据路径判断。",
      lifecycle: isObject(phaseEmotion.lifecycle) ? { ...phaseEmotion.lifecycle } : null,
      phase: isObject(phaseEmotion.phase) ? { ...phaseEmotion.phase } : null,
      divergenceIntensity: isObject(phaseEmotion.divergenceIntensity)
        ? { ...phaseEmotion.divergenceIntensity }
        : null,
      divergenceQuality: isObject(phaseEmotion.divergenceQuality)
        ? { ...phaseEmotion.divergenceQuality }
        : null,
      supportState: isObject(phaseEmotion.supportState) ? { ...phaseEmotion.supportState } : null,
    };
  }

  if (isObject(smallCycle) && smallCycle.key === "range_divergence" && smallCycle.status !== "unavailable") {
    return {
      key: "divergence_observed",
      label: "分歧",
      status: "observed",
      source: "small_cycle_observation",
      authority: "observation_only",
      observationOnly: true,
      reason: "小周期处于震荡分歧；严格核心情绪证据仍待确认，因此这里只作节奏观察。",
    };
  }

  return {
    key: "unavailable",
    label: text(phaseEmotion.label) || "情绪阶段待确认",
    status: "unavailable",
    source: "market_phase_detail.emotion_stage",
    authority: "observation_only",
    observationOnly: true,
    reason: text(phaseEmotion.reason) || "严格核心情绪证据不足。",
  };
}

function catchupCountFrom(themeLibrary) {
  const library = isObject(themeLibrary) ? themeLibrary : {};
  const direct = finite(isObject(library.roleCounts) ? library.roleCounts["补涨"] : null);
  if (direct !== null) return direct;
  return (Array.isArray(library.themes) ? library.themes : []).reduce((sum, theme) => {
    const roleCounts = isObject(theme && theme.roleCounts) ? theme.roleCounts : {};
    return sum + (finite(roleCounts["补涨"]) || 0);
  }, 0);
}

function activeThemeCountFrom(themeLibrary) {
  const themes = isObject(themeLibrary) && Array.isArray(themeLibrary.themes) ? themeLibrary.themes : [];
  return themes.filter((theme) => {
    const cycle = isObject(theme && theme.themeCycle) ? theme.themeCycle : {};
    const direction = isObject(cycle.directionState) ? cycle.directionState : {};
    return cycle.sustained === true || cycle.resonance === true || direction.isCoreDirection === true;
  }).length;
}

function preferencePathDiagnostics(path, label) {
  const source = isObject(path) ? path : {};
  const confirmation = isObject(source.confirmation) ? source.confirmation : {};
  const status = text(source.status).toLowerCase();
  const score = finite(source.score);
  const sampleCount = finite(source.sampleCount);
  const minimumSamples = finite(confirmation.minimumSamples);
  const gaps = [];
  const confirmationConditions = [];

  if (!Object.keys(source).length) {
    return {
      gaps: [`${label}路径数据未生成`],
      confirmationConditions: [`生成${label}路径的规则分、独立样本、双榜交叉与核心结构证据`],
    };
  }
  if (status === "active" || confirmation.confirmed === true) {
    return { gaps, confirmationConditions };
  }
  if (confirmation.scorePass === false) {
    gaps.push(`${label}规则分未达确认线${score === null ? "" : `（当前${score}分）`}`);
    confirmationConditions.push(`${label}规则分达到确认线`);
  }
  if (confirmation.independentSamplePass === false) {
    const sampleText = sampleCount === null ? "" : `当前${sampleCount}只`;
    const minimumText = minimumSamples === null ? "" : `至少${minimumSamples}只`;
    const countText = [sampleText, minimumText].filter(Boolean).join("，");
    gaps.push(`${label}独立样本不足${countText ? `（${countText}）` : ""}`);
    confirmationConditions.push(`${label}独立样本达到最低要求`);
  }
  if (confirmation.crossSourcePass === false) {
    gaps.push(`${label}双榜交叉样本未通过`);
    confirmationConditions.push(`${label}双榜交叉样本通过校验`);
  }
  if (confirmation.coreStructurePass === false) {
    gaps.push(`${label}核心结构未确认`);
    confirmationConditions.push(`${label}形成可核验的核心结构`);
  }
  if (!gaps.length) {
    gaps.push(`${label}尚未同时通过规则分、独立样本、双榜交叉与核心结构门槛`);
    confirmationConditions.push(`${label}同时通过全部路径确认门槛`);
  }
  return { gaps, confirmationConditions };
}

function speculationPreferenceFrom(tradingStylePreference, themeLibrary) {
  const model = isObject(tradingStylePreference) ? tradingStylePreference : {};
  const paths = isObject(model.paths) ? model.paths : {};
  const items = [];
  const gaps = [];
  const confirmationConditions = [];
  const addPath = (key, label) => {
    const path = isObject(paths[key]) ? paths[key] : {};
    const status = text(path.status).toLowerCase();
    const diagnostics = preferencePathDiagnostics(path, label);
    gaps.push(...diagnostics.gaps);
    confirmationConditions.push(...diagnostics.confirmationConditions);
    if (!/[a-z]/.test(status) || !["active", "candidate"].includes(status)) return;
    items.push({
      key,
      label,
      status: status === "active" ? "confirmed" : "observed",
      source: `trading_style_preference.paths.${key}`,
      score: finite(path.score),
      sampleCount: finite(path.sampleCount),
      gaps: diagnostics.gaps,
      confirmationConditions: diagnostics.confirmationConditions,
    });
  };
  addPath("lowLaunch", "低位");
  addPath("boardEmotion", "连板");
  addPath("highTrend", "趋势");

  const catchupCount = catchupCountFrom(themeLibrary);
  if (catchupCount > 0) {
    items.push({
      key: "catchup",
      label: "补涨",
      status: "observed",
      source: "theme_library.roleCounts.补涨",
      count: catchupCount,
      note: "题材角色观察，不等同于第四条独立资金风格路径",
    });
  }

  const hotThemeCount = activeThemeCountFrom(themeLibrary);
  const lowConfirmed = items.some((item) => item.key === "lowLaunch" && item.status === "confirmed");
  const observedPathLabels = unique(items
    .filter((item) => ["boardEmotion", "highTrend"].includes(item.key) && item.status === "observed")
    .map((item) => item.label));
  const reasonParts = [];
  if (lowConfirmed) reasonParts.push("低位启动是当前唯一确认的主导路径");
  if (observedPathLabels.length) reasonParts.push(`${observedPathLabels.join("、")}仍属候选观察`);
  if (hotThemeCount > 0 && catchupCount > 0) {
    reasonParts.push(`${hotThemeCount}个活跃题材中出现${catchupCount}只补涨角色，资金更偏向低位与补涨来维持赚钱效应`);
  } else if (catchupCount > 0) {
    reasonParts.push(`盘面出现${catchupCount}只补涨角色`);
  }

  if (!Object.keys(paths).length) {
    gaps.splice(0, gaps.length, "全市场资金路径模型未生成，缺少低位启动、连板情绪和高位趋势三条路径数据");
    confirmationConditions.splice(0, confirmationConditions.length, "生成与本次明日决策同代的全市场资金路径模型");
  }
  const confirmedLabels = unique(items.filter((item) => item.status === "confirmed").map((item) => item.label));
  const observedLabels = unique(items.filter((item) => item.status !== "confirmed").map((item) => item.label));
  const uniqueGaps = unique(gaps);
  const uniqueConditions = unique(confirmationConditions);
  if (uniqueGaps.length && reasonParts.length) reasonParts.push(`未确认项：${uniqueGaps.join("、")}`);

  return {
    status: items.length ? "available" : "unavailable",
    conclusionStatus: confirmedLabels.length ? "confirmed" : items.length ? "observation_only" : "unavailable",
    source: "rule_derived_observation",
    observationOnly: true,
    affectsTradePermission: false,
    labels: unique(items.map((item) => item.label)),
    confirmedLabels,
    observedLabels,
    items,
    gaps: uniqueGaps,
    confirmationConditions: uniqueConditions,
    summary: unique(items.map((item) => item.label)).join(" / ") || "炒作偏好待确认",
    reason: reasonParts.length
      ? `${reasonParts.join("；")}。`
      : `偏好尚未确认：${uniqueGaps.join("；") || "当前没有可用的同代资金路径证据"}。`,
  };
}

function buildTomorrowDecisionContext(input = {}) {
  const source = isObject(input) ? input : {};
  const smallCycle = smallCycleFrom(source.indexCycleRegime);
  const bigCycle = bigCycleFrom(source);
  const transition = transitionFrom({ ...source, bigCycle });
  const emotionStage = emotionViewFrom(source.marketPhaseDetail, smallCycle);
  const speculationPreference = speculationPreferenceFrom(source.tradingStylePreference, source.themeLibrary);
  return {
    version: TOMORROW_DECISION_CONTEXT_VERSION,
    method: "rule_derived_observation_context_v2",
    status: [bigCycle, smallCycle, emotionStage, speculationPreference].some((item) => item.status !== "unavailable")
      ? "available"
      : "unavailable",
    generationId: text(source.generationId),
    tradingDate: text(source.tradingDate),
    asOf: text(source.asOf),
    bigCycle,
    transition,
    smallCycle,
    emotionStage,
    speculationPreference,
    guardrails: {
      observationOnly: true,
      emotionStageAuthority: false,
      tradePermissionAuthority: false,
      candidateAuthority: false,
      probabilityAuthority: false,
    },
  };
}

module.exports = {
  TOMORROW_DECISION_CONTEXT_VERSION,
  buildTomorrowDecisionContext,
  bigCycleFrom,
  transitionFrom,
  smallCycleFrom,
  emotionViewFrom,
  speculationPreferenceFrom,
};
