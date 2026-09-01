"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SELL_PRIORITY,
  canonicalScenarioKey,
  positionLimitPolicy,
  buildExecutionAdvice,
  recalculateSellAfterFill,
  detectSellConflicts,
} = require("./execution-advice");

function forecast(primaryKey = "range_divergence") {
  return {
    version: 1,
    method: "rule_prior",
    calibrated: false,
    probabilities: { strengthen: 25, range_divergence: 55, weaken: 20 },
    primary: { key: primaryKey, label: "震荡分化", probability: 55 },
    confidence: 56,
  };
}

function pick(overrides = {}) {
  return {
    code: "300476",
    name: "胜宏科技",
    role: "中军",
    price: 280.2,
    buy: {
      mode: "低吸试错",
      plan: "回踩承接有效才参与，高开透支不追。",
      auctionLines: [
        "271.79 ~ 284.40 (-3%~+1.5%) → 观察区：看板块回流和核心承接",
        "开盘价 > 284.40 → 先不追，只等回流确认",
      ],
    },
    sell: {
      hardStop: {
        pctRange: [-5.6, -5],
        priceRange: [264.51, 266.19],
        note: "按当前快照基准重算，跌破硬止损线先走；当前以280.20为参考",
      },
      breakEven: { pct: 3, price: 288.61, rule: "浮盈3%后武装保本；以昨收为基准参考，实际买入后按买入价重算" },
      closeLine: { ma5: 231.56, rule: "14:55仍失守MA5则清仓" },
      intradayPullback: "回流失败或反抽不过均价线时先减",
      splNote: "趋势模式：止损-5.6%~-5%，止盈15%~20%",
    },
    tomorrowExecution: {
      tomorrowEntryQualified: true,
      triggers: ["PCB至少两只核心同步走强", "第一次回踩承接有效"],
      cancelConditions: ["放量跌破首次承接低点且无法收回"],
    },
    backtest: { summary: { winRate3d: 99 } },
    ...overrides,
  };
}

function primaryEligibility() {
  return {
    scenarios: [
      {
        key: "rotation",
        status: "ready",
        candidate: { code: "300476", tomorrowEntryQualified: true },
      },
    ],
  };
}

test("旧情景键映射到新预测键", () => {
  assert.equal(canonicalScenarioKey("rotation"), "range_divergence");
  assert.equal(canonicalScenarioKey("weakRepair"), "weaken");
  assert.equal(canonicalScenarioKey("市场加强"), "strengthen");
});

test("主路径合格票输出条件计划，观察区绝不是自动买点", () => {
  const advice = buildExecutionAdvice({
    marketForecast: forecast(),
    marketEmotion: { cycle: "修复", position: "最多1/3试错" },
    pick: pick(),
    scenarioEligibility: primaryEligibility(),
  });

  assert.equal(advice.scenarioRole, "primary");
  assert.equal(advice.verdict.key, "primary_conditional");
  assert.equal(advice.verdict.entryAllowedNow, false);
  assert.equal(advice.buy.observationZone.nature, "observation_only");
  assert.equal(advice.buy.observationZone.automaticEntry, false);
  assert.deepEqual(advice.buy.observationZone.priceRange, [271.79, 284.4]);
  assert.equal(advice.buy.initialPosition, "最多1/3试错");
  assert.equal(advice.hold.status, "not_applicable_before_fill");
  assert.equal(advice.hold.statusLabel, "未成交，不适用");
  assert.equal(advice.sell.basis, "pre_entry_reference");
  assert.equal(advice.sell.recalcAfterFill, true);
  assert.deepEqual(advice.sell.priorityPolicy, SELL_PRIORITY);
  assert.equal(advice.integrity.checks.sellPriorityValid, true);
});

test("买入仓位可从权威的明日复盘仓位上限读取", () => {
  const advice = buildExecutionAdvice({
    marketForecast: forecast(),
    marketEmotion: {
      cycle: "修复",
      review: { tomorrow: { positionLimit: "最多计划仓位1/3试错" } },
    },
    pick: pick(),
    scenarioEligibility: primaryEligibility(),
  });
  assert.equal(advice.buy.initialPosition, "最多计划仓位1/3试错");
});

test("主路径没有合格票时，加强票只能作为备选，不能冒充首选", () => {
  const advice = buildExecutionAdvice({
    marketForecast: forecast(),
    marketEmotion: { bigCycle: "震荡", smallCycle: "修复" },
    pick: pick(),
    scenarioEligibility: {
      scenarios: [
        { key: "rotation", status: "empty", candidate: null },
        {
          key: "strengthen",
          status: "ready",
          candidate: { code: "300476", tomorrowEntryQualified: true },
        },
      ],
    },
  });

  assert.equal(advice.scenario.primaryEligible, false);
  assert.equal(advice.scenarioRole, "contingency");
  assert.equal(advice.verdict.key, "contingency_only");
  assert.equal(advice.buy.scenarioActivationRequired, true);
  assert.match(advice.verdict.action, /主路径不买这只/);
  assert.equal(advice.integrity.checks.noPrimaryCandidateForced, true);
});

test("主路径和备选都无票时明确空仓，不生成任何买卖价", () => {
  const advice = buildExecutionAdvice({
    marketForecast: forecast(),
    marketEmotion: { bigCycle: "震荡", smallCycle: "修复" },
    pick: null,
    scenarioEligibility: {
      scenarios: [
        { key: "rotation", status: "empty", candidate: null },
        { key: "strengthen", status: "empty", candidate: null },
      ],
    },
  });

  assert.equal(advice.scenarioRole, "none");
  assert.equal(advice.verdict.key, "wait_no_primary_candidate");
  assert.equal(advice.buy.status, "blocked");
  assert.equal(advice.buy.observationZone.priceRange, null);
  assert.equal(advice.sell.status, "unavailable");
  assert.equal(advice.sell.basisPrice, null);
  assert.equal(advice.holdingPeriod.method, "unavailable");
});

test("价格缺失时等待可信价格，禁止沿用旧卖价或虚构价格", () => {
  const noPricePick = pick({ price: null });
  const advice = buildExecutionAdvice({
    marketForecast: forecast(),
    marketEmotion: { bigCycle: "震荡", smallCycle: "修复" },
    pick: noPricePick,
    scenarioEligibility: primaryEligibility(),
  });

  assert.equal(advice.verdict.key, "price_unavailable");
  assert.equal(advice.buy.status, "blocked");
  assert.equal(advice.sell.basis, "unavailable");
  assert.equal(advice.sell.hardStop.priceRange, null);
  assert.equal(advice.sell.breakEven.price, null);
  assert.equal(advice.sell.takeProfit.priceRange, null);
  assert.ok(advice.integrity.errors.includes("decision_price_missing"));
  assert.equal(advice.holdingPeriod.method, "unavailable");
});

test("持有期限由周期和交易模式生成，T+1强制复核且不使用winRate3d", () => {
  const lowBuyPick = pick({
    role: "中军",
    sell: {
      ...pick().sell,
      splNote: "低吸模式：修复期小仓试错",
    },
    backtest: { summary: { winRate3d: 99 } },
  });
  const advice = buildExecutionAdvice({
    marketForecast: forecast(),
    marketEmotion: { bigCycle: "震荡", smallCycle: "修复" },
    pick: lowBuyPick,
    scenarioEligibility: primaryEligibility(),
  });

  assert.equal(advice.holdingPeriod.method, "heuristic");
  assert.deepEqual(advice.holdingPeriod.windowTradingDays, { min: 1, max: 2 });
  assert.deepEqual(advice.holdingPeriod.statisticsUsed, []);
  assert.ok(advice.holdingPeriod.excludedStatistics.includes("backtest.winRate3d"));
  assert.equal(advice.holdingPeriod.mandatoryReview.checkpoint, "T+1");
  assert.equal(advice.holdingPeriod.mandatoryReview.required, true);
  assert.match(advice.holdingPeriod.note, /不等于建议持有3天/);
});

test("真实成交后按实际成本重算止损、保本和止盈价", () => {
  const beforeFill = buildExecutionAdvice({
    marketForecast: forecast(),
    marketEmotion: { bigCycle: "震荡", smallCycle: "修复" },
    pick: pick(),
    scenarioEligibility: primaryEligibility(),
  });
  const afterFill = recalculateSellAfterFill({ sell: beforeFill.sell, fillPrice: 100 });

  assert.equal(beforeFill.sell.basis, "pre_entry_reference");
  assert.equal(beforeFill.sell.recalcAfterFill, true);
  assert.equal(afterFill.basis, "actual_fill");
  assert.equal(afterFill.basisPrice, 100);
  assert.equal(afterFill.recalcAfterFill, false);
  assert.deepEqual(afterFill.hardStop.priceRange, [94.4, 95]);
  assert.equal(afterFill.breakEven.price, 103);
  assert.deepEqual(afterFill.takeProfit.priceRange, [115, 120]);
  assert.deepEqual(afterFill.conflicts, []);
  assert.doesNotMatch(afterFill.hardStop.rule, /280\.20|当前快照/);
  assert.doesNotMatch(afterFill.breakEven.rule, /昨收|实际买入后/);
  assert.match(afterFill.hardStop.rule, /实际成交成本/);
  assert.doesNotMatch(afterFill.actions.find((item) => item.key === "hard_stop").trigger, /280\.20|当前快照/);

  const builtWithFill = buildExecutionAdvice({
    marketForecast: forecast(),
    marketEmotion: { bigCycle: "震荡", smallCycle: "修复" },
    pick: pick(),
    scenarioEligibility: primaryEligibility(),
    fill: { status: "filled", price: 100 },
  });
  assert.equal(builtWithFill.hold.status, "active");
  assert.equal(builtWithFill.sell.basis, "actual_fill");
  assert.deepEqual(builtWithFill.sell.hardStop.priceRange, [94.4, 95]);
  assert.doesNotMatch(builtWithFill.sell.hardStop.rule, /280\.20|当前快照/);
});

test("卖出规则冲突检测覆盖顺序和动作层级错误", () => {
  const conflicts = detectSellConflicts([
    { key: "reduce", tier: "reduce", priority: 3, actionType: "clear" },
    { key: "hard_stop", tier: "hard_stop", priority: 1, actionType: "clear", priceRange: [94, 95] },
  ], 100);

  assert.ok(conflicts.some((item) => item.code === "action_tier_mismatch"));
  assert.ok(conflicts.some((item) => item.code === "priority_order"));
});

test("情景候选代码与推荐票不一致时拒绝执行", () => {
  const advice = buildExecutionAdvice({
    marketForecast: forecast(),
    marketEmotion: { cycle: "修复" },
    pick: pick(),
    scenarioEligibility: {
      scenarioKey: "rotation",
      eligible: true,
      candidateCode: "000001",
    },
  });

  assert.equal(advice.verdict.key, "candidate_mismatch");
  assert.equal(advice.buy.status, "blocked");
  assert.ok(advice.integrity.errors.includes("scenario_candidate_code_mismatch"));
});

test("warming_watch只是早盘待验证，不是永久禁止明日计划", () => {
  const advice = buildExecutionAdvice({
    marketForecast: forecast(),
    marketEmotion: {
      cycle: { key: "repair", label: "修复" },
      tradeWindow: { key: "warming_watch", allowNew: false },
    },
    pick: pick(),
    scenarioEligibility: primaryEligibility(),
  });

  assert.equal(advice.verdict.key, "primary_conditional");
  assert.equal(advice.holdingPeriod.method, "heuristic");
  assert.deepEqual(advice.holdingPeriod.windowTradingDays, { min: 1, max: 3 });
});

test("真正阻断后买入标签与说明同步为阻断结论", () => {
  const advice = buildExecutionAdvice({
    marketForecast: forecast(),
    marketEmotion: {
      cycle: "修复",
      tradeWindow: { key: "negative_feedback", allowNew: false },
    },
    pick: pick(),
    scenarioEligibility: primaryEligibility(),
  });

  assert.equal(advice.verdict.key, "new_entry_blocked");
  assert.equal(advice.buy.status, "blocked");
  assert.equal(advice.buy.statusLabel, advice.verdict.label);
  assert.equal(advice.buy.note, advice.verdict.action);
});

test("市场仓位上限为0或明确禁止新开仓时执行建议必须硬阻断", async (t) => {
  const limits = [0, "0", "00", "0.0", "0%", "0%，禁止新开仓", "空仓等待", "暂停新开仓"];
  for (const limit of limits) {
    await t.test(String(limit), () => {
      const advice = buildExecutionAdvice({
        marketForecast: forecast(),
        marketEmotion: {
          cycle: "修复",
          light: "yellow",
          review: { tomorrow: { positionLimit: limit } },
          tradeWindow: { key: "warming_watch", allowNew: false },
        },
        pick: pick({ buy: { ...pick().buy, initialPosition: "1/2仓" } }),
        scenarioEligibility: primaryEligibility(),
      });
      assert.equal(positionLimitPolicy(limit).blocked, true);
      assert.equal(advice.verdict.key, "new_entry_blocked");
      assert.equal(advice.verdict.planAvailable, false);
      assert.equal(advice.buy.status, "blocked");
      assert.equal(advice.buy.positionPolicy.marketBlocked, true);
      assert.equal(advice.holdingPeriod.method, "unavailable");
    });
  }
});

test("个股旧计划仓位高于市场上限时取更保守的市场仓位", () => {
  const advice = buildExecutionAdvice({
    marketForecast: forecast(),
    marketEmotion: {
      cycle: "修复",
      review: { tomorrow: { positionLimit: "最多计划仓位1/3试错" } },
    },
    pick: pick({ buy: { ...pick().buy, initialPosition: "计划仓位1/2" } }),
    scenarioEligibility: primaryEligibility(),
  });

  assert.equal(advice.verdict.key, "primary_conditional");
  assert.equal(advice.buy.stockInitialPosition, "计划仓位1/2");
  assert.equal(advice.buy.marketPositionLimit, "最多计划仓位1/3试错");
  assert.equal(advice.buy.initialPosition, "最多计划仓位1/3试错");
  assert.ok(Math.abs(advice.buy.positionPolicy.appliedFraction - 1 / 3) < 1e-12);
});
