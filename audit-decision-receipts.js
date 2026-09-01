"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { auditDecisionReceiptSnapshots } = require("./quant-decision/decision-receipt-audit");

function main(options = {}) {
  const runtimeRoot = path.resolve(options.runtimeRoot || process.env.A_SHARE_RUNTIME_DIR || __dirname);
  const historyDir = path.resolve(options.historyDir || path.join(runtimeRoot, "data", "history"));
  const reportDir = path.resolve(options.reportDir || path.join(runtimeRoot, "data", "reports"));
  const report = auditDecisionReceiptSnapshots(historyDir);
  fs.mkdirSync(reportDir, { recursive: true });
  const outputFile = path.join(reportDir, "decision-receipt-audit-latest.json");
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outputFile,
    sourceFileCount: report.sourceFileCount,
    liveCanonicalCount: report.liveCanonicalCount,
    legacyWithoutReceiptCount: report.legacyWithoutReceiptCount,
    invalidReceiptCount: report.invalidReceiptCount,
    parseFailureCount: report.parseFailureCount,
    duplicateTradingDates: report.duplicateTradingDates,
  }, null, 2));
  return report;
}

if (require.main === module) main();

module.exports = { main };
