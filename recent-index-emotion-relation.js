"use strict";

/**
 * 近期指数—情绪关系。
 *
 * 纯函数约束：不读文件、不读系统时间、不修改输入；缺失值保持 null。
 * 指数方向只接受主要指数、上涨广度、收盘位置与量能支持的交叉验证。
 * 情绪方向只接受 canonical 可参与主阶段；一字/高度一致度单独展示。
 */

const RECENT_INDEX_EMOTION_RELATION_VERSION = 1;
const METHOD = "recent_index_participatory_emotion_relation";
const SHORT_WINDOW = 3;
const CONFIRM_WINDOW = 5;

const RELATION_LABELS = Object.freeze({
  resonance_up: "指数与可参与情绪同向走强",
  index_strong_emotion_weak: "指数走强、可参与情绪走弱",
  index_weak_emotion_strong: "指数走弱、可参与情绪走强",
  resonance_down: "指数与可参与情绪同向走弱",
  switching: "指数与可参与情绪关系切换中",
  unknown: "数据不足，关系待确认",
});

const STRONG_EMOTION_PHASES = new Set([
  "acceleration",
  "climax",
  "support",
  "repair",
  "recovery",
  "warming",
  "strengthening",
  "up",
]);

const WEAK_EMOTION_PHASES = new Set([
  "realization",
  "post_heat_divergence",
  "post_climax_divergence",
  "divergence",
  "harmful",
  "retreat",
  "cooling",
  "weakening",
  "down",
]);

const PRIMARY_INDEX_CODES = new Set(["000001", "399001", "399006", "000688"]);
const PRIMARY_INDEX_NAME_PATTERN = /上证指数|深证成指|创业板指|科创50/;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function list(value) {
  return Array.isArray(value) ? value : [];
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

function firstText(...values) {
  for (const value of values) {
    const text = String(value === null || value === undefined ? "" : value).trim();
    if (text) return text;
  }
  return null;
}

function normalizeDate(value) {
  const text = firstText(value);
  if (!text) return null;
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function normalizeBreadth(value) {
  const number = finite(value);
  if (number === null) return null;
  if (number > 1 && number <= 100) return number / 100;
  return number >= 0 && number <= 1 ? number : null;
}

function directionLabel(direction) {
  if (direction === "strong") return "走强";
  if (direction === "weak") return "走弱";
  if (direction === "mixed") return "强弱混合";
  return "待确认";
}

function relationKey(indexStrength, emotionStrength) {
  if (indexStrength === "unknown" || emotionStrength === "unknown") return "unknown";
  if (indexStrength === "mixed" || emotionStrength === "mixed") return "switching";
  if (indexStrength === "strong" && emotionStrength === "strong") return "resonance_up";
  if (indexStrength === "strong" && emotionStrength === "weak") return "index_strong_emotion_weak";
  if (indexStrength === "weak" && emotionStrength === "strong") return "index_weak_emotion_strong";
  if (indexStrength === "weak" && emotionStrength === "weak") return "resonance_down";
  return "unknown";
}

function amountOf(snapshot) {
  const allA = isObject(snapshot.allA) ? snapshot.allA : {};
  return firstFinite(
    snapshot.totalAmountYi,
    snapshot.shszAmountYi,
    snapshot.amountYi,
    allA.amountYi,
  );
}

function primaryIndexRows(snapshot) {
  const source = list(snapshot.indexes).length
    ? list(snapshot.indexes)
    : list(snapshot.indexStructures).length
      ? list(snapshot.indexStructures)
      : list(snapshot.primaryIndexes);
  const recognized = source.filter((row) => {
    if (!isObject(row)) return false;
    const code = firstText(row.code, row.symbol, row.secCode);
    const name = firstText(row.name) || "";
    return PRIMARY_INDEX_CODES.has(code) || PRIMARY_INDEX_NAME_PATTERN.test(name);
  });
  return recognized.length ? recognized : source.filter(isObject);
}

function analyzePrimaryIndexes(snapshot) {
  const rows = primaryIndexRows(snapshot);
  const changes = rows
    .map((row) => firstFinite(row.changePct, row.changePercent, row.pctChange, row.change))
    .filter((value) => value !== null);
  if (changes.length < 2) {
    return {
      direction: "unknown",
      knownCount: changes.length,
      totalCount: rows.length || null,
      averageChangePct: changes.length ? round(changes.reduce((sum, value) => sum + value, 0) / changes.length) : null,
      positiveCount: changes.length ? changes.filter((value) => value > 0.2).length : null,
      negativeCount: changes.length ? changes.filter((value) => value < -0.2).length : null,
    };
  }
  const averageChangePct = changes.reduce((sum, value) => sum + value, 0) / changes.length;
  const positiveCount = changes.filter((value) => value > 0.2).length;
  const negativeCount = changes.filter((value) => value < -0.2).length;
  const positiveRate = positiveCount / changes.length;
  const negativeRate = negativeCount / changes.length;
  const direction = averageChangePct >= 0.25 && positiveRate >= 0.6
    ? "strong"
    : averageChangePct <= -0.25 && negativeRate >= 0.6
      ? "weak"
      : "mixed";
  return {
    direction,
    knownCount: changes.length,
    totalCount: rows.length,
    averageChangePct: round(averageChangePct),
    positiveCount,
    negativeCount,
  };
}

function analyzeBreadth(snapshot) {
  const allA = isObject(snapshot.allA) ? snapshot.allA : {};
  let value = normalizeBreadth(firstFinite(snapshot.breadth, snapshot.marketBreadth, allA.breadth));
  if (value === null) {
    const upCount = firstFinite(snapshot.upCount, allA.upCount);
    const downCount = firstFinite(snapshot.downCount, allA.downCount);
    value = upCount !== null && downCount !== null && upCount + downCount > 0
      ? upCount / (upCount + downCount)
      : null;
  }
  const direction = value === null
    ? "unknown"
    : value >= 0.55
      ? "strong"
      : value <= 0.45
        ? "weak"
        : "mixed";
  return { direction, value: round(value, 4) };
}

function rowClosePosition(row) {
  if (!isObject(row)) return null;
  const low = finite(row.low);
  const high = finite(row.high);
  const close = firstFinite(row.close, row.price, row.current);
  if (low === null || high === null || close === null || high <= low) return null;
  return Math.max(0, Math.min(1, (close - low) / (high - low)));
}

function analyzeClosePosition(snapshot) {
  const allAPosition = rowClosePosition(snapshot.allA);
  const positions = allAPosition !== null
    ? [allAPosition]
    : primaryIndexRows(snapshot).map(rowClosePosition).filter((value) => value !== null);
  const value = positions.length
    ? positions.reduce((sum, item) => sum + item, 0) / positions.length
    : null;
  const direction = value === null
    ? "unknown"
    : value >= 0.67
      ? "strong"
      : value <= 0.33
        ? "weak"
        : "mixed";
  return { direction, value: round(value, 4), sampleCount: positions.length || null };
}

function analyzeVolume(snapshot, previousAmountYi, primaryDirection) {
  const currentAmountYi = amountOf(snapshot);
  const previous = finite(previousAmountYi);
  const ratio = currentAmountYi !== null && previous !== null && previous > 0
    ? currentAmountYi / previous
    : null;
  const expanded = ratio === null ? null : ratio >= 1.03;
  const direction = expanded === true && primaryDirection === "strong"
    ? "strong"
    : expanded === true && primaryDirection === "weak"
      ? "weak"
      : ratio === null
        ? "unknown"
        : "mixed";
  return {
    direction,
    currentAmountYi: round(currentAmountYi),
    previousAmountYi: round(previous),
    ratio: round(ratio, 4),
    expanded,
  };
}

function regimeSummary(day) {
  const regime = isObject(day.indexCycleRegime) ? day.indexCycleRegime : {};
  const shortTerm = isObject(regime.shortTerm) ? regime.shortTerm : {};
  const mediumTerm = isObject(regime.mediumTerm) ? regime.mediumTerm : {};
  return {
    shortTermKey: firstText(shortTerm.key, regime.shortTermKey, regime.key, regime.cycleKey),
    shortTermLabel: firstText(shortTerm.label, regime.shortTermLabel, regime.label),
    mediumTermKey: firstText(mediumTerm.key, regime.mediumTermKey),
    mediumTermLabel: firstText(mediumTerm.label, regime.mediumTermLabel),
  };
}

function analyzeIndex(day, fallbackPreviousAmountYi) {
  const snapshot = isObject(day.marketSnapshot) ? day.marketSnapshot : {};
  const primaryIndexes = analyzePrimaryIndexes(snapshot);
  const breadth = analyzeBreadth(snapshot);
  const closePosition = analyzeClosePosition(snapshot);
  const explicitPreviousAmount = firstFinite(
    day.previousAmountYi,
    snapshot.previousAmountYi,
    snapshot.previousTotalAmountYi,
  );
  const volumeSupport = analyzeVolume(
    snapshot,
    explicitPreviousAmount !== null ? explicitPreviousAmount : fallbackPreviousAmountYi,
    primaryIndexes.direction,
  );
  const channels = [primaryIndexes, breadth, closePosition, volumeSupport];
  const strongCount = channels.filter((item) => item.direction === "strong").length;
  const weakCount = channels.filter((item) => item.direction === "weak").length;
  const knownCount = channels.filter((item) => item.direction !== "unknown").length;
  let strength = "unknown";
  if (primaryIndexes.direction === "strong" && strongCount >= 2 && weakCount <= 1) {
    strength = "strong";
  } else if (primaryIndexes.direction === "weak" && weakCount >= 2 && strongCount <= 1) {
    strength = "weak";
  } else if (primaryIndexes.direction !== "unknown" && knownCount >= 2) {
    strength = "mixed";
  }
  return {
    strength,
    label: directionLabel(strength),
    regime: regimeSummary(day),
    evidence: { primaryIndexes, breadth, closePosition, volumeSupport },
    evidenceSummary: {
      knownCount,
      strongCount,
      weakCount,
      rule: "主要指数必须可判断，并由上涨广度、收盘位置或量能至少一项交叉验证",
    },
  };
}

function participatoryPhaseOf(emotionCycle) {
  const current = isObject(emotionCycle.current) ? emotionCycle.current : {};
  const direct = isObject(current.participatoryPhase)
    ? current.participatoryPhase
    : isObject(emotionCycle.participatoryPhase)
      ? emotionCycle.participatoryPhase
      : null;
  if (direct && direct.marketEmotionEligible !== false) {
    return {
      key: firstText(direct.key),
      label: firstText(direct.label),
      source: "participatory_phase",
    };
  }
  const phaseKey = firstText(current.phaseKey);
  if (phaseKey) {
    return {
      key: phaseKey,
      label: firstText(current.label),
      source: "canonical_current_phase_key",
    };
  }
  if (current.marketEmotionEligible === true && firstText(current.key)) {
    return {
      key: firstText(current.key),
      label: firstText(current.label),
      source: "explicit_participatory_current",
    };
  }
  return { key: null, label: null, source: "missing" };
}

function emotionDirection(phaseKey) {
  const key = firstText(phaseKey);
  if (!key) return "unknown";
  if (STRONG_EMOTION_PHASES.has(key)) return "strong";
  if (WEAK_EMOTION_PHASES.has(key)) return "weak";
  return "unknown";
}

function analyzeEmotion(day) {
  const cycle = isObject(day.emotionCycle) ? day.emotionCycle : {};
  const current = isObject(cycle.current) ? cycle.current : {};
  const participation = isObject(cycle.participation) ? cycle.participation : {};
  const phase = participatoryPhaseOf(cycle);
  const strength = emotionDirection(phase.key);
  return {
    strength,
    label: directionLabel(strength),
    phaseKey: phase.key,
    phaseLabel: phase.label,
    source: phase.source,
    qualityKey: firstText(current.qualityKey, cycle.phaseQuality && cycle.phaseQuality.key),
    qualityLabel: firstText(current.qualityLabel, cycle.phaseQuality && cycle.phaseQuality.label),
    participation: {
      eligibleAnchorCount: firstFinite(participation.eligibleAnchorCount),
      primaryEligibleCount: firstFinite(participation.primaryEligibleCount),
      rule: firstText(participation.rule),
    },
  };
}

function analyzeHeightConsensus(day) {
  const cycle = isObject(day.emotionCycle) ? day.emotionCycle : {};
  const current = isObject(cycle.current) ? cycle.current : {};
  const consensus = isObject(current.consensusPhase)
    ? current.consensusPhase
    : isObject(cycle.consensusPhase)
      ? cycle.consensusPhase
      : {};
  const participation = isObject(cycle.participation) ? cycle.participation : {};
  return {
    key: firstText(consensus.key),
    label: firstText(consensus.label),
    anchorCount: firstFinite(consensus.anchorCount),
    oneWordExcludedCount: firstFinite(participation.oneWordExcludedCount),
    marketEmotionEligible: false,
    note: "高度与一字只说明空间和一致度，不决定可参与情绪方向",
  };
}

function explicitFundSwitch(snapshot) {
  const candidates = [
    snapshot.fundSwitchEvidence,
    snapshot.capitalSwitchEvidence,
    snapshot.flowSwitchEvidence,
    snapshot.styleSwitchConfirmed,
    snapshot.fundSwitchConfirmed,
    isObject(snapshot.flowSwitch) ? snapshot.flowSwitch.confirmed : undefined,
    isObject(snapshot.capitalFlow) ? snapshot.capitalFlow.switchConfirmed : undefined,
    isObject(snapshot.fundFlow) ? snapshot.fundFlow.switchConfirmed : undefined,
  ];
  if (candidates.some((value) => value === true)) return true;
  if (candidates.some((value) => value === false)) return false;
  return null;
}

function switchingEvidence(day, index) {
  const snapshot = isObject(day.marketSnapshot) ? day.marketSnapshot : {};
  const volumeExpanded = index.evidence.volumeSupport.expanded;
  const explicit = explicitFundSwitch(snapshot);
  const sources = [];
  if (volumeExpanded === true) sources.push("volume_expansion");
  if (explicit === true) sources.push("explicit_fund_switch");
  return {
    confirmed: volumeExpanded === true || explicit === true,
    volumeExpanded,
    explicitFundSwitch: explicit,
    sources,
  };
}

function missingFields(tradingDate, index, emotion) {
  const fields = [];
  if (!tradingDate) fields.push("trading_date");
  if (index.evidence.primaryIndexes.direction === "unknown") fields.push("primary_indexes");
  if (index.evidence.breadth.value === null) fields.push("breadth");
  if (index.evidence.closePosition.value === null) fields.push("close_position");
  if (index.evidence.volumeSupport.currentAmountYi === null) fields.push("current_amount_yi");
  if (index.evidence.volumeSupport.previousAmountYi === null) fields.push("previous_amount_yi");
  if (!emotion.phaseKey || emotion.strength === "unknown") fields.push("participatory_emotion_phase");
  return fields;
}

function normalizeDays(inputDays) {
  const duplicates = new Set();
  const dated = new Map();
  const undated = [];
  list(inputDays).forEach((rawDay, inputIndex) => {
    const day = isObject(rawDay) ? rawDay : {};
    const tradingDate = normalizeDate(day.tradingDate);
    const item = { day, tradingDate, inputIndex };
    if (!tradingDate) {
      undated.push(item);
      return;
    }
    if (dated.has(tradingDate)) duplicates.add(tradingDate);
    dated.set(tradingDate, item);
  });
  const sorted = [...dated.values()].sort((left, right) => left.tradingDate.localeCompare(right.tradingDate));
  return { items: [...sorted, ...undated], duplicateDates: [...duplicates].sort() };
}

function buildDaily(items) {
  let priorCurrentAmountYi = null;
  return items.map(({ day, tradingDate }) => {
    const index = analyzeIndex(day, priorCurrentAmountYi);
    const emotion = analyzeEmotion(day);
    const heightConsensus = analyzeHeightConsensus(day);
    const key = relationKey(index.strength, emotion.strength);
    const switchEvidence = switchingEvidence(day, index);
    const currentAmountYi = index.evidence.volumeSupport.currentAmountYi;
    if (currentAmountYi !== null) priorCurrentAmountYi = currentAmountYi;
    return {
      tradingDate,
      valid: key !== "unknown",
      relationKey: key,
      relationLabel: RELATION_LABELS[key],
      index,
      emotion,
      heightConsensus,
      switchingEvidence: switchEvidence,
      missingFields: missingFields(tradingDate, index, emotion),
    };
  });
}

function dominantRelation(daily) {
  const valid = daily.filter((item) => item.valid);
  const shortDays = valid.slice(-SHORT_WINDOW);
  if (shortDays.length < 2) {
    return {
      key: "unknown",
      label: RELATION_LABELS.unknown,
      observationCount: shortDays.length,
      confirmedByFiveDay: false,
      seesawConfirmed: false,
      reason: "少于2个有效观察日，不能判断近期主导关系",
    };
  }
  const counts = new Map();
  shortDays.forEach((item) => counts.set(item.relationKey, (counts.get(item.relationKey) || 0) + 1));
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const topCount = ranked[0][1];
  const tied = ranked.filter((entry) => entry[1] === topCount).length > 1;
  const key = !tied && topCount >= 2 ? ranked[0][0] : "switching";
  const confirmDays = valid.slice(-CONFIRM_WINDOW);
  const dominantConfirmCount = confirmDays.filter((item) => item.relationKey === key).length;
  const confirmedByFiveDay = key !== "switching"
    && key !== "unknown"
    && confirmDays.length >= CONFIRM_WINDOW
    && dominantConfirmCount >= 3
    && confirmDays[confirmDays.length - 1].relationKey === key;
  const divergenceKeys = new Set(["index_strong_emotion_weak", "index_weak_emotion_strong"]);
  const lastTwoCalendarRows = daily.slice(-2);
  const seesawConfirmed = divergenceKeys.has(key)
    && lastTwoCalendarRows.length === 2
    && lastTwoCalendarRows.every((item) => item.valid && item.relationKey === key)
    && lastTwoCalendarRows.every((item) => item.switchingEvidence.confirmed === true);
  return {
    key,
    label: RELATION_LABELS[key],
    observationCount: shortDays.length,
    confirmedByFiveDay,
    seesawConfirmed,
    reason: seesawConfirmed
      ? "连续2个有效观察日保持同一反向关系，且两日都有量能或资金切换证据"
      : divergenceKeys.has(key)
        ? "近期存在反向关系，但尚未同时满足连续性与量能/资金切换证据"
        : key === "switching"
          ? "近3个有效观察日没有形成同一主导关系"
          : `近${shortDays.length}个有效观察日以“${RELATION_LABELS[key]}”为主`,
  };
}

function transitionOf(daily, dominant) {
  const today = daily.length ? daily[daily.length - 1] : null;
  const previous = daily.length > 1 ? daily[daily.length - 2] : null;
  const comparable = Boolean(today && previous && today.valid && previous.valid);
  const changed = comparable ? today.relationKey !== previous.relationKey : null;
  return {
    fromKey: previous ? previous.relationKey : null,
    fromLabel: previous ? previous.relationLabel : null,
    toKey: today ? today.relationKey : "unknown",
    toLabel: today ? today.relationLabel : RELATION_LABELS.unknown,
    changed,
    seesawConfirmed: dominant.seesawConfirmed,
    note: !comparable
      ? "相邻有效数据不足，今日变化待确认"
      : changed
        ? `今日由“${previous.relationLabel}”切换为“${today.relationLabel}”`
        : `今日延续“${today.relationLabel}”`,
  };
}

function emptyToday() {
  return {
    title: "今日变化",
    tradingDate: null,
    valid: false,
    relationKey: "unknown",
    relationLabel: RELATION_LABELS.unknown,
    index: analyzeIndex({}, null),
    emotion: analyzeEmotion({}),
    switchingEvidence: { confirmed: false, volumeExpanded: null, explicitFundSwitch: null, sources: [] },
  };
}

function todayOf(daily) {
  if (!daily.length) return emptyToday();
  const item = daily[daily.length - 1];
  return {
    title: "今日变化",
    tradingDate: item.tradingDate,
    valid: item.valid,
    relationKey: item.relationKey,
    relationLabel: item.relationLabel,
    index: item.index,
    emotion: item.emotion,
    switchingEvidence: item.switchingEvidence,
  };
}

function opportunityBias(today, dominant, status) {
  if (status !== "ready" || today.relationKey === "unknown") {
    return {
      key: "data_insufficient",
      label: "暂不生成机会偏向",
      riskAdjustment: "avoid",
      focus: "先补齐主要指数、市场广度、收盘位置和可参与情绪阶段",
      reason: "有效观察不足，不能用缺失数据推导仓位",
    };
  }
  if (today.relationKey === "resonance_up") {
    return {
      key: "resonance_core_first",
      label: "共振走强，优先观察主动核心",
      riskAdjustment: "neutral",
      focus: "只观察有主动性、承接和带动性的可参与核心",
      reason: "指数与可参与情绪同向走强，但仍需个股触发确认，不能因为共振直接追高",
    };
  }
  if (today.relationKey === "resonance_down") {
    return {
      key: "defense_first",
      label: "指数和情绪同时走弱，先防守",
      riskAdjustment: "avoid",
      focus: "等待至少一端止跌并获得承接确认",
      reason: "指数与可参与情绪同向走弱，暂不新增方向性风险",
    };
  }
  if (["index_strong_emotion_weak", "index_weak_emotion_strong"].includes(today.relationKey)) {
    return {
      key: dominant.seesawConfirmed ? "confirmed_rotation_watch" : "divergence_watch",
      label: dominant.seesawConfirmed ? "反向关系已连续确认，仍只做核心" : "今日出现背离，只观察不下跷跷板结论",
      riskAdjustment: "reduce",
      focus: today.relationKey === "index_strong_emotion_weak"
        ? "指数走强不等于短线核心同步走强，等待可参与情绪止跌"
        : "只观察真正有带动性的情绪核心，防止指数继续拖累",
      reason: dominant.seesawConfirmed
        ? "连续至少2个有效观察日保持同一反向关系，并有量能或资金切换证据"
        : "单日或证据不完整的背离不能认定为跷跷板，仓位保持收缩",
    };
  }
  return {
    key: "switching_watch",
    label: "关系切换中，降低试错",
    riskAdjustment: "reduce",
    focus: "等待指数与可参与情绪重新形成连续关系",
    reason: "近期关系尚未稳定，不把单日变化当成新规律",
  };
}

function buildRecentIndexEmotionRelation(input = {}) {
  const source = isObject(input) ? input : {};
  const inputDays = list(source.days);
  const normalized = normalizeDays(inputDays);
  const daily = buildDaily(normalized.items);
  const validObservationCount = daily.filter((item) => item.valid).length;
  const status = validObservationCount >= 2 ? "ready" : "insufficient";
  const dominant = dominantRelation(daily);
  const today = todayOf(daily);
  const transition = transitionOf(daily, dominant);
  const missingByDate = daily
    .filter((item) => item.missingFields.length)
    .map((item) => ({ tradingDate: item.tradingDate, fields: [...item.missingFields] }));
  const usability = {
    usable: status === "ready",
    key: status === "ready" ? "usable" : "insufficient_valid_days",
    minimumValidDays: 2,
    validDays: validObservationCount,
    reason: status === "ready"
      ? "至少2个有效观察日，可展示近期关系；仍不代表经过胜率校准"
      : "少于2个有效观察日，只能显示今日原始变化，不能形成近期结论",
  };

  return {
    version: RECENT_INDEX_EMOTION_RELATION_VERSION,
    method: METHOD,
    calibrated: false,
    title: "近期指数—情绪关系",
    status,
    usability,
    window: {
      short: SHORT_WINDOW,
      confirm: CONFIRM_WINDOW,
      available: validObservationCount,
    },
    dominant,
    today,
    transition,
    daily,
    heightConsensus: {
      title: "高度与一致度（不参与情绪方向判断）",
      today: daily.length ? daily[daily.length - 1].heightConsensus : analyzeHeightConsensus({}),
      daily: daily.map((item) => ({ tradingDate: item.tradingDate, ...item.heightConsensus })),
    },
    opportunityBias: opportunityBias(today, dominant, status),
    dataQuality: {
      inputDayCount: inputDays.length,
      normalizedDayCount: daily.length,
      validObservationCount,
      invalidObservationCount: daily.length - validObservationCount,
      missingByDate,
      duplicateDates: [...normalized.duplicateDates],
      note: "缺失字段保持null；关系只使用可参与情绪层，未做胜率或仓位倍数校准",
    },
    integrity: {
      sorted: true,
      duplicateDates: [...normalized.duplicateDates],
      deduplicatedByTradingDate: normalized.duplicateDates.length > 0,
      missingValuesKeptNull: true,
      participatoryEmotionOnly: true,
      heightConsensusSeparated: true,
      oneWordCannotSetEmotion: true,
      seesawRequiresTwoConsecutiveEvidenceDays: true,
      riskAdjustmentValues: ["reduce", "neutral", "avoid"],
    },
  };
}

module.exports = {
  RECENT_INDEX_EMOTION_RELATION_VERSION,
  RELATION_LABELS,
  buildRecentIndexEmotionRelation,
};
