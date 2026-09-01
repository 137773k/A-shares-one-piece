"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FACTOR_CATALOG,
  buildUnifiedQuantFactors,
} = require("./unified-quant-factors");

function fixture(overrides = {}) {
  const generationId = "2026-08-21:2026-08-21T15:00:00.000Z";
  const asOf = "2026-08-21T15:00:00.000Z";
  const fiveDayBigCycle = {
    key: "chaos",
    label: "混沌",
    status: "canonical",
    source: "five_day_weighted_emotion_big_cycle_window_v1",
    horizon: "rolling_5_trading_days",
    windowDays: 5,
    window: {
      status: "available",
      observations: ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"]
        .map((tradingDate) => ({ tradingDate, complete: true })),
    },
    reasonCode: "weighted_structure_conflicted",
    reason: "五日窗口确认混沌。",
    evidence: ["五日窗口完整", "最近两日同态"],
    generationContext: { generationId, tradingDate: "2026-08-21", asOf },
    calibrated: false,
  };
  const payload = {
    generationId,
    tradingDate: "2026-08-21",
    asOf,
    generationContext: { generationId, tradingDate: "2026-08-21", asOf },
    market: {
      state: {
        cycle: "混沌",
        rawCycle: "修复",
        dailyState: { key: "repair", label: "修复进行中" },
        tradeWindow: { key: "warming_watch", allowNew: false, allowAdd: false, summary: "等待核心确认" },
        profitEffect: { score: 61.2, label: "赚钱效应存在", trend: "weakening" },
        lossEffect: { score: 42.7, label: "亏钱效应可控", trend: "stable" },
        effectAttribution: {
          scopes: [
            { key: "short-core", label: "短线核心共振加强", summary: "局部核心走强" },
            { key: "tradeable", label: "暂无可交易载体", summary: "严格门槛后为空" },
          ],
        },
      },
      tradingStyle: {
        style: "板块轮动",
        preference: "轮动回流",
        topDirection: "AI算力",
      },
      marketCapCarrier: { status: "observed", observationOnly: true, label: "中小市值载体" },
    },
    premarketModels: {
      generationId,
      indexCycleRegime: {
        structuralCycle: "混沌",
        transition: { key: "repair_observed", label: "修复观察·不改写大周期", status: "observed" },
        shortTerm: { windowDays: 5, key: "range", label: "全市场5日短周期震荡" },
        positionPermission: {
          key: "conditional_reduced",
          allowNew: true,
          allowAdd: false,
          positionRangePct: [30, 50],
          reasons: ["指数结构允许条件试错"],
        },
      },
      tradingStylePreference: {
        marketOrganization: { key: "dual_path", label: "双路径并行" },
        dominantPath: { key: "low_and_trend", label: "低位启动 + 高位趋势" },
        paths: {
          lowLaunch: { key: "lowLaunch", label: "低位启动", status: "active", stage: "fermenting", score: 83.4 },
          highTrend: { key: "highTrend", label: "高位趋势", status: "active", stage: "trend_active", score: 78.2 },
          boardEmotion: { key: "boardEmotion", label: "连板情绪", status: "candidate", score: 63.8 },
        },
        directionPermission: { executionStatus: "blocked", executionLabel: "主路径无合格载体" },
        executionPreference: { summary: "优先低吸与趋势承接" },
      },
    },
    emotionCycle: {
      generationId,
      tradingDate: "2026-08-21",
      currentTradingDate: "2026-08-21",
      asOf: "2026-08-21T15:00:00.000Z",
      current: {
        key: "harmful",
        phaseKey: "harmful",
        label: "大分歧",
        divergenceIntensity: { key: "large", label: "大分歧", score: 58 },
        divergenceQuality: { key: "non_benign", label: "非良性" },
        supportState: { key: "weak", label: "承接弱", score: 28 },
      },
      previous: {
        available: true,
        key: "realization",
        label: "中等分歧",
        tradingDate: "2026-08-20",
        source: "exact_t1_canonical_replay",
        authority: "canonical_exact_closing_replay",
        exactCanonical: true,
        replayed: true,
        replayAudit: {
          mode: "exact_closing_recursive_cross_day",
          targetTradingDate: "2026-08-20",
          failClosedOnUnknownCurrent: true,
        },
      },
      crossDayVerified: true,
      dataQuality: {
        exactPreviousTradingDay: true,
        expectedPreviousTradingDate: "2026-08-20",
        previousStateAuthority: "canonical_exact_closing_replay",
      },
      executionPermission: { status: "blocked", reasons: ["负反馈尚未收敛"] },
    },
    marketPhaseDetail: {
      generationId,
      tradingDate: "2026-08-21",
      asOf: "2026-08-21T15:00:00.000Z",
      structuralCycle: "混沌",
      structuralCycleDetail: fiveDayBigCycle,
      transition: { key: "repair_observed", label: "修复观察·不改写大周期", status: "observed" },
      emotionStage: { key: "harmful", label: "非良性分歧" },
      decisionContext: {
        generationId,
        tradingDate: "2026-08-21",
        asOf: "2026-08-21T15:00:00.000Z",
        bigCycle: fiveDayBigCycle,
        transition: { key: "repair_observed", label: "修复观察·不改写大周期", status: "observed", source: "market_phase_detail.transition" },
        smallCycle: { key: "range_divergence", label: "震荡分歧", source: "index_cycle_regime.shortTerm+intraday", observationOnly: true },
        emotionStage: {
          key: "harmful",
          label: "大分歧",
          observationOnly: true,
          divergenceIntensity: { key: "large", label: "大分歧", score: 58 },
          divergenceQuality: { key: "non_benign", label: "非良性" },
          supportState: { key: "weak", label: "承接弱", score: 28 },
        },
      },
    },
    unifiedDecisionChain: {
      version: 3,
      method: "strict_sequential_fail_closed_v1",
      authority: "canonical_stock_decision",
      generation: {
        generationId,
        tradingDate: "2026-08-21",
        asOf: "2026-08-21T15:00:00.000Z",
        aligned: true,
      },
      marketStage: {
        status: "passed",
        passed: true,
        bigCycle: { ...fiveDayBigCycle, window: structuredClone(fiveDayBigCycle.window) },
        transition: { key: "repair_observed", label: "修复观察·不改写大周期", status: "observed", observationOnly: true },
        smallCycle: { key: "range_divergence", label: "震荡分歧", status: "available" },
        emotionStage: {
          key: "harmful",
          label: "大分歧",
          status: "unavailable",
          observationOnly: true,
          divergenceIntensity: { key: "large", label: "大分歧", score: 58 },
          divergenceQuality: { key: "non_benign", label: "非良性" },
          supportState: { key: "weak", label: "承接弱", score: 28 },
        },
        previousEmotionStage: {
          status: "passed",
          passed: true,
          available: true,
          key: "realization",
          label: "中等分歧",
          tradingDate: "2026-08-20",
          expectedTradingDate: "2026-08-20",
          authority: "canonical_exact_closing_replay",
          exactCanonical: true,
          crossDayVerified: true,
          cycleGenerationAligned: true,
          replayed: true,
          replayAudit: {
            mode: "exact_closing_recursive_cross_day",
            targetTradingDate: "2026-08-20",
            failClosedOnUnknownCurrent: true,
          },
        },
      },
      authorization: {
        status: "blocked",
        passed: false,
        tradePermission: {
          status: "blocked",
          allowNew: false,
          allowAdd: false,
          reasons: ["最终门禁关闭"],
        },
        tradeValue: { key: "none", label: "无交易价值", status: "blocked", numericScore: null, calibrated: false },
        positionPermission: { status: "blocked", positionCeilingPct: 0, initialActivationPct: 0, addPermission: false },
        layers: [
          { key: "index", label: "指数仓位上限", status: "allowed", allow: true, reasons: ["指数结构允许条件试错"] },
          { key: "trade_window", label: "短线交易窗口", status: "blocked", allow: false, reasons: ["等待核心确认"] },
          { key: "emotion", label: "情绪执行许可", status: "blocked", allow: false, reasons: ["负反馈尚未收敛"] },
          { key: "style", label: "风格载体许可", status: "blocked", allow: false, reasons: ["主路径无合格载体"] },
        ],
      },
      result: {
        status: "blocked",
        maxStocks: 5,
        selectedCount: 0,
        selectedCodes: [],
        stocks: [],
      },
      observationCandidates: {
        status: "empty",
        observationOnly: true,
        executionAuthority: false,
        maxStocks: 5,
        selectedCount: 0,
        selectedCodes: [],
        stocks: [],
      },
      integrity: {
        ok: true,
        failClosed: true,
        selectionContextRequired: false,
        maxResultStocks: 5,
        observationCandidatesCannotGrantExecution: true,
        postEntryExpectationConditionalOnly: true,
        entryConfirmationRequired: true,
        opportunityDataCompletenessRequired: true,
        fundFlowCompletenessRequired: false,
        strictOrder: [
          "market_stage",
          "authorization",
          "profit_effect",
          "theme",
          "stock_mode",
          "stock_hard_gate",
          "result_stocks",
          "participation_allocation",
        ],
      },
    },
    bestPicks: {
      executionVersion: 3,
      factorEngineAuthority: "unified_stock_factor_engine_v4",
      factorEngineVersion: 4,
      selectionAuthority: "unified_decision_chain_v3",
      decisionChainVersion: 3,
      available: false,
      picks: [],
      decisionPool: [],
    },
    tomorrowDecision: {
      generationId,
      tradingDate: "2026-08-21",
      asOf: "2026-08-21T15:00:00.000Z",
      permission: { status: "blocked", allowImmediateEntry: false, allowAdd: false, reasons: ["最终门禁关闭"] },
      opportunityMap: { globalGate: { status: "closed", canOpen: false, canTradeCandidates: false, reasons: ["无可交易候选"] } },
    },
    candidates: [
      { code: "000001", selected: true, tradeQualified: false },
      { code: "000002", selected: true, tradeQualified: false },
    ],
  };
  return Object.assign(payload, overrides);
}

test("大周期与小周期保持独立，不因标签不同被判为冲突", () => {
  const result = buildUnifiedQuantFactors(fixture());
  assert.equal(result.marketStage.bigCycle.label, "混沌");
  assert.equal(result.marketStage.transition.label, "修复观察·不改写大周期");
  assert.equal(result.marketStage.smallCycle.label, "震荡分歧");
  assert.equal(result.marketStage.independentAxes, true);
  assert.equal(result.integrity.bigAndSmallCycleIndependent, true);
  assert.equal(result.integrity.status, "valid");
});

test("宏观轮动与微观低位/趋势路径叠加输出，不互相覆盖", () => {
  const result = buildUnifiedQuantFactors(fixture());
  assert.equal(result.speculationPreference.macro.label, "板块轮动");
  assert.equal(result.speculationPreference.macro.preference, "轮动回流");
  assert.equal(result.speculationPreference.micro.label, "低位启动 + 高位趋势");
  assert.deepEqual(result.speculationPreference.micro.activePaths.map((item) => item.key), ["lowLaunch", "highTrend"]);
  assert.equal(result.speculationPreference.combined.mode, "macro_micro_overlay");
});

test("指数层允许不能绕过下游关闭，最终许可只会收紧", () => {
  const result = buildUnifiedQuantFactors(fixture());
  assert.equal(result.permission.layers.find((item) => item.key === "index").allowNew, true);
  assert.equal(result.permission.layers.find((item) => item.key === "trade_window").allowNew, false);
  assert.equal(result.permission.final.status, "blocked");
  assert.equal(result.permission.final.allowNew, false);
  assert.equal(result.permission.integrity.monotonic, true);
});

test("跨代因子必须失败关闭", () => {
  const payload = fixture();
  payload.marketPhaseDetail.generationId = "2026-08-20:old";
  const result = buildUnifiedQuantFactors(payload);
  assert.equal(result.generation.aligned, false);
  assert.equal(result.integrity.status, "invalid");
  assert.equal(result.permission.final.status, "blocked");
  assert.match(result.permission.final.reasons.join("；"), /代次不一致/);
});

test("decisionContext的asOf错配或代次字段全缺失都不能被视为aligned", () => {
  const staleContext = fixture();
  staleContext.marketPhaseDetail.decisionContext.asOf = "2026-08-20T15:00:00.000Z";
  const staleResult = buildUnifiedQuantFactors(staleContext);
  assert.equal(staleResult.generation.aligned, false);
  assert.equal(staleResult.permission.final.allowNew, false);

  const missingIdentity = fixture();
  delete missingIdentity.generationId;
  delete missingIdentity.tradingDate;
  delete missingIdentity.asOf;
  delete missingIdentity.generationContext;
  delete missingIdentity.marketPhaseDetail.generationId;
  delete missingIdentity.marketPhaseDetail.tradingDate;
  delete missingIdentity.marketPhaseDetail.asOf;
  delete missingIdentity.marketPhaseDetail.decisionContext.generationId;
  delete missingIdentity.marketPhaseDetail.decisionContext.tradingDate;
  delete missingIdentity.marketPhaseDetail.decisionContext.asOf;
  delete missingIdentity.premarketModels.generationId;
  const missingResult = buildUnifiedQuantFactors(missingIdentity);
  assert.equal(missingResult.generation.aligned, false);
  assert.equal(missingResult.integrity.status, "invalid");
});

test("统一决策链缺失时旧许可全部为绿也必须失败关闭", () => {
  const payload = fixture();
  delete payload.unifiedDecisionChain;
  payload.market.state.tradeWindow = { key: "open", allowNew: true, allowAdd: true };
  payload.tomorrowDecision.permission = { status: "allowed", allowImmediateEntry: true, allowAdd: true };
  const result = buildUnifiedQuantFactors(payload);
  assert.equal(result.permission.final.allowNew, false);
  assert.equal(result.permission.final.positionCeilingPct, 0);
  assert.equal(result.integrity.status, "invalid");
  assert.match(result.permission.final.reasons.join("；"), /统一决策链/);
});

test("删除个人模型后候选统计只读取有效统一链，不沿用旧角色计数", () => {
  const result = buildUnifiedQuantFactors(fixture());
  assert.equal(result.candidates.legacySelectedCount, 2);
  assert.equal(result.candidates.observationCandidateCount, 0);
  assert.equal(result.candidates.hardGateCandidateCount, 0);
  assert.equal(result.candidates.executionCandidateCount, 0);
  assert.equal(result.candidates.legacySelectedIsExecutionAuthority, false);
  assert.match(result.integrity.warnings.join("；"), /selected/);
});

test("因子登记表明确三层个股评分职责", () => {
  const ids = new Set(FACTOR_CATALOG.map((item) => item.id));
  assert(ids.has("trade.value"));
  assert(ids.has("market.big_cycle_transition"));
  assert(ids.has("permission.position"));
  assert(ids.has("theme.eligibility"));
  assert(ids.has("stock.mode"));
  assert(ids.has("candidate.hard_gate"));
  assert(ids.has("candidate.intraday_leadership"));
  assert(ids.has("candidate.participation_value"));
  assert(ids.has("candidate.risk_adjustment"));
  assert(ids.has("candidate.execution_feasibility"));
  assert(ids.has("result.max_five"));
  assert(ids.has("result.observation_candidates"));
  assert(ids.has("result.observation_tiers"));
  assert(ids.has("validation.execution_replay"));
  assert(ids.has("validation.factor_ablation"));
  assert(ids.has("validation.threshold_calibration"));
  assert(ids.has("result.position_allocation"));
  assert(ids.has("market.emotion_divergence_intensity"));
  assert(ids.has("market.emotion_divergence_quality"));
  assert(ids.has("market.emotion_support"));
  assert(ids.has("market.emotion_t1_state"));
  assert.equal(
    FACTOR_CATALOG.find((item) => item.id === "market.big_cycle").owner,
    "emotion_cycle_engine.big_cycle",
  );
  assert.equal(
    FACTOR_CATALOG.find((item) => item.id === "market.small_cycle").owner,
    "market_cycle_contract.small_cycle_composer",
  );
  const engineRows = FACTOR_CATALOG.filter((item) => [
    "candidate.hard_gate",
    "candidate.participation_value",
    "candidate.risk_adjustment",
  ].includes(item.id));
  assert(engineRows.every((item) => item.owner === "unified_stock_factor_engine_v4"));
});

test("旧个股评分引擎不得被统一因子契约标记为有效", () => {
  const payload = fixture();
  delete payload.bestPicks.factorEngineAuthority;
  delete payload.bestPicks.factorEngineVersion;
  const result = buildUnifiedQuantFactors(payload);
  assert.equal(result.integrity.stockFactorEngineAligned, false);
  assert.equal(result.integrity.status, "invalid");
  assert.match(result.integrity.warnings.join("；"), /统一因子引擎/);
});

test("情绪阶段、分歧强度、质量、承接与T-1权威状态在统一契约中分别输出", () => {
  const result = buildUnifiedQuantFactors(fixture());
  assert.equal(result.version, 6);
  assert.equal(result.marketStage.emotionStage.label, "大分歧");
  assert.equal(result.marketStage.emotionStage.divergenceIntensity.key, "large");
  assert.equal(result.marketStage.emotionStage.divergenceQuality.key, "non_benign");
  assert.equal(result.marketStage.emotionStage.supportState.key, "weak");
  assert.equal(result.marketStage.previousEmotionStage.available, true);
  assert.equal(result.marketStage.previousEmotionStage.tradingDate, "2026-08-20");
  assert.equal(result.marketStage.previousEmotionStage.authority, "canonical_exact_closing_replay");
  assert.equal(result.marketStage.previousEmotionStage.replayAudit.mode, "exact_closing_recursive_cross_day");
  assert.equal(result.marketStage.previousEmotionStage.crossDayVerified, true);
});

test("统一因子只投影主链情绪与T-1，不读取旧tomorrowDecision嵌套状态重新推断", () => {
  const payload = fixture();
  payload.tomorrowDecision.coreEmotion = {
    emotionCycle: {
      current: { key: "acceleration", label: "旧加速" },
      previous: { available: true, label: "旧T-1高潮" },
    },
  };
  const result = buildUnifiedQuantFactors(payload);
  assert.equal(result.marketStage.emotionStage.label, "大分歧");
  assert.equal(result.marketStage.previousEmotionStage.label, "中等分歧");
});

test("服务端刷新把统一契约挂到同一个行情载荷", () => {
  const { _internals } = require("./server");
  const payload = fixture();
  const result = _internals.refreshUnifiedQuantFactors(payload);
  assert.equal(payload.unifiedQuantFactors, result);
  assert.equal(result.generation.generationId, payload.generationId);
  assert.equal(result.marketStage.bigCycle.label, "混沌");
  assert.equal(result.permission.final.status, "blocked");
});
