"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CAPABILITIES,
  DataProviderRegistry,
  createDataBundle,
  createFreeFallbackProvider,
} = require("./data-providers");

function provider({ id, priority, capability, value, error = null }) {
  return {
    contractVersion: 1,
    id,
    label: id,
    kind: id === "custom-provider" ? "user" : "community_free",
    priority,
    capabilities: [capability],
    executionAuthority: false,
    async invoke() {
      if (error) throw error;
      return typeof value === "function" ? value() : value;
    },
  };
}

test("用户数据源优先，失败时按能力回退到现有免费保底源", async () => {
  const registry = new DataProviderRegistry();
  registry.register(provider({
    id: "custom-provider",
    priority: 100,
    capability: CAPABILITIES.MARKET_SNAPSHOT,
    error: new Error("custom unavailable"),
  }));
  registry.register(createFreeFallbackProvider({
    async fetchMarketSnapshot() { return { tradingDate: "2026-09-01", amountYi: 20334.03 }; },
  }));
  const result = await registry.invoke(CAPABILITIES.MARKET_SNAPSHOT, [], {
    observedAt: "2026-09-01T07:30:00.000Z",
    tradingDate: "2026-09-01",
    expectedTradingDate: "2026-09-01",
  });
  assert.equal(result.envelope.providerId, "free-fallback");
  assert.equal(result.envelope.data.amountYi, 20334.03);
  assert.deepEqual(result.attempts.map((item) => item.providerId), ["custom-provider", "free-fallback"]);
});

test("错交易日、错复权或夹带决策权限的用户源不得进入引擎", async () => {
  const cases = [
    {
      value: { value: 1 },
      context: { tradingDate: "2026-08-31", expectedTradingDate: "2026-09-01" },
    },
    {
      value: { value: 1 },
      context: { adjustment: "none", expectedAdjustment: "qfq" },
    },
    {
      value: { unifiedDecisionChain: { authorization: { passed: true } } },
      context: {},
    },
  ];
  for (const [index, fixture] of cases.entries()) {
    const registry = new DataProviderRegistry();
    registry.register(provider({
      id: "custom-provider",
      priority: 100,
      capability: CAPABILITIES.DAILY_KLINE,
      value: fixture.value,
    }));
    registry.register(createFreeFallbackProvider({
      async fetchDailyKline() { return [{ date: "2026-09-01", close: 10 }]; },
    }));
    const result = await registry.invoke(CAPABILITIES.DAILY_KLINE, [], {
      observedAt: "2026-09-01T07:30:00.000Z",
      tradingDate: fixture.context.tradingDate || "2026-09-01",
      adjustment: fixture.context.adjustment || "qfq",
      expectedTradingDate: fixture.context.expectedTradingDate,
      expectedAdjustment: fixture.context.expectedAdjustment,
    });
    assert.equal(result.envelope.providerId, "free-fallback", `case ${index}`);
  }
});

test("DataBundle只保留证据与来源血缘，永远没有执行权限", async () => {
  const registry = new DataProviderRegistry();
  registry.register(createFreeFallbackProvider({
    async fetchMarketSnapshot() { return { amountYi: 20334.03 }; },
    async fetchLimitStats() { return { ztToday: 78, dtToday: 0 }; },
  }));
  const context = {
    observedAt: "2026-09-01T07:30:00.000Z",
    tradingDate: "2026-09-01",
    expectedTradingDate: "2026-09-01",
  };
  const market = await registry.invoke(CAPABILITIES.MARKET_SNAPSHOT, [], context);
  const limits = await registry.invoke(CAPABILITIES.LIMIT_STATS, [], context);
  const bundle = createDataBundle({
    generationContext: {
      generationId: "2026-09-01:2026-09-01T07:30:00.000Z",
      tradingDate: "2026-09-01",
      asOf: "2026-09-01T07:30:00.000Z",
    },
    envelopes: [market.envelope, limits.envelope],
  });
  assert.equal(bundle.quality.status, "complete");
  assert.equal(bundle.executionAuthority, false);
  assert.equal(bundle.lineage.length, 2);
  assert.equal(bundle.data.market_snapshot.amountYi, 20334.03);
  assert.equal(bundle.data.limit_stats.ztToday, 78);
});
