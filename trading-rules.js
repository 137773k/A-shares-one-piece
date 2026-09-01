"use strict";

const { classifyFundFlow } = require("./flow-classifier");
const { normalizeBigCycle } = require("./quant-decision/market-cycle-contract");

function avg(nums) {
  if (!nums.length) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}
function round1(x) { return Math.round(x * 10) / 10; }
function round2(x) { return Math.round(x * 100) / 100; }

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function historicalTurnoverAverage(stock) {
  const direct = [
    stock && stock.avgTurnoverRate5d,
    stock && stock.turnoverRate5dAvg,
    stock && stock.avgTurnover5d,
    stock && stock.avgTurnoverRate20d,
    stock && stock.turnoverRate20dAvg,
    stock && stock.historicalTurnoverRate,
  ].map(finite).find((value) => value !== null && value > 0);
  if (direct !== undefined) return direct;
  const history = stock && stock.turnoverHistory;
  if (!Array.isArray(history)) return null;
  const valid = history.map((item) => finite(typeof item === "object" ? item.turnoverRate ?? item.turnover : item))
    .filter((value) => value !== null && value > 0);
  return valid.length ? avg(valid.slice(-20)) : null;
}

/**
 * 成交活跃度不再使用“小票12%/大票8%”固定换手门槛。
 * 容量票首先看绝对成交额，再与自身历史成交、历史换手交叉验证。
 * 只有多项数据共同证明流动性不足才硬拒；单独低换手只会待确认。
 */
function evaluateAdaptiveLiquidity(stock, context = {}) {
  const source = stock || {};
  const kp = source.klineProfile || {};
  const turnoverRate = finite(source.turnoverRate);
  const historicalTurnover = historicalTurnoverAverage(source);
  const amountYi = finite(source.amountYi ?? source.currentAmountYi);
  const avgAmount5Yi = finite(kp.avgAmount5Yi ?? source.avgAmount5Yi);
  const floatMktCapYi = finite(source.floatMktCapYi);
  const amountVsHistory = amountYi !== null && avgAmount5Yi !== null && avgAmount5Yi > 0
    ? amountYi / avgAmount5Yi : null;
  const turnoverVsHistory = turnoverRate !== null && historicalTurnover !== null && historicalTurnover > 0
    ? turnoverRate / historicalTurnover : null;
  const capacity = Boolean(
    context.capacityStock
    || source.capacityStock
    || source.ticketType === "容量票"
    || (floatMktCapYi !== null && floatMktCapYi >= 350)
    || (amountYi !== null && amountYi >= 25),
  );

  // 绝对成交要求随流通盘递增，服务于容量验证而非换手率一刀切。
  const amountReference = floatMktCapYi === null ? 5
    : floatMktCapYi >= 1000 ? 20
      : floatMktCapYi >= 500 ? 15
        : floatMktCapYi >= 200 ? 8
          : floatMktCapYi >= 100 ? 5 : 3;
  const amountAdequate = amountYi !== null && amountYi >= amountReference;
  const amountClearlyLarge = amountYi !== null && amountYi >= amountReference * 1.5;
  const amountHolding = amountVsHistory === null || amountVsHistory >= 0.6;
  const relativeTurnoverHealthy = turnoverVsHistory !== null && turnoverVsHistory >= 0.75;
  const relativeAmountHealthy = amountVsHistory !== null && amountVsHistory >= 0.75;
  const reasons = [];

  if (amountYi !== null) reasons.push(`成交额${round2(amountYi)}亿（容量参考${amountReference}亿）`);
  if (amountVsHistory !== null) reasons.push(`成交额为5日均额的${Math.round(amountVsHistory * 100)}%`);
  if (turnoverRate !== null) reasons.push(`换手${round2(turnoverRate)}%`);
  if (turnoverVsHistory !== null) reasons.push(`换手为自身历史的${Math.round(turnoverVsHistory * 100)}%`);

  const sufficient = (capacity && amountAdequate && amountHolding)
    || amountClearlyLarge
    || (amountAdequate && (relativeAmountHealthy || relativeTurnoverHealthy))
    || (amountYi !== null && amountAdequate && historicalTurnover === null && avgAmount5Yi === null);
  if (sufficient) {
    reasons.push(capacity ? "容量成交充分，低换手不构成否决" : "绝对成交与自身历史匹配");
    return {
      status: "sufficient",
      label: "成交充分",
      reasons,
      capacity,
      metrics: { turnoverRate, historicalTurnover, turnoverVsHistory, amountYi, avgAmount5Yi, amountVsHistory, floatMktCapYi, amountReference },
    };
  }

  const amountClearlyWeak = amountYi !== null && amountYi < amountReference * 0.55;
  const historyAmountWeak = amountVsHistory !== null && amountVsHistory < 0.55;
  const historyTurnoverWeak = turnoverVsHistory !== null && turnoverVsHistory < 0.55;
  // 至少两类证据（绝对额 + 自身历史）共同偏弱，才认为成交不足。
  if (amountClearlyWeak && (historyAmountWeak || historyTurnoverWeak)) {
    reasons.push("绝对成交偏低且较自身历史明显萎缩");
    return {
      status: "insufficient",
      label: "成交活跃度不足",
      reasons,
      capacity,
      metrics: { turnoverRate, historicalTurnover, turnoverVsHistory, amountYi, avgAmount5Yi, amountVsHistory, floatMktCapYi, amountReference },
    };
  }

  if (!reasons.length) reasons.push("成交额、流通盘及自身历史数据不足");
  else reasons.push("证据不足以确认成交充分或不足");
  return {
    status: "uncertain",
    label: "成交活跃度待确认",
    reasons,
    capacity,
    metrics: { turnoverRate, historicalTurnover, turnoverVsHistory, amountYi, avgAmount5Yi, amountVsHistory, floatMktCapYi, amountReference },
  };
}

/**
 * 个股进入“当日机会”前的关键数据契约。
 *
 * 这份契约与技术形态、历史核心身份和资金流定性分离：
 * - 价格、成交额必须能落到预期交易日；
 * - 换手或容量至少有一条可验证路径；
 * - 个股总市值桶必须已知且来源可追溯；
 * - 必须有同日已验证收盘，或可信分时状态。
 *
 * 资金流不是完整性必填项；缺失时只产生风险备注。
 */
function evaluateOpportunityDataCompleteness(stock, context = {}) {
  const source = stock || {};
  const kp = source.klineProfile || {};
  const lastSession = kp.lastSession || {};
  const leadership = source.leadership || {};
  const initiative = leadership.initiative || {};
  const intradaySession = initiative.session || {};
  const intradayQuality = intradaySession.evidenceQuality || {};
  const carrier = source.marketCapCarrier || {};
  const evidenceFinite = (value) => (
    value === null || value === undefined || value === "" ? null : finite(value)
  );
  const expectedTradingDate = String(
    context.tradingDate
    || source.factorContext && source.factorContext.tradingDate
    || source.tradingDate
    || source.currentTradingDate
    || "",
  ).trim();
  const sameDate = (value) => Boolean(
    expectedTradingDate
    && String(value || "").trim() === expectedTradingDate
  );
  const profileLineage = source.klineProfileLineage && typeof source.klineProfileLineage === "object"
    ? source.klineProfileLineage
    : kp.dataLineage && typeof kp.dataLineage === "object" ? kp.dataLineage : {};
  const lineageMode = String(profileLineage.mode || "").trim().toLowerCase();
  const cachedEvidenceDeclared = source.klineProfileCached === true || /cache/.test(lineageMode);
  const cachedEvidenceUsable = !cachedEvidenceDeclared || Boolean(
    lineageMode === "same_day_cache"
    && profileLineage.cacheAccepted === true
    && sameDate(profileLineage.expectedTradingDate || profileLineage.tradingDate)
  );

  const closingSource = String(lastSession.source || "").trim();
  const closingSnapshotKind = String(lastSession.snapshotKind || "").trim().toLowerCase();
  const closingUsable = sameDate(lastSession.tradingDate)
    && lastSession.verified === true
    && lastSession.completed === true
    && Boolean(closingSource)
    && /closing|close|post.?close|settled/.test(closingSnapshotKind)
    && cachedEvidenceUsable;

  const intradaySource = String(intradaySession.source || "").trim();
  const intradayQualityKey = String(
    intradaySession.dataQualityKey
    || initiative.dataQualityKey
    || intradayQuality.qualityKey
    || "",
  ).trim();
  const intradayEvidenceWeight = evidenceFinite(
    intradaySession.evidenceWeight
    ?? initiative.evidenceWeight
    ?? intradayQuality.evidenceWeight,
  );
  const intradayHasState = [
    intradaySession.currentChangePct,
    intradaySession.openChangePct,
    intradaySession.maxChangePct,
    intradaySession.minChangePct,
  ].some((value) => evidenceFinite(value) !== null);
  const trustedIntraday = sameDate(intradaySession.tradingDate)
    && intradaySession.verified === true
    && Boolean(intradaySource)
    && Boolean(String(intradaySession.asOf || "").trim())
    && intradayHasState
    && Boolean(intradayQualityKey)
    && !/unknown|unavailable|invalid|missing|缺失|待确认/i.test(intradayQualityKey)
    && (intradayEvidenceWeight === null || intradayEvidenceWeight >= 0.5);
  const sessionUsable = closingUsable || trustedIntraday;

  const closingPrice = evidenceFinite(lastSession.close);
  const directPrice = evidenceFinite(source.price ?? source.close ?? kp.lastClose);
  const price = closingUsable && closingPrice !== null && closingPrice > 0
    ? closingPrice
    : sessionUsable && directPrice !== null && directPrice > 0 ? directPrice : null;
  const priceSource = price === null ? null
    : closingUsable && closingPrice !== null && closingPrice > 0
      ? `klineProfile.lastSession.close:${closingSource}`
      : `candidate.price:${trustedIntraday ? intradaySource : closingSource}`;

  const closingAmountYi = evidenceFinite(lastSession.amountYi);
  const directAmountYi = evidenceFinite(source.amountYi ?? source.currentAmountYi);
  const amountYi = closingUsable && closingAmountYi !== null && closingAmountYi > 0
    ? closingAmountYi
    : sessionUsable && directAmountYi !== null && directAmountYi > 0 ? directAmountYi : null;
  const amountSource = amountYi === null ? null
    : closingUsable && closingAmountYi !== null && closingAmountYi > 0
      ? `klineProfile.lastSession.amountYi:${closingSource}`
      : `candidate.amountYi:${trustedIntraday ? intradaySource : closingSource}`;

  const closingTurnoverRate = evidenceFinite(lastSession.turnoverRate);
  const directTurnoverRate = evidenceFinite(source.turnoverRate);
  const turnoverRate = sessionUsable && directTurnoverRate !== null && directTurnoverRate > 0
    ? directTurnoverRate
    : closingUsable && closingTurnoverRate !== null && closingTurnoverRate > 0
      ? closingTurnoverRate : null;

  const totalCapYi = evidenceFinite(
    carrier.totalCapYi
    ?? source.totalMktCapYi
    ?? source.totalMarketCapYi,
  );
  const bucketKey = String(carrier.bucketKey || "").trim();
  const marketCapLineage = String(carrier.source || carrier.method || "").trim();
  const capDataQuality = String(carrier.capDataQuality || "").trim();
  const marketCapUsable = totalCapYi !== null
    && totalCapYi > 0
    && Boolean(bucketKey)
    && bucketKey !== "unknown"
    && Boolean(marketCapLineage)
    && !/missing|unknown|unavailable|invalid|缺失|待确认/i.test(capDataQuality);

  const liquidityInput = {
    ...source,
    amountYi,
    turnoverRate,
    totalMktCapYi: totalCapYi,
  };
  const liquidity = context.liquidity || evaluateAdaptiveLiquidity(liquidityInput, context);
  const turnoverUsable = turnoverRate !== null && turnoverRate > 0;
  const capacityUsable = marketCapUsable
    && amountYi !== null
    && liquidity.status === "sufficient"
    && liquidity.capacity === true;
  const liquidityCapacityUsable = turnoverUsable || capacityUsable;

  const mainInflowYi = evidenceFinite(source.mainInflowYi);
  const fundFlowAvailable = mainInflowYi !== null && mainInflowYi !== 0;
  const missingFields = [];
  const blockers = [];
  if (!expectedTradingDate) {
    missingFields.push("tradingDate");
    blockers.push("缺少权威交易日，无法验证个股证据是否属于当日");
  }
  if (!sessionUsable) {
    missingFields.push("sessionState");
    blockers.push("缺少同交易日已验证收盘或可信分时状态");
  }
  if (price === null) {
    missingFields.push("price");
    blockers.push("缺少同交易日有效价格");
  }
  if (amountYi === null) {
    missingFields.push("amount");
    blockers.push("缺少同交易日有效成交额");
  }
  if (!liquidityCapacityUsable) {
    missingFields.push("liquidityCapacity");
    blockers.push("换手率与容量成交均无法验证");
  }
  if (!marketCapUsable) {
    missingFields.push("marketCap");
    blockers.push("个股总市值桶未知或来源不可追溯");
  }
  const riskNotes = fundFlowAvailable ? [] : ["主力资金流缺失：仅作风险备注，不影响关键数据完整性"];
  const qualified = missingFields.length === 0;

  return {
    version: 1,
    status: qualified ? "complete" : "incomplete",
    qualified,
    opportunityEligible: qualified,
    tradingDate: expectedTradingDate || null,
    missingFields,
    blockers,
    riskNotes,
    fundFlowRequired: false,
    evidence: {
      price: {
        usable: price !== null,
        value: price,
        source: priceSource,
        tradingDate: price !== null ? expectedTradingDate : null,
      },
      amount: {
        usable: amountYi !== null,
        amountYi,
        source: amountSource,
        tradingDate: amountYi !== null ? expectedTradingDate : null,
      },
      liquidityCapacity: {
        usable: liquidityCapacityUsable,
        mode: turnoverUsable ? "turnover" : capacityUsable ? "capacity" : "unverified",
        turnoverRate,
        liquidityStatus: liquidity.status,
        source: turnoverUsable ? "candidate.turnoverRate" : capacityUsable ? "adaptive_capacity" : null,
      },
      marketCap: {
        usable: marketCapUsable,
        totalCapYi,
        bucketKey: bucketKey || null,
        bucketLabel: String(carrier.bucketLabel || "").trim() || null,
        source: marketCapLineage || null,
        dataQuality: capDataQuality || null,
      },
      session: {
        usable: sessionUsable,
        state: closingUsable ? "verified_closing" : trustedIntraday ? "trusted_intraday" : "unverified",
        source: closingUsable ? closingSource : trustedIntraday ? intradaySource : null,
        tradingDate: closingUsable ? String(lastSession.tradingDate)
          : trustedIntraday ? String(intradaySession.tradingDate) : null,
      },
      fundFlow: {
        required: false,
        available: fundFlowAvailable,
        mainInflowYi: fundFlowAvailable ? mainInflowYi : null,
      },
    },
    rule: "价格、成交额、换手/容量、可追溯总市值桶和当日收盘/可信分时均为机会必填；资金流可缺失且只作风险备注",
  };
}

/**
 * 短线机会结构与中长期 K 线结构分层。
 *
 * 当日真实收盘涨停、有价格发现、是当前方向的主动高度载体，且
 * close >= MA5 >= MA10 >= MA20、成交充分时，“5 日线斜率未转正”或“距历史高点较远”
 * 只能限制追高，不能把当日正在发生的短线强度改写成失败。
 *
 * 这个放宽不覆盖当日致命证据：一字/无价格发现、长阴破位、成交不足等仍失败关闭。
 */
function evaluateShortTermActiveCarrier(stock, context = {}) {
  const source = stock || {};
  const kp = source.klineProfile || {};
  const leadership = source.leadership || {};
  const initiative = leadership.initiative || {};
  const priceDiscovery = initiative.priceDiscovery || {};
  const lastSession = kp.lastSession || {};
  const liquidity = context.liquidity || evaluateAdaptiveLiquidity(source, context);
  const evidenceFinite = (value) => (value === null || value === undefined || value === "" ? null : finite(value));
  const close = evidenceFinite(kp.lastClose ?? source.price ?? source.close);
  const ma5 = evidenceFinite(kp.ma5);
  const ma10 = evidenceFinite(kp.ma10);
  const ma20 = evidenceFinite(kp.ma20);
  const initiativeScore = evidenceFinite(initiative.score);
  const identityText = [
    source.roleKind,
    source.role,
    source.dailyRole,
    leadership.identity,
    leadership.levelLabel,
    leadership.anchorType,
    leadership.dailyHeightMembership && leadership.dailyHeightMembership.roleKind,
    leadership.sessionIdentity && leadership.sessionIdentity.dailyHeight === true ? "dailyHeight" : "",
  ].filter(Boolean).join("；");
  const expectedTradingDate = String(context.tradingDate
    || source.factorContext && source.factorContext.tradingDate
    || "").trim();
  const sessionTradingDate = String(lastSession.tradingDate || "").trim();
  const sessionDateAligned = !expectedTradingDate
    || Boolean(sessionTradingDate && sessionTradingDate === expectedTradingDate);
  const verifiedClosingLimit = sessionDateAligned
    && lastSession.verified === true
    && lastSession.completed === true
    && lastSession.closedAtLimit === true;
  const sessionDiscoveryVerified = lastSession.oneWord === false
    && lastSession.noPriceDiscovery === false;
  const initiativeDiscoveryVerified = priceDiscovery.suspectedOneWord === false
    && priceDiscovery.limitUpDiscoveryUnverified === false
    && priceDiscovery.noPriceDiscovery === false;
  const hasPriceDiscovery = sessionDiscoveryVerified || initiativeDiscoveryVerified;
  const activeRole = source.roleKind === "dailyHeight"
    || Boolean(leadership.sessionIdentity && leadership.sessionIdentity.dailyHeight === true)
    || /dailyHeight|当日高度|高度龙|主动核心|主线主动龙头/.test(identityText);
  const initiativeActive = leadership.recognized === true
    && initiative.proactive === true
    && initiativeScore !== null
    && initiativeScore >= 70;
  const maAligned = [close, ma5, ma10, ma20].every((value) => value !== null)
    && close >= ma5
    && ma5 >= ma10
    && ma10 >= ma20;
  const fatalCurrentBreak = kp.longBearBreak3d === true
    || lastSession.oneWord === true
    || lastSession.noPriceDiscovery === true
    || liquidity.status === "insufficient";
  const qualified = verifiedClosingLimit
    && hasPriceDiscovery
    && activeRole
    && initiativeActive
    && maAligned
    && liquidity.status === "sufficient"
    && !fatalCurrentBreak;

  return {
    qualified,
    label: qualified ? "当日主动高度载体" : "短线载体未完整确认",
    verifiedClosingLimit,
    sessionDateAligned,
    hasPriceDiscovery,
    activeRole,
    initiativeActive,
    initiativeScore,
    maAligned,
    liquidityStatus: liquidity.status,
    fatalCurrentBreak,
    riskOnly: qualified && (kp.ma5Rising === false || kp.structureBreak === true),
    reasons: [
      verifiedClosingLimit ? "已验证当日真实收盘涨停" : "未验证当日收盘涨停",
      hasPriceDiscovery ? "非一字且有价格发现" : "缺少价格发现",
      activeRole && initiativeActive ? `当日主动高度载体，主动性${initiativeScore}分` : "当日主动载体未确认",
      maAligned ? "收盘及5/10/20日成本结构未破" : "短期成本结构未通过",
      liquidity.status === "sufficient" ? "当日成交充分" : "当日成交未确认充分",
    ],
  };
}

function computeMaProfile(rows) {
  if (!Array.isArray(rows) || rows.length < 22) return null;
  const closes = rows.map((r) => Number(r.close));
  const amounts = rows.map((r) => Number(r.amount) || 0);
  const maAt = (n, offset) => {
    const end = closes.length - offset;
    const start = end - n;
    if (start < 0) return null;
    return avg(closes.slice(start, end));
  };
  const ma5 = maAt(5, 0);
  const ma10 = maAt(10, 0);
  const ma20 = maAt(20, 0);
  const ma5p1 = maAt(5, 1);
  const ma5p2 = maAt(5, 2);
  const ma5Rising = ma5 != null && ma5p1 != null && ma5p2 != null && ma5 > ma5p1 && ma5p1 > ma5p2;
  const avgAmount5Yi = avg(amounts.slice(-5)) / 1e8;

  let longBearBreak3d = false;
  const startIdx = rows.length - 3;
  for (let idx = Math.max(0, startIdx); idx < rows.length; idx++) {
    const r = rows[idx];
    const body = r.open ? ((Number(r.open) - Number(r.close)) / Number(r.open)) * 100 : 0; // 正=阴线
    const prev5Amount = avg(amounts.slice(Math.max(0, idx - 5), idx));
    const volUp = prev5Amount ? amounts[idx] >= prev5Amount * 1.45 : false;
    const ma10AtIdx = idx >= 9 ? avg(closes.slice(idx - 9, idx + 1)) : null;
    const brokeMa10 = ma10AtIdx != null ? Number(r.close) < ma10AtIdx : false;
    if (body >= 4 && volUp && brokeMa10) longBearBreak3d = true;
  }

  return {
    ma5: round2(ma5),
    ma10: round2(ma10),
    ma20: round2(ma20),
    ma5Rising,
    longBearBreak3d,
    avgAmount5Yi: round2(avgAmount5Yi),
    lastClose: closes[closes.length - 1],
  };
}

function hardGate(stock, context = {}) {
  const hardFails = [];
  const softFlags = [];
  const kp = stock && stock.klineProfile;
  if (!kp) {
    return { pass: false, hardFails: ["缺K线无法验证趋势结构"], softFlags: [], metrics: {} };
  }
  const newListingMode = Boolean(kp.isNewListing || (Number.isFinite(Number(kp.tradingDays)) && Number(kp.tradingDays) < 60));
  if (!newListingMode && (kp.ma5 == null || kp.ma10 == null || kp.ma20 == null)) {
    return { pass: false, hardFails: ["缺K线无法验证趋势结构"], softFlags: [], metrics: {} };
  }
  const liquidity = evaluateAdaptiveLiquidity(stock, context);
  const shortTermCarrier = evaluateShortTermActiveCarrier(stock, { ...context, liquidity });
  if (newListingMode) {
    // 次新股没有完整均线，改用真实换手后的近期成本来判断筹码是否完成重置。
    if (kp.newStockDistributionRisk || kp.newStockChipState === "高换手派发风险") {
      hardFails.push("次新高换手后跌破近期成交成本，存在派发风险");
    }
    if (kp.structureBreak || kp.longBearBreak3d) hardFails.push("次新股近期结构已破坏");
    if (
      Number.isFinite(Number(kp.lastClose))
      && Number.isFinite(Number(kp.recentWeightedCost))
      && Number(kp.lastClose) < Number(kp.recentWeightedCost) * 0.94
    ) {
      hardFails.push("次新股收盘明显低于近期换手成本");
    }
    if (kp.newStockChipState === "次新筹码待验证" || kp.newStockChipState === "筹码待交换") {
      softFlags.push("次新筹码交换尚未完成，等待成本承接确认");
    } else if (kp.newStockChipState === "筹码快速重置") {
      softFlags.push("次新高换手已快速重置，按近期成本而非60日高点判断");
    }
  } else {
    // 成熟股票继续使用趋势结构硬门槛。
    if (!(kp.lastClose > kp.ma5)) hardFails.push("收盘价未站上5日线");
    if (!(kp.ma5 > kp.ma10 && kp.ma10 > kp.ma20)) hardFails.push("均线非多头排列(5>10>20)");
    if (!kp.ma5Rising) {
      if (shortTermCarrier.qualified) {
        softFlags.push("5日线斜率尚未转正，但当日主动高度载体的短期成本结构未破；只限制追高");
      } else {
        hardFails.push("5日线未持续向上");
      }
    }
    if (kp.longBearBreak3d) hardFails.push("近3日存在放量长阴破位");
  }
  const lastSession = kp.lastSession || {};
  if (lastSession.closedAtLimit === true && lastSession.oneWord === true) {
    hardFails.push("一字锁板，缺少价格发现");
  } else if (lastSession.closedAtLimit === true && lastSession.noPriceDiscovery === true) {
    hardFails.push("收盘涨停但缺少价格发现");
  }
  // 资金活跃度
  if (!(kp.avgAmount5Yi > 5)) hardFails.push(`5日均成交额${kp.avgAmount5Yi}亿不足5亿`);
  // 自适应成交活跃度：绝对成交额、流通盘和自身历史交叉验证。
  if (liquidity.status === "insufficient") {
    hardFails.push(`成交活跃度不足：${liquidity.reasons.join("；")}`);
  } else if (liquidity.status === "uncertain") {
    softFlags.push(`成交活跃度待确认：${liquidity.reasons.join("；")}`);
  } else if (Number.isFinite(stock.turnoverRate) && stock.turnoverRate > 0 && stock.turnoverRate < 8) {
    softFlags.push(`换手${stock.turnoverRate}%偏低但容量成交充分，不作硬性淘汰`);
  }
  const newStockResetVolumeRelax = Boolean(
    newListingMode
    && kp.newStockChipState === "筹码快速重置"
    && !kp.newStockDistributionRisk
    && !kp.structureBreak
    && Number(kp.effectiveTurnover5 || 0) >= 70
    && Number(kp.closeToCostPct || 0) >= -3
    && Number(stock.turnoverRate || 0) >= 20
    && liquidity.status === "sufficient"
    && Number(liquidity.metrics && liquidity.metrics.amountVsHistory || 0) >= 0.9
  );
  // 量比：用 Number.isFinite 检测有效值（Number(undefined)=NaN 不应硬拒，应软标）
  const volumeFloor = Number.isFinite(Number(context.volumeRatioFloor)) ? Number(context.volumeRatioFloor) : 1.2;
  const coreVolumeRelax = Boolean(context.coreVolumeRelax);
  if (!Number.isFinite(stock.volumeRatio) || stock.volumeRatio === 0) {
    softFlags.push("量比数据待确认");
  } else if (stock.volumeRatio >= volumeFloor) {
    // pass
  } else if (coreVolumeRelax && stock.volumeRatio >= 1) {
    softFlags.push(`量比${stock.volumeRatio}偏低，核心票观察`);
  } else if (newStockResetVolumeRelax && stock.volumeRatio >= 1) {
    softFlags.push(`量比${stock.volumeRatio}未达普通股放量线，但次新筹码已充分交换且成交未缩，保留观察`);
  } else {
    softFlags.push(`量比${stock.volumeRatio}低于${volumeFloor}，参与价值降分，不作硬性淘汰`);
  }
  // 资金流向：净流出只是待解释现象，绝不能单项硬淘汰。
  let flowNature = null;
  if (!Number.isFinite(stock.mainInflowYi) || stock.mainInflowYi === 0) {
    softFlags.push("主力净流入待确认");
  } else if (stock.mainInflowYi < 0) {
    flowNature = classifyFundFlow(stock, {
      marketState: context.marketState || {},
      limitStats: context.limitStats || {},
      directionStats: context.directionStats || {},
    });
    if (flowNature.key === "escape" && flowNature.confidence >= 0.68) {
      hardFails.push(`资金出逃：${flowNature.evidence.slice(1).join("；")}`);
    } else if (flowNature.key === "realization") {
      softFlags.push("资金兑现：保留核心，等待次日回流确认");
    } else {
      softFlags.push("净流出性质待确认，不作单项淘汰");
    }
  }
  return {
    pass: hardFails.length === 0,
    hardFails,
    softFlags,
    metrics: {
      ma5: kp.ma5, ma10: kp.ma10, ma20: kp.ma20,
      avgAmount5Yi: kp.avgAmount5Yi,
      volumeRatio: Number.isFinite(stock.volumeRatio) ? stock.volumeRatio : null,
      mainInflowYi: Number.isFinite(stock.mainInflowYi) ? stock.mainInflowYi : null,
      liquidity,
      flowNature,
      newListingMode,
      newStockChipState: newListingMode ? kp.newStockChipState || "次新筹码待验证" : null,
      recentWeightedCost: newListingMode && Number.isFinite(Number(kp.recentWeightedCost)) ? Number(kp.recentWeightedCost) : null,
      effectiveTurnover5: newListingMode && Number.isFinite(Number(kp.effectiveTurnover5)) ? Number(kp.effectiveTurnover5) : null,
      newStockResetVolumeRelax,
      shortTermCarrier,
    },
  };
}

function classifySubPhase(cycle, limitStats) {
  cycle = normalizeBigCycle(cycle);
  if (!cycle) return { subPhase: "周期待确认", reasons: ["输入不属于统一五态大周期"] };
  if (cycle !== "主升") return { subPhase: cycle, reasons: [] };
  if (!limitStats || !limitStats.ztToday) {
    return { subPhase: "主升中", reasons: ["涨跌停数据缺失，默认主升中"] };
  }
  const zt = limitStats.ztToday;
  const ztPrev = limitStats.ztPrev || zt;
  const ztHistory = limitStats.ztHistory || zt;
  const dt = limitStats.dtToday || 0;
  const zbRate = ztHistory > 0 ? (ztHistory - zt) / ztHistory : 0; // 炸板率
  if (zbRate >= 0.25 || dt >= 10) {
    return { subPhase: "高位分歧", reasons: [`炸板率${Math.round(zbRate * 100)}%偏高/跌停${dt}抬头`] };
  }
  if (zt >= ztPrev * 1.1 && zbRate < 0.15) {
    return { subPhase: "高潮加速", reasons: [`涨停${ztPrev}→${zt}放大且炸板率${Math.round(zbRate * 100)}%低`] };
  }
  return { subPhase: "主升中", reasons: ["主升延续，未见加速或分歧"] };
}

function tradeMode(info) {
  const { role, ticketType, wave } = info || {};
  if (ticketType === "容量票" || ["二波突破", "二波趋势重建", "三波/高位趋势"].includes(wave)) return "趋势";
  if (role === "龙头") return "打板";
  return "低吸";
}

const SPL_BASE = {
  打板: { sl: [-5, -3], slBasis: "跌破分时均价线或次日不及预期", tp: [5, 10], tpBasis: "次日冲高溢价兑现，分歧不接最后一棒" },
  低吸: { sl: [-4, -2], slBasis: "跌破买入参考(MA5/分时均价)", tp: [8, 15], tpBasis: "反包回封或到目标位分批" },
  趋势: { sl: [-8, -5], slBasis: "跌破MA5(趋势止损看MA10)", tp: [15, 25], tpBasis: "高潮加速分歧/MA5走平分批兑现" },
};

function stopProfitLoss(mode, marketState) {
  const base = SPL_BASE[mode] || SPL_BASE["低吸"];
  let sl = base.sl.slice();
  let tp = base.tp.slice();
  let slBasis = base.slBasis;
  let tpBasis = base.tpBasis;
  const cycle = normalizeBigCycle(marketState && (marketState.structuralCycle || marketState.cycle));
  const sub = marketState && marketState.subPhase;

  if (cycle === "主升" && sub !== "高潮加速" && sub !== "高位分歧") {
    tp = [tp[0], round1(tp[1] * 1.2)];
    tpBasis += "；主升进攻可放宽持有";
  }
  if (sub === "高潮加速") {
    tp = [round1(tp[0] * 0.7), round1(tp[1] * 0.7)];
    tpBasis = "高潮加速锁利，见好就收不接最后一棒";
  }
  if (sub === "高位分歧") {
    sl = [-2, -1];
    slBasis = "高位分歧止损上移至成本/分时均价，减仓为主";
  }
  if (cycle === "震荡" || cycle === "混沌") {
    sl = [round1(sl[0] * 0.7), sl[1]];
    tp = [tp[0], round1(tp[1] * 0.8)];
    tpBasis += "；震荡/混沌期小仓试错，区间收窄";
  }
  if (cycle === "退潮" || cycle === "冰点") {
    sl = [-3, -2];
    slBasis = "退潮/冰点破位即走，优先空仓";
    tp = [tp[0], round1(tp[1] * 0.6)];
  }
  const midSl = Math.abs((sl[0] + sl[1]) / 2);
  const midTp = (tp[0] + tp[1]) / 2;
  return {
    mode,
    stopLoss: { range: sl, basis: slBasis },
    takeProfit: { range: tp, basis: tpBasis },
    position: (marketState && marketState.position) || "—",
    riskReward: midSl ? round1(midTp / midSl) : null,
  };
}

module.exports = {
  computeMaProfile,
  hardGate,
  evaluateAdaptiveLiquidity,
  evaluateOpportunityDataCompleteness,
  evaluateShortTermActiveCarrier,
  avg,
  round1,
  round2,
  classifySubPhase,
  tradeMode,
  stopProfitLoss,
};
