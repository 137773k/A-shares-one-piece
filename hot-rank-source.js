"use strict";

const HOT_RANK_TARGET = 100;
const HOT_RANK_CACHE_VERSION = 1;

function normalizeTradingDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 8
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    : "";
}

function shanghaiClock(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function rankField(source) {
  return source === "eastmoney" ? "eastRank" : "thsRank";
}

function canonicalHotRankRows(rows, source) {
  const field = rankField(source);
  const byCode = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const code = String(raw && raw.code || "").replace(/\D/g, "").slice(-6);
    const rank = Number(raw && raw[field]);
    if (!/^\d{6}$/.test(code) || !Number.isInteger(rank) || rank < 1 || rank > HOT_RANK_TARGET) continue;
    const existing = byCode.get(code);
    if (!existing || rank < Number(existing[field])) byCode.set(code, { ...raw, code, [field]: rank });
  }
  return [...byCode.values()]
    .sort((left, right) => Number(left[field]) - Number(right[field]) || left.code.localeCompare(right.code))
    .slice(0, HOT_RANK_TARGET);
}

function verifiedProviderDates(limitStats) {
  const dates = limitStats && limitStats.dates;
  if (!dates || dates.verified !== true) return { today: "", prev: "" };
  return {
    today: normalizeTradingDate(dates.today),
    prev: normalizeTradingDate(dates.prev),
  };
}

function snapshotKindFor(tradingDate, now = new Date()) {
  const clock = shanghaiClock(now);
  const date = normalizeTradingDate(tradingDate);
  if (!clock || !date) return "unknown";
  if (date < clock.date) return "closing";
  if (date > clock.date) return "unknown";
  return clock.hour > 15 || (clock.hour === 15 && clock.minute >= 5) ? "closing" : "intraday";
}

function observationPhase(now = new Date()) {
  const clock = shanghaiClock(now);
  if (!clock) return "unknown";
  const minutes = clock.hour * 60 + clock.minute;
  if (minutes < 9 * 60 + 30) return "preopen";
  if (minutes < 15 * 60 + 5) return "intraday";
  return "postclose";
}

function previousCloseTradingDate(limitStats, now = new Date()) {
  const clock = shanghaiClock(now);
  const dates = verifiedProviderDates(limitStats);
  if (!clock) return "";
  if (dates.today && dates.today < clock.date) return dates.today;
  if (dates.today === clock.date) return dates.prev;
  return "";
}

function liveTradingDate(limitStats, now = new Date()) {
  const dates = verifiedProviderDates(limitStats);
  if (dates.today) return dates.today;
  const clock = shanghaiClock(now);
  return clock ? clock.date : "";
}

function publicRankMeta(meta) {
  if (!meta || typeof meta !== "object") return null;
  return {
    provider: meta.provider || null,
    targetCount: HOT_RANK_TARGET,
    actualCount: Number(meta.actualCount || 0),
    complete: meta.complete === true,
    fetchedAt: meta.fetchedAt || null,
    observedAt: meta.observedAt || meta.fetchedAt || null,
    servedAt: meta.servedAt || null,
    tradingDate: meta.tradingDate || null,
    marketDataTradingDate: meta.marketDataTradingDate || null,
    observationPhase: meta.observationPhase || "unknown",
    snapshotKind: meta.snapshotKind || "unknown",
    freshness: meta.freshness || "unavailable",
    sourceQuality: meta.sourceQuality || "unavailable",
    isFallback: meta.isFallback === true,
    fallbackReason: meta.fallbackReason || null,
    error: meta.error || null,
  };
}

function resolveHotRankSource({ source, liveResult, cachedClosing, limitStats, now = new Date() }) {
  const servedAt = now.toISOString();
  const liveRows = canonicalHotRankRows(liveResult && liveResult.rows, source);
  const provider = source === "eastmoney" ? "东方财富热榜" : "同花顺热榜";
  if (liveRows.length) {
    const clock = shanghaiClock(now);
    const phase = observationPhase(now);
    const marketDataTradingDate = liveTradingDate(limitStats, now);
    const isVerifiedClosing = phase === "postclose" && clock && marketDataTradingDate === clock.date;
    const snapshotKind = isVerifiedClosing ? "closing" : phase === "intraday" ? "intraday" : "live-observation";
    const complete = liveRows.length === HOT_RANK_TARGET;
    return {
      rows: liveRows,
      meta: publicRankMeta({
        provider,
        actualCount: liveRows.length,
        complete,
        fetchedAt: liveResult && liveResult.fetchedAt || servedAt,
        observedAt: liveResult && liveResult.fetchedAt || servedAt,
        servedAt,
        tradingDate: clock && clock.date || null,
        marketDataTradingDate,
        observationPhase: phase,
        snapshotKind,
        freshness: phase === "preopen" ? "live-preopen" : phase === "intraday" ? "live-intraday" : phase === "postclose" ? "live-postclose" : "live-date-unverified",
        sourceQuality: `provider-live${complete ? "" : "-partial"}`,
        isFallback: false,
        error: liveResult && liveResult.error || null,
      }),
    };
  }

  const expectedDate = previousCloseTradingDate(limitStats, now);
  const cachedRows = canonicalHotRankRows(cachedClosing && cachedClosing.rows, source);
  const cachedDate = normalizeTradingDate(cachedClosing && cachedClosing.meta && cachedClosing.meta.tradingDate);
  const cachedKind = String(cachedClosing && cachedClosing.meta && cachedClosing.meta.snapshotKind || "");
  const canUseClosing = Boolean(expectedDate && cachedDate === expectedDate && cachedKind === "closing" && cachedRows.length);
  const fallbackReason = liveResult && liveResult.error ? `live-error:${liveResult.error}` : "live-empty";
  if (canUseClosing) {
    const complete = cachedRows.length === HOT_RANK_TARGET;
    return {
      rows: cachedRows,
      meta: publicRankMeta({
        provider,
        actualCount: cachedRows.length,
        complete,
        fetchedAt: cachedClosing.meta.fetchedAt || null,
        observedAt: cachedClosing.meta.observedAt || cachedClosing.meta.fetchedAt || null,
        servedAt,
        tradingDate: cachedDate,
        marketDataTradingDate: cachedClosing.meta.marketDataTradingDate || cachedDate,
        observationPhase: observationPhase(now),
        snapshotKind: "closing",
        freshness: "previous-close",
        sourceQuality: `cached-previous-close${complete ? "" : "-partial"}`,
        isFallback: true,
        fallbackReason,
        error: liveResult && liveResult.error || null,
      }),
    };
  }

  return {
    rows: [],
    meta: publicRankMeta({
      provider,
      actualCount: 0,
      complete: false,
      fetchedAt: null,
      servedAt,
      tradingDate: expectedDate || null,
      snapshotKind: "unknown",
      freshness: "unavailable",
      sourceQuality: "unavailable",
      isFallback: false,
      fallbackReason: `${fallbackReason};verified-previous-close-cache-miss`,
      error: liveResult && liveResult.error || null,
    }),
  };
}

function updateHotRankCache(cache, resolutions, now = new Date()) {
  const previous = cache && typeof cache === "object" ? cache : {};
  const sources = { ...(previous.sources || {}) };
  for (const source of ["eastmoney", "ths"]) {
    const resolution = resolutions && resolutions[source];
    const current = sources[source] && typeof sources[source] === "object" ? sources[source] : {};
    if (!resolution || !resolution.rows || !resolution.rows.length || !resolution.meta || resolution.meta.isFallback) {
      sources[source] = current;
      continue;
    }
    const snapshot = {
      rows: canonicalHotRankRows(resolution.rows, source),
      meta: publicRankMeta(resolution.meta),
    };
    sources[source] = {
      ...current,
      latest: snapshot,
      ...(snapshot.meta.snapshotKind === "closing" ? { lastClosing: snapshot } : {}),
    };
  }
  return {
    version: HOT_RANK_CACHE_VERSION,
    targetCount: HOT_RANK_TARGET,
    updatedAt: now.toISOString(),
    sources,
  };
}

function rankStatusNote(meta) {
  if (!meta || !meta.actualCount) return `0/${HOT_RANK_TARGET}只·无可验证榜单`;
  const mode = meta.isFallback ? "上一交易日收盘缓存" : meta.freshness === "live-preopen" ? "盘前实时热度榜" : meta.freshness === "live-intraday" ? "盘中实时热度榜" : meta.freshness === "live-postclose" ? "盘后实时热度榜" : "源站响应";
  const partial = meta.complete ? "" : "·样本不足100";
  return `${meta.actualCount}/${HOT_RANK_TARGET}只·${mode}${meta.tradingDate ? `·${meta.tradingDate}` : ""}${partial}`;
}

module.exports = {
  HOT_RANK_CACHE_VERSION,
  HOT_RANK_TARGET,
  canonicalHotRankRows,
  normalizeTradingDate,
  observationPhase,
  previousCloseTradingDate,
  publicRankMeta,
  rankStatusNote,
  resolveHotRankSource,
  shanghaiClock,
  snapshotKindFor,
  updateHotRankCache,
  verifiedProviderDates,
};
