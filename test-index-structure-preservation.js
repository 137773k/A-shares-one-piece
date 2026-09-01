"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { _internals } = require("./server");

const CODES = ["000001", "399001", "399006", "000688"];

function completeStructures(date, offset = 0) {
  return CODES.map((code, index) => ({
    code,
    name: `index-${code}`,
    date,
    close: 3900 + index + offset,
    changePct: 0.1 + index,
    ma5: 3800 + index + offset,
    ma10: 3700 + index + offset,
    ma20: 3600 + index + offset,
    ma30: 3500 + index + offset,
    ma60: 3400 + index + offset,
    slope5: 1.2,
    slope5LagDays: 1,
    shortStructureWindowDays: 5,
    slope10: 1.1,
    slope20: 1,
    distance20dLowPct: 8,
    trendKey: "uptrend",
    trendLabel: "test",
    source: "tencent-kline",
  }));
}

function liveIndexes() {
  return CODES.map((code, index) => ({
    code,
    name: `live-${code}`,
    price: 4100 + index,
    changePct: 2 + index,
  }));
}

test("keeps a complete current fetch and marks it as live verified", () => {
  const result = _internals.resolveIndexMarketStructures({
    tradingDate: "2026-08-12",
    fetchedStructures: completeStructures("2026-08-12"),
    liveIndexes: liveIndexes(),
    retainedSnapshots: [],
  });

  assert.equal(result.indexStructures.length, 4);
  assert.equal(result.source, "tencent-kline");
  assert.equal(result.dataQuality.status, "live_verified");
  assert.equal(result.preservedFromEarlierFetch, false);
  assert.ok(result.indexStructures.every((row) => row.preservedFromEarlierFetch === false));
});

test("accepts Tencent raw index K-lines as a verified index-only fallback", () => {
  const rawStructures = completeStructures("2026-08-12").map((row) => ({
    ...row,
    source: "tencent-raw-kline",
    originSource: "tencent-raw-kline",
    priceAdjustment: "none",
  }));
  const result = _internals.resolveIndexMarketStructures({
    tradingDate: "2026-08-12",
    fetchedStructures: rawStructures,
    liveIndexes: liveIndexes(),
    retainedSnapshots: [],
  });

  assert.equal(result.indexStructures.length, 4);
  assert.equal(result.source, "tencent-raw-kline");
  assert.ok(result.indexStructures.every((row) => row.source === "tencent-raw-kline"));
  assert.ok(result.indexStructures.every((row) => row.dataQuality === "live_verified"));
});

test("legacy three-day slope rows are removed before they can masquerade as five-day evidence", () => {
  const legacyRows = completeStructures("2026-08-12").map((row) => {
    const { slope5LagDays, shortStructureWindowDays, ...legacy } = row;
    return legacy;
  });
  const migrated = _internals.invalidateLegacyFiveDayIndexStructures({
    tradingDate: "2026-08-12",
    market: { snapshot: { tradingDate: "2026-08-12", indexStructures: legacyRows } },
  });

  assert.deepEqual(migrated.market.snapshot.indexStructures, []);
  assert.equal(migrated.market.snapshot.indexStructuresDataQuality.status, "unavailable");
  assert.equal(migrated.market.snapshot.indexStructuresDataQuality.reason, "legacy_slope5_window_rejected");
});

test("preserves the newest complete trusted structure from the same trading day", () => {
  const result = _internals.resolveIndexMarketStructures({
    tradingDate: "2026-08-12",
    fetchedStructures: [],
    liveIndexes: liveIndexes(),
    retainedSnapshots: [
      {
        kind: "archive",
        capturedAt: "2026-08-12T06:00:00.000Z",
        snapshot: { indexStructures: completeStructures("2026-08-12", 0) },
      },
      {
        kind: "cache",
        capturedAt: "2026-08-12T07:00:00.000Z",
        snapshot: { indexStructures: completeStructures("2026-08-12", 50) },
      },
    ],
  });

  assert.equal(result.indexStructures.length, 4);
  assert.equal(result.indexStructures[0].ma10, 3750, "newest valid snapshot wins");
  assert.equal(result.indexStructures[0].close, 4100, "current live price is retained");
  assert.equal(result.indexStructures[0].changePct, 2, "current live change is retained");
  assert.ok(result.indexStructures.every((row) => row.date === "2026-08-12"));
  assert.ok(result.indexStructures.every((row) => row.source === "cache:tencent-kline"));
  assert.ok(result.indexStructures.every((row) => row.dataQuality === "same_day_preserved"));
  assert.ok(result.indexStructures.every((row) => row.preservedFromEarlierFetch === true));
  assert.deepEqual(result.dataQuality, {
    status: "same_day_preserved",
    tradingDate: "2026-08-12",
    complete: true,
  });
  assert.equal(result.source, "cache:tencent-kline");
  assert.equal(result.preservedFromEarlierFetch, true);
});

test("rejects a complete structure from a different trading day", () => {
  const result = _internals.resolveIndexMarketStructures({
    tradingDate: "2026-08-12",
    fetchedStructures: [],
    liveIndexes: liveIndexes(),
    retainedSnapshots: [{
      kind: "cache",
      capturedAt: "2026-08-11T07:00:00.000Z",
      snapshot: { indexStructures: completeStructures("2026-08-11") },
    }],
  });

  assert.deepEqual(result.indexStructures, []);
  assert.equal(result.dataQuality.status, "unavailable");
  assert.equal(result.source, "none");
  assert.equal(result.preservedFromEarlierFetch, false);
});

test("fails closed when neither the fetch nor retained history has a complete structure", () => {
  const result = _internals.resolveIndexMarketStructures({
    tradingDate: "2026-08-12",
    fetchedStructures: completeStructures("2026-08-12").slice(0, 3),
    liveIndexes: liveIndexes(),
    retainedSnapshots: [],
  });

  assert.deepEqual(result.indexStructures, []);
  assert.deepEqual(result.dataQuality, {
    status: "unavailable",
    tradingDate: "2026-08-12",
    complete: false,
  });
  assert.equal(result.source, "none");
  assert.equal(result.preservedFromEarlierFetch, false);
});

test("rejects same-day retained rows that are incomplete or not from Tencent K-line", () => {
  const incomplete = completeStructures("2026-08-12");
  incomplete[0].ma60 = null;
  const untrusted = completeStructures("2026-08-12");
  untrusted[1].source = "manual-copy";
  const result = _internals.resolveIndexMarketStructures({
    tradingDate: "2026-08-12",
    fetchedStructures: [],
    liveIndexes: liveIndexes(),
    retainedSnapshots: [
      { kind: "cache", capturedAt: "2026-08-12T08:00:00.000Z", snapshot: { indexStructures: incomplete } },
      { kind: "archive", capturedAt: "2026-08-12T07:00:00.000Z", snapshot: { indexStructures: untrusted } },
    ],
  });

  assert.deepEqual(result.indexStructures, []);
  assert.equal(result.dataQuality.status, "unavailable");
});
