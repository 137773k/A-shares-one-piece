"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyFundFlow } = require("./flow-classifier");
const { _internals } = require("./server");

test("方向统计必须给出个股相对同方向中位数，不能只写板块整体强", () => {
  const stock = { code: "000636", mainConcept: "MLCC", changePct: 0.02 };
  const peers = [
    stock,
    { code: "A", mainConcept: "MLCC", changePct: 6 },
    { code: "B", mainConcept: "MLCC", changePct: 8 },
    { code: "C", mainConcept: "MLCC", changePct: 10 },
  ];
  const stats = _internals.fundFlowDirectionStats(stock, peers);
  assert.equal(stats.peerMedianChangePct, 8);
  assert.equal(stats.relativeStrength, -8);
});

test("净流出但个股、方向和市场均有承接，应定性为资金兑现", () => {
  const result = classifyFundFlow({
    mainInflowYi: -2.3,
    changePct: 1.2,
    closePosition: 0.78,
    structureState: "结构未破",
    klineProfile: { lastClose: 20, ma5: 19.5, ma10: 18.8 },
  }, {
    directionStats: { positiveRate: 0.68, avgChangePct: 1.1, activeCount: 5, breakdownCount: 1 },
    marketState: { profitEffect: 58, lossEffect: 31, dayState: "健康分化" },
    limitStats: { dtToday: 4, dtPrev: 7 },
  });
  assert.equal(result.key, "realization");
  assert.equal(result.label, "资金兑现");
  assert.match(result.tradeBias, /回流候选/);
  assert.ok(result.confidence >= 0.7);
});

test("健康兑现仍有相对强度、冲高保留和主动带动，应保留回流候选", () => {
  const result = classifyFundFlow({
    mainInflowYi: -3.1,
    changePct: 3.4,
    closePosition: 0.76,
    structureState: "结构未破",
    leadership: {
      initiative: {
        relativeStrength: 1.8,
        retentionPct: 78,
        proactive: true,
        followerCount: 2,
        breadthLift: 1,
        session: { maxChangePct: 4.2, currentChangePct: 3.4 },
      },
    },
  }, {
    directionStats: { positiveRate: 0.72, avgChangePct: 1.6, activeCount: 6, breakdownCount: 1 },
    marketState: { profitEffect: 61, lossEffect: 27, dayState: "健康分化" },
    limitStats: { dtToday: 3, dtPrev: 5 },
  });
  assert.equal(result.key, "realization");
  assert.equal(result.label, "资金兑现");
  assert.match(result.tradeBias, /回流候选/);
});

test("风华型板块强个股掉队且冲高回落，只能定性为掉队兑现", () => {
  const result = classifyFundFlow({
    mainInflowYi: -6.9,
    changePct: 0.02,
    closePosition: 0.52,
    structureState: "结构未破",
    leadership: {
      initiative: {
        relativeStrength: -8.3,
        retentionPct: 0.3,
        proactive: false,
        followerCount: 0,
        breadthLift: 0,
        session: { maxChangePct: 5.8, currentChangePct: 0.02 },
      },
    },
  }, {
    directionStats: { positiveRate: 0.9, avgChangePct: 8.3, activeCount: 8, breakdownCount: 0 },
    marketState: { profitEffect: 66, lossEffect: 24, dayState: "健康分化" },
    limitStats: { dtToday: 3, dtPrev: 4 },
  });
  assert.equal(result.key, "lagging_realization");
  assert.equal(result.label, "掉队兑现");
  assert.match(result.tradeBias, /仅保留观察/);
  assert.match(result.tradeBias, /不进入次日回流候选/);
  assert.ok(result.evidence.some((item) => item.includes("相对掉队")));
});

test("分时主动性缺失时保持旧兼容，不凭方向相对值单独改成掉队兑现", () => {
  const result = classifyFundFlow({
    mainInflowYi: -2.4,
    changePct: 0.5,
    structureState: "结构未破",
  }, {
    directionStats: {
      positiveRate: 0.75,
      avgChangePct: 4,
      relativeStrength: -3.5,
      activeCount: 5,
      breakdownCount: 0,
    },
    marketState: { profitEffect: 58, lossEffect: 29, dayState: "健康分化" },
    limitStats: { dtToday: 4, dtPrev: 5 },
  });
  assert.equal(result.key, "realization");
});

test("领导力相对强度为null时回退方向相对强度，仍能识别掉队兑现", () => {
  const result = classifyFundFlow({
    mainInflowYi: -4.2,
    changePct: 0.2,
    structureState: "结构未破",
    leadership: {
      initiative: {
        relativeStrength: null,
        retentionPct: 4,
        proactive: false,
        followerCount: 0,
        breadthLift: 0,
        session: { maxChangePct: 5.2, currentChangePct: 0.2 },
      },
    },
  }, {
    directionStats: {
      positiveRate: 0.8,
      avgChangePct: 4.6,
      relativeStrength: -4.4,
      activeCount: 5,
      breakdownCount: 0,
    },
    marketState: { profitEffect: 60, lossEffect: 25, dayState: "健康分化" },
    limitStats: { dtToday: 3, dtPrev: 4 },
  });
  assert.equal(result.key, "lagging_realization");
});

test("净流出叠加破位、板块转弱与恐慌扩散，应定性为资金出逃", () => {
  const result = classifyFundFlow({
    mainInflowYi: -5.6,
    changePct: -7.3,
    closePosition: 0.12,
    structureBroken: true,
    klineProfile: { lastClose: 15, ma5: 17, ma10: 18, longBearBreak3d: true },
  }, {
    directionStats: { positiveRate: 0.18, avgChangePct: -3.4, activeCount: 0, breakdownCount: 6 },
    marketState: { profitEffect: 16, lossEffect: 78, panic: true },
    limitStats: { dtToday: 23, dtPrev: 9 },
  });
  assert.equal(result.key, "escape");
  assert.equal(result.label, "资金出逃");
  assert.match(result.tradeBias, /取消交易资格/);
});

test("个股抗跌但板块与市场恐慌，证据冲突必须待确认", () => {
  const result = classifyFundFlow({
    mainInflowYi: -1.2,
    changePct: 2,
    structureIntact: true,
  }, {
    directionStats: { positiveRate: 0.2, avgChangePct: -3 },
    marketState: { profitEffect: 18, lossEffect: 74, negativeFeedbackSpread: true },
    limitStats: { dtToday: 20, dtPrev: 8 },
  });
  assert.equal(result.key, "uncertain");
  assert.equal(result.conflict, true);
  assert.ok(result.evidence.some((item) => item.includes("冲突")));
});

test("同一维度内部数据相互冲突也必须待确认", () => {
  const result = classifyFundFlow({
    mainInflowYi: -2,
    changePct: 3,
    structureBroken: true,
  }, {
    directionStats: { positiveRate: 0.7, avgChangePct: 1.5 },
    marketState: { profitEffect: 62, lossEffect: 28 },
    limitStats: { dtToday: 3, dtPrev: 5 },
  });
  assert.equal(result.key, "uncertain");
  assert.equal(result.conflict, true);
  assert.ok(result.evidence.some((item) => item.includes("个股内部信号冲突")));
});

test("只有净流出一项时不能定性，更不能认定出逃", () => {
  const result = classifyFundFlow({ mainInflowYi: -8 }, {});
  assert.equal(result.key, "uncertain");
  assert.match(result.tradeBias, /等待确认/);
  assert.ok(result.evidence.some((item) => item.includes("不单项定性")));
});

test("净流入不属于净流出分类场景", () => {
  const result = classifyFundFlow({ mainInflowYi: 1.5 }, {});
  assert.equal(result.key, "uncertain");
  assert.match(result.tradeBias, /无需按流出淘汰/);
});
