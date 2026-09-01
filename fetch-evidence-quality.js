"use strict";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTradingDate(value) {
  const digits = String(value == null ? "" : value).replace(/\D/g, "");
  return digits.length === 8
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    : null;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function klineStatusFrom(payload) {
  const fetchStatus = isObject(payload && payload.fetchStatus) ? payload.fetchStatus : {};
  const items = Array.isArray(fetchStatus.items) ? fetchStatus.items : [];
  const item = items.find((row) => row && row.name === "K线/均线") || {};
  const diagnostics = isObject(payload && payload.sources && payload.sources.klineDiagnostics)
    ? payload.sources.klineDiagnostics : {};
  const marketScope = isObject(item.marketScope)
    ? item.marketScope : isObject(diagnostics.marketScope) ? diagnostics.marketScope : {};
  const supplementalScope = isObject(item.supplementalScope)
    ? item.supplementalScope : isObject(diagnostics.supplementalScope) ? diagnostics.supplementalScope : {};
  return {
    item,
    marketScope,
    supplementalScope,
    statusKey: String(marketScope.statusKey || item.statusKey || diagnostics.statusKey || fetchStatus.mode || "").trim().toLowerCase(),
    eligible: Object.prototype.hasOwnProperty.call(marketScope, "eligibleForClosingDecision")
      ? marketScope.eligibleForClosingDecision === true
      : item.eligibleForClosingDecision === true,
    expectedTradingDate: normalizeTradingDate(
      marketScope.expectedCompletedTradingDate
      || item.expectedCompletedTradingDate
      || diagnostics.expectedCompletedTradingDate,
    ),
    unavailableCount: finite(
      marketScope.unavailableCount ?? marketScope.unavailable
      ?? item.unavailableCount ?? diagnostics.unavailable,
    ),
    sameDayCacheCount: finite(
      marketScope.sameDayCacheCount ?? marketScope.sameDayCache
      ?? item.sameDayCacheCount ?? diagnostics.sameDayCache,
    ),
    cacheTradingDates: isObject(marketScope.cacheTradingDates)
      ? marketScope.cacheTradingDates : isObject(item.cacheTradingDates)
        ? item.cacheTradingDates : isObject(diagnostics.cacheTradingDates) ? diagnostics.cacheTradingDates : {},
  };
}

function resolveFetchEvidenceQuality(payload, expectedTradingDateValue = null) {
  const fetchStatus = isObject(payload && payload.fetchStatus) ? payload.fetchStatus : {};
  const sourceLevel = String(fetchStatus.level || "").trim().toLowerCase();
  const evidenceStatus = String(fetchStatus.evidenceStatus || "").trim().toLowerCase();
  const expectedTradingDate = normalizeTradingDate(expectedTradingDateValue);
  const kline = klineStatusFrom(payload);
  const explicitContract = Boolean(kline.statusKey);
  const cacheDates = Object.keys(kline.cacheTradingDates).map(normalizeTradingDate).filter(Boolean);
  const dateAligned = !expectedTradingDate
    || kline.expectedTradingDate === expectedTradingDate
      && (!cacheDates.length || cacheDates.every((date) => date === expectedTradingDate));
  const exactSameDayDegraded = kline.statusKey === "degraded_same_day_cache"
    && kline.eligible
    && evidenceStatus === "complete"
    && kline.unavailableCount === 0
    && (kline.sameDayCacheCount || 0) > 0
    && dateAligned;
  const explicitLiveComplete = kline.statusKey === "live_complete"
    && kline.eligible
    && evidenceStatus === "complete"
    && kline.unavailableCount === 0
    && dateAligned;
  const legacyOk = !explicitContract && sourceLevel === "ok";
  const closingEvidenceUsable = legacyOk || explicitLiveComplete || exactSameDayDegraded;
  const reasons = [];
  if (!closingEvidenceUsable) {
    if (!sourceLevel) reasons.push("fetch_level_missing");
    else if (sourceLevel !== "ok" && evidenceStatus !== "complete") reasons.push("fetch_evidence_incomplete");
    if (explicitContract && !["live_complete", "degraded_same_day_cache"].includes(kline.statusKey)) {
      reasons.push("kline_source_unusable");
    }
    if (kline.unavailableCount !== null && kline.unavailableCount > 0) reasons.push("kline_coverage_incomplete");
    if (!dateAligned) reasons.push("kline_trading_date_mismatch");
  }
  return {
    sourceLevel: sourceLevel || null,
    evidenceStatus: evidenceStatus || (legacyOk ? "legacy_complete" : null),
    klineStatusKey: kline.statusKey || null,
    exactDateComplete: dateAligned && (explicitLiveComplete || exactSameDayDegraded),
    closingEvidenceUsable,
    degradedSameDayCache: exactSameDayDegraded,
    legacyAccepted: legacyOk,
    expectedTradingDate,
    reasons,
  };
}

module.exports = {
  klineStatusFrom,
  resolveFetchEvidenceQuality,
};
