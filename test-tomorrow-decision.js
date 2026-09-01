"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PATH_KEYS, buildTomorrowDecision } = require("./tomorrow-decision");

function forecast(primaryKey = "range_divergence", overrides = {}) {
  const probabilities = primaryKey === "strengthen"
    ? { strengthen: 52, range_divergence: 32, weaken: 16 }
    : primaryKey === "weaken"
      ? { strengthen: 15, range_divergence: 31, weaken: 54 }
      : { strengthen: 25, range_divergence: 55, weaken: 20 };
  return {
    version: 1,
    tradingDate: "2026-08-07",
    method: "rule_prior",
    methodLabel: "规则先验（未历史校准）",
    calibrated: false,
    probabilities,
    primary: { key: primaryKey, label: "震荡分化", probability: probabilities[primaryKey] },
    scenarios: PATH_KEYS.map((key) => ({ key, probability: probabilities[key] })),
    confidence: 55,
    confidenceLabel: "中等",
    dataQuality: {
      grade: "limited",
      notes: ["当前为确定性规则先验，不是历史回测胜率。"],
    },
    sentimentCycle: {
      marketRegime: { key: "repair", label: "修复", source: "structural_index_cycle" },
      aggregateStage: "acceleration",
      aggregateStageLabel: "加速",
      expectedTransition: { key: "range_divergence", label: "分歧兑现并转入震荡" },
      divergenceSize: "medium",
      divergenceQuality: "mixed",
      accelerationPath: {
        method: "rule_prior",
        calibrated: false,
        primary: { key: "range_divergence", label: "分歧兑现并转入震荡", probability: 51 },
      },
    },
    updateRules: [
      { time: "09:25", upgradeConditions: ["至少两只独立核心同步超预期"], downgradeConditions: ["负反馈核心批量低开"] },
      { time: "09:35", upgradeConditions: ["指数、宽度和核心同步改善"], downgradeConditions: ["指数与核心同步高开低走"] },
    ],
    ...overrides,
  };
}

function winPick(overrides = {}) {
  return {
    code: "300476",
    name: "胜宏科技",
    role: "中军",
    mainConcept: "PCB概念",
    price: 280.2,
    priceIntegrity: { price: 280.2, consistent: true, valid: true, warnings: [] },
    buy: {
      mode: "低吸试错",
      auctionLines: [
        "271.79 ~ 284.40 → 观察区",
        "开盘价 > 284.40 → 不追",
      ],
    },
    sell: {
      hardStop: { pctRange: [-5.6, -5], priceRange: [264.51, 266.19] },
      breakEven: { pct: 3, price: 288.61 },
      closeLine: { ma5: 231.56, rule: "14:55仍失守MA5则清仓" },
      intradayPullback: "回流失败或反抽不过均价线时先减",
      splNote: "趋势模式：止损-5.6%~-5%，止盈15%~20%",
    },
    leadership: { identity: "主动型容量龙头" },
    tomorrowExecution: {
      stateLabel: "启动",
      tomorrowEntryQualified: true,
      triggers: ["PCB概念至少两只核心/容量票同步走强", "第一次回踩承接有效"],
      cancelConditions: ["只有胜宏科技单点上涨", "放量跌破首次承接低点且无法收回"],
    },
    ...overrides,
  };
}

function scenarioPlan(key, candidate, status = candidate ? "ready" : "empty") {
  return {
    key,
    status,
    candidate: candidate ? {
      code: candidate.code,
      name: candidate.name,
      mainConcept: candidate.mainConcept,
      price: candidate.price,
      tomorrowEntryQualified: candidate.tomorrowExecution && candidate.tomorrowExecution.tomorrowEntryQualified,
      stateLabel: candidate.tomorrowExecution && candidate.tomorrowExecution.stateLabel,
      triggers: candidate.tomorrowExecution && candidate.tomorrowExecution.triggers,
      cancelConditions: candidate.tomorrowExecution && candidate.tomorrowExecution.cancelConditions,
      marketCapCarrier: candidate.marketCapCarrier || null,
      participationValue: candidate.participationValue || null,
      riskAdjustment: candidate.riskAdjustment || null,
      riskAdjustedParticipationScore: candidate.riskAdjustedParticipationScore ?? null,
      positionAllocation: candidate.positionAllocation || null,
      selectionAuthority: candidate.selectionAuthority || null,
    } : null,
    action: candidate ? "路径命中后等待个股承接" : "本路径暂无合格核心",
  };
}

function currentLike(overrides = {}) {
  const pick = winPick();
  return {
    forecast: forecast("range_divergence"),
    marketEmotion: {
      cycle: "修复",
      light: "yellow",
      lightLabel: "黄灯",
      review: { tomorrow: { positionLimit: "最多计划仓位1/3试错" } },
      validation: {
        upgrade: ["主动龙头、容量承接和板块扩散同步出现"],
        hold: ["老核心反弹但近期核心仍分化"],
        downgrade: ["主动龙头失去带动性"],
      },
    },
    marketState: {
      cycle: "修复",
      tradeWindow: {
        key: "warming_watch",
        allowNew: true,
        allowAdd: false,
        positionGuide: "只观察，核心确认后再执行",
      },
    },
    riskBoard: {
      blockedConcepts: ["PET铜箔", "流感", "肝炎概念"],
      blockedTicketTypes: [],
      blockedSetups: [],
      items: [],
    },
    picks: [pick],
    scenarioPlans: [
      scenarioPlan("strengthen", pick),
      scenarioPlan("rotation", null),
      scenarioPlan("weakRepair", null),
    ],
    ...overrides,
  };
}

test("current-like：震荡分化为主路径但无票时空仓，胜宏只进加强备选", () => {
  const input = currentLike();
  const decision = buildTomorrowDecision(input);

  assert.equal(decision.verdict, "wait");
  assert.equal(decision.primaryScenarioKey, "range_divergence");
  assert.equal(decision.direction.status, "cash");
  assert.deepEqual(decision.candidates, []);
  assert.equal(decision.contingencies.length, 1);
  assert.equal(decision.contingencies[0].code, "300476");
  assert.equal(decision.contingencies[0].scenarioKey, "strengthen");
  assert.equal(decision.contingencies[0].status, "conditional");
  assert.equal(decision.permission.status, "wait", "明确允许新开仓的 warming_watch 不是硬阻断");
  assert.match(decision.action.summary, /空仓等待/);
  assert.match(decision.action.summary, /加强备选胜宏科技/);
  assert.equal(decision.integrity.checks.cashWhenPrimaryCandidateMissing, true);
  assert.equal(decision.integrity.checks.nonPrimaryCandidatesSeparated, true);
});

test("市值载体观察随候选进入决策票，但不改变原有执行结论", () => {
  const marketCapCarrier = {
    regimeKey: "low_liquidity",
    totalCapYi: 420,
    alignment: "upper_band",
    observationOnly: true,
    scoreAdjustment: 0,
    hardGateImpact: false,
    tradePermissionImpact: false,
  };
  const pick = winPick({ marketCapCarrier });
  const input = currentLike({
    picks: [pick],
    scenarioPlans: [
      scenarioPlan("strengthen", pick),
      scenarioPlan("rotation", null),
      scenarioPlan("weakRepair", null),
    ],
  });
  const decision = buildTomorrowDecision(input);
  assert.equal(decision.verdict, "wait");
  assert.equal(decision.contingencies[0].marketCapCarrier, marketCapCarrier);
  assert.equal(decision.contingencies[0].marketCapCarrier.tradePermissionImpact, false);
});

test("统一链参与价值与仓位配比随最终决策票输出，不回退到旧仓位文本", () => {
  const pick = winPick({
    participationValue: { score: 86, components: { themePosition: 25, stockRole: 20 } },
    riskAdjustment: { score: -6, components: { priceExhaustion: -6 } },
    riskAdjustedParticipationScore: 80,
    positionAllocation: {
      relativeWeightPct: 100,
      initialPortfolioPct: 10,
      maximumPortfolioPct: 30,
    },
    selectionAuthority: "unified_decision_chain_v1",
  });
  const input = currentLike({
    picks: [pick],
    scenarioPlans: [
      scenarioPlan("strengthen", pick),
      scenarioPlan("rotation", null),
      scenarioPlan("weakRepair", null),
    ],
  });
  const decision = buildTomorrowDecision(input);
  assert.equal(decision.contingencies.length, 1);
  assert.equal(decision.contingencies[0].participationValue.score, 86);
  assert.equal(decision.contingencies[0].riskAdjustedParticipationScore, 80);
  assert.equal(decision.contingencies[0].positionAllocation.initialPortfolioPct, 10);
  assert.equal(decision.contingencies[0].positionAllocation.maximumPortfolioPct, 30);
  assert.equal(decision.contingencies[0].selectionAuthority, "unified_decision_chain_v1");
});

test("整体价格或执行闸门阻断时不保留误导性备选，仍保留观察方向", () => {
  const input = currentLike();
  input.bestPicks = {
    available: true,
    focusDirection: "PCB概念（含CPO/存储芯片）",
    picks: input.picks,
    scenarioPlans: input.scenarioPlans,
    priceIntegrity: { status: "warn" },
    executionGate: { active: false },
  };
  const decision = buildTomorrowDecision(input);
  assert.equal(decision.direction.status, "cash");
  assert.equal(decision.direction.name, "PCB概念（含CPO/存储芯片）");
  assert.deepEqual(decision.candidates, []);
  assert.deepEqual(decision.contingencies, []);
  assert.match(decision.permission.summary, /价格总校验未通过/);
  assert.equal(decision.permission.executionMode, "blocked");
  assert.equal(decision.permission.canActivate, false);
  assert.ok(decision.permission.reasons.some((reason) => /价格总校验未通过/.test(reason)));
  assert.match(decision.action.summary, /禁止新开仓/);
});

test("bestPicks 不可用时必须覆盖 normal 为 blocked 且不可激活", () => {
  const input = currentLike({
    bestPicks: {
      available: false,
      note: "候选契约不可用",
    },
    premarketGate: {
      blocked: false,
      executionMode: "normal",
    },
  });
  const decision = buildTomorrowDecision(input);

  assert.equal(decision.permission.status, "blocked");
  assert.equal(decision.permission.executionMode, "blocked");
  assert.equal(decision.permission.canActivate, false);
  assert.equal(decision.permission.allowImmediateEntry, false);
  assert.equal(decision.permission.allowAdd, false);
  assert.ok(decision.permission.reasons.includes("候选契约不可用"));
  assert.deepEqual(decision.candidates, []);
  assert.deepEqual(decision.contingencies, []);
});

test("canonical盘前授权链可全局阻断主选和备选", () => {
  const input = currentLike({
    premarketGate: {
      blocked: true,
      executionMode: "blocked",
      reasons: ["炒作偏好主路径没有合格载体"],
      allowedCandidateCodes: [],
    },
  });
  const decision = buildTomorrowDecision(input);
  assert.deepEqual(decision.candidates, []);
  assert.deepEqual(decision.contingencies, []);
  assert.equal(decision.permission.status, "blocked");
  assert.match(decision.permission.summary, /主路径没有合格载体/);
});

test("canonical方向不可用时不得泄漏旧bestPicks方向", () => {
  const input = currentLike({
    premarketGate: {
      blocked: true,
      blockedSteps: ["direction"],
      executionMode: "blocked",
      reasons: ["题材库不可用，方向判断已暂停"],
      allowedCandidateCodes: [],
    },
  });
  input.bestPicks = {
    available: true,
    focusDirection: "旧AI算力强方向",
    picks: input.picks,
    scenarioPlans: input.scenarioPlans,
    priceIntegrity: { status: "pass" },
  };
  const decision = buildTomorrowDecision(input);
  assert.equal(decision.direction.name, null);
  assert.equal(decision.direction.reason, "题材库不可用，方向判断已暂停");
  assert.equal(JSON.stringify(decision.direction).includes("旧AI算力强方向"), false);
});

test("候选必须同时通过核心地位和主风格主方向交集", () => {
  const pick = winPick({ leadership: { identity: "被动容量中军", tradeQualified: false } });
  const input = currentLike({
    forecast: forecast("strengthen"),
    picks: [pick],
    scenarioPlans: [
      scenarioPlan("strengthen", pick),
      scenarioPlan("rotation", null),
      scenarioPlan("weakRepair", null),
    ],
    premarketGate: {
      blocked: false,
      allowedCandidateCodes: ["300476"],
    },
  });
  let decision = buildTomorrowDecision(input);
  assert.deepEqual(decision.candidates, []);
  assert.match(decision.integrity.blockedCandidates[0].reasons.join("；"), /核心地位交易资格未通过/);

  pick.leadership.tradeQualified = true;
  input.premarketGate.allowedCandidateCodes = ["000001"];
  decision = buildTomorrowDecision(input);
  assert.deepEqual(decision.candidates, []);
  assert.match(decision.integrity.blockedCandidates[0].reasons.join("；"), /主风格与主方向交集/);
});

function strictPick(overrides = {}) {
  const base = winPick();
  return {
    ...base,
    executionVersion: 3,
    tradeQualified: true,
    leadership: { ...base.leadership, tradeQualified: true },
    hardGate: { pass: true },
    ...overrides,
  };
}

test("executionVersion v3 四道必需门全部为 true 才能进入主候选或备选", () => {
  const primaryPick = strictPick();
  let decision = buildTomorrowDecision(currentLike({
    executionVersion: 3,
    picks: [primaryPick],
    scenarioPlans: [scenarioPlan("rotation", primaryPick)],
  }));
  assert.equal(decision.executionVersion, 3);
  assert.equal(decision.candidates.length, 1);
  assert.equal(decision.contingencies.length, 0);
  assert.equal(decision.integrity.checks.strictExecutionContractApplied, true);

  const contingencyPick = strictPick({ code: "300477", name: "严格备选" });
  decision = buildTomorrowDecision(currentLike({
    executionVersion: 3,
    picks: [contingencyPick],
    scenarioPlans: [scenarioPlan("strengthen", contingencyPick)],
  }));
  assert.deepEqual(decision.candidates, []);
  assert.equal(decision.contingencies.length, 1);
  assert.equal(decision.contingencies[0].code, "300477");
  assert.equal(decision.integrity.checks.strictExecutionContractApplied, true);
});

test("executionVersion v3 任一必需门缺失或 false 都必须拒绝主候选", async (t) => {
  const cases = [
    {
      name: "tomorrowEntryQualified 缺失",
      mutate(pick) { delete pick.tomorrowExecution.tomorrowEntryQualified; },
      reason: /明日入场资格缺失/,
    },
    {
      name: "tomorrowEntryQualified false",
      mutate(pick) { pick.tomorrowExecution.tomorrowEntryQualified = false; },
      reason: /明日入场资格未通过/,
    },
    {
      name: "tradeQualified 缺失",
      mutate(pick) { delete pick.tradeQualified; },
      reason: /候选个股交易资格缺失/,
    },
    {
      name: "tradeQualified false",
      mutate(pick) { pick.tradeQualified = false; },
      reason: /候选个股交易资格未通过/,
    },
    {
      name: "leadership.tradeQualified 缺失",
      mutate(pick) { delete pick.leadership.tradeQualified; },
      reason: /核心地位交易资格缺失/,
    },
    {
      name: "leadership.tradeQualified false",
      mutate(pick) { pick.leadership.tradeQualified = false; },
      reason: /核心地位交易资格未通过/,
    },
    {
      name: "hardGate.pass 缺失",
      mutate(pick) { delete pick.hardGate.pass; },
      reason: /硬门槛缺失/,
    },
    {
      name: "hardGate.pass false",
      mutate(pick) { pick.hardGate.pass = false; },
      reason: /硬门槛未通过/,
    },
  ];

  for (const item of cases) {
    await t.test(item.name, () => {
      const pick = strictPick();
      item.mutate(pick);
      const decision = buildTomorrowDecision(currentLike({
        picks: [pick],
        scenarioPlans: [scenarioPlan("rotation", pick)],
      }));
      assert.equal(decision.executionVersion, 3, "候选自身版本必须启用 v3 契约");
      assert.deepEqual(decision.candidates, []);
      assert.equal(decision.verdict, "wait");
      assert.match(decision.integrity.blockedCandidates[0].reasons.join("；"), item.reason);
      assert.equal(decision.integrity.checks.strictExecutionContractApplied, true);
    });
  }
});

test("bestPicks.executionVersion v3 会继承到未标版本候选，并同样拦截不完整备选", () => {
  const pick = strictPick({ code: "300478", name: "继承契约备选" });
  delete pick.executionVersion;
  delete pick.hardGate.pass;
  const plans = [scenarioPlan("strengthen", pick)];
  const decision = buildTomorrowDecision(currentLike({
    picks: [pick],
    scenarioPlans: plans,
    bestPicks: {
      executionVersion: 3,
      available: true,
      picks: [pick],
      scenarioPlans: plans,
    },
  }));

  assert.equal(decision.executionVersion, 3);
  assert.deepEqual(decision.candidates, []);
  assert.deepEqual(decision.contingencies, []);
  assert.match(decision.integrity.blockedCandidates[0].reasons.join("；"), /硬门槛缺失/);
  assert.equal(decision.integrity.checks.strictExecutionContractApplied, true);
});

test("重复主情景键使契约失效，不得在记录错误的同时仍输出主候选", () => {
  const pick = winPick();
  const decision = buildTomorrowDecision(currentLike({
    forecast: forecast("range_divergence"),
    picks: [pick],
    scenarioPlans: [scenarioPlan("rotation", pick), scenarioPlan("range_divergence", pick)],
  }));
  assert.equal(decision.integrity.ok, false);
  assert.ok(decision.integrity.errors.includes("duplicate_scenario_plan"));
  assert.deepEqual(decision.candidates, []);
  assert.equal(decision.direction.status, "cash");
});

test("旧三路径映射为固定顺序，概率明确标为未校准规则先验", () => {
  const decision = buildTomorrowDecision(currentLike());

  assert.deepEqual(decision.scenarios.map((item) => item.key), PATH_KEYS);
  assert.deepEqual(decision.scenarios.map((item) => item.candidateStatus), ["ready", "empty", "empty"]);
  assert.equal(decision.scenarios.reduce((sum, item) => sum + item.probability, 0), 100);
  assert.ok(decision.scenarios.every((item) => /规则先验/.test(item.probabilityLabel)));
  assert.equal(decision.method, "rule_prior");
  assert.equal(decision.calibrated, false);
  assert.equal(decision.confidence.calibrated, false);
  assert.match(decision.confidence.summary, /未历史校准/);
});

test("主路径有安全合格票时只输出主路径条件候选和完整生命周期摘要", () => {
  const pick = winPick();
  const input = currentLike({
    picks: [pick],
    scenarioPlans: [
      scenarioPlan("strengthen", null),
      scenarioPlan("rotation", pick),
      scenarioPlan("weakRepair", null),
    ],
  });
  const decision = buildTomorrowDecision(input);

  assert.equal(decision.verdict, "conditional");
  assert.equal(decision.direction.status, "candidate");
  assert.equal(decision.candidates.length, 1);
  assert.equal(decision.candidates[0].scenarioKey, "range_divergence");
  assert.equal(decision.contingencies.length, 0);
  assert.match(decision.candidates[0].buy.summary, /观察区/);
  assert.match(decision.candidates[0].buy.summary, /初始仓位：最多计划仓位1\/3试错/);
  assert.match(decision.candidates[0].buy.summary, /不自动买/);
  assert.match(decision.candidates[0].hold.summary, /未成交，不适用/);
  assert.match(decision.candidates[0].sell.summary, /成交前参考/);
  assert.match(decision.candidates[0].holdingPeriod.summary, /T\+1强制复核/);
  assert.equal(decision.candidates[0].holdingPeriod.method, "heuristic");
  assert.ok(decision.candidates[0].advice);
  assert.equal(decision.permission.status, "conditional");
  assert.equal(decision.permission.positionLimit, "最多计划仓位1/3试错");
  assert.match(decision.permission.summary, /仓位上限：最多计划仓位1\/3试错/);
  assert.equal(decision.permission.allowImmediateEntry, false);
});

test("风险板屏蔽主路径候选时强制空仓", () => {
  const pick = winPick();
  const decision = buildTomorrowDecision(currentLike({
    picks: [pick],
    scenarioPlans: [scenarioPlan("rotation", pick)],
    riskBoard: {
      blockedConcepts: ["PCB概念"],
      blockedTicketTypes: [],
      blockedSetups: [],
      items: [],
    },
  }));

  assert.equal(decision.verdict, "wait");
  assert.equal(decision.direction.status, "cash");
  assert.deepEqual(decision.candidates, []);
  assert.ok(decision.integrity.blockedCandidates.some((item) => item.reasons.some((reason) => /风险板/.test(reason))));
  assert.equal(decision.integrity.checks.riskBlocksApplied, true);
});

test("价格完整性失败时不允许主推荐，也不输出伪造可执行票", () => {
  const pick = winPick({
    priceIntegrity: { price: 280.2, consistent: false, valid: false, errors: ["昨收不一致"] },
  });
  const decision = buildTomorrowDecision(currentLike({
    picks: [pick],
    scenarioPlans: [scenarioPlan("rotation", pick)],
  }));

  assert.equal(decision.direction.status, "cash");
  assert.deepEqual(decision.candidates, []);
  assert.ok(decision.integrity.blockedCandidates[0].reasons.includes("价格完整性校验失败"));
});

test("红灯、冲击、任意禁止新开仓窗口和盘前 blocked 模式都会阻止主推荐", async (t) => {
  const pick = winPick();
  const mainPlans = [scenarioPlan("rotation", pick)];
  const cases = [
    {
      name: "红灯",
      patch: { marketEmotion: { cycle: "修复", light: "red", lightLabel: "红灯" } },
      reason: /红灯/,
    },
    {
      name: "冲击",
      patch: { shockTransition: { active: true, label: "退潮级冲击" } },
      reason: /冲击验证期/,
    },
    {
      name: "负反馈硬闸门",
      patch: { marketState: { cycle: "修复", tradeWindow: { key: "negative_feedback", allowNew: false, summary: "负反馈扩散" } } },
      reason: /负反馈扩散/,
    },
    {
      name: "任意节奏明确禁止新开仓",
      patch: { marketState: { cycle: "修复", tradeWindow: { key: "warming_watch", allowNew: false, summary: "等待确认，禁止新开仓" } } },
      reason: /等待确认，禁止新开仓/,
    },
    {
      name: "盘前 executionMode blocked 即使 blocked 标志为 false",
      patch: {
        premarketGate: {
          blocked: false,
          executionMode: "blocked",
          reasons: ["盘前执行模式已阻断"],
        },
      },
      reason: /盘前执行模式已阻断/,
    },
  ];

  for (const item of cases) {
    await t.test(item.name, () => {
      const decision = buildTomorrowDecision(currentLike({
        picks: [pick],
        scenarioPlans: mainPlans,
        ...item.patch,
      }));
      assert.equal(decision.verdict, "wait");
      assert.equal(decision.direction.status, "cash");
      assert.deepEqual(decision.candidates, []);
      assert.equal(decision.permission.status, "blocked");
      assert.equal(decision.permission.executionMode, "blocked");
      assert.equal(decision.permission.canActivate, false);
      assert.ok(decision.permission.reasons.length > 0);
      assert.match(decision.permission.summary, item.reason);
    });
  }
});

test("非法预测概率不被静默修正，直接标记契约无效并空仓", () => {
  const pick = winPick();
  const badForecast = forecast("range_divergence", {
    probabilities: { strengthen: 40, range_divergence: 40, weaken: 40 },
  });
  const decision = buildTomorrowDecision(currentLike({
    forecast: badForecast,
    picks: [pick],
    scenarioPlans: [scenarioPlan("rotation", pick)],
  }));

  assert.equal(decision.verdict, "wait");
  assert.deepEqual(decision.candidates, []);
  assert.equal(decision.integrity.ok, false);
  assert.ok(decision.integrity.errors.includes("forecast_probabilities_invalid"));
});

test("完整forecast原样保留，validation优先使用权威市场情绪字段", () => {
  const input = currentLike();
  const decision = buildTomorrowDecision(input);

  assert.strictEqual(decision.forecast, input.forecast);
  assert.deepEqual(decision.validation.upgrade, input.marketEmotion.validation.upgrade);
  assert.deepEqual(decision.validation.hold, input.marketEmotion.validation.hold);
  assert.deepEqual(decision.validation.downgrade, input.marketEmotion.validation.downgrade);
  assert.deepEqual(decision.validation.checkpoints, ["09:25", "09:35"]);
  assert.equal(decision.integrity.checks.rawForecastPreserved, true);
  assert.equal(decision.market.cycle, "修复");
  assert.equal(decision.market.corePhase, "加速");
});

test("权威市场仓位为0%时主候选和备选都必须清空且不可激活", async (t) => {
  const pick = winPick({ buy: { ...winPick().buy, initialPosition: "计划仓位1/2" } });
  const cases = [
    {
      name: "主路径候选",
      scenarioPlans: [scenarioPlan("rotation", pick)],
    },
    {
      name: "非主路径备选",
      scenarioPlans: [scenarioPlan("strengthen", pick)],
    },
  ];

  for (const item of cases) {
    await t.test(item.name, () => {
      const input = currentLike({ picks: [pick], scenarioPlans: item.scenarioPlans });
      input.marketEmotion.review.tomorrow.positionLimit = "0%，禁止新开仓";
      const decision = buildTomorrowDecision(input);

      assert.equal(decision.verdict, "wait");
      assert.equal(decision.direction.status, "cash");
      assert.deepEqual(decision.candidates, []);
      assert.deepEqual(decision.contingencies, []);
      assert.equal(decision.permission.status, "blocked");
      assert.equal(decision.permission.canActivate, false);
      assert.equal(decision.permission.positionLimit, "0%，禁止新开仓");
      assert.match(decision.permission.summary, /禁止新开仓/);
      assert.match(decision.action.summary, /禁止新开仓/);
    });
  }
});
