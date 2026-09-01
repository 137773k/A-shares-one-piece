"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DECISION_ENGINE_FILES,
  SERVER_ENGINE_FUNCTIONS,
  loadDecisionEngineLock,
  validateDecisionEngineLock,
} = require("./backtest/decision-engine-lock");

test("当前决策引擎文件与server内关键决策函数保持冻结", () => {
  const lock = loadDecisionEngineLock();
  const inspection = validateDecisionEngineLock(lock);
  assert.equal(inspection.valid, true, inspection.reasons.join("；"));
  assert.equal(inspection.fileCount, DECISION_ENGINE_FILES.length);
  assert.equal(inspection.serverFunctionCount, SERVER_ENGINE_FUNCTIONS.length);
  assert.equal(lock.policy.decisionLogicChangesRequireUserApproval, true);
  assert.equal(lock.policy.providerChangesMustNotChangeLockedHashes, true);
  assert.equal(lock.policy.dataAdaptersCannotGrantExecution, true);
});

test("数据源、缓存、HTTP与桌面代码不得伪装成冻结决策引擎", () => {
  const forbidden = new Set([
    "server.js", "archiver.js", "desktop-main.js", "script.js",
    "eastmoney-fetcher.js", "hot-rank-source.js", "market-calendar.js",
  ]);
  DECISION_ENGINE_FILES.forEach((file) => assert.equal(forbidden.has(file), false, file));
  assert(SERVER_ENGINE_FUNCTIONS.includes("buildCanonicalBestPicks"));
  assert(SERVER_ENGINE_FUNCTIONS.includes("refreshTomorrowDecision"));
});
