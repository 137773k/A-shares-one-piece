"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { DEFAULT_RETENTION_DAYS } = require("./cache-retention");
const {
  createHotStocksRefreshController,
  createHotStocksAutoRefreshScheduler,
  hotStocksAutoRefreshKey,
  markCycleHistoryUnavailable,
  fetchIntradayLeadershipProfiles,
  fetchJsonDirect,
} = require("./server")._internals;

test("automatic refresh separates pre-close, post-close, and non-trading-day attempts", async () => {
  assert.equal(hotStocksAutoRefreshKey(new Date("2026-08-31T06:00:00.000Z")), "2026-08-31:preclose");
  assert.equal(hotStocksAutoRefreshKey(new Date("2026-08-31T07:06:00.000Z")), "2026-08-31:postclose");
  assert.equal(hotStocksAutoRefreshKey(new Date("2026-08-30T09:00:00.000Z")), "2026-08-30:non_trading_day");

  let now = new Date("2026-08-31T06:00:00.000Z");
  let calls = 0;
  const controller = {
    getStatus: () => ({ inFlight: false }),
    start() {
      calls += 1;
      return { started: true, promise: Promise.resolve({ generationId: `g-${calls}` }) };
    },
  };
  const scheduler = createHotStocksAutoRefreshScheduler(controller, {
    clock: () => now,
    startDelayMs: 60_000,
    checkMs: 60_000,
    retryMs: 1_000,
  });
  try {
    assert.equal(scheduler.run("test").started, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(scheduler.run("test").reason, "already_succeeded");
    now = new Date("2026-08-31T07:06:00.000Z");
    assert.equal(scheduler.run("test").started, true, "post-close is a new daily refresh phase");
    assert.equal(calls, 2);
  } finally {
    scheduler.stop();
  }
});

test("cycle-history failure keeps current observations but closes execution", () => {
  const payload = {
    tradingDate: "2026-08-31",
    executionAuthority: true,
    fetchStatus: { level: "ok", operationalLevel: "live", evidenceStatus: "complete", items: [] },
  };
  markCycleHistoryUnavailable(payload, {
    tradingDate: "2026-08-31",
    reason: "cycle-history-invalid",
    blockers: ["structural_cycle_invalid"],
  });
  assert.equal(payload.tradingDate, "2026-08-31");
  assert.equal(payload.stale, undefined, "fresh observations must not be relabeled as the old cache");
  assert.equal(payload.executionAuthority, false);
  assert.equal(payload.cycleHistoryAvailability.status, "unavailable");
  assert.equal(payload.fetchStatus.level, "partial");
  assert.equal(payload.fetchStatus.evidenceStatus, "incomplete");
  assert.equal(payload.fetchStatus.marketEvidenceStatus, "complete");
  assert.match(payload.fetchStatus.items.at(-1).note, /structural_cycle_invalid/);
});

test("refresh controller exposes the agreed small status contract and reuses one in-flight job", async () => {
  let resolveRefresh;
  let calls = 0;
  const pending = new Promise((resolve) => { resolveRefresh = resolve; });
  const times = [
    new Date("2026-08-20T01:00:00.000Z"),
    new Date("2026-08-20T01:00:05.000Z"),
  ];
  const controller = createHotStocksRefreshController(
    () => {
      calls += 1;
      return pending;
    },
    () => times.shift(),
  );

  assert.deepEqual(controller.getStatus(), {
    status: "idle",
    startedAt: null,
    completedAt: null,
    lastSuccessAt: null,
    generationId: null,
    lastError: null,
    quality: null,
    sourceLevel: null,
    evidenceStatus: null,
    inFlight: false,
  });

  const first = controller.start();
  const second = controller.start();
  assert.equal(first.started, true);
  assert.equal(second.started, false);
  assert.equal(second.promise, first.promise);
  assert.equal(calls, 0, "refresh begins in a microtask but is still single-flight");
  assert.deepEqual(controller.getStatus(), {
    status: "running",
    startedAt: "2026-08-20T01:00:00.000Z",
    completedAt: null,
    lastSuccessAt: null,
    generationId: null,
    lastError: null,
    quality: null,
    sourceLevel: null,
    evidenceStatus: null,
    inFlight: true,
  });

  await Promise.resolve();
  assert.equal(calls, 1);
  resolveRefresh({ generationId: "2026-08-20:generation-1", fetchedAt: "ignored" });
  await first.promise;
  assert.deepEqual(controller.getStatus(), {
    status: "succeeded",
    startedAt: "2026-08-20T01:00:00.000Z",
    completedAt: "2026-08-20T01:00:05.000Z",
    lastSuccessAt: "2026-08-20T01:00:05.000Z",
    generationId: "2026-08-20:generation-1",
    lastError: null,
    quality: "unknown",
    sourceLevel: null,
    evidenceStatus: null,
    inFlight: false,
  });
});

test("refresh controller marks stamped disk fallback as failed and keeps the payload out of status", async () => {
  const times = [
    new Date("2026-08-20T02:00:00.000Z"),
    new Date("2026-08-20T02:00:01.000Z"),
  ];
  const controller = createHotStocksRefreshController(
    async () => ({ stale: true, fetchError: "upstream unavailable", candidates: new Array(100).fill({ code: "x" }) }),
    () => times.shift(),
  );

  await assert.rejects(controller.start().promise, /upstream unavailable/);
  assert.deepEqual(controller.getStatus(), {
    status: "failed",
    startedAt: "2026-08-20T02:00:00.000Z",
    completedAt: "2026-08-20T02:00:01.000Z",
    lastSuccessAt: null,
    generationId: null,
    lastError: "upstream unavailable",
    quality: null,
    sourceLevel: null,
    evidenceStatus: null,
    inFlight: false,
  });
  assert.equal("candidates" in controller.getStatus(), false, "status must never contain the large market payload");
});

test("refresh controller rejects every stale payload even when fetchError is absent", async () => {
  const times = [
    new Date("2026-08-20T02:10:00.000Z"),
    new Date("2026-08-20T02:10:01.000Z"),
  ];
  const controller = createHotStocksRefreshController(
    async () => ({ stale: true, generationId: "2026-08-19:retained" }),
    () => times.shift(),
  );

  await assert.rejects(controller.start().promise, /过期快照/);
  assert.equal(controller.getStatus().status, "failed");
  assert.equal(controller.getStatus().generationId, null);
});

test("refresh controller cannot report success without an explicit generation id", async () => {
  const times = [
    new Date("2026-08-20T02:20:00.000Z"),
    new Date("2026-08-20T02:20:01.000Z"),
  ];
  const controller = createHotStocksRefreshController(
    async () => ({ fetchedAt: "2026-08-20T02:20:00.000Z" }),
    () => times.shift(),
  );

  await assert.rejects(controller.start().promise, /generationId/);
  assert.equal(controller.getStatus().status, "failed");
  assert.equal(controller.getStatus().generationId, null);
});

test("cache GET route is read-only while successful refresh persistence remains present", () => {
  const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  assert.match(
    source,
    /pathname === "\/api\/hot-stocks\/status"[\s\S]*?sendJson\(response, 200, \{ ok: true, refresh: hotStocksRefreshController\.getStatus\(\) \}\)/,
  );
  assert.match(
    source,
    /pathname === "\/api\/hot-stocks\/refresh"[\s\S]*?request\.method !== "POST"[\s\S]*?sendJson\(response, 202, \{ ok: true, refresh: started\.refresh \}\)/,
  );
  const routeStart = source.indexOf('if (pathname === "/api/hot-stocks/cache")');
  const routeEnd = source.indexOf('if (pathname === "/api/core-watch/list")', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const route = source.slice(routeStart, routeEnd);

  assert.match(route, /request\.method !== "GET"/);
  assert.doesNotMatch(route, /writeRetainedJson|writeJsonFile|autoArchiveMarketSnapshot|syncCoreWatchPool|writeFile/);
  assert.match(source, /autoArchiveMarketSnapshot\(payload, \{[\s\S]*?trigger: "successful-fetch",[\s\S]*?generationContext,[\s\S]*?\}\);/);
  assert.match(
    source,
    /const retainedPayload = writeRetainedJson\(hotStocksCacheFile, payload, \{ archiveDir: hotStocksCacheArchiveDir \}\);[\s\S]*?if \(!retainedPayload\)[\s\S]*?HOT_STOCKS_CACHE_WRITE_FAILED/,
  );
  const preopenStart = source.indexOf('if (preopenBasis.status === "frozen_closing")');
  const preopenEnd = source.indexOf("const combinedEventCalendar", preopenStart);
  assert.ok(preopenStart >= 0 && preopenEnd > preopenStart);
  const preopenBranches = source.slice(preopenStart, preopenEnd);
  assert.equal((preopenBranches.match(/HOT_STOCKS_CACHE_WRITE_FAILED/g) || []).length, 2);
  assert.equal(DEFAULT_RETENTION_DAYS, 30);
});

test("native fetch and curl fallback share one total deadline", async () => {
  let curlCalls = 0;
  const startedAt = Date.now();
  await assert.rejects(
    fetchJsonDirect("https://example.invalid/slow-json", {
      timeoutMs: 120,
      _fetchImpl: async () => new Promise(() => {}),
      _execFileAsync: async () => {
        curlCalls += 1;
        return { stdout: "{}" };
      },
    }),
    (error) => error && error.code === "FETCH_DEADLINE_EXCEEDED",
  );
  const elapsedMs = Date.now() - startedAt;
  assert.equal(curlCalls, 0, "curl must not restart a full timeout after native exhausted the deadline");
  assert.ok(elapsedMs >= 80 && elapsedMs < 600, `deadline elapsed ${elapsedMs}ms`);
});

test("curl fallback still succeeds inside the native request's remaining budget", async () => {
  let curlTimeoutMs = null;
  const payload = await fetchJsonDirect("https://example.invalid/fast-fallback", {
    timeoutMs: 500,
    _fetchImpl: async () => { throw new Error("native unavailable"); },
    _execFileAsync: async (_command, _args, options) => {
      curlTimeoutMs = options.timeout;
      return { stdout: '{"ok":true}' };
    },
  });

  assert.deepEqual(payload, { ok: true });
  assert.ok(curlTimeoutMs > 0 && curlTimeoutMs <= 500, `curl timeout ${curlTimeoutMs}ms`);
});

test("K-line熔断不再跳过分时，东财分时失败后用腾讯同日分钟线兜底", async () => {
  const state = {
    eastDisabled: true,
    eastFailures: 3,
    _skipIntradayCache: true,
    _intradayFetchJson: async (url) => {
      if (url.includes("push2his.eastmoney.com")) throw new Error("east intraday unavailable");
      return {
        data: {
          sh600000: {
            data: {
              date: "20260820",
              data: ["0930 10.10 100 1010.00", "0931 10.30 220 2246.00"],
            },
            qt: { sh600000: ["1", "fixture", "600000", "10.30", "10.00"] },
          },
        },
      };
    },
  };
  const result = await fetchIntradayLeadershipProfiles(
    [{ code: "600000", secCode: "SH600000", name: "fixture", prevClose: 10 }],
    { items: [], mainLine: null },
    "2026-08-20",
    state,
  );
  assert.ok(result instanceof Map);
  assert.equal(result.size, 1);
  assert.equal(result.get("600000").source, "tencent_minute_query");
  assert.equal(result.get("600000").tradingDate, "2026-08-20");
  assert.equal(state.eastDisabled, true, "日K熔断状态不得被分时模块改写");
  assert.equal(state.intradayLeadership.sourceCounts.tencent, 1);
});
