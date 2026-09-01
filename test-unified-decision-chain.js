"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  MAX_RESULT_STOCKS,
  inspectAuthoritativeDecisionChain,
  runUnifiedDecisionChain,
  applyDecisionChainToBestPicks,
  buildObservationCandidates,
  buildPostEntryNextDayExpectation,
  buildEntryConfirmation,
} = require("./quant-decision/decision-chain");
const {
  hardGate,
  evaluateOpportunityDataCompleteness,
  evaluateShortTermActiveCarrier,
} = require("./trading-rules");
const { classifyTomorrowExecution } = require("./tomorrow-execution");

const FIXTURE_TRADING_DATE = "2026-08-21";

function marketCapEvidence(bucketKey = "100_300", totalCapYi = 180) {
  return {
    method: "same_day_candidate_bucket_comparison_unvalidated_v2",
    totalCapYi,
    floatCapYi: totalCapYi * 0.8,
    capDataQuality: "total_cap_available",
    bucketKey,
    bucketLabel: bucketKey === "over_1000" ? "1000亿以上" : "100-300亿",
    reason: "fixture同日总市值桶可追溯",
  };
}

function pick(index) {
  const code = String(index).padStart(6, "0");
  return {
    code,
    name: `股票${index}`,
    mainConcept: "主线A",
    ticketType: index % 2 ? "低位先锋" : "主动容量",
    price: 10 + index,
    amountYi: 12 + index,
    turnoverRate: 6 + index / 10,
    totalMktCapYi: 180 + index,
    floatMktCapYi: 140 + index,
    marketCapCarrier: marketCapEvidence("100_300", 180 + index),
    klineProfile: {
      lastTradingDate: FIXTURE_TRADING_DATE,
      lastSession: {
        tradingDate: FIXTURE_TRADING_DATE,
        close: 10 + index,
        amountYi: 12 + index,
        turnoverRate: 6 + index / 10,
        source: "fixture-closing-kline",
        snapshotKind: "closing",
        verified: true,
        completed: true,
      },
    },
    priceIntegrity: { status: "pass", valid: true, consistent: true },
    tradeQualified: true,
    hardGate: { pass: true },
    leadership: { tradeQualified: true },
    tomorrowExecution: { tomorrowEntryQualified: true, rank: 100 - index },
    factorDecision: {
      version: 4,
      authority: "unified_stock_factor_engine_v4",
      hardGate: { pass: true },
      participationValue: {
        score: 110 - index,
        components: {
          themePosition: 30,
          stockRole: 25,
          structureQuality: 20,
          liquidity: 20 - index,
          t1Premium: 15,
        },
      },
      riskAdjustment: { score: -index, components: { priceExhaustion: -index } },
      finalScore: 110 - index * 2,
    },
  };
}

function fixture() {
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
      observations: ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", FIXTURE_TRADING_DATE]
        .map((tradingDate) => ({ tradingDate, complete: true })),
    },
    reasonCode: "weighted_structure_conflicted",
    reason: "五日窗口确认混沌。",
    evidence: ["五日窗口完整", "最近两日同态"],
    generationContext: { generationId, tradingDate: FIXTURE_TRADING_DATE, asOf },
    calibrated: false,
  };
  const picks = [1, 2, 3, 4, 5, 6].map(pick);
  const factorContext = {
    authority: "canonical_market_phase_detail",
    generationId,
    tradingDate: FIXTURE_TRADING_DATE,
    asOf,
    bigCycle: { key: "chaos", label: "混沌" },
    smallCycle: { key: "range", label: "震荡" },
  };
  picks.forEach((item) => { item.factorContext = factorContext; });
  const codes = picks.map((item) => item.code);
  const payload = {
    generationId,
    tradingDate: "2026-08-21",
    asOf,
    generationContext: { generationId, tradingDate: FIXTURE_TRADING_DATE, asOf },
    marketPhaseDetail: {
      generationId,
      tradingDate: "2026-08-21",
      asOf,
      decisionContext: {
        generationId,
        tradingDate: "2026-08-21",
        asOf,
        bigCycle: fiveDayBigCycle,
        transition: { key: "repair_observed", label: "修复观察·不改写大周期", status: "observed", source: "fixture" },
        smallCycle: { key: "range", label: "震荡", status: "observed", source: "fixture" },
        emotionStage: { key: "repair", label: "修复观察", status: "observed", observationOnly: true },
      },
    },
    hotConcepts: [{ name: "主线A" }],
    topicBoard: { mainLine: { name: "主线A" }, items: [{ name: "主线A" }] },
    themeLibrary: {
      mainThemeDecision: {
        confirmedFamily: { id: "主线A", name: "主线A", state: "confirmed", sustained: true },
        mainAttackSubtheme: null,
      },
    },
    market: {
      state: {
        tradeWindow: { key: "open", allowNew: true, allowAdd: true, summary: "交易窗口开放" },
        effectAttribution: {
          scopes: [
            { key: "market", label: "赚钱效应存在", tone: "good", score: 70 },
            {
              key: "short-core",
              label: "短线核心赚钱",
              tone: "good",
              referenceGroups: [{ label: "短线载体", items: picks.map((item) => ({ code: item.code, name: item.name })) }],
            },
            {
              key: "tradeable",
              label: "可交易赚钱效应成立",
              tone: "good",
              referenceGroups: [{ label: "载体", items: picks.map((item) => ({ code: item.code, name: item.name })) }],
            },
          ],
        },
      },
      marketCapCarrier: {
        status: "confirmed",
        preferredBucketKeys: ["100_300"],
        observationOnly: true,
        label: "市值载体观察",
      },
    },
    marketEmotion: {},
    premarketModels: {
      generationId,
      indexCycleRegime: {
        positionPermission: {
          key: "allowed",
          allowNew: true,
          allowAdd: true,
          positionRangePct: [40, 60],
          reasons: ["指数结构允许"],
        },
      },
      tradingStylePreference: {
        directionPermission: {
          executionStatus: "allowed",
          executionLabel: "股票模式已确认",
          activePaths: ["lowLaunch", "highTrend"],
          dominantPaths: ["lowLaunch"],
          allowedCarrierTypes: ["低位先锋", "主动容量"],
        },
        persistentDirectionPermission: {
          screeningStatus: "allowed",
          executionStatus: "conditional",
          activePaths: ["lowLaunch", "highTrend"],
          dominantPaths: ["lowLaunch"],
          eligibleCarrierCodes: codes,
          eligibleCarrierCodesByPath: {
            lowLaunch: codes,
            highTrend: codes,
          },
          primaryEligibleCarrierCodes: codes,
        },
      },
    },
    emotionCycle: {
      generationId,
      tradingDate: "2026-08-21",
      currentTradingDate: "2026-08-21",
      asOf,
      previous: {
        available: true,
        key: "support",
        label: "承接",
        tradingDate: "2026-08-20",
        source: "exact_t1_emotion_cycle",
        authority: "canonical_exact_closing_replay",
        exactCanonical: true,
        replayed: true,
        replayAudit: {
          mode: "exact_closing_recursive_cross_day",
          targetTradingDate: "2026-08-20",
          failClosedOnUnknownCurrent: true,
        },
      },
      current: { crossDayVerified: true },
      dataQuality: {
        exactPreviousTradingDay: true,
        expectedPreviousTradingDate: "2026-08-20",
        previousStateAuthority: "canonical_exact_closing_replay",
      },
      executionPermission: {
        status: "allowed",
        immediateEntry: true,
        conditionalAfterSupport: false,
        label: "情绪许可开放",
      },
    },
    bestPicks: {
      executionVersion: 3,
      available: true,
      factorEngineAuthority: "unified_stock_factor_engine_v4",
      factorEngineVersion: 4,
      selectionContext: {
        authority: "canonical_market_phase_detail",
        status: "passed",
        passed: true,
        factorContextRecomputed: true,
        factorEngineAuthority: "unified_stock_factor_engine_v4",
        factorEngineVersion: 4,
        generationId,
        tradingDate: "2026-08-21",
        asOf,
        bigCycle: { key: "chaos", label: "混沌" },
        smallCycle: { key: "range", label: "震荡" },
      },
      picks,
      scenarioPlans: [
        { key: "strengthen", status: "ready", candidate: picks[0] },
        { key: "rotation", status: "ready", candidate: picks[5] },
      ],
    },
  };
  const premarketFlow = {
    direction: {
      primary: { name: "主线A" },
      eligibleDirections: [{ name: "主线A" }],
    },
    tradingPreference: { conclusion: "低位启动与高位趋势" },
  };
  const premarketGate = {
    blocked: false,
    executionMode: "conditional",
    reasons: [],
    allowedCandidateCodes: codes,
    directionEligibleCodes: codes,
    styleEligibleCodes: codes,
  };
  return { payload, premarketFlow, premarketGate, picks, codes };
}

test("严格链按指定顺序执行，最终最多输出5只且不足不补", () => {
  const input = fixture();
  const chain = runUnifiedDecisionChain(input);
  assert.deepEqual(chain.steps.map((step) => step.key), [
    "market_stage",
    "authorization",
    "profit_effect",
    "theme",
    "stock_mode",
    "stock_hard_gate",
    "result_stocks",
    "participation_allocation",
  ]);
  assert.equal(chain.result.status, "ready");
  assert.equal(chain.marketStage.bigCycle.horizon, "rolling_5_trading_days");
  assert.equal(chain.marketStage.bigCycle.windowDays, 5);
  assert.equal(chain.marketStage.bigCycle.reasonCode, "weighted_structure_conflicted");
  assert.deepEqual(chain.marketStage.bigCycle.evidence, ["五日窗口完整", "最近两日同态"]);
  assert.equal(chain.result.maxStocks, MAX_RESULT_STOCKS);
  assert.equal(chain.result.stocks.length, 5);
  assert.deepEqual(chain.result.selectedCodes, input.codes.slice(0, 5));
  assert.equal(chain.integrity.noForcedCandidate, true);
  assert(chain.result.stocks.every((item) => item.opportunityDataCompleteness.qualified === true));
  assert(chain.result.stocks.every((item) => /资金流缺失/.test(
    item.opportunityDataCompleteness.riskNotes.join("；"),
  )), "资金流缺失不得阻断正式结果，只能进入风险备注");
});

test("正式机会结果缺同日成交额时，旧hardGate和完整评分都不能补齐资格", () => {
  const input = fixture();
  const incomplete = input.picks[0];
  incomplete.amountYi = null;
  incomplete.klineProfile = {
    ...incomplete.klineProfile,
    lastSession: {
      ...incomplete.klineProfile.lastSession,
      amountYi: null,
    },
  };
  assert.equal(incomplete.hardGate.pass, true);
  assert.equal(Number.isFinite(incomplete.factorDecision.finalScore), true);

  const chain = runUnifiedDecisionChain(input);
  assert.equal(chain.result.selectedCodes.includes(incomplete.code), false);
  const diagnostic = chain.result.rejected.find((item) => item.code === incomplete.code);
  assert.ok(diagnostic);
  assert.match(diagnostic.reasons.join("；"), /机会关键数据不完整.*成交额/);
  assert.equal(diagnostic.opportunityDataCompleteness.missingFields.includes("amount"), true);
});

test("参与价值不能打开权限，交易窗口关闭后下游全部停止且仓位为0", () => {
  const input = fixture();
  input.payload.market.state.tradeWindow.allowNew = false;
  input.payload.market.state.tradeWindow.summary = "等待核心确认";
  const chain = runUnifiedDecisionChain(input);
  assert.equal(chain.authorization.status, "blocked");
  assert.equal(chain.authorization.tradeValue.key, "none");
  assert.equal(chain.authorization.positionPermission.positionCeilingPct, 0);
  assert.equal(chain.profitEffect.status, "not_evaluated");
  assert.equal(chain.result.stocks.length, 0);
  assert.equal(chain.result.participationAndAllocation.initialActivationPct, 0);
  assert.equal(chain.observationCandidates.executionAuthority, false);
});

test("授权关闭时最多输出5只观察对象，但不带仓位买点且不能补入正式结果", () => {
  const input = fixture();
  input.payload.market.state.tradeWindow.allowNew = false;
  input.payload.candidates = input.picks.map((item, index) => ({
    ...item,
    hardGate: index === 2 ? { pass: false, hardFails: ["均线结构未通过"] } : item.hardGate,
    gamePlan: { canGame: index !== 5, gameReason: index === 5 ? "模式不符" : "" },
    leadership: {
      ...item.leadership,
      tradeQualified: index !== 1,
      initiative: { score: 80 - index, dataQuality: index === 0 ? "分时验证" : "收盘代理" },
      hardFails: index === 0 ? [] : ["分时领导力尚未确认"],
    },
  }));
  input.payload.premarketModels.tradingStylePreference.observationRepresentatives = {
    lowLaunch: input.payload.candidates.map((item, index) => ({
      code: item.code,
      name: item.name,
      path: "lowLaunch",
      pathLabel: "低位启动",
      concept: "主线A",
      crossListed: index < 3,
      coreLike: index < 2,
      eastRank: index + 1,
    })),
  };
  input.payload.premarketModels.tradingStylePreference.paths = {
    lowLaunch: { stage: "fermenting" },
  };
  input.payload.premarketModels.tradingStylePreference.opportunities = [{
    path: "lowLaunch",
    stage: "fermenting",
    trigger: ["低位先锋与容量同步承接"],
    cancel: ["只剩孤立涨停"],
  }];

  const chain = runUnifiedDecisionChain(input);
  const observations = chain.observationCandidates.stocks;
  assert.equal(chain.result.stocks.length, 0);
  assert.equal(observations.length, 5);
  assert.equal(chain.observationCandidates.executionAuthority, false);
  assert(observations.every((row) => row.observationOnly === true && row.executable === false));
  assert(observations.every((row) => !("positionAllocation" in row) && !("buy" in row)));
  assert(observations.every((row) => row.executionFeasibility && row.executionFeasibility.canGrantExecution === false));
  assert.equal(observations[0].tierKey, "path_representative");
  assert(observations.every((row) => row.expectation && row.expectation.status === "qualified"));
  assert(observations.every((row) => row.postEntryNextDayExpectation
    && row.postEntryNextDayExpectation.horizon === "entry_t_plus_1"
    && row.postEntryNextDayExpectation.probability === null
    && row.postEntryNextDayExpectation.calibrated === false
    && row.postEntryNextDayExpectation.executionAuthority === false));
  assert(observations.every((row) => row.entryConfirmation
    && ["waiting_trigger", "blocked", "unavailable"].includes(row.entryConfirmation.status)
    && row.entryConfirmation.activated === false
    && row.entryConfirmation.executionAuthority === false));
  assert(observations.every((row) => row.capitalPreference && row.profitPreference));
  assert.equal(chain.observationCandidates.counts.reopenCandidates
    + chain.observationCandidates.counts.pathRepresentatives
    + chain.observationCandidates.counts.hardGateFailed, observations.length);
  assert(observations[0].reopenConditions.includes("低位先锋与容量同步承接"));
  const projected = applyDecisionChainToBestPicks(input.payload.bestPicks, chain);
  assert.equal(projected.picks.length, 0, "观察对象不得回填正式bestPicks");
  input.payload.unifiedDecisionChain = chain;
  input.payload.bestPicks = projected;
  const observationInspection = inspectAuthoritativeDecisionChain(input.payload);
  assert.equal(observationInspection.chainValid, true, observationInspection.chainReasons.join("；"));
  const excessivePullbacks = structuredClone(input.payload);
  const baseObservation = excessivePullbacks.unifiedDecisionChain.observationCandidates.stocks[0];
  const pullbacks = ["009901", "009902", "009903"].map((code, index) => ({
    ...structuredClone(baseObservation),
    rank: index + 1,
    code,
    name: `前板回撤篡改样本${index + 1}`,
    tierKey: "limit_up_pullback_repair",
    tierLabel: "机会观察·前板回撤",
    hardGatePassed: false,
    entryConfirmation: {
      ...structuredClone(baseObservation.entryConfirmation),
      status: "blocked",
      type: null,
      label: "当前不可确认（硬门槛未过）",
      activated: false,
    },
    postEntryNextDayExpectation: {
      ...structuredClone(baseObservation.postEntryNextDayExpectation),
      status: "unavailable",
      premise: "买点确认未通过时不生成持有预期",
      key: null,
      label: "不适用（当前无买点）",
      riskLabel: "不预设上涨",
    },
  }));
  excessivePullbacks.unifiedDecisionChain.observationCandidates.stocks = pullbacks;
  excessivePullbacks.unifiedDecisionChain.observationCandidates.selectedCodes = pullbacks.map((item) => item.code);
  excessivePullbacks.unifiedDecisionChain.observationCandidates.selectedCount = pullbacks.length;
  excessivePullbacks.unifiedDecisionChain.observationCandidates.counts = {
    pullbackRepairCandidates: 3,
    reopenCandidates: 0,
    pathRepresentatives: 0,
    hardGateFailed: 0,
  };
  const excessiveInspection = inspectAuthoritativeDecisionChain(excessivePullbacks);
  assert.equal(excessiveInspection.chainValid, false);
  assert.match(excessiveInspection.chainReasons.join("；"), /前板回撤超过2只上限/);
  const blockedObservationLeak = structuredClone(input.payload);
  blockedObservationLeak.unifiedDecisionChain.observationCandidates.status = "blocked";
  const blockedLeakInspection = inspectAuthoritativeDecisionChain(blockedObservationLeak);
  assert.equal(blockedLeakInspection.chainValid, false);
  assert.match(blockedLeakInspection.chainReasons.join("；"), /观察池已阻断但仍携带股票/);

  const sourceProfitDrift = structuredClone(input.payload);
  const observedCode = sourceProfitDrift.unifiedDecisionChain.observationCandidates.selectedCodes[0];
  const shortCoreScope = sourceProfitDrift.market.state.effectAttribution.scopes
    .find((scope) => scope.key === "short-core");
  shortCoreScope.referenceGroups.forEach((group) => {
    group.items = group.items.filter((item) => item.code !== observedCode);
  });
  const sourceDriftInspection = inspectAuthoritativeDecisionChain(sourceProfitDrift);
  assert.equal(sourceDriftInspection.chainValid, false);
  assert.match(sourceDriftInspection.chainReasons.join("；"), /源载荷的持续偏好、赚钱效应、题材或市值权威集合不一致/);
  const invalidObservationCases = [
    (stock) => {
      stock.hardGatePassed = false;
      stock.entryConfirmation = {
        ...stock.entryConfirmation,
        status: "blocked",
        type: null,
        label: "充分换手后的回封板",
      };
      stock.postEntryNextDayExpectation = {
        ...stock.postEntryNextDayExpectation,
        status: "unavailable",
        key: null,
        label: "不适用（当前无买点）",
      };
    },
    (stock) => {
      stock.tierKey = "limit_up_pullback_repair";
      stock.entryConfirmation = {
        ...stock.entryConfirmation,
        status: "waiting_trigger",
        type: "reseal_board",
        label: "充分换手后的回封板",
      };
    },
    (stock) => { stock.entryConfirmation.buy = { summary: "不应出现" }; },
    (stock) => {
      stock.entryConfirmation.reason = {};
      stock.entryConfirmation.triggerConditions = [{}];
    },
    (stock) => { delete stock.opportunityDataCompleteness; },
    (stock) => { stock.tradePlan = { action: "打板", positionPct: 100 }; },
    (stock) => { stock.buyPlan = { action: "打板", positionPct: 100 }; },
    (stock) => { stock.executionFeasibility.canGrantExecution = true; },
    (stock) => { stock.executionFeasibility.tradePlan = { action: "打板" }; },
    (stock) => { delete stock.executionFeasibility; },
    (stock) => {
      stock.observationReason = "保证涨停";
      stock.expectation.label = "保证涨停";
      stock.expectation.evidence[0] = "保证涨停";
      stock.expectation.executionAuthority = true;
    },
    (stock) => {
      stock.postEntryNextDayExpectation.key = "guaranteed_limit_up";
      stock.postEntryNextDayExpectation.label = "买后次日必涨";
      stock.postEntryNextDayExpectation.riskLabel = "没有风险";
    },
    (stock) => {
      stock.postEntryNextDayExpectation.key = "board_premium";
      stock.postEntryNextDayExpectation.label = "核心溢价 / 晋级验证";
      stock.postEntryNextDayExpectation.riskLabel = "分歧兑现或高标负反馈";
    },
    (stock) => { stock.postEntryNextDayExpectation.pathStage = "tampered_stage"; },
    (stock) => {
      stock.hardGatePassed = false;
      stock.entryConfirmation.status = "blocked";
      stock.entryConfirmation.type = null;
      stock.entryConfirmation.label = "当前不可确认后充分换手回封板";
      stock.postEntryNextDayExpectation.status = "unavailable";
      stock.postEntryNextDayExpectation.premise = "买点确认未通过时不生成持有预期";
      stock.postEntryNextDayExpectation.key = null;
      stock.postEntryNextDayExpectation.label = "不适用（当前无买点）";
      stock.postEntryNextDayExpectation.riskLabel = "不预设上涨";
    },
    (stock) => { delete stock.hardGatePassed; },
    (stock) => { stock.tierKey = "mystery"; },
  ];
  invalidObservationCases.forEach((mutate) => {
    const corrupted = structuredClone(input.payload);
    mutate(corrupted.unifiedDecisionChain.observationCandidates.stocks[0]);
    assert.equal(inspectAuthoritativeDecisionChain(corrupted).chainValid, false);
  });
});

test("买后次日预期按机会路径生成，且始终是非概率条件观察", () => {
  const cases = [
    ["boardEmotion", "emotion_acceleration", false, "先看溢价 / 更防分歧兑现"],
    ["boardEmotion", "divergence", false, "核心溢价 / 晋级验证"],
    ["lowLaunch", "fermenting", false, "启动溢价 / 题材继续发酵"],
    ["highTrend", "trend_acceleration", false, "冲高溢价 / 更防兑现"],
    ["highTrend", "continuation", false, "趋势延续 / 再冲高"],
    ["boardEmotion", "emotion_acceleration", true, "修复延续 / 冲击前高"],
  ];
  cases.forEach(([primaryPath, pathStage, pullbackRepairQualified, expectedLabel]) => {
    const result = buildPostEntryNextDayExpectation({
      primaryPath,
      pathStage,
      pullbackRepairQualified,
      confirmationConditions: ["明日确认条件"],
      cancelConditions: ["路径失效"],
    });
    assert.equal(result.status, "conditional");
    assert.equal(result.label, expectedLabel);
    assert.equal(result.horizon, "entry_t_plus_1");
    assert.equal(result.entryCondition, "明日确认条件");
    assert.equal(result.invalidation, "路径失效");
    assert.equal(result.probability, null);
    assert.equal(result.calibrated, false);
    assert.equal(result.observationOnly, true);
    assert.equal(result.executionAuthority, false);
  });
});

test("右侧买点确认按机会路径区分回封板、承接突破、趋势承接与不可确认", () => {
  const board = buildEntryConfirmation({
    primaryPath: "boardEmotion",
    hardGatePassed: true,
    leadershipQualified: true,
    shortTermCarrierQualified: true,
    opportunityDataComplete: true,
    confirmationConditions: ["充分换手后回封"],
  });
  assert.equal(board.type, "reseal_board");
  assert.equal(board.label, "充分换手后的回封板");
  assert.match(board.avoid, /秒板|一字板/);

  const pullback = buildEntryConfirmation({
    primaryPath: "boardEmotion",
    pullbackRepairQualified: true,
    hardGatePassed: true,
    opportunityDataComplete: true,
    confirmationConditions: ["板块回流且个股转强"],
  });
  assert.equal(pullback.type, "support_or_breakout");
  assert.equal(pullback.label, "承接转强 / 放量突破");

  const trend = buildEntryConfirmation({
    primaryPath: "highTrend",
    hardGatePassed: true,
    opportunityDataComplete: true,
  });
  assert.equal(trend.type, "support_reclaim");
  assert.equal(trend.label, "回踩承接 / 重新转强");

  const blocked = buildEntryConfirmation({
    primaryPath: "boardEmotion",
    hardGatePassed: false,
    opportunityDataComplete: true,
    missingConditions: ["5日均成交额不足5亿"],
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.type, null);
  assert.equal(blocked.label, "当前不可确认（成交额不足）");
  assert.match(blocked.avoid, /涨停也不算系统买点/);
});

test("机会池扫描全候选但只有selected或旧分数、没有明日预期证据时不能补票", () => {
  const input = fixture();
  input.payload.candidates = [{
    code: input.picks[0].code,
    name: input.picks[0].name,
    selected: true,
    score: 999,
    factorContext: input.picks[0].factorContext,
  }];
  input.payload.premarketModels.tradingStylePreference.observationRepresentatives = {};
  const observation = buildObservationCandidates(input.payload);
  assert.equal(observation.selectedCount, 0);
  assert.deepEqual(observation.stocks, []);
  assert.deepEqual(observation.rejected.noExpectationCodes, []);
  assert.deepEqual(observation.rejected.pathMismatchCodes, []);
  assert.deepEqual(observation.rejected.dataIncompleteCodes, [input.picks[0].code]);
});

test("匿名历史核心即使旧hardGate通过且只有soft flag，缺关键当日数据也只能作锚点诊断", () => {
  const input = fixture();
  const base = input.picks[0];
  const anonymousCore = {
    ...base,
    code: "anonymous-core",
    name: "匿名历史核心",
    amountYi: null,
    turnoverRate: null,
    totalMktCapYi: null,
    floatMktCapYi: null,
    marketCapCarrier: {
      method: "same_day_candidate_bucket_comparison_unvalidated_v2",
      totalCapYi: null,
      floatCapYi: null,
      capDataQuality: "total_cap_missing",
      bucketKey: "unknown",
      bucketLabel: "总市值未知",
    },
    klineProfile: {
      ...base.klineProfile,
      lastSession: {
        ...base.klineProfile.lastSession,
        amountYi: null,
        turnoverRate: null,
      },
    },
    hardGate: {
      pass: true,
      hardFails: [],
      softFlags: ["成交活跃度待确认", "主力净流入待确认"],
    },
    leadership: {
      tradeQualified: true,
      identity: "历史情绪核心",
      tradeState: "仅观察",
      initiative: { score: 82, proactive: true },
      cycleIdentity: { identityEstablished: true, activePrimary: true },
    },
    gamePlan: { canGame: true, decision: "历史核心仍有修复预期" },
  };
  input.payload.candidates = [anonymousCore];
  input.payload.market.marketCapCarrier = {
    status: "mixed",
    preferredBucketKeys: [],
    reason: "市值偏好混合",
  };
  input.payload.premarketModels.tradingStylePreference.observationRepresentatives = {
    lowLaunch: [{ code: anonymousCore.code, name: anonymousCore.name, path: "lowLaunch" }],
  };
  input.payload.premarketModels.tradingStylePreference.opportunities = [{
    path: "lowLaunch",
    trigger: ["板块与个股同步承接"],
  }];

  const observation = buildObservationCandidates(input.payload);
  assert.equal(observation.selectedCount, 0);
  assert.deepEqual(observation.rejected.dataIncompleteCodes, [anonymousCore.code]);
  assert.deepEqual(observation.rejected.anchorOnlyCodes, [anonymousCore.code]);
  assert.deepEqual(observation.marketCapOpportunityGate.unverifiedCodes, [anonymousCore.code]);
  assert.equal(observation.dataDiagnostics.length, 1);
  assert.equal(observation.dataDiagnostics[0].diagnosticType, "historical_anchor");
  assert.equal(observation.dataDiagnostics[0].opportunityEligible, false);
  assert.equal(observation.dataDiagnostics[0].opportunityDataCompleteness.qualified, false);
  assert.equal(observation.dataDiagnostics[0].opportunityDataCompleteness.missingFields.includes("amount"), true);
  assert.equal(observation.dataDiagnostics[0].opportunityDataCompleteness.missingFields.includes("marketCap"), true);
});

test("个股即使硬门槛与领导力通过，题材未归类也不得为了凑数进入观察池", () => {
  const input = fixture();
  const candidate = {
    ...input.picks[0],
    mainConcept: "未归类",
    concepts: [],
    hardGate: { pass: true, hardFails: [] },
    leadership: {
      ...input.picks[0].leadership,
      tradeQualified: true,
      hardFails: [],
      initiative: { score: 80, dataQuality: "分时验证" },
    },
    gamePlan: { canGame: false, gameReason: "股票模式仍待承接确认" },
  };
  input.payload.candidates = [candidate];
  input.payload.premarketModels.tradingStylePreference.observationRepresentatives = {
    lowLaunch: [{ code: candidate.code, name: candidate.name, path: "lowLaunch", pathLabel: "低位启动" }],
  };
  const observation = buildObservationCandidates(input.payload);
  assert.equal(observation.stocks.length, 0);
  assert.deepEqual(observation.rejected.environmentMismatchCodes, [candidate.code]);
});

test("有明日预期且匹配资金与赚钱效应时，即使执行硬门槛待确认也必须进入机会池", () => {
  const input = fixture();
  const candidate = {
    ...input.picks[0],
    hardGate: { pass: false, hardFails: ["5日线尚未转升"] },
    leadership: { tradeQualified: false, hardFails: ["分时主动性待确认"], initiative: { score: 72 } },
    tomorrowExecution: {
      bucket: "entry",
      pricePhaseKey: "startup",
      pricePhaseLabel: "启动",
      tomorrowEntryQualified: true,
      actionLabel: "对应赚钱效应路径成立后具备条件机会",
      triggers: ["板块与个股同步承接"],
      cancelConditions: ["板块负反馈扩散"],
    },
    marketCapCarrier: marketCapEvidence("100_300", 180),
  };
  input.payload.candidates = [candidate];
  input.payload.market.marketCapCarrier = {
    status: "confirmed",
    preferredBucketKeys: ["50_100", "100_300", "300_500"],
  };
  const observation = buildObservationCandidates(input.payload);
  assert.deepEqual(observation.selectedCodes, [candidate.code]);
  assert.equal(observation.stocks[0].expectation.status, "qualified");
  assert.equal(observation.stocks[0].capitalPreference.status, "confirmed_match");
  assert.equal(observation.stocks[0].profitPreference.status, "matched");
  assert.equal(observation.stocks[0].hardGatePassed, false);
  assert.equal(observation.stocks[0].entryConfirmation.status, "blocked");
  assert.equal(observation.stocks[0].postEntryNextDayExpectation.status, "unavailable");
  assert.equal(observation.stocks[0].postEntryNextDayExpectation.label, "不适用（当前无买点）");
  assert.match(observation.stocks[0].missingConditions.join("；"), /5日线尚未转升/);
  assert.equal(observation.stocks[0].executable, false);
});

test("市值资金偏好未确认时观察池宁可为空，不用赚钱路径票硬补", () => {
  const input = fixture();
  const candidate = {
    ...input.picks[0],
    tomorrowExecution: {
      bucket: "entry",
      pricePhaseKey: "startup",
      tomorrowEntryQualified: true,
      actionLabel: "低位启动路径具备次日观察预期",
      triggers: ["板块与个股同步承接"],
      cancelConditions: ["板块负反馈扩散"],
    },
  };
  input.payload.candidates = [candidate];
  input.payload.premarketModels.tradingStylePreference.observationRepresentatives = {
    lowLaunch: [{ code: candidate.code, name: candidate.name, path: "lowLaunch", concept: "主线A" }],
  };
  input.payload.market.marketCapCarrier = {
    status: "mixed",
    preferredBucketKeys: ["100_300"],
    reason: "市值桶差异未达到确认线",
  };
  const observation = buildObservationCandidates(input.payload);
  assert.equal(observation.status, "blocked");
  assert.equal(observation.selectedCount, 0);
  assert.deepEqual(observation.rejected.finalGateRejectedCodes, [candidate.code]);
  assert.match(observation.blockers.join("；"), /市值资金偏好尚未确认/);
});

test("观察池只取持续偏好、具名赚钱载体和权威题材的交集，不足不补", () => {
  const prepare = () => {
    const input = fixture();
    input.payload.candidates = input.picks;
    input.payload.premarketModels.tradingStylePreference.observationRepresentatives = {
      lowLaunch: input.picks.map((item) => ({ code: item.code, name: item.name, path: "lowLaunch", concept: "主线A" })),
    };
    input.payload.premarketModels.tradingStylePreference.opportunities = [{
      path: "lowLaunch",
      stage: "fermenting",
      trigger: ["主线A低位载体继续产生正反馈"],
      cancel: ["主线A负反馈扩散"],
    }];
    return input;
  };

  const persistentUnknown = prepare();
  persistentUnknown.payload.premarketModels.tradingStylePreference.persistentDirectionPermission = {
    screeningStatus: "observe",
    activePaths: [],
    dominantPaths: [],
    eligibleCarrierCodesByPath: { lowLaunch: [] },
  };
  const blockedByPersistence = buildObservationCandidates(persistentUnknown.payload);
  assert.equal(blockedByPersistence.status, "blocked");
  assert.equal(blockedByPersistence.selectedCount, 0);
  assert.match(blockedByPersistence.blockers.join("；"), /持续T\+1赚钱偏好尚未确认/);

  const oneProfitCarrier = prepare();
  oneProfitCarrier.payload.market.state.effectAttribution.scopes
    .find((scope) => scope.key === "short-core")
    .referenceGroups = [{ items: [{ code: oneProfitCarrier.codes[0], name: oneProfitCarrier.picks[0].name }] }];
  const oneOnly = buildObservationCandidates(oneProfitCarrier.payload);
  assert.deepEqual(oneOnly.selectedCodes, [oneProfitCarrier.codes[0]]);
  assert.equal(oneOnly.selectedCount, 1, "只有1只属于具名正向赚钱效应时最多只展示1只");

  const noConfirmedTheme = prepare();
  noConfirmedTheme.payload.themeLibrary.mainThemeDecision.confirmedFamily = null;
  const blockedByTheme = buildObservationCandidates(noConfirmedTheme.payload);
  assert.equal(blockedByTheme.status, "blocked");
  assert.equal(blockedByTheme.selectedCount, 0);
  assert.match(blockedByTheme.blockers.join("；"), /当前权威题材尚未确认/);
});

test("前板回撤只有同时匹配当前路径、题材方向和市值偏好才进入观察池", () => {
  const input = fixture();
  const candidate = {
    ...input.picks[0],
    changePct: -2.4,
    previousLimitUpOnly: true,
    previousLimitUpEvidence: {
      status: "verified",
      exactClosing: true,
      tradingDate: "2026-08-20",
      closedAtLimit: true,
      highDays: "首板",
      reason: "特种电缆+智能电网",
      priceDiscovery: { confirmed: true, oneWord: false, noPriceDiscovery: false },
    },
    klineProfile: {
      structureBreak: false,
      lastSession: {
        tradingDate: "2026-08-21",
        close: input.picks[0].price,
        amountYi: input.picks[0].amountYi,
        turnoverRate: input.picks[0].turnoverRate,
        source: "fixture-closing-kline",
        snapshotKind: "closing",
        verified: true,
        completed: true,
        changePct: -2.4,
      },
    },
    directionState: { isCoreDirection: false },
    leadership: {
      tradeQualified: false,
      hardFails: ["分时主动性待确认"],
      initiative: { score: 52 },
      structure: { frameworkIntact: true, breakdown: false },
    },
    flowNature: { key: "uncertain", confidence: 0.3, conflict: false },
    gamePlan: { canGame: false, gameReason: "等待前板回撤后的主动承接" },
    tomorrowExecution: {
      bucket: "premium",
      pricePhaseKey: "divergence",
      tomorrowEntryQualified: false,
      actionLabel: "只验证修复，不作为直接买点",
      triggers: [],
      cancelConditions: [],
    },
    marketCapCarrier: marketCapEvidence("100_300", 180),
  };
  input.payload.candidates = [candidate];
  input.payload.hotConcepts = [{ name: "智能电网" }];
  input.payload.topicBoard = { mainLine: { name: "智能电网" }, items: [{ name: "智能电网" }] };
  input.payload.themeLibrary.mainThemeDecision.confirmedFamily = {
    id: "智能电网",
    name: "智能电网",
    state: "confirmed",
    sustained: true,
  };
  input.payload.market.limitStats = {
    dates: { today: "2026-08-21", prev: "2026-08-20", verified: true },
  };
  input.payload.market.marketCapCarrier = {
    status: "confirmed",
    preferredBucketKeys: ["100_300"],
  };
  const observation = buildObservationCandidates(input.payload);

  assert.deepEqual(observation.selectedCodes, [candidate.code]);
  assert.equal(observation.stocks[0].tierKey, "limit_up_pullback_repair");
  assert.equal(observation.stocks[0].setupLabel, "前板回撤");
  assert.equal(observation.stocks[0].theme, "智能电网");
  assert.equal(observation.stocks[0].expectation.label, "昨日涨停，今日回撤但结构未坏");
  assert.equal(observation.stocks[0].postEntryNextDayExpectation.label, "修复延续 / 冲击前高");
  assert.equal(observation.stocks[0].entryConfirmation.label, "承接转强 / 放量突破");
  assert.equal(observation.stocks[0].missingConditions[0], "板块回流且个股重新取得相对强度");
  assert.equal(observation.stocks[0].expectation.evidenceSources.includes("exactT1LimitUpPullback"), true);
  assert.equal(observation.stocks[0].expectation.evidenceSources.includes("currentThemeIntersection"), true);
  assert.equal(observation.stocks[0].executable, false);
  assert.equal(observation.executionAuthority, false);

  input.payload.candidates = [{
    ...candidate,
    hardGate: { pass: false, hardFails: ["资金流数据缺失"] },
    flowNature: { key: "escape", confidence: 0.9, conflict: false },
    tomorrowExecution: {
      bucket: "risk",
      pricePhaseKey: "failure",
      tomorrowEntryQualified: false,
      actionLabel: "资金出逃，只保留风险观察",
    },
  }];
  const escapeObservation = buildObservationCandidates(input.payload);
  assert.deepEqual(escapeObservation.selectedCodes, [candidate.code], "资金出逃不得否决符合当前炒作偏好的纠偏观察");

  const regularCandidates = input.picks.slice(1, 6).map((item) => ({
    ...item,
    mainConcept: "智能电网",
    concepts: ["智能电网"],
    gamePlan: { canGame: true, longStrength: 95, decision: "当前低位路径具备明日预期" },
    leadership: { ...item.leadership, initiative: { score: 90 }, hardFails: [] },
    tomorrowExecution: {
      bucket: "entry",
      pricePhaseKey: "startup",
      tomorrowEntryQualified: true,
      actionLabel: "低位路径条件机会",
      triggers: ["板块与个股同步承接"],
      cancelConditions: ["板块负反馈扩散"],
    },
    marketCapCarrier: marketCapEvidence("100_300", 180),
  }));
  const pullbackPeers = [
    { code: "009001", name: "纠偏样本A", flowNature: { key: "escape", confidence: 0.9, conflict: false } },
    { code: "009002", name: "纠偏样本B", flowNature: null },
  ].map((overrides) => ({ ...candidate, ...overrides }));
  const peerCodes = pullbackPeers.map((item) => item.code);
  input.payload.premarketModels.tradingStylePreference.persistentDirectionPermission.eligibleCarrierCodes.push(...peerCodes);
  input.payload.premarketModels.tradingStylePreference.persistentDirectionPermission.eligibleCarrierCodesByPath.lowLaunch.push(...peerCodes);
  input.payload.market.state.effectAttribution.scopes
    .find((scope) => scope.key === "short-core")
    .referenceGroups[0].items.push(...pullbackPeers.map((item) => ({ code: item.code, name: item.name })));
  input.payload.candidates = [candidate, ...pullbackPeers, ...regularCandidates];
  const diversified = buildObservationCandidates(input.payload);
  assert.equal(diversified.selectedCount, 5);
  assert.equal(diversified.selectedCodes.includes(candidate.code), true, "合格纠偏路径代表不得被同类高分票完全淹没");
  assert.equal(diversified.counts.pullbackRepairCandidates, 2);
  assert.equal(
    pullbackPeers.filter((item) => diversified.selectedCodes.includes(item.code)).length,
    1,
    "总计5只时前板回撤只保留2席，其余位置留给其他有效路径",
  );
  assert.match(diversified.rule, /5只是上限而不是目标/);
  assert.match(diversified.rule, /前板回撤最多2只/);

  input.payload.candidates = [candidate, ...pullbackPeers];
  const pullbackOnly = buildObservationCandidates(input.payload);
  assert.equal(pullbackOnly.selectedCount, 2, "只有前板回撤可用时也不得放入第3只，不足5只不强补");
  assert.equal(pullbackOnly.counts.pullbackRepairCandidates, 2);

  input.payload.candidates = [candidate];
  input.payload.market.marketCapCarrier.preferredBucketKeys = ["over_1000"];
  const capMismatch = buildObservationCandidates(input.payload);
  assert.equal(capMismatch.selectedCount, 0, "市值偏好不匹配时前板身份不得绕过过滤");

  input.payload.market.marketCapCarrier.preferredBucketKeys = ["100_300"];
  input.payload.hotConcepts = [{ name: "机器人" }];
  input.payload.themeLibrary.mainThemeDecision.confirmedFamily = {
    id: "机器人",
    name: "机器人",
    state: "confirmed",
    sustained: true,
  };
  input.payload.premarketModels.tradingStylePreference.observationRepresentatives = {
    lowLaunch: [{ code: candidate.code, name: candidate.name, path: "lowLaunch" }],
  };
  const themeMismatch = buildObservationCandidates(input.payload);
  assert.equal(themeMismatch.selectedCount, 0, "只有路径代表但当前题材不匹配时仍必须剔除");
});

test("次日状态已明确失败时即使热榜和路径匹配也不得进入机会池", () => {
  const input = fixture();
  const candidate = {
    ...input.picks[0],
    tomorrowExecution: {
      bucket: "risk",
      pricePhaseKey: "failure",
      actionLabel: "取消新开仓资格，只保留风险观察",
      tomorrowEntryQualified: false,
    },
  };
  input.payload.candidates = [candidate];
  input.payload.premarketModels.tradingStylePreference.observationRepresentatives = {
    lowLaunch: [{ code: candidate.code, name: candidate.name, path: "lowLaunch", eastRank: 1 }],
  };
  const observation = buildObservationCandidates(input.payload);
  assert.equal(observation.selectedCount, 0);
  assert.deepEqual(observation.rejected.fatalRiskCodes, [candidate.code]);
});

test("短线赚钱效应没有具名载体时失败关闭，不用全市场上涨或下游结果反向补票", () => {
  const input = fixture();
  const scope = input.payload.market.state.effectAttribution.scopes.find((item) => item.key === "short-core");
  scope.label = "暂无短线赚钱载体";
  scope.tone = "bad";
  scope.referenceGroups = [{ items: [] }];
  const tradeable = input.payload.market.state.effectAttribution.scopes.find((item) => item.key === "tradeable");
  assert.equal(tradeable.referenceGroups[0].items.length > 0, true);
  const chain = runUnifiedDecisionChain(input);
  assert.equal(chain.profitEffect.status, "blocked");
  assert.equal(chain.theme.status, "not_evaluated");
  assert.equal(chain.result.selectedCount, 0);
});

test("题材和股票模式必须与赚钱载体取交集", () => {
  const input = fixture();
  input.premarketGate.directionEligibleCodes = input.codes.slice(0, 4);
  input.premarketGate.styleEligibleCodes = input.codes.slice(2, 6);
  const chain = runUnifiedDecisionChain(input);
  assert.deepEqual(chain.result.selectedCodes, input.codes.slice(2, 4));
  assert.equal(chain.result.selectedCount, 2);
});

test("市值赚钱效应confirmed时才缩减机会eligibleCodes，超大市值仍不改写情绪核心", () => {
  const input = fixture();
  input.picks.forEach((item, index) => {
    item.marketCapCarrier = index < 3
      ? marketCapEvidence("100_300", 180 + index)
      : marketCapEvidence("over_1000", 1200 + index);
  });
  input.payload.candidates = input.picks;
  input.payload.market.marketCapCarrier = {
    status: "confirmed",
    preferredBucketKeys: ["under_50", "50_100", "100_300", "300_500"],
    reason: "当日500亿以下候选表现显著更强",
    calibrated: false,
  };
  const chain = runUnifiedDecisionChain(input);
  assert.deepEqual(chain.profitEffect.baseEligibleCodes, input.codes);
  assert.deepEqual(chain.profitEffect.eligibleCodes, input.codes.slice(0, 3));
  assert.deepEqual(chain.profitEffect.marketCapOpportunityGate.excludedCodes, input.codes.slice(3));
  assert.deepEqual(chain.result.selectedCodes, input.codes.slice(0, 3));
  const shortCore = input.payload.market.state.effectAttribution.scopes.find((item) => item.key === "short-core");
  assert.equal(shortCore.referenceGroups[0].items.length, 6, "情绪/赚钱效应原始锚点不能被机会准入改写");
});

test("市值赚钱效应mixed时只软提示，不能硬删机会候选", () => {
  const input = fixture();
  input.picks.forEach((item, index) => {
    item.marketCapCarrier = marketCapEvidence("over_1000", 1200 + index);
  });
  input.payload.candidates = input.picks;
  input.payload.market.marketCapCarrier = {
    status: "mixed",
    preferredBucketKeys: ["under_50"],
    reason: "市值桶差异未达确认线",
  };
  const chain = runUnifiedDecisionChain(input);
  assert.equal(chain.profitEffect.marketCapOpportunityGate.applied, false);
  assert.deepEqual(chain.profitEffect.eligibleCodes, input.codes);
  assert.deepEqual(chain.result.selectedCodes, input.codes.slice(0, 5));
});

test("市值偏好mixed只取消桶偏好过滤，个股自身总市值未知仍必须失败关闭", () => {
  const input = fixture();
  const incomplete = input.picks[0];
  incomplete.marketCapCarrier = {
    method: "same_day_candidate_bucket_comparison_unvalidated_v2",
    totalCapYi: null,
    capDataQuality: "total_cap_missing",
    bucketKey: "unknown",
  };
  input.payload.candidates = input.picks;
  input.payload.market.marketCapCarrier = {
    status: "mixed",
    preferredBucketKeys: ["under_50"],
    reason: "市值桶差异未达确认线",
  };
  const chain = runUnifiedDecisionChain(input);
  assert.equal(chain.profitEffect.marketCapOpportunityGate.applied, false);
  assert.deepEqual(chain.profitEffect.marketCapOpportunityGate.unverifiedCodes, [incomplete.code]);
  assert.equal(chain.profitEffect.eligibleCodes.includes(incomplete.code), false);
  assert.equal(chain.result.selectedCodes.includes(incomplete.code), false);
  assert.equal(
    input.payload.market.state.effectAttribution.scopes
      .find((item) => item.key === "short-core")
      .referenceGroups[0].items.some((item) => item.code === incomplete.code),
    true,
    "市值缺失只关闭机会资格，不删除情绪锚点原始身份",
  );
});

test("观察机会池在市值偏好confirmed时过滤错配票且仍保持最多5只", () => {
  const input = fixture();
  input.payload.candidates = input.picks.map((item, index) => ({
    ...item,
    marketCapCarrier: index < 2
      ? marketCapEvidence("100_300", 180 + index)
      : marketCapEvidence("over_1000", 1200 + index),
    leadership: { ...item.leadership, initiative: { score: 80 - index } },
  }));
  input.payload.market.marketCapCarrier = {
    status: "confirmed",
    preferredBucketKeys: ["100_300"],
  };
  input.payload.premarketModels.tradingStylePreference.observationRepresentatives = {
    lowLaunch: input.payload.candidates.map((item) => ({ code: item.code, name: item.name, path: "lowLaunch" })),
  };
  const observation = buildObservationCandidates(input.payload);
  assert.deepEqual(observation.selectedCodes, input.codes.slice(0, 2));
  assert.deepEqual(observation.marketCapOpportunityGate.excludedCodes, input.codes.slice(2));
  assert.equal(observation.marketCapOpportunityGate.applied, true);
  assert(observation.stocks.length <= MAX_RESULT_STOCKS);
});

test("结果股仓位按风险调整后参与价值归一化，组合不超过市场仓位上限", () => {
  const chain = runUnifiedDecisionChain(fixture());
  const stocks = chain.result.stocks;
  const relative = round(stocks.reduce((sum, item) => sum + item.positionAllocation.relativeWeightPct, 0));
  const maximum = round(stocks.reduce((sum, item) => sum + item.positionAllocation.maximumPortfolioPct, 0));
  assert.equal(relative, 100);
  assert.equal(maximum, chain.authorization.positionPermission.positionCeilingPct);
  assert(stocks[0].positionAllocation.maximumPortfolioPct > stocks[4].positionAllocation.maximumPortfolioPct);
});

test("旧marketState与marketEmotion仓位不得改写统一链仓位权限", () => {
  const input = fixture();
  input.payload.market.state.position = "5%";
  input.payload.marketEmotion.position = "2%";
  const chain = runUnifiedDecisionChain(input);
  assert.equal(chain.authorization.passed, true);
  assert.deepEqual(chain.authorization.positionPermission.sourceRangePct, [40, 60]);
  assert.equal(chain.authorization.positionPermission.positionCeilingPct, 60);
  assert.equal(chain.result.participationAndAllocation.positionCeilingPct, 60);
});

test("统一决策链成为bestPicks唯一选股权限并清理未授权情景票", () => {
  const input = fixture();
  const chain = runUnifiedDecisionChain(input);
  const result = applyDecisionChainToBestPicks(input.payload.bestPicks, chain);
  assert.equal(result.selectionAuthority, "unified_decision_chain_v3");
  assert.equal(result.executionVersion, 3);
  assert.equal(result.picks.length, 5);
  assert.deepEqual(result.decisionPool.map((item) => item.code), chain.result.selectedCodes);
  assert.equal(result.decisionPoolExecutionScope, "authorized_result_only");
  assert.equal(result.picks[0].positionAllocation.maximumPortfolioPct > 0, true);
  const removedPlan = result.scenarioPlans.find((plan) => plan.key === "rotation");
  assert.equal(removedPlan.status, "blocked");
  assert.equal(removedPlan.candidate, null);
});

test("legacy仓位80%与统一链10%冲突时，正式bestPicks只执行canonicalAllocation 10%", () => {
  const input = fixture();
  const first = input.picks[0];
  first.position = "80%";
  first.stopLossPlan = { position: "80%", stop: "跌破取消" };
  first.advice = { position: "80%", buy: "观察承接" };
  input.payload.premarketModels.indexCycleRegime.positionPermission.positionRangePct = [0, 10];
  input.premarketGate.allowedCandidateCodes = [first.code];
  input.premarketGate.directionEligibleCodes = [first.code];
  input.premarketGate.styleEligibleCodes = [first.code];

  const chain = runUnifiedDecisionChain(input);
  assert.equal(chain.result.stocks[0].positionAllocation.initialPortfolioPct, 10);
  const projected = applyDecisionChainToBestPicks(input.payload.bestPicks, chain);
  assert.equal(projected.picks[0].canonicalAllocation.initialPortfolioPct, 10);
  assert.equal(projected.picks[0].positionAllocation.initialPortfolioPct, 10);
  assert.equal(Object.prototype.hasOwnProperty.call(projected.picks[0], "position"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(projected.picks[0].stopLossPlan, "position"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(projected.picks[0].advice, "position"), false);
  assert.equal(projected.picks[0].legacyObservation.position.topLevel, "80%");
  assert.equal(projected.picks[0].legacyObservation.position.stopLossPlan, "80%");
  assert.equal(projected.picks[0].legacyObservation.position.advice, "80%");
  assert.equal(projected.picks[0].legacyObservation.executionAuthority, false);

  input.payload.unifiedDecisionChain = chain;
  input.payload.bestPicks = projected;
  assert.equal(inspectAuthoritativeDecisionChain(input.payload, { requireBestPicksProjection: true }).valid, true);
  const leaked = structuredClone(input.payload);
  leaked.bestPicks.picks[0].advice.position = "80%";
  assert.equal(inspectAuthoritativeDecisionChain(leaked, { requireBestPicksProjection: true }).projectionValid, false);
});

test("内部决策池可以大于5只，交集过滤后仍能补入后续真正合格标的", () => {
  const input = fixture();
  input.payload.bestPicks.decisionPool = input.picks;
  input.payload.bestPicks.picks = input.picks.slice(0, 5);
  input.premarketGate.directionEligibleCodes = [input.codes[5]];
  input.premarketGate.styleEligibleCodes = [input.codes[5]];
  const chain = runUnifiedDecisionChain(input);
  assert.deepEqual(chain.result.selectedCodes, [input.codes[5]]);
});

test("修复不能作为大周期混入统一决策链，发现后失败关闭", () => {
  const input = fixture();
  input.payload.marketPhaseDetail.decisionContext.bigCycle = {
    key: "repair",
    label: "修复",
    status: "canonical",
    source: "invalid_fixture",
  };
  const chain = runUnifiedDecisionChain(input);
  assert.equal(chain.marketStage.passed, false);
  assert.match(chain.marketStage.blockers.join("；"), /五态枚举/);
  assert.equal(chain.authorization.status, "blocked");
  assert.equal(chain.result.selectedCount, 0);
});

test("缺少或错配T-1权威情绪时，统一决策链严格关闭且不输出股票", () => {
  const missing = fixture();
  delete missing.payload.emotionCycle.previous;
  const missingChain = runUnifiedDecisionChain(missing);
  assert.equal(missingChain.marketStage.previousEmotionStage.passed, false);
  assert.match(missingChain.marketStage.blockers.join("；"), /T-1权威情绪状态不可用/);
  assert.equal(missingChain.result.selectedCount, 0);

  const mismatched = fixture();
  mismatched.payload.emotionCycle.previous.tradingDate = "2026-08-19";
  const mismatchedChain = runUnifiedDecisionChain(mismatched);
  assert.equal(mismatchedChain.marketStage.previousEmotionStage.passed, false);
  assert.match(mismatchedChain.marketStage.blockers.join("；"), /T-1情绪日期不匹配/);
  assert.equal(mismatchedChain.authorization.positionPermission.positionCeilingPct, 0);
});

test("T-1不能只靠authority字符串冒充，必须具备精确身份、同代周期和确定性回放审计", () => {
  const notExact = fixture();
  notExact.payload.emotionCycle.previous.exactCanonical = false;
  const notExactChain = runUnifiedDecisionChain(notExact);
  assert.equal(notExactChain.marketStage.previousEmotionStage.passed, false);
  assert.match(notExactChain.marketStage.blockers.join("；"), /精确canonical/);

  const staleCycle = fixture();
  staleCycle.payload.emotionCycle.generationId = "2026-08-20:stale";
  const staleCycleChain = runUnifiedDecisionChain(staleCycle);
  assert.equal(staleCycleChain.marketStage.previousEmotionStage.passed, false);
  assert.match(staleCycleChain.marketStage.blockers.join("；"), /情绪周期与当前决策代次/);

  const wrongReplayTarget = fixture();
  wrongReplayTarget.payload.emotionCycle.previous.replayAudit.targetTradingDate = "2026-08-19";
  const wrongReplayChain = runUnifiedDecisionChain(wrongReplayTarget);
  assert.equal(wrongReplayChain.marketStage.previousEmotionStage.passed, false);
  assert.match(wrongReplayChain.marketStage.blockers.join("；"), /回放缺少确定性模式/);
});

test("个股排序未使用同代统一周期上下文时，即使旧评分和许可全绿也不能授权", () => {
  const input = fixture();
  delete input.payload.bestPicks.selectionContext;
  const missing = runUnifiedDecisionChain(input);
  assert.equal(missing.stockSelectionContext.passed, false);
  assert.equal(missing.result.selectedCount, 0);
  assert.equal(missing.integrity.ok, false);

  const stale = fixture();
  stale.payload.bestPicks.selectionContext.generationId = "2026-08-20:stale";
  const staleChain = runUnifiedDecisionChain(stale);
  assert.equal(staleChain.stockSelectionContext.passed, false);
  assert.match(staleChain.stockSelectionContext.blockers.join("；"), /代次不一致/);
  assert.equal(staleChain.result.selectedCount, 0);
});

test("旧个股评分即使数值完整也不得冒充统一因子引擎", () => {
  const missingAuthority = fixture();
  delete missingAuthority.payload.bestPicks.factorEngineAuthority;
  delete missingAuthority.payload.bestPicks.factorEngineVersion;
  delete missingAuthority.payload.bestPicks.selectionContext.factorEngineAuthority;
  delete missingAuthority.payload.bestPicks.selectionContext.factorEngineVersion;
  const missingChain = runUnifiedDecisionChain(missingAuthority);
  assert.equal(missingChain.stockSelectionContext.factorEngineAccepted, false);
  assert.match(missingChain.stockSelectionContext.blockers.join("；"), /统一因子引擎/);
  assert.equal(missingChain.result.selectedCount, 0);

  const mixedAuthority = fixture();
  mixedAuthority.picks[0].factorDecision.authority = "legacy_stock_score";
  const mixedChain = runUnifiedDecisionChain(mixedAuthority);
  assert.equal(mixedChain.stockSelectionContext.factorDecisionsAligned, false);
  assert.match(mixedChain.stockSelectionContext.blockers.join("；"), /旧个股评分/);
  assert.equal(mixedChain.result.selectedCount, 0);
});

test("个股排序的大周期和小周期必须同时与权威phase context一致", () => {
  const selectionMismatch = fixture();
  selectionMismatch.payload.bestPicks.selectionContext.smallCycle = { key: "repair", label: "修复" };
  selectionMismatch.picks.forEach((item) => {
    item.factorContext = { ...item.factorContext, smallCycle: { key: "repair", label: "修复" } };
  });
  const selectionChain = runUnifiedDecisionChain(selectionMismatch);
  assert.equal(selectionChain.stockSelectionContext.passed, false);
  assert.match(selectionChain.stockSelectionContext.blockers.join("；"), /大周期或小周期/);
  assert.equal(selectionChain.result.selectedCount, 0);

  const factorMismatch = fixture();
  factorMismatch.picks[0].factorContext = {
    ...factorMismatch.picks[0].factorContext,
    smallCycle: { key: "repair", label: "修复" },
  };
  const factorChain = runUnifiedDecisionChain(factorMismatch);
  assert.equal(factorChain.stockSelectionContext.factorContextsAligned, false);
  assert.equal(factorChain.result.selectedCount, 0);
});

test("decisionContext内层代次不能被外层当前代次遮蔽", () => {
  const input = fixture();
  input.payload.marketPhaseDetail.decisionContext.generationId = "2026-08-20:stale";
  const chain = runUnifiedDecisionChain(input);
  assert.equal(chain.generation.aligned, false);
  assert.equal(chain.result.selectedCount, 0);
});

test("价格或三个评分任一缺失都不能进入结果并获得平均分仓", () => {
  const missingScore = fixture();
  delete missingScore.picks[0].factorDecision.finalScore;
  missingScore.picks[0].score = 999;
  const scoreChain = runUnifiedDecisionChain(missingScore);
  assert.equal(scoreChain.result.selectedCodes.includes(missingScore.codes[0]), false);
  assert.match(scoreChain.result.rejected.find((row) => row.code === missingScore.codes[0]).reasons.join("；"), /最终评分缺失/);

  const missingPriceIntegrity = fixture();
  delete missingPriceIntegrity.picks[0].priceIntegrity;
  const priceChain = runUnifiedDecisionChain(missingPriceIntegrity);
  assert.equal(priceChain.result.selectedCodes.includes(missingPriceIntegrity.codes[0]), false);
  assert.match(priceChain.result.rejected.find((row) => row.code === missingPriceIntegrity.codes[0]).reasons.join("；"), /价格完整性/);
});

test("上游合法关闭时下游排序上下文未执行，不应把schema链误判为损坏", () => {
  const input = fixture();
  input.payload.market.state.tradeWindow.allowNew = false;
  delete input.payload.bestPicks.selectionContext;
  input.picks.forEach((item) => { delete item.factorContext; });
  const chain = runUnifiedDecisionChain(input);
  assert.equal(chain.authorization.passed, false);
  assert.equal(chain.integrity.selectionContextRequired, false);
  assert.equal(chain.integrity.ok, true);
  input.payload.unifiedDecisionChain = chain;
  input.payload.bestPicks = applyDecisionChainToBestPicks(input.payload.bestPicks, chain);
  assert.equal(inspectAuthoritativeDecisionChain(input.payload, { requireBestPicksProjection: true }).valid, true);
});

test("共享权威检查器同时校验版本、完整代次、步骤顺序和仓位合计", () => {
  const input = fixture();
  const chain = runUnifiedDecisionChain(input);
  input.payload.unifiedDecisionChain = chain;
  input.payload.bestPicks = applyDecisionChainToBestPicks(input.payload.bestPicks, chain);
  assert.equal(inspectAuthoritativeDecisionChain(input.payload, { requireBestPicksProjection: true }).valid, true);

  const corruptVersion = structuredClone(input.payload);
  corruptVersion.unifiedDecisionChain.version = 4;
  assert.equal(inspectAuthoritativeDecisionChain(corruptVersion).chainValid, false);

  const missingGeneration = structuredClone(input.payload);
  delete missingGeneration.generationId;
  delete missingGeneration.generationContext;
  delete missingGeneration.marketPhaseDetail.generationId;
  delete missingGeneration.marketPhaseDetail.decisionContext.generationId;
  delete missingGeneration.marketPhaseDetail.decisionContext.tradingDate;
  delete missingGeneration.marketPhaseDetail.decisionContext.asOf;
  delete missingGeneration.premarketModels.generationId;
  assert.equal(inspectAuthoritativeDecisionChain(missingGeneration).chainValid, false);

  const corruptAllocation = structuredClone(input.payload);
  corruptAllocation.unifiedDecisionChain.result.stocks[0].positionAllocation.maximumPortfolioPct += 5;
  assert.equal(inspectAuthoritativeDecisionChain(corruptAllocation).chainValid, false);

  const corruptCycleReason = structuredClone(input.payload);
  corruptCycleReason.marketPhaseDetail.decisionContext.bigCycle.reason = "被篡改的五日周期理由";
  assert.equal(inspectAuthoritativeDecisionChain(corruptCycleReason).chainValid, false);

  const leakedPool = structuredClone(input.payload);
  leakedPool.bestPicks.decisionPool.push(input.picks[5]);
  assert.equal(inspectAuthoritativeDecisionChain(leakedPool, { requireBestPicksProjection: true }).projectionValid, false);

  const missingResultScore = structuredClone(input.payload);
  missingResultScore.unifiedDecisionChain.result.stocks[0].riskAdjustedParticipationScore = null;
  assert.equal(inspectAuthoritativeDecisionChain(missingResultScore).chainValid, false);

});

test("生产排序中旧selected只允许用于验证模式，正式模式授权不再读取selected", () => {
  const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const start = source.indexOf("modeAllowed: Boolean(");
  const end = source.indexOf("dataComplete:", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);
  assert.match(body, /rankingStudy\s*&&\s*stock\s*&&\s*stock\.selected/);
  assert.doesNotMatch(body, /Boolean\(\s*stock\s*&&\s*stock\.selected/);
  assert.match(source, /buildUnifiedStockFactorDecision\(\{/);
});

test("8月26日真实回归：主动载体结构仍有效，但持续偏好未确认时观察池保持为空", (t) => {
  const archivePath = path.join(__dirname, "data", "history", "2026-08-26.json");
  if (!fs.existsSync(archivePath)) {
    t.skip("发布包按设计不携带桌面完整历史归档；真实归档回归仅在权威桌面仓库执行");
    return;
  }
  const history = JSON.parse(fs.readFileSync(archivePath, "utf8"));
  const activeCarrier = history.candidates.find((item) => item.name === "杭电股份");
  const historicalAnchor = history.candidates.find((item) => item.name === "长飞光纤");
  assert.ok(activeCarrier, "历史 fixture 必须包含当日主动高度载体");
  assert.ok(historicalAnchor, "历史 fixture 必须包含被动历史核心");

  const activeCompleteness = evaluateOpportunityDataCompleteness(activeCarrier, {
    tradingDate: history.tradingDate,
  });
  const anchorCompleteness = evaluateOpportunityDataCompleteness(historicalAnchor, {
    tradingDate: history.tradingDate,
  });
  assert.equal(activeCompleteness.qualified, true, "杭电的同日价格、成交、换手、市值与收盘证据必须完整");
  assert.equal(activeCompleteness.evidence.session.state, "verified_closing");
  assert.equal(anchorCompleteness.qualified, false, "长飞的历史核心身份不得掩盖个股关键字段缺失");
  assert.equal(anchorCompleteness.missingFields.includes("liquidityCapacity"), true);
  assert.equal(anchorCompleteness.missingFields.includes("marketCap"), true);

  const activeStructure = evaluateShortTermActiveCarrier(activeCarrier);
  assert.equal(activeStructure.qualified, true);
  assert.equal(activeStructure.verifiedClosingLimit, true);
  assert.equal(activeStructure.hasPriceDiscovery, true);
  assert.equal(activeStructure.maAligned, true);
  assert.equal(activeStructure.liquidityStatus, "sufficient");

  const refreshedGate = hardGate(activeCarrier);
  assert.equal(refreshedGate.pass, true);
  assert.equal(refreshedGate.hardFails.includes("5日线未持续向上"), false);
  assert.match(refreshedGate.softFlags.join("；"), /只限制追高/);

  const activeTomorrow = classifyTomorrowExecution(activeCarrier, { tradingDate: history.tradingDate });
  assert.equal(activeTomorrow.bucket, "premium");
  assert.equal(activeTomorrow.tomorrowEntryQualified, false);
  assert.equal(activeTomorrow.shortTermActiveCarrier, true);
  assert.match(activeTomorrow.evidence.join("；"), /不改写当日主动载体的短线结构/);

  const anchorTomorrow = classifyTomorrowExecution(historicalAnchor, { tradingDate: history.tradingDate });
  assert.equal(anchorTomorrow.bucket, "ignore");
  assert.equal(anchorTomorrow.tomorrowEntryQualified, false);
  assert.equal(anchorTomorrow.historicalAnchorOnly, true);

  const pool = buildObservationCandidates(history);
  assert.equal(pool.selectedCount, 0, "持续偏好未确认时，即使个股结构合格也不能为了凑数进入观察池");
  assert.match(pool.blockers.join("；"), /持续T\+1赚钱偏好尚未确认/);
  assert.equal(pool.selectedCodes.includes(historicalAnchor.code), false);
});

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
