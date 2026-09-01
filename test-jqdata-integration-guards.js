"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CANONICAL_MINUTE_HASH_SCOPE,
  computeMinuteContentHash,
} = require("./quant-decision/minute-evidence");
const { selectV7MinuteEvidenceFromCaches } = require("./quant-decision/outcome-evidence");
const { main: runJqDataTool, sanitizedProbeEnvironment } = require("./run-jqdata-tool");

const CODE = "000001";
const TRADING_DATE = "2026-05-22";

function minuteText(totalMinutes) {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function fullMinuteBars() {
  const minutes = [];
  for (let minute = 9 * 60 + 31; minute <= 11 * 60 + 30; minute += 1) minutes.push(minute);
  for (let minute = 13 * 60 + 1; minute <= 15 * 60; minute += 1) minutes.push(minute);
  return minutes.map((minute, index) => ({
    timestamp: `${TRADING_DATE} ${minuteText(minute)}:00`,
    open: 10 + index / 10_000,
    high: 10.02 + index / 10_000,
    low: 9.98 + index / 10_000,
    close: 10.01 + index / 10_000,
    volume: 1000 + index,
    money: (1000 + index) * (10.01 + index / 10_000),
  }));
}

function jqCache(recordOverrides = {}, cacheOverrides = {}) {
  const bars = fullMinuteBars();
  return {
    authority: "jqdata_1m_execution_validation_v1",
    executionAuthority: false,
    provider: { name: "JQData", version: "1.9.8" },
    barIntervalMinutes: 1,
    priceMode: "raw_unadjusted",
    contentHashScope: CANONICAL_MINUTE_HASH_SCOPE,
    records: [{
      provider: "JQData",
      providerVersion: "1.9.8",
      code: CODE,
      jqCode: `${CODE}.XSHE`,
      tradingDate: TRADING_DATE,
      barIntervalMinutes: 1,
      priceMode: "raw_unadjusted",
      status: "valid",
      validForExecutionReplay: true,
      validForV7: true,
      executionAuthority: false,
      scheduleQuality: { passed: true },
      contentHashScope: CANONICAL_MINUTE_HASH_SCOPE,
      contentHash: computeMinuteContentHash(bars),
      bars,
      ...recordOverrides,
    }],
    ...cacheOverrides,
  };
}

test("JQData cache bridge preserves record and top-level execution-authority pollution", () => {
  for (const cache of [
    jqCache({ executionAuthority: true }),
    jqCache({}, { executionAuthority: true }),
  ]) {
    const result = selectV7MinuteEvidenceFromCaches({
      code: `${CODE}.XSHE`,
      tradingDate: TRADING_DATE,
      caches: [cache],
    });
    assert.equal(result.selectedPriceEvidence, null);
    assert(result.assessments[0].blockers.includes("minute_evidence_must_not_claim_execution_authority"));
  }
});

test("JQData cache bridge preserves every explicit upstream quality failure", () => {
  const failedCaches = [
    jqCache({ validForExecutionReplay: false }),
    jqCache({ scheduleQuality: { passed: false, blockers: ["fixture_quality_failure"] } }),
    jqCache({ status: "data_quality_failed" }),
    jqCache({}, { validForV7: false }),
    jqCache({}, { status: "provider_error" }),
  ];
  for (const cache of failedCaches) {
    const result = selectV7MinuteEvidenceFromCaches({
      code: CODE,
      tradingDate: TRADING_DATE,
      caches: [cache],
    });
    assert.equal(result.selectedPriceEvidence, null);
    assert(result.assessments[0].blockers.includes("upstream_minute_verification_failed"));
  }
});

test("Python discovery probes receive sanitized env while selected fetch receives credentials", () => {
  const environment = {
    A_SHARE_JQDATA_PYTHON: "fixture-python",
    JQDATA_USER: "fixture-user",
    JQDATA_PASSWORD: "fixture-password",
    KEEP_ME: "visible",
  };
  const sanitized = sanitizedProbeEnvironment(environment);
  assert.equal(sanitized.JQDATA_USER, undefined);
  assert.equal(sanitized.JQDATA_PASSWORD, undefined);
  assert.equal(sanitized.KEEP_ME, "visible");
  assert.equal(environment.JQDATA_PASSWORD, "fixture-password");

  const calls = [];
  const fakeSpawnSync = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: "fixture-python\n", stderr: "" };
  };
  const status = runJqDataTool(["fetch_jqdata_minute_outcomes.py", "--help"], {
    spawnSync: fakeSpawnSync,
    env: environment,
  });
  assert.equal(status, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.env.JQDATA_USER, undefined);
  assert.equal(calls[0].options.env.JQDATA_PASSWORD, undefined);
  assert.equal(calls[0].options.env.KEEP_ME, "visible");
  assert.equal(calls[1].options.env.JQDATA_USER, "fixture-user");
  assert.equal(calls[1].options.env.JQDATA_PASSWORD, "fixture-password");
});
