"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  INDEX_CYCLE_REGIME_VERSION,
  buildIndexCycleRegime,
  analyzeIndexCycleRegime,
} = require("./index-cycle-regime");

function allA(overrides = {}) {
  return {
    code: "883421",
    name: "同花顺全A(沪深)",
    price: 1386.36,
    changePct: 1.43,
    open: 1370.09,
    prevClose: 1366.77,
    low: 1362.09,
    high: 1386.38,
    ...overrides,
  };
}

function sample20260810() {
  return {
    snapshot: {
      breadth: 0.7560693641618497,
      avgIndexChange: -0.01,
      allA: allA(),
      indexStructures: [
        {
          code: "000001",
          name: "上证指数",
          date: "2026-08-10",
          close: 3966.59,
          changePct: 0.67,
          ma5: 3901.54,
          ma10: 3859.61,
          ma20: 3862.11,
          ma60: 3999.25,
          slope5: 1.88,
          slope10: 0.59,
          slope20: -0.52,
          trendKey: "sideways",
        },
        {
          code: "399001",
          name: "深证成指",
          date: "2026-08-10",
          close: 14316.96,
          changePct: 0.04,
          ma5: 14153.6,
          ma10: 13824.91,
          ma20: 14006.58,
          ma60: 15038.84,
          slope5: 3.55,
          slope10: 0.29,
          slope20: -1.53,
          trendKey: "repair",
        },
        {
          code: "399006",
          name: "创业板指",
          date: "2026-08-10",
          close: 3537.21,
          changePct: -0.73,
          ma5: 3528,
          ma10: 3423.69,
          ma20: 3517.84,
          ma60: 3861.05,
          slope5: 4.28,
          slope10: -0.75,
          slope20: -2.36,
          trendKey: "repair",
        },
        {
          code: "000688",
          name: "科创50",
          date: "2026-08-10",
          close: 1737.77,
          changePct: -0.36,
          ma5: 1698.62,
          ma10: 1664.26,
          ma20: 1750.28,
          ma60: 1828.3,
          slope5: 5.02,
          slope10: -3.79,
          slope20: -4.81,
          trendKey: "repair",
        },
      ],
    },
  };
}

function mainRiseRow(code, name, overrides = {}) {
  return {
    code,
    name,
    close: 125,
    changePct: 0.6,
    ma5: 122,
    ma10: 118,
    ma20: 112,
    ma60: 105,
    slope5: 1.8,
    slope10: 1.2,
    slope20: 0.7,
    ...overrides,
  };
}

test("8/10 sample is a medium repair candidate plus full five-day short main-rise, not a big-cycle upgrade", () => {
  const input = sample20260810();
  const frozenCopy = JSON.parse(JSON.stringify(input));
  const result = buildIndexCycleRegime(input);

  assert.equal(result.version, INDEX_CYCLE_REGIME_VERSION);
  assert.equal(result.mediumTerm.key, "repair_candidate");
  assert.equal(result.mediumTerm.cycleKey, "repair");
  assert.match(result.mediumTerm.label, /中期修复.*主升候选/);
  assert.equal(result.mediumTerm.metrics.aboveMa20Count, 3);
  assert.equal(result.mediumTerm.metrics.aboveMa60Count, 0);

  assert.equal(result.shortTerm.windowDays, 5);
  assert.equal(result.shortTerm.metrics.windowDays, 5);
  assert.equal(result.shortTerm.key, "main_rise");
  assert.equal(result.shortTerm.fullMarketResonance, true);
  assert.equal(result.shortTerm.label, "全市场短线主升段");
  assert.equal(result.structuralCycle, "混沌");
  assert.equal(result.transition.key, "repair_strengthening");
  assert.notEqual(result.structuralCycle, "修复");
  const shanghai = result.shortTerm.indexes.find((row) => row.code === "000001");
  assert.equal(shanghai.key, "main_rise");
  assert.equal(result.marketConsensus.key, "pending");

  assert.equal(result.intraday.key, "recovery_strong_close");
  assert.equal(result.intraday.fiveDay.key, "constructive_with_pullback");
  assert.equal(result.positionPermission.key, "conditional_reduced");
  assert.deepEqual(result.positionPermission.positionRangePct, [30, 50]);
  assert.equal(result.positionPermission.allowAdd, false);
  assert.ok(result.opportunities.some((item) => item.key === "short_main_rise_ma5_support"));
  assert.ok(result.warnings.some((item) => item.key === "medium_not_confirmed"));
  assert.deepEqual(input, frozenCopy, "pure module must not mutate its input");
});

test("20/60 medium structure plus five-day structure across most indexes confirms index main-rise", () => {
  const result = analyzeIndexCycleRegime({
    snapshot: {
      breadth: 0.64,
      allA: allA({ price: 1410, open: 1392, low: 1388, high: 1412, prevClose: 1385, changePct: 1.81 }),
      indexStructures: [
        mainRiseRow("000001", "上证指数"),
        mainRiseRow("399001", "深证成指"),
        mainRiseRow("399006", "创业板指"),
        mainRiseRow("000688", "科创50"),
      ],
    },
  });

  assert.equal(result.mediumTerm.key, "main_rise");
  assert.equal(result.shortTerm.windowDays, 5);
  assert.equal(result.shortTerm.metrics.windowDays, 5);
  assert.equal(result.shortTerm.key, "main_rise");
  assert.equal(result.marketConsensus.key, "confirmed");
  assert.equal(result.positionPermission.key, "normal_confirmation");
  assert.equal(result.positionPermission.allowNew, true);
  assert.equal(result.positionPermission.allowAdd, true);
  assert.deepEqual(result.positionPermission.positionRangePct, [50, 70]);
});

test("a rising five-day slope remains a five-day main-rise pullback even when MA10 conflicts", () => {
  const structures = [
    mainRiseRow("000001", "上证指数", { close: 120, ma5: 121, ma10: 130, slope10: -1.1, changePct: -0.7 }),
    mainRiseRow("399001", "深证成指", { close: 121, ma5: 122, ma10: 131, slope10: -1.2, changePct: -0.4 }),
    mainRiseRow("399006", "创业板指", { close: 123, ma5: 124, ma10: 133, slope10: -1.3, changePct: -0.9 }),
    mainRiseRow("000688", "科创50", { close: 124, ma5: 125, ma10: 134, slope10: -1.4, changePct: -0.3 }),
  ];
  const result = buildIndexCycleRegime({
    indexStructures: structures,
    snapshot: {
      breadth: 0.52,
      allA: allA({ price: 1380, open: 1375, low: 1365, high: 1382, prevClose: 1378, changePct: 0.15 }),
    },
  });

  assert.equal(result.mediumTerm.key, "main_rise");
  assert.equal(result.shortTerm.windowDays, 5);
  assert.equal(result.shortTerm.metrics.windowDays, 5);
  assert.equal(result.shortTerm.key, "main_rise");
  assert.ok(result.shortTerm.indexes.every((row) => row.key === "main_rise_pullback"));
  assert.ok(result.shortTerm.indexes.every((row) => row.aboveMa10 === false));
  assert.equal(result.intraday.fiveDay.key, "constructive_with_pullback");
  assert.ok(result.intraday.fiveDay.indexes.every((row) => row.structuralBreak === false));
  assert.ok(result.warnings.some((item) => item.key === "ma5_pullback_not_break"));
});

test("missing inputs remain unknown/null and are never silently converted to zero", () => {
  const result = buildIndexCycleRegime({
    indexStructures: [{ code: "000001", name: "上证指数", close: 100 }],
    snapshot: { breadth: null, allA: { changePct: 1.2 } },
  });

  assert.equal(result.mediumTerm.key, "unknown");
  assert.equal(result.shortTerm.windowDays, 5);
  assert.equal(result.shortTerm.metrics.windowDays, 5);
  assert.equal(result.shortTerm.key, "unknown");
  assert.equal(result.intraday.key, "unknown");
  assert.equal(result.mediumTerm.metrics.aboveMa20Count, null);
  assert.equal(result.mediumTerm.metrics.aboveMa20Rate, null);
  assert.equal(result.shortTerm.metrics.mainRiseCount, null);
  assert.equal(result.positionPermission.key, "observe");
  assert.equal(result.positionPermission.positionRangePct, null);
  assert.ok(result.dataQuality.missing.includes("ma20"));
  assert.ok(result.dataQuality.missing.includes("allA_intraday_ohlc"));
});

test("MA5 and slope5 are mandatory even when complete MA10 evidence is present", () => {
  const result = buildIndexCycleRegime({
    indexStructures: [
      mainRiseRow("IDX_A", "匿名指数甲", { ma5: null, slope5: null }),
      mainRiseRow("IDX_B", "匿名指数乙", { ma5: null, slope5: null }),
      mainRiseRow("IDX_C", "匿名指数丙", { ma5: null, slope5: null }),
      mainRiseRow("IDX_D", "匿名指数丁", { ma5: null, slope5: null }),
    ],
    snapshot: { breadth: 0.6, allA: allA() },
  });

  assert.equal(result.shortTerm.windowDays, 5);
  assert.equal(result.shortTerm.metrics.windowDays, 5);
  assert.equal(result.shortTerm.key, "unknown");
  assert.equal(result.shortTerm.confirmed, false);
  assert.equal(result.shortTerm.metrics.knownIndexCount, null);
  assert.ok(result.shortTerm.indexes.every((row) => row.key === "unknown"));
  assert.ok(result.dataQuality.missing.includes("ma5"));
  assert.ok(result.dataQuality.missing.includes("slope5"));
  assert.doesNotMatch(result.shortTerm.label, /10日/);
});

test("conflicting MA5 and MA10 inputs prove that five-day structure owns the short-term verdict", () => {
  const weakening = buildIndexCycleRegime({
    indexStructures: ["A", "B", "C", "D"].map((suffix) => mainRiseRow(
      `IDX_${suffix}`,
      `匿名指数${suffix}`,
      { close: 99, ma5: 101, slope5: -1.2, ma10: 95, slope10: 1.8 },
    )),
    snapshot: { breadth: 0.42, allA: allA() },
  });
  const strengthening = buildIndexCycleRegime({
    indexStructures: ["A", "B", "C", "D"].map((suffix) => mainRiseRow(
      `IDX_${suffix}`,
      `匿名指数${suffix}`,
      { close: 125, ma5: 122, slope5: 1.8, ma10: 130, slope10: -1.2 },
    )),
    snapshot: { breadth: 0.62, allA: allA() },
  });

  [weakening, strengthening].forEach((result) => {
    assert.equal(result.shortTerm.windowDays, 5);
    assert.equal(result.shortTerm.metrics.windowDays, 5);
    assert.doesNotMatch(`${result.shortTerm.label} ${result.shortTerm.evidence.join("；")}`, /10日短周期/);
  });
  assert.equal(weakening.shortTerm.key, "weakening");
  assert.equal(weakening.shortTerm.metrics.aboveMa5Count, 0);
  assert.ok(weakening.shortTerm.indexes.every((row) => row.aboveMa10 === true));
  assert.equal(strengthening.shortTerm.key, "main_rise");
  assert.equal(strengthening.shortTerm.metrics.aboveMa5Count, 4);
  assert.ok(strengthening.shortTerm.indexes.every((row) => row.aboveMa10 === false));
});

test("broad breaks below falling MA5 and MA20 create defensive permission", () => {
  const weak = (code, name) => ({
    code,
    name,
    close: 88,
    changePct: -1.8,
    ma5: 92,
    ma10: 96,
    ma20: 101,
    ma60: 110,
    slope5: -1.2,
    slope10: -1.4,
    slope20: -1.1,
  });
  const result = buildIndexCycleRegime({
    market: {
      snapshot: {
        breadth: 0.26,
        allA: allA({ price: 1320, open: 1345, high: 1348, low: 1318, prevClose: 1350, changePct: -2.22 }),
        indexStructures: [
          weak("000001", "上证指数"),
          weak("399001", "深证成指"),
          weak("399006", "创业板指"),
        ],
      },
    },
  });

  assert.equal(result.mediumTerm.key, "decline");
  assert.equal(result.shortTerm.key, "weakening");
  assert.equal(result.intraday.key, "weak_close");
  assert.equal(result.positionPermission.key, "defensive");
  assert.equal(result.positionPermission.allowNew, false);
  assert.deepEqual(result.positionPermission.positionRangePct, [0, 20]);
});

test("session OHLC is required before a close gain can be called intraday strength", () => {
  const result = buildIndexCycleRegime({
    snapshot: {
      breadth: 0.7,
      allA: { changePct: 2.1 },
      indexStructures: [mainRiseRow("000001", "上证指数")],
    },
  });

  assert.equal(result.intraday.key, "unknown");
  assert.equal(result.intraday.session.metrics.openToClosePct, null);
  assert.equal(result.positionPermission.key, "conditional_confirmation");
  assert.equal(result.positionPermission.allowAdd, false);
  assert.ok(result.warnings.some((item) => item.key === "intraday_missing"));
});

test("anonymous regression: intact MA5 main-rise plus broad weak close is a strong-divergence subphase, not acceleration", () => {
  const structures = [
    mainRiseRow("IDX_A", "匿名指数甲", { close: 120, ma5: 119, ma10: 117, changePct: -0.72 }),
    mainRiseRow("IDX_B", "匿名指数乙", { close: 121, ma5: 120, ma10: 118, changePct: -1.08 }),
    mainRiseRow("IDX_C", "匿名指数丙", { close: 122, ma5: 121, ma10: 119, changePct: -1.54 }),
    mainRiseRow("IDX_D", "匿名指数丁", { close: 123, ma5: 122, ma10: 120, changePct: -1.12 }),
  ];
  const result = buildIndexCycleRegime({
    indexStructures: structures,
    snapshot: {
      avgIndexChange: -1.12,
      breadth: 0.212,
      allA: allA({
        price: 1368,
        close: 1368,
        open: 1391,
        high: 1395,
        low: 1368,
        prevClose: 1382,
        changePct: -1.03,
      }),
    },
  });

  assert.equal(result.mediumTerm.key, "main_rise");
  assert.equal(result.shortTerm.key, "main_rise");
  assert.equal(result.shortTerm.metrics.mainRiseCount, 4);
  assert.equal(result.intraday.key, "gap_fade");
  assert.equal(result.structuralCycle, "主升");
  assert.equal(result.indexSubPhase.key, "main_rise_strong_divergence");
  assert.equal(result.indexSubPhase.label, "主升内强分歧");
  assert.equal(result.indexSubPhase.structureIntact, true);
  assert.equal(result.indexSubPhase.intensity, "strong");
  assert.doesNotMatch(JSON.stringify(result.indexSubPhase), /加速/);
});

test("单日非主升震荡结构只到震荡待确认，细分仍展示真实结构标签", () => {
  const rangeRow = (code, name) => ({
    code,
    name,
    close: 101,
    changePct: 0.1,
    ma5: 103,
    ma10: 100,
    ma20: 105,
    ma60: 95,
    slope5: 0.3,
    slope10: -0.2,
    slope20: -0.1,
    trendKey: "sideways",
  });
  const result = buildIndexCycleRegime({
    indexStructures: [
      rangeRow("IDX_A", "匿名指数甲"),
      rangeRow("IDX_B", "匿名指数乙"),
      rangeRow("IDX_C", "匿名指数丙"),
      rangeRow("IDX_D", "匿名指数丁"),
    ],
    snapshot: {
      breadth: 0.51,
      allA: allA({
        price: 1380,
        close: 1380,
        open: 1378,
        high: 1384,
        low: 1374,
        prevClose: 1379,
        changePct: 0.07,
      }),
    },
  });

  assert.equal(result.dataQuality.grade, "complete");
  assert.equal(result.shortTerm.windowDays, 5);
  assert.equal(result.shortTerm.metrics.windowDays, 5);
  assert.equal(result.shortTerm.key, "range");
  assert.equal(result.shortTerm.confirmed, true);
  assert.equal(result.structuralCycle, "混沌");
  assert.equal(result.transition.key, "none");
  assert.equal(result.transition.to, null);
  assert.equal(result.rangeConfirmation.pending, false);
  assert.equal(result.indexSubPhase.key, "range_structure");
  assert.equal(result.indexSubPhase.label, "震荡结构·暂无主升细分");
  assert.equal(result.indexSubPhase.verified, true);
  assert.doesNotMatch(result.indexSubPhase.label, /待确认/);
});

test("5日短周期转弱只写入smallCycle，不能单独把震荡大周期改成退潮", () => {
  const weakeningRow = (code, name) => ({
    code,
    name,
    close: 99,
    changePct: -0.6,
    ma5: 101,
    ma10: 100,
    ma20: 98,
    ma60: 105,
    slope5: -0.5,
    slope10: -0.4,
    slope20: -0.1,
  });
  const result = buildIndexCycleRegime({
    indexStructures: [
      weakeningRow("IDX_A", "匿名指数甲"),
      weakeningRow("IDX_B", "匿名指数乙"),
      weakeningRow("IDX_C", "匿名指数丙"),
      weakeningRow("IDX_D", "匿名指数丁"),
    ],
    snapshot: {
      breadth: 0.42,
      allA: allA({ price: 1360, close: 1360, open: 1368, high: 1370, low: 1358, prevClose: 1368, changePct: -0.58 }),
    },
    currentMarketState: { structuralCycle: "震荡" },
  });

  assert.equal(result.mediumTerm.key, "repair_candidate");
  assert.equal(result.shortTerm.windowDays, 5);
  assert.equal(result.shortTerm.metrics.windowDays, 5);
  assert.equal(result.shortTerm.key, "weakening");
  assert.equal(result.structuralCycle, "震荡");
  assert.equal(result.smallCycle.key, "weakening");
  assert.notEqual(result.structuralCycle, "退潮");
});

test("当日赚钱效应扩张与强收盘把小周期识别为修复加强，同时保留5日转弱约束", () => {
  const row = (code, name) => ({
    code,
    name,
    close: 99,
    changePct: 1.45,
    ma5: 101,
    ma10: 95,
    ma20: 98,
    ma60: 105,
    slope5: -0.5,
    slope10: -0.4,
    slope20: 0.2,
  });
  const result = buildIndexCycleRegime({
    indexStructures: [
      row("IDX_A", "匿名指数甲"),
      row("IDX_B", "匿名指数乙"),
      row("IDX_C", "匿名指数丙"),
      row("IDX_D", "匿名指数丁"),
    ],
    snapshot: {
      avgIndexChange: 1.45,
      breadth: 0.635,
      allA: allA({
        price: 1393.49,
        close: 1393.49,
        open: 1374.92,
        high: 1393.49,
        low: 1373.98,
        prevClose: 1376.89,
        changePct: 1.21,
      }),
    },
    currentMarketState: {
      structuralCycle: "主升",
      dailyState: { key: "repair_strengthening", label: "修复加强" },
      profitEffect: { score: 90, label: "赚钱效应强" },
      lossEffect: { score: 10.1, label: "亏钱效应较低" },
      tradeWindow: {
        marketGate: [{ key: "core", passed: false }],
        coreEvidence: [],
      },
    },
  });

  assert.equal(result.shortTerm.windowDays, 5);
  assert.equal(result.shortTerm.metrics.windowDays, 5);
  assert.equal(result.shortTerm.key, "weakening");
  assert.equal(result.smallCycle.key, "repair_strengthening");
  assert.equal(result.smallCycle.label, "修复加强");
  assert.equal(result.smallCycle.indexStructure.key, "weakening");
  assert.equal(result.smallCycle.indexStructure.conflict, true);
  assert.equal(result.smallCycle.confirmation.status, "core_pending");
  assert.equal(result.structuralCycle, "主升");
});

test("退潮中的单日普涨即使中短结构转强，也不能跳跃直升主升", () => {
  const result = buildIndexCycleRegime({
    indexStructures: [
      mainRiseRow("IDX_A", "匿名指数甲"),
      mainRiseRow("IDX_B", "匿名指数乙"),
      mainRiseRow("IDX_C", "匿名指数丙"),
      mainRiseRow("IDX_D", "匿名指数丁"),
    ],
    snapshot: {
      breadth: 0.72,
      allA: allA({ changePct: 2.1 }),
    },
    currentMarketState: { structuralCycle: "退潮" },
  });

  assert.equal(result.mediumTerm.key, "main_rise");
  assert.equal(result.shortTerm.key, "main_rise");
  assert.equal(result.structuralCycle, "退潮");
});
