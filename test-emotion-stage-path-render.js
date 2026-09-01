"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const targetRoot = process.env.EMOTION_STAGE_PATH_RENDER_ROOT
  ? path.resolve(process.env.EMOTION_STAGE_PATH_RENDER_ROOT)
  : __dirname;
const targetLabel = path.basename(targetRoot);
const scriptSource = fs.readFileSync(path.join(targetRoot, "script.js"), "utf8");
const cssSource = fs.readFileSync(path.join(targetRoot, "ui-refresh.css"), "utf8");
const indexSource = fs.readFileSync(path.join(targetRoot, "index.html"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${targetLabel}: missing ${name}`);
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

function createRenderer() {
  const renderer = extractFunction(scriptSource, "renderEmotionStagePath");
  const sandbox = {};
  vm.runInNewContext(`
    function escapeHtml(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }
    ${renderer}
    this.render = renderEmotionStagePath;
  `, sandbox);
  return sandbox.render;
}

function strictCore(code, name, stateKey, stateLabel, evidence) {
  return { code, name, stateKey, stateLabel, evidence: [evidence] };
}

function scenarioInference() {
  return {
    version: 1,
    method: "same_generation_evidence_weighted_emotion_scenario_v1",
    status: "ready",
    calibrated: false,
    probability: null,
    tradingDate: "2026-08-15",
    scenarios: [
      { key: "repair_or_consensus", label: "修复延续 / 重新一致", modelWeightPct: 54, rank: 1, probability: null, calibrated: false },
      { key: "divergence_continuation", label: "分歧延续", modelWeightPct: 31, rank: 2, probability: null, calibrated: false },
      { key: "negative_feedback_expansion", label: "负反馈扩散", modelWeightPct: 15, rank: 3, probability: null, calibrated: false },
    ],
    confidence: { score: 64, label: "中等", canShowPercentages: true },
    groups: [
      { key: "core", label: "市场情绪核心", weight: 30, coveragePct: 100, primaryScenario: "repair_or_consensus", reasons: ["核心正面影响占优"] },
      { key: "profitLoss", label: "赚钱 / 亏钱效应", weight: 30, coveragePct: 85, primaryScenario: "repair_or_consensus", reasons: ["赚钱效应扩张"] },
    ],
    guardrails: {
      observationOnly: true,
      emotionStageAuthority: false,
      selectionAuthority: false,
      executionAuthority: false,
      positionAuthority: false,
      probabilityAuthority: false,
      historicalCalibrationRequiredForProbabilityClaim: true,
    },
    integrity: {
      sameGeneration: true,
      scenarioWeightsSumTo100: true,
      groupWeightsSumTo100: true,
      criticalGroupsReady: true,
      noTradeAuthority: true,
    },
  };
}

function readyPath(overrides = {}) {
  return {
    version: 1,
    status: "ready",
    exactPreviousTradingDay: true,
    expectedPreviousTradingDate: "2026-08-14",
    previous: {
      status: "ready",
      tradingDate: "2026-08-14",
      stageKey: "divergence",
      stageLabel: "昨日分歧",
      strictCoreStatus: "ready",
      strictCoreStates: [
        strictCore("600001", "昨日核心甲", "divergence", "分歧", "昨日断板后分歧"),
        strictCore("600002", "昨日核心乙", "supported", "承接", "昨日回落后有承接"),
        strictCore("600003", "昨日核心丙", "repair_failed", "修复失败", "昨日修复失败并扩散"),
      ],
    },
    current: {
      status: "ready",
      tradingDate: "2026-08-15",
      stageKey: "divergence_continuation",
      stageLabel: "今日分歧延续",
      strictCoreStatus: "ready",
      strictCoreStates: [
        strictCore("600011", "今日核心甲", "divergence", "分歧", "今日高位换手分歧"),
        strictCore("600012", "今日核心乙", "supported", "承接", "今日回落后买盘承接"),
        strictCore("600013", "今日核心丙", "repair_failed", "修复失败", "今日回流失败转负反馈"),
      ],
    },
    riskBarometers: [{
      code: "600099",
      name: "高度风险甲",
      stateKey: "negative_feedback",
      stateLabel: "高位负反馈",
      votingWeight: 0,
      evidence: ["只代表高位压力，不能代表严格情绪核心"],
    }],
    tomorrow: {
      status: "baseline_unconfirmed",
      key: "divergence_continuation_first",
      label: "分歧延续优先，先看承接",
      calibrated: false,
      probability: 67,
      triggers: ["严格核心先分歧后出现主动承接", "负反馈没有继续向同题材和高位扩散"],
      cancelConditions: ["严格核心开盘直接加速且板块同步增强", "核心修复失败并带动同题材继续下杀"],
    },
    gaps: [],
    ...overrides,
  };
}

function render(value = readyPath()) {
  return createRenderer()(value);
}

function nodeSection(html, key) {
  const marker = `data-emotion-path-node="${key}"`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${targetLabel}: missing ${key} emotion-path node`);
  const next = html.indexOf('data-emotion-path-node="', start + marker.length);
  const risk = html.indexOf('class="emotion-stage-risk-context"', start + marker.length);
  const end = next !== -1 ? next : risk !== -1 ? risk : html.length;
  return html.slice(start, end);
}

test("情绪阶段路径图先展示三段实际状态，再展开具名核心证据", () => {
  const html = render();
  const previous = nodeSection(html, "previous");
  const current = nodeSection(html, "current");
  const tomorrow = nodeSection(html, "tomorrow");

  assert.match(html, /data-emotion-stage-path/);
  assert.match(html, /上一交易日状态 → 最新收盘状态 → 下一交易日观察基准/);
  assert.match(html, /data-emotion-path-summary-node="previous"[\s\S]*昨日分歧[\s\S]*2026-08-14/);
  assert.match(html, /data-emotion-path-summary-node="current"[\s\S]*今日分歧延续[\s\S]*2026-08-15/);
  assert.match(html, /data-emotion-path-summary-node="tomorrow"[\s\S]*分歧延续优先，先看承接[\s\S]*规则基准 · 非概率/);
  assert.ok(html.indexOf('data-emotion-path-node="previous"') < html.indexOf('data-emotion-path-node="current"'));
  assert.ok(html.indexOf('data-emotion-path-node="current"') < html.indexOf('data-emotion-path-node="tomorrow"'));
  assert.ok(html.indexOf('data-emotion-path-summary-node="tomorrow"') < html.indexOf('data-emotion-path-node="previous"'));
  assert.ok(html.indexOf('data-emotion-path-node="tomorrow"') < html.indexOf('class="emotion-stage-risk-context"'));
  assert.match(previous, /上一交易日状态[\s\S]*2026-08-14[\s\S]*昨日分歧/);
  assert.match(current, /最新收盘状态[\s\S]*2026-08-15[\s\S]*今日分歧延续/);
  assert.match(tomorrow, /下一交易日观察基准/);

  for (const [section, rows] of [
    [previous, [["昨日核心甲", "分歧"], ["昨日核心乙", "承接"], ["昨日核心丙", "修复失败"]]],
    [current, [["今日核心甲", "分歧"], ["今日核心乙", "承接"], ["今日核心丙", "修复失败"]]],
  ]) {
    for (const [name, state] of rows) {
      assert.match(section, new RegExp(`${name}[\\s\\S]*${state}`));
    }
    assert.match(section, /data-emotion-core-state=/);
  }
  assert.match(previous, /昨日断板后分歧/);
  assert.match(current, /今日回落后买盘承接/);
});

test("高位负反馈观察票明确标注非机会且保持权重0，不能混入严格核心", () => {
  const html = render();
  const previous = nodeSection(html, "previous");
  const current = nodeSection(html, "current");
  const tomorrow = nodeSection(html, "tomorrow");

  assert.match(html, /data-emotion-risk-barometer="600099"/);
  assert.match(html, /高度风险甲/);
  assert.match(html, /高位负反馈观察（非机会）/);
  assert.match(html, /仅观察负反馈[\s\S]*非推荐[\s\S]*投票权重\s*0/);
  assert.doesNotMatch(html, /等待分歧回流节点/);
  assert.match(html, /阶段由最多5只市场情绪核心按正负影响加权/);
  assert.doesNotMatch(previous, /高度风险甲/);
  assert.doesNotMatch(current, /高度风险甲/);
  assert.doesNotMatch(tomorrow, /高度风险甲/);
});

test("明日节点只显示未做历史校准的规则基准、触发与取消条件，忽略输入中的伪概率", () => {
  const tomorrow = nodeSection(render(), "tomorrow");

  assert.match(tomorrow, /规则基准（未做历史校准）/);
  assert.match(tomorrow, /不是历史胜率或概率承诺|不代表概率/);
  assert.match(tomorrow, /分歧延续优先，先看承接/);
  assert.match(tomorrow, /触发条件[\s\S]*严格核心先分歧后出现主动承接/);
  assert.match(tomorrow, /取消条件[\s\S]*核心修复失败并带动同题材继续下杀/);
  assert.doesNotMatch(tomorrow, /67\s*%/);
  assert.doesNotMatch(tomorrow, /\b\d+(?:\.\d+)?\s*%/);
  assert.doesNotMatch(tomorrow, /direct-probability-grid|style="width:/);
});

test("动态情景推演与规则基准同时展示，并明确不是历史胜率或交易权限", () => {
  const value = readyPath();
  value.tomorrow.scenarioInference = scenarioInference();
  const tomorrow = nodeSection(render(value), "tomorrow");

  assert.match(tomorrow, /当下证据动态推演[\s\S]*三种下一交易日情景/);
  assert.match(tomorrow, /修复延续 \/ 重新一致[\s\S]*动态权重 54%/);
  assert.match(tomorrow, /分歧延续[\s\S]*动态权重 31%/);
  assert.match(tomorrow, /负反馈扩散[\s\S]*动态权重 15%/);
  assert.match(tomorrow, /可信度中等 · 64\/100/);
  assert.match(tomorrow, /尚未历史校准，不是历史胜率，不生成买点、仓位或交易权限/);
  assert.match(tomorrow, /查看五组证据如何形成推演/);
});

test("动态推演权重或契约被篡改时前端关闭百分比，仅保留规则基准", () => {
  const value = readyPath();
  value.tomorrow.scenarioInference = scenarioInference();
  value.tomorrow.scenarioInference.scenarios[0].modelWeightPct = 99;
  const tomorrow = nodeSection(render(value), "tomorrow");

  assert.match(tomorrow, /契约校验未通过/);
  assert.match(tomorrow, /继续只使用规则基准，不显示推演百分比/);
  assert.doesNotMatch(tomorrow, /动态权重 99%/);
});

test("renderer直接兼容后端nodes/evidence/riskContext契约，不依赖测试专用扁平字段", () => {
  const path = {
    version: 1,
    status: "ready",
    order: ["previous", "current", "tomorrow"],
    nodes: {
      previous: {
        status: "ready",
        key: "divergence",
        label: "分歧",
        tradingDate: "2026-08-14",
        snapshotKind: "closing",
        evidence: {
          divergent: { rows: [{ code: "601001", name: "后端昨日核心", evidence: ["昨日具名分歧"] }] },
        },
        riskContext: { rows: [] },
      },
      current: {
        status: "ready",
        key: "supported",
        label: "承接修复",
        tradingDate: "2026-08-15",
        snapshotKind: "closing",
        evidence: {
          supported: { rows: [{ code: "601002", name: "后端今日核心", evidence: ["今日具名承接"] }] },
        },
        riskContext: {
          rows: [{ code: "601099", name: "后端风险票", state: "negative_feedback", votingWeight: 0, source: "closing_risk_proxy" }],
        },
      },
      tomorrow: {
        status: "baseline_unconfirmed",
        key: "divergence_continuation",
        label: "分歧延续优先",
        probability: 99,
        calibrated: false,
        trigger: ["承接出现后才观察"],
        cancel: ["负反馈继续扩散就取消"],
      },
    },
    gaps: [],
  };
  const html = render(path);
  const previous = nodeSection(html, "previous");
  const current = nodeSection(html, "current");
  const tomorrow = nodeSection(html, "tomorrow");

  assert.match(previous, /后端昨日核心[\s\S]*分歧[\s\S]*昨日具名分歧/);
  assert.match(current, /后端今日核心[\s\S]*承接[\s\S]*今日具名承接/);
  assert.match(html, /data-emotion-risk-barometer="601099"[\s\S]*后端风险票/);
  assert.match(tomorrow, /承接出现后才观察[\s\S]*负反馈继续扩散就取消/);
  assert.doesNotMatch(tomorrow, /99\s*%/);
});

test("严格核心平票时节点保持待确认，但仍具名展示每只核心的不同状态", () => {
  const path = {
    version: 1,
    status: "insufficient",
    order: ["previous", "current", "tomorrow"],
    nodes: {
      previous: { status: "unavailable", tradingDate: "2026-08-14", snapshotKind: "closing", gaps: ["缺少同版本T-1"] },
      current: {
        status: "insufficient",
        tradingDate: "2026-08-15",
        snapshotKind: "closing",
        gaps: ["严格核心状态平票，阶段不能确认"],
        evidence: {
          participating: { rows: [{ code: "602001", name: "平稳运行核心", evidence: ["仍保持周期聚焦"] }] },
          repairFailed: { rows: [{ code: "602002", name: "修复失败核心", evidence: ["修复失败并形成负反馈"] }] },
        },
        riskContext: { rows: [] },
      },
      tomorrow: { status: "baseline_unconfirmed", label: "先看承接", probability: null, calibrated: false },
    },
    gaps: ["严格核心状态平票，阶段不能确认"],
  };
  const current = nodeSection(render(path), "current");

  assert.match(current, /is-insufficient[\s\S]*严格核心不足，阶段待确认/);
  assert.match(current, /平稳运行核心[\s\S]*周期内平稳运行[\s\S]*仍保持周期聚焦/);
  assert.doesNotMatch(current, /正常参与/);
  assert.match(current, /修复失败核心[\s\S]*修复失败[\s\S]*修复失败并形成负反馈/);
  assert.doesNotMatch(current, /data-stage-confirmed="true"/);
});

test("缺少精确T-1时昨日节点灰色虚线降级，并明确日期与原因而不是展示旧阶段", () => {
  const value = readyPath({
    status: "partial",
    exactPreviousTradingDay: false,
    previous: {
      status: "unavailable",
      tradingDate: "2026-08-13",
      stageKey: "stale_consensus",
      stageLabel: "不得展示的旧一致",
      strictCoreStatus: "unavailable",
      strictCoreStates: [strictCore("600088", "不得展示的旧核心", "supported", "承接", "过期快照")],
      unavailableReason: "缺少精确T-1收盘快照，无法确认昨日严格核心阶段",
    },
    gaps: ["预期上一交易日为2026-08-14，但没有同版本收盘快照"],
  });
  const previous = nodeSection(render(value), "previous");

  assert.match(previous, /is-unavailable/);
  assert.match(previous, /2026-08-14/);
  assert.match(previous, /缺少精确T-1收盘快照/);
  assert.match(previous, /无法确认昨日严格核心阶段/);
  assert.doesNotMatch(previous, /不得展示的旧一致|不得展示的旧核心|过期快照/);
});

test("严格核心不足时阶段必须显示待确认，风险票不能替它补足确认", () => {
  const value = readyPath({
    status: "partial",
    current: {
      status: "insufficient",
      tradingDate: "2026-08-15",
      stageKey: "strong_divergence",
      stageLabel: "强分歧",
      strictCoreStatus: "insufficient",
      strictCoreStates: [],
      unavailableReason: "严格核心数量或身份校验不足",
    },
  });
  const html = render(value);
  const current = nodeSection(html, "current");

  assert.match(current, /is-insufficient/);
  assert.match(current, /data-stage-confirmed="false"/);
  assert.match(current, /严格核心不足[\s\S]*阶段待确认/);
  assert.doesNotMatch(current, /阶段已确认|data-stage-confirmed="true"/);
  assert.doesNotMatch(current, /高度风险甲/);
  assert.match(html, /data-emotion-risk-barometer="600099"[\s\S]*高度风险甲/);
});

test("T-1契约已回放且前后两日严格核心均为0时，必须显示资格为空而不是档案缺失", () => {
  const value = {
    version: 1,
    status: "insufficient",
    previousEvidenceRecovery: {
      status: "replayed_fail_closed",
      tradingDate: "2026-08-19",
      strictCoreCount: 0,
      riskBarometerCount: 10,
      futureDataUsed: false,
    },
    nodes: {
      previous: {
        status: "insufficient",
        tradingDate: "2026-08-19",
        snapshotKind: "closing",
        phaseReason: "strict_core_empty",
        evidence: { strictCoreCount: 0 },
        gaps: ["previous_strict_core_insufficient"],
      },
      current: {
        status: "insufficient",
        tradingDate: "2026-08-20",
        snapshotKind: "closing",
        phaseReason: "strict_core_empty",
        evidence: { strictCoreCount: 0 },
        gaps: ["current_strict_core_insufficient"],
      },
      tomorrow: { status: "baseline_unconfirmed", label: "先看承接", probability: null, calibrated: false },
    },
    gaps: ["昨日严格核心不足，不能确认昨日阶段", "今日严格核心不足，不能确认今日阶段"],
  };
  const html = render(value);
  const previous = nodeSection(html, "previous");
  const current = nodeSection(html, "current");

  assert.match(previous, /T-1档案已恢复，严格核心资格为0只/);
  assert.match(previous, /收盘契约已按原始历史代次完成回放/);
  assert.match(current, /当前严格核心资格结果为空（0只）/);
  assert.match(current, /不是档案缺失/);
  assert.doesNotMatch(html, /缺少精确T-1|缺少同版本精确T-1/);
});

test("路径图所有股票、证据和触发文本必须转义，不能注入HTML", () => {
  const attack = '<img src=x onerror="alert(1)">';
  const value = readyPath();
  value.current.strictCoreStates[0].name = attack;
  value.current.strictCoreStates[0].evidence = [attack];
  value.riskBarometers[0].name = attack;
  value.tomorrow.triggers = [attack];
  const html = render(value);

  assert.ok((html.match(/&lt;img/g) || []).length >= 4);
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /onerror\s*=\s*"/i);
});

test("新路径图接入明日决策时保留既有三路径、大小周期五项和其他页面入口", () => {
  const decisionRenderer = extractFunction(scriptSource, "renderDecisionDirectSummary");

  assert.match(decisionRenderer, /renderEmotionStagePath\s*\(/);
  assert.match(decisionRenderer, /direct-probability-grid/);
  assert.match(decisionRenderer, /direct-state-grid/);
  assert.match(decisionRenderer, /direct-opportunity-map/);
  for (const id of ["decision", "emotion-stage", "auto-picker"]) {
    assert.match(indexSource, new RegExp(`id=["']${id}["']`));
  }
});

test("390px契约：三节点改为单列、所有子项可收缩换行且缺T-1节点为虚线", () => {
  assert.match(cssSource, /\.emotion-stage-path\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/s);
  assert.match(cssSource, /\.emotion-stage-path-track\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(cssSource, /\.emotion-stage-path-node\s*\{[^}]*min-width:\s*0/s);
  assert.match(cssSource, /\.emotion-stage-path-node\.is-unavailable\s*\{[^}]*border-style:\s*dashed/s);
  assert.match(cssSource, /\.emotion-stage-(?:core-state|risk-card|path-node)[^{]*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(cssSource, /@media\s*\(max-width:\s*(?:390|480|560|820)px\)[\s\S]*?\.emotion-stage-path-track\s*\{[^}]*grid-template-columns:\s*(?:minmax\(0,\s*1fr\)|1fr)/);
  assert.doesNotMatch(cssSource, /\.emotion-stage-(?:path|path-track|path-node|core-state|risk-card)\s*\{[^}]*min-width:\s*(?:39[1-9]|[4-9]\d{2}|\d{4,})px/s);
});

test("后端证据码、缺口码和风险状态必须转成人话，不能把内部字段直接展示给用户", () => {
  const html = render({
    version: 1,
    status: "unavailable",
    nodes: {
      previous: {
        status: "unavailable",
        tradingDate: "2026-08-13",
        snapshotKind: "closing",
        gaps: ["exact_t1_closing_unavailable"],
      },
      current: {
        status: "insufficient",
        tradingDate: "2026-08-14",
        snapshotKind: "closing",
        gaps: ["current_strict_core_insufficient"],
        evidence: {
          repairFailed: {
            rows: [{
              code: "600901",
              name: "匿名严格核心",
              evidence: [
                { key: "cycle_identity_established", value: true },
                { key: "current_state", value: "repair_failed" },
              ],
            }],
          },
        },
        riskContext: {
          rows: [{ code: "600902", name: "匿名风险票", state: "local_repair", votingWeight: 0, source: "height_risk_trace" }],
        },
      },
      tomorrow: { status: "baseline_unconfirmed", label: "先看承接", probability: null, calibrated: false },
    },
    gaps: ["exact_t1_closing_unavailable", "current_strict_core_insufficient"],
  });

  assert.match(html, /缺少同版本精确T-1收盘严格核心证据/);
  assert.match(html, /今日严格核心状态未形成多数/);
  assert.match(html, /周期核心身份已建立：是/);
  assert.match(html, /当日状态：修复失败/);
  assert.match(html, /匿名风险票[\s\S]*局部修复[\s\S]*仅观察负反馈 · 非机会/);
  assert.doesNotMatch(html, /exact_t1_closing_unavailable|current_strict_core_insufficient|cycle_identity_established|height_risk_trace/);
});
