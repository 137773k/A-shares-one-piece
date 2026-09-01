"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildIndexOpportunityEvidence,
  evaluateStrictClosingPayload,
  serveIndexOpportunityEvidence,
} = require("./index-opportunity-evidence");

const VALUES = {
  "2026-08-14": { open: 1385.47, high: 1389.58, low: 1371.73, close: 1385.82, changePct: 0.18, amountYi: 21428.43 },
  "2026-08-17": { open: 1388.17, high: 1410.91, low: 1378.86, close: 1410.91, changePct: 1.81, amountYi: 23874.57 },
  "2026-08-18": { open: 1410.54, high: 1412.05, low: 1395.21, close: 1408.21, changePct: -0.19, amountYi: 24007.75 },
  "2026-08-19": { open: 1393.61, high: 1393.97, low: 1346.74, close: 1350.12, changePct: -4.12, amountYi: 25110.43 },
  "2026-08-20": { open: 1362.39, high: 1375.46, low: 1358.49, close: 1369.14, changePct: 1.41, amountYi: 20793.63 },
};

function payloadFor(date, prev, prev2, overrides = {}) {
  const values = { ...VALUES[date], ...(overrides.values || {}) };
  const payload = {
    tradingDate: date,
    stale: false,
    fetchError: "",
    fetchStatus: { level: overrides.fetchLevel || "ok" },
    archiveMeta: {
      tradingDate: date,
      snapshotKind: "closing",
    },
    themeLibrary: {
      tradingDate: date,
      snapshotKind: "closing",
    },
    market: {
      limitStats: {
        dates: {
          today: date.replaceAll("-", ""),
          prev: prev.replaceAll("-", ""),
          prev2: prev2.replaceAll("-", ""),
          verified: true,
          calendarQuality: "provider-scan",
        },
      },
      snapshot: {
        tradingDate: date,
        source: "eastmoney-live",
        shszAmountYi: values.amountYi,
        totalAmountYi: values.amountYi,
        allA: {
          code: "883421",
          name: "同花顺全A(沪深)",
          source: "ths-public-page",
          open: values.open,
          high: values.high,
          low: values.low,
          price: values.close,
          changePct: values.changePct,
        },
      },
    },
  };
  if (overrides.mutate) overrides.mutate(payload);
  return payload;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createFourOfFiveFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "index-opportunity-evidence-"));
  const historyDir = path.join(root, "data", "history");
  const revisionRoot = path.join(root, "data", "history-revisions");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeJson(path.join(historyDir, "2026-08-14.json"), payloadFor("2026-08-14", "2026-08-13", "2026-08-12"));
  writeJson(path.join(historyDir, "2026-08-17.json"), payloadFor("2026-08-17", "2026-08-14", "2026-08-13"));
  writeJson(path.join(historyDir, "2026-08-19.json"), payloadFor("2026-08-19", "2026-08-18", "2026-08-17"));
  writeJson(path.join(historyDir, "2026-08-20.json"), payloadFor("2026-08-20", "2026-08-19", "2026-08-18"));
  writeJson(
    path.join(revisionRoot, "cloud", "2026-08-18--partial.json"),
    payloadFor("2026-08-18", "2026-08-17", "2026-08-14", { fetchLevel: "partial" }),
  );
  return { root, historyDir, revisionRoot };
}

function directoryFingerprint(root) {
  const rows = [];
  function walk(directory) {
    fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
      .forEach((entry) => {
        const filePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(filePath);
          return;
        }
        if (!entry.isFile()) return;
        const bytes = fs.readFileSync(filePath);
        const stat = fs.statSync(filePath);
        rows.push({
          file: path.relative(root, filePath).split(path.sep).join("/"),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        });
      });
  }
  walk(root);
  return rows;
}

test("keeps the provider-defined five-session window and rejects the partial revision", (t) => {
  const fixture = createFourOfFiveFixture(t);
  const before = directoryFingerprint(path.join(fixture.root, "data"));
  const evidence = buildIndexOpportunityEvidence(fixture);
  const after = directoryFingerprint(path.join(fixture.root, "data"));

  assert.deepEqual(after, before, "evidence reads must not alter history bytes or mtimes");
  assert.deepEqual(
    evidence.index.points.map((point) => point.tradingDate),
    ["2026-08-14", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"],
  );
  assert.equal(evidence.index.points.some((point) => point.tradingDate === "2026-08-13"), false);
  assert.deepEqual(
    evidence.index.points.map((point) => point.quality),
    ["strict_closing", "strict_closing", "missing", "strict_closing", "strict_closing"],
  );
  const missingIndex = evidence.index.points.find((point) => point.tradingDate === "2026-08-18");
  const missingAmount = evidence.turnover.points.find((point) => point.tradingDate === "2026-08-18");
  assert.equal(missingIndex.open, null);
  assert.equal(missingIndex.close, null);
  assert.equal(missingAmount.amountYi, null);
  assert.equal(evidence.dataQuality.status, "partial");
  assert.equal(evidence.dataQuality.requestedDays, 5);
  assert.equal(evidence.dataQuality.availableDays, 4);
  assert.equal(evidence.dataQuality.strictClosingOnly, true);
  assert.equal(evidence.dataQuality.consecutive, false);
  assert.deepEqual(evidence.dataQuality.missingDates, ["2026-08-18"]);
  assert.match(evidence.dataQuality.excluded[0].file, /^cloud\/2026-08-18--partial\.json$/);
  assert.ok(evidence.dataQuality.excluded[0].reasons.includes("revision_not_formal_archive"));
  assert.ok(evidence.dataQuality.excluded[0].reasons.includes("fetch_evidence_incomplete"));
  assert.equal(evidence.turnover.averageAmountYi, null);
  assert.equal(evidence.turnover.vsAveragePct, null);
  assert.equal(evidence.turnover.rangePositionPct, null);
  assert.equal(evidence.turnover.latestAmountYi, 20793.63);
  assert.equal(evidence.turnover.previousAmountYi, 25110.43);
  assert.equal(evidence.turnover.latestVsPreviousPct, -17.19);
  assert.equal(evidence.turnover.latestVsPreviousKey, "contracted");
  assert.equal(evidence.turnover.latestVsPreviousLabel, "较前一交易日缩量");
  assert.match(evidence.turnover.note, /不是明日预测/);
});

test("strict gate rejects partial, stale/error, non-closing, invalid OHLC, and wrong-date archives", () => {
  const partial = payloadFor("2026-08-18", "2026-08-17", "2026-08-14", { fetchLevel: "partial" });
  const partialResult = evaluateStrictClosingPayload(partial, "2026-08-18", { filenameDate: "2026-08-18" });
  assert.equal(partialResult.ok, false);
  assert.ok(partialResult.reasons.includes("fetch_evidence_incomplete"));

  const compromised = payloadFor("2026-08-20", "2026-08-19", "2026-08-18", {
    mutate: (payload) => {
      payload.stale = true;
      payload.fetchError = "upstream failed";
      payload.archiveMeta.snapshotKind = "intraday";
      payload.market.snapshot.allA.source = "cache";
      payload.market.snapshot.shszAmountYi = 0;
      payload.market.snapshot.totalAmountYi = 0;
    },
  });
  const compromisedResult = evaluateStrictClosingPayload(compromised, "2026-08-20", { filenameDate: "2026-08-20" });
  assert.equal(compromisedResult.ok, false);
  assert.ok(compromisedResult.reasons.includes("payload_stale"));
  assert.ok(compromisedResult.reasons.includes("fetch_error_present"));
  assert.ok(compromisedResult.reasons.includes("snapshot_not_closing"));
  assert.ok(compromisedResult.reasons.includes("all_a_source_untrusted"));
  assert.ok(compromisedResult.reasons.includes("turnover_missing_or_nonpositive"));

  const invalidOhlc = payloadFor("2026-08-20", "2026-08-19", "2026-08-18", {
    values: { high: 1360, close: 1369.14 },
  });
  const invalidResult = evaluateStrictClosingPayload(invalidOhlc, "2026-08-20", { filenameDate: "2026-08-20" });
  assert.equal(invalidResult.ok, false);
  assert.ok(invalidResult.reasons.includes("all_a_ohlc_invalid"));

  const wrongDate = payloadFor("2026-08-17", "2026-08-14", "2026-08-13");
  const wrongDateResult = evaluateStrictClosingPayload(wrongDate, "2026-08-18", { filenameDate: "2026-08-18" });
  assert.equal(wrongDateResult.ok, false);
  assert.ok(wrongDateResult.reasons.includes("provider_date_mismatch"));
  assert.ok(wrongDateResult.reasons.includes("archive_date_mismatch"));
  assert.ok(wrongDateResult.reasons.includes("payload_date_mismatch"));
  const wrongFilenameResult = evaluateStrictClosingPayload(
    payloadFor("2026-08-18", "2026-08-17", "2026-08-14"),
    "2026-08-18",
    { filenameDate: "2026-08-17" },
  );
  assert.ok(wrongFilenameResult.reasons.includes("filename_date_mismatch"));
});

test("no formal archives returns a 200-compatible unavailable evidence object", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "index-opportunity-empty-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const evidence = buildIndexOpportunityEvidence({ historyDir: path.join(root, "missing") });
  assert.equal(evidence.dataQuality.status, "unavailable");
  assert.equal(evidence.dataQuality.availableDays, 0);
  assert.deepEqual(evidence.index.points, []);
  assert.deepEqual(evidence.turnover.points, []);
});

test("API helper is GET-only, returns the wrapped schema, and maps read failures to 500", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "index-opportunity-api-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const responses = [];
  const sendJson = (_response, status, payload) => responses.push({ status, payload });

  serveIndexOpportunityEvidence({ method: "POST" }, {}, {
    historyDir: path.join(root, "missing"),
    sendJson,
  });
  assert.equal(responses.at(-1).status, 405);

  serveIndexOpportunityEvidence({ method: "GET" }, {}, {
    historyDir: path.join(root, "missing"),
    sendJson,
  });
  assert.equal(responses.at(-1).status, 200);
  assert.equal(responses.at(-1).payload.ok, true);
  assert.equal(responses.at(-1).payload.evidence.dataQuality.status, "unavailable");

  const notDirectory = path.join(root, "not-a-directory");
  fs.writeFileSync(notDirectory, "x", "utf8");
  serveIndexOpportunityEvidence({ method: "GET" }, {}, { historyDir: notDirectory, sendJson });
  assert.equal(responses.at(-1).status, 500);
  assert.equal(responses.at(-1).payload.ok, false);
});

test("server exposes only a read-only evidence route", () => {
  const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  assert.match(source, /require\("\.\/index-opportunity-evidence"\)/);
  const routeStart = source.indexOf('if (pathname === "/api/index-opportunity/evidence")');
  assert.ok(routeStart >= 0, "evidence route must exist");
  const routeEnd = source.indexOf("\n  if (pathname === ", routeStart + 1);
  const route = source.slice(routeStart, routeEnd > routeStart ? routeEnd : routeStart + 1000);
  assert.match(route, /serveIndexOpportunityEvidence\(request, response/);
  assert.match(route, /path\.join\(runtimeRoot, "data", "history"\)/);
  assert.doesNotMatch(route, /writeFile|archive\(|sync|normalize|refresh/);
});
