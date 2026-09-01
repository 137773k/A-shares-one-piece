"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildPreplanScenarioWorkbench,
  validatePreplanScenarioWorkbench,
  FORBIDDEN_OBSERVATION_KEYS,
} = require("./preplan-scenario-workbench");

const GENERATION = {
  generationId: "2026-08-28:workbench",
  tradingDate: "2026-08-28",
  asOf: "2026-08-28T15:30:00.000Z",
};

function observation(code, hardGatePassed = true) {
  return {
    code,
    name: `股票${code}`,
    path: "boardEmotion",
    pathLabel: "连板情绪",
    role: "市场核心",
    hardGatePassed,
    observationReason: "次日仍有条件预期",
    expectation: { status: "qualified", label: "核心溢价 / 晋级验证" },
    opportunityDataCompleteness: { status: "complete", qualified: true, opportunityEligible: true },
    executionFeasibility: { status: "conditional", executableNow: false, blockers: [] },
    entryConfirmation: { status: "waiting_trigger", reason: "等待真实分歧", triggerConditions: ["充分换手", "板块同步"], invalidation: "高标A杀" },
    postEntryNextDayExpectation: { status: "conditional", label: "核心溢价 / 晋级验证", riskLabel: "分歧兑现", premise: "仅作条件观察", probability: null, calibrated: false },
    missingConditions: hardGatePassed ? ["竞价与开盘后出现主动承接", "统一交易授权尚未开放"] : ["原交易硬门槛未通过：均线结构", "不属于当前主线方向"],
    observationOnly: true,
    executable: false,
    executionAuthority: false,
  };
}

function fixture() {
  return {
    ...GENERATION,
    generationContext: { ...GENERATION },
    tomorrowDecision: {
      emotionScenarioInference: {
        version: 1,
        status: "ready",
        calibrated: false,
        probability: null,
        ...GENERATION,
        scenarios: [
          { key: "repair_or_consensus", label: "修复延续", modelWeightPct: 60, rank: 1, probability: null, calibrated: false },
          { key: "divergence_continuation", label: "分歧延续", modelWeightPct: 22.4, rank: 2, probability: null, calibrated: false },
          { key: "negative_feedback_expansion", label: "负反馈扩散", modelWeightPct: 17.6, rank: 3, probability: null, calibrated: false },
        ],
        confidence: { score: 65, label: "中等" },
        guardrails: { observationOnly: true, selectionAuthority: false, executionAuthority: false, positionAuthority: false, probabilityAuthority: false },
      },
    },
    unifiedDecisionChain: {
      version: 3,
      authority: "canonical_stock_decision",
      generation: { ...GENERATION },
      observationCandidates: {
        status: "available",
        observationOnly: true,
        executionAuthority: false,
        stocks: [observation("600001"), observation("600002"), observation("600003"), observation("600004", false), observation("600005", false)],
      },
    },
  };
}

test("正式计划0份时仍投影3份条件剧本和2份诊断观察", () => {
  const payload = fixture();
  const result = buildPreplanScenarioWorkbench(payload, { formalPlans: [] });

  assert.equal(result.dataStatus, "ready");
  assert.equal(result.executionStatus, "closed");
  assert.equal(result.conditionalScripts.length, 3);
  assert.equal(result.diagnosticOnly.length, 2);
  assert.equal(result.formalPlans.length, 0);
  assert.equal(result.posture.key, "observe_for_activation");
  assert.equal(validatePreplanScenarioWorkbench(result, GENERATION), true);
});

test("条件剧本不得携带买卖、仓位、订单或执行权限", () => {
  const result = buildPreplanScenarioWorkbench(fixture(), { formalPlans: [] });
  result.conditionalScripts.forEach((row) => {
    FORBIDDEN_OBSERVATION_KEYS.forEach((key) => assert.equal(key in row, false));
    assert.equal(row.observationOnly, true);
    assert.equal(row.executable, false);
    assert.equal(row.executionAuthority, false);
    assert.equal(row.positionAuthority, false);
    assert.equal(row.checkpointPlan[0].status, "pending");
    assert.equal(row.checkpointPlan[1].status, "pending");
  });
});

test("正式计划与条件剧本按代码去重且正式计划来源保持独立", () => {
  const payload = fixture();
  const formalPlans = [{ code: "600001", name: "股票600001", buy: "正式计划" }];
  const result = buildPreplanScenarioWorkbench(payload, { formalPlans });

  assert.equal(result.executionStatus, "open");
  assert.equal(result.formalPlans.length, 1);
  assert.equal(result.conditionalScripts.some((row) => row.code === "600001"), false);
  assert.equal(result.integrity.formalAndObservationDisjoint, true);
});

test("情景权重被篡改或合计不为100时整体失败关闭", () => {
  const payload = fixture();
  payload.tomorrowDecision.emotionScenarioInference.scenarios[0].modelWeightPct = 99;
  const result = buildPreplanScenarioWorkbench(payload, { formalPlans: [] });

  assert.equal(result.dataStatus, "unavailable");
  assert.equal(result.conditionalScripts.length, 0);
  assert.equal(result.executionStatus, "closed");
});

test("观察池错代时不能生成条件剧本", () => {
  const payload = fixture();
  payload.unifiedDecisionChain.generation.generationId = "old-generation";
  const result = buildPreplanScenarioWorkbench(payload, { formalPlans: [] });

  assert.equal(result.dataStatus, "unavailable");
  assert.equal(result.conditionalScripts.length, 0);
});

test("投影过程不修改原始payload", () => {
  const payload = fixture();
  const before = JSON.parse(JSON.stringify(payload));
  buildPreplanScenarioWorkbench(payload, { formalPlans: [] });
  assert.deepEqual(payload, before);
});
