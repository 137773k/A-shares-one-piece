"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  computeBacktestContractHash,
  computeStrategyBaselineHash,
  gitProductionSourceTreeHash,
  stableSerialize,
} = require("./contract");
const { FACTOR_CATALOG } = require("../unified-quant-factors");
const { loadDecisionEngineLock, validateDecisionEngineLock } = require("./decision-engine-lock");

const root = path.resolve(__dirname, "..");
const sourceCommit = String(process.argv[2] || "").trim().toLowerCase();
const templatePath = path.join(__dirname, "contracts", "strategy-v10.json");
const outputPath = path.join(__dirname, "contracts", "strategy-v11.json");
const dataLayerSourceFiles = [
  ["data-providers/contracts.js", "market_data_contract"],
  ["data-providers/free-fallback-provider.js", "free_fallback_provider"],
  ["data-providers/index.js", "provider_exports"],
  ["data-providers/provider-loader.js", "user_provider_loader"],
  ["data-providers/provider-registry.js", "provider_registry"],
  ["fetch-evidence-quality.js", "market_evidence_quality"],
  ["history-bootstrap.js", "history_bootstrap"],
  ["index-opportunity-evidence.js", "strict_index_history"],
];

function normalizedTextSha256(bytes) {
  const normalized = Buffer.from(bytes).toString("utf8").replace(/\r\n?/g, "\n");
  return crypto.createHash("sha256").update(Buffer.from(normalized, "utf8")).digest("hex");
}

function gitFileBytes(commit, relativePath) {
  return execFileSync("git", ["show", `${commit}:${relativePath}`], {
    cwd: root,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
}

if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("source commit must be a full 40-character Git SHA");
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
}).trim();
if (head !== sourceCommit) throw new Error("create v11 only from the exact clean strategy source commit");
if (fs.existsSync(outputPath)) throw new Error("strategy-v11.json already exists");

const engineLock = loadDecisionEngineLock();
const engineInspection = validateDecisionEngineLock(engineLock);
if (!engineInspection.valid) throw new Error(`decision engine lock invalid: ${engineInspection.reasons.join(",")}`);

const contract = JSON.parse(fs.readFileSync(templatePath, "utf8"));
contract.contractVersion = "v11";
contract.name = "A股情绪周期统一决策回测V11数据源与历史初始化基线";
contract.strategyBaseline.baselineId = "unified-decision-v3-factors-v6-minute-sell-v11-provider-history-v2";
contract.strategyBaseline.sourceCommit = sourceCommit;
contract.strategyBaseline.decisionEngineLock = {
  authority: engineLock.authority,
  version: engineLock.engineVersion,
  engineHash: engineLock.integrity.engineHash,
  sourceCommit: engineLock.sourceCommit,
};
contract.strategyBaseline.factorRegistryHash = crypto
  .createHash("sha256")
  .update(stableSerialize(FACTOR_CATALOG))
  .digest("hex");
const sourceTree = gitProductionSourceTreeHash(root, sourceCommit);
contract.strategyBaseline.sourceTree = {
  policy: "tracked_production_js_v1",
  fileCount: sourceTree.entries.length,
  hash: sourceTree.hash,
};
const sourceEntries = new Map(contract.strategyBaseline.sourceFiles.map((entry) => [entry.path, entry]));
dataLayerSourceFiles.forEach(([sourcePath, scope]) => sourceEntries.set(sourcePath, { path: sourcePath, scope }));
contract.strategyBaseline.sourceFiles = Array.from(sourceEntries.values())
  .map((entry) => ({ ...entry, sha256: normalizedTextSha256(gitFileBytes(sourceCommit, entry.path)) }))
  .sort((left, right) => left.path.localeCompare(right.path));
contract.strategyBaseline.strategyHash = computeStrategyBaselineHash(contract);
contract.signals.counterfactual.baseStrategyHash = contract.strategyBaseline.strategyHash;
contract.integrity.contractHash = computeBacktestContractHash(contract);

fs.writeFileSync(outputPath, `${JSON.stringify(contract, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify({
  output: path.relative(root, outputPath).replace(/\\/g, "/"),
  contractVersion: contract.contractVersion,
  sourceCommit,
  engineHash: engineLock.integrity.engineHash,
  sourceFileCount: contract.strategyBaseline.sourceFiles.length,
  sourceTreeFileCount: contract.strategyBaseline.sourceTree.fileCount,
  strategyHash: contract.strategyBaseline.strategyHash,
  contractHash: contract.integrity.contractHash,
}, null, 2)}\n`);
