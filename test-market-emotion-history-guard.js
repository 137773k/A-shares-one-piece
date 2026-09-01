"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "a-share-emotion-history-"));
process.env.A_SHARE_RUNTIME_DIR = runtimeDir;

const { buildMarketEmotionObservation } = require("./server")._internals;
const historyDir = path.join(runtimeDir, "data", "history");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function archive(date, amount, snapshotKind = "closing") {
  return {
    fetchedAt: `${date}T15:05:00+08:00`,
    fetchStatus: { level: "ok" },
    archiveMeta: { tradingDate: date, snapshotKind },
    market: {
      snapshot: { shszAmountYi: amount, avgIndexChange: 0.2, breadth: 0.51 },
      limitStats: { dates: { today: date.replace(/-/g, "") } },
      state: { cycle: "震荡" },
    },
    candidates: [],
  };
}

function currentPayload() {
  return {
    fetchedAt: "2099-01-15T15:05:00+08:00",
    market: {
      snapshot: {
        asOf: "2099-01-15T15:05:00+08:00",
        tradingDate: "2099-01-15",
        shszAmountYi: 20000,
        avgIndexChange: 0.8,
        breadth: 0.58,
      },
      limitStats: {
        ztToday: 50,
        ztPrev: 45,
        dtToday: 5,
        dtPrev: 6,
        dates: { today: "20990115", prev: "20990114", verified: true },
      },
      state: { cycle: "修复", dailyState: { key: "repair" } },
    },
    candidates: [],
    selected: [],
    topicBoard: {},
    hotConcepts: [],
  };
}

try {
  fs.mkdirSync(historyDir, { recursive: true });
  writeJson(path.join(historyDir, "index.json"), [{ date: "2099-01-10" }]);
  writeJson(path.join(historyDir, "2099-01-10.json"), archive("2099-01-10", 10000));

  let model = buildMarketEmotionObservation(currentPayload());
  assert.equal(model.evidence.previousAmountYi, null);
  assert.equal(model.evidence.volumeDeltaPct, null);

  writeJson(path.join(historyDir, "index.json"), [{ date: "2099-01-14" }, { date: "2099-01-10" }]);
  writeJson(path.join(historyDir, "2099-01-14.json"), archive("2099-01-14", 10000, "intraday"));
  model = buildMarketEmotionObservation(currentPayload());
  assert.equal(model.evidence.previousAmountYi, null, "盘中归档不能用于成交额环比");
  assert.equal(model.evidence.volumeDeltaPct, null);

  writeJson(path.join(historyDir, "2099-01-14.json"), archive("2099-01-14", 10000, "closing"));
  model = buildMarketEmotionObservation(currentPayload());
  assert.equal(model.evidence.previousAmountYi, 10000);
  assert.equal(model.evidence.volumeDeltaPct, 100);

  console.log("market emotion exact T-1 history guard tests passed");
} finally {
  fs.rmSync(runtimeDir, { recursive: true, force: true });
}
