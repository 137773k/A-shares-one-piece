"use strict";

const assert = require("assert");
const {
  analyzeMarketCycleEffects,
  buildEmotionEffectContext,
  analyzeIndexEnvironment,
  analyzeTradingWindow,
  resolveStructuralCycle,
} = require("./market-cycle-engine");

function run(name, test) {
  try {
    test();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

function snapshot(overrides = {}) {
  return {
    avgIndexChange: 0.2,
    breadth: 0.52,
    shszAmountYi: 22000,
    ...overrides,
  };
}

function previousSnapshot(overrides = {}) {
  return snapshot({
    avgIndexChange: -0.1,
    breadth: 0.47,
    shszAmountYi: 21000,
    tradingDate: "2026-07-21",
    ...overrides,
  });
}

function cycleIndexEnvironment(overrides = {}) {
  const aboveMa5Count = overrides.aboveMa5Count ?? 2;
  const mediumKey = overrides.mediumKey || "repair";
  const shortKey = overrides.shortKey || "repair";
  const currentQualified = aboveMa5Count >= 3
    && !["decline", "unknown"].includes(mediumKey)
    && !["weakening", "unknown"].includes(shortKey);
  return {
    verified: true,
    structureCoverage: 4,
    cycle: overrides.cycle || "混沌",
    avgIndexChange: overrides.avgIndexChange ?? 0.2,
    breadth: overrides.breadth ?? 0.55,
    mediumTerm: { key: mediumKey },
    shortTerm: {
      windowDays: 5,
      key: shortKey,
      metrics: {
        windowDays: 5,
        aboveMa5KnownCount: 4,
        aboveMa5Count,
        aboveMa5Rate: aboveMa5Count / 4,
      },
    },
    rangeConfirmation: { windowDays: 5, currentQualified },
  };
}

run("修复加强：赚钱扩张、亏钱收缩、广度同步改善", () => {
  const result = analyzeMarketCycleEffects({
    snapshot: snapshot({ avgIndexChange: 0.85, breadth: 0.63, shszAmountYi: 23800 }),
    previousSnapshot: previousSnapshot({ avgIndexChange: -0.35, breadth: 0.39, shszAmountYi: 21800 }),
    limitStats: { ztToday: 76, dtToday: 4, dates: { today: "2026-07-22", prev: "2026-07-21" } },
    previousLimit: { ztToday: 43, dtToday: 15, tradingDate: "2026-07-21" },
    leadership: { activeLeaderCount: 2, coreAvgChangePct: 5.2, corePositiveRate: 0.78, coreBreakdownCount: 0 },
    directions: { activeDirectionCount: 3, weakDirectionCount: 0, totalDirectionCount: 4, avgChangePct: 2.4 },
  });

  assert.strictEqual(result.dailyState.key, "repair_strengthening");
  assert.ok(result.profitEffect.score >= 65, `profit=${result.profitEffect.score}`);
  assert.ok(result.lossEffect.score <= 40, `loss=${result.lossEffect.score}`);
  assert.strictEqual(result.profitEffect.trend, "improving");
  assert.strictEqual(result.lossEffect.trend, "improving");
  assert.strictEqual(result.dataQuality.previousTradingDayAvailable, true);
});

run("健康分化：涨停回落但跌停收缩、赚钱效应仍在且成交未塌缩", () => {
  const result = analyzeMarketCycleEffects({
    snapshot: snapshot({ avgIndexChange: -1.53, breadth: 0.2845, shszAmountYi: 26533 }),
    previousSnapshot: previousSnapshot({ avgIndexChange: 0.55, breadth: 0.58, shszAmountYi: 27021 }),
    limitStats: { ztToday: 46, dtToday: 8, dates: { today: "2026-07-22", prev: "2026-07-21" } },
    previousLimit: { ztToday: 120, dtToday: 20, tradingDate: "2026-07-21" },
    leadership: { activeLeaderCount: 1, coreAvgChangePct: 1.8, corePositiveRate: 0.55, coreBreakdownCount: 0 },
    directions: { activeDirectionCount: 1, weakDirectionCount: 1, totalDirectionCount: 4, avgChangePct: 0.4 },
  });

  assert.strictEqual(result.dailyState.key, "healthy_divergence");
  assert.strictEqual(result.dailyState.retreatCandidate, false);
  assert.ok(result.lossEffect.score < 60, `loss=${result.lossEffect.score}`);
  assert.ok(result.dailyState.reasons.some((reason) => reason.includes("20→8")));
});

run("负反馈扩散：赚钱坍缩与亏钱扩大同时出现才成为退潮候选", () => {
  const result = analyzeMarketCycleEffects({
    snapshot: snapshot({ avgIndexChange: -1.75, breadth: 0.22, shszAmountYi: 17100, largeLossCount: 420 }),
    previousSnapshot: previousSnapshot({ avgIndexChange: -0.2, breadth: 0.48, shszAmountYi: 22400, largeLossCount: 150 }),
    limitStats: { ztToday: 22, dtToday: 31, dates: { today: "2026-07-22", prev: "2026-07-21" } },
    previousLimit: { ztToday: 72, dtToday: 5, tradingDate: "2026-07-21" },
    leadership: { activeLeaderCount: 0, coreAvgChangePct: -6.5, corePositiveRate: 0.12, coreBreakdownCount: 3, highBoardNegativeRate: 0.72 },
    directions: { activeDirectionCount: 0, weakDirectionCount: 4, totalDirectionCount: 5, avgChangePct: -3.1 },
  });

  assert.strictEqual(result.dailyState.key, "retreat_candidate");
  assert.strictEqual(result.dailyState.retreatCandidate, true);
  assert.ok(result.lossEffect.score >= 65, `loss=${result.lossEffect.score}`);
  assert.ok(result.profitEffect.score <= 38, `profit=${result.profitEffect.score}`);
  assert.strictEqual(result.lossEffect.trend, "worsening");
});

run("冰点：赚钱效应低位且广度冰冷，但极端负反馈开始收缩", () => {
  const result = analyzeMarketCycleEffects({
    snapshot: snapshot({ avgIndexChange: -1.35, breadth: 0.19, shszAmountYi: 15000 }),
    previousSnapshot: previousSnapshot({ avgIndexChange: -2.1, breadth: 0.13, shszAmountYi: 18200 }),
    limitStats: { ztToday: 18, dtToday: 18, dates: { today: "2026-07-22", prev: "2026-07-21" } },
    previousLimit: { ztToday: 16, dtToday: 42, tradingDate: "2026-07-21" },
    leadership: { activeLeaderCount: 0, coreAvgChangePct: -1, corePositiveRate: 0.25, coreBreakdownCount: 0 },
    directions: { activeDirectionCount: 0, weakDirectionCount: 1, totalDirectionCount: 4, avgChangePct: -0.8 },
  });

  assert.strictEqual(result.dailyState.key, "ice_point");
  assert.strictEqual(result.dailyState.retreatCandidate, false);
  assert.ok(result.profitEffect.score <= 32, `profit=${result.profitEffect.score}`);
  assert.strictEqual(result.lossEffect.trend, "improving");
});

run("指数和广度单独走弱不能触发退潮候选", () => {
  const result = analyzeMarketCycleEffects({
    snapshot: snapshot({ avgIndexChange: -2.2, breadth: 0.17, shszAmountYi: 20500 }),
    previousSnapshot: previousSnapshot({ shszAmountYi: 21000 }),
    limitStats: { ztToday: 52, dtToday: 4 },
    previousLimit: { ztToday: 58, dtToday: 5, tradingDate: "2026-07-21" },
  });

  assert.notStrictEqual(result.dailyState.key, "retreat_candidate");
  assert.strictEqual(result.dailyState.retreatCandidate, false);
});

run("缺数据：不抛错，明确降级且不确认周期变化", () => {
  assert.doesNotThrow(() => analyzeMarketCycleEffects());
  assert.doesNotThrow(() => analyzeMarketCycleEffects({ snapshot: null, limitStats: null }));
  const result = analyzeMarketCycleEffects({ snapshot: { avgIndexChange: "bad" } });

  assert.strictEqual(result.dailyState.key, "data_insufficient");
  assert.strictEqual(result.dataQuality.grade, "insufficient");
  assert.strictEqual(result.dataQuality.previousTradingDayAvailable, false);
  assert.ok(result.dataQuality.issues.length > 0);
  assert.ok(Number.isFinite(result.profitEffect.score));
  assert.ok(Number.isFinite(result.lossEffect.score));
});

run("全市场情绪效应上下文：指数、成交额、候选股和热门方向变化不能改变P/N", () => {
  const common = {
    snapshot: snapshot({
      tradingDate: "2026-07-22",
      breadth: 0.61,
      largeGainCount: 420,
      largeLossCount: 55,
    }),
    previousSnapshot: previousSnapshot(),
    limitStats: {
      ztToday: 72,
      dtToday: 4,
      ztHistory: 88,
      dates: { today: "2026-07-22", prev: "2026-07-21" },
    },
    previousLimit: { ztToday: 48, dtToday: 9, tradingDate: "2026-07-21" },
  };
  const weakIndexStrongCandidates = analyzeMarketCycleEffects({
    ...common,
    snapshot: { ...common.snapshot, avgIndexChange: -3.5, shszAmountYi: 9000 },
    leadership: { activeLeaderCount: 5, coreAvgChangePct: 9, corePositiveRate: 1 },
    directions: { activeDirectionCount: 8, weakDirectionCount: 0, totalDirectionCount: 8, avgChangePct: 5 },
  }).emotionEffectContext;
  const strongIndexWeakCandidates = analyzeMarketCycleEffects({
    ...common,
    snapshot: { ...common.snapshot, avgIndexChange: 4.2, shszAmountYi: 50000 },
    leadership: { activeLeaderCount: 0, coreAvgChangePct: -9, corePositiveRate: 0, coreBreakdownCount: 8 },
    directions: { activeDirectionCount: 0, weakDirectionCount: 9, totalDirectionCount: 9, avgChangePct: -6 },
  }).emotionEffectContext;

  assert.deepStrictEqual(strongIndexWeakCandidates, weakIndexStrongCandidates);
  assert.strictEqual(weakIndexStrongCandidates.status, "ready");
  assert.strictEqual(weakIndexStrongCandidates.guardrails.indexDirectionExcluded, true);
  assert.strictEqual(weakIndexStrongCandidates.guardrails.turnoverDirectionExcluded, true);
  assert.strictEqual(weakIndexStrongCandidates.guardrails.candidateLeadershipExcluded, true);
  assert.strictEqual(weakIndexStrongCandidates.guardrails.hotDirectionsExcluded, true);
});

run("全市场情绪效应上下文：缺关键字段时不得用50伪造可用", () => {
  const unavailable = buildEmotionEffectContext({
    snapshot: { avgIndexChange: 8, shszAmountYi: 99999 },
    leadership: { activeLeaderCount: 9, coreAvgChangePct: 10, corePositiveRate: 1 },
    directions: { activeDirectionCount: 12, avgChangePct: 8 },
  });
  assert.strictEqual(unavailable.status, "unavailable");
  assert.strictEqual(unavailable.scores.profit, null);
  assert.strictEqual(unavailable.scores.loss, null);
  assert.strictEqual(unavailable.profit.coveragePct, 0);
  assert.strictEqual(unavailable.loss.coveragePct, 0);
  assert.strictEqual(unavailable.guardrails.unknownFallback, null);
  assert.strictEqual(unavailable.guardrails.selectionAuthority, false);

  const partial = buildEmotionEffectContext({
    snapshot: { tradingDate: "2026-07-22", breadth: 0.55 },
    limitStats: { ztToday: 45, dtToday: 7, dates: { today: "2026-07-22" } },
  });
  assert.strictEqual(partial.status, "partial");
  assert.ok(Number.isFinite(partial.scores.profit));
  assert.ok(Number.isFinite(partial.scores.loss));
  assert.ok(partial.profit.coveragePct < 70);
  assert.ok(partial.loss.coveragePct < 70);
  assert.ok(partial.dataQuality.missingCritical.includes("exactPreviousLimitComparison"));
});

run("全市场情绪效应上下文：昨日零跌停仍是已知跨日比较，今日新增跌停计入恶化", () => {
  const result = buildEmotionEffectContext({
    snapshot: { tradingDate: "2026-07-22", breadth: 0.61 },
    previousSnapshot: { tradingDate: "2026-07-21", breadth: 0.58 },
    limitStats: {
      ztToday: 76,
      dtToday: 3,
      ztHistory: 93,
      dates: { today: "2026-07-22", prev: "2026-07-21" },
    },
    previousLimit: { ztToday: 52, dtToday: 0, tradingDate: "2026-07-21" },
  });

  assert.strictEqual(result.status, "ready");
  assert.strictEqual(result.dataQuality.crossDayKnown, true);
  assert.strictEqual(result.loss.components.limitDownTrend.available, true);
  assert.ok(result.loss.components.limitDownTrend.score >= 60);
});

run("基础周期：健康分化只更新小周期，不把大周期直接打成退潮", () => {
  const result = resolveStructuralCycle({
    previousCycle: "混沌",
    legacyCycle: "冰点",
    dailyState: { key: "healthy_divergence" },
    profitEffect: { score: 49 },
    lossEffect: { score: 36 },
    historyFresh: true,
  });
  assert.strictEqual(result.cycle, "混沌");
  assert.strictEqual(result.changed, false);
});

run("基础周期：缺真正上一交易日归档时禁止强制切换", () => {
  const result = resolveStructuralCycle({
    previousCycle: "混沌",
    legacyCycle: "退潮",
    dailyState: { key: "retreat_candidate" },
    profitEffect: { score: 18 },
    lossEffect: { score: 88 },
    historyFresh: false,
  });
  assert.strictEqual(result.cycle, "混沌");
  assert.strictEqual(result.pending, true);
});

run("基础周期：退潮需要连续收盘负反馈或单日极端条件", () => {
  const first = resolveStructuralCycle({
    previousCycle: "混沌",
    dailyState: { key: "retreat_candidate" },
    previousDailyState: { key: "healthy_divergence" },
    profitEffect: { score: 31 },
    lossEffect: { score: 70 },
    historyFresh: true,
  });
  assert.strictEqual(first.cycle, "混沌");
  assert.strictEqual(first.pending, true);

  const confirmed = resolveStructuralCycle({
    previousCycle: "混沌",
    dailyState: { key: "retreat_candidate" },
    previousDailyState: { key: "retreat_candidate" },
    profitEffect: { score: 30 },
    lossEffect: { score: 72 },
    historyFresh: true,
  });
  assert.strictEqual(confirmed.cycle, "退潮");
});

run("基础周期：退潮/冰点退出严格执行精确T-1连续修复滞回边界", () => {
  const base = {
    previousCycle: "退潮",
    dailyState: { key: "repair_strengthening" },
    previousDailyState: { key: "repair_strengthening" },
    profitEffect: { score: 55 },
    lossEffect: { score: 48 },
    historyFresh: true,
    indexEnvironment: cycleIndexEnvironment({
      cycle: "退潮",
      mediumKey: "repair",
      shortKey: "weakening",
      breadth: 0.48,
      avgIndexChange: -0.1,
    }),
  };
  const confirmed = resolveStructuralCycle(base);
  assert.strictEqual(confirmed.cycle, "混沌");
  assert.strictEqual(confirmed.transition.key, "repair_strengthening");
  assert.strictEqual(confirmed.transition.from, "退潮");
  assert.strictEqual(confirmed.transition.to, "混沌");
  assert.strictEqual(confirmed.smallCycle.key, "repair_strengthening");
  assert.strictEqual(confirmed.smallCycle.indexStructure.key, "weakening");
  assert.strictEqual(confirmed.smallCycle.indexStructure.conflict, true);

  const firstRepairClose = resolveStructuralCycle({
    ...base,
    previousDailyState: { key: "retreat_candidate" },
  });
  assert.strictEqual(firstRepairClose.cycle, "退潮");
  assert.strictEqual(firstRepairClose.pending, true);

  const breadthBelowBoundary = resolveStructuralCycle({
    ...base,
    indexEnvironment: cycleIndexEnvironment({
      cycle: "退潮",
      mediumKey: "repair",
      breadth: 0.479,
      avgIndexChange: -0.1,
    }),
  });
  assert.strictEqual(breadthBelowBoundary.cycle, "退潮");
});

run("基础周期：混沌到震荡要求MA5至少3/4跨日确认，缺T-1只给transition", () => {
  const currentEnvironment = cycleIndexEnvironment({ aboveMa5Count: 3, cycle: "混沌" });
  const pending = resolveStructuralCycle({
    previousCycle: "混沌",
    dailyState: { key: "repair_strengthening" },
    previousDailyState: { key: "repair_strengthening" },
    profitEffect: { score: 75 },
    lossEffect: { score: 20 },
    historyFresh: true,
    indexEnvironment: currentEnvironment,
  });
  assert.strictEqual(pending.cycle, "混沌");
  assert.strictEqual(pending.transition.key, "repair_strengthening");
  assert.strictEqual(pending.transition.to, "震荡");
  assert.strictEqual(pending.rangeConfirmation.pending, true);

  const confirmed = resolveStructuralCycle({
    previousCycle: "混沌",
    dailyState: { key: "repair" },
    previousDailyState: { key: "repair_strengthening" },
    profitEffect: { score: 65 },
    lossEffect: { score: 30 },
    historyFresh: true,
    indexEnvironment: currentEnvironment,
    previousIndexEnvironment: cycleIndexEnvironment({ aboveMa5Count: 3, cycle: "混沌" }),
  });
  assert.strictEqual(confirmed.cycle, "震荡");
  assert.strictEqual(confirmed.transition.key, "range_confirmed");
});

run("基础周期：旧MA10档案不能冒充MA5同口径跨日确认", () => {
  const currentEnvironment = cycleIndexEnvironment({ aboveMa5Count: 3, cycle: "混沌" });
  const legacyPrevious = {
    mediumTerm: { key: "repair" },
    shortTerm: {
      key: "repair",
      metrics: { aboveMa10KnownCount: 4, aboveMa10Count: 4, aboveMa10Rate: 1 },
    },
    rangeConfirmation: { currentQualified: true },
  };
  const result = resolveStructuralCycle({
    previousCycle: "混沌",
    dailyState: { key: "repair" },
    previousDailyState: { key: "repair" },
    profitEffect: { score: 65 },
    lossEffect: { score: 30 },
    historyFresh: true,
    indexEnvironment: currentEnvironment,
    previousIndexEnvironment: legacyPrevious,
  });

  assert.strictEqual(result.cycle, "混沌");
  assert.strictEqual(result.rangeConfirmation.windowDays, 5);
  assert.strictEqual(result.rangeConfirmation.previousQualified, null);
  assert.strictEqual(result.rangeConfirmation.pending, true);
  assert.notStrictEqual(result.transition.key, "range_confirmed");
});

run("8/24-8/27固定回放：退潮到混沌修复加强，最终仅震荡待确认", () => {
  const day24 = resolveStructuralCycle({
    previousCycle: "混沌",
    dailyState: { key: "retreat_candidate" },
    previousDailyState: { key: "retreat_candidate" },
    profitEffect: { score: 30 },
    lossEffect: { score: 72 },
    historyFresh: true,
    indexEnvironment: cycleIndexEnvironment({ mediumKey: "decline", shortKey: "weakening", breadth: 0.25, avgIndexChange: -1.2 }),
  });
  assert.strictEqual(day24.cycle, "退潮");

  const day25 = resolveStructuralCycle({
    previousCycle: day24.cycle,
    dailyState: { key: "repair_strengthening" },
    previousDailyState: { key: "retreat_candidate" },
    profitEffect: { score: 58 },
    lossEffect: { score: 45 },
    historyFresh: true,
    indexEnvironment: cycleIndexEnvironment({ aboveMa5Count: 2, breadth: 0.51, avgIndexChange: 0.05 }),
  });
  assert.strictEqual(day25.cycle, "退潮");

  const day26Environment = cycleIndexEnvironment({ aboveMa5Count: 2, breadth: 0.56, avgIndexChange: 0.35 });
  const day26 = resolveStructuralCycle({
    previousCycle: day25.cycle,
    dailyState: { key: "repair_strengthening" },
    previousDailyState: { key: "repair_strengthening" },
    profitEffect: { score: 68 },
    lossEffect: { score: 32 },
    historyFresh: true,
    indexEnvironment: day26Environment,
  });
  assert.strictEqual(day26.cycle, "混沌");
  assert.strictEqual(day26.transition.key, "repair_strengthening");
  assert.strictEqual(day26.transition.confirmationTarget.label, "震荡待确认");

  const day27 = resolveStructuralCycle({
    previousCycle: day26.cycle,
    dailyState: { key: "repair_strengthening" },
    previousDailyState: { key: "repair_strengthening" },
    profitEffect: { score: 89.9 },
    lossEffect: { score: 10.1 },
    historyFresh: true,
    indexEnvironment: cycleIndexEnvironment({ aboveMa5Count: 3, breadth: 0.635, avgIndexChange: 1.45 }),
    previousIndexEnvironment: day26Environment,
  });
  assert.strictEqual(day27.cycle, "混沌");
  assert.strictEqual(day27.transition.key, "repair_strengthening");
  assert.strictEqual(day27.transition.to, "震荡");
  assert.strictEqual(day27.rangeConfirmation.pending, true);
});

run("日期无关状态机：任意未来交易日都必须按连续收盘证据逐级迁移", () => {
  const firstRepairEnvironment = cycleIndexEnvironment({
    aboveMa5Count: 3,
    breadth: 0.62,
    avgIndexChange: 1.1,
  });
  const firstRepair = resolveStructuralCycle({
    previousCycle: "退潮",
    dailyState: { key: "repair_strengthening" },
    previousDailyState: { key: "retreat_candidate" },
    profitEffect: { score: 82 },
    lossEffect: { score: 18 },
    historyFresh: true,
    indexEnvironment: firstRepairEnvironment,
    generationContext: {
      tradingDate: "2031-03-10",
      generationId: "fixture-20310310-close",
      asOf: "2031-03-10T15:10:00+08:00",
    },
  });
  assert.strictEqual(firstRepair.cycle, "退潮");
  assert.strictEqual(firstRepair.changed, false);
  assert.strictEqual(firstRepair.generationContext.tradingDate, "2031-03-10");

  const secondRepairEnvironment = cycleIndexEnvironment({
    aboveMa5Count: 3,
    breadth: 0.59,
    avgIndexChange: 0.65,
  });
  const secondRepair = resolveStructuralCycle({
    previousCycle: firstRepair.cycle,
    dailyState: { key: "repair_strengthening" },
    previousDailyState: { key: "repair_strengthening" },
    profitEffect: { score: 73 },
    lossEffect: { score: 26 },
    historyFresh: true,
    indexEnvironment: secondRepairEnvironment,
    previousIndexEnvironment: firstRepair.indexEnvironment,
    generationContext: {
      tradingDate: "2031-03-11",
      generationId: "fixture-20310311-close",
      asOf: "2031-03-11T15:10:00+08:00",
    },
  });
  assert.strictEqual(secondRepair.cycle, "混沌");
  assert.strictEqual(secondRepair.transition.key, "repair_strengthening");
  assert.strictEqual(secondRepair.transition.to, "混沌");

  const rangeConfirmationEnvironment = cycleIndexEnvironment({
    aboveMa5Count: 3,
    mediumKey: "range",
    shortKey: "range",
    breadth: 0.57,
    avgIndexChange: 0.35,
  });
  const rangeConfirmed = resolveStructuralCycle({
    previousCycle: secondRepair.cycle,
    dailyState: { key: "repair" },
    previousDailyState: { key: "repair_strengthening" },
    profitEffect: { score: 64 },
    lossEffect: { score: 32 },
    historyFresh: true,
    indexEnvironment: rangeConfirmationEnvironment,
    previousIndexEnvironment: secondRepair.indexEnvironment,
    generationContext: {
      tradingDate: "2031-03-12",
      generationId: "fixture-20310312-close",
      asOf: "2031-03-12T15:10:00+08:00",
    },
  });
  assert.strictEqual(rangeConfirmed.cycle, "震荡");
  assert.strictEqual(rangeConfirmed.transition.key, "range_confirmed");
  assert.strictEqual(rangeConfirmed.rangeConfirmation.confirmed, true);
  assert.strictEqual(rangeConfirmed.generationContext.tradingDate, "2031-03-12");
});

run("指数环境：仅有旧trendKey的首日反弹只记修复节点，结构验证失败关闭", () => {
  const result = analyzeIndexEnvironment({
    snapshot: snapshot({ avgIndexChange: 1.2, breadth: 0.68 }),
    indexStructures: [
      { code: "000001", name: "上证指数", trendKey: "repair", trendLabel: "仍在20日线下修复" },
      { code: "399001", name: "深证成指", trendKey: "repair", trendLabel: "收复5日线但未收复20日线" },
      { code: "399006", name: "创业板指", trendKey: "bottoming", trendLabel: "低位止跌" },
    ],
  });
  assert.strictEqual(result.cycle, "混沌");
  assert.strictEqual(result.verified, false);
  assert.ok(result.label.includes("修复"));
  assert.strictEqual(result.transition.key, "repair_observed");
  assert.strictEqual(result.smallCycle.key, "repair");
});

run("指数环境：多数指数保持上升结构才允许叫主升", () => {
  const mainRiseIndex = (code, name) => ({
    code,
    name,
    close: 125,
    ma5: 122,
    ma10: 118,
    ma20: 112,
    ma60: 105,
    slope5: 1.8,
    slope10: 1.2,
    slope20: 0.7,
    trendKey: "uptrend",
    trendLabel: "均线多头",
  });
  const result = analyzeIndexEnvironment({
    snapshot: snapshot({ avgIndexChange: 0.4, breadth: 0.58 }),
    indexStructures: [
      mainRiseIndex("000001", "上证指数"),
      mainRiseIndex("399001", "深证成指"),
      mainRiseIndex("399006", "创业板指"),
      mainRiseIndex("000688", "科创50"),
    ],
  });
  assert.strictEqual(result.cycle, "主升");
  assert.strictEqual(result.verified, true);
});

run("短线窗口：指数分歧但全A抗跌、核心封板，识别为先手节点", () => {
  const result = analyzeTradingWindow({
    snapshot: snapshot({
      avgIndexChange: -0.93,
      breadth: 3912 / (3912 + 1299),
      allA: { changePct: -0.12 },
    }),
    limitStats: { ztToday: 75, dtToday: 8 },
    profitEffect: { score: 65 },
    lossEffect: { score: 34 },
    candidates: [{
      code: "000815",
      name: "美利云",
      changePct: 10.01,
      role: "龙头",
      roleKind: "cycleLeader",
      roleScope: "cycle",
      mainConcept: "算力/数据中心",
      leadership: {
        recognized: true,
        persistentRecognition: true,
        coreIdentityQualified: true,
        identity: "情绪/历史核心",
        cycleIdentity: { identityEstablished: true, activePrimary: true, state: "confirmed" },
        initiative: { score: 56 },
      },
    }],
  });
  assert.strictEqual(result.key, "preemptive_core");
  assert.strictEqual(result.allowNew, true);
  assert.strictEqual(result.allowAdd, false);
  assert.strictEqual(result.coreEvidence[0].name, "美利云");
});

run("短线窗口：当日高度不能仅凭裸龙头角色打开新仓权限", () => {
  const result = analyzeTradingWindow({
    snapshot: snapshot({
      avgIndexChange: -0.93,
      breadth: 3912 / (3912 + 1299),
      allA: { changePct: -0.12 },
    }),
    limitStats: { ztToday: 75, dtToday: 8 },
    profitEffect: { score: 65 },
    lossEffect: { score: 34 },
    candidates: [{
      code: "ANON_DAILY_HEIGHT_WINDOW",
      name: "匿名当日高度",
      changePct: 10.01,
      role: "龙头",
      roleKind: "dailyHeight",
      roleScope: "session",
      dailyRole: "当日高度",
      leadership: {
        recognized: false,
        persistentRecognition: false,
        coreIdentityQualified: false,
        coreQualified: false,
        repairCoreQualified: false,
        cycleIdentity: {
          state: "candidate",
          identityEstablished: false,
          activePrimary: false,
        },
        initiative: {
          score: 40,
          proactive: false,
          followerCount: 0,
          breadthLift: 0,
        },
      },
    }],
  });

  assert.strictEqual(result.allowNew, false, "session-only daily height must not authorize a new position");
  assert.strictEqual(
    result.coreEvidence.some((item) => item.code === "ANON_DAILY_HEIGHT_WINDOW"),
    false,
    "session-only daily height must not be published as active core evidence",
  );
});

run("短线窗口：无类型裸龙头或中军不能打开新仓权限", () => {
  ["龙头", "中军"].forEach((role, index) => {
    const code = `ANON_RAW_ROLE_WINDOW_${index}`;
    const result = analyzeTradingWindow({
      snapshot: snapshot({
        avgIndexChange: -0.93,
        breadth: 3912 / (3912 + 1299),
        allA: { changePct: -0.12 },
      }),
      limitStats: { ztToday: 75, dtToday: 8 },
      profitEffect: { score: 65 },
      lossEffect: { score: 34 },
      candidates: [{
        code,
        name: `匿名裸${role}`,
        changePct: 10.01,
        role,
        leadership: {
          recognized: false,
          persistentRecognition: false,
          coreIdentityQualified: false,
          coreQualified: false,
          repairCoreQualified: false,
          initiative: { score: 40, proactive: false, followerCount: 0, breadthLift: 0 },
        },
      }],
    });

    assert.strictEqual(result.allowNew, false, `untyped ${role} text must not authorize a new position`);
    assert.strictEqual(
      result.coreEvidence.some((item) => item.code === code),
      false,
      `untyped ${role} text must not be published as active core evidence`,
    );
  });
});

run("短线窗口：昨日先手核心今日继续加强，才允许确认加仓", () => {
  const previousCandidate = {
    code: "000815",
    name: "美利云",
    changePct: 10.01,
    role: "龙头",
    roleKind: "cycleLeader",
    roleScope: "cycle",
    leadership: {
      recognized: true,
      persistentRecognition: true,
      coreIdentityQualified: true,
      identity: "情绪/历史核心",
      cycleIdentity: { identityEstablished: true, activePrimary: true, state: "confirmed" },
      initiative: { score: 56 },
    },
  };
  const result = analyzeTradingWindow({
    snapshot: snapshot({ avgIndexChange: 1.1, breadth: 0.68, allA: { changePct: 1.35 } }),
    limitStats: { ztToday: 82, dtToday: 4 },
    dailyState: { key: "repair_strengthening" },
    profitEffect: { score: 78 },
    lossEffect: { score: 20 },
    candidates: [{ ...previousCandidate, changePct: 10.02 }],
    previousSnapshot: snapshot({ avgIndexChange: -0.93, breadth: 0.75, allA: { changePct: -0.12 } }),
    previousLimit: { ztToday: 75, dtToday: 8 },
    previousMarketState: { profitEffect: { score: 65 }, lossEffect: { score: 34 } },
    previousCandidates: [previousCandidate],
  });
  assert.strictEqual(result.key, "warming_confirmed");
  assert.strictEqual(result.allowNew, true);
  assert.strictEqual(result.allowAdd, true);
});

run("短线窗口：指数与全A同步走弱、负反馈扩散时禁止新仓", () => {
  const result = analyzeTradingWindow({
    snapshot: snapshot({ avgIndexChange: -1.7, breadth: 0.22, allA: { changePct: -1.5 } }),
    limitStats: { ztToday: 21, dtToday: 30 },
    profitEffect: { score: 20 },
    lossEffect: { score: 82 },
    candidates: [],
  });
  assert.strictEqual(result.key, "negative_feedback");
  assert.strictEqual(result.allowNew, false);
  assert.strictEqual(result.allowAdd, false);
});

run("题材容错：旧主线断开首日只保留题材观察，大周期仍等指数确认", () => {
  const result = resolveStructuralCycle({
    previousCycle: "主升",
    dailyState: { key: "repair" },
    profitEffect: { score: 64 },
    lossEffect: { score: 34 },
    historyFresh: true,
    mainlineContinuityKnown: true,
    mainlineContinuous: false,
    previousMainlineName: "快手概念",
    currentMainlineNames: ["存储芯片", "人形机器人"],
  });

  assert.strictEqual(result.cycle, "主升");
  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.pending, false);
  assert.strictEqual(result.mainlineWatch.breakDays, 1);
  assert.strictEqual(result.mainlineWatch.remainingDays, 2);
  assert.strictEqual(result.mainlineWatch.active, true);
  assert.strictEqual(result.mainlineWatch.scope, "theme-only");
  assert.deepStrictEqual(result.mainlineContinuity.current, ["存储芯片", "人形机器人"]);
});

run("题材容错：旧主线断开第二日继续观察，不用修复节点覆盖主升", () => {
  const result = resolveStructuralCycle({
    previousCycle: "主升",
    dailyState: { key: "repair" },
    profitEffect: { score: 60 },
    lossEffect: { score: 38 },
    historyFresh: true,
    mainlineContinuityKnown: true,
    mainlineContinuous: false,
    previousMainlineName: "快手概念",
    currentMainlineNames: ["存储芯片"],
    mainlineToleranceBaseCycle: "主升",
    previousMainlineBreakDays: 1,
  });

  assert.strictEqual(result.cycle, "主升");
  assert.strictEqual(result.mainlineWatch.breakDays, 2);
  assert.strictEqual(result.mainlineWatch.remainingDays, 1);
  assert.strictEqual(result.mainlineWatch.active, true);
});

run("题材容错：旧主线连续三日未恢复后结束观察", () => {
  const result = resolveStructuralCycle({
    previousCycle: "主升",
    dailyState: { key: "repair" },
    profitEffect: { score: 60 },
    lossEffect: { score: 38 },
    historyFresh: true,
    mainlineContinuityKnown: true,
    mainlineContinuous: false,
    previousMainlineName: "快手概念",
    currentMainlineNames: ["存储芯片"],
    mainlineToleranceBaseCycle: "主升",
    previousMainlineBreakDays: 2,
  });

  assert.strictEqual(result.cycle, "主升");
  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.mainlineWatch.breakDays, 3);
  assert.strictEqual(result.mainlineWatch.active, false);
  assert.strictEqual(result.mainlineWatch.expired, true);
});

run("题材容错：旧主线在三日内重新走强只清零观察，不替指数定周期", () => {
  const result = resolveStructuralCycle({
    previousCycle: "主升",
    dailyState: { key: "repair" },
    profitEffect: { score: 68 },
    lossEffect: { score: 30 },
    historyFresh: true,
    mainlineContinuityKnown: true,
    mainlineContinuous: true,
    previousMainlineName: "快手概念",
    currentMainlineNames: ["快手概念"],
    mainlineToleranceBaseCycle: "主升",
    previousMainlineBreakDays: 2,
    indexEnvironment: {
      verified: true,
      structureCoverage: 4,
      cycle: "震荡",
      label: "指数震荡",
      summary: "指数进入震荡结构",
      mediumTerm: { key: "range" },
      shortTerm: {
        key: "range",
        windowDays: 5,
        metrics: { windowDays: 5, aboveMa5KnownCount: 4, aboveMa5Count: 3, aboveMa5Rate: 0.75 },
      },
      rangeConfirmation: { currentQualified: true },
    },
    previousIndexEnvironment: {
      mediumTerm: { key: "range" },
      shortTerm: {
        key: "range",
        windowDays: 5,
        metrics: { windowDays: 5, aboveMa5KnownCount: 4, aboveMa5Count: 3, aboveMa5Rate: 0.75 },
      },
      rangeConfirmation: { currentQualified: true },
    },
  });

  assert.strictEqual(result.cycle, "震荡");
  assert.strictEqual(result.mainlineWatch.breakDays, 0);
  assert.strictEqual(result.mainlineWatch.recovered, true);
});

run("题材容错：盘中刷新不增加断开天数", () => {
  const result = resolveStructuralCycle({
    previousCycle: "主升",
    dailyState: { key: "repair" },
    historyFresh: true,
    afterClose: false,
    mainlineContinuityKnown: true,
    mainlineContinuous: false,
    previousMainlineName: "快手概念",
    mainlineToleranceBaseCycle: "主升",
    previousMainlineBreakDays: 1,
  });

  assert.strictEqual(result.mainlineWatch.breakDays, 1);
});

run("题材容错：关键数据不足时不增加也不清零观察天数", () => {
  const result = resolveStructuralCycle({
    previousCycle: "主升",
    dailyState: { key: "data_insufficient" },
    historyFresh: true,
    afterClose: true,
    mainlineContinuityKnown: true,
    mainlineContinuous: false,
    previousMainlineName: "快手概念",
    mainlineToleranceBaseCycle: "主升",
    previousMainlineBreakDays: 2,
  });

  assert.strictEqual(result.mainlineWatch.breakDays, 2);
  assert.strictEqual(result.mainlineWatch.active, true);
});

run("基础周期：新方向单日加强不得直接叫主升", () => {
  const result = resolveStructuralCycle({
    previousCycle: "混沌",
    dailyState: { key: "repair_strengthening" },
    profitEffect: { score: 82 },
    lossEffect: { score: 18 },
    historyFresh: true,
    clearMainline: true,
    heatConfirmed: true,
    marketScore: 88,
    mainlineContinuityKnown: true,
    mainlineContinuous: false,
    previousMainlineName: "快手概念",
    currentMainlineNames: ["存储芯片"],
  });

  assert.strictEqual(result.cycle, "混沌");
  assert.strictEqual(result.transition.key, "repair_strengthening");
  assert.ok(result.reason.includes("只确认小周期修复加强"));
});

run("基础周期：即使同一题材连续，也必须由指数上升结构确认主升", () => {
  const result = resolveStructuralCycle({
    previousCycle: "混沌",
    dailyState: { key: "repair_strengthening" },
    profitEffect: { score: 82 },
    lossEffect: { score: 18 },
    historyFresh: true,
    clearMainline: true,
    heatConfirmed: true,
    marketScore: 88,
    mainlineContinuityKnown: true,
    mainlineContinuous: true,
    previousMainlineName: "存储芯片",
    currentMainlineNames: ["存储芯片"],
    indexEnvironment: {
      verified: true,
      structureCoverage: 3,
      cycle: "主升",
      label: "指数上升结构",
      summary: "多数指数站稳20日线并向上",
    },
  });

  assert.strictEqual(result.cycle, "主升");
});

run("题材容错：主线有名无主动核心时进入题材观察，但不影响指数周期", () => {
  const result = resolveStructuralCycle({
    previousCycle: "主升",
    dailyState: { key: "repair" },
    profitEffect: { score: 70 },
    lossEffect: { score: 25 },
    historyFresh: true,
    mainlineContinuityKnown: true,
    mainlineContinuous: true,
    previousMainlineName: "存储芯片",
    currentMainlineNames: ["存储芯片"],
    activeCoreKnown: true,
    activeCoreConfirmed: false,
  });

  assert.strictEqual(result.cycle, "主升");
  assert.strictEqual(result.mainlineWatch.breakDays, 1);
  assert.strictEqual(result.mainlineWatch.active, true);
});

run("指数结构轴：四个指数保持上扬5日结构时，单日普跌只改变细分阶段，不抹掉主升", () => {
  const structures = [
    ["IDX_A", 120, 117, -0.5],
    ["IDX_B", 121, 118, -0.87],
    ["IDX_C", 122, 119, -0.45],
    ["IDX_D", 123, 120, -1.11],
  ].map(([code, close, ma10, changePct]) => ({
    code,
    name: `匿名${code}`,
    close,
    changePct,
    ma5: close + 1,
    ma10,
    ma20: close - 2,
    ma60: close + 8,
    slope5: 1,
    slope10: 1.5,
    slope20: -0.5,
    trendKey: "uptrend",
    trendLabel: "短线均线向上",
  }));
  const result = analyzeIndexEnvironment({
    indexStructures: structures,
    snapshot: {
      avgIndexChange: -0.61,
      breadth: 0.212,
      allA: {
        changePct: -1.03,
        prevClose: 1382,
        open: 1391,
        high: 1395,
        low: 1368,
        close: 1368,
      },
    },
    previousCycle: "主升",
  });

  assert.strictEqual(result.cycle, "主升");
  assert.strictEqual(result.structuralCycle, "主升");
  assert.strictEqual(result.indexSubPhase.key, "main_rise_strong_divergence");
  assert.strictEqual(result.indexSubPhase.structureIntact, true);
});

run("三轴契约：大周期主升与主升内强分歧必须并存，强分歧不得回写成加速", () => {
  const result = resolveStructuralCycle({
    previousCycle: "主升",
    legacyCycle: "主升",
    dailyState: { key: "mixed_divergence", label: "强分歧" },
    previousDailyState: { key: "repair_strengthening", label: "加强" },
    profitEffect: { score: 44 },
    lossEffect: { score: 58 },
    historyFresh: true,
    afterClose: true,
    mainlineContinuityKnown: true,
    mainlineContinuous: true,
    activeCoreKnown: true,
    activeCoreConfirmed: true,
    indexEnvironment: {
      verified: true,
      structureCoverage: 4,
      cycle: "主升",
      label: "指数主升结构",
    summary: "四个匿名主要指数仍保持5日主升结构",
      indexSubPhase: {
        key: "main_rise_strong_divergence",
        label: "主升内强分歧",
        structureIntact: true,
        intensity: "strong",
      },
    },
  });

  assert.strictEqual(result.cycle, "主升");
  assert.strictEqual(result.structuralCycle, "主升");
  assert.deepStrictEqual(result.indexSubPhase, {
    key: "main_rise_strong_divergence",
    label: "主升内强分歧",
    structureIntact: true,
    intensity: "strong",
  });
  assert.doesNotMatch(JSON.stringify(result.indexSubPhase), /加速/);
});

console.log("market-cycle-engine tests passed");
