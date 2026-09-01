"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  loadConfiguredProviders,
  readProviderConfiguration,
  safeProviderModulePath,
} = require("./data-providers/provider-loader");

function runtimeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a-share-provider-"));
  fs.mkdirSync(path.join(root, "data", "providers"), { recursive: true });
  return root;
}

test("未配置用户源时保持auto模式并启用免费保底", () => {
  const root = runtimeFixture();
  try {
    const loaded = loadConfiguredProviders({ runtimeRoot: root, env: {} });
    assert.deepEqual(loaded.providers, []);
    assert.equal(loaded.diagnostics.configured, false);
    assert.equal(loaded.diagnostics.freeFallbackEnabled, true);
    assert.equal(loaded.diagnostics.credentialsStoredInConfig, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("配置文件拒绝Token明文和目录逃逸", () => {
  const root = runtimeFixture();
  try {
    const configFile = path.join(root, "data", "provider-config.json");
    fs.writeFileSync(configFile, JSON.stringify({
      schemaVersion: 1,
      mode: "custom_first",
      token: "must-not-be-stored-here",
      providers: [],
    }));
    const configuration = readProviderConfiguration(root);
    assert(configuration.errors.includes("provider_config_contains_secret_value"));
    assert.equal(safeProviderModulePath(root, "../outside.cjs"), null);
    assert.equal(safeProviderModulePath(root, "C:\\outside.cjs"), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("用户模块只能从运行目录加载，凭据只从指定环境变量注入", async () => {
  const root = runtimeFixture();
  try {
    fs.writeFileSync(path.join(root, "data", "providers", "fixture-provider.cjs"), `
      exports.createProvider = ({ credentials }) => ({
        contractVersion: 1,
        id: "fixture-provider",
        label: "fixture",
        kind: "user",
        priority: 1,
        capabilities: ["market_snapshot"],
        executionAuthority: false,
        async invoke() { return { credentialPresent: Boolean(credentials.MY_MARKET_DATA_TOKEN) }; },
      });
    `);
    fs.writeFileSync(path.join(root, "data", "provider-config.json"), JSON.stringify({
      schemaVersion: 1,
      mode: "custom_first",
      providers: [{
        module: "fixture-provider.cjs",
        enabled: true,
        priority: 120,
        credentialEnv: ["MY_MARKET_DATA_TOKEN"],
      }],
    }));
    const loaded = loadConfiguredProviders({
      runtimeRoot: root,
      env: { MY_MARKET_DATA_TOKEN: "local-only-value", UNRELATED_SECRET: "must-not-pass" },
    });
    assert.equal(loaded.diagnostics.errors.length, 0);
    assert.equal(loaded.providers.length, 1);
    assert.equal(loaded.providers[0].priority, 120);
    assert.deepEqual(await loaded.providers[0].invoke(), { credentialPresent: true });
    assert.equal(JSON.stringify(loaded.diagnostics).includes("local-only-value"), false);
    assert.equal(JSON.stringify(loaded.providers[0]).includes("UNRELATED_SECRET"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
