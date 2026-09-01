"use strict";

const {
  normalizeBigCycle,
  normalizeBigCycleKey,
} = require("./market-cycle-contract");
const {
  STOCK_FACTOR_AUTHORITY,
  STOCK_FACTOR_VERSION,
} = require("./stock-factor-engine");
const { buildExecutionFeasibility } = require("./execution-feasibility");
const { classifyLimitUpPullbackRepair } = require("./limit-up-pullback-repair");
const {
  evaluateOpportunityDataCompleteness,
  evaluateShortTermActiveCarrier,
} = require("../trading-rules");

const UNIFIED_DECISION_CHAIN_VERSION = 3;
const SELECTION_AUTHORITY = "unified_decision_chain_v3";
const STOCK_SELECTION_CONTEXT_AUTHORITY = "canonical_market_phase_detail";
const MAX_RESULT_STOCKS = 5;
const MAX_PULLBACK_OBSERVATION_STOCKS = 2;
const POST_ENTRY_NEXT_DAY_EXPECTATION_VERSION = 1;
const ENTRY_CONFIRMATION_VERSION = 1;
const STRICT_DECISION_ORDER = Object.freeze([
  "market_stage",
  "authorization",
  "profit_effect",
  "theme",
  "stock_mode",
  "stock_hard_gate",
  "result_stocks",
  "participation_allocation",
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function text(value, fallback = "") {
  const result = String(value == null ? "" : value).trim();
  return result || fallback;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function canonicalAllocationSnapshot(value) {
  const source = isObject(value) ? value : {};
  return {
    relativeWeightPct: finite(source.relativeWeightPct),
    initialPortfolioPct: finite(source.initialPortfolioPct),
    maximumPortfolioPct: finite(source.maximumPortfolioPct),
  };
}

function canonicalAllocationMatches(left, right) {
  const leftAllocation = canonicalAllocationSnapshot(left);
  const rightAllocation = canonicalAllocationSnapshot(right);
  return ["relativeWeightPct", "initialPortfolioPct", "maximumPortfolioPct"]
    .every((key) => leftAllocation[key] !== null && leftAllocation[key] === rightAllocation[key]);
}

function withoutPositionField(value) {
  if (!isObject(value)) return value;
  const result = { ...value };
  delete result.position;
  return result;
}

function projectCanonicalAllocation(pick, allocation) {
  const source = isObject(pick) ? pick : {};
  const projected = { ...source };
  const legacyPosition = {};
  if (Object.prototype.hasOwnProperty.call(source, "position")) legacyPosition.topLevel = source.position;
  if (isObject(source.stopLossPlan) && Object.prototype.hasOwnProperty.call(source.stopLossPlan, "position")) {
    legacyPosition.stopLossPlan = source.stopLossPlan.position;
  }
  if (isObject(source.advice) && Object.prototype.hasOwnProperty.call(source.advice, "position")) {
    legacyPosition.advice = source.advice.position;
  }
  if (isObject(source.tradePlan) && Object.prototype.hasOwnProperty.call(source.tradePlan, "position")) {
    legacyPosition.tradePlan = source.tradePlan.position;
  }
  delete projected.position;
  if (isObject(source.stopLossPlan)) projected.stopLossPlan = withoutPositionField(source.stopLossPlan);
  if (isObject(source.advice)) projected.advice = withoutPositionField(source.advice);
  if (isObject(source.tradePlan)) projected.tradePlan = withoutPositionField(source.tradePlan);
  if (Object.keys(legacyPosition).length) {
    projected.legacyObservation = {
      ...(isObject(source.legacyObservation) ? source.legacyObservation : {}),
      position: legacyPosition,
      executionAuthority: false,
      note: "旧仓位字段仅保留为观察证据，不得参与正式执行",
    };
  }
  const canonicalAllocation = canonicalAllocationSnapshot(allocation);
  projected.canonicalAllocation = canonicalAllocation;
  projected.positionAllocation = { ...canonicalAllocation };
  return projected;
}

function hasLegacyExecutionPosition(value) {
  return Boolean(
    isObject(value)
    && (
      Object.prototype.hasOwnProperty.call(value, "position")
      || (isObject(value.stopLossPlan) && Object.prototype.hasOwnProperty.call(value.stopLossPlan, "position"))
      || (isObject(value.advice) && Object.prototype.hasOwnProperty.call(value.advice, "position"))
      || (isObject(value.tradePlan) && Object.prototype.hasOwnProperty.call(value.tradePlan, "position"))
    )
  );
}

function unique(values) {
  return [...new Set(rows(values).map((value) => text(value)).filter(Boolean))];
}

function buildPostEntryNextDayExpectation({
  primaryPath,
  pathStage,
  pullbackRepairQualified,
  confirmationConditions,
  cancelConditions,
  basis,
} = {}) {
  const path = text(primaryPath);
  const stage = text(pathStage).toLowerCase();
  const pathDefinitions = {
    boardEmotion: {
      key: "board_premium",
      label: /acceleration|climax/.test(stage)
        ? "先看溢价 / 更防分歧兑现"
        : "核心溢价 / 晋级验证",
      riskLabel: "分歧兑现或高标负反馈",
    },
    lowLaunch: {
      key: "launch_premium",
      label: "启动溢价 / 题材继续发酵",
      riskLabel: "冲高回落或首板失败",
    },
    highTrend: {
      key: "trend_premium",
      label: /acceleration/.test(stage)
        ? "冲高溢价 / 更防兑现"
        : "趋势延续 / 再冲高",
      riskLabel: "趋势破位或低开兑现",
    },
  };
  const definition = pullbackRepairQualified
    ? {
      key: "pullback_repair_premium",
      label: "修复延续 / 冲击前高",
      riskLabel: "修复失败或再度走弱",
    }
    : pathDefinitions[path] || null;
  const confirmations = unique(confirmationConditions);
  const cancellations = unique(cancelConditions);
  return {
    version: POST_ENTRY_NEXT_DAY_EXPECTATION_VERSION,
    status: definition ? "conditional" : "unavailable",
    horizon: "entry_t_plus_1",
    premise: "仅在明日确认条件满足后假设参与",
    key: definition && definition.key || null,
    label: definition && definition.label || "买后次日预期待确认",
    riskLabel: definition && definition.riskLabel || "不预设上涨",
    entryCondition: confirmations[0] || null,
    invalidation: cancellations[0] || null,
    basis: text(basis) || path || null,
    pathStage: stage || null,
    probability: null,
    calibrated: false,
    observationOnly: true,
    executionAuthority: false,
  };
}

function buildEntryConfirmation({
  primaryPath,
  pullbackRepairQualified,
  hardGatePassed,
  leadershipQualified,
  shortTermCarrierQualified,
  opportunityDataComplete,
  missingConditions,
  confirmationConditions,
  cancelConditions,
} = {}) {
  const path = text(primaryPath);
  const missing = unique(missingConditions);
  const confirmations = unique(confirmationConditions);
  const cancellations = unique(cancelConditions);
  const common = {
    version: ENTRY_CONFIRMATION_VERSION,
    observationOnly: true,
    executionAuthority: false,
    activated: false,
    triggerConditions: confirmations.slice(0, 3),
    invalidation: cancellations[0] || "路径失效或负反馈扩散",
  };
  if (opportunityDataComplete !== true) {
    return {
      ...common,
      status: "unavailable",
      type: null,
      label: "买点确认待数据补足",
      avoid: "关键数据不完整时不确认买点",
      reason: "机会关键数据契约未通过",
    };
  }
  if (hardGatePassed !== true) {
    const blockedLabel = missing.some((item) => /成交额/.test(item))
      ? "当前不可确认（成交额不足）"
      : missing.some((item) => /主线方向/.test(item))
        ? "当前不可确认（方向未通过）"
        : "当前不可确认（硬门槛未过）";
    return {
      ...common,
      status: "blocked",
      type: null,
      label: blockedLabel,
      avoid: "硬门槛未通过时，即使涨停也不算系统买点",
      reason: missing[0] || "个股硬门槛未通过",
    };
  }
  if (pullbackRepairQualified === true) {
    return {
      ...common,
      status: "waiting_trigger",
      type: "support_or_breakout",
      label: "承接转强 / 放量突破",
      avoid: "不把脉冲反抽或直接打板当作必要确认",
      reason: missing[0] || "等待板块回流、个股主动承接与相对强度恢复",
    };
  }
  if (path === "boardEmotion") {
    return {
      ...common,
      status: "waiting_trigger",
      type: "reseal_board",
      label: missing.some((item) => /买点尚未取得/.test(item))
        ? "回封板确认（当前未触发）"
        : "充分换手后的回封板",
      avoid: "无换手秒板、一字板或后排跟风不算确认",
      reason: leadershipQualified === true || shortTermCarrierQualified === true
        ? "等待真实分歧、充分换手与核心回封"
        : "先确认核心身份与主动带动，再观察回封",
    };
  }
  if (path === "lowLaunch") {
    return {
      ...common,
      status: "waiting_trigger",
      type: "first_board_or_breakout",
      label: "先锋首板 / 容量突破",
      avoid: "孤立首板或容量不跟不算确认",
      reason: missing[0] || "等待先锋与主动容量同步",
    };
  }
  if (path === "highTrend") {
    return {
      ...common,
      status: "waiting_trigger",
      type: "support_reclaim",
      label: "回踩承接 / 重新转强",
      avoid: "偏离均线的加速不追，破位不确认",
      reason: missing[0] || "等待关键均线或结构锚承接",
    };
  }
  return {
    ...common,
    status: "unavailable",
    type: null,
    label: "买点确认方式待识别",
    avoid: "路径不明确时不生成买点",
    reason: "没有可识别的右侧确认路径",
  };
}

function codeOf(value) {
  return text(value && (value.code || value.secCode || value.stockCode || value.symbol));
}

function listCodes(value) {
  return unique(rows(value).map((item) => typeof item === "string" ? item : codeOf(item)));
}

function statusToken(value) {
  return text(value).toLowerCase();
}

function isUnavailable(value) {
  return /(^|\b)(unknown|unavailable|invalid)(\b|$)|待确认|不可用|缺失/.test(statusToken(value));
}

function normalizeTradingDate(value) {
  const compact = text(value).replace(/[^0-9]/g, "");
  if (!/^20\d{6}$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function generationSnapshot(payload) {
  const phase = isObject(payload.marketPhaseDetail) ? payload.marketPhaseDetail : {};
  const decisionContext = isObject(phase.decisionContext) ? phase.decisionContext : {};
  const models = isObject(payload.premarketModels) ? payload.premarketModels : {};
  const context = isObject(payload.generationContext) ? payload.generationContext : {};
  const ids = unique([
    payload.generationId,
    context.generationId,
    context.id,
    phase.generationId,
    decisionContext.generationId,
    models.generationId,
  ]);
  const dates = unique([
    payload.tradingDate,
    context.tradingDate,
    phase.tradingDate,
    decisionContext.tradingDate,
  ].map(normalizeTradingDate));
  const asOfValues = unique([
    payload.asOf,
    payload.fetchedAt,
    payload.updatedAt,
    context.asOf,
    phase.asOf,
    decisionContext.asOf,
  ]);
  const decisionContextComplete = Boolean(
    text(decisionContext.generationId)
    && normalizeTradingDate(decisionContext.tradingDate)
    && text(decisionContext.asOf)
    && Number.isFinite(Date.parse(decisionContext.asOf)),
  );
  const complete = ids.length === 1
    && dates.length === 1
    && asOfValues.length === 1
    && Number.isFinite(Date.parse(asOfValues[0]))
    && decisionContextComplete;
  return {
    generationId: ids[0] || null,
    tradingDate: dates[0] || null,
    asOf: asOfValues[0] || null,
    aligned: complete,
    conflicts: {
      generationIds: ids.length > 1 ? ids : [],
      tradingDates: dates.length > 1 ? dates : [],
      asOfValues: asOfValues.length > 1 ? asOfValues : [],
    },
    sources: {
      decisionContext: {
        generationId: text(decisionContext.generationId) || null,
        tradingDate: normalizeTradingDate(decisionContext.tradingDate),
        asOf: text(decisionContext.asOf) || null,
        complete: decisionContextComplete,
      },
    },
  };
}

function bigCycleMatches(left, right) {
  const leftCycle = normalizeBigCycle(left && (left.label || left.key));
  const rightCycle = normalizeBigCycle(right && (right.label || right.key));
  return Boolean(leftCycle && rightCycle && leftCycle === rightCycle);
}

function bigCycleDetailsMatch(left, right) {
  const leftCycle = isObject(left) ? left : {};
  const rightCycle = isObject(right) ? right : {};
  return text(leftCycle.horizon) === text(rightCycle.horizon)
    && finite(leftCycle.windowDays) === finite(rightCycle.windowDays)
    && text(leftCycle.reasonCode) === text(rightCycle.reasonCode)
    && text(leftCycle.reason) === text(rightCycle.reason)
    && JSON.stringify(rows(leftCycle.evidence)) === JSON.stringify(rows(rightCycle.evidence))
    && JSON.stringify(leftCycle.window || null) === JSON.stringify(rightCycle.window || null);
}

function smallCycleMatches(left, right) {
  const leftKey = statusToken(left && left.key);
  const rightKey = statusToken(right && right.key);
  const leftLabel = text(left && left.label);
  const rightLabel = text(right && right.label);
  return Boolean(
    leftKey && rightKey && leftKey === rightKey
    && leftLabel && rightLabel && leftLabel === rightLabel,
  );
}

function inspectAuthoritativeDecisionChain(payload, options = {}) {
  const source = isObject(payload) ? payload : {};
  const chain = isObject(source.unifiedDecisionChain) ? source.unifiedDecisionChain : {};
  const bestPicks = isObject(source.bestPicks) ? source.bestPicks : {};
  const generation = generationSnapshot(source);
  const chainGeneration = isObject(chain.generation) ? chain.generation : {};
  const chainMarketStage = isObject(chain.marketStage) ? chain.marketStage : {};
  const authorization = isObject(chain.authorization) ? chain.authorization : {};
  const tradePermission = isObject(authorization.tradePermission) ? authorization.tradePermission : {};
  const positionPermission = isObject(authorization.positionPermission) ? authorization.positionPermission : {};
  const profitEffect = isObject(chain.profitEffect) ? chain.profitEffect : {};
  const theme = isObject(chain.theme) ? chain.theme : {};
  const stockMode = isObject(chain.stockMode) ? chain.stockMode : {};
  const chainSelectionContext = isObject(chain.stockSelectionContext) ? chain.stockSelectionContext : {};
  const result = isObject(chain.result) ? chain.result : {};
  const observationCandidates = isObject(chain.observationCandidates) ? chain.observationCandidates : {};
  const observationStocks = rows(observationCandidates.stocks);
  const observationCodes = observationStocks.map(codeOf).filter(Boolean);
  const observationPullbackCount = observationStocks.filter((stock) => (
    text(stock && stock.tierKey) === "limit_up_pullback_repair"
  )).length;
  const sourceCandidatesByCode = new Map(rows(source.candidates)
    .map((candidate) => [codeOf(candidate), candidate])
    .filter(([code]) => code));
  const sourcePreference = isObject(source.premarketModels && source.premarketModels.tradingStylePreference)
    ? source.premarketModels.tradingStylePreference : {};
  const sourcePersistentPermission = isObject(sourcePreference.persistentDirectionPermission)
    ? sourcePreference.persistentDirectionPermission : {};
  const sourcePersistentActivePaths = sourcePersistentPermission.screeningStatus === "allowed"
    ? unique(rows(sourcePersistentPermission.activePaths).map(text)) : [];
  const sourcePersistentCodesByPath = isObject(sourcePersistentPermission.eligibleCarrierCodesByPath)
    ? sourcePersistentPermission.eligibleCarrierCodesByPath : {};
  const sourceEffectAttribution = isObject(source.market && source.market.state && source.market.state.effectAttribution)
    ? source.market.state.effectAttribution : {};
  const sourceShortCoreScope = rows(sourceEffectAttribution.scopes)
    .find((scope) => text(scope && scope.key) === "short-core") || {};
  const sourceShortCoreCodes = new Set(text(sourceShortCoreScope.tone).toLowerCase() === "good"
    ? rows(sourceShortCoreScope.referenceGroups).flatMap((group) => listCodes(group && group.items)) : []);
  const sourceThemeDecision = isObject(source.themeLibrary && source.themeLibrary.mainThemeDecision)
    ? source.themeLibrary.mainThemeDecision : {};
  const sourceConfirmedFamily = isObject(sourceThemeDecision.confirmedFamily)
    && sourceThemeDecision.confirmedFamily.state === "confirmed"
    ? sourceThemeDecision.confirmedFamily : null;
  const sourceConfirmedMainAttack = isObject(sourceThemeDecision.mainAttackSubtheme)
    ? sourceThemeDecision.mainAttackSubtheme : null;
  const sourceThemeTokens = opportunityThemeTokens([sourceConfirmedFamily, sourceConfirmedMainAttack]);
  const sourceCarrierProfile = isObject(source.market && source.market.marketCapCarrier)
    ? source.market.marketCapCarrier : {};
  const sourcePreferredBuckets = sourceCarrierProfile.status === "confirmed"
    ? unique(rows(sourceCarrierProfile.preferredBucketKeys).map(text)) : [];
  const observationSourceAuthorityInvalid = observationStocks.some((stock) => {
    const code = codeOf(stock);
    const candidate = sourceCandidatesByCode.get(code);
    const primaryPath = text(stock && stock.profitPreference && stock.profitPreference.primaryPath);
    const candidateGenerationId = text(candidate && candidate.factorContext && candidate.factorContext.generationId);
    const candidateCarrier = isObject(candidate && candidate.marketCapCarrier) ? candidate.marketCapCarrier : {};
    return !candidate
      || !sourcePersistentActivePaths.includes(primaryPath)
      || !listCodes(sourcePersistentCodesByPath[primaryPath]).includes(code)
      || !sourceShortCoreCodes.has(code)
      || !sourceThemeTokens.length
      || currentThemeIntersection(candidate, sourceThemeTokens).matched !== true
      || sourceCarrierProfile.status !== "confirmed"
      || !sourcePreferredBuckets.length
      || !sourcePreferredBuckets.includes(text(candidateCarrier.bucketKey))
      || !text(chainGeneration.generationId)
      || candidateGenerationId !== text(chainGeneration.generationId);
  });
  const forbiddenObservationFields = [
    "positionAllocation", "canonicalAllocation", "position", "positionPct", "positionPercent",
    "positionLimit", "recommendedPosition", "suggestedPosition", "targetPosition", "allocation",
    "buy", "sell", "hold", "order", "orderIntent", "orderPlan", "tradePlan", "execution",
    "executionPlan", "tomorrowTradePlan", "action", "side", "quantity", "qty", "lots", "shares",
    "entry", "entryPrice", "buyPrice", "limitPrice", "canBuy", "allowBuy", "tradeAllowed",
    "executionAllowed",
  ];
  const allowedObservationFields = new Set([
    "rank", "tierKey", "tierLabel", "setupKey", "setupLabel", "setupEvidence", "code", "name",
    "path", "paths", "pathLabel", "theme", "role", "observationReason", "expectation",
    "postEntryNextDayExpectation", "entryConfirmation", "capitalPreference", "profitPreference",
    "environmentFit",
    "leadership", "hardGatePassed", "opportunityDataCompleteness", "shortTermOpportunityStructure",
    "riskNotes", "executionFeasibility", "marketCapFit", "missingConditions", "confirmationConditions",
    "reopenConditions", "cancelConditions", "opportunityScore", "observationOnly", "executable",
    "executionAuthority",
  ]);
  const allowedExecutionFeasibilityFields = new Set([
    "version", "authority", "status", "executableNow", "canGrantExecution", "onlyTightens",
    "riskPenalty", "slippageRisk", "blockers", "cautions", "evidence", "rule",
  ]);
  const observationFieldsInvalid = observationStocks.some((stock) => {
    const feasibility = isObject(stock.executionFeasibility) ? stock.executionFeasibility : {};
    return stock.observationOnly !== true
      || stock.executable !== false
      || stock.executionAuthority !== false
      || forbiddenObservationFields.some((key) => Object.prototype.hasOwnProperty.call(stock, key))
      || Object.keys(stock).some((key) => !allowedObservationFields.has(key))
      || !isObject(stock.executionFeasibility)
      || finite(feasibility.version) !== 1
      || feasibility.authority !== "unified_execution_feasibility_v1"
      || !["ready", "conditional", "blocked"].includes(text(feasibility.status))
      || feasibility.executableNow !== false
      || feasibility.canGrantExecution !== false
      || feasibility.onlyTightens !== true
      || feasibility.allowNew === true
      || feasibility.allowAdd === true
      || feasibility.canExecute === true
      || Object.keys(feasibility).some((key) => !allowedExecutionFeasibilityFields.has(key));
  });
  const observationTierInvalid = observationStocks.some((stock) => ![
    "limit_up_pullback_repair",
    "reopen_candidate",
    "path_representative",
    "hard_gate_failed",
  ].includes(String(stock && stock.tierKey || "")));
  const observationEnvironmentInvalid = observationStocks.some((stock) => {
    const environment = isObject(stock && stock.environmentFit) ? stock.environmentFit : {};
    return environment.status !== "matched"
      || environment.matched !== true
      || environment.generationAligned !== true
      || environment.marketEnvironmentKnown !== true
      || environment.activePathMatched !== true
      || environment.themeMatched !== true
      || !Array.isArray(environment.evidence)
      || environment.evidence.length === 0
      || environment.evidence.some((item) => typeof item !== "string" || !item.trim());
  });
  const observationPreferenceInvalid = observationStocks.some((stock) => {
    const capital = isObject(stock && stock.capitalPreference) ? stock.capitalPreference : {};
    const profit = isObject(stock && stock.profitPreference) ? stock.profitPreference : {};
    const marketCapFit = isObject(stock && stock.marketCapFit) ? stock.marketCapFit : {};
    return capital.status !== "confirmed_match"
      || capital.matched !== true
      || marketCapFit.status !== "confirmed_match"
      || profit.status !== "matched"
      || profit.matched !== true
      || !text(profit.primaryPath)
      || !rows(profit.matchedPaths).map(text).includes(text(profit.primaryPath));
  });
  const observationExpectationInvalid = observationStocks.some((stock) => {
    const expectation = isObject(stock && stock.expectation) ? stock.expectation : {};
    const label = typeof expectation.label === "string" ? expectation.label.trim() : "";
    const evidenceValid = Array.isArray(expectation.evidence)
      && expectation.evidence.length > 0
      && expectation.evidence.every((item) => typeof item === "string" && item.trim());
    const sourcesValid = Array.isArray(expectation.evidenceSources)
      && expectation.evidenceSources.length > 0
      && expectation.evidenceSources.every((item) => typeof item === "string" && item.trim());
    const allowedKeys = new Set(["status", "label", "evidence", "evidenceSources"]);
    const forbiddenPromise = /保证|必涨|稳赚|零风险|无风险|满仓|梭哈|下单|直接买|立即买|必须买|无脑打板/.test(label);
    return expectation.status !== "qualified"
      || !label
      || label !== text(stock.observationReason)
      || !evidenceValid
      || expectation.evidence[0].trim() !== label
      || !sourcesValid
      || forbiddenPromise
      || Object.keys(expectation).some((key) => !allowedKeys.has(key));
  });
  const observationDataCompletenessInvalid = observationStocks.some((stock) => {
    const completeness = isObject(stock && stock.opportunityDataCompleteness)
      ? stock.opportunityDataCompleteness : {};
    const evidence = isObject(completeness.evidence) ? completeness.evidence : {};
    return finite(completeness.version) !== 1
      || completeness.status !== "complete"
      || completeness.qualified !== true
      || completeness.opportunityEligible !== true
      || text(completeness.tradingDate) !== text(chainGeneration.tradingDate)
      || !Array.isArray(completeness.missingFields) || completeness.missingFields.length > 0
      || !Array.isArray(completeness.blockers) || completeness.blockers.length > 0
      || !Array.isArray(completeness.riskNotes)
      || completeness.fundFlowRequired !== false
      || !["price", "amount", "liquidityCapacity", "marketCap", "session"]
        .every((key) => isObject(evidence[key]) && evidence[key].usable === true)
      || !isObject(evidence.fundFlow) || evidence.fundFlow.required !== false;
  });
  const observationPostEntryExpectationInvalid = observationStocks.some((stock) => {
    const expectation = isObject(stock && stock.postEntryNextDayExpectation)
      ? stock.postEntryNextDayExpectation : {};
    const confirmation = isObject(stock && stock.entryConfirmation) ? stock.entryConfirmation : {};
    const preference = isObject(source.premarketModels && source.premarketModels.tradingStylePreference)
      ? source.premarketModels.tradingStylePreference : {};
    const preferencePaths = isObject(preference.paths) ? preference.paths : {};
    const canonicalPath = isObject(preferencePaths[text(stock.path)]) ? preferencePaths[text(stock.path)] : {};
    const stage = text(canonicalPath.stage).toLowerCase();
    const expectedDefinition = stock.hardGatePassed === true && text(confirmation.status) === "waiting_trigger"
      ? text(stock.tierKey) === "limit_up_pullback_repair"
        ? {
          key: "pullback_repair_premium",
          label: "修复延续 / 冲击前高",
          riskLabel: "修复失败或再度走弱",
        }
        : text(stock.path) === "boardEmotion"
          ? {
            key: "board_premium",
            label: /acceleration|climax/.test(stage)
              ? "先看溢价 / 更防分歧兑现" : "核心溢价 / 晋级验证",
            riskLabel: "分歧兑现或高标负反馈",
          }
          : text(stock.path) === "lowLaunch"
            ? {
              key: "launch_premium",
              label: "启动溢价 / 题材继续发酵",
              riskLabel: "冲高回落或首板失败",
            }
            : text(stock.path) === "highTrend"
              ? {
                key: "trend_premium",
                label: /acceleration/.test(stage)
                  ? "冲高溢价 / 更防兑现" : "趋势延续 / 再冲高",
                riskLabel: "趋势破位或低开兑现",
              }
              : null
      : null;
    const allowedKeys = new Set([
      "version", "status", "horizon", "premise", "key", "label", "riskLabel", "entryCondition",
      "invalidation", "basis", "pathStage", "probability", "calibrated", "observationOnly", "executionAuthority",
    ]);
    const conditionalInvalid = expectation.status === "conditional" && (
      !expectedDefinition
      || expectation.key !== expectedDefinition.key
      || expectation.label !== expectedDefinition.label
      || expectation.riskLabel !== expectedDefinition.riskLabel
      || expectation.premise !== "仅在明日确认条件满足后假设参与"
      || !stage || text(expectation.pathStage).toLowerCase() !== stage
      || typeof expectation.entryCondition !== "string" || !expectation.entryCondition.trim()
      || typeof expectation.invalidation !== "string" || !expectation.invalidation.trim()
      || typeof expectation.basis !== "string" || !expectation.basis.trim()
    );
    const unavailableInvalid = expectation.status === "unavailable" && (
      expectedDefinition !== null
      || expectation.key !== null
      || expectation.label !== "不适用（当前无买点）"
      || expectation.riskLabel !== "不预设上涨"
      || expectation.premise !== "买点确认未通过时不生成持有预期"
    );
    return finite(expectation.version) !== POST_ENTRY_NEXT_DAY_EXPECTATION_VERSION
      || !["conditional", "unavailable"].includes(text(expectation.status))
      || text(expectation.horizon) !== "entry_t_plus_1"
      || !text(expectation.label)
      || expectation.probability !== null
      || expectation.calibrated !== false
      || expectation.observationOnly !== true
      || expectation.executionAuthority !== false
      || Object.keys(expectation).some((key) => !allowedKeys.has(key))
      || conditionalInvalid
      || unavailableInvalid;
  });
  const observationEntryConfirmationInvalid = observationStocks.some((stock) => {
    const confirmation = isObject(stock && stock.entryConfirmation) ? stock.entryConfirmation : {};
    const status = text(confirmation.status);
    const type = text(confirmation.type);
    const expectedType = stock.hardGatePassed !== true
      ? null
      : text(stock.tierKey) === "limit_up_pullback_repair"
        ? "support_or_breakout"
        : text(stock.path) === "boardEmotion" ? "reseal_board"
          : text(stock.path) === "lowLaunch" ? "first_board_or_breakout"
            : text(stock.path) === "highTrend" ? "support_reclaim" : null;
    const allowedKeys = new Set([
      "version", "status", "type", "label", "reason", "avoid", "activated", "triggerConditions",
      "invalidation", "observationOnly", "executionAuthority",
    ]);
    const semanticMismatch = stock.hardGatePassed !== true
      ? status !== "blocked" || confirmation.type !== null
      : expectedType
        ? status !== "waiting_trigger" || typeof confirmation.type !== "string" || type !== expectedType
        : status !== "unavailable" || confirmation.type !== null;
    const postEntry = isObject(stock && stock.postEntryNextDayExpectation)
      ? stock.postEntryNextDayExpectation : {};
    const expectedLabels = {
      reseal_board: ["充分换手后的回封板", "回封板确认（当前未触发）"],
      support_or_breakout: ["承接转强 / 放量突破"],
      first_board_or_breakout: ["先锋首板 / 容量突破"],
      support_reclaim: ["回踩承接 / 重新转强"],
    };
    const label = typeof confirmation.label === "string" ? confirmation.label.trim() : "";
    const labelSemanticMismatch = status === "waiting_trigger"
      ? !expectedLabels[type] || !expectedLabels[type].includes(label)
      : status === "blocked"
        ? !["当前不可确认（成交额不足）", "当前不可确认（方向未通过）", "当前不可确认（硬门槛未过）"].includes(label)
        : !["买点确认待数据补足", "买点确认方式待识别"].includes(label);
    const stringFieldsValid = ["reason", "avoid", "invalidation"]
      .every((key) => typeof confirmation[key] === "string" && confirmation[key].trim());
    const triggerConditionsValid = Array.isArray(confirmation.triggerConditions)
      && confirmation.triggerConditions.length > 0
      && confirmation.triggerConditions.every((item) => typeof item === "string" && item.trim());
    return finite(confirmation.version) !== ENTRY_CONFIRMATION_VERSION
      || !["waiting_trigger", "blocked", "unavailable"].includes(status)
      || !label
      || !stringFieldsValid
      || confirmation.activated !== false
      || confirmation.observationOnly !== true
      || confirmation.executionAuthority !== false
      || (status === "waiting_trigger" && !triggerConditionsValid)
      || Object.keys(confirmation).some((key) => !allowedKeys.has(key))
      || typeof stock.hardGatePassed !== "boolean"
      || semanticMismatch
      || labelSemanticMismatch
      || (status === "waiting_trigger" ? postEntry.status !== "conditional" : postEntry.status !== "unavailable");
  });
  const resultStocks = rows(result.stocks);
  const selectedCodes = listCodes(result.selectedCodes);
  const stockCodes = resultStocks.map(codeOf).filter(Boolean);
  const relativeTotal = round2(resultStocks.reduce((sum, stock) => (
    sum + Math.max(0, finite(stock && stock.positionAllocation && stock.positionAllocation.relativeWeightPct) || 0)
  ), 0));
  const strictOrder = rows(chain.integrity && chain.integrity.strictOrder).map(text);
  const initialTotal = round2(resultStocks.reduce((sum, stock) => (
    sum + Math.max(0, finite(stock && stock.positionAllocation && stock.positionAllocation.initialPortfolioPct) || 0)
  ), 0));
  const ceilingTotal = round2(resultStocks.reduce((sum, stock) => (
    sum + Math.max(0, finite(stock && stock.positionAllocation && stock.positionAllocation.maximumPortfolioPct) || 0)
  ), 0));
  const allocationInvalid = resultStocks.some((stock) => {
    const allocation = isObject(stock && stock.positionAllocation) ? stock.positionAllocation : {};
    const relative = finite(allocation.relativeWeightPct);
    const initial = finite(allocation.initialPortfolioPct);
    const maximum = finite(allocation.maximumPortfolioPct);
    return relative === null || initial === null || maximum === null
      || relative < 0 || initial < 0 || maximum < 0 || initial > maximum;
  });
  const expectedInitial = finite(positionPermission.initialActivationPct);
  const expectedCeiling = finite(positionPermission.positionCeilingPct);
  const resultValueInvalid = resultStocks.some((stock) => (
    !codeOf(stock)
    || finite(stock && stock.participationValue && stock.participationValue.score) === null
    || finite(stock && stock.riskAdjustment && stock.riskAdjustment.score) === null
    || finite(stock && stock.riskAdjustedParticipationScore) === null
  ));
  const resultDataCompletenessInvalid = resultStocks.some((stock) => (
    !isObject(stock && stock.opportunityDataCompleteness)
    || stock.opportunityDataCompleteness.qualified !== true
    || rows(stock.opportunityDataCompleteness.missingFields).length > 0
  ));
  const selectionContextRequired = chainMarketStage.passed === true
    && authorization.passed === true
    && profitEffect.passed === true
    && theme.passed === true
    && stockMode.passed === true;
  const sourceMarketStage = stageProjection(source, generation);
  const phase = isObject(source.marketPhaseDetail) ? source.marketPhaseDetail : {};
  const phaseDecisionContext = isObject(phase.decisionContext) ? phase.decisionContext : {};
  const sourceSelectionContext = stockSelectionContextProjection(
    bestPicks,
    generation,
    phaseDecisionContext,
  );
  const chainPreviousEmotion = isObject(chainMarketStage.previousEmotionStage)
    ? chainMarketStage.previousEmotionStage : {};
  const sourcePreviousEmotion = sourceMarketStage.previousEmotionStage;
  const previousEmotionConsistent = chainPreviousEmotion.passed === sourcePreviousEmotion.passed
    && chainPreviousEmotion.available === sourcePreviousEmotion.available
    && normalizeTradingDate(chainPreviousEmotion.tradingDate) === sourcePreviousEmotion.tradingDate
    && normalizeTradingDate(chainPreviousEmotion.expectedTradingDate) === sourcePreviousEmotion.expectedTradingDate
    && text(chainPreviousEmotion.authority) === text(sourcePreviousEmotion.authority)
    && chainPreviousEmotion.exactCanonical === sourcePreviousEmotion.exactCanonical
    && chainPreviousEmotion.crossDayVerified === sourcePreviousEmotion.crossDayVerified
    && chainPreviousEmotion.cycleGenerationAligned === sourcePreviousEmotion.cycleGenerationAligned
    && text(chainPreviousEmotion.replayAudit && chainPreviousEmotion.replayAudit.mode)
      === text(sourcePreviousEmotion.replayAudit && sourcePreviousEmotion.replayAudit.mode)
    && normalizeTradingDate(chainPreviousEmotion.replayAudit && chainPreviousEmotion.replayAudit.targetTradingDate)
      === normalizeTradingDate(sourcePreviousEmotion.replayAudit && sourcePreviousEmotion.replayAudit.targetTradingDate);
  const marketStageConsistent = chainMarketStage.passed === sourceMarketStage.passed
    && bigCycleMatches(chainMarketStage.bigCycle, sourceMarketStage.bigCycle)
    && bigCycleDetailsMatch(chainMarketStage.bigCycle, sourceMarketStage.bigCycle)
    && smallCycleMatches(chainMarketStage.smallCycle, sourceMarketStage.smallCycle)
    && text(chainMarketStage.emotionStage && chainMarketStage.emotionStage.key)
      === text(sourceMarketStage.emotionStage && sourceMarketStage.emotionStage.key)
    && text(chainMarketStage.emotionStage && chainMarketStage.emotionStage.label)
      === text(sourceMarketStage.emotionStage && sourceMarketStage.emotionStage.label)
    && previousEmotionConsistent;
  const chainReasons = unique([
    Number(chain.version || 0) !== UNIFIED_DECISION_CHAIN_VERSION
      ? `统一决策链版本必须为v${UNIFIED_DECISION_CHAIN_VERSION}` : null,
    text(chain.authority) !== "canonical_stock_decision" ? "统一决策链权威来源不正确" : null,
    text(chain.method) !== "strict_sequential_fail_closed_v1" ? "统一决策链方法不正确" : null,
    !isObject(chain.integrity) || chain.integrity.ok !== true ? "统一决策链完整性未通过" : null,
    !isObject(chain.integrity) || chain.integrity.failClosed !== true ? "统一决策链未声明失败关闭" : null,
    !isObject(chain.integrity) || chain.integrity.observationCandidatesCannotGrantExecution !== true
      ? "统一决策链未声明观察候选禁止授予执行权" : null,
    !isObject(chain.integrity) || chain.integrity.postEntryExpectationConditionalOnly !== true
      ? "统一决策链未声明买后次日预期仅为条件路径" : null,
    !isObject(chain.integrity) || chain.integrity.entryConfirmationRequired !== true
      ? "统一决策链未声明机会股必须给出买点确认方式" : null,
    !isObject(chain.integrity) || chain.integrity.opportunityDataCompletenessRequired !== true
      ? "统一决策链未声明机会关键数据契约为必须项" : null,
    !isObject(chain.integrity) || chain.integrity.fundFlowCompletenessRequired !== false
      ? "统一决策链误将资金流设为机会完整性必填项" : null,
    JSON.stringify(strictOrder) !== JSON.stringify(STRICT_DECISION_ORDER)
      ? "统一决策链步骤顺序不完整" : null,
    finite(chain.integrity && chain.integrity.maxResultStocks) !== MAX_RESULT_STOCKS
      ? "统一决策链结果上限契约不正确" : null,
    isObject(chain.integrity)
      && Object.prototype.hasOwnProperty.call(chain.integrity, "maxPullbackObservationStocks")
      && finite(chain.integrity.maxPullbackObservationStocks) !== MAX_PULLBACK_OBSERVATION_STOCKS
      ? "统一决策链前板回撤上限契约不正确" : null,
    Boolean(chain.integrity && chain.integrity.selectionContextRequired) !== selectionContextRequired
      ? "统一决策链个股排序必需性标记不正确" : null,
    !generation.aligned ? "载荷代次不完整或存在冲突" : null,
    text(chainGeneration.generationId) !== text(generation.generationId)
      || normalizeTradingDate(chainGeneration.tradingDate) !== generation.tradingDate
      || text(chainGeneration.asOf) !== text(generation.asOf)
      || chainGeneration.aligned !== true
      ? "统一决策链与载荷不在同一代次" : null,
    authorization.passed === true && (
      tradePermission.allowNew !== true
      || expectedCeiling === null
      || expectedCeiling <= 0
      || expectedInitial === null
    ) ? "统一决策链开放授权与交易许可或仓位字段不一致" : null,
    authorization.passed !== true && tradePermission.allowNew === true
      ? "统一决策链关闭授权却仍声明允许新仓" : null,
    !marketStageConsistent ? "统一决策链市场阶段与当前权威证据不一致" : null,
    selectionContextRequired && (
      chainSelectionContext.passed !== true || sourceSelectionContext.passed !== true
    ) ? "进入个股层时排序上下文未通过权威周期校验" : null,
    finite(result.maxStocks) !== MAX_RESULT_STOCKS || selectedCodes.length > MAX_RESULT_STOCKS
      ? "统一决策链结果数量契约不正确" : null,
    finite(result.selectedCount) !== selectedCodes.length ? "统一决策链结果数量与代码不一致" : null,
    selectedCodes.join(",") !== stockCodes.join(",") ? "统一决策链结果代码与股票明细不一致" : null,
    allocationInvalid ? "统一决策链股票仓位字段不完整或非法" : null,
    resultValueInvalid ? "统一决策链结果股缺少参与价值、风险调整或最终评分" : null,
    resultDataCompletenessInvalid ? "统一决策链结果股未通过当日机会关键数据契约" : null,
    resultStocks.length && Math.abs(relativeTotal - 100) > 0.11
      ? "结果股相对权重合计不等于100%" : null,
    resultStocks.length && expectedInitial === null ? "结果股对应的初始仓位授权缺失" : null,
    resultStocks.length && expectedCeiling === null ? "结果股对应的仓位上限授权缺失" : null,
    resultStocks.length && expectedInitial !== null && Math.abs(initialTotal - expectedInitial) > 0.11
      ? "结果股初始仓位合计与授权不一致" : null,
    resultStocks.length && expectedCeiling !== null && Math.abs(ceilingTotal - expectedCeiling) > 0.11
      ? "结果股仓位上限合计与授权不一致" : null,
    (authorization.passed !== true || tradePermission.allowNew !== true) && selectedCodes.length
      ? "交易授权关闭但统一结果仍含股票" : null,
    observationCandidates.observationOnly !== true || observationCandidates.executionAuthority !== false
      ? "观察候选权限边界不正确" : null,
    observationCandidates.status === "blocked" && observationStocks.length > 0
      ? "观察池已阻断但仍携带股票" : null,
    finite(observationCandidates.maxStocks) !== MAX_RESULT_STOCKS
      || observationStocks.length > MAX_RESULT_STOCKS
      || new Set(observationCodes).size !== observationCodes.length
      ? "观察候选数量或代码契约不正确" : null,
    observationPullbackCount > MAX_PULLBACK_OBSERVATION_STOCKS
      ? "观察候选中的前板回撤超过2只上限" : null,
    finite(observationCandidates.selectedCount) !== observationCodes.length
      || listCodes(observationCandidates.selectedCodes).join(",") !== observationCodes.join(",")
      ? "观察候选数量与明细不一致" : null,
    observationFieldsInvalid ? "观察候选泄漏仓位、买点或执行权限" : null,
    observationTierInvalid ? "观察候选分层类型不在统一契约内" : null,
    observationEnvironmentInvalid ? "观察候选未通过当前环境与有效题材交集" : null,
    observationPreferenceInvalid ? "观察候选未同时匹配已确认赚钱效应和资金偏好" : null,
    observationSourceAuthorityInvalid ? "观察候选与源载荷的持续偏好、赚钱效应、题材或市值权威集合不一致" : null,
    observationExpectationInvalid ? "观察机会股看点不是合规的证据摘要" : null,
    observationDataCompletenessInvalid ? "观察机会股未通过当日关键数据契约" : null,
    observationPostEntryExpectationInvalid ? "观察机会股缺少合规的买后次日条件预期" : null,
    observationEntryConfirmationInvalid ? "观察机会股缺少合规的买点确认方式" : null,
  ]);
  const bestPickCodes = rows(bestPicks.picks).map(codeOf).filter(Boolean);
  const decisionPoolCodes = rows(bestPicks.decisionPool).map(codeOf).filter(Boolean);
  const selectedSet = new Set(selectedCodes);
  const resultStockByCode = new Map(resultStocks.map((stock) => [codeOf(stock), stock]));
  const projectedPickGateInvalid = rows(bestPicks.picks).some((pick) => (
    hardGateReasons(pick, selectedSet).length > 0
  ));
  const projectedAllocationInvalid = [
    ...rows(bestPicks.picks),
    ...rows(bestPicks.decisionPool),
  ].some((pick) => {
    const resultStock = resultStockByCode.get(codeOf(pick));
    return !resultStock
      || !canonicalAllocationMatches(pick && pick.canonicalAllocation, resultStock.positionAllocation)
      || !canonicalAllocationMatches(pick && pick.positionAllocation, resultStock.positionAllocation);
  });
  const legacyExecutionPositionLeaked = [
    ...rows(bestPicks.picks),
    ...rows(bestPicks.decisionPool),
  ].some(hasLegacyExecutionPosition);
  const unauthorizedScenarioCode = rows(bestPicks.scenarioPlans)
    .map((plan) => codeOf(plan && plan.candidate))
    .find((code) => code && !selectedSet.has(code));
  const scenarioAllocationInvalid = rows(bestPicks.scenarioPlans)
    .map((plan) => isObject(plan && plan.candidate) ? plan.candidate : null)
    .filter(Boolean)
    .some((candidate) => {
      const resultStock = resultStockByCode.get(codeOf(candidate));
      return !resultStock
        || hasLegacyExecutionPosition(candidate)
        || !canonicalAllocationMatches(candidate.canonicalAllocation, resultStock.positionAllocation)
        || !canonicalAllocationMatches(candidate.positionAllocation, resultStock.positionAllocation);
    });
  const projectionReasons = unique([
    text(bestPicks.selectionAuthority) !== SELECTION_AUTHORITY ? "bestPicks未由统一决策链授权" : null,
    finite(bestPicks.decisionChainVersion) !== UNIFIED_DECISION_CHAIN_VERSION
      ? "bestPicks统一链版本不匹配" : null,
    bestPickCodes.join(",") !== selectedCodes.join(",") ? "bestPicks超出统一决策链结果" : null,
    decisionPoolCodes.join(",") !== selectedCodes.join(",")
      ? "bestPicks.decisionPool仍保留统一结果之外的执行候选" : null,
    projectedPickGateInvalid ? "bestPicks结果股未通过价格或评分完整性复核" : null,
    projectedAllocationInvalid ? "bestPicks正式仓位没有逐股镜像统一决策链" : null,
    legacyExecutionPositionLeaked ? "bestPicks仍泄漏旧仓位为执行字段" : null,
    unauthorizedScenarioCode ? "bestPicks情景计划仍含统一结果之外的执行候选" : null,
    scenarioAllocationInvalid ? "bestPicks情景计划仓位没有逐股镜像统一决策链" : null,
  ]);
  const chainValid = chainReasons.length === 0;
  const projectionValid = projectionReasons.length === 0;
  const requireBestPicksProjection = options.requireBestPicksProjection === true;
  return {
    valid: chainValid && (!requireBestPicksProjection || projectionValid),
    chainValid,
    projectionValid,
    reasons: unique([...chainReasons, ...(requireBestPicksProjection ? projectionReasons : [])]),
    chainReasons,
    projectionReasons,
    generation,
    chain,
    authorization,
    result,
    selectedCodes,
    allocation: {
      relativeTotalPct: relativeTotal,
      initialTotalPct: initialTotal,
      maximumTotalPct: ceilingTotal,
    },
  };
}

function stockSelectionContextProjection(bestPicks, generation, phaseDecisionContext = {}) {
  const context = isObject(bestPicks && bestPicks.selectionContext)
    ? bestPicks.selectionContext : {};
  const canonicalContext = isObject(phaseDecisionContext) ? phaseDecisionContext : {};
  const generationId = text(context.generationId);
  const tradingDate = normalizeTradingDate(context.tradingDate);
  const asOf = text(context.asOf);
  const authorityAccepted = text(context.authority) === STOCK_SELECTION_CONTEXT_AUTHORITY;
  const generationAligned = Boolean(
    generation.aligned
    && generationId
    && tradingDate
    && asOf
    && generationId === generation.generationId
    && tradingDate === generation.tradingDate
    && asOf === generation.asOf
  );
  const canonicalContextGenerationAligned = Boolean(
    generation.aligned
    && text(canonicalContext.generationId) === generation.generationId
    && normalizeTradingDate(canonicalContext.tradingDate) === generation.tradingDate
    && text(canonicalContext.asOf) === generation.asOf
  );
  const cycleContextAligned = canonicalContextGenerationAligned
    && bigCycleMatches(context.bigCycle, canonicalContext.bigCycle)
    && smallCycleMatches(context.smallCycle, canonicalContext.smallCycle);
  const decisionRows = rows(bestPicks && bestPicks.decisionPool).length
    ? rows(bestPicks.decisionPool) : rows(bestPicks && bestPicks.picks);
  const factorContextsAligned = decisionRows.every((pick) => {
    const factorContext = isObject(pick && pick.factorContext) ? pick.factorContext : {};
    return text(factorContext.authority) === STOCK_SELECTION_CONTEXT_AUTHORITY
      && text(factorContext.generationId) === generation.generationId
      && normalizeTradingDate(factorContext.tradingDate) === generation.tradingDate
      && text(factorContext.asOf) === generation.asOf
      && bigCycleMatches(factorContext.bigCycle, context.bigCycle)
      && smallCycleMatches(factorContext.smallCycle, context.smallCycle)
      && bigCycleMatches(factorContext.bigCycle, canonicalContext.bigCycle)
      && smallCycleMatches(factorContext.smallCycle, canonicalContext.smallCycle);
  });
  const factorContextRecomputed = context.factorContextRecomputed === true;
  const factorEngineAuthority = text(
    bestPicks && bestPicks.factorEngineAuthority || context.factorEngineAuthority,
  );
  const factorEngineVersion = finite(
    bestPicks && bestPicks.factorEngineVersion || context.factorEngineVersion,
  );
  const factorEngineAccepted = factorEngineAuthority === STOCK_FACTOR_AUTHORITY
    && factorEngineVersion === STOCK_FACTOR_VERSION;
  const factorDecisionsAligned = decisionRows.every((pick) => {
    const factorDecision = isObject(pick && pick.factorDecision) ? pick.factorDecision : {};
    return text(factorDecision.authority) === STOCK_FACTOR_AUTHORITY
      && finite(factorDecision.version) === STOCK_FACTOR_VERSION;
  });
  const passed = context.passed === true
    && authorityAccepted
    && generationAligned
    && cycleContextAligned
    && factorContextRecomputed
    && factorContextsAligned
    && factorEngineAccepted
    && factorDecisionsAligned;
  return {
    status: passed ? "passed" : "blocked",
    passed,
    authority: text(context.authority) || null,
    generationId: generationId || null,
    tradingDate: tradingDate || null,
    asOf: asOf || null,
    bigCycle: isObject(context.bigCycle) ? { ...context.bigCycle } : null,
    smallCycle: isObject(context.smallCycle) ? { ...context.smallCycle } : null,
    factorContextRecomputed,
    factorContextsAligned,
    factorEngineAuthority: factorEngineAuthority || null,
    factorEngineVersion,
    factorEngineAccepted,
    factorDecisionsAligned,
    canonicalContextGenerationAligned,
    cycleContextAligned,
    blockers: unique([
      context.passed !== true ? "个股排序没有通过统一周期上下文" : null,
      !authorityAccepted ? "个股排序上下文不是权威市场阶段" : null,
      !generationAligned ? "个股排序上下文与当前决策代次不一致" : null,
      !canonicalContextGenerationAligned ? "权威市场阶段上下文与当前决策代次不一致" : null,
      canonicalContextGenerationAligned && !cycleContextAligned
        ? "个股排序的大周期或小周期与权威市场阶段不一致" : null,
      !factorContextRecomputed ? "候选个股因子未按统一周期上下文重算" : null,
      !factorContextsAligned ? "候选个股因子上下文与统一周期不一致" : null,
      !factorEngineAccepted ? "个股评分未由统一因子引擎生成" : null,
      factorEngineAccepted && !factorDecisionsAligned ? "候选股仍含旧个股评分结果" : null,
    ]),
    rule: "个股因子只能在同代权威大周期和小周期生成后计算；旧cycle/subPhase不得授予执行资格",
  };
}

function previousEmotionStageProjection(payload, generationInput = null) {
  const cycle = isObject(payload.emotionCycle) ? payload.emotionCycle
    : isObject(payload.premarketModels && payload.premarketModels.emotionCycle)
      ? payload.premarketModels.emotionCycle : {};
  const generation = isObject(generationInput) ? generationInput : generationSnapshot(payload);
  const previous = isObject(cycle.previous) ? cycle.previous : {};
  const current = isObject(cycle.current) ? cycle.current : {};
  const quality = isObject(cycle.dataQuality) ? cycle.dataQuality : {};
  const replayAudit = isObject(previous.replayAudit) ? previous.replayAudit : {};
  const expectedTradingDate = normalizeTradingDate(quality.expectedPreviousTradingDate);
  const tradingDate = normalizeTradingDate(previous.tradingDate);
  const cycleTradingDate = normalizeTradingDate(cycle.currentTradingDate || cycle.tradingDate);
  const authority = text(previous.authority || quality.previousStateAuthority || previous.source);
  const source = text(previous.source);
  const exactCanonical = previous.exactCanonical === true;
  const replayAuthority = authority === "canonical_exact_closing_replay";
  const deterministicReplayModes = new Set([
    "exact_closing_single_day_bootstrap",
    "exact_closing_recursive_cross_day",
    "exact_closing_t2_without_known_state",
  ]);
  const replayTargetAligned = normalizeTradingDate(replayAudit.targetTradingDate) === expectedTradingDate;
  const deterministicReplay = previous.replayed === true
    && deterministicReplayModes.has(text(replayAudit.mode))
    && replayAudit.failClosedOnUnknownCurrent === true
    && replayTargetAligned;
  const directCanonicalAuthority = ["exact_t1_emotion_cycle", "canonical_exact_closing_state"]
    .includes(authority)
    && ["exact_t1_emotion_cycle", "canonical_exact_closing_state", ""]
      .includes(source);
  const authorityAccepted = exactCanonical && (
    replayAuthority && deterministicReplay
    || directCanonicalAuthority
  );
  const exactPreviousTradingDay = quality.exactPreviousTradingDay === true
    && Boolean(expectedTradingDate && tradingDate && expectedTradingDate === tradingDate);
  const crossDayVerified = current.crossDayVerified === true || cycle.crossDayVerified === true;
  const cycleGenerationAligned = Boolean(
    generation.aligned
    && text(cycle.generationId) === generation.generationId
    && cycleTradingDate === generation.tradingDate
    && text(cycle.asOf) === generation.asOf
  );
  const available = previous.available === true;
  const passed = available
    && exactCanonical
    && exactPreviousTradingDay
    && authorityAccepted
    && crossDayVerified
    && cycleGenerationAligned;
  const blockers = unique([
    !available ? "T-1权威情绪状态不可用" : null,
    available && !expectedTradingDate ? "T-1预期交易日缺失" : null,
    available && expectedTradingDate && tradingDate !== expectedTradingDate
      ? `T-1情绪日期不匹配：期望${expectedTradingDate}，实际${tradingDate || "缺失"}` : null,
    available && !exactCanonical ? "T-1情绪未声明精确canonical收盘身份" : null,
    available && !authorityAccepted ? `T-1情绪来源不具备收盘权威：${authority || "缺失"}` : null,
    available && replayAuthority && !deterministicReplay
      ? "T-1回放缺少确定性模式、目标交易日或失败关闭审计" : null,
    available && !crossDayVerified ? "当前情绪状态未通过T-1跨日验证" : null,
    available && !cycleGenerationAligned ? "情绪周期与当前决策代次、交易日或asOf不一致" : null,
  ]);
  return {
    status: passed ? "passed" : "blocked",
    passed,
    available,
    key: text(previous.key, "unknown"),
    label: text(previous.label, "T-1情绪待确认"),
    tradingDate,
    expectedTradingDate,
    authority: authority || null,
    source: source || null,
    exactCanonical,
    exactPreviousTradingDay,
    crossDayVerified,
    cycleGenerationAligned,
    replayed: previous.replayed === true,
    replayAudit: isObject(previous.replayAudit) ? { ...previous.replayAudit } : null,
    divergenceIntensity: isObject(previous.divergenceIntensity) ? { ...previous.divergenceIntensity } : null,
    divergenceQuality: isObject(previous.divergenceQuality) ? { ...previous.divergenceQuality } : null,
    supportState: isObject(previous.supportState) ? { ...previous.supportState } : null,
    blockers,
    rule: "只接受精确上一交易日、同版本完整收盘canonical状态或同引擎确定性回放",
  };
}

function stageProjection(payload, generation) {
  const phase = isObject(payload.marketPhaseDetail) ? payload.marketPhaseDetail : {};
  const context = isObject(phase.decisionContext) ? phase.decisionContext : {};
  const bigCycle = isObject(context.bigCycle) ? context.bigCycle : {};
  const transition = isObject(context.transition)
    ? context.transition
    : isObject(phase.transition) ? phase.transition : {};
  const smallCycle = isObject(context.smallCycle) ? context.smallCycle : {};
  const emotionStage = isObject(context.emotionStage) ? context.emotionStage : {};
  const canonicalBigKey = normalizeBigCycleKey(bigCycle.key || bigCycle.label);
  const canonicalBigLabel = normalizeBigCycle(bigCycle.key || bigCycle.label);
  const fiveDayWindow = isObject(bigCycle.window) ? bigCycle.window : {};
  const fiveDayObservations = rows(fiveDayWindow.observations);
  const fiveDayGeneration = isObject(bigCycle.generationContext) ? bigCycle.generationContext : {};
  const fiveDayWindowReady = text(bigCycle.horizon) === "rolling_5_trading_days"
    && finite(bigCycle.windowDays) === 5
    && fiveDayWindow.status === "available"
    && fiveDayObservations.length === 5
    && fiveDayObservations.every((item) => item && item.complete === true)
    && normalizeTradingDate(fiveDayObservations.at(-1) && fiveDayObservations.at(-1).tradingDate)
      === generation.tradingDate
    && text(fiveDayGeneration.generationId) === generation.generationId
    && normalizeTradingDate(fiveDayGeneration.tradingDate) === generation.tradingDate
    && text(fiveDayGeneration.asOf) === generation.asOf
    && Boolean(text(bigCycle.reason) && rows(bigCycle.evidence).length);
  const bigAvailable = Boolean(canonicalBigKey && canonicalBigLabel)
    && !isUnavailable(`${bigCycle.key || ""} ${bigCycle.label || ""} ${bigCycle.status || ""}`)
    && fiveDayWindowReady;
  const smallAvailable = Boolean(text(smallCycle.key || smallCycle.label))
    && !isUnavailable(`${smallCycle.key || ""} ${smallCycle.label || ""} ${smallCycle.status || ""}`);
  const previousEmotionStage = previousEmotionStageProjection(payload, generation);
  const passed = generation.aligned && bigAvailable && smallAvailable && previousEmotionStage.passed;
  const blockers = unique([
    !generation.aligned ? "市场阶段数据存在跨代或跨交易日冲突" : null,
    !bigAvailable ? "大周期不可用或不属于统一五态枚举" : null,
    canonicalBigKey && canonicalBigLabel && !fiveDayWindowReady
      ? "大周期缺少同代、完整的五日收盘情绪窗口" : null,
    !smallAvailable ? "小周期不可用" : null,
    ...previousEmotionStage.blockers,
  ]);
  return {
    status: passed ? "passed" : "blocked",
    passed,
    bigCycle: {
      key: canonicalBigKey || "unavailable",
      label: canonicalBigLabel || "大周期待确认",
      status: text(bigCycle.status, bigAvailable ? "available" : "unavailable"),
      source: text(bigCycle.source),
      horizon: text(bigCycle.horizon),
      windowDays: finite(bigCycle.windowDays),
      window: fiveDayWindowReady ? { ...fiveDayWindow } : null,
      reasonCode: text(bigCycle.reasonCode),
      reason: text(bigCycle.reason),
      evidence: rows(bigCycle.evidence).map((item) => text(item)).filter(Boolean),
      generationContext: isObject(bigCycle.generationContext) ? { ...bigCycle.generationContext } : null,
      calibrated: bigCycle.calibrated === true,
    },
    transition: {
      key: text(transition.key, "none"),
      label: text(transition.label, "无周期切换"),
      status: text(transition.status, "not_active"),
      from: text(transition.from),
      to: text(transition.to),
      observationOnly: true,
    },
    smallCycle: {
      key: text(smallCycle.key, "unavailable"),
      label: text(smallCycle.label, "小周期待确认"),
      status: text(smallCycle.status, smallAvailable ? "available" : "unavailable"),
      source: text(smallCycle.source),
    },
    emotionStage: {
      key: text(emotionStage.key, "unavailable"),
      label: text(emotionStage.label, "情绪阶段待确认"),
      status: text(emotionStage.status, "unavailable"),
      observationOnly: emotionStage.observationOnly !== false,
      divergenceIntensity: isObject(emotionStage.divergenceIntensity)
        ? { ...emotionStage.divergenceIntensity } : null,
      divergenceQuality: isObject(emotionStage.divergenceQuality)
        ? { ...emotionStage.divergenceQuality } : null,
      supportState: isObject(emotionStage.supportState)
        ? { ...emotionStage.supportState } : null,
    },
    previousEmotionStage,
    blockers,
    rule: "大周期与小周期分别计算、同时可用且T-1权威情绪通过；三者不得互相覆盖或用旧口径替代",
  };
}

function permissionLayer(key, label, allow, status, reasons, extra = {}) {
  return {
    key,
    label,
    allow: allow === true ? true : allow === false ? false : null,
    status: text(status, allow === true ? "allowed" : allow === false ? "blocked" : "unknown"),
    reasons: unique(reasons),
    ...extra,
  };
}

function numericRange(value) {
  if (Array.isArray(value)) {
    const numbers = value.map(finite).filter((item) => item !== null && item >= 0 && item <= 100);
    if (numbers.length >= 2) return [Math.min(...numbers), Math.max(...numbers)];
    if (numbers.length === 1) return [0, numbers[0]];
  }
  const matches = text(value).match(/\d+(?:\.\d+)?/g);
  if (!matches || !matches.length) return null;
  const numbers = matches.map(Number).filter((item) => Number.isFinite(item) && item >= 0 && item <= 100);
  if (!numbers.length) return null;
  return numbers.length >= 2 ? [Math.min(...numbers), Math.max(...numbers)] : [0, numbers[0]];
}

function buildAuthorization(payload, premarketGate, marketStage) {
  const market = isObject(payload.market) ? payload.market : {};
  const marketState = isObject(market.state) ? market.state : {};
  const models = isObject(payload.premarketModels) ? payload.premarketModels : {};
  const indexPermission = isObject(models.indexCycleRegime && models.indexCycleRegime.positionPermission)
    ? models.indexCycleRegime.positionPermission : {};
  const tradeWindow = isObject(marketState.tradeWindow) ? marketState.tradeWindow : {};
  const emotionPermission = isObject(payload.emotionCycle && payload.emotionCycle.executionPermission)
    ? payload.emotionCycle.executionPermission : {};
  const stylePermission = isObject(models.tradingStylePreference && models.tradingStylePreference.directionPermission)
    ? models.tradingStylePreference.directionPermission : {};
  const gate = isObject(premarketGate) ? premarketGate : {};

  const emotionStatus = statusToken(emotionPermission.status);
  const emotionConditional = emotionPermission.conditionalAfterSupport === true || emotionPermission.conditional === true;
  const emotionImmediate = emotionPermission.immediateEntry === true || emotionPermission.immediate === true;
  const emotionAllowed = emotionStatus === "blocked" ? false
    : emotionImmediate || emotionConditional ? true : null;
  const styleStatus = statusToken(stylePermission.executionStatus);
  const styleAllowed = ["allowed", "conditional"].includes(styleStatus) ? true
    : styleStatus ? false : null;
  const premarketMode = statusToken(gate.executionMode);
  const premarketAllowed = gate.blocked === true || premarketMode === "blocked" ? false
    : gate.blocked === false && premarketMode ? true : null;

  const layers = [
    permissionLayer("market_stage", "市场阶段", marketStage.passed, marketStage.status, marketStage.blockers),
    permissionLayer("index", "指数交易许可", indexPermission.allowNew, indexPermission.key, indexPermission.reasons, {
      allowAdd: indexPermission.allowAdd === true,
      ceiling: text(indexPermission.ceiling) || null,
      positionRangePct: numericRange(indexPermission.positionRangePct),
    }),
    permissionLayer("trade_window", "短线交易窗口", tradeWindow.allowNew, tradeWindow.key, [tradeWindow.summary], {
      allowAdd: tradeWindow.allowAdd === true,
    }),
    permissionLayer("emotion", "情绪交易许可", emotionAllowed, emotionPermission.status, [emotionPermission.label, ...(rows(emotionPermission.reasons))], {
      immediateEntry: emotionImmediate,
      conditionalAfterSupport: emotionConditional,
    }),
    permissionLayer("style", "股票模式载体许可", styleAllowed, stylePermission.executionStatus, [stylePermission.executionLabel, ...(rows(stylePermission.reasons))]),
    permissionLayer("premarket_intersection", "盘前授权交集", premarketAllowed, gate.executionMode, gate.reasons),
  ];
  const rejected = layers.filter((layer) => layer.allow !== true);
  const allowed = rejected.length === 0;
  const conditional = allowed && (
    emotionConditional
    || styleStatus === "conditional"
    || premarketMode === "conditional_after_support"
    || statusToken(indexPermission.key).includes("conditional")
  );
  const range = numericRange(indexPermission.positionRangePct);
  const positionCeilingPct = allowed && range ? range[1] : 0;
  const activationFraction = allowed ? conditional ? 1 / 3 : 1 : 0;
  const initialActivationPct = round2(positionCeilingPct * activationFraction);
  const reasons = unique(rejected.flatMap((layer) => (
    layer.reasons.length ? layer.reasons : [`${layer.label}未明确开放`]
  )));
  const tradeValue = !allowed || positionCeilingPct <= 0
    ? { key: "none", label: "无交易价值", status: "blocked" }
    : conditional || positionCeilingPct <= 20
      ? { key: "exploratory", label: "试错价值", status: "conditional" }
      : positionCeilingPct <= 50
        ? { key: "selective", label: "精选参与价值", status: "allowed" }
        : { key: "proactive", label: "主动参与价值", status: "allowed" };

  return {
    status: allowed ? conditional ? "conditional" : "allowed" : "blocked",
    passed: allowed && positionCeilingPct > 0,
    tradePermission: {
      status: allowed ? conditional ? "conditional" : "allowed" : "blocked",
      allowNew: allowed && positionCeilingPct > 0,
      allowAdd: allowed && !conditional && layers.filter((item) => item.key === "index" || item.key === "trade_window").every((item) => item.allowAdd === true),
      reasons,
    },
    tradeValue: {
      ...tradeValue,
      calibrated: false,
      numericScore: null,
      basis: "只由市场阶段与权限交集决定，不读取个股分数或赚钱效应分数",
    },
    positionPermission: {
      status: allowed && positionCeilingPct > 0 ? "available" : "blocked",
      sourceRangePct: range,
      positionCeilingPct,
      activationFraction: round2(activationFraction),
      initialActivationPct,
      addPermission: allowed && !conditional,
      rule: conditional
        ? "条件许可仅启用总仓位上限的1/3，后续确认后才能加仓"
        : allowed ? "明确许可按仓位上限执行，个股与价格层仍可继续收紧" : "权限关闭时仓位为0%",
    },
    layers,
    reasons,
    rule: "所有权威权限取交集；任一层未知或关闭均失败关闭",
  };
}

function effectScope(payload, key) {
  const scopes = rows(payload.market && payload.market.state && payload.market.state.effectAttribution
    && payload.market.state.effectAttribution.scopes);
  return scopes.find((item) => item && item.key === key) || null;
}

function scopeCodes(scope) {
  return unique(rows(scope && scope.referenceGroups).flatMap((group) => listCodes(group && group.items)));
}

function positiveScopeCodes(scope) {
  return unique(rows(scope && scope.referenceGroups)
    .filter((group) => !["bad", "blocked", "negative", "unavailable"].includes(statusToken(group && group.tone)))
    .flatMap((group) => listCodes(group && group.items)));
}

function marketCapCarrierRows(payload) {
  const source = isObject(payload) ? payload : {};
  const bestPicks = isObject(source.bestPicks) ? source.bestPicks : {};
  return [
    ...rows(source.candidates),
    ...rows(bestPicks.decisionPool),
    ...rows(bestPicks.picks),
  ];
}

function marketCapOpportunityGate(payload, incomingCodes) {
  const source = isObject(payload) ? payload : {};
  const profile = isObject(payload && payload.market && payload.market.marketCapCarrier)
    ? payload.market.marketCapCarrier : null;
  const inputCodes = unique(incomingCodes);
  const preferredBucketKeys = profile ? unique(profile.preferredBucketKeys) : [];
  const confirmed = Boolean(profile && profile.status === "confirmed" && preferredBucketKeys.length);
  const stockByCode = new Map(marketCapCarrierRows(payload)
    .map((stock) => [codeOf(stock), stock])
    .filter(([code]) => code));
  const eligibleCodes = [];
  const excludedCodes = [];
  const unverifiedCodes = [];
  const evidenceByCode = {};
  inputCodes.forEach((code) => {
    const stock = stockByCode.get(code);
    const completeness = evaluateOpportunityDataCompleteness(stock, {
      tradingDate: text(source.tradingDate || source.generationContext && source.generationContext.tradingDate),
    });
    const marketCapEvidence = isObject(completeness.evidence && completeness.evidence.marketCap)
      ? completeness.evidence.marketCap : {};
    evidenceByCode[code] = marketCapEvidence;
    const bucketKey = text(marketCapEvidence.bucketKey);
    // 市场市值偏好 mixed/unavailable 只是不做桶匹配，
    // 不等于个股自身可以没有可追溯总市值。
    if (marketCapEvidence.usable !== true || !bucketKey || bucketKey === "unknown") {
      unverifiedCodes.push(code);
      return;
    }
    if (!confirmed || preferredBucketKeys.includes(bucketKey)) eligibleCodes.push(code);
    else excludedCodes.push(code);
  });
  return {
    status: confirmed ? "applied" : profile && profile.status === "mixed" ? "soft_observation" : "unavailable",
    applied: confirmed,
    inputCodes,
    eligibleCodes,
    excludedCodes,
    unverifiedCodes,
    preferredBucketKeys,
    evidenceByCode,
    reason: confirmed
      ? text(profile.reason, "已按当日确认的市值赚钱效应缩减机会候选。")
      : text(profile && profile.reason, "市值赚钱效应偏好未确认，不缩减已知市值的机会候选。"),
    rule: "市值偏好confirmed时才做桶匹配；mixed/unavailable不硬删已知桶。但个股总市值桶始终必须已知且可追溯，缺失时只留身份锚点/诊断，不改写情绪核心身份。",
  };
}

function buildProfitEffect(payload) {
  const marketScope = effectScope(payload, "market");
  const shortCore = effectScope(payload, "short-core");
  const tradeable = effectScope(payload, "tradeable");
  const attribution = isObject(payload.market && payload.market.state && payload.market.state.effectAttribution)
    ? payload.market.state.effectAttribution : {};
  const profitMap = isObject(attribution.profitMap) ? attribution.profitMap : {};
  const strongGroupCodes = unique(rows(profitMap.groups)
    .filter((group) => ["strong", "profit", "confirmed"].includes(statusToken(group && group.status)))
    .flatMap((group) => listCodes(group && group.items)));
  const baseEligibleCodes = unique([...positiveScopeCodes(shortCore), ...strongGroupCodes]);
  const marketCapGate = marketCapOpportunityGate(payload, baseEligibleCodes);
  const eligibleCodes = marketCapGate.eligibleCodes;
  const blockedLabel = /暂无|无合格|无赚钱|亏钱|缺失|待确认/.test(text(shortCore && shortCore.label));
  const blockedTone = ["bad", "blocked", "unavailable"].includes(statusToken(shortCore && shortCore.tone));
  const passed = Boolean(shortCore) && !blockedLabel && !blockedTone && eligibleCodes.length > 0;
  return {
    status: passed ? "passed" : "blocked",
    passed,
    market: marketScope ? {
      label: text(marketScope.label),
      score: finite(marketScope.score),
      tone: text(marketScope.tone),
      summary: text(marketScope.summary),
    } : null,
    shortCore: shortCore ? {
      label: text(shortCore.label),
      score: finite(shortCore.score),
      tone: text(shortCore.tone),
      summary: text(shortCore.summary),
      eligibleCodes,
      baseEligibleCodes,
    } : null,
    tradeable: tradeable ? {
      label: text(tradeable.label),
      score: finite(tradeable.score),
      tone: text(tradeable.tone),
      summary: text(tradeable.summary),
      eligibleCodes: scopeCodes(tradeable),
      downstreamAuditOnly: true,
    } : null,
    eligibleCodes,
    baseEligibleCodes,
    marketCapCarrier: isObject(payload.market && payload.market.marketCapCarrier)
      ? payload.market.marketCapCarrier : null,
    marketCapOpportunityGate: marketCapGate,
    blockers: passed ? [] : [shortCore
      ? eligibleCodes.length ? `短线赚钱效应未通过：${text(shortCore.label, "状态不允许")}`
        : baseEligibleCodes.length && marketCapGate.unverifiedCodes.length === baseEligibleCodes.length
          ? "短线具名载体的个股总市值桶均未可追溯"
          : baseEligibleCodes.length && marketCapGate.applied ? "当日确认的市值赚钱效应与短线具名载体没有交集"
          : "短线赚钱效应没有具名载体"
      : "短线核心赚钱效应证据缺失"],
    rule: "只允许短线核心赚钱效应中个股总市值桶已知且可追溯的具名载体进入题材层；市值偏好confirmed时继续取交集，mixed/unavailable不做桶偏好硬剔除；全市场上涨和下游可交易结果都不能反向定义本层",
  };
}

function directionNames(flow) {
  const direction = isObject(flow && flow.direction) ? flow.direction : {};
  const eligible = rows(direction.eligibleDirections);
  const primary = isObject(direction.primary) ? direction.primary : {};
  return unique([
    ...eligible.map((item) => item && (item.displayName || item.name || item.family)),
    primary.displayName || primary.name || primary.family,
  ]);
}

function buildThemeGate(premarketFlow, premarketGate, incomingCodes) {
  const gate = isObject(premarketGate) ? premarketGate : {};
  const directionCodes = listCodes(gate.directionEligibleCodes);
  const directionSet = new Set(directionCodes);
  const eligibleCodes = incomingCodes.filter((code) => directionSet.has(code));
  const names = directionNames(premarketFlow);
  const passed = directionCodes.length > 0 && names.length > 0 && eligibleCodes.length > 0;
  return {
    status: passed ? "passed" : "blocked",
    passed,
    themes: names,
    directionEligibleCodes: directionCodes,
    eligibleCodes,
    blockers: passed ? [] : [
      !names.length ? "当前没有通过确认的题材" : null,
      !directionCodes.length ? "题材层没有合格股票载体" : null,
      directionCodes.length && !eligibleCodes.length ? "赚钱效应载体与合格题材没有交集" : null,
    ].filter(Boolean),
    rule: "先确认题材，再允许题材内股票进入模式层",
  };
}

function buildStockMode(payload, premarketFlow, premarketGate, incomingCodes) {
  const gate = isObject(premarketGate) ? premarketGate : {};
  const models = isObject(payload.premarketModels) ? payload.premarketModels : {};
  const preference = isObject(models.tradingStylePreference) ? models.tradingStylePreference : {};
  const directionPermission = isObject(preference.directionPermission) ? preference.directionPermission : {};
  const styleCodes = listCodes(gate.styleEligibleCodes);
  const allowedSet = new Set(styleCodes);
  const eligibleCodes = incomingCodes.filter((code) => allowedSet.has(code));
  const activePaths = unique([
    ...rows(directionPermission.activePaths),
    ...rows(directionPermission.dominantPaths),
  ]);
  const allowedCarrierTypes = unique(directionPermission.allowedCarrierTypes);
  const passed = styleCodes.length > 0 && activePaths.length > 0 && eligibleCodes.length > 0;
  return {
    status: passed ? "passed" : "blocked",
    passed,
    activePaths,
    allowedCarrierTypes,
    styleEligibleCodes: styleCodes,
    eligibleCodes,
    blockers: passed ? [] : [
      !activePaths.length ? "当前周期没有确认的股票模式" : null,
      !styleCodes.length ? "股票模式层没有合格载体" : null,
      styleCodes.length && !eligibleCodes.length ? "题材股票与当前股票模式没有交集" : null,
    ].filter(Boolean),
    evidence: isObject(premarketFlow && premarketFlow.tradingPreference)
      ? premarketFlow.tradingPreference.conclusion || null : null,
    rule: "股票模式必须来自当前周期已确认资金路径；旧selected不能授予模式资格",
  };
}

function pricePassed(pick) {
  const integrity = isObject(pick && pick.priceIntegrity) ? pick.priceIntegrity : {};
  const status = statusToken(integrity.status || integrity.grade);
  if (integrity.valid === false || integrity.consistent === false) return false;
  const explicitlyPassed = ["pass", "ok", "valid", "usable"].includes(status)
    || integrity.valid === true
    || integrity.consistent === true;
  if (!explicitlyPassed) return false;
  const price = finite(pick && pick.price);
  return price !== null && price > 0;
}

function hardGateReasons(pick, allowedCodes, context = {}) {
  const factorDecision = isObject(pick && pick.factorDecision) ? pick.factorDecision : {};
  const hardGate = isObject(pick && pick.hardGate) ? pick.hardGate
    : isObject(factorDecision.hardGate) ? factorDecision.hardGate : {};
  const leadership = isObject(pick && pick.leadership) ? pick.leadership : {};
  const execution = isObject(pick && pick.tomorrowExecution) ? pick.tomorrowExecution : {};
  const participation = participationSnapshot(pick);
  const executionFeasibility = participation.executionFeasibility;
  const code = codeOf(pick);
  const opportunityDataCompleteness = isObject(context.opportunityDataCompleteness)
    ? context.opportunityDataCompleteness
    : evaluateOpportunityDataCompleteness(pick, {
      tradingDate: text(context.tradingDate || pick && pick.factorContext && pick.factorContext.tradingDate),
    });
  return unique([
    !code || !allowedCodes.has(code) ? "未通过赚钱效应、题材与股票模式交集" : null,
    hardGate.pass !== true ? "个股硬门槛未通过" : null,
    pick && pick.tradeQualified !== true ? "个股交易资格未通过" : null,
    leadership.tradeQualified !== true ? "核心地位交易资格未通过" : null,
    execution.tomorrowEntryQualified !== true ? "次日入场资格未通过" : null,
    executionFeasibility && executionFeasibility.status === "blocked" ? "执行可行性未通过" : null,
    opportunityDataCompleteness.qualified !== true
      ? `机会关键数据不完整：${rows(opportunityDataCompleteness.blockers).map(text).join("；") || "缺少当日可验证证据"}`
      : null,
    !pricePassed(pick) ? "价格完整性未通过" : null,
    participation.participationScore === null ? "个股参与价值评分缺失" : null,
    participation.riskAdjustmentScore === null ? "个股风险调整评分缺失" : null,
    participation.finalScore === null ? "个股风险调整后最终评分缺失" : null,
  ]);
}

function participationSnapshot(pick) {
  const factorDecision = isObject(pick && pick.factorDecision) ? pick.factorDecision : {};
  const participation = isObject(factorDecision.participationValue) ? factorDecision.participationValue : {};
  const risk = isObject(factorDecision.riskAdjustment) ? factorDecision.riskAdjustment : {};
  const leadershipWeighting = isObject(factorDecision.leadershipWeighting)
    ? factorDecision.leadershipWeighting : null;
  const executionFeasibility = isObject(factorDecision.executionFeasibility)
    ? factorDecision.executionFeasibility : null;
  return {
    participationScore: finite(participation.score),
    components: isObject(participation.components) ? { ...participation.components } : {},
    participationDetails: isObject(participation.details) ? { ...participation.details } : {},
    leadershipWeighting: leadershipWeighting ? { ...leadershipWeighting } : null,
    executionFeasibility: executionFeasibility ? { ...executionFeasibility } : null,
    riskAdjustmentScore: finite(risk.score),
    riskComponents: isObject(risk.components) ? { ...risk.components } : {},
    finalScore: finite(factorDecision.finalScore),
  };
}

function allocate(total, weights) {
  if (!weights.length || total <= 0) return [];
  const safeWeights = weights.map((value) => Math.max(0, Number(value) || 0));
  const totalWeight = safeWeights.reduce((sum, value) => sum + value, 0);
  const normalized = totalWeight > 0
    ? safeWeights.map((value) => value / totalWeight)
    : safeWeights.map(() => 1 / safeWeights.length);
  const values = normalized.map((weight) => round2(total * weight));
  const residual = round2(total - values.reduce((sum, value) => sum + value, 0));
  if (values.length) values[0] = round2(values[0] + residual);
  return values;
}

function buildResult(bestPicks, incomingCodes, authorization, context = {}) {
  const allowedCodes = new Set(incomingCodes);
  const sourcePicks = rows(bestPicks && bestPicks.decisionPool).length
    ? rows(bestPicks.decisionPool)
    : rows(bestPicks && bestPicks.picks);
  const rejected = [];
  const eligible = [];
  sourcePicks.forEach((pick, sourceIndex) => {
    const opportunityDataCompleteness = evaluateOpportunityDataCompleteness(pick, {
      tradingDate: text(context.tradingDate || pick && pick.factorContext && pick.factorContext.tradingDate),
    });
    const reasons = hardGateReasons(pick, allowedCodes, { opportunityDataCompleteness });
    if (reasons.length) {
      rejected.push({
        code: codeOf(pick),
        name: text(pick && pick.name),
        reasons,
        opportunityDataCompleteness,
      });
      return;
    }
    eligible.push({ pick, sourceIndex, value: participationSnapshot(pick), opportunityDataCompleteness });
  });
  eligible.sort((left, right) => (
    (right.value.finalScore ?? -Infinity) - (left.value.finalScore ?? -Infinity)
    || Number(right.pick && right.pick.tomorrowExecution && right.pick.tomorrowExecution.rank || 0)
      - Number(left.pick && left.pick.tomorrowExecution && left.pick.tomorrowExecution.rank || 0)
    || left.sourceIndex - right.sourceIndex
  ));
  const selected = eligible.slice(0, MAX_RESULT_STOCKS);
  const weights = selected.map((item) => Math.max(0, item.value.finalScore || 0));
  const relativeWeights = allocate(100, weights);
  const initialAllocations = allocate(authorization.positionPermission.initialActivationPct, weights);
  const maximumAllocations = allocate(authorization.positionPermission.positionCeilingPct, weights);
  const stocks = selected.map((item, index) => ({
    rank: index + 1,
    code: codeOf(item.pick),
    name: text(item.pick && item.pick.name, codeOf(item.pick)),
    theme: text(item.pick && (item.pick.mainConcept || item.pick.focusDirection || item.pick.concept)) || null,
    stockMode: text(item.pick && (item.pick.ticketType || item.pick.setup || item.pick.role)) || null,
    participationValue: {
      score: item.value.participationScore,
      components: item.value.components,
      details: item.value.participationDetails,
    },
    leadershipWeighting: item.value.leadershipWeighting,
    executionFeasibility: item.value.executionFeasibility,
    opportunityDataCompleteness: item.opportunityDataCompleteness,
    riskAdjustment: {
      score: item.value.riskAdjustmentScore,
      components: item.value.riskComponents,
    },
    riskAdjustedParticipationScore: item.value.finalScore,
    positionAllocation: {
      relativeWeightPct: relativeWeights[index],
      initialPortfolioPct: initialAllocations[index],
      maximumPortfolioPct: maximumAllocations[index],
    },
  }));
  return {
    status: stocks.length ? "ready" : "no_candidate",
    maxStocks: MAX_RESULT_STOCKS,
    sourceCount: sourcePicks.length,
    hardGateEligibleCount: eligible.length,
    selectedCount: stocks.length,
    selectedCodes: stocks.map((item) => item.code),
    stocks,
    rejected,
    participationAndAllocation: {
      status: stocks.length ? "available" : "not_applicable",
      positionCeilingPct: authorization.positionPermission.positionCeilingPct,
      initialActivationPct: authorization.positionPermission.initialActivationPct,
      cashReserveAtInitialPct: round2(100 - authorization.positionPermission.initialActivationPct),
      cashReserveAtCeilingPct: round2(100 - authorization.positionPermission.positionCeilingPct),
      rule: "只对通过当日机会关键数据契约和全部交易硬门槛的结果股，按风险调整后参与价值归一化分配；不通过者权重恒为0",
    },
    rule: `价格、成交额、换手/容量、可追溯总市值桶、当日收盘/可信分时为结果股前置契约；最多输出${MAX_RESULT_STOCKS}只，不足不补，全部失败则输出0只`,
  };
}

function notEvaluated(label, blocker) {
  return {
    status: "not_evaluated",
    passed: false,
    blockers: [blocker],
    rule: `${label}未执行，因为上一层已经关闭`,
  };
}

function blockedResult(reason, authorization = null) {
  return {
    status: "blocked",
    maxStocks: MAX_RESULT_STOCKS,
    sourceCount: 0,
    hardGateEligibleCount: 0,
    selectedCount: 0,
    selectedCodes: [],
    stocks: [],
    rejected: [],
    blockers: [reason],
    participationAndAllocation: {
      status: "not_applicable",
      positionCeilingPct: authorization && authorization.positionPermission.positionCeilingPct || 0,
      initialActivationPct: 0,
      cashReserveAtInitialPct: 100,
      cashReserveAtCeilingPct: 100,
      rule: "上游关闭时不计算个股仓位",
    },
    rule: `最多输出${MAX_RESULT_STOCKS}只；上游关闭时输出0只`,
  };
}

function opportunityThemeTokens(value) {
  const collected = [];
  const visit = (item) => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (isObject(item)) {
      [item.name, item.displayName, item.family, item.label, item.themeName, item.mainConcept]
        .forEach(visit);
      rows(item.aliases).forEach(visit);
      rows(item.concepts).forEach(visit);
      return;
    }
    const normalized = text(item).replace(/\s+/g, "");
    [normalized, ...normalized.split(/[+＋、,，/；;|]+/)]
      .map((token) => token.replace(/^[（(含]+|[）)]+$/g, ""))
      .filter((token) => token.length >= 2 && !/^(未归类|未知|其他|题材待确认)$/.test(token))
      .forEach((token) => collected.push(token));
  };
  visit(value);
  return unique(collected);
}

function currentThemeIntersection(stock, marketThemeTokens) {
  const stockTokens = opportunityThemeTokens([
    stock && stock.mainConcept,
    stock && stock.mainFamily,
    stock && stock.concept,
    stock && stock.concepts,
    stock && stock.previousLimitUpEvidence && stock.previousLimitUpEvidence.reason,
  ]);
  for (const stockToken of stockTokens) {
    for (const marketToken of marketThemeTokens) {
      if (stockToken === marketToken) return { matched: true, token: marketToken, stockTokens };
      if (marketToken.length >= 3 && stockToken.includes(marketToken)) {
        return { matched: true, token: marketToken, stockTokens };
      }
      if (stockToken.length >= 3 && marketToken.includes(stockToken)) {
        return { matched: true, token: stockToken, stockTokens };
      }
    }
  }
  return { matched: false, token: null, stockTokens };
}

function buildObservationCandidates(payload) {
  const source = isObject(payload) ? payload : {};
  const models = isObject(source.premarketModels) ? source.premarketModels : {};
  const preference = isObject(models.tradingStylePreference) ? models.tradingStylePreference : {};
  const representatives = isObject(preference.observationRepresentatives)
    ? preference.observationRepresentatives : {};
  const persistentDirectionPermission = isObject(preference.persistentDirectionPermission)
    ? preference.persistentDirectionPermission : {};
  const persistentPreferenceConfirmed = persistentDirectionPermission.screeningStatus === "allowed"
    && rows(persistentDirectionPermission.activePaths).length > 0;
  const activePaths = persistentPreferenceConfirmed
    ? unique(rows(persistentDirectionPermission.activePaths).map(text)) : [];
  const dominantPaths = persistentPreferenceConfirmed
    ? unique([
      ...rows(persistentDirectionPermission.dominantPaths).map(text),
      ...activePaths,
    ]).filter((path) => activePaths.includes(path)) : [];
  const persistentEligibleCodesByPath = isObject(persistentDirectionPermission.eligibleCarrierCodesByPath)
    ? persistentDirectionPermission.eligibleCarrierCodesByPath : {};
  const opportunities = new Map(rows(preference.opportunities).map((item) => [text(item && item.path), item]));
  const candidateRows = rows(source.candidates);
  const themeLibrary = isObject(source.themeLibrary) ? source.themeLibrary : {};
  const mainThemeDecision = isObject(themeLibrary.mainThemeDecision) ? themeLibrary.mainThemeDecision : {};
  const confirmedFamily = isObject(mainThemeDecision.confirmedFamily)
    && mainThemeDecision.confirmedFamily.state === "confirmed"
    ? mainThemeDecision.confirmedFamily : null;
  const confirmedMainAttack = isObject(mainThemeDecision.mainAttackSubtheme)
    ? mainThemeDecision.mainAttackSubtheme : null;
  const marketThemeTokens = opportunityThemeTokens([confirmedFamily, confirmedMainAttack]);
  const effectAttribution = isObject(source.market && source.market.state && source.market.state.effectAttribution)
    ? source.market.state.effectAttribution : {};
  const shortCoreScope = rows(effectAttribution.scopes).find((scope) => text(scope && scope.key) === "short-core") || {};
  const shortCorePositive = text(shortCoreScope.tone).toLowerCase() === "good";
  const shortCoreEligibleCodes = new Set(shortCorePositive
    ? rows(shortCoreScope.referenceGroups).flatMap((group) => listCodes(group && group.items))
    : []);
  const emotionEvidence = isObject(source.emotionCoreEvidence) ? source.emotionCoreEvidence
    : isObject(source.tomorrowDecision && source.tomorrowDecision.emotionCoreEvidence)
      ? source.tomorrowDecision.emotionCoreEvidence : {};
  const strictCoreCodes = new Set(listCodes(emotionEvidence.strictEmotionCores));
  const carrierProfile = isObject(source.market && source.market.marketCapCarrier)
    ? source.market.marketCapCarrier : null;
  const preferredBucketKeys = carrierProfile && carrierProfile.status === "confirmed"
    ? unique(carrierProfile.preferredBucketKeys) : [];
  const carrierGateApplied = preferredBucketKeys.length > 0;
  const phaseDetail = isObject(source.marketPhaseDetail) ? source.marketPhaseDetail : {};
  const phaseDecisionContext = isObject(phaseDetail.decisionContext) ? phaseDetail.decisionContext : {};
  const environmentBigCycle = phaseDetail.structuralCycle
    || phaseDecisionContext.bigCycle && (phaseDecisionContext.bigCycle.label || phaseDecisionContext.bigCycle.key);
  const environmentSmallCycle = isObject(phaseDetail.smallCycle)
    ? phaseDetail.smallCycle : isObject(phaseDecisionContext.smallCycle) ? phaseDecisionContext.smallCycle : {};
  const marketEnvironmentKnown = Boolean(
    normalizeBigCycle(environmentBigCycle)
    && text(environmentSmallCycle.key || environmentSmallCycle.label),
  );
  const expectedGenerationId = text(source.generationId || source.generationContext && source.generationContext.generationId);
  const modelGenerationId = text(models.generationId);
  const sourceTradingDate = text(source.tradingDate || source.generationContext && source.generationContext.tradingDate);
  const preferenceTradingDate = text(preference.tradingDate);
  const generationBlockers = unique([
    expectedGenerationId && modelGenerationId && expectedGenerationId !== modelGenerationId
      ? "资金偏好模型与当前载荷代次不一致" : null,
    sourceTradingDate && preferenceTradingDate && sourceTradingDate !== preferenceTradingDate
      ? "资金偏好模型与当前交易日不一致" : null,
    carrierProfile && carrierProfile.status === "confirmed" && !preferredBucketKeys.length
      ? "市值偏好标记为confirmed但缺少优先市值桶" : null,
  ]);
  const poolBlockers = unique([
    ...generationBlockers,
    !persistentPreferenceConfirmed ? "持续T+1赚钱偏好尚未确认，机会观察池不生成" : null,
    !shortCorePositive || !shortCoreEligibleCodes.size
      ? "短线正向赚钱效应缺少具名载体，机会观察池不生成" : null,
    !marketThemeTokens.length ? "当前权威题材尚未确认，机会观察池不生成" : null,
    !carrierProfile || carrierProfile.status !== "confirmed" || !carrierGateApplied
      ? "市值资金偏好尚未确认，机会观察池不生成" : null,
    !marketEnvironmentKnown ? "当前大周期或小周期环境尚未确认，机会观察池不生成" : null,
  ]);
  const explicitPathByCode = new Map();
  const representativeByCode = new Map();
  Object.entries(representatives).forEach(([path, items]) => {
    rows(items).forEach((representative) => {
      const code = codeOf(representative);
      if (!code) return;
      explicitPathByCode.set(code, unique([
        ...rows(explicitPathByCode.get(code)),
        path,
        text(representative.path),
      ]));
      if (!representativeByCode.has(code)) representativeByCode.set(code, representative);
    });
  });
  const ranked = [];
  const carrierExcludedCodes = [];
  const carrierUnverifiedCodes = [];
  const pathMismatchCodes = [];
  const noExpectationCodes = [];
  const fatalRiskCodes = [];
  const generationMismatchCodes = [];
  const anchorOnlyCodes = [];
  const dataIncompleteCodes = [];
  const environmentMismatchCodes = [];
  const persistentPreferenceMismatchCodes = [];
  const profitEffectMismatchCodes = [];
  const finalGateRejectedCodes = [];
  const dataDiagnostics = [];

  if (!generationBlockers.length && activePaths.length) candidateRows.forEach((stock, sourceIndex) => {
    const code = codeOf(stock);
    if (!code) return;
    const stockGenerationId = text(stock.factorContext && stock.factorContext.generationId);
    if (expectedGenerationId && stockGenerationId !== expectedGenerationId) {
      generationMismatchCodes.push(code);
      return;
    }
    const representative = representativeByCode.get(code) || {};
    const previousLimitUpEvidence = isObject(stock.previousLimitUpEvidence)
      ? stock.previousLimitUpEvidence : {};
    const previousLimitUpHighDays = text(previousLimitUpEvidence.highDays);
    const gamePlan = isObject(stock.gamePlan) ? stock.gamePlan : {};
    const tomorrowExecution = isObject(stock.tomorrowExecution) ? stock.tomorrowExecution : {};
    const leadership = isObject(stock.leadership) ? stock.leadership : {};
    const initiative = isObject(leadership.initiative) ? leadership.initiative : {};
    const cycleIdentity = isObject(leadership.cycleIdentity) ? leadership.cycleIdentity : {};
    const membershipAuthority = isObject(cycleIdentity.membershipAuthority)
      ? cycleIdentity.membershipAuthority : {};
    const hardGate = isObject(stock.hardGate) ? stock.hardGate : {};
    const carrier = isObject(stock.marketCapCarrier) ? stock.marketCapCarrier
      : isObject(representative.marketCapCarrier) ? representative.marketCapCarrier : {};
    const opportunityDataCompleteness = evaluateOpportunityDataCompleteness({
      ...stock,
      marketCapCarrier: carrier,
    }, { tradingDate: sourceTradingDate });
    const shortTermCarrier = evaluateShortTermActiveCarrier(stock, { tradingDate: sourceTradingDate });
    const initiativeScore = finite(initiative.score);
    const currentActiveEvidence = shortTermCarrier.qualified === true || Boolean(
      leadership.tradeQualified === true
      && initiative.proactive === true
      && initiativeScore !== null
      && initiativeScore >= 58
    );
    const historicalIdentity = strictCoreCodes.has(code)
      || cycleIdentity.identityEstablished === true
      || cycleIdentity.activePrimary === true
      || /历史情绪核心/.test(text(leadership.identity || leadership.levelLabel));
    const historicalAnchorOnly = Boolean(
      historicalIdentity
      && !currentActiveEvidence
      && (
        text(leadership.tradeState) === "仅观察"
        || initiative.proactive !== true
        || (initiativeScore !== null && initiativeScore < 58)
      )
    );
    if (opportunityDataCompleteness.qualified !== true) {
      dataIncompleteCodes.push(code);
      const marketCapEvidence = isObject(
        opportunityDataCompleteness.evidence && opportunityDataCompleteness.evidence.marketCap,
      ) ? opportunityDataCompleteness.evidence.marketCap : {};
      if (marketCapEvidence.usable !== true) carrierUnverifiedCodes.push(code);
      if (historicalIdentity) anchorOnlyCodes.push(code);
      dataDiagnostics.push({
        code,
        name: text(stock.name || representative.name, code),
        diagnosticType: historicalIdentity ? "historical_anchor" : "data_incomplete",
        historicalIdentity,
        opportunityEligible: false,
        executionAuthority: false,
        opportunityDataCompleteness,
        note: historicalIdentity
          ? "历史核心身份仅作锚点；当日关键数据不完整，不得进入机会排序"
          : "当日关键数据不完整，仅保留诊断，不得进入机会排序",
      });
      return;
    }
    const bucketKey = text(carrier.bucketKey);
    const carrierEligible = !carrierGateApplied
      || Boolean(bucketKey && bucketKey !== "unknown" && preferredBucketKeys.includes(bucketKey));
    if (carrierGateApplied && !carrierEligible) {
      if (!bucketKey || bucketKey === "unknown") carrierUnverifiedCodes.push(code);
      else carrierExcludedCodes.push(code);
      if (historicalAnchorOnly) anchorOnlyCodes.push(code);
      return;
    }
    if (historicalAnchorOnly) {
      anchorOnlyCodes.push(code);
      return;
    }

    const explicitPaths = rows(explicitPathByCode.get(code));
    const pathText = [
      stock.path,
      stock.stylePath,
      stock.ticketType,
      stock.role,
      leadership.identity,
      gamePlan.gameType,
      gamePlan.preferenceLine,
      gamePlan.decision,
      tomorrowExecution.pricePhaseKey,
      tomorrowExecution.pricePhaseLabel,
      previousLimitUpHighDays,
    ].map((value) => text(value)).filter(Boolean).join("；");
    const inferredPaths = unique([
      ...explicitPaths,
      text(stock.path),
      text(stock.stylePath),
      rows(stock.paths).map(text),
      text(gamePlan.path),
      text(tomorrowExecution.path),
      finite(stock.consecutiveBoards) !== null && finite(stock.consecutiveBoards) >= 2
        || /连板|高度龙|换手回封|(?:\d+天)?[2-9]\d*板/.test(pathText) ? "boardEmotion" : null,
      /startup|低位|首板|(?:^|\D)1板|先锋|补涨|趋势一波|非趋势波段/.test(pathText) ? "lowLaunch" : null,
      /高位趋势|二波|三波/.test(pathText) ? "highTrend" : null,
    ].flat());
    const matchedPaths = inferredPaths.filter((path) => activePaths.includes(path));
    if (!matchedPaths.length) {
      pathMismatchCodes.push(code);
      return;
    }
    const persistentMatchedPaths = matchedPaths.filter((path) => (
      listCodes(persistentEligibleCodesByPath[path]).includes(code)
    ));
    if (!persistentMatchedPaths.length) {
      persistentPreferenceMismatchCodes.push(code);
      return;
    }
    if (!shortCoreEligibleCodes.has(code)) {
      profitEffectMismatchCodes.push(code);
      return;
    }

    const hardFails = rows(hardGate.hardFails).map(text);
    const leadershipFails = rows(leadership.hardFails).map(text);
    const relaxableShortStructureFails = shortTermCarrier.qualified === true
      ? hardFails.filter((reason) => /5日线未持续向上|历史高位|上方套牢|筹码压力|整体K线框架/.test(reason))
      : [];
    const effectiveHardGatePassed = hardGate.pass === true || Boolean(
      shortTermCarrier.qualified === true
      && hardFails.length > 0
      && relaxableShortStructureFails.length === hardFails.length
    );
    const effectiveLeadershipFails = shortTermCarrier.qualified === true
      ? leadershipFails.filter((reason) => !/5日线未持续向上|历史高位|上方套牢|筹码压力|整体K线框架/.test(reason))
      : leadershipFails;
    const shortStructureRiskNotes = shortTermCarrier.qualified === true ? unique([
      ...relaxableShortStructureFails,
      ...leadershipFails.filter((reason) => !effectiveLeadershipFails.includes(reason)),
      shortTermCarrier.riskOnly ? "中长期位置/斜率风险只限制追高，不否决当日短线载体" : null,
    ]) : [];
    const pullbackRepair = classifyLimitUpPullbackRepair(stock, source);
    const lastSession = isObject(stock.klineProfile && stock.klineProfile.lastSession)
      ? stock.klineProfile.lastSession : {};
    const explicitNoPriceDiscovery = lastSession.oneWord === true
      || lastSession.noPriceDiscovery === true
      || isObject(initiative.priceDiscovery) && (
        initiative.priceDiscovery.suspectedOneWord === true
        || initiative.priceDiscovery.noPriceDiscovery === true
        || initiative.priceDiscovery.limitUpDiscoveryUnverified === true
      );
    const narrowFatalReasons = unique([
      explicitNoPriceDiscovery ? "一字锁板或缺少价格发现" : null,
      ...hardFails.filter((reason) => (
        /退市|停牌|无价格|价格无效|数据缺失|流动性枯竭|跌停无法卖出|一字锁板|缺少价格发现|无换手/.test(reason)
        && !/资金流|主力资金|资金性质/.test(reason)
      )),
      ...leadershipFails.filter((reason) => /一字锁板|缺少价格发现|无换手|跌停|流动性枯竭/.test(reason)),
      /一字锁板|缺少价格发现|无换手/.test(text(gamePlan.gameReason)) ? text(gamePlan.gameReason) : null,
      pullbackRepair.qualified !== true && shortTermCarrier.qualified !== true && (
        tomorrowExecution.bucket === "risk" || tomorrowExecution.pricePhaseKey === "failure"
        || /取消新开仓资格|只保留风险观察/.test(text(tomorrowExecution.actionLabel))
      )
        ? text(tomorrowExecution.actionLabel, "次日状态已明确进入风险观察") : null,
    ]);
    if (narrowFatalReasons.length) {
      fatalRiskCodes.push(code);
      return;
    }

    const tomorrowTriggers = unique(rows(tomorrowExecution.triggers).map(text));
    const tomorrowCancel = unique(rows(tomorrowExecution.cancelConditions).map(text));
    const tomorrowEvidenceQualified = tomorrowExecution.tomorrowEntryQualified === true
      || tomorrowTriggers.length > 0
      || tomorrowExecution.bucket === "entry";
    const themeEvidenceQualified = cycleIdentity.activePrimary === true
      || cycleIdentity.state === "confirmed" && membershipAuthority.observationEligible === true;
    const pathEvidence = matchedPaths.flatMap((path) => {
      const opportunity = opportunities.get(path) || {};
      return rows(opportunity.trigger).map((item) => text(item)).filter(Boolean);
    });
    const representativePathEvidenceQualified = explicitPaths.some((path) => matchedPaths.includes(path))
      && pathEvidence.length > 0;
    const explicitDirectionFailure = leadershipFails.some((reason) => /不属于当前主线方向|非当前核心方向/.test(reason));
    const coreDirectionMatch = !explicitDirectionFailure && (
      leadership.coreDirectionMatch === true
      || isObject(leadership.directionState) && leadership.directionState.isCoreDirection === true
    );
    const strictCoreExpectation = strictCoreCodes.has(code);
    const directionalCoreExpectation = coreDirectionMatch && (
      leadership.tradeQualified === true
      || currentActiveEvidence
      || /核心活口|次日验证|主动型/.test(text(stock.setup || leadership.tradeState || leadership.identity))
    );
    const gameStrength = finite(gamePlan.longStrength);
    const gameNarrative = text(gamePlan.decision || gamePlan.gameReason || gamePlan.preferenceLine || gamePlan.sectorLine);
    const gameEvidenceQualified = Boolean(gameNarrative) && (
      gamePlan.canGame === true && (coreDirectionMatch || strictCoreExpectation || representativePathEvidenceQualified)
      || gameStrength !== null && gameStrength >= 60 && (coreDirectionMatch || representativePathEvidenceQualified)
    );
    const stockDirectionState = isObject(stock.directionState) ? stock.directionState : {};
    const themeIntersection = currentThemeIntersection(stock, marketThemeTokens);
    const currentEnvironmentThemeMatched = themeIntersection.matched === true;
    if (!currentEnvironmentThemeMatched) {
      environmentMismatchCodes.push(code);
      return;
    }
    const pullbackDirectionQualified = Boolean(
      currentEnvironmentThemeMatched,
    );
    const currentActivePreferenceQualified = currentActiveEvidence && pullbackDirectionQualified;
    const pullbackRepairQualified = pullbackRepair.qualified === true && pullbackDirectionQualified;
    const validationOnly = tomorrowExecution.bucket === "premium"
      && tomorrowExecution.tomorrowEntryQualified !== true
      && tomorrowTriggers.length === 0
      && /只验证|不作为.*答案|不作为.*买点/.test(text(tomorrowExecution.actionLabel));
    const expectationEvidence = unique([
      shortTermCarrier.qualified && currentActivePreferenceQualified
        ? "当日主动高度载体命中当前赚钱路径与市值偏好；明日只观察溢价和承接，不追高" : null,
      pullbackRepairQualified ? text(pullbackRepair.focus, "T-1涨停，今日回撤但结构未坏") : null,
      tomorrowEvidenceQualified ? text(tomorrowExecution.actionLabel, "次日路径命中后具备条件机会") : null,
      directionalCoreExpectation ? `${text(stock.mainConcept, "所属方向")}主动核心仍有次日承接或延续预期` : null,
      themeEvidenceQualified ? `${text(cycleIdentity.themeName || stock.mainConcept, "所属题材")}题材周期仍有延续证据` : null,
      strictCoreExpectation ? "当前严格情绪核心仍需观察次日延续、承接或修复结果" : null,
      representativePathEvidenceQualified
        ? `${text(preference.paths && preference.paths[matchedPaths[0]] && preference.paths[matchedPaths[0]].label, matchedPaths[0])}属于当前成立的赚钱效应路径`
        : null,
      gameEvidenceQualified ? "股票模式与当前资金偏好匹配，明日仍有条件预期" : null,
      ...tomorrowTriggers,
      ...pathEvidence,
    ]);
    if ((validationOnly && !pullbackRepairQualified && shortTermCarrier.qualified !== true) || !expectationEvidence.length
      || !(gameEvidenceQualified || tomorrowEvidenceQualified || themeEvidenceQualified
        || directionalCoreExpectation || representativePathEvidenceQualified
        || currentActivePreferenceQualified
        || pullbackRepairQualified)) {
      noExpectationCodes.push(code);
      return;
    }

    const primaryPath = explicitPaths.find((path) => persistentMatchedPaths.includes(path))
      || dominantPaths.find((path) => persistentMatchedPaths.includes(path))
      || persistentMatchedPaths[0];
    const primaryOpportunity = opportunities.get(primaryPath) || {};
    const executionFeasibility = isObject(stock.factorDecision && stock.factorDecision.executionFeasibility)
      ? stock.factorDecision.executionFeasibility
      : buildExecutionFeasibility(stock, {});
    const hardGateMissing = effectiveHardGatePassed ? []
      : hardFails.length ? hardFails : ["个股完整硬门槛尚未确认"];
    const leadershipMissing = leadership.tradeQualified === true ? []
      : effectiveLeadershipFails.length ? effectiveLeadershipFails : shortTermCarrier.qualified === true
        ? [] : ["分时领导力或核心地位尚未取得交易资格"];
    const tradingWindow = isObject(source.market && source.market.state && source.market.state.tradeWindow)
      ? source.market.state.tradeWindow : {};
    const missingConditions = unique([
      ...(pullbackRepairQualified ? rows(pullbackRepair.confirmationConditions).map(text) : []),
      ...hardGateMissing,
      ...leadershipMissing,
      gamePlan.canGame === false ? text(gamePlan.gameReason, "股票模式仍待确认") : null,
      tomorrowExecution.tomorrowEntryQualified === false ? "次日买点尚未取得" : null,
      ...rows(membershipAuthority.gaps).map(text),
      !carrierGateApplied ? "市值资金偏好尚未达到confirmed，仅作软匹配" : null,
      tradingWindow.allowNew !== true ? "统一交易授权尚未开放" : null,
    ]);
    const confirmationConditions = unique([
      ...(pullbackRepairQualified ? rows(pullbackRepair.confirmationConditions).map(text) : []),
      ...rows(primaryOpportunity.trigger).map(text),
      ...tomorrowTriggers,
      effectiveHardGatePassed !== true ? "个股重新通过完整硬门槛确认" : null,
      leadership.tradeQualified !== true && shortTermCarrier.qualified !== true ? "分时主动性与核心地位重新确认" : null,
      tradingWindow.allowNew !== true ? "市场阶段与交易仓位权限重新开放" : null,
    ]);
    const cancelConditions = unique([
      ...(pullbackRepairQualified ? rows(pullbackRepair.cancelConditions).map(text) : []),
      ...rows(primaryOpportunity.cancel).map(text),
      ...tomorrowCancel,
      "个股不再匹配当前资金偏好或赚钱效应路径",
      "题材负反馈向核心扩散，明日预期失效",
    ]);
    const postEntryNextDayExpectation = buildPostEntryNextDayExpectation({
      primaryPath,
      pathStage: preference.paths && preference.paths[primaryPath] && preference.paths[primaryPath].stage,
      pullbackRepairQualified,
      confirmationConditions,
      cancelConditions,
      basis: pullbackRepairQualified ? pullbackRepair.label : primaryOpportunity.title,
    });
    const entryConfirmation = buildEntryConfirmation({
      primaryPath,
      pullbackRepairQualified,
      hardGatePassed: effectiveHardGatePassed,
      leadershipQualified: leadership.tradeQualified === true,
      shortTermCarrierQualified: shortTermCarrier.qualified === true,
      opportunityDataComplete: opportunityDataCompleteness.qualified === true,
      missingConditions,
      confirmationConditions,
      cancelConditions,
    });
    const gatedPostEntryNextDayExpectation = entryConfirmation.status === "waiting_trigger"
      ? postEntryNextDayExpectation
      : {
        ...postEntryNextDayExpectation,
        status: "unavailable",
        key: null,
        label: "不适用（当前无买点）",
        premise: "买点确认未通过时不生成持有预期",
        riskLabel: "不预设上涨",
      };
    const opportunityScore = round2(Math.min(100,
      25
      + (dominantPaths.includes(primaryPath) ? 5 : 0)
      + (carrierGateApplied ? 15 : 8)
      + Math.min(15, Math.max(0, gameStrength || 0) / 6.67)
      + (gamePlan.canGame === true ? 3 : 0)
      + (tomorrowExecution.tomorrowEntryQualified === true ? 6 : 0)
      + Math.min(6, tomorrowTriggers.length * 2)
      + (themeEvidenceQualified ? 5 : 0)
      + (directionalCoreExpectation ? 8 : 0)
      + (strictCoreExpectation && currentActivePreferenceQualified ? 2 : 0)
      + (leadership.tradeQualified === true ? 4 : 0)
      + (effectiveHardGatePassed ? 3 : 0)
      + (["under_50", "50_100", "100_300", "300_500"].includes(bucketKey) ? 5 : 0)
      + (representativePathEvidenceQualified ? 2 : 0)
      + (pullbackRepairQualified ? 10 : 0)
      + (currentActivePreferenceQualified ? 18 : 0)
      + (currentActivePreferenceQualified ? Math.min(10, Math.max(0, initiativeScore || 0) / 10) : 0)
    ));
    ranked.push({
      opportunityScore,
      sourceIndex,
      tierKey: pullbackRepairQualified ? "limit_up_pullback_repair" : "path_representative",
      tierLabel: pullbackRepairQualified ? "机会观察·前板回撤" : "机会观察·明日预期",
      setupKey: pullbackRepairQualified ? pullbackRepair.setupKey : null,
      setupLabel: pullbackRepairQualified ? pullbackRepair.label : null,
      setupEvidence: pullbackRepairQualified ? unique([
        ...rows(pullbackRepair.evidence).map(text),
        themeIntersection.matched ? `命中当前有效题材：${themeIntersection.token}` : null,
      ]) : [],
      code,
      name: text(stock.name || representative.name, code),
      path: primaryPath,
      paths: persistentMatchedPaths,
      pathLabel: text(preference.paths && preference.paths[primaryPath] && preference.paths[primaryPath].label
        || representative.pathLabel || primaryPath),
      theme: pullbackRepairQualified && themeIntersection.token
        ? themeIntersection.token
        : text(stock.mainConcept || stock.concept || representative.concept) || null,
      role: text(leadership.identity || stock.role || representative.role) || null,
      observationReason: expectationEvidence[0],
      expectation: {
        status: "qualified",
        label: expectationEvidence[0],
        evidence: expectationEvidence,
        evidenceSources: unique([
          gameEvidenceQualified ? "gamePlan" : null,
          tomorrowEvidenceQualified ? "tomorrowExecution" : null,
          themeEvidenceQualified ? "themeCycle" : null,
          directionalCoreExpectation ? "coreDirectionLeadership" : null,
          strictCoreExpectation ? "strictEmotionCore" : null,
          representativePathEvidenceQualified ? "tradingStylePreference" : null,
          pullbackRepairQualified && themeIntersection.matched ? "currentThemeIntersection" : null,
          pullbackRepairQualified ? "exactT1LimitUpPullback" : null,
          currentActivePreferenceQualified ? "currentActiveShortTermCarrierWithDirection" : null,
        ]),
      },
      environmentFit: {
        status: "matched",
        matched: true,
        generationAligned: Boolean(expectedGenerationId && stockGenerationId === expectedGenerationId),
        marketEnvironmentKnown,
        activePathMatched: true,
        themeMatched: true,
        evidence: unique([
          `大周期=${text(normalizeBigCycle(environmentBigCycle))}`,
          `小周期=${text(environmentSmallCycle.label || environmentSmallCycle.key)}`,
          `持续赚钱效应路径=${persistentMatchedPaths.join("/")}`,
          themeIntersection.matched ? `当前题材交集=${themeIntersection.token}` : null,
          themeEvidenceQualified ? "题材周期身份已确认" : null,
          coreDirectionMatch || stockDirectionState.isCoreDirection === true ? "当前核心方向匹配" : null,
        ]),
      },
      postEntryNextDayExpectation: gatedPostEntryNextDayExpectation,
      entryConfirmation,
      capitalPreference: {
        status: carrierGateApplied ? "confirmed_match"
          : carrierProfile && carrierProfile.status === "mixed" ? "soft_match" : "unavailable",
        matched: carrierGateApplied ? true : null,
        bucketKey: bucketKey || null,
        bucketLabel: text(carrier.bucketLabel) || null,
        preferredBucketKeys,
        reason: text(carrier.reason || carrierProfile && carrierProfile.reason,
          carrierGateApplied ? "命中当日确认的市值资金偏好" : "市值资金偏好未确认，不作硬剔除"),
      },
      profitPreference: {
        status: "matched",
        matched: true,
        activePaths,
        dominantPaths,
        matchedPaths: persistentMatchedPaths,
        primaryPath,
      },
      leadership: {
        dataQuality: text(initiative.dataQualityLabel || initiative.dataQuality, "数据待确认"),
        dataQualityKey: text(initiative.dataQualityKey) || null,
        evidenceWeight: finite(initiative.evidenceWeight),
        initiativeScore: finite(initiative.score),
        firstAttackTime: text(initiative.firstAttackTime) || null,
        tradeQualified: leadership.tradeQualified === true,
        currentActiveEvidence,
        currentActivePreferenceQualified,
      },
      hardGatePassed: effectiveHardGatePassed,
      opportunityDataCompleteness,
      shortTermOpportunityStructure: shortTermCarrier,
      riskNotes: unique([
        ...shortStructureRiskNotes,
        ...rows(opportunityDataCompleteness.riskNotes).map(text),
      ]),
      executionFeasibility,
      marketCapFit: {
        status: carrierGateApplied ? "confirmed_match" : text(carrierProfile && carrierProfile.status, "unavailable"),
        gateApplied: carrierGateApplied,
        bucketKey: bucketKey || null,
        bucketLabel: text(carrier.bucketLabel) || null,
        preferredBucketKeys,
      },
      missingConditions,
      confirmationConditions,
      reopenConditions: confirmationConditions,
      cancelConditions,
      observationOnly: true,
      executable: false,
      executionAuthority: false,
    });
  });

  const seen = new Set();
  const rankedUnique = ranked
    .sort((a, b) => b.opportunityScore - a.opportunityScore || a.sourceIndex - b.sourceIndex || a.code.localeCompare(b.code))
    .filter((item) => !seen.has(item.code) && seen.add(item.code));
  const finalEligibleRanked = rankedUnique.filter((item) => {
    const eligible = poolBlockers.length === 0
      && shortCoreEligibleCodes.has(item.code)
      && listCodes(persistentEligibleCodesByPath[item.profitPreference && item.profitPreference.primaryPath]).includes(item.code)
      && item.environmentFit && item.environmentFit.matched === true
      && item.environmentFit.marketEnvironmentKnown === true
      && item.environmentFit.activePathMatched === true
      && item.environmentFit.themeMatched === true
      && item.profitPreference && item.profitPreference.matched === true
      && rows(item.profitPreference.matchedPaths).includes(item.profitPreference.primaryPath)
      && item.capitalPreference && item.capitalPreference.status === "confirmed_match"
      && item.capitalPreference.matched === true
      && item.marketCapFit && item.marketCapFit.status === "confirmed_match"
      && item.opportunityDataCompleteness && item.opportunityDataCompleteness.qualified === true
      && item.expectation && item.expectation.status === "qualified";
    if (!eligible) finalGateRejectedCodes.push(item.code);
    return eligible;
  });
  const selected = finalEligibleRanked
    .filter((item) => item.tierKey === "limit_up_pullback_repair")
    .slice(0, MAX_PULLBACK_OBSERVATION_STOCKS);
  for (const item of finalEligibleRanked) {
    if (selected.length >= MAX_RESULT_STOCKS) break;
    if (item.tierKey === "limit_up_pullback_repair"
      && selected.filter((selectedItem) => selectedItem.tierKey === "limit_up_pullback_repair").length
        >= MAX_PULLBACK_OBSERVATION_STOCKS) continue;
    if (!selected.some((selectedItem) => selectedItem.code === item.code)) selected.push(item);
  }
  selected.sort((a, b) => b.opportunityScore - a.opportunityScore || a.sourceIndex - b.sourceIndex || a.code.localeCompare(b.code));
  const stocks = selected
    .map(({ sourceIndex, ...item }, index) => ({ rank: index + 1, ...item }));
  const groups = {
    pullbackRepairCandidates: stocks.filter((item) => item.tierKey === "limit_up_pullback_repair"),
    reopenCandidates: stocks.filter((item) => item.tierKey === "reopen_candidate"),
    pathRepresentatives: stocks.filter((item) => item.tierKey === "path_representative"),
    hardGateFailed: stocks.filter((item) => item.tierKey === "hard_gate_failed"),
  };
  return {
    status: poolBlockers.length ? "blocked" : stocks.length ? "available" : "empty",
    method: "expectation_opportunity_pool_v5",
    observationOnly: true,
    executionAuthority: false,
    maxStocks: MAX_RESULT_STOCKS,
    selectedCount: stocks.length,
    selectedCodes: stocks.map((item) => item.code),
    activePaths,
    dominantPaths,
    marketCapOpportunityGate: {
      status: carrierGateApplied ? "applied" : carrierProfile && carrierProfile.status === "mixed" ? "soft_observation" : "unavailable",
      applied: carrierGateApplied,
      preferredBucketKeys,
      excludedCodes: unique(carrierExcludedCodes),
      unverifiedCodes: unique(carrierUnverifiedCodes),
      rule: "只在市值偏好confirmed时做桶匹配；mixed/unavailable只软匹配。但个股总市值桶必须已知且可追溯，不修改情绪核心名单。",
    },
    stocks,
    dataDiagnostics,
    blockers: poolBlockers.length ? poolBlockers
      : !activePaths.length ? ["当前赚钱效应没有active/dominant路径"]
        : !candidateRows.length ? ["当前同代候选池为空"] : [],
    rejected: {
      pathMismatchCodes: unique(pathMismatchCodes),
      noExpectationCodes: unique(noExpectationCodes),
      fatalRiskCodes: unique(fatalRiskCodes),
      generationMismatchCodes: unique(generationMismatchCodes),
      anchorOnlyCodes: unique(anchorOnlyCodes),
      dataIncompleteCodes: unique(dataIncompleteCodes),
      environmentMismatchCodes: unique(environmentMismatchCodes),
      persistentPreferenceMismatchCodes: unique(persistentPreferenceMismatchCodes),
      profitEffectMismatchCodes: unique(profitEffectMismatchCodes),
      finalGateRejectedCodes: unique(finalGateRejectedCodes),
    },
    groups,
    counts: {
      pullbackRepairCandidates: groups.pullbackRepairCandidates.length,
      reopenCandidates: groups.reopenCandidates.length,
      pathRepresentatives: groups.pathRepresentatives.length,
      hardGateFailed: groups.hardGateFailed.length,
    },
    rule: "5只是上限而不是目标；每只观察票必须同时匹配当前同代大小周期环境、当前有效题材、已确认赚钱效应路径和已确认市值资金偏好，并通过当日关键数据契约且无明确失效。任一条件不满足即不入池，宁可少于5只或为空；前板回撤最多2只，不使用其他股票硬补名额",
  };
}

function stepRows({ marketStage, authorization, profitEffect, theme, stockMode, result }) {
  return [
    { order: 1, key: "market_stage", label: "市场阶段", status: marketStage.status },
    { order: 2, key: "authorization", label: "交易许可 / 交易价值 / 交易仓位权限", status: authorization.status },
    { order: 3, key: "profit_effect", label: "赚钱效应", status: profitEffect.status },
    { order: 4, key: "theme", label: "题材", status: theme.status },
    { order: 5, key: "stock_mode", label: "股票模式", status: stockMode.status },
    { order: 6, key: "stock_hard_gate", label: "个股硬门槛", status: result.status === "ready" ? "passed" : result.status },
    { order: 7, key: "result_stocks", label: "结果股票（5只以内）", status: result.status },
    { order: 8, key: "participation_allocation", label: "参与价值与仓位配比", status: result.participationAndAllocation.status },
  ];
}

function buildPremarketGateFromFlow(flow) {
  const source = isObject(flow) ? flow : {};
  const upstream = [source.indexOpportunity, source.tradingPreference, source.emotionStage, source.direction]
    .filter(isObject);
  const blocked = upstream.filter((step) => (
    step.status === "blocked"
    && rows(step.blockedBy).includes(step.key)
  ));
  const stylePermission = isObject(source.tradingPreference && source.tradingPreference.directionPermission)
    ? source.tradingPreference.directionPermission : {};
  const styleCodes = listCodes(
    rows(stylePermission.primaryEligibleCarrierCodes).length
      ? stylePermission.primaryEligibleCarrierCodes
      : stylePermission.eligibleCarrierCodes,
  );
  const directionCodes = listCodes(source.direction && source.direction.allowedStockCodes);
  const directionSet = new Set(directionCodes);
  const allowedCandidateCodes = unique(styleCodes.filter((code) => directionSet.has(code)));
  const emotionPermission = isObject(source.emotionStage && source.emotionStage.executionPermission)
    ? source.emotionStage.executionPermission : {};
  const reasons = blocked.map((step) => {
    if (step.key === "indexOpportunity") {
      return text(step.positionPermission && (step.positionPermission.label || step.positionPermission.note)
        || step.conclusion, "指数交易权限未通过");
    }
    if (step.key === "tradingPreference") {
      return text(step.directionPermission && step.directionPermission.executionLabel
        || step.conclusion, "炒作偏好执行权限未通过");
    }
    if (step.key === "emotionStage") {
      return text(step.executionPermission && step.executionPermission.label
        || step.conclusion, "情绪执行权限未通过");
    }
    return text(step.conclusion, `${step.title || step.key || "上游步骤"}未通过`);
  });
  if (!blocked.length && styleCodes.length && directionCodes.length && !allowedCandidateCodes.length) {
    reasons.push("当前主风格与主方向没有同一只合格载体");
  }
  const isBlocked = blocked.length > 0 || reasons.length > 0;
  return {
    version: 1,
    authority: "unified_decision_chain_premarket_gate",
    blocked: isBlocked,
    blockedSteps: blocked.map((step) => step.key),
    reasons: unique(reasons),
    allowedCandidateCodes,
    styleEligibleCodes: styleCodes,
    directionEligibleCodes: directionCodes,
    executionMode: isBlocked
      ? "blocked"
      : emotionPermission.conditionalAfterSupport === true || emotionPermission.conditional === true
        ? "conditional_after_support"
        : emotionPermission.immediateEntry === true || emotionPermission.immediate === true
          ? "conditional"
          : "blocked",
  };
}

function runUnifiedDecisionChain(input = {}) {
  const payload = isObject(input.payload) ? input.payload : isObject(input) ? input : {};
  const bestPicks = isObject(input.bestPicks) ? input.bestPicks
    : isObject(payload.bestPicks) ? payload.bestPicks : {};
  const premarketFlow = isObject(input.premarketFlow) ? input.premarketFlow : {};
  const premarketGate = isObject(input.premarketGate) ? input.premarketGate : {};
  const generation = generationSnapshot(payload);
  const marketStage = stageProjection(payload, generation);
  const phase = isObject(payload.marketPhaseDetail) ? payload.marketPhaseDetail : {};
  const phaseDecisionContext = isObject(phase.decisionContext) ? phase.decisionContext : {};
  const stockSelectionContext = stockSelectionContextProjection(
    bestPicks,
    generation,
    phaseDecisionContext,
  );
  const observationCandidates = buildObservationCandidates(payload);

  let authorization;
  let profitEffect;
  let theme;
  let stockMode;
  let result;

  if (!marketStage.passed) {
    authorization = {
      ...buildAuthorization(payload, premarketGate, marketStage),
      status: "blocked",
      passed: false,
    };
    profitEffect = notEvaluated("赚钱效应", "市场阶段未通过");
    theme = notEvaluated("题材", "市场阶段未通过");
    stockMode = notEvaluated("股票模式", "市场阶段未通过");
    result = blockedResult("市场阶段未通过", authorization);
  } else {
    authorization = buildAuthorization(payload, premarketGate, marketStage);
    if (!authorization.passed) {
      profitEffect = notEvaluated("赚钱效应", "交易许可或仓位权限未通过");
      theme = notEvaluated("题材", "交易许可或仓位权限未通过");
      stockMode = notEvaluated("股票模式", "交易许可或仓位权限未通过");
      result = blockedResult("交易许可、交易价值或仓位权限未通过", authorization);
    } else {
      profitEffect = buildProfitEffect(payload);
      if (!profitEffect.passed) {
        theme = notEvaluated("题材", "短线核心赚钱效应未通过");
        stockMode = notEvaluated("股票模式", "短线核心赚钱效应未通过");
        result = blockedResult("短线核心赚钱效应未通过", authorization);
      } else {
        theme = buildThemeGate(premarketFlow, premarketGate, profitEffect.eligibleCodes);
        if (!theme.passed) {
          stockMode = notEvaluated("股票模式", "题材层未通过");
          result = blockedResult("题材层未通过", authorization);
        } else {
          stockMode = buildStockMode(payload, premarketFlow, premarketGate, theme.eligibleCodes);
          result = !stockMode.passed
            ? blockedResult("股票模式层未通过", authorization)
            : !stockSelectionContext.passed
              ? blockedResult("个股排序未使用同代统一周期上下文", authorization)
              : buildResult(bestPicks, stockMode.eligibleCodes, authorization, {
                tradingDate: generation.tradingDate,
              });
        }
      }
    }
  }

  const chain = {
    version: UNIFIED_DECISION_CHAIN_VERSION,
    method: "strict_sequential_fail_closed_v1",
    authority: "canonical_stock_decision",
    generation,
    marketStage,
    authorization,
    profitEffect,
    theme,
    stockMode,
    stockSelectionContext,
    observationCandidates,
    result,
  };
  chain.steps = stepRows(chain);
  const selectionContextRequired = marketStage.passed === true
    && authorization.passed === true
    && profitEffect.passed === true
    && theme.passed === true
    && stockMode.passed === true;
  chain.integrity = {
    ok: generation.aligned && (!selectionContextRequired || stockSelectionContext.passed),
    failClosed: true,
    decisionPassed: result.status === "ready" || result.status === "no_candidate",
    selectionContextRequired,
    strictOrder: chain.steps.map((step) => step.key),
    maxResultStocks: MAX_RESULT_STOCKS,
    maxPullbackObservationStocks: MAX_PULLBACK_OBSERVATION_STOCKS,
    noForcedCandidate: true,
    legacySelectedCanGrantMode: false,
    upstreamCanOnlyTighten: true,
    participationCannotOpenPermission: true,
    observationCandidatesCannotGrantExecution: true,
    postEntryExpectationConditionalOnly: true,
    entryConfirmationRequired: true,
    opportunityDataCompletenessRequired: true,
    fundFlowCompletenessRequired: false,
  };
  return chain;
}

function executeUnifiedDecisionChain(input = {}) {
  const payload = isObject(input.payload) ? input.payload : isObject(input) ? input : {};
  const bestPicks = isObject(input.bestPicks) ? input.bestPicks
    : isObject(payload.bestPicks) ? payload.bestPicks : {};
  const premarketFlow = isObject(input.premarketFlow) ? input.premarketFlow : {};
  const premarketGate = isObject(input.premarketGate)
    ? input.premarketGate : buildPremarketGateFromFlow(premarketFlow);
  const decisionChain = runUnifiedDecisionChain({
    payload,
    bestPicks,
    premarketFlow,
    premarketGate,
  });
  const authorizedBestPicks = applyDecisionChainToBestPicks(bestPicks, decisionChain);
  return {
    version: 1,
    authority: "unified_decision_executor",
    premarketFlow,
    premarketGate,
    decisionChain,
    bestPicks: authorizedBestPicks,
  };
}

function unavailableDecisionChain(payload, reason) {
  const generation = generationSnapshot(isObject(payload) ? payload : {});
  const marketStage = {
    status: "blocked",
    passed: false,
    bigCycle: { key: "unavailable", label: "大周期待确认", status: "unavailable" },
    smallCycle: { key: "unavailable", label: "小周期待确认", status: "unavailable" },
    emotionStage: { key: "unavailable", label: "情绪阶段待确认", status: "unavailable", observationOnly: true },
    blockers: [text(reason, "统一决策链不可用")],
  };
  const authorization = {
    status: "blocked",
    passed: false,
    tradePermission: { status: "blocked", allowNew: false, allowAdd: false, reasons: marketStage.blockers },
    tradeValue: { key: "none", label: "无交易价值", status: "blocked", numericScore: null, calibrated: false },
    positionPermission: { status: "blocked", positionCeilingPct: 0, initialActivationPct: 0, addPermission: false },
    layers: [],
    reasons: marketStage.blockers,
  };
  const profitEffect = notEvaluated("赚钱效应", marketStage.blockers[0]);
  const theme = notEvaluated("题材", marketStage.blockers[0]);
  const stockMode = notEvaluated("股票模式", marketStage.blockers[0]);
  const stockSelectionContext = {
    status: "blocked",
    passed: false,
    authority: null,
    blockers: [marketStage.blockers[0]],
    rule: "统一决策链不可用时不读取旧个股排序上下文",
  };
  const observationCandidates = buildObservationCandidates(payload);
  const result = blockedResult(marketStage.blockers[0], authorization);
  const chain = {
    version: UNIFIED_DECISION_CHAIN_VERSION,
    method: "unavailable",
    authority: "canonical_stock_decision",
    generation,
    marketStage,
    authorization,
    profitEffect,
    theme,
    stockMode,
    stockSelectionContext,
    observationCandidates,
    result,
  };
  chain.steps = stepRows(chain);
  chain.integrity = {
    ok: false,
    failClosed: true,
    error: marketStage.blockers[0],
    maxResultStocks: MAX_RESULT_STOCKS,
    maxPullbackObservationStocks: MAX_PULLBACK_OBSERVATION_STOCKS,
    noForcedCandidate: true,
    observationCandidatesCannotGrantExecution: true,
    postEntryExpectationConditionalOnly: true,
    entryConfirmationRequired: true,
    opportunityDataCompletenessRequired: true,
    fundFlowCompletenessRequired: false,
  };
  return chain;
}

function applyDecisionChainToBestPicks(bestPicks, chain) {
  const source = isObject(bestPicks) ? bestPicks : {};
  const decision = isObject(chain) ? chain : unavailableDecisionChain({}, "统一决策链缺失");
  const selected = rows(decision.result && decision.result.stocks);
  const selectedByCode = new Map(selected.map((item) => [item.code, item]));
  const sourceByCode = new Map([
    ...rows(source.decisionPool),
    ...rows(source.picks),
  ].map((pick) => [codeOf(pick), pick]));
  const picks = selected.map((item) => {
    const pick = sourceByCode.get(item.code) || { code: item.code, name: item.name };
    return {
      ...projectCanonicalAllocation(pick, item.positionAllocation),
      decisionChainRank: item.rank,
      participationValue: item.participationValue,
      leadershipWeighting: item.leadershipWeighting,
      executionFeasibility: item.executionFeasibility,
      opportunityDataCompleteness: item.opportunityDataCompleteness,
      riskAdjustment: item.riskAdjustment,
      riskAdjustedParticipationScore: item.riskAdjustedParticipationScore,
      selectionAuthority: SELECTION_AUTHORITY,
    };
  });
  const scenarioPlans = rows(source.scenarioPlans).map((plan) => {
    const candidate = isObject(plan && plan.candidate) ? plan.candidate : null;
    if (!candidate) return plan;
    const code = codeOf(candidate);
    const allocation = selectedByCode.get(code);
    if (!allocation) {
      return {
        ...plan,
        status: "blocked",
        statusLabel: "统一决策链未授权",
        candidate: null,
        blockedCandidate: {
          code,
          name: text(candidate.name, code),
          reasons: [decision.result && decision.result.status === "blocked"
            ? "统一决策链上游关闭"
            : "未进入最终5只以内结果"],
        },
      };
    }
    return {
      ...plan,
      candidate: {
        ...projectCanonicalAllocation(candidate, allocation.positionAllocation),
        decisionChainRank: allocation.rank,
        participationValue: allocation.participationValue,
        executionFeasibility: allocation.executionFeasibility,
        opportunityDataCompleteness: allocation.opportunityDataCompleteness,
        riskAdjustment: allocation.riskAdjustment,
        riskAdjustedParticipationScore: allocation.riskAdjustedParticipationScore,
        selectionAuthority: SELECTION_AUTHORITY,
      },
    };
  });
  const available = decision.result && decision.result.status === "ready" && picks.length > 0;
  return {
    ...source,
    executionVersion: Math.max(3, Number(source.executionVersion || 0)),
    selectionAuthority: SELECTION_AUTHORITY,
    decisionChainVersion: decision.version,
    maxPicks: MAX_RESULT_STOCKS,
    available,
    tradeDisabled: !available,
    picks,
    // 大于5只的内部排序池只允许存在于统一链执行之前。执行后的公共
    // bestPicks 必须与最终结果完全同集，避免任何消费者把内部证据池
    // 重新解释成可执行候选。
    decisionPool: picks.map((pick) => ({ ...pick })),
    decisionPoolAuthority: SELECTION_AUTHORITY,
    decisionPoolExecutionScope: "authorized_result_only",
    scenarioPlans,
    allocation: decision.result && decision.result.participationAndAllocation || null,
    note: available
      ? `统一决策链筛出${picks.length}只（上限${MAX_RESULT_STOCKS}只）；${text(source.note)}`.trim()
      : `统一决策链未产生可执行股票：${text(
        decision.result && decision.result.blockers && decision.result.blockers[0]
        || decision.authorization && decision.authorization.reasons && decision.authorization.reasons[0]
        || source.note,
        "严格链路后为空",
      )}`,
  };
}

module.exports = {
  UNIFIED_DECISION_CHAIN_VERSION,
  MAX_RESULT_STOCKS,
  POST_ENTRY_NEXT_DAY_EXPECTATION_VERSION,
  ENTRY_CONFIRMATION_VERSION,
  STRICT_DECISION_ORDER,
  buildPostEntryNextDayExpectation,
  buildEntryConfirmation,
  inspectAuthoritativeDecisionChain,
  previousEmotionStageProjection,
  stockSelectionContextProjection,
  buildObservationCandidates,
  buildPremarketGateFromFlow,
  runUnifiedDecisionChain,
  executeUnifiedDecisionChain,
  unavailableDecisionChain,
  applyDecisionChainToBestPicks,
};
