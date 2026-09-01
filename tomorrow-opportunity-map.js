"use strict";

/**
 * Build a read-only, auditable map of tomorrow's parallel opportunity directions.
 *
 * This module deliberately keeps four concepts separate:
 * 1. the global market/rhythm gate;
 * 2. a direction that is worth observing;
 * 3. a high-impact emotion anchor (not a buy signal);
 * 4. a strictly qualified trade candidate.
 *
 * No system clock, file, network, cache, or input mutation is used here.
 */

const VERSION = 1;
const DEFAULT_LIMITS = Object.freeze({
  maxDirections: 3,
  maxAnchorsPerDirection: 2,
  maxTradeCandidatesPerDirection: 1,
  minEmotionWeight: 60,
  minBreadth: 2,
});

const NEGATIVE_ANCHOR_STAGES = Object.freeze(new Set([
  "negative_feedback",
  "harmful_divergence",
  "retreat",
]));

const CLOSED_GATE_KEYS = Object.freeze(new Set([
  "closed",
  "blocked",
  "wait",
  "cash",
  "risk_off",
  "defense",
  "defence",
]));

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampInteger(value, fallback, min, max) {
  const number = finite(value);
  if (number === null) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function unique(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean)));
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value)) || [];
}

function codeOf(value) {
  return clean(value && (value.code || value.secCode || value.stockCode || value.symbol));
}

function normalizeToken(value) {
  return clean(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s·•,，、/\\|_-]+/g, "")
    .replace(/[【】\[\]{}]/g, "");
}

function tokenVariants(value) {
  const text = clean(value).normalize("NFKC");
  if (!text) return [];
  const base = text.split(/[（(]/)[0];
  return unique([normalizeToken(text), normalizeToken(base)]);
}

function themeTokens(theme) {
  const source = isObject(theme) ? theme : {};
  return unique([
    source.id,
    source.name,
    source.displayName,
    source.family,
    ...firstArray(source.aliases),
    ...firstArray(source.subthemes),
    ...firstArray(source.sourceThemeNames),
  ].flatMap(tokenVariants));
}

function candidateTokens(ticket, fullCandidate) {
  const values = [
    ticket && ticket.direction,
    ticket && ticket.mainConcept,
    ticket && ticket.focusDirection,
    ticket && ticket.concept,
    ticket && ticket.mainFamily,
    fullCandidate && fullCandidate.mainConcept,
    fullCandidate && fullCandidate.focusDirection,
    fullCandidate && fullCandidate.concept,
    fullCandidate && fullCandidate.mainFamily,
  ];
  return unique(values.flatMap(tokenVariants));
}

function familyKey(theme) {
  const source = isObject(theme) ? theme : {};
  return normalizeToken(source.family || source.id || source.name);
}

function stockTags(stock) {
  return firstArray(stock && stock.tags).map((tag) => ({
    key: clean(tag && tag.key),
    label: clean(tag && tag.label),
    reason: clean(tag && tag.reason),
    style: clean(tag && tag.style),
    verified: tag && tag.verified === true,
  }));
}

function mergeStocks(themes) {
  const byCode = new Map();
  themes.forEach((theme) => {
    firstArray(theme && theme.stocks).forEach((stock) => {
      const code = codeOf(stock);
      if (!code) return;
      const current = byCode.get(code) || {};
      const tags = [...stockTags(current), ...stockTags(stock)];
      const tagByKey = new Map();
      tags.forEach((tag) => {
        const key = `${tag.key}|${tag.label}`;
        if (!tagByKey.has(key)) tagByKey.set(key, tag);
      });
      byCode.set(code, {
        ...current,
        ...(isObject(stock) ? stock : {}),
        code,
        name: clean(stock && stock.name) || clean(current.name) || code,
        tags: Array.from(tagByKey.values()),
      });
    });
  });
  return Array.from(byCode.values());
}

function mergeThemeFamily(themes, key) {
  const ranked = themes.slice().sort((left, right) => (
    Number(left && left.rank || Number.MAX_SAFE_INTEGER)
      - Number(right && right.rank || Number.MAX_SAFE_INTEGER)
    || Number(right && right.score || 0) - Number(left && left.score || 0)
  ));
  const primary = ranked[0] || {};
  const stocks = mergeStocks(ranked);
  const rawStockCount = ranked.reduce((max, theme) => Math.max(max, Number(theme && theme.stockCount || 0)), 0);
  return {
    id: clean(primary.id || primary.family || primary.name) || key,
    name: clean(primary.name || primary.displayName || primary.family) || key,
    family: clean(primary.family || primary.id || primary.name) || key,
    familyKey: key,
    rank: ranked.reduce((min, theme) => Math.min(min, Number(theme && theme.rank || Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER),
    isMainLine: ranked.some((theme) => theme && theme.isMainLine === true),
    sustained: ranked.some((theme) => theme && theme.sustained === true),
    resonance: ranked.some((theme) => theme && theme.resonance === true),
    score: ranked.reduce((max, theme) => Math.max(max, Number(theme && theme.score || 0)), 0),
    count: ranked.reduce((max, theme) => Math.max(max, Number(theme && theme.count || 0)), 0),
    limitCount: ranked.reduce((max, theme) => Math.max(max, Number(theme && theme.limitCount || 0)), 0),
    stockCount: Math.max(rawStockCount, stocks.length),
    aliases: unique(ranked.flatMap((theme) => [
      theme && theme.name,
      theme && theme.displayName,
      theme && theme.id,
      theme && theme.family,
      ...firstArray(theme && theme.aliases),
      ...firstArray(theme && theme.subthemes),
      ...firstArray(theme && theme.sourceThemeNames),
    ])),
    sourceThemeIds: unique(ranked.map((theme) => theme && (theme.id || theme.family || theme.name))),
    sourceThemeNames: unique(ranked.map((theme) => theme && (theme.displayName || theme.name || theme.family))),
    sourceThemes: ranked,
    stocks,
  };
}

function mergeThemeFamilies(themes) {
  const groups = new Map();
  firstArray(themes).forEach((theme, index) => {
    if (!isObject(theme)) return;
    const key = familyKey(theme) || `unnamed-${index + 1}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(theme);
  });
  return Array.from(groups.entries()).map(([key, rows]) => mergeThemeFamily(rows, key));
}

function fullCandidateIndex(candidates) {
  const index = new Map();
  firstArray(candidates).forEach((candidate) => {
    const code = codeOf(candidate);
    if (code && !index.has(code)) index.set(code, candidate);
  });
  return index;
}

function groupMatchTokens(group) {
  return unique([
    group.id,
    group.name,
    group.family,
    ...group.aliases,
  ].flatMap(tokenVariants));
}

function groupContainsCode(group, code) {
  return Boolean(code) && firstArray(group && group.stocks).some((stock) => codeOf(stock) === code);
}

function tokensIntersect(left, right) {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function findGroupForStock(groups, value, fullCandidate) {
  const code = codeOf(value) || codeOf(fullCandidate);
  const direct = groups
    .filter((group) => !firstArray(group && group.filteredRiskStockCodes).includes(code))
    .filter((group) => groupContainsCode(group, code))
    .sort((left, right) => left.rank - right.rank)[0];
  if (direct) return direct;
  const tokens = candidateTokens(value, fullCandidate);
  if (!tokens.length) return null;
  return groups
    .filter((group) => !firstArray(group && group.filteredRiskStockCodes).includes(code))
    .filter((group) => tokensIntersect(tokens, groupMatchTokens(group)))
    .sort((left, right) => left.rank - right.rank)[0] || null;
}

function emotionWeight(item) {
  return finite(item && (item.weight ?? item.impact ?? item.emotionWeight)) ?? 0;
}

function emotionStage(item) {
  return clean(item && (item.stage || item.stageKey || item.state)).toLowerCase();
}

function isNegativeAnchor(item) {
  return NEGATIVE_ANCHOR_STAGES.has(emotionStage(item));
}

function themeStockFor(group, code) {
  return firstArray(group && group.stocks).find((stock) => codeOf(stock) === code) || null;
}

function currentCoreQualified(candidate) {
  return Boolean(candidate && candidate.leadership && candidate.leadership.coreIdentityQualified === true);
}

function historicalIdentity(value) {
  const text = clean(value && (
    value.identity
    || value.leadership && (value.leadership.identity || value.leadership.levelLabel)
  )).toLowerCase();
  return /历史|historical/.test(text);
}

function anchorType(item, themeStock, fullCandidate) {
  if (isNegativeAnchor(item)) return "negative";
  const roles = unique([
    themeStock && themeStock.primaryRole,
    fullCandidate && fullCandidate.role,
    ...stockTags(themeStock).flatMap((tag) => [tag.key, tag.label]),
  ]).join("|").toLowerCase();
  if (/中军|capacity/.test(roles)) return "capacity";
  if (/龙头|leader|高度|height/.test(roles)) return "height";
  return "sentiment";
}

function buildAnchorsForGroup(group, coreItems, candidateByCode, minWeight, maxAnchors) {
  const anchors = firstArray(coreItems)
    .filter((item) => emotionWeight(item) >= minWeight)
    .map((item) => {
      const code = codeOf(item);
      const fullCandidate = candidateByCode.get(code) || null;
      const matchedGroup = findGroupForStock([group], item, fullCandidate);
      if (!matchedGroup) return null;
      const themeStock = themeStockFor(group, code);
      const current = currentCoreQualified(fullCandidate);
      return {
        code,
        name: clean(item && item.name) || clean(themeStock && themeStock.name) || code,
        anchorType: anchorType(item, themeStock, fullCandidate),
        identityState: current && !historicalIdentity(fullCandidate)
          ? "current_core"
          : "historical_core",
        stage: emotionStage(item) || "unknown",
        stageLabel: clean(item && item.stageLabel) || null,
        impactWeight: emotionWeight(item),
        confidence: finite(item && item.confidence),
        source: clean(item && item.source) || null,
        usage: "anchor_only",
        selfValidationExcluded: true,
        evidence: unique(firstArray(item && item.evidence)),
      };
    })
    .filter(Boolean)
    .sort((left, right) => (
      right.impactWeight - left.impactWeight
      || Number(right.confidence || 0) - Number(left.confidence || 0)
      || left.code.localeCompare(right.code)
    ));
  return anchors.slice(0, maxAnchors);
}

function breadthMetrics(group) {
  const memberCount = firstArray(group && group.stocks).length;
  const reportedCount = Math.max(0, Number(group && group.count || 0));
  const reportedStockCount = Math.max(0, Number(group && group.stockCount || 0));
  const limitCount = Math.max(0, Number(group && group.limitCount || 0));
  return {
    memberCount,
    reportedCount,
    reportedStockCount,
    limitCount,
    breadthCount: Math.max(memberCount, reportedCount, reportedStockCount, limitCount),
  };
}

function sourceThemeHasExplicitRisk(theme) {
  if (!theme) return false;
  const riskState = isObject(theme.riskState) ? theme.riskState : {};
  if (theme.risk === true
    || theme.blocked === true
    || theme.excluded === true
    || theme.riskBlocked === true
    || riskState.blocked === true) return true;
  const riskText = [
    theme.status,
    theme.state,
    theme.riskLevel,
    riskState.key,
    riskState.status,
  ].map(clean).join("|").toLowerCase();
  return /(^|\|)(blocked|excluded|harmful|risk[_ -]?off|retreat|high[_ -]?risk)(\||$)/.test(riskText);
}

function resolveRiskBoardGroup(group, riskBoard) {
  const blockedDirections = unique(firstArray(riskBoard && riskBoard.blockedDirections).flatMap(tokenVariants));
  const blockedConcepts = unique(firstArray(riskBoard && riskBoard.blockedConcepts).flatMap(tokenVariants));
  const wholeDirectionTokens = unique([
    group && group.id,
    group && group.name,
    group && group.family,
  ].flatMap(tokenVariants));
  const familyTokens = unique([group && group.family].flatMap(tokenVariants));
  if (tokensIntersect(blockedDirections, wholeDirectionTokens)
    || tokensIntersect(blockedConcepts, familyTokens)) {
    return { group, blocked: true, blockedReason: "risk_board_blocked", filteredSourceThemeIds: [] };
  }
  if (!firstArray(group && group.sourceThemes).length) {
    return { group, blocked: false, blockedReason: null, filteredSourceThemeIds: [] };
  }
  const sourceThemes = firstArray(group.sourceThemes);
  const safeSourceThemes = sourceThemes.filter((theme) => {
    const sourceTokens = unique([
      theme && theme.id,
      theme && theme.name,
      theme && theme.displayName,
    ].flatMap(tokenVariants));
    return !tokensIntersect(blockedConcepts, sourceTokens) && !sourceThemeHasExplicitRisk(theme);
  });
  if (!safeSourceThemes.length) {
    const blockedReason = sourceThemes.some(sourceThemeHasExplicitRisk)
      ? "risk_direction_explicit"
      : "risk_board_blocked";
    return {
      group,
      blocked: true,
      blockedReason,
      filteredSourceThemeIds: unique(sourceThemes.map((theme) => theme && (theme.id || theme.name))),
    };
  }
  if (safeSourceThemes.length === sourceThemes.length) {
    return { group, blocked: false, blockedReason: null, filteredSourceThemeIds: [] };
  }
  const filteredSourceThemeIds = unique(sourceThemes
    .filter((theme) => !safeSourceThemes.includes(theme))
    .map((theme) => theme && (theme.id || theme.name)));
  const safeStockCodes = new Set(unique(safeSourceThemes
    .flatMap((theme) => firstArray(theme && theme.stocks).map(codeOf))));
  const filteredRiskStockCodes = unique(sourceThemes
    .filter((theme) => !safeSourceThemes.includes(theme))
    .flatMap((theme) => firstArray(theme && theme.stocks).map(codeOf)))
    .filter((code) => !safeStockCodes.has(code));
  const filteredGroup = mergeThemeFamily(safeSourceThemes, group.familyKey);
  filteredGroup.filteredRiskSubthemes = filteredSourceThemeIds;
  filteredGroup.filteredRiskStockCodes = filteredRiskStockCodes;
  return { group: filteredGroup, blocked: false, blockedReason: null, filteredSourceThemeIds };
}

function negativeAnchorDominates(anchors) {
  if (anchors.length < 2) return false;
  const negative = anchors.filter((anchor) => NEGATIVE_ANCHOR_STAGES.has(anchor.stage));
  return negative.length >= 2 && negative.length === anchors.length;
}

function directionRankingScore(group, metrics) {
  return (
    (group.resonance ? 400 : 0)
    + (group.sustained ? 250 : 0)
    + (group.isMainLine ? 200 : 0)
    + Math.min(metrics.limitCount, 10) * 10
    + Math.min(metrics.breadthCount, 50)
    + Math.min(Math.max(Number(group.score || 0), 0), 1000) / 100
  );
}

function rejectEntry(group, reasonCodes, metrics, anchors) {
  return {
    id: group.id,
    name: group.name,
    family: group.family,
    rank: Number.isFinite(group.rank) ? group.rank : null,
    reasonCodes: unique(reasonCodes),
    reasons: unique(reasonCodes.map((code) => ({
      theme_library_unavailable: "题材库不可用",
      theme_library_stale: "题材库已标记为过期",
      direction_signal_missing: "没有共振、持续性或主线证据",
      direction_breadth_missing: "板块广度不足",
      high_impact_anchor_missing: "缺少权重达到门槛的情绪锚点",
      risk_direction_explicit: "方向带有明确风险/排除标记",
      risk_board_blocked: "方向被风险板屏蔽",
      risk_anchor_dominance: "多个高影响锚点均处于负反馈状态",
      direction_limit: "超过并行方向数量上限",
    }[code] || code))),
    metrics: {
      resonance: group.resonance,
      sustained: group.sustained,
      isMainLine: group.isMainLine,
      ...metrics,
      highImpactAnchorCount: anchors.length,
    },
    sourceThemeIds: group.sourceThemeIds.slice(),
    sourceThemeNames: group.sourceThemeNames.slice(),
  };
}

function normalizeGateStatus(value) {
  const key = clean(value).toLowerCase();
  if (/^(open|ready|allowed|active)$/.test(key)) return "open";
  if (/^(conditional|condition|pending|verify|verification)$/.test(key)) return "conditional";
  if (CLOSED_GATE_KEYS.has(key)) return "closed";
  return "";
}

function resolveGlobalGate(input, decision, themeLibrary, primaryTickets) {
  const explicit = isObject(input && input.globalGate)
    ? input.globalGate
    : isObject(input && input.tradeWindow) ? input.tradeWindow : {};
  const permission = isObject(decision && decision.permission) ? decision.permission : {};
  const reasonCodes = [];
  const reasons = [];
  let status = normalizeGateStatus(explicit.status || explicit.key);

  if (themeLibrary && themeLibrary.available === false) {
    reasonCodes.push("theme_library_unavailable");
    reasons.push("题材库不可用，交易窗口关闭");
  }
  if (themeLibrary && themeLibrary.stale === true) {
    reasonCodes.push("theme_library_stale");
    reasons.push("题材库已过期，交易窗口关闭");
  }
  if (explicit.hardBlock === true || explicit.blockNewEntry === true || explicit.allowNew === false) {
    reasonCodes.push("explicit_trade_window_block");
    reasons.push(clean(explicit.summary || explicit.reason) || "交易窗口被显式关闭");
  }
  if (
    clean(permission.status).toLowerCase() === "blocked"
    || clean(permission.executionMode).toLowerCase() === "blocked"
  ) {
    reasonCodes.push("decision_permission_blocked");
    reasons.push(clean(permission.summary) || "决策权限已阻断");
  }
  if (Object.prototype.hasOwnProperty.call(permission, "canActivate") && permission.canActivate === false) {
    reasonCodes.push("decision_cannot_activate");
    reasons.push("决策未开放候选激活权限");
  }

  if (reasonCodes.length) status = "closed";
  else if (!status) {
    if (permission.canActivate === true) status = "conditional";
    else if (firstArray(primaryTickets).length > 0) status = "conditional";
    else status = "closed";
  }

  if (status === "closed" && !reasonCodes.length) {
    reasonCodes.push("no_trade_window");
    reasons.push("当前没有已验证的交易窗口");
  }
  if (status === "conditional" && !reasons.length) {
    reasons.push("仅生成条件计划，盘中验证后才能激活");
  }
  if (status === "open" && !reasons.length) reasons.push("交易窗口已显式开放");

  return {
    status,
    canOpen: status === "open",
    canActivate: status !== "closed",
    canTradeCandidates: status !== "closed",
    primaryScenarioKey: clean(decision && decision.primaryScenarioKey) || null,
    reasonCodes: unique(reasonCodes),
    reasons: unique(reasons),
  };
}

function canonicalTicketAttested(ticket, decision) {
  const executionVersion = finite(decision && decision.executionVersion) ?? 0;
  const status = clean(ticket && ticket.status).toLowerCase();
  const blockers = firstArray(ticket && ticket.blockers);
  return executionVersion >= 3
    && !["blocked", "wait", "invalid"].includes(status)
    && blockers.length === 0;
}

function priceIntegrityPass(ticket, fullCandidate, canonicalAttested) {
  const integrity = isObject(fullCandidate && fullCandidate.priceIntegrity)
    ? fullCandidate.priceIntegrity
    : {};
  if (integrity.valid === false || integrity.consistent === false) return false;
  if (/invalid|error|failed|unavailable/.test(clean(integrity.status || integrity.grade).toLowerCase())) return false;
  const decisionPriceAvailable = ticket && ticket.advice && ticket.advice.integrity
    && ticket.advice.integrity.checks && ticket.advice.integrity.checks.decisionPriceAvailable === true;
  const price = finite(
    integrity.price
    ?? (fullCandidate && fullCandidate.price)
    ?? (fullCandidate && fullCandidate.close)
    ?? (ticket && ticket.price),
  );
  return Boolean(decisionPriceAvailable || canonicalAttested || (price !== null && price > 0));
}

function candidateQualification(ticket, fullCandidate, decision) {
  const canonicalAttested = canonicalTicketAttested(ticket, decision);
  const execution = isObject(fullCandidate && fullCandidate.tomorrowExecution)
    ? fullCandidate.tomorrowExecution
    : isObject(ticket && ticket.tomorrowExecution) ? ticket.tomorrowExecution : {};
  const leadership = isObject(fullCandidate && fullCandidate.leadership) ? fullCandidate.leadership : {};
  const hardGate = isObject(fullCandidate && fullCandidate.hardGate) ? fullCandidate.hardGate : {};
  const checks = {
    canonicalTicketPass: canonicalAttested,
    tomorrowEntryQualified: execution.tomorrowEntryQualified === true || canonicalAttested,
    candidateTradeQualified: fullCandidate && fullCandidate.tradeQualified === true || canonicalAttested,
    leadershipTradeQualified: leadership.tradeQualified === true || canonicalAttested,
    currentCoreIdentity: leadership.coreIdentityQualified === true && !historicalIdentity(fullCandidate),
    hardGatePass: hardGate.pass === true || canonicalAttested,
    priceIntegrityPass: priceIntegrityPass(ticket, fullCandidate, canonicalAttested),
  };
  const reasonCodes = [];
  if (firstArray(ticket && ticket.blockers).length) reasonCodes.push("ticket_blocked");
  if (!checks.tomorrowEntryQualified) reasonCodes.push("tomorrow_entry_not_qualified");
  if (!checks.candidateTradeQualified) reasonCodes.push("candidate_trade_not_qualified");
  if (!checks.leadershipTradeQualified) reasonCodes.push("leadership_trade_not_qualified");
  if (!checks.currentCoreIdentity) reasonCodes.push("current_core_identity_missing");
  if (!checks.hardGatePass) reasonCodes.push("hard_gate_failed");
  if (!checks.priceIntegrityPass) reasonCodes.push("price_integrity_failed");
  return { qualified: reasonCodes.length === 0, checks, reasonCodes };
}

function tradeCandidateFrom(ticket, fullCandidate, sourceType, decision, gate) {
  const qualification = candidateQualification(ticket, fullCandidate, decision);
  if (!qualification.qualified || gate.status === "closed") return null;
  const scenarioKey = clean(ticket && ticket.scenarioKey) || null;
  const primaryScenarioKey = clean(decision && decision.primaryScenarioKey);
  const primaryPath = sourceType === "primary"
    && (!primaryScenarioKey || !scenarioKey || scenarioKey === primaryScenarioKey);
  return {
    code: codeOf(ticket) || codeOf(fullCandidate),
    name: clean(ticket && ticket.name) || clean(fullCandidate && fullCandidate.name) || codeOf(ticket) || codeOf(fullCandidate),
    scenarioKey,
    scenarioLabel: clean(ticket && ticket.scenarioLabel) || null,
    sourceType,
    activation: primaryPath ? "primary_path" : "path_switch_only",
    active: primaryPath,
    identityState: "current_core",
    tradeQualified: true,
    buyCondition: clean(
      ticket && ticket.buy && (ticket.buy.summary || firstArray(ticket.buy.triggers)[0])
      || fullCandidate && fullCandidate.tomorrowExecution && firstArray(fullCandidate.tomorrowExecution.triggers)[0],
    ) || null,
    cancelCondition: clean(
      ticket && ticket.buy && firstArray(ticket.buy.cancelConditions)[0]
      || fullCandidate && fullCandidate.tomorrowExecution && firstArray(fullCandidate.tomorrowExecution.cancelConditions)[0],
    ) || null,
    checks: {
      ...qualification.checks,
      rhythmGatePass: gate.status !== "closed",
    },
  };
}

function directionEntry(group, anchors, metrics, rankingScore) {
  return {
    id: group.id,
    name: group.name,
    family: group.family,
    rank: null,
    state: "watch_only",
    threadRole: "parallel",
    evidence: {
      resonance: group.resonance,
      sustained: group.sustained,
      isMainLine: group.isMainLine,
      themeScore: group.score,
      rankingScore: Math.round(rankingScore * 100) / 100,
      count: group.count,
      limitCount: group.limitCount,
      stockCount: group.stockCount,
      breadthCount: metrics.breadthCount,
      reasonCodes: unique([
        group.resonance ? "direction_resonance" : "",
        group.sustained ? "direction_sustained" : "",
        group.isMainLine ? "direction_mainline" : "",
        "direction_breadth_passed",
        "high_impact_anchor_present",
        group.sourceThemes.length > 1 ? "same_family_merged" : "",
        firstArray(group.filteredRiskSubthemes).length ? "blocked_subthemes_filtered" : "",
      ]),
      sourceThemeIds: group.sourceThemeIds.slice(),
      sourceThemeNames: group.sourceThemeNames.slice(),
      filteredRiskSubthemes: firstArray(group.filteredRiskSubthemes).slice(),
    },
    emotionAnchors: anchors.map((anchor) => ({ ...anchor })),
    tradeCandidates: [],
  };
}

function resolveContext(input) {
  const source = isObject(input) ? input : {};
  const payload = isObject(source.payload) ? source.payload : source;
  const decision = isObject(source.decision)
    ? source.decision
    : isObject(payload.tomorrowDecision) ? payload.tomorrowDecision : {};
  return {
    source,
    payload,
    decision,
    themeLibrary: isObject(source.themeLibrary)
      ? source.themeLibrary
      : isObject(payload.themeLibrary) ? payload.themeLibrary : {},
    payloadCandidates: firstArray(source.payloadCandidates, source.candidates, payload.candidates),
    primaryTickets: firstArray(source.decisionCandidates, decision.candidates),
    contingencyTickets: firstArray(source.decisionContingencies, decision.contingencies),
    coreItems: firstArray(source.coreEmotionItems, decision.coreEmotion && decision.coreEmotion.items),
    riskBoard: isObject(source.riskBoard)
      ? source.riskBoard
      : isObject(decision.riskBoard) ? decision.riskBoard : isObject(payload.riskBoard) ? payload.riskBoard : {},
  };
}

function buildTomorrowOpportunityMap(input = {}) {
  const context = resolveContext(input);
  const limits = {
    maxDirections: clampInteger(context.source.maxDirections, DEFAULT_LIMITS.maxDirections, 1, 3),
    maxAnchorsPerDirection: clampInteger(context.source.maxAnchorsPerDirection, DEFAULT_LIMITS.maxAnchorsPerDirection, 1, 5),
    maxTradeCandidatesPerDirection: clampInteger(context.source.maxTradeCandidatesPerDirection, DEFAULT_LIMITS.maxTradeCandidatesPerDirection, 1, 3),
    minEmotionWeight: clampInteger(context.source.minEmotionWeight, DEFAULT_LIMITS.minEmotionWeight, 60, 100),
    minBreadth: clampInteger(context.source.minBreadth, DEFAULT_LIMITS.minBreadth, 2, 20),
  };
  const themes = firstArray(context.themeLibrary.themes);
  const groups = mergeThemeFamilies(themes);
  const candidateByCode = fullCandidateIndex(context.payloadCandidates);
  const gate = resolveGlobalGate(context.source, context.decision, context.themeLibrary, context.primaryTickets);
  const eligible = [];
  const rejectedDirections = [];

  groups.forEach((rawGroup) => {
    const riskResolution = resolveRiskBoardGroup(rawGroup, context.riskBoard);
    const group = riskResolution.group;
    const metrics = breadthMetrics(group);
    const anchors = buildAnchorsForGroup(
      group,
      context.coreItems,
      candidateByCode,
      limits.minEmotionWeight,
      limits.maxAnchorsPerDirection,
    );
    const reasonCodes = [];
    if (context.themeLibrary.available === false) reasonCodes.push("theme_library_unavailable");
    if (context.themeLibrary.stale === true) reasonCodes.push("theme_library_stale");
    if (!(group.resonance || group.sustained || group.isMainLine)) reasonCodes.push("direction_signal_missing");
    if (metrics.breadthCount < limits.minBreadth) reasonCodes.push("direction_breadth_missing");
    if (!anchors.length) reasonCodes.push("high_impact_anchor_missing");
    if (riskResolution.blocked) reasonCodes.push(riskResolution.blockedReason || "risk_board_blocked");
    if (negativeAnchorDominates(anchors)) reasonCodes.push("risk_anchor_dominance");

    if (reasonCodes.length) {
      rejectedDirections.push(rejectEntry(group, reasonCodes, metrics, anchors));
      return;
    }
    const rankingScore = directionRankingScore(group, metrics);
    eligible.push({ group, metrics, anchors, rankingScore });
  });

  eligible.sort((left, right) => (
    right.rankingScore - left.rankingScore
    || left.group.rank - right.group.rank
    || left.group.familyKey.localeCompare(right.group.familyKey)
  ));

  const selected = eligible.slice(0, limits.maxDirections);
  eligible.slice(limits.maxDirections).forEach(({ group, metrics, anchors }) => {
    rejectedDirections.push(rejectEntry(group, ["direction_limit"], metrics, anchors));
  });

  const directions = selected.map(({ group, metrics, anchors, rankingScore }, index) => {
    const direction = directionEntry(group, anchors, metrics, rankingScore);
    direction.rank = index + 1;
    direction.threadRole = index === 0 ? "main" : "parallel";
    return direction;
  });
  const selectedByFamily = new Map(selected.map((item, index) => [item.group.familyKey, directions[index]]));

  if (gate.canTradeCandidates) {
    const ticketRows = [
      ...context.primaryTickets.map((ticket) => ({ ticket, sourceType: "primary" })),
      ...context.contingencyTickets.map((ticket) => ({ ticket, sourceType: "contingency" })),
    ];
    ticketRows.forEach(({ ticket, sourceType }) => {
      const fullCandidate = candidateByCode.get(codeOf(ticket)) || null;
      const group = findGroupForStock(selected.map((item) => item.group), ticket, fullCandidate);
      if (!group) return;
      const direction = selectedByFamily.get(group.familyKey);
      if (!direction || direction.tradeCandidates.length >= limits.maxTradeCandidatesPerDirection) return;
      const candidate = tradeCandidateFrom(ticket, fullCandidate, sourceType, context.decision, gate);
      if (!candidate) return;
      direction.tradeCandidates.push(candidate);
      const anchor = direction.emotionAnchors.find((item) => item.code === candidate.code);
      if (anchor) anchor.usage = "anchor_and_trade";
    });
  }

  directions.forEach((direction) => {
    direction.state = direction.tradeCandidates.some((candidate) => candidate.active)
      ? "tradeable"
      : "watch_only";
  });

  if (!groups.length && context.themeLibrary.available === false) {
    rejectedDirections.push({
      id: null,
      name: null,
      family: null,
      rank: null,
      reasonCodes: ["theme_library_unavailable"],
      reasons: ["题材库不可用"],
      metrics: null,
      sourceThemeIds: [],
      sourceThemeNames: [],
    });
  }

  const status = directions.some((direction) => direction.state === "tradeable")
    ? "tradeable"
    : directions.length ? "watch_only" : "none";

  return {
    version: VERSION,
    tradingDate: clean(context.themeLibrary.tradingDate || context.decision.tradingDate) || null,
    status,
    globalGate: gate,
    directions,
    rejectedDirections,
    limits,
    integrity: {
      ok: context.themeLibrary.available !== false && context.themeLibrary.stale !== true,
      sourceThemeCount: themes.length,
      mergedFamilyCount: groups.length,
      selectedDirectionCount: directions.length,
      rejectedDirectionCount: rejectedDirections.length,
      anchorCandidateContractsSeparated: directions.every((direction) => (
        direction.emotionAnchors !== direction.tradeCandidates
        && direction.emotionAnchors.every((anchor) => anchor.selfValidationExcluded === true)
      )),
      closedGateStripsTradeCandidates: gate.status !== "closed"
        || directions.every((direction) => direction.tradeCandidates.length === 0),
    },
  };
}

module.exports = {
  VERSION,
  DEFAULT_LIMITS,
  buildTomorrowOpportunityMap,
  _internals: {
    normalizeToken,
    tokenVariants,
    mergeThemeFamilies,
    resolveGlobalGate,
    candidateQualification,
  },
};
