"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "decision-archive-"));
process.env.A_SHARE_RUNTIME_DIR = runtimeRoot;
process.env.MOBILE_APP_PASSWORD = process.env.MOBILE_APP_PASSWORD || "test-only";

const { _internals } = require("./server");
const { validateDecisionReceipt } = require("./quant-decision/decision-receipt");
const { canonicalCashDecisionPayload } = require("./test-decision-fixture");

test.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));

test("正式successful-fetch收盘归档必须冻结可读回验证的live_canonical凭证", () => {
  const payload = canonicalCashDecisionPayload();
  const result = _internals.autoArchiveMarketSnapshot(payload, {
    trigger: "successful-fetch",
    settlePreviousDecision: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.canonicalDecisionReceipt, true);
  const file = path.join(runtimeRoot, "data", "history", `${result.tradingDate}.json`);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  const inspection = validateDecisionReceipt(saved.decisionReceipt, {
    sourcePayload: saved,
    snapshotKind: saved.archiveMeta.snapshotKind,
  });
  assert.equal(inspection.liveCanonical, true);
  assert.equal(saved.archiveMeta.decisionReceiptRequired, true);
  assert.equal(saved.decisionReceipt.receiptId, result.receiptId);
  assert.equal(saved.decisionReceipt.decision.result.selectedCount, 0);
  assert.equal(saved.decisionReceipt.decision.observationCandidates.selectedCount, 5);
});

test("正式收盘载荷缺统一链时失败关闭且不落盘", () => {
  const payload = {
    fetchedAt: "2026-08-25T07:20:00.000Z",
    fetchStatus: { level: "ok" },
    market: { limitStats: { dates: { today: "20260825", prev: "20260824", verified: true } } },
    candidates: [],
  };
  const result = _internals.autoArchiveMarketSnapshot(payload, {
    trigger: "successful-fetch",
    settlePreviousDecision: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "canonical-decision-receipt-unavailable");
  assert(result.blockers.includes("unified_decision_chain_missing"));
  assert.equal(fs.existsSync(path.join(runtimeRoot, "data", "history", "2026-08-25.json")), false);
});

test("非正式兼容归档可保留unavailable凭证，但绝不获得as-decided资格", () => {
  const payload = {
    fetchedAt: "2026-08-26T07:20:00.000Z",
    market: { limitStats: { dates: { today: "20260826", prev: "20260825", verified: true } } },
    candidates: [{ code: "000001", selected: true }],
  };
  const result = _internals.autoArchiveMarketSnapshot(payload, {
    trigger: "test-legacy-compatible",
    settlePreviousDecision: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.receiptStatus, "unavailable");
  assert.equal(result.canonicalDecisionReceipt, false);
  const saved = JSON.parse(fs.readFileSync(
    path.join(runtimeRoot, "data", "history", "2026-08-26.json"),
    "utf8",
  ));
  assert.equal(saved.decisionReceipt.integrity.ok, false);
  assert.equal(saved.decisionReceipt.decision.result.selectedCount, 0);
  assert.equal(saved.decisionReceipt.source.legacySelectedIsExecutionAuthority, false);
});

test("首次安装可保存只读收盘市场证据，但明确不属于正式决策历史", () => {
  const payload = {
    fetchedAt: "2026-08-27T07:20:00.000Z",
    updatedAt: "2026-08-27T07:20:00.000Z",
    asOf: "2026-08-27T07:20:00.000Z",
    tradingDate: "2026-08-27",
    generationId: "2026-08-27:2026-08-27T07:20:00.000Z",
    generationContext: {
      version: 1,
      tradingDate: "2026-08-27",
      asOf: "2026-08-27T07:20:00.000Z",
      generationId: "2026-08-27:2026-08-27T07:20:00.000Z",
    },
    fetchStatus: { level: "partial", evidenceStatus: "incomplete", marketEvidenceStatus: "complete" },
    market: { limitStats: { dates: { today: "20260827", prev: "20260826", verified: true } } },
    candidates: [],
  };
  const result = _internals.autoArchiveMarketSnapshot(payload, {
    trigger: "bootstrap-observation",
    mode: "bootstrap_observation",
    requireCanonicalDecisionReceipt: false,
    settlePreviousDecision: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.canonicalDecisionReceipt, false);
  const saved = JSON.parse(fs.readFileSync(
    path.join(runtimeRoot, "data", "history", "2026-08-27.json"),
    "utf8",
  ));
  assert.equal(saved.archiveMeta.authorityScope, "market_evidence_bootstrap_only");
  assert.equal(saved.archiveMeta.observationOnly, true);
  assert.equal(saved.archiveMeta.executionAuthority, false);
  assert.equal(saved.archiveMeta.decisionReceiptRequired, false);
  assert.equal(saved.decisionReceipt.status, "unavailable");
});
