"use strict";

const assert = require("assert");
const {
  THEME_LIBRARY_CLASSIFIER_VERSION,
  buildThemeLibrarySnapshot,
  compareThemeLibrarySnapshots,
  isLikelyLimitUp,
  isVerifiedPioneer,
  normalizeTradingDate,
  themeLibraryTradingDate,
} = require("./theme-library");
const { isMedicalThemeName } = require("./theme-taxonomy");

function initiative(time, followers = 2, extra = {}) {
  return {
    proactive: true,
    dataQuality: "分时验证",
    firstAttackTime: time,
    followerCount: followers,
    breadthLift: 1,
    score: 80,
    priceDiscovery: { noPriceDiscovery: false },
    ...extra,
  };
}

function hasRoleKind(stock, roleKind) {
  return Array.isArray(stock && stock.roleKinds) && stock.roleKinds.includes(roleKind);
}

function fixture() {
  const candidates = [
    {
      code: "000001",
      name: "核心龙头",
      mainFamily: "算力",
      concepts: ["算力", "CPO"],
      role: "龙头",
      roleReason: "题材内核心地位第一",
      themeAttribution: { verified: true, selectionEligible: true, primaryThemeName: "算力", conflict: false },
      score: 99,
      changePct: 10,
      amountYi: 88,
      leadership: {
        levelLabel: "主线主动龙头",
        cycleIdentity: {
          cycleInstanceId: "main_rise:fixture-core-1",
          state: "confirmed",
          identityEstablished: true,
          activePrimary: true,
          confirmedTradingDates: ["2026-08-05", "2026-08-06"],
        },
        structure: { frameworkIntact: true, breakdown: false },
        initiative: initiative("09:35", 5),
      },
    },
    {
      code: "000002",
      name: "启动先锋",
      mainConcept: "CPO",
      concepts: ["CPO"],
      role: "后排观察",
      score: 82,
      changePct: 7.2,
      amountYi: 31,
      leadership: { initiative: initiative("09:31", 7) },
    },
    {
      code: "000003",
      name: "容量中军",
      mainFamily: "算力",
      concepts: ["算力"],
      role: "中军",
      score: 90,
      changePct: 5.4,
      amountYi: 160,
      leadership: { initiative: { proactive: false, dataQuality: "收盘代理", score: 50 } },
    },
    {
      code: "000004",
      name: "低位补涨",
      mainFamily: "算力",
      concepts: ["算力"],
      role: "补涨",
      setup: "低位首板",
      score: 75,
      changePct: 10,
      amountYi: 12,
    },
    {
      code: "000005",
      name: "普通后排",
      mainFamily: "算力",
      concepts: ["算力"],
      role: "后排观察",
      score: 70,
      changePct: 3,
      amountYi: 8,
    },
  ];
  return {
    fetchedAt: "2026-08-09T03:47:31.356Z",
    market: { limitStats: { dates: { today: "20260807", prev: "20260806" } } },
    topicBoard: {
      mainLine: { name: "算力", family: "算力" },
      items: [{
        name: "算力",
        family: "算力",
        aliases: ["CPO"],
        matchNames: ["算力", "CPO"],
        displayName: "算力（含CPO）",
        label: "主线持续",
        score: 320,
        count: 12,
        limitCount: 3,
        resonance: true,
        resonanceLabel: "绝对共振",
        leader: candidates[0],
        leaders: [candidates[0]],
        zhongjun: candidates[2],
        lowLevel: candidates[3],
      }],
    },
    candidates,
  };
}

(function testTradingDateUsesProviderDate() {
  const payload = fixture();
  assert.strictEqual(themeLibraryTradingDate(payload), "2026-08-07");
  payload.archiveMeta = { tradingDate: "2026-07-12" };
  payload.market.limitStats.dates.today = "20260710";
  assert.strictEqual(themeLibraryTradingDate(payload), "2026-07-10");
  assert.strictEqual(normalizeTradingDate("2026-02-31"), "");
})();

(function testUnverifiedPreviousDateIsNotUsedForComparison() {
  const payload = fixture();
  payload.market.limitStats.dates.verified = false;
  const snapshot = buildThemeLibrarySnapshot(payload);
  assert.strictEqual(snapshot.previousTradingDate, null);
  assert.strictEqual(snapshot.previousDateVerified, false);
})();

(function testSnapshotCarriesExactGenerationIdentity() {
  const generatedAt = "2026-08-07T07:10:00.000Z";
  const snapshot = buildThemeLibrarySnapshot(fixture(), { generatedAt });
  assert.strictEqual(snapshot.generatedAt, generatedAt);
  assert.strictEqual(snapshot.generationId, `2026-08-07:${generatedAt}`);
  const crossShanghaiDate = buildThemeLibrarySnapshot(fixture(), { generatedAt: "2026-08-07T16:30:00.000Z" });
  assert.strictEqual(crossShanghaiDate.generationId, null);
})();

(function testRoleTagsAndPioneer() {
  const snapshot = buildThemeLibrarySnapshot(fixture(), { sourceMode: "captured" });
  assert.strictEqual(snapshot.tradingDate, "2026-08-07");
  assert.strictEqual(snapshot.themeCount, 1);
  const theme = snapshot.themes[0];
  const byCode = new Map(theme.stocks.map((stock) => [stock.code, stock]));
  assert.deepStrictEqual(byCode.get("000001").tags.map((tag) => tag.label), ["龙头"]);
  assert.deepStrictEqual(byCode.get("000002").tags.map((tag) => tag.label), ["先锋"]);
  assert.deepStrictEqual(byCode.get("000003").tags.map((tag) => tag.label), ["中军"]);
  assert.strictEqual(byCode.has("000004"), false, "当日涨停补涨必须只进入独立的当日高度池");
  assert.ok(theme.dailyHeightStocks.some((stock) => stock.code === "000004"));
  assert.strictEqual(byCode.has("000005"), false, "普通后排不应进入精简题材库");
})();

(function testLeaderMayAlsoBePioneerWithoutDuplicatingStock() {
  const payload = fixture();
  payload.candidates[1].leadership.initiative.dataQuality = "收盘代理";
  const snapshot = buildThemeLibrarySnapshot(payload);
  const leader = snapshot.themes[0].stocks.find((stock) => stock.code === "000001");
  assert.deepStrictEqual(leader.tags.map((tag) => tag.label), ["龙头", "先锋"]);
  assert.strictEqual(snapshot.themes[0].stocks.filter((stock) => stock.code === "000001").length, 1);
})();

(function testUnverifiedPioneerRejected() {
  assert.strictEqual(isVerifiedPioneer({ leadership: { initiative: initiative("09:30", 3) } }), true);
  assert.strictEqual(isVerifiedPioneer({ leadership: { initiative: initiative("09:30", 3, { dataQuality: "收盘代理" }) } }), false);
  assert.strictEqual(isVerifiedPioneer({ leadership: { initiative: initiative("09:30", 0, { breadthLift: 0 }) } }), false);
  assert.strictEqual(isVerifiedPioneer({ leadership: { initiative: initiative("09:30", 3, { priceDiscovery: { noPriceDiscovery: true } }) } }), false);
})();

(function testLimitUpTagUsesBoardRulesAndExcludesNewListings() {
  assert.strictEqual(isLikelyLimitUp({ code: "600001", name: "主板票", changePct: 10 }), true);
  assert.strictEqual(isLikelyLimitUp({ code: "300001", name: "创业板票", changePct: 10 }), false);
  assert.strictEqual(isLikelyLimitUp({ code: "300001", name: "创业板票", changePct: 20 }), true);
  assert.strictEqual(isLikelyLimitUp({ code: "001232", name: "N新股", changePct: 131.97, leadership: { structure: { isNewListing: true } } }), false);
})();

(function testLowLevelObservationIsNotCatchup() {
  const payload = fixture();
  payload.candidates[3].role = "后排观察";
  payload.candidates[3].setup = "趋势观察";
  payload.topicBoard.items[0].lowLevel = payload.candidates[3];
  const snapshot = buildThemeLibrarySnapshot(payload);
  assert.strictEqual(snapshot.themes[0].stocks.some((stock) => stock.code === "000004"), false);
})();

(function testComparisonRequiresExactPreviousSnapshot() {
  const current = buildThemeLibrarySnapshot(fixture());
  const previousPayload = fixture();
  previousPayload.market.limitStats.dates.today = "20260806";
  previousPayload.topicBoard.items[0].rank = 2;
  const previous = buildThemeLibrarySnapshot(previousPayload);
  previous.themes[0].rank = 2;
  const comparison = compareThemeLibrarySnapshots(current, previous);
  assert.strictEqual(comparison.previousDate, "2026-08-06");
  assert.deepStrictEqual(comparison.continuedThemes, ["算力"]);
  assert.strictEqual(comparison.themeChanges[0].rankChange, 1);
  previous.themes[0].stocks = previous.themes[0].stocks.filter((stock) => stock.code !== "000002");
  previous.themes[0].stocks.push({ code: "000099", tags: [{ label: "龙头" }] });
  const membershipComparison = compareThemeLibrarySnapshots(current, previous);
  assert.strictEqual(membershipComparison.themeChanges[0].roleChanges.some((change) => change.code === "000002" && change.type === "entered"), true);
  assert.strictEqual(membershipComparison.themeChanges[0].roleChanges.some((change) => change.code === "000099" && change.type === "exited"), true);
  const withoutPrevious = compareThemeLibrarySnapshots(current, null);
  assert.strictEqual(withoutPrevious.exactPreviousAvailable, false);
})();

function medicalFixture(reverseMedicalTopics = false) {
  const hayao = {
    code: "600664",
    name: "哈药股份",
    mainConcept: "流感",
    concepts: ["流感", "医药电商"],
    role: "龙头",
    score: 149.45,
    combinedRank: 2,
    inBothSources: true,
    popularity: "首板涨停",
    changePct: 9.97,
    amountYi: 18.1,
    floatMarketValue: 172e8,
    klineProfile: {
      wave: "三波/高位趋势",
      rise20: 103,
      rise30: 133.4,
      nearHigh20: true,
      ma5: 6.45,
      ma10: 6.05,
      ma20: 5.58,
    },
    leadership: {
      coreIdentityQualified: true,
      persistentRecognition: true,
      impactScore: 52,
      structure: { frameworkIntact: true, breakdown: false },
      history: {
        appearances: 3,
        coreHits: 2,
        activeHits: 2,
        cycleInstanceId: "main_rise:medical-fixture-1",
        records: [
          { tradingDate: "2026-08-05", cycleInstanceId: "main_rise:medical-fixture-1", impactVerified: true },
          { tradingDate: "2026-08-06", cycleInstanceId: "main_rise:medical-fixture-1", impactVerified: true },
          { tradingDate: "2026-08-07", cycleInstanceId: "main_rise:medical-fixture-1", impactVerified: true },
        ],
      },
      initiative: {},
    },
  };
  const baihua = {
    code: "600721",
    name: "百花医药",
    mainConcept: "肝炎概念",
    concepts: ["肝炎概念", "青蒿素"],
    role: "龙头",
    score: 129.07,
    combinedRank: 3,
    popularity: "4天4板",
    changePct: 10.02,
    amountYi: 6.3,
    floatMarketValue: 41e8,
    klineProfile: {
      wave: "三波/高位趋势",
      rise20: 55,
      rise30: 62.2,
      nearHigh20: true,
      newHigh: true,
      ma5: 8.79,
      ma10: 7.9,
      ma20: 7.52,
    },
    leadership: { persistentRecognition: false, history: { appearances: 1 }, initiative: {} },
  };
  const zhaoyan = {
    code: "603127",
    name: "昭衍新药",
    mainConcept: "CRO概念",
    concepts: ["CRO概念", "细胞免疫治疗"],
    role: "龙头",
    score: 999,
    combinedRank: 12,
    popularity: "首板涨停",
    changePct: 10.01,
    amountYi: 28.9,
    floatMarketValue: 319e8,
    klineProfile: {
      wave: "趋势一波",
      rise20: 17.7,
      rise30: 37.7,
      nearHigh20: false,
      ma5: 45.77,
      ma10: 44.97,
      ma20: 46.42,
    },
    leadership: { persistentRecognition: false, history: { appearances: 0 }, initiative: {} },
  };
  const wuxi = {
    code: "603259",
    name: "药明康德",
    mainConcept: "CRO概念",
    concepts: ["CRO概念", "创新药"],
    role: "中军",
    score: 157.93,
    combinedRank: 1,
    changePct: 8.49,
    amountYi: 139.6,
    floatMarketValue: 3829e8,
    leadership: { persistentRecognition: true, history: { appearances: 3 }, initiative: {} },
  };
  const pesticide = {
    code: "000525",
    name: "农药样本",
    mainConcept: "农药",
    concepts: ["农药"],
    role: "龙头",
    score: 88,
    changePct: 10,
  };
  const pcb = {
    code: "002463",
    name: "PCB样本",
    mainConcept: "PCB概念",
    concepts: ["PCB概念"],
    role: "龙头",
    score: 80,
    changePct: 10,
  };
  const medicalTopics = [
    { name: "CRO概念", family: "CRO概念", aliases: ["创新药", "减肥药"], matchNames: ["CRO概念", "创新药", "减肥药"], score: 168, count: 2, limitCount: 1, leader: zhaoyan, leaders: [zhaoyan], zhongjun: wuxi },
    { name: "流感", family: "流感", score: 97, count: 1, limitCount: 1, leader: hayao, leaders: [hayao] },
    { name: "肝炎概念", family: "肝炎概念", aliases: ["青蒿素"], matchNames: ["肝炎概念", "青蒿素"], score: 96, count: 1, limitCount: 1, leader: baihua, leaders: [baihua] },
  ];
  if (reverseMedicalTopics) medicalTopics.reverse();
  return {
    fetchedAt: "2026-08-07T07:20:00.000Z",
    cycleContext: { cycleKey: "main_rise", cycleInstanceId: "main_rise:medical-fixture-1" },
    market: { limitStats: { dates: { today: "20260807", prev: "20260806", verified: true } } },
    topicBoard: {
      mainLine: { name: "流感", family: "流感" },
      items: [
        ...medicalTopics,
        { name: "农药", family: "农药", score: 95, count: 1, limitCount: 1, leader: pesticide, leaders: [pesticide] },
        { name: "PCB概念", family: "PCB概念", score: 90, count: 1, limitCount: 1, leader: pcb, leaders: [pcb] },
      ],
    },
    candidates: [hayao, baihua, zhaoyan, wuxi, pesticide, pcb],
  };
}

(function testMedicalFamilyMergeAndRoleReclassification() {
  const snapshot = buildThemeLibrarySnapshot(medicalFixture(), { maxThemes: 3 });
  assert.strictEqual(snapshot.classifierVersion, THEME_LIBRARY_CLASSIFIER_VERSION);
  assert.deepStrictEqual(snapshot.themes.map((theme) => theme.name), ["医药", "农药", "PCB概念"], "应先合并医药再截断题材数量");
  const medical = snapshot.themes[0];
  assert.strictEqual(medical.id, "医药");
  assert.strictEqual(medical.isMainLine, true, "子题材为主线时医药母题材仍应识别为主线");
  ["CRO概念", "创新药", "减肥药", "流感", "肝炎概念", "青蒿素", "医药电商", "细胞免疫治疗"].forEach((name) => {
    assert.strictEqual(medical.subthemes.includes(name), true, `应保留医药子题材 ${name}`);
  });
  const byCode = new Map(medical.stocks.map((stock) => [stock.code, stock]));
  assert.deepStrictEqual(byCode.get("600664").tags.map((tag) => tag.label), ["龙头"]);
  assert.deepStrictEqual(byCode.get("600664").roleStyles, ["趋势总龙"]);
  assert.strictEqual(hasRoleKind(byCode.get("600664"), "cycleLeader"), true, "跨日核心应输出 cycleLeader 角色类型");
  assert.deepStrictEqual(byCode.get("600664").subThemeTags, ["流感", "医药电商"]);
  assert.strictEqual(byCode.has("600721"), false, "连板高标不应混入题材结构核心股票");
  assert(Array.isArray(medical.dailyHeightStocks), "题材快照应单列 dailyHeightStocks");
  const dailyHeight = medical.dailyHeightStocks.find((stock) => stock.code === "600721");
  assert(dailyHeight, "连板高标应进入独立当日高度列表");
  assert.deepStrictEqual(dailyHeight.roleStyles, ["连板高标"]);
  assert.strictEqual(hasRoleKind(dailyHeight, "dailyHeight"), true);
  assert.strictEqual(hasRoleKind(dailyHeight, "cycleLeader"), false);
  assert.deepStrictEqual(byCode.get("603259").tags.map((tag) => tag.label), ["中军"]);
  assert.strictEqual(byCode.has("603127"), false, "昭衍即使旧选股分更高，也不应继承子题材龙头地位");

  const reversed = buildThemeLibrarySnapshot(medicalFixture(true), { maxThemes: 3 });
  const reversedMedical = reversed.themes.find((theme) => theme.name === "医药");
  assert.deepStrictEqual(
    reversedMedical.stocks.map((stock) => [stock.code, stock.tags.map((tag) => tag.label)]),
    medical.stocks.map((stock) => [stock.code, stock.tags.map((tag) => tag.label)]),
    "医药角色不应受旧子题材排列顺序影响",
  );
  assert.deepStrictEqual(
    reversedMedical.dailyHeightStocks.map((stock) => stock.code),
    medical.dailyHeightStocks.map((stock) => stock.code),
    "当日高度列表也不应受旧子题材排列顺序影响",
  );
})();

(function testMedicalTaxonomyUsesExactHumanPharmaAllowlist() {
  ["流感", "肝炎概念", "CRO概念", "创新药"].forEach((name) => assert.strictEqual(isMedicalThemeName(name), true));
  ["农药", "动物疫苗", "AI医疗", "生物质能"].forEach((name) => assert.strictEqual(isMedicalThemeName(name), false));
})();

(function testMedicalDailyHeightDoesNotBackfillMissingCycleLeader() {
  const payload = medicalFixture();
  const hayao = payload.candidates.find((stock) => stock.code === "600664");
  hayao.leadership.persistentRecognition = false;
  hayao.leadership.history.appearances = 0;
  hayao.klineProfile.rise20 = 20;
  const medical = buildThemeLibrarySnapshot(payload).themes.find((theme) => theme.name === "医药");
  const leaders = medical.stocks.filter((stock) => stock.tags.some((tag) => tag.label === "龙头"));
  assert.deepStrictEqual(leaders, [], "没有跨日周期核心时龙头应为空，不能拿当日高标补位");
  const dailyHeight = medical.dailyHeightStocks.find((stock) => stock.code === "600721");
  assert(dailyHeight, "当日高标仍应保留在独立观察列表");
  assert.strictEqual(dailyHeight.roleKinds.includes("dailyHeight"), true);
  assert.strictEqual(dailyHeight.roleKinds.includes("cycleLeader"), false);
})();

function anonymousCycleLeaderFixture() {
  const cycleInstanceId = "main_rise:fixture-cycle-1";
  const cycleLeader = {
    code: "FIXTURE_CYCLE_CORE",
    name: "周期核心样本",
    mainConcept: "创新药",
    concepts: ["创新药", "医药电商"],
    role: "龙头",
    score: 140,
    combinedRank: 4,
    changePct: 4.8,
    amountYi: 42,
    klineProfile: {
      wave: "三波/高位趋势",
      rise20: 88,
      rise30: 112,
      nearHigh20: true,
      ma5: 8.8,
      ma10: 8.2,
      ma20: 7.5,
    },
    leadership: {
      coreIdentityQualified: true,
      persistentRecognition: true,
      impactScore: 48,
      structure: { frameworkIntact: true, breakdown: false },
      history: {
        appearances: 3,
        coreHits: 2,
        activeHits: 2,
        cycleInstanceId,
        records: [
          { tradingDate: "2026-08-10", cycleInstanceId, impactVerified: true },
          { tradingDate: "2026-08-11", cycleInstanceId, impactVerified: true },
          { tradingDate: "2026-08-12", cycleInstanceId, impactVerified: true },
        ],
      },
      initiative: initiative("09:31", 5, { breadthLift: 3, score: 82 }),
    },
  };
  const newLimitUp = {
    code: "FIXTURE_NEW_LIMIT",
    name: "新首板样本",
    mainConcept: "创新药",
    concepts: ["创新药"],
    role: "龙头",
    score: 999,
    combinedRank: 1,
    popularity: "首板涨停",
    changePct: 10.02,
    amountYi: 30,
    klineProfile: { rise20: 12, rise30: 18, nearHigh20: false },
    leadership: {
      coreIdentityQualified: false,
      persistentRecognition: false,
      impactScore: 0,
      structure: { frameworkIntact: true, breakdown: false },
      history: {
        appearances: 1,
        coreHits: 0,
        activeHits: 0,
        cycleInstanceId,
        records: [{ tradingDate: "2026-08-13", cycleInstanceId, impactVerified: false }],
      },
      initiative: initiative("09:34", 1),
    },
  };
  const dailyHeight = {
    code: "FIXTURE_DAILY_HEIGHT",
    name: "当日高度样本",
    mainConcept: "创新药",
    concepts: ["创新药"],
    role: "龙头",
    score: 180,
    combinedRank: 2,
    popularity: "4天4板",
    changePct: 10.01,
    amountYi: 16,
    klineProfile: { rise20: 48, rise30: 55, nearHigh20: true },
    leadership: {
      coreIdentityQualified: false,
      persistentRecognition: false,
      impactScore: 0,
      structure: { frameworkIntact: true, breakdown: false },
      history: {
        appearances: 1,
        coreHits: 0,
        activeHits: 0,
        cycleInstanceId,
        records: [{ tradingDate: "2026-08-13", cycleInstanceId, impactVerified: false }],
      },
      initiative: { proactive: false, dataQuality: "分时验证", score: 62 },
    },
  };
  const dailyPioneer = {
    code: "FIXTURE_DAILY_PIONEER",
    name: "当日先锋样本",
    mainConcept: "创新药",
    concepts: ["创新药"],
    role: "后排观察",
    score: 120,
    combinedRank: 6,
    changePct: 6.2,
    amountYi: 25,
    leadership: {
      coreIdentityQualified: false,
      persistentRecognition: false,
      impactScore: 20,
      structure: { frameworkIntact: true, breakdown: false },
      history: { appearances: 0, coreHits: 0, activeHits: 0, cycleInstanceId, records: [] },
      initiative: initiative("09:33", 3, { breadthLift: 2 }),
    },
  };
  return {
    fetchedAt: "2026-08-13T07:20:00.000Z",
    cycleContext: { cycleKey: "main_rise", cycleInstanceId },
    market: { limitStats: { dates: { today: "20260813", prev: "20260812", verified: true } } },
    topicBoard: {
      mainLine: { name: "创新药", family: "创新药" },
      items: [{
        name: "创新药",
        family: "创新药",
        score: 220,
        count: 4,
        limitCount: 2,
        leader: dailyHeight,
        leaders: [dailyHeight, newLimitUp],
      }],
    },
    candidates: [cycleLeader, newLimitUp, dailyHeight, dailyPioneer],
  };
}

(function testCycleLeaderIdentityIsIndependentFromDailyHeightAndPioneer() {
  const payload = anonymousCycleLeaderFixture();
  const snapshot = buildThemeLibrarySnapshot(payload);
  const medical = snapshot.themes.find((theme) => theme.name === "医药");
  assert(medical, "创新药应归入医药母题材");
  const byCode = new Map(medical.stocks.map((stock) => [stock.code, stock]));
  const cycleLeader = byCode.get("FIXTURE_CYCLE_CORE");

  assert(cycleLeader, "结构完整且同周期跨日确认的周期龙头，当日未涨停也必须保留");
  assert.strictEqual(isLikelyLimitUp(payload.candidates[0]), false, "周期龙头身份不以当日涨停为前提");
  assert.strictEqual(hasRoleKind(cycleLeader, "cycleLeader"), true);
  assert.strictEqual(hasRoleKind(cycleLeader, "dailyPioneer"), true, "周期身份和当日先锋角色可以同时存在");
  assert.deepStrictEqual(cycleLeader.cycleIdentity, {
    cycleInstanceId: "main_rise:fixture-cycle-1",
    state: "retained",
    crossDayPersistent: true,
    identityEstablished: true,
    activePrimary: true,
    evidenceDates: ["2026-08-10", "2026-08-11", "2026-08-12"],
    executionEligible: false,
    membershipAuthority: null,
  });
  assert.deepStrictEqual(cycleLeader.todayState, {
    limitUp: false,
    dailyHeight: false,
    dailyPioneer: true,
  });
  assert.deepStrictEqual(
    medical.stocks.filter((stock) => Array.isArray(stock.roleKinds) && stock.roleKinds.includes("cycleLeader")).map((stock) => stock.code),
    ["FIXTURE_CYCLE_CORE"],
    "新单日涨停或当日高标不能替换已确认周期龙头",
  );
  assert.strictEqual(byCode.has("FIXTURE_NEW_LIMIT"), false, "无跨日影响的新首板只能进入当日高度观察，不得混入题材核心股票");
  assert.strictEqual(byCode.has("FIXTURE_DAILY_HEIGHT"), false, "未确认周期身份的当日高标不得冒充题材周期龙头");
  assert(Array.isArray(medical.dailyHeightStocks), "题材快照应单列 dailyHeightStocks");
  assert.deepStrictEqual(
    medical.dailyHeightStocks.map((stock) => stock.code),
    ["FIXTURE_DAILY_HEIGHT", "FIXTURE_NEW_LIMIT"],
  );
  medical.dailyHeightStocks.forEach((stock) => {
    assert.strictEqual(hasRoleKind(stock, "dailyHeight"), true);
    assert.strictEqual(hasRoleKind(stock, "cycleLeader"), false);
  });
  assert(Array.isArray(medical.dailyPioneerStocks), "题材快照应单列 dailyPioneerStocks");
  assert.deepStrictEqual(medical.dailyPioneerStocks.map((stock) => stock.code), ["FIXTURE_CYCLE_CORE"]);
})();

(function testDailyBoardDoesNotBackfillMissingCycleIdentity() {
  const payload = anonymousCycleLeaderFixture();
  const formerCore = payload.candidates.find((stock) => stock.code === "FIXTURE_CYCLE_CORE");
  formerCore.leadership.coreIdentityQualified = false;
  formerCore.leadership.persistentRecognition = false;
  formerCore.leadership.impactScore = 0;
  formerCore.leadership.history = { appearances: 0, coreHits: 0, activeHits: 0, records: [] };
  const snapshot = buildThemeLibrarySnapshot(payload);
  const medical = snapshot.themes.find((theme) => theme.name === "医药");
  assert(medical, "创新药应归入医药母题材");
  assert.deepStrictEqual(
    medical.stocks.filter((stock) => Array.isArray(stock.roleKinds) && stock.roleKinds.includes("cycleLeader")),
    [],
    "缺少同周期跨日历史时宁可没有周期龙头，也不能拿当日涨停或高标补位",
  );
  assert.strictEqual(
    medical.stocks.some((stock) => stock.tags.some((tag) => tag.label === "龙头")),
    false,
    "当日高度角色不得伪装成 theme.stocks 龙头",
  );
  assert(Array.isArray(medical.dailyHeightStocks), "题材快照应单列 dailyHeightStocks");
  assert.strictEqual(medical.dailyHeightStocks.length >= 2, true, "当日高度仍应留在独立观察列表");
})();

(function testDailyHeightWinsOverConflictingUpstreamStructureRoles() {
  const payload = anonymousCycleLeaderFixture();
  const cycleInstanceId = payload.cycleContext.cycleInstanceId;
  const conflictedHeight = {
    code: "FIXTURE_HEIGHT_ROLE_CONFLICT",
    name: "高度角色冲突样本",
    mainConcept: "创新药",
    concepts: ["创新药"],
    role: "补涨",
    setup: "高标补涨",
    score: 260,
    combinedRank: 1,
    popularity: "5天5板",
    changePct: 10.03,
    amountYi: 95,
    klineProfile: { rise20: 58, rise30: 72, nearHigh20: true },
    leadership: {
      coreIdentityQualified: false,
      persistentRecognition: false,
      impactScore: 0,
      structure: { frameworkIntact: true, breakdown: false },
      history: {
        appearances: 1,
        coreHits: 0,
        activeHits: 0,
        cycleInstanceId,
        records: [{ tradingDate: "2026-08-13", cycleInstanceId, impactVerified: false }],
      },
      initiative: initiative("09:30", 8, { breadthLift: 5, score: 96 }),
    },
  };
  payload.candidates.push(conflictedHeight);
  const themeSeed = payload.topicBoard.items[0];
  themeSeed.count += 1;
  themeSeed.limitCount += 1;
  themeSeed.zhongjun = conflictedHeight;

  const snapshot = buildThemeLibrarySnapshot(payload);
  const medical = snapshot.themes.find((theme) => theme.name === "医药");
  assert(medical, "创新药应归入医药母题材");
  const structuralCodes = new Set(medical.stocks.map((stock) => stock.code));
  const dailyHeightCodes = new Set(medical.dailyHeightStocks.map((stock) => stock.code));
  const conflictedDailyHeight = medical.dailyHeightStocks.find((stock) => stock.code === conflictedHeight.code);

  assert(conflictedDailyHeight, "同时被上游标为先锋、中军、补涨的真实当日高度也必须进入 dailyHeightStocks");
  assert.strictEqual(structuralCodes.has(conflictedHeight.code), false, "当日高度优先隔离，不得因上游结构角色进入 theme.stocks");
  assert.deepStrictEqual(conflictedDailyHeight.roleKinds, ["dailyHeight"], "角色冲突样本只保留当日高度角色");
  assert.strictEqual(
    Array.isArray(medical.dailyPioneerStocks)
      && medical.dailyPioneerStocks.some((stock) => stock.code === conflictedHeight.code),
    false,
    "当日高度不能再重复进入 dailyPioneerStocks",
  );
  assert.deepStrictEqual(
    [...structuralCodes].filter((code) => dailyHeightCodes.has(code)),
    [],
    "theme.stocks 与 dailyHeightStocks 的股票代码必须全量互斥",
  );
})();

(function exactSubthemeDecisionRequiresPureMembersAndTwoCloses() {
  const makeStock = (code, name, concepts, changePct, proactive = false) => ({
    code,
    name,
    mainFamily: concepts.some((item) => /流感|医药/.test(item)) ? "医药" : "AI算力",
    // 故意污染派生主概念，验证精确细分不能读取 mainConcept。
    mainConcept: "共封装光学(CPO)",
    concepts,
    changePct,
    popularity: changePct >= 9.8 ? "首板" : "",
    leadership: {
      initiative: proactive
        ? initiative("09:31", 3, { tradingDate: "2026-08-27" })
        : { proactive: false, dataQuality: "收盘代理", score: 30 },
    },
  });
  const winningCandidates = [
    makeStock("100001", "流感A", ["流感"], 10, true),
    makeStock("100002", "流感B", ["流感"], 8),
    makeStock("100003", "流感C", ["流感"], 6),
    makeStock("100004", "流感D", ["流感"], 2),
    makeStock("200001", "CPOA", ["共封装光学(CPO)"], -1, true),
    makeStock("200002", "CPOB", ["共封装光学(CPO)"], -2),
    makeStock("200003", "CPOC", ["共封装光学(CPO)"], 10),
    makeStock("200004", "CPOD", ["共封装光学(CPO)"], -3),
    makeStock("299999", "PCB污染样本", ["PCB概念"], 10),
  ];
  const topicBoard = {
    mainLine: { name: "AI算力", family: "AI算力" },
    items: [
      {
        name: "AI算力",
        family: "AI算力",
        aliases: ["共封装光学(CPO)"],
        matchNames: ["AI算力", "共封装光学(CPO)"],
        aggregationLevel: "family",
        subthemeCandidates: [{ name: "共封装光学(CPO)", resonance: true }],
        label: "可继续观察",
        score: 300,
        count: 5,
        limitCount: 2,
        resonance: true,
      },
      {
        name: "医药",
        family: "医药",
        aliases: ["流感"],
        matchNames: ["医药", "流感"],
        aggregationLevel: "family",
        subthemeCandidates: [{ name: "流感", resonance: true }],
        label: "可继续观察",
        score: 220,
        count: 4,
        limitCount: 3,
        resonance: true,
      },
    ],
  };
  const payloadFor = (today, prev, candidates) => ({
    fetchedAt: `${today}T15:10:00+08:00`,
    archiveMeta: { snapshotKind: "closing" },
    market: { limitStats: { dates: { today, prev, verified: true } } },
    topicBoard,
    candidates,
  });
  const first = buildThemeLibrarySnapshot(payloadFor("2026-08-27", "2026-08-26", winningCandidates), {
    tradingDate: "2026-08-27",
    snapshotKind: "closing",
    generatedAt: "2026-08-27T15:10:00+08:00",
  });
  assert.strictEqual(first.mainThemeDecision.mainAttackSubtheme, null, "首次当日胜出只能等待跨日确认");
  assert.strictEqual(first.mainThemeDecision.switchCandidate.name, "流感", "跨家族排名必须允许医药细分胜出");
  const cpo = first.mainThemeDecision.ranked.find((row) => row.name === "共封装光学(CPO)");
  assert.strictEqual(cpo.exactSampleCount, 4, "mainConcept被污染成CPO的PCB样本不得进入精确CPO统计");
  assert.strictEqual(cpo.memberCodes.includes("299999"), false);

  winningCandidates[0].leadership.initiative.tradingDate = "2026-08-28";
  const second = buildThemeLibrarySnapshot(payloadFor("2026-08-28", "2026-08-27", winningCandidates), {
    tradingDate: "2026-08-28",
    snapshotKind: "closing",
    generatedAt: "2026-08-28T15:10:00+08:00",
    previousThemeLibrary: first,
  });
  assert.strictEqual(second.mainThemeDecision.status, "confirmed_main_attack");
  assert.strictEqual(second.mainThemeDecision.mainAttackSubtheme.name, "流感");
  assert.strictEqual(second.mainThemeDecision.mainAttackSubtheme.confirmationCount, 2);

  const weakened = winningCandidates.map((stock) => (
    stock.concepts.includes("流感") ? { ...stock, changePct: -2, leadership: { initiative: { proactive: false, dataQuality: "收盘代理" } } } : stock
  ));
  const third = buildThemeLibrarySnapshot(payloadFor("2026-08-29", "2026-08-28", weakened), {
    tradingDate: "2026-08-29",
    snapshotKind: "closing",
    generatedAt: "2026-08-29T15:10:00+08:00",
    previousThemeLibrary: second,
  });
  assert.strictEqual(third.mainThemeDecision.mainAttackSubtheme, null, "历史两日胜出但今天失败时不得继续显示今日主攻");
  assert.strictEqual(third.mainThemeDecision.historicalSubtheme.name, "流感");

  const intraday = buildThemeLibrarySnapshot(payloadFor("2026-08-29", "2026-08-28", winningCandidates), {
    tradingDate: "2026-08-29",
    snapshotKind: "intraday",
    generatedAt: "2026-08-29T10:30:00+08:00",
    previousThemeLibrary: second,
  });
  assert.strictEqual(intraday.mainThemeDecision.status, "intraday_observation");
  assert.strictEqual(intraday.mainThemeDecision.history.closingWinners.length, second.mainThemeDecision.history.closingWinners.length, "盘中刷新不得写入收盘赢家历史");
})();

console.log("theme-library tests passed");
