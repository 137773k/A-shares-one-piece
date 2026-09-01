"use strict";

const crypto = require("node:crypto");

const MINUTE_EVIDENCE_VERSION = 1;
const MINUTE_EVIDENCE_AUTHORITY = "unified_minute_evidence_hierarchy_v1";
const CANONICAL_MINUTE_HASH_SCOPE = "canonical_a_share_1m_ohlcv_v1";
const CANONICAL_SEAL_HASH_SCOPE = "canonical_seal_tick_bid1_v1";

const MINUTE_EVIDENCE_TIERS = Object.freeze({
  JQDATA_VERIFIED_RAW_1M: Object.freeze({
    tier: 1,
    id: "jqdata_verified_raw_1m",
    purpose: "v7_price_rule_evidence",
  }),
  AKSHARE_VERIFIED_RAW_1M: Object.freeze({
    tier: 2,
    id: "akshare_verified_raw_1m",
    purpose: "v7_price_rule_evidence",
  }),
  LEGACY_5M: Object.freeze({
    tier: null,
    id: "legacy_5m_entry_validation_only",
    purpose: "legacy_entry_validation_only",
  }),
  OBSERVATION: Object.freeze({
    tier: null,
    id: "price_series_observation_only",
    purpose: "observation_only",
  }),
});

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function normalizeCode(value) {
  const match = String(value || "").trim().toUpperCase().match(/(?:^|\D)(\d{6})(?:\D|$)/);
  return match ? match[1] : null;
}

function inferredExchange(code) {
  if (!code) return null;
  if (/^(?:4|8|92)/.test(code)) return "XBEI";
  if (/^[569]/.test(code)) return "XSHG";
  return "XSHE";
}

function explicitExchange(value) {
  const text = String(value || "").trim().toUpperCase();
  if (/\.XSHG$|^SH\d{6}$|\.SH$/.test(text)) return "XSHG";
  if (/\.XSHE$|^SZ\d{6}$|\.SZ$/.test(text)) return "XSHE";
  if (/\.XBEI$|^BJ\d{6}$|\.BJ$/.test(text)) return "XBEI";
  return null;
}

function securityIdentity(value) {
  const code = normalizeCode(value);
  const explicit = explicitExchange(value);
  const inferred = inferredExchange(code);
  return {
    code,
    exchange: explicit || inferred,
    exchangeConsistent: Boolean(code && (!explicit || explicit === inferred)),
  };
}

function normalizeTradingDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/(20\d{2})[-/]?(\d{2})[-/]?(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function timeParts(value, allowCompact = false) {
  const text = String(value || "").trim();
  let match = text.match(/(?:T|\s|^)([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (!match && allowCompact) match = text.match(/^([01]\d|2[0-3])([0-5]\d)$/);
  if (!match) return null;
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: Number(match[3] || 0),
    text: `${match[1]}:${match[2]}`,
  };
}

function extractStamp(row) {
  const dateValues = [row && row.timestamp, row && row.datetime, row && row.date, row && row.tradingDate];
  const timeValues = [row && row.timestamp, row && row.datetime, row && row.time, row && row.date];
  const date = dateValues.map(normalizeTradingDate).find(Boolean) || null;
  let time = null;
  for (const value of timeValues) {
    time = timeParts(value, value === (row && row.time));
    if (time) break;
  }
  return { date, time };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  );
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function canonicalMinuteBar(row) {
  const stamp = extractStamp(row || {});
  return {
    date: stamp.date,
    time: stamp.time && stamp.time.text || null,
    open: finiteNumber(row && row.open),
    high: finiteNumber(row && row.high),
    low: finiteNumber(row && row.low),
    close: finiteNumber(row && (row.close ?? row.price)),
    volume: finiteNumber(row && row.volume),
    amount: finiteNumber(row && (row.amount ?? row.money)),
  };
}

function computeMinuteContentHash(bars) {
  const rows = Array.isArray(bars) ? bars : [];
  return stableHash(rows.map(canonicalMinuteBar));
}

function canonicalSealTick(row) {
  const stamp = extractStamp(row || {});
  return {
    date: stamp.date,
    time: stamp.time
      ? `${stamp.time.text}:${String(stamp.time.second).padStart(2, "0")}`
      : null,
    bid1Price: finiteNumber(row && (row.b1_p ?? row.bid1Price)),
    bid1Volume: finiteNumber(row && (row.b1_v ?? row.bid1Volume)),
  };
}

function computeSealTickContentHash(ticks) {
  const rows = Array.isArray(ticks) ? ticks : [];
  return stableHash(rows.map(canonicalSealTick));
}

function intervalMinutesOf(candidate) {
  const direct = finiteNumber(candidate && (candidate.intervalMinutes ?? candidate.barIntervalMinutes));
  if (direct != null) return direct;
  const text = String(candidate && (candidate.interval ?? candidate.unit) || "").trim().toLowerCase();
  const match = text.match(/^(\d+)\s*(?:m|min|minute|分钟)?$/);
  return match ? Number(match[1]) : null;
}

function sourceTextOf(candidate) {
  return [
    candidate && candidate.provider,
    candidate && candidate.source,
    candidate && candidate.sourceId,
    candidate && candidate.authority,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join("|");
}

function classifyMinuteCandidate(candidate) {
  const sourceText = sourceTextOf(candidate);
  const sourceTokens = sourceText.split("|").filter(Boolean);
  const intervalMinutes = intervalMinutesOf(candidate);
  if (/tencent|price[_ -]?series|price[_ -]?sequence|observation/.test(sourceText)) {
    return MINUTE_EVIDENCE_TIERS.OBSERVATION;
  }
  if (intervalMinutes === 5 || /(?:^|[_| -])5m(?:[_| -]|$)/.test(sourceText)) {
    return MINUTE_EVIDENCE_TIERS.LEGACY_5M;
  }
  if (sourceTokens.some((token) => /^(?:jqdata|jqdatasdk|joinquant)(?:[_ -]|$)|^聚宽/.test(token))) {
    return MINUTE_EVIDENCE_TIERS.JQDATA_VERIFIED_RAW_1M;
  }
  if (sourceTokens.some((token) => /^akshare(?:[_ -]|$)/.test(token))) {
    return MINUTE_EVIDENCE_TIERS.AKSHARE_VERIFIED_RAW_1M;
  }
  return null;
}

function rawPriceMode(candidate) {
  let value;
  if (hasOwn(candidate, "priceMode")) value = candidate.priceMode;
  else if (hasOwn(candidate, "adjustment")) value = candidate.adjustment;
  else if (hasOwn(candidate, "adjust")) value = candidate.adjust;
  else return false;
  if (value == null) return false;
  return ["", "raw", "none", "unadjusted", "raw_unadjusted"].includes(
    String(value).trim().toLowerCase(),
  );
}

function minuteIndex(time) {
  return time ? time.hour * 60 + time.minute : null;
}

function expectedSessionMinutes(startMorning, startAfternoon) {
  const result = [];
  for (let value = startMorning; value < startMorning + 120; value += 1) result.push(value);
  for (let value = startAfternoon; value < startAfternoon + 120; value += 1) result.push(value);
  return result;
}

const CLOSE_STAMPED_SESSION = Object.freeze(expectedSessionMinutes(9 * 60 + 31, 13 * 60 + 1));
const OPEN_STAMPED_SESSION = Object.freeze(expectedSessionMinutes(9 * 60 + 30, 13 * 60));

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateMinutePriceEvidence(candidate, expected = {}) {
  const classification = classifyMinuteCandidate(candidate);
  const source = sourceTextOf(candidate) || "unknown";
  const intervalMinutes = intervalMinutesOf(candidate);
  const expectedCode = normalizeCode(expected.code);
  const expectedDate = normalizeTradingDate(expected.tradingDate);
  const candidateCode = normalizeCode(candidate && (candidate.code || candidate.security || candidate.symbol));
  const expectedSecurity = securityIdentity(expected.code);
  const candidateSecurity = securityIdentity(candidate && (candidate.code || candidate.security || candidate.symbol));
  const candidateDate = normalizeTradingDate(candidate && (candidate.tradingDate || candidate.date));

  if (classification === MINUTE_EVIDENCE_TIERS.LEGACY_5M) {
    return {
      source,
      classification: classification.id,
      purpose: classification.purpose,
      tier: null,
      intervalMinutes,
      validForV7: false,
      executionAuthority: false,
      blockers: ["legacy_5m_cannot_be_used_as_v7_1m_evidence"],
    };
  }
  if (classification === MINUTE_EVIDENCE_TIERS.OBSERVATION) {
    return {
      source,
      classification: classification.id,
      purpose: classification.purpose,
      tier: null,
      intervalMinutes,
      validForV7: false,
      executionAuthority: false,
      blockers: ["observation_price_series_cannot_be_used_as_v7_evidence"],
    };
  }

  const blockers = [];
  if (!classification) blockers.push("unsupported_minute_evidence_source");
  if (!expectedCode) blockers.push("expected_security_invalid");
  if (!candidateCode) blockers.push("evidence_security_missing_or_invalid");
  else if (expectedCode && candidateCode !== expectedCode) blockers.push("evidence_security_mismatch");
  if (!expectedSecurity.exchangeConsistent) blockers.push("expected_security_exchange_invalid");
  if (!candidateSecurity.exchangeConsistent) blockers.push("evidence_security_exchange_mismatch");
  else if (
    expectedSecurity.exchange
    && candidateSecurity.exchange
    && expectedSecurity.exchange !== candidateSecurity.exchange
  ) blockers.push("evidence_security_exchange_mismatch");
  if (!expectedDate) blockers.push("expected_trading_date_invalid");
  if (!candidateDate) blockers.push("evidence_trading_date_missing_or_invalid");
  else if (expectedDate && candidateDate !== expectedDate) blockers.push("evidence_trading_date_mismatch");
  if (intervalMinutes !== 1) blockers.push("bar_interval_must_equal_1m");
  if (/(?:^|[_| -])5m(?:[_| -]|$)/.test(source) && intervalMinutes === 1) {
    blockers.push("source_interval_conflict");
  }
  if (!rawPriceMode(candidate)) blockers.push("raw_unadjusted_price_mode_required");
  if (/qfq|hfq|adjusted|复权/.test(source) && !/unadjusted/.test(source)) {
    blockers.push("source_price_mode_conflict");
  }
  if (candidate && candidate.executionAuthority === true) {
    blockers.push("minute_evidence_must_not_claim_execution_authority");
  }
  if (
    candidate && candidate.verified === false
    || candidate && candidate.validForV7 === false
    || candidate && candidate.validation && candidate.validation.passed === false
  ) blockers.push("upstream_minute_verification_failed");

  const bars = Array.isArray(candidate && candidate.bars)
    ? candidate.bars
    : Array.isArray(candidate && candidate.minuteBars)
      ? candidate.minuteBars
      : Array.isArray(candidate && candidate.rows) ? candidate.rows : [];
  if (!bars.length) blockers.push("one_minute_bars_missing");

  const canonicalBars = bars.map(canonicalMinuteBar);
  const timeIndexes = [];
  let totalVolume = 0;
  let totalAmount = 0;
  for (let index = 0; index < bars.length; index += 1) {
    const row = bars[index];
    const canonical = canonicalBars[index];
    const stamp = extractStamp(row || {});
    if (!canonical.date) blockers.push("bar_trading_date_missing_or_invalid");
    else if (expectedDate && canonical.date !== expectedDate) blockers.push("bar_trading_date_mismatch");
    if (!stamp.time) blockers.push("bar_time_missing_or_invalid");
    else {
      if (stamp.time.second !== 0) blockers.push("bar_timestamp_not_minute_aligned");
      const minute = minuteIndex(stamp.time);
      timeIndexes.push(minute);
      const inMorning = minute >= 9 * 60 + 30 && minute <= 11 * 60 + 30;
      const inAfternoon = minute >= 13 * 60 && minute <= 15 * 60;
      if (!inMorning && !inAfternoon) blockers.push("illegal_lunch_or_session_bar_time");
    }
    const { open, high, low, close, volume, amount } = canonical;
    if (![open, high, low, close].every((value) => value != null && value > 0)) {
      blockers.push("ohlc_missing_or_nonpositive");
    } else if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
      blockers.push("ohlc_geometry_invalid");
    }
    if (volume == null || volume < 0) blockers.push("volume_missing_or_invalid");
    else totalVolume += volume;
    if (amount == null || amount < 0) blockers.push("amount_missing_or_invalid");
    else totalAmount += amount;
    const rowInterval = intervalMinutesOf(row);
    if (rowInterval != null && rowInterval !== 1) blockers.push("row_interval_conflicts_with_1m");
  }

  if (!(totalVolume > 0) || !(totalAmount > 0)) blockers.push("full_session_turnover_must_be_positive");

  if (timeIndexes.length) {
    const monotonic = timeIndexes.every((value, index) => index === 0 || value > timeIndexes[index - 1]);
    if (!monotonic) blockers.push("bar_times_not_strictly_monotonic_or_duplicate");
    if (!arraysEqual(timeIndexes, CLOSE_STAMPED_SESSION) && !arraysEqual(timeIndexes, OPEN_STAMPED_SESSION)) {
      blockers.push("incomplete_or_noncanonical_a_share_1m_session");
    }
  }

  const declaredHash = String(candidate && candidate.contentHash || "").trim().toLowerCase();
  const computedHash = computeMinuteContentHash(bars);
  if (!/^[a-f0-9]{64}$/.test(declaredHash)) blockers.push("minute_content_hash_missing_or_invalid");
  else if (declaredHash !== computedHash) blockers.push("minute_content_hash_mismatch");
  if (candidate && candidate.contentHashScope !== CANONICAL_MINUTE_HASH_SCOPE) {
    blockers.push("minute_content_hash_scope_missing_or_mismatch");
  }

  const uniqueBlockers = Array.from(new Set(blockers)).sort();
  const timestampConvention = arraysEqual(timeIndexes, CLOSE_STAMPED_SESSION)
    ? "BAR_END_ASIA_SHANGHAI"
    : arraysEqual(timeIndexes, OPEN_STAMPED_SESSION) ? "BAR_START_ASIA_SHANGHAI" : null;
  return {
    source,
    classification: classification && classification.id || "unsupported",
    purpose: classification && classification.purpose || "none",
    tier: classification && classification.tier || null,
    intervalMinutes,
    code: candidateCode,
    tradingDate: candidateDate,
    priceMode: rawPriceMode(candidate) ? "raw_unadjusted" : "invalid_or_missing",
    barCount: bars.length,
    contentHash: computedHash,
    contentHashScope: CANONICAL_MINUTE_HASH_SCOPE,
    timestampConvention,
    validForV7: Boolean(classification && classification.tier && uniqueBlockers.length === 0),
    executionAuthority: false,
    blockers: uniqueBlockers,
    bars: uniqueBlockers.length === 0 ? canonicalBars : [],
  };
}

function validateSealTickEvidence(candidate, expected = {}) {
  if (!candidate) {
    return {
      status: "missing",
      evidenceType: null,
      quoteChangesIncludedVerified: false,
      validationAuthority: MINUTE_EVIDENCE_AUTHORITY,
      validForSealRule: false,
      proxyUsed: false,
      executionAuthority: false,
      blockers: ["seal_tick_evidence_missing_no_proxy"],
    };
  }
  const blockers = [];
  const evidenceType = String(candidate.evidenceType || candidate.kind || "").trim().toLowerCase();
  const source = sourceTextOf(candidate) || "unknown";
  const expectedCode = normalizeCode(expected.code);
  const expectedDate = normalizeTradingDate(expected.tradingDate);
  const candidateCode = normalizeCode(candidate.code || candidate.security || candidate.symbol);
  const expectedSecurity = securityIdentity(expected.code);
  const candidateSecurity = securityIdentity(candidate.code || candidate.security || candidate.symbol);
  const candidateDate = normalizeTradingDate(candidate.tradingDate || candidate.date);
  if (evidenceType !== "seal_tick") blockers.push("seal_evidence_type_must_be_tick");
  if (/minute|kline|tencent|price[_ -]?series/.test(source)) {
    blockers.push("minute_or_price_series_cannot_proxy_seal_tick");
  }
  if (!candidateCode) blockers.push("seal_tick_security_missing_or_invalid");
  else if (expectedCode && candidateCode !== expectedCode) blockers.push("seal_tick_security_mismatch");
  if (!expectedSecurity.exchangeConsistent) blockers.push("expected_seal_security_exchange_invalid");
  if (!candidateSecurity.exchangeConsistent) blockers.push("seal_tick_security_exchange_mismatch");
  else if (
    expectedSecurity.exchange
    && candidateSecurity.exchange
    && expectedSecurity.exchange !== candidateSecurity.exchange
  ) blockers.push("seal_tick_security_exchange_mismatch");
  if (!candidateDate) blockers.push("seal_tick_trading_date_missing_or_invalid");
  else if (expectedDate && candidateDate !== expectedDate) blockers.push("seal_tick_trading_date_mismatch");
  if (candidate.executionAuthority === true) blockers.push("seal_evidence_must_not_claim_execution_authority");
  if (!(candidate.skip === false || candidate.quoteChangesIncluded === true)) {
    blockers.push("quote_only_order_book_changes_not_proven");
  }

  const ticks = Array.isArray(candidate.ticks) ? candidate.ticks : [];
  if (!ticks.length) blockers.push("seal_ticks_missing");
  const canonicalTicks = ticks.map(canonicalSealTick);
  let previousStamp = null;
  let firstStamp = null;
  let lastStamp = null;
  let maxGapSeconds = 0;
  let maxContinuousSpanSeconds = 0;
  let continuousSegmentStart = null;
  let previousSession = null;
  let legalSessionBreakCount = 0;
  const morningSessionEndSeconds = (11 * 60 + 30) * 60;
  const afternoonSessionStartSeconds = 13 * 60 * 60;
  const maxAllowedGapSeconds = 5;
  for (let index = 0; index < ticks.length; index += 1) {
    const row = ticks[index];
    const canonical = canonicalTicks[index];
    const stamp = extractStamp(row || {});
    if (!canonical.date) blockers.push("seal_tick_date_missing_or_invalid");
    else if (expectedDate && canonical.date !== expectedDate) blockers.push("seal_tick_date_mismatch");
    if (!stamp.time) {
      blockers.push("seal_tick_time_missing_or_invalid");
      continue;
    }
    const minute = minuteIndex(stamp.time);
    const inMorning = minute >= 9 * 60 + 25 && minute <= 11 * 60 + 30;
    const inAfternoon = minute >= 13 * 60 && minute <= 15 * 60;
    const afterSessionClosingSecond = (
      minute === 11 * 60 + 30 || minute === 15 * 60
    ) && stamp.time.second > 0;
    const session = inMorning ? "morning" : inAfternoon ? "afternoon" : null;
    if ((!inMorning && !inAfternoon) || afterSessionClosingSecond) {
      blockers.push("illegal_seal_tick_session_time");
    }
    const seconds = minute * 60 + stamp.time.second;
    if (previousStamp != null) {
      if (seconds <= previousStamp) blockers.push("seal_tick_times_not_strictly_monotonic_or_duplicate");
      else if (
        previousSession === "morning"
        && session === "afternoon"
        && previousStamp >= morningSessionEndSeconds - maxAllowedGapSeconds
        && previousStamp <= morningSessionEndSeconds + maxAllowedGapSeconds
        && seconds >= afternoonSessionStartSeconds
        && seconds <= afternoonSessionStartSeconds + maxAllowedGapSeconds
      ) {
        legalSessionBreakCount += 1;
        continuousSegmentStart = seconds;
      } else {
        const gapSeconds = seconds - previousStamp;
        maxGapSeconds = Math.max(maxGapSeconds, gapSeconds);
        if (gapSeconds > maxAllowedGapSeconds) continuousSegmentStart = seconds;
      }
    }
    if (continuousSegmentStart == null) continuousSegmentStart = seconds;
    maxContinuousSpanSeconds = Math.max(maxContinuousSpanSeconds, seconds - continuousSegmentStart);
    if (firstStamp == null) firstStamp = seconds;
    lastStamp = seconds;
    previousStamp = seconds;
    previousSession = session;
    if (!(canonical.bid1Price != null && canonical.bid1Price > 0)) blockers.push("bid1_price_missing_or_invalid");
    if (!(canonical.bid1Volume != null && canonical.bid1Volume >= 0)) blockers.push("bid1_volume_missing_or_invalid");
  }
  const spanSeconds = firstStamp != null && lastStamp != null ? lastStamp - firstStamp : 0;
  if (maxContinuousSpanSeconds < 30) blockers.push("seal_tick_span_below_30_seconds");
  if (maxGapSeconds > maxAllowedGapSeconds) blockers.push("seal_tick_snapshot_gap_exceeds_5_seconds");

  const declaredHash = String(candidate.contentHash || "").trim().toLowerCase();
  const computedHash = computeSealTickContentHash(ticks);
  if (!/^[a-f0-9]{64}$/.test(declaredHash)) blockers.push("seal_tick_content_hash_missing_or_invalid");
  else if (declaredHash !== computedHash) blockers.push("seal_tick_content_hash_mismatch");
  if (candidate.contentHashScope !== CANONICAL_SEAL_HASH_SCOPE) {
    blockers.push("seal_tick_content_hash_scope_missing_or_mismatch");
  }

  const uniqueBlockers = Array.from(new Set(blockers)).sort();
  const validForSealRule = uniqueBlockers.length === 0;
  return {
    status: uniqueBlockers.length ? "invalid" : "verified",
    evidenceType: evidenceType === "seal_tick" ? "seal_tick" : evidenceType || null,
    quoteChangesIncludedVerified: Boolean(validForSealRule
      && (candidate.skip === false || candidate.quoteChangesIncluded === true)),
    validationAuthority: MINUTE_EVIDENCE_AUTHORITY,
    source,
    code: candidateCode,
    tradingDate: candidateDate,
    tickCount: ticks.length,
    spanSeconds,
    maxContinuousSpanSeconds,
    maxGapSeconds,
    legalSessionBreakCount,
    maxAllowedGapSeconds,
    contentHash: computedHash,
    contentHashScope: CANONICAL_SEAL_HASH_SCOPE,
    validForSealRule,
    proxyUsed: false,
    executionAuthority: false,
    blockers: uniqueBlockers,
    ticks: uniqueBlockers.length === 0 ? canonicalTicks : [],
  };
}

function selectMinuteEvidence(input = {}) {
  const expected = { code: input.code, tradingDate: input.tradingDate };
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const assessments = candidates.map((candidate) => validateMinutePriceEvidence(candidate, expected));
  const eligible = assessments.filter((row) => row.validForV7).sort((left, right) => (
    left.tier - right.tier || left.source.localeCompare(right.source) || left.contentHash.localeCompare(right.contentHash)
  ));
  const selected = eligible[0] || null;

  const sealCandidates = Array.isArray(input.sealTickEvidence)
    ? input.sealTickEvidence
    : input.sealTickEvidence ? [input.sealTickEvidence] : [];
  const sealAssessments = sealCandidates.length
    ? sealCandidates.map((candidate) => validateSealTickEvidence(candidate, expected))
    : [validateSealTickEvidence(null, expected)];
  const sealEvidence = sealAssessments.find((row) => row.validForSealRule) || sealAssessments[0];

  const priceBlockers = selected ? [] : ["verified_raw_1m_price_evidence_missing"];
  const sealBlockers = sealEvidence.validForSealRule ? [] : sealEvidence.blockers;
  const blockers = Array.from(new Set([...priceBlockers, ...sealBlockers])).sort();
  const legacy = assessments.filter((row) => row.purpose === "legacy_entry_validation_only");
  const observations = assessments.filter((row) => row.purpose === "observation_only");
  const status = selected
    ? sealEvidence.validForSealRule ? "price_and_seal_evidence_ready" : "price_ready_seal_evidence_missing"
    : "price_evidence_blocked";

  return {
    version: MINUTE_EVIDENCE_VERSION,
    authority: MINUTE_EVIDENCE_AUTHORITY,
    executionAuthority: false,
    code: normalizeCode(input.code),
    tradingDate: normalizeTradingDate(input.tradingDate),
    status,
    selectedPriceEvidence: selected,
    sealTickEvidence: sealEvidence,
    capabilities: {
      v7OneMinutePriceRules: Boolean(selected),
      sealDecayThirtySecondRule: Boolean(sealEvidence.validForSealRule),
      legacyEntryValidationOnly: legacy.length > 0,
      observationOnlyAvailable: observations.length > 0,
      allRequestedEvidenceReady: Boolean(selected && sealEvidence.validForSealRule),
    },
    blockers,
    priceBlockers,
    sealBlockers,
    assessments,
    sealAssessments,
    rules: {
      hierarchy: [
        MINUTE_EVIDENCE_TIERS.JQDATA_VERIFIED_RAW_1M.id,
        MINUTE_EVIDENCE_TIERS.AKSHARE_VERIFIED_RAW_1M.id,
      ],
      legacy5mPurpose: MINUTE_EVIDENCE_TIERS.LEGACY_5M.purpose,
      observationPurpose: MINUTE_EVIDENCE_TIERS.OBSERVATION.purpose,
      sealEvidencePolicy: "separate_tick_only_missing_no_proxy",
      permissionPolicy: "evidence_never_grants_execution_authority",
    },
  };
}

module.exports = {
  MINUTE_EVIDENCE_VERSION,
  MINUTE_EVIDENCE_AUTHORITY,
  CANONICAL_MINUTE_HASH_SCOPE,
  CANONICAL_SEAL_HASH_SCOPE,
  MINUTE_EVIDENCE_TIERS,
  normalizeCode,
  securityIdentity,
  normalizeTradingDate,
  canonicalMinuteBar,
  canonicalSealTick,
  computeMinuteContentHash,
  computeSealTickContentHash,
  classifyMinuteCandidate,
  validateMinutePriceEvidence,
  validateSealTickEvidence,
  selectMinuteEvidence,
};
