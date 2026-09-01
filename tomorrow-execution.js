"use strict";

const { evaluateShortTermActiveCarrier } = require("./trading-rules");

/**
 * 明日三路径执行层。
 *
 * 这里只回答两个问题：
 * 1. 个股现在处于启动、确认、加速、分歧还是失败；
 * 2. 它只能在哪一种市场路径里取得次日条件博弈资格。
 *
 * 不在这里重写周期、题材或核心身份。三条路径是互斥预案，不是三只同时买。
 */

const PHASE_LABELS = Object.freeze({
  unknown: "阶段待确认",
  unstarted: "未启动",
  startup: "启动",
  confirmation: "确认",
  acceleration: "加速",
  divergence: "分歧/兑现",
  repair: "修复准备",
  failure: "失败",
});

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clean(value) {
  return String(value || "").trim();
}

function unique(list) {
  return Array.from(new Set((Array.isArray(list) ? list : []).filter(Boolean)));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function isTwentyPercentBoard(stock) {
  const code = clean(stock && (stock.code || stock.secCode));
  const board = clean(stock && stock.board);
  return /^(30|68)/.test(code) || /创业板|科创板/.test(board);
}

function isBeijingBoard(stock) {
  const code = clean(stock && (stock.code || stock.secCode));
  const board = clean(stock && stock.board);
  return /^(4|8|92)/.test(code) || /北交/.test(board);
}

function parseBoardHeight(stock) {
  const direct = finite(stock && (stock.boardHeight || stock.limitHeight || stock.continuousBoard));
  if (direct !== null && direct >= 0) return Math.round(direct);
  const text = [stock && stock.popularity, stock && stock.setup, stock && stock.limitStyle]
    .map(clean)
    .filter(Boolean)
    .join("·");
  if (/首板/.test(text)) return 1;
  const arabic = text.match(/(\d+)\s*板/);
  if (arabic) return Number(arabic[1]) || 0;
  const chinese = text.match(/([二三四五六七八九十])板/);
  if (chinese) {
    const map = { 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    return map[chinese[1]] || 0;
  }
  return /连板/.test(text) ? 2 : 0;
}

function removeTodayFromCumulative(cumulativePct, todayPct) {
  const cumulative = finite(cumulativePct);
  const today = finite(todayPct);
  if (cumulative === null || today === null || today <= -99) return null;
  const prior = ((1 + cumulative / 100) / (1 + today / 100) - 1) * 100;
  return Number.isFinite(prior) ? Math.round(prior * 10) / 10 : null;
}

function previousPhaseFor(context, code) {
  const source = context && context.previousPhaseByCode;
  let value = null;
  if (source instanceof Map) value = source.get(code);
  else if (source && typeof source === "object") value = source[code];
  const key = clean(typeof value === "string" ? value : value && (value.pricePhaseKey || value.phaseKey));
  return Object.prototype.hasOwnProperty.call(PHASE_LABELS, key) ? key : null;
}

function isKlineFresh(stock, kline, context) {
  const profileDate = clean(kline && (kline.lastTradingDate || kline.tradingDate));
  const marketDate = clean(context && context.tradingDate);
  if (profileDate && marketDate) return profileDate === marketDate;
  const profileClose = finite(kline && kline.lastClose);
  const liveClose = finite(stock && (stock.price || stock.close));
  if (profileClose !== null && liveClose !== null && liveClose > 0) {
    return Math.abs(profileClose - liveClose) <= Math.max(0.03, liveClose * 0.003);
  }
  return false;
}

function classifyMomentumStage(stock, context = {}) {
  const source = stock || {};
  const leadership = source.leadership && typeof source.leadership === "object" ? source.leadership : {};
  const initiative = leadership.initiative && typeof leadership.initiative === "object" ? leadership.initiative : {};
  const structure = leadership.structure && typeof leadership.structure === "object" ? leadership.structure : {};
  const directionState = leadership.directionState && typeof leadership.directionState === "object" ? leadership.directionState : {};
  const flow = source.flowNature && typeof source.flowNature === "object" ? source.flowNature : {};
  const kline = source.klineProfile && typeof source.klineProfile === "object" ? source.klineProfile : {};
  const code = clean(source.code || source.secCode);
  const changePct = finite(source.changePct);
  const amountYi = finite(source.amountYi) || 0;
  const level = clean(leadership.level);
  const identityText = clean(leadership.identity || leadership.levelLabel || source.role || source.ticketType);
  const initiativeScore = finite(initiative.score) || 0;
  const followers = finite(initiative.followerCount) || 0;
  const breadthLift = finite(initiative.breadthLift) || 0;
  const retention = finite(initiative.retentionPct);
  const relativeStrength = finite(initiative.relativeStrength);
  const initiativeProactive = initiative.proactive === true;
  const initiativeCapacity = initiative.capacity === true;
  const session = initiative.session && typeof initiative.session === "object" ? initiative.session : {};
  const sessionMaxChange = finite(session.maxChangePct);
  const sessionCurrentChange = finite(session.currentChangePct);
  const closeChangeForSession = sessionCurrentChange !== null ? sessionCurrentChange : changePct;
  const intradayGiveback = sessionMaxChange !== null && closeChangeForSession !== null
    ? Math.max(0, Math.round((sessionMaxChange - closeChangeForSession) * 10) / 10)
    : null;
  const boardHeight = parseBoardHeight(source);
  const firstBoard = boardHeight === 1 || /首板/.test(clean(source.popularity));
  const multiBoard = boardHeight >= 2;
  const previousPhase = previousPhaseFor(context, code);
  const shortTermCarrier = evaluateShortTermActiveCarrier(source, context);

  const directionAlive = Boolean(
    leadership.coreDirectionMatch === true
    || leadership.focusMatch === true
    || directionState.isCoreDirection === true
    || directionState.resonance === true
  );
  const historicalStructureRisk = Boolean(
    structure.frameworkIntact === false
    || structure.breakdown === true
    || kline.structureBreak === true
  );
  const immediateBreakdown = Boolean(
    kline.longBearBreak3d === true
    || /当日破位|放量跌破|崩坏|失守/.test(clean(source.structureState))
  );
  const explicitBreakdown = immediateBreakdown
    || (historicalStructureRisk && shortTermCarrier.qualified !== true);
  const structureIntact = !explicitBreakdown && (
    shortTermCarrier.qualified === true
    || structure.frameworkIntact === true
    || /^(A|B)[+\-]?$/.test(clean(structure.grade))
    || (!structure.grade && kline.structureBreak !== true)
  );
  const flowEscape = flow.key === "escape";
  const flowRealization = flow.key === "realization";
  const flowLaggingRealization = flow.key === "lagging_realization";
  const strictCore = Boolean(
    leadership.coreIdentityQualified === true
    || leadership.coreQualified === true
    || (
      leadership.repairCoreQualified === true
      && (leadership.recognized === true || leadership.persistentRecognition === true)
    )
    || (/L3|L4/.test(level) && leadership.recognized === true && initiativeScore >= 55)
  );
  const activeCore = Boolean(
    leadership.recognized === true
    && directionAlive
    && structureIntact
    && (/L2|L3|L4/.test(level) || initiativeScore >= 65)
    && (initiative.proactive === true || followers >= 1 || breadthLift >= 1)
    && amountYi >= 8
  );
  const historicalCore = Boolean(
    leadership.recognized === true
    && leadership.persistentRecognition === true
    && directionAlive
    && structureIntact
    && /核心|龙头|中军/.test(identityText)
    && amountYi >= 10
  );
  const coreTier = strictCore ? "verified" : activeCore ? "active" : historicalCore ? "historical" : "none";
  const coreTierLabel = strictCore ? "核心身份已验证" : activeCore ? "主动核心候选" : historicalCore ? "历史核心候选" : "非核心";
  const hasScenarioCore = coreTier !== "none";

  const klineFresh = isKlineFresh(source, kline, context);
  const priorRise2 = klineFresh ? removeTodayFromCumulative(kline.rise2, changePct) : null;
  const priorRise10 = klineFresh ? removeTodayFromCumulative(kline.rise10, changePct) : null;
  const priorRise20 = klineFresh ? removeTodayFromCumulative(kline.rise20, changePct) : null;
  const position120Pct = finite(kline.position120Pct);
  const pctFromHigh = finite(kline.pctFromHigh);
  const closeToCostPct = finite(structure.closeToCostPct !== undefined ? structure.closeToCostPct : kline.closeToCostPct);
  const nearHigh = Boolean(kline.nearHigh20 || kline.newHigh || (pctFromHigh !== null && pctFromHigh <= 7));
  const highPosition = position120Pct !== null && position120Pct >= 60;
  const lowOrRepairBase = Boolean(
    (priorRise10 === null || priorRise10 <= 10)
    && (priorRise20 === null || priorRise20 <= 18)
    && (
      (position120Pct !== null && position120Pct <= 60)
      || (pctFromHigh !== null && pctFromHigh >= 10)
      || !nearHigh
    )
  );
  const priorMomentum = Boolean(
    (priorRise2 !== null && priorRise2 >= 4)
    || (priorRise10 !== null && priorRise10 >= 10)
  );
  const priorTrendEstablished = Boolean(
    priorMomentum
    && (nearHigh || highPosition)
    && (priorRise10 === null || priorRise10 >= 8)
  );
  const strongLine = isBeijingBoard(source) ? 18 : isTwentyPercentBoard(source) ? 12 : 7;
  const isLimitStrong = Boolean(source.isLimitUp || /涨停/.test(clean(source.popularity)));
  const todayStrong = isLimitStrong || (changePct !== null && changePct >= strongLine);
  const priceDiscovery = !Boolean(
    initiative.priceDiscovery
    && (
      initiative.priceDiscovery.noPriceDiscovery === true
      || initiative.priceDiscovery.limitUpDiscoveryUnverified === true
      || initiative.priceDiscovery.suspectedOneWord === true
    )
  );
  const initiativeVerified = Boolean(
    initiative.proactive === true
    && initiativeScore >= 60
    && (followers >= 1 || breadthLift >= 1 || finite(leadership.impactScore) >= 30)
  );
  const volumeOrCapacity = Boolean(kline.volumeBreakout || initiative.capacity === true || amountYi >= 20);
  const priorActive = ["startup", "confirmation", "acceleration"].includes(previousPhase);
  const controlledDivergence = Boolean(
    flowRealization
    || (
      changePct !== null
      && changePct >= -5
      && changePct <= 3
      && structureIntact
      && !flowEscape
    )
  );

  let key = "unstarted";
  let confidence = "中";
  const reasons = [];

  if (flowEscape || explicitBreakdown) {
    key = "failure";
    confidence = "高";
    reasons.push(flowEscape ? "资金性质已转为出逃" : "关键结构已经破坏");
  } else if (!hasScenarioCore) {
    key = "unstarted";
    reasons.push("没有通过核心身份门槛");
  } else if (!klineFresh) {
    key = "unknown";
    confidence = "低";
    reasons.push("K线画像与当前收盘无法确认同一交易日，阶段不猜测");
  } else if (
    todayStrong
    && directionAlive
    && structureIntact
    && priceDiscovery
    && retention !== null
    && retention >= 65
    && (
      (["confirmation", "acceleration"].includes(previousPhase) && priorMomentum)
      || (multiBoard && priorMomentum)
      || (!previousPhase && priorTrendEstablished && priorRise2 !== null && priorRise2 >= 4)
    )
  ) {
    key = "acceleration";
    confidence = previousPhase || multiBoard ? "高" : "中";
    reasons.push(previousPhase ? `上一交易日已处于${PHASE_LABELS[previousPhase]}` : `此前已有趋势，当前为${boardHeight || 2}板强化`);
    reasons.push("在既有趋势上再次放量强化，才定义为加速");
  } else if (
    previousPhase === "startup"
    && directionAlive
    && structureIntact
    && !flowEscape
    && (retention === null || retention >= 55)
    && (changePct === null || changePct >= -3)
  ) {
    key = "confirmation";
    confidence = "高";
    reasons.push("上一交易日已经启动，今天方向、结构与承接继续有效");
  } else if (
    todayStrong
    && !multiBoard
    && directionAlive
    && structureIntact
    && priceDiscovery
    && initiativeVerified
    && volumeOrCapacity
    && (firstBoard || lowOrRepairBase)
    && !priorTrendEstablished
  ) {
    key = "startup";
    confidence = "高";
    reasons.push(firstBoard ? "首板/首个强势日，不是连续加速" : "此前涨幅有限，今天首次主动转强");
    reasons.push(`主动性${Math.round(initiativeScore)}分，带动${followers}只、扩散${breadthLift}只`);
  } else if (controlledDivergence && directionAlive && structureIntact && (priorActive || historicalCore || strictCore)) {
    key = "divergence";
    confidence = flowRealization || previousPhase ? "高" : "中";
    reasons.push(flowRealization ? "资金流出属于正常兑现，不等于出逃" : "核心温和回落，结构仍完整");
  } else if (
    directionAlive
    && structureIntact
    && (historicalCore || strictCore)
    && lowOrRepairBase
    && changePct !== null
    && changePct >= -3
    && changePct <= 8
  ) {
    key = "repair";
    reasons.push("核心仍在低位/成本附近，保留修复预案资格");
  } else {
    key = "unknown";
    confidence = "低";
    reasons.push("现有证据不足以确认启动、加速或正常分歧");
  }

  return {
    key,
    label: PHASE_LABELS[key],
    confidence,
    reasons: unique(reasons),
    previousPhase,
    boardHeight,
    firstBoard,
    multiBoard,
    klineFresh,
    todayStrong,
    priorRise2,
    priorRise10,
    priorRise20,
    priorTrendEstablished,
    lowOrRepairBase,
    directionAlive,
    structureIntact,
    explicitBreakdown,
    historicalStructureRisk,
    shortTermActiveCarrier: shortTermCarrier.qualified === true,
    shortTermCarrier,
    flowEscape,
    flowRealization,
    flowLaggingRealization,
    controlledDivergence,
    strictCore,
    activeCore,
    historicalCore,
    coreTier,
    coreTierLabel,
    initiativeScore,
    initiativeProactive,
    initiativeCapacity,
    followers,
    breadthLift,
    retention,
    relativeStrength,
    intradayGiveback,
    position120Pct,
    pctFromHigh,
    closeToCostPct,
  };
}

function classifyTomorrowExecution(stock, context = {}) {
  const source = stock || {};
  const leadership = source.leadership && typeof source.leadership === "object" ? source.leadership : {};
  const structure = leadership.structure && typeof leadership.structure === "object" ? leadership.structure : {};
  const flow = source.flowNature && typeof source.flowNature === "object" ? source.flowNature : {};
  const phase = classifyMomentumStage(source, context);
  const code = clean(source.code || source.secCode);
  const name = clean(source.name || code || "--");
  const changePct = finite(source.changePct);
  const amountYi = finite(source.amountYi) || 0;
  const role = clean(source.role || source.ticketType);
  const identity = clean(leadership.identity || leadership.levelLabel || role || "核心验证");
  const directionName = clean(source.mainConcept || source.mainFamily || source.concept || context.focusDirection || "所属方向");
  const evidence = [];
  if (phase.coreTier !== "none") evidence.push(`${phase.coreTierLabel}：${identity}`);
  phase.reasons.forEach((line) => evidence.push(line));
  if (phase.structureIntact) evidence.push(`结构${clean(structure.grade || "未破")}`);
  if (phase.shortTermActiveCarrier && phase.historicalStructureRisk) {
    evidence.push("中长期高位/回撤风险只限制追高，不改写当日主动载体的短线结构");
  }
  if (phase.closeToCostPct !== null) evidence.push(`距近期成本${phase.closeToCostPct >= 0 ? "+" : ""}${phase.closeToCostPct.toFixed(1)}%`);
  if (structure.overextended === true) evidence.push("短线偏离成本，只限制追价，不作为加速证据");

  const tradeState = clean(leadership.tradeState);
  const leadershipTradeQualified = leadership.tradeQualified === true || leadership.coreQualified === true;
  const coreIdentityQualified = leadership.coreIdentityQualified === true;
  const historicalAnchorOnly = Boolean(
    tradeState === "仅观察"
    && !leadershipTradeQualified
    && phase.shortTermActiveCarrier !== true
    && (
      phase.initiativeProactive !== true
      || phase.initiativeScore < 58
      || finite(source.amountYi) === null
    )
  );
  const passiveObservation = historicalAnchorOnly || Boolean(
    tradeState === "仅观察"
    && !leadershipTradeQualified
    && !coreIdentityQualified
    && phase.initiativeProactive !== true
    && phase.initiativeScore < 58
  );
  const laggingObservation = phase.flowLaggingRealization === true;

  let bucket = "ignore";
  let actionLabel = "不进入明日执行层";
  if (phase.key === "failure") {
    bucket = "risk";
    actionLabel = "取消新开仓资格，只保留风险观察";
  } else if (phase.shortTermActiveCarrier && phase.shortTermCarrier.riskOnly) {
    bucket = "premium";
    actionLabel = "当日主动高度载体只验证次日溢价与承接，不作为开盘追涨答案";
  } else if (phase.key === "acceleration") {
    bucket = "premium";
    actionLabel = "只验证溢价与持续性，不作为开盘直接追涨答案";
  } else if (["startup", "confirmation", "divergence", "repair"].includes(phase.key) && !passiveObservation && !laggingObservation) {
    bucket = "entry";
    actionLabel = "只在对应市场路径命中后取得条件博弈资格";
  } else if (laggingObservation) {
    bucket = "ignore";
    actionLabel = "板块强而个股掉队兑现，只保留观察，不得进入明日最优解";
    evidence.push("相对板块明显掉队且冲高承接失败，不把‘非出逃’误写成回流买点");
  } else if (passiveObservation) {
    bucket = "ignore";
    actionLabel = "仅观察且主动性未通过，不得进入明日最优解";
    evidence.push("交易资格、核心身份与当前主动性均未通过，只保留观察，不用历史身份补位");
  } else if (phase.coreTier !== "none") {
    bucket = "ignore";
    actionLabel = "核心身份保留在观察池，但阶段证据不足，不进入三路径或溢价栏";
  }

  let rank = phase.coreTier === "verified" ? 34 : phase.coreTier === "active" ? 25 : phase.coreTier === "historical" ? 18 : 0;
  rank += /L4/.test(clean(leadership.level)) ? 18 : /L3/.test(clean(leadership.level)) ? 12 : /L2/.test(clean(leadership.level)) ? 7 : 0;
  rank += phase.directionAlive ? 14 : 0;
  rank += structure.grade === "A" ? 14 : structure.grade === "B" ? 9 : 0;
  rank += Math.min(15, phase.initiativeScore / 7);
  rank += Math.min(10, amountYi / 15);
  rank += phase.key === "startup" ? 18 : phase.key === "confirmation" ? 16 : phase.key === "divergence" ? 13 : phase.key === "repair" ? 9 : 0;
  if (phase.flowRealization) rank += 8;
  if (phase.key === "acceleration") rank -= 25;
  if (phase.key === "failure") rank -= 70;

  let triggers = [];
  if (phase.key === "startup" || phase.key === "confirmation") {
    triggers = [
      `${directionName}至少再有两只核心/容量票同步走强，证明不是单票孤立上涨`,
      `${name}不以高开幅度作为买点；第一次回踩承接有效，或整理后主动放量突破`,
      "回踩缩量、上攻放量，且仍由本票主动带动而不是被动跟随",
    ];
  } else if (phase.key === "divergence") {
    triggers = [
      `${directionName}分化不扩散成负反馈，兑现盘释放后出现回流`,
      `${name}回踩不破关键承接，随后重新站回分时均价或突破早盘承接高点`,
      "同方向核心先企稳，本票再由被动转主动",
    ];
  } else if (phase.key === "repair") {
    triggers = [
      "市场负反馈先收缩，跌停、炸板和高位核按钮不再增加",
      `${directionName}出现明确回流，${name}率先翻红或放量越过修复高点`,
      "只做弱转强确认，不在市场继续下杀时提前抄底",
    ];
  }
  const cancelConditions = bucket === "entry" ? [
    `${directionName}继续扩散负反馈，或只有${name}单点上涨`,
    `${name}放量跌破首次承接低点且不能快速收回`,
    "竞价直接透支预期、开盘快速补跌，或由主动转为明显被动",
  ] : [];

  return {
    code,
    name,
    bucket,
    stateLabel: phase.label,
    pricePhaseKey: phase.key,
    pricePhaseLabel: phase.label,
    pricePhaseConfidence: phase.confidence,
    actionLabel,
    tomorrowEntryQualified: bucket === "entry",
    leadershipTradeState: tradeState || null,
    leadershipTradeQualified,
    coreIdentityQualified,
    passiveObservation,
    historicalAnchorOnly,
    shortTermActiveCarrier: phase.shortTermActiveCarrier,
    shortTermCarrier: phase.shortTermCarrier,
    laggingObservation,
    rank: Math.round(rank * 10) / 10,
    changePct,
    price: finite(source.price || source.close),
    amountYi,
    mainConcept: directionName,
    role,
    identity,
    coreTier: phase.coreTier,
    coreTierLabel: phase.coreTierLabel,
    flowKey: clean(flow.key || "uncertain"),
    flowLabel: clean(flow.label || "资金性质待确认"),
    evidence: unique(evidence),
    triggers,
    cancelConditions,
    phaseEvidence: phase,
  };
}

function compactDecision(row) {
  const decision = row && row.decision ? row.decision : row || {};
  const { phaseEvidence, ...compact } = decision;
  return compact;
}

function scenarioCandidate(row) {
  if (!row) return null;
  const decision = compactDecision(row);
  return {
    ...decision,
    oneLineReason: decision.evidence.slice(0, 3).join("；"),
    stockTriggers: decision.triggers.slice(0, 3),
    cancelConditions: decision.cancelConditions.slice(0, 3),
  };
}

/**
 * 震荡/轮动不是“捡跌得多的老核心”。候选必须同时证明：
 * 1. 当前仍有核心交易身份；2. 个股主动；3. 有承接；
 * 4. 能带动同方向；5. 相对板块不掉队。任一项缺失都只观察。
 */
function passesStrictRotationGate(row) {
  if (!row || !row.stock || !row.decision) return false;
  const source = row.stock;
  const decision = row.decision;
  const phase = decision.phaseEvidence || {};
  const leadership = source.leadership && typeof source.leadership === "object" ? source.leadership : {};
  const initiative = leadership.initiative && typeof leadership.initiative === "object" ? leadership.initiative : {};
  const tradeState = clean(leadership.tradeState);
  const tradeQualified = leadership.tradeQualified === true || leadership.coreQualified === true;
  const identityQualified = leadership.coreIdentityQualified === true
    || leadership.repairCoreQualified === true
    || phase.activeCore === true;
  const onlyObserve = tradeState === "仅观察" && !tradeQualified && leadership.coreIdentityQualified !== true;
  const hasRealFollowing = Number(phase.followers || 0) >= 1 || Number(phase.breadthLift || 0) >= 1;
  const hasSupport = phase.retention !== null
    && Number(phase.retention) >= 55
    && (phase.initiativeCapacity === true || Number(decision.amountYi || 0) >= 8);
  const relativeLeader = phase.relativeStrength !== null && Number(phase.relativeStrength) >= 0.5;
  const givebackControlled = phase.intradayGiveback === null || Number(phase.intradayGiveback) <= 3;

  return Boolean(
    decision.tomorrowEntryQualified === true
    && ["divergence", "repair"].includes(decision.pricePhaseKey)
    && phase.structureIntact === true
    && phase.directionAlive === true
    && !onlyObserve
    && identityQualified
    && phase.initiativeProactive === true
    && Number(phase.initiativeScore || 0) >= 60
    && hasRealFollowing
    && hasSupport
    && relativeLeader
    && givebackControlled
  );
}

function buildTomorrowExecutionBoard(candidates, context = {}) {
  const rows = (Array.isArray(candidates) ? candidates : [])
    .filter(Boolean)
    .map((stock) => ({ stock, decision: classifyTomorrowExecution(stock, context) }));
  const byRank = (a, b) => Number(b.decision.rank || 0) - Number(a.decision.rank || 0);
  const entryRows = rows.filter((row) => row.decision.bucket === "entry").sort(byRank);
  const premiumRows = rows.filter((row) => row.decision.bucket === "premium").sort(byRank);
  const riskRows = rows.filter((row) => row.decision.bucket === "risk").sort(byRank);
  const used = new Set();
  const choose = (pool, scoreFn) => {
    const ranked = pool
      .filter((row) => row && row.decision && !used.has(row.decision.code))
      .map((row) => ({ row, score: Number(scoreFn(row) || 0) }))
      .sort((a, b) => b.score - a.score || byRank(a.row, b.row));
    const hit = ranked[0] && ranked[0].row;
    if (hit) used.add(hit.decision.code);
    return hit || null;
  };

  const strengthRow = choose(
    entryRows.filter((row) => ["startup", "confirmation"].includes(row.decision.pricePhaseKey)),
    (row) => {
      const phase = row.decision.phaseEvidence || {};
      return row.decision.rank
        + (row.decision.pricePhaseKey === "startup" ? 35 : 26)
        + phase.followers * 5
        + phase.breadthLift * 4
        + clamp(phase.retention, 0, 100) / 8;
    },
  );

  const rotationRow = choose(
    entryRows.filter((row) => {
      const phase = row.decision.phaseEvidence || {};
      return passesStrictRotationGate(row)
        && row.decision.changePct !== null
        && row.decision.changePct >= -3
        && row.decision.changePct <= 3;
    }),
    (row) => {
      const phase = row.decision.phaseEvidence || {};
      return row.decision.rank
        + (row.decision.pricePhaseKey === "divergence" ? 20 : 10)
        + Number(phase.initiativeScore || 0) * 0.45
        + Number(phase.followers || 0) * 8
        + Number(phase.breadthLift || 0) * 7
        + Number(phase.retention || 0) / 3
        + Math.max(0, Number(phase.relativeStrength || 0)) * 5
        - Number(phase.intradayGiveback || 0) * 4;
    },
  );

  const weakRepairRow = choose(
    entryRows.filter((row) => {
      const phase = row.decision.phaseEvidence || {};
      const change = row.decision.changePct;
      const closeToCost = phase.closeToCostPct;
      const lowEnough = (phase.position120Pct !== null && phase.position120Pct <= 45)
        || (closeToCost !== null && Math.abs(closeToCost) <= 5);
      return ["repair", "divergence", "confirmation"].includes(row.decision.pricePhaseKey)
        && phase.structureIntact
        && phase.directionAlive
        && (phase.historicalCore || phase.strictCore)
        && change !== null
        && change >= -3
        && change <= 8
        && lowEnough;
    }),
    (row) => {
      const phase = row.decision.phaseEvidence || {};
      const change = Number(row.decision.changePct || 0);
      return row.decision.rank
        + (clean(row.stock && row.stock.leadership && row.stock.leadership.structure && row.stock.leadership.structure.grade) === "A" ? 28 : 12)
        + (change >= 0 && change <= 7 ? 18 : 0)
        + (phase.closeToCostPct !== null && Math.abs(phase.closeToCostPct) <= 5 ? 18 : 0)
        + (phase.position120Pct !== null && phase.position120Pct <= 35 ? 14 : 0);
    },
  );

  const plans = [
    {
      key: "strengthen",
      order: 1,
      label: "市场加强",
      title: "启动/确认核心",
      marketCondition: "赚钱效应继续扩散，昨日启动方向得到容量与板块共同确认。",
      marketSignals: ["昨日启动方向至少两只核心/容量票同步走强", "涨停与红盘扩散，核心不是孤立高开", "指数、情绪和核心容量不出现同步高开低走"],
      candidate: scenarioCandidate(strengthRow),
      action: strengthRow ? "路径命中后先等个股承接，不用竞价涨幅代替买点。" : "本路径暂无合格启动/确认核心，市场即使加强也不拿后排补位。",
    },
    {
      key: "rotation",
      order: 2,
      label: "市场分化/轮动",
      title: "正常兑现后的回流核心",
      marketCondition: "昨日强势方向分化但未扩散成退潮，资金回到完成兑现、结构未破的核心。",
      marketSignals: ["高位兑现但跌停、炸板没有继续扩散", "旧核心/容量核心先止跌，回流不是后排脉冲", "轮动方向有持续成交承接，而非一分钟拉高"],
      candidate: scenarioCandidate(rotationRow),
      action: rotationRow ? "只做兑现后的弱转强，先看方向回流，再看个股重新主动。" : "本路径暂无合格回流核心，分化时保持等待。",
    },
    {
      key: "weakRepair",
      order: 3,
      label: "市场偏弱后修复",
      title: "抗跌/负反馈拐点核心",
      marketCondition: "市场先弱后止跌，负反馈明确收缩，资金选择结构完整且处于低位/成本附近的核心。",
      marketSignals: ["跌停、核按钮和炸板数量停止增加", "情绪锚点放人或翻红，亏钱效应出现拐点", "低位核心先于指数回升，并带动同方向跟随"],
      candidate: scenarioCandidate(weakRepairRow),
      action: weakRepairRow ? "只在负反馈拐点出现后执行，不在下跌途中提前抄底。" : "本路径暂无合格抗跌核心，弱市修复也不为了凑数交易。",
    },
  ].map((plan) => ({
    ...plan,
    status: plan.candidate ? "ready" : "empty",
    statusLabel: plan.candidate ? "候选已准备" : "暂无合格核心",
  }));

  const selectedRows = [strengthRow, rotationRow, weakRepairRow].filter(Boolean);
  return {
    version: 3,
    principle: "先判断市场实际走哪条路径，只执行命中的一张；三只候选不是同时买。启动、确认与加速按前后阶段识别，单日大涨不再直接等于加速。",
    scenarioPlans: plans,
    entryStocks: selectedRows.map((row) => row.stock),
    entryPicks: selectedRows.map(compactDecision),
    premiumWatch: premiumRows.map(compactDecision),
    riskWatch: riskRows.map(compactDecision),
    counts: {
      checked: rows.length,
      eligible: entryRows.length,
      entry: selectedRows.length,
      premium: premiumRows.length,
      risk: riskRows.length,
      readyPaths: plans.filter((plan) => plan.candidate).length,
    },
  };
}

module.exports = {
  classifyMomentumStage,
  classifyTomorrowExecution,
  buildTomorrowExecutionBoard,
};
