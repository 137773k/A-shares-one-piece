"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const scriptSource = fs.readFileSync(path.join(__dirname, "script.js"), "utf8");

function extractFunction(source, name) {
  const asyncMarker = `async function ${name}(`;
  const plainMarker = `function ${name}(`;
  const start = source.indexOf(asyncMarker) >= 0 ? source.indexOf(asyncMarker) : source.indexOf(plainMarker);
  assert.notEqual(start, -1, `missing ${name}`);
  const paramsStart = source.indexOf("(", start);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    if (source[index] === "(") paramsDepth += 1;
    if (source[index] === ")") paramsDepth -= 1;
    if (paramsDepth === 0) {
      paramsEnd = index;
      break;
    }
  }
  const brace = source.indexOf("{", paramsEnd);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

function button(label) {
  return {
    disabled: false,
    textContent: label,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
  };
}

function recentRefreshPayload() {
  const fetchedAt = new Date(Date.now() - 1_000).toISOString();
  const tradingDate = fetchedAt.slice(0, 10);
  return {
    generationId: `${tradingDate}:${fetchedAt}`,
    tradingDate,
    fetchedAt,
    stale: false,
    fetchStatus: {
      level: "ok",
      mode: "live_complete",
      evidenceStatus: "complete",
      items: [{
        name: "K线/均线",
        ok: true,
        statusKey: "live_complete",
        requestedCount: 1,
        unavailableCount: 0,
      }],
    },
    sources: {
      klineDiagnostics: {
        version: 2,
        statusKey: "live_complete",
        expectedCompletedTradingDate: tradingDate,
        requested: 1,
        east: 1,
        tencent: 0,
        cached: 0,
        sameDayCache: 0,
        unavailable: 0,
        failed: 0,
      },
    },
  };
}

function installDirectBuyFreshness(sandbox) {
  sandbox.PREMARKET_DIRECT_BUY_MAX_AGE_MS = 20 * 60 * 60 * 1000;
  sandbox.premarketDirectBuyFreshPayloads = new WeakMap();
  sandbox.premarketDirectBuyFreshnessTimer = null;
  sandbox.premarketDirectBuyFreshnessTimerPayload = null;
  if (typeof sandbox.setTimeout !== "function") sandbox.setTimeout = setTimeout;
  if (typeof sandbox.clearTimeout !== "function") sandbox.clearTimeout = clearTimeout;
  vm.runInNewContext(
    [
      extractFunction(scriptSource, "postCloseOpportunityText"),
      extractFunction(scriptSource, "resolveKlineFetchDisplayStatus"),
      extractFunction(scriptSource, "resolvePayloadExecutionFreshness"),
      extractFunction(scriptSource, "resolveLatestCompletedTradingDaySnapshot"),
      extractFunction(scriptSource, "premarketDirectBuyPayloadGeneration"),
      extractFunction(scriptSource, "premarketDirectBuyPayloadTimestamp"),
      extractFunction(scriptSource, "premarketDirectBuyPayloadFresh"),
      extractFunction(scriptSource, "setPremarketDirectBuyPayloadFresh"),
      "this.markDirectBuyFresh = setPremarketDirectBuyPayloadFresh;",
      "this.isDirectBuyFresh = premarketDirectBuyPayloadFresh;",
      "this.resolveExecutionFreshness = resolvePayloadExecutionFreshness;",
      "this.resolveLatestCompletedTradingDay = resolveLatestCompletedTradingDaySnapshot;",
    ].join("\n"),
    sandbox,
  );
}

test("fetch timeout remains active while response JSON body is being consumed", async () => {
  const sandbox = {
    AbortController,
    Error,
    setTimeout,
    clearTimeout,
    fetch: async (_url, options) => ({
      json() {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("body aborted")), { once: true });
        });
      },
    }),
  };
  vm.runInNewContext(
    `${extractFunction(scriptSource, "fetchWithTimeout")}; this.fetchWithTimeout = fetchWithTimeout;`,
    sandbox,
  );
  await assert.rejects(
    sandbox.fetchWithTimeout("/slow-body", {}, 15, async (response) => response.json()),
    /抓取超时/,
  );
});

test("refresh contract normalization follows the backend refresh.status contract", () => {
  const sandbox = {};
  vm.runInNewContext(
    `${extractFunction(scriptSource, "normalizeHotStocksRefreshContract")}; this.normalize = normalizeHotStocksRefreshContract;`,
    sandbox,
  );
  const normalized = sandbox.normalize({
    ok: true,
    refresh: {
      status: "running",
      inFlight: true,
      startedAt: "2026-08-20T01:00:00.000Z",
      generationId: "g-1",
      lastError: null,
    },
  });
  assert.equal(normalized.status, "running");
  assert.equal(normalized.inFlight, true);
  assert.equal(normalized.generationId, "g-1");
  assert.equal(sandbox.normalize({ refresh: { status: "completed" } }).status, "succeeded");
  assert.equal(sandbox.normalize({ ok: true }), null);
});

test("polling stops on success, backend failure, and the bounded deadline", async () => {
  const sandbox = { Error, Promise, setTimeout };
  vm.runInNewContext(
    [
      extractFunction(scriptSource, "hotStocksRefreshFailure"),
      extractFunction(scriptSource, "hotStocksRefreshTimeout"),
      extractFunction(scriptSource, "pollHotStocksRefresh"),
      "this.poll = pollHotStocksRefresh;",
    ].join("\n"),
    sandbox,
  );

  let statusCalls = 0;
  const completed = await sandbox.poll(
    { status: "running" },
    {
      now: () => 0,
      deadlineAt: 100,
      intervalMs: 0,
      sleep: async () => {},
      requestStatus: async () => {
        statusCalls += 1;
        return { status: "succeeded", generationId: "g-2" };
      },
    },
  );
  assert.equal(completed.status, "succeeded");
  assert.equal(statusCalls, 1);

  await assert.rejects(
    sandbox.poll({ status: "failed", lastError: "source unavailable" }, {
      now: () => 0,
      deadlineAt: 100,
      intervalMs: 0,
      sleep: async () => {},
      requestStatus: async () => ({ status: "succeeded" }),
    }),
    /source unavailable/,
  );

  let clock = 0;
  await assert.rejects(
    sandbox.poll({ status: "running" }, {
      now: () => clock,
      deadlineAt: 120,
      intervalMs: 60,
      sleep: async (delay) => { clock += delay; },
      requestStatus: async () => ({ status: "running" }),
    }),
    /120秒/,
  );
});

test("all three refresh buttons are restored even when rendering throws", async () => {
  const primary = button("抓取热股池并筛选");
  const dashboard = button("抓取并刷新");
  const decision = button("一键抓取并生成决策");
  const sandbox = {
    console: { error() {} },
    fetchHotStocks: primary,
    fetchHotStocksDash: dashboard,
    selectedStocks: { innerHTML: "" },
    rejectedStocks: { innerHTML: "" },
    lastHotPayload: null,
    document: {
      querySelector(selector) {
        if (selector === "#fetchHotStocksDecision") return decision;
        return null;
      },
    },
    hasReadyPostCloseOpportunity() { return false; },
    renderPostCloseOpportunity() { throw new Error("DOM detached"); },
    setText() {},
    renderFetchStatus() {},
    escapeHtml(value) { return String(value); },
  };
  vm.runInNewContext(
    [
      extractFunction(scriptSource, "hotStocksSetButtonsLoading"),
      extractFunction(scriptSource, "hotStocksFriendlyError"),
      extractFunction(scriptSource, "hotStocksRenderRefreshStage"),
      extractFunction(scriptSource, "performHotStocksLoad"),
      "this.perform = performHotStocksLoad;",
    ].join("\n"),
    sandbox,
  );
  const result = await sandbox.perform({ preserveCurrent: false });
  assert.equal(result.ok, false);
  assert.equal(primary.disabled, false);
  assert.equal(dashboard.disabled, false);
  assert.equal(decision.disabled, false);
  assert.equal(primary.textContent, "抓取热股池并筛选");
  assert.equal(dashboard.textContent, "抓取并刷新");
  assert.equal(decision.textContent, "一键抓取并生成决策");
});

test("multiple entry points share one in-flight refresh", async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const sandbox = {
    hotStocksRefreshFlight: null,
    performHotStocksLoad: async () => {
      calls += 1;
      await pending;
      return { ok: true };
    },
  };
  vm.runInNewContext(
    `let hotStocksRefreshFlight = null; ${extractFunction(scriptSource, "loadHotStocks")} this.load = loadHotStocks;`,
    sandbox,
  );
  const first = sandbox.load({ reason: "decision" });
  const second = sandbox.load({ reason: "dashboard" });
  assert.equal(calls, 1);
  release();
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  await sandbox.load({ reason: "manual" });
  assert.equal(calls, 2);
});

test("background success reads and renders the full cache exactly once", async () => {
  const primary = button("抓取热股池并筛选");
  const dashboard = button("抓取并刷新");
  const decision = button("一键抓取并生成决策");
  const calls = [];
  const rendered = [];
  const renderedFlows = [];
  const statuses = [];
  const freshPayload = recentRefreshPayload();
  const sandbox = {
    console: { error() {} },
    Date,
    Error,
    Promise,
    setTimeout,
    HOT_STOCKS_REFRESH_POLL_TIMEOUT_MS: 120000,
    HOT_STOCKS_REFRESH_POLL_INTERVAL_MS: 0,
    HOT_STOCKS_REFRESH_REQUEST_TIMEOUT_MS: 10000,
    HOT_STOCKS_FETCH_TIMEOUT_MS: 85000,
    fetchHotStocks: primary,
    fetchHotStocksDash: dashboard,
    selectedStocks: { innerHTML: "cached selection" },
    rejectedStocks: { innerHTML: "cached rejection" },
    lastHotPayload: { fetchedAt: "2026-08-19T02:00:00.000Z" },
    document: {
      querySelector(selector) {
        if (selector === "#fetchHotStocksDecision") return decision;
        if (selector === "#decisionPicksBody") return { innerHTML: "cached picks" };
        return null;
      },
    },
    hasReadyPostCloseOpportunity() { return true; },
    renderPostCloseOpportunity() { throw new Error("cached report must not be cleared"); },
    setText() {},
    renderFetchStatus(status) { statuses.push(status.label); },
    renderHotStocks(payload) { rendered.push(payload); sandbox.lastHotPayload = payload; },
    renderPremarketFlow(payload) { renderedFlows.push(payload); },
    setDecisionAuthority() {},
    loadRealtime() {},
    escapeHtml(value) { return String(value); },
    loadHotStocksLegacyRequest() { throw new Error("legacy fallback should not run"); },
    async hotStocksJsonRequest(url) {
      calls.push(url);
      if (url.endsWith("/refresh")) {
        return { response: { ok: true, status: 202 }, payload: { ok: true, refresh: { status: "running", inFlight: true } } };
      }
      if (url.endsWith("/status")) {
        return {
          response: { ok: true, status: 200 },
          payload: {
            ok: true,
            refresh: {
              status: "succeeded",
              inFlight: false,
              generationId: freshPayload.generationId,
            },
          },
        };
      }
      if (url.endsWith("/cache")) return { response: { ok: true, status: 200 }, payload: freshPayload };
      throw new Error(`unexpected URL ${url}`);
    },
  };
  installDirectBuyFreshness(sandbox);
  vm.runInNewContext(
    [
      extractFunction(scriptSource, "hotStocksSetButtonsLoading"),
      extractFunction(scriptSource, "hotStocksFriendlyError"),
      extractFunction(scriptSource, "hotStocksRenderRefreshStage"),
      extractFunction(scriptSource, "normalizeHotStocksRefreshContract"),
      extractFunction(scriptSource, "hotStocksRefreshFailure"),
      extractFunction(scriptSource, "hotStocksRefreshTimeout"),
      extractFunction(scriptSource, "pollHotStocksRefresh"),
      extractFunction(scriptSource, "loadHotStocksRefreshCache"),
      extractFunction(scriptSource, "performHotStocksLoad"),
      "this.perform = performHotStocksLoad;",
    ].join("\n"),
    sandbox,
  );

  const result = await sandbox.perform({ preserveCurrent: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.mode, "background");
  assert.equal(result.source, "/api/hot-stocks");
  assert.equal(result.refreshSource, "/api/hot-stocks/refresh");
  assert.equal(result.transport, "background-refresh");
  assert.equal(result.fresh, true);
  assert.equal(sandbox.isDirectBuyFresh(freshPayload), true);
  assert.equal(calls.filter((url) => url.endsWith("/cache")).length, 1);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0], freshPayload);
  assert.equal(renderedFlows.at(-1), freshPayload);
  assert.ok(statuses.some((label) => label.includes("已有快照") && label.includes("后台刷新中")));
  assert.ok(statuses.some((label) => label.includes("后台刷新完成")));
  assert.equal(primary.disabled, false);
  assert.equal(dashboard.disabled, false);
  assert.equal(decision.disabled, false);
});

test("successful non-trading-day refresh reuses the latest completed trading-day snapshot", async () => {
  const payload = recentRefreshPayload();
  payload.fetchedAt = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
  payload.tradingDate = payload.fetchedAt.slice(0, 10);
  payload.generationId = `${payload.tradingDate}:${payload.fetchedAt}`;
  payload.sources.klineDiagnostics.expectedCompletedTradingDate = payload.tradingDate;
  const statuses = [];
  const rendered = [];
  const sandbox = {
    console: { error() {} },
    Date,
    Error,
    Promise,
    setTimeout,
    clearTimeout,
    HOT_STOCKS_REFRESH_POLL_TIMEOUT_MS: 120000,
    HOT_STOCKS_REFRESH_POLL_INTERVAL_MS: 0,
    HOT_STOCKS_REFRESH_REQUEST_TIMEOUT_MS: 10000,
    HOT_STOCKS_FETCH_TIMEOUT_MS: 85000,
    fetchHotStocks: button("抓取热股池并筛选"),
    fetchHotStocksDash: button("抓取并刷新"),
    selectedStocks: { innerHTML: "cached selection" },
    rejectedStocks: { innerHTML: "cached rejection" },
    lastHotPayload: { fetchedAt: "2026-08-19T02:00:00.000Z" },
    document: {
      querySelector(selector) {
        if (selector === "#fetchHotStocksDecision") return button("一键抓取并生成决策");
        if (selector === "#decisionPicksBody") return { innerHTML: "cached picks" };
        return null;
      },
    },
    hasReadyPostCloseOpportunity() { return true; },
    renderPostCloseOpportunity() {},
    setText() {},
    renderFetchStatus(status) { statuses.push(status.label); },
    renderHotStocks(value) { rendered.push(value); sandbox.lastHotPayload = value; },
    renderPremarketFlow() {},
    setDecisionAuthority() {},
    loadRealtime() {},
    escapeHtml(value) { return String(value); },
    async hotStocksJsonRequest(url) {
      if (url.endsWith("/refresh")) {
        return { response: { ok: true, status: 202 }, payload: { refresh: { status: "running", inFlight: true } } };
      }
      if (url.endsWith("/status")) {
        return { response: { ok: true, status: 200 }, payload: { refresh: { status: "succeeded", generationId: payload.generationId } } };
      }
      if (url.endsWith("/cache")) return { response: { ok: true, status: 200 }, payload };
      throw new Error(`unexpected URL ${url}`);
    },
  };
  installDirectBuyFreshness(sandbox);
  vm.runInNewContext(
    [
      extractFunction(scriptSource, "hotStocksSetButtonsLoading"),
      extractFunction(scriptSource, "hotStocksFriendlyError"),
      extractFunction(scriptSource, "hotStocksRenderRefreshStage"),
      extractFunction(scriptSource, "normalizeHotStocksRefreshContract"),
      extractFunction(scriptSource, "hotStocksRefreshFailure"),
      extractFunction(scriptSource, "hotStocksRefreshTimeout"),
      extractFunction(scriptSource, "pollHotStocksRefresh"),
      extractFunction(scriptSource, "loadHotStocksRefreshCache"),
      extractFunction(scriptSource, "performHotStocksLoad"),
      "this.perform = performHotStocksLoad;",
    ].join("\n"),
    sandbox,
  );

  const result = await sandbox.perform({ preserveCurrent: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.fresh, false);
  assert.equal(result.reusedLatestCompletedTradingDay, true);
  assert.equal(rendered.at(-1), payload);
  assert.ok(statuses.some((label) => label.includes("后台刷新完成") && label.includes("当前无新交易日数据")));
  assert.ok(statuses.some((label) => label.includes(payload.tradingDate) && label.includes("收盘快照")));
  assert.equal(statuses.some((label) => label.includes("后台刷新失败")), false);
});

test("successful partial refresh renders current observation data while execution stays closed", async () => {
  const payload = recentRefreshPayload();
  payload.fetchStatus = {
    level: "partial",
    mode: "unavailable",
    evidenceStatus: "incomplete",
    items: [{
      name: "K线/均线",
      ok: false,
      statusKey: "unavailable",
      requestedCount: 2,
      unavailableCount: 1,
    }],
  };
  payload.sources.klineDiagnostics = {
    version: 2,
    statusKey: "unavailable",
    expectedCompletedTradingDate: payload.tradingDate,
    requested: 2,
    east: 1,
    tencent: 0,
    cached: 0,
    sameDayCache: 0,
    unavailable: 1,
    failed: 1,
  };
  const statuses = [];
  const rendered = [];
  const renderedFlows = [];
  const sandbox = {
    console: { error() {} },
    Date,
    Error,
    Promise,
    setTimeout,
    clearTimeout,
    HOT_STOCKS_REFRESH_POLL_TIMEOUT_MS: 120000,
    HOT_STOCKS_REFRESH_POLL_INTERVAL_MS: 0,
    HOT_STOCKS_REFRESH_REQUEST_TIMEOUT_MS: 10000,
    HOT_STOCKS_FETCH_TIMEOUT_MS: 85000,
    fetchHotStocks: button("抓取热股池并筛选"),
    fetchHotStocksDash: button("抓取并刷新"),
    selectedStocks: { innerHTML: "" },
    rejectedStocks: { innerHTML: "" },
    lastHotPayload: null,
    document: {
      querySelector(selector) {
        if (selector === "#fetchHotStocksDecision") return button("一键抓取并生成决策");
        if (selector === "#decisionPicksBody") return { innerHTML: "" };
        return null;
      },
    },
    hasReadyPostCloseOpportunity() { return false; },
    renderPostCloseOpportunity() {},
    setText() {},
    renderFetchStatus(status) { statuses.push(status.label); },
    renderHotStocks(value) { rendered.push(value); sandbox.lastHotPayload = value; },
    renderPremarketFlow(value) { renderedFlows.push(value); },
    setDecisionAuthority(authority, value) {
      assert.equal(authority, "local");
      assert.equal(value, payload);
    },
    loadRealtime() {},
    escapeHtml(value) { return String(value); },
    async hotStocksJsonRequest(url) {
      if (url.endsWith("/refresh")) {
        return { response: { ok: true, status: 202 }, payload: { refresh: { status: "running", inFlight: true } } };
      }
      if (url.endsWith("/status")) {
        return { response: { ok: true, status: 200 }, payload: { refresh: { status: "succeeded", generationId: payload.generationId } } };
      }
      if (url.endsWith("/cache")) return { response: { ok: true, status: 200 }, payload };
      throw new Error(`unexpected URL ${url}`);
    },
  };
  installDirectBuyFreshness(sandbox);
  vm.runInNewContext(
    [
      extractFunction(scriptSource, "hotStocksSetButtonsLoading"),
      extractFunction(scriptSource, "hotStocksFriendlyError"),
      extractFunction(scriptSource, "hotStocksRenderRefreshStage"),
      extractFunction(scriptSource, "normalizeHotStocksRefreshContract"),
      extractFunction(scriptSource, "hotStocksRefreshFailure"),
      extractFunction(scriptSource, "hotStocksRefreshTimeout"),
      extractFunction(scriptSource, "pollHotStocksRefresh"),
      extractFunction(scriptSource, "loadHotStocksRefreshCache"),
      extractFunction(scriptSource, "performHotStocksLoad"),
      "this.perform = performHotStocksLoad;",
    ].join("\n"),
    sandbox,
  );

  const result = await sandbox.perform({ preserveCurrent: false });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.fresh, false);
  assert.equal(result.observationOnly, true);
  assert.equal(result.reusedLatestCompletedTradingDay, false);
  assert.equal(payload.clientRefreshVerified, true);
  assert.equal(sandbox.isDirectBuyFresh(payload), false);
  assert.equal(rendered.at(-1), payload);
  assert.equal(renderedFlows.at(-1), payload);
  assert.ok(statuses.some((label) => label.includes(payload.tradingDate) && label.includes("数据已抓取") && label.includes("仅供观察")));
  assert.equal(statuses.some((label) => label.includes("后台刷新失败")), false);
});

test("refresh cache generation mismatch fails closed before rendering", async () => {
  const cachedPayload = recentRefreshPayload();
  const rendered = [];
  const sandbox = {
    Date,
    Error,
    HOT_STOCKS_FETCH_TIMEOUT_MS: 85000,
    async hotStocksJsonRequest(url) {
      assert.equal(url, "/api/hot-stocks/cache");
      return { response: { ok: true, status: 200 }, payload: cachedPayload };
    },
    renderHotStocks(payload) { rendered.push(payload); },
    renderPremarketFlow() { throw new Error("wrong-generation payload must not render"); },
    setDecisionAuthority() {},
    loadRealtime() {},
  };
  installDirectBuyFreshness(sandbox);
  vm.runInNewContext(
    [
      extractFunction(scriptSource, "loadHotStocksRefreshCache"),
      "this.loadRefreshCache = loadHotStocksRefreshCache;",
    ].join("\n"),
    sandbox,
  );

  const wrongGeneration = `${cachedPayload.tradingDate}:different-generation`;
  await assert.rejects(
    sandbox.loadRefreshCache({ expectedGeneration: wrongGeneration }),
    (error) => error && error.code === "HOT_STOCKS_REFRESH_GENERATION_MISMATCH",
  );
  assert.equal(rendered.length, 0);
  assert.equal(sandbox.isDirectBuyFresh(cachedPayload), false);
});

test("refresh cache rendering failures revoke direct-buy freshness", async () => {
  for (const failingStage of ["renderHotStocks", "renderPremarketFlow"]) {
    const payload = recentRefreshPayload();
    const sandbox = {
      Date,
      Error,
      HOT_STOCKS_FETCH_TIMEOUT_MS: 85000,
      async hotStocksJsonRequest() {
        return { response: { ok: true, status: 200 }, payload };
      },
      renderHotStocks() {
        if (failingStage === "renderHotStocks") throw new Error(failingStage);
      },
      renderPremarketFlow() {
        if (failingStage === "renderPremarketFlow") throw new Error(failingStage);
      },
      setDecisionAuthority() {},
      loadRealtime() {},
    };
    installDirectBuyFreshness(sandbox);
    vm.runInNewContext(
      [
        extractFunction(scriptSource, "loadHotStocksRefreshCache"),
        "this.loadRefreshCache = loadHotStocksRefreshCache;",
      ].join("\n"),
      sandbox,
    );

    await assert.rejects(
      sandbox.loadRefreshCache({ expectedGeneration: payload.generationId }),
      new RegExp(failingStage),
    );
    assert.equal(
      sandbox.isDirectBuyFresh(payload),
      false,
      `${failingStage} failures must revoke direct-buy freshness`,
    );
  }
});

test("freshness expiry automatically removes a visible direct-buy authorization", () => {
  const payload = recentRefreshPayload();
  let expiryCallback = null;
  let expiryDelay = null;
  let rerenders = 0;
  const sandbox = {
    Date,
    lastHotPayload: payload,
    renderPremarketFlow(value) {
      assert.equal(value, payload);
      rerenders += 1;
    },
    setTimeout(callback, delay) {
      expiryCallback = callback;
      expiryDelay = delay;
      return { unref() {} };
    },
    clearTimeout() {},
  };
  installDirectBuyFreshness(sandbox);

  assert.equal(sandbox.markDirectBuyFresh(payload, true), true);
  assert.equal(sandbox.isDirectBuyFresh(payload), true);
  assert.equal(typeof expiryCallback, "function");
  assert.ok(expiryDelay > 19 * 60 * 60 * 1000);

  expiryCallback();
  assert.equal(sandbox.isDirectBuyFresh(payload), false);
  assert.equal(rerenders, 1);
});

test("failed cloud restore after local verification revokes every local execution proof", async () => {
  const officialPayload = recentRefreshPayload();
  const localPayload = recentRefreshPayload();
  localPayload.generationId = `${localPayload.tradingDate}:${new Date(Date.now() - 500).toISOString()}`;
  const rerendered = [];
  const sandbox = {
    Date,
    Error,
    activeDecisionAuthority: "cloud",
    lastHotPayload: officialPayload,
    localVerifyHotStocksBtn: null,
    async loadHotStocks() {
      sandbox.lastHotPayload = localPayload;
      sandbox.markDirectBuyFresh(localPayload, true);
      return { ok: true, payload: localPayload };
    },
    async loadVerifiedCloudCurrentPayload() {
      throw new Error("cloud restore failed");
    },
    renderPremarketFlow(payload) { rerendered.push(payload); },
  };
  installDirectBuyFreshness(sandbox);
  assert.equal(sandbox.markDirectBuyFresh(officialPayload, true), true);
  vm.runInNewContext(
    [
      extractFunction(scriptSource, "rawClosingComparison"),
      extractFunction(scriptSource, "runLocalHotStocksVerification"),
      "this.verifyLocal = runLocalHotStocksVerification;",
    ].join("\n"),
    sandbox,
  );

  await assert.rejects(sandbox.verifyLocal(), /cloud restore failed/);
  assert.equal(sandbox.isDirectBuyFresh(localPayload), false);
  assert.equal(sandbox.isDirectBuyFresh(sandbox.lastHotPayload), false);
  assert.equal(rerendered.at(-1), localPayload);
});

test("initialization compares local cache before cloud and keeps only the newest verified snapshot", () => {
  const restore = extractFunction(scriptSource, "restoreSavedHotStocks");
  const initialize = extractFunction(scriptSource, "initializeHotStocks");
  assert.match(restore, /hotStocksJsonRequest\(\s*"\/api\/hot-stocks\/cache"/);
  assert.match(restore, /acceptDecisionAuthorityLane\("local", payload/);
  assert.match(restore, /hotStocksRenderRefreshStage\("cached"/);
  const refreshRestored = extractFunction(scriptSource, "refreshRestoredHotStocks");
  assert.match(refreshRestored, /"\/api\/hot-stocks\/status"/);
  assert.match(refreshRestored, /refresh\.generationId === restoredGeneration/);
  assert.match(refreshRestored, /return loadHotStocks\(\{ preserveCurrent: true, reason: "initialize-cache-refresh"/);
  assert.match(initialize, /const restored = await restoreSavedHotStocks\(\);/);
  assert.ok(
    initialize.indexOf("await restoreSavedHotStocks()") < initialize.indexOf("await loadVerifiedCloudCurrentPayload"),
    "local cache must be accepted before cloud comparison",
  );
  assert.match(initialize, /mode: "latest-verified-snapshot"/);
  assert.match(
    initialize,
    /if \(restored\) \{[\s\S]*?refreshRestoredHotStocks\(restoredLocalPayload\)/,
    "a restored disk snapshot must remain visible while a real local refresh starts in background",
  );
  assert.match(initialize, /return loadHotStocks\(\{ preserveCurrent: restored/);
});

test("decision primary button actually starts the local market refresh", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert.match(
    html,
    /id="fetchHotStocksDecision"[^>]*>一键抓取并生成决策<\/button>/,
  );
  assert.match(
    scriptSource,
    /fetchHotStocksDecision\.addEventListener\("click", \(\) => loadHotStocks\(\{[\s\S]*?reason: "decision-button"[\s\S]*?forceLocal: true/,
  );
  assert.doesNotMatch(
    scriptSource,
    /fetchHotStocksDecision\.addEventListener\("click", \(\) => runCloudCurrentSync\(\)\)/,
  );
});

function installKlineFetchStatusResolver(sandbox) {
  vm.runInNewContext(
    `${extractFunction(scriptSource, "resolveKlineFetchDisplayStatus")}; this.resolveKlineStatus = resolveKlineFetchDisplayStatus;`,
    sandbox,
  );
}

function cachedKlineCandidate(tradingDate, lineage = null) {
  return {
    code: "000001",
    klineProfileCached: true,
    klineProfile: {
      lastTradingDate: tradingDate || undefined,
      lastSession: tradingDate
        ? { tradingDate, source: "tencent-kline", verified: true, completed: true }
        : { source: "tencent-kline" },
    },
    ...(lineage ? { dataLineage: { kline: lineage } } : {}),
  };
}

function sameDayCachedRefreshPayload() {
  const payload = recentRefreshPayload();
  const tradingDate = payload.tradingDate;
  payload.fetchStatus = {
    level: "ok",
    operationalLevel: "degraded",
    mode: "degraded_same_day_cache",
    evidenceStatus: "complete",
    items: [{
      name: "K线/均线",
      ok: true,
      degraded: true,
      statusKey: "degraded_same_day_cache",
      eligibleForClosingDecision: true,
      requestedCount: 1,
      liveCount: 0,
      sameDayCacheCount: 1,
      unavailableCount: 0,
      expectedCompletedTradingDate: tradingDate,
    }],
  };
  payload.sources = {
    klineDiagnostics: {
      version: 2,
      statusKey: "degraded_same_day_cache",
      expectedCompletedTradingDate: tradingDate,
      requested: 1,
      east: 0,
      tencent: 0,
      liveAccepted: 0,
      cached: 1,
      sameDayCache: 1,
      staleCacheRejected: 0,
      unavailable: 0,
      failed: 1,
      cacheTradingDates: { [tradingDate]: 1 },
    },
  };
  payload.candidates = [{
    code: "000001",
    klineProfileCached: true,
    klineProfile: {
      lastTradingDate: tradingDate,
      lastClose: 10,
      lastSession: {
        tradingDate,
        source: "tencent-kline",
        verified: true,
        completed: true,
        close: 10,
      },
    },
    klineProfileLineage: {
      version: 1,
      mode: "same_day_cache",
      liveFetchFailed: true,
      cacheAccepted: true,
      expectedTradingDate: tradingDate,
      tradingDate,
    },
  }];
  return payload;
}

test("restored disk cache cannot certify itself as the current refresh", () => {
  const payload = sameDayCachedRefreshPayload();
  payload.restoredFromDisk = true;
  const sandbox = {};
  installKlineFetchStatusResolver(sandbox);
  const status = sandbox.resolveKlineStatus(payload);
  assert.equal(status.state, "restored_snapshot");
  assert.equal(status.level, "partial");
  assert.match(status.label, new RegExp(payload.tradingDate));
  assert.match(status.label, /等待后台核对/);
});

test("direct-buy freshness accepts only fully covered same-day cache degradation and revalidates its proof", () => {
  const sandbox = {
    Date,
    setTimeout,
    clearTimeout,
    lastHotPayload: null,
    renderPremarketFlow() {},
  };
  installDirectBuyFreshness(sandbox);

  const valid = sameDayCachedRefreshPayload();
  const quality = sandbox.resolveExecutionFreshness(valid);
  assert.equal(quality.state, "degraded_same_day_cache");
  assert.equal(quality.evidenceUsable, true, quality.blockers.join(" | "));
  assert.equal(sandbox.markDirectBuyFresh(valid, true), true);
  assert.equal(sandbox.isDirectBuyFresh(valid), true);

  const clone = () => JSON.parse(JSON.stringify(sameDayCachedRefreshPayload()));
  const stale = clone();
  stale.sources.klineDiagnostics.statusKey = "stale_cache";
  stale.sources.klineDiagnostics.cacheTradingDates = { "2026-08-26": 1 };
  stale.candidates[0].klineProfile.lastTradingDate = "2026-08-26";
  stale.candidates[0].klineProfile.lastSession.tradingDate = "2026-08-26";
  assert.equal(sandbox.markDirectBuyFresh(stale, true), false);

  const unavailable = clone();
  unavailable.sources.klineDiagnostics.statusKey = "unavailable";
  unavailable.sources.klineDiagnostics.unavailable = 1;
  unavailable.fetchStatus.items[0].statusKey = "unavailable";
  unavailable.fetchStatus.items[0].unavailableCount = 1;
  assert.equal(sandbox.markDirectBuyFresh(unavailable, true), false);

  const incompleteEvidence = clone();
  incompleteEvidence.fetchStatus.evidenceStatus = "incomplete";
  assert.equal(sandbox.markDirectBuyFresh(incompleteEvidence, true), false);

  const dateMismatch = clone();
  dateMismatch.sources.klineDiagnostics.expectedCompletedTradingDate = "2026-08-26";
  dateMismatch.fetchStatus.items[0].expectedCompletedTradingDate = "2026-08-26";
  assert.equal(sandbox.markDirectBuyFresh(dateMismatch, true), false);

  const incompleteClosing = clone();
  incompleteClosing.candidates[0].klineProfile.lastSession.completed = false;
  assert.equal(sandbox.markDirectBuyFresh(incompleteClosing, true), false);

  const unavailableUnknown = clone();
  delete unavailableUnknown.sources.klineDiagnostics.unavailable;
  delete unavailableUnknown.fetchStatus.items[0].unavailableCount;
  assert.equal(sandbox.markDirectBuyFresh(unavailableUnknown, true), false);

  valid.fetchStatus.evidenceStatus = "incomplete";
  assert.equal(sandbox.isDirectBuyFresh(valid), false, "stored proof must be revoked by later evidence degradation");
});

test("supplemental K-line failures cannot re-block the market cycle in the client", () => {
  const sandbox = {
    Date,
    setTimeout,
    clearTimeout,
    lastHotPayload: null,
    renderPremarketFlow() {},
  };
  installDirectBuyFreshness(sandbox);
  const scopedPayload = (marketUnavailable) => {
    const payload = recentRefreshPayload();
    const marketScope = {
      statusKey: marketUnavailable ? "unavailable" : "live_complete",
      expectedCompletedTradingDate: payload.tradingDate,
      requestedCount: 140,
      liveCount: marketUnavailable ? 139 : 140,
      sameDayCacheCount: 0,
      unavailableCount: marketUnavailable ? 1 : 0,
      liveFailureCount: marketUnavailable ? 1 : 0,
      profileFailureCount: marketUnavailable ? 1 : 0,
      eligibleForClosingDecision: !marketUnavailable,
      cacheTradingDates: {},
    };
    const supplementalScope = {
      affectsClosingDecision: false,
      observationOnly: true,
      requestedCount: 55,
      liveCount: 54,
      sameDayCacheCount: 0,
      unavailableCount: 1,
    };
    payload.fetchStatus = {
      level: "partial",
      operationalLevel: "degraded",
      mode: marketUnavailable ? "unavailable" : "live_complete",
      evidenceStatus: marketUnavailable ? "incomplete" : "complete",
      items: [{
        name: "K线/均线",
        ok: !marketUnavailable,
        statusKey: marketScope.statusKey,
        expectedCompletedTradingDate: payload.tradingDate,
        eligibleForClosingDecision: !marketUnavailable,
        marketScope,
        supplementalScope,
      }],
    };
    payload.sources = {
      klineDiagnostics: {
        version: 3,
        statusKey: "unavailable",
        expectedCompletedTradingDate: payload.tradingDate,
        requested: 195,
        unavailable: 1,
        failed: 1,
        profileFailures: 1,
        east: marketUnavailable ? 139 : 140,
        tencent: 0,
        marketScope,
        supplementalScope,
        operationalTotals: { requested: 195, unavailable: 1, profileFailures: 1 },
      },
    };
    payload.candidates = [{
      code: "600929",
      previousLimitUpOnly: true,
      observationOnly: true,
      executionAuthority: false,
      klineProfile: null,
      klineProfileLineage: { mode: "live_stale_cache_rejected", liveFetchFailed: true },
    }];
    return payload;
  };

  const supplementalOnly = sandbox.resolveExecutionFreshness(scopedPayload(false));
  assert.equal(supplementalOnly.state, "live_complete");
  assert.equal(supplementalOnly.evidenceUsable, true, supplementalOnly.blockers.join(" | "));

  const marketMissing = sandbox.resolveExecutionFreshness(scopedPayload(true));
  assert.equal(marketMissing.state, "unavailable");
  assert.equal(marketMissing.evidenceUsable, false);
});

test("K-line source status exposes live, fallback, same-day cache, stale cache, and unavailable states", () => {
  const sandbox = {};
  installKlineFetchStatusResolver(sandbox);
  const fetchStatus = {
    level: "ok",
    label: "✓ 本次抓取：数据完整",
    items: [{ name: "K线/均线", ok: true, note: "2/2只成功（2只使用最近有效K线缓存）" }],
  };

  const live = sandbox.resolveKlineStatus({
    tradingDate: "2026-08-27",
    fetchStatus,
    sources: { klineDiagnostics: { east: 2, tencent: 1, cached: 0, failed: 0 } },
  });
  assert.equal(live.state, "live_complete");
  assert.match(live.detail, /实时 2.*备用 1.*缓存 0.*失败 0/);

  const sameDay = sandbox.resolveKlineStatus({
    tradingDate: "2026-08-27",
    fetchStatus,
    sources: { klineDiagnostics: { east: 0, tencent: 0, cached: 2, failed: 2 } },
    candidates: [cachedKlineCandidate("2026-08-27"), cachedKlineCandidate("2026-08-27")],
  });
  assert.equal(sameDay.state, "degraded_same_day_cache");
  assert.equal(sameDay.level, "partial");
  assert.match(sameDay.label, /部分实时源失败·2只使用2026-08-27缓存/);
  assert.match(sameDay.detail, /缓存交易日 2026-08-27/);
  assert.match(sameDay.detail, /已验证收盘 2\/2/);
  assert.doesNotMatch(sameDay.detail, /缓存年龄/);

  const incompleteClosingCandidate = cachedKlineCandidate("2026-08-27");
  incompleteClosingCandidate.klineProfile.lastSession.completed = false;
  const incompleteClosing = sandbox.resolveKlineStatus({
    tradingDate: "2026-08-27",
    fetchStatus,
    sources: { klineDiagnostics: { east: 0, tencent: 0, cached: 1, failed: 1 } },
    candidates: [incompleteClosingCandidate],
  });
  assert.equal(incompleteClosing.state, "unavailable");
  assert.match(incompleteClosing.label, /收盘证据不完整/);

  const lineageBackedSameDay = sandbox.resolveKlineStatus({
    tradingDate: "2026-08-27",
    fetchStatus,
    sources: {
      klineDiagnostics: {
        status: "degraded_same_day_cache",
        expectedTradingDate: "2026-08-27",
        freshCount: 0,
        cacheHitCount: 1,
        sameDayCacheCount: 1,
        staleCacheCount: 0,
        liveFailureCount: 1,
        unavailable: 0,
        providers: {
          eastmoney: { succeeded: 0 },
          tencent: { succeeded: 0 },
        },
      },
    },
    candidates: [{
      code: "000003",
      klineProfile: { lastSession: { source: "tencent-kline" } },
      klineProfileLineage: {
        mode: "same_day_cache",
        provider: "tencent",
        profileTradingDate: "2026-08-27",
        ageMs: 120000,
        dateAligned: true,
      },
    }],
  });
  assert.equal(lineageBackedSameDay.state, "degraded_same_day_cache");
  assert.match(lineageBackedSameDay.detail, /实时 0.*备用 0.*缓存 1.*失败 1/);
  assert.match(lineageBackedSameDay.detail, /缓存交易日 2026-08-27/);
  assert.match(lineageBackedSameDay.detail, /缓存年龄 2分钟/);

  const stale = sandbox.resolveKlineStatus({
    tradingDate: "2026-08-27",
    fetchStatus,
    sources: {
      klineDiagnostics: { east: 0, tencent: 0, cached: 1, failed: 1, cacheAgeMinutes: 1500 },
    },
    candidates: [cachedKlineCandidate("2026-08-26")],
  });
  assert.equal(stale.state, "stale_cache");
  assert.equal(stale.level, "fail");
  assert.match(stale.detail, /缓存交易日 2026-08-26/);
  assert.match(stale.detail, /缓存年龄 1500分钟/);

  const unavailable = sandbox.resolveKlineStatus({
    tradingDate: "2026-08-27",
    fetchStatus,
    sources: { klineDiagnostics: { east: 0, tencent: 0, cached: 0, failed: 2 } },
    candidates: [{ code: "000001" }, { code: "000002" }],
  });
  assert.equal(unavailable.state, "unavailable");
  assert.equal(unavailable.level, "fail");
});

test("cached K-line without a verifiable trading date fails closed and invents neither date nor age", () => {
  const sandbox = {};
  installKlineFetchStatusResolver(sandbox);
  const status = sandbox.resolveKlineStatus({
    tradingDate: "2026-08-27",
    fetchStatus: { level: "ok", items: [] },
    sources: { klineDiagnostics: { east: 0, tencent: 0, cached: 1, failed: 1 } },
    candidates: [cachedKlineCandidate(null)],
  });
  assert.equal(status.state, "unavailable");
  assert.match(status.label, /缓存交易日未验证/);
  assert.doesNotMatch(status.detail, /缓存交易日 20/);
  assert.doesNotMatch(status.detail, /缓存年龄/);
});

test("fetch status renderer replaces the misleading green K-line item on desktop and decision badges", () => {
  assert.match(extractFunction(scriptSource, "hotStocksRenderRefreshStage"), /renderFetchStatus\(status, payload\)/);
  const badges = [button(""), button("")];
  const issues = { innerHTML: "" };
  const sandbox = {
    document: {
      querySelectorAll(selector) {
        assert.equal(selector, "#fetchStatusBadge, #fetchStatusBadgeDecision");
        return badges;
      },
      querySelector(selector) {
        assert.equal(selector, "#fetchStatusIssues");
        return issues;
      },
    },
    escapeHtml(value) { return String(value); },
  };
  vm.runInNewContext(
    [
      extractFunction(scriptSource, "resolveKlineFetchDisplayStatus"),
      extractFunction(scriptSource, "renderFetchStatus"),
      "this.renderFetchStatus = renderFetchStatus;",
    ].join("\n"),
    sandbox,
  );
  const payload = {
    tradingDate: "2026-08-27",
    fetchStatus: {
      level: "ok",
      label: "✓ 本次抓取：数据完整",
      items: [
        { name: "K线/均线", ok: true, note: "2/2只成功（2只使用最近有效K线缓存）" },
        { name: "T-1补充观察K线", ok: true, degraded: true, note: "54/55只可用；1只仅关闭自身资格" },
        { name: "东财热榜", ok: true, note: "100/100只" },
      ],
    },
    sources: { klineDiagnostics: { east: 0, tencent: 0, cached: 2, failed: 2 } },
    candidates: [cachedKlineCandidate("2026-08-27"), cachedKlineCandidate("2026-08-27")],
  };

  sandbox.renderFetchStatus(payload.fetchStatus, payload);
  badges.forEach((badge) => {
    assert.match(badge.textContent, /部分实时源失败·2只使用2026-08-27缓存/);
    assert.doesNotMatch(badge.textContent, /数据完整/);
    assert.match(badge.className, /fs-partial/);
    assert.equal(badge.attributes["data-kline-source-state"], "degraded_same_day_cache");
  });
  assert.match(issues.innerHTML, /K线来源：实时 0 · 备用 0 · 缓存 2 · 失败 2/);
  assert.match(issues.innerHTML, /缓存交易日 2026-08-27/);
  assert.doesNotMatch(issues.innerHTML, /✓ K线\/均线/);
  assert.match(issues.innerHTML, /fs-warn/);
  assert.match(issues.innerHTML, /T-1补充观察K线/);
  assert.match(issues.innerHTML, /1只仅关闭自身资格/);
  assert.match(issues.innerHTML, /✓ 东财热榜 100\/100只/);

  sandbox.renderFetchStatus({
    level: "partial",
    label: "✓ 后台刷新完成 · 当前无新交易日数据，沿用 2026-08-27 收盘快照",
    preserveLabel: true,
    items: payload.fetchStatus.items,
  }, payload);
  badges.forEach((badge) => {
    assert.match(badge.textContent, /后台刷新完成/);
    assert.match(badge.textContent, /当前无新交易日数据/);
    assert.match(badge.textContent, /沿用 2026-08-27 收盘快照/);
    assert.doesNotMatch(badge.textContent, /后台刷新失败/);
    assert.match(badge.className, /fs-partial/);
  });
});
