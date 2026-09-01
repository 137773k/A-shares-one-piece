"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");

const {
  CloudHistorySyncError,
  syncCloudHistory,
  getCloudHistorySyncStatus,
  resetCloudHistorySyncStateForTests,
  httpsDownloadToFile,
  curlDownloadToFile,
} = require("./cloud-history-sync");

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function ymdCompact(date) {
  return date.replace(/-/g, "");
}

function fixturePayload(date, overrides = {}) {
  const payload = {
    fetchedAt: `${date}T07:10:00.000Z`, // 15:10 Asia/Shanghai
    updatedAt: `${date}T07:10:00.000Z`,
    stale: false,
    fetchError: null,
    archiveMeta: {
      mode: "auto",
      tradingDate: date,
      snapshotKind: "closing",
      archivedAt: `${date}T07:10:01.000Z`,
    },
    fetchStatus: {
      level: "ok",
      items: [
        {
          name: "东财热榜",
          ok: true,
          complete: true,
          tradingDate: date,
          marketDataTradingDate: date,
          snapshotKind: "closing",
          isFallback: false,
          error: null,
        },
        {
          name: "同花顺热榜",
          ok: true,
          complete: true,
          tradingDate: date,
          marketDataTradingDate: date,
          snapshotKind: "closing",
          isFallback: false,
          error: null,
        },
      ],
    },
    sources: {
      hotRanks: {
        eastmoney: {
          ok: true,
          complete: true,
          tradingDate: date,
          marketDataTradingDate: date,
          snapshotKind: "closing",
          isFallback: false,
        },
        ths: {
          ok: true,
          complete: true,
          tradingDate: date,
          marketDataTradingDate: date,
          snapshotKind: "closing",
          isFallback: false,
        },
      },
    },
    market: {
      limitStats: {
        dates: { today: ymdCompact(date), verified: true },
      },
    },
    decisionBasis: {
      tradingDate: date,
      snapshotKind: "closing",
      status: "current_closing",
    },
    payloadMarker: "cloud-original",
  };
  return {
    ...payload,
    ...overrides,
    archiveMeta: { ...payload.archiveMeta, ...(overrides.archiveMeta || {}) },
    fetchStatus: { ...payload.fetchStatus, ...(overrides.fetchStatus || {}) },
    market: overrides.market || payload.market,
    sources: overrides.sources === undefined ? payload.sources : overrides.sources,
  };
}

function rawFixture(date, overrides = {}, spacing = 2) {
  return Buffer.from(`${JSON.stringify(fixturePayload(date, overrides), null, spacing)}\n`, "utf8");
}

function manifestEntry(date, bytes, overrides = {}) {
  const base = {
    name: `${date}.json`,
    date,
    path: `/files/${date}.json`,
    size: bytes.length,
    sha256: sha256(bytes),
    mtime: `${date}T07:10:01.000Z`,
    snapshotKind: "closing",
    stale: false,
    fetchError: null,
    archiveMeta: { tradingDate: date, snapshotKind: "closing" },
    fetchedAt: `${date}T07:10:00.000Z`,
    fetchStatus: { level: "ok" },
    quality: {
      dateMatches: true,
      providerDateVerified: true,
      rankSourcesComplete: true,
      exactClosing: true,
    },
  };
  return { ...base, ...overrides, quality: { ...base.quality, ...(overrides.quality || {}) } };
}

async function makeRuntime() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "a-share-cloud-sync-test-"));
}

async function cleanupRuntime(runtimeDir) {
  const resolved = path.resolve(runtimeDir);
  const tempRoot = path.resolve(os.tmpdir());
  assert.ok(resolved.startsWith(`${tempRoot}${path.sep}`), "只允许清理测试临时目录");
  await fsp.rm(resolved, { recursive: true, force: true });
}

function manifestBytes(entries) {
  return Buffer.from(JSON.stringify({
    version: 1,
    generatedAt: "2026-08-20T08:00:00.000Z",
    files: entries,
  }), "utf8");
}

async function runHarness({
  runtimeDir,
  entries,
  remoteBytes,
  retries = 0,
  downloadBehavior,
  onIndexUpdate,
}) {
  let manifestCalls = 0;
  const downloadCalls = [];
  const requestBuffer = async (url, request) => {
    manifestCalls += 1;
    assert.strictEqual(url, "https://history.example.test/__history_sync/manifest");
    assert.strictEqual(request.token, "test-bearer-token");
    return manifestBytes(entries);
  };
  const downloadToFile = async (url, destination, request) => {
    downloadCalls.push({ url, destination, attempt: request.attempt, token: request.token });
    assert.strictEqual(request.token, "test-bearer-token");
    assert.match(new URL(url).pathname, /^\/__history_sync\/files\/\d{4}-\d{2}-\d{2}\.json$/);
    if (downloadBehavior) {
      return downloadBehavior(url, destination, request, downloadCalls.length);
    }
    const date = path.basename(new URL(url).pathname, ".json");
    await fsp.writeFile(destination, remoteBytes[date], { flag: "wx" });
    return undefined;
  };

  resetCloudHistorySyncStateForTests();
  const result = await syncCloudHistory({
    runtimeDir,
    skipConfigFile: true,
    config: {
      manifestUrl: "https://history.example.test/__history_sync/manifest",
      token: "test-bearer-token",
      timeoutMs: 1_000,
      retries,
      retryDelayMs: 0,
    },
    requestBuffer,
    downloadToFile,
    onIndexUpdate,
    sleep: async () => {},
  });
  return { result, manifestCalls, downloadCalls };
}

test("same: identical local date is not downloaded or rewritten", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const date = "2026-08-18";
    const bytes = rawFixture(date);
    const historyDir = path.join(runtimeDir, "data", "history");
    await fsp.mkdir(historyDir, { recursive: true });
    const localFile = path.join(historyDir, `${date}.json`);
    await fsp.writeFile(localFile, bytes);
    const before = await fsp.stat(localFile);

    const { result, downloadCalls } = await runHarness({
      runtimeDir,
      entries: [manifestEntry(date, bytes)],
      remoteBytes: { [date]: bytes },
    });

    assert.strictEqual(result.state, "success");
    assert.strictEqual(result.same.length, 1);
    assert.strictEqual(result.imported.length, 0);
    assert.strictEqual(downloadCalls.length, 0);
    assert.deepStrictEqual(await fsp.readFile(localFile), bytes);
    assert.strictEqual((await fsp.stat(localFile)).mtimeMs, before.mtimeMs);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("same invalid: an existing mismatched-date file is preserved byte-for-byte and planned for index exclusion", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const date = "2026-07-12";
    const bytes = rawFixture(date, {
      market: { limitStats: { dates: { today: "20260710" } } },
      archiveMeta: { tradingDate: null, snapshotKind: null },
    });
    const historyDir = path.join(runtimeDir, "data", "history");
    await fsp.mkdir(historyDir, { recursive: true });
    const localFile = path.join(historyDir, `${date}.json`);
    await fsp.writeFile(localFile, bytes);
    let plan;
    const { result, downloadCalls } = await runHarness({
      runtimeDir,
      entries: [manifestEntry(date, bytes)],
      remoteBytes: { [date]: bytes },
      onIndexUpdate: async (value) => { plan = value; },
    });

    assert.strictEqual(downloadCalls.length, 0);
    assert.strictEqual(result.localInvalid.length, 1);
    assert.strictEqual(result.localInvalid[0].qualityTier, "invalid");
    assert.deepStrictEqual(result.indexUpdate.excludeDates, [date]);
    assert.deepStrictEqual(plan.excludeDates, [date]);
    assert.deepStrictEqual(await fsp.readFile(localFile), bytes);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("missing: exact closing bytes are atomically imported and index callback is only planned/injected", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const date = "2026-08-19";
    const bytes = rawFixture(date, { payloadMarker: "preserve   whitespace" }, 4);
    let callbackPlan = null;
    const { result, downloadCalls } = await runHarness({
      runtimeDir,
      entries: [manifestEntry(date, bytes)],
      remoteBytes: { [date]: bytes },
      onIndexUpdate: async (plan) => {
        callbackPlan = plan;
        return { acknowledged: true };
      },
    });

    const target = path.join(runtimeDir, "data", "history", `${date}.json`);
    assert.strictEqual(result.state, "success");
    assert.strictEqual(result.imported.length, 1);
    assert.strictEqual(result.imported[0].qualityTier, "exact");
    assert.strictEqual(downloadCalls.length, 1);
    assert.deepStrictEqual(await fsp.readFile(target), bytes, "必须保留云端原始字节");
    assert.deepStrictEqual(result.indexUpdate.importedDates, [date]);
    assert.strictEqual(result.indexUpdate.callbackInvoked, true);
    assert.deepStrictEqual(callbackPlan.excludeDates, []);
    assert.strictEqual(fs.existsSync(path.join(runtimeDir, "data", "history", "index.json")), false);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("conflict: a different hash for the same date never overwrites local history", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const date = "2026-08-20";
    const localBytes = rawFixture(date, { payloadMarker: "desktop-authoritative" });
    const cloudBytes = rawFixture(date, { payloadMarker: "cloud-revision" }, 0);
    const historyDir = path.join(runtimeDir, "data", "history");
    await fsp.mkdir(historyDir, { recursive: true });
    const localFile = path.join(historyDir, `${date}.json`);
    await fsp.writeFile(localFile, localBytes);

    const { result } = await runHarness({
      runtimeDir,
      entries: [manifestEntry(date, cloudBytes)],
      remoteBytes: { [date]: cloudBytes },
    });

    const revision = path.join(
      runtimeDir,
      "data",
      "history-revisions",
      "cloud",
      `${date}--${sha256(cloudBytes)}.json`,
    );
    assert.strictEqual(result.conflicts.length, 1);
    assert.deepStrictEqual(await fsp.readFile(localFile), localBytes);
    assert.deepStrictEqual(await fsp.readFile(revision), cloudBytes);
    assert.strictEqual(result.indexUpdate.required, false, "冲突修订不能进入正式索引");
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("corrupt: hash mismatch and valid-hash invalid JSON are rejected with no installed snapshot", async () => {
  for (const mode of ["hash", "json"]) {
    const runtimeDir = await makeRuntime();
    try {
      const date = mode === "hash" ? "2026-08-14" : "2026-08-15";
      const declaredBytes = mode === "hash" ? rawFixture(date) : Buffer.from("{not-json}\n");
      const downloadedBytes = mode === "hash" ? Buffer.from("corrupt transport bytes") : declaredBytes;
      const entry = manifestEntry(date, declaredBytes);
      const { result } = await runHarness({
        runtimeDir,
        entries: [entry],
        remoteBytes: { [date]: downloadedBytes },
      });

      assert.strictEqual(result.failed.length, 1);
      assert.strictEqual(result.failed[0].code, mode === "hash" ? "SIZE_MISMATCH" : "JSON_INVALID");
      assert.strictEqual(fs.existsSync(path.join(runtimeDir, "data", "history", `${date}.json`)), false);
      const revisionDir = path.join(runtimeDir, "data", "history-revisions", "cloud");
      assert.strictEqual(fs.existsSync(revisionDir), false);
      const tempDir = path.join(runtimeDir, "data", ".cloud-sync-tmp");
      const leftovers = fs.existsSync(tempDir) ? await fsp.readdir(tempDir) : [];
      assert.deepStrictEqual(leftovers, []);
    } finally {
      await cleanupRuntime(runtimeDir);
    }
  }
});

test("stale: integrity-valid stale bytes are quarantined and never promoted to formal history", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const date = "2026-08-13";
    const bytes = rawFixture(date, { stale: true });
    // Deliberately make the manifest claim fresh.  Desktop validation must catch
    // the stale flag in the original JSON independently.
    const { result } = await runHarness({
      runtimeDir,
      entries: [manifestEntry(date, bytes)],
      remoteBytes: { [date]: bytes },
    });

    assert.strictEqual(result.imported.length, 0);
    assert.strictEqual(result.quarantined.length, 1);
    assert.strictEqual(result.quarantined[0].qualityTier, "invalid");
    assert.ok(result.quarantined[0].qualityReasons.includes("snapshot_stale"));
    assert.strictEqual(fs.existsSync(path.join(runtimeDir, "data", "history", `${date}.json`)), false);
    assert.deepStrictEqual(await fsp.readFile(result.quarantined[0].path), bytes);
    assert.strictEqual(result.state, "success", "质量隔离不是同步执行失败");
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.failed.length, 0);
    assert.strictEqual(result.manifest.structurallyAcceptedEntries, 1);
    assert.strictEqual(result.manifest.formalEligibleEntries, 0);
    assert.strictEqual(result.manifest.ineligibleEntries, 1);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("legacy closing: absent exact/rank manifest metadata is promoted only after raw JSON revalidation", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const date = "2026-08-10";
    const bytes = rawFixture(date, {
      sources: null,
      fetchStatus: {
        level: "ok",
        items: [
          { name: "东财热榜", ok: true },
          { name: "同花顺热榜", ok: true },
        ],
      },
    });
    const entry = manifestEntry(date, bytes);
    delete entry.snapshotKind;
    delete entry.stale;
    delete entry.fetchError;
    delete entry.archiveMeta;
    delete entry.fetchedAt;
    delete entry.fetchStatus;
    entry.quality = {};

    const { result } = await runHarness({
      runtimeDir,
      entries: [entry],
      remoteBytes: { [date]: bytes },
    });
    assert.strictEqual(result.imported.length, 1);
    assert.strictEqual(result.imported[0].qualityTier, "legacy_closing_ok");
    assert.strictEqual(result.quarantined.length, 0);
    assert.deepStrictEqual(
      await fsp.readFile(path.join(runtimeDir, "data", "history", `${date}.json`)),
      bytes,
    );
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("partial: closing partial data is retained as a cloud revision but never enters formal history", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const date = "2026-08-09";
    const bytes = rawFixture(date, { fetchStatus: { level: "partial" } });
    const entry = manifestEntry(date, bytes, {
      fetchStatus: { level: "partial" },
      quality: { exactClosing: false },
    });
    const { result } = await runHarness({
      runtimeDir,
      entries: [entry],
      remoteBytes: { [date]: bytes },
    });

    assert.strictEqual(result.imported.length, 0);
    assert.strictEqual(result.quarantined.length, 1);
    assert.strictEqual(result.quarantined[0].qualityTier, "closing_partial");
    assert.ok(result.quarantined[0].qualityReasons.some((reason) => (
      reason.startsWith("snapshot_fetch_evidence_unusable:")
    )));
    assert.strictEqual(fs.existsSync(path.join(runtimeDir, "data", "history", `${date}.json`)), false);
    assert.deepStrictEqual(await fsp.readFile(result.quarantined[0].path), bytes);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("same-day cache degradation remains formal closing evidence when exact-date coverage is complete", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const date = "2026-08-10";
    const fetchStatus = {
      level: "partial",
      operationalLevel: "degraded",
      evidenceStatus: "complete",
      mode: "degraded_same_day_cache",
      items: [{
        name: "K线/均线",
        ok: true,
        degraded: true,
        statusKey: "degraded_same_day_cache",
        eligibleForClosingDecision: true,
        expectedCompletedTradingDate: date,
        sameDayCacheCount: 100,
        unavailableCount: 0,
        cacheTradingDates: { [date]: 100 },
      }],
    };
    const bytes = rawFixture(date, { fetchStatus });
    const entry = manifestEntry(date, bytes, {
      fetchStatus,
      quality: {
        exactClosing: true,
        evidenceStatus: "complete",
        klineStatusKey: "degraded_same_day_cache",
      },
    });
    const { result } = await runHarness({
      runtimeDir,
      entries: [entry],
      remoteBytes: { [date]: bytes },
    });
    assert.strictEqual(result.imported.length, 1);
    assert.strictEqual(result.quarantined.length, 0);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("quality counts: structural acceptance is separated from formal, exact, legacy, and isolated totals", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const exactDate = "2026-08-05";
    const legacyDate = "2026-08-06";
    const partialDate = "2026-08-07";
    const exactBytes = rawFixture(exactDate);
    const legacyBytes = rawFixture(legacyDate, {
      sources: null,
      fetchStatus: {
        level: "ok",
        items: [
          { name: "东财热榜", ok: true },
          { name: "同花顺热榜", ok: true },
        ],
      },
    });
    const partialBytes = rawFixture(partialDate, { fetchStatus: { level: "partial" } });
    const legacyEntry = manifestEntry(legacyDate, legacyBytes, {
      qualityTier: "legacy",
      formalEligible: true,
      legacyClosingEligible: true,
      exactClosing: false,
      quality: {
        exactClosing: false,
        formalEligible: true,
        legacyClosingEligible: true,
        qualityTier: "legacy",
        rankMetadataPresent: false,
        rankSourcesComplete: null,
      },
    });
    const partialEntry = manifestEntry(partialDate, partialBytes, {
      qualityTier: "ineligible",
      formalEligible: false,
      exactClosing: false,
      fetchStatus: { level: "partial" },
      quality: {
        exactClosing: false,
        formalEligible: false,
        qualityTier: "ineligible",
      },
    });
    const { result } = await runHarness({
      runtimeDir,
      entries: [manifestEntry(exactDate, exactBytes), legacyEntry, partialEntry],
      remoteBytes: {
        [exactDate]: exactBytes,
        [legacyDate]: legacyBytes,
        [partialDate]: partialBytes,
      },
    });

    assert.strictEqual(result.manifest.eligible, 3, "旧字段继续表示结构通过数量");
    assert.strictEqual(result.manifest.structurallyAcceptedEntries, 3);
    assert.strictEqual(result.manifest.formalEligibleEntries, 2);
    assert.strictEqual(result.manifest.exactEntries, 1);
    assert.strictEqual(result.manifest.legacyEligibleEntries, 1);
    assert.strictEqual(result.manifest.ineligibleEntries, 1);
    assert.strictEqual(result.failed.length, 0);
    assert.strictEqual(result.state, "success");
    assert.strictEqual(result.ok, true);
    const status = getCloudHistorySyncStatus();
    assert.strictEqual(status.summary.eligibleEntries, 3);
    assert.strictEqual(status.summary.structurallyAcceptedEntries, 3);
    assert.strictEqual(status.summary.formalEligibleEntries, 2);
    assert.strictEqual(status.summary.exactEntries, 1);
    assert.strictEqual(status.summary.legacyEligibleEntries, 1);
    assert.strictEqual(status.summary.ineligibleEntries, 1);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("modern rank metadata: a missing provider cannot fall back to legacy eligibility", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const date = "2026-08-08";
    const payload = fixturePayload(date);
    delete payload.sources.hotRanks.ths;
    const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`);
    const entry = manifestEntry(date, bytes, {
      quality: {
        exactClosing: false,
        formalEligible: false,
        rankMetadataPresent: true,
        rankSourcesComplete: null,
      },
    });
    const { result } = await runHarness({
      runtimeDir,
      entries: [entry],
      remoteBytes: { [date]: bytes },
    });

    assert.strictEqual(result.imported.length, 0);
    assert.strictEqual(result.quarantined.length, 1);
    assert.strictEqual(result.quarantined[0].qualityTier, "closing_partial");
    assert.ok(result.quarantined[0].qualityReasons.includes("snapshot_modern_rank_missing:ths"));
    assert.strictEqual(fs.existsSync(path.join(runtimeDir, "data", "history", `${date}.json`)), false);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("modern rank metadata: omitted ok is accepted when strict closing evidence is complete", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const date = "2026-08-20";
    const payload = fixturePayload(date);
    delete payload.sources.hotRanks.eastmoney.ok;
    delete payload.sources.hotRanks.ths.ok;
    const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`);
    const { result } = await runHarness({
      runtimeDir,
      entries: [manifestEntry(date, bytes)],
      remoteBytes: { [date]: bytes },
    });

    assert.strictEqual(result.imported.length, 1);
    assert.strictEqual(result.imported[0].qualityTier, "exact");
    assert.strictEqual(result.quarantined.length, 0);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("single-flight: concurrent callers share one manifest request and one download", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const date = "2026-08-11";
    const bytes = rawFixture(date);
    const entry = manifestEntry(date, bytes);
    let releaseManifest;
    const gate = new Promise((resolve) => { releaseManifest = resolve; });
    let manifestCalls = 0;
    let downloadCalls = 0;
    resetCloudHistorySyncStateForTests();
    const options = {
      runtimeDir,
      skipConfigFile: true,
      config: {
        manifestUrl: "https://history.example.test/manifest",
        token: "test-bearer-token",
        timeoutMs: 1_000,
        retries: 0,
        retryDelayMs: 0,
      },
      requestBuffer: async () => {
        manifestCalls += 1;
        await gate;
        return manifestBytes([entry]);
      },
      downloadToFile: async (_url, destination) => {
        downloadCalls += 1;
        await fsp.writeFile(destination, bytes, { flag: "wx" });
      },
    };
    const first = syncCloudHistory(options);
    const second = syncCloudHistory(options);
    assert.strictEqual(first, second, "并发调用必须返回同一个进行中 Promise");
    assert.strictEqual(getCloudHistorySyncStatus().running, true);
    releaseManifest();
    const [a, b] = await Promise.all([first, second]);
    assert.strictEqual(a, b);
    assert.strictEqual(manifestCalls, 1);
    assert.strictEqual(downloadCalls, 1);
    assert.strictEqual(a.imported.length, 1);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("network: retry budget is honored, status becomes failed, and no partial file remains", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const date = "2026-08-12";
    const bytes = rawFixture(date);
    let attempts = 0;
    const { result, downloadCalls } = await runHarness({
      runtimeDir,
      entries: [manifestEntry(date, bytes)],
      remoteBytes: { [date]: bytes },
      retries: 2,
      downloadBehavior: async () => {
        attempts += 1;
        throw new CloudHistorySyncError("NETWORK_TEST", "simulated network loss", { retryable: true });
      },
    });

    assert.strictEqual(attempts, 3);
    assert.strictEqual(downloadCalls.length, 3);
    assert.strictEqual(result.failed.length, 1);
    assert.strictEqual(result.failed[0].code, "NETWORK_TEST");
    assert.strictEqual(result.state, "failed");
    assert.strictEqual(getCloudHistorySyncStatus().state, "failed");
    assert.strictEqual(getCloudHistorySyncStatus().running, false);
    assert.strictEqual(fs.existsSync(path.join(runtimeDir, "data", "history", `${date}.json`)), false);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("production downloader: fetch body is streamed byte-for-byte with hash and size", async () => {
  const runtimeDir = await makeRuntime();
  const originalFetch = global.fetch;
  try {
    const bytes = Buffer.from(JSON.stringify({ marker: "stream-integrity", rows: [1, 2, 3] }), "utf8");
    global.fetch = async (url, options) => {
      assert.strictEqual(url.toString(), "https://history.example.test/__history_sync/files/2026-08-20.json");
      assert.strictEqual(options.headers.Authorization, "Bearer test-bearer-token");
      return new Response(bytes, {
        status: 200,
        headers: { "Content-Length": String(bytes.length) },
      });
    };
    const destination = path.join(runtimeDir, "download.json");
    const result = await httpsDownloadToFile(
      "https://history.example.test/__history_sync/files/2026-08-20.json",
      destination,
      { token: "test-bearer-token", timeoutMs: 1_000, maxBytes: 1024 },
    );
    assert.deepStrictEqual(await fsp.readFile(destination), bytes);
    assert.strictEqual(result.size, bytes.length);
    assert.strictEqual(result.sha256, sha256(bytes));
  } finally {
    global.fetch = originalFetch;
    await cleanupRuntime(runtimeDir);
  }
});

test("Windows curl transport: bearer token is sent on stdin and never exposed in process args", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const destination = path.join(runtimeDir, "curl-download.json");
    const token = "super-secret-test-token";
    let receivedConfig = "";
    const spawnImpl = (_command, args) => {
      assert.equal(JSON.stringify(args).includes(token), false);
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};
      child.stdin.on("data", (chunk) => { receivedConfig += chunk.toString("utf8"); });
      process.nextTick(async () => {
        await fsp.writeFile(destination, "curl-bytes", "utf8");
        child.stdout.end("200");
        child.stderr.end();
        child.emit("close", 0);
      });
      return child;
    };
    const result = await curlDownloadToFile(
      "https://history.example.test/__history_sync/files/2026-08-20.json",
      destination,
      {
        token,
        timeoutMs: 1_000,
        maxBytes: 1_024,
        spawnImpl,
        curlExecutable: "fake-curl",
      },
    );
    assert.equal(result.transport, "curl");
    assert.equal(receivedConfig.includes(`Authorization: Bearer ${token}`), true);
    assert.equal(await fsp.readFile(destination, "utf8"), "curl-bytes");
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

async function main() {
  let passed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      passed += 1;
      process.stdout.write(`✓ ${item.name}\n`);
    } catch (error) {
      process.stderr.write(`✗ ${item.name}\n${error.stack || error}\n`);
      process.exitCode = 1;
      break;
    }
  }
  process.stdout.write(`${passed}/${tests.length} cloud history sync tests passed\n`);
}

if (require.main === module) main();

module.exports = { fixturePayload, rawFixture, manifestEntry };
