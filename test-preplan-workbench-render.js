"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { buildPreplanScenarioWorkbench } = require("./preplan-scenario-workbench");

const scriptSource = fs.readFileSync(path.join(__dirname, "script.js"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const paramsStart = source.indexOf("(", start);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    if (source[index] === "(") paramsDepth += 1;
    if (source[index] === ")") paramsDepth -= 1;
    if (paramsDepth === 0) { paramsEnd = index; break; }
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
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

function renderer() {
  const sandbox = {};
  vm.runInNewContext(`
    function escapeHtml(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
    ${extractFunction(scriptSource, "renderPreplanScenarioWorkbench")}
    this.render = renderPreplanScenarioWorkbench;
  `, sandbox);
  return sandbox.render;
}

const GENERATION = {
  generationId: "2026-08-28:render",
  tradingDate: "2026-08-28",
  asOf: "2026-08-28T15:30:00.000Z",
};

function observation(code, name, hardGatePassed = true) {
  return {
    code,
    name,
    theme: "AI算力",
    path: "boardEmotion",
    pathLabel: "连板情绪",
    hardGatePassed,
    observationReason: "次日仍有条件预期",
    expectation: { status: "qualified", label: "核心溢价 / 晋级验证" },
    opportunityDataCompleteness: { status: "complete", qualified: true, opportunityEligible: true },
    executionFeasibility: { status: "conditional", executableNow: false, blockers: [] },
    entryConfirmation: { status: "waiting_trigger", reason: "等待真实分歧", triggerConditions: ["充分换手", "板块同步"], invalidation: "高标A杀" },
    postEntryNextDayExpectation: { status: "conditional", label: "核心溢价 / 晋级验证", riskLabel: "分歧兑现", premise: "条件观察", probability: null, calibrated: false },
    missingConditions: hardGatePassed ? ["竞价与开盘后出现主动承接"] : ["原交易硬门槛未通过：均线结构"],
    observationOnly: true,
    executable: false,
    executionAuthority: false,
  };
}

function workbench() {
  const payload = {
    ...GENERATION,
    generationContext: { ...GENERATION },
    tomorrowDecision: {
      emotionScenarioInference: {
        version: 1,
        status: "ready",
        calibrated: false,
        probability: null,
        ...GENERATION,
        scenarios: [
          { key: "repair_or_consensus", label: "修复延续", modelWeightPct: 60, rank: 1, probability: null, calibrated: false },
          { key: "divergence_continuation", label: "分歧延续", modelWeightPct: 22.4, rank: 2, probability: null, calibrated: false },
          { key: "negative_feedback_expansion", label: "负反馈扩散", modelWeightPct: 17.6, rank: 3, probability: null, calibrated: false },
        ],
        confidence: { score: 65, label: "中等" },
        guardrails: { observationOnly: true, selectionAuthority: false, executionAuthority: false, positionAuthority: false, probabilityAuthority: false },
      },
    },
    unifiedDecisionChain: {
      version: 3,
      authority: "canonical_stock_decision",
      generation: { ...GENERATION },
      observationCandidates: {
        status: "available",
        observationOnly: true,
        executionAuthority: false,
        stocks: [
          observation("600001", "杭电股份"),
          observation("600002", "<赛微电子>"),
          observation("600003", "康盛股份"),
          observation("600004", "天通股份", false),
          observation("600005", "红宝丽", false),
        ],
      },
    },
  };
  return buildPreplanScenarioWorkbench(payload, { formalPlans: [] });
}

test("重点观察页面只展示3张简明标的卡", () => {
  const html = renderer()(workbench(), {});

  assert.match(html, /重点观察标的[\s\S]*3只 · 09:25 \/ 09:35复核/);
  assert.equal((html.match(/class="preplan-focus-card"/g) || []).length, 3);
  assert.match(html, /杭电股份[\s\S]*看点[\s\S]*增强[\s\S]*失效/);
  assert.match(html, /&lt;赛微电子&gt;/);
  assert.match(html, /康盛股份/);
  assert.match(html, /09:25初筛 · 09:35复核 · 仅观察无执行权/);
  assert.doesNotMatch(html, /preplan-workbench-metrics|preplan-scenario-panel|preplan-diagnostic-panel|查看持仓与退出/);
  assert.doesNotMatch(html, /动态权重 60%|动态权重 22\.4%|动态权重 17\.6%/);
  assert.doesNotMatch(html, /直接买入提示|当前暂无可买入股票|明确买点|成功率|条件满足后可买入/);
  assert.doesNotMatch(html, /<赛微电子>/);
});

test("观察剧本夹带买入字段时前端失败关闭", () => {
  const step = workbench();
  step.conditionalScripts[0].buy = "不得显示";
  const html = renderer()(step, {});

  assert.match(html, /数据契约不可用/);
  assert.doesNotMatch(html, /不得显示/);
});
