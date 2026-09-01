"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const desktopRoot = __dirname;
const mobileRoot = path.resolve(desktopRoot, "..", "a-share-trading-mobile");

const targets = [
  {
    label: "desktop",
    html: fs.readFileSync(path.join(desktopRoot, "index.html"), "utf8"),
    uiCss: fs.readFileSync(path.join(desktopRoot, "ui-refresh.css"), "utf8"),
    script: fs.readFileSync(path.join(desktopRoot, "script.js"), "utf8"),
  },
  {
    label: "mobile",
    html: fs.readFileSync(path.join(mobileRoot, "index.html"), "utf8"),
    uiCss: fs.readFileSync(path.join(mobileRoot, "ui-refresh.css"), "utf8"),
    mobileCss: fs.readFileSync(path.join(mobileRoot, "mobile.css"), "utf8"),
    script: fs.readFileSync(path.join(mobileRoot, "script.js"), "utf8"),
  },
];

const LEGACY_AUTO_PICKER_IDS = Object.freeze([
  "premarketStockFlow",
  "fetchHotStocks",
  "hotUpdatedAt",
  "eastCount",
  "thsCount",
  "fetchStatusBadge",
  "fetchStatusIssues",
  "marketCycle",
  "marketOperation",
  "marketAmount",
  "marketBreadth",
  "marketScore",
  "marketPosition",
  "marketBreadthBreakdown",
  "tradingStyle",
  "tradingPreference",
  "tradingBias",
  "marketSummary",
  "hotConcepts",
  "externalLevel",
  "externalIndexes",
  "externalCoreQuotes",
  "externalReasons",
  "globalNewsList",
  "riskBoardLevel",
  "riskBoardSummary",
  "riskBoardList",
  "emotionAnchorMeta",
  "emotionAnchorTitle",
  "emotionAnchorReason",
  "capacityAnchorMeta",
  "capacityAnchorTitle",
  "capacityAnchorReason",
  "frameworkContinuityLabel",
  "frameworkHeadline",
  "frameworkSubline",
  "frameworkSignals",
  "frameworkReasons",
  "topicBoardConclusion",
  "topicBoardList",
  "styleAnalysisConclusion",
  "styleReverseLogic",
  "profitLocation",
  "profitContinuity",
  "profitCases",
  "continuityReasons",
  "backtestSummaryLabel",
  "btSamples",
  "btWinRate",
  "btAvgClose",
  "btAvgMax",
  "backtestNote",
  "selectedCycleBadge",
  "selectedStocks",
  "rejectedStocks",
]);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countId(source, id) {
  return (source.match(new RegExp(`\\bid=["']${escapeRegExp(id)}["']`, "g")) || []).length;
}

function autoPickerSection(source) {
  const start = source.indexOf('<section id="auto-picker"');
  assert.notEqual(start, -1, "missing #auto-picker section");
  const end = source.indexOf("</section>", start);
  assert.notEqual(end, -1, "unterminated #auto-picker section");
  return source.slice(start, end + "</section>".length);
}

function fullAnalysis(source) {
  const section = autoPickerSection(source);
  const start = section.indexOf('<details id="autoPickerFullAnalysis"');
  assert.notEqual(start, -1, "missing #autoPickerFullAnalysis");
  const end = section.indexOf("</details>", start);
  assert.notEqual(end, -1, "unterminated #autoPickerFullAnalysis");
  return section.slice(start, end + "</details>".length);
}

function fullAnalysisBody(source) {
  const details = fullAnalysis(source);
  const start = details.indexOf('<div class="auto-picker-full-analysis-body">');
  assert.notEqual(start, -1, "missing full-analysis body");
  return details.slice(start + '<div class="auto-picker-full-analysis-body">'.length, details.lastIndexOf("</div>"));
}

function cssRule(source, selector) {
  const start = source.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing CSS rule ${selector}`);
  const end = source.indexOf("}", start);
  assert.notEqual(end, -1, `unterminated CSS rule ${selector}`);
  return source.slice(start, end + 1);
}

test("desktop and mobile expose the new post-close mount before a closed legacy disclosure", () => {
  for (const target of targets) {
    const section = autoPickerSection(target.html);
    const details = fullAnalysis(target.html);
    const detailsTag = details.slice(0, details.indexOf(">") + 1);
    const mountIndex = section.indexOf('id="postCloseOpportunityView"');
    const detailsIndex = section.indexOf('id="autoPickerFullAnalysis"');

    assert.equal(countId(target.html, "postCloseOpportunityView"), 1, `${target.label}: mount must be unique`);
    assert.equal(countId(target.html, "autoPickerFullAnalysis"), 1, `${target.label}: disclosure must be unique`);
    assert.ok(mountIndex >= 0 && mountIndex < detailsIndex, `${target.label}: concise report must precede legacy analysis`);
    assert.doesNotMatch(detailsTag, /\sopen(?:\s|=|>)/i, `${target.label}: legacy analysis must be closed by default`);
    assert.match(section, /id="postCloseOpportunityView"[^>]*aria-live="polite"/);
    assert.match(details, /<summary[^>]*class="auto-picker-full-analysis-summary"/);
    assert.match(details, />查看完整分析</);
  }
});

test("all legacy auto-picker ids stay unique and remain inside the disclosure", () => {
  for (const target of targets) {
    const details = fullAnalysis(target.html);
    for (const id of LEGACY_AUTO_PICKER_IDS) {
      assert.equal(countId(target.html, id), 1, `${target.label}: #${id} must remain unique`);
      assert.equal(countId(details, id), 1, `${target.label}: #${id} must remain inside #autoPickerFullAnalysis`);
    }
  }
});

test("desktop and mobile preserve the same legacy analysis body", () => {
  const normalizeLineEndings = (value) => String(value).replace(/\r\n/g, "\n").trim();
  assert.equal(
    normalizeLineEndings(fullAnalysisBody(targets[0].html)),
    normalizeLineEndings(fullAnalysisBody(targets[1].html)),
  );
});

test("legacy event-delegation entry points remain intact", () => {
  for (const target of targets) {
    assert.match(target.script, /fetchHotStocks\.addEventListener\("click",\s*loadHotStocks\)/);
    assert.match(target.script, /selectedStocks\.addEventListener\("click"/);
    assert.match(target.script, /rejectedStocks\.addEventListener\("click"/);
    assert.match(target.script, /for \(const pool of \[selectedStocks, rejectedStocks\]\)/);
    assert.match(target.script, /querySelectorAll\("#auto-picker \[data-preplan\]"\)/);
  }
});

test("shared CSS provides readable desktop grids and an accessible disclosure", () => {
  for (const target of targets) {
    const summaryRule = cssRule(target.uiCss, ".auto-picker-full-analysis-summary");
    const minHeight = Number((summaryRule.match(/min-height:\s*(\d+)px/) || [])[1]);
    assert.ok(minHeight >= 44, `${target.label}: disclosure target must be at least 44px`);
    assert.match(target.uiCss, /\.post-close-opportunity-theme-grid,[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(target.uiCss, /@media \(max-width:\s*1180px\)[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(target.uiCss, /@media \(max-width:\s*820px\)[\s\S]*?\.post-close-opportunity-theme-grid,[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(target.uiCss, /\.post-close-opportunity[\s\S]*?overflow-wrap:\s*anywhere/);
    assert.match(target.uiCss, /\.auto-picker-full-analysis-body[\s\S]*?overflow-x:\s*hidden/);
  }
});

test("mobile override keeps the opportunity report single-column and readable", () => {
  const mobileCss = targets[1].mobileCss;
  assert.match(mobileCss, /Post-close opportunity: mobile reading order/);
  assert.match(mobileCss, /\.post-close-opportunity-theme-grid,[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(mobileCss, /opportunity-headline[\s\S]*?font-size:\s*clamp\(24px,\s*7vw,\s*28px\)/);
  assert.match(mobileCss, /opportunity-reason[\s\S]*?font-size:\s*15px/);
  assert.match(mobileCss, /\.auto-picker-full-analysis-summary[\s\S]*?min-height:\s*56px/);
  assert.match(mobileCss, /#auto-picker[\s\S]*?overflow-x:\s*hidden/);
});
