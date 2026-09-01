"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildDecisionReceipt, validateDecisionReceipt } = require("./quant-decision/decision-receipt");
const { validateDecisionOutcome } = require("./quant-decision/decision-outcome");
const {
  dailyOutcomeInputs,
  minuteOutcomeInputs,
  settleExactPreviousDecision,
  refreshDecisionOutcomeLedger,
} = require("./quant-decision/decision-ledger");
const { auditDecisionReceiptSnapshots } = require("./quant-decision/decision-receipt-audit");
const { canonicalCashDecisionPayload } = require("./test-decision-fixture");

function tempRuntime() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "decision-ledger-"));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function liveCashSignalSnapshot() {
  const payload = canonicalCashDecisionPayload();
  payload.archiveMeta = {
    ...(payload.archiveMeta || {}),
    tradingDate: "2026-08-21",
    snapshotKind: "closing",
    decisionReceiptRequired: true,
  };
  const receipt = buildDecisionReceipt(payload, { snapshotKind: "closing" });
  assert.equal(receipt.status, "live_canonical");
  payload.decisionReceipt = receipt;
  assert.equal(validateDecisionReceipt(receipt, { sourcePayload: payload, snapshotKind: "closing" }).liveCanonical, true);
  return payload;
}

function exactNextSnapshot() {
  return {
    archiveMeta: { tradingDate: "2026-08-24", snapshotKind: "closing" },
    market: {
      limitStats: {
        dates: { today: "20260824", prev: "20260821", verified: true },
      },
    },
    candidates: [],
  };
}

test("live_canonical零股票凭证在精确T+1写入现金侧车且重复运行幂等", () => {
  const runtimeRoot = tempRuntime();
  try {
    const historyDir = path.join(runtimeRoot, "data", "history");
    fs.mkdirSync(historyDir, { recursive: true });
    const signal = liveCashSignalSnapshot();
    const signalFile = path.join(historyDir, "2026-08-21.json");
    fs.writeFileSync(signalFile, JSON.stringify(signal), "utf8");
    const beforeHash = sha256File(signalFile);

    const first = settleExactPreviousDecision(exactNextSnapshot(), { runtimeRoot });
    assert.equal(first.ok, true);
    assert.equal(first.outcomeStatus, "cash_only");
    assert.equal(first.write.changed, true);
    const stored = JSON.parse(fs.readFileSync(first.write.file, "utf8"));
    assert.equal(validateDecisionOutcome(stored, { decisionReceipt: signal.decisionReceipt }).valid, true);
    assert.equal(stored.receiptBinding.receiptId, signal.decisionReceipt.receiptId);
    assert.equal(stored.portfolio.cashReserveAfterTriggersPct, 100);

    const second = settleExactPreviousDecision(exactNextSnapshot(), { runtimeRoot });
    assert.equal(second.write.changed, false);
    assert.equal(second.write.outcome.settlementHash, stored.settlementHash);
    assert.equal(sha256File(signalFile), beforeHash, "结算不得回写T日历史原档");
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test("旧历史无凭证只记审计状态，不能进入正式结算目录", () => {
  const runtimeRoot = tempRuntime();
  try {
    const historyDir = path.join(runtimeRoot, "data", "history");
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(path.join(historyDir, "2026-08-21.json"), JSON.stringify({
      archiveMeta: { tradingDate: "2026-08-21", snapshotKind: "closing" },
      market: { limitStats: { dates: { today: "20260821", prev: "20260820", verified: true } } },
      selected: [{ code: "000001" }],
    }), "utf8");
    const result = settleExactPreviousDecision(exactNextSnapshot(), { runtimeRoot });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "legacy_signal_archive_without_receipt");
    assert.equal(fs.existsSync(path.join(runtimeRoot, "data", "decision-outcomes", "2026-08-21.json")), false);
    const audit = auditDecisionReceiptSnapshots(historyDir);
    assert.equal(audit.liveCanonicalCount, 0);
    assert.equal(audit.legacyWithoutReceiptCount, 1);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test("批量刷新只生成侧车，不改变任何历史快照字节", () => {
  const runtimeRoot = tempRuntime();
  try {
    const historyDir = path.join(runtimeRoot, "data", "history");
    fs.mkdirSync(historyDir, { recursive: true });
    const signal = liveCashSignalSnapshot();
    const signalFile = path.join(historyDir, "2026-08-21.json");
    const nextFile = path.join(historyDir, "2026-08-24.json");
    fs.writeFileSync(signalFile, JSON.stringify(signal), "utf8");
    fs.writeFileSync(nextFile, JSON.stringify(exactNextSnapshot()), "utf8");
    const before = new Map([[signalFile, sha256File(signalFile)], [nextFile, sha256File(nextFile)]]);
    const report = refreshDecisionOutcomeLedger({ runtimeRoot });
    assert.equal(report.settledOrRecordedCount, 1);
    before.forEach((hash, file) => assert.equal(sha256File(file), hash));
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test("账本把精确T+1候选日线和已校验分钟条转换为结算器唯一输入", () => {
  const receipt = {
    decision: {
      result: {
        stocks: [{
          code: "000001",
          executionReplayRule: { referencePrice: 10 },
        }],
      },
    },
  };
  const currentSnapshot = {
    candidates: [{
      code: "000001",
      prevClose: 10,
      open: 10.1,
      high: 10.5,
      low: 9.9,
      price: 10.2,
    }],
  };
  const daily = dailyOutcomeInputs(receipt, currentSnapshot, { series: {} }, "2026-08-21", "2026-08-24");
  assert.equal(daily["000001"].valid, true);
  assert.equal(daily["000001"].currentTradingDate, "2026-08-21");
  assert.equal(daily["000001"].nextTradingDate, "2026-08-24");
  const bars = [{ date: "2026-08-24", time: "09:35", open: 10.1, high: 10.2, low: 10, close: 10.15, volume: 100 }];
  const minute = minuteOutcomeInputs(receipt, {
    series: {
      "000001": {
        minuteRowsByDate: { "2026-08-24": bars },
        minuteQualityByDate: { "2026-08-24": { validForExecutionReplay: true } },
        minuteSource: "test_5m",
      },
    },
  }, "2026-08-24");
  assert.equal(minute["000001"].validForExecutionReplay, true);
  assert.deepEqual(minute["000001"].bars, bars);
});
