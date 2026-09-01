"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { rebuildArchiveIndex } = require("./archiver");
const {
  buildIndexOpportunityEvidence,
  evaluateStrictClosingPayload,
  normalizeTradingDate,
} = require("./index-opportunity-evidence");
const { validateDecisionReceipt } = require("./quant-decision/decision-receipt");

const HISTORY_BOOTSTRAP_VERSION = 1;
const REQUIRED_DAYS = 5;
const MAX_IMPORT_FILES = 20;
const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function listSnapshotFiles(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function bootstrapPaths(runtimeRoot) {
  const root = path.resolve(runtimeRoot || process.cwd());
  return {
    root,
    historyDir: path.resolve(root, "data", "history"),
    revisionRoot: path.resolve(root, "data", "history-revisions"),
    importDir: path.resolve(root, "data", "history-import"),
  };
}

function historyBootstrapStatus(runtimeRoot) {
  const paths = bootstrapPaths(runtimeRoot);
  const evidence = buildIndexOpportunityEvidence({
    historyDir: paths.historyDir,
    revisionRoot: paths.revisionRoot,
    requestedDays: REQUIRED_DAYS,
  });
  const quality = evidence && evidence.dataQuality || {};
  const availableDays = Math.max(0, Number(quality.availableDays || 0));
  const ready = quality.status === "complete" && quality.consecutive === true;
  const inboxFiles = listSnapshotFiles(paths.importDir);
  return {
    version: HISTORY_BOOTSTRAP_VERSION,
    status: ready ? "ready" : availableDays > 0 ? "collecting" : "empty",
    ready,
    requiredDays: REQUIRED_DAYS,
    availableDays,
    consecutive: ready,
    missingDates: Array.isArray(quality.missingDates) ? [...quality.missingDates] : [],
    note: ready
      ? "最近5个实际交易日均已通过严格收盘证据门。"
      : "历史不足时保持未确认；系统会在每个有效收盘日继续积累，也可导入本机可信的正式归档。",
    import: {
      supported: true,
      directory: "data/history-import",
      pendingFiles: inboxFiles.length,
      files: inboxFiles.slice(0, MAX_IMPORT_FILES),
      accepts: "仅接受本软件生成且可回验live_canonical决策凭证的YYYY-MM-DD.json",
      rawMarketDataBundled: false,
    },
    executionAuthority: false,
  };
}

function atomicWrite(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tempFile = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  let created = false;
  try {
    fs.writeFileSync(tempFile, bytes, { flag: "wx", mode: 0o600 });
    created = true;
    fs.renameSync(tempFile, file);
  } finally {
    if (created || fs.existsSync(tempFile)) {
      try { fs.rmSync(tempFile, { force: true }); } catch { /* best effort */ }
    }
  }
}

function inspectImportSnapshot(filePath, filenameDate) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return { ok: false, reasons: ["import_not_regular_file"] };
  if (stat.size <= 0 || stat.size > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, reasons: ["import_file_size_invalid"] };
  }
  const bytes = fs.readFileSync(filePath);
  let payload;
  try {
    payload = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, reasons: ["import_json_invalid"] };
  }
  const providerDate = normalizeTradingDate(payload && payload.market && payload.market.limitStats
    && payload.market.limitStats.dates && payload.market.limitStats.dates.today);
  const expectedDate = normalizeTradingDate(filenameDate);
  const evidenceInspection = evaluateStrictClosingPayload(payload, expectedDate, { filenameDate: expectedDate });
  const receiptInspection = validateDecisionReceipt(payload && payload.decisionReceipt, {
    sourcePayload: payload,
    snapshotKind: payload && payload.archiveMeta && payload.archiveMeta.snapshotKind,
  });
  const reasons = [
    ...(providerDate === expectedDate ? [] : ["import_provider_date_mismatch"]),
    ...(evidenceInspection.ok ? [] : evidenceInspection.reasons),
    ...(receiptInspection.liveCanonical ? [] : receiptInspection.reasons.length
      ? receiptInspection.reasons.map((reason) => `decision_receipt:${reason}`)
      : ["decision_receipt:not_live_canonical"]),
  ];
  return {
    ok: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
    bytes,
    payload,
    sha256: sha256(bytes),
    tradingDate: expectedDate,
  };
}

function importHistoryBootstrap(runtimeRoot) {
  const paths = bootstrapPaths(runtimeRoot);
  fs.mkdirSync(paths.importDir, { recursive: true });
  fs.mkdirSync(paths.historyDir, { recursive: true });
  const files = listSnapshotFiles(paths.importDir);
  const results = [];
  files.slice(0, MAX_IMPORT_FILES).forEach((file) => {
    const tradingDate = file.slice(0, 10);
    const sourceFile = path.resolve(paths.importDir, file);
    const destinationFile = path.resolve(paths.historyDir, file);
    try {
      const inspection = inspectImportSnapshot(sourceFile, tradingDate);
      if (!inspection.ok) {
        results.push({ file, tradingDate, status: "rejected", reasons: inspection.reasons });
        return;
      }
      if (fs.existsSync(destinationFile)) {
        const existingHash = sha256(fs.readFileSync(destinationFile));
        results.push(existingHash === inspection.sha256
          ? { file, tradingDate, status: "already_present", sha256: inspection.sha256 }
          : { file, tradingDate, status: "conflict", reasons: ["formal_archive_already_exists_with_different_bytes"] });
        return;
      }
      atomicWrite(destinationFile, inspection.bytes);
      results.push({ file, tradingDate, status: "imported", sha256: inspection.sha256 });
    } catch (error) {
      results.push({ file, tradingDate, status: "rejected", reasons: [String(error && error.message || error).slice(0, 200)] });
    }
  });
  if (results.some((item) => item.status === "imported")) rebuildArchiveIndex(paths.historyDir);
  const status = historyBootstrapStatus(paths.root);
  return {
    ok: results.every((item) => ["imported", "already_present"].includes(item.status)),
    importedCount: results.filter((item) => item.status === "imported").length,
    rejectedCount: results.filter((item) => ["rejected", "conflict"].includes(item.status)).length,
    deferredCount: Math.max(0, files.length - MAX_IMPORT_FILES),
    results,
    status,
  };
}

module.exports = {
  HISTORY_BOOTSTRAP_VERSION,
  MAX_IMPORT_FILES,
  REQUIRED_DAYS,
  bootstrapPaths,
  historyBootstrapStatus,
  importHistoryBootstrap,
  inspectImportSnapshot,
  listSnapshotFiles,
};
