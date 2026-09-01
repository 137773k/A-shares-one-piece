"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  INDEX_PATH_KEYS,
  buildTomorrowIndexPath,
  deriveAllAPath,
} = require("./tomorrow-index-path");

function currentFixture(overrides = {}) {
  const snapshotOverrides = overrides.snapshot || {};
  const stateOverrides = overrides.state || {};
  const defaultAllA = {
    open: 1344.35,
    prevClose: 1352.89,
    low: 1342.07,
    high: 1376.39,
    price: 1373.3,
    breadth: 0.7711897356,
  };
  const allA = Object.prototype.hasOwnProperty.call(snapshotOverrides, "allA")
    && snapshotOverrides.allA === null
    ? null
    : { ...defaultAllA, ...(snapshotOverrides.allA || {}) };
  return {
    tradingDate: "2026-08-25",
    market: {
      snapshot: {
        tradingDate: "2026-08-25",
        avgIndexChange: -0.39,
        breadth: 0.7689946278,
        shszAmountYi: 18318.44,
        allA,
        indexStructures: [
          { date: "2026-08-25", trendKey: "sideways" },
          { date: "2026-08-25", trendKey: "downtrend" },
          { date: "2026-08-25", trendKey: "downtrend" },
          { date: "2026-08-25", trendKey: "downtrend" },
        ],
        ...snapshotOverrides,
        allA,
      },
      limitStats: {
        dates: { today: "20260825", prev: "20260824", verified: true },
      },
      state: {
        structuralCycle: "退潮",
        ...stateOverrides,
      },
    },
  };
}

function previousFixture(overrides = {}) {
  return {
    archiveMeta: {
      tradingDate: "2026-08-24",
      snapshotKind: "closing",
      ...(overrides.archiveMeta || {}),
    },
    market: {
      snapshot: {
        tradingDate: "2026-08-24",
        shszAmountYi: 20074.56,
        ...(overrides.snapshot || {}),
      },
    },
  };
}

function weakCloseFixture() {
  return currentFixture({
    snapshot: {
      avgIndexChange: -1.25,
      breadth: 0.25,
      shszAmountYi: 16400,
      allA: {
        prevClose: 100,
        open: 99.8,
        high: 100.2,
        low: 97,
        price: 97.5,
        breadth: 0.25,
      },
      indexStructures: [
        { date: "2026-08-25", trendKey: "downtrend" },
        { date: "2026-08-25", trendKey: "downtrend" },
        { date: "2026-08-25", trendKey: "bottoming" },
        { date: "2026-08-25", trendKey: "sideways" },
      ],
    },
  });
}

test("8月25日探底强收与77%宽度不再被判为弱势收盘主路径", () => {
  const result = buildTomorrowIndexPath(currentFixture(), { previousPayload: previousFixture() });

  assert.equal(result.available, true);
  assert.equal(result.calibrated, false);
  assert.equal(result.probabilitySemantics, false);
  assert.equal(INDEX_PATH_KEYS.reduce((sum, key) => sum + result.weights[key], 0), 100);
  assert.equal(result.primary.key, "repair_up");
  assert.notEqual(result.primary.key, "weak_close");
  assert.ok(result.weights.repair_up > result.weights.weak_close, JSON.stringify(result.weights));
  assert.match(
    result.evidence.find((row) => row.id === "all_a_intraday_path").detail,
    /低开探底后强收.*开收到\+2\.15%.*收盘位置91\.0%/,
  );
  assert.equal(result.evidence.filter((row) => row.id === "all_a_intraday_path").length, 1);
  assert.equal(result.dataQuality.grade, "complete");
});

test("普通放量或缩量弱收会把 weak_close 判为主路径", () => {
  const result = buildTomorrowIndexPath(weakCloseFixture(), { previousPayload: previousFixture() });

  assert.equal(result.available, true);
  assert.equal(result.primary.key, "weak_close");
  assert.ok(result.weights.weak_close > result.weights.range, JSON.stringify(result.weights));
  assert.ok(result.weights.weak_close > result.weights.repair_up, JSON.stringify(result.weights));
  assert.match(result.evidence.find((row) => row.id === "all_a_intraday_path").detail, /单边走弱并收在低位/);
  assert.match(result.evidence.find((row) => row.id === "market_breadth").detail, /25%/);
});

test("大周期只改变风险说明，不改变完全相同证据的方向权重", () => {
  const retreat = buildTomorrowIndexPath(currentFixture({ state: { structuralCycle: "退潮" } }), {
    previousPayload: previousFixture(),
  });
  const mainRise = buildTomorrowIndexPath(currentFixture({ state: { structuralCycle: "主升" } }), {
    previousPayload: previousFixture(),
  });

  assert.deepEqual(retreat.weights, mainRise.weights);
  assert.equal(retreat.riskContext.key, "retreat");
  assert.equal(mainRise.riskContext.key, "main_rise");
  assert.equal(retreat.riskContext.directionWeightImpact, 0);
  assert.match(retreat.riskContext.note, /不参与次日指数方向权重/);
});

test("缺少关键收盘证据时失败关闭，不用中性值伪造方向权重", () => {
  const cases = [
    {
      name: "missing_all_a",
      payload: currentFixture({ snapshot: { allA: null } }),
      options: { previousPayload: previousFixture() },
      missing: "all_a_intraday_path",
    },
    {
      name: "stale_index_structures",
      payload: currentFixture({
        snapshot: {
          indexStructures: [
            { date: "2026-08-24", trendKey: "downtrend" },
            { date: "2026-08-24", trendKey: "sideways" },
            { date: "2026-08-24", trendKey: "repair" },
          ],
        },
      }),
      options: { previousPayload: previousFixture() },
      missing: "major_index_structure",
    },
    {
      name: "wrong_t1",
      payload: currentFixture(),
      options: {
        previousPayload: previousFixture({ archiveMeta: { tradingDate: "2026-08-21" } }),
      },
      missing: "turnover_comparison",
    },
  ];

  cases.forEach((item) => {
    const result = buildTomorrowIndexPath(item.payload, item.options);
    assert.equal(result.available, false, item.name);
    assert.equal(result.weights, null, item.name);
    assert.equal(result.primary.key, "unavailable", item.name);
    assert.equal(result.dataQuality.failClosed, true, item.name);
    assert.ok(result.dataQuality.missingFields.includes(item.missing), item.name);
    assert.ok(result.scenarios.every((scenario) => scenario.weight === null), item.name);
  });
});

test("全A日内指标由同一根T日K线一次性派生", () => {
  assert.deepEqual(
    deriveAllAPath({ prevClose: 100, open: 98, low: 97, high: 103, price: 102 }),
    {
      available: true,
      gapPct: -2,
      openToClosePct: 4.08,
      closeLocationPct: 83.3,
    },
  );
  assert.equal(deriveAllAPath({ prevClose: 100, open: 98 }).available, false);
});
