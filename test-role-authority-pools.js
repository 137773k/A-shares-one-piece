"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCoreLeadershipBoard } = require("./core-leadership");
const { buildCoreEmotionBasket } = require("./core-emotion-lifecycle");
const { analyzeTradingWindow } = require("./market-cycle-engine");
const {
  buildTodayStrongPool,
  buildReflowPoolStocks,
  buildMainLinePool,
} = require("./pool-builders");

function poolStock(code, overrides = {}) {
  return {
    code,
    name: `匿名样本${code}`,
    role: "普通观察",
    mainConcept: "匿名题材",
    mainFamily: "匿名题材",
    changePct: 0,
    score: 50,
    setup: "回流观察",
    klineProfile: { rise10: 10 },
    ...overrides,
  };
}

function dailyHeight(code = "ANON_DAILY_HEIGHT_POOL") {
  return poolStock(code, {
    role: "龙头",
    roleKind: "dailyHeight",
    roleScope: "session",
    dailyRole: "当日高度",
  });
}

function cycleLeader(code = "ANON_CYCLE_LEADER_POOL") {
  return poolStock(code, {
    role: "龙头",
    roleKind: "cycleLeader",
    roleScope: "cycle",
    dailyRole: null,
    leadership: {
      cycleIdentity: {
        identityEstablished: true,
        activePrimary: true,
        state: "confirmed",
      },
    },
  });
}

function rawRole(code = "ANON_RAW_ROLE_POOL", role = "龙头") {
  return poolStock(code, { role });
}

const strategy = {
  roleBonus: { 龙头: 22, 中军: 12 },
  setupBonus: {},
};

test("今日强度池：当日高度不能凭裸龙头文本取得周期角色加分", () => {
  const plain = poolStock("ANON_PLAIN_POOL");
  const height = dailyHeight();
  const rawLeader = rawRole("ANON_RAW_LEADER_POOL", "龙头");
  const rawCapacity = rawRole("ANON_RAW_CAPACITY_POOL", "中军");
  const confirmed = cycleLeader();
  const rows = buildTodayStrongPool([plain, height, rawLeader, rawCapacity, confirmed], strategy, () => 50);
  const byCode = new Map(rows.map((row) => [row.code, row]));

  assert.equal(byCode.get(height.code).poolScore, byCode.get(plain.code).poolScore);
  assert.equal(byCode.get(rawLeader.code).poolScore, byCode.get(plain.code).poolScore);
  assert.equal(byCode.get(rawCapacity.code).poolScore, byCode.get(plain.code).poolScore);
  assert.ok(byCode.get(confirmed.code).poolScore > byCode.get(plain.code).poolScore);
});

test("回流池：当日高度、裸龙头和裸中军不能取得回流候选资格", () => {
  const height = dailyHeight();
  const rawLeader = rawRole("ANON_RAW_LEADER_POOL", "龙头");
  const rawCapacity = rawRole("ANON_RAW_CAPACITY_POOL", "中军");
  const confirmed = cycleLeader();
  const rows = buildReflowPoolStocks([height, rawLeader, rawCapacity, confirmed], null, [], strategy);

  assert.deepEqual(rows.map((row) => row.code), [confirmed.code]);
});

test("主线核心池：当日高度、裸龙头和裸中军不能取得主线核心资格", () => {
  const height = dailyHeight();
  const rawLeader = rawRole("ANON_RAW_LEADER_POOL", "龙头");
  const rawCapacity = rawRole("ANON_RAW_CAPACITY_POOL", "中军");
  const confirmed = cycleLeader();
  const rows = buildMainLinePool(
    [height, rawLeader, rawCapacity, confirmed],
    { mainLine: { name: "匿名题材" } },
    strategy,
  );

  assert.deepEqual(rows.map((row) => row.code), [confirmed.code]);
});

test("领导力：无类型裸龙头和裸中军不能靠角色加分跨过核心交易门槛", () => {
  const klineProfile = {
    lastClose: 100,
    ma5: 98,
    ma10: 97,
    ma20: 95,
    ma60: 90,
    rise10: 5,
    rise20: 8,
    pctFromHigh: 10,
    position120Pct: 50,
    longBearBreak3d: false,
    structureBreak: false,
  };
  const makeLeadershipStock = (code, role) => ({
    code,
    name: `匿名样本${code}`,
    mainConcept: "匿名题材",
    concepts: ["匿名题材"],
    changePct: 8,
    amountYi: 20,
    combinedRank: 20,
    inBothSources: false,
    role,
    klineProfile: { ...klineProfile },
  });
  const plain = makeLeadershipStock("ANON_ROLE_BASE", "普通观察");
  const rawLeader = makeLeadershipStock("ANON_ROLE_RAW_LEADER", "龙头");
  const rawCapacity = makeLeadershipStock("ANON_ROLE_RAW_CAPACITY", "中军");
  const followerA = { ...makeLeadershipStock("ANON_FOLLOW_A", "普通跟随"), changePct: 2 };
  const followerB = { ...makeLeadershipStock("ANON_FOLLOW_B", "普通跟随"), changePct: 2 };
  const targetIntraday = () => ({
    firstAttackMinute: 590,
    firstAttackTime: "09:50",
    retentionPct: 55,
    rows: [{ minute: 575, changePct: 0 }, { minute: 590, changePct: 4 }, { minute: 610, changePct: 8 }],
  });
  const followerAIntraday = { firstAttackMinute: 600, firstAttackTime: "10:00", retentionPct: 55,
    rows: [{ minute: 590, changePct: 0 }, { minute: 600, changePct: 1.5 }, { minute: 610, changePct: 2 }] };
  const followerBIntraday = { firstAttackMinute: 605, firstAttackTime: "10:05", retentionPct: 55,
    rows: [{ minute: 590, changePct: 1.2 }, { minute: 605, changePct: 1.5 }, { minute: 610, changePct: 2 }] };

  buildCoreLeadershipBoard({
    candidates: [plain, rawLeader, rawCapacity, followerA, followerB],
    topicBoard: { mainLine: { name: "匿名题材", family: "匿名题材", matchNames: ["匿名题材"] } },
    intradayByCode: new Map([
      [plain.code, targetIntraday()], [rawLeader.code, targetIntraday()],
      [rawCapacity.code, targetIntraday()],
      [followerA.code, followerAIntraday], [followerB.code, followerBIntraday],
    ]),
    archives: [],
    generatedAt: "2026-08-14T15:10:00+08:00",
  });

  assert.deepEqual(
    [rawLeader, rawCapacity].map((raw) => ({
      role: raw.role,
      score: raw.leadership.initiative.score,
      recognized: raw.leadership.recognized,
      coreIdentityQualified: raw.leadership.coreIdentityQualified,
      tradeQualified: raw.leadership.tradeQualified,
    })),
    ["龙头", "中军"].map((role) => ({
      role,
      score: plain.leadership.initiative.score,
      recognized: plain.leadership.recognized,
      coreIdentityQualified: false,
      tradeQualified: false,
    })),
  );
});

test("跨日领导力：旧归档裸中军不能累计成历史核心并打开先手窗口", () => {
  const base = {
    code: "ANON_ARCHIVE_RAW_CAPACITY",
    name: "匿名归档裸中军",
    role: "中军",
    mainConcept: "匿名题材",
    concepts: ["匿名题材"],
    changePct: 6,
    amountYi: 10,
    combinedRank: 50,
    klineProfile: {
      lastClose: 10,
      ma5: 9.8,
      ma10: 9.6,
      ma20: 9.3,
      ma60: 9,
      rise10: 5,
      rise20: 8,
      pctFromHigh: 5,
      position120Pct: 50,
      longBearBreak3d: false,
      structureBreak: false,
    },
  };
  const current = structuredClone(base);
  const archives = ["2026-08-12", "2026-08-13"].map((date) => ({
    date,
    payload: { candidates: [structuredClone(base)] },
  }));

  buildCoreLeadershipBoard({
    candidates: [current],
    topicBoard: { mainLine: { name: "匿名题材", family: "匿名题材", matchNames: ["匿名题材"] } },
    intradayByCode: new Map(),
    archives,
    generatedAt: "2026-08-14T15:10:00+08:00",
  });
  const window = analyzeTradingWindow({
    snapshot: { avgIndexChange: -0.5, allA: { changePct: 0 } },
    limitStats: { ztToday: 40, dtToday: 5 },
    profitEffect: { score: 55 },
    lossEffect: { score: 25 },
    candidates: [current],
  });

  assert.equal(current.leadership.history.coreHits, 0);
  assert.equal(current.leadership.coreIdentityQualified, false);
  assert.equal(window.allowNew, false);
  assert.equal(window.coreEvidence.length, 0);
});

test("情绪核心：无类型裸龙头和裸中军不能靠宽泛持续辨识度取得核心身份", () => {
  const makeRawEmotionRole = (code, role) => ({
    code,
    name: "匿名裸角色情绪样本",
    role,
    changePct: 2,
    amountYi: 10,
    speculation: { expectation: "在途", boards: 1 },
    klineProfile: { lastTradingDate: "2026-08-07" },
    leadership: {
      recognized: true,
      persistentRecognition: true,
      coreIdentityQualified: false,
      impactScore: 0,
      history: { appearances: 2, coreHits: 0, activeHits: 0 },
      structure: { breakdown: false },
      initiative: {
        score: 40,
        proactive: false,
        capacity: false,
        followerCount: 0,
        breadthLift: 0,
        dataQuality: "收盘代理",
        session: null,
      },
    },
  });
  const rawLeader = makeRawEmotionRole("ANON_RAW_EMOTION_LEADER", "龙头");
  const rawCapacity = makeRawEmotionRole("ANON_RAW_EMOTION_CAPACITY", "中军");
  const basket = buildCoreEmotionBasket({
    market: {
      snapshot: {},
      limitStats: { dates: { today: "20260807", prev: "20260806", verified: true } },
      state: { structuralCycle: "震荡" },
    },
    candidates: [rawLeader, rawCapacity],
    bestPicks: { picks: [] },
    themeLibrary: {
      available: true,
      stale: false,
      tradingDate: "2026-08-07",
      previousTradingDate: "2026-08-06",
      previousDateVerified: true,
      snapshotKind: "closing",
      themes: [{ name: "匿名题材", stocks: [] }],
    },
  });

  assert.deepEqual(
    [rawLeader, rawCapacity].map((raw) => ({
      role: raw.role,
      inBasket: basket.items.some((item) => item.code === raw.code),
      rankedLeader: basket.emotionCycle.rankedAnchors.some(
        (item) => item.code === raw.code && item.anchorRole === "leader",
      ),
    })),
    ["龙头", "中军"].map((role) => ({ role, inBasket: false, rankedLeader: false })),
  );
});
