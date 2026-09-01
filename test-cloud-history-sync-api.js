"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const net = require("net");
const vm = require("vm");
const { spawn } = require("child_process");

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function requestJson(port, method, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      method,
      path: pathname,
      timeout: 2_000,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          resolve({ statusCode: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("request timeout")));
    request.on("error", reject);
    request.end();
  });
}

async function waitForServer(port, child) {
  let lastError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${child.exitCode}`);
    try {
      return await requestJson(port, "GET", "/api/cloud-history-sync/status");
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError || new Error("server did not start");
}

test("cloud history sync API is local-only, method-gated, and safe when unconfigured", async () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-sync-api-"));
  const port = await reservePort();
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    cwd: __dirname,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      A_SHARE_RUNTIME_DIR: runtimeDir,
      A_SHARE_CLOUD_SYNC_ENABLED: "",
      A_SHARE_CLOUD_SYNC_MANIFEST_URL: "",
      A_SHARE_CLOUD_SYNC_TOKEN: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => output.push(chunk));
  try {
    const status = await waitForServer(port, child);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.ok, true);
    assert.equal(status.body.sync.status, "disabled");
    assert.equal(status.body.sync.configured, false);
    assert.equal(JSON.stringify(status.body).includes("token"), false);

    const wrongMethod = await requestJson(port, "GET", "/api/cloud-history-sync/run");
    assert.equal(wrongMethod.statusCode, 405);

    const run = await requestJson(port, "POST", "/api/cloud-history-sync/run");
    assert.equal(run.statusCode, 503);
    assert.equal(run.body.ok, false);
    assert.equal(run.body.sync.status, "disabled");

    const currentStatus = await requestJson(port, "GET", "/api/cloud-current-sync/status");
    assert.equal(currentStatus.statusCode, 200);
    assert.equal(currentStatus.body.sync.status, "disabled");
    assert.equal(currentStatus.body.sync.snapshotAvailable, false);
    assert.equal(JSON.stringify(currentStatus.body).includes("test-current-bearer-token"), false);

    const currentWrongMethod = await requestJson(port, "GET", "/api/cloud-current-sync/run");
    assert.equal(currentWrongMethod.statusCode, 405);
    const currentRun = await requestJson(port, "POST", "/api/cloud-current-sync/run");
    assert.equal(currentRun.statusCode, 503);
    assert.equal(currentRun.body.sync.status, "disabled");
    const currentPayload = await requestJson(port, "GET", "/api/cloud-current-sync/payload");
    assert.equal(currentPayload.statusCode, 404);
    assert.equal(currentPayload.body.code, "CURRENT_POINTER_MISSING");
  } catch (error) {
    error.message += `\nserver output:\n${Buffer.concat(output).toString("utf8")}`;
    throw error;
  } finally {
    child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(resolve, 2_000).unref();
    });
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("cloud history status UI distinguishes checked, usable, isolated, and actual failures", () => {
  const source = fs.readFileSync(path.join(__dirname, "script.js"), "utf8");
  const start = source.indexOf("function cloudHistorySyncCounts(sync)");
  const end = source.indexOf("async function readCloudHistorySyncStatus()", start);
  assert.ok(start >= 0 && end > start, "cloud sync UI helpers must remain discoverable");
  const badge = { textContent: "", title: "", dataset: {} };
  const button = { disabled: false, textContent: "" };
  const sandbox = {
    cloudHistorySyncStatus: badge,
    cloudHistorySyncBtn: button,
  };
  vm.runInNewContext(
    `${source.slice(start, end)}\nthis.cloudSyncUi = { cloudHistorySyncCounts, renderCloudHistorySyncStatus };`,
    sandbox,
  );

  sandbox.cloudSyncUi.renderCloudHistorySyncStatus({
    sync: {
      status: "succeeded",
      lastResult: {
        structurallyAcceptedEntries: 28,
        formalEligibleEntries: 22,
        exactEntries: 5,
        legacyEligibleEntries: 17,
        ineligibleEntries: 6,
        failedCount: 0,
      },
    },
  });
  assert.equal(badge.textContent, "✓ 云端28份已核对 · 可用22份 · 隔离6份");
  assert.equal(badge.dataset.syncStatus, "succeeded");
  assert.match(badge.title, /6份低质量快照/);

  sandbox.cloudSyncUi.renderCloudHistorySyncStatus({
    status: "partial",
    summary: {
      structurallyAcceptedEntries: 28,
      formalEligibleEntries: 22,
      ineligibleEntries: 6,
      failed: 0,
    },
  });
  assert.equal(badge.dataset.syncStatus, "succeeded", "只有隔离、没有failed时不应报失败");

  sandbox.cloudSyncUi.renderCloudHistorySyncStatus({
    status: "partial",
    summary: {
      structurallyAcceptedEntries: 28,
      formalEligibleEntries: 21,
      ineligibleEntries: 6,
      failed: 1,
    },
  });
  assert.equal(badge.dataset.syncStatus, "partial");
  assert.match(badge.textContent, /失败1份/);
});

test("cloud current UI keeps canonical authority separate from local verification", () => {
  const source = fs.readFileSync(path.join(__dirname, "script.js"), "utf8");
  const start = source.indexOf("function cloudCurrentShanghaiTime(value)");
  const end = source.indexOf("async function loadHotStocksLegacyRequest()", start);
  assert.ok(start >= 0 && end > start, "cloud current UI helpers must remain discoverable");
  const badge = { textContent: "", title: "", dataset: {} };
  const sandbox = {
    cloudCurrentSyncStatus: badge,
    cloudCurrentAuthorityConfigured: null,
    activeDecisionAuthority: "unknown",
  };
  vm.runInNewContext(
    `${source.slice(start, end)}\nthis.cloudCurrentUi = { setDecisionAuthority, renderCloudCurrentSyncStatus, rawClosingComparison };`,
    sandbox,
  );

  sandbox.cloudCurrentUi.setDecisionAuthority("cloud", {
    fetchedAt: "2026-08-20T13:48:43.481Z",
    tomorrowDecision: { generationId: "2026-08-20:2026-08-20T13:48:43.481Z" },
  });
  assert.match(badge.textContent, /正式决策同代/);
  assert.equal(badge.dataset.syncStatus, "succeeded");

  sandbox.cloudCurrentUi.renderCloudCurrentSyncStatus({
    sync: {
      status: "failed",
      configured: true,
      snapshotAvailable: true,
      lastError: "新快照为 partial",
    },
  });
  assert.match(badge.textContent, /沿用上次已验证版本/);
  assert.match(badge.title, /partial/);

  const official = {
    market: {
      snapshot: { tradingDate: "2026-08-20", upCount: 3974, downCount: 1214 },
      limitStats: { ztToday: 78, dtToday: 11 },
    },
  };
  const same = JSON.parse(JSON.stringify(official));
  const aligned = sandbox.cloudCurrentUi.rawClosingComparison(official, same);
  assert.equal(aligned.differences.length, 0);
  same.market.limitStats.dtToday = 12;
  const mismatch = sandbox.cloudCurrentUi.rawClosingComparison(official, same);
  assert.ok(Array.from(mismatch.differences).includes("跌停数"));
});
