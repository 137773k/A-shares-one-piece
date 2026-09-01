const test = require("node:test");
const assert = require("node:assert");
const {
  computeMaProfile,
  evaluateOpportunityDataCompleteness,
} = require("./trading-rules");

// 构造 25 根递增收盘价的 K 线（多头排列、5日线向上）
function risingRows(n = 25) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const close = 10 + i * 0.5; // 持续上涨
    rows.push({ open: close - 0.2, close, high: close + 0.1, low: close - 0.3, amount: 6e8, changePct: 2, turnover: 5 });
  }
  return rows;
}

test("computeMaProfile: 上涨结构给出多头排列且5日线向上", () => {
  const p = computeMaProfile(risingRows());
  assert.ok(p, "应返回画像");
  assert.ok(p.ma5 > p.ma10 && p.ma10 > p.ma20, "应多头排列");
  assert.strictEqual(p.ma5Rising, true);
  assert.strictEqual(p.longBearBreak3d, false);
  assert.ok(p.avgAmount5Yi > 5, "5日均额应>5亿");
  assert.strictEqual(p.lastClose, 10 + 24 * 0.5);
});

test("computeMaProfile: 数据不足返回 null", () => {
  assert.strictEqual(computeMaProfile([{ close: 1, open: 1, amount: 1 }]), null);
});

test("computeMaProfile: 最近3日放量长阴破位被识别", () => {
  const rows = risingRows();
  const last = rows[rows.length - 1];
  // 把最后一根改成放量长阴、跌破MA10
  last.open = 22;
  last.close = 19; // 跌破MA10
  last.amount = 6e8 * 3; // 放量
  const p = computeMaProfile(rows);
  assert.strictEqual(p.longBearBreak3d, true);
});

const { hardGate } = require("./trading-rules");

const goodKp = { ma5: 12, ma10: 11, ma20: 10, ma5Rising: true, longBearBreak3d: false, avgAmount5Yi: 8, lastClose: 12.5 };

test("hardGate: 全满足则通过", () => {
  const g = hardGate({ klineProfile: goodKp, volumeRatio: 2, mainInflowYi: 1.2 });
  assert.strictEqual(g.pass, true);
  assert.strictEqual(g.hardFails.length, 0);
});

test("hardGate: 均线非多头排列硬剔除", () => {
  const g = hardGate({ klineProfile: { ...goodKp, ma10: 13 }, volumeRatio: 2, mainInflowYi: 1 });
  assert.strictEqual(g.pass, false);
  assert.ok(g.hardFails.some((f) => f.includes("多头排列")));
});

test("hardGate: 量比缺失降级为软标不剔除", () => {
  const g = hardGate({ klineProfile: goodKp, volumeRatio: 0, mainInflowYi: 1 });
  assert.strictEqual(g.pass, true);
  assert.ok(g.softFlags.some((f) => f.includes("量比")));
});

test("hardGate: 只有主力净流出时不能硬剔除，缺失仍软标", () => {
  const out = hardGate({ klineProfile: goodKp, volumeRatio: 2, mainInflowYi: -0.5 });
  assert.strictEqual(out.pass, true);
  assert.ok(out.softFlags.some((f) => f.includes("净流出性质待确认")));
  assert.ok(!out.hardFails.some((f) => f.includes("主力净流出")));
  const miss = hardGate({ klineProfile: goodKp, volumeRatio: 2, mainInflowYi: 0 });
  assert.strictEqual(miss.pass, true);
  assert.ok(miss.softFlags.some((f) => f.includes("主力净流入")));
});

test("hardGate: 普通股量比低于1.2只降分提示，不再硬拒", () => {
  const boundary = hardGate({ klineProfile: goodKp, volumeRatio: 1.2, mainInflowYi: 1 });
  assert.strictEqual(boundary.pass, true);
  assert.ok(!boundary.hardFails.some((item) => item.includes("量比")));

  const below = hardGate({ klineProfile: goodKp, volumeRatio: 1.19, mainInflowYi: 1 });
  assert.strictEqual(below.pass, true);
  assert.ok(!below.hardFails.some((item) => item.includes("量比")));
  assert.ok(below.softFlags.some((item) => item.includes("参与价值降分")));
});

test("hardGate: 净流出被多维证据确认是兑现时保留回流候选", () => {
  const out = hardGate({
    klineProfile: goodKp,
    volumeRatio: 2,
    mainInflowYi: -1.5,
    changePct: 1.1,
    structureIntact: true,
  }, {
    directionStats: { positiveRate: 0.65, avgChangePct: 1 },
    marketState: { profitEffect: 58, lossEffect: 30, dayState: "健康分化" },
    limitStats: { dtToday: 4, dtPrev: 6 },
  });
  assert.strictEqual(out.pass, true);
  assert.equal(out.metrics.flowNature.key, "realization");
  assert.ok(out.softFlags.some((f) => f.includes("资金兑现")));
});

test("hardGate: 只有多维证据确认资金出逃才取消交易资格", () => {
  const brokenKp = { ...goodKp, ma5: 12, ma10: 13, ma20: 14, lastClose: 10, ma5Rising: false, longBearBreak3d: true };
  const out = hardGate({
    klineProfile: brokenKp,
    volumeRatio: 2,
    mainInflowYi: -4,
    changePct: -7,
    structureBroken: true,
  }, {
    directionStats: { positiveRate: 0.15, avgChangePct: -3, activeCount: 0, breakdownCount: 5 },
    marketState: { profitEffect: 12, lossEffect: 80, panic: true },
    limitStats: { dtToday: 22, dtPrev: 8 },
  });
  assert.strictEqual(out.pass, false);
  assert.equal(out.metrics.flowNature.key, "escape");
  assert.ok(out.hardFails.some((f) => f.includes("资金出逃")));
});

const { evaluateAdaptiveLiquidity } = require("./trading-rules");

test("容量票成交充分时，4.57%低换手不能一票否决", () => {
  const stock = {
    klineProfile: { ...goodKp, avgAmount5Yi: 38 },
    amountYi: 42,
    floatMktCapYi: 780,
    turnoverRate: 4.57,
    avgTurnoverRate5d: 5.1,
    volumeRatio: 2,
    mainInflowYi: 1,
    ticketType: "容量票",
  };
  const liquidity = evaluateAdaptiveLiquidity(stock);
  assert.equal(liquidity.status, "sufficient");
  const gate = hardGate(stock);
  assert.equal(gate.pass, true);
  assert.ok(!gate.hardFails.some((f) => f.includes("换手")));
  assert.ok(gate.softFlags.some((f) => f.includes("不作硬性淘汰")));
});

test("绝对成交与自身历史同时明显萎缩，才判成交活跃度不足", () => {
  const stock = {
    klineProfile: { ...goodKp, avgAmount5Yi: 12 },
    amountYi: 2,
    floatMktCapYi: 180,
    turnoverRate: 1.5,
    avgTurnoverRate5d: 5,
    volumeRatio: 2,
    mainInflowYi: 1,
  };
  const liquidity = evaluateAdaptiveLiquidity(stock);
  assert.equal(liquidity.status, "insufficient");
  const gate = hardGate(stock);
  assert.equal(gate.pass, false);
  assert.ok(gate.hardFails.some((f) => f.includes("成交活跃度不足")));
});

test("只有低换手、缺成交历史时只标待确认，不硬拒", () => {
  const stock = {
    klineProfile: goodKp,
    turnoverRate: 2,
    volumeRatio: 2,
    mainInflowYi: 1,
  };
  const liquidity = evaluateAdaptiveLiquidity(stock);
  assert.equal(liquidity.status, "uncertain");
  assert.equal(hardGate(stock).pass, true);
});

test("hardGate: 缺K线直接不过", () => {
  const g = hardGate({ volumeRatio: 2, mainInflowYi: 1 });
  assert.strictEqual(g.pass, false);
});

test("hardGate: 次新股筹码快速重置可用近期成本替代不完整均线", () => {
  const g = hardGate({
    amountYi: 22,
    turnoverRate: 42,
    volumeRatio: 2,
    mainInflowYi: 1,
    klineProfile: {
      isNewListing: true,
      tradingDays: 13,
      lastClose: 197,
      avgAmount5Yi: 18,
      recentWeightedCost: 184,
      effectiveTurnover5: 96,
      newStockChipState: "筹码快速重置",
      newStockDistributionRisk: false,
      structureBreak: false,
      longBearBreak3d: false,
    },
  });
  assert.strictEqual(g.pass, true);
  assert.strictEqual(g.metrics.newListingMode, true);
  assert.ok(g.softFlags.some((item) => item.includes("快速重置")));
});

test("hardGate: 高换手次新完成筹码重置且成交未缩时，不被普通股量比1.2单项误杀", () => {
  const g = hardGate({
    amountYi: 33.5,
    floatMktCapYi: 59.8,
    turnoverRate: 57.75,
    volumeRatio: 1.14,
    mainInflowYi: 0.8,
    klineProfile: {
      isNewListing: true,
      tradingDays: 14,
      lastClose: 197,
      avgAmount5Yi: 26.88,
      recentWeightedCost: 158.5,
      closeToCostPct: 22.3,
      effectiveTurnover5: 97.4,
      newStockChipState: "筹码快速重置",
      newStockDistributionRisk: false,
      structureBreak: false,
      longBearBreak3d: false,
    },
  });
  assert.strictEqual(g.pass, true);
  assert.strictEqual(g.metrics.newStockResetVolumeRelax, true);
  assert.ok(g.softFlags.some((item) => item.includes("次新筹码已充分交换")));
});

test("hardGate: 次新筹码重置下量比低于1只降分，其他门槛通过仍可保留", () => {
  const g = hardGate({
    amountYi: 18,
    floatMktCapYi: 60,
    turnoverRate: 32,
    volumeRatio: 0.82,
    mainInflowYi: 0.5,
    klineProfile: {
      isNewListing: true,
      tradingDays: 14,
      lastClose: 171,
      avgAmount5Yi: 21,
      recentWeightedCost: 160,
      closeToCostPct: 6.9,
      effectiveTurnover5: 88,
      newStockChipState: "筹码快速重置",
      newStockDistributionRisk: false,
      structureBreak: false,
      longBearBreak3d: false,
    },
  });
  assert.strictEqual(g.pass, true);
  assert.ok(!g.hardFails.some((item) => item.includes("量比")));
  assert.ok(g.softFlags.some((item) => item.includes("参与价值降分")));
});

test("hardGate: 次新高换手跌破近期成本仍必须硬拒", () => {
  const g = hardGate({
    amountYi: 20,
    turnoverRate: 58,
    volumeRatio: 2,
    mainInflowYi: 1,
    klineProfile: {
      isNewListing: true,
      tradingDays: 15,
      lastClose: 145,
      avgAmount5Yi: 16,
      recentWeightedCost: 158,
      effectiveTurnover5: 93,
      newStockChipState: "高换手派发风险",
      newStockDistributionRisk: true,
      structureBreak: false,
      longBearBreak3d: false,
    },
  });
  assert.strictEqual(g.pass, false);
  assert.ok(g.hardFails.some((item) => item.includes("派发风险")));
});

test("hardGate: volumeRatio为NaN时应软标而非硬拒", () => {
  // Number(undefined) === NaN，模拟东财 f10 字段缺失
  const g = hardGate({ klineProfile: goodKp, volumeRatio: NaN, mainInflowYi: 1 });
  assert.strictEqual(g.pass, true, "NaN量比不应硬拒");
  assert.ok(g.softFlags.some((f) => f.includes("量比")), "应降级为软标");
  assert.ok(!g.hardFails.some((f) => f.includes("量比")), "不应出现在hardFails");
});

test("hardGate: mainInflowYi为NaN时应软标而非硬拒", () => {
  // moneyYi(undefined) = 0 所以实际是0，但防御 NaN 直接赋值的情形
  const g = hardGate({ klineProfile: goodKp, volumeRatio: 2, mainInflowYi: NaN });
  assert.strictEqual(g.pass, true, "NaN主力流入不应硬拒");
  assert.ok(g.softFlags.some((f) => f.includes("主力净流入")), "应降级为软标");
  assert.ok(!g.hardFails.some((f) => f.includes("主力净流出")), "不应出现在hardFails");
});

const { classifySubPhase } = require("./trading-rules");

test("classifySubPhase: 修复不能作为大周期输入，五态内非主升周期保留自身", () => {
  assert.strictEqual(classifySubPhase("修复", {}).subPhase, "周期待确认");
  assert.strictEqual(classifySubPhase("震荡", {}).subPhase, "震荡");
});

function completeOpportunityEvidence(overrides = {}) {
  const tradingDate = "2026-08-21";
  const source = {
    price: 18.6,
    amountYi: 26,
    turnoverRate: 8.2,
    totalMktCapYi: 220,
    floatMktCapYi: 180,
    factorContext: { tradingDate },
    marketCapCarrier: {
      method: "same_day_candidate_bucket_comparison_unvalidated_v2",
      totalCapYi: 220,
      floatCapYi: 180,
      capDataQuality: "total_cap_available",
      bucketKey: "100_300",
      bucketLabel: "100-300亿",
    },
    klineProfile: {
      avgAmount5Yi: 20,
      lastTradingDate: tradingDate,
      lastSession: {
        tradingDate,
        close: 18.6,
        amountYi: 26,
        turnoverRate: 8.2,
        source: "fixture-closing-kline",
        snapshotKind: "closing",
        verified: true,
        completed: true,
      },
    },
  };
  return { ...source, ...overrides };
}

test("机会数据契约：同日价格/成交/换手/市值/收盘完整时通过，资金流缺失只作风险备注", () => {
  const evidence = evaluateOpportunityDataCompleteness(completeOpportunityEvidence(), {
    tradingDate: "2026-08-21",
  });
  assert.equal(evidence.qualified, true);
  assert.equal(evidence.status, "complete");
  assert.equal(evidence.evidence.price.source, "klineProfile.lastSession.close:fixture-closing-kline");
  assert.equal(evidence.evidence.liquidityCapacity.mode, "turnover");
  assert.equal(evidence.evidence.marketCap.usable, true);
  assert.equal(evidence.evidence.session.state, "verified_closing");
  assert.equal(evidence.evidence.fundFlow.required, false);
  assert.equal(evidence.evidence.fundFlow.available, false);
  assert.match(evidence.riskNotes.join("；"), /资金流缺失.*不影响关键数据完整性/);
});

test("机会数据契约：容量成交可替代单日换手，但必须有可追溯总市值", () => {
  const stock = completeOpportunityEvidence({
    amountYi: 52,
    turnoverRate: null,
    totalMktCapYi: 900,
    floatMktCapYi: 700,
    ticketType: "容量票",
    marketCapCarrier: {
      method: "same_day_candidate_bucket_comparison_unvalidated_v2",
      totalCapYi: 900,
      floatCapYi: 700,
      capDataQuality: "total_cap_available",
      bucketKey: "500_1000",
      bucketLabel: "500-1000亿",
    },
    klineProfile: {
      avgAmount5Yi: 40,
      lastSession: {
        tradingDate: "2026-08-21",
        close: 18.6,
        amountYi: 52,
        turnoverRate: null,
        source: "fixture-closing-kline",
        snapshotKind: "closing",
        verified: true,
        completed: true,
      },
    },
  });
  const evidence = evaluateOpportunityDataCompleteness(stock, { tradingDate: "2026-08-21" });
  assert.equal(evidence.qualified, true);
  assert.equal(evidence.evidence.liquidityCapacity.mode, "capacity");

  const noLineage = evaluateOpportunityDataCompleteness({
    ...stock,
    marketCapCarrier: { totalCapYi: 900, bucketKey: "500_1000", capDataQuality: "total_cap_available" },
  }, { tradingDate: "2026-08-21" });
  assert.equal(noLineage.qualified, false);
  assert.equal(noLineage.missingFields.includes("marketCap"), true);
});

test("机会数据契约：旧交易日收盘不得冒充当日价格、成交与状态", () => {
  const stale = evaluateOpportunityDataCompleteness(completeOpportunityEvidence(), {
    tradingDate: "2026-08-22",
  });
  assert.equal(stale.qualified, false);
  assert.equal(stale.missingFields.includes("sessionState"), true);
  assert.equal(stale.missingFields.includes("price"), true);
  assert.equal(stale.missingFields.includes("amount"), true);
});

test("classifySubPhase: 涨停放大且炸板率低 = 高潮加速", () => {
  const r = classifySubPhase("主升", { ztToday: 110, ztPrev: 90, ztHistory: 118, dtToday: 3 });
  assert.strictEqual(r.subPhase, "高潮加速");
});

test("classifySubPhase: 炸板率高 = 高位分歧", () => {
  const r = classifySubPhase("主升", { ztToday: 70, ztPrev: 90, ztHistory: 110, dtToday: 6 });
  assert.strictEqual(r.subPhase, "高位分歧");
});

test("classifySubPhase: 平稳延续 = 主升中", () => {
  const r = classifySubPhase("主升", { ztToday: 92, ztPrev: 90, ztHistory: 100, dtToday: 4 });
  assert.strictEqual(r.subPhase, "主升中");
});

const { tradeMode, stopProfitLoss } = require("./trading-rules");

test("tradeMode: 容量票/二波=趋势，龙头=打板，其余=低吸", () => {
  assert.strictEqual(tradeMode({ ticketType: "容量票" }), "趋势");
  assert.strictEqual(tradeMode({ wave: "二波突破" }), "趋势");
  assert.strictEqual(tradeMode({ role: "龙头" }), "打板");
  assert.strictEqual(tradeMode({ role: "中军" }), "低吸");
});

test("stopProfitLoss: 混沌期区间收窄(打板)", () => {
  const s = stopProfitLoss("打板", { cycle: "混沌", subPhase: "混沌", position: "20%-40%" });
  assert.deepStrictEqual(s.stopLoss.range, [-3.5, -3]);
  assert.strictEqual(s.position, "20%-40%");
  assert.ok(s.riskReward > 0);
});

test("stopProfitLoss: 主升放宽止盈、高潮收紧、分歧止损上移", () => {
  const up = stopProfitLoss("趋势", { cycle: "主升", subPhase: "主升中", position: "70%-100%" });
  const climax = stopProfitLoss("趋势", { cycle: "主升", subPhase: "高潮加速", position: "70%-100%" });
  const diverge = stopProfitLoss("打板", { cycle: "主升", subPhase: "高位分歧", position: "70%-100%" });
  assert.ok(up.takeProfit.range[1] > 25, "主升应放宽止盈上沿");
  assert.ok(climax.takeProfit.range[1] < 25, "高潮应收紧止盈");
  assert.deepStrictEqual(diverge.stopLoss.range, [-2, -1]);
});

test("stopProfitLoss: 退潮最紧止损优先空仓", () => {
  const s = stopProfitLoss("低吸", { cycle: "退潮", subPhase: "退潮", position: "0%" });
  assert.deepStrictEqual(s.stopLoss.range, [-3, -2]);
});
