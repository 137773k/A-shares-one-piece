"use strict";

const {
  BIG_CYCLE_LABELS,
  normalizeBigCycleKey,
} = require("./quant-decision/market-cycle-contract");

/**
 * 情绪锚与跨日状态机。
 *
 * 目标：
 * 1. 将 A 层情绪主锚、B 层容量确认、C 层广度样本分开，避免后排数量灌票。
 * 2. 将热度 H、承接 C、伤害 D 分轴表达；一字板只贡献热度，承接保持 unknown。
 * 3. 只有至少 3 个独立样本、覆盖至少 2 种角色且含 2 个 A/B 锚，才允许阶段变化。
 * 4. speculation.expectation 只作为位置风险提示，绝不直接生成情绪阶段。
 *
 * 模块为纯函数：不读文件、不读取系统时间、不修改输入。
 */

const EMOTION_STATE_LABELS = Object.freeze({
  acceleration: "加速",
  climax: "高潮",
  strong_divergence: "强分歧",
  realization: "兑现",
  support: "承接",
  harmful: "非良性分歧",
  retreat: "退潮",
  unknown: "阶段待确认",
});

const LAYER_LABELS = Object.freeze({
  A: "情绪主锚",
  B: "容量确认",
  C: "广度样本",
});

const ROLE_LABELS = Object.freeze({
  height: "高度核心",
  leader: "方向龙头",
  popular_core: "人气核心",
  pioneer: "启动先锋",
  capacity: "容量中军",
  breadth: "广度样本",
});

const SCORE_STANDARD = Object.freeze({
  key: "emotion_anchor_influence_100_v2",
  label: "情绪锚影响力统一百分制",
  min: 0,
  max: 100,
  evidenceCountAffectsScore: false,
  componentMaximums: Object.freeze({
    popularity: 35,
    height: 25,
    recognition: 15,
    roleInfluence: 15,
    currentStrength: 10,
  }),
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

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function uniqueTexts(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function stockCode(stock) {
  return String(stock && (stock.code || stock.stockCode || stock.secCode || stock.symbol) || "").trim();
}

function stockName(stock) {
  return String(stock && stock.name || "").trim();
}

function stockIdentity(stock, index = 0) {
  return stockCode(stock) || stockName(stock) || `sample-${index + 1}`;
}

function excludedRecommendationCodes(source) {
  return new Set([
    source && source.selectedCandidateCode,
    ...(Array.isArray(source && source.excludedCandidateCodes) ? source.excludedCandidateCodes : []),
  ].map((value) => String(value || "").trim()).filter(Boolean));
}

function currentChange(stock) {
  const { session, trustedSession } = initiativeView(stock);
  const sessionChange = finiteNumber(session && session.currentChangePct);
  if (sessionChange != null && trustedSession) return sessionChange;
  const change = finiteNumber(stock && stock.changePct);
  const price = finiteNumber(stock && stock.price);
  const open = finiteNumber(stock && stock.open);
  const high = finiteNumber(stock && stock.high);
  const low = finiteNumber(stock && stock.low);
  // 盘前抓取器常用0填充未产生的涨跌幅。无价格/无OHLC时，0是unknown，不是平盘证据。
  if (change === 0 && price == null && open == null && high == null && low == null) return null;
  return change;
}

function completedSession(session) {
  return Boolean(session && (
    session.completed === true
    || /closing|closed|completed|收盘|完成/.test(String(session.snapshotKind || session.status || "").toLowerCase())
  ));
}

function initiativeView(stock, expectedCurrentTradingDate = "") {
  const leadership = isObject(stock && stock.leadership) ? stock.leadership : {};
  const initiative = isObject(leadership.initiative) ? leadership.initiative : {};
  const rawSession = isObject(initiative.session) ? initiative.session : null;
  const expectedDate = normalizedSessionDate(expectedCurrentTradingDate);
  const observedDate = normalizedSessionDate(rawSession && rawSession.tradingDate);
  const dateMatched = !expectedDate || Boolean(observedDate && observedDate === expectedDate);
  const intradayTrusted = Boolean(rawSession && initiative.dataQuality === "分时验证");
  const closingPathTrusted = Boolean(
    rawSession
    && initiative.dataQuality === "收盘路径代理"
    && rawSession.verified === true
    && completedSession(rawSession)
    && dateMatched
  );
  const session = rawSession;
  const sessionGranularity = closingPathTrusted
    ? "closing_path_proxy"
    : intradayTrusted
      ? "intraday"
      : "untrusted";
  return {
    leadership,
    initiative,
    session,
    trustedSession: intradayTrusted || closingPathTrusted,
    sessionGranularity,
    expectedCurrentTradingDate: expectedDate || null,
    observedSessionDate: observedDate || null,
    dateMatched,
  };
}

function normalizedSessionDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 8
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    : "";
}

function verifiedCompletedLastSession(stock, expectedPreviousTradingDate = "") {
  const profile = isObject(stock && stock.klineProfile) ? stock.klineProfile : {};
  const session = isObject(profile.lastSession) ? profile.lastSession : null;
  if (!session) return { available: false, trusted: false, session: null, dataQuality: "missing" };
  const completed = completedSession(session);
  const expectedDate = normalizedSessionDate(expectedPreviousTradingDate);
  const observedDate = normalizedSessionDate(session.tradingDate);
  const dateMatched = !expectedDate || observedDate === expectedDate;
  const trusted = session.verified === true && completed && dateMatched;
  return {
    available: true,
    trusted,
    completed,
    session,
    expectedTradingDate: expectedDate || null,
    observedTradingDate: observedDate || null,
    dateMatched,
    dataQuality: trusted
      ? (expectedDate ? "verified_exact_previous_session" : "verified_completed_last_session")
      : expectedDate && observedDate && !dateMatched
        ? "stale_last_session"
        : "unverified",
  };
}

function sessionLooksOneWord(session, discovery = {}, eventEvidenceEligible = true) {
  if (!isObject(session)) return false;
  // 可信的开板/回封事实优先级高于宽泛标签，避免旧oneWord标记覆盖真实换手。
  if (eventEvidenceEligible && (Number(session.limitOpenCount) > 0 || session.resealedAfterOpen === true)) return false;
  if (
    session.oneWord === true
    || session.noPriceDiscovery === true
    || discovery.noPriceDiscovery === true
    || discovery.suspectedOneWord === true
  ) return true;
  if (session.oneWord === false) return false;
  if (session.closedAtLimit !== true) return false;
  const open = finiteNumber(session.openChangePct);
  const current = finiteNumber(session.currentChangePct);
  const maximum = finiteNumber(session.maxChangePct);
  const minimum = finiteNumber(session.minChangePct);
  return open != null && current != null && maximum != null && minimum != null
    && Math.abs(maximum - minimum) <= 0.25
    && Math.abs(open - current) <= 0.25;
}

function resolvePriceDiscovery(stock, expectedPreviousTradingDate = "", currentTradingDate = "") {
  const currentView = initiativeView(stock, currentTradingDate);
  const {
    initiative,
    session: currentSession,
    trustedSession,
    sessionGranularity: currentSessionGranularity,
  } = currentView;
  const currentDiscovery = isObject(initiative.priceDiscovery) ? initiative.priceDiscovery : {};
  const last = verifiedCompletedLastSession(stock, expectedPreviousTradingDate);
  let session = null;
  let discovery = {};
  let source = "missing";
  let dataQuality = "missing";
  let sessionGranularity = "untrusted";

  if (trustedSession) {
    session = currentSession;
    discovery = currentDiscovery;
    source = currentSessionGranularity === "closing_path_proxy"
      ? "trusted_current_closing_path_proxy"
      : "trusted_current_session";
    dataQuality = currentSessionGranularity === "closing_path_proxy" ? "closing_path_proxy" : "trusted";
    sessionGranularity = currentSessionGranularity;
  } else if (last.trusted) {
    session = last.session;
    discovery = isObject(last.session.priceDiscovery) ? last.session.priceDiscovery : {};
    source = last.dataQuality === "verified_exact_previous_session"
      ? "verified_exact_previous_session"
      : "verified_completed_last_session";
    dataQuality = last.dataQuality;
    sessionGranularity = "completed_session";
  } else if (
    stock && stock.oneWord === true
    || currentDiscovery.noPriceDiscovery === true
    || currentDiscovery.suspectedOneWord === true
  ) {
    return {
      type: "one_word",
      label: "一字/无价格发现",
      source: stock && stock.oneWord === true ? "explicit_stock_flag" : "explicit_price_discovery_flag",
      dataQuality: "declared",
      trusted: false,
      session: null,
      completed: false,
      sessionGranularity: "declared_one_word",
      eventEvidenceEligible: false,
      oneWord: true,
      closedAtLimit: true,
      limitOpenCount: null,
      openedLimit: false,
      limitTouched: null,
      limitFailed: false,
      resealed: false,
      evidence: ["显式标记为一字或无价格发现"],
    };
  } else {
    return {
      type: "unknown",
      label: "价格发现待验证",
      source: last.dataQuality === "stale_last_session"
        ? "stale_last_session"
        : last.available ? "unverified_last_session" : "missing",
      dataQuality: last.available ? (last.dataQuality || "unverified") : "missing",
      trusted: false,
      session: null,
      completed: false,
      sessionGranularity: "untrusted",
      eventEvidenceEligible: false,
      oneWord: false,
      closedAtLimit: null,
      limitOpenCount: null,
      openedLimit: false,
      limitTouched: null,
      limitFailed: false,
      resealed: null,
      evidence: [
        last.dataQuality === "stale_last_session"
          ? `lastSession日期${last.observedTradingDate || "未知"}不等于应有上一交易日${last.expectedTradingDate || "未知"}`
          : last.available
            ? "lastSession未同时满足verified=true、completed/closing与日期校验"
            : "缺少可信当日分时或上一完成交易日分时",
      ],
    };
  }

  const eventEvidenceEligible = sessionGranularity !== "closing_path_proxy"
    || session.intradayEventsVerified === true;
  const oneWord = sessionLooksOneWord(session, {
    ...discovery,
    suspectedOneWord: discovery.suspectedOneWord === true || stock && stock.oneWord === true,
  }, eventEvidenceEligible);
  const closedAtLimit = session.closedAtLimit === true;
  const limitOpenCount = eventEvidenceEligible ? finiteNumber(session.limitOpenCount) : null;
  const openedLimit = limitOpenCount != null && limitOpenCount > 0;
  const resealed = Boolean(eventEvidenceEligible && closedAtLimit && (
    session.resealedAfterOpen === true || openedLimit
  ));
  const limitTouched = session.limitTouched === true;
  const limitFailed = limitTouched && !closedAtLimit;
  const current = finiteNumber(session.currentChangePct);
  const open = finiteNumber(session.openChangePct);
  const maximum = finiteNumber(session.maxChangePct);
  const minimum = finiteNumber(session.minChangePct);
  const hasRange = maximum != null && minimum != null && maximum - minimum > 0.25;
  const hasPriceMovement = hasRange || (open != null && current != null && Math.abs(current - open) > 0.25);
  let type = "unknown";
  let label = "价格发现待验证";
  const evidence = [];
  if (sessionGranularity === "closing_path_proxy") {
    evidence.push("已验证当日收盘OHLC路径代理，仅证明日内价格范围与收盘结果");
  }

  if (oneWord) {
    type = "one_word";
    label = "一字/无价格发现";
    evidence.push("价格全程锁定且无换手开板记录");
  } else if (resealed) {
    type = "turnover_reseal";
    label = "换手开板后回封";
    const exactOpenCount = finiteNumber(session.limitOpenCount);
    evidence.push(
      exactOpenCount != null && exactOpenCount > 0
        ? `开板${exactOpenCount}次后收于涨停`
        : "开板后收于涨停；精确开板次数待分时确认",
    );
  } else if (closedAtLimit && (session.oneWord === false || hasPriceMovement)) {
    type = "turnover_limit";
    label = sessionGranularity === "closing_path_proxy" ? "收盘路径显示非一字封板" : "非一字换手封板";
    evidence.push(sessionGranularity === "closing_path_proxy" ? "日内价格有变化且收于涨停" : "完成价格发现后收于涨停");
  } else if (hasPriceMovement || current != null) {
    type = "active_price_discovery";
    label = sessionGranularity === "closing_path_proxy" ? "收盘价格路径有效" : "有效价格发现";
    evidence.push(sessionGranularity === "closing_path_proxy" ? "OHLC显示日内存在真实价格运动" : "可信分时存在可交易的价格运动");
  }

  return {
    type,
    label,
    source,
    dataQuality,
    trusted: type !== "unknown",
    session,
    completed: completedSession(session),
    sessionGranularity,
    eventEvidenceEligible,
    oneWord,
    closedAtLimit,
    limitOpenCount,
    openedLimit,
    limitTouched,
    limitFailed,
    resealed,
    evidence,
  };
}

function verifiedThemeRoles(stock) {
  const identity = isObject(stock && stock.emotionIdentity) ? stock.emotionIdentity : {};
  const identityFacts = isObject(identity.facts) ? identity.facts : {};
  const lifecycle = isObject(stock && stock.lifecycle) ? stock.lifecycle : {};
  const qualification = isObject(lifecycle.coreQualification) ? lifecycle.coreQualification : {};
  const qualificationFacts = isObject(qualification.facts) ? qualification.facts : {};
  return uniqueTexts([
    ...(Array.isArray(identity.verifiedThemeRoles) ? identity.verifiedThemeRoles : []),
    ...(Array.isArray(identityFacts.verifiedThemeRoles) ? identityFacts.verifiedThemeRoles : []),
    ...(Array.isArray(qualificationFacts.verifiedThemeRoles) ? qualificationFacts.verifiedThemeRoles : []),
    ...(Array.isArray(stock && stock.verifiedThemeRoles) ? stock.verifiedThemeRoles : []),
  ]);
}

function verifiedCycleLeaderRole(stock, roles = []) {
  const leadership = isObject(stock && stock.leadership) ? stock.leadership : {};
  const identity = isObject(leadership.cycleIdentity) ? leadership.cycleIdentity : {};
  const dailyHeightOnly = stock && (
    stock.roleKind === "dailyHeight"
    || stock.dailyRole === "当日高度"
    || stock.roleScope === "session" && /当日高度/.test(String(stock.role || ""))
  );
  if (dailyHeightOnly) return false;
  return roles.includes("leader")
    || stock && stock.roleKind === "cycleLeader"
    || stock && stock.roleScope === "cycle"
    || identity.identityEstablished === true
      && identity.activePrimary !== false
      && ["confirmed", "retained"].includes(String(identity.state || ""))
    || stock && stock.roleKind === "cycleLeader" && stock.roleScope === "cycle";
}

function parseBoardProfile(stock) {
  const speculation = isObject(stock && stock.speculation) ? stock.speculation : {};
  const explicitConsecutive = finiteNumber(
    speculation.consecutiveBoards
      ?? (stock && stock.consecutiveBoards)
      ?? (stock && stock.boardStats && stock.boardStats.consecutiveBoards),
  );
  const explicitWindowDays = finiteNumber(
    speculation.boardWindowDays
      ?? (stock && stock.boardWindowDays)
      ?? (stock && stock.boardStats && stock.boardStats.windowDays),
  );
  const explicitWindowBoards = finiteNumber(
    speculation.boardsInWindow
      ?? (stock && stock.boardsInWindow)
      ?? (stock && stock.boardStats && stock.boardStats.boardsInWindow),
  );
  const legacyBoards = finiteNumber(speculation.boards);
  const label = String(
    stock && (stock.popularity || stock.highDays)
      || speculation.boardLabel
      || "",
  ).trim();
  const failed = /炸板|地板/.test(label);
  let consecutiveBoards = explicitConsecutive;
  let windowDays = explicitWindowDays;
  let boardsInWindow = explicitWindowBoards;
  let source = explicitConsecutive != null || explicitWindowBoards != null ? "explicit" : "missing";

  if (!failed) {
    const consecutiveMatch = label.match(/(\d+)\s*连板/);
    const windowMatch = label.match(/(\d+)\s*天\s*(\d+)\s*板/);
    if (consecutiveMatch) {
      consecutiveBoards = clamp(Number(consecutiveMatch[1]), 0, 20);
      boardsInWindow = consecutiveBoards;
      windowDays = consecutiveBoards;
      source = "popularity_consecutive";
    } else if (windowMatch) {
      windowDays = clamp(Number(windowMatch[1]), 0, 30);
      boardsInWindow = clamp(Number(windowMatch[2]), 0, 20);
      // 只有 X天X板 才能从标签证明连续；X天Y板不能冒充 Y 连板。
      if (windowDays === boardsInWindow) consecutiveBoards = boardsInWindow;
      source = "popularity_window";
    } else if (/首板/.test(label)) {
      consecutiveBoards = 1;
      boardsInWindow = 1;
      windowDays = 1;
      source = "popularity_first_board";
    }
  }

  if (failed) {
    consecutiveBoards = 0;
    source = "failed_board";
  } else if (boardsInWindow == null && legacyBoards != null) {
    boardsInWindow = clamp(legacyBoards, 0, 20);
    // 无原始标签时保留旧字段兼容，但明确标记为 legacy，状态机不会把它当高质量连续证据。
    if (!label && consecutiveBoards == null) consecutiveBoards = clamp(legacyBoards, 0, 20);
    source = source === "missing" ? "legacy_boards" : source;
  }

  return {
    label,
    failed,
    consecutiveBoards: consecutiveBoards == null ? null : Math.round(consecutiveBoards),
    boardsInWindow: boardsInWindow == null ? null : Math.round(boardsInWindow),
    windowDays: windowDays == null ? null : Math.round(windowDays),
    source,
    exactConsecutive: source === "explicit" || source === "popularity_consecutive" || (
      source === "popularity_window" && consecutiveBoards != null
    ),
  };
}

function popularityProfile(stock) {
  const eastRank = finiteNumber(stock && stock.eastRank);
  const thsRank = finiteNumber(stock && stock.thsRank);
  const platformRanks = [eastRank, thsRank]
    .filter((value) => value != null && value > 0 && value <= 100);
  const combinedRank = finiteNumber(stock && stock.combinedRank);
  const rankCandidates = platformRanks.length
    ? platformRanks
    : combinedRank != null && combinedRank > 0 && combinedRank <= 100
      ? [combinedRank]
      : [];
  const bestRank = rankCandidates.length ? Math.min(...rankCandidates) : null;
  const averageRank = rankCandidates.length
    ? rankCandidates.reduce((sum, value) => sum + value, 0) / rankCandidates.length
    : null;
  // 只有两个平台的数值名次都存在时，才认定“跨平台共识”。
  // inBothSources 只是声明字段，不能替代原始名次。
  const dualSource = platformRanks.length >= 2;
  let score = 0;
  if (averageRank != null) {
    if (dualSource && averageRank <= 5) score = 35;
    else if (dualSource && averageRank <= 10) score = 31;
    else if (dualSource && averageRank <= 20) score = 26;
    else if (dualSource && averageRank <= 30) score = 21;
    else if (dualSource && averageRank <= 50) score = 15;
    else if (dualSource && averageRank <= 75) score = 9;
    else if (dualSource && averageRank <= 100) score = 5;
    else if (bestRank <= 3) score = 25;
    else if (bestRank <= 5) score = 23;
    else if (bestRank <= 10) score = 20;
    else if (bestRank <= 20) score = 16;
    else if (bestRank <= 30) score = 12;
    else if (bestRank <= 50) score = 8;
    else if (bestRank <= 75) score = 5;
    else if (bestRank <= 100) score = 3;
  }
  return {
    eastRank,
    thsRank,
    combinedRank,
    bestRank,
    averageRank: averageRank == null ? null : round(averageRank),
    dualSource,
    declaredDualSource: stock && stock.inBothSources === true,
    sourceCount: platformRanks.length || (rankCandidates.length ? 1 : 0),
    withinTop100: rankCandidates.length > 0,
    score,
    top10: bestRank != null && bestRank <= 10,
    top20Consensus: dualSource && averageRank != null && averageRank <= 20,
    top30: bestRank != null && bestRank <= 30,
  };
}

function isCurrentLimit(stock, board) {
  const { initiative, session, trustedSession } = initiativeView(stock);
  if (trustedSession && session.closedAtLimit === true) return true;
  const change = currentChange(stock);
  const label = String(stock && stock.popularity || "");
  if (board.failed) return false;
  if (/首板|连板|\d+\s*天\s*\d+\s*板/.test(label) && change != null && change >= 8) return true;
  if (initiative.closedAtLimit === true) return true;
  return false;
}

function isOneWordBoard(stock) {
  return resolvePriceDiscovery(stock).type === "one_word";
}

function historyProfile(stock) {
  const leadership = isObject(stock && stock.leadership) ? stock.leadership : {};
  const history = isObject(leadership.history) ? leadership.history : {};
  return {
    appearances: finiteNumber(history.appearances) ?? 0,
    coreHits: finiteNumber(history.coreHits) ?? 0,
    activeHits: finiteNumber(history.activeHits) ?? 0,
    persistent: leadership.persistentRecognition === true,
    recognized: leadership.recognized === true,
    coreIdentityQualified: leadership.coreIdentityQualified === true,
  };
}

function qualifyPopularCore(stock) {
  const popularity = popularityProfile(stock);
  const history = historyProfile(stock);
  const top10Consensus = Boolean(
    popularity.dualSource
    && popularity.averageRank != null
    && popularity.averageRank <= 10
  );
  const crossDayPersistent = history.persistent && history.appearances >= 2;
  const historicalCoreImpact = history.coreHits >= 1;
  return {
    qualified: top10Consensus && crossDayPersistent && historicalCoreImpact,
    top10Consensus,
    crossDayPersistent,
    historicalCoreImpact,
    eastRank: popularity.eastRank,
    thsRank: popularity.thsRank,
    averageRank: popularity.averageRank,
    appearances: history.appearances,
    coreHits: history.coreHits,
    evidence: [
      top10Consensus
        ? `东财${popularity.eastRank}/同花顺${popularity.thsRank}双榜Top10共识`
        : "未满足双榜Top10数值共识",
      crossDayPersistent
        ? `跨日持续辨识度已确认，出现${history.appearances}次`
        : "缺少persistent+至少2次的跨日持续证据",
      historicalCoreImpact
        ? `历史核心影响命中${history.coreHits}次`
        : "历史coreHits为0",
    ],
  };
}

function heatScore(stock, profiles) {
  const { board, popularity, history, roles, currentLimit, marketContext } = profiles;
  const change = currentChange(stock);
  const { leadership, initiative } = initiativeView(stock);
  const evidence = [];
  const components = {};

  components.popularity = {
    score: popularity.score,
    max: SCORE_STANDARD.componentMaximums.popularity,
    crossPlatform: popularity.dualSource,
    eastRank: popularity.eastRank,
    thsRank: popularity.thsRank,
    bestRank: popularity.bestRank,
    averageRank: popularity.averageRank,
    withinTop100: popularity.withinTop100,
    detail: popularity.dualSource
      ? `东财Top100第${popularity.eastRank}、同花顺Top100第${popularity.thsRank}`
      : popularity.bestRank != null
        ? `单平台Top100第${popularity.bestRank}`
        : "缺少Top100数值名次",
  };
  if (popularity.score) evidence.push(`${components.popularity.detail}，人气贡献${popularity.score}/35分`);

  const consecutive = board.consecutiveBoards ?? 0;
  const windowBoards = board.boardsInWindow ?? 0;
  let heightBaseScore = 0;
  if (consecutive >= 6) heightBaseScore = 21;
  else if (consecutive >= 5) heightBaseScore = 20;
  else if (consecutive >= 4) heightBaseScore = 18;
  else if (consecutive >= 3) heightBaseScore = 16;
  else if (consecutive === 2) heightBaseScore = 15;
  else if (consecutive === 1) heightBaseScore = 6;
  else if (windowBoards >= 8) heightBaseScore = 17;
  else if (windowBoards >= 5) heightBaseScore = 14;
  else if (windowBoards >= 3) heightBaseScore = 10;
  else if (windowBoards >= 2) heightBaseScore = 7;
  const highestConsecutive = finiteNumber(marketContext && marketContext.highestConsecutiveBoards) ?? 0;
  const marketLeader = Boolean(board.exactConsecutive && consecutive >= 2 && consecutive === highestConsecutive);
  const marketLeaderBonus = marketLeader ? 4 : 0;
  const heightScore = Math.min(SCORE_STANDARD.componentMaximums.height, heightBaseScore + marketLeaderBonus);
  components.height = {
    score: heightScore,
    max: SCORE_STANDARD.componentMaximums.height,
    baseScore: heightBaseScore,
    marketLeaderBonus,
    marketLeader,
    consecutiveBoards: board.consecutiveBoards,
    boardsInWindow: board.boardsInWindow,
    exactConsecutive: board.exactConsecutive,
    detail: marketLeader
      ? `${board.label || `${consecutive}连板`}，且为当前样本最高连板`
      : board.label || "无可验证连板高度",
  };
  if (heightScore) evidence.push(`${components.height.detail}，高度贡献${heightScore}/25分`);

  const appearanceScore = Math.min(6, history.appearances * 2);
  const persistentScore = history.persistent ? 6 : 0;
  const coreHitScore = Math.min(3, history.coreHits * 3);
  const recognitionScore = Math.min(
    SCORE_STANDARD.componentMaximums.recognition,
    appearanceScore + persistentScore + coreHitScore,
  );
  components.recognition = {
    score: recognitionScore,
    max: SCORE_STANDARD.componentMaximums.recognition,
    appearances: history.appearances,
    coreHits: history.coreHits,
    persistent: history.persistent,
    detail: `跨日出现${history.appearances}次、核心命中${history.coreHits}次${history.persistent ? "、持续辨识度已确认" : ""}`,
  };
  if (recognitionScore) evidence.push(`${components.recognition.detail}，辨识度贡献${recognitionScore}/15分`);

  const rawRole = String(stock && stock.role || "");
  const popularCore = qualifyPopularCore(stock);
  const leaderRole = verifiedCycleLeaderRole(stock, roles);
  const pioneerRole = roles.includes("pioneer")
    || stock && stock.roleKind === "dailyPioneer" && stock.roleScope === "session";
  const capacityRole = roles.includes("capacity")
    || stock && stock.roleKind === "capacityCore" && stock.roleScope === "rolling";
  let roleInfluenceScore = leaderRole ? 8 : popularCore.qualified ? 8 : pioneerRole ? 6 : capacityRole ? 5 : 0;
  if (history.coreIdentityQualified) roleInfluenceScore += 4;
  if (history.recognized) roleInfluenceScore += 3;
  const followerCount = finiteNumber(initiative.followerCount) ?? 0;
  if (followerCount >= 2) roleInfluenceScore += 3;
  const leadershipImpact = finiteNumber(leadership.impactScore);
  if (leadershipImpact != null && leadershipImpact >= 65) roleInfluenceScore += 3;
  else if (leadershipImpact != null && leadershipImpact >= 50) roleInfluenceScore += 1;
  roleInfluenceScore = Math.min(SCORE_STANDARD.componentMaximums.roleInfluence, roleInfluenceScore);
  components.roleInfluence = {
    score: roleInfluenceScore,
    max: SCORE_STANDARD.componentMaximums.roleInfluence,
    role: leaderRole ? "leader" : popularCore.qualified ? "popular_core" : pioneerRole ? "pioneer" : capacityRole ? "capacity" : "breadth",
    popularCore: popularCore.qualified,
    recognized: history.recognized,
    coreIdentityQualified: history.coreIdentityQualified,
    followerCount,
    leadershipImpactScore: leadershipImpact,
    detail: leaderRole
      ? "龙头/方向主锚身份"
      : popularCore.qualified
        ? "双榜Top10+跨日持续+历史核心影响的人气核心"
      : pioneerRole
        ? "启动先锋身份"
        : capacityRole
          ? "容量中军身份"
          : "未验证主锚角色",
  };
  if (roleInfluenceScore) evidence.push(`${components.roleInfluence.detail}，角色影响贡献${roleInfluenceScore}/15分`);

  let currentScore = 0;
  if (currentLimit) currentScore = 10;
  else if (change != null && change >= 7) currentScore = 8;
  else if (change != null && change >= 3) currentScore = 5;
  else if (change != null && change > 0) currentScore = 2;
  components.currentStrength = {
    score: currentScore,
    max: SCORE_STANDARD.componentMaximums.currentStrength,
    changePct: change,
    limitUp: currentLimit,
    detail: currentLimit ? "当日封板" : change == null ? "当日强度未知" : `当日涨跌${round(change)}%`,
  };
  if (currentScore) evidence.push(`${components.currentStrength.detail}，当日强度贡献${currentScore}/10分`);

  const score = Object.values(components).reduce((sum, component) => sum + component.score, 0);
  return {
    score: clamp(Math.round(score), SCORE_STANDARD.min, SCORE_STANDARD.max),
    evidence,
    breakdown: components,
    scoreStandard: SCORE_STANDARD.key,
    evidenceCountAffectsScore: false,
  };
}

function profitEffectProfile(stock, profiles, priceDiscovery) {
  if (!priceDiscovery || priceDiscovery.type === "unknown") {
    return {
      score: null,
      dataQuality: priceDiscovery ? priceDiscovery.dataQuality : "missing",
      priceDiscoveryType: "unknown",
      priceDiscoveryLabel: "价格发现待验证",
      source: priceDiscovery ? priceDiscovery.source : "missing",
      eligible: false,
      breakdown: {},
      evidence: priceDiscovery ? priceDiscovery.evidence : ["缺少价格发现证据"],
    };
  }

  const { board, popularity } = profiles;
  const session = isObject(priceDiscovery.session) ? priceDiscovery.session : {};
  const components = {};
  const evidence = [...priceDiscovery.evidence];

  const popularityScore = Math.round((popularity.score / 35) * 25);
  components.popularity = {
    score: clamp(popularityScore, 0, 25),
    max: 25,
    eastRank: popularity.eastRank,
    thsRank: popularity.thsRank,
    crossPlatform: popularity.dualSource,
  };

  const consecutive = board.consecutiveBoards ?? 0;
  const windowBoards = board.boardsInWindow ?? 0;
  let continuityScore = 0;
  if (board.exactConsecutive && consecutive >= 5) continuityScore = 15;
  else if (board.exactConsecutive && consecutive >= 3) continuityScore = 13;
  else if (board.exactConsecutive && consecutive === 2) continuityScore = 10;
  else if (board.exactConsecutive && consecutive === 1) continuityScore = 5;
  else if (windowBoards >= 5) continuityScore = 9;
  else if (windowBoards >= 2) continuityScore = 6;
  components.continuity = {
    score: continuityScore,
    max: 15,
    consecutiveBoards: board.consecutiveBoards,
    boardsInWindow: board.boardsInWindow,
    exactConsecutive: board.exactConsecutive,
  };

  const discoveryScores = {
    turnover_reseal: 45,
    turnover_limit: 38,
    active_price_discovery: 22,
    one_word: 0,
  };
  const discoveryScore = discoveryScores[priceDiscovery.type] ?? 0;
  components.priceDiscovery = {
    score: discoveryScore,
    max: 45,
    type: priceDiscovery.type,
    label: priceDiscovery.label,
    source: priceDiscovery.source,
    trusted: priceDiscovery.trusted,
  };

  const sessionChange = finiteNumber(session.currentChangePct);
  let outcomeScore = 0;
  if (priceDiscovery.type !== "one_word") {
    if (priceDiscovery.closedAtLimit) outcomeScore = 15;
    else if (sessionChange != null && sessionChange >= 7) outcomeScore = 11;
    else if (sessionChange != null && sessionChange >= 3) outcomeScore = 7;
    else if (sessionChange != null && sessionChange > 0) outcomeScore = 3;
  }
  components.outcome = {
    score: outcomeScore,
    max: 15,
    closedAtLimit: priceDiscovery.closedAtLimit,
    changePct: sessionChange,
  };

  const score = clamp(
    Math.round(Object.values(components).reduce((sum, component) => sum + component.score, 0)),
    0,
    100,
  );
  evidence.push(`赚钱效应分=人气${components.popularity.score}+连续性${continuityScore}+价格发现${discoveryScore}+结果${outcomeScore}`);
  return {
    score,
    dataQuality: priceDiscovery.dataQuality,
    priceDiscoveryType: priceDiscovery.type,
    priceDiscoveryLabel: priceDiscovery.label,
    source: priceDiscovery.source,
    eligible: true,
    breakdown: components,
    evidence,
  };
}

function supportScore(stock, oneWord, priceDiscovery) {
  const { initiative, session: currentSession, trustedSession: currentTrustedSession } = initiativeView(stock);
  const resolvedSession = priceDiscovery && isObject(priceDiscovery.session) ? priceDiscovery.session : null;
  const session = resolvedSession || currentSession;
  const trustedSession = Boolean(priceDiscovery && priceDiscovery.trusted && resolvedSession) || currentTrustedSession;
  if (oneWord) {
    return {
      score: null,
      status: "unknown",
      evidence: ["一字或无价格发现，只计热度，承接保持unknown"],
      breakdown: {
        priceDiscovery: { eligible: false, status: "no_price_discovery", detail: "一字或无价格发现" },
        turnoverReseal: { score: null, max: 45, verified: false, detail: "无换手样本，不计回封承接" },
      },
    };
  }
  if (!trustedSession) {
    return {
      score: null,
      status: "unknown",
      evidence: ["缺少可信分时，不能用收盘涨幅冒充承接"],
      breakdown: {
        priceDiscovery: { eligible: false, status: "session_unverified", detail: "缺少可信分时" },
        turnoverReseal: { score: null, max: 45, verified: false, detail: "未验证换手破板与回封" },
      },
    };
  }

  const current = finiteNumber(session.currentChangePct) ?? currentChange(stock);
  const open = finiteNumber(session.openChangePct);
  const maximum = finiteNumber(session.maxChangePct);
  const minimum = finiteNumber(session.minChangePct);
  const fade = maximum != null && current != null ? maximum - current : null;
  const recovery = current != null && minimum != null ? current - minimum : null;
  const retention = finiteNumber(session.retentionPct) ?? finiteNumber(initiative.retentionPct);
  const proactive = session.proactive === true || initiative.proactive === true;
  const closingPathProxy = priceDiscovery && priceDiscovery.sessionGranularity === "closing_path_proxy";
  const evidence = [];
  let score = 0;
  const breakdown = {
    priceDiscovery: {
      eligible: true,
      status: priceDiscovery && priceDiscovery.source || "verified_intraday",
      detail: closingPathProxy
        ? "已验证当日收盘OHLC路径代理，只评估价格范围与收盘承接"
        : priceDiscovery && priceDiscovery.source === "verified_completed_last_session"
          ? "已验证上一完成交易日分时，允许评估收盘承接"
          : "可信分时已验证，允许评估承接",
    },
    turnoverReseal: { score: 0, max: 45, verified: false, detail: "未发生可验证的换手破板回封" },
    closingSeal: { score: 0, max: 25 },
    retention: { score: 0, max: 20, valuePct: retention },
    recovery: { score: 0, max: 10, valuePct: recovery == null ? null : round(recovery) },
    fadeControl: { score: 0, min: -8, max: 10, valuePct: fade == null ? null : round(fade) },
    closingStrength: { score: 0, max: 10, changePct: current },
    initiative: { score: 0, max: 8, proactive },
    openToClose: { score: 0, max: 7, changePct: open != null && current != null ? round(current - open) : null },
  };

  if (priceDiscovery && priceDiscovery.resealed === true && priceDiscovery.closedAtLimit === true) {
    score += 45;
    breakdown.turnoverReseal = {
      score: 45,
      max: 45,
      verified: true,
      detail: "换手破板后完成真实回封",
    };
    evidence.push("换手破板后完成真实回封，承接贡献45分");
  } else if (priceDiscovery && priceDiscovery.closedAtLimit === true) {
    score += 25;
    breakdown.closingSeal.score = 25;
    evidence.push("收盘封板但未发生可验证回封");
  }
  if (retention != null) {
    const contribution = retention >= 85 ? 20 : retention >= 70 ? 14 : retention >= 50 ? 8 : 2;
    score += contribution;
    breakdown.retention.score = contribution;
    evidence.push(`强度保留${round(retention)}%`);
  }
  if (recovery != null && recovery >= 3) {
    score += 10;
    breakdown.recovery.score = 10;
    evidence.push(`低点修复${round(recovery)}%`);
  }
  if (fade != null && fade <= 2) {
    score += 10;
    breakdown.fadeControl.score = 10;
  } else if (fade != null && fade >= 5) {
    score -= 8;
    breakdown.fadeControl.score = -8;
  }
  if (current != null && current >= 5) {
    score += 10;
    breakdown.closingStrength.score = 10;
  } else if (current != null && current >= 2) {
    score += 5;
    breakdown.closingStrength.score = 5;
  }
  if (proactive) {
    score += 8;
    breakdown.initiative.score = 8;
  }
  if (open != null && current != null && current - open >= 2) {
    score += 7;
    breakdown.openToClose.score = 7;
  }

  const normalized = clamp(Math.round(score), 0, 100);
  return {
    score: normalized,
    status: normalized >= 65 ? "strong" : normalized >= 40 ? "mixed" : "weak",
    evidence,
    rawScore: score,
    breakdown,
  };
}

function damageScore(stock, oneWord, priceDiscovery) {
  if (oneWord) {
    return {
      score: null,
      status: "unknown",
      evidence: ["一字或无价格发现，只计热度，不参与伤害聚合"],
      breakdown: { priceDiscovery: { eligible: false, status: "no_price_discovery" } },
    };
  }
  const currentView = initiativeView(stock);
  const leadership = currentView.leadership;
  const resolvedSession = priceDiscovery && isObject(priceDiscovery.session) ? priceDiscovery.session : null;
  const session = resolvedSession || currentView.session;
  const trustedSession = Boolean(priceDiscovery && priceDiscovery.trusted && resolvedSession) || currentView.trustedSession;
  const structure = isObject(leadership.structure) ? leadership.structure : {};
  const profile = isObject(stock && stock.klineProfile) ? stock.klineProfile : {};
  const current = trustedSession
    ? finiteNumber(session && session.currentChangePct) ?? currentChange(stock)
    : currentChange(stock);
  if (current == null && !trustedSession) {
    return { score: null, status: "unknown", evidence: ["收盘与分时反馈均缺失"] };
  }
  const open = finiteNumber(session && session.openChangePct);
  const maximum = finiteNumber(session && session.maxChangePct);
  const fade = maximum != null && current != null ? maximum - current : null;
  const pullback = finiteNumber(session && session.postTouchMaxPullbackPct);
  const evidence = [];
  let score = 0;

  if (current != null && current <= -7) score += 75;
  else if (current != null && current <= -5) score += 60;
  else if (current != null && current <= -2) score += 35;
  else if (current != null && current < 0) score += 15;
  if (current != null && current <= -2) evidence.push(`收盘负反馈${round(current)}%`);

  if (trustedSession && fade != null) {
    if (fade >= 8) score += 55;
    else if (fade >= 6) score += 40;
    else if (fade >= 3) score += 18;
    if (fade >= 3) evidence.push(`较日内高点回落${round(fade)}%`);
  }
  if (
    trustedSession
    && session.limitTouched === true
    && session.closedAtLimit !== true
    && (pullback == null || pullback >= 3)
  ) {
    score += 35;
    evidence.push("触板后未回封");
  }
  if (pullback != null && pullback >= 5) score += 15;
  if (open != null && current != null && open - current >= 3) score += 15;
  if ((structure.breakdown === true || profile.structureBreak === true) && current != null && current <= 0) {
    score += 20;
    evidence.push("结构破坏与价格负反馈同时出现");
  }

  const normalized = clamp(Math.round(score), 0, 100);
  return {
    score: normalized,
    status: normalized >= 65 ? "harmful" : normalized >= 35 ? "realization" : "contained",
    evidence,
  };
}

function participationProfile(stock, priceDiscovery, support, damage) {
  const session = priceDiscovery && isObject(priceDiscovery.session) ? priceDiscovery.session : {};
  const oneWord = Boolean(priceDiscovery && priceDiscovery.oneWord);
  const trusted = Boolean(priceDiscovery && priceDiscovery.trusted && priceDiscovery.type !== "unknown");
  const current = finiteNumber(session.currentChangePct) ?? currentChange(stock);
  const open = finiteNumber(session.openChangePct);
  const maximum = finiteNumber(session.maxChangePct);
  const minimum = finiteNumber(session.minChangePct);
  const fade = maximum != null && current != null ? maximum - current : null;
  const recovery = current != null && minimum != null ? current - minimum : null;
  const intradayRange = maximum != null && minimum != null ? maximum - minimum : null;
  const limitOpenCount = finiteNumber(priceDiscovery && priceDiscovery.limitOpenCount);
  const openedLimit = priceDiscovery && priceDiscovery.openedLimit === true;
  const resealed = priceDiscovery && priceDiscovery.resealed === true;
  const closedAtLimit = priceDiscovery && priceDiscovery.closedAtLimit === true;
  const limitFailed = priceDiscovery && priceDiscovery.limitFailed === true;
  const marketEmotionEligible = trusted && !oneWord;
  const divergence = Boolean(marketEmotionEligible && (
    openedLimit
    || limitFailed
    || (fade != null && fade >= 3)
    || (intradayRange != null && intradayRange >= 6)
  ));
  const supportScoreValue = finiteNumber(support && support.score);
  const damageScoreValue = finiteNumber(damage && damage.score);
  const supportIntact = Boolean(marketEmotionEligible && divergence && (
    resealed
    || closedAtLimit
    || (supportScoreValue != null && supportScoreValue >= 40)
  ));
  const localRepair = Boolean(marketEmotionEligible
    && recovery != null
    && recovery >= 8
    && current != null
    && current >= 5
    && (resealed || closedAtLimit || (supportScoreValue != null && supportScoreValue >= 40)));
  const repairFailed = Boolean(marketEmotionEligible
    && divergence
    && !supportIntact
    && (limitFailed || (damageScoreValue != null && damageScoreValue >= 35)));
  const individualState = localRepair
    ? "local_repair"
    : repairFailed
      ? "repair_failed"
      : divergence && supportIntact
        ? "divergence_supported"
        : divergence
          ? "divergence"
          : marketEmotionEligible
            ? "participating"
            : oneWord
              ? "height_consensus_only"
              : "unknown";
  return {
    marketEmotionEligible,
    climaxEligible: marketEmotionEligible,
    heightConsensusEligible: oneWord,
    individualState,
    divergence,
    supportIntact,
    localRepair,
    repairFailed,
    facts: {
      trusted,
      priceDiscoveryType: priceDiscovery && priceDiscovery.type || "unknown",
      sessionGranularity: priceDiscovery && priceDiscovery.sessionGranularity || "untrusted",
      eventEvidenceEligible: priceDiscovery && priceDiscovery.eventEvidenceEligible === true,
      openedLimit,
      limitOpenCount,
      resealed,
      closedAtLimit,
      limitFailed,
      fadePct: fade == null ? null : round(fade),
      recoveryPct: recovery == null ? null : round(recovery),
      intradayRangePct: intradayRange == null ? null : round(intradayRange),
      supportScore: supportScoreValue,
      damageScore: damageScoreValue,
    },
    reason: oneWord
      ? "全天锁死只计高度一致度，不计可参与情绪"
      : marketEmotionEligible
        ? "存在可交易的真实价格发现"
        : "缺少可信价格发现，不参与情绪阶段聚合",
  };
}

function directionOf(stock) {
  return String(stock && (
    stock.canonicalThemeFamily
    || stock.mainFamily
    || stock.mainConcept
    || stock.concept
    || stock.direction
  ) || "").trim() || "未归类";
}

function deriveLayerAndRole(stock, profiles) {
  const { board, popularity, history, roles, currentLimit } = profiles;
  const { initiative } = initiativeView(stock);
  const change = currentChange(stock);
  const amountYi = finiteNumber(stock && stock.amountYi);
  const impact = finiteNumber(profiles.identity.impactScore ?? profiles.identity.leadershipImpactScore)
    ?? finiteNumber(profiles.leadershipImpactScore);
  const initiativeScore = finiteNumber(initiative.score ?? (stock && stock.initiativeScore));
  const capacity = initiative.capacity === true || roles.includes("capacity") || /中军|容量/.test(String(stock && stock.role || ""));
  const rawRole = String(stock && stock.role || "");
  const height = (board.consecutiveBoards ?? 0) >= 2 || (board.boardsInWindow ?? 0) >= 4;
  const attention = popularity.top20Consensus || popularity.top10 || (
    popularity.dualSource && popularity.averageRank != null && popularity.averageRank <= 30
  );
  const continuity = history.persistent && history.appearances >= 2;
  const influence = history.coreIdentityQualified
    || (finiteNumber(initiative.followerCount) ?? 0) >= 2
    || history.coreHits >= 1;
  const independentSignals = [height, attention, continuity, influence].filter(Boolean).length;
  const highHeight = (board.consecutiveBoards ?? 0) >= 3 || (board.boardsInWindow ?? 0) >= 4;
  const leaderLike = verifiedCycleLeaderRole(stock, roles)
    || roles.includes("pioneer")
    || stock && stock.roleKind === "dailyPioneer" && stock.roleScope === "session";
  const liquidity = (amountYi != null && amountYi >= 20) || (impact != null && impact >= 65);
  const proactiveCapacity = capacity
    && liquidity
    && initiative.proactive === true
    && initiativeScore != null
    && initiativeScore >= 65;
  const popularCore = qualifyPopularCore(stock);
  // 容量属性本身不得把人气核心压回C层；只有已达到B层门槛的主动容量核心才保持B层职责。
  const popularCoreEligible = popularCore.qualified && !proactiveCapacity;
  const emotionRoleEligible = highHeight || (leaderLike && !capacity) || popularCoreEligible;
  // 盘前 price=null/changePct=0 不能把上一完整交易日的确切二连板抹成“不活跃”。
  // 必须是可验证连板 + Top100关注 + 角色/跨日辨识度交叉，不允许单字段晋级。
  const structuralContinuity = Boolean(
    board.exactConsecutive
    && (board.consecutiveBoards ?? 0) >= 2
    && attention
    && (continuity || influence || leaderLike)
  );
  const active = currentLimit || (change != null && change >= 3) || structuralContinuity || (
    popularCoreEligible
  ) || (
    profiles.support.score != null && profiles.support.score >= 55
  ) || (
    profiles.damage && profiles.damage.score != null && profiles.damage.score >= 35
  );
  // verified 题材角色只决定角色语义，绝不单独成为 A 层通行证。
  const layerA = Boolean(active && emotionRoleEligible && independentSignals >= 2 && (
    (height && (attention || continuity || influence))
    || (attention && (continuity || influence))
    || (history.coreIdentityQualified && (height || attention || continuity))
  ));
  const layer = layerA ? "A" : proactiveCapacity ? "B" : "C";

  let roleKey = "breadth";
  if ((board.consecutiveBoards ?? 0) >= 3 || (board.boardsInWindow ?? 0) >= 4) roleKey = "height";
  else if (layer === "B" || (capacity && !popularCoreEligible)) roleKey = "capacity";
  else if (verifiedCycleLeaderRole(stock, roles)) roleKey = "leader";
  else if (popularCoreEligible) roleKey = "popular_core";
  else if (roles.includes("pioneer") || currentLimit || (board.consecutiveBoards ?? 0) >= 1) roleKey = "pioneer";

  return {
    layer,
    roleKey,
    active,
    signals: {
      height,
      attention,
      continuity,
      influence,
      emotionRoleEligible,
      structuralContinuity,
      popularCore: popularCore.qualified,
      popularCoreEvidence: popularCore.evidence,
      verifiedThemeRole: roles.length > 0,
      proactiveCapacity,
      independentSignalCount: independentSignals,
    },
  };
}

function anchorScore(heat) {
  // 锚的市场影响评分不应被“今日回落”消灭：龙头负反馈仍然可能对全市有高影响。
  // H影响力总分与C承接/D伤害是三条独立轴，全部股票使用同一H百分制。
  return clamp(Math.round(heat.score), SCORE_STANDARD.min, SCORE_STANDARD.max);
}

function buildAnchor(stock, index, excludedCandidateCodes, marketContext) {
  const board = parseBoardProfile(stock);
  const popularity = popularityProfile(stock);
  const history = historyProfile(stock);
  const roles = verifiedThemeRoles(stock);
  const currentLimit = isCurrentLimit(stock, board);
  const priceDiscovery = resolvePriceDiscovery(
    stock,
    marketContext && marketContext.expectedPreviousTradingDate,
    marketContext && marketContext.currentTradingDate,
  );
  const oneWord = priceDiscovery.type === "one_word";
  const identity = isObject(stock && stock.emotionIdentity) ? stock.emotionIdentity : {};
  const provisional = { board, popularity, history, roles, currentLimit, identity, marketContext };
  const heat = heatScore(stock, provisional);
  const support = supportScore(stock, oneWord, priceDiscovery);
  const damage = damageScore(stock, oneWord, priceDiscovery);
  const profitEffect = profitEffectProfile(stock, provisional, priceDiscovery);
  const participation = participationProfile(stock, priceDiscovery, support, damage);
  const layerRole = deriveLayerAndRole(stock, { ...provisional, support, damage });
  const speculation = isObject(stock && stock.speculation) ? stock.speculation : {};
  const expectationText = String(speculation.expectation || "").trim();
  const expectationRisk = /透支/.test(expectationText)
    ? { key: "high", label: "位置预期偏高", source: "speculation_hint_only", usedForStage: false }
    : heat.score >= 85 && ((board.consecutiveBoards ?? 0) >= 4 || oneWord)
      ? { key: "high", label: "热度与高度偏高", source: "anchor_metrics", usedForStage: false }
      : { key: "normal", label: "预期风险正常观察", source: "anchor_metrics", usedForStage: false };
  const id = stockIdentity(stock, index);
  const selectedCandidate = excludedCandidateCodes.has(id) || excludedCandidateCodes.has(stockCode(stock));
  return {
    id,
    code: stockCode(stock),
    name: stockName(stock) || id,
    direction: directionOf(stock),
    layer: layerRole.layer,
    layerLabel: LAYER_LABELS[layerRole.layer],
    anchorRole: layerRole.roleKey,
    anchorRoleLabel: ROLE_LABELS[layerRole.roleKey],
    anchorScore: anchorScore(heat),
    stateScore: anchorScore(heat),
    influenceScore: {
      score: anchorScore(heat),
      scale: { min: SCORE_STANDARD.min, max: SCORE_STANDARD.max },
      standard: SCORE_STANDARD.key,
      label: SCORE_STANDARD.label,
      components: heat.breakdown,
      evidenceCountAffectsScore: false,
    },
    influenceWeightPct: 0,
    influenceWeight: {
      eligible: false,
      raw: 0,
      pct: 0,
      normalizedWithin: "independent_market_samples",
      components: null,
    },
    profitEffectScore: profitEffect.score,
    profitEffectWeightPct: 0,
    priceDiscoveryType: profitEffect.priceDiscoveryType,
    priceDiscovery: {
      type: priceDiscovery.type,
      label: priceDiscovery.label,
      source: priceDiscovery.source,
      dataQuality: priceDiscovery.dataQuality,
      trusted: priceDiscovery.trusted,
      completed: priceDiscovery.completed,
      sessionGranularity: priceDiscovery.sessionGranularity,
      eventEvidenceEligible: priceDiscovery.eventEvidenceEligible,
      evidence: priceDiscovery.evidence,
    },
    profitEffect: {
      ...profitEffect,
      weightPct: 0,
      weightNormalizedWithin: "independent_profit_effect_samples",
    },
    heat,
    support,
    damage,
    participation,
    expectationRisk,
    popularity,
    board,
    current: {
      changePct: currentChange(stock),
      amountYi: finiteNumber(stock && stock.amountYi),
      limitUp: currentLimit,
      oneWord,
    },
    signals: layerRole.signals,
    selectedCandidate,
    excludedFromMarketState: selectedCandidate,
  };
}

function buildMarketContext(items, tradingContext = {}) {
  const profiles = (Array.isArray(items) ? items : [])
    .filter(isObject)
    .map((stock) => parseBoardProfile(stock));
  const exactConsecutive = profiles
    .filter((profile) => profile.exactConsecutive)
    .map((profile) => profile.consecutiveBoards)
    .filter((value) => value != null && value > 0);
  return {
    highestConsecutiveBoards: exactConsecutive.length ? Math.max(...exactConsecutive) : null,
    exactHeightSampleCount: exactConsecutive.length,
    currentTradingDate: normalizedSessionDate(
      tradingContext && (tradingContext.currentTradingDate || tradingContext.tradingDate),
    ) || null,
    expectedPreviousTradingDate: normalizedSessionDate(
      tradingContext && tradingContext.expectedPreviousTradingDate,
    ) || null,
  };
}

function influenceEligibility(anchor) {
  if (anchor.excludedFromMarketState) return false;
  if (anchor.layer === "A" || anchor.layer === "B") return true;
  return Boolean(
    anchor.signals.active
    && (
      anchor.current.limitUp
      || anchor.heat.score >= 50
      || (anchor.support.score != null && anchor.support.score >= 55)
      || (anchor.damage.score != null && anchor.damage.score >= 40)
    )
  );
}

function influenceRawWeight(anchor) {
  const layerBase = anchor.layer === "A" ? 60 : anchor.layer === "B" ? 35 : 10;
  const popularityScore = finiteNumber(anchor.popularity && anchor.popularity.score) ?? 0;
  const crossPlatformRank = anchor.popularity && anchor.popularity.dualSource
    ? popularityScore
    : round(popularityScore * 0.5);
  const spatialStatus = finiteNumber(
    anchor.influenceScore
    && anchor.influenceScore.components
    && anchor.influenceScore.components.height
    && anchor.influenceScore.components.height.score,
  ) ?? 0;
  return {
    raw: round(layerBase + crossPlatformRank + spatialStatus, 2),
    components: {
      layer: { score: layerBase, layer: anchor.layer },
      crossPlatformRank: {
        score: crossPlatformRank,
        crossPlatform: anchor.popularity.dualSource,
        eastRank: anchor.popularity.eastRank,
        thsRank: anchor.popularity.thsRank,
      },
      spatialStatus: {
        score: spatialStatus,
        consecutiveBoards: anchor.board.consecutiveBoards,
        marketLeader: Boolean(
          anchor.influenceScore
          && anchor.influenceScore.components
          && anchor.influenceScore.components.height
          && anchor.influenceScore.components.height.marketLeader
        ),
      },
    },
  };
}

function normalizeInfluenceWeights(anchors) {
  const rows = anchors.map((anchor) => {
    const eligible = influenceEligibility(anchor);
    const weight = eligible ? influenceRawWeight(anchor) : { raw: 0, components: null };
    return { anchor, eligible, ...weight };
  });
  const totalRaw = rows.reduce((sum, row) => sum + row.raw, 0);
  const eligibleRows = rows.filter((row) => row.eligible && row.raw > 0);
  let allocatedTenths = 0;
  const weighted = rows.map((row) => {
    if (!row.eligible || row.raw <= 0 || totalRaw <= 0) {
      return {
        ...row.anchor,
        influenceWeightPct: 0,
        influenceWeight: {
          eligible: false,
          raw: 0,
          pct: 0,
          normalizedWithin: "independent_market_samples",
          components: row.components,
          evidenceCountAffectsWeight: false,
        },
      };
    }
    const exactTenths = row.raw / totalRaw * 1000;
    const floorTenths = Math.floor(exactTenths);
    allocatedTenths += floorTenths;
    return {
      ...row.anchor,
      __weightRemainder: exactTenths - floorTenths,
      __weightTenths: floorTenths,
      influenceWeight: {
        eligible: true,
        raw: row.raw,
        pct: 0,
        normalizedWithin: "independent_market_samples",
        components: row.components,
        evidenceCountAffectsWeight: false,
      },
    };
  });

  let remainingTenths = eligibleRows.length ? 1000 - allocatedTenths : 0;
  const remainderOrder = weighted
    .map((row, index) => ({ index, remainder: row.__weightRemainder ?? -1, id: row.id }))
    .filter((row) => row.remainder >= 0)
    .sort((left, right) => right.remainder - left.remainder || (left.id < right.id ? -1 : 1));
  for (let index = 0; index < remainingTenths && remainderOrder.length; index += 1) {
    weighted[remainderOrder[index % remainderOrder.length].index].__weightTenths += 1;
  }

  return weighted.map((row) => {
    if (row.__weightTenths == null) return row;
    const pct = row.__weightTenths / 10;
    const { __weightRemainder, __weightTenths, ...clean } = row;
    return {
      ...clean,
      influenceWeightPct: pct,
      influenceWeight: { ...clean.influenceWeight, pct },
    };
  });
}

function normalizeProfitEffectWeights(anchors) {
  const rows = anchors.map((anchor) => {
    const score = finiteNumber(anchor.profitEffectScore);
    const layerFactor = anchor.layer === "A" ? 1 : anchor.layer === "B" ? 0.8 : 0.5;
    const eligible = influenceEligibility(anchor)
      && anchor.profitEffect
      && anchor.profitEffect.eligible === true
      && score != null
      && score > 0;
    return {
      anchor,
      eligible,
      raw: eligible ? round(score * layerFactor, 2) : 0,
      layerFactor,
    };
  });
  const totalRaw = rows.reduce((sum, row) => sum + row.raw, 0);
  let allocatedTenths = 0;
  const weighted = rows.map((row) => {
    if (!row.eligible || totalRaw <= 0) {
      return {
        ...row.anchor,
        profitEffectWeightPct: 0,
        profitEffect: {
          ...row.anchor.profitEffect,
          eligible: false,
          weightRaw: 0,
          weightPct: 0,
          layerFactor: row.layerFactor,
          weightNormalizedWithin: "independent_profit_effect_samples",
        },
      };
    }
    const exactTenths = row.raw / totalRaw * 1000;
    const floorTenths = Math.floor(exactTenths);
    allocatedTenths += floorTenths;
    return {
      ...row.anchor,
      __profitRemainder: exactTenths - floorTenths,
      __profitTenths: floorTenths,
      profitEffect: {
        ...row.anchor.profitEffect,
        weightRaw: row.raw,
        weightPct: 0,
        layerFactor: row.layerFactor,
        weightNormalizedWithin: "independent_profit_effect_samples",
      },
    };
  });
  const remainderOrder = weighted
    .map((row, index) => ({ index, remainder: row.__profitRemainder ?? -1, id: row.id }))
    .filter((row) => row.remainder >= 0)
    .sort((left, right) => right.remainder - left.remainder || (left.id < right.id ? -1 : 1));
  const remainingTenths = remainderOrder.length ? 1000 - allocatedTenths : 0;
  for (let index = 0; index < remainingTenths && remainderOrder.length; index += 1) {
    weighted[remainderOrder[index % remainderOrder.length].index].__profitTenths += 1;
  }
  return weighted.map((row) => {
    if (row.__profitTenths == null) return row;
    const pct = row.__profitTenths / 10;
    const { __profitRemainder, __profitTenths, ...clean } = row;
    return {
      ...clean,
      profitEffectWeightPct: pct,
      profitEffect: { ...clean.profitEffect, weightPct: pct },
    };
  });
}

function layerRank(layer) {
  return layer === "A" ? 0 : layer === "B" ? 1 : 2;
}

function compareAnchors(left, right) {
  const layerDiff = layerRank(left.layer) - layerRank(right.layer);
  if (layerDiff) return layerDiff;
  if (right.anchorScore !== left.anchorScore) return right.anchorScore - left.anchorScore;
  if (right.heat.score !== left.heat.score) return right.heat.score - left.heat.score;
  const leftRank = left.popularity.bestRank == null ? Number.POSITIVE_INFINITY : left.popularity.bestRank;
  const rightRank = right.popularity.bestRank == null ? Number.POSITIVE_INFINITY : right.popularity.bestRank;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function normalizeState(value) {
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(EMOTION_STATE_LABELS, text)) return text;
  if (/高潮|climax/.test(text)) return "climax";
  if (/加速|acceleration/.test(text)) return "acceleration";
  if (/兑现|realization|divergence/.test(text)) return "realization";
  if (/承接|support|repair/.test(text)) return "support";
  if (/非良性|负反馈|harmful|negative/.test(text)) return "harmful";
  if (/退潮|retreat/.test(text)) return "retreat";
  return "unknown";
}

function legacyPreviousState(previousPayload) {
  const decision = isObject(previousPayload && previousPayload.tomorrowDecision)
    ? previousPayload.tomorrowDecision
    : {};
  const coreEmotion = isObject(decision.coreEmotion) ? decision.coreEmotion : {};
  const items = Array.isArray(coreEmotion.items) ? coreEmotion.items : [];
  const mapped = items.map((item) => {
    const stage = String(item && (item.stage || item.sentimentStage) || "");
    if (stage === "acceleration" || stage === "weak_to_strong") return "acceleration";
    if (stage === "divergence") return "realization";
    if (stage === "supported" || stage === "consensus_resume") return "support";
    if (stage === "negative_feedback") return "harmful";
    if (stage === "weak") return "retreat";
    // expectation_overdrawn 的旧来源可能只是 speculation 字符串，禁止拿它建立跨日状态。
    return "unknown";
  }).filter((key) => key !== "unknown");
  if (!mapped.length) return null;
  const counts = mapped.reduce((result, key) => {
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  const key = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))[0];
  return { key, confidence: 48, source: "legacy_frozen_core_stages" };
}

function phaseLayer(key, source, options = {}) {
  const normalized = normalizeState(key);
  const consensus = options.consensus === true;
  return {
    key: normalized,
    label: normalized === "unknown"
      ? (consensus ? "高度一致度待确认" : EMOTION_STATE_LABELS.unknown)
      : consensus && normalized === "climax"
        ? "高度一致"
        : EMOTION_STATE_LABELS[normalized],
    source,
    explicit: options.explicit === true,
    marketEmotionEligible: !consensus,
  };
}

function explicitConsensusKey(candidate) {
  if (!isObject(candidate)) return "unknown";
  const consensus = candidate.consensusPhase;
  if (isObject(consensus)) return normalizeState(consensus.key || consensus.stage);
  return normalizeState(
    consensus
      || candidate.consensusKey
      || candidate.heightConsensusPhase
      || candidate.heightConsensus && (candidate.heightConsensus.key || candidate.heightConsensus.stage),
  );
}

function exactPreviousStateDateIdentity(input, exactPreviousTradingDay) {
  const tradingContext = isObject(input && input.tradingContext) ? input.tradingContext : {};
  const currentTradingDate = normalizedSessionDate(tradingContext.tradingDate);
  const expectedPreviousTradingDate = normalizedSessionDate(tradingContext.expectedPreviousTradingDate);
  const previousTradingDate = normalizedSessionDate(tradingContext.previousTradingDate);
  const previousSnapshotKind = String(tradingContext.previousSnapshotKind || "").trim().toLowerCase();
  const aligned = Boolean(
    exactPreviousTradingDay === true
    && tradingContext.exactPreviousTradingDay === true
    && tradingContext.previousEvidenceVerified === true
    && expectedPreviousTradingDate
    && previousTradingDate
    && previousTradingDate === expectedPreviousTradingDate
    && currentTradingDate
    && previousTradingDate < currentTradingDate
    && previousSnapshotKind === "closing",
  );
  return {
    currentTradingDate: currentTradingDate || null,
    expectedPreviousTradingDate: expectedPreviousTradingDate || null,
    previousTradingDate: previousTradingDate || null,
    previousSnapshotKind: previousSnapshotKind || null,
    previousEvidenceVerified: tradingContext.previousEvidenceVerified === true,
    aligned,
    verifiedTradingDate: aligned ? previousTradingDate : null,
  };
}

function resolvePreviousState(input, exactPreviousTradingDay) {
  const dateIdentity = exactPreviousStateDateIdentity(input, exactPreviousTradingDay);
  if (!exactPreviousTradingDay) {
    return {
      available: false,
      key: "unknown",
      label: EMOTION_STATE_LABELS.unknown,
      confidence: 0,
      source: "not_exact_t1",
      authority: null,
      exactCanonical: false,
      exactPreviousTradingDay: false,
      tradingDate: null,
      tradingDateSource: null,
      participatoryPhase: phaseLayer("unknown", "not_exact_t1"),
      consensusPhase: phaseLayer("unknown", "not_exact_t1", { consensus: true }),
    };
  }
  const previousPayload = isObject(input.previousPayload) ? input.previousPayload : {};
  const explicitCandidates = [
    input.previousState,
    previousPayload.emotionCycle && previousPayload.emotionCycle.current,
    previousPayload.tomorrowDecision
      && previousPayload.tomorrowDecision.coreEmotion
      && previousPayload.tomorrowDecision.coreEmotion.emotionCycle
      && previousPayload.tomorrowDecision.coreEmotion.emotionCycle.current,
  ];
  const explicit = explicitCandidates.find((candidate) => isObject(candidate) && normalizeState(candidate.key || candidate.stage) !== "unknown");
  if (explicit) {
    const key = normalizeState(explicit.key || explicit.stage);
    const consensusKey = explicitConsensusKey(explicit);
    return {
      available: true,
      key,
      label: String(explicit.label || EMOTION_STATE_LABELS[key] || "").trim(),
      confidence: finiteNumber(explicit.confidence) ?? 70,
      source: "exact_t1_emotion_cycle",
      authority: dateIdentity.aligned ? "canonical_exact_closing_state" : null,
      exactCanonical: true,
      exactPreviousTradingDay: dateIdentity.aligned,
      tradingDate: dateIdentity.verifiedTradingDate,
      tradingDateSource: dateIdentity.aligned ? "verified_exact_t1_trading_context" : null,
      lifecycle: isObject(explicit.lifecycle) ? { ...explicit.lifecycle } : null,
      phase: isObject(explicit.phase) ? { ...explicit.phase } : null,
      divergenceIntensity: isObject(explicit.divergenceIntensity) ? { ...explicit.divergenceIntensity } : null,
      divergenceQuality: isObject(explicit.divergenceQuality) ? { ...explicit.divergenceQuality } : null,
      supportState: isObject(explicit.supportState) ? { ...explicit.supportState } : null,
      participatoryPhase: {
        ...phaseLayer(key, "exact_t1_emotion_cycle", { explicit: true }),
        label: String(explicit.label || EMOTION_STATE_LABELS[key] || "").trim(),
      },
      consensusPhase: phaseLayer(consensusKey, "exact_t1_emotion_cycle", {
        consensus: true,
        explicit: consensusKey !== "unknown",
      }),
    };
  }
  const legacy = legacyPreviousState(previousPayload);
  if (legacy) {
    return {
      available: true,
      key: legacy.key,
      label: EMOTION_STATE_LABELS[legacy.key],
      confidence: legacy.confidence,
      source: legacy.source,
      authority: null,
      exactCanonical: false,
      exactPreviousTradingDay: false,
      tradingDate: null,
      tradingDateSource: null,
      participatoryPhase: phaseLayer(legacy.key, legacy.source),
      consensusPhase: phaseLayer("unknown", legacy.source, { consensus: true }),
    };
  }
  return {
    available: false,
    key: "unknown",
    label: EMOTION_STATE_LABELS.unknown,
    confidence: 0,
    source: "exact_t1_state_missing",
    authority: null,
    exactCanonical: false,
    exactPreviousTradingDay: false,
    tradingDate: null,
    tradingDateSource: null,
    participatoryPhase: phaseLayer("unknown", "exact_t1_state_missing"),
    consensusPhase: phaseLayer("unknown", "exact_t1_state_missing", { consensus: true }),
  };
}

function weightedAverage(rows, selector) {
  let numerator = 0;
  let denominator = 0;
  rows.forEach((row) => {
    const value = selector(row);
    if (value == null) return;
    const weight = finiteNumber(row.influenceWeightPct) ?? 0;
    if (weight <= 0) return;
    numerator += value * weight;
    denominator += weight;
  });
  return denominator ? round(numerator / denominator) : null;
}

function emotionPhaseDimensions({
  key,
  phaseKey,
  primaryCount,
  divergenceCount,
  supportedCount,
  repairFailedCount,
  harmfulCount,
  supportAnchorCount,
  primarySupport,
  primaryDamage,
}) {
  const safePrimaryCount = primaryCount > 0 ? primaryCount : 0;
  const divergenceRate = safePrimaryCount ? divergenceCount / safePrimaryCount : null;
  const harmfulRate = safePrimaryCount ? harmfulCount / safePrimaryCount : null;
  const repairFailedRate = safePrimaryCount ? repairFailedCount / safePrimaryCount : null;
  const divergencePhase = divergenceCount >= 2 && (
    harmfulCount >= 1
    || repairFailedCount >= 2
    || supportedCount >= 2
    || ["realization", "harmful", "retreat"].includes(key)
    || /divergence/.test(String(phaseKey || ""))
  );
  const phase = key === "unknown"
    ? { key: "unknown", label: "情绪节奏待确认" }
    : divergencePhase
      ? { key: "divergence", label: "分歧" }
      : key === "support"
        ? { key: "repair", label: "修复" }
        : key === "retreat"
          ? { key: "weakening", label: "转弱" }
          : ["acceleration", "climax"].includes(key)
            ? { key: "strengthening", label: key === "climax" ? "一致高热" : "加强" }
            : { key, label: EMOTION_STATE_LABELS[key] || "情绪节奏待确认" };

  let intensity = { key: "not_applicable", label: "非分歧阶段", score: null };
  if (divergencePhase) {
    if (
      ["harmful", "retreat"].includes(key)
      && (
        (harmfulCount >= 2 && primaryDamage != null && primaryDamage >= 50)
        || (repairFailedRate != null && repairFailedRate >= 0.5 && primaryDamage != null && primaryDamage >= 40)
      )
    ) {
      intensity = { key: "large", label: "大分歧", score: primaryDamage };
    } else if (
      phaseKey === "strong_divergence"
      || divergenceRate != null && divergenceRate >= 0.5
      || repairFailedCount >= 2
      || primaryDamage != null && primaryDamage >= 25
    ) {
      intensity = { key: "medium", label: "中等分歧", score: primaryDamage };
    } else {
      intensity = { key: "small", label: "小分歧", score: primaryDamage };
    }
  }

  let quality = { key: "not_applicable", label: "非分歧阶段" };
  if (divergencePhase) {
    if (
      repairFailedCount >= 2
      && (primarySupport == null || primarySupport < 40)
      && (primaryDamage == null || primaryDamage >= 35)
    ) {
      quality = { key: "non_benign", label: "非良性" };
    } else if (
      supportedCount >= 2
      && primarySupport != null
      && primarySupport >= 50
      && repairFailedCount <= supportedCount
    ) {
      quality = { key: "benign", label: "良性" };
    } else {
      quality = { key: "neutral", label: "中性待确认" };
    }
  }

  const support = primarySupport == null
    ? { key: "unknown", label: "承接待确认", score: null }
    : supportAnchorCount >= 2 && primarySupport >= 58
      ? { key: "strong", label: "承接强", score: primarySupport }
      : primarySupport < 40 || repairFailedCount > supportedCount
        ? { key: "weak", label: "承接弱", score: primarySupport }
        : { key: "mixed", label: "承接一般", score: primarySupport };

  return {
    lifecycle: {
      key,
      phaseKey,
      label: key === "harmful"
        ? "风险分歧状态"
        : EMOTION_STATE_LABELS[key] || "情绪节奏待确认",
    },
    phase,
    divergenceIntensity: {
      ...intensity,
      harmfulAnchorCount: harmfulCount,
      harmfulAnchorRate: harmfulRate == null ? null : round(harmfulRate * 100, 1),
      divergentAnchorCount: divergenceCount,
      divergentAnchorRate: divergenceRate == null ? null : round(divergenceRate * 100, 1),
    },
    divergenceQuality: {
      ...quality,
      supportedCount,
      repairFailedCount,
      repairFailedRate: repairFailedRate == null ? null : round(repairFailedRate * 100, 1),
    },
    support,
  };
}

function deriveMarketState(anchors, previous) {
  const marketRows = anchors.filter((row) => !row.excludedFromMarketState);
  const primaryAnchors = marketRows.filter((row) => row.layer === "A" || row.layer === "B");
  const participatingRows = marketRows.filter((row) => row.participation && row.participation.marketEmotionEligible);
  const participatingPrimaryAnchors = primaryAnchors.filter((row) => row.participation.marketEmotionEligible);
  const breadthRows = participatingRows.filter((row) => row.layer === "C" && (
    row.current.limitUp
    || row.heat.score >= 50
    || (row.support.score != null && row.support.score >= 55)
    || (row.damage.score != null && row.damage.score >= 40)
  ));
  const primaryContributors = participatingPrimaryAnchors.filter((row) => (
    row.signals.active
    || row.heat.score >= 55
    || (row.support.score != null && row.support.score >= 55)
    || (row.damage.score != null && row.damage.score >= 35)
  ));
  const contributors = [...primaryContributors, ...breadthRows];
  const roleKeys = new Set(contributors.map((row) => row.anchorRole));
  const transitionQualified = contributors.length >= 3
    && roleKeys.size >= 2
    && primaryContributors.length >= 2;
  const heatAnchors = participatingPrimaryAnchors.filter((row) => row.layer === "A" && row.heat.score >= 65);
  const accelerationHeatAnchors = heatAnchors.filter((row) => (
    row.participation.divergence !== true
    && row.participation.repairFailed !== true
  ));
  const climaxAnchors = participatingPrimaryAnchors.filter((row) => (
    row.layer === "A"
    && row.participation.climaxEligible
    && row.heat.score >= 75
  ));
  const climaxConfirmationAnchors = climaxAnchors.filter((row) => (
    row.participation.divergence !== true
    && row.participation.repairFailed !== true
  ));
  const heightConsensusAnchors = primaryAnchors.filter((row) => (
    row.layer === "A" && row.participation.heightConsensusEligible && row.heat.score >= 55
  ));
  const supportAnchors = participatingPrimaryAnchors.filter((row) => row.support.score != null && row.support.score >= 60);
  const realizationAnchors = participatingPrimaryAnchors.filter((row) => (
    row.heat.score >= 55
    && row.damage.score != null
    && row.damage.score >= 25
    && row.damage.score < 65
  ));
  const harmfulAnchors = participatingPrimaryAnchors.filter((row) => row.damage.score != null && row.damage.score >= 65);
  const divergenceAnchors = participatingPrimaryAnchors.filter((row) => row.participation.divergence);
  const supportedDivergenceAnchors = divergenceAnchors.filter((row) => row.participation.supportIntact);
  const repairFailedAnchors = divergenceAnchors.filter((row) => row.participation.repairFailed);
  const localRepairAnchors = participatingPrimaryAnchors.filter((row) => row.participation.localRepair);
  const phaseRows = [...participatingPrimaryAnchors, ...breadthRows];
  const heat = weightedAverage(phaseRows, (row) => row.heat.score);
  const climaxHeat = weightedAverage(climaxConfirmationAnchors, (row) => row.heat.score);
  const support = weightedAverage(phaseRows, (row) => row.support.score);
  const damage = weightedAverage(phaseRows, (row) => row.damage.score);
  const primarySupport = weightedAverage(participatingPrimaryAnchors, (row) => row.support.score);
  const primaryDamage = weightedAverage(participatingPrimaryAnchors, (row) => row.damage.score);
  const divergenceMajorityMinimum = Math.max(2, Math.floor(participatingPrimaryAnchors.length / 2) + 1);
  const strongDivergenceEvidenceQualified = transitionQualified
    && !["harmful", "retreat"].includes(previous.key)
    && divergenceAnchors.length >= divergenceMajorityMinimum
    && repairFailedAnchors.length >= 2
    && primarySupport != null
    && primarySupport < 40
    && primaryDamage != null
    && primaryDamage >= 25
    && primaryDamage < 65;
  const oneWordCount = primaryAnchors.filter((row) => (
    row.layer === "A" && row.current.oneWord && row.heat.score >= 55
  )).length;
  let key = previous.available ? previous.key : "unknown";
  let phaseKey = key;
  let reason = previous.available
    ? `沿用T-1阶段${previous.label}，等待足够可参与核心确认变化`
    : "缺少精确T-1状态，且当前样本尚不足以确认新阶段";
  let phaseQuality = {
    key: "unconfirmed",
    label: "待确认",
    reason: "可参与核心的分歧与承接证据尚未同时成立",
  };
  const previousParticipatoryClimax = previous.key === "climax"
    || previous.participatoryPhase && previous.participatoryPhase.key === "climax";
  const previousParticipatoryAcceleration = previous.key === "acceleration"
    || previous.participatoryPhase && previous.participatoryPhase.key === "acceleration";
  const previousExplicitConsensusClimax = previous.consensusPhase
    && previous.consensusPhase.explicit === true
    && previous.consensusPhase.key === "climax";
  const previousClimaxBasis = previousParticipatoryClimax
    ? "participatory_main_phase"
    : previousParticipatoryAcceleration && transitionQualified
      ? "participatory_acceleration_plus_current_breadth"
      : null;
  const postClimaxEvidenceQualified = previous.available
    && previous.exactCanonical === true
    && previousClimaxBasis != null
    && strongDivergenceEvidenceQualified !== true
    && divergenceAnchors.length >= 2
    && supportedDivergenceAnchors.length >= 2;
  const phaseTransitionQualified = transitionQualified || postClimaxEvidenceQualified;

  if (postClimaxEvidenceQualified) {
    // 兼容旧下游：key仍是realization，新主阶段由phaseKey表达。
    key = "realization";
    phaseKey = previousClimaxBasis === "participatory_main_phase"
      ? "post_climax_divergence"
      : "post_heat_divergence";
    reason = previousClimaxBasis === "participatory_main_phase"
      ? "精确T-1可参与主阶段为高潮，至少两只可参与核心出现真实分歧，但换手承接仍在"
      : `精确T-1可参与主阶段为加速，当前可参与广度达标；至少两只核心分歧后承接仍在${previousExplicitConsensusClimax ? "；高度一致度仅作高热旁证" : ""}`;
    phaseQuality = { key: "support_intact", label: "暂偏良性", reason: "分歧已发生，但至少两只核心守住承接；次日仍需验证" };
  } else if (transitionQualified) {
    if (harmfulAnchors.length >= 2 && damage != null && damage >= 50) {
      key = ["realization", "harmful", "retreat"].includes(previous.key) ? "retreat" : "harmful";
      phaseKey = key;
      reason = key === "retreat"
        ? "负反馈在兑现/非良性阶段后继续扩散，确认进入退潮"
        : "至少两只A/B锚出现高伤害，并由多角色广度确认非良性分歧";
      phaseQuality = { key: "repair_failed", label: "承接转弱", reason: "至少两只可参与核心修复失败，负反馈已扩散" };
    } else if (strongDivergenceEvidenceQualified) {
      // 兼容旧下游：realization 仍是 legacy key；细分主阶段由 phaseKey 表达。
      key = "realization";
      phaseKey = "strong_divergence";
      reason = "多数可参与核心进入真实分歧且至少两只修复失败，弱承接与中等伤害共同确认强分歧";
      phaseQuality = {
        key: "strong_divergence",
        label: "强分歧",
        reason: "分歧已扩散至多数可参与核心，但伤害尚未达到非良性分歧/退潮门槛",
      };
    } else if (
      previous.available
      && ["acceleration", "climax"].includes(previous.key)
      && repairFailedAnchors.length >= 2
      && realizationAnchors.length >= 2
      && damage != null
      && damage >= 22
    ) {
      key = "realization";
      phaseKey = "realization";
      reason = "加速/高潮后至少两只可参与核心修复失败，确认进入兑现";
      phaseQuality = { key: "repair_failed", label: "承接转弱", reason: "多核心分歧后没有收回承接" };
    } else if (
      previous.available
      && ["realization", "harmful", "retreat"].includes(previous.key)
      && supportAnchors.length >= 2
      && support != null
      && support >= 58
    ) {
      key = "support";
      phaseKey = "support";
      reason = "前置分歧或退潮后，至少两只A/B锚形成真实承接并获得广度确认";
      phaseQuality = { key: "support_confirmed", label: "承接确认", reason: "至少两只可参与核心同时修复" };
    } else if (accelerationHeatAnchors.length >= 2) {
      const climaxConfirmed = climaxConfirmationAnchors.length >= 2 && (climaxHeat ?? 0) >= 80;
      key = climaxConfirmed ? "climax" : "acceleration";
      phaseKey = key;
      reason = climaxConfirmed
        ? "多只可参与A层主锚进入高热区，且多角色广度确认高潮"
        : "至少两只可参与A层主锚同步走强，并由第三个独立样本确认加速";
      phaseQuality = climaxConfirmed
        ? { key: "broad_participation", label: "可参与一致", reason: "高潮由可交易核心共同确认，一字不参与确认" }
        : { key: "accelerating", label: "加速中", reason: "可参与核心走强，尚未达高潮门槛" };
    }
  }

  const changed = previous.available && key !== previous.key;
  let confidence = key === "unknown" ? 28 : 42;
  confidence += Math.min(24, contributors.length * 6);
  confidence += Math.min(16, roleKeys.size * 8);
  if (previous.available) confidence += 10;
  confidence = clamp(Math.round(confidence), 20, 90);
  if (!previous.available) confidence = Math.min(confidence, 68);
  if (!phaseTransitionQualified && changed) {
    // 防御性不变量：任何阶段改变都必须满足3样本、2角色、2个A/B锚。
    key = previous.key;
    phaseKey = previous.key;
    reason = "阶段变化被样本/角色硬门槛否决，维持T-1状态";
    phaseQuality = { key: "insufficient_participation", label: "参与样本不足", reason: "未达到3样本、2角色和2个A/B可参与锚的门槛" };
  }

  const postClimax = phaseKey === "post_climax_divergence";
  const postHeat = phaseKey === "post_heat_divergence";
  const strongDivergence = phaseKey === "strong_divergence";
  const currentLabel = postClimax
    ? "高潮后分歧"
    : postHeat
      ? "高热后分歧"
      : strongDivergence
        ? EMOTION_STATE_LABELS.strong_divergence
        : EMOTION_STATE_LABELS[key];
  const currentConsensusPhase = heightConsensusAnchors.length
    ? {
      key: "climax",
      label: "高度一致",
      source: "height_consensus_only",
      explicit: true,
      marketEmotionEligible: false,
      anchorCount: heightConsensusAnchors.length,
    }
    : {
      key: "unknown",
      label: "高度一致度待确认",
      source: "no_height_consensus_anchor",
      explicit: false,
      marketEmotionEligible: false,
      anchorCount: 0,
    };
  const participation = {
    eligibleAnchorCount: participatingRows.length,
    primaryEligibleCount: participatingPrimaryAnchors.length,
    oneWordExcludedCount: marketRows.filter((row) => row.current.oneWord).length,
    heightConsensusOnlyCount: marketRows.filter((row) => row.participation.heightConsensusEligible).length,
    climaxEligibleCount: marketRows.filter((row) => row.participation.climaxEligible).length,
    divergentAnchorCount: divergenceAnchors.length,
    divergenceMajorityMinimum,
    supportedDivergenceCount: supportedDivergenceAnchors.length,
    repairFailedCount: repairFailedAnchors.length,
    localRepairCount: localRepairAnchors.length,
    rule: "一字/全天锁死只计高度一致度，只有真实价格发现才计可参与情绪",
  };
  const dimensions = emotionPhaseDimensions({
    key,
    phaseKey,
    primaryCount: participatingPrimaryAnchors.length,
    divergenceCount: divergenceAnchors.length,
    supportedCount: supportedDivergenceAnchors.length,
    repairFailedCount: repairFailedAnchors.length,
    harmfulCount: harmfulAnchors.length,
    supportAnchorCount: supportAnchors.length,
    primarySupport,
    primaryDamage,
  });
  const displayLabel = postClimax
    ? `高潮后·${dimensions.divergenceIntensity.label}`
    : postHeat
      ? `高热后·${dimensions.divergenceIntensity.label}`
      : dimensions.phase.key === "divergence"
        ? key === "retreat"
          ? `${dimensions.divergenceIntensity.label}·退潮确认`
          : dimensions.divergenceIntensity.label
        : currentLabel;

  return {
    current: {
      key,
      legacyKey: key,
      phaseKey,
      label: displayLabel,
      qualityKey: phaseQuality.key,
      qualityLabel: phaseQuality.label,
      lifecycle: dimensions.lifecycle,
      phase: dimensions.phase,
      divergenceIntensity: dimensions.divergenceIntensity,
      divergenceQuality: dimensions.divergenceQuality,
      supportState: dimensions.support,
      participatoryPhase: {
        key: phaseKey,
        legacyKey: key,
        label: displayLabel,
        marketEmotionEligible: true,
      },
      consensusPhase: currentConsensusPhase,
      previousClimaxBasis: postClimax ? previousClimaxBasis : null,
      previousHeatBasis: postClimax || postHeat ? previousClimaxBasis : null,
      confidence,
      reason,
      crossDayVerified: previous.exactCanonical === true,
    },
    participation,
    dimensions,
    phaseQuality,
    transition: {
      changed: previous.available && key !== previous.key,
      qualified: phaseTransitionQualified,
      qualifiedBy: postClimaxEvidenceQualified
        ? previousClimaxBasis === "participatory_main_phase"
          ? "exact_t1_participatory_climax_plus_two_supported_divergent_cores"
          : "exact_t1_participatory_acceleration_plus_current_breadth"
        : strongDivergenceEvidenceQualified
          ? "majority_divergent_cores_plus_weak_support_and_medium_damage"
        : "standard_multi_sample_gate",
      independentSampleCount: contributors.length,
      primaryAnchorCount: primaryContributors.length,
      roleCount: roleKeys.size,
      roles: [...roleKeys].sort(),
      minimumIndependentSamples: postClimaxEvidenceQualified && previousClimaxBasis === "participatory_main_phase" ? 2 : 3,
      standardMinimumIndependentSamples: 3,
      minimumRoleCount: 2,
      minimumPrimaryAnchors: 2,
    },
    metrics: {
      heat: {
        score: heat,
        confirmationScore: climaxHeat,
        highAnchorCount: heatAnchors.length,
        accelerationEligibleAnchorCount: accelerationHeatAnchors.length,
        climaxAnchorCount: climaxAnchors.length,
        climaxConfirmationAnchorCount: climaxConfirmationAnchors.length,
        oneWordCount,
        oneWordUsedForClimaxConfirmation: false,
      },
      support: {
        score: support,
        primaryCoreScore: primarySupport,
        confirmedAnchorCount: supportAnchors.length,
        knownCount: marketRows.filter((row) => row.support.score != null).length,
        unknownCount: marketRows.filter((row) => row.support.score == null).length,
      },
      damage: {
        score: damage,
        primaryCoreScore: primaryDamage,
        realizationAnchorCount: realizationAnchors.length,
        harmfulAnchorCount: harmfulAnchors.length,
      },
      marketSampleCount: marketRows.length,
      participatoryMarketSampleCount: participatingRows.length,
      breadthSampleCount: breadthRows.length,
      selectedCandidateExcludedCount: anchors.length - marketRows.length,
    },
  };
}

function themeStageSummaries(anchors) {
  const groups = new Map();
  anchors.forEach((anchor) => {
    if (anchor.excludedFromMarketState || !anchor.direction || anchor.direction === "未归类") return;
    const rows = groups.get(anchor.direction) || [];
    rows.push(anchor);
    groups.set(anchor.direction, rows);
  });
  const unknownPrevious = { available: false, key: "unknown", label: EMOTION_STATE_LABELS.unknown };
  const statePriority = { climax: 6, acceleration: 5, support: 4, realization: 3, harmful: 2, retreat: 1, unknown: 0 };
  return [...groups.entries()].map(([name, rows]) => {
    const state = deriveMarketState(rows, unknownPrevious);
    const primaryRows = rows.filter((row) => row.layer === "A" || row.layer === "B");
    return {
      name,
      current: state.current,
      transition: state.transition,
      metrics: state.metrics,
      anchorCount: rows.length,
      primaryAnchorCount: primaryRows.length,
      anchors: primaryRows.slice(0, 6).map((row) => ({
        code: row.code,
        name: row.name,
        layer: row.layer,
        role: row.anchorRole,
        roleLabel: row.anchorRoleLabel,
        score: row.anchorScore,
      })),
    };
  }).filter((row) => row.current.key !== "unknown")
    .sort((left, right) => (
      (statePriority[right.current.key] || 0) - (statePriority[left.current.key] || 0)
      || right.primaryAnchorCount - left.primaryAnchorCount
      || right.anchorCount - left.anchorCount
      || left.name.localeCompare(right.name, "zh-CN")
    ));
}

function capacityConfirmation(anchors) {
  const rows = anchors.filter((row) => row.layer === "B" && !row.excludedFromMarketState);
  const supported = rows.filter((row) => row.support.score != null && row.support.score >= 60);
  const damaged = rows.filter((row) => row.damage.score != null && row.damage.score >= 35);
  const unknown = rows.filter((row) => row.support.score == null);
  let key = "unknown";
  let label = "容量确认待补充";
  if (damaged.length >= 2) {
    key = "negative";
    label = "容量核心负反馈扩散";
  } else if (supported.length >= 2 && damaged.length === 0 && unknown.length <= Math.floor(rows.length / 2)) {
    key = "support";
    label = "容量核心形成承接";
  } else if (rows.length) {
    key = "split";
    label = "容量确认仍分化";
  }
  return {
    key,
    label,
    total: rows.length,
    supportedCount: supported.length,
    damagedCount: damaged.length,
    unknownCount: unknown.length,
  };
}

function generationContextOf(value = {}) {
  const source = isObject(value) ? value : {};
  const generation = isObject(source.generationContext)
    ? source.generationContext
    : isObject(source.generation)
      ? source.generation
      : source;
  const generationId = String(generation.generationId || generation.id || "").trim() || null;
  const tradingDate = normalizedSessionDate(generation.tradingDate) || null;
  const asOf = String(generation.asOf || generation.generatedAt || "").trim() || null;
  return {
    generationId,
    tradingDate,
    asOf,
    complete: Boolean(generationId && tradingDate && asOf),
  };
}

function previousEmotionBigCycle(source, previous) {
  if (!previous || previous.exactCanonical !== true || previous.exactPreviousTradingDay !== true) return null;
  const previousPayload = isObject(source && source.previousPayload) ? source.previousPayload : {};
  const candidates = [
    source && source.previousBigCycle,
    previousPayload.emotionCycle && previousPayload.emotionCycle.bigCycle,
    previousPayload.premarketModels
      && previousPayload.premarketModels.emotionCycle
      && previousPayload.premarketModels.emotionCycle.bigCycle,
    previousPayload.tomorrowDecision
      && previousPayload.tomorrowDecision.coreEmotion
      && previousPayload.tomorrowDecision.coreEmotion.emotionCycle
      && previousPayload.tomorrowDecision.coreEmotion.emotionCycle.bigCycle,
  ];
  const candidate = candidates.find((value) => normalizeBigCycleKey(
    isObject(value) ? value.key || value.label : value,
  ));
  if (!candidate) return null;
  const key = normalizeBigCycleKey(isObject(candidate) ? candidate.key || candidate.label : candidate);
  return {
    key,
    label: BIG_CYCLE_LABELS[key],
    source: String(isObject(candidate) && candidate.source || "exact_t1_emotion_big_cycle"),
  };
}

const EMOTION_COMPOSITE_THRESHOLDS = Object.freeze({
  mainRiseEnter: Object.freeze({ profitMin: 68, lossMax: 42, netMin: 25, consistencyMin: 60 }),
  mainRiseHold: Object.freeze({ profitMin: 58, lossMax: 52, netMin: 10 }),
  range: Object.freeze({ profitMin: 42, lossMax: 58, consistencyMin: 50, instabilityMax: 65 }),
  retreat: Object.freeze({ profitMax: 48, lossMin: 65, netMax: -20 }),
  icePoint: Object.freeze({ profitMax: 32, heatMax: 45 }),
});

function buildEmotionSentimentComposite({ effectContext, heat, support, damage, current, generation } = {}) {
  const context = isObject(effectContext) ? effectContext : {};
  const profitSource = isObject(context.profit) ? context.profit : {};
  const lossSource = isObject(context.loss) ? context.loss : {};
  const profitScore = finiteNumber(profitSource.score);
  const lossScore = finiteNumber(lossSource.score);
  const heatScore = finiteNumber(heat);
  const supportScore = finiteNumber(support);
  const damageScore = finiteNumber(damage);
  const contextTradingDate = normalizedSessionDate(context.tradingDate);
  const expectedTradingDate = normalizedSessionDate(generation && generation.tradingDate);
  const generationAligned = !expectedTradingDate || contextTradingDate === expectedTradingDate;
  const contextGuardrails = isObject(context.guardrails) ? context.guardrails : {};
  const authorityIsolated = contextGuardrails.wholeMarketOnly === true
    && contextGuardrails.indexDirectionExcluded === true
    && contextGuardrails.candidateLeadershipExcluded === true
    && contextGuardrails.hotDirectionsExcluded === true;
  const available = ["ready", "available"].includes(String(context.status || ""))
    && profitScore !== null
    && lossScore !== null
    && generationAligned
    && authorityIsolated;
  const netScore = available ? round(profitScore - lossScore) : null;
  const directions = [
    profitScore === null ? null : profitScore >= 60 ? 1 : profitScore <= 40 ? -1 : 0,
    lossScore === null ? null : lossScore <= 40 ? 1 : lossScore >= 60 ? -1 : 0,
    heatScore === null ? null : heatScore >= 60 ? 1 : heatScore <= 40 ? -1 : 0,
    supportScore === null || damageScore === null
      ? null
      : supportScore - damageScore >= 15 ? 1 : damageScore - supportScore >= 15 ? -1 : 0,
  ].filter((value) => value !== null);
  const directional = directions.filter((value) => value !== 0);
  const positiveCount = directional.filter((value) => value > 0).length;
  const negativeCount = directional.filter((value) => value < 0).length;
  const consistencyScore = directional.length
    ? round((Math.max(positiveCount, negativeCount) / directional.length) * 100)
    : null;
  const conflict = available && (
    (profitScore >= 55 && lossScore >= 55)
    || (supportScore !== null && damageScore !== null && supportScore >= 55 && damageScore >= 55)
  );
  const observations = isObject(context.observations) ? context.observations : {};
  const profitRatio = finiteNumber(observations.limitUpCount) !== null
    && finiteNumber(observations.previousLimitUpCount) > 0
    ? finiteNumber(observations.limitUpCount) / finiteNumber(observations.previousLimitUpCount)
    : null;
  const lossRatio = finiteNumber(observations.limitDownCount) !== null
    && finiteNumber(observations.previousLimitDownCount) > 0
    ? finiteNumber(observations.limitDownCount) / finiteNumber(observations.previousLimitDownCount)
    : null;
  const profitTrend = String(profitSource.trend || (
    profitRatio === null ? "unknown" : profitRatio >= 1.1 ? "improving" : profitRatio <= 0.9 ? "weakening" : "stable"
  ));
  const lossTrend = String(lossSource.trend || (
    lossRatio === null ? "unknown" : lossRatio >= 1.15 ? "worsening" : lossRatio <= 0.85 ? "improving" : "stable"
  ));
  return {
    version: 2,
    method: "full_market_effect_plus_hsd_v2",
    calibrated: false,
    available,
    status: available ? "available" : context.status === "partial" ? "partial" : "unavailable",
    profitScore,
    lossScore,
    netScore,
    consistencyScore,
    instabilityScore: null,
    instabilityStatus: "history_not_yet_sufficient",
    conflict,
    trends: {
      profit: profitTrend,
      loss: lossTrend,
    },
    generationAligned,
    authorityIsolated,
    source: {
      contextVersion: finiteNumber(context.version),
      contextStatus: String(context.status || "missing"),
      tradingDate: contextTradingDate || null,
      indexDirectionExcluded: true,
      indexStructureExcluded: true,
      recommendationCandidatesExcluded: true,
      hotDirectionsExcluded: true,
    },
  };
}

/**
 * 情绪大周期的唯一权威映射。
 *
 * 大周期权威只允许来自五个精确收盘交易日的全市场赚钱/亏钱效应与核心连续性窗口；
 * 当日情绪阶段、精确 T-1、H/S/D 只描述窗口内节奏并用于旧档兼容失败关闭。
 * 指数、指数均线、候选股和热门方向即使被夹带也不会被读取。
 */
function resolveFiveDayBigCycleAuthority(value, generation, previousBig) {
  const window = isObject(value) ? value : null;
  const method = String(window && window.method || "").trim();
  const declared = Boolean(window && (
    method === "five_day_weighted_emotion_big_cycle_window_v1"
    || window.horizon === "rolling_5_trading_days"
  ));
  if (!declared) return { declared: false };
  const candidate = isObject(window.candidate) ? window.candidate : {};
  const observations = Array.isArray(window.observations) ? window.observations : [];
  const tradingDates = observations
    .map((item) => normalizedSessionDate(item && item.tradingDate))
    .filter(Boolean);
  const lastTradingDate = tradingDates.length ? tradingDates[tradingDates.length - 1] : null;
  const windowTradingDate = normalizedSessionDate(window.tradingDate);
  const windowGeneration = generationContextOf(window.generationContext || {});
  const generationAligned = !generation.complete || Boolean(
    windowTradingDate === generation.tradingDate
    && lastTradingDate === generation.tradingDate
    && windowGeneration.complete
    && windowGeneration.generationId === generation.generationId
    && windowGeneration.asOf === generation.asOf
  );
  const target = normalizeBigCycleKey(window.key || candidate.key);
  const confirmed = Boolean(
    window.status === "available"
    && candidate.confirmed === true
    && target
    && generationAligned
  );
  const fallbackKey = previousBig || "chaos";
  if (!generationAligned) {
    return {
      declared: true,
      confirmed: false,
      key: fallbackKey,
      status: "unavailable",
      source: method || "five_day_emotion_big_cycle_window",
      reasonCode: "five_day_window_generation_mismatch",
      reason: "五日情绪窗口与当前收盘代次不一致，保留精确T-1标签但关闭周期确认。",
      window,
      tradingDates,
    };
  }
  if (!confirmed) {
    return {
      declared: true,
      confirmed: false,
      key: fallbackKey,
      status: "unavailable",
      source: method || "five_day_emotion_big_cycle_window",
      reasonCode: String(candidate.reasonCode || (window.blockers && window.blockers[0]) || "five_day_window_unconfirmed"),
      reason: String(candidate.reason || (window.evidence && window.evidence[0]) || "五日情绪窗口尚未完成确认。"),
      window,
      tradingDates,
    };
  }

  let key = target;
  let reasonCode = String(candidate.reasonCode || "five_day_window_confirmed");
  let reason = String(candidate.reason || "五日情绪窗口已完成确认。");
  if (target === "ice_point" && !["retreat", "ice_point"].includes(previousBig)) {
    key = "retreat";
    reasonCode = "ice_point_requires_retreat_lineage";
    reason = "五日极弱特征已成立，但冰点必须先有退潮谱系；本次先确认退潮。";
  } else if (["retreat", "ice_point"].includes(previousBig) && ["main_rise", "range"].includes(target)) {
    key = "chaos";
    reasonCode = "cold_cycle_recovery_returns_to_chaos_first";
    reason = "退潮/冰点后的五日修复已成立，但大周期只允许先回到混沌确认。";
  }
  return {
    declared: true,
    confirmed: true,
    key,
    status: "canonical",
    source: method || "five_day_emotion_big_cycle_window",
    reasonCode,
    reason,
    window,
    tradingDates,
  };
}

function resolveEmotionBigCycle(input = {}) {
  const source = isObject(input) ? input : {};
  const current = isObject(source.current) ? source.current : {};
  const previous = isObject(source.previous) ? source.previous : {};
  const metrics = isObject(source.metrics) ? source.metrics : {};
  const heatMetrics = isObject(metrics.heat) ? metrics.heat : {};
  const supportMetrics = isObject(metrics.support) ? metrics.support : {};
  const damageMetrics = isObject(metrics.damage) ? metrics.damage : {};
  const transition = isObject(source.transition) ? source.transition : {};
  const generation = generationContextOf(source.generationContext || source.generation || {});
  const exactT1 = previous.exactCanonical === true && previous.exactPreviousTradingDay === true;
  const currentKey = normalizeState(current.key || current.stage);
  const previousEmotionKey = exactT1 ? normalizeState(previous.key || previous.stage) : "unknown";
  const previousBig = exactT1
    ? normalizeBigCycleKey(isObject(source.previousBigCycle)
      ? source.previousBigCycle.key || source.previousBigCycle.label
      : source.previousBigCycle)
    : null;
  const phaseKey = String(current.phaseKey || current.participatoryPhase && current.participatoryPhase.key || "").trim();
  const snapshotKind = String(source.snapshotKind || source.tradingContext && source.tradingContext.snapshotKind || "unknown").trim().toLowerCase();
  const heatScore = finiteNumber(heatMetrics.score);
  const supportScore = finiteNumber(supportMetrics.score);
  const primarySupportScore = finiteNumber(supportMetrics.primaryCoreScore);
  const damageScore = finiteNumber(damageMetrics.score);
  const primaryDamageScore = finiteNumber(damageMetrics.primaryCoreScore);
  const harmfulAnchorCount = finiteNumber(damageMetrics.harmfulAnchorCount) ?? 0;
  const transitionQualified = transition.qualified === true;
  const multiAnchorDamage = transitionQualified && (
    harmfulAnchorCount >= 2
    || ((primaryDamageScore ?? damageScore ?? 0) >= 65 && (transition.primaryAnchorCount ?? 0) >= 2)
  );
  const healthyDivergence = currentKey === "realization"
    && !["strong_divergence", "harmful", "retreat"].includes(phaseKey)
    && (
      ["post_climax_divergence", "post_heat_divergence"].includes(phaseKey)
      || current.divergenceQuality && ["support_intact", "benign"].includes(current.divergenceQuality.key)
    )
    && (primarySupportScore ?? supportScore ?? 0) >= 40
    && (primaryDamageScore ?? damageScore ?? 0) < 65;
  const recoveringFromColdCycle = ["retreat", "ice_point"].includes(previousBig);
  const composite = buildEmotionSentimentComposite({
    effectContext: source.emotionEffectContext,
    heat: heatScore,
    support: supportScore,
    damage: damageScore,
    current,
    generation,
  });
  const effectProvided = isObject(source.emotionEffectContext)
    && Object.keys(source.emotionEffectContext).length > 0;
  const profitScore = composite.profitScore;
  const lossScore = composite.lossScore;
  const netScore = composite.netScore;
  const contextAllowsMainRiseEntry = !effectProvided || (
    composite.available
    && profitScore >= EMOTION_COMPOSITE_THRESHOLDS.mainRiseEnter.profitMin
    && lossScore <= EMOTION_COMPOSITE_THRESHOLDS.mainRiseEnter.lossMax
    && netScore >= EMOTION_COMPOSITE_THRESHOLDS.mainRiseEnter.netMin
    && (composite.consistencyScore === null
      || composite.consistencyScore >= EMOTION_COMPOSITE_THRESHOLDS.mainRiseEnter.consistencyMin)
    && !composite.conflict
  );
  const contextAllowsMainRiseHold = !effectProvided || (
    composite.available
    && profitScore >= EMOTION_COMPOSITE_THRESHOLDS.mainRiseHold.profitMin
    && lossScore <= EMOTION_COMPOSITE_THRESHOLDS.mainRiseHold.lossMax
    && netScore >= EMOTION_COMPOSITE_THRESHOLDS.mainRiseHold.netMin
    && composite.trends.loss !== "worsening"
    && !composite.conflict
  );
  const fullMarketRetreatConfirmed = composite.available
    && profitScore <= EMOTION_COMPOSITE_THRESHOLDS.retreat.profitMax
    && lossScore >= EMOTION_COMPOSITE_THRESHOLDS.retreat.lossMin
    && netScore <= EMOTION_COMPOSITE_THRESHOLDS.retreat.netMax
    && composite.trends.loss === "worsening"
    && !composite.conflict;
  const persistentAnchorDamage = Boolean(
    exactT1
    && currentKey === "retreat"
    && ["harmful", "retreat"].includes(previousEmotionKey)
    && transitionQualified
  );
  const broadMarketRejectsRetreat = effectProvided && contextAllowsMainRiseHold;
  const retreatConfirmed = Boolean(
    (multiAnchorDamage && fullMarketRetreatConfirmed)
    || (persistentAnchorDamage && !broadMarketRejectsRetreat)
  );
  const icePointConfirmed = composite.available
    && ["retreat", "ice_point"].includes(previousBig)
    && profitScore <= EMOTION_COMPOSITE_THRESHOLDS.icePoint.profitMax
    && (heatScore === null || heatScore <= EMOTION_COMPOSITE_THRESHOLDS.icePoint.heatMax)
    && ["improving", "stable"].includes(composite.trends.loss)
    && !["acceleration", "climax", "support"].includes(currentKey)
    && !multiAnchorDamage;
  const evidence = [
    `currentEmotion=${currentKey}`,
    `exactT1=${exactT1}`,
    `previousEmotion=${previousEmotionKey}`,
    `previousBigCycle=${previousBig || "missing"}`,
    `transitionQualified=${transitionQualified}`,
    `H=${heatScore == null ? "unknown" : heatScore}`,
    `S=${supportScore == null ? "unknown" : supportScore}`,
    `D=${damageScore == null ? "unknown" : damageScore}`,
    `P=${profitScore == null ? "unknown" : profitScore}`,
    `N=${lossScore == null ? "unknown" : lossScore}`,
    `K=${composite.consistencyScore == null ? "unknown" : composite.consistencyScore}`,
    "V=unknown(history_not_yet_sufficient)",
    `snapshotKind=${snapshotKind || "unknown"}`,
    `effectContext=${composite.status}`,
    `fullMarketRetreatConfirmed=${fullMarketRetreatConfirmed}`,
    `persistentAnchorDamage=${persistentAnchorDamage}`,
  ];
  const fiveDayAuthority = resolveFiveDayBigCycleAuthority(
    source.emotionBigCycleWindow,
    generation,
    previousBig,
  );

  let key = "chaos";
  let status = "canonical";
  let authoritySource = "emotion_hsd_market_effect_state_machine_v2";
  let reasonCode = "emotion_evidence_not_yet_directional";
  let reason = "情绪证据尚不足以将大周期从混沌推进。";

  if (snapshotKind === "intraday") {
    key = exactT1 && previousBig ? previousBig : "chaos";
    reasonCode = exactT1 && previousBig
      ? "intraday_keeps_exact_t1_big_cycle"
      : "intraday_without_exact_t1_cannot_confirm_big_cycle";
    reason = exactT1 && previousBig
      ? "盘中只更新情绪候选变化，正式情绪大周期保留上一收盘状态。"
      : "盘中且缺少精确 T-1 正式状态，不确认情绪大周期。";
  } else if (fiveDayAuthority.declared) {
    key = fiveDayAuthority.key;
    status = fiveDayAuthority.status;
    authoritySource = fiveDayAuthority.source;
    reasonCode = fiveDayAuthority.reasonCode;
    reason = fiveDayAuthority.reason;
    evidence.unshift(...uniqueTexts([
      ...(fiveDayAuthority.window && Array.isArray(fiveDayAuthority.window.evidence)
        ? fiveDayAuthority.window.evidence : []),
      `fiveDayConfirmed=${fiveDayAuthority.confirmed}`,
      `fiveDayTradingDates=${fiveDayAuthority.tradingDates.join(",") || "missing"}`,
    ]));
  } else if (retreatConfirmed) {
    key = "retreat";
    reasonCode = persistentAnchorDamage
      ? "persistent_anchor_damage_confirmed"
      : "broad_loss_and_multi_anchor_damage_confirmed";
    reason = persistentAnchorDamage
      ? "核心负反馈跨交易日持续，且全市场赚钱效应未形成强反证，确认退潮。"
      : "多只 A/B 情绪锚高伤害与全市场亏钱效应扩散同时成立，确认退潮。";
  } else if (
    icePointConfirmed
  ) {
    key = "ice_point";
    reasonCode = "cold_breadth_without_damage_expansion";
    reason = "赚钱效应与情绪热度低位，但多锚伤害未继续扩散，确认为冰点观察。";
  } else if (["acceleration", "climax"].includes(currentKey)) {
    const compatibleT1Heat = exactT1 && (
      previousBig === "main_rise"
      || (!recoveringFromColdCycle && ["support", "acceleration", "climax"].includes(previousEmotionKey))
    );
    if (compatibleT1Heat && transitionQualified && contextAllowsMainRiseEntry) {
      key = "main_rise";
      reasonCode = "exact_t1_heat_and_current_breadth_confirmed";
      reason = "精确 T-1 情绪热度与当日多锚加速/高潮同时成立，确认主升。";
    } else {
      key = "chaos";
      reasonCode = effectProvided && !contextAllowsMainRiseEntry
        ? "full_market_effect_does_not_confirm_main_rise"
        : exactT1 ? "heat_recovery_requires_one_step_confirmation" : "first_generation_cannot_self_bootstrap_main_rise";
      reason = effectProvided && !contextAllowsMainRiseEntry
        ? "核心情绪出现加速，但全市场赚钱/亏钱效应未共同确认，不能定义情绪主升。"
        : exactT1
          ? "当日加速已出现，但 T-1 大周期/情绪阶段不支持直接跳到主升，先保持混沌。"
        : "缺少精确 T-1 情绪状态，禁止用单日加速自举主升。";
    }
  } else if (currentKey === "realization") {
    if (exactT1 && previousBig === "main_rise" && healthyDivergence && contextAllowsMainRiseHold) {
      key = "main_rise";
      reasonCode = "main_rise_healthy_divergence_held";
      reason = "主升内分歧已发生，但多锚承接仍在且伤害未扩散，继续保持主升。";
    } else if (exactT1 && previousBig === "main_rise" && healthyDivergence && effectProvided) {
      key = composite.conflict ? "chaos" : "range";
      reasonCode = composite.conflict
        ? "full_market_profit_loss_conflict_breaks_main_rise_hold"
        : "full_market_effect_below_main_rise_hold_gate";
      reason = composite.conflict
        ? "核心仍有承接，但全市场赚钱与亏钱效应同时偏强，主升一致性不足，降为混沌。"
        : "核心分歧承接仍在，但全市场赚钱效应未达到主升保持线，降为震荡。";
    } else if (recoveringFromColdCycle) {
      key = "chaos";
      reasonCode = "cold_cycle_recovery_cannot_skip_chaos";
      reason = "退潮/冰点后的首次分歧承接只能确认脱离极端负反馈，先回到混沌。";
    } else {
      key = "range";
      reasonCode = healthyDivergence ? "healthy_divergence_without_main_rise_lineage" : "realization_without_intact_support";
      reason = healthyDivergence
        ? "分歧承接健康，但缺少可延续的主升谱系，定义为震荡。"
        : "兑现已出现且承接未证明仍属主升，降为震荡。";
    }
  } else if (currentKey === "support") {
    if (recoveringFromColdCycle || ["harmful", "retreat"].includes(previousEmotionKey)) {
      key = "chaos";
      reasonCode = "retreat_or_ice_support_returns_to_chaos_first";
      reason = "退潮/冰点后承接确认只允许先回到混沌，不跨级定义主升。";
    } else {
      key = "range";
      reasonCode = "support_confirmed_range";
      reason = "多锚承接已确认，但尚未形成连续加速，定义为震荡。";
    }
  } else if (currentKey === "harmful") {
    key = previousBig === "retreat" ? "retreat" : "chaos";
    reasonCode = previousBig === "retreat" ? "retreat_damage_persists" : "harmful_not_yet_multi_anchor_retreat";
    reason = previousBig === "retreat"
      ? "T-1 已是退潮且当日仍属非良性分歧，继续保持退潮。"
      : "非良性分歧已出现，但未满足多锚退潮硬门槛，先保持混沌。";
  } else if (currentKey === "unknown" && exactT1 && previousBig) {
    key = previousBig;
    reasonCode = "insufficient_current_evidence_keeps_exact_t1_big_cycle";
    reason = "当日情绪证据不足以推进状态，保留精确 T-1 大周期。";
  }

  const changed = Boolean(exactT1 && previousBig && previousBig !== key);
  const transitionEvidence = uniqueTexts([
    `from=${previousBig || "unavailable"}`,
    `to=${key}`,
    `currentEmotion=${currentKey}`,
    `previousEmotion=${previousEmotionKey}`,
    `transitionQualified=${transitionQualified}`,
    multiAnchorDamage ? `harmfulAnchorCount=${harmfulAnchorCount}` : "",
    `fullMarketRetreatConfirmed=${fullMarketRetreatConfirmed}`,
    `persistentAnchorDamage=${persistentAnchorDamage}`,
    `broadMarketRejectsRetreat=${broadMarketRejectsRetreat}`,
    healthyDivergence ? "healthyDivergence=true" : "",
    `P=${profitScore == null ? "unknown" : profitScore}`,
    `N=${lossScore == null ? "unknown" : lossScore}`,
    `effectContext=${composite.status}`,
  ]);
  return {
    key,
    label: BIG_CYCLE_LABELS[key],
    status,
    source: authoritySource,
    horizon: fiveDayAuthority.declared ? "rolling_5_trading_days" : "current_plus_exact_t1",
    windowDays: fiveDayAuthority.declared ? 5 : null,
    window: fiveDayAuthority.declared ? fiveDayAuthority.window : null,
    reasonCode,
    reason,
    generationContext: generation.complete ? {
      generationId: generation.generationId,
      tradingDate: generation.tradingDate,
      asOf: generation.asOf,
    } : null,
    generation: {
      complete: generation.complete,
      generationId: generation.generationId,
      tradingDate: generation.tradingDate,
      asOf: generation.asOf,
      source: "emotion_cycle_input",
    },
    evidence,
    composite,
    thresholds: EMOTION_COMPOSITE_THRESHOLDS,
    guardrails: {
      indexAndIndexStructureExcluded: true,
      recommendationCandidatesExcluded: true,
      hotDirectionsExcluded: true,
      dailyStateCannotSetEmotionBigCycle: true,
      intradayCannotAdvanceConfirmedBigCycle: true,
      icePointRequiresRetreatLineageAndLossContraction: true,
      retreatRequiresBroadLossOrCrossDayPersistence: true,
      singleDayMultiAnchorDamageCannotSetRetreat: true,
      fiveDayWindowRequiredForBigCycle: fiveDayAuthority.declared,
      fiveDayWindowGenerationAligned: fiveDayAuthority.declared
        ? fiveDayAuthority.status !== "unavailable" : null,
      calibrated: false,
    },
    transition: {
      from: exactT1 ? previousBig : null,
      to: key,
      changed,
      qualified: fiveDayAuthority.declared ? fiveDayAuthority.confirmed : transitionQualified,
      source: "emotion_hsd_transition",
      reasonCode,
      evidence: transitionEvidence,
    },
  };
}

function buildTomorrowBaseline(state, cycleCondition) {
  const stage = state.current.key;
  const phaseKey = String(state.current.phaseKey || stage || "");
  if (stage === "harmful" || stage === "retreat" || ["retreat", "ice_point"].includes(cycleCondition.key)) {
    return { key: "weaken", label: "防守优先·先控制负反馈", reason: "非良性分歧或退潮条件优先于任何加强预案" };
  }
  if (stage === "support") {
    return { key: "strengthen", label: "承接确认后再加强", reason: "已有真实承接，仍需多锚同步才能升级" };
  }
  if (phaseKey === "strong_divergence") {
    return {
      key: "diverge",
      label: cycleCondition.key === "main_rise" ? "主升内分歧延续优先·先看承接" : "分歧延续优先·先看承接",
      reason: "当前已经处于强分歧，明日先按分歧延续准备；只有真实承接与核心主动修复出现后才升级预案",
    };
  }
  if (stage === "climax" || stage === "acceleration" || stage === "realization") {
    return {
      key: "diverge",
      label: cycleCondition.key === "main_rise" ? "主升内先分歧·承接后再一致" : "兑现优先·先看承接",
      reason: stage === "climax" ? "高潮后的第一预期是兑现，不预设继续加速" : "加速/兑现阶段先检验分歧质量",
    };
  }
  return { key: "diverge", label: "分歧验证优先", reason: "情绪阶段未充分确认，先等待多锚验证" };
}

function buildExecutionPermission(state, cycleCondition, baseline) {
  const stage = state.current.key;
  if (stage === "harmful" || stage === "retreat" || baseline.key === "weaken") {
    return {
      status: "blocked",
      label: "禁止新开仓",
      immediate: false,
      conditional: false,
      immediateEntry: false,
      conditionalAfterSupport: false,
      allowAdd: false,
      forbiddenSetups: ["后排低吸", "高开一致加速", "负反馈扩散中的回封尝试"],
    };
  }
  if (["climax", "acceleration", "realization"].includes(stage)) {
    return {
      status: "wait_for_support",
      label: "先等兑现与承接",
      immediate: false,
      conditional: true,
      immediateEntry: false,
      conditionalAfterSupport: true,
      allowAdd: false,
      forbiddenSetups: ["追一字", "追高潮一致", "用单票回封证明情绪转强"],
    };
  }
  if (stage === "support") {
    return {
      status: "conditional",
      label: "承接确认后条件允许",
      immediate: true,
      conditional: true,
      immediateEntry: true,
      conditionalAfterSupport: true,
      allowAdd: cycleCondition.key === "main_rise",
      forbiddenSetups: ["承接失败后补仓", "追后排扩散"],
    };
  }
  return {
    status: "observe",
    label: "等待情绪锚确认",
    immediate: false,
    conditional: false,
    immediateEntry: false,
    conditionalAfterSupport: false,
    allowAdd: false,
    forbiddenSetups: ["在阶段未知时直接开仓"],
  };
}

function buildTomorrowPaths(state, cycleCondition, baseline) {
  const stage = state.current.key;
  const paths = [
    {
      key: "strengthen",
      label: stage === "support" ? "承接后重新加速" : "情绪继续加强",
      trigger: [
        "至少3个独立样本继续有效，A/B锚不少于2只且覆盖2种角色",
        "已知承接分不下降，非一字核心出现真实换手或回封",
        "伤害分不向更多核心扩散",
      ],
      action: "只做主锚确认或充分换手后的分歧转强，不追一字和后排一致。",
      cancel: ["只剩单票独强", "承接仍为unknown却直接高开加速", "高伤害核心增加"],
    },
    {
      key: "diverge",
      label: stage === "climax" ? "高潮后兑现" : "分歧兑现并验证承接",
      trigger: [
        "高热主锚出现兑现，但高伤害尚未扩散",
        "分歧后至少两只A/B锚守住首次承接位",
        "C层广度没有快速坍缩",
      ],
      action: cycleCondition.key === "main_rise"
        ? "先观察主升内分歧；真实承接成立后才允许重新一致或核心试错。"
        : "先观察兑现质量；只有真实承接成立才允许核心试错。",
      cancel: ["炸板/断板扩散", "容量确认同步转弱", "第三个独立样本转为高伤害"],
    },
    {
      key: "weaken",
      label: stage === "harmful" || stage === "retreat" ? "非良性分歧延续" : "转入非良性分歧/退潮",
      trigger: [
        "至少两只A/B锚进入高伤害区",
        "负反馈由第三个独立样本确认并覆盖2种角色",
        "回封、均价承接和容量确认同时失败",
      ],
      action: "停止新开仓，只处理持仓风险；等待新的跨日承接状态。",
      cancel: ["高伤害收缩且至少两只核心重新形成真实承接"],
    },
  ];
  const rank = baseline.key === "weaken"
    ? ["weaken", "diverge", "strengthen"]
    : baseline.key === "strengthen"
      ? ["strengthen", "diverge", "weaken"]
      : ["diverge", "strengthen", "weaken"];
  return paths.map((path) => ({
    ...path,
    isBaseline: path.key === baseline.key,
    rank: rank.indexOf(path.key) + 1,
  })).sort((left, right) => left.rank - right.rank);
}

function buildEmotionCycleState(input = {}) {
  const source = isObject(input) ? input : {};
  const currentItems = Array.isArray(source.currentItems)
    ? source.currentItems
    : Array.isArray(source.candidates)
      ? source.candidates
      : [];
  const excludedCandidateCodes = excludedRecommendationCodes(source);
  const exactPreviousTradingDayRequested = source.exactPreviousTradingDay === true
    || source.tradingContext && source.tradingContext.exactPreviousTradingDay === true;
  const previousDateIdentity = exactPreviousStateDateIdentity(source, exactPreviousTradingDayRequested);
  const exactPreviousTradingDay = previousDateIdentity.aligned;
  const previous = resolvePreviousState(source, exactPreviousTradingDay);
  const marketContext = buildMarketContext(currentItems, source.tradingContext);
  const anchors = normalizeProfitEffectWeights(normalizeInfluenceWeights(
    currentItems.filter(isObject)
      .map((stock, index) => buildAnchor(stock, index, excludedCandidateCodes, marketContext)),
  )).sort(compareAnchors);
  const state = deriveMarketState(anchors, previous);
  const themeStages = themeStageSummaries(anchors);
  const capacity = capacityConfirmation(anchors);
  const previousBigCycle = previousEmotionBigCycle(source, previous);
  const bigCycle = resolveEmotionBigCycle({
    current: state.current,
    previous,
    previousBigCycle,
    metrics: state.metrics,
    transition: state.transition,
    emotionEffectContext: source.emotionEffectContext,
    emotionBigCycleWindow: source.emotionBigCycleWindow,
    snapshotKind: source.snapshotKind
      || source.tradingContext && source.tradingContext.snapshotKind
      || "unknown",
    generationContext: source.generationContext,
  });
  const cycleCondition = { ...bigCycle };
  const tomorrowBaseline = { ...buildTomorrowBaseline(state, cycleCondition), rank: 1 };
  const executionPermission = buildExecutionPermission(state, cycleCondition, tomorrowBaseline);
  const focusTheme = themeStages.find((row) => ["climax", "acceleration"].includes(row.current.key)) || null;
  if (state.current.key === "climax" && focusTheme) {
    state.current.reason = `高位连板进入加速后段；${focusTheme.name}形成局部一致高潮，${capacity.label}`;
    state.current.focusTheme = focusTheme.name;
    state.current.scope = "high_board_market_with_local_theme";
  }
  const anchorLayers = {
    A: anchors.filter((row) => row.layer === "A"),
    B: anchors.filter((row) => row.layer === "B"),
    C: anchors.filter((row) => row.layer === "C"),
  };
  const trustedSessionCount = currentItems.filter((stock) => initiativeView(stock).trustedSession).length;
  const oneWordCount = anchors.filter((row) => row.current.oneWord).length;
  const notes = [
    "A=情绪主锚，B=容量确认，C=广度样本；题材verified角色不能单独晋级A。",
    "所有股票的状态总分使用同一百分制：人气35+高度25+辨识度15+角色影响15+当日强度10；证据条数不参与计分。",
    "influenceWeightPct按A/B/C层级、跨平台Top100名次与连板空间地位，在独立市场样本内归一为100%。",
    "profitEffectWeightPct与市场影响权重分离：只用可信当日分时或verified+completed的lastSession判断价格发现，换手回封高于一字空间。",
    "一字或无价格发现只贡献热度H，承接C保持unknown。",
    "speculation.expectation仅作位置风险提示，不直接生成情绪阶段。",
    "阶段变化必须满足至少3个独立样本、2种角色和2个A/B锚。",
    previous.available
      ? `已使用${previous.source}作为跨日状态。`
      : "缺少可信T-1情绪状态，不生成“修复/承接”等伪跨日结论。",
  ];

  return {
    version: 4,
    method: "anchor_hcd_state_machine",
    calibrated: false,
    scoreStandard: {
      ...SCORE_STANDARD,
      componentMaximums: { ...SCORE_STANDARD.componentMaximums },
      totalField: "anchorScore",
      weightField: "influenceWeightPct",
      weightNormalizedTotalPct: round(anchors.reduce((sum, row) => sum + row.influenceWeightPct, 0)),
      profitEffectScoreField: "profitEffectScore",
      profitEffectWeightField: "profitEffectWeightPct",
      profitEffectWeightNormalizedTotalPct: round(
        anchors.reduce((sum, row) => sum + row.profitEffectWeightPct, 0),
      ),
    },
    stateLabels: { ...EMOTION_STATE_LABELS },
    current: state.current,
    previous,
    participation: state.participation,
    phaseQuality: state.phaseQuality,
    transition: state.transition,
    metrics: state.metrics,
    anchorLayers,
    rankedAnchors: anchors,
    themeStages,
    marketStructure: {
      highBoard: { ...state.current },
      capacity,
    },
    bigCycle,
    cycleCondition,
    tomorrowBaseline,
    tomorrowPaths: buildTomorrowPaths(state, cycleCondition, tomorrowBaseline),
    executionPermission,
    guardrails: {
      themeRoleAloneCannotPromoteA: true,
      oneWordSupportUnknown: true,
      oneWordCannotConfirmClimax: true,
      divergentHeatCannotConfirmAccelerationOrClimax: true,
      strongDivergenceRequiresMajorityWeakSupportMediumDamage: true,
      postClimaxRequiresExactT1: true,
      multiCoreRepairFailureRequired: true,
      premarketZeroWithoutPriceIsUnknown: true,
      evidenceCountCannotIncreaseScore: true,
      influenceWeightsNormalizedWithinIndependentSamples: true,
      marketImpactAndProfitEffectSeparated: true,
      lastSessionRequiresVerifiedAndCompleted: true,
      speculationExpectationCannotSetStage: true,
      indexRegimeCannotSetEmotionBigCycle: true,
      indexAndIndexStructureExcludedFromEmotionBigCycle: true,
      recommendationCandidatesExcludedFromEmotionBigCycle: true,
      hotDirectionsExcludedFromEmotionBigCycle: true,
      dailyStateCannotSetEmotionBigCycle: true,
      intradayCannotAdvanceConfirmedBigCycle: true,
      firstGenerationCannotSelfBootstrapMainRise: true,
      retreatOrIceSupportReturnsToChaosFirst: true,
      selectedCandidateCannotSelfValidate: true,
      allRecommendationCandidatesExcluded: true,
      minimumIndependentSamples: 3,
      minimumRoleCount: 2,
      minimumPrimaryAnchors: 2,
    },
    dataQuality: {
      exactPreviousTradingDay,
      expectedPreviousTradingDate: previousDateIdentity.expectedPreviousTradingDate,
      currentTradingDate: previousDateIdentity.currentTradingDate,
      previousTradingDate: previousDateIdentity.previousTradingDate,
      previousSnapshotKind: previousDateIdentity.previousSnapshotKind,
      previousEvidenceVerified: previousDateIdentity.previousEvidenceVerified,
      previousStateDateAligned: previousDateIdentity.aligned,
      previousStateAvailable: previous.available,
      trustedSessionCount,
      supportUnknownCount: anchors.filter((row) => row.support.score == null).length,
      oneWordCount,
      priceDiscoveryKnownCount: anchors.filter((row) => row.priceDiscoveryType !== "unknown").length,
      profitEffectEligibleCount: anchors.filter((row) => row.profitEffectWeightPct > 0).length,
      excludedCandidateCodes: [...excludedCandidateCodes],
      notes,
    },
  };
}

module.exports = {
  EMOTION_STATE_LABELS,
  LAYER_LABELS,
  ROLE_LABELS,
  SCORE_STANDARD,
  buildEmotionCycleState,
  resolveEmotionBigCycle,
  parseBoardProfile,
  popularityProfile,
  qualifyPopularCore,
  isOneWordBoard,
};
