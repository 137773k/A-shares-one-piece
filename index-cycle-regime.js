"use strict";

const {
  BIG_CYCLE_VALUES,
  normalizeBigCycle,
  repairTransition,
  smallCycleFromSignals,
} = require("./quant-decision/market-cycle-contract");

/**
 * 多周期指数状态识别。
 *
 * 纯函数约束：
 * - 不读文件、不读系统时间、不修改输入；
 * - 中期以 20/60 日结构为主，10日斜率只作中期修复辅助；短期只看 5 日结构；
 * - 当日 OHLC 只描述执行节奏，不反向改写中期结构；
 * - 缺失数据保持 null / unknown，绝不把缺失值补成 0。
 */

const INDEX_CYCLE_REGIME_VERSION = 5;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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

function round(value, digits = 2) {
  const number = finite(value);
  if (number === null) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function normalizeRatio(value) {
  const number = finite(value);
  if (number === null) return null;
  if (number > 1 && number <= 100) return number / 100;
  return number;
}

function compare(left, right, tolerance = 0) {
  const a = finite(left);
  const b = finite(right);
  if (a === null || b === null) return null;
  if (a > b + tolerance) return 1;
  if (a < b - tolerance) return -1;
  return 0;
}

function codeOf(row) {
  return String(row && (row.code || row.symbol || row.secCode) || "").trim();
}

function nameOf(row, index) {
  return String(row && row.name || codeOf(row) || `指数${index + 1}`).trim();
}

function rowKey(row, index) {
  return codeOf(row) || nameOf(row, index);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function readInput(input) {
  const source = isObject(input) ? input : {};
  const market = isObject(source.market) ? source.market : {};
  const snapshot = isObject(source.snapshot)
    ? source.snapshot
    : isObject(market.snapshot) ? market.snapshot : {};
  const structures = list(source.indexStructures).length
    ? list(source.indexStructures)
    : list(snapshot.indexStructures).length
      ? list(snapshot.indexStructures)
      : list(market.indexStructures);
  const liveIndexes = list(snapshot.indexes).length
    ? list(snapshot.indexes)
    : list(source.indexes);
  const intradaySource = isObject(source.intraday) ? source.intraday : {};
  const intradayIndexes = list(intradaySource.indexes).length
    ? list(intradaySource.indexes)
    : list(intradaySource.items);

  return {
    snapshot,
    structures,
    liveIndexes,
    intradaySource,
    intradayIndexes,
    previous: isObject(source.previous) ? source.previous : null,
    currentMarketState: isObject(source.currentMarketState)
      ? source.currentMarketState
      : isObject(market.state) ? market.state : null,
    previousMarketState: isObject(source.previousMarketState)
      ? source.previousMarketState
      : isObject(source.previous) && isObject(source.previous.state) ? source.previous.state : null,
    generationContext: [source.generationContext, snapshot.generationContext, market.generationContext]
      .find(isObject) || null,
  };
}

function indexMap(rows) {
  const map = new Map();
  list(rows).forEach((row, index) => {
    if (!isObject(row)) return;
    const code = codeOf(row);
    const name = nameOf(row, index);
    if (code) map.set(`code:${code}`, row);
    if (name) map.set(`name:${name}`, row);
  });
  return map;
}

function matchingRow(map, row, index) {
  const code = codeOf(row);
  const name = nameOf(row, index);
  return (code && map.get(`code:${code}`)) || (name && map.get(`name:${name}`)) || {};
}

function normalizeIndexRows(context) {
  const liveMap = indexMap(context.liveIndexes);
  const intradayMap = indexMap(context.intradayIndexes);
  return context.structures.filter(isObject).map((structure, index) => {
    const live = matchingRow(liveMap, structure, index);
    const intraday = matchingRow(intradayMap, structure, index);
    const merged = { ...structure, ...live, ...intraday };
    const close = firstFinite(merged.close, merged.price, merged.current);
    const ma5 = finite(merged.ma5);
    const ma10 = finite(merged.ma10);
    const ma20 = finite(merged.ma20);
    const ma60 = finite(merged.ma60);
    const slope5 = finite(merged.slope5);
    const slope10 = finite(merged.slope10);
    const slope20 = finite(merged.slope20);
    return {
      code: codeOf(merged) || null,
      name: nameOf(merged, index),
      date: merged.date || merged.tradingDate || null,
      close,
      changePct: firstFinite(merged.changePct, merged.change),
      open: finite(merged.open),
      high: finite(merged.high),
      low: finite(merged.low),
      prevClose: firstFinite(merged.prevClose, merged.previousClose),
      vwap: firstFinite(merged.vwap, merged.averagePrice, merged.avgPrice),
      ma5,
      ma10,
      ma20,
      ma60,
      slope5,
      slope10,
      slope20,
      aboveMa5: compare(close, ma5) === null ? null : compare(close, ma5) >= 0,
      aboveMa10: compare(close, ma10) === null ? null : compare(close, ma10) >= 0,
      aboveMa20: compare(close, ma20) === null ? null : compare(close, ma20) >= 0,
      aboveMa60: compare(close, ma60) === null ? null : compare(close, ma60) >= 0,
      ma5AboveMa10: compare(ma5, ma10) === null ? null : compare(ma5, ma10) >= 0,
      ma20AboveMa60: compare(ma20, ma60) === null ? null : compare(ma20, ma60) >= 0,
      trendKey: String(merged.trendKey || "unknown"),
      trendLabel: String(merged.trendLabel || ""),
    };
  });
}

function knownRate(rows, field, predicate = Boolean) {
  const known = rows.filter((row) => row[field] !== null && row[field] !== undefined);
  return {
    known: known.length,
    count: known.filter((row) => predicate(row[field], row)).length,
    rate: known.length ? known.filter((row) => predicate(row[field], row)).length / known.length : null,
  };
}

function classifyMediumIndex(row) {
  const factsKnown = [row.aboveMa20, row.aboveMa60, row.slope20]
    .filter((value) => value !== null).length;
  if (factsKnown < 2) {
    return {
      key: "unknown",
      label: "中期结构待确认",
      mainRiseCandidate: false,
      evidence: ["20日/60日结构数据不足"],
    };
  }

  const slope20Positive = row.slope20 === null ? null : row.slope20 > 0;
  const slope10Positive = row.slope10 === null ? null : row.slope10 > 0;
  const mainRise = row.aboveMa20 === true
    && row.aboveMa60 === true
    && slope20Positive === true
    && row.ma20AboveMa60 !== false;
  const candidate = row.aboveMa20 === true
    && (row.aboveMa60 !== true || slope20Positive !== true)
    && (row.slope5 === null || row.slope5 > 0)
    && slope10Positive !== false;
  const repair = row.aboveMa20 === true
    || /repair|修复/i.test(`${row.trendKey} ${row.trendLabel}`);
  const decline = row.aboveMa20 === false
    && row.aboveMa60 === false
    && slope20Positive === false
    && slope10Positive === false;

  if (mainRise) {
    return {
      key: "main_rise",
      label: "中期主升结构",
      mainRiseCandidate: false,
      evidence: ["站上20日与60日线", "20日斜率向上", "20日线不弱于60日线"],
    };
  }
  if (candidate) {
    return {
      key: "repair_candidate",
      label: "中期修复·主升候选",
      mainRiseCandidate: true,
      evidence: [
        "已站上20日线",
        row.aboveMa60 === false ? "尚未站上60日线" : "60日线状态待巩固",
        slope20Positive === false ? "20日斜率尚未转正" : "20日斜率待确认",
      ],
    };
  }
  if (repair) {
    return {
      key: "repair",
      label: "中期修复",
      mainRiseCandidate: false,
      evidence: [
        row.aboveMa20 === true ? "已收复20日线" : "仍按修复结构观察",
        row.aboveMa60 === false ? "仍受60日线压制" : "60日线位置待确认",
      ],
    };
  }
  if (decline) {
    return {
      key: "decline",
      label: "中期下降结构",
      mainRiseCandidate: false,
      evidence: ["位于20日与60日线下", "10日与20日斜率向下"],
    };
  }
  return {
    key: "range",
    label: "中期震荡",
    mainRiseCandidate: false,
    evidence: ["20日与60日证据方向不一致"],
  };
}

function classifyMediumTerm(rows) {
  const indexes = rows.map((row) => ({ ...row, ...classifyMediumIndex(row) }));
  const known = indexes.filter((row) => row.key !== "unknown");
  const mainRiseCount = known.filter((row) => row.key === "main_rise").length;
  const candidateCount = known.filter((row) => row.key === "repair_candidate").length;
  const repairCount = known.filter((row) => row.key === "repair").length;
  const declineCount = known.filter((row) => row.key === "decline").length;
  const above20 = knownRate(rows, "aboveMa20", Boolean);
  const above60 = knownRate(rows, "aboveMa60", Boolean);
  const slope20Up = knownRate(rows, "slope20", (value) => value > 0);
  const coverage = ratio(known.length, rows.length);

  let key = "unknown";
  let label = "中期结构待确认";
  let mainRiseCandidate = false;
  if (known.length) {
    if (ratio(mainRiseCount, known.length) >= 0.75) {
      key = "main_rise";
      label = "中期主升结构";
    } else if (
      ratio(mainRiseCount + candidateCount + repairCount, known.length) >= 0.5
      && above20.rate !== null
      && above20.rate >= 0.5
    ) {
      mainRiseCandidate = mainRiseCount + candidateCount > 0 || above20.rate >= 0.75;
      key = mainRiseCandidate ? "repair_candidate" : "repair";
      label = mainRiseCandidate ? "中期修复·主升候选" : "中期修复";
    } else if (ratio(declineCount, known.length) >= 0.5) {
      key = "decline";
      label = "中期下降结构";
    } else {
      key = "range";
      label = "中期震荡";
    }
  }

  const evidence = [];
  if (above20.rate !== null) evidence.push(`${above20.count}/${above20.known}个主要指数站上20日线`);
  if (above60.rate !== null) evidence.push(`${above60.count}/${above60.known}个主要指数站上60日线`);
  if (slope20Up.rate !== null) evidence.push(`${slope20Up.count}/${slope20Up.known}个主要指数20日斜率向上`);
  if (!evidence.length) evidence.push("20日/60日结构覆盖不足，保持unknown");

  return {
    key,
    label,
    cycleKey: key === "repair_candidate" ? "repair" : key,
    mainRiseCandidate,
    confirmed: key !== "unknown",
    coverage,
    metrics: {
      indexCount: rows.length || null,
      knownIndexCount: known.length || null,
      aboveMa20Count: above20.known ? above20.count : null,
      aboveMa20Rate: round(above20.rate, 3),
      aboveMa60Count: above60.known ? above60.count : null,
      aboveMa60Rate: round(above60.rate, 3),
      slope20UpCount: slope20Up.known ? slope20Up.count : null,
      slope20UpRate: round(slope20Up.rate, 3),
    },
    evidence,
    indexes,
  };
}

function classifyShortIndex(row, mediumIndex) {
  const factsKnown = [row.aboveMa5, row.slope5]
    .filter((value) => value !== null).length;
  if (factsKnown < 2) {
    return {
      key: "unknown",
      label: "5日短周期待确认",
      positive: null,
      evidence: ["5日结构数据不足"],
    };
  }

  const slope5Positive = row.slope5 === null ? null : row.slope5 > 0;
  const above5 = row.aboveMa5;
  const mediumSupportive = mediumIndex.key === "main_rise" || mediumIndex.key === "repair_candidate";
  const pullback = above5 === false
    && slope5Positive === true
    && mediumSupportive;

  if (pullback) {
    return {
      key: "main_rise_pullback",
      label: "5日主升结构内回踩",
      positive: true,
      evidence: ["价格暂处5日线下", "5日斜率仍向上", "中期结构仍有支撑", "只计结构内回踩，不直接判转弱"],
    };
  }
  if (above5 === true && slope5Positive === true) {
    return {
      key: "main_rise",
      label: "5日短线主升段",
      positive: true,
      evidence: ["价格站上5日线", "5日斜率向上"],
    };
  }
  if (above5 === true) {
    return {
      key: "repair",
      label: "5日短周期修复",
      positive: true,
      evidence: ["价格站上5日线", "5日斜率尚未转正，仍按修复观察"],
    };
  }
  if (above5 === false && slope5Positive === false) {
    return {
      key: "weakening",
      label: "5日短周期转弱",
      positive: false,
      evidence: ["位于5日线下", "5日斜率未向上"],
    };
  }
  return {
    key: "range",
    label: "5日短周期震荡",
    positive: false,
    evidence: ["5日结构证据互相冲突"],
  };
}

function isShanghai(row) {
  return row.code === "000001" || /上证指数|上证综指/.test(row.name);
}

function classifyShortTerm(rows, mediumTerm) {
  const mediumByKey = new Map(mediumTerm.indexes.map((row, index) => [rowKey(row, index), row]));
  const indexes = rows.map((row, index) => ({
    ...row,
    ...classifyShortIndex(row, mediumByKey.get(rowKey(row, index)) || classifyMediumIndex(row)),
  }));
  const known = indexes.filter((row) => row.key !== "unknown");
  const mainRise = known.filter((row) => row.key === "main_rise" || row.key === "main_rise_pullback");
  const repair = known.filter((row) => row.key === "repair");
  const weakening = known.filter((row) => row.key === "weakening");
  const aboveMa5 = knownRate(rows, "aboveMa5", Boolean);
  const shanghai = indexes.find(isShanghai) || null;
  const mainRiseRate = ratio(mainRise.length, known.length);
  const positiveRate = ratio(mainRise.length + repair.length, known.length);

  let key = "unknown";
  let label = "5日短周期待确认";
  if (known.length) {
    if (mainRiseRate >= 0.75) {
      key = "main_rise";
      label = "全市场短线主升段";
    } else if (mainRise.length > 0) {
      key = "partial_main_rise";
      label = shanghai && (shanghai.key === "main_rise" || shanghai.key === "main_rise_pullback")
        ? "上证短线主升段·全市场待共振"
        : `${mainRise.map((row) => row.name).join("、")}短线主升·全市场待共振`;
    } else if (positiveRate !== null && positiveRate >= 0.5) {
      key = "repair";
      label = "全市场5日短周期修复";
    } else if (ratio(weakening.length, known.length) >= 0.5) {
      key = "weakening";
      label = "全市场5日短周期转弱";
    } else {
      key = "range";
      label = "全市场5日短周期震荡";
    }
  }

  const evidence = [];
  if (known.length) evidence.push(`${mainRise.length}/${known.length}个主要指数处于短线主升或主升调整`);
  if (repair.length) evidence.push(`${repair.length}个指数仍在5日短周期修复`);
  if (shanghai && shanghai.key !== "unknown") evidence.push(`上证指数：${shanghai.label}`);
  if (!evidence.length) evidence.push("5日结构覆盖不足，保持unknown");

  return {
    windowDays: 5,
    key,
    label,
    confirmed: key !== "unknown",
    fullMarketResonance: key === "main_rise",
    metrics: {
      windowDays: 5,
      indexCount: rows.length || null,
      knownIndexCount: known.length || null,
      mainRiseCount: known.length ? mainRise.length : null,
      mainRiseRate: round(mainRiseRate, 3),
      positiveCount: known.length ? mainRise.length + repair.length : null,
      positiveRate: round(positiveRate, 3),
      aboveMa5Count: aboveMa5.known ? aboveMa5.count : null,
      aboveMa5KnownCount: aboveMa5.known || null,
      aboveMa5Rate: round(aboveMa5.rate, 3),
    },
    evidence,
    indexes,
  };
}

function classifyFiveDayIndex(row, shortIndex) {
  if (row.aboveMa5 === null && row.slope5 === null) {
    return { key: "unknown", label: "5日节奏待确认", structuralBreak: null };
  }
  if (shortIndex.key === "main_rise_pullback") {
    return { key: "ma5_adjustment", label: "主升中的5日线调整", structuralBreak: false };
  }
  if (row.aboveMa5 === true && row.slope5 !== null && row.slope5 > 0) {
    const pullbackDay = row.changePct !== null && row.changePct < 0;
    return {
      key: pullbackDay ? "pullback_above_ma5" : "advance",
      label: pullbackDay ? "5日线上方日内调整" : "5日节奏向上",
      structuralBreak: false,
    };
  }
  if (row.aboveMa5 === false && row.slope5 !== null && row.slope5 > 0) {
    return { key: "ma5_adjustment", label: "主升中的5日线调整", structuralBreak: false };
  }
  if (row.aboveMa5 === false && row.slope5 !== null && row.slope5 <= 0) {
    return { key: "weakening", label: "5日结构转弱", structuralBreak: true };
  }
  return { key: "range", label: "5日节奏震荡", structuralBreak: false };
}

function readAllA(snapshot, intradaySource) {
  const allA = isObject(intradaySource.allA)
    ? intradaySource.allA
    : isObject(snapshot.allA) ? snapshot.allA : {};
  return {
    code: allA.code || null,
    name: allA.name || "全A",
    close: firstFinite(allA.close, allA.price, allA.current),
    open: finite(allA.open),
    high: finite(allA.high),
    low: finite(allA.low),
    prevClose: firstFinite(allA.prevClose, allA.previousClose),
    changePct: firstFinite(allA.changePct, snapshot.allAChangePct),
    vwap: firstFinite(allA.vwap, allA.averagePrice, allA.avgPrice),
  };
}

function classifySession(snapshot, intradaySource) {
  const allA = readAllA(snapshot, intradaySource);
  const breadth = normalizeRatio(firstFinite(snapshot.breadth, snapshot.advanceRatio));
  const priced = [allA.close, allA.open, allA.high, allA.low, allA.prevClose]
    .filter((value) => value !== null).length;
  const openToClosePct = allA.open !== null && allA.close !== null && allA.open !== 0
    ? (allA.close / allA.open - 1) * 100
    : null;
  const amplitudePct = allA.high !== null && allA.low !== null && allA.prevClose !== null && allA.prevClose !== 0
    ? (allA.high - allA.low) / allA.prevClose * 100
    : null;
  const closeLocationPct = allA.high !== null && allA.low !== null && allA.close !== null && allA.high > allA.low
    ? (allA.close - allA.low) / (allA.high - allA.low) * 100
    : allA.high !== null && allA.low !== null && allA.close !== null && allA.high === allA.low
      ? null
      : null;
  const gapPct = allA.open !== null && allA.prevClose !== null && allA.prevClose !== 0
    ? (allA.open / allA.prevClose - 1) * 100
    : null;
  const lowVsPrevPct = allA.low !== null && allA.prevClose !== null && allA.prevClose !== 0
    ? (allA.low / allA.prevClose - 1) * 100
    : null;

  let key = "unknown";
  let label = "分时节奏待确认";
  let tone = "unknown";
  const evidence = [];
  if (priced >= 4 && openToClosePct !== null && closeLocationPct !== null) {
    if (
      allA.changePct !== null && allA.changePct > 0
      && openToClosePct > 0
      && closeLocationPct >= 80
      && (breadth === null || breadth >= 0.5)
    ) {
      key = lowVsPrevPct !== null && lowVsPrevPct < 0 ? "recovery_strong_close" : "strong_close";
      label = lowVsPrevPct !== null && lowVsPrevPct < 0 ? "探底回升并收于高位" : "分时强收于高位";
      tone = "good";
    } else if (gapPct !== null && gapPct > 0.5 && openToClosePct < 0 && closeLocationPct <= 45) {
      key = "gap_fade";
      label = "高开兑现、分时走弱";
      tone = "bad";
    } else if (
      allA.changePct !== null && allA.changePct < 0
      && openToClosePct <= 0
      && closeLocationPct <= 35
    ) {
      key = "weak_close";
      label = "分时弱收";
      tone = "bad";
    } else {
      key = "mixed";
      label = "分时震荡、强弱混合";
      tone = "warn";
    }
    evidence.push(`全A开盘至收盘${openToClosePct >= 0 ? "+" : ""}${round(openToClosePct, 2)}%`);
    evidence.push(`收盘位于日内振幅${round(closeLocationPct, 0)}%位置`);
    if (breadth !== null) evidence.push(`上涨广度${round(breadth * 100, 0)}%`);
  } else {
    evidence.push("缺少全A开高低收，不能用收盘涨幅冒充分时节奏");
  }

  return {
    key,
    label,
    tone,
    confirmed: key !== "unknown",
    evidence,
    metrics: {
      changePct: round(allA.changePct),
      gapPct: round(gapPct),
      openToClosePct: round(openToClosePct),
      amplitudePct: round(amplitudePct),
      closeLocationPct: round(closeLocationPct, 1),
      breadth: round(breadth, 3),
    },
    allA,
  };
}

function classifyIntraday(rows, shortTerm, snapshot, intradaySource) {
  const shortByKey = new Map(shortTerm.indexes.map((row, index) => [rowKey(row, index), row]));
  const indexes = rows.map((row, index) => ({
    code: row.code,
    name: row.name,
    changePct: row.changePct,
    aboveMa5: row.aboveMa5,
    aboveMa10: row.aboveMa10,
    slope5: row.slope5,
    ...classifyFiveDayIndex(row, shortByKey.get(rowKey(row, index)) || { key: "unknown" }),
  }));
  const known = indexes.filter((row) => row.key !== "unknown");
  const constructive = known.filter((row) => ["advance", "pullback_above_ma5", "ma5_adjustment"].includes(row.key));
  const broken = known.filter((row) => row.structuralBreak === true);
  const session = classifySession(snapshot, intradaySource);
  let fiveDayKey = "unknown";
  let fiveDayLabel = "5日节奏待确认";
  if (known.length) {
    if (ratio(constructive.length, known.length) >= 0.75) {
      fiveDayKey = indexes.some((row) => row.key === "ma5_adjustment" || row.key === "pullback_above_ma5")
        ? "constructive_with_pullback"
        : "advance";
      fiveDayLabel = fiveDayKey === "advance" ? "5日节奏整体向上" : "5日节奏向上、允许结构内调整";
    } else if (ratio(broken.length, known.length) >= 0.5) {
      fiveDayKey = "weakening";
      fiveDayLabel = "5日节奏转弱";
    } else {
      fiveDayKey = "mixed";
      fiveDayLabel = "5日节奏分化";
    }
  }

  return {
    key: session.key,
    label: session.label,
    tone: session.tone,
    confirmed: session.confirmed,
    fiveDay: {
      key: fiveDayKey,
      label: fiveDayLabel,
      metrics: {
        knownIndexCount: known.length || null,
        constructiveCount: known.length ? constructive.length : null,
        constructiveRate: round(ratio(constructive.length, known.length), 3),
        structuralBreakCount: known.length ? broken.length : null,
      },
      indexes,
    },
    session,
  };
}

function buildConsensus(mediumTerm, shortTerm, intraday) {
  if (mediumTerm.key === "unknown" || shortTerm.key === "unknown") {
    return {
      key: "unknown",
      label: "全市场共振待确认",
      confirmed: false,
      reasons: ["中期或5日短周期关键数据不足"],
    };
  }
  if (
    mediumTerm.key === "main_rise"
    && shortTerm.key === "main_rise"
    && !["gap_fade", "weak_close"].includes(intraday.key)
  ) {
    return {
      key: "confirmed",
      label: "中短周期共振",
      confirmed: true,
      reasons: [mediumTerm.label, shortTerm.label, intraday.confirmed ? intraday.label : "分时待下一步确认"],
    };
  }
  if (shortTerm.key === "partial_main_rise") {
    return {
      key: "pending",
      label: shortTerm.label,
      confirmed: false,
      reasons: [mediumTerm.label, "仅部分指数进入5日短线主升，不能外推为全市场主升", intraday.label],
    };
  }
  if (mediumTerm.key === "decline" || shortTerm.key === "weakening") {
    return {
      key: "failed",
      label: "中短周期未共振",
      confirmed: false,
      reasons: [mediumTerm.label, shortTerm.label],
    };
  }
  return {
    key: "pending",
    label: "中短周期修复·全市场待共振",
    confirmed: false,
    reasons: [mediumTerm.label, shortTerm.label, intraday.label],
  };
}

function validationRules(mediumTerm, shortTerm) {
  const total = mediumTerm.metrics.indexCount;
  const quorum = total === null ? null : Math.max(1, Math.ceil(total * 0.75));
  const quorumText = quorum === null ? "多数主要指数" : `至少${quorum}/${total}个主要指数`;
  return {
    upgrade: [
      `${quorumText}站上20日线并保持5日斜率向上`,
      `${quorumText}进入短线主升或主升调整，确认全市场共振`,
      "20日斜率转正、60日线压力被有效消化后，才确认中期主升",
    ],
    hold: [
      "短线主升指数回踩5日线但5日斜率仍向上，仍按结构内调整处理",
      "中期仍站在20日线上、负斜率继续收敛，维持修复/主升候选",
    ],
    downgrade: [
      `${quorumText}跌回20日线下且5日斜率转负`,
      "短线主升指数跌破5日线且5日斜率转负，结构升级为转弱",
      "全A高开低走且收盘落在日内低位，取消次日扩仓条件",
    ],
    current: {
      mediumKey: mediumTerm.key,
      shortKey: shortTerm.key,
      fullMarketResonance: shortTerm.fullMarketResonance,
    },
  };
}

function buildOpportunities(mediumTerm, shortTerm, intraday) {
  const rows = [];
  const shortLeaders = shortTerm.indexes
    .filter((row) => row.key === "main_rise" || row.key === "main_rise_pullback")
    .map((row) => row.name);
  const pullbacks = shortTerm.indexes
    .filter((row) => row.key === "main_rise_pullback")
    .map((row) => row.name);

  if (mediumTerm.key === "repair_candidate") {
    rows.push({
      key: "medium_upgrade_confirmation",
      label: "中期修复向主升确认",
      status: "watch",
      targets: mediumTerm.indexes.filter((row) => row.mainRiseCandidate).map((row) => row.name),
      trigger: ["20日斜率转正", "站稳60日线", "至少四分之三主要指数同步站上20日线"],
      action: "确认后才向下游开放全市场主升权限；确认前只按修复候选处理。",
      cancel: ["重新跌回20日线下", "5日斜率转负并扩散"],
    });
  }
  if (shortLeaders.length) {
    rows.push({
      key: "short_main_rise_ma5_support",
      label: "短线主升的5日线承接",
      status: pullbacks.length ? "active" : "watch",
      targets: pullbacks.length ? pullbacks : shortLeaders,
      trigger: ["回踩或短暂跌破5日线", "5日斜率仍向上", "日内重新站回均价或收盘位置改善"],
      action: "只把它视为节奏机会；仍需题材、个股和价格校验通过。",
      cancel: ["跌破5日线且5日斜率转负", "主要指数5日结构同步转弱", "分时高开低走且收于低位"],
    });
  }
  if (shortTerm.key === "partial_main_rise") {
    rows.push({
      key: "full_market_resonance",
      label: "全市场短周期共振确认",
      status: "watch",
      targets: shortTerm.indexes.filter((row) => row.key === "repair").map((row) => row.name),
      trigger: ["修复指数的5日斜率转正", "短线主升覆盖升至至少四分之三", "全A分时不出现高开兑现"],
      action: "共振成立后才允许从试错仓升级为确认仓。",
      cancel: ["现有短线主升指数5日结构转弱", "只有单一指数继续走强"],
    });
  }
  if (intraday.key === "recovery_strong_close" || intraday.key === "strong_close") {
    rows.push({
      key: "strong_close_follow_through",
      label: "强收后的次日承接验证",
      status: "watch",
      targets: ["全A"],
      trigger: ["次日开盘后不快速跌回前收", "上涨广度与短线主升指数继续共振"],
      action: "只在承接确认后保留试错权限，不能把单日强收直接写成中期主升。",
      cancel: ["高开低走", "上涨广度快速跌破半数"],
    });
  }
  return rows;
}

function buildWarnings(mediumTerm, shortTerm, intraday) {
  const warnings = [];
  if (mediumTerm.key === "repair_candidate") {
    warnings.push({
      key: "medium_not_confirmed",
      label: "中期主升尚未确认",
      detail: "站上20日线只代表修复改善；60日线与20日斜率未共同确认前，不得升级为中期主升。",
    });
  }
  if (shortTerm.key === "partial_main_rise") {
    warnings.push({
      key: "partial_resonance",
      label: "全市场尚未共振",
      detail: "部分指数已进入短线主升，但其余指数仍在修复，不能按全市场主升放大仓位。",
    });
  }
  if (shortTerm.indexes.some((row) => row.key === "main_rise_pullback")) {
    warnings.push({
      key: "ma5_pullback_not_break",
      label: "5日线调整不等于结构破坏",
      detail: "价格短暂跌破5日线但5日斜率仍向上且中期结构不弱，属于结构内回踩；跌破5日线并伴随5日斜率转负才升级风险。",
    });
  }
  if (intraday.key === "unknown") {
    warnings.push({
      key: "intraday_missing",
      label: "分时证据缺失",
      detail: "缺开高低收或可信分时，不用收盘涨幅替代日内承接判断。",
    });
  } else if (intraday.key === "gap_fade") {
    warnings.push({
      key: "gap_fade",
      label: "高开兑现",
      detail: "当日高开后走弱，次日不得把表面强势直接转成追涨权限。",
    });
  }
  return warnings;
}

function buildTomorrowPaths(validation, mediumTerm, shortTerm) {
  return [
    {
      key: "strengthen",
      label: "修复升级、全市场共振",
      conditions: validation.upgrade,
      result: mediumTerm.key === "main_rise"
        ? "维持中期主升，开放正常确认仓权限。"
        : "由中期修复候选升级；共振确认后再开放扩仓。",
      permission: "upgrade",
    },
    {
      key: "healthy_pullback",
      label: "主升指数5日线调整",
      conditions: validation.hold,
      result: "中期结构不变，短线只做回踩承接确认，不追一致高开。",
      permission: shortTerm.key === "partial_main_rise" ? "keep_reduced" : "keep",
    },
    {
      key: "fail",
      label: "短周期转弱并向中期扩散",
      conditions: validation.downgrade,
      result: "取消新增或扩仓权限，等待重新站回5日/20日结构。",
      permission: "downgrade",
    },
  ];
}

function buildPositionPermission(mediumTerm, shortTerm, intraday, consensus) {
  const common = {
    scope: "index_environment_only",
    mustIntersectDownstreamRisk: true,
    note: "指数层只给出仓位上限与开仓权限；题材、个股、价格和账户风控仍可继续收紧。",
  };
  if (mediumTerm.key === "unknown" || shortTerm.key === "unknown") {
    return {
      ...common,
      key: "observe",
      label: "数据不足·仅观察",
      allowNew: false,
      allowAdd: false,
      ceiling: "observe",
      positionRangePct: null,
      allowedSetups: [],
      forbiddenSetups: ["依据缺失指数数据生成买点", "把unknown按0分或弱势处理"],
      reasons: ["中期或短期指数结构数据不足"],
    };
  }
  if (mediumTerm.key === "decline" || shortTerm.key === "weakening" || intraday.key === "weak_close") {
    return {
      ...common,
      key: "defensive",
      label: "防守权限",
      allowNew: false,
      allowAdd: false,
      ceiling: "low",
      positionRangePct: [0, 20],
      allowedSetups: ["仅处理已有持仓风险"],
      forbiddenSetups: ["新增趋势仓", "弱势反抽追高", "按单日反弹放大仓位"],
      reasons: [mediumTerm.label, shortTerm.label, intraday.label],
    };
  }
  if (consensus.confirmed) {
    if (!intraday.confirmed) {
      return {
        ...common,
        key: "conditional_confirmation",
        label: "结构共振·等待分时确认",
        allowNew: true,
        allowAdd: false,
        ceiling: "reduced",
        positionRangePct: [40, 60],
        allowedSetups: ["主线核心回踩确认", "主升中的5日线调整承接"],
        forbiddenSetups: ["缺分时承接时直接扩仓", "追一致高开", "超出账户风控上限"],
        reasons: [mediumTerm.label, shortTerm.label, "分时证据缺失，扩仓权限暂不开放"],
      };
    }
    return {
      ...common,
      key: "normal_confirmation",
      label: "正常确认权限",
      allowNew: true,
      allowAdd: true,
      ceiling: "normal",
      positionRangePct: [50, 70],
      allowedSetups: ["主线核心确认", "主升中的5日线调整承接", "分歧后重新转强"],
      forbiddenSetups: ["追一字或无价格发现标的", "超出账户风控上限"],
      reasons: [mediumTerm.label, shortTerm.label, consensus.label],
    };
  }
  if (
    !["repair_candidate", "main_rise"].includes(mediumTerm.key)
    && !["partial_main_rise", "main_rise", "repair"].includes(shortTerm.key)
  ) {
    return {
      ...common,
      key: "observe_repair",
      label: "修复观察权限",
      allowNew: false,
      allowAdd: false,
      ceiling: "low",
      positionRangePct: [0, 20],
      allowedSetups: ["等待5日结构重新转强"],
      forbiddenSetups: ["震荡结构中放大仓位", "仅凭单日强收追涨"],
      reasons: [mediumTerm.label, shortTerm.label, consensus.label],
    };
  }
  return {
    ...common,
    key: "conditional_reduced",
    label: "条件允许·降一级仓位",
    allowNew: true,
    allowAdd: false,
    ceiling: "reduced",
    positionRangePct: [30, 50],
    allowedSetups: ["短线主升指数对应方向的回踩确认", "中期修复候选中的主动核心试错"],
    forbiddenSetups: ["按全市场主升放大仓位", "追一致高开", "仅凭单日强收加仓"],
    reasons: [mediumTerm.label, shortTerm.label, consensus.label],
  };
}

function buildDataQuality(rows, mediumTerm, shortTerm, intraday) {
  const missing = [];
  if (!rows.length) missing.push("indexStructures");
  if (!rows.some((row) => row.ma20 !== null)) missing.push("ma20");
  if (!rows.some((row) => row.ma60 !== null)) missing.push("ma60");
  if (!rows.some((row) => row.ma5 !== null)) missing.push("ma5");
  if (!rows.some((row) => row.slope20 !== null)) missing.push("slope20");
  if (!rows.some((row) => row.slope5 !== null)) missing.push("slope5");
  if (intraday.key === "unknown") missing.push("allA_intraday_ohlc");
  const mediumKnown = mediumTerm.metrics.knownIndexCount;
  const shortKnown = shortTerm.metrics.knownIndexCount;
  return {
    grade: !rows.length || mediumKnown === null || shortKnown === null
      ? "insufficient"
      : missing.length ? "partial" : "complete",
    indexCount: rows.length || null,
    mediumKnownIndexCount: mediumKnown,
    shortKnownIndexCount: shortKnown,
    intradayVerified: intraday.confirmed,
    missing,
    notes: [
      "中期使用20/60日结构，短期使用5日结构，当日OHLC只描述执行节奏。",
      "缺失字段保持null/unknown，不进入分母，也不折算成0分。",
    ],
  };
}

function classifyIndexSubPhase(rows, shortTerm, intraday, snapshot) {
  const known = rows.filter((row) => row.aboveMa5 !== null);
  const aboveMa5Count = known.filter((row) => row.aboveMa5 === true).length;
  const aboveMa5Rate = ratio(aboveMa5Count, known.length);
  const decliningCount = rows.filter((row) => row.changePct !== null && row.changePct < 0).length;
  const decliningRate = ratio(decliningCount, rows.filter((row) => row.changePct !== null).length);
  const breadth = normalizeRatio(firstFinite(snapshot && snapshot.breadth, snapshot && snapshot.advanceRatio));
  const avgIndexChange = firstFinite(
    snapshot && snapshot.avgIndexChange,
    rows.length ? rows.reduce((sum, row) => sum + (row.changePct || 0), 0) / rows.length : null,
  );
  const shortMainRise = ["main_rise", "partial_main_rise"].includes(shortTerm.key)
    && shortTerm.confirmed !== false;
  const confirmedNonMainRise = shortTerm.confirmed === true && !shortMainRise;
  const nonMainRisePhase = confirmedNonMainRise ? ({
    repair: {
      key: "repair_structure",
      label: "修复结构·暂无主升细分",
      intensity: "repair",
    },
    range: {
      key: "range_structure",
      label: "震荡结构·暂无主升细分",
      intensity: "range",
    },
    weakening: {
      key: "weakening_structure",
      label: "转弱结构·暂无主升细分",
      intensity: "weakening",
    },
  }[shortTerm.key] || null) : null;
  // 已确认的5日主升允许“价格短暂在MA5下、但MA5斜率仍向上”的结构内回踩。
  // 是否破坏由同口径fiveDay结构破坏数决定，不能再用aboveMa5多数条件二次否定。
  const structureIntact = shortMainRise
    && intraday.fiveDay.metrics.structuralBreakCount === 0;
  // A low close is weak regardless of whether the session opened flat or first gapped up.
  // `gap_fade` is deliberately included: a broad high-open/low-close reversal is not
  // acceleration merely because the opening auction was strong.
  const weakSession = intraday.session
    && ["weak_close", "gap_fade"].includes(intraday.session.key);
  const breadthStress = breadth !== null && breadth <= 0.3;
  const indexStress = avgIndexChange !== null && avgIndexChange <= -0.55;
  const broadDecline = decliningRate !== null && decliningRate >= 0.75;
  const strongDivergence = structureIntact
    && weakSession
    && broadDecline
    && [breadthStress, indexStress].filter(Boolean).length >= 1;
  const ordinaryDivergence = structureIntact && (weakSession || broadDecline && (breadthStress || indexStress));

  // “主升内加强/分歧”等细分只属于已确认的主升结构。若数据完整且
  // 上游已确认处于修复、震荡或转弱，直接展示该真实结构，不能把
  // “暂无主升细分”误写成“数据待确认”。只有结构本身 unknown 时才待确认。
  let key = nonMainRisePhase ? nonMainRisePhase.key : "structure_pending";
  let label = nonMainRisePhase ? nonMainRisePhase.label : "细分阶段待确认";
  let intensity = nonMainRisePhase ? nonMainRisePhase.intensity : "unknown";
  if (strongDivergence) {
    key = "main_rise_strong_divergence";
    label = "主升内强分歧";
    intensity = "strong";
  } else if (ordinaryDivergence) {
    key = "main_rise_divergence";
    label = "主升内分歧";
    intensity = "normal";
  } else if (shortMainRise && intraday.session && ["strong_close", "recovery_strong_close"].includes(intraday.session.key)) {
    key = "main_rise_strengthening";
    label = "主升内加强";
    intensity = "strengthening";
  } else if (shortMainRise) {
    key = "main_rise_consolidation";
    label = "主升内震荡";
    intensity = "normal";
  }

  return {
    key,
    label,
    structureIntact,
    intensity,
    verified: Boolean(shortTerm.confirmed && intraday.confirmed && known.length >= 2),
    evidence: [
      aboveMa5Rate === null ? null : `${aboveMa5Count}/${known.length}个主要指数守住5日线`,
      decliningRate === null ? null : `${decliningCount}/${rows.filter((row) => row.changePct !== null).length}个主要指数收跌`,
      breadth === null ? null : `上涨广度${round(breadth * 100, 1)}%`,
      intraday.session && intraday.session.metrics.closeLocationPct !== null
        ? `全A收盘位于日内振幅${intraday.session.metrics.closeLocationPct}%位置`
        : null,
    ].filter(Boolean),
    metrics: {
      windowDays: 5,
      aboveMa5Count: known.length ? aboveMa5Count : null,
      aboveMa5Rate: round(aboveMa5Rate, 3),
      decliningCount: rows.length ? decliningCount : null,
      decliningRate: round(decliningRate, 3),
      avgIndexChange: round(avgIndexChange),
      breadth: round(breadth, 3),
      weakClose: weakSession,
      sessionKey: intraday.session && intraday.session.key || null,
    },
  };
}

function buildIndexCycleRegime(input = {}) {
  const context = readInput(input);
  const rows = normalizeIndexRows(context);
  const mediumTerm = classifyMediumTerm(rows);
  const shortTerm = classifyShortTerm(rows, mediumTerm);
  const intraday = classifyIntraday(rows, shortTerm, context.snapshot, context.intradaySource);
  const marketConsensus = buildConsensus(mediumTerm, shortTerm, intraday);
  const validation = validationRules(mediumTerm, shortTerm);
  const positionPermission = buildPositionPermission(
    mediumTerm,
    shortTerm,
    intraday,
    marketConsensus,
  );
  const opportunities = buildOpportunities(mediumTerm, shortTerm, intraday);
  const warnings = buildWarnings(mediumTerm, shortTerm, intraday);
  const tomorrowPaths = buildTomorrowPaths(validation, mediumTerm, shortTerm);
  const dataQuality = buildDataQuality(rows, mediumTerm, shortTerm, intraday);
  const indexSubPhase = classifyIndexSubPhase(rows, shortTerm, intraday, context.snapshot);
  const priorBigCycle = normalizeBigCycle(
    context.currentMarketState && (
      context.currentMarketState.structuralCycle
      || context.currentMarketState.cycle
    ),
  ) || normalizeBigCycle(
    context.previousMarketState && (
      context.previousMarketState.structuralCycle
      || context.previousMarketState.cycle
    ),
  );
  // 大周期只读取中期结构和已经确认的上一收盘状态。5日转弱属于小周期，
  // 不能单独把 structuralCycle 写成退潮；退潮/冰点的进入与退出交给
  // market-cycle-engine 的跨日状态机确认。
  const mediumMainRiseConfirmed = mediumTerm.key === "main_rise"
    && mediumTerm.confirmed !== false;
  const shortMainRiseConfirmed = shortTerm.key === "main_rise"
    && shortTerm.confirmed !== false;
  const fullMainRiseConfirmed = mediumMainRiseConfirmed && shortMainRiseConfirmed;
  const rangeQuorumCurrent = mediumTerm.key !== "decline"
    && mediumTerm.key !== "unknown"
    && shortTerm.key !== "weakening"
    && shortTerm.key !== "unknown"
    && finite(shortTerm.metrics.aboveMa5KnownCount) >= 4
    && finite(shortTerm.metrics.aboveMa5Count) >= 3
    && finite(shortTerm.metrics.aboveMa5Rate) >= 0.75;
  let structuralCycle = priorBigCycle || "混沌";
  if (["退潮", "冰点"].includes(priorBigCycle)) {
    // 即使当日中短周期同时转强，也必须先由跨日滞回退出到混沌，
    // 不能从退潮/冰点单日跳到主升。
    structuralCycle = priorBigCycle;
  } else if (fullMainRiseConfirmed) {
    structuralCycle = "主升";
  } else if (!priorBigCycle) {
    // 首次运行只有完整的20/60日+5日主升共振才允许定为主升；
    // 下降、修复或单日普涨均先落在混沌，等待跨日状态机。
    structuralCycle = "混沌";
  } else if (priorBigCycle === "主升" && mediumTerm.key === "decline") {
    // 中期下降可以结束旧主升标签，但不能跳跃确认为退潮。
    structuralCycle = "混沌";
  }
  let transition = repairTransition({
    bigCycle: structuralCycle,
    previousBigCycle: priorBigCycle,
    mediumTerm,
    shortTerm,
  });
  if (
    transition.key === "repair_strengthening"
    && structuralCycle === "混沌"
    && transition.to === "主升"
  ) {
    transition = {
      ...transition,
      label: rangeQuorumCurrent ? "修复加强·震荡待确认" : "修复加强·等待大周期确认",
      to: rangeQuorumCurrent ? "震荡" : null,
    };
  }
  if (
    rangeQuorumCurrent
    && structuralCycle !== "震荡"
    && structuralCycle !== "主升"
    && transition.key === "none"
  ) {
    transition = {
      key: "range_pending_confirmation",
      label: "震荡待确认",
      status: "pending",
      from: structuralCycle,
      to: "震荡",
      observationOnly: true,
      evidence: [
        `${shortTerm.metrics.aboveMa5Count}/${shortTerm.metrics.aboveMa5KnownCount}个主要指数站上5日线`,
        "缺少上一收盘同口径MA5多数确认",
      ],
    };
  }
  const currentMarketState = context.currentMarketState && typeof context.currentMarketState === "object"
    ? context.currentMarketState
    : {};
  const smallCycle = smallCycleFromSignals({
    shortTerm,
    intraday,
    indexSubPhase,
    dailyState: currentMarketState.dailyState,
    profitEffect: currentMarketState.profitEffect,
    lossEffect: currentMarketState.lossEffect,
    tradeWindow: currentMarketState.tradeWindow,
  });

  return {
    version: INDEX_CYCLE_REGIME_VERSION,
    method: "deterministic_multi_timeframe_v5",
    mediumTerm,
    shortTerm,
    intraday,
    generationContext: context.generationContext ? { ...context.generationContext } : null,
    structuralCycle,
    transition,
    smallCycle,
    rangeConfirmation: {
      windowDays: 5,
      currentQualified: rangeQuorumCurrent,
      confirmed: structuralCycle === "震荡",
      pending: rangeQuorumCurrent && structuralCycle !== "震荡" && structuralCycle !== "主升",
      aboveMa5Count: shortTerm.metrics.aboveMa5Count,
      aboveMa5KnownCount: shortTerm.metrics.aboveMa5KnownCount,
      aboveMa5Rate: shortTerm.metrics.aboveMa5Rate,
      requiresPreviousClose: true,
    },
    indexSubPhase,
    marketConsensus,
    summary: `${mediumTerm.label}；${shortTerm.label}；${intraday.label}。`,
    opportunities,
    warnings,
    tomorrowPaths,
    validation,
    positionPermission,
    dataQuality,
    integrity: {
      bigCycleCanonical: BIG_CYCLE_VALUES.includes(structuralCycle),
      repairCannotBeBigCycle: structuralCycle !== "修复",
      bigAndSmallSeparated: true,
    },
  };
}

module.exports = {
  INDEX_CYCLE_REGIME_VERSION,
  buildIndexCycleRegime,
  analyzeIndexCycleRegime: buildIndexCycleRegime,
};
