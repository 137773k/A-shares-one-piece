"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveFetchEvidenceQuality } = require("./fetch-evidence-quality");
const server = require("./server");
const { buildFetchStatus, fetchTencentKlineRows, strictExactClosingEvidence } = server._internals;
const {
  createKlineSourceStats,
  summarizeKlineProfileScope,
  detectKlineStructuralExclusion,
  klineCircuitShouldAttempt,
  recordKlineSourceFailure,
  recordKlineSourceSuccess,
  expectedCompletedKlineTradingDate,
  assessCachedKlineProfile,
  movingAverageSlopeAt,
  classifyKlineWave,
  fetchTencentRawKlineRows,
  fetchKlineRows,
  prioritizeKlineProfileFetchRows,
  enrichKlineProfiles,
} = server.klineQualityInternals;

test("上市不足3日的新股退出正式K线分母，普通股票缺K线仍算失败", () => {
  const oneDayRows = [{ date: "2026-08-27", close: 12.3 }];
  const twoDayRows = [
    { date: "2026-08-26", close: 11.2 },
    { date: "2026-08-27", close: 12.3 },
  ];
  const nameDetected = detectKlineStructuralExclusion({ code: "920001", name: "N测试" }, oneDayRows);
  const flagDetected = detectKlineStructuralExclusion({ code: "920002", name: "测试", isNewListing: true }, twoDayRows);

  assert.equal(nameDetected.reasonCode, "listing_history_below_profile_minimum");
  assert.equal(nameDetected.tradingDays, 1);
  assert.equal(nameDetected.marketEvidenceImpact, false);
  assert.equal(flagDetected.tradingDays, 2);
  assert.equal(detectKlineStructuralExclusion({ code: "000001", name: "平安银行" }, oneDayRows), null);
  assert.equal(detectKlineStructuralExclusion({ code: "920001", name: "N测试" }, []), null);
});

test("结构性新股样本不阻断市场K线闭环并保留可审计原因", () => {
  const marketRows = [
    { code: "000001", name: "平安银行", klineProfile: completeProfile(), klineProfileLineage: { mode: "live", source: "tencent" } },
    {
      code: "920001",
      name: "N测试",
      klineProfile: null,
      klineProfileLineage: { mode: "structural_exclusion", liveFetchFailed: false },
      klineStructuralExclusion: {
        reasonCode: "listing_history_below_profile_minimum",
        tradingDays: 1,
        requiredTradingDays: 3,
        marketEvidenceImpact: false,
        observationOnly: true,
        executionAuthority: false,
      },
    },
  ];
  const marketScope = summarizeKlineProfileScope(marketRows);
  const status = buildFetchStatus(fullFetchContext({
    total: 2,
    klineOk: 1,
    klineRequested: marketScope.requested,
    klineLiveAccepted: marketScope.liveAccepted,
    klineEast: marketScope.east,
    klineTencent: marketScope.tencent,
    klineCached: marketScope.cached,
    klineSameDayCache: marketScope.sameDayCache,
    klineUnavailable: marketScope.unavailable,
    klineStructuralExcluded: marketScope.structuralExcluded,
    klineStructuralExclusionSamples: marketScope.structuralExclusionSamples,
    klineLiveFailed: marketScope.fail,
    klineSupplemental: summarizeKlineProfileScope([]),
  }));

  assert.equal(marketScope.totalObserved, 2);
  assert.equal(marketScope.requested, 1);
  assert.equal(marketScope.unavailable, 0);
  assert.equal(marketScope.structuralExcluded, 1);
  assert.equal(status.mode, "live_complete");
  assert.equal(status.evidenceStatus, "complete");
  assert.equal(status.kline.marketScope.requestedCount, 1);
  assert.equal(status.kline.marketScope.structuralExcludedCount, 1);
  assert.match(status.items.find((item) => item.name === "K线/均线").note, /上市不足3日/);
});

test("补充观察票缺K线不再取消正式市场的大周期收盘证据", () => {
  const marketRows = [
    { code: "000001", klineProfile: completeProfile(), klineProfileCached: false, klineProfileLineage: { mode: "live", source: "tencent" } },
    { code: "000002", klineProfile: completeProfile(), klineProfileCached: false, klineProfileLineage: { mode: "live", source: "tencent" } },
  ];
  const supplementalRows = [
    { code: "600929", previousLimitUpOnly: true, klineProfile: null, klineProfileLineage: { mode: "live_stale_cache_rejected", liveFetchFailed: true, tradingDate: "2026-08-26" } },
  ];
  const marketScope = summarizeKlineProfileScope(marketRows);
  const supplementalScope = summarizeKlineProfileScope(supplementalRows);
  const status = buildFetchStatus(fullFetchContext({
    total: 2,
    klineOk: 2,
    klineRequested: marketScope.requested,
    klineLiveAccepted: marketScope.liveAccepted,
    klineEast: marketScope.east,
    klineTencent: marketScope.tencent,
    klineCached: marketScope.cached,
    klineSameDayCache: marketScope.sameDayCache,
    klineUnavailable: marketScope.unavailable,
    klineLiveFailed: marketScope.fail,
    klineSupplemental: supplementalScope,
  }));
  const supplemental = status.items.find((item) => item.name === "T-1补充观察K线");
  assert.equal(status.mode, "live_complete");
  assert.equal(status.level, "partial");
  assert.equal(status.evidenceStatus, "complete");
  assert.equal(status.kline.marketScope.unavailableCount, 0);
  assert.equal(status.kline.supplementalScope.unavailableCount, 1);
  assert.equal(supplemental.ok, true);
  assert.equal(supplemental.degraded, true);
  assert.equal(supplemental.marketEvidenceImpact, false);
  assert.match(supplemental.note, /不影响市场大周期/);
  assert.equal(resolveFetchEvidenceQuality({ fetchStatus: status }, "2026-08-27").closingEvidenceUsable, true);
  const asOf = "2026-08-27T07:10:00.000Z";
  const generationId = `2026-08-27:${asOf}`;
  const closingPayload = {
    fetchedAt: asOf,
    updatedAt: asOf,
    asOf,
    tradingDate: "2026-08-27",
    generationId,
    generationContext: { version: 1, asOf, tradingDate: "2026-08-27", generationId },
    market: { limitStats: { dates: { today: "20260827", verified: true } } },
    fetchStatus: status,
    sources: {
      klineDiagnostics: {
        statusKey: status.mode,
        expectedCompletedTradingDate: "2026-08-27",
        unavailable: 1,
        totalUnavailable: 1,
        marketScope: status.kline.marketScope,
        supplementalScope: status.kline.supplementalScope,
      },
    },
  };
  assert.equal(strictExactClosingEvidence(closingPayload, "2026-08-27").ok, true);
});

test("正式市场样本缺K线仍然严格关闭大周期收盘证据", () => {
  const marketRows = [
    { code: "000001", klineProfile: completeProfile(), klineProfileCached: false, klineProfileLineage: { mode: "live", source: "tencent" } },
    { code: "000002", klineProfile: null, klineProfileLineage: { mode: "live_stale_cache_rejected", liveFetchFailed: true, tradingDate: "2026-08-26" } },
  ];
  const marketScope = summarizeKlineProfileScope(marketRows);
  const status = buildFetchStatus(fullFetchContext({
    total: 2,
    klineOk: 1,
    klineRequested: marketScope.requested,
    klineLiveAccepted: marketScope.liveAccepted,
    klineEast: marketScope.east,
    klineTencent: marketScope.tencent,
    klineCached: marketScope.cached,
    klineSameDayCache: marketScope.sameDayCache,
    klineUnavailable: marketScope.unavailable,
    klineLiveFailed: marketScope.fail,
    klineSupplemental: summarizeKlineProfileScope([]),
  }));
  const quality = resolveFetchEvidenceQuality({ fetchStatus: status }, "2026-08-27");
  assert.equal(status.mode, "unavailable");
  assert.equal(status.evidenceStatus, "incomplete");
  assert.equal(status.kline.marketScope.unavailableCount, 1);
  assert.equal(quality.closingEvidenceUsable, false);
  assert.ok(quality.reasons.includes("kline_coverage_incomplete"));
  const asOf = "2026-08-27T07:10:00.000Z";
  const generationId = `2026-08-27:${asOf}`;
  const closingPayload = {
    fetchedAt: asOf,
    updatedAt: asOf,
    asOf,
    tradingDate: "2026-08-27",
    generationId,
    generationContext: { version: 1, asOf, tradingDate: "2026-08-27", generationId },
    market: { limitStats: { dates: { today: "20260827", verified: true } } },
    fetchStatus: status,
  };
  const strict = strictExactClosingEvidence(closingPayload, "2026-08-27");
  assert.equal(strict.ok, false);
  assert.ok(strict.reasons.includes("kline_coverage_incomplete"));
});

test("K线波段分类把深跌修复与当前高位趋势分开", () => {
  assert.equal(classifyKlineWave({
    rise10: 9.2,
    rise20: 45.6,
    nearHigh20: true,
    volumeBreakout: true,
    currentHighTrendStructure: false,
    deepHistoricalRepair: true,
    waveShortTrendAligned: false,
  }), "历史高位深跌修复");
  assert.equal(classifyKlineWave({
    rise10: 22,
    rise20: 38,
    nearHigh20: true,
    volumeBreakout: true,
    currentHighTrendStructure: true,
    deepHistoricalRepair: false,
    waveShortTrendAligned: true,
  }), "三波/高位趋势");
});

test("指数MA5斜率使用相邻交易日，不再使用三日滞后差分", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({ close: index + 1 }));
  const slope = movingAverageSlopeAt(rows, rows.length, 5, 1);
  assert.ok(Math.abs(slope - (1 / 7 * 100)) < 1e-9);
  assert.notEqual(slope, movingAverageSlopeAt(rows, rows.length, 5, 3));
});

function completeProfile(date = "2026-08-27") {
  return {
    lastTradingDate: date,
    lastClose: 12.34,
    isNewListing: false,
    ma5: 12,
    ma10: 11.5,
    ma20: 11,
    lastSession: {
      tradingDate: date,
      close: 12.34,
      verified: true,
      completed: true,
    },
    dataLineage: {
      fetchedAt: "2026-08-27T12:05:00.000Z",
      source: "tencent",
    },
  };
}

function fullFetchContext(overrides = {}) {
  return {
    eastRank: [{}],
    thsRows: [{}],
    brokenRows: [],
    klineOk: 130,
    klineRequested: 159,
    klineLiveAccepted: 159,
    klineEast: 0,
    klineTencent: 159,
    klineCached: 0,
    klineSameDayCache: 0,
    klineStaleCacheRejected: 0,
    klineUnavailable: 0,
    klineLiveFailed: 0,
    expectedCompletedKlineDate: "2026-08-27",
    klineCacheTradingDates: {},
    total: 130,
    unclassified: 0,
    sectorRows: [{}],
    marketSnapshot: { source: "eastmoney-live", shszAmountYi: 20000 },
    limitStats: { ztToday: 50, source: "ths" },
    externalSnapshot: { available: true },
    ...overrides,
  };
}

test("完成交易日边界统一使用15:05，且provider日期必须已验证", () => {
  const limitStats = { dates: { verified: true, today: "20260827", prev: "20260826" } };
  assert.equal(expectedCompletedKlineTradingDate(limitStats, new Date("2026-08-27T06:59:00.000Z")), "2026-08-26");
  assert.equal(expectedCompletedKlineTradingDate(limitStats, new Date("2026-08-27T07:00:00.000Z")), "2026-08-26");
  assert.equal(expectedCompletedKlineTradingDate(limitStats, new Date("2026-08-27T07:04:00.000Z")), "2026-08-26");
  assert.equal(expectedCompletedKlineTradingDate(limitStats, new Date("2026-08-27T07:05:00.000Z")), "2026-08-27");
  assert.equal(expectedCompletedKlineTradingDate({ dates: { today: "20260827", prev: "20260826" } }), null);
});

test("同日完整缓存可接管，跨日、未来和残缺缓存全部拒绝", () => {
  const sameDay = assessCachedKlineProfile(completeProfile(), { expectedTradingDate: "2026-08-27" });
  assert.equal(sameDay.usable, true);
  assert.equal(sameDay.status, "same_day_cache");

  const stale = assessCachedKlineProfile(completeProfile("2026-08-26"), { expectedTradingDate: "2026-08-27" });
  assert.equal(stale.usable, false);
  assert.equal(stale.status, "stale_cache_rejected");

  const future = assessCachedKlineProfile(completeProfile("2026-08-28"), { expectedTradingDate: "2026-08-27" });
  assert.equal(future.usable, false);
  assert.equal(future.status, "future_cache_rejected");

  const incomplete = completeProfile();
  incomplete.lastSession.completed = false;
  assert.equal(
    assessCachedKlineProfile(incomplete, { expectedTradingDate: "2026-08-27" }).status,
    "same_day_cache_incomplete",
  );
});

test("K线抓取优先正式市场缺口并把已有同日缓存的股票放到队尾", () => {
  const rows = [
    { code: "000001" },
    { code: "000002", previousLimitUpOnly: true },
    { code: "000003" },
    { code: "000004" },
    { code: "000005", previousLimitUpOnly: true },
    { code: "000006", previousLimitUpOnly: true },
  ];
  const cachedProfiles = {
    "000001": completeProfile("2026-08-27"),
    "000002": completeProfile("2026-08-26"),
    "000003": completeProfile("2026-08-26"),
    "000006": completeProfile("2026-08-27"),
  };
  const queue = prioritizeKlineProfileFetchRows(rows, {
    cachedProfiles,
    expectedTradingDate: "2026-08-27",
  });

  assert.deepEqual(
    queue.map((entry) => entry.stock.code),
    ["000003", "000004", "000001", "000002", "000005", "000006"],
  );
});

test("K线抓取可以改变请求顺序但必须保持候选输出原始顺序", async () => {
  const rows = [
    { code: "000001" },
    { code: "000002", previousLimitUpOnly: true },
    { code: "000003" },
    { code: "000004", previousLimitUpOnly: true },
  ];
  const seen = [];
  const stats = createKlineSourceStats();
  stats.deadlineAt = Date.now() + 10_000;
  const enriched = await enrichKlineProfiles(rows, stats, {
    expectedTradingDate: "2026-08-27",
    cachedProfiles: {
      "000001": completeProfile("2026-08-27"),
      "000002": completeProfile("2026-08-27"),
    },
    _fetchProfile: async (stock) => {
      seen.push(stock.code);
      return { marker: stock.code };
    },
  });

  assert.deepEqual(seen, ["000003", "000001", "000004", "000002"]);
  assert.deepEqual(enriched.map((row) => row.code), rows.map((row) => row.code));
  assert.deepEqual(enriched.map((row) => row.klineProfile.marker), rows.map((row) => row.code));
  assert.equal(enriched.some((row) => Object.hasOwn(row, "__klineOriginalIndex")), false);
});

test("周期历史缺失只关闭执行，已完整的收盘市场证据仍可用于首次安装积累", () => {
  const status = buildFetchStatus(fullFetchContext());
  const payload = {
    fetchedAt: "2026-08-27T07:10:00.000Z",
    updatedAt: "2026-08-27T07:10:00.000Z",
    asOf: "2026-08-27T07:10:00.000Z",
    tradingDate: "2026-08-27",
    generationId: "2026-08-27:2026-08-27T07:10:00.000Z",
    generationContext: {
      version: 1,
      tradingDate: "2026-08-27",
      asOf: "2026-08-27T07:10:00.000Z",
      generationId: "2026-08-27:2026-08-27T07:10:00.000Z",
    },
    market: { limitStats: { dates: { today: "20260827", prev: "20260826", verified: true } } },
    fetchStatus: { ...status, marketEvidenceStatus: "complete", evidenceStatus: "incomplete" },
    archiveMeta: { tradingDate: "2026-08-27", snapshotKind: "closing" },
  };
  const strict = strictExactClosingEvidence(payload, "2026-08-27");
  assert.equal(strict.ok, true);
  assert.equal(strict.fetchEvidenceQuality.marketOnly, true);
  assert.equal(resolveFetchEvidenceQuality(payload, "2026-08-27").closingEvidenceUsable, false);
});

test("百只以上正式样本仅缺1只非关键尾部票时保留缺口但不取消市场聚合", () => {
  const marketRows = Array.from({ length: 130 }, (_, index) => ({
    code: String(index + 1).padStart(6, "0"),
    name: `样本${index + 1}`,
    combinedRank: index + 1,
    inBothSources: index < 20,
    changePct: index === 129 ? -7.02 : 1,
    klineProfile: index === 129 ? null : completeProfile(),
    klineProfileLineage: index === 129
      ? { mode: "live_same_day_cache_incomplete", liveFetchFailed: true }
      : { mode: "live", source: "tencent" },
  }));
  const marketScope = summarizeKlineProfileScope(marketRows);
  const status = buildFetchStatus(fullFetchContext({
    total: marketRows.length,
    klineOk: marketScope.liveAccepted,
    klineRequested: marketScope.requested,
    klineLiveAccepted: marketScope.liveAccepted,
    klineEast: marketScope.east,
    klineTencent: marketScope.tencent,
    klineSameDayCache: marketScope.sameDayCache,
    klineUnavailable: marketScope.unavailable,
    klineUnavailableSamples: marketScope.unavailableSamples,
    klineCriticalUnavailable: marketScope.criticalUnavailable,
    klineLiveFailed: marketScope.fail,
    klineSupplemental: summarizeKlineProfileScope([]),
  }));

  assert.equal(marketScope.unavailable, 1);
  assert.equal(marketScope.criticalUnavailable, 0);
  assert.equal(status.mode, "live_bounded_coverage");
  assert.equal(status.kline.boundedCoverageAccepted, true);
  assert.equal(status.kline.coverageRatio >= 0.99, true);
  assert.equal(status.evidenceStatus, "complete");
  const quality = resolveFetchEvidenceQuality({ fetchStatus: status }, "2026-08-27");
  assert.equal(quality.closingEvidenceUsable, true);
  assert.equal(quality.boundedCoverageAccepted, true);
});

test("缺失前20热榜、双榜共振或极端反馈样本时仍严格关闭", () => {
  const rows = Array.from({ length: 130 }, (_, index) => ({
    code: String(index + 1).padStart(6, "0"),
    name: `样本${index + 1}`,
    combinedRank: index + 1,
    inBothSources: index === 9,
    changePct: 1,
    klineProfile: index === 9 ? null : completeProfile(),
    klineProfileLineage: index === 9
      ? { mode: "unavailable", liveFetchFailed: true }
      : { mode: "live", source: "tencent" },
  }));
  const scope = summarizeKlineProfileScope(rows);
  const status = buildFetchStatus(fullFetchContext({
    total: rows.length,
    klineOk: scope.liveAccepted,
    klineRequested: scope.requested,
    klineLiveAccepted: scope.liveAccepted,
    klineEast: scope.east,
    klineTencent: scope.tencent,
    klineUnavailable: scope.unavailable,
    klineUnavailableSamples: scope.unavailableSamples,
    klineCriticalUnavailable: scope.criticalUnavailable,
    klineLiveFailed: scope.fail,
    klineSupplemental: summarizeKlineProfileScope([]),
  }));

  assert.equal(scope.criticalUnavailable, 1);
  assert.equal(status.mode, "unavailable");
  assert.equal(status.kline.boundedCoverageAccepted, false);
  assert.equal(resolveFetchEvidenceQuality({ fetchStatus: status }, "2026-08-27").closingEvidenceUsable, false);
});

test("新股结构性短历史不会被登记成K线抓取失败", async () => {
  const stats = createKlineSourceStats();
  stats.deadlineAt = Date.now() + 10_000;
  const enriched = await enrichKlineProfiles([{ code: "920001", name: "N测试" }], stats, {
    _fetchProfile: async (stock) => {
      stock.klineStructuralExclusion = {
        reasonCode: "listing_history_below_profile_minimum",
        tradingDays: 1,
        requiredTradingDays: 3,
        marketEvidenceImpact: false,
        observationOnly: true,
        executionAuthority: false,
      };
      return null;
    },
  });

  assert.equal(stats.profileFailures || 0, 0);
  assert.equal(stats.structuralExcluded, 1);
  assert.equal(enriched[0].klineProfile, null);
  assert.equal(enriched[0].klineStructuralExclusion.reasonCode, "listing_history_below_profile_minimum");
});

test("全量同日缓存时源健康为partial，但收盘证据仍完整可用", () => {
  const status = buildFetchStatus(fullFetchContext({
    klineLiveAccepted: 0,
    klineTencent: 0,
    klineCached: 159,
    klineSameDayCache: 159,
    klineLiveFailed: 159,
    klineCacheTradingDates: { "2026-08-27": 159 },
  }));
  const kline = status.items.find((item) => item.name === "K线/均线");
  assert.equal(status.level, "partial");
  assert.equal(status.operationalLevel, "degraded");
  assert.equal(status.evidenceStatus, "complete");
  assert.equal(status.mode, "degraded_same_day_cache");
  assert.equal(kline.ok, true);
  assert.equal(kline.degraded, true);
  assert.doesNotMatch(status.label, /数据完整/);

  const payload = { fetchStatus: status, sources: { klineDiagnostics: { statusKey: status.mode } } };
  assert.equal(resolveFetchEvidenceQuality(payload, "2026-08-27").closingEvidenceUsable, true);
});

test("跨日或不完整覆盖不能借partial状态进入收盘证据链", () => {
  const status = buildFetchStatus(fullFetchContext({
    klineLiveAccepted: 0,
    klineTencent: 0,
    klineCached: 0,
    klineSameDayCache: 0,
    klineStaleCacheRejected: 159,
    klineUnavailable: 159,
    klineLiveFailed: 159,
  }));
  const kline = status.items.find((item) => item.name === "K线/均线");
  assert.equal(kline.ok, false);
  assert.equal(status.evidenceStatus, "incomplete");
  assert.equal(resolveFetchEvidenceQuality({ fetchStatus: status }, "2026-08-27").closingEvidenceUsable, false);
});

test("腾讯第一次失败后第二次成功，保留真实重试来源", async () => {
  let calls = 0;
  const rows = await fetchTencentKlineRows({ code: "603618" }, 2, {
    attempts: 2,
    _fetchJson: async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("transient"), { code: "ETIMEDOUT" });
      return {
        data: {
          sh603618: {
            qfqday: [
              ["2026-08-26", "30", "31", "32", "29", "1000"],
              ["2026-08-27", "31", "32", "33", "30", "1200"],
            ],
          },
        },
      };
    },
  });
  assert.equal(calls, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows.sourceMeta.status, "live_retry_success");
  assert.equal(rows.at(-1).date, "2026-08-27");
});

test("腾讯前复权端点失败时，未复权端点仅在无异常断层时提供可比较备用K线", async () => {
  const rows = await fetchTencentRawKlineRows({ code: "603618" }, 2, {
    _fetchJson: async () => ({
      data: {
        sh603618: {
          day: [
            ["2026-08-26", "31", "31.92", "31.92", "31", "1000"],
            ["2026-08-27", "33.5", "35.11", "35.11", "33.5", "1200"],
          ],
        },
      },
    }),
  });
  assert.equal(rows.length, 2);
  assert.equal(rows.sourceMeta.source, "tencent_raw");
  assert.equal(rows.sourceMeta.priceAdjustment, "none");
  assert.equal(rows.sourceMeta.trendComparable, true);

  const broken = await fetchTencentRawKlineRows({ code: "603618" }, 2, {
    _fetchJson: async () => ({
      data: { sh603618: { day: [
        ["2026-08-26", "31", "31", "31", "31", "1000"],
        ["2026-08-27", "10", "10", "10", "10", "1200"],
      ] } },
    }),
  });
  assert.equal(broken.sourceMeta.trendComparable, false);
  assert.equal(broken.sourceMeta.status, "live_unadjusted_incomparable");
});

test("K线阶段总deadline到期后不再访问外部源", async () => {
  const stats = createKlineSourceStats();
  stats.deadlineAt = Date.now() - 1;
  const startedAt = Date.now();
  const rows = await fetchKlineRows({ code: "603618" }, 120, stats);
  assert.equal(rows.length, 0);
  assert.equal(stats.deadlineExceeded, true);
  assert.equal(stats.fail, 1);
  assert.ok(Date.now() - startedAt < 300);
});

test("腾讯熔断不是永久关闭，半开探针成功后会恢复", () => {
  const stats = createKlineSourceStats();
  for (let index = 0; index < 12; index += 1) {
    recordKlineSourceFailure(stats, "tencent", new Error("fixture"), { code: `x${index}` });
  }
  assert.equal(stats.tencentDisabled, true);
  for (let index = 0; index < 15; index += 1) {
    assert.equal(klineCircuitShouldAttempt(stats, "tencent"), false);
  }
  assert.equal(klineCircuitShouldAttempt(stats, "tencent"), true);
  recordKlineSourceSuccess(stats, "tencent");
  assert.equal(stats.tencentDisabled, false);
  assert.equal(stats.tencentConsecutiveFailures, 0);
});
