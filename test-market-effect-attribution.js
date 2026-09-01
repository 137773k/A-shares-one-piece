"use strict";

const assert = require("assert");
const { buildMarketEffectAttribution } = require("./market-effect-attribution");

function candidate(overrides = {}) {
  const base = {
    code: "000001",
    name: "样本",
    mainConcept: "存储芯片",
    changePct: 0,
    amountYi: 20,
    klineProfile: {
      isNewListing: false,
      structureBreak: false,
      rise20: 0,
      pctFromHigh: 12,
    },
    leadership: {
      coreIdentityQualified: true,
      coreQualified: false,
      tradeQualified: false,
      persistentRecognition: true,
      identity: "历史情绪核心",
      initiative: {
        proactive: false,
        score: 30,
        followerCount: 0,
        relativeStrength: 0,
      },
      structure: {
        grade: "B",
        breakdown: false,
        frameworkIntact: true,
        isNewListing: false,
      },
    },
  };
  return {
    ...base,
    ...overrides,
    klineProfile: { ...base.klineProfile, ...(overrides.klineProfile || {}) },
    leadership: {
      ...base.leadership,
      ...(overrides.leadership || {}),
      initiative: {
        ...base.leadership.initiative,
        ...(overrides.leadership && overrides.leadership.initiative || {}),
      },
      structure: {
        ...base.leadership.structure,
        ...(overrides.leadership && overrides.leadership.structure || {}),
      },
    },
  };
}

const torens = candidate({
  code: "301583",
  name: "托伦斯",
  changePct: 10.7,
  amountYi: 33.5,
  leadership: {
    coreQualified: true,
    tradeQualified: true,
    identity: "主动型趋势龙",
    initiative: {
      proactive: true,
      score: 74,
      followerCount: 3,
      firstAttackTime: "09:32",
      relativeStrength: 15.8,
    },
  },
});
const longxin = candidate({
  code: "688825",
  name: "C长鑫",
  mainConcept: "新股与次新股",
  changePct: 12.7,
  amountYi: 448.1,
  klineProfile: { isNewListing: true, tradingDays: 3 },
  leadership: {
    coreIdentityQualified: false,
    persistentRecognition: true,
    initiative: { proactive: true, score: 64, relativeStrength: 7.5 },
    structure: { isNewListing: true, tradingDays: 3, grade: "C" },
  },
});
const fenghua = candidate({
  code: "000636",
  name: "风华高科",
  changePct: 10,
  amountYi: 80.9,
  klineProfile: { rise20: -36.1, structureBreak: true, pctFromHigh: 43.4 },
  leadership: {
    identity: "主动型容量龙头",
    initiative: { proactive: true, score: 99, followerCount: 5, relativeStrength: 15.2 },
    structure: { breakdown: true, frameworkIntact: false, grade: "D" },
  },
});
const ziguang = candidate({
  code: "000938",
  name: "紫光股份",
  changePct: -10,
  amountYi: 132.7,
  flowNature: { key: "uncertain", label: "资金性质待确认" },
});
const tongfu = candidate({
  code: "002156",
  name: "通富微电",
  changePct: -10,
  amountYi: 124.9,
  flowNature: { key: "uncertain", label: "资金性质待确认" },
});

const payload = {
  fetchedAt: "2026-07-29T12:38:38.443Z",
  market: {
    snapshot: {
      upCount: 4033,
      downCount: 1179,
      avgIndexChange: 1.02,
      shszAmountYi: 22965.79,
      asOf: "2026-07-29T12:38:16.401Z",
    },
    limitStats: { ztPrev: 60, ztToday: 81, dtPrev: 47, dtToday: 9 },
    state: {
      dailyState: { key: "repair_strengthening", label: "修复加强", tone: "good" },
      profitEffect: { score: 85.4, label: "赚钱效应强", tone: "good" },
      lossEffect: { score: 17.4, label: "亏钱效应较低", tone: "good" },
    },
  },
  candidates: [torens, longxin, fenghua, ziguang, tongfu],
  leadershipBoard: {
    focusDirection: "存储芯片",
    leaders: [torens, fenghua, ziguang, tongfu],
  },
  topicBoard: {
    mainLine: { name: "存储芯片" },
    items: [
      {
        name: "存储芯片",
        isCoreDirection: true,
        memberStats: {
          sampleCount: 25,
          avgChangePct: -2.34,
          medianChangePct: -5.15,
          upRate: 0.28,
          downRate: 0.72,
          strongCount: 5,
        },
        directionState: {
          isCoreDirection: true,
          dailyKey: "loss",
          resonanceLabel: "绝对共振",
        },
        sectorChangePct: 3.01,
      },
    ],
  },
};

const before = JSON.stringify({
  selected: payload.selected,
  candidates: payload.candidates.map((item) => ({ code: item.code, selected: item.selected })),
});
const result = buildMarketEffectAttribution(payload);
const after = JSON.stringify({
  selected: payload.selected,
  candidates: payload.candidates.map((item) => ({ code: item.code, selected: item.selected })),
});

assert.strictEqual(result.version, 1);
assert.strictEqual(result.observationOnly, true);
assert.match(result.headline, /修复加强/);
assert.match(result.headline, /短线主线强分化/);
assert.strictEqual(result.focusDirection.upRate, 28);
assert.strictEqual(result.focusDirection.downRate, 72);
assert.strictEqual(result.focusDirection.medianChangePct, -5.15);
assert.match(result.contradictions.join(" "), /不能把普涨直接等同于主线回暖/);

const profitByKey = Object.fromEntries(result.profitMap.groups.map((group) => [group.key, group]));
assert.deepStrictEqual(profitByKey["mainline-active"].items.map((item) => item.name), ["托伦斯"]);
assert.deepStrictEqual(profitByKey["new-pricing"].items.map((item) => item.name), ["C长鑫"]);
assert.deepStrictEqual(profitByKey["oversold-repair"].items.map((item) => item.name), ["风华高科"]);
assert.strictEqual(profitByKey["high-crowding"].status, "unverified");

const lossByKey = Object.fromEntries(result.lossMap.groups.map((group) => [group.key, group]));
assert.strictEqual(lossByKey["extreme-feedback"].status, "contracting");
assert.deepStrictEqual(lossByKey["old-core-loss"].items.map((item) => item.name), ["紫光股份", "通富微电"]);
assert.strictEqual(lossByKey["old-core-loss"].items[0].flowNature.label, "资金性质待确认");
const scopesByKey = Object.fromEntries(result.scopes.map((scope) => [scope.key, scope]));
assert.deepStrictEqual(
  scopesByKey["market"].referenceGroups[0].items.map((item) => item.name),
  ["托伦斯", "C长鑫", "风华高科"],
);
assert.deepStrictEqual(
  scopesByKey["short-core"].referenceGroups[0].items.map((item) => item.name),
  ["托伦斯"],
);
assert.deepStrictEqual(
  scopesByKey["short-core"].referenceGroups[1].items.map((item) => item.name),
  ["紫光股份", "通富微电"],
);
assert.deepStrictEqual(
  scopesByKey["tradeable"].referenceGroups[0].items.map((item) => item.name),
  ["托伦斯"],
);
assert.deepStrictEqual(
  scopesByKey["loss"].referenceGroups[0].items.map((item) => item.name),
  ["紫光股份", "通富微电"],
);
assert.strictEqual(before, after, "归因层不得修改候选、选股或买卖字段");

const empty = buildMarketEffectAttribution({});
assert.strictEqual(empty.observationOnly, true);
assert.ok(Array.isArray(empty.proofLayers));
assert.ok(Array.isArray(empty.profitMap.groups));
assert.ok(Array.isArray(empty.lossMap.groups));

console.log("market effect attribution tests passed");
