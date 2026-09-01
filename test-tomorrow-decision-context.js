"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TOMORROW_DECISION_CONTEXT_VERSION,
  buildTomorrowDecisionContext,
} = require("./tomorrow-decision-context");

function currentObservationInput() {
  return {
    generationId: "2026-08-20:closing",
    tradingDate: "2026-08-20",
    asOf: "2026-08-20T15:00:00+08:00",
    marketPhaseDetail: {
      structuralCycle: "震荡",
      structuralCycleDetail: {
        key: "range",
        label: "震荡",
        status: "canonical",
        horizon: "rolling_5_trading_days",
        windowDays: 5,
        window: {
          status: "available",
          observations: ["14", "17", "18", "19", "20"].map((day) => ({
            tradingDate: `2026-08-${day}`,
            complete: true,
          })),
        },
        source: "five_day_weighted_emotion_big_cycle_window_v1",
        reasonCode: "two_day_range_confirmed",
        reason: "五日窗口确认震荡。",
        evidence: ["五日窗口完整"],
        generationContext: {
          generationId: "2026-08-20:closing",
          tradingDate: "2026-08-20",
          asOf: "2026-08-20T15:00:00+08:00",
        },
      },
      emotionStage: {
        key: "unavailable",
        label: "情绪阶段待确认",
        reason: "严格核心证据不足",
      },
    },
    indexCycleRegime: {
      shortTerm: {
        key: "range",
        windowDays: 5,
        label: "全市场5日短周期震荡",
        confirmed: true,
      },
      intraday: {
        fiveDay: { key: "weakening", label: "5日节奏转弱" },
        session: { key: "mixed", label: "分时震荡、强弱混合" },
      },
      indexSubPhase: { key: "structure_pending", label: "细分阶段待确认" },
    },
    marketState: {
      dailyState: { key: "repair_strengthening", label: "修复加强", baseCycleHint: "修复/回暖" },
      profitEffect: { trend: "improving" },
      lossEffect: { trend: "improving" },
    },
    previousMarketState: {
      lossEffect: { score: 76.3, level: "severe", label: "亏钱效应严重" },
    },
    limitStats: {
      ztToday: 78,
      ztPrev: 36,
      dtToday: 11,
      dtPrev: 118,
    },
    tradingStylePreference: {
      paths: {
        lowLaunch: { status: "active", score: 81.2 },
        boardEmotion: {
          status: "candidate",
          score: 58.9,
          sampleCount: 16,
          confirmation: {
            scorePass: false,
            independentSamplePass: true,
            crossSourcePass: true,
            coreStructurePass: true,
          },
        },
        highTrend: {
          status: "candidate",
          score: 72.3,
          sampleCount: 13,
          confirmation: {
            scorePass: true,
            independentSamplePass: true,
            crossSourcePass: true,
            coreStructurePass: false,
          },
        },
      },
    },
    themeLibrary: {
      roleCounts: { "补涨": 2 },
      themes: [{ themeCycle: { sustained: true, resonance: true } }],
    },
  };
}

test("明日决策阅读层把震荡大周期、冰点反弹过渡和震荡分歧分轴输出", () => {
  const result = buildTomorrowDecisionContext(currentObservationInput());

  assert.equal(result.version, TOMORROW_DECISION_CONTEXT_VERSION);
  assert.equal(result.generationId, "2026-08-20:closing");
  assert.equal(result.bigCycle.key, "range");
  assert.equal(result.bigCycle.label, "震荡");
  assert.equal(result.bigCycle.status, "canonical");
  assert.equal(result.bigCycle.horizon, "rolling_5_trading_days");
  assert.equal(result.bigCycle.windowDays, 5);
  assert.equal(result.bigCycle.reasonCode, "two_day_range_confirmed");
  assert.equal(result.bigCycle.reason, "五日窗口确认震荡。");
  assert.deepEqual(result.bigCycle.evidence, ["五日窗口完整"]);
  assert.equal(result.transition.key, "ice_rebound");
  assert.equal(result.transition.label, "冰点反弹观察");
  assert.match(result.transition.evidence.join("；"), /涨停36→78.*跌停118→11/);
  assert.equal(result.smallCycle.key, "range_divergence");
  assert.equal(result.smallCycle.label, "震荡分歧");
  assert.equal(result.emotionStage.label, "分歧");
  assert.equal(result.emotionStage.authority, "observation_only");
  assert.deepEqual(result.speculationPreference.labels, ["低位", "连板", "趋势", "补涨"]);
  assert.deepEqual(result.speculationPreference.confirmedLabels, ["低位"]);
  assert.deepEqual(result.speculationPreference.observedLabels, ["连板", "趋势", "补涨"]);
  assert.equal(result.speculationPreference.conclusionStatus, "confirmed");
  assert.match(result.speculationPreference.reason, /趋势核心结构未确认/);
  assert.deepEqual(result.speculationPreference.gaps, [
    "连板规则分未达确认线（当前58.9分）",
    "趋势核心结构未确认",
  ]);
  assert.deepEqual(result.speculationPreference.confirmationConditions, [
    "连板规则分达到确认线",
    "趋势形成可核验的核心结构",
  ]);
  assert.match(result.speculationPreference.reason, /资金更偏向低位与补涨/);
  assert.equal(result.speculationPreference.affectsTradePermission, false);
  assert.deepEqual(result.guardrails, {
    observationOnly: true,
    emotionStageAuthority: false,
    tradePermissionAuthority: false,
    candidateAuthority: false,
    probabilityAuthority: false,
  });
});

test("marketPhaseDetail 情绪镜像可优先展示，但不得冒充严格核心确认", () => {
  const input = currentObservationInput();
  input.marketPhaseDetail.emotionStage = {
    key: "strong_divergence",
    label: "强分歧",
    reason: "当日阶段镜像",
  };
  const result = buildTomorrowDecisionContext(input);

  assert.equal(result.smallCycle.label, "震荡分歧");
  assert.equal(result.emotionStage.label, "强分歧");
  assert.equal(result.emotionStage.status, "observed");
  assert.equal(result.emotionStage.source, "market_phase_detail.emotion_stage");
  assert.equal(result.emotionStage.authority, "observation_only");
  assert.equal(result.emotionStage.observationOnly, true);
});

test("输入缺失时保持待确认，不从涨跌停数量单独猜出周期或偏好", () => {
  const result = buildTomorrowDecisionContext({
    marketPhaseDetail: { structuralCycle: "未知", emotionStage: {} },
    limitStats: { ztToday: 100, dtToday: 0 },
  });

  assert.equal(result.bigCycle.status, "unavailable");
  assert.equal(result.bigCycle.label, "大周期待确认");
  assert.equal(result.smallCycle.status, "unavailable");
  assert.equal(result.smallCycle.label, "小周期待确认");
  assert.equal(result.emotionStage.status, "unavailable");
  assert.deepEqual(result.speculationPreference.labels, []);
  assert.equal(result.speculationPreference.status, "unavailable");
  assert.deepEqual(result.speculationPreference.gaps, [
    "全市场资金路径模型未生成，缺少低位启动、连板情绪和高位趋势三条路径数据",
  ]);
  assert.deepEqual(result.speculationPreference.confirmationConditions, [
    "生成与本次明日决策同代的全市场资金路径模型",
  ]);
  assert.match(result.speculationPreference.reason, /全市场资金路径模型未生成/);
});

test("明日决策不能用旧 marketState 或 T-1 状态补齐当前宏观大周期", () => {
  const input = currentObservationInput();
  input.marketPhaseDetail.structuralCycle = "未知";
  input.marketState.cycle = "混沌";
  input.marketState.structuralCycle = "主升";
  input.previousMarketState.cycle = "退潮";
  input.previousMarketState.structuralCycle = "冰点";

  const result = buildTomorrowDecisionContext(input);

  assert.equal(result.bigCycle.status, "unavailable");
  assert.equal(result.bigCycle.label, "大周期待确认");
});

test("炒作偏好只有候选时说明具体失败项和确认条件，不误写未出现的路径", () => {
  const input = currentObservationInput();
  input.tradingStylePreference = {
    paths: {
      lowLaunch: { status: "inactive", score: 45 },
      boardEmotion: {
        status: "candidate",
        score: 58,
        sampleCount: 16,
        confirmation: {
          confirmed: false,
          scorePass: false,
          independentSamplePass: true,
          crossSourcePass: false,
          coreStructurePass: false,
        },
      },
      highTrend: { status: "inactive", score: 48 },
    },
  };
  input.themeLibrary = { roleCounts: { "补涨": 0 }, themes: [] };

  const result = buildTomorrowDecisionContext(input);

  assert.equal(result.speculationPreference.status, "available");
  assert.equal(result.speculationPreference.conclusionStatus, "observation_only");
  assert.deepEqual(result.speculationPreference.confirmedLabels, []);
  assert.deepEqual(result.speculationPreference.observedLabels, ["连板"]);
  assert.ok(result.speculationPreference.gaps.includes("连板规则分未达确认线（当前58分）"));
  assert.ok(result.speculationPreference.gaps.includes("连板双榜交叉样本未通过"));
  assert.ok(result.speculationPreference.gaps.includes("连板核心结构未确认"));
  assert.ok(result.speculationPreference.confirmationConditions.includes("连板规则分达到确认线"));
  assert.ok(result.speculationPreference.confirmationConditions.includes("连板双榜交叉样本通过校验"));
  assert.ok(result.speculationPreference.confirmationConditions.includes("连板形成可核验的核心结构"));
  assert.match(result.speculationPreference.reason, /连板仍属候选观察/);
  assert.doesNotMatch(result.speculationPreference.reason, /趋势仍属候选观察/);
});
