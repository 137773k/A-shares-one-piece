"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  validateDecisionReceipt,
} = require("./decision-receipt");
const {
  settleDecisionOutcome,
  validateDecisionOutcome,
} = require("./decision-outcome");
const {
  candidateCode,
  loadOutcomeCache,
  mergeOutcomeCaches,
  minuteBarsForOutcomeCache,
  normalizeTradingDate,
  resolveOutcome,
} = require("./outcome-evidence");

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) { return fallback; }
}

function serializeJson(value) {
  return Buffer.from(JSON.stringify(value, null, 2), "utf8");
}

function atomicWrite(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tempFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(5).toString("hex")}.tmp`,
  );
  let descriptor;
  try {
    descriptor = fs.openSync(tempFile, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(tempFile, file);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_ignored) { /* already closed */ }
    }
    try { fs.rmSync(tempFile, { force: true }); } catch (_ignored) { /* best effort */ }
    throw error;
  }
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function exactNextSessionEvidence(currentSnapshot, signalTradingDate, nextTradingDate) {
  const dates = currentSnapshot && currentSnapshot.market && currentSnapshot.market.limitStats
    && currentSnapshot.market.limitStats.dates || {};
  const statedNext = normalizeTradingDate(dates.today);
  const statedPrevious = normalizeTradingDate(dates.prev);
  const valid = dates.verified === true
    && statedNext === nextTradingDate
    && statedPrevious === signalTradingDate;
  return {
    valid,
    authority: "current_exact_closing_provider_calendar",
    nextTradingDate: statedNext,
    previousTradingDate: statedPrevious,
    providerDatesVerified: dates.verified === true,
    executionAuthority: false,
  };
}

function dailyOutcomeInputs(receipt, currentSnapshot, outcomeCache, signalTradingDate, nextTradingDate) {
  const nextCandidates = new Map(
    (Array.isArray(currentSnapshot && currentSnapshot.candidates) ? currentSnapshot.candidates : [])
      .map((stock) => [candidateCode(stock), stock])
      .filter(([code]) => code),
  );
  const stocks = receipt && receipt.decision && receipt.decision.result
    && Array.isArray(receipt.decision.result.stocks) ? receipt.decision.result.stocks : [];
  return Object.fromEntries(stocks.map((stock) => {
    const code = candidateCode(stock);
    const referencePrice = Number(
      stock && stock.executionReplayRule && stock.executionReplayRule.referencePrice
      || stock && stock.price,
    );
    const currentReference = {
      code,
      name: stock && stock.name,
      price: Number.isFinite(referencePrice) && referencePrice > 0 ? referencePrice : null,
    };
    const resolved = resolveOutcome(
      currentReference,
      nextCandidates.get(code),
      outcomeCache,
      signalTradingDate,
      nextTradingDate,
    );
    return [code, {
      ...resolved,
      currentTradingDate: signalTradingDate,
      nextTradingDate,
    }];
  }));
}

function minuteOutcomeInputs(receipt, outcomeCache, nextTradingDate) {
  const stocks = receipt && receipt.decision && receipt.decision.result
    && Array.isArray(receipt.decision.result.stocks) ? receipt.decision.result.stocks : [];
  return Object.fromEntries(stocks.map((stock) => {
    const code = candidateCode(stock);
    const series = outcomeCache && outcomeCache.series && outcomeCache.series[code] || {};
    const bars = minuteBarsForOutcomeCache(outcomeCache, code, nextTradingDate);
    const quality = series.minuteQualityByDate && series.minuteQualityByDate[nextTradingDate] || {};
    return [code, {
      validForExecutionReplay: quality.validForExecutionReplay === true,
      nextTradingDate,
      source: series.minuteSource || series.source || "minute_outcome_cache",
      bars,
      quality,
    }];
  }));
}

function outcomeCompleteness(outcome) {
  if (!outcome || typeof outcome !== "object") return 0;
  if (["settled", "not_triggered", "cash_only"].includes(outcome.status) && outcome.validOutcome === true) return 3;
  if (outcome.status === "incomplete") return 2;
  return 1;
}

function writeDecisionOutcome(outcome, options = {}) {
  if (typeof validateDecisionOutcome !== "function") {
    throw new Error("decision outcome validator unavailable");
  }
  const inspection = validateDecisionOutcome(outcome, { decisionReceipt: options.decisionReceipt });
  if (!inspection.valid) {
    throw new Error(`决策结果侧车完整性失败:${inspection.reasons.join(",")}`);
  }
  const signalDate = normalizeTradingDate(outcome && outcome.generation && outcome.generation.tradingDate);
  if (!signalDate) throw new Error("决策结果缺少有效T日");
  const runtimeRoot = path.resolve(options.runtimeRoot || process.env.A_SHARE_RUNTIME_DIR || path.join(__dirname, ".."));
  const outcomeDir = path.resolve(options.outcomeDir || path.join(runtimeRoot, "data", "decision-outcomes"));
  const revisionDir = path.resolve(options.revisionDir || path.join(runtimeRoot, "data", "decision-outcome-revisions"));
  const file = path.join(outcomeDir, `${signalDate}.json`);
  const nextBytes = serializeJson(outcome);
  let revisionFile = null;
  if (fs.existsSync(file)) {
    const previousBytes = fs.readFileSync(file);
    const previous = readJson(file, null);
    const previousInspection = validateDecisionOutcome(previous, {
      decisionReceipt: options.decisionReceipt,
    });
    if (!previousInspection.valid) {
      throw new Error(`现有决策结果侧车完整性失败，拒绝覆盖:${previousInspection.reasons.join(",")}`);
    }
    if (previous && previous.settlementHash === outcome.settlementHash) {
      return { ok: true, changed: false, file, revisionFile: null, outcome: previous };
    }
    const previousReceiptId = previous && previous.receiptBinding
      && previous.receiptBinding.receiptId;
    if (!previous || previousReceiptId !== outcome.receiptBinding.receiptId) {
      throw new Error("同一T日结果侧车receiptId冲突，拒绝静默覆盖");
    }
    if (previous.generation && previous.generation.nextTradingDate
      !== outcome.generation.nextTradingDate) {
      throw new Error("同一决策凭证T+1交易日冲突，拒绝覆盖");
    }
    if (outcomeCompleteness(outcome) < outcomeCompleteness(previous)) {
      return { ok: true, changed: false, skipped: true, reason: "outcome-completeness-downgrade", file, outcome: previous };
    }
    const revisionHash = sha256Bytes(previousBytes);
    revisionFile = path.join(revisionDir, signalDate, `${revisionHash}.json`);
    if (!fs.existsSync(revisionFile)) atomicWrite(revisionFile, previousBytes);
  }
  atomicWrite(file, nextBytes);
  const reread = readJson(file, null);
  const rereadInspection = validateDecisionOutcome(reread, { decisionReceipt: options.decisionReceipt });
  if (!rereadInspection.valid || reread.settlementHash !== outcome.settlementHash) {
    throw new Error("决策结果侧车写入后复核失败");
  }
  return { ok: true, changed: true, file, revisionFile, outcome: reread };
}

function settleExactPreviousDecision(currentSnapshot, options = {}) {
  const runtimeRoot = path.resolve(options.runtimeRoot || process.env.A_SHARE_RUNTIME_DIR || path.join(__dirname, ".."));
  const nextTradingDate = normalizeTradingDate(
    currentSnapshot && currentSnapshot.market && currentSnapshot.market.limitStats
    && currentSnapshot.market.limitStats.dates && currentSnapshot.market.limitStats.dates.today,
  );
  const signalTradingDate = normalizeTradingDate(
    currentSnapshot && currentSnapshot.market && currentSnapshot.market.limitStats
    && currentSnapshot.market.limitStats.dates && currentSnapshot.market.limitStats.dates.prev,
  );
  const snapshotKind = String(currentSnapshot && currentSnapshot.archiveMeta
    && currentSnapshot.archiveMeta.snapshotKind || "unknown");
  if (!nextTradingDate || !signalTradingDate || snapshotKind !== "closing") {
    return { ok: false, skipped: true, reason: "exact_closing_t1_context_missing" };
  }
  const historyDir = path.resolve(options.historyDir || path.join(runtimeRoot, "data", "history"));
  const signalFile = path.join(historyDir, `${signalTradingDate}.json`);
  const signalSnapshot = readJson(signalFile, null);
  if (!signalSnapshot) return { ok: false, skipped: true, reason: "signal_archive_missing", signalTradingDate };
  const receipt = signalSnapshot.decisionReceipt;
  const receiptInspection = validateDecisionReceipt(receipt, {
    sourcePayload: signalSnapshot,
    snapshotKind: signalSnapshot.archiveMeta && signalSnapshot.archiveMeta.snapshotKind,
  });
  if (!receiptInspection.liveCanonical) {
    return {
      ok: false,
      skipped: true,
      reason: receipt ? "signal_decision_receipt_invalid" : "legacy_signal_archive_without_receipt",
      signalTradingDate,
      blockers: receiptInspection.reasons,
    };
  }

  const dailyCache = loadOutcomeCache(
    options.dailyOutcomeCachePath || path.join(runtimeRoot, "data", "factor-validation-outcomes.json"),
  );
  const minuteCache = loadOutcomeCache(
    options.minuteOutcomeCachePath || path.join(runtimeRoot, "data", "factor-validation-minute-outcomes.json"),
  );
  const mergedCache = mergeOutcomeCaches(dailyCache, minuteCache);
  const outcome = settleDecisionOutcome({
    decisionReceipt: receipt,
    nextTradingDate,
    nextSessionEvidence: exactNextSessionEvidence(currentSnapshot, signalTradingDate, nextTradingDate),
    dailyOutcomes: dailyOutcomeInputs(receipt, currentSnapshot, mergedCache, signalTradingDate, nextTradingDate),
    minuteOutcomes: minuteOutcomeInputs(receipt, mergedCache, nextTradingDate),
    slippageBps: options.slippageBps,
    feeBps: options.feeBps,
  });
  const write = writeDecisionOutcome(outcome, {
    ...options,
    runtimeRoot,
    decisionReceipt: receipt,
  });
  return {
    ok: true,
    skipped: false,
    signalTradingDate,
    nextTradingDate,
    receiptId: receipt.receiptId,
    outcomeStatus: outcome.status,
    validOutcome: outcome.validOutcome === true,
    write,
  };
}

function refreshDecisionOutcomeLedger(options = {}) {
  const runtimeRoot = path.resolve(options.runtimeRoot || process.env.A_SHARE_RUNTIME_DIR || path.join(__dirname, ".."));
  const historyDir = path.resolve(options.historyDir || path.join(runtimeRoot, "data", "history"));
  const files = fs.existsSync(historyDir)
    ? fs.readdirSync(historyDir).filter((name) => /^20\d{2}-\d{2}-\d{2}\.json$/.test(name)).sort()
    : [];
  const results = [];
  for (const fileName of files) {
    const snapshot = readJson(path.join(historyDir, fileName), null);
    if (!snapshot || !snapshot.archiveMeta || snapshot.archiveMeta.snapshotKind !== "closing") continue;
    const result = settleExactPreviousDecision(snapshot, { ...options, runtimeRoot, historyDir });
    results.push({ nextFile: fileName, ...result, write: result.write ? {
      changed: result.write.changed,
      file: result.write.file,
      revisionFile: result.write.revisionFile,
    } : undefined });
  }
  return {
    version: 1,
    authority: "decision_outcome_ledger_refresh_v1",
    executionAuthority: false,
    scannedClosingSnapshots: results.length,
    settledOrRecordedCount: results.filter((row) => row.ok && !row.skipped).length,
    skippedCount: results.filter((row) => row.skipped).length,
    results,
  };
}

module.exports = {
  readJson,
  exactNextSessionEvidence,
  dailyOutcomeInputs,
  minuteOutcomeInputs,
  writeDecisionOutcome,
  settleExactPreviousDecision,
  refreshDecisionOutcomeLedger,
};
