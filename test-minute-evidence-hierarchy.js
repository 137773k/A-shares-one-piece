"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CANONICAL_MINUTE_HASH_SCOPE,
  CANONICAL_SEAL_HASH_SCOPE,
  computeMinuteContentHash,
  computeSealTickContentHash,
  validateMinutePriceEvidence,
  validateSealTickEvidence,
  selectMinuteEvidence,
} = require("./quant-decision/minute-evidence");
const { selectV7MinuteEvidenceFromCaches } = require("./quant-decision/outcome-evidence");

const TRADING_DATE = "2026-05-22";
const CODE = "000001";

function timeText(totalMinutes) {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function fullMinuteBars() {
  const minutes = [];
  for (let minute = 9 * 60 + 31; minute <= 11 * 60 + 30; minute += 1) minutes.push(minute);
  for (let minute = 13 * 60 + 1; minute <= 15 * 60; minute += 1) minutes.push(minute);
  return minutes.map((minute, index) => {
    const open = 10 + index / 10000;
    const close = open + 0.001;
    return {
      date: TRADING_DATE,
      time: timeText(minute),
      open,
      high: close + 0.002,
      low: open - 0.002,
      close,
      volume: 1000 + index,
      amount: (1000 + index) * close,
    };
  });
}

function minuteCandidate(provider, overrides = {}) {
  const bars = overrides.bars || fullMinuteBars();
  return {
    provider,
    source: provider === "jqdata" ? "jqdata_1m" : "akshare_sina_1m",
    code: CODE,
    tradingDate: TRADING_DATE,
    intervalMinutes: 1,
    priceMode: "raw_unadjusted",
    contentHashScope: CANONICAL_MINUTE_HASH_SCOPE,
    contentHash: computeMinuteContentHash(bars),
    bars,
    ...overrides,
  };
}

function sealTicks() {
  return Array.from({ length: 31 }, (_, second) => ({
    timestamp: `${TRADING_DATE} 10:00:${String(second).padStart(2, "0")}`,
    b1_p: 11,
    b1_v: 100000 - second * 1000,
  }));
}

function sealCandidate(overrides = {}) {
  const ticks = overrides.ticks || sealTicks();
  return {
    evidenceType: "seal_tick",
    provider: "broker_tick_archive",
    source: "broker_l2_tick",
    code: CODE,
    tradingDate: TRADING_DATE,
    quoteChangesIncluded: true,
    contentHashScope: CANONICAL_SEAL_HASH_SCOPE,
    contentHash: computeSealTickContentHash(ticks),
    ticks,
    ...overrides,
  };
}

test("Tier1 JQData优先于Tier2 AKShare，证据本身不授执行权", () => {
  const result = selectMinuteEvidence({
    code: CODE,
    tradingDate: TRADING_DATE,
    candidates: [minuteCandidate("akshare"), minuteCandidate("jqdata")],
  });
  assert.equal(result.selectedPriceEvidence.tier, 1);
  assert.equal(result.selectedPriceEvidence.classification, "jqdata_verified_raw_1m");
  assert.equal(result.capabilities.v7OneMinutePriceRules, true);
  assert.equal(result.capabilities.sealDecayThirtySecondRule, false);
  assert.equal(result.status, "price_ready_seal_evidence_missing");
  assert(result.blockers.includes("seal_tick_evidence_missing_no_proxy"));
  assert.equal(result.executionAuthority, false);
  assert.equal(result.selectedPriceEvidence.executionAuthority, false);
});

test("JQData校验失败时只允许降级到已验证AKShare 1分钟", () => {
  const jq = minuteCandidate("jqdata", { contentHash: "0".repeat(64) });
  const result = selectMinuteEvidence({
    code: CODE,
    tradingDate: TRADING_DATE,
    candidates: [jq, minuteCandidate("akshare")],
  });
  assert.equal(result.selectedPriceEvidence.tier, 2);
  assert.equal(result.selectedPriceEvidence.classification, "akshare_verified_raw_1m");
  assert(result.assessments[0].blockers.includes("minute_content_hash_mismatch"));
});

test("现有AKShare 5分钟只能用于旧版入场验证，不能冒充V7", () => {
  const bars = fullMinuteBars().filter((_, index) => index % 5 === 4);
  const legacy = {
    provider: "akshare",
    source: "akshare_sina_5m_unadjusted",
    code: CODE,
    tradingDate: TRADING_DATE,
    intervalMinutes: 5,
    priceMode: "raw_unadjusted",
    contentHash: computeMinuteContentHash(bars),
    bars,
  };
  const result = selectMinuteEvidence({ code: CODE, tradingDate: TRADING_DATE, candidates: [legacy] });
  assert.equal(result.selectedPriceEvidence, null);
  assert.equal(result.capabilities.legacyEntryValidationOnly, true);
  assert.equal(result.assessments[0].purpose, "legacy_entry_validation_only");
  assert(result.assessments[0].blockers.includes("legacy_5m_cannot_be_used_as_v7_1m_evidence"));
  assert(result.priceBlockers.includes("verified_raw_1m_price_evidence_missing"));
});

test("腾讯和普通价格序列始终只是观察证据", () => {
  const observation = {
    provider: "tencent_price_series",
    source: "tencent_qfq_daily_kline",
    code: CODE,
    tradingDate: TRADING_DATE,
    intervalMinutes: 1,
    bars: fullMinuteBars(),
  };
  const result = selectMinuteEvidence({ code: CODE, tradingDate: TRADING_DATE, candidates: [observation] });
  assert.equal(result.selectedPriceEvidence, null);
  assert.equal(result.capabilities.observationOnlyAvailable, true);
  assert.equal(result.assessments[0].purpose, "observation_only");
});

test("严格阻断证券、日期、interval和上层授权污染", () => {
  const candidate = minuteCandidate("jqdata", {
    code: "600000.XSHG",
    tradingDate: "2026-05-21",
    intervalMinutes: 2,
    source: "jqdata_1m",
    executionAuthority: true,
  });
  const assessed = validateMinutePriceEvidence(candidate, { code: CODE, tradingDate: TRADING_DATE });
  assert.equal(assessed.validForV7, false);
  assert(assessed.blockers.includes("evidence_security_mismatch"));
  assert(assessed.blockers.includes("evidence_trading_date_mismatch"));
  assert(assessed.blockers.includes("bar_interval_must_equal_1m"));
  assert(assessed.blockers.includes("minute_evidence_must_not_claim_execution_authority"));
  assert.equal(assessed.executionAuthority, false);

  const wrongExchange = minuteCandidate("jqdata", { code: "000001.XSHG" });
  const exchangeResult = validateMinutePriceEvidence(
    wrongExchange,
    { code: "000001.XSHE", tradingDate: TRADING_DATE },
  );
  assert(exchangeResult.blockers.includes("evidence_security_exchange_mismatch"));

  const bse = minuteCandidate("akshare", { code: "920001.XBEI" });
  const bseResult = validateMinutePriceEvidence(
    bse,
    { code: "920001.XBEI", tradingDate: TRADING_DATE },
  );
  assert.equal(bseResult.blockers.includes("evidence_security_exchange_mismatch"), false);
});

test("严格阻断乱序、午休K线、不真实OHLC和内容篡改", () => {
  const bars = fullMinuteBars();
  [bars[0], bars[1]] = [bars[1], bars[0]];
  bars[10] = { ...bars[10], time: "12:00" };
  bars[20] = { ...bars[20], high: bars[20].low - 1 };
  const candidate = minuteCandidate("akshare", { bars, contentHash: "f".repeat(64) });
  const assessed = validateMinutePriceEvidence(candidate, { code: CODE, tradingDate: TRADING_DATE });
  assert.equal(assessed.validForV7, false);
  assert(assessed.blockers.includes("bar_times_not_strictly_monotonic_or_duplicate"));
  assert(assessed.blockers.includes("illegal_lunch_or_session_bar_time"));
  assert(assessed.blockers.includes("ohlc_geometry_invalid"));
  assert(assessed.blockers.includes("minute_content_hash_mismatch"));
  assert(assessed.blockers.includes("incomplete_or_noncanonical_a_share_1m_session"));
});

test("缺失分钟或分钟不完整时失败关闭", () => {
  const missing = minuteCandidate("jqdata", { bars: [], contentHash: computeMinuteContentHash([]) });
  const missingResult = validateMinutePriceEvidence(missing, { code: CODE, tradingDate: TRADING_DATE });
  assert(missingResult.blockers.includes("one_minute_bars_missing"));
  assert.equal(missingResult.validForV7, false);

  const partialBars = fullMinuteBars().slice(0, 100);
  const partial = minuteCandidate("jqdata", {
    bars: partialBars,
    contentHash: computeMinuteContentHash(partialBars),
  });
  const partialResult = validateMinutePriceEvidence(partial, { code: CODE, tradingDate: TRADING_DATE });
  assert(partialResult.blockers.includes("incomplete_or_noncanonical_a_share_1m_session"));
  assert.equal(partialResult.validForV7, false);
});

test("缺成交额或全天零成交不能作为V7可执行分钟证据", () => {
  const missingAmountBars = fullMinuteBars().map(({ amount: _amount, ...row }) => row);
  const missingAmount = minuteCandidate("jqdata", {
    bars: missingAmountBars,
    contentHash: computeMinuteContentHash(missingAmountBars),
  });
  const missingAmountResult = validateMinutePriceEvidence(
    missingAmount,
    { code: CODE, tradingDate: TRADING_DATE },
  );
  assert.equal(missingAmountResult.validForV7, false);
  assert(missingAmountResult.blockers.includes("amount_missing_or_invalid"));

  const zeroTurnoverBars = fullMinuteBars().map((row) => ({ ...row, volume: 0, amount: 0 }));
  const zeroTurnover = minuteCandidate("jqdata", {
    bars: zeroTurnoverBars,
    contentHash: computeMinuteContentHash(zeroTurnoverBars),
  });
  const zeroTurnoverResult = validateMinutePriceEvidence(
    zeroTurnover,
    { code: CODE, tradingDate: TRADING_DATE },
  );
  assert.equal(zeroTurnoverResult.validForV7, false);
  assert(zeroTurnoverResult.blockers.includes("full_session_turnover_must_be_positive"));
});

test("原始价格口径和哈希作用域必须显式声明", () => {
  const withoutPriceMode = minuteCandidate("jqdata", { priceMode: undefined });
  const priceModeResult = validateMinutePriceEvidence(
    withoutPriceMode,
    { code: CODE, tradingDate: TRADING_DATE },
  );
  assert(priceModeResult.blockers.includes("raw_unadjusted_price_mode_required"));

  const withoutHashScope = minuteCandidate("jqdata", { contentHashScope: undefined });
  const hashScopeResult = validateMinutePriceEvidence(
    withoutHashScope,
    { code: CODE, tradingDate: TRADING_DATE },
  );
  assert(hashScopeResult.blockers.includes("minute_content_hash_scope_missing_or_mismatch"));
});

test("封单Tick独立校验，通过后也不授执行权", () => {
  const assessed = validateSealTickEvidence(sealCandidate(), { code: CODE, tradingDate: TRADING_DATE });
  assert.equal(assessed.status, "verified");
  assert.equal(assessed.evidenceType, "seal_tick");
  assert.equal(assessed.quoteChangesIncludedVerified, true);
  assert.equal(assessed.validationAuthority, "unified_minute_evidence_hierarchy_v1");
  assert.equal(assessed.validForSealRule, true);
  assert.equal(assessed.proxyUsed, false);
  assert.equal(assessed.executionAuthority, false);

  const result = selectMinuteEvidence({
    code: CODE,
    tradingDate: TRADING_DATE,
    candidates: [minuteCandidate("jqdata")],
    sealTickEvidence: sealCandidate(),
  });
  assert.equal(result.status, "price_and_seal_evidence_ready");
  assert.equal(result.capabilities.allRequestedEvidenceReady, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.executionAuthority, false);
});

test("封单Tick合法午休按时段分段，不计入快照最大间隔", () => {
  const seconds = [
    ...Array.from({ length: 31 }, (_, index) => 11 * 60 * 60 + 29 * 60 + 30 + index),
    ...Array.from({ length: 31 }, (_, index) => 13 * 60 * 60 + index),
  ];
  const ticks = seconds.map((total) => ({
    timestamp: `${TRADING_DATE} ${String(Math.floor(total / 3600)).padStart(2, "0")}:${String(Math.floor(total / 60) % 60).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`,
    b1_p: 11,
    b1_v: 100000 - total,
  }));
  const assessed = validateSealTickEvidence(
    sealCandidate({ ticks }),
    { code: CODE, tradingDate: TRADING_DATE },
  );
  assert.equal(assessed.status, "verified");
  assert.equal(assessed.validForSealRule, true);
  assert.equal(assessed.evidenceType, "seal_tick");
  assert.equal(assessed.quoteChangesIncludedVerified, true);
  assert.equal(assessed.validationAuthority, "unified_minute_evidence_hierarchy_v1");
  assert.equal(assessed.maxGapSeconds, 1);
  assert.equal(assessed.maxContinuousSpanSeconds, 30);
  assert.equal(assessed.legalSessionBreakCount, 1);
  assert(!assessed.blockers.includes("seal_tick_snapshot_gap_exceeds_5_seconds"));
});

test("封单Tick同一交易时段超过5秒仍失败关闭", () => {
  const seconds = [
    ...Array.from({ length: 31 }, (_, index) => index),
    ...Array.from({ length: 31 }, (_, index) => index + 37),
  ];
  const ticks = seconds.map((offset) => {
    const total = 10 * 60 * 60 + offset;
    return {
      timestamp: `${TRADING_DATE} ${String(Math.floor(total / 3600)).padStart(2, "0")}:${String(Math.floor(total / 60) % 60).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`,
      b1_p: 11,
      b1_v: 100000,
    };
  });
  const assessed = validateSealTickEvidence(
    sealCandidate({ ticks }),
    { code: CODE, tradingDate: TRADING_DATE },
  );
  assert.equal(assessed.validForSealRule, false);
  assert.equal(assessed.quoteChangesIncludedVerified, false);
  assert.equal(assessed.maxGapSeconds, 7);
  assert.equal(assessed.legalSessionBreakCount, 0);
  assert(assessed.blockers.includes("seal_tick_snapshot_gap_exceeds_5_seconds"));
});

test("11点30分与15点收盘后的秒级Tick不得冒充交易时段证据", () => {
  for (const start of ["11:30", "15:00"]) {
    const ticks = Array.from({ length: 31 }, (_, index) => ({
      timestamp: `${TRADING_DATE} ${start}:${String(index + 1).padStart(2, "0")}`,
      b1_p: 11,
      b1_v: 100000 - index,
    }));
    const assessed = validateSealTickEvidence(sealCandidate({
      ticks,
      contentHash: computeSealTickContentHash(ticks),
    }), { code: CODE, tradingDate: TRADING_DATE });
    assert.equal(assessed.validForSealRule, false);
    assert(assessed.blockers.includes("illegal_seal_tick_session_time"));
  }
});

test("一分钟K线即便带买一字段也不能代理封单Tick", () => {
  const proxy = {
    ...sealCandidate(),
    evidenceType: "seal_tick",
    provider: "akshare_minute_kline",
    source: "akshare_1m",
  };
  const assessed = validateSealTickEvidence(proxy, { code: CODE, tradingDate: TRADING_DATE });
  assert.equal(assessed.validForSealRule, false);
  assert.equal(assessed.proxyUsed, false);
  assert(assessed.blockers.includes("minute_or_price_series_cannot_proxy_seal_tick"));
});

test("JQData抓取缓存通过outcome入口接入Tier1而不改写旧5分钟链", () => {
  const bars = fullMinuteBars().map((row) => ({
    timestamp: `${row.date} ${row.time}:00`,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    money: row.amount,
  }));
  const cache = {
    authority: "jqdata_1m_execution_validation_v1",
    executionAuthority: false,
    provider: { name: "JQData", version: "1.9.8" },
    barIntervalMinutes: 1,
    priceMode: "raw_unadjusted",
    contentHashScope: CANONICAL_MINUTE_HASH_SCOPE,
    records: [{
      provider: "JQData",
      code: CODE,
      jqCode: `${CODE}.XSHE`,
      tradingDate: TRADING_DATE,
      barIntervalMinutes: 1,
      priceMode: "raw_unadjusted",
      validForV7: true,
      contentHashScope: CANONICAL_MINUTE_HASH_SCOPE,
      contentHash: computeMinuteContentHash(bars),
      bars,
    }],
  };
  const result = selectV7MinuteEvidenceFromCaches({
    code: `${CODE}.XSHE`,
    tradingDate: TRADING_DATE,
    caches: [cache],
  });
  assert.equal(result.selectedPriceEvidence.tier, 1);
  assert.equal(result.selectedPriceEvidence.classification, "jqdata_verified_raw_1m");
  assert.equal(result.capabilities.v7OneMinutePriceRules, true);
  assert.equal(result.executionAuthority, false);
});
