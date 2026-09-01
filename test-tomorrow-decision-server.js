"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  fetchJsonDirect,
  cloudSnapshotWithUnifiedProjection,
  canonicalSelectionContext,
  createGenerationContext,
  refreshPremarketModels,
  refreshTomorrowDecision,
  normalizeHotStocksFallbackResponse,
  prepareEmotionBuildInputs,
  emotionDecisionDateContext,
  themeLibrarySnapshotFromPayload,
  loadPrevArchive,
  replayExactClosingEmotionCoreEvidence,
  strictExactClosingEvidence,
  projectOpportunityCardsToCanonicalAllocation,
  buildCycleHistorySnapshot,
  inspectCycleHistorySnapshot,
  persistCycleHistorySnapshot,
  loadCycleHistorySnapshot,
  loadEmotionBigCycleWindowRecords,
  buildEmotionBigCycleWindowForPayload,
  selectPreviousIndexEnvironment,
} = require("./server")._internals;
const { INDEX_CYCLE_REGIME_VERSION } = require("./index-cycle-regime");
const { ENGINE_VERSION: MARKET_CYCLE_ENGINE_VERSION } = require("./market-cycle-engine");
const {
  buildEmotionCoreEvidenceFromPayload,
  previousRowLineageMatches,
} = require("./emotion-core-evidence-contract");
const { validateEmotionScenarioInference } = require("./emotion-scenario-inference");
const { buildUnifiedQuantFactors } = require("./unified-quant-factors");
const { THEME_LIBRARY_CLASSIFIER_VERSION } = require("./theme-library");

test("native fetch failure reaches curl fallback without a timeout-scope ReferenceError", async () => {
  await assert.rejects(
    () => fetchJsonDirect("http://127.0.0.1:1/unreachable", { timeoutMs: 1000 }),
    (error) => {
      assert.doesNotMatch(String(error && error.message || error), /effectiveTimeoutMs is not defined|fallbackTimeoutMs is not defined/);
      return true;
    },
  );
});

test("盘后机会卡的legacy 80%仓位必须被统一链canonical 10%覆盖", () => {
  const authority = {
    chain: {
      result: {
        stocks: [{
          code: "300001",
          positionAllocation: {
            relativeWeightPct: 100,
            initialPortfolioPct: 10,
            maximumPortfolioPct: 30,
          },
        }],
      },
    },
  };
  const [card] = projectOpportunityCardsToCanonicalAllocation([{
    code: "300001",
    plan: { position: "80%", buy: { summary: "承接" } },
  }], authority);
  assert.equal(card.canonicalAllocation.initialPortfolioPct, 10);
  assert.equal(card.plan.canonicalAllocation.initialPortfolioPct, 10);
  assert.equal(card.plan.position.initialPortfolioPct, 10);
  assert.equal(card.plan.legacyObservation.position.sourcePlan, "80%");
  assert.equal(card.plan.legacyObservation.executionAuthority, false);
  assert.equal(card.allocationAuthority, "unified_decision_chain_v3");
});

test("选股周期上下文的内外两层代次都必须与当前快照一致", () => {
  const generationId = "2026-08-21:2026-08-21T15:00:00.000Z";
  const asOf = "2026-08-21T15:00:00.000Z";
  const source = {
    generationId,
    tradingDate: "2026-08-21",
    asOf,
    marketPhaseDetail: {
      generationId,
      tradingDate: "2026-08-21",
      asOf,
      decisionContext: {
        generationId,
        tradingDate: "2026-08-21",
        asOf,
        bigCycle: { key: "range", label: "震荡" },
        smallCycle: { key: "range", label: "震荡" },
      },
    },
  };
  assert.equal(canonicalSelectionContext(source).passed, true);

  source.marketPhaseDetail.decisionContext.generationId = "2026-08-20:stale";
  assert.equal(canonicalSelectionContext(source).passed, false);
  assert.match(canonicalSelectionContext(source).blockers.join("；"), /代次不一致/);
});

function core(code, name, changePct = 7) {
  return {
    code,
    name,
    role: "中军",
    changePct,
    amountYi: 30,
    leadership: {
      recognized: true,
      coreIdentityQualified: true,
      impactScore: 90,
      initiative: {
        score: 85,
        proactive: true,
        capacity: true,
        retentionPct: 82,
        dataQuality: "分时验证",
        session: {
          currentChangePct: changePct,
          maxChangePct: changePct + 1,
          minChangePct: 1,
          limitTouched: false,
          limitOpenCount: 0,
          resealedAfterOpen: false,
          closedAtLimit: false,
          postTouchMaxPullbackPct: null,
        },
      },
      history: { appearances: 2 },
      structure: { breakdown: false },
    },
    klineProfile: { lastTradingDate: "2026-08-07" },
    speculation: { boards: 1, expectation: "在途" },
  };
}

function selectedPick() {
  return {
    ...core("300476", "胜宏科技", 12.01),
    mainConcept: "PCB概念",
    price: 280.2,
    priceIntegrity: { price: 280.2, consistent: true, valid: true },
    buy: {
      mode: "低吸试错",
      auctionLines: ["271.79 ~ 284.40 (-3%~+1.5%) → 观察区", "开盘价 > 284.40 → 先不追"],
    },
    sell: {
      hardStop: { pctRange: [-5.6, -5], priceRange: [264.51, 266.19] },
      breakEven: { pct: 3, price: 288.61 },
      closeLine: { ma5: 231.56, rule: "14:55仍失守MA5则清仓" },
      intradayPullback: "回流失败先减",
      splNote: "趋势模式：止损-5.6%~-5%，止盈15%~20%",
    },
    tomorrowExecution: {
      tomorrowEntryQualified: true,
      stateLabel: "启动",
      triggers: ["PCB至少两只独立核心同步走强", "第一次回踩承接有效"],
      cancelConditions: ["只有胜宏科技单点上涨", "放量跌破首次承接低点"],
    },
  };
}

function payload() {
  const pick = selectedPick();
  return {
    fetchedAt: "2026-08-07T07:10:00.000Z",
    stale: false,
    fetchError: null,
    fetchStatus: { level: "ok" },
    market: {
      snapshot: {
        avgIndexChange: 0.5,
        breadth: 0.52,
        shszAmountYi: 20000,
        indexStructures: [
          { trendKey: "repair" },
          { trendKey: "sideways" },
          { trendKey: "repair" },
          { trendKey: "sideways" },
        ],
      },
      limitStats: {
        ztToday: 62,
        dtToday: 5,
        dates: { today: "20260807", prev: "20260806", verified: true },
      },
      state: {
        structuralCycle: "修复",
        cycle: "修复",
        dailyState: { key: "healthy_divergence", label: "健康分化" },
        profitEffect: { score: 58 },
        lossEffect: { score: 35 },
        tradeWindow: { key: "warming_watch", allowNew: false, positionGuide: "核心确认后再执行" },
      },
    },
    marketEmotion: {
      cycle: "修复",
      light: "yellow",
      lightLabel: "黄灯",
      review: { tomorrow: { positionLimit: "最多计划仓位1/3试错" } },
      validation: { upgrade: [], hold: [], downgrade: [] },
    },
    candidates: [pick, core("600001", "独立核心甲"), core("600002", "独立核心乙")],
    riskBoard: { blockedConcepts: [], blockedTicketTypes: [], blockedSetups: [], items: [] },
    bestPicks: {
      available: true,
      focusDirection: "PCB概念",
      priceIntegrity: { status: "pass" },
      executionGate: { active: false },
      picks: [pick],
      scenarioPlans: [
        { key: "strengthen", status: "ready", candidate: { code: pick.code, name: pick.name, mainConcept: pick.mainConcept, tomorrowEntryQualified: true } },
        { key: "rotation", status: "empty", candidate: null },
        { key: "weakRepair", status: "empty", candidate: null },
      ],
    },
  };
}

test("cycle-only closing archive roundtrip keeps future T-1 state independent from formal trade receipt", () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cycle-history-roundtrip-"));
  const historyDir = path.join(runtimeDir, "cycle-history");
  const revisionDir = path.join(runtimeDir, "cycle-history-revisions");
  try {
    const source = payload();
    const tradingDate = "2031-03-10";
    const asOf = "2031-03-10T07:10:00.000Z";
    const generationContext = createGenerationContext({ tradingDate, asOf });
    const indexEnvironment = {
      verified: true,
      structureCoverage: 4,
      cycle: "混沌",
      breadth: 0.58,
      avgIndexChange: 0.45,
      mediumTerm: { key: "repair" },
      shortTerm: {
        windowDays: 5,
        key: "range",
        metrics: { windowDays: 5, aboveMa5KnownCount: 4, aboveMa5Count: 3, aboveMa5Rate: 0.75 },
      },
      rangeConfirmation: { windowDays: 5, currentQualified: true },
      generationContext,
    };
    source.fetchedAt = asOf;
    source.asOf = asOf;
    source.tradingDate = tradingDate;
    source.generationId = generationContext.generationId;
    source.generationContext = generationContext;
    source.market.limitStats.dates = { today: tradingDate, prev: "2031-03-07", verified: true };
    source.market.snapshot.tradingDate = tradingDate;
    source.market.state = {
      structuralCycle: "混沌",
      cycle: "混沌",
      dailyState: { key: "repair_strengthening", label: "修复加强", generationContext },
      profitEffect: { score: 71 },
      lossEffect: { score: 27 },
      emotionEffectContext: { version: 1, method: "whole_market_emotion_effect_v1", status: "ready" },
      emotionBigCycleWindow: {
        version: 1,
        method: "five_day_weighted_emotion_big_cycle_window_v1",
        windowDays: 5,
        status: "unavailable",
        tradingDate,
        generationContext,
        observations: [],
      },
      indexEnvironment,
      structuralResolution: {
        version: MARKET_CYCLE_ENGINE_VERSION,
        engineVersion: MARKET_CYCLE_ENGINE_VERSION,
        cycle: "混沌",
        structuralCycle: "混沌",
        generationContext,
        indexEnvironment,
      },
    };
    source.premarketModels = {
      indexCycleRegime: {
        ...indexEnvironment,
        version: INDEX_CYCLE_REGIME_VERSION,
        generationContext,
      },
    };

    const built = buildCycleHistorySnapshot(source, generationContext);
    assert.equal(inspectCycleHistorySnapshot(built, tradingDate).ok, true);
    const persisted = persistCycleHistorySnapshot(source, { generationContext, historyDir, revisionDir });
    assert.equal(persisted.ok, true);
    assert.equal(persisted.required, true);

    const loaded = loadCycleHistorySnapshot(tradingDate, { historyDir });
    assert.ok(loaded);
    assert.equal(loaded.payload.generationId, generationContext.generationId);
    assert.equal(loaded.payload.market.state.structuralCycle, "混沌");
    assert.equal(loaded.payload.executionAuthority, false);
    assert.equal(
      selectPreviousIndexEnvironment(loaded.payload, null, tradingDate).rangeConfirmation.currentQualified,
      true,
    );

    const formalWithStaleRegime = JSON.parse(JSON.stringify(source));
    formalWithStaleRegime.premarketModels.indexCycleRegime.version = 2;
    formalWithStaleRegime.market.state.structuralResolution.version = MARKET_CYCLE_ENGINE_VERSION;
    formalWithStaleRegime.market.state.structuralResolution.engineVersion = MARKET_CYCLE_ENGINE_VERSION;
    assert.equal(
      selectPreviousIndexEnvironment(null, formalWithStaleRegime, tradingDate),
      formalWithStaleRegime.market.state.structuralResolution.indexEnvironment,
    );

    const entirelyStaleFormal = JSON.parse(JSON.stringify(formalWithStaleRegime));
    entirelyStaleFormal.market.state.structuralResolution.version = 2;
    entirelyStaleFormal.market.state.structuralResolution.engineVersion = 2;
    assert.equal(selectPreviousIndexEnvironment(null, entirelyStaleFormal, tradingDate), null);

    const olderSource = JSON.parse(JSON.stringify(source));
    const olderContext = createGenerationContext({ tradingDate, asOf: "2031-03-10T07:05:00.000Z" });
    olderSource.fetchedAt = olderContext.asOf;
    olderSource.asOf = olderContext.asOf;
    olderSource.generationId = olderContext.generationId;
    olderSource.generationContext = olderContext;
    olderSource.market.state.dailyState.generationContext = olderContext;
    olderSource.market.state.emotionBigCycleWindow.generationContext = olderContext;
    olderSource.market.state.structuralResolution.generationContext = olderContext;
    olderSource.market.state.structuralResolution.indexEnvironment.generationContext = olderContext;
    olderSource.premarketModels.indexCycleRegime.generationContext = olderContext;
    const rejectedOlder = persistCycleHistorySnapshot(olderSource, {
      generationContext: olderContext,
      historyDir,
      revisionDir,
    });
    assert.equal(rejectedOlder.ok, false);
    assert.equal(rejectedOlder.reason, "newer-cycle-history-exists");
  } finally {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("five-day emotion window follows the verified prev chain and never skips a missing session", () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "emotion-five-day-window-"));
  const historyDir = path.join(runtimeDir, "history");
  fs.mkdirSync(historyDir, { recursive: true });
  const dates = ["2031-03-03", "2031-03-04", "2031-03-05", "2031-03-06", "2031-03-07", "2031-03-10"];
  const makeDay = (date, previousDate, index) => {
    const asOf = `${date}T07:10:00.000Z`;
    const generationContext = createGenerationContext({ tradingDate: date, asOf });
    return {
      fetchedAt: asOf,
      updatedAt: asOf,
      asOf,
      tradingDate: date,
      generationId: generationContext.generationId,
      generationContext,
      market: {
        snapshot: { tradingDate: date, breadth: 0.64 + index * 0.005 },
        limitStats: {
          ztToday: 58 + index * 4,
          dtToday: index % 2,
          ztHistory: 72 + index * 4,
          dates: { today: date, prev: previousDate, verified: true },
        },
        state: {
          profitEffect: { components: { leadership: { score: 64 + index } } },
        },
      },
    };
  };
  const payloads = dates.map((date, index) => makeDay(date, index ? dates[index - 1] : "2031-02-28", index));
  try {
    payloads.slice(0, -1).forEach((value, index) => {
      fs.writeFileSync(path.join(historyDir, `${dates[index]}.json`), JSON.stringify(value));
    });
    const current = payloads.at(-1);
    const records = loadEmotionBigCycleWindowRecords(current, dates.at(-1), { historyDir });
    assert.deepEqual(records.map((item) => item.date), dates);

    const result = buildEmotionBigCycleWindowForPayload(current, {
      historyDir,
      generationContext: current.generationContext,
      inspectClosingEvidence: () => ({ ok: true }),
    });
    assert.equal(result.key, "main_rise");
    assert.equal(result.status, "available");
    assert.equal(result.observations.length, 5);
    assert.equal(result.observations.every((item) => item.complete), true);
    assert.deepEqual(result.observations.map((item) => item.tradingDate), dates.slice(1));
    assert.equal(result.lineage.every((item) => item.dateAligned && item.complete), true);

    fs.rmSync(path.join(historyDir, "2031-03-06.json"));
    const brokenRecords = loadEmotionBigCycleWindowRecords(current, dates.at(-1), { historyDir });
    assert.deepEqual(brokenRecords.map((item) => item.date), ["2031-03-07", "2031-03-10"]);
    const broken = buildEmotionBigCycleWindowForPayload(current, {
      historyDir,
      generationContext: current.generationContext,
      inspectClosingEvidence: () => ({ ok: true }),
    });
    assert.equal(broken.status, "unavailable");
    assert.notEqual(broken.key, "main_rise");
  } finally {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("server composes canonical models and fails closed when emotion or direction is not confirmed", () => {
  const source = payload();
  const decision = refreshTomorrowDecision(source, { previousPayload: null });

  assert.equal(source.tomorrowDecision, decision);
  assert.equal(decision.tradingDate, "2026-08-07");
  assert.equal(decision.method, "rule_prior");
  assert.equal(decision.calibrated, false);
  assert.equal(decision.scenarios.length, 3);
  assert.equal(decision.scenarios.reduce((sum, row) => sum + row.probability, 0), 100);
  assert.equal(decision.primaryScenarioKey, "range_divergence");
  assert.equal(decision.direction.status, "cash");
  assert.deepEqual(decision.candidates, []);
  assert.equal(decision.contingencies.length, 0);
  assert.equal(decision.permission.status, "blocked");
  assert.equal(decision.premarketGate.blocked, true);
  assert.ok(decision.premarketGate.blockedSteps.includes("emotionStage"));
  assert.equal(decision.coreEmotion.dataQuality.exactPreviousTradingDay, false);
  assert.equal(source.premarketModels.emotionCycle, decision.coreEmotion.emotionCycle);
  assert.equal(source.emotionCycle.bigCycle.source, "emotion_hsd_market_effect_state_machine_v2");
  assert.equal(source.market.state.structuralCycle, source.emotionCycle.bigCycle.label);
  assert.equal(source.market.state.structuralResolution.method, "emotion_cycle_state_machine_projection");
  assert.equal(source.market.state.structuralResolution.source, source.emotionCycle.bigCycle.source);
  assert.equal(source.marketPhaseDetail.structuralCycleAuthority.emotionDriven, true);
  assert.equal(source.marketPhaseDetail.structuralCycleAuthority.indexCanOverride, false);
  assert.equal(source.marketPhaseDetail.generationId, decision.generationId);
  assert.equal(decision.market.phaseDetail, source.marketPhaseDetail);
  assert.equal(decision.market.decisionContext, source.marketPhaseDetail.decisionContext);
  assert.equal(decision.market.decisionContext.generationId, decision.generationId);
  assert.equal(decision.market.decisionContext.guardrails.observationOnly, true);
  assert.equal(decision.market.decisionContext.guardrails.emotionStageAuthority, false);
  assert.equal(decision.market.decisionContext.guardrails.tradePermissionAuthority, false);
  assert.equal(decision.market.decisionContext.speculationPreference.affectsTradePermission, false);
  assert.equal(decision.tomorrowBaseline.probability, null);
  assert.equal(decision.tomorrowBaseline.calibrated, false);
  assert.ok(["conditional_after_support", "blocked_new_entry", "unavailable"].includes(decision.selectionPolicy.mode));
  assert.equal(decision.coreEmotion.items.find((row) => row.code === "300476").selectedCandidate, false);
  assert.equal(decision.forecast.sentimentCycle.coreBasket.total, 3);
  assert.equal(decision.forecast.sentimentCycle.coreBasket.totalIncludingSelectedCandidate, 3);
  assert.equal(decision.forecast.sentimentCycle.coreBasket.selectedCandidateExcludedFromPositiveValidation, false);
  assert.equal(decision.opportunityMap.version, 1);
  assert.equal(decision.opportunityMap.globalGate.status, "closed");
  assert.ok(decision.opportunityMap.directions.every((direction) => direction.tradeCandidates.length === 0));
  assert.equal(decision.opportunityMap.integrity.closedGateStripsTradeCandidates, true);
});

test("one immutable generation context survives delayed theme, model, decision, and evidence builds", async () => {
  const source = payload();
  const generationContext = createGenerationContext({
    tradingDate: "2026-08-07",
    asOf: source.fetchedAt,
  });
  assert.equal(Object.isFrozen(generationContext), true);

  source.themeLibrary = themeLibrarySnapshotFromPayload(source, "delayed-generation-test", {
    forceRebuild: true,
    generationContext,
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  refreshPremarketModels(source, { previousPayload: null, generationContext });
  await new Promise((resolve) => setTimeout(resolve, 25));
  const decision = refreshTomorrowDecision(source, { previousPayload: null, generationContext });

  assert.equal(source.generationContext, generationContext);
  assert.equal(source.themeLibrary.generationContext, generationContext);
  assert.equal(source.premarketModels.generationContext, generationContext);
  assert.equal(decision.generationContext, generationContext);
  assert.equal(source.emotionCoreEvidence.generationContext, generationContext);
  assert.equal(source.themeLibrary.generatedAt, generationContext.asOf);
  assert.equal(source.premarketModels.generatedAt, generationContext.asOf);
  assert.equal(decision.asOf, generationContext.asOf);
  assert.equal(source.emotionCoreEvidence.asOf, generationContext.asOf);
  assert.equal(source.themeLibrary.generationId, generationContext.generationId);
  assert.equal(source.premarketModels.generationId, generationContext.generationId);
  assert.equal(decision.generationId, generationContext.generationId);
  assert.equal(source.emotionCoreEvidence.generationId, generationContext.generationId);
  assert.equal(
    (source.emotionCoreEvidence.reasonCodes || []).some((code) => /theme_library_(generated_at|generation)_mismatch/.test(code)),
    false,
  );
});

function attachStrictEmotionCoreEvidenceFixture(source) {
  const strictCore = source.candidates.find((row) => row.code === "600001");
  const heightRisk = source.candidates.find((row) => row.code === "600002");
  for (const stock of [strictCore, heightRisk]) {
    stock.klineProfile = {
      ...(stock.klineProfile || {}),
      lastSession: {
        tradingDate: "2026-08-07",
        snapshotKind: "closing",
        completed: true,
        verified: true,
        source: "server_integration_fixture",
      },
    };
  }
  strictCore.leadership.cycleIdentity = {
    identityEstablished: false,
    activePrimary: false,
    state: "candidate",
  };
  heightRisk.speculation = { ...(heightRisk.speculation || {}), boards: 4 };
  source.themeLibrary = {
    schemaVersion: 1,
    classifierVersion: THEME_LIBRARY_CLASSIFIER_VERSION,
    sourceMode: "saved-fast-path",
    available: true,
    stale: false,
    tradingDate: "2026-08-07",
    generatedAt: source.fetchedAt,
    generationId: `2026-08-07:${source.fetchedAt}`,
    snapshotKind: "closing",
    themes: [{
      id: "fixture-theme",
      name: "fixture-fine-theme",
      family: "fixture-parent-theme",
      sector: { name: "fixture-sector" },
      cycleLeadership: {
        version: 1,
        settledTradingDate: "2026-08-07",
        cycleInstanceId: "fixture-theme-cycle-1",
        state: "retained",
        frozen: false,
        activeLeaderCode: strictCore.code,
        primary: { code: strictCore.code },
        challenger: { code: heightRisk.code },
        identities: {
          [strictCore.code]: {
            code: strictCore.code,
            cycleInstanceId: "fixture-theme-cycle-1",
            state: "retained",
            identityEstablished: true,
            activePrimary: true,
            confirmedTradingDates: ["2026-08-06", "2026-08-07"],
            evidenceDates: ["2026-08-06", "2026-08-07"],
            validImpactDays: 2,
          },
          [heightRisk.code]: {
            code: heightRisk.code,
            cycleInstanceId: "fixture-theme-cycle-1",
            state: "candidate",
            identityEstablished: false,
            activePrimary: false,
            validImpactDays: 1,
            consecutiveNoImpactDays: 1,
            impactTradingDates: ["2026-08-07"],
          },
        },
      },
      roleEvidenceCards: [
        {
          roleKey: "cycleLeader",
          source: "theme_cycle_leadership",
          tradingDate: "2026-08-07",
          evidence: [{ key: "cycle_identity", source: "theme_cycle_leadership", tradingDate: "2026-08-07" }],
          gaps: [],
          sourceMode: "saved-fast-path",
          classifierVersion: THEME_LIBRARY_CLASSIFIER_VERSION,
          executionEligible: false,
        },
        {
          roleKey: "dailyLeader",
          source: "verified_session_leadership",
          tradingDate: "2026-08-07",
          evidence: [{ key: "daily_leadership", source: "verified_session_leadership", tradingDate: "2026-08-07" }],
          gaps: ["当日龙头待确认"],
          sourceMode: "saved-fast-path",
          classifierVersion: THEME_LIBRARY_CLASSIFIER_VERSION,
          executionEligible: false,
        },
      ],
      roleAuthorityByCode: {
        [strictCore.code]: {
          executionEligible: true,
          cycleLeader: true,
          source: "verified_theme_attribution",
          tradingDate: "2026-08-07",
        },
        [heightRisk.code]: {
          executionEligible: false,
          cycleLeader: false,
          source: "height_risk_observation",
          tradingDate: "2026-08-07",
        },
      },
      dailyHeightStocks: [{ code: heightRisk.code, name: heightRisk.name }],
    }],
  };
}

test("saved theme-library fast path derives generation only from same-trading-day generatedAt", () => {
  const source = payload();
  attachStrictEmotionCoreEvidenceFixture(source);
  delete source.themeLibrary.generationId;
  const derived = themeLibrarySnapshotFromPayload(source, "saved-fast-path");
  assert.equal(derived.generationId, `2026-08-07:${source.fetchedAt}`);

  source.themeLibrary.generationId = "forged-generation";
  const canonicalized = themeLibrarySnapshotFromPayload(source, "saved-fast-path");
  assert.equal(canonicalized.generationId, `2026-08-07:${source.fetchedAt}`);

  source.themeLibrary.generatedAt = "2026-08-06T15:10:00.000Z";
  source.themeLibrary.generationId = `2026-08-07:${source.fetchedAt}`;
  const crossDate = themeLibrarySnapshotFromPayload(source, "saved-fast-path");
  assert.equal(crossDate.generationId, null);
});

test("server attaches same-generation strict-core evidence without changing the existing decision", () => {
  const source = payload();
  attachStrictEmotionCoreEvidenceFixture(source);
  const decision = refreshTomorrowDecision(source, { previousPayload: null });
  const evidence = decision.emotionCoreEvidence;

  assert.ok(evidence);
  assert.equal(source.emotionCoreEvidence, evidence);
  assert.equal(source.tomorrowDecision.emotionCoreEvidence, evidence);
  assert.ok(decision.emotionScenarioInference);
  assert.equal(source.emotionScenarioInference, decision.emotionScenarioInference);
  assert.equal(evidence.emotionScenarioInference, decision.emotionScenarioInference);
  assert.equal(evidence.emotionStagePath.nodes.tomorrow.scenarioInference, decision.emotionScenarioInference);
  assert.equal(decision.emotionScenarioInference.calibrated, false);
  assert.equal(decision.emotionScenarioInference.probability, null);
  assert.equal(decision.emotionScenarioInference.guardrails.executionAuthority, false);
  assert.equal(decision.emotionScenarioInference.guardrails.selectionAuthority, false);
  assert.equal(validateEmotionScenarioInference(decision.emotionScenarioInference, {
    generationId: decision.generationId,
    tradingDate: decision.tradingDate,
    asOf: decision.asOf,
  }), true);
  assert.equal(evidence.generationId, decision.generationId);
  assert.equal(evidence.tradingDate, decision.tradingDate);
  assert.equal(evidence.asOf, decision.asOf);
  assert.deepEqual(evidence.strictEmotionCores.map((row) => row.code), ["600001"]);
  assert.deepEqual(evidence.heightRiskBarometers.map((row) => row.code), ["600002"]);
  assert.equal(evidence.strictEmotionCores[0].qualification.authority, "theme_cycle_leadership");
  assert.equal(evidence.strictEmotionCores[0].classification.heightRiskBarometer, false);
  assert.equal(evidence.heightRiskBarometers[0].votingWeight, 0);
  assert.equal(evidence.coreCandidates.find((row) => row.code === "600002").votingWeight, 0);
  assert.equal(evidence.guardrails.emotionStageAuthority, false);
  assert.equal(evidence.guardrails.executionAuthority, false);
  assert.equal(evidence.decision.market.corePhase, decision.market.corePhase);
  assert.equal(evidence.decision.market.corePhaseKey, decision.market.corePhaseKey);
  assert.deepEqual(
    evidence.decision.market.phaseDetail.emotionStage,
    decision.market.phaseDetail.emotionStage,
  );
  assert.deepEqual(evidence.decision.tomorrowBaseline, decision.tomorrowBaseline);
  assert.equal(evidence.decision.verdict, decision.verdict);
  assert.deepEqual(evidence.decision.permission, decision.permission);
  assert.deepEqual(evidence.decision.scenarios, decision.scenarios);
  assert.deepEqual(evidence.decision.finalEmotionStage, {
    key: decision.market.corePhaseKey,
    label: decision.market.corePhase,
  });
  assert.deepEqual(evidence.decision.tradePermission, decision.permission);
  assert.deepEqual(
    source.emotionCoreEvidence.strictEmotionCores,
    decision.emotionCoreEvidence.strictEmotionCores,
  );
  assert.deepEqual(
    source.emotionCoreEvidence.heightRiskBarometers,
    decision.emotionCoreEvidence.heightRiskBarometers,
  );
  assert.equal(decision.method, "rule_prior");
});

test("server rejects a forged scenario inference that claims probability or execution authority", () => {
  const source = payload();
  attachStrictEmotionCoreEvidenceFixture(source);
  const decision = refreshTomorrowDecision(source, {
    previousPayload: null,
    emotionScenarioInferenceBuilder() {
      return {
        version: 1,
        method: "same_generation_evidence_weighted_emotion_scenario_v1",
        status: "ready",
        calibrated: true,
        probability: 88,
        guardrails: { executionAuthority: true },
        scenarios: [{ key: "repair_or_consensus", modelWeightPct: 100 }],
      };
    },
  });

  assert.equal(decision.emotionScenarioInference.status, "unavailable");
  assert.equal(decision.emotionScenarioInference.calibrated, false);
  assert.equal(decision.emotionScenarioInference.probability, null);
  assert.deepEqual(decision.emotionScenarioInference.scenarios, []);
  assert.equal(decision.emotionScenarioInference.guardrails.executionAuthority, false);
  assert.ok(decision.emotionScenarioInference.dataQuality.reasonCodes.includes("scenario_contract_validation_failed"));
});

test("server passes only a validated raw-generation-bound T-1 contract into the transition builder", () => {
  const currentFile = path.join(__dirname, "data", "history", "2026-08-20.json");
  const previousFile = path.join(__dirname, "data", "history", "2026-08-19.json");
  const rawCurrent = JSON.parse(fs.readFileSync(currentFile, "utf8"));
  const rawPrevious = JSON.parse(fs.readFileSync(previousFile, "utf8"));
  const validStored = replayExactClosingEmotionCoreEvidence(rawPrevious, {
    expectedTradingDate: "2026-08-19",
  });
  assert.ok(validStored);
  const validRiskRow = validStored.heightRiskBarometers[0];
  const previousExpected = {
    generationId: validStored.generationId,
    tradingDate: validStored.tradingDate,
    asOf: validStored.asOf,
  };
  assert.equal(previousRowLineageMatches(validRiskRow, previousExpected), true);
  const mismatchedStateRow = JSON.parse(JSON.stringify(validRiskRow));
  mismatchedStateRow.session.state = "support";
  assert.equal(previousRowLineageMatches(mismatchedStateRow, previousExpected), false);
  const futureSourceRow = JSON.parse(JSON.stringify(validRiskRow));
  futureSourceRow.session.sourceAsOf = "2026-08-20T09:00:00+08:00";
  assert.equal(previousRowLineageMatches(futureSourceRow, previousExpected), false);
  for (const sourceKind of ["nested", "top-level"]) {
    const source = JSON.parse(JSON.stringify(rawCurrent));
    const previous = JSON.parse(JSON.stringify(rawPrevious));
    if (sourceKind === "nested") previous.tomorrowDecision.emotionCoreEvidence = validStored;
    else previous.emotionCoreEvidence = validStored;
    let captured = null;
    refreshTomorrowDecision(source, {
      previousPayload: previous,
      emotionCoreEvidenceBuilder(args) {
        captured = args;
        return buildEmotionCoreEvidenceFromPayload(args);
      },
    });
    assert.ok(captured);
    assert.equal(captured.expectedPreviousTradingDate, "2026-08-19");
    assert.equal(captured.previousEvidence, validStored);
  }

  const source = payload();
  attachStrictEmotionCoreEvidenceFixture(source);
  const t2 = exactPreviousPayload({ canonical: true });
  t2.archiveMeta.tradingDate = "2026-08-05";
  t2.market.limitStats.dates.today = "20260805";
  t2.emotionCoreEvidence = { marker: "must-not-pass-t2" };
  let captured = null;
  refreshTomorrowDecision(source, {
    previousPayload: t2,
    emotionCoreEvidenceBuilder(args) {
      captured = args;
      return buildEmotionCoreEvidenceFromPayload(args);
    },
  });
  assert.ok(captured);
  assert.equal(captured.expectedPreviousTradingDate, "2026-08-06");
  assert.equal(captured.previousEvidence, null);
});

test("legacy 2026-08-19 exact closing T-1 replays to a same-version risk-only contract without reading 2026-08-20 into it", () => {
  const currentFile = path.join(__dirname, "data", "history", "2026-08-20.json");
  const previousFile = path.join(__dirname, "data", "history", "2026-08-19.json");
  const previousBytesBefore = fs.readFileSync(previousFile);
  const current = JSON.parse(fs.readFileSync(currentFile, "utf8"));
  const previous = JSON.parse(previousBytesBefore.toString("utf8"));
  const previousBefore = JSON.stringify(previous);
  const futureSentinel = "FUTURE_2026_08_20_MUST_NOT_ENTER_T1_REPLAY";
  current.candidates[0].name = futureSentinel;
  let capturedPreviousEvidence = null;

  const decision = refreshTomorrowDecision(current, {
    previousPayload: previous,
    allowCanonicalReplay: false,
    emotionCoreEvidenceBuilder(args) {
      capturedPreviousEvidence = args.previousEvidence;
      return buildEmotionCoreEvidenceFromPayload(args);
    },
  });

  assert.ok(capturedPreviousEvidence, "旧 T-1 快照应在内存中补建同版本证据契约");
  assert.equal(capturedPreviousEvidence.status, "ready");
  assert.equal(capturedPreviousEvidence.contractVersion, 2);
  assert.equal(capturedPreviousEvidence.tradingDate, "2026-08-19");
  assert.equal(capturedPreviousEvidence.asOf, previous.fetchedAt);
  assert.equal(
    capturedPreviousEvidence.generationId,
    `2026-08-19:${previous.fetchedAt}`,
  );
  assert.equal(capturedPreviousEvidence.basis.tradingDate, "2026-08-19");
  assert.equal(capturedPreviousEvidence.basis.snapshotKind, "closing");
  assert.deepEqual(capturedPreviousEvidence.strictEmotionCores, []);
  assert.ok(capturedPreviousEvidence.heightRiskBarometers.length > 0);
  assert.ok(capturedPreviousEvidence.heightRiskBarometers.every((row) => row.votingWeight === 0));
  assert.equal(capturedPreviousEvidence.historicalReplay.currentSessionContractRecovered, true);
  assert.equal(capturedPreviousEvidence.historicalReplay.crossDayEmotionStateRecovered, false);
  assert.equal(capturedPreviousEvidence.historicalReplay.previousArchiveReadAllowed, false);
  assert.equal(capturedPreviousEvidence.historicalReplay.futureDataUsed, false);
  assert.equal(JSON.stringify(capturedPreviousEvidence).includes(futureSentinel), false);
  assert.equal(JSON.stringify(previous), previousBefore, "历史重放不得改写 raw archive 对象");
  assert.deepEqual(fs.readFileSync(previousFile), previousBytesBefore, "历史重放不得改写 raw archive 文件字节");

  const stagePath = decision.emotionCoreEvidence.emotionStagePath;
  assert.equal(decision.emotionCoreEvidence.previousEvidenceRecovery.status, "replayed_fail_closed");
  assert.equal(decision.emotionCoreEvidence.previousEvidenceRecovery.futureDataUsed, false);
  assert.equal(decision.emotionCoreEvidence.previousEvidenceRecovery.previousArchiveReadAllowed, false);
  assert.equal(decision.emotionCoreEvidence.previousEvidenceRecovery.strictCoreCount, 0);
  assert.ok(decision.emotionCoreEvidence.previousEvidenceRecovery.riskBarometerCount > 0);
  assert.equal(stagePath.status, "insufficient");
  assert.equal(stagePath.nodes.previous.status, "insufficient");
  assert.equal(stagePath.nodes.previous.key, null);
  assert.ok(stagePath.dataQuality.reasonCodes.includes("previous_strict_core_insufficient"));
  assert.equal(stagePath.dataQuality.reasonCodes.includes("exact_t1_closing_unavailable"), false);
  assert.equal(stagePath.nodes.previous.riskContext.votingWeight, 0);
});

test("historical evidence replay is single-snapshot only and cannot follow a hostile future prev date", () => {
  const currentFile = path.resolve(__dirname, "data", "history", "2026-08-20.json");
  const previousFile = path.resolve(__dirname, "data", "history", "2026-08-19.json");
  const current = JSON.parse(fs.readFileSync(currentFile, "utf8"));
  const previous = JSON.parse(fs.readFileSync(previousFile, "utf8"));
  previous.market.limitStats.dates.prev = "20260820";
  const historyRoot = path.resolve(__dirname, "data", "history") + path.sep;
  const historyReads = [];
  const writes = [];
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = function guardedRead(file, ...args) {
    const resolved = path.resolve(String(file));
    if (resolved.startsWith(historyRoot)) historyReads.push(resolved);
    return originalReadFileSync.call(this, file, ...args);
  };
  const writeMethods = ["writeFileSync", "appendFileSync", "renameSync", "rmSync", "unlinkSync"];
  const originalWrites = new Map();
  writeMethods.forEach((method) => {
    if (typeof fs[method] !== "function") return;
    originalWrites.set(method, fs[method]);
    fs[method] = function blockedWrite(...args) {
      writes.push({ method, target: String(args[0] || "") });
      throw new Error(`historical replay attempted ${method}`);
    };
  });
  let replayed;
  let futureArchive;
  let sameDayArchive;
  try {
    replayed = replayExactClosingEmotionCoreEvidence(previous, {
      expectedTradingDate: "2026-08-19",
    });
    futureArchive = loadPrevArchive("2026-08-19", {
      expectedDate: "2026-08-20",
      requireExact: true,
    });
    sameDayArchive = loadPrevArchive("2026-08-19", {
      expectedDate: "2026-08-19",
      requireExact: true,
    });
  } finally {
    fs.readFileSync = originalReadFileSync;
    originalWrites.forEach((original, method) => { fs[method] = original; });
  }

  assert.ok(replayed);
  assert.deepEqual(historyReads, []);
  assert.deepEqual(writes, []);
  assert.equal(replayed.historicalReplay.previousArchiveReadAllowed, false);
  assert.equal(replayed.historicalReplay.postCloseReportSkipped, true);
  assert.equal(replayed.historicalReplay.futureDataUsed, false);
  assert.equal(replayExactClosingEmotionCoreEvidence(previous), null);
  assert.equal(replayExactClosingEmotionCoreEvidence(previous, {
    expectedTradingDate: "2026-08-18",
  }), null);
  const futureEnvelope = JSON.parse(JSON.stringify(previous));
  futureEnvelope.asOf = "2026-08-20T14:39:57.347Z";
  futureEnvelope.generationContext = {
    id: "2026-08-19:2026-08-20T14:39:57.347Z",
    generationId: "2026-08-19:2026-08-20T14:39:57.347Z",
    tradingDate: "2026-08-19",
    asOf: "2026-08-20T14:39:57.347Z",
  };
  assert.equal(replayExactClosingEmotionCoreEvidence(futureEnvelope, {
    expectedTradingDate: "2026-08-19",
  }), null);
  const futureAsOf = "2026-08-20T14:39:57.347Z";
  const futureGenerationId = `2026-08-19:${futureAsOf}`;
  const fullyFutureEnvelope = JSON.parse(
    JSON.stringify(previous)
      .split(previous.fetchedAt).join(futureAsOf)
      .split(`2026-08-19:${previous.fetchedAt}`).join(futureGenerationId),
  );
  fullyFutureEnvelope.fetchedAt = futureAsOf;
  fullyFutureEnvelope.updatedAt = futureAsOf;
  fullyFutureEnvelope.asOf = futureAsOf;
  fullyFutureEnvelope.generationContext = {
    id: futureGenerationId,
    generationId: futureGenerationId,
    tradingDate: "2026-08-19",
    asOf: futureAsOf,
  };
  assert.equal(strictExactClosingEvidence(fullyFutureEnvelope, "2026-08-19").ok, false);
  assert.ok(
    strictExactClosingEvidence(fullyFutureEnvelope, "2026-08-19").reasons
      .includes("raw_generation_envelope_mismatch"),
  );
  assert.equal(emotionDecisionDateContext(current, fullyFutureEnvelope).exactPreviousTradingDay, false);
  const hostileArchiveEnvelope = JSON.parse(JSON.stringify(previous));
  hostileArchiveEnvelope.archiveMeta.generationContext = {
    id: "2026-08-19:2099-01-01T00:00:00.000Z",
    generationId: "2026-08-19:2099-01-01T00:00:00.000Z",
    tradingDate: "2099-01-01",
    asOf: "2099-01-01T00:00:00.000Z",
  };
  assert.equal(strictExactClosingEvidence(hostileArchiveEnvelope, "2026-08-19").ok, false);
  assert.equal(futureArchive, null);
  assert.equal(sameDayArchive, null);
  assert.equal(emotionDecisionDateContext(previous, current).exactPreviousTradingDay, false);
});

test("stored T-1 evidence must match the raw archive generation exactly or fall back to safe replay", () => {
  const currentFile = path.join(__dirname, "data", "history", "2026-08-20.json");
  const previousFile = path.join(__dirname, "data", "history", "2026-08-19.json");
  const rawCurrent = JSON.parse(fs.readFileSync(currentFile, "utf8"));
  const rawPrevious = JSON.parse(fs.readFileSync(previousFile, "utf8"));
  const validStored = replayExactClosingEmotionCoreEvidence(rawPrevious, {
    expectedTradingDate: "2026-08-19",
  });
  assert.ok(validStored);

  for (const alternateAsOf of ["2026-08-19T13:59:59.000Z", "2026-08-20T14:39:57.347Z"]) {
    const oldAsOf = validStored.asOf;
    const oldGeneration = validStored.generationId;
    const alternateGeneration = `2026-08-19:${alternateAsOf}`;
    const internallyConsistentStored = JSON.parse(
      JSON.stringify(validStored)
        .split(oldGeneration).join(alternateGeneration)
        .split(oldAsOf).join(alternateAsOf),
    );
    const current = JSON.parse(JSON.stringify(rawCurrent));
    const previous = JSON.parse(JSON.stringify(rawPrevious));
    previous.emotionCoreEvidence = internallyConsistentStored;
    if (previous.tomorrowDecision && typeof previous.tomorrowDecision === "object") {
      delete previous.tomorrowDecision.emotionCoreEvidence;
    }
    let capturedPreviousEvidence = null;
    const decision = refreshTomorrowDecision(current, {
      previousPayload: previous,
      allowCanonicalReplay: false,
      emotionCoreEvidenceBuilder(args) {
        capturedPreviousEvidence = args.previousEvidence;
        return buildEmotionCoreEvidenceFromPayload(args);
      },
    });

    assert.ok(capturedPreviousEvidence);
    assert.notEqual(capturedPreviousEvidence, internallyConsistentStored);
    assert.equal(capturedPreviousEvidence.asOf, rawPrevious.fetchedAt);
    assert.equal(
      capturedPreviousEvidence.generationId,
      `2026-08-19:${rawPrevious.fetchedAt}`,
    );
    assert.equal(decision.emotionCoreEvidence.previousEvidenceRecovery.status, "replayed_fail_closed");
    assert.equal(decision.emotionCoreEvidence.previousEvidenceRecovery.futureDataUsed, false);
  }

  const tamperers = [
    (evidence) => { evidence.guardrails.emotionStageAuthority = true; },
    (evidence) => { evidence.dataQuality.failClosed = true; evidence.dataQuality.usable = false; },
    (evidence) => { evidence.historicalReplay.futureDataUsed = true; },
    (evidence) => { evidence.historicalReplay.crossDayEmotionStateRecovered = true; },
    (evidence) => { evidence.historicalReplay.previousArchiveReadAllowed = true; },
    (evidence) => { evidence.historicalReplay.postCloseReportSkipped = false; },
    (evidence) => { evidence.historicalReplay.status = "unscoped_replay"; },
    (evidence) => { evidence.summary.strictCoreCount = 99; },
    (evidence) => { evidence.heightRiskBarometers[0].session.state = "support"; },
    (evidence) => { evidence.heightRiskBarometers[0].session.sourceAsOf = "2026-08-20T09:00:00+08:00"; },
    (evidence) => { evidence.heightRiskBarometers[0].identity.evidenceDates = ["2026-08-20"]; },
  ];
  for (const tamper of tamperers) {
    const current = JSON.parse(JSON.stringify(rawCurrent));
    const previous = JSON.parse(JSON.stringify(rawPrevious));
    const tamperedStored = JSON.parse(JSON.stringify(validStored));
    tamper(tamperedStored);
    previous.emotionCoreEvidence = tamperedStored;
    if (previous.tomorrowDecision && typeof previous.tomorrowDecision === "object") {
      delete previous.tomorrowDecision.emotionCoreEvidence;
    }
    let selectedEvidence = null;
    const decision = refreshTomorrowDecision(current, {
      previousPayload: previous,
      allowCanonicalReplay: false,
      emotionCoreEvidenceBuilder(args) {
        selectedEvidence = args.previousEvidence;
        return buildEmotionCoreEvidenceFromPayload(args);
      },
    });

    assert.ok(selectedEvidence);
    assert.notEqual(selectedEvidence, tamperedStored);
    assert.equal(decision.emotionCoreEvidence.previousEvidenceRecovery.status, "replayed_fail_closed");
    assert.equal(
      decision.emotionCoreEvidence.previousEvidenceRecovery.strictCoreCount,
      selectedEvidence.strictEmotionCores.length,
    );
    assert.equal(
      decision.emotionCoreEvidence.previousEvidenceRecovery.riskBarometerCount,
      selectedEvidence.heightRiskBarometers.length,
    );
  }

  const pollutedCurrent = JSON.parse(JSON.stringify(rawCurrent));
  const pollutedPrevious = JSON.parse(JSON.stringify(rawPrevious));
  pollutedPrevious.emotionCoreEvidence = validStored;
  pollutedPrevious.asOf = "2026-08-20T14:39:57.347Z";
  pollutedPrevious.generationContext = {
    id: "2026-08-19:2026-08-20T14:39:57.347Z",
    generationId: "2026-08-19:2026-08-20T14:39:57.347Z",
    tradingDate: "2026-08-19",
    asOf: "2026-08-20T14:39:57.347Z",
  };
  let pollutedSelectedEvidence = "not-called";
  const pollutedDecision = refreshTomorrowDecision(pollutedCurrent, {
    previousPayload: pollutedPrevious,
    allowCanonicalReplay: false,
    emotionCoreEvidenceBuilder(args) {
      pollutedSelectedEvidence = args.previousEvidence;
      return buildEmotionCoreEvidenceFromPayload(args);
    },
  });
  assert.equal(pollutedSelectedEvidence, null, "未来 envelope 不得从 stored 证据旁路进入 T-1");
  assert.equal(pollutedDecision.emotionCoreEvidence.previousEvidenceRecovery.status, "unavailable");
  assert.ok(
    pollutedDecision.emotionCoreEvidence.emotionStagePath.dataQuality.reasonCodes
      .includes("exact_t1_closing_unavailable"),
  );

  const conflictingCurrent = JSON.parse(JSON.stringify(rawCurrent));
  const conflictingPrevious = JSON.parse(JSON.stringify(rawPrevious));
  const nestedStored = JSON.parse(JSON.stringify(validStored));
  const topLevelStored = JSON.parse(JSON.stringify(validStored));
  const conflictCode = topLevelStored.heightRiskBarometers[0].code;
  const riskRows = [
    ...topLevelStored.heightRiskBarometers,
    ...topLevelStored.themeCycles.flatMap((group) => group.heightRiskBarometers || []),
  ].filter((row) => row.code === conflictCode);
  riskRows.forEach((row) => {
    row.state = "support";
    row.currentState = "support";
    row.session.state = "support";
    const stateEvidence = row.evidence.find((entry) => entry.key === "current_state");
    stateEvidence.value = "support";
  });
  conflictingPrevious.tomorrowDecision.emotionCoreEvidence = nestedStored;
  conflictingPrevious.emotionCoreEvidence = topLevelStored;
  let conflictSelectedEvidence = null;
  const conflictDecision = refreshTomorrowDecision(conflictingCurrent, {
    previousPayload: conflictingPrevious,
    allowCanonicalReplay: false,
    emotionCoreEvidenceBuilder(args) {
      conflictSelectedEvidence = args.previousEvidence;
      return buildEmotionCoreEvidenceFromPayload(args);
    },
  });
  assert.ok(conflictSelectedEvidence);
  assert.notEqual(conflictSelectedEvidence, nestedStored);
  assert.notEqual(conflictSelectedEvidence, topLevelStored);
  assert.equal(conflictDecision.emotionCoreEvidence.previousEvidenceRecovery.status, "replayed_fail_closed");
});

test("strict-core evidence builder failure fails closed only for the additive evidence field", () => {
  const source = payload();
  attachStrictEmotionCoreEvidenceFixture(source);
  const decision = refreshTomorrowDecision(source, {
    previousPayload: null,
    emotionCoreEvidenceBuilder() {
      throw new Error("forced strict-core evidence failure");
    },
  });

  assert.equal(decision.method, "rule_prior");
  assert.notEqual(decision.integrity && decision.integrity.status, "invalid");
  assert.equal(decision.emotionCoreEvidence.status, "unavailable");
  assert.equal(decision.emotionCoreEvidence.generationId, decision.generationId);
  assert.equal(decision.emotionCoreEvidence.dataQuality.failClosed, true);
  assert.ok(decision.emotionCoreEvidence.dataQuality.reasonCodes.includes("emotion_core_evidence_build_failed"));
  assert.equal(decision.emotionCoreEvidence.guardrails.emotionStageAuthority, false);
  assert.equal(decision.emotionCoreEvidence.guardrails.executionAuthority, false);
  assert.equal(source.emotionCoreEvidence, decision.emotionCoreEvidence);
  assert.deepEqual(decision.emotionCoreEvidence.decision.finalEmotionStage, {
    key: decision.market.corePhaseKey,
    label: decision.market.corePhase,
  });
  assert.deepEqual(decision.emotionCoreEvidence.decision.tradePermission, decision.permission);
});

test("server rejects nested risk votes or strict-risk overlap without changing the existing decision", () => {
  const source = payload();
  attachStrictEmotionCoreEvidenceFixture(source);
  const decision = refreshTomorrowDecision(source, {
    previousPayload: null,
    emotionCoreEvidenceBuilder(args) {
      const evidence = buildEmotionCoreEvidenceFromPayload(args);
      const riskCandidate = evidence.coreCandidates.find((row) => row.code === "600002");
      riskCandidate.votingWeight = 1;
      const nested = evidence.themeCycles.find((group) => (
        Array.isArray(group.coreCandidates) && group.coreCandidates.some((row) => row.code === "600002")
      ));
      nested.coreCandidates.find((row) => row.code === "600002").votingWeight = 1;
      evidence.strictEmotionCores[0].classification.heightRiskBarometer = true;
      return evidence;
    },
  });

  assert.equal(decision.method, "rule_prior");
  assert.equal(decision.emotionCoreEvidence.status, "unavailable");
  assert.equal(decision.emotionCoreEvidence.dataQuality.failClosed, true);
  assert.deepEqual(decision.emotionCoreEvidence.strictEmotionCores, []);
  assert.deepEqual(decision.emotionCoreEvidence.heightRiskBarometers, []);
  assert.deepEqual(decision.emotionCoreEvidence.coreCandidates, []);
  assert.equal(decision.emotionCoreEvidence.guardrails.emotionStageAuthority, false);
  assert.equal(decision.emotionCoreEvidence.guardrails.executionAuthority, false);
  assert.deepEqual(decision.emotionCoreEvidence.decision.permission, decision.permission);
  assert.deepEqual(decision.emotionCoreEvidence.decision.scenarios, decision.scenarios);
});

test("server rejects stale metadata on recursive strict and risk rows", () => {
  for (const mutate of [
    (evidence) => {
      const nested = evidence.themeCycles.find((group) => Array.isArray(group && group.strictEmotionCores) && group.strictEmotionCores.length);
      nested.strictEmotionCores[0].asOf = "2026-08-07T07:09:59.000Z";
    },
    (evidence) => {
      const nested = evidence.themeCycles.find((group) => Array.isArray(group && group.heightRiskBarometers) && group.heightRiskBarometers.length);
      nested.heightRiskBarometers[0].generationId = "stale-generation";
    },
  ]) {
    const source = payload();
    attachStrictEmotionCoreEvidenceFixture(source);
    const decision = refreshTomorrowDecision(source, {
      previousPayload: null,
      emotionCoreEvidenceBuilder(args) {
        const evidence = buildEmotionCoreEvidenceFromPayload(args);
        mutate(evidence);
        return evidence;
      },
    });

    assert.equal(decision.emotionCoreEvidence.status, "unavailable");
    assert.equal(decision.emotionCoreEvidence.dataQuality.failClosed, true);
    assert.deepEqual(decision.emotionCoreEvidence.strictEmotionCores, []);
    assert.deepEqual(decision.emotionCoreEvidence.heightRiskBarometers, []);
    assert.deepEqual(decision.emotionCoreEvidence.decision.permission, decision.permission);
  }
});

test("stale theme-library trading date closes only strict-core evidence and never reuses old names", () => {
  const source = payload();
  attachStrictEmotionCoreEvidenceFixture(source);
  source.themeLibrary.tradingDate = "2026-08-06";
  const decision = refreshTomorrowDecision(source, { previousPayload: null });
  const evidence = decision.emotionCoreEvidence;

  assert.equal(decision.method, "rule_prior");
  assert.equal(evidence.status, "unavailable");
  assert.equal(evidence.generationId, decision.generationId);
  assert.deepEqual(evidence.strictEmotionCores, []);
  assert.deepEqual(evidence.heightRiskBarometers, []);
  assert.equal(evidence.dataQuality.failClosed, true);
  assert.ok(evidence.dataQuality.reasonCodes.includes("theme_library_trading_date_mismatch"));
  assert.equal(JSON.stringify(evidence).includes("600001"), false);
  assert.equal(JSON.stringify(evidence).includes("600002"), false);
  assert.equal(source.emotionCoreEvidence, evidence);
  assert.equal(source.tomorrowDecision.emotionCoreEvidence, evidence);
  assert.deepEqual(evidence.decision.permission, decision.permission);
  assert.deepEqual(evidence.decision.scenarios, decision.scenarios);
});

test("旧bestPicks与情景候选不再改写情绪状态，leave-one-out只接受显式排除", () => {
  const source = payload();
  const alternate = core("600003", "非主路径备选", 5);
  source.candidates.push(alternate);
  source.bestPicks.scenarioPlans[2] = {
    key: "weakRepair",
    status: "ready",
    candidate: { code: alternate.code, name: alternate.name, tomorrowEntryQualified: true },
  };
  const decision = refreshTomorrowDecision(source, { previousPayload: null });
  const excluded = decision.coreEmotion.emotionCycle.dataQuality.excludedCandidateCodes;
  assert.equal(excluded.includes("300476"), false);
  assert.equal(excluded.includes("600003"), false);

  const explicit = payload();
  explicit.candidates.push(core("600003", "非主路径备选", 5));
  const explicitDecision = refreshTomorrowDecision(explicit, {
    previousPayload: null,
    selectedCandidateCode: "300476",
    excludedCandidateCodes: ["600003"],
  });
  const explicitExcluded = explicitDecision.coreEmotion.emotionCycle.dataQuality.excludedCandidateCodes;
  assert.ok(explicitExcluded.includes("300476"));
  assert.ok(explicitExcluded.includes("600003"));
});

test("stale prior-generation decision candidates cannot alter the new emotion state", () => {
  const source = payload();
  source.premarketModels = {
    version: 2,
    generationId: "2026-08-07:new-generation",
  };
  source.tomorrowDecision = {
    version: 1,
    generationId: "2026-08-06:stale-generation",
    candidates: [{ code: "600001", name: "旧决策锚点" }],
    contingencies: [],
  };
  const decision = refreshTomorrowDecision(source, { previousPayload: null });
  const excluded = decision.coreEmotion.emotionCycle.dataQuality.excludedCandidateCodes;
  assert.equal(excluded.includes("600001"), false);
  assert.equal(decision.generationId, `2026-08-07:${source.fetchedAt}`);
  assert.equal(source.premarketModels.generationId, decision.generationId);
  assert.equal(source.emotionCycle.generationId, decision.generationId);
  assert.equal(decision.coreEmotion.emotionCycle.generationId, decision.generationId);
  assert.equal(source.emotionCycle.asOf, source.fetchedAt);
});

function closingOnlyCore(code = "600009", name = "closing core") {
  const stock = core(code, name, 9.8);
  stock.leadership.initiative = {
    score: 85,
    proactive: true,
    capacity: true,
    dataQuality: "closing_proxy",
    session: null,
  };
  stock.klineProfile = {
    lastTradingDate: "2026-08-07",
    lastSession: {
      tradingDate: "2026-08-07",
      openChangePct: 1.2,
      currentChangePct: 9.8,
      maxChangePct: 10,
      minChangePct: 1.2,
      closedAtLimit: true,
      oneWord: false,
      limitOpenCount: null,
      resealedAfterOpen: false,
      verified: true,
      completed: true,
      snapshotKind: "closing",
    },
  };
  return stock;
}

function exactPreviousPayload({ canonical = false } = {}) {
  const previous = {
    fetchedAt: "2026-08-06T07:10:00.000Z",
    updatedAt: "2026-08-06T07:10:00.000Z",
    stale: false,
    fetchError: null,
    fetchStatus: { level: "ok" },
    archiveMeta: {
      tradingDate: "2026-08-06",
      snapshotKind: "closing",
    },
    market: {
      limitStats: {
        dates: { today: "20260806", prev: "20260805", verified: true },
      },
    },
    candidates: [],
    tomorrowDecision: {
      generationId: "2026-08-06:2026-08-06T07:10:00.000Z",
      coreEmotion: {
        method: "legacy_rule_derived",
        items: [
          { code: "600001", name: "legacy anchor", stage: "acceleration" },
          { code: "600002", name: "legacy anchor 2", stage: "acceleration" },
        ],
      },
    },
  };
  if (canonical) {
    previous.emotionCycle = {
      version: 2,
      method: "anchor_hcd_state_machine",
      tradingDate: "2026-08-06",
      generationId: previous.tomorrowDecision.generationId,
      asOf: previous.fetchedAt,
      current: { key: "climax", label: "climax", confidence: 80, crossDayVerified: true },
    };
  }
  return previous;
}

test("current-day verified closing session is current evidence, not stale T-1 evidence", () => {
  const source = payload();
  const closingCore = closingOnlyCore();
  source.candidates.push(closingCore);
  const prepared = prepareEmotionBuildInputs(source, exactPreviousPayload({ canonical: true }));
  const preparedCore = prepared.payload.candidates.find((row) => row.code === closingCore.code);

  assert.equal(prepared.currentTradingDate, "2026-08-07");
  assert.equal(prepared.expectedPreviousTradingDate, "2026-08-06");
  assert.equal(preparedCore.leadership.initiative.dataQuality, "收盘路径代理");
  assert.equal(preparedCore.leadership.initiative.session.tradingDate, "2026-08-07");
  assert.equal(preparedCore.leadership.initiative.session.limitOpenCount, null);
  assert.equal(preparedCore.leadership.initiative.session.resealedAfterOpen, null);

  const decision = refreshTomorrowDecision(source, {
    previousPayload: exactPreviousPayload({ canonical: true }),
  });
  const anchor = decision.coreEmotion.emotionCycle.rankedAnchors
    .find((row) => row.code === closingCore.code);
  assert.ok(anchor);
  assert.equal(anchor.priceDiscovery.source, "trusted_current_closing_path_proxy");
  assert.equal(anchor.priceDiscovery.dataQuality, "closing_path_proxy");
  assert.equal(anchor.participation.facts.eventEvidenceEligible, false);
  assert.equal(anchor.participation.facts.limitOpenCount, null);
  assert.equal(anchor.support.breakdown.turnoverReseal.verified, false);
  assert.doesNotMatch(JSON.stringify(anchor), /stale_last_session/);
});

test("legacy T-1 core items cannot masquerade as a canonical cross-day emotion state", () => {
  const source = payload();
  const decision = refreshTomorrowDecision(source, {
    previousPayload: exactPreviousPayload({ canonical: false }),
    allowCanonicalReplay: false,
  });
  const cycle = decision.coreEmotion.emotionCycle;

  assert.equal(cycle.previous.available, false);
  assert.equal(cycle.previous.source, "exact_t1_state_missing");
  assert.equal(cycle.current.crossDayVerified, false);
});

test("exact T-1 canonical frozen emotion is accepted as cross-day state", () => {
  const source = payload();
  const decision = refreshTomorrowDecision(source, {
    previousPayload: exactPreviousPayload({ canonical: true }),
  });
  const cycle = decision.coreEmotion.emotionCycle;

  assert.equal(cycle.previous.available, true);
  assert.equal(cycle.previous.key, "climax");
  assert.equal(cycle.previous.source, "exact_t1_emotion_cycle");
  assert.equal(cycle.previous.tradingDate, "2026-08-06");
  assert.equal(cycle.previous.exactPreviousTradingDay, true);
  assert.equal(cycle.dataQuality.previousStateDateAligned, true);
  assert.equal(cycle.current.crossDayVerified, true);
  assert.equal(cycle.generationId, decision.generationId);
  assert.equal(cycle.asOf, decision.asOf);
  assert.equal(source.unifiedDecisionChain.marketStage.previousEmotionStage.tradingDate, "2026-08-06");
  assert.equal(source.unifiedDecisionChain.marketStage.previousEmotionStage.passed, true);
});

test("partial T-1 is rejected before canonical emotion reuse or replay", () => {
  const source = payload();
  const partialPrevious = exactPreviousPayload({ canonical: true });
  partialPrevious.fetchStatus.level = "partial";
  const prepared = prepareEmotionBuildInputs(source, partialPrevious);

  assert.equal(prepared.exactPreviousTradingDay, false);
  assert.equal(prepared.canonicalPreviousEmotion, null);
  assert.equal(prepared.replayedPreviousEmotion, null);
  const decision = refreshTomorrowDecision(source, { previousPayload: partialPrevious });
  assert.equal(decision.coreEmotion.emotionCycle.previous.available, false);
  assert.equal(decision.coreEmotion.emotionCycle.previous.tradingDate, null);
  assert.equal(decision.coreEmotion.emotionCycle.current.crossDayVerified, false);
  assert.equal(decision.emotionCoreEvidence.previousEvidenceRecovery.status, "unavailable");
  assert.equal(decision.emotionCoreEvidence.previousEvidenceRecovery.futureDataUsed, false);
  assert.ok(
    decision.emotionCoreEvidence.emotionStagePath.dataQuality.reasonCodes
      .includes("exact_t1_closing_unavailable"),
  );
});

test("partial源健康但同日完整缓存证据可继续作为精确T-1收盘状态", () => {
  const source = payload();
  const previous = exactPreviousPayload({ canonical: true });
  previous.fetchStatus = {
    level: "partial",
    operationalLevel: "degraded",
    mode: "degraded_same_day_cache",
    evidenceStatus: "complete",
    items: [{
      name: "K线/均线",
      ok: true,
      degraded: true,
      statusKey: "degraded_same_day_cache",
      eligibleForClosingDecision: true,
      expectedCompletedTradingDate: "2026-08-06",
      sameDayCacheCount: 3,
      unavailableCount: 0,
      cacheTradingDates: { "2026-08-06": 3 },
    }],
  };
  const evidence = strictExactClosingEvidence(previous, "2026-08-06");
  assert.equal(evidence.ok, true);
  assert.equal(evidence.fetchEvidenceQuality.degradedSameDayCache, true);
  const prepared = prepareEmotionBuildInputs(source, previous);
  assert.equal(prepared.exactPreviousTradingDay, true);
  assert.ok(prepared.canonicalPreviousEmotion);
});

function replayRawCore(code, role, rank, boards) {
  const stock = core(code, `raw-${code}`, 10);
  stock.role = role;
  stock.eastRank = rank;
  stock.thsRank = rank + 1;
  stock.amountYi = 60;
  stock.speculation = {
    consecutiveBoards: boards,
    boardsInWindow: boards,
    boardWindowDays: boards,
  };
  stock.leadership.persistentRecognition = true;
  stock.leadership.impactScore = 98;
  stock.leadership.history = { appearances: 5, coreHits: 4, activeHits: 4 };
  stock.leadership.initiative = {
    score: 95,
    proactive: true,
    capacity: role === "中军",
    followerCount: 5,
    dataQuality: "分时验证",
    session: {
      tradingDate: "2026-08-06",
      openChangePct: 5,
      currentChangePct: 10,
      maxChangePct: 10,
      minChangePct: 5,
      limitTouched: true,
      limitOpenCount: 0,
      resealedAfterOpen: false,
      closedAtLimit: true,
    },
  };
  return stock;
}

test("exact raw T-1 archive is replayed canonically without legacy item voting", () => {
  const source = payload();
  const rawT1 = exactPreviousPayload({ canonical: false });
  rawT1.candidates = [
    replayRawCore("600101", "龙头", 1, 6),
    replayRawCore("600102", "先锋", 3, 5),
    replayRawCore("600103", "中军", 8, 2),
    replayRawCore("600104", "补涨", 20, 1),
  ];
  rawT1.bestPicks = { picks: [], scenarioPlans: [] };
  const rawT2 = exactPreviousPayload({ canonical: false });
  rawT2.fetchedAt = "2026-08-05T07:10:00.000Z";
  rawT2.updatedAt = rawT2.fetchedAt;
  rawT2.archiveMeta.tradingDate = "2026-08-05";
  rawT2.market.limitStats.dates = { today: "20260805", prev: "20260804", verified: true };
  rawT2.tomorrowDecision.generationId = `2026-08-05:${rawT2.fetchedAt}`;

  const prepared = prepareEmotionBuildInputs(source, rawT1, {
    previousPreviousPayload: rawT2,
  });
  assert.ok(prepared.replayedPreviousEmotion);
  assert.equal(prepared.replayedPreviousEmotion.source, "exact_t1_canonical_replay");
  assert.equal(prepared.replayedPreviousEmotion.replayed, true);
  assert.equal(prepared.replayedPreviousEmotion.current.key, "climax");
  assert.equal(prepared.replayedPreviousEmotion.current.crossDayVerified, false);
  assert.equal(prepared.previousPayload.emotionCycle, prepared.replayedPreviousEmotion);

  const decision = refreshTomorrowDecision(source, {
    previousPayload: rawT1,
    previousPreviousPayload: rawT2,
  });
  assert.equal(decision.coreEmotion.emotionCycle.previous.available, true);
  assert.equal(decision.coreEmotion.emotionCycle.previous.source, "exact_t1_canonical_replay");
  assert.equal(decision.coreEmotion.emotionCycle.previous.replayed, true);
  assert.equal(decision.coreEmotion.emotionCycle.current.crossDayVerified, true);
});

test("2026-08-21真实收盘快照可递归恢复8月20日T-1权威情绪状态", () => {
  const readHistory = (date) => JSON.parse(fs.readFileSync(
    path.join(__dirname, "data", "history", `${date}.json`),
    "utf8",
  ));
  const source = readHistory("2026-08-21");
  const rawT1 = readHistory("2026-08-20");
  const rawT2 = readHistory("2026-08-19");

  const decision = refreshTomorrowDecision(source, {
    previousPayload: rawT1,
    previousPreviousPayload: rawT2,
  });
  const cycle = decision.coreEmotion.emotionCycle;

  assert.equal(cycle.previous.available, true);
  assert.equal(cycle.previous.tradingDate, "2026-08-20");
  assert.equal(cycle.previous.source, "exact_t1_canonical_replay");
  assert.equal(cycle.previous.authority, "canonical_exact_closing_replay");
  assert.equal(cycle.previous.replayAudit.mode, "exact_closing_recursive_cross_day");
  assert.equal(cycle.previous.label, "中等分歧");
  assert.equal(cycle.dataQuality.exactPreviousTradingDay, true);
  assert.equal(cycle.dataQuality.previousStateAvailable, true);
  assert.equal(cycle.dataQuality.previousStateAuthority, "canonical_exact_closing_replay");
  assert.equal(cycle.current.crossDayVerified, true);
  assert.equal(cycle.current.label, "大分歧·退潮确认");
  assert.equal(cycle.current.divergenceIntensity.key, "large");
  assert.equal(cycle.current.divergenceQuality.key, "non_benign");
  assert.equal(cycle.current.supportState.key, "weak");
});

const STRICT_DECISION_ORDER = [
  "market_stage",
  "authorization",
  "profit_effect",
  "theme",
  "stock_mode",
  "stock_hard_gate",
  "result_stocks",
  "participation_allocation",
];

function frozenCloudDecisionFixture(suffix = "base") {
  const tradingDate = "2026-08-21";
  const asOf = "2026-08-21T15:32:25.611Z";
  const generationId = `${tradingDate}:${asOf}:${suffix}`;
  const generation = { generationId, tradingDate, asOf, aligned: true };
  const replayAudit = {
    mode: "exact_closing_recursive_cross_day",
    targetTradingDate: "2026-08-20",
    failClosedOnUnknownCurrent: true,
  };
  const fiveDayBigCycle = {
    key: "chaos",
    label: "混沌",
    status: "canonical",
    source: "five_day_weighted_emotion_big_cycle_window_v1",
    horizon: "rolling_5_trading_days",
    windowDays: 5,
    window: {
      status: "available",
      observations: ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", tradingDate]
        .map((date) => ({ tradingDate: date, complete: true })),
    },
    reasonCode: "weighted_structure_conflicted",
    reason: "五日窗口确认混沌。",
    evidence: ["五日窗口完整", "最近两日同态"],
    generationContext: { generationId, tradingDate, asOf },
    calibrated: false,
  };
  const previousEmotionStage = {
    status: "passed",
    passed: true,
    available: true,
    key: "support",
    label: "承接",
    tradingDate: "2026-08-20",
    expectedTradingDate: "2026-08-20",
    authority: "canonical_exact_closing_replay",
    source: "exact_t1_emotion_cycle",
    exactCanonical: true,
    exactPreviousTradingDay: true,
    crossDayVerified: true,
    cycleGenerationAligned: true,
    replayed: true,
    replayAudit: { ...replayAudit },
  };
  const fixture = {
    generationId,
    tradingDate,
    asOf,
    marketPhaseDetail: {
      generationId,
      tradingDate,
      asOf,
      decisionContext: {
        version: 3,
        generationId,
        tradingDate,
        asOf,
        bigCycle: fiveDayBigCycle,
        transition: {
          key: "repair_observed",
          label: "修复观察·不改写大周期",
          status: "observed",
          source: "fixture",
        },
        smallCycle: { key: "range", label: "震荡", status: "observed", source: "fixture" },
        emotionStage: { key: "repair", label: "修复观察", status: "observed", observationOnly: true },
      },
    },
    emotionCycle: {
      generationId,
      tradingDate,
      currentTradingDate: tradingDate,
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
        replayAudit: { ...replayAudit },
      },
      current: { crossDayVerified: true },
      dataQuality: {
        exactPreviousTradingDay: true,
        expectedPreviousTradingDate: "2026-08-20",
        previousStateAuthority: "canonical_exact_closing_replay",
      },
    },
    unifiedDecisionChain: {
      version: 3,
      method: "strict_sequential_fail_closed_v1",
      authority: "canonical_stock_decision",
      generation: { ...generation },
      marketStage: {
        status: "passed",
        passed: true,
        marker: `official-${suffix}`,
        bigCycle: { ...fiveDayBigCycle, window: structuredClone(fiveDayBigCycle.window) },
        transition: {
          key: "repair_observed",
          label: "修复观察·不改写大周期",
          status: "observed",
          source: "fixture",
          observationOnly: true,
        },
        smallCycle: { key: "range", label: "震荡", status: "observed", source: "fixture" },
        emotionStage: { key: "repair", label: "修复观察", status: "observed", observationOnly: true },
        previousEmotionStage,
      },
      authorization: {
        status: "blocked",
        passed: false,
        tradePermission: { status: "blocked", allowNew: false, allowAdd: false, reasons: ["冻结授权关闭"] },
        positionPermission: {
          status: "blocked",
          positionCeilingPct: 0,
          initialActivationPct: 0,
          addPermission: false,
        },
      },
      profitEffect: { status: "not_evaluated", passed: false, blockers: ["交易授权关闭"] },
      theme: { status: "not_evaluated", passed: false, blockers: ["交易授权关闭"] },
      stockMode: { status: "not_evaluated", passed: false, blockers: ["交易授权关闭"] },
      stockSelectionContext: { status: "blocked", passed: false, blockers: ["交易授权关闭"] },
      observationCandidates: {
        status: "available",
        observationOnly: true,
        executionAuthority: false,
        maxStocks: 5,
        selectedCount: 0,
        selectedCodes: [],
        stocks: [],
        groups: { reopenCandidates: [], pathRepresentatives: [], hardGateFailed: [] },
        counts: { reopenCandidates: 0, pathRepresentatives: 0, hardGateFailed: 0 },
      },
      result: {
        status: "blocked",
        maxStocks: 5,
        selectedCount: 0,
        selectedCodes: [],
        stocks: [],
        participationAndAllocation: {
          status: "not_applicable",
          positionCeilingPct: 0,
          initialActivationPct: 0,
        },
      },
      integrity: {
        ok: true,
        failClosed: true,
        strictOrder: [...STRICT_DECISION_ORDER],
        maxResultStocks: 5,
        decisionPassed: false,
        selectionContextRequired: false,
        noForcedCandidate: true,
        legacySelectedCanGrantMode: false,
        upstreamCanOnlyTighten: true,
        participationCannotOpenPermission: true,
        observationCandidatesCannotGrantExecution: true,
        postEntryExpectationConditionalOnly: true,
        entryConfirmationRequired: true,
        opportunityDataCompletenessRequired: true,
        fundFlowCompletenessRequired: false,
      },
    },
    bestPicks: {
      selectionAuthority: "unified_decision_chain_v3",
      decisionChainVersion: 3,
      factorEngineAuthority: "unified_stock_factor_engine_v4",
      factorEngineVersion: 4,
      picks: [],
      decisionPool: [],
      scenarioPlans: [],
    },
    localUnifiedProjection: { authority: "untrusted_source_metadata" },
  };
  fixture.unifiedQuantFactors = buildUnifiedQuantFactors(fixture);
  return fixture;
}

function verifiedCloudFixture(payload, sha256) {
  return {
    bytes: Buffer.from(JSON.stringify(payload), "utf8"),
    pointer: {
      generationId: payload.generationId,
      tradingDate: payload.tradingDate,
      sha256,
    },
  };
}

test("有效官方v3决策链只验证并原样保留，本机不重算", () => {
  const raw = frozenCloudDecisionFixture("preserved");
  const originalChain = structuredClone(raw.unifiedDecisionChain);
  const originalFactors = structuredClone(raw.unifiedQuantFactors);
  const originalPicks = structuredClone(raw.bestPicks);
  const sha256 = "a".repeat(64);
  const verified = cloudSnapshotWithUnifiedProjection(verifiedCloudFixture(raw, sha256));
  const payloadWithVerification = JSON.parse(verified.bytes.toString("utf8"));

  assert.deepEqual(payloadWithVerification.unifiedDecisionChain, originalChain);
  assert.deepEqual(payloadWithVerification.unifiedQuantFactors, originalFactors);
  assert.deepEqual(payloadWithVerification.bestPicks, originalPicks);
  assert.equal(payloadWithVerification.cloudDecisionVerification.authority, "cloud_frozen_unified_decision_chain_v3");
  assert.equal(payloadWithVerification.cloudDecisionVerification.sourceSnapshotSha256, sha256);
  assert.equal(payloadWithVerification.cloudDecisionVerification.frozenDecisionPreserved, true);
  assert.equal(payloadWithVerification.cloudDecisionVerification.localDecisionRecomputed, false);
  assert.equal(payloadWithVerification.cloudDecisionVerification.localHistoryUsed, false);
  assert.equal(payloadWithVerification.localUnifiedProjection.status, "not_applied");
  assert.equal(payloadWithVerification.localUnifiedProjection.officialCandidatesPreserved, true);
});

test("旧版或无效云端链可审计地失败关闭，不得本地补链补票", () => {
  const legacy = frozenCloudDecisionFixture("legacy");
  legacy.unifiedDecisionChain.version = 2;
  const sha256 = "b".repeat(64);
  assert.throws(
    () => cloudSnapshotWithUnifiedProjection(verifiedCloudFixture(legacy, sha256)),
    (error) => {
      assert.equal(error.code, "CLOUD_FROZEN_DECISION_INVALID");
      assert.equal(error.audit.status, "rejected");
      assert.equal(error.audit.failClosed, true);
      assert.equal(error.audit.sourceSnapshotSha256, sha256);
      assert.equal(error.audit.localDecisionRecomputed, false);
      assert.equal(error.audit.localHistoryUsed, false);
      assert(error.audit.reasons.some((reason) => /v3/.test(reason)));
      return true;
    },
  );

  const mismatched = frozenCloudDecisionFixture("mismatched");
  const verified = verifiedCloudFixture(mismatched, "c".repeat(64));
  verified.pointer.generationId = "different-generation";
  assert.throws(
    () => cloudSnapshotWithUnifiedProjection(verified),
    (error) => error.code === "CLOUD_FROZEN_DECISION_INVALID"
      && error.audit.reasons.some((reason) => /指针.*代次/.test(reason)),
  );
});

function runFrozenCloudVerificationInRuntime(runtimeDir, inputFile, pointer) {
  const entryFile = path.join(__dirname, "server.js");
  const script = [
    "const fs=require('node:fs');",
    "const entry=process.argv[1];",
    "const input=process.argv[2];",
    "const pointer=JSON.parse(process.argv[3]);",
    "const fn=require(entry)._internals.cloudSnapshotWithUnifiedProjection;",
    "const out=fn({bytes:fs.readFileSync(input),pointer});",
    "process.stdout.write(out.bytes.toString('base64'));",
  ].join("");
  const run = spawnSync(process.execPath, ["-e", script, entryFile, inputFile, JSON.stringify(pointer)], {
    cwd: __dirname,
    env: { ...process.env, A_SHARE_RUNTIME_DIR: runtimeDir },
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(Buffer.from(run.stdout.trim(), "base64").toString("utf8"));
}

test("不同本机T-1档案不能改变同一云端冻结决策", () => {
  const firstRuntime = fs.mkdtempSync(path.join(os.tmpdir(), "a-share-cloud-first-"));
  const secondRuntime = fs.mkdtempSync(path.join(os.tmpdir(), "a-share-cloud-second-"));
  try {
    for (const [runtimeDir, localCycle] of [[firstRuntime, "strengthen"], [secondRuntime, "retreat"]]) {
      const historyDir = path.join(runtimeDir, "data", "history");
      fs.mkdirSync(historyDir, { recursive: true });
      fs.writeFileSync(path.join(historyDir, "2026-08-20.json"), JSON.stringify({
        generationId: `local-only-${localCycle}`,
        emotionCycle: { current: { key: localCycle } },
      }));
    }
    const raw = frozenCloudDecisionFixture("runtime-independent");
    const inputFile = path.join(firstRuntime, "official.json");
    fs.writeFileSync(inputFile, JSON.stringify(raw));
    const pointer = verifiedCloudFixture(raw, "d".repeat(64)).pointer;
    const fromStrengthenArchive = runFrozenCloudVerificationInRuntime(firstRuntime, inputFile, pointer);
    const fromRetreatArchive = runFrozenCloudVerificationInRuntime(secondRuntime, inputFile, pointer);

    assert.deepEqual(fromStrengthenArchive.unifiedDecisionChain, raw.unifiedDecisionChain);
    assert.deepEqual(fromRetreatArchive.unifiedDecisionChain, raw.unifiedDecisionChain);
    assert.deepEqual(fromStrengthenArchive, fromRetreatArchive);
    assert.equal(fromStrengthenArchive.cloudDecisionVerification.localHistoryUsed, false);
  } finally {
    const tempRoot = path.resolve(os.tmpdir());
    for (const runtimeDir of [firstRuntime, secondRuntime]) {
      assert.equal(path.resolve(runtimeDir).startsWith(`${tempRoot}${path.sep}`), true);
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }
  }
});

test("canonical theme outage cannot leak a legacy focus direction into the final decision", () => {
  const source = payload();
  source.themeLibrary = {
    schemaVersion: 1,
    classifierVersion: "theme-library-v2",
    available: false,
    error: "THEME_DOWN",
    themes: [],
  };
  source.bestPicks.focusDirection = "旧AI算力强方向";
  source.topicBoard = { conclusion: "旧题材仍然主线持续" };
  const decision = refreshTomorrowDecision(source, { previousPayload: null });
  assert.ok(decision.premarketGate.blockedSteps.includes("direction"));
  assert.equal(decision.direction.name, null);
  assert.equal(JSON.stringify(decision.direction).includes("旧AI算力强方向"), false);
  assert.equal(JSON.stringify(decision.direction).includes("旧题材仍然主线持续"), false);
});

function assertFailSafeDecision(source, label) {
  let decision;
  assert.doesNotThrow(() => {
    decision = refreshTomorrowDecision(source, { previousPayload: null });
  }, `${label} must not escape the fail-safe boundary`);
  assert.equal(decision.verdict, "wait");
  assert.equal(decision.permission.status, "blocked");
  assert.equal(decision.permission.executionMode, "blocked");
  assert.equal(decision.permission.canActivate, false);
  assert.equal(decision.permission.allowImmediateEntry, false);
  assert.equal(decision.permission.allowAdd, false);
  assert.ok(Array.isArray(decision.permission.reasons));
  assert.ok(decision.permission.reasons.some((reason) => /决策链构建失败/.test(reason)));
  assert.deepEqual(decision.candidates, []);
  assert.deepEqual(decision.contingencies, []);
  assert.equal(decision.integrity.status, "invalid");
  assert.ok(decision.integrity.errors.includes("tomorrow_decision_build_failed"));
  assert.equal(decision.market.cycle, "周期待确认");
  assert.equal(decision.direction.name, null);
  assert.deepEqual(decision.validation, { upgrade: [], hold: [], downgrade: [] });
  assert.equal(decision.opportunityMap.status, "none");
  assert.equal(decision.opportunityMap.globalGate.status, "closed");
  assert.deepEqual(decision.opportunityMap.directions, []);
  assert.equal(source.premarketModels.emotionCycle.available, false);
  assert.equal(source.premarketModels.emotionCycle.method, "unavailable");
  assert.equal(source.premarketModels.integrity.ok, false);
}

test("server decision fail-safe survives hostile top-level and nested getters", async (t) => {
  const cases = [
    {
      name: "top-level market getter",
      mutate(source) {
        Object.defineProperty(source, "market", { get() { throw new Error("market boom"); } });
      },
    },
    {
      name: "marketEmotion.validation getter",
      mutate(source) {
        Object.defineProperty(source.marketEmotion, "validation", { get() { throw new Error("validation boom"); } });
      },
    },
    {
      name: "marketEmotion.cycle getter",
      mutate(source) {
        Object.defineProperty(source.marketEmotion, "cycle", { get() { throw new Error("cycle boom"); } });
      },
    },
    {
      name: "bestPicks.focusDirection getter",
      mutate(source) {
        Object.defineProperty(source.bestPicks, "focusDirection", { get() { throw new Error("focus boom"); } });
      },
    },
    {
      name: "nested validation array getter",
      mutate(source) {
        Object.defineProperty(source.marketEmotion.validation, "upgrade", { get() { throw new Error("upgrade boom"); } });
      },
    },
  ];

  for (const item of cases) {
    await t.test(item.name, () => {
      const source = payload();
      source.premarketModels = {
        version: 2,
        emotionCycle: { version: 1, method: "anchor_hcd_state_machine", current: { key: "climax", label: "旧高潮" } },
      };
      item.mutate(source);
      assertFailSafeDecision(source, item.name);
    });
  }
});

test("hot-stocks fallback migrates v2 execution data without refreshing source time", () => {
  for (const stamp of [false, true]) {
    const source = payload();
    source.fetchedAt = "2026-08-07T07:10:00.000Z";
    source.updatedAt = "2026-08-07T07:11:00.000Z";
    source.asOf = "2026-08-07T07:09:00.000Z";
    source.bestPicks = {
      executionVersion: 2,
      available: true,
      picks: [{ code: "LEGACY999", name: "legacy executable candidate" }],
      scenarioPlans: [{ key: "strengthen", status: "ready", candidate: { code: "LEGACY999" } }],
    };
    source.premarketModels = { version: 1, legacy: true };
    source.tomorrowDecision = {
      version: 1,
      verdict: "buy",
      candidates: [{ code: "LEGACY999" }],
      contingencies: [{ code: "LEGACY999" }],
      permission: { status: "conditional", executionMode: "conditional", canActivate: true },
    };

    const normalized = normalizeHotStocksFallbackResponse(source, "fixture timeout", { stamp });

    assert.equal(normalized.fetchedAt, "2026-08-07T07:10:00.000Z");
    assert.equal(normalized.updatedAt, "2026-08-07T07:11:00.000Z");
    assert.equal(normalized.asOf, "2026-08-07T07:09:00.000Z");
    assert.equal(normalized.bestPicks.executionVersion, 3);
    assert.equal(normalized.premarketModels.version, 2);
    assert.equal(normalized.premarketModels.integrity.legacyFallbackAllowed, false);
    assert.equal(normalized.tomorrowDecision.version, 1);
    assert.equal(normalized.tomorrowDecision.permission.executionMode, "blocked");
    assert.deepEqual(normalized.tomorrowDecision.candidates, []);
    assert.deepEqual(normalized.tomorrowDecision.contingencies, []);
    assert.equal(JSON.stringify(normalized.bestPicks).includes("LEGACY999"), false);
    assert.equal(JSON.stringify(normalized.tomorrowDecision).includes("LEGACY999"), false);
    if (stamp) assert.ok(normalized.servedAt);
  }
});

test("cache normalization forwards same-generation T+1 outcome rows into both decision rebuilds", () => {
  const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const normalizeStart = source.indexOf("function normalizeLeadershipPayload(payload)");
  const normalizeEnd = source.indexOf("\nfunction ", normalizeStart + 1);
  assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart);
  const normalizeSource = source.slice(normalizeStart, normalizeEnd);

  assert.match(
    normalizeSource,
    /const styleOutcomeRowsForNormalization = styleOutcomeRowsOf\(payload\);/,
  );
  assert.match(
    normalizeSource,
    /refreshPremarketModels\(payload, normalizationOptions\);/,
  );
  assert.match(
    normalizeSource,
    /refreshTomorrowDecision\(payload, normalizationOptions\);/,
  );
  assert.doesNotMatch(normalizeSource, /refreshPremarketModels\(payload\);/);
  assert.doesNotMatch(normalizeSource, /refreshTomorrowDecision\(payload\);/);
});

test("hot-stocks fallback migration failure cannot escape or retain v2 candidates", () => {
  const source = payload();
  source.bestPicks = {
    executionVersion: 2,
    available: true,
    picks: [{ code: "LEGACY999", name: "legacy executable candidate" }],
  };
  source.premarketModels = { version: 1, legacy: true };
  source.tomorrowDecision = {
    version: 1,
    verdict: "buy",
    candidates: [{ code: "LEGACY999" }],
    contingencies: [{ code: "LEGACY999" }],
    permission: { status: "conditional", executionMode: "conditional", canActivate: true },
  };
  Object.defineProperty(source, "market", {
    enumerable: true,
    configurable: true,
    get() { throw new Error("forced fallback migration failure"); },
  });

  let normalized;
  assert.doesNotThrow(() => {
    normalized = normalizeHotStocksFallbackResponse(source, "fixture failure", { stamp: false });
  });
  assert.equal(normalized.bestPicks.executionVersion, 3);
  assert.equal(normalized.bestPicks.available, false);
  assert.equal(normalized.bestPicks.tradeDisabled, true);
  assert.deepEqual(normalized.bestPicks.picks, []);
  assert.equal(normalized.premarketModels.version, 2);
  assert.equal(normalized.premarketModels.integrity.ok, false);
  assert.equal(normalized.premarketModels.integrity.legacyFallbackAllowed, false);
  assert.equal(normalized.tomorrowDecision.permission.status, "blocked");
  assert.equal(normalized.tomorrowDecision.permission.executionMode, "blocked");
  assert.deepEqual(normalized.tomorrowDecision.candidates, []);
  assert.deepEqual(normalized.tomorrowDecision.contingencies, []);
  assert.equal(JSON.stringify(normalized.bestPicks).includes("LEGACY999"), false);
  assert.equal(JSON.stringify(normalized.tomorrowDecision).includes("LEGACY999"), false);
});

test("server stamps structural repair transitions with the current generation before phase composition", () => {
  const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  assert.match(source, /const cycleGenerationStamp = \(value\)/);
  assert.match(source, /transition: cycleGenerationStamp\(marketState\.structuralResolution\.transition\)/);
  assert.match(source, /marketState\.dailyState = cycleGenerationStamp\(marketState\.dailyState\)/);
  assert.match(source, /buildMarketPhaseDetail\(\{\s*generationContext,/s);
});
