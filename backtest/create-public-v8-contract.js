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

const root = path.resolve(__dirname, "..");
const sourceCommit = String(process.argv[2] || "").trim().toLowerCase();
const templatePath = path.join(__dirname, "contracts", "strategy-v7.json");
const outputPath = path.join(__dirname, "contracts", "strategy-v8.json");

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

if (!/^[a-f0-9]{40}$/.test(sourceCommit)) {
  throw new Error("source commit must be a full 40-character Git SHA");
}
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
}).trim();
if (head !== sourceCommit) {
  throw new Error("create v8 only from the exact clean strategy source commit");
}
if (fs.existsSync(outputPath)) throw new Error("strategy-v8.json already exists");

const contract = JSON.parse(fs.readFileSync(templatePath, "utf8"));
contract.contractVersion = "v8";
contract.name = "A股情绪周期统一决策回测V8公开仓库基线";
contract.strategyBaseline.baselineId = "unified-decision-v3-factors-v6-minute-sell-v8-public";
contract.strategyBaseline.sourceCommit = sourceCommit;
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
contract.strategyBaseline.sourceFiles = contract.strategyBaseline.sourceFiles.map((entry) => ({
  ...entry,
  sha256: normalizedTextSha256(gitFileBytes(sourceCommit, entry.path)),
}));
contract.strategyBaseline.strategyHash = computeStrategyBaselineHash(contract);
contract.signals.counterfactual.baseStrategyHash = contract.strategyBaseline.strategyHash;
contract.integrity.contractHash = computeBacktestContractHash(contract);

fs.writeFileSync(outputPath, `${JSON.stringify(contract, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify({
  output: path.relative(root, outputPath).replace(/\\/g, "/"),
  contractVersion: contract.contractVersion,
  sourceCommit,
  sourceFileCount: contract.strategyBaseline.sourceFiles.length,
  sourceTreeFileCount: contract.strategyBaseline.sourceTree.fileCount,
  strategyHash: contract.strategyBaseline.strategyHash,
  contractHash: contract.integrity.contractHash,
}, null, 2)}\n`);
