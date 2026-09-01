"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "theme-history-"));
process.env.A_SHARE_RUNTIME_DIR = runtimeRoot;
process.env.MOBILE_APP_PASSWORD = process.env.MOBILE_APP_PASSWORD || "test-only";

const { _internals } = require("./server");
const { autoArchiveMarketSnapshot, buildThemeLibraryApiResponse, themeLibrarySnapshotFromPayload } = _internals;
const { THEME_LIBRARY_CLASSIFIER_VERSION } = require("./theme-library");

function snapshotPayload({ tradingDate = "20260807", previousDate = "20260806", fetchedAt, marker, themeName = "算力" }) {
  const leader = {
    code: "000001",
    name: `${themeName}龙头`,
    mainFamily: themeName,
    concepts: [themeName],
    role: "龙头",
    roleReason: "方向内强度领先",
    score: 95,
    changePct: 10,
    amountYi: 50,
  };
  return {
    marker,
    fetchedAt,
    stale: false,
    fetchError: null,
    fetchStatus: { level: "ok" },
    market: {
      limitStats: {
        dates: { today: tradingDate, prev: previousDate, verified: true },
      },
    },
    topicBoard: {
      mainLine: { name: themeName, family: themeName },
      items: [{
        name: themeName,
        family: themeName,
        displayName: themeName,
        label: "主线持续",
        score: 200,
        count: 3,
        limitCount: 1,
        leader,
        leaders: [leader],
      }],
    },
    candidates: [leader],
  };
}

function legacyMedicalPayload() {
  const hayao = { code: "600664", name: "哈药股份", concepts: ["流感", "医药电商"], mainConcept: "流感", role: "龙头", changePct: 9.97, combinedRank: 2, popularity: "首板涨停", klineProfile: { wave: "三波/高位趋势", rise20: 103, rise30: 133.4, nearHigh20: true, ma5: 6.45, ma10: 6.05, ma20: 5.58 }, leadership: { persistentRecognition: true, impactScore: 40, structure: { frameworkIntact: true, breakdown: false }, history: { appearances: 3, coreHits: 2, activeHits: 1 } } };
  const zhaoyan = { code: "603127", name: "昭衍新药", concepts: ["CRO概念"], mainConcept: "CRO概念", role: "龙头", score: 999, changePct: 10.01, combinedRank: 12, popularity: "首板涨停", klineProfile: { wave: "趋势一波", rise20: 17.7, rise30: 37.7, ma5: 45.77, ma10: 44.97, ma20: 46.42 }, leadership: { persistentRecognition: false, history: { appearances: 0 } } };
  return {
    fetchedAt: "2026-08-07T07:20:00.000Z",
    market: { limitStats: { dates: { today: "20260807", prev: "20260806", verified: true } } },
    topicBoard: {
      mainLine: { name: "流感", family: "流感" },
      items: [
        { name: "CRO概念", family: "CRO概念", score: 168, count: 1, limitCount: 1, leader: zhaoyan, leaders: [zhaoyan] },
        { name: "流感", family: "流感", score: 97, count: 1, limitCount: 1, leader: hayao, leaders: [hayao] },
      ],
    },
    candidates: [hayao, zhaoyan],
    themeLibrary: {
      schemaVersion: 1,
      classifierVersion: "theme-library-v1",
      tradingDate: "2026-08-07",
      available: true,
      themes: [{ id: "CRO概念", name: "CRO概念", stocks: [] }, { id: "流感", name: "流感", stocks: [] }],
    },
  };
}

try {
  const rebuiltLegacy = themeLibrarySnapshotFromPayload(legacyMedicalPayload(), "legacy-derived");
  assert.strictEqual(rebuiltLegacy.classifierVersion, THEME_LIBRARY_CLASSIFIER_VERSION);
  assert.deepStrictEqual(rebuiltLegacy.themes.map((theme) => theme.name), ["医药"], "旧 v1 拆分快照必须从原始数据重建");
  assert.strictEqual(rebuiltLegacy.themes[0].stocks.some((stock) => stock.code === "600664" && stock.tags.some((tag) => tag.label === "龙头")), true);
  assert.strictEqual(rebuiltLegacy.themes[0].stocks.some((stock) => stock.code === "603127"), false);

  const friday = snapshotPayload({
    fetchedAt: "2026-08-07T07:10:00.000Z",
    marker: "friday-close",
  });
  const first = autoArchiveMarketSnapshot(friday, { trigger: "test-friday" });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.skipped, false);

  const laterFriday = snapshotPayload({
    fetchedAt: "2026-08-07T07:20:00.000Z",
    marker: "friday-later-close",
  });
  const later = autoArchiveMarketSnapshot(laterFriday, { trigger: "test-friday-later" });
  assert.strictEqual(later.skipped, false, "同交易日更晚的收盘快照应可更新");

  const sunday = snapshotPayload({
    fetchedAt: "2026-08-09T03:00:00.000Z",
    marker: "sunday-refresh",
    themeName: "周末错误题材",
  });
  const frozen = autoArchiveMarketSnapshot(sunday, { trigger: "test-weekend" });
  assert.strictEqual(frozen.skipped, true);
  assert.strictEqual(frozen.reason, "historical-closing-snapshot-frozen");

  const missingProviderDate = snapshotPayload({
    fetchedAt: "2026-08-09T03:00:00.000Z",
    marker: "missing-provider-date",
  });
  delete missingProviderDate.market.limitStats.dates.today;
  const rejected = autoArchiveMarketSnapshot(missingProviderDate, { trigger: "test-missing-provider" });
  assert.strictEqual(rejected.ok, false);
  assert.strictEqual(rejected.skipped, true);
  assert.strictEqual(rejected.reason, "missing-provider-trading-date");
  assert.strictEqual(fs.existsSync(path.join(runtimeRoot, "data", "history", "2026-08-09.json")), false);

  const fridayFile = path.join(runtimeRoot, "data", "history", "2026-08-07.json");
  const savedFriday = JSON.parse(fs.readFileSync(fridayFile, "utf8"));
  assert.strictEqual(savedFriday.marker, "friday-later-close");
  assert.strictEqual(savedFriday.archiveMeta.snapshotKind, "closing");
  assert.strictEqual(savedFriday.themeLibrary.snapshotKind, "closing");
  assert.strictEqual(savedFriday.generationContext.asOf, laterFriday.fetchedAt);
  assert.strictEqual(savedFriday.archiveMeta.generationId, savedFriday.generationContext.generationId);
  assert.strictEqual(savedFriday.themeLibrary.generationId, savedFriday.generationContext.generationId);
  assert.strictEqual(savedFriday.themeLibrary.generatedAt, savedFriday.generationContext.asOf);

  savedFriday.themeLibrary.previousTradingDate = "2026-08-06";
  savedFriday.themeLibrary.previousDateVerified = false;
  fs.writeFileSync(fridayFile, JSON.stringify(savedFriday), "utf8");
  fs.writeFileSync(
    path.join(runtimeRoot, "data", "history", "2026-08-06.json"),
    JSON.stringify(snapshotPayload({
      tradingDate: "20260806",
      previousDate: "20260805",
      fetchedAt: "2026-08-06T07:20:00.000Z",
      marker: "unverified-previous-present",
      themeName: "前一日题材",
    })),
    "utf8",
  );

  fs.writeFileSync(
    path.join(runtimeRoot, ".hot-stocks-cache.json"),
    JSON.stringify(sunday),
    "utf8",
  );
  const mismatch = snapshotPayload({
    tradingDate: "20260710",
    previousDate: "20260709",
    fetchedAt: "2026-07-12T03:00:00.000Z",
    marker: "legacy-mismatch",
    themeName: "旧错档题材",
  });
  fs.writeFileSync(
    path.join(runtimeRoot, "data", "history", "2026-07-12.json"),
    JSON.stringify(mismatch),
    "utf8",
  );

  const latest = buildThemeLibraryApiResponse();
  assert.strictEqual(latest.status, 200);
  assert.strictEqual(latest.payload.selectedDate, "2026-08-07");
  assert.strictEqual(latest.payload.previousAvailable, false, "缺少精确 T-1 时不得回退 T-2");
  assert.strictEqual(latest.payload.expectedPreviousDate, null, "未验证的 previousTradingDate 即使有文件也不得比较");
  assert.strictEqual(latest.payload.snapshot.themes[0].name, "算力", "跨日当前缓存不得压过已冻结收盘归档");
  assert.strictEqual(latest.payload.availableDates.some((item) => item.date === "2026-07-10"), true);
  assert.strictEqual(latest.payload.availableDates.some((item) => item.date === "2026-07-12"), false);
  assert.strictEqual(buildThemeLibraryApiResponse("2026-07-10").status, 200);
  assert.strictEqual(buildThemeLibraryApiResponse("2026-07-12").status, 404);

  const monday = snapshotPayload({
    tradingDate: "20260810",
    previousDate: "20260807",
    fetchedAt: "2026-08-10T07:20:00.000Z",
    marker: "monday-close",
    themeName: "算力",
  });
  const mondayArchive = autoArchiveMarketSnapshot(monday, { trigger: "test-monday-exact-prev" });
  assert.strictEqual(mondayArchive.ok, true);
  assert.strictEqual(mondayArchive.skipped, false);
  const mondayApi = buildThemeLibraryApiResponse("2026-08-10");
  const mondayTheme = mondayApi.payload.snapshot.themes[0];
  assert.strictEqual(mondayApi.payload.previousAvailable, true);
  assert.strictEqual(mondayTheme.history.continued, true);
  assert.strictEqual(mondayTheme.themeCycle.history.continued, true);
  assert.strictEqual(mondayTheme.themeCycle.history.comparisonUnavailable, false);
  assert.strictEqual(mondayTheme.themeCycle.state, "continued_unverified");
  assert.strictEqual(mondayTheme.themeCycle.label, "跨日仍在榜·强度待确认");

  console.log("theme history tests passed");
} finally {
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
}
