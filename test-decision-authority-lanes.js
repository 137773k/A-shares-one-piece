const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = __dirname;
const scriptSource = fs.readFileSync(path.join(root, "script.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "index.html"), "utf8");

function extractFunction(source, name) {
  const functionStart = source.indexOf(`function ${name}(`);
  assert.ok(functionStart >= 0, `missing function ${name}`);
  const asyncStart = source.lastIndexOf("async ", functionStart);
  const start = asyncStart >= 0 && asyncStart + 6 === functionStart ? asyncStart : functionStart;
  const brace = source.indexOf("{", functionStart);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

test("同日15:11云端不得默认覆盖15:36本机，更新云端才允许默认切换", () => {
  const sandbox = { Date, Intl };
  vm.runInNewContext([
    extractFunction(scriptSource, "decisionAuthorityLaneText"),
    extractFunction(scriptSource, "decisionAuthorityPayloadTradingDate"),
    extractFunction(scriptSource, "decisionAuthorityPayloadGenerationId"),
    extractFunction(scriptSource, "decisionAuthorityPayloadAsOf"),
    extractFunction(scriptSource, "decisionAuthorityGenerationTimestamp"),
    extractFunction(scriptSource, "decisionAuthorityLaneMeta"),
    extractFunction(scriptSource, "compareDecisionAuthorityLaneMeta"),
    "this.meta = decisionAuthorityLaneMeta; this.compare = compareDecisionAuthorityLaneMeta;",
  ].join("\n"), sandbox);

  const payload = (time) => ({
    tradingDate: "2026-08-27",
    generationId: `2026-08-27:${time}`,
    asOf: time,
    fetchedAt: time,
  });
  const local1536 = sandbox.meta("local", payload("2026-08-27T07:36:18.024Z"));
  const cloud1511 = sandbox.meta("cloud", payload("2026-08-27T07:11:11.824Z"));
  const cloud1540 = sandbox.meta("cloud", payload("2026-08-27T07:40:00.000Z"));
  assert.equal(local1536.authority, "local_observation");
  assert.equal(cloud1511.authority, "cloud_formal");
  assert.equal(sandbox.compare(cloud1511, local1536), -1);
  assert.equal(sandbox.compare(cloud1540, local1536), 1);
});

test("本机核验保留云端lane但保持本机展示并关闭执行权", async () => {
  const cloud = { tradingDate: "2026-08-27", generationId: "2026-08-27:2026-08-27T07:11:11.824Z", asOf: "2026-08-27T07:11:11.824Z", market: {} };
  const local = { tradingDate: "2026-08-27", generationId: "2026-08-27:2026-08-27T07:36:18.024Z", asOf: "2026-08-27T07:36:18.024Z", market: {} };
  let cloudReloads = 0;
  const sandbox = {
    activeDecisionAuthority: "cloud",
    lastHotPayload: cloud,
    localVerifyHotStocksBtn: null,
    decisionAuthorityLanes: { active: "cloud", cloud: { payload: cloud, detail: "" }, local: null },
    async loadHotStocks() { return { ok: true, payload: local }; },
    rawClosingComparison() { return { equal: 12, total: 12, differences: [] }; },
    premarketDirectBuyPayloadFresh() { return true; },
    premarketDirectBuyPayloadGeneration(value) { return value.generationId; },
    setPremarketDirectBuyPayloadFresh() { return false; },
    rememberDecisionAuthorityLane(authority, payload, options) {
      const lane = { key: authority, payload, detail: options.detail, executionAuthority: options.executionAuthority === true };
      sandbox.decisionAuthorityLanes[authority] = lane;
      if (options.active) sandbox.decisionAuthorityLanes.active = authority;
      return lane;
    },
    setDecisionAuthority(authority) { sandbox.activeDecisionAuthority = authority; },
    renderPremarketFlow() {},
    renderDecisionAuthorityLaneCards() {},
    async loadVerifiedCloudCurrentPayload() { cloudReloads += 1; return cloud; },
  };
  vm.runInNewContext(`${extractFunction(scriptSource, "runLocalHotStocksVerification")}\nthis.run = runLocalHotStocksVerification;`, sandbox);
  await sandbox.run();
  assert.equal(sandbox.decisionAuthorityLanes.active, "local");
  assert.equal(sandbox.lastHotPayload, local);
  assert.equal(local.executionAuthority, false);
  assert.equal(sandbox.decisionAuthorityLanes.cloud.payload, cloud);
  assert.equal(cloudReloads, 0);
});

test("页面只展示一份当前有效决策，不再暴露本机云端手动切换", () => {
  assert.match(htmlSource, /id="decisionAuthorityCurrent"/);
  assert.match(htmlSource, /当前有效决策/);
  assert.doesNotMatch(htmlSource, /id="decisionLaneLocal"/);
  assert.doesNotMatch(htmlSource, /id="decisionLaneCloud"/);
  assert.doesNotMatch(htmlSource, /authority=local_observation|authority=cloud_formal/);
});

test("统一链没有题材名称时明日展望保持空值而不是调用undefined.includes", () => {
  assert.match(scriptSource, /const normalizedName = clean\(name\);\s*if \(!normalizedName\) return null;/);
  assert.match(scriptSource, /label\.includes\(normalizedName\).*normalizedName\.includes\(label\)/s);
});
