"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = __dirname;
const mobileRoot = path.resolve(root, "..", "a-share-trading-mobile");
const htmlSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSource = fs.readFileSync(path.join(root, "script.js"), "utf8");
const mobileHtmlSource = fs.readFileSync(path.join(mobileRoot, "index.html"), "utf8");
const mobileScriptSource = fs.readFileSync(path.join(mobileRoot, "script.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const uiCssSource = fs.readFileSync(path.join(root, "ui-refresh.css"), "utf8");
const buildStaticSource = fs.readFileSync(path.join(root, "build-static.mjs"), "utf8");

const EXPECTED_LAYER_ORDER = ["observation", "decision"];
const EXPECTED_LAYER_VIEWS = Object.freeze({
  observation: ["dashboard", "index-opportunity", "theme-library", "trading-preference", "emotion-stage", "auto-picker", "survivors", "review-conclusion", "journal"],
  decision: ["decision", "preplan", "sell-advisor"],
});
const EXPECTED_LAYER_LABELS = Object.freeze({
  observation: ["基础概括", "指数机会", "题材筛选", "炒作偏好", "情绪阶段", "核心观察", "活口观察", "市场复盘", "交易复盘"],
  decision: ["明日决策", "重点观察", "持仓与卖出方案"],
});
const EXPECTED_PREMARKET_VIEW_STEP = Object.freeze({
  "index-opportunity": "indexOpportunity",
  "trading-preference": "tradingPreference",
  "emotion-stage": "emotionStage",
  "theme-library": "direction",
  "auto-picker": "stocks",
  preplan: "tradePlan",
});

const LEGACY_HASH_CASES = Object.freeze({
  "": "decision",
  "#decision": "decision",
  "#personal-logic-picker": "decision",
  "#index-opportunity": "index-opportunity",
  "#trading-preference": "trading-preference",
  "#emotion-stage": "emotion-stage",
  "#market-emotion": "emotion-stage",
  "#super-expectation": "preplan",
  "#event-inference": "theme-library",
  "#review-conclusion": "review-conclusion",
  "#sell-advisor": "sell-advisor",
  "#survivors": "survivors",
  "#journal": "journal",
  "#dashboard": "dashboard",
  "#us": "us",
  "#us-dashboard": "us",
  "#auto-picker": "auto-picker",
  "#theme-library": "theme-library",
  "#watchlist": "auto-picker",
  "#preplan": "preplan",
  "#not-a-real-view": "decision",
});

function attributes(fragment) {
  const result = {};
  for (const match of fragment.matchAll(/([:\w-]+)\s*=\s*"([^"]*)"/g)) result[match[1]] = match[2];
  return result;
}

function classNames(attrs) {
  return String(attrs.class || "").split(/\s+/).filter(Boolean);
}

function extractNavHtml(source) {
  const startMatch = /<nav\b[^>]*class="[^"]*\bworkflow-stage-list\b[^"]*"[^>]*>/i.exec(source);
  assert.ok(startMatch, "missing lifecycle nav");
  const start = startMatch.index;
  const end = source.indexOf("</nav>", start);
  assert.notEqual(end, -1, "unterminated lifecycle nav");
  return source.slice(start, end + "</nav>".length);
}

function extractAnchors(source) {
  const rows = [];
  for (const match of source.matchAll(/<a\b([^>]*)>[\s\S]*?<\/a>/gi)) {
    const attrs = attributes(match[1]);
    if (!classNames(attrs).includes("nav-item")) continue;
    rows.push({ attrs, html: match[0] });
  }
  return rows;
}

function extractStageBlocks(navHtml) {
  return Array.from(navHtml.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/gi), (match) => ({
    attrs: attributes(match[1]),
    html: match[2],
  }));
}

function extractSectionViews(source) {
  return Array.from(source.matchAll(/<section\b([^>]*)>/gi), (match) => attributes(match[1])["data-view"])
    .filter(Boolean);
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const paramsStart = source.indexOf("(", start);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    if (source[index] === "(") paramsDepth += 1;
    if (source[index] === ")") paramsDepth -= 1;
    if (paramsDepth === 0) {
      paramsEnd = index;
      break;
    }
  }
  assert.notEqual(paramsEnd, -1, `unterminated parameters for ${name}`);
  const brace = source.indexOf("{", paramsEnd);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

function extractConst(source, name) {
  const declaration = `const ${name}`;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${name}`);
  const equal = source.indexOf("=", start + declaration.length);
  assert.notEqual(equal, -1, `missing assignment for ${name}`);
  let quote = "";
  let escaped = false;
  let round = 0;
  let square = 0;
  let curly = 0;
  for (let index = equal + 1; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") round += 1;
    if (char === ")") round -= 1;
    if (char === "[") square += 1;
    if (char === "]") square -= 1;
    if (char === "{") curly += 1;
    if (char === "}") curly -= 1;
    if (char === ";" && round === 0 && square === 0 && curly === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

function unifiedDecisionChainFixture({ generationId, tradingDate, asOf, stocks }) {
  const rows = (Array.isArray(stocks) ? stocks : []).map((stock, index, all) => ({
    code: String(stock.code || ""),
    name: String(stock.name || stock.code || ""),
    positionAllocation: {
      relativeWeightPct: 100 / all.length,
      initialPortfolioPct: 10 / all.length,
      maximumPortfolioPct: 30 / all.length,
    },
  }));
  return {
    version: 3,
    method: "strict_sequential_fail_closed_v1",
    authority: "canonical_stock_decision",
    generation: { generationId, tradingDate, asOf, aligned: true },
    marketStage: { passed: true, bigCycle: { key: "range", label: "震荡" } },
    authorization: {
      passed: true,
      tradePermission: { allowNew: true },
      positionPermission: { positionCeilingPct: 30, initialActivationPct: 10 },
    },
    profitEffect: {},
    theme: { themes: ["主线A", "主线B"] },
    stockMode: {},
    stockSelectionContext: {},
    result: {
      status: "ready",
      maxStocks: 5,
      selectedCount: rows.length,
      selectedCodes: rows.map((stock) => stock.code),
      stocks: rows,
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
  };
}

function loadNormalizer() {
  const sandbox = {};
  const dependencies = [
    "WORKFLOW_STAGE_DEFINITIONS",
    "WORKFLOW_VIEW_STAGE",
    "WORKFLOW_VIEW_ALIASES",
    "WORKFLOW_DEFAULT_VIEW",
  ]
    .map((name) => extractConst(scriptSource, name))
    .join("\n");
  vm.runInNewContext(
    `${dependencies}\n${extractFunction(scriptSource, "normalizeWorkflowView")}\nthis.normalizeWorkflowView = normalizeWorkflowView;`,
    sandbox,
  );
  return sandbox.normalizeWorkflowView;
}

function loadStageDefinitions() {
  const sandbox = {};
  vm.runInNewContext(
    `${extractConst(scriptSource, "WORKFLOW_STAGE_DEFINITIONS")}\nthis.definitions = WORKFLOW_STAGE_DEFINITIONS;`,
    sandbox,
  );
  return sandbox.definitions;
}

function loadLayerDefinitions() {
  const sandbox = {};
  vm.runInNewContext(
    `${extractConst(scriptSource, "WORKFLOW_LAYER_DEFINITIONS")}\nthis.definitions = WORKFLOW_LAYER_DEFINITIONS;`,
    sandbox,
  );
  return sandbox.definitions;
}

function loadLayerMapping() {
  const sandbox = {};
  vm.runInNewContext(
    `${extractConst(scriptSource, "WORKFLOW_VIEW_LAYER")}\nthis.mapping = WORKFLOW_VIEW_LAYER;`,
    sandbox,
  );
  return Object.fromEntries(Object.entries(sandbox.mapping));
}

function loadPremarketViewStep() {
  const sandbox = {};
  vm.runInNewContext(
    `${extractConst(scriptSource, "PREMARKET_VIEW_STEP")}\nthis.mapping = PREMARKET_VIEW_STEP;`,
    sandbox,
  );
  return Object.fromEntries(Object.entries(sandbox.mapping));
}

function cssRules(source) {
  return Array.from(source.matchAll(/([^{}]+)\{([^{}]*)\}/g), (match) => ({
    selector: match[1].trim(),
    declarations: match[2],
  }));
}

function cssRule(source, selectorToken, declarationPattern) {
  return cssRules(source).find(
    (rule) => rule.selector.includes(selectorToken) && declarationPattern.test(rule.declarations),
  );
}

function extractCssAtRule(source, headerPattern, label) {
  const match = headerPattern.exec(source);
  assert.ok(match, `missing ${label}`);
  const brace = source.indexOf("{", match.index);
  assert.notEqual(brace, -1, `missing body for ${label}`);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(match.index, index + 1);
  }
  throw new Error(`unterminated ${label}`);
}

test("navigation exposes only the observation and decision layers", () => {
  const navHtml = extractNavHtml(htmlSource);
  const anchors = extractAnchors(navHtml);
  const home = anchors.filter((item) => classNames(item.attrs).includes("workflow-home-item"));
  assert.equal(home.length, 0);
  assert.doesNotMatch(navHtml, /personal-logic-picker|个人专用逻辑选股/);
  assert.doesNotMatch(navHtml, /今日作战/);
  const layerDefinitions = loadLayerDefinitions();
  assert.deepEqual(Array.from(layerDefinitions, (item) => item.key), EXPECTED_LAYER_ORDER);
  assert.deepEqual(Array.from(layerDefinitions, (item) => item.label), ["观察层", "决策层"]);
  assert.deepEqual(Array.from(layerDefinitions, (item) => item.entryView), ["dashboard", "decision"]);

  const layers = extractStageBlocks(navHtml);
  assert.deepEqual(layers.map((item) => item.attrs["data-workflow-layer"]), EXPECTED_LAYER_ORDER);
  assert.deepEqual(
    layers.map((layer) => extractAnchors(layer.html).map((item) => item.attrs["data-view"])),
    EXPECTED_LAYER_ORDER.map((key) => EXPECTED_LAYER_VIEWS[key]),
  );
  assert.equal(extractAnchors(layers[0].html)[0].attrs["data-label"], "基础概括");
  assert.match(htmlSource, /<section id="dashboard"[\s\S]*?<h1>当日状态<\/h1>/);
  assert.doesNotMatch(htmlSource, /把复盘语言变成可执行交易系统/);
  assert.match(layers[0].html, /<strong>观察层<\/strong>/);
  assert.match(layers[0].html, /不构成操作指令/);
  assert.match(layers[1].html, /<strong>决策层<\/strong>/);
  assert.match(layers[1].html, /门槛 → 节点 → 动作 → 退出/);
  assert.ok(navHtml.indexOf('data-workflow-layer="observation"') < navHtml.indexOf('data-workflow-layer="decision"'));

  for (let step = 1; step <= 6; step += 1) {
    assert.equal(
      (htmlSource.match(new RegExp(`盘后复盘 · ${step}/6`, "g")) || []).length,
      1,
      `step ${step} needs one post-close review badge`,
    );
  }
  assert.doesNotMatch(htmlSource, /PREMARKET · [1-6]\/6/);
  assert.match(scriptSource, /盘后复盘流程暂时无法读取，已停止生成交易建议/);
  assert.doesNotMatch(scriptSource, /盘前流程暂时无法读取/);
  assert.deepEqual(
    layers.map((layer) => extractAnchors(layer.html).map((item) => item.attrs["data-label"])),
    EXPECTED_LAYER_ORDER.map((key) => EXPECTED_LAYER_LABELS[key]),
  );

  const allViews = anchors.map((item) => item.attrs["data-view"]);
  assert.equal(allViews.length, 12);
  assert.equal(new Set(allViews).size, 12, "every view must belong to exactly one layer");
  assert.deepEqual(new Set(allViews), new Set(EXPECTED_LAYER_ORDER.flatMap((key) => EXPECTED_LAYER_VIEWS[key])));
  for (const legacyLeaf of ["market-emotion", "us", "event-inference", "watchlist", "super-expectation"]) {
    assert.equal(allViews.includes(legacyLeaf), false, `${legacyLeaf} must be an alias, not a duplicate navigation leaf`);
  }
  const sectionViews = extractSectionViews(htmlSource);
  for (const view of allViews) {
    assert.ok(sectionViews.includes(view), `${view} needs a matching page section`);
  }
  for (const view of ["index-opportunity", "theme-library", "trading-preference", "emotion-stage", "auto-picker", "preplan"]) {
    assert.equal(sectionViews.filter((item) => item === view).length, 1, `${view} needs exactly one premarket page section`);
  }
});

test("desktop and mobile expose the same observation and decision layers while preserving internal review routes", () => {
  for (const [label, html, script] of [
    ["desktop", htmlSource, scriptSource],
    ["mobile", mobileHtmlSource, mobileScriptSource],
  ]) {
    const navHtml = extractNavHtml(html);
    const layers = extractStageBlocks(navHtml);
    assert.deepEqual(layers.map((item) => item.attrs["data-workflow-layer"]), EXPECTED_LAYER_ORDER, `${label} layer order`);
    assert.deepEqual(
      layers.map((layer) => extractAnchors(layer.html).map((item) => item.attrs["data-view"])),
      EXPECTED_LAYER_ORDER.map((key) => EXPECTED_LAYER_VIEWS[key]),
      `${label} layer routes`,
    );
    assert.match(navHtml, /<strong>观察层<\/strong>/, `${label} needs the observation layer`);
    assert.match(navHtml, /<strong>决策层<\/strong>/, `${label} needs the decision layer`);
    assert.doesNotMatch(navHtml, /<strong>(?:盘后复盘|盘中执行|持仓卖出|复盘总结)<\/strong>/, `${label} must not keep old top-level groups`);
    for (let step = 1; step <= 6; step += 1) {
      assert.equal(
        (html.match(new RegExp(`盘后复盘 · ${step}/6`, "g")) || []).length,
        1,
        `${label} step ${step} needs one post-close badge`,
      );
    }
    assert.doesNotMatch(html, /PREMARKET · [1-6]\/6/, `${label} must not expose PREMARKET badges`);
    assert.match(script, /盘后复盘流程暂时无法读取，已停止生成交易建议/);
    assert.doesNotMatch(script, /盘前流程暂时无法读取/);
    assert.match(html, /data-premarket-step="indexOpportunity"/, `${label} internal step key must remain unchanged`);
    assert.match(script, /const PREMARKET_VIEW_STEP = Object\.freeze/, `${label} internal route map must remain unchanged`);
  }
});

test("layer markup keeps exactly two native accessible accordions", () => {
  const navHtml = extractNavHtml(htmlSource);
  const layers = extractStageBlocks(navHtml);
  assert.equal(layers.length, 2);
  for (const layer of layers) {
    assert.match(layer.html, /^\s*<summary\b[^>]*class="[^"]*\bworkflow-stage-toggle\b[^"]*"[^>]*aria-controls="[^"]+"[^>]*aria-expanded="(?:true|false)"/i);
    assert.match(layer.html, /class="[^"]*\bworkflow-stage-items\b[^"]*"/i);
    assert.match(layer.html, /workflow-layer-note/);
    assert.doesNotMatch(layer.html.match(/<summary\b[\s\S]*?<\/summary>/i)[0], /<(?:a|button)\b/i);
    assert.match(layer.html, /workflow-stage-chevron[^>]*aria-hidden="true"/i);
  }
  for (const forbidden of [
    "workflow-progress",
    "workflowProgressLabel",
    "workflowProgressFill",
    "workflowProgressHint",
    "workflowContextBar",
    "workflowContextStep",
    "workflowContextTitle",
    "workflowContextDescription",
    "workflowPrevBtn",
    "workflowNextBtn",
    "workflow-pager",
  ]) {
    assert.equal(htmlSource.includes(forbidden), false, `${forbidden} must not remain in the simplified page`);
    assert.equal(scriptSource.includes(forbidden), false, `${forbidden} must not remain in navigation code`);
  }
  assert.doesNotMatch(uiCssSource, /\.workflow-progress\b|\.workflow-context-(?:bar|copy)\b|\.workflow-pager\b/);
});

test("all six premarket routes load and refresh one shared safe projection", () => {
  const projectionTag = htmlSource.indexOf("premarket-flow.js");
  const appTag = htmlSource.indexOf("script.js");
  assert.ok(projectionTag >= 0, "premarket projection must load in the browser");
  assert.ok(appTag > projectionTag, "premarket projection must load before the app renderer");
  assert.deepEqual(loadPremarketViewStep(), EXPECTED_PREMARKET_VIEW_STEP);

  const renderSource = extractFunction(scriptSource, "renderPremarketFlow");
  assert.match(renderSource, /PremarketFlow/);
  assert.match(renderSource, /buildPremarketFlow\s*\(/);
  for (const selector of [
    "#premarketIndexBody",
    "#premarketPreferenceBody",
    "#premarketEmotionBody",
    "#premarketDirectionFlow",
    "#premarketStockFlow",
    "#premarketTradePlanFlow",
  ]) {
    assert.ok(renderSource.includes(selector), `renderer must update ${selector}`);
    assert.equal(
      (htmlSource.match(new RegExp(`id="${selector.slice(1)}"`, "g")) || []).length,
      1,
      `${selector} must have one stable render target`,
    );
  }

  const stepHtmlSource = extractFunction(scriptSource, "renderPremarketStepHtml");
  assert.match(stepHtmlSource, /data-flow-step=/, "every rendered result must identify its model step");
  for (const role of ["step-summary", "conclusion", "handoff", "plans"]) {
    assert.ok(stepHtmlSource.includes(`data-flow-role="${role}"`), `missing stable ${role} flow role`);
  }
  assert.match(
    stepHtmlSource,
    /data-flow-role="\$\{[^}]*"candidates"\s*:\s*"details"[^}]*\}"/,
    "item lists must distinguish stock candidates from supporting details",
  );
  assert.ok(
    extractFunction(scriptSource, "premarketEvidenceHtml").includes('data-flow-role="evidence"'),
    "evidence must remain separately inspectable",
  );
  assert.ok(
    extractFunction(scriptSource, "premarketGuardHtml").includes('data-flow-role="guard"'),
    "upstream blockers and invalidation must remain separately inspectable",
  );

  const planSource = extractFunction(scriptSource, "premarketPlanItems");
  for (const field of ["buy", "hold", "sell", "holdingPeriod", "triggers", "cancelConditions"]) {
    assert.ok(planSource.includes(`plan.${field}`), `trade plan renderer must preserve ${field}`);
  }

  const metricsSource = extractFunction(scriptSource, "premarketStepMetrics");
  assert.match(metricsSource, /\["\u4ea4\u6613\u8bb8\u53ef"/, "index step must show trading permission");
  assert.match(metricsSource, /\["\u4ed3\u4f4d\u4e0a\u9650"/, "index step must show its position cap");
  assert.match(metricsSource, /\["\u5916\u56f4\u4fee\u6b63"/, "external markets may adjust risk but must stay visible as a modifier");

  assert.ok((scriptSource.match(/renderPremarketFlow\s*\(/g) || []).length >= 3, "fresh payloads must refresh the shared flow");
  assert.ok((scriptSource.match(/renderActivePremarketFlowView\s*\(/g) || []).length >= 2, "direct route changes must refresh the visible step");
});

test("blocked stock and trade-plan steps cannot expose legacy execution controls", () => {
  const renderSource = extractFunction(scriptSource, "renderPremarketFlow");
  const valueTextSource = extractFunction(scriptSource, "premarketValueText");
  const textSource = extractFunction(scriptSource, "postCloseOpportunityText");
  const payloadGenerationSource = extractFunction(scriptSource, "premarketDirectBuyPayloadGeneration");
  const payloadTimestampSource = extractFunction(scriptSource, "premarketDirectBuyPayloadTimestamp");
  const payloadFreshSource = extractFunction(scriptSource, "premarketDirectBuyPayloadFresh");
  const setPayloadFreshSource = extractFunction(scriptSource, "setPremarketDirectBuyPayloadFresh");
  const executablePlansSource = extractFunction(scriptSource, "premarketExecutablePlans");
  const planCodeSource = extractFunction(scriptSource, "premarketExecutablePlanCodes");
  const syncSource = extractFunction(scriptSource, "syncPremarketLegacyExecutionControls");
  const poolSource = extractFunction(scriptSource, "renderSelectionPools");
  const submitSource = extractFunction(scriptSource, "submitPreplan");
  assert.match(htmlSource, /id="preplanLegacyWorkspace"\s+hidden\s+inert/);
  assert.match(renderSource, /syncPremarketLegacyExecutionControls\(model, payload \|\| \{\}\)/);
  assert.match(poolSource, /syncPremarketLegacyExecutionControls\(lastPremarketFlowModel\)/);
  assert.match(executablePlansSource, /options\.requireFresh === true && !premarketDirectBuyPayloadFresh\(payload\)/);
  assert.match(executablePlansSource, /step\.canIssueAdvice !== true/);
  assert.match(planCodeSource, /premarketExecutablePlans\(tradePlan, payload, \{ requireFresh: true \}\)/);
  assert.match(syncSource, /payload = lastHotPayload/);
  assert.match(syncSource, /premarketExecutablePlanCodes\(model, payload\)/);
  assert.match(syncSource, /legacyPlanWorkspace\.hidden = !planExecutionAllowed/);
  assert.match(syncSource, /#auto-picker \[data-preplan\]/);
  assert.match(syncSource, /planCodes\.has\(code\)/);
  assert.match(syncSource, /button\.disabled = !allowed/);
  assert.ok((renderSource.match(/lastPremarketFlowModel = null/g) || []).length >= 2);
  assert.ok((renderSource.match(/syncPremarketLegacyExecutionControls\(null\)/g) || []).length >= 2);
  assert.ok(
    (scriptSource.match(/premarketExecutablePlanCodes\(lastPremarketFlowModel, lastHotPayload\)\.has\(code\)/g) || []).length >= 2,
    "both preplan submission and the legacy candidate button must require the fresh current payload",
  );
  assert.match(submitSource, /premarketExecutablePlanCodes\(lastPremarketFlowModel, lastHotPayload\)\.has\(code\)/);
  assert.ok(
    submitSource.indexOf("premarketExecutablePlanCodes") < submitSource.indexOf('fetch("/api/preplan/add"'),
    "manual or stale candidate codes must be rejected before the request",
  );
  assert.doesNotMatch(htmlSource, /从当日候选池选择或手输代码/);

  const workspace = {
    hidden: true,
    inert: true,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const button = (code) => ({
    dataset: { preplan: code },
    disabled: false,
    title: "",
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  });
  const buttons = [button("000001"), button("000002")];
  const sandbox = {
    lastHotPayload: null,
    document: {
      querySelector: (selector) => selector === "#preplanLegacyWorkspace" ? workspace : null,
      querySelectorAll: () => buttons,
    },
  };
  vm.runInNewContext(
    [
      valueTextSource,
      textSource,
      extractConst(scriptSource, "PREMARKET_DIRECT_BUY_MAX_AGE_MS"),
      "const premarketDirectBuyFreshPayloads = new WeakMap();",
      "let premarketDirectBuyFreshnessTimer = null; let premarketDirectBuyFreshnessTimerPayload = null;",
      payloadGenerationSource,
      payloadTimestampSource,
      payloadFreshSource,
      "function resolvePayloadExecutionFreshness() { return { directBuyEligible: true, formalOpportunityEligible: true, evidenceUsable: true, state: 'live_complete', evidenceStatus: 'complete', blockers: [] }; }",
      setPayloadFreshSource,
      extractFunction(scriptSource, "resolveUnifiedDecisionChainProjection"),
      executablePlansSource,
      planCodeSource,
      syncSource,
      "this.api = { sync: syncPremarketLegacyExecutionControls, codes: premarketExecutablePlanCodes, fresh: setPremarketDirectBuyPayloadFresh };",
    ].join("\n"),
    sandbox,
  );
  const model = {
    tradePlan: {
      key: "tradePlan",
      status: "ready",
      canIssueAdvice: true,
      plans: [{ code: "000001", buy: "回踩承接", hold: "结构有效持有", sell: "跌破退出", holdingPeriod: "1-3日" }],
    },
  };
  const now = Date.now();
  const tradingDate = new Date(now).toISOString().slice(0, 10);
  const generationId = `${tradingDate}:${new Date(now).toISOString()}`;
  const freshPayload = {
    generationId,
    tradingDate,
    fetchedAt: new Date(now).toISOString(),
    asOf: new Date(now).toISOString(),
    premarketModels: { generationId },
    tomorrowDecision: { generationId },
    recentIndexEmotionRelation: { generationId },
  };
  freshPayload.unifiedDecisionChain = unifiedDecisionChainFixture({
    generationId,
    tradingDate,
    asOf: freshPayload.asOf,
    stocks: [{ code: "000001", name: "严格一号" }],
  });
  assert.equal(sandbox.api.fresh(freshPayload, true), true);
  assert.deepEqual(Array.from(sandbox.api.codes(model, freshPayload)), ["000001"]);
  sandbox.api.sync(model, freshPayload);
  assert.equal(buttons[0].disabled, false, "the final executable plan may open preplan");
  assert.equal(buttons[1].disabled, true, "another stock cannot borrow the executable plan's permission");
  assert.equal(workspace.hidden, false);
  sandbox.api.fresh(freshPayload, false);
  sandbox.api.sync(model, freshPayload);
  assert.equal(buttons[0].disabled, true, "a retained plan must stop exposing the old execution button");
  assert.equal(workspace.hidden, true);

  const expiredAt = now - (20 * 60 * 60 * 1000) - 1;
  const expiredDate = new Date(expiredAt).toISOString().slice(0, 10);
  const expiredGeneration = `${expiredDate}:${new Date(expiredAt).toISOString()}`;
  const expiredPayload = {
    generationId: expiredGeneration,
    tradingDate: expiredDate,
    fetchedAt: new Date(expiredAt).toISOString(),
  };
  assert.equal(sandbox.api.fresh(expiredPayload, true), false);
  assert.equal(sandbox.api.codes(model, expiredPayload).size, 0);
  sandbox.api.sync(model, expiredPayload);
  assert.equal(buttons[0].disabled, true, "an expired final plan cannot reopen an old button");

  sandbox.api.sync(null, freshPayload);
  assert.equal(buttons[0].disabled, true, "missing or failed canonical flow must revoke old permission");
  assert.equal(buttons[1].disabled, true);
  assert.equal(workspace.hidden, true);
});

test("direct-buy prompt only renders strict final same-generation opportunity cards", () => {
  const valueTextSource = extractFunction(scriptSource, "premarketValueText");
  const textSource = extractFunction(scriptSource, "postCloseOpportunityText");
  const themeKeySource = extractFunction(scriptSource, "postCloseOpportunityThemeKey");
  const codeSource = extractFunction(scriptSource, "postCloseOpportunityCode");
  const generationSource = extractFunction(scriptSource, "postCloseOpportunityGenerationAligned");
  const integritySource = extractFunction(scriptSource, "postCloseOpportunityIntegrityReady");
  const planReadySource = extractFunction(scriptSource, "postCloseOpportunityPlanReady");
  const readyReportSource = extractFunction(scriptSource, "hasReadyPostCloseOpportunity");
  const payloadGenerationSource = extractFunction(scriptSource, "premarketDirectBuyPayloadGeneration");
  const payloadTimestampSource = extractFunction(scriptSource, "premarketDirectBuyPayloadTimestamp");
  const payloadFreshSource = extractFunction(scriptSource, "premarketDirectBuyPayloadFresh");
  const executableSource = extractFunction(scriptSource, "premarketExecutablePlans");
  const directSource = extractFunction(scriptSource, "premarketDirectBuyPlans");
  const freshnessSource = extractFunction(scriptSource, "setPremarketDirectBuyPayloadFresh");
  const planItemsSource = extractFunction(scriptSource, "premarketPlanItems");
  const metricsSource = extractFunction(scriptSource, "premarketStepMetrics");
  const impactSource = extractFunction(scriptSource, "premarketStepImpact");
  const conclusionSource = extractFunction(scriptSource, "premarketConclusionText");
  const promptStart = scriptSource.indexOf("function premarketDirectBuyPromptHtml(");
  const promptEnd = scriptSource.indexOf("function premarketEvidenceHtml(", promptStart);
  assert.ok(promptStart >= 0 && promptEnd > promptStart, "missing direct-buy prompt renderer");
  const promptSource = scriptSource.slice(promptStart, promptEnd);
  const stepRenderSource = extractFunction(scriptSource, "renderPremarketStepHtml");
  const flowRenderSource = extractFunction(scriptSource, "renderPremarketFlow");
  const cloudPayloadSource = extractFunction(scriptSource, "loadVerifiedCloudCurrentPayload");
  const cloudSyncSource = extractFunction(scriptSource, "runCloudCurrentSync");
  const localVerifySource = extractFunction(scriptSource, "runLocalHotStocksVerification");
  const legacyLoadSource = extractFunction(scriptSource, "loadHotStocksLegacyRequest");
  const refreshCacheSource = extractFunction(scriptSource, "loadHotStocksRefreshCache");
  const refreshLoadSource = extractFunction(scriptSource, "performHotStocksLoad");
  const restoreSource = extractFunction(scriptSource, "restoreSavedHotStocks");
  const sandbox = {
    escapeHtml: (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]),
  };
  vm.runInNewContext(
    [
      valueTextSource,
      textSource,
      themeKeySource,
      codeSource,
      generationSource,
      integritySource,
      planReadySource,
      readyReportSource,
      extractConst(scriptSource, "PREMARKET_DIRECT_BUY_MAX_AGE_MS"),
      "const premarketDirectBuyFreshPayloads = new WeakMap();",
      "let premarketDirectBuyFreshnessTimer = null; let premarketDirectBuyFreshnessTimerPayload = null; let lastHotPayload = null; function renderPremarketFlow() {}",
      payloadGenerationSource,
      payloadTimestampSource,
      payloadFreshSource,
      "function resolvePayloadExecutionFreshness() { return { directBuyEligible: true, formalOpportunityEligible: true, evidenceUsable: true, state: 'live_complete', evidenceStatus: 'complete', blockers: [] }; }",
      extractFunction(scriptSource, "resolveUnifiedDecisionChainProjection"),
      executableSource,
      directSource,
      freshnessSource,
      promptSource,
      "this.api = { executable: premarketExecutablePlans, direct: premarketDirectBuyPlans, fresh: setPremarketDirectBuyPayloadFresh, isFresh: premarketDirectBuyPayloadFresh, prompt: premarketDirectBuyPromptHtml };",
    ].join("\n"),
    sandbox,
  );
  const completePlan = (code, name) => ({
    code,
    name,
    buy: "回踩承接后介入",
    hold: "结构有效时持有",
    sell: "跌破承接位退出",
    holdingPeriod: "1-3个交易日",
    position: "80%（旧计划仓位，禁止执行）",
    triggers: ["09:25竞价与09:35承接同时确认"],
    cancelConditions: ["竞价转弱或承接失败"],
    executionMode: "conditional_after_support",
  });
  const strictCard = (code, name, themeId = "theme-a", themeName = "主线A") => ({
    id: `${themeId}:${code}`,
    code,
    name,
    themeId,
    themeName,
    plan: {
      buy: "回踩承接后介入",
      hold: "结构有效时持有",
      sell: "跌破承接位退出",
      riskExit: "跌破承接位退出",
      holdingPeriod: "1-3个交易日",
      position: "80%（旧机会卡仓位，禁止执行）",
      triggers: ["09:25竞价与09:35承接同时确认"],
      cancelConditions: ["竞价转弱或承接失败"],
      executionMode: "conditional_after_support",
    },
    source: {
      plan: "premarketFlow.tradePlan.plans",
      candidate: "opportunityMap.directions[].tradeCandidates",
    },
  });
  const readyStep = (plans) => ({
    key: "tradePlan",
    status: "ready",
    canIssueAdvice: true,
    executionMode: "conditional_after_support",
    plans,
  });
  const strictPayload = (cards, options = {}) => {
    const sourceTimestamp = Number.isFinite(Number(options.sourceTimestamp))
      ? Number(options.sourceTimestamp)
      : Date.now();
    const tradingDate = String(options.tradingDate || new Date(sourceTimestamp).toISOString().slice(0, 10));
    const generationId = String(options.generationId || `${tradingDate}:${new Date(sourceTimestamp).toISOString()}`);
    const payload = {
      generationId,
      tradingDate,
      fetchedAt: new Date(sourceTimestamp).toISOString(),
      asOf: new Date(sourceTimestamp).toISOString(),
      premarketModels: { generationId },
      tomorrowDecision: {
        generationId,
        opportunityMap: {
          directions: cards.map((card) => ({
            id: card.themeId,
            name: card.themeName,
            family: card.themeId,
            tradeCandidates: [{ code: card.code, name: card.name, active: true, tradeQualified: true }],
          })),
        },
      },
      recentIndexEmotionRelation: { generationId },
      postCloseOpportunity: {
        status: "opportunities",
        generationId,
        recentRelation: { generationId },
        sources: { opportunityCards: "premarketFlow.tradePlan.plans" },
        dataStatus: { status: "ready", usable: true },
        marketPermission: { status: "conditional", canCreateOpportunities: true },
        noOpportunity: { active: false },
        candidateThemes: [],
        confirmedThemes: [
          { id: "theme-a", name: "主线A" },
          { id: "theme-b", name: "主线B" },
        ],
        opportunityCards: cards,
        integrity: {
          failClosed: true,
          generationAligned: true,
          opportunityCardsFromFinalPlansOnly: true,
          observationLayersDoNotGrantExecution: true,
          watchAndExecutionCodesSeparated: true,
        },
      },
    };
    payload.unifiedDecisionChain = unifiedDecisionChainFixture({
      generationId,
      tradingDate,
      asOf: payload.asOf,
      stocks: cards.map((card) => ({ code: card.code, name: card.name })),
    });
    if (options.markFresh !== false) sandbox.api.fresh(payload, true);
    return payload;
  };

  assert.match(directSource, /payload\.postCloseOpportunity/);
  assert.match(directSource, /report\.status !== "opportunities"/);
  assert.match(directSource, /marketPermission\.canCreateOpportunities !== true/);
  assert.match(directSource, /hasReadyPostCloseOpportunity\(payload\)/);
  assert.match(directSource, /premarketDirectBuyPayloadFresh\(payload\)/);
  for (const producer of ["premarketModels", "tomorrowDecision", "recentIndexEmotionRelation"]) {
    assert.ok(directSource.includes(`payload && payload.${producer} && payload.${producer}.generationId`));
  }
  assert.match(directSource, /payloadGenerations\.some\(\(generation\) => !generation\)/);
  assert.match(directSource, /payloadGenerations\.some\(\(generation\) => generation !== reportGeneration\)/);
  assert.match(payloadFreshSource, /premarketDirectBuyFreshPayloads\.get\(payload\)/);
  assert.match(payloadFreshSource, /generationId\.startsWith\(`\$\{tradingDate\}:`\)/);
  assert.match(payloadFreshSource, /now - sourceTimestamp <= PREMARKET_DIRECT_BUY_MAX_AGE_MS/);
  assert.match(freshnessSource, /premarketDirectBuyFreshPayloads\.set\(payload/);
  assert.match(freshnessSource, /const expiresAt = sourceTimestamp \+ PREMARKET_DIRECT_BUY_MAX_AGE_MS/);
  assert.match(freshnessSource, /premarketDirectBuyFreshnessTimerPayload = payload/);
  for (const peripheralSource of [planItemsSource, metricsSource, impactSource, conclusionSource]) {
    assert.match(peripheralSource, /premarketExecutablePlans\(step, payload, \{ requireFresh: true \}\)/);
  }
  assert.match(directSource, /sourcePlan !== "premarketFlow\.tradePlan\.plans"/);
  assert.match(directSource, /sourceCandidate !== "opportunityMap\.directions\[\]\.tradeCandidates"/);
  assert.match(directSource, /canonicalCandidatesByCode/);
  assert.match(directSource, /candidate\.active !== true \|\| candidate\.tradeQualified !== true/);
  assert.doesNotMatch(directSource, /stocks\.candidates|bestPicks|(?:report|payload|step)\.(?:tradeCandidates|watchCards|setupCards)/);
  assert.ok((promptSource.match(/escapeHtml\(/g) || []).length >= 7, "all dynamic direct-buy fields must be escaped");
  assert.ok(stepRenderSource.indexOf("${directBuyPrompt}") < stepRenderSource.indexOf("${projection}"));
  assert.match(flowRenderSource, /renderPremarketStepHtml\(step, payload \|\| \{\}\)/);
  assert.match(cloudPayloadSource, /options\.directBuyFresh === true/);
  assert.match(cloudSyncSource, /setPremarketDirectBuyPayloadFresh\(lastHotPayload, false\)/);
  assert.match(cloudSyncSource, /directBuyFresh: true/);
  assert.match(localVerifySource, /officialDirectBuyFresh/);
  assert.match(localVerifySource, /setPremarketDirectBuyPayloadFresh\(localResult\.payload, false\)/);
  assert.match(localVerifySource, /setPremarketDirectBuyPayloadFresh\(lastHotPayload, false\)/);
  assert.match(localVerifySource, /reusedLatestCompletedTradingDay === true/);
  assert.match(localVerifySource, /hotStocksRenderRefreshStage\("latestTradingDay"/);
  assert.match(legacyLoadSource, /url === "\/api\/hot-stocks"/);
  assert.match(refreshCacheSource, /payloadGeneration !== expectedGeneration/);
  assert.match(refreshCacheSource, /setPremarketDirectBuyPayloadFresh\(payload, true\)/);
  assert.match(refreshLoadSource, /setPremarketDirectBuyPayloadFresh\(lastHotPayload, false\)/);
  assert.match(restoreSource, /setPremarketDirectBuyPayloadFresh\(payload, false\)/);

  const blocked = {
    key: "tradePlan",
    status: "blocked",
    canIssueAdvice: false,
    plans: [completePlan("STALE001", "旧候选")],
  };
  const blockedHtml = sandbox.api.prompt(blocked, strictPayload([strictCard("STALE001", "旧候选")]));
  assert.match(blockedHtml, /当前暂无可买入股票/);
  assert.match(blockedHtml, /可执行计划为 0 份/);
  assert.doesNotMatch(blockedHtml, /旧候选|STALE001|回踩承接后介入/);

  const oneStep = readyStep([completePlan("000001", "严格一号")]);
  const onePayload = strictPayload([strictCard("000001", "严格一号")]);
  const oneHtml = sandbox.api.prompt(oneStep, onePayload);
  assert.equal(sandbox.api.isFresh(onePayload), true);
  assert.equal(sandbox.api.executable(oneStep, onePayload, { requireFresh: true }).length, 1);
  assert.equal(sandbox.api.direct(oneStep, onePayload).length, 1);
  for (const token of ["严格一号", "000001", "条件满足后可买入", "09:25竞价与09:35承接同时确认", "竞价转弱或承接失败", "初始 10% · 上限 30%"]) {
    assert.ok(oneHtml.includes(token), `strict direct-buy prompt must preserve ${token}`);
  }
  assert.doesNotMatch(oneHtml, /80%|旧计划仓位|旧机会卡仓位/);
  assert.doesNotMatch(oneHtml, /立即买入/);

  const retainedPayload = strictPayload([strictCard("000001", "严格一号")]);
  sandbox.api.fresh(retainedPayload, false);
  assert.equal(sandbox.api.executable(oneStep, retainedPayload, { requireFresh: true }).length, 0);
  assert.equal(sandbox.api.direct(oneStep, retainedPayload).length, 0, "retained snapshots must remain observation-only");
  const stalePayload = strictPayload([strictCard("000001", "严格一号")]);
  stalePayload.stale = true;
  assert.equal(sandbox.api.fresh(stalePayload, true), false);
  assert.equal(sandbox.api.direct(oneStep, stalePayload).length, 0, "stale snapshots must fail closed");

  const expiredAt = Date.now() - (20 * 60 * 60 * 1000) - 1;
  const expiredPayload = strictPayload([strictCard("000001", "严格一号")], { sourceTimestamp: expiredAt });
  assert.equal(sandbox.api.isFresh(expiredPayload), false);
  assert.equal(sandbox.api.direct(oneStep, expiredPayload).length, 0, "payloads older than the 20-hour TTL must fail closed");

  const mismatchedDayPayload = strictPayload([strictCard("000001", "严格一号")], {
    generationId: `1999-01-01:${new Date().toISOString()}`,
  });
  assert.equal(sandbox.api.isFresh(mismatchedDayPayload), false);
  assert.equal(sandbox.api.direct(oneStep, mismatchedDayPayload).length, 0, "a generation from another trading date must fail closed");

  const multiStep = readyStep([completePlan("000001", "严格一号"), completePlan("000002", "严格二号")]);
  const multiHtml = sandbox.api.prompt(multiStep, strictPayload([
    strictCard("000001", "严格一号"),
    strictCard("000002", "严格二号", "theme-b", "主线B"),
  ]));
  assert.match(multiHtml, /data-direct-buy-count="2"/);
  assert.match(multiHtml, /严格一号/);
  assert.match(multiHtml, /严格二号/);

  const pendingPayload = strictPayload([strictCard("000001", "严格一号")]);
  pendingPayload.postCloseOpportunity.status = "no_opportunity";
  const pendingHtml = sandbox.api.prompt(oneStep, pendingPayload);
  assert.match(pendingHtml, /最终机会卡尚未通过同代、题材归属与完整性复核/);
  assert.doesNotMatch(pendingHtml, /严格一号|000001/);
  const unprovenHtml = sandbox.api.prompt(oneStep, { postCloseOpportunity: { status: "no_opportunity" } });
  assert.match(unprovenHtml, /可执行计划为 0 份/);
  assert.doesNotMatch(unprovenHtml, /严格一号|000001/);

  for (const missing of ["code", "buy", "hold", "sell", "holdingPeriod"]) {
    const plan = completePlan("000003", "字段缺失");
    delete plan[missing];
    assert.equal(sandbox.api.executable(readyStep([plan])).length, 0, `${missing} is required`);
  }
  for (const missing of ["triggers", "cancelConditions"]) {
    const plan = completePlan("000004", "条件缺失");
    delete plan[missing];
    assert.equal(sandbox.api.executable(readyStep([plan])).length, 0, `${missing} is required for conditional plans`);
  }
  const duplicatePlanA = completePlan("000006", "冲突计划A");
  const duplicatePlanB = completePlan("000006", "冲突计划B");
  duplicatePlanB.buy = "另一买点";
  assert.equal(
    sandbox.api.executable(readyStep([duplicatePlanA, duplicatePlanB])).length,
    0,
    "duplicate final plan codes must fail closed",
  );
  const wrongTheme = strictPayload([strictCard("000001", "错误题材", "not-confirmed", "未确认题材")]);
  assert.equal(sandbox.api.direct(oneStep, wrongTheme).length, 0, "unconfirmed themes must not leak into direct-buy prompt");
  const wrongSource = strictPayload([strictCard("000001", "错误来源")]);
  wrongSource.postCloseOpportunity.opportunityCards[0].source.plan = "watchPool";
  assert.equal(sandbox.api.direct(oneStep, wrongSource).length, 0, "non-final plan sources must fail closed");
  const wrongCandidateSource = strictPayload([strictCard("000001", "严格一号")]);
  wrongCandidateSource.postCloseOpportunity.opportunityCards[0].source.candidate = "watchPool";
  assert.equal(sandbox.api.direct(oneStep, wrongCandidateSource).length, 0, "non-canonical candidate sources must fail closed");
  const missingCanonicalCandidate = strictPayload([strictCard("000001", "严格一号")]);
  missingCanonicalCandidate.tomorrowDecision.opportunityMap.directions[0].tradeCandidates = [];
  assert.equal(sandbox.api.direct(oneStep, missingCanonicalCandidate).length, 0, "cards must resolve to a canonical trade candidate");
  const inactiveCanonicalCandidate = strictPayload([strictCard("000001", "严格一号")]);
  inactiveCanonicalCandidate.tomorrowDecision.opportunityMap.directions[0].tradeCandidates[0].active = false;
  assert.equal(sandbox.api.direct(oneStep, inactiveCanonicalCandidate).length, 0, "inactive candidates must fail closed");
  const wrongReportSource = strictPayload([strictCard("000001", "严格一号")]);
  wrongReportSource.postCloseOpportunity.sources.opportunityCards = "legacyPlans";
  assert.equal(sandbox.api.direct(oneStep, wrongReportSource).length, 0, "non-canonical report sources must fail closed");
  const wrongCardId = strictPayload([strictCard("000001", "严格一号")]);
  wrongCardId.postCloseOpportunity.opportunityCards[0].id = "forged:000001";
  assert.equal(sandbox.api.direct(oneStep, wrongCardId).length, 0, "non-canonical opportunity card ids must fail closed");
  const duplicateCards = strictPayload([strictCard("000001", "严格一号"), strictCard("000001", "严格一号")]);
  assert.equal(sandbox.api.direct(oneStep, duplicateCards).length, 0, "duplicate opportunity codes must fail closed");
  const mismatchedPlan = strictPayload([strictCard("000001", "严格一号")]);
  mismatchedPlan.postCloseOpportunity.opportunityCards[0].plan.buy = "伪造买点";
  assert.equal(sandbox.api.direct(oneStep, mismatchedPlan).length, 0, "same-code cards cannot replace the final plan content");
  for (const producer of ["premarketModels", "tomorrowDecision", "recentIndexEmotionRelation"]) {
    const missingProducer = strictPayload([strictCard("000001", "严格一号")]);
    delete missingProducer[producer].generationId;
    assert.equal(
      sandbox.api.direct(oneStep, missingProducer).length,
      0,
      `missing ${producer} generation must fail closed`,
    );

    const wrongProducer = strictPayload([strictCard("000001", "严格一号")]);
    wrongProducer[producer].generationId = `${wrongProducer.tradingDate}:wrong-${producer}`;
    assert.equal(
      sandbox.api.direct(oneStep, wrongProducer).length,
      0,
      `mismatched ${producer} generation must fail closed`,
    );
  }
  for (const target of ["report", "relation"]) {
    const missingGeneration = strictPayload([strictCard("000001", "严格一号")]);
    if (target === "report") delete missingGeneration.postCloseOpportunity.generationId;
    else delete missingGeneration.postCloseOpportunity.recentRelation.generationId;
    assert.equal(sandbox.api.direct(oneStep, missingGeneration).length, 0, `missing ${target} generation must fail closed`);
  }

  const invalidCode = '<svg onload="boom">';
  const invalidStep = readyStep([completePlan(invalidCode, "非法代码")]);
  const invalidPayload = strictPayload([strictCard(invalidCode, "非法代码")]);
  assert.equal(sandbox.api.direct(invalidStep, invalidPayload).length, 0, "invalid stock codes must fail closed");

  const maliciousCode = "000005";
  const maliciousStep = readyStep([completePlan(maliciousCode, '<img src=x onerror="boom">')]);
  const maliciousCard = strictCard(maliciousCode, '<img src=x onerror="boom">');
  maliciousCard.themeName = "<script>boom</script>";
  maliciousCard.themeId = "theme-a";
  maliciousCard.plan.buy = "<b>买点</b>";
  maliciousStep.plans[0].buy = "<b>买点</b>";
  const maliciousPayload = strictPayload([maliciousCard]);
  maliciousPayload.postCloseOpportunity.confirmedThemes[0].name = "<script>boom</script>";
  const maliciousHtml = sandbox.api.prompt(maliciousStep, maliciousPayload);
  assert.doesNotMatch(maliciousHtml, /<img|<script|<svg|<b>买点<\/b>/i);
  assert.match(maliciousHtml, /&lt;img/);
  assert.match(maliciousHtml, /&lt;script/);
  assert.match(maliciousHtml, /&lt;b&gt;买点&lt;\/b&gt;/);
});

test("canonical premarket 1/2/3 UI renders rule-derived paths without unsafe legacy probability text", () => {
  const renderSource = extractFunction(scriptSource, "renderPremarketStepHtml");
  const metricsSource = extractFunction(scriptSource, "premarketStepMetrics");
  const indexSource = extractFunction(scriptSource, "premarketIndexProjectionHtml");
  const preferenceSource = extractFunction(scriptSource, "premarketPreferenceProjectionHtml");
  const emotionSource = extractFunction(scriptSource, "premarketEmotionProjectionHtml");
  const conclusionSource = extractFunction(scriptSource, "premarketConclusionText");
  const cardSource = extractFunction(scriptSource, "premarketProjectionCardHtml");

  assert.match(renderSource, /premarketStepProjectionHtml\s*\(/);
  assert.match(metricsSource, /blocked \? "观察方向" : "主攻方向"/);
  assert.match(metricsSource, /上游未授权，不作为主攻/);
  assert.match(conclusionSource, /题材库观察：\$\{primary\.name\} · 上游未授权，不作为主攻/);
  for (const key of ["opportunities", "warnings", "tomorrowPaths"]) assert.ok(indexSource.includes(`step.${key}`));
  for (const key of ["highTrend", "lowLaunch", "boardEmotion"]) assert.ok(preferenceSource.includes(`"${key}"`));
  assert.match(preferenceSource, /primaryEligibleCarrierCodes/);
  assert.match(preferenceSource, /contingencyEligibleCarrierCodes/);
  assert.match(preferenceSource, /次级路径观察/);
  assert.match(preferenceSource, /路径切换前不是当前主选/);
  for (const token of ["executionPreference", "representatives", "opportunities", "cautions", "tomorrowPaths"]) {
    assert.ok(preferenceSource.includes(token), `preference projection must preserve ${token}`);
  }
  assert.match(preferenceSource, /premarketRuleScore/);
  assert.match(preferenceSource, /sourceCoverage/);
  assert.match(preferenceSource, /查看分数、热榜覆盖和完整证据/);
  assert.match(indexSource, /opportunities\.slice\(0, 2\)/);
  assert.match(indexSource, /warnings\[0\]/);
  assert.match(indexSource, /展开看完整规则依据/);
  assert.match(indexSource, /return \[\s*premarketIndexTomorrowPlanHtml\(step\),\s*premarketIndexActionHtml\(step\),\s*detailedHtml/);
  assert.match(metricsSource, /tomorrowBaseline/);
  for (const label of ["市场热度", "接盘力度", "亏钱风险"]) assert.ok(metricsSource.includes(label));
  assert.doesNotMatch(metricsSource, /expected\.probability/);
  assert.match(conclusionSource, /premarketEmotionConclusion\(step\)/);
  assert.doesNotMatch(conclusionSource, /return current\.reason/);
  for (const token of ["rankedAnchors", "layerRank", "themeStages", "marketStructure", "tomorrowPaths"]) {
    assert.ok(emotionSource.includes(token), `emotion projection must preserve ${token}`);
  }
  assert.match(cardSource, /<details class="premarket-card-evidence">/);
  assert.doesNotMatch(cardSource, /<details[^>]*\sopen(?:\s|>)/);
  for (const value of ["eyebrow", "title", "note", "item"]) assert.match(cardSource, new RegExp(`escapeHtml\\([^)]*${value}`));

  const divergenceSandbox = {};
  vm.runInNewContext(
    `${extractFunction(scriptSource, "premarketDivergenceText")}\nthis.render = premarketDivergenceText;`,
    divergenceSandbox,
  );
  assert.equal(divergenceSandbox.render("large", "harmful"), "大分歧 · 非良性");
  assert.equal(divergenceSandbox.render("large harmful", ""), "大分歧 · 非良性");

  const cardSandbox = {
    escapeHtml: (value) => String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;"),
  };
  vm.runInNewContext(
    [
      extractFunction(scriptSource, "premarketValueText"),
      extractFunction(scriptSource, "premarketTextRows"),
      cardSource,
      "this.render = premarketProjectionCardHtml;",
    ].join("\n"),
    cardSandbox,
  );
  const unsafe = '<img src=x onerror="alert(1)">';
  const html = cardSandbox.render({ eyebrow: unsafe, title: unsafe, note: unsafe, details: [unsafe] });
  assert.doesNotMatch(html, /<img\b|onerror="/);
  assert.match(html, /&lt;img/);

  for (const token of [
    ".premarket-projection",
    ".premarket-projection-grid",
    ".premarket-projection-card",
    ".premarket-card-evidence",
  ]) {
    const matching = cssRules(uiCssSource).filter((rule) => rule.selector.includes(token));
    assert.ok(matching.length, `${token} needs CSS`);
    assert.ok(matching.every((rule) => rule.selector.includes(".premarket-step-body")), `${token} CSS must stay premarket-scoped`);
  }
});

test("strict five-day index evidence keeps isolated slots, accessible values and no synthetic statistics", () => {
  const sandbox = {
    escapeHtml: (value) => String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;"),
  };
  const names = [
    "premarketFinite",
    "premarketValueText",
    "premarketTextRows",
    "premarketProjectionCardHtml",
    "premarketProjectionSectionHtml",
    "premarketStatusMeta",
    "premarketIndexEvidenceWindowDates",
    "premarketIndexEvidenceSlots",
    "premarketIndexShortDate",
    "premarketIndexSourceLabel",
    "premarketIndexKlineSvg",
    "premarketIndexTurnoverSvg",
    "premarketIndexEvidenceChartsHtml",
    "premarketIndexPlanText",
    "premarketIndexPlanRows",
    "premarketIndexTomorrowPlanHtml",
    "premarketIndexActionText",
    "premarketIndexActionHtml",
  ];
  const sources = names.map((name) => extractFunction(scriptSource, name));
  vm.runInNewContext(
    [
      ...sources.slice(0, 5),
      "function premarketStepImpact() { return '后续仓位不得放大。'; }",
      ...sources.slice(5),
      "this.renderEvidence = premarketIndexEvidenceChartsHtml;",
      "this.renderPlan = premarketIndexTomorrowPlanHtml;",
      "this.renderAction = premarketIndexActionHtml;",
    ].join("\n"),
    sandbox,
  );

  const dates = ["2026-08-14", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"];
  const partial = {
    index: {
      code: "883421",
      name: '<img src=x onerror="alert(1)">同花顺全A',
      source: "ths-public-page",
      points: [
        { tradingDate: "2026-08-13", open: 98, high: 100, low: 97, close: 99, quality: "strict_closing" },
        ...dates.map((tradingDate, index) => ({
          tradingDate,
          open: 100 + index,
          high: 103 + index,
          low: 99 + index,
          close: 102 + index,
          quality: tradingDate === "2026-08-18" ? "partial" : "strict_closing",
        })),
      ],
    },
    turnover: {
      unit: "亿元",
      source: "closing_market_snapshot",
      points: dates.map((tradingDate, index) => ({
        tradingDate,
        amountYi: 20000 + index * 100,
        quality: tradingDate === "2026-08-18" ? "partial" : "strict_closing",
      })),
      latestAmountYi: 20400,
      latestVsPreviousPct: 1.2,
      averageAmountYi: 99999,
      vsAveragePct: 88,
      rangePositionPct: 99,
    },
    dataQuality: {
      status: "partial",
      requestedDays: 5,
      availableDays: 4,
      strictClosingOnly: true,
      consecutive: false,
      missingDates: ["2026-08-18"],
      note: '<img src=x onerror="alert(4)">隔离',
    },
  };
  const partialHtml = sandbox.renderEvidence({ fiveDayEvidence: partial });
  assert.match(partialHtml, /最近5个交易日（4\/5可用）/);
  assert.match(partialHtml, /08-18快照质量未通过，保留空槽；4\/5日可用。五日均值不计算，不以更早日期补位。/);
  assert.match(partialHtml, /883421 · 同花顺公开行情/);
  assert.match(partialHtml, /正式收盘快照/);
  assert.doesNotMatch(partialHtml, /ths-public-page|closing_market_snapshot/);
  assert.match(partialHtml, /data-date="2026-08-18" data-quality="missing"/);
  assert.equal((partialHtml.match(/class="premarket-index-candle /g) || []).length, 4);
  assert.equal((partialHtml.match(/class="premarket-index-turnover-bar"/g) || []).length, 4);
  assert.equal((partialHtml.match(/class="premarket-index-missing-slot"/g) || []).length, 2);
  assert.doesNotMatch(partialHtml, /2026-08-13|5日均额|较5日均额|5日区间位置/);
  assert.match(partialHtml, /role="img"/);
  assert.match(partialHtml, /<title>2026-08-20 开/);
  assert.match(partialHtml, /2026-08-20 两市成交额/);
  assert.match(partialHtml, /较前一交易日 \+1\.2%/);
  assert.doesNotMatch(partialHtml, /<img\b|<svg onload|NaN|undefined/);
  assert.match(partialHtml, /&lt;img/);

  const complete = JSON.parse(JSON.stringify(partial));
  complete.index.name = "同花顺全A(沪深)";
  complete.index.source = "strict source";
  complete.index.points = complete.index.points.filter((row) => row.tradingDate !== "2026-08-13");
  complete.index.points.find((row) => row.tradingDate === "2026-08-18").quality = "strict_closing";
  complete.turnover.source = "closing archive";
  complete.turnover.points.find((row) => row.tradingDate === "2026-08-18").quality = "strict_closing";
  Object.assign(complete.dataQuality, { status: "complete", availableDays: 5, consecutive: true, missingDates: [], note: "" });
  const completeHtml = sandbox.renderEvidence({ fiveDayEvidence: complete });
  assert.equal((completeHtml.match(/class="premarket-index-candle /g) || []).length, 5);
  assert.equal((completeHtml.match(/class="premarket-index-turnover-bar"/g) || []).length, 5);
  assert.match(completeHtml, /5日均额/);
  assert.match(completeHtml, /5日区间位置/);

  const insufficientHtml = sandbox.renderEvidence({
    fiveDayEvidence: {
      index: { points: [complete.index.points[0]] },
      turnover: { points: [complete.turnover.points[0]] },
      dataQuality: { status: "partial", requestedDays: 5, availableDays: 1, strictClosingOnly: true },
    },
  });
  assert.match(insufficientHtml, /K线证据不足/);
  assert.match(insufficientHtml, /成交额证据不足/);
  assert.doesNotMatch(insufficientHtml, /<svg\b/);

  const plan = {
    mainPath: { label: "震荡观察", conditions: ["承接不弱"], probability: 78 },
    upwardRevision: { label: '<img src=x onerror="alert(5)">向上修正', trigger: ["共振增强"], probability: 88 },
    downwardRevision: { label: "向下修正", result: "停止新开仓", probability: 66 },
    executionRhythm: '<svg onload="alert(6)">09:25后复核',
    action: { summary: "暂不新开仓", checkpoints: ["09:25", "09:35"], probability: 99 },
  };
  const planHtml = sandbox.renderPlan({ indexTomorrowPlan: plan });
  assert.match(planHtml, /明日主路径/);
  assert.match(planHtml, /向上修正条件/);
  assert.match(planHtml, /向下修正条件/);
  assert.doesNotMatch(planHtml, /78\s*%|88\s*%|66\s*%|probability|<img\b/);
  assert.match(planHtml, /&lt;img/);
  const actionHtml = sandbox.renderAction({ status: "blocked", permission: "blocked", indexTomorrowPlan: plan });
  assert.match(actionHtml, /当前权限只允许观察，暂不新开仓/);
  assert.match(actionHtml, /复核：09:25、09:35/);
  assert.doesNotMatch(actionHtml, /99\s*%|<svg onload/);
  assert.match(actionHtml, /&lt;svg/);

  const chartSource = extractFunction(scriptSource, "premarketIndexKlineSvg")
    + "\n" + extractFunction(scriptSource, "premarketIndexTurnoverSvg");
  assert.match(chartSource, /<svg/);
  assert.doesNotMatch(chartSource, /\bChart\b|<canvas/);
  const indexCss = typeof uiCssSource === "string" ? uiCssSource : uiRefreshCssSource;
  assert.match(indexCss, /#index-opportunity \.premarket-index-chart-grid[\s\S]*grid-template-columns:\s*minmax\(0,\s*1\.6fr\)/);
  assert.match(indexCss, /@media \(max-width:\s*820px\)[\s\S]*#index-opportunity \.premarket-index-chart-grid[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test("index evidence loader is single-flight, ignores stale payloads and fails closed", async () => {
  const responses = [];
  let fetchCount = 0;
  const sandbox = {
    fetch: () => {
      fetchCount += 1;
      return responses.shift();
    },
    console: { warn() {} },
  };
  vm.runInNewContext(
    [
      "let indexOpportunityEvidenceRequest = null;",
      "const indexOpportunityEvidenceLoads = new WeakMap();",
      "let lastHotPayload = null;",
      "let renderCount = 0;",
      "function renderPremarketFlow() { renderCount += 1; }",
      extractFunction(scriptSource, "premarketUnavailableIndexEvidence"),
      extractFunction(scriptSource, "loadIndexOpportunityEvidence"),
      "this.setCurrent = (payload) => { lastHotPayload = payload; };",
      "this.load = loadIndexOpportunityEvidence;",
      "this.renderCount = () => renderCount;",
    ].join("\n"),
    sandbox,
  );

  let resolveFirst;
  responses.push(new Promise((resolve) => { resolveFirst = resolve; }));
  const payload = {};
  sandbox.setCurrent(payload);
  const first = sandbox.load(payload);
  const duplicate = sandbox.load(payload);
  assert.equal(first, duplicate);
  assert.equal(fetchCount, 1);
  const evidence = { index: { points: [] }, turnover: { points: [] }, dataQuality: { status: "partial" } };
  resolveFirst({ ok: true, status: 200, json: async () => ({ ok: true, evidence }) });
  await first;
  assert.equal(payload.indexOpportunityEvidence, evidence);
  assert.equal(sandbox.renderCount(), 1);

  responses.push(Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, evidence: { dataQuality: { status: "complete" } } }),
  }));
  const stale = {};
  sandbox.setCurrent(stale);
  const staleLoad = sandbox.load(stale);
  sandbox.setCurrent({});
  await staleLoad;
  assert.equal(Object.prototype.hasOwnProperty.call(stale, "indexOpportunityEvidence"), false);
  assert.equal(sandbox.renderCount(), 1);

  responses.push(Promise.resolve({ ok: false, status: 503, json: async () => ({}) }));
  const failed = {};
  sandbox.setCurrent(failed);
  await sandbox.load(failed);
  assert.equal(failed.indexOpportunityEvidence.dataQuality.status, "unavailable");
  assert.equal(sandbox.renderCount(), 2);
  assert.equal(fetchCount, 3);

  const loaderSource = extractFunction(scriptSource, "loadIndexOpportunityEvidence");
  assert.match(loaderSource, /fetch\("\/api\/index-opportunity\/evidence", \{ cache: "no-store" \}\)/);
  assert.match(loaderSource, /payload !== lastHotPayload/);
  assert.match(scriptSource, /renderPremarketFlow\(payload\);\s*void loadIndexOpportunityEvidence\(payload\);/);
  assert.match(extractFunction(scriptSource, "renderPremarketFlow"), /premarketAttachIndexOpportunityEvidence\(model, payload \|\| \{\}\)/);
});

test("premarket summaries use readable type, plain no-trade wording and collapsed detail", () => {
  const premarketCss = uiCssSource.split("/* ===== Premarket decision readability and progressive disclosure ===== */")[1] || "";
  const opportunityCss = stylesSource.split("/* ===== Tomorrow opportunity: plain language and readable type ===== */")[1] || "";
  assert.match(premarketCss, /\.premarket-conclusion-main h3[\s\S]*font-size:\s*clamp\(27px/);
  assert.match(premarketCss, /\.premarket-step-body \.premarket-projection-card > strong[\s\S]*font-size:\s*16px/);
  assert.match(premarketCss, /\.premarket-step-body \.premarket-projection-card > p[\s\S]*font-size:\s*14px/);
  assert.match(premarketCss, /\.premarket-detail-disclosure > summary/);
  assert.match(opportunityCss, /\.direct-opportunity-map > header strong[\s\S]*font-size:\s*clamp\(24px/);
  assert.match(opportunityCss, /\.direct-opportunity-explanation[\s\S]*font-size:\s*14px/);
  for (const text of ["为什么暂时不做", "什么变化后可以做", "有方向，但暂时没有合适买点"]) {
    assert.ok(scriptSource.includes(text), `missing plain-language decision copy: ${text}`);
  }
  assert.doesNotMatch(scriptSource, /今日无交易机会|今日仅观察|今日无交易窗口/);
});

test("emotion-stage UI translates internal scoring jargon into plain Chinese without losing meaning or escaping", () => {
  const sandbox = {
    escapeHtml: (value) => String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;"),
  };
  vm.runInNewContext(
    [
      extractFunction(scriptSource, "premarketFinite"),
      extractFunction(scriptSource, "premarketValueText"),
      extractFunction(scriptSource, "premarketTextRows"),
      extractFunction(scriptSource, "premarketRuleScore"),
      extractFunction(scriptSource, "premarketProjectionCardHtml"),
      extractFunction(scriptSource, "premarketProjectionSectionHtml"),
      extractFunction(scriptSource, "premarketPlainEmotionText"),
      extractFunction(scriptSource, "premarketEmotionLayerLabel"),
      extractFunction(scriptSource, "premarketEmotionStageLabel"),
      extractFunction(scriptSource, "premarketEmotionConclusion"),
      extractFunction(scriptSource, "premarketEmotionProjectionHtml"),
      extractFunction(scriptSource, "premarketStepMetrics"),
      extractFunction(scriptSource, "premarketConclusionText"),
      "this.projection = premarketEmotionProjectionHtml;",
      "this.metrics = premarketStepMetrics;",
      "this.conclusion = premarketConclusionText;",
      "this.plainEmotionText = premarketPlainEmotionText;",
    ].join("\n"),
    sandbox,
  );

  const unsafeName = '<img src=x onerror="alert(1)">热门股';
  const step = {
    key: "emotionStage",
    emotionVersion: 2,
    stageLabel: "承接",
    currentEmotion: {
      key: "support",
      label: "承接",
      reason: "前置分歧或退潮后，至少两只A/B锚形成真实承接并获得广度确认",
    },
    tomorrowBaseline: { label: "明天先看分歧后的接盘情况", reason: "开盘后再确认" },
    emotionMetrics: {
      heat: { score: 64, highAnchorCount: 2 },
      support: { score: 59, unknownCount: 1 },
      damage: { score: 13, harmfulAnchorCount: 1 },
    },
    rankedAnchors: [
      {
        code: "600001",
        name: unsafeName,
        layer: "A",
        layerLabel: "情绪主锚",
        anchorRole: "height",
        anchorRoleLabel: "高度核心",
        anchorScore: 96,
        influenceWeightPct: 44,
        profitEffectScore: 91,
        profitEffectWeightPct: 55,
        priceDiscoveryType: "turnover_reseal",
        priceDiscovery: { label: "换手开板后回封", evidence: ["开板后很快重新封住"] },
        profitEffect: { evidence: ["当天买入的人大多有利润"] },
        heat: { score: 96, evidence: ["两家热榜都在前十"] },
        support: { score: 73, evidence: ["开板后有人接住"] },
        damage: { score: 0, evidence: ["没有明显亏钱反馈"] },
      },
      {
        code: "600002",
        name: "大成交样本",
        layer: "B",
        layerLabel: "次级锚",
        anchorRole: "capacity",
        anchorRoleLabel: "容量核心",
        anchorScore: 82,
        influenceWeightPct: 31,
        profitEffectScore: 70,
        profitEffectWeightPct: 30,
        priceDiscoveryType: "active_price_discovery",
        heat: { score: 82, evidence: [] },
        support: { score: 62, evidence: [] },
        damage: { score: 5, evidence: [] },
      },
      {
        code: "600003",
        name: "跟随样本",
        layer: "C",
        layerLabel: "广度样本",
        anchorRole: "follower",
        anchorRoleLabel: "跟随样本",
        anchorScore: 45,
        influenceWeightPct: 10,
        heat: { score: 45, evidence: [] },
        support: { score: 40, evidence: [] },
        damage: { score: 18, evidence: [] },
      },
    ],
    themeStages: [{
      name: "医药",
      primaryAnchorCount: 2,
      current: { label: "高潮", reason: "多只A层主锚进入高热区，且多角色广度确认高潮" },
      anchors: [],
    }],
    marketStructure: {
      capacity: { label: "大成交股表现分化", total: 2, supportedCount: 1, damagedCount: 1, unknownCount: 0 },
    },
    tomorrowPaths: [],
  };

  const conclusion = sandbox.conclusion(step);
  const metrics = sandbox.metrics(step);
  const projection = sandbox.projection(step);
  const visibleText = [conclusion, ...metrics.flat(), projection]
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  const oneWordText = sandbox.plainEmotionText("一字/无价格发现");
  assert.match(oneWordText, /一字涨停封死，几乎没有成交换手/);
  assert.doesNotMatch(oneWordText, /没有有/);

  assert.match(conclusion, /承接|接盘/);
  for (const plainLabel of [
    "市场热度",
    "接盘力度",
    "亏钱风险",
    "最重要的人气股",
    "大成交核心股",
    "跟随观察股",
    "对市场影响",
    "赚钱示范作用",
  ]) assert.match(visibleText, new RegExp(plainLabel));

  for (const jargon of [
    "A/B锚",
    "广度确认",
    "H 热度",
    "C 承接",
    "D 伤害",
    "规则分",
    "市场影响权重",
    "赚钱效应权重",
    "价格发现",
    "A层",
    "B层",
    "C层",
    "主锚",
    "观察锚",
  ]) assert.ok(!visibleText.includes(jargon), `user-facing emotion UI must not expose jargon: ${jargon}`);

  for (const preservedValue of ["64 / 100", "59 / 100", "13 / 100", "96 / 100", "44%", "91 / 100", "55%"]) {
    assert.ok(visibleText.includes(preservedValue), `plain-language rendering must preserve ${preservedValue}`);
  }
  assert.doesNotMatch(projection, /<img\b|onerror="/);
  assert.match(projection, /&lt;img/);
});

test("emotion projection keeps missing anchor and capacity counts unknown instead of forging zero", () => {
  const sandbox = {
    escapeHtml: (value) => String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;"),
  };
  vm.runInNewContext(
    [
      extractFunction(scriptSource, "premarketFinite"),
      extractFunction(scriptSource, "premarketValueText"),
      extractFunction(scriptSource, "premarketTextRows"),
      extractFunction(scriptSource, "premarketRuleScore"),
      extractFunction(scriptSource, "premarketProjectionCardHtml"),
      extractFunction(scriptSource, "premarketProjectionSectionHtml"),
      extractFunction(scriptSource, "premarketPlainEmotionText"),
      extractFunction(scriptSource, "premarketEmotionLayerLabel"),
      extractFunction(scriptSource, "premarketEmotionStageLabel"),
      extractFunction(scriptSource, "premarketEmotionConclusion"),
      extractFunction(scriptSource, "premarketEmotionProjectionHtml"),
      "this.render = premarketEmotionProjectionHtml;",
    ].join("\n"),
    sandbox,
  );
  const missingHtml = sandbox.render({
    rankedAnchors: [],
    themeStages: [{ name: "医药", current: { label: "局部高潮" }, anchors: [] }],
    marketStructure: { capacity: { label: "容量分化" } },
    tomorrowPaths: [],
  });
  assert.match(missingHtml, /重点股数量还看不清/);
  assert.match(missingHtml, /大成交核心股共待确认/);
  assert.match(missingHtml, /走稳待确认/);
  assert.match(missingHtml, /走弱待确认/);
  assert.match(missingHtml, /数据不足待确认/);
  assert.doesNotMatch(missingHtml, /0只重点股已经确认|大成交核心股共0只|走稳0只|走弱0只|数据不足0只/);

  const zeroHtml = sandbox.render({
    rankedAnchors: [],
    themeStages: [{ name: "医药", primaryAnchorCount: 0, current: { label: "待确认" }, anchors: [] }],
    marketStructure: {
      capacity: { label: "容量确认", total: 0, supportedCount: 0, damagedCount: 0, unknownCount: 0 },
    },
    tomorrowPaths: [],
  });
  assert.match(zeroHtml, /0只重点股已经确认/);
  assert.match(zeroHtml, /大成交核心股共0只/);
});

test("emotion profit-effect ranking uses the full anchor pool before display truncation", () => {
  const sandbox = {
    escapeHtml: (value) => String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;"),
  };
  vm.runInNewContext(
    [
      extractFunction(scriptSource, "premarketFinite"),
      extractFunction(scriptSource, "premarketValueText"),
      extractFunction(scriptSource, "premarketTextRows"),
      extractFunction(scriptSource, "premarketRuleScore"),
      extractFunction(scriptSource, "premarketProjectionCardHtml"),
      extractFunction(scriptSource, "premarketProjectionSectionHtml"),
      extractFunction(scriptSource, "premarketPlainEmotionText"),
      extractFunction(scriptSource, "premarketEmotionLayerLabel"),
      extractFunction(scriptSource, "premarketEmotionStageLabel"),
      extractFunction(scriptSource, "premarketEmotionConclusion"),
      extractFunction(scriptSource, "premarketEmotionProjectionHtml"),
      "this.render = premarketEmotionProjectionHtml;",
    ].join("\n"),
    sandbox,
  );
  const highImpact = Array.from({ length: 9 }, (_, index) => ({
    code: `60${String(index).padStart(4, "0")}`,
    name: `market-anchor-${index}`,
    layer: "A",
    anchorScore: 90 - index,
    influenceWeightPct: 20 - index,
    profitEffectScore: index === 0 ? 80 : null,
    profitEffectWeightPct: index === 0 ? 10 : 0,
    priceDiscoveryType: index === 0 ? "turnover_limit" : "unknown",
    heat: { score: 90 - index, evidence: [] },
    support: { score: null, evidence: [] },
    damage: { score: null, evidence: [] },
  }));
  const lowImpactProfitLeader = {
    code: "609999",
    name: "profit-edge-anchor",
    layer: "C",
    anchorScore: 40,
    influenceWeightPct: 0.1,
    profitEffectScore: 99,
    profitEffectWeightPct: 60,
    priceDiscoveryType: "turnover_reseal",
    heat: { score: 40, evidence: [] },
    support: { score: 65, evidence: [] },
    damage: { score: 0, evidence: [] },
  };
  const html = sandbox.render({
    rankedAnchors: [...highImpact, lowImpactProfitLeader],
    themeStages: [],
    marketStructure: {},
    tomorrowPaths: [],
  });
  const profitStart = html.indexOf('data-premarket-projection="emotion-profit-effect"');
  const anchorStart = html.indexOf('data-premarket-projection="emotion-anchors"');
  const profitSection = html.slice(profitStart, anchorStart);

  assert.ok(profitStart >= 0 && anchorStart > profitStart);
  assert.ok(profitSection.indexOf("profit-edge-anchor") < profitSection.indexOf("market-anchor-0"));
  assert.equal((html.match(/profit-edge-anchor/g) || []).length, 1, "the low-impact profit leader belongs only to the profit section");
});

test("workflow navigation uses scoped neutral glass surfaces and a teal active light strip", () => {
  const premiumMarker = "/* ===== Premium frosted glass navigation ===== */";
  const premiumStart = uiCssSource.indexOf(premiumMarker);
  assert.ok(premiumStart >= 0, "missing premium workflow navigation block");
  const premiumCss = uiCssSource.slice(premiumStart);
  assert.match(premiumCss, /--nav-glass-accent:\s*#08776e\b/i);
  assert.match(premiumCss, /--nav-glass-accent-strong:\s*#05645d\b/i);
  assert.match(premiumCss, /--nav-glass-panel:\s*rgba\(255,\s*255,\s*255,/i);
  assert.doesNotMatch(premiumCss, /--nav-glass-(?:blue|violet)\s*:/i);
  assert.doesNotMatch(premiumCss, /\.workspace-topbar\b/, "left-navigation polish must not restyle right-side content");

  for (const selector of [".sidebar", ".workflow-home-item", ".workflow-stage"]) {
    const glassRule = cssRules(premiumCss).find(
      (rule) => rule.selector.includes(selector)
        && /-webkit-backdrop-filter\s*:/i.test(rule.declarations)
        && /(^|[^-])backdrop-filter\s*:/im.test(rule.declarations),
    );
    assert.ok(glassRule, `${selector} must declare prefixed and standard backdrop filters`);
  }

  const glassFallback = extractCssAtRule(
    premiumCss,
    /@supports\s+not\s*\(\s*\(-webkit-backdrop-filter\s*:\s*blur\([^)]*\)\)\s*or\s*\(backdrop-filter\s*:\s*blur\([^)]*\)\)\s*\)\s*\{/i,
    "solid glass fallback",
  );
  assert.match(glassFallback, /background(?:-color)?\s*:/i);
  for (const selector of [".sidebar", ".workflow-home-item", ".workflow-stage"]) {
    assert.ok(glassFallback.includes(selector), `${selector} needs a solid no-blur fallback`);
  }

  const reducedTransparency = extractCssAtRule(
    premiumCss,
    /@media\s*\(prefers-reduced-transparency\s*:\s*reduce\)\s*\{/i,
    "reduced-transparency fallback",
  );
  assert.match(reducedTransparency, /background(?:-color)?\s*:/i);

  const activeHome = cssRules(premiumCss).find(
    (rule) => rule.selector.includes(".workflow-home-item.active")
      && rule.selector.includes("::before")
      && /(?:background|box-shadow)\s*:/i.test(rule.declarations),
  );
  const activeStage = cssRules(premiumCss).find(
    (rule) => rule.selector.includes(".workflow-stage.is-active")
      && rule.selector.includes("::before")
      && /(?:background|box-shadow)\s*:/i.test(rule.declarations),
  );
  assert.ok(activeHome, "the active decision entry needs a light strip");
  assert.ok(activeStage, "the active lifecycle stage needs a light strip");
  assert.match(
    `${activeHome.declarations}\n${activeStage.declarations}`,
    /(?:#(?:08776e|05645d)|rgba?\(\s*8\s*,\s*119\s*,\s*110|var\(--nav-glass-(?:accent(?:-strong)?|highlight)\))/i,
    "the active light strip must remain teal",
  );

  for (const selector of [
    ".workflow-stage-index",
    ".workflow-stage-copy small",
    ".workflow-home-item .nav-index",
    ".workflow-stage-items .nav-item .nav-index",
  ]) {
    assert.ok(cssRule(uiCssSource, selector, /display\s*:\s*none\b/i), `${selector} must stay hidden`);
  }
});

test("hash normalization preserves every old link, aliases us-dashboard and rejects unknown views", () => {
  const normalizeWorkflowView = loadNormalizer();
  const layerMapping = loadLayerMapping();
  const expectedLayer = {
    decision: "decision",
    "index-opportunity": "observation",
    "trading-preference": "observation",
    "emotion-stage": "observation",
    "theme-library": "observation",
    "auto-picker": "observation",
    preplan: "decision",
    dashboard: "observation",
    us: "observation",
    survivors: "observation",
    "sell-advisor": "decision",
    "review-conclusion": "observation",
    journal: "observation",
  };
  for (const [hash, view] of Object.entries(LEGACY_HASH_CASES)) {
    assert.equal(normalizeWorkflowView(hash), view, `${hash || "empty hash"} should resolve to ${view}`);
    assert.equal(layerMapping[view], expectedLayer[view], `${hash || "empty hash"} should open ${expectedLayer[view]}`);
  }
});

test("workflow initialization is hash-aware and keeps history, same-hash and browser traversal coherent", () => {
  const initializeSource = extractFunction(scriptSource, "initializeWorkflowNavigation");
  const locationSyncSource = extractFunction(scriptSource, "syncWorkflowLocationFromHash");
  const navigateSource = extractFunction(scriptSource, "navigateToWorkflowView");

  assert.match(initializeSource, /addEventListener\(\s*"hashchange"\s*,\s*syncWorkflowLocationFromHash\s*\)/);
  assert.match(initializeSource, /addEventListener\(\s*"popstate"\s*,\s*syncWorkflowLocationFromHash\s*\)/);
  assert.match(locationSyncSource, /location\.hash/);
  assert.match(locationSyncSource, /replace/);
  assert.match(navigateSource, /history\.(?:pushState|replaceState)/);
  assert.match(navigateSource, /switchMode\s*\(/, "same-hash navigation must still apply the requested view");
  assert.doesNotMatch(scriptSource, /switchMode\("decision"\);\s*\/\/\s*默认落在今日决策页/);
});

test("direct deep links reset above the sticky header without async scroll anchoring", () => {
  const resetSource = extractFunction(scriptSource, "resetWorkflowScrollPosition");
  const switchSource = extractFunction(scriptSource, "switchMode");
  assert.match(resetSource, /window\.scrollTo/);
  assert.match(resetSource, /requestAnimationFrame/);
  assert.match(resetSource, /setTimeout/);
  assert.match(switchSource, /resetWorkflowScrollPosition\s*\(/);
  assert.match(uiCssSource, /body\[data-workflow-stage="selection"\]\s+\.main\s*\{[^}]*overflow-anchor\s*:\s*none/s);
});

test("switching a view synchronizes only its owner accordion and aria state", () => {
  const syncSource = extractFunction(scriptSource, "syncWorkflowNavigation");
  const ariaSource = extractFunction(scriptSource, "syncWorkflowStageAria");
  assert.match(syncSource, /\.workflow-layer/);
  assert.match(syncSource, /data-workflow-layer/);
  assert.match(syncSource, /\.open\s*=/);
  assert.match(syncSource, /is-active/);
  assert.match(ariaSource, /aria-expanded/);
  assert.match(ariaSource, /aria-controls/);
  assert.match(syncSource, /aria-current/);
  assert.match(syncSource, /document\.body\.dataset\.workflowStage/);
  assert.match(syncSource, /document\.body\.dataset\.workflowLayer/);
  assert.match(syncSource, /layerKey\s*!==\s*"personal"[\s\S]*querySelector/, "routes without a nav leaf such as us must still open their layer");
});

test("navigation refactor preserves preplan and journal loading side effects", () => {
  const switchSource = extractFunction(scriptSource, "switchMode");
  assert.match(switchSource, /view\s*===\s*"preplan"[\s\S]*?refreshPreplanView\s*\(/);
  assert.match(switchSource, /view\s*===\s*"journal"[\s\S]*?loadJournal\s*\([\s\S]*?loadArchiveList\s*\(/);
});

test("theme-library lazy loading belongs to switchMode so every route entrypoint behaves alike", () => {
  const switchSource = extractFunction(scriptSource, "switchMode");
  assert.match(switchSource, /view\s*===\s*"theme-library"[\s\S]*?loadThemeLibrary\s*\(/);

  const navBindingStart = scriptSource.lastIndexOf('document.querySelectorAll(".nav-item").forEach');
  const navBindingEnd = scriptSource.indexOf('document.querySelectorAll("[data-mode-view]")', navBindingStart);
  assert.ok(navBindingStart >= 0 && navBindingEnd > navBindingStart, "missing leaf navigation binding");
  const navBindingSource = scriptSource.slice(navBindingStart, navBindingEnd);
  assert.match(navBindingSource, /navigateToWorkflowView\s*\(/);
  assert.doesNotMatch(navBindingSource, /loadThemeLibrary\s*\(/, "leaf clicks must not duplicate route side effects");
});

test("desktop and mobile theme-library role titles separate cycle identity from today's strength", () => {
  const fixture = {
    stocks: [
      {
        code: "910101",
        name: "cycle-core-sample",
        tags: [{ key: "leader", label: "龙头", reason: "跨日核心" }],
        roleStyles: ["趋势总龙"],
        todayState: "今日被动分歧",
        changePct: 0.5,
      },
      {
        code: "910102",
        name: "daily-strong-sample",
        tags: [{ key: "leader", label: "龙头", reason: "只验证了当日强度" }],
        identity: "情绪/历史核心",
        roleStyles: ["当日高度龙"],
        todayState: "当日强势",
        changePct: 10,
      },
      {
        code: "910103",
        name: "height-only-sample",
        tags: [{ key: "leader", label: "龙头", reason: "只代表高度" }],
        roleStyles: ["连板高标"],
        todayState: "高度分歧",
        changePct: -3,
      },
      {
        code: "910104",
        name: "pioneer-sample",
        tags: [{ key: "pioneer", label: "先锋", reason: "率先发动并带动同类" }],
        roleStyles: [],
        changePct: 8,
      },
      {
        code: "910105",
        name: "capacity-sample",
        tags: [{ key: "capacity", label: "中军", reason: "承担成交承接" }],
        roleKinds: ["capacityCore"],
        cycleIdentity: { state: "confirmed", crossDayPersistent: true },
        roleStyles: [],
        changePct: 3,
      },
      {
        code: "910106",
        name: "catchup-sample",
        tags: [{ key: "catchup", label: "补涨", reason: "核心之后走强" }],
        roleStyles: [],
        changePct: 10,
      },
    ],
  };

  for (const [target, source] of [["desktop", scriptSource], ["mobile", mobileScriptSource]]) {
    const sandbox = {
      escapeHtml: (value) => String(value == null ? "" : value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;"),
      formatMaybeNumber: (value, digits = 1) => Number(value).toFixed(digits),
    };
    vm.runInNewContext(
      [
        extractFunction(source, "themeLibraryRoleStocks"),
        extractFunction(source, "renderThemeLibraryStock"),
        extractFunction(source, "renderThemeLibraryRole"),
        "this.roleStocks = themeLibraryRoleStocks;",
        "this.renderRole = renderThemeLibraryRole;",
      ].join("\n"),
      sandbox,
    );

    assert.deepEqual(
      Array.from(sandbox.roleStocks(fixture, "周期龙头"), (stock) => stock.code),
      ["910101"],
      `${target}: only a cross-day cycle identity may enter 周期龙头`,
    );
    assert.ok(
      !Array.from(sandbox.roleStocks(fixture, "周期龙头"), (stock) => stock.code).includes("910105"),
      `${target}: historical recognition must not turn a capacity core into a second cycle leader`,
    );
    assert.deepEqual(
      Array.from(sandbox.roleStocks(fixture, "当日龙头"), (stock) => stock.code),
      ["910104"],
      `${target}: verified same-day active leader must use the 当日龙头 title`,
    );
    assert.deepEqual(
      Array.from(sandbox.roleStocks(fixture, "当日高度"), (stock) => stock.code),
      ["910102", "910103"],
      `${target}: daily height and high-board observations must stay outside 周期龙头`,
    );
    assert.deepEqual(
      Array.from(sandbox.roleStocks(fixture, "容量中军"), (stock) => stock.code),
      ["910105"],
      `${target}: capacity role must use the 容量中军 title`,
    );
    assert.deepEqual(
      Array.from(sandbox.roleStocks(fixture, "补涨"), (stock) => stock.code),
      ["910106"],
    );

    const cycleHtml = sandbox.renderRole(fixture, "周期龙头");
    assert.match(cycleHtml, /role-leader/);
    assert.match(cycleHtml, /周期龙头/);
    assert.match(cycleHtml, /cycle-core-sample/);
    assert.match(cycleHtml, /今日被动分歧/);
    assert.doesNotMatch(cycleHtml, /daily-strong-sample|height-only-sample|当日高度龙|连板高标/);

    const heightHtml = sandbox.renderRole(fixture, "当日高度");
    assert.match(heightHtml, /role-height/);
    assert.match(heightHtml, /当日高度/);
    assert.match(heightHtml, /daily-strong-sample/);
    assert.match(heightHtml, /height-only-sample/);
    assert.match(heightHtml, /高度风险观察/);
    assert.doesNotMatch(heightHtml, /情绪\/历史核心/);
    assert.doesNotMatch(heightHtml, /cycle-core-sample|周期龙头/);
    assert.match(sandbox.renderRole(fixture, "当日龙头"), /role-pioneer[\s\S]*pioneer-sample/);
    assert.match(sandbox.renderRole(fixture, "容量中军"), /role-capacity[\s\S]*capacity-sample/);
    assert.match(sandbox.renderRole(fixture, "补涨"), /role-catchup[\s\S]*catchup-sample/);

    const responseWiring = extractFunction(source, "renderThemeLibraryResponse");
    const decisionWiring = extractFunction(source, "renderDecisionThemeCard");
    for (const role of ["周期龙头", "当日龙头", "高度风险", "容量中军", "补涨"]) {
      assert.ok(source.includes(role), `${target}: missing visible role title ${role}`);
    }
    assert.match(responseWiring, /renderThemeRoleEvidenceGrid/);
    assert.match(decisionWiring, /renderThemeRoleEvidenceGrid/);
    assert.doesNotMatch(responseWiring, /\["龙头",\s*"先锋",\s*"中军",\s*"补涨"\]/);
    assert.doesNotMatch(decisionWiring, /\["龙头",\s*"先锋",\s*"中军",\s*"补涨"\]/);
  }
});

test("static build copies every local runtime asset referenced by the workspace shell", () => {
  for (const asset of ["sell-engine.js", "premarket-flow.js", "script.js", "styles.css", "ui-refresh.css", "favicon.ico"]) {
    assert.ok(buildStaticSource.includes(`"${asset}"`), `static build is missing ${asset}`);
  }
});

test("isolated recommendation keeps profit evidence but never enters market-confirming sections", () => {
  const sandbox = {
    escapeHtml: (value) => String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;"),
  };
  vm.runInNewContext(
    [
      extractFunction(scriptSource, "premarketFinite"),
      extractFunction(scriptSource, "premarketValueText"),
      extractFunction(scriptSource, "premarketTextRows"),
      extractFunction(scriptSource, "premarketRuleScore"),
      extractFunction(scriptSource, "premarketProjectionCardHtml"),
      extractFunction(scriptSource, "premarketProjectionSectionHtml"),
      extractFunction(scriptSource, "premarketPlainEmotionText"),
      extractFunction(scriptSource, "premarketEmotionLayerLabel"),
      extractFunction(scriptSource, "premarketEmotionStageLabel"),
      extractFunction(scriptSource, "premarketEmotionConclusion"),
      extractFunction(scriptSource, "premarketEmotionProjectionHtml"),
      "this.render = premarketEmotionProjectionHtml;",
    ].join("\n"),
    sandbox,
  );
  const html = sandbox.render({
    rankedAnchors: [{
      code: "600721",
      name: "independent-market-anchor",
      layer: "A",
      anchorScore: 95,
      influenceWeightPct: 100,
      profitEffectScore: 40,
      profitEffectWeightPct: 100,
      heat: { score: 95, evidence: [] },
      support: { score: null, evidence: [] },
      damage: { score: null, evidence: [] },
    }],
    isolatedAnchors: [{
      code: "600664",
      name: "isolated-profit-anchor",
      excludedFromMarketState: true,
      anchorScore: 99,
      influenceWeightPct: 0,
      profitEffectScore: 96,
      profitEffectWeightPct: 0,
      priceDiscoveryType: "turnover_reseal",
      priceDiscovery: { label: "turnover reseal", evidence: ["verified reseal"] },
      profitEffect: { evidence: ["profit score preserved"] },
    }],
    themeStages: [],
    marketStructure: {},
    tomorrowPaths: [],
  });
  const isolatedStart = html.indexOf('data-premarket-projection="emotion-isolated-anchors"');
  const profitStart = html.indexOf('data-premarket-projection="emotion-profit-effect"');
  const anchorStart = html.indexOf('data-premarket-projection="emotion-anchors"');
  const isolatedSection = html.slice(isolatedStart, profitStart);
  const marketConfirmingSections = html.slice(profitStart, anchorStart) + html.slice(anchorStart);

  assert.ok(isolatedStart >= 0 && profitStart > isolatedStart && anchorStart > profitStart);
  assert.match(isolatedSection, /isolated-profit-anchor/);
  assert.match(isolatedSection, /96 \/ 100/);
  assert.match(isolatedSection, /不参与市场判断/);
  assert.match(isolatedSection, /不能用自己证明自己的买点/);
  assert.doesNotMatch(marketConfirmingSections, /isolated-profit-anchor/);
  assert.equal((html.match(/isolated-profit-anchor/g) || []).length, 1);
});

test("trading-preference status separates confirmed style from blocked execution", () => {
  const sandbox = {};
  vm.runInNewContext(
    `${extractFunction(scriptSource, "premarketStatusMeta")}\nthis.statusMeta = premarketStatusMeta;`,
    sandbox,
  );
  const confirmedButLimited = {
    key: "tradingPreference",
    status: "blocked",
    canonicalState: { usable: true },
    dominantPath: { status: "dominant" },
    executionBlocked: true,
  };

  assert.deepEqual(
    { ...sandbox.statusMeta(confirmedButLimited) },
    { label: "风格已确认 · 执行受限", className: "is-conditional" },
  );
  assert.equal(
    sandbox.statusMeta({ ...confirmedButLimited, dominantPath: { status: "parallel" } }).label,
    "风格已确认 · 执行受限",
  );
  assert.equal(
    sandbox.statusMeta({ ...confirmedButLimited, canonicalState: { usable: false } }).label,
    "已否决",
  );
  assert.equal(
    sandbox.statusMeta({ ...confirmedButLimited, dominantPath: { status: "unknown" } }).label,
    "已否决",
  );
  assert.equal(
    sandbox.statusMeta({ ...confirmedButLimited, executionBlocked: false, status: "ready" }).label,
    "已确认",
  );
  assert.equal(sandbox.statusMeta({ key: "emotionStage", status: "blocked" }).label, "已否决");
});

test("trading-preference quote wording follows observation phase", () => {
  const preferenceSource = extractFunction(scriptSource, "premarketPreferenceProjectionHtml");
  assert.match(preferenceSource, /observationPhase === "preopen"/);
  assert.match(preferenceSource, /只盘前报价待形成；不按0%计分/);
  assert.match(preferenceSource, /只实时报价暂缺；不按0%计分/);
  assert.match(preferenceSource, /\["行情报价"/);
});
