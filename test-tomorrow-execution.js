"use strict";

const assert = require("assert");
const {
  classifyMomentumStage,
  classifyTomorrowExecution,
  buildTomorrowExecutionBoard,
} = require("./tomorrow-execution");
const { _internals } = require("./server");

function leadership(overrides = {}) {
  const base = {
    level: "L4",
    levelLabel: "主线主动龙头",
    identity: "主动型容量龙头",
    recognized: true,
    persistentRecognition: true,
    repairCoreQualified: true,
    coreIdentityQualified: true,
    coreDirectionMatch: true,
    focusMatch: true,
    tradeQualified: false,
    coreQualified: false,
    tradeState: "修复观察",
    directionState: {
      isCoreDirection: true,
      resonance: true,
      coreLabel: "核心方向",
      resonanceLabel: "绝对共振",
    },
    initiative: {
      score: 82,
      label: "主动性已验证",
      proactive: true,
      capacity: true,
      followerCount: 2,
      breadthLift: 2,
      dataQuality: "分时验证",
      retentionPct: 70,
      priceDiscovery: {
        suspectedOneWord: false,
        limitUpDiscoveryUnverified: false,
        noPriceDiscovery: false,
      },
    },
    structure: {
      grade: "A",
      frameworkIntact: true,
      breakdown: false,
      overextended: false,
      chipPressure: false,
      chipRepairing: false,
      closeToCostPct: 1.2,
    },
    hardFails: [],
  };
  return {
    ...base,
    ...overrides,
    directionState: { ...base.directionState, ...(overrides.directionState || {}) },
    initiative: { ...base.initiative, ...(overrides.initiative || {}) },
    structure: { ...base.structure, ...(overrides.structure || {}) },
  };
}

function coreStock(overrides = {}) {
  const base = {
    code: "000001",
    name: "核心样本",
    board: "主板",
    role: "龙头",
    ticketType: "容量票",
    setup: "核心观察",
    mainConcept: "AI应用",
    mainFamily: "AI应用",
    score: 80,
    price: 40,
    prevClose: 40.4,
    close: 40,
    high: 41,
    low: 39.5,
    changePct: -1,
    amountYi: 36,
    turnoverRate: 8,
    volumeRatio: 1.1,
    mainInflowYi: -1.2,
    flowNature: {
      key: "realization",
      label: "资金兑现",
      tradeBias: "保留核心，进入次日回流候选",
    },
    klineProfile: {
      lastClose: 40,
      ma5: 39.5,
      ma10: 38.8,
      ma20: 38,
      rise2: 1,
      rise10: 6,
      rise20: 8,
      pctFromHigh: 12,
      position120Pct: 45,
      nearHigh20: false,
      volumeBreakout: true,
      structureBreak: false,
    },
    hardGate: { pass: false, hardFails: ["均线未完全多头"] },
    rejects: [],
    leadership: leadership(),
  };
  return {
    ...base,
    ...overrides,
    flowNature: { ...base.flowNature, ...(overrides.flowNature || {}) },
    klineProfile: { ...base.klineProfile, ...(overrides.klineProfile || {}) },
    leadership: overrides.leadership || base.leadership,
  };
}

function kunlunStock() {
  return coreStock({
    code: "300418",
    name: "昆仑万维",
    board: "创业板",
    popularity: "首板涨停",
    changePct: 20,
    price: 43.2,
    close: 43.2,
    prevClose: 36,
    amountYi: 60.7,
    flowNature: { key: "uncertain", label: "资金性质待确认" },
    klineProfile: {
      lastClose: 43.2,
      rise2: 17.3,
      rise10: 2.9,
      rise20: 1.3,
      nearHigh20: false,
      newHigh: false,
      pctFromHigh: 22.4,
      position120Pct: 25.8,
      volumeBreakout: true,
      structureBreak: false,
    },
    leadership: leadership({
      impactScore: 100,
      initiative: {
        score: 100,
        label: "主动进攻",
        proactive: true,
        capacity: true,
        followerCount: 4,
        breadthLift: 3,
        retentionPct: 100,
        session: { maxChangePct: 20 },
      },
      structure: {
        grade: "B",
        frameworkIntact: true,
        breakdown: false,
        overextended: true,
        chipPressure: true,
        chipRepairing: false,
        closeToCostPct: 6.8,
      },
    }),
  });
}

function trueAccelerationStock() {
  return coreStock({
    code: "002777",
    name: "真加速样本",
    popularity: "2板涨停",
    boardHeight: 2,
    changePct: 10,
    price: 55,
    close: 55,
    prevClose: 50,
    amountYi: 48,
    flowNature: { key: "uncertain", label: "资金性质待确认" },
    klineProfile: {
      lastClose: 55,
      rise2: 20,
      rise10: 40,
      rise20: 55,
      nearHigh20: true,
      newHigh: true,
      pctFromHigh: 1,
      position120Pct: 92,
      volumeBreakout: true,
      structureBreak: false,
    },
    leadership: leadership({
      initiative: { score: 92, proactive: true, followerCount: 3, breadthLift: 2, retentionPct: 90 },
      structure: { grade: "A", frameworkIntact: true, overextended: true, closeToCostPct: 10 },
    }),
  });
}

function rotationStock() {
  return coreStock({
    code: "000636",
    name: "风华高科",
    prevClose: 49,
    changePct: 0,
    price: 49,
    close: 49,
    high: 51.84,
    amountYi: 135,
    flowNature: { key: "realization", label: "资金兑现" },
    klineProfile: {
      lastClose: 49,
      rise2: 3,
      rise10: 6,
      rise20: -20,
      nearHigh20: false,
      pctFromHigh: 41,
      position120Pct: 47,
      volumeBreakout: true,
      structureBreak: false,
    },
    leadership: leadership({
      level: "L1",
      levelLabel: "普通跟随",
      identity: "情绪/历史核心",
      coreIdentityQualified: false,
      repairCoreQualified: false,
      tradeQualified: false,
      coreQualified: false,
      tradeState: "仅观察",
      initiative: {
        score: 25,
        proactive: false,
        capacity: true,
        followerCount: 0,
        breadthLift: 0,
        relativeStrength: -8.3,
        peerMedianChangePct: 8.3,
        retentionPct: 0.3,
        session: { maxChangePct: 5.8, currentChangePct: 0 },
      },
      structure: { grade: "B", frameworkIntact: true, overextended: false, chipPressure: true, closeToCostPct: 7 },
    }),
  });
}

function activeRotationStock() {
  return coreStock({
    code: "600001",
    name: "主动震荡核心",
    prevClose: 40,
    changePct: 1.2,
    price: 40.48,
    close: 40.48,
    high: 41.28,
    amountYi: 55,
    flowNature: { key: "realization", label: "健康首次分歧" },
    klineProfile: {
      lastClose: 40.48,
      rise2: 8,
      rise10: 14,
      rise20: 18,
      nearHigh20: true,
      pctFromHigh: 5,
      position120Pct: 58,
      volumeBreakout: true,
      structureBreak: false,
    },
    leadership: leadership({
      level: "L3",
      levelLabel: "主线进攻核心",
      identity: "主动型容量龙头",
      coreIdentityQualified: true,
      tradeQualified: true,
      coreQualified: true,
      tradeState: "主攻候选",
      impactScore: 45,
      initiative: {
        score: 78,
        proactive: true,
        capacity: true,
        followerCount: 2,
        breadthLift: 1,
        relativeStrength: 2.4,
        peerMedianChangePct: -1.2,
        retentionPct: 72,
        session: { maxChangePct: 3.2, currentChangePct: 1.2 },
      },
      structure: { grade: "A", frameworkIntact: true, overextended: false, chipPressure: false, closeToCostPct: 2 },
    }),
  });
}

function weakRepairStock() {
  return coreStock({
    code: "002230",
    name: "科大讯飞",
    changePct: 5.8,
    price: 42.2,
    close: 42.2,
    amountYi: 40,
    flowNature: { key: "uncertain", label: "资金性质待确认" },
    klineProfile: {
      lastClose: 42.2,
      rise2: 5.4,
      rise10: 2.7,
      rise20: 2,
      nearHigh20: false,
      pctFromHigh: 17,
      position120Pct: 16,
      volumeBreakout: true,
      structureBreak: false,
    },
    leadership: leadership({
      level: "L1",
      levelLabel: "普通跟随",
      identity: "被动容量中军",
      coreIdentityQualified: false,
      repairCoreQualified: false,
      initiative: { score: 45, proactive: false, capacity: true, followerCount: 0, breadthLift: 0, retentionPct: 73 },
      structure: { grade: "A", frameworkIntact: true, overextended: false, chipPressure: false, closeToCostPct: 3.5 },
    }),
  });
}

function ordinaryStock() {
  return coreStock({
    code: "000002",
    name: "普通超跌",
    role: "后排",
    changePct: -2,
    price: 20,
    close: 20,
    klineProfile: { lastClose: 20, rise2: -2, rise10: -15, rise20: -25, position120Pct: 15, structureBreak: false },
    leadership: leadership({
      level: "L1",
      identity: "普通观察",
      recognized: false,
      persistentRecognition: false,
      coreIdentityQualified: false,
      repairCoreQualified: false,
      initiative: { score: 20, proactive: false, capacity: false, followerCount: 0, breadthLift: 0 },
    }),
  });
}

function escapeStock() {
  return coreStock({
    code: "000003",
    name: "出逃核心",
    changePct: -8,
    price: 30,
    close: 30,
    flowNature: { key: "escape", label: "资金出逃" },
    klineProfile: { lastClose: 30, structureBreak: true },
    leadership: leadership({
      structure: { grade: "D", frameworkIntact: false, breakdown: true, overextended: false },
    }),
  });
}

function testStageMachine() {
  const startup = classifyMomentumStage(kunlunStock());
  assert.strictEqual(startup.key, "startup", "低位首板主动带动应判为启动");
  assert.ok(startup.priorRise10 < 0, "累计涨幅必须剔除今日再判断此前阶段");
  assert.strictEqual(classifyTomorrowExecution(kunlunStock()).bucket, "entry", "启动核心应进入市场加强条件预案");

  const acceleration = classifyMomentumStage(trueAccelerationStock());
  assert.strictEqual(acceleration.key, "acceleration", "已有趋势并二板强化才允许判加速");
  assert.strictEqual(classifyTomorrowExecution(trueAccelerationStock()).bucket, "premium");

  const confirmation = classifyMomentumStage(coreStock({
    changePct: 4,
    price: 41.6,
    close: 41.6,
    flowNature: { key: "uncertain" },
    klineProfile: { lastClose: 41.6, rise2: 12, rise10: 9, rise20: 10, position120Pct: 50, structureBreak: false },
  }), { previousPhaseByCode: { "000001": { pricePhaseKey: "startup" } } });
  assert.strictEqual(confirmation.key, "confirmation", "上一交易日启动且承接有效应进入确认");

  assert.strictEqual(classifyMomentumStage(rotationStock()).key, "divergence", "正常兑现且结构未破属于分歧/兑现");
  assert.strictEqual(classifyTomorrowExecution(rotationStock()).tomorrowEntryQualified, false, "仅观察的被动历史核心不能取得明日买入资格");
  const laggingCore = rotationStock();
  laggingCore.flowNature = { key: "lagging_realization", label: "掉队兑现" };
  laggingCore.leadership.coreIdentityQualified = true;
  laggingCore.leadership.tradeQualified = true;
  laggingCore.leadership.tradeState = "主攻候选";
  const laggingDecision = classifyTomorrowExecution(laggingCore);
  assert.strictEqual(laggingDecision.bucket, "ignore", "即使保留核心身份，掉队兑现也只能观察，不能变成回流买点");
  assert.match(laggingDecision.actionLabel, /掉队兑现/);
  assert.strictEqual(classifyMomentumStage(weakRepairStock()).key, "repair", "低位历史核心保留弱市修复预案");
  assert.strictEqual(classifyTomorrowExecution(ordinaryStock()).bucket, "ignore", "普通超跌不能补位");
  assert.strictEqual(classifyMomentumStage(escapeStock()).key, "failure", "出逃或破位必须判失败");

  const stale = kunlunStock();
  stale.klineProfile.lastClose = 30;
  assert.strictEqual(classifyMomentumStage(stale).key, "unknown", "K线与当前收盘不一致时不得猜启动或加速");
}

function testThreePathBoard() {
  const board = buildTomorrowExecutionBoard([
    kunlunStock(),
    trueAccelerationStock(),
    rotationStock(),
    activeRotationStock(),
    weakRepairStock(),
    ordinaryStock(),
    escapeStock(),
  ]);
  assert.strictEqual(board.version, 3);
  assert.deepStrictEqual(board.scenarioPlans.map((plan) => plan.key), ["strengthen", "rotation", "weakRepair"]);
  assert.deepStrictEqual(board.scenarioPlans.map((plan) => plan.candidate && plan.candidate.code), ["300418", "600001", "002230"]);
  assert.strictEqual(new Set(board.scenarioPlans.map((plan) => plan.candidate && plan.candidate.code)).size, 3, "三条路径候选不得重复");
  assert.ok(board.premiumWatch.some((row) => row.code === "002777"));
  assert.ok(board.riskWatch.some((row) => row.code === "000003"));

  const fenghuaOnly = buildTomorrowExecutionBoard([rotationStock()]);
  assert.strictEqual(fenghuaOnly.scenarioPlans.find((plan) => plan.key === "rotation").candidate, null, "板块大涨却严重掉队、冲高回落且零带动的风华高科型样本必须让震荡路径为空");

  const healthyRotation = buildTomorrowExecutionBoard([activeRotationStock()]);
  assert.strictEqual(healthyRotation.scenarioPlans.find((plan) => plan.key === "rotation").candidate.code, "600001", "有主动性、承接、带动和相对强度的健康首次分歧核心应通过");

  const strictGateCases = [
    ["主动性不足", (stock) => { stock.leadership.initiative.proactive = false; }],
    ["主动性评分不足", (stock) => { stock.leadership.initiative.score = 59; }],
    ["没有真实带动", (stock) => { stock.leadership.initiative.followerCount = 0; stock.leadership.initiative.breadthLift = 0; }],
    ["承接不足", (stock) => { stock.leadership.initiative.retentionPct = 54; }],
    ["相对板块不够强", (stock) => { stock.leadership.initiative.relativeStrength = 0.4; }],
    ["冲高回落过大", (stock) => { stock.leadership.initiative.session.maxChangePct = 4.3; }],
    ["上游只给观察资格", (stock) => {
      stock.leadership.tradeState = "仅观察";
      stock.leadership.tradeQualified = false;
      stock.leadership.coreQualified = false;
      stock.leadership.coreIdentityQualified = false;
    }],
  ];
  strictGateCases.forEach(([label, mutate]) => {
    const stock = activeRotationStock();
    mutate(stock);
    const result = buildTomorrowExecutionBoard([stock]);
    assert.strictEqual(result.scenarioPlans.find((plan) => plan.key === "rotation").candidate, null, `震荡路径必须否决：${label}`);
  });
}

function testBestPickIntegration() {
  const strengthen = kunlunStock();
  strengthen.leadership.tradeQualified = true;
  strengthen.leadership.tradeState = "主攻候选";
  strengthen.hardGate = { pass: true, hardFails: [] };
  const rotation = activeRotationStock();
  rotation.hardGate = { pass: true, hardFails: [] };
  const candidates = [strengthen, rotationStock(), rotation, weakRepairStock(), trueAccelerationStock()];
  const topicBoard = {
    mainLine: {
      displayName: "AI应用",
      name: "AI应用",
      family: "AI应用",
      score: 90,
      count: 5,
      limitCount: 1,
      resonance: true,
      sustained: true,
      label: "可继续观察",
      reasons: ["方向仍有资金反复参与"],
    },
    items: [],
  };
  const marketState = {
    cycle: "修复",
    subPhase: "修复偏轮动",
    summary: "修复偏轮动，三路径条件执行",
    profitEffect: { score: 60 },
    lossEffect: { score: 35 },
  };
  const result = _internals.buildBestPicks(
    candidates,
    topicBoard,
    marketState,
    [{ name: "AI应用", family: "AI应用", displayName: "AI应用", score: 90, count: 5, resonance: true }],
    null,
    [],
    { dtToday: 4, dtPrev: 6 },
    null,
    { date: "2026-07-31", keyLine: "修复偏轮动" },
  );
  assert.strictEqual(result.executionVersion, 3);
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.scenarioPlans.length, 3);
  assert.strictEqual(result.scenarioPlans[0].candidate.code, "300418");
  assert.strictEqual(result.scenarioPlans[0].candidate.pricePhaseKey, "startup");
  assert.strictEqual(result.scenarioPlans[1].candidate.code, "600001");
  assert.strictEqual(result.scenarioPlans[2].status, "blocked");
  assert.strictEqual(result.scenarioPlans[2].candidate, null, "四道门不全的弱修复票只能作为诊断，不得保留为可执行候选");
  assert.deepStrictEqual(result.picks.map((item) => item.code), ["300418", "600001"]);
  assert.ok(result.premiumWatch.some((row) => row.code === "002777"), "真加速只能进入溢价观察");
}

function testDailyHeightCannotReceiveLegacyCoreBonuses() {
  const base = activeRotationStock();
  Object.assign(base, {
    code: "P1_ROLE_BASE",
    role: "后排观察",
    roleKind: null,
    roleScope: null,
    dailyRole: null,
    selected: false,
  });
  base.leadership = {
    ...base.leadership,
    coreIdentityQualified: false,
    tradeQualified: false,
    coreQualified: false,
    cycleIdentity: null,
  };
  const height = JSON.parse(JSON.stringify(base));
  Object.assign(height, {
    code: "P1_ROLE_HEIGHT",
    role: "龙头",
    roleKind: "dailyHeight",
    roleScope: "session",
    dailyRole: "当日高度",
  });
  height.leadership.sessionIdentity = {
    dailyHeight: true,
    tradingDate: "2026-07-31",
    themeIds: ["AI应用"],
    themeNames: ["AI应用"],
  };
  const cycle = JSON.parse(JSON.stringify(base));
  Object.assign(cycle, {
    code: "P1_ROLE_CYCLE",
    role: "龙头",
    roleKind: "cycleLeader",
    roleScope: "cycle",
  });
  cycle.leadership.cycleIdentity = {
    identityEstablished: true,
    activePrimary: true,
    state: "confirmed",
    executionEligible: true,
  };

  const cycleAuthority = _internals.candidateRoleAuthority(cycle);
  const heightAuthority = _internals.candidateRoleAuthority(height);

  assert.strictEqual(cycleAuthority.cycleLeader, true, "confirmed且active的周期身份才取得周期龙头权限");
  assert.strictEqual(cycleAuthority.dailyHeight, false, "已确认周期龙头不能被降格成纯当日高度");
  assert.strictEqual(heightAuthority.dailyHeight, true, "session级当日高度应被明确识别");
  assert.strictEqual(heightAuthority.cycleLeader, false, "当日高度不能冒充周期龙头");
  assert.strictEqual(heightAuthority.coreAuthorized, false, "当日高度不能取得周期核心权限");

  const topicBoard = {
    mainLine: { displayName: "AI应用", name: "AI应用", family: "AI应用", score: 80, count: 3, sustained: true },
    items: [],
  };
  const marketState = { cycle: "混沌", subPhase: "混沌", summary: "混沌", profitEffect: { score: 40 }, lossEffect: { score: 40 } };
  const result = _internals.buildBestPicks([base, height, cycle], topicBoard, marketState, [{ name: "AI应用", family: "AI应用", score: 80, count: 3 }]);

  assert.strictEqual(result.available, false, "角色识别不能绕过明日执行门槛");
  assert.deepStrictEqual(result.picks, [], "未通过交易资格与硬门槛时仍不得生成可执行票");
}

function testDirectionRelativeStrengthBridge() {
  const target = { code: "600010", mainConcept: "AI应用", mainFamily: "AI", changePct: 1.2 };
  const peers = [
    target,
    { code: "600011", mainConcept: "AI应用", mainFamily: "AI", changePct: -1 },
    { code: "600012", mainConcept: "AI应用", mainFamily: "AI", changePct: 0 },
    { code: "600013", mainConcept: "AI应用", mainFamily: "AI", changePct: 2 },
  ];
  const healthy = _internals.fundFlowDirectionStats(target, peers);
  assert.strictEqual(healthy.peerMedianChangePct, 0);
  assert.strictEqual(healthy.relativeStrength, 1.2, "服务端必须把相对方向强度提供给v3轮动闸门");

  const lagging = { code: "600014", mainConcept: "AI应用", mainFamily: "AI", changePct: -3 };
  const weak = _internals.fundFlowDirectionStats(lagging, peers.slice(1).concat(lagging));
  assert.strictEqual(weak.peerMedianChangePct, 0);
  assert.strictEqual(weak.relativeStrength, -3, "明显掉队必须保留负相对强度，不能因手机端字段缺失而变成未知");
}

testStageMachine();
testThreePathBoard();
testBestPickIntegration();
testDailyHeightCannotReceiveLegacyCoreBonuses();
testDirectionRelativeStrengthBridge();
console.log("tomorrow execution tests passed");
