"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = __dirname;
const scriptSource = fs.readFileSync(path.join(root, "script.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "index.html"), "utf8");

function extractFunction(source, name) {
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

const sandbox = { renderDecisionFocusStocksTable: () => "" };
vm.runInNewContext(
  `function escapeHtml(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }\n${extractFunction(scriptSource, "normalizeBigCycleLabelForDisplay")}\n${extractFunction(scriptSource, "resolveUnifiedDecisionChainProjection")}\n${extractFunction(scriptSource, "resolveTomorrowDecisionCandidateProjection")}\n${extractFunction(scriptSource, "renderBlockedCandidateDiagnostics")}\n${extractFunction(scriptSource, "renderContingencyCandidateObservations")}\n${extractFunction(scriptSource, "renderCanonicalDecisionEmptyState")}\n${extractFunction(scriptSource, "cleanDirectDirection")}\n${extractFunction(scriptSource, "directDecisionTextRows")}\n${extractFunction(scriptSource, "directPlainGateReason")}\n${extractFunction(scriptSource, "directPlainReopenCondition")}\n${extractFunction(scriptSource, "buildDirectDecisionSummary")}\n${extractFunction(scriptSource, "renderTomorrowDecisionReviewDetails")}\n${extractFunction(scriptSource, "renderDecisionFocusStocksTable")}\n${extractFunction(scriptSource, "renderDecisionDirectSummary")}\nthis.resolveUnifiedDecisionChainProjection = resolveUnifiedDecisionChainProjection; this.resolveTomorrowDecisionCandidateProjection = resolveTomorrowDecisionCandidateProjection; this.renderContingencyCandidateObservations = renderContingencyCandidateObservations; this.renderCanonicalDecisionEmptyState = renderCanonicalDecisionEmptyState; this.buildDirectDecisionSummary = buildDirectDecisionSummary; this.renderTomorrowDecisionReviewDetails = renderTomorrowDecisionReviewDetails; this.renderDecisionFocusStocksTable = renderDecisionFocusStocksTable; this.renderDecisionDirectSummary = renderDecisionDirectSummary;`,
  sandbox,
);

test("当日状态首页不再展示建议仓位卡", () => {
  assert.doesNotMatch(htmlSource, /id="positionLabel"/);
  assert.doesNotMatch(scriptSource, /#positionLabel/);
  assert.match(htmlSource, /5日情绪大周期/);
  assert.match(htmlSource, /滚动5个收盘确认，不代表指数5日结构/);
  assert.match(extractFunction(scriptSource, "renderDecisionDirectSummary"), /5日周期依据/);
  assert.doesNotMatch(htmlSource, /当前模型状态/);
});

test("题材页必须分开主线家族、今日细分和最终主攻，并允许空主攻", () => {
  assert.match(scriptSource, /主线家族/);
  assert.match(scriptSource, /今日最强细分/);
  assert.match(scriptSource, /暂无唯一主攻细分/);
  assert.match(scriptSource, /家族涨停\/高度/);
  assert.match(scriptSource, /不得计入单一细分/);
});

test("炒作偏好页必须展示持续T+1赚钱、切换和亏钱效应，不再用当日涨跌冒充", () => {
  assert.match(scriptSource, /持续赚钱偏好/);
  assert.match(scriptSource, /风格切换/);
  assert.match(scriptSource, /持续亏钱效应/);
  assert.match(scriptSource, /T收→T\+1收中位/);
  assert.match(scriptSource, /T\+1开→收中位/);
  assert.match(scriptSource, /单日强弱不改写正式偏好/);
});

test("盘中炒作偏好只显示暂定观察，收盘确认前不写资金更喜欢", () => {
  const source = extractFunction(scriptSource, "premarketPreferenceConclusion");
  assert.match(source, /intraday_provisional/);
  assert.match(source, /盘中暂见/);
  assert.match(source, /尚未经过收盘确认/);
  assert.match(source, /conclusionState !== "confirmed"/);
});

test("盘中炒作偏好状态显示待确认而不是已否决", () => {
  const view = {};
  vm.runInNewContext(
    `${extractFunction(scriptSource, "premarketStatusMeta")}\nthis.statusMeta = premarketStatusMeta;`,
    view,
  );
  assert.equal(view.statusMeta({
    key: "tradingPreference",
    status: "blocked",
    conclusionState: "intraday_provisional",
  }).label, "盘中待确认");
});

const STRICT_DECISION_ORDER = [
  "market_stage", "authorization", "profit_effect", "theme", "stock_mode",
  "stock_hard_gate", "result_stocks", "participation_allocation",
];
const DEFAULT_META = {
  generationId: "2026-08-21:closing",
  tradingDate: "2026-08-21",
  asOf: "2026-08-21T15:05:00+08:00",
};

function normalizedTestBigCycle(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (/主升|main[_ -]?rise/.test(raw)) return { key: "main_rise", label: "主升" };
  if (/退潮|retreat/.test(raw)) return { key: "retreat", label: "退潮" };
  if (/冰点|ice/.test(raw)) return { key: "ice", label: "冰点" };
  if (/混沌|chaos|mixed/.test(raw)) return { key: "chaos", label: "混沌" };
  return { key: "range", label: "震荡" };
}

function decisionMeta(decision, previous = DEFAULT_META) {
  const generationId = String(decision && decision.generationId || previous.generationId);
  const inferredDate = /^\d{4}-\d{2}-\d{2}/.test(generationId) ? generationId.slice(0, 10) : previous.tradingDate;
  const tradingDate = String(decision && decision.tradingDate || inferredDate || previous.tradingDate);
  const asOf = String(decision && decision.asOf || `${tradingDate}T15:05:00+08:00`);
  return { generationId, tradingDate, asOf };
}

function chainStock(row, index, count) {
  const relative = Math.round((100 / count) * 100) / 100;
  const initial = Math.round((10 / count) * 100) / 100;
  const maximum = Math.round((30 / count) * 100) / 100;
  return {
    code: String(row.code || `00000${index + 1}`),
    name: String(row.name || row.code || "结果股"),
    theme: String(row.mainConcept || row.direction || "PCB概念"),
    stockMode: String(row.identity || row.role || "趋势核心"),
    participationValue: { score: 80 - index },
    riskAdjustment: { score: 5 },
    riskAdjustedParticipationScore: 75 - index,
    positionAllocation: { relativeWeightPct: relative, initialPortfolioPct: initial, maximumPortfolioPct: maximum },
  };
}

function applyChainFixture(payload, decision = null, explicit = {}) {
  const priorMeta = {
    generationId: payload.generationId || DEFAULT_META.generationId,
    tradingDate: payload.tradingDate || DEFAULT_META.tradingDate,
    asOf: payload.asOf || DEFAULT_META.asOf,
  };
  const meta = decisionMeta(decision, priorMeta);
  Object.assign(payload, meta);
  if (decision && typeof decision === "object") Object.assign(decision, meta);
  const phaseDetail = decision && decision.market && decision.market.phaseDetail || {};
  const context = phaseDetail.decisionContext || {};
  const bigCycle = explicit.bigCycle || normalizedTestBigCycle(
    context.bigCycle && (context.bigCycle.key || context.bigCycle.label)
    || phaseDetail.structuralCycle
    || decision && decision.market && decision.market.cycle
    || "震荡",
  );
  const legacyCandidates = decision && Array.isArray(decision.candidates) ? decision.candidates : null;
  const legacyBlocked = Boolean(decision && (
    decision.verdict === "wait"
    || decision.direction && decision.direction.status === "cash"
    || decision.permission && (decision.permission.status === "blocked" || decision.permission.canActivate === false)
  ));
  const executionOpen = explicit.executionOpen !== undefined
    ? explicit.executionOpen
    : decision ? !legacyBlocked && Boolean(legacyCandidates && legacyCandidates.length) : true;
  const sourceStocks = explicit.stocks || (decision
    ? (executionOpen ? legacyCandidates : [])
    : [{ code: "300476", name: "胜宏科技", mainConcept: "PCB概念", identity: "主动型容量龙头" }]);
  const resultStocks = sourceStocks.map((row, index) => chainStock(row, index, sourceStocks.length || 1));
  if (resultStocks.length > 1) {
    const fixTotal = (key, expected) => {
      const total = resultStocks.reduce((sum, row) => sum + row.positionAllocation[key], 0);
      resultStocks[resultStocks.length - 1].positionAllocation[key] = Math.round((resultStocks[resultStocks.length - 1].positionAllocation[key] + expected - total) * 100) / 100;
    };
    fixTotal("relativeWeightPct", 100);
    fixTotal("initialPortfolioPct", 10);
    fixTotal("maximumPortfolioPct", 30);
  }
  const transition = context.transition || { key: "none", label: "无周期切换", status: "not_active" };
  const smallCycle = context.smallCycle || { key: "range", label: "震荡", status: "observed" };
  const emotionStage = context.emotionStage || phaseDetail.emotionStage || { key: "divergence", label: "分歧", status: "observed" };
  const authorizationOpen = explicit.authorizationOpen !== undefined ? explicit.authorizationOpen : executionOpen;
  payload.unifiedDecisionChain = {
    version: 3,
    method: "strict_sequential_fail_closed_v1",
    authority: "canonical_stock_decision",
    generation: { ...meta, aligned: true },
    marketStage: {
      status: "passed",
      passed: true,
      bigCycle: { ...bigCycle, status: "canonical" },
      transition,
      smallCycle,
      emotionStage,
      previousEmotionStage: { key: "divergence", label: "中等分歧", status: "passed", available: true, tradingDate: "2026-08-20", authority: "canonical_exact_closing_replay" },
      blockers: [],
    },
    authorization: {
      status: authorizationOpen ? "allowed" : "blocked",
      passed: authorizationOpen,
      tradePermission: { status: authorizationOpen ? "allowed" : "blocked", allowNew: authorizationOpen, allowAdd: false, reasons: authorizationOpen ? [] : ["统一决策链授权关闭"] },
      tradeValue: { key: authorizationOpen ? "selective" : "none", label: authorizationOpen ? "精选参与价值" : "无交易价值", numericScore: null, calibrated: false },
      positionPermission: { status: authorizationOpen ? "allowed" : "blocked", positionCeilingPct: authorizationOpen ? 30 : 0, initialActivationPct: authorizationOpen ? 10 : 0, addPermission: false },
      reasons: authorizationOpen ? [] : ["统一决策链授权关闭"],
    },
    profitEffect: { status: authorizationOpen ? "passed" : "not_evaluated", passed: authorizationOpen },
    theme: { status: authorizationOpen ? "passed" : "not_evaluated", passed: authorizationOpen, themes: authorizationOpen ? [String(resultStocks[0] && resultStocks[0].theme || "PCB概念")] : [] },
    stockMode: { status: authorizationOpen ? "passed" : "not_evaluated", passed: authorizationOpen },
    stockSelectionContext: { status: "passed", passed: true, authority: "unified_factor_context_v1" },
    result: {
      status: executionOpen && resultStocks.length ? "ready" : authorizationOpen ? "no_candidate" : "blocked",
      maxStocks: 5,
      selectedCount: executionOpen ? resultStocks.length : 0,
      selectedCodes: executionOpen ? resultStocks.map((row) => row.code) : [],
      stocks: executionOpen ? resultStocks : [],
      rejected: [],
      blockers: executionOpen ? [] : ["统一决策链未授权结果股"],
    },
    integrity: { ok: true, failClosed: true, noForcedCandidate: true, postEntryExpectationConditionalOnly: true, entryConfirmationRequired: true, opportunityDataCompletenessRequired: true, maxResultStocks: 5, strictOrder: STRICT_DECISION_ORDER },
  };
  return payload;
}

function fixture() {
  const payload = {
    market: { state: {} },
    marketEmotion: {
      light: "yellow",
      lightLabel: "黄灯",
      quality: "中等质量修复",
      review: {
        tomorrow: {
          base: "修复后的分化/兑现，不预设继续加强",
          positionLimit: "最多计划仓位1/3试错",
          invalidation: "市场或核心转弱就取消",
        },
      },
    },
    riskBoard: { blockedConcepts: ["CRO概念"] },
    themeLibrary: {
      themes: [
        { name: "PCB概念", isMainLine: true, stocks: [{ code: "300476" }] },
        { name: "医药", stocks: [{ code: "603127" }] },
      ],
    },
    bestPicks: {
      available: true,
      priceIntegrity: { status: "pass" },
      focusDirection: "PCB概念（含CPO/存储芯片）",
      picks: [{
        code: "300476",
        name: "胜宏科技",
        mainConcept: "PCB概念",
        identity: "主动型容量龙头",
        priceIntegrity: { consistent: true },
        tomorrowExecution: {
          tomorrowEntryQualified: true,
          stateLabel: "启动",
          triggers: [
            "PCB概念至少再有两只核心/容量票同步走强，证明不是单票孤立上涨",
            "胜宏科技不以高开幅度作为买点；第一次回踩承接有效，或整理后主动放量突破",
          ],
          cancelConditions: ["PCB概念继续扩散负反馈，或只有胜宏科技单点上涨"],
        },
      }],
      scenarioPlans: [{
        label: "市场加强",
        candidate: { code: "300476", name: "胜宏科技", mainConcept: "PCB概念", pricePhaseLabel: "启动" },
      }],
    },
  };
  applyChainFixture(payload);
  let tomorrowDecision = null;
  Object.defineProperty(payload, "tomorrowDecision", {
    configurable: true,
    enumerable: true,
    get() { return tomorrowDecision; },
    set(value) {
      tomorrowDecision = value;
      if (value && typeof value === "object") applyChainFixture(payload, value);
    },
  });
  return payload;
}

const clone = (value) => JSON.parse(JSON.stringify(value));

function loadTodaySpeculationStageResolver() {
  const resolverSandbox = {};
  vm.runInNewContext(
    `${extractFunction(scriptSource, "normalizeBigCycleLabelForDisplay")}\n${extractFunction(scriptSource, "resolveUnifiedDecisionChainProjection")}\n${extractFunction(scriptSource, "resolveTodaySpeculationStage")}\nthis.resolve = resolveTodaySpeculationStage;`,
    resolverSandbox,
  );
  return resolverSandbox.resolve;
}

test("今日炒作阶段只读取同代统一决策链的大周期", () => {
  const generationId = "2026-08-20:closing";
  const resolveStage = loadTodaySpeculationStageResolver();
  const payload = {
    generationId,
    tradingDate: "2026-08-20",
    asOf: "2026-08-20T15:05:00+08:00",
    market: { state: { cycle: "混沌" } },
    tomorrowDecision: {
      version: 1,
      generationId,
      market: {
        cycle: "震荡",
        phaseDetail: { structuralCycle: "震荡", generationId },
      },
      opportunityMap: {
        directions: [{ name: "科技" }, { name: "医药" }],
      },
    },
  };
  applyChainFixture(payload, payload.tomorrowDecision, { executionOpen: false, bigCycle: { key: "range", label: "震荡" } });
  const result = resolveStage(payload);

  assert.equal(result.label, "震荡");
  assert.equal(result.source, "unifiedDecisionChain.marketStage.bigCycle");
  assert.equal(result.generationAligned, true);
});

test("缺失统一决策链时旧盘后决策和实时旧周期都不得补位", () => {
  const resolveStage = loadTodaySpeculationStageResolver();
  const result = resolveStage({
    generationId: "2026-08-21:current",
    market: { state: { cycle: "混沌" } },
    tomorrowDecision: {
      version: 1,
      generationId: "2026-08-20:old",
      market: { phaseDetail: { structuralCycle: "震荡", generationId: "2026-08-20:old" } },
    },
  });

  assert.equal(result.label, "--");
  assert.equal(result.source, "unifiedDecisionChain.marketStage.bigCycle");
  assert.equal(result.generationAligned, false);
});

test("直接结论的正式周期、仓位与成员只认统一决策链", () => {
  const model = sandbox.buildDirectDecisionSummary(fixture(), { cycleRead: { displayCycle: "不应覆盖黄灯口径" } });
  assert.equal(model.todayTitle, "震荡");
  assert.equal(model.direction, "暂无授权方向");
  assert.deepEqual(Array.from(model.candidates, (item) => item.name), ["胜宏科技"]);
  assert.equal(model.permission, "初始10% · 上限30%");
  assert.match(model.action, /等待买卖触发计划与盘中承接同时确认/);
  assert.doesNotMatch(model.todayTitle, /黄灯|修复/);
});

test("错代盘后条件机会只作观察证据，不能改写统一链空仓结论", () => {
  const payload = fixture();
  payload.tomorrowDecision = {
    version: 1,
    verdict: "wait",
    direction: { status: "cash", name: "暂待确认", path: "条件机会待触发" },
    candidates: [],
    contingencies: [],
    permission: { status: "wait", canActivate: false },
  };
  payload.postCloseOpportunity = {
    status: "conditional_watch",
    setupCards: [
      { key: "emotion_core_divergence_reflow", label: "情绪核心分歧回流", status: "condition_watch" },
      { key: "theme_trend_core_divergence_reflow", label: "题材趋势核心分歧回流", status: "condition_watch" },
    ],
    opportunityCards: [],
  };

  const model = sandbox.buildDirectDecisionSummary(payload, {});
  const html = sandbox.renderDecisionDirectSummary(model);

  assert.equal(model.candidates.length, 0);
  assert.equal(model.permission, "新仓0% · 风险上限未开放");
  assert.doesNotMatch(html, /direct-ticket-card|direct-cash-card|明日交易计划|明日可执行方案/);
  assert.doesNotMatch(html, /2个条件机会|href="#personal-logic-picker"/);
});

test("已有场景但没有候选时不得拿普通 picks 或题材股补位", () => {
  const payload = fixture();
  payload.bestPicks.scenarioPlans = [{ label: "市场分化", candidate: null }];
  applyChainFixture(payload, null, { executionOpen: false, authorizationOpen: true, stocks: [] });
  const model = sandbox.buildDirectDecisionSummary(payload, {});
  assert.equal(model.candidates.length, 0);
  assert.equal(model.permission, "新仓0% · 风险上限未开放");
  assert.match(model.action, /统一决策链未授权/);
});

test("仓位边界保留在模型内部，但明日决策首页不再展示仓位方案卡", () => {
  const payload = fixture();
  applyChainFixture(payload, null, { executionOpen: false, authorizationOpen: false, stocks: [] });
  payload.unifiedDecisionChain.authorization.positionPermission.sourceRangePct = [0, 20];
  const model = sandbox.buildDirectDecisionSummary(payload, {});
  const html = sandbox.renderDecisionDirectSummary(model);
  assert.equal(model.permission, "新仓0% · 持仓风险上限20%");
  assert.match(model.positionHint, /只管理已有持仓/);
  assert.doesNotMatch(html, /仓位方案/);
  assert.doesNotMatch(html, /持仓风险上限20%/);
  assert.doesNotMatch(html, /direct-decision-permission/);
});

test("旧价格审计只作观察证据，不能覆盖统一链正式授权", () => {
  const payload = fixture();
  payload.bestPicks.priceIntegrity.status = "warn";
  const model = sandbox.buildDirectDecisionSummary(payload, {});
  assert.equal(model.candidates.length, 1);
  assert.equal(model.permission, "初始10% · 上限30%");
  assert.equal(payload.bestPicks.priceIntegrity.status, "warn");
});

test("风险方向与题材库旧观察票不能扩容或替换统一链结果", () => {
  const payload = fixture();
  payload.bestPicks.picks[0].mainConcept = "CRO概念";
  payload.bestPicks.scenarioPlans[0].candidate.mainConcept = "CRO概念";
  payload.bestPicks.picks.push({ code: "603127", name: "旧观察票" });
  let model = sandbox.buildDirectDecisionSummary(payload, {});
  assert.deepEqual(Array.from(model.candidates, (item) => item.code), ["300476"]);

  const noPicks = fixture();
  noPicks.bestPicks.picks = [];
  noPicks.bestPicks.scenarioPlans = [];
  model = sandbox.buildDirectDecisionSummary(noPicks, {});
  assert.deepEqual(Array.from(model.candidates, (item) => item.code), ["300476"]);
});

test("首页只保留直接结论，完整明细只有一份并位于复盘页", () => {
  const decisionStart = htmlSource.indexOf('<section id="decision"');
  const decisionEnd = htmlSource.indexOf('<section id="market-emotion"', decisionStart);
  const reviewStart = htmlSource.indexOf('<section id="review-conclusion"');
  const reviewEnd = htmlSource.indexOf('<section id="sell-advisor"', reviewStart);
  const decisionHtml = htmlSource.slice(decisionStart, decisionEnd);
  const reviewHtml = htmlSource.slice(reviewStart, reviewEnd);
  assert.doesNotMatch(decisionHtml, /id="decisionTopicsBody"|id="decisionPicksBody"|id="decisionMarketBody"/);
  assert.match(reviewHtml, /class="panel review-decision-details ui-disclosure"/);
  assert.match(reviewHtml, /id="decisionTopicsBody"/);
  for (const id of ["decisionMarketBody", "decisionEmotionBody", "decisionTopicsBody", "decisionPicksBody"]) {
    assert.equal((htmlSource.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `${id} must be unique`);
  }
});

test("旧三路径概率可作同代观察，但现金成员与备选都不能越过统一链", () => {
  const payload = fixture();
  payload.tomorrowDecision = {
    version: 1,
    verdict: "wait",
    primaryScenarioKey: "range_divergence",
    confidence: { score: 55, label: "低置信", method: "rule_prior", calibrated: false },
    forecast: {
      indexOutlook: {
        available: true,
        calibrated: false,
        probabilitySemantics: false,
        methodLabel: "指数路径规则权重（未历史校准）",
        primary: { key: "repair_up", label: "修复上行", weight: 45 },
        scenarios: [
          { key: "repair_up", label: "修复上行", weight: 45 },
          { key: "range", label: "区间震荡", weight: 36 },
          { key: "weak_close", label: "弱势收盘", weight: 19 },
        ],
        riskContext: { key: "retreat", label: "退潮", directionWeightImpact: 0, note: "大周期只约束交易风险与仓位上限，不参与次日指数方向权重。" },
        dataQuality: { coveragePct: 100, missingFields: [] },
      },
    },
    scenarios: [
      { key: "strengthen", label: "加强", probability: 25 },
      { key: "range_divergence", label: "震荡分化", probability: 55 },
      { key: "weaken", label: "减弱", probability: 20 },
    ],
    market: { cycle: "修复期", corePhase: "加速后兑现窗口" },
    direction: { status: "cash", name: "PCB概念", path: "主路径暂无合格票" },
    candidates: [{ code: "000001", name: "不得出现" }],
    contingencies: [{
      code: "300476",
      name: "胜宏科技",
      scenarioLabel: "加强",
      buy: { summary: "观察区271.79—284.40，回踩承接后才试错" },
      hold: { summary: "未成交前不适用；T+1 09:35复核" },
      sell: { summary: "参考硬止损264.51—266.19，成交后按成本重算" },
      holdingPeriod: { summary: "1—3个交易日 · 启发式 · T+1强制复核" },
      advice: {
        buy: { statusLabel: "等待价格与承接触发" },
        hold: { statusLabel: "未成交" },
        sell: { statusLabel: "成交后重算" },
      },
    }],
    permission: "0% · 空仓等待",
    invalidation: "负反馈扩散即取消",
  };
  const model = sandbox.buildDirectDecisionSummary(payload, {});
  assert.equal(model.forecast.available, true);
  assert.equal(model.forecast.primaryScenario.probability, 55);
  assert.equal(model.forecast.indexOutlook.primary.key, "repair_up");
  assert.equal(model.forecast.indexOutlook.probabilitySemantics, false);
  assert.equal(model.candidates.length, 0);
  assert.equal(model.contingencies.length, 0);
  assert.equal(model.permission, "新仓0% · 风险上限未开放");
  const html = sandbox.renderDecisionDirectSummary(model);
  assert.match(html, /震荡分化/);
  assert.match(html, /55%/);
  assert.match(html, /明日指数路径/);
  assert.match(html, /修复上行/);
  assert.match(html, /权重45/);
  assert.match(html, /规则权重非概率/);
  assert.match(html, /大周期只约束交易风险与仓位上限/);
  assert.doesNotMatch(html, /direct-ticket-card|direct-cash-card|明日交易计划|明日可执行方案/);
  assert.doesNotMatch(html, /271\.79|264\.51|路径切换后重新评估/);
});

test("新口径把指数路径与赚钱效应路径分开，旧综合减弱不得进入主展示", () => {
  const payload = fixture();
  payload.tomorrowDecision = {
    version: 3,
    primaryScenarioKey: "weaken",
    confidence: { score: 78, method: "rule_prior", calibrated: false },
    scenarios: [
      { key: "strengthen", label: "加强", probability: 17 },
      { key: "range_divergence", label: "震荡分化", probability: 33 },
      { key: "weaken", label: "减弱", probability: 50 },
    ],
    forecast: {
      dataQuality: { coveragePct: 100, knownEvidenceCount: 9, totalEvidenceCount: 9, missingFields: [] },
      indexOutlook: {
        available: true,
        calibrated: false,
        probabilitySemantics: false,
        primary: { key: "repair_up", label: "修复上行", weight: 45 },
        scenarios: [
          { key: "repair_up", label: "修复上行", weight: 45 },
          { key: "range", label: "区间震荡", weight: 36 },
          { key: "weak_close", label: "弱势收盘", weight: 19 },
        ],
        riskContext: { note: "大周期只约束交易风险与仓位上限，不参与次日指数方向权重。" },
        dataQuality: { coveragePct: 100, missingFields: [] },
      },
      profitEffectOutlook: {
        available: true,
        calibrated: false,
        probabilitySemantics: false,
        primary: { key: "healthy_divergence", label: "健康分化", weight: 61 },
        scenarios: [
          { key: "strengthen", label: "赚钱效应加强", weight: 28 },
          { key: "healthy_divergence", label: "健康分化", weight: 61 },
          { key: "negative_feedback", label: "负反馈扩散", weight: 11 },
        ],
        dataQuality: {
          coveragePct: 100,
          missingFields: [],
          notes: ["大周期、主要指数均线、指数日涨跌和具体候选股票均不参与本模型。"],
        },
      },
    },
    market: { cycle: "退潮", corePhase: "中等分歧" },
    direction: { status: "cash", name: "等待" },
    candidates: [],
    permission: { status: "blocked", canActivate: false },
  };
  const model = sandbox.buildDirectDecisionSummary(payload, {});
  const html = sandbox.renderDecisionDirectSummary(model);
  assert.equal(model.forecast.indexOutlook.primary.key, "repair_up");
  assert.equal(model.forecast.profitEffectOutlook.primary.key, "healthy_divergence");
  assert.match(html, /data-outlook-axis="index"[\s\S]*修复上行[\s\S]*权重45/);
  assert.match(html, /data-outlook-axis="profit-effect"[\s\S]*健康分化[\s\S]*权重61/);
  assert.doesNotMatch(html, /旧版综合路径/);
  assert.doesNotMatch(html, />减弱 50%</);
});

test("机会观察股卡片只保留标签、看点、买点确认、买后次日与首要失效", () => {
  const html = sandbox.renderDecisionFocusStocksTable({
    status: "observation",
    note: "按三项偏好筛选",
    rows: [{
      code: "600110",
      name: "<诺德股份>",
      expectation: { status: "qualified", label: "CPO主动核心仍有次日承接预期" },
      postEntryNextDayExpectation: {
        status: "conditional",
        key: "pullback_repair_premium",
        label: "修复延续 / 冲击前高",
        probability: null,
        calibrated: false,
      },
      entryConfirmation: {
        version: 1,
        status: "waiting_trigger",
        type: "support_or_breakout",
        label: "承接转强 / 放量突破",
        reason: "等待板块回流与个股主动承接",
        avoid: "脉冲反抽不算确认",
        triggerConditions: ["板块回流且个股转强"],
        invalidation: "放量破位",
        activated: false,
        observationOnly: true,
        executionAuthority: false,
      },
      capitalPreference: { matched: true, bucketLabel: "100-300亿" },
      profitPreference: { matched: true, primaryPath: "lowLaunch" },
      pathLabel: "低位启动",
      setupKey: "limit_up_pullback_repair",
      setupLabel: "前板回撤",
      missingConditions: ["题材归属待核实", "不应显示的次要确认"],
      cancelConditions: ["只有孤立涨停", "不应显示的次要失效"],
    }],
    anchorRows: [],
  });
  assert.match(html, /direct-opportunity-stock-grid/);
  assert.match(html, /机会观察股 · 1只/);
  assert.match(html, /看点[\s\S]*CPO主动核心延续/);
  assert.match(html, /100-300亿/);
  assert.match(html, /低位启动/);
  assert.match(html, /is-setup[^>]*>前板回撤/);
  assert.match(html, /买点确认[\s\S]*承接转强 \/ 放量突破/);
  assert.match(html, /data-entry-confirmation="support_or_breakout"/);
  assert.match(html, /买后次日[\s\S]*修复延续 \/ 冲击前高/);
  assert.match(html, /data-post-entry-expectation="pullback_repair_premium"/);
  assert.match(html, /失效[\s\S]*孤立上涨/);
  assert.doesNotMatch(html, /不应显示的次要确认|不应显示的次要失效|<em>观察<\/em>/);
  assert.doesNotMatch(html, /明日预期|资金偏好|赚钱效应偏好|取消条件/);
  assert.doesNotMatch(html, /<诺德股份>/);
  assert.match(html, /&lt;诺德股份&gt;/);
  assert.doesNotMatch(html, /<table>/);
});

test("主路径候选仍保留在模型内部，但首页不再渲染买入持有卖出期限", () => {
  const payload = fixture();
  payload.tomorrowDecision = {
    version: 1,
    verdict: "conditional",
    primaryScenarioKey: "range_divergence",
    confidence: { score: 68, label: "中等置信", method: "rule_prior" },
    scenarios: [
      { key: "strengthen", probability: 25 },
      { key: "range_divergence", probability: 55 },
      { key: "weaken", probability: 20 },
    ],
    market: { cycle: "震荡期", corePhase: "小分歧待承接" },
    direction: { status: "candidate", name: "PCB概念", path: "分歧承接" },
    candidates: [{
      code: "300476",
      name: "<img src=x onerror=alert(1)>",
      identity: "容量核心",
      phase: "分歧",
      buy: { summary: "回踩承接才买" },
      hold: { summary: "结构未破继续持有" },
      sell: { summary: "硬止损优先" },
      holdingPeriod: { summary: "1—3个交易日 · T+1复核" },
    }],
    permission: {
      status: "conditional",
      canActivate: true,
      executionMode: "normal",
      summary: "计划仓位1/3",
    },
    integrity: { ok: true, blockedCandidates: [] },
    validation: { upgrade: ["共振后加仓"], downgrade: ["负反馈扩散取消"] },
    invalidation: "核心破位",
  };
  const model = sandbox.buildDirectDecisionSummary(payload, {});
  assert.equal(model.candidates.length, 1);
  assert.equal(model.candidates[0].buy, "回踩承接才买");
  assert.equal(model.candidates[0].holdingPeriod, "1—3个交易日 · T+1复核");
  const html = sandbox.renderDecisionDirectSummary(model);
  assert.doesNotMatch(html, /direct-ticket-card|direct-ticket-actions|direct-ticket-list|明日交易计划|明日可执行方案/);
  assert.doesNotMatch(html, /回踩承接才买|结构未破继续持有|硬止损优先|1—3个交易日/);
  assert.doesNotMatch(html, /<img src=x/);
});

test("非法概率不伪造百分比，且新决策可在 market.state 缺失时先渲染", () => {
  const payload = fixture();
  payload.market.state = null;
  payload.tomorrowDecision = {
    version: 1,
    primaryScenarioKey: "range_divergence",
    scenarios: [
      { key: "strengthen", probability: 25 },
      { key: "range_divergence", probability: 50 },
      { key: "weaken", probability: 20 },
    ],
    direction: { status: "cash", name: "等待" },
    candidates: [],
  };
  const model = sandbox.buildDirectDecisionSummary(payload, {});
  assert.equal(model.forecast.available, false);
  const html = sandbox.renderDecisionDirectSummary(model);
  assert.match(html, /不会补造百分比|不在主决策区输出百分比/);
  const renderStart = scriptSource.indexOf("function renderDecision(payload)");
  const directCall = scriptSource.indexOf("renderMarketStrengthSource(payload);", renderStart);
  const stateGuard = scriptSource.indexOf("if (!st) return;", renderStart);
  assert(directCall > renderStart && directCall < stateGuard, "直接结论必须在 market.state 提前返回前渲染");
});

test("概率依据只进入复盘折叠，并明确未校准与候选隔离", () => {
  const html = sandbox.renderTomorrowDecisionReviewDetails({
    version: 1,
    coreEmotion: {
      dataQuality: { exactPreviousTradingDay: false },
      items: [
        { code: "300308", name: "中际旭创", stage: "negative_feedback", weight: 96, evidence: ["真实分时冲高回落形成单点负反馈"] },
        { code: "300476", name: "<img src=x onerror=bad()>", stage: "acceleration", weight: 100, selectedCandidate: true, evidence: ["推荐票自身加速"] },
      ],
    },
    forecast: {
      version: 1,
      calibrated: false,
      methodLabel: "规则先验（未历史校准）",
      dataQuality: { coveragePct: 62 },
      evidence: [{ scope: "index", label: "指数结构", detail: "<script>bad()</script>", available: true }],
      updateRules: [{ time: "09:35", purpose: "验证承接", upgradeConditions: ["至少两只独立核心共振"], downgradeConditions: ["负反馈扩散"] }],
    },
  });
  assert.match(html, /规则先验（未历史校准）/);
  assert.match(html, /单只推荐票上涨不能证明市场加强/);
  assert.match(html, /至少两只独立核心共振/);
  assert.match(html, /高影响核心情绪篮子/);
  assert.match(html, /中际旭创/);
  assert.match(html, /单点负反馈只记为待验证/);
  assert.match(html, /已从市场概率验证中剔除/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
  assert.doesNotMatch(html, /<script>bad/);
  assert.match(html, /&lt;script&gt;bad/);
});

test("canonical 空决策不会被 raw bestPicks 候选补位", () => {
  const payload = fixture();
  payload.bestPicks.scenarioPlans = [{
    key: "strengthen",
    label: "加强",
    candidate: { code: "600584", name: "长电科技" },
  }];
  payload.bestPicks.picks = [{ code: "002407", name: "多氟多" }];
  payload.tomorrowDecision = {
    version: 1,
    verdict: "wait",
    candidates: [],
    contingencies: [],
    action: { summary: "主路径没有合格候选，保持空仓。" },
    integrity: { ok: true, blockedCandidates: [] },
  };

  const projection = sandbox.resolveTomorrowDecisionCandidateProjection(payload);
  assert.equal(projection.canonical, true);
  assert.equal(projection.pickRows.length, 0);
  assert.equal(projection.scenarioPlans.length, 0);
  const html = sandbox.renderCanonicalDecisionEmptyState(projection);
  assert.doesNotMatch(html, /600584|002407|长电科技|多氟多|候选已准备/);
  assert.match(html, /最终决策：没有可执行主候选/);
  assert.match(html, /旧最优解不会补位/);

  const reviewSource = extractFunction(scriptSource, "renderReviewConclusion");
  const decisionSource = extractFunction(scriptSource, "renderDecision");
  assert.match(reviewSource, /resolveTomorrowDecisionCandidateProjection\(payload\)/);
  assert.doesNotMatch(reviewSource, /bestPicks\.(?:scenarioPlans|picks)/);
  assert.match(decisionSource, /resolveUnifiedDecisionChainProjection\(payload\)/);
  assert.doesNotMatch(decisionSource, /bestPicks\.(?:scenarioPlans|picks)|tomorrowDecision\.candidates/);
});

test("只有chain result.rejected可进入明确禁止执行的诊断区", () => {
  const payload = fixture();
  payload.tomorrowDecision = {
    version: 1,
    candidates: [],
    contingencies: [],
    integrity: {
      ok: true,
      blockedCandidates: [{
        code: "600584",
        name: "<img src=x onerror=bad()>",
        scenarioKey: "strengthen",
        reasons: ["未通过最终决策硬门槛"],
      }],
    },
  };
  payload.unifiedDecisionChain.result.rejected = [{
    code: "600584",
    name: "<img src=x onerror=bad()>",
    reasons: ["未通过统一链最终硬门槛"],
  }];

  const projection = sandbox.resolveTomorrowDecisionCandidateProjection(payload);
  assert.equal(projection.scenarioPlans.length, 0);
  assert.equal(projection.blockedCandidates.length, 1);
  const html = sandbox.renderCanonicalDecisionEmptyState(projection);
  assert.match(html, /data-decision-role="blocked-diagnostics"/);
  assert.match(html, /禁止执行/);
  assert.match(html, /600584/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
  assert.doesNotMatch(html, /候选已准备/);
});

test("旧五项执行契约只能作观察，不能收紧统一链正式成员", async (t) => {
  const baseDecision = {
    version: 1,
    verdict: "conditional",
    primaryScenarioKey: "range_divergence",
    direction: { status: "candidate", name: "PCB概念" },
    candidates: [{
      code: "300476",
      name: "胜宏科技",
      scenarioKey: "range_divergence",
      buy: { summary: "承接后才执行" },
    }],
    contingencies: [],
    permission: { status: "conditional", canActivate: true, executionMode: "normal" },
    integrity: { ok: true, blockedCandidates: [] },
  };
  const allowedPayload = fixture();
  allowedPayload.tomorrowDecision = clone(baseDecision);
  const allowed = sandbox.resolveTomorrowDecisionCandidateProjection(allowedPayload);
  assert.equal(allowed.primaryGatePassed, true);
  assert.equal(allowed.primary.length, 1);
  assert.equal(allowed.executable.length, 1);
  assert.equal(sandbox.buildDirectDecisionSummary(allowedPayload, {}).candidates.length, 1);

  const cases = [
    ["verdict wait", (decision) => { decision.verdict = "wait"; }],
    ["permission status blocked", (decision) => { decision.permission.status = "blocked"; }],
    ["canActivate false", (decision) => { decision.permission.canActivate = false; }],
    ["executionMode blocked", (decision) => { decision.permission.executionMode = "blocked"; }],
    ["integrity missing", (decision) => { delete decision.integrity; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const payload = fixture();
      payload.tomorrowDecision = clone(baseDecision);
      mutate(payload.tomorrowDecision);
      const projection = sandbox.resolveTomorrowDecisionCandidateProjection(payload);
      assert.equal(projection.primaryGatePassed, true);
      assert.deepEqual(Array.from(projection.primary, (item) => item.code), ["300476"]);
      assert.equal(projection.executable.length, 1);
      assert.equal(projection.scenarioPlans.length, 1);
      assert.equal(sandbox.buildDirectDecisionSummary(payload, {}).candidates.length, 1);
    });
  }
});

test("旧contingencies不进入正式成员或执行分栏", () => {
  const payload = fixture();
  payload.tomorrowDecision = {
    version: 1,
    verdict: "conditional",
    primaryScenarioKey: "range_divergence",
    direction: { status: "candidate", name: "PCB概念" },
    candidates: [{ code: "300476", name: "胜宏科技", scenarioKey: "range_divergence" }],
    contingencies: [{ code: "600584", name: "长电科技", scenarioKey: "strengthen", scenarioLabel: "加强" }],
    permission: { status: "conditional", canActivate: true, executionMode: "normal" },
    integrity: { ok: true, blockedCandidates: [] },
  };
  const projection = sandbox.resolveTomorrowDecisionCandidateProjection(payload);
  assert.equal(projection.primary.length, 1);
  assert.equal(projection.executable.length, 1);
  assert.equal(projection.pickRows.length, 1);
  assert.equal(projection.contingencies.length, 0);
  assert.equal(projection.scenarioPlans.length, 1);
  const observationHtml = sandbox.renderContingencyCandidateObservations(projection.contingencies);
  assert.equal(observationHtml, "");

  const reviewSource = extractFunction(scriptSource, "renderReviewConclusion");
  const decisionSource = extractFunction(scriptSource, "renderDecision");
  assert.match(reviewSource, /candidateProjection\.primary\.length/);
  assert.doesNotMatch(decisionSource, /tomorrowDecision\.contingencies/);
});

test("旧opportunityMap不能把chain结果股或普通票补成机会观察股", () => {
  const payload = fixture();
  payload.tomorrowDecision = {
    version: 1,
    verdict: "conditional",
    primaryScenarioKey: "range_divergence",
    direction: { status: "candidate", name: "科技" },
    candidates: [{ code: "300476", name: "胜宏科技", scenarioKey: "range_divergence", buy: { summary: "承接确认后买" } }],
    permission: { status: "conditional", canActivate: true, executionMode: "normal" },
    integrity: { ok: true, blockedCandidates: [] },
    opportunityMap: {
      status: "observe_only",
      globalGate: { canTradeCandidates: false, reason: "周期节奏没有交易窗口" },
      directions: [
        {
          name: "科技",
          threadRole: "main",
          state: "watch_only",
          evidence: { breadthCount: 18, limitCount: 5, filteredRiskSubthemes: ["风险子题材"], reasonCodes: ["direction_resonance", "high_impact_anchor_present", "blocked_subthemes_filtered"] },
          emotionAnchors: [{ code: "600584", name: "长电科技", anchorType: "capacity", stage: "supported", impactWeight: 92 }],
          tradeCandidates: [{ code: "300476", name: "胜宏科技", identity: "主动核心" }],
        },
        {
          name: "医药",
          threadRole: "parallel",
          state: "watch_only",
          emotionAnchors: [{ code: "600664", name: "哈药股份", identity: "情绪龙头", weight: 88 }],
          tradeCandidates: [{ code: "603127", name: "昭衍新药", identity: "交易核心" }],
        },
      ],
    },
  };

  const model = sandbox.buildDirectDecisionSummary(payload, {});
  assert.equal(model.opportunity.directions.length, 2);
  assert.equal(model.opportunity.noTrade, false);
  assert.equal(model.opportunity.legacyObservationBlocked, true);
  assert.deepEqual(Array.from(model.candidates, (item) => item.code), ["300476"]);
  assert.deepEqual(Array.from(model.opportunity.directions[0].tradeCandidates, (item) => item.code), []);
  assert.equal(model.opportunity.directions[1].tradeCandidates.length, 0);
  assert.equal(model.opportunity.directions[0].emotionAnchors[0].weight, 92);
  const html = sandbox.renderDecisionDirectSummary(model);
  assert.match(html, /市场情绪锚（不参与机会排名）/);
  assert.match(html, /本方向无符合当前资金偏好的机会股/);
  assert.match(html, /data-focus-kind="emotion-anchor-evidence"/);
  assert.doesNotMatch(html, /具体看谁/);
  assert.match(html, /科技/);
  assert.match(html, /医药/);
  assert.match(html, /长电科技/);
  assert.match(html, /哈药股份/);
  assert.match(html, /对市场判断的影响 92/);
  assert.match(html, /覆盖18只/);
  assert.match(html, /涨停5只/);
  assert.match(html, /大成交核心股/);
  assert.match(html, /有人接住抛盘/);
  assert.match(html, /主方向 · 只观察/);
  assert.match(html, /并行方向 · 只观察/);
  assert.match(html, /已剔除风险子题材：风险子题材/);
  assert.doesNotMatch(html, /main · watch_only/);
  assert.doesNotMatch(html, /胜宏科技/);
  assert.doesNotMatch(html, /昭衍新药/);
  assert.doesNotMatch(html, /direct-ticket-card|<div class="is-buy">/);
  assert.doesNotMatch(html, /今日无交易机会|今日仅观察|今日无交易窗口|情绪锚点|情绪权重|容量锚点/);
});

test("opportunityDirections只展示统一链观察候选，正式成员和其他旧票都不能补位", () => {
  const payload = fixture();
  payload.tomorrowDecision = {
    version: 1,
    verdict: "conditional",
    primaryScenarioKey: "strengthen",
    direction: { status: "candidate", name: "科技" },
    candidates: [{
      code: "300476",
      name: "胜宏科技",
      scenarioKey: "strengthen",
      buy: { summary: "回踩承接确认后买" },
      hold: { summary: "结构未破继续持有" },
      sell: { summary: "承接失败卖出" },
    }],
    permission: { status: "conditional", canActivate: true, executionMode: "normal" },
    integrity: { ok: true, blockedCandidates: [] },
    opportunityDirections: [{
      name: "科技",
      threadRole: "主流方向",
      state: "加强待确认",
      emotionAnchors: [{ code: "600584", name: "长电科技", identity: "情绪锚点" }],
      tradeCandidates: [
        { code: "300476", name: "胜宏科技", identity: "主动核心" },
        { code: "002156", name: "通富微电", identity: "容量观察" },
      ],
    }],
  };
  payload.unifiedDecisionChain.observationCandidates = {
    status: "available",
    observationOnly: true,
    executionAuthority: false,
    maxStocks: 5,
    selectedCount: 1,
    selectedCodes: ["300476"],
    stocks: [{
      code: "300476",
      name: "胜宏科技",
      tierLabel: "机会观察·资金偏好匹配",
      tierKey: "path_representative",
      path: "boardEmotion",
      hardGatePassed: true,
      observationReason: "连板情绪路径仍有条件预期",
      expectation: {
        status: "qualified",
        label: "连板情绪路径仍有条件预期",
        evidence: ["连板情绪路径仍有条件预期"],
        evidenceSources: ["tradingStylePreference"],
      },
      environmentFit: {
        status: "matched",
        matched: true,
        generationAligned: true,
        marketEnvironmentKnown: true,
        activePathMatched: true,
        themeMatched: true,
        evidence: ["大周期=震荡", "持续赚钱效应路径=boardEmotion", "当前题材交集=科技"],
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
        activePaths: ["boardEmotion"],
        dominantPaths: ["boardEmotion"],
        matchedPaths: ["boardEmotion"],
        primaryPath: "boardEmotion",
      },
      marketCapFit: {
        status: "confirmed_match",
        gateApplied: true,
        bucketKey: "100_300",
        bucketLabel: "100-300亿",
        preferredBucketKeys: ["100_300"],
      },
      opportunityDataCompleteness: {
        version: 1,
        status: "complete",
        qualified: true,
        opportunityEligible: true,
        tradingDate: payload.tradingDate,
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
      },
      executionFeasibility: {
        version: 1,
        authority: "unified_execution_feasibility_v1",
        status: "conditional",
        executableNow: false,
        canGrantExecution: false,
        onlyTightens: true,
      },
      observationOnly: true,
      executable: false,
      executionAuthority: false,
      missingConditions: ["等待分时承接"],
      postEntryNextDayExpectation: {
        version: 1,
        status: "conditional",
        horizon: "entry_t_plus_1",
        premise: "仅在明日确认条件满足后假设参与",
        key: "board_premium",
        label: "核心溢价 / 晋级验证",
        riskLabel: "分歧兑现或高标负反馈",
        entryCondition: "充分换手后回封",
        invalidation: "回封失败",
        basis: "连板核心充分换手回封",
        pathStage: "active",
        probability: null,
        calibrated: false,
        observationOnly: true,
        executionAuthority: false,
      },
      entryConfirmation: {
        version: 1,
        status: "waiting_trigger",
        type: "reseal_board",
        label: "充分换手后的回封板",
        reason: "等待真实分歧与充分换手回封",
        avoid: "无换手秒板不算确认",
        triggerConditions: ["充分换手后回封"],
        invalidation: "回封失败",
        activated: false,
        observationOnly: true,
        executionAuthority: false,
      },
    }],
  };
  payload.premarketModels = {
    ...(payload.premarketModels || {}),
    tradingStylePreference: {
      ...((payload.premarketModels && payload.premarketModels.tradingStylePreference) || {}),
      paths: {
        boardEmotion: { stage: "active" },
      },
    },
  };

  const model = sandbox.buildDirectDecisionSummary(payload, {});
  assert.equal(model.opportunity.available, true);
  assert.equal(model.opportunity.noTrade, false);
  assert.equal(model.candidates.length, 1);
  assert.equal(model.opportunity.directions[0].tradeCandidates.length, 1);
  const html = sandbox.renderDecisionDirectSummary(model);
  assert.match(html, /1个方向，继续观察概率变化/);
  assert.match(html, /机会观察 · 等待交易条件/);
  assert.match(html, /data-focus-source="unifiedDecisionChain\.observationCandidates"/);
  assert.doesNotMatch(html, /002156|通富微电/);
  assert.equal((html.match(/<div class="is-buy">/g) || []).length, 0);
  assert.doesNotMatch(html, /direct-ticket-card|明日交易计划|明日可执行方案/);
});

test("chain情绪阶段与T-1优先，旧coreEmotion只保留两类观察证据", () => {
  const payload = fixture();
  payload.marketEmotion.lightLabel = "旧黄灯";
  payload.marketEmotion.quality = "旧高潮";
  payload.tomorrowDecision = {
    version: 3,
    generationId: "2026-08-12:canonical-new",
    tradingDate: "2026-08-12",
    asOf: "2026-08-12T07:18:26.000Z",
    verdict: "wait",
    market: {
      cycle: "主升",
      cycleKey: "main_rise",
      corePhase: "高潮",
      corePhaseKey: "climax",
      divergenceQuality: "benign",
    },
    direction: { status: "cash", name: "等待" },
    candidates: [],
    integrity: { ok: true, blockedCandidates: [] },
    coreEmotion: {
      generationId: "2026-08-12:canonical-new",
      emotionCycle: {
        previous: {
          available: true,
          key: "climax",
          label: "高潮",
          tradingDate: "2026-08-11",
          authority: "canonical_exact_closing_replay",
        },
        current: { key: "divergence", label: "分歧" },
        metrics: { support: { confirmedAnchorCount: 3 }, damage: { harmfulAnchorCount: 0 } },
        anchorLayers: {
          A: [
            {
              code: "600721",
              name: "百花医药",
              direction: "医药",
              anchorRole: "height",
              anchorRoleLabel: "高度核心",
              current: { oneWord: true, limitUp: true },
              board: { label: "6天6板" },
              priceDiscovery: { type: "one_word", trusted: true },
            },
            {
              code: "600664",
              name: "哈药股份",
              direction: "医药",
              anchorRole: "leader",
              anchorRoleLabel: "方向龙头",
              stage: "divergence",
              priceDiscovery: { type: "active_price_discovery", trusted: true, dataQuality: "trusted" },
              support: { status: "mixed", breakdown: { turnoverReseal: { verified: true } } },
              eventConfirmation: { confirmed: true, limitOpenCount: 3, tailReseal: true },
            },
            {
              code: "001258",
              name: "立新能源",
              direction: "绿色电力",
              anchorRole: "popular_core",
              anchorRoleLabel: "人气核心",
              stage: "supported",
              priceDiscovery: { type: "active_price_discovery", trusted: true, dataQuality: "trusted" },
              support: { status: "supported", breakdown: { turnoverReseal: { verified: true } } },
              eventConfirmation: { confirmed: true, lowPct: -8.2, tailReseal: true },
            },
          ],
          B: [{
            code: "000636",
            name: "风华高科",
            direction: "MLCC",
            anchorRole: "capacity",
            anchorRoleLabel: "趋势核心",
            stage: "divergence",
            priceDiscovery: { type: "active_price_discovery", trusted: true, dataQuality: "trusted" },
            damage: { status: "harmful", evidence: ["触板后未回封"] },
            eventConfirmation: { confirmed: false, limitOpenCount: 7, tailReseal: true },
          }],
        },
      },
    },
  };

  const model = sandbox.buildDirectDecisionSummary(payload, {});
  assert.equal(model.state.cycle, "主升");
  assert.equal(model.state.corePhase, "高潮后分歧");
  assert.equal(model.state.divergenceQuality, "承接尚在，暂偏良性");
  assert.equal(model.state.generationId, "2026-08-12:canonical-new");
  assert.equal(model.state.version, 3);
  assert.deepEqual(Array.from(model.state.heightConsensus, (item) => item.name), ["百花医药"]);
  assert.deepEqual(Array.from(model.state.tradableCoreEvidence, (item) => item.event), [
    "高位换手分歧",
    "深水分歧后回封",
    "趋势核心冲板分歧",
  ]);

  const html = sandbox.renderDecisionDirectSummary(model);
  assert.match(html, /阶段、强度、质量分开判定[\s\S]*<strong>分歧<\/strong>/);
  assert.match(html, /分歧强度：[\s\S]*分歧质量：[\s\S]*承接状态：/);
  assert.match(html, /T-1权威情绪[\s\S]*中等分歧[\s\S]*2026-08-20[\s\S]*同引擎权威回放/);
  assert.match(html, /分歧质量[\s\S]*承接尚在，暂偏良性/);
  assert.match(html, /高度与一致度[\s\S]*百花医药/);
  assert.match(html, /换手核心观察证据[\s\S]*哈药股份[\s\S]*立新能源[\s\S]*风华高科/);
  assert.doesNotMatch(html, /可参与核心证据/);
  assert.match(html, /高位换手分歧/);
  assert.match(html, /趋势核心冲板分歧/);
  assert.match(html, /深水分歧后回封/);
  assert.match(html, /炸板3次/);
  assert.match(html, /尾盘回封/);
  assert.doesNotMatch(html, /炸板7次/);
  assert.doesNotMatch(html, /旧高潮|旧黄灯/);
  assert.match(html, /数据时间/);
  assert.match(html, /决策 v3/);
  assert.match(html, /2026-08-12:canonical-new/);
});

test("刷新generation时正式阶段始终走chain，错代情绪证据不得沿用", () => {
  const firstPayload = fixture();
  firstPayload.tomorrowDecision = {
    version: 2,
    generationId: "old-generation",
    asOf: "2026-08-11T07:00:00.000Z",
    market: { cycle: "主升", corePhase: "高潮" },
    direction: { status: "cash" },
    candidates: [],
  };
  const firstHtml = sandbox.renderDecisionDirectSummary(sandbox.buildDirectDecisionSummary(firstPayload, {}));
  assert.doesNotMatch(firstHtml, />高潮</);
  assert.match(firstHtml, /情绪阶段[\s\S]*<strong>分歧<\/strong>/);

  const refreshedPayload = fixture();
  refreshedPayload.tomorrowDecision = {
    version: 3,
    generationId: "new-generation",
    asOf: "2026-08-12T07:30:00.000Z",
    market: { cycle: "主升" },
    direction: { status: "cash" },
    candidates: [],
    coreEmotion: {
      generationId: "old-generation",
      emotionCycle: {
        current: { key: "climax", label: "高潮" },
        anchorLayers: { A: [{ code: "600721", name: "旧高标", current: { oneWord: true } }] },
      },
    },
  };
  const refreshed = sandbox.buildDirectDecisionSummary(refreshedPayload, {});
  const refreshedHtml = sandbox.renderDecisionDirectSummary(refreshed);
  assert.equal(refreshed.state.corePhase, "分歧");
  assert.equal(refreshed.state.generationId, "new-generation");
  assert.equal(refreshed.state.heightConsensus.length, 0);
  assert.doesNotMatch(refreshedHtml, /旧高标|old-generation|>高潮</);
  assert.match(refreshedHtml, /new-generation/);
  const renderSource = extractFunction(scriptSource, "renderMarketStrengthSource");
  assert.match(renderSource, /resolveUnifiedDecisionChainProjection\(payload\)/);
  assert.match(renderSource, /node\.dataset\.source = "unified-decision-chain-v3"/);
  assert.match(renderSource, /node\.dataset\.generation = summary\.state/);
});

test("旧高热与高潮字段只作观察证据，不覆盖chain情绪阶段", () => {
  const payload = fixture();
  payload.tomorrowDecision = {
    version: 3,
    generationId: "2026-08-12:post-heat",
    tradingDate: "2026-08-12",
    asOf: "2026-08-12T07:35:00.000Z",
    verdict: "wait",
    market: { cycle: "主升", corePhase: "高潮", corePhaseKey: "climax" },
    direction: { status: "cash", name: "等待" },
    candidates: [],
    integrity: { ok: true, blockedCandidates: [] },
    coreEmotion: {
      generationId: "2026-08-12:post-heat",
      emotionCycle: {
        previous: {
          available: true,
          key: "acceleration",
          participatoryPhase: { key: "acceleration", label: "加速" },
          consensusPhase: { key: "climax", label: "高度一致" },
        },
        current: {
          key: "realization",
          legacyKey: "realization",
          phaseKey: "post_heat_divergence",
          label: "高热后分歧",
          qualityKey: "support_intact",
          qualityLabel: "暂偏良性",
        },
        phaseQuality: { key: "support_intact", label: "暂偏良性" },
        participation: { divergentAnchorCount: 11, supportedDivergenceCount: 8 },
        metrics: {
          support: { confirmedAnchorCount: 8 },
          damage: { harmfulAnchorCount: 1 },
        },
        anchorLayers: {
          A: [{
            code: "001258",
            name: "立新能源",
            direction: "绿色电力",
            anchorRole: "popular_core",
            anchorRoleLabel: "人气核心",
            priceDiscovery: {
              type: "turnover_limit",
              trusted: true,
              source: "trusted_current_closing_path_proxy",
              sessionGranularity: "closing_path_proxy",
              eventEvidenceEligible: false,
            },
            participation: {
              individualState: "local_repair",
              divergence: true,
              supportIntact: true,
              facts: { recoveryPct: 19.5, limitOpenCount: null, resealed: false },
            },
            support: {
              status: "mixed",
              breakdown: {
                turnoverReseal: { verified: false },
                closingStrength: { changePct: 10 },
                recovery: { valuePct: 19.5 },
              },
            },
          }],
          B: [],
        },
      },
    },
  };

  const model = sandbox.buildDirectDecisionSummary(payload, {});
  const html = sandbox.renderDecisionDirectSummary(model);
  assert.equal(model.state.corePhase, "高潮后分歧");
  assert.equal(model.state.emotionStage, "分歧");
  assert.equal(model.state.divergenceQuality, "承接尚在，暂偏良性");
  assert.equal(model.state.tradableCoreEvidence[0].event, "深水分歧后收板");
  assert.match(model.state.tradableCoreEvidence[0].detail, /收盘OHLC路径已确认/);
  assert.match(html, /阶段、强度、质量分开判定[\s\S]*<strong>分歧<\/strong>/);
  assert.doesNotMatch(html, /阶段、强度、质量分开判定[\s\S]*>高潮<|>高热后分歧</);
  assert.doesNotMatch(html, /当日分时已确认|尾盘回封|炸板\d+次/);
});

test("unifiedQuantFactors只能作因子观察，不能接管chain周期与情绪展示", () => {
  const payload = fixture();
  const generationId = "2026-08-21:cloud-old-with-local-v4";
  payload.tomorrowDecision = {
    version: 1,
    generationId,
    tradingDate: "2026-08-21",
    asOf: "2026-08-21T15:04:12.842Z",
    verdict: "wait",
    market: {
      cycle: "修复",
      phaseDetail: { emotionStage: { key: "harmful", label: "非良性分歧" } },
    },
    direction: { status: "cash", name: "等待" },
    candidates: [],
  };
  payload.unifiedQuantFactors = {
    version: 4,
    generation: { generationId },
    marketStage: {
      bigCycle: { key: "range", label: "震荡", status: "canonical" },
      transition: { key: "none", label: "无周期切换", status: "not_active" },
      smallCycle: { key: "range", label: "震荡", status: "observed" },
      emotionStage: {
        key: "retreat",
        label: "大分歧·退潮确认",
        status: "observed",
        divergenceIntensity: { key: "large", label: "大分歧" },
        divergenceQuality: { key: "non_benign", label: "非良性" },
        supportState: { key: "weak", label: "承接弱" },
      },
      previousEmotionStage: {
        available: true,
        key: "harmful",
        label: "中等分歧",
        tradingDate: "2026-08-20",
        authority: "canonical_exact_closing_replay",
      },
    },
  };

  const model = sandbox.buildDirectDecisionSummary(payload, {});
  const html = sandbox.renderDecisionDirectSummary(model);
  assert.equal(model.state.bigCycle, "震荡");
  assert.equal(model.state.smallCycle, "震荡");
  assert.equal(model.state.emotionStage, "非良性分歧");
  assert.equal(model.state.divergenceIntensity, "待确认");
  assert.equal(model.state.divergenceQuality, "待确认");
  assert.equal(model.state.supportState, "待确认");
  assert.equal(model.state.previousEmotionStage, "中等分歧");
  assert.equal(model.candidates.length, 0);
  assert.match(html, /情绪大周期[\s\S]*震荡/);
  assert.match(html, /T-1权威情绪[\s\S]*中等分歧[\s\S]*同引擎权威回放/);
  assert.doesNotMatch(html, /大分歧·退潮确认/);
});

test("三轴阶段在明日决策并列展示，主升内强分歧不得再渲染成主升加速", () => {
  const payload = fixture();
  const generationId = "2026-08-13:three-axis";
  payload.tomorrowDecision = {
    version: 3,
    generationId,
    tradingDate: "2026-08-13",
    asOf: "2026-08-13T18:54:14.262Z",
    verdict: "wait",
    summary: "分歧延续优先，先验证承接",
    market: {
      cycle: "主升",
      corePhase: "强分歧",
      corePhaseKey: "strong_divergence",
      phaseDetail: {
        structuralCycle: "主升",
        mediumStructure: { key: "repair_candidate", label: "中期修复·主升候选" },
        indexShortStructure: { windowDays: 5, key: "main_rise", label: "全市场短线主升段", status: "observed" },
        dailyRhythm: { key: "mixed_divergence", label: "强分歧", status: "observed" },
        indexSubPhase: { key: "main_rise_strong_divergence", label: "主升内强分歧", structureIntact: true, intensity: "strong" },
        emotionStage: { key: "strong_divergence", label: "强分歧" },
        tomorrowBaseline: { key: "divergence_continuation", label: "分歧延续优先", status: "baseline_unconfirmed", rank: 1, probability: null, calibrated: false },
        selectionPolicy: { mode: "conditional_after_support", label: "只在真实承接出现后参与" },
      },
    },
    tomorrowBaseline: { key: "divergence_continuation", label: "分歧延续优先", status: "baseline_unconfirmed", rank: 1, probability: null, calibrated: false },
    direction: { status: "cash", name: "等待承接" },
    candidates: [],
    integrity: { ok: true, blockedCandidates: [] },
    coreEmotion: {
      generationId,
      emotionCycle: {
        current: { key: "realization", phaseKey: "strong_divergence", label: "强分歧", qualityKey: "support_weak" },
        anchorLayers: { A: [], B: [] },
      },
    },
  };
  payload.unifiedDecisionChain.marketStage.smallCycle = {
    key: "main_rise_strong_divergence",
    label: "主升内强分歧",
    status: "observed",
  };

  const model = sandbox.buildDirectDecisionSummary(payload, {});
  const html = sandbox.renderDecisionDirectSummary(model);
  assert.equal(model.todayTitle, "主升 · 主升内强分歧 · 情绪强分歧");
  assert.equal(model.state.cycle, "主升");
  assert.equal(model.state.indexSubPhase, "主升内强分歧");
  assert.equal(model.state.corePhase, "强分歧");
  assert.equal(model.state.emotionStageStatus, "observed");
  assert.equal(model.state.strictEmotionStageStatus, "unavailable");
  assert.equal(model.state.mediumStructure, "中期修复·主升候选");
  assert.equal(model.state.indexShortStructure, "全市场短线主升段");
  assert.equal(model.state.dailyRhythm, "强分歧");
  assert.equal(model.tomorrowBaseline.label, "分歧延续优先");
  assert.equal(model.tomorrowBaseline.probability, null);
  assert.equal(model.tomorrowBaseline.calibrated, false);
  assert.match(html, /情绪大周期[\s\S]*主升/);
  assert.match(html, /指数5日结构[\s\S]*全市场短线主升段/);
  assert.doesNotMatch(html, /指数10日结构/);
  assert.match(html, /结构细分[\s\S]*主升内强分歧/);
  assert.match(html, /情绪阶段[\s\S]*强分歧/);
  assert.match(html, /节奏观察 · 严格核心待确认/);
  assert.doesNotMatch(html, /严格核心确认/);
  assert.match(html, /明日基准[\s\S]*分歧延续优先/);
  assert.doesNotMatch(html, /主升\s*·\s*加速/);

  payload.tomorrowDecision.market.phaseDetail.indexShortStructure = {
    key: "main_rise",
    label: "全市场10日短周期主升",
    status: "observed",
  };
  payload.unifiedDecisionChain.marketStage.smallCycle.indexStructure = {
    key: "main_rise",
    label: "全市场10日短周期主升",
  };
  const legacyModel = sandbox.buildDirectDecisionSummary(payload, {});
  assert.equal(legacyModel.state.indexShortStructure, "指数5日结构待确认");
});

test("明日决策展示大小周期、观察情绪和带状态的炒作偏好", () => {
  const payload = fixture();
  const generationId = "2026-08-20:2026-08-20T15:00:00+08:00";
  payload.tomorrowDecision = {
    version: 3,
    generationId,
    tradingDate: "2026-08-20",
    asOf: "2026-08-20T15:00:00+08:00",
    verdict: "wait",
    summary: "震荡分歧，先观察承接",
    market: {
      cycle: "震荡",
      corePhase: "情绪阶段待确认",
      corePhaseKey: "unavailable",
      marketCapCarrier: {
        key: "low_liquidity",
        label: "25000亿以下市场",
        status: "observed",
        carrierLabel: "观察50-300亿核心，300-500亿为容量上沿",
        marketAmountYi: 18792.64,
        breadthPct: 47.7,
        avgIndexChange: 0.78,
        reason: "成交低于25000亿，只作中小市值载体观察。",
        confirmation: ["次日溢价继续由同区间贡献"],
        observationOnly: true,
        calibrated: false,
      },
      phaseDetail: {
        structuralCycle: "震荡",
        mediumStructure: { key: "range", label: "中期震荡" },
        indexSubPhase: { key: "structure_pending", label: "细分阶段待确认" },
        emotionStage: { key: "unavailable", label: "情绪阶段待确认" },
        tomorrowBaseline: { key: "observe", label: "次日承接确认", status: "baseline_unconfirmed", probability: null, calibrated: false },
        decisionContext: {
          generationId,
          bigCycle: { key: "range", label: "震荡", status: "canonical", reason: "中期结构仍属于震荡" },
          transition: { key: "ice_rebound", label: "冰点反弹观察", status: "observed", reason: "极端亏钱效应后的修复只作过渡观察" },
        smallCycle: { key: "range_divergence", label: "震荡分歧", status: "observed", reason: "5日结构震荡、当日节奏转弱" },
          emotionStage: { key: "divergence_observed", label: "分歧", status: "observed", reason: "严格核心待确认" },
          speculationPreference: {
            conclusionStatus: "confirmed",
            labels: ["低位", "连板", "趋势", "补涨", "低位"],
            confirmedLabels: ["低位"],
            items: [
              { key: "lowLaunch", label: "低位", status: "confirmed", score: 81 },
              { key: "boardEmotion", label: "连板", status: "observed", score: 58.9 },
              { key: "highTrend", label: "趋势", status: "observed", score: 73 },
              { key: "catchup", label: "补涨", status: "observed", count: 1 },
            ],
            gaps: ["连板规则分未达确认线（当前58.9分）", "趋势核心结构未确认"],
            confirmationConditions: ["连板规则分达到确认线", "趋势形成可核验的核心结构"],
            observationOnly: true,
            reason: "核心龙头高位滞涨，板块热度仍在；<script>不得执行</script>",
          },
        },
      },
    },
    tomorrowBaseline: { key: "observe", label: "次日承接确认", status: "baseline_unconfirmed", probability: null, calibrated: false },
    direction: { status: "cash", name: "等待承接" },
    candidates: [],
    integrity: { ok: true, blockedCandidates: [] },
    coreEmotion: {
      generationId,
      emotionCycle: { current: { key: "unavailable", label: "情绪阶段待确认" }, anchorLayers: { A: [], B: [] } },
    },
  };

  const model = sandbox.buildDirectDecisionSummary(payload, {});
  const html = sandbox.renderDecisionDirectSummary(model);
  assert.equal(model.todayTitle, "震荡 · 过渡冰点反弹观察 · 震荡分歧 · 情绪分歧");
  assert.equal(model.state.cycle, "震荡");
  assert.equal(model.state.bigCycle, "震荡");
  assert.equal(model.state.transition, "冰点反弹观察");
  assert.equal(model.state.smallCycle, "震荡分歧");
  assert.equal(model.state.emotionStage, "分歧");
  assert.deepEqual(Array.from(model.state.tradingPreference), ["低位", "连板", "趋势", "补涨"]);
  assert.deepEqual(Array.from(model.state.confirmedTradingPreference), ["低位"]);
  assert.equal(model.state.preferenceStatus, "confirmed");
  assert.equal(model.state.marketCapCarrier.key, "low_liquidity");
  assert.equal(model.state.marketCapCarrier.observationOnly, true);
  assert.deepEqual(Array.from(model.state.preferenceGaps), ["连板规则分未达确认线（当前58.9分）", "趋势核心结构未确认"]);
  assert.match(html, /情绪大周期[\s\S]*震荡/);
  assert.match(html, /过渡节点[\s\S]*冰点反弹观察/);
  assert.match(html, /data-stage-summary="small-cycle"[\s\S]*震荡分歧/);
  assert.match(html, /情绪阶段[\s\S]*分歧[\s\S]*严格核心待确认/);
  assert.match(html, /当下炒作偏好[\s\S]*低位[\s\S]*连板[\s\S]*趋势[\s\S]*补涨/);
  assert.match(html, /低位<small>主导 · 81分<\/small>/);
  assert.match(html, /连板<small>观察 · 58\.9分<\/small>/);
  assert.match(html, /补涨<small>观察 · 1只<\/small>/);
  assert.match(html, /偏好原因[\s\S]*核心龙头高位滞涨/);
  assert.match(html, /仍待确认[\s\S]*连板规则分未达确认线/);
  assert.match(html, /确认条件[\s\S]*趋势形成可核验的核心结构/);
  assert.match(html, /动态市值赚钱效应[\s\S]*只约束机会候选 · 不打开交易权限 · 未历史校准/);
  assert.match(html, /25000亿以下市场<small>仅软提示<\/small>/);
  assert.match(html, /两市18792\.64亿[\s\S]*上涨占比47\.7%[\s\S]*指数均值\+0\.78%/);
  assert.match(html, /观察50-300亿核心，300-500亿为容量上沿/);
  assert.doesNotMatch(html, /<script>不得执行<\/script>/);
  assert.match(html, /&lt;script&gt;不得执行&lt;\/script&gt;/);
  const compactStageOrder = ["big-cycle", "transition", "small-cycle", "index-short-structure", "emotion"]
    .map((key) => html.indexOf(`data-stage-summary="${key}"`));
  assert.equal(compactStageOrder.every((index) => index >= 0), true);
  assert.deepEqual(compactStageOrder, compactStageOrder.slice().sort((left, right) => left - right));
  assert.doesNotMatch(html, /<h3>震荡 · 过渡冰点反弹观察/);

  payload.tomorrowDecision.market.phaseDetail.decisionContext.generationId = "2026-08-19:old";
  const mismatched = sandbox.buildDirectDecisionSummary(payload, {});
  const mismatchedHtml = sandbox.renderDecisionDirectSummary(mismatched);
  assert.equal(mismatched.state.bigCycle, "震荡");
  assert.equal(mismatched.state.smallCycle, "震荡分歧");
  assert.deepEqual(Array.from(mismatched.state.tradingPreference), []);
  assert.match(mismatched.state.preferenceReason, /不是同一代/);
  assert.match(mismatchedHtml, /本代偏好结论未生成/);
  assert.match(mismatchedHtml, /未确认原因[\s\S]*不是同一代/);
  assert.match(mismatchedHtml, /确认条件[\s\S]*同代的全市场资金路径与题材角色数据/);
  assert.doesNotMatch(mismatchedHtml, /偏好待确认/);
});

test("明日三路径占比图必须与大小周期五项详情并存", () => {
  const payload = fixture();
  payload.tomorrowDecision = {
    version: 3,
    verdict: "wait",
    primaryScenarioKey: "range_divergence",
    confidence: { score: 55, label: "低置信", method: "rule_prior", calibrated: false },
    scenarios: [
      { key: "strengthen", label: "加强", probability: 25 },
      { key: "range_divergence", label: "震荡分化", probability: 55 },
      { key: "weaken", label: "减弱", probability: 20 },
    ],
    market: {
      cycle: "主升",
      corePhase: "强分歧",
      phaseDetail: {
        structuralCycle: "主升",
        mediumStructure: { key: "repair_candidate", label: "中期修复·主升候选" },
        indexSubPhase: { key: "main_rise_strong_divergence", label: "主升内强分歧" },
        emotionStage: { key: "strong_divergence", label: "强分歧" },
        tomorrowBaseline: {
          key: "divergence_continuation",
          label: "分歧延续优先",
          status: "baseline_unconfirmed",
          probability: null,
          calibrated: false,
        },
      },
    },
    direction: { status: "cash", name: "等待承接" },
    candidates: [],
    integrity: { ok: true, blockedCandidates: [] },
  };

  const model = sandbox.buildDirectDecisionSummary(payload, {});
  const html = sandbox.renderDecisionDirectSummary(model);

  assert.equal(model.forecast.available, true);
  assert.match(html, /class="direct-probability-grid"/);
  assert.match(html, /加强[\s\S]*25%[\s\S]*style="width:25%"/);
  assert.match(html, /震荡分化[\s\S]*55%[\s\S]*style="width:55%"/);
  assert.match(html, /减弱[\s\S]*20%[\s\S]*style="width:20%"/);
  assert.match(html, /class="direct-state-grid"/);
  assert.deepEqual(
    Array.from(html.matchAll(/data-state-card="([^"]+)"/g), (match) => match[1]),
    ["structure-detail", "emotion-stage", "t1-authoritative-emotion"],
  );
  assert.match(html, /情绪大周期[\s\S]*主升/);
  assert.match(html, /结构细分[\s\S]*主升内强分歧/);
  assert.match(html, /情绪阶段[\s\S]*强分歧/);
  assert.match(html, /明日基准[\s\S]*分歧延续优先/);
});

test("观察层分歧不能掩盖严格阶段证据缺口，风险默认必须说明缺哪类证据", () => {
  const payload = fixture();
  const generationId = "2026-08-20:observed-with-strict-gap";
  const decisionContext = {
    generationId,
    bigCycle: { key: "range", label: "震荡", status: "canonical" },
    transition: { key: "ice_rebound", label: "冰点反弹观察", status: "observed" },
    smallCycle: { key: "range_divergence", label: "震荡分歧", status: "observed" },
    emotionStage: { key: "divergence_observed", label: "分歧", status: "observed", reason: "只作节奏观察" },
    speculationPreference: {
      conclusionStatus: "confirmed",
      labels: ["低位"],
      confirmedLabels: ["低位"],
      items: [{ key: "lowLaunch", label: "低位", status: "confirmed", score: 81 }],
      gaps: [],
      confirmationConditions: [],
      reason: "低位启动为确认主导。",
      observationOnly: true,
    },
  };
  const riskBaseline = {
    key: "evidence_insufficient_defensive_observe",
    label: "证据不足·防守观察",
    status: "risk_default",
    riskDefault: true,
    probability: null,
    calibrated: false,
    action: "暂不新开仓",
    checkpoints: ["09:25", "09:35"],
    reason: "缺少可用的精确T-1收盘状态，无法确认严格情绪阶段",
  };
  payload.tomorrowDecision = {
    version: 3,
    generationId,
    tradingDate: "2026-08-20",
    asOf: "2026-08-20T15:00:00+08:00",
    verdict: "wait",
    market: {
      cycle: "震荡",
      corePhase: "情绪阶段待确认",
      phaseDetail: {
        structuralCycle: "震荡",
        mediumStructure: { key: "range", label: "中期震荡", confirmed: true },
        indexSubPhase: { key: "range_structure", label: "震荡结构·暂无主升细分" },
        emotionStage: {
          key: "unavailable",
          label: "情绪阶段待确认",
          reason: "缺少可用的精确T-1收盘状态，无法确认情绪阶段",
        },
        tomorrowBaseline: riskBaseline,
        decisionContext,
      },
    },
    tomorrowBaseline: riskBaseline,
    permission: { status: "blocked", canActivate: false, checkpoints: ["09:25", "09:35"] },
    direction: { status: "cash", name: "等待证据补足" },
    candidates: [],
    integrity: { ok: true, blockedCandidates: [] },
    coreEmotion: {
      generationId,
      emotionCycle: {
        current: { key: "unknown", label: "情绪阶段待确认", reason: "缺少精确T-1状态，且当前样本尚不足以确认新阶段" },
        previous: { source: "exact_t1_state_missing" },
        dataQuality: { reasonCodes: ["current_strict_core_insufficient"] },
        anchorLayers: { A: [], B: [] },
      },
    },
    emotionCoreEvidence: {
      status: "unavailable",
      transition: { expectedPreviousTradingDate: "2026-08-19" },
      summary: { strictCoreCount: 0, heightRiskBarometerCount: 12 },
      emotionStagePath: {
        dataQuality: { reasonCodes: ["exact_t1_closing_unavailable", "current_strict_core_insufficient"] },
        gaps: ["缺少 exact T-1 收盘严格核心证据", "今日严格核心不足，不能确认今日阶段"],
      },
    },
  };

  const model = sandbox.buildDirectDecisionSummary(payload, {});
  const html = sandbox.renderDecisionDirectSummary(model);

  assert.equal(model.state.emotionStage, "分歧");
  assert.equal(model.state.emotionStageStatus, "observed");
  assert.equal(model.state.strictEmotionStageStatus, "unavailable");
  assert.equal(model.tomorrowBaseline.label, "严格情绪阶段待确认·防守观察");
  assert.deepEqual(Array.from(model.tomorrowBaseline.evidenceGaps), [
    "缺少2026-08-19精确T-1严格核心收盘证据",
    "今日通过身份与同代校验的严格情绪核心为0只，无法形成阶段投票",
  ]);
  assert.match(html, /情绪阶段[\s\S]*分歧[\s\S]*节奏观察/);
  assert.match(html, /缺少什么[\s\S]*缺少2026-08-19精确T-1严格核心收盘证据/);
  assert.match(html, /为何不能补位[\s\S]*12只高位负反馈观察票投票权重为0[\s\S]*非机会、非推荐/);
  assert.match(html, /严格情绪阶段为何未确认/);
});

test("旧快照节奏闸门只能作为观察证据，不能收紧chain正式授权", async (t) => {
  const cases = [
    ["allowNew=false", (payload) => { payload.market.state.tradeWindow = { allowNew: false }; }],
    ["hardBlockNewEntry=true", (payload) => { payload.market.state.hardBlockNewEntry = true; }],
    ["executionAllowed=false", (payload) => { payload.market.state.executionAllowed = false; }],
    ["tradeDisabled=true", (payload) => { payload.bestPicks.tradeDisabled = true; }],
    ["available=false", (payload) => { payload.bestPicks.available = false; }],
    ["positionLimit=0%", (payload) => { payload.marketEmotion.review.tomorrow.positionLimit = "0%"; }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const payload = fixture();
      mutate(payload);
      const model = sandbox.buildDirectDecisionSummary(payload, {});
      assert.deepEqual(Array.from(model.candidates, (item) => item.code), ["300476"]);
      assert.equal(model.permission, "初始10% · 上限30%");
      assert.equal(payload.unifiedDecisionChain.authorization.tradePermission.allowNew, true);
    });
  }
});

test("严格情绪核心与高度风险风向标必须分池并把汇总落实到具体股票", () => {
  const payload = fixture();
  const generationId = "2026-08-14:strict-core-evidence";
  const evidenceMeta = { generationId, tradingDate: "2026-08-14", asOf: "2026-08-14T15:42:44.984Z", contractVersion: 2 };
  payload.tomorrowDecision = {
    version: 3,
    generationId,
    tradingDate: "2026-08-14",
    asOf: "2026-08-14T15:42:44.984Z",
    verdict: "wait",
    market: {
      cycle: "主升",
      corePhase: "强分歧",
      phaseDetail: {
        structuralCycle: "主升",
        indexSubPhase: { key: "main_rise_strong_divergence", label: "主升内强分歧" },
        emotionStage: { key: "strong_divergence", label: "强分歧" },
        tomorrowBaseline: { key: "divergence_continuation", label: "分歧延续优先", status: "baseline_unconfirmed", probability: null, calibrated: false },
      },
    },
    direction: { status: "cash", name: "等待承接" },
    candidates: [],
    integrity: { ok: true, blockedCandidates: [] },
    emotionCoreEvidence: {
      version: 2,
      contractVersion: 2,
      status: "ready",
      generationId,
      tradingDate: "2026-08-14",
      asOf: "2026-08-14T15:42:44.984Z",
      generation: { id: generationId, generationId, tradingDate: "2026-08-14", asOf: "2026-08-14T15:42:44.984Z" },
      themeCycles: [
        {
          theme: { ...evidenceMeta, fineThemeName: "创新药", parentThemeName: "医药", relatedOnly: false },
          cycle: { ...evidenceMeta, label: "创新药·retained", state: "retained" },
          strictEmotionCores: [{ ...evidenceMeta, code: "600001", name: "核心甲" }, { ...evidenceMeta, code: "600002", name: "核心乙" }, { ...evidenceMeta, code: "600005", name: "核心戊" }, { ...evidenceMeta, code: "600006", name: "核心己" }],
          coreCandidates: [],
          heightRiskBarometers: [],
        },
        {
          theme: { ...evidenceMeta, fineThemeName: "不得展示的关联题材", parentThemeName: "风险关联", relatedOnly: true },
          cycle: { ...evidenceMeta, label: "风险观察" },
          strictEmotionCores: [],
          coreCandidates: [],
          heightRiskBarometers: [{ ...evidenceMeta, code: "600004", name: "高度风险丁" }],
        },
      ],
      transition: {
        status: "ready",
        sameVersion: true,
        expectedPreviousTradingDate: "2026-08-13",
        previous: { label: "分歧", tradingDate: "2026-08-13", contractVersion: 2, snapshotKind: "closing", completed: true },
        current: { label: "分歧延续", tradingDate: "2026-08-14", contractVersion: 2, snapshotKind: "closing", completed: true },
      },
      strictEmotionCores: [
        { ...evidenceMeta, code: "600001", name: "核心甲", rank: "primary", currentState: "divergence", theme: { fineThemeName: "创新药", parentThemeName: "医药" }, supportScore: 18, damageScore: 46, evidence: ["周期内连续聚焦", "当日分歧"], source: "cycle_identity", contractAsOf: evidenceMeta.asOf, dataQuality: "closing_verified" },
        { ...evidenceMeta, code: "600002", name: "核心乙", rank: "secondary", currentState: "divergence", theme: { fineThemeName: "创新药", parentThemeName: "医药" }, supportScore: 22, damageScore: 41, evidence: ["跨票影响已验证"], source: "cross_stock_impact", identity: { source: "theme_cycle_leadership", asOf: "2026-08-14T15:30:00.000Z" }, session: { source: "trusted_current_closing_path_proxy", asOf: "2026-08-14T15:40:00.000Z" }, contractAsOf: evidenceMeta.asOf, identitySourceAsOf: "2026-08-14T15:30:00.000Z", sessionSourceAsOf: "2026-08-14T15:40:00.000Z", dataQuality: "closing_verified" },
        { ...evidenceMeta, code: "600003", name: "核心丙", rank: "secondary", currentState: "supported", theme: { fineThemeName: "CPO", parentThemeName: "AI硬件" }, supportScore: 61, damageScore: 17, evidence: ["分歧后承接尚在"], source: "cycle_identity", contractAsOf: evidenceMeta.asOf, dataQuality: "closing_verified" },
        { ...evidenceMeta, code: "600005", name: "核心戊", rank: "secondary", currentState: "repair_failed", theme: { fineThemeName: "创新药", parentThemeName: "医药" }, supportScore: 9, damageScore: 72, evidence: ["修复失败且负反馈扩散"], source: "cycle_identity", contractAsOf: evidenceMeta.asOf, dataQuality: "closing_verified" },
        { ...evidenceMeta, code: "600006", name: "核心己", rank: "secondary", currentState: "participating", theme: { fineThemeName: "创新药", parentThemeName: "医药" }, supportScore: 44, damageScore: 12, evidence: ["周期内平稳运行，尚未进入分歧或承接桶"], source: "cycle_identity", contractAsOf: evidenceMeta.asOf, dataQuality: "closing_verified" },
      ],
      heightRiskBarometers: [
        { ...evidenceMeta, code: "600004", name: "高度风险丁", currentState: "negative_feedback", theme: { fineThemeName: "创新药", parentThemeName: "医药" }, votingWeight: 0, evidence: ["仅代表高度负反馈"], source: "height_risk", contractAsOf: evidenceMeta.asOf, dataQuality: "closing_verified" },
      ],
      summary: {
        strictCoreCount: 5,
        divergent: { count: 2, codes: ["600001", "600002"] },
        supported: { count: 1, codes: ["600003"] },
        repairFailed: { count: 1, codes: ["600005"] },
        participating: { count: 1, codes: ["600006"] },
        riskBarometerCount: 1,
      },
      integrity: { poolsDisjoint: true, namedRowsBackSummary: true, sameGeneration: true, strictRowsQualifiedOnly: true, riskRowsCannotVote: true, strictCoreBasketMaxFive: true, scoreSummaryDerivedFromRows: true },
      guardrails: { emotionStageAuthority: false, executionAuthority: false, riskBarometerVoteEligible: false, riskCoreSelectionAuthority: false, strictCoreBasketMaximum: 5 },
    },
  };

  const evidence = payload.tomorrowDecision.emotionCoreEvidence;
  const influenceByCode = {
    "600001": [18, 46, "risk_core"],
    "600002": [22, 41, "risk_core"],
    "600003": [61, 17, "repair_core"],
    "600005": [9, 72, "risk_core"],
    "600006": [44, 12, "co_core"],
  };
  evidence.strictEmotionCores.forEach((row) => {
    const [positive, negative, role] = influenceByCode[row.code];
    Object.assign(row, {
      positiveInfluenceScore: positive,
      negativeInfluenceScore: negative,
      signedInfluenceScore: positive - negative,
      voteRole: role,
      riskPressureScore: role === "risk_core" ? Math.max(negative, 25) : 0,
      riskPressureConfirmed: row.currentState === "repair_failed",
      votingWeight: 1,
      selectionAuthority: false,
      executionAuthority: false,
      classification: { strictEmotionCore: true, heightRiskBarometer: false },
      qualification: { passed: true, authority: "theme_cycle_leadership", version: "strict-core-qualification-v2" },
      identity: { ...(row.identity || {}), authority: "theme_cycle_leadership" },
    });
  });
  evidence.heightRiskBarometers.forEach((row) => Object.assign(row, {
    positiveInfluenceScore: 0,
    negativeInfluenceScore: 0,
    signedInfluenceScore: 0,
    voteRole: "height_context",
    executionAuthority: false,
  }));
  evidence.summary.strictCandidateCount = 5;
  evidence.summary.selectedCoreCount = 5;
  evidence.summary.excludedByLimitCount = 0;
  evidence.summary.influence = {
    positiveTotal: 154,
    negativeTotal: 188,
    signedTotal: -34,
    positiveCount: 2,
    negativeCount: 3,
    neutralCount: 0,
    winner: "negative",
  };

  const model = sandbox.buildDirectDecisionSummary(payload, {});
  const html = sandbox.renderDecisionDirectSummary(model);

  assert.equal(model.state.emotionCoreEvidence.status, "ready");
  assert.match(html, /市场情绪核心（最多5只）/);
  assert.match(html, /2只分歧[\s\S]*核心甲[\s\S]*核心乙/);
  assert.match(html, /1只承接[\s\S]*核心丙/);
  assert.match(html, /1只修复失败[\s\S]*核心戊/);
  assert.match(html, /1只平稳运行[\s\S]*核心己/);
  assert.match(html, /高位负反馈观察（非机会）[\s\S]*仅用于观察负反馈[\s\S]*非推荐、非机会[\s\S]*投票权重0[\s\S]*高度风险丁[\s\S]*负反馈观察 · 非推荐/);
  assert.doesNotMatch(html, /正常参与|只看风险，不参与核心阶段投票/);
  assert.match(html, /创新药（医药）/);
  assert.match(html, /CPO（AI硬件）/);
  assert.match(html, /来源：cycle_identity/);
  assert.match(html, /当前市场周期 → 当前炒作题材周期 → 市场情绪核心/);
  assert.match(html, /规则影响：正面154[\s\S]*负面188[\s\S]*净影响-34[\s\S]*负面影响占优/);
  assert.match(html, /风险压力：<b>46<\/b>（仅预警，负反馈未确认）/);
  assert.match(html, /风险压力：<b>72<\/b>（负反馈已确认）/);
  assert.match(html, /创新药（医药）[\s\S]*创新药·核心延续/);
  assert.doesNotMatch(html, /retained/);
  assert.doesNotMatch(html, /不得展示的关联题材/);
  assert.match(html, /昨日分歧 → 今日分歧延续/);
  assert.match(html, /身份来源：theme_cycle_leadership/);
  assert.match(html, /收盘来源：trusted_current_closing_path_proxy/);
  assert.match(html, /契约时间：2026-08-14T15:42:44\.984Z/);
  assert.match(html, /身份来源时间：2026-08-14T15:30:00\.000Z/);
  assert.match(html, /收盘来源时间：2026-08-14T15:40:00\.000Z/);
  assert.match(html, /审计层，尚未接管上方情绪阶段\/交易权限/);

  const hostileStagePayload = clone(payload);
  hostileStagePayload.tomorrowDecision.emotionCoreEvidence.emotionStagePath = {
    nodes: {
      current: {
        status: "ready",
        key: "participating",
        label: "正常参与",
        tradingDate: "2026-08-14",
        snapshotKind: "closing",
        contractVersion: 2,
        classifierVersion: "strict-core-qualification-v2",
        evidence: { strictCoreCount: 5 },
      },
    },
    dataQuality: { reasonCodes: [] },
    gaps: [],
  };
  const hostileStageModel = sandbox.buildDirectDecisionSummary(hostileStagePayload, {});
  const hostileStageHtml = sandbox.renderDecisionDirectSummary(hostileStageModel);
  assert.equal(hostileStageModel.state.strictEmotionStageStatus, "unavailable");
  assert.doesNotMatch(hostileStageHtml, /严格核心证据已形成/);

  const savedTransition = JSON.parse(JSON.stringify(payload.tomorrowDecision.emotionCoreEvidence.transition));
  delete payload.tomorrowDecision.emotionCoreEvidence.transition.expectedPreviousTradingDate;
  const missingExpectedPreviousHtml = sandbox.renderDecisionDirectSummary(sandbox.buildDirectDecisionSummary(payload, {}));
  assert.match(missingExpectedPreviousHtml, /跨日阶段待同版本T-1收盘证据/);
  assert.doesNotMatch(missingExpectedPreviousHtml, /昨日分歧 → 今日分歧延续/);
  payload.tomorrowDecision.emotionCoreEvidence.transition = savedTransition;

  payload.tomorrowDecision.emotionCoreEvidence.transition.previous.tradingDate = "2026-08-12";
  const nonT1TransitionHtml = sandbox.renderDecisionDirectSummary(sandbox.buildDirectDecisionSummary(payload, {}));
  assert.match(nonT1TransitionHtml, /跨日阶段待同版本T-1收盘证据/);
  assert.doesNotMatch(nonT1TransitionHtml, /昨日分歧 → 今日分歧延续/);
  payload.tomorrowDecision.emotionCoreEvidence.transition = JSON.parse(JSON.stringify(savedTransition));

  const sourceRow = payload.tomorrowDecision.emotionCoreEvidence.strictEmotionCores[1];
  const savedSessionSourceAsOf = sourceRow.sessionSourceAsOf;
  const savedSessionAsOf = sourceRow.session.asOf;
  delete sourceRow.sessionSourceAsOf;
  delete sourceRow.session.asOf;
  const missingSessionTimeHtml = sandbox.renderDecisionDirectSummary(sandbox.buildDirectDecisionSummary(payload, {}));
  assert.match(missingSessionTimeHtml, /收盘来源时间待确认/);
  assert.doesNotMatch(missingSessionTimeHtml, /收盘来源时间：2026-08-14T15:30:00\.000Z/);
  sourceRow.sessionSourceAsOf = savedSessionSourceAsOf;
  sourceRow.session.asOf = savedSessionAsOf;

  const strictRow = payload.tomorrowDecision.emotionCoreEvidence.strictEmotionCores[0];
  const savedStrictTradingDate = strictRow.tradingDate;
  strictRow.name = "严格行错代旧核心";
  delete strictRow.tradingDate;
  const missingStrictRowMetaModel = sandbox.buildDirectDecisionSummary(payload, {});
  const missingStrictRowMetaHtml = sandbox.renderDecisionDirectSummary(missingStrictRowMetaModel);
  assert.equal(missingStrictRowMetaModel.state.emotionCoreEvidence.status, "unavailable");
  assert.doesNotMatch(missingStrictRowMetaHtml, /严格行错代旧核心/);
  strictRow.name = "核心甲";
  strictRow.tradingDate = savedStrictTradingDate;

  const nestedThemeRow = payload.tomorrowDecision.emotionCoreEvidence.themeCycles[0].strictEmotionCores[0];
  const savedNestedRowAsOf = nestedThemeRow.asOf;
  nestedThemeRow.name = "题材内嵌错代旧核心";
  delete nestedThemeRow.asOf;
  const missingNestedRowMetaModel = sandbox.buildDirectDecisionSummary(payload, {});
  const missingNestedRowMetaHtml = sandbox.renderDecisionDirectSummary(missingNestedRowMetaModel);
  assert.equal(missingNestedRowMetaModel.state.emotionCoreEvidence.status, "unavailable");
  assert.doesNotMatch(missingNestedRowMetaHtml, /题材内嵌错代旧核心/);
  nestedThemeRow.name = "核心甲";
  nestedThemeRow.asOf = savedNestedRowAsOf;

  const riskRow = payload.tomorrowDecision.emotionCoreEvidence.heightRiskBarometers[0];
  const savedRiskContractVersion = riskRow.contractVersion;
  riskRow.name = "风险行错代旧风向标";
  delete riskRow.contractVersion;
  const missingRiskRowMetaModel = sandbox.buildDirectDecisionSummary(payload, {});
  const missingRiskRowMetaHtml = sandbox.renderDecisionDirectSummary(missingRiskRowMetaModel);
  assert.equal(missingRiskRowMetaModel.state.emotionCoreEvidence.status, "unavailable");
  assert.doesNotMatch(missingRiskRowMetaHtml, /风险行错代旧风向标/);
  riskRow.name = "高度风险丁";
  riskRow.contractVersion = savedRiskContractVersion;

  payload.tomorrowDecision.emotionCoreEvidence.transition = { status: "unavailable", previous: null, current: null };
  const noTransitionHtml = sandbox.renderDecisionDirectSummary(sandbox.buildDirectDecisionSummary(payload, {}));
  assert.match(noTransitionHtml, /跨日阶段待同版本T-1收盘证据/);
  assert.doesNotMatch(noTransitionHtml, /昨日分歧 → 今日强分歧/);

  payload.tomorrowDecision.emotionCoreEvidence.strictEmotionCores.forEach((row) => { row.currentState = "supported"; });
  const stageGapHtml = sandbox.renderDecisionDirectSummary(sandbox.buildDirectDecisionSummary(payload, {}));
  assert.match(stageGapHtml, /旧阶段口径与严格核心证据存在差异，下一阶段校准；当前不据此开仓/);

  payload.tomorrowDecision.emotionCoreEvidence.strictEmotionCores[0].name = "缺嵌套日期旧核心";
  delete payload.tomorrowDecision.emotionCoreEvidence.generation.tradingDate;
  const missingNestedDateModel = sandbox.buildDirectDecisionSummary(payload, {});
  const missingNestedDateHtml = sandbox.renderDecisionDirectSummary(missingNestedDateModel);
  assert.equal(missingNestedDateModel.state.emotionCoreEvidence.status, "unavailable");
  assert.doesNotMatch(missingNestedDateHtml, /缺嵌套日期旧核心/);
  assert.match(missingNestedDateHtml, /同代校验未通过/);
});

test("不受支持的严格核心契约版本必须关闭且不展示旧名单", () => {
  const payload = fixture();
  const generationId = "2026-08-14:unsupported-core-evidence";
  payload.tomorrowDecision = {
    version: 3,
    generationId,
    tradingDate: "2026-08-14",
    asOf: "2026-08-14T15:42:44.984Z",
    verdict: "wait",
    market: { cycle: "主升", corePhase: "强分歧" },
    direction: { status: "cash", name: "等待承接" },
    candidates: [],
    integrity: { ok: true, blockedCandidates: [] },
    emotionCoreEvidence: {
      version: 3,
      contractVersion: 3,
      status: "ready",
      generationId,
      tradingDate: "2026-08-14",
      asOf: "2026-08-14T15:42:44.984Z",
      generation: { id: generationId, generationId, tradingDate: "2026-08-14", asOf: "2026-08-14T15:42:44.984Z" },
      strictEmotionCores: [{ code: "600098", name: "错版本旧核心", currentState: "divergence" }],
      heightRiskBarometers: [],
      integrity: { poolsDisjoint: true, namedRowsBackSummary: true, sameGeneration: true, strictRowsQualifiedOnly: true, riskRowsCannotVote: true },
    },
  };

  const model = sandbox.buildDirectDecisionSummary(payload, {});
  const html = sandbox.renderDecisionDirectSummary(model);
  assert.equal(model.state.emotionCoreEvidence.status, "unavailable");
  assert.doesNotMatch(html, /错版本旧核心/);
  assert.match(html, /契约版本不受支持/);
});

test("严格核心证据代际错配时不得展示旧股票名单", () => {
  const payload = fixture();
  payload.tomorrowDecision = {
    version: 3,
    generationId: "2026-08-14:new",
    tradingDate: "2026-08-14",
    verdict: "wait",
    market: { cycle: "主升", corePhase: "强分歧" },
    direction: { status: "cash", name: "等待承接" },
    candidates: [],
    integrity: { ok: true, blockedCandidates: [] },
    emotionCoreEvidence: {
      version: 1,
      status: "ready",
      generationId: "2026-08-13:stale",
      strictEmotionCores: [{ code: "600099", name: "旧核心名单" }],
      heightRiskBarometers: [],
      integrity: { poolsDisjoint: true, namedRowsBackSummary: true, sameGeneration: true, strictRowsQualifiedOnly: true, riskRowsCannotVote: true },
    },
  };

  const model = sandbox.buildDirectDecisionSummary(payload, {});
  const html = sandbox.renderDecisionDirectSummary(model);
  assert.notEqual(model.state.emotionCoreEvidence.status, "ready");
  assert.doesNotMatch(html, /旧核心名单/);
  assert.match(html, /严格核心证据.*同代校验未通过|严格核心证据暂不可用/);
});

test("未知情绪只展示具体证据缺口与防守兜底，规则置信不得冒充胜率", () => {
  const payload = fixture();
  const generationId = "2026-08-20:semantic-risk-default";
  payload.tomorrowDecision = {
    version: 3,
    generationId,
    tradingDate: "2026-08-20",
    asOf: "2026-08-20T15:05:00+08:00",
    verdict: "wait",
    summary: "严格情绪证据不足，先防守观察",
    primaryScenarioKey: "range_divergence",
    confidence: { score: 78, label: "中高置信 · 78/100", method: "rule_prior", calibrated: false },
    forecast: {
      dataQuality: {
        knownEvidenceCount: 9,
        totalEvidenceCount: 9,
        coveragePct: 100,
        missingFields: [],
      },
    },
    scenarios: [
      { key: "strengthen", label: "加强", probability: 29 },
      { key: "range_divergence", label: "震荡分化", probability: 52 },
      { key: "weaken", label: "减弱", probability: 19 },
    ],
    market: {
      cycle: "震荡",
      corePhase: "情绪阶段待确认",
      corePhaseKey: "unavailable",
      phaseDetail: {
        status: "unavailable",
        structuralCycle: "震荡",
        mediumStructure: { key: "range", label: "中期震荡", confirmed: true },
        indexSubPhase: { key: "structure_pending", label: "细分阶段待确认" },
        emotionStage: {
          key: "unavailable",
          label: "情绪阶段待确认",
          reason: "缺少可用的精确T-1收盘状态，无法确认情绪阶段",
        },
        tomorrowBaseline: {
          key: "unavailable",
          label: "明日基准路径待确认",
          status: "unavailable",
          probability: null,
          calibrated: false,
        },
      },
    },
    permission: { status: "wait", canActivate: false, checkpoints: ["09:25", "09:35"] },
    direction: { status: "cash", name: "等待证据补足", path: "严格情绪证据不足" },
    candidates: [],
    contingencies: [],
    integrity: { ok: true, blockedCandidates: [] },
    coreEmotion: {
      generationId,
      emotionCycle: {
        current: { key: "unknown", label: "情绪阶段待确认" },
        previous: { source: "exact_t1_state_missing" },
        dataQuality: { reasonCodes: ["same_generation_failed", "current_strict_core_insufficient"] },
        anchorLayers: { A: [], B: [] },
      },
    },
    emotionCoreEvidence: {
      status: "unavailable",
      transition: { expectedPreviousTradingDate: "2026-08-19" },
      summary: { strictCoreCount: 0, heightRiskBarometerCount: 12 },
      emotionStagePath: {
        dataQuality: { reasonCodes: ["exact_t1_closing_unavailable", "current_strict_core_insufficient"] },
        gaps: ["缺少 exact T-1 收盘严格核心证据", "今日严格核心不足，不能确认今日阶段"],
      },
    },
  };

  const model = sandbox.buildDirectDecisionSummary(payload, {});
  const html = sandbox.renderDecisionDirectSummary(model);

  assert.equal(model.forecast.confidence.label, "规则判断置信 · 78/100");
  assert.equal(model.forecast.confidence.coveragePct, 100);
  assert.equal(model.forecast.confidence.knownEvidenceCount, 9);
  assert.equal(model.forecast.confidence.totalEvidenceCount, 9);
  assert.equal(model.forecast.confidence.calibrated, false);
  assert.equal(model.forecast.confidence.isWinRate, false);
  assert.equal(model.forecast.available, false);
  assert.equal(model.forecast.withheldByEvidenceGate, true);
  assert.match(model.tomorrowBase, /严格阶段待确认/);
  assert.match(model.tomorrowBase, /缺少2026-08-19精确T-1严格核心收盘证据/);
  assert.match(model.tomorrowBase, /严格核心证据与本次明日决策代次不一致/);
  assert.match(model.tomorrowBase, /严格情绪核心为0只/);
  assert.match(html, /证据覆盖 100% · 规则判断置信 · 78\/100 · 非胜率/);
  assert.doesNotMatch(html, /规则证据完整度/);
  assert.match(html, /严格阶段待确认，暂无概率判断/);
  assert.match(html, /规则情景只保留为后台排序，不在主决策区输出百分比/);
  assert.doesNotMatch(html, /震荡分化 53%/);
  assert.doesNotMatch(html, /direct-probability-grid/);
  assert.doesNotMatch(html, /中高置信/);
  assert.equal(model.state.indexSubPhase, "震荡结构·暂无主升细分");
  assert.equal(model.state.corePhase, "待确认");
  assert.equal(model.state.emotionStageStatus, "unavailable");
  assert.match(model.state.emotionStageReason, /缺少可用的精确T-1收盘状态/);
  assert.match(model.state.emotionStageReason, /当前严格核心同代校验失败/);
  assert.deepEqual(Array.from(model.state.strictEvidenceGaps), [
    "缺少2026-08-19精确T-1严格核心收盘证据",
    "严格核心证据与本次明日决策代次不一致，旧数据已拒绝沿用",
    "今日通过身份与同代校验的严格情绪核心为0只，无法形成阶段投票",
  ]);
  assert.deepEqual(Array.from(model.state.strictEvidenceExcluded), [
    "现有12只高位负反馈观察票投票权重为0；非机会、非推荐，不能替代严格情绪核心",
  ]);
  assert.match(html, /严格情绪阶段为何未确认/);
  assert.match(html, /具体缺口[\s\S]*缺少2026-08-19精确T-1严格核心收盘证据/);
  assert.match(html, /为何不能补位[\s\S]*现有12只高位负反馈观察票投票权重为0[\s\S]*非机会、非推荐/);
  assert.match(html, /确认条件[\s\S]*当日严格情绪核心形成可投票样本/);
  assert.doesNotMatch(html, /exact_t1_state_missing|same_generation_failed|current_strict_core_insufficient/);
  assert.doesNotMatch(html, /非良性分歧|高潮后分歧/);
  assert.equal(model.tomorrowBaseline.status, "risk_default");
  assert.equal(model.tomorrowBaseline.label, "严格情绪阶段待确认·防守观察");
  assert.equal(model.tomorrowBaseline.probability, null);
  assert.equal(model.tomorrowBaseline.calibrated, false);
  assert.equal(model.tomorrowBaseline.riskDefault, true);
  assert.equal(model.tomorrowBaseline.stageInferred, false);
  assert.match(html, /风险默认 · 非市场阶段/);
  assert.match(html, /暂不新开仓；09:25\/09:35再验证/);
  assert.match(html, /只限制执行，不代表已判断市场阶段/);
});
