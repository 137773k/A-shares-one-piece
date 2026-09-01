"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const desktopSource = fs.readFileSync(path.join(__dirname, "script.js"), "utf8");
const mobileSource = fs.readFileSync(path.resolve(__dirname, "..", "a-share-trading-mobile", "script.js"), "utf8");

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

function loadContext(source) {
  const sandbox = {};
  const unifiedResolver = source.includes("function resolveUnifiedDecisionChainProjection(")
    ? [extractFunction(source, "resolveUnifiedDecisionChainProjection")]
    : [];
  vm.runInNewContext(
    [
      ...unifiedResolver,
      extractFunction(source, "sellAdvisorResolveDecisionContext"),
      extractFunction(source, "sellAdvisorBuildContextFacts"),
      "this.resolve = sellAdvisorResolveDecisionContext;",
      "this.buildFacts = sellAdvisorBuildContextFacts;",
    ].join("\n"),
    sandbox,
  );
  return sandbox;
}

function fixture() {
  const generationId = "2026-08-23:post-close";
  const tradingDate = "2026-08-23";
  const asOf = "2026-08-23T15:30:00+08:00";
  return {
    generationId,
    tradingDate,
    asOf,
    unifiedDecisionChain: {
      version: 3,
      method: "strict_sequential_fail_closed_v1",
      authority: "canonical_stock_decision",
      generation: { generationId, tradingDate, asOf, aligned: true },
      marketStage: {
        passed: true,
        bigCycle: { key: "range", label: "震荡" },
        transition: { key: "range_divergence", label: "震荡结构" },
        smallCycle: { key: "range_divergence", label: "震荡分歧" },
        emotionStage: { key: "divergence", label: "分歧" },
        previousEmotionStage: { key: "unknown", label: "情绪阶段待确认" },
      },
      authorization: {
        passed: false,
        tradePermission: { allowNew: false },
        positionPermission: { positionCeilingPct: 0, initialActivationPct: 0 },
      },
      profitEffect: {},
      theme: { themes: ["光纤概念", "医药"] },
      stockMode: {},
      stockSelectionContext: {},
      result: { status: "blocked", maxStocks: 5, selectedCount: 0, selectedCodes: [], stocks: [] },
      integrity: {
        ok: true,
        failClosed: true,
        noForcedCandidate: true,
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
    },
    market: {
      state: {
        cycle: "混沌",
        subPhase: "修复加强",
        operation: "聚焦",
        position: "20%-40%",
        metrics: { indexScore: 61 },
      },
      tradingStyle: { position: "20%-40%", preference: "轮动回流" },
    },
    topicBoard: {
      mainLine: { name: "光纤概念", displayName: "旧字段：AI算力 / 光纤概念" },
    },
    tomorrowDecision: {
      generationId,
      tradingDate,
      asOf,
      market: {
        cycle: "震荡",
        corePhase: "情绪阶段待确认",
        indexSubPhase: { label: "震荡结构·暂无主升细分" },
        mediumStructure: { label: "中期震荡" },
        decisionContext: {
          bigCycle: { label: "冰点反弹" },
          smallCycle: { label: "震荡分歧" },
          emotionStage: { label: "分歧" },
          speculationPreference: {
            summary: "低位 / 连板 / 趋势 / 补涨",
            confirmedLabels: ["低位"],
            observedLabels: ["连板", "趋势", "补涨"],
          },
        },
      },
      tomorrowBaseline: {
        label: "证据不足·防守观察",
        action: "暂不新开仓",
        reason: "严格阶段证据不足",
        riskDefault: true,
      },
      opportunityMap: {
        globalGate: { canTradeCandidates: false },
        directions: [
          {
            id: "AI算力",
            name: "光纤概念",
            family: "AI算力",
            threadRole: "main",
            evidence: { rankingScore: 944, sourceThemeNames: ["AI算力 / 光纤概念"] },
            emotionAnchors: [{ code: "600487", name: "亨通光电" }],
          },
          {
            id: "医药",
            name: "医药",
            family: "医药",
            threadRole: "parallel",
            evidence: { rankingScore: 721, sourceThemeNames: ["医药"] },
            emotionAnchors: [{ code: "600664", name: "哈药股份" }],
          },
        ],
      },
    },
    postCloseOpportunity: {
      marketPermission: {
        canCreateOpportunities: false,
        positionLimit: "0%-20%",
      },
    },
  };
}

for (const [target, source] of [["desktop", desktopSource], ["mobile", mobileSource]]) {
  test(`${target}: sell advisor consumes the same canonical cycle and direction contract as tomorrow decision`, () => {
    const context = loadContext(source);
    const resolved = context.resolve(fixture());
    assert.equal(resolved.bigCycle, "震荡");
    assert.equal(resolved.smallCycle, "震荡分歧");
    assert.equal(resolved.marketState.cycle, "震荡");
    assert.equal(resolved.marketState.subPhase, "震荡分歧");
    assert.equal(resolved.marketState.operation, "交易授权关闭");
    assert.equal(resolved.marketState.position, "0%");
    assert.equal(resolved.mainLine.displayName, "光纤概念 / 医药");
    assert.deepEqual(Array.from(resolved.directions, (item) => item.name), ["光纤概念", "医药"]);
    assert.equal(resolved.gateClosed, true);
  });

  test(`${target}: visible sell-advisor facts include medical as a parallel watch direction`, () => {
    const context = loadContext(source);
    const model = context.buildFacts(fixture());
    const facts = Object.fromEntries(Array.from(model.facts, (item) => [item.label, item]));
    assert.equal(facts["当前周期"].value, "震荡 / 震荡分歧");
    assert.equal(facts["操作"].value, "交易授权关闭");
    assert.match(facts["操作"].note, /0%/);
    assert.match(facts["热点方向"].value, /主方向 光纤概念（AI算力）/);
    assert.match(facts["热点方向"].value, /并行方向 医药/);
    assert.match(facts["热点方向"].note, /只观察/);
    assert.match(facts["方向锚点（观察）"].value, /医药：哈药股份/);
    assert.match(facts["情绪节奏"].note, /情绪阶段待确认/);
    assert.doesNotMatch(model.metaText, /混沌|20%-40%/);
  });

  test(`${target}: renderer and assessment no longer read the legacy sell-advisor context directly`, () => {
    const renderSource = extractFunction(source, "renderSellAdvisor");
    const assessmentSource = extractFunction(source, "buildSellAdvisorAssessment");
    const conceptSource = extractFunction(source, "sellAdvisorResolveConceptProfile");
    assert.match(renderSource, /sellAdvisorBuildContextFacts\(payload\)/);
    assert.doesNotMatch(renderSource, /hotConcepts\[0\]/);
    assert.match(assessmentSource, /sellAdvisorResolveDecisionContext\(payload\)/);
    assert.match(conceptSource, /decisionContext\.directions/);
  });
}

test("desktop sell advisor fails closed when the unified decision chain is unavailable", () => {
  const context = loadContext(desktopSource);
  const payload = fixture();
  delete payload.tomorrowDecision;
  delete payload.postCloseOpportunity;
  delete payload.unifiedDecisionChain;
  const resolved = context.resolve(payload);
  assert.equal(resolved.bigCycle, "大周期待确认");
  assert.equal(resolved.smallCycle, "小周期待确认");
  assert.equal(resolved.marketState.position, "0%");
  assert.equal(resolved.marketState.operation, "交易授权关闭");
  assert.equal(resolved.mainLine, null);
});
