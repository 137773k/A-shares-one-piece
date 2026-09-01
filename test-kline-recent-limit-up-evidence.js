"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { _internals } = require("./server");

function row(date, close) {
  return { date, open: close, high: close, low: close, close, amount: 1e8 };
}

test("K线画像按板块涨停价记录最近5日和10日的收盘涨停日期", () => {
  const rows = [
    row("2026-08-06", 10),
    row("2026-08-07", 11),
    row("2026-08-08", 11),
    row("2026-08-11", 11),
    row("2026-08-12", 11),
    row("2026-08-13", 11),
    row("2026-08-14", 11),
    row("2026-08-17", 11),
    row("2026-08-18", 12.1),
    row("2026-08-19", 12.1),
    row("2026-08-20", 12.1),
  ];
  const evidence = _internals.buildRecentLimitUpEvidence({ code: "600001", name: "匿名样本" }, rows, 10);

  assert.equal(evidence.verified, true);
  assert.deepEqual(evidence.window5.dates, ["2026-08-18"]);
  assert.deepEqual(evidence.window10.dates, ["2026-08-07", "2026-08-18"]);
  assert.equal(evidence.window5.count, 1);
  assert.equal(evidence.window10.count, 2);
});

test("没有可比较昨收的完整日线时不伪造涨停历史", () => {
  const evidence = _internals.buildRecentLimitUpEvidence({ code: "600001", name: "匿名样本" }, [row("2026-08-20", 10)], 0);
  assert.equal(evidence.verified, false);
  assert.equal(evidence.reason, "completed_daily_history_insufficient");
});
