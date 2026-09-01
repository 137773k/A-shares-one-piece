"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyMarketCapCarrierRegime,
  observeStockMarketCapCarrier,
  summarizeMarketCapCarrier,
  rebuildMarketCapCarrierPayload,
} = require("./market-cap-carrier");

test("放量进攻必须同时满足成交额、市场广度和指数方向", () => {
  const regime = classifyMarketCapCarrierRegime({
    shszAmountYi: 26000,
    breadth: 0.61,
    avgIndexChange: 1.2,
    tradingDate: "2026-08-21",
  });
  assert.equal(regime.key, "risk_on_capacity");
  assert.equal(regime.status, "mixed");
  assert.equal(regime.preferredTotalCapYi, null, "放量本身不能预设大市值必然占优");
  assert.equal(regime.observationOnly, true);
  assert.equal(regime.scoreAdjustment, 0);
  assert.equal(regime.hardGateImpact, false);
  assert.equal(regime.tradePermissionImpact, false);
});

test("放量杀跌不能被误判为大市值容量行情", () => {
  const regime = classifyMarketCapCarrierRegime({
    shszAmountYi: 26000,
    breadth: 0.12,
    avgIndexChange: -4.1,
  });
  assert.equal(regime.key, "panic_volume");
  assert.equal(regime.preferredTotalCapYi, null);
  const observation = observeStockMarketCapCarrier({ totalMarketValue: 900e8, ticketType: "容量票" }, regime);
  assert.equal(observation.alignment, "risk_observation");
  assert.equal(observation.scoreAdjustment, 0);
});

test("25000亿以下不再静态写死500亿边界", () => {
  const regime = classifyMarketCapCarrierRegime({
    shszAmountYi: 19000,
    breadth: 0.48,
    avgIndexChange: 0.3,
  });
  assert.equal(regime.key, "low_liquidity");
  assert.equal(regime.status, "mixed");
  assert.equal(regime.preferredTotalCapYi, null);
  assert.equal(observeStockMarketCapCarrier({ totalMarketValue: 120e8 }, regime).alignment, "neutral");
  assert.equal(observeStockMarketCapCarrier({ totalMarketValue: 650e8 }, regime).alignment, "neutral");
});

test("总市值是区间判断主口径，流通市值不能静默替代", () => {
  const regime = classifyMarketCapCarrierRegime({ shszAmountYi: 19000, breadth: 0.5, avgIndexChange: 0 });
  const observation = observeStockMarketCapCarrier({ floatMktCapYi: 180 }, regime);
  assert.equal(observation.totalCapYi, null);
  assert.equal(observation.floatCapYi, 180);
  assert.equal(observation.alignment, "unknown");
  assert.equal(observation.capDataQuality, "total_cap_missing");
});

test("缺少任一成交质量证据时按不可用处理", () => {
  const regime = classifyMarketCapCarrierRegime({ shszAmountYi: 26000, breadth: 0.7 });
  assert.equal(regime.key, "unknown");
  assert.equal(regime.status, "unavailable");
  assert.deepEqual(regime.dataQuality.missing, ["主要指数均值"]);
});

test("样本不足时市值画像不可用，不生成胜率或权限", () => {
  const regime = classifyMarketCapCarrierRegime({ shszAmountYi: 19000, breadth: 0.5, avgIndexChange: 0.2 });
  const rows = [120, 280, 420, 700].map((cap) => observeStockMarketCapCarrier({ totalMarketValue: cap * 1e8 }, regime));
  const summary = summarizeMarketCapCarrier(regime, rows);
  assert.equal(summary.candidateSample.count, 4);
  assert.equal(summary.status, "unavailable");
  assert.equal(summary.opportunityGateImpact, false);
  assert.equal(summary.tradePermissionImpact, false);
  assert.equal(Object.hasOwn(summary, "winRate"), false);
});

function sampleStock(capYi, changePct, index) {
  return { code: String(index).padStart(6, "0"), totalMarketValue: capYi * 1e8, changePct };
}

test("8月25日式中小市值占优样本动态确认500亿以下并排除超大市值机会股", () => {
  const payload = {
    market: { snapshot: { tradingDate: "2026-08-25", shszAmountYi: 18318, breadth: 0.769, avgIndexChange: -0.39 } },
    candidates: [],
  };
  const caps = [30, 70, 180, 420];
  caps.forEach((cap, bucketIndex) => {
    for (let index = 0; index < 6; index += 1) {
      payload.candidates.push(sampleStock(cap, 4 + bucketIndex + index / 10, payload.candidates.length + 1));
    }
  });
  [700, 1600].forEach((cap) => {
    for (let index = 0; index < 8; index += 1) {
      payload.candidates.push(sampleStock(cap, -1 + index / 20, payload.candidates.length + 1));
    }
  });
  const longfei = sampleStock(3266, 4.04, 601869);
  longfei.code = "601869";
  payload.candidates.push(longfei);
  const summary = rebuildMarketCapCarrierPayload(payload);
  assert.equal(summary.status, "confirmed");
  assert.deepEqual(summary.preferredBucketKeys, ["under_50", "50_100", "100_300", "300_500"]);
  assert.equal(summary.preferredTotalCapYi.max, 500);
  assert.equal(summary.coverage.usablePct, 100);
  assert.equal(longfei.marketCapCarrier.alignment, "outside_confirmed_band");
  assert.equal(summary.calibrated, false);
  assert.match(summary.evidence[0].note, /不代表历史胜率/);
});

test("大市值样本占优时500亿以上可动态恢复为机会优先桶", () => {
  const payload = {
    market: { snapshot: { tradingDate: "2026-08-25", shszAmountYi: 27000, breadth: 0.7, avgIndexChange: 1.1 } },
    candidates: [],
  };
  [30, 70, 180, 420].forEach((cap) => {
    for (let index = 0; index < 5; index += 1) payload.candidates.push(sampleStock(cap, -1, payload.candidates.length + 1));
  });
  [700, 1600].forEach((cap) => {
    for (let index = 0; index < 8; index += 1) payload.candidates.push(sampleStock(cap, 5, payload.candidates.length + 1));
  });
  const summary = rebuildMarketCapCarrierPayload(payload);
  assert.equal(summary.status, "confirmed");
  assert.deepEqual(summary.preferredBucketKeys, ["500_1000", "over_1000"]);
  assert.equal(summary.preferredTotalCapYi.min, 500);
});

test("市值桶表现无清晰差异时保持mixed且只软提示", () => {
  const payload = {
    market: { snapshot: { tradingDate: "2026-08-25", shszAmountYi: 19000, breadth: 0.5, avgIndexChange: 0.1 } },
    candidates: [30, 70, 180, 420, 700, 1600].flatMap((cap) => Array.from({ length: 5 }, (_, index) => sampleStock(cap, index - 2, cap + index))),
  };
  const summary = rebuildMarketCapCarrierPayload(payload);
  assert.equal(summary.status, "mixed");
  assert.deepEqual(summary.preferredBucketKeys, []);
  assert.equal(summary.opportunityGateImpact, false);
});

test("旧缓存缺少市值载体字段时按市场快照重建，不再返回null", () => {
  const payload = {
    market: {
      snapshot: {
        tradingDate: "2026-08-21",
        shszAmountYi: 18792.64,
        breadth: 0.6,
        avgIndexChange: 0.4,
      },
    },
    candidates: [
      { code: "600001", totalMarketValue: 220e8 },
      { code: "600002", totalMarketValue: 620e8, ticketType: "容量票" },
    ],
  };
  const summary = rebuildMarketCapCarrierPayload(payload);
  assert.equal(summary.key, "low_liquidity");
  assert.equal(summary.candidateSample.count, 2);
  assert.equal(payload.candidates[0].marketCapCarrier.bucketKey, "100_300");
  assert.equal(payload.market.marketCapCarrier, summary);
});
