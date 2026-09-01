"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildEmotionScenarioInference,
  validateEmotionScenarioInference,
} = require("./emotion-scenario-inference");

const GENERATION = Object.freeze({
  generationId: "2026-08-28:scenario-test",
  tradingDate: "2026-08-28",
  asOf: "2026-08-28T15:30:00.000Z",
});

function coreRow(code, state, positive, negative) {
  return {
    code,
    name: code,
    currentState: state,
    positiveInfluenceScore: positive,
    negativeInfluenceScore: negative,
    signedInfluenceScore: positive - negative,
    selectionAuthority: false,
    executionAuthority: false,
  };
}

function fixture(options = {}) {
  const coreState = options.coreState || "support";
  const negativeCase = options.negative === true;
  const mixedCase = options.mixed === true;
  const positive = negativeCase ? 25 : mixedCase ? 80 : 180;
  const negative = negativeCase ? 190 : mixedCase ? 75 : 30;
  const weightedScores = negativeCase
    ? { support_repair: 20, divergence: 30, negative_feedback: 180, participating: 0 }
    : mixedCase
      ? { support_repair: 70, divergence: 75, negative_feedback: 35, participating: 0 }
      : { support_repair: 170, divergence: 25, negative_feedback: 20, participating: 0 };
  const profit = negativeCase ? 25 : mixedCase ? 55 : 82;
  const loss = negativeCase ? 78 : mixedCase ? 50 : 15;
  const bigCycle = negativeCase ? "retreat" : mixedCase ? "range" : "main_rise";
  const smallCycle = negativeCase ? "weakening" : mixedCase ? "range" : "repair";
  const payload = {
    ...GENERATION,
    generationContext: { ...GENERATION },
    market: {
      state: {
        emotionEffectContext: {
          status: "ready",
          tradingDate: "20260828",
          scores: { profit, loss },
          profit: { coveragePct: 90 },
          loss: { coveragePct: 90 },
          observations: { limitUpCount: negativeCase ? 24 : 80, limitDownCount: negativeCase ? 30 : 2 },
        },
      },
    },
    emotionCycle: {
      ...GENERATION,
      generationContext: { ...GENERATION },
      bigCycle: {
        key: bigCycle,
        window: {
          status: "available",
          windowDays: 5,
          metrics: {
            completeDays: 5,
            weightedProfitScore: profit,
            weightedLossScore: loss,
            weightedCoreContinuityScore: negativeCase ? 25 : mixedCase ? 45 : 70,
          },
          confirmation: {
            fullWindowComplete: true,
            recentTwoStates: [bigCycle, bigCycle],
          },
        },
      },
    },
    marketPhaseDetail: {
      ...GENERATION,
      generationContext: { ...GENERATION },
      structuralCycle: bigCycle,
      smallCycle: { key: smallCycle, label: smallCycle },
      indexShortStructure: { key: smallCycle, label: smallCycle },
      dailyRhythm: { key: smallCycle, label: smallCycle },
      tomorrowBaseline: { key: "baseline", label: "规则基准", status: "baseline_unconfirmed" },
      decisionContext: {
        speculationPreference: {
          status: "available",
          conclusionStatus: "confirmed",
          items: [{ status: "confirmed", key: "boardEmotion", label: "连板", score: negativeCase ? 30 : mixedCase ? 58 : 82, sampleCount: 12 }],
        },
      },
    },
    tomorrowDecision: {
      tomorrowBaseline: { key: "baseline", label: "规则基准", status: "baseline_unconfirmed" },
    },
  };
  const strictEmotionCores = [
    coreRow("600001", coreState, positive * 0.55, negative * 0.55),
    coreRow("600002", coreState, positive * 0.45, negative * 0.45),
  ];
  const emotionCoreEvidence = {
    ...GENERATION,
    generation: { ...GENERATION },
    status: "ready",
    strictEmotionCores,
    summary: { influence: { positiveTotal: positive, negativeTotal: negative, signedTotal: positive - negative } },
    emotionStagePath: {
      nodes: {
        previous: { status: options.previousStatus || "ready" },
        current: { status: "ready", key: coreState, label: coreState, weightedScores },
      },
    },
  };
  return { payload, emotionCoreEvidence };
}

test("健康修复证据使修复延续成为第一顺位，且三情景权重合计100", () => {
  const input = fixture();
  const result = buildEmotionScenarioInference({ ...input, generation: GENERATION });

  assert.equal(result.status, "ready");
  assert.equal(result.primaryScenario.key, "repair_or_consensus");
  assert.equal(result.scenarios.reduce((sum, row) => sum + row.modelWeightPct, 0), 100);
  assert.equal(result.calibrated, false);
  assert.equal(result.probability, null);
  assert.equal(result.guardrails.executionAuthority, false);
  assert.equal(result.guardrails.selectionAuthority, false);
  assert.equal(validateEmotionScenarioInference(result, GENERATION), true);
});

test("核心负反馈、全市场亏钱扩散与退潮结构共同使负反馈扩散成为第一顺位", () => {
  const input = fixture({ negative: true, coreState: "negative_feedback" });
  const result = buildEmotionScenarioInference({ ...input, generation: GENERATION });

  assert.equal(result.status, "ready");
  assert.equal(result.primaryScenario.key, "negative_feedback_expansion");
});

test("正负接近且结构震荡时分歧延续成为第一顺位", () => {
  const input = fixture({ mixed: true, coreState: "divergence" });
  const result = buildEmotionScenarioInference({ ...input, generation: GENERATION });

  assert.equal(result.status, "ready");
  assert.equal(result.primaryScenario.key, "divergence_continuation");
});

test("T-1严格核心不足时允许输出当下推演，但可信度封顶65", () => {
  const input = fixture({ previousStatus: "insufficient" });
  const result = buildEmotionScenarioInference({ ...input, generation: GENERATION });

  assert.equal(result.status, "ready");
  assert.ok(result.confidence.score <= 65);
  assert.equal(result.confidence.previousLineageStatus, "insufficient");
});

test("关键证据组缺失时失败关闭，不强行归一化成百分比", () => {
  const input = fixture();
  delete input.payload.market.state.emotionEffectContext;
  const result = buildEmotionScenarioInference({ ...input, generation: GENERATION });

  assert.equal(result.status, "insufficient");
  assert.deepEqual(result.scenarios, []);
  assert.equal(result.confidence.canShowPercentages, false);
  assert.ok(result.dataQuality.reasonCodes.some((reason) => reason.includes("profitLoss")));
});

test("错代情绪核心或市场阶段整体不可用，不能沿用旧推演", () => {
  const input = fixture();
  input.emotionCoreEvidence.generationId = "old-generation";
  const result = buildEmotionScenarioInference({ ...input, generation: GENERATION });

  assert.equal(result.status, "unavailable");
  assert.equal(result.integrity.sameGeneration, false);
  assert.deepEqual(result.scenarios, []);
});

test("纯推演函数不得修改原始行情、核心证据或明日决策", () => {
  const input = fixture();
  const before = JSON.parse(JSON.stringify(input));
  buildEmotionScenarioInference({ ...input, generation: GENERATION });
  assert.deepEqual(input, before);
});
