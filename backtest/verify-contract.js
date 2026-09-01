"use strict";

const path = require("node:path");
const {
  DEFAULT_CONTRACT_PATH,
  inspectBacktestExecutionReadiness,
  loadBacktestContract,
  validateBacktestContract,
} = require("./contract");

function main(argv = process.argv.slice(2)) {
  const requireExecutable = argv.includes("--require-executable");
  const positional = argv.filter((value) => !String(value).startsWith("--"));
  const contractFile = path.resolve(positional[0] || DEFAULT_CONTRACT_PATH);
  const contract = loadBacktestContract(contractFile);
  const inspection = validateBacktestContract(contract, {
    expectedContractHash: process.env.BACKTEST_EXPECTED_CONTRACT_HASH || undefined,
  });
  const readiness = inspectBacktestExecutionReadiness(contract);
  console.log(JSON.stringify({
    contractFile,
    valid: inspection.valid,
    contractValid: inspection.valid,
    reasons: inspection.reasons,
    executable: readiness.executable,
    readinessReasons: readiness.reasons,
    legacyT1OutcomeEligibleForRealizedPnl: readiness.legacyT1OutcomeEligibleForRealizedPnl,
    contractHash: inspection.contractHash,
    strategyHash: inspection.strategyHash,
    runtimeVersions: inspection.runtimeVersions,
    sourceFileCount: inspection.fileAudit.length,
    currentSourceMatches: inspection.fileAudit.filter((row) => row.currentMatches).length,
    commitSourceMatches: inspection.fileAudit.filter((row) => row.commitMatches).length,
    registryValid: inspection.registryAudit && inspection.registryAudit.valid,
    registryCommit: inspection.registryAudit && inspection.registryAudit.entry
      && inspection.registryAudit.entry.contractCommit || null,
  }, null, 2));
  if (!inspection.valid) return 1;
  if (requireExecutable && !readiness.executable) return 2;
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { main };
