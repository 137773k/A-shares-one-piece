"use strict";

const path = require("node:path");
const { refreshDecisionOutcomeLedger } = require("./quant-decision/decision-ledger");

function main(options = {}) {
  const runtimeRoot = path.resolve(options.runtimeRoot || process.env.A_SHARE_RUNTIME_DIR || __dirname);
  const report = refreshDecisionOutcomeLedger({ ...options, runtimeRoot });
  console.log(JSON.stringify({
    authority: report.authority,
    executionAuthority: false,
    scannedClosingSnapshots: report.scannedClosingSnapshots,
    settledOrRecordedCount: report.settledOrRecordedCount,
    skippedCount: report.skippedCount,
    statusCounts: report.results.reduce((counts, row) => {
      const status = String(row.outcomeStatus || row.reason || "unknown");
      counts[status] = Number(counts[status] || 0) + 1;
      return counts;
    }, {}),
  }, null, 2));
  return report;
}

if (require.main === module) main();

module.exports = { main };
