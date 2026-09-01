"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildTradingStylePreference } = require("./trading-style-preference");

function leadership(overrides = {}) {
  const initiativeOverrides = overrides.initiative || {};
  const structureOverrides = overrides.structure || {};
  return {
    concept: "存储芯片",
    identity: "核心观察",
    level: "L2",
    coreIdentityQualified: true,
    coreQualified: false,
    tradeQualified: false,
    ...overrides,
    initiative: {
      score: 70,
      proactive: true,
      capacity: false,
      followerCount: 1,
      ...initiativeOverrides,
    },
    structure: {
      breakdown: false,
      frameworkIntact: true,
      overextended: false,
      ...structureOverrides,
    },
  };
}

function candidate(code, overrides = {}) {
  const profileOverrides = overrides.klineProfile || {};
  const speculationOverrides = overrides.speculation || {};
  const leadershipOverrides = overrides.leadership || {};
  return {
    code,
    name: `样本${code}`,
    mainConcept: "存储芯片",
    role: "龙头",
    ticketType: "情绪龙头票",
    changePct: 10,
    amountYi: 15,
    volumeRatio: 1.8,
    mainInflowYi: 1,
    selected: false,
    tradeQualified: true,
    hardGate: { pass: true },
    score: 80,
    gamePlan: { canGame: false, longStrength: 70 },
    speculation: { boards: 1, ...speculationOverrides },
    klineProfile: {
      rise2: 12,
      rise20: 10,
      pctFromHigh: 25,
      volumeBreakout: true,
      ma5Rising: true,
      ...profileOverrides,
    },
    leadership: leadership(leadershipOverrides),
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => ![
      "klineProfile",
      "speculation",
      "leadership",
    ].includes(key))),
  };
}

function payload(candidates, options = {}) {
  return {
    fetchedAt: "2026-08-10T15:05:00.000Z",
    market: {
      tradingStyle: options.tradingStyle,
      limitStats: {
        dates: { today: "20260810", prev: "20260807", verified: true },
        pool: candidates.map((stock) => ({
          code: stock.code,
          name: stock.name,
          highDays: stock.speculation.boards === 1 ? "首板" : `${stock.speculation.boards}天${stock.speculation.boards}板`,
        })),
      },
    },
    candidates,
    selected: options.selected || [],
    bestPicks: options.bestPicks || [],
    leadershipBoard: options.leadershipBoard || { leaders: [], tradeCarriers: [], observations: [] },
  };
}

function lowLaunchRows(prefix = "10") {
  return [
    candidate(`${prefix}001`, {
      name: "低位先锋",
      role: "龙头",
      leadership: { identity: "主动先锋", initiative: { proactive: true, followerCount: 2 } },
    }),
    candidate(`${prefix}002`, {
      name: "低位容量",
      role: "中军",
      ticketType: "容量票",
      amountYi: 35,
      leadership: { identity: "主动容量中军", initiative: { capacity: true, proactive: true } },
    }),
    candidate(`${prefix}003`, {
      name: "低位跟随",
      role: "补涨",
      leadership: { identity: "低位跟随", coreIdentityQualified: false, initiative: { proactive: false } },
    }),
  ];
}

function boardEmotionRows(prefix = "20") {
  return [5, 4, 3].map((boards, index) => candidate(`${prefix}00${index + 1}`, {
    name: `连板核心${boards}`,
    role: index === 0 ? "龙头" : "先锋",
    speculation: { boards },
    klineProfile: { rise20: 45 + index * 5, pctFromHigh: 0, rise2: 21 },
    leadership: {
      identity: index === 0 ? "市场高标核心" : "连板先锋",
      initiative: {
        proactive: true,
        session: {
          limitTouched: true,
          limitOpenCount: 1,
          resealedAfterOpen: true,
          closedAtLimit: true,
          openChangePct: 5,
          currentChangePct: 10,
        },
      },
    },
  }));
}

function highTrendRows(prefix = "30") {
  return [5, 6, 4].map((changePct, index) => candidate(`${prefix}00${index + 1}`, {
    name: `高位趋势${index + 1}`,
    role: index === 0 ? "龙头" : "中军",
    ticketType: "容量票",
    changePct,
    price: 100 + index * 5,
    amountYi: 40 + index * 10,
    speculation: { boards: 0 },
    klineProfile: {
      wave: index === 0 ? "二波突破" : "高位趋势",
      rise2: changePct + 3,
      rise10: 18 + index * 3,
      rise20: 28 + index * 5,
      pctFromHigh: 3 + index,
      retraceOfRunupPct: 18 + index * 2,
      nearHigh20: true,
      ma5Rising: true,
      ma5: 98 + index * 5,
      ma10: 96 + index * 5,
      ma20: 93 + index * 5,
      ma60: 88 + index * 5,
      lastClose: 100 + index * 5,
    },
    leadership: {
      identity: index === 0 ? "主动趋势龙头" : "主动容量中军",
      initiative: { proactive: true, capacity: true },
    },
  }));
}

test("缺数据时三条路径均为 unknown，不把缺失补成0分", () => {
  const result = buildTradingStylePreference({});

  assert.equal(result.marketOrganization.key, "unknown");
  assert.equal(result.marketOrganization.dataCoveragePct, null);
  assert.equal(Object.hasOwn(result.marketOrganization, "confidence"), false);
  assert.equal(result.dominantPath.key, "unknown");
  for (const path of Object.values(result.paths)) {
    assert.equal(path.status, "unknown");
    assert.equal(path.score, null);
    assert.equal(path.components.crossDayContinuation.score, null);
  }
  assert.strictEqual(result.highTrend, result.paths.highTrend);
  assert.strictEqual(result.lowLaunch, result.paths.lowLaunch);
  assert.strictEqual(result.boardEmotion, result.paths.boardEmotion);
  assert.equal(result.directionPermission.screeningStatus, "unknown");
  assert.equal(result.directionPermission.executionStatus, "blocked");
});

test("旧“板块轮动/轮动回流”字段不能直接确认新路径", () => {
  const result = buildTradingStylePreference(payload([], {
    tradingStyle: { style: "板块轮动", preference: "轮动回流" },
  }));

  assert.equal(result.marketOrganization.key, "unknown");
  assert.equal(result.dominantPath.key, "unknown");
  assert.deepEqual(result.dominantPath.paths, []);
  assert.match(result.marketOrganization.guard, /不会自动映射/);
});

test("低位启动必须同时有3只样本、先锋和容量/跟随结构", () => {
  const rows = lowLaunchRows();
  const result = buildTradingStylePreference(payload(rows));

  assert.equal(result.paths.lowLaunch.status, "active");
  assert.equal(result.paths.lowLaunch.stage, "fermenting");
  assert.equal(result.paths.lowLaunch.sampleCount, 3);
  assert.equal(result.paths.lowLaunch.components.crossDayContinuation.status, "unknown");
  assert.equal(result.paths.lowLaunch.components.crossDayContinuation.score, null);
  assert.equal(result.dominantPath.key, "lowLaunch");
  assert.equal(result.marketOrganization.key, "single_path");
  assert.ok(result.opportunities.some((item) => item.path === "lowLaunch"));

  const onlyTwo = buildTradingStylePreference(payload(rows.slice(0, 2)));
  assert.notEqual(onlyTwo.paths.lowLaunch.status, "active");
});

test("连板情绪由多只中高标确认，高潮阶段优先回封并回避追板", () => {
  const result = buildTradingStylePreference(payload(boardEmotionRows()));

  assert.equal(result.paths.boardEmotion.status, "active");
  assert.equal(result.paths.boardEmotion.stage, "emotion_climax");
  assert.equal(result.executionPreference.methods.reseal.status, "preferred");
  assert.equal(result.executionPreference.methods.chaseBoard.status, "avoid");
  assert.ok(result.cautions.some((item) => item.key === "emotion_climax"));

  const singleHigh = buildTradingStylePreference(payload(boardEmotionRows().slice(0, 1)));
  assert.notEqual(singleHigh.paths.boardEmotion.status, "active", "单一最高板不得定义情绪阶段");
});

test("高位趋势成立后偏好低吸和趋势，不追情绪加速", () => {
  const result = buildTradingStylePreference(payload(highTrendRows("62")));

  assert.equal(result.paths.highTrend.status, "active");
  assert.equal(result.dominantPath.key, "highTrend");
  assert.equal(result.executionPreference.methods.lowBuy.status, "preferred");
  assert.equal(result.executionPreference.methods.trend.status, "preferred");
  assert.notEqual(result.executionPreference.methods.chaseBoard.status, "preferred");
});

test("历史高位深跌修复不得因20日反弹和热榜身份冒充当前高位趋势", () => {
  const jinAn = candidate("002636", {
    name: "金安国纪",
    price: 74.02,
    changePct: 6.64,
    role: "中军",
    ticketType: "容量票",
    amountYi: 56.2,
    speculation: { boards: 1 },
    klineProfile: {
      wave: "三波/高位趋势",
      rise10: 9.2,
      rise20: 45.6,
      rise30: -8.2,
      pctFromHigh: 40.5,
      retraceOfRunupPct: 52.2,
      nearHigh20: true,
      ma5Rising: true,
      ma5: 66.21,
      ma10: 65.85,
      ma20: 63.75,
      ma60: 79.82,
      lastClose: 74.02,
    },
    leadership: {
      identity: "主动型容量龙头",
      persistentRecognition: true,
      initiative: { proactive: true, capacity: true },
      structure: { breakdown: false, frameworkIntact: true, overextended: true, chipPressure: true },
    },
  });
  const result = buildTradingStylePreference(payload([jinAn, ...boardEmotionRows("66")]));

  assert.equal(result.paths.highTrend.sampleCount, 0);
  assert.equal(result.observationRepresentatives.highTrend.some((row) => row.code === jinAn.code), false);
  assert.equal(result.dominantPath.key, "boardEmotion");
});

test("盘中高位趋势即使规则分达标也只能暂定观察，不能授予正式偏好", () => {
  const rows = highTrendRows("67");
  rows.forEach((stock, index) => {
    stock.eastRank = index + 1;
    stock.thsRank = index + 2;
  });
  const source = payload(rows);
  source.sources = {
    eastmoney: 100,
    ths: 100,
    hotRanks: {
      eastmoney: { observationPhase: "intraday" },
      ths: { observationPhase: "intraday" },
    },
  };
  const result = buildTradingStylePreference(source);

  assert.equal(result.paths.highTrend.status, "active");
  assert.equal(result.conclusionState, "intraday_provisional");
  assert.deepEqual(result.directionPermission.activePaths, []);
  assert.deepEqual(result.directionPermission.provisionalPaths, ["highTrend"]);
  assert.equal(result.directionPermission.executionStatus, "blocked");
});

test("分数接近的低位启动与连板情绪输出双路径并行", () => {
  const rows = [...lowLaunchRows("60"), ...boardEmotionRows("61")];
  const result = buildTradingStylePreference(payload(rows));

  assert.equal(result.paths.lowLaunch.status, "active");
  assert.equal(result.paths.boardEmotion.status, "active");
  assert.equal(result.dominantPath.key, "parallel");
  assert.equal(result.marketOrganization.key, "dual_path");
  assert.ok(result.cautions.some((item) => item.key === "parallel_paths"));
  assert.equal(result.tomorrowPaths[1].label, "高位兑现、低位承接");
});

test("代表案例必须同时通过统一个股门槛/gamePlan/leadership/真实概念", () => {
  const [good, badGamePlan, badRear, badConcept] = [
    candidate("600001", {
      name: "合格先锋",
      selected: true,
      gamePlan: { canGame: true, longStrength: 88 },
      leadership: {
        concept: "存储芯片",
        identity: "主动低位先锋",
        level: "L4",
        tradeQualified: true,
        coreQualified: true,
      },
    }),
    candidate("600002", {
      name: "博弈不合格",
      selected: true,
      gamePlan: { canGame: false },
      leadership: { identity: "主动先锋", level: "L4", tradeQualified: true, coreQualified: true },
    }),
    candidate("600003", {
      name: "后排不合格",
      role: "后排观察",
      selected: true,
      gamePlan: { canGame: true },
      leadership: { identity: "后排观察", level: "L4", tradeQualified: true, coreQualified: true },
    }),
    candidate("600004", {
      name: "概念错配",
      selected: true,
      gamePlan: { canGame: true },
      leadership: { concept: "机器人", identity: "主动先锋", level: "L4", tradeQualified: true, coreQualified: true },
    }),
  ];
  const result = buildTradingStylePreference(payload(
    [good, badGamePlan, badRear, badConcept],
    { selected: [good, badGamePlan, badRear, badConcept] },
  ));

  assert.deepEqual(result.representatives.lowLaunch.map((item) => item.name), ["合格先锋"]);
  assert.equal(result.representatives.total, 1);
  assert.equal(result.representatives.lowLaunch[0].concept, "存储芯片");
  assert.equal(result.directionPermission.executionStatus, "conditional");
});

test("没有通过硬门槛的案例时，路径可成立但执行权限仍阻断", () => {
  const rows = lowLaunchRows("70");
  const result = buildTradingStylePreference(payload(rows));

  assert.equal(result.paths.lowLaunch.status, "active");
  assert.equal(result.representatives.total, 0);
  assert.equal(result.directionPermission.screeningStatus, "allowed");
  assert.equal(result.directionPermission.executionStatus, "blocked");
  assert.match(result.representatives.note, /没有.*可执行案例/);
});

test("旧bestPicks不得授予载体资格，只认当前统一个股门槛", () => {
  const rows = lowLaunchRows("71");
  const qualified = rows[0];
  qualified.gamePlan = { canGame: true, longStrength: 91 };
  qualified.leadership = leadership({
    concept: qualified.mainConcept,
    identity: "主动低位先锋",
    level: "L4",
    tradeQualified: true,
    coreQualified: true,
    initiative: { proactive: true, followerCount: 2 },
  });
  qualified.tradeQualified = false;
  qualified.hardGate = { pass: false };

  const legacyOnly = buildTradingStylePreference(payload(rows, {
    bestPicks: { picks: [{ stock: { code: qualified.code, name: qualified.name } }] },
  }));
  assert.deepEqual(legacyOnly.eligibleCarrierCodesByPath.lowLaunch, []);
  assert.equal(legacyOnly.directionPermission.executionStatus, "blocked");

  qualified.tradeQualified = true;
  qualified.hardGate = { pass: true };
  const result = buildTradingStylePreference(payload(rows));
  assert.equal(result.dominantPath.key, "lowLaunch");
  assert.deepEqual(result.eligibleCarrierCodesByPath.lowLaunch, [qualified.code]);
  assert.deepEqual(result.representatives.lowLaunch.map((item) => item.code), [qualified.code]);
  assert.equal(result.directionPermission.executionStatus, "conditional");
});

test("原始候选尚未生成顶层tradeQualified时，不得否决其他已通过的载体门槛", () => {
  const rows = lowLaunchRows("75");
  const qualified = rows[0];
  delete qualified.tradeQualified;
  qualified.hardGate = { pass: true };
  qualified.gamePlan = { canGame: true, longStrength: 90 };
  qualified.leadership = leadership({
    concept: qualified.mainConcept,
    identity: "主动低位先锋",
    level: "L4",
    tradeQualified: true,
    coreQualified: true,
    initiative: { proactive: true, followerCount: 2 },
  });

  const result = buildTradingStylePreference(payload(rows));
  assert.equal(result.paths.lowLaunch.status, "active");
  assert.deepEqual(result.eligibleCarrierCodesByPath.lowLaunch, [qualified.code]);
  assert.equal(result.directionPermission.executionStatus, "conditional");
});

test("旧bestPicks.scenarioPlans不得授权或否决独立通过统一门槛的载体", () => {
  const rows = lowLaunchRows("58");
  const frozenAlternative = rows[0];
  frozenAlternative.selected = true;
  frozenAlternative.gamePlan = { canGame: true, longStrength: 95 };
  frozenAlternative.leadership = leadership({
    concept: frozenAlternative.mainConcept,
    identity: "主动低位先锋",
    level: "L4",
    tradeQualified: true,
    coreQualified: true,
    initiative: { proactive: true, followerCount: 2 },
  });

  const result = buildTradingStylePreference(payload(rows, {
    bestPicks: {
      picks: [],
      scenarioPlans: [
        { key: "strengthen", candidate: { code: rows[1].code, name: rows[1].name } },
        { key: "weakRepair", candidate: { code: frozenAlternative.code, name: frozenAlternative.name } },
      ],
    },
  }));

  assert.equal(result.paths.lowLaunch.status, "active");
  assert.deepEqual(result.eligibleCarrierCodesByPath.lowLaunch, [frozenAlternative.code]);
  assert.ok(result.eligibleCarrierCodes.includes(frozenAlternative.code));
  assert.equal(result.directionPermission.executionStatus, "conditional");
});

test("10天6板和9天7板只记窗口活跃，只有首板、N连板或X天X板计连续高度", () => {
  const launchRows = lowLaunchRows("72");
  const historicalLaunch = launchRows[0];
  historicalLaunch.speculation.boards = "10天6板";
  historicalLaunch.gamePlan = { canGame: true, longStrength: 90 };
  historicalLaunch.leadership.tradeQualified = true;
  historicalLaunch.leadership.coreQualified = true;
  const launchSource = payload(launchRows, { selected: [historicalLaunch] });
  launchSource.market.limitStats.pool[0].highDays = "首板";

  const launchResult = buildTradingStylePreference(launchSource);
  const launchRepresentative = launchResult.representatives.lowLaunch[0];

  assert.equal(launchResult.paths.lowLaunch.status, "active");
  assert.equal(launchRepresentative.code, historicalLaunch.code);
  assert.equal(launchRepresentative.consecutiveBoards, 1);
  assert.equal(launchRepresentative.boardCount, 1, "boardCount兼容字段也必须是连续高度1");
  assert.deepEqual(launchRepresentative.boardsInWindow, { days: 10, boards: 6 });
  assert.ok(!launchResult.eligibleCarrierCodesByPath.boardEmotion.includes(historicalLaunch.code));

  const validBoards = boardEmotionRows("79");
  validBoards[0].speculation.boards = "5连板";
  validBoards[0].gamePlan = { canGame: true, longStrength: 97 };
  validBoards[0].leadership.tradeQualified = true;
  validBoards[0].leadership.coreQualified = true;
  const historicalOnly = candidate("790004", {
    name: "九天七板历史活跃",
    speculation: { boards: "9天7板" },
    gamePlan: { canGame: true, longStrength: 96 },
    leadership: {
      identity: "市场人气核心",
      level: "L4",
      tradeQualified: true,
      coreQualified: true,
    },
  });
  const boardSource = payload([...validBoards, historicalOnly], { selected: [validBoards[0], historicalOnly] });
  boardSource.market.limitStats.pool[0].highDays = "5连板";
  boardSource.market.limitStats.pool[3].highDays = "9天7板";
  const boardResult = buildTradingStylePreference(boardSource);

  assert.equal(boardResult.paths.boardEmotion.status, "active");
  assert.equal(boardResult.paths.boardEmotion.sampleCount, 3, "9天7板不能作为7连板加入连板样本");
  assert.equal(boardResult.representatives.boardEmotion[0].consecutiveBoards, 5);
  assert.ok(!boardResult.eligibleCarrierCodesByPath.boardEmotion.includes(historicalOnly.code));
});

test("同一合格核心可归属多条active路径，各路径保留而总codes去重", () => {
  const trendRows = highTrendRows("73");
  const boardRows = boardEmotionRows("74");
  const hybrid = boardRows[0];
  hybrid.ticketType = "容量票";
  hybrid.amountYi = 50;
    hybrid.klineProfile = {
      ...hybrid.klineProfile,
      rise10: 30,
      rise20: 50,
      pctFromHigh: 0,
      retraceOfRunupPct: 12,
      nearHigh20: true,
      ma5Rising: true,
      ma5: 20,
      ma10: 19,
      ma20: 18,
      ma60: 17,
      lastClose: 22,
    };
    hybrid.price = 22;
  hybrid.gamePlan = { canGame: true, longStrength: 95 };
  hybrid.leadership = leadership({
    concept: hybrid.mainConcept,
    identity: "主动趋势连板核心",
    level: "L4",
    persistentRecognition: true,
    tradeQualified: true,
    coreQualified: true,
    initiative: {
      proactive: true,
      capacity: true,
      session: {
        limitTouched: true,
        limitOpenCount: 1,
        resealedAfterOpen: true,
        closedAtLimit: true,
        openChangePct: 5,
        currentChangePct: 10,
      },
    },
  });

  const result = buildTradingStylePreference(payload([...trendRows, ...boardRows], {
    bestPicks: [{ code: hybrid.code, name: hybrid.name }],
  }));

  assert.equal(result.paths.highTrend.status, "active");
  assert.equal(result.paths.boardEmotion.status, "active");
  assert.ok(result.eligibleCarrierCodesByPath.highTrend.includes(hybrid.code));
  assert.ok(result.eligibleCarrierCodesByPath.boardEmotion.includes(hybrid.code));
  assert.equal(result.eligibleCarrierCodes.filter((code) => code === hybrid.code).length, 1);
  assert.equal(result.representatives.total, 1);
});

test("多条active路径严格按dominantPath.paths授权主载体与次级备选", () => {
  const buildRowsWithQualified = (qualifyPath) => {
    const trendRows = highTrendRows("75");
    const boardRows = boardEmotionRows("76");
    trendRows.forEach((stock, index) => {
      stock.changePct = [1, 2, 1.5][index];
      stock.klineProfile.rise2 = stock.changePct + 3;
    });
    const qualified = qualifyPath === "boardEmotion" ? boardRows[0] : trendRows[0];
    qualified.gamePlan = { canGame: true, longStrength: 94 };
    qualified.leadership.tradeQualified = true;
    qualified.leadership.coreQualified = true;
    return { rows: [...trendRows, ...boardRows], qualified };
  };

  const secondaryFixture = buildRowsWithQualified("highTrend");
  const secondary = buildTradingStylePreference(payload(secondaryFixture.rows, {
    selected: [secondaryFixture.qualified],
  }));

  assert.equal(secondary.paths.highTrend.status, "active");
  assert.equal(secondary.paths.boardEmotion.status, "active");
  assert.equal(secondary.dominantPath.key, "boardEmotion");
  assert.deepEqual(secondary.directionPermission.dominantPaths, ["boardEmotion"]);
  assert.deepEqual(secondary.directionPermission.primaryEligibleCarrierCodes, []);
  assert.deepEqual(secondary.directionPermission.contingencyEligibleCarrierCodes, [secondaryFixture.qualified.code]);
  assert.equal(secondary.directionPermission.executionStatus, "contingency_only");
  assert.deepEqual(secondary.directionPermission.executionEligibleCarrierCodes, [secondaryFixture.qualified.code]);

  const primaryFixture = buildRowsWithQualified("boardEmotion");
  const primary = buildTradingStylePreference(payload(primaryFixture.rows, {
    selected: [primaryFixture.qualified],
  }));

  assert.equal(primary.dominantPath.key, "boardEmotion");
  assert.deepEqual(primary.directionPermission.primaryEligibleCarrierCodes, [primaryFixture.qualified.code]);
  assert.equal(primary.directionPermission.executionStatus, "conditional");
  assert.deepEqual(primary.directionPermission.executionEligibleCarrierCodes, [primaryFixture.qualified.code]);
});

test("parallel的两条dominantPath均属于主授权，不误降为次级备选", () => {
  const lowRows = lowLaunchRows("77");
  const boardRows = boardEmotionRows("78");
  const qualified = lowRows[0];
  qualified.gamePlan = { canGame: true, longStrength: 92 };
  qualified.leadership.tradeQualified = true;
  qualified.leadership.coreQualified = true;
  const result = buildTradingStylePreference(payload([...lowRows, ...boardRows], {
    selected: [qualified],
  }));

  assert.equal(result.dominantPath.key, "parallel");
  assert.ok(result.dominantPath.paths.includes("lowLaunch"));
  assert.deepEqual(result.directionPermission.primaryEligibleCarrierCodes, [qualified.code]);
  assert.deepEqual(result.directionPermission.contingencyEligibleCarrierCodes, []);
  assert.equal(result.directionPermission.executionStatus, "conditional");
});

test("双榜尚未抓到与有数据但无主导是两个不同结论状态", () => {
  const pendingSource = payload(lowLaunchRows("81"));
  pendingSource.sources = { eastmoney: 0, ths: 0 };
  const pending = buildTradingStylePreference(pendingSource);

  assert.equal(pending.sourceCoverage.rankingsState, "pending");
  assert.equal(pending.conclusionState, "rankings_pending");
  assert.equal(pending.dominantPath.key, "unknown");
  assert.match(pending.dominantPath.reason, /rankings_pending/);
  assert.equal(pending.sourceCoverage.east, 0);
  assert.equal(pending.sourceCoverage.ths, 0);

  const insufficientRows = [lowLaunchRows("82")[0]];
  insufficientRows[0].eastRank = 1;
  insufficientRows[0].thsRank = 2;
  const readySource = payload(insufficientRows);
  readySource.sources = { eastmoney: 100, ths: 100 };
  const noDominant = buildTradingStylePreference(readySource);

  assert.equal(noDominant.sourceCoverage.rankingsState, "ready");
  assert.equal(noDominant.conclusionState, "no_dominant");
  assert.equal(noDominant.dominantPath.key, "unknown");
  assert.match(noDominant.dominantPath.reason, /榜单样本已有/);
});

test("Top100盘前伪0不计赚钱质量，收盘连板证据仍可确认市场路径", () => {
  const rows = boardEmotionRows("83");
  rows[0].name = "哈药股份";
  rows.forEach((stock, index) => {
    stock.eastRank = index + 1;
    stock.thsRank = index + 2;
    stock.price = null;
    stock.open = null;
    stock.high = null;
    stock.low = null;
    stock.amountYi = null;
    stock.volumeRatio = null;
    stock.mainInflowYi = null;
    stock.turnoverRate = 0;
    stock.prevClose = 10;
    stock.changePct = 0;
    delete stock.leadership.initiative.session;
  });
  const source = payload(rows);
  source.sources = { eastmoney: 100, ths: 100 };
  const result = buildTradingStylePreference(source);

  assert.equal(result.sourceCoverage.rankingsState, "ready");
  assert.equal(result.sourceCoverage.quoteUsable, 0);
  assert.equal(result.sourceCoverage.quotePending, 3);
  assert.equal(result.conclusionState, "quotes_pending");
  assert.equal(result.paths.boardEmotion.status, "active");
  assert.equal(result.paths.boardEmotion.components.profitQuality.source, "closing_limit_pool");
  assert.doesNotMatch(result.paths.boardEmotion.components.profitQuality.evidence, /上涨0%/);
  assert.equal(result.dominantPath.key, "boardEmotion");
  assert.equal(result.observationRepresentatives.boardEmotion[0].name, "哈药股份");
  assert.equal(result.observationRepresentatives.boardEmotion[0].executable, false);
  assert.equal(result.representatives.total, 0);
  assert.equal(result.directionPermission.executionStatus, "blocked");
});

test("榜单样本覆盖与规则组件覆盖分别输出，均不冒充结论置信度", () => {
  const rows = boardEmotionRows("84");
  rows.forEach((stock, index) => {
    stock.eastRank = index + 1;
    stock.thsRank = index + 4;
  });
  const source = payload(rows);
  source.sources = { eastmoney: 50, ths: 50 };
  const result = buildTradingStylePreference(source);

  assert.equal(result.sourceCoverage.combinedCoveragePct, 50);
  assert.equal(result.marketOrganization.dataCoveragePct, 50);
  assert.equal(result.marketOrganization.coverageKind, "ranking_sample_coverage");
  assert.equal(typeof result.marketOrganization.ruleComponentCoveragePct, "number");
  assert.equal(Object.hasOwn(result.marketOrganization, "confidence"), false);
  assert.match(result.sourceCoverage.note, /不是结论置信度/);
});

test("精确T-1涨停补充池只服务个股观察，不反向确认市场赚钱效应", () => {
  const marketRows = lowLaunchRows("85");
  const previousLimitRows = boardEmotionRows("95").map((stock) => ({
    ...stock,
    previousLimitUpOnly: true,
    previousLimitUpEvidence: {
      verified: true,
      tradingDate: "2026-08-07",
      closedAtLimit: true,
      priceDiscoveryVerified: true,
    },
  }));
  const baseline = buildTradingStylePreference(payload(marketRows));
  const result = buildTradingStylePreference(payload([...marketRows, ...previousLimitRows]));

  assert.equal(result.paths.lowLaunch.status, baseline.paths.lowLaunch.status);
  assert.equal(result.paths.boardEmotion.status, baseline.paths.boardEmotion.status);
  assert.equal(result.analysisScope.rawMarketSampleCount, marketRows.length);
  assert.equal(result.analysisScope.previousLimitUpOnlyExcludedCount, previousLimitRows.length);
  assert.match(result.methodology.guards.join("；"), /T-1涨停补充池.*不参与市场风格/);
});

test("模块保持纯函数，不修改原快照", () => {
  const rows = [...lowLaunchRows("80"), ...boardEmotionRows("90")];
  const source = payload(rows);
  const before = JSON.stringify(source);

  buildTradingStylePreference(source);

  assert.equal(JSON.stringify(source), before);
});

test("source observation phase preserves intraday context and outranks preopen", () => {
  const source = payload(boardEmotionRows("86"));
  source.sources = {
    eastmoney: 100,
    ths: 100,
    hotRanks: {
      eastmoney: { observationPhase: "preopen" },
      ths: { observationPhase: "intraday" },
    },
  };

  const result = buildTradingStylePreference(source);

  assert.equal(result.sourceCoverage.observationPhase, "intraday");
});

function persistentBoardRows(prefix) {
  return [5, 4, 3, 2, 2].map((boards, index) => candidate(`${prefix}${String(index + 1).padStart(3, "0")}`, {
    name: `持续连板样本${index + 1}`,
    role: index === 0 ? "龙头" : "先锋",
    speculation: { boards },
    klineProfile: { rise20: 35 + index, pctFromHigh: 0, rise2: 18 },
    leadership: {
      identity: index === 0 ? "市场高标核心" : "连板先锋",
      initiative: { proactive: true, followerCount: 2 },
    },
  }));
}

function closingPayload(rows, tradingDate, previousTradingDate) {
  const result = payload(rows);
  result.fetchedAt = `${tradingDate}T15:10:00+08:00`;
  result.market.limitStats.dates = {
    today: tradingDate,
    prev: previousTradingDate,
    verified: true,
  };
  result.archiveMeta = { snapshotKind: "closing", tradingDate };
  result.decisionBasis = { snapshotKind: "closing", tradingDate, asOf: result.fetchedAt };
  return result;
}

function attachPreference(source, model) {
  source.premarketModels = {
    version: 2,
    tradingStylePreference: model,
  };
  return source;
}

function styleOutcomeRows(model, tradingDate, changePct) {
  const samples = Object.values(model.pathCohorts.paths)
    .flatMap((path) => path.samples || []);
  const byCode = new Map();
  samples.forEach((sample) => {
    if (!sample.code || byCode.has(sample.code)) return;
    byCode.set(sample.code, {
      code: sample.code,
      name: sample.name,
      price: 10,
      changePct,
      styleOutcomeOnly: true,
      styleOutcomeTradingDate: tradingDate,
      styleOutcomeQuoteVerified: true,
      leadership: { initiative: { session: null }, structure: { breakdown: false } },
    });
  });
  return [...byCode.values()];
}

test("持续偏好只由冻结T日样本的T+1反馈确认，单日观察不能切换", () => {
  const day1 = closingPayload(persistentBoardRows("881"), "2026-08-24", "2026-08-21");
  const model1 = buildTradingStylePreference(day1);
  attachPreference(day1, model1);
  assert.equal(model1.pathCohorts.status, "frozen");
  assert.equal(model1.persistentPreference.status, "accumulating");
  assert.equal(model1.persistentPreference.primaryPath, null);

  const day2 = closingPayload(persistentBoardRows("882"), "2026-08-25", "2026-08-24");
  const model2 = buildTradingStylePreference(day2, {
    previousPayload: day1,
    outcomeRows: styleOutcomeRows(model1, "2026-08-25", 3),
  });
  attachPreference(day2, model2);
  assert.equal(model2.persistence.history.length, 1);
  assert.equal(model2.persistentPreference.primaryPath, null, "一个T+1窗口不能确认持续偏好");

  const day3 = closingPayload(persistentBoardRows("883"), "2026-08-26", "2026-08-25");
  const model3 = buildTradingStylePreference(day3, {
    previousPayload: day2,
    outcomeRows: styleOutcomeRows(model2, "2026-08-26", 2.5),
  });
  attachPreference(day3, model3);
  assert.equal(model3.persistence.history.length, 2);
  assert.equal(model3.persistentPreference.primaryPath, null);

  const day4 = closingPayload(persistentBoardRows("884"), "2026-08-27", "2026-08-26");
  const model4 = buildTradingStylePreference(day4, {
    previousPayload: day3,
    outcomeRows: styleOutcomeRows(model3, "2026-08-27", 2),
  });
  assert.equal(model4.persistence.history.length, 3);
  assert.equal(model4.persistentPreference.status, "confirmed");
  assert.equal(model4.persistentPreference.primaryPath.key, "boardEmotion");
  assert.equal(model4.persistentPreference.paths.boardEmotion.totalMatchedSamples >= 15, true);
  assert.equal(model4.persistentDirectionPermission.activePaths.includes("boardEmotion"), true);
});

test("单日T+1负反馈只作风险观察，连续亏钱窗口才确认风格亏钱效应", () => {
  const day1 = closingPayload(persistentBoardRows("891"), "2026-08-24", "2026-08-21");
  const model1 = buildTradingStylePreference(day1);
  attachPreference(day1, model1);

  const day2 = closingPayload(persistentBoardRows("892"), "2026-08-25", "2026-08-24");
  const model2 = buildTradingStylePreference(day2, {
    previousPayload: day1,
    outcomeRows: styleOutcomeRows(model1, "2026-08-25", -6),
  });
  attachPreference(day2, model2);
  assert.equal(model2.lossEffect.status, "insufficient");
  assert.equal(model2.lossEffect.paths.length, 0);
  assert.equal(model2.lossEffect.latestRiskObservations.some((row) => row.key === "boardEmotion"), true);

  const day3 = closingPayload(persistentBoardRows("893"), "2026-08-26", "2026-08-25");
  const model3 = buildTradingStylePreference(day3, {
    previousPayload: day2,
    outcomeRows: styleOutcomeRows(model2, "2026-08-26", -5.5),
  });
  attachPreference(day3, model3);

  const day4 = closingPayload(persistentBoardRows("894"), "2026-08-27", "2026-08-26");
  const model4 = buildTradingStylePreference(day4, {
    previousPayload: day3,
    outcomeRows: styleOutcomeRows(model3, "2026-08-27", -5),
  });
  assert.equal(model4.lossEffect.status, "confirmed");
  assert.equal(model4.lossEffect.paths.some((row) => row.key === "boardEmotion" && row.persistentLoss), true);
  assert.match(model4.lossEffect.headline, /持续T\+1亏钱效应/);
});

test("冻结样本跌出次日Hot榜仍可由outcome-only报价结算，覆盖不足则失败关闭", () => {
  const previous = closingPayload(persistentBoardRows("901"), "2026-08-24", "2026-08-21");
  const previousModel = buildTradingStylePreference(previous);
  attachPreference(previous, previousModel);
  const current = closingPayload([], "2026-08-25", "2026-08-24");
  const allOutcomes = styleOutcomeRows(previousModel, "2026-08-25", 2);
  const complete = buildTradingStylePreference(current, { previousPayload: previous, outcomeRows: allOutcomes });
  assert.equal(complete.persistence.history[0].paths.boardEmotion.status, "usable");
  assert.equal(complete.persistence.history[0].paths.boardEmotion.coveragePct, 100);

  const incomplete = buildTradingStylePreference(current, { previousPayload: previous, outcomeRows: allOutcomes.slice(0, 3) });
  assert.equal(incomplete.persistence.history[0].paths.boardEmotion.status, "insufficient");
  assert.equal(incomplete.persistence.history[0].paths.boardEmotion.coveragePct < 80, true);
});

test("盘中和规则签名不一致都不能推进正式持续偏好", () => {
  const previous = closingPayload(persistentBoardRows("911"), "2026-08-24", "2026-08-21");
  const previousModel = buildTradingStylePreference(previous);
  attachPreference(previous, previousModel);
  const intraday = closingPayload(persistentBoardRows("912"), "2026-08-25", "2026-08-24");
  intraday.decisionBasis.snapshotKind = "intraday";
  intraday.archiveMeta.snapshotKind = "intraday";
  const intradayModel = buildTradingStylePreference(intraday, {
    previousPayload: previous,
    outcomeRows: styleOutcomeRows(previousModel, "2026-08-25", 3),
  });
  assert.equal(intradayModel.persistence.history.length, 0);

  previous.premarketModels.tradingStylePreference.pathCohorts.ruleSignature = "different-rules";
  const current = closingPayload(persistentBoardRows("913"), "2026-08-25", "2026-08-24");
  const mismatch = buildTradingStylePreference(current, {
    previousPayload: previous,
    outcomeRows: styleOutcomeRows(previousModel, "2026-08-25", 3),
  });
  assert.equal(mismatch.persistence.history.length, 0);
  assert.equal(mismatch.persistentPreference.status, "accumulating");
});
