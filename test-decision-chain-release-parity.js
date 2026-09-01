"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { inspectAuthoritativeDecisionChain } = require("./quant-decision/decision-chain");

const root = __dirname;
const mobileRoot = path.resolve(root, "..", "a-share-trading-mobile");

function bytes(relativeRoot, relativeFile) {
  return fs.readFileSync(path.join(relativeRoot, relativeFile));
}

function digest(relativeRoot, relativeFile) {
  return crypto.createHash("sha256").update(bytes(relativeRoot, relativeFile)).digest("hex");
}

test("主项目、静态发布物和手机端使用同一前端决策链投影", () => {
  assert.equal(digest(root, "script.js"), digest(path.join(root, "dist"), "script.js"));
  assert.equal(digest(root, "script.js"), digest(mobileRoot, "script.js"));
  const source = bytes(root, "script.js").toString("utf8");
  assert.match(source, /function resolveUnifiedDecisionChainProjection\(payload\)/);
  assert.match(source, /unifiedDecisionChain/);
});

test("手机端量化核心同源，专属服务接线同时保留统一链与移动鉴权", () => {
  [
    "core-emotion-lifecycle.js",
    "emotion-cycle-engine.js",
    "market-cap-carrier.js",
    "market-phase-detail.js",
    "sell-engine.js",
    "tomorrow-decision-context.js",
    "tomorrow-market-forecast.js",
    "trading-style-preference.js",
    "unified-quant-factors.js",
    path.join("quant-decision", "market-cycle-contract.js"),
    path.join("quant-decision", "stock-factor-engine.js"),
    path.join("quant-decision", "execution-feasibility.js"),
    path.join("quant-decision", "execution-replay.js"),
    path.join("quant-decision", "minute-evidence.js"),
    path.join("quant-decision", "outcome-evidence.js"),
    path.join("quant-decision", "decision-chain.js"),
    path.join("quant-decision", "decision-receipt.js"),
    path.join("quant-decision", "decision-receipt-audit.js"),
    path.join("quant-decision", "decision-outcome.js"),
    path.join("quant-decision", "decision-ledger.js"),
    path.join("quant-decision", "index.js"),
  ].forEach((file) => {
    assert.equal(digest(root, file), digest(mobileRoot, file), file);
  });
  const mobileServer = bytes(mobileRoot, "server.js").toString("utf8");
  assert.match(mobileServer, /executeUnifiedDecisionChain/);
  assert.match(mobileServer, /buildUnifiedStockFactorDecision/);
  assert.match(mobileServer, /provisionalBestPicks/);
  assert.match(mobileServer, /inspectAuthoritativeDecisionChain/);
  assert.match(mobileServer, /unifiedDecisionChain/);
  assert.match(mobileServer, /createMobileAuth/);
  assert.match(mobileServer, /mobileAuth\.handle\(request, response, pathname\)/);
  assert.match(bytes(mobileRoot, "sw.js").toString("utf8"), /decision-chain-v3/);
});

test("静态数据只允许v3权威链；契约无效时必须空股票和零仓位", () => {
  const payload = JSON.parse(bytes(path.join(root, "dist"), "data.json").toString("utf8"));
  const chain = payload.unifiedDecisionChain || {};
  assert.equal(chain.version, 3);
  assert.equal(chain.authority, "canonical_stock_decision");
  assert.equal(chain.method, "strict_sequential_fail_closed_v1");
  const inspected = inspectAuthoritativeDecisionChain(payload, { requireBestPicksProjection: true });
  const factorEngineAligned = payload.bestPicks
    && payload.bestPicks.factorEngineAuthority === "unified_stock_factor_engine_v4"
    && Number(payload.bestPicks.factorEngineVersion) === 2;
  if (chain.integrity && chain.integrity.ok === true && factorEngineAligned) {
    assert.equal(inspected.valid, true, inspected.reasons.join("；"));
  } else {
    // dist/data.json 是运行快照，不进入源码提交。旧快照缺少新因子权威时
    // 只能保留失败关闭的空股票、0%仓位，不得被静态版补成可执行结果。
    assert.deepEqual(chain.result && chain.result.selectedCodes || [], []);
    assert.deepEqual(payload.bestPicks && payload.bestPicks.picks || [], []);
    assert.equal(Number(chain.authorization && chain.authorization.positionPermission
      && chain.authorization.positionPermission.positionCeilingPct || 0), 0);
  }
});
