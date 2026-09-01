"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const runningFromMobile = path.basename(__dirname).toLowerCase() === "a-share-trading-mobile";
const desktopRoot = runningFromMobile
  ? path.resolve(__dirname, "..", "a-share-trading-model")
  : __dirname;
const mobileRoot = runningFromMobile
  ? __dirname
  : path.resolve(__dirname, "..", "a-share-trading-mobile");
const desktopScript = fs.readFileSync(path.join(desktopRoot, "script.js"), "utf8");
const mobileScript = fs.readFileSync(path.join(mobileRoot, "script.js"), "utf8");
const desktopCss = fs.readFileSync(path.join(desktopRoot, "ui-refresh.css"), "utf8");
const mobileCss = fs.readFileSync(path.join(mobileRoot, "ui-refresh.css"), "utf8");

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

function createHarness(scriptSource = desktopScript) {
  const mount = {
    dataset: {},
    attributes: {},
    innerHTML: "旧报告不应保留",
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };
  const sandbox = {
    console: { error() {} },
    document: {
      querySelector(selector) {
        return selector === "#postCloseOpportunityView" ? mount : null;
      },
    },
  };
  const rendererBlock = between(
    scriptSource,
    "function postCloseOpportunityText(",
    "function renderHotStocks(",
  );
  const decisionResolverBlock = between(
    scriptSource,
    "function sanitizeDecisionStockDecoration(",
    "function setText(",
  );
  vm.runInNewContext(
    `function escapeHtml(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;"); }\n${decisionResolverBlock}\n${rendererBlock}\nthis.renderPostCloseOpportunity = renderPostCloseOpportunity; this.hasReadyPostCloseOpportunity = hasReadyPostCloseOpportunity;`,
    sandbox,
  );
  return {
    mount,
    render: sandbox.renderPostCloseOpportunity,
    hasReady: sandbox.hasReadyPostCloseOpportunity,
  };
}

function createLoadHarness(fetchWithTimeout) {
  const mount = {
    dataset: {},
    attributes: {},
    innerHTML: "初始旧内容",
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };
  const sandbox = {
    console: { error() {} },
    document: {
      querySelector(selector) {
        return selector === "#postCloseOpportunityView" ? mount : null;
      },
    },
    fetchHotStocks: { disabled: false, textContent: "" },
    fetchHotStocksDash: null,
    cloudCurrentSyncStatus: null,
    selectedStocks: { innerHTML: "" },
    rejectedStocks: { innerHTML: "" },
    publicDataUrl: "",
    HOT_STOCKS_FETCH_TIMEOUT_MS: 85000,
    fetchWithTimeout: async (url, ...args) => {
      if (url === "/api/hot-stocks/refresh") {
        return {
          ok: false,
          status: 404,
          async json() { return { error: "legacy server" }; },
        };
      }
      return fetchWithTimeout(url, ...args);
    },
    setText() {},
    loadRealtime() {},
    renderFetchStatus() {},
    setDecisionAuthority() {},
  };
  const rendererBlock = between(
    desktopScript,
    "function postCloseOpportunityText(",
    "function renderHotStocks(",
  );
  const decisionResolverBlock = between(
    desktopScript,
    "function sanitizeDecisionStockDecoration(",
    "function setText(",
  );
  const refreshLoadBlock = between(
    desktopScript,
    "const HOT_STOCKS_REFRESH_POLL_TIMEOUT_MS",
    "async function restoreSavedHotStocks(",
  );
  vm.runInNewContext(
    `
      function escapeHtml(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;"); }
      let lastHotPayload = null;
      ${decisionResolverBlock}
      ${rendererBlock}
      function renderHotStocks(payload) { lastHotPayload = payload; renderPostCloseOpportunity(payload); }
      function setPremarketDirectBuyPayloadFresh() { return false; }
      function renderPremarketFlow() {}
      ${refreshLoadBlock}
      this.loadHotStocks = loadHotStocks;
      this.renderPostCloseOpportunity = renderPostCloseOpportunity;
      this.setLastHotPayload = (payload) => { lastHotPayload = payload; };
    `,
    sandbox,
  );
  return {
    mount,
    load: sandbox.loadHotStocks,
    render: sandbox.renderPostCloseOpportunity,
    setLast: sandbox.setLastHotPayload,
  };
}

function theme(id, name, cores = []) {
  return {
    id,
    name,
    family: id,
    state: "watch_only",
    attributionStatus: "clear",
    cores,
    source: "opportunityMap.directions",
    confirmed: false,
  };
}

function baseReport(overrides = {}) {
  return {
    method: "rule_based",
    calibrated: false,
    status: "no_opportunity",
    dataStatus: { status: "ready", usable: true, reasons: [] },
    marketPermission: { status: "blocked", canCreateOpportunities: false, reasons: [] },
    candidateThemes: [],
    confirmedThemes: [],
    opportunityCards: [],
    noOpportunity: {
      active: true,
      reasons: ["当前条件还没有同时通过，明天先不新开仓。"],
      nextChecks: ["等方向、核心股和完整计划重新同步后再看。"],
    },
    integrity: {
      failClosed: true,
      opportunityCardsFromFinalPlansOnly: true,
      observationLayersDoNotGrantExecution: true,
      watchAndExecutionCodesSeparated: true,
      generationAligned: true,
    },
    ...overrides,
  };
}

function opportunityCard(themeRow, code, name, plan = {}) {
  return {
    id: `${themeRow.id}:${code}`,
    themeId: themeRow.id,
    themeName: themeRow.name,
    code,
    name,
    setupType: null,
    plan: {
      triggers: ["板块和核心股一起走强"],
      cancelConditions: ["板块转弱或核心股失去承接"],
      position: "不超过计划仓位的三分之一",
      riskExit: "题材回流失败或核心股转弱时退出",
      ...plan,
    },
  };
}

function unifiedObservationStock(code, name, overrides = {}) {
  const observationReason = "符合当下资金偏好并具有明日条件预期";
  return {
    rank: 1,
    tierKey: "path_representative",
    tierLabel: "机会观察·明日预期",
    setupKey: null,
    setupLabel: null,
    setupEvidence: [],
    code,
    name,
    path: "boardEmotion",
    paths: ["boardEmotion"],
    pathLabel: "连板情绪",
    theme: "测试题材",
    role: "情绪核心",
    observationReason,
    expectation: {
      status: "qualified",
      label: observationReason,
      evidence: [observationReason],
      evidenceSources: ["tradingStylePreference"],
    },
    postEntryNextDayExpectation: {
      version: 1,
      status: "conditional",
      horizon: "entry_t_plus_1",
      premise: "仅在明日确认条件满足后假设参与",
      key: "board_premium",
      label: "核心溢价 / 晋级验证",
      riskLabel: "分歧兑现或高标负反馈",
      entryCondition: "出现充分换手后的回封板",
      invalidation: "回封失败",
      basis: "连板核心充分换手回封",
      pathStage: "emotion_active",
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
      reason: "等待真实分歧、充分换手与核心回封",
      avoid: "无换手秒板、一字板或后排跟风不算确认",
      activated: false,
      triggerConditions: ["出现真实分歧", "充分换手后重新回封"],
      invalidation: "回封失败",
      observationOnly: true,
      executionAuthority: false,
    },
    capitalPreference: { status: "confirmed_match", matched: true },
    profitPreference: { status: "matched", matched: true, activePaths: ["boardEmotion"] },
    leadership: { dataQuality: "价格序列分时验证", tradeQualified: true },
    hardGatePassed: true,
    opportunityDataCompleteness: {
      version: 1,
      status: "complete",
      qualified: true,
      opportunityEligible: true,
      tradingDate: "2026-08-21",
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
    shortTermOpportunityStructure: { qualified: true },
    riskNotes: [],
    executionFeasibility: {
      version: 1,
      authority: "unified_execution_feasibility_v1",
      status: "conditional",
      executableNow: false,
      canGrantExecution: false,
      onlyTightens: true,
      riskPenalty: 0,
      slippageRisk: "unknown",
      blockers: [],
      cautions: [],
      evidence: {},
      rule: "观察层不能授予执行权限",
    },
    marketCapFit: { status: "confirmed_match" },
    missingConditions: ["等待统一交易授权开放"],
    confirmationConditions: ["出现充分换手后的回封板"],
    reopenConditions: ["出现充分换手后的回封板"],
    cancelConditions: ["不再符合当前资金偏好"],
    opportunityScore: 70,
    observationOnly: true,
    executable: false,
    executionAuthority: false,
    ...overrides,
  };
}

function payloadWithUnifiedChain(report, options = {}) {
  const generationId = "2026-08-21:closing";
  const tradingDate = "2026-08-21";
  const asOf = "2026-08-21T15:05:00+08:00";
  const seen = new Set();
  const cards = (Array.isArray(report.opportunityCards) ? report.opportunityCards : []).filter((card) => {
    const code = String(card && card.code || "").toUpperCase();
    if (!code || seen.has(code)) return false;
    seen.add(code);
    return true;
  }).slice(0, 5);
  const count = cards.length;
  const executionOpen = options.executionOpen === undefined ? count > 0 : options.executionOpen === true;
  const authorizationOpen = options.authorizationOpen === undefined ? executionOpen : options.authorizationOpen === true;
  const initialTotal = authorizationOpen
    ? Number.isFinite(Number(options.initialPortfolioPct)) ? Number(options.initialPortfolioPct) : 10
    : 0;
  const maximumTotal = authorizationOpen
    ? Number.isFinite(Number(options.maximumPortfolioPct)) ? Number(options.maximumPortfolioPct) : 30
    : 0;
  const stocks = cards.map((card, index) => ({
    code: String(card.code),
    name: String(card.name || card.code),
    positionAllocation: {
      relativeWeightPct: index === count - 1 ? 100 - (Math.floor(10000 / count) / 100) * (count - 1) : Math.floor(10000 / count) / 100,
      initialPortfolioPct: index === count - 1 ? initialTotal - (Math.floor(initialTotal * 100 / count) / 100) * (count - 1) : Math.floor(initialTotal * 100 / count) / 100,
      maximumPortfolioPct: index === count - 1 ? maximumTotal - (Math.floor(maximumTotal * 100 / count) / 100) * (count - 1) : Math.floor(maximumTotal * 100 / count) / 100,
    },
  }));
  const observationStocks = (Array.isArray(options.observationStocks) ? options.observationStocks : [])
    .filter((stock) => stock && typeof stock === "object")
    .slice(0, 5);
  const alignedReport = {
    ...report,
    generationId,
    recentRelation: { ...(report.recentRelation || {}), generationId },
  };
  return {
    generationId,
    tradingDate,
    asOf,
    premarketModels: {
      generationId,
      tradingStylePreference: {
        paths: { boardEmotion: { stage: "emotion_active" } },
      },
    },
    tomorrowDecision: { generationId },
    recentIndexEmotionRelation: { generationId },
    postCloseOpportunity: alignedReport,
    unifiedDecisionChain: {
      version: 3,
      method: "strict_sequential_fail_closed_v1",
      authority: "canonical_stock_decision",
      generation: { generationId, tradingDate, asOf, aligned: true },
      marketStage: { passed: true, bigCycle: { key: "range", label: "震荡" } },
      authorization: {
        passed: authorizationOpen,
        tradePermission: { allowNew: authorizationOpen },
        positionPermission: { positionCeilingPct: maximumTotal, initialActivationPct: initialTotal },
      },
      profitEffect: {},
      theme: {},
      stockMode: {},
      stockSelectionContext: {},
      observationCandidates: {
        status: observationStocks.length ? "available" : "empty",
        method: "expectation_opportunity_pool_v5",
        observationOnly: true,
        executionAuthority: false,
        maxStocks: 5,
        selectedCount: observationStocks.length,
        selectedCodes: observationStocks.map((stock) => stock.code),
        stocks: observationStocks,
      },
      result: {
        status: executionOpen && stocks.length ? "ready" : authorizationOpen ? "no_candidate" : "blocked",
        maxStocks: 5,
        selectedCount: executionOpen ? stocks.length : 0,
        selectedCodes: executionOpen ? stocks.map((stock) => stock.code) : [],
        stocks: executionOpen ? stocks : [],
      },
      integrity: {
        ok: true,
        failClosed: true,
        noForcedCandidate: true,
        postEntryExpectationConditionalOnly: true,
        entryConfirmationRequired: true,
        opportunityDataCompletenessRequired: true,
        maxResultStocks: 5,
        strictOrder: [
          "market_stage", "authorization", "profit_effect", "theme", "stock_mode",
          "stock_hard_gate", "result_stocks", "participation_allocation",
        ],
      },
    },
  };
}

test("完整报告只显示最多三个方向、五只不重复股票，并把角色翻成大白话", () => {
  const themes = [
    theme("A", "算力<img src=x onerror=alert(1)>", [
      { code: "000001", name: "一号", role: "capacity" },
      { code: "000002", name: "二号", role: "sentiment" },
    ]),
    theme("B", "医药", [
      { code: "000003", name: "三号", role: "height" },
      { code: "000004", name: "四号", role: "pioneer" },
    ]),
    theme("C", "消费", [
      { code: "000005", name: "五号", identity: "current_core" },
      { code: "000006", name: "六号", role: "unknown_internal_code" },
    ]),
    theme("D", "不应显示的第四方向", []),
  ];
  const cards = [
    { ...opportunityCard(themes[0], "000007", "非情绪锚机会票"), role: "height" },
    opportunityCard(themes[0], "000001", "一号<script>alert(1)</script>"),
    opportunityCard(themes[0], "000002", "二号"),
    opportunityCard(themes[1], "000003", "三号"),
    opportunityCard(themes[2], "000005", "五号"),
  ];
  const report = baseReport({
    status: "opportunities",
    marketPermission: { status: "conditional", canCreateOpportunities: true, reasons: [] },
    candidateThemes: [themes[3]],
    confirmedThemes: themes.slice(0, 3).map((item) => ({ ...item, confirmed: true })),
    opportunityCards: cards,
    noOpportunity: { active: false, reasons: [], nextChecks: [] },
  });
  const { mount, render } = createHarness();

  const payload = payloadWithUnifiedChain(report);
  payload.selected = [{ name: "旧票不能补入" }];
  assert.equal(render(payload), "actionable");
  assert.equal(mount.dataset.state, "actionable");
  assert.match(mount.innerHTML, /明日有条件机会/);
  assert.equal((mount.innerHTML.match(/post-close-opportunity-theme-card/g) || []).length, 3);
  assert.equal((mount.innerHTML.match(/post-close-opportunity-core-card/g) || []).length, 5);
  assert.equal((mount.innerHTML.match(/所属题材：/g) || []).length, 5);
  assert.equal((mount.innerHTML.match(/角色：/g) || []).length, 5);
  assert.match(mount.innerHTML, /非情绪锚机会票 000007[\s\S]*所属题材：算力&lt;img src=x onerror=alert\(1\)&gt; · 角色：高度核心/);
  assert.match(mount.innerHTML, /容量核心/);
  assert.match(mount.innerHTML, /情绪核心/);
  assert.doesNotMatch(mount.innerHTML, /不应显示的第四方向|旧票不能补入/);
  assert.doesNotMatch(mount.innerHTML, /<img|<script/);
  assert.match(mount.innerHTML, /&lt;img|&lt;script/);
});

test("无机会时显示具体原因、重新开放条件和观察股，不把观察方向说成已确认", () => {
  const observation = theme("医药", "医药", [
    { code: "600001", name: "观察药企", role: "sentiment" },
  ]);
  const report = baseReport({
    candidateThemes: [observation],
    noOpportunity: {
      active: true,
      reasons: ["核心股还没有形成完整计划<script>alert(1)</script>。"],
      nextChecks: ["等核心股重新走强并补齐计划<img src=x>。"],
    },
  });
  const { mount, render } = createHarness();

  assert.equal(render({ postCloseOpportunity: report }), "blocked");
  assert.match(mount.innerHTML, /暂时没有可直接执行的机会/);
  assert.match(mount.innerHTML, /为什么暂时不开仓|什么时候重新看/);
  assert.match(mount.innerHTML, /观察方向/);
  assert.doesNotMatch(mount.innerHTML, /<h3>已确认方向<\/h3>/);
  assert.match(mount.innerHTML, /观察股/);
  assert.match(mount.innerHTML, /所属题材：医药 · 角色：情绪核心/);
  assert.doesNotMatch(mount.innerHTML, /<script|<img/);
  assert.match(mount.innerHTML, /&lt;script|&lt;img/);
});

test("正式结果0只且盘后watch为空时，统一链5只机会观察股仍必须展示", () => {
  const observationStocks = Array.from({ length: 5 }, (_, index) => unifiedObservationStock(
    `90000${index + 1}`,
    `统一观察${index + 1}`,
    { rank: index + 1 },
  ));
  const report = baseReport({
    setupCards: [],
    watchCards: [],
    candidateThemes: [],
    confirmedThemes: [],
  });
  const payload = payloadWithUnifiedChain(report, {
    executionOpen: false,
    authorizationOpen: false,
    observationStocks,
  });
  const { mount, render } = createHarness();

  assert.equal(render(payload), "blocked");
  assert.match(mount.innerHTML, /机会观察股/);
  observationStocks.forEach((stock) => assert.match(mount.innerHTML, new RegExp(stock.name)));
  assert.match(mount.innerHTML, /当前没有通过全部门槛的严格计划/);
  assert.doesNotMatch(mount.innerHTML, /盘后数据未准备好/);
});

test("硬门槛失败或买点不可确认的统一观察票不得混入主观察区", () => {
  const qualified = unifiedObservationStock("905001", "合格观察");
  const rejected = unifiedObservationStock("905002", "硬门槛失败票", {
    hardGatePassed: false,
    entryConfirmation: {
      ...unifiedObservationStock("x", "x").entryConfirmation,
      status: "blocked",
      type: null,
      label: "当前不可确认（硬门槛未过）",
    },
    postEntryNextDayExpectation: {
      ...unifiedObservationStock("x", "x").postEntryNextDayExpectation,
      status: "unavailable",
      premise: "买点确认未通过时不生成持有预期",
      key: null,
      label: "不适用（当前无买点）",
      riskLabel: "不预设上涨",
    },
  });
  const report = baseReport({ setupCards: [], watchCards: [], candidateThemes: [], confirmedThemes: [] });
  const payload = payloadWithUnifiedChain(report, {
    executionOpen: false,
    authorizationOpen: false,
    observationStocks: [qualified, rejected],
  });
  const { mount, render } = createHarness();

  assert.equal(render(payload), "blocked");
  assert.match(mount.innerHTML, /合格观察/);
  assert.doesNotMatch(mount.innerHTML, /硬门槛失败票/);
});

test("统一链观察为空但盘后watch有3只时，仍显示验证核心", () => {
  const report = baseReport({
    setupCards: [],
    watchCards: [
      watchCard("910001", "情绪验证一", "sentiment", "current", "validate_emotion"),
      watchCard("910002", "容量验证二", "capacity", "historical", "validate_theme"),
      watchCard("910003", "高度验证三", "height", "current", "height_only"),
    ],
  });
  const payload = payloadWithUnifiedChain(report, {
    executionOpen: false,
    authorizationOpen: false,
    observationStocks: [],
  });
  const { mount, render } = createHarness();

  assert.equal(render(payload), "blocked");
  assert.match(mount.innerHTML, /验证核心/);
  for (const name of ["情绪验证一", "容量验证二", "高度验证三"]) {
    assert.match(mount.innerHTML, new RegExp(name));
  }
  assert.doesNotMatch(mount.innerHTML, /盘后数据未准备好/);
});

test("正式、统一观察和验证核心都为空但数据ready时，显示无合格观察而不是数据坏", () => {
  const report = baseReport({
    setupCards: [],
    watchCards: [],
    candidateThemes: [],
    confirmedThemes: [],
  });
  const payload = payloadWithUnifiedChain(report, {
    executionOpen: false,
    authorizationOpen: false,
    observationStocks: [],
  });
  const { mount, render } = createHarness();

  assert.equal(render(payload), "blocked");
  assert.match(mount.innerHTML, /暂时无明确机会/);
  assert.match(mount.innerHTML, /没有通过观察门槛|暂无合格观察/);
  assert.doesNotMatch(mount.innerHTML, /盘后数据未准备好|数据未准备好/);
});

test("错代或数据不可用时不沿用统一观察与验证核心", () => {
  const observation = unifiedObservationStock("920001", "不应沿用的统一观察");
  const watch = watchCard("920002", "不应沿用的验证核心", "sentiment", "current", "validate_emotion");
  const readyReport = baseReport({ setupCards: [], watchCards: [watch] });

  const mismatchedPayload = payloadWithUnifiedChain(readyReport, {
    executionOpen: false,
    authorizationOpen: false,
    observationStocks: [observation],
  });
  mismatchedPayload.postCloseOpportunity.generationId = "2026-08-20:stale";
  const mismatch = createHarness();
  assert.equal(mismatch.render(mismatchedPayload), "unavailable");
  assert.doesNotMatch(mismatch.mount.innerHTML, /不应沿用的统一观察|不应沿用的验证核心/);

  const unavailableReport = baseReport({
    dataStatus: { status: "unavailable", usable: false, reasons: ["数据缺失"] },
    setupCards: [],
    watchCards: [watch],
  });
  const unavailablePayload = payloadWithUnifiedChain(unavailableReport, {
    executionOpen: false,
    authorizationOpen: false,
    observationStocks: [observation],
  });
  const unavailable = createHarness();
  assert.equal(unavailable.render(unavailablePayload), "unavailable");
  assert.doesNotMatch(unavailable.mount.innerHTML, /不应沿用的统一观察|不应沿用的验证核心/);
});

test("正式计划与统一观察代码重合时页面只展示一次", () => {
  const actionableTheme = theme("DEDUP", "去重题材", []);
  const report = baseReport({
    status: "opportunities",
    marketPermission: { status: "conditional", canCreateOpportunities: true, reasons: [] },
    confirmedThemes: [{ ...actionableTheme, confirmed: true }],
    candidateThemes: [],
    opportunityCards: [opportunityCard(actionableTheme, "930001", "唯一正式核心")],
    setupCards: [],
    watchCards: [],
    noOpportunity: { active: false, reasons: [], nextChecks: [] },
  });
  const payload = payloadWithUnifiedChain(report, {
    observationStocks: [unifiedObservationStock("930001", "唯一正式核心")],
  });
  const { mount, render } = createHarness();

  assert.equal(render(payload), "actionable");
  assert.equal((mount.innerHTML.match(/唯一正式核心/g) || []).length, 1);
});

test("互斥题材列表先显示已确认方向，再补观察方向，并在三项内去重", () => {
  const confirmed = theme("A", "确认方向A", []);
  const report = baseReport({
    confirmedThemes: [{ ...confirmed, confirmed: true }],
    candidateThemes: [
      { ...confirmed, name: "不应重复的A" },
      theme("B", "观察方向B", []),
      theme("C", "观察方向C", []),
      theme("D", "不应显示的第四方向D", []),
    ],
  });
  const { mount, render } = createHarness();

  assert.equal(render({ postCloseOpportunity: report }), "blocked");
  const confirmedIndex = mount.innerHTML.indexOf("确认方向A");
  const candidateBIndex = mount.innerHTML.indexOf("观察方向B");
  const candidateCIndex = mount.innerHTML.indexOf("观察方向C");
  assert.ok(confirmedIndex >= 0 && confirmedIndex < candidateBIndex && candidateBIndex < candidateCIndex);
  assert.equal((mount.innerHTML.match(/确认方向A/g) || []).length, 1);
  assert.doesNotMatch(mount.innerHTML, /不应重复的A|不应显示的第四方向D/);
});

test("缺失字段与数据不可用都安全关闭，并立即清掉旧报告", () => {
  const harness = createHarness();
  assert.equal(harness.render({}), "unavailable");
  assert.equal(harness.mount.dataset.state, "unavailable");
  assert.match(harness.mount.innerHTML, /盘后数据未准备好/);
  assert.doesNotMatch(harness.mount.innerHTML, /旧报告不应保留/);

  const staleTheme = theme("过期", "过期方向不应显示", [{ code: "999999", name: "过期股票", role: "capacity" }]);
  const unavailable = baseReport({
    dataStatus: { status: "unavailable", usable: false, reasons: ["数据源未准备好"] },
    candidateThemes: [staleTheme],
    noOpportunity: {
      active: true,
      reasons: ["双榜和题材库数据还没有准备好。"],
      nextChecks: ["等本次盘后数据完整返回后再看。"],
    },
  });
  assert.equal(harness.render({ postCloseOpportunity: unavailable }), "unavailable");
  assert.match(harness.mount.innerHTML, /盘后数据未准备好|双榜和题材库数据还没有准备好/);
  assert.doesNotMatch(harness.mount.innerHTML, /过期方向不应显示|过期股票/);
});

test("机会卡缺少触发、取消或风险退出时必须降级，不能显示可执行计划", () => {
  const direction = theme("A", "算力", [{ code: "000001", name: "一号", role: "capacity" }]);
  const report = baseReport({
    status: "opportunities",
    marketPermission: { status: "conditional", canCreateOpportunities: true, reasons: [] },
    candidateThemes: [],
    confirmedThemes: [{ ...direction, confirmed: true }],
    opportunityCards: [opportunityCard(direction, "000001", "一号", {
      triggers: [],
      cancelConditions: [],
      position: null,
      riskExit: null,
      risk: "这个非契约字段不能被当作最大风险",
    })],
    noOpportunity: { active: false, reasons: [], nextChecks: [] },
  });
  const { mount, render } = createHarness();

  assert.equal(render({ postCloseOpportunity: report }), "unavailable");
  assert.doesNotMatch(mount.innerHTML, /可执行计划（机会卡）/);
  assert.doesNotMatch(mount.innerHTML, /这个非契约字段|\d+%|胜率|概率/);
});

test("盘后严格计划卡忽略legacy 80%并只显示chain 10%初始仓位", () => {
  const direction = theme("A", "算力", [{ code: "000001", name: "一号", role: "capacity" }]);
  const card = opportunityCard(direction, "000001", "一号", { position: "80%（旧机会卡）" });
  const report = baseReport({
    status: "opportunities",
    marketPermission: { status: "conditional", canCreateOpportunities: true, reasons: [] },
    confirmedThemes: [{ ...direction, confirmed: true }],
    opportunityCards: [card],
    noOpportunity: { active: false, reasons: [], nextChecks: [] },
  });
  const { mount, render } = createHarness();

  assert.equal(render(payloadWithUnifiedChain(report, { initialPortfolioPct: 10, maximumPortfolioPct: 30 })), "actionable");
  assert.match(mount.innerHTML, /统一链仓位[\s\S]*初始 10% · 上限 30%/);
  assert.doesNotMatch(mount.innerHTML, /80%|旧机会卡/);
});

test("错代报告或自报完整性失败时必须拒绝展示", () => {
  const direction = theme("A", "算力", [{ code: "000001", name: "一号", role: "capacity" }]);
  const opportunity = opportunityCard(direction, "000001", "一号");
  const currentGeneration = "2026-08-12:new";
  const report = baseReport({
    generationId: currentGeneration,
    recentRelation: { generationId: "2026-08-12:old" },
    status: "opportunities",
    marketPermission: { status: "conditional", canCreateOpportunities: true, reasons: [] },
    confirmedThemes: [{ ...direction, confirmed: true }],
    opportunityCards: [opportunity],
    noOpportunity: { active: false, reasons: [], nextChecks: [] },
  });
  const payload = {
    premarketModels: { generationId: currentGeneration },
    tomorrowDecision: { generationId: currentGeneration },
    recentIndexEmotionRelation: { generationId: currentGeneration },
    postCloseOpportunity: report,
  };
  const first = createHarness();
  assert.equal(first.hasReady(payload), false);
  assert.equal(first.render(payload), "unavailable");
  assert.match(first.mount.innerHTML, /不是同一批数据/);

  const brokenIntegrityPayload = {
    postCloseOpportunity: {
      ...baseReport(),
      integrity: {
        ...baseReport().integrity,
        observationLayersDoNotGrantExecution: false,
      },
    },
  };
  const second = createHarness();
  assert.equal(second.hasReady(brokenIntegrityPayload), false);
  assert.equal(second.render(brokenIntegrityPayload), "unavailable");
});

test("先恢复 ready 报告后，后台刷新超时或失败仍保留缓存报告", async () => {
  const restored = {
    postCloseOpportunity: baseReport({
      candidateThemes: [theme("缓存方向", "缓存方向", [])],
      noOpportunity: {
        active: true,
        reasons: ["缓存报告：当前条件还没有同时通过。"],
        nextChecks: ["缓存报告：等条件重新同步后再看。"],
      },
    }),
  };
  const harness = createLoadHarness(async () => {
    throw new Error("Network timeout");
  });
  harness.setLast(restored);
  harness.render(restored);
  const readyHtml = harness.mount.innerHTML;

  const result = await harness.load({ preserveCurrent: true });

  assert.equal(result.ok, false);
  assert.equal(harness.mount.dataset.state, "blocked");
  assert.equal(harness.mount.innerHTML, readyHtml);
  assert.match(harness.mount.innerHTML, /缓存报告：当前条件还没有同时通过/);
  assert.doesNotMatch(harness.mount.innerHTML, /盘后数据未准备好/);
});

test("初次无缓存失败仍安全关闭，后台成功的新报告会替换缓存报告", async () => {
  const failed = createLoadHarness(async () => {
    throw new Error("Failed to fetch");
  });
  const failedResult = await failed.load({ preserveCurrent: false });
  assert.equal(failedResult.ok, false);
  assert.equal(failed.mount.dataset.state, "unavailable");
  assert.match(failed.mount.innerHTML, /盘后数据未准备好/);
  assert.doesNotMatch(failed.mount.innerHTML, /初始旧内容/);

  const restored = {
    postCloseOpportunity: baseReport({
      noOpportunity: {
        active: true,
        reasons: ["旧缓存报告。"],
        nextChecks: ["旧缓存条件。"],
      },
    }),
  };
  const fresh = {
    postCloseOpportunity: baseReport({
      noOpportunity: {
        active: true,
        reasons: ["本次新报告已经替换旧缓存。"],
        nextChecks: ["等待本次新报告给出的条件。"],
      },
    }),
  };
  const succeeded = createLoadHarness(async () => ({
    ok: true,
    async json() { return fresh; },
  }));
  succeeded.setLast(restored);
  succeeded.render(restored);

  const successResult = await succeeded.load({ preserveCurrent: true });

  assert.equal(successResult.ok, true, JSON.stringify(successResult));
  assert.match(succeeded.mount.innerHTML, /本次新报告已经替换旧缓存/);
  assert.doesNotMatch(succeeded.mount.innerHTML, /旧缓存报告/);
});

test("双端渲染器一致，成功链替换报告，刷新开始和失败遵守 ready 缓存保留策略", () => {
  const desktopBlock = between(desktopScript, "function postCloseOpportunityText(", "function renderHotStocks(");
  const mobileBlock = between(mobileScript, "function postCloseOpportunityText(", "function renderHotStocks(");
  assert.equal(mobileBlock, desktopBlock);

  for (const source of [desktopScript, mobileScript]) {
    const renderHotStocks = between(source, "function renderHotStocks(", "// ===== 交易日志");
    const renderer = between(source, "function renderPostCloseOpportunity(", "function resolveTodaySpeculationStage(");
    assert.match(renderHotStocks, /renderPostCloseOpportunity\(payload\);/);
    assert.deepEqual(
      [...renderer.matchAll(/payload\.([A-Za-z0-9_]+)/g)].map((match) => match[1]),
      ["postCloseOpportunity"],
    );
  }
  const refreshWorker = between(desktopScript, "async function performHotStocksLoad(", "async function loadHotStocks(");
  const refreshCoordinator = between(desktopScript, "async function loadHotStocks(", "async function restoreSavedHotStocks(");
  assert.match(refreshWorker, /preservePostCloseOpportunity = preserveCurrent && hasReadyPostCloseOpportunity\(lastHotPayload\);/);
  assert.equal((refreshWorker.match(/renderPostCloseOpportunity\(null\);/g) || []).length, 2);
  assert.match(refreshCoordinator, /if \(hotStocksRefreshFlight\) return hotStocksRefreshFlight;/);
  assert.match(refreshCoordinator, /hotStocksRefreshFlight === flight/);
});

test("双端机会区样式一致，正文不小于15px，手机单列且不产生横向溢出", () => {
  const desktopBlock = between(
    desktopCss,
    "/* ===== Post-close opportunity: concise first screen + preserved legacy analysis ===== */",
    "/* ===== Trading lifecycle workflow ===== */",
  );
  const mobileBlock = between(
    mobileCss,
    "/* ===== Post-close opportunity: concise first screen + preserved legacy analysis ===== */",
    "/* ===== Trading lifecycle workflow ===== */",
  );
  assert.equal(mobileBlock, desktopBlock);
  assert.match(desktopBlock, /\.post-close-opportunity\s*\{[\s\S]*?overflow-x:\s*hidden;/);
  assert.match(desktopBlock, /\.post-close-opportunity-relation-grid[\s\S]*?repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(desktopBlock, /\.post-close-opportunity-setup-grid[\s\S]*?repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(desktopBlock, /\.post-close-opportunity-(?:relation-day|setup-card)[\s\S]*?font-size:\s*15px;/);
  const mobileMedia = desktopBlock.slice(desktopBlock.indexOf("@media (max-width: 820px)"));
  assert.match(mobileMedia, /\.post-close-opportunity-relation-grid,[\s\S]*?\.post-close-opportunity-setup-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

function enhancedRelation() {
  return {
    title: "近期指数—情绪关系",
    status: "ready",
    window: { short: 3, confirm: 5, available: 5 },
    dominant: {
      key: "index_strong_emotion_weak",
      label: "指数走强、可参与情绪走弱",
      confirmedByFiveDay: false,
      seesawConfirmed: false,
      reason: "近期存在反向关系，但连续性证据还不够",
    },
    today: {
      title: "今日变化",
      tradingDate: "2026-08-12",
      valid: true,
      relationKey: "index_strong_emotion_weak",
      relationLabel: "指数走强、可参与情绪走弱",
    },
    transition: {
      changed: true,
      seesawConfirmed: false,
      note: "今日由共振走强切换为指数强、情绪弱",
    },
    daily: [
      { tradingDate: "2026-08-08", valid: true, relationKey: "resonance_up", relationLabel: "指数与可参与情绪同向走强" },
      { tradingDate: "2026-08-11", valid: true, relationKey: "resonance_up", relationLabel: "指数与可参与情绪同向走强" },
      { tradingDate: "2026-08-12", valid: true, relationKey: "index_strong_emotion_weak", relationLabel: "指数走强、可参与情绪走弱" },
    ],
    heightConsensus: {
      title: "高度与一致度（不参与情绪方向判断）",
    },
    opportunityBias: {
      label: "今日出现背离，只观察不下跷跷板结论",
      reason: "单日背离不能认定为跷跷板",
    },
  };
}

function setupCard(overrides = {}) {
  return {
    key: "emotion_core_divergence_reflow",
    label: "情绪核心分歧回流",
    status: "condition_watch",
    summary: "模式进入观察，触发前不形成可执行计划。",
    why: ["指数仍有交易许可", "可参与情绪核心经历分歧"],
    normalPath: "核心先分歧，再重新转强并带动同类。",
    trigger: ["核心重新转强", "同类核心同步跟随"],
    cancel: ["核心回流失败", "负反馈继续扩散"],
    risk: "单票脉冲不能代表情绪回流。",
    benchmark: {
      code: "600664",
      name: "哈药股份",
      themeName: "医药",
      role: "sentiment",
      coreStatus: "current",
      usage: "validate_emotion",
    },
    validationCodes: ["600664"],
    integrity: { observationOnly: true, executable: false },
    ...overrides,
  };
}

function watchCard(code, name, role, coreStatus, usage, overrides = {}) {
  return {
    code,
    name,
    themeId: "测试题材",
    themeName: "测试题材",
    role,
    identity: coreStatus === "current" ? "当前核心" : coreStatus === "historical" ? "历史核心" : null,
    coreStatus,
    usage,
    why: ["用于验证模式是否按预期发展"],
    trigger: ["重新转强并带动同题材"],
    cancel: ["继续走弱且没有承接"],
    blockers: ["not_in_final_plan"],
    pathKey: usage === "height_only" ? "heightOnly" : "highTrend",
    ...overrides,
  };
}

test("近期关系只展示最近三日，今日变化单列，单日背离明确不能确认跷跷板", () => {
  const report = baseReport({
    recentRelation: enhancedRelation(),
    setupCards: [setupCard()],
    watchCards: [watchCard("600664", "哈药股份", "sentiment", "current", "validate_emotion")],
  });
  const { mount, render } = createHarness();

  assert.equal(render({ postCloseOpportunity: report }), "blocked");
  assert.match(mount.innerHTML, /近期指数—情绪关系/);
  assert.match(mount.innerHTML, /今日变化/);
  assert.doesNotMatch(mount.innerHTML, /今日指数—情绪关系/);
  assert.equal((mount.innerHTML.match(/post-close-opportunity-relation-day/g) || []).length, 3);
  assert.match(mount.innerHTML, /08-08/);
  assert.match(mount.innerHTML, /08-11/);
  assert.match(mount.innerHTML, /08-12/);
  assert.match(mount.innerHTML, /近5日只作确认/);
  assert.match(mount.innerHTML, /尚不能确认跷跷板/);
  assert.doesNotMatch(mount.innerHTML, /跷跷板已确认/);
});

test("最多展示两种可复制模式，并完整说明原因、正常走法、触发、取消、风险和验证核心", () => {
  const report = baseReport({
    recentRelation: enhancedRelation(),
    setupCards: [
      setupCard(),
      setupCard({
        key: "theme_trend_core_divergence_reflow",
        label: "题材趋势核心分歧回流",
        benchmark: {
          code: "000636",
          name: "风华高科",
          themeName: "MLCC",
          role: "capacity",
          coreStatus: "historical",
          usage: "validate_theme",
        },
        validationCodes: ["000636"],
      }),
      setupCard({ key: "third_should_not_render", label: "第三种模式不应显示" }),
    ],
    watchCards: [
      watchCard("600664", "哈药股份", "sentiment", "current", "validate_emotion"),
      watchCard("000636", "风华高科", "capacity", "historical", "validate_theme", {
        themeName: "MLCC<img src=x onerror=alert(1)>",
      }),
    ],
  });
  const { mount, render } = createHarness();

  render({ postCloseOpportunity: report });
  assert.equal((mount.innerHTML.match(/post-close-opportunity-setup-card/g) || []).length, 2);
  assert.match(mount.innerHTML, /情绪核心分歧回流/);
  assert.match(mount.innerHTML, /题材趋势核心分歧回流/);
  assert.doesNotMatch(mount.innerHTML, /第三种模式不应显示/);
  for (const label of ["为什么值得研究", "正常走法", "观察触发", "取消观察", "主要风险", "验证核心"]) {
    assert.match(mount.innerHTML, new RegExp(label));
  }
  assert.match(mount.innerHTML, /模式层/);
  assert.match(mount.innerHTML, /观察验证层/);
  assert.match(mount.innerHTML, /可执行计划层/);
  assert.doesNotMatch(mount.innerHTML, /<img/);
  assert.match(mount.innerHTML, /&lt;img/);
});

test("验证核心区分当下与历史身份、四类用途、直接题材和真正核心状态，高度票只看空间", () => {
  const report = baseReport({
    recentRelation: enhancedRelation(),
    setupCards: [setupCard()],
    watchCards: [
      watchCard("100001", "情绪锚", "sentiment", "current", "validate_emotion"),
      watchCard("100002", "容量锚", "capacity", "historical", "validate_theme"),
      watchCard("100003", "高度锚", "height", "current", "height_only"),
      watchCard("100004", "趋势锚", "trend", "pending", "validate_theme", {
        why: ["条件满足后可以买<script>alert(1)</script>"],
      }),
    ],
  });
  const { mount, render } = createHarness();

  render({ postCloseOpportunity: report });
  assert.equal((mount.innerHTML.match(/post-close-opportunity-watch-card/g) || []).length, 4);
  for (const label of ["情绪验证", "容量验证", "高度观察", "趋势验证", "当下核心", "历史核心", "核心身份待确认", "所属题材：测试题材", "是否真正核心"]) {
    assert.match(mount.innerHTML, new RegExp(label));
  }
  assert.match(mount.innerHTML, /只看空间，不代表交易许可，也不等于买点/);
  const watchStart = mount.innerHTML.indexOf("观察验证层");
  const planStart = mount.innerHTML.indexOf("可执行计划层");
  const watchHtml = mount.innerHTML.slice(watchStart, planStart);
  assert.doesNotMatch(watchHtml, /可以买|买入|下单|开仓|加仓/);
  assert.doesNotMatch(watchHtml, /<script/);
});

test("机会标题严格遵守有计划、有模式观察、全空和数据坏四种状态", () => {
  const actionableTheme = theme("A", "算力", [{ code: "000001", name: "一号", role: "capacity" }]);
  const actionable = baseReport({
    status: "opportunities",
    marketPermission: { status: "conditional", canCreateOpportunities: true, reasons: [] },
    confirmedThemes: [{ ...actionableTheme, confirmed: true }],
    opportunityCards: [opportunityCard(actionableTheme, "000001", "一号")],
    setupCards: [],
    watchCards: [],
    noOpportunity: { active: false, reasons: [], nextChecks: [] },
  });
  const observing = baseReport({ setupCards: [setupCard()], watchCards: [] });
  const empty = baseReport({ setupCards: [], watchCards: [], candidateThemes: [], confirmedThemes: [] });
  const unavailable = baseReport({
    dataStatus: { status: "unavailable", usable: false, reasons: ["数据缺失"] },
    setupCards: [setupCard()],
    watchCards: [watchCard("100001", "旧观察", "sentiment", "current", "validate_emotion")],
  });

  const first = createHarness();
  first.render(payloadWithUnifiedChain(actionable));
  assert.match(first.mount.innerHTML, /明日有条件机会/);

  const second = createHarness();
  second.render({ postCloseOpportunity: observing });
  assert.match(second.mount.innerHTML, /暂时没有可直接执行的机会/);

  const third = createHarness();
  third.render({ postCloseOpportunity: empty });
  assert.match(third.mount.innerHTML, /暂时无明确机会/);

  const fourth = createHarness();
  fourth.render({ postCloseOpportunity: unavailable });
  assert.match(fourth.mount.innerHTML, /盘后数据未准备好/);
  assert.doesNotMatch(fourth.mount.innerHTML, /旧观察|情绪核心分歧回流/);
});

test("8月12日真实契约按关系、模式、验证核心三层展示，指数强情绪弱不误写成已确认跷跷板", () => {
  const cpo = theme("CPO", "共封装光学(CPO)", []);
  const medicine = theme("MED", "医药", []);
  const report = baseReport({
    candidateThemes: [cpo, medicine],
    recentRelation: {
      title: "近期指数—情绪关系",
      status: "ready",
      usability: { usable: true },
      window: { short: 3, confirm: 5, available: 5 },
      dominant: {
        key: "switching",
        label: "近期关系仍在切换",
        reason: "最近三天的关系还没有稳定下来",
        seesawConfirmed: false,
        confirmedByFiveDay: false,
      },
      today: {
        title: "今日变化",
        tradingDate: "2026-08-12",
        valid: true,
        relationKey: "index_strong_emotion_weak",
        relationLabel: "指数走强、可参与情绪走弱",
        index: { shortTermLabel: "全市场短线主升", mediumTermLabel: "中期修复" },
        emotion: { phaseLabel: "高潮后分歧", qualityLabel: "暂偏良性" },
      },
      transition: {
        changed: true,
        seesawConfirmed: false,
        note: "今天从同向走强切到指数强、可参与情绪偏弱",
      },
      daily: [
        { tradingDate: "2026-08-08", valid: true, relationKey: "resonance_up", relationLabel: "指数与可参与情绪同向走强" },
        { tradingDate: "2026-08-11", valid: true, relationKey: "resonance_up", relationLabel: "指数与可参与情绪同向走强" },
        { tradingDate: "2026-08-12", valid: true, relationKey: "index_strong_emotion_weak", relationLabel: "指数走强、可参与情绪走弱" },
      ],
    },
    setupCards: [
      setupCard({
        status: "condition_watch",
        benchmark: { code: "600664", name: "哈药股份", themeName: "医药", role: "sentiment", coreStatus: "historical", usage: "validate_emotion" },
        validationCodes: ["600664"],
      }),
      setupCard({
        key: "theme_trend_core_divergence_reflow",
        label: "题材趋势核心分歧回流",
        status: "condition_watch",
        benchmark: { code: "002428", name: "云南锗业", themeName: "共封装光学(CPO)", role: "capacity", coreStatus: "current", usage: "validate_theme" },
        validationCodes: ["002428"],
      }),
    ],
    watchCards: [
      watchCard("002428", "云南锗业", "capacity", "current", "validate_theme", { themeName: "共封装光学(CPO)" }),
      watchCard("002552", "宝鼎科技", "height", "current", "height_only", { themeName: "共封装光学(CPO)" }),
      watchCard("600721", "百花医药", "height", "historical", "height_only", { themeName: "医药" }),
      watchCard("600664", "哈药股份", "sentiment", "historical", "validate_emotion", { themeName: "医药" }),
    ],
  });
  const { mount, render } = createHarness();

  assert.equal(render({ postCloseOpportunity: report }), "blocked");
  assert.match(mount.innerHTML, /暂时没有可直接执行的机会/);
  assert.match(mount.innerHTML, /近期指数—情绪关系/);
  assert.match(mount.innerHTML, /全市场短线主升/);
  assert.match(mount.innerHTML, /高潮后分歧/);
  assert.match(mount.innerHTML, /暂偏良性/);
  assert.match(mount.innerHTML, /尚不能确认跷跷板/);
  assert.equal((mount.innerHTML.match(/post-close-opportunity-setup-card/g) || []).length, 2);
  assert.equal((mount.innerHTML.match(/post-close-opportunity-watch-card/g) || []).length, 4);
  assert.equal((mount.innerHTML.match(/只看空间，不代表交易许可，也不等于买点/g) || []).length, 2);
  for (const name of ["云南锗业", "宝鼎科技", "百花医药", "哈药股份"]) {
    assert.match(mount.innerHTML, new RegExp(name));
  }
  assert.equal((mount.innerHTML.match(/post-close-opportunity-plan-card/g) || []).length, 0);
});
