"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  stableSha256,
  validateDecisionReceipt,
} = require("./decision-receipt");
const { normalizeTradingDate } = require("./outcome-evidence");

function historyFiles(historyDir) {
  try {
    return fs.readdirSync(historyDir)
      .filter((name) => /^20\d{2}-\d{2}-\d{2}\.json$/.test(name))
      .sort();
  } catch (_error) {
    return [];
  }
}

function providerTradingDate(snapshot) {
  return normalizeTradingDate(
    snapshot && snapshot.market && snapshot.market.limitStats
    && snapshot.market.limitStats.dates && snapshot.market.limitStats.dates.today,
  );
}

function auditDecisionReceiptSnapshots(historyDir) {
  const files = historyFiles(historyDir);
  const records = [];
  const duplicateDates = new Map();

  for (const fileName of files) {
    const filePath = path.join(historyDir, fileName);
    const fileDate = fileName.slice(0, 10);
    let snapshot;
    try {
      snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      records.push({
        fileName,
        fileDate,
        status: "parse_failed",
        liveCanonical: false,
        asDecided: false,
        executionAuthority: false,
        blockers: ["snapshot_parse_failed"],
        error: String(error && error.message || error),
      });
      continue;
    }

    const providerDate = providerTradingDate(snapshot);
    const archiveDate = normalizeTradingDate(snapshot && snapshot.archiveMeta && snapshot.archiveMeta.tradingDate);
    const tradingDate = providerDate || archiveDate || null;
    const snapshotKind = String(snapshot && snapshot.archiveMeta && snapshot.archiveMeta.snapshotKind || "unknown");
    const blockers = [];
    if (!tradingDate) blockers.push("trading_date_missing");
    if (providerDate && archiveDate && providerDate !== archiveDate) blockers.push("provider_archive_date_mismatch");
    if (tradingDate && fileDate !== tradingDate) blockers.push("filename_trading_date_mismatch");
    if (snapshotKind !== "closing") blockers.push("snapshot_not_explicit_closing");

    let receiptInspection = null;
    if (!snapshot.decisionReceipt || typeof snapshot.decisionReceipt !== "object") {
      blockers.push("legacy_archive_without_decision_receipt");
    } else {
      receiptInspection = validateDecisionReceipt(snapshot.decisionReceipt, { sourcePayload: snapshot });
      if (!receiptInspection.liveCanonical) {
        blockers.push(...receiptInspection.reasons.map((reason) => `receipt:${reason}`));
      }
      if (snapshotKind !== "closing") blockers.push("live_receipt_requires_closing_snapshot");
    }

    const liveCanonical = Boolean(
      receiptInspection && receiptInspection.liveCanonical
      && snapshotKind === "closing"
      && blockers.length === 0,
    );
    const row = {
      fileName,
      fileDate,
      tradingDate,
      providerDate,
      archiveDate,
      snapshotKind,
      archiveContentHash: stableSha256(snapshot),
      status: liveCanonical ? "live_canonical" : snapshot.decisionReceipt ? "receipt_invalid" : "legacy_without_receipt",
      receiptId: snapshot.decisionReceipt && snapshot.decisionReceipt.receiptId || null,
      decisionHash: snapshot.decisionReceipt && snapshot.decisionReceipt.hashes
        && snapshot.decisionReceipt.hashes.decisionHash || null,
      liveCanonical,
      asDecided: liveCanonical,
      executionAuthority: false,
      blockers: [...new Set(blockers)],
      rule: liveCanonical
        ? "只认收盘时冻结且能与同档权威源哈希复核的决策凭证"
        : "旧档或无效凭证只做事实审计；当前引擎回放不得冒充当晚真实输出",
    };
    records.push(row);
    if (tradingDate) {
      if (!duplicateDates.has(tradingDate)) duplicateDates.set(tradingDate, []);
      duplicateDates.get(tradingDate).push(fileName);
    }
  }

  const duplicates = Array.from(duplicateDates.entries())
    .filter(([, names]) => names.length > 1)
    .map(([tradingDate, names]) => ({ tradingDate, files: names.slice().sort() }));
  const reasonCounts = records.reduce((counts, row) => {
    row.blockers.forEach((reason) => { counts[reason] = Number(counts[reason] || 0) + 1; });
    return counts;
  }, {});

  return {
    version: 1,
    authority: "decision_receipt_archive_audit_v1",
    executionAuthority: false,
    historyDir: path.resolve(historyDir),
    sourceFileCount: files.length,
    liveCanonicalCount: records.filter((row) => row.liveCanonical).length,
    legacyWithoutReceiptCount: records.filter((row) => row.status === "legacy_without_receipt").length,
    invalidReceiptCount: records.filter((row) => row.status === "receipt_invalid").length,
    parseFailureCount: records.filter((row) => row.status === "parse_failed").length,
    duplicateTradingDates: duplicates,
    reasonCounts,
    records,
    rule: "历史原字节不回写；只有原档内同代收盘live_canonical凭证才属于as-decided样本",
  };
}

module.exports = {
  historyFiles,
  providerTradingDate,
  auditDecisionReceiptSnapshots,
};
