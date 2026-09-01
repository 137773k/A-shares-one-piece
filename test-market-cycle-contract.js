"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BIG_CYCLE_KEYS,
  BIG_CYCLE_VALUES,
  normalizeBigCycle,
  normalizeBigCycleKey,
  bigCycleItem,
  composeRepairTransition,
  repairTransition,
  smallCycleFromSignals,
} = require("./quant-decision/market-cycle-contract");

const CURRENT_GENERATION = Object.freeze({
  generationId: "2026-08-27:2026-08-27T07:36:00.000Z",
  tradingDate: "2026-08-27",
  asOf: "2026-08-27T07:36:00.000Z",
});

function transition(key, overrides = {}) {
  const strengthening = key === "repair_strengthening";
  return {
    key,
    label: strengthening ? "退潮后修复加强" : "修复观察",
    status: "observed",
    from: "退潮",
    to: strengthening ? "混沌" : null,
    observationOnly: true,
    evidence: strengthening ? ["赚钱效应改善", "亏钱效应收缩"] : ["指数修复"],
    generationContext: CURRENT_GENERATION,
    ...overrides,
  };
}

test("大周期契约只允许五个互斥状态", () => {
  assert.deepEqual(BIG_CYCLE_KEYS, ["chaos", "main_rise", "range", "retreat", "ice_point"]);
  assert.deepEqual(BIG_CYCLE_VALUES, ["混沌", "主升", "震荡", "退潮", "冰点"]);
  assert.equal(normalizeBigCycle("主升期"), "主升");
  assert.equal(normalizeBigCycleKey("震荡期"), "range");
});

test("修复、反弹、分歧、加强和局部主升不得截断成大周期", () => {
  [
    "修复",
    "修复期",
    "冰点反弹",
    "主升分歧",
    "主升加强",
    "partial_main_rise",
    "中期修复·主升候选",
  ].forEach((value) => {
    assert.equal(normalizeBigCycleKey(value), null, `${value} must not be a big cycle`);
    assert.equal(bigCycleItem({ key: value, label: value }).status, "unavailable");
  });
});

test("修复信号分别进入过渡节点和小周期，不改写混沌大周期", () => {
  const transition = repairTransition({
    bigCycle: "混沌",
    mediumTerm: { key: "repair_candidate", label: "中期修复·主升候选" },
    shortTerm: { key: "repair", label: "5日短周期修复", windowDays: 5 },
  });
  const smallCycle = smallCycleFromSignals({
    shortTerm: { key: "repair", label: "5日短周期修复", confirmed: true, windowDays: 5 },
  });

  assert.equal(transition.key, "repair_strengthening");
  assert.equal(transition.from, "混沌");
  assert.equal(transition.to, "主升");
  assert.equal(transition.observationOnly, true);
  assert.equal(smallCycle.key, "repair");
  assert.equal(smallCycle.observationOnly, true);
  assert.equal(normalizeBigCycle("混沌"), "混沌");
});

test("小周期只认结构化键，说明文字中的暂无主升不得误判为加强", () => {
  const smallCycle = smallCycleFromSignals({
    indexSubPhase: { key: "range_structure", label: "震荡结构·暂无主升细分" },
    shortTerm: { key: "range", label: "全市场5日短周期震荡", confirmed: true, windowDays: 5 },
    intraday: { key: "mixed", label: "分时震荡、强弱混合" },
  });

  assert.equal(smallCycle.key, "range");
  assert.equal(smallCycle.label, "震荡");
  assert.equal(smallCycle.source, "market_cycle_contract:indexSubPhase.key");
  assert.notEqual(smallCycle.key, "strengthening");
});

test("短线主升结构不等于小周期加强，必须叠加全A日内强收", () => {
  const consolidation = smallCycleFromSignals({
    shortTerm: { key: "main_rise", label: "全市场短线主升段", confirmed: true },
    intraday: { key: "mixed", label: "分时震荡、强弱混合", confirmed: true },
  });
  const strengthening = smallCycleFromSignals({
    shortTerm: { key: "main_rise", label: "全市场短线主升段", confirmed: true },
    intraday: { key: "strong_close", label: "分时强收于高位", confirmed: true },
  });

  assert.equal(consolidation.key, "range");
  assert.equal(consolidation.label, "震荡");
  assert.equal(strengthening.key, "strengthening");
  assert.equal(strengthening.label, "加强");
  assert.equal(strengthening.source, "market_cycle_contract:shortTerm.key+intraday.key");
  assert.match(strengthening.reason, /全市场短线主升段/);
  assert.match(strengthening.reason, /分时强收于高位/);
});

test("指数5日结构转弱不能覆盖当日赚钱效应与强收盘形成的修复加强", () => {
  const smallCycle = smallCycleFromSignals({
    shortTerm: { key: "weakening", label: "全市场5日短周期转弱", confirmed: true, windowDays: 5 },
    indexSubPhase: { key: "weakening_structure", label: "转弱结构·暂无主升细分" },
    intraday: {
      key: "recovery_strong_close",
      label: "探底回升并收于高位",
      session: { key: "recovery_strong_close", label: "探底回升并收于高位" },
    },
    dailyState: { key: "repair_strengthening", label: "修复加强" },
    profitEffect: { score: 90, label: "赚钱效应强" },
    lossEffect: { score: 10.1, label: "亏钱效应较低" },
    tradeWindow: {
      marketGate: [{ key: "core", passed: false }],
      coreEvidence: [],
    },
  });

  assert.equal(smallCycle.key, "repair_strengthening");
  assert.equal(smallCycle.label, "修复加强");
  assert.equal(smallCycle.source, "market_cycle_contract:dailyState.key+intraday.key");
  assert.equal(smallCycle.indexStructure.key, "weakening");
  assert.equal(smallCycle.indexStructure.conflict, true);
  assert.equal(smallCycle.confirmation.status, "core_pending");
  assert.match(smallCycle.reason, /指数5日结构尚未完成修复/);
  assert.doesNotMatch(smallCycle.reason, /指数10日结构/);
  assert.match(smallCycle.reason, /不升级为全面转强/);
});

test("只有指数单日普涨、没有赚钱效应修复加强时仍保留5日转弱结构", () => {
  const smallCycle = smallCycleFromSignals({
    shortTerm: { key: "weakening", label: "全市场5日短周期转弱", confirmed: true, windowDays: 5 },
    indexSubPhase: { key: "weakening_structure", label: "转弱结构·暂无主升细分" },
    intraday: { key: "recovery_strong_close", label: "探底回升并收于高位" },
    dailyState: { key: "neutral", label: "中性" },
  });

  assert.equal(smallCycle.key, "weakening");
  assert.equal(smallCycle.indexStructure.conflict, false);
});

test("负反馈扩散优先于强收盘，不能被单日尾盘拉升改写为修复加强", () => {
  const smallCycle = smallCycleFromSignals({
    shortTerm: { key: "range", label: "全市场5日短周期震荡", confirmed: true, windowDays: 5 },
    intraday: { key: "recovery_strong_close", label: "探底回升并收于高位" },
    dailyState: { key: "retreat_candidate", label: "负反馈扩散" },
  });

  assert.equal(smallCycle.key, "weakening");
  assert.equal(smallCycle.source, "market_cycle_contract:dailyState.key");
});

test("同代修复加强优先于修复观察，输入顺序不能造成降级", () => {
  const weak = { transition: transition("repair_observed"), source: "indexCycleRegime.transition" };
  const rangePending = {
    transition: transition("range_pending_confirmation", {
      label: "震荡待确认",
      to: "震荡",
      evidence: ["3/4个主要指数站上5日线", "等待上一收盘确认"],
    }),
    source: "indexCycleRegime.rangeConfirmation",
  };
  const strong = { transition: transition("repair_strengthening"), source: "structuralResolution.transition" };
  const weakFirst = composeRepairTransition({
    expectedGeneration: CURRENT_GENERATION,
    candidates: [weak, rangePending, strong],
  });
  const strongFirst = composeRepairTransition({
    expectedGeneration: CURRENT_GENERATION,
    candidates: [strong, rangePending, weak],
  });

  [weakFirst, strongFirst].forEach((result) => {
    assert.equal(result.key, "repair_strengthening");
    assert.equal(result.from, "退潮");
    assert.equal(result.to, "混沌");
    assert.equal(result.composition.downgradePrevented, true);
    assert.equal(result.generationId, CURRENT_GENERATION.generationId);
    assert.deepEqual(result.confirmationTarget, { key: "range_pending", label: "震荡待确认" });
    assert.ok(BIG_CYCLE_VALUES.includes(result.to));
  });
});

test("错代的修复加强不能升级同代修复观察", () => {
  const result = composeRepairTransition({
    expectedGeneration: CURRENT_GENERATION,
    candidates: [
      { transition: transition("repair_observed"), source: "indexCycleRegime.transition" },
      {
        transition: transition("repair_strengthening", {
          generationContext: {
            generationId: "2026-08-26:2026-08-26T07:36:00.000Z",
            tradingDate: "2026-08-26",
            asOf: "2026-08-26T07:36:00.000Z",
          },
        }),
        source: "staleStructuralResolution.transition",
      },
    ],
  });

  assert.equal(result.key, "repair_observed");
  assert.equal(result.to, null);
  assert.equal(result.composition.strongerRejected, true);
  assert.ok(result.composition.rejected.some((row) => row.reasonCode === "candidate_generation_mismatch"));
});

test("缺代次时失败关闭，且非五态过渡目标不得写入", () => {
  const missing = composeRepairTransition({
    candidates: [{ transition: transition("repair_strengthening", { generationContext: null }) }],
  });
  const invalidTarget = composeRepairTransition({
    expectedGeneration: CURRENT_GENERATION,
    candidates: [{ transition: transition("repair_strengthening", { to: "修复" }) }],
  });

  assert.equal(missing.key, "unavailable");
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.to, null);
  assert.equal(missing.reasonCode, "transition_generation_missing");
  assert.equal(invalidTarget.key, "unavailable");
  assert.equal(invalidTarget.to, null);
  assert.equal(invalidTarget.reasonCode, "transition_target_not_canonical");
});

test("退潮修复加强进入混沌，但只把震荡保留为待确认目标", () => {
  const result = repairTransition({
    bigCycle: "退潮",
    dailyState: { key: "repair_strengthening", label: "修复加强" },
    generationContext: CURRENT_GENERATION,
  });

  assert.equal(result.key, "repair_strengthening");
  assert.equal(result.from, "退潮");
  assert.equal(result.to, "混沌");
  assert.deepEqual(result.confirmationTarget, { key: "range_pending", label: "震荡待确认" });
  assert.match(result.label, /震荡待确认/);
  assert.equal(normalizeBigCycle(result.to), "混沌");
});

test("没有修复加强时保留同代震荡待确认节点", () => {
  const pending = composeRepairTransition({
    expectedGeneration: CURRENT_GENERATION,
    candidates: [{
      source: "indexCycleRegime.transition",
      transition: transition("range_pending_confirmation", {
        label: "震荡待确认",
        to: "震荡",
      }),
    }],
  });

  assert.equal(pending.key, "range_pending_confirmation");
  assert.equal(pending.label, "震荡待确认");
  assert.equal(pending.to, "震荡");
  assert.deepEqual(pending.confirmationTarget, { key: "range_pending", label: "震荡待确认" });
});
