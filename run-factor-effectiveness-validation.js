"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  runFactorEffectivenessValidation,
  renderValidationMarkdown,
} = require("./factor-effectiveness-validation");

function main() {
  const historyDir = path.join(__dirname, "data", "history");
  const outputDir = path.join(__dirname, "data", "reports");
  const jsonPath = path.join(outputDir, "factor-effectiveness-validation-latest.json");
  const markdownPath = path.join(outputDir, "factor-effectiveness-validation-latest.md");
  const report = runFactorEffectivenessValidation({ historyDir });

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderValidationMarkdown(report), "utf8");

  console.log(JSON.stringify({
    assessment: report.assessment,
    dataAudit: {
      jsonFileCount: report.dataAudit.jsonFileCount,
      usableClosingSnapshotCount: report.dataAudit.usableClosingSnapshotCount,
      exactT1PairCount: report.dataAudit.exactT1PairCount,
    },
    rankingStudy: {
      daysWithComparableUniverse: report.rankingStudy.daysWithComparableUniverse,
      unifiedTop1: report.rankingStudy.summaries.unifiedTop1,
      legacyTop1: report.rankingStudy.summaries.legacyTop1,
      top1Comparison: report.rankingStudy.comparisons.top1,
      top3Comparison: report.rankingStudy.comparisons.top3,
      top5Comparison: report.rankingStudy.comparisons.top5,
    },
    frozenDecisionStudy: {
      status: report.frozenDecisionStudy.status,
      receiptCount: report.frozenDecisionStudy.receiptCount,
      settledOutcomeCount: report.frozenDecisionStudy.settledOutcomeCount,
      pendingOutcomeCount: report.frozenDecisionStudy.pendingOutcomeCount,
      selectedStockDecisionCount: report.frozenDecisionStudy.selectedStockDecisionCount,
      meanNetReturnContributionPct: report.frozenDecisionStudy.meanNetReturnContributionPct,
    },
    counterfactualReplayStudy: {
      provenance: report.counterfactualReplayStudy.provenance,
      asDecided: report.counterfactualReplayStudy.asDecided,
      integrityValidDays: report.counterfactualReplayStudy.integrityValidDays,
      replayReadyDays: report.counterfactualReplayStudy.replayReadyDays,
      permissionOpenDays: report.counterfactualReplayStudy.permissionOpenDays,
      daysWithReconstructedPicks: report.counterfactualReplayStudy.daysWithReconstructedPicks,
      cashDays: report.counterfactualReplayStudy.cashDays,
      allocatedTop5: report.counterfactualReplayStudy.summaries.top5,
    },
    outputs: { jsonPath, markdownPath },
  }, null, 2));
}

if (require.main === module) main();

module.exports = { main };
