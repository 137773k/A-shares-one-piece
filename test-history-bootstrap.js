"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { prepareDecisionArchivePayload } = require("./archiver");
const { canonicalCashDecisionPayload } = require("./test-decision-fixture");
const {
  historyBootstrapStatus,
  importHistoryBootstrap,
  inspectImportSnapshot,
} = require("./history-bootstrap");

function strictArchive(tradingDate, previousTradingDate) {
  const payload = canonicalCashDecisionPayload({ tradingDate, previousTradingDate });
  payload.market.snapshot = {
    tradingDate,
    source: "eastmoney-live",
    shszAmountYi: 22000,
    totalAmountYi: 22000,
    allA: {
      code: "883421",
      name: "同花顺全A(沪深)",
      source: "ths-public-page",
      open: 1400,
      high: 1420,
      low: 1390,
      price: 1410,
      changePct: 0.72,
    },
  };
  payload.themeLibrary = { tradingDate, snapshotKind: "closing" };
  return prepareDecisionArchivePayload(payload, tradingDate, {
    mode: "test",
    requireCanonicalDecisionReceipt: true,
  });
}

function writeImport(root, date, payload) {
  const file = path.join(root, "data", "history-import", `${date}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return file;
}

test("首次运行明确显示历史为空，不把缺历史伪装成数据源故障", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "history-bootstrap-empty-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const status = historyBootstrapStatus(root);
  assert.equal(status.status, "empty");
  assert.equal(status.ready, false);
  assert.equal(status.availableDays, 0);
  assert.equal(status.requiredDays, 5);
  assert.equal(status.import.rawMarketDataBundled, false);
});

test("只导入严格收盘且live_canonical凭证可回验的本机归档", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "history-bootstrap-import-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = strictArchive("2026-08-21", "2026-08-20");
  const file = writeImport(root, "2026-08-21", archive);
  assert.equal(inspectImportSnapshot(file, "2026-08-21").ok, true);
  const result = importHistoryBootstrap(root);
  assert.equal(result.ok, true);
  assert.equal(result.importedCount, 1);
  assert.equal(fs.existsSync(path.join(root, "data", "history", "2026-08-21.json")), true);
  assert.equal(importHistoryBootstrap(root).results[0].status, "already_present");
});

test("五个连续严格交易日导入后历史准备度才变为就绪", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "history-bootstrap-ready-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessions = [
    ["2026-08-17", "2026-08-14"],
    ["2026-08-18", "2026-08-17"],
    ["2026-08-19", "2026-08-18"],
    ["2026-08-20", "2026-08-19"],
    ["2026-08-21", "2026-08-20"],
  ];
  sessions.forEach(([date, previous]) => writeImport(root, date, strictArchive(date, previous)));
  const result = importHistoryBootstrap(root);
  assert.equal(result.ok, true);
  assert.equal(result.importedCount, 5);
  assert.equal(result.status.ready, true);
  assert.equal(result.status.availableDays, 5);
  assert.equal(result.status.consecutive, true);
});

test("坏日期、非收盘或失效凭证归档全部拒绝且不覆盖正式历史", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "history-bootstrap-reject-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = strictArchive("2026-08-21", "2026-08-20");
  archive.archiveMeta.snapshotKind = "intraday";
  archive.decisionReceipt.integrity.ok = false;
  writeImport(root, "2026-08-22", archive);
  const result = importHistoryBootstrap(root);
  assert.equal(result.ok, false);
  assert.equal(result.rejectedCount, 1);
  assert.equal(fs.existsSync(path.join(root, "data", "history", "2026-08-22.json")), false);
  assert.ok(result.results[0].reasons.some((reason) => reason.includes("date_mismatch")));
});
