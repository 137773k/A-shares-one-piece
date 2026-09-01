"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const {
  loadCloudHistorySyncConfig,
  normalizeManifest,
  validateSnapshotPayload,
  sha256File,
  httpsGetBuffer,
} = require("./cloud-history-sync");

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const equals = item.indexOf("=");
    if (equals > 2) {
      result[item.slice(2, equals)] = item.slice(equals + 1);
    } else {
      result[item.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return result;
}

function normalizeDate(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  return digits.length === 8
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    : null;
}

function valueAt(object, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => (
    value === undefined || value === null ? undefined : value[key]
  ), object);
}

function setKnown(target, key, value) {
  if (value !== undefined && value !== null) target[key] = value;
}

function codeOf(row) {
  const code = row && (row.code || row.symbol || row.secuCode || row.stockCode);
  const match = String(code || "").match(/\d{6}/);
  return match ? match[0] : null;
}

function sortedCodes(rows) {
  if (!Array.isArray(rows)) return [];
  return [...new Set(rows.map(codeOf).filter(Boolean))].sort();
}

function rawMarketEvidence(payload) {
  const evidence = {};
  const limit = valueAt(payload, "market.limitStats") || {};
  for (const key of ["ztToday", "ztPrev", "ztPrev2", "dtToday", "dtPrev", "dtPrev2"]) {
    setKnown(evidence, `limit.${key}`, limit[key]);
  }
  for (const key of ["today", "prev", "prev2"]) {
    const date = normalizeDate(limit.dates && limit.dates[key]);
    setKnown(evidence, `limit.dates.${key}`, date);
  }
  setKnown(evidence, "limit.poolCodes", sortedCodes(limit.pool));

  const snapshot = valueAt(payload, "market.snapshot") || {};
  for (const key of [
    "tradingDate",
    "shszAmountYi",
    "totalAmountYi",
    "upCount",
    "downCount",
    "flatCount",
    "breadth",
    "avgIndexChange",
    "kechuangChange",
  ]) {
    const value = key === "tradingDate" ? normalizeDate(snapshot[key]) : snapshot[key];
    setKnown(evidence, `market.${key}`, value);
  }
  const indexes = Array.isArray(snapshot.indexes) ? snapshot.indexes : [];
  for (const row of indexes.slice().sort((a, b) => String(a && a.code).localeCompare(String(b && b.code)))) {
    const code = codeOf(row);
    if (!code) continue;
    for (const key of ["price", "changePct", "amountYi"]) {
      setKnown(evidence, `index.${code}.${key}`, row[key]);
    }
  }
  const allA = snapshot.allA || {};
  for (const key of [
    "price",
    "changePct",
    "open",
    "prevClose",
    "low",
    "high",
    "upCount",
    "downCount",
    "breadth",
    "amountYi",
  ]) {
    setKnown(evidence, `allA.${key}`, allA[key]);
  }
  return evidence;
}

function compareEvidence(left, right) {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const mismatches = [];
  let matched = 0;
  for (const key of keys) {
    if (JSON.stringify(left[key]) === JSON.stringify(right[key])) matched += 1;
    else mismatches.push(key);
  }
  return { compared: keys.length, matched, mismatches };
}

function derivedEvidence(payload) {
  return {
    cycle: valueAt(payload, "market.state.cycle") ?? null,
    subPhase: valueAt(payload, "market.state.subPhase") ?? null,
    position: valueAt(payload, "market.state.position") ?? null,
    generationId: valueAt(payload, "decisionBasis.generationId")
      || valueAt(payload, "market.state.phaseDetail.generationId") || null,
    candidates: sortedCodes(payload && payload.candidates),
  };
}

function jaccard(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (!union.size) return 1;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / union.size;
}

async function readJsonFile(file) {
  const bytes = await fsp.readFile(file);
  return { bytes, payload: JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) };
}

async function inspectIfFile(file) {
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) return null;
    const digest = await sha256File(file);
    return { file, ...digest };
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function tierAligned(sidecarTier, desktopEvidence) {
  if (sidecarTier === "exact") return desktopEvidence.qualityTier === "exact";
  if (sidecarTier === "legacy") return desktopEvidence.qualityTier === "legacy_closing_ok";
  if (sidecarTier === "ineligible") return desktopEvidence.formalEligible === false;
  return false;
}

function localDateEvidence(payload) {
  return {
    providerDate: normalizeDate(valueAt(payload, "market.limitStats.dates.today")),
    archiveDate: normalizeDate(valueAt(payload, "archiveMeta.tradingDate")),
  };
}

async function fetchManifest(config) {
  const bytes = await httpsGetBuffer(config.manifestUrl, {
    token: config.token,
    timeoutMs: config.timeoutMs,
    maxBytes: config.maxManifestBytes,
  });
  const raw = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  return { raw, normalized: normalizeManifest(raw, config) };
}

async function primaryAggregate(historyDir, dates) {
  const rows = [];
  for (const date of dates.slice().sort()) {
    const file = path.join(historyDir, `${date}.json`);
    const digest = await sha256File(file);
    rows.push({ date, ...digest });
  }
  return {
    rows,
    sha256: crypto.createHash("sha256")
      .update(rows.map((row) => `${row.date}:${row.sha256}`).join("\n"))
      .digest("hex"),
  };
}

function aggregateRows(rows) {
  const normalizedRows = rows.slice().sort((left, right) => left.date.localeCompare(right.date));
  return {
    rows: normalizedRows,
    sha256: crypto.createHash("sha256")
      .update(normalizedRows.map((row) => `${row.date}:${row.sha256}`).join("\n"))
      .digest("hex"),
  };
}

function parsePreservedRevisions(value) {
  if (value === undefined || value === null || value === "") return {};
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (error) {
      throw new Error(`--preserved-revisions 必须是 JSON 对象：${error.message}`);
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--preserved-revisions 必须是 date -> revision path 的 JSON 对象");
  }
  const result = {};
  for (const [date, file] of Object.entries(parsed)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || normalizeDate(date) !== date) {
      throw new Error(`保留修订日期无效：${date}`);
    }
    if (typeof file !== "string" || !file.trim()) {
      throw new Error(`保留修订路径无效：${date}`);
    }
    result[date] = file.trim();
  }
  return result;
}

function pathKey(file) {
  const resolved = path.resolve(file);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function inspectPreservedRevision(runtimeDir, date, configuredPath) {
  const revisionRoot = path.resolve(runtimeDir, "data", "history-revisions", "local");
  const dateDir = path.join(revisionRoot, date);
  const candidate = path.isAbsolute(configuredPath)
    ? path.resolve(configuredPath)
    : path.resolve(revisionRoot, configuredPath);
  if (!isPathInside(revisionRoot, candidate) || pathKey(path.dirname(candidate)) !== pathKey(dateDir)) {
    throw new Error(`保留修订路径必须直接位于 data/history-revisions/local/${date}：${configuredPath}`);
  }
  const nameMatch = path.basename(candidate).match(/^([a-f0-9]{64})\.json$/);
  if (!nameMatch) {
    throw new Error(`保留修订文件名必须是小写 SHA-256.json：${configuredPath}`);
  }

  let realRoot;
  let realDateDir;
  let realCandidate;
  try {
    [realRoot, realDateDir, realCandidate] = await Promise.all([
      fsp.realpath(revisionRoot),
      fsp.realpath(dateDir),
      fsp.realpath(candidate),
    ]);
  } catch (error) {
    throw new Error(`无法读取保留修订 ${date}：${error.message}`);
  }
  if (!isPathInside(realRoot, realCandidate)
    || pathKey(path.dirname(realCandidate)) !== pathKey(realDateDir)) {
    throw new Error(`保留修订实际路径越界或日期目录不匹配：${configuredPath}`);
  }
  const stat = await fsp.stat(realCandidate);
  if (!stat.isFile()) throw new Error(`保留修订不是普通文件：${configuredPath}`);
  const digest = await sha256File(realCandidate);
  if (digest.sha256 !== nameMatch[1]) {
    throw new Error(`保留修订文件名 SHA-256 与实算值不一致：${configuredPath}`);
  }
  return {
    date,
    path: path.relative(runtimeDir, candidate).split(path.sep).join("/"),
    sha256: digest.sha256,
    size: digest.size,
  };
}

async function buildPreservationEvidence(options = {}) {
  const runtimeDir = path.resolve(options.runtimeDir || process.env.A_SHARE_RUNTIME_DIR || __dirname);
  const historyDir = path.join(runtimeDir, "data", "history");
  const preservedDates = (options.preservedDates || []).slice();
  const preservedRevisions = parsePreservedRevisions(options.preservedRevisions);
  const preservedDateSet = new Set(preservedDates);
  for (const date of Object.keys(preservedRevisions)) {
    if (!preservedDateSet.has(date)) {
      throw new Error(`保留修订日期不在 --preserved-dates 中：${date}`);
    }
  }

  const current = await primaryAggregate(historyDir, preservedDates);
  const replacements = new Map();
  const usedRevisions = [];
  for (const date of Object.keys(preservedRevisions).sort()) {
    const revision = await inspectPreservedRevision(runtimeDir, date, preservedRevisions[date]);
    replacements.set(date, revision);
    usedRevisions.push(revision);
  }
  const reconstructed = aggregateRows(current.rows.map((row) => {
    const revision = replacements.get(row.date);
    return revision ? { date: row.date, size: revision.size, sha256: revision.sha256 } : row;
  }));
  const expectedSha256 = options.expectedPrimaryAggregate || null;
  const currentPrimaryPreserved = expectedSha256 ? current.sha256 === expectedSha256 : null;
  const baselinePreservedAnywhere = expectedSha256
    ? reconstructed.sha256 === expectedSha256
    : null;
  return {
    expectedSha256,
    currentAggregate: {
      sha256: current.sha256,
      fileCount: current.rows.length,
    },
    reconstructedAggregate: {
      sha256: reconstructed.sha256,
      fileCount: reconstructed.rows.length,
    },
    currentPrimaryPreserved,
    baselinePreservedAnywhere,
    preserved: baselinePreservedAnywhere,
    usedRevisions,
  };
}

async function validateCloudHistory(options = {}) {
  const runtimeDir = path.resolve(options.runtimeDir || process.env.A_SHARE_RUNTIME_DIR || __dirname);
  const config = loadCloudHistorySyncConfig({ runtimeDir });
  const { raw, normalized } = await fetchManifest(config);
  const rawByDate = new Map(raw.files.map((entry) => [entry.date, entry]));
  const historyDir = path.join(runtimeDir, "data", "history");
  const revisionDir = path.join(runtimeDir, "data", "history-revisions", "cloud");
  const indexRows = JSON.parse(await fsp.readFile(path.join(historyDir, "index.json"), "utf8"));
  const indexDates = new Set(indexRows.map((row) => row && row.date).filter(Boolean));

  const transferRows = [];
  const transferMissing = [];
  const tierMismatches = [];
  const placementViolations = [];
  const overlapComparisons = [];
  for (const entry of normalized.entries) {
    const formalFile = path.join(historyDir, `${entry.date}.json`);
    const revisionFile = path.join(revisionDir, `${entry.date}--${entry.sha256}.json`);
    const [formal, revision] = await Promise.all([
      inspectIfFile(formalFile),
      inspectIfFile(revisionFile),
    ]);
    const formalMatches = formal && formal.size === entry.size && formal.sha256 === entry.sha256;
    const revisionMatches = revision && revision.size === entry.size && revision.sha256 === entry.sha256;
    const transfer = formalMatches ? formal : (revisionMatches ? revision : null);
    if (!transfer) {
      transferMissing.push({
        date: entry.date,
        expectedSha256: entry.sha256,
        formalSha256: formal && formal.sha256,
        revisionSha256: revision && revision.sha256,
      });
      continue;
    }
    const transferred = await readJsonFile(transfer.file);
    const evidence = validateSnapshotPayload(transferred.payload, entry);
    const sidecar = rawByDate.get(entry.date);
    const sidecarTier = sidecar && sidecar.quality && sidecar.quality.qualityTier || "unknown";
    if (!tierAligned(sidecarTier, evidence)) {
      tierMismatches.push({ date: entry.date, sidecarTier, desktopTier: evidence.qualityTier });
    }
    if (evidence.formalEligible && !formal) {
      placementViolations.push({ date: entry.date, reason: "eligible_without_formal_primary" });
    }
    if (!evidence.formalEligible && formalMatches) {
      placementViolations.push({ date: entry.date, reason: "ineligible_promoted_to_formal" });
    }
    transferRows.push({
      date: entry.date,
      location: formalMatches ? "formal" : "cloud_revision",
      sha256: entry.sha256,
      bytes: entry.size,
      sidecarTier,
      desktopTier: evidence.qualityTier,
      formalEligible: evidence.formalEligible,
    });

    if (formal && !formalMatches) {
      const local = await readJsonFile(formal.file);
      const rawComparison = compareEvidence(
        rawMarketEvidence(local.payload),
        rawMarketEvidence(transferred.payload),
      );
      const localDerived = derivedEvidence(local.payload);
      const cloudDerived = derivedEvidence(transferred.payload);
      overlapComparisons.push({
        date: entry.date,
        rawCompared: rawComparison.compared,
        rawMatched: rawComparison.matched,
        rawMismatchFields: rawComparison.mismatches,
        stateEqual: localDerived.cycle === cloudDerived.cycle
          && localDerived.subPhase === cloudDerived.subPhase
          && localDerived.position === cloudDerived.position,
        localState: {
          cycle: localDerived.cycle,
          subPhase: localDerived.subPhase,
          position: localDerived.position,
        },
        cloudState: {
          cycle: cloudDerived.cycle,
          subPhase: cloudDerived.subPhase,
          position: cloudDerived.position,
        },
        localCandidateCount: localDerived.candidates.length,
        cloudCandidateCount: cloudDerived.candidates.length,
        candidateJaccard: Number(jaccard(localDerived.candidates, cloudDerived.candidates).toFixed(4)),
        sameGeneration: Boolean(localDerived.generationId)
          && localDerived.generationId === cloudDerived.generationId,
      });
    }
  }

  const formalFiles = (await fsp.readdir(historyDir))
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .sort();
  const validFormalDates = [];
  const invalidFormalDates = [];
  for (const file of formalFiles) {
    const date = file.slice(0, 10);
    const { payload } = await readJsonFile(path.join(historyDir, file));
    const dates = localDateEvidence(payload);
    const mismatch = (dates.providerDate && dates.providerDate !== date)
      || (dates.archiveDate && dates.archiveDate !== date);
    (mismatch ? invalidFormalDates : validFormalDates).push({ date, ...dates });
  }
  const validMissingFromIndex = validFormalDates
    .filter((item) => !indexDates.has(item.date)).map((item) => item.date);
  const invalidPresentInIndex = invalidFormalDates
    .filter((item) => indexDates.has(item.date)).map((item) => item.date);

  let preservation = null;
  if (options.preservedDates && options.preservedDates.length) {
    preservation = await buildPreservationEvidence({
      runtimeDir,
      preservedDates: options.preservedDates,
      preservedRevisions: options.preservedRevisions,
      expectedPrimaryAggregate: options.expectedPrimaryAggregate,
    });
  }

  const rawCompared = overlapComparisons.reduce((sum, row) => sum + row.rawCompared, 0);
  const rawMatched = overlapComparisons.reduce((sum, row) => sum + row.rawMatched, 0);
  const jaccards = overlapComparisons.map((row) => row.candidateJaccard);
  const report = {
    generatedAt: new Date().toISOString(),
    transport: {
      manifestFiles: raw.files.length,
      structurallyAccepted: normalized.entries.length,
      manifestRejected: normalized.rejected,
      exactCopiesFound: transferRows.length,
      exactCopyMissing: transferMissing,
      formalCopies: transferRows.filter((row) => row.location === "formal").length,
      revisionCopies: transferRows.filter((row) => row.location === "cloud_revision").length,
      bytesVerified: transferRows.reduce((sum, row) => sum + row.bytes, 0),
    },
    quality: {
      sidecar: {
        exact: Number(raw.exactFileCount || 0),
        legacy: Number(raw.legacyEligibleFileCount || 0),
        ineligible: raw.files.length - Number(raw.eligibleFileCount || 0),
      },
      desktop: Object.fromEntries(
        ["exact", "legacy_closing_ok", "closing_partial", "invalid"].map((tier) => [
          tier,
          transferRows.filter((row) => row.desktopTier === tier).length,
        ]),
      ),
      tierMismatches,
      placementViolations,
    },
    preservation,
    index: {
      rows: indexRows.length,
      validFormalFiles: validFormalDates.length,
      invalidFormalFilesRetained: invalidFormalDates,
      validMissingFromIndex,
      invalidPresentInIndex,
    },
    overlap: {
      comparedDates: overlapComparisons.length,
      rawFieldsCompared: rawCompared,
      rawFieldsMatched: rawMatched,
      rawFieldMatchRate: rawCompared ? Number((rawMatched / rawCompared).toFixed(4)) : null,
      stateEqualDates: overlapComparisons.filter((row) => row.stateEqual).length,
      candidateJaccard: jaccards.length ? {
        average: Number((jaccards.reduce((sum, value) => sum + value, 0) / jaccards.length).toFixed(4)),
        min: Math.min(...jaccards),
        max: Math.max(...jaccards),
      } : null,
      rows: overlapComparisons,
    },
  };
  report.ok = report.transport.exactCopyMissing.length === 0
    && report.transport.manifestRejected.length === 0
    && report.quality.tierMismatches.length === 0
    && report.quality.placementViolations.length === 0
    && report.index.validMissingFromIndex.length === 0
    && report.index.invalidPresentInIndex.length === 0
    && (!preservation || preservation.preserved !== false);
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const preservedDates = String(args["preserved-dates"] || "")
    .split(",").map((item) => item.trim()).filter(Boolean);
  const report = await validateCloudHistory({
    runtimeDir: args["runtime-dir"],
    preservedDates,
    preservedRevisions: parsePreservedRevisions(args["preserved-revisions"]),
    expectedPrimaryAggregate: args["expected-primary-aggregate"],
  });
  if (args.output) {
    const outputFile = path.resolve(args.output);
    const tempFile = `${outputFile}.${process.pid}.tmp`;
    try {
      await fsp.access(outputFile, fs.constants.F_OK);
      throw new Error(`交叉验证报告已存在，拒绝覆盖：${outputFile}`);
    } catch (error) {
      if (error && error.code !== "ENOENT") throw error;
    }
    await fsp.mkdir(path.dirname(outputFile), { recursive: true });
    const handle = await fsp.open(tempFile, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(report, null, 2), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fsp.rename(tempFile, outputFile);
    } catch (error) {
      await fsp.unlink(tempFile).catch(() => {});
      throw error;
    }
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  rawMarketEvidence,
  compareEvidence,
  derivedEvidence,
  parsePreservedRevisions,
  inspectPreservedRevision,
  buildPreservationEvidence,
  validateCloudHistory,
};
