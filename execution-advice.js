"use strict";

const { normalizeBigCycle } = require("./quant-decision/market-cycle-contract");

/**
 * 推荐股票的完整交易生命周期建议。
 *
 * 这个模块只把已经完成的市场预测、情绪判断和情景资格翻译成执行计划，
 * 不负责预测市场，也不负责绕过选股/情景门槛补一只股票。
 */

const { tradeMode, stopProfitLoss } = require("./trading-rules");

const SCENARIO_LABELS = Object.freeze({
  strengthen: "市场加强",
  range_divergence: "震荡分化",
  weaken: "市场减弱",
});

const SELL_PRIORITY = Object.freeze([
  { tier: "hard_stop", priority: 1, label: "硬止损" },
  { tier: "structural_exit", priority: 2, label: "结构失败/清仓" },
  { tier: "reduce", priority: 3, label: "减仓" },
  { tier: "profit_protection", priority: 4, label: "保本/止盈" },
]);

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positive(value) {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function clean(value) {
  return String(value || "").trim();
}

function unique(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean)));
}

function firstBoolean(...values) {
  return values.find((value) => typeof value === "boolean");
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value)) || [];
}

function safeField(object, key) {
  try {
    return object && object[key];
  } catch (_) {
    return undefined;
  }
}

function rawMarketPositionLimit(marketEmotionOrLimit) {
  if (!marketEmotionOrLimit || typeof marketEmotionOrLimit !== "object" || Array.isArray(marketEmotionOrLimit)) {
    return marketEmotionOrLimit;
  }
  const review = safeField(marketEmotionOrLimit, "review");
  const tomorrow = review && typeof review === "object" ? safeField(review, "tomorrow") : null;
  const candidates = [
    tomorrow && typeof tomorrow === "object" ? safeField(tomorrow, "positionLimit") : undefined,
    safeField(marketEmotionOrLimit, "positionLimit"),
    safeField(marketEmotionOrLimit, "maxPosition"),
    safeField(marketEmotionOrLimit, "position"),
    safeField(marketEmotionOrLimit, "positionAdvice"),
  ];
  return candidates.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function parsedPositionFraction(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw < 0) return null;
    if (raw <= 1) return raw;
    if (raw <= 100) return raw / 100;
    return null;
  }
  const text = String(raw === undefined || raw === null ? "" : raw).trim();
  if (!text) return null;
  if (/^0+(?:\.0+)?$/.test(text)) return 0;
  const percentages = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*%/g))
    .map((match) => Number(match[1]) / 100)
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  if (percentages.length) return Math.max(...percentages);
  const fractions = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*[\/／]\s*(\d+(?:\.\d+)?)/g))
    .map((match) => Number(match[2]) > 0 ? Number(match[1]) / Number(match[2]) : NaN)
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  if (fractions.length) return Math.max(...fractions);
  if (/半仓/.test(text)) return 0.5;
  const chineseTenths = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 零: 0 };
  const tenths = text.match(/([一二两三四五六七八九十零])成(?:仓)?/);
  if (tenths) return chineseTenths[tenths[1]] / 10;
  if (/满仓/.test(text)) return 1;
  return null;
}

function positionLimitPolicy(marketEmotionOrLimit) {
  const value = rawMarketPositionLimit(marketEmotionOrLimit);
  const text = value === 0 ? "0%" : clean(value);
  const compact = text.replace(/\s+/g, "");
  const fraction = parsedPositionFraction(value);
  const explicitlyForbidden = /(?:禁止|不得|不允许|暂停)(?:任何)?(?:新)?开仓|(?:保持|继续)?空仓|零仓位/.test(compact);
  const blocked = fraction === 0 || explicitlyForbidden;
  return {
    value: value === undefined ? null : value,
    text: text || null,
    fraction: blocked && fraction === null ? 0 : fraction,
    blocked,
    reason: blocked ? (text ? `市场仓位上限为“${text}”，禁止新开仓` : "市场仓位上限为0%，禁止新开仓") : null,
  };
}

function positionLimitBlocksNewEntry(marketEmotionOrLimit) {
  return positionLimitPolicy(marketEmotionOrLimit).blocked;
}

function canonicalScenarioKey(value) {
  const raw = clean(value);
  const lowered = raw.toLowerCase().replace(/[\s\-]+/g, "_");
  if (!lowered) return "";
  if (
    ["strengthen", "strength", "stronger", "upside", "加强", "市场加强"].includes(lowered)
    || /加强|转强|走强/.test(raw)
  ) return "strengthen";
  if (
    ["range", "range_divergence", "rotation", "divergence", "sideways", "震荡", "分化", "轮动"].includes(lowered)
    || /震荡|分化|轮动/.test(raw)
  ) return "range_divergence";
  if (
    ["weaken", "weakening", "weakrepair", "weak_repair", "downside", "减弱", "市场减弱"].includes(lowered)
    || /减弱|偏弱|退潮|弱后修复/.test(raw)
  ) return "weaken";
  return lowered;
}

function scenarioLabel(key, fallback) {
  return SCENARIO_LABELS[canonicalScenarioKey(key)] || clean(fallback) || "路径待确认";
}

function normalizeForecast(marketForecast) {
  const source = marketForecast && typeof marketForecast === "object" ? marketForecast : {};
  const primarySource = source.primary && typeof source.primary === "object"
    ? source.primary
    : source.primaryScenario && typeof source.primaryScenario === "object"
      ? source.primaryScenario
      : source.mainScenario && typeof source.mainScenario === "object"
        ? source.mainScenario
        : null;
  const rawPrimaryKey = clean(
    primarySource && (primarySource.key || primarySource.pathKey || primarySource.scenarioKey)
    || source.primaryPathKey
    || source.mainPathKey
    || source.mainScenarioKey
    || (typeof source.primaryPath === "string" ? source.primaryPath : ""),
  );
  const primaryKey = canonicalScenarioKey(rawPrimaryKey);
  const probabilities = source.probabilities && typeof source.probabilities === "object"
    ? source.probabilities
    : {};
  const primaryProbability = finite(
    (primarySource && primarySource.probability)
    ?? probabilities[rawPrimaryKey]
    ?? probabilities[primaryKey],
  );
  return {
    raw: source,
    primaryKey,
    rawPrimaryKey,
    primaryLabel: scenarioLabel(primaryKey, primarySource && primarySource.label),
    primaryProbability,
    confidence: finite(source.confidence),
    calibrated: source.calibrated === true,
    method: clean(source.method) || "unavailable",
  };
}

function entryFrom(raw, keyHint = "") {
  if (typeof raw === "boolean") {
    return {
      key: canonicalScenarioKey(keyHint),
      rawKey: clean(keyHint),
      eligible: raw,
      candidateCode: "",
      reason: "",
      known: true,
    };
  }
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw.candidate && typeof raw.candidate === "object"
    ? raw.candidate
    : raw.pick && typeof raw.pick === "object" ? raw.pick : {};
  const rawKey = clean(
    raw.scenarioKey
    || raw.pathKey
    || raw.key
    || candidate.scenarioKey
    || keyHint,
  );
  const explicit = firstBoolean(
    raw.eligible,
    raw.qualified,
    raw.ready,
    raw.tomorrowEntryQualified,
    candidate.eligible,
    candidate.qualified,
    candidate.tomorrowEntryQualified,
  );
  let eligible = explicit;
  if (eligible === undefined && clean(raw.status)) {
    eligible = /^(ready|eligible|qualified)$/i.test(clean(raw.status));
    if (/^(empty|blocked|risk|unavailable)$/i.test(clean(raw.status))) eligible = false;
  }
  return {
    key: canonicalScenarioKey(rawKey),
    rawKey,
    eligible: eligible === true,
    candidateCode: clean(
      raw.candidateCode
      || raw.code
      || candidate.code
      || candidate.secCode,
    ),
    reason: clean(raw.reason || raw.note || raw.action || raw.statusLabel),
    known: explicit !== undefined || Boolean(clean(raw.status)),
  };
}

function normalizeScenarioEligibility(value, pickCode, primaryKey) {
  const source = value && typeof value === "object" ? value : {};
  const entries = [];
  const pushEntry = (raw, keyHint) => {
    const entry = entryFrom(raw, keyHint);
    if (entry && entry.key) entries.push(entry);
  };

  if (Array.isArray(value)) value.forEach((entry) => pushEntry(entry));
  else if (value && typeof value === "object") {
    firstArray(source.scenarios, source.paths, source.scenarioPlans).forEach((entry) => pushEntry(entry));
    if (source.primary && typeof source.primary === "object") pushEntry(source.primary, primaryKey);
    if (source.candidate && typeof source.candidate === "object") {
      pushEntry({ ...source.candidate, scenarioKey: source.candidateScenarioKey || source.scenarioKey || source.candidate.scenarioKey });
    }
    firstArray(source.contingencies, source.alternatives).forEach((entry) => pushEntry(entry));
    if (source.scenarioKey || source.pathKey || source.candidateScenarioKey) pushEntry(source);
    ["strengthen", "range_divergence", "rotation", "weaken", "weakRepair"].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(source, key)) pushEntry(source[key], key);
    });
  }

  const directScenarioKey = canonicalScenarioKey(
    source.candidateScenarioKey
    || source.scenarioKey
    || source.pathKey
    || (source.scenarioRole === "primary" ? primaryKey : ""),
  );
  const matchingCode = entries.filter((entry) => entry.candidateCode && entry.candidateCode === pickCode);
  const candidateEntry = matchingCode[0]
    || entries.find((entry) => directScenarioKey && entry.key === directScenarioKey && (!entry.candidateCode || entry.candidateCode === pickCode))
    || (entries.length === 1 && (!entries[0].candidateCode || entries[0].candidateCode === pickCode) ? entries[0] : null);
  const mismatchedEntry = !matchingCode.length && pickCode
    ? entries.find((entry) => entry.candidateCode && entry.candidateCode !== pickCode && (
      entries.length === 1 || !directScenarioKey || entry.key === directScenarioKey
    ))
    : null;
  const directCandidateEligible = firstBoolean(source.candidateEligible, source.eligible, source.qualified);
  const candidateScenarioKey = canonicalScenarioKey(
    candidateEntry && candidateEntry.key
    || directScenarioKey,
  );
  let candidateEligible = candidateEntry && candidateEntry.known ? candidateEntry.eligible : directCandidateEligible;

  const primaryEntry = entries.find((entry) => entry.key === primaryKey && (!entry.candidateCode || entry.candidateCode === pickCode))
    || entries.find((entry) => entry.key === primaryKey);
  const directPrimaryEligible = firstBoolean(source.primaryPathEligible, source.primaryEligible);
  let primaryEligible = directPrimaryEligible !== undefined
    ? directPrimaryEligible
    : primaryEntry && primaryEntry.known ? primaryEntry.eligible : undefined;
  if (candidateScenarioKey && candidateScenarioKey === primaryKey && candidateEligible === true) primaryEligible = true;
  if (candidateEligible === undefined && candidateScenarioKey === primaryKey && primaryEligible !== undefined) {
    candidateEligible = primaryEligible;
  }

  const codeMismatch = Boolean(
    mismatchedEntry,
  );
  return {
    primaryKey,
    primaryEligible: primaryEligible === true,
    primaryEligibilityKnown: primaryEligible !== undefined,
    candidateScenarioKey,
    candidateEligible: candidateEligible === true,
    candidateEligibilityKnown: candidateEligible !== undefined || Boolean(candidateEntry && candidateEntry.known),
    candidateReason: clean(candidateEntry && candidateEntry.reason || source.reason),
    candidateCode: clean(candidateEntry && candidateEntry.candidateCode || mismatchedEntry && mismatchedEntry.candidateCode),
    codeMismatch,
    entries,
  };
}

function normalizeMode(pick) {
  const splText = clean(pick && pick.sell && pick.sell.splNote);
  const buyMode = clean(pick && pick.buy && pick.buy.mode);
  if (/趋势/.test(splText) || /趋势/.test(buyMode)) return "趋势";
  if (/打板/.test(splText) || /打板/.test(buyMode)) return "打板";
  if (/低吸/.test(splText) || /低吸/.test(buyMode)) return "低吸";
  return tradeMode(pick || {});
}

function normalizePctRange(value, fallback) {
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : [];
  const result = source.map(finite).filter((number) => number !== null).slice(0, 2);
  return result.length === 2 ? result : null;
}

function pricesFromPct(basisPrice, pctRange) {
  const basis = positive(basisPrice);
  return basis && Array.isArray(pctRange)
    ? pctRange.map((pct) => round2(basis * (1 + Number(pct) / 100)))
    : null;
}

function ruleForActualFill(value) {
  const original = clean(value);
  const rebased = original
    .replace(/按当前快照基准重算[,，]?/g, "")
    .replace(/[；;]?\s*当前以\d+(?:\.\d+)?为参考/g, "")
    .replace(/[；;]?\s*以昨收为基准参考[,，]?\s*实际买入后按买入价重算/g, "")
    .replace(/[；;]?\s*实际买入后按买入价重算/g, "")
    .replace(/^[；;，,\s]+|[；;，,\s]+$/g, "");
  return `${rebased ? `${rebased}；` : ""}价位已按实际成交成本重算`;
}

function extractObservationRange(pick) {
  const buy = pick && pick.buy && typeof pick.buy === "object" ? pick.buy : {};
  const structured = buy.observationRange && typeof buy.observationRange === "object"
    ? [buy.observationRange.low, buy.observationRange.high]
    : Array.isArray(buy.priceRange) ? buy.priceRange : null;
  if (structured) {
    const range = structured.map(positive);
    if (range.length === 2 && range.every((number) => number !== null)) return range;
  }
  const lines = Array.isArray(buy.auctionLines) ? buy.auctionLines : [];
  for (const line of lines) {
    const match = clean(line).match(/(\d+(?:\.\d+)?)\s*[~～]\s*(\d+(?:\.\d+)?)/);
    if (!match) continue;
    const low = positive(match[1]);
    const high = positive(match[2]);
    if (low !== null && high !== null) return [low, high];
  }
  return null;
}

function buildBuyPlan({ pick, referencePrice, scenarioRole, eligibility, marketEmotion }) {
  const buySource = pick && pick.buy && typeof pick.buy === "object" ? pick.buy : {};
  const execution = pick && pick.tomorrowExecution && typeof pick.tomorrowExecution === "object"
    ? pick.tomorrowExecution
    : {};
  const triggers = unique(firstArray(execution.triggers, buySource.triggers, pick && pick.entryTriggers));
  const cancelConditions = unique(firstArray(
    execution.cancelConditions,
    buySource.cancelConditions,
    pick && pick.cancelConditions,
  ));
  const observationLines = unique(firstArray(buySource.auctionLines, buySource.observationLines));
  const noChaseRules = observationLines.filter((line) => /不追|透支|赔率消失|先不/.test(line));
  const stockInitialPosition = clean(buySource.initialPosition) || null;
  const marketPositionPolicy = positionLimitPolicy(marketEmotion);
  const stockPositionPolicy = positionLimitPolicy(stockInitialPosition);
  let explicitPosition = marketPositionPolicy.text || stockInitialPosition;
  if (marketPositionPolicy.text && stockInitialPosition) {
    if (marketPositionPolicy.fraction !== null && stockPositionPolicy.fraction !== null) {
      explicitPosition = marketPositionPolicy.fraction <= stockPositionPolicy.fraction
        ? marketPositionPolicy.text
        : stockInitialPosition;
    } else if (marketPositionPolicy.text !== stockInitialPosition) {
      explicitPosition = `${stockInitialPosition}；市场上限${marketPositionPolicy.text}（执行不得超过市场上限）`;
    }
  }
  const eligible = Boolean(pick && eligibility.candidateEligible && scenarioRole !== "none");
  return {
    status: eligible ? "conditional" : "blocked",
    statusLabel: eligible ? "等待价格与承接触发" : "当前不具备买入资格",
    tradeMode: pick ? normalizeMode(pick) : null,
    plan: clean(buySource.plan),
    observationZone: {
      label: "观察区（不是自动买点）",
      nature: "observation_only",
      basis: referencePrice !== null ? "pre_entry_reference" : "unavailable",
      referencePrice,
      priceRange: extractObservationRange(pick),
      lines: observationLines,
      automaticEntry: false,
      requiresTrigger: true,
    },
    entryTriggers: triggers,
    cancelConditions,
    noChaseRules,
    initialPosition: explicitPosition || null,
    stockInitialPosition,
    marketPositionLimit: marketPositionPolicy.text,
    positionPolicy: {
      appliedFraction: marketPositionPolicy.fraction !== null && stockPositionPolicy.fraction !== null
        ? Math.min(marketPositionPolicy.fraction, stockPositionPolicy.fraction)
        : marketPositionPolicy.fraction ?? stockPositionPolicy.fraction,
      marketBlocked: marketPositionPolicy.blocked,
      rule: "个股计划仓位不得突破市场仓位上限；可比较时取更低值，无法比较时显式保留两者并以市场上限为准。",
    },
    scenarioActivationRequired: scenarioRole === "contingency",
    scenarioKey: eligibility.candidateScenarioKey || null,
    note: eligible
      ? "观察区只用于等待验证；价格进入区间不等于可以买，仍须同时满足情景与个股触发。"
      : "没有通过对应情景资格，不得用观察区或当前涨幅反推买点。",
  };
}

function expectedActionForTier(tier) {
  if (tier === "hard_stop" || tier === "structural_exit") return "clear";
  if (tier === "reduce") return "reduce";
  return "protect_profit";
}

function detectSellConflicts(actions, basisPrice) {
  const rows = Array.isArray(actions) ? actions : [];
  const conflicts = [];
  const seen = new Set();
  let previousPriority = -Infinity;
  rows.forEach((action) => {
    const key = clean(action && action.key);
    const priority = finite(action && action.priority);
    if (key && seen.has(key)) conflicts.push({ code: "duplicate_action", action: key, message: `卖出动作 ${key} 重复` });
    if (key) seen.add(key);
    if (priority === null || priority < previousPriority) {
      conflicts.push({ code: "priority_order", action: key, message: "卖出动作未按硬止损→结构清仓→减仓→保本/止盈排序" });
    }
    if (priority !== null) previousPriority = priority;
    const expected = expectedActionForTier(clean(action && action.tier));
    if (clean(action && action.actionType) && action.actionType !== expected) {
      conflicts.push({ code: "action_tier_mismatch", action: key, message: `${key} 的动作类型与优先级层级冲突` });
    }
  });

  const basis = positive(basisPrice);
  if (basis !== null) {
    const hard = rows.find((action) => action.key === "hard_stop");
    const breakEven = rows.find((action) => action.key === "break_even");
    const takeProfit = rows.find((action) => action.key === "take_profit");
    if (hard && Array.isArray(hard.priceRange) && hard.priceRange.some((price) => positive(price) >= basis)) {
      conflicts.push({ code: "hard_stop_not_below_basis", action: "hard_stop", message: "硬止损价格必须低于成本/参考价" });
    }
    if (breakEven && positive(breakEven.price) !== null && positive(breakEven.price) <= basis) {
      conflicts.push({ code: "break_even_not_above_basis", action: "break_even", message: "保本武装线必须高于成本/参考价" });
    }
    if (takeProfit && Array.isArray(takeProfit.priceRange) && takeProfit.priceRange.some((price) => positive(price) <= basis)) {
      conflicts.push({ code: "take_profit_not_above_basis", action: "take_profit", message: "止盈价格必须高于成本/参考价" });
    }
  }
  return conflicts;
}

function buildSellPlan({ pick, marketEmotion, referencePrice, fillPrice }) {
  const sellSource = pick && pick.sell && typeof pick.sell === "object" ? pick.sell : {};
  const mode = pick ? normalizeMode(pick) : "低吸";
  const rules = stopProfitLoss(mode, {
    cycle: marketCycleLabel(marketEmotion),
    subPhase: marketSmallCycleLabel(marketEmotion),
    position: clean(marketEmotion && (marketEmotion.position || marketEmotion.positionAdvice)),
  });
  const actualFill = positive(fillPrice);
  const preEntryReference = positive(referencePrice);
  const basisPrice = actualFill || preEntryReference;
  const basis = actualFill ? "actual_fill" : preEntryReference ? "pre_entry_reference" : "unavailable";
  const hardStopSource = sellSource.hardStop && typeof sellSource.hardStop === "object" ? sellSource.hardStop : {};
  const breakEvenSource = sellSource.breakEven && typeof sellSource.breakEven === "object" ? sellSource.breakEven : {};
  const closeLineSource = sellSource.closeLine && typeof sellSource.closeLine === "object" ? sellSource.closeLine : {};
  const hardPctRange = normalizePctRange(hardStopSource.pctRange, rules.stopLoss.range);
  const takeProfitSource = sellSource.takeProfit && typeof sellSource.takeProfit === "object" ? sellSource.takeProfit : {};
  const takeProfitPctRange = normalizePctRange(takeProfitSource.pctRange, rules.takeProfit.range);
  const breakEvenPct = positive(breakEvenSource.pct) || 3;
  const hardPriceRange = basisPrice !== null
    ? pricesFromPct(basisPrice, hardPctRange)
    : null;
  const takeProfitPriceRange = pricesFromPct(basisPrice, takeProfitPctRange);
  const breakEvenPrice = basisPrice !== null ? round2(basisPrice * (1 + breakEvenPct / 100)) : null;
  const ma5 = positive(closeLineSource.ma5);

  const hardStop = {
    pctRange: hardPctRange,
    priceRange: hardPriceRange,
    rule: actualFill
      ? ruleForActualFill(clean(hardStopSource.note) || rules.stopLoss.basis)
      : clean(hardStopSource.note) || rules.stopLoss.basis,
  };
  const structuralExit = {
    ma5,
    rule: clean(closeLineSource.rule) || (ma5 ? `14:55仍失守MA5（${ma5}）则按结构失败清仓` : "结构破坏且无法收回时清仓"),
  };
  const reduce = {
    rule: clean(sellSource.intradayPullback) || "方向回流失败、个股反抽无法收回分时均价线时先减仓",
  };
  const breakEven = {
    pct: breakEvenPct,
    price: breakEvenPrice,
    rule: actualFill
      ? ruleForActualFill(clean(breakEvenSource.rule) || "浮盈达到武装线后将防守线上移至实际成本")
      : clean(breakEvenSource.rule) || "浮盈达到武装线后将防守线上移至实际成本",
  };
  const takeProfit = {
    pctRange: takeProfitPctRange,
    priceRange: takeProfitPriceRange,
    rule: clean(takeProfitSource.rule) || rules.takeProfit.basis,
  };
  const actions = [
    { key: "hard_stop", tier: "hard_stop", priority: 1, actionType: "clear", trigger: hardStop.rule, pctRange: hardStop.pctRange, priceRange: hardStop.priceRange },
    { key: "structural_exit", tier: "structural_exit", priority: 2, actionType: "clear", trigger: structuralExit.rule, ma5: structuralExit.ma5 },
    { key: "reduce", tier: "reduce", priority: 3, actionType: "reduce", trigger: reduce.rule },
    { key: "break_even", tier: "profit_protection", priority: 4, actionType: "protect_profit", trigger: breakEven.rule, pct: breakEven.pct, price: breakEven.price },
    { key: "take_profit", tier: "profit_protection", priority: 4, actionType: "protect_profit", trigger: takeProfit.rule, pctRange: takeProfit.pctRange, priceRange: takeProfit.priceRange },
  ];
  const conflicts = detectSellConflicts(actions, basisPrice);
  return {
    status: basisPrice !== null ? (actualFill ? "active" : "reference_only") : "unavailable",
    statusLabel: actualFill ? "已按实际成交成本重算" : preEntryReference ? "成交前参考预案" : "缺少有效价格",
    basis,
    basisPrice,
    basisLabel: actualFill ? "实际成交成本" : preEntryReference ? "成交前参考价" : "价格不可用",
    recalcAfterFill: actualFill === null,
    referenceOnly: actualFill === null,
    mode,
    hardStop,
    structuralExit,
    reduce,
    breakEven,
    takeProfit,
    priorityPolicy: SELL_PRIORITY.map((item) => ({ ...item })),
    actions,
    conflicts,
    note: actualFill
      ? "所有成本相关价位已按实际成交价重算；结构线仍使用市场真实结构，不按成本平移。"
      : "所有数字只作成交前参考；真实成交后必须按实际成本重算，禁止把昨收参考价当持仓成本。",
  };
}

function recalculateSellAfterFill(input = {}, maybeFillPrice) {
  const sourceSell = input.sell && typeof input.sell === "object"
    ? input.sell
    : input.advice && input.advice.sell && typeof input.advice.sell === "object"
      ? input.advice.sell
      : input && typeof input === "object" ? input : {};
  const fillPrice = positive(maybeFillPrice) || positive(input.fillPrice) || positive(input.fill && input.fill.price);
  if (fillPrice === null) {
    return {
      ...sourceSell,
      status: "unavailable",
      statusLabel: "实际成交价缺失，无法重算",
      basis: "unavailable",
      basisPrice: null,
      recalcAfterFill: true,
      referenceOnly: true,
      conflicts: [{ code: "fill_price_missing", action: "recalculate", message: "必须提供有效实际成交价" }],
    };
  }
  const hardPctRange = normalizePctRange(sourceSell.hardStop && sourceSell.hardStop.pctRange, null);
  const takeProfitPctRange = normalizePctRange(sourceSell.takeProfit && sourceSell.takeProfit.pctRange, null);
  const breakEvenPct = positive(sourceSell.breakEven && sourceSell.breakEven.pct) || 3;
  const hardStop = {
    ...(sourceSell.hardStop || {}),
    priceRange: pricesFromPct(fillPrice, hardPctRange),
    rule: ruleForActualFill(sourceSell.hardStop && sourceSell.hardStop.rule),
  };
  const takeProfit = {
    ...(sourceSell.takeProfit || {}),
    priceRange: pricesFromPct(fillPrice, takeProfitPctRange),
  };
  const breakEven = {
    ...(sourceSell.breakEven || {}),
    price: round2(fillPrice * (1 + breakEvenPct / 100)),
    rule: ruleForActualFill(sourceSell.breakEven && sourceSell.breakEven.rule),
  };
  const actions = (Array.isArray(sourceSell.actions) ? sourceSell.actions : []).map((action) => {
    if (action.key === "hard_stop") return { ...action, priceRange: hardStop.priceRange, trigger: hardStop.rule };
    if (action.key === "take_profit") return { ...action, priceRange: takeProfit.priceRange };
    if (action.key === "break_even") return { ...action, price: breakEven.price, trigger: breakEven.rule };
    return { ...action };
  });
  const conflicts = detectSellConflicts(actions, fillPrice);
  return {
    ...sourceSell,
    status: "active",
    statusLabel: "已按实际成交成本重算",
    basis: "actual_fill",
    basisPrice: fillPrice,
    basisLabel: "实际成交成本",
    recalcAfterFill: false,
    referenceOnly: false,
    hardStop,
    breakEven,
    takeProfit,
    actions,
    conflicts,
    note: "所有成本相关价位已按实际成交价重算；结构线仍使用市场真实结构，不按成本平移。",
  };
}

function holdingWindow(mode, cycle) {
  if (/退潮|冰点/.test(cycle)) return null;
  if (/主升/.test(cycle)) return mode === "趋势" ? { min: 2, max: 5 } : { min: 1, max: 3 };
  if (/震荡|混沌/.test(cycle)) return mode === "趋势" ? { min: 1, max: 3 } : { min: 1, max: 2 };
  return mode === "趋势" ? { min: 1, max: 3 } : { min: 1, max: 3 };
}

function marketSmallCycleLabel(marketEmotion) {
  const source = marketEmotion && typeof marketEmotion === "object" ? marketEmotion : {};
  const raw = source.smallCycle || source.transition || source.subPhase || source.quality;
  if (raw && typeof raw === "object") return clean(raw.label || raw.key);
  return clean(raw);
}

function marketCycleLabel(marketEmotion) {
  const source = marketEmotion && typeof marketEmotion === "object" ? marketEmotion : {};
  const raw = source.bigCycle || source.cycle || source.phase || source.marketRegime;
  if (raw && typeof raw === "object") {
    const label = clean(raw.label || raw.cycleLabel);
    if (label) return normalizeBigCycle(label) || "";
    const key = clean(raw.key || raw.cycleKey);
    return normalizeBigCycle(key) || "";
  }
  return normalizeBigCycle(raw) || "";
}

function buildHoldingPeriod({ pick, marketEmotion, eligible }) {
  const mode = pick ? normalizeMode(pick) : null;
  const cycle = marketCycleLabel(marketEmotion);
  const window = eligible && pick ? holdingWindow(mode, cycle) : null;
  return {
    method: window ? "heuristic" : "unavailable",
    methodLabel: window ? "规则型持有窗口（非统计胜率）" : "持有窗口不可用",
    windowTradingDays: window,
    display: window ? `${window.min}～${window.max}个交易日` : "未形成有效交易，不给持有天数",
    mandatoryReview: {
      required: true,
      checkpoint: "T+1",
      rule: "T+1必须复核市场主路径、方向承接和个股主动性；未确认则退出或取消，不把试错拖成长线。",
    },
    extensionRule: "只有大周期仍允许交易、方向升级为主线且个股结构与主动性保持，才允许延长；延长后仍逐日复核。",
    earlyExitRule: "任何时点触发硬止损或结构失败，优先于计划持有天数立即退出。",
    source: window ? "market_cycle_and_trade_mode_rules" : "insufficient_execution_eligibility",
    statisticsUsed: [],
    excludedStatistics: ["backtest.winRate3d"],
    note: "winRate3d表示相似样本三日表现统计，不等于建议持有3天，也不参与本窗口推导。",
  };
}

function buildHoldPlan({ pick, fillPrice, buy, holdingPeriod, scenarioRole }) {
  const hasFill = positive(fillPrice) !== null;
  const cancelConditions = unique(buy && buy.cancelConditions);
  return {
    status: hasFill ? "active" : "not_applicable_before_fill",
    statusLabel: hasFill ? "按条件持有，T+1强制复核" : "未成交，不适用",
    verdict: hasFill ? "conditional_hold" : "not_applicable",
    action: hasFill
      ? "只要主路径、方向承接和个股结构仍成立就持有；任一硬退出条件触发立即服从卖出优先级。"
      : "当前只是买入预案；没有真实成交前，不得显示成正在持有。",
    conditions: pick ? [
      "市场实际路径没有降级到禁止交易",
      "所属方向的核心/容量承接仍在，未退化为单票孤立上涨",
      "个股保持主动，关键结构未破坏",
    ] : [],
    addConditions: pick ? [
      "先有初始成交，再由市场与方向的早期加强验证决定是否加仓",
      "即使加强得到确认，价格已经透支或超出观察区也不追",
    ] : [],
    exitConditions: cancelConditions,
    scenarioActivationRequired: scenarioRole === "contingency",
    plannedWindow: holdingPeriod.windowTradingDays,
    mandatoryReview: holdingPeriod.mandatoryReview,
  };
}

function explicitNewEntryBlock(marketEmotion) {
  const source = marketEmotion && typeof marketEmotion === "object" ? marketEmotion : {};
  const window = source.tradeWindow && typeof source.tradeWindow === "object" ? source.tradeWindow : {};
  const windowKey = clean(window.key);
  return source.riskBlockNewEntry === true
    || source.hardBlockNewEntry === true
    || positionLimitBlocksNewEntry(source)
    || window.hardBlock === true
    || window.blockNewEntry === true
    || (window.allowNew === false && /negative_feedback|risk_off|blocked|defen[sc]e|退潮|防守/.test(windowKey));
}

function buildVerdict({ forecast, eligibility, pick, priceAvailable, triggersAvailable, marketEmotion }) {
  if (!forecast.primaryKey) {
    return {
      key: "forecast_unavailable",
      label: "明日主路径不可用",
      planAvailable: false,
      entryAllowedNow: false,
      action: "先补齐明日市场主判断，不在缺少主路径时推荐股票。",
    };
  }
  if (!pick) {
    return {
      key: eligibility.primaryEligible ? "candidate_missing" : "wait_no_primary_candidate",
      label: eligibility.primaryEligible ? "候选数据缺失" : "主路径暂无合格股票",
      planAvailable: false,
      entryAllowedNow: false,
      action: eligibility.primaryEligible ? "等待候选数据恢复。" : "空仓等待，不拿备选或后排补位。",
    };
  }
  if (eligibility.codeMismatch) {
    return { key: "candidate_mismatch", label: "情景候选与股票不一致", planAvailable: false, entryAllowedNow: false, action: "取消计划并重新核对候选代码。" };
  }
  if (!eligibility.candidateEligible) {
    return {
      key: eligibility.primaryEligible ? "candidate_ineligible" : "wait_no_primary_candidate",
      label: eligibility.primaryEligible ? "该股票没有交易资格" : "主路径暂无合格股票",
      planAvailable: false,
      entryAllowedNow: false,
      action: eligibility.primaryEligible ? "只保留观察，不生成买点。" : "空仓等待，不为了页面有答案而强塞股票。",
    };
  }
  if (explicitNewEntryBlock(marketEmotion)) {
    return { key: "new_entry_blocked", label: "当前禁止新开仓", planAvailable: false, entryAllowedNow: false, action: "保留观察计划，等待市场交易权限重新打开。" };
  }
  if (!priceAvailable) {
    return { key: "price_unavailable", label: "价格缺失，无法执行", planAvailable: false, entryAllowedNow: false, action: "等待可信价格恢复，禁止生成虚构买卖价。" };
  }
  if (!triggersAvailable) {
    return { key: "trigger_unavailable", label: "触发条件缺失", planAvailable: false, entryAllowedNow: false, action: "只有观察区没有买点，补齐承接触发前不执行。" };
  }
  const role = eligibility.candidateScenarioKey === forecast.primaryKey ? "primary" : "contingency";
  if (role === "primary") {
    return {
      key: "primary_conditional",
      label: "主路径条件候选",
      planAvailable: true,
      entryAllowedNow: false,
      action: "按主路径等待早期承接触发，可先试错；后续加强主要用于加仓，不等全面确认后追涨。",
    };
  }
  return {
    key: "contingency_only",
    label: "仅备选路径候选",
    planAvailable: true,
    entryAllowedNow: false,
    action: "主路径不买这只；只有备选路径实际成为主导且价格仍有赔率时才评估执行。",
  };
}

function unavailableBuy() {
  return {
    status: "blocked",
    statusLabel: "当前不具备买入资格",
    tradeMode: null,
    plan: "",
    observationZone: {
      label: "观察区（不是自动买点）",
      nature: "observation_only",
      basis: "unavailable",
      referencePrice: null,
      priceRange: null,
      lines: [],
      automaticEntry: false,
      requiresTrigger: true,
    },
    entryTriggers: [],
    cancelConditions: [],
    noChaseRules: [],
    initialPosition: null,
    stockInitialPosition: null,
    marketPositionLimit: null,
    positionPolicy: { appliedFraction: null, marketBlocked: false, rule: "" },
    scenarioActivationRequired: false,
    scenarioKey: null,
    note: "没有合格股票时不生成买点。",
  };
}

function unavailableSell() {
  return {
    status: "unavailable",
    statusLabel: "未形成有效交易",
    basis: "unavailable",
    basisPrice: null,
    basisLabel: "价格不可用",
    recalcAfterFill: true,
    referenceOnly: true,
    hardStop: { pctRange: null, priceRange: null, rule: "" },
    structuralExit: { ma5: null, rule: "" },
    reduce: { rule: "" },
    breakEven: { pct: null, price: null, rule: "" },
    takeProfit: { pctRange: null, priceRange: null, rule: "" },
    priorityPolicy: SELL_PRIORITY.map((item) => ({ ...item })),
    actions: [],
    conflicts: [],
    note: "没有合格股票或可信价格时不生成卖出数字。",
  };
}

function buildExecutionAdvice(input = {}) {
  const marketForecast = input.marketForecast || input.forecast || {};
  const marketEmotion = input.marketEmotion && typeof input.marketEmotion === "object" ? input.marketEmotion : {};
  const pick = input.pick && typeof input.pick === "object" ? input.pick : null;
  const pickCode = clean(pick && (pick.code || pick.secCode));
  const forecast = normalizeForecast(marketForecast);
  const eligibility = normalizeScenarioEligibility(input.scenarioEligibility, pickCode, forecast.primaryKey);
  const referencePrice = positive(
    (pick && pick.priceIntegrity && pick.priceIntegrity.price)
    ?? (pick && pick.price)
    ?? (pick && pick.close)
    ?? (pick && pick.lastPrice),
  );
  const fillObject = input.fill && typeof input.fill === "object" ? input.fill : {};
  const fillPrice = positive(input.fillPrice ?? input.actualFillPrice ?? fillObject.price ?? fillObject.buyPrice ?? fillObject.costPrice);
  const scenarioRole = !pick || !eligibility.candidateEligible || !eligibility.candidateScenarioKey
    ? "none"
    : eligibility.candidateScenarioKey === forecast.primaryKey ? "primary" : "contingency";
  const buy = pick
    ? buildBuyPlan({ pick, referencePrice, scenarioRole, eligibility, marketEmotion })
    : unavailableBuy();
  const verdict = buildVerdict({
    forecast,
    eligibility,
    pick,
    priceAvailable: referencePrice !== null || fillPrice !== null,
    triggersAvailable: buy.entryTriggers.length > 0,
    marketEmotion,
  });
  if (!verdict.planAvailable) {
    buy.status = "blocked";
    buy.statusLabel = verdict.label;
    buy.note = verdict.action;
  }
  const planEligible = Boolean(pick && eligibility.candidateEligible && verdict.planAvailable);
  const holdingPeriod = buildHoldingPeriod({ pick, marketEmotion, eligible: planEligible });
  const hold = buildHoldPlan({ pick, fillPrice, buy, holdingPeriod, scenarioRole });
  const sell = pick
    ? buildSellPlan({ pick, marketEmotion, referencePrice, fillPrice })
    : unavailableSell();

  const errors = [];
  const warnings = [];
  if (!forecast.primaryKey) errors.push("forecast_primary_missing");
  if (eligibility.codeMismatch) errors.push("scenario_candidate_code_mismatch");
  if (pick && referencePrice === null && fillPrice === null) errors.push("decision_price_missing");
  if (pick && eligibility.candidateEligible && !buy.entryTriggers.length) errors.push("entry_trigger_missing");
  if (fillObject.status === "filled" && fillPrice === null) errors.push("filled_price_missing");
  if (!eligibility.primaryEligible) warnings.push("primary_path_has_no_eligible_candidate");
  if (scenarioRole === "contingency") warnings.push("candidate_is_contingency_only");
  if (sell.basis === "pre_entry_reference") warnings.push("sell_levels_require_recalculation_after_fill");
  if (holdingPeriod.method === "unavailable") warnings.push("holding_period_unavailable");
  if (sell.conflicts.length) errors.push("sell_rule_conflict");
  const integrity = {
    ok: errors.length === 0,
    status: errors.length ? "invalid" : warnings.length ? "degraded" : "valid",
    errors: unique(errors),
    warnings: unique(warnings),
    checks: {
      primaryPathKnown: Boolean(forecast.primaryKey),
      noPrimaryCandidateForced: eligibility.primaryEligible || scenarioRole !== "primary",
      candidateEligibilityKnown: eligibility.candidateEligibilityKnown,
      decisionPriceAvailable: referencePrice !== null || fillPrice !== null,
      observationZoneIsNotEntry: buy.observationZone.automaticEntry === false,
      sellBasisSafe: fillPrice !== null ? sell.basis === "actual_fill" : ["pre_entry_reference", "unavailable"].includes(sell.basis),
      recalcRequiredBeforeFill: fillPrice !== null ? sell.recalcAfterFill === false : sell.recalcAfterFill === true,
      sellPriorityValid: sell.conflicts.length === 0,
      holdingPeriodNotDerivedFromWinRate3d: holdingPeriod.statisticsUsed.length === 0
        && holdingPeriod.excludedStatistics.includes("backtest.winRate3d"),
      mandatoryT1Review: holdingPeriod.mandatoryReview.required === true
        && holdingPeriod.mandatoryReview.checkpoint === "T+1",
    },
  };

  const scenario = {
    role: scenarioRole,
    roleLabel: scenarioRole === "primary" ? "主路径" : scenarioRole === "contingency" ? "备选路径" : "无可执行路径",
    primaryKey: forecast.primaryKey || null,
    primaryLabel: forecast.primaryLabel,
    primaryProbability: forecast.primaryProbability,
    candidateKey: eligibility.candidateScenarioKey || null,
    candidateLabel: scenarioLabel(eligibility.candidateScenarioKey),
    primaryEligible: eligibility.primaryEligible,
    candidateEligible: eligibility.candidateEligible,
    reason: eligibility.candidateReason || null,
  };
  const display = {
    verdict: verdict.label,
    scenario: scenario.roleLabel + (scenario.candidateKey ? ` · ${scenario.candidateLabel}` : ""),
    buy: buy.status === "conditional" ? "等待情景+承接触发，观察区不自动买" : "不买/等待",
    hold: hold.statusLabel,
    sell: sell.statusLabel,
    holdingPeriod: holdingPeriod.display,
    summary: `${verdict.label}；${verdict.action}`,
  };

  return {
    version: 1,
    verdict,
    scenarioRole,
    scenario,
    buy,
    hold,
    sell,
    holdingPeriod,
    integrity,
    display,
  };
}

module.exports = {
  SCENARIO_LABELS,
  SELL_PRIORITY,
  canonicalScenarioKey,
  positionLimitPolicy,
  positionLimitBlocksNewEntry,
  normalizeForecast,
  normalizeScenarioEligibility,
  detectSellConflicts,
  recalculateSellAfterFill,
  buildExecutionAdvice,
};
