"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const {
  stableSerialize,
  stableSha256,
} = require("../quant-decision/decision-receipt");
const {
  MAX_RESULT_STOCKS,
  UNIFIED_DECISION_CHAIN_VERSION,
} = require("../quant-decision/decision-chain");
const {
  STOCK_FACTOR_AUTHORITY,
  STOCK_FACTOR_VERSION,
} = require("../quant-decision/stock-factor-engine");
const {
  FACTOR_CATALOG,
  UNIFIED_QUANT_FACTORS_VERSION,
} = require("../unified-quant-factors");
const {
  MINUTE_EVIDENCE_VERSION,
  MINUTE_EVIDENCE_AUTHORITY,
  CANONICAL_MINUTE_HASH_SCOPE,
  CANONICAL_SEAL_HASH_SCOPE,
  MINUTE_EVIDENCE_TIERS,
} = require("../quant-decision/minute-evidence");
const {
  V7_SELL_DECISION_ENTRY_VERSION,
  V7_SELL_DECISION_ENTRY_AUTHORITY,
  V7_POSITION_CONTEXT_AUTHORITY,
  V7_DAILY_CONTEXT_AUTHORITY,
} = require("../quant-decision/v7-sell-decision");
const {
  V7_SELL_STRATEGY_VERSION,
  V7_SELL_STRATEGY_AUTHORITY,
  V7_SELL_STRATEGY_METHOD,
  V7_COMPARABLE_PRICE_AUTHORITY,
  V7_NEGATIVE_FEEDBACK_AUTHORITY,
  V7_SELL_CFG,
} = require("../sell-engine");

const BACKTEST_CONTRACT_SCHEMA_VERSION = 1;
const BACKTEST_CONTRACT_AUTHORITY = "a_share_backtest_contract_v1";
const DEFAULT_CONTRACT_PATH = path.join(__dirname, "contracts", "strategy-v7.json");
const DEFAULT_REGISTRY_PATH = path.join(__dirname, "contracts", "registry.json");
const BACKTEST_CONTRACT_REGISTRY_AUTHORITY = "a_share_backtest_contract_registry_v1";
const DEFAULT_ENGINE_MANIFEST_PATH = path.join(__dirname, "engine-manifest.json");
const DEFAULT_DATASET_MANIFEST_PATH = path.join(__dirname, "dataset-manifest.json");
const DEFAULT_DECISION_RECEIPT_ANCHOR_PATH = path.join(__dirname, "decision-receipt-anchor.json");
const DEFAULT_FILL_RECEIPT_MANIFEST_PATH = path.join(__dirname, "fill-receipt-manifest.json");

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(stableSerialize(value));
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function unknownKeyReasons(value, allowedKeys, label) {
  if (!isObject(value)) return [`${label}_object_missing`];
  const allowed = new Set(allowedKeys);
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) => `${label}_unknown_key:${key}`);
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function normalizedTextSha256(bytes) {
  const normalized = Buffer.from(bytes).toString("utf8").replace(/\r\n?/g, "\n");
  return sha256Bytes(Buffer.from(normalized, "utf8"));
}

function fileSha256(file) {
  return normalizedTextSha256(fs.readFileSync(file));
}

function contractHashPayload(contract) {
  const value = clone(contract || {});
  if (!isObject(value.integrity)) value.integrity = {};
  delete value.integrity.contractHash;
  return value;
}

function strategyHashPayload(contract) {
  const baseline = isObject(contract && contract.strategyBaseline) ? clone(contract.strategyBaseline) : {};
  delete baseline.strategyHash;
  baseline.sourceFiles = (Array.isArray(baseline.sourceFiles) ? baseline.sourceFiles : [])
    .slice()
    .sort((left, right) => String(left.path || "").localeCompare(String(right.path || "")));
  return baseline;
}

function computeBacktestContractHash(contract) {
  return stableSha256(contractHashPayload(contract));
}

function computeStrategyBaselineHash(contract) {
  return stableSha256(strategyHashPayload(contract));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadBacktestContract(file = DEFAULT_CONTRACT_PATH) {
  return readJson(path.resolve(file));
}

function loadBacktestContractRegistry(file = DEFAULT_REGISTRY_PATH) {
  return readJson(path.resolve(file));
}

function safeRelativePath(value) {
  const text = String(value || "").trim().replace(/\\/g, "/");
  if (!text || path.isAbsolute(text) || /^[A-Za-z]:/.test(text)) return null;
  const normalized = path.posix.normalize(text);
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) return null;
  return normalized;
}

function gitObjectExists(root, expression) {
  const result = spawnSync("git", ["cat-file", "-e", expression], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0;
}

function gitCommitIsAncestor(root, ancestor, descendant = "HEAD") {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0;
}

function gitFileBytes(root, commit, relativePath) {
  return execFileSync("git", ["show", `${commit}:${relativePath}`], {
    cwd: root,
    encoding: null,
    maxBuffer: 100 * 1024 * 1024,
    windowsHide: true,
  });
}

function gitFirstAddedCommit(root, relativePath) {
  const output = execFileSync("git", [
    "log", "--diff-filter=A", "--format=%H", "--", relativePath,
  ], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  return String(output || "").trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || null;
}

function productionSourcePathIncluded(value) {
  const relativePath = String(value || "").replace(/\\/g, "/");
  if (!relativePath.endsWith(".js")) return false;
  if (["backtest/", "dist/", "expo-app/", "output/", "release/", "node_modules/"]
    .some((prefix) => relativePath.startsWith(prefix))) return false;
  const name = path.posix.basename(relativePath);
  return !name.startsWith("test-") && !name.endsWith(".test.js");
}

function gitProductionSourceTree(root, commit) {
  const output = execFileSync("git", ["ls-tree", "-r", "--full-tree", commit], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const tab = line.indexOf("\t");
    const metadata = tab >= 0 ? line.slice(0, tab).split(/\s+/) : [];
    const filePath = tab >= 0 ? line.slice(tab + 1) : "";
    return { path: filePath, objectId: metadata[2] || "" };
  }).filter((row) => productionSourcePathIncluded(row.path))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function gitProductionSourceTreeHash(root, commit) {
  const entries = gitProductionSourceTree(root, commit);
  return { entries, hash: stableSha256(entries) };
}

function productionSourceWorktreeDirty(root, sourceCommit, paths) {
  if (!paths.length) return false;
  const result = spawnSync("git", ["diff", "--quiet", sourceCommit, "--", ...paths], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  return result.status !== 0;
}

function untrackedProductionSources(root) {
  const result = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return [];
  return String(result.stdout || "").split(/\r?\n/).filter(productionSourcePathIncluded).sort();
}

function validateBacktestContractRegistry(registry, contract, options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  const registryPath = "backtest/contracts/registry.json";
  const source = isObject(registry) ? registry : {};
  const entries = Array.isArray(source.entries) ? source.entries : [];
  const reasons = [];
  reasons.push(...unknownKeyReasons(source, ["schemaVersion", "authority", "appendOnly", "entries", "rule"], "contract_registry"));
  if (Number(source.schemaVersion) !== 1) reasons.push("contract_registry_schema_invalid");
  if (source.authority !== BACKTEST_CONTRACT_REGISTRY_AUTHORITY) reasons.push("contract_registry_authority_invalid");
  if (source.appendOnly !== true) reasons.push("contract_registry_not_append_only");
  if (options.verifyGit !== false) {
    try {
      const headRegistry = JSON.parse(gitFileBytes(root, "HEAD", registryPath).toString("utf8"));
      if (stableSerialize(headRegistry) !== stableSerialize(source)) reasons.push("working_registry_differs_from_head");
      const creationResult = execFileSync("git", [
        "log", "--diff-filter=A", "--format=%H", "--", registryPath,
      ], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
      });
      const creationCommit = String(creationResult || "").trim().split(/\r?\n/).filter(Boolean).slice(-1)[0];
      if (!/^[a-f0-9]{40}$/.test(String(creationCommit || ""))) {
        reasons.push("contract_registry_creation_commit_missing");
      } else {
        const originalRegistry = JSON.parse(gitFileBytes(root, creationCommit, registryPath).toString("utf8"));
        const originalEntries = Array.isArray(originalRegistry.entries) ? originalRegistry.entries : [];
        const currentByVersion = new Map(entries.map((entry) => [entry.contractVersion, entry]));
        for (const originalEntry of originalEntries) {
          const currentEntry = currentByVersion.get(originalEntry.contractVersion);
          if (!currentEntry) reasons.push(`contract_registry_entry_removed:${originalEntry.contractVersion}`);
          else if (stableSerialize(currentEntry) !== stableSerialize(originalEntry)) {
            reasons.push(`contract_registry_entry_modified:${originalEntry.contractVersion}`);
          }
        }
      }
    } catch (_error) {
      reasons.push("contract_registry_git_anchor_unavailable");
    }
  }
  const seenVersions = new Set();
  for (const entry of entries) {
    reasons.push(...unknownKeyReasons(entry, [
      "contractVersion", "contractPath", "contractCommit", "contractHash", "strategyHash", "sourceCommit", "status",
    ], "contract_registry_entry"));
    const version = String(entry && entry.contractVersion || "");
    if (seenVersions.has(version)) reasons.push(`contract_registry_version_duplicated:${version}`);
    seenVersions.add(version);
    const registeredPath = safeRelativePath(entry && entry.contractPath);
    const expectedPath = /^v\d+$/.test(version) ? `backtest/contracts/strategy-${version}.json` : null;
    const registeredCommit = String(entry && entry.contractCommit || "").toLowerCase();
    if (entry && entry.status !== "approved") reasons.push(`contract_registry_entry_not_approved:${version}`);
    if (!expectedPath || registeredPath !== expectedPath) {
      reasons.push(`contract_registry_entry_path_invalid:${version}`);
      continue;
    }
    if (options.verifyGit !== false) {
      try {
        const firstAddedCommit = gitFirstAddedCommit(root, registeredPath);
        if (!/^[a-f0-9]{40}$/.test(String(firstAddedCommit || ""))) {
          reasons.push(`contract_file_creation_commit_missing:${version}`);
        } else if (registeredCommit !== firstAddedCommit) {
          reasons.push(`contract_registry_commit_not_file_creation_commit:${version}`);
        } else {
          const frozen = JSON.parse(gitFileBytes(root, firstAddedCommit, registeredPath).toString("utf8"));
          if (computeBacktestContractHash(frozen) !== entry.contractHash) {
            reasons.push(`contract_registry_entry_blob_hash_mismatch:${version}`);
          }
          if (computeStrategyBaselineHash(frozen) !== entry.strategyHash) {
            reasons.push(`contract_registry_entry_strategy_hash_mismatch:${version}`);
          }
          if (String(frozen.strategyBaseline && frozen.strategyBaseline.sourceCommit || "") !== entry.sourceCommit) {
            reasons.push(`contract_registry_entry_source_commit_mismatch:${version}`);
          }
        }
      } catch (_error) {
        reasons.push(`contract_registry_entry_git_anchor_unavailable:${version}`);
      }
    }
  }
  const version = String(contract && contract.contractVersion || "");
  const matching = entries.filter((entry) => entry && entry.contractVersion === version);
  if (matching.length !== 1) reasons.push("contract_registry_exact_entry_missing");
  const entry = matching[0] || {};
  const contractPath = safeRelativePath(entry.contractPath);
  const contractCommit = String(entry.contractCommit || "").toLowerCase();
  const expectedContractPath = /^v\d+$/.test(version)
    ? `backtest/contracts/strategy-${version}.json`
    : null;
  if (!expectedContractPath || contractPath !== expectedContractPath) reasons.push("contract_registry_path_invalid");
  if (!/^[a-f0-9]{40}$/.test(contractCommit)) reasons.push("contract_registry_commit_invalid");
  if (entry.status !== "approved") reasons.push("contract_registry_entry_not_approved");
  if (entry.contractHash !== contract.integrity.contractHash) reasons.push("contract_registry_hash_mismatch");
  if (entry.strategyHash !== contract.strategyBaseline.strategyHash) reasons.push("contract_registry_strategy_hash_mismatch");
  if (entry.sourceCommit !== contract.strategyBaseline.sourceCommit) reasons.push("contract_registry_source_commit_mismatch");
  if (/^[a-f0-9]{40}$/.test(contractCommit)) {
    if (!gitObjectExists(root, `${contractCommit}^{commit}`)) reasons.push("contract_registry_commit_missing");
    else {
      if (!gitCommitIsAncestor(root, contractCommit, "HEAD")) reasons.push("contract_registry_commit_not_ancestor_of_head");
      try {
        const frozenContract = JSON.parse(gitFileBytes(root, contractCommit, contractPath).toString("utf8"));
        if (computeBacktestContractHash(frozenContract) !== entry.contractHash) reasons.push("registered_contract_blob_hash_mismatch");
        if (stableSerialize(frozenContract) !== stableSerialize(contract)) reasons.push("working_contract_differs_from_registered_blob");
      } catch (_error) {
        reasons.push("registered_contract_blob_unavailable");
      }
    }
  }
  return {
    valid: unique(reasons).length === 0,
    reasons: unique(reasons),
    entry: clone(entry),
  };
}

function requiredMetricSet() {
  return new Set([
    "equityCurve",
    "totalReturnPct",
    "maxDrawdownPct",
    "winRatePct",
    "profitFactor",
    "exposurePct",
    "turnoverPct",
    "cashDayCount",
    "triggerRatePct",
    "realizedReturnPct",
    "unrealizedPnlPct",
    "meanHoldingSessions",
    "exitBlockedCount",
  ]);
}

function validateBacktestContract(contract, options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  const source = isObject(contract) ? contract : {};
  const contractVersion = String(source.contractVersion || "");
  const isV2 = contractVersion === "v2";
  const isV3 = contractVersion === "v3";
  const isV4 = contractVersion === "v4";
  const isV5 = contractVersion === "v5";
  const isV6 = contractVersion === "v6";
  const isV7 = contractVersion === "v7";
  const isV6Plus = isV6 || isV7;
  const isV5Plus = isV5 || isV6Plus;
  const isV4Plus = isV4 || isV5Plus;
  const isV3Plus = isV3 || isV4Plus;
  const baseline = isObject(source.strategyBaseline) ? source.strategyBaseline : {};
  const versions = isObject(baseline.versions) ? baseline.versions : {};
  const signal = isObject(source.signal) ? source.signal : {};
  const signals = isObject(source.signals) ? source.signals : {};
  const asDecidedSignal = isObject(signals.asDecided) ? signals.asDecided : {};
  const counterfactualSignal = isObject(signals.counterfactual) ? signals.counterfactual : {};
  const entry = isObject(source.entry) ? source.entry : {};
  const portfolio = isObject(source.portfolio) ? source.portfolio : {};
  const exit = isObject(source.exit) ? source.exit : {};
  const exitStateMachine = isObject(exit.stateMachine) ? exit.stateMachine : {};
  const exitUpperLayer = isObject(exitStateMachine.upperLayer) ? exitStateMachine.upperLayer : {};
  const exitLowerLayer = isObject(exitStateMachine.lowerLayer) ? exitStateMachine.lowerLayer : {};
  const exitIntentExecution = isObject(exit.intentExecution) ? exit.intentExecution : {};
  const minuteEvidence = isObject(source.minuteEvidence) ? source.minuteEvidence : {};
  const sealTickPolicy = isObject(minuteEvidence.sealTick) ? minuteEvidence.sealTick : {};
  const sellVariants = isObject(source.sellVariants) ? source.sellVariants : {};
  const core1mVariant = isObject(sellVariants.CORE_1M) ? sellVariants.CORE_1M : {};
  const full1mTickVariant = isObject(sellVariants.FULL_1M_TICK) ? sellVariants.FULL_1M_TICK : {};
  const corporateActions = isObject(source.corporateActions) ? source.corporateActions : {};
  const eventOrdering = isObject(source.eventOrdering) ? source.eventOrdering : {};
  const priceAndAccounting = isObject(source.priceAndAccounting) ? source.priceAndAccounting : {};
  const positionAccounting = isObject(source.positionAccounting) ? source.positionAccounting : {};
  const costs = isObject(source.costs) ? source.costs : {};
  const dataPolicy = isObject(source.dataPolicy) ? source.dataPolicy : {};
  const enginePolicy = isObject(source.enginePolicy) ? source.enginePolicy : {};
  const metricDefinitions = isObject(source.metricDefinitions) ? source.metricDefinitions : {};
  const metricZeroDenominatorPolicy = isObject(source.metricZeroDenominatorPolicy)
    ? source.metricZeroDenominatorPolicy : {};
  const metricGroupingPolicy = isObject(source.metricGroupingPolicy) ? source.metricGroupingPolicy : {};
  const lanes = isObject(source.lanes) ? source.lanes : {};
  const asDecided = isObject(lanes.asDecided) ? lanes.asDecided : {};
  const counterfactual = isObject(lanes.counterfactual) ? lanes.counterfactual : {};
  const integrity = isObject(source.integrity) ? source.integrity : {};
  const sourceFiles = Array.isArray(baseline.sourceFiles) ? baseline.sourceFiles : [];
  const sourceTree = isObject(baseline.sourceTree) ? baseline.sourceTree : {};
  const sourceCommit = String(baseline.sourceCommit || "").trim().toLowerCase();
  const verifySourceFiles = options.verifySourceFiles !== false;
  const verifyGit = options.verifyGit !== false;
  const verifyRegistry = options.verifyRegistry !== false && verifyGit;
  const sourceCommitAvailable = verifyGit
    && /^[a-f0-9]{40}$/.test(sourceCommit)
    && gitObjectExists(root, `${sourceCommit}^{commit}`);
  const reasons = [];
  const fileAudit = [];

  reasons.push(...unknownKeyReasons(source, [
    "schemaVersion", "authority", "contractVersion", "status", "name", "strategyBaseline",
    "signal", "signals", "entry", "portfolio", "exit", "corporateActions", "eventOrdering",
    "priceAndAccounting", "positionAccounting", "costs", "lanes", "outcomes", "metrics",
    "metricDefinitions", "metricZeroDenominatorPolicy", "metricGroupingPolicy",
    "dataPolicy", "enginePolicy", "validationThresholds", "guardrails", "integrity",
    ...(isV7 ? ["minuteEvidence", "sellVariants"] : []),
  ], "contract"));
  reasons.push(...unknownKeyReasons(baseline, [
    "baselineId", "sourceCommit", "strategyHash", "versions", "factorRegistryHash", "sourceFiles",
    "sourceTree",
  ], "strategy_baseline"));
  reasons.push(...unknownKeyReasons(versions, [
    "decisionChain", "unifiedQuantFactors", "stockFactorAuthority", "stockFactorEngine",
    ...(isV7 ? [
      "minuteEvidenceAuthority", "minuteEvidenceVersion",
      "sellDecisionEntryAuthority", "sellDecisionEntryVersion",
      "sellStrategyAuthority", "sellStrategyVersion", "sellStrategyMethod",
    ] : []),
  ], "strategy_versions"));
  reasons.push(...unknownKeyReasons(sourceTree, ["policy", "fileCount", "hash"], "strategy_source_tree"));
  if (isV7) {
    reasons.push(...unknownKeyReasons(minuteEvidence, [
      "authority", "version", "barIntervalMinutes", "fullSessionBarCount", "priceMode",
      "acceptedSourceTimestampConventions", "barStartObservationPolicy",
      "decisionDeadlineObservationTime", "priceContentHashScope", "priceTiersInPriorityOrder",
      "legacy5mPolicy", "observationPolicy", "strictFullSessionPositiveTurnoverRequired",
      "executionAuthority", "sealTick",
    ], "minute_evidence"));
    reasons.push(...unknownKeyReasons(sealTickPolicy, [
      "contentHashScope", "maxGapSeconds", "quoteChangesIncludedRequired", "proxyPolicy",
      "productionInputPolicy",
    ], "seal_tick_policy"));
    reasons.push(...unknownKeyReasons(sellVariants, [
      "CORE_1M", "FULL_1M_TICK", "exactlyOnePerRun", "combineMetrics",
      "missingTickPolicy", "productionManualTickAccepted",
    ], "sell_variants"));
    reasons.push(...unknownKeyReasons(core1mVariant, [
      "verifiedRaw1mRequired", "sealTickRequired", "productionInputAvailable",
    ], "sell_variant_core_1m"));
    reasons.push(...unknownKeyReasons(full1mTickVariant, [
      "verifiedRaw1mRequired", "sealTickRequired", "productionInputAvailable",
      "unavailableUntil",
    ], "sell_variant_full_1m_tick"));
  }
  if (isV3Plus) {
    if (isV4Plus) {
      if (Number(corporateActions.ledgerSchemaVersion) !== 1
        || corporateActions.ledgerAuthority !== "provider_corporate_action_ledger_v1") {
        reasons.push("corporate_action_ledger_contract_invalid");
      }
      const expectedCorporateCommonFields = isV5Plus
        ? [
          "eventId", "positionLineageId", "securityId", "eventType", "recordDate", "exDate",
          "effectiveAt", "sourceTimestamp", "sourceFileHash",
        ]
        : [
          "eventId", "securityId", "eventType", "recordDate", "exDate", "effectiveAt",
          "sourceTimestamp", "sourceFileHash",
        ];
      if (stableSerialize(corporateActions.commonRequiredFields)
        !== stableSerialize(expectedCorporateCommonFields)) reasons.push("corporate_action_ledger_fields_invalid");
      if (isV5Plus) {
        const expectedEventFields = {
          CASH_DIVIDEND: ["referencePriceMultiplier", "netCashPerPreEventShareCny", "paymentDate"],
          STOCK_DISTRIBUTION_OR_SPLIT: [
            "referencePriceMultiplier", "newSharesPerOldShare", "fractionalCashPerShareCny",
            "fractionalCashPaymentDate",
          ],
          RIGHTS_ISSUE: [
            "referencePriceMultiplier", "rightsPerOldShare", "subscriptionPriceCny", "subscriptionDeadline",
          ],
          SYMBOL_CHANGE: ["successorSecurityId"],
          SECURITY_CONSIDERATION: [
            "referencePriceMultiplier", "successorSecurityId", "successorSharesPerOldShare",
            "costAllocationPct", "settlementDate",
          ],
          CASH_CONSIDERATION: ["referencePriceMultiplier", "terminalCashPerOldShareCny", "settlementDate"],
        };
        if (stableSerialize(corporateActions.eventTypeRequiredFields) !== stableSerialize(expectedEventFields)) {
          reasons.push("corporate_action_event_schema_invalid");
        }
        if (corporateActions.eventFieldUnits
          !== "CNY_PER_PRE_EVENT_SHARE_INTEGER_SHARES_RATIO_NEW_PER_OLD_ISO_DATE_ASIA_SHANGHAI") {
          reasons.push("corporate_action_event_units_invalid");
        }
      }
      if (corporateActions.referencePriceMultiplierDefinition
        !== "POST_ACTION_COMPARABLE_PRICE_DIV_PRE_ACTION_COMPARABLE_PRICE") {
        reasons.push("corporate_action_multiplier_definition_invalid");
      }
      if (corporateActions.preEntryReferenceAdjustmentFormula
        !== "FROZEN_RULE_PRICE_TIMES_PRODUCT_OF_MULTIPLIERS_EFFECTIVE_AFTER_SIGNAL_BEFORE_FILL") {
        reasons.push("corporate_action_reference_formula_invalid");
      }
    }
  if (isV4Plus && portfolio.initialCapitalRole !== "SEED_CAPITAL_ONLY") {
      reasons.push("portfolio_initial_capital_role_invalid");
    }
    reasons.push(...unknownKeyReasons(signals, ["asDecided", "counterfactual"], "signals"));
    reasons.push(...unknownKeyReasons(asDecidedSignal, [
      "time", "authority", "version", "method", "resultPath", "receiptStatus",
      "requireAuthorizationPassed", "nonEmptyResultRequiresAuthorizationPassed",
      "closedAuthorizationRequiresEmptyResult", "cashOnlyReceiptAllowed", "authorizationPath",
      "asDecided", "maxResultStocks", "requiredIdentityFields",
      "allowObservationCandidates", "allowLegacySelected", "allowForcedCandidate",
    ], "signal_as_decided"));
    reasons.push(...unknownKeyReasons(counterfactualSignal, [
      "time", "authority", "version", "resultPath", "receiptAllowed", "requireAuthorizationPassed",
      "nonEmptyResultRequiresAuthorizationPassed", "closedAuthorizationRequiresEmptyResult",
      "cashOnlyProjectionAllowed", "authorizationPath",
      "asDecided", "maxResultStocks", "baseStrategyHash", "candidateStrategyHashRequired",
      "definitionHashRequired", "generationTimestampRequired", "pointInTimeCutoff", "allowLiveReceiptStocks",
      "allowLiveReceiptAsInput", "coincidentalStockOverlapAllowed",
    ], "signal_counterfactual"));
  } else {
    reasons.push(...unknownKeyReasons(signal, [
      "time", "resultPath", "receiptStatus", "requireAuthorizationPassed", "maxResultStocks",
      "allowObservationCandidates", "allowLegacySelected", "allowForcedCandidate",
    ], "signal"));
  }
  reasons.push(...unknownKeyReasons(entry, isV7 ? [
    "session", "rulePathByLane", "triggerWindowSource", "maxGapSource", "fillMethod", "fillPriceFormula",
    "fillProcessingOrder", "slippageBps", "barIntervalMinutes", "triggerBarFillPolicy",
    "minuteEvidenceAuthority", "referencePriceAdjustmentPolicy", "fillBarPositiveAmountAndVolumeRequired",
    "upperLimitPolicy", "slippageBoundaryPolicy", "maximumFillBarParticipationPct",
    "participationCapBreachPolicy", "maximumOrderQuantityPolicy", "singleOrderPerSignal",
    "partialFillPolicy", "limitLockedPolicy", "missingMinuteDataPolicy",
  ] : isV3Plus ? [
    "session", "rulePathByLane", "triggerWindowSource", "maxGapSource", "fillMethod", "fillPriceFormula",
    "fillProcessingOrder", "slippageBps",
    "referencePriceAdjustmentPolicy", "fillBarPositiveAmountAndVolumeRequired", "upperLimitPolicy", "slippageBoundaryPolicy",
    "maximumFillBarParticipationPct", "participationCapBreachPolicy", "maximumOrderQuantityPolicy",
    "singleOrderPerSignal", "partialFillPolicy", "limitLockedPolicy", "missingMinuteDataPolicy",
  ] : [
    "session", "rulePath", "triggerWindowSource", "maxGapSource", "fillMethod", "slippageBps",
    "limitLockedPolicy", "missingMinuteDataPolicy",
  ], "entry"));
  if (isV3Plus) {
    reasons.push(...unknownKeyReasons(entry.rulePathByLane, ["asDecided", "counterfactual"], "entry_rule_paths"));
  }
  reasons.push(...unknownKeyReasons(portfolio, [
    "currency", "initialCapital", "boardLotShares", "allocationPath", "maxConcurrentPositions",
    "allowLeverage", "preserveCashForUntriggered", "allowSameDaySell", "capitalReusePolicy",
    "allocationBasis", "allocationPercentUnit", "entrySizingMethod", "processingOrder",
    "existingPositionPolicy", "maximumPortfolioPctUse", "insufficientOneLotPolicy", "cashRemainderPolicy",
    "tradingUnitSource", "requiredTradingUnitFields", "exposureBudgetPolicy", "capacityAdmissionOrder",
    "pendingOrderCapacityPolicy", "pendingOrderExpiry", "capacityDefinition", "cashInsufficientPolicy",
    "cashReservationPolicy", "actualAllocationAuditRequired",
    "initialCapitalRole", "targetTotalExposureFormula", "stockTargetNotionalFormula",
    "exposureBudgetFormula", "totalExposureTargetPathByLane", "budgetSnapshotTime",
    "pendingCashReservationPolicy", "admissionBackfillPolicy", "unfilledTargetRedistributionPolicy",
    "actualAllocationAuditFields",
    "desiredQuantityFormula", "remainingExposureBudgetFormula", "budgetDecrementPolicy",
    "actualPortfolioPctFormula", "allocationAuditPopulation", "cashOnlyDayAllocationDeviationPolicy",
  ], "portfolio"));
  if (isV4Plus) reasons.push(...unknownKeyReasons(
    portfolio.totalExposureTargetPathByLane,
    ["asDecided", "counterfactual"],
    "portfolio_exposure_paths",
  ));
  reasons.push(...unknownKeyReasons(exit, isV7 ? [
    "earliestSession", "method", "markToMarketAtEntryDayClose", "sellabilityEvidence",
    "securityLimitPolicy", "lowerLimitIntentPolicy", "slippageBoundaryPolicy",
    "maximumFillBarParticipationPct", "participationCapBreachPolicy", "maximumOrderQuantityPolicy",
    "partialFillPolicy", "fillPriceFormula", "priceTickPolicy", "sellOddLotPolicy",
    "proceedsAvailability", "costBasisPolicy", "suspensionPolicy", "holdingExtensionPolicy",
    "datasetEndPolicy", "stateMachine", "intentExecution",
  ] : isV3Plus ? [
    "earliestSession", "method", "exitSearchSessions", "searchWindowDefinition",
    "markToMarketAtEntryDayClose", "sellabilityEvidence", "securityLimitPolicy",
    "lowerLimitPolicy", "slippageBoundaryPolicy", "maximumCloseAuctionParticipationPct",
    "closeAuctionVolumeSource", "participationCapBreachPolicy", "maximumOrderQuantityPolicy",
    "exitQuantityPolicy", "partialFillPolicy", "fillPriceFormula", "nonLimitCloseFillAssumption",
    "priceTickPolicy", "sellOddLotPolicy", "proceedsAvailability", "costBasisPolicy",
    "suspensionPolicy", "afterSearchWindowPolicy",
    "datasetEndPolicy",
  ] : isV2 ? [
    "earliestSession", "method", "exitSearchSessions", "searchWindowDefinition",
    "markToMarketAtEntryDayClose", "sellabilityEvidence", "securityLimitPolicy",
    "atLowerLimitWithoutQueueEvidencePolicy", "suspensionPolicy", "afterSearchWindowPolicy",
    "datasetEndPolicy", "corporateActionPolicy",
  ] : [
    "earliestSession", "method", "maximumHoldingSessions", "markToMarketAtEntryDayClose",
    "limitDownLockedPolicy", "unresolvedAtMaxHoldingPolicy",
  ], "exit"));
  if (isV7) {
    reasons.push(...unknownKeyReasons(exitStateMachine, [
      "authority", "version", "method", "upperLayer", "lowerLayer", "sameBarPriority",
    ], "exit_state_machine"));
    reasons.push(...unknownKeyReasons(exitUpperLayer, [
      "positionContextAuthority", "dailyContextAuthority", "upperContextAuthority",
      "comparablePriceContextAuthority", "negativeFeedbackAuthority",
      "identityBindingRequiredFields", "sameSecurityDateGenerationAndDecisionRequired",
      "canonicalPayloadHashRequired", "pointInTimeNotAfterObservedBarRequired",
    ], "exit_upper_layer"));
    reasons.push(...unknownKeyReasons(exitLowerLayer, [
      "hardStopLossPctFromActualComparableFill", "peakProfitKeepRatio",
      "highWaterMarkSeedPolicy", "currentBarHighPolicy",
      "limitBreakDrawdownPercentagePoints", "limitBreakConfirmCompletedBars",
      "limitBreakTriggerBarCountsTowardConfirmation", "resealResetsConfirmation",
      "sealRemainingRatio", "sealWeakDurationSeconds", "sealPartialExitPctOfCurrentPosition",
      "sealPartialExitMaxTimes", "negativeFeedbackMa5BiasStrictlyGreaterPct",
      "priorVolumeSessions", "cumulativeVolumeMustStrictlyExceedPriorMaximum",
      "previousDayMinusCurrentChangeMinimumPercentagePoints", "deadlineObservedTime",
      "ma5Period", "trendExtensionRequiresFloatingProfit", "trendMaximumHoldingSessions",
      "t1RiskPolicy",
    ], "exit_lower_layer"));
    reasons.push(...unknownKeyReasons(exitIntentExecution, [
      "strategyProducesIntentOnly", "executionAuthority", "actualPositionMutationPolicy",
      "validatedFillReceiptRequired", "fillMethod", "fullExitOverridesPartialSameBar",
      "partialFillPolicy", "unfilledIntentPolicy",
    ], "exit_intent_execution"));
  }
  if (isV3Plus) {
    reasons.push(...unknownKeyReasons(corporateActions, [
      "securityIdentity", "preEntryReferenceAdjustmentPolicy", "cashDividendPolicy", "stockDistributionPolicy", "fractionalSharePolicy",
      "rightsIssuePolicy", "symbolChangePolicy", "mergerDelistingPolicy", "missingActionEvidencePolicy",
      "ledgerSchemaVersion", "ledgerAuthority", "commonRequiredFields", "referencePriceMultiplierDefinition",
      "preEntryReferenceAdjustmentFormula", "cashDividendReceivableIncludedInEquity",
      "cashDividendAvailableBeforePayment", "successorSecurityPolicy", "multipleSuccessorCapacityPolicy",
      "terminalConsiderationPosting",
      "eventTypeRequiredFields", "eventFieldUnits",
      "entitlementQuantityPolicy", "entitlementEventTypes", "entitlementIdentityPolicy",
      "recordDateSuspensionPolicy",
    ], "corporate_actions"));
    if (isV5Plus) reasons.push(...unknownKeyReasons(corporateActions.eventTypeRequiredFields, [
      "CASH_DIVIDEND", "STOCK_DISTRIBUTION_OR_SPLIT", "RIGHTS_ISSUE", "SYMBOL_CHANGE",
      "SECURITY_CONSIDERATION", "CASH_CONSIDERATION",
    ], "corporate_action_event_types"));
    reasons.push(...unknownKeyReasons(eventOrdering, [
      "dailyOrder", "sameDayExitProceedsForEntry", "signalUsesPostClosePortfolioState",
    ], "event_ordering"));
    if (isV4Plus) reasons.push(...unknownKeyReasons(priceAndAccounting, [
      "priceAdjustmentMode", "dailyOhlcMode", "minuteOhlcMode", "limitAndTickMode",
      "executionAndMarkToMarketMode", "corporateActionApplication", "internalDecimalPrecision",
      "cashEventRounding", "feeRounding", "shareQuantityPrecision", "reportingPercentageRoundingDecimals",
    ], "price_and_accounting"));
    if (isV5Plus) reasons.push(...unknownKeyReasons(positionAccounting, [
      "positionLineageIdFormula", "successorAggregationPolicy", "settledCondition",
      "entryCostBasisFormula", "netRealizedPnlFormula", "openLineageUnrealizedPnlFormula",
      "datasetEndOpenPositionCountDefinition", "winLossCountingPolicy", "holdingPeriodPolicy",
    ], "position_accounting"));
  }
  reasons.push(...unknownKeyReasons(costs, isV2 || isV3Plus ? [
    "mode", "entrySlippageBps", "exitSlippageBps", "entryFeeBps", "exitFeeBps",
    "feeApplication", "unrealizedValuationFeePolicy", "actualBrokerSchedule", "note",
  ] : [
    "mode", "entrySlippageBps", "exitSlippageBps", "roundTripFeeBps", "feeApplication",
    "actualBrokerSchedule", "note",
  ], "costs"));
  if (isV3Plus) {
    reasons.push(...unknownKeyReasons(dataPolicy, [
      "datasetManifestRequired", "datasetHashMode", "exactlyOneLanePerDataset", "laneBoundInDataset",
      "securityMasterRequired", "securityDateTradingRulesRequired", "volumeUnit",
      "corporateActionLedgerRequired", "entryAndExitEvidenceRequired", "asDecidedRequiredFields",
      "counterfactualRequiredFields", "legacyT1OutcomeUse", "priceAdjustmentMode",
      "corporateActionLedgerSchema",
      ...(isV7 ? [
        "minuteEvidenceManifestRequired", "sellVariantBoundInDataset",
        "decisionReceiptAnchorRequired", "signedContextAnchorsRequired",
        "signedContextAuthorities", "sameContextIdentityRequiredFields",
        "fillReceiptAnchorRequired", "manualTickAcceptedInProduction",
        "formalPerformanceWithoutAllAnchors",
      ] : []),
    ], "data_policy"));
  } else if (isV2) {
    reasons.push(...unknownKeyReasons(dataPolicy, [
      "datasetManifestRequired", "datasetHashMode", "laneBoundInDataset", "asDecidedReceiptStatus",
      "receiptIdentityRequired", "entryAndExitEvidenceRequired", "legacyT1OutcomeUse",
    ], "data_policy"));
  }
  if (isV2 || isV3Plus) reasons.push(...unknownKeyReasons(enginePolicy, [
    "engineManifestRequired", "engineCommitRequired", "engineTreeHashRequired",
    "runtimeNodeVersionRequired", "backtestDirectoryMustBeAnchored",
    ...(isV7 ? ["positionEngineRequired", "fillReceiptValidatorRequired", "formalPerformanceEligibility"] : []),
  ], "engine_policy"));
  reasons.push(...unknownKeyReasons(lanes, ["asDecided", "counterfactual", "combineMetrics"], "lanes"));
  reasons.push(...unknownKeyReasons(asDecided, ["asDecided", "receiptRequired", "executionAuthority"], "lane_as_decided"));
  reasons.push(...unknownKeyReasons(counterfactual, ["asDecided", "receiptRequired", "executionAuthority"], "lane_counterfactual"));
  reasons.push(...unknownKeyReasons(source.outcomes, ["requiredStatuses", "deleteCashDays", "deleteFailedSamples"], "outcomes"));
  reasons.push(...unknownKeyReasons(source.metrics, ["required", "groupBy"], "metrics"));
  if (isV4Plus) reasons.push(...unknownKeyReasons(metricDefinitions, [
    "equityCurve", "totalReturnPct", "maxDrawdownPct", "winRatePct", "profitFactor",
    "exposurePct", "turnoverPct", "cashDayCount", "triggerRatePct", "realizedReturnPct",
    "unrealizedPnlPct", "meanHoldingSessions", "plannedVsActualAllocationDeviationPct", "countMetrics",
    "datasetEndOpenPositionCount",
  ], "metric_definitions"));
  if (isV5Plus) {
    reasons.push(...unknownKeyReasons(metricZeroDenominatorPolicy, [
      "winRatePct", "profitFactor", "triggerRatePct", "meanHoldingSessions",
      "exposurePct", "turnoverPct", "cashDayCount", "countMetrics",
    ], "metric_zero_denominator_policy"));
    reasons.push(...unknownKeyReasons(metricGroupingPolicy, [
      "labelSource", "tradeLevelMetrics", "portfolioLevelMetrics",
      "portfolioMetricGrouping", "successorGrouping",
      ...(isV7 ? ["sellVariantGrouping"] : []),
    ], "metric_grouping_policy"));
  }
  reasons.push(...unknownKeyReasons(source.validationThresholds, [
    "minimumChangedDecisionSamples", "minimumInvestedDecisionDays", "requireChronologicalOutOfSample",
    "requireMultipleMarketRegimes", "autoApplyParameters",
  ], "validation_thresholds"));
  reasons.push(...unknownKeyReasons(source.guardrails, [
    "noFutureData", "keepCashDays", "noSyntheticFill", "noOutcomeDrivenParameterChange",
    "exactTradingCalendarRequired", "providerTimestampRequired", "observationsCannotGrantExecution",
    "entryDayCloseIsMarkToMarketOnly", "legacyT1OutcomeCannotSettlePosition",
    "unrealizedCannotEnterRealizedReturn", "capitalRemainsOccupiedWhileCarried",
    "incompleteRunCannotClaimPerformance",
    ...(isV7 ? [
      "triggerBarCannotFillItself", "barStartObservedAtEnd", "sellIntentCannotMutatePosition",
      "fillReceiptRequiredForPositionMutation", "minuteVolumeCannotProxySealTick",
      "sellVariantsCannotCombineMetrics", "t1IntentCannotFillBeforeTPlus2",
      "manualTickCannotEnterProduction", "formalPerformanceRequiresAllAnchors",
    ] : []),
  ], "guardrails"));
  reasons.push(...unknownKeyReasons(integrity, ["immutable", "contractHashAlgorithm", "contractHash"], "integrity"));

  if (Number(source.schemaVersion) !== BACKTEST_CONTRACT_SCHEMA_VERSION) reasons.push("contract_schema_version_mismatch");
  if (String(source.authority || "") !== BACKTEST_CONTRACT_AUTHORITY) reasons.push("contract_authority_invalid");
  if (String(source.status || "") !== "frozen") reasons.push("contract_not_frozen");
  if (!/^v\d+$/.test(String(source.contractVersion || ""))) reasons.push("contract_version_invalid");
  if (!["v1", "v2", "v3", "v4", "v5", "v6", "v7"].includes(contractVersion)) reasons.push("contract_version_unsupported");
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) reasons.push("strategy_source_commit_invalid");
  if (!String(baseline.baselineId || "").trim()) reasons.push("strategy_baseline_id_missing");
  if (!/^[a-f0-9]{64}$/.test(String(baseline.strategyHash || ""))) reasons.push("strategy_hash_missing_or_invalid");
  if (baseline.strategyHash !== computeStrategyBaselineHash(source)) reasons.push("strategy_hash_mismatch");
  if (String(integrity.contractHash || "") !== computeBacktestContractHash(source)) reasons.push("contract_hash_mismatch");
  if (options.expectedContractHash
    && String(options.expectedContractHash).toLowerCase() !== String(integrity.contractHash || "").toLowerCase()) {
    reasons.push("contract_hash_does_not_match_external_anchor");
  }

  if (Number(versions.decisionChain) !== UNIFIED_DECISION_CHAIN_VERSION) reasons.push("decision_chain_version_mismatch");
  if (Number(versions.unifiedQuantFactors) !== UNIFIED_QUANT_FACTORS_VERSION) reasons.push("unified_factor_version_mismatch");
  if (String(versions.stockFactorAuthority || "") !== STOCK_FACTOR_AUTHORITY) reasons.push("stock_factor_authority_mismatch");
  if (Number(versions.stockFactorEngine) !== STOCK_FACTOR_VERSION) reasons.push("stock_factor_version_mismatch");
  if (isV7) {
    if (versions.minuteEvidenceAuthority !== MINUTE_EVIDENCE_AUTHORITY) {
      reasons.push("minute_evidence_authority_mismatch");
    }
    if (Number(versions.minuteEvidenceVersion) !== MINUTE_EVIDENCE_VERSION) {
      reasons.push("minute_evidence_version_mismatch");
    }
    if (versions.sellDecisionEntryAuthority !== V7_SELL_DECISION_ENTRY_AUTHORITY) {
      reasons.push("sell_decision_entry_authority_mismatch");
    }
    if (Number(versions.sellDecisionEntryVersion) !== V7_SELL_DECISION_ENTRY_VERSION) {
      reasons.push("sell_decision_entry_version_mismatch");
    }
    if (versions.sellStrategyAuthority !== V7_SELL_STRATEGY_AUTHORITY) {
      reasons.push("sell_strategy_authority_mismatch");
    }
    if (Number(versions.sellStrategyVersion) !== V7_SELL_STRATEGY_VERSION) {
      reasons.push("sell_strategy_version_mismatch");
    }
    if (versions.sellStrategyMethod !== V7_SELL_STRATEGY_METHOD) {
      reasons.push("sell_strategy_method_mismatch");
    }
  }
  const runtimeFactorRegistryHash = stableSha256(FACTOR_CATALOG);
  if (baseline.factorRegistryHash !== runtimeFactorRegistryHash) reasons.push("factor_registry_hash_mismatch");
  if (sourceTree.policy !== "tracked_production_js_v1") reasons.push("strategy_source_tree_policy_invalid");

  if (!sourceFiles.length) reasons.push("strategy_source_manifest_missing");
  const seenPaths = new Set();
  for (const row of sourceFiles) {
    reasons.push(...unknownKeyReasons(row, ["path", "scope", "sha256"], "strategy_source_row"));
    const relativePath = safeRelativePath(row && row.path);
    const declaredHash = String(row && row.sha256 || "").toLowerCase();
    const audit = {
      path: relativePath || String(row && row.path || ""),
      scope: String(row && row.scope || ""),
      declaredHash,
      currentHash: null,
      commitHash: null,
      currentMatches: false,
      commitMatches: false,
    };
    if (!relativePath) {
      reasons.push("strategy_source_path_invalid");
      fileAudit.push(audit);
      continue;
    }
    if (seenPaths.has(relativePath)) reasons.push(`strategy_source_path_duplicated:${relativePath}`);
    seenPaths.add(relativePath);
    if (!/^[a-f0-9]{64}$/.test(declaredHash)) reasons.push(`strategy_source_hash_invalid:${relativePath}`);
    if (verifySourceFiles) {
      const currentFile = path.resolve(root, relativePath);
      if (!currentFile.startsWith(`${root}${path.sep}`) || !fs.existsSync(currentFile)) {
        reasons.push(`strategy_source_file_missing:${relativePath}`);
      } else {
        audit.currentHash = fileSha256(currentFile);
        audit.currentMatches = audit.currentHash === declaredHash;
        if (options.verifyWorkingTree !== false && !audit.currentMatches) {
          reasons.push(`strategy_source_worktree_mismatch:${relativePath}`);
        }
      }
    }
    if (verifySourceFiles && sourceCommitAvailable) {
      try {
        audit.commitHash = normalizedTextSha256(gitFileBytes(root, sourceCommit, relativePath));
        audit.commitMatches = audit.commitHash === declaredHash;
        if (!audit.commitMatches) reasons.push(`strategy_source_commit_mismatch:${relativePath}`);
      } catch (_error) {
        reasons.push(`strategy_source_missing_in_commit:${relativePath}`);
      }
    }
    fileAudit.push(audit);
  }
  if (isV7) {
    for (const requiredPath of [
      "quant-decision/minute-evidence.js", "quant-decision/v7-sell-decision.js", "sell-engine.js",
      "fetch_jqdata_minute_outcomes.py", "fetch_akshare_1m_outcomes.py",
      "run-jqdata-tool.js", "run-python-tool.js", "requirements-jqdata.txt", "requirements-akshare.txt",
    ]) {
      if (!seenPaths.has(requiredPath)) reasons.push(`v7_strategy_source_missing:${requiredPath}`);
    }
  }
  if (verifyGit && /^[a-f0-9]{40}$/.test(sourceCommit)) {
    if (!sourceCommitAvailable) reasons.push("strategy_source_commit_missing");
    else if (options.verifyGitAncestry !== false && !gitCommitIsAncestor(root, sourceCommit, "HEAD")) {
      reasons.push("strategy_source_commit_not_ancestor_of_head");
    }
    if (sourceCommitAvailable) {
      const baselineTree = gitProductionSourceTreeHash(root, sourceCommit);
      const headTree = gitProductionSourceTreeHash(root, "HEAD");
      if (Number(sourceTree.fileCount) !== baselineTree.entries.length) reasons.push("strategy_source_tree_file_count_mismatch");
      if (String(sourceTree.hash || "") !== baselineTree.hash) reasons.push("strategy_source_tree_hash_mismatch");
      if (headTree.hash !== baselineTree.hash) reasons.push("strategy_source_tree_head_drift");
      if (productionSourceWorktreeDirty(root, sourceCommit, baselineTree.entries.map((row) => row.path))) {
        reasons.push("strategy_source_tree_worktree_dirty");
      }
      const untracked = untrackedProductionSources(root);
      if (untracked.length) reasons.push(`strategy_untracked_source_files:${untracked.join("|")}`);
    }
  }
  let registryAudit = { valid: null, reasons: [], entry: {} };
  if (verifyRegistry) {
    try {
      const registry = loadBacktestContractRegistry(options.registryPath || DEFAULT_REGISTRY_PATH);
      registryAudit = validateBacktestContractRegistry(registry, source, { root });
      reasons.push(...registryAudit.reasons);
    } catch (_error) {
      reasons.push("contract_registry_unavailable");
      registryAudit = { valid: false, reasons: ["contract_registry_unavailable"], entry: {} };
    }
  }

  if (isV7) {
    if (minuteEvidence.authority !== MINUTE_EVIDENCE_AUTHORITY
      || Number(minuteEvidence.version) !== MINUTE_EVIDENCE_VERSION) {
      reasons.push("minute_evidence_contract_identity_invalid");
    }
    if (Number(minuteEvidence.barIntervalMinutes) !== 1
      || Number(minuteEvidence.fullSessionBarCount) !== 240) {
      reasons.push("minute_evidence_session_contract_invalid");
    }
    if (minuteEvidence.priceMode !== "RAW_UNADJUSTED") reasons.push("minute_evidence_price_mode_invalid");
    if (stableSerialize(minuteEvidence.acceptedSourceTimestampConventions) !== stableSerialize([
      "BAR_END_ASIA_SHANGHAI", "BAR_START_ASIA_SHANGHAI",
    ])) reasons.push("minute_evidence_timestamp_conventions_invalid");
    if (minuteEvidence.barStartObservationPolicy !== "OBSERVED_AT_BAR_START_PLUS_60_SECONDS") {
      reasons.push("bar_start_observation_policy_invalid");
    }
    if (minuteEvidence.decisionDeadlineObservationTime !== "14:55") {
      reasons.push("minute_evidence_deadline_invalid");
    }
    if (minuteEvidence.priceContentHashScope !== CANONICAL_MINUTE_HASH_SCOPE) {
      reasons.push("minute_evidence_hash_scope_invalid");
    }
    if (stableSerialize(minuteEvidence.priceTiersInPriorityOrder) !== stableSerialize([
      MINUTE_EVIDENCE_TIERS.JQDATA_VERIFIED_RAW_1M.id,
      MINUTE_EVIDENCE_TIERS.AKSHARE_VERIFIED_RAW_1M.id,
    ])) reasons.push("minute_evidence_tier_order_invalid");
    if (minuteEvidence.legacy5mPolicy !== "LEGACY_ENTRY_VALIDATION_ONLY_NOT_V7") {
      reasons.push("legacy_5m_v7_policy_invalid");
    }
    if (minuteEvidence.observationPolicy !== "OBSERVATION_ONLY_NOT_V7") {
      reasons.push("observation_v7_policy_invalid");
    }
    if (minuteEvidence.strictFullSessionPositiveTurnoverRequired !== true) {
      reasons.push("minute_positive_turnover_not_required");
    }
    if (minuteEvidence.executionAuthority !== false) reasons.push("minute_evidence_can_grant_execution");
    if (sealTickPolicy.contentHashScope !== CANONICAL_SEAL_HASH_SCOPE
      || Number(sealTickPolicy.maxGapSeconds) !== 5
      || sealTickPolicy.quoteChangesIncludedRequired !== true) {
      reasons.push("seal_tick_integrity_policy_invalid");
    }
    if (sealTickPolicy.proxyPolicy !== "REAL_TICK_BID1_ONLY_NO_1M_VOLUME_PROXY") {
      reasons.push("seal_tick_proxy_policy_invalid");
    }
    if (sealTickPolicy.productionInputPolicy !== "NOT_ACCEPTED_UNTIL_SIGNED_TICK_INGESTION") {
      reasons.push("manual_tick_production_policy_invalid");
    }
    if (core1mVariant.verifiedRaw1mRequired !== true
      || core1mVariant.sealTickRequired !== false
      || core1mVariant.productionInputAvailable !== true) {
      reasons.push("core_1m_variant_invalid");
    }
    if (full1mTickVariant.verifiedRaw1mRequired !== true
      || full1mTickVariant.sealTickRequired !== true
      || full1mTickVariant.productionInputAvailable !== false
      || full1mTickVariant.unavailableUntil !== "SIGNED_TICK_INGESTION") {
      reasons.push("full_1m_tick_variant_invalid");
    }
    if (sellVariants.exactlyOnePerRun !== true || sellVariants.combineMetrics !== false) {
      reasons.push("sell_variant_separation_invalid");
    }
    if (sellVariants.missingTickPolicy !== "FULL_UNAVAILABLE_CORE_REPORTED_SEPARATELY") {
      reasons.push("sell_variant_missing_tick_policy_invalid");
    }
    if (sellVariants.productionManualTickAccepted !== false) {
      reasons.push("manual_tick_accepted_in_sell_variants");
    }
  }

  if (isV3Plus) {
    if (asDecidedSignal.time !== "T_CLOSE_AFTER_15_00_ASIA_SHANGHAI") reasons.push("as_decided_signal_time_invalid");
    if (asDecidedSignal.authority !== "canonical_decision_receipt_v1") reasons.push("as_decided_signal_authority_invalid");
    if (Number(asDecidedSignal.version) !== 1) reasons.push("as_decided_signal_version_invalid");
    if (asDecidedSignal.method !== "same_generation_canonical_projection_sha256_v1") reasons.push("as_decided_signal_method_invalid");
    if (asDecidedSignal.resultPath !== "decisionReceipt.decision.result.stocks") reasons.push("signal_result_path_invalid");
    if (asDecidedSignal.receiptStatus !== "live_canonical") reasons.push("signal_receipt_status_invalid");
    if (isV4Plus) {
      if (asDecidedSignal.nonEmptyResultRequiresAuthorizationPassed !== true) {
        reasons.push("signal_nonempty_authorization_not_required");
      }
      if (asDecidedSignal.closedAuthorizationRequiresEmptyResult !== true) {
        reasons.push("signal_closed_authorization_can_have_stocks");
      }
      if (asDecidedSignal.cashOnlyReceiptAllowed !== true) reasons.push("signal_cash_only_receipt_not_allowed");
      if (asDecidedSignal.authorizationPath !== "decisionReceipt.decision.authorization.passed") {
        reasons.push("signal_authorization_path_invalid");
      }
    } else if (asDecidedSignal.requireAuthorizationPassed !== true) reasons.push("signal_authorization_not_required");
    if (asDecidedSignal.asDecided !== true) reasons.push("as_decided_signal_flag_invalid");
    if (Number(asDecidedSignal.maxResultStocks) !== MAX_RESULT_STOCKS) reasons.push("signal_max_result_stocks_mismatch");
    const expectedIdentityFields = isV4Plus
      ? ["receiptId", "hashes.decisionHash", "hashes.receiptHash", "generation.tradingDate"]
      : ["receiptId", "decisionHash", "receiptHash", "generation.tradingDate"];
    if (stableSerialize(asDecidedSignal.requiredIdentityFields) !== stableSerialize(expectedIdentityFields)) {
      reasons.push("as_decided_signal_identity_fields_invalid");
    }
    if (asDecidedSignal.allowObservationCandidates !== false) reasons.push("observation_candidates_can_enter_backtest");
    if (asDecidedSignal.allowLegacySelected !== false) reasons.push("legacy_selected_can_enter_backtest");
    if (asDecidedSignal.allowForcedCandidate !== false) reasons.push("forced_candidate_allowed");

    if (counterfactualSignal.time !== "T_CLOSE_AFTER_15_00_ASIA_SHANGHAI") reasons.push("counterfactual_signal_time_invalid");
    if (counterfactualSignal.authority !== "counterfactual_unified_decision_projection_v1") {
      reasons.push("counterfactual_signal_authority_invalid");
    }
    if (Number(counterfactualSignal.version) !== 1) reasons.push("counterfactual_signal_version_invalid");
    if (counterfactualSignal.resultPath !== "counterfactualDecision.result.stocks") {
      reasons.push("counterfactual_signal_result_path_invalid");
    }
    if (counterfactualSignal.receiptAllowed !== false) reasons.push("counterfactual_live_receipt_allowed");
    if (isV4Plus) {
      if (counterfactualSignal.nonEmptyResultRequiresAuthorizationPassed !== true) {
        reasons.push("counterfactual_nonempty_authorization_not_required");
      }
      if (counterfactualSignal.closedAuthorizationRequiresEmptyResult !== true) {
        reasons.push("counterfactual_closed_authorization_can_have_stocks");
      }
      if (counterfactualSignal.cashOnlyProjectionAllowed !== true) {
        reasons.push("counterfactual_cash_only_projection_not_allowed");
      }
      if (counterfactualSignal.authorizationPath !== "counterfactualDecision.authorization.passed") {
        reasons.push("counterfactual_authorization_path_invalid");
      }
    } else if (counterfactualSignal.requireAuthorizationPassed !== true) {
      reasons.push("counterfactual_authorization_not_required");
    }
    if (counterfactualSignal.asDecided !== false) reasons.push("counterfactual_as_decided_flag_invalid");
    if (Number(counterfactualSignal.maxResultStocks) !== MAX_RESULT_STOCKS) reasons.push("counterfactual_max_stocks_invalid");
    if (counterfactualSignal.baseStrategyHash !== baseline.strategyHash) reasons.push("counterfactual_base_strategy_hash_invalid");
    if (counterfactualSignal.candidateStrategyHashRequired !== true) reasons.push("counterfactual_candidate_hash_not_required");
    if (counterfactualSignal.definitionHashRequired !== true) reasons.push("counterfactual_definition_hash_not_required");
    if (counterfactualSignal.generationTimestampRequired !== true) reasons.push("counterfactual_generation_timestamp_not_required");
    if (counterfactualSignal.pointInTimeCutoff !== "T_CLOSE_NO_FUTURE_DATA") reasons.push("counterfactual_point_in_time_cutoff_invalid");
    if (isV4Plus) {
      if (counterfactualSignal.allowLiveReceiptAsInput !== false) reasons.push("counterfactual_live_receipt_input_allowed");
      if (counterfactualSignal.coincidentalStockOverlapAllowed !== true) {
        reasons.push("counterfactual_coincidental_stock_overlap_blocked");
      }
    } else if (counterfactualSignal.allowLiveReceiptStocks !== false) {
      reasons.push("counterfactual_live_receipt_stocks_allowed");
    }
  } else {
    if (signal.time !== "T_CLOSE_AFTER_15_00_ASIA_SHANGHAI") reasons.push("signal_time_contract_invalid");
    if (signal.resultPath !== "decisionReceipt.decision.result.stocks") reasons.push("signal_result_path_invalid");
    if (signal.receiptStatus !== "live_canonical") reasons.push("signal_receipt_status_invalid");
    if (signal.requireAuthorizationPassed !== true) reasons.push("signal_authorization_not_required");
    if (Number(signal.maxResultStocks) !== MAX_RESULT_STOCKS) reasons.push("signal_max_result_stocks_mismatch");
    if (signal.allowObservationCandidates !== false) reasons.push("observation_candidates_can_enter_backtest");
    if (signal.allowLegacySelected !== false) reasons.push("legacy_selected_can_enter_backtest");
    if (signal.allowForcedCandidate !== false) reasons.push("forced_candidate_allowed");
  }

  if (entry.session !== "T_PLUS_1") reasons.push("entry_session_invalid");
  if (isV3Plus) {
    if (!isObject(entry.rulePathByLane)
      || entry.rulePathByLane.asDecided !== "decisionReceipt.decision.result.stocks[].executionReplayRule"
      || entry.rulePathByLane.counterfactual !== "counterfactualDecision.result.stocks[].executionReplayRule") {
      reasons.push("entry_rule_path_invalid");
    }
  } else if (entry.rulePath !== "decisionReceipt.decision.result.stocks[].executionReplayRule") {
    reasons.push("entry_rule_path_invalid");
  }
  if (entry.triggerWindowSource !== "FROZEN_PER_STOCK_RULE") reasons.push("entry_trigger_window_source_invalid");
  if (entry.maxGapSource !== "executionReplayRule.maxGapPct") reasons.push("entry_max_gap_source_invalid");
  const expectedEntryFillMethod = isV7 ? "NEXT_1M_BAR_OPEN" : "NEXT_5M_BAR_OPEN";
  if (entry.fillMethod !== expectedEntryFillMethod) reasons.push("entry_fill_method_invalid");
  if (isV4Plus) {
    const expectedEntryFillFormula = isV7
      ? "ROUND_UP_NEXT_1M_OPEN_TIMES_ONE_PLUS_ENTRY_SLIPPAGE_TO_PROVIDER_TICK_THEN_RECHECK_LIMITS"
      : "ROUND_UP_NEXT_5M_OPEN_TIMES_ONE_PLUS_ENTRY_SLIPPAGE_TO_PROVIDER_TICK_THEN_RECHECK_LIMITS";
    if (entry.fillPriceFormula !== expectedEntryFillFormula) {
      reasons.push("entry_fill_price_formula_invalid");
    }
    if (entry.fillProcessingOrder
      !== "TRIGGER_TIME_ASC_THEN_DECISION_RANK_ASC_THEN_STABLE_SECURITY_ID_ASC") {
      reasons.push("entry_fill_processing_order_invalid");
    }
  }
  if (isV7) {
    if (Number(entry.barIntervalMinutes) !== 1) reasons.push("entry_bar_interval_invalid");
    if (entry.triggerBarFillPolicy
      !== "TRIGGER_BAR_NEVER_FILLS_USE_IMMEDIATE_NEXT_CANONICAL_1M_BAR_ONLY") {
      reasons.push("entry_trigger_bar_fill_policy_invalid");
    }
    if (entry.minuteEvidenceAuthority !== MINUTE_EVIDENCE_AUTHORITY) {
      reasons.push("entry_minute_evidence_authority_invalid");
    }
  }
  if (Number(entry.slippageBps) !== 5) reasons.push("entry_slippage_invalid");
  if (isV3Plus) {
    if (entry.referencePriceAdjustmentPolicy
      !== "ADJUST_FROZEN_REFERENCE_AND_MAX_ENTRY_BY_PROVIDER_ACTION_FACTOR_EFFECTIVE_BEFORE_FILL") {
      reasons.push("entry_reference_action_adjustment_invalid");
    }
    if (entry.fillBarPositiveAmountAndVolumeRequired !== true) reasons.push("entry_fill_bar_liquidity_not_required");
    if (entry.upperLimitPolicy !== "OPEN_AT_OR_ABOVE_PROVIDER_UPPER_LIMIT_NO_FILL") reasons.push("entry_upper_limit_policy_invalid");
    if (entry.slippageBoundaryPolicy !== "SLIPPAGE_ABOVE_UPPER_LIMIT_OR_MAX_ENTRY_NO_FILL") {
      reasons.push("entry_slippage_boundary_policy_invalid");
    }
    if (Number(entry.maximumFillBarParticipationPct) !== 5) reasons.push("entry_participation_cap_invalid");
    if (isV4Plus) {
      if (entry.participationCapBreachPolicy !== "REJECT_WHOLE_ORDER_NO_DOWNSIZE") {
        reasons.push("entry_participation_breach_policy_invalid");
      }
      if (entry.maximumOrderQuantityPolicy !== "REJECT_WHOLE_ORDER_NO_SPLIT_NO_TRUNCATION") {
        reasons.push("entry_maximum_order_policy_invalid");
      }
      if (entry.singleOrderPerSignal !== true) reasons.push("entry_single_order_policy_invalid");
    }
    if (entry.partialFillPolicy !== "ALL_OR_NONE") reasons.push("entry_partial_fill_policy_invalid");
  }
  if (entry.limitLockedPolicy !== "NO_FILL") reasons.push("entry_limit_locked_policy_invalid");
  if (entry.missingMinuteDataPolicy !== "DATA_MISSING_NO_FILL") reasons.push("entry_missing_minute_policy_invalid");

  if (portfolio.currency !== "CNY") reasons.push("portfolio_currency_invalid");
  if (!Number.isFinite(Number(portfolio.initialCapital)) || Number(portfolio.initialCapital) <= 0) reasons.push("portfolio_initial_capital_invalid");
  if (!isV3Plus && Number(portfolio.boardLotShares) !== 100) reasons.push("portfolio_board_lot_invalid");
  if (portfolio.allocationPath !== "positionAllocation.initialPortfolioPct") reasons.push("portfolio_allocation_path_invalid");
  if (Number(portfolio.maxConcurrentPositions) !== MAX_RESULT_STOCKS) reasons.push("portfolio_max_positions_invalid");
  if (portfolio.allowLeverage !== false) reasons.push("portfolio_leverage_allowed");
  if (portfolio.preserveCashForUntriggered !== true) reasons.push("portfolio_untriggered_cash_not_preserved");
  if (portfolio.allowSameDaySell !== false) reasons.push("portfolio_t1_sell_rule_invalid");
  if ((isV2 || isV3Plus) && portfolio.capitalReusePolicy !== "NO_REUSE_WHILE_POSITION_OPEN_OR_CARRIED") {
    reasons.push("portfolio_carried_capital_can_be_reused");
  }
  if (isV3Plus) {
    if (portfolio.tradingUnitSource !== "PROVIDER_SECURITY_AND_DATE_SPECIFIC_RULES") {
      reasons.push("portfolio_trading_unit_source_invalid");
    }
    if (stableSerialize(portfolio.requiredTradingUnitFields) !== stableSerialize([
      "minimumBuyQuantity", "buyQuantityIncrement", "maximumOrderQuantity", "sellOddLotPolicy", "priceTick",
    ])) reasons.push("portfolio_trading_unit_fields_invalid");
    if (portfolio.allocationBasis !== "EQUITY_AFTER_T_CLOSE_EVENTS_EXITS_FEES_AND_MARK_TO_MARKET") {
      reasons.push("portfolio_allocation_basis_invalid");
    }
    if (portfolio.allocationPercentUnit !== "PERCENT_0_TO_100") reasons.push("portfolio_allocation_unit_invalid");
    if (isV4Plus) {
      if (portfolio.targetTotalExposureFormula !== "SIGNAL_EQUITY*SUM_INITIAL_PORTFOLIO_PCT/100") {
        reasons.push("portfolio_target_total_formula_invalid");
      }
      if (portfolio.stockTargetNotionalFormula !== "SIGNAL_EQUITY*STOCK_INITIAL_PORTFOLIO_PCT/100") {
        reasons.push("portfolio_stock_target_formula_invalid");
      }
      if (portfolio.exposureBudgetFormula
        !== "MIN(AVAILABLE_CASH,MAX(0,SIGNAL_EQUITY*SUM_INITIAL_PORTFOLIO_PCT/100-OPEN_POSITION_MARKET_VALUE_AT_BUDGET_SNAPSHOT))") {
        reasons.push("portfolio_exposure_budget_invalid");
      }
      if (!isObject(portfolio.totalExposureTargetPathByLane)
        || portfolio.totalExposureTargetPathByLane.asDecided
          !== "decisionReceipt.decision.result.stocks[].positionAllocation.initialPortfolioPct"
        || portfolio.totalExposureTargetPathByLane.counterfactual
          !== "counterfactualDecision.result.stocks[].positionAllocation.initialPortfolioPct") {
        reasons.push("portfolio_exposure_target_paths_invalid");
      }
      if (portfolio.budgetSnapshotTime !== "T_CLOSE_POST_EVENTS_EXITS_COSTS_AND_MARK_TO_MARKET") {
        reasons.push("portfolio_budget_snapshot_time_invalid");
      }
      if (isV5Plus) {
        if (portfolio.remainingExposureBudgetFormula
          !== "MAX(0,FROZEN_INITIAL_EXPOSURE_BUDGET-SUM_PREVIOUS_ACTUAL_ENTRY_NOTIONAL_IN_FROZEN_FILL_ORDER)") {
          reasons.push("portfolio_remaining_budget_formula_invalid");
        }
        if (portfolio.budgetDecrementPolicy
          !== "ONLY_FILLED_ENTRY_NOTIONAL_DECREMENTS_UNFILLED_ORDERS_DO_NOT") {
          reasons.push("portfolio_budget_decrement_policy_invalid");
        }
      }
    } else if (portfolio.exposureBudgetPolicy
      !== "MIN_AVAILABLE_CASH_AND_MAX_ZERO_TARGET_TOTAL_EXPOSURE_MINUS_OPEN_POSITION_MARKET_VALUE") {
      reasons.push("portfolio_exposure_budget_invalid");
    }
    if (isV5Plus) {
      if (portfolio.entrySizingMethod
        !== "COMPUTE_DESIRED_QUANTITY_WITHOUT_MAXIMUM_ORDER_CAP_THEN_REJECT_IF_CAP_EXCEEDED") {
        reasons.push("portfolio_entry_sizing_invalid");
      }
      const expectedDesiredQuantityFormula = isV6Plus
        ? "MAX_LEGAL_Q_WITH_Q*FILL_PRICE<=STOCK_TARGET_NOTIONAL_AND_Q*FILL_PRICE<=REMAINING_EXPOSURE_BUDGET_AND_Q*FILL_PRICE+ROUND_HALF_UP(Q*FILL_PRICE*ENTRY_FEE_BPS/10000,0.01)<=AVAILABLE_CASH_COMPUTED_WITHOUT_MAXIMUM_ORDER_CAP_THEN_REJECT_IF_Q_EXCEEDS_CAP"
        : "LARGEST_VALID_INCREMENT_NOT_EXCEEDING_MIN(STOCK_TARGET_NOTIONAL,REMAINING_EXPOSURE_BUDGET,AVAILABLE_CASH_AFTER_ENTRY_FEE)/FILL_PRICE";
      if (portfolio.desiredQuantityFormula !== expectedDesiredQuantityFormula) {
        reasons.push("portfolio_desired_quantity_formula_invalid");
      }
    } else if (portfolio.entrySizingMethod
      !== "MAX_LEGAL_QUANTITY_NOT_EXCEEDING_STOCK_TARGET_EXPOSURE_BUDGET_AND_AVAILABLE_CASH_AFTER_COST") {
      reasons.push("portfolio_entry_sizing_invalid");
    }
    if (portfolio.capacityAdmissionOrder !== "DECISION_RANK_ASC_THEN_STABLE_SECURITY_ID_ASC") {
      reasons.push("portfolio_capacity_order_invalid");
    }
    if (portfolio.pendingOrderCapacityPolicy
      !== "ADMITTED_ORDER_RESERVES_SLOT_UNTIL_FILLED_OR_T_PLUS_1_WINDOW_EXPIRES") {
      reasons.push("portfolio_pending_capacity_policy_invalid");
    }
    if (portfolio.pendingOrderExpiry !== "END_OF_FROZEN_T_PLUS_1_TRIGGER_WINDOW") {
      reasons.push("portfolio_pending_expiry_invalid");
    }
    if (isV4Plus) {
      if (portfolio.pendingCashReservationPolicy !== "NONE_CASH_ASSIGNED_AT_FILL_TIME") {
        reasons.push("portfolio_pending_cash_policy_invalid");
      }
      if (portfolio.admissionBackfillPolicy !== "ONE_SHOT_AT_T_CLOSE_NO_DYNAMIC_BACKFILL_NO_BAR_LOOKBACK") {
        reasons.push("portfolio_admission_backfill_policy_invalid");
      }
    }
    if (portfolio.capacityDefinition
      !== "MAX_5_DISTINCT_OPEN_OR_CARRIED_SECURITIES_ACROSS_WHOLE_PORTFOLIO") {
      reasons.push("portfolio_capacity_definition_invalid");
    }
    if (portfolio.existingPositionPolicy !== "NO_ADD_DUPLICATE_SIGNAL_IGNORED") {
      reasons.push("portfolio_existing_position_policy_invalid");
    }
    if (portfolio.maximumPortfolioPctUse !== "AUDIT_ONLY_NO_PYRAMIDING") reasons.push("portfolio_maximum_allocation_use_invalid");
    if (portfolio.insufficientOneLotPolicy !== "NO_FILL_KEEP_CASH") reasons.push("portfolio_one_lot_policy_invalid");
    if (portfolio.cashInsufficientPolicy
      !== "DO_NOT_EXCEED_OR_REDISTRIBUTE_TARGET_PROCESS_ADMITTED_ORDER_ONLY") {
      reasons.push("portfolio_cash_insufficient_policy_invalid");
    }
    if (portfolio.cashReservationPolicy !== "NO_FUTURE_EXIT_PROCEEDS_AND_NO_NEGATIVE_CASH") {
      reasons.push("portfolio_cash_reservation_policy_invalid");
    }
    if (portfolio.cashRemainderPolicy !== "KEEP_CASH") reasons.push("portfolio_cash_remainder_policy_invalid");
    if (isV4Plus && portfolio.unfilledTargetRedistributionPolicy !== "NONE") {
      reasons.push("portfolio_unfilled_redistribution_invalid");
    }
    if (portfolio.actualAllocationAuditRequired !== true) reasons.push("portfolio_actual_allocation_audit_missing");
    if (isV4Plus && stableSerialize(portfolio.actualAllocationAuditFields) !== stableSerialize([
      "plannedPortfolioPct", "targetNotional", "actualShares", "actualNotional",
      "actualPortfolioPct", "allocationDeviationPct",
    ])) reasons.push("portfolio_actual_allocation_fields_invalid");
    if (isV5Plus) {
      if (portfolio.actualPortfolioPctFormula !== "ACTUAL_ENTRY_NOTIONAL/SIGNAL_EQUITY*100") {
        reasons.push("portfolio_actual_pct_formula_invalid");
      }
      if (portfolio.allocationAuditPopulation !== "EVERY_FORMAL_RESULT_STOCK_UNFILLED_ROWS_USE_ACTUAL_ZERO") {
        reasons.push("portfolio_allocation_audit_population_invalid");
      }
      if (portfolio.cashOnlyDayAllocationDeviationPolicy
        !== "INCLUDE_VALID_CASH_ONLY_SIGNAL_DAY_WITH_ZERO_DEVIATION") {
        reasons.push("portfolio_cash_day_deviation_policy_invalid");
      }
    }
  }

  if (exit.earliestSession !== "T_PLUS_2") reasons.push("exit_earliest_session_invalid");
  if (isV7) {
    if (exit.method !== "LAYERED_V7_SELL_INTENT_STATE_MACHINE_FROM_T_PLUS_2") {
      reasons.push("exit_method_invalid");
    }
    if (exit.markToMarketAtEntryDayClose !== true) reasons.push("entry_day_mark_to_market_missing");
    if (exit.sellabilityEvidence
      !== "SIGNED_POSITION_DAILY_UPPER_PRICE_CONTEXT_AND_VERIFIED_RAW_1M_REQUIRED") {
      reasons.push("exit_sellability_evidence_invalid");
    }
    if (exit.securityLimitPolicy !== "DATE_AND_SECURITY_SPECIFIC_PROVIDER_LIMITS_REQUIRED_NO_STATIC_PERCENT") {
      reasons.push("exit_security_limit_policy_invalid");
    }
    if (exit.lowerLimitIntentPolicy
      !== "SUBMIT_OR_PERSIST_FULL_EXIT_INTENT_NO_SYNTHETIC_FILL") {
      reasons.push("exit_lower_limit_policy_invalid");
    }
    if (exit.slippageBoundaryPolicy
      !== "SLIPPAGE_BELOW_PROVIDER_LOWER_LIMIT_NO_FILL_KEEP_INTENT") {
      reasons.push("exit_slippage_boundary_policy_invalid");
    }
    if (Number(exit.maximumFillBarParticipationPct) !== 5) reasons.push("exit_participation_cap_invalid");
    if (exit.participationCapBreachPolicy !== "REJECT_WHOLE_EXIT_NO_DOWNSIZE") {
      reasons.push("exit_participation_breach_policy_invalid");
    }
    if (exit.maximumOrderQuantityPolicy !== "REJECT_WHOLE_EXIT_NO_SPLIT_NO_TRUNCATION") {
      reasons.push("exit_maximum_order_policy_invalid");
    }
    if (exit.partialFillPolicy !== "ALL_OR_NONE_PER_INTENT") reasons.push("exit_partial_fill_policy_invalid");
    if (exit.fillPriceFormula
      !== "ROUND_DOWN_NEXT_1M_OPEN_TIMES_ONE_MINUS_EXIT_SLIPPAGE_TO_PROVIDER_TICK_THEN_RECHECK_LIMITS") {
      reasons.push("exit_fill_price_formula_invalid");
    }
    if (exit.priceTickPolicy !== "BUY_ROUND_UP_SELL_ROUND_DOWN_USING_PROVIDER_TICK_THEN_RECHECK_LIMITS") {
      reasons.push("exit_price_tick_policy_invalid");
    }
    if (exit.sellOddLotPolicy !== "USE_PROVIDER_SECURITY_DATE_RULE_TO_SELL_INTENT_QUANTITY") {
      reasons.push("exit_odd_lot_policy_invalid");
    }
    if (exit.proceedsAvailability !== "AVAILABLE_FOR_NEXT_TRADING_SESSION_AFTER_VALIDATED_FILL_AND_COST") {
      reasons.push("exit_proceeds_availability_invalid");
    }
    if (exit.costBasisPolicy !== "WEIGHTED_AVERAGE_ADJUSTED_ONLY_BY_VALID_CORPORATE_ACTIONS") {
      reasons.push("exit_cost_basis_policy_invalid");
    }
    if (exit.suspensionPolicy !== "CARRY_LAST_VERIFIED_CLOSE_AND_FLAG_STALE") {
      reasons.push("exit_suspension_policy_invalid");
    }
    if (exit.holdingExtensionPolicy
      !== "NO_FIXED_MAXIMUM_WHILE_VERIFIED_TREND_FLOATING_PROFIT_MA5_AND_PROTECTION_RULES_PASS") {
      reasons.push("exit_holding_extension_policy_invalid");
    }
    if (exit.datasetEndPolicy !== "REPORT_UNREALIZED_AT_LAST_VERIFIED_CLOSE_NO_SYNTHETIC_EXIT") {
      reasons.push("exit_dataset_end_policy_invalid");
    }
    if (exitStateMachine.authority !== V7_SELL_STRATEGY_AUTHORITY
      || Number(exitStateMachine.version) !== V7_SELL_STRATEGY_VERSION
      || exitStateMachine.method !== V7_SELL_STRATEGY_METHOD) {
      reasons.push("exit_state_machine_identity_invalid");
    }
    if (exitUpperLayer.positionContextAuthority !== V7_POSITION_CONTEXT_AUTHORITY
      || exitUpperLayer.dailyContextAuthority !== V7_DAILY_CONTEXT_AUTHORITY
      || exitUpperLayer.upperContextAuthority !== "canonical_sell_upper_context_v1"
      || exitUpperLayer.comparablePriceContextAuthority !== V7_COMPARABLE_PRICE_AUTHORITY
      || exitUpperLayer.negativeFeedbackAuthority !== V7_NEGATIVE_FEEDBACK_AUTHORITY) {
      reasons.push("exit_upper_context_authorities_invalid");
    }
    if (stableSerialize(exitUpperLayer.identityBindingRequiredFields) !== stableSerialize([
      "securityId", "tradingDate", "generationId", "sourceDecisionHash", "canonicalPayloadHash",
    ])) reasons.push("exit_upper_identity_fields_invalid");
    if (exitUpperLayer.sameSecurityDateGenerationAndDecisionRequired !== true
      || exitUpperLayer.canonicalPayloadHashRequired !== true
      || exitUpperLayer.pointInTimeNotAfterObservedBarRequired !== true) {
      reasons.push("exit_upper_context_binding_invalid");
    }
    if (Number(exitLowerLayer.hardStopLossPctFromActualComparableFill) !== V7_SELL_CFG.hardStopLossPct) {
      reasons.push("exit_hard_stop_invalid");
    }
    if (Number(exitLowerLayer.peakProfitKeepRatio) !== V7_SELL_CFG.peakProfitKeepRatio) {
      reasons.push("exit_peak_profit_keep_ratio_invalid");
    }
    if (exitLowerLayer.highWaterMarkSeedPolicy
      !== "SIGNED_COMPARABLE_HWM_COVERING_THROUGH_PREVIOUS_TRADING_DAY_CLOSE") {
      reasons.push("exit_hwm_seed_policy_invalid");
    }
    if (exitLowerLayer.currentBarHighPolicy !== "PRIOR_COMPLETED_BARS_ONLY_NO_SAME_BAR_FUTURE") {
      reasons.push("exit_hwm_current_bar_policy_invalid");
    }
    if (Number(exitLowerLayer.limitBreakDrawdownPercentagePoints) !== V7_SELL_CFG.limitBreakDrawdownPct
      || Number(exitLowerLayer.limitBreakConfirmCompletedBars) !== V7_SELL_CFG.limitBreakConfirmMinutes
      || exitLowerLayer.limitBreakTriggerBarCountsTowardConfirmation !== false
      || exitLowerLayer.resealResetsConfirmation !== true) {
      reasons.push("exit_limit_break_rule_invalid");
    }
    if (Number(exitLowerLayer.sealRemainingRatio) !== V7_SELL_CFG.sealRemainingRatio
      || Number(exitLowerLayer.sealWeakDurationSeconds) !== V7_SELL_CFG.sealWeakDurationSeconds
      || Number(exitLowerLayer.sealPartialExitPctOfCurrentPosition) !== V7_SELL_CFG.sealPartialExitPct
      || Number(exitLowerLayer.sealPartialExitMaxTimes) !== 1) {
      reasons.push("exit_seal_decay_rule_invalid");
    }
    if (Number(exitLowerLayer.negativeFeedbackMa5BiasStrictlyGreaterPct)
      !== V7_SELL_CFG.negativeFeedbackMa5BiasPct) {
      reasons.push("exit_negative_feedback_bias_invalid");
    }
    if (Number(exitLowerLayer.priorVolumeSessions) !== 2
      || exitLowerLayer.cumulativeVolumeMustStrictlyExceedPriorMaximum !== true
      || Number(exitLowerLayer.previousDayMinusCurrentChangeMinimumPercentagePoints)
        !== V7_SELL_CFG.volumeStagnationChangeGapPct) {
      reasons.push("exit_volume_stagnation_rule_invalid");
    }
    if (exitLowerLayer.deadlineObservedTime !== V7_SELL_CFG.deadlineTime
      || Number(exitLowerLayer.ma5Period) !== 5) {
      reasons.push("exit_deadline_ma5_rule_invalid");
    }
    if (exitLowerLayer.trendExtensionRequiresFloatingProfit !== true
      || exitLowerLayer.trendMaximumHoldingSessions !== null) {
      reasons.push("exit_trend_extension_rule_invalid");
    }
    if (exitLowerLayer.t1RiskPolicy
      !== "HARD_STOP_OR_LOWER_LIMIT_PERSISTS_FULL_EXIT_INTENT_NO_T_PLUS_1_FILL") {
      reasons.push("exit_t1_risk_policy_invalid");
    }
    if (stableSerialize(exitStateMachine.sameBarPriority) !== stableSerialize([
      "LOWER_LIMIT_FULL_EXIT", "HARD_STOP_FULL_EXIT", "PEAK_PROFIT_PROTECTION_FULL_EXIT",
      "LIMIT_BREAK_FULL_EXIT", "DEADLINE_FULL_EXIT", "SEAL_DECAY_PARTIAL_EXIT", "HOLD",
    ])) reasons.push("exit_same_bar_priority_invalid");
    if (exitIntentExecution.strategyProducesIntentOnly !== true
      || exitIntentExecution.executionAuthority !== false
      || exitIntentExecution.actualPositionMutationPolicy !== "VALIDATED_FILL_RECEIPT_ONLY"
      || exitIntentExecution.validatedFillReceiptRequired !== true) {
      reasons.push("exit_intent_fill_separation_invalid");
    }
    if (exitIntentExecution.fillMethod !== "IMMEDIATE_NEXT_CANONICAL_1M_BAR_OPEN_OR_EXIT_BLOCKED"
      || exitIntentExecution.fullExitOverridesPartialSameBar !== true
      || exitIntentExecution.partialFillPolicy !== "ALL_OR_NONE_PER_INTENT"
      || exitIntentExecution.unfilledIntentPolicy !== "KEEP_ACTUAL_POSITION_AND_REPORT_EXIT_BLOCKED") {
      reasons.push("exit_intent_execution_policy_invalid");
    }
  } else if (isV3Plus) {
    if (exit.method !== "FIRST_CONFIRMED_SELLABLE_CLOSE_FROM_T_PLUS_2") reasons.push("exit_method_invalid");
    if (Number(exit.exitSearchSessions) !== 5) reasons.push("exit_search_window_invalid");
    if (exit.searchWindowDefinition !== "FIRST_5_TRADING_SESSIONS_FROM_T_PLUS_2_INCLUSIVE") {
      reasons.push("exit_search_window_definition_invalid");
    }
    if (exit.markToMarketAtEntryDayClose !== true) reasons.push("entry_day_mark_to_market_missing");
    if (exit.sellabilityEvidence !== "PROVIDER_SECURITY_STATUS_DAILY_LIMIT_AND_CLOSE_AUCTION_BAR_REQUIRED") {
      reasons.push("exit_sellability_evidence_invalid");
    }
    if (exit.securityLimitPolicy !== "DATE_AND_SECURITY_SPECIFIC_PROVIDER_LIMITS_REQUIRED_NO_STATIC_PERCENT") {
      reasons.push("exit_security_limit_policy_invalid");
    }
    if (exit.lowerLimitPolicy !== "CLOSE_AT_OR_BELOW_PROVIDER_LOWER_LIMIT_NO_EXIT") {
      reasons.push("exit_lower_limit_policy_invalid");
    }
    if (exit.slippageBoundaryPolicy !== "SLIPPAGE_BELOW_PROVIDER_LOWER_LIMIT_NO_EXIT") {
      reasons.push("exit_slippage_boundary_policy_invalid");
    }
    if (Number(exit.maximumCloseAuctionParticipationPct) !== 5) reasons.push("exit_participation_cap_invalid");
    if (isV4Plus) {
      if (exit.closeAuctionVolumeSource
        !== "PROVIDER_EXPLICIT_SECURITY_DATE_SPECIFIC_CLOSE_AUCTION_VOLUME_SHARES") {
        reasons.push("exit_close_auction_volume_source_invalid");
      }
      if (exit.participationCapBreachPolicy !== "REJECT_WHOLE_EXIT_NO_DOWNSIZE") {
        reasons.push("exit_participation_breach_policy_invalid");
      }
      if (exit.maximumOrderQuantityPolicy !== "REJECT_WHOLE_EXIT_NO_SPLIT_NO_TRUNCATION") {
        reasons.push("exit_maximum_order_policy_invalid");
      }
    }
    if (exit.exitQuantityPolicy !== "FULL_CURRENT_POSITION") reasons.push("exit_quantity_policy_invalid");
    if (exit.partialFillPolicy !== "ALL_OR_NONE") reasons.push("exit_partial_fill_policy_invalid");
    if (exit.fillPriceFormula
      !== "ROUND_DOWN_CLOSE_TIMES_ONE_MINUS_EXIT_SLIPPAGE_TO_PROVIDER_TICK") {
      reasons.push("exit_fill_price_formula_invalid");
    }
    if (exit.nonLimitCloseFillAssumption
      !== "FULL_FILL_ONLY_IF_CLOSE_AUCTION_VOLUME_CAP_AND_TRADING_RULES_PASS") {
      reasons.push("exit_non_limit_fill_assumption_invalid");
    }
    if (exit.priceTickPolicy !== "BUY_ROUND_UP_SELL_ROUND_DOWN_USING_PROVIDER_TICK_THEN_RECHECK_LIMITS") {
      reasons.push("exit_price_tick_policy_invalid");
    }
    if (exit.sellOddLotPolicy !== "USE_PROVIDER_SECURITY_DATE_RULE_TO_SELL_FULL_POSITION") {
      reasons.push("exit_odd_lot_policy_invalid");
    }
    if (exit.proceedsAvailability !== "AVAILABLE_FOR_NEXT_TRADING_SESSION_AFTER_EXIT_COST") {
      reasons.push("exit_proceeds_availability_invalid");
    }
    if (exit.costBasisPolicy !== "WEIGHTED_AVERAGE_ADJUSTED_ONLY_BY_VALID_CORPORATE_ACTIONS") {
      reasons.push("exit_cost_basis_policy_invalid");
    }
    if (exit.suspensionPolicy !== "CARRY_LAST_VERIFIED_CLOSE_AND_FLAG_STALE") reasons.push("exit_suspension_policy_invalid");
    if (exit.afterSearchWindowPolicy
      !== "CONTINUE_CARRY_OCCUPY_CAPITAL_AND_MARK_DAILY_UNTIL_SELLABLE_OR_DATASET_END") {
      reasons.push("exit_after_search_window_policy_invalid");
    }
    if (exit.datasetEndPolicy !== "REPORT_UNREALIZED_AT_LAST_VERIFIED_CLOSE_NO_SYNTHETIC_EXIT") {
      reasons.push("exit_dataset_end_policy_invalid");
    }
  } else if (isV2) {
    if (exit.method !== "FIRST_CONFIRMED_SELLABLE_CLOSE_FROM_T_PLUS_2") reasons.push("exit_method_invalid");
    if (Number(exit.exitSearchSessions) !== 5) reasons.push("exit_search_window_invalid");
    if (exit.searchWindowDefinition !== "FIRST_5_TRADING_SESSIONS_FROM_T_PLUS_2_INCLUSIVE") {
      reasons.push("exit_search_window_definition_invalid");
    }
    if (exit.markToMarketAtEntryDayClose !== true) reasons.push("entry_day_mark_to_market_missing");
    if (exit.sellabilityEvidence !== "PROVIDER_DAILY_LIMIT_SECURITY_STATUS_AND_CLOSE_AUCTION_BAR_REQUIRED") {
      reasons.push("exit_sellability_evidence_invalid");
    }
    if (exit.securityLimitPolicy !== "DATE_AND_SECURITY_SPECIFIC_PROVIDER_LIMITS_REQUIRED_NO_STATIC_PERCENT") {
      reasons.push("exit_security_limit_policy_invalid");
    }
    if (exit.atLowerLimitWithoutQueueEvidencePolicy !== "NO_EXIT_CARRY_AND_MARK_TO_MARKET") {
      reasons.push("exit_lower_limit_policy_invalid");
    }
    if (exit.suspensionPolicy !== "CARRY_LAST_VERIFIED_CLOSE_AND_FLAG_STALE") {
      reasons.push("exit_suspension_policy_invalid");
    }
    if (exit.afterSearchWindowPolicy
      !== "CONTINUE_CARRY_OCCUPY_CAPITAL_AND_MARK_DAILY_UNTIL_SELLABLE_OR_DATASET_END") {
      reasons.push("exit_after_search_window_policy_invalid");
    }
    if (exit.datasetEndPolicy !== "REPORT_UNREALIZED_AT_LAST_VERIFIED_CLOSE_NO_SYNTHETIC_EXIT") {
      reasons.push("exit_dataset_end_policy_invalid");
    }
    if (exit.corporateActionPolicy !== "RAW_PRICE_AND_PROVIDER_CORPORATE_ACTION_LEDGER_REQUIRED") {
      reasons.push("exit_corporate_action_policy_invalid");
    }
  } else {
    if (exit.method !== "FIRST_SELLABLE_CLOSE_FROM_T_PLUS_2") reasons.push("exit_method_invalid");
    if (Number(exit.maximumHoldingSessions) !== 5) reasons.push("exit_maximum_holding_invalid");
    if (exit.markToMarketAtEntryDayClose !== true) reasons.push("entry_day_mark_to_market_missing");
    if (exit.limitDownLockedPolicy !== "CARRY_AND_MARK_TO_MARKET") reasons.push("exit_limit_down_policy_invalid");
    if (exit.unresolvedAtMaxHoldingPolicy !== "CARRY_AND_REPORT_UNREALIZED") reasons.push("exit_unresolved_position_policy_invalid");
  }
  if (isV3Plus) {
    if (corporateActions.securityIdentity !== "PROVIDER_IMMUTABLE_SECURITY_ID_REQUIRED") {
      reasons.push("corporate_action_security_identity_invalid");
    }
    if (isV6Plus) {
      if (corporateActions.entitlementQuantityPolicy !== "SHARES_HELD_AT_PROVIDER_RECORD_DATE_CLOSE") {
        reasons.push("corporate_action_entitlement_quantity_invalid");
      }
      if (stableSerialize(corporateActions.entitlementEventTypes) !== stableSerialize([
        "CASH_DIVIDEND", "STOCK_DISTRIBUTION_OR_SPLIT", "RIGHTS_ISSUE",
      ])) reasons.push("corporate_action_entitlement_types_invalid");
      if (corporateActions.entitlementIdentityPolicy
        !== "RESOLVE_RECORD_DATE_SECURITY_TO_POSITION_LINEAGE_BY_PROVIDER_IMMUTABLE_ID_MAPPING") {
        reasons.push("corporate_action_entitlement_identity_invalid");
      }
      if (corporateActions.recordDateSuspensionPolicy
        !== "USE_ACTUAL_RECORDED_CLOSE_POSITION_QUANTITY_NO_SYNTHETIC_TRADE") {
        reasons.push("corporate_action_record_date_suspension_invalid");
      }
    }
    if (corporateActions.preEntryReferenceAdjustmentPolicy
      !== "APPLY_PROVIDER_ACTION_FACTOR_TO_REFERENCE_TRIGGER_AND_MAX_ENTRY_BEFORE_FILL") {
      reasons.push("corporate_action_pre_entry_adjustment_invalid");
    }
    if (corporateActions.cashDividendPolicy
      !== "PROVIDER_NET_DIVIDEND_TO_RECEIVABLE_ON_EX_DATE_TO_CASH_ON_PAYMENT_DATE") {
      reasons.push("corporate_action_cash_dividend_policy_invalid");
    }
    if (isV4Plus && corporateActions.cashDividendReceivableIncludedInEquity !== true) {
      reasons.push("corporate_action_dividend_receivable_equity_missing");
    }
    if (isV4Plus && corporateActions.cashDividendAvailableBeforePayment !== false) {
      reasons.push("corporate_action_dividend_cash_timing_invalid");
    }
    if (corporateActions.stockDistributionPolicy
      !== "ADJUST_SHARES_AND_COST_ON_EFFECTIVE_DATE_EXACT_RATIO_REQUIRED") {
      reasons.push("corporate_action_stock_distribution_policy_invalid");
    }
    if (corporateActions.fractionalSharePolicy
      !== "PROVIDER_CASH_IN_LIEU_REQUIRED_OTHERWISE_RUN_INCOMPLETE") {
      reasons.push("corporate_action_fractional_share_policy_invalid");
    }
    if (corporateActions.rightsIssuePolicy !== "NO_SUBSCRIPTION_MARK_RUN_INCOMPLETE") {
      reasons.push("corporate_action_rights_issue_policy_invalid");
    }
    if (corporateActions.symbolChangePolicy !== "CONTINUE_POSITION_BY_IMMUTABLE_SECURITY_ID") {
      reasons.push("corporate_action_symbol_change_policy_invalid");
    }
    if (isV4Plus && corporateActions.successorSecurityPolicy
      !== "CONTINUE_ORIGINAL_EXIT_CLOCK_AND_ALLOCATE_COST_BY_PROVIDER_PERCENTAGES") {
      reasons.push("corporate_action_successor_policy_invalid");
    }
    if (isV4Plus && corporateActions.multipleSuccessorCapacityPolicy
      !== "INHERITED_POSITIONS_MAY_EXCEED_LIMIT_BLOCK_NEW_ENTRIES_UNTIL_AT_OR_BELOW_LIMIT") {
      reasons.push("corporate_action_successor_capacity_policy_invalid");
    }
    if (corporateActions.mergerDelistingPolicy
      !== "SETTLE_ONLY_WITH_PROVIDER_TERMINAL_CASH_OR_SECURITY_CONSIDERATION_OTHERWISE_INCOMPLETE_UNREALIZED") {
      reasons.push("corporate_action_delisting_policy_invalid");
    }
    if (isV4Plus && corporateActions.terminalConsiderationPosting
      !== "RECEIVABLE_ON_EFFECTIVE_DATE_CASH_OR_SECURITIES_ON_PROVIDER_SETTLEMENT_DATE") {
      reasons.push("corporate_action_terminal_posting_invalid");
    }
    if (corporateActions.missingActionEvidencePolicy !== "RUN_INCOMPLETE_NO_PERFORMANCE_CLAIM") {
      reasons.push("corporate_action_missing_evidence_policy_invalid");
    }
    const expectedDailyOrder = isV7
      ? "CORPORATE_ACTIONS_THEN_INTRADAY_ENTRIES_THEN_INTRADAY_EXIT_INTENTS_THEN_VALIDATED_FILLS_COSTS_AND_PROCEEDS_THEN_MARK_TO_MARKET_THEN_SIGNAL"
      : "CORPORATE_ACTIONS_THEN_INTRADAY_ENTRIES_THEN_CLOSE_EXITS_THEN_COSTS_AND_PROCEEDS_THEN_MARK_TO_MARKET_THEN_SIGNAL";
    if (eventOrdering.dailyOrder !== expectedDailyOrder) {
      reasons.push("event_ordering_daily_order_invalid");
    }
    if (eventOrdering.sameDayExitProceedsForEntry !== false) reasons.push("event_ordering_future_exit_cash_allowed");
    if (eventOrdering.signalUsesPostClosePortfolioState !== true) reasons.push("event_ordering_signal_state_invalid");
    if (isV4Plus) {
      if (priceAndAccounting.priceAdjustmentMode !== "RAW_UNADJUSTED"
        || priceAndAccounting.dailyOhlcMode !== "RAW_UNADJUSTED"
        || priceAndAccounting.minuteOhlcMode !== "RAW_UNADJUSTED"
        || priceAndAccounting.limitAndTickMode !== "RAW_UNADJUSTED"
        || priceAndAccounting.executionAndMarkToMarketMode !== "RAW_UNADJUSTED") {
        reasons.push("price_adjustment_mode_invalid");
      }
      if (priceAndAccounting.corporateActionApplication !== "LEDGER_ONLY_NO_ADJUSTED_PRICE_SERIES") {
        reasons.push("price_corporate_action_application_invalid");
      }
      if (Number(priceAndAccounting.internalDecimalPrecision) !== 12) reasons.push("accounting_precision_invalid");
      if (priceAndAccounting.cashEventRounding !== "ROUND_HALF_UP_TO_CNY_FEN_PER_EVENT") {
        reasons.push("accounting_cash_rounding_invalid");
      }
      if (priceAndAccounting.feeRounding !== "ROUND_HALF_UP_TO_CNY_FEN_PER_TRADE") {
        reasons.push("accounting_fee_rounding_invalid");
      }
      if (priceAndAccounting.shareQuantityPrecision !== "INTEGER_SHARES") reasons.push("accounting_share_precision_invalid");
      if (Number(priceAndAccounting.reportingPercentageRoundingDecimals) !== 4) {
        reasons.push("accounting_reporting_rounding_invalid");
      }
    }
  }
  if (costs.mode !== "STRESS_SCENARIO") reasons.push("cost_mode_invalid");
  if (Number(costs.entrySlippageBps) !== 5 || Number(costs.entrySlippageBps) !== Number(entry.slippageBps)) {
    reasons.push("cost_entry_slippage_invalid");
  }
  if (Number(costs.exitSlippageBps) !== 5) reasons.push("cost_exit_slippage_invalid");
  if (isV2 || isV3Plus) {
    if (Number(costs.entryFeeBps) !== 4 || Number(costs.exitFeeBps) !== 4) reasons.push("cost_side_fee_invalid");
    if (costs.feeApplication !== "ENTRY_FEE_ON_ENTRY_NOTIONAL_EXIT_FEE_ON_EXIT_NOTIONAL") {
      reasons.push("cost_fee_application_invalid");
    }
    if (costs.unrealizedValuationFeePolicy !== "DEDUCT_ENTRY_FEE_ONLY_UNTIL_REALIZED_EXIT") {
      reasons.push("cost_unrealized_fee_policy_invalid");
    }
  } else {
    if (Number(costs.roundTripFeeBps) !== 8) reasons.push("cost_round_trip_fee_invalid");
    if (costs.feeApplication !== "DEDUCT_ONCE_FROM_ROUND_TRIP_RETURN") reasons.push("cost_fee_application_invalid");
  }
  if (costs.actualBrokerSchedule !== false) reasons.push("costs_misrepresented_as_actual");

  if (isV3Plus) {
    if (dataPolicy.datasetManifestRequired !== true) reasons.push("dataset_manifest_not_required");
    if (dataPolicy.datasetHashMode !== "SHA256_CANONICAL_MANIFEST_WITH_SORTED_SOURCE_FILE_HASHES") {
      reasons.push("dataset_hash_mode_invalid");
    }
    if (dataPolicy.exactlyOneLanePerDataset !== true) reasons.push("dataset_exactly_one_lane_missing");
    if (dataPolicy.laneBoundInDataset !== true) reasons.push("dataset_lane_binding_missing");
    if (dataPolicy.securityMasterRequired !== true) reasons.push("dataset_security_master_missing");
    if (dataPolicy.securityDateTradingRulesRequired !== true) reasons.push("dataset_security_date_rules_missing");
    if (dataPolicy.volumeUnit !== "SHARES_AFTER_PROVIDER_NORMALIZATION") reasons.push("dataset_volume_unit_invalid");
    if (dataPolicy.corporateActionLedgerRequired !== true) reasons.push("dataset_corporate_action_ledger_missing");
    if (dataPolicy.entryAndExitEvidenceRequired !== true) reasons.push("dataset_entry_exit_evidence_missing");
    const expectedAsDecidedDataFields = isV4Plus
      ? ["receiptId", "decisionHash", "receiptHash", "authorizationPassed", "resultStockCount", "tradingDate", "sourceFileHash"]
      : ["receiptId", "decisionHash", "receiptHash", "tradingDate", "sourceFileHash"];
    if (stableSerialize(dataPolicy.asDecidedRequiredFields) !== stableSerialize(expectedAsDecidedDataFields)) {
      reasons.push("dataset_as_decided_fields_invalid");
    }
    const expectedCounterfactualDataFields = isV4Plus
      ? [
        "authority", "asDecided", "baseStrategyHash", "candidateStrategyHash", "definitionHash",
        "pointInTimeDataHash", "authorizationPassed", "resultStockCount", "generatedAt",
        "tradingDate", "sourceFileHash",
      ]
      : [
        "authority", "asDecided", "baseStrategyHash", "candidateStrategyHash", "definitionHash",
        "generatedAt", "tradingDate", "sourceFileHash",
      ];
    if (stableSerialize(dataPolicy.counterfactualRequiredFields)
      !== stableSerialize(expectedCounterfactualDataFields)) reasons.push("dataset_counterfactual_fields_invalid");
    if (isV4Plus && dataPolicy.priceAdjustmentMode !== "RAW_UNADJUSTED") reasons.push("dataset_price_mode_invalid");
    if (isV4Plus && dataPolicy.corporateActionLedgerSchema !== "provider_corporate_action_ledger_v1") {
      reasons.push("dataset_corporate_action_schema_invalid");
    }
    if (dataPolicy.legacyT1OutcomeUse !== "EVALUATION_ONLY_NOT_REALIZED_PNL") {
      reasons.push("legacy_t1_outcome_can_supply_realized_pnl");
    }
    if (isV7) {
      if (dataPolicy.minuteEvidenceManifestRequired !== true
        || dataPolicy.sellVariantBoundInDataset !== true) {
        reasons.push("dataset_v7_minute_variant_binding_missing");
      }
      if (dataPolicy.decisionReceiptAnchorRequired !== true
        || dataPolicy.signedContextAnchorsRequired !== true
        || dataPolicy.fillReceiptAnchorRequired !== true) {
        reasons.push("dataset_v7_authority_anchors_missing");
      }
      const expectedContextAuthorities = {
        position: V7_POSITION_CONTEXT_AUTHORITY,
        daily: V7_DAILY_CONTEXT_AUTHORITY,
        upper: "canonical_sell_upper_context_v1",
        comparablePrice: V7_COMPARABLE_PRICE_AUTHORITY,
        negativeFeedback: V7_NEGATIVE_FEEDBACK_AUTHORITY,
      };
      if (stableSerialize(dataPolicy.signedContextAuthorities)
        !== stableSerialize(expectedContextAuthorities)) reasons.push("dataset_signed_context_authorities_invalid");
      // These identity fields bind the outer position/daily/upper envelopes.
      // The nested comparable-price context uses sourceHash and is covered by
      // the outer position canonical payload hash plus generation/security/date alignment.
      if (stableSerialize(dataPolicy.sameContextIdentityRequiredFields) !== stableSerialize([
        "securityId", "tradingDate", "generationId", "sourceDecisionHash", "canonicalPayloadHash",
      ])) reasons.push("dataset_context_identity_fields_invalid");
      if (dataPolicy.manualTickAcceptedInProduction !== false) reasons.push("dataset_manual_tick_allowed");
      if (dataPolicy.formalPerformanceWithoutAllAnchors !== "INCOMPLETE_NO_PERFORMANCE_CLAIM") {
        reasons.push("dataset_formal_performance_anchor_policy_invalid");
      }
    }
  } else if (isV2) {
    if (dataPolicy.datasetManifestRequired !== true) reasons.push("dataset_manifest_not_required");
    if (dataPolicy.datasetHashMode !== "SHA256_CANONICAL_MANIFEST_WITH_SOURCE_FILE_HASHES") {
      reasons.push("dataset_hash_mode_invalid");
    }
    if (dataPolicy.laneBoundInDataset !== true) reasons.push("dataset_lane_binding_missing");
    if (dataPolicy.asDecidedReceiptStatus !== "live_canonical") reasons.push("dataset_as_decided_status_invalid");
    if (dataPolicy.receiptIdentityRequired !== true) reasons.push("dataset_receipt_identity_missing");
    if (dataPolicy.entryAndExitEvidenceRequired !== true) reasons.push("dataset_entry_exit_evidence_missing");
    if (dataPolicy.legacyT1OutcomeUse !== "EVALUATION_ONLY_NOT_REALIZED_PNL") {
      reasons.push("legacy_t1_outcome_can_supply_realized_pnl");
    }
  }
  if (isV2 || isV3Plus) {
    if (enginePolicy.engineManifestRequired !== true) reasons.push("engine_manifest_not_required");
    if (enginePolicy.engineCommitRequired !== true) reasons.push("engine_commit_not_required");
    if (enginePolicy.engineTreeHashRequired !== true) reasons.push("engine_tree_hash_not_required");
    if (enginePolicy.runtimeNodeVersionRequired !== true) reasons.push("engine_node_version_not_required");
    if (enginePolicy.backtestDirectoryMustBeAnchored !== true) reasons.push("backtest_engine_tree_not_anchored");
    if (isV7) {
      if (enginePolicy.positionEngineRequired !== true) reasons.push("position_engine_not_required");
      if (enginePolicy.fillReceiptValidatorRequired !== true) reasons.push("fill_receipt_validator_not_required");
      if (enginePolicy.formalPerformanceEligibility
        !== "FALSE_UNTIL_DATASET_ENGINE_POSITION_AND_FILL_RECEIPT_ANCHORS_VALIDATE") {
        reasons.push("engine_formal_performance_policy_invalid");
      }
    }
  }

  if (asDecided.asDecided !== true || asDecided.receiptRequired !== true) reasons.push("as_decided_lane_invalid");
  if (asDecided.executionAuthority !== false) reasons.push("as_decided_backtest_can_grant_execution");
  if (counterfactual.asDecided !== false
    || counterfactual.receiptRequired !== false
    || counterfactual.executionAuthority !== false) reasons.push("counterfactual_lane_invalid");
  if (lanes.combineMetrics !== false) reasons.push("backtest_lanes_can_be_combined");

  const requiredOutcomes = new Set([
    "cash_only", "not_triggered", "triggered_unfilled", "position_open", "marked_to_market",
    "exit_blocked", "carried", "settled", "incomplete", "data_missing",
  ]);
  if (isV2 || isV3Plus) {
    requiredOutcomes.add("valuation_stale");
    requiredOutcomes.add("dataset_end_unrealized");
  }
  if (isV3Plus) {
    for (const status of [
      "below_minimum_order_unfilled", "capacity_blocked", "duplicate_signal_ignored",
      "corporate_action_unresolved",
    ]) requiredOutcomes.add(status);
  }
  if (isV7) {
    for (const status of [
      "t1_locked_exit_pending", "exit_intent_pending", "partial_exit_filled", "sell_variant_unavailable",
    ]) requiredOutcomes.add(status);
  }
  const declaredOutcomes = new Set(Array.isArray(source.outcomes && source.outcomes.requiredStatuses)
    ? source.outcomes.requiredStatuses : []);
  for (const status of requiredOutcomes) {
    if (!declaredOutcomes.has(status)) reasons.push(`required_outcome_status_missing:${status}`);
  }
  if (source.outcomes && source.outcomes.deleteCashDays !== false) reasons.push("cash_days_can_be_deleted");
  if (source.outcomes && source.outcomes.deleteFailedSamples !== false) reasons.push("failed_samples_can_be_deleted");
  const metrics = new Set(Array.isArray(source.metrics && source.metrics.required) ? source.metrics.required : []);
  for (const metric of requiredMetricSet()) {
    if (!metrics.has(metric)) reasons.push(`required_metric_missing:${metric}`);
  }
  if (isV2 || isV3Plus) {
    for (const metric of ["staleValuationCount", "datasetEndOpenPositionCount"]) {
      if (!metrics.has(metric)) reasons.push(`required_metric_missing:${metric}`);
    }
  }
  if (isV3Plus) {
    for (const metric of [
      "capacityBlockedCount", "duplicateSignalCount", "belowMinimumOrderCount",
      "plannedVsActualAllocationDeviationPct", "corporateActionUnresolvedCount", "incompleteRunCount",
    ]) {
      if (!metrics.has(metric)) reasons.push(`required_metric_missing:${metric}`);
    }
  }
  const requiredGroups = new Set(["bigCycle", "smallCycle", "theme", "stockMode", "marketCapBucket"]);
  if (isV7) requiredGroups.add("sellVariant");
  const groups = new Set(Array.isArray(source.metrics && source.metrics.groupBy) ? source.metrics.groupBy : []);
  for (const group of requiredGroups) {
    if (!groups.has(group)) reasons.push(`required_metric_group_missing:${group}`);
  }
  if (isV4Plus) {
    const expectedMetricDefinitions = {
      equityCurve: "EACH_TRADING_DAY_CLOSE_CASH_PLUS_RECEIVABLES_PLUS_SUM_RAW_CLOSE_TIMES_SHARES",
      totalReturnPct: "FINAL_TOTAL_EQUITY_DIV_INITIAL_CAPITAL_MINUS_ONE_TIMES_100_INCLUDES_UNREALIZED",
      maxDrawdownPct: "MAX_PEAK_TO_TROUGH_PCT_ON_DAILY_CLOSE_TOTAL_EQUITY_CURVE",
      winRatePct: "SETTLED_POSITIONS_NET_REALIZED_PNL_GT_ZERO_DIV_ALL_SETTLED_POSITIONS_TIMES_100",
      profitFactor: "SUM_POSITIVE_SETTLED_NET_PNL_DIV_ABS_SUM_NEGATIVE_SETTLED_NET_PNL_NULL_IF_NO_NEGATIVE",
      exposurePct: "MEAN_DAILY_CLOSE_GROSS_POSITION_MARKET_VALUE_DIV_TOTAL_EQUITY_TIMES_100",
      turnoverPct: "SUM_ABS_BUY_AND_SELL_EXECUTED_NOTIONAL_DIV_MEAN_DAILY_TOTAL_EQUITY_TIMES_100",
      cashDayCount: "COUNT_TRADING_DAYS_WITH_ZERO_OPEN_POSITIONS_ZERO_CARRIED_POSITIONS_AND_ZERO_FILLS",
      triggerRatePct: "COUNT_TRIGGERED_ADMITTED_SIGNALS_DIV_ALL_ADMITTED_SIGNALS_TIMES_100",
      realizedReturnPct: "SUM_SETTLED_NET_REALIZED_PNL_DIV_INITIAL_CAPITAL_TIMES_100",
      unrealizedPnlPct: "DATASET_END_OPEN_POSITION_UNREALIZED_PNL_DIV_INITIAL_CAPITAL_TIMES_100",
      meanHoldingSessions: "MEAN_SETTLED_POSITION_TRADING_SESSIONS_ENTRY_AND_EXIT_DATES_BOTH_INCLUDED",
      plannedVsActualAllocationDeviationPct: "MEAN_BY_SIGNAL_DAY_OF_SUM_ABS_ACTUAL_PORTFOLIO_PCT_MINUS_PLANNED_PORTFOLIO_PCT",
      countMetrics: "INTEGER_EVENT_OR_STATE_COUNTS_WITH_NO_DEDUPLICATION_BEYOND_STABLE_EVENT_ID",
    };
    if (isV5Plus) {
      expectedMetricDefinitions.winRatePct = "SETTLED_LINEAGES_NET_REALIZED_PNL_GT_ZERO_DIV_ALL_SETTLED_LINEAGES_TIMES_100";
      expectedMetricDefinitions.profitFactor = "SUM_POSITIVE_SETTLED_LINEAGE_NET_PNL_DIV_ABS_SUM_NEGATIVE_SETTLED_LINEAGE_NET_PNL_NULL_IF_NO_NEGATIVE";
      expectedMetricDefinitions.realizedReturnPct = "SUM_SETTLED_LINEAGE_NET_REALIZED_PNL_DIV_INITIAL_CAPITAL_TIMES_100";
      expectedMetricDefinitions.meanHoldingSessions = "MEAN_SETTLED_LINEAGE_TRADING_SESSIONS_ORIGINAL_ENTRY_AND_FINAL_SETTLEMENT_BOTH_INCLUDED";
      expectedMetricDefinitions.plannedVsActualAllocationDeviationPct
        = "MEAN_ACROSS_ALL_VALID_SIGNAL_DAYS_INCLUDING_CASH_ONLY_OF_SUM_FORMAL_RESULT_ROWS_ABS(ACTUAL_ENTRY_NOTIONAL/SIGNAL_EQUITY*100-PLANNED_PORTFOLIO_PCT)";
      if (isV6Plus) {
        expectedMetricDefinitions.unrealizedPnlPct
          = "SUM_DATASET_END_UNSETTLED_LINEAGE_UNREALIZED_PNL_DIV_INITIAL_CAPITAL_TIMES_100";
        expectedMetricDefinitions.datasetEndOpenPositionCount
          = "COUNT_ALL_UNSETTLED_POSITION_LINEAGES_REGARDLESS_OF_REMAINING_SECURITY_SHARE_COUNT";
      }
    }
    if (stableSerialize(metricDefinitions) !== stableSerialize(expectedMetricDefinitions)) {
      reasons.push("metric_definitions_invalid");
    }
    if (isV5Plus) {
      const expectedPositionAccounting = {
        positionLineageIdFormula: "LANE_PLUS_SIGNAL_IDENTITY_PLUS_ORIGINAL_IMMUTABLE_SECURITY_ID",
        successorAggregationPolicy: "ALL_DESCENDANT_SECURITIES_RECEIVABLES_CASH_EVENTS_AND_FEES_REMAIN_ONE_LINEAGE",
        settledCondition: "ALL_LINEAGE_SECURITIES_CLOSED_AND_ALL_RECEIVABLES_SETTLED",
        netRealizedPnlFormula: "ALL_LINEAGE_EXIT_AND_TERMINAL_PROCEEDS_PLUS_DIVIDENDS_PLUS_CASH_IN_LIEU_MINUS_ENTRY_COST_BASIS_MINUS_ALL_FEES",
        winLossCountingPolicy: "ONE_SETTLED_LINEAGE_COUNTS_ONCE_REGARDLESS_OF_SUCCESSOR_COUNT",
        holdingPeriodPolicy: "ORIGINAL_ENTRY_SESSION_TO_FINAL_LINEAGE_SETTLEMENT_SESSION_BOTH_INCLUDED",
      };
      if (isV6Plus) {
        expectedPositionAccounting.entryCostBasisFormula
          = "SUM_ENTRY_FILL_PRICE_TIMES_SHARES_EXCLUDES_FEES";
        expectedPositionAccounting.netRealizedPnlFormula
          = "ALL_LINEAGE_EXIT_AND_TERMINAL_PROCEEDS_PLUS_DIVIDENDS_PLUS_CASH_IN_LIEU_MINUS_ENTRY_NOTIONAL_COST_BASIS_MINUS_ALL_INCURRED_FEES";
        expectedPositionAccounting.openLineageUnrealizedPnlFormula
          = "DESCENDANT_SECURITY_END_MARKET_VALUE_PLUS_UNSETTLED_RECEIVABLES_PLUS_LINEAGE_CASH_DIVIDENDS_CASH_IN_LIEU_EXIT_AND_TERMINAL_PROCEEDS_ALREADY_RECEIVED_MINUS_ENTRY_NOTIONAL_COST_BASIS_MINUS_ALL_INCURRED_FEES";
        expectedPositionAccounting.datasetEndOpenPositionCountDefinition
          = "COUNT_ALL_UNSETTLED_POSITION_LINEAGES_REGARDLESS_OF_REMAINING_SECURITY_SHARE_COUNT";
      }
      if (stableSerialize(positionAccounting) !== stableSerialize(expectedPositionAccounting)) {
        reasons.push("position_accounting_invalid");
      }
      const expectedZeroPolicy = {
        winRatePct: null,
        profitFactor: null,
        triggerRatePct: null,
        meanHoldingSessions: null,
        exposurePct: null,
        turnoverPct: null,
        cashDayCount: 0,
        countMetrics: 0,
      };
      if (stableSerialize(metricZeroDenominatorPolicy) !== stableSerialize(expectedZeroPolicy)) {
        reasons.push("metric_zero_denominator_policy_invalid");
      }
      const expectedGroupingPolicy = {
        labelSource: "ORIGINAL_OPENING_SIGNAL_FROZEN_BIG_CYCLE_SMALL_CYCLE_THEME_STOCK_MODE_MARKET_CAP_BUCKET",
        tradeLevelMetrics: [
          "winRatePct", "profitFactor", "realizedReturnPct", "meanHoldingSessions", "triggerRatePct",
          "plannedVsActualAllocationDeviationPct", "countMetrics",
        ],
        portfolioLevelMetrics: [
          "equityCurve", "totalReturnPct", "maxDrawdownPct", "exposurePct", "turnoverPct", "cashDayCount",
        ],
        portfolioMetricGrouping: "OVERALL_ONLY_NO_SIMPLE_GROUP_ATTRIBUTION",
        successorGrouping: "INHERIT_ORIGINAL_LINEAGE_OPENING_SIGNAL_LABELS",
      };
      if (isV7) {
        expectedGroupingPolicy.sellVariantGrouping
          = "CORE_1M_AND_FULL_1M_TICK_SEPARATE_NO_MERGE";
      }
      if (stableSerialize(metricGroupingPolicy) !== stableSerialize(expectedGroupingPolicy)) {
        reasons.push("metric_grouping_policy_invalid");
      }
    }
  }
  const thresholds = isObject(source.validationThresholds) ? source.validationThresholds : {};
  if (Number(thresholds.minimumChangedDecisionSamples) !== 10) reasons.push("changed_sample_threshold_invalid");
  if (Number(thresholds.minimumInvestedDecisionDays) !== 30) reasons.push("invested_day_threshold_invalid");
  if (thresholds.requireChronologicalOutOfSample !== true) reasons.push("chronological_oos_not_required");
  if (thresholds.requireMultipleMarketRegimes !== true) reasons.push("multiple_regimes_not_required");
  if (thresholds.autoApplyParameters !== false) reasons.push("automatic_parameter_application_allowed");
  const guardrails = isObject(source.guardrails) ? source.guardrails : {};
  if (guardrails.noFutureData !== true) reasons.push("future_data_guard_missing");
  if (guardrails.keepCashDays !== true) reasons.push("cash_day_guard_missing");
  if (guardrails.noSyntheticFill !== true) reasons.push("synthetic_fill_allowed");
  if (guardrails.noOutcomeDrivenParameterChange !== true) reasons.push("outcome_driven_parameter_change_allowed");
  if (guardrails.exactTradingCalendarRequired !== true) reasons.push("exact_calendar_guard_missing");
  if (guardrails.providerTimestampRequired !== true) reasons.push("provider_timestamp_guard_missing");
  if (guardrails.observationsCannotGrantExecution !== true) reasons.push("observation_execution_guard_missing");
  if (guardrails.entryDayCloseIsMarkToMarketOnly !== true) reasons.push("entry_day_exit_guard_missing");
  if ((isV2 || isV3Plus) && guardrails.legacyT1OutcomeCannotSettlePosition !== true) {
    reasons.push("legacy_t1_outcome_settlement_guard_missing");
  }
  if ((isV2 || isV3Plus) && guardrails.unrealizedCannotEnterRealizedReturn !== true) {
    reasons.push("unrealized_realized_return_guard_missing");
  }
  if ((isV2 || isV3Plus) && guardrails.capitalRemainsOccupiedWhileCarried !== true) {
    reasons.push("carried_capital_guard_missing");
  }
  if (isV3Plus && guardrails.incompleteRunCannotClaimPerformance !== true) {
    reasons.push("incomplete_run_performance_guard_missing");
  }
  if (isV7) {
    if (guardrails.triggerBarCannotFillItself !== true) reasons.push("trigger_bar_fill_guard_missing");
    if (guardrails.barStartObservedAtEnd !== true) reasons.push("bar_start_observation_guard_missing");
    if (guardrails.sellIntentCannotMutatePosition !== true) reasons.push("sell_intent_mutation_guard_missing");
    if (guardrails.fillReceiptRequiredForPositionMutation !== true) reasons.push("fill_receipt_mutation_guard_missing");
    if (guardrails.minuteVolumeCannotProxySealTick !== true) reasons.push("minute_volume_tick_proxy_guard_missing");
    if (guardrails.sellVariantsCannotCombineMetrics !== true) reasons.push("sell_variant_metric_guard_missing");
    if (guardrails.t1IntentCannotFillBeforeTPlus2 !== true) reasons.push("t1_intent_fill_guard_missing");
    if (guardrails.manualTickCannotEnterProduction !== true) reasons.push("manual_tick_production_guard_missing");
    if (guardrails.formalPerformanceRequiresAllAnchors !== true) reasons.push("formal_performance_anchor_guard_missing");
  }
  if (integrity.immutable !== true) reasons.push("contract_immutable_flag_missing");
  if (integrity.contractHashAlgorithm !== "sha256_canonical_json_v1") reasons.push("contract_hash_algorithm_invalid");

  return {
    valid: unique(reasons).length === 0,
    reasons: unique(reasons),
    contractHash: computeBacktestContractHash(source),
    strategyHash: computeStrategyBaselineHash(source),
    runtimeVersions: {
      decisionChain: UNIFIED_DECISION_CHAIN_VERSION,
      unifiedQuantFactors: UNIFIED_QUANT_FACTORS_VERSION,
      stockFactorAuthority: STOCK_FACTOR_AUTHORITY,
      stockFactorEngine: STOCK_FACTOR_VERSION,
      factorRegistryHash: runtimeFactorRegistryHash,
      ...(isV7 ? {
        minuteEvidenceAuthority: MINUTE_EVIDENCE_AUTHORITY,
        minuteEvidenceVersion: MINUTE_EVIDENCE_VERSION,
        sellDecisionEntryAuthority: V7_SELL_DECISION_ENTRY_AUTHORITY,
        sellDecisionEntryVersion: V7_SELL_DECISION_ENTRY_VERSION,
        sellStrategyAuthority: V7_SELL_STRATEGY_AUTHORITY,
        sellStrategyVersion: V7_SELL_STRATEGY_VERSION,
        sellStrategyMethod: V7_SELL_STRATEGY_METHOD,
      } : {}),
    },
    fileAudit,
    registryAudit,
  };
}

function assertBacktestContract(contract, options = {}) {
  const inspection = validateBacktestContract(contract, options);
  if (!inspection.valid) {
    const error = new Error(`Backtest contract invalid: ${inspection.reasons.join(",")}`);
    error.code = "BACKTEST_CONTRACT_INVALID";
    error.inspection = inspection;
    throw error;
  }
  return inspection;
}

function computeBacktestRunId(identity) {
  return `bt_${stableSha256(identity).slice(0, 32)}`;
}

function manifestArtifact(root, suppliedPath, defaultPath, label) {
  const defaultRelative = path.relative(root, defaultPath).replace(/\\/g, "/");
  const relativePath = suppliedPath === undefined || suppliedPath === null || suppliedPath === ""
    ? safeRelativePath(defaultRelative)
    : safeRelativePath(suppliedPath);
  if (!relativePath) return { label, relativePath: null, absolutePath: null, exists: false, validPath: false };
  const absolutePath = path.resolve(root, relativePath);
  const insideRoot = absolutePath.startsWith(`${root}${path.sep}`);
  let exists = false;
  if (insideRoot) {
    try {
      exists = fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
    } catch (_error) {
      exists = false;
    }
  }
  return {
    label,
    relativePath,
    absolutePath,
    exists,
    validPath: insideRoot,
  };
}

function inspectBacktestExecutionReadiness(contract, input = {}, options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  const source = isObject(contract) ? contract : {};
  const reasons = [];
  const engineArtifact = manifestArtifact(
    root,
    input.engineManifestPath,
    DEFAULT_ENGINE_MANIFEST_PATH,
    "engine_manifest",
  );
  const datasetArtifact = manifestArtifact(
    root,
    input.datasetManifestPath,
    DEFAULT_DATASET_MANIFEST_PATH,
    "dataset_manifest",
  );
  const decisionReceiptArtifact = manifestArtifact(
    root,
    input.decisionReceiptAnchorPath,
    DEFAULT_DECISION_RECEIPT_ANCHOR_PATH,
    "decision_receipt_anchor",
  );
  const fillReceiptArtifact = manifestArtifact(
    root,
    input.fillReceiptManifestPath,
    DEFAULT_FILL_RECEIPT_MANIFEST_PATH,
    "fill_receipt_manifest",
  );
  const positionEnginePath = path.join(root, "backtest", "position-engine.js");

  if (String(source.contractVersion || "") !== "v7") reasons.push("contract_version_not_execution_target");
  if (String(source.contractVersion || "") === "v7"
    && input.sellVariant === "FULL_1M_TICK"
    && source.sellVariants && source.sellVariants.FULL_1M_TICK
    && source.sellVariants.FULL_1M_TICK.productionInputAvailable !== true) {
    reasons.push("signed_tick_ingestion_missing_for_full_1m_tick");
  }
  if (!engineArtifact.validPath) reasons.push("backtest_engine_manifest_path_invalid");
  else if (!engineArtifact.exists) reasons.push("backtest_engine_manifest_missing");
  else reasons.push("backtest_engine_manifest_validator_not_implemented");
  if (!datasetArtifact.validPath) reasons.push("dataset_manifest_path_invalid");
  else if (!datasetArtifact.exists) reasons.push("validated_dataset_manifest_missing");
  else reasons.push("dataset_manifest_validator_not_implemented");
  if (!decisionReceiptArtifact.validPath) reasons.push("decision_receipt_anchor_path_invalid");
  else if (!decisionReceiptArtifact.exists) reasons.push("validated_decision_receipt_anchor_missing");
  else reasons.push("decision_receipt_anchor_validator_not_implemented");
  if (!fillReceiptArtifact.validPath) reasons.push("fill_receipt_manifest_path_invalid");
  else if (!fillReceiptArtifact.exists) reasons.push("validated_fill_receipt_anchor_missing");
  else reasons.push("fill_receipt_anchor_validator_not_implemented");
  if (!fs.existsSync(positionEnginePath)) reasons.push("dedicated_v7_position_engine_missing");
  else reasons.push("dedicated_v7_position_engine_not_validated");

  return {
    executable: false,
    formalPerformanceEligible: false,
    authorityBindingStatus: "pending_validated_dataset_engine_position_and_fill_receipt_anchors",
    reasons: unique(reasons),
    engineManifest: engineArtifact,
    datasetManifest: datasetArtifact,
    decisionReceiptAnchor: decisionReceiptArtifact,
    fillReceiptManifest: fillReceiptArtifact,
    engineHash: null,
    datasetHash: null,
    decisionReceiptAnchorHash: null,
    fillReceiptAnchorHash: null,
    runtimeNodeVersion: null,
    legacyT1OutcomeEligibleForRealizedPnl: false,
    rule: "数据集、决策凭证、引擎、独立V7持仓执行器和成交回执任一未验证时，禁止正式绩效与运行清单",
  };
}

function createBacktestRunManifest(contract, input = {}) {
  const inputReasons = unknownKeyReasons(input, [
    "datasetManifestPath", "engineManifestPath", "decisionReceiptAnchorPath",
    "fillReceiptManifestPath", "lane", "sellVariant", "runConfig",
  ], "run_input");
  if (inputReasons.length) throw new Error(`Backtest run input invalid: ${inputReasons.join(",")}`);
  const lane = String(input.lane || "");
  if (!Object.prototype.hasOwnProperty.call(contract.lanes || {}, lane) || lane === "combineMetrics") {
    throw new Error("lane must be asDecided or counterfactual");
  }
  const sellVariant = String(input.sellVariant || "");
  if (String(contract.contractVersion || "") === "v7"
    && !["CORE_1M", "FULL_1M_TICK"].includes(sellVariant)) {
    throw new Error("sellVariant must be CORE_1M or FULL_1M_TICK");
  }
  if (String(contract.contractVersion || "") === "v7"
    && sellVariant === "FULL_1M_TICK"
    && contract.sellVariants && contract.sellVariants.FULL_1M_TICK
    && contract.sellVariants.FULL_1M_TICK.productionInputAvailable !== true) {
    throw new Error("FULL_1M_TICK requires signed Tick ingestion and is unavailable in strategy-v7");
  }
  const runConfig = isObject(input.runConfig) ? clone(input.runConfig) : {};
  const runConfigReasons = unknownKeyReasons(runConfig, ["dateFrom", "dateTo", "runLabel"], "run_config");
  const dateFrom = String(runConfig.dateFrom || "");
  const dateTo = String(runConfig.dateTo || "");
  if (runConfigReasons.length) throw new Error(`Backtest run config invalid: ${runConfigReasons.join(",")}`);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(dateFrom) || !/^20\d{2}-\d{2}-\d{2}$/.test(dateTo) || dateFrom > dateTo) {
    throw new Error("runConfig dateFrom/dateTo must be an ordered YYYY-MM-DD range");
  }
  if (runConfig.runLabel !== undefined
    && (typeof runConfig.runLabel !== "string" || runConfig.runLabel.length > 80)) {
    throw new Error("runConfig.runLabel must be a string of at most 80 characters");
  }
  const inspection = assertBacktestContract(contract);
  const readiness = inspectBacktestExecutionReadiness(contract, input);
  if (!readiness.executable) {
    const error = new Error(`Backtest execution not ready: ${readiness.reasons.join(",")}`);
    error.code = "BACKTEST_EXECUTION_NOT_READY";
    error.readiness = readiness;
    throw error;
  }
  const identity = {
    contractHash: inspection.contractHash,
    strategyHash: inspection.strategyHash,
    engineHash: readiness.engineHash,
    datasetHash: readiness.datasetHash,
    decisionReceiptAnchorHash: readiness.decisionReceiptAnchorHash,
    fillReceiptAnchorHash: readiness.fillReceiptAnchorHash,
    runtimeNodeVersion: readiness.runtimeNodeVersion,
    lane,
    ...(String(contract.contractVersion || "") === "v7" ? { sellVariant } : {}),
    runConfig,
  };
  return {
    schemaVersion: 1,
    authority: "a_share_backtest_run_manifest_v1",
    runId: computeBacktestRunId(identity),
    identity,
    executionAuthority: false,
    rule: "回测运行身份只由冻结策略、数据集、轨道和显式配置决定；生成时间不参与runId",
  };
}

module.exports = {
  BACKTEST_CONTRACT_SCHEMA_VERSION,
  BACKTEST_CONTRACT_AUTHORITY,
  DEFAULT_CONTRACT_PATH,
  DEFAULT_REGISTRY_PATH,
  BACKTEST_CONTRACT_REGISTRY_AUTHORITY,
  DEFAULT_ENGINE_MANIFEST_PATH,
  DEFAULT_DATASET_MANIFEST_PATH,
  DEFAULT_DECISION_RECEIPT_ANCHOR_PATH,
  DEFAULT_FILL_RECEIPT_MANIFEST_PATH,
  stableSerialize,
  computeBacktestContractHash,
  computeStrategyBaselineHash,
  gitProductionSourceTreeHash,
  loadBacktestContract,
  loadBacktestContractRegistry,
  validateBacktestContractRegistry,
  validateBacktestContract,
  assertBacktestContract,
  inspectBacktestExecutionReadiness,
  createBacktestRunManifest,
  computeBacktestRunId,
};
