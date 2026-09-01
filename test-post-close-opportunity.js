"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPostCloseOpportunityReport, _internals } = require("./post-close-opportunity");
const { buildOpportunityObservationCards } = _internals;

function plan(code = "000636", name = "风华高科") {
  return {
    code,
    name,
    buy: "回踩后重新走强才买",
    hold: "板块与核心同步走强则持有",
    sell: "题材回流失败或核心转弱则卖出",
    holdingPeriod: "1-3个交易日",
    position: "10%-20%",
    triggers: ["板块回流且核心股重新走强"],
    cancelConditions: ["题材核心集体转弱"],
  };
}

function flowFixture(overrides = {}) {
  const themes = overrides.themes || [
    { id: "AI算力", name: "MLCC", family: "AI算力", isMainLine: true },
    { id: "医药", name: "医药", family: "医药" },
  ];
  const base = {
    version: 1,
    sourceUpdatedAt: "2026-08-11T15:10:00.000Z",
    status: "ready",
    blockedAt: null,
    indexOpportunity: {
      status: "ready",
      permission: "allowed",
      cycle: "主升周期",
      mediumTerm: { cycleKey: "main_rise" },
      shortTerm: { key: "main_rise" },
      positionLimit: "30%-50%",
      blockedBy: [],
    },
    tradingPreference: {
      status: "ready",
      preference: "主线核心回流",
      conclusion: "资金偏好主线核心回流",
      directionPermission: {
        executionStatus: "conditional",
        preferredMethods: ["回踩低吸"],
      },
      blockedBy: [],
    },
    emotionStage: {
      status: "ready",
      permission: "conditional_after_support",
      blockedBy: [],
    },
    direction: {
      status: "ready",
      executionBlocked: false,
      items: themes,
      candidatePool: { mainThemeIds: themes.map((theme) => theme.id) },
      confirmation: {
        status: "confirmed",
        eligibleThemeIds: ["AI算力"],
        eligibleStockCodes: ["000636"],
        blockedBy: [],
      },
      allowedStockCodes: ["000636"],
      blockedBy: [],
    },
    stocks: {
      status: "ready",
      candidates: [{ code: "000636", name: "风华高科", qualified: true }],
      blockedBy: [],
    },
    tradePlan: {
      status: "ready",
      canIssueAdvice: true,
      executionMode: "conditional_after_support",
      plans: [plan()],
      blockedBy: [],
    },
  };
  return {
    ...base,
    ...overrides,
    indexOpportunity: { ...base.indexOpportunity, ...(overrides.indexOpportunity || {}) },
    tradingPreference: { ...base.tradingPreference, ...(overrides.tradingPreference || {}) },
    emotionStage: { ...base.emotionStage, ...(overrides.emotionStage || {}) },
    direction: { ...base.direction, ...(overrides.direction || {}) },
    stocks: { ...base.stocks, ...(overrides.stocks || {}) },
    tradePlan: { ...base.tradePlan, ...(overrides.tradePlan || {}) },
  };
}

function mapDirection(id, name, overrides = {}) {
  return {
    id,
    name,
    family: id,
    rank: 1,
    state: "watch_only",
    threadRole: "parallel",
    evidence: {
      isMainLine: false,
      resonance: true,
      sustained: true,
      reasonCodes: ["direction_resonance"],
      sourceThemeIds: [id],
      sourceThemeNames: [name],
    },
    emotionAnchors: [],
    tradeCandidates: [],
    ...overrides,
  };
}

function opportunityMapFixture(overrides = {}) {
  const ai = mapDirection("AI算力", "MLCC", {
    rank: 1,
    state: "tradeable",
    threadRole: "main",
    evidence: {
      isMainLine: true,
      resonance: true,
      sustained: true,
      reasonCodes: ["direction_mainline", "direction_resonance"],
      sourceThemeIds: ["AI算力"],
      sourceThemeNames: ["MLCC"],
    },
    emotionAnchors: [
      { code: "000636", name: "风华高科", anchorType: "capacity", identity: "主线容量核心", usage: "anchor_and_trade" },
      { code: "000001", name: "科技先锋", anchorType: "pioneer", identity: "先锋", usage: "anchor_only" },
      { code: "000002", name: "科技跟随", anchorType: "follow", identity: "跟随", usage: "anchor_only" },
    ],
    tradeCandidates: [{
      code: "000636",
      name: "风华高科",
      role: "中军",
      identity: "主线容量核心",
      active: true,
      tradeQualified: true,
      activation: "primary_path",
    }],
  });
  return {
    version: 1,
    tradingDate: "2026-08-11",
    status: "tradeable",
    globalGate: {
      status: "conditional",
      canActivate: true,
      canTradeCandidates: true,
      reasonCodes: [],
      reasons: ["仅生成条件计划，盘中验证后才能激活"],
    },
    directions: [ai, mapDirection("医药", "医药", { rank: 2 })],
    rejectedDirections: [],
    integrity: { ok: true },
    ...overrides,
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function propertyNames(value, result = []) {
  if (!value || typeof value !== "object") return result;
  Object.keys(value).forEach((key) => {
    result.push(key);
    propertyNames(value[key], result);
  });
  return result;
}

test("projects a transparent post-close report without inventing probabilities", () => {
  const report = buildPostCloseOpportunityReport({
    premarketFlow: flowFixture(),
    opportunityMap: opportunityMapFixture(),
  });

  assert.equal(report.method, "rule_based");
  assert.equal(report.calibrated, false);
  assert.equal(report.generationId, null);
  assert.equal(report.asOf, "2026-08-11T15:10:00.000Z");
  assert.equal(report.status, "opportunities");
  assert.equal(report.dataStatus.status, "ready");
  assert.equal(report.marketPermission.status, "conditional");
  assert.equal(report.sources.premarketFlow, "provided");
  assert.equal(report.sources.opportunityMap, "provided");
  assert.equal(report.sources.opportunityCards, "premarketFlow.tradePlan.plans");
  assert.deepEqual(report.candidateThemes.map((theme) => theme.id), ["医药"]);
  assert.deepEqual(report.confirmedThemes.map((theme) => theme.id), ["AI算力"]);
  assert.equal(report.candidateThemes === report.confirmedThemes, false);
  assert.deepEqual(
    report.candidateThemes.filter((candidate) => (
      report.confirmedThemes.some((confirmed) => confirmed.id === candidate.id)
    )),
    [],
  );
  assert.equal(report.opportunityCards.length, 1);
  assert.equal(report.opportunityCards[0].code, "000636");
  assert.equal(report.opportunityCards[0].role, "中军");
  assert.equal(report.opportunityCards[0].identity, "主线容量核心");
  assert.equal(report.opportunityCards[0].setupType, "mainline_core_reflow");
  assert.deepEqual(report.opportunityCards[0].setupChecks, {
    cycle: true,
    preference: true,
    theme: true,
    core: true,
    plan: true,
  });
  assert.equal(propertyNames(report).some((key) => /probability|chance|odds|winRate/i.test(key)), false);
});

test("caps the report at three themes and two cores per theme", () => {
  const directions = [
    mapDirection("A", "A", { rank: 1, emotionAnchors: [{ code: "A1" }, { code: "A2" }, { code: "A3" }] }),
    mapDirection("B", "B", { rank: 2, emotionAnchors: [{ code: "B1" }, { code: "B2" }, { code: "B3" }] }),
    mapDirection("C", "C", { rank: 3, emotionAnchors: [{ code: "C1" }, { code: "C2" }, { code: "C3" }] }),
    mapDirection("D", "D", { rank: 4, emotionAnchors: [{ code: "D1" }, { code: "D2" }, { code: "D3" }] }),
  ];
  const flow = flowFixture({
    themes: directions.map((row) => ({ id: row.id, name: row.name, family: row.family })),
    direction: {
      items: directions.map((row) => ({ id: row.id, name: row.name, family: row.family })),
      candidatePool: { mainThemeIds: directions.map((row) => row.id) },
      confirmation: { status: "confirmed", eligibleThemeIds: ["A", "B"], eligibleStockCodes: [] },
      allowedStockCodes: [],
    },
    tradePlan: { plans: [], canIssueAdvice: false, status: "unknown" },
  });

  const report = buildPostCloseOpportunityReport({
    premarketFlow: flow,
    opportunityMap: opportunityMapFixture({ directions, status: "watch_only" }),
  });

  assert.deepEqual(report.candidateThemes.map((theme) => theme.id), ["C"]);
  assert.deepEqual(report.confirmedThemes.map((theme) => theme.id), ["A", "B"]);
  assert.ok(report.candidateThemes.every((theme) => theme.cores.length <= 2));
  assert.ok(report.confirmedThemes.every((theme) => theme.cores.length <= 2));
});

test("caps executable opportunity cards at five cores globally and two per theme", () => {
  const directions = ["A", "B", "C"].map((id, index) => mapDirection(id, id, {
    rank: index + 1,
    state: "tradeable",
    evidence: { isMainLine: true, reasonCodes: ["direction_mainline"] },
    tradeCandidates: [1, 2].map((number) => ({
      code: `${id}${number}`,
      name: `${id}${number}`,
      active: true,
      tradeQualified: true,
    })),
  }));
  const codes = directions.flatMap((direction) => direction.tradeCandidates.map((candidate) => candidate.code));
  const flow = flowFixture({
    themes: directions.map((direction) => ({ id: direction.id, name: direction.name, family: direction.family })),
    direction: {
      items: directions.map((direction) => ({ id: direction.id, name: direction.name, family: direction.family })),
      candidatePool: { mainThemeIds: directions.map((direction) => direction.id) },
      confirmation: {
        status: "confirmed",
        eligibleThemeIds: directions.map((direction) => direction.id),
        eligibleStockCodes: codes,
        blockedBy: [],
      },
      allowedStockCodes: codes,
    },
    stocks: { candidates: codes.map((code) => ({ code, name: code, qualified: true })) },
    tradePlan: { plans: codes.map((code) => plan(code, code)) },
  });
  const report = buildPostCloseOpportunityReport({
    premarketFlow: flow,
    opportunityMap: opportunityMapFixture({ directions }),
  });

  assert.equal(report.limits.maxCoreStocks, 5);
  assert.equal(report.opportunityCards.length, 5);
  assert.ok(["A", "B", "C"].every((themeId) => (
    report.opportunityCards.filter((card) => card.themeId === themeId).length <= 2
  )));
});

test("opportunity cards come only from final executable plans", () => {
  const map = opportunityMapFixture();
  const withoutPlan = buildPostCloseOpportunityReport({
    premarketFlow: flowFixture({ tradePlan: { status: "unknown", canIssueAdvice: false, plans: [] } }),
    opportunityMap: map,
  });
  assert.deepEqual(withoutPlan.opportunityCards, []);
  assert.equal(withoutPlan.status, "no_opportunity");
  assert.ok(withoutPlan.noOpportunity.reasons.some((reason) => reason.includes("完整的买入、持有和卖出计划")));

  const incompletePlan = buildPostCloseOpportunityReport({
    premarketFlow: flowFixture({
      tradePlan: { plans: [{ ...plan(), buy: {} }] },
    }),
    opportunityMap: map,
  });
  assert.deepEqual(incompletePlan.opportunityCards, [], "空计划对象不能冒充完整买点");

  const blockedLeg = buildPostCloseOpportunityReport({
    premarketFlow: flowFixture({
      tradePlan: { plans: [{ ...plan(), buy: { status: "blocked" } }] },
    }),
    opportunityMap: map,
  });
  assert.deepEqual(blockedLeg.opportunityCards, [], "被阻断的计划腿不能冒充完整买点");

  const blockedPlanRow = buildPostCloseOpportunityReport({
    premarketFlow: flowFixture({
      tradePlan: { plans: [{ ...plan(), status: "blocked" }] },
    }),
    opportunityMap: map,
  });
  assert.deepEqual(blockedPlanRow.opportunityCards, [], "被阻断的计划行不能进入机会卡");

  const inactiveMap = opportunityMapFixture({
    directions: [mapDirection("AI算力", "MLCC", {
      state: "watch_only",
      evidence: { isMainLine: true, reasonCodes: ["direction_mainline"] },
      emotionAnchors: [{ code: "000636", name: "风华高科" }],
      tradeCandidates: [{ code: "000636", name: "风华高科", active: false, tradeQualified: true }],
    })],
    status: "watch_only",
  });
  const withoutFinalCandidate = buildPostCloseOpportunityReport({
    premarketFlow: flowFixture(),
    opportunityMap: inactiveMap,
  });
  assert.deepEqual(withoutFinalCandidate.opportunityCards, []);
});

test("keeps candidate and confirmed themes separate when confirmation is blocked", () => {
  const flow = flowFixture({
    status: "blocked",
    blockedAt: "tradingPreference",
    tradingPreference: { status: "blocked", blockedBy: ["tradingPreference"] },
    direction: {
      executionBlocked: true,
      confirmation: { status: "blocked", eligibleThemeIds: [], eligibleStockCodes: [], blockedBy: ["tradingPreference"] },
      allowedStockCodes: [],
    },
    tradePlan: { status: "blocked", canIssueAdvice: false, plans: [], blockedBy: ["tradingPreference"] },
  });
  const report = buildPostCloseOpportunityReport({ premarketFlow: flow, opportunityMap: opportunityMapFixture() });

  assert.ok(report.candidateThemes.length > 0);
  assert.deepEqual(report.confirmedThemes, []);
  assert.deepEqual(report.opportunityCards, []);
  assert.equal(report.marketPermission.status, "blocked");
  assert.ok(report.noOpportunity.reasons.some((reason) => reason.includes("资金偏好还没有落实到合格股票")));
  assert.equal(report.noOpportunity.reasons.some((reason) => reason.includes("上游交易条件")), false);
});

test("no-opportunity reasons name the exact blocked step in plain Chinese", () => {
  const cases = [
    ["indexOpportunity", "指数条件还没通过", { indexOpportunity: { status: "blocked", permission: "blocked" } }],
    ["tradingPreference", "资金偏好还没有落实到合格股票", { tradingPreference: { status: "blocked" } }],
    ["emotionStage", "市场情绪还没确认", { emotionStage: { status: "blocked" } }],
    ["direction", "题材方向还没确认", {
      direction: {
        status: "blocked",
        executionBlocked: true,
        confirmation: { status: "blocked", eligibleThemeIds: [], eligibleStockCodes: [], blockedBy: ["direction"] },
      },
    }],
    ["stocks", "核心股还没通过筛选", { stocks: { status: "blocked" } }],
  ];

  cases.forEach(([step, expected, nested]) => {
    const report = buildPostCloseOpportunityReport({
      premarketFlow: flowFixture({ status: "blocked", blockedAt: step, ...nested }),
      opportunityMap: opportunityMapFixture(),
    });
    assert.ok(report.marketPermission.blockedSteps.includes(step));
    assert.ok(report.noOpportunity.reasons.some((reason) => reason.includes(expected)), step);
    assert.ok(report.noOpportunity.reasons.length >= 1 && report.noOpportunity.reasons.length <= 3);
  });
});

test("theme attribution conflicts fail closed", () => {
  const conflictDirection = mapDirection("AI算力", "MLCC", {
    rank: 1,
    state: "tradeable",
    attribution: { status: "conflict", reasons: ["MLCC与CPO归属冲突"] },
    evidence: { isMainLine: true, reasonCodes: ["direction_mainline", "theme_attribution_conflict"] },
    emotionAnchors: [{ code: "000636", name: "风华高科" }],
    tradeCandidates: [{ code: "000636", name: "风华高科", active: true, tradeQualified: true }],
  });
  const report = buildPostCloseOpportunityReport({
    premarketFlow: flowFixture(),
    opportunityMap: opportunityMapFixture({ directions: [conflictDirection] }),
  });

  assert.equal(report.candidateThemes[0].attributionStatus, "conflict");
  assert.deepEqual(report.confirmedThemes, []);
  assert.deepEqual(report.opportunityCards, []);
  assert.ok(report.noOpportunity.reasons.some((reason) => reason.includes("题材归属还有冲突")));
});

test("unflagged plan or payload primary-theme mismatches also fail closed", () => {
  const planMismatch = buildPostCloseOpportunityReport({
    premarketFlow: flowFixture({
      tradePlan: {
        plans: [{ ...plan(), mainConcept: "医药", mainFamily: "医药" }],
      },
    }),
    opportunityMap: opportunityMapFixture(),
  });
  assert.deepEqual(planMismatch.opportunityCards, []);
  assert.ok(planMismatch.noOpportunity.reasons.some((reason) => reason.includes("主归属和题材方向对不上")));

  const payloadMismatch = buildPostCloseOpportunityReport({
    payload: {
      candidates: [{ code: "000636", mainConcept: "医药", mainFamily: "医药" }],
    },
    premarketFlow: flowFixture(),
    opportunityMap: opportunityMapFixture(),
  });
  assert.deepEqual(payloadMismatch.opportunityCards, []);
  assert.ok(payloadMismatch.noOpportunity.reasons.some((reason) => reason.includes("主归属和题材方向对不上")));

  const matchingFamily = buildPostCloseOpportunityReport({
    payload: {
      candidates: [{ code: "000636", mainConcept: "算力租赁", mainFamily: "AI算力" }],
    },
    premarketFlow: flowFixture(),
    opportunityMap: opportunityMapFixture(),
  });
  assert.equal(matchingFamily.opportunityCards.length, 1);
});

test("mainline_core_reflow remains unclassified unless every explicit check passes", () => {
  const report = buildPostCloseOpportunityReport({
    premarketFlow: flowFixture({
      tradingPreference: { preference: "低位首板", conclusion: "资金偏好低位首板" },
    }),
    opportunityMap: opportunityMapFixture(),
  });

  assert.equal(report.opportunityCards.length, 1, "其他完整可执行计划仍可展示");
  assert.equal(report.opportunityCards[0].setupType, null);
  assert.equal(report.opportunityCards[0].setupChecks.preference, false);
  assert.deepEqual(report.opportunityCards[0].failedSetupChecks, ["preference"]);
});

test("candidate or negated main-rise and reflow wording never activates the setup", () => {
  ["主升候选", "主升待确认", "主升未确认"].forEach((cycle) => {
    const report = buildPostCloseOpportunityReport({
      premarketFlow: flowFixture({ indexOpportunity: { cycle } }),
      opportunityMap: opportunityMapFixture(),
    });
    assert.equal(report.opportunityCards[0].setupChecks.cycle, false, cycle);
    assert.equal(report.opportunityCards[0].setupType, null, cycle);
  });

  ["无确认回流", "回流失败", "不做回流"].forEach((preference) => {
    const report = buildPostCloseOpportunityReport({
      premarketFlow: flowFixture({ tradingPreference: { preference, conclusion: preference } }),
      opportunityMap: opportunityMapFixture(),
    });
    assert.equal(report.opportunityCards[0].setupChecks.preference, false, preference);
    assert.equal(report.opportunityCards[0].setupType, null, preference);
  });
});

test("closed opportunity-map gate and unavailable data both fail closed with plain reasons", () => {
  const closed = buildPostCloseOpportunityReport({
    premarketFlow: flowFixture(),
    opportunityMap: opportunityMapFixture({
      status: "watch_only",
      globalGate: {
        status: "closed",
        canActivate: false,
        canTradeCandidates: false,
        reasonCodes: ["decision_permission_blocked"],
        reasons: ["决策权限已阻断"],
      },
    }),
  });
  assert.equal(closed.marketPermission.status, "blocked");
  assert.deepEqual(closed.opportunityCards, []);
  assert.ok(closed.noOpportunity.reasons.every((reason) => !/blocked|execution|permission/i.test(reason)));

  const implicitGate = buildPostCloseOpportunityReport({
    premarketFlow: flowFixture(),
    opportunityMap: opportunityMapFixture({
      globalGate: {
        status: "watch_only",
        canActivate: true,
        canTradeCandidates: true,
        reasonCodes: [],
        reasons: [],
      },
    }),
  });
  assert.equal(implicitGate.marketPermission.status, "blocked");
  assert.deepEqual(implicitGate.opportunityCards, []);

  const missingTradePermission = buildPostCloseOpportunityReport({
    premarketFlow: flowFixture(),
    opportunityMap: opportunityMapFixture({
      globalGate: {
        status: "conditional",
        canActivate: true,
        reasonCodes: [],
        reasons: [],
      },
    }),
  });
  assert.equal(missingTradePermission.marketPermission.status, "blocked");
  assert.deepEqual(missingTradePermission.opportunityCards, []);

  const missing = buildPostCloseOpportunityReport({});
  assert.equal(missing.dataStatus.status, "unavailable");
  assert.equal(missing.marketPermission.status, "blocked");
  assert.equal(missing.status, "no_opportunity");
  assert.ok(missing.noOpportunity.reasons.some((reason) => reason.includes("关键盘后数据还没有准备好")));
});

test("derives both existing upstream modules from payload without copying selection logic", () => {
  const report = buildPostCloseOpportunityReport({
    payload: {
      updatedAt: "2026-08-11T15:00:00.000Z",
      fetchedAt: "2026-08-11T15:01:00.000Z",
      tomorrowDecision: { generationId: "decision-generation" },
      premarketModels: { generationId: "model-generation" },
      themeLibrary: { available: false, stale: false, themes: [] },
    },
  });

  assert.equal(report.generationId, "decision-generation");
  assert.equal(report.asOf, "2026-08-11T15:01:00.000Z");
  assert.equal(report.sources.premarketFlow, "derived_from_payload");
  assert.equal(report.sources.opportunityMap, "derived_from_payload");
  assert.equal(report.dataStatus.status, "unavailable");
  assert.equal(report.marketPermission.status, "blocked");
  assert.deepEqual(report.opportunityCards, []);
});

test("is deterministic and does not mutate frozen projection inputs", () => {
  const input = {
    premarketFlow: flowFixture(),
    opportunityMap: opportunityMapFixture(),
  };
  deepFreeze(input);

  const first = buildPostCloseOpportunityReport(input);
  const second = buildPostCloseOpportunityReport(input);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(input), true);
});

test("report plan objects do not alias writable upstream plan objects", () => {
  const advice = {
    ...plan(),
    buy: { status: "conditional", summary: "回踩后重新走强才买" },
    hold: { status: "after_fill", summary: "板块与核心同步才持有" },
    sell: { status: "conditional", summary: "回流失败则退出" },
    holdingPeriod: { display: "1-3个交易日" },
  };
  const report = buildPostCloseOpportunityReport({
    premarketFlow: flowFixture({ tradePlan: { plans: [advice] } }),
    opportunityMap: opportunityMapFixture(),
  });

  report.opportunityCards[0].plan.buy.summary = "被调用方改写";
  assert.equal(advice.buy.summary, "回踩后重新走强才买");
});

function observationInput(overrides = {}) {
  const ai = mapDirection("AI", "AI算力", {
    rank: 1,
    threadRole: "main",
    evidence: {
      isMainLine: true,
      resonance: true,
      sustained: true,
      reasonCodes: ["direction_mainline", "direction_resonance", "direction_sustained"],
      sourceThemeIds: ["AI"],
      sourceThemeNames: ["AI算力"],
    },
    emotionAnchors: [
      { code: "100001", name: "趋势核心", anchorType: "capacity", identity: "current_core", usage: "anchor_only" },
    ],
  });
  const medicine = mapDirection("MED", "医药", {
    rank: 2,
    evidence: {
      isMainLine: false,
      resonance: true,
      sustained: false,
      reasonCodes: ["direction_resonance"],
      sourceThemeIds: ["MED"],
      sourceThemeNames: ["医药"],
    },
    emotionAnchors: [
      { code: "200001", name: "情绪核心", anchorType: "sentiment", identity: "current_core", usage: "anchor_only" },
      { code: "200002", name: "高度核心", anchorType: "height", identity: "current_core", usage: "anchor_only" },
    ],
  });
  const flow = flowFixture({
    status: "blocked",
    blockedAt: "tradingPreference",
    themes: [{ id: "AI", name: "AI算力", family: "AI" }, { id: "MED", name: "医药", family: "MED" }],
    tradingPreference: {
      status: "blocked",
      executionBlocked: true,
      opportunities: [
        {
          key: "high_trend_pullback",
          path: "highTrend",
          trigger: ["趋势核心分歧后重新走强"],
          cancel: ["趋势核心破坏关键结构"],
        },
        {
          key: "board_core_reseal",
          path: "boardEmotion",
          trigger: ["情绪核心先分歧再回封"],
          cancel: ["分歧扩散且回封失败"],
        },
      ],
    },
    direction: {
      status: "ready",
      executionBlocked: true,
      items: [{ id: "AI", name: "AI算力", family: "AI" }, { id: "MED", name: "医药", family: "MED" }],
      confirmation: { status: "blocked", eligibleThemeIds: [], eligibleStockCodes: [], blockedBy: ["tradingPreference"] },
      allowedStockCodes: [],
    },
    stocks: { status: "blocked", candidates: [] },
    tradePlan: { status: "blocked", canIssueAdvice: false, plans: [] },
  });
  const opportunityMap = opportunityMapFixture({
    status: "watch_only",
    globalGate: {
      status: "closed",
      canActivate: false,
      canTradeCandidates: false,
      reasonCodes: ["decision_permission_blocked"],
      reasons: ["执行门槛关闭"],
    },
    directions: [ai, medicine],
  });
  const payload = {
    selected: [{ code: "999999", name: "无关样本" }],
    bestPicks: { picks: [] },
    recentIndexEmotionRelation: {
      status: "ready",
      relation: "index_up_emotion_divergence",
      indexState: "指数主升",
      emotionState: "高潮后分歧",
      summary: "指数保持可做，情绪处于高热后分歧。",
      evidence: ["指数结构未坏", "可参与情绪核心出现真实分歧", "题材核心仍有辨识度", "第四条应被截断"],
      validationCodes: ["200001", "100001", "200002", "300001"],
      asOf: "2026-08-12T15:00:00.000Z",
      probability: 0.92,
      executable: true,
      secret: "must-not-leak",
    },
  };
  return {
    payload: { ...payload, ...(overrides.payload || {}) },
    premarketFlow: overrides.premarketFlow || flow,
    opportunityMap: overrides.opportunityMap || opportunityMap,
  };
}

test("projects recent index-emotion relation through an explicit safe allowlist", () => {
  const report = buildPostCloseOpportunityReport(observationInput());

  assert.deepEqual(report.recentRelation, {
    status: "ready",
    relation: "index_up_emotion_divergence",
    indexState: "指数主升",
    emotionState: "高潮后分歧",
    summary: "指数保持可做，情绪处于高热后分歧。",
    evidence: ["指数结构未坏", "可参与情绪核心出现真实分歧", "题材核心仍有辨识度"],
    validationCodes: ["200001", "100001", "200002"],
    asOf: "2026-08-12T15:00:00.000Z",
    source: "payload.recentIndexEmotionRelation",
    integrity: {
      safeProjection: true,
      unknownFieldsExcluded: true,
      numericForecastExcluded: true,
    },
  });
  assert.equal(Object.hasOwn(report.recentRelation, "probability"), false);
  assert.equal(Object.hasOwn(report.recentRelation, "executable"), false);
  assert.equal(Object.hasOwn(report.recentRelation, "secret"), false);

  const missing = buildPostCloseOpportunityReport({
    premarketFlow: flowFixture(),
    opportunityMap: opportunityMapFixture(),
  });
  assert.equal(missing.recentRelation.status, "insufficient");
  assert.equal(missing.recentRelation.source, "payload.recentIndexEmotionRelation");
});

test("keeps conditional setup and watch layers visible while the execution gate is closed", () => {
  const report = buildPostCloseOpportunityReport(observationInput());

  assert.equal(report.marketPermission.status, "blocked");
  assert.deepEqual(report.opportunityCards, []);
  assert.equal(report.setupCards.length, 2);
  assert.deepEqual(report.setupCards.map((card) => card.key), [
    "emotion_core_divergence_reflow",
    "theme_trend_core_divergence_reflow",
  ]);
  assert.ok(report.setupCards.every((card) => card.status === "condition_watch"));
  assert.ok(report.setupCards.every((card) => card.integrity.observationOnly === true));
  assert.ok(report.setupCards.every((card) => card.integrity.executable === false));
  assert.ok(report.setupCards.every((card) => card.why.length <= 3 && card.trigger.length <= 3 && card.cancel.length <= 3));
  assert.ok(report.watchCards.some((card) => card.code === "200001" && card.usage === "validate_emotion"));
  assert.ok(report.watchCards.some((card) => card.code === "100001" && card.usage === "validate_theme"));
  assert.ok(report.watchCards.every((card) => card.blockers.includes("execution_gate_closed")));
  assert.ok(report.watchCards.every((card) => card.blockers.includes("not_in_selected_pool")));
  assert.ok(report.watchCards.every((card) => card.source.anchor === "opportunityMap.directions[].emotionAnchors"));
  assert.ok(report.watchCards.length <= 5);
});

test("height anchors stay height-only and cannot validate participatory emotion", () => {
  const report = buildPostCloseOpportunityReport(observationInput());
  const height = report.watchCards.find((card) => card.code === "200002");
  const emotionSetup = report.setupCards.find((card) => card.key === "emotion_core_divergence_reflow");

  assert.equal(height.usage, "height_only");
  assert.ok(height.blockers.includes("height_only_not_emotion_proxy"));
  assert.equal(emotionSetup.validationCodes.includes("200002"), false);
  assert.equal(emotionSetup.benchmark.code, "200001");
});

test("a current core outside the selected pool can be observed but never enters execution", () => {
  const report = buildPostCloseOpportunityReport(observationInput());
  const currentCore = report.watchCards.find((card) => card.code === "100001");

  assert.equal(currentCore.coreStatus, "current");
  assert.ok(currentCore.blockers.includes("not_in_selected_pool"));
  assert.equal(report.opportunityCards.some((card) => card.code === "100001"), false);
  assert.equal(currentCore.source.execution, "opportunityCards_only");
});

test("setup cards become plan-ready only by reference to an unchanged final opportunity card", () => {
  const input = observationInput();
  const executableMap = opportunityMapFixture();
  const executableFlow = flowFixture();
  const report = buildPostCloseOpportunityReport({
    payload: {
      recentIndexEmotionRelation: { ...input.payload.recentIndexEmotionRelation, validationCodes: ["000636"] },
      selected: [{ code: "000636" }],
      bestPicks: { picks: [{ code: "000636" }] },
    },
    premarketFlow: executableFlow,
    opportunityMap: executableMap,
  });
  const themeSetup = report.setupCards.find((card) => card.key === "theme_trend_core_divergence_reflow");

  assert.equal(report.opportunityCards.length, 1);
  assert.equal(themeSetup.status, "plan_ready");
  assert.equal(themeSetup.integrity.executable, false);
  assert.equal(report.watchCards.some((card) => card.code === "000636"), false, "execution and watch layers stay mutually exclusive");
  assert.equal(report.integrity.opportunityCardsFromFinalPlansOnly, true);
});

test("insufficient or cancelled recent relation cannot be upgraded to condition-watch", () => {
  const missingRelation = observationInput({ payload: { recentIndexEmotionRelation: undefined } });
  const missing = buildPostCloseOpportunityReport(missingRelation);
  assert.ok(missing.setupCards.every((card) => card.status === "insufficient"));

  const cancelledInput = observationInput();
  cancelledInput.payload.recentIndexEmotionRelation.status = "cancelled";
  const cancelled = buildPostCloseOpportunityReport(cancelledInput);
  assert.ok(cancelled.setupCards.every((card) => card.status === "cancelled"));
});

test("setup and watch projections strip upstream language that claims a buy action", () => {
  const input = observationInput();
  input.payload.recentIndexEmotionRelation.summary = "条件满足后可买入";
  input.premarketFlow.tradingPreference.opportunities[0].trigger = ["核心走强后可买入"];
  input.premarketFlow.tradingPreference.opportunities[1].trigger = ["回封后下单"];

  const report = buildPostCloseOpportunityReport(input);
  assert.doesNotMatch(JSON.stringify([report.setupCards, report.watchCards]), /可买|买入|下单|开仓|加仓/);
});

test("a final opportunity plan must include trigger, cancellation, position and risk exit", () => {
  const complete = plan();
  const variants = [
    { ...complete, triggers: [] },
    { ...complete, cancelConditions: [] },
    { ...complete, position: null },
    { ...complete, sell: null },
  ];

  variants.forEach((incompletePlan) => {
    const report = buildPostCloseOpportunityReport({
      premarketFlow: flowFixture({ tradePlan: { plans: [incompletePlan] } }),
      opportunityMap: opportunityMapFixture(),
    });
    assert.equal(report.status, "no_opportunity");
    assert.deepEqual(report.opportunityCards, []);
    assert.equal(report.noOpportunity.active, true);
  });

  const report = buildPostCloseOpportunityReport({
    premarketFlow: flowFixture({ tradePlan: { plans: [complete] } }),
    opportunityMap: opportunityMapFixture(),
  });
  assert.equal(report.status, "opportunities");
  assert.equal(report.opportunityCards[0].plan.riskExit, complete.sell);
});

test("a stale recent-relation generation fails closed inside the report builder", () => {
  const input = observationInput({
    payload: {
      premarketModels: { generationId: "2026-08-12:new" },
      tomorrowDecision: { generationId: "2026-08-12:new" },
      recentIndexEmotionRelation: {
        ...observationInput().payload.recentIndexEmotionRelation,
        generationId: "2026-08-12:old",
      },
    },
  });
  const report = buildPostCloseOpportunityReport(input);

  assert.equal(report.generationId, "2026-08-12:new");
  assert.equal(report.dataStatus.status, "unavailable");
  assert.equal(report.dataStatus.usable, false);
  assert.equal(report.recentRelation.status, "insufficient");
  assert.equal(report.recentRelation.usability.key, "generation_mismatch");
  assert.deepEqual(report.setupCards, []);
  assert.deepEqual(report.watchCards, []);
  assert.deepEqual(report.opportunityCards, []);
  assert.equal(report.integrity.generationAligned, false);
  assert.match(report.noOpportunity.reasons.join(" "), /不是同一批|重新生成/);
});

test("unified opportunity observations keep only complete hard-gate candidates and never grant execution", () => {
  const generationId = "2026-08-28:2026-08-28T15:00:00.000Z";
  const eligible = {
    code: "603618",
    name: "杭电股份",
    theme: "AI算力",
    path: "boardEmotion",
    pathLabel: "连板情绪",
    role: "主动型高度龙",
    tierKey: "path_representative",
    tierLabel: "机会观察·明日预期",
    observationReason: "主动核心仍有次日承接预期",
    observationOnly: true,
    executable: false,
    executionAuthority: false,
    hardGatePassed: true,
    expectation: {
      status: "qualified",
      label: "主动核心仍有次日承接预期",
      evidence: ["主动核心仍有次日承接预期"],
      evidenceSources: ["currentActiveShortTermCarrierWithDirection"],
    },
    entryConfirmation: {
      status: "waiting_trigger",
      activated: false,
      label: "充分换手后的回封板",
      triggerConditions: ["充分换手后重新回封"],
      invalidation: "回封失败",
    },
    postEntryNextDayExpectation: {
      status: "conditional",
      horizon: "entry_t_plus_1",
      label: "核心溢价 / 晋级验证",
      invalidation: "分歧兑现",
      probability: null,
      calibrated: false,
      observationOnly: true,
      executionAuthority: false,
    },
    profitPreference: { matched: true },
    capitalPreference: { matched: true },
    executionFeasibility: {
      status: "conditional",
      executableNow: false,
      canGrantExecution: false,
      onlyTightens: true,
      blockers: [],
    },
    opportunityDataCompleteness: {
      status: "complete",
      qualified: true,
      opportunityEligible: true,
      tradingDate: "2026-08-28",
      missingFields: [],
      blockers: [],
      evidence: {
        price: { usable: true },
        amount: { usable: true },
        liquidityCapacity: { usable: true },
        marketCap: { usable: true },
        session: { usable: true },
        fundFlow: { required: false },
      },
    },
    cancelConditions: ["回封失败"],
    missingConditions: ["等待统一交易授权开放"],
    riskNotes: [],
  };
  const payload = {
    tradingDate: "2026-08-28",
    candidates: [],
    unifiedDecisionChain: {
      generation: { generationId, tradingDate: "2026-08-28", aligned: true },
      observationCandidates: {
        status: "available",
        observationOnly: true,
        executionAuthority: false,
        stocks: [eligible, { ...eligible, code: "600330", name: "硬门槛失败票", hardGatePassed: false }],
      },
    },
  };
  const projection = buildOpportunityObservationCards(
    payload,
    [],
    { aligned: true, reportGeneration: generationId },
    { usable: true },
  );

  assert.equal(projection.state.status, "available");
  assert.equal(projection.state.sourceCount, 2);
  assert.equal(projection.cards.length, 1);
  assert.equal(projection.cards[0].code, "603618");
  assert.equal(projection.cards[0].observationOnly, true);
  assert.equal(projection.cards[0].executionAuthority, false);
  assert.ok(projection.rejected.some((row) => row.code === "600330" && row.reasonCodes.includes("hard_gate_failed")));
});
