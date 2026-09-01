"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  HOT_RANK_TARGET,
  canonicalHotRankRows,
  resolveHotRankSource,
  updateHotRankCache,
} = require("./hot-rank-source");

function rows(source, count = HOT_RANK_TARGET) {
  const field = source === "eastmoney" ? "eastRank" : "thsRank";
  return Array.from({ length: count }, (_, index) => ({
    code: String(600000 + index).padStart(6, "0"),
    [field]: index + 1,
  }));
}

const preopenNow = new Date("2026-08-11T01:19:00.000Z");
const verifiedPreviousCloseDates = {
  dates: { today: "20260810", prev: "20260807", verified: true },
};

test("canonicalHotRankRows keeps a real unique Top100 without padding", () => {
  const input = [
    ...rows("eastmoney", 100),
    { code: "600000", eastRank: 88 },
    { code: "999999", eastRank: 101 },
    { code: "bad", eastRank: 1 },
  ];
  const actual = canonicalHotRankRows(input, "eastmoney");
  assert.equal(actual.length, 100);
  assert.equal(new Set(actual.map((item) => item.code)).size, 100);
  assert.deepEqual(actual.map((item) => item.eastRank), Array.from({ length: 100 }, (_, index) => index + 1));

  const partial = canonicalHotRankRows(rows("eastmoney", 3), "eastmoney");
  assert.equal(partial.length, 3, "a short provider response must stay short instead of being filled");
});

test("a non-empty preopen provider response stays live attention data", () => {
  const result = resolveHotRankSource({
    source: "eastmoney",
    liveResult: { rows: rows("eastmoney"), fetchedAt: preopenNow.toISOString(), error: null },
    cachedClosing: null,
    limitStats: verifiedPreviousCloseDates,
    now: preopenNow,
  });
  assert.equal(result.rows.length, 100);
  assert.equal(result.meta.freshness, "live-preopen");
  assert.equal(result.meta.observationPhase, "preopen");
  assert.equal(result.meta.tradingDate, "2026-08-11");
  assert.equal(result.meta.marketDataTradingDate, "2026-08-10");
  assert.equal(result.meta.snapshotKind, "live-observation");
  assert.equal(result.meta.sourceQuality, "provider-live");
  assert.equal(result.meta.isFallback, false);

  const cache = updateHotRankCache({}, { eastmoney: result }, preopenNow);
  assert.equal(cache.sources.eastmoney.latest.rows.length, 100);
  assert.equal(cache.sources.eastmoney.lastClosing, undefined, "preopen live data must not impersonate or overwrite a closing list");
});

test("an empty preopen source may use only the verified previous close", () => {
  const cachedClosing = {
    rows: rows("ths"),
    meta: {
      fetchedAt: "2026-08-10T07:10:00.000Z",
      observedAt: "2026-08-10T07:10:00.000Z",
      tradingDate: "2026-08-10",
      marketDataTradingDate: "2026-08-10",
      snapshotKind: "closing",
    },
  };
  const result = resolveHotRankSource({
    source: "ths",
    liveResult: { rows: [], fetchedAt: preopenNow.toISOString(), error: "provider-empty" },
    cachedClosing,
    limitStats: verifiedPreviousCloseDates,
    now: preopenNow,
  });
  assert.equal(result.rows.length, 100);
  assert.equal(result.meta.freshness, "previous-close");
  assert.equal(result.meta.sourceQuality, "cached-previous-close");
  assert.equal(result.meta.tradingDate, "2026-08-10");
  assert.equal(result.meta.isFallback, true);
  assert.match(result.meta.fallbackReason, /provider-empty/);
});

test("wrong-date or intraday caches are rejected instead of presented as a closing list", () => {
  for (const cachedClosing of [
    { rows: rows("eastmoney"), meta: { tradingDate: "2026-08-07", snapshotKind: "closing" } },
    { rows: rows("eastmoney"), meta: { tradingDate: "2026-08-10", snapshotKind: "intraday" } },
  ]) {
    const result = resolveHotRankSource({
      source: "eastmoney",
      liveResult: { rows: [], error: "empty" },
      cachedClosing,
      limitStats: verifiedPreviousCloseDates,
      now: preopenNow,
    });
    assert.equal(result.rows.length, 0);
    assert.equal(result.meta.sourceQuality, "unavailable");
    assert.match(result.meta.fallbackReason, /cache-miss/);
  }
});

test("a verified post-close live response becomes the next fallback snapshot", () => {
  const postcloseNow = new Date("2026-08-11T07:10:00.000Z");
  const result = resolveHotRankSource({
    source: "ths",
    liveResult: { rows: rows("ths"), fetchedAt: postcloseNow.toISOString() },
    cachedClosing: null,
    limitStats: { dates: { today: "20260811", prev: "20260810", verified: true } },
    now: postcloseNow,
  });
  assert.equal(result.meta.freshness, "live-postclose");
  assert.equal(result.meta.snapshotKind, "closing");
  const cache = updateHotRankCache({}, { ths: result }, postcloseNow);
  assert.equal(cache.sources.ths.lastClosing.meta.tradingDate, "2026-08-11");
  assert.equal(cache.sources.ths.lastClosing.rows.length, 100);
});
