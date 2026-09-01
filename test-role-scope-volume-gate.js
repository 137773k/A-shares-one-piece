"use strict";

const assert = require("assert");
const { _internals } = require("./server");

const { refreshCandidateFlowAndGate } = _internals;

// scoreCandidate 之后的二次硬门槛刷新必须使用已验证周期身份，不能再看裸 role=龙头。
const dailyHeight = {
  code: "ANON_VOLUME_HEIGHT",
  name: "匿名量比高度",
  role: "龙头",
  roleKind: "dailyHeight",
  roleScope: "session",
  dailyRole: "当日高度",
  mainConcept: "匿名题材",
  concepts: ["匿名题材"],
  changePct: 4,
  amountYi: 20,
  turnoverRate: 12,
  volumeRatio: 1.2,
  mainInflowYi: 1,
  klineProfile: {
    lastClose: 12,
    ma5: 11,
    ma10: 10,
    ma20: 9,
    ma5Rising: true,
    longBearBreak3d: false,
    avgAmount5Yi: 12,
  },
};

refreshCandidateFlowAndGate([dailyHeight], { cycle: "混沌", subPhase: "分歧" }, {});

assert(
  dailyHeight.hardGate.hardFails.some((reason) => /量比1\.2不足1\.5/.test(reason)),
  "裸 role=龙头 的 session/dailyHeight 不得取得核心票量比豁免",
);
assert(
  !dailyHeight.hardGate.softFlags.some((reason) => /核心票观察/.test(reason)),
  "当日高度不能被二次硬门槛刷新包装成核心票观察",
);

console.log("✓ 当日高度不会在二次硬门槛刷新中取得核心量比豁免");
