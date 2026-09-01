"use strict";

const VERSION = 1;
const SETUP_KEY = "limit_up_pullback_repair";
const SETUP_LABEL = "前板回撤";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function text(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeDate(value) {
  const compact = text(value).replace(/[^0-9]/g, "");
  if (!/^20\d{6}$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function codeOf(value) {
  const raw = text(value && (value.code || value.secCode || value.stockCode || value.symbol));
  const sixDigits = raw.match(/(\d{6})$/);
  return sixDigits ? sixDigits[1] : raw.toUpperCase();
}

function nameOf(value) {
  return text(value && (value.name || value.stockName || value.securityName));
}

function firstBoolean(...values) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return null;
}

function closingSessionOf(stock) {
  const kline = isObject(stock && stock.klineProfile) ? stock.klineProfile : {};
  const lastSession = isObject(kline.lastSession) ? kline.lastSession : {};
  if (Object.keys(lastSession).length) return lastSession;
  const initiative = isObject(stock && stock.leadership && stock.leadership.initiative)
    ? stock.leadership.initiative : {};
  return isObject(initiative.session) ? initiative.session : {};
}

function exactPreviousArchiveContext(previousPayload, expectedTradingDate) {
  const source = isObject(previousPayload) ? previousPayload : {};
  const market = isObject(source.market) ? source.market : {};
  const limitStats = isObject(market.limitStats) ? market.limitStats : {};
  const dates = isObject(limitStats.dates) ? limitStats.dates : {};
  const archiveMeta = isObject(source.archiveMeta) ? source.archiveMeta : {};
  const generation = isObject(source.generationContext) ? source.generationContext
    : isObject(archiveMeta.generationContext) ? archiveMeta.generationContext : {};
  const expectedDate = normalizeDate(expectedTradingDate);
  const archiveDate = normalizeDate(archiveMeta.tradingDate);
  const payloadDate = normalizeDate(source.tradingDate || dates.today);
  const generationDate = normalizeDate(generation.tradingDate);
  const snapshotKind = text(archiveMeta.snapshotKind).toLowerCase();
  const blockers = [];

  if (!expectedDate) blockers.push("expected_t1_date_missing");
  if (snapshotKind !== "closing") blockers.push("previous_snapshot_not_closing");
  if (!archiveDate || archiveDate !== expectedDate) blockers.push("previous_archive_date_mismatch");
  if (!payloadDate || payloadDate !== expectedDate) blockers.push("previous_payload_date_mismatch");
  if (generationDate && generationDate !== expectedDate) blockers.push("previous_generation_date_mismatch");

  return {
    exact: blockers.length === 0,
    expectedDate,
    archiveDate,
    payloadDate,
    snapshotKind: snapshotKind || null,
    asOf: text(archiveMeta.asOf || source.asOf || source.fetchedAt || source.updatedAt) || null,
    generationId: text(archiveMeta.generationId || generation.generationId || source.generationId) || null,
    blockers,
  };
}

function previousPriceDiscovery(candidate, expectedDate) {
  const session = closingSessionOf(candidate);
  const sessionDate = normalizeDate(session.tradingDate);
  const snapshotKind = text(session.snapshotKind).toLowerCase();
  const verifiedClosing = session.verified === true
    && (session.completed === true || session.closingComplete === true)
    && (!snapshotKind || snapshotKind === "closing")
    && sessionDate === expectedDate;
  const oneWord = firstBoolean(
    session.oneWord,
    candidate && candidate.oneWord,
    candidate && candidate.isOneWord,
    candidate && candidate.oneWordBoard,
  );
  const noPriceDiscovery = firstBoolean(
    session.noPriceDiscovery,
    candidate && candidate.noPriceDiscovery,
    candidate && candidate.leadership && candidate.leadership.noPriceDiscovery,
  );
  return {
    verifiedClosing,
    tradingDate: sessionDate,
    oneWord,
    noPriceDiscovery,
    confirmed: verifiedClosing && oneWord === false && noPriceDiscovery === false,
    source: text(session.source) || null,
  };
}

/**
 * Build identifier-only T-1 limit-up seeds. Previous ranking, score, selection,
 * roles and execution fields are deliberately not projected.
 */
function buildPreviousLimitUpSeeds(previousPayload, options = {}) {
  const expectedTradingDate = normalizeDate(options.expectedTradingDate);
  const context = exactPreviousArchiveContext(previousPayload, expectedTradingDate);
  if (!context.exact) return [];

  const source = previousPayload;
  const pool = rows(source.market && source.market.limitStats && source.market.limitStats.pool);
  const candidates = rows(source.candidates);
  const candidateByCode = new Map();
  const candidateByName = new Map();
  candidates.forEach((candidate) => {
    const code = codeOf(candidate);
    const name = nameOf(candidate);
    if (code && !candidateByCode.has(code)) candidateByCode.set(code, candidate);
    if (name && !candidateByName.has(name)) candidateByName.set(name, candidate);
  });

  const seen = new Set();
  return pool.map((poolRow) => {
    const code = codeOf(poolRow);
    const name = nameOf(poolRow);
    if (!code || seen.has(code)) return null;
    seen.add(code);
    const candidate = candidateByCode.get(code) || candidateByName.get(name) || {};
    const priceDiscovery = previousPriceDiscovery(candidate, context.expectedDate);
    const concepts = rows(candidate.concepts).map((value) => (
      isObject(value) ? { ...value } : value
    ));
    return {
      code,
      secCode: code,
      name: name || nameOf(candidate) || code,
      concepts,
      mainConcept: text(candidate.mainConcept) || null,
      mainFamily: text(candidate.mainFamily) || null,
      previousLimitUpSeed: true,
      previousLimitUpEvidence: {
        version: VERSION,
        authority: "exact_t1_closing_limit_pool",
        status: "verified",
        exactClosing: true,
        tradingDate: context.expectedDate,
        snapshotKind: context.snapshotKind,
        asOf: context.asOf,
        generationId: context.generationId,
        closedAtLimit: true,
        source: "market.limitStats.pool",
        reason: text(poolRow && poolRow.reason) || null,
        highDays: text(poolRow && (poolRow.highDays || poolRow.boards || poolRow.boardCount)) || null,
        capitalReference: {
          tradingDate: context.expectedDate,
          totalMarketValue: finite(candidate.totalMarketValue),
          floatMarketValue: finite(candidate.floatMarketValue),
          floatMktCapYi: finite(candidate.floatMktCapYi),
        },
        priceDiscoveryVerified: priceDiscovery.confirmed,
        oneWord: priceDiscovery.oneWord,
        noPriceDiscovery: priceDiscovery.noPriceDiscovery,
        priceDiscovery,
      },
    };
  }).filter(Boolean);
}

function excludePreviousLimitUpOnly(stocks) {
  return rows(stocks).filter((stock) => stock && stock.previousLimitUpOnly !== true);
}

function currentClosingContext(stock, payload) {
  const dates = isObject(payload && payload.market && payload.market.limitStats
    && payload.market.limitStats.dates)
    ? payload.market.limitStats.dates : {};
  const currentDate = normalizeDate(dates.today || payload && payload.tradingDate);
  const expectedPreviousDate = dates.verified === true ? normalizeDate(dates.prev) : null;
  const session = closingSessionOf(stock);
  const sessionDate = normalizeDate(session.tradingDate);
  const snapshotKind = text(session.snapshotKind).toLowerCase();
  const closingVerified = session.verified === true
    && (session.completed === true || session.closingComplete === true)
    && (!snapshotKind || snapshotKind === "closing")
    && Boolean(currentDate && sessionDate === currentDate);
  const changePct = finite(session.changePct ?? session.currentChangePct ?? (stock && stock.changePct));
  return {
    datesVerified: dates.verified === true,
    currentDate,
    expectedPreviousDate,
    sessionDate,
    snapshotKind: snapshotKind || null,
    closingVerified,
    changePct,
  };
}

function currentStructureState(stock) {
  const kline = isObject(stock && stock.klineProfile) ? stock.klineProfile : {};
  const leadershipStructure = isObject(stock && stock.leadership && stock.leadership.structure)
    ? stock.leadership.structure : {};
  const structureKnown = typeof kline.structureBreak === "boolean"
    || typeof leadershipStructure.breakdown === "boolean"
    || typeof leadershipStructure.frameworkIntact === "boolean";
  const broken = kline.structureBreak === true
    || leadershipStructure.breakdown === true
    || leadershipStructure.frameworkIntact === false;
  return { known: structureKnown, broken };
}

function confirmedFundEscape(stock) {
  const flow = isObject(stock && stock.flowNature) ? stock.flowNature : {};
  const key = text(flow.key).toLowerCase();
  const confidence = finite(flow.confidence);
  const known = Boolean(key);
  const confirmed = flow.confirmed === true || (
    key === "escape"
    && flow.conflict !== true
    && (confidence === null || confidence >= 0.68)
  );
  return { known, confirmed, key: key || null, confidence };
}

function explicitFailure(stock) {
  const execution = isObject(stock && stock.tomorrowExecution) ? stock.tomorrowExecution : {};
  const gamePlan = isObject(stock && stock.gamePlan) ? stock.gamePlan : {};
  const hardGate = isObject(stock && stock.hardGate) ? stock.hardGate : {};
  const textEvidence = [
    execution.actionLabel,
    execution.reason,
    execution.statusLabel,
    gamePlan.decision,
    gamePlan.gameReason,
    ...rows(hardGate.hardFails),
  ].map((value) => text(value)).filter(Boolean);
  const failed = textEvidence.some((value) => (
    /退市|停牌|价格无效|无价格|流动性枯竭|结构破|破位|A杀|跌停无法交易/.test(value)
  ));
  return { failed, evidence: textEvidence };
}

function blockedResult(reasonCodes, evidence = []) {
  return {
    version: VERSION,
    setupKey: SETUP_KEY,
    label: SETUP_LABEL,
    status: "blocked",
    qualified: false,
    observationOnly: true,
    executionAuthority: false,
    focus: "前板回撤待确认",
    confirmationConditions: ["板块回流且个股重新取得相对强度", "竞价与开盘后出现主动承接"],
    cancelConditions: ["放量跌破今日低点或结构锚点", "个股不再匹配当前炒作偏好"],
    reasonCodes: [...new Set(reasonCodes)],
    evidence: [...new Set(evidence.filter(Boolean))],
  };
}

function classifyLimitUpPullbackRepair(stock, payload = {}) {
  const source = isObject(stock) ? stock : {};
  const previous = isObject(source.previousLimitUpEvidence) ? source.previousLimitUpEvidence : {};
  const current = currentClosingContext(source, payload);
  const structure = currentStructureState(source);
  const flow = confirmedFundEscape(source);
  const failure = explicitFailure(source);
  const blockers = [];
  const evidence = [];

  if (!current.datesVerified || !current.currentDate || !current.expectedPreviousDate) {
    blockers.push("current_trading_dates_unverified");
  }
  if (previous.status !== "verified" || previous.exactClosing !== true || previous.closedAtLimit !== true) {
    blockers.push("exact_t1_limit_up_evidence_missing");
  }
  if (!normalizeDate(previous.tradingDate)
    || normalizeDate(previous.tradingDate) !== current.expectedPreviousDate) {
    blockers.push("previous_limit_up_date_mismatch");
  }
  const priceDiscovery = isObject(previous.priceDiscovery) ? previous.priceDiscovery : {};
  const priceDiscoveryVerified = previous.priceDiscoveryVerified === true || priceDiscovery.confirmed === true;
  const previousOneWord = firstBoolean(previous.oneWord, priceDiscovery.oneWord);
  const previousNoPriceDiscovery = firstBoolean(previous.noPriceDiscovery, priceDiscovery.noPriceDiscovery);
  if (!priceDiscoveryVerified
    || previousOneWord !== false
    || previousNoPriceDiscovery !== false) {
    blockers.push("previous_price_discovery_unconfirmed");
  }
  if (!current.closingVerified) blockers.push("current_closing_evidence_missing");
  if (current.changePct === null) blockers.push("current_change_missing");
  else if (current.changePct >= 0) blockers.push("current_session_not_down");
  if (!structure.known) blockers.push("current_structure_evidence_missing");
  else if (structure.broken) blockers.push("current_structure_broken");
  if (failure.failed) blockers.push("explicit_stock_failure");

  if (previous.reason) evidence.push(`T-1涨停原因：${text(previous.reason)}`);
  if (previous.highDays) evidence.push(`T-1高度：${text(previous.highDays)}`);
  if (current.changePct !== null) evidence.push(`T日收盘${current.changePct.toFixed(2)}%`);
  if (structure.known && !structure.broken) evidence.push("当前结构未破");
  if (flow.known) evidence.push(`资金性质：${flow.key}（不作观察否决）`);
  else evidence.push("资金性质缺失（不作观察否决）");

  if (blockers.length) return blockedResult(blockers, evidence);
  return {
    version: VERSION,
    setupKey: SETUP_KEY,
    label: SETUP_LABEL,
    status: "qualified",
    qualified: true,
    observationOnly: true,
    executionAuthority: false,
    focus: "昨日涨停，今日回撤但结构未坏",
    confirmationConditions: ["板块回流且个股重新取得相对强度", "竞价与开盘后出现主动承接"],
    cancelConditions: ["放量跌破今日低点或结构锚点", "个股不再匹配当前炒作偏好"],
    reasonCodes: [],
    evidence,
  };
}

module.exports = {
  VERSION,
  SETUP_KEY,
  SETUP_LABEL,
  buildPreviousLimitUpSeeds,
  classifyLimitUpPullbackRepair,
  excludePreviousLimitUpOnly,
};
