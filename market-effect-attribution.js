"use strict";

const ATTRIBUTION_VERSION = 1;

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function signedPercent(value, digits = 2) {
  const number = finite(value);
  if (number === null) return "—";
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function ratioPercent(value) {
  const number = finite(value);
  if (number === null) return null;
  const normalized = number > 1 ? number : number * 100;
  return Math.round(normalized);
}

function leadershipOf(stock) {
  if (!stock || typeof stock !== "object") return {};
  if (stock.leadership && typeof stock.leadership === "object") return stock.leadership;
  return stock;
}

function initiativeOf(stock) {
  const leadership = leadershipOf(stock);
  return leadership.initiative && typeof leadership.initiative === "object"
    ? leadership.initiative
    : {};
}

function structureOf(stock) {
  const leadership = leadershipOf(stock);
  if (leadership.structure && typeof leadership.structure === "object") return leadership.structure;
  return stock && stock.klineProfile && typeof stock.klineProfile === "object"
    ? stock.klineProfile
    : {};
}

function profileOf(stock) {
  return stock && stock.klineProfile && typeof stock.klineProfile === "object"
    ? stock.klineProfile
    : {};
}

function stockKey(stock) {
  return String(stock && (stock.code || stock.secCode || stock.name) || "");
}

function dedupeStocks(rows, limit = 6) {
  const seen = new Set();
  const result = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = stockKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(row);
    if (result.length >= limit) break;
  }
  return result;
}

function stockView(stock, typeLabel) {
  if (!stock) return null;
  const leadership = leadershipOf(stock);
  const initiative = initiativeOf(stock);
  const structure = structureOf(stock);
  const profile = profileOf(stock);
  const changePct = round2(stock.changePct);
  const relativeStrength = round1(initiative.relativeStrength);
  const followerCount = finite(initiative.followerCount);
  const evidence = [];

  if (changePct !== null) evidence.push(`当日${signedPercent(changePct, 1)}`);
  if (relativeStrength !== null) {
    evidence.push(`${relativeStrength >= 0 ? "强于" : "弱于"}方向中位数${Math.abs(relativeStrength).toFixed(1)}个百分点`);
  }
  if (initiative.firstAttackTime) evidence.push(`${initiative.firstAttackTime}进入进攻区`);
  if (followerCount !== null && followerCount > 0) evidence.push(`带动${followerCount}只同方向标的跟随`);
  if (finite(stock.amountYi) !== null) evidence.push(`成交${round1(stock.amountYi)}亿`);
  if (structure.isNewListing === true || profile.isNewListing === true) {
    const tradingDays = finite(structure.tradingDays) ?? finite(profile.tradingDays);
    evidence.push(tradingDays !== null ? `上市${tradingDays}个交易日` : "次新筹码定价");
  }

  return {
    code: String(stock.code || stock.secCode || ""),
    name: String(stock.name || stock.code || "--"),
    concept: String(stock.mainConcept || stock.concept || leadership.concept || ""),
    changePct,
    amountYi: round1(stock.amountYi),
    typeLabel: typeLabel || "",
    role: String(leadership.identity || stock.role || "观察"),
    initiativeLabel: String(initiative.label || "主动性待确认"),
    initiativeScore: round1(initiative.score),
    proactive: initiative.proactive === true,
    followerCount,
    firstAttackTime: initiative.firstAttackTime || null,
    structureGrade: structure.grade || null,
    structureBreakdown: structure.breakdown === true || profile.structureBreak === true,
    positionLabel: structure.positionLabel || null,
    isNewListing: structure.isNewListing === true || profile.isNewListing === true,
    tradeQualified: leadership.tradeQualified === true,
    coreQualified: leadership.coreQualified === true,
    flowNature: stock.flowNature && typeof stock.flowNature === "object"
      ? {
        key: stock.flowNature.key || "unknown",
        label: stock.flowNature.label || "资金性质待确认",
      }
      : null,
    evidence: evidence.slice(0, 5),
  };
}

function stockReference(stock, note = "") {
  if (!stock) return null;
  return {
    code: String(stock.code || stock.secCode || ""),
    name: String(stock.name || stock.code || "--"),
    changePct: round2(stock.changePct),
    note: String(note || ""),
  };
}

function directionName(direction) {
  return String(direction && (direction.name || direction.family || direction.displayName) || "");
}

function directionStats(direction) {
  const stats = direction && direction.memberStats && typeof direction.memberStats === "object"
    ? direction.memberStats
    : {};
  const sampleCount = finite(stats.sampleCount) ?? finite(direction && direction.count);
  const avgChangePct = round2(stats.avgChangePct);
  const medianChangePct = round2(stats.medianChangePct);
  const upRate = ratioPercent(stats.upRate);
  const downRate = ratioPercent(stats.downRate);
  const strongCount = finite(stats.strongCount);
  const directionState = direction && direction.directionState && typeof direction.directionState === "object"
    ? direction.directionState
    : {};
  const sectorChangePct = round2(
    direction && direction.sectorChangePct !== undefined
      ? direction.sectorChangePct
      : direction && direction.sector && direction.sector.changePct,
  );

  let breadthLabel = "覆盖待确认";
  if (upRate !== null && upRate >= 60 && medianChangePct !== null && medianChangePct > 0) breadthLabel = "板块广泛赚钱";
  else if (upRate !== null && upRate >= 40) breadthLabel = "板块内部强分化";
  else if (upRate !== null) breadthLabel = "少数活口、覆盖较窄";

  const dailyKey = String(directionState.dailyKey || "");
  let status = "mixed";
  if (dailyKey === "profit" || (upRate !== null && upRate >= 55 && medianChangePct !== null && medianChangePct > 0)) status = "profit";
  if (dailyKey === "loss" || (downRate !== null && downRate >= 60) || (medianChangePct !== null && medianChangePct <= -2)) status = "loss";

  return {
    name: directionName(direction),
    family: String(direction && direction.family || ""),
    sampleCount,
    avgChangePct,
    medianChangePct,
    upRate,
    downRate,
    strongCount,
    sectorChangePct,
    breadthLabel,
    status,
    isCoreDirection: directionState.isCoreDirection === true || direction && direction.isCoreDirection === true,
    resonanceLabel: directionState.resonanceLabel || direction && direction.resonanceLabel || "共振待验证",
    sampleQuality: sampleCount !== null && sampleCount >= 5 ? "有效样本" : "小样本观察",
  };
}

function directionTokens(direction) {
  const values = [
    directionName(direction),
    direction && direction.family,
    ...(Array.isArray(direction && direction.aliases) ? direction.aliases : []),
    ...(Array.isArray(direction && direction.matchNames) ? direction.matchNames : []),
  ];
  return values.map((value) => String(value || "").trim()).filter(Boolean);
}

function stockMatchesDirection(stock, direction) {
  if (!stock || !direction) return false;
  const text = [
    stock.mainConcept,
    stock.mainFamily,
    stock.concept,
    stock.topic,
    ...(Array.isArray(stock.concepts) ? stock.concepts : []),
  ].map((value) => String(value || "")).filter(Boolean).join(" ");
  return directionTokens(direction).some((token) => text.includes(token) || token.includes(text));
}

function groupStats(rows) {
  const changes = rows.map((row) => finite(row && row.changePct)).filter((value) => value !== null);
  if (!changes.length) {
    return { count: rows.length, pricedCount: 0, positiveCount: 0, negativeCount: 0, positiveRate: null, avgChangePct: null };
  }
  return {
    count: rows.length,
    pricedCount: changes.length,
    positiveCount: changes.filter((value) => value > 0).length,
    negativeCount: changes.filter((value) => value <= -3).length,
    positiveRate: Math.round((changes.filter((value) => value > 0).length / changes.length) * 100),
    avgChangePct: round1(changes.reduce((sum, value) => sum + value, 0) / changes.length),
  };
}

function classifyShortTermState(coreRows, activeRows, tradeableRows, focusStats) {
  const stats = groupStats(coreRows);
  const focusUpRate = focusStats && focusStats.upRate;
  const focusMedian = focusStats && focusStats.medianChangePct;
  const broadDirectionProfit = focusUpRate !== null && focusUpRate >= 55
    && focusMedian !== null && focusMedian > 0;

  if (stats.pricedCount >= 3 && stats.negativeCount >= Math.ceil(stats.pricedCount / 2) && !activeRows.length) {
    return {
      key: "core_negative",
      label: "短线核心负反馈",
      tone: "bad",
      summary: `${stats.negativeCount}只核心明显转弱，尚未出现有带动性的主动修复。`,
    };
  }
  if (activeRows.length && (!broadDirectionProfit || stats.negativeCount >= 2)) {
    return {
      key: "narrow_repair",
      label: "短线主线强分化",
      tone: "warn",
      summary: `${activeRows.length}只主动核心走强，但方向覆盖仍窄，${stats.negativeCount}只核心存在明显负反馈。`,
    };
  }
  if (activeRows.length >= 2 && broadDirectionProfit && stats.positiveRate !== null && stats.positiveRate >= 60) {
    return {
      key: "core_strengthening",
      label: "短线核心共振加强",
      tone: "good",
      summary: "主动核心、方向中位数和上涨覆盖率同时转强。",
    };
  }
  if (tradeableRows.length) {
    return {
      key: "tradeable_narrow",
      label: "少数核心可交易",
      tone: "warn",
      summary: `只有${tradeableRows.length}只核心同时通过主动性与交易载体门槛，尚未形成全面扩散。`,
    };
  }
  return {
    key: "mixed",
    label: "短线情绪分化",
    tone: "warn",
    summary: "赚钱和亏钱方向同时存在，等待主动核心与方向扩散进一步确认。",
  };
}

function buildMarketEffectAttribution(payload = {}) {
  const market = payload.market && typeof payload.market === "object" ? payload.market : {};
  const state = market.state && typeof market.state === "object" ? market.state : {};
  const snapshot = market.snapshot && typeof market.snapshot === "object" ? market.snapshot : {};
  const limitStats = market.limitStats && typeof market.limitStats === "object" ? market.limitStats : {};
  const candidates = Array.isArray(payload.candidates) ? payload.candidates.filter(Boolean) : [];
  const candidateByCode = new Map(candidates.map((stock) => [stockKey(stock), stock]));
  const candidateByName = new Map(candidates.map((stock) => [String(stock.name || ""), stock]));
  const boardLeaders = payload.leadershipBoard && Array.isArray(payload.leadershipBoard.leaders)
    ? payload.leadershipBoard.leaders
    : [];
  const boardCoreRows = boardLeaders.map((leader) => (
    candidateByCode.get(stockKey(leader)) || candidateByName.get(String(leader.name || "")) || leader
  ));
  const retainedCoreRows = candidates.filter((stock) => {
    const leadership = leadershipOf(stock);
    return leadership.coreIdentityQualified === true
      || leadership.persistentRecognition === true
      || leadership.repairCoreQualified === true;
  });
  const coreRows = dedupeStocks([...boardCoreRows, ...retainedCoreRows], 24);
  const directionSource = payload.topicBoard && Array.isArray(payload.topicBoard.items) && payload.topicBoard.items.length
    ? payload.topicBoard.items
    : Array.isArray(payload.hotConcepts) ? payload.hotConcepts : [];
  const directions = directionSource.map((direction) => ({
    raw: direction,
    ...directionStats(direction),
  }));
  const mainLineRaw = payload.topicBoard && payload.topicBoard.mainLine
    ? payload.topicBoard.mainLine
    : directionSource.find((direction) => direction && direction.isCoreDirection) || directionSource[0] || null;
  const focusName = directionName(mainLineRaw) || String(payload.leadershipBoard && payload.leadershipBoard.focusDirection || "");
  const focusDirection = directions.find((direction) => direction.name === focusName)
    || directions.find((direction) => direction.isCoreDirection)
    || null;
  const focusRaw = focusDirection && focusDirection.raw || mainLineRaw;

  const focusCoreRows = coreRows.filter((stock) => stockMatchesDirection(stock, focusRaw));
  const priceDiscoveryAnchors = candidates.filter((stock) => {
    const profile = profileOf(stock);
    const structure = structureOf(stock);
    const leadership = leadershipOf(stock);
    return (profile.isNewListing === true || structure.isNewListing === true)
      && finite(stock.amountYi) !== null
      && finite(stock.amountYi) >= 100
      && finite(stock.changePct) !== null
      && Math.abs(finite(stock.changePct)) >= 3
      && (leadership.persistentRecognition === true || initiativeOf(stock).proactive === true);
  });
  const shortCoreRows = dedupeStocks([...focusCoreRows, ...priceDiscoveryAnchors], 24);
  const activeRows = focusCoreRows.filter((stock) => {
    const initiative = initiativeOf(stock);
    const structure = structureOf(stock);
    return finite(stock.changePct) !== null
      && finite(stock.changePct) >= 3
      && initiative.proactive === true
      && structure.breakdown !== true
      && profileOf(stock).structureBreak !== true;
  });
  const tradeableRows = coreRows.filter((stock) => {
    const leadership = leadershipOf(stock);
    return leadership.tradeQualified === true || leadership.coreQualified === true;
  });
  const negativeCoreRows = shortCoreRows.filter((stock) => finite(stock.changePct) !== null && finite(stock.changePct) <= -3);
  const shortTermState = classifyShortTermState(
    shortCoreRows,
    activeRows,
    tradeableRows,
    focusDirection,
  );

  const usedProfitCodes = new Set();
  const takeProfitRows = (rows, limit = 4) => {
    const unique = dedupeStocks(rows, 12).filter((row) => !usedProfitCodes.has(stockKey(row))).slice(0, limit);
    unique.forEach((row) => usedProfitCodes.add(stockKey(row)));
    return unique;
  };
  const sortStrength = (a, b) => (
    finite(b.changePct) - finite(a.changePct)
    || finite(b.amountYi) - finite(a.amountYi)
  );

  const mainlineActive = takeProfitRows(activeRows.slice().sort(sortStrength));
  const newPricing = takeProfitRows(candidates.filter((stock) => {
    const profile = profileOf(stock);
    const structure = structureOf(stock);
    return (profile.isNewListing === true || structure.isNewListing === true)
      && finite(stock.changePct) !== null
      && finite(stock.changePct) >= 3
      && finite(stock.amountYi) !== null
      && finite(stock.amountYi) >= 100;
  }).sort(sortStrength));
  const oversoldRepair = takeProfitRows(candidates.filter((stock) => {
    const profile = profileOf(stock);
    const structure = structureOf(stock);
    const leadership = leadershipOf(stock);
    const oversold = structure.breakdown === true
      || profile.structureBreak === true
      || (finite(profile.rise20) !== null && finite(profile.rise20) <= -10)
      || (finite(profile.pctFromHigh) !== null && finite(profile.pctFromHigh) >= 25);
    const recognizable = leadership.coreIdentityQualified === true
      || leadership.persistentRecognition === true
      || leadership.repairCoreQualified === true
      || stock.inBothSources === true
      || (finite(stock.amountYi) !== null && finite(stock.amountYi) >= 50);
    return oversold && recognizable && finite(stock.changePct) !== null && finite(stock.changePct) >= 3;
  }).sort((a, b) => {
    const aLead = leadershipOf(a);
    const bLead = leadershipOf(b);
    const aPriority = (stockMatchesDirection(a, focusRaw) ? 1000 : 0)
      + (aLead.coreIdentityQualified === true ? 300 : 0)
      + (aLead.repairCoreQualified === true ? 600 : 0)
      + (initiativeOf(a).proactive === true ? 160 : 0)
      + (finite(initiativeOf(a).score) || 0) * 5
      + (finite(a.amountYi) || 0) / 50;
    const bPriority = (stockMatchesDirection(b, focusRaw) ? 1000 : 0)
      + (bLead.coreIdentityQualified === true ? 300 : 0)
      + (bLead.repairCoreQualified === true ? 600 : 0)
      + (initiativeOf(b).proactive === true ? 160 : 0)
      + (finite(initiativeOf(b).score) || 0) * 5
      + (finite(b.amountYi) || 0) / 50;
    return bPriority - aPriority || sortStrength(a, b);
  }));
  const highCrowding = takeProfitRows(coreRows.filter((stock) => {
    const profile = profileOf(stock);
    const leadership = leadershipOf(stock);
    return leadership.coreIdentityQualified === true
      && finite(stock.changePct) !== null
      && finite(stock.changePct) >= 3
      && (profile.newHigh === true || profile.nearHigh20 === true || (finite(profile.pctFromHigh) !== null && finite(profile.pctFromHigh) <= 10));
  }).sort(sortStrength));
  const capacityTrend = takeProfitRows(candidates.filter((stock) => {
    const structure = structureOf(stock);
    const profile = profileOf(stock);
    return finite(stock.amountYi) !== null
      && finite(stock.amountYi) >= 100
      && finite(stock.changePct) !== null
      && finite(stock.changePct) >= 2
      && structure.breakdown !== true
      && profile.structureBreak !== true
      && profile.isNewListing !== true;
  }).sort(sortStrength));

  const rotationDirections = directions.filter((direction) => (
    direction.name !== focusName
    && direction.status === "profit"
    && direction.sampleCount !== null
    && direction.sampleCount >= 2
  )).slice(0, 4);
  const rotationStocks = takeProfitRows(candidates.filter((stock) => (
    rotationDirections.some((direction) => stockMatchesDirection(stock, direction.raw))
    && finite(stock.changePct) !== null
    && finite(stock.changePct) > 0
  )).sort(sortStrength));

  const profitGroups = [
    {
      key: "mainline-active",
      title: "主线主动活口",
      status: mainlineActive.length ? "strong" : "unverified",
      summary: mainlineActive.length
        ? "方向多数尚未转强，但这些股票率先发起并保留主动性。"
        : "暂未找到同时具备主线身份、主动发起和完整结构的样本。",
      items: mainlineActive.map((stock) => stockView(stock, "主动活口")),
    },
    {
      key: "new-pricing",
      title: "次新情绪定价 / 容量虹吸",
      status: newPricing.length ? "strong" : "unverified",
      summary: newPricing.length
        ? "高换手次新以流动性和价格发现形成独立情绪中心，不等同于板块普涨。"
        : "暂未形成高成交、强承接的次新定价核心。",
      items: newPricing.map((stock) => stockView(stock, "次新定价")),
    },
    {
      key: "oversold-repair",
      title: "低位超跌 / 破位修复",
      status: oversoldRepair.length ? "mixed" : "unverified",
      summary: oversoldRepair.length
        ? "上涨更多来自跌深后的修复，持续性需要重新站回关键成本区验证。"
        : "暂未发现具有代表性的超跌修复样本。",
      items: oversoldRepair.map((stock) => stockView(stock, "超跌修复")),
    },
    {
      key: "high-crowding",
      title: "高位核心抱团",
      status: highCrowding.length ? "strong" : "unverified",
      summary: highCrowding.length
        ? "高辨识度核心仍在前高或新高区域形成正反馈。"
        : "高位核心抱团尚未获得足够证据，不能由涨停总数反推成立。",
      items: highCrowding.map((stock) => stockView(stock, "高位抱团")),
    },
    {
      key: "capacity-trend",
      title: "容量趋势承接",
      status: capacityTrend.length ? "strong" : "unverified",
      summary: capacityTrend.length
        ? "大成交核心维持完整结构并获得增量承接。"
        : "暂未确认结构完整、成交充分且同步走强的容量趋势核心。",
      items: capacityTrend.map((stock) => stockView(stock, "容量趋势")),
    },
    {
      key: "rotation",
      title: "轮动试错",
      status: rotationDirections.length ? "mixed" : "unverified",
      summary: rotationDirections.length
        ? `${rotationDirections.map((item) => item.name).join("、")}出现赚钱样本，但${rotationDirections.some((item) => item.sampleQuality === "小样本观察") ? "部分方向样本较少，只能按轮动观察" : "尚未升级为主线"}。`
        : "非主线方向暂未形成可验证的轮动赚钱样本。",
      directions: rotationDirections.map(({ raw, ...direction }) => direction),
      items: rotationStocks.map((stock) => stockView(stock, "轮动试错")),
    },
  ];

  const lossDirections = directions.filter((direction) => direction.status === "loss").slice(0, 5);
  const crossMarketNegativeCoreRows = coreRows.filter((stock) => (
    finite(stock.changePct) !== null && finite(stock.changePct) <= -3
  ));
  const oldCoreLosses = dedupeStocks([
    ...negativeCoreRows,
    ...crossMarketNegativeCoreRows,
  ], 24).sort((a, b) => {
    const focusDiff = Number(stockMatchesDirection(b, focusRaw)) - Number(stockMatchesDirection(a, focusRaw));
    if (focusDiff) return focusDiff;
    const identityDiff = Number(leadershipOf(b).coreIdentityQualified === true)
      - Number(leadershipOf(a).coreIdentityQualified === true);
    return identityDiff || finite(a.changePct) - finite(b.changePct);
  });
  const limitDownToday = finite(limitStats.dtToday);
  const limitDownPrevious = finite(limitStats.dtPrev);
  const limitDownContracting = limitDownToday !== null && limitDownPrevious !== null && limitDownToday < limitDownPrevious;
  const lossGroups = [
    {
      key: "extreme-feedback",
      title: "全市场极端负反馈",
      status: limitDownContracting ? "contracting" : limitDownToday !== null && limitDownToday >= 15 ? "expanding" : "mixed",
      summary: limitDownToday === null
        ? "跌停数据缺失，不能判断极端负反馈是否收缩。"
        : limitDownPrevious === null
          ? `当日跌停${limitDownToday}只，缺少上一交易日对照。`
          : `跌停${limitDownPrevious}→${limitDownToday}，${limitDownContracting ? "极端负反馈明显收缩" : "极端负反馈尚未收缩"}。`,
      items: [],
    },
    {
      key: "old-core-loss",
      title: "近期 / 老核心负反馈",
      status: oldCoreLosses.length ? "mixed" : "contracting",
      summary: oldCoreLosses.length
        ? `${oldCoreLosses.length}只高辨识度核心明显转弱；这里只确认负反馈，兑现、被动下跌或出逃仍按个股证据区分。`
        : "近期高辨识度核心未出现成片明显转弱。",
      items: oldCoreLosses.slice(0, 10).map((stock) => stockView(stock, "核心负反馈")),
    },
    {
      key: "direction-loss",
      title: "方向内部亏钱",
      status: lossDirections.length ? "mixed" : "contracting",
      summary: lossDirections.length
        ? `${lossDirections.map((item) => item.name).join("、")}内部多数样本仍弱，不能用板块指数上涨代替个股赚钱。`
        : "当前方向样本未显示成片亏钱扩散。",
      directions: lossDirections.map(({ raw, ...direction }) => direction),
      items: [],
    },
  ];

  const positiveShortCoreRows = shortCoreRows
    .filter((stock) => finite(stock.changePct) !== null && finite(stock.changePct) > 0)
    .sort(sortStrength);
  const shortStrengthRows = activeRows.length ? activeRows : positiveShortCoreRows;
  const directionLossStocks = candidates
    .filter((stock) => (
      lossDirections.some((direction) => stockMatchesDirection(stock, direction.raw))
      && finite(stock.changePct) !== null
      && finite(stock.changePct) <= -3
    ))
    .sort((a, b) => finite(a.changePct) - finite(b.changePct));
  const marketProfitReferences = dedupeStocks([
    ...mainlineActive,
    ...newPricing,
    ...oversoldRepair,
    ...highCrowding,
    ...capacityTrend,
    ...rotationStocks,
  ], 4);
  const marketLossReferences = dedupeStocks([
    ...oldCoreLosses,
    ...directionLossStocks,
  ], 4);
  const scopeReferences = {
    market: [
      {
        label: "代表性赚钱标的",
        tone: "good",
        emptyText: "暂无足够证据的代表性赚钱标的",
        items: marketProfitReferences.map((stock) => stockReference(stock, "赚钱样本")),
      },
    ],
    shortCore: [
      {
        label: activeRows.length ? "当前方向主动强势侧" : "当前方向相对强势侧（主动性未确认）",
        tone: "good",
        emptyText: "暂无强势侧核心标的",
        items: shortStrengthRows.slice(0, 4).map((stock) => stockReference(
          stock,
          activeRows.length ? "主动走强" : "相对抗跌/上涨",
        )),
      },
      {
        label: "跨方向转弱 / 负反馈侧",
        tone: "bad",
        emptyText: "暂无明显转弱核心",
        items: oldCoreLosses.slice(0, 4).map((stock) => stockReference(stock, "核心负反馈")),
      },
    ],
    tradeable: [
      {
        label: "通过硬门槛",
        tone: tradeableRows.length ? "good" : "neutral",
        emptyText: "暂无同时通过主动性、核心地位和结构门槛的标的",
        items: tradeableRows.slice(0, 4).map((stock) => stockReference(stock, "仅代表交易资格")),
      },
    ],
    loss: [
      {
        label: "主要负反馈标的",
        tone: marketLossReferences.length ? "bad" : "good",
        emptyText: "暂无可确认的集中负反馈标的",
        items: marketLossReferences.map((stock) => stockReference(stock, "负反馈样本")),
      },
    ],
  };

  const focusStats = focusDirection || {
    name: focusName || "当前主线",
    sampleCount: null,
    medianChangePct: null,
    upRate: null,
    downRate: null,
    breadthLabel: "覆盖待确认",
    resonanceLabel: "共振待验证",
  };
  const coreStats = groupStats(shortCoreRows);
  const activeNames = activeRows.slice(0, 4).map((stock) => stock.name).filter(Boolean);
  const relativeStrongNames = shortStrengthRows.slice(0, 4).map((stock) => stock.name).filter(Boolean);
  const negativeNames = oldCoreLosses.slice(0, 5).map((stock) => stock.name).filter(Boolean);
  const upCount = finite(snapshot.upCount);
  const downCount = finite(snapshot.downCount);
  const avgIndexChange = round1(snapshot.avgIndexChange);
  const amountYi = round1(snapshot.shszAmountYi ?? snapshot.totalAmountYi);
  const profitEffect = state.profitEffect && typeof state.profitEffect === "object" ? state.profitEffect : {};
  const lossEffect = state.lossEffect && typeof state.lossEffect === "object" ? state.lossEffect : {};
  const dailyState = state.dailyState && typeof state.dailyState === "object" ? state.dailyState : {};
  const broadProfitScore = round1(profitEffect.score);
  const broadLossScore = round1(lossEffect.score);

  const proofLayers = [
    {
      key: "market",
      title: "市场层",
      status: dailyState.tone === "good" ? "pass" : dailyState.tone === "bad" ? "fail" : "mixed",
      label: dailyState.label || "今日状态待确认",
      evidence: [
        upCount !== null && downCount !== null ? `上涨${upCount}家、下跌${downCount}家` : "涨跌家数待确认",
        finite(limitStats.ztToday) !== null ? `涨停${limitStats.ztPrev ?? "—"}→${limitStats.ztToday}，跌停${limitStats.dtPrev ?? "—"}→${limitStats.dtToday ?? "—"}` : "涨跌停对照待确认",
        avgIndexChange !== null ? `主要指数均值${signedPercent(avgIndexChange)}` : "指数均值待确认",
        amountYi !== null ? `两市成交${amountYi}亿` : "成交额待确认",
      ],
    },
    {
      key: "emotion",
      title: "短线情绪层",
      status: shortTermState.tone === "good" ? "pass" : shortTermState.tone === "bad" ? "fail" : "mixed",
      label: shortTermState.label,
      evidence: [
        `当前方向核心样本${coreStats.pricedCount}只，上涨${coreStats.positiveCount}只、明显负反馈${coreStats.negativeCount}只`,
        activeNames.length
          ? `主动走强：${activeNames.join("、")}`
          : relativeStrongNames.length
            ? `相对强势（主动性未确认）：${relativeStrongNames.join("、")}`
            : "暂无强势侧核心标的",
        negativeNames.length ? `跨方向核心负反馈：${negativeNames.join("、")}` : "跨方向核心负反馈未扩散",
      ],
    },
    {
      key: "direction",
      title: "主线方向层",
      status: focusStats.status === "profit" ? "pass" : focusStats.status === "loss" ? "fail" : "mixed",
      label: `${focusStats.name || focusName || "当前主线"} · ${focusStats.breadthLabel}`,
      evidence: [
        focusStats.sampleCount !== null ? `样本${focusStats.sampleCount}只` : "样本数待确认",
        focusStats.upRate !== null ? `上涨${focusStats.upRate}%、下跌${focusStats.downRate}%` : "上涨覆盖率待确认",
        focusStats.medianChangePct !== null ? `中位数${signedPercent(focusStats.medianChangePct)}` : "中位数待确认",
        focusStats.resonanceLabel || "板块共振待确认",
      ],
    },
    {
      key: "anchor",
      title: "核心锚点层",
      status: activeRows.length && negativeCoreRows.length ? "mixed" : activeRows.length ? "pass" : negativeCoreRows.length ? "fail" : "mixed",
      label: activeRows.length ? `${activeRows.length}只主动锚点，${negativeCoreRows.length}只负反馈锚点` : "主动锚点待确认",
      evidence: [
        activeNames.length ? `加强锚点：${activeNames.join("、")}` : "暂无加强锚点",
        negativeNames.length ? `反面锚点：${negativeNames.join("、")}` : "暂无明显反面锚点",
        tradeableRows.length ? `交易载体门槛通过${tradeableRows.length}只` : "情绪回暖尚未转化为合格交易载体",
      ],
    },
  ];

  const contradictions = [];
  if (broadProfitScore !== null && broadProfitScore >= 65 && focusStats.status === "loss") {
    contradictions.push(`全市场统计赚钱效应较强，但${focusStats.name || "主线"}内部仍是亏钱效应，不能把普涨直接等同于主线回暖。`);
  }
  if (activeRows.length && negativeCoreRows.length >= 2) {
    contradictions.push(`少数主动活口走强，同时${negativeCoreRows.length}只核心明显转弱，当前属于窄修复而非全面加强。`);
  }
  if (focusStats.sectorChangePct !== null && focusStats.sectorChangePct > 0
    && focusStats.medianChangePct !== null && focusStats.medianChangePct < 0) {
    contradictions.push(`${focusStats.name}板块指数上涨${signedPercent(focusStats.sectorChangePct)}，但成分中位数${signedPercent(focusStats.medianChangePct)}，存在权重/少数核心拉升与多数个股下跌的背离。`);
  }

  const profitLocations = profitGroups
    .filter((group) => group.items && group.items.length)
    .map((group) => group.title)
    .slice(0, 3);
  const lossLocations = lossGroups
    .filter((group) => group.status === "expanding" || group.status === "mixed")
    .map((group) => group.title)
    .slice(0, 3);

  return {
    version: ATTRIBUTION_VERSION,
    observationOnly: true,
    asOf: snapshot.asOf || payload.fetchedAt || payload.updatedAt || null,
    headline: `${dailyState.label || "市场状态待确认"}（市场层）· ${shortTermState.label}（短线层）`,
    summary: `市场统计与短线可交易效应分开判断。${profitLocations.length ? `赚钱集中在${profitLocations.join("、")}` : "赚钱位置尚未确认"}；${lossLocations.length ? `亏钱集中在${lossLocations.join("、")}` : "亏钱暂未形成明确集中方向"}。`,
    scopes: [
      {
        key: "market",
        title: "全市场统计赚钱效应",
        label: profitEffect.label || "待计算",
        score: broadProfitScore,
        tone: profitEffect.tone || "neutral",
        summary: "只描述涨停、市场广度、指数与成交，不直接等于短线可交易。",
        referenceGroups: scopeReferences.market,
      },
      {
        key: "short-core",
        title: "短线核心赚钱效应",
        label: shortTermState.label,
        score: null,
        tone: shortTermState.tone,
        summary: shortTermState.summary,
        referenceGroups: scopeReferences.shortCore,
      },
      {
        key: "tradeable",
        title: "可交易赚钱效应",
        label: tradeableRows.length ? `${tradeableRows.length}只通过硬门槛` : "暂无合格交易载体",
        score: null,
        tone: tradeableRows.length >= 2 ? "good" : tradeableRows.length ? "warn" : "bad",
        summary: tradeableRows.length
          ? `通过：${tradeableRows.slice(0, 4).map((stock) => stock.name).join("、")}；只代表资格，不自动等于买点。`
          : "市场回暖尚未转化为同时通过主动性、核心地位和结构门槛的标的。",
        referenceGroups: scopeReferences.tradeable,
      },
      {
        key: "loss",
        title: "全市场统计亏钱效应",
        label: lossEffect.label || "待计算",
        score: broadLossScore,
        tone: lossEffect.tone || "neutral",
        summary: "极端负反馈收缩不代表主线老核心已经止跌。",
        referenceGroups: scopeReferences.loss,
      },
    ],
    shortTermState,
    focusDirection: {
      name: focusStats.name || focusName || "当前主线",
      sampleCount: focusStats.sampleCount,
      avgChangePct: focusStats.avgChangePct,
      medianChangePct: focusStats.medianChangePct,
      upRate: focusStats.upRate,
      downRate: focusStats.downRate,
      breadthLabel: focusStats.breadthLabel,
      status: focusStats.status,
      resonanceLabel: focusStats.resonanceLabel,
    },
    proofLayers,
    profitMap: {
      headline: profitLocations.length ? `赚钱集中：${profitLocations.join("、")}` : "赚钱位置待确认",
      strengthLabel: profitEffect.label || "待计算",
      coverageLabel: focusStats.breadthLabel,
      continuityLabel: activeRows.length && focusStats.status !== "profit" ? "局部持续、等待扩散" : activeRows.length ? "主动核心与方向共振" : "持续性待确认",
      groups: profitGroups,
    },
    lossMap: {
      headline: lossLocations.length ? `亏钱集中：${lossLocations.join("、")}` : "亏钱位置待确认",
      overallLabel: lossEffect.label || "待计算",
      coreNegativeCount: oldCoreLosses.length,
      groups: lossGroups,
    },
    contradictions,
    validation: {
      upgrade: [
        `${focusStats.name || focusName || "主线"}上涨覆盖率提升至至少55%，且中位数由负转正`,
        "主动核心继续带动同方向跟随，近期/老核心止跌而不是继续批量掉队",
        "昨日强势核心获得真实次日溢价，成交承接不明显缩减",
      ],
      invalidate: [
        `${activeNames.length ? activeNames.join("、") : "主动核心"}快速转弱并失去带动性`,
        "跌停或炸板重新扩张，近期/老核心负反馈继续增加",
        `${focusStats.name || focusName || "主线"}仍只有少数股票上涨，方向中位数和上涨覆盖率没有改善`,
      ],
    },
  };
}

module.exports = {
  ATTRIBUTION_VERSION,
  buildMarketEffectAttribution,
  _internals: {
    directionStats,
    stockMatchesDirection,
    stockView,
    classifyShortTermState,
  },
};
