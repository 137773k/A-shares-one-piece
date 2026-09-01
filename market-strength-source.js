"use strict";

const MARKET_STRENGTH_SOURCE_VERSION = 2;

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round1(value) {
  const number = finite(value);
  return number === null ? null : Math.round(number * 10) / 10;
}

function round2(value) {
  const number = finite(value);
  return number === null ? null : Number(number.toFixed(2));
}

function median(values) {
  const rows = (Array.isArray(values) ? values : [])
    .map(finite)
    .filter((value) => value !== null)
    .sort((a, b) => a - b);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
}

function average(values) {
  const rows = (Array.isArray(values) ? values : []).map(finite).filter((value) => value !== null);
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : null;
}

function sum(values) {
  return (Array.isArray(values) ? values : [])
    .map(finite)
    .filter((value) => value !== null)
    .reduce((total, value) => total + value, 0);
}

function weightedAverage(rows, valueOf, weightOf = (item) => item && item.amountYi) {
  let weightedTotal = 0;
  let weightTotal = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = finite(valueOf(row));
    const weight = finite(weightOf(row));
    if (value === null || weight === null || weight <= 0) continue;
    weightedTotal += value * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedTotal / weightTotal : null;
}

function weightedRate(rows, predicate, weightOf = (item) => item && item.amountYi) {
  let passedWeight = 0;
  let totalWeight = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const weight = finite(weightOf(row));
    if (weight === null || weight <= 0) continue;
    totalWeight += weight;
    if (predicate(row)) passedWeight += weight;
  }
  return totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : null;
}

function rate(rows, predicate) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  return Math.round((list.filter(predicate).length / list.length) * 100);
}

function signedPct(value, digits = 1) {
  const number = finite(value);
  if (number === null) return "—";
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function uniqueBy(rows, keyOf, limit = Infinity) {
  const result = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(keyOf(row) || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(row);
    if (result.length >= limit) break;
  }
  return result;
}

function candidateQuoteView(stock) {
  if (!stock || typeof stock !== "object") return null;
  const prevClose = finite(stock.prevClose || stock.preClose);
  const leadership = stock.leadership && typeof stock.leadership === "object" ? stock.leadership : {};
  const initiative = leadership.initiative && typeof leadership.initiative === "object" ? leadership.initiative : {};
  const session = initiative.session && typeof initiative.session === "object" ? initiative.session : {};
  const openFromSession = prevClose && finite(session.openChangePct) !== null
    ? prevClose * (1 + Number(session.openChangePct) / 100)
    : null;
  const open = finite(stock.open || stock.openPrice) || openFromSession;
  const closeFromPct = prevClose && finite(stock.changePct) !== null
    ? prevClose * (1 + Number(stock.changePct) / 100)
    : null;
  const close = finite(stock.price || stock.currentPrice) || closeFromPct;
  if (!prevClose || !open || !close) return null;

  const identity = String(leadership.identity || leadership.levelLabel || stock.role || "");
  const history = leadership.history && typeof leadership.history === "object" ? leadership.history : {};
  const currentCore = Boolean(
    leadership.coreQualified === true
    || leadership.coreIdentityQualified === true
    || leadership.repairCoreQualified === true
    || ["L3", "L4"].includes(String(leadership.level || ""))
  );
  const historicalCore = Boolean(
    finite(history.coreHits) !== null
    && Number(history.coreHits) > 0
    && leadership.persistentRecognition !== false
  );
  const core = currentCore || historicalCore;
  const capacity = initiative.capacity === true;
  const openGapPct = ((open - prevClose) / prevClose) * 100;
  const openToClosePct = ((close - open) / open) * 100;
  const closeChangePct = ((close - prevClose) / prevClose) * 100;
  const highFromSession = prevClose && finite(session.maxChangePct) !== null
    ? prevClose * (1 + Number(session.maxChangePct) / 100)
    : null;
  const lowFromSession = prevClose && finite(session.minChangePct) !== null
    ? prevClose * (1 + Number(session.minChangePct) / 100)
    : null;
  const high = finite(stock.high || stock.highPrice) || highFromSession || Math.max(open, close);
  const low = finite(stock.low || stock.lowPrice) || lowFromSession || Math.min(open, close);
  const intradayAmplitudePct = high > 0 && low > 0 ? ((high - low) / prevClose) * 100 : null;
  const highToClosePct = high > 0 ? ((close - high) / high) * 100 : null;
  const closeLocationPct = high > low ? ((close - low) / (high - low)) * 100 : (close >= high ? 100 : 0);
  const premiumRetentionPct = openGapPct >= 0.8 ? (closeChangePct / openGapPct) * 100 : null;
  const code = String(stock.code || stock.secCode || "");
  const limitThreshold = /^(300|301|688)/.test(code) ? 19.5 : 9.5;
  const highChangePct = ((high - prevClose) / prevClose) * 100;
  const touchedLimit = highChangePct >= limitThreshold;
  const boardBroken = touchedLimit && highToClosePct <= -0.8;
  return {
    code,
    name: String(stock.name || stock.code || "--"),
    concept: String(stock.mainConcept || stock.mainFamily || stock.concept || ""),
    openGapPct: round2(openGapPct),
    openToClosePct: round2(openToClosePct),
    closeChangePct: round2(closeChangePct),
    intradayAmplitudePct: round2(intradayAmplitudePct),
    highToClosePct: round2(highToClosePct),
    closeLocationPct: round1(closeLocationPct),
    premiumRetentionPct: round1(premiumRetentionPct),
    amountYi: round1(stock.amountYi),
    core,
    currentCore,
    historicalCore,
    capacity,
    touchedLimit,
    boardBroken,
    identity: identity || "短线样本",
    initiativeScore: round1(initiative.score),
    proactive: initiative.proactive === true,
  };
}

function isGapFade(item) {
  return Boolean(item && item.openGapPct >= 0.8 && (
    item.openToClosePct <= -0.6
    || (finite(item.premiumRetentionPct) !== null && item.premiumRetentionPct <= 35)
    || (finite(item.closeLocationPct) !== null && item.closeLocationPct <= 35)
  ));
}

function buildCohortStats(rows) {
  const sample = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const amountRows = sample.filter((item) => finite(item.amountYi) !== null && item.amountYi > 0);
  const gapRows = sample.filter((item) => item.openGapPct >= 0.8);
  const fadeRows = gapRows.filter(isGapFade);
  return {
    count: sample.length,
    amountYi: round1(sum(amountRows.map((item) => item.amountYi))),
    medianOpenGapPct: round2(median(sample.map((item) => item.openGapPct))),
    medianOpenToClosePct: round2(median(sample.map((item) => item.openToClosePct))),
    medianCloseChangePct: round2(median(sample.map((item) => item.closeChangePct))),
    aboveOpenRate: rate(sample, (item) => item.openToClosePct > 0),
    amountWeightedOpenToClosePct: round2(weightedAverage(amountRows, (item) => item.openToClosePct)),
    amountWeightedCloseChangePct: round2(weightedAverage(amountRows, (item) => item.closeChangePct)),
    amountAboveOpenRate: weightedRate(amountRows, (item) => item.openToClosePct > 0),
    medianAmplitudePct: round2(median(sample.map((item) => item.intradayAmplitudePct))),
    medianHighToClosePct: round2(median(sample.map((item) => item.highToClosePct))),
    medianCloseLocationPct: round1(median(sample.map((item) => item.closeLocationPct))),
    medianPremiumRetentionPct: round1(median(gapRows.map((item) => item.premiumRetentionPct))),
    gapFadeRate: rate(gapRows, isGapFade),
    gapSampleCount: gapRows.length,
    boardBreakCount: sample.filter((item) => item.boardBroken).length,
  };
}

function buildQuoteStats(candidates) {
  const sample = uniqueBy(
    (Array.isArray(candidates) ? candidates : []).map(candidateQuoteView).filter(Boolean),
    (item) => item.code || item.name,
  );
  const coreSample = sample.filter((item) => item.core);
  const amountSorted = sample
    .filter((item) => finite(item.amountYi) !== null && item.amountYi > 0)
    .slice()
    .sort((a, b) => b.amountYi - a.amountYi);
  const top10Rows = amountSorted.slice(0, 10);
  const top20Rows = amountSorted.slice(0, 20);
  const coreTopRows = coreSample
    .filter((item) => finite(item.amountYi) !== null && item.amountYi > 0)
    .slice()
    .sort((a, b) => b.amountYi - a.amountYi)
    .slice(0, 10);
  const allStats = buildCohortStats(sample);
  const top10 = buildCohortStats(top10Rows);
  const top20 = buildCohortStats(top20Rows);
  const coreTop = buildCohortStats(coreTopRows);
  const gapRows = sample.filter((item) => item.openGapPct >= 0.8);
  const leaders = sample
    .filter((item) => item.proactive || item.currentCore)
    .sort((a, b) => (b.openToClosePct - a.openToClosePct) || ((b.amountYi || 0) - (a.amountYi || 0)));
  const fades = gapRows
    .slice()
    .sort((a, b) => ((a.openToClosePct - b.openToClosePct) || ((b.amountYi || 0) - (a.amountYi || 0))));
  const negativeAnchors = uniqueBy(
    [...coreTopRows, ...top10Rows]
      .filter((item) => item.boardBroken || item.openToClosePct <= -3 || item.highToClosePct <= -4)
      .sort((a, b) => (
        Number(b.boardBroken) - Number(a.boardBroken)
        || (a.openToClosePct - b.openToClosePct)
        || ((b.amountYi || 0) - (a.amountYi || 0))
      )),
    (item) => item.code || item.name,
    10,
  );
  const hardVetoReasons = [];
  if (top10.count >= 5
    && top10.amountWeightedOpenToClosePct !== null
    && top10.amountWeightedOpenToClosePct <= -1
    && top10.amountAboveOpenRate !== null
    && top10.amountAboveOpenRate < 40) {
    hardVetoReasons.push(`成交额前10名开盘→收盘加权${signedPct(top10.amountWeightedOpenToClosePct)}，仅${top10.amountAboveOpenRate}%成交额收在开盘价上方`);
  }
  if (top10.gapSampleCount >= 4 && top10.gapFadeRate !== null && top10.gapFadeRate >= 60) {
    hardVetoReasons.push(`成交额前10名中的高开样本兑现率${top10.gapFadeRate}%`);
  }
  if (coreTop.count >= 3
    && coreTop.amountWeightedOpenToClosePct !== null
    && coreTop.amountWeightedOpenToClosePct <= -1.5
    && coreTop.amountAboveOpenRate !== null
    && coreTop.amountAboveOpenRate < 45) {
    hardVetoReasons.push(`先验/当日核心开盘→收盘加权${signedPct(coreTop.amountWeightedOpenToClosePct)}，核心承接失败`);
  }
  const brokenAnchors = negativeAnchors.filter((item) => item.boardBroken && item.openToClosePct <= -3);
  if (brokenAnchors.length >= 2) {
    hardVetoReasons.push(`${brokenAnchors.slice(0, 3).map((item) => item.name).join("、")}等${brokenAnchors.length}只核心/容量票触板后明显回落`);
  }
  const capacitySupport = Boolean(
    top10.count >= 5
    && top10.amountWeightedOpenToClosePct !== null
    && top10.amountWeightedOpenToClosePct >= 0.5
    && top10.amountAboveOpenRate !== null
    && top10.amountAboveOpenRate >= 50
    && (top10.gapFadeRate === null || top10.gapFadeRate <= 45)
  );
  const coreSupport = Boolean(
    coreTop.count >= 3
    && coreTop.amountWeightedOpenToClosePct !== null
    && coreTop.amountWeightedOpenToClosePct >= 0
    && coreTop.amountAboveOpenRate !== null
    && coreTop.amountAboveOpenRate >= 50
  );

  return {
    sample,
    coreSample,
    count: sample.length,
    coreCount: coreSample.length,
    medianOpenGapPct: allStats.medianOpenGapPct,
    gapUpRate: rate(sample, (item) => item.openGapPct >= 0.8),
    medianOpenToClosePct: allStats.medianOpenToClosePct,
    aboveOpenRate: allStats.aboveOpenRate,
    medianCloseChangePct: allStats.medianCloseChangePct,
    gapFadeRate: allStats.gapFadeRate,
    gapSampleCount: allStats.gapSampleCount,
    coreMedianOpenToClosePct: coreTop.medianOpenToClosePct,
    coreAboveOpenRate: coreTop.aboveOpenRate,
    proactiveCoreCount: coreSample.filter((item) => item.proactive && finite(item.initiativeScore) !== null && item.initiativeScore >= 60).length,
    all: allStats,
    top10,
    top20,
    coreTop,
    top10Rows,
    top20Rows,
    coreTopRows,
    capacitySupport,
    coreSupport,
    hardVeto: {
      active: hardVetoReasons.length > 0,
      label: hardVetoReasons.length ? "核心容量否决内生接力" : "未触发核心容量否决",
      reasons: hardVetoReasons,
    },
    leaders: leaders.slice(0, 5),
    fades: fades.slice(0, 5),
    negativeAnchors,
  };
}

function externalItemView(item, type) {
  const changePct = finite(item && item.changePct);
  if (changePct === null) return null;
  return {
    code: String(item.code || item.symbol || ""),
    name: String(item.name || item.code || item.symbol || "--"),
    market: String(item.market || (type === "index" ? "外围指数" : "外围核心")),
    theme: String(item.theme || item.role || ""),
    changePct: round2(changePct),
    type,
  };
}

function buildExternalSignal(payload) {
  const externalRisk = payload && payload.market && payload.market.externalRisk || {};
  const usFramework = payload && payload.usFramework || {};
  const indexes = uniqueBy(
    [
      ...(Array.isArray(externalRisk.indexes) ? externalRisk.indexes : []),
      ...(Array.isArray(usFramework.indexes) ? usFramework.indexes : []),
    ].map((item) => externalItemView(item, "index")).filter(Boolean),
    (item) => item.code || item.name,
  );
  const techQuotes = uniqueBy(
    (Array.isArray(usFramework.techQuotes) ? usFramework.techQuotes : [])
      .filter((item) => item && item.quoteAvailable !== false)
      .map((item) => externalItemView(item, "core"))
      .filter(Boolean),
    (item) => item.code || item.name,
  );
  const techIndexes = indexes.filter((item) => /NDX|SOX/i.test(item.code) || /纳斯达克|费城半导体|费半/.test(item.name));
  const broadIndexes = indexes.filter((item) => /SPX|DJIA|N225|HSI/i.test(item.code));
  const koreaCores = techQuotes.filter((item) => /韩国/.test(item.market) || /海力士|三星/.test(item.name));
  const techIndexMax = techIndexes.length ? Math.max(...techIndexes.map((item) => item.changePct)) : null;
  const techIndexMedian = median(techIndexes.map((item) => item.changePct));
  const coreMedian = median(techQuotes.map((item) => item.changePct));
  const corePositiveRate = rate(techQuotes, (item) => item.changePct > 0);
  const koreaMedian = median(koreaCores.map((item) => item.changePct));
  const broadMedian = median(broadIndexes.map((item) => item.changePct));
  const strong = Boolean(
    (techIndexMax !== null && techIndexMax >= 1.5)
    || (techQuotes.length >= 4 && corePositiveRate >= 65 && coreMedian !== null && coreMedian >= 1.5)
    || (koreaCores.length >= 2 && koreaMedian !== null && koreaMedian >= 2)
    || (broadIndexes.length >= 3 && broadMedian !== null && broadMedian >= 1.2)
  );
  const weak = Boolean(
    (techIndexMedian !== null && techIndexMedian <= -1.5)
    || (techQuotes.length >= 4 && coreMedian !== null && coreMedian <= -2.5)
    || (koreaCores.length >= 2 && koreaMedian !== null && koreaMedian <= -3)
  );
  const tone = strong ? "good" : weak ? "bad" : "neutral";
  const label = strong ? "外围存在明显助推" : weak ? "外围处于明显逆风" : "外围没有形成强刺激";
  const strongest = [...indexes, ...techQuotes]
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, 5);
  const weakest = [...indexes, ...techQuotes]
    .sort((a, b) => a.changePct - b.changePct)
    .slice(0, 4);
  const evidence = [];
  if (techIndexes.length) evidence.push(`科技指数中位数${signedPct(techIndexMedian)}，最强${signedPct(techIndexMax)}`);
  if (techQuotes.length) evidence.push(`外围核心上涨占比${corePositiveRate}% · 中位数${signedPct(coreMedian)}`);
  if (koreaCores.length) evidence.push(`海力士/三星等韩国核心中位数${signedPct(koreaMedian)}`);
  if (!evidence.length) evidence.push("外围指数或核心股数据不足，本项只作低置信度观察");

  return {
    available: indexes.length > 0 || techQuotes.length > 0,
    key: strong ? "tailwind" : weak ? "headwind" : "neutral",
    label,
    tone,
    strong,
    weak,
    techIndexMedian: round2(techIndexMedian),
    coreMedian: round2(coreMedian),
    corePositiveRate,
    koreaMedian: round2(koreaMedian),
    evidence,
    strongest,
    weakest,
  };
}

function activeProfitGroups(payload) {
  const attribution = payload && payload.market && payload.market.state && payload.market.state.effectAttribution || {};
  const groups = attribution.profitMap && Array.isArray(attribution.profitMap.groups)
    ? attribution.profitMap.groups
    : [];
  const priority = { strong: 3, pass: 3, mixed: 2, contracting: 1, unverified: 0, fail: -1 };
  return groups
    .filter((group) => group && Array.isArray(group.items) && group.items.length)
    .slice()
    .sort((a, b) => (
      (priority[b.status] || 0) - (priority[a.status] || 0)
      || b.items.length - a.items.length
    ));
}

function buildStyleRead(payload, sourceKey, entrantKey) {
  const groups = activeProfitGroups(payload);
  const primary = groups[0] || null;
  const groupLabels = groups.slice(0, 2).map((group) => String(group.title || "")).filter(Boolean);
  const references = uniqueBy(
    groups.flatMap((group) => group.items || []).map((item) => ({
      code: String(item.code || ""),
      name: String(item.name || item.code || "--"),
      concept: String(item.concept || ""),
      changePct: round2(item.changePct),
      note: String(item.typeLabel || groupLabels[0] || "赚钱样本"),
    })),
    (item) => item.code || item.name,
    6,
  );
  const directionCounts = new Map();
  references.forEach((item) => {
    const direction = String(item.concept || "").trim();
    if (direction) directionCounts.set(direction, (directionCounts.get(direction) || 0) + 1);
  });
  const directions = [...directionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name]) => name);

  let executionLabel = "分化观察，等待真实承接";
  let stage = "观察";
  if (["external-unconverted", "domestic-core-fade"].includes(sourceKey) || entrantKey === "new-entrant-loss") {
    executionLabel = "高开兑现，不把指数上涨当新增买点";
    stage = "兑现";
  } else if (entrantKey === "holder-profit-only") {
    executionLabel = "存量持仓获利，等待分歧后的回流确认";
    stage = "分化/兑现";
  } else if (["internal-active", "external-converted"].includes(sourceKey) && entrantKey === "active-profit") {
    executionLabel = "内生承接扩散，继续验证持续性";
    stage = "加强";
  } else if (["external-partial", "internal-partial"].includes(sourceKey)) {
    executionLabel = "局部赚钱，不把少数活口当成全市场加强";
    stage = "局部分化";
  }

  return {
    directionLabel: directions.length ? directions.join(" / ") : "方向偏好待具体标的确认",
    positionLabel: groupLabels.length ? groupLabels.join(" + ") : "位置偏好待确认",
    executionLabel,
    stage,
    references,
    evidence: primary
      ? [`主要赚钱载体落在“${primary.title}”`, primary.summary || "等待持续性验证"]
      : ["当前没有足够具体标的证明赚钱风格"],
  };
}

function buildMarketSurfaceRead(payload) {
  const snapshot = payload && payload.market && payload.market.snapshot || {};
  const limitStats = payload && payload.market && payload.market.limitStats || {};
  const breadth = finite(snapshot.breadth);
  const breadthPct = breadth === null ? null : Math.round(breadth > 1 ? breadth : breadth * 100);
  const avgIndexChange = finite(snapshot.avgIndexChange);
  const limitUpToday = finite(limitStats.ztToday);
  const limitDownToday = finite(limitStats.dtToday);
  const broadRise = Boolean(
    (breadthPct !== null && breadthPct >= 60)
    || (avgIndexChange !== null && avgIndexChange >= 0.8)
  );
  const broadWeak = Boolean(
    (breadthPct !== null && breadthPct <= 35)
    || (avgIndexChange !== null && avgIndexChange <= -0.8)
  );
  const label = broadRise ? "指数与广度普涨" : broadWeak ? "指数与广度偏弱" : "全市场表面分化";
  const evidence = [];
  if (breadthPct !== null) evidence.push(`上涨家数占比${breadthPct}%`);
  if (avgIndexChange !== null) evidence.push(`主要指数均值${signedPct(avgIndexChange)}`);
  if (limitUpToday !== null || limitDownToday !== null) {
    evidence.push(`涨停${limitUpToday === null ? "—" : limitUpToday} / 跌停${limitDownToday === null ? "—" : limitDownToday}`);
  }
  return {
    key: broadRise ? "broad-rise" : broadWeak ? "broad-weak" : "broad-mixed",
    label,
    tone: broadRise ? "good" : broadWeak ? "bad" : "warn",
    broadRise,
    broadWeak,
    breadthPct,
    avgIndexChange: round2(avgIndexChange),
    summary: `${evidence.join("，") || "市场统计待确认"}；这里只描述收盘表面，不直接等于短线新进资金赚钱。`,
    evidence,
  };
}

function buildCapacityRead(stats) {
  const top10 = stats && stats.top10 || {};
  const hardVeto = stats && stats.hardVeto || { active: false, reasons: [] };
  if (!top10.count || top10.count < 5) {
    return {
      key: "insufficient",
      label: "核心容量路径待确认",
      tone: "neutral",
      summary: "成交额前列样本不足，不用普通热榜代替核心容量结论。",
    };
  }
  if (hardVeto.active) {
    const stillGreen = finite(top10.amountWeightedCloseChangePct) !== null && top10.amountWeightedCloseChangePct > 0;
    return {
      key: stillGreen ? "gap-profit-taking" : "capacity-breakdown",
      label: stillGreen ? "核心容量高开兑现" : "核心容量承接失败",
      tone: "bad",
      summary: `成交额前10名开盘→收盘加权${signedPct(top10.amountWeightedOpenToClosePct)}，仅${top10.amountAboveOpenRate}%成交额收在开盘价上方；${stillGreen ? "收盘仍可能上涨，但今天追高资金明显亏钱" : "收盘结果与日内承接同时转弱"}。`,
    };
  }
  if (stats.capacitySupport) {
    return {
      key: "capacity-accepted",
      label: "核心容量完成承接",
      tone: "good",
      summary: `成交额前10名开盘→收盘加权${signedPct(top10.amountWeightedOpenToClosePct)}，${top10.amountAboveOpenRate}%成交额收在开盘价上方。`,
    };
  }
  return {
    key: "capacity-mixed",
    label: "核心容量仍在分化",
    tone: "warn",
    summary: `成交额前10名开盘→收盘加权${signedPct(top10.amountWeightedOpenToClosePct)}，${top10.amountAboveOpenRate == null ? "—" : `${top10.amountAboveOpenRate}%`}成交额收在开盘价上方，尚未形成一致承接。`,
  };
}

function buildFlowNature(payload, stats, marketSurface, capacityRead) {
  const limitStats = payload && payload.market && payload.market.limitStats || {};
  const top10 = stats && stats.top10 || {};
  const limitDownToday = finite(limitStats.dtToday);
  const limitDownPrev = finite(limitStats.dtPrev);
  const limitDownExpanding = Boolean(
    limitDownToday !== null
    && limitDownPrev !== null
    && limitDownToday >= Math.max(20, limitDownPrev * 1.5)
  );
  const panicExit = Boolean(
    stats && stats.hardVeto && stats.hardVeto.active
    && finite(top10.amountWeightedCloseChangePct) !== null
    && top10.amountWeightedCloseChangePct <= -2
    && finite(top10.medianCloseLocationPct) !== null
    && top10.medianCloseLocationPct <= 35
    && (marketSurface.broadWeak || limitDownExpanding)
  );
  if (panicExit) {
    return {
      key: "panic-exit",
      label: "恐慌出逃",
      tone: "bad",
      summary: "核心容量不仅开盘后走弱，而且相对昨收、收盘位置和极端负反馈同步恶化，属于出逃而不是普通兑现。",
    };
  }
  if (capacityRead.key === "gap-profit-taking") {
    return {
      key: "profit-taking",
      label: "高开兑现",
      tone: "warn",
      summary: "外围或隔夜预期先给出高开溢价，盘中资金兑现；这不同于恐慌出逃，但不能写成内生接力。",
    };
  }
  if (capacityRead.key === "capacity-breakdown") {
    return {
      key: "negative-feedback",
      label: "核心负反馈",
      tone: "bad",
      summary: "核心容量的日内承接和收盘结果同时转弱，需要继续区分普通兑现还是负反馈扩散。",
    };
  }
  if (capacityRead.key === "capacity-accepted") {
    return {
      key: "active-acceptance",
      label: "盘中主动承接",
      tone: "good",
      summary: "成交额前列股票的开盘买盘获得正反馈，资金没有只停留在指数表面。",
    };
  }
  return {
    key: "mixed",
    label: "兑现与承接并存",
    tone: "warn",
    summary: "核心容量内部仍有分化，暂不把少数强票外推为全市场一致赚钱。",
  };
}

function classifyEntrantProfit(stats) {
  if (!stats || stats.count < 5 || stats.medianOpenToClosePct === null || stats.aboveOpenRate === null) {
    return {
      key: "insufficient",
      label: "当日买盘盈亏待确认",
      tone: "neutral",
      summary: "可计算开盘到收盘收益的短线样本不足，不用模糊数据强下结论。",
    };
  }
  const top10 = stats.top10 || {};
  const coreTop = stats.coreTop || {};
  const activeProfit = stats.medianOpenToClosePct >= 0.7
    && stats.aboveOpenRate >= 60
    && stats.capacitySupport
    && (coreTop.count < 3 || stats.coreSupport)
    && !(stats.hardVeto && stats.hardVeto.active);
  const entrantLoss = Boolean(
    stats.hardVeto && stats.hardVeto.active
    && top10.count >= 5
    && top10.amountWeightedOpenToClosePct !== null
    && top10.amountWeightedOpenToClosePct <= -1
    && top10.amountAboveOpenRate !== null
    && top10.amountAboveOpenRate < 40
  );
  const holderOnly = !activeProfit
    && !entrantLoss
    && stats.medianCloseChangePct !== null
    && stats.medianCloseChangePct > 0.5
    && (
      stats.medianOpenToClosePct <= 0
      || (top10.gapSampleCount >= 3 && top10.gapFadeRate >= 50)
    );

  if (activeProfit) {
    return {
      key: "active-profit",
      label: "当日新进资金能够赚钱",
      tone: "good",
      summary: `普通短线样本开盘→收盘中位数${signedPct(stats.medianOpenToClosePct)}；成交额前10名加权${signedPct(top10.amountWeightedOpenToClosePct)}，${top10.amountAboveOpenRate}%成交额收在开盘价上方。`,
    };
  }
  if (entrantLoss) {
    return {
      key: "new-entrant-loss",
      label: "核心新进资金明显亏钱",
      tone: "bad",
      summary: `普通样本中位数${signedPct(stats.medianOpenToClosePct)}，但成交额前10名加权${signedPct(top10.amountWeightedOpenToClosePct)}，仅${top10.amountAboveOpenRate}%成交额收在开盘价上方；不能用小票普涨掩盖核心买盘亏损。`,
    };
  }
  if (holderOnly) {
    return {
      key: "holder-profit-only",
      label: "主要是存量持仓赚钱",
      tone: "warn",
      summary: `收盘相对昨收仍有利润，但成交额前10名开盘→收盘加权${signedPct(top10.amountWeightedOpenToClosePct)}；高开样本兑现率${top10.gapFadeRate == null ? "—" : `${top10.gapFadeRate}%`}。`,
    };
  }
  return {
    key: "mixed",
    label: "当日买盘盈亏分化",
    tone: "warn",
    summary: `普通样本开盘→收盘中位数${signedPct(stats.medianOpenToClosePct)}，成交额前10名加权${signedPct(top10.amountWeightedOpenToClosePct)}，两层没有形成一致赚钱。`,
  };
}

function classifySource(payload, external, stats, entrant) {
  const snapshot = payload && payload.market && payload.market.snapshot || {};
  const limitStats = payload && payload.market && payload.market.limitStats || {};
  const breadth = finite(snapshot.breadth);
  const breadthPct = breadth === null ? null : Math.round((breadth > 1 ? breadth : breadth * 100));
  const avgIndexChange = finite(snapshot.avgIndexChange);
  const limitDownToday = finite(limitStats.dtToday);
  const limitDownPrev = finite(limitStats.dtPrev);
  const gapResponse = stats.count >= 5 && (
    stats.medianOpenGapPct >= 0.8
    || stats.gapUpRate >= 58
  );
  let conversionPoints = 0;
  if (stats.medianOpenToClosePct !== null && stats.medianOpenToClosePct >= 0.6) conversionPoints += 1;
  if (stats.aboveOpenRate !== null && stats.aboveOpenRate >= 58) conversionPoints += 1;
  if (breadthPct !== null && breadthPct >= 55) conversionPoints += 1;
  if (stats.capacitySupport) conversionPoints += 1;
  if (stats.coreSupport) conversionPoints += 1;
  if (stats.proactiveCoreCount >= 2) conversionPoints += 1;
  const conversionFailed = Boolean(
    (stats.hardVeto && stats.hardVeto.active)
    || (
      stats.medianOpenToClosePct !== null
      && stats.medianOpenToClosePct <= -0.6
      && stats.aboveOpenRate !== null
      && stats.aboveOpenRate <= 42
    )
  );
  const broadSupport = Boolean(
    (breadthPct !== null && breadthPct >= 50)
    || (avgIndexChange !== null && avgIndexChange >= 0.8)
  );
  const extremeNegativeFeedback = Boolean(
    limitDownToday !== null
    && (
      limitDownToday >= 50
      || (limitDownPrev !== null && limitDownToday >= Math.max(20, limitDownPrev * 1.5))
    )
  );
  // 全市场普涨只能说明“表面修复”。真正转成内循环必须同时满足：
  // 当日买盘赚钱、成交额前列承接、核心承接、市场广度，且没有核心容量硬否决。
  const converted = conversionPoints >= 4
    && !conversionFailed
    && broadSupport
    && !extremeNegativeFeedback
    && entrant.key === "active-profit"
    && stats.capacitySupport
    && (stats.coreSupport || stats.proactiveCoreCount >= 2);
  const partialInternal = conversionPoints >= 3 && !conversionFailed && !converted;
  const domesticActive = converted && entrant.key === "active-profit";

  let key = "mixed-unclear";
  let label = "上涨来源仍需确认";
  let tone = "warn";
  let summary = "外围、开盘溢价与盘中承接没有形成足够清晰的单一来源。";
  if (external.strong && gapResponse && converted) {
    key = "external-converted";
    label = "外围点火，A股完成内生接力";
    tone = "good";
    summary = "外围先提供开盘溢价，随后A股核心、市场广度与当日买盘继续承接，已经从外部刺激转成内循环。";
  } else if (external.strong && (gapResponse || conversionFailed)) {
    key = "external-unconverted";
    label = conversionFailed ? "外围点火，A股借高开兑现" : "外围刺激，尚未转成A股内循环";
    tone = "bad";
    summary = conversionFailed
      ? "外围先给出开盘溢价，但成交额前列核心普遍高开低走；上涨主要停留在收盘表面，盘中没有完成内生接力。"
      : "外围提供了风险偏好或高开溢价，但盘中承接、核心扩散或当日买盘没有接住。";
  } else if (conversionFailed) {
    key = "domestic-core-fade";
    label = broadSupport ? "市场表面上涨，核心容量兑现" : "核心容量负反馈";
    tone = "bad";
    summary = broadSupport
      ? "指数、上涨家数或小票表现较好，但成交额前列核心开盘后持续走弱；不能把收盘普涨写成短线环境转强。"
      : "市场广度与成交额前列核心同时走弱，短线负反馈需要继续观察是否扩散。";
  } else if (domesticActive && external.weak && !external.strong) {
    key = "internal-resilient";
    label = "A股逆外围主动走强";
    tone = "good";
    summary = "外围偏弱时A股仍由主动核心和盘中增量推动，内生强度高于普通跟涨。";
  } else if (domesticActive) {
    key = "internal-active";
    label = "A股内生主动上涨";
    tone = "good";
    summary = "上涨主要由A股盘中主动买盘、核心带动和市场扩散形成，不依赖隔夜高开。";
  } else if (partialInternal && !external.strong) {
    key = "internal-partial";
    label = "A股局部主动，尚未形成全市场内循环";
    tone = "warn";
    summary = "核心与热榜样本存在主动买盘，但市场广度、指数或极端负反馈没有同步确认。";
  } else if (external.strong && partialInternal) {
    key = "external-partial";
    label = "外围有利，A股只形成局部内循环";
    tone = "warn";
    summary = "外围风险偏好较强，A股少数核心获得主动承接，但市场广度和负反馈没有同步改善。";
  } else if (external.strong && !gapResponse && !converted) {
    key = "external-decoupled";
    label = "外围有利，但A股没有有效响应";
    tone = "warn";
    summary = "外围风险偏好较强，但A股短线样本没有形成相应高开与承接，不能把外围涨幅写成A股修复。";
  }

  const conversion = converted
    ? {
      key: "converted",
      label: "已经转成内循环",
      tone: "good",
      summary: `六项承接证据通过${conversionPoints}项；成交额前10名加权${signedPct(stats.top10.amountWeightedOpenToClosePct)}，核心容量与市场广度同步承接。`,
    }
    : conversionFailed
      ? {
        key: "failed",
        label: "内生接力失败",
        tone: "bad",
        summary: `普通样本可能上涨，但成交额前10名开盘→收盘加权${signedPct(stats.top10.amountWeightedOpenToClosePct)}，高开兑现率${stats.top10.gapFadeRate == null ? "—" : `${stats.top10.gapFadeRate}%`}；核心容量否决内生接力。`,
      }
      : partialInternal
        ? {
          key: "partial",
          label: "只有局部内循环",
          tone: "warn",
          summary: `核心样本有承接，但市场上涨家数占比${breadthPct == null ? "—" : `${breadthPct}%`}${extremeNegativeFeedback ? `，跌停${limitDownToday}只且负反馈扩散` : "，广度/指数尚未同步"}。`,
        }
        : {
        key: "unconfirmed",
        label: "内循环转化待确认",
        tone: "warn",
        summary: `六项承接证据通过${conversionPoints}项，尚不足以确认核心容量、市场广度和当日买盘共同接力。`,
        };

  return {
    key,
    label,
    tone,
    summary,
    converted,
    partialInternal,
    conversionPoints,
    gapResponse,
    breadthPct,
    broadSupport,
    extremeNegativeFeedback,
    mandatoryGates: {
      entrantProfit: entrant.key === "active-profit",
      capacitySupport: stats.capacitySupport,
      coreSupport: stats.coreSupport || stats.proactiveCoreCount >= 2,
      broadSupport,
      noHardVeto: !(stats.hardVeto && stats.hardVeto.active),
    },
    conversion,
  };
}

function cycleRead(payload, source, entrant, stats) {
  const state = payload && payload.market && payload.market.state || {};
  const baseCycle = String(state.structuralCycle || state.cycle || "周期待确认");
  const resolution = state.structuralResolution && typeof state.structuralResolution === "object"
    ? state.structuralResolution
    : {};
  const previousCycle = String(resolution.previousCycle || "");
  const justUpgradedToMainRise = baseCycle === "主升"
    && resolution.changed === true
    && previousCycle
    && previousCycle !== "主升";
  const failed = source.conversion && source.conversion.key === "failed"
    || entrant.key === "new-entrant-loss"
    || Boolean(stats && stats.hardVeto && stats.hardVeto.active);
  if (failed && justUpgradedToMainRise) {
    return {
      label: "撤销“主升”升级",
      displayCycle: `${previousCycle}观察`,
      tone: "bad",
      summary: `原模型由“${previousCycle}”升级到“主升”，但核心容量与今日新进买盘没有确认；本分析层继续按“${previousCycle}观察”展示，等待下一交易日验证。`,
    };
  }
  if (failed || ["external-unconverted", "external-decoupled", "external-partial"].includes(source.key)) {
    return {
      label: baseCycle === "主升" ? "主升结构·当日强分歧" : "禁止周期升级",
      displayCycle: baseCycle === "主升" ? "主升结构·强分歧" : baseCycle,
      tone: "bad",
      summary: `基础结构仍单独记录为“${baseCycle}”，但今日核心容量承接失败；不能凭收盘上涨把当日状态写成周期加强。`,
    };
  }
  if (["external-converted", "internal-active", "internal-resilient"].includes(source.key) && entrant.key === "active-profit") {
    return {
      label: "形成主升候选证据",
      displayCycle: baseCycle === "主升" ? "主升确认中" : `${baseCycle}·加强候选`,
      tone: "good",
      summary: "当日核心容量与新进买盘已经确认，但只记为加强候选；至少等待下一交易日核心溢价和方向扩散继续成立，再确认主升。",
    };
  }
  return {
    label: "保留原周期，等待确认",
    displayCycle: baseCycle,
    tone: "warn",
    summary: `基础周期仍按“${baseCycle}”记录；上涨来源与当日买盘尚未共同确认，不凭指数涨跌切换周期。`,
  };
}

function buildMarketStrengthSource(payload) {
  const state = payload && payload.market && payload.market.state || {};
  const stats = buildQuoteStats(payload && payload.candidates);
  const external = buildExternalSignal(payload || {});
  const marketSurface = buildMarketSurfaceRead(payload || {});
  const capacity = buildCapacityRead(stats);
  const entrant = classifyEntrantProfit(stats);
  const source = classifySource(payload || {}, external, stats, entrant);
  const flowNature = buildFlowNature(payload || {}, stats, marketSurface, capacity);
  const style = buildStyleRead(payload || {}, source.key, entrant.key);
  const cycle = cycleRead(payload || {}, source, entrant, stats);
  const sampleQuality = stats.count >= 12 ? "样本充足" : stats.count >= 5 ? "样本可观察" : "样本不足";
  const sampleTone = stats.count >= 12 ? "good" : stats.count >= 5 ? "warn" : "bad";
  const baseCycle = String(state.structuralCycle || state.cycle || "周期待确认");
  const displayCycle = cycle.displayCycle || baseCycle;

  return {
    version: MARKET_STRENGTH_SOURCE_VERSION,
    generatedAt: payload && (payload.fetchedAt || payload.updatedAt) || new Date().toISOString(),
    tradingDate: String(payload && payload.marketEmotion && payload.marketEmotion.tradingDate || ""),
    guardrail: "本层只解释上涨来源与资金承接，不参与候选评分、排序、过滤、仓位或买卖规则。",
    headline: source.label,
    oneLine: `${displayCycle} → ${marketSurface.label} → ${capacity.label} → ${entrant.label} → ${source.conversion.label}`,
    source,
    external,
    marketSurface,
    capacity,
    flowNature,
    conversion: source.conversion,
    entrantProfit: entrant,
    style,
    cycleRead: cycle,
    sampleQuality: {
      label: sampleQuality,
      tone: sampleTone,
      count: stats.count,
      coreCount: stats.coreCount,
      top10AmountYi: stats.top10.amountYi,
      summary: `以${stats.count}只短线样本观察市场表面，以成交额前10名（合计${stats.top10.amountYi == null ? "—" : `${stats.top10.amountYi}亿`}）和${stats.coreCount}只先验/当日核心判断真实承接。`,
    },
    metrics: {
      medianOpenGapPct: stats.medianOpenGapPct,
      gapUpRate: stats.gapUpRate,
      medianOpenToClosePct: stats.medianOpenToClosePct,
      aboveOpenRate: stats.aboveOpenRate,
      medianCloseChangePct: stats.medianCloseChangePct,
      gapFadeRate: stats.gapFadeRate,
      gapSampleCount: stats.gapSampleCount,
      coreMedianOpenToClosePct: stats.coreMedianOpenToClosePct,
      coreAboveOpenRate: stats.coreAboveOpenRate,
      proactiveCoreCount: stats.proactiveCoreCount,
      breadthPct: source.breadthPct,
      top10Count: stats.top10.count,
      top10AmountYi: stats.top10.amountYi,
      top10WeightedOpenToClosePct: stats.top10.amountWeightedOpenToClosePct,
      top10WeightedCloseChangePct: stats.top10.amountWeightedCloseChangePct,
      top10AmountAboveOpenRate: stats.top10.amountAboveOpenRate,
      top10GapFadeRate: stats.top10.gapFadeRate,
      top10MedianAmplitudePct: stats.top10.medianAmplitudePct,
      top10MedianCloseLocationPct: stats.top10.medianCloseLocationPct,
      top20WeightedOpenToClosePct: stats.top20.amountWeightedOpenToClosePct,
      top20AmountAboveOpenRate: stats.top20.amountAboveOpenRate,
      coreTopWeightedOpenToClosePct: stats.coreTop.amountWeightedOpenToClosePct,
      coreTopAmountAboveOpenRate: stats.coreTop.amountAboveOpenRate,
    },
    hardVeto: stats.hardVeto,
    evidence: {
      external: external.strongest,
      leaders: stats.leaders,
      fades: stats.fades,
      topCapacity: stats.top10Rows,
      negativeAnchors: stats.negativeAnchors,
      styleStocks: style.references,
    },
    chain: [
      { key: "cycle", index: "01", title: "周期底稿", label: displayCycle, summary: cycle.summary, tone: cycle.tone },
      { key: "external", index: "02", title: "开盘来源", label: external.label, summary: external.evidence.join("；"), tone: external.tone },
      { key: "surface", index: "03", title: "市场表面", label: marketSurface.label, summary: marketSurface.summary, tone: marketSurface.tone },
      { key: "capacity", index: "04", title: "核心容量", label: capacity.label, summary: capacity.summary, tone: capacity.tone },
      { key: "entrant", index: "05", title: "今日买盘", label: entrant.label, summary: entrant.summary, tone: entrant.tone },
      { key: "conclusion", index: "06", title: "最终定性", label: source.conversion.label, summary: `${flowNature.label}；${source.summary}`, tone: source.conversion.tone },
    ],
  };
}

module.exports = {
  MARKET_STRENGTH_SOURCE_VERSION,
  buildMarketStrengthSource,
  _internals: {
    candidateQuoteView,
    buildQuoteStats,
    buildExternalSignal,
    buildMarketSurfaceRead,
    buildCapacityRead,
    buildFlowNature,
    classifyEntrantProfit,
    classifySource,
    buildStyleRead,
  },
};
