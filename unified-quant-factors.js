"use strict";

const {
  MAX_RESULT_STOCKS,
  inspectAuthoritativeDecisionChain,
} = require("./quant-decision/decision-chain");
const {
  STOCK_FACTOR_AUTHORITY,
  STOCK_FACTOR_VERSION,
} = require("./quant-decision/stock-factor-engine");

const UNIFIED_QUANT_FACTORS_VERSION = 6;

const FACTOR_CATALOG = Object.freeze([
  Object.freeze({
    id: "market.big_cycle",
    label: "大周期",
    layer: "market_stage",
    timeScale: "macro",
    owner: "emotion_cycle_engine.big_cycle",
    authority: "canonical",
    output: "marketStage.bigCycle",
    missingPolicy: "unknown_and_fail_closed",
  }),
  Object.freeze({
    id: "market.big_cycle_transition",
    label: "大周期过渡节点",
    layer: "market_stage",
    timeScale: "transition",
    owner: "market_cycle_contract.transition",
    authority: "observation_only",
    output: "marketStage.transition",
    missingPolicy: "not_active",
  }),
  Object.freeze({
    id: "market.small_cycle",
    label: "小周期",
    layer: "market_stage",
    timeScale: "micro",
    owner: "market_cycle_contract.small_cycle_composer",
    authority: "canonical",
    output: "marketStage.smallCycle",
    missingPolicy: "unknown_and_fail_closed",
  }),
  Object.freeze({
    id: "market.emotion_stage",
    label: "情绪阶段",
    layer: "market_stage",
    timeScale: "participatory",
    owner: "emotion_cycle_engine",
    authority: "canonical",
    output: "marketStage.emotionStage",
    missingPolicy: "unknown_and_fail_closed",
  }),
  Object.freeze({
    id: "market.emotion_divergence_intensity",
    label: "情绪分歧强度",
    layer: "market_stage",
    timeScale: "participatory",
    owner: "emotion_cycle_engine.divergence_intensity",
    authority: "canonical",
    output: "marketStage.emotionStage.divergenceIntensity",
    missingPolicy: "unknown_and_fail_closed",
  }),
  Object.freeze({
    id: "market.emotion_divergence_quality",
    label: "情绪分歧质量",
    layer: "market_stage",
    timeScale: "participatory",
    owner: "emotion_cycle_engine.divergence_quality",
    authority: "canonical",
    output: "marketStage.emotionStage.divergenceQuality",
    missingPolicy: "unknown_and_fail_closed",
  }),
  Object.freeze({
    id: "market.emotion_support",
    label: "情绪承接状态",
    layer: "market_stage",
    timeScale: "participatory",
    owner: "emotion_cycle_engine.support_state",
    authority: "canonical",
    output: "marketStage.emotionStage.supportState",
    missingPolicy: "unknown_and_fail_closed",
  }),
  Object.freeze({
    id: "market.emotion_t1_state",
    label: "T-1权威情绪状态",
    layer: "market_stage",
    timeScale: "cross_day",
    owner: "emotion_cycle_engine.previous",
    authority: "canonical_exact_closing_replay",
    output: "marketStage.previousEmotionStage",
    missingPolicy: "unknown_and_fail_closed",
  }),
  Object.freeze({
    id: "market.daily_state",
    label: "今日状态",
    layer: "market_stage",
    timeScale: "daily",
    owner: "market_cycle_engine.daily_state",
    authority: "observation",
    output: "marketStage.dailyState",
    missingPolicy: "unknown",
  }),
  Object.freeze({
    id: "style.macro_rotation",
    label: "宏观炒作组织",
    layer: "speculation_preference",
    timeScale: "macro",
    owner: "classify_trading_style",
    authority: "macro_context",
    output: "speculationPreference.macro",
    missingPolicy: "unknown",
  }),
  Object.freeze({
    id: "style.micro_paths",
    label: "微观资金路径",
    layer: "speculation_preference",
    timeScale: "micro",
    owner: "trading_style_preference",
    authority: "micro_path",
    output: "speculationPreference.micro",
    missingPolicy: "unknown_and_no_carrier_permission",
  }),
  Object.freeze({
    id: "profit.market",
    label: "全市场赚钱效应",
    layer: "profit_effect",
    timeScale: "daily",
    owner: "market_cycle_engine.profit_effect",
    authority: "market_observation",
    output: "profitEffects.market",
    missingPolicy: "unknown",
  }),
  Object.freeze({
    id: "profit.short_core",
    label: "短线核心赚钱效应",
    layer: "profit_effect",
    timeScale: "short_term",
    owner: "market_effect_attribution.short_core",
    authority: "short_term_observation",
    output: "profitEffects.shortCore",
    missingPolicy: "unknown",
  }),
  Object.freeze({
    id: "profit.tradeable",
    label: "可交易赚钱效应",
    layer: "profit_effect",
    timeScale: "execution",
    owner: "market_effect_attribution.tradeable",
    authority: "execution_observation",
    output: "profitEffects.tradeable",
    missingPolicy: "empty_not_padding",
  }),
  Object.freeze({
    id: "permission.final",
    label: "最终交易许可",
    layer: "permission",
    timeScale: "execution",
    owner: "unified_permission_intersection",
    authority: "final",
    output: "permission.final",
    missingPolicy: "blocked",
  }),
  Object.freeze({
    id: "trade.value",
    label: "市场交易价值",
    layer: "authorization",
    timeScale: "execution",
    owner: "unified_decision_chain.authorization",
    authority: "market_risk_value",
    output: "decisionChain.authorization.tradeValue",
    missingPolicy: "none_and_blocked",
  }),
  Object.freeze({
    id: "permission.position",
    label: "交易仓位权限",
    layer: "authorization",
    timeScale: "execution",
    owner: "unified_decision_chain.authorization",
    authority: "portfolio_ceiling",
    output: "decisionChain.authorization.positionPermission",
    missingPolicy: "zero_position",
  }),
  Object.freeze({
    id: "theme.eligibility",
    label: "题材准入",
    layer: "theme",
    timeScale: "execution",
    owner: "unified_decision_chain.theme",
    authority: "veto",
    output: "decisionChain.theme",
    missingPolicy: "blocked",
  }),
  Object.freeze({
    id: "stock.mode",
    label: "股票模式",
    layer: "stock_mode",
    timeScale: "cycle_specific",
    owner: "unified_decision_chain.stockMode",
    authority: "veto",
    output: "decisionChain.stockMode",
    missingPolicy: "blocked",
  }),
  Object.freeze({
    id: "candidate.hard_gate",
    label: "个股硬门槛",
    layer: "candidate",
    timeScale: "execution",
    owner: STOCK_FACTOR_AUTHORITY,
    authority: "veto",
    output: "candidate.factorDecision.hardGate",
    missingPolicy: "blocked",
  }),
  Object.freeze({
    id: "candidate.intraday_leadership",
    label: "分时领导力证据",
    layer: "candidate",
    timeScale: "intraday_exact_date",
    owner: "core_leadership",
    authority: "relative_weight_and_veto",
    output: "candidate.leadership.initiative",
    missingPolicy: "closing_proxy_capped_no_permission",
  }),
  Object.freeze({
    id: "candidate.participation_value",
    label: "个股参与价值",
    layer: "candidate",
    timeScale: "cycle_specific",
    owner: STOCK_FACTOR_AUTHORITY,
    authority: "relative_ranking",
    output: "candidate.factorDecision.participationValue",
    missingPolicy: "unranked",
  }),
  Object.freeze({
    id: "candidate.risk_adjustment",
    label: "个股风险调整",
    layer: "candidate",
    timeScale: "execution",
    owner: STOCK_FACTOR_AUTHORITY,
    authority: "downside_only",
    output: "candidate.factorDecision.riskAdjustment",
    missingPolicy: "no_relaxation",
  }),
  Object.freeze({
    id: "candidate.execution_feasibility",
    label: "执行可行性",
    layer: "candidate",
    timeScale: "execution",
    owner: "unified_execution_feasibility_v1",
    authority: "tighten_or_veto_only",
    output: "candidate.factorDecision.executionFeasibility",
    missingPolicy: "conditional_or_blocked_no_relaxation",
  }),
  Object.freeze({
    id: "market_cap.carrier",
    label: "市值载体观察",
    layer: "profit_effect",
    timeScale: "daily",
    owner: "market_cap_carrier",
    authority: "observation_only",
    output: "marketCapCarrier",
    missingPolicy: "unknown_no_score",
  }),
  Object.freeze({
    id: "result.max_five",
    label: "最终结果股票",
    layer: "result",
    timeScale: "execution",
    owner: "unified_decision_chain.result",
    authority: "canonical_stock_output",
    output: "decisionChain.result.stocks",
    missingPolicy: "empty_not_padding",
  }),
  Object.freeze({
    id: "result.observation_candidates",
    label: "授权关闭观察候选",
    layer: "result",
    timeScale: "execution",
    owner: "unified_decision_chain.observationCandidates",
    authority: "observation_only_no_execution",
    output: "decisionChain.observationCandidates.stocks",
    missingPolicy: "empty_not_padding",
  }),
  Object.freeze({
    id: "result.observation_tiers",
    label: "观察候选A/B/C分层",
    layer: "result",
    timeScale: "execution",
    owner: "unified_decision_chain.observationCandidates",
    authority: "observation_only_no_execution",
    output: "decisionChain.observationCandidates.groups",
    missingPolicy: "empty_not_padding",
  }),
  Object.freeze({
    id: "result.position_allocation",
    label: "参与价值与仓位配比",
    layer: "allocation",
    timeScale: "execution",
    owner: "unified_decision_chain.result",
    authority: "position_allocation",
    output: "decisionChain.result.participationAndAllocation",
    missingPolicy: "zero_position",
  }),
  Object.freeze({
    id: "validation.execution_replay",
    label: "分钟触发与成交回放",
    layer: "validation",
    timeScale: "intraday_t1",
    owner: "intraday_execution_replay_v1",
    authority: "validation_only",
    output: "factorEffectiveness.rankingStudy.executionReplayAudit",
    missingPolicy: "unavailable_no_synthetic_fill",
  }),
  Object.freeze({
    id: "validation.factor_ablation",
    label: "因子消融与相关性审计",
    layer: "validation",
    timeScale: "walk_forward",
    owner: "factor_ablation_validation_only_v1",
    authority: "validation_only",
    output: "factorEffectiveness.rankingStudy.ablationStudy",
    missingPolicy: "insufficient_sample_no_change",
  }),
  Object.freeze({
    id: "validation.threshold_calibration",
    label: "样本外阈值校准",
    layer: "validation",
    timeScale: "walk_forward",
    owner: "walk_forward_threshold_calibration_v1",
    authority: "recommendation_only",
    output: "factorEffectiveness.rankingStudy.thresholdCalibration",
    missingPolicy: "retain_current_parameters",
  }),
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, fallback = "") {
  const result = String(value == null ? "" : value).trim();
  return result || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function unique(values) {
  return Array.from(new Set(list(values).map((value) => text(value)).filter(Boolean)));
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cloneSmall(value) {
  if (!isObject(value)) return null;
  return { ...value };
}

function stageItem(source, fallback = {}) {
  const item = isObject(source) ? source : {};
  const fallbackItem = isObject(fallback) ? fallback : {};
  const key = text(item.key || item.state || fallbackItem.key || fallbackItem.state, "unknown");
  const label = text(item.label || fallbackItem.label || fallbackItem.key, "待确认");
  return {
    key,
    label,
    status: text(item.status || fallbackItem.status, key === "unknown" ? "unavailable" : "available"),
    source: text(item.source || fallbackItem.source, "unified_projection"),
    reason: text(item.reason || item.summary || fallbackItem.reason || fallbackItem.summary),
    observationOnly: item.observationOnly === true || fallbackItem.observationOnly === true,
    ...(isObject(item.lifecycle || fallbackItem.lifecycle)
      ? { lifecycle: cloneSmall(item.lifecycle || fallbackItem.lifecycle) }
      : {}),
    ...(isObject(item.phase || fallbackItem.phase)
      ? { phase: cloneSmall(item.phase || fallbackItem.phase) }
      : {}),
    ...(isObject(item.divergenceIntensity || fallbackItem.divergenceIntensity)
      ? { divergenceIntensity: cloneSmall(item.divergenceIntensity || fallbackItem.divergenceIntensity) }
      : {}),
    ...(isObject(item.divergenceQuality || fallbackItem.divergenceQuality)
      ? { divergenceQuality: cloneSmall(item.divergenceQuality || fallbackItem.divergenceQuality) }
      : {}),
    ...(isObject(item.supportState || fallbackItem.supportState)
      ? { supportState: cloneSmall(item.supportState || fallbackItem.supportState) }
      : {}),
  };
}

function collectGeneration(payload) {
  const inspected = inspectAuthoritativeDecisionChain(payload);
  const generation = isObject(inspected.generation) ? inspected.generation : {};
  return {
    generationId: text(generation.generationId) || null,
    tradingDate: text(generation.tradingDate) || null,
    asOf: text(generation.asOf) || null,
    snapshotKind: text(payload.decisionBasis && payload.decisionBasis.snapshotKind, "unknown"),
    aligned: generation.aligned === true,
    conflicts: isObject(generation.conflicts) ? { ...generation.conflicts } : {},
    source: "unified_decision_chain_generation",
  };
}

function buildMarketStage(payload, decisionInspection = null) {
  const market = isObject(payload.market) ? payload.market : {};
  const state = isObject(market.state) ? market.state : {};
  const inspection = decisionInspection || inspectDecisionChain(payload, collectGeneration(payload));
  const chainStage = inspection.chainValid
    && isObject(inspection.chain && inspection.chain.marketStage)
    ? inspection.chain.marketStage : {};
  const bigCycle = stageItem(chainStage.bigCycle, {
    key: "unknown",
    label: "大周期待确认",
    status: "unavailable",
    source: "unified_decision_chain.marketStage.bigCycle",
  });
  const transition = stageItem(chainStage.transition, {
    key: "none",
    label: "无周期切换",
    status: "not_active",
    source: "unified_decision_chain.marketStage.transition",
    observationOnly: true,
  });
  const smallCycle = stageItem(chainStage.smallCycle, {
    key: "unknown",
    label: "小周期待确认",
    status: "unavailable",
    source: "unified_decision_chain.marketStage.smallCycle",
  });
  const emotionStage = stageItem(chainStage.emotionStage, {
    key: "unknown",
    label: "情绪阶段待确认",
    status: "unavailable",
    source: "unified_decision_chain.marketStage.emotionStage",
    observationOnly: true,
  });
  const previousSource = isObject(chainStage.previousEmotionStage)
    ? chainStage.previousEmotionStage : {};
  const previousEmotionStage = {
    ...stageItem(previousSource, {
      key: "unknown",
      label: "T-1情绪状态待确认",
      status: "unavailable",
      source: "unified_decision_chain.marketStage.previousEmotionStage",
    }),
    available: previousSource.available === true,
    passed: previousSource.passed === true,
    tradingDate: text(previousSource.tradingDate) || null,
    expectedTradingDate: text(previousSource.expectedTradingDate) || null,
    authority: text(previousSource.authority) || null,
    replayed: previousSource.replayed === true,
    replayAudit: isObject(previousSource.replayAudit) ? cloneSmall(previousSource.replayAudit) : null,
    crossDayVerified: previousSource.crossDayVerified === true,
    exactCanonical: previousSource.exactCanonical === true,
    cycleGenerationAligned: previousSource.cycleGenerationAligned === true,
  };
  const dailyState = stageItem(state.dailyState, {
    key: state.subPhase,
    label: state.subPhase,
    source: "market_cycle_engine.dailyState",
    observationOnly: true,
  });
  const headline = [bigCycle.label, smallCycle.label, emotionStage.label].filter(Boolean).join(" · ");

  return {
    bigCycle,
    transition,
    smallCycle,
    emotionStage,
    previousEmotionStage,
    dailyState,
    headline: headline || "市场阶段待确认",
    independentAxes: true,
    legacyObservations: {
      compositeCycle: text(state.cycle) || null,
      rawCycle: text(state.rawCycle) || null,
      observedCycle: text(state.observedCycle) || null,
      marketEmotionCycle: text(payload.marketEmotion && payload.marketEmotion.cycle) || null,
      note: "旧周期字段仅用于迁移审计，不得覆盖大周期或小周期。",
    },
  };
}

function buildSpeculationPreference(payload) {
  const market = isObject(payload.market) ? payload.market : {};
  const legacy = isObject(market.tradingStyle) ? market.tradingStyle : {};
  const models = isObject(payload.premarketModels) ? payload.premarketModels : {};
  const model = isObject(models.tradingStylePreference)
    ? models.tradingStylePreference
    : isObject(legacy.preferenceModel) ? legacy.preferenceModel : {};
  const organization = isObject(model.marketOrganization) ? model.marketOrganization : {};
  const dominant = isObject(model.dominantPath) ? model.dominantPath : {};
  const paths = isObject(model.paths) ? model.paths : {};
  const activePaths = Object.values(paths)
    .filter((item) => isObject(item) && item.status === "active")
    .map((item) => ({ key: text(item.key), label: text(item.label), stage: text(item.stage), score: finite(item.score) }));
  const macroLabel = text(legacy.style || legacy.preference, "宏观组织待确认");
  const microLabel = text(dominant.label || organization.label, "微观路径待确认");

  return {
    macro: {
      scope: "macro_market_organization",
      key: text(legacy.style || legacy.preference, "unknown"),
      label: macroLabel,
      preference: text(legacy.preference) || null,
      topDirection: text(legacy.topDirection) || null,
      source: "classify_trading_style",
      role: "判断板块轮动、聚焦或个股轮动等宏观组织方式",
    },
    micro: {
      scope: "micro_stock_paths",
      key: text(dominant.key || organization.key, "unknown"),
      label: microLabel,
      organization: text(organization.label) || null,
      activePaths,
      executionPreference: cloneSmall(model.executionPreference),
      directionPermission: cloneSmall(model.directionPermission),
      source: "trading_style_preference",
      role: "判断低位启动、高位趋势、连板情绪等微观参与路径",
    },
    combined: {
      mode: "macro_micro_overlay",
      summary: `宏观：${macroLabel}；微观：${microLabel}`,
      rule: "宏观判断市场如何组织，微观判断资金通过哪类股票表达；两者并列使用，不相互覆盖。",
    },
  };
}

function attributionScope(payload, key) {
  const scopes = list(payload.market && payload.market.state && payload.market.state.effectAttribution
    && payload.market.state.effectAttribution.scopes);
  const found = scopes.find((item) => item && item.key === key);
  if (!found) return { key, status: "unavailable", label: "待确认", score: null, summary: "" };
  return {
    key,
    status: "available",
    label: text(found.label, "待确认"),
    score: finite(found.score),
    summary: text(found.summary),
    tone: text(found.tone, "neutral"),
  };
}

function buildProfitEffects(payload) {
  const state = isObject(payload.market && payload.market.state) ? payload.market.state : {};
  const profit = isObject(state.profitEffect) ? state.profitEffect : {};
  const loss = isObject(state.lossEffect) ? state.lossEffect : {};
  return {
    market: {
      status: finite(profit.score) === null ? "unavailable" : "available",
      label: text(profit.label, "全市场赚钱效应待确认"),
      score: finite(profit.score),
      trend: text(profit.trend, "unknown"),
      summary: text(profit.summary),
    },
    shortCore: attributionScope(payload, "short-core"),
    tradeable: attributionScope(payload, "tradeable"),
    loss: {
      status: finite(loss.score) === null ? "unavailable" : "available",
      label: text(loss.label, "全市场亏钱效应待确认"),
      score: finite(loss.score),
      trend: text(loss.trend, "unknown"),
      summary: text(loss.summary),
    },
    marketCapCarrier: cloneSmall(payload.market && payload.market.marketCapCarrier),
    scopesAreIndependent: true,
  };
}

function permissionLayer(key, label, status, allowNew, reasons = [], extra = {}) {
  return {
    key,
    label,
    status: text(status, allowNew === true ? "allowed" : allowNew === false ? "blocked" : "unknown"),
    allowNew: allowNew === true ? true : allowNew === false ? false : null,
    reasons: unique(reasons),
    ...extra,
  };
}

function inspectDecisionChain(payload, generation) {
  const inspected = inspectAuthoritativeDecisionChain(payload, { requireBestPicksProjection: true });
  return {
    chain: inspected.chain,
    chainValid: inspected.chainValid && generation.aligned,
    valid: inspected.valid && generation.aligned,
    generation: inspected.generation,
    reasons: unique([
      ...inspected.reasons,
      !generation.aligned ? "量化因子数据代次不一致" : null,
    ]),
  };
}

function buildPermission(payload, generation, decisionInspection = null) {
  const inspected = decisionInspection || inspectDecisionChain(payload, generation);
  const chainAuthorization = isObject(inspected.chain.authorization) ? inspected.chain.authorization : {};
  const chainTradePermission = isObject(chainAuthorization.tradePermission)
    ? chainAuthorization.tradePermission : {};
  const chainPositionPermission = isObject(chainAuthorization.positionPermission)
    ? chainAuthorization.positionPermission : {};
  if (!inspected.valid) {
    const reasons = inspected.reasons.length ? inspected.reasons : ["统一决策链缺失"];
    return {
      rule: "only_current_authoritative_decision_chain_can_grant_permission",
      layers: [permissionLayer(
        "unified_decision_chain",
        "统一决策链",
        "blocked",
        false,
        reasons,
      )],
      final: {
        status: "blocked",
        label: "禁止新开仓",
        allowNew: false,
        allowAdd: false,
        positionCeilingPct: 0,
        reasons,
        authority: "unified_decision_chain_fail_closed",
      },
      tradeValue: { key: "none", label: "无交易价值", status: "blocked", numericScore: null, calibrated: false },
      positionPermission: { status: "blocked", positionCeilingPct: 0, initialActivationPct: 0, addPermission: false },
      integrity: {
        monotonic: true,
        explicitBlockCount: 1,
        unknownLayers: [],
        generationAligned: generation.aligned,
        source: "unified_decision_chain",
        chainValid: false,
      },
    };
  }

  const layers = list(chainAuthorization.layers).map((layer) => ({
    key: text(layer && layer.key),
    label: text(layer && layer.label),
    status: text(layer && layer.status),
    allowNew: layer && layer.allow === true ? true : layer && layer.allow === false ? false : null,
    reasons: unique(layer && layer.reasons),
    positionRangePct: list(layer && layer.positionRangePct).map(Number).filter(Number.isFinite),
  }));
  const allowNew = chainAuthorization.passed === true && chainTradePermission.allowNew === true;
  return {
    rule: "strict_sequential_chain_authority_and_downstream_can_only_tighten",
    layers,
    final: {
      status: allowNew ? text(chainTradePermission.status, "conditional") : "blocked",
      label: allowNew ? text(chainAuthorization.tradeValue && chainAuthorization.tradeValue.label, "条件参与") : "禁止新开仓",
      allowNew,
      allowAdd: allowNew && chainTradePermission.allowAdd === true,
      positionCeilingPct: allowNew ? finite(chainPositionPermission.positionCeilingPct) : 0,
      reasons: unique(chainTradePermission.reasons),
      authority: "unified_decision_chain",
    },
    tradeValue: cloneSmall(chainAuthorization.tradeValue),
    positionPermission: cloneSmall(chainPositionPermission),
    integrity: {
      monotonic: true,
      explicitBlockCount: layers.filter((layer) => layer.allowNew !== true).length,
      unknownLayers: layers.filter((layer) => layer.allowNew === null).map((layer) => layer.key),
      generationAligned: generation.aligned,
      source: "unified_decision_chain",
      chainValid: true,
    },
  };
}

function buildCandidateSummary(payload, generation, decisionInspection = null) {
  const candidates = list(payload.candidates);
  const legacySelected = candidates.filter((item) => item && item.selected === true);
  const executionEligible = candidates.filter((item) => item && (
    item.executionEligible === true
    || item.tradeQualified === true
      && item.hardGate && item.hardGate.pass === true
      && item.leadership && item.leadership.tradeQualified === true
      && item.tomorrowExecution && item.tomorrowExecution.tomorrowEntryQualified === true
  ));
  const inspected = decisionInspection || inspectDecisionChain(payload, generation);
  const chainResult = inspected.valid && isObject(inspected.chain.result) ? inspected.chain.result : {};
  const chainObservation = inspected.valid && isObject(inspected.chain.observationCandidates)
    ? inspected.chain.observationCandidates : {};
  const observationCandidates = list(chainObservation.stocks);
  return {
    universeCount: candidates.length,
    legacySelectedCount: legacySelected.length,
    observationCandidateCount: finite(chainObservation.selectedCount) ?? observationCandidates.length,
    hardGateCandidateCount: observationCandidates.filter((item) => item && item.hardGatePassed === true).length,
    executionCandidateCount: executionEligible.length,
    finalResultCount: finite(chainResult.selectedCount) ?? 0,
    finalResultCodes: list(chainResult.selectedCodes).map(text).filter(Boolean),
    maxFinalResults: finite(chainResult.maxStocks) ?? MAX_RESULT_STOCKS,
    qualificationOrder: [
      "universeEligible",
      "themeEligible",
      "roleEligible",
      "patternEligible",
      "riskEligible",
      "executionEligible",
    ],
    legacySelectedIsExecutionAuthority: false,
  };
}

function buildUnifiedQuantFactors(input = {}) {
  const payload = isObject(input) ? input : {};
  const generation = collectGeneration(payload);
  const decisionInspection = inspectDecisionChain(payload, generation);
  const marketStage = buildMarketStage(payload, decisionInspection);
  const speculationPreference = buildSpeculationPreference(payload);
  const profitEffects = buildProfitEffects(payload);
  const permission = buildPermission(payload, generation, decisionInspection);
  const candidates = buildCandidateSummary(payload, generation, decisionInspection);
  const decisionChain = isObject(payload.unifiedDecisionChain) ? payload.unifiedDecisionChain : null;
  const bestPicks = isObject(payload.bestPicks) ? payload.bestPicks : {};
  const stockFactorEngineAligned = text(bestPicks.factorEngineAuthority) === STOCK_FACTOR_AUTHORITY
    && finite(bestPicks.factorEngineVersion) === STOCK_FACTOR_VERSION;
  const warnings = [];
  if (!generation.aligned) warnings.push("同一决策内存在跨代或跨交易日因子，最终许可已关闭");
  if (candidates.legacySelectedCount > candidates.executionCandidateCount) {
    warnings.push("旧selected候选多于最终可执行候选；selected仅保留迁移审计，不代表可交易");
  }
  if (marketStage.bigCycle.status === "unavailable") warnings.push("大周期不可用");
  if (marketStage.smallCycle.status === "unavailable") warnings.push("小周期不可用");
  if (!stockFactorEngineAligned) warnings.push("个股评分未由统一因子引擎生成");
  if (!decisionInspection.valid) warnings.push(...decisionInspection.reasons);

  return {
    version: UNIFIED_QUANT_FACTORS_VERSION,
    method: "strict_sequential_decision_chain_v3",
    generation,
    marketStage,
    speculationPreference,
    profitEffects,
    permission,
    candidates,
    decisionChain,
    roleContract: {
      themeRole: "龙头/先锋/中军/补涨/跟随，描述题材内部地位",
      dailyRole: "当日高度/主动领涨，描述当日表现",
      cycleIdentity: "候选/确认/保留/失效，描述跨日身份",
      executionRole: "可执行/条件观察/仅复盘，唯一可影响最终交易权限的角色层",
    },
    factorRegistry: FACTOR_CATALOG.map((item) => ({ ...item })),
    integrity: {
      status: generation.aligned && decisionInspection.valid && stockFactorEngineAligned ? "valid" : "invalid",
      ok: generation.aligned && decisionInspection.valid && stockFactorEngineAligned,
      failClosed: true,
      bigAndSmallCycleIndependent: true,
      macroAndMicroPreferenceOverlaid: true,
      observationCannotGrantPermission: true,
      legacySelectedIsNotExecution: true,
      stockFactorEngineAuthority: text(bestPicks.factorEngineAuthority) || null,
      stockFactorEngineVersion: finite(bestPicks.factorEngineVersion),
      stockFactorEngineAligned,
      strictSequentialDecisionChain: decisionInspection.valid,
      maxFiveFinalStocks: decisionInspection.valid
        && list(decisionChain.result && decisionChain.result.stocks).length <= MAX_RESULT_STOCKS,
      warnings,
    },
  };
}

module.exports = {
  UNIFIED_QUANT_FACTORS_VERSION,
  FACTOR_CATALOG,
  buildUnifiedQuantFactors,
};
