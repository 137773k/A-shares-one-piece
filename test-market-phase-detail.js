"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MARKET_PHASE_DETAIL_VERSION,
  buildMarketPhaseDetail,
} = require("./market-phase-detail");

const CURRENT_GENERATION = Object.freeze({
  generationId: "2026-08-27:2026-08-27T07:36:00.000Z",
  tradingDate: "2026-08-27",
  asOf: "2026-08-27T07:36:00.000Z",
});

function fiveDayBigCycle(key, label, generationContext = CURRENT_GENERATION) {
  const dates = ["2026-08-21", "2026-08-24", "2026-08-25", "2026-08-26", generationContext.tradingDate];
  const window = {
    version: 1,
    method: "five_day_weighted_emotion_big_cycle_window_v1",
    status: "available",
    windowDays: 5,
    observations: dates.map((tradingDate) => ({ tradingDate, complete: true })),
  };
  return {
    key,
    label,
    status: "canonical",
    source: "five_day_weighted_emotion_big_cycle_window_v1",
    horizon: "rolling_5_trading_days",
    windowDays: 5,
    window,
    reasonCode: "fixture_five_day_confirmed",
    reason: "五日收盘窗口已确认。",
    evidence: ["五日窗口完整", "最近两日同态"],
    generationContext,
    calibrated: false,
  };
}

function repairTransitionFixture(key, generationContext = CURRENT_GENERATION) {
  const strengthening = key === "repair_strengthening";
  return {
    key,
    label: strengthening ? "退潮后修复加强·进入混沌，震荡待确认" : "修复观察·不改写大周期",
    status: "observed",
    from: "退潮",
    to: strengthening ? "混沌" : null,
    observationOnly: true,
    evidence: strengthening ? ["赚钱效应改善", "亏钱效应收缩"] : ["指数修复"],
    generationContext,
    confirmationTarget: strengthening ? { key: "range_pending", label: "震荡待确认" } : null,
  };
}

function strongDivergenceInput() {
  return {
    indexCycleRegime: {
      mediumTerm: {
        key: "repair_candidate",
        cycleKey: "repair",
        label: "中期修复·主升候选",
        confirmed: true,
        evidence: ["3/4个主要指数站上20日线"],
      },
      shortTerm: {
        windowDays: 5,
        key: "main_rise",
        label: "全市场短线主升段",
        confirmed: true,
      },
      structuralCycle: "主升",
      indexSubPhase: {
        key: "main_rise_strong_divergence",
        label: "主升内强分歧",
        structureIntact: true,
        intensity: "strong",
        evidence: ["4/4个主要指数仍站在5日线上"],
      },
    },
    emotionCycle: {
      bigCycle: fiveDayBigCycle("main_rise", "主升"),
      current: {
        key: "strong_divergence",
        phaseKey: "strong_divergence",
        label: "强分歧",
        confidence: 82,
        reason: "可参与核心出现普遍分歧，承接尚未确认",
      },
    },
    limitStats: {
      limitUpCount: 59,
      previousLimitUpCount: 91,
      limitDownCount: 4,
      previousLimitDownCount: 0,
    },
    snapshot: {
      breadth: 0.212,
      avgIndexChange: -0.61,
    },
  };
}

test("主升内强分歧按三轴输出，并把次日路径定义为未校准基准而非概率", () => {
  const result = buildMarketPhaseDetail(strongDivergenceInput());

  assert.equal(result.version, MARKET_PHASE_DETAIL_VERSION);
  assert.equal(result.mediumStructure.label, "中期修复·主升候选");
  assert.equal(result.structuralCycle, "主升");
  assert.equal(result.structuralCycleDetail.horizon, "rolling_5_trading_days");
  assert.equal(result.structuralCycleDetail.windowDays, 5);
  assert.match(result.structuralCycleDetail.reason, /五日收盘窗口/);
  assert.deepEqual(result.structuralCycleDetail.evidence, ["五日窗口完整", "最近两日同态"]);
  assert.equal(result.structuralCycleAuthority.fiveDayWindowComplete, true);
  assert.equal(result.indexSubPhase.key, "main_rise_strong_divergence");
  assert.equal(result.indexSubPhase.label, "主升内强分歧");
  assert.equal(result.indexSubPhase.structureIntact, true);
  assert.equal(result.emotionStage.key, "strong_divergence");
  assert.equal(result.emotionStage.label, "中等分歧");
  assert.deepEqual(result.tomorrowBaseline, {
    key: "divergence_continuation",
    label: "分歧延续优先",
    status: "baseline_unconfirmed",
    rank: 1,
    probability: null,
    calibrated: false,
  });
});

test("主升强分歧只等承接后参与，不把机会一棒子封死", () => {
  const result = buildMarketPhaseDetail(strongDivergenceInput());

  assert.equal(result.selectionPolicy.mode, "conditional_after_support");
  assert.deepEqual(result.selectionPolicy.allowedSetups, [
    "周期核心分歧回流观察",
    "主线题材趋势核心分歧回流观察",
  ]);
  assert.deepEqual(result.selectionPolicy.forbiddenSetups, [
    "追一致加速",
    "把当日高度或补涨当核心",
    "无承接抄底",
  ]);
  assert.ok(result.selectionPolicy.requiredChecks.includes("核心身份已由跨日地位确认"));
  assert.ok(result.selectionPolicy.requiredChecks.includes("分歧后出现真实承接"));
});

test("退潮阶段封锁新开仓，不能沿用主升的条件观察权限", () => {
  const result = buildMarketPhaseDetail({
    indexCycleRegime: {
      mediumTerm: { key: "decline", label: "中期走弱", confirmed: true },
      shortTerm: { windowDays: 5, key: "weakening", label: "5日短周期转弱", confirmed: true },
      structuralCycle: "退潮",
      indexSubPhase: {
        key: "retreat",
        label: "退潮",
        structureIntact: false,
        intensity: "strong",
      },
    },
    emotionCycle: {
      bigCycle: fiveDayBigCycle("retreat", "退潮"),
      current: { key: "retreat", phaseKey: "retreat", label: "退潮" },
    },
  });

  assert.equal(result.structuralCycle, "退潮");
  assert.equal(result.selectionPolicy.mode, "blocked_new_entry");
  assert.deepEqual(result.selectionPolicy.allowedSetups, []);
  assert.equal(result.tomorrowBaseline.key, "risk_control");
  assert.equal(result.tomorrowBaseline.probability, null);
  assert.equal(result.tomorrowBaseline.calibrated, false);
});

test("核心结构数据不足时返回 unavailable，不猜周期和交易权限", () => {
  const result = buildMarketPhaseDetail({
    indexCycleRegime: {},
    emotionCycle: {},
    limitStats: {},
    snapshot: {},
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.structuralCycle, "未知");
  assert.equal(result.indexSubPhase.key, "unavailable");
  assert.equal(result.emotionStage.key, "unavailable");
  assert.equal(result.tomorrowBaseline.status, "risk_default");
  assert.equal(result.tomorrowBaseline.key, "evidence_insufficient_defensive_observe");
  assert.equal(result.tomorrowBaseline.label, "证据不足·防守观察");
  assert.equal(result.tomorrowBaseline.probability, null);
  assert.equal(result.tomorrowBaseline.calibrated, false);
  assert.equal(result.tomorrowBaseline.stageInferred, false);
  assert.equal(result.selectionPolicy.mode, "unavailable");
  assert.deepEqual(result.selectionPolicy.allowedSetups, []);
});

test("输入缺失不能用涨停数量或宽度的零值补齐判断", () => {
  const result = buildMarketPhaseDetail({
    indexCycleRegime: {
      mediumTerm: { key: "unknown", label: "中期结构待确认", confirmed: false },
      shortTerm: { windowDays: 5, key: "unknown", label: "5日短周期待确认", confirmed: false },
    },
    emotionCycle: {
      current: { key: "unknown", label: "阶段待确认" },
    },
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.evidence.limitUpCount, null);
  assert.equal(result.evidence.limitDownCount, null);
  assert.equal(result.evidence.breadth, null);
  assert.equal(result.evidence.avgIndexChange, null);
});

test("真实涨跌停字段 ztToday/dtToday 会进入证据，不能在组合层丢失", () => {
  const input = strongDivergenceInput();
  input.limitStats = {
    ztToday: 59,
    ztPrev: 91,
    dtToday: 4,
    dtPrev: 0,
  };
  const result = buildMarketPhaseDetail(input);

  assert.equal(result.evidence.limitUpCount, 59);
  assert.equal(result.evidence.previousLimitUpCount, 91);
  assert.equal(result.evidence.limitDownCount, 4);
  assert.equal(result.evidence.previousLimitDownCount, 0);
});

test("完整震荡结构保留真实标签；缺T-1时只给防守执行兜底，不冒充情绪阶段", () => {
  const result = buildMarketPhaseDetail({
    indexCycleRegime: {
      mediumTerm: { key: "range", label: "中期震荡", confirmed: true },
      shortTerm: { windowDays: 5, key: "range", label: "全市场5日短周期震荡", confirmed: true },
      structuralCycle: "震荡",
      indexSubPhase: { key: "structure_pending", label: "细分阶段待确认" },
      dataQuality: { grade: "complete" },
    },
    emotionCycle: {
      current: { key: "unknown", label: "情绪阶段待确认" },
      previous: { source: "exact_t1_state_missing" },
    },
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.indexSubPhase.key, "range_structure");
  assert.equal(result.indexSubPhase.label, "震荡结构·暂无主升细分");
  assert.doesNotMatch(result.indexSubPhase.label, /待确认/);
  assert.equal(result.emotionStage.key, "unavailable");
  assert.equal(result.emotionStage.label, "情绪阶段待确认");
  assert.equal(result.emotionStage.reasonCode, "missing_exact_t1");
  assert.match(result.emotionStage.reason, /缺少可用的精确T-1收盘状态/);
  assert.deepEqual(result.tomorrowBaseline, {
    key: "evidence_insufficient_defensive_observe",
    label: "证据不足·防守观察",
    status: "risk_default",
    rank: null,
    probability: null,
    calibrated: false,
    riskDefault: true,
    stageInferred: false,
    action: "暂不新开仓",
    checkpoints: ["09:25", "09:35"],
    reason: "缺少可用的精确T-1收盘状态，无法确认情绪阶段",
  });
  assert.equal(result.selectionPolicy.mode, "unavailable");
  assert.equal(result.selectionPolicy.canActivate, false);
  assert.equal(result.selectionPolicy.stageInferred, false);
  assert.deepEqual(result.selectionPolicy.checkpoints, ["09:25", "09:35"]);
});

test("情绪阶段不可用时展示质量隔离或同代失败的具体原因，且不硬填阶段", () => {
  const base = {
    indexCycleRegime: {
      mediumTerm: { key: "range", label: "中期震荡", confirmed: true },
      shortTerm: { windowDays: 5, key: "range", label: "全市场5日短周期震荡", confirmed: true },
      structuralCycle: "震荡",
      indexSubPhase: { key: "range_structure", label: "震荡结构·暂无主升细分" },
      dataQuality: { grade: "complete" },
    },
  };
  const quarantined = buildMarketPhaseDetail({
    ...base,
    emotionCycle: {
      current: { key: "unknown", label: "情绪阶段待确认" },
      dataQuality: { reasonCodes: ["previous_archive_quarantined_by_quality_gate"] },
    },
  });
  const generationFailed = buildMarketPhaseDetail({
    ...base,
    emotionCycle: {
      current: { key: "unknown", label: "情绪阶段待确认" },
      integrity: { reasonCodes: ["same_generation_failed"] },
    },
  });

  assert.equal(quarantined.emotionStage.key, "unavailable");
  assert.equal(quarantined.emotionStage.reasonCode, "quality_quarantined");
  assert.match(quarantined.emotionStage.reason, /质量门隔离/);
  assert.equal(generationFailed.emotionStage.key, "unavailable");
  assert.equal(generationFailed.emotionStage.reasonCode, "same_generation_failed");
  assert.match(generationFailed.emotionStage.reason, /同代校验失败/);
  assert.equal(generationFailed.tomorrowBaseline.stageInferred, false);
  assert.doesNotMatch(JSON.stringify([quarantined, generationFailed]), /非良性分歧|高潮后分歧/);
});

test("旧 marketState 不能替代缺失的当前宏观大周期，修复只进入过渡和小周期", () => {
  const result = buildMarketPhaseDetail({
    generationContext: CURRENT_GENERATION,
    marketState: {
      cycle: "混沌",
      generationContext: CURRENT_GENERATION,
      dailyState: { key: "repair", label: "修复进行中", generationContext: CURRENT_GENERATION },
    },
    indexCycleRegime: {
      generationContext: CURRENT_GENERATION,
      structuralCycle: "修复",
      mediumTerm: { key: "repair", label: "中期修复", confirmed: true },
      shortTerm: { windowDays: 5, key: "repair", label: "5日短周期修复", confirmed: true },
      dataQuality: { grade: "complete" },
    },
    emotionCycle: { current: { key: "unknown", label: "情绪阶段待确认" } },
  });

  assert.equal(result.structuralCycle, "未知");
  assert.equal(result.status, "unavailable");
  assert.equal(result.transition.key, "repair_observed");
  assert.equal(result.smallCycle.key, "repair");
  assert.equal(result.integrity.bigCycleCanonical, false);
  assert.equal(result.integrity.repairCannotBeBigCycle, true);
});

test("三轴组合器把小周期修复加强与指数5日转弱分别输出", () => {
  const result = buildMarketPhaseDetail({
    generationContext: CURRENT_GENERATION,
    marketState: {
      structuralCycle: "主升",
      generationContext: CURRENT_GENERATION,
      dailyState: { key: "repair_strengthening", label: "修复加强", generationContext: CURRENT_GENERATION },
      profitEffect: { score: 90, label: "赚钱效应强" },
      lossEffect: { score: 10.1, label: "亏钱效应较低" },
      tradeWindow: { marketGate: [{ key: "core", passed: false }], coreEvidence: [] },
    },
    indexCycleRegime: {
      generationContext: CURRENT_GENERATION,
      structuralCycle: "主升",
      mediumTerm: { key: "repair", label: "中期修复", confirmed: true },
      shortTerm: { windowDays: 5, key: "weakening", label: "全市场5日短周期转弱", confirmed: true },
      intraday: {
        key: "recovery_strong_close",
        label: "探底回升并收于高位",
        session: { key: "recovery_strong_close", label: "探底回升并收于高位" },
      },
      indexSubPhase: { key: "weakening_structure", label: "转弱结构·暂无主升细分" },
      dataQuality: { grade: "complete" },
    },
    emotionCycle: {
      bigCycle: fiveDayBigCycle("main_rise", "主升"),
      current: { key: "unknown", label: "情绪阶段待确认" },
    },
  });

  assert.equal(result.smallCycle.key, "repair_strengthening");
  assert.equal(result.smallCycle.label, "修复加强");
  assert.equal(result.indexShortStructure.key, "weakening");
  assert.equal(result.indexShortStructure.windowDays, 5);
  assert.equal(result.indexShortStructure.label, "全市场5日短周期转弱");
  assert.equal(result.indexShortStructure.conflictWithSmallCycle, true);
  assert.equal(result.dailyRhythm.label, "修复加强");
});

test("旧v4十日快照不能在指数5日结构标题下冒充新口径", () => {
  const result = buildMarketPhaseDetail({
    generationContext: CURRENT_GENERATION,
    marketState: {
      structuralCycle: "主升",
      dailyState: { key: "repair", label: "修复" },
    },
    indexCycleRegime: {
      version: 4,
      shortTerm: {
        key: "main_rise",
        label: "全市场10日短周期主升",
        confirmed: true,
        metrics: { aboveMa10KnownCount: 4, aboveMa10Count: 4, aboveMa10Rate: 1 },
      },
      smallCycle: {
        key: "strengthening",
        label: "加强",
        indexStructure: { key: "main_rise", label: "全市场10日短周期主升" },
      },
    },
    emotionCycle: {
      bigCycle: fiveDayBigCycle("main_rise", "主升"),
      current: { key: "repair", label: "修复" },
    },
  });

  assert.equal(result.indexShortStructure.key, "unknown");
  assert.equal(result.indexShortStructure.status, "unavailable");
  assert.equal(result.indexShortStructure.windowDays, null);
  assert.equal(result.indexShortStructure.label, "指数5日结构待确认");
  assert.doesNotMatch(JSON.stringify(result.indexShortStructure), /10日短周期/);
});

test("情绪大周期必须覆盖指数和旧缓存兼容字段", () => {
  const result = buildMarketPhaseDetail({
    marketState: { structuralCycle: "修复", cycle: "混沌" },
    indexCycleRegime: {
      structuralCycle: "震荡",
      mediumTerm: { key: "repair_candidate", label: "中期修复·主升候选", confirmed: true },
      shortTerm: { windowDays: 5, key: "range", label: "全市场5日短周期震荡", confirmed: true },
      indexSubPhase: { key: "range_structure", label: "震荡结构·暂无主升细分" },
      dataQuality: { grade: "complete" },
    },
    emotionCycle: {
      bigCycle: fiveDayBigCycle("chaos", "混沌"),
      current: { key: "support", phaseKey: "support", label: "承接" },
    },
  });

  assert.equal(result.structuralCycle, "混沌");
  assert.notEqual(result.structuralCycle, "震荡");
  assert.equal(result.structuralCycleAuthority.emotionDriven, true);
  assert.equal(result.structuralCycleAuthority.indexCanOverride, false);
});

test("只改变指数均线周期不能改变情绪大周期", () => {
  const base = strongDivergenceInput();
  const weakening = buildMarketPhaseDetail({
    ...base,
    indexCycleRegime: {
      ...base.indexCycleRegime,
      structuralCycle: "退潮",
      shortTerm: { windowDays: 5, key: "weakening", label: "全市场5日短周期转弱", confirmed: true },
      mediumTerm: { key: "decline", label: "中期走弱", confirmed: true },
    },
  });
  const strengthening = buildMarketPhaseDetail({
    ...base,
    indexCycleRegime: {
      ...base.indexCycleRegime,
      structuralCycle: "主升",
      shortTerm: { windowDays: 5, key: "main_rise", label: "全市场5日短周期主升", confirmed: true },
      mediumTerm: { key: "main_rise", label: "中期主升", confirmed: true },
    },
  });

  assert.equal(weakening.structuralCycle, "主升");
  assert.equal(strengthening.structuralCycle, "主升");
  assert.equal(weakening.structuralCycle, strengthening.structuralCycle);
});

test("指数轴缺失不能抹掉已确认的情绪大周期", () => {
  const result = buildMarketPhaseDetail({
    indexCycleRegime: {},
    emotionCycle: {
      bigCycle: fiveDayBigCycle("range", "震荡"),
      current: { key: "support", phaseKey: "support", label: "承接" },
      tomorrowBaseline: { key: "strengthen", label: "承接确认后再加强", rank: 1 },
    },
  });

  assert.equal(result.status, "available");
  assert.equal(result.structuralCycle, "震荡");
  assert.equal(result.integrity.indexRiskAvailable, false);
  assert.equal(result.integrity.indexMissingCannotOverrideBigCycle, true);
});

test("阶段组合器按同代强度择优，较弱 index transition 不能覆盖修复加强", () => {
  const result = buildMarketPhaseDetail({
    generationContext: CURRENT_GENERATION,
    indexCycleRegime: {
      generationContext: CURRENT_GENERATION,
      structuralCycle: "混沌",
      mediumTerm: { key: "repair", label: "中期修复", confirmed: true },
      shortTerm: { windowDays: 5, key: "repair", label: "5日短周期修复", confirmed: true },
      indexSubPhase: { key: "chaos_structure", label: "混沌结构·等待方向形成" },
      transition: repairTransitionFixture("repair_observed"),
      dataQuality: { grade: "complete" },
    },
    marketState: {
      generationContext: CURRENT_GENERATION,
      structuralResolution: {
        generationContext: CURRENT_GENERATION,
        transition: repairTransitionFixture("repair_strengthening"),
      },
    },
    emotionCycle: {
      generationContext: CURRENT_GENERATION,
      bigCycle: fiveDayBigCycle("chaos", "混沌"),
      current: { key: "repair", phaseKey: "repair", label: "情绪修复" },
    },
  });

  assert.equal(result.structuralCycle, "混沌");
  assert.equal(result.transition.key, "repair_strengthening");
  assert.equal(result.transition.from, "退潮");
  assert.equal(result.transition.to, "混沌");
  assert.equal(result.transition.confirmationTarget.label, "震荡待确认");
  assert.equal(result.transition.composition.selectedSource, "marketState.structuralResolution.transition");
  assert.equal(result.transition.composition.downgradePrevented, true);
  assert.equal(result.integrity.transitionTargetCanonical, true);
  assert.equal(result.integrity.transitionGenerationAligned, true);
});

test("错代修复加强不得覆盖同代修复观察", () => {
  const staleGeneration = {
    generationId: "2026-08-26:2026-08-26T07:36:00.000Z",
    tradingDate: "2026-08-26",
    asOf: "2026-08-26T07:36:00.000Z",
  };
  const result = buildMarketPhaseDetail({
    generationContext: CURRENT_GENERATION,
    indexCycleRegime: {
      generationContext: CURRENT_GENERATION,
      structuralCycle: "混沌",
      mediumTerm: { key: "range", label: "中期震荡", confirmed: true },
      shortTerm: { windowDays: 5, key: "range", label: "5日短周期震荡", confirmed: true },
      indexSubPhase: { key: "chaos_structure", label: "混沌结构·等待方向形成" },
      transition: repairTransitionFixture("repair_observed"),
      dataQuality: { grade: "complete" },
    },
    marketState: {
      structuralResolution: {
        generationContext: staleGeneration,
        transition: repairTransitionFixture("repair_strengthening", staleGeneration),
      },
    },
    emotionCycle: {
      generationContext: CURRENT_GENERATION,
      bigCycle: fiveDayBigCycle("chaos", "混沌"),
      current: { key: "repair", phaseKey: "repair", label: "情绪修复" },
    },
  });

  assert.equal(result.transition.key, "repair_observed");
  assert.equal(result.transition.to, null);
  assert.equal(result.transition.composition.strongerRejected, true);
  assert.ok(result.transition.composition.rejected.some((row) => row.reasonCode === "candidate_generation_mismatch"));
});

test("过渡候选缺少代次时失败关闭，不能借较强文案升级", () => {
  const result = buildMarketPhaseDetail({
    generationContext: CURRENT_GENERATION,
    indexCycleRegime: {
      structuralCycle: "退潮",
      mediumTerm: { key: "repair_candidate", label: "中期修复·震荡候选", confirmed: true },
      shortTerm: { windowDays: 5, key: "repair", label: "5日短周期修复", confirmed: true },
      indexSubPhase: { key: "retreat_structure", label: "退潮结构·暂无主升细分" },
      transition: repairTransitionFixture("repair_strengthening", null),
      dataQuality: { grade: "complete" },
    },
    emotionCycle: {
      generationContext: CURRENT_GENERATION,
      bigCycle: fiveDayBigCycle("retreat", "退潮"),
      current: { key: "repair", phaseKey: "repair", label: "情绪修复" },
    },
  });

  assert.equal(result.structuralCycle, "退潮");
  assert.equal(result.transition.key, "unavailable");
  assert.equal(result.transition.status, "unavailable");
  assert.equal(result.transition.to, null);
  assert.equal(result.transition.reasonCode, "transition_generation_missing");
  assert.equal(result.integrity.bigCycleCanonical, true);
  assert.equal(result.integrity.transitionGenerationAligned, false);
});
