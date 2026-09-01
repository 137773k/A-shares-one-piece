"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = fs.promises;
const os = require("node:os");
const path = require("node:path");
const {
  rawMarketEvidence,
  compareEvidence,
  derivedEvidence,
  parsePreservedRevisions,
  inspectPreservedRevision,
  buildPreservationEvidence,
} = require("./cross-validate-cloud-history");

function payload(overrides = {}) {
  return {
    market: {
      limitStats: {
        ztToday: 78,
        ztPrev: 36,
        ztPrev2: 78,
        dtToday: 11,
        dtPrev: 118,
        dtPrev2: 5,
        dates: { today: "20260820", prev: "20260819", prev2: "20260818" },
        pool: [{ code: "000002" }, { symbol: "sz000001" }],
      },
      snapshot: {
        tradingDate: "2026-08-20",
        totalAmountYi: 20793.63,
        upCount: 3974,
        downCount: 1214,
        indexes: [
          { code: "399001", price: 13972.78, changePct: 0.59 },
          { code: "000001", price: 3903.72, changePct: 0.24 },
        ],
        allA: { price: 1369.14, changePct: 1.41, breadth: 0.7648 },
      },
      state: { cycle: "混沌", subPhase: "修复加强", position: "观察" },
    },
    candidates: [{ code: "000002" }, { symbol: "sz000001" }],
    ...overrides,
  };
}

test("raw evidence normalizes dates and code sets deterministically", () => {
  const evidence = rawMarketEvidence(payload());
  assert.equal(evidence["limit.dates.today"], "2026-08-20");
  assert.deepEqual(evidence["limit.poolCodes"], ["000001", "000002"]);
  assert.equal(evidence["index.000001.price"], 3903.72);
  assert.equal(evidence["allA.changePct"], 1.41);
});

test("raw comparison separates matched fields from a true market mismatch", () => {
  const left = rawMarketEvidence(payload());
  const changed = payload();
  changed.market.limitStats.ztToday = 79;
  const right = rawMarketEvidence(changed);
  const compared = compareEvidence(left, right);
  assert.deepEqual(compared.mismatches, ["limit.ztToday"]);
  assert.equal(compared.matched, compared.compared - 1);
});

test("derived evidence keeps state and candidate versions informational", () => {
  const derived = derivedEvidence(payload());
  assert.equal(derived.cycle, "混沌");
  assert.equal(derived.subPhase, "修复加强");
  assert.deepEqual(derived.candidates, ["000001", "000002"]);
});

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function aggregateSha(rows) {
  return sha256(rows.slice().sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => `${row.date}:${row.sha256}`).join("\n"));
}

async function makePreservationFixture() {
  const runtimeDir = await fsp.mkdtemp(path.join(os.tmpdir(), "cloud-preservation-"));
  const historyDir = path.join(runtimeDir, "data", "history");
  const revisionDir = path.join(runtimeDir, "data", "history-revisions", "local", "2026-08-20");
  await fsp.mkdir(historyDir, { recursive: true });
  await fsp.mkdir(revisionDir, { recursive: true });
  const first = Buffer.from('{"date":"2026-08-19","version":1}\n');
  const baseline = Buffer.from('{"date":"2026-08-20","version":1}\n');
  const upgraded = Buffer.from('{"date":"2026-08-20","version":2}\n');
  const baselineSha = sha256(baseline);
  const revisionFile = path.join(revisionDir, `${baselineSha}.json`);
  await Promise.all([
    fsp.writeFile(path.join(historyDir, "2026-08-19.json"), first),
    fsp.writeFile(path.join(historyDir, "2026-08-20.json"), upgraded),
    fsp.writeFile(revisionFile, baseline),
  ]);
  const expectedAggregate = aggregateSha([
    { date: "2026-08-19", sha256: sha256(first) },
    { date: "2026-08-20", sha256: baselineSha },
  ]);
  return {
    runtimeDir,
    revisionFile,
    baseline,
    upgraded,
    expectedAggregate,
    dates: ["2026-08-19", "2026-08-20"],
  };
}

test("preservation distinguishes upgraded primary from baseline retained in an explicit revision", async (t) => {
  const fixture = await makePreservationFixture();
  t.after(() => fsp.rm(fixture.runtimeDir, { recursive: true, force: true }));
  const mapping = {
    "2026-08-20": `2026-08-20/${path.basename(fixture.revisionFile)}`,
  };
  const beforePrimary = await fsp.readFile(path.join(
    fixture.runtimeDir, "data", "history", "2026-08-20.json",
  ));
  const beforeRevision = await fsp.readFile(fixture.revisionFile);
  const evidence = await buildPreservationEvidence({
    runtimeDir: fixture.runtimeDir,
    preservedDates: fixture.dates,
    preservedRevisions: mapping,
    expectedPrimaryAggregate: fixture.expectedAggregate,
  });

  assert.equal(evidence.currentPrimaryPreserved, false);
  assert.equal(evidence.baselinePreservedAnywhere, true);
  assert.equal(evidence.preserved, true);
  assert.notEqual(evidence.currentAggregate.sha256, fixture.expectedAggregate);
  assert.equal(evidence.reconstructedAggregate.sha256, fixture.expectedAggregate);
  assert.deepEqual(evidence.usedRevisions, [{
    date: "2026-08-20",
    path: `data/history-revisions/local/2026-08-20/${path.basename(fixture.revisionFile)}`,
    sha256: path.basename(fixture.revisionFile, ".json"),
    size: fixture.baseline.length,
  }]);
  assert.deepEqual(await fsp.readFile(path.join(
    fixture.runtimeDir, "data", "history", "2026-08-20.json",
  )), beforePrimary);
  assert.deepEqual(await fsp.readFile(fixture.revisionFile), beforeRevision);
});

test("preserved revision parser rejects non-object and invalid date inputs", () => {
  assert.deepEqual(parsePreservedRevisions('{"2026-08-20":"2026-08-20/a.json"}'), {
    "2026-08-20": "2026-08-20/a.json",
  });
  assert.throws(() => parsePreservedRevisions("[]"), /JSON 对象/);
  assert.throws(() => parsePreservedRevisions('{"not-a-date":"x"}'), /日期无效/);
});

test("explicit revisions cannot escape the local revision root or another date directory", async (t) => {
  const fixture = await makePreservationFixture();
  t.after(() => fsp.rm(fixture.runtimeDir, { recursive: true, force: true }));
  await assert.rejects(
    inspectPreservedRevision(fixture.runtimeDir, "2026-08-20", "../outside.json"),
    /必须直接位于/,
  );
  await assert.rejects(
    inspectPreservedRevision(
      fixture.runtimeDir,
      "2026-08-19",
      `2026-08-20/${path.basename(fixture.revisionFile)}`,
    ),
    /必须直接位于/,
  );
});

test("explicit revision filename SHA must equal the bytes on disk", async (t) => {
  const fixture = await makePreservationFixture();
  t.after(() => fsp.rm(fixture.runtimeDir, { recursive: true, force: true }));
  const badName = `${"0".repeat(64)}.json`;
  const badFile = path.join(path.dirname(fixture.revisionFile), badName);
  await fsp.copyFile(fixture.revisionFile, badFile);
  await assert.rejects(
    inspectPreservedRevision(fixture.runtimeDir, "2026-08-20", `2026-08-20/${badName}`),
    /文件名 SHA-256 与实算值不一致/,
  );
});

test("revision mappings outside preserved dates are rejected instead of guessed", async (t) => {
  const fixture = await makePreservationFixture();
  t.after(() => fsp.rm(fixture.runtimeDir, { recursive: true, force: true }));
  await assert.rejects(buildPreservationEvidence({
    runtimeDir: fixture.runtimeDir,
    preservedDates: ["2026-08-19"],
    preservedRevisions: {
      "2026-08-20": `2026-08-20/${path.basename(fixture.revisionFile)}`,
    },
    expectedPrimaryAggregate: fixture.expectedAggregate,
  }), /不在 --preserved-dates 中/);
});
