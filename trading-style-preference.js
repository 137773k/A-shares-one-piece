"use strict";

/**
 * 纯规则的“炒作偏好”模块。
 *
 * 边界：
 * - 只根据传入快照归纳高位趋势、低位启动、连板情绪三条资金路径；
 * - 不读文件、不读系统时间、不修改输入；
 * - 旧的“板块轮动”标签不能直接生成“轮动回流”结论；
 * - 路径样本和可执行代表案例是两层资格，后者必须通过更严格的硬门槛。
 */

const VERSION = 3;
const PERSISTENCE_VERSION = 1;
const STYLE_CLASSIFIER_VERSION = "trading-style-v3-persistent-t1-cohort";
const STYLE_RULE_SIGNATURE = "highTrend-lowLaunch-boardEmotion|eligibility-v3|t1-feedback-v1";
const EFFECT_WINDOW_DAYS = 5;
const MIN_VALID_EFFECT_DAYS = 3;
const MIN_DAILY_COHORT_SAMPLES = 3;
const MIN_T1_MATCH_COVERAGE = 0.8;
const DEFAULT_RANKING_TARGET = 100;

const PATH_KEYS = Object.freeze(["highTrend", "lowLaunch", "boardEmotion"]);
const PATH_LABELS = Object.freeze({
  highTrend: "高位趋势",
  lowLaunch: "低位启动",
  boardEmotion: "连板情绪",
});

const COMPONENT_WEIGHTS = Object.freeze({
  profitQuality: 35,
  crossDayContinuation: 25,
  breadth: 20,
  coreConfirmation: 20,
});

const MIN_CROSS_SOURCE_SAMPLES = Object.freeze({
  highTrend: 2,
  lowLaunch: 1,
  boardEmotion: 2,
});

const STATUS_LABELS = Object.freeze({
  active: "成立",
  candidate: "候选观察",
  weak: "未成立",
  unknown: "数据待确认",
});

const STAGE_LABELS = Object.freeze({
  trend_acceleration: "趋势加速",
  trend_continuation: "趋势延续",
  trend_active: "趋势活跃",
  launching: "启动",
  fermenting: "发酵",
  launch_continuation: "延续",
  emotion_climax: "加速/高潮",
  emotion_acceleration: "加速",
  emotion_active: "活跃",
  divergence: "分歧",
  unconfirmed: "待确认",
});

const UNKNOWN_CONCEPT = /^(?:--|unknown|未知|未归类|其他|待确认|无明显主线)$/i;
const BAD_REPRESENTATIVE_ROLE = /后排|跟风|普通跟随|地位待确认/;
const CORE_ROLE = /龙头|先锋|中军|核心|主动/;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 1) {
  const number = finiteNumber(value);
  if (number === null) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function mean(values) {
  const known = values.map(finiteNumber).filter((value) => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
}

function median(values) {
  const known = values.map(finiteNumber).filter((value) => value !== null).sort((a, b) => a - b);
  if (!known.length) return null;
  const middle = Math.floor(known.length / 2);
  return known.length % 2 ? known[middle] : (known[middle - 1] + known[middle]) / 2;
}

function ratio(count, total) {
  return total > 0 ? count / total : null;
}

function normalizeDate(value) {
  const digits = String(value == null ? "" : value).replace(/\D/g, "");
  if (digits.length !== 8) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function stockCode(stock) {
  return String(stock && (stock.code || stock.stockCode || stock.symbol || stock.secCode) || "").trim();
}

function stockName(stock) {
  return String(stock && (stock.name || stock.stockName) || "").trim();
}

function stockKey(stock, index = 0) {
  return stockCode(stock) || stockName(stock) || `stock-${index + 1}`;
}

function dedupeRows(rows) {
  const seen = new Set();
  const result = [];
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    if (!isObject(row)) return;
    const key = stockKey(row, index);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(row);
  });
  return result;
}

function makeLookup(rows) {
  const map = new Map();
  dedupeRows(rows).forEach((row, index) => {
    const code = stockCode(row);
    const name = stockName(row);
    if (code) map.set(`code:${code}`, row);
    if (name) map.set(`name:${name}`, row);
    if (!code && !name) map.set(`index:${index}`, row);
  });
  return map;
}

function findInLookup(map, stock) {
  const code = stockCode(stock);
  const name = stockName(stock);
  return (code && map.get(`code:${code}`)) || (name && map.get(`name:${name}`)) || null;
}

function resolveCandidateRows(payload) {
  // 全市场风格只读取 Hot Top100 合并候选全集。selected / bestPicks / 题材预选池
  // 属于下游决策结果，不能反向加入样本并自证某种市场风格。
  // 精确T-1涨停池补入的 previousLimitUpOnly 股票只服务个股纠偏观察，
  // 不能反向参与当日市场风格归纳，否则会形成样本自证。
  const candidates = Array.isArray(payload && payload.candidates) ? payload.candidates : [];
  return dedupeRows(candidates.filter((candidate) => (
    isObject(candidate) && candidate.previousLimitUpOnly !== true
  )));
}

function validPopularityRank(value, target = DEFAULT_RANKING_TARGET) {
  const rank = finiteNumber(value);
  return rank !== null && rank >= 1 && rank <= target;
}

function rankingMembership(stock, targets = {}) {
  const eastTarget = finiteNumber(targets.eastmoney) || DEFAULT_RANKING_TARGET;
  const thsTarget = finiteNumber(targets.ths) || DEFAULT_RANKING_TARGET;
  const eastmoney = validPopularityRank(stock && stock.eastRank, eastTarget);
  const ths = validPopularityRank(stock && stock.thsRank, thsTarget);
  return {
    eastmoney,
    ths,
    crossListed: eastmoney && ths,
  };
}

function hasUsableLiveQuote(stock) {
  if (!isObject(stock)) return false;
  if (stock.quoteAvailable === true || stock.liveQuoteAvailable === true) return true;
  if (stock.quoteAvailable === false || stock.liveQuoteAvailable === false) return false;
  const price = finiteNumber(stock.price);
  if (price !== null && price > 0) return true;
  const activityFields = [stock.open, stock.high, stock.low, stock.amountYi, stock.volumeRatio, stock.mainInflowYi]
    .map(finiteNumber);
  if (activityFields.some((value) => value !== null && value !== 0)) return true;
  const changePct = changePctOf(stock);
  // 盘前接口常用0占位，同时 price/open/high/low/amount 均为空；这种0不是有效涨跌幅。
  return changePct !== null && changePct !== 0;
}

function hasUsableClosingSession(stock, leadership) {
  const session = sessionOf(stock, leadership);
  return finiteNumber(session.currentChangePct) !== null
    && Boolean(String(session.tradingDate || "").trim() || String(session.asOf || "").trim());
}

function normalizedStrengthFromChange(stock, changePct) {
  const change = finiteNumber(changePct);
  if (change === null) return null;
  return clamp(50 + (change / priceLimitPct(stock)) * 50, 0, 100);
}

function rankingTargetOf(payload, sourceKey) {
  const targets = isObject(payload && payload.rankingTargets)
    ? payload.rankingTargets
    : isObject(payload && payload.sourceTargets)
      ? payload.sourceTargets
      : {};
  return finiteNumber(targets[sourceKey]) || DEFAULT_RANKING_TARGET;
}

function buildSampleUniverse(payload, rows) {
  const sources = isObject(payload && payload.sources) ? payload.sources : {};
  const hotRankSources = isObject(sources.hotRanks) ? sources.hotRanks : {};
  const sourcePhases = [hotRankSources.eastmoney, hotRankSources.ths]
    .filter(isObject)
    .map((source) => String(source.observationPhase || "").trim().toLowerCase())
    .filter(Boolean);
  const observationPhase = sourcePhases.includes("intraday")
    ? "intraday"
    : sourcePhases.includes("preopen")
      ? "preopen"
      : sourcePhases.includes("closing") || sourcePhases.includes("postclose")
        ? "closing"
        : "unknown";
  const targets = {
    eastmoney: rankingTargetOf(payload, "eastmoney"),
    ths: rankingTargetOf(payload, "ths"),
  };
  const memberships = rows.map((row) => rankingMembership(row.stock, targets));
  const observedEast = memberships.filter((item) => item.eastmoney).length;
  const observedThs = memberships.filter((item) => item.ths).length;
  const declaredEast = finiteNumber(sources.eastmoney);
  const declaredThs = finiteNumber(sources.ths);
  const sourceReported = declaredEast !== null || declaredThs !== null;
  const rankFieldsReported = observedEast > 0 || observedThs > 0;
  const eastCount = Math.max(0, declaredEast ?? 0, observedEast);
  const thsCount = Math.max(0, declaredThs ?? 0, observedThs);
  const crossListedCount = memberships.filter((item) => item.crossListed).length;
  const unionCount = rows.length;
  const combinedCoveragePct = sourceReported || rankFieldsReported
    ? round(mean([
      clamp(eastCount / targets.eastmoney, 0, 1) * 100,
      clamp(thsCount / targets.ths, 0, 1) * 100,
    ]))
    : null;
  let rankingsState = "unreported";
  let rankingsLabel = "榜单样本口径未上报";
  if (sourceReported || rankFieldsReported) {
    if (eastCount <= 0 && thsCount <= 0) {
      rankingsState = "pending";
      rankingsLabel = "两路热榜尚未抓到有效样本";
    } else if (eastCount <= 0 || thsCount <= 0) {
      rankingsState = "single_source";
      rankingsLabel = "仅一路热榜有样本，等待另一路补齐";
    } else if (eastCount < targets.eastmoney || thsCount < targets.ths) {
      rankingsState = "partial";
      rankingsLabel = `热榜已抓取但未达到双榜Top${Math.max(targets.eastmoney, targets.ths)}目标`;
    } else {
      rankingsState = "ready";
      rankingsLabel = `双榜Top${Math.max(targets.eastmoney, targets.ths)}样本已就绪`;
    }
  }
  const quoteKnownCount = rows.filter((row) => hasUsableLiveQuote(row.stock)).length;
  const quoteCoveragePct = unionCount ? round((quoteKnownCount / unionCount) * 100) : null;
  const quoteState = !unionCount
    ? "unavailable"
    : quoteKnownCount === 0
      ? "pending"
      : quoteKnownCount < unionCount
        ? "partial"
        : "ready";
  return {
    targetPerSource: { ...targets },
    east: eastCount,
    ths: thsCount,
    union: unionCount,
    intersection: crossListedCount,
    eastmoneyCount: eastCount,
    thsCount,
    unionCount,
    crossListedCount,
    crossListedRatePct: unionCount ? round((crossListedCount / unionCount) * 100) : null,
    combinedCoveragePct,
    rankingsState,
    rankingsLabel,
    quoteState,
    quoteUsable: quoteKnownCount,
    quotePending: Math.max(0, unionCount - quoteKnownCount),
    quoteKnownCount,
    quoteCoveragePct,
    observationPhase,
    note: "榜单样本覆盖率与行情报价覆盖率只描述输入完整度，均不是结论置信度。",
  };
}

function carrierMembership(pathKey, row) {
  if (pathKey === "highTrend") return highTrendCarrierEligibility(row);
  if (pathKey === "lowLaunch") return lowLaunchEligibility(row);
  return boardEmotionEligibility(row);
}

function buildEligibleCarriers(paths, allRows) {
  const byPath = {};
  const qualifiedByPath = {};
  const all = new Set();
  PATH_KEYS.forEach((pathKey) => {
    const rows = paths[pathKey].status === "active"
      ? allRows.filter((row) => carrierMembership(pathKey, row))
      : [];
    const pathCodes = new Set();
    const qualified = [];
    rows.forEach((row) => {
      const qualification = qualificationForRepresentative(row);
      if (!qualification.pass) return;
      const code = stockCode(row.stock);
      if (!code) return;
      pathCodes.add(code);
      all.add(code);
      qualified.push({ row, qualification });
    });
    byPath[pathKey] = [...pathCodes];
    qualifiedByPath[pathKey] = qualified;
  });
  return { byPath, codes: [...all], qualifiedByPath };
}

function resolveLeadershipRows(payload) {
  const board = isObject(payload && payload.leadershipBoard) ? payload.leadershipBoard : {};
  return dedupeRows([
    ...(Array.isArray(board.tradeCarriers) ? board.tradeCarriers : []),
    ...(Array.isArray(board.leaders) ? board.leaders : []),
    ...(Array.isArray(board.observations) ? board.observations : []),
  ]);
}

// “10天6板”表示窗口内活跃度，不等于6连板；只有首板、N连板、X天X板
// 或明确的数字型连续板字段，才可写入 consecutiveBoards。
function parseBoardSignal(value) {
  const direct = finiteNumber(value);
  if (direct !== null) {
    return { consecutiveBoards: Math.max(0, Math.round(direct)), boardsInWindow: null };
  }
  const text = String(value == null ? "" : value).trim();
  if (!text) return { consecutiveBoards: null, boardsInWindow: null };
  if (text.includes("首板")) return { consecutiveBoards: 1, boardsInWindow: null };
  const consecutive = text.match(/(\d+)\s*连板/);
  if (consecutive) {
    return { consecutiveBoards: Number(consecutive[1]), boardsInWindow: null };
  }
  const window = text.match(/(\d+)\s*天\s*(\d+)\s*板/);
  if (window) {
    const days = Number(window[1]);
    const boards = Number(window[2]);
    return {
      consecutiveBoards: days === boards ? boards : null,
      boardsInWindow: { days, boards },
    };
  }
  return { consecutiveBoards: null, boardsInWindow: null };
}

function resolveLimitPoolMap(payload) {
  const market = isObject(payload && payload.market) ? payload.market : {};
  const limitStats = isObject(market.limitStats) ? market.limitStats : {};
  const map = new Map();
  (Array.isArray(limitStats.pool) ? limitStats.pool : []).forEach((item) => {
    if (!isObject(item)) return;
    const signal = {
      ...parseBoardSignal(item.highDays || item.boards || item.boardCount),
      matched: true,
      source: "verified_limit_pool",
    };
    const code = stockCode(item);
    const name = stockName(item);
    if (code) map.set(`code:${code}`, signal);
    if (name) map.set(`name:${name}`, signal);
  });
  return map;
}

function boardSignalOf(stock, limitPoolMap) {
  const code = stockCode(stock);
  const name = stockName(stock);
  const codeKey = code && `code:${code}`;
  const nameKey = name && `name:${name}`;
  const poolSignal = codeKey && limitPoolMap.has(codeKey)
    ? limitPoolMap.get(codeKey)
    : nameKey && limitPoolMap.has(nameKey)
      ? limitPoolMap.get(nameKey)
      : null;
  const stockSignals = [
    stock && stock.consecutiveBoards,
    stock && stock.continuousLimitCount,
    stock && stock.limitBoardCount,
    stock && stock.boardCount,
    stock && stock.popularity,
    stock && stock.speculation && stock.speculation.boards,
  ].map(parseBoardSignal);
  const stockConsecutive = stockSignals
    .map((signal) => signal.consecutiveBoards)
    .filter((value) => value !== null);
  const windows = [poolSignal, ...stockSignals]
    .filter(Boolean)
    .map((signal) => signal.boardsInWindow)
    .filter(Boolean)
    .sort((left, right) => right.boards - left.boards || left.days - right.days);
  const poolHasBoardLabel = Boolean(poolSignal) && (
    poolSignal.consecutiveBoards !== null || poolSignal.boardsInWindow !== null
  );
  const consecutiveBoards = poolSignal && poolSignal.consecutiveBoards !== null
    ? poolSignal.consecutiveBoards
    : poolHasBoardLabel
      ? null
      : stockConsecutive.length
        ? Math.max(...stockConsecutive)
        : null;
  return {
    consecutiveBoards,
    boardsInWindow: windows[0] || null,
    limitPoolMatched: Boolean(poolSignal && poolSignal.matched),
    source: poolSignal && poolSignal.matched ? poolSignal.source : "stock_label",
  };
}

function profileOf(stock) {
  return isObject(stock && stock.klineProfile) ? stock.klineProfile : {};
}

function initiativeOf(stock, leadership) {
  if (isObject(leadership && leadership.initiative)) return leadership.initiative;
  if (isObject(stock && stock.leadership && stock.leadership.initiative)) return stock.leadership.initiative;
  return {};
}

function structureOf(stock, leadership) {
  if (isObject(leadership && leadership.structure)) return leadership.structure;
  if (isObject(stock && stock.leadership && stock.leadership.structure)) return stock.leadership.structure;
  return profileOf(stock);
}

function priceLimitPct(stock) {
  const explicit = finiteNumber(stock && (stock.priceLimitPct || stock.limitPct || stock.dailyLimitPct));
  if (explicit !== null && explicit > 0) return explicit;
  const name = stockName(stock).toUpperCase();
  if (/\bST\b|\*ST/.test(name)) return 5;
  const code = stockCode(stock).replace(/\D/g, "");
  if (/^(?:300|301|688)/.test(code)) return 20;
  if (/^(?:4|8)/.test(code)) return 30;
  return 10;
}

function changePctOf(stock) {
  return finiteNumber(stock && (stock.changePct ?? stock.pctChange ?? stock.change));
}

function normalizedDailyStrength(stock) {
  const changePct = changePctOf(stock);
  return normalizedStrengthFromChange(stock, changePct);
}

function sessionOf(stock, leadership) {
  const initiative = initiativeOf(stock, leadership);
  return isObject(initiative.session) ? initiative.session : {};
}

function closedAtLimit(stock, leadership, boardCount) {
  const session = sessionOf(stock, leadership);
  if (typeof session.closedAtLimit === "boolean") return session.closedAtLimit;
  if (typeof stock.closedAtLimit === "boolean") return stock.closedAtLimit;
  if (typeof stock.isLimitUp === "boolean") return stock.isLimitUp;
  const changePct = changePctOf(stock);
  return changePct !== null && boardCount !== null && boardCount >= 1
    ? changePct >= priceLimitPct(stock) * 0.94
    : false;
}

function priorSessionClosedAtLimit(row) {
  return Boolean(
    row
      && row.limitPoolMatched
      && row.boardCount !== null
      && row.boardCount >= 1,
  );
}

function rowClosedAtLimit(row) {
  if (!row) return false;
  return hasUsableLiveQuote(row.stock)
    ? closedAtLimit(row.stock, row.leadership, row.boardCount)
    : priorSessionClosedAtLimit(row);
}

function highOpenLowClose(stock, leadership) {
  const session = sessionOf(stock, leadership);
  const open = finiteNumber(session.openChangePct);
  const current = finiteNumber(session.currentChangePct) ?? changePctOf(stock);
  return open !== null && current !== null && open - current >= 4;
}

function severeNegative(stock, leadership) {
  const changePct = changePctOf(stock);
  const structure = structureOf(stock, leadership);
  if (changePct !== null && changePct <= -priceLimitPct(stock) * 0.5) return true;
  return changePct !== null && changePct < 0 && structure.breakdown === true;
}

function failedReseal(stock, leadership) {
  const session = sessionOf(stock, leadership);
  return session.limitTouched === true
    && session.closedAtLimit === false
    && session.resealedAfterOpen !== true;
}

function conceptText(value) {
  if (isObject(value)) return String(value.name || value.label || value.concept || "").trim();
  return String(value == null ? "" : value).trim();
}

function normalizeConcept(value) {
  return conceptText(value)
    .replace(/[\s·・_/\\()（）-]+/g, "")
    .replace(/概念$/g, "")
    .toLowerCase();
}

function realConcepts(stock) {
  const values = [
    stock && stock.mainConcept,
    stock && stock.mainFamily,
    stock && stock.concept,
    stock && stock.topic,
    ...(Array.isArray(stock && stock.concepts) ? stock.concepts : []),
  ];
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const label = conceptText(value);
    const normalized = normalizeConcept(label);
    if (!label || !normalized || UNKNOWN_CONCEPT.test(label) || seen.has(normalized)) return;
    seen.add(normalized);
    result.push({ label, normalized });
  });
  return result;
}

function conceptsMatch(stockConcepts, leadershipConcept) {
  const normalizedLeadership = normalizeConcept(leadershipConcept);
  if (!normalizedLeadership) return true;
  return stockConcepts.some(({ normalized }) => (
    normalized === normalizedLeadership
    || normalized.includes(normalizedLeadership)
    || normalizedLeadership.includes(normalized)
  ));
}

function leadershipHistoryAppearances(stock, leadership) {
  const values = [
    leadership && leadership.history && leadership.history.appearances,
    leadership && leadership.historyHits,
    stock && stock.historyHits,
    stock && stock.leadership && stock.leadership.history && stock.leadership.history.appearances,
  ].map(finiteNumber).filter((value) => value !== null);
  return values.length ? Math.max(...values) : null;
}

function isCoreLike(stock, leadership) {
  const roleText = [
    stock && stock.role,
    stock && stock.ticketType,
    leadership && leadership.identity,
    leadership && leadership.levelLabel,
    leadership && leadership.anchorType,
  ].map((value) => String(value || "")).join(" ");
  return leadership && (
    leadership.coreQualified === true
    || leadership.tradeQualified === true
    || leadership.coreIdentityQualified === true
    || leadership.repairCoreQualified === true
  ) || CORE_ROLE.test(roleText);
}

function isCapacityLike(stock, leadership) {
  const initiative = initiativeOf(stock, leadership);
  const amountYi = finiteNumber(stock && stock.amountYi);
  const text = `${stock && stock.ticketType || ""} ${stock && stock.role || ""} ${leadership && leadership.identity || ""}`;
  return initiative.capacity === true || amountYi !== null && amountYi >= 20 || /容量|中军/.test(text);
}

function isPioneerLike(stock, leadership) {
  const text = `${stock && stock.role || ""} ${leadership && leadership.identity || ""} ${leadership && leadership.levelLabel || ""}`;
  const popularityRank = finiteNumber(stock && (stock.combinedRank ?? stock.eastRank));
  return /先锋|龙头|主动/.test(text)
    || leadership && leadership.coreQualified === true
    || initiativeOf(stock, leadership).proactive === true && popularityRank !== null && popularityRank <= 20;
}

function structureBroken(stock, leadership) {
  const profile = profileOf(stock);
  const structure = structureOf(stock, leadership);
  return structure.breakdown === true || profile.structureBreak === true;
}

function highTrendStructureAssessment(row, options = {}) {
  const { stock, leadership, boardCount } = row;
  const profile = profileOf(stock);
  const structure = structureOf(stock, leadership);
  const pctFromHigh = finiteNumber(profile.pctFromHigh);
  const retraceOfRunupPct = finiteNumber(profile.retraceOfRunupPct);
  const rise20 = finiteNumber(profile.rise20);
  const price = finiteNumber(profile.lastClose) ?? finiteNumber(stock && stock.price)
    ?? finiteNumber(stock && stock.close);
  const ma5 = finiteNumber(profile.ma5);
  const ma10 = finiteNumber(profile.ma10);
  const ma20 = finiteNumber(profile.ma20);
  const ma60 = finiteNumber(profile.ma60);
  const rise10 = finiteNumber(profile.rise10);
  const appearances = leadershipHistoryAppearances(stock, leadership);
  const structureDataComplete = [price, pctFromHigh, retraceOfRunupPct, ma5, ma10, ma20, ma60]
    .every((value) => value !== null);
  const nearLongTermHigh = pctFromHigh !== null && pctFromHigh <= 18;
  const shallowRetrace = retraceOfRunupPct !== null && retraceOfRunupPct <= 40;
  const shortTrendAligned = price !== null && ma5 !== null && ma10 !== null && ma20 !== null
    && price >= ma20 && ma5 >= ma10 && ma10 >= ma20;
  const mediumTrendSupported = price !== null && ma20 !== null && ma60 !== null
    && price >= ma60 * 0.98 && ma20 >= ma60 * 0.92;
  const trendHealthy = profile.ma5Rising === true && shortTrendAligned && mediumTrendSupported;
  const deepRepair = pctFromHigh !== null && pctFromHigh > 20
    || retraceOfRunupPct !== null && retraceOfRunupPct > 40
    || price !== null && ma60 !== null && price < ma60 * 0.98;
  const accumulated = rise20 !== null && rise20 >= 12;
  const persistent = leadership && leadership.persistentRecognition === true
    || stock && stock.leadership && stock.leadership.persistentRecognition === true
    || appearances !== null && appearances >= 2
    || boardCount === 0 && rise10 !== null && rise10 >= 15;
  const boardPass = options.allowMultiBoard === true || !(boardCount !== null && boardCount >= 2);
  const pass = boardPass
    && !structureBroken(stock, leadership)
    && structureDataComplete
    && nearLongTermHigh
    && shallowRetrace
    && trendHealthy
    && accumulated
    && persistent
    && structure.chipPressure !== true
    && isCapacityLike(stock, leadership);
  return {
    pass,
    deepRepair,
    structureDataComplete,
    nearLongTermHigh,
    shallowRetrace,
    shortTrendAligned,
    mediumTrendSupported,
    trendHealthy,
    accumulated,
    persistent,
    boardPass,
  };
}

function highTrendEligibility(row) {
  return highTrendStructureAssessment(row).pass;
}

// 路径计分仍保持样本分治，但交易载体可具有多重身份：
// 一只已有趋势、同时进入连板的核心，可同时服务 highTrend 与 boardEmotion。
function highTrendCarrierEligibility(row) {
  return highTrendStructureAssessment(row, { allowMultiBoard: true }).pass;
}

function highTrendAssociation(row) {
  const { stock, leadership, boardCount } = row;
  const profile = profileOf(stock);
  const pctFromHigh = finiteNumber(profile.pctFromHigh);
  const retraceOfRunupPct = finiteNumber(profile.retraceOfRunupPct);
  const price = finiteNumber(profile.lastClose) ?? finiteNumber(stock && stock.price)
    ?? finiteNumber(stock && stock.close);
  const ma5 = finiteNumber(profile.ma5);
  const ma10 = finiteNumber(profile.ma10);
  const ma20 = finiteNumber(profile.ma20);
  const appearances = leadershipHistoryAppearances(stock, leadership);
  const persistent = leadership && leadership.persistentRecognition === true
    || stock && stock.leadership && stock.leadership.persistentRecognition === true
    || appearances !== null && appearances >= 2;
  const trendLike = profile.ma5Rising === true
    && price !== null && ma5 !== null && ma10 !== null && ma20 !== null
    && price >= ma20 && ma5 >= ma10;
  const repairNotDeep = pctFromHigh !== null && pctFromHigh <= 25
    && retraceOfRunupPct !== null && retraceOfRunupPct <= 50;
  return !(boardCount !== null && boardCount >= 2)
    && isCapacityLike(stock, leadership)
    && repairNotDeep
    && trendLike
    && persistent;
}

function lowLaunchEligibility(row) {
  const { stock, leadership, boardCount } = row;
  if (boardCount !== 1 || !rowClosedAtLimit(row)) return false;
  const profile = profileOf(stock);
  const rise20 = finiteNumber(profile.rise20);
  const pctFromHigh = finiteNumber(profile.pctFromHigh);
  const lowPositionKnown = rise20 !== null || pctFromHigh !== null;
  const lowPosition = rise20 !== null ? rise20 <= 35 : pctFromHigh !== null && pctFromHigh >= 15;
  const volumeRatio = finiteNumber(stock.volumeRatio);
  const mainInflowYi = finiteNumber(stock.mainInflowYi);
  const volumeKnown = typeof profile.volumeBreakout === "boolean" || volumeRatio !== null || mainInflowYi !== null;
  const volumeConfirmed = profile.volumeBreakout === true
    || volumeRatio !== null && volumeRatio >= 1.2
    || mainInflowYi !== null && mainInflowYi > 0;
  const appearances = leadershipHistoryAppearances(stock, leadership);
  const fresh = appearances === null || appearances <= 1;
  return lowPositionKnown && lowPosition && volumeKnown && volumeConfirmed && fresh;
}

function lowLaunchAssociation(row) {
  const { stock, leadership, boardCount } = row;
  if (boardCount !== 1) return false;
  const profile = profileOf(stock);
  const rise20 = finiteNumber(profile.rise20);
  const pctFromHigh = finiteNumber(profile.pctFromHigh);
  const lowPosition = rise20 !== null ? rise20 <= 40 : pctFromHigh !== null && pctFromHigh >= 12;
  const session = sessionOf(stock, leadership);
  return lowPosition && (
    session.limitTouched === true
    || hasUsableLiveQuote(stock)
    || priorSessionClosedAtLimit(row)
  );
}

function boardEmotionEligibility(row) {
  return row.boardCount !== null && row.boardCount >= 2;
}

function boardEmotionAssociation(row) {
  return row.boardCount !== null && row.boardCount >= 2;
}

function exactPreviousContext(payload, previousPayload) {
  const currentMarket = isObject(payload && payload.market) ? payload.market : {};
  const currentLimit = isObject(currentMarket.limitStats) ? currentMarket.limitStats : {};
  const currentDates = isObject(currentLimit.dates) ? currentLimit.dates : {};
  const previousMarket = isObject(previousPayload && previousPayload.market) ? previousPayload.market : {};
  const previousLimit = isObject(previousMarket.limitStats) ? previousMarket.limitStats : {};
  const previousDates = isObject(previousLimit.dates) ? previousLimit.dates : {};
  const archiveMeta = isObject(previousPayload && previousPayload.archiveMeta) ? previousPayload.archiveMeta : {};
  const expected = currentDates.verified === true ? normalizeDate(currentDates.prev) : "";
  const actual = normalizeDate(archiveMeta.tradingDate || previousDates.today);
  const kind = String(archiveMeta.snapshotKind || "").toLowerCase();
  return {
    exact: Boolean(expected && actual && expected === actual && kind === "closing"),
    expectedDate: expected || null,
    actualDate: actual || null,
    snapshotKind: kind || null,
  };
}

function inferredPreviousChange(stock) {
  const profile = profileOf(stock);
  const rise2 = finiteNumber(profile.rise2);
  const today = changePctOf(stock);
  if (rise2 === null || today === null || today <= -99.9) return null;
  const previous = ((1 + rise2 / 100) / (1 + today / 100) - 1) * 100;
  return Number.isFinite(previous) ? previous : null;
}

function continuationForRow(row, pathKey, previousLookup, previousContext) {
  // 首板是低位启动的 T0，不能用 rise2 或昨日平盘冒充“启动已跨日延续”。
  if (pathKey === "lowLaunch") return { score: null, source: "missing" };

  const previous = previousContext.exact ? findInLookup(previousLookup, row.stock) : null;
  if (previous && changePctOf(previous) !== null) {
    const previousStrength = normalizedDailyStrength(previous);
    const currentStrength = normalizedDailyStrength(row.stock);
    return {
      score: round(mean([previousStrength, currentStrength])),
      source: "exact_t1_closing_archive",
    };
  }

  if (pathKey === "boardEmotion" && row.boardCount !== null && row.boardCount >= 2) {
    return {
      score: clamp(62 + row.boardCount * 5, 0, 96),
      source: "multi_board_proxy",
    };
  }

  const previousChange = inferredPreviousChange(row.stock);
  if (previousChange !== null) {
    return {
      score: clamp(50 + (previousChange / priceLimitPct(row.stock)) * 50, 0, 100),
      source: "rise2_mathematical_proxy",
    };
  }

  const profile = profileOf(row.stock);
  const appearances = leadershipHistoryAppearances(row.stock, row.leadership);
  if (pathKey === "highTrend" && (profile.ma5Rising === true || appearances !== null && appearances >= 2)) {
    return {
      score: profile.ma5Rising === true && appearances !== null && appearances >= 2 ? 78 : 68,
      source: "trend_or_recognition_proxy",
    };
  }

  return { score: null, source: "missing" };
}

function component(score, evidence, source = "derived") {
  const known = finiteNumber(score) !== null;
  return {
    score: known ? round(clamp(score, 0, 100)) : null,
    status: known ? "known" : "unknown",
    source: known ? source : "missing",
    evidence: String(evidence || (known ? "已获得可判定数据" : "数据待确认")),
  };
}

function profitObservation(row) {
  if (hasUsableLiveQuote(row.stock)) {
    const strength = normalizedDailyStrength(row.stock);
    if (strength === null) return null;
    return {
      strength,
      positive: changePctOf(row.stock) > 0,
      closedAtLimit: closedAtLimit(row.stock, row.leadership, row.boardCount),
      source: "live_quote",
    };
  }
  if (hasUsableClosingSession(row.stock, row.leadership)) {
    const session = sessionOf(row.stock, row.leadership);
    const changePct = finiteNumber(session.currentChangePct);
    return {
      strength: normalizedStrengthFromChange(row.stock, changePct),
      positive: changePct > 0,
      closedAtLimit: session.closedAtLimit === true,
      source: "closing_intraday_archive",
    };
  }
  if (priorSessionClosedAtLimit(row)) {
    return {
      strength: 100,
      positive: true,
      closedAtLimit: true,
      source: "verified_limit_pool",
    };
  }
  return null;
}

function profitComponent(rows, pathKey) {
  const observations = rows.map(profitObservation).filter(Boolean);
  if (!observations.length) return component(null, "盘前报价待形成，0%占位不计入赚钱质量");
  const strengths = observations.map((item) => item.strength);
  const medianStrength = median(strengths);
  const positiveRate = ratio(observations.filter((item) => item.positive).length, observations.length);
  const limitRate = ratio(observations.filter((item) => item.closedAtLimit).length, observations.length);
  const weights = pathKey === "highTrend"
    ? { median: 0.7, positive: 0.3, limit: 0 }
    : pathKey === "lowLaunch"
      ? { median: 0.5, positive: 0.25, limit: 0.25 }
      : { median: 0.4, positive: 0.2, limit: 0.4 };
  const score = medianStrength * weights.median
    + positiveRate * 100 * weights.positive
    + limitRate * 100 * weights.limit;
  return component(
    score,
    `${observations.length}只有效样本，上涨${Math.round(positiveRate * 100)}%，封板${Math.round(limitRate * 100)}%`,
    observations.every((item) => item.source === "live_quote")
      ? "live_quote"
      : observations.every((item) => item.source === "closing_intraday_archive")
        ? "closing_intraday_archive"
        : observations.every((item) => item.source === "verified_limit_pool")
          ? "closing_limit_pool"
          : "closing_evidence",
  );
}

function continuationComponent(rows, pathKey, previousLookup, previousContext) {
  const items = rows.map((row) => continuationForRow(row, pathKey, previousLookup, previousContext));
  const known = items.filter((item) => item.score !== null);
  if (!known.length) return component(null, "跨日待确认");
  const exactCount = known.filter((item) => item.source === "exact_t1_closing_archive").length;
  const source = exactCount === known.length ? "exact_t1_closing_archive" : "cross_day_proxy";
  const evidence = exactCount
    ? `${exactCount}只样本命中精确T-1收盘，共${known.length}只有跨日证据`
    : `${known.length}只样本仅有连板/rise2/趋势代理证据`;
  return component(mean(known.map((item) => item.score)), evidence, source);
}

function breadthComponent(rows, pathKey) {
  const count = rows.length;
  if (!count) return component(null, "缺少独立样本");
  let score;
  if (pathKey === "lowLaunch") score = count >= 6 ? 100 : count === 5 ? 92 : count === 4 ? 84 : count === 3 ? 72 : count === 2 ? 48 : 25;
  else score = count >= 6 ? 100 : count === 5 ? 94 : count === 4 ? 86 : count === 3 ? 76 : count === 2 ? 62 : 30;
  if (pathKey === "boardEmotion") {
    const levels = new Set(rows.map((row) => row.boardCount).filter((value) => value !== null)).size;
    score = clamp(score + Math.max(0, levels - 1) * 3, 0, 100);
    return component(score, `${count}只独立样本，${levels}个连板高度层级`);
  }
  return component(score, `${count}只独立有效样本`);
}

function coreComponent(rows, pathKey) {
  if (!rows.length) return component(null, "缺少样本");
  const knownRoleCount = rows.filter((row) => (
    String(row.stock.role || row.stock.ticketType || "")
    || Object.keys(row.leadership || {}).length
  )).length;
  if (!knownRoleCount) return component(null, "核心身份待确认");
  const cores = rows.filter((row) => isCoreLike(row.stock, row.leadership));
  const proactive = rows.filter((row) => initiativeOf(row.stock, row.leadership).proactive === true);
  const capacity = rows.filter((row) => isCapacityLike(row.stock, row.leadership));
  const pioneers = rows.filter((row) => isPioneerLike(row.stock, row.leadership));
  let score = ratio(cores.length, rows.length) * 55 + ratio(proactive.length, rows.length) * 25;
  if (pathKey === "lowLaunch") score += pioneers.length > 0 ? 10 : 0;
  else score += capacity.length > 0 ? 10 : 0;
  score += cores.length >= 2 ? 10 : 0;
  const structureText = pathKey === "lowLaunch"
    ? `先锋${pioneers.length}只，容量${capacity.length}只`
    : `核心${cores.length}只，主动${proactive.length}只`;
  return component(score, `${structureText}，角色数据覆盖${knownRoleCount}/${rows.length}`);
}

function negativePenalty(rows) {
  const priced = rows.filter((row) => (
    hasUsableLiveQuote(row.stock)
    || hasUsableClosingSession(row.stock, row.leadership)
  ));
  if (!rows.length || !priced.length) {
    return { score: null, status: "unknown", evidence: "盘前分时/报价未形成，负反馈待确认" };
  }
  const severe = priced.filter((row) => {
    if (hasUsableLiveQuote(row.stock)) return severeNegative(row.stock, row.leadership);
    const sessionChange = finiteNumber(sessionOf(row.stock, row.leadership).currentChangePct);
    const structure = structureOf(row.stock, row.leadership);
    return sessionChange !== null && (
      sessionChange <= -priceLimitPct(row.stock) * 0.5
      || sessionChange < 0 && structure.breakdown === true
    );
  }).length;
  const failed = priced.filter((row) => failedReseal(row.stock, row.leadership)).length;
  const faded = priced.filter((row) => highOpenLowClose(row.stock, row.leadership)).length;
  const score = clamp(
    (severe / priced.length) * 22
      + (failed / priced.length) * 12
      + (faded / priced.length) * 8,
    0,
    30,
  );
  return {
    score: round(score),
    status: "known",
    evidence: `严重负反馈${severe}只，炸板不回封${failed}只，高开低走${faded}只`,
  };
}

function aggregateScore(components, penalty) {
  let weighted = 0;
  let coverage = 0;
  Object.entries(COMPONENT_WEIGHTS).forEach(([key, weight]) => {
    const score = finiteNumber(components[key] && components[key].score);
    if (score === null) return;
    weighted += score * weight;
    coverage += weight;
  });
  if (coverage < 55) return { score: null, coverage };
  const raw = weighted / coverage;
  const deduction = finiteNumber(penalty && penalty.score) ?? 0;
  return { score: round(clamp(raw - deduction, 0, 100)), coverage };
}

function pathStage(pathKey, rows, components, penalty, status) {
  if (status === "unknown") return "unconfirmed";
  const profit = finiteNumber(components.profitQuality.score);
  const continuation = finiteNumber(components.crossDayContinuation.score);
  if (pathKey === "highTrend") {
    if (status === "active" && profit !== null && profit >= 85 && rows.some((row) => structureOf(row.stock, row.leadership).overextended === true)) {
      return "trend_acceleration";
    }
    if (status === "active" && continuation !== null && continuation >= 68) return "trend_continuation";
    return status === "active" ? "trend_active" : "unconfirmed";
  }
  if (pathKey === "lowLaunch") {
    if (status !== "active") return "unconfirmed";
    if (continuation !== null && continuation >= 68) return "launch_continuation";
    return rows.length >= 3 ? "fermenting" : "launching";
  }
  if (finiteNumber(penalty.score) !== null && penalty.score >= 15) return "divergence";
  if (status !== "active") return "unconfirmed";
  const closedRate = ratio(rows.filter((row) => closedAtLimit(row.stock, row.leadership, row.boardCount)).length, rows.length);
  const maxBoards = rows.length ? Math.max(...rows.map((row) => row.boardCount || 0)) : 0;
  if (maxBoards >= 5 && closedRate !== null && closedRate >= 0.75) return "emotion_climax";
  if (maxBoards >= 3 && closedRate !== null && closedRate >= 0.67) return "emotion_acceleration";
  return "emotion_active";
}

function pathSourceCoverage(rows, sampleUniverse) {
  const targets = sampleUniverse && sampleUniverse.targetPerSource || {};
  const memberships = rows.map((row) => rankingMembership(row.stock, targets));
  const eastmoneyCount = memberships.filter((item) => item.eastmoney).length;
  const thsCount = memberships.filter((item) => item.ths).length;
  const crossListedCount = memberships.filter((item) => item.crossListed).length;
  const requiredCrossListedCount = MIN_CROSS_SOURCE_SAMPLES[sampleUniverse && sampleUniverse.pathKey] || 1;
  const sourceRuleEnforced = sampleUniverse
    && sampleUniverse.rankingsState !== "unreported";
  return {
    eastmoneyCount,
    thsCount,
    intersectionCount: crossListedCount,
    crossListedCount,
    crossListedRatePct: rows.length ? round((crossListedCount / rows.length) * 100) : null,
    requiredCrossListedCount,
    sourceRuleEnforced: Boolean(sourceRuleEnforced),
    crossSourcePass: !sourceRuleEnforced || crossListedCount >= requiredCrossListedCount,
  };
}

function pathStatus(pathKey, rows, score, components, sourceCoverage) {
  if (score === null) return "unknown";
  if (sourceCoverage && sourceCoverage.sourceRuleEnforced && !sourceCoverage.crossSourcePass) {
    return score >= 50 ? "candidate" : "weak";
  }
  if (pathKey === "highTrend") {
    const continuation = finiteNumber(components.crossDayContinuation.score);
    const core = finiteNumber(components.coreConfirmation.score);
    if (rows.length >= 3 && score >= 65 && continuation !== null && continuation >= 60 && core !== null && core >= 55) return "active";
  } else if (pathKey === "lowLaunch") {
    const hasPioneer = rows.some((row) => isPioneerLike(row.stock, row.leadership));
    const hasCapacity = rows.some((row) => isCapacityLike(row.stock, row.leadership));
    const hasFollower = rows.some((row) => (finiteNumber(initiativeOf(row.stock, row.leadership).followerCount) ?? 0) > 0);
    if (rows.length >= 3 && score >= 60 && hasPioneer && (hasCapacity || hasFollower)) return "active";
  } else {
    const maxBoards = rows.length ? Math.max(...rows.map((row) => row.boardCount || 0)) : 0;
    if (rows.length >= 3 && maxBoards >= 2 && score >= 65) return "active";
  }
  if (score >= 50) return "candidate";
  return "weak";
}

function dataQuality(aggregate, components, previousContext) {
  const coverage = aggregate.coverage;
  const level = coverage >= 90 ? "high" : coverage >= 70 ? "medium" : coverage >= 55 ? "low" : "unknown";
  return {
    level,
    coverage,
    ruleComponentCoveragePct: coverage,
    exactPreviousTradingDay: previousContext.exact,
    crossDaySource: components.crossDayContinuation.source,
    missing: Object.entries(components)
      .filter(([, value]) => value.status === "unknown")
      .map(([key]) => key),
  };
}

function pathConfirmation(pathKey, rows, score, components, sourceCoverage, status) {
  const minimumSamples = 3;
  const coreScore = finiteNumber(components.coreConfirmation.score);
  const continuationScore = finiteNumber(components.crossDayContinuation.score);
  const maxBoards = rows.length ? Math.max(...rows.map((row) => row.boardCount || 0)) : 0;
  const structurePass = pathKey === "highTrend"
    ? continuationScore !== null && continuationScore >= 60 && coreScore !== null && coreScore >= 55
    : pathKey === "lowLaunch"
      ? rows.some((row) => isPioneerLike(row.stock, row.leadership))
        && rows.some((row) => isCapacityLike(row.stock, row.leadership)
          || (finiteNumber(initiativeOf(row.stock, row.leadership).followerCount) ?? 0) > 0)
      : maxBoards >= 2;
  return {
    confirmed: status === "active",
    scorePass: score !== null && score >= (pathKey === "lowLaunch" ? 60 : 65),
    independentSamplePass: rows.length >= minimumSamples,
    minimumSamples,
    crossSourcePass: sourceCoverage.crossSourcePass,
    requiredCrossListedCount: sourceCoverage.requiredCrossListedCount,
    coreStructurePass: structurePass,
    profitQuoteState: components.profitQuality.status === "known" ? components.profitQuality.source : "quotes_pending",
    note: status === "active"
      ? "市场路径已由独立样本确认；是否有可交易个股由后续执行载体门槛单独决定。"
      : "市场路径尚未同时通过规则分、独立样本、双榜交叉和核心结构门槛。",
  };
}

function buildRows(payload) {
  const rawCandidates = resolveCandidateRows(payload);
  const targets = {
    eastmoney: rankingTargetOf(payload, "eastmoney"),
    ths: rankingTargetOf(payload, "ths"),
  };
  const rankedCandidates = rawCandidates.filter((stock) => {
    const membership = rankingMembership(stock, targets);
    return membership.eastmoney || membership.ths;
  });
  // 老归档没有排名字段时仍可按其原始全市场候选读取；一旦存在排名字段，
  // 就严格把样本限制在东方财富/同花顺各自 Top100 的并集内。
  const candidates = rankedCandidates.length ? rankedCandidates : rawCandidates;
  const leadershipLookup = makeLookup(resolveLeadershipRows(payload));
  const limitPoolMap = resolveLimitPoolMap(payload);
  return candidates.map((stock) => {
    const boardSignal = boardSignalOf(stock, limitPoolMap);
    return {
      stock,
      leadership: findInLookup(leadershipLookup, stock)
        || (isObject(stock.leadership) ? stock.leadership : {}),
      boardCount: boardSignal.consecutiveBoards,
      boardsInWindow: boardSignal.boardsInWindow,
      limitPoolMatched: boardSignal.limitPoolMatched,
      boardSignalSource: boardSignal.source,
    };
  });
}

function buildPath(pathKey, allRows, previousLookup, previousContext, sampleUniverse) {
  const eligibility = pathKey === "highTrend"
    ? highTrendEligibility
    : pathKey === "lowLaunch"
      ? lowLaunchEligibility
      : boardEmotionEligibility;
  const association = pathKey === "highTrend"
    ? highTrendAssociation
    : pathKey === "lowLaunch"
      ? lowLaunchAssociation
      : boardEmotionAssociation;
  const rows = allRows.filter(eligibility);
  const associatedRows = allRows.filter(association);
  const components = {
    profitQuality: profitComponent(rows, pathKey),
    crossDayContinuation: continuationComponent(rows, pathKey, previousLookup, previousContext),
    breadth: breadthComponent(rows, pathKey),
    coreConfirmation: coreComponent(rows, pathKey),
  };
  const penalty = negativePenalty(associatedRows);
  let aggregate = aggregateScore(components, penalty);
  if (!rows.length && associatedRows.length && associatedRows.some((row) => severeNegative(row.stock, row.leadership))) {
    aggregate = { score: 0, coverage: 55 };
  }
  const sourceCoverage = pathSourceCoverage(rows, { ...sampleUniverse, pathKey });
  const status = pathStatus(pathKey, rows, aggregate.score, components, sourceCoverage);
  const stage = pathStage(pathKey, rows, components, penalty, status);
  const confirmation = pathConfirmation(pathKey, rows, aggregate.score, components, sourceCoverage, status);
  const evidence = [
    `样本广度：${components.breadth.evidence}`,
    `当日赚钱质量：${components.profitQuality.evidence}`,
    `跨日延续：${components.crossDayContinuation.evidence}`,
    `核心确认：${components.coreConfirmation.evidence}`,
    `负反馈：${penalty.evidence}`,
  ];
  if (status === "candidate") evidence.push("独立样本、核心结构或分数尚未达到路径成立线。");
  if (status === "unknown") evidence.push("关键数据不足，本轮不强行赋分。");
  if (sourceCoverage.sourceRuleEnforced && !sourceCoverage.crossSourcePass) {
    evidence.push(`双榜交叉仅${sourceCoverage.crossListedCount}只，未达到${sourceCoverage.requiredCrossListedCount}只确认线。`);
  }
  return {
    key: pathKey,
    label: PATH_LABELS[pathKey],
    score: aggregate.score,
    status,
    statusLabel: STATUS_LABELS[status],
    stage,
    stageLabel: STAGE_LABELS[stage],
    sampleCount: rows.length,
    associatedSampleCount: associatedRows.length,
    sourceCoverage,
    confirmation,
    components,
    negativePenalty: penalty,
    dataQuality: dataQuality(aggregate, components, previousContext),
    evidence,
    _rows: rows,
  };
}

function buildPathCohorts(paths, tradingDate, snapshotKind) {
  const closing = snapshotKind === "closing";
  return {
    version: PERSISTENCE_VERSION,
    classifierVersion: STYLE_CLASSIFIER_VERSION,
    ruleSignature: STYLE_RULE_SIGNATURE,
    tradingDate,
    snapshotKind,
    status: closing ? "frozen" : "observation_only",
    paths: Object.fromEntries(PATH_KEYS.map((key) => [key, {
      key,
      label: PATH_LABELS[key],
      status: closing ? "frozen" : "observation_only",
      samples: closing ? dedupeRows((paths[key] && paths[key]._rows || []).map((row) => ({
        code: stockCode(row.stock),
        name: stockName(row.stock),
        signalClose: finiteNumber(row.stock && row.stock.price)
          ?? finiteNumber(profileOf(row.stock).lastClose),
        priceLimitPct: priceLimitPct(row.stock),
        source: "t_close_style_cohort",
      }))).filter((row) => row.code) : [],
    }])),
    guardrails: {
      immutableClosingCohort: true,
      outcomeOnlyRowsCannotEnterCurrentStyle: true,
      classifierAndRuleSignatureRequired: true,
    },
  };
}

function snapshotKindOf(payload) {
  const declared = String(
    payload && payload.decisionBasis && payload.decisionBasis.snapshotKind
    || payload && payload.archiveMeta && payload.archiveMeta.snapshotKind
    || payload && payload.themeLibrary && payload.themeLibrary.snapshotKind
    || "",
  ).trim().toLowerCase();
  return declared === "closing" || declared === "intraday" ? declared : "unknown";
}

function t1Outcome(previousRow, currentStock, currentTradingDate) {
  if (!previousRow || !currentStock || !hasUsableLiveQuote(currentStock) && !hasUsableClosingSession(currentStock, currentStock.leadership || {})) return null;
  const leadership = isObject(currentStock.leadership) ? currentStock.leadership : {};
  const closeReturnPct = changePctOf(currentStock);
  if (closeReturnPct === null) return null;
  const session = sessionOf(currentStock, leadership);
  const sessionDate = normalizeDate(session.tradingDate || session.date);
  const sessionClosing = sessionDate === currentTradingDate
    && (session.completed === true || session.closingComplete === true || session.asOf === "15:00" || session.asOf === "15:30");
  const verifiedClosingQuote = currentStock.styleOutcomeOnly === true
    && normalizeDate(currentStock.styleOutcomeTradingDate) === currentTradingDate
    && currentStock.styleOutcomeQuoteVerified === true;
  if (!sessionClosing && !verifiedClosingQuote) return null;
  const openReturnPct = finiteNumber(session.openChangePct);
  const minReturnPct = finiteNumber(session.minChangePct);
  const maxReturnPct = finiteNumber(session.maxChangePct);
  const faded = highOpenLowClose(currentStock, leadership);
  const resealFailed = failedReseal(currentStock, leadership);
  const broken = structureBroken(currentStock, leadership);
  const normalizedLimit = finiteNumber(previousRow.priceLimitPct) ?? priceLimitPct(currentStock);
  const severe = severeNegative(currentStock, leadership)
    || closeReturnPct <= -normalizedLimit * 0.5
    || (minReturnPct !== null && minReturnPct <= -normalizedLimit * 0.5)
    || resealFailed
    || broken;
  const negative = closeReturnPct <= -1 || faded || resealFailed || broken;
  const positive = !negative && closeReturnPct >= 1;
  const openToClosePct = openReturnPct === null ? null : closeReturnPct - openReturnPct;
  const adversePct = minReturnPct === null ? null : minReturnPct;
  return {
    code: stockCode(currentStock),
    name: stockName(currentStock),
    closeReturnPct: round(closeReturnPct, 2),
    openReturnPct: round(openReturnPct, 2),
    minReturnPct: round(minReturnPct, 2),
    maxReturnPct: round(maxReturnPct, 2),
    openToClosePct: round(openToClosePct, 2),
    adversePct: round(adversePct, 2),
    positive,
    negative,
    severe,
    highOpenLowClose: faded,
    failedReseal: resealFailed,
    structureBroken: broken,
    normalizedPriceLimitPct: normalizedLimit,
    source: hasUsableClosingSession(currentStock, leadership) ? "exact_t1_closing_session" : "exact_t1_closing_quote",
  };
}

function dailyPathEffect(pathKey, previousRows, currentLookup, options = {}) {
  const eligibility = pathKey === "highTrend"
    ? highTrendEligibility
    : pathKey === "lowLaunch"
      ? lowLaunchEligibility
      : boardEmotionEligibility;
  const cohort = options.frozenCohort === true ? previousRows : previousRows.filter(eligibility);
  const outcomes = cohort
    .map((row) => {
      const reference = row && row.stock || row;
      const previousSample = row && row.stock ? {
        code: stockCode(row.stock),
        name: stockName(row.stock),
        priceLimitPct: priceLimitPct(row.stock),
      } : row;
      return t1Outcome(previousSample, findInLookup(currentLookup, reference), options.currentTradingDate);
    })
    .filter(Boolean);
  const coverage = cohort.length ? outcomes.length / cohort.length : null;
  const positiveRate = outcomes.length ? ratio(outcomes.filter((row) => row.positive).length, outcomes.length) : null;
  const negativeRate = outcomes.length ? ratio(outcomes.filter((row) => row.negative).length, outcomes.length) : null;
  const severeRate = outcomes.length ? ratio(outcomes.filter((row) => row.severe).length, outcomes.length) : null;
  const medianNextClosePct = median(outcomes.map((row) => row.closeReturnPct));
  const medianNextOpenPct = median(outcomes.map((row) => row.openReturnPct).filter((value) => value !== null));
  const medianOpenToClosePct = median(outcomes.map((row) => row.openToClosePct).filter((value) => value !== null));
  const medianAdversePct = median(outcomes.map((row) => row.adversePct).filter((value) => value !== null));
  const usable = cohort.length >= MIN_DAILY_COHORT_SAMPLES
    && outcomes.length >= MIN_DAILY_COHORT_SAMPLES
    && coverage !== null
    && coverage >= MIN_T1_MATCH_COVERAGE;
  const state = !usable ? "unknown"
    : negativeRate >= 0.5 || severeRate >= 0.25 || medianNextClosePct <= -1 ? "loss"
      : positiveRate >= 0.55 && negativeRate <= 0.35 && medianNextClosePct > 0 ? "profit"
        : "mixed";
  const profitScore = !usable ? null : round(clamp(
    positiveRate * 45
      + clamp((medianNextClosePct + 2) / 8, 0, 1) * 35
      + (1 - negativeRate) * 20,
    0,
    100,
  ));
  const lossScore = !usable ? null : round(clamp(
    negativeRate * 50
      + severeRate * 30
      + clamp((-medianNextClosePct + 1) / 7, 0, 1) * 20,
    0,
    100,
  ));
  return {
    key: pathKey,
    label: PATH_LABELS[pathKey],
    status: usable ? "usable" : "insufficient",
    state,
    cohortCount: cohort.length,
    matchedCount: outcomes.length,
    coveragePct: coverage === null ? null : round(coverage * 100),
    positiveRate: positiveRate === null ? null : round(positiveRate, 3),
    negativeRate: negativeRate === null ? null : round(negativeRate, 3),
    severeRate: severeRate === null ? null : round(severeRate, 3),
    medianNextClosePct: round(medianNextClosePct, 2),
    medianNextOpenPct: round(medianNextOpenPct, 2),
    medianOpenToClosePct: round(medianOpenToClosePct, 2),
    medianAdversePct: round(medianAdversePct, 2),
    profitScore,
    lossScore,
    positiveCodes: outcomes.filter((row) => row.positive).map((row) => row.code),
    negativeCodes: outcomes.filter((row) => row.negative).map((row) => row.code),
    severeCodes: outcomes.filter((row) => row.severe).map((row) => row.code),
    evidence: usable
      ? `T日${cohort.length}只，T+1匹配${outcomes.length}只；正反馈${Math.round(positiveRate * 100)}%，负反馈${Math.round(negativeRate * 100)}%，次日收盘中位${medianNextClosePct >= 0 ? "+" : ""}${round(medianNextClosePct, 2)}%`
      : `T日${cohort.length}只，T+1仅匹配${outcomes.length}只；至少需要${MIN_DAILY_COHORT_SAMPLES}只且覆盖≥${MIN_T1_MATCH_COVERAGE * 100}%`,
    guardrails: {
      currentDayDeclineIsNotLossEffect: true,
      t1OutcomeOnly: true,
      previousLimitUpOnlyExcluded: true,
    },
  };
}

function buildDailyT1StyleEffect(currentPayload, previousPayload, options = {}) {
  const currentDate = tradingDateOf(currentPayload);
  const previousDate = tradingDateOf(previousPayload);
  const previousContext = exactPreviousContext(currentPayload, previousPayload);
  const snapshotKind = snapshotKindOf(currentPayload);
  if (!currentDate || !previousDate || !previousContext.exact || snapshotKind !== "closing") {
    return {
      version: PERSISTENCE_VERSION,
      tradingDate: currentDate,
      previousTradingDate: previousDate,
      snapshotKind,
      status: "unavailable",
      reason: snapshotKind !== "closing" ? "current_snapshot_not_closing" : "exact_t1_closing_unavailable",
      paths: Object.fromEntries(PATH_KEYS.map((key) => [key, dailyPathEffect(key, [], new Map(), { currentTradingDate: currentDate })])),
    };
  }
  const previousModel = previousPayload && previousPayload.premarketModels
    && previousPayload.premarketModels.tradingStylePreference;
  const cohorts = isObject(options.previousPathCohorts)
    ? options.previousPathCohorts
    : previousModel && previousModel.pathCohorts;
  const cohortValid = Boolean(
    cohorts
    && Number(cohorts.version || 0) === PERSISTENCE_VERSION
    && cohorts.classifierVersion === STYLE_CLASSIFIER_VERSION
    && cohorts.ruleSignature === STYLE_RULE_SIGNATURE
    && normalizeDate(cohorts.tradingDate) === previousDate
    && cohorts.snapshotKind === "closing"
    && isObject(cohorts.paths)
  );
  if (!cohortValid) {
    return {
      version: PERSISTENCE_VERSION,
      tradingDate: currentDate,
      previousTradingDate: previousDate,
      snapshotKind,
      status: "unavailable",
      reason: "previous_frozen_style_cohort_unavailable",
      paths: Object.fromEntries(PATH_KEYS.map((key) => [key, dailyPathEffect(key, [], new Map(), { currentTradingDate: currentDate })])),
      guardrails: { legacyRuleReplayCannotConfirmPersistence: true },
    };
  }
  const outcomeRows = Array.isArray(options.outcomeRows) ? options.outcomeRows.filter(isObject) : [];
  const currentLookup = makeLookup(outcomeRows);
  const paths = Object.fromEntries(PATH_KEYS.map((key) => [key, dailyPathEffect(
    key,
    Array.isArray(cohorts.paths[key] && cohorts.paths[key].samples) ? cohorts.paths[key].samples : [],
    currentLookup,
    { frozenCohort: true, currentTradingDate: currentDate },
  )]));
  const usableCount = PATH_KEYS.filter((key) => paths[key].status === "usable").length;
  return {
    version: PERSISTENCE_VERSION,
    tradingDate: currentDate,
    previousTradingDate: previousDate,
    snapshotKind,
    status: usableCount ? "usable" : "insufficient",
    usablePathCount: usableCount,
    cohortClassifierVersion: cohorts.classifierVersion,
    cohortRuleSignature: cohorts.ruleSignature,
    paths,
  };
}

function orderedStylePayloads(source, previousPayload, historyPayloads) {
  const byDate = new Map();
  [...(Array.isArray(historyPayloads) ? historyPayloads : []), previousPayload, source]
    .filter(isObject)
    .forEach((payload) => {
      const date = tradingDateOf(payload);
      if (date) byDate.set(date, payload);
    });
  return Array.from(byDate.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, payload]) => payload);
}

function mergeEffectHistory(source, previousPayload, options = {}) {
  const previousModel = previousPayload && previousPayload.premarketModels
    && previousPayload.premarketModels.tradingStylePreference;
  const retained = previousModel && previousModel.persistence
    && Array.isArray(previousModel.persistence.history)
    ? previousModel.persistence.history
    : [];
  const currentEffect = buildDailyT1StyleEffect(source, previousPayload, {
    outcomeRows: options.outcomeRows,
  });
  const byDate = new Map();
  [...retained, ...(currentEffect.status === "unavailable" ? [] : [currentEffect])].forEach((row) => {
    const date = normalizeDate(row && row.tradingDate);
    if (date) byDate.set(date, row);
  });
  return Array.from(byDate.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, row]) => row)
    .slice(-EFFECT_WINDOW_DAYS);
}

function summarizePersistentPath(pathKey, history) {
  const effects = history
    .map((row) => row && row.paths && row.paths[pathKey])
    .filter((row) => row && row.status === "usable");
  const validDays = effects.length;
  const profitDays = effects.filter((row) => row.state === "profit").length;
  const lossDays = effects.filter((row) => row.state === "loss").length;
  const positiveRate = mean(effects.map((row) => row.positiveRate));
  const negativeRate = mean(effects.map((row) => row.negativeRate));
  const severeRate = mean(effects.map((row) => row.severeRate));
  const medianNextClosePct = median(effects.map((row) => row.medianNextClosePct));
  const medianNextOpenPct = median(effects.map((row) => row.medianNextOpenPct));
  const medianOpenToClosePct = median(effects.map((row) => row.medianOpenToClosePct));
  const medianAdversePct = median(effects.map((row) => row.medianAdversePct));
  const totalMatchedSamples = effects.reduce((sum, row) => sum + Number(row.matchedCount || 0), 0);
  const persistentProfit = validDays >= MIN_VALID_EFFECT_DAYS
    && profitDays >= MIN_VALID_EFFECT_DAYS
    && totalMatchedSamples >= 15
    && positiveRate >= 0.55
    && negativeRate <= 0.35
    && severeRate <= 0.15
    && medianNextClosePct > 0;
  const persistentLoss = validDays >= MIN_VALID_EFFECT_DAYS
    && lossDays >= 2
    && (negativeRate >= 0.5 || severeRate >= 0.25 || medianNextClosePct <= -1);
  const latest = effects[effects.length - 1] || null;
  return {
    key: pathKey,
    label: PATH_LABELS[pathKey],
    validDays,
    requiredDays: MIN_VALID_EFFECT_DAYS,
    profitDays,
    lossDays,
    positiveRate: positiveRate === null ? null : round(positiveRate, 3),
    negativeRate: negativeRate === null ? null : round(negativeRate, 3),
    severeRate: severeRate === null ? null : round(severeRate, 3),
    medianNextClosePct: round(medianNextClosePct, 2),
    medianNextOpenPct: round(medianNextOpenPct, 2),
    medianOpenToClosePct: round(medianOpenToClosePct, 2),
    medianAdversePct: round(medianAdversePct, 2),
    totalMatchedSamples,
    persistentProfit,
    persistentLoss,
    latestState: latest && latest.state || "unknown",
    latestEvidence: latest && latest.evidence || "尚无可用T+1样本",
    profitScore: effects.length ? round(mean(effects.map((row) => row.profitScore))) : null,
    lossScore: effects.length ? round(mean(effects.map((row) => row.lossScore))) : null,
  };
}

function buildPersistentPreference(source, previousPayload, options = {}) {
  const history = mergeEffectHistory(source, previousPayload, options);
  const paths = Object.fromEntries(PATH_KEYS.map((key) => [key, summarizePersistentPath(key, history)]));
  const profitable = PATH_KEYS.map((key) => paths[key])
    .filter((row) => row.persistentProfit)
    .sort((left, right) => (right.profitScore || 0) - (left.profitScore || 0));
  const lossRows = PATH_KEYS.map((key) => paths[key])
    .filter((row) => row.persistentLoss)
    .sort((left, right) => (right.lossScore || 0) - (left.lossScore || 0));
  const latestRiskRows = PATH_KEYS.map((key) => paths[key])
    .filter((row) => row.latestState === "loss" && !row.persistentLoss)
    .sort((left, right) => (right.lossScore || 0) - (left.lossScore || 0));
  const previousModel = previousPayload && previousPayload.premarketModels
    && previousPayload.premarketModels.tradingStylePreference;
  const previousPreference = previousModel && previousModel.persistentPreference;
  const previousPrimaryKey = String(previousPreference && previousPreference.primaryPath && previousPreference.primaryPath.key || "");
  const previousSummary = previousPrimaryKey && paths[previousPrimaryKey] || null;
  const challenger = profitable.find((row) => row.key !== previousPrimaryKey) || null;
  let status = "accumulating";
  let primary = null;
  let switchState = "not_ready";
  if (previousPrimaryKey && previousSummary) {
    if (previousSummary.persistentLoss) {
      if (challenger) {
        status = "switched";
        primary = challenger;
        switchState = "confirmed_switch";
      } else {
        status = "challenged";
        switchState = "incumbent_loss_without_challenger";
      }
    } else {
      status = "retained";
      primary = previousSummary;
      switchState = challenger ? "challenger_observed" : "incumbent_retained";
    }
  } else if (profitable.length >= 2 && Math.abs((profitable[0].profitScore || 0) - (profitable[1].profitScore || 0)) <= 10) {
    status = "parallel";
    primary = profitable[0];
    switchState = "parallel_persistent_profit";
  } else if (profitable.length) {
    status = "confirmed";
    primary = profitable[0];
    switchState = "initial_persistent_confirmation";
  }
  const confirmedPaths = status === "parallel" ? profitable.slice(0, 2) : primary ? [primary] : [];
  const latestEffect = history[history.length - 1] || null;
  const conclusion = primary
    ? `持续赚钱偏好：${primary.label}；最近${history.length}个有效收盘窗口确认，单日变化不改写偏好`
    : status === "challenged"
      ? "原偏好已出现持续T+1亏钱效应，但新偏好尚未确认"
      : `持续偏好尚未确认：当前只有${history.length}/${MIN_VALID_EFFECT_DAYS}个可回放T+1窗口`;
  return {
    version: PERSISTENCE_VERSION,
    method: "t1_style_cohort_rolling_hysteresis_v1",
    calibrated: false,
    status,
    tradingDate: tradingDateOf(source),
    windowDays: EFFECT_WINDOW_DAYS,
    minimumValidDays: MIN_VALID_EFFECT_DAYS,
    primaryPath: primary ? { key: primary.key, label: primary.label } : null,
    confirmedPaths: confirmedPaths.map((row) => ({ key: row.key, label: row.label })),
    switchState,
    conclusion,
    latestEffect,
    paths,
    history,
    lossEffect: {
      status: lossRows.length ? "confirmed" : history.length >= MIN_VALID_EFFECT_DAYS ? "none" : "insufficient",
      headline: lossRows.length
        ? `${lossRows.map((row) => row.label).join("、")}存在持续T+1亏钱效应`
        : history.length >= MIN_VALID_EFFECT_DAYS ? "暂未发现持续T+1亏钱风格" : "T+1亏钱效应样本积累中",
      paths: lossRows,
      latestRiskObservations: latestRiskRows,
      definition: "T日风格样本买入后，T+1出现收跌、高开低走、炸板不回封、结构破坏或大幅回撤。",
    },
    guardrails: {
      sameDayRiseCannotConfirmPreference: true,
      currentDayDeclineIsNotLossEffect: true,
      exactT1ClosingOnly: true,
      switchRequiresIncumbentLossAndChallengerProfit: true,
      previousLimitUpOnlyExcluded: true,
      missingOutcomesFailClosed: true,
    },
  };
}

function rankKnownPaths(paths) {
  return PATH_KEYS
    .map((key) => paths[key])
    .filter((path) => finiteNumber(path.score) !== null)
    .sort((left, right) => right.score - left.score || PATH_KEYS.indexOf(left.key) - PATH_KEYS.indexOf(right.key));
}

function buildDominantPath(paths, sampleUniverse) {
  const ranked = rankKnownPaths(paths);
  const active = ranked.filter((path) => path.status === "active");
  if (!active.length) {
    const rankingsState = sampleUniverse && sampleUniverse.rankingsState;
    const reason = rankingsState === "pending"
      ? "双榜样本尚未抓到，本轮属于rankings_pending，不是市场无主导。"
      : rankingsState === "single_source"
        ? "仅一路热榜有样本，双榜交叉确认尚未完成。"
        : ranked.length || sampleUniverse && sampleUniverse.unionCount > 0
          ? "榜单样本已有，但三条路径均未同时通过规则分、独立样本、双榜交叉与核心结构确认。"
          : "三条路径缺少可判定样本。";
    return {
      key: "unknown",
      label: "无已确认主导路径",
      status: "unknown",
      score: null,
      paths: [],
      reason,
    };
  }
  if (active.length >= 2 && active[0].score - active[1].score <= 10) {
    return {
      key: "parallel",
      label: `${active[0].label} + ${active[1].label}`,
      status: "parallel",
      score: round(mean([active[0].score, active[1].score])),
      paths: active.slice(0, 2).map((path) => path.key),
      reason: `两条成立路径仅相差${round(active[0].score - active[1].score)}分，按双路径并行处理。`,
    };
  }
  return {
    key: active[0].key,
    label: active[0].label,
    status: "dominant",
    score: active[0].score,
    paths: [active[0].key],
    reason: active.length >= 2
      ? `领先第二条成立路径${round(active[0].score - active[1].score)}分。`
      : "当前唯一通过样本与分数门槛的资金路径。",
  };
}

function conclusionStateOf(paths, dominantPath, sampleUniverse) {
  if (sampleUniverse.rankingsState === "pending" || sampleUniverse.rankingsState === "single_source") {
    return sampleUniverse.rankingsState === "pending" ? "rankings_pending" : "rankings_partial";
  }
  if (dominantPath.status === "dominant" || dominantPath.status === "parallel") {
    if (sampleUniverse.observationPhase === "intraday") return "intraday_provisional";
    if (sampleUniverse.observationPhase === "preopen") return "preopen_provisional";
    return sampleUniverse.quoteState === "ready" ? "confirmed" : "quotes_pending";
  }
  return "no_dominant";
}

function buildMarketOrganization(paths, dominantPath, sampleUniverse) {
  const ranked = rankKnownPaths(paths);
  const active = ranked.filter((path) => path.status === "active");
  const candidates = ranked.filter((path) => path.status === "candidate");
  let key = "unknown";
  let label = "市场组织待确认";
  if (active.length >= 2 && dominantPath.key === "parallel") {
    key = "dual_path";
    label = "双路径并行";
  } else if (active.length >= 2) {
    key = "primary_with_parallel";
    label = "主路径 + 并行路径";
  } else if (active.length === 1) {
    key = "single_path";
    label = "单路径主导";
  } else if (candidates.length >= 2) {
    key = "multi_path_watch";
    label = "多路径观察";
  } else if (candidates.length === 1) {
    key = "single_path_watch";
    label = "单路径观察";
  }
  const knownQualities = ranked.map((path) => path.dataQuality.ruleComponentCoveragePct).filter((value) => value > 0);
  const ruleComponentCoveragePct = knownQualities.length ? round(mean(knownQualities)) : null;
  const dataCoveragePct = sampleUniverse.combinedCoveragePct;
  return {
    key,
    label,
    dataCoveragePct,
    coverageKind: "ranking_sample_coverage",
    ruleComponentCoveragePct,
    conclusionState: conclusionStateOf(paths, dominantPath, sampleUniverse),
    sourceCoverage: { ...sampleUniverse },
    evidence: active.length
      ? active.map((path) => `${path.label}${path.score}分·${path.stageLabel}`)
      : candidates.length
        ? candidates.map((path) => `${path.label}${path.score}分·待确认`)
        : ["三条路径缺少可判定数据"],
    guard: "组织形式只由三条资金路径的独立样本归纳；榜单覆盖率和规则组件覆盖率都不是结论置信度，“板块轮动”也不会自动映射为“轮动回流”。",
  };
}

function qualifiedLeadership(stock, leadership) {
  const roleText = [
    stock && stock.role,
    leadership && leadership.identity,
    leadership && leadership.levelLabel,
    leadership && leadership.anchorType,
  ].map((value) => String(value || "")).join(" ");
  const level = String(leadership && leadership.level || "");
  const identityPass = leadership && (
    leadership.coreQualified === true
    || leadership.coreIdentityQualified === true
    || leadership.repairCoreQualified === true
    || /^L[34]$/.test(level)
    || CORE_ROLE.test(roleText)
  );
  return leadership && leadership.tradeQualified === true && identityPass && !BAD_REPRESENTATIVE_ROLE.test(roleText);
}

function qualificationForRepresentative(row) {
  const { stock, leadership } = row;
  const hardGate = isObject(stock && stock.hardGate) ? stock.hardGate : {};
  // 风格载体评估发生在正式bestPick投影之前，原始候选尚没有
  // 顶层tradeQualified。此处只检查已存在的个股硬门槛；核心地位交易
  // 资格由下方leadershipPass独立检查，禁止重复且错序的否决。
  const canonicalCandidateGate = hardGate.pass === true;
  const gamePlan = isObject(stock.gamePlan) ? stock.gamePlan : {};
  const gamePlanPass = gamePlan.canGame === true;
  const leadershipPass = qualifiedLeadership(stock, leadership);
  const concepts = realConcepts(stock);
  const leadershipConcept = String(leadership && leadership.concept || "").trim();
  const conceptPass = concepts.length > 0 && conceptsMatch(concepts, leadershipConcept);
  const roleText = `${stock.role || ""} ${leadership && leadership.identity || ""}`;
  const rearPass = !BAD_REPRESENTATIVE_ROLE.test(roleText);
  return {
    pass: canonicalCandidateGate && gamePlanPass && leadershipPass && conceptPass && rearPass,
    canonicalCandidateGate,
    gamePlan: gamePlanPass,
    leadership: leadershipPass,
    realConcept: conceptPass,
    rearRoleExcluded: !rearPass,
    concept: concepts[0] ? concepts[0].label : null,
    leadershipConcept: leadershipConcept || null,
  };
}

function representativeView(row, qualification) {
  const initiative = initiativeOf(row.stock, row.leadership);
  const gamePlan = isObject(row.stock.gamePlan) ? row.stock.gamePlan : {};
  return {
    code: stockCode(row.stock),
    name: stockName(row.stock) || stockCode(row.stock) || "--",
    concept: qualification.concept,
    role: String(row.leadership.identity || row.stock.role || "核心"),
    changePct: round(changePctOf(row.stock), 2),
    consecutiveBoards: row.boardCount,
    boardCount: row.boardCount,
    boardsInWindow: row.boardsInWindow ? { ...row.boardsInWindow } : null,
    score: round(row.stock.score),
    longStrength: round(gamePlan.longStrength),
    initiativeScore: round(initiative.score),
    qualification: {
      canonicalCandidateGate: true,
      gamePlan: true,
      leadership: true,
      realConcept: true,
    },
  };
}

function observationRepresentativeView(row, pathKey) {
  const targets = { eastmoney: DEFAULT_RANKING_TARGET, ths: DEFAULT_RANKING_TARGET };
  const membership = rankingMembership(row.stock, targets);
  const eastRank = validPopularityRank(row.stock && row.stock.eastRank, targets.eastmoney)
    ? finiteNumber(row.stock.eastRank)
    : null;
  const thsRank = validPopularityRank(row.stock && row.stock.thsRank, targets.ths)
    ? finiteNumber(row.stock.thsRank)
    : null;
  const concepts = realConcepts(row.stock);
  const role = String(row.leadership.identity || row.stock.role || row.stock.ticketType || "路径样本");
  return {
    code: stockCode(row.stock),
    name: stockName(row.stock) || stockCode(row.stock) || "--",
    path: pathKey,
    pathLabel: PATH_LABELS[pathKey],
    role,
    concept: concepts[0] ? concepts[0].label : null,
    changePct: hasUsableLiveQuote(row.stock) ? round(changePctOf(row.stock), 2) : null,
    consecutiveBoards: row.boardCount,
    boardsInWindow: row.boardsInWindow ? { ...row.boardsInWindow } : null,
    eastRank,
    thsRank,
    crossListed: membership.crossListed,
    coreLike: isCoreLike(row.stock, row.leadership),
    quoteState: hasUsableLiveQuote(row.stock) ? "usable" : "pending",
    executable: false,
    note: membership.crossListed
      ? `东财第${eastRank}、同花顺第${thsRank}，作为双榜交叉路径锚观察`
      : "仅作为路径观察样本，不等于可执行案例",
  };
}

function buildObservationRepresentatives(paths) {
  const result = {};
  PATH_KEYS.forEach((pathKey) => {
    const path = paths[pathKey];
    if (!path || !["active", "candidate"].includes(path.status)) {
      result[pathKey] = [];
      return;
    }
    result[pathKey] = (Array.isArray(path._rows) ? path._rows : [])
      .filter((row) => {
        const roleText = `${row.stock.role || ""} ${row.leadership && row.leadership.identity || ""}`;
        return !BAD_REPRESENTATIVE_ROLE.test(roleText)
          && (isCoreLike(row.stock, row.leadership) || rankingMembership(row.stock).crossListed);
      })
      .sort((left, right) => {
        const leftMembership = rankingMembership(left.stock);
        const rightMembership = rankingMembership(right.stock);
        if (leftMembership.crossListed !== rightMembership.crossListed) return rightMembership.crossListed ? 1 : -1;
        const leftRank = (finiteNumber(left.stock.eastRank) ?? 999) + (finiteNumber(left.stock.thsRank) ?? 999);
        const rightRank = (finiteNumber(right.stock.eastRank) ?? 999) + (finiteNumber(right.stock.thsRank) ?? 999);
        if (leftRank !== rightRank) return leftRank - rightRank;
        const leftBoards = finiteNumber(left.boardCount) ?? 0;
        const rightBoards = finiteNumber(right.boardCount) ?? 0;
        if (rightBoards !== leftBoards) return rightBoards - leftBoards;
        return (finiteNumber(right.stock.score) ?? 0) - (finiteNumber(left.stock.score) ?? 0);
      })
      .slice(0, 3)
      .map((row) => observationRepresentativeView(row, pathKey));
  });
  const unique = new Set(PATH_KEYS.flatMap((key) => result[key].map((row) => row.code)).filter(Boolean));
  return {
    ...result,
    total: unique.size,
    note: "观察代表用于解释市场路径；它不取得统一个股门槛或下单权限。",
  };
}

function buildRepresentatives(eligibleCarriers) {
  const result = {};
  PATH_KEYS.forEach((pathKey) => {
    const qualified = (eligibleCarriers.qualifiedByPath[pathKey] || [])
      .sort((left, right) => {
        const leftPlan = finiteNumber(left.row.stock.gamePlan && left.row.stock.gamePlan.longStrength) ?? 0;
        const rightPlan = finiteNumber(right.row.stock.gamePlan && right.row.stock.gamePlan.longStrength) ?? 0;
        if (rightPlan !== leftPlan) return rightPlan - leftPlan;
        const leftScore = finiteNumber(left.row.stock.score) ?? 0;
        const rightScore = finiteNumber(right.row.stock.score) ?? 0;
        return rightScore - leftScore;
      })
      .slice(0, 3)
      .map((item) => representativeView(item.row, item.qualification));
    result[pathKey] = qualified;
  });
  const total = eligibleCarriers.codes.length;
  return {
    ...result,
    total,
    note: total
      ? "仅展示同时通过统一个股门槛、gamePlan、leadership 与真实概念归属的核心。"
      : "当前只有路径载体，没有同时通过统一个股门槛、gamePlan、leadership 与真实概念归属的可执行案例。",
  };
}

function method(label, score, reasons) {
  if (score === null) return { label, score: null, status: "unknown", statusLabel: "待确认", reasons };
  const status = score >= 70 ? "preferred" : score >= 45 ? "conditional" : "avoid";
  const statusLabel = status === "preferred" ? "优先" : status === "conditional" ? "条件允许" : "回避";
  return { label, score: round(score), status, statusLabel, reasons };
}

function buildExecutionPreference(paths) {
  const active = PATH_KEYS.map((key) => paths[key]).filter((path) => path.status === "active");
  if (!active.length) {
    const unknown = (label) => method(label, null, ["路径未确认，不强行生成手法偏好。"]);
    return {
      primary: null,
      secondary: [],
      summary: "暂无可执行偏好",
      methods: {
        lowBuy: unknown("低吸"),
        chaseBoard: unknown("追板"),
        reseal: unknown("回封"),
        trend: unknown("趋势"),
      },
    };
  }

  const hasHighTrend = paths.highTrend.status === "active";
  const hasLowLaunch = paths.lowLaunch.status === "active";
  const hasBoardEmotion = paths.boardEmotion.status === "active";
  const emotionClimax = paths.boardEmotion.stage === "emotion_climax";

  let lowBuyScore = hasHighTrend ? 88 : hasLowLaunch ? 52 : 28;
  let chaseScore = hasLowLaunch ? 62 : hasBoardEmotion ? 52 : 25;
  let resealScore = hasBoardEmotion ? 90 : hasLowLaunch ? 58 : 42;
  let trendScore = hasHighTrend ? 86 : hasLowLaunch ? 55 : 32;
  if (emotionClimax) chaseScore = Math.min(chaseScore, 25);
  if (hasBoardEmotion && !hasHighTrend) lowBuyScore = Math.min(lowBuyScore, 38);

  const methods = {
    lowBuy: method("低吸", lowBuyScore, [hasHighTrend ? "高位趋势只优先首次回踩确认。" : "不低吸连板后排。"]),
    chaseBoard: method("追板", chaseScore, [emotionClimax ? "连板加速/高潮阶段禁止追一致。" : "仅限低位先锋首板确认，不追后排。"]),
    reseal: method("回封", resealScore, [hasBoardEmotion ? "只做核心充分换手后的回封。" : "等待先锋或容量核心的价格发现。"]),
    trend: method("趋势", trendScore, [hasHighTrend ? "回踩MA5/MA10且结构未破才有效。" : "只用于低位启动中的主动容量。"]),
  };
  const ranked = Object.entries(methods)
    .filter(([, value]) => value.status !== "avoid" && value.status !== "unknown")
    .sort((left, right) => right[1].score - left[1].score);
  return {
    primary: ranked[0] ? ranked[0][1].label : null,
    secondary: ranked.slice(1, 3).map(([, value]) => value.label),
    summary: ranked[0]
      ? `优先${ranked[0][1].label}；${emotionClimax ? "连板一致加速不追板" : "买点必须由核心与路径同步确认"}`
      : "暂无可执行偏好",
    methods,
  };
}

function representativeCodes(representatives, pathKey) {
  return (Array.isArray(representatives[pathKey]) ? representatives[pathKey] : []).map((item) => item.code);
}

function buildOpportunities(paths, representatives) {
  const opportunities = [];
  if (paths.highTrend.status === "active") {
    opportunities.push({
      key: "high_trend_pullback",
      path: "highTrend",
      title: "高位趋势首次回踩承接",
      status: "conditional",
      trigger: ["核心首次回踩MA5/MA10且关键低点未破", "至少两只独立趋势样本仍保持结构"],
      action: "只允许低吸或趋势确认，不追偏离均线的加速。",
      cancel: ["核心跌破MA10或前低", "只剩单票独强"],
      representativeCodes: representativeCodes(representatives, "highTrend"),
    });
  }
  if (paths.lowLaunch.status === "active") {
    opportunities.push({
      key: "low_launch_confirmation",
      path: "lowLaunch",
      title: "低位先锋/容量启动确认",
      status: "conditional",
      trigger: ["低位独立样本继续增加", "先锋与主动容量同时存在"],
      action: "仅做先锋首板确认、容量突破或首次良性分歧。",
      cancel: ["只有孤立涨停", "容量不跟或首板负反馈扩散"],
      representativeCodes: representativeCodes(representatives, "lowLaunch"),
    });
  }
  if (paths.boardEmotion.status === "active") {
    opportunities.push({
      key: "board_core_reseal",
      path: "boardEmotion",
      title: "连板核心充分换手回封",
      status: "conditional",
      trigger: ["昨日或盘中有真实分歧", "核心换手后回封且中高位负反馈未扩散"],
      action: "只做核心弱转强或充分换手回封，不扩散后排。",
      cancel: ["高标A杀", "回封失败并向中高位扩散"],
      representativeCodes: representativeCodes(representatives, "boardEmotion"),
    });
  }
  return opportunities;
}

function buildCautions(paths, dominantPath, representatives) {
  const cautions = [
    {
      key: "no_rotation_reflow_alias",
      level: "high",
      text: "“板块轮动”只是组织形式，不等于“轮动回流”；回流必须有跨日重新转强证据。",
    },
    {
      key: "single_stock_guard",
      level: "high",
      text: "单票只能定义高度或载体，不能单独定义资金风格。",
    },
  ];
  if (paths.boardEmotion.stage === "emotion_climax") {
    cautions.push({ key: "emotion_climax", level: "high", text: "连板情绪已进入加速/高潮区，次日先按兑现而不是继续加速定价。" });
  }
  if (dominantPath.key === "parallel") {
    cautions.push({ key: "parallel_paths", level: "medium", text: "双路径并行时不强行单押风格，执行仓位应降一级。" });
  }
  if (PATH_KEYS.some((key) => paths[key].components.crossDayContinuation.status === "unknown")) {
    cautions.push({ key: "cross_day_unknown", level: "medium", text: "部分路径缺少精确跨日证据，页面必须显示“跨日待确认”。" });
  }
  if (representatives.total === 0) {
    cautions.push({ key: "no_qualified_case", level: "high", text: "当前没有通过全部资格门槛的代表案例，不得用后排或不合格票补位。" });
  }
  return cautions;
}

function pathNames(dominantPath) {
  return dominantPath.paths.length
    ? dominantPath.paths.map((key) => PATH_LABELS[key])
    : ["待确认路径"];
}

function buildTomorrowPaths(paths, dominantPath) {
  const names = pathNames(dominantPath);
  const hasLowAndBoard = paths.lowLaunch.status === "active" && paths.boardEmotion.status === "active";
  return [
    {
      key: "strengthen",
      label: `${names.join("、")}继续加强`,
      verify: ["新增有效样本继续增加", "先锋/高标与主动容量同步承接", "负反馈没有向核心扩散"],
      outcome: "保留或升级当前主导路径，仍只允许通过个股资格的核心买点。",
    },
    {
      key: "orderly_realization",
      label: hasLowAndBoard ? "高位兑现、低位承接" : "主路径良性分歧承接",
      verify: hasLowAndBoard
        ? ["连板高标分歧但负反馈不扩散", "低位先锋与容量活口承接", "新核心完成换手确认"]
        : ["核心分歧不破关键低点", "换手后收复均价/开盘价", "同路径至少两只样本稳定"],
      outcome: "只做新核心或原核心的分歧转强，不追旧一致和后排。",
    },
    {
      key: "all_fail",
      label: "高低路径同时失败",
      verify: ["高标负反馈向中高位扩散", "低位启动只剩孤立票或首板失败", "趋势/容量核心同步走弱"],
      outcome: "判定无有效风格，停止向后生成买点。",
    },
  ];
}

function buildDirectionPermission(paths, dominantPath, executionPreference, eligibleCarriers, conclusionState) {
  const ruleActiveKeys = PATH_KEYS.filter((key) => paths[key].status === "active");
  const formallyConfirmed = conclusionState === "confirmed";
  const activeKeys = formallyConfirmed ? ruleActiveKeys : [];
  const candidateKeys = PATH_KEYS.filter((key) => paths[key].status === "candidate")
    .concat(formallyConfirmed ? [] : ruleActiveKeys)
    .filter((key, index, list) => list.indexOf(key) === index);
  const dominantKeys = (Array.isArray(dominantPath && dominantPath.paths) ? dominantPath.paths : [])
    .filter((key) => activeKeys.includes(key));
  const contingencyKeys = activeKeys.filter((key) => !dominantKeys.includes(key));
  const uniqueCodesFor = (keys) => [...new Set(keys.flatMap((key) => eligibleCarriers.byPath[key] || []))];
  const primaryEligibleCarrierCodes = uniqueCodesFor(dominantKeys);
  const contingencyEligibleCarrierCodes = uniqueCodesFor(contingencyKeys);
  const allowedCarrierTypes = [];
  if (activeKeys.includes("highTrend")) allowedCarrierTypes.push("高位趋势核心", "主动容量");
  if (activeKeys.includes("lowLaunch")) allowedCarrierTypes.push("低位先锋", "主动容量");
  if (activeKeys.includes("boardEmotion")) allowedCarrierTypes.push("连板核心", "换手回封核心");
  const screeningStatus = activeKeys.length ? "allowed" : candidateKeys.length ? "observe" : "unknown";
  const executionStatus = primaryEligibleCarrierCodes.length
    ? "conditional"
    : contingencyEligibleCarrierCodes.length
      ? "contingency_only"
      : "blocked";
  const executionLabel = executionStatus === "conditional"
    ? "主路径有合格载体，条件允许生成个股买点"
    : executionStatus === "contingency_only"
      ? "主路径无合格载体，仅保留次级 active 路径备选权"
      : "主路径无合格载体，禁止生成可执行案例";
  return {
    screeningStatus,
    screeningLabel: screeningStatus === "allowed" ? "允许方向筛选" : screeningStatus === "observe" ? "只允许方向观察" : "方向权限待确认",
    executionStatus,
    executionLabel,
    activePaths: activeKeys,
    provisionalPaths: formallyConfirmed ? [] : ruleActiveKeys,
    dominantPaths: dominantKeys,
    contingencyPaths: contingencyKeys,
    eligibleCarrierCodes: eligibleCarriers.codes.slice(),
    eligibleCarrierCodesByPath: { ...eligibleCarriers.byPath },
    primaryEligibleCarrierCodes,
    contingencyEligibleCarrierCodes,
    executionEligibleCarrierCodes: executionStatus === "conditional"
      ? primaryEligibleCarrierCodes
      : executionStatus === "contingency_only"
        ? contingencyEligibleCarrierCodes
        : [],
    allowedCarrierTypes: [...new Set(allowedCarrierTypes)],
    preferredMethods: Object.values(executionPreference.methods)
      .filter((item) => item.status === "preferred")
      .map((item) => item.label),
    forbidden: ["追一字板", "追高开一致加速", "买后排跟风", "用单票定义方向"],
      confirmation: ["方向内必须有至少两只独立有效样本", "必须有先锋/龙头与容量或跟随结构", "代表案例必须通过统一个股门槛、gamePlan、leadership和真实概念归属"],
    invalidation: ["路径样本数量降到确认线以下", "高标A杀/首板失败/容量补跌向核心扩散", "只剩单票独强"],
    downstreamGates: ["指数交易权限", "方向确认", "个股交易资格", "价格校验", "买点触发"],
    note: "本模块只传递风格筛选权限，不代替指数、个股与价格门槛。",
  };
}

function buildPersistentDirectionPermission(persistentPreference, eligibleCarriers, executionPreference) {
  const lossKeys = new Set(
    persistentPreference && persistentPreference.lossEffect && Array.isArray(persistentPreference.lossEffect.paths)
      ? persistentPreference.lossEffect.paths.filter((row) => row.persistentLoss).map((row) => row.key)
      : [],
  );
  const activeKeys = persistentPreference && Array.isArray(persistentPreference.confirmedPaths)
    ? persistentPreference.confirmedPaths.map((row) => row.key).filter((key) => PATH_KEYS.includes(key) && !lossKeys.has(key))
    : [];
  const primaryEligibleCarrierCodes = [...new Set(activeKeys.flatMap((key) => eligibleCarriers.byPath[key] || []))];
  const executionStatus = activeKeys.length && primaryEligibleCarrierCodes.length ? "conditional" : "blocked";
  return {
    screeningStatus: activeKeys.length ? "allowed" : "observe",
    screeningLabel: activeKeys.length ? "持续偏好允许方向筛选" : "持续偏好尚未确认，只允许观察",
    executionStatus,
    executionLabel: executionStatus === "conditional"
      ? "持续赚钱风格已有合格载体，仍须等待个股买点"
      : "没有经过持续T+1赚钱效应确认的风格，禁止生成可执行案例",
    activePaths: activeKeys,
    provisionalPaths: PATH_KEYS.filter((key) => !activeKeys.includes(key)),
    dominantPaths: activeKeys,
    contingencyPaths: [],
    eligibleCarrierCodes: eligibleCarriers.codes.slice(),
    eligibleCarrierCodesByPath: { ...eligibleCarriers.byPath },
    primaryEligibleCarrierCodes,
    contingencyEligibleCarrierCodes: [],
    executionEligibleCarrierCodes: executionStatus === "conditional" ? primaryEligibleCarrierCodes : [],
    allowedCarrierTypes: activeKeys.flatMap((key) => (
      key === "highTrend" ? ["高位趋势核心", "主动容量"]
        : key === "lowLaunch" ? ["低位先锋", "主动容量"]
          : ["连板核心", "换手回封核心"]
    )),
    preferredMethods: Object.values(executionPreference.methods)
      .filter((item) => item.status === "preferred")
      .map((item) => item.label),
    forbidden: ["追一字板", "追高开一致加速", "买后排跟风", "用单日涨跌定义风格"],
    confirmation: ["至少3个可回放T+1窗口", "同一风格持续正反馈", "负反馈率未进入亏钱效应区"],
    invalidation: ["原偏好连续出现T+1负反馈", "挑战风格持续赚钱并完成切换确认"],
    downstreamGates: ["指数交易权限", "题材确认", "个股交易资格", "价格校验", "买点触发"],
    note: "风格权限只认持续T+1效果；当日热度仅作观察。",
  };
}

function stripPrivatePathFields(paths) {
  return Object.fromEntries(PATH_KEYS.map((key) => {
    const { _rows, ...publicPath } = paths[key];
    return [key, publicPath];
  }));
}

function tradingDateOf(payload) {
  const dates = payload && payload.market && payload.market.limitStats && payload.market.limitStats.dates;
  return normalizeDate(dates && dates.today)
    || normalizeDate(payload && payload.tradingDate)
    || null;
}

function buildTradingStylePreference(payload = {}, options = {}) {
  const source = isObject(payload) ? payload : {};
  const previousPayload = isObject(options.previousPayload) ? options.previousPayload : {};
  const rawInputCandidateCount = dedupeRows(
    (Array.isArray(source.candidates) ? source.candidates : []).filter(isObject),
  ).length;
  const allRows = buildRows(source);
  const sampleUniverse = buildSampleUniverse(source, allRows);
  const rawMarketSampleCount = resolveCandidateRows(source).length;
  const previousLookup = makeLookup(resolveCandidateRows(previousPayload));
  const previousContext = exactPreviousContext(source, previousPayload);
  const paths = Object.fromEntries(PATH_KEYS.map((pathKey) => [
    pathKey,
    buildPath(pathKey, allRows, previousLookup, previousContext, sampleUniverse),
  ]));
  const currentSnapshotKind = snapshotKindOf(source);
  const pathCohorts = buildPathCohorts(paths, tradingDateOf(source), currentSnapshotKind);
  const dominantPath = buildDominantPath(paths, sampleUniverse);
  const persistentPreference = buildPersistentPreference(source, previousPayload, {
    outcomeRows: options.outcomeRows,
  });
  const persistentConclusionState = ["confirmed", "retained", "switched", "parallel"]
    .includes(persistentPreference.status) && persistentPreference.primaryPath
    ? "confirmed"
    : "unconfirmed";
  const marketOrganization = buildMarketOrganization(paths, dominantPath, sampleUniverse);
  const eligibleCarriers = buildEligibleCarriers(paths, allRows);
  const observationRepresentatives = buildObservationRepresentatives(paths);
  const representatives = buildRepresentatives(eligibleCarriers);
  const executionPreference = buildExecutionPreference(paths);
  const opportunities = buildOpportunities(paths, representatives);
  const cautions = buildCautions(paths, dominantPath, representatives);
  const tomorrowPaths = buildTomorrowPaths(paths, dominantPath);
  const directionPermission = buildDirectionPermission(
    paths,
    dominantPath,
    executionPreference,
    eligibleCarriers,
    marketOrganization.conclusionState,
  );
  const persistentDirectionPermission = buildPersistentDirectionPermission(
    persistentPreference,
    eligibleCarriers,
    executionPreference,
  );
  const publicPaths = stripPrivatePathFields(paths);

  return {
    version: VERSION,
    method: "rule_derived",
    observationOnly: true,
    analysisScope: {
      universe: "whole_market_hot_top100_union",
      independentOfThemePool: true,
      themePreselectionUsedForScoring: false,
      decisionCandidatesUsedForScoring: false,
      rawMarketSampleCount,
      scoredMarketSampleCount: allRows.length,
      excludedOutsideTop100Count: Math.max(0, rawMarketSampleCount - allRows.length),
      previousLimitUpOnlyExcludedCount: Math.max(0, rawInputCandidateCount - rawMarketSampleCount),
    },
    tradingDate: tradingDateOf(source),
    classifierVersion: STYLE_CLASSIFIER_VERSION,
    classifierRuleSignature: STYLE_RULE_SIGNATURE,
    conclusionState: marketOrganization.conclusionState,
    persistentConclusionState,
    sourceCoverage: { ...sampleUniverse },
    marketOrganization,
    paths: publicPaths,
    // 保留顶层别名，便于页面和下游分别按三条路径读取；内容与 paths 中完全一致。
    highTrend: publicPaths.highTrend,
    lowLaunch: publicPaths.lowLaunch,
    boardEmotion: publicPaths.boardEmotion,
    dominantPath,
    currentObservationDominantPath: dominantPath,
    pathCohorts,
    persistentPreference,
    persistence: {
      version: persistentPreference.version,
      method: persistentPreference.method,
      windowDays: persistentPreference.windowDays,
      minimumValidDays: persistentPreference.minimumValidDays,
      history: persistentPreference.history,
      paths: persistentPreference.paths,
      guardrails: persistentPreference.guardrails,
    },
    lossEffect: persistentPreference.lossEffect,
    executionPreference,
    opportunities,
    cautions,
    observationRepresentatives,
    representatives,
    eligibleCarrierCodesByPath: { ...eligibleCarriers.byPath },
    eligibleCarrierCodes: eligibleCarriers.codes.slice(),
    tomorrowPaths,
    directionPermission,
    persistentDirectionPermission,
    methodology: {
      pathWeights: COMPONENT_WEIGHTS,
      thresholds: {
        highTrendMinimumSamples: 3,
        lowLaunchMinimumSamples: 3,
        boardEmotionMinimumSamples: 3,
        parallelMaximumGap: 10,
        rankingTargetPerSource: DEFAULT_RANKING_TARGET,
        minimumCrossSourceSamples: MIN_CROSS_SOURCE_SAMPLES,
        effectWindowDays: EFFECT_WINDOW_DAYS,
        minimumValidEffectDays: MIN_VALID_EFFECT_DAYS,
        minimumDailyCohortSamples: MIN_DAILY_COHORT_SAMPLES,
        minimumT1MatchCoveragePct: MIN_T1_MATCH_COVERAGE * 100,
      },
      guards: [
        "缺数据输出unknown，不把缺失项补成0分",
        "单票不得确认路径",
        "盘前price为空且changePct为0时按quotes_pending，不按0%计分",
        "观察代表与可执行案例分层，前者不能自动获得下单权限",
        "同一代表案例必须通过四道硬门槛",
        "当日涨跌只形成观察路径，正式偏好必须由T日风格样本的T+1反馈连续确认",
        "亏钱效应只认买入后的次日负反馈，不把当日下跌直接算作风格亏钱",
        "风格切换要求原偏好负反馈增加且挑战风格持续赚钱",
        "板块轮动不直接映射轮动回流",
        "市场风格只由全市场Hot Top100并集归纳，不读取题材预选池自证",
        "精确T-1涨停补充池只用于个股纠偏观察，不参与市场风格与赚钱效应归纳",
        "深跌修复和历史高位反弹不得进入当前高位趋势样本",
        "盘中与盘前路径只作暂定观察，收盘前不得授予正式炒作偏好",
        "旧selected与bestPicks不得授予载体资格；下游只读取当前个股硬门槛、交易资格、核心地位和真实题材",
      ],
    },
  };
}

module.exports = {
  VERSION,
  PERSISTENCE_VERSION,
  STYLE_CLASSIFIER_VERSION,
  STYLE_RULE_SIGNATURE,
  PATH_KEYS,
  PATH_LABELS,
  COMPONENT_WEIGHTS,
  buildDailyT1StyleEffect,
  buildPersistentPreference,
  buildTradingStylePreference,
};
