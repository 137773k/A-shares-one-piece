"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { CAPABILITIES } = require("./data-providers");
const { dataProviderInternals, klineQualityInternals } = require("./server");

const serverSource = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

test("主刷新链通过provider registry取首批原始证据，决策组合顺序保持原位", () => {
  const hotStart = serverSource.indexOf("async function hotStocksPayload(options = {})");
  const hotEnd = serverSource.indexOf("function createHotStocksRefreshController", hotStart);
  const hotStocksSource = serverSource.slice(hotStart, hotEnd);
  assert.match(serverSource, /async function hotStocksPayload\(options = \{\}\)/);
  assert.match(serverSource, /requiredProviderCapability\(providerRegistry, DATA_CAPABILITIES\.HOT_RANK_EASTMONEY/);
  assert.match(serverSource, /requiredProviderCapability\(providerRegistry, DATA_CAPABILITIES\.MARKET_SNAPSHOT/);
  assert.match(serverSource, /requiredProviderCapability\(providerRegistry, DATA_CAPABILITIES\.LIMIT_STATS/);
  assert.match(serverSource, /dataProviderBundle: projectDataBundleMetadata\(coreDataBundle\)/);
  assert.match(serverSource, /pathname === "\/api\/data-providers\/status"/);
  assert.match(serverSource, /loadConfiguredProviders\(\{ runtimeRoot \}\)/);
  assert.doesNotMatch(hotStocksSource, /const eastQuotes = await fetchEastmoneyQuotes/);
  assert.doesNotMatch(hotStocksSource, /const sectorRows = await fetchEastmoneySectors/);
  assert.ok(
    hotStocksSource.indexOf("const providerResults = await Promise.all")
      < hotStocksSource.indexOf("const hotConcepts = clusterHotConcepts"),
    "provider数据必须先完成，再进入既有题材与决策引擎",
  );
  assert.ok(
    hotStocksSource.indexOf("const hotConcepts = clusterHotConcepts")
      < hotStocksSource.indexOf("refreshTomorrowDecision(payload"),
    "既有决策顺序不得因provider接线改变",
  );
});

test("默认注册表提供现有免费保底源且不授予执行权", () => {
  dataProviderInternals.resetMarketDataProviderRegistryForTests();
  const registry = dataProviderInternals.createMarketDataProviderRegistry([]);
  const providers = registry.list();
  assert.equal(providers.length, 1);
  assert.equal(providers[0].id, "free-fallback");
  assert.equal(providers[0].kind, "community_free");
  assert.equal(providers[0].executionAuthority, false);
  for (const capability of [
    CAPABILITIES.HOT_RANK_EASTMONEY,
    CAPABILITIES.HOT_RANK_THS,
    CAPABILITIES.MARKET_SNAPSHOT,
    CAPABILITIES.LIMIT_STATS,
    CAPABILITIES.DAILY_KLINE,
    CAPABILITIES.QUOTES,
    CAPABILITIES.SECTORS,
    CAPABILITIES.STOCK_EVIDENCE,
    CAPABILITIES.INTRADAY_LEADERSHIP,
    CAPABILITIES.STOCK_NEWS,
  ]) assert(providers[0].capabilities.includes(capability), capability);
});

test("用户provider优先于免费源但只能提供数据能力", () => {
  const custom = {
    contractVersion: 1,
    id: "local-user-provider",
    label: "用户本地数据源",
    kind: "local_file",
    priority: 100,
    capabilities: [CAPABILITIES.MARKET_SNAPSHOT],
    executionAuthority: false,
    async invoke() { return { amountYi: 1 }; },
  };
  const registry = dataProviderInternals.createMarketDataProviderRegistry([custom]);
  const providers = registry.list();
  assert.deepEqual(providers.map((provider) => provider.id), ["local-user-provider", "free-fallback"]);
  assert(providers.every((provider) => provider.executionAuthority === false));
});

test("日K调用同样经过用户源并保持原数组输入形状", async () => {
  const custom = {
    contractVersion: 1,
    id: "local-kline-provider",
    label: "用户K线源",
    kind: "local_file",
    priority: 100,
    capabilities: [CAPABILITIES.DAILY_KLINE],
    executionAuthority: false,
    async invoke() {
      return [{ date: "2026-09-01", open: 10, high: 11, low: 9, close: 10.5, volume: 100 }];
    },
  };
  const registry = dataProviderInternals.createMarketDataProviderRegistry([custom]);
  const stats = { requested: 0 };
  const rows = await klineQualityInternals.fetchKlineRows(
    { code: "000001" },
    120,
    stats,
    { providerRegistry: registry },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-09-01");
  assert.equal(stats.requested, 1);
});
