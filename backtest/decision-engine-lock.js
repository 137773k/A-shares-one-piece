"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { stableSerialize } = require("./contract");

const ENGINE_LOCK_AUTHORITY = "a_share_decision_engine_lock_v1";
const ENGINE_LOCK_VERSION = "v1";
const DEFAULT_ENGINE_LOCK_PATH = path.join(__dirname, "decision-engine-lock-v1.json");

const DECISION_ENGINE_FILES = Object.freeze([
  "core-emotion-lifecycle.js",
  "core-leadership.js",
  "cycle-leader-state.js",
  "emotion-big-cycle-window.js",
  "emotion-core-evidence-contract.js",
  "emotion-cycle-engine.js",
  "emotion-scenario-inference.js",
  "execution-advice.js",
  "flow-classifier.js",
  "index-cycle-regime.js",
  "leader-select.js",
  "market-cap-carrier.js",
  "market-cycle-engine.js",
  "market-effect-attribution.js",
  "market-phase-detail.js",
  "market-strength-source.js",
  "pool-builders.js",
  "post-close-opportunity.js",
  "premarket-flow.js",
  "preplan-scenario-workbench.js",
  "price-integrity.js",
  "recent-index-emotion-relation.js",
  "sell-engine.js",
  "super-expectation.js",
  "theme-library.js",
  "theme-taxonomy.js",
  "tomorrow-decision-context.js",
  "tomorrow-decision.js",
  "tomorrow-execution.js",
  "tomorrow-index-path.js",
  "tomorrow-market-forecast.js",
  "tomorrow-opportunity-map.js",
  "tomorrow-profit-effect-forecast.js",
  "trading-rules.js",
  "trading-style-preference.js",
  "unified-quant-factors.js",
  "quant-decision/decision-chain.js",
  "quant-decision/decision-ledger.js",
  "quant-decision/decision-outcome.js",
  "quant-decision/decision-receipt.js",
  "quant-decision/execution-feasibility.js",
  "quant-decision/execution-replay.js",
  "quant-decision/index.js",
  "quant-decision/limit-up-pullback-repair.js",
  "quant-decision/market-cycle-contract.js",
  "quant-decision/minute-evidence.js",
  "quant-decision/outcome-evidence.js",
  "quant-decision/stock-factor-engine.js",
  "quant-decision/v7-sell-decision.js",
].sort());

const SERVER_ENGINE_FUNCTIONS = Object.freeze([
  "applyRepairCoreRetention",
  "applyThemeCycleIdentitiesToCandidates",
  "attachGenerationContext",
  "buildBestPicks",
  "buildCanonicalBestPicks",
  "buildEmotionBigCycleWindowForPayload",
  "buildMarketEmotionObservation",
  "buildRiskBoard",
  "buildSuperExpectationSnapshot",
  "buildSurvivorBoard",
  "buildTomorrowOutlook",
  "buildTopicBoard",
  "candidateRoleAuthority",
  "canonicalAllocationMapFromAuthority",
  "canonicalFrozenEmotionCycle",
  "canonicalSelectionContext",
  "classifyChaosDivergence",
  "classifyMarket",
  "classifyShockRepair",
  "classifyTradingStyle",
  "clusterHotConcepts",
  "conceptStats",
  "coreWatchConceptTags",
  "emotionDecisionDateContext",
  "estimateTurnoverFromFloatCap",
  "fundFlowDirectionStats",
  "highBoardFeedback",
  "hydrateEmotionCyclePersistenceEvidence",
  "prepareEmotionBuildInputs",
  "projectOpportunityCardsToCanonicalAllocation",
  "projectPostCloseOpportunityToDecisionChain",
  "refreshCandidateFlowAndGate",
  "refreshCoreLeadership",
  "refreshMarketCapCarrier",
  "refreshPremarketModels",
  "refreshRecentIndexEmotionRelation",
  "refreshTomorrowDecision",
  "refreshUnifiedQuantFactors",
  "replayExactClosingEmotionCoreEvidence",
  "replayExactPreviousEmotionCycle",
  "resolveGenerationContext",
  "resolveIndexMarketStructures",
  "roleAuthoritySnapshot",
  "sanitizePreviousEmotionPayload",
  "scoreCandidate",
  "selectPreviousIndexEnvironment",
  "stampEmotionCycleSnapshot",
  "summarizeDirectionMembers",
  "syncCoreWatchPool",
  "themeLibrarySnapshotFromPayload",
].sort());

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizedText(value) {
  return Buffer.from(value).toString("utf8").replace(/\r\n?/g, "\n");
}

function normalizedTextSha256(value) {
  return sha256(Buffer.from(normalizedText(value), "utf8"));
}

function extractNamedFunction(sourceValue, name) {
  const source = normalizedText(sourceValue);
  const asyncMarker = `async function ${name}(`;
  const plainMarker = `function ${name}(`;
  const asyncIndex = source.indexOf(asyncMarker);
  const plainIndex = source.indexOf(plainMarker);
  const start = asyncIndex >= 0 ? asyncIndex : plainIndex;
  if (start < 0) throw new Error(`missing locked function: ${name}`);
  const paramsStart = source.indexOf("(", start);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    if (source[index] === "(") paramsDepth += 1;
    else if (source[index] === ")") paramsDepth -= 1;
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
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated locked function: ${name}`);
}

function gitFile(root, commit, relativePath) {
  return execFileSync("git", ["show", `${commit}:${relativePath}`], {
    cwd: root,
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
}

function fileEntries(root, reader = (relativePath) => fs.readFileSync(path.join(root, relativePath))) {
  return DECISION_ENGINE_FILES.map((relativePath) => ({
    path: relativePath,
    sha256: normalizedTextSha256(reader(relativePath)),
  }));
}

function serverFunctionEntries(serverSource) {
  return SERVER_ENGINE_FUNCTIONS.map((name) => ({
    path: "server.js",
    function: name,
    sha256: normalizedTextSha256(extractNamedFunction(serverSource, name)),
  }));
}

function lockHash(lock) {
  const clone = JSON.parse(JSON.stringify(lock));
  if (clone.integrity) delete clone.integrity.engineHash;
  return sha256(Buffer.from(stableSerialize(clone), "utf8"));
}

function loadDecisionEngineLock(file = DEFAULT_ENGINE_LOCK_PATH) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function validateDecisionEngineLock(lock, options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  const reasons = [];
  const source = lock && typeof lock === "object" ? lock : {};
  if (source.schemaVersion !== 1) reasons.push("engine_lock_schema_invalid");
  if (source.authority !== ENGINE_LOCK_AUTHORITY) reasons.push("engine_lock_authority_invalid");
  if (source.engineVersion !== ENGINE_LOCK_VERSION) reasons.push("engine_lock_version_invalid");
  if (!/^[a-f0-9]{40}$/.test(String(source.sourceCommit || ""))) reasons.push("engine_lock_source_commit_invalid");
  if (stableSerialize((source.files || []).map((entry) => entry.path).sort())
    !== stableSerialize([...DECISION_ENGINE_FILES])) reasons.push("engine_lock_file_scope_changed");
  if (stableSerialize((source.serverFunctions || []).map((entry) => entry.function).sort())
    !== stableSerialize([...SERVER_ENGINE_FUNCTIONS])) reasons.push("engine_lock_server_function_scope_changed");

  let currentFiles = [];
  let currentFunctions = [];
  try {
    currentFiles = fileEntries(root);
    currentFunctions = serverFunctionEntries(fs.readFileSync(path.join(root, "server.js")));
  } catch (error) {
    reasons.push(`engine_lock_current_read_failed:${error.message}`);
  }
  const declaredFiles = new Map((source.files || []).map((entry) => [entry.path, entry.sha256]));
  currentFiles.forEach((entry) => {
    if (declaredFiles.get(entry.path) !== entry.sha256) reasons.push(`engine_file_drift:${entry.path}`);
  });
  const declaredFunctions = new Map((source.serverFunctions || []).map((entry) => [entry.function, entry.sha256]));
  currentFunctions.forEach((entry) => {
    if (declaredFunctions.get(entry.function) !== entry.sha256) reasons.push(`engine_server_function_drift:${entry.function}`);
  });

  if (options.verifyGit !== false && /^[a-f0-9]{40}$/.test(String(source.sourceCommit || ""))) {
    try {
      const commitFiles = fileEntries(root, (relativePath) => gitFile(root, source.sourceCommit, relativePath));
      const commitFunctions = serverFunctionEntries(gitFile(root, source.sourceCommit, "server.js"));
      commitFiles.forEach((entry) => {
        if (declaredFiles.get(entry.path) !== entry.sha256) reasons.push(`engine_commit_file_mismatch:${entry.path}`);
      });
      commitFunctions.forEach((entry) => {
        if (declaredFunctions.get(entry.function) !== entry.sha256) reasons.push(`engine_commit_function_mismatch:${entry.function}`);
      });
    } catch (error) {
      reasons.push(`engine_lock_commit_read_failed:${error.message}`);
    }
  }
  const expectedHash = source.integrity && source.integrity.engineHash;
  if (!/^[a-f0-9]{64}$/.test(String(expectedHash || "")) || expectedHash !== lockHash(source)) {
    reasons.push("engine_lock_hash_invalid");
  }
  return {
    valid: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
    engineHash: lockHash(source),
    fileCount: currentFiles.length,
    serverFunctionCount: currentFunctions.length,
  };
}

module.exports = {
  DECISION_ENGINE_FILES,
  DEFAULT_ENGINE_LOCK_PATH,
  ENGINE_LOCK_AUTHORITY,
  ENGINE_LOCK_VERSION,
  SERVER_ENGINE_FUNCTIONS,
  extractNamedFunction,
  fileEntries,
  loadDecisionEngineLock,
  lockHash,
  normalizedTextSha256,
  serverFunctionEntries,
  validateDecisionEngineLock,
};
