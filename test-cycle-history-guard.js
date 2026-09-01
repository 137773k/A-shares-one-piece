"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "a-share-cycle-guard-"));
process.env.A_SHARE_RUNTIME_DIR = runtimeDir;

const {
  loadPrevArchive,
  marketSnapshotTradingDate,
  marketSnapshotKind,
  isAfterMarketClose,
  thsLimitPayloadTradingDate,
  applyShockAwareCycleTransition,
  classifyShockRepair,
  classifyMarket,
  classifyChaosDivergence,
  buildSurvivorBoard,
  buildTomorrowOutlook,
} = require("./server")._internals;

const historyDir = path.join(runtimeDir, "data", "history");
fs.mkdirSync(historyDir, { recursive: true });

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function snapshot(date, fetchedAt, archiveKind = "closing") {
  return {
    fetchedAt,
    stale: false,
    fetchError: null,
    fetchStatus: { level: "ok" },
    archiveMeta: { tradingDate: date, snapshotKind: archiveKind },
    market: {
      snapshot: {
        avgIndexChange: 0.55,
        breadth: 0.58,
        shszAmountYi: 27021,
        upCount: 3000,
        downCount: 1900,
      },
      limitStats: { ztToday: 120, dtToday: 20, dates: { today: date.replace(/-/g, "") } },
      state: { cycle: "震荡", structuralCycle: "震荡" },
    },
  };
}

try {
  writeJson(path.join(historyDir, "index.json"), [
    { date: "2026-07-17" },
    { date: "2026-07-21" },
  ]);
  writeJson(
    path.join(historyDir, "2026-07-21.json"),
    snapshot("2026-07-21", "2026-07-21T07:10:00.000Z"),
  );

  const exact = loadPrevArchive("2026-07-22", {
    expectedDate: "2026-07-21",
    requireExact: true,
  });
  assert(exact, "真正上一交易日的收盘快照应被读取");
  assert.strictEqual(exact.date, "2026-07-21");
  assert.strictEqual(exact.fresh, true);

  const exactFile = path.join(historyDir, "2026-07-21.json");
  const invalidExactCases = [
    { label: "partial", apply(value) { value.fetchStatus.level = "partial"; } },
    { label: "stale", apply(value) { value.stale = true; } },
    { label: "fetch-error", apply(value) { value.fetchError = "fixture upstream timeout"; } },
  ];
  for (const invalidCase of invalidExactCases) {
    const candidate = snapshot("2026-07-21", "2026-07-21T07:10:00.000Z");
    invalidCase.apply(candidate);
    writeJson(exactFile, candidate);
    const originalBytes = fs.readFileSync(exactFile);
    assert.strictEqual(
      loadPrevArchive("2026-07-22", { expectedDate: "2026-07-21", requireExact: true }),
      null,
      `${invalidCase.label} 快照不能作为 exact 证据`,
    );
    assert.deepStrictEqual(
      fs.readFileSync(exactFile),
      originalBytes,
      `${invalidCase.label} 拒绝路径不得改写原归档`,
    );
  }
  writeJson(exactFile, snapshot("2026-07-21", "2026-07-21T07:10:00.000Z"));

  const missingExact = loadPrevArchive("2026-07-22", {
    expectedDate: "2026-07-20",
    requireExact: true,
  });
  assert.strictEqual(missingExact, null, "缺少T-1时不能退回更早归档");

  writeJson(
    path.join(historyDir, "2026-07-21.json"),
    snapshot("2026-07-21", "2026-07-21T06:00:00.000Z", "intraday"),
  );
  assert.strictEqual(
    loadPrevArchive("2026-07-22", { expectedDate: "2026-07-21", requireExact: true }),
    null,
    "盘中快照不能充当上一交易日收盘归档",
  );

  const closingPayload = snapshot("2026-07-21", "2026-07-21T07:10:00.000Z");
  const intradayPayload = snapshot("2026-07-21", "2026-07-21T06:59:00.000Z", "intraday");
  assert.strictEqual(marketSnapshotKind(closingPayload), "closing");
  assert.strictEqual(marketSnapshotKind(intradayPayload), "intraday");
  assert.strictEqual(marketSnapshotTradingDate({}), "");
  assert.strictEqual(marketSnapshotKind({}, "2026-07-21"), "unknown");
  assert.strictEqual(
    marketSnapshotKind({ archiveMeta: { snapshotKind: "intraday" } }, "2026-07-21"),
    "intraday",
  );
  assert.strictEqual(isAfterMarketClose(new Date("2026-07-22T07:00:00.000Z")), true);
  assert.strictEqual(isAfterMarketClose(new Date("2026-07-22T06:59:00.000Z")), false);

  const thsPayload = {
    date: "20260721",
    limit_up_count: { today: { num: 80, history_num: 90 } },
    limit_down_count: { today: { num: 6, history_num: 12 } },
  };
  assert.strictEqual(thsLimitPayloadTradingDate(thsPayload, "20260721"), "20260721");
  assert.strictEqual(thsLimitPayloadTradingDate(thsPayload, "20260720"), "");
  assert.strictEqual(thsLimitPayloadTradingDate({ ...thsPayload, date: "" }, "20260721"), "");

  const archiveFallbackRepair = classifyShockRepair(
    { breadth: 0.42, avgIndexChange: -0.2 },
    { ztToday: 44, dtToday: 7, ztPrev: null, dtPrev: null },
    { market: { limitStats: { ztToday: 48, dtToday: 18 } } },
  );
  assert.strictEqual(archiveFallbackRepair.previousSource, "archive");
  assert(archiveFallbackRepair.signals.some((item) => item.note.includes("18→7")));

  const noFalseRepair = classifyShockRepair(
    { breadth: 0.5, avgIndexChange: 0.1 },
    { ztToday: 50, dtToday: 15, ztPrev: 45, dtPrev: 5 },
    null,
  );
  assert.strictEqual(
    noFalseRepair.signals.find((item) => item.name === "跌停显著缩减").ok,
    false,
    "跌停5→15是扩散，不能被“绝对值≤15”误判为显著缩减",
  );

  writeJson(
    path.join(historyDir, "2026-07-21.json"),
    snapshot("2026-07-21", "2026-07-21T07:10:00.000Z"),
  );
  writeJson(path.join(runtimeDir, ".cycle-state.json"), {
    cycle: "震荡",
    structuralCycle: "震荡",
    date: "20260721",
    shockTransition: null,
  });
  const currentMarketSnapshot = {
    avgIndexChange: -1.53,
    breadth: 0.2845,
    shszAmountYi: 26533,
    upCount: 1465,
    downCount: 3684,
  };
  const currentHotConcepts = [{ name: "存储芯片", limitCount: 5, resonance: true, score: 80 }];
  const currentLimitStats = {
    ztToday: 46,
    ztPrev: 120,
    ztPrev2: 52,
    dtToday: 8,
    dtPrev: 20,
    dates: { today: "20260722", prev: "20260721", prev2: "20260720", verified: true },
  };
  const currentCandidates = [
    { name: "主动核心", active: true, initiativeScore: 80, changePct: 3.2 },
  ];

  writeJson(path.join(historyDir, "2026-07-21.json"), {
    fetchedAt: "2026-07-21T07:10:00.000Z",
    stale: false,
    fetchError: null,
    fetchStatus: { level: "ok" },
    archiveMeta: { tradingDate: "2026-07-21", snapshotKind: "closing" },
    market: {
      snapshot: { avgIndexChange: -0.2, breadth: 0.46, shszAmountYi: 22000 },
      limitStats: { dates: { today: "20260721" } },
      state: { cycle: "混沌", structuralCycle: "混沌" },
    },
  });
  writeJson(path.join(runtimeDir, ".cycle-state.json"), {
    cycle: "混沌",
    structuralCycle: "混沌",
    date: "20260721",
    shockTransition: null,
  });
  const incompletePrevious = classifyMarket(
    { avgIndexChange: 0.9, breadth: 0.64, shszAmountYi: 24000, upCount: 3200, downCount: 1600 },
    [{ name: "AI算力", limitCount: 10, resonance: true, score: 120 }],
    null,
    {
      ztToday: 78,
      ztPrev: 44,
      dtToday: 3,
      dtPrev: 12,
      dates: { today: "20260722", prev: "20260721", prev2: "20260720", verified: true },
    },
    { candidates: [{ name: "主动核心", active: true, initiativeScore: 90, changePct: 6.5 }] },
  );
  assert.strictEqual(incompletePrevious.cycle, "混沌");
  assert.strictEqual(incompletePrevious.dataQuality.previousArchiveFresh, true);
  assert.strictEqual(incompletePrevious.dataQuality.comparisonInputsAvailable, false);
  assert.strictEqual(incompletePrevious.dataQuality.structuralTransitionReady, false);

  writeJson(
    path.join(historyDir, "2026-07-21.json"),
    snapshot("2026-07-21", "2026-07-21T07:10:00.000Z"),
  );
  writeJson(path.join(runtimeDir, ".cycle-state.json"), {
    cycle: "震荡",
    structuralCycle: "震荡",
    date: "20260721",
    shockTransition: null,
  });
  const integrated = classifyMarket(
    currentMarketSnapshot,
    currentHotConcepts,
    null,
    currentLimitStats,
    { candidates: currentCandidates },
  );
  assert.strictEqual(integrated.cycle, "震荡", "单日冰点观测必须先经过退潮过渡，不能跳级覆盖已确认的震荡大周期");
  assert.strictEqual(integrated.dailyState.key, "healthy_divergence");
  assert.strictEqual(integrated.dataQuality.previousArchiveFresh, true);
  assert.notStrictEqual(integrated.operation, "防守");
  const chaosHealthyState = { ...integrated, cycle: "混沌", structuralCycle: "混沌" };
  const healthyDivergence = classifyChaosDivergence(
    chaosHealthyState,
    currentLimitStats,
    currentMarketSnapshot,
    currentCandidates,
  );
  assert.strictEqual(healthyDivergence.level, "健康分化");
  assert.strictEqual(healthyDivergence.blockTomorrowReflow, false);
  assert(healthyDivergence.evidence.some((item) => item.includes("20→8")));
  assert(!healthyDivergence.evidence.some((item) => item.includes("负反馈偏强")));

  const healthySurvivors = buildSurvivorBoard(
    currentHotConcepts,
    currentCandidates,
    chaosHealthyState,
    currentLimitStats,
  );
  assert.strictEqual(healthySurvivors.divergenceDay, false);
  assert(healthySurvivors.envNote.includes("健康分化"));

  writeJson(path.join(historyDir, "2026-07-21.json"), {
    archiveMeta: { tradingDate: "2026-07-21", snapshotKind: "intraday" },
    market: {
      limitStats: { ztToday: 120, dtToday: 20, dates: { today: "20260721" } },
      state: { cycle: "震荡", structuralCycle: "震荡" },
    },
  });
  assert.strictEqual(
    loadPrevArchive("2026-07-22", { expectedDate: "2026-07-21", requireExact: true }),
    null,
    "显式盘中归档缺时间戳时也不能绕过收盘校验",
  );
  const unverified = classifyMarket(
    currentMarketSnapshot,
    currentHotConcepts,
    null,
    currentLimitStats,
    { candidates: currentCandidates },
  );
  assert.strictEqual(unverified.cycle, "震荡");
  assert.strictEqual(unverified.dataQuality.grade, "unverified");
  assert.strictEqual(unverified.dataQuality.previousTradingDayAvailable, false);
  assert.strictEqual(unverified.dataQuality.comparisonInputsAvailable, true);
  assert(unverified.dailyState.confidence <= 65);

  const healthyOutlook = buildTomorrowOutlook(
    currentCandidates,
    chaosHealthyState,
    currentLimitStats,
    currentMarketSnapshot,
    { items: [] },
  );
  assert.strictEqual(healthyOutlook.bias, "均衡");
  assert.strictEqual(healthyOutlook.prevArchiveDate, null, "盘中T-1不可用时不得回退到7月17日旧归档");
  assert.strictEqual(healthyOutlook.scenarios.length, 2);
  assert(healthyOutlook.scenarios[0].name.includes("承接加强"));
  assert(healthyOutlook.scenarios[1].name.includes("兑现扩大"));
  assert(healthyOutlook.signals.some((item) => item.note.includes("20 → 8")));
  assert(!JSON.stringify(healthyOutlook).includes("192 → 8"));
  assert(!healthyOutlook.biasNote.includes("默认分歧延续"));

  const trueRetreatDivergence = classifyChaosDivergence(
    {
      cycle: "混沌",
      dailyState: {
        key: "retreat_candidate",
        summary: "赚钱效应坍缩且负反馈扩散",
        reasons: ["跌停8→28，负反馈明显扩散", "涨停60→18，赚钱效应坍缩"],
      },
    },
    { ztToday: 18, ztPrev: 60, dtToday: 28, dtPrev: 8 },
    { avgIndexChange: -1.8, breadth: 0.2 },
    [],
  );
  assert.strictEqual(trueRetreatDivergence.blockTomorrowReflow, true, "真正的退潮候选仍必须保留防守闸门");

  writeJson(path.join(runtimeDir, ".cycle-state.json"), {
    cycle: "主升",
    structuralCycle: "主升",
    date: "20260721",
    shockTransition: null,
  });
  const missingData = classifyMarket({}, [], null, {
    dates: { today: "20260722", prev: "20260721", verified: false },
  });
  assert.strictEqual(missingData.dailyState.key, "data_insufficient");
  assert.strictEqual(missingData.operation, "等待数据");
  assert.strictEqual(missingData.position, "0%");
  assert.deepStrictEqual(missingData.allowSetups, []);

  writeJson(path.join(runtimeDir, ".cycle-state.json"), {
    cycle: "混沌",
    structuralCycle: "混沌",
    date: "20260721",
    shockTransition: null,
  });
  const noFalseShock = applyShockAwareCycleTransition("退潮", "20260722", {
    afterClose: true,
    snapshot: { avgIndexChange: -1.5, breadth: null },
    limitStats: {
      ztToday: 20,
      ztPrev: 80,
      dtToday: null,
      dates: { today: "20260722", prev: "20260721", verified: false },
    },
    structuralCycleHint: "混沌",
    marketEffects: { dailyState: { key: "retreat_candidate" } },
  });
  assert.strictEqual(noFalseShock.shockTransition, null, "缺市场广度时不能误建退潮级冲击");

  writeJson(path.join(runtimeDir, ".cycle-state.json"), {
    cycle: "混沌",
    structuralCycle: "混沌",
    date: "20260717",
    shockTransition: {
      active: true,
      startedOn: "20260717",
      baseCycle: "混沌",
      stage: "待次日验证",
    },
  });
  const expired = applyShockAwareCycleTransition("混沌", "20260722", {
    afterClose: true,
    limitStats: {
      ztToday: 46,
      ztPrev: 120,
      dtToday: 8,
      dtPrev: 20,
      dates: { today: "20260722", prev: "20260721", verified: true },
    },
    snapshot: { avgIndexChange: -1.53, breadth: 0.2845 },
    structuralCycleHint: "混沌",
    marketEffects: { dailyState: { key: "healthy_divergence" } },
  });
  assert.strictEqual(expired.cycle, "混沌");
  assert.strictEqual(expired.shockTransition.active, false);
  assert.strictEqual(expired.shockTransition.stage, "验证过期");

  writeJson(path.join(runtimeDir, ".cycle-state.json"), {
    cycle: "混沌",
    structuralCycle: "混沌",
    date: "20260717",
    shockTransition: {
      active: true,
      startedOn: "20260717",
      baseCycle: "混沌",
      stage: "待次日验证",
    },
  });
  const expiredWithoutCalendar = applyShockAwareCycleTransition("混沌", "20260722", {
    afterClose: true,
    limitStats: {
      ztToday: 46,
      ztPrev: 120,
      dtToday: 8,
      dtPrev: 20,
      dates: { today: "20260722", prev: "20260721", verified: false },
    },
    snapshot: { avgIndexChange: -1.53, breadth: 0.2845 },
    structuralCycleHint: "混沌",
    marketEffects: { dailyState: { key: "healthy_divergence" } },
  });
  assert.strictEqual(expiredWithoutCalendar.shockTransition.active, false);
  assert.strictEqual(expiredWithoutCalendar.shockTransition.stage, "验证过期");

  console.log("cycle history guard tests passed");
} finally {
  fs.rmSync(runtimeDir, { recursive: true, force: true });
}
