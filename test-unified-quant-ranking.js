"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = __dirname;
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const clientSource = fs.readFileSync(path.join(root, "script.js"), "utf8");
const factorSource = fs.readFileSync(path.join(root, "quant-decision", "stock-factor-engine.js"), "utf8");

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `缺少起始标记：${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `缺少结束标记：${end}`);
  return source.slice(startIndex, endIndex);
}

test("最终个股排序不再复用旧观察总分，同类题材和角色只取一次", () => {
  const body = sourceBetween(factorSource, "function buildUnifiedStockFactorDecision(input = {}) {", "module.exports = {");
  assert.doesNotMatch(body, /stock\s*&&\s*stock\.score|stock\.score\s*\*/);
  assert.doesNotMatch(body, /baseMultiplier/);
  assert.match(body, /themePosition:\s*Math\.max\(focusHit, supportHit, mainHit\)/);
  assert.match(body, /const baseRoleScore = Math\.max\(/);
  assert.match(body, /stockRole:\s*stockRoleScore/);
  assert.match(body, /leadershipWeighting\.overallWeight/);
  assert.match(body, /buildRoleScore\(stock, decisionKey, authority\)/);
  assert.match(body, /buildTicketTypeScore\(stock, decisionKey, authority\)/);
  assert.match(body, /baseObservationScoreUsed:\s*false/);
  assert.doesNotMatch(body, /canGame\)\s*rank\s*\+=/);
  assert.match(serverSource, /buildUnifiedStockFactorDecision\(\{/);
});

test("风险层只做减分，参与价值与风险调整分开记录", () => {
  const riskBody = sourceBetween(factorSource, "function buildRiskAdjustment(stock, decisionKey, executionFeasibility) {", "function buildUnifiedStockFactorDecision(input = {}) {");
  assert.doesNotMatch(riskBody, /components\.[A-Za-z]+\s*\+=\s*[1-9]/);
  assert.match(riskBody, /priceExhaustion/);
  assert.match(riskBody, /negativeFeedback/);
  assert.match(riskBody, /drawdown/);
  assert.match(riskBody, /cancelCondition/);
  assert.match(riskBody, /executionFeasibility/);
  assert.match(serverSource, /factorDecision:\s*factorDecisionByStock\.get\(stock\)/);
  assert.match(serverSource, /stock\.factorDecision\s*=\s*decision/);
});

test("题材内部排序不读取个股总分，切换真实主线后重新评分", () => {
  const orderingBody = sourceBetween(serverSource, "      const ordered = members.slice().sort", "      // 龙头梯队");
  assert.doesNotMatch(orderingBody, /\.score/);
  assert.match(orderingBody, /combinedRank/);
  assert.match(orderingBody, /amountYi/);
  assert.match(serverSource, /const rescored = scoreCandidate\(item, decisionHotConcepts/);
});

test("主要页面显式读取统一大周期、小周期和宏微观炒作偏好", () => {
  const resolverBody = sourceBetween(
    clientSource,
    "function resolveUnifiedDecisionChainProjection(payload)",
    "function setText(selector, text)",
  );
  const selectionBody = sourceBetween(
    clientSource,
    "function renderSelectionPools(payload)",
    "function handleSpecAction(event)",
  );
  assert.match(resolverBody, /source\.unifiedDecisionChain/);
  assert.match(resolverBody, /canonical_stock_decision/);
  assert.doesNotMatch(selectionBody, /unifiedQuantFactors|payload\.selected/);
  assert.match(clientSource, /情绪大周期（短线情绪算法）/);
  assert.match(clientSource, /小周期（微观算法）/);
  assert.match(clientSource, /统一炒作偏好/);
  assert.match(clientSource, /macro_micro_overlay/);
  assert.match(clientSource, /positionAllocation/);
  assert.match(clientSource, /参与价值/);
  assert.match(clientSource, /初始.*上限/);
});
