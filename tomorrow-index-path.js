"use strict";

/**
 * 次日指数路径规则权重（纯函数）。
 *
 * 约束：
 * 1. 只预测指数路径，不混入赚钱效应或情绪周期；
 * 2. 大周期只作为风险说明，不进入方向分数，避免与指数结构重复计分；
 * 3. 全A的低开/日内回收/收盘位置合并为一条K线证据，避免同源重复计分；
 * 4. 缺少任一关键收盘证据时 fail-closed，不输出伪权重；
 * 5. 输出是未校准规则权重，不是概率或历史胜率。
 */

const INDEX_PATH_KEYS = Object.freeze(["repair_up", "range", "weak_close"]);

const INDEX_PATH_LABELS = Object.freeze({
  repair_up: "修复上行",
  range: "区间震荡",
  weak_close: "弱势收盘",
  unavailable: "指数路径待确认",
});

// 固定中性起点，不按大周期切换先验。
const NEUTRAL_DIRECTION_SCORES = Object.freeze({
  repair_up: 32,
  range: 38,
  weak_close: 30,
});

const REQUIRED_EVIDENCE_IDS = Object.freeze([
  "major_index_structure",
  "major_index_day",
  "all_a_intraday_path",
  "market_breadth",
  "turnover_comparison",
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value) {
  const digits = String(value == null ? "" : value).replace(/\D/g, "");
  if (digits.length !== 8) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const power = 10 ** digits;
  return Math.round((value + Number.EPSILON) * power) / power;
}

function normalizeBreadth(value) {
  const parsed = finiteNumber(value);
  if (parsed == null) return null;
  const normalized = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
  return normalized >= 0 && normalized <= 1 ? normalized : null;
}

function shiftScores(scores, effect) {
  INDEX_PATH_KEYS.forEach((key) => {
    scores[key] += finiteNumber(effect && effect[key]) || 0;
  });
}

function normalizeWeights(scores) {
  const safe = INDEX_PATH_KEYS.map((key) => Math.max(1, finiteNumber(scores[key]) || 0));
  const total = safe.reduce((sum, value) => sum + value, 0);
  const exact = safe.map((value) => (value / total) * 100);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = 100 - floors.reduce((sum, value) => sum + value, 0);
  exact
    .map((value, index) => ({ index, fraction: value - floors[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
    .forEach((row) => {
      if (remainder > 0) {
        floors[row.index] += 1;
        remainder -= 1;
      }
    });
  return Object.fromEntries(INDEX_PATH_KEYS.map((key, index) => [key, floors[index]]));
}

function primaryFromWeights(weights) {
  if (!weights) {
    return { key: "unavailable", label: INDEX_PATH_LABELS.unavailable, weight: null };
  }
  const key = [...INDEX_PATH_KEYS].sort((a, b) => (
    weights[b] - weights[a] || INDEX_PATH_KEYS.indexOf(a) - INDEX_PATH_KEYS.indexOf(b)
  ))[0];
  return { key, label: INDEX_PATH_LABELS[key], weight: weights[key] };
}

function extractContext(payload, options = {}) {
  const source = isObject(payload) ? payload : {};
  const market = isObject(source.market) ? source.market : {};
  const snapshot = isObject(options.snapshot)
    ? options.snapshot
    : isObject(market.snapshot)
      ? market.snapshot
      : isObject(source.snapshot)
        ? source.snapshot
        : {};
  const limitStats = isObject(options.limitStats)
    ? options.limitStats
    : isObject(market.limitStats)
      ? market.limitStats
      : isObject(source.limitStats)
        ? source.limitStats
        : {};
  const previousPayload = isObject(options.previousPayload)
    ? options.previousPayload
    : isObject(source.previousPayload)
      ? source.previousPayload
      : {};
  const previousMarket = isObject(previousPayload.market) ? previousPayload.market : {};
  const previousSnapshot = isObject(options.previousSnapshot)
    ? options.previousSnapshot
    : isObject(previousMarket.snapshot)
      ? previousMarket.snapshot
      : {};
  const marketState = isObject(options.marketState)
    ? options.marketState
    : isObject(market.state)
      ? market.state
      : isObject(source.marketState)
        ? source.marketState
        : {};
  const dates = isObject(limitStats.dates) ? limitStats.dates : {};
  const tradingDate = normalizeDate(
    options.tradingDate || snapshot.tradingDate || source.tradingDate || dates.today,
  );
  return {
    source,
    snapshot,
    limitStats,
    previousPayload,
    previousSnapshot,
    marketState,
    previousTradingDay: isObject(options.previousTradingDay)
      ? options.previousTradingDay
      : isObject(source.previousTradingDay)
        ? source.previousTradingDay
        : {},
    tradingDate: tradingDate || null,
  };
}

function classifyTrend(row) {
  const raw = String(row && (row.trendKey || row.trendLabel) || "").trim().toLowerCase();
  if (/uptrend|上升|多头/.test(raw)) return "uptrend";
  if (/repair|修复|回暖/.test(raw)) return "repair";
  if (/sideways|震荡|区间/.test(raw)) return "sideways";
  if (/bottom|筑底|止跌/.test(raw)) return "bottoming";
  if (/downtrend|下降|空头|走弱/.test(raw)) return "downtrend";
  return "";
}

function majorIndexStructureEvidence(snapshot, tradingDate) {
  const rows = Array.isArray(snapshot.indexStructures) ? snapshot.indexStructures : [];
  const counts = { uptrend: 0, repair: 0, sideways: 0, bottoming: 0, downtrend: 0 };
  let staleOrUndated = 0;
  rows.forEach((row) => {
    const rowDate = normalizeDate(row && row.date);
    const trend = classifyTrend(row);
    if (!trend) return;
    if (!tradingDate || !rowDate || rowDate !== tradingDate) {
      staleOrUndated += 1;
      return;
    }
    counts[trend] += 1;
  });
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total < 3) {
    return {
      available: false,
      effect: null,
      detail: `同交易日主要指数结构仅${total}个（要求至少3个）；过期或无日期${staleOrUndated}个`,
      metrics: { counts, total, staleOrUndated },
    };
  }
  const ratio = (key) => counts[key] / total;
  let effect = { repair_up: 0, range: 5, weak_close: 0 };
  let summary = "主要指数结构分散，按区间路径处理";
  if (ratio("uptrend") >= 0.5) {
    effect = { repair_up: 6, range: 2, weak_close: -4 };
    summary = "多数主要指数处于上升结构";
  } else if (ratio("repair") >= 0.5) {
    effect = { repair_up: 7, range: 3, weak_close: -3 };
    summary = "多数主要指数处于修复结构";
  } else if (ratio("sideways") >= 0.5) {
    effect = { repair_up: 0, range: 7, weak_close: 0 };
    summary = "多数主要指数处于区间结构";
  } else if (ratio("downtrend") + ratio("bottoming") >= 0.5) {
    // 中期结构只做轻量约束；当日方向另由收盘路径判断，不能把同一风险重复放大。
    effect = { repair_up: -3, range: 3, weak_close: 6 };
    summary = "多数主要指数仍在下行或筑底结构";
  }
  return {
    available: true,
    effect,
    detail: `${summary}（同日有效${total}个）`,
    metrics: { counts, total, staleOrUndated },
  };
}

function majorIndexDayEvidence(snapshot) {
  const value = finiteNumber(snapshot.avgIndexChange);
  if (value == null) {
    return { available: false, effect: null, detail: "主要指数平均涨跌幅缺失", metrics: null };
  }
  let effect = { repair_up: 0, range: 5, weak_close: 0 };
  if (value >= 1) effect = { repair_up: 6, range: 1, weak_close: -4 };
  else if (value >= 0.3) effect = { repair_up: 3, range: 3, weak_close: -2 };
  else if (value <= -1) effect = { repair_up: -5, range: 1, weak_close: 9 };
  else if (value <= -0.3) effect = { repair_up: -1, range: 4, weak_close: 3 };
  return {
    available: true,
    effect,
    detail: `主要指数平均${value >= 0 ? "+" : ""}${value.toFixed(2)}%`,
    metrics: { avgIndexChange: round(value) },
  };
}

function deriveAllAPath(allA) {
  if (!isObject(allA)) return { available: false, reason: "全A OHLC缺失" };
  const previousClose = finiteNumber(allA.prevClose ?? allA.previousClose);
  const open = finiteNumber(allA.open);
  const close = finiteNumber(allA.close ?? allA.price);
  const high = finiteNumber(allA.high);
  const low = finiteNumber(allA.low);
  const valid = [previousClose, open, close, high, low].every((value) => value != null && value > 0)
    && high >= low
    && high >= Math.max(open, close)
    && low <= Math.min(open, close);
  if (!valid) return { available: false, reason: "全A OHLC不完整或价格关系无效" };
  const gapPct = ((open / previousClose) - 1) * 100;
  const openToClosePct = ((close / open) - 1) * 100;
  const closeLocationPct = high === low ? (close >= high ? 100 : 0) : ((close - low) / (high - low)) * 100;
  return {
    available: true,
    gapPct: round(gapPct),
    openToClosePct: round(openToClosePct),
    closeLocationPct: round(closeLocationPct, 1),
  };
}

function allAIntradayEvidence(snapshot) {
  const path = deriveAllAPath(snapshot.allA);
  if (!path.available) {
    return { available: false, effect: null, detail: path.reason, metrics: null };
  }
  const { gapPct, openToClosePct, closeLocationPct } = path;
  let effect = { repair_up: 0, range: 6, weak_close: 0 };
  let summary = "全A日内收盘路径中性";
  if (gapPct <= -0.25 && openToClosePct >= 1 && closeLocationPct >= 75) {
    effect = { repair_up: 20, range: 0, weak_close: -10 };
    summary = "全A低开探底后强收";
  } else if (openToClosePct >= 0.8 && closeLocationPct >= 70) {
    effect = { repair_up: 11, range: 2, weak_close: -6 };
    summary = "全A日内明显回收并收在高位";
  } else if (gapPct >= 0.5 && openToClosePct <= -0.8 && closeLocationPct <= 40) {
    effect = { repair_up: -6, range: 2, weak_close: 12 };
    summary = "全A高开回落且收盘偏弱";
  } else if (openToClosePct <= -1 && closeLocationPct <= 30) {
    effect = { repair_up: -8, range: 0, weak_close: 16 };
    summary = "全A日内单边走弱并收在低位";
  } else if (openToClosePct <= -0.4 && closeLocationPct <= 35) {
    effect = { repair_up: -5, range: 3, weak_close: 10 };
    summary = "全A日内回落且尾盘承接不足";
  } else if (openToClosePct >= 0.35 && closeLocationPct >= 60) {
    effect = { repair_up: 6, range: 3, weak_close: -3 };
    summary = "全A温和回收并收在中高位";
  }
  return {
    available: true,
    effect,
    detail: `${summary}：缺口${gapPct >= 0 ? "+" : ""}${gapPct.toFixed(2)}%，开收到${openToClosePct >= 0 ? "+" : ""}${openToClosePct.toFixed(2)}%，收盘位置${closeLocationPct.toFixed(1)}%`,
    metrics: path,
  };
}

function breadthEvidence(snapshot) {
  const breadth = normalizeBreadth(snapshot.breadth ?? (isObject(snapshot.allA) ? snapshot.allA.breadth : null));
  if (breadth == null) {
    return { available: false, effect: null, detail: "上涨覆盖率缺失或超出0-100%", metrics: null };
  }
  let effect = { repair_up: 0, range: 7, weak_close: 0 };
  if (breadth >= 0.7) effect = { repair_up: 10, range: -2, weak_close: -5 };
  else if (breadth >= 0.58) effect = { repair_up: 6, range: 1, weak_close: -3 };
  else if (breadth <= 0.3) effect = { repair_up: -6, range: 0, weak_close: 12 };
  else if (breadth <= 0.42) effect = { repair_up: -3, range: 4, weak_close: 7 };
  return {
    available: true,
    effect,
    detail: `上涨覆盖率${Math.round(breadth * 100)}%`,
    metrics: { breadth: round(breadth, 4), breadthPct: Math.round(breadth * 100) },
  };
}

function assessExactPreviousDay(context) {
  const currentDates = isObject(context.limitStats.dates) ? context.limitStats.dates : {};
  const meta = context.previousTradingDay;
  const archiveMeta = isObject(context.previousPayload.archiveMeta) ? context.previousPayload.archiveMeta : {};
  const expectedDate = normalizeDate(
    meta.expectedDate
      || meta.expectedPreviousTradingDate
      || (currentDates.verified === true ? currentDates.prev : ""),
  );
  const actualDate = normalizeDate(
    meta.actualDate
      || meta.previousArchiveDate
      || archiveMeta.tradingDate
      || context.previousSnapshot.tradingDate,
  );
  const snapshotKind = String(meta.snapshotKind || archiveMeta.snapshotKind || "").trim().toLowerCase();
  const verified = meta.exactPreviousTradingDay === true
    || meta.verified === true
    || currentDates.verified === true;
  const exact = Boolean(
    verified
      && expectedDate
      && actualDate
      && expectedDate === actualDate
      && snapshotKind === "closing",
  );
  let reason = "缺少经交易日校验的T-1收盘快照";
  if (exact) reason = `已匹配精确T-1收盘快照 ${actualDate}`;
  else if (expectedDate && actualDate && expectedDate !== actualDate) {
    reason = `期望T-1为${expectedDate}，实际为${actualDate}`;
  } else if (actualDate && snapshotKind !== "closing") {
    reason = `T-1快照类型为${snapshotKind || "unknown"}，不是closing`;
  }
  return { exact, expectedDate: expectedDate || null, actualDate: actualDate || null, snapshotKind: snapshotKind || null, reason };
}

function turnoverEvidence(context, allAPath) {
  const assessment = assessExactPreviousDay(context);
  const currentAmount = finiteNumber(context.snapshot.shszAmountYi ?? context.snapshot.totalAmountYi);
  const previousAmount = finiteNumber(
    context.previousSnapshot.shszAmountYi ?? context.previousSnapshot.totalAmountYi,
  );
  if (!assessment.exact || currentAmount == null || previousAmount == null || currentAmount <= 0 || previousAmount <= 0) {
    return {
      available: false,
      effect: null,
      detail: `${assessment.reason}；成交额环比不参与方向权重`,
      metrics: { ...assessment, currentAmountYi: currentAmount, previousAmountYi: previousAmount },
    };
  }
  const ratio = currentAmount / previousAmount;
  let effect = { repair_up: 0, range: 4, weak_close: 0 };
  let summary = "成交额环比处于常规区间";
  if (ratio >= 1.1 && allAPath && allAPath.openToClosePct >= 0.5 && allAPath.closeLocationPct >= 60) {
    effect = { repair_up: 4, range: 1, weak_close: -2 };
    summary = "放量且全A承接偏强";
  } else if (ratio >= 1.1 && allAPath && allAPath.openToClosePct <= -0.6 && allAPath.closeLocationPct <= 40) {
    effect = { repair_up: -2, range: 1, weak_close: 6 };
    summary = "放量弱收，抛压得到成交确认";
  } else if (ratio < 0.75) {
    effect = { repair_up: -2, range: 4, weak_close: 5 };
    summary = "成交额显著收缩，方向确认不足";
  } else if (ratio < 0.9) {
    effect = { repair_up: -1, range: 3, weak_close: 3 };
    summary = "成交额温和收缩";
  }
  return {
    available: true,
    effect,
    detail: `${summary}：精确T-1成交比${Math.round(ratio * 100)}%`,
    metrics: {
      ...assessment,
      currentAmountYi: round(currentAmount),
      previousAmountYi: round(previousAmount),
      ratio: round(ratio, 4),
    },
  };
}

function normalizeCycleRisk(value) {
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (/主升|main[_ -]?rise/.test(text)) return { key: "main_rise", label: "主升", level: "normal" };
  if (/退潮|retreat|decline|weakening/.test(text)) return { key: "retreat", label: "退潮", level: "high" };
  if (/冰点|ice/.test(text)) return { key: "ice_point", label: "冰点", level: "high" };
  if (/震荡|range|sideways/.test(text)) return { key: "range", label: "震荡", level: "medium" };
  if (/混沌|chaos/.test(text)) return { key: "chaos", label: "混沌", level: "medium" };
  return { key: "unknown", label: "大周期待确认", level: "unknown" };
}

function cycleRiskContext(context) {
  const premarketModels = isObject(context.source.premarketModels) ? context.source.premarketModels : {};
  const canonical = isObject(context.source.indexCycleRegime)
    ? context.source.indexCycleRegime
    : isObject(premarketModels.indexCycleRegime)
      ? premarketModels.indexCycleRegime
      : isObject(context.marketState.indexCycleRegime)
        ? context.marketState.indexCycleRegime
        : {};
  const raw = isObject(canonical.structuralCycle)
    ? canonical.structuralCycle.key || canonical.structuralCycle.label
    : canonical.structuralCycle
      || context.marketState.structuralCycle
      || context.marketState.cycle;
  const normalized = normalizeCycleRisk(raw);
  return {
    ...normalized,
    directionWeightImpact: 0,
    note: "大周期只约束交易风险与仓位上限，不参与次日指数方向权重，避免与主要指数结构重复计分。",
  };
}

function buildTomorrowIndexPath(payload, options = {}) {
  const context = extractContext(payload, options);
  const scores = { ...NEUTRAL_DIRECTION_SCORES };
  const evidence = [];
  const addEvidence = (id, label, result) => {
    const row = {
      id,
      label,
      scope: "index_direction",
      available: Boolean(result && result.available),
      effect: result && result.available && result.effect ? { ...result.effect } : null,
      detail: String(result && result.detail || ""),
      metrics: result && result.metrics ? { ...result.metrics } : null,
    };
    evidence.push(row);
    if (row.available) shiftScores(scores, row.effect);
    return row;
  };

  addEvidence(
    "major_index_structure",
    "主要指数结构",
    majorIndexStructureEvidence(context.snapshot, context.tradingDate),
  );
  addEvidence("major_index_day", "主要指数当日强弱", majorIndexDayEvidence(context.snapshot));
  const allAResult = allAIntradayEvidence(context.snapshot);
  addEvidence("all_a_intraday_path", "全A日内收盘路径", allAResult);
  addEvidence("market_breadth", "市场宽度", breadthEvidence(context.snapshot));
  addEvidence(
    "turnover_comparison",
    "两市成交环比",
    turnoverEvidence(context, allAResult.metrics),
  );

  const missingFields = REQUIRED_EVIDENCE_IDS.filter((id) => (
    !evidence.some((row) => row.id === id && row.available)
  ));
  const available = Boolean(context.tradingDate) && missingFields.length === 0;
  if (!context.tradingDate) missingFields.unshift("trading_date");
  const weights = available ? normalizeWeights(scores) : null;
  const primary = primaryFromWeights(weights);
  const scenarios = INDEX_PATH_KEYS.map((key) => ({
    key,
    label: INDEX_PATH_LABELS[key],
    weight: weights ? weights[key] : null,
  }));
  const knownEvidenceCount = evidence.filter((row) => row.available).length;
  const coveragePct = Math.round((knownEvidenceCount / REQUIRED_EVIDENCE_IDS.length) * 100);

  return {
    version: 1,
    tradingDate: context.tradingDate,
    available,
    method: "deterministic_rule_weights",
    methodLabel: "指数路径规则权重（未历史校准）",
    calibrated: false,
    probabilitySemantics: false,
    prior: { ...NEUTRAL_DIRECTION_SCORES },
    weights,
    primary,
    scenarios,
    evidence,
    riskContext: cycleRiskContext(context),
    dataQuality: {
      grade: available ? "complete" : "insufficient",
      failClosed: !available,
      knownEvidenceCount,
      totalEvidenceCount: REQUIRED_EVIDENCE_IDS.length,
      coveragePct,
      missingFields: [...new Set(missingFields)],
      note: available
        ? "五类T日收盘证据齐全；规则权重可展示，但不是概率或胜率。"
        : "关键T日收盘证据不完整；已失败关闭，不输出方向权重。",
    },
  };
}

module.exports = {
  INDEX_PATH_KEYS,
  INDEX_PATH_LABELS,
  NEUTRAL_DIRECTION_SCORES,
  REQUIRED_EVIDENCE_IDS,
  buildTomorrowIndexPath,
  deriveAllAPath,
  normalizeDate,
};
