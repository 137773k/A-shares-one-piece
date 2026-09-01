"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const test = require("node:test");
const {
  extractCurrentQualityMetadata,
  getCloudCurrentSyncStatus,
  loadVerifiedCloudCurrentSnapshot,
  loadCloudCurrentSyncConfig,
  resetCloudCurrentSyncStateForTests,
  syncCloudCurrent,
} = require("./cloud-current-sync");

const DATE = "2026-08-20";
const FETCHED_AT = "2026-08-20T07:30:00.000Z";
const GENERATION_ID = `${DATE}:${FETCHED_AT}`;
const COMPONENT_NAMES = [
  "themeLibrary",
  "premarketModels",
  "emotionCycle",
  "marketPhaseDetail",
  "emotionCoreEvidence",
  "tomorrowDecision",
  "recentIndexEmotionRelation",
  "postCloseOpportunity",
];

function component(extra = {}) {
  return {
    tradingDate: DATE,
    generatedAt: FETCHED_AT,
    generationId: GENERATION_ID,
    ...extra,
  };
}

function canonicalPayload() {
  return {
    fetchedAt: FETCHED_AT,
    updatedAt: FETCHED_AT,
    stale: false,
    archiveMeta: { tradingDate: DATE, snapshotKind: "closing" },
    market: {
      snapshot: { tradingDate: DATE },
      limitStats: { dates: { today: "20260820", verified: true } },
    },
    decisionBasis: {
      tradingDate: DATE,
      snapshotKind: "closing",
      status: "current_closing",
    },
    fetchStatus: {
      level: "ok",
      items: [
        { name: "eastmoney", ok: true },
        { name: "ths", ok: true },
      ],
    },
    sources: {
      hotRanks: {
        eastmoney: {
          complete: true,
          tradingDate: DATE,
          marketDataTradingDate: DATE,
          snapshotKind: "closing",
          isFallback: false,
        },
        ths: {
          complete: true,
          tradingDate: DATE,
          marketDataTradingDate: DATE,
          snapshotKind: "closing",
          isFallback: false,
        },
      },
    },
    themeLibrary: component({
      snapshotKind: "closing",
      schemaVersion: "theme-library-v1",
      classifierVersion: "theme-classifier-v1",
    }),
    premarketModels: component({ version: "premarket-v1" }),
    emotionCycle: component({ version: "emotion-cycle-v1" }),
    marketPhaseDetail: component({ version: "market-phase-v1" }),
    emotionCoreEvidence: component({
      contractVersion: "emotion-contract-v1",
      classifierVersion: "emotion-classifier-v1",
    }),
    tomorrowDecision: component({
      version: "decision-v1",
      forecast: { version: "forecast-v1", method: "rules", calibrated: false },
    }),
    recentIndexEmotionRelation: component({ version: "relation-v1" }),
    postCloseOpportunity: component({ version: "opportunity-v1" }),
  };
}

function rawPayload(payload = canonicalPayload()) {
  return Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function currentManifest(bytes, payload = JSON.parse(bytes.toString("utf8")), overrides = {}) {
  const quality = extractCurrentQualityMetadata(payload);
  return {
    version: 1,
    generatedAt: "2026-08-20T08:00:00.000Z",
    current: {
      path: "/current-file",
      size: bytes.length,
      sha256: sha256(bytes),
      mtime: "2026-08-20T07:30:00.000Z",
      tradingDate: quality.tradingDate,
      snapshotKind: quality.snapshotKind,
      fetchedAt: quality.fetchedAt,
      updatedAt: quality.updatedAt,
      generationId: quality.generation.expectedGenerationId,
      canonicalEligible: quality.canonicalEligible,
      modelVersions: quality.modelVersions,
      componentVersions: quality.componentVersions,
      quality,
      ...overrides,
    },
  };
}

async function makeRuntime() {
  const runtimeDir = await fsp.mkdtemp(path.join(os.tmpdir(), "cloud-current-sync-"));
  await fsp.mkdir(path.join(runtimeDir, "data", "history"), { recursive: true });
  await fsp.writeFile(path.join(runtimeDir, ".hot-stocks-cache.json"), "desktop-cache-sentinel\n");
  await fsp.writeFile(path.join(runtimeDir, "data", "history", "sentinel.json"), "history-sentinel\n");
  return runtimeDir;
}

async function cleanupRuntime(runtimeDir) {
  resetCloudCurrentSyncStateForTests();
  await fsp.rm(runtimeDir, { recursive: true, force: true });
}

function optionsFor(runtimeDir, manifest, downloadBytes, hooks = {}) {
  return {
    runtimeDir,
    skipConfigFile: true,
    config: {
      currentManifestUrl: "https://sync.example.test/__history_sync/current-manifest",
      token: "test-current-bearer-token",
      timeoutMs: 1_000,
      retries: 0,
      retryDelayMs: 0,
      maxFileBytes: 4 * 1024 * 1024,
    },
    requestBuffer: async (...args) => {
      if (hooks.requestBuffer) return hooks.requestBuffer(...args);
      hooks.manifestCalls = (hooks.manifestCalls || 0) + 1;
      return Buffer.from(JSON.stringify(manifest));
    },
    downloadToFile: async (url, destination, requestOptions) => {
      hooks.downloadCalls = (hooks.downloadCalls || 0) + 1;
      if (hooks.downloadToFile) {
        return hooks.downloadToFile(url, destination, requestOptions);
      }
      await fsp.writeFile(destination, downloadBytes, { flag: "wx" });
    },
  };
}

async function assertSentinelsUntouched(runtimeDir) {
  assert.strictEqual(
    await fsp.readFile(path.join(runtimeDir, ".hot-stocks-cache.json"), "utf8"),
    "desktop-cache-sentinel\n",
  );
  assert.strictEqual(
    await fsp.readFile(path.join(runtimeDir, "data", "history", "sentinel.json"), "utf8"),
    "history-sentinel\n",
  );
}

test("同日完整K线缓存只降低源健康，不降低云端收盘证据资格", () => {
  const payload = canonicalPayload();
  payload.fetchStatus = {
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
      expectedCompletedTradingDate: DATE,
      sameDayCacheCount: 100,
      unavailableCount: 0,
      cacheTradingDates: { [DATE]: 100 },
    }],
  };
  const quality = extractCurrentQualityMetadata(payload);
  assert.strictEqual(quality.canonicalEligible, true);
  assert.deepStrictEqual(quality.reasons, []);
});

test("config derives the current sidecar URL without exposing or rewriting config", () => {
  const config = loadCloudCurrentSyncConfig({
    runtimeDir: os.tmpdir(),
    skipConfigFile: true,
    config: {
      manifestUrl: "https://sync.example.test/__history_sync/manifest",
      token: "test-current-bearer-token",
    },
  });
  assert.strictEqual(
    config.manifestUrl,
    "https://sync.example.test/__history_sync/current-manifest",
  );
});

test("same: canonical bytes are installed once and the independent pointer stays stable", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const bytes = rawPayload();
    const manifest = currentManifest(bytes);
    const hooks = {};
    const options = optionsFor(runtimeDir, manifest, bytes, hooks);
    const first = await syncCloudCurrent(options);
    assert.strictEqual(first.kind, "imported");
    assert.strictEqual(first.pointerUpdated, true);
    assert.strictEqual(hooks.downloadCalls, 1);
    const target = path.join(runtimeDir, "data", "cloud-current", DATE, `${sha256(bytes)}.json`);
    const pointer = path.join(runtimeDir, "data", "cloud-current", "pointer.json");
    const targetBefore = await fsp.stat(target);
    const pointerBefore = await fsp.stat(pointer);
    assert.deepStrictEqual(await fsp.readFile(target), bytes, "必须保留原始字节");

    const second = await syncCloudCurrent(options);
    assert.strictEqual(second.kind, "same");
    assert.strictEqual(second.pointerUpdated, false);
    assert.strictEqual(hooks.downloadCalls, 1, "相同 SHA 不应再下载");
    assert.strictEqual((await fsp.stat(target)).mtimeMs, targetBefore.mtimeMs);
    assert.strictEqual((await fsp.stat(pointer)).mtimeMs, pointerBefore.mtimeMs);
    const storedPointer = JSON.parse(await fsp.readFile(pointer, "utf8"));
    assert.strictEqual(storedPointer.relativePath, `${DATE}/${sha256(bytes)}.json`);
    assert.strictEqual(storedPointer.generationId, GENERATION_ID);
    await assertSentinelsUntouched(runtimeDir);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("newer generation atomically advances only the cloud-current pointer", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const firstBytes = rawPayload();
    await syncCloudCurrent(optionsFor(
      runtimeDir,
      currentManifest(firstBytes),
      firstBytes,
      {},
    ));

    const laterFetchedAt = "2026-08-20T08:30:00.000Z";
    const laterGenerationId = `${DATE}:${laterFetchedAt}`;
    const later = canonicalPayload();
    later.fetchedAt = laterFetchedAt;
    later.updatedAt = laterFetchedAt;
    for (const name of COMPONENT_NAMES) {
      later[name].generatedAt = laterFetchedAt;
      later[name].generationId = laterGenerationId;
    }
    const laterBytes = rawPayload(later);
    const result = await syncCloudCurrent(optionsFor(
      runtimeDir,
      currentManifest(laterBytes, later),
      laterBytes,
      {},
    ));
    assert.strictEqual(result.kind, "imported");
    assert.strictEqual(result.generationId, laterGenerationId);
    const root = path.join(runtimeDir, "data", "cloud-current");
    const pointer = JSON.parse(await fsp.readFile(path.join(root, "pointer.json"), "utf8"));
    assert.strictEqual(pointer.generationId, laterGenerationId);
    assert.strictEqual(pointer.sha256, sha256(laterBytes));
    assert.deepStrictEqual(
      await fsp.readFile(path.join(root, DATE, `${sha256(firstBytes)}.json`)),
      firstBytes,
      "新代次不得覆盖旧代次原始字节",
    );
    await assertSentinelsUntouched(runtimeDir);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("corrupt: transport corruption never creates a snapshot or pointer", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const declared = rawPayload();
    const corrupt = Buffer.from("corrupt-partial-transport");
    const options = optionsFor(runtimeDir, currentManifest(declared), corrupt, {});
    await assert.rejects(syncCloudCurrent(options), (error) => {
      assert.strictEqual(error.code, "SIZE_MISMATCH");
      return true;
    });
    const root = path.join(runtimeDir, "data", "cloud-current");
    assert.strictEqual(fs.existsSync(path.join(root, "pointer.json")), false);
    assert.strictEqual(fs.existsSync(path.join(root, "manifest.json")), false);
    assert.strictEqual(
      fs.existsSync(path.join(root, DATE, `${sha256(declared)}.json`)),
      false,
    );
    const leftovers = fs.existsSync(path.join(root, ".tmp"))
      ? await fsp.readdir(path.join(root, ".tmp"))
      : [];
    assert.deepStrictEqual(leftovers, []);
    await assertSentinelsUntouched(runtimeDir);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("partial: a manifest that fails the canonical quality gate is rejected before download", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const payload = canonicalPayload();
    payload.sources.hotRanks.ths.complete = false;
    const bytes = rawPayload(payload);
    const manifest = currentManifest(bytes, payload);
    const hooks = {};
    await assert.rejects(
      syncCloudCurrent(optionsFor(runtimeDir, manifest, bytes, hooks)),
      (error) => error.code === "CURRENT_NOT_CANONICAL",
    );
    assert.strictEqual(hooks.downloadCalls || 0, 0);
    assert.strictEqual(fs.existsSync(path.join(runtimeDir, "data", "cloud-current")), false);
    await assertSentinelsUntouched(runtimeDir);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("generation mismatch: locally revalidated bytes cannot inherit a false canonical manifest", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const canonical = canonicalPayload();
    const canonicalBytes = rawPayload(canonical);
    const mismatched = canonicalPayload();
    mismatched.emotionCycle.generationId = `${GENERATION_ID}-other`;
    const mismatchedBytes = rawPayload(mismatched);
    const forgedManifest = currentManifest(canonicalBytes, canonical, {
      size: mismatchedBytes.length,
      sha256: sha256(mismatchedBytes),
    });
    const hooks = {};
    await assert.rejects(
      syncCloudCurrent(optionsFor(runtimeDir, forgedManifest, mismatchedBytes, hooks)),
      (error) => {
        assert.strictEqual(error.code, "GENERATION_MISMATCH");
        assert.ok(error.details.reasons.includes("emotionCycle_generation_mismatch"));
        return true;
      },
    );
    assert.strictEqual(hooks.downloadCalls, 1);
    assert.strictEqual(
      fs.existsSync(path.join(runtimeDir, "data", "cloud-current", "pointer.json")),
      false,
    );
    await assertSentinelsUntouched(runtimeDir);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("singleflight: concurrent callers share one manifest request and one byte download", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const bytes = rawPayload();
    const manifest = currentManifest(bytes);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const hooks = {
      manifestCalls: 0,
      downloadCalls: 0,
      requestBuffer: async () => {
        hooks.manifestCalls += 1;
        await gate;
        return Buffer.from(JSON.stringify(manifest));
      },
    };
    const options = optionsFor(runtimeDir, manifest, bytes, hooks);
    const first = syncCloudCurrent(options);
    const second = syncCloudCurrent(options);
    assert.strictEqual(first, second, "并发调用必须返回同一 Promise");
    assert.strictEqual(getCloudCurrentSyncStatus().running, true);
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.strictEqual(a, b);
    assert.strictEqual(hooks.manifestCalls, 1);
    assert.strictEqual(hooks.downloadCalls, 1);
    assert.strictEqual(a.kind, "imported");
    await assertSentinelsUntouched(runtimeDir);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("local collision: an unexpected target is preserved and never repointed", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const bytes = rawPayload();
    const targetDir = path.join(runtimeDir, "data", "cloud-current", DATE);
    const target = path.join(targetDir, `${sha256(bytes)}.json`);
    await fsp.mkdir(targetDir, { recursive: true });
    await fsp.writeFile(target, "do-not-overwrite\n");
    await assert.rejects(
      syncCloudCurrent(optionsFor(runtimeDir, currentManifest(bytes), bytes, {})),
      (error) => error.code === "LOCAL_COLLISION",
    );
    assert.strictEqual(await fsp.readFile(target, "utf8"), "do-not-overwrite\n");
    assert.strictEqual(
      fs.existsSync(path.join(runtimeDir, "data", "cloud-current", "pointer.json")),
      false,
    );
    await assertSentinelsUntouched(runtimeDir);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("fixture covers every required generation component", () => {
  const payload = canonicalPayload();
  assert.deepStrictEqual(
    COMPONENT_NAMES.filter((name) => !payload[name] || payload[name].generationId !== GENERATION_ID),
    [],
  );
});

test("verified reader returns the exact canonical bytes selected by the atomic pointer", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const bytes = rawPayload();
    const manifest = currentManifest(bytes);
    await syncCloudCurrent(optionsFor(runtimeDir, manifest, bytes));
    const verified = await loadVerifiedCloudCurrentSnapshot({ runtimeDir });
    assert.deepStrictEqual(verified.bytes, bytes);
    assert.strictEqual(verified.pointer.generationId, GENERATION_ID);
    assert.strictEqual(verified.quality.canonicalEligible, true);
    assert.strictEqual(verified.payload.tomorrowDecision.generationId, GENERATION_ID);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});

test("verified reader rejects a tampered canonical file without changing user data", async () => {
  const runtimeDir = await makeRuntime();
  try {
    const bytes = rawPayload();
    const manifest = currentManifest(bytes);
    const result = await syncCloudCurrent(optionsFor(runtimeDir, manifest, bytes));
    await fsp.writeFile(result.path, Buffer.concat([bytes, Buffer.from("tamper")]));
    await assert.rejects(
      () => loadVerifiedCloudCurrentSnapshot({ runtimeDir }),
      (error) => error && error.code === "LOCAL_INTEGRITY_MISMATCH",
    );
    await assertSentinelsUntouched(runtimeDir);
  } finally {
    await cleanupRuntime(runtimeDir);
  }
});
