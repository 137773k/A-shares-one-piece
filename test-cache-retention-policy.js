"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DEFAULT_RETENTION_DAYS,
  readRetainedJson,
  writeRetainedJson,
} = require("./cache-retention");

function fileSnapshot(rootDir) {
  const result = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      const stat = fs.statSync(fullPath);
      result.push({
        path: path.relative(rootDir, fullPath),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        sha256: crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex"),
      });
    }
  };
  walk(rootDir);
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

test("30-day retention stays intact and cache reads remain side-effect free", () => {
  assert.equal(DEFAULT_RETENTION_DAYS, 30);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "a-share-retention-test-"));
  try {
    const currentFile = path.join(tempRoot, ".hot-stocks-cache.json");
    const archiveDir = path.join(tempRoot, "archive");
    fs.mkdirSync(archiveDir, { recursive: true });

    const expiredFile = path.join(archiveDir, "expired-31-days.json");
    const retainedFile = path.join(archiveDir, "retained-29-days.json");
    fs.writeFileSync(expiredFile, JSON.stringify({ age: 31 }), "utf8");
    fs.writeFileSync(retainedFile, JSON.stringify({ age: 29 }), "utf8");
    const now = Date.now();
    fs.utimesSync(expiredFile, new Date(now - 31 * 86400000), new Date(now - 31 * 86400000));
    fs.utimesSync(retainedFile, new Date(now - 29 * 86400000), new Date(now - 29 * 86400000));

    const payload = { fetchedAt: "2026-08-20T00:00:00.000Z", value: "new snapshot" };
    assert.deepEqual(writeRetainedJson(currentFile, payload, { archiveDir }), payload);
    assert.equal(fs.existsSync(expiredFile), false);
    assert.equal(fs.existsSync(retainedFile), true);
    assert.equal(fs.readdirSync(archiveDir).filter((name) => name.endsWith(".json")).length, 2);

    const beforeRead = fileSnapshot(tempRoot);
    assert.deepEqual(readRetainedJson(currentFile, { archiveDir }), payload);
    const afterRead = fileSnapshot(tempRoot);
    assert.deepEqual(afterRead, beforeRead);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
