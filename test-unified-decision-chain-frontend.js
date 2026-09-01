"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "script.js"), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

function extractUntil(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `missing ${name}`);
  assert.notEqual(end, -1, `missing boundary ${nextName}`);
  return source.slice(start, end).trim();
}

const sandbox = {};
vm.runInNewContext(
  `function escapeHtml(value) { return String(value == null ? "" : value); }
function formatDecisionDataTime(value) { return String(value || "待确认"); }
function premarketValueText(value, fallback = "") { if (typeof value === "string") return value; if (value && typeof value === "object") return String(value.summary || value.label || value.text || fallback); return fallback; }
${extractFunction("normalizeBigCycleLabelForDisplay")}
${extractFunction("sanitizeDecisionStockDecoration")}
${extractFunction("canonicalPositionAllocationText")}
${extractFunction("resolveKlineFetchDisplayStatus")}
${extractFunction("resolvePayloadExecutionFreshness")}
${extractFunction("resolveUnifiedDecisionChainProjection")}
${extractFunction("decisionFocusStateLabel")}
${extractFunction("buildDecisionFocusStocks")}
${extractFunction("renderDecisionFocusStocksTable")}
${extractFunction("resolveTodaySpeculationStage")}
${extractFunction("resolveTomorrowDecisionCandidateProjection")}
${extractFunction("cleanDirectDirection")}
${extractFunction("directDecisionTextRows")}
${extractFunction("directPlainGateReason")}
${extractFunction("directPlainReopenCondition")}
${extractFunction("buildDirectDecisionSummary")}
${extractUntil("premarketExecutablePlans", "premarketStepMetrics")}
${extractFunction("sellAdvisorResolveDecisionContext")}
this.api = { resolveUnifiedDecisionChainProjection, canonicalPositionAllocationText, buildDecisionFocusStocks, renderDecisionFocusStocksTable, resolveTodaySpeculationStage, resolveTomorrowDecisionCandidateProjection, buildDirectDecisionSummary, premarketExecutablePlans, sellAdvisorResolveDecisionContext };`,
  sandbox,
);

const STRICT_ORDER = [
  "market_stage",
  "authorization",
  "profit_effect",
  "theme",
  "stock_mode",
  "stock_hard_gate",
  "result_stocks",
  "participation_allocation",
];

const META = {
  generationId: "2026-08-21:closing",
  tradingDate: "2026-08-21",
  asOf: "2026-08-21T15:05:00+08:00",
};

function stock(code, name, relativeWeightPct, initialPortfolioPct, maximumPortfolioPct) {
  return {
    code,
    name,
    theme: "科技",
    stockMode: "趋势核心",
    participationValue: { score: 80 },
    riskAdjustment: { score: 5 },
    riskAdjustedParticipationScore: 75,
    positionAllocation: { relativeWeightPct, initialPortfolioPct, maximumPortfolioPct },
  };
}

function postEntryExpectation(overrides = {}) {
  return {
    version: 1,
    status: "conditional",
    horizon: "entry_t_plus_1",
    premise: "仅在明日确认条件满足后假设参与",
    key: "launch_premium",
    label: "启动溢价 / 题材继续发酵",
    riskLabel: "冲高回落或首板失败",
    entryCondition: "低位先锋与容量同步承接",
    invalidation: "路径失效或负反馈扩散",
    basis: "低位启动",
    pathStage: "fermenting",
    probability: null,
    calibrated: false,
    observationOnly: true,
    executionAuthority: false,
    ...overrides,
  };
}

function blockedPostEntryExpectation(overrides = {}) {
  return postEntryExpectation({
    status: "unavailable",
    premise: "买点确认未通过时不生成持有预期",
    key: null,
    label: "不适用（当前无买点）",
    riskLabel: "不预设上涨",
    ...overrides,
  });
}

function entryConfirmation(overrides = {}) {
  return {
    version: 1,
    status: "waiting_trigger",
    type: "first_board_or_breakout",
    label: "先锋首板 / 容量突破",
    reason: "等待先锋与主动容量同步",
    avoid: "孤立首板或容量不跟不算确认",
    triggerConditions: ["低位先锋与容量同步承接"],
    invalidation: "路径失效或负反馈扩散",
    activated: false,
    observationOnly: true,
    executionAuthority: false,
    ...overrides,
  };
}

function opportunityDataCompleteness() {
  return {
    version: 1,
    status: "complete",
    qualified: true,
    opportunityEligible: true,
    tradingDate: META.tradingDate,
    missingFields: [],
    blockers: [],
    riskNotes: [],
    fundFlowRequired: false,
    evidence: {
      price: { usable: true },
      amount: { usable: true },
      liquidityCapacity: { usable: true },
      marketCap: { usable: true },
      session: { usable: true },
      fundFlow: { required: false },
    },
  };
}

function observationExecutionFeasibility(overrides = {}) {
  return {
    version: 1,
    authority: "unified_execution_feasibility_v1",
    status: "conditional",
    executableNow: false,
    canGrantExecution: false,
    onlyTightens: true,
    ...overrides,
  };
}

function observationExpectation(label = "低位启动路径仍有条件预期", overrides = {}) {
  return {
    status: "qualified",
    label,
    evidence: [label],
    evidenceSources: ["tradingStylePreference"],
    ...overrides,
  };
}

function observationAuthorityFields(path = "lowLaunch") {
  return {
    environmentFit: {
      status: "matched",
      matched: true,
      generationAligned: true,
      marketEnvironmentKnown: true,
      activePathMatched: true,
      themeMatched: true,
      evidence: ["大周期=震荡", `持续赚钱效应路径=${path}`, "当前题材交集=科技"],
    },
    capitalPreference: {
      status: "confirmed_match",
      matched: true,
      bucketKey: "100_300",
      bucketLabel: "100-300亿",
      preferredBucketKeys: ["100_300"],
    },
    profitPreference: {
      status: "matched",
      matched: true,
      activePaths: [path],
      dominantPaths: [path],
      matchedPaths: [path],
      primaryPath: path,
    },
    marketCapFit: {
      status: "confirmed_match",
      gateApplied: true,
      bucketKey: "100_300",
      bucketLabel: "100-300亿",
      preferredBucketKeys: ["100_300"],
    },
  };
}

function payloadWithChain({ executionOpen = true, stocks = null, stage = "震荡" } = {}) {
  const resultStocks = stocks || (executionOpen ? [stock("000001", "链A", 100, 10, 30)] : []);
  const initial = resultStocks.reduce((sum, item) => sum + item.positionAllocation.initialPortfolioPct, 0);
  const maximum = resultStocks.reduce((sum, item) => sum + item.positionAllocation.maximumPortfolioPct, 0);
  const payload = {
    ...META,
    market: { state: { cycle: "混沌", position: "80%" } },
    marketState: { cycle: "混沌", position: "80%" },
    premarketModels: {
      tradingStylePreference: {
        paths: {
          lowLaunch: { stage: "fermenting" },
          boardEmotion: { stage: "active" },
          highTrend: { stage: "continuation" },
        },
      },
    },
    fetchStatus: {
      level: "ok",
      mode: "live_complete",
      evidenceStatus: "complete",
      items: [{
        name: "K线/均线",
        ok: true,
        statusKey: "live_complete",
        requestedCount: 1,
        unavailableCount: 0,
        expectedCompletedTradingDate: META.tradingDate,
      }],
    },
    sources: {
      klineDiagnostics: {
        version: 2,
        statusKey: "live_complete",
        expectedCompletedTradingDate: META.tradingDate,
        requested: 1,
        east: 1,
        tencent: 0,
        cached: 0,
        sameDayCache: 0,
        unavailable: 0,
        failed: 0,
      },
    },
    selected: [{ code: "000003", name: "旧C" }],
    bestPicks: { available: true, picks: [{ code: "000003", name: "旧C" }] },
    tomorrowDecision: {
      version: 3,
      ...META,
      verdict: "conditional",
      direction: { status: "candidate", name: "旧题材" },
      candidates: [{ code: "000003", name: "旧C" }],
      permission: { status: "conditional", canActivate: true },
      integrity: { ok: true },
    },
  };
  payload.unifiedDecisionChain = {
    version: 3,
    method: "strict_sequential_fail_closed_v1",
    authority: "canonical_stock_decision",
    generation: { ...META, aligned: true },
    marketStage: {
      status: "passed",
      passed: true,
      bigCycle: { key: stage === "震荡" ? "range" : "main_rise", label: stage, status: "canonical" },
      transition: { key: "none", label: "无周期切换", status: "not_active" },
      smallCycle: { key: "range_divergence", label: "震荡分歧", status: "observed" },
      emotionStage: { key: "divergence", label: "分歧", status: "observed" },
      previousEmotionStage: { key: "divergence", label: "中等分歧", status: "passed" },
      blockers: [],
    },
    authorization: {
      status: executionOpen ? "allowed" : "blocked",
      passed: executionOpen,
      tradePermission: { status: executionOpen ? "allowed" : "blocked", allowNew: executionOpen, allowAdd: false, reasons: executionOpen ? [] : ["市场交易授权关闭"] },
      tradeValue: { key: executionOpen ? "selective" : "none", label: executionOpen ? "精选参与价值" : "无交易价值", status: executionOpen ? "allowed" : "blocked", numericScore: null, calibrated: false },
      positionPermission: { status: executionOpen ? "allowed" : "blocked", positionCeilingPct: executionOpen ? maximum : 0, initialActivationPct: executionOpen ? initial : 0, addPermission: false },
      reasons: executionOpen ? [] : ["市场交易授权关闭"],
    },
    profitEffect: { status: executionOpen ? "passed" : "not_evaluated", passed: executionOpen },
    theme: { status: executionOpen ? "passed" : "not_evaluated", passed: executionOpen, themes: executionOpen ? ["科技"] : [] },
    stockMode: { status: executionOpen ? "passed" : "not_evaluated", passed: executionOpen },
    stockSelectionContext: { status: "passed", passed: true, authority: "unified_factor_context_v1" },
    observationCandidates: {
      status: "available",
      observationOnly: true,
      executionAuthority: false,
      maxStocks: 5,
      selectedCount: 1,
      selectedCodes: ["000009"],
      stocks: [{
        code: "000009",
        name: "观察九",
        tierKey: "path_representative",
        path: "lowLaunch",
        pathLabel: "低位启动",
        hardGatePassed: true,
        observationReason: "低位启动路径仍有条件预期",
        expectation: observationExpectation(),
        environmentFit: {
          status: "matched",
          matched: true,
          generationAligned: true,
          marketEnvironmentKnown: true,
          activePathMatched: true,
          themeMatched: true,
          evidence: ["大周期=震荡", "持续赚钱效应路径=lowLaunch", "当前题材交集=科技"],
        },
        capitalPreference: {
          status: "confirmed_match",
          matched: true,
          bucketKey: "100_300",
          bucketLabel: "100-300亿",
          preferredBucketKeys: ["100_300"],
        },
        profitPreference: {
          status: "matched",
          matched: true,
          activePaths: ["lowLaunch"],
          dominantPaths: ["lowLaunch"],
          matchedPaths: ["lowLaunch"],
          primaryPath: "lowLaunch",
        },
        marketCapFit: {
          status: "confirmed_match",
          gateApplied: true,
          bucketKey: "100_300",
          bucketLabel: "100-300亿",
          preferredBucketKeys: ["100_300"],
        },
        opportunityDataCompleteness: opportunityDataCompleteness(),
        executionFeasibility: observationExecutionFeasibility(),
        observationOnly: true,
        executable: false,
        executionAuthority: false,
        missingConditions: ["统一交易授权尚未开放"],
        reopenConditions: ["分时领导力重新确认"],
        postEntryNextDayExpectation: postEntryExpectation(),
        entryConfirmation: entryConfirmation(),
      }],
    },
    result: {
      status: executionOpen ? "ready" : "blocked",
      maxStocks: 5,
      selectedCount: resultStocks.length,
      selectedCodes: resultStocks.map((item) => item.code),
      stocks: resultStocks,
      rejected: [],
      blockers: executionOpen ? [] : ["市场交易授权关闭"],
    },
    integrity: { ok: true, failClosed: true, noForcedCandidate: true, observationCandidatesCannotGrantExecution: true, postEntryExpectationConditionalOnly: true, entryConfirmationRequired: true, opportunityDataCompletenessRequired: true, maxResultStocks: 5, strictOrder: STRICT_ORDER },
  };
  return payload;
}

const clone = (value) => JSON.parse(JSON.stringify(value));

function applySameDayKlineDegradation(payload) {
  payload.fetchStatus = {
    level: "ok",
    operationalLevel: "degraded",
    mode: "degraded_same_day_cache",
    evidenceStatus: "complete",
    items: [{
      name: "K线/均线",
      ok: true,
      degraded: true,
      statusKey: "degraded_same_day_cache",
      requestedCount: 1,
      sameDayCacheCount: 1,
      unavailableCount: 0,
      expectedCompletedTradingDate: META.tradingDate,
    }],
  };
  payload.sources.klineDiagnostics = {
    version: 2,
    statusKey: "degraded_same_day_cache",
    expectedCompletedTradingDate: META.tradingDate,
    requested: 1,
    east: 0,
    tencent: 0,
    cached: 1,
    sameDayCache: 1,
    staleCacheRejected: 0,
    unavailable: 0,
    failed: 1,
    cacheTradingDates: { [META.tradingDate]: 1 },
  };
  payload.candidates = [{
    code: "000001",
    name: "链A",
    klineProfileCached: true,
    klineProfile: {
      lastTradingDate: META.tradingDate,
      lastClose: 10,
      lastSession: {
        tradingDate: META.tradingDate,
        source: "tencent-kline",
        close: 10,
        verified: true,
        completed: true,
      },
    },
    klineProfileLineage: {
      mode: "same_day_cache",
      liveFetchFailed: true,
      cacheAccepted: true,
      expectedTradingDate: META.tradingDate,
      tradingDate: META.tradingDate,
    },
  }];
  return payload;
}

test("抓取证据会同时关闭正式机会、结果股和仓位，完整同日缓存仅作黄色降级", () => {
  const validDegraded = applySameDayKlineDegradation(payloadWithChain({ executionOpen: true }));
  const validProjection = sandbox.api.resolveUnifiedDecisionChainProjection(validDegraded);
  assert.equal(validProjection.sourceExecutionFreshness.state, "degraded_same_day_cache");
  assert.equal(validProjection.sourceExecutionFreshness.evidenceUsable, true);
  assert.equal(validProjection.executionOpen, true);
  assert.deepEqual(Array.from(validProjection.stocks, (item) => item.code), ["000001"]);
  assert.equal(validProjection.maximumPortfolioPct, 30);

  const stale = clone(validDegraded);
  stale.sources.klineDiagnostics.statusKey = "stale_cache";
  stale.sources.klineDiagnostics.cacheTradingDates = { "2026-08-20": 1 };
  stale.candidates[0].klineProfile.lastTradingDate = "2026-08-20";
  stale.candidates[0].klineProfile.lastSession.tradingDate = "2026-08-20";
  const staleProjection = sandbox.api.resolveUnifiedDecisionChainProjection(stale);
  assert.equal(staleProjection.contractReady, true);
  assert.equal(staleProjection.executionOpen, false);
  assert.equal(staleProjection.stocks.length, 0);
  assert.equal(staleProjection.maximumPortfolioPct, 0);
  assert.match(staleProjection.blockers.join(" | "), /跨日旧缓存|K线证据不可用/);

  const incomplete = payloadWithChain({ executionOpen: true });
  incomplete.fetchStatus.evidenceStatus = "incomplete";
  const incompleteProjection = sandbox.api.resolveUnifiedDecisionChainProjection(incomplete);
  assert.equal(incompleteProjection.executionOpen, false);
  assert.equal(incompleteProjection.stocks.length, 0);
  assert.equal(incompleteProjection.maximumPortfolioPct, 0);
  assert.match(incompleteProjection.blockers.join(" | "), /evidence|complete/);

  const partialCoverage = clone(validDegraded);
  partialCoverage.candidates[0].klineProfile.lastSession.completed = false;
  const partialProjection = sandbox.api.resolveUnifiedDecisionChainProjection(partialCoverage);
  assert.equal(partialProjection.executionOpen, false);
  assert.equal(partialProjection.stocks.length, 0);
  assert.equal(partialProjection.maximumPortfolioPct, 0);
});

test("合法关闭是业务结论：保留权威大周期，但候选与仓位均为0", () => {
  const payload = payloadWithChain({ executionOpen: false, stage: "震荡" });
  payload.marketEmotion = { light: "green", quality: "旧模型全绿", review: { tomorrow: { positionLimit: "80%" } } };
  const projection = sandbox.api.resolveUnifiedDecisionChainProjection(payload);
  assert.equal(projection.contractReady, true);
  assert.equal(projection.executionOpen, false);
  assert.equal(projection.marketStage.bigCycle.label, "震荡");
  assert.equal(projection.stocks.length, 0);
  assert.deepEqual(Array.from(projection.observationCandidates, (item) => item.code), ["000009"]);
  assert.equal(projection.maximumPortfolioPct, 0);
  assert.equal(sandbox.api.resolveTodaySpeculationStage(payload).label, "震荡");
  const summary = sandbox.api.buildDirectDecisionSummary(payload, {});
  assert.equal(summary.state.bigCycle, "震荡");
  assert.equal(summary.candidates.length, 0);
  assert.match(summary.permission, /^新仓0%/);
});

test("前端拒绝缺少买后次日条件预期契约的旧观察候选", () => {
  const missingStockContract = payloadWithChain({ executionOpen: false });
  delete missingStockContract.unifiedDecisionChain.observationCandidates.stocks[0].postEntryNextDayExpectation;
  const missingStockProjection = sandbox.api.resolveUnifiedDecisionChainProjection(missingStockContract);
  assert.equal(missingStockProjection.contractReady, false);
  assert.deepEqual(Array.from(missingStockProjection.observationCandidates), []);
  assert.match(missingStockProjection.blockers.join("；"), /买后次日预期契约不完整/);

  const missingIntegrityFlag = payloadWithChain({ executionOpen: false });
  delete missingIntegrityFlag.unifiedDecisionChain.integrity.postEntryExpectationConditionalOnly;
  const missingFlagProjection = sandbox.api.resolveUnifiedDecisionChainProjection(missingIntegrityFlag);
  assert.equal(missingFlagProjection.contractReady, false);
  assert.match(missingFlagProjection.blockers.join("；"), /未声明买后次日预期仅为条件路径/);

  const missingEntryConfirmation = payloadWithChain({ executionOpen: false });
  delete missingEntryConfirmation.unifiedDecisionChain.observationCandidates.stocks[0].entryConfirmation;
  const missingEntryProjection = sandbox.api.resolveUnifiedDecisionChainProjection(missingEntryConfirmation);
  assert.equal(missingEntryProjection.contractReady, false);
  assert.match(missingEntryProjection.blockers.join("；"), /买点确认方式契约不完整/);

  const missingEntryFlag = payloadWithChain({ executionOpen: false });
  delete missingEntryFlag.unifiedDecisionChain.integrity.entryConfirmationRequired;
  const missingEntryFlagProjection = sandbox.api.resolveUnifiedDecisionChainProjection(missingEntryFlag);
  assert.equal(missingEntryFlagProjection.contractReady, false);
  assert.match(missingEntryFlagProjection.blockers.join("；"), /未声明机会股必须给出买点确认方式/);
});

test("前端拒绝买点确认方式与硬门槛或路径语义不一致", () => {
  const cases = [
    ["硬门槛失败伪装回封板", (stock) => {
      stock.hardGatePassed = false;
      stock.entryConfirmation = entryConfirmation({ type: "reseal_board", label: "充分换手后的回封板" });
    }],
    ["前板回撤伪装打板", (stock) => {
      stock.tierKey = "limit_up_pullback_repair";
      stock.entryConfirmation = entryConfirmation({ type: "reseal_board", label: "充分换手后的回封板" });
    }],
    ["买点确认夹带执行字段", (stock) => {
      stock.entryConfirmation.buy = { summary: "不应出现" };
    }],
    ["买点确认使用非字符串证据", (stock) => {
      stock.entryConfirmation.reason = {};
      stock.entryConfirmation.triggerConditions = [{}];
    }],
    ["机会关键数据缺失", (stock) => {
      delete stock.opportunityDataCompleteness;
    }],
    ["观察票顶层夹带交易计划", (stock) => {
      stock.tradePlan = { action: "打板", positionPct: 100 };
    }],
    ["观察票顶层用别名夹带交易计划", (stock) => {
      stock.buyPlan = { action: "打板", positionPct: 100 };
    }],
    ["执行可行性反向授予权限", (stock) => {
      stock.executionFeasibility.canGrantExecution = true;
    }],
    ["执行可行性嵌套交易计划", (stock) => {
      stock.executionFeasibility.tradePlan = { action: "打板" };
    }],
    ["删除只收紧执行证据", (stock) => {
      delete stock.executionFeasibility;
    }],
    ["买后次日预期伪装必涨", (stock) => {
      stock.postEntryNextDayExpectation.key = "guaranteed_limit_up";
      stock.postEntryNextDayExpectation.label = "买后次日必涨";
      stock.postEntryNextDayExpectation.riskLabel = "没有风险";
    }],
    ["低位路径伪装连板溢价", (stock) => {
      stock.postEntryNextDayExpectation.key = "board_premium";
      stock.postEntryNextDayExpectation.label = "核心溢价 / 晋级验证";
      stock.postEntryNextDayExpectation.riskLabel = "分歧兑现或高标负反馈";
    }],
    ["买后预期阶段与权威路径阶段错配", (stock) => {
      stock.postEntryNextDayExpectation.pathStage = "tampered_stage";
    }],
    ["看点伪装成保证涨停", (stock) => {
      stock.observationReason = "保证涨停";
      stock.expectation.label = "保证涨停";
      stock.expectation.evidence[0] = "保证涨停";
      stock.expectation.executionAuthority = true;
    }],
    ["阻断标签夹带回封板暗示", (stock) => {
      stock.hardGatePassed = false;
      stock.entryConfirmation = entryConfirmation({
        status: "blocked",
        type: null,
        label: "当前不可确认后充分换手回封板",
      });
      stock.postEntryNextDayExpectation = blockedPostEntryExpectation();
    }],
    ["删除硬门槛布尔值", (stock) => {
      delete stock.hardGatePassed;
    }],
    ["伪造未知观察层级", (stock) => {
      stock.tierKey = "mystery";
    }],
  ];
  cases.forEach(([, mutate]) => {
    const payload = payloadWithChain({ executionOpen: false });
    mutate(payload.unifiedDecisionChain.observationCandidates.stocks[0]);
    const projection = sandbox.api.resolveUnifiedDecisionChainProjection(payload);
    assert.equal(projection.contractReady, false);
    assert.deepEqual(Array.from(projection.observationCandidates), []);
  });
});

test("授权关闭时严格情绪核心与机会观察股必须分栏且全部不可执行", () => {
  const payload = payloadWithChain({ executionOpen: false });
  payload.candidates = [{
    code: "000008",
    name: "严格八",
    mainConcept: "算力",
    hardGate: { pass: true, hardFails: [] },
    leadership: { identity: "主动容量核心" },
  }];
  payload.emotionCoreEvidence = {
    status: "ready",
    ...META,
    strictEmotionCores: [{
      code: "000008",
      name: "严格八",
      rank: "primary",
      currentState: "divergence",
      theme: { label: "算力" },
    }],
  };
  const focus = sandbox.api.buildDecisionFocusStocks(payload);
  assert.equal(focus.status, "observation");
  assert.deepEqual(Array.from(focus.rows, (item) => item.code), ["000009"]);
  assert.deepEqual(Array.from(focus.anchorRows, (item) => item.code), ["000008"]);
  assert.equal(focus.rows.every((item) => item.executable === false), true);
  assert.equal(focus.anchorRows.every((item) => item.executable === false), true);
  assert.equal(focus.anchorRows[0].statusLabel, "市场情绪锚（不参与机会排名）");
  assert.match(focus.anchorRows[0].conclusion, /不参与机会优先级/);
  assert.equal(focus.note, "统一链机会观察 · 匹配偏好 · 非买点 · 买点按路径确认");
  assert.match(focus.anchorNote, /不参与机会排名/);
  const html = sandbox.api.renderDecisionFocusStocksTable(focus);
  assert.match(html, /data-focus-source="unifiedDecisionChain\.observationCandidates"/);
  assert.match(html, /市场情绪锚（不参与机会排名）/);
  assert.match(html, /data-focus-ranking="excluded"/);
});

test("机会观察股空池时页头保持中性且 blocker 只在空态正文出现一次", () => {
  const payload = payloadWithChain({ executionOpen: false });
  const blocker = "观察级硬门槛未通过：题材归属不完整";
  payload.unifiedDecisionChain.observationCandidates = {
    ...payload.unifiedDecisionChain.observationCandidates,
    status: "empty",
    selectedCount: 0,
    selectedCodes: [],
    stocks: [],
    blockers: [blocker],
  };

  const focus = sandbox.api.buildDecisionFocusStocks(payload);
  assert.equal(focus.status, "empty");
  assert.equal(focus.note, blocker);

  const html = sandbox.api.renderDecisionFocusStocksTable(focus);
  assert.match(html, /<small>5只是上限，只展示通过全部观察门槛的股票<\/small>/);
  assert.match(html, new RegExp(`<div class="direct-opportunity-empty">${blocker}<\\/div>`));
  assert.equal(html.split(blocker).length - 1, 1);
});

test("重点股票表拒绝错代严格核心，正式结果股不进入机会观察表", () => {
  const blocked = payloadWithChain({ executionOpen: false });
  blocked.emotionCoreEvidence = {
    status: "ready",
    ...META,
    generationId: "old-generation",
    strictEmotionCores: [{ code: "000008", name: "错代核心" }],
  };
  assert.deepEqual(Array.from(sandbox.api.buildDecisionFocusStocks(blocked).rows, (item) => item.code), ["000009"]);
  assert.deepEqual(Array.from(sandbox.api.buildDecisionFocusStocks(blocked).anchorRows), []);

  const opened = payloadWithChain({ executionOpen: true });
  const focus = sandbox.api.buildDecisionFocusStocks(opened);
  assert.equal(focus.status, "observation");
  assert.deepEqual(Array.from(focus.rows, (item) => item.code), ["000009"]);
  assert.deepEqual(Array.from(focus.anchorRows), []);
  assert.equal(focus.rows[0].executable, false);
  assert.equal(focus.formalCount, 1);
  assert.deepEqual(Array.from(sandbox.api.resolveTomorrowDecisionCandidateProjection(opened).primary, (item) => item.code), ["000001"]);
});

test("机会方向股票只认统一链观察候选，情绪锚保持独立证据身份", () => {
  const payload = payloadWithChain({ executionOpen: false });
  payload.tomorrowDecision.opportunityMap = {
    status: "observe_only",
    directions: [{
      name: "算力",
      emotionAnchors: [{ code: "000008", name: "情绪锚八", identity: "sentiment" }],
      tradeCandidates: [
        { code: "000008", name: "情绪锚八" },
        { code: "000009", name: "观察九" },
        { code: "000010", name: "旧机会十" },
      ],
    }],
  };
  const summary = sandbox.api.buildDirectDecisionSummary(payload, {});
  const direction = summary.opportunity.directions[0];
  assert.deepEqual(Array.from(direction.tradeCandidates, (row) => row.code), ["000009"]);
  assert.deepEqual(Array.from(direction.emotionAnchors, (row) => row.code), ["000008"]);
  assert.equal(direction.tradeCandidates[0].observationSource, "unifiedDecisionChain.observationCandidates");
});

test("机会方向展示不再把情绪锚放进具体看谁语义", () => {
  const renderSource = extractFunction("renderDecisionDirectSummary");
  const focusSource = extractFunction("buildDecisionFocusStocks");
  assert.doesNotMatch(renderSource, /<strong>具体看谁<\/strong>/);
  assert.match(renderSource, /本方向无符合当前资金偏好的机会股/);
  assert.match(renderSource, /市场情绪锚（不参与机会排名）/);
  assert.match(renderSource, /data-focus-kind="emotion-anchor-evidence"/);
  assert.match(renderSource, /data-focus-source="unifiedDecisionChain\.observationCandidates"/);
  assert.doesNotMatch(focusSource, /unified\.stocks\.slice|status:\s*"formal"|statusLabel:\s*"正式结果股"/);
});

test("硬门槛失败观察不得冒充机会股，情绪核心也不占机会名额", () => {
  const payload = payloadWithChain({ executionOpen: false });
  payload.unifiedDecisionChain.observationCandidates.stocks = [{
    code: "000009",
    name: "失败观察",
    tierKey: "hard_gate_failed",
    path: "lowLaunch",
    tierLabel: "C层·硬门槛失败观察",
    hardGatePassed: false,
    observationReason: "低位启动路径仍有条件预期",
    expectation: observationExpectation(),
    ...observationAuthorityFields("lowLaunch"),
    opportunityDataCompleteness: opportunityDataCompleteness(),
    executionFeasibility: observationExecutionFeasibility(),
    observationOnly: true,
    executable: false,
    executionAuthority: false,
    missingConditions: ["个股硬门槛未通过"],
    postEntryNextDayExpectation: blockedPostEntryExpectation(),
    entryConfirmation: entryConfirmation({ status: "blocked", type: null, label: "当前不可确认（硬门槛未过）" }),
  }];
  const focus = sandbox.api.buildDecisionFocusStocks(payload);
  assert.equal(focus.status, "empty");
  assert.deepEqual(Array.from(focus.rows), []);
  assert.match(focus.note, /没有同时具备当前环境、权威题材、持续赚钱效应与资金偏好交集/);
});

test("旧快照把模式待确认误标C层时，硬门槛与领导力双通过仍可恢复为条件观察", () => {
  const payload = payloadWithChain({ executionOpen: false });
  payload.unifiedDecisionChain.observationCandidates.stocks = [{
    code: "000009",
    name: "条件观察九",
    tierKey: "hard_gate_failed",
    path: "lowLaunch",
    tierLabel: "C层·旧兼容标签",
    hardGatePassed: true,
    observationReason: "低位启动路径仍有条件预期",
    expectation: observationExpectation(),
    ...observationAuthorityFields("lowLaunch"),
    opportunityDataCompleteness: opportunityDataCompleteness(),
    executionFeasibility: observationExecutionFeasibility(),
    leadership: { tradeQualified: true },
    observationOnly: true,
    executable: false,
    executionAuthority: false,
    missingConditions: ["股票模式仍待确认", "统一交易授权尚未开放"],
    postEntryNextDayExpectation: postEntryExpectation(),
    entryConfirmation: entryConfirmation(),
  }];
  const focus = sandbox.api.buildDecisionFocusStocks(payload);
  assert.deepEqual(Array.from(focus.rows, (item) => item.code), ["000009"]);
  assert.equal(focus.rows[0].statusLabel, "条件观察·模式待确认");
  assert.match(focus.rows[0].conclusion, /股票模式仍待确认/);
  assert.equal(focus.rows[0].executable, false);
});

test("新机会契约三项匹配时不要求完整硬门槛或交易授权即可展示", () => {
  const payload = payloadWithChain({ executionOpen: false });
  payload.unifiedDecisionChain.observationCandidates.stocks = [{
    code: "000009",
    name: "预期观察九",
    tierKey: "path_representative",
    path: "lowLaunch",
    tierLabel: "机会观察·明日预期",
    hardGatePassed: false,
    opportunityDataCompleteness: opportunityDataCompleteness(),
    executionFeasibility: observationExecutionFeasibility(),
    observationReason: "主线主动核心仍有次日承接预期",
    expectation: observationExpectation("主线主动核心仍有次日承接预期"),
    capitalPreference: { status: "confirmed_match", matched: true, bucketLabel: "100-300亿" },
    profitPreference: { status: "matched", matched: true, primaryPath: "lowLaunch" },
    ...observationAuthorityFields("lowLaunch"),
    pathLabel: "低位启动",
    theme: "科技",
    observationOnly: true,
    executable: false,
    executionAuthority: false,
    missingConditions: ["5日线尚未转升", "统一交易授权尚未开放"],
    cancelConditions: ["题材负反馈扩散"],
    postEntryNextDayExpectation: blockedPostEntryExpectation(),
    entryConfirmation: entryConfirmation({ status: "blocked", type: null, label: "当前不可确认（硬门槛未过）" }),
  }];
  const focus = sandbox.api.buildDecisionFocusStocks(payload);
  assert.deepEqual(Array.from(focus.rows, (item) => item.code), ["000009"]);
  assert.match(focus.rows[0].systemPosition, /低位启动.*资金偏好100-300亿/);
  assert.match(focus.rows[0].conclusion, /明日预期：主线主动核心仍有次日承接预期/);
  assert.match(focus.rows[0].conclusion, /取消：题材负反馈扩散/);
  assert.equal(focus.rows[0].executable, false);
});

test("观察对象即使夹带仓位或买点也会在前端权威投影中被拒绝", () => {
  const payload = payloadWithChain({ executionOpen: false });
  payload.unifiedDecisionChain.observationCandidates.stocks.push({
    code: "000010",
    name: "非法观察",
    tierKey: "path_representative",
    path: "lowLaunch",
    hardGatePassed: true,
    opportunityDataCompleteness: opportunityDataCompleteness(),
    observationOnly: true,
    executable: false,
    executionAuthority: false,
    positionAllocation: { initialPortfolioPct: 10 },
    buy: { plan: "不应出现" },
    postEntryNextDayExpectation: postEntryExpectation(),
    entryConfirmation: entryConfirmation(),
  });
  const projection = sandbox.api.resolveTomorrowDecisionCandidateProjection(payload);
  assert.deepEqual(Array.from(projection.observations, (item) => item.code), []);
  assert.equal(projection.primary.length, 0);
});

test("复盘页在统一授权关闭时覆盖旧1/3试错和明日只做文案", () => {
  const reviewSource = extractUntil("renderReviewConclusion", "cleanDirectDirection");
  assert.match(reviewSource, /const onlyRows = unifiedProjection\.executionOpen/);
  assert.match(reviewSource, /只观察统一链列出的观察候选，不下单、不预设仓位/);
  assert.match(reviewSource, /0%（统一决策链未授权）/);
  assert.match(reviewSource, /统一决策链重新授权前不执行/);
  assert.match(source, /A层重开/);
  assert.match(source, /B层代表/);
  assert.match(source, /C层失败/);
});

test("chain A/B 是唯一成员，legacy C 不能扩容，仓位完全取chain", () => {
  const payload = payloadWithChain({
    stocks: [
      stock("000001", "链A", 60, 6, 18),
      stock("000002", "链B", 40, 4, 12),
    ],
  });
  const projection = sandbox.api.resolveTomorrowDecisionCandidateProjection(payload);
  assert.deepEqual(Array.from(projection.primary, (item) => item.code), ["000001", "000002"]);
  assert.equal(projection.primary.some((item) => item.code === "000003"), false);
  assert.deepEqual(Array.from(projection.primary, (item) => item.positionAllocation.maximumPortfolioPct), [18, 12]);
  const summary = sandbox.api.buildDirectDecisionSummary(payload, {});
  assert.deepEqual(Array.from(summary.candidates, (item) => item.code), ["000001", "000002"]);
  assert.equal(summary.permission, "初始10% · 上限30%");
});

test("legacy 80%仓位在resolver被净化，正式仓位文案只保留chain 10%", () => {
  const payload = payloadWithChain();
  const legacy = {
    code: "000001",
    name: "链A",
    position: "80%",
    stopLossPlan: { position: "80%", mode: "旧模型" },
    plan: { position: "80%", buy: "旧买点" },
    card: { plan: { position: "80%", triggers: ["旧触发"] } },
  };
  payload.selected = [clone(legacy)];
  payload.bestPicks = { decisionPool: [clone(legacy)], picks: [clone(legacy)] };
  payload.tomorrowDecision.candidates = [clone(legacy)];
  Object.assign(payload.unifiedDecisionChain.result.stocks[0], clone(legacy), {
    positionAllocation: { relativeWeightPct: 100, initialPortfolioPct: 10, maximumPortfolioPct: 30 },
  });

  const projection = sandbox.api.resolveUnifiedDecisionChainProjection(payload);
  const result = projection.stocks[0];
  assert.equal(result.position, undefined);
  assert.equal(result.stopLossPlan.position, undefined);
  assert.equal(result.plan.position, undefined);
  assert.equal(result.card.plan.position, undefined);
  assert.equal(result.positionAllocation.initialPortfolioPct, 10);
  assert.equal(sandbox.api.canonicalPositionAllocationText(result.positionAllocation), "初始 10% · 上限 30%");

  const stockCardSource = extractFunction("stockCard");
  const directBuySource = extractUntil("premarketDirectBuyPlans", "premarketDirectBuyPayloadGeneration");
  const postCloseSource = extractUntil("renderPostCloseOpportunity", "renderHotStocks");
  assert.doesNotMatch(stockCardSource, /stopLossPlan\.position|建议仓位/);
  assert.doesNotMatch(directBuySource, /\bplan\.position\b|row\.position\b/);
  assert.doesNotMatch(postCloseSource, /\bplan\.position\b|stock\.position\b/);
});

test("错代、错版本、错authority、错method、错integrity与错仓位全部失败关闭", async (t) => {
  const cases = [
    ["generation", (payload) => { payload.unifiedDecisionChain.generation.generationId = "old"; }],
    ["date", (payload) => { payload.unifiedDecisionChain.generation.tradingDate = "2026-08-20"; }],
    ["asOf", (payload) => { payload.unifiedDecisionChain.generation.asOf = "old"; }],
    ["version string", (payload) => { payload.unifiedDecisionChain.version = "3"; }],
    ["version NaN", (payload) => { payload.unifiedDecisionChain.version = NaN; }],
    ["authority", (payload) => { payload.unifiedDecisionChain.authority = "legacy"; }],
    ["method", (payload) => { payload.unifiedDecisionChain.method = "legacy"; }],
    ["integrity", (payload) => { payload.unifiedDecisionChain.integrity.ok = false; }],
    ["failClosed", (payload) => { payload.unifiedDecisionChain.integrity.failClosed = false; }],
    ["strictOrder", (payload) => { payload.unifiedDecisionChain.integrity.strictOrder = [...STRICT_ORDER].reverse(); }],
    ["allocation", (payload) => { payload.unifiedDecisionChain.result.stocks[0].positionAllocation.maximumPortfolioPct = 29; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const payload = payloadWithChain();
      mutate(payload);
      const projection = sandbox.api.resolveUnifiedDecisionChainProjection(payload);
      assert.equal(projection.contractReady, false);
      assert.equal(projection.executionOpen, false);
      assert.equal(projection.stocks.length, 0);
      assert.equal(projection.maximumPortfolioPct, 0);
      assert.equal(sandbox.api.resolveTodaySpeculationStage(payload).label, "--");
      const summary = sandbox.api.buildDirectDecisionSummary(payload, {});
      assert.equal(summary.candidates.length, 0);
      assert.match(summary.permission, /^新仓0%/);
    });
  }
});

test("盘前交易计划只能保留统一链结果股，关闭时一个也不能执行", () => {
  const step = {
    key: "tradePlan",
    status: "ready",
    canIssueAdvice: true,
    executionMode: "normal",
    plans: [
      { code: "000001", buy: "买", hold: "持", sell: "卖", holdingPeriod: "T+1" },
      { code: "000003", buy: "买", hold: "持", sell: "卖", holdingPeriod: "T+1" },
    ],
  };
  const open = sandbox.api.premarketExecutablePlans(step, payloadWithChain(), {});
  assert.deepEqual(Array.from(open, (item) => item.code), ["000001"]);
  assert.equal(sandbox.api.premarketExecutablePlans(step, payloadWithChain({ executionOpen: false }), {}).length, 0);
});

test("卖出顾问沿用chain周期/仓位/主线；关闭只收紧新增仓，不删除持仓管理上下文", () => {
  const payload = payloadWithChain({ executionOpen: false, stage: "震荡" });
  payload.tomorrowDecision.market = { cycle: "混沌", decisionContext: { speculationPreference: { summary: "旧偏好" } } };
  const context = sandbox.api.sellAdvisorResolveDecisionContext(payload);
  assert.equal(context.bigCycle, "震荡");
  assert.equal(context.position, "0%");
  assert.equal(context.operation, "交易授权关闭");
  assert.equal(context.gateClosed, true);
  assert.equal(context.marketState.cycle, "震荡");
});

test("0股现金日仍写入chain v3历史，旧selected只保留为观察样本", () => {
  const historySandbox = {
    state: { entryHistory: [] },
    persist() {},
    renderEntryHistory() {},
    formatNumber: (value) => String(value),
  };
  vm.runInNewContext(
    `${extractFunction("sanitizeDecisionStockDecoration")}
${extractFunction("resolveUnifiedDecisionChainProjection")}
${extractFunction("recordEntryHistory")}
this.run = recordEntryHistory;`,
    historySandbox,
  );
  const payload = payloadWithChain({ executionOpen: false, stage: "震荡" });
  historySandbox.run(payload);
  assert.equal(historySandbox.state.entryHistory.length, 1);
  const entry = historySandbox.state.entryHistory[0];
  assert.equal(entry.cycle, "震荡");
  assert.equal(entry.operation, "交易授权关闭");
  assert.deepEqual(Array.from(entry.picks), []);
  assert.equal(entry.decisionChain.version, 3);
  assert.equal(entry.decisionChain.authority, "canonical_stock_decision");
  assert.equal(entry.decisionChain.executionOpen, false);
  assert.equal(entry.decisionChain.result.status, "blocked");
  assert.deepEqual(Array.from(entry.legacyObservation.selected, (row) => row.code), ["000003"]);
});

test("预案只持久化chain投影，关闭时周期可见但候选与仓位归零", () => {
  const storage = new Map();
  const textBySelector = new Map();
  const cycleNode = { textContent: "", style: {} };
  const preplanSandbox = {
    localStorage: {
      setItem(key, value) { storage.set(key, String(value)); },
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    },
    document: { querySelector: (selector) => selector === "#ppCycle" ? cycleNode : null },
    CYCLE_COLORS: { 震荡: "#123456" },
    fillPpDatalist() {},
    setText(selector, value) { textBySelector.set(selector, String(value)); },
    safeParseJSON(value, fallback) { try { return JSON.parse(value); } catch (_) { return fallback; } },
    formatTime: (value) => String(value || "--"),
  };
  vm.runInNewContext(
    `const PP_STATE_KEY = "pp-state"; const PP_CANDIDATES_KEY = "pp-candidates";
${extractFunction("sanitizeDecisionStockDecoration")}
${extractFunction("resolveUnifiedDecisionChainProjection")}
${extractFunction("persistPreplanContext")}
${extractFunction("renderPpCycleBar")}
this.persistContext = persistPreplanContext; this.renderBar = renderPpCycleBar;`,
    preplanSandbox,
  );
  const payload = payloadWithChain({ executionOpen: false, stage: "震荡" });
  preplanSandbox.persistContext(payload);
  const saved = JSON.parse(storage.get("pp-state"));
  assert.equal(saved.schemaVersion, 3);
  assert.equal(saved.authority, "unified_decision_chain_v3");
  assert.equal(saved.executionOpen, false);
  assert.deepEqual(saved.result.selectedCodes, []);
  assert.deepEqual(JSON.parse(storage.get("pp-candidates")), {});
  preplanSandbox.renderBar();
  assert.equal(cycleNode.textContent, "震荡");
  assert.equal(textBySelector.get("#ppMinScore"), "0只");
  assert.equal(textBySelector.get("#ppPosition"), "0%");
});

test("生产正式成员源码不再从bestPicks/tomorrowDecision/selected兜底扩容", () => {
  const projectionSource = extractFunction("resolveTomorrowDecisionCandidateProjection");
  const directSource = extractFunction("buildDirectDecisionSummary");
  const selectionSource = extractFunction("renderSelectionPools");
  assert.match(projectionSource, /const primary = unified\.stocks\.map/);
  assert.doesNotMatch(projectionSource, /tomorrowDecision\.candidates\.map|bestPicks\.picks\.map|source\.selected\.map/);
  assert.doesNotMatch(directSource, /bestPicks\.picks\.filter|tomorrowDecision\.candidates\.filter|payload\.selected\.filter/);
  assert.match(selectionSource, /const all = unifiedProjection\.executionOpen \? unifiedProjection\.stocks : \[\]/);
});
