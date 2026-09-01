"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveFetchEvidenceQuality } = require("./fetch-evidence-quality");

const EVIDENCE_VERSION = 1;
const DEFAULT_REQUESTED_DAYS = 5;
const INDEX_CODE = "883421";
const INDEX_NAME = "同花顺全A(沪深)";
const INDEX_SOURCE = "ths-public-page";

function normalizeTradingDate(value) {
  const match = String(value || "").trim().match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFinite(...values) {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function roundNumber(value, digits = 2) {
  const number = finiteNumber(value);
  if (number === null) return null;
  const factor = 10 ** digits;
  return Math.round((number + Number.EPSILON) * factor) / factor;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function providerCalendar(payload, expectedDateValue) {
  const expectedDate = normalizeTradingDate(expectedDateValue);
  const dates = payload && payload.market && payload.market.limitStats
    && payload.market.limitStats.dates;
  if (!dates || typeof dates !== "object" || dates.verified !== true) return null;
  const today = normalizeTradingDate(dates.today);
  const prev = normalizeTradingDate(dates.prev);
  const prev2 = normalizeTradingDate(dates.prev2);
  if (!expectedDate || today !== expectedDate || !prev || prev >= today) return null;
  return {
    today,
    prev,
    prev2: prev2 && prev2 < prev ? prev2 : null,
    verified: true,
    calendarQuality: String(dates.calendarQuality || "") || null,
  };
}

function evaluateStrictClosingPayload(payload, expectedDateValue, options = {}) {
  const expectedDate = normalizeTradingDate(expectedDateValue);
  const filenameDate = normalizeTradingDate(options.filenameDate);
  const archiveMeta = payload && payload.archiveMeta && typeof payload.archiveMeta === "object"
    ? payload.archiveMeta
    : {};
  const snapshot = payload && payload.market && payload.market.snapshot
    && typeof payload.market.snapshot === "object"
    ? payload.market.snapshot
    : {};
  const allA = snapshot.allA && typeof snapshot.allA === "object" ? snapshot.allA : {};
  const providerDates = payload && payload.market && payload.market.limitStats
    && payload.market.limitStats.dates && typeof payload.market.limitStats.dates === "object"
    ? payload.market.limitStats.dates
    : {};
  const reasons = [];

  if (!payload || typeof payload !== "object") reasons.push("payload_missing");
  if (!expectedDate) reasons.push("expected_date_missing");
  if (!filenameDate || filenameDate !== expectedDate) reasons.push("filename_date_mismatch");

  const providerDate = normalizeTradingDate(providerDates.today);
  if (!providerDate || providerDate !== expectedDate) reasons.push("provider_date_mismatch");
  if (providerDates.verified !== true) reasons.push("provider_calendar_unverified");

  const archiveDate = normalizeTradingDate(archiveMeta.tradingDate);
  if (!archiveDate || archiveDate !== expectedDate) reasons.push("archive_date_mismatch");
  if (String(archiveMeta.snapshotKind || "").trim().toLowerCase() !== "closing") {
    reasons.push("snapshot_not_closing");
  }

  const declaredDates = [
    payload && payload.tradingDate,
    snapshot.tradingDate,
    payload && payload.generationContext && payload.generationContext.tradingDate,
  ].map(normalizeTradingDate).filter(Boolean);
  if (declaredDates.some((date) => date !== expectedDate)) reasons.push("payload_date_mismatch");

  const themeSnapshotKind = String(
    payload && payload.themeLibrary && payload.themeLibrary.snapshotKind || "",
  ).trim().toLowerCase();
  if (themeSnapshotKind && themeSnapshotKind !== "closing") reasons.push("theme_snapshot_not_closing");

  const fetchLevel = String(payload && payload.fetchStatus && payload.fetchStatus.level || "")
    .trim()
    .toLowerCase();
  const fetchEvidenceQuality = resolveFetchEvidenceQuality(payload, expectedDate, { marketOnly: true });
  if (!fetchEvidenceQuality.closingEvidenceUsable) reasons.push(...(
    fetchEvidenceQuality.reasons.length ? fetchEvidenceQuality.reasons : ["fetch_evidence_unusable"]
  ));
  if (payload && payload.stale === true) reasons.push("payload_stale");
  if (String(payload && payload.fetchError || "").trim()) reasons.push("fetch_error_present");

  if (String(allA.source || "").trim().toLowerCase() !== INDEX_SOURCE) {
    reasons.push("all_a_source_untrusted");
  }
  const open = finiteNumber(allA.open);
  const high = finiteNumber(allA.high);
  const low = finiteNumber(allA.low);
  const close = firstFinite(allA.close, allA.price, allA.current);
  const changePct = finiteNumber(allA.changePct);
  const prices = [open, high, low, close];
  if (prices.some((value) => value === null || value <= 0)) {
    reasons.push("all_a_ohlc_missing_or_nonpositive");
  } else if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
    reasons.push("all_a_ohlc_invalid");
  }
  if (changePct === null) reasons.push("all_a_change_pct_invalid");

  const amountYi = firstFinite(snapshot.shszAmountYi, snapshot.totalAmountYi);
  if (amountYi === null || amountYi <= 0) reasons.push("turnover_missing_or_nonpositive");

  return {
    ok: reasons.length === 0,
    expectedDate: expectedDate || null,
    reasons: unique(reasons),
    values: reasons.length === 0 ? {
      open: roundNumber(open),
      high: roundNumber(high),
      low: roundNumber(low),
      close: roundNumber(close),
      changePct: roundNumber(changePct),
      amountYi: roundNumber(amountYi),
    } : null,
  };
}

function readJsonFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    const wrapped = new Error(`历史证据 JSON 无法解析: ${path.basename(filePath)}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

function createFormalArchiveStore(historyDir) {
  if (!fs.existsSync(historyDir)) {
    return { dates: [], has: () => false, get: () => null };
  }
  const entries = fs.readdirSync(historyDir, { withFileTypes: true });
  const files = new Map();
  entries.forEach((entry) => {
    if (!entry.isFile()) return;
    const match = entry.name.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!match) return;
    files.set(match[1], path.join(historyDir, entry.name));
  });
  const cache = new Map();
  return {
    dates: Array.from(files.keys()).sort(),
    has: (date) => files.has(date),
    get(date) {
      if (!files.has(date)) return null;
      if (!cache.has(date)) {
        cache.set(date, {
          tradingDate: date,
          file: path.basename(files.get(date)),
          payload: readJsonFile(files.get(date)),
        });
      }
      return cache.get(date);
    },
  };
}

function buildProviderWindow(store, requestedDays) {
  if (!store.dates.length) return { slots: [], complete: false, stoppedAfter: null };
  const latestDate = store.dates[store.dates.length - 1];
  const slots = [];
  const seen = new Set();
  let currentDate = latestDate;
  let providerContinuation = null;
  let stoppedAfter = null;

  while (currentDate && slots.length < requestedDays && !seen.has(currentDate)) {
    seen.add(currentDate);
    const record = store.get(currentDate);
    slots.push({ tradingDate: currentDate, record });
    if (slots.length >= requestedDays) break;

    const calendar = record ? providerCalendar(record.payload, currentDate) : null;
    if (calendar) {
      currentDate = calendar.prev;
      providerContinuation = calendar.prev2;
      continue;
    }
    if (!record && providerContinuation && !seen.has(providerContinuation)) {
      currentDate = providerContinuation;
      providerContinuation = null;
      continue;
    }
    if (record && providerContinuation && !seen.has(providerContinuation)) {
      currentDate = providerContinuation;
      providerContinuation = null;
      continue;
    }
    stoppedAfter = currentDate;
    currentDate = null;
  }

  return {
    slots,
    complete: slots.length === requestedDays,
    stoppedAfter,
  };
}

function revisionDateFromPath(filePath) {
  const basename = path.basename(filePath);
  const nameMatch = basename.match(/^(\d{4}-\d{2}-\d{2})(?:--|\.json$)/);
  if (nameMatch) return nameMatch[1];
  return normalizeTradingDate(path.basename(path.dirname(filePath)));
}

function collectRevisionFiles(revisionRoot, wantedDates) {
  const result = new Map();
  if (!revisionRoot || !fs.existsSync(revisionRoot) || !wantedDates.size) return result;

  function walk(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    entries.forEach((entry) => {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(filePath);
        return;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) return;
      const date = revisionDateFromPath(filePath);
      if (!wantedDates.has(date)) return;
      if (!result.has(date)) result.set(date, []);
      result.get(date).push(filePath);
    });
  }

  walk(revisionRoot);
  for (const files of result.values()) files.sort();
  return result;
}

function comparisonFor(latestAmountYi, previousAmountYi) {
  if (!(latestAmountYi > 0) || !(previousAmountYi > 0)) {
    return {
      pct: null,
      key: "unavailable",
      label: "相邻严格收盘证据不足",
    };
  }
  const pct = roundNumber((latestAmountYi / previousAmountYi - 1) * 100);
  if (pct >= 5) return { pct, key: "expanded", label: "较前一交易日放量" };
  if (pct <= -5) return { pct, key: "contracted", label: "较前一交易日缩量" };
  return { pct, key: "flat", label: "较前一交易日基本持平" };
}

function emptyEvidence(requestedDays = DEFAULT_REQUESTED_DAYS) {
  return {
    version: EVIDENCE_VERSION,
    index: {
      code: INDEX_CODE,
      name: INDEX_NAME,
      source: INDEX_SOURCE,
      points: [],
    },
    turnover: {
      unit: "亿元",
      source: "closing_market_snapshot",
      points: [],
      latestAmountYi: null,
      previousAmountYi: null,
      latestVsPreviousPct: null,
      latestVsPreviousKey: "unavailable",
      latestVsPreviousLabel: "相邻严格收盘证据不足",
      averageAmountYi: null,
      vsAveragePct: null,
      rangePositionPct: null,
      note: "成交额变化仅描述已发生的历史事实，不是明日预测。",
    },
    dataQuality: {
      status: "unavailable",
      requestedDays,
      availableDays: 0,
      strictClosingOnly: true,
      consecutive: false,
      missingDates: [],
      gaps: [],
      excluded: [],
      rejected: [],
      note: "没有正式历史收盘档，未生成指数或成交额证据。",
    },
  };
}

function buildIndexOpportunityEvidence(options = {}) {
  const historyDir = path.resolve(options.historyDir || path.join(__dirname, "data", "history"));
  const revisionRoot = options.revisionRoot === undefined
    ? path.join(path.dirname(historyDir), "history-revisions")
    : options.revisionRoot;
  const requestedDays = Number.isInteger(options.requestedDays) && options.requestedDays > 0
    ? options.requestedDays
    : DEFAULT_REQUESTED_DAYS;
  const store = createFormalArchiveStore(historyDir);
  if (!store.dates.length) return emptyEvidence(requestedDays);

  const window = buildProviderWindow(store, requestedDays);
  const newestFirst = window.slots;
  const evaluations = newestFirst.map((slot) => {
    if (!slot.record) {
      return {
        ...slot,
        evaluation: {
          ok: false,
          expectedDate: slot.tradingDate,
          reasons: ["formal_archive_missing"],
          values: null,
        },
      };
    }
    return {
      ...slot,
      evaluation: evaluateStrictClosingPayload(slot.record.payload, slot.tradingDate, {
        filenameDate: slot.record.tradingDate,
      }),
    };
  });

  const rejectedDates = new Set(
    evaluations.filter((item) => !item.evaluation.ok).map((item) => item.tradingDate),
  );
  const revisionFiles = collectRevisionFiles(revisionRoot, rejectedDates);
  const excluded = [];
  revisionFiles.forEach((files, tradingDate) => {
    files.forEach((filePath) => {
      const payload = readJsonFile(filePath);
      const evaluation = evaluateStrictClosingPayload(payload, tradingDate, { filenameDate: tradingDate });
      excluded.push({
        tradingDate,
        source: "history_revision",
        file: path.relative(revisionRoot, filePath).split(path.sep).join("/"),
        reasons: unique(["revision_not_formal_archive", ...evaluation.reasons]),
      });
    });
  });
  excluded.sort((left, right) => (
    left.tradingDate.localeCompare(right.tradingDate) || left.file.localeCompare(right.file)
  ));
  const excludedByDate = new Map();
  excluded.forEach((item) => {
    if (!excludedByDate.has(item.tradingDate)) excludedByDate.set(item.tradingDate, []);
    excludedByDate.get(item.tradingDate).push(item);
  });

  const chronological = evaluations.slice().reverse();
  const indexPoints = [];
  const turnoverPoints = [];
  const rejected = [];
  const gaps = [];

  chronological.forEach((item) => {
    const revisionCandidates = excludedByDate.get(item.tradingDate) || [];
    const reasons = unique([
      ...item.evaluation.reasons,
      ...revisionCandidates.flatMap((candidate) => candidate.reasons),
    ]);
    const quality = item.evaluation.ok ? "strict_closing" : "missing";
    const values = item.evaluation.ok ? item.evaluation.values : null;
    indexPoints.push({
      tradingDate: item.tradingDate,
      open: values ? values.open : null,
      high: values ? values.high : null,
      low: values ? values.low : null,
      close: values ? values.close : null,
      changePct: values ? values.changePct : null,
      quality,
    });
    turnoverPoints.push({
      tradingDate: item.tradingDate,
      amountYi: values ? values.amountYi : null,
      quality,
    });
    if (!item.evaluation.ok) {
      gaps.push({
        tradingDate: item.tradingDate,
        reason: item.record ? "formal_archive_rejected" : "formal_archive_missing",
        reasons,
      });
      if (item.record) {
        rejected.push({
          tradingDate: item.tradingDate,
          source: "formal_history",
          file: item.record.file,
          reasons: item.evaluation.reasons,
        });
      }
    }
  });
  if (!window.complete) {
    gaps.push({
      tradingDate: null,
      reason: "provider_chain_incomplete",
      afterTradingDate: window.stoppedAfter,
      reasons: ["provider_previous_trading_date_unavailable"],
    });
  }

  const availableDays = turnoverPoints.filter((point) => point.quality === "strict_closing").length;
  const complete = window.complete && availableDays === requestedDays;
  const latestPoint = turnoverPoints.at(-1) || null;
  const previousPoint = turnoverPoints.at(-2) || null;
  const latestAmountYi = latestPoint && latestPoint.quality === "strict_closing" ? latestPoint.amountYi : null;
  const previousAmountYi = previousPoint && previousPoint.quality === "strict_closing" ? previousPoint.amountYi : null;
  const comparison = comparisonFor(latestAmountYi, previousAmountYi);
  const exactAmounts = turnoverPoints.map((point) => point.amountYi).filter((value) => value !== null);
  const averageAmountYi = complete
    ? roundNumber(exactAmounts.reduce((sum, value) => sum + value, 0) / exactAmounts.length)
    : null;
  const vsAveragePct = complete && averageAmountYi > 0
    ? roundNumber((latestAmountYi / averageAmountYi - 1) * 100)
    : null;
  const amountMin = complete ? Math.min(...exactAmounts) : null;
  const amountMax = complete ? Math.max(...exactAmounts) : null;
  const rangePositionPct = complete && amountMax > amountMin
    ? roundNumber((latestAmountYi - amountMin) / (amountMax - amountMin) * 100)
    : null;
  const missingDates = indexPoints
    .filter((point) => point.quality !== "strict_closing")
    .map((point) => point.tradingDate);
  const status = availableDays === 0 ? "unavailable" : complete ? "complete" : "partial";

  return {
    version: EVIDENCE_VERSION,
    index: {
      code: INDEX_CODE,
      name: INDEX_NAME,
      source: INDEX_SOURCE,
      points: indexPoints,
    },
    turnover: {
      unit: "亿元",
      source: "closing_market_snapshot",
      points: turnoverPoints,
      latestAmountYi,
      previousAmountYi,
      latestVsPreviousPct: comparison.pct,
      latestVsPreviousKey: comparison.key,
      latestVsPreviousLabel: comparison.label,
      averageAmountYi,
      vsAveragePct,
      rangePositionPct,
      note: "成交额变化仅描述最近两个相邻严格交易日已经发生的事实，不是明日预测。",
    },
    dataQuality: {
      status,
      requestedDays,
      availableDays,
      strictClosingOnly: true,
      consecutive: complete,
      missingDates,
      gaps,
      excluded,
      rejected,
      note: complete
        ? `${requestedDays}个交易日均通过严格收盘证据门。`
        : `最近${requestedDays}个实际交易日仅${availableDays}个通过严格收盘证据门；缺失或拒绝时不计算5日均值，也不以更早日期补位。`,
    },
  };
}

function defaultSendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function serveIndexOpportunityEvidence(request, response, options = {}) {
  const sendJson = typeof options.sendJson === "function" ? options.sendJson : defaultSendJson;
  if (String(request && request.method || "GET").toUpperCase() !== "GET") {
    sendJson(response, 405, { ok: false, error: "Method Not Allowed" });
    return;
  }
  try {
    const evidence = buildIndexOpportunityEvidence(options);
    sendJson(response, 200, { ok: true, evidence });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: "指数机会证据读取失败",
      detail: String(error && error.message || error),
    });
  }
}

module.exports = {
  EVIDENCE_VERSION,
  buildIndexOpportunityEvidence,
  evaluateStrictClosingPayload,
  normalizeTradingDate,
  providerCalendar,
  serveIndexOpportunityEvidence,
};
