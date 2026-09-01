"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveFetchEvidenceQuality } = require("./fetch-evidence-quality");
const { UNIFIED_QUANT_FACTORS_VERSION } = require("./unified-quant-factors");
const { buildMarketEffectAttribution } = require("./market-effect-attribution");
const { rebuildMarketCapCarrierPayload } = require("./market-cap-carrier");
const { buildExecutionReplay } = require("./quant-decision/execution-replay");
const {
  normalizeTradingDate,
  candidateCode,
  buildOutcome,
  loadOutcomeCache,
  mergeOutcomeCaches,
  buildKlineOutcome,
  resolveOutcome,
  minuteBarsForOutcomeCache,
} = require("./quant-decision/outcome-evidence");
const {
  UNIFIED_DECISION_CHAIN_VERSION,
  MAX_RESULT_STOCKS,
} = require("./quant-decision/decision-chain");
const { _internals } = require("./server");
const { auditDecisionReceiptSnapshots } = require("./quant-decision/decision-receipt-audit");
const { validateDecisionOutcome } = require("./quant-decision/decision-outcome");

const PRICE_INTEGRITY_TOLERANCE_PCT = 1;
const MIN_DIRECTIONAL_DAYS = 10;
const MIN_CONFIRMATION_DAYS = 30;
const FIXED_RANKING_SIZES = Object.freeze([1, 3, 5]);
const PRIMARY_RANKING_SIZE = 3;
const STRICT_SELECTION_AUTHORITY = "unified_decision_chain_v3";

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) { return null; }
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(...values) {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number != null && number > 0) return number;
  }
  return null;
}

function round(value, digits = 2) {
  const number = finiteNumber(value);
  if (number == null) return null;
  const scale = 10 ** digits;
  return Math.round(number * scale) / scale;
}

function snapshotTradingDate(snapshot) {
  const providerDate = normalizeTradingDate(
    snapshot && snapshot.market && snapshot.market.limitStats
    && snapshot.market.limitStats.dates && snapshot.market.limitStats.dates.today,
  );
  const archiveDate = normalizeTradingDate(snapshot && snapshot.archiveMeta && snapshot.archiveMeta.tradingDate);
  const generationDate = normalizeTradingDate(snapshot && snapshot.tradingDate);
  const marketDate = normalizeTradingDate(snapshot && snapshot.market && snapshot.market.snapshot && snapshot.market.snapshot.tradingDate);
  const conflict = Boolean(providerDate && archiveDate && providerDate !== archiveDate);
  return {
    date: providerDate || archiveDate || generationDate || marketDate,
    source: providerDate
      ? "market.limitStats.dates.today"
      : archiveDate
        ? "archiveMeta.tradingDate"
        : generationDate
          ? "tradingDate"
          : marketDate
            ? "market.snapshot.tradingDate"
            : "missing",
    providerDate,
    archiveDate,
    conflict,
  };
}

function snapshotTimestamp(snapshot) {
  const candidates = [
    snapshot && snapshot.archiveMeta && snapshot.archiveMeta.archivedAt,
    snapshot && snapshot.archiveMeta && snapshot.archiveMeta.asOf,
    snapshot && snapshot.updatedAt,
    snapshot && snapshot.fetchedAt,
  ];
  for (const value of candidates) {
    const timestamp = Date.parse(String(value || ""));
    if (Number.isFinite(timestamp)) return { value: new Date(timestamp).toISOString(), timestamp };
  }
  return { value: null, timestamp: null };
}

function snapshotKind(snapshot, tradingDate) {
  const explicit = String(snapshot && snapshot.archiveMeta && snapshot.archiveMeta.snapshotKind || "").trim();
  if (explicit === "closing" || explicit === "intraday") {
    return { kind: explicit, source: "archiveMeta.snapshotKind" };
  }
  const timestamp = snapshotTimestamp(snapshot).timestamp;
  const closeTimestamp = tradingDate ? Date.parse(`${tradingDate}T07:00:00.000Z`) : NaN;
  if (Number.isFinite(timestamp) && Number.isFinite(closeTimestamp) && timestamp >= closeTimestamp) {
    return { kind: "closing", source: "inferred_timestamp_after_cn_close" };
  }
  return { kind: "unknown", source: "missing" };
}

function shanghaiDateTime(value) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function exactClosingRankMetadata(snapshot, tradingDate) {
  const hotRanks = snapshot && snapshot.sources && snapshot.sources.hotRanks;
  const rows = hotRanks && typeof hotRanks === "object"
    ? [hotRanks.eastmoney, hotRanks.ths] : [];
  return rows.length === 2 && rows.every((row) => (
    row && row.complete === true
    && normalizeTradingDate(row.tradingDate) === tradingDate
    && normalizeTradingDate(row.marketDataTradingDate || row.tradingDate) === tradingDate
    && String(row.snapshotKind || "").toLowerCase() === "closing"
  ));
}

function migrateHistoricalClosingSnapshot(record) {
  const snapshot = record && record.snapshot;
  const tradingDate = normalizeTradingDate(record && record.tradingDate);
  const timestamp = snapshotTimestamp(snapshot);
  const clock = shanghaiDateTime(timestamp.value);
  const fetchEvidenceQuality = resolveFetchEvidenceQuality(snapshot, tradingDate);
  const blockers = [
    !snapshot || typeof snapshot !== "object" ? "snapshot_missing" : null,
    !tradingDate ? "trading_date_missing" : null,
    record && record.snapshotKind !== "closing" ? "snapshot_not_closing" : null,
    !fetchEvidenceQuality.closingEvidenceUsable ? "fetch_evidence_unusable" : null,
    !Array.isArray(snapshot && snapshot.candidates) || !snapshot.candidates.length
      ? "candidate_roster_missing" : null,
    !exactClosingRankMetadata(snapshot, tradingDate) ? "exact_closing_rank_metadata_missing" : null,
    !clock || clock.date !== tradingDate || clock.minute < 15 * 60
      ? "same_day_after_close_timestamp_missing" : null,
  ].filter(Boolean);
  if (blockers.length) {
    return {
      eligible: false,
      tradingDate,
      fileName: record && record.fileName || null,
      blockers,
      executionAuthority: false,
      payload: null,
    };
  }

  const payload = deepClone(snapshot);
  const asOf = timestamp.value;
  const generationId = `${tradingDate}:${asOf}`;
  const generationContext = Object.freeze({
    version: 1,
    tradingDate,
    asOf,
    generationId,
  });
  payload.updatedAt = asOf;
  payload.fetchedAt = asOf;
  payload.asOf = asOf;
  payload.tradingDate = tradingDate;
  payload.generationId = generationId;
  payload.generationContext = generationContext;
  payload.archiveMeta = {
    ...(payload.archiveMeta && typeof payload.archiveMeta === "object" ? payload.archiveMeta : {}),
    tradingDate,
    snapshotKind: "closing",
    asOf,
    archivedAt: asOf,
    generationId,
    generationContext,
    validationMigrationOnly: true,
  };
  if (!payload.market || typeof payload.market !== "object") payload.market = {};
  if (!payload.market.snapshot || typeof payload.market.snapshot !== "object") payload.market.snapshot = {};
  payload.market.snapshot.tradingDate = tradingDate;
  delete payload.decisionBasis;
  payload.themeLibrary = _internals.themeLibrarySnapshotFromPayload(
    payload,
    "historical-validation-reconstruction",
    { forceRebuild: true, generationContext },
  );
  _internals.applyThemeCycleIdentitiesToCandidates(payload);
  rebuildMarketCapCarrierPayload(payload);
  payload.validationMigration = {
    version: 1,
    authority: "historical_validation_reconstruction_v1",
    executionAuthority: false,
    provenance: "legacy_snapshot_counterfactual_envelope",
    asDecided: false,
    sourceFile: record.fileName,
    sourceTradingDate: tradingDate,
    sourceTimestamp: timestamp.value,
    exactClosingRankMetadata: true,
    syntheticMarketFacts: false,
    rewrittenFields: [
      "generation envelope",
      "archive closing identity",
      "theme library current-version projection",
      "market-cap carrier projection",
    ],
    rule: "只重建契约和同日派生字段，不添加或修改市场价格、涨跌、成交、候选成员与T+1结果",
  };
  return {
    eligible: true,
    tradingDate,
    fileName: record.fileName,
    blockers: [],
    executionAuthority: false,
    payload,
    audit: payload.validationMigration,
  };
}

function buildHistoricalMigrationAudit(records) {
  const migrations = (Array.isArray(records) ? records : []).map(migrateHistoricalClosingSnapshot);
  const byDate = new Map(migrations.map((row) => [row.tradingDate, row]));
  const replayByDate = new Map();
  const days = [];
  migrations.filter((row) => row.eligible).forEach((migration) => {
    const sourceRecord = records.find((record) => record.tradingDate === migration.tradingDate);
    const previousDate = exactPreviousTradingDate(sourceRecord && sourceRecord.snapshot);
    const previousMigration = byDate.get(previousDate);
    const previousReplay = replayByDate.get(previousDate);
    const previousPayload = previousReplay && previousReplay.payload
      || previousMigration && previousMigration.payload
      || null;
    const previousPreviousDate = previousPayload && exactPreviousTradingDate(previousPayload);
    const previousPreviousReplay = replayByDate.get(previousPreviousDate);
    const previousPreviousMigration = byDate.get(previousPreviousDate);
    const previousPreviousPayload = previousPreviousReplay && previousPreviousReplay.payload
      || previousPreviousMigration && previousPreviousMigration.payload
      || null;
    let payload = null;
    let validation = null;
    let error = null;
    try {
      payload = replayHistoricalCounterfactualDecision(
        migration.payload,
        previousPayload,
        previousPreviousPayload,
        false,
      );
      validation = validateCounterfactualDecisionReplay(payload, migration.tradingDate, previousDate);
    } catch (caught) {
      error = String(caught && caught.message || caught);
    }
    const blockers = validation && Array.isArray(validation.blockers)
      ? validation.blockers : error ? ["historical_validation_replay_failed"] : [];
    const row = {
      tradingDate: migration.tradingDate,
      sourceFile: migration.fileName,
      previousTradingDate: previousDate,
      envelopeEligible: true,
      reconstructionReady: validation && validation.replayReady === true,
      provenance: "counterfactual_current_engine_replay",
      asDecided: false,
      executionAuthority: false,
      blockers,
      error,
      payload,
    };
    replayByDate.set(migration.tradingDate, row);
    days.push({ ...row, payload: undefined });
  });
  const rejectedReasonCounts = migrations.filter((row) => !row.eligible).reduce((acc, row) => {
    row.blockers.forEach((reason) => { acc[reason] = Number(acc[reason] || 0) + 1; });
    return acc;
  }, {});
  const replayBlockerCounts = days.reduce((acc, row) => {
    row.blockers.forEach((reason) => { acc[reason] = Number(acc[reason] || 0) + 1; });
    return acc;
  }, {});
  return {
    version: 1,
    authority: "historical_validation_reconstruction_v1",
    executionAuthority: false,
    provenance: "counterfactual_current_engine_replay",
    asDecided: false,
    sourceSnapshotCount: migrations.length,
    envelopeEligibleCount: migrations.filter((row) => row.eligible).length,
    envelopeRejectedCount: migrations.filter((row) => !row.eligible).length,
    reconstructionReadyCount: days.filter((row) => row.reconstructionReady).length,
    rejectedReasonCounts,
    replayBlockerCounts,
    rejected: migrations.filter((row) => !row.eligible).map((row) => ({
      tradingDate: row.tradingDate,
      sourceFile: row.fileName,
      blockers: row.blockers,
    })),
    days,
    rule: "迁移只重建契约外壳与同日派生字段；无法从原始快照证明的T-1情绪初始状态保持不可用，不以迁移结果授予执行权",
  };
}

function loadHistoricalSnapshots(historyDir) {
  const files = fs.readdirSync(historyDir)
    .filter((name) => /^20\d{2}-\d{2}-\d{2}\.json$/.test(name))
    .sort();
  const records = [];
  const rejected = [];

  for (const fileName of files) {
    const filePath = path.join(historyDir, fileName);
    try {
      const snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const trading = snapshotTradingDate(snapshot);
      const kind = snapshotKind(snapshot, trading.date);
      const timestamp = snapshotTimestamp(snapshot);
      const record = {
        fileName,
        fileDate: fileName.slice(0, 10),
        filePath,
        snapshot,
        tradingDate: trading.date,
        tradingDateSource: trading.source,
        providerDate: trading.providerDate,
        archiveDate: trading.archiveDate,
        tradingDateConflict: trading.conflict,
        snapshotKind: kind.kind,
        snapshotKindSource: kind.source,
        archivedAt: timestamp.value,
        archivedAtTimestamp: timestamp.timestamp,
        decisionReceiptStatus: snapshot && snapshot.decisionReceipt
          ? String(snapshot.decisionReceipt.status || "invalid")
          : "legacy_without_receipt",
      };
      if (!record.tradingDate) {
        rejected.push({ fileName, reason: "missing_trading_date" });
      } else if (record.tradingDateConflict) {
        rejected.push({ fileName, reason: "provider_archive_date_conflict" });
      } else if (record.fileDate !== record.tradingDate) {
        rejected.push({
          fileName,
          fileDate: record.fileDate,
          tradingDate: record.tradingDate,
          reason: "filename_trading_date_mismatch",
        });
      } else if (record.snapshotKind !== "closing") {
        rejected.push({ fileName, tradingDate: record.tradingDate, reason: `snapshot_kind_${record.snapshotKind}` });
      } else {
        records.push(record);
      }
    } catch (error) {
      rejected.push({ fileName, reason: "json_parse_failed", detail: String(error && error.message || error) });
    }
  }

  const duplicateDates = new Map();
  records.forEach((record) => {
    if (!duplicateDates.has(record.tradingDate)) duplicateDates.set(record.tradingDate, []);
    duplicateDates.get(record.tradingDate).push(record);
  });
  const duplicateFileNames = new Set();
  for (const [tradingDate, duplicates] of duplicateDates.entries()) {
    if (duplicates.length < 2) continue;
    duplicates.forEach((record) => {
      duplicateFileNames.add(record.fileName);
      rejected.push({
        fileName: record.fileName,
        tradingDate,
        reason: "duplicate_trading_date_snapshot",
        conflictingFiles: duplicates.map((item) => item.fileName).sort(),
      });
    });
  }
  if (duplicateFileNames.size) {
    for (let index = records.length - 1; index >= 0; index -= 1) {
      if (duplicateFileNames.has(records[index].fileName)) records.splice(index, 1);
    }
  }
  records.sort((a, b) => a.tradingDate.localeCompare(b.tradingDate));
  return { files, records, rejected };
}

function exactPreviousTradingDate(snapshot) {
  return normalizeTradingDate(
    snapshot && snapshot.market && snapshot.market.limitStats
    && snapshot.market.limitStats.dates && snapshot.market.limitStats.dates.prev,
  );
}

function nextMarketOpenTimestamp(tradingDate) {
  return Date.parse(`${tradingDate}T01:30:00.000Z`);
}

function buildExactT1Pairs(records) {
  const grouped = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const date = normalizeTradingDate(record && record.tradingDate);
    if (!date) return;
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date).push(record);
  });
  const duplicateDates = new Set(
    Array.from(grouped.entries()).filter(([, values]) => values.length > 1).map(([date]) => date),
  );
  const byDate = new Map(
    Array.from(grouped.entries()).filter(([, values]) => values.length === 1).map(([date, values]) => [date, values[0]]),
  );
  const pairs = [];
  const unmatched = [];

  for (const next of (Array.isArray(records) ? records : [])) {
    if (duplicateDates.has(next.tradingDate)) {
      unmatched.push({
        tradingDate: next.tradingDate,
        fileName: next.fileName,
        reason: "duplicate_trading_date_snapshot",
      });
      continue;
    }
    const previousDate = exactPreviousTradingDate(next.snapshot);
    if (!previousDate) {
      unmatched.push({ tradingDate: next.tradingDate, fileName: next.fileName, reason: "next_snapshot_missing_provider_prev_date" });
      continue;
    }
    const current = byDate.get(previousDate);
    if (!current) {
      unmatched.push({ tradingDate: next.tradingDate, expectedPreviousDate: previousDate, fileName: next.fileName, reason: "exact_previous_closing_snapshot_missing" });
      continue;
    }
    const nextOpen = nextMarketOpenTimestamp(next.tradingDate);
    const backtestFeatureSafe = Number.isFinite(current.archivedAtTimestamp)
      ? current.archivedAtTimestamp < nextOpen
      : false;
    pairs.push({
      current,
      next,
      currentDate: current.tradingDate,
      nextDate: next.tradingDate,
      exactProviderLink: true,
      backtestFeatureSafe,
      backtestSafetyReason: backtestFeatureSafe
        ? "current_snapshot_archived_before_exact_t1_open"
        : "archive_time_missing_or_not_before_exact_t1_open",
    });
  }

  return { pairs, unmatched };
}

function average(values) {
  const usable = values.map(finiteNumber).filter((value) => value != null);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function median(values) {
  const usable = values.map(finiteNumber).filter((value) => value != null).sort((a, b) => a - b);
  if (!usable.length) return null;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
}

function summarizeOutcomeRows(rows) {
  const validRows = rows.filter((row) => row && row.outcome && row.outcome.valid);
  const closeValues = validRows.map((row) => row.outcome.closePct);
  const adverseValues = validRows.map((row) => row.outcome.adversePct).filter((value) => finiteNumber(value) != null);
  const decisionDays = new Set(validRows.map((row) => row.tradingDate)).size;
  return {
    outcomeCount: validRows.length,
    decisionDays,
    investedDecisionDays: new Set(validRows.filter((row) => Number(row.investedPortfolioPct || 0) > 0).map((row) => row.tradingDate)).size,
    cashDecisionDays: new Set(validRows.filter((row) => row.cashOnly === true).map((row) => row.tradingDate)).size,
    invalidDecisionDays: new Set(rows.filter((row) => row && row.valid === false).map((row) => row.tradingDate)).size,
    invalidContractDays: new Set(rows.filter((row) => row && row.valid === false && row.cashOnly === true).map((row) => row.tradingDate)).size,
    invalidOutcomeDays: new Set(rows.filter((row) => row && row.valid === false && row.cashOnly !== true).map((row) => row.tradingDate)).size,
    meanInvestedPortfolioPct: round(average(validRows.map((row) => row.investedPortfolioPct)), 4),
    meanClosePct: round(average(closeValues), 4),
    medianClosePct: round(median(closeValues), 4),
    winRatePct: validRows.length
      ? round(validRows.filter((row) => Number(row.outcome.closePct) > 0).length / validRows.length * 100, 2)
      : null,
    meanGapPct: round(average(validRows.map((row) => row.outcome.gapPct)), 4),
    meanHighPct: round(average(validRows.map((row) => row.outcome.highPct)), 4),
    meanAdversePct: round(average(adverseValues), 4),
    worstAdversePct: adverseValues.length ? round(Math.min(...adverseValues), 4) : null,
    meanOpenToClosePct: round(average(validRows.map((row) => row.outcome.openToClosePct)), 4),
    interpretationStatus: decisionDays >= MIN_DIRECTIONAL_DAYS ? "descriptive_only" : "insufficient_sample",
  };
}

function buildPortfolioRow(tradingDate, nextDate, picks, outcomeByCode, targetSize) {
  const target = picks.slice(0, Math.min(targetSize, picks.length));
  if (!target.length) return null;
  const outcomes = target.map((pick) => outcomeByCode.get(candidateCode(pick)));
  const valid = outcomes.every((outcome) => outcome && outcome.valid);
  if (!valid) {
    return {
      tradingDate,
      nextDate,
      requestedSize: targetSize,
      holdingCount: target.length,
      codes: target.map(candidateCode),
      valid: false,
      reason: "portfolio_outcome_coverage_incomplete",
    };
  }
  const metric = (key) => round(average(outcomes.map((outcome) => outcome[key])), 4);
  return {
    tradingDate,
    nextDate,
    requestedSize: targetSize,
    holdingCount: target.length,
    codes: target.map(candidateCode),
    valid: true,
    outcome: {
      valid: true,
      closePct: metric("closePct"),
      gapPct: metric("gapPct"),
      highPct: metric("highPct"),
      adversePct: metric("adversePct"),
      openToClosePct: metric("openToClosePct"),
    },
  };
}

function buildAllocatedPortfolioRow(tradingDate, nextDate, stocks, outcomeByCode, targetSize, options = {}) {
  const target = (Array.isArray(stocks) ? stocks : []).slice(0, Math.min(targetSize, MAX_RESULT_STOCKS));
  if (!options.contractReady) {
    return {
      tradingDate,
      nextDate,
      requestedSize: targetSize,
      holdingCount: 0,
      codes: [],
      valid: false,
      cashOnly: true,
      investedPortfolioPct: 0,
      cashReservePct: 100,
      reason: options.reason || "strict_decision_contract_not_ready",
      outcome: { valid: false, closePct: 0, gapPct: 0, highPct: 0, adversePct: 0, openToClosePct: 0 },
    };
  }
  if (!target.length) {
    return {
      tradingDate,
      nextDate,
      requestedSize: targetSize,
      holdingCount: 0,
      codes: [],
      valid: true,
      cashOnly: true,
      investedPortfolioPct: 0,
      cashReservePct: 100,
      outcome: { valid: true, closePct: 0, gapPct: 0, highPct: 0, adversePct: 0, openToClosePct: 0 },
    };
  }
  const allocations = target.map((stock) => finiteNumber(
    stock && stock.positionAllocation && stock.positionAllocation.initialPortfolioPct,
  ));
  const outcomes = target.map((stock) => outcomeByCode.get(candidateCode(stock)));
  const investedPortfolioPct = allocations.reduce((sum, value) => sum + Number(value || 0), 0);
  if (allocations.some((value) => value == null || value < 0 || value > 100) || investedPortfolioPct > 100.001) {
    return {
      tradingDate,
      nextDate,
      requestedSize: targetSize,
      holdingCount: target.length,
      codes: target.map(candidateCode),
      valid: false,
      cashOnly: false,
      investedPortfolioPct: 0,
      cashReservePct: 100,
      reason: "initial_portfolio_allocation_invalid",
    };
  }
  if (!outcomes.every((outcome) => outcome && outcome.valid)) {
    return {
      tradingDate,
      nextDate,
      requestedSize: targetSize,
      holdingCount: target.length,
      codes: target.map(candidateCode),
      valid: false,
      cashOnly: false,
      investedPortfolioPct: round(investedPortfolioPct, 4),
      cashReservePct: round(100 - investedPortfolioPct, 4),
      reason: "portfolio_outcome_coverage_incomplete",
    };
  }
  const weightedMetric = (key) => round(outcomes.reduce((sum, outcome, index) => (
    sum + Number(outcome[key] || 0) * allocations[index] / 100
  ), 0), 4);
  return {
    tradingDate,
    nextDate,
    requestedSize: targetSize,
    holdingCount: target.length,
    codes: target.map(candidateCode),
    valid: true,
    cashOnly: false,
    investedPortfolioPct: round(investedPortfolioPct, 4),
    cashReservePct: round(100 - investedPortfolioPct, 4),
    allocationAuthority: "initialPortfolioPct",
    outcome: {
      valid: true,
      closePct: weightedMetric("closePct"),
      gapPct: weightedMetric("gapPct"),
      highPct: weightedMetric("highPct"),
      adversePct: weightedMetric("adversePct"),
      openToClosePct: weightedMetric("openToClosePct"),
    },
  };
}

function cycleContext(chain) {
  const canonical = chain && Number(chain.version) === UNIFIED_DECISION_CHAIN_VERSION
    && chain.authority === "canonical_stock_decision"
    ? chain.marketStage || {}
    : {};
  const bigCycle = String(canonical.bigCycle && canonical.bigCycle.label || "").trim();
  const smallCycle = String(canonical.smallCycle && canonical.smallCycle.label || "").trim();
  return {
    bigCycle: bigCycle || "未知",
    bigCycleSource: bigCycle ? STRICT_SELECTION_AUTHORITY : "missing",
    smallCycle: smallCycle || "未知",
    smallCycleSource: smallCycle ? STRICT_SELECTION_AUTHORITY : "missing",
  };
}

function factorEvidenceLabels(pick) {
  const factorDecision = pick && pick.factorDecision && typeof pick.factorDecision === "object"
    ? pick.factorDecision : {};
  const leadership = factorDecision.leadershipWeighting && typeof factorDecision.leadershipWeighting === "object"
    ? factorDecision.leadershipWeighting : {};
  const participation = factorDecision.participationValue && typeof factorDecision.participationValue === "object"
    ? factorDecision.participationValue : {};
  const details = participation.details && typeof participation.details === "object" ? participation.details : {};
  const liquidity = details.liquidity && typeof details.liquidity === "object" ? details.liquidity : {};
  const feasibility = factorDecision.executionFeasibility && typeof factorDecision.executionFeasibility === "object"
    ? factorDecision.executionFeasibility : {};
  const carrier = pick && pick.marketCapCarrier && typeof pick.marketCapCarrier === "object"
    ? pick.marketCapCarrier : {};
  return {
    factorAuthority: String(factorDecision.authority || "missing"),
    leadershipProfile: String(leadership.profileKey || "missing"),
    leadershipOverallWeight: finiteNumber(leadership.overallWeight),
    intradayLeadershipVerified: leadership.intradayVerified === true,
    leadershipDataStatus: leadership.intradayVerified === true ? "verified" : "unverified_or_missing",
    volumeRatioBand: String(liquidity.volumeRatioBand || "unknown"),
    executionFeasibilityStatus: String(feasibility.status || "missing"),
    executionSlippageRisk: String(feasibility.slippageRisk || "missing"),
    marketCapBucket: String(carrier.bucketKey || "unknown"),
    marketCapRegime: String(carrier.regimeKey || "unknown"),
    marketCapYi: finiteNumber(carrier.totalCapYi),
  };
}

function summarizeFactorEvidenceAudit(rankingDays) {
  const labels = (Array.isArray(rankingDays) ? rankingDays : [])
    .flatMap((day) => Array.isArray(day.unifiedOrder) ? day.unifiedOrder : [])
    .map((row) => row.factorEvidence || {});
  const counts = (key) => labels.reduce((acc, row) => {
    const value = String(row && row[key] || "missing");
    acc[value] = Number(acc[value] || 0) + 1;
    return acc;
  }, {});
  return {
    sampleCount: labels.length,
    intradayLeadershipVerifiedCount: labels.filter((row) => row.intradayLeadershipVerified === true).length,
    intradayLeadershipCoveragePct: labels.length
      ? round(labels.filter((row) => row.intradayLeadershipVerified === true).length / labels.length * 100, 2)
      : null,
    leadershipProfileCounts: counts("leadershipProfile"),
    volumeRatioBandCounts: counts("volumeRatioBand"),
    executionFeasibilityStatusCounts: counts("executionFeasibilityStatus"),
    executionSlippageRiskCounts: counts("executionSlippageRisk"),
    marketCapBucketCounts: counts("marketCapBucket"),
    marketCapRegimeCounts: counts("marketCapRegime"),
    interpretation: "这些字段只审计因子证据覆盖与分组标签，不构成有效性确认；各分组仍需足够的精确T+1独立样本。",
  };
}

function executionReplayForPick(pick, outcome, outcomeCache, nextDate) {
  const code = candidateCode(pick);
  return buildExecutionReplay({
    rule: pick && pick.executionReplayRule,
    minuteBars: minuteBarsForOutcomeCache(outcomeCache, code, nextDate),
    dailyOutcome: outcome && outcome.valid ? {
      currentClose: outcome.currentClose,
      open: outcome.nextOpen,
      high: outcome.nextHigh,
      low: outcome.nextLow,
      nextClose: outcome.nextClose,
    } : {},
    exitPrice: outcome && outcome.valid ? outcome.nextClose : null,
    slippageBps: 5,
    feeBps: 8,
  });
}

function summarizeExecutionReplayAudit(rankingDays) {
  const rows = (Array.isArray(rankingDays) ? rankingDays : [])
    .flatMap((day) => Array.isArray(day.unifiedOrder) ? day.unifiedOrder : [])
    .map((row) => row.executionReplay)
    .filter(Boolean);
  const statusCounts = rows.reduce((acc, row) => {
    const key = String(row.status || "unknown");
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
  const unavailableReasonCounts = rows.reduce((acc, row) => {
    (Array.isArray(row.blockers) ? row.blockers : []).forEach((reason) => {
      acc[reason] = Number(acc[reason] || 0) + 1;
    });
    return acc;
  }, {});
  const triggeredRows = rows.filter((row) => (
    row.triggered === true
    && finiteNumber(row.outcome && row.outcome.netReturnPct) !== null
  ));
  const netReturns = triggeredRows.map((row) => Number(row.outcome.netReturnPct));
  const grossReturns = triggeredRows.map((row) => Number(row.outcome.grossReturnPct));
  return {
    authority: "intraday_execution_replay_v1",
    executionAuthority: false,
    studyUniverse: "post_hard_gate_common_pool_without_market_permission",
    sampleCount: rows.length,
    minuteBarCoverageCount: rows.filter((row) => !Array.isArray(row.blockers)
      || !row.blockers.includes("intraday_execution_bars_missing")).length,
    triggeredCount: rows.filter((row) => row.triggered === true).length,
    notTriggeredCount: rows.filter((row) => row.status === "not_triggered").length,
    statusCounts,
    unavailableReasonCounts,
    suspectedLockedDailyCount: rows.filter((row) => (
      row.dailyBuyabilityObservation && row.dailyBuyabilityObservation.suspectedLockedSession
    )).length,
    slippageScenarioBps: 5,
    feeScenarioBps: 8,
    triggeredOutcomeSummary: {
      outcomeCount: triggeredRows.length,
      meanGrossReturnPct: round(average(grossReturns), 4),
      meanNetReturnPct: round(average(netReturns), 4),
      medianNetReturnPct: round(median(netReturns), 4),
      winRatePct: triggeredRows.length
        ? round(netReturns.filter((value) => value > 0).length / triggeredRows.length * 100, 2)
        : null,
      worstNetReturnPct: netReturns.length ? round(Math.min(...netReturns), 4) : null,
      bestNetReturnPct: netReturns.length ? round(Math.max(...netReturns), 4) : null,
      exitRule: "T+1 closing price",
    },
    interpretation: "本项在绕过市场许可的共同硬门槛排序池中诊断买点；只有机器触发与5分钟成交条同时存在才计算触发后到T+1收盘的条件收益。5bps滑点和8bps费用是统一压力情景，不是实盘成交记录或严格策略收益。",
  };
}

function ablationScore(row, key) {
  const factor = row && row.factorDecision && typeof row.factorDecision === "object"
    ? row.factorDecision : {};
  const participation = factor.participationValue && typeof factor.participationValue === "object"
    ? factor.participationValue : {};
  const components = participation.components && typeof participation.components === "object"
    ? participation.components : {};
  const details = participation.details && typeof participation.details === "object"
    ? participation.details : {};
  const role = details.stockRole && typeof details.stockRole === "object" ? details.stockRole : {};
  const liquidity = details.liquidity && typeof details.liquidity === "object" ? details.liquidity : {};
  const risk = factor.riskAdjustment && factor.riskAdjustment.components || {};
  const baseline = finiteNumber(factor.finalScore ?? row.factorScore);
  if (baseline === null) return null;
  if (key === "leadership_dynamic") {
    const combined = finiteNumber(role.combinedScore);
    const base = finiteNumber(role.baseRoleScore);
    return combined === null || base === null ? baseline : baseline - combined + base;
  }
  if (key === "leadership_fixed_35") {
    const combined = finiteNumber(role.combinedScore);
    const base = finiteNumber(role.baseRoleScore);
    const comparable = finiteNumber(role.leadershipComparableScore);
    if ([combined, base, comparable].some((value) => value === null)) return baseline;
    return baseline - combined + base * 0.65 + comparable * 0.35;
  }
  if (key === "volume_ratio") return baseline - Number(liquidity.volumeRatioPoints || 0);
  if (key === "execution_feasibility") return baseline - Number(risk.executionFeasibility || 0);
  if (key === "market_cap") return baseline;
  if (Object.prototype.hasOwnProperty.call(components, key)) return baseline - Number(components[key] || 0);
  return baseline;
}

function pearson(left, right) {
  const pairs = left.map((value, index) => [finiteNumber(value), finiteNumber(right[index])])
    .filter(([a, b]) => a !== null && b !== null);
  if (pairs.length < 3) return null;
  const leftMean = average(pairs.map(([a]) => a));
  const rightMean = average(pairs.map(([, b]) => b));
  const numerator = pairs.reduce((sum, [a, b]) => sum + (a - leftMean) * (b - rightMean), 0);
  const leftVar = pairs.reduce((sum, [a]) => sum + (a - leftMean) ** 2, 0);
  const rightVar = pairs.reduce((sum, [, b]) => sum + (b - rightMean) ** 2, 0);
  if (leftVar <= 0 || rightVar <= 0) return null;
  return numerator / Math.sqrt(leftVar * rightVar);
}

function factorCorrelationAudit(rankingDays) {
  const samples = (Array.isArray(rankingDays) ? rankingDays : []).flatMap((day) => (
    Array.isArray(day.unifiedOrder) ? day.unifiedOrder : []
  )).map((row) => {
    const factor = row.factorDecision || {};
    const participation = factor.participationValue || {};
    const components = participation.components || {};
    const details = participation.details || {};
    return {
      themePosition: finiteNumber(components.themePosition),
      stockRole: finiteNumber(components.stockRole),
      structureQuality: finiteNumber(components.structureQuality),
      liquidity: finiteNumber(components.liquidity),
      t1Premium: finiteNumber(components.t1Premium),
      leadershipQuality: finiteNumber(factor.leadershipWeighting && factor.leadershipWeighting.qualityScore),
      volumeRatioPoints: finiteNumber(details.liquidity && details.liquidity.volumeRatioPoints),
      executionPenalty: finiteNumber(factor.riskAdjustment && factor.riskAdjustment.components
        && factor.riskAdjustment.components.executionFeasibility),
    };
  });
  const keys = Object.keys(samples[0] || {});
  const pairs = [];
  for (let leftIndex = 0; leftIndex < keys.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < keys.length; rightIndex += 1) {
      const leftKey = keys[leftIndex];
      const rightKey = keys[rightIndex];
      const value = pearson(samples.map((row) => row[leftKey]), samples.map((row) => row[rightKey]));
      pairs.push({
        left: leftKey,
        right: rightKey,
        correlation: round(value, 4),
        highOverlapRisk: value !== null && Math.abs(value) >= 0.75,
      });
    }
  }
  return {
    sampleCount: samples.length,
    pairs,
    highOverlapPairs: pairs.filter((row) => row.highOverlapRisk),
    rule: "相关性只提示潜在重复计权，不能单独证明因果或直接删除因子",
  };
}

function runFactorAblationStudy(rankingDays, targetSize = 3) {
  const keys = [
    "leadership_dynamic",
    "leadership_fixed_35",
    "volume_ratio",
    "execution_feasibility",
    "market_cap",
    "themePosition",
    "stockRole",
    "structureQuality",
    "liquidity",
    "t1Premium",
  ];
  const baselineRows = [];
  const variantRows = Object.fromEntries(keys.map((key) => [key, []]));
  (Array.isArray(rankingDays) ? rankingDays : []).forEach((day) => {
    const outcomeByCode = new Map((day.outcomes || []).map((outcome) => [outcome.code, outcome]));
    const ordered = (day.unifiedOrder || []).filter((row) => finiteNumber(row.factorDecision && row.factorDecision.finalScore) !== null);
    const baseline = buildPortfolioRow(day.tradingDate, day.nextDate, ordered, outcomeByCode, targetSize);
    if (baseline) baselineRows.push(baseline);
    keys.forEach((key) => {
      const variant = ordered.map((row, sourceIndex) => ({
        ...row,
        _ablationScore: ablationScore(row, key),
        _sourceIndex: sourceIndex,
      })).sort((left, right) => (
        Number(right._ablationScore ?? -Infinity) - Number(left._ablationScore ?? -Infinity)
        || left._sourceIndex - right._sourceIndex
      ));
      const portfolio = buildPortfolioRow(day.tradingDate, day.nextDate, variant, outcomeByCode, targetSize);
      if (portfolio) variantRows[key].push(portfolio);
    });
  });
  return {
    version: 1,
    authority: "factor_ablation_validation_only_v1",
    executionAuthority: false,
    targetSize,
    baseline: summarizeOutcomeRows(baselineRows),
    variants: Object.fromEntries(keys.map((key) => {
      const comparison = pairedComparison(variantRows[key], baselineRows);
      return [key, {
        removedOrChanged: key,
        summary: summarizeOutcomeRows(variantRows[key]),
        comparisonToBaseline: comparison,
        identifiable: comparison.changedDecisionDays > 0,
        sufficientChangedSamples: comparison.changedDecisionDays >= MIN_DIRECTIONAL_DAYS,
      }];
    })),
    correlationAudit: factorCorrelationAudit(rankingDays),
    rule: "消融只在同日共同候选池中改变一个评分分量；样本不足时不自动改权重",
  };
}

function scoreVariantPortfolios(rankingDays, scoreResolver, targetSize = 3) {
  const baselineRows = [];
  const variantRows = [];
  (Array.isArray(rankingDays) ? rankingDays : []).forEach((day) => {
    const outcomeByCode = new Map((day.outcomes || []).map((outcome) => [outcome.code, outcome]));
    const ordered = (day.unifiedOrder || []).filter((row) => finiteNumber(row.factorDecision && row.factorDecision.finalScore) !== null);
    const baseline = buildPortfolioRow(day.tradingDate, day.nextDate, ordered, outcomeByCode, targetSize);
    if (baseline) baselineRows.push(baseline);
    const variant = ordered.map((row, index) => ({
      ...row,
      _variantScore: scoreResolver(row),
      _sourceIndex: index,
    })).sort((left, right) => (
      Number(right._variantScore ?? -Infinity) - Number(left._variantScore ?? -Infinity)
      || left._sourceIndex - right._sourceIndex
    ));
    const variantPortfolio = buildPortfolioRow(day.tradingDate, day.nextDate, variant, outcomeByCode, targetSize);
    if (variantPortfolio) variantRows.push(variantPortfolio);
  });
  const dates = Array.from(new Set(baselineRows.map((row) => row.tradingDate))).sort();
  const splitIndex = Math.max(1, Math.floor(dates.length * 0.7));
  const trainDates = new Set(dates.slice(0, splitIndex));
  const testDates = new Set(dates.slice(splitIndex));
  const compare = (dateSet) => pairedComparison(
    variantRows.filter((row) => dateSet.has(row.tradingDate)),
    baselineRows.filter((row) => dateSet.has(row.tradingDate)),
  );
  return {
    train: compare(trainDates),
    test: compare(testDates),
    split: {
      method: "chronological_70_30",
      trainDates: Array.from(trainDates),
      testDates: Array.from(testDates),
    },
  };
}

function leadershipWeightScore(row, weight) {
  const factor = row.factorDecision || {};
  const role = factor.participationValue && factor.participationValue.details
    && factor.participationValue.details.stockRole || {};
  const baseline = finiteNumber(factor.finalScore);
  const combined = finiteNumber(role.combinedScore);
  const base = finiteNumber(role.baseRoleScore);
  const comparable = finiteNumber(role.leadershipComparableScore);
  if ([baseline, combined, base, comparable].some((value) => value === null)) return baseline;
  return baseline - combined + base * (1 - weight) + comparable * weight;
}

function volumeThresholdScore(row, threshold) {
  const factor = row.factorDecision || {};
  const liquidity = factor.participationValue && factor.participationValue.details
    && factor.participationValue.details.liquidity || {};
  const baseline = finiteNumber(factor.finalScore);
  if (baseline === null) return null;
  const ratio = finiteNumber(liquidity.volumeRatio);
  const oldPoints = Number(liquidity.volumeRatioPoints || 0);
  const newPoints = ratio === null || ratio <= 0 ? 0
    : ratio > 3 ? 2
      : ratio >= threshold ? 4
        : ratio >= 1 ? 1 : 0;
  return baseline - oldPoints + newPoints;
}

function calibrationEligibility(evaluation) {
  const train = evaluation && evaluation.train || {};
  const test = evaluation && evaluation.test || {};
  const trainDelta = finiteNumber(train.changedMeanDeltaClosePct);
  const testDelta = finiteNumber(test.changedMeanDeltaClosePct);
  return Boolean(
    Number(train.changedDecisionDays || 0) >= MIN_DIRECTIONAL_DAYS
    && Number(test.changedDecisionDays || 0) >= MIN_DIRECTIONAL_DAYS
    && trainDelta !== null && testDelta !== null
    && Math.sign(trainDelta) === Math.sign(testDelta)
    && testDelta > 0,
  );
}

function marketCapThresholdEvaluation(rankingDays, amountThresholdYi) {
  const samples = (Array.isArray(rankingDays) ? rankingDays : []).flatMap((day) => {
    const outcomeByCode = new Map((day.outcomes || []).map((outcome) => [outcome.code, outcome]));
    return (day.unifiedOrder || []).map((row) => {
      const capYi = finiteNumber(row.factorEvidence && row.factorEvidence.marketCapYi);
      const amountYi = finiteNumber(day.marketAmountYi);
      const outcome = outcomeByCode.get(row.code);
      if (capYi === null || amountYi === null || !outcome || !outcome.valid) return null;
      const highTurnover = amountYi >= amountThresholdYi;
      const aligned = highTurnover ? capYi >= 500 : capYi >= 50 && capYi < 500;
      return { tradingDate: day.tradingDate, aligned, closePct: outcome.closePct };
    }).filter(Boolean);
  });
  const dates = Array.from(new Set(samples.map((row) => row.tradingDate))).sort();
  const splitIndex = Math.max(1, Math.floor(dates.length * 0.7));
  const summarize = (rows) => {
    const aligned = rows.filter((row) => row.aligned);
    const nonAligned = rows.filter((row) => !row.aligned);
    const alignedMean = average(aligned.map((row) => row.closePct));
    const nonAlignedMean = average(nonAligned.map((row) => row.closePct));
    return {
      sampleCount: rows.length,
      alignedCount: aligned.length,
      nonAlignedCount: nonAligned.length,
      alignedMeanClosePct: round(alignedMean, 4),
      nonAlignedMeanClosePct: round(nonAlignedMean, 4),
      deltaClosePct: alignedMean === null || nonAlignedMean === null ? null : round(alignedMean - nonAlignedMean, 4),
    };
  };
  const trainDates = new Set(dates.slice(0, splitIndex));
  const testDates = new Set(dates.slice(splitIndex));
  const train = summarize(samples.filter((row) => trainDates.has(row.tradingDate)));
  const test = summarize(samples.filter((row) => testDates.has(row.tradingDate)));
  const eligible = train.alignedCount >= MIN_DIRECTIONAL_DAYS
    && train.nonAlignedCount >= MIN_DIRECTIONAL_DAYS
    && test.alignedCount >= MIN_DIRECTIONAL_DAYS
    && test.nonAlignedCount >= MIN_DIRECTIONAL_DAYS
    && train.deltaClosePct > 0 && test.deltaClosePct > 0;
  return { amountThresholdYi, train, test, eligible };
}

function runThresholdCalibrationStudy(rankingDays) {
  const leadershipWeights = [0, 0.15, 0.25, 0.35, 0.45, 0.55];
  const volumeThresholds = [1, 1.1, 1.2, 1.3, 1.5];
  const amountThresholds = [20000, 22000, 25000, 28000, 30000];
  const cycles = Array.from(new Set((rankingDays || []).map((day) => String(day.cycle && day.cycle.bigCycle || "未知"))));
  const leadershipByCycle = Object.fromEntries(cycles.map((cycle) => {
    const days = rankingDays.filter((day) => String(day.cycle && day.cycle.bigCycle || "未知") === cycle);
    return [cycle, leadershipWeights.map((weight) => {
      const evaluation = scoreVariantPortfolios(days, (row) => leadershipWeightScore(row, weight), PRIMARY_RANKING_SIZE);
      return { weight, evaluation, eligible: calibrationEligibility(evaluation) };
    })];
  }));
  const volumeRatio = volumeThresholds.map((threshold) => {
    const evaluation = scoreVariantPortfolios(
      rankingDays,
      (row) => volumeThresholdScore(row, threshold),
      PRIMARY_RANKING_SIZE,
    );
    return { threshold, evaluation, eligible: calibrationEligibility(evaluation) };
  });
  const marketAmount = amountThresholds.map((threshold) => marketCapThresholdEvaluation(rankingDays, threshold));
  const eligibleRecommendations = [
    ...Object.entries(leadershipByCycle).flatMap(([cycle, rows]) => rows.filter((row) => row.eligible)
      .map((row) => ({ factor: "leadershipWeight", cycle, value: row.weight }))),
    ...volumeRatio.filter((row) => row.eligible).map((row) => ({ factor: "volumeRatioThreshold", value: row.threshold })),
    ...marketAmount.filter((row) => row.eligible).map((row) => ({ factor: "marketAmountThresholdYi", value: row.amountThresholdYi })),
  ];
  return {
    version: 1,
    authority: "walk_forward_threshold_calibration_v1",
    executionAuthority: false,
    calibrationApplied: false,
    currentParameters: {
      marketAmountThresholdYi: 25000,
      volumeRatioThreshold: 1.2,
      leadershipWeights: { chaos: 0.25, mainRise: 0.45, range: 0.35, ice: 0.3, retreat: 0 },
    },
    grids: { leadershipByCycle, volumeRatio, marketAmount },
    eligibleRecommendations,
    decision: eligibleRecommendations.length
      ? "recommendations_require_user_review_and_larger_holdout"
      : "retain_current_parameters_insufficient_out_of_sample_evidence",
    rule: "训练与验证都至少需要10个真实换票/对照样本且方向一致；校准器只给建议，不自动修改生产参数",
  };
}

function removeUnsafeArchivedBacktest(candidates) {
  candidates.forEach((stock) => {
    if (stock && typeof stock === "object") delete stock.backtest;
  });
}

function prepareCandidates(snapshot, backtestFeatureSafe) {
  const candidates = deepClone(Array.isArray(snapshot && snapshot.candidates) ? snapshot.candidates : []);
  if (!backtestFeatureSafe) removeUnsafeArchivedBacktest(candidates);
  rebuildMarketCapCarrierPayload({
    market: deepClone(snapshot && snapshot.market || {}),
    candidates,
  });
  _internals.refreshCandidateFlowAndGate(
    candidates,
    snapshot && snapshot.market && snapshot.market.state || {},
    snapshot && snapshot.market && snapshot.market.limitStats || {},
  );
  return candidates;
}

function callBestPicks(snapshot, candidates, yesterdaySnapshot, options) {
  return _internals.buildBestPicks(
    candidates,
    deepClone(snapshot && snapshot.topicBoard || {}),
    deepClone(snapshot && snapshot.market && snapshot.market.state || {}),
    deepClone(Array.isArray(snapshot && snapshot.hotConcepts) ? snapshot.hotConcepts : []),
    deepClone(snapshot && snapshot.survivorBoard || null),
    [],
    deepClone(snapshot && snapshot.market && snapshot.market.limitStats || null),
    deepClone(yesterdaySnapshot || null),
    deepClone(snapshot && snapshot.tomorrowOutlook || null),
    options,
  );
}

function replayHistoricalCounterfactualDecision(snapshot, previousSnapshot, previousPreviousSnapshot, backtestFeatureSafe) {
  const payload = deepClone(snapshot);
  const previousPayload = deepClone(previousSnapshot || null);
  const previousPreviousPayload = deepClone(previousPreviousSnapshot || null);
  const candidates = prepareCandidates(payload, backtestFeatureSafe);
  payload.candidates = candidates;
  payload.bestPicks = callBestPicks(payload, candidates, previousPayload, {});
  if (!payload.market || typeof payload.market !== "object") payload.market = {};
  if (!payload.market.state || typeof payload.market.state !== "object") payload.market.state = {};
  payload.market.state.effectAttribution = buildMarketEffectAttribution(payload);
  payload.marketEmotion = _internals.buildMarketEmotionObservation(payload);
  _internals.refreshPremarketModels(payload, { previousPayload });
  _internals.refreshTomorrowDecision(payload, {
    previousPayload,
    previousPreviousPayload,
    allowCanonicalReplay: true,
  });
  _internals.refreshUnifiedQuantFactors(payload);
  return payload;
}

function validateCounterfactualDecisionReplay(payload, expectedTradingDate, expectedPreviousTradingDate) {
  const inspection = _internals.inspectAuthoritativeDecisionChain(payload, { requireBestPicksProjection: true });
  const chain = payload && payload.unifiedDecisionChain || {};
  const stage = chain.marketStage || {};
  const previous = stage.previousEmotionStage || {};
  const selectionContext = chain.stockSelectionContext || {};
  const unified = payload && payload.unifiedQuantFactors || {};
  const bestPicks = payload && payload.bestPicks || {};
  const generation = chain.generation || {};
  const trading = snapshotTradingDate(payload);
  const kind = snapshotKind(payload, trading.date);
  const blockers = [
    Number(chain.version || 0) !== UNIFIED_DECISION_CHAIN_VERSION ? "decision_chain_version_mismatch" : null,
    chain.authority !== "canonical_stock_decision" ? "decision_chain_authority_mismatch" : null,
    !inspection || inspection.valid !== true ? "authoritative_chain_inspection_failed" : null,
    !chain.integrity || chain.integrity.ok !== true ? "decision_chain_integrity_failed" : null,
    generation.aligned !== true ? "decision_generation_not_aligned" : null,
    normalizeTradingDate(generation.tradingDate) !== expectedTradingDate ? "decision_trading_date_mismatch" : null,
    trading.date !== expectedTradingDate || kind.kind !== "closing" ? "decision_basis_not_exact_closing" : null,
    previous.passed !== true ? "exact_t1_emotion_not_passed" : null,
    previous.authority !== "canonical_exact_closing_replay" ? "exact_t1_emotion_authority_mismatch" : null,
    previous.exactPreviousTradingDay !== true ? "exact_t1_date_not_verified" : null,
    normalizeTradingDate(previous.tradingDate) !== expectedPreviousTradingDate ? "exact_t1_emotion_date_mismatch" : null,
    previous.crossDayVerified !== true ? "exact_t1_cross_day_not_verified" : null,
    selectionContext.passed !== true ? "selection_context_not_passed" : null,
    selectionContext.authority !== "canonical_market_phase_detail" ? "selection_context_authority_mismatch" : null,
    selectionContext.factorContextRecomputed !== true ? "candidate_factor_context_not_recomputed" : null,
    bestPicks.selectionAuthority !== STRICT_SELECTION_AUTHORITY ? "best_picks_selection_authority_mismatch" : null,
    Number(bestPicks.decisionChainVersion || 0) !== UNIFIED_DECISION_CHAIN_VERSION ? "best_picks_chain_version_mismatch" : null,
    Number(unified.version || 0) !== UNIFIED_QUANT_FACTORS_VERSION ? "unified_factor_version_mismatch" : null,
    !unified.integrity || unified.integrity.status !== "valid" || unified.integrity.ok !== true
      ? "unified_factor_integrity_failed" : null,
  ].filter(Boolean);
  return {
    replayReady: blockers.length === 0,
    blockers,
    inspection,
    chain,
    previousEmotionStage: previous,
    selectionContext,
    unified,
  };
}

function pairedComparison(unifiedRows, legacyRows) {
  const unifiedByDate = new Map(unifiedRows.filter((row) => row && row.valid).map((row) => [row.tradingDate, row]));
  const legacyByDate = new Map(legacyRows.filter((row) => row && row.valid).map((row) => [row.tradingDate, row]));
  const pairs = [];
  for (const [tradingDate, unified] of unifiedByDate.entries()) {
    const legacy = legacyByDate.get(tradingDate);
    if (!legacy) continue;
    const unifiedCodes = Array.isArray(unified.codes) ? unified.codes.slice().sort() : [];
    const legacyCodes = Array.isArray(legacy.codes) ? legacy.codes.slice().sort() : [];
    const selectionChanged = unifiedCodes.join(",") !== legacyCodes.join(",");
    pairs.push({
      tradingDate,
      unifiedCodes,
      legacyCodes,
      selectionChanged,
      unifiedClosePct: unified.outcome.closePct,
      legacyClosePct: legacy.outcome.closePct,
      deltaClosePct: round(unified.outcome.closePct - legacy.outcome.closePct, 4),
    });
  }
  const deltas = pairs.map((row) => row.deltaClosePct);
  const changedPairs = pairs.filter((row) => row.selectionChanged);
  const changedDeltas = changedPairs.map((row) => row.deltaClosePct);
  return {
    pairedDecisionDays: pairs.length,
    changedDecisionDays: changedPairs.length,
    unchangedDecisionDays: pairs.length - changedPairs.length,
    meanDeltaClosePct: round(average(deltas), 4),
    medianDeltaClosePct: round(median(deltas), 4),
    changedMeanDeltaClosePct: round(average(changedDeltas), 4),
    changedMedianDeltaClosePct: round(median(changedDeltas), 4),
    positiveDeltaRatePct: changedPairs.length
      ? round(changedPairs.filter((row) => row.deltaClosePct > 0).length / changedPairs.length * 100, 2)
      : null,
    status: changedPairs.length >= MIN_CONFIRMATION_DAYS
      ? "confirmation_threshold_reached"
      : changedPairs.length >= MIN_DIRECTIONAL_DAYS
        ? "directional_only"
        : "insufficient_changed_samples",
    pairs,
  };
}

function changedTop1Diagnostics(comparison, rankingDays) {
  const byDate = new Map(rankingDays.map((day) => [day.tradingDate, day]));
  return (comparison && Array.isArray(comparison.pairs) ? comparison.pairs : [])
    .filter((pair) => pair.selectionChanged)
    .map((pair) => {
      const day = byDate.get(pair.tradingDate) || {};
      const unifiedCode = pair.unifiedCodes && pair.unifiedCodes[0];
      const legacyCode = pair.legacyCodes && pair.legacyCodes[0];
      const unified = (day.unifiedOrder || []).find((row) => row.code === unifiedCode) || {};
      const legacyUnderCurrent = (day.unifiedOrder || []).find((row) => row.code === legacyCode) || {};
      const unifiedComponents = unified.factorDecision && unified.factorDecision.participationValue
        && unified.factorDecision.participationValue.components || {};
      const legacyComponents = legacyUnderCurrent.factorDecision && legacyUnderCurrent.factorDecision.participationValue
        && legacyUnderCurrent.factorDecision.participationValue.components || {};
      const componentDelta = {};
      ["themePosition", "stockRole", "structureQuality", "liquidity", "t1Premium"].forEach((key) => {
        componentDelta[key] = round(Number(unifiedComponents[key] || 0) - Number(legacyComponents[key] || 0), 4);
      });
      const positiveDrivers = Object.entries(componentDelta)
        .filter(([, value]) => Number(value) > 0)
        .sort((a, b) => Number(b[1]) - Number(a[1]));
      return {
        tradingDate: pair.tradingDate,
        unifiedCode,
        unifiedName: unified.name || unifiedCode,
        legacyCode,
        legacyName: legacyUnderCurrent.name || legacyCode,
        deltaClosePct: pair.deltaClosePct,
        unifiedFactorScore: finiteNumber(unified.factorScore),
        legacyCandidateFactorScore: finiteNumber(legacyUnderCurrent.factorScore),
        factorComponentDelta: componentDelta,
        largestPositiveDrivers: positiveDrivers.slice(0, 2).map(([key, value]) => ({ key, value })),
        unifiedRiskAdjustment: unified.factorDecision && unified.factorDecision.riskAdjustment || null,
        legacyRiskAdjustment: legacyUnderCurrent.factorDecision && legacyUnderCurrent.factorDecision.riskAdjustment || null,
      };
    });
}

function groupPortfolioRows(rows, dayContext, key) {
  const groups = new Map();
  rows.filter((row) => row && row.valid).forEach((row) => {
    const context = dayContext.get(row.tradingDate) || {};
    const label = String(context[key] || "未知");
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push({ ...row, outcome: row.outcome });
  });
  return Array.from(groups.entries())
    .map(([label, groupRows]) => ({ label, ...summarizeOutcomeRows(groupRows) }))
    .sort((a, b) => b.decisionDays - a.decisionDays || a.label.localeCompare(b.label, "zh-CN"));
}

function validationAssessment(comparisons, strictSummary, frozenDecisionStudy = null) {
  const primary = comparisons[`top${PRIMARY_RANKING_SIZE}`] || {};
  const directionallyBetter = primary.changedMeanDeltaClosePct != null
    && primary.changedMeanDeltaClosePct > 0
    && primary.positiveDeltaRatePct != null
    && primary.positiveDeltaRatePct >= 50;
  const descriptiveSignalEligible = Number(primary.changedDecisionDays || 0) >= MIN_DIRECTIONAL_DAYS
    && Number(strictSummary.investedDecisionDays || 0) >= MIN_DIRECTIONAL_DAYS
    && Number(strictSummary.invalidOutcomeDays || 0) === 0;
  return {
    primaryRankingK: PRIMARY_RANKING_SIZE,
    primaryPortfolio: "counterfactualAllocatedTop5",
    confirmationEligible: false,
    strategyEffectivenessConfirmed: false,
    effectivenessConfirmed: false,
    rankingStatus: Number(primary.changedDecisionDays || 0) < MIN_DIRECTIONAL_DAYS
      ? "insufficient_changed_samples"
      : directionallyBetter
        ? "descriptive_directionally_better"
        : "no_directional_improvement",
    counterfactualReplayStatus: Number(strictSummary.invalidOutcomeDays || 0) > 0
      ? "invalid_outcome_coverage"
      : Number(strictSummary.investedDecisionDays || 0) >= MIN_DIRECTIONAL_DAYS
        ? "descriptive_sample_only"
        : Number(strictSummary.decisionDays || 0) > 0
          ? "cash_or_insufficient_invested_sample"
        : "no_executable_sample",
    descriptiveSignal: descriptiveSignalEligible
      ? directionallyBetter ? "positive_pattern" : "non_positive_pattern"
      : "not_eligible",
    reason: frozenDecisionStudy && Number(frozenDecisionStudy.receiptCount || 0) > 0
      ? "as-decided部分已按冻结凭证记录机器触发、分钟成交及显式滑点费用情景，但仍不是实盘成交；在连续样本和预注册经济收益/风险阈值满足前不能确认策略有效。"
      : "当前尚无live_canonical当晚冻结凭证样本；现有结果仅为排序诊断与当前引擎反事实回放，不能确认策略有效。",
  };
}

function buildFrozenDecisionStudy(decisionReceiptAudit, historyDir, outcomeDir) {
  const liveRecords = (decisionReceiptAudit && Array.isArray(decisionReceiptAudit.records)
    ? decisionReceiptAudit.records : []).filter((row) => row.liveCanonical === true);
  const days = liveRecords.map((record) => {
    const snapshot = readJsonSafe(path.join(historyDir, record.fileName));
    const receipt = snapshot && snapshot.decisionReceipt;
    const outcomeFile = record.tradingDate
      ? path.join(outcomeDir, `${record.tradingDate}.json`) : null;
    const outcome = outcomeFile && fs.existsSync(outcomeFile) ? readJsonSafe(outcomeFile) : null;
    const inspection = outcome && receipt
      ? validateDecisionOutcome(outcome, { decisionReceipt: receipt })
      : { valid: false, reasons: [outcome ? "decision_receipt_missing" : "decision_outcome_pending"] };
    return {
      tradingDate: record.tradingDate,
      receiptId: record.receiptId,
      decisionHash: record.decisionHash,
      selectedCodes: receipt && receipt.decision && receipt.decision.result
        && Array.isArray(receipt.decision.result.selectedCodes)
        ? receipt.decision.result.selectedCodes.slice() : [],
      selectedCount: receipt && receipt.decision && receipt.decision.result
        ? Number(receipt.decision.result.selectedCount || 0) : 0,
      outcomeFile,
      outcomeStatus: outcome && outcome.status || "pending",
      outcomeValid: inspection.valid === true,
      outcomeBlockers: inspection.reasons || [],
      cashOnly: outcome && outcome.cashOnly === true,
      netReturnContributionPct: inspection.valid
        ? finiteNumber(outcome && outcome.portfolio && outcome.portfolio.netReturnContributionPct)
        : null,
    };
  });
  const validReturns = days.map((row) => row.netReturnContributionPct).filter((value) => value != null);
  return {
    version: 1,
    authority: "canonical_decision_receipt_v1",
    provenance: "frozen_live_canonical_as_decided",
    asDecided: true,
    executionAuthority: false,
    outcomeDir,
    receiptCount: days.length,
    settledOutcomeCount: days.filter((row) => row.outcomeValid).length,
    pendingOutcomeCount: days.filter((row) => row.outcomeStatus === "pending").length,
    invalidOutcomeCount: days.filter((row) => row.outcomeStatus !== "pending" && !row.outcomeValid).length,
    cashOnlyCount: days.filter((row) => row.outcomeValid && row.cashOnly).length,
    selectedStockDecisionCount: days.filter((row) => row.selectedCount > 0).length,
    meanNetReturnContributionPct: round(average(validReturns), 4),
    medianNetReturnContributionPct: round(median(validReturns), 4),
    days,
    status: days.length ? "as_decided_receipts_available" : "awaiting_first_live_canonical_receipt",
    rule: "只读取当晚冻结的live_canonical凭证及按receiptId/decisionHash绑定的T+1侧车；不重新选股、不重新计算仓位",
  };
}

function runFactorEffectivenessValidation(options = {}) {
  const historyDir = path.resolve(options.historyDir || path.join(__dirname, "data", "history"));
  const outcomeCachePath = path.resolve(options.outcomeCachePath || path.join(__dirname, "data", "factor-validation-outcomes.json"));
  const minuteOutcomeCachePath = path.resolve(
    options.minuteOutcomeCachePath || path.join(__dirname, "data", "factor-validation-minute-outcomes.json"),
  );
  const dailyOutcomeCache = loadOutcomeCache(outcomeCachePath);
  const minuteOutcomeCache = loadOutcomeCache(minuteOutcomeCachePath);
  const outcomeCache = mergeOutcomeCaches(dailyOutcomeCache, minuteOutcomeCache);
  const loaded = loadHistoricalSnapshots(historyDir);
  const paired = buildExactT1Pairs(loaded.records);
  const historicalMigration = buildHistoricalMigrationAudit(loaded.records);
  const decisionReceiptAudit = auditDecisionReceiptSnapshots(historyDir);
  const decisionOutcomeDir = path.resolve(options.decisionOutcomeDir || path.join(__dirname, "data", "decision-outcomes"));
  const frozenDecisionStudy = buildFrozenDecisionStudy(
    decisionReceiptAudit,
    historyDir,
    decisionOutcomeDir,
  );
  const byDate = new Map(loaded.records.map((record) => [record.tradingDate, record]));
  const rankingDays = [];
  const strictDays = [];
  const portfolioRows = {
    unifiedTop1: [],
    legacyTop1: [],
    unifiedTop3: [],
    legacyTop3: [],
    unifiedTop5: [],
    legacyTop5: [],
    strictTop1: [],
    strictTop3: [],
    strictTop5: [],
  };
  const dayContext = new Map();
  const strictOutcomeAudits = [];

  for (const pair of paired.pairs) {
    const currentSnapshot = pair.current.snapshot;
    const nextSnapshot = pair.next.snapshot;
    const previousDate = exactPreviousTradingDate(currentSnapshot);
    const previousRecord = previousDate && byDate.has(previousDate) ? byDate.get(previousDate) : null;
    const yesterdaySnapshot = previousRecord ? previousRecord.snapshot : null;
    const previousPreviousDate = exactPreviousTradingDate(yesterdaySnapshot);
    const previousPreviousRecord = previousPreviousDate && byDate.has(previousPreviousDate)
      ? byDate.get(previousPreviousDate) : null;
    const nextCandidateByCode = new Map(
      (Array.isArray(nextSnapshot.candidates) ? nextSnapshot.candidates : [])
        .map((stock) => [candidateCode(stock), stock])
        .filter(([code]) => code),
    );
    const rawSelected = (Array.isArray(currentSnapshot.candidates) ? currentSnapshot.candidates : [])
      .filter((stock) => stock && stock.selected === true);

    let replayPayload = null;
    let strictValidation = null;
    let strictError = null;
    try {
      replayPayload = replayHistoricalCounterfactualDecision(
        currentSnapshot,
        yesterdaySnapshot,
        previousPreviousRecord && previousPreviousRecord.snapshot,
        pair.backtestFeatureSafe,
      );
      strictValidation = validateCounterfactualDecisionReplay(replayPayload, pair.currentDate, previousDate);
    } catch (error) {
      strictError = String(error && error.stack || error);
      strictValidation = {
        ready: false,
        blockers: ["historical_decision_replay_failed"],
        chain: {},
      };
    }
    const chain = strictValidation.chain || {};
    const context = cycleContext(chain);
    dayContext.set(pair.currentDate, context);

    let rankingResult;
    let rankingError = null;
    try {
      const candidates = prepareCandidates(currentSnapshot, pair.backtestFeatureSafe);
      rankingResult = callBestPicks(currentSnapshot, candidates, yesterdaySnapshot, { validationMode: "ranking-study" });
    } catch (error) {
      rankingError = String(error && error.stack || error);
      rankingResult = { picks: [], available: false };
    }
    const unifiedPicks = Array.isArray(rankingResult && rankingResult.picks) ? rankingResult.picks : [];
    const eligibleCodes = new Set(unifiedPicks.map(candidateCode).filter(Boolean));
    const legacyPicks = rawSelected
      .filter((stock) => eligibleCodes.has(candidateCode(stock)))
      .slice()
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    const outcomeByCode = new Map();
    Array.from(eligibleCodes).forEach((code) => {
      const currentStock = rawSelected.find((stock) => candidateCode(stock) === code)
        || (Array.isArray(currentSnapshot.candidates) ? currentSnapshot.candidates : []).find((stock) => candidateCode(stock) === code);
      outcomeByCode.set(code, resolveOutcome(
        currentStock,
        nextCandidateByCode.get(code),
        outcomeCache,
        pair.currentDate,
        pair.nextDate,
      ));
    });

    const day = {
      tradingDate: pair.currentDate,
      nextDate: pair.nextDate,
      cycle: context,
      studyUniverse: "post_hard_gate_common_pool",
      executionAuthority: false,
      marketAmountYi: finiteNumber(currentSnapshot && currentSnapshot.market && currentSnapshot.market.snapshot
        && (currentSnapshot.market.snapshot.shszAmountYi ?? currentSnapshot.market.snapshot.totalAmountYi)),
      rawLegacySelectedCount: rawSelected.length,
      comparableUniverseCount: eligibleCodes.size,
      unifiedOrder: unifiedPicks.map((pick) => ({
        code: candidateCode(pick),
        name: pick.name,
        factorScore: pick.score,
        factorDecision: pick.factorDecision || null,
        factorEvidence: factorEvidenceLabels(pick),
        executionReplay: executionReplayForPick(
          pick,
          outcomeByCode.get(candidateCode(pick)),
          outcomeCache,
          pair.nextDate,
        ),
      })),
      legacyOrder: legacyPicks.map((pick) => ({ code: candidateCode(pick), name: pick.name, legacyScore: finiteNumber(pick.score) })),
      outcomes: Array.from(outcomeByCode.values()),
      backtestFeatureSafe: pair.backtestFeatureSafe,
      backtestSafetyReason: pair.backtestSafetyReason,
      rankingError,
    };
    rankingDays.push(day);
    for (const size of FIXED_RANKING_SIZES) {
      portfolioRows[`unifiedTop${size}`].push(buildPortfolioRow(pair.currentDate, pair.nextDate, unifiedPicks, outcomeByCode, size));
      portfolioRows[`legacyTop${size}`].push(buildPortfolioRow(pair.currentDate, pair.nextDate, legacyPicks, outcomeByCode, size));
    }

    const contractReady = strictValidation.replayReady === true;
    const authorization = chain.authorization || {};
    const finalPermission = authorization.tradePermission || {};
    const strictPicks = contractReady && chain.result && Array.isArray(chain.result.stocks)
      ? chain.result.stocks : [];
    const strictOutcomeByCode = new Map();
    strictPicks.forEach((pick) => {
      const currentStock = (Array.isArray(currentSnapshot.candidates) ? currentSnapshot.candidates : [])
        .find((stock) => candidateCode(stock) === candidateCode(pick));
      const outcome = resolveOutcome(
        currentStock,
        nextCandidateByCode.get(candidateCode(pick)),
        outcomeCache,
        pair.currentDate,
        pair.nextDate,
      );
      strictOutcomeByCode.set(candidateCode(pick), outcome);
      strictOutcomeAudits.push(outcome);
    });
    strictDays.push({
      tradingDate: pair.currentDate,
      nextDate: pair.nextDate,
      replayContractIntegrity: contractReady ? "valid" : "invalid",
      replayReady: contractReady,
      permissionAllowNew: contractReady && finalPermission.allowNew === true,
      permissionStatus: String(authorization.status || finalPermission.status || "unknown"),
      resultStatus: String(chain.result && chain.result.status || "unavailable"),
      reconstructedPickCodes: strictPicks.map(candidateCode),
      initialPortfolioPct: round(strictPicks.reduce((sum, pick) => (
        sum + Number(pick && pick.positionAllocation && pick.positionAllocation.initialPortfolioPct || 0)
      ), 0), 4),
      exactT1Authority: strictValidation.previousEmotionStage
        && strictValidation.previousEmotionStage.authority || null,
      exactT1CrossDayVerified: strictValidation.previousEmotionStage
        && strictValidation.previousEmotionStage.crossDayVerified === true,
      selectionContextAuthority: strictValidation.selectionContext
        && strictValidation.selectionContext.authority || null,
      replayBlockers: strictValidation.blockers || [],
      replayError: strictError,
    });
    for (const size of FIXED_RANKING_SIZES) {
      portfolioRows[`strictTop${size}`].push(buildAllocatedPortfolioRow(
        pair.currentDate,
        pair.nextDate,
        strictPicks,
        strictOutcomeByCode,
        size,
        {
          contractReady,
          reason: strictValidation.blockers && strictValidation.blockers.join(",")
            || "strict_decision_contract_not_ready",
        },
      ));
    }
  }

  ["unifiedTop1", "legacyTop1", "unifiedTop3", "legacyTop3", "unifiedTop5", "legacyTop5"]
    .forEach((key) => { portfolioRows[key] = portfolioRows[key].filter(Boolean); });
  const summaries = Object.fromEntries(
    Object.entries(portfolioRows).map(([key, rows]) => [key, summarizeOutcomeRows(rows)]),
  );
  const comparisons = {
    top1: pairedComparison(portfolioRows.unifiedTop1, portfolioRows.legacyTop1),
    top3: pairedComparison(portfolioRows.unifiedTop3, portfolioRows.legacyTop3),
    top5: pairedComparison(portfolioRows.unifiedTop5, portfolioRows.legacyTop5),
  };
  const changedDiagnostics = changedTop1Diagnostics(comparisons.top1, rankingDays);
  const strictSummary = summaries.strictTop5;
  const factorEvidenceAudit = summarizeFactorEvidenceAudit(rankingDays);
  const executionReplayAudit = summarizeExecutionReplayAudit(rankingDays);
  const ablationStudy = runFactorAblationStudy(rankingDays, PRIMARY_RANKING_SIZE);
  const ablationStudyTop1 = runFactorAblationStudy(rankingDays, 1);
  const thresholdCalibration = runThresholdCalibrationStudy(rankingDays);
  const auditedOutcomes = rankingDays.flatMap((day) => day.outcomes || []);
  const outcomeSourceCounts = {};
  const invalidOutcomeReasonCounts = {};
  auditedOutcomes.forEach((outcome) => {
    if (outcome && outcome.valid) {
      const source = String(outcome.source || "unknown");
      outcomeSourceCounts[source] = Number(outcomeSourceCounts[source] || 0) + 1;
    } else {
      const reason = String(outcome && outcome.reason || "unknown");
      invalidOutcomeReasonCounts[reason] = Number(invalidOutcomeReasonCounts[reason] || 0) + 1;
    }
  });

  return {
    schemaVersion: 2,
    generatedAt: options.generatedAt || new Date().toISOString(),
    studyName: "统一量化因子第二阶段有效性验证",
    methodology: {
      outcomeType: "T+1条件溢价诊断，不等同于可成交收益",
      primaryOutcome: "T+1收盘价 / T日收盘价 - 1",
      secondaryOutcomes: ["T+1竞价缺口", "T+1最高溢价", "T+1最低不利波动", "T+1开盘至收盘"],
      noLookahead: [
        "排序只读取T日收盘快照及精确T-1收盘快照",
        "排序冻结后才连接供应商明确标注的精确T+1快照",
        "排序阶段不联网；排序冻结后只允许读取已缓存的精确日期独立K线结果，不把下一个现存文件当作下一交易日",
        "归档时间不早于T+1开盘时，移除该日冻结backtest特征",
      ],
      rankingStudy: "仅在post_hard_gate_common_pool中对比旧score与当前因子排序；绕过市场执行许可，无任何执行权威，也不验证硬门槛的增量效果。",
      rankingSizes: FIXED_RANKING_SIZES.slice(),
      primaryRankingSize: PRIMARY_RANKING_SIZE,
      counterfactualReplayStudy: "反事实研究：对旧收盘快照使用当前v3引擎进行内存重建；它不等于当晚真实输出，不具备as-decided或实盘执行权。以initialPortfolioPct计算条件溢价，空仓日保留0收益。",
      counterfactualPrimaryPortfolio: "allocatedTop5",
      thresholds: {
        priceIntegrityTolerancePct: PRICE_INTEGRITY_TOLERANCE_PCT,
        directionalMinimumDecisionDays: MIN_DIRECTIONAL_DAYS,
        confirmationMinimumDecisionDays: MIN_CONFIRMATION_DAYS,
      },
    },
    dataAudit: {
      historyDir,
      jsonFileCount: loaded.files.length,
      usableClosingSnapshotCount: loaded.records.length,
      rejectedSnapshotCount: loaded.rejected.length,
      rejectedSnapshots: loaded.rejected,
      exactT1PairCount: paired.pairs.length,
      unmatchedClosingSnapshotLinks: paired.unmatched,
      backtestFeatureSafePairCount: paired.pairs.filter((pair) => pair.backtestFeatureSafe).length,
      backtestFeatureRemovedPairCount: paired.pairs.filter((pair) => !pair.backtestFeatureSafe).length,
      outcomeCache: {
        path: outcomeCachePath,
        status: dailyOutcomeCache.loadStatus,
        source: String(dailyOutcomeCache.source || "unknown"),
        codeCount: Object.keys(outcomeCache.series || {}).length,
      },
      minuteOutcomeCache: {
        path: minuteOutcomeCachePath,
        status: minuteOutcomeCache.loadStatus,
        authority: String(minuteOutcomeCache.authority || "unknown"),
        executionAuthority: minuteOutcomeCache.executionAuthority === true,
        requestedPairCount: Number(minuteOutcomeCache.qualitySummary && minuteOutcomeCache.qualitySummary.requestedPairCount || 0),
        validPairCount: Number(minuteOutcomeCache.qualitySummary && minuteOutcomeCache.qualitySummary.validPairCount || 0),
        primarySource: "akshare_sina_5m_unadjusted",
        primarySourceValidCount: Number(minuteOutcomeCache.qualitySummary && minuteOutcomeCache.qualitySummary.validPairCount || 0),
        crossSourceConfirmedCount: Math.max(0,
          Number(minuteOutcomeCache.qualitySummary && minuteOutcomeCache.qualitySummary.requestedPairCount || 0)
          - Number(minuteOutcomeCache.qualitySummary && minuteOutcomeCache.qualitySummary.eastmoneyMissingCount || 0)),
        eastmoneyMissingCount: Number(minuteOutcomeCache.qualitySummary && minuteOutcomeCache.qualitySummary.eastmoneyMissingCount || 0),
      },
      outcomeCoverage: {
        requestedCount: auditedOutcomes.length,
        validCount: auditedOutcomes.filter((outcome) => outcome && outcome.valid).length,
        sourceCounts: outcomeSourceCounts,
        invalidReasonCounts: invalidOutcomeReasonCounts,
        counterfactualRequestedCount: strictOutcomeAudits.length,
        counterfactualValidCount: strictOutcomeAudits.filter((outcome) => outcome && outcome.valid).length,
      },
      historicalMigration,
      decisionReceiptAudit: {
        authority: decisionReceiptAudit.authority,
        executionAuthority: false,
        sourceFileCount: decisionReceiptAudit.sourceFileCount,
        liveCanonicalCount: decisionReceiptAudit.liveCanonicalCount,
        legacyWithoutReceiptCount: decisionReceiptAudit.legacyWithoutReceiptCount,
        invalidReceiptCount: decisionReceiptAudit.invalidReceiptCount,
        parseFailureCount: decisionReceiptAudit.parseFailureCount,
        duplicateTradingDates: decisionReceiptAudit.duplicateTradingDates,
        reasonCounts: decisionReceiptAudit.reasonCounts,
        records: decisionReceiptAudit.records,
        rule: decisionReceiptAudit.rule,
      },
    },
    rankingStudy: {
      universe: "post_hard_gate_common_pool",
      executionAuthority: false,
      hardGateIncrementalEffectIdentifiable: false,
      dataGap: "历史归档只冻结了旧selected短名单，没有可恢复的全市场公共候选池，因此不宣称验证硬门槛本身的效果。",
      evaluatedPairCount: rankingDays.length,
      daysWithLegacySelected: rankingDays.filter((day) => day.rawLegacySelectedCount > 0).length,
      daysWithComparableUniverse: rankingDays.filter((day) => day.comparableUniverseCount > 0).length,
      summaries,
      comparisons,
      changedTop1Diagnostics: changedDiagnostics,
      cycleGroups: {
        bigCycleTop1: groupPortfolioRows(portfolioRows.unifiedTop1, dayContext, "bigCycle"),
        smallCycleTop1: groupPortfolioRows(portfolioRows.unifiedTop1, dayContext, "smallCycle"),
      },
      days: rankingDays,
      factorEvidenceAudit,
      executionReplayAudit,
      ablationStudy,
      ablationStudyTop1,
      thresholdCalibration,
    },
    frozenDecisionStudy,
    counterfactualReplayStudy: {
      authority: STRICT_SELECTION_AUTHORITY,
      provenance: "counterfactual_current_engine_replay",
      asDecided: false,
      executionAuthority: false,
      label: "当前引擎历史重建（非当晚实盘决策）",
      allocationMethod: "initialPortfolioPct_with_cash",
      primaryPortfolio: "top5",
      summaries: { top1: summaries.strictTop1, top3: summaries.strictTop3, top5: summaries.strictTop5 },
      integrityValidDays: strictDays.filter((day) => day.replayContractIntegrity === "valid").length,
      replayReadyDays: strictDays.filter((day) => day.replayReady).length,
      permissionOpenDays: strictDays.filter((day) => day.permissionAllowNew).length,
      daysWithReconstructedPicks: strictDays.filter((day) => day.reconstructedPickCodes.length > 0).length,
      cashDays: portfolioRows.strictTop5.filter((day) => day && day.valid && day.cashOnly).length,
      invalidContractDays: portfolioRows.strictTop5.filter((day) => day && !day.valid && day.cashOnly).length,
      invalidOutcomeDays: portfolioRows.strictTop5.filter((day) => day && !day.valid && !day.cashOnly).length,
      days: strictDays,
    },
    assessment: validationAssessment(comparisons, strictSummary, frozenDecisionStudy),
  };
}

function markdownNumber(value, suffix = "") {
  return finiteNumber(value) == null ? "—" : `${round(value, 4)}${suffix}`;
}

function renderValidationMarkdown(report) {
  const audit = report.dataAudit;
  const rank = report.rankingStudy;
  const strict = report.counterfactualReplayStudy;
  const frozen = report.frozenDecisionStudy || {};
  const evidenceAudit = rank.factorEvidenceAudit || {};
  const executionReplayAudit = rank.executionReplayAudit || {};
  const ablation = rank.ablationStudy || {};
  const ablationTop1 = rank.ablationStudyTop1 || {};
  const calibration = rank.thresholdCalibration || {};
  const migration = audit.historicalMigration || {};
  const receipts = audit.decisionReceiptAudit || {};
  const lines = [
    "# 统一量化因子第二阶段有效性验证报告",
    "",
    `生成时间：${report.generatedAt}`,
    "",
    `结论状态：**${report.assessment.strategyEffectivenessConfirmed ? "已确认有效" : "尚未确认有效"}**（${report.assessment.rankingStatus}；${report.assessment.counterfactualReplayStatus}）`,
    "",
    report.assessment.reason,
    "",
    "## 数据审计",
    "",
    `- 历史 JSON：${audit.jsonFileCount} 个；可用收盘快照：${audit.usableClosingSnapshotCount} 个；剔除：${audit.rejectedSnapshotCount} 个。`,
    `- 精确 T+1 配对：${audit.exactT1PairCount} 组；冻结 backtest 特征安全：${audit.backtestFeatureSafePairCount} 组；被移除：${audit.backtestFeatureRemovedPairCount} 组。`,
    `- 有旧 selected 的决策日：${rank.daysWithLegacySelected} 日；当前硬门槛后存在共同排序池：${rank.daysWithComparableUniverse} 日。`,
    `- 可比个股结果覆盖：${audit.outcomeCoverage.validCount}/${audit.outcomeCoverage.requestedCount}；独立结果源：${Object.entries(audit.outcomeCoverage.sourceCounts).map(([key, value]) => `${key}=${value}`).join("，") || "无"}。`,
    `- 分时领导力证据覆盖：${evidenceAudit.intradayLeadershipVerifiedCount || 0}/${evidenceAudit.sampleCount || 0}（${markdownNumber(evidenceAudit.intradayLeadershipCoveragePct, "%")}）；执行可行性标签：${Object.entries(evidenceAudit.executionFeasibilityStatusCounts || {}).map(([key, value]) => `${key}=${value}`).join("，") || "无"}。`,
    `- 量比分组：${Object.entries(evidenceAudit.volumeRatioBandCounts || {}).map(([key, value]) => `${key}=${value}`).join("，") || "无"}；市值区间：${Object.entries(evidenceAudit.marketCapBucketCounts || {}).map(([key, value]) => `${key}=${value}`).join("，") || "无"}。`,
    `- v5/v6历史迁移：契约外壳可重建 ${migration.envelopeEligibleCount || 0}/${migration.sourceSnapshotCount || 0} 日；完整递归T-1回放可用 ${migration.reconstructionReadyCount || 0} 日；迁移结果无执行权。`,
    `- 当晚真实决策凭证：live_canonical ${receipts.liveCanonicalCount || 0}/${receipts.sourceFileCount || 0} 日；旧档无凭证 ${receipts.legacyWithoutReceiptCount || 0} 日；无效凭证 ${receipts.invalidReceiptCount || 0} 日。旧档不会用当前回放补造凭证。`,
    `- 执行回放：分钟条覆盖 ${executionReplayAudit.minuteBarCoverageCount || 0}/${executionReplayAudit.sampleCount || 0}；触发 ${executionReplayAudit.triggeredCount || 0} 个、未触发 ${executionReplayAudit.notTriggeredCount || 0} 个；触发样本T+1收盘净收益均值 ${markdownNumber(executionReplayAudit.triggeredOutcomeSummary && executionReplayAudit.triggeredOutcomeSummary.meanNetReturnPct, "%")}、胜率 ${markdownNumber(executionReplayAudit.triggeredOutcomeSummary && executionReplayAudit.triggeredOutcomeSummary.winRatePct, "%")}。`,
    `- 分钟数据来源：新浪5分钟主源通过 ${audit.minuteOutcomeCache && audit.minuteOutcomeCache.primarySourceValidCount || 0} 组；东财交叉确认 ${audit.minuteOutcomeCache && audit.minuteOutcomeCache.crossSourceConfirmedCount || 0} 组。当前是单源分钟数据+独立日线完整性校验，不得写成双源确认。`,
    `- 因子消融（Top${ablation.targetSize || 3}）：去领导力换票 ${ablation.variants && ablation.variants.leadership_dynamic && ablation.variants.leadership_dynamic.comparisonToBaseline.changedDecisionDays || 0} 日；去量比换票 ${ablation.variants && ablation.variants.volume_ratio && ablation.variants.volume_ratio.comparisonToBaseline.changedDecisionDays || 0} 日；市值观察因子换票 ${ablation.variants && ablation.variants.market_cap && ablation.variants.market_cap.comparisonToBaseline.changedDecisionDays || 0} 日。`,
    `- 因子消融（Top1）：去领导力换票 ${ablationTop1.variants && ablationTop1.variants.leadership_dynamic && ablationTop1.variants.leadership_dynamic.comparisonToBaseline.changedDecisionDays || 0} 日；去量比换票 ${ablationTop1.variants && ablationTop1.variants.volume_ratio && ablationTop1.variants.volume_ratio.comparisonToBaseline.changedDecisionDays || 0} 日。`,
    `- 潜在重复计权高相关组合：${ablation.correlationAudit && ablation.correlationAudit.highOverlapPairs && ablation.correlationAudit.highOverlapPairs.length || 0} 组；相关性只作排查，不直接删因子。`,
    `- 样本外校准：${calibration.decision || "未执行"}；本轮自动应用参数：${calibration.calibrationApplied ? "是" : "否"}；候选建议 ${Array.isArray(calibration.eligibleRecommendations) ? calibration.eligibleRecommendations.length : 0} 项。`,
    "",
    "## 排序对照（post_hard_gate_common_pool）",
    "",
    "| 组合 | 有结果决策日 | 平均T+1收盘溢价 | 中位数 | 胜率 | 平均不利波动 |",
    "|---|---:|---:|---:|---:|---:|",
  ];
  for (const [label, key] of [["统一因子 Top1", "unifiedTop1"], ["旧评分 Top1", "legacyTop1"], ["统一因子 Top3", "unifiedTop3"], ["旧评分 Top3", "legacyTop3"], ["统一因子 Top5", "unifiedTop5"], ["旧评分 Top5", "legacyTop5"]]) {
    const summary = rank.summaries[key];
    lines.push(`| ${label} | ${summary.decisionDays} | ${markdownNumber(summary.meanClosePct, "%")} | ${markdownNumber(summary.medianClosePct, "%")} | ${markdownNumber(summary.winRatePct, "%")} | ${markdownNumber(summary.meanAdversePct, "%")} |`);
  }
  lines.push(
    "",
    "| 配对差异 | 配对决策日 | 真正换票日 | 全样本平均差值 | 换票日平均差值 | 统一因子胜出比例 | 状态 |",
    "|---|---:|---:|---:|---:|---:|---|",
    `| Top1 | ${rank.comparisons.top1.pairedDecisionDays} | ${rank.comparisons.top1.changedDecisionDays} | ${markdownNumber(rank.comparisons.top1.meanDeltaClosePct, "%")} | ${markdownNumber(rank.comparisons.top1.changedMeanDeltaClosePct, "%")} | ${markdownNumber(rank.comparisons.top1.positiveDeltaRatePct, "%")} | ${rank.comparisons.top1.status} |`,
    `| Top3 | ${rank.comparisons.top3.pairedDecisionDays} | ${rank.comparisons.top3.changedDecisionDays} | ${markdownNumber(rank.comparisons.top3.meanDeltaClosePct, "%")} | ${markdownNumber(rank.comparisons.top3.changedMeanDeltaClosePct, "%")} | ${markdownNumber(rank.comparisons.top3.positiveDeltaRatePct, "%")} | ${rank.comparisons.top3.status} |`,
    `| Top5 | ${rank.comparisons.top5.pairedDecisionDays} | ${rank.comparisons.top5.changedDecisionDays} | ${markdownNumber(rank.comparisons.top5.meanDeltaClosePct, "%")} | ${markdownNumber(rank.comparisons.top5.changedMeanDeltaClosePct, "%")} | ${markdownNumber(rank.comparisons.top5.positiveDeltaRatePct, "%")} | ${rank.comparisons.top5.status} |`,
    "",
    "### Top1 换票归因",
    "",
    "| 日期 | 统一因子选择 | 旧评分选择 | T+1差值 | 主要正向驱动 |",
    "|---|---|---|---:|---|",
    ...(rank.changedTop1Diagnostics.length
      ? rank.changedTop1Diagnostics.map((row) => `| ${row.tradingDate} | ${row.unifiedName}(${row.unifiedCode}) | ${row.legacyName}(${row.legacyCode}) | ${markdownNumber(row.deltaClosePct, "%")} | ${row.largestPositiveDrivers.map((driver) => `${driver.key} +${driver.value}`).join("；") || "无"} |`)
      : ["| — | 无换票样本 | — | — | — |"]),
    "",
    "## 当晚冻结决策验证（as-decided）",
    "",
    `- live_canonical凭证：${frozen.receiptCount || 0}日；已绑定有效T+1结果：${frozen.settledOutcomeCount || 0}日；待结算：${frozen.pendingOutcomeCount || 0}日；无效侧车：${frozen.invalidOutcomeCount || 0}日。`,
    `- 冻结组合T+1净收益贡献均值：${markdownNumber(frozen.meanNetReturnContributionPct, "%")}；中位数：${markdownNumber(frozen.medianNetReturnContributionPct, "%")}。`,
    "- 本节只读取当晚冻结凭证，不重跑当前模型；没有凭证的旧历史不会进入本节。",
    "",
    "## 当前引擎历史重建（非当晚实盘决策）",
    "",
    "- 本节把当前版本引擎放到旧收盘数据上重建，回答的是反事实问题；不得解释为当晚实际输出、历史实盘信号或已冻结策略表现。",
    `- 当前契约可重建日：${strict.replayReadyDays} 日；重建后许可开放日：${strict.permissionOpenDays} 日；重建后产生候选日：${strict.daysWithReconstructedPicks} 日。`,
    `- 反事实 Top5 按 initialPortfolioPct 计算：可评价日 ${strict.summaries.top5.decisionDays}，其中投资日 ${strict.summaries.top5.investedDecisionDays}，空仓日 ${strict.summaries.top5.cashDecisionDays}；契约不完整日 ${strict.summaries.top5.invalidContractDays}，有票但结果缺失/无效日 ${strict.summaries.top5.invalidOutcomeDays}。`,
    `- 反事实 Top5 平均组合 T+1 收盘条件溢价：${markdownNumber(strict.summaries.top5.meanClosePct, "%")}；平均初始投入仓位：${markdownNumber(strict.summaries.top5.meanInvestedPortfolioPct, "%")}。`,
    "- 权限关闭或无结果股的完整契约日按0收益空仓保留；契约不完整日只做失败审计，不计入绩效。",
    "",
    "## 口径边界",
    "",
    "- 排序研究和当前引擎历史重建测量T+1条件溢价，不能冒充当晚真实输出；只有as-decided部分读取冻结凭证及其显式滑点、费用情景侧车。",
    "- 排序研究主动绕过市场执行许可，仅用于判断共同硬门槛后的相对排序；它不能证明硬门槛有效。反事实重建不绕过许可，但仍不是当晚决策。",
    `- Top1/Top3/Top5在研究前固定，不根据结果动态挑K；主排序口径固定为Top${report.assessment.primaryRankingK}，反事实组合固定为allocated Top5。`,
    "- 本报告没有预注册可交易收益和风险阈值，因此不允许仅凭样本数、方向性差值或胜率确认策略有效。",
  );
  return `${lines.join("\n")}\n`;
}

module.exports = {
  PRICE_INTEGRITY_TOLERANCE_PCT,
  MIN_DIRECTIONAL_DAYS,
  MIN_CONFIRMATION_DAYS,
  FIXED_RANKING_SIZES,
  PRIMARY_RANKING_SIZE,
  STRICT_SELECTION_AUTHORITY,
  normalizeTradingDate,
  snapshotTradingDate,
  snapshotKind,
  migrateHistoricalClosingSnapshot,
  buildHistoricalMigrationAudit,
  loadHistoricalSnapshots,
  buildExactT1Pairs,
  buildOutcome,
  buildKlineOutcome,
  loadOutcomeCache,
  resolveOutcome,
  mergeOutcomeCaches,
  summarizeOutcomeRows,
  buildAllocatedPortfolioRow,
  cycleContext,
  factorEvidenceLabels,
  summarizeFactorEvidenceAudit,
  executionReplayForPick,
  summarizeExecutionReplayAudit,
  factorCorrelationAudit,
  runFactorAblationStudy,
  runThresholdCalibrationStudy,
  replayHistoricalCounterfactualDecision,
  validateCounterfactualDecisionReplay,
  pairedComparison,
  changedTop1Diagnostics,
  validationAssessment,
  buildFrozenDecisionStudy,
  runFactorEffectivenessValidation,
  renderValidationMarkdown,
};
