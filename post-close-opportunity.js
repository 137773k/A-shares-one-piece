"use strict";

/**
 * Read-only product projection for the post-close "tomorrow opportunity" report.
 *
 * This module deliberately does not select stocks or score themes. It consumes the
 * existing premarket flow and tomorrow opportunity map, then projects only the
 * information that is safe to show after the close. Missing or contradictory
 * upstream state fails closed.
 */

const { buildPremarketFlow } = require("./premarket-flow");
const { buildTomorrowOpportunityMap } = require("./tomorrow-opportunity-map");

const VERSION = 1;
const METHOD = "rule_based";
const LIMITS = Object.freeze({
  maxThemes: 3,
  maxCoresPerTheme: 2,
  maxCoreStocks: 5,
  maxOpportunityObservationCards: 5,
  maxSetupCards: 2,
  maxWatchCards: 5,
});
const MAIN_RISE_KEYS = new Set(["main_rise", "full_main_rise", "partial_main_rise", "main_rise_pullback"]);
const BLOCKED_STEP_ORDER = Object.freeze([
  "indexOpportunity",
  "tradingPreference",
  "emotionStage",
  "direction",
  "stocks",
]);
const BLOCKED_STEP_REASONS = Object.freeze({
  indexOpportunity: "指数条件还没通过，明天先不新开仓。",
  tradingPreference: "资金偏好还没有落实到合格股票，暂时没有可执行载体。",
  emotionStage: "市场情绪还没确认，先等强弱和承接更清楚。",
  direction: "题材方向还没确认，暂时没有通过验证的主攻方向。",
  stocks: "核心股还没通过筛选，当前没有能进入买卖计划的标的。",
});
const ATTRIBUTION_CONFLICT_KEYS = new Set([
  "conflict",
  "conflicted",
  "ambiguous",
  "unresolved",
  "mismatch",
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function hasMeaningfulContent(value) {
  if (typeof value === "string") return clean(value).length > 0;
  if (Array.isArray(value)) return value.some(hasMeaningfulContent);
  if (isObject(value)) return Object.keys(value).length > 0;
  return typeof value === "number" && Number.isFinite(value);
}

function isBlockedPlanState(value) {
  return /^(?:blocked|rejected|unavailable|unknown|disabled|cancelled|canceled)$/.test(clean(value).toLowerCase());
}

function hasUsablePlanLeg(value) {
  if (!isObject(value)) return hasMeaningfulContent(value);
  if (isBlockedPlanState(value.status)) return false;
  return Object.entries(value).some(([key, item]) => key !== "status" && hasMeaningfulContent(item));
}

function cloneProjectionValue(value) {
  if (Array.isArray(value)) return value.map(cloneProjectionValue);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneProjectionValue(item)]),
    );
  }
  return value;
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value)) || [];
}

function unique(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean)));
}

function codeOf(value) {
  return clean(value && (value.code || value.secCode || value.stockCode || value.symbol));
}

function normalizeToken(value) {
  return clean(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s·•,，、/\\|_()（）\[\]{}-]+/g, "");
}

function themeTokens(value) {
  const source = isObject(value) ? value : {};
  return unique([
    source.id,
    source.family,
    source.name,
    source.displayName,
    ...firstArray(source.sourceThemeIds),
    ...firstArray(source.sourceThemeNames),
    ...firstArray(source.evidence && source.evidence.sourceThemeIds),
    ...firstArray(source.evidence && source.evidence.sourceThemeNames),
  ].map(normalizeToken));
}

function primaryAttributionTokens(value) {
  if (!isObject(value)) return [];
  const nested = [
    value.theme,
    value.primaryTheme,
    value.primaryAttribution,
    value.themeAttribution,
    value.themeOwnership && value.themeOwnership.decisionTimePrimary,
  ];
  const values = [
    value.themeId,
    value.themeName,
    value.themeFamily,
    value.mainThemeId,
    value.mainThemeName,
    value.mainTheme,
    value.mainConcept,
    value.mainFamily,
    value.primaryThemeId,
    value.primaryThemeName,
    value.primaryConcept,
    value.primaryFamily,
  ];
  nested.forEach((item) => {
    if (typeof item === "string") values.push(item);
    else if (isObject(item)) {
      values.push(item.id, item.name, item.family, item.concept, item.mainConcept, item.mainFamily);
    }
  });
  return unique(values.map(normalizeToken).filter(Boolean));
}

function primaryAttributionMismatch(theme, ...values) {
  if (!theme) return false;
  const expected = new Set(unique([
    ...themeTokens(theme.mapDirection),
    ...themeTokens(theme.flowTheme),
  ]));
  if (!expected.size) return false;
  return values.filter(isObject).some((value) => {
    const declared = primaryAttributionTokens(value);
    return declared.length > 0 && !declared.some((token) => expected.has(token));
  });
}

function tokensOverlap(left, right) {
  const leftSet = new Set(themeTokens(left));
  return themeTokens(right).some((token) => leftSet.has(token));
}

function looksLikePayload(value) {
  if (!isObject(value)) return false;
  return [
    "themeLibrary",
    "tomorrowDecision",
    "market",
    "candidates",
    "premarketModels",
    "bestPicks",
  ].some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function looksLikePremarketFlow(value) {
  return isObject(value)
    && isObject(value.indexOpportunity)
    && isObject(value.direction)
    && isObject(value.tradePlan);
}

function looksLikeOpportunityMap(value) {
  return isObject(value)
    && isObject(value.globalGate)
    && Array.isArray(value.directions)
    && isObject(value.integrity);
}

function safelyBuild(builder, value, errors, label) {
  try {
    return builder(value);
  } catch (error) {
    errors.push(`${label}_build_failed`);
    return null;
  }
}

function resolveSources(input) {
  const source = isObject(input) ? input : {};
  const explicitPayload = isObject(source.payload) ? source.payload : null;
  const payload = explicitPayload || (looksLikePayload(source) ? source : null);
  const errors = [];

  let premarketFlow = null;
  let premarketFlowSource = "unavailable";
  if (looksLikePremarketFlow(source.premarketFlow)) {
    premarketFlow = source.premarketFlow;
    premarketFlowSource = "provided";
  } else if (looksLikePremarketFlow(source.flow)) {
    premarketFlow = source.flow;
    premarketFlowSource = "provided";
  } else if (looksLikePremarketFlow(source)) {
    premarketFlow = source;
    premarketFlowSource = "provided";
  } else if (payload) {
    premarketFlow = safelyBuild(buildPremarketFlow, payload, errors, "premarket_flow");
    if (premarketFlow) premarketFlowSource = "derived_from_payload";
  }

  let opportunityMap = null;
  let opportunityMapSource = "unavailable";
  if (looksLikeOpportunityMap(source.opportunityMap)) {
    opportunityMap = source.opportunityMap;
    opportunityMapSource = "provided";
  } else if (looksLikeOpportunityMap(source.tomorrowOpportunityMap)) {
    opportunityMap = source.tomorrowOpportunityMap;
    opportunityMapSource = "provided";
  } else if (looksLikeOpportunityMap(source)) {
    opportunityMap = source;
    opportunityMapSource = "provided";
  } else if (payload) {
    opportunityMap = safelyBuild(buildTomorrowOpportunityMap, { payload }, errors, "opportunity_map");
    if (opportunityMap) opportunityMapSource = "derived_from_payload";
  }

  return {
    payload,
    premarketFlow,
    opportunityMap,
    errors,
    sourceLabels: {
      premarketFlow: premarketFlowSource,
      opportunityMap: opportunityMapSource,
    },
  };
}

function attributionStatus(...values) {
  const rows = values.filter(isObject);
  for (const value of rows) {
    if (
      value.attributionConflict === true
      || value.themeAttributionConflict === true
      || value.dataQuality && value.dataQuality.attributionConflict === true
    ) return "conflict";
    const nested = [value.attribution, value.themeAttribution].filter(isObject);
    if (nested.some((item) => (
      item.conflict === true
      || ATTRIBUTION_CONFLICT_KEYS.has(clean(item.status || item.state).toLowerCase())
    ))) return "conflict";
    const reasonCodes = unique([
      ...firstArray(value.reasonCodes),
      ...firstArray(value.evidence && value.evidence.reasonCodes),
    ]).map((item) => item.toLowerCase());
    if (reasonCodes.some((item) => /attribution.*(?:conflict|ambiguous|mismatch)|theme_attribution_conflict/.test(item))) {
      return "conflict";
    }
  }
  return "clear";
}

function dataStatusOf(resolved) {
  const reasonCodes = [...resolved.errors];
  const reasons = [];
  if (!resolved.premarketFlow) {
    reasonCodes.push("premarket_flow_missing");
    reasons.push("盘前流程结果还没有准备好。");
  }
  if (!resolved.opportunityMap) {
    reasonCodes.push("opportunity_map_missing");
    reasons.push("题材与核心股映射还没有准备好。");
  }
  if (resolved.opportunityMap && resolved.opportunityMap.integrity && resolved.opportunityMap.integrity.ok === false) {
    reasonCodes.push("opportunity_map_integrity_failed");
    reasons.push("题材或核心股数据没有通过完整性检查。");
  }
  const themeLibrary = resolved.payload && resolved.payload.themeLibrary;
  if (themeLibrary && themeLibrary.available === false) {
    reasonCodes.push("theme_library_unavailable");
    reasons.push("题材库当前不可用。");
  }
  if (themeLibrary && themeLibrary.stale === true) {
    reasonCodes.push("theme_library_stale");
    reasons.push("题材库数据已经过期。");
  }
  const unavailable = reasonCodes.some((code) => (
    /missing|unavailable|stale|failed/.test(code)
  ));
  return {
    status: unavailable ? "unavailable" : "ready",
    usable: !unavailable,
    reasonCodes: unique(reasonCodes),
    reasons: unique(reasons),
    asOf: clean(resolved.premarketFlow && resolved.premarketFlow.sourceUpdatedAt) || null,
  };
}

function blockedStepKeys(flow) {
  if (!isObject(flow)) return ["data"];
  const blocked = [];
  const steps = [
    ["indexOpportunity", flow.indexOpportunity],
    ["tradingPreference", flow.tradingPreference],
    ["emotionStage", flow.emotionStage],
    ["direction", flow.direction],
    ["stocks", flow.stocks],
  ];
  steps.forEach(([key, step]) => {
    if (!isObject(step) || step.status !== "ready") blocked.push(key);
  });
  if (flow.indexOpportunity && !["allowed", "conditional"].includes(clean(flow.indexOpportunity.permission))) {
    blocked.push("indexOpportunity");
  }
  if (flow.tradingPreference && flow.tradingPreference.executionBlocked === true) blocked.push("tradingPreference");
  if (
    !flow.direction
    || flow.direction.executionBlocked === true
    || !flow.direction.confirmation
    || flow.direction.confirmation.status !== "confirmed"
  ) blocked.push("direction");
  if (flow.status === "blocked" && flow.blockedAt) blocked.push(flow.blockedAt);
  return unique(blocked).sort((left, right) => {
    const leftRank = BLOCKED_STEP_ORDER.indexOf(left);
    const rightRank = BLOCKED_STEP_ORDER.indexOf(right);
    return (leftRank < 0 ? Number.MAX_SAFE_INTEGER : leftRank)
      - (rightRank < 0 ? Number.MAX_SAFE_INTEGER : rightRank);
  });
}

function marketPermissionOf(flow, opportunityMap, dataStatus) {
  const reasonCodes = [];
  const reasons = [];
  const upstreamBlocked = blockedStepKeys(flow);
  const mapGate = opportunityMap && opportunityMap.globalGate;
  const mapGateStatus = clean(mapGate && mapGate.status).toLowerCase();
  const mapGateAllowsTrade = Boolean(
    mapGate
    && mapGate.canTradeCandidates === true
    && ["open", "conditional"].includes(mapGateStatus)
  );
  if (!dataStatus.usable) {
    reasonCodes.push("data_not_usable");
    reasons.push("关键盘后数据还没有准备好，现在不能可靠地判断明日机会。");
  }
  if (upstreamBlocked.length) {
    reasonCodes.push(...upstreamBlocked.map((key) => `upstream_${key}`));
    reasons.push("大盘、资金偏好、题材、情绪或核心股的上游交易条件还没有同时通过。");
  }
  if (!mapGateAllowsTrade) {
    reasonCodes.push("opportunity_gate_closed");
    reasons.push("当前市场条件还不支持新开仓。");
  }
  const blocked = reasonCodes.length > 0;
  const finalPlans = flow && flow.tradePlan;
  const executablePlansReady = Boolean(
    finalPlans
    && finalPlans.status === "ready"
    && finalPlans.canIssueAdvice === true
    && firstArray(finalPlans.plans).length > 0
  );
  return {
    status: blocked
      ? "blocked"
      : mapGateStatus === "open" && executablePlansReady ? "allowed" : "conditional",
    canCreateOpportunities: !blocked && executablePlansReady,
    positionLimit: clean(flow && flow.indexOpportunity && flow.indexOpportunity.positionLimit) || null,
    blockedSteps: upstreamBlocked,
    reasonCodes: unique(reasonCodes),
    reasons: unique(reasons),
  };
}

function flowThemeFor(mapDirection, flowThemes) {
  return firstArray(flowThemes).find((theme) => tokensOverlap(mapDirection, theme)) || null;
}

function coreProjection(anchor) {
  return {
    code: codeOf(anchor) || null,
    name: clean(anchor && anchor.name) || codeOf(anchor) || null,
    role: clean(anchor && (anchor.anchorType || anchor.role || anchor.roleLabel)) || null,
    identity: clean(anchor && (anchor.identity || anchor.identityState)) || null,
    usage: clean(anchor && anchor.usage) || "observe_only",
    source: "opportunityMap.directions[].emotionAnchors",
  };
}

function safeTextList(value, limit = 3) {
  const rows = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return unique(rows.filter((item) => typeof item === "string")).slice(0, limit);
}

function observationTextList(value, limit = 3) {
  return safeTextList(value, Number.MAX_SAFE_INTEGER)
    .filter((item) => !/可(?:以)?买|买入|下单|开仓|加仓/.test(item))
    .slice(0, limit);
}

function safeCodeList(value, limit = 3) {
  const rows = Array.isArray(value) ? value : [];
  return unique(rows.map((item) => (
    typeof item === "string" || typeof item === "number" ? item : codeOf(item)
  ))).slice(0, limit);
}

function projectCanonicalRecentRelation(raw, status) {
  const dominant = isObject(raw.dominant) ? raw.dominant : {};
  const today = isObject(raw.today) ? raw.today : {};
  const todayIndex = isObject(today.index) ? today.index : {};
  const todayEmotion = isObject(today.emotion) ? today.emotion : {};
  const todayRegime = isObject(todayIndex.regime) ? todayIndex.regime : {};
  const transition = isObject(raw.transition) ? raw.transition : {};
  const opportunityBias = isObject(raw.opportunityBias) ? raw.opportunityBias : {};
  const usability = isObject(raw.usability) ? raw.usability : {};
  const window = isObject(raw.window) ? raw.window : {};
  const projectDay = (item) => {
    const day = isObject(item) ? item : {};
    const index = isObject(day.index) ? day.index : {};
    const emotion = isObject(day.emotion) ? day.emotion : {};
    const regime = isObject(index.regime) ? index.regime : {};
    const height = isObject(day.heightConsensus) ? day.heightConsensus : {};
    return {
      tradingDate: clean(day.tradingDate) || null,
      valid: day.valid === true,
      relationKey: clean(day.relationKey) || "unknown",
      relationLabel: clean(day.relationLabel) || null,
      index: {
        strength: clean(index.strength) || "unknown",
        label: clean(index.label) || null,
        shortTermLabel: clean(regime.shortTermLabel) || null,
        mediumTermLabel: clean(regime.mediumTermLabel) || null,
      },
      emotion: {
        strength: clean(emotion.strength) || "unknown",
        phaseKey: clean(emotion.phaseKey) || null,
        phaseLabel: clean(emotion.phaseLabel) || null,
        qualityKey: clean(emotion.qualityKey) || null,
        qualityLabel: clean(emotion.qualityLabel) || null,
      },
      heightConsensus: {
        key: clean(height.key) || null,
        label: clean(height.label) || null,
        note: clean(height.note) || null,
        marketEmotionEligible: false,
      },
    };
  };
  const daily = firstArray(raw.daily).slice(-5).map(projectDay);
  const summary = clean(raw.summary)
    || [clean(dominant.label), clean(today.relationLabel)].filter(Boolean).join("；")
    || null;
  return {
    version: Number(raw.version || 0) || 1,
    method: "recent_index_participatory_emotion_relation",
    calibrated: false,
    title: "近期指数—情绪关系",
    status,
    usability: {
      usable: status === "ready" && usability.usable === true,
      key: clean(usability.key) || null,
      reason: clean(usability.reason) || null,
    },
    window: {
      short: Number(window.short || 0) || 3,
      confirm: Number(window.confirm || 0) || 5,
      available: Number.isFinite(Number(window.available)) ? Number(window.available) : null,
    },
    dominant: {
      key: clean(dominant.key) || "unknown",
      label: clean(dominant.label) || null,
      reason: clean(dominant.reason) || null,
      seesawConfirmed: dominant.seesawConfirmed === true,
      confirmedByFiveDay: dominant.confirmedByFiveDay === true,
    },
    today: {
      title: "今日变化",
      tradingDate: clean(today.tradingDate) || null,
      valid: today.valid === true,
      relationKey: clean(today.relationKey) || "unknown",
      relationLabel: clean(today.relationLabel) || null,
      index: {
        strength: clean(todayIndex.strength) || "unknown",
        label: clean(todayIndex.label) || null,
        shortTermLabel: clean(todayRegime.shortTermLabel) || null,
        mediumTermLabel: clean(todayRegime.mediumTermLabel) || null,
      },
      emotion: {
        strength: clean(todayEmotion.strength) || "unknown",
        phaseKey: clean(todayEmotion.phaseKey) || null,
        phaseLabel: clean(todayEmotion.phaseLabel) || null,
        qualityKey: clean(todayEmotion.qualityKey) || null,
        qualityLabel: clean(todayEmotion.qualityLabel) || null,
      },
    },
    transition: {
      changed: transition.changed === true,
      seesawConfirmed: transition.seesawConfirmed === true,
      note: clean(transition.note) || null,
    },
    daily,
    opportunityBias: {
      key: clean(opportunityBias.key) || null,
      label: clean(opportunityBias.label) || null,
      riskAdjustment: /^(?:reduce|neutral|avoid)$/.test(clean(opportunityBias.riskAdjustment))
        ? clean(opportunityBias.riskAdjustment)
        : "avoid",
      focus: clean(opportunityBias.focus) || null,
      reason: clean(opportunityBias.reason) || null,
    },
    relation: clean(dominant.key) || clean(today.relationKey) || null,
    indexState: clean(todayRegime.shortTermLabel) || clean(todayIndex.label) || null,
    emotionState: clean(todayEmotion.phaseLabel) || null,
    summary,
    evidence: safeTextList([
      dominant.reason,
      transition.note,
      opportunityBias.reason,
    ], 3),
    validationCodes: safeCodeList(raw.validationCodes, 3),
    generationId: clean(raw.generationId) || null,
    tradingDate: clean(raw.tradingDate) || clean(today.tradingDate) || null,
    asOf: clean(raw.asOf) || null,
    source: "payload.recentIndexEmotionRelation",
    integrity: {
      safeProjection: true,
      unknownFieldsExcluded: true,
      numericForecastExcluded: true,
      participatoryEmotionOnly: true,
      heightConsensusSeparated: true,
      observationOnly: true,
    },
  };
}

function projectRecentRelation(payload) {
  const raw = isObject(payload && payload.recentIndexEmotionRelation)
    ? payload.recentIndexEmotionRelation
    : null;
  const rawStatus = clean(raw && (raw.status || raw.state)).toLowerCase();
  const status = !raw
    ? "insufficient"
    : /^(?:cancelled|canceled|invalid|failed|rejected|blocked)$/.test(rawStatus)
      ? "cancelled"
      : /^(?:ready|confirmed|valid|observed)$/.test(rawStatus)
        ? "ready"
        : "insufficient";
  if (raw && clean(raw.method) === "recent_index_participatory_emotion_relation") {
    return projectCanonicalRecentRelation(raw, status);
  }
  return {
    status,
    relation: clean(raw && raw.relation) || null,
    indexState: clean(raw && raw.indexState) || null,
    emotionState: clean(raw && raw.emotionState) || null,
    summary: clean(raw && raw.summary) || null,
    evidence: safeTextList(raw && raw.evidence, 3),
    validationCodes: safeCodeList(raw && raw.validationCodes, 3),
    asOf: clean(raw && raw.asOf) || null,
    source: "payload.recentIndexEmotionRelation",
    integrity: {
      safeProjection: true,
      unknownFieldsExcluded: true,
      numericForecastExcluded: true,
    },
  };
}

function generationAlignmentOf(payload) {
  const source = isObject(payload) ? payload : {};
  const rawTradingDate = clean(
    source.tradingDate
    || source.market && source.market.snapshot && (
      source.market.snapshot.tradingDate
      || source.market.snapshot.date
      || source.market.snapshot.tradeDate
    )
    || source.themeLibrary && source.themeLibrary.tradingDate,
  );
  const dateMatch = rawTradingDate.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  const tradingDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;
  const asOf = clean(source.fetchedAt || source.updatedAt) || null;
  const derivedGeneration = tradingDate && asOf ? `${tradingDate}:${asOf}` : null;
  const reportGeneration = clean(
    source.tomorrowDecision && source.tomorrowDecision.generationId
    || source.premarketModels && source.premarketModels.generationId
    || derivedGeneration,
  ) || null;
  const relationGeneration = clean(
    source.recentIndexEmotionRelation && source.recentIndexEmotionRelation.generationId,
  ) || null;
  const generations = unique([
    source.premarketModels && source.premarketModels.generationId,
    source.tomorrowDecision && source.tomorrowDecision.generationId,
    source.recentIndexEmotionRelation && source.recentIndexEmotionRelation.generationId,
    derivedGeneration,
  ]);
  if (!generations.length) {
    return { aligned: true, reportGeneration: null, relationGeneration: null };
  }
  return {
    aligned: Boolean(reportGeneration && relationGeneration && generations.length === 1),
    reportGeneration,
    relationGeneration,
  };
}

function generationMismatchRelation() {
  return {
    status: "insufficient",
    usability: {
      usable: false,
      key: "generation_mismatch",
      reason: "近期关系和本次盘后行情不是同一批数据，正在重新生成。",
    },
    relation: null,
    indexState: null,
    emotionState: null,
    summary: null,
    evidence: [],
    validationCodes: [],
    generationId: null,
    asOf: null,
    source: "payload.recentIndexEmotionRelation",
    integrity: {
      safeProjection: true,
      unknownFieldsExcluded: true,
      numericForecastExcluded: true,
      observationOnly: true,
    },
  };
}

function nestedCodeOf(value) {
  return codeOf(value)
    || codeOf(value && value.stock)
    || codeOf(value && value.candidate);
}

function selectedStateOf(payload) {
  const bestPicks = isObject(payload && payload.bestPicks) ? payload.bestPicks : {};
  const known = Boolean(
    Array.isArray(payload && payload.selected)
    || Array.isArray(payload && payload.bestPicks)
    || Array.isArray(bestPicks.picks)
  );
  const rows = [
    ...firstArray(payload && payload.selected),
    ...(Array.isArray(payload && payload.bestPicks) ? payload.bestPicks : firstArray(bestPicks.picks)),
  ];
  return {
    known,
    codes: new Set(unique(rows.map(nestedCodeOf))),
  };
}

function coreStatusOf(anchor) {
  const value = clean(anchor && (anchor.identity || anchor.identityState)).toLowerCase();
  if (/current[\s_-]*core|当前核心|当下核心|现任核心/.test(value)) return "current";
  if (/historical[\s_-]*core|history[\s_-]*core|历史核心|前期核心/.test(value)) return "historical";
  return "pending";
}

function coreRoleKind(anchor) {
  const value = clean(anchor && (
    anchor.anchorType
    || anchor.role
    || anchor.roleLabel
    || anchor.leadershipRole
  )).toLowerCase();
  if (/^height$|高度/.test(value)) return "height";
  if (/^sentiment$|情绪/.test(value)) return "emotion";
  return "theme";
}

function defaultPathRule(pathKey) {
  if (pathKey === "boardEmotion") {
    return {
      trigger: ["情绪核心先有真实分歧", "分歧后重新转强并带动同类核心", "指数没有同步转弱"],
      cancel: ["情绪核心回流失败并继续走弱", "负反馈向中位股扩散", "指数与情绪同时转弱"],
      risk: "一字高度或单票独强不能代替可参与情绪核心的真实承接。",
    };
  }
  if (pathKey === "heightOnly") {
    return {
      trigger: ["观察市场高度能否维持", "同时等待可参与核心给出承接"],
      cancel: ["只剩高度独强而可参与核心继续走弱"],
      risk: "高度核心可能买不到或不具备参与性，只能观察高度，不能代表情绪可交易。",
    };
  }
  return {
    trigger: ["题材核心先分歧但关键结构未破", "核心重新转强并带动同题材股票", "题材强度重新领先市场"],
    cancel: ["题材核心跌破关键结构", "只剩单票独强而题材没有跟随", "题材强度继续落后市场"],
    risk: "题材回流可能只是单票脉冲，必须由核心与题材扩散共同验证。",
  };
}

function pathRuleOf(flow, pathKey) {
  const fallback = defaultPathRule(pathKey);
  if (pathKey === "heightOnly") return fallback;
  const pathRow = firstArray(flow && flow.tradingPreference && flow.tradingPreference.opportunities)
    .find((row) => clean(row && row.path) === pathKey);
  const trigger = observationTextList(pathRow && pathRow.trigger, 3);
  const cancel = observationTextList(pathRow && (pathRow.cancel || pathRow.cancelConditions), 3);
  return {
    trigger: trigger.length ? trigger : fallback.trigger,
    cancel: cancel.length ? cancel : fallback.cancel,
    risk: fallback.risk,
  };
}

function directionWhy(theme) {
  const evidence = isObject(theme && theme.mapDirection && theme.mapDirection.evidence)
    ? theme.mapDirection.evidence
    : {};
  const name = theme && theme.public && theme.public.name || "该题材";
  if (evidence.isMainLine === true) return name + "当前属于主线观察方向。";
  if (evidence.resonance === true && evidence.sustained === true) return name + "已有共振和持续性证据。";
  if (evidence.resonance === true) return name + "已有共振，但持续性仍要验证。";
  return name + "仍处于候选观察层。";
}

function coreWhy(card) {
  if (card.usage === "height_only") return "它只代表市场高度，不能替代可参与情绪核心。";
  if (card.coreStatus === "current") return "它被上游识别为当下核心，用于验证结构是否延续。";
  if (card.coreStatus === "historical") return "它是历史核心，必须重新证明仍有带动性。";
  return "它的核心身份仍待确认，只能作为辅助观察。";
}

function observationUsage(roleKind, mapCandidate) {
  if (roleKind === "height") return "height_only";
  if (roleKind === "emotion") return "validate_emotion";
  if (mapCandidate && mapCandidate.active === true && mapCandidate.tradeQualified === true) {
    return "execution_candidate";
  }
  return "validate_theme";
}

function buildObservationRows(resolved, flow, themeLists, marketPermission, opportunityCards) {
  const executableCodes = new Set(firstArray(opportunityCards).map(codeOf));
  const selectedState = selectedStateOf(resolved.payload || {});
  const confirmedRows = new Set(themeLists.confirmed);
  const rows = [];
  const seen = new Set();

  themeLists.candidates.forEach((theme) => {
    if (!theme || theme.public.attributionStatus === "conflict") return;
    const mapDirection = theme.mapDirection || {};
    const candidatesByCode = new Map(firstArray(mapDirection.tradeCandidates)
      .map((candidate) => [codeOf(candidate), candidate])
      .filter(([code]) => code));
    const sourceRows = [];
    firstArray(mapDirection.emotionAnchors).forEach((anchor) => {
      sourceRows.push({ anchor, anchorSource: "opportunityMap.directions[].emotionAnchors" });
    });
    firstArray(mapDirection.tradeCandidates).forEach((candidate) => {
      if (!firstArray(mapDirection.emotionAnchors).some((anchor) => codeOf(anchor) === codeOf(candidate))) {
        sourceRows.push({ anchor: candidate, anchorSource: "opportunityMap.directions[].tradeCandidates" });
      }
    });

    sourceRows.forEach(({ anchor, anchorSource }) => {
      const code = codeOf(anchor);
      const rowKey = clean(theme.public.id) + "|" + code;
      if (!code || seen.has(rowKey) || attributionStatus(anchor) === "conflict") return;
      seen.add(rowKey);
      const mapCandidate = candidatesByCode.get(code) || null;
      const roleKind = coreRoleKind(anchor);
      const usage = observationUsage(roleKind, mapCandidate);
      const coreStatus = coreStatusOf(anchor);
      const pathKey = roleKind === "height" ? "heightOnly" : roleKind === "emotion" ? "boardEmotion" : "highTrend";
      const rule = pathRuleOf(flow, pathKey);
      const blockers = ["not_in_final_plan"];
      if (marketPermission.status === "blocked") blockers.push("execution_gate_closed");
      if (selectedState.known && !selectedState.codes.has(code)) blockers.push("not_in_selected_pool");
      if (!confirmedRows.has(theme)) blockers.push("theme_not_confirmed");
      if (coreStatus === "historical") blockers.push("historical_core_needs_revalidation");
      if (coreStatus === "pending") blockers.push("core_identity_pending");
      if (usage === "height_only") blockers.push("height_only_not_emotion_proxy");
      const card = {
        code,
        name: clean(anchor && anchor.name) || code,
        themeId: theme.public.id,
        themeName: theme.public.name,
        role: clean(anchor && (anchor.anchorType || anchor.role || anchor.roleLabel)) || null,
        identity: clean(anchor && (anchor.identity || anchor.identityState || anchor.leadershipRole)) || null,
        coreStatus,
        usage,
        why: safeTextList([directionWhy(theme), coreWhy({ usage, coreStatus })], 3),
        trigger: safeTextList(rule.trigger, 3),
        cancel: safeTextList(rule.cancel, 3),
        blockers: unique(blockers),
        pathKey,
        source: {
          theme: "opportunityMap.directions",
          anchor: anchorSource,
          execution: "opportunityCards_only",
        },
      };
      rows.push({
        card,
        roleKind,
        theme,
        isExecutable: executableCodes.has(code),
      });
    });
  });

  return {
    rows,
    watchCards: rows
      .filter((row) => !row.isExecutable)
      .slice(0, LIMITS.maxWatchCards)
      .map((row) => row.card),
  };
}

function unifiedObservationGeneration(payload, generationAlignment) {
  const chain = isObject(payload && payload.unifiedDecisionChain)
    ? payload.unifiedDecisionChain
    : null;
  const generation = isObject(chain && chain.generation) ? chain.generation : null;
  const generationId = clean(generation && generation.generationId) || null;
  const tradingDate = clean(generation && generation.tradingDate) || null;
  const expectedGenerationId = clean(generationAlignment && generationAlignment.reportGeneration) || null;
  const expectedTradingDate = expectedGenerationId && expectedGenerationId.includes(":")
    ? expectedGenerationId.slice(0, 10)
    : clean(payload && payload.tradingDate) || null;
  return {
    chain,
    generation,
    generationId,
    tradingDate,
    aligned: Boolean(
      chain
      && generation
      && generation.aligned === true
      && generationId
      && tradingDate
      && (!expectedGenerationId || generationId === expectedGenerationId)
      && (!expectedTradingDate || tradingDate === expectedTradingDate)
    ),
  };
}

function observationFatalRisk(stock) {
  if (!isObject(stock)) return true;
  if (stock.fatalRisk === true || clean(stock.riskStatus).toLowerCase() === "fatal") return true;
  return firstArray(stock.riskNotes).some((item) => /致命风险|停牌|退市|价格异常|数据异常/.test(clean(item)));
}

function buildOpportunityObservationCards(payload, opportunityCards, generationAlignment, dataStatus) {
  const generationState = unifiedObservationGeneration(payload, generationAlignment);
  const observation = isObject(generationState.chain && generationState.chain.observationCandidates)
    ? generationState.chain.observationCandidates
    : null;
  const sourceStatus = clean(observation && observation.status).toLowerCase();
  const sourceValid = Boolean(
    dataStatus && dataStatus.usable === true
    && generationAlignment && generationAlignment.aligned === true
    && generationState.aligned
    && observation
    && ["available", "empty"].includes(sourceStatus)
    && observation.observationOnly === true
    && observation.executionAuthority === false
    && Array.isArray(observation.stocks)
  );
  if (!sourceValid) {
    return {
      state: {
        status: "unavailable",
        sourceCount: 0,
        eligibleCount: 0,
        rejectedCount: 0,
        reason: "本次统一机会观察池未通过数据或代次校验，不沿用旧观察票。",
      },
      cards: [],
      rejected: [],
    };
  }

  const finalCodes = new Set(firstArray(opportunityCards).map(codeOf));
  const payloadCandidates = new Map(firstArray(payload && payload.candidates)
    .map((candidate) => [codeOf(candidate), candidate])
    .filter(([code]) => code));
  const seenCodes = new Set();
  const cards = [];
  const rejected = [];
  firstArray(observation.stocks).forEach((stock) => {
    const code = codeOf(stock);
    const name = clean(stock && stock.name) || code;
    const completeness = isObject(stock && stock.opportunityDataCompleteness)
      ? stock.opportunityDataCompleteness
      : null;
    const expectation = isObject(stock && stock.expectation) ? stock.expectation : null;
    const postEntry = isObject(stock && stock.postEntryNextDayExpectation)
      ? stock.postEntryNextDayExpectation
      : null;
    const confirmation = isObject(stock && stock.entryConfirmation) ? stock.entryConfirmation : null;
    const profitPreference = isObject(stock && stock.profitPreference) ? stock.profitPreference : null;
    const capitalPreference = isObject(stock && stock.capitalPreference) ? stock.capitalPreference : null;
    const feasibility = isObject(stock && stock.executionFeasibility) ? stock.executionFeasibility : null;
    const payloadCandidate = payloadCandidates.get(code) || null;
    const reasonCodes = [];
    if (!code || !name) reasonCodes.push("identity_missing");
    if (code && finalCodes.has(code)) reasonCodes.push("already_in_final_plan");
    if (code && seenCodes.has(code)) reasonCodes.push("duplicate_code");
    if (stock.observationOnly !== true || stock.executionAuthority !== false || stock.executable !== false) {
      reasonCodes.push("observation_boundary_invalid");
    }
    if (stock.hardGatePassed !== true) reasonCodes.push("hard_gate_failed");
    if (
      !completeness
      || completeness.status !== "complete"
      || completeness.qualified !== true
      || completeness.opportunityEligible !== true
      || clean(completeness.tradingDate) !== generationState.tradingDate
      || firstArray(completeness.missingFields).length
      || firstArray(completeness.blockers).length
      || !["price", "amount", "liquidityCapacity", "marketCap", "session"].every((key) => (
        isObject(completeness.evidence && completeness.evidence[key])
        && completeness.evidence[key].usable === true
      ))
      || !isObject(completeness.evidence && completeness.evidence.fundFlow)
      || completeness.evidence.fundFlow.required !== false
    ) reasonCodes.push("opportunity_data_incomplete");
    if (
      !expectation
      || expectation.status !== "qualified"
      || !clean(expectation.label)
      || !firstArray(expectation.evidence).map(clean).filter(Boolean).length
      || !firstArray(expectation.evidenceSources).map(clean).filter(Boolean).length
    ) {
      reasonCodes.push("tomorrow_expectation_missing");
    }
    if (
      !confirmation
      || confirmation.status !== "waiting_trigger"
      || confirmation.activated !== false
      || !clean(confirmation.label)
      || !firstArray(confirmation.triggerConditions).map(clean).filter(Boolean).length
    ) {
      reasonCodes.push("entry_confirmation_unavailable");
    }
    if (
      !postEntry
      || postEntry.status !== "conditional"
      || postEntry.horizon !== "entry_t_plus_1"
      || !clean(postEntry.label)
      || postEntry.observationOnly !== true
      || postEntry.executionAuthority !== false
      || postEntry.probability !== null
      || postEntry.calibrated !== false
    ) reasonCodes.push("post_entry_expectation_unavailable");
    if (!profitPreference || profitPreference.matched !== true) reasonCodes.push("profit_path_mismatch");
    if (!capitalPreference || capitalPreference.matched !== true) reasonCodes.push("capital_preference_mismatch");
    if (
      !feasibility
      || !["ready", "conditional"].includes(clean(feasibility.status).toLowerCase())
      || feasibility.executableNow !== false
      || feasibility.canGrantExecution !== false
      || feasibility.onlyTightens !== true
      || firstArray(feasibility.blockers).length
    ) reasonCodes.push("execution_feasibility_blocked");
    if (observationFatalRisk(stock)) reasonCodes.push("fatal_risk");
    const previousLimitUpOnly = Boolean(payloadCandidate && payloadCandidate.previousLimitUpOnly === true);
    if (previousLimitUpOnly) {
      const factorContext = isObject(payloadCandidate.factorContext) ? payloadCandidate.factorContext : null;
      const previousEvidence = isObject(payloadCandidate.previousLimitUpEvidence)
        ? payloadCandidate.previousLimitUpEvidence
        : null;
      if (
        !factorContext
        || clean(factorContext.generationId) !== generationState.generationId
        || clean(factorContext.tradingDate) !== generationState.tradingDate
        || !previousEvidence
        || previousEvidence.authority !== "exact_t1_closing_limit_pool"
        || previousEvidence.status !== "verified"
        || previousEvidence.exactClosing !== true
        || previousEvidence.closedAtLimit !== true
        || previousEvidence.priceDiscoveryVerified !== true
        || previousEvidence.oneWord === true
        || previousEvidence.noPriceDiscovery === true
        || !clean(previousEvidence.tradingDate)
      ) reasonCodes.push("supplemental_t1_provenance_invalid");
    }
    if (reasonCodes.length) {
      rejected.push({ code: code || null, name: name || null, reasonCodes: unique(reasonCodes) });
      return;
    }

    seenCodes.add(code);
    if (cards.length >= LIMITS.maxOpportunityObservationCards) return;
    const confirmationConditions = firstArray(confirmation.triggerConditions).map(clean).filter(Boolean);
    const cancelConditions = unique([
      ...firstArray(stock.cancelConditions),
      confirmation.invalidation,
      postEntry.invalidation,
    ]);
    const missingConditions = firstArray(stock.missingConditions)
      .map(clean)
      .filter((item) => item && !/统一交易授权|新开仓权限|仓位权限/.test(item));
    cards.push({
      code,
      name,
      themeName: clean(stock.theme) || "题材待确认",
      pathKey: clean(stock.path) || null,
      pathLabel: clean(stock.pathLabel) || "路径待确认",
      role: clean(stock.role) || "角色待确认",
      tierKey: clean(stock.tierKey) || null,
      tierLabel: clean(stock.tierLabel) || "机会观察",
      reason: clean(stock.observationReason || expectation.label),
      entryConfirmation: clean(confirmation.label),
      nextDayExpectation: clean(postEntry.label),
      confirmationConditions: confirmationConditions.slice(0, 2),
      cancelCondition: cancelConditions[0] || "观察条件失效时取消",
      missingCondition: missingConditions[0] || "等待统一交易授权开放",
      sourceScope: previousLimitUpOnly ? "supplemental_t1_observation" : "current_market_sample",
      marketInferenceEligible: previousLimitUpOnly ? false : null,
      observationOnly: true,
      executionAuthority: false,
      source: "unifiedDecisionChain.observationCandidates.stocks",
    });
  });

  const status = cards.length ? "available" : "empty";
  return {
    state: {
      status,
      sourceCount: firstArray(observation.stocks).length,
      eligibleCount: cards.length,
      rejectedCount: rejected.length,
      reason: cards.length
        ? `当前有${cards.length}只通过观察级硬门槛，仍未获得交易授权。`
        : firstArray(observation.stocks).length
          ? "现有候选均未同时通过观察级硬门槛、数据完整度和明日确认条件。"
          : "当前统一决策链没有产生机会观察股。",
    },
    cards,
    rejected,
  };
}

function setupDefinition(key) {
  if (key === "emotion_core_divergence_reflow") {
    return {
      key,
      label: "情绪核心分歧回流",
      primaryDriver: "emotion_core",
      pathKey: "boardEmotion",
      normalPath: "指数保持可做 → 可参与情绪核心先分歧 → 核心重新转强并带动同类。",
      risk: "把一字高度或单票独强误当成可参与情绪回流，会高估真实赚钱效应。",
    };
  }
  return {
    key,
    label: "题材趋势核心分歧回流",
    primaryDriver: "theme_trend_core",
    pathKey: "highTrend",
    normalPath: "题材趋势未破 → 核心先分歧释放压力 → 核心重新转强并带动题材回流。",
    risk: "题材可能只出现单票脉冲；没有扩散和持续承接，就不算有效回流。",
  };
}

function setupBenchmark(row) {
  if (!row) return null;
  const card = row.card;
  return {
    code: card.code,
    name: card.name,
    themeId: card.themeId,
    themeName: card.themeName,
    role: card.role,
    identity: card.identity,
    coreStatus: card.coreStatus,
    usage: card.usage,
  };
}

function setupContextAllowed(definition, flow, recentRelation) {
  const relationKey = clean(recentRelation.relation).toLowerCase();
  const today = isObject(recentRelation.today) ? recentRelation.today : {};
  const todayEmotion = isObject(today.emotion) ? today.emotion : {};
  const phaseText = clean(
    todayEmotion.phaseKey
    || todayEmotion.phaseLabel
    || recentRelation.emotionState,
  ).toLowerCase();
  const indexStatus = clean(flow && flow.indexOpportunity && flow.indexOpportunity.status).toLowerCase();
  const indexPermission = clean(flow && flow.indexOpportunity && flow.indexOpportunity.permission).toLowerCase();
  const indexBlocked = indexStatus === "blocked"
    || ["blocked", "forbidden", "denied"].includes(indexPermission)
    || relationKey === "resonance_down";
  if (indexBlocked) return false;
  const paths = isObject(flow && flow.tradingPreference && flow.tradingPreference.paths)
    ? flow.tradingPreference.paths
    : {};
  const path = isObject(paths[definition.pathKey]) ? paths[definition.pathKey] : {};
  const pathStatus = clean(path.status).toLowerCase();
  const hasPathContract = Object.keys(paths).length > 0;
  const legacyOpportunities = firstArray(flow && flow.tradingPreference && flow.tradingPreference.opportunities);
  const legacyPathConfirmed = legacyOpportunities.some((item) => (
    clean(item && (item.path || item.pathKey)) === definition.pathKey
  ));
  const pathConfirmed = hasPathContract
    ? ["active", "dominant", "parallel", "confirmed", "ready"].includes(pathStatus)
      || path.confirmation && path.confirmation.confirmed === true
    : legacyPathConfirmed
      || clean(flow && flow.tradingPreference && flow.tradingPreference.status).toLowerCase() === "ready";
  if (!pathConfirmed) return false;
  if (definition.primaryDriver === "emotion_core") {
    return /divergence|realization|post_(?:heat|climax)_divergence|分歧|兑现/.test(phaseText)
      || /emotion_divergence/.test(relationKey);
  }
  return true;
}

function setupStatusOf(definition, flow, recentRelation, driverRows, opportunityCodes) {
  if (recentRelation.status === "cancelled") return "cancelled";
  if (recentRelation.status !== "ready" || !driverRows.length) return "insufficient";
  if (!setupContextAllowed(definition, flow, recentRelation)) return "insufficient";
  if (driverRows.some((row) => opportunityCodes.has(row.card.code))) return "plan_ready";
  return "condition_watch";
}

function setupSummary(status, label) {
  if (status === "plan_ready") return label + "已有最终计划承接；本卡只解释结构，执行仍以机会卡为准。";
  if (status === "condition_watch") return label + "进入条件观察，触发前不形成可执行计划。";
  if (status === "cancelled") return label + "已被近期指数与情绪关系否定，停止观察。";
  return label + "证据不足，暂不能确认。";
}

function buildSetupCards(flow, recentRelation, observationRows, opportunityCards) {
  const opportunityCodes = new Set(firstArray(opportunityCards).map(codeOf));
  const relationCodes = recentRelation.validationCodes;
  const relationCodeSet = new Set(relationCodes);
  const definitions = [
    setupDefinition("emotion_core_divergence_reflow"),
    setupDefinition("theme_trend_core_divergence_reflow"),
  ];
  return definitions.slice(0, LIMITS.maxSetupCards).map((definition) => {
    const eligibleRows = observationRows.filter((row) => {
      if (row.roleKind === "height" || row.card.usage === "height_only") return false;
      if (definition.primaryDriver === "emotion_core") {
        return row.card.usage === "validate_emotion" && row.card.coreStatus !== "pending";
      }
      return (
        (row.card.usage === "validate_theme" && row.card.coreStatus !== "pending")
        || row.card.usage === "execution_candidate"
      );
    });
    const driverRows = relationCodeSet.size
      ? eligibleRows.filter((row) => relationCodeSet.has(row.card.code))
      : eligibleRows;
    driverRows.sort((left, right) => {
      const leftRank = relationCodes.indexOf(left.card.code);
      const rightRank = relationCodes.indexOf(right.card.code);
      return (leftRank < 0 ? Number.MAX_SAFE_INTEGER : leftRank)
        - (rightRank < 0 ? Number.MAX_SAFE_INTEGER : rightRank);
    });
    const validationCodes = unique(driverRows.map((row) => row.card.code)).slice(0, 3);
    const status = setupStatusOf(definition, flow, recentRelation, driverRows, opportunityCodes);
    const benchmark = setupBenchmark(driverRows[0]);
    const rule = pathRuleOf(flow, definition.pathKey);
    const why = observationTextList([
      recentRelation.summary,
      benchmark ? directionWhy(driverRows[0].theme) : null,
      benchmark ? coreWhy(benchmark) : null,
    ], 3);
    return {
      key: definition.key,
      label: definition.label,
      status,
      primaryDriver: definition.primaryDriver,
      summary: setupSummary(status, definition.label),
      why,
      normalPath: definition.normalPath,
      trigger: safeTextList(rule.trigger, 3),
      cancel: safeTextList(rule.cancel, 3),
      risk: definition.risk,
      benchmark,
      validationCodes,
      source: {
        relation: "payload.recentIndexEmotionRelation",
        direction: "opportunityMap.directions",
        core: "opportunityMap.directions[].emotionAnchors",
        execution: "opportunityCards_only",
      },
      integrity: {
        observationOnly: true,
        executable: false,
        finalPlanOnlyInOpportunityCards: true,
        heightOnlyExcludedFromEmotionValidation: true,
      },
    };
  });
}

function themeProjection(mapDirection, flowTheme) {
  const conflict = attributionStatus(mapDirection, flowTheme) === "conflict";
  return {
    id: clean(mapDirection && (mapDirection.id || mapDirection.family || mapDirection.name)) || null,
    name: clean(mapDirection && (mapDirection.name || mapDirection.family || mapDirection.id)) || null,
    family: clean(mapDirection && (mapDirection.family || mapDirection.id || mapDirection.name)) || null,
    state: clean(mapDirection && mapDirection.state) || "watch_only",
    attributionStatus: conflict ? "conflict" : "clear",
    cores: firstArray(mapDirection && mapDirection.emotionAnchors)
      .slice(0, LIMITS.maxCoresPerTheme)
      .map(coreProjection),
    source: "opportunityMap.directions",
  };
}

function buildThemeLists(flow, opportunityMap) {
  const flowDirection = isObject(flow && flow.direction) ? flow.direction : {};
  const flowThemes = firstArray(flowDirection.items);
  const directions = firstArray(opportunityMap && opportunityMap.directions)
    .map((direction, index) => ({ direction, index }))
    .sort((left, right) => (
      Number(left.direction && left.direction.rank || Number.MAX_SAFE_INTEGER)
      - Number(right.direction && right.direction.rank || Number.MAX_SAFE_INTEGER)
      || left.index - right.index
    ))
    .slice(0, LIMITS.maxThemes);
  const candidates = directions.map(({ direction }) => {
    const flowTheme = flowThemeFor(direction, flowThemes);
    return {
      public: themeProjection(direction, flowTheme),
      mapDirection: direction,
      flowTheme,
    };
  });
  const confirmation = isObject(flowDirection.confirmation) ? flowDirection.confirmation : {};
  const confirmationOpen = confirmation.status === "confirmed" && flowDirection.executionBlocked !== true;
  const eligibleIds = new Set(firstArray(confirmation.eligibleThemeIds).map(normalizeToken).filter(Boolean));
  const confirmed = confirmationOpen
    ? candidates.filter((item) => (
      item.public.attributionStatus === "clear"
      && themeTokens(item.mapDirection).some((token) => eligibleIds.has(token))
    ))
    : [];
  return { candidates, confirmed };
}

function explicitMainRise(flow) {
  const index = isObject(flow && flow.indexOpportunity) ? flow.indexOpportunity : {};
  const keys = [
    index.mediumTerm && (index.mediumTerm.cycleKey || index.mediumTerm.key),
    index.shortTerm && index.shortTerm.key,
    index.keyValue,
  ].map((value) => clean(value).toLowerCase()).filter(Boolean);
  const statements = [
    index.cycle,
    index.conclusion,
    index.mediumTerm && (index.mediumTerm.label || index.mediumTerm.cycleLabel || index.mediumTerm.conclusion),
    index.shortTerm && (index.shortTerm.label || index.shortTerm.cycleLabel || index.shortTerm.conclusion),
    ...keys,
  ].map(clean).filter(Boolean);
  const uncertainOrNegative = statements.some((value) => (
    /主升[^，。；]{0,6}(?:候选|待确认|未确认|观察|存疑|可能)/.test(value)
    || /(?:候选|待确认|未确认|观察|存疑|可能)[^，。；]{0,6}主升/.test(value)
    || /(?:非主升|不是主升|未进入主升)/.test(value)
    || /main[\s_-]*rise[\s_-]*(?:candidate|pending|unconfirmed|unknown)|(?:not|no)[\s_-]*main[\s_-]*rise/i.test(value)
  ));
  if (uncertainOrNegative) return false;
  return keys.some((key) => MAIN_RISE_KEYS.has(key))
    || /主升/.test(clean(index.cycle));
}

function explicitReflowPreference(flow) {
  const preference = isObject(flow && flow.tradingPreference) ? flow.tradingPreference : {};
  const values = [
    preference.preference,
    preference.conclusion,
    preference.bias,
    preference.dominantPath && preference.dominantPath.key,
    preference.dominantPath && preference.dominantPath.label,
    preference.executionPreference && preference.executionPreference.summary,
  ].map(clean).filter(Boolean);
  const uncertainOrNegative = values.some((value) => (
    /(?:无确认|未确认|待确认|不确认)[^，。；]{0,6}回流/.test(value)
    || /(?:不做|不参与|禁止|放弃|没有|无)[^，。；]{0,6}回流/.test(value)
    || /回流[^，。；]{0,6}(?:失败|未确认|待确认|不成立|走弱|取消|禁止)/.test(value)
    || /(?:no|not|unconfirmed|pending)[\s_-]*reflow|reflow[\s_-]*(?:failed|unconfirmed|pending|blocked)/i.test(value)
  ));
  if (uncertainOrNegative) return false;
  return values.some((value) => /(?:回流|reflow)/i.test(value));
}

function planComplete(plan) {
  if (!isObject(plan)) return false;
  if ([plan.status, plan.executionStatus, plan.executionMode].some(isBlockedPlanState)) return false;
  return Boolean(
    codeOf(plan)
    && hasUsablePlanLeg(plan && plan.buy)
    && hasUsablePlanLeg(plan && plan.hold)
    && hasUsablePlanLeg(plan && plan.sell)
    && hasUsablePlanLeg(plan && plan.holdingPeriod)
    && hasUsablePlanLeg(plan && plan.position)
    && firstArray(plan && plan.triggers).some(hasMeaningfulContent)
    && firstArray(plan && plan.cancelConditions).some(hasMeaningfulContent)
  );
}

function setupClassification(flow, theme, mapCandidate, planRow) {
  const checks = {
    cycle: explicitMainRise(flow),
    preference: explicitReflowPreference(flow),
    theme: Boolean(
      theme
      && theme.public.attributionStatus === "clear"
      && theme.mapDirection
      && theme.mapDirection.evidence
      && theme.mapDirection.evidence.isMainLine === true
    ),
    core: Boolean(
      mapCandidate
      && mapCandidate.active === true
      && mapCandidate.tradeQualified === true
      && attributionStatus(mapCandidate) === "clear"
    ),
    plan: planComplete(planRow),
  };
  const failed = Object.keys(checks).filter((key) => checks[key] !== true);
  return {
    setupType: failed.length ? null : "mainline_core_reflow",
    setupChecks: checks,
    failedSetupChecks: failed,
  };
}

function planProjection(planRow, theme, mapCandidate, flow) {
  const classification = setupClassification(flow, theme, mapCandidate, planRow);
  return {
    id: `${theme.public.id || theme.public.family || "theme"}:${codeOf(planRow)}`,
    themeId: theme.public.id,
    themeName: theme.public.name,
    code: codeOf(planRow),
    name: clean(planRow && planRow.name) || codeOf(planRow),
    role: clean(mapCandidate && (
      mapCandidate.role
      || mapCandidate.anchorType
      || mapCandidate.identity
      || mapCandidate.leadershipRole
    )) || null,
    identity: clean(mapCandidate && (
      mapCandidate.identity
      || mapCandidate.leadershipRole
      || mapCandidate.role
      || mapCandidate.anchorType
    )) || null,
    setupType: classification.setupType,
    setupChecks: classification.setupChecks,
    failedSetupChecks: classification.failedSetupChecks,
    plan: {
      buy: cloneProjectionValue(planRow.buy),
      hold: cloneProjectionValue(planRow.hold),
      sell: cloneProjectionValue(planRow.sell),
      riskExit: cloneProjectionValue(planRow.sell),
      holdingPeriod: cloneProjectionValue(planRow.holdingPeriod),
      position: planRow.position == null ? null : cloneProjectionValue(planRow.position),
      triggers: cloneProjectionValue(firstArray(planRow.triggers)),
      cancelConditions: cloneProjectionValue(firstArray(planRow.cancelConditions)),
      executionMode: clean(planRow.executionMode) || null,
    },
    source: {
      plan: "premarketFlow.tradePlan.plans",
      candidate: "opportunityMap.directions[].tradeCandidates",
    },
  };
}

function buildOpportunityCards(flow, marketPermission, themeLists, resolved) {
  if (!marketPermission.canCreateOpportunities) return { cards: [], attributionConflictCodes: [] };
  const plans = firstArray(flow && flow.tradePlan && flow.tradePlan.plans);
  const allowedCodes = new Set(firstArray(flow && flow.direction && flow.direction.allowedStockCodes).map(clean));
  const confirmedCodes = new Set(firstArray(
    flow && flow.direction && flow.direction.confirmation && flow.direction.confirmation.eligibleStockCodes,
  ).map(clean));
  const qualifiedCodes = new Set(firstArray(flow && flow.stocks && flow.stocks.candidates)
    .filter((candidate) => candidate && candidate.qualified === true)
    .map(codeOf));
  const payloadCandidates = new Map(firstArray(resolved.payload && resolved.payload.candidates)
    .map((candidate) => [codeOf(candidate), candidate])
    .filter(([code]) => code));
  const cards = [];
  const attributionConflictCodes = [];

  plans.forEach((planRow) => {
    if (cards.length >= LIMITS.maxCoreStocks) return;
    const code = codeOf(planRow);
    if (
      !code
      || !planComplete(planRow)
      || !allowedCodes.has(code)
      || !confirmedCodes.has(code)
      || !qualifiedCodes.has(code)
    ) return;
    const theme = themeLists.confirmed.find((item) => firstArray(item.mapDirection.tradeCandidates)
      .some((candidate) => codeOf(candidate) === code));
    const payloadCandidate = payloadCandidates.get(code);
    if (!theme) return;
    if (
      attributionStatus(theme.mapDirection, theme.flowTheme, planRow, payloadCandidate) === "conflict"
      || primaryAttributionMismatch(theme, planRow, payloadCandidate)
    ) {
      attributionConflictCodes.push(code);
      return;
    }
    const mapCandidate = firstArray(theme.mapDirection.tradeCandidates)
      .find((candidate) => codeOf(candidate) === code && candidate.active === true && candidate.tradeQualified === true);
    if (!mapCandidate) return;
    const countForTheme = cards.filter((card) => card.themeId === theme.public.id).length;
    if (countForTheme >= LIMITS.maxCoresPerTheme) return;
    cards.push(planProjection(planRow, theme, mapCandidate, flow));
  });
  return { cards, attributionConflictCodes: unique(attributionConflictCodes) };
}

function noOpportunityOf(dataStatus, marketPermission, themeLists, opportunityCards, attributionConflictCodes) {
  if (opportunityCards.length) return { active: false, reasons: [], nextChecks: [] };
  const reasons = [];
  if (!dataStatus.usable) {
    reasons.push(...firstArray(dataStatus.reasons));
    reasons.push("关键盘后数据还没有准备好，现在不能可靠地判断明日机会。");
  }
  if (marketPermission.status === "blocked" && dataStatus.usable) {
    const blockedReasons = firstArray(marketPermission.blockedSteps)
      .map((step) => BLOCKED_STEP_REASONS[step])
      .filter(Boolean);
    if (blockedReasons.length) reasons.push(...blockedReasons);
    else reasons.push("当前市场条件还不支持新开仓，明天先观察。");
  }
  if (themeLists.candidates.some((item) => item.public.attributionStatus === "conflict")) {
    reasons.push("题材归属还有冲突，暂时不能把相关股票当作可交易核心。");
  }
  if (firstArray(attributionConflictCodes).length) {
    reasons.push("股票的主归属和题材方向对不上，暂时不能把它当作这个方向的核心股。");
  }
  if (themeLists.candidates.length && !themeLists.confirmed.length) {
    reasons.push("题材库里有可关注方向，但资金偏好、情绪和题材确认还没有同时通过。");
  }
  if (themeLists.confirmed.length && !opportunityCards.length) {
    reasons.push("方向已经确认，但还没有核心股形成完整的买入、持有和卖出计划。");
  }
  if (!reasons.length) reasons.push("当前没有同时通过全部条件的明日机会，先等待更清楚的信号。");
  return {
    active: true,
    reasons: unique(reasons).slice(0, 3),
    nextChecks: [
      "等资金偏好、题材回流和核心股重新同步。",
      "只有完整买卖计划进入最终执行区后，才重新打开机会。",
    ],
  };
}

function buildPostCloseOpportunityReport(input = {}) {
  const resolved = resolveSources(input);
  const payload = isObject(resolved.payload) ? resolved.payload : {};
  const generationAlignment = generationAlignmentOf(payload);
  const projectedRecentRelation = projectRecentRelation(payload);
  const recentRelation = generationAlignment.aligned
    ? projectedRecentRelation
    : generationMismatchRelation();
  const baseDataStatus = dataStatusOf(resolved);
  const dataStatus = generationAlignment.aligned
    ? baseDataStatus
    : {
      ...baseDataStatus,
      status: "unavailable",
      usable: false,
      reasonCodes: unique([...firstArray(baseDataStatus.reasonCodes), "generation_mismatch"]),
      reasons: unique([
        ...firstArray(baseDataStatus.reasons),
        "本次行情和近期关系不是同一批数据，正在重新生成，暂不沿用旧结论。",
      ]),
    };
  const marketPermission = marketPermissionOf(
    resolved.premarketFlow,
    resolved.opportunityMap,
    dataStatus,
  );
  const themeLists = buildThemeLists(resolved.premarketFlow, resolved.opportunityMap);
  const opportunityResult = buildOpportunityCards(
    resolved.premarketFlow,
    marketPermission,
    themeLists,
    resolved,
  );
  const opportunityCards = opportunityResult.cards;
  const opportunityObservation = buildOpportunityObservationCards(
    payload,
    opportunityCards,
    generationAlignment,
    dataStatus,
  );
  const observation = generationAlignment.aligned
    ? buildObservationRows(
      resolved,
      resolved.premarketFlow,
      themeLists,
      marketPermission,
      opportunityCards,
    )
    : { rows: [], watchCards: [] };
  const setupCards = generationAlignment.aligned
    ? buildSetupCards(
      resolved.premarketFlow,
      recentRelation,
      observation.rows,
      opportunityCards,
    )
    : [];
  const watchCards = observation.watchCards;
  const noOpportunity = noOpportunityOf(
    dataStatus,
    marketPermission,
    themeLists,
    opportunityCards,
    opportunityResult.attributionConflictCodes,
  );
  const confirmedThemeRows = new Set(themeLists.confirmed);
  const unconfirmedThemes = themeLists.candidates.filter((item) => !confirmedThemeRows.has(item));
  return {
    version: VERSION,
    method: METHOD,
    calibrated: false,
    generationId: generationAlignment.reportGeneration,
    asOf: clean(
      payload.fetchedAt
      || payload.updatedAt
      || resolved.premarketFlow && resolved.premarketFlow.sourceUpdatedAt,
    ) || null,
    tradingDate: clean(
      resolved.opportunityMap && resolved.opportunityMap.tradingDate
      || payload.tradingDate
      || payload.themeLibrary && payload.themeLibrary.tradingDate,
    ) || null,
    status: opportunityCards.length ? "opportunities" : "no_opportunity",
    dataStatus,
    marketPermission,
    recentRelation,
    candidateThemes: unconfirmedThemes.map((item) => ({ ...item.public, confirmed: false })),
    confirmedThemes: themeLists.confirmed.map((item) => ({ ...item.public, confirmed: true })),
    opportunityObservationState: opportunityObservation.state,
    opportunityObservationCards: opportunityObservation.cards,
    opportunityObservationRejected: opportunityObservation.rejected,
    setupCards,
    watchCards,
    opportunityCards,
    noOpportunity,
    limits: { ...LIMITS },
    sources: {
      ...resolved.sourceLabels,
      candidateThemes: "opportunityMap.directions",
      recentRelation: "payload.recentIndexEmotionRelation",
      opportunityObservationCards: "unifiedDecisionChain.observationCandidates.stocks",
      setupCards: "recentRelation + opportunityMap.directions[].emotionAnchors",
      watchCards: "opportunityMap.directions[].emotionAnchors",
      confirmedThemes: "premarketFlow.direction.confirmation ∩ opportunityMap.directions",
      opportunityCards: "premarketFlow.tradePlan.plans",
    },
    integrity: {
      failClosed: true,
      generationAligned: generationAlignment.aligned,
      candidateAndConfirmedThemesSeparated: true,
      opportunityCardsFromFinalPlansOnly: true,
      opportunityObservationCardsFromUnifiedChainOnly: true,
      opportunityObservationCardsCannotGrantExecution: opportunityObservation.cards.every((card) => (
        card.observationOnly === true && card.executionAuthority === false
      )),
      opportunityObservationDataComplete: opportunityObservation.cards.every((card) => (
        card.code && card.name && card.reason && card.entryConfirmation && card.nextDayExpectation
      )),
      fatalRiskObservationExcluded: opportunityObservation.rejected
        .filter((row) => firstArray(row.reasonCodes).includes("fatal_risk"))
        .every((row) => !opportunityObservation.cards.some((card) => card.code === row.code)),
      previousLimitUpOnlySourceSeparated: opportunityObservation.cards
        .filter((card) => card.sourceScope === "supplemental_t1_observation")
        .every((card) => card.marketInferenceEligible === false),
      observationAndExecutionCodesSeparated: opportunityObservation.cards.every((card) => (
        !opportunityCards.some((opportunity) => opportunity.code === card.code)
      )),
      observationLayersDoNotGrantExecution: setupCards.every((card) => card.integrity.executable === false),
      watchAndExecutionCodesSeparated: watchCards.every((card) => (
        !opportunityCards.some((opportunity) => opportunity.code === card.code)
      )),
      heightOnlyExcludedFromEmotionValidation: setupCards.every((card) => (
        card.key !== "emotion_core_divergence_reflow"
        || watchCards.filter((watch) => watch.usage === "height_only")
          .every((watch) => !card.validationCodes.includes(watch.code))
      )),
      noInventedNumericForecast: true,
      attributionConflictsExcluded: themeLists.confirmed.every((item) => item.public.attributionStatus === "clear"),
    },
  };
}

module.exports = {
  VERSION,
  METHOD,
  LIMITS,
  buildPostCloseOpportunityReport,
  _internals: {
    attributionStatus,
    buildOpportunityObservationCards,
    explicitMainRise,
    explicitReflowPreference,
    resolveSources,
  },
};
