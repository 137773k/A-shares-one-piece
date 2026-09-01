"use strict";

const { isLimitUp, boardHeight } = require("./leader-select");

const LEADERSHIP_SCHEMA_VERSION = 7;

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function median(values) {
  const rows = (values || []).map(finite).filter((value) => value !== null).sort((a, b) => a - b);
  if (!rows.length) return 0;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
}

function percentile(values, ratio) {
  const rows = (values || []).map(finite).filter((value) => value !== null).sort((a, b) => a - b);
  if (!rows.length) return 0;
  const index = Math.max(0, Math.min(rows.length - 1, Math.round((rows.length - 1) * ratio)));
  return rows[index];
}

function timeToMinutes(value) {
  const match = String(value || "").match(/(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function minutesToTime(value) {
  if (!Number.isFinite(value)) return null;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

const INTRADAY_CLOSING_COMPLETE_MINUTE = 14 * 60 + 55;

function normalizeIntradayEvidenceSummary(summary) {
  if (!summary || typeof summary !== "object") return null;
  const source = String(summary.source || "intraday_provider");
  const providerQualityKey = source === "tencent_minute_query"
    ? "price_amount_series"
    : source === "eastmoney_trends2"
      ? "minute_ohlc_amount"
      : "legacy_intraday_unknown_fields";
  const asOfMinute = timeToMinutes(summary.asOf);
  const closingComplete = Number.isFinite(asOfMinute)
    && asOfMinute >= INTRADAY_CLOSING_COMPLETE_MINUTE;
  const sessionCompletenessKey = closingComplete ? "closing_complete" : "partial_session";
  const qualityKey = !closingComplete
    ? "partial_session"
    : providerQualityKey === "minute_ohlc_amount"
      ? "exact_closing_full_ohlc"
      : providerQualityKey === "price_amount_series"
        ? "exact_closing_price_series"
        : "exact_closing_legacy_unknown_fields";
  const qualityLabel = qualityKey === "exact_closing_full_ohlc"
    ? "完整分时验证"
    : qualityKey === "exact_closing_price_series"
      ? "价格序列分时验证"
      : qualityKey === "partial_session"
        ? "盘中部分分时验证"
        : "历史分时验证·字段待确认";
  const evidenceWeight = qualityKey === "exact_closing_full_ohlc" ? 1
    : qualityKey === "exact_closing_price_series" ? 0.85
      : qualityKey === "partial_session" ? 0.55 : 0.75;
  return {
    ...summary,
    evidenceQuality: {
      version: 1,
      qualityKey,
      qualityLabel,
      providerQualityKey,
      sessionCompletenessKey,
      closingComplete,
      asOfMinute: Number.isFinite(asOfMinute) ? asOfMinute : null,
      evidenceWeight,
      calibrated: false,
      rule: "完整OHLC、价格序列与盘中部分数据分级；盘中部分数据不能授予收盘交易资格",
    },
  };
}

function isClosingIntradayInitiative(initiative) {
  if (!initiative || typeof initiative !== "object") return false;
  const key = String(initiative.dataQualityKey || "");
  if (key) return key.startsWith("exact_closing_");
  return initiative.dataQuality === "分时验证";
}

function cycleIdentityOf(stock) {
  const leadership = stock && stock.leadership && typeof stock.leadership === "object" ? stock.leadership : {};
  return leadership.cycleIdentity && typeof leadership.cycleIdentity === "object"
    ? leadership.cycleIdentity
    : stock && stock.cycleIdentity && typeof stock.cycleIdentity === "object"
      ? stock.cycleIdentity
      : {};
}

function isDailyHeightRole(stock) {
  return Boolean(stock && (
    stock.roleKind === "dailyHeight"
    || stock.dailyRole === "当日高度"
    || stock.roleScope === "session" && /当日高度|龙头/.test(String(stock.role || stock.dailyRole || ""))
  ));
}

function isVerifiedCycleCoreRole(stock) {
  if (!stock) return false;
  const identity = cycleIdentityOf(stock);
  if (
    identity.identityEstablished === true
    && identity.activePrimary === true
    && ["confirmed", "retained"].includes(String(identity.state || ""))
  ) return true;
  return stock.roleKind === "cycleLeader" && stock.roleScope === "cycle";
}

function hasEstablishedCycleIdentity(stock) {
  if (!stock) return false;
  const identity = cycleIdentityOf(stock);
  return Boolean(
    stock.roleKind === "cycleLeader"
    || stock.roleScope === "cycle"
    || identity.identityEstablished === true
      && identity.activePrimary === true
      && ["confirmed", "retained"].includes(String(identity.state || "")),
  );
}

function isRollingCapacityCoreRole(stock) {
  return Boolean(
    stock
    && !isDailyHeightRole(stock)
    && stock.roleKind === "capacityCore"
    && stock.roleScope === "rolling",
  );
}

function parseIntradayTrendPayload(payload, fallbackPrevClose) {
  const data = payload && payload.data ? payload.data : null;
  const prevClose = finite(data && data.preClose) || finite(fallbackPrevClose);
  const trends = data && Array.isArray(data.trends) ? data.trends : [];
  if (!prevClose || !trends.length) return null;

  const rows = trends.map((line) => {
    const parts = String(line || "").split(",");
    if (parts.length < 7) return null;
    const minute = timeToMinutes(parts[0]);
    const close = finite(parts[2]);
    if (minute === null || close === null) return null;
    const amount = finite(parts[6]) || 0;
    return {
      tradingDate: /^\d{4}-\d{2}-\d{2}/.test(String(parts[0] || "")) ? String(parts[0]).slice(0, 10) : null,
      time: String(parts[0]).slice(-5),
      minute,
      open: finite(parts[1]),
      close,
      high: finite(parts[3]),
      low: finite(parts[4]),
      volume: finite(parts[5]) || 0,
      amount,
      averagePrice: finite(parts[7]),
      changePct: ((close - prevClose) / prevClose) * 100,
    };
  }).filter(Boolean);
  if (!rows.length) return null;

  const firstAt = (threshold) => rows.find((row) => row.changePct >= threshold) || null;
  const last = rows[rows.length - 1];
  const first = rows[0];
  const maxChangePct = Math.max(...rows.map((row) => row.changePct));
  const minChangePct = Math.min(...rows.map((row) => row.changePct));
  const firstRed = firstAt(0.1);
  const firstAttack = firstAt(2);
  const firstStrong = firstAt(5);
  const cumulativeAmount = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const retention = maxChangePct > 0 ? clamp((last.changePct / maxChangePct) * 100, -100, 120) : 0;
  const tradingDates = Array.from(new Set(rows.map((row) => row.tradingDate).filter(Boolean)));
  const openPrice = finite(first && first.open) || finite(first && first.close);
  const openChangePct = openPrice === null ? null : ((openPrice - prevClose) / prevClose) * 100;

  return normalizeIntradayEvidenceSummary({
    source: "eastmoney_trends2",
    name: data && data.name || null,
    tradingDate: tradingDates.length === 1 ? tradingDates[0] : null,
    prevClose,
    rows,
    firstAttackMinute: firstAttack ? firstAttack.minute : null,
    firstAttackTime: firstAttack ? firstAttack.time : null,
    firstStrongMinute: firstStrong ? firstStrong.minute : null,
    firstStrongTime: firstStrong ? firstStrong.time : null,
    firstRedMinute: firstRed ? firstRed.minute : null,
    firstRedTime: firstRed ? firstRed.time : null,
    openChangePct: openChangePct === null ? null : round1(openChangePct),
    currentChangePct: round1(last.changePct),
    maxChangePct: round1(maxChangePct),
    minChangePct: round1(minChangePct),
    intradayRangePct: round1(maxChangePct - minChangePct),
    retentionPct: round1(retention),
    cumulativeAmountYi: round1(cumulativeAmount / 1e8),
    asOf: last.time,
  });
}

/**
 * 腾讯分钟接口兜底。该接口只返回“时间、现价、累计成交量、累计成交额”，
 * 所以分钟内高低点不可验证；这里不把日线或本机日期伪装成分时事实。
 */
function parseTencentMinutePayload(payload, symbol, fallbackPrevClose) {
  const symbolKey = String(symbol || "").trim().toLowerCase();
  const root = payload && payload.data && typeof payload.data === "object" ? payload.data : {};
  const node = root[symbolKey] || Object.values(root).find((item) => item && item.data);
  const data = node && node.data && typeof node.data === "object" ? node.data : null;
  const lines = data && Array.isArray(data.data) ? data.data : [];
  const compactDate = String(data && data.date || "").replace(/[^0-9]/g, "");
  const tradingDate = /^20\d{6}$/.test(compactDate)
    ? `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`
    : null;
  const quote = node && node.qt && Array.isArray(node.qt[symbolKey]) ? node.qt[symbolKey] : [];
  const prevClose = finite(fallbackPrevClose) || finite(quote[4]);
  if (!tradingDate || !prevClose || !lines.length) return null;

  let previousVolume = 0;
  let previousAmount = 0;
  const rows = lines.map((line) => {
    const parts = String(line || "").trim().split(/\s+/);
    if (parts.length < 4 || !/^\d{4}$/.test(parts[0])) return null;
    const time = `${parts[0].slice(0, 2)}:${parts[0].slice(2, 4)}`;
    const minute = timeToMinutes(time);
    const close = finite(parts[1]);
    const cumulativeVolume = finite(parts[2]);
    const cumulativeAmount = finite(parts[3]);
    if (minute === null || close === null || cumulativeVolume === null || cumulativeAmount === null) return null;
    const volume = Math.max(0, cumulativeVolume - previousVolume);
    const amount = Math.max(0, cumulativeAmount - previousAmount);
    previousVolume = Math.max(previousVolume, cumulativeVolume);
    previousAmount = Math.max(previousAmount, cumulativeAmount);
    return {
      tradingDate,
      time,
      minute,
      open: close,
      close,
      high: close,
      low: close,
      volume,
      amount,
      averagePrice: cumulativeVolume > 0 ? cumulativeAmount / cumulativeVolume : null,
      changePct: ((close - prevClose) / prevClose) * 100,
    };
  }).filter(Boolean);
  if (!rows.length) return null;

  const firstAt = (threshold) => rows.find((row) => row.changePct >= threshold) || null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const maxChangePct = Math.max(...rows.map((row) => row.changePct));
  const minChangePct = Math.min(...rows.map((row) => row.changePct));
  const firstRed = firstAt(0.1);
  const firstAttack = firstAt(2);
  const firstStrong = firstAt(5);
  const openChangePct = ((first.close - prevClose) / prevClose) * 100;
  const retention = maxChangePct > 0 ? clamp((last.changePct / maxChangePct) * 100, -100, 120) : 0;

  return normalizeIntradayEvidenceSummary({
    source: "tencent_minute_query",
    name: quote[1] || null,
    tradingDate,
    prevClose,
    rows,
    firstAttackMinute: firstAttack ? firstAttack.minute : null,
    firstAttackTime: firstAttack ? firstAttack.time : null,
    firstStrongMinute: firstStrong ? firstStrong.minute : null,
    firstStrongTime: firstStrong ? firstStrong.time : null,
    firstRedMinute: firstRed ? firstRed.minute : null,
    firstRedTime: firstRed ? firstRed.time : null,
    openChangePct: round1(openChangePct),
    currentChangePct: round1(last.changePct),
    maxChangePct: round1(maxChangePct),
    minChangePct: round1(minChangePct),
    intradayRangePct: round1(maxChangePct - minChangePct),
    retentionPct: round1(retention),
    cumulativeAmountYi: round1(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) / 1e8),
    asOf: last.time,
    fieldLimitations: ["腾讯分钟接口不含分钟OHLC，分钟内高低点不可验证"],
  });
}

function stockLimitThresholdPct(stock) {
  const prevClose = finite(stock && (stock.prevClose || stock.preClose));
  const limitUpPrice = finite(stock && stock.limitUpPrice);
  if (prevClose && limitUpPrice) {
    return ((limitUpPrice - prevClose) / prevClose) * 100;
  }
  const code = String(stock && (stock.code || stock.secCode) || "");
  const name = String(stock && stock.name || "");
  if (/(^|[^A-Z])\*?ST/i.test(name)) return 5;
  if (/^(300|301|688|689)/.test(code)) return 20;
  if (/^(4|8|92)/.test(code)) return 30;
  return 10;
}

/**
 * 记录“第一次触板以后”的开板与回封顺序。
 * 全天最低点/振幅无法区分“低位启动后稳定封板”和“封板后反复炸板”，
 * 因而这里只增加事实字段，不参与核心身份或主动性打分。
 */
function buildLimitBoardSessionProfile(stock, summary) {
  const rows = summary && Array.isArray(summary.rows) ? summary.rows : [];
  if (!rows.length) return null;
  const threshold = stockLimitThresholdPct(stock);
  const prevClose = finite(summary && summary.prevClose)
    || finite(stock && (stock.prevClose || stock.preClose));
  // 分钟线与交易所四舍五入会有轻微误差，保留0.18个百分点容差。
  const closeAtLimit = (row) => finite(row && row.changePct) !== null
    && Number(row.changePct) >= threshold - 0.18;
  const touchedLimit = (row) => {
    if (closeAtLimit(row)) return true;
    const high = finite(row && row.high);
    return prevClose && high !== null
      ? ((high - prevClose) / prevClose) * 100 >= threshold - 0.18
      : false;
  };
  const firstLimitIndex = rows.findIndex(touchedLimit);
  const closedAtLimit = isLimitUp(stock);
  if (firstLimitIndex < 0) {
    return {
      limitTouched: false,
      firstLimitTime: null,
      limitTouchCount: 0,
      limitOpenCount: 0,
      longestOpenMinutes: 0,
      lastResealTime: null,
      resealedAfterOpen: false,
      closedAtLimit,
      finalSealMinutes: 0,
      postTouchMaxPullbackPct: null,
    };
  }

  const firstClosedAtLimit = closeAtLimit(rows[firstLimitIndex]);
  let limitTouchCount = 1;
  let limitOpenCount = firstClosedAtLimit ? 0 : 1;
  let currentOpenMinutes = firstClosedAtLimit ? 0 : 1;
  let longestOpenMinutes = 0;
  let lastResealTime = null;
  let postTouchMin = finite(rows[firstLimitIndex] && rows[firstLimitIndex].changePct);
  if (postTouchMin === null) postTouchMin = Infinity;
  let wasAtLimit = firstClosedAtLimit;

  for (let index = firstLimitIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const nowAtLimit = closeAtLimit(row);
    const pct = finite(row && row.changePct);
    if (pct !== null) postTouchMin = Math.min(postTouchMin, pct);
    if (wasAtLimit && !nowAtLimit) {
      limitOpenCount += 1;
      currentOpenMinutes = 1;
    } else if (!wasAtLimit && !nowAtLimit) {
      currentOpenMinutes += 1;
    } else if (!wasAtLimit && nowAtLimit) {
      limitTouchCount += 1;
      longestOpenMinutes = Math.max(longestOpenMinutes, currentOpenMinutes);
      currentOpenMinutes = 0;
      lastResealTime = row.time || minutesToTime(row.minute);
    }
    wasAtLimit = nowAtLimit;
  }
  longestOpenMinutes = Math.max(longestOpenMinutes, currentOpenMinutes);

  let finalSealMinutes = 0;
  if (closedAtLimit) {
    for (let index = rows.length - 1; index >= firstLimitIndex && closeAtLimit(rows[index]); index -= 1) {
      finalSealMinutes += 1;
    }
  }

  return {
    limitTouched: true,
    firstLimitTime: rows[firstLimitIndex].time || minutesToTime(rows[firstLimitIndex].minute),
    limitTouchCount,
    limitOpenCount,
    longestOpenMinutes,
    lastResealTime,
    resealedAfterOpen: limitOpenCount > 0 && closedAtLimit,
    closedAtLimit,
    finalSealMinutes,
    postTouchMaxPullbackPct: Number.isFinite(postTouchMin)
      ? round1(Math.max(0, threshold - postTouchMin))
      : 0,
  };
}

function stockDirectionKeys(stock) {
  return [
    stock && stock.mainFamily,
    stock && stock.mainConcept,
    stock && stock.concept,
    ...(Array.isArray(stock && stock.concepts) ? stock.concepts : []),
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function mainLineKeys(topicBoard) {
  const mainLine = topicBoard && topicBoard.mainLine ? topicBoard.mainLine : null;
  return Array.from(new Set([
    mainLine && mainLine.name,
    mainLine && mainLine.family,
    mainLine && mainLine.displayName,
    ...(Array.isArray(mainLine && mainLine.matchNames) ? mainLine.matchNames : []),
    ...(Array.isArray(mainLine && mainLine.aliases) ? mainLine.aliases : []),
  ].map((value) => String(value || "").trim()).filter(Boolean)));
}

function matchesMainLine(stock, focusKeys) {
  if (!focusKeys || !focusKeys.length) return true;
  const stockKeys = stockDirectionKeys(stock);
  return stockKeys.some((stockKey) => focusKeys.some((focusKey) => (
    stockKey === focusKey || stockKey.includes(focusKey) || focusKey.includes(stockKey)
  )));
}

function selectLeadershipTargets(candidates, topicBoard, limit = 14) {
  const rows = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  const focusKeys = mainLineKeys(topicBoard);
  const focusRows = rows.filter((stock) => matchesMainLine(stock, focusKeys));
  const seen = new Set();
  const result = [];
  const push = (stock) => {
    const code = String(stock && (stock.code || stock.secCode) || "");
    if (!code || seen.has(code) || result.length >= limit) return;
    seen.add(code);
    result.push(stock);
  };

  const pushPriority = (source, includeAll = false) => {
    source.filter((stock) => /龙头|中军/.test(String(stock.role || "")) || stock.selected).forEach(push);
    source.slice().sort((a, b) => Number(b.amountYi || 0) - Number(a.amountYi || 0)).slice(0, 6).forEach(push);
    source.slice().sort((a, b) => Number(b.changePct || 0) - Number(a.changePct || 0)).slice(0, 5).forEach(push);
    source.slice().sort((a, b) => Number(a.combinedRank || 999) - Number(b.combinedRank || 999)).slice(0, 5).forEach(push);
    if (includeAll) source.forEach(push);
  };

  // 超预期模块还需要验证非当前主线里的高位情绪核心（断板/炸板/烂板）。
  // 先固定最多4个真实高标分时名额，避免主线样本过多时把它们完全挤出。
  const expectationRows = rows.filter((stock) => {
    const tag = String(stock && stock.popularity || "");
    const heightMatch = tag.match(/(\d+)\s*连板/) || tag.match(/\d+\s*天\s*(\d+)\s*板/);
    const height = heightMatch ? Number(heightMatch[1] || 0) : 0;
    return /龙头|情绪核心/.test(`${String(stock && stock.role || "")} ${tag}`)
      && (height >= 3 || /炸板|断板|烂板/.test(tag));
  }).sort((left, right) => {
    const heightOf = (stock) => {
      const tag = String(stock && stock.popularity || "");
      const continuous = tag.match(/(\d+)\s*连板/);
      const interval = tag.match(/\d+\s*天\s*(\d+)\s*板/);
      return Number(continuous && continuous[1] || interval && interval[1] || 0);
    };
    return heightOf(right) - heightOf(left) || Number(right.amountYi || 0) - Number(left.amountYi || 0);
  });
  expectationRows.slice(0, 4).forEach(push);

  // 分时领导力不仅服务当前主线，也要覆盖热榜最前排与跨市场容量锚。
  // 否则主线样本较多时，后续识别出的低位启动/高位趋势观察代表会整批缺分时。
  rows.slice().sort((a, b) => (
    Number(a.combinedRank || a.eastRank || a.thsRank || 999)
      - Number(b.combinedRank || b.eastRank || b.thsRank || 999)
  )).slice(0, 6).forEach(push);
  rows.filter((stock) => (
    stock.inBothSources === true
    && /龙头|中军|核心|容量/.test(`${String(stock.role || "")} ${String(stock.ticketType || "")}`)
  )).sort((a, b) => Number(b.amountYi || 0) - Number(a.amountYi || 0)).slice(0, 3).forEach(push);

  // 主线票即使只有1—2只也必须优先抓取；不能因样本少就退回全市场并把主线挤出上限。
  if (focusRows.length) pushPriority(focusRows, true);
  else pushPriority(rows, false);
  if (result.length < limit && focusRows.length) {
    const supplement = rows.filter((stock) => !focusRows.includes(stock));
    pushPriority(supplement, false);
  }
  return result.slice(0, limit);
}

function buildLeadershipHistory(archives) {
  const history = new Map();
  (Array.isArray(archives) ? archives : []).forEach((entry) => {
    const candidates = entry && entry.payload && Array.isArray(entry.payload.candidates) ? entry.payload.candidates : [];
    candidates.forEach((stock) => {
      const code = String(stock && (stock.code || stock.secCode) || "");
      if (!code) return;
      const current = history.get(code) || { appearances: 0, coreHits: 0, selectedHits: 0, activeHits: 0, dates: [] };
      current.appearances += 1;
      const cycleCore = isVerifiedCycleCoreRole(stock);
      const rollingCapacityCore = isRollingCapacityCoreRole(stock);
      if (cycleCore || rollingCapacityCore) current.coreHits += 1;
      if (stock.selected) current.selectedHits += 1;
      if (stock.leadership && Number(stock.leadership.initiative && stock.leadership.initiative.score) >= 60) current.activeHits += 1;
      if (entry.date) current.dates.push(entry.date);
      history.set(code, current);
    });
  });
  return history;
}

function buildStructureProfile(stock) {
  const profile = stock && stock.klineProfile ? stock.klineProfile : {};
  const close = finite(profile.lastClose) || finite(stock && stock.price);
  const ma5 = finite(profile.ma5);
  const ma10 = finite(profile.ma10);
  const ma20 = finite(profile.ma20);
  const ma60 = finite(profile.ma60);
  const vwap20 = finite(profile.vwap20);
  const pctFromHigh = finite(profile.pctFromHigh);
  const rise10 = finite(profile.rise10) || 0;
  const rise20 = finite(profile.rise20) || 0;
  const position120Pct = finite(profile.position120Pct);
  const amountTrendRatio = finite(profile.amountTrendRatio);
  const tradingDays = finite(profile.tradingDays);
  const isNewListing = Boolean(profile.isNewListing || (tradingDays !== null && tradingDays < 60));
  const effectiveTurnover5 = finite(profile.effectiveTurnover5);
  const recentWeightedCost = finite(profile.recentWeightedCost);
  const closeToCostPct = finite(profile.closeToCostPct);
  const closePositionPct = finite(profile.closePositionPct);
  const newStockChipState = String(profile.newStockChipState || "次新筹码待验证");
  const newStockDistributionRisk = Boolean(profile.newStockDistributionRisk || newStockChipState === "高换手派发风险");
  const newStockReset = Boolean(newStockChipState === "筹码快速重置" || newStockChipState === "换手重建中");
  const distanceMa20Pct = close && ma20 ? ((close - ma20) / ma20) * 100 : null;
  const distanceMa5Pct = close && ma5 ? ((close - ma5) / ma5) * 100 : null;
  const belowMediumCost = Boolean(close && ((ma20 && close < ma20 * 0.96) || (vwap20 && close < vwap20 * 0.96)));
  const breakdown = isNewListing
    ? newStockDistributionRisk || Boolean(profile.longBearBreak3d) || Boolean(profile.structureBreak)
    : Boolean(profile.longBearBreak3d)
      || Boolean(profile.structureBreak)
      || (belowMediumCost && Boolean(ma5 && ma10 && ma5 < ma10));
  const overextended = Boolean(
    isNewListing
      ? (closeToCostPct !== null && closeToCostPct >= 22) || rise10 >= 45
      : (distanceMa20Pct !== null && distanceMa20Pct >= 20)
        || (distanceMa5Pct !== null && distanceMa5Pct >= 10)
        || rise10 >= 28
        || rise20 >= 50
  );
  const trendHealthy = isNewListing
    ? Boolean(newStockReset && !breakdown && (closeToCostPct === null || closeToCostPct >= -5))
    : Boolean(
      close && ma20 && close >= ma20 * 0.97
      && !breakdown
      && (!ma5 || !ma10 || ma5 >= ma10 * 0.98)
    );
  // 次新股不能用“距60日高点”推断套牢盘；筹码是否舒服看换手后是否守住近期成交成本。
  const deepSupplyZone = isNewListing
    ? newStockDistributionRisk
    : profile.chipComfort === "套牢压力" || (pctFromHigh !== null && pctFromHigh > 18);
  const reclaimedCosts = Boolean(close && ma20 && close >= ma20 && (!ma60 || close >= ma60 * 0.95));
  const repairTurnover = Boolean(profile.volumeBreakout) || (amountTrendRatio !== null && amountTrendRatio >= 0.95);
  const chipRepairing = isNewListing
    ? Boolean(newStockReset && !newStockDistributionRisk)
    : deepSupplyZone && trendHealthy && reclaimedCosts && (repairTurnover || (position120Pct !== null && position120Pct <= 45));
  const chipPressure = isNewListing
    ? newStockDistributionRisk || Boolean(closeToCostPct !== null && closeToCostPct < -6)
    : (deepSupplyZone && !chipRepairing) || Boolean(close && ma60 && close < ma60 * 0.92);

  let grade = "C";
  if (breakdown) grade = "D";
  else if (trendHealthy && !overextended && !chipPressure && (!isNewListing || newStockChipState === "筹码快速重置")) grade = "A";
  else if (trendHealthy || (close && ma20 && close >= ma20 * 0.94)) grade = "B";

  let positionLabel = "位置待确认";
  if (breakdown) positionLabel = "破位修复区";
  else if (overextended) positionLabel = "短线偏离成本区";
  else if (isNewListing && newStockChipState === "筹码快速重置") positionLabel = "次新强势定价区";
  else if (isNewListing && newStockReset) positionLabel = "次新换手定价区";
  else if (profile.newHigh || profile.nearHigh20) positionLabel = "强势平台/前高区";
  else if (position120Pct !== null && position120Pct <= 35 && trendHealthy) positionLabel = "低位重建区";
  else if (trendHealthy) positionLabel = "中位承接区";

  const chipLabel = isNewListing
    ? newStockChipState
    : chipPressure
      ? "套牢压力偏重"
      : chipRepairing
        ? "低位换手重建中"
        : profile.chipComfort === "舒服"
          ? "上方筹码较轻"
          : "筹码压力中性";
  const evidence = [];
  if (trendHealthy) evidence.push("关键成本区尚未有效破坏");
  if (breakdown) evidence.push("趋势或关键成本已经破坏");
  if (profile.longBearBreak3d) evidence.push("近3日出现放量长阴破位");
  if (profile.newHigh) evidence.push("价格接近或创出阶段新高");
  if (isNewListing) {
    if (tradingDays !== null) evidence.push(`上市${Math.round(tradingDays)}个交易日，使用次新筹码模型`);
    if (effectiveTurnover5 !== null) evidence.push(`近5日有效换手约${round1(effectiveTurnover5)}%（${profile.turnoverDataQuality || "筹码重置代理"}）`);
    if (closeToCostPct !== null) evidence.push(`相对近期换手成本${closeToCostPct >= 0 ? "+" : ""}${round1(closeToCostPct)}%`);
    if (closePositionPct !== null) evidence.push(`收盘位于近期振幅${round1(closePositionPct)}%位置`);
  } else if (pctFromHigh !== null) evidence.push(`距60日高点${round1(pctFromHigh)}%`);
  if (distanceMa20Pct !== null) evidence.push(`相对20日成本${distanceMa20Pct >= 0 ? "+" : ""}${round1(distanceMa20Pct)}%`);
  if (overextended) evidence.push("短线偏离成本过大，结构好也不能追价");

  return {
    grade,
    frameworkIntact: grade === "A" || grade === "B",
    breakdown,
    overextended,
    trendHealthy,
    chipPressure,
    chipRepairing,
    chipLabel,
    positionLabel,
    isNewListing,
    tradingDays,
    newStockReset,
    newStockDistributionRisk,
    effectiveTurnover5,
    recentWeightedCost,
    closeToCostPct,
    closePositionPct,
    distanceMa20Pct: distanceMa20Pct === null ? null : round1(distanceMa20Pct),
    distanceMa5Pct: distanceMa5Pct === null ? null : round1(distanceMa5Pct),
    pctFromHigh,
    evidence,
  };
}

function pctAtMinute(summary, minute) {
  if (!summary || !Array.isArray(summary.rows) || !Number.isFinite(minute)) return null;
  let selected = null;
  for (const row of summary.rows) {
    if (row.minute > minute) break;
    selected = row;
  }
  return selected ? selected.changePct : null;
}

function buildPriceDiscoveryProfile(stock, summary, history = {}) {
  const lifted = isLimitUp(stock);
  const rows = summary && Array.isArray(summary.rows) ? summary.rows : [];
  const rowPcts = rows.map((row) => finite(row && row.changePct)).filter((value) => value !== null);
  const firstMinute = rows.length ? finite(rows[0] && rows[0].minute) : null;
  const maxPct = rowPcts.length ? Math.max(...rowPcts) : null;
  const minPct = rowPcts.length ? Math.min(...rowPcts) : null;
  const intradayRangePct = maxPct !== null && minPct !== null ? maxPct - minPct : null;
  const currentPct = finite(stock && stock.changePct);
  const price = finite(stock && (stock.price || stock.close || stock.lastPrice));
  const open = finite(stock && (stock.open || stock.openPrice));
  const high = finite(stock && (stock.high || stock.highPrice));
  const low = finite(stock && (stock.low || stock.lowPrice));
  const prevClose = finite(stock && (stock.prevClose || stock.preClose));
  const explicitOneWord = Boolean(stock && (
    stock.oneWord
    || stock.isOneWord
    || stock.oneWordLimitUp
    || /一字/.test(String(stock.limitUpType || stock.boardType || ""))
  ));
  const ohlcRangePct = prevClose && high !== null && low !== null
    ? ((high - low) / prevClose) * 100
    : null;
  const ohlcLocked = Boolean(
    lifted
    && open !== null && high !== null && low !== null && price !== null
    && Math.abs(open - price) <= 0.011
    && Math.abs(high - price) <= 0.011
    && Math.abs(low - price) <= 0.011
    && (ohlcRangePct === null || ohlcRangePct <= 0.08)
  );
  // 一字板在09:30天然处于涨停，不能把时间上的“最早”反推成主动带动。
  // 这里使用当前涨幅附近的窄幅锁定，而不是写死10%，兼容ST与20cm标的。
  const trendLocked = Boolean(
    lifted
    && rowPcts.length >= 2
    && firstMinute !== null && firstMinute <= 9 * 60 + 31
    && currentPct !== null && currentPct >= 4.5
    && intradayRangePct !== null && intradayRangePct <= 0.35
    && minPct !== null && minPct >= currentPct - 0.35
  );
  const suspectedOneWord = Boolean(lifted && (explicitOneWord || ohlcLocked || trendLocked));
  // 重启读取旧缓存时可能只有收盘价、没有分时/OHLC。涨停票在价格发现
  // 尚未重新验证前不得仅凭收盘强度恢复“主动龙头”，宁可暂列高度观察。
  const limitUpDiscoveryUnverified = Boolean(
    lifted
    && !rows.length
    && open === null && high === null && low === null
    && !explicitOneWord
  );
  const historicalImpact = Number(history.activeHits || 0) > 0
    || Number(history.coreHits || 0) >= 2
    || Number(history.selectedHits || 0) >= 2;
  const evidence = [];
  if (explicitOneWord) evidence.push("行情字段标记为一字锁板");
  if (ohlcLocked) evidence.push("开高低收近似同价，缺少盘中价格发现");
  if (trendLocked) evidence.push("09:30起全天贴近涨停价窄幅锁定");
  if (limitUpDiscoveryUnverified) evidence.push("涨停但缺少分时与开高低数据，价格发现待重新验证");
  if (suspectedOneWord && historicalImpact) evidence.push("仅保留历史情绪影响，不以本日锁板建立主动性");

  return {
    suspectedOneWord,
    limitUpDiscoveryUnverified,
    noPriceDiscovery: suspectedOneWord || limitUpDiscoveryUnverified,
    historicalImpact,
    intradayRangePct: intradayRangePct === null ? null : round1(intradayRangePct),
    evidence,
  };
}

function buildInitiative(stock, peers, intradayByCode, history) {
  const code = String(stock && (stock.code || stock.secCode) || "");
  const changePct = finite(stock && stock.changePct) || 0;
  const peerChanges = peers.map((peer) => finite(peer && peer.changePct)).filter((value) => value !== null);
  const peerMedian = median(peerChanges);
  const relativeStrength = changePct - peerMedian;
  const peerAmounts = peers.map((peer) => finite(peer && peer.amountYi)).filter((value) => value !== null);
  const amountYi = finite(stock && stock.amountYi) || 0;
  const capacityFloor = Math.max(30, percentile(peerAmounts, 0.65));
  const floatCapYi = finite(stock && stock.floatMktCapYi)
    || (finite(stock && stock.floatMarketValue) ? finite(stock.floatMarketValue) / 1e8 : 0)
    || 0;
  const capacity = (amountYi >= capacityFloor && amountYi >= 30) || amountYi >= 80 || (floatCapYi >= 500 && amountYi >= 20);
  const summary = normalizeIntradayEvidenceSummary(
    intradayByCode && intradayByCode.get(code) || null,
  );
  const intradayQuality = summary && summary.evidenceQuality || null;
  const closingIntradayVerified = Boolean(intradayQuality && intradayQuality.closingComplete);
  const limitBoardSession = buildLimitBoardSessionProfile(stock, summary);
  const peerSummaries = peers.map((peer) => normalizeIntradayEvidenceSummary(
    intradayByCode && intradayByCode.get(String(peer.code || peer.secCode || "")),
  )).filter(Boolean);
  const attackMinutes = peerSummaries.map((item) => item.firstAttackMinute).filter(Number.isFinite);
  const medianAttackMinute = attackMinutes.length ? median(attackMinutes) : null;
  const firstAttackMinute = summary && Number.isFinite(summary.firstAttackMinute) ? summary.firstAttackMinute : null;
  const leadMinutes = firstAttackMinute !== null && medianAttackMinute !== null ? medianAttackMinute - firstAttackMinute : null;
  const rawFollowerCount = firstAttackMinute === null ? 0 : peerSummaries.filter((item) => (
    Number.isFinite(item.firstAttackMinute)
    && item.firstAttackMinute > firstAttackMinute
    && item.firstAttackMinute <= firstAttackMinute + 30
  )).length;
  const breadthBefore = firstAttackMinute === null ? null : peerSummaries.filter((item) => {
    const value = pctAtMinute(item, firstAttackMinute);
    return value !== null && value >= 1;
  }).length;
  const breadthAfter = firstAttackMinute === null ? null : peerSummaries.filter((item) => {
    const value = pctAtMinute(item, firstAttackMinute + 20);
    return value !== null && value >= 1;
  }).length;
  const rawBreadthLift = breadthBefore === null || breadthAfter === null ? 0 : Math.max(0, breadthAfter - breadthBefore);
  const historyRow = history || { appearances: 0, coreHits: 0, selectedHits: 0, activeHits: 0 };
  const priceDiscovery = buildPriceDiscoveryProfile(stock, summary, historyRow);
  const followerCount = priceDiscovery.noPriceDiscovery ? 0 : rawFollowerCount;
  const breadthLift = priceDiscovery.noPriceDiscovery ? 0 : rawBreadthLift;
  const role = String(stock && stock.role || "");
  const combinedRank = finite(stock && stock.combinedRank);

  let score = 0;
  const evidence = [];
  if (relativeStrength >= 3) { score += 20; evidence.push(`强于方向中位数${round1(relativeStrength)}个百分点`); }
  else if (relativeStrength >= 1.5) { score += 15; evidence.push(`相对方向领先${round1(relativeStrength)}个百分点`); }
  else if (relativeStrength >= 0.5) score += 8;
  else if (relativeStrength <= -2) score -= 8;

  if (changePct >= 7) score += 10;
  else if (changePct >= 3) score += 7;
  else if (changePct >= 0) score += 3;

  if (capacity) { score += 13; evidence.push(`成交${round1(amountYi)}亿，具备容量承接`); }
  else if (amountYi >= percentile(peerAmounts, 0.5)) score += 6;
  const inflow = finite(stock && stock.mainInflowYi);
  if (inflow !== null && inflow > 0) { score += inflow >= 5 ? 7 : 4; evidence.push(`主力净流入${round1(inflow)}亿`); }
  if (stock && stock.inBothSources) score += 5;
  if (combinedRank !== null && combinedRank <= 10) score += 7;
  else if (combinedRank !== null && combinedRank <= 30) score += 4;
  if (isVerifiedCycleCoreRole(stock)) score += 8;
  else if (isRollingCapacityCoreRole(stock)) score += 6;
  score += Math.min(6, Number(historyRow.coreHits || 0) * 2);

  if (summary && !priceDiscovery.noPriceDiscovery) {
    evidence.push(`${intradayQuality.qualityLabel}，证据权重${Math.round(intradayQuality.evidenceWeight * 100)}%（未校准）`);
    if (firstAttackMinute !== null && firstAttackMinute <= 10 * 60) { score += 8; evidence.push(`${minutesToTime(firstAttackMinute)}率先进入进攻区`); }
    if (leadMinutes !== null && leadMinutes >= 10) { score += 10; evidence.push(`比方向典型发动时点早${Math.round(leadMinutes)}分钟`); }
    else if (leadMinutes !== null && leadMinutes >= 3) score += 5;
    if (followerCount >= 3) { score += 10; evidence.push(`发动后30分钟内${followerCount}只同方向标的跟随`); }
    else if (followerCount >= 1) score += 4;
    if (breadthLift >= 2) { score += 8; evidence.push(`发动后方向强势家数增加${breadthLift}只`); }
    if (summary.retentionPct >= 70) score += 6;
    else if (summary.retentionPct < 35) score -= 5;
    if (!closingIntradayVerified) evidence.push("分时只覆盖部分交易时段，不能证明尾盘承接或全天保留率");
  } else if (priceDiscovery.noPriceDiscovery) {
    evidence.push("疑似一字锁板/无价格发现，本日09:30与后续跟随不计主动性");
  } else {
    evidence.push("分时主动性数据缺失，本轮按收盘相对强度降级判断");
  }

  score = clamp(Math.round(score), 0, 100);
  const hasIntradayLead = Boolean(summary && !priceDiscovery.noPriceDiscovery && (
    (leadMinutes !== null && leadMinutes >= 3)
    || followerCount >= 2
    || breadthLift >= 2
  ));
  const proxyLead = !summary && !priceDiscovery.noPriceDiscovery
    && relativeStrength >= 2 && changePct >= 2 && (capacity || (inflow !== null && inflow > 0));
  // 有真实分时时，必须真的率先发动或形成带动；不能因为收盘涨得多，
  // 把尾盘跟涨、孤立拉升也反推成“主动进攻”。收盘涨幅兜底只用于分时缺失场景。
  const strongCloseProxy = !summary && !priceDiscovery.noPriceDiscovery && changePct >= 7 && relativeStrength >= 2;
  const proactive = !priceDiscovery.noPriceDiscovery && score >= 58 && (hasIntradayLead || proxyLead || strongCloseProxy);
  const label = proactive && score >= 75
    ? "主动进攻"
    : proactive
      ? "主动候选"
      : score >= 45
        ? "同步共振"
        : "被动跟随/观察";

  return {
    score,
    label,
    proactive,
    capacity,
    capacityFloorYi: round1(capacityFloor),
    relativeStrength: round1(relativeStrength),
    peerMedianChangePct: round1(peerMedian),
    firstAttackTime: summary && summary.firstAttackTime || null,
    leadMinutes: priceDiscovery.noPriceDiscovery || leadMinutes === null ? null : Math.round(leadMinutes),
    followerCount,
    breadthLift,
    retentionPct: summary ? summary.retentionPct : null,
    session: summary ? {
      verified: closingIntradayVerified,
      source: summary.source || "intraday_provider",
      tradingDate: summary.tradingDate || null,
      openChangePct: finite(summary.openChangePct),
      currentChangePct: finite(summary.currentChangePct),
      maxChangePct: finite(summary.maxChangePct),
      minChangePct: finite(summary.minChangePct),
      intradayRangePct: finite(summary.intradayRangePct),
      firstRedMinute: finite(summary.firstRedMinute),
      firstRedTime: summary.firstRedTime || null,
      firstAttackMinute: finite(summary.firstAttackMinute),
      firstAttackTime: summary.firstAttackTime || null,
      firstStrongMinute: finite(summary.firstStrongMinute),
      firstStrongTime: summary.firstStrongTime || null,
      asOf: summary.asOf || null,
      evidenceQuality: intradayQuality ? { ...intradayQuality } : null,
      closingComplete: closingIntradayVerified,
      fieldLimitations: Array.isArray(summary.fieldLimitations) ? [...summary.fieldLimitations] : [],
      ...(limitBoardSession || {}),
    } : null,
    dataQuality: closingIntradayVerified ? "分时验证" : summary ? "分时部分验证" : "收盘代理",
    dataQualityKey: intradayQuality ? intradayQuality.qualityKey : "closing_proxy",
    dataQualityLabel: intradayQuality ? intradayQuality.qualityLabel : "收盘代理",
    providerQualityKey: intradayQuality ? intradayQuality.providerQualityKey : "closing_proxy",
    evidenceWeight: intradayQuality ? intradayQuality.evidenceWeight : 0.6,
    priceDiscovery,
    evidence,
  };
}

function buildCoreLeadershipBoard(options = {}) {
  const candidates = Array.isArray(options.candidates) ? options.candidates.filter(Boolean) : [];
  const topicBoard = options.topicBoard || {};
  const intradayByCode = options.intradayByCode instanceof Map ? options.intradayByCode : new Map();
  const initiativeFloorByCode = options.initiativeFloorByCode instanceof Map ? options.initiativeFloorByCode : new Map();
  const history = buildLeadershipHistory(options.archives);
  const focusKeys = mainLineKeys(topicBoard);
  const focusIdentified = focusKeys.length > 0;
  const directionGroups = new Map();
  candidates.forEach((stock) => {
    const key = String(stock.mainFamily || stock.mainConcept || stock.concept || "未归类");
    const rows = directionGroups.get(key) || [];
    rows.push(stock);
    directionGroups.set(key, rows);
  });

  const rows = candidates.map((stock) => {
    const code = String(stock.code || stock.secCode || "");
    const directionKey = String(stock.mainFamily || stock.mainConcept || stock.concept || "未归类");
    const priorCycleIdentity = cycleIdentityOf(stock);
    const establishedCycleIdentity = hasEstablishedCycleIdentity(stock);
    const peers = directionGroups.get(directionKey) || candidates;
    const structure = buildStructureProfile(stock);
    const currentInitiative = buildInitiative(stock, peers, intradayByCode, history.get(code));
    const verifiedFloor = initiativeFloorByCode.get(code);
    let initiative = currentInitiative;
    if (
      !isClosingIntradayInitiative(currentInitiative)
      && !currentInitiative.priceDiscovery.noPriceDiscovery
      && verifiedFloor
      && isClosingIntradayInitiative(verifiedFloor)
      && finite(verifiedFloor.score) !== null
      && !(currentInitiative.proactive && !verifiedFloor.proactive)
    ) {
      // 同一交易日已经取得的真实分时证据不能被后续接口抖动降级覆盖。
      // 但仍用本轮收盘数据检查是否明显转弱，避免早盘发动后全天走坏仍保留交易资格。
      const currentStillSupportsAttack = !verifiedFloor.proactive
        || (currentInitiative.score >= 40 && finite(stock && stock.changePct) !== null && Number(stock.changePct) > 0);
      const proactive = Boolean(verifiedFloor.proactive && currentStillSupportsAttack);
      const score = proactive
        ? Math.max(Number(currentInitiative.score || 0), Number(verifiedFloor.score || 0))
        : Math.min(57, Math.max(Number(currentInitiative.score || 0), Number(verifiedFloor.score || 0)));
      initiative = {
        ...verifiedFloor,
        score: clamp(Math.round(score), 0, 100),
        label: proactive
          ? score >= 75 ? "主动进攻" : "主动候选"
          : verifiedFloor.proactive ? "主动性曾验证/当前回落" : verifiedFloor.label,
        proactive,
        capacity: Boolean(currentInitiative.capacity || verifiedFloor.capacity),
        capacityFloorYi: currentInitiative.capacityFloorYi,
        relativeStrength: currentInitiative.relativeStrength,
        peerMedianChangePct: currentInitiative.peerMedianChangePct,
        session: currentInitiative.session || verifiedFloor.session || null,
        dataQuality: "分时验证",
        dataQualityKey: verifiedFloor.dataQualityKey || "exact_closing_legacy_unknown_fields",
        dataQualityLabel: verifiedFloor.dataQualityLabel || "历史分时验证·字段待确认",
        providerQualityKey: verifiedFloor.providerQualityKey || "legacy_intraday_unknown_fields",
        evidenceWeight: finite(verifiedFloor.evidenceWeight) ?? 0.75,
        evidence: Array.from(new Set([
          ...(Array.isArray(verifiedFloor.evidence) ? verifiedFloor.evidence : []),
          "同交易日沿用已验证分时证据，防止接口抖动造成降级",
        ])),
        priceDiscovery: currentInitiative.priceDiscovery,
        preservedFromEarlierFetch: true,
      };
    }
    // 同步给既有龙头识别链使用；主动性独立计算，不再等同于涨停或既有角色。
    stock.isDriver = initiative.proactive;
    stock.initiativeScore = initiative.score;
    const focusMatch = focusIdentified && matchesMainLine(stock, focusKeys);
    const directionState = stock && stock.directionState && typeof stock.directionState === "object" ? stock.directionState : {};
    const coreDirectionMatch = Boolean(directionState.isCoreDirection);
    const historical = history.get(code) || { appearances: 0, coreHits: 0, selectedHits: 0, activeHits: 0 };
    const legacyRecognized = isVerifiedCycleCoreRole(stock)
      || isRollingCapacityCoreRole(stock)
      || stock.inBothSources
      || Number(stock.combinedRank || 999) <= 30
      || historical.coreHits > 0;
    const impactScore = clamp(
      initiative.followerCount * 12
      + initiative.breadthLift * 10
      + (initiative.capacity ? 25 : 0)
      + (initiative.retentionPct !== null && initiative.retentionPct >= 70 ? 10 : 0),
      0,
      100,
    );

    const historicalImpact = Boolean(initiative.priceDiscovery.historicalImpact);
    const currentInfluence = impactScore >= 30;
    const historicalRecognition = Number(historical.coreHits || 0) > 0
      || Number(historical.activeHits || 0) > 0
      || Number(historical.appearances || 0) >= 2;
    const firstAttackMinute = timeToMinutes(initiative.firstAttackTime);
    const earlyLimitLockWithoutHistory = Boolean(
      isLimitUp(stock)
      && firstAttackMinute !== null
      && firstAttackMinute <= 9 * 60 + 31
      && !initiative.capacity
      && !historicalRecognition
      && !historicalImpact
    );
    const freshRecognition = Boolean(
      !earlyLimitLockWithoutHistory
      && initiative.proactive
      && currentInfluence
      && (
        initiative.capacity
        || Number(stock.amountYi || 0) >= 20
        || (stock.inBothSources && Number(stock.combinedRank || 999) <= 30)
      )
    );
    // 核心不能只由“今天最早涨停 + 后续同方向上涨”反推。持续辨识度至少来自
    // 历史影响、容量承接，或经过价格发现且有真实成交的当日主动进攻。
    const persistentRecognition = Boolean(
      historicalImpact
      || historicalRecognition
      || initiative.capacity
      || freshRecognition
    );
    // 核心方向在大分歧日仍可能出现“活口/修复发起者”。它先获得观察资格，
    // 但不会绕过主线身份、结构和硬门槛直接变成买点。
    const repairCoreQualified = Boolean(
      coreDirectionMatch
      && initiative.proactive
      && initiative.score >= 70
      && !initiative.priceDiscovery.noPriceDiscovery
      && persistentRecognition
      && (initiative.followerCount >= 2 || initiative.breadthLift >= 2 || impactScore >= 30)
    );
    const recognized = Boolean(legacyRecognized || persistentRecognition);
    const activeIdentity = Boolean(
      focusMatch
      && initiative.proactive
      && initiative.score >= 58
      && (currentInfluence || historicalImpact)
      && persistentRecognition
    );
    const historicalIdentity = Boolean(establishedCycleIdentity || (focusMatch && historicalImpact));
    // 当日新出现的一字锁板没有价格发现，既不能用09:30建立主动性，也不能
    // 仅凭涨停高度升级为核心；只有此前反复验证过影响力的老核心才保留情绪身份。
    const newLockedHeight = Boolean(initiative.priceDiscovery.noPriceDiscovery && !historicalImpact);
    const coreIdentityQualified = Boolean((activeIdentity || historicalIdentity) && !newLockedHeight);
    const explicitCandidate = Boolean(
      !coreIdentityQualified
      && focusMatch
      && !initiative.priceDiscovery.noPriceDiscovery
      && initiative.proactive
      && initiative.score >= 50
      && recognized
    );

    let level = "L1";
    let levelLabel = "普通跟随";
    if (activeIdentity && initiative.score >= 75 && impactScore >= 45) {
      level = "L4";
      levelLabel = "主线主动龙头";
    } else if (activeIdentity) {
      level = "L3";
      levelLabel = "主线进攻核心";
    } else if (historicalIdentity) {
      level = "L2";
      levelLabel = "历史情绪核心";
    } else if (repairCoreQualified) {
      level = "L3";
      levelLabel = "核心方向修复发起者";
    } else if (explicitCandidate) {
      level = "L2";
      levelLabel = "主线核心候选";
    }

    const hasHeight = isLimitUp(stock) || boardHeight(stock) > 0;
    let identity = "跟随观察";
    if (newLockedHeight) identity = "一字高度观察";
    else if (repairCoreQualified && !coreIdentityQualified) identity = "核心活口/修复发起者";
    else if (historicalIdentity && !activeIdentity) identity = "历史情绪核心";
    else if ((level === "L4" || level === "L3") && initiative.capacity) identity = "主动型容量龙头";
    else if ((level === "L4" || level === "L3") && hasHeight) identity = "主动型高度龙";
    else if ((level === "L4" || level === "L3") && structure.frameworkIntact) identity = "主动型趋势龙";
    else if (initiative.capacity && /中军/.test(String(stock.role || ""))) identity = "被动容量中军";
    else if (recognized) identity = "情绪/历史核心";

    let anchorType = "普通观察";
    if (newLockedHeight) anchorType = "高度观察";
    else if (repairCoreQualified && !coreIdentityQualified) anchorType = "核心方向活口";
    else if (historicalIdentity && !activeIdentity) anchorType = "历史情绪核心";
    else if (coreIdentityQualified && initiative.capacity) anchorType = "主动容量核心";
    else if (coreIdentityQualified) anchorType = "主动核心";
    else if (explicitCandidate) anchorType = "核心候选";

    const identityFails = [];
    if (!focusIdentified) identityFails.push("当前主线方向未确认");
    else if (!focusMatch) identityFails.push("不属于当前主线方向");
    if (newLockedHeight) identityFails.push("新一字锁板缺少价格发现，只计高度观察");
    else if (!activeIdentity && !historicalIdentity) {
      if (!initiative.proactive) identityFails.push("没有验证出主动进攻或带动性");
      else if (!currentInfluence && !historicalImpact) identityFails.push("真实带动尚未验证");
      else if (!persistentRecognition) identityFails.push("持续辨识度尚未验证，开盘快速封板不单独定义核心");
      else identityFails.push("当前核心身份不足");
    }

    const tradeFails = [];
    if (!coreIdentityQualified) tradeFails.push(...identityFails);
    if (coreIdentityQualified && !initiative.proactive) tradeFails.push("仅保留历史情绪身份，当前主动性未重新确认");
    if (initiative.dataQuality === "分时部分验证") tradeFails.push("分时只覆盖部分交易时段，不能授予收盘交易资格");
    if (initiative.priceDiscovery.noPriceDiscovery) tradeFails.push("当日疑似一字锁板，缺少价格发现");
    if (!structure.frameworkIntact) tradeFails.push("整体K线框架未通过");
    if (structure.chipPressure) tradeFails.push("上方套牢与筹码压力偏重");
    if (stock && stock.hardGate && stock.hardGate.pass === false) {
      const gateReasons = Array.isArray(stock.hardGate.hardFails)
        ? stock.hardGate.hardFails.filter(Boolean).slice(0, 2)
        : [];
      tradeFails.push(gateReasons.length
        ? `原交易硬门槛未通过：${gateReasons.join("、")}`
        : "原交易硬门槛未通过");
    }
    const hardFails = Array.from(new Set(tradeFails));
    const tradeQualified = coreIdentityQualified && hardFails.length === 0;
    // 兼容旧调用方：从v3开始 coreQualified 明确定义为“交易资格”，而非核心身份。
    const coreQualified = tradeQualified;
    const tradeState = !tradeQualified
      ? repairCoreQualified ? "修复观察" : "仅观察"
      : structure.overextended
        ? "等回踩"
        : "主攻候选";
    const executionNote = !tradeQualified
      ? repairCoreQualified
        ? `核心方向主动活口已保留；当前不直接等于买点，次日验证板块回流与个股承接。${hardFails.length ? ` 未转为交易资格：${hardFails.join("；")}` : ""}`
        : hardFails.join("；")
      : structure.overextended
        ? "龙头地位成立，但短线偏离成本过大，不追价"
        : "主动性、核心地位、结构与筹码同时通过";

    const leadership = {
      version: LEADERSHIP_SCHEMA_VERSION,
      level,
      levelLabel,
      identity,
      anchorType,
      focusMatch,
      recognized,
      persistentRecognition,
      repairCoreQualified,
      coreDirectionMatch,
      directionState,
      coreIdentityQualified,
      tradeQualified,
      coreQualified,
      tradeState,
      executionNote,
      identityFails,
      hardFails,
      initiative,
      structure,
      history: historical,
      impactScore,
      cycleIdentity: Object.keys(priorCycleIdentity).length ? priorCycleIdentity : null,
    };
    stock.leadership = leadership;
    return { stock, ...leadership };
  });

  rows.sort((a, b) => {
    const stateRank = { 主攻候选: 4, 等回踩: 3, 修复观察: 2, 仅观察: 1 };
    if ((stateRank[b.tradeState] || 0) !== (stateRank[a.tradeState] || 0)) return (stateRank[b.tradeState] || 0) - (stateRank[a.tradeState] || 0);
    if (b.initiative.score !== a.initiative.score) return b.initiative.score - a.initiative.score;
    return Number(b.stock.amountYi || 0) - Number(a.stock.amountYi || 0);
  });

  const compact = (row) => ({
    code: String(row.stock.code || row.stock.secCode || ""),
    name: String(row.stock.name || row.stock.code || "--"),
    concept: String(row.stock.mainConcept || row.stock.mainFamily || row.stock.concept || ""),
    changePct: finite(row.stock.changePct),
    amountYi: finite(row.stock.amountYi),
    level: row.level,
    levelLabel: row.levelLabel,
    identity: row.identity,
    anchorType: row.anchorType,
    tradeState: row.tradeState,
    executionNote: row.executionNote,
    initiative: row.initiative,
    structure: row.structure,
    coreIdentityQualified: row.coreIdentityQualified,
    persistentRecognition: row.persistentRecognition,
    repairCoreQualified: row.repairCoreQualified,
    coreDirectionMatch: row.coreDirectionMatch,
    directionState: row.directionState,
    tradeQualified: row.tradeQualified,
    coreQualified: row.coreQualified,
  });
  const leaders = rows.filter((row) => row.coreIdentityQualified).slice(0, 8).map(compact);
  const tradeCarriers = rows.filter((row) => row.tradeQualified).slice(0, 6).map(compact);
  const observations = rows.filter((row) => !row.tradeQualified && (row.recognized || row.anchorType !== "普通观察")).slice(0, 8).map(compact);

  const mainLineRows = rows.filter((row) => row.focusMatch);
  const mainLineVerified = mainLineRows.filter((row) => isClosingIntradayInitiative(row.initiative)).length;
  const mainLineFullOhlc = mainLineRows.filter((row) => row.initiative.dataQualityKey === "exact_closing_full_ohlc").length;
  const mainLinePriceSeries = mainLineRows.filter((row) => row.initiative.dataQualityKey === "exact_closing_price_series").length;
  const mainLinePartial = mainLineRows.filter((row) => row.initiative.dataQualityKey === "partial_session").length;
  const requiredMainLineCoverage = Math.min(3, mainLineRows.length);
  const dataQuality = !mainLineRows.length
    ? "主线未确认，主动性待验证"
    : mainLineVerified >= requiredMainLineCoverage
      ? "主线分时主动性已验证"
      : mainLineVerified > 0
        ? "主线分时部分验证，其余使用收盘代理"
        : "主线分时不足，使用收盘代理";

  return {
    version: LEADERSHIP_SCHEMA_VERSION,
    focusDirection: focusKeys[0] || "当前主线",
    generatedAt: options.generatedAt || new Date().toISOString(),
    dataQuality,
    principle: "主动性第一；容量是属性，龙头是地位；情绪锚点不自动获得交易资格。",
    leaders,
    tradeCarriers,
    observations,
    counts: {
      candidates: rows.length,
      intraday: intradayByCode.size,
      mainLine: mainLineRows.length,
      mainLineVerified,
      mainLineFullOhlc,
      mainLinePriceSeries,
      mainLinePartial,
      leaders: leaders.length,
      tradeCarriers: tradeCarriers.length,
    },
  };
}

module.exports = {
  LEADERSHIP_SCHEMA_VERSION,
  INTRADAY_CLOSING_COMPLETE_MINUTE,
  finite,
  median,
  timeToMinutes,
  parseIntradayTrendPayload,
  parseTencentMinutePayload,
  normalizeIntradayEvidenceSummary,
  isClosingIntradayInitiative,
  selectLeadershipTargets,
  buildStructureProfile,
  buildCoreLeadershipBoard,
};
