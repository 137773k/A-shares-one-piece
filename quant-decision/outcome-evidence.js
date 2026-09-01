"use strict";

const fs = require("node:fs");
const { selectMinuteEvidence } = require("./minute-evidence");

const DEFAULT_PRICE_INTEGRITY_TOLERANCE_PCT = 1;

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(...values) {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number != null && number > 0) return number;
  }
  return null;
}

function round(value, digits = 2) {
  const number = finiteNumber(value);
  if (number == null) return null;
  const scale = 10 ** digits;
  return Math.round(number * scale) / scale;
}

function normalizeTradingDate(value) {
  const text = String(value || "").trim();
  const compact = text.replace(/[^0-9]/g, "");
  if (!/^20\d{6}$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function candidateCode(stock) {
  return String(stock && (stock.code || stock.secCode) || "").trim();
}

function candidateClose(stock, expectedDate = null) {
  const direct = positiveNumber(stock && stock.close, stock && stock.price);
  if (direct != null) return direct;
  const profile = stock && stock.klineProfile && typeof stock.klineProfile === "object"
    ? stock.klineProfile : {};
  const profileDate = normalizeTradingDate(
    profile.lastTradingDate
    || profile.lastSession && profile.lastSession.tradingDate,
  );
  if (expectedDate && profileDate && profileDate !== expectedDate) return null;
  return positiveNumber(profile.close, profile.lastClose, profile.lastSession && profile.lastSession.close);
}

function buildOutcome(currentStock, nextStock, options = {}) {
  const tolerance = finiteNumber(options.priceIntegrityTolerancePct)
    ?? DEFAULT_PRICE_INTEGRITY_TOLERANCE_PCT;
  const code = candidateCode(currentStock);
  if (!nextStock) return { code, valid: false, reason: "code_missing_from_exact_t1_candidate_roster" };
  const currentClose = candidateClose(currentStock);
  const nextClose = candidateClose(nextStock);
  const reportedPrevClose = positiveNumber(nextStock.prevClose);
  const impliedPrevClose = nextClose != null && finiteNumber(nextStock.changePct) != null
    ? nextClose / (1 + Number(nextStock.changePct) / 100)
    : null;
  const nextPrevClose = reportedPrevClose || positiveNumber(impliedPrevClose);
  if (currentClose == null || nextClose == null || nextPrevClose == null) {
    return { code, valid: false, reason: "required_close_or_prev_close_missing" };
  }
  const priceDifferencePct = Math.abs(nextPrevClose / currentClose - 1) * 100;
  if (priceDifferencePct > tolerance) {
    return {
      code,
      valid: false,
      reason: "t_close_does_not_match_t1_prev_close",
      currentClose: round(currentClose),
      nextPrevClose: round(nextPrevClose),
      priceDifferencePct: round(priceDifferencePct, 4),
    };
  }

  const nextOpen = positiveNumber(nextStock.open);
  const nextHigh = positiveNumber(nextStock.high);
  const nextLow = positiveNumber(nextStock.low);
  const pct = (price) => price == null ? null : round((price / currentClose - 1) * 100, 4);
  return {
    code,
    valid: true,
    source: "exact_t1_candidate_snapshot",
    currentClose: round(currentClose),
    nextPrevClose: round(nextPrevClose),
    nextClose: round(nextClose),
    nextOpen: round(nextOpen),
    nextHigh: round(nextHigh),
    nextLow: round(nextLow),
    priceDifferencePct: round(priceDifferencePct, 4),
    gapPct: pct(nextOpen),
    closePct: pct(nextClose),
    highPct: pct(nextHigh),
    adversePct: pct(nextLow),
    openToClosePct: nextOpen == null ? null : round((nextClose / nextOpen - 1) * 100, 4),
  };
}

function loadOutcomeCache(cachePath) {
  if (!cachePath || !fs.existsSync(cachePath)) {
    return { schemaVersion: 1, series: {}, loadStatus: "missing" };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    return {
      ...parsed,
      series: parsed && parsed.series && typeof parsed.series === "object" ? parsed.series : {},
      loadStatus: "loaded",
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      series: {},
      loadStatus: "parse_failed",
      loadError: String(error && error.message || error),
    };
  }
}

function mergeOutcomeCaches(dailyCache, minuteCache) {
  const dailySeries = dailyCache && dailyCache.series && typeof dailyCache.series === "object"
    ? dailyCache.series : {};
  const minuteSeries = minuteCache && minuteCache.series && typeof minuteCache.series === "object"
    ? minuteCache.series : {};
  const codes = new Set([...Object.keys(dailySeries), ...Object.keys(minuteSeries)]);
  return {
    ...dailyCache,
    series: Object.fromEntries(Array.from(codes).map((code) => [code, {
      ...(dailySeries[code] || {}),
      minuteRowsByDate: minuteSeries[code] && minuteSeries[code].minuteRowsByDate || {},
      minuteQualityByDate: minuteSeries[code] && minuteSeries[code].qualityByDate || {},
      minuteSource: minuteSeries[code] && minuteSeries[code].source || "akshare_sina_5m_unadjusted",
    }])),
    minuteCacheStatus: minuteCache && minuteCache.loadStatus || "missing",
  };
}

function buildKlineOutcome(currentStock, series, currentDate, nextDate, options = {}) {
  const tolerance = finiteNumber(options.priceIntegrityTolerancePct)
    ?? DEFAULT_PRICE_INTEGRITY_TOLERANCE_PCT;
  const code = candidateCode(currentStock);
  const rows = Array.isArray(series && series.rows) ? series.rows : [];
  const currentRow = rows.find((row) => normalizeTradingDate(row && row.date) === currentDate);
  const nextRow = rows.find((row) => normalizeTradingDate(row && row.date) === nextDate);
  if (!currentRow || !nextRow) {
    return {
      code,
      valid: false,
      source: String(series && series.source || "kline_cache"),
      reason: "exact_t_or_t1_kline_missing",
    };
  }
  const snapshotClose = candidateClose(currentStock, currentDate);
  const currentClose = positiveNumber(currentRow.close);
  const nextClose = positiveNumber(nextRow.close);
  if (snapshotClose == null || currentClose == null || nextClose == null) {
    return {
      code,
      valid: false,
      source: String(series && series.source || "kline_cache"),
      reason: "required_kline_close_missing",
    };
  }
  const priceDifferencePct = Math.abs(currentClose / snapshotClose - 1) * 100;
  if (priceDifferencePct > tolerance) {
    return {
      code,
      valid: false,
      source: String(series && series.source || "kline_cache"),
      reason: "snapshot_close_does_not_match_t_kline_close",
      snapshotClose: round(snapshotClose),
      klineClose: round(currentClose),
      priceDifferencePct: round(priceDifferencePct, 4),
    };
  }
  const nextOpen = positiveNumber(nextRow.open);
  const nextHigh = positiveNumber(nextRow.high);
  const nextLow = positiveNumber(nextRow.low);
  const pct = (price) => price == null ? null : round((price / currentClose - 1) * 100, 4);
  return {
    code,
    valid: true,
    source: String(series && series.source || "kline_cache"),
    currentClose: round(currentClose),
    nextClose: round(nextClose),
    nextOpen: round(nextOpen),
    nextHigh: round(nextHigh),
    nextLow: round(nextLow),
    priceDifferencePct: round(priceDifferencePct, 4),
    gapPct: pct(nextOpen),
    closePct: pct(nextClose),
    highPct: pct(nextHigh),
    adversePct: pct(nextLow),
    openToClosePct: nextOpen == null ? null : round((nextClose / nextOpen - 1) * 100, 4),
  };
}

function resolveOutcome(currentStock, nextStock, outcomeCache, currentDate, nextDate, options = {}) {
  const code = candidateCode(currentStock);
  const series = outcomeCache && outcomeCache.series && outcomeCache.series[code];
  if (series) {
    const klineOutcome = buildKlineOutcome(currentStock, series, currentDate, nextDate, options);
    if (klineOutcome.valid || klineOutcome.reason !== "exact_t_or_t1_kline_missing") return klineOutcome;
  }
  return buildOutcome(currentStock, nextStock, options);
}

function minuteBarsForOutcomeCache(outcomeCache, code, tradingDate) {
  const series = outcomeCache && outcomeCache.series && outcomeCache.series[code];
  if (!series || typeof series !== "object") return [];
  const maps = [series.minuteRowsByDate, series.intradayByDate, series.minuteBarsByDate]
    .filter((value) => value && typeof value === "object");
  for (const map of maps) {
    if (Array.isArray(map[tradingDate])) return map[tradingDate];
  }
  return [];
}

function claimsExecutionAuthority(...values) {
  return values.some((value) => (
    value === true || Boolean(value && typeof value === "object" && value.executionAuthority === true)
  ));
}

function preservedMinuteValidity(value, validation = null) {
  const source = value && typeof value === "object" ? value : {};
  const status = String(source.status || "").trim().toLowerCase();
  const explicitlyFailed = source.validForV7 === false
    || source.validForExecutionReplay === false
    || source.verified === false
    || Boolean(validation && validation.passed === false)
    || /(?:failed|error|invalid|unavailable|missing)/.test(status);
  if (explicitlyFailed) return false;
  if (source.validForV7 === true || source.validForExecutionReplay === true) return true;
  return undefined;
}

function minuteCandidatesFromCache(cache, code, tradingDate) {
  const source = cache && typeof cache === "object" ? cache : {};
  const normalizedCode = (String(code || "").match(/\d{6}/) || [""])[0];
  const normalizedDate = normalizeTradingDate(tradingDate);
  const candidates = [];
  const records = Array.isArray(source.records) ? source.records : [];
  for (const record of records) {
    if ((String(record && record.code || "").match(/\d{6}/) || [""])[0] !== normalizedCode) continue;
    if (normalizeTradingDate(record && record.tradingDate) !== normalizedDate) continue;
    const validation = record.scheduleQuality && typeof record.scheduleQuality === "object"
      ? record.scheduleQuality
      : record.validation && typeof record.validation === "object" ? record.validation : null;
    const recordValidity = preservedMinuteValidity(record, validation);
    const cacheValidity = preservedMinuteValidity(source);
    candidates.push({
      provider: record.provider || source.provider && source.provider.name || source.authority,
      providerVersion: record.providerVersion || source.provider && source.provider.version,
      authority: source.authority,
      code: record.jqCode || record.code,
      tradingDate: record.tradingDate,
      barIntervalMinutes: record.barIntervalMinutes ?? source.barIntervalMinutes,
      priceMode: record.priceMode || source.priceMode,
      status: record.status,
      verified: record.verified,
      validForExecutionReplay: record.validForExecutionReplay,
      validForV7: cacheValidity === false ? false : recordValidity,
      validation,
      executionAuthority: claimsExecutionAuthority(record, source),
      contentHash: record.contentHash,
      contentHashScope: record.contentHashScope || source.contentHashScope,
      bars: Array.isArray(record.bars) ? record.bars : [],
    });
  }
  const series = source.series && source.series[normalizedCode];
  if (series && typeof series === "object") {
    const bars = minuteBarsForOutcomeCache(source, normalizedCode, normalizedDate);
    const quality = series.qualityByDate && series.qualityByDate[normalizedDate]
      || series.minuteQualityByDate && series.minuteQualityByDate[normalizedDate]
      || {};
    const qualityValidity = preservedMinuteValidity(quality, quality);
    const seriesValidity = preservedMinuteValidity(series);
    const cacheValidity = preservedMinuteValidity(source);
    candidates.push({
      provider: series.source || source.authority,
      authority: source.authority,
      code: normalizedCode,
      tradingDate: normalizedDate,
      barIntervalMinutes: series.barIntervalMinutes ?? source.barIntervalMinutes
        ?? (source.rules && source.rules.barIntervalMinutes)
        ?? (source.rules && source.rules.expected5mBars ? 5 : null),
      priceMode: series.priceMode || source.priceMode || source.rules && source.rules.adjust,
      status: quality.status || series.status,
      verified: quality.verified,
      validForExecutionReplay: quality.validForExecutionReplay,
      validForV7: cacheValidity === false || seriesValidity === false ? false : qualityValidity,
      validation: quality,
      executionAuthority: claimsExecutionAuthority(quality, series, source),
      contentHash: quality.contentHash || series.contentHashByDate && series.contentHashByDate[normalizedDate],
      contentHashScope: quality.contentHashScope || series.contentHashScope,
      bars,
    });
  }
  return candidates;
}

function selectV7MinuteEvidenceFromCaches(input = {}) {
  const cacheRows = Array.isArray(input.caches) ? input.caches : [];
  const candidates = cacheRows.flatMap((cache) => minuteCandidatesFromCache(
    cache,
    input.code,
    input.tradingDate,
  ));
  if (Array.isArray(input.additionalCandidates)) candidates.push(...input.additionalCandidates);
  return selectMinuteEvidence({
    code: input.code,
    tradingDate: input.tradingDate,
    candidates,
    sealTickEvidence: input.sealTickEvidence,
  });
}

module.exports = {
  DEFAULT_PRICE_INTEGRITY_TOLERANCE_PCT,
  finiteNumber,
  positiveNumber,
  round,
  normalizeTradingDate,
  candidateCode,
  candidateClose,
  buildOutcome,
  loadOutcomeCache,
  mergeOutcomeCaches,
  buildKlineOutcome,
  resolveOutcome,
  minuteBarsForOutcomeCache,
  minuteCandidatesFromCache,
  selectV7MinuteEvidenceFromCaches,
};
