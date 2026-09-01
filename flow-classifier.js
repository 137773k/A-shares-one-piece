"use strict";

/**
 * 资金流出性质分类器。
 *
 * 重要约束：mainInflowYi 只用于确认“正在分析净流出”，绝不会单独决定
 * 兑现或出逃。结论必须由个股、方向和市场三个维度交叉验证。
 *
 * @param {object} stock 个股快照
 * @param {object} context
 * @param {object} context.marketState 市场状态/赚钱亏钱效应
 * @param {object} context.limitStats 涨跌停统计
 * @param {object} context.directionStats 所属方向的承接与扩散统计
 * @returns {{key:"realization"|"lagging_realization"|"escape"|"uncertain",label:string,confidence:number,evidence:string[],tradeBias:string}}
 */

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFinite(...values) {
  for (const value of values) {
    const number = finite(value);
    if (number !== null) return number;
  }
  return null;
}

function firstOptionalFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = finite(value);
    if (number !== null) return number;
  }
  return null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeRatio(value) {
  const number = finite(value);
  if (number === null) return null;
  return number > 1 ? number / 100 : number;
}

function textContains(value, pattern) {
  return typeof value === "string" && pattern.test(value);
}

function inferClosePosition(stock) {
  const explicit = firstFinite(
    stock && stock.closePosition,
    stock && stock.closeLocation,
    stock && stock.closePositionPct,
    stock && stock.closeLocationPct,
  );
  if (explicit !== null) return clamp(explicit > 1 ? explicit / 100 : explicit, 0, 1);

  const close = firstFinite(stock && stock.close, stock && stock.price, stock && stock.klineProfile && stock.klineProfile.lastClose);
  const high = finite(stock && stock.high);
  const low = finite(stock && stock.low);
  if (close !== null && high !== null && low !== null && high > low) {
    return clamp((close - low) / (high - low), 0, 1);
  }
  return null;
}

function addDimension(name, positive, negative, positiveText, negativeText, dimensions, evidence) {
  let vote = 0;
  let conflicted = false;
  if (positive && !negative) {
    vote = 1;
    evidence.push(`${name}：${positiveText}`);
  } else if (negative && !positive) {
    vote = -1;
    evidence.push(`${name}：${negativeText}`);
  } else if (positive && negative) {
    conflicted = true;
    evidence.push(`${name}：强弱信号冲突，暂不能定性`);
  } else {
    evidence.push(`${name}：有效数据不足`);
  }
  dimensions[name] = vote;
  return conflicted;
}

function classifyFundFlow(stock, context = {}) {
  const source = stock || {};
  const marketState = context.marketState || {};
  const limitStats = context.limitStats || {};
  const directionStats = context.directionStats || {};
  const evidence = [];
  const dimensions = {};
  const conflictedDimensions = [];
  const inflow = finite(source.mainInflowYi);

  if (inflow === null || inflow === 0) {
    return {
      key: "uncertain",
      label: "资金性质待确认",
      confidence: 0.25,
      evidence: [inflow === null ? "主力净流数据缺失，不能判断兑现或出逃" : "主力净流为零，不能按净流出场景定性"],
      tradeBias: "等待确认",
      dimensions,
      conflict: false,
    };
  }
  if (inflow > 0) {
    return {
      key: "uncertain",
      label: "资金性质待确认",
      confidence: 0.3,
      evidence: [`主力净流入${inflow}亿，不属于净流出定性场景`],
      tradeBias: "无需按流出淘汰",
      dimensions,
      conflict: false,
    };
  }

  evidence.push(`主力净流出${inflow}亿，仅作为待解释现象，不单项定性`);

  // 个股：结构和收盘承接决定“卖出后是否有人接”。
  const kp = source.klineProfile || {};
  const changePct = finite(source.changePct);
  const closePosition = inferClosePosition(source);
  const close = firstFinite(source.close, source.price, kp.lastClose);
  const ma5 = finite(kp.ma5);
  const ma10 = finite(kp.ma10);
  const explicitBroken = source.structureBroken === true || kp.longBearBreak3d === true
    || textContains(source.structureState, /破位|崩坏|失守/)
    || textContains(source.structureGrade, /D|破位/);
  const explicitIntact = source.structureIntact === true
    || textContains(source.structureState, /完整|未破|承接/)
    || textContains(source.structureGrade, /^(A|B)[+\-]?$/);
  const priceHeld = (close !== null && ma5 !== null && close >= ma5)
    || (changePct !== null && changePct >= -1)
    || (closePosition !== null && closePosition >= 0.62);
  const priceBroke = explicitBroken
    || (close !== null && ma10 !== null && close < ma10 && changePct !== null && changePct <= -3)
    || (changePct !== null && changePct <= -5)
    || (closePosition !== null && closePosition <= 0.25 && changePct !== null && changePct <= -2);
  // 不在这里用“破位”提前抹掉承接信号；若破位与强收盘并存，应当显式冲突并降为待确认。
  const individualPositive = explicitIntact || priceHeld;
  const individualNegative = priceBroke;
  if (addDimension(
    "个股",
    individualPositive,
    individualNegative,
    `结构未破且收盘有承接${changePct !== null ? `（涨跌幅${changePct}%）` : ""}`,
    `关键结构破坏或弱势收盘${changePct !== null ? `（涨跌幅${changePct}%）` : ""}`,
    dimensions,
    evidence,
  )) conflictedDimensions.push("个股");

  // 方向：同方向是否仍有接力与扩散，不能用个股一只票代替板块判断。
  const directionPositiveRate = normalizeRatio(firstFinite(directionStats.positiveRate, directionStats.upRatio, directionStats.advanceRatio));
  const directionAvgChange = firstFinite(directionStats.avgChangePct, directionStats.averageChangePct);
  const activeCount = firstFinite(directionStats.activeCount, directionStats.strongCount, directionStats.risingCoreCount);
  const breakdownCount = firstFinite(directionStats.breakdownCount, directionStats.weakCount, directionStats.fallingCoreCount);
  const acceptanceScore = firstFinite(directionStats.acceptanceScore, directionStats.supportScore, directionStats.moneyEffectScore);
  const directionExplicitPositive = directionStats.accepting === true || directionStats.spreading === true
    || textContains(directionStats.state, /承接|扩散|轮动|修复|活跃/);
  const directionExplicitNegative = directionStats.weakening === true || directionStats.negativeSpread === true
    || textContains(directionStats.state, /退潮|瓦解|扩散.*负|批量.*弱|无承接/);
  const directionPositive = directionExplicitPositive
    || (directionPositiveRate !== null && directionPositiveRate >= 0.55)
    || (directionAvgChange !== null && directionAvgChange >= 0.3)
    || (acceptanceScore !== null && acceptanceScore >= 60)
    || (activeCount !== null && breakdownCount !== null && activeCount >= Math.max(2, breakdownCount * 1.5));
  const directionNegative = directionExplicitNegative
    || (directionPositiveRate !== null && directionPositiveRate < 0.35)
    || (directionAvgChange !== null && directionAvgChange <= -2)
    || (acceptanceScore !== null && acceptanceScore <= 35)
    || (activeCount !== null && breakdownCount !== null && breakdownCount >= Math.max(3, activeCount * 2));
  if (addDimension(
    "方向",
    directionPositive,
    directionNegative,
    "同方向仍有承接或赚钱效应扩散",
    "同方向核心批量转弱、承接不足",
    dimensions,
    evidence,
  )) conflictedDimensions.push("方向");

  // 市场：负反馈是否形成恐慌扩散。
  const profitEffect = firstFinite(marketState.profitEffect, marketState.profitEffectScore, marketState.profitScore);
  const lossEffect = firstFinite(marketState.lossEffect, marketState.lossEffectScore, marketState.lossScore);
  const dtToday = firstFinite(limitStats.dtToday, limitStats.limitDownToday, marketState.limitDownCount);
  const dtPrev = firstFinite(limitStats.dtPrev, limitStats.limitDownPrev, marketState.prevLimitDownCount);
  const marketExplicitPositive = marketState.negativeFeedbackSpread === false || marketState.panic === false
    || textContains(marketState.dayState, /健康分化|修复|回暖/)
    || textContains(marketState.state, /健康分化|修复|回暖/);
  const marketExplicitNegative = marketState.negativeFeedbackSpread === true || marketState.panic === true
    || textContains(marketState.dayState, /恐慌|退潮|负反馈扩散/)
    || textContains(marketState.state, /恐慌|退潮|负反馈扩散/);
  const marketPositive = marketExplicitPositive
    || (profitEffect !== null && lossEffect !== null && profitEffect >= lossEffect + 8)
    || (lossEffect !== null && lossEffect <= 40)
    || (dtToday !== null && dtToday <= 8 && (dtPrev === null || dtToday <= dtPrev));
  const marketNegative = marketExplicitNegative
    || (lossEffect !== null && lossEffect >= 65)
    || (profitEffect !== null && lossEffect !== null && lossEffect >= profitEffect + 20)
    || (dtToday !== null && dtToday >= 15 && (dtPrev === null || dtToday > dtPrev));
  if (addDimension(
    "市场",
    marketPositive,
    marketNegative,
    "负反馈未扩散，市场仍保留承接和赚钱窗口",
    "跌停或亏钱效应扩散，出现恐慌离场特征",
    dimensions,
    evidence,
  )) conflictedDimensions.push("市场");

  // “板块强、个股弱”不是健康兑现。方向上涨时，个股若明显跑输、冲高
  // 大幅回落且没有主动带动性，只能列为掉队观察，不能因为结构尚未破坏
  // 就进入次日回流候选。相关数据缺失时不触发，保持旧数据兼容。
  const leadership = source.leadership || {};
  const initiative = leadership.initiative || {};
  const initiativeSession = initiative.session || source.session || {};
  const relativeStrength = firstOptionalFinite(
    initiative.relativeStrength,
    directionStats.relativeStrength,
    source.relativeStrength,
  );
  const retentionPct = firstOptionalFinite(initiative.retentionPct, initiativeSession.retentionPct);
  const maxChangePct = firstOptionalFinite(initiativeSession.maxChangePct, initiative.maxChangePct);
  const currentChangePct = firstOptionalFinite(
    initiativeSession.currentChangePct,
    initiative.currentChangePct,
    source.currentChangePct,
    changePct,
  );
  const followerCount = Array.isArray(initiative.followers)
    ? initiative.followers.length
    : firstOptionalFinite(initiative.followerCount, initiative.followers, leadership.followerCount);
  const breadthLift = Array.isArray(initiative.breadth)
    ? initiative.breadth.length
    : firstOptionalFinite(initiative.breadthLift, initiative.breadth, leadership.breadthLift);
  const severeRelativeLag = relativeStrength !== null && relativeStrength <= -2.5;
  const retreatPct = maxChangePct !== null && currentChangePct !== null
    ? maxChangePct - currentChangePct
    : null;
  const retentionCollapsed = retentionPct !== null
    && retentionPct <= 35
    && (maxChangePct === null || maxChangePct >= 3);
  const intradayAttackFailed = retentionCollapsed
    || (maxChangePct !== null && maxChangePct >= 3 && retreatPct !== null && retreatPct >= 3);
  const initiativeBreadthKnown = followerCount !== null || breadthLift !== null;
  const lowInitiative = initiative.proactive === false
    && initiativeBreadthKnown
    && (followerCount === null || followerCount <= 0)
    && (breadthLift === null || breadthLift <= 0);
  const laggingRealization = directionPositive
    && !directionNegative
    && !marketNegative
    && severeRelativeLag
    && intradayAttackFailed
    && lowInitiative;

  if (laggingRealization) {
    evidence.push(
      `相对掉队：方向强势时个股仍落后${Math.abs(relativeStrength).toFixed(1)}个百分点，`
      + `${retentionPct !== null ? `冲高强度仅保留${retentionPct.toFixed(1)}%` : `盘中回落${retreatPct.toFixed(1)}个百分点`}，`
      + "且没有主动带动或扩散",
    );
  }

  const votes = Object.values(dimensions);
  const positiveVotes = votes.filter((vote) => vote > 0).length;
  const negativeVotes = votes.filter((vote) => vote < 0).length;
  const knownVotes = positiveVotes + negativeVotes;
  const conflict = (positiveVotes > 0 && negativeVotes > 0) || conflictedDimensions.length > 0;
  let key = "uncertain";
  let label = "资金性质待确认";
  let tradeBias = "等待确认";

  if (!conflict && laggingRealization && positiveVotes >= 2) {
    key = "lagging_realization";
    label = "掉队兑现";
    tradeBias = "仅保留观察，不进入次日回流候选";
  } else if (!conflict && positiveVotes >= 2) {
    key = "realization";
    label = "资金兑现";
    tradeBias = "保留核心，进入次日回流候选";
  } else if (!conflict && negativeVotes >= 2) {
    key = "escape";
    label = "资金出逃";
    tradeBias = "取消交易资格，保留风险观察";
  } else if (conflict) {
    const where = conflictedDimensions.length ? `（${conflictedDimensions.join("、")}内部信号冲突）` : "";
    evidence.push(`证据方向冲突${where}，按待确认处理，不强行归类`);
  } else {
    evidence.push("至少需要个股、方向、市场中的两个维度同向验证");
  }

  let confidence;
  if (key === "uncertain") {
    confidence = conflict ? 0.45 : (knownVotes <= 1 ? 0.35 : 0.5);
  } else {
    confidence = clamp(0.58 + knownVotes * 0.1, 0, 0.88);
  }

  return {
    key,
    label,
    confidence: Math.round(confidence * 100) / 100,
    evidence,
    tradeBias,
    dimensions,
    conflict,
  };
}

module.exports = { classifyFundFlow };
