"use strict";

/**
 * 明日直接决策编排层（纯函数）。
 *
 * 本模块不重新预测、不重新选股，只做三件事：
 * 1. 把 market forecast 与旧三路径候选统一到固定 canonical contract；
 * 2. 只允许主路径的合格票进入 candidates，其他路径只能进入 contingencies；
 * 3. 用 execution-advice 生成买、持、卖、持有期，并执行最终安全闸门。
 */

const { MARKET_PATH_KEYS, MARKET_PATH_LABELS } = require("./tomorrow-market-forecast");
const { canonicalScenarioKey, positionLimitPolicy, buildExecutionAdvice } = require("./execution-advice");

const PATH_KEYS = Object.freeze(Array.from(MARKET_PATH_KEYS));

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function clean(value) {
  return String(value || "").trim();
}

function unique(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean)));
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value)) || [];
}

function executionVersionOf(...values) {
  return values.reduce((maxVersion, value) => {
    const direct = isObject(value) ? finite(value.executionVersion) : finite(value);
    const nested = isObject(value) && isObject(value.tomorrowExecution)
      ? finite(value.tomorrowExecution.executionVersion)
      : null;
    return Math.max(maxVersion, direct ?? 0, nested ?? 0);
  }, 0);
}

function rangeText(range, suffix = "") {
  return Array.isArray(range) && range.length === 2 && range.every((value) => finite(value) !== null)
    ? `${range[0]}～${range[1]}${suffix}`
    : "待实际价格确认";
}

function scenarioLabel(key) {
  return MARKET_PATH_LABELS[canonicalScenarioKey(key)] || clean(key) || "路径待确认";
}

function resolveInputs(input) {
  const source = isObject(input) ? input : {};
  const bestPicks = isObject(source.bestPicks) ? source.bestPicks : {};
  const marketState = isObject(source.marketState)
    ? source.marketState
    : isObject(source.market && source.market.state) ? source.market.state : {};
  return {
    source,
    forecast: isObject(source.forecast)
      ? source.forecast
      : isObject(source.marketForecast) ? source.marketForecast : isObject(source.tomorrowMarketForecast) ? source.tomorrowMarketForecast : {},
    marketEmotion: isObject(source.marketEmotion) ? source.marketEmotion : {},
    marketState,
    tradeWindow: isObject(source.tradeWindow)
      ? source.tradeWindow
      : isObject(marketState.tradeWindow) ? marketState.tradeWindow : isObject(bestPicks.tradeWindow) ? bestPicks.tradeWindow : {},
    shockTransition: isObject(source.shockTransition)
      ? source.shockTransition
      : isObject(marketState.shockTransition) ? marketState.shockTransition : {},
    riskBoard: isObject(source.riskBoard) ? source.riskBoard : {},
    bestPicks,
    picks: firstArray(source.picks, bestPicks.picks, Array.isArray(source.bestPicks) ? source.bestPicks : null, source.candidates),
    scenarioPlans: firstArray(source.scenarioPlans, bestPicks.scenarioPlans, source.tomorrowExecution && source.tomorrowExecution.scenarioPlans),
    premarketGate: isObject(source.premarketGate) ? source.premarketGate : {},
    executionVersion: executionVersionOf(source, bestPicks),
    fillByCode: source.fillByCode,
  };
}

function codeOf(value) {
  return clean(value && (value.code || value.secCode || value.stockCode || value.symbol));
}

function hydratePick(candidate, fullPick) {
  const compact = isObject(candidate) ? candidate : {};
  const full = isObject(fullPick) ? fullPick : {};
  const existingExecution = isObject(full.tomorrowExecution) ? full.tomorrowExecution : {};
  const compactTriggers = firstArray(compact.triggers, compact.stockTriggers);
  const compactCancels = firstArray(compact.cancelConditions);
  return {
    ...compact,
    ...full,
    code: codeOf(full) || codeOf(compact),
    tomorrowExecution: {
      ...compact,
      ...existingExecution,
      tomorrowEntryQualified: existingExecution.tomorrowEntryQualified !== undefined
        ? existingExecution.tomorrowEntryQualified
        : compact.tomorrowEntryQualified,
      triggers: existingExecution.triggers || compactTriggers,
      cancelConditions: existingExecution.cancelConditions || compactCancels,
    },
  };
}

function normalizeScenarioPlans(plans, picks, inheritedExecutionVersion = 0) {
  const pickByCode = new Map((Array.isArray(picks) ? picks : []).map((pick) => [codeOf(pick), pick]).filter(([code]) => code));
  const rows = [];
  const duplicates = [];
  const seen = new Set();
  (Array.isArray(plans) ? plans : []).forEach((plan, index) => {
    if (!isObject(plan)) return;
    const rawKey = clean(plan.key || plan.scenarioKey || plan.pathKey);
    const key = canonicalScenarioKey(rawKey);
    if (!PATH_KEYS.includes(key)) return;
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
    const compact = isObject(plan.candidate) ? plan.candidate : null;
    const candidateCode = codeOf(compact);
    const full = candidateCode ? pickByCode.get(candidateCode) : null;
    const candidate = compact ? hydratePick(compact, full) : null;
    const executionVersion = executionVersionOf(inheritedExecutionVersion, plan, compact, full, candidate);
    const strictExecutionContract = executionVersion >= 3;
    const qualified = candidate && candidate.tomorrowExecution
      ? candidate.tomorrowExecution.tomorrowEntryQualified
      : undefined;
    const readyByStatus = /^(ready|eligible|qualified)$/i.test(clean(plan.status));
    const explicitlyEmpty = /^(empty|blocked|risk|unavailable)$/i.test(clean(plan.status));
    const ready = Boolean(
      candidate
      && !explicitlyEmpty
      && (strictExecutionContract ? qualified === true : qualified !== false)
      && (readyByStatus || qualified === true),
    );
    rows.push({
      index,
      rawKey,
      key,
      label: scenarioLabel(key),
      plan,
      candidate,
      candidateCode,
      executionVersion,
      strictExecutionContract,
      ready,
      status: ready ? "ready" : candidate ? "blocked" : "empty",
      action: clean(plan.action),
      marketCondition: clean(plan.marketCondition),
      marketSignals: firstArray(plan.marketSignals),
    });
  });
  return { rows, duplicates: unique(duplicates) };
}

function pathPlan(rows, key) {
  return rows.find((row) => row.key === key) || null;
}

function baseConcept(value) {
  return clean(value).split(/[（(]/)[0].trim();
}

function candidateConcepts(pick) {
  return unique([
    pick && pick.mainConcept,
    pick && pick.focusDirection,
    pick && pick.concept,
    pick && pick.mainFamily,
  ].map(baseConcept));
}

function riskBlockReasons(pick, riskBoard) {
  if (!pick) return ["候选数据缺失"];
  const reasons = [];
  const concepts = candidateConcepts(pick);
  const blockedConcepts = unique(riskBoard && riskBoard.blockedConcepts).map(baseConcept);
  const conceptHit = concepts.find((concept) => blockedConcepts.includes(concept));
  if (conceptHit) reasons.push(`风险板已屏蔽题材：${conceptHit}`);
  const ticketType = clean(pick.ticketType || pick.type);
  if (ticketType && unique(riskBoard && riskBoard.blockedTicketTypes).includes(ticketType)) {
    reasons.push(`风险板已屏蔽票型：${ticketType}`);
  }
  const setup = clean(pick.setup || pick.buy && pick.buy.mode);
  if (setup && unique(riskBoard && riskBoard.blockedSetups).some((blocked) => setup === blocked || setup.includes(blocked))) {
    reasons.push(`风险板已屏蔽模式：${setup}`);
  }
  const blockedItem = firstArray(riskBoard && riskBoard.items).find((item) => (
    item && item.blocked === true && concepts.includes(baseConcept(item.name))
  ));
  if (blockedItem) reasons.push(clean(blockedItem.reason) || `${blockedItem.name}已被风险板屏蔽`);
  if (pick.riskBlocked === true || pick.blocked === true) reasons.push(clean(pick.blockReason) || "候选自身带有硬风险标记");
  return unique(reasons);
}

function priceBlockReasons(pick) {
  const integrity = isObject(pick && pick.priceIntegrity) ? pick.priceIntegrity : {};
  const price = positive(
    integrity.price
    ?? (pick && pick.price)
    ?? (pick && pick.close)
    ?? (pick && pick.lastPrice),
  );
  const reasons = [];
  if (price === null) reasons.push("缺少可信决策价格");
  if (integrity.valid === false || integrity.consistent === false) reasons.push("价格完整性校验失败");
  if (/invalid|error|failed|unavailable|异常|失败/.test(clean(integrity.status || integrity.grade))) {
    reasons.push("价格完整性状态异常");
  }
  if (Array.isArray(integrity.errors) && integrity.errors.length) reasons.push("价格完整性存在错误");
  return unique(reasons);
}

function candidateBlockReasons(row, riskBoard, premarketGate = {}) {
  const reasons = [];
  if (!row || !row.candidate) return ["情景没有候选"];
  if (!row.ready) reasons.push("候选未通过情景执行资格");
  const candidate = row.candidate;
  const leadership = isObject(candidate.leadership) ? candidate.leadership : {};
  const hardGate = isObject(candidate.hardGate) ? candidate.hardGate : {};
  const tomorrowEntryQualified = isObject(candidate.tomorrowExecution)
    ? candidate.tomorrowExecution.tomorrowEntryQualified
    : undefined;
  if (row.strictExecutionContract) {
    if (tomorrowEntryQualified !== true) {
      reasons.push(tomorrowEntryQualified === false
        ? "明日入场资格未通过"
        : "明日入场资格缺失（executionVersion>=3 必填）");
    }
    if (candidate.tradeQualified !== true) {
      reasons.push(candidate.tradeQualified === false
        ? "候选个股交易资格未通过"
        : "候选个股交易资格缺失（executionVersion>=3 必填）");
    }
    if (leadership.tradeQualified !== true) {
      reasons.push(leadership.tradeQualified === false
        ? "核心地位交易资格未通过"
        : "核心地位交易资格缺失（executionVersion>=3 必填）");
    }
    if (hardGate.pass !== true) {
      reasons.push(hardGate.pass === false
        ? "候选个股硬门槛未通过"
        : "候选个股硬门槛缺失（executionVersion>=3 必填）");
    }
  } else {
    if (candidate.tradeQualified === false) reasons.push("候选个股交易资格未通过");
    if (leadership.tradeQualified === false) reasons.push("核心地位交易资格未通过");
    if (hardGate.pass === false) reasons.push("候选个股硬门槛未通过");
  }
  if (Array.isArray(premarketGate.allowedCandidateCodes)
    && !premarketGate.allowedCandidateCodes.map(clean).includes(codeOf(candidate))) {
    reasons.push("候选不属于当前主风格与主方向交集");
  }
  reasons.push(...riskBlockReasons(row.candidate, riskBoard));
  reasons.push(...priceBlockReasons(row.candidate));
  return unique(reasons);
}

function isRedLight(marketEmotion) {
  const light = clean(marketEmotion && (marketEmotion.light || marketEmotion.lightLabel || marketEmotion.riskLight)).toLowerCase();
  return light === "red" || /红灯/.test(light);
}

function isHardWindowBlock(tradeWindow) {
  return Boolean(
    tradeWindow && (
      tradeWindow.hardBlock === true
      || tradeWindow.blockNewEntry === true
      || tradeWindow.allowNew === false
    )
  );
}

function globalBlockReasons(context) {
  const reasons = [];
  const bestPicks = isObject(context.bestPicks) ? context.bestPicks : {};
  const overallPriceIntegrity = isObject(bestPicks.priceIntegrity) ? bestPicks.priceIntegrity : {};
  const executionGate = isObject(bestPicks.executionGate) ? bestPicks.executionGate : {};
  const positionPolicy = positionLimitPolicy(context.marketEmotion);
  if (isRedLight(context.marketEmotion)) reasons.push("市场情绪为红灯，禁止新开仓");
  if (context.shockTransition && context.shockTransition.active === true) reasons.push("市场处于冲击验证期，禁止抢修复");
  if (isHardWindowBlock(context.tradeWindow)) reasons.push(clean(context.tradeWindow.summary) || "执行窗口处于硬防守状态");
  if (bestPicks.available === false || bestPicks.tradeDisabled === true) reasons.push(clean(bestPicks.note) || "最优解当前不可交易");
  if (overallPriceIntegrity.status && overallPriceIntegrity.status !== "pass") reasons.push("候选价格总校验未通过，暂停执行");
  if (executionGate.active === true) reasons.push(clean(executionGate.label || executionGate.summary) || "执行时间闸门尚未解除");
  if (positionPolicy.blocked) reasons.push(positionPolicy.reason || "市场仓位上限为0%，禁止新开仓");
  if (context.source.hardBlockNewEntry === true || context.source.executionAllowed === false) {
    reasons.push(clean(context.source.executionBlockReason) || "执行总闸门禁止新开仓");
  }
  if (context.premarketGate && (
    context.premarketGate.blocked === true
    || clean(context.premarketGate.executionMode).toLowerCase() === "blocked"
  )) {
    const upstreamReasons = unique(context.premarketGate.reasons);
    reasons.push(...(upstreamReasons.length ? upstreamReasons : ["盘前宏观到微观授权链未通过"]));
  }
  return unique(reasons);
}

function fillFor(fillByCode, code) {
  if (!fillByCode || !code) return null;
  if (fillByCode instanceof Map) return fillByCode.get(code) || null;
  return isObject(fillByCode) ? fillByCode[code] || null : null;
}

function executionEmotion(context, hardBlocked) {
  const regime = context.forecast && context.forecast.sentimentCycle && context.forecast.sentimentCycle.marketRegime;
  return {
    ...context.marketEmotion,
    cycle: regime || context.marketEmotion.cycle || context.marketState.cycle,
    tradeWindow: context.tradeWindow,
    riskBlockNewEntry: hardBlocked || context.marketEmotion.riskBlockNewEntry === true,
  };
}

function eligibilityPlans(rows) {
  return rows.map((row) => ({
    key: row.rawKey || row.key,
    status: row.ready ? "ready" : row.candidate ? "blocked" : "empty",
    candidate: row.candidate ? {
      code: codeOf(row.candidate),
      tomorrowEntryQualified: row.ready,
    } : null,
  }));
}

function summarizeBuy(advice) {
  if (!advice || advice.buy.status !== "conditional") return clean(advice && advice.verdict && advice.verdict.action) || "不买，等待";
  const range = advice.buy.observationZone && advice.buy.observationZone.priceRange;
  const rangePart = range ? `观察区${rangeText(range)}` : "等待可信价格与承接";
  const trigger = advice.buy.entryTriggers && advice.buy.entryTriggers[0];
  const position = clean(advice.buy.initialPosition);
  return `${advice.buy.tradeMode || "条件执行"}；${rangePart}，${trigger ? `触发：${trigger}` : "触发条件待确认"}；${position ? `初始仓位：${position}；` : ""}进入观察区也不自动买。`;
}

function summarizeHold(advice) {
  if (!advice) return "未成交，不适用";
  if (advice.hold.status === "not_applicable_before_fill") {
    return `未成交，不适用；成交后按${advice.holdingPeriod.display}管理，T+1强制复核。`;
  }
  return `按条件持有；计划${advice.holdingPeriod.display}，T+1强制复核，硬退出条件优先。`;
}

function summarizeSell(advice) {
  if (!advice || advice.sell.status === "unavailable") return "价格不可用，不生成卖出数字";
  const hard = advice.sell.hardStop;
  const hardText = hard && hard.priceRange ? `硬止损${rangeText(hard.priceRange)}` : "硬止损待成本确认";
  const prefix = advice.sell.basis === "actual_fill" ? "按实际成交成本" : "成交前参考";
  return `${prefix}：${hardText}；结构失败清仓，回流失败先减；实际成交后重算全部成本相关价位。`;
}

function ticketFrom(row, advice, blockers, globalBlocks) {
  const pick = row.candidate;
  const allBlocks = unique([...(globalBlocks || []), ...(blockers || [])]);
  const periodSummary = advice.holdingPeriod.method === "heuristic"
    ? `${advice.holdingPeriod.display}；T+1强制复核，非统计胜率推导`
    : "未形成有效交易，不给持有天数";
  return {
    code: codeOf(pick),
    name: clean(pick.name) || codeOf(pick),
    direction: clean(pick.mainConcept || pick.focusDirection || pick.concept) || null,
    identity: clean(pick.leadership && (pick.leadership.identity || pick.leadership.levelLabel) || pick.identity || pick.role) || null,
    phase: clean(pick.tomorrowExecution && (pick.tomorrowExecution.stateLabel || pick.tomorrowExecution.pricePhaseLabel) || pick.stateLabel) || null,
    marketCapCarrier: isObject(pick.marketCapCarrier) ? pick.marketCapCarrier : null,
    participationValue: isObject(pick.participationValue) ? {
      ...pick.participationValue,
      components: isObject(pick.participationValue.components) ? { ...pick.participationValue.components } : {},
    } : null,
    riskAdjustment: isObject(pick.riskAdjustment) ? {
      ...pick.riskAdjustment,
      components: isObject(pick.riskAdjustment.components) ? { ...pick.riskAdjustment.components } : {},
    } : null,
    riskAdjustedParticipationScore: finite(pick.riskAdjustedParticipationScore),
    positionAllocation: isObject(pick.positionAllocation) ? { ...pick.positionAllocation } : null,
    selectionAuthority: clean(pick.selectionAuthority) || null,
    scenarioKey: row.key,
    scenarioLabel: row.label,
    status: allBlocks.length ? "blocked" : advice.verdict.planAvailable ? "conditional" : "wait",
    statusLabel: allBlocks.length ? "已阻断" : advice.verdict.label,
    blockers: allBlocks,
    buy: {
      summary: allBlocks.length ? `不买：${allBlocks.join("；")}` : summarizeBuy(advice),
      display: allBlocks.length ? "不买/等待" : advice.display.buy,
      status: allBlocks.length ? "blocked" : advice.buy.status,
      observationZone: advice.buy.observationZone,
      triggers: advice.buy.entryTriggers,
      cancelConditions: advice.buy.cancelConditions,
      initialPosition: advice.buy.initialPosition,
    },
    hold: {
      summary: summarizeHold(advice),
      display: advice.display.hold,
      status: advice.hold.status,
      conditions: advice.hold.conditions,
      addConditions: advice.hold.addConditions,
    },
    sell: {
      summary: summarizeSell(advice),
      display: advice.display.sell,
      status: advice.sell.status,
      basis: advice.sell.basis,
      recalcAfterFill: advice.sell.recalcAfterFill,
      hardStop: advice.sell.hardStop,
      structuralExit: advice.sell.structuralExit,
      reduce: advice.sell.reduce,
      breakEven: advice.sell.breakEven,
      takeProfit: advice.sell.takeProfit,
      priorityPolicy: advice.sell.priorityPolicy,
    },
    holdingPeriod: {
      summary: periodSummary,
      display: advice.holdingPeriod.display,
      method: advice.holdingPeriod.method,
      windowTradingDays: advice.holdingPeriod.windowTradingDays,
      mandatoryReview: advice.holdingPeriod.mandatoryReview,
      extensionRule: advice.holdingPeriod.extensionRule,
    },
    upgrade: advice.buy.entryTriggers && advice.buy.entryTriggers[0] || null,
    downgrade: advice.buy.cancelConditions && advice.buy.cancelConditions[0] || null,
    advice,
  };
}

function validationContract(forecast, marketEmotion) {
  const source = isObject(marketEmotion && marketEmotion.validation) ? marketEmotion.validation : {};
  const updateRules = firstArray(forecast && forecast.updateRules);
  return {
    upgrade: unique(firstArray(source.upgrade, updateRules.flatMap((row) => firstArray(row && row.upgradeConditions)))),
    hold: unique(firstArray(source.hold)),
    downgrade: unique(firstArray(source.downgrade, updateRules.flatMap((row) => firstArray(row && row.downgradeConditions)))),
    checkpoints: updateRules.map((row) => clean(row && row.time)).filter(Boolean),
  };
}

function buildTomorrowDecision(input = {}) {
  const context = resolveInputs(input);
  const forecast = context.forecast;
  const primaryKey = canonicalScenarioKey(forecast && forecast.primary && forecast.primary.key);
  const normalizedPlans = normalizeScenarioPlans(context.scenarioPlans, context.picks, context.executionVersion);
  const planRows = normalizedPlans.rows;
  const effectiveExecutionVersion = planRows.reduce(
    (maxVersion, row) => Math.max(maxVersion, row.executionVersion || 0),
    context.executionVersion || 0,
  );
  const eligibility = eligibilityPlans(planRows);
  const probabilityValues = Object.fromEntries(PATH_KEYS.map((key) => [key, finite(forecast && forecast.probabilities && forecast.probabilities[key])]));
  const probabilitySum = PATH_KEYS.reduce((sum, key) => sum + (probabilityValues[key] ?? 0), 0);
  const probabilitiesValid = PATH_KEYS.every((key) => probabilityValues[key] !== null && probabilityValues[key] >= 0 && probabilityValues[key] <= 100)
    && probabilitySum === 100;
  const primaryKnown = PATH_KEYS.includes(primaryKey);
  const forecastContractValid = probabilitiesValid && primaryKnown;
  const globalBlocks = globalBlockReasons(context);
  const mainRow = primaryKnown ? pathPlan(planRows, primaryKey) : null;
  const mainCandidateBlocks = mainRow ? candidateBlockReasons(mainRow, context.riskBoard, context.premarketGate) : ["主路径暂无合格候选"];
  const mainHardBlocks = unique([
    ...(forecastContractValid ? [] : ["明日预测契约无效"]),
    ...(normalizedPlans.duplicates.length ? ["明日情景计划存在重复键，停止执行"] : []),
    ...globalBlocks,
    ...mainCandidateBlocks,
  ]);
  const mainAdvice = mainRow && mainRow.candidate
    ? buildExecutionAdvice({
      marketForecast: forecast,
      marketEmotion: executionEmotion(context, mainHardBlocks.length > 0),
      pick: mainRow.candidate,
      scenarioEligibility: eligibility,
      fill: fillFor(context.fillByCode, codeOf(mainRow.candidate)),
    })
    : null;
  if (mainAdvice && mainAdvice.scenarioRole !== "primary") mainHardBlocks.push("候选与明日主路径不一致");
  if (mainAdvice && mainAdvice.integrity.errors.length) mainHardBlocks.push(...mainAdvice.integrity.errors.map((code) => `执行建议异常：${code}`));
  const mainEligible = Boolean(mainRow && mainRow.ready && mainAdvice && !mainHardBlocks.length && mainAdvice.verdict.planAvailable);
  const mainTicket = mainRow && mainAdvice
    ? ticketFrom(mainRow, mainAdvice, mainCandidateBlocks, unique([...globalBlocks, ...(forecastContractValid ? [] : ["明日预测契约无效"])]))
    : null;
  const candidates = mainEligible && mainTicket ? [mainTicket] : [];

  const blockedCandidates = [];
  if (mainRow && mainRow.candidate && !mainEligible) {
    blockedCandidates.push({
      code: codeOf(mainRow.candidate),
      name: clean(mainRow.candidate.name),
      scenarioKey: mainRow.key,
      reasons: unique(mainHardBlocks),
    });
  }
  const contingencies = [];
  planRows.filter((row) => row.key !== primaryKey && row.candidate).forEach((row) => {
    const candidateBlocks = candidateBlockReasons(row, context.riskBoard, context.premarketGate);
    const advice = buildExecutionAdvice({
      marketForecast: forecast,
      marketEmotion: executionEmotion(context, globalBlocks.length > 0 || candidateBlocks.length > 0),
      pick: row.candidate,
      scenarioEligibility: eligibility,
      fill: fillFor(context.fillByCode, codeOf(row.candidate)),
    });
    if (globalBlocks.length || candidateBlocks.length || advice.integrity.errors.length || advice.scenarioRole !== "contingency") {
      blockedCandidates.push({
        code: codeOf(row.candidate),
        name: clean(row.candidate.name),
        scenarioKey: row.key,
        reasons: unique([...globalBlocks, ...candidateBlocks, ...advice.integrity.errors]),
      });
      return;
    }
    contingencies.push(ticketFrom(row, advice, [], globalBlocks));
  });

  const cash = candidates.length === 0;
  const primaryProbability = primaryKnown ? probabilityValues[primaryKey] : null;
  const scenarios = PATH_KEYS.map((key) => {
    const plan = pathPlan(planRows, key);
    return {
      key,
      label: MARKET_PATH_LABELS[key],
      probability: probabilityValues[key],
      probabilityLabel: probabilityValues[key] === null ? "--" : `${probabilityValues[key]}%（规则先验）`,
      isPrimary: key === primaryKey,
      candidateStatus: plan ? plan.status : "empty",
      candidateCode: plan && plan.candidate ? codeOf(plan.candidate) : null,
      candidateName: plan && plan.candidate ? clean(plan.candidate.name) || null : null,
      calibrated: forecast.calibrated === true,
    };
  });
  const sentiment = isObject(forecast.sentimentCycle) ? forecast.sentimentCycle : {};
  const regime = isObject(sentiment.marketRegime) ? sentiment.marketRegime : {};
  const confidenceScore = finite(forecast.confidence);
  const confidence = {
    score: confidenceScore,
    level: clean(forecast.confidenceLabel) || "待确认",
    label: confidenceScore === null ? "置信度待计算" : `${clean(forecast.confidenceLabel) || "规则"}置信 · ${confidenceScore}/100`,
    reason: clean(forecast.dataQuality && forecast.dataQuality.notes && forecast.dataQuality.notes[0])
      || "当前为规则先验，尚未完成历史校准。",
    method: clean(forecast.method) || "unavailable",
    calibrated: forecast.calibrated === true,
    summary: confidenceScore === null
      ? "置信度待计算"
      : `${confidenceScore}/100；规则先验，未历史校准`,
  };
  const market = {
    cycle: clean(regime.label || context.marketEmotion.cycle || context.marketState.cycle) || "周期待确认",
    cycleKey: clean(regime.key) || null,
    corePhase: clean(sentiment.aggregateStageLabel) || "阶段待确认",
    corePhaseKey: clean(sentiment.aggregateStage) || null,
    expectedTransition: isObject(sentiment.expectedTransition) ? sentiment.expectedTransition : null,
    divergenceSize: clean(sentiment.divergenceSize) || "unknown",
    divergenceQuality: clean(sentiment.divergenceQuality) || "unknown",
    accelerationPath: isObject(sentiment.accelerationPath) ? sentiment.accelerationPath : null,
    light: clean(context.marketEmotion.light) || null,
    lightLabel: clean(context.marketEmotion.lightLabel) || null,
  };
  const directionBlockedByPremarket = firstArray(context.premarketGate.blockedSteps).includes("direction");
  const premarketDirectionReason = directionBlockedByPremarket
    ? unique(firstArray(context.premarketGate.reasons)).join("；")
    : "";
  const direction = candidates.length
    ? {
      status: "candidate",
      name: candidates[0].direction,
      path: `${scenarioLabel(primaryKey)} ${primaryProbability === null ? "" : `${primaryProbability}%`}`.trim(),
      reason: `主路径候选已通过题材、价格与执行安全闸门：${candidates[0].name}`,
    }
    : {
      status: "cash",
      name: directionBlockedByPremarket
        ? null
        : clean(context.bestPicks.focusDirection || mainRow && mainRow.candidate && mainRow.candidate.mainConcept) || null,
      path: `${scenarioLabel(primaryKey)} ${primaryProbability === null ? "" : `${primaryProbability}%`}`.trim(),
      reason: directionBlockedByPremarket
        ? (premarketDirectionReason || "方向权威数据不可用，停止执行")
        : mainHardBlocks.length
        ? unique(mainHardBlocks).join("；")
        : `主路径${scenarioLabel(primaryKey)}暂无合格候选，空仓等待`,
    };
  const positionPolicy = positionLimitPolicy(context.marketEmotion);
  const positionLimit = positionPolicy.text;
  const permission = {
    status: globalBlocks.length ? "blocked" : candidates.length ? "conditional" : "wait",
    allowImmediateEntry: false,
    canActivate: !globalBlocks.length && candidates.length > 0,
    allowAdd: false,
    positionGuide: clean(context.tradeWindow.positionGuide || context.marketState.position || context.marketEmotion.position) || null,
    positionLimit,
    checkpoints: ["09:25", "09:35"],
    executionMode: globalBlocks.length
      ? "blocked"
      : clean(context.premarketGate.executionMode) || "normal",
    reasons: globalBlocks,
    summary: globalBlocks.length
      ? `禁止新开仓：${globalBlocks.join("；")}`
      : candidates.length
        ? `盘后只生成条件计划；9:25与9:35完成早期验证后才允许试错，加强主要用于加仓，不追透支。${positionLimit ? `仓位上限：${positionLimit}。` : ""}`
        : "主路径没有合格候选，保持空仓；备选路径不能补位。",
  };
  const action = {
    key: candidates.length ? "conditional_plan" : "cash_wait",
    summary: globalBlocks.length
      ? `禁止新开仓：${globalBlocks.join("；")}`
      : candidates.length
      ? `${candidates[0].name}：${candidates[0].buy.summary}`
      : contingencies.length
        ? `空仓等待；${contingencies.map((item) => `${item.scenarioLabel}备选${item.name}`).join("、")}仅在路径切换后评估。`
        : "空仓等待；主路径及备选路径均无合格股票。",
  };
  const invalidationConditions = candidates.length
    ? candidates[0].buy.cancelConditions
    : unique([...globalBlocks, "主路径仍无合格候选时继续空仓，不用备选补位"]);
  const invalidation = {
    conditions: invalidationConditions,
    summary: invalidationConditions.length ? invalidationConditions.slice(0, 2).join("；") : "失效条件待确认",
  };
  const validation = validationContract(forecast, context.marketEmotion);
  const errors = [];
  const warnings = [];
  if (!primaryKnown) errors.push("forecast_primary_invalid");
  if (!probabilitiesValid) errors.push("forecast_probabilities_invalid");
  if (normalizedPlans.duplicates.length) errors.push("duplicate_scenario_plan");
  if (forecast.method !== "rule_prior" || forecast.calibrated !== false) warnings.push("forecast_not_explicit_uncalibrated_rule_prior");
  if (cash) warnings.push("primary_path_has_no_eligible_candidate");
  if (contingencies.length) warnings.push("contingency_candidates_are_not_primary_recommendations");
  if (globalBlocks.length) warnings.push("global_entry_gate_blocked");
  const integrity = {
    ok: errors.length === 0,
    status: errors.length ? "invalid" : warnings.length ? "degraded" : "valid",
    errors: unique(errors),
    warnings: unique(warnings),
    blockedCandidates,
    checks: {
      fixedScenarioKeys: scenarios.map((item) => item.key).join("|") === PATH_KEYS.join("|"),
      scenarioKeysUnique: new Set(scenarios.map((item) => item.key)).size === PATH_KEYS.length,
      probabilitiesSumTo100: probabilitiesValid,
      primaryPathKnown: primaryKnown,
      rulePriorExplicitlyUncalibrated: forecast.method === "rule_prior" && forecast.calibrated === false,
      cashWhenPrimaryCandidateMissing: mainEligible || (cash && candidates.length === 0),
      nonPrimaryCandidatesSeparated: contingencies.every((item) => item.scenarioKey !== primaryKey),
      riskBlocksApplied: !blockedCandidates.some((item) => candidates.some((candidate) => candidate.code === item.code)),
      priceIntegrityApplied: !candidates.some((candidate) => candidate.advice.integrity.checks.decisionPriceAvailable !== true),
      hardMarketBlocksApplied: !globalBlocks.length || candidates.length === 0,
      strictExecutionContractApplied: planRows
        .filter((row) => row.strictExecutionContract)
        .every((row) => {
          const candidate = row.candidate || {};
          return ![...candidates, ...contingencies].some((ticket) => ticket.code === codeOf(candidate))
            || (
              candidate.tomorrowExecution && candidate.tomorrowExecution.tomorrowEntryQualified === true
              && candidate.tradeQualified === true
              && candidate.leadership && candidate.leadership.tradeQualified === true
              && candidate.hardGate && candidate.hardGate.pass === true
            );
        }),
      rawForecastPreserved: forecast === context.forecast,
      rawAdvicePreserved: [...candidates, ...contingencies].every((item) => isObject(item.advice)),
    },
  };

  return {
    version: 1,
    executionVersion: effectiveExecutionVersion || 1,
    tradingDate: forecast.tradingDate || context.marketEmotion.tradingDate || null,
    method: clean(forecast.method) || "unavailable",
    methodLabel: clean(forecast.methodLabel) || "规则先验（未历史校准）",
    calibrated: forecast.calibrated === true,
    verdict: candidates.length ? "conditional" : "wait",
    verdictDetail: candidates.length
      ? { key: "conditional", label: "主路径条件候选", summary: action.summary }
      : { key: "wait", label: "空仓等待", summary: action.summary },
    primaryScenarioKey: primaryKey || null,
    scenarios,
    confidence,
    market,
    direction,
    candidates,
    contingencies,
    permission,
    action,
    invalidation,
    validation,
    integrity,
    forecast,
  };
}

module.exports = {
  PATH_KEYS,
  normalizeScenarioPlans,
  riskBlockReasons,
  priceBlockReasons,
  isHardWindowBlock,
  buildTomorrowDecision,
};
