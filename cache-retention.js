"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_RETENTION_DAYS = 30;

function cacheArchiveDirFor(filePath) {
  const base = path
    .basename(filePath)
    .replace(/\.json$/i, "")
    .replace(/^\./, "");
  return path.join(path.dirname(filePath), "data", "cache-history", base);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, payload) {
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

function archiveFileName(now = new Date()) {
  return `${now.toISOString().replace(/:/g, "-").replace(/\./g, "-")}.json`;
}

function pruneArchiveDir(archiveDir, retentionDays = DEFAULT_RETENTION_DAYS) {
  if (!archiveDir || !fs.existsSync(archiveDir)) return 0;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const entry of fs.readdirSync(archiveDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(archiveDir, entry.name);
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        removed += 1;
      }
    } catch {
      // 忽略单个历史文件的清理失败，不影响主流程
    }
  }

  return removed;
}

function readLatestArchivedJson(archiveDir) {
  if (!archiveDir || !fs.existsSync(archiveDir)) return null;
  const entries = [];

  for (const entry of fs.readdirSync(archiveDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(archiveDir, entry.name);
    try {
      const stat = fs.statSync(filePath);
      entries.push({ filePath, mtimeMs: stat.mtimeMs });
    } catch {
      // ignore
    }
  }

  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const item of entries) {
    const payload = readJson(item.filePath);
    if (payload) return payload;
  }

  return null;
}

function writeRetainedJson(filePath, payload, options = {}) {
  const archiveDir = options.archiveDir || cacheArchiveDirFor(filePath);
  const retentionDays = Number.isFinite(Number(options.retentionDays)) ? Number(options.retentionDays) : DEFAULT_RETENTION_DAYS;
  const wroteCurrent = writeJson(filePath, payload);

  try {
    ensureDir(archiveDir);
    const archivePath = path.join(archiveDir, archiveFileName());
    fs.writeFileSync(archivePath, JSON.stringify(payload, null, 2), "utf8");
  } catch {
    // 忽略归档失败，至少主文件已经尽量写下来了
  }

  try {
    pruneArchiveDir(archiveDir, retentionDays);
  } catch {
    // 忽略清理失败
  }

  return wroteCurrent ? payload : null;
}

function readRetainedJson(filePath, options = {}) {
  const archiveDir = options.archiveDir || cacheArchiveDirFor(filePath);
  const fallbackFile = options.fallbackFile || null;
  return readJson(filePath) || readLatestArchivedJson(archiveDir) || (fallbackFile ? readJson(fallbackFile) : null);
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  archiveFileName,
  cacheArchiveDirFor,
  pruneArchiveDir,
  readJson,
  readLatestArchivedJson,
  readRetainedJson,
  writeJson,
  writeRetainedJson,
};
