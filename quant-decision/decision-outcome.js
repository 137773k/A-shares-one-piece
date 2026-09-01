"use strict";

const { buildExecutionReplay } = require("./execution-replay");
const {
  DECISION_RECEIPT_AUTHORITY: RECEIPT_AUTHORITY,
  LIVE_CANONICAL_STATUS,
  validateDecisionReceipt: validateCanonicalDecisionReceipt,
  stableSha256,
} = require("./decision-receipt");
const { DEFAULT_PRICE_INTEGRITY_TOLERANCE_PCT } = require("./outcome-evidence");

const DECISION_OUTCOME_SCHEMA_VERSION = 1;
const DECISION_OUTCOME_AUTHORITY = "decision_receipt_t1_settlement_v1";
const MAX_RESULT_STOCKS = 5;
const DEFAULT_SLIPPAGE_BPS = 5;
const DEFAULT_FEE_BPS = 8;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positive(value) {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
}

function round(value, digits = 4) {
  const number = finite(value);
  if (number === null) return null;
  const scale = 10 ** digits;
  return Math.round(number * scale) / scale;
}

function normalizeTradingDate(value) {
  const raw = text(value);
  const match = raw.match(/^(20\d{2})[-/]?(\d{2})[-/]?(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function codeOf(value) {
  const raw = typeof value === "object" && value
    ? text(value.code || value.secCode || value.symbol)
    : text(value);
  const match = raw.match(/(\d{6})/);
  return match ? match[1] : raw;
}

function unique(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean)));
}

function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableClone(value[key]);
    return result;
  }, {});
}

function hashStable(value) {
  return stableSha256(stableClone(value));
}

function inspectDecisionReceiptForSettlement(decisionReceipt) {
  const receipt = decisionReceipt && typeof decisionReceipt === "object" ? decisionReceipt : {};
  const canonicalValidation = validateCanonicalDecisionReceipt(receipt);
  const generation = receipt.generation && typeof receipt.generation === "object" ? receipt.generation : {};
  const decision = receipt.decision && typeof receipt.decision === "object" ? receipt.decision : {};
  const authorization = decision.authorization && typeof decision.authorization === "object"
    ? decision.authorization : {};
  const tradePermission = authorization.tradePermission && typeof authorization.tradePermission === "object"
    ? authorization.tradePermission : {};
  const result = decision.result && typeof decision.result === "object" ? decision.result : {};
  const stocks = Array.isArray(result.stocks) ? result.stocks : [];
  const selectedCodes = Array.isArray(result.selectedCodes) ? result.selectedCodes.map(codeOf).filter(Boolean) : [];
  const stockCodes = stocks.map(codeOf).filter(Boolean);
  const selectedCount = finite(result.selectedCount);
  const maxStocks = finite(result.maxStocks);
  const tradingDate = normalizeTradingDate(generation.tradingDate);
  const authorized = authorization.passed === true && tradePermission.allowNew === true;
  const blockers = unique([
    ...(canonicalValidation.reasons || []),
    canonicalValidation.valid !== true ? "receipt_not_live_canonical" : null,
    receipt.authority !== RECEIPT_AUTHORITY ? "receipt_authority_invalid" : null,
    receipt.status !== LIVE_CANONICAL_STATUS ? "receipt_status_not_live_canonical" : null,
    !receipt.integrity || receipt.integrity.ok !== true ? "receipt_integrity_not_ok" : null,
    !text(receipt.receiptId) ? "receipt_id_missing" : null,
    !text(receipt.hashes && receipt.hashes.decisionHash) ? "decision_hash_missing" : null,
    !text(receipt.hashes && receipt.hashes.sourceHash) ? "source_hash_missing" : null,
    !tradingDate ? "receipt_trading_date_invalid" : null,
    !text(generation.generationId) ? "receipt_generation_id_missing" : null,
    !text(generation.asOf) || !Number.isFinite(Date.parse(generation.asOf)) ? "receipt_as_of_invalid" : null,
    generation.aligned !== true ? "receipt_generation_not_aligned" : null,
    !decision.authorization || typeof decision.authorization !== "object"
      ? "receipt_authorization_missing" : null,
    !decision.result || typeof decision.result !== "object" ? "receipt_result_missing" : null,
    maxStocks !== MAX_RESULT_STOCKS ? "receipt_max_stocks_invalid" : null,
    selectedCount === null || selectedCount !== stocks.length || selectedCount !== selectedCodes.length
      ? "receipt_selected_count_mismatch" : null,
    selectedCodes.join(",") !== stockCodes.join(",") ? "receipt_selected_codes_mismatch" : null,
    new Set(stockCodes).size !== stockCodes.length ? "receipt_selected_codes_duplicated" : null,
    stocks.length > MAX_RESULT_STOCKS ? "receipt_result_exceeds_limit" : null,
    !authorized && stocks.length ? "unauthorized_receipt_contains_stocks" : null,
  ]);

  let allocationTotalPct = 0;
  let relativeTotalPct = 0;
  stocks.forEach((stock) => {
    const code = codeOf(stock);
    const allocation = stock && stock.positionAllocation && typeof stock.positionAllocation === "object"
      ? stock.positionAllocation : {};
    const initial = finite(allocation.initialPortfolioPct);
    const maximum = finite(allocation.maximumPortfolioPct);
    const relative = finite(allocation.relativeWeightPct);
    if (!code) blockers.push("receipt_stock_code_missing");
    if (initial === null || maximum === null || relative === null
      || initial <= 0 || maximum < initial || maximum > 100 || relative < 0 || relative > 100) {
      blockers.push(code ? `receipt_allocation_invalid:${code}` : "receipt_allocation_invalid");
      return;
    }
    allocationTotalPct += initial;
    relativeTotalPct += relative;
  });
  if (allocationTotalPct > 100.001) blockers.push("receipt_initial_allocation_exceeds_100");
  if (stocks.length && Math.abs(relativeTotalPct - 100) > 0.11) {
    blockers.push("receipt_relative_allocation_not_100");
  }

  return {
    ok: blockers.length === 0,
    blockers: unique(blockers),
    receipt,
    generation,
    decision,
    authorization,
    result,
    stocks,
    selectedCodes,
    tradingDate,
    authorized,
    allocationTotalPct: round(allocationTotalPct, 4),
  };
}

function valueForCode(container, code, nextTradingDate) {
  if (!container) return null;
  if (container instanceof Map) {
    return container.get(`${code}@${nextTradingDate}`)
      ?? container.get(`${code}:${nextTradingDate}`)
      ?? container.get(code)
      ?? null;
  }
  if (Array.isArray(container)) {
    return container.find((row) => (
      codeOf(row) === code
      && (!normalizeTradingDate(row && (row.nextTradingDate || row.nextDate || row.tradingDate || row.date))
        || normalizeTradingDate(row && (row.nextTradingDate || row.nextDate || row.tradingDate || row.date)) === nextTradingDate)
    )) || null;
  }
  if (typeof container !== "object") return null;
  const direct = container[`${code}@${nextTradingDate}`]
    ?? container[`${code}:${nextTradingDate}`]
    ?? container[code]
    ?? null;
  if (direct && typeof direct === "object" && !Array.isArray(direct) && direct[nextTradingDate] !== undefined) {
    return direct[nextTradingDate];
  }
  return direct;
}

function normalizeNextSessionEvidence(raw, tradingDate, nextTradingDate) {
  const value = raw && typeof raw === "object" ? raw : {};
  const statedNextDate = normalizeTradingDate(value.nextTradingDate || value.tradingDate || value.date);
  const statedPreviousDate = normalizeTradingDate(
    value.previousTradingDate || value.prevTradingDate || value.previousDate || value.prevDate,
  );
  const blockers = unique([
    value.valid !== true ? "next_session_evidence_not_valid" : null,
    !text(value.authority || value.source) ? "next_session_evidence_authority_missing" : null,
    !statedNextDate ? "next_session_evidence_date_missing" : null,
    statedNextDate && statedNextDate !== nextTradingDate ? "next_session_evidence_date_mismatch" : null,
    !statedPreviousDate ? "next_session_previous_date_missing" : null,
    statedPreviousDate && statedPreviousDate !== tradingDate ? "next_session_not_exact_t1" : null,
  ]);
  return {
    valid: blockers.length === 0,
    authority: text(value.authority || value.source) || null,
    tradingDate: statedNextDate,
    previousTradingDate: statedPreviousDate,
    exactPreviousTradingDate: statedPreviousDate === tradingDate,
    executionAuthority: false,
    blockers,
  };
}

function normalizeDailyOutcome(raw, code, tradingDate, nextTradingDate, referencePrice = null) {
  const value = raw && typeof raw === "object" ? raw : null;
  if (!value) {
    return { valid: false, code, blockers: ["daily_outcome_missing"] };
  }
  const statedNextDate = normalizeTradingDate(
    value.nextTradingDate || value.nextDate || value.tradingDate || value.date,
  );
  const statedCurrentDate = normalizeTradingDate(
    value.currentTradingDate || value.signalTradingDate || value.currentDate || value.signalDate,
  );
  const currentClose = positive(value.currentClose ?? value.previousClose ?? value.signalClose);
  const nextOpen = positive(value.nextOpen ?? value.open);
  const nextHigh = positive(value.nextHigh ?? value.high);
  const nextLow = positive(value.nextLow ?? value.low);
  const nextClose = positive(value.nextClose ?? value.close);
  const reportedPriceDifference = finite(value.priceDifferencePct);
  const reportedPriceDifferencePct = reportedPriceDifference === null
    ? null : Math.abs(reportedPriceDifference);
  const nextPrevClose = positive(value.nextPrevClose ?? value.previousCloseOnNextSession);
  const referenceDifferencePct = currentClose && positive(referencePrice)
    ? Math.abs(currentClose / positive(referencePrice) - 1) * 100 : null;
  const nextPrevDifferencePct = currentClose && nextPrevClose
    ? Math.abs(nextPrevClose / currentClose - 1) * 100 : null;
  const priceIntegrityDifferencePct = reportedPriceDifferencePct
    ?? nextPrevDifferencePct
    ?? referenceDifferencePct;
  const blockers = unique([
    value.valid !== true ? `daily_outcome_invalid:${text(value.reason) || "source_not_verified"}` : null,
    !statedCurrentDate ? "daily_current_date_missing" : null,
    statedCurrentDate && statedCurrentDate !== tradingDate ? "daily_current_date_mismatch" : null,
    !statedNextDate ? "daily_next_date_missing" : null,
    statedNextDate && statedNextDate !== nextTradingDate ? "daily_outcome_date_mismatch" : null,
    currentClose === null ? "daily_current_close_missing" : null,
    nextOpen === null ? "daily_next_open_missing" : null,
    nextHigh === null ? "daily_next_high_missing" : null,
    nextLow === null ? "daily_next_low_missing" : null,
    nextClose === null ? "daily_next_close_missing" : null,
    nextHigh !== null && nextLow !== null && nextHigh < nextLow ? "daily_ohlc_invalid" : null,
    nextHigh !== null && [nextOpen, nextClose].some((price) => price !== null && price > nextHigh)
      ? "daily_ohlc_invalid" : null,
    nextLow !== null && [nextOpen, nextClose].some((price) => price !== null && price < nextLow)
      ? "daily_ohlc_invalid" : null,
    priceIntegrityDifferencePct === null ? "daily_price_integrity_evidence_missing" : null,
    priceIntegrityDifferencePct !== null
      && priceIntegrityDifferencePct > DEFAULT_PRICE_INTEGRITY_TOLERANCE_PCT
      ? "daily_price_integrity_failed" : null,
    referenceDifferencePct !== null
      && referenceDifferencePct > DEFAULT_PRICE_INTEGRITY_TOLERANCE_PCT
      ? "daily_reference_price_mismatch" : null,
    nextPrevDifferencePct !== null
      && nextPrevDifferencePct > DEFAULT_PRICE_INTEGRITY_TOLERANCE_PCT
      ? "daily_t1_previous_close_mismatch" : null,
  ]);
  const pct = (price) => currentClose && price ? round((price / currentClose - 1) * 100, 4) : null;
  return {
    valid: blockers.length === 0,
    code,
    currentTradingDate: tradingDate,
    nextTradingDate,
    source: text(value.source) || "injected_daily_outcome",
    currentClose: round(currentClose),
    nextOpen: round(nextOpen),
    nextHigh: round(nextHigh),
    nextLow: round(nextLow),
    nextClose: round(nextClose),
    nextPrevClose: round(nextPrevClose),
    priceDifferencePct: round(priceIntegrityDifferencePct, 4),
    referenceDifferencePct: round(referenceDifferencePct, 4),
    gapPct: pct(nextOpen),
    highPct: pct(nextHigh),
    adversePct: pct(nextLow),
    closePct: pct(nextClose),
    openToClosePct: nextOpen && nextClose ? round((nextClose / nextOpen - 1) * 100, 4) : null,
    blockers,
  };
}

function minuteBarsFrom(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["minuteBars", "bars", "minuteRows", "rows"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function normalizeMinuteOutcome(raw, code, nextTradingDate) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  if (!value) {
    return { valid: false, code, nextTradingDate, source: null, barCount: 0, minuteBars: [], blockers: ["minute_outcome_missing"] };
  }
  const statedDate = normalizeTradingDate(
    value.nextTradingDate || value.nextDate || value.tradingDate || value.date,
  );
  const bars = minuteBarsFrom(value).filter((bar) => bar && typeof bar === "object");
  const mismatchedBar = bars.some((bar) => {
    const barDate = normalizeTradingDate(bar.date || bar.tradingDate);
    return barDate && barDate !== nextTradingDate;
  });
  const missingBarDate = bars.some((bar) => !normalizeTradingDate(bar.date || bar.tradingDate));
  const explicitlyInvalid = value.valid === false
    || value.validForExecutionReplay === false
    || value.quality && value.quality.validForExecutionReplay === false;
  const qualityVerified = !explicitlyInvalid && (
    value.valid === true
    || value.validForExecutionReplay === true
    || value.quality && value.quality.validForExecutionReplay === true
  );
  const blockers = unique([
    !qualityVerified ? `minute_outcome_invalid:${text(value.reason) || "quality_not_verified"}` : null,
    statedDate && statedDate !== nextTradingDate ? "minute_outcome_date_mismatch" : null,
    missingBarDate ? "minute_bar_date_missing" : null,
    mismatchedBar ? "minute_bar_date_mismatch" : null,
    !bars.length ? "minute_outcome_bars_missing" : null,
  ]);
  return {
    valid: blockers.length === 0,
    code,
    nextTradingDate,
    source: text(value.source || (bars[0] && bars[0].source)) || "injected_minute_outcome",
    barCount: bars.length,
    minuteBars: blockers.length ? [] : bars,
    blockers,
  };
}

function settleStock(stock, input) {
  const code = codeOf(stock);
  const referencePrice = positive(stock && stock.executionReplayRule && stock.executionReplayRule.referencePrice);
  const daily = normalizeDailyOutcome(
    valueForCode(input.dailyOutcomes, code, input.nextTradingDate),
    code,
    input.tradingDate,
    input.nextTradingDate,
    referencePrice,
  );
  const minute = normalizeMinuteOutcome(
    valueForCode(input.minuteOutcomes, code, input.nextTradingDate),
    code,
    input.nextTradingDate,
  );
  const allocation = stock.positionAllocation && typeof stock.positionAllocation === "object"
    ? {
      relativeWeightPct: round(stock.positionAllocation.relativeWeightPct, 4),
      initialPortfolioPct: round(stock.positionAllocation.initialPortfolioPct, 4),
      maximumPortfolioPct: round(stock.positionAllocation.maximumPortfolioPct, 4),
    } : null;
  const base = {
    code,
    name: text(stock.name) || null,
    rank: finite(stock.rank ?? stock.decisionChainRank),
    plannedAllocation: allocation,
    executionAuthority: false,
    canAuthorizeTrade: false,
    dailyOutcome: { ...daily, blockers: daily.blockers.slice() },
    minuteOutcome: {
      valid: minute.valid,
      code,
      nextTradingDate: input.nextTradingDate,
      source: minute.source,
      barCount: minute.barCount,
      blockers: minute.blockers.slice(),
    },
  };
  if (!daily.valid) {
    return {
      ...base,
      status: "data_missing",
      validOutcome: false,
      triggered: null,
      filled: false,
      blockers: unique([...daily.blockers, ...minute.blockers]),
      executionReplay: null,
    };
  }

  const replay = buildExecutionReplay({
    rule: stock.executionReplayRule,
    minuteBars: minute.minuteBars,
    dailyOutcome: {
      currentClose: daily.currentClose,
      open: daily.nextOpen,
      high: daily.nextHigh,
      low: daily.nextLow,
      nextClose: daily.nextClose,
    },
    exitPrice: daily.nextClose,
    slippageBps: input.slippageBps,
    feeBps: input.feeBps,
    barIntervalMinutes: input.barIntervalMinutes,
  });
  const replayBlockers = unique([...(replay.blockers || []), ...minute.blockers]);
  let status = replay.status;
  if (replay.status === "unavailable" && replayBlockers.some((reason) => (
    reason === "intraday_execution_bars_missing"
    || reason === "minute_outcome_missing"
    || reason === "minute_outcome_bars_missing"
    || reason.startsWith("minute_outcome_invalid:")
    || reason === "minute_outcome_date_mismatch"
    || reason === "minute_bar_date_mismatch"
  ))) status = "data_missing";
  const validOutcome = replay.validOutcome === true && status !== "data_missing";
  return {
    ...base,
    status,
    validOutcome,
    triggered: replay.triggered === true ? true : replay.triggered === false ? false : null,
    filled: replay.status === "triggered" && replay.fill && positive(replay.fill.fillPrice) !== null,
    blockers: replayBlockers,
    executionReplay: {
      ...replay,
      executionAuthority: false,
    },
  };
}

function portfolioSummary(stocks, plannedInitialPct) {
  const triggered = stocks.filter((stock) => stock.status === "triggered" && stock.filled === true);
  const complete = stocks.every((stock) => stock.validOutcome === true);
  const allNotTriggered = stocks.length > 0 && stocks.every((stock) => stock.status === "not_triggered");
  const triggeredInitialPortfolioPct = round(triggered.reduce((sum, stock) => (
    sum + Number(stock.plannedAllocation && stock.plannedAllocation.initialPortfolioPct || 0)
  ), 0), 4);
  const contribution = (key) => round(triggered.reduce((sum, stock) => {
    const weight = Number(stock.plannedAllocation && stock.plannedAllocation.initialPortfolioPct || 0) / 100;
    const value = finite(stock.executionReplay && stock.executionReplay.outcome && stock.executionReplay.outcome[key]);
    return sum + (value === null ? 0 : value * weight);
  }, 0), 4);
  return {
    validOutcome: complete,
    selectedCount: stocks.length,
    triggeredCount: triggered.length,
    notTriggeredCount: stocks.filter((stock) => stock.status === "not_triggered").length,
    unavailableCount: stocks.filter((stock) => !stock.validOutcome).length,
    plannedInitialPortfolioPct: round(plannedInitialPct, 4),
    triggeredInitialPortfolioPct,
    cashReserveAfterTriggersPct: round(100 - triggeredInitialPortfolioPct, 4),
    grossReturnContributionPct: complete ? contribution("grossReturnPct") : null,
    netReturnContributionPct: complete ? contribution("netReturnPct") : null,
    cashOnly: complete ? allNotTriggered : triggered.length ? false : null,
    rule: "组合收益按凭证冻结的初始组合仓位计算；未触发部分保留现金，任一结果缺失时不生成完整组合收益",
  };
}

function buildOutcomeEnvelope(identity, body) {
  const outcomeId = `t1_${hashStable(identity).slice(0, 32)}`;
  const withoutHash = {
    schemaVersion: DECISION_OUTCOME_SCHEMA_VERSION,
    authority: DECISION_OUTCOME_AUTHORITY,
    executionAuthority: false,
    canAuthorizeTrade: false,
    outcomeId,
    ...body,
  };
  return {
    ...withoutHash,
    settlementHash: hashStable(withoutHash),
  };
}

function settleDecisionOutcome(options = {}) {
  const validation = inspectDecisionReceiptForSettlement(options.decisionReceipt);
  const nextTradingDate = normalizeTradingDate(options.nextTradingDate);
  const receiptId = text(validation.receipt.receiptId) || null;
  const receiptHashes = validation.receipt.hashes && typeof validation.receipt.hashes === "object"
    ? validation.receipt.hashes : {};
  const decisionHash = text(receiptHashes.decisionHash) || null;
  const identity = {
    receiptId,
    decisionHash,
    tradingDate: validation.tradingDate,
    nextTradingDate,
  };
  const identityBlockers = unique([
    ...validation.blockers,
    !nextTradingDate ? "next_trading_date_invalid" : null,
    nextTradingDate && validation.tradingDate && nextTradingDate <= validation.tradingDate
      ? "next_trading_date_not_after_receipt_date" : null,
  ]);
  const receiptBinding = {
    receiptId,
    decisionHash,
    sourceHash: text(receiptHashes.sourceHash) || null,
    receiptHash: text(receiptHashes.receiptHash) || null,
  };
  const generation = {
    generationId: text(validation.generation.generationId) || null,
    tradingDate: validation.tradingDate,
    nextTradingDate,
  };
  const nextSessionEvidence = normalizeNextSessionEvidence(
    options.nextSessionEvidence,
    validation.tradingDate,
    nextTradingDate,
  );
  identityBlockers.push(...nextSessionEvidence.blockers);
  const finalIdentityBlockers = unique(identityBlockers);
  if (finalIdentityBlockers.length) {
    return buildOutcomeEnvelope(identity, {
      status: validation.ok ? "invalid_settlement_input" : "invalid_receipt",
      validOutcome: false,
      cashOnly: true,
      receiptBinding,
      generation,
      nextSessionEvidence,
      decisionAuthorizationAtSignal: {
        authorized: false,
        passed: validation.authorization.passed === true,
        allowNew: validation.authorization.tradePermission
          && validation.authorization.tradePermission.allowNew === true,
        observationOnly: true,
        executionAuthority: false,
        canAuthorizeTrade: false,
      },
      stocks: [],
      portfolio: null,
      blockers: finalIdentityBlockers,
      rule: "仅结算decision-receipt模块验证通过的live_canonical凭证；历史迁移、unavailable或身份不完整凭证失败关闭",
    });
  }

  const authorizationAtSignal = {
    authorized: validation.authorized,
    passed: validation.authorization.passed === true,
    allowNew: validation.authorization.tradePermission.allowNew === true,
    observationOnly: true,
    executionAuthority: false,
    canAuthorizeTrade: false,
  };
  if (!validation.stocks.length) {
    return buildOutcomeEnvelope(identity, {
      status: "cash_only",
      validOutcome: true,
      cashOnly: true,
      cashOnlyReason: validation.authorized ? "no_selected_stocks" : "trade_not_authorized",
      receiptBinding,
      generation,
      nextSessionEvidence,
      decisionAuthorizationAtSignal: authorizationAtSignal,
      stocks: [],
      portfolio: {
        validOutcome: true,
        selectedCount: 0,
        triggeredCount: 0,
        notTriggeredCount: 0,
        unavailableCount: 0,
        plannedInitialPortfolioPct: 0,
        triggeredInitialPortfolioPct: 0,
        cashReserveAfterTriggersPct: 100,
        grossReturnContributionPct: 0,
        netReturnContributionPct: 0,
        cashOnly: true,
      },
      blockers: [],
      rule: "正式结果为0只时按100%现金结算，不要求T+1个股数据，也不从观察候选补票",
    });
  }

  const slippageBps = Math.max(0, finite(options.slippageBps) ?? DEFAULT_SLIPPAGE_BPS);
  const feeBps = Math.max(0, finite(options.feeBps) ?? DEFAULT_FEE_BPS);
  const barIntervalMinutes = positive(options.barIntervalMinutes);
  const stocks = validation.stocks.map((stock) => settleStock(stock, {
    tradingDate: validation.tradingDate,
    nextTradingDate,
    dailyOutcomes: options.dailyOutcomes,
    minuteOutcomes: options.minuteOutcomes,
    slippageBps,
    feeBps,
    barIntervalMinutes,
  }));
  const portfolio = portfolioSummary(stocks, validation.allocationTotalPct);
  const allNotTriggered = stocks.every((stock) => stock.status === "not_triggered");
  const validOutcome = portfolio.validOutcome === true;
  return buildOutcomeEnvelope(identity, {
    status: validOutcome ? allNotTriggered ? "not_triggered" : "settled" : "incomplete",
    validOutcome,
    cashOnly: portfolio.cashOnly,
    receiptBinding,
    generation,
    nextSessionEvidence,
    decisionAuthorizationAtSignal: authorizationAtSignal,
    methodology: {
      slippageBps,
      feeBps,
      fillMethod: "next_bar_open_conservative",
      exitMethod: "t1_close",
      observationOnly: true,
    },
    stocks,
    portfolio,
    blockers: unique(stocks.flatMap((stock) => stock.validOutcome ? [] : stock.blockers)),
    rule: "本结算只描述冻结决策在精确T+1数据上的历史结果；所有字段executionAuthority=false，验证数据不能授予、恢复或扩大交易权限",
  });
}

function validateDecisionOutcome(outcome, options = {}) {
  const source = outcome && typeof outcome === "object" ? outcome : {};
  const binding = source.receiptBinding && typeof source.receiptBinding === "object"
    ? source.receiptBinding : {};
  const generation = source.generation && typeof source.generation === "object" ? source.generation : {};
  const stocks = Array.isArray(source.stocks) ? source.stocks : [];
  const portfolio = source.portfolio && typeof source.portfolio === "object" ? source.portfolio : null;
  const stockCodes = stocks.map(codeOf).filter(Boolean);
  const tradingDate = normalizeTradingDate(generation.tradingDate);
  const nextTradingDate = normalizeTradingDate(generation.nextTradingDate);
  const reasons = [];
  if (finite(source.schemaVersion) !== DECISION_OUTCOME_SCHEMA_VERSION) reasons.push("outcome_schema_version_invalid");
  if (source.authority !== DECISION_OUTCOME_AUTHORITY) reasons.push("outcome_authority_invalid");
  if (source.executionAuthority !== false || source.canAuthorizeTrade !== false) {
    reasons.push("outcome_execution_authority_invalid");
  }
  if (!text(binding.receiptId)) reasons.push("outcome_receipt_id_missing");
  if (!text(binding.decisionHash)) reasons.push("outcome_decision_hash_missing");
  if (!tradingDate || !nextTradingDate || nextTradingDate <= tradingDate) {
    reasons.push("outcome_trading_dates_invalid");
  }
  if (stocks.length > MAX_RESULT_STOCKS || stockCodes.length !== stocks.length
    || new Set(stockCodes).size !== stockCodes.length) {
    reasons.push("outcome_stock_codes_invalid");
  }
  if (stocks.some((stock) => (
    stock.executionAuthority !== false
    || stock.canAuthorizeTrade !== false
    || stock.executionReplay && stock.executionReplay.executionAuthority !== false
  ))) reasons.push("outcome_stock_execution_authority_invalid");
  const stockStateInvalid = stocks.some((stock) => {
    const stockStatus = text(stock.status);
    const replay = stock.executionReplay && typeof stock.executionReplay === "object"
      ? stock.executionReplay : null;
    if (stockStatus === "triggered") {
      return stock.validOutcome !== true || stock.triggered !== true || stock.filled !== true
        || !replay || replay.status !== "triggered"
        || finite(replay.outcome && replay.outcome.netReturnPct) === null;
    }
    if (stockStatus === "not_triggered") {
      return stock.validOutcome !== true || stock.triggered !== false || stock.filled !== false
        || !replay || replay.status !== "not_triggered";
    }
    if (["data_missing", "unavailable", "triggered_unfilled"].includes(stockStatus)) {
      return stock.validOutcome !== false || stock.filled !== false;
    }
    return true;
  });
  if (stockStateInvalid) reasons.push("outcome_stock_state_invalid");
  const allocationInvalid = stocks.some((stock) => {
    const allocation = stock.plannedAllocation && typeof stock.plannedAllocation === "object"
      ? stock.plannedAllocation : {};
    const relative = finite(allocation.relativeWeightPct);
    const initial = finite(allocation.initialPortfolioPct);
    const maximum = finite(allocation.maximumPortfolioPct);
    return relative === null || initial === null || maximum === null
      || relative < 0 || relative > 100 || initial <= 0 || initial > maximum || maximum > 100;
  });
  if (allocationInvalid) reasons.push("outcome_stock_allocation_invalid");

  const identity = {
    receiptId: text(binding.receiptId) || null,
    decisionHash: text(binding.decisionHash) || null,
    tradingDate,
    nextTradingDate,
  };
  const expectedOutcomeId = `t1_${hashStable(identity).slice(0, 32)}`;
  if (text(source.outcomeId) !== expectedOutcomeId) reasons.push("outcome_id_mismatch");
  if (!/^[a-f0-9]{64}$/.test(text(source.settlementHash))) {
    reasons.push("settlement_hash_invalid");
  } else {
    const withoutHash = stableClone(source);
    delete withoutHash.settlementHash;
    if (hashStable(withoutHash) !== source.settlementHash) reasons.push("settlement_hash_mismatch");
  }

  const nextEvidence = source.nextSessionEvidence && typeof source.nextSessionEvidence === "object"
    ? source.nextSessionEvidence : {};
  const status = text(source.status);
  const invalidStatus = status === "invalid_receipt" || status === "invalid_settlement_input";
  if (!invalidStatus && (
    nextEvidence.valid !== true
    || nextEvidence.executionAuthority !== false
    || normalizeTradingDate(nextEvidence.tradingDate) !== nextTradingDate
    || normalizeTradingDate(nextEvidence.previousTradingDate) !== tradingDate
  )) reasons.push("outcome_next_session_evidence_invalid");

  const triggeredStocks = stocks.filter((stock) => stock.status === "triggered" && stock.filled === true);
  const notTriggeredStocks = stocks.filter((stock) => stock.status === "not_triggered");
  const invalidStocks = stocks.filter((stock) => stock.validOutcome !== true);
  const plannedInitialPct = round(stocks.reduce((sum, stock) => (
    sum + Math.max(0, finite(stock.plannedAllocation && stock.plannedAllocation.initialPortfolioPct) || 0)
  ), 0), 4);
  const triggeredInitialPct = round(triggeredStocks.reduce((sum, stock) => (
    sum + Math.max(0, finite(stock.plannedAllocation && stock.plannedAllocation.initialPortfolioPct) || 0)
  ), 0), 4);
  if (portfolio) {
    const portfolioPlanned = finite(portfolio.plannedInitialPortfolioPct);
    const portfolioTriggered = finite(portfolio.triggeredInitialPortfolioPct);
    const portfolioCash = finite(portfolio.cashReserveAfterTriggersPct);
    if (finite(portfolio.selectedCount) !== stocks.length
      || finite(portfolio.triggeredCount) !== triggeredStocks.length
      || finite(portfolio.notTriggeredCount) !== notTriggeredStocks.length
      || finite(portfolio.unavailableCount) !== invalidStocks.length
      || portfolioPlanned === null || Math.abs(portfolioPlanned - plannedInitialPct) > 0.001
      || portfolioTriggered === null || Math.abs(portfolioTriggered - triggeredInitialPct) > 0.001
      || portfolioCash === null || Math.abs(portfolioCash - (100 - triggeredInitialPct)) > 0.001) {
      reasons.push("outcome_portfolio_counts_or_allocation_mismatch");
    }
    if (source.cashOnly !== portfolio.cashOnly) reasons.push("outcome_cash_state_mismatch");
  }
  if (plannedInitialPct > 100.001) reasons.push("outcome_planned_allocation_exceeds_100");
  const authorizationSnapshot = source.decisionAuthorizationAtSignal
    && typeof source.decisionAuthorizationAtSignal === "object"
    ? source.decisionAuthorizationAtSignal : {};
  if (authorizationSnapshot.observationOnly !== true
    || authorizationSnapshot.executionAuthority !== false
    || authorizationSnapshot.canAuthorizeTrade !== false) {
    reasons.push("outcome_authorization_snapshot_boundary_invalid");
  }

  if (status === "cash_only") {
    if (source.validOutcome !== true || source.cashOnly !== true || stocks.length
      || !portfolio || portfolio.cashOnly !== true || finite(portfolio.selectedCount) !== 0) {
      reasons.push("cash_only_outcome_inconsistent");
    }
  } else if (status === "not_triggered") {
    if (source.validOutcome !== true || source.cashOnly !== true || !stocks.length
      || notTriggeredStocks.length !== stocks.length || !portfolio || portfolio.validOutcome !== true) {
      reasons.push("not_triggered_outcome_inconsistent");
    }
  } else if (status === "settled") {
    if (source.validOutcome !== true || source.cashOnly !== false || !stocks.length
      || triggeredStocks.length < 1 || invalidStocks.length || !portfolio || portfolio.validOutcome !== true) {
      reasons.push("settled_outcome_inconsistent");
    }
  } else if (status === "incomplete") {
    if (source.validOutcome !== false || !stocks.length || !invalidStocks.length
      || !portfolio || portfolio.validOutcome !== false) {
      reasons.push("incomplete_outcome_inconsistent");
    }
  } else if (invalidStatus) {
    if (source.validOutcome !== false || source.cashOnly !== true || stocks.length || portfolio !== null) {
      reasons.push("invalid_outcome_inconsistent");
    }
  } else {
    reasons.push("outcome_status_invalid");
  }

  if (options.decisionReceipt) {
    const receiptInspection = inspectDecisionReceiptForSettlement(options.decisionReceipt);
    const receiptHashes = options.decisionReceipt.hashes && typeof options.decisionReceipt.hashes === "object"
      ? options.decisionReceipt.hashes : {};
    if (!invalidStatus && receiptInspection.ok !== true) reasons.push("bound_receipt_not_live_canonical");
    if (text(options.decisionReceipt.receiptId) !== text(binding.receiptId)
      || text(receiptHashes.decisionHash) !== text(binding.decisionHash)
      || text(receiptHashes.receiptHash) !== text(binding.receiptHash)
      || text(receiptHashes.sourceHash) !== text(binding.sourceHash)) {
      reasons.push("outcome_receipt_binding_mismatch");
    }
    if (receiptInspection.tradingDate !== tradingDate) reasons.push("outcome_receipt_date_mismatch");
    const receiptCodes = receiptInspection.selectedCodes;
    if (!invalidStatus && receiptCodes.join(",") !== stockCodes.join(",")) {
      reasons.push("outcome_expands_or_changes_receipt_stocks");
    }
  } else {
    reasons.push("bound_receipt_missing");
  }

  return {
    valid: unique(reasons).length === 0,
    reasons: unique(reasons),
    receiptId: text(binding.receiptId) || null,
    decisionHash: text(binding.decisionHash) || null,
    status: status || null,
  };
}

module.exports = {
  DECISION_OUTCOME_SCHEMA_VERSION,
  DECISION_OUTCOME_AUTHORITY,
  RECEIPT_AUTHORITY,
  inspectDecisionReceiptForSettlement,
  normalizeNextSessionEvidence,
  normalizeDailyOutcome,
  normalizeMinuteOutcome,
  settleDecisionOutcome,
  validateDecisionOutcome,
  hashStable,
};
