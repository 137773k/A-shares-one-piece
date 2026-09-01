"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const targetRoot = process.env.THEME_ROLE_RENDER_ROOT
  ? path.resolve(process.env.THEME_ROLE_RENDER_ROOT)
  : __dirname;
const scriptSource = fs.readFileSync(path.join(targetRoot, "script.js"), "utf8");
const cssSource = fs.readFileSync(path.join(targetRoot, "ui-refresh.css"), "utf8");
const targetLabel = path.basename(targetRoot);

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

function rendererSource(source) {
  const start = source.indexOf("const THEME_LIBRARY_DISPLAY_ROLES");
  assert.notEqual(start, -1, `${targetLabel}: missing theme-library renderer start`);
  const responseFunction = extractFunction(source, "renderThemeLibraryResponse");
  const responseStart = source.indexOf(responseFunction);
  assert.ok(responseStart > start, `${targetLabel}: invalid theme-library renderer order`);
  return source.slice(start, responseStart + responseFunction.length);
}

function createHarness() {
  const nodes = {
    list: { innerHTML: "" },
    meta: { innerHTML: "" },
    summary: { innerHTML: "" },
    select: { innerHTML: "" },
  };
  const selectors = new Map([
    ["#themeLibraryList", nodes.list],
    ["#themeLibraryMeta", nodes.meta],
    ["#themeLibrarySummary", nodes.summary],
    ["#themeLibraryDateSelect", nodes.select],
  ]);
  const sandbox = {
    document: { querySelector(selector) { return selectors.get(selector) || null; } },
  };
  vm.runInNewContext(`
    const themeLibraryViewState = {
      loaded: false,
      selectedDate: "",
      latestDate: "",
      response: null,
    };
    function escapeHtml(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }
    function formatMaybeNumber(value, digits = 1) {
      const number = Number(value);
      return Number.isFinite(number) ? number.toFixed(digits) : "--";
    }
    function formatTime(value) { return String(value || "--"); }
    ${rendererSource(scriptSource)}
    this.render = renderThemeLibraryResponse;
  `, sandbox);
  return { nodes, render: sandbox.render };
}

function evidence(key, value, source, tradingDate = "2026-08-14") {
  return { key, value, source, tradingDate };
}

function roleCard(roleKey, overrides = {}) {
  const defaults = roleKey === "cycleLeader"
    ? {
      roleKey: "cycleLeader",
      roleLabel: "周期龙头",
      roleScope: "cycle",
      status: "retained",
      stock: { code: "600664", name: "哈药股份", changePct: 4.2 },
      tradingDate: "2026-08-14",
      source: "themeLibrary.cycleLeadership.primary",
      evidence: [
        evidence("crossDayIdentity", "连续三个交易日保持资金聚焦", "cycleLeadership.identities.600664"),
        evidence("themeImpact", "带动医药同题材股票回流", "leadership.impactEvidence"),
      ],
      gaps: ["明日承接尚未验证"],
      executionEligible: false,
    }
    : {
      roleKey: "dailyLeader",
      roleLabel: "当日龙头",
      roleScope: "session",
      status: "confirmed",
      stock: { code: "600664", name: "哈药股份", changePct: 4.2 },
      tradingDate: "2026-08-14",
      source: "leadership.initiative.session",
      evidence: [
        evidence("firstAttackTime", "09:37", "initiative.session.firstAttackTime"),
        evidence("followerCount", "带动3只同题材股票", "initiative.followerCount"),
      ],
      gaps: [],
      executionEligible: false,
    };
  return { ...defaults, ...overrides };
}

function heightRisk(overrides = {}) {
  return {
    code: "600721",
    name: "百花医药",
    changePct: -7.6,
    status: "risk_marker",
    source: "topicBoard.dailyHeightStocks",
    tradingDate: "2026-08-14",
    evidence: [
      evidence("height", "前一交易日市场高度代表", "leadership.heightEvidence"),
      evidence("negativeFeedback", "断板后明显负反馈", "todayState.changePct"),
    ],
    gaps: ["只代表高度风险，尚无跨日带动证据"],
    executionEligible: false,
    ...overrides,
  };
}

function theme(overrides = {}) {
  return {
    id: "medicine-innovation",
    rank: 1,
    name: "创新药",
    displayName: "创新药细分题材",
    isMainLine: true,
    label: "主线持续",
    score: 389,
    count: 9,
    limitCount: 4,
    todayLimitUpCount: 1,
    sector: { changePct: 2.55 },
    themeCycle: {
      key: "main_rise_strong_divergence",
      label: "主升内强分歧",
      source: "themeCycleEngine.current",
      tradingDate: "2026-08-14",
    },
    roleEvidenceCards: [roleCard("cycleLeader"), roleCard("dailyLeader")],
    dailyHeightStocks: [heightRisk()],
    stocks: [],
    ...overrides,
  };
}

function response(themes) {
  return {
    ok: true,
    available: true,
    latestDate: "2026-08-14",
    availableDates: [{ date: "2026-08-14" }],
    previousAvailable: false,
    snapshot: {
      tradingDate: "2026-08-14",
      generatedAt: "2026-08-14T15:20:00.000Z",
      sourceUpdatedAt: "2026-08-14T15:18:00.000Z",
      snapshotKind: "closing",
      themeCount: themes.length,
      stockCount: 2,
      marketCycle: {
        key: "main_rise",
        label: "大周期主升",
        source: "marketCycle.canonical",
        tradingDate: "2026-08-14",
      },
      themes,
    },
  };
}

function render(themes) {
  const harness = createHarness();
  harness.render(response(themes));
  return harness.nodes.list.innerHTML;
}

function roleSection(html, roleKey) {
  const marker = `data-theme-role-key="${roleKey}"`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${targetLabel}: missing ${roleKey} role section`);
  const next = html.indexOf('data-theme-role-key="', start + marker.length);
  return html.slice(start, next === -1 ? html.length : next);
}

test("题材库按 市场周期 → 具体题材周期 → 三种观察角色 展示，并移除当日先锋主栏", () => {
  const html = render([theme()]);

  assert.match(html, /当前市场周期/);
  assert.match(html, /大周期主升/);
  assert.match(html, /具体题材周期/);
  assert.match(html, /创新药/);
  assert.match(html, /主升内强分歧/);
  assert.ok(html.indexOf("大周期主升") < html.indexOf("主升内强分歧"), "market cycle must precede theme cycle");
  assert.match(html, /data-theme-role-key="cycleLeader"[^>]*[\s\S]*周期龙头/);
  assert.match(html, /data-theme-role-key="dailyLeader"[^>]*[\s\S]*当日龙头/);
  assert.match(html, /data-theme-role-key="heightRisk"[^>]*[\s\S]*高度风险/);
  assert.doesNotMatch(html, /class="theme-role-tag"[^>]*>当日先锋</);
  assert.match(html, /今日涨停\s*<b>1只<\/b>/);
  assert.doesNotMatch(html, /今日涨停\s*<b>4只<\/b>/, "historical board-height count must not masquerade as today's limit-up count");
});

test("同一只股票兼任周期龙头和当日龙头时只渲染一次，并保留双角色标签", () => {
  const html = render([theme()]);
  const stockMarker = 'data-theme-role-stock="600664"';

  assert.equal((html.match(new RegExp(stockMarker, "g")) || []).length, 1, "same stock must not be duplicated across role columns");
  const start = html.indexOf(stockMarker);
  assert.notEqual(start, -1);
  const stockHtml = html.slice(start, html.indexOf("</article>", start) + "</article>".length);
  assert.match(stockHtml, /周期龙头/);
  assert.match(stockHtml, /当日龙头/);
});

test("跌停或 challenged 的周期龙头仍保留身份，但明确受损且不可执行", () => {
  const challenged = roleCard("cycleLeader", {
    status: "challenged",
    stock: { code: "000531", name: "穗恒运A", changePct: -10.01 },
    evidence: [evidence("todayDamage", "跌停，周期身份受到挑战", "todayState.changePct")],
    gaps: ["结构修复未确认", "主动带动尚未恢复"],
    executionEligible: false,
  });
  const noDailyLeader = roleCard("dailyLeader", {
    status: "none",
    stock: null,
    evidence: [],
    gaps: [],
  });
  const html = render([theme({ roleEvidenceCards: [challenged, noDailyLeader] })]);
  const cycleHtml = roleSection(html, "cycleLeader");

  assert.match(cycleHtml, /穗恒运A/);
  assert.match(cycleHtml, /-10\.01%/);
  assert.match(cycleHtml, /受损|受到挑战/);
  assert.match(cycleHtml, /不可执行/);
  assert.doesNotMatch(cycleHtml, /身份失效|自动剔除/);
});

test("周期龙头空态严格区分：证据完整但无龙头 vs 数据缺失无法判断", () => {
  const completeNone = roleCard("cycleLeader", {
    status: "none",
    stock: null,
    evidence: [evidence("coverage", "本周期候选已完整核验", "cycleLeadership.coverage")],
    gaps: [],
  });
  const unavailable = roleCard("cycleLeader", {
    status: "unavailable",
    stock: null,
    source: "themeLibrary.cycleLeadership",
    evidence: [],
    gaps: ["缺少上一交易日收盘快照"],
  });

  const completeHtml = roleSection(render([theme({ roleEvidenceCards: [completeNone, roleCard("dailyLeader")] })]), "cycleLeader");
  assert.match(completeHtml, /本周期暂无已确认龙头/);
  assert.doesNotMatch(completeHtml, /无法判断/);

  const unavailableHtml = roleSection(render([theme({ roleEvidenceCards: [unavailable, roleCard("dailyLeader")] })]), "cycleLeader");
  assert.match(unavailableHtml, /数据不足[^<]*无法判断|无法判断[^<]*数据不足/);
  assert.match(unavailableHtml, /缺少上一交易日收盘快照/);
  assert.doesNotMatch(unavailableHtml, /本周期暂无已确认龙头/);
});

test("空态证据的 key、value、source 与缺口全部转义，不能注入 HTML", () => {
  const attack = '<img src=x onerror="alert(1)">';
  const empty = roleCard("cycleLeader", {
    status: "none",
    stock: null,
    source: `card-source-${attack}`,
    evidence: [{
      key: `key-${attack}`,
      value: `value-${attack}`,
      source: `row-source-${attack}`,
      tradingDate: "2026-08-14",
    }],
    gaps: [`gap-${attack}`],
  });
  const html = roleSection(render([theme({ roleEvidenceCards: [empty, roleCard("dailyLeader")] })]), "cycleLeader");

  assert.ok((html.match(/&lt;img/g) || []).length >= 4, "every hostile field must survive only as escaped text");
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /onerror\s*=\s*"/i);
});

test("周期龙头、当日龙头和高度风险每张卡都显示证据、来源、日期、缺口与不可执行边界", () => {
  const html = render([theme()]);

  for (const roleKey of ["cycleLeader", "dailyLeader", "heightRisk"]) {
    const section = roleSection(html, roleKey);
    assert.match(section, /验证与证据|证据/);
    assert.match(section, /来源/);
    assert.match(section, /2026-08-14/);
    assert.match(section, /缺口/);
    assert.match(section, /不可执行/);
  }
  assert.match(roleSection(html, "cycleLeader"), /cycleLeadership\.identities\.600664/);
  assert.match(roleSection(html, "dailyLeader"), /initiative\.session\.firstAttackTime/);
  assert.match(roleSection(html, "heightRisk"), /只代表高度风险[^<]*尚无跨日带动证据/);
});

test("高度股不能冒充当日龙头：dailyLeader=none 时仍只出现在高度风险栏", () => {
  const noDailyLeader = roleCard("dailyLeader", {
    status: "none",
    stock: null,
    evidence: [evidence("dailyLeadership", "没有通过主动带动验证", "leadership.initiative")],
    gaps: [],
  });
  const html = render([theme({ roleEvidenceCards: [roleCard("cycleLeader"), noDailyLeader] })]);
  const dailyHtml = roleSection(html, "dailyLeader");
  const riskHtml = roleSection(html, "heightRisk");

  assert.match(dailyHtml, /当日暂无已确认龙头/);
  assert.doesNotMatch(dailyHtml, /百花医药/);
  assert.match(riskHtml, /百花医药/);
  assert.match(riskHtml, /高度风险/);
});

test("390px 契约：角色与证据区域单列、可收缩且长来源路径允许换行", () => {
  assert.match(cssSource, /@media\s*\(max-width:\s*(?:390|560|820)px\)[\s\S]*?\.theme-role-evidence-grid\s*\{[^}]*grid-template-columns:\s*(?:minmax\(0,\s*1fr\)|1fr)/);
  assert.match(cssSource, /\.theme-role-evidence-card\s*\{[^}]*min-width:\s*0/);
  assert.match(cssSource, /\.theme-role-evidence-(?:source|meta)[^{]*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(cssSource, /\.theme-role-evidence-card\s*\{[^}]*min-width:\s*(?:4\d\d|[5-9]\d{2,})px/);
});
