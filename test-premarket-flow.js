"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  FLOW_STEPS,
  FLOW_STEP_KEYS,
  buildPremarketFlow,
} = require("./premarket-flow");
const { buildThemeLibrarySnapshot } = require("./theme-library");
const { buildTradingStylePreference } = require("./trading-style-preference");

function completePayload(overrides = {}) {
  const candidate = {
    code: "300001",
    name: "测试核心",
    role: "中军",
    mainConcept: "算力方向",
    price: 12.5,
    changePct: 3.2,
    amountYi: 18.6,
    tradeQualified: true,
    hardGate: { pass: true },
    priceIntegrity: {
      price: 12.5,
      valid: true,
      consistent: true,
      status: "pass",
    },
    leadership: {
      identity: "主动容量核心",
      tradeQualified: true,
    },
    tomorrowExecution: {
      stateLabel: "等待承接",
      tomorrowEntryQualified: true,
      triggers: ["首次回踩承接有效"],
      cancelConditions: ["跌破首次承接低点"],
    },
    buy: {
      status: "conditional",
      summary: "只按既有触发条件执行",
      observationZone: { priceRange: [12.1, 12.4] },
    },
    hold: { status: "after_fill", summary: "成交后按结构持有" },
    sell: { status: "conditional", hardStop: { priceRange: [11.8, 12] } },
    holdingPeriod: { display: "1-3个交易日" },
  };

  const payload = {
    updatedAt: "2026-08-10T15:30:00.000Z",
    indexOpportunity: {
      key: "index_repair",
      label: "指数修复",
      cycle: "修复",
      tone: "good",
      verified: true,
      allowTrade: true,
      summary: "指数结构处于修复",
      avgIndexChange: 0,
      breadth: 0.63,
      evidence: ["主要指数结构已验证"],
      structures: [{
        code: "000001",
        name: "上证指数",
        close: 3900,
        changePct: 0,
        trendKey: "repair",
        trendLabel: "修复",
      }],
    },
    market: {
      snapshot: { totalAmountYi: 20000 },
      externalRisk: {
        available: true,
        level: "低风险",
        risk: 0,
        penalty: 0,
        reasons: ["外围只作低风险修正"],
      },
      state: {
        position: "30%-50%",
        tradeWindow: {
          key: "warming_watch",
          label: "市场回暖·等待确认",
          tone: "warn",
          allowNew: false,
          allowAdd: false,
          positionGuide: "核心确认后再执行",
          summary: "交易窗口仍需确认",
        },
      },
      tradingStyle: {
        style: "板块轮动",
        preference: "轮动回流",
        bias: "只做回流第一强",
        topDirection: "算力方向",
        topMembers: 12,
        analysis: {
          conclusion: "当前风格偏好为轮动回流",
          reverseLogic: ["样本分布显示轮动回流"],
          examples: [
            { code: "300001", name: "测试核心", effectType: "轮动回流" },
            { code: "300002", name: "独立样本", effectType: "轮动回流" },
          ],
          profitEffect: {
            continuity: "中",
            continuityReasons: ["次日需要回流确认"],
          },
        },
      },
    },
    forecast: {
      calibrated: false,
      primary: { key: "range_divergence", label: "震荡分化", probability: 55 },
      evidence: [{ scope: "index", detail: "指数结构证据" }],
      sentimentCycle: {
        marketRegime: { key: "repair", label: "修复" },
        aggregateStage: "divergence",
        aggregateStageLabel: "分歧兑现",
        expectedTransition: { key: "support_validation", label: "验证承接", probability: 48 },
        divergenceSize: "small",
        divergenceQuality: "healthy",
        verification: ["观察核心承接是否扩散"],
        coreBasket: {
          selectedCandidateCode: "300001",
          selectedCandidateExcludedFromPositiveValidation: true,
          positiveIndependentCount: 1,
          negativeHighImpactCount: 1,
          independentAcceleratedCount: 2,
        },
        items: [
          { code: "300001", name: "测试核心", stage: "supported", selectedCandidate: false, impact: 90 },
          { code: "300002", name: "独立样本", stage: "supported", selectedCandidate: false, impact: 88 },
        ],
      },
    },
    marketEmotion: {
      allowTrade: true,
      cycle: "修复",
      light: "yellow",
      lightLabel: "黄灯",
      summary: "修复期分歧",
      action: "先验证承接",
      evidence: ["独立核心出现承接"],
    },
    marketStrengthSource: {
      external: {
        available: true,
        label: "外围没有形成强刺激",
        evidence: ["外围科技指数偏弱但未形成系统压力"],
      },
    },
    topicBoard: {
      conclusion: "算力方向可继续观察",
      mainLine: {
        name: "算力方向",
        family: "科技",
        displayName: "科技 / 算力方向",
        isCoreDirection: true,
        label: "可继续观察",
        summary: "方向结构仍在",
        count: 12,
        limitCount: 2,
        resonance: true,
        relativeToIndex: 1.2,
        reasons: ["板块与指数形成共振"],
      },
      items: [],
    },
    leadershipBoard: { focusDirection: "算力方向" },
    bestPicks: {
      executionVersion: 3,
      available: true,
      priceIntegrity: { status: "pass" },
      picks: [candidate],
      note: "已有一只条件候选",
    },
    tomorrowDecision: {
      action: { summary: "只在既有触发成立时执行" },
      validation: {
        upgrade: ["独立核心同步加强"],
        downgrade: ["负反馈扩散"],
      },
      invalidation: { conditions: ["指数结构失效"] },
    },
  };

  return Object.assign(payload, overrides);
}

test("固定输出宏观到微观六步，完整已有字段可形成可执行计划", () => {
  const flow = buildPremarketFlow(completePayload());

  assert.deepEqual(FLOW_STEP_KEYS, [
    "indexOpportunity",
    "direction",
    "tradingPreference",
    "emotionStage",
    "stocks",
    "tradePlan",
  ]);
  assert.deepEqual(FLOW_STEPS.map((step) => step.order), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(flow.steps.map((step) => step.key), FLOW_STEP_KEYS);
  assert.ok(flow.steps.every((step) => step.status === "ready"));
  assert.equal(flow.indexOpportunity.metrics.avgIndexChange, 0, "来源中的真 0 必须保留");
  assert.equal(flow.indexOpportunity.tradeWindow.label, "市场回暖·等待确认");
  assert.equal(flow.indexOpportunity.positionGuide, "核心确认后再执行");
  assert.equal(flow.indexOpportunity.positionLimit, "30%-50%");
  assert.equal(flow.indexOpportunity.externalRisk.label, "低风险");
  assert.equal(flow.indexOpportunity.externalRisk.penalty, 0);
  assert.ok(flow.indexOpportunity.evidence.includes("外围只作低风险修正"));
  assert.ok(flow.indexOpportunity.evidence.includes("外围科技指数偏弱但未形成系统压力"));
  assert.equal(flow.indexOpportunity.status, "ready", "交易窗口等待不能反向改写指数结论");
  assert.equal(flow.tradingPreference.preference, "轮动回流");
  assert.equal(flow.emotionStage.stage, "divergence");
  assert.equal(flow.direction.primary.name, "算力方向");
  assert.equal(flow.stocks.candidates[0].code, "300001");
  assert.equal(flow.tradePlan.canIssueAdvice, true);
  assert.equal(flow.tradePlan.plans.length, 1);
  assert.deepEqual(flow.tradePlan.plans[0].buy.observationZone.priceRange, [12.1, 12.4]);
});

test("正式盘前计划在legacy 80%与chain 10%冲突时只投影canonicalAllocation", () => {
  const payload = completePayload();
  const candidate = payload.bestPicks.picks[0];
  candidate.position = "80%";
  candidate.stopLossPlan = { position: "80%" };
  candidate.advice = { position: "80%" };
  candidate.selectionAuthority = "unified_decision_chain_v3";
  candidate.canonicalAllocation = {
    relativeWeightPct: 100,
    initialPortfolioPct: 10,
    maximumPortfolioPct: 30,
  };
  candidate.positionAllocation = { ...candidate.canonicalAllocation };
  payload.bestPicks.selectionAuthority = "unified_decision_chain_v3";
  payload.bestPicks.decisionChainVersion = 3;
  payload.unifiedDecisionChain = {
    version: 3,
    authority: "canonical_stock_decision",
    result: { selectedCodes: [candidate.code], stocks: [{ code: candidate.code, positionAllocation: candidate.canonicalAllocation }] },
  };

  const flow = buildPremarketFlow(payload);
  const plan = flow.tradePlan.plans[0];
  assert.equal(plan.canonicalAllocation.initialPortfolioPct, 10);
  assert.equal(plan.position.initialPortfolioPct, 10, "兼容position也只能镜像canonical 10%");
  assert.equal(plan.allocationAuthority, "unified_decision_chain_v3");
  assert.equal(plan.legacyObservation.position.topLevel, "80%");
  assert.equal(plan.legacyObservation.position.stopLossPlan, "80%");
  assert.equal(plan.legacyObservation.position.advice, "80%");
  assert.equal(plan.legacyObservation.executionAuthority, false);
  assert.equal(flow.integrity.canonicalAllocationOnly, true);
});

test("缺失和非法数字保持 null，不伪装成 0", () => {
  const flow = buildPremarketFlow({
    indexOpportunity: {
      label: "结构待核验",
      avgIndexChange: "",
      breadth: undefined,
      structures: [{ code: "000001", close: "not-a-number" }],
    },
    market: { tradingStyle: { preference: "轮动" } },
  });

  assert.equal(flow.indexOpportunity.metrics.avgIndexChange, null);
  assert.equal(flow.indexOpportunity.metrics.breadth, null);
  assert.equal(flow.indexOpportunity.metrics.totalAmountYi, null);
  assert.equal(flow.indexOpportunity.structures[0].close, null);
  assert.equal(flow.tradingPreference.counts.topMembers, null);
});

test("指数显式不可做时，否决从第一步级联到全部下游且不输出计划", () => {
  const payload = completePayload();
  payload.indexOpportunity.allowTrade = false;
  const flow = buildPremarketFlow(payload);

  assert.equal(flow.indexOpportunity.status, "blocked");
  assert.equal(flow.indexOpportunity.permission, "blocked");
  for (const step of flow.steps.slice(1)) {
    assert.equal(step.status, "blocked");
    assert.ok(step.blockedBy.includes("indexOpportunity"));
  }
  assert.equal(flow.blockedAt, "indexOpportunity");
  assert.equal(flow.tradePlan.canIssueAdvice, false);
  assert.deepEqual(flow.tradePlan.plans, []);
});

test("新版多周期指数模型优先于旧修复标签，并把中短日内与机会风险完整传递", () => {
  const payload = completePayload();
  payload.indexOpportunity = {
    ...payload.indexOpportunity,
    allowTrade: false,
    label: "指数修复/回暖",
    summary: "旧版二元均线结论",
  };
  payload.premarketModels = {
    version: 2,
    indexCycleRegime: {
      version: 1,
      summary: "中期修复·主升候选；上证短线主升段·全市场待共振；探底回升并收于高位。",
      mediumTerm: { key: "repair_candidate", label: "中期修复·主升候选", confirmed: true, evidence: ["3/4个主要指数站上20日线"] },
      shortTerm: { windowDays: 5, key: "partial_main_rise", label: "上证短线主升段·全市场待共振", confirmed: true, evidence: ["上证5日短周期保持上行"] },
      intraday: { key: "recovery_strong_close", label: "探底回升并收于高位", tone: "good", confirmed: true, evidence: ["全A收于日内高位"] },
      marketConsensus: { key: "pending", label: "全市场待共振", confirmed: false, reasons: ["只有部分指数进入短线主升"] },
      opportunities: [{ key: "ma5_support", label: "主升节奏回踩", trigger: ["5日斜率仍向上"] }],
      warnings: [{ key: "partial", label: "全市场未共振", detail: "不能按全面主升扩仓" }],
      tomorrowPaths: [{ key: "healthy_pullback", label: "5日线调整", permission: "keep_reduced" }],
      validation: { strengthen: ["创业板与科创50转强"] },
      positionPermission: {
        key: "conditional_reduced",
        label: "条件允许·降一级仓位",
        allowNew: true,
        allowAdd: false,
        positionRangePct: [30, 50],
      },
      dataQuality: { grade: "complete", missing: [] },
    },
  };

  const flow = buildPremarketFlow(payload);
  assert.equal(flow.indexOpportunity.status, "ready");
  assert.equal(flow.indexOpportunity.permission, "allowed");
  assert.equal(flow.indexOpportunity.conclusion, payload.premarketModels.indexCycleRegime.summary);
  assert.equal(flow.indexOpportunity.mediumTerm.key, "repair_candidate");
  assert.equal(flow.indexOpportunity.shortTerm.key, "partial_main_rise");
  assert.equal(flow.indexOpportunity.intradayRhythm.key, "recovery_strong_close");
  assert.equal(flow.indexOpportunity.marketConsensus.confirmed, false);
  assert.equal(flow.indexOpportunity.positionLimit, "30%-50%");
  assert.equal(flow.indexOpportunity.opportunities[0].key, "ma5_support");
  assert.equal(flow.indexOpportunity.warnings[0].key, "partial");
  assert.equal(flow.indexOpportunity.tomorrowPaths[0].key, "healthy_pullback");
  assert.ok(flow.indexOpportunity.evidence.includes("上证5日短周期保持上行"));
  assert.equal(payload.indexOpportunity.label, "指数修复/回暖", "投影不能回写旧字段");
});

test("指数未显式表态但市场仓位为零时，宏观层必须阻断全部买卖计划", () => {
  const payload = completePayload();
  delete payload.indexOpportunity.allowTrade;
  payload.market.state.position = "0%，禁止新开仓";
  const flow = buildPremarketFlow(payload);

  assert.equal(flow.indexOpportunity.permission, "blocked");
  assert.equal(flow.indexOpportunity.status, "blocked");
  assert.equal(flow.blockedAt, "indexOpportunity");
  assert.equal(flow.tradePlan.canIssueAdvice, false);
  assert.deepEqual(flow.tradePlan.plans, []);
});

test("marketEmotion.observationOnly 是模块属性，不得误判成情绪禁仓", () => {
  const payload = completePayload();
  delete payload.marketEmotion.allowTrade;
  payload.marketEmotion.observationOnly = true;
  const flow = buildPremarketFlow(payload);

  assert.equal(flow.indexOpportunity.status, "ready");
  assert.equal(flow.tradingPreference.status, "ready");
  assert.equal(flow.emotionStage.status, "ready");
  assert.equal(flow.direction.status, "ready");
  assert.equal(flow.stocks.status, "ready");
  assert.equal(flow.tradePlan.status, "ready");
  assert.equal(flow.blockedAt, null);
});

test("只有明确情绪禁仓字段或红灯才从情绪阶段向后级联", () => {
  for (const emotionOverride of [
    { riskBlockNewEntry: true },
    { allowNew: false },
    { light: "red", lightLabel: "红灯" },
  ]) {
    const payload = completePayload();
    payload.marketEmotion = { ...payload.marketEmotion, ...emotionOverride };
    const flow = buildPremarketFlow(payload);
    assert.equal(flow.emotionStage.status, "blocked");
    assert.equal(flow.direction.status, "blocked", "题材池可用但最终方向被情绪否决时，公开状态必须同步阻断");
    assert.equal(flow.direction.poolStatus, "ready", "题材池自身状态仍单独保留为ready");
    assert.equal(flow.direction.confirmation.status, "blocked");
    assert.ok(flow.direction.confirmation.blockedBy.includes("emotionStage"));
    assert.equal(flow.stocks.status, "blocked");
    assert.equal(flow.tradePlan.status, "blocked");
    assert.equal(flow.blockedAt, "emotionStage");
  }
});

test("候选票从炒作偏好案例和情绪独立验证篮子中剔除，不能自证市场", () => {
  const payload = completePayload();
  payload.forecast.sentimentCycle.coreBasket.selectedCandidateExcludedFromPositiveValidation = false;
  const flow = buildPremarketFlow(payload);

  assert.deepEqual(flow.tradingPreference.independentExamples.map((item) => item.code), ["300002"]);
  assert.deepEqual(flow.tradingPreference.excludedCandidateCodes, ["300001"]);
  assert.deepEqual(
    flow.emotionStage.independentCoreValidation.items.map((item) => item.code),
    ["300002"],
  );
  assert.equal(flow.emotionStage.independentCoreValidation.candidateExcluded, true);
  assert.equal(flow.emotionStage.independentCoreValidation.sourceReportedExclusion, false, "来源自报字段原样保留，投影层仍强制剔除");
  assert.equal(flow.emotionStage.independentCoreValidation.positiveIndependentCount, null, "来源明确未剔除候选时，不得信任其正向计数");
  assert.deepEqual(flow.integrity.excludedCandidateCodes, ["300001"]);
});

test("新版炒作偏好拆分三条资金路径，且没有合格案例时禁止旧样本补位", () => {
  const payload = completePayload();
  payload.premarketModels = {
    version: 2,
    tradingStylePreference: {
      version: 1,
      marketOrganization: { key: "dual_path", label: "双路径并行", evidence: ["连板与低位启动同时活跃"] },
      dominantPath: { key: "parallel", label: "连板情绪 + 低位启动", status: "parallel" },
      paths: {
        highTrend: { key: "highTrend", label: "高位趋势", score: 78, status: "active", stage: "trend_continuation", evidence: ["趋势核心仍有承接"] },
        lowLaunch: { key: "lowLaunch", label: "低位启动", score: 86, status: "active", stage: "fermenting", evidence: ["先锋与容量结构同时存在"] },
        boardEmotion: { key: "boardEmotion", label: "连板情绪", score: 87, status: "active", stage: "emotion_climax", evidence: ["多只中高标同步"] },
      },
      executionPreference: { primary: "回封", secondary: ["低吸"], summary: "优先回封；一致加速不追板" },
      opportunities: [{ key: "board_core_reseal", title: "核心充分换手回封" }],
      cautions: [{ key: "no_rotation_alias", text: "板块轮动不等于轮动回流" }],
      representatives: { highTrend: [], lowLaunch: [], boardEmotion: [], total: 0, note: "无合格案例" },
      tomorrowPaths: [{ key: "orderly_realization", label: "高位兑现、低位承接" }],
      directionPermission: { screeningStatus: "allowed", executionStatus: "blocked", executionLabel: "禁止生成可执行案例" },
    },
  };

  const flow = buildPremarketFlow(payload);
  assert.equal(flow.tradingPreference.style, "双路径并行");
  assert.equal(flow.tradingPreference.preference, "连板情绪 + 低位启动");
  assert.equal(flow.tradingPreference.bias, "优先回封；一致加速不追板");
  assert.equal(flow.tradingPreference.paths.boardEmotion.stage, "emotion_climax");
  assert.deepEqual(flow.tradingPreference.independentExamples, []);
  assert.equal(JSON.stringify(flow.tradingPreference).includes("300002"), false, "旧轮动样本不得回填新版空案例");
  assert.equal(flow.tradingPreference.executionBlocked, true);
  assert.equal(flow.tradePlan.canIssueAdvice, false);
  assert.deepEqual(flow.tradePlan.plans, []);
});

test("炒作偏好投影保留Top100覆盖状态与观察代表，但不把观察代表授权为执行载体", () => {
  const payload = completePayload();
  payload.premarketModels = {
    version: 2,
    tradingStylePreference: {
      version: 2,
      method: "rule_derived",
      conclusionState: "quotes_pending",
      sourceCoverage: {
        east: 100,
        ths: 100,
        union: 145,
        intersection: 55,
        quoteUsable: 0,
        quotePending: 145,
        rankingsState: "ready",
        quoteState: "pending",
      },
      marketOrganization: { key: "single_path", label: "单路径主导", evidence: ["连板情绪确认"] },
      dominantPath: { key: "boardEmotion", label: "连板情绪", status: "dominant", paths: ["boardEmotion"] },
      paths: {
        highTrend: { key: "highTrend", label: "高位趋势", status: "candidate", evidence: [] },
        lowLaunch: { key: "lowLaunch", label: "低位启动", status: "candidate", evidence: [] },
        boardEmotion: { key: "boardEmotion", label: "连板情绪", status: "active", evidence: ["双榜交叉7只"] },
      },
      executionPreference: { primary: "回封", summary: "优先回封", methods: {} },
      observationRepresentatives: {
        highTrend: [],
        lowLaunch: [],
        boardEmotion: [{
          code: "600664",
          name: "哈药股份",
          role: "情绪主锚",
          concept: "医药",
          eastRank: 2,
          thsRank: 5,
          crossListed: true,
          executable: false,
          quoteState: "pending",
        }],
      },
      representatives: { highTrend: [], lowLaunch: [], boardEmotion: [], total: 0 },
      directionPermission: { executionStatus: "blocked", activePaths: ["boardEmotion"], primaryEligibleCarrierCodes: [] },
    },
  };

  const flow = buildPremarketFlow(payload);
  assert.equal(flow.tradingPreference.preference, "连板情绪");
  assert.equal(flow.tradingPreference.conclusionState, "quotes_pending");
  assert.equal(flow.tradingPreference.sourceCoverage.intersection, 55);
  assert.equal(flow.tradingPreference.independentExamples[0].name, "哈药股份");
  assert.equal(flow.tradingPreference.independentExamples[0].crossListed, true);
  assert.equal(flow.tradingPreference.independentExamples[0].executable, false);
  assert.deepEqual(flow.tradingPreference.representatives.boardEmotion, []);
  assert.equal(flow.tradingPreference.executionBlocked, true);
});

test("新版情绪状态只展示真实锚点，并传递高潮后的三种次日路径", () => {
  const payload = completePayload();
  payload.premarketModels = {
    version: 2,
    emotionCycle: {
      version: 1,
      current: { key: "climax", label: "高潮", confidence: 68, reason: "高位连板加速后段，医药局部一致高潮", crossDayVerified: false },
      previous: { available: false, key: "unknown", label: "阶段待确认" },
      transition: { independentSampleCount: 4, primaryAnchorCount: 3, roleCount: 2 },
      metrics: {
        heat: { score: 67, highAnchorCount: 3 },
        support: { score: 73, knownCount: 2, unknownCount: 2 },
        damage: { score: 8, harmfulAnchorCount: 0 },
      },
      anchorLayers: { A: [], B: [], C: [] },
      rankedAnchors: [
        {
          code: "300001",
          name: "测试核心",
          layer: "A",
          layerLabel: "情绪主锚",
          anchorRoleLabel: "候选票",
          anchorScore: 99,
          excludedFromMarketState: true,
          influenceWeightPct: 0,
          profitEffectScore: 96,
          profitEffectWeightPct: 0,
          priceDiscoveryType: "turnover_reseal",
          priceDiscovery: { label: "换手开板后回封", evidence: ["真实回封"] },
          profitEffect: { evidence: ["赚钱效应96分"] },
        },
        { code: "600721", name: "百花医药", layer: "A", layerLabel: "情绪主锚", anchorRoleLabel: "高度核心", anchorScore: 100, current: { oneWord: true }, support: { score: null, status: "unknown" } },
        { code: "600664", name: "哈药股份", layer: "A", layerLabel: "情绪主锚", anchorRoleLabel: "人气龙头", anchorScore: 95, support: { score: null, status: "unknown" } },
      ],
      tomorrowPaths: [
        { key: "strengthen", label: "情绪继续加强" },
        { key: "diverge", label: "高潮后兑现" },
        { key: "weaken", label: "非良性分歧/退潮" },
      ],
      tomorrowBaseline: { key: "diverge", label: "兑现优先·先看承接", rank: 1 },
      guardrails: { oneWordSupportUnknown: true, selectedCandidateCannotSelfValidate: true },
      dataQuality: { exactPreviousTradingDay: false, notes: ["缺少精确T-1，不伪造跨日承接"] },
    },
  };

  const flow = buildPremarketFlow(payload);
  assert.equal(flow.emotionStage.cycle, "高位短线情绪");
  assert.equal(flow.emotionStage.stage, "climax");
  assert.equal(flow.emotionStage.stageLabel, "高潮");
  assert.equal(flow.emotionStage.currentEmotion.reason, "高位连板加速后段，医药局部一致高潮");
  assert.deepEqual(flow.emotionStage.rankedAnchors.map((row) => row.name), ["百花医药", "哈药股份"]);
  assert.equal(flow.emotionStage.rankedAnchors[0].support.score, null, "一字板不得伪造承接分");
  assert.deepEqual(flow.emotionStage.tomorrowPaths.map((row) => row.key), ["strengthen", "diverge", "weaken"]);
  assert.equal(flow.emotionStage.expectedTransition.label, "兑现优先·先看承接");
  assert.equal(flow.emotionStage.expectedTransition.probability, null);
  assert.equal(flow.emotionStage.divergence.size, null);
  assert.deepEqual(flow.emotionStage.isolatedAnchors.map((row) => row.code), ["300001"]);
  assert.equal(flow.emotionStage.isolatedAnchors[0].excludedFromMarketState, true);
  assert.equal(flow.emotionStage.isolatedAnchors[0].influenceWeightPct, 0, "推荐票不得参与市场影响权重");
  assert.equal(flow.emotionStage.isolatedAnchors[0].profitEffectScore, 96, "隔离不得抹掉真实赚钱效应");
  assert.equal(flow.emotionStage.isolatedAnchors[0].profitEffectWeightPct, 0, "推荐票不得用赚钱效应为自身授权");
  assert.equal(flow.emotionStage.isolatedAnchors[0].priceDiscoveryType, "turnover_reseal");
  assert.equal(flow.emotionStage.rankedAnchors.some((row) => row.code === "300001"), false);
  assert.equal(flow.emotionStage.independentCoreValidation.items.some((row) => row.code === "300001"), false);
});

test("有效 themeLibrary 是方向和角色唯一权威源，医药不被旧 topicBoard 拆回分支", () => {
  const payload = completePayload();
  payload.themeLibrary = {
    available: true,
    themes: [{
      id: "医药",
      rank: 1,
      name: "医药",
      displayName: "医药",
      family: "医药",
      aliases: ["流感", "肝炎概念", "CRO概念"],
      subthemes: ["流感", "肝炎概念", "CRO概念"],
      medicalParent: true,
      isMainLine: true,
      label: "可观察",
      summary: "医药母题材统一观察",
      reasons: ["流感、肝炎和 CRO 统一归入医药", "龙头：昭衍新药"],
      roleCounts: { "龙头": 1, "先锋": 0, "中军": 1, "补涨": 0 },
      stocks: [
        {
          code: "600664",
          name: "哈药股份",
          primaryRole: "龙头",
          price: 7.52,
          tags: [{ key: "leader", label: "龙头", reason: "趋势辨识度领先", verified: true }],
        },
        {
          code: "603259",
          name: "药明康德",
          primaryRole: "中军",
          price: 161.34,
          tags: [{ key: "capacity", label: "中军", reason: "成交承接领先", verified: true }],
        },
      ],
    }],
  };
  payload.topicBoard = {
    conclusion: "旧口径",
    mainLine: { name: "CRO概念", summary: "旧分支", leader: { code: "603127", name: "昭衍新药" } },
    items: [{ name: "流感" }, { name: "肝炎概念" }],
  };
  const flow = buildPremarketFlow(payload);

  assert.equal(flow.direction.source, "themeLibrary");
  assert.equal(flow.direction.primary.name, "医药");
  assert.equal(flow.direction.primary.medicalParent, true);
  assert.deepEqual(flow.direction.items.map((item) => item.name), ["医药"]);
  assert.deepEqual(flow.direction.primary.stocks.map((stock) => stock.name), ["哈药股份", "药明康德"]);
  assert.equal(flow.direction.primary.roleCounts.leader, 1);
  assert.deepEqual(flow.direction.eligibleDirections, [], "没有 style carrier 时不伪造交集方向");
  assert.deepEqual(flow.direction.allowedStockCodes, ["600664", "603259"], "没有 style carrier 时保留旧主方向授权行为");
  assert.equal(JSON.stringify(flow.direction).includes("昭衍新药"), false, "旧角色和陈旧理由都不得回填");
  assert.equal(JSON.stringify(flow.direction).includes("CRO概念"), true, "分支仅作为医药别名/细分标签保留");
});

test("canonical themeLibrary 最多授权三个与 style carrier 相交且有方向证据的方向", () => {
  const payload = completePayload();
  payload.bestPicks.picks[0].code = "600001";
  payload.bestPicks.picks[0].name = "科技核心";
  payload.bestPicks.picks[0].mainConcept = "科技";
  payload.premarketModels = {
    tradingStylePreference: {
      version: 1,
      method: "rule_derived",
      available: true,
      marketOrganization: { label: "多方向并行", evidence: ["医药与科技同时活跃"] },
      dominantPath: { label: "多路径载体", status: "parallel" },
      executionPreference: { summary: "只做有方向证据的风格载体" },
      directionPermission: {
        executionStatus: "conditional",
        primaryEligibleCarrierCodes: ["300001", "600001", "600002", "600003", "600004"],
      },
    },
  };
  payload.themeLibrary = {
    available: true,
    themes: [
      {
        name: "医药",
        isMainLine: true,
        stocks: [
          { code: "300001", name: "医药核心" },
          { code: "300101", name: "医药中军" },
        ],
      },
      { name: "科技", resonance: true, stocks: [{ code: "600001", name: "科技核心" }] },
      { name: "机器人", sustained: true, stocks: [{ code: "600002", name: "机器人核心" }] },
      { name: "消费", isCoreDirection: true, stocks: [{ code: "600003", name: "消费核心" }] },
      { name: "仅有载体无方向证据", stocks: [{ code: "600004", name: "无证据载体" }] },
      { name: "有证据但无载体交集", resonance: true, stocks: [{ code: "600005", name: "无交集核心" }] },
    ],
  };

  const flow = buildPremarketFlow(payload);

  assert.equal(flow.direction.primary.name, "医药", "primary 字段继续保留旧兼容语义");
  assert.deepEqual(flow.direction.eligibleDirections.map((item) => item.name), ["医药", "科技", "机器人"]);
  assert.deepEqual(flow.direction.allowedStockCodes, ["300001", "300101", "600001", "600002"]);
  assert.equal(flow.direction.allowedStockCodes.includes("600003"), false, "第四个合格方向不得越过三方向上限");
  assert.equal(flow.direction.allowedStockCodes.includes("600004"), false, "只有载体交集但无方向证据不得授权");
  assert.equal(flow.direction.allowedStockCodes.includes("600005"), false, "只有方向证据但无载体交集不得授权");
  assert.equal(flow.stocks.candidates[0].code, "600001");
  assert.equal(flow.stocks.candidates[0].qualified, true, "合格次方向载体可进入原有个股门槛交集");
});

test("有效但暂为空的 themeLibrary 也不回退到 legacy topicBoard", () => {
  const payload = completePayload();
  payload.themeLibrary = { available: true, themes: [] };
  payload.topicBoard = { mainLine: { name: "旧方向" }, items: [{ name: "旧方向" }] };
  const flow = buildPremarketFlow(payload);

  assert.equal(flow.direction.source, "themeLibrary");
  assert.equal(flow.direction.primary, null);
  assert.deepEqual(flow.direction.items, []);
  assert.equal(flow.direction.status, "blocked");
});

test("候选价格异常时清空具体买卖建议并阻断最后一步", () => {
  const payload = completePayload();
  const candidate = payload.bestPicks.picks[0];
  candidate.price = 12.5;
  candidate.priceIntegrity = {
    price: 12.5,
    valid: true,
    consistent: false,
    status: "warn",
  };
  const rawBuy = JSON.parse(JSON.stringify(candidate.buy));
  const flow = buildPremarketFlow(payload);
  const projected = flow.stocks.candidates[0];

  assert.equal(projected.priceIntegrity.status, "blocked");
  assert.ok(projected.priceIntegrity.reasons.includes("price_inconsistent"));
  assert.equal(projected.advice, null);
  assert.equal(projected.adviceBlocked, true);
  assert.equal(flow.stocks.status, "blocked");
  assert.equal(flow.tradePlan.canIssueAdvice, false);
  assert.deepEqual(flow.tradePlan.plans, []);
  assert.deepEqual(candidate.buy, rawBuy, "安全清洗不能回写或篡改输入 payload");
});

test("缺少正价格时同样禁止具体建议；正价格但无建议不会凭空生成", () => {
  const missingPrice = completePayload();
  delete missingPrice.bestPicks.picks[0].price;
  delete missingPrice.bestPicks.picks[0].priceIntegrity;
  let flow = buildPremarketFlow(missingPrice);
  assert.equal(flow.stocks.candidates[0].price, null);
  assert.equal(flow.stocks.candidates[0].advice, null);
  assert.equal(flow.tradePlan.canIssueAdvice, false);

  const noAdvice = completePayload();
  const candidate = noAdvice.bestPicks.picks[0];
  delete candidate.buy;
  delete candidate.hold;
  delete candidate.sell;
  delete candidate.holdingPeriod;
  delete candidate.tomorrowExecution.triggers;
  delete candidate.tomorrowExecution.cancelConditions;
  flow = buildPremarketFlow(noAdvice);
  assert.equal(flow.stocks.candidates[0].advice, null);
  assert.deepEqual(flow.tradePlan.plans, []);
});

test("未通过次日交易资格的股票只可观察，不得生成买卖计划", () => {
  const payload = completePayload();
  payload.bestPicks.picks[0].tomorrowExecution.tomorrowEntryQualified = false;
  const flow = buildPremarketFlow(payload);

  assert.equal(flow.stocks.candidates[0].qualified, false);
  assert.equal(flow.stocks.candidates[0].adviceBlocked, false, "价格有效不等于交易资格有效");
  assert.equal(flow.stocks.status, "blocked");
  assert.equal(flow.blockedAt, "stocks");
  assert.deepEqual(flow.stocks.unqualifiedCandidateCodes, ["300001"]);
  assert.equal(flow.tradePlan.canIssueAdvice, false);
  assert.deepEqual(flow.tradePlan.plans, []);
});

test("canonical model unavailable fails closed and never falls back to legacy strong labels", () => {
  const cases = [
    ["indexCycleRegime", "indexOpportunity"],
    ["tradingStylePreference", "tradingPreference"],
    ["emotionCycle", "emotionStage"],
  ];
  for (const [key, blockedAt] of cases) {
    const payload = completePayload();
    payload.premarketModels = {
      version: 2,
      [key]: { version: 1, method: "unavailable", available: false },
    };
    const flow = buildPremarketFlow(payload);
    assert.equal(flow.blockedAt, blockedAt);
    assert.equal(flow[blockedAt].status, "blocked");
    assert.equal(flow.tradePlan.canIssueAdvice, false);
    assert.equal(flow.tradePlan.executionMode, "blocked");
    if (key === "tradingStylePreference") {
      assert.equal(flow.tradingPreference.preference, null);
      assert.deepEqual(flow.tradingPreference.independentExamples, []);
    }
    if (key === "emotionCycle") assert.equal(flow.emotionStage.stage, null);
  }
});

test("canonical theme library unavailable blocks direction and cannot revive legacy topicBoard", () => {
  const payload = completePayload();
  payload.themeLibrary = {
    schemaVersion: 1,
    classifierVersion: "theme-library-v2",
    available: false,
    themes: [],
  };
  payload.topicBoard = {
    mainLine: { name: "CRO概念", leader: { code: "603127", name: "昭衍新药" } },
    items: [{ name: "流感" }, { name: "肝炎概念" }],
  };
  const flow = buildPremarketFlow(payload);
  assert.equal(flow.direction.source, "themeLibrary-unavailable");
  assert.equal(flow.direction.status, "blocked");
  assert.equal(flow.direction.primary, null);
  assert.equal(flow.direction.focusDirection, null);
  assert.equal(flow.direction.conclusion, "题材库不可用，方向判断已暂停");
  assert.equal(flow.blockedAt, "direction");
  assert.equal(JSON.stringify(flow.direction).includes("昭衍新药"), false);
  assert.equal(JSON.stringify(flow.direction).includes("CRO"), false);
  assert.equal(flow.tradePlan.canIssueAdvice, false);
});

test("candidate execution qualification is an intersection and incomplete lifecycle advice is blocked", () => {
  let payload = completePayload();
  payload.bestPicks.picks[0].leadership.tradeQualified = false;
  let flow = buildPremarketFlow(payload);
  assert.equal(flow.stocks.candidates[0].qualificationGates.tomorrowEntryQualified, true);
  assert.equal(flow.stocks.candidates[0].qualificationGates.leadershipTradeQualified, false);
  assert.equal(flow.stocks.candidates[0].qualified, false);
  assert.equal(flow.tradePlan.canIssueAdvice, false);

  payload = completePayload();
  delete payload.bestPicks.picks[0].hold;
  flow = buildPremarketFlow(payload);
  assert.deepEqual(flow.stocks.candidates[0].adviceIntegrity.missing, ["hold"]);
  assert.equal(flow.stocks.candidates[0].advice, null);
  assert.equal(flow.stocks.candidates[0].adviceBlocked, true);
  assert.equal(flow.tradePlan.canIssueAdvice, false);
});

test("execution v3 requires every candidate gate to be explicitly true", () => {
  const payload = completePayload();
  const candidate = payload.bestPicks.picks[0];
  delete candidate.tradeQualified;
  delete candidate.leadership;
  delete candidate.hardGate;
  const flow = buildPremarketFlow(payload);
  assert.deepEqual(flow.stocks.candidates[0].missingRequiredGates.sort(), [
    "candidateTradeQualified",
    "hardGatePassed",
    "leadershipTradeQualified",
  ]);
  assert.equal(flow.stocks.candidates[0].qualified, false);
  assert.equal(flow.tradePlan.canIssueAdvice, false);
  assert.deepEqual(flow.tradePlan.plans, []);
});

test("canonical tomorrow decision is the only executable candidate whitelist", () => {
  const payload = completePayload();
  const extra = JSON.parse(JSON.stringify(payload.bestPicks.picks[0]));
  extra.code = "300099";
  extra.name = "非主路径备选";
  payload.bestPicks.picks.push(extra);
  payload.bestPicks.scenarioPlans = [{ key: "weakRepair", candidate: extra }];
  payload.tomorrowDecision = {
    ...payload.tomorrowDecision,
    version: 1,
    method: "rule_prior",
    candidates: [payload.bestPicks.picks[0]],
    contingencies: [extra],
  };
  const flow = buildPremarketFlow(payload);
  assert.deepEqual(flow.stocks.candidates.map((row) => row.code), ["300001"]);
  assert.deepEqual(flow.integrity.excludedCandidateCodes.sort(), ["300001", "300099"]);
  assert.equal(flow.tradePlan.plans.some((row) => row.code === "300099"), false);
});

test("climax permission produces support-conditional plan rather than immediate entry", () => {
  const payload = completePayload();
  payload.premarketModels = {
    version: 2,
    emotionCycle: {
      version: 1,
      method: "anchor_hcd_state_machine",
      current: { key: "climax", label: "高潮", confidence: 68 },
      rankedAnchors: [
        { code: "600721", name: "百花医药", layer: "A", anchorScore: 100 },
        { code: "600664", name: "哈药股份", layer: "A", anchorScore: 95 },
        { code: "001001", name: "独立换手锚", layer: "B", anchorScore: 82 },
      ],
      tomorrowBaseline: { key: "diverge", label: "兑现优先·先看承接" },
      tomorrowPaths: [{ key: "diverge", isBaseline: true, rank: 1 }],
      executionPermission: {
        status: "wait_for_support",
        immediateEntry: false,
        conditionalAfterSupport: true,
        allowAdd: false,
      },
    },
  };
  const flow = buildPremarketFlow(payload);
  assert.equal(flow.emotionStage.permission, "conditional_after_support");
  assert.equal(flow.emotionStage.status, "ready");
  assert.equal(flow.tradePlan.canIssueAdvice, true);
  assert.equal(flow.tradePlan.executionMode, "conditional_after_support");
  assert.equal(flow.tradePlan.plans[0].executionMode, "conditional_after_support");
});

test("输入对象保持只读，不因投影而发生修改", () => {
  const payload = completePayload();
  const before = JSON.stringify(payload);
  buildPremarketFlow(payload);
  assert.equal(JSON.stringify(payload), before);
});

test("浏览器直接加载时暴露 globalThis.PremarketFlow", () => {
  const source = fs.readFileSync(path.join(__dirname, "premarket-flow.js"), "utf8");
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: "premarket-flow.js" });

  assert.equal(typeof sandbox.PremarketFlow.buildPremarketFlow, "function");
  assert.deepEqual(
    Array.from(sandbox.PremarketFlow.FLOW_STEP_KEYS),
    FLOW_STEP_KEYS,
  );
});

test("真实 hot-stocks 快照可安全投影，且六步公共契约完整", () => {
  const cachePath = path.join(__dirname, ".hot-stocks-cache.json");
  if (!fs.existsSync(cachePath)) return;
  const payload = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const flow = buildPremarketFlow(payload);

  assert.deepEqual(flow.stepOrder, FLOW_STEP_KEYS);
  assert.equal(flow.steps.length, 6);
  flow.steps.forEach((step, index) => {
    assert.equal(step.order, index + 1);
    assert.ok(["ready", "unknown", "blocked"].includes(step.status));
    assert.ok(Array.isArray(step.blockedBy));
    assert.ok(Array.isArray(step.evidence));
  });
  assert.equal(flow.integrity.candidateSelfProofExcluded, true);
  assert.equal(flow.integrity.unknownNumbersPreservedAsNull, true);
  assert.equal(flow.integrity.concreteAdviceRequiresUsablePrice, true);
  if (payload.marketEmotion && payload.marketEmotion.observationOnly === true) {
    assert.notEqual(flow.emotionStage.ownBlocked, true, "实盘 observationOnly 不得成为情绪层自身否决");
    const canonicalEmotion = payload.premarketModels && payload.premarketModels.emotionCycle || {};
    const canonicalPermission = canonicalEmotion.executionPermission || {};
    const hasIndependentCanonicalBlock = canonicalEmotion.available === false
      || canonicalEmotion.method === "unavailable"
      || ["harmful", "retreat"].includes(String(canonicalEmotion.current && canonicalEmotion.current.key || ""))
      || canonicalPermission.status === "blocked"
      || (canonicalPermission.immediateEntry === false && canonicalPermission.conditionalAfterSupport !== true);
    if (!hasIndependentCanonicalBlock) {
      assert.ok(!flow.emotionStage.blockedBy.includes("emotionStage"), "情绪层可继承上游阻断，但不得把 observationOnly 记成自身阻断");
    }
  }
  if (payload.themeLibrary && payload.themeLibrary.available !== false) {
    assert.equal(flow.direction.source, "themeLibrary");
  }
});

test("阶段2题材池把主池验证、主池观察和Hot Top100新发现严格分层", () => {
  const hotMain = {
    code: "600001",
    name: "主池热榜核心",
    mainFamily: "AI算力",
    mainConcept: "CPO",
    concepts: ["CPO"],
    eastRank: 3,
    thsRank: 6,
    combinedRank: 4,
    role: "龙头",
    changePct: 10,
  };
  const themeOnly = {
    code: "600002",
    name: "主池观察股",
    mainFamily: "国防军工",
    concepts: ["国防军工"],
    role: "中军",
    changePct: 2,
  };
  const hotOnly = {
    code: "600003",
    name: "热榜新方向",
    mainFamily: "低空经济",
    mainConcept: "飞行汽车",
    concepts: ["飞行汽车"],
    eastRank: 8,
    thsRank: 12,
    combinedRank: 9,
    changePct: 6,
  };
  const snapshot = buildThemeLibrarySnapshot({
    sources: {
      eastmoney: 100,
      ths: 100,
      hotRanks: {
        eastmoney: { actualCount: 100 },
        ths: { actualCount: 100 },
      },
    },
    topicBoard: {
      mainLine: { name: "AI算力", family: "AI算力" },
      items: [
        { name: "AI算力", family: "AI算力", aliases: ["CPO"], isMainLine: true, resonance: true, leader: hotMain },
        { name: "国防军工", family: "国防军工", sustained: true, zhongjun: themeOnly },
      ],
    },
    candidates: [hotMain, themeOnly, hotOnly],
  });

  assert.equal(snapshot.poolContractVersion, 1);
  assert.deepEqual(snapshot.candidateThemePool.confirmationThemeIds, ["AI算力"]);
  assert.deepEqual(snapshot.candidateThemePool.retainedObservationThemeIds, ["国防军工"]);
  assert.equal(snapshot.candidateThemePool.hotOnlyDiscoveries[0].name, "低空经济");
  assert.equal(snapshot.candidateThemePool.hotOnlyDiscoveries[0].directExecutionEligible, false);
  assert.equal(snapshot.candidateThemePool.hotOnlyDiscoveries[0].directionConfirmationEligible, false);
});

test("全市场风格只看Hot Top100并集，不读取题材预选或selected扩充评分样本", () => {
  const marketRows = [
    { code: "000001", name: "双榜样本", eastRank: 1, thsRank: 2, changePct: 5, mainConcept: "算力" },
    { code: "000002", name: "东财样本", eastRank: 2, changePct: 3, mainConcept: "医药" },
  ];
  const basePayload = {
    sources: { eastmoney: 100, ths: 100 },
    candidates: marketRows,
    themeLibrary: { candidateThemePool: { confirmationThemeIds: ["算力"] } },
  };
  const base = buildTradingStylePreference(basePayload);
  const injected = buildTradingStylePreference({
    ...basePayload,
    selected: [{ code: "999999", name: "下游预选票", changePct: 20, mainConcept: "预选题材" }],
  });

  assert.deepEqual(injected.paths, base.paths);
  assert.equal(injected.analysisScope.universe, "whole_market_hot_top100_union");
  assert.equal(injected.analysisScope.themePreselectionUsedForScoring, false);
  assert.equal(injected.analysisScope.decisionCandidatesUsedForScoring, false);
  assert.equal(injected.analysisScope.scoredMarketSampleCount, 2);
});

test("公开流程题材筛选前置，但最终方向仍须通过独立风格与情绪确认", () => {
  const payload = completePayload();
  payload.themeLibrary = {
    schemaVersion: 1,
    poolContractVersion: 1,
    available: true,
    candidateThemePool: {
      version: 1,
      source: "theme_library_main",
      available: true,
      mainThemeIds: ["算力方向"],
      priorityVerificationThemeIds: ["算力方向"],
      confirmationThemeIds: ["算力方向"],
      retainedObservationThemeIds: [],
      hotOnlyDiscoveries: [{ id: "热榜新题材", name: "热榜新题材", directExecutionEligible: false }],
    },
    themes: [{
      id: "算力方向",
      name: "算力方向",
      family: "科技",
      isMainLine: true,
      resonance: true,
      summary: "主池方向等待全市场验证",
      stocks: [{ code: "300001", name: "测试核心", tags: [{ label: "中军", verified: true }] }],
    }],
  };
  const flow = buildPremarketFlow(payload);

  assert.deepEqual(flow.stepOrder, [
    "indexOpportunity",
    "direction",
    "tradingPreference",
    "emotionStage",
    "stocks",
    "tradePlan",
  ]);
  assert.equal(flow.direction.candidatePool.hotOnlyDiscoveries[0].directExecutionEligible, false);
  assert.equal(flow.direction.confirmation.hotOnlyExcluded, true);
  assert.equal(flow.integrity.themePoolBuiltBeforeWholeMarketAnalysis, true);
  assert.equal(flow.integrity.wholeMarketStyleIndependentOfThemePool, true);
  assert.equal(flow.integrity.wholeMarketEmotionIndependentOfThemePool, true);

  payload.themeLibrary.candidateThemePool.confirmationThemeIds = [];
  payload.themeLibrary.candidateThemePool.retainedObservationThemeIds = ["算力方向"];
  const observeOnly = buildPremarketFlow(payload);
  assert.equal(observeOnly.tradingPreference.status, "ready", "风格不应被空题材确认池反向阻断");
  assert.equal(observeOnly.emotionStage.status, "ready", "情绪不应被空题材确认池反向阻断");
  assert.equal(observeOnly.direction.status, "blocked");
  assert.equal(observeOnly.direction.poolStatus, "ready");
  assert.equal(observeOnly.direction.confirmation.status, "blocked");
  assert.equal(observeOnly.direction.executionBlocked, true);
  assert.equal(observeOnly.tradePlan.canIssueAdvice, false);
  assert.deepEqual(observeOnly.tradePlan.plans, []);

  payload.themeLibrary.candidateThemePool.confirmationThemeIds = ["算力方向"];
  payload.themeLibrary.candidateThemePool.retainedObservationThemeIds = [];
  payload.premarketModels = {
    version: 2,
    tradingStylePreference: {
      version: 1,
      method: "rule_derived",
      marketOrganization: { key: "single_path", label: "单路径观察" },
      dominantPath: { key: "lowLaunch", label: "低位启动", status: "dominant", paths: ["lowLaunch"] },
      executionPreference: { summary: "等待合格载体" },
      paths: { lowLaunch: { label: "低位启动", status: "active", evidence: ["全市场路径成立"] } },
      representatives: { highTrend: [], lowLaunch: [], boardEmotion: [] },
      observationRepresentatives: { highTrend: [], lowLaunch: [], boardEmotion: [] },
      directionPermission: {
        executionStatus: "blocked",
        primaryEligibleCarrierCodes: [],
      },
    },
  };
  const noStyleCarrier = buildPremarketFlow(payload);
  assert.equal(noStyleCarrier.direction.status, "blocked", "题材池ready但没有风格载体时，最终方向状态必须阻断");
  assert.equal(noStyleCarrier.direction.poolStatus, "ready", "题材池自身ready状态继续单列保留");
  assert.equal(noStyleCarrier.direction.confirmation.status, "blocked");
  assert.ok(noStyleCarrier.direction.confirmation.blockedBy.includes("tradingPreference"));
  assert.equal(noStyleCarrier.direction.executionBlocked, true);
  assert.equal(noStyleCarrier.tradePlan.canIssueAdvice, false);
  assert.deepEqual(noStyleCarrier.tradePlan.plans, []);
});

function deterministicIndexPayload({
  mediumKey = "range",
  shortKey = "range",
  intradayKey = "mixed",
  fiveDayKey = "weakening",
  allowNew = false,
  allowAdd = false,
} = {}) {
  const payload = completePayload();
  payload.forecast = {
    calibrated: false,
    primary: { key: "range_divergence", label: "震荡分化", probability: 53 },
    scenarios: [
      { key: "strengthen", label: "加强", probability: 34 },
      { key: "range_divergence", label: "震荡分化", probability: 53 },
      { key: "weaken", label: "减弱", probability: 13 },
    ],
  };
  payload.premarketModels = {
    version: 2,
    indexCycleRegime: {
      version: 1,
      method: "deterministic_multi_timeframe",
      mediumTerm: { key: mediumKey, label: mediumKey === "range" ? "中期震荡" : `中期${mediumKey}` },
      shortTerm: { windowDays: 5, key: shortKey, label: shortKey === "range" ? "全市场5日短周期震荡" : `短期${shortKey}` },
      intraday: {
        key: intradayKey,
        label: "盘中分化",
        fiveDay: {
          key: fiveDayKey,
          label: fiveDayKey === "weakening" ? "5日节奏转弱" : "5日节奏整体向上",
        },
      },
      positionPermission: {
        key: allowNew ? "conditional" : "observe",
        label: allowNew ? "条件允许" : "暂不新开仓",
        allowNew,
        allowAdd,
      },
      validation: {
        upgrade: ["多数主要指数站上20日线"],
        hold: ["震荡区间未被打破"],
        downgrade: ["多数主要指数跌回20日线下"],
      },
      dataQuality: { grade: "complete", missing: [] },
    },
  };
  payload.marketPhaseDetail = {
    version: 1,
    method: "deterministic_three_axis_composition",
    status: "unavailable",
    tomorrowBaseline: {
      key: "evidence_insufficient_defensive_observe",
      label: "证据不足·防守观察",
      status: "risk_default",
      probability: null,
      calibrated: false,
      riskDefault: true,
      reason: "缺少可用的精确T-1收盘状态",
    },
    selectionPolicy: {
      mode: "unavailable",
      label: "证据不足，暂不新开仓",
      checkpoints: ["09:25", "09:35"],
      allowImmediateEntry: false,
      canActivate: false,
      allowAdd: false,
    },
  };
  return payload;
}

function assertNoSyntheticProbability(value, location = "indexTomorrowPlan") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSyntheticProbability(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, nested]) => {
    if (key === "probability") assert.equal(nested, null, `${location}.${key}`);
    if (key === "calibrated") assert.equal(nested, false, `${location}.${key}`);
    assertNoSyntheticProbability(nested, `${location}.${key}`);
  });
}

test("指数震荡结构输出确定性次日路径，不把未校准分数冒充概率", () => {
  const payload = deterministicIndexPayload();
  payload.premarketModels.indexCycleRegime.validation.upgrade.push({
    label: "承接扩散后上修",
    probability: 88,
    calibrated: true,
  });
  const flow = buildPremarketFlow(payload);
  const plan = flow.indexTomorrowPlan;

  assert.deepEqual(plan, flow.indexOpportunity.indexTomorrowPlan);
  assert.equal(plan.version, 1);
  assert.equal(plan.method, "deterministic_conditional_path");
  assert.equal(plan.status, "index_only");
  assert.equal(plan.mainPath.key, "range_continuation_wait_break");
  assert.equal(plan.mainPath.label, "震荡延续，等待方向确认");
  assert.equal(plan.action.mode, "observe");
  assert.equal(plan.action.allowNew, false);
  assert.equal(plan.action.allowAdd, false);
  assert.equal(plan.action.canActivate, false);
  assert.deepEqual(plan.action.checkpoints, ["09:25", "09:35"]);
  assert.equal(plan.executionRhythm.role, "timing_only");
  assert.ok(plan.upwardRevision.conditions.includes("承接扩散后上修"));
  assert.equal(plan.evidenceBoundary.legacyForecastIgnored, true);
  assert.equal(plan.evidenceBoundary.fiveDayAffectsMainPath, false);
  assertNoSyntheticProbability(plan);
});

test("旧 forecast 34/53/13 及主情景切换不能改写 indexTomorrowPlan", () => {
  const base = deterministicIndexPayload();
  const altered = JSON.parse(JSON.stringify(base));
  altered.forecast = {
    calibrated: true,
    primary: { key: "strengthen", label: "加强", probability: 99 },
    scenarios: [
      { key: "strengthen", probability: 99 },
      { key: "range_divergence", probability: 0 },
      { key: "weaken", probability: 1 },
    ],
  };
  altered.tomorrowDecision.forecast = {
    calibrated: true,
    primary: { key: "weaken", label: "减弱", probability: 100 },
  };

  assert.deepEqual(
    buildPremarketFlow(altered).indexTomorrowPlan,
    buildPremarketFlow(base).indexTomorrowPlan,
  );
});

test("5日结构只改变执行节奏，不改写主路径、修正条件或权限", () => {
  const weakening = buildPremarketFlow(deterministicIndexPayload({ fiveDayKey: "weakening" })).indexTomorrowPlan;
  const advancing = buildPremarketFlow(deterministicIndexPayload({ fiveDayKey: "advance" })).indexTomorrowPlan;

  assert.deepEqual(advancing.mainPath, weakening.mainPath);
  assert.deepEqual(advancing.upwardRevision, weakening.upwardRevision);
  assert.deepEqual(advancing.downwardRevision, weakening.downwardRevision);
  assert.deepEqual(advancing.action, weakening.action);
  assert.notDeepEqual(advancing.executionRhythm, weakening.executionRhythm);
  assert.equal(advancing.executionRhythm.key, "advance");
  assert.equal(weakening.executionRhythm.key, "weakening");
});

test("指数与阶段权限取最严格交集，条件承接不等于立即开仓", () => {
  const conditional = deterministicIndexPayload({ allowNew: true, allowAdd: true });
  conditional.marketPhaseDetail = {
    version: 1,
    status: "available",
    tomorrowBaseline: {
      key: "observe_and_confirm",
      label: "次日路径盘前确认",
      status: "baseline_unconfirmed",
      probability: null,
      calibrated: false,
    },
    selectionPolicy: {
      mode: "conditional_after_support",
      label: "只在真实承接出现后参与",
    },
  };
  let action = buildPremarketFlow(conditional).indexTomorrowPlan.action;
  assert.equal(action.mode, "wait_for_support");
  assert.equal(action.canActivate, true);
  assert.equal(action.allowNew, false);
  assert.equal(action.allowAdd, false);

  const indexBlocked = deterministicIndexPayload({ allowNew: false, allowAdd: false });
  indexBlocked.marketPhaseDetail = {
    version: 1,
    status: "available",
    tomorrowBaseline: {
      key: "observe_and_confirm",
      label: "次日路径盘前确认",
      status: "baseline_unconfirmed",
      probability: null,
      calibrated: false,
    },
    selectionPolicy: {
      mode: "allowed",
      label: "允许执行",
      allowImmediateEntry: true,
      canActivate: true,
      allowAdd: true,
    },
  };
  action = buildPremarketFlow(indexBlocked).indexTomorrowPlan.action;
  assert.equal(action.mode, "observe");
  assert.equal(action.canActivate, false);
  assert.equal(action.allowNew, false);
  assert.equal(action.allowAdd, false);
});

test("indexOpportunityEvidence 只做深拷贝投影，保留真0/null且缺失时不回填", () => {
  const payload = deterministicIndexPayload();
  payload.indexOpportunityEvidence = {
    version: 1,
    index: {
      code: "000001",
      name: "上证指数",
      source: "closing_history",
      points: [{ date: "2026-08-20", close: 0 }],
    },
    turnover: {
      unit: "yi",
      source: "closing_history",
      points: [{ date: "2026-08-20", amountYi: 0 }],
      latestAmountYi: 0,
      averageAmountYi: null,
      vsAveragePct: 0,
      rangePositionPct: null,
    },
    dataQuality: {
      status: "complete",
      requestedDays: 5,
      availableDays: 5,
      strictClosingOnly: true,
      consecutive: true,
      gaps: [],
      excluded: [{ date: "2026-08-13", reason: null }],
      note: null,
    },
  };
  const before = JSON.stringify(payload.indexOpportunityEvidence);
  const flow = buildPremarketFlow(payload);

  assert.deepEqual(flow.indexOpportunity.fiveDayEvidence, payload.indexOpportunityEvidence);
  assert.notStrictEqual(flow.indexOpportunity.fiveDayEvidence, payload.indexOpportunityEvidence);
  assert.notStrictEqual(flow.indexOpportunity.fiveDayEvidence.index.points, payload.indexOpportunityEvidence.index.points);
  assert.equal(flow.indexOpportunity.fiveDayEvidence.turnover.latestAmountYi, 0);
  assert.equal(flow.indexOpportunity.fiveDayEvidence.turnover.averageAmountYi, null);
  flow.indexOpportunity.fiveDayEvidence.index.points[0].close = 999;
  assert.equal(JSON.stringify(payload.indexOpportunityEvidence), before);

  const missing = deterministicIndexPayload();
  missing.indexOpportunity = {
    ...missing.indexOpportunity,
    structures: [{ code: "000001", close: 3888 }],
  };
  assert.equal(buildPremarketFlow(missing).indexOpportunity.fiveDayEvidence, null);
});

test("家族可观察但无唯一主攻细分时方向必须阻断，确认细分后才恢复", () => {
  const payload = completePayload();
  const baseDecision = {
    version: 1,
    status: "none",
    family: { id: "AI算力", name: "AI算力" },
    currentBestSubtheme: {
      name: "共封装光学(CPO)",
      exactSampleCount: 17,
      upRate: 0.353,
      medianChangePct: -1.04,
      gaps: ["上涨率未达到55%", "中位涨幅未大于0%"],
    },
    mainAttackSubtheme: null,
    conclusion: "主线家族：AI算力；今日暂无唯一主攻细分",
  };
  payload.themeLibrary = {
    schemaVersion: 1,
    classifierVersion: "theme-library-v8-family-subtheme-decision",
    poolContractVersion: 1,
    available: true,
    candidateThemePool: {
      version: 1,
      available: true,
      confirmationThemeIds: ["AI算力"],
      priorityVerificationThemeIds: ["AI算力"],
      retainedObservationThemeIds: [],
      hotOnlyDiscoveries: [],
    },
    themes: [{
      id: "AI算力",
      name: "AI算力",
      family: "AI算力",
      isMainLine: true,
      isCoreDirection: true,
      resonance: true,
      directionConfirmationEligible: true,
      globalSubthemeDecision: baseDecision,
      stocks: [{ code: "300001", name: "测试核心", tags: [{ label: "中军", verified: true }] }],
    }],
  };

  const blocked = buildPremarketFlow(payload);
  assert.equal(blocked.direction.poolStatus, "ready");
  assert.equal(blocked.direction.status, "blocked");
  assert.equal(blocked.direction.executionBlocked, true);
  assert.equal(blocked.direction.focusDirection, null);
  assert.deepEqual(blocked.direction.allowedStockCodes, []);
  assert.equal(blocked.direction.subthemeDecision.conclusion, baseDecision.conclusion);
  assert.deepEqual(blocked.tradePlan.plans, []);

  payload.themeLibrary.themes[0].globalSubthemeDecision = {
    ...baseDecision,
    status: "confirmed_main_attack",
    mainAttackSubtheme: {
      name: "共封装光学(CPO)",
      family: "AI算力",
      memberCodes: ["300001"],
      confirmationCount: 2,
    },
    conclusion: "主线家族：AI算力；今日主攻细分：共封装光学(CPO)",
  };
  const confirmed = buildPremarketFlow(payload);
  assert.equal(confirmed.direction.status, "ready");
  assert.equal(confirmed.direction.focusDirection, "共封装光学(CPO)");
  assert.deepEqual(confirmed.direction.allowedStockCodes, ["300001"]);
});

test("炒作偏好正式层只读取持续T+1状态，不让当日连板观察直接授权", () => {
  const payload = completePayload();
  const model = {
    version: 3,
    conclusionState: "confirmed",
    persistentConclusionState: "unconfirmed",
    marketOrganization: { label: "单路径主导", evidence: ["今日连板样本较强"] },
    currentObservationDominantPath: { key: "boardEmotion", label: "连板情绪", status: "dominant", paths: ["boardEmotion"] },
    dominantPath: { key: "boardEmotion", label: "连板情绪", status: "dominant", paths: ["boardEmotion"] },
    persistentPreference: {
      version: 1,
      status: "accumulating",
      windowDays: 5,
      primaryPath: null,
      confirmedPaths: [],
      switchState: "not_ready",
      conclusion: "持续偏好尚未确认：当前只有1/3个可回放T+1窗口",
      paths: {
        highTrend: { key: "highTrend", label: "高位趋势", validDays: 1, requiredDays: 3, latestState: "loss" },
        lowLaunch: { key: "lowLaunch", label: "低位启动", validDays: 1, requiredDays: 3, latestState: "profit" },
        boardEmotion: { key: "boardEmotion", label: "连板情绪", validDays: 1, requiredDays: 3, latestState: "profit" },
      },
      lossEffect: { status: "insufficient", headline: "T+1亏钱效应样本积累中", paths: [], latestRiskObservations: [] },
    },
    persistentDirectionPermission: {
      executionStatus: "blocked",
      activePaths: [],
      primaryEligibleCarrierCodes: [],
      eligibleCarrierCodes: ["300001"],
      eligibleCarrierCodesByPath: { highTrend: [], lowLaunch: [], boardEmotion: ["300001"] },
    },
    directionPermission: {
      executionStatus: "conditional",
      activePaths: ["boardEmotion"],
      primaryEligibleCarrierCodes: ["300001"],
    },
    paths: { highTrend: {}, lowLaunch: {}, boardEmotion: { label: "连板情绪", status: "active", evidence: [] } },
    executionPreference: { summary: "等核心确认", methods: {} },
    representatives: {},
    observationRepresentatives: {},
    sourceCoverage: {},
  };
  payload.premarketModels = { version: 2, tradingStylePreference: model };
  const accumulating = buildPremarketFlow(payload);
  assert.equal(accumulating.tradingPreference.status, "blocked");
  assert.equal(accumulating.tradingPreference.preference, "持续偏好尚未确认");
  assert.equal(accumulating.tradingPreference.currentObservationDominantPath.key, "boardEmotion");
  assert.equal(accumulating.tradingPreference.executionBlocked, true);

  model.persistentConclusionState = "confirmed";
  model.persistentPreference = {
    ...model.persistentPreference,
    status: "confirmed",
    primaryPath: { key: "boardEmotion", label: "连板情绪" },
    confirmedPaths: [{ key: "boardEmotion", label: "连板情绪" }],
    switchState: "initial_persistent_confirmation",
    conclusion: "持续赚钱偏好：连板情绪",
  };
  model.persistentDirectionPermission = {
    ...model.persistentDirectionPermission,
    executionStatus: "conditional",
    activePaths: ["boardEmotion"],
    primaryEligibleCarrierCodes: ["300001"],
  };
  const confirmed = buildPremarketFlow(payload);
  assert.equal(confirmed.tradingPreference.status, "ready");
  assert.equal(confirmed.tradingPreference.preference, "连板情绪");
});
