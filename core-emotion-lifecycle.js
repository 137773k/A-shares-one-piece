"use strict";

const { normalizeBigCycleKey } = require("./quant-decision/market-cycle-contract");

const { buildEmotionCycleState, parseBoardProfile, qualifyPopularCore } = require("./emotion-cycle-engine");

/**
 * 从现有收盘快照中保守识别“高影响核心 + 情绪生命周期”。
 *
 * 这是确定性的规则派生，不是历史校准模型。模块不读文件、不读取系统时间、
 * 不修改输入，也不会仅凭单日涨幅把普通跟随股提升为情绪核心。
 */

const CORE_ROLE_KEYS = Object.freeze(new Set(["leader", "pioneer", "capacity"]));
const STAGE_KEYS = Object.freeze(new Set([
  "weak",
  "weak_to_strong",
  "acceleration",
  "expectation_overdrawn",
  "divergence",
  "supported",
  "consensus_resume",
  "negative_feedback",
  "unknown",
]));

const STAGE_LABELS = Object.freeze({
  weak: "弱势",
  weak_to_strong: "弱转强",
  acceleration: "加速",
  expectation_overdrawn: "预期透支",
  divergence: "分歧兑现",
  supported: "分歧后承接",
  consensus_resume: "重新一致",
  negative_feedback: "负反馈扩散",
  unknown: "阶段待确认",
});

const CYCLE_LABELS = Object.freeze({
  main_rise: "主升",
  range: "震荡",
  retreat: "退潮",
  ice_point: "冰点",
  chaos: "混沌",
  unknown: "周期待确认",
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeDate(value) {
  const digits = String(value == null ? "" : value).replace(/\D/g, "");
  if (digits.length !== 8) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function normalizeCycle(value) {
  return normalizeBigCycleKey(value) || "unknown";
}

function normalizeStage(value) {
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (STAGE_KEYS.has(text)) return text;
  if (/负反馈|核按钮|negative[_ -]?feedback/.test(text)) return "negative_feedback";
  if (/重新一致|再一致|consensus[_ -]?resume/.test(text)) return "consensus_resume";
  if (/承接|supported|support[_ -]?confirmed/.test(text)) return "supported";
  if (/预期透支|透支|overdrawn|exhaust/.test(text)) return "expectation_overdrawn";
  if (/加速|acceleration|accelerating/.test(text)) return "acceleration";
  if (/弱转强|weak[_ -]?to[_ -]?strong/.test(text)) return "weak_to_strong";
  if (/分歧|divergence|兑现/.test(text)) return "divergence";
  if (/弱势|weak/.test(text)) return "weak";
  return "unknown";
}

function stockCode(stock) {
  return String(stock && (stock.code || stock.stockCode || stock.symbol || stock.secCode) || "").trim();
}

function stockIdentity(stock, index = 0) {
  return stockCode(stock) || String(stock && stock.name || "").trim() || `stock-${index + 1}`;
}

function candidateMap(candidates) {
  const map = new Map();
  (Array.isArray(candidates) ? candidates : []).forEach((stock, index) => {
    if (!isObject(stock)) return;
    const code = stockCode(stock);
    const name = String(stock.name || "").trim();
    if (code) map.set(`code:${code}`, stock);
    if (name) map.set(`name:${name}`, stock);
    if (!code && !name) map.set(`index:${index}`, stock);
  });
  return map;
}

function matchingCandidate(map, stock) {
  const code = stockCode(stock);
  const name = String(stock && stock.name || "").trim();
  return (code && map.get(`code:${code}`)) || (name && map.get(`name:${name}`)) || null;
}

function previousLifecycleMap(previousPayload, tradingContext) {
  const map = new Map();
  if (!tradingContext || tradingContext.exactPreviousTradingDay !== true) return map;
  const decision = isObject(previousPayload && previousPayload.tomorrowDecision)
    ? previousPayload.tomorrowDecision
    : {};
  const coreEmotion = isObject(decision.coreEmotion) ? decision.coreEmotion : {};
  const items = Array.isArray(coreEmotion.items) ? coreEmotion.items : [];
  items.forEach((item, index) => {
    if (!isObject(item)) return;
    const stage = normalizeStage(item.stage || item.currentStage || item.sentimentStage);
    if (stage === "unknown") return;
    const normalized = {
      available: true,
      exact: true,
      stage,
      stageLabel: STAGE_LABELS[stage],
      tradingDate: tradingContext.previousTradingDate,
      source: "exact_t1_tomorrow_decision",
    };
    const code = stockCode(item);
    const name = String(item.name || "").trim();
    if (code) map.set(`code:${code}`, normalized);
    if (name) map.set(`name:${name}`, normalized);
    if (!code && !name) map.set(`index:${index}`, normalized);
  });
  return map;
}

function matchingPreviousLifecycle(map, stock) {
  const code = stockCode(stock);
  const name = String(stock && stock.name || "").trim();
  return (code && map.get(`code:${code}`))
    || (name && map.get(`name:${name}`))
    || { available: false, exact: false, stage: "unknown", stageLabel: STAGE_LABELS.unknown, source: "missing" };
}

function resolveSelectedCandidateCode(payload, options) {
  return String(
    options && options.selectedCandidateCode
      || payload && payload.selectedCandidateCode
      || "",
  ).trim();
}

function resolveExcludedCandidateCodes(payload, options) {
  const values = [
    ...(Array.isArray(options && options.excludedCandidateCodes) ? options.excludedCandidateCodes : []),
    ...(Array.isArray(payload && payload.excludedCandidateCodes) ? payload.excludedCandidateCodes : []),
    resolveSelectedCandidateCode(payload, options),
  ];
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function resolveTradingContext(payload, previousPayload, verifiedContext = null) {
  const market = isObject(payload && payload.market) ? payload.market : {};
  const limitStats = isObject(market.limitStats) ? market.limitStats : {};
  const dates = isObject(limitStats.dates) ? limitStats.dates : {};
  const themeLibrary = isObject(payload && payload.themeLibrary) ? payload.themeLibrary : {};
  const previousMarket = isObject(previousPayload && previousPayload.market) ? previousPayload.market : {};
  const previousLimit = isObject(previousMarket.limitStats) ? previousMarket.limitStats : {};
  const previousDates = isObject(previousLimit.dates) ? previousLimit.dates : {};
  const previousArchiveMeta = isObject(previousPayload && previousPayload.archiveMeta)
    ? previousPayload.archiveMeta
    : {};

  const providerTradingDate = normalizeDate(dates.today);
  const themeTradingDate = normalizeDate(themeLibrary.tradingDate);
  const tradingDate = providerTradingDate || themeTradingDate || null;
  const providerExpectedPrevious = dates.verified === true ? normalizeDate(dates.prev) : "";
  const themeExpectedPrevious = themeLibrary.previousDateVerified === true
    ? normalizeDate(themeLibrary.previousTradingDate)
    : "";
  const expectedPreviousTradingDate = providerExpectedPrevious || themeExpectedPrevious;
  const previousTradingDate = normalizeDate(
    previousArchiveMeta.tradingDate
      || previousDates.today
      || previousPayload && previousPayload.themeLibrary && previousPayload.themeLibrary.tradingDate,
  );
  const previousSnapshotKind = String(
    previousArchiveMeta.snapshotKind
      || previousPayload && previousPayload.themeLibrary && previousPayload.themeLibrary.snapshotKind
      || "",
  ).toLowerCase();
  const derivedExactPreviousTradingDay = Boolean(
    tradingDate
    && expectedPreviousTradingDate
    && previousTradingDate
    && expectedPreviousTradingDate === previousTradingDate
    && previousTradingDate < tradingDate
    && previousSnapshotKind === "closing",
  );
  const supplied = isObject(verifiedContext) ? verifiedContext : {};
  const suppliedTradingDate = normalizeDate(supplied.tradingDate);
  const suppliedExpectedPreviousTradingDate = normalizeDate(supplied.expectedPreviousTradingDate);
  const suppliedPreviousTradingDate = normalizeDate(supplied.previousTradingDate);
  const suppliedPreviousSnapshotKind = String(supplied.previousSnapshotKind || "").trim().toLowerCase();
  const suppliedSnapshotKind = String(supplied.snapshotKind || "").trim().toLowerCase();
  const previousEvidenceVerified = Boolean(
    supplied.previousEvidenceVerified === true
    && supplied.exactPreviousTradingDay === true
    && suppliedTradingDate === tradingDate
    && suppliedExpectedPreviousTradingDate === expectedPreviousTradingDate
    && suppliedPreviousTradingDate === previousTradingDate
    && suppliedPreviousSnapshotKind === previousSnapshotKind
  );
  const exactPreviousTradingDay = derivedExactPreviousTradingDay && previousEvidenceVerified;
  return {
    tradingDate,
    providerTradingDate: providerTradingDate || null,
    expectedPreviousTradingDate: expectedPreviousTradingDate || null,
    previousTradingDate: previousTradingDate || null,
    previousSnapshotKind: previousSnapshotKind || null,
    snapshotKind: suppliedSnapshotKind || null,
    previousEvidenceVerified,
    derivedExactPreviousTradingDay,
    exactPreviousTradingDay,
  };
}

function verifiedThemeRoleIndex(themeLibrary) {
  const index = new Map();
  if (!isObject(themeLibrary) || themeLibrary.available !== true || themeLibrary.stale === true) return index;
  const themes = Array.isArray(themeLibrary.themes) ? themeLibrary.themes : [];
  themes.forEach((theme) => {
    (Array.isArray(theme && theme.stocks) ? theme.stocks : []).forEach((stock) => {
      const id = stockIdentity(stock);
      const verifiedTags = (Array.isArray(stock.tags) ? stock.tags : [])
        .filter((tag) => tag && tag.verified === true && CORE_ROLE_KEYS.has(String(tag.key || "")));
      if (!verifiedTags.length) return;
      const current = index.get(id) || { roles: new Set(), reasons: [], themes: new Set() };
      verifiedTags.forEach((tag) => {
        current.roles.add(String(tag.key));
        current.reasons.push(String(tag.reason || `${tag.label || tag.key}已由题材库验证`));
      });
      current.themes.add(String(theme.family || theme.name || "题材").trim() || "题材");
      index.set(id, current);
      const name = String(stock.name || "").trim();
      if (name) index.set(name, current);
    });
  });
  return index;
}

function initiativeView(stock) {
  const leadership = isObject(stock && stock.leadership) ? stock.leadership : {};
  const initiative = isObject(leadership.initiative) ? leadership.initiative : {};
  const session = isObject(initiative.session) ? initiative.session : null;
  const trustedSession = Boolean(session && initiative.dataQuality === "分时验证");
  return { leadership, initiative, session, trustedSession };
}

function normalizedCurrentChange(stock) {
  const { session, trustedSession } = initiativeView(stock);
  const sessionChange = finiteNumber(session && session.currentChangePct);
  if (trustedSession && sessionChange != null) return sessionChange;
  const change = finiteNumber(stock && stock.changePct);
  const price = finiteNumber(stock && stock.price);
  const open = finiteNumber(stock && stock.open);
  const high = finiteNumber(stock && stock.high);
  const low = finiteNumber(stock && stock.low);
  if (change === 0 && price == null && open == null && high == null && low == null) return null;
  return change;
}

function qualifyCore(stock, themeRole) {
  const { leadership, initiative } = initiativeView(stock);
  const history = isObject(leadership.history) ? leadership.history : {};
  const speculation = isObject(stock && stock.speculation) ? stock.speculation : {};
  const boards = finiteNumber(speculation.boards);
  const boardProfile = parseBoardProfile(stock);
  const appearances = finiteNumber(history.appearances) ?? 0;
  const coreHits = finiteNumber(history.coreHits) ?? 0;
  const impactScore = finiteNumber(leadership.impactScore);
  const initiativeScore = finiteNumber(initiative.score ?? (stock && stock.initiativeScore));
  const amountYi = finiteNumber(stock && stock.amountYi);
  const role = String(stock && stock.role || "");
  const cycleIdentity = leadership.cycleIdentity || stock && stock.cycleIdentity || {};
  const sessionIdentity = leadership.sessionIdentity || stock && stock.sessionIdentity || {};
  const verifiedCycleLeader = stock && (stock.roleKind === "cycleLeader" || stock.roleScope === "cycle")
    || cycleIdentity.identityEstablished === true
      && cycleIdentity.activePrimary === true
      && ["confirmed", "retained"].includes(String(cycleIdentity.state || ""));
  const dailyHeightOnly = !verifiedCycleLeader && stock && (
    sessionIdentity.dailyHeight === true
    || stock.roleKind === "dailyHeight"
    || stock.dailyRole === "当日高度"
    || stock.roleScope === "session" && /当日高度|龙头/.test(role)
  );
  // 裸文字角色只能作为展示兼容，不能建立情绪核心身份。
  const highRole = !dailyHeightOnly && verifiedCycleLeader;
  const popularCore = qualifyPopularCore(stock);
  const reasons = [];
  const sources = [];

  if (!dailyHeightOnly && leadership.coreIdentityQualified === true) {
    reasons.push("leadership.coreIdentityQualified=true");
    sources.push("leadership_core_identity");
  }
  if (!dailyHeightOnly && themeRole && themeRole.roles.size) {
    reasons.push(`题材库verified角色：${[...themeRole.roles].sort().join("/")}`);
    sources.push("theme_library_verified_role");
  }
  const verifiedMultiBoard = Boolean(
    (boardProfile.exactConsecutive && (boardProfile.consecutiveBoards ?? 0) >= 2)
    || (boardProfile.boardsInWindow ?? 0) >= 4
    || (boardProfile.source === "legacy_boards" && (boardProfile.consecutiveBoards ?? 0) >= 2 && highRole)
  );
  const priceDiscovery = initiative && initiative.priceDiscovery || {};
  const participatory = priceDiscovery.noPriceDiscovery !== true && priceDiscovery.suspectedOneWord !== true;
  const verifiedCrossStockImpact = (impactScore != null && impactScore >= 30)
    || Number(initiative && initiative.followerCount || 0) >= 2
    || Number(initiative && initiative.breadthLift || 0) > 0;
  const multiBoardHasIndependentCoreEvidence = verifiedCycleLeader
    || leadership.coreIdentityQualified === true
    || popularCore.qualified
    || participatory && (verifiedCrossStockImpact
      || leadership.persistentRecognition === true && appearances >= 2 && coreHits >= 1);
  if (!dailyHeightOnly && verifiedMultiBoard && multiBoardHasIndependentCoreEvidence) {
    reasons.push(`${boardProfile.label || `${boards}板`}高度已验证，具备短线情绪影响力`);
    sources.push("multi_board_height_correlated");
  }
  if (
    !dailyHeightOnly
    &&
    initiative.proactive === true
    && initiative.capacity === true
    && initiativeScore != null
    && initiativeScore >= 70
    && ((impactScore != null && impactScore >= 65) || (amountYi != null && amountYi >= 20))
  ) {
    reasons.push(`主动容量核心，主动性${round(initiativeScore, 0)}分`);
    sources.push("proactive_capacity_core");
  }
  if (!dailyHeightOnly && appearances >= 2 && leadership.recognized === true && highRole) {
    reasons.push(`历史辨识度连续出现${appearances}次`);
    sources.push("historical_recognition");
  }
  if (!dailyHeightOnly && popularCore.qualified) {
    reasons.push(`人气核心三证交叉：${popularCore.evidence.join("；")}`);
    sources.push("dual_top10_persistent_historical_core");
  }
  // persistentRecognition 是重要加权证据，但缓存中也会用于宽泛观察池；
  // 必须先有另一项核心身份依据，不能靠 persistent 单字段纳入几十只普通票。
  if (!dailyHeightOnly && leadership.persistentRecognition === true && leadership.recognized !== false && sources.length > 0) {
    reasons.push("跨日持续辨识度已确认，并有独立核心身份依据交叉验证");
    sources.push("persistent_recognition_correlated");
  }

  const uniqueSources = [...new Set(sources)];
  const qualified = uniqueSources.length > 0;
  const rejectionReasons = [];
  if (!qualified) {
    if (dailyHeightOnly) rejectionReasons.push("当日高度只作为情绪风险锚，不能单独建立周期核心身份");
    if (leadership.coreIdentityQualified !== true) rejectionReasons.push("核心身份门槛未通过");
    if (leadership.persistentRecognition !== true) rejectionReasons.push("无持续辨识度");
    if (!themeRole || !themeRole.roles.size) rejectionReasons.push("题材库无verified龙头/先锋/中军角色");
    if (!verifiedMultiBoard) rejectionReasons.push("无可验证的二连板/四板窗口以上情绪高度");
    if (appearances <= 0) rejectionReasons.push("历史出现次数为0");
    if (initiative.proactive !== true) rejectionReasons.push("主动性未确认或属于被动跟随");
    if (!popularCore.qualified) rejectionReasons.push("未同时满足双榜Top10、跨日持续和历史核心影响");
  }

  let weight = 55;
  if (leadership.coreIdentityQualified === true) weight += 18;
  if (leadership.persistentRecognition === true) weight += 12;
  if (themeRole && themeRole.roles.has("leader")) weight += 14;
  if (themeRole && themeRole.roles.has("pioneer")) weight += 11;
  if (themeRole && themeRole.roles.has("capacity")) weight += 9;
  if (boards != null && boards >= 2) weight += Math.min(12, boards * 3);
  if (initiative.proactive === true) weight += 7;
  if (initiative.capacity === true) weight += 5;
  weight += Math.min(8, appearances * 2);

  return {
    qualified,
    reasons,
    sources: uniqueSources,
    rejectionReasons,
    weight: clamp(Math.round(weight), 55, 100),
    facts: {
      coreIdentityQualified: leadership.coreIdentityQualified === true,
      persistentRecognition: leadership.persistentRecognition === true,
      recognized: leadership.recognized === true,
      verifiedThemeRoles: themeRole ? [...themeRole.roles].sort() : [],
      boards,
      boardProfile: {
        label: boardProfile.label,
        consecutiveBoards: boardProfile.consecutiveBoards,
        boardsInWindow: boardProfile.boardsInWindow,
        exactConsecutive: boardProfile.exactConsecutive,
        source: boardProfile.source,
      },
      historyAppearances: appearances,
      proactive: initiative.proactive === true,
      capacity: initiative.capacity === true,
      initiativeScore,
      leadershipImpactScore: impactScore,
      popularCore: {
        qualified: popularCore.qualified,
        top10Consensus: popularCore.top10Consensus,
        crossDayPersistent: popularCore.crossDayPersistent,
        historicalCoreImpact: popularCore.historicalCoreImpact,
        eastRank: popularCore.eastRank,
        thsRank: popularCore.thsRank,
        coreHits: popularCore.coreHits,
      },
    },
  };
}

function previousChangeEvidence(stock, previousMap, tradingContext) {
  const currentChangePct = normalizedCurrentChange(stock);
  if (tradingContext.exactPreviousTradingDay) {
    const previous = matchingCandidate(previousMap, stock);
    const exactChange = finiteNumber(previous && previous.changePct);
    if (exactChange != null) {
      return {
        available: true,
        exact: true,
        source: "exact_t1_closing_archive",
        previousChangePct: round(exactChange),
        detail: `精确T-1收盘涨跌幅${exactChange >= 0 ? "+" : ""}${round(exactChange)}%`,
      };
    }
  }

  const profile = isObject(stock && stock.klineProfile) ? stock.klineProfile : {};
  const rise2 = finiteNumber(profile.rise2);
  const profileDate = normalizeDate(profile.lastTradingDate);
  const profileCurrent = !tradingContext.tradingDate || !profileDate || profileDate === tradingContext.tradingDate;
  if (rise2 != null && currentChangePct != null && currentChangePct > -100 && profileCurrent) {
    const previousChangePct = ((1 + rise2 / 100) / (1 + currentChangePct / 100) - 1) * 100;
    if (Number.isFinite(previousChangePct) && previousChangePct >= -35 && previousChangePct <= 35) {
      return {
        available: true,
        exact: false,
        source: "rise2_mathematical_inference",
        previousChangePct: round(previousChangePct),
        detail: `由rise2=${round(rise2)}%与今日${currentChangePct >= 0 ? "+" : ""}${round(currentChangePct)}%数学反推T-1约${previousChangePct >= 0 ? "+" : ""}${round(previousChangePct)}%`,
      };
    }
  }
  return {
    available: false,
    exact: false,
    source: "missing",
    previousChangePct: null,
    detail: "缺精确T-1且无法由同交易日rise2数学反推，前日强弱保持unknown",
  };
}

function intradayEvidence(stock) {
  const { leadership, initiative, session, trustedSession } = initiativeView(stock);
  const structure = isObject(leadership.structure) ? leadership.structure : {};
  const profile = isObject(stock && stock.klineProfile) ? stock.klineProfile : {};
  const current = trustedSession
    ? finiteNumber(session && session.currentChangePct) ?? normalizedCurrentChange(stock)
    : normalizedCurrentChange(stock);
  const maximum = finiteNumber(session && session.maxChangePct);
  const minimum = finiteNumber(session && session.minChangePct);
  const fadePct = maximum != null && current != null ? round(maximum - current) : null;
  const recoveryPct = current != null && minimum != null ? round(current - minimum) : null;
  const openedLimit = trustedSession && Number(session.limitOpenCount) > 0;
  const resealed = Boolean(trustedSession && session.resealedAfterOpen === true && session.closedAtLimit === true);
  const postTouchPullback = finiteNumber(session && session.postTouchMaxPullbackPct);
  const structureBreak = structure.breakdown === true || profile.structureBreak === true;
  const negative = Boolean(
    (current != null && current <= -5)
    || (trustedSession && fadePct != null && fadePct >= 6 && current != null && current <= 2)
    || (
      trustedSession
      && session.limitTouched === true
      && session.closedAtLimit !== true
      && postTouchPullback != null
      && postTouchPullback >= 4
      && current != null
      && current < 5
    )
  );
  const supported = Boolean(resealed || (
    trustedSession
    && recoveryPct != null
    && recoveryPct >= 3
    && fadePct != null
    && fadePct <= 2
    && current != null
    && current >= 3
    && finiteNumber(initiative.retentionPct) != null
    && finiteNumber(initiative.retentionPct) >= 70
  ));
  const divergence = Boolean(
    trustedSession
    && !negative
    && fadePct != null
    && fadePct >= 3
    && current != null
    && current > -5
  );
  return {
    trusted: trustedSession,
    dataQuality: String(initiative.dataQuality || "数据缺失"),
    currentChangePct: current,
    maxChangePct: maximum,
    minChangePct: minimum,
    fadePct,
    recoveryPct,
    openedLimit,
    resealed,
    supported,
    divergence,
    negative,
    structureBreak,
    proactive: initiative.proactive === true,
    initiativeScore: finiteNumber(initiative.score ?? (stock && stock.initiativeScore)),
  };
}

function expectedTransition(stage, cycleKey) {
  if (stage === "negative_feedback") {
    return { key: "harmful_divergence", label: "防范负反馈继续扩散" };
  }
  if (stage === "expectation_overdrawn" || stage === "acceleration") {
    if (cycleKey === "main_rise") {
      return { key: "brief_divergence_then_consensus", label: "主升期先分歧，承接后再一致" };
    }
    if (cycleKey === "retreat" || cycleKey === "ice_point") {
      return { key: "harmful_divergence", label: "退潮环境默认按非良性分歧防守" };
    }
    return { key: "range_divergence", label: "非主升大周期默认进入分歧兑现" };
  }
  if (stage === "supported" || stage === "consensus_resume") {
    if (cycleKey === "main_rise") return { key: "consensus_resume", label: "主升期承接后重新一致" };
    if (cycleKey === "retreat") return { key: "defensive_rebound", label: "退潮期承接先按防守反抽" };
    return { key: "support_validation", label: "继续验证承接能否扩散" };
  }
  if (stage === "weak_to_strong") {
    if (cycleKey === "main_rise") return { key: "acceleration_candidate", label: "主升期弱转强后观察加速" };
    if (cycleKey === "retreat") return { key: "rebound_only", label: "退潮期弱转强先按反抽" };
    return { key: "confirmation_required", label: "震荡期弱转强仍需多核心确认" };
  }
  if (stage === "divergence") return { key: "support_validation", label: "分歧后验证承接质量" };
  if (stage === "weak") return { key: "weakness_validation", label: "继续观察弱势是否扩散" };
  return { key: "unknown", label: "证据不足，不推演后续路径" };
}

function deriveStage(stock, previous, intraday, cycleKey, previousLifecycle = {}) {
  const speculation = isObject(stock && stock.speculation) ? stock.speculation : {};
  const currentChangePct = normalizedCurrentChange(stock);
  const boards = finiteNumber(speculation.boards);
  const verifiedLifecycle = isObject(stock && stock.lifecycle) && stock.lifecycle.verified === true;
  const explicitStage = verifiedLifecycle
    ? normalizeStage(stock.sentimentStage || stock.lifecycle.currentStage || stock.lifecycle.stage)
    : "unknown";
  const evidence = [];
  let stage = "unknown";
  let confidence = 30;
  let source = "insufficient_evidence";

  if (explicitStage !== "unknown") {
    stage = explicitStage;
    confidence = 90;
    source = "verified_explicit_lifecycle";
    evidence.push({ id: "verified_explicit_stage", reliable: true, detail: `沿用已验证阶段${STAGE_LABELS[stage]}` });
  } else if (intraday.negative) {
    stage = "negative_feedback";
    confidence = intraday.trusted ? 82 : 76;
    source = "negative_price_feedback";
    evidence.push({
      id: "negative_feedback",
      reliable: true,
      detail: `大跌或可信分时冲高回落形成负反馈${intraday.fadePct != null ? `，最大回落${intraday.fadePct}%` : ""}`,
    });
  } else if (intraday.supported && previousLifecycle.available) {
    stage = previousLifecycle.stage === "supported" ? "consensus_resume" : "supported";
    confidence = previousLifecycle.available ? 86 : 82;
    source = previousLifecycle.available ? "cross_day_intraday_support" : "verified_intraday_support";
    evidence.push({
      id: "intraday_support",
      reliable: true,
      detail: previousLifecycle.available
        ? `昨日${previousLifecycle.stageLabel}，今日${intraday.resealed ? "破板后完成回封" : "回踩后获得真实分时承接"}`
        : intraday.resealed ? "真实分时破板后完成回封" : "真实分时回踩后承接并接近强位收盘",
    });
  } else if (intraday.divergence) {
    stage = "divergence";
    confidence = 72;
    source = "verified_intraday_divergence";
    evidence.push({ id: "intraday_divergence", reliable: true, detail: `真实分时较日内高点回落${intraday.fadePct}%且尚未形成负反馈` });
  } else if (
    previousLifecycle.stage === "acceleration"
    && currentChangePct != null
    && currentChangePct >= 3
  ) {
    stage = "expectation_overdrawn";
    confidence = 82;
    source = "cross_day_acceleration_overdrawn";
    evidence.push({ id: "cross_day_overdrawn", reliable: true, detail: "昨日已处加速，今日继续强势，预期进入透支区" });
  } else if (intraday.supported) {
    stage = "supported";
    confidence = 82;
    source = "verified_intraday_support";
    evidence.push({ id: "intraday_support", reliable: true, detail: intraday.resealed ? "真实分时破板后完成回封" : "真实分时回踩后承接并接近强位收盘" });
  } else if (
    previous.available
    && previous.previousChangePct <= -2
    && currentChangePct != null
    && currentChangePct >= 3
    && intraday.proactive
    && intraday.initiativeScore != null
    && intraday.initiativeScore >= 65
  ) {
    stage = "weak_to_strong";
    confidence = previous.exact ? 80 : 66;
    source = previous.exact ? "exact_t1_weak_to_strong" : "rise2_inferred_weak_to_strong";
    evidence.push({ id: "weak_to_strong", reliable: previous.exact, detail: `${previous.detail}；今日主动转强${currentChangePct >= 0 ? "+" : ""}${round(currentChangePct)}%` });
  } else if (
    previousLifecycle.stage === "weak_to_strong"
    && currentChangePct != null
    && currentChangePct >= 5
    && intraday.trusted
    && intraday.proactive
  ) {
    stage = "acceleration";
    confidence = 84;
    source = "cross_day_weak_to_strong_acceleration";
    evidence.push({ id: "cross_day_acceleration", reliable: true, detail: "昨日弱转强，今日真实分时继续主动走强，确认进入加速" });
  } else if (
    boards != null
    && boards >= 2
    && currentChangePct != null
    && currentChangePct >= 3
  ) {
    stage = "acceleration";
    confidence = 78;
    source = "multi_board_continuation";
    evidence.push({ id: "multi_board_acceleration", reliable: true, detail: `${boards}板连续强势，不是单日涨幅推断` });
  } else if (
    previous.available
    && previous.previousChangePct >= 3
    && currentChangePct != null
    && currentChangePct >= 5
    && intraday.trusted
    && intraday.proactive
  ) {
    stage = "acceleration";
    confidence = previous.exact ? 78 : 65;
    source = previous.exact ? "exact_t1_intraday_acceleration" : "rise2_inferred_intraday_acceleration";
    evidence.push({ id: "continuous_strength", reliable: previous.exact, detail: `${previous.detail}；今日真实分时主动强势${currentChangePct >= 0 ? "+" : ""}${round(currentChangePct)}%` });
  } else if (currentChangePct != null && currentChangePct <= -2) {
    stage = "weak";
    confidence = 58;
    source = "closing_weakness";
    evidence.push({ id: "closing_weakness", reliable: true, detail: `当日收跌${round(currentChangePct)}%，暂未达到负反馈门槛` });
  } else {
    evidence.push({ id: "stage_unknown", reliable: false, detail: "没有连续强势、精确弱转强、可信分时承接或负反馈证据，阶段保持unknown" });
  }

  if (intraday.resealed && stage !== "supported") {
    evidence.push({ id: "reseal_context", reliable: true, detail: "真实分时存在破板回封承接，但主阶段被更高优先级证据覆盖" });
  }
  if (previous.available) {
    evidence.push({ id: "previous_change", reliable: previous.exact, detail: previous.detail });
  } else {
    evidence.push({ id: "previous_change_missing", reliable: false, detail: previous.detail });
  }
  if (previousLifecycle.available) {
    evidence.push({
      id: "previous_lifecycle_stage",
      reliable: previousLifecycle.exact === true,
      detail: `精确T-1核心阶段：${previousLifecycle.stageLabel}`,
    });
  }

  return {
    stage,
    stageLabel: STAGE_LABELS[stage],
    confidence,
    confidenceLabel: confidence >= 80 ? "高" : confidence >= 65 ? "中等" : confidence >= 50 ? "偏低" : "低",
    source,
    evidence,
    expectedTransition: expectedTransition(stage, cycleKey),
    previousStage: previousLifecycle.available ? previousLifecycle.stage : "unknown",
    previousStageLabel: previousLifecycle.available ? previousLifecycle.stageLabel : STAGE_LABELS.unknown,
  };
}

function buildCoreEmotionBasket(payload, options = {}) {
  const source = isObject(payload) ? payload : {};
  const previousPayload = isObject(options.previousPayload) ? options.previousPayload : null;
  const candidates = Array.isArray(source.candidates) ? source.candidates : [];
  const previousCandidates = Array.isArray(previousPayload && previousPayload.candidates)
    ? previousPayload.candidates
    : [];
  const previousMap = candidateMap(previousCandidates);
  const themeRoles = verifiedThemeRoleIndex(source.themeLibrary);
  const tradingContext = resolveTradingContext(source, previousPayload, options.tradingContext);
  const lifecycleMap = previousLifecycleMap(previousPayload, tradingContext);
  const marketState = isObject(source.market && source.market.state) ? source.market.state : {};
  const legacyCycleKey = normalizeCycle(marketState.structuralCycle || marketState.cycle || marketState.observedCycle);
  const selectedCandidateCode = resolveSelectedCandidateCode(source, options);
  const excludedCandidateCodes = resolveExcludedCandidateCodes(source, options);
  const excludedCandidateSet = new Set(excludedCandidateCodes);
  const items = [];
  const rejected = [];
  const emotionCandidates = [];

  candidates.forEach((stock, index) => {
    if (!isObject(stock)) return;
    const id = stockIdentity(stock, index);
    const themeRole = themeRoles.get(id) || themeRoles.get(String(stock.name || "").trim()) || null;
    const qualification = qualifyCore(stock, themeRole);
    emotionCandidates.push({
      ...stock,
      canonicalThemeFamily: themeRole && themeRole.themes.size
        ? [...themeRole.themes][0]
        : String(stock.canonicalThemeFamily || "").trim() || null,
      emotionIdentity: {
        qualified: qualification.qualified,
        sources: qualification.sources.slice(),
        reasons: qualification.reasons.slice(),
        facts: { ...qualification.facts },
        verifiedThemeRoles: qualification.facts.verifiedThemeRoles.slice(),
        legacyWeight: qualification.weight,
      },
    });
    if (!qualification.qualified) {
      rejected.push({
        code: stockCode(stock) || null,
        name: String(stock.name || id),
        changePct: finiteNumber(stock.changePct),
        reasons: qualification.rejectionReasons,
      });
      return;
    }

    const previous = previousChangeEvidence(stock, previousMap, tradingContext);
    const intraday = intradayEvidence(stock);
    const previousLifecycle = matchingPreviousLifecycle(lifecycleMap, stock);
    const stage = deriveStage(stock, previous, intraday, legacyCycleKey, previousLifecycle);
    const code = stockCode(stock);
    const selectedCandidate = excludedCandidateSet.has(code);
    const sentimentEvidence = [
      ...qualification.reasons.map((detail) => ({ id: "core_qualification", reliable: true, detail })),
      ...stage.evidence,
    ];
    items.push({
      ...stock,
      sentimentStage: stage.stage,
      emotionWeight: qualification.weight,
      emotionImpact: {
        score: qualification.weight,
        level: qualification.weight >= 85 ? "high" : qualification.weight >= 70 ? "medium" : "watch",
        sources: qualification.sources,
        reasons: qualification.reasons,
      },
      sentimentEvidence,
      lifecycle: {
        version: 1,
        method: "rule_derived",
        calibrated: false,
        stage: stage.stage,
        currentStage: stage.stage,
        stageLabel: stage.stageLabel,
        confidence: stage.confidence,
        confidenceLabel: stage.confidenceLabel,
        source: stage.source,
        evidence: stage.evidence,
        previousChange: previous,
        intraday,
        marketRegime: { key: legacyCycleKey, label: CYCLE_LABELS[legacyCycleKey] },
        expectedTransition: stage.expectedTransition,
        previousStage: stage.previousStage,
        previousStageLabel: stage.previousStageLabel,
        coreQualification: {
          qualified: true,
          sources: qualification.sources,
          reasons: qualification.reasons,
          facts: qualification.facts,
        },
        expectationRiskHint: /透支/.test(String(stock && stock.speculation && stock.speculation.expectation || ""))
          ? { key: "high", source: "speculation_hint_only", usedForStage: false }
          : { key: "normal", source: "speculation_hint_only", usedForStage: false },
        selectedCandidate,
      },
    });
  });

  const emotionCycle = buildEmotionCycleState({
    currentItems: emotionCandidates,
    previousPayload,
    selectedCandidateCode,
    excludedCandidateCodes,
    emotionEffectContext: marketState.emotionEffectContext || null,
    emotionBigCycleWindow: marketState.emotionBigCycleWindow || null,
    snapshotKind: options.snapshotKind
      || tradingContext.snapshotKind
      || "unknown",
    generationContext: options.generationContext
      || source.premarketModels && source.premarketModels.generationContext
      || source.generationContext
      || null,
    tradingContext,
    exactPreviousTradingDay: tradingContext.exactPreviousTradingDay,
  });
  const cycleKey = normalizeCycle(emotionCycle.bigCycle && emotionCycle.bigCycle.key);
  const anchorByCode = new Map();
  const anchorByName = new Map();
  emotionCycle.rankedAnchors.forEach((anchor) => {
    if (anchor.code) anchorByCode.set(anchor.code, anchor);
    if (anchor.name) anchorByName.set(anchor.name, anchor);
  });
  const emotionAnchorView = (stock) => {
    const anchor = anchorByCode.get(stockCode(stock)) || anchorByName.get(String(stock && stock.name || ""));
    if (!anchor) return null;
    return {
      layer: anchor.layer,
      layerLabel: anchor.layerLabel,
      role: anchor.anchorRole,
      roleLabel: anchor.anchorRoleLabel,
      score: anchor.anchorScore,
      stateScore: anchor.stateScore,
      influenceScore: anchor.influenceScore,
      influenceWeightPct: anchor.influenceWeightPct,
      influenceWeight: anchor.influenceWeight,
      profitEffectScore: anchor.profitEffectScore,
      profitEffectWeightPct: anchor.profitEffectWeightPct,
      priceDiscoveryType: anchor.priceDiscoveryType,
      priceDiscovery: anchor.priceDiscovery,
      profitEffect: anchor.profitEffect,
      heat: anchor.heat,
      support: anchor.support,
      damage: anchor.damage,
      expectationRisk: anchor.expectationRisk,
      selectedCandidate: anchor.selectedCandidate,
      excludedFromMarketState: anchor.excludedFromMarketState,
    };
  };
  const layeredItems = items.map((stock) => {
    const emotionAnchor = emotionAnchorView(stock);
    const unifiedScore = emotionAnchor ? emotionAnchor.stateScore : 0;
    return {
      ...stock,
      lifecycle: {
        ...stock.lifecycle,
        marketRegime: { key: cycleKey, label: CYCLE_LABELS[cycleKey] },
        expectedTransition: expectedTransition(stock.sentimentStage, cycleKey),
      },
      emotionScore: unifiedScore,
      emotionWeight: unifiedScore,
      emotionInfluenceWeightPct: emotionAnchor ? emotionAnchor.influenceWeightPct : 0,
      profitEffectScore: emotionAnchor ? emotionAnchor.profitEffectScore : null,
      profitEffectWeightPct: emotionAnchor ? emotionAnchor.profitEffectWeightPct : 0,
      priceDiscoveryType: emotionAnchor ? emotionAnchor.priceDiscoveryType : "unknown",
      emotionImpact: {
        ...stock.emotionImpact,
        score: unifiedScore,
        level: unifiedScore >= 85 ? "high" : unifiedScore >= 70 ? "medium" : "watch",
        scoreStandard: "emotion_anchor_influence_100_v2",
        breakdown: emotionAnchor && emotionAnchor.influenceScore
          ? emotionAnchor.influenceScore.components
          : {},
        evidenceCountAffectsScore: false,
        influenceWeightPct: emotionAnchor ? emotionAnchor.influenceWeightPct : 0,
        profitEffectScore: emotionAnchor ? emotionAnchor.profitEffectScore : null,
        profitEffectWeightPct: emotionAnchor ? emotionAnchor.profitEffectWeightPct : 0,
      },
      emotionAnchor,
    };
  });

  layeredItems.sort((a, b) => {
    if (b.emotionInfluenceWeightPct !== a.emotionInfluenceWeightPct) {
      return b.emotionInfluenceWeightPct - a.emotionInfluenceWeightPct;
    }
    if (b.emotionWeight !== a.emotionWeight) return b.emotionWeight - a.emotionWeight;
    const left = stockIdentity(a);
    const right = stockIdentity(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  rejected.sort((a, b) => {
    const left = a.code || a.name;
    const right = b.code || b.name;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const stageCounts = Object.fromEntries([...STAGE_KEYS].sort().map((key) => [key, 0]));
  layeredItems.forEach((stock) => {
    stageCounts[stock.sentimentStage] = (stageCounts[stock.sentimentStage] || 0) + 1;
  });

  return {
    version: 2,
    method: "unified_score_with_normalized_influence",
    calibrated: false,
    tradingDate: tradingContext.tradingDate,
    items: layeredItems,
    emotionCycle,
    summary: {
      marketRegime: { key: cycleKey, label: CYCLE_LABELS[cycleKey] },
      candidateCount: candidates.length,
      qualifiedCount: layeredItems.length,
      rejectedCount: rejected.length,
      selectedCandidateCode: selectedCandidateCode || null,
      excludedCandidateCodes,
      stageCounts,
      highImpactCount: layeredItems.filter((stock) => stock.emotionWeight >= 85).length,
      influenceWeightTotalPct: round(
        emotionCycle.rankedAnchors.reduce((sum, anchor) => sum + (finiteNumber(anchor.influenceWeightPct) ?? 0), 0),
        1,
      ),
      unknownStageCount: stageCounts.unknown || 0,
      anchorLayerCounts: {
        A: emotionCycle.anchorLayers.A.length,
        B: emotionCycle.anchorLayers.B.length,
        C: emotionCycle.anchorLayers.C.length,
      },
      emotionCycleStage: emotionCycle.current,
    },
    dataQuality: {
      exactPreviousTradingDay: tradingContext.exactPreviousTradingDay,
      expectedPreviousTradingDate: tradingContext.expectedPreviousTradingDate,
      previousTradingDate: tradingContext.previousTradingDate,
      previousSnapshotKind: tradingContext.previousSnapshotKind,
      verifiedThemeRoleCount: new Set([...themeRoles.values()]).size,
      previousLifecycleCount: new Set([...lifecycleMap.values()]).size,
      notes: [
        "只纳入已验证核心身份、持续辨识度、题材库verified龙头/先锋/中军、高标或主动容量核心。",
        "单日大涨不能单独取得核心身份，也不能单独生成加速或弱转强阶段。",
        tradingContext.exactPreviousTradingDay
          ? "已使用精确T-1收盘归档。"
          : "缺精确T-1时仅允许由同交易日rise2与今日涨跌幅数学反推，并在证据中降级标注。",
        lifecycleMap.size
          ? "已读取精确T-1冻结的核心阶段，用于校验弱转强、加速、透支、分歧与承接迁移。"
          : "尚无精确T-1核心阶段快照；当前阶段为当日规则识别，不冒充已完成跨日状态校验。",
      ],
    },
    rejected,
  };
}

module.exports = {
  buildCoreEmotionBasket,
  normalizeCycle,
  normalizeStage,
  resolveTradingContext,
  previousChangeEvidence,
  previousLifecycleMap,
  intradayEvidence,
};
