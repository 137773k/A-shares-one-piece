"use strict";

const { normalizeBigCycleKey } = require("./quant-decision/market-cycle-contract");
const { buildTomorrowIndexPath } = require("./tomorrow-index-path");
const { buildTomorrowProfitEffectForecast } = require("./tomorrow-profit-effect-forecast");

/**
 * 明日市场规则先验（纯函数）。
 *
 * 设计约束：
 * 1. 指数结构与市场宽度是主依据，核心情绪票只修正短线节奏；
 * 2. 所有概率都是尚未历史校准的 rule_prior，禁止展示成回测胜率；
 * 3. 缺失值保持 unknown，不用 0 代替；
 * 4. 跨日成交额比较只使用严格匹配的 T-1 收盘快照；
 * 5. 推荐候选自身的上涨不能单独把市场升级为“加强”。
 */

const MARKET_PATH_KEYS = Object.freeze(["strengthen", "range_divergence", "weaken"]);
const ACCELERATION_PATH_KEYS = Object.freeze([
  "brief_divergence_then_consensus",
  "range_divergence",
  "harmful_divergence",
]);

const MARKET_PATH_LABELS = Object.freeze({
  strengthen: "加强",
  range_divergence: "震荡分化",
  weaken: "减弱",
});

const ACCELERATION_PATH_LABELS = Object.freeze({
  brief_divergence_then_consensus: "短暂分歧后重新一致",
  range_divergence: "分歧兑现并转入震荡",
  harmful_divergence: "非良性分歧与负反馈扩散",
});

const CYCLE_LABELS = Object.freeze({
  main_rise: "主升",
  range: "震荡",
  retreat: "退潮",
  ice_point: "冰点",
  chaos: "混沌",
  unknown: "周期待确认",
});

const STAGE_LABELS = Object.freeze({
  weak: "弱势",
  weak_to_strong: "弱转强",
  acceleration: "加速",
  strong_divergence: "强分歧",
  expectation_overdrawn: "预期透支",
  divergence: "分歧兑现",
  supported: "分歧后承接",
  consensus_resume: "重新一致",
  negative_feedback: "负反馈扩散",
  climax: "高潮",
  realization: "兑现",
  support: "承接",
  harmful: "非良性分歧",
  retreat: "退潮",
  unknown: "阶段待确认",
});

const CYCLE_PRIORS = Object.freeze({
  main_rise: Object.freeze({ strengthen: 43, range_divergence: 40, weaken: 17 }),
  range: Object.freeze({ strengthen: 24, range_divergence: 53, weaken: 23 }),
  retreat: Object.freeze({ strengthen: 11, range_divergence: 34, weaken: 55 }),
  ice_point: Object.freeze({ strengthen: 18, range_divergence: 45, weaken: 37 }),
  chaos: Object.freeze({ strengthen: 23, range_divergence: 53, weaken: 24 }),
  unknown: Object.freeze({ strengthen: 27, range_divergence: 46, weaken: 27 }),
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeDate(value) {
  const digits = String(value == null ? "" : value).replace(/\D/g, "");
  if (digits.length !== 8) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function normalizeCycle(value) {
  return normalizeBigCycleKey(value) || "unknown";
}

function hasOwn(value, key) {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function firstProvided(entries) {
  for (const entry of entries) {
    if (hasOwn(entry.owner, entry.key)) {
      return { supplied: true, value: entry.owner[entry.key], source: entry.source };
    }
  }
  return { supplied: false, value: null, source: "missing" };
}

function canonicalIndexCycleKey(regime) {
  if (!isObject(regime)) return "unknown";
  const direct = normalizeBigCycleKey(
    isObject(regime.structuralCycle)
      ? regime.structuralCycle.key || regime.structuralCycle.label
      : regime.structuralCycle,
  );
  if (direct) return direct;
  const shortKey = String(regime.shortTerm && regime.shortTerm.key || "").trim().toLowerCase();
  const mediumKey = String(
    regime.mediumTerm && (regime.mediumTerm.cycleKey || regime.mediumTerm.key) || "",
  ).trim().toLowerCase();
  if (/partial_main_rise|main_rise_pullback/.test(shortKey)) return "unknown";
  if (["main_rise", "full_main_rise"].includes(shortKey)) return "main_rise";
  if (/weakening|retreat|decline/.test(`${shortKey} ${mediumKey}`)) return "retreat";
  if (/range|sideways/.test(shortKey)) return "range";
  if (/repair/.test(shortKey)) return "unknown";
  if (mediumKey === "main_rise") return "main_rise";
  if (/repair/.test(mediumKey)) return "unknown";
  if (/range|sideways/.test(mediumKey)) return "range";
  return "unknown";
}

function inspectCanonicalIndex(input) {
  const supplied = Boolean(input && input.supplied);
  const regime = input && input.value;
  const source = String(input && input.source || "missing");
  if (!supplied) {
    return { supplied: false, usable: false, unavailable: false, key: "unknown", label: CYCLE_LABELS.unknown, source, reason: "canonical indexCycleRegime未提供" };
  }
  if (!isObject(regime) || regime.available === false || regime.method === "unavailable") {
    return { supplied: true, usable: false, unavailable: true, key: "unknown", label: CYCLE_LABELS.unknown, source, reason: "canonical indexCycleRegime不可用，禁止回退旧周期" };
  }
  const key = canonicalIndexCycleKey(regime);
  const insufficient = regime.dataQuality && regime.dataQuality.grade === "insufficient";
  if (key === "unknown" || insufficient) {
    return { supplied: true, usable: false, unavailable: true, key: "unknown", label: CYCLE_LABELS.unknown, source, reason: "canonical indexCycleRegime证据不足，禁止回退旧周期" };
  }
  return {
    supplied: true,
    usable: true,
    unavailable: false,
    key,
    label: CYCLE_LABELS[key],
    smallCycle: isObject(regime.smallCycle)
      ? { ...regime.smallCycle }
      : isObject(regime.shortTerm)
        ? {
            key: String(regime.shortTerm.key || "unavailable"),
            label: String(regime.shortTerm.label || "小周期待确认"),
            status: regime.shortTerm.confirmed === false ? "unavailable" : "observed",
          }
        : { key: "unavailable", label: "小周期待确认", status: "unavailable" },
    source,
    reason: "使用canonical多周期指数状态",
  };
}

function normalizeCanonicalEmotionState(value) {
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (["acceleration", "climax", "strong_divergence", "realization", "support", "harmful", "retreat", "unknown"].includes(text)) {
    return text;
  }
  if (/高潮|climax/.test(text)) return "climax";
  if (/加速|acceleration/.test(text)) return "acceleration";
  if (/强分歧|strong[_ -]?divergence/.test(text)) return "strong_divergence";
  if (/兑现|realization/.test(text)) return "realization";
  if (/承接|support/.test(text)) return "support";
  if (/非良性|负反馈|harmful/.test(text)) return "harmful";
  if (/退潮|retreat/.test(text)) return "retreat";
  return "unknown";
}

function inspectCanonicalEmotion(input) {
  const supplied = Boolean(input && input.supplied);
  const model = input && input.value;
  const source = String(input && input.source || "missing");
  if (!supplied) {
    return { supplied: false, usable: false, unavailable: false, stageKnown: false, key: "unknown", label: STAGE_LABELS.unknown, source, model: null, reason: "canonical emotionCycle未提供" };
  }
  if (!isObject(model) || model.available === false || model.method === "unavailable" || !isObject(model.current)) {
    return { supplied: true, usable: false, unavailable: true, stageKnown: false, key: "unknown", label: STAGE_LABELS.unknown, source, model: isObject(model) ? model : null, reason: "canonical emotionCycle不可用，禁止回退旧情绪阶段" };
  }
  const key = normalizeCanonicalEmotionState(model.current.phaseKey || model.current.key || model.current.stage);
  return {
    supplied: true,
    usable: true,
    unavailable: false,
    stageKnown: key !== "unknown",
    key,
    label: String(model.current.label || STAGE_LABELS[key] || STAGE_LABELS.unknown),
    source,
    model,
    reason: key === "unknown" ? "canonical情绪阶段证据不足" : "使用canonical情绪状态机",
  };
}

function forecastPathKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "strengthen") return "strengthen";
  if (["diverge", "range_divergence", "realization"].includes(key)) return "range_divergence";
  if (["weaken", "harmful", "retreat"].includes(key)) return "weaken";
  return "unknown";
}

function canonicalEmotionBaseline(view) {
  if (!view || !view.supplied || !view.usable) {
    return {
      key: "unknown",
      label: "情绪基线待确认",
      reason: view && view.reason || "canonical emotionCycle未提供",
      source: view && view.supplied ? "canonical_unavailable" : "legacy",
      actionable: false,
    };
  }
  const raw = isObject(view.model.tomorrowBaseline) ? view.model.tomorrowBaseline : {};
  let key = forecastPathKey(raw.key);
  if (key === "unknown") {
    if (["harmful", "retreat"].includes(view.key)) key = "weaken";
    else if (view.key === "support") key = "strengthen";
    else if (view.key === "strong_divergence") key = "range_divergence";
    else key = "range_divergence";
  }
  const climaxDefault = view.key === "climax" && key === "range_divergence";
  return {
    key,
    label: String(raw.label || (climaxDefault ? "兑现优先·先看承接" : MARKET_PATH_LABELS[key] || "情绪基线待确认")),
    reason: String(raw.reason || (climaxDefault ? "高潮后的第一预期是兑现，不预设继续加速" : "按canonical情绪状态验证次日路径")),
    source: "canonical_emotion_cycle",
    sourceKey: String(raw.key || "derived"),
    rank: finiteNumber(raw.rank) ?? 1,
    actionable: view.stageKnown,
  };
}

function canonicalEmotionEffect(stage) {
  return {
    acceleration: { strengthen: -1, range_divergence: 7, weaken: 1 },
    strong_divergence: { strengthen: -3, range_divergence: 10, weaken: 3 },
    climax: { strengthen: -3, range_divergence: 9, weaken: 1 },
    realization: { strengthen: -1, range_divergence: 6, weaken: 2 },
    support: { strengthen: 5, range_divergence: 2, weaken: -2 },
    harmful: { strengthen: -4, range_divergence: 3, weaken: 8 },
    retreat: { strengthen: -5, range_divergence: 1, weaken: 12 },
  }[stage] || null;
}

function normalizeStage(value) {
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return "unknown";
  if (/负反馈|核按钮|negative[_ -]?feedback|breakdown/.test(text)) return "negative_feedback";
  if (/重新一致|再一致|consensus[_ -]?resume|resume[_ -]?consensus/.test(text)) return "consensus_resume";
  if (/承接|supported|support[_ -]?confirmed/.test(text)) return "supported";
  if (/预期透支|透支|overdrawn|exhaust/.test(text)) return "expectation_overdrawn";
  if (/加速|acceleration|accelerating/.test(text)) return "acceleration";
  if (/弱转强|weak[_ -]?to[_ -]?strong/.test(text)) return "weak_to_strong";
  if (/分歧|divergence|兑现/.test(text)) return "divergence";
  if (/弱势|weak/.test(text)) return "weak";
  return "unknown";
}

function normalizeScores(scores, keys) {
  const safe = {};
  let total = 0;
  keys.forEach((key) => {
    safe[key] = Math.max(1, finiteNumber(scores && scores[key]) ?? 1);
    total += safe[key];
  });
  const rows = keys.map((key, index) => {
    const exact = safe[key] * 100 / total;
    return { key, index, value: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let remaining = 100 - rows.reduce((sum, row) => sum + row.value, 0);
  [...rows]
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
    .slice(0, remaining)
    .forEach((row) => {
      rows[row.index].value += 1;
    });
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function primaryFromProbabilities(probabilities, keys, labels) {
  const key = keys.reduce((best, current) => (
    probabilities[current] > probabilities[best] ? current : best
  ), keys[0]);
  return { key, label: labels[key], probability: probabilities[key] };
}

function shiftScore(scores, effect) {
  if (!effect) return;
  MARKET_PATH_KEYS.forEach((key) => {
    const change = finiteNumber(effect[key]);
    if (change != null) scores[key] = Math.max(1, scores[key] + change);
  });
}

function extractRawStage(core) {
  const lifecycle = isObject(core && core.lifecycle) ? core.lifecycle : {};
  const execution = isObject(core && core.tomorrowExecution) ? core.tomorrowExecution : {};
  const sequence = Array.isArray(lifecycle.sequence) ? lifecycle.sequence : [];
  const lastSequenceStage = sequence.length
    ? (isObject(sequence[sequence.length - 1]) ? sequence[sequence.length - 1].stage : sequence[sequence.length - 1])
    : "";
  return core && (
    core.sentimentStage
    || core.emotionStage
    || lifecycle.currentStage
    || lifecycle.stage
    || execution.emotionStage
    || lastSequenceStage
  );
}

function classifyCoreStage(core) {
  if (!isObject(core)) return "unknown";
  if (core.negativeFeedback === true || (core.lifecycle && core.lifecycle.negativeFeedback === true)) {
    return "negative_feedback";
  }
  if (core.supportConfirmed === true || (core.lifecycle && core.lifecycle.supportConfirmed === true)) {
    return "supported";
  }
  if (core.expectationOverdrawn === true || (core.lifecycle && core.lifecycle.expectationOverdrawn === true)) {
    return "expectation_overdrawn";
  }
  if (core.accelerating === true || (core.lifecycle && core.lifecycle.accelerating === true)) {
    return "acceleration";
  }
  if (core.weakToStrong === true || (core.lifecycle && core.lifecycle.weakToStrong === true)) {
    return "weak_to_strong";
  }
  return normalizeStage(extractRawStage(core));
}

function coreIdentity(core, index) {
  const code = String(core && (core.code || core.stockCode || core.symbol) || "").trim();
  const name = String(core && core.name || "").trim();
  return code || name || `core-${index + 1}`;
}

function coreImpact(core) {
  const leadership = isObject(core && core.leadership) ? core.leadership : {};
  const explicit = finiteNumber(core && core.emotionWeight);
  const leadershipImpact = finiteNumber(leadership.impactScore);
  const initiative = finiteNumber(core && core.initiativeScore);
  if (explicit != null) return clamp(explicit, 0, 100);
  if (leadershipImpact != null) return clamp(leadershipImpact, 0, 100);
  if (initiative != null) return clamp(initiative, 0, 100);
  const role = String(core && (core.role || leadership.identity || leadership.anchorType) || "");
  if (/龙头|leader/.test(role)) return 90;
  if (/高标|high/.test(role)) return 85;
  if (/先锋|pioneer/.test(role)) return 78;
  if (/中军|容量|capacity/.test(role)) return 74;
  if (/补涨|catch/.test(role)) return 56;
  return 45;
}

function inferDivergence(marketState, items, options) {
  const explicitSize = String(options && options.divergenceSize || "").trim().toLowerCase();
  const explicitQuality = String(options && options.divergenceQuality || "").trim().toLowerCase();
  const validSizes = new Set(["small", "medium", "large", "unknown"]);
  const validQualities = new Set(["benign", "mixed", "harmful", "unknown"]);
  let size = validSizes.has(explicitSize) ? explicitSize : "unknown";
  let quality = validQualities.has(explicitQuality) ? explicitQuality : "unknown";
  const dailyKey = String(marketState && marketState.dailyState && marketState.dailyState.key || "");
  if (size === "unknown" || quality === "unknown") {
    if (dailyKey === "healthy_divergence") {
      if (size === "unknown") size = "small";
      if (quality === "unknown") quality = "benign";
    } else if (dailyKey === "mixed_divergence") {
      if (size === "unknown") size = "medium";
      if (quality === "unknown") quality = "mixed";
    } else if (dailyKey === "retreat_candidate") {
      if (size === "unknown") size = "large";
      if (quality === "unknown") quality = "harmful";
    }
  }
  const highImpactNegative = items.filter((item) => item.stage === "negative_feedback" && item.impact >= 65).length;
  const highImpactSupported = items.filter((item) => item.stage === "supported" && item.impact >= 65).length;
  if (highImpactNegative >= 2) {
    size = "large";
    quality = "harmful";
  } else if (highImpactSupported >= 2 && quality === "unknown") {
    quality = "benign";
  }
  return { size, quality };
}

function assessAccelerationTransition(input = {}) {
  const cycleKey = normalizeCycle(input.cycleKey || input.cycle);
  const base = {
    main_rise: { brief_divergence_then_consensus: 58, range_divergence: 27, harmful_divergence: 15 },
    range: { brief_divergence_then_consensus: 20, range_divergence: 51, harmful_divergence: 29 },
    retreat: { brief_divergence_then_consensus: 8, range_divergence: 27, harmful_divergence: 65 },
    ice_point: { brief_divergence_then_consensus: 14, range_divergence: 39, harmful_divergence: 47 },
    chaos: { brief_divergence_then_consensus: 20, range_divergence: 49, harmful_divergence: 31 },
    unknown: { brief_divergence_then_consensus: 22, range_divergence: 47, harmful_divergence: 31 },
  }[cycleKey];
  const scores = { ...base };
  const size = String(input.divergenceSize || "unknown");
  const quality = String(input.divergenceQuality || "unknown");
  if (size === "small") {
    scores.brief_divergence_then_consensus += 5;
    scores.harmful_divergence -= 3;
  } else if (size === "large") {
    scores.brief_divergence_then_consensus -= 5;
    scores.harmful_divergence += 8;
  }
  if (quality === "benign") {
    scores.brief_divergence_then_consensus += 10;
    scores.harmful_divergence -= 6;
  } else if (quality === "harmful") {
    scores.brief_divergence_then_consensus -= 7;
    scores.harmful_divergence += 11;
  }
  const probabilities = normalizeScores(scores, ACCELERATION_PATH_KEYS);
  const primary = primaryFromProbabilities(probabilities, ACCELERATION_PATH_KEYS, ACCELERATION_PATH_LABELS);
  const scenarios = ACCELERATION_PATH_KEYS.map((key) => ({
    key,
    label: ACCELERATION_PATH_LABELS[key],
    probability: probabilities[key],
  }));
  const instructions = {
    main_rise: {
      verification: ["核心加速后首次分歧不出现成片破位", "分歧缩量或快速收回关键承接位", "至少两只独立核心重新形成一致"],
      action: "不追加速段；等待短暂分歧承接，重新一致后持有或按计划加仓。",
    },
    range: {
      verification: ["先区分小分歧还是大分歧", "核心回踩能否收回均价与首次承接低点", "负反馈是否从单点扩散到核心篮子"],
      action: "默认按分歧兑现处理；只有小分歧且承接良性才允许试错，大分歧不抢修复。",
    },
    retreat: {
      verification: ["加速是否只是退潮中的脉冲反抽", "核心反抽后是否重新破位", "跌停与大跌是否继续扩散"],
      action: "默认按非良性分歧防守；局部承接优先视为减仓窗口，不能据此单独升级周期。",
    },
    ice_point: {
      verification: ["反弹是否有多核心共振", "负反馈是否连续收缩", "指数结构是否停止创新低"],
      action: "只做修复验证，不因单日加速直接确认新主升。",
    },
    chaos: {
      verification: ["加速方向是否具备持续广度", "分歧后主动核心是否仍有带动性", "负反馈有没有跨方向扩散"],
      action: "按震荡分歧处理，先验证承接再决定是否保留试仓。",
    },
    unknown: {
      verification: ["先补齐指数周期与核心阶段数据", "观察多核心而非单票反馈"],
      action: "周期未确认时不依据加速形态单独生成买点。",
    },
  }[cycleKey];
  return {
    method: "rule_prior",
    calibrated: false,
    cycleKey,
    cycleLabel: CYCLE_LABELS[cycleKey],
    probabilities,
    primary,
    scenarios,
    verification: instructions.verification,
    action: instructions.action,
  };
}

function buildSentimentCycle(marketState, coreStocks, selectedCandidateCode, options = {}) {
  const legacyCycleKey = normalizeCycle(
    marketState && (marketState.structuralCycle || marketState.cycle || marketState.observedCycle),
  );
  const legacyRegimeSource = marketState && marketState.structuralCycle
    ? "structural_index_cycle"
    : marketState && (marketState.cycle || marketState.observedCycle)
      ? "market_cycle_fallback"
      : "missing";
  const canonicalIndex = isObject(options._canonicalIndexView)
    ? options._canonicalIndexView
    : inspectCanonicalIndex(firstProvided([
        { owner: options, key: "indexCycleRegime", source: "options.indexCycleRegime" },
      ]));
  const canonicalEmotion = isObject(options._canonicalEmotionView)
    ? options._canonicalEmotionView
    : inspectCanonicalEmotion(firstProvided([
        { owner: options, key: "emotionCycle", source: "options.emotionCycle" },
      ]));
  const cycleKey = canonicalIndex.usable
    ? canonicalIndex.key
    : canonicalIndex.supplied
      ? "unknown"
      : legacyCycleKey;
  const regimeSource = canonicalIndex.usable
    ? canonicalIndex.source
    : canonicalIndex.supplied
      ? "canonical_unavailable"
      : legacyRegimeSource;
  const selected = String(selectedCandidateCode || "").trim();
  const items = (Array.isArray(coreStocks) ? coreStocks : [])
    .filter(isObject)
    .map((core, index) => {
      const id = coreIdentity(core, index);
      const stage = classifyCoreStage(core);
      const lifecycle = isObject(core.lifecycle) ? core.lifecycle : {};
      return {
        id,
        code: String(core.code || core.stockCode || core.symbol || ""),
        name: String(core.name || id),
        stage,
        stageLabel: STAGE_LABELS[stage],
        previousStage: normalizeStage(lifecycle.previousStage || core.previousEmotionStage),
        impact: coreImpact(core),
        selectedCandidate: Boolean(selected && id === selected),
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // The recommended stock may be shown in the basket, but it must never define the
  // market-level phase or validate its own entry environment.
  const marketItems = items.filter((item) => !item.selectedCandidate);
  const selectedCandidatePresent = items.some((item) => item.selectedCandidate);
  const counts = Object.fromEntries(Object.keys(STAGE_LABELS).map((key) => [key, 0]));
  marketItems.forEach((item) => { counts[item.stage] = (counts[item.stage] || 0) + 1; });
  const allCounts = Object.fromEntries(Object.keys(STAGE_LABELS).map((key) => [key, 0]));
  items.forEach((item) => { allCounts[item.stage] = (allCounts[item.stage] || 0) + 1; });
  const tracked = marketItems.filter((item) => item.stage !== "unknown");
  const highImpact = marketItems.filter((item) => item.impact >= 65);
  // Acceleration is a transition/risk state, not independent proof that tomorrow
  // will strengthen. Its effect is handled once, below, according to the index cycle.
  const positiveStages = new Set(["weak_to_strong", "supported", "consensus_resume"]);
  const positiveIndependent = marketItems.filter((item) => (
    item.impact >= 55 && positiveStages.has(item.stage)
  ));
  const negativeHighImpact = marketItems.filter((item) => (
    item.impact >= 65 && item.stage === "negative_feedback"
  ));
  const divergenceHighImpact = marketItems.filter((item) => (
    item.impact >= 65 && item.stage === "divergence"
  ));
  const accelerated = marketItems.filter((item) => (
    item.stage === "acceleration" || item.stage === "expectation_overdrawn"
  ));
  const independentPositiveIds = new Set(positiveIndependent.map((item) => item.id));
  const negativeHighImpactIds = new Set(negativeHighImpact.map((item) => item.id));
  const acceleratedIds = new Set(accelerated.map((item) => item.id));
  const independentAcceleratedIds = new Set(accelerated.map((item) => item.id));
  const divergence = inferDivergence(marketState, marketItems, options);
  let accelerationPath = accelerated.length
    ? assessAccelerationTransition({
        cycleKey,
        divergenceSize: divergence.size,
        divergenceQuality: divergence.quality,
      })
    : null;

  const stageWeight = (stages) => marketItems.reduce((sum, item) => (
    stages.includes(item.stage) ? sum + item.impact : sum
  ), 0);
  const aggregateCandidates = [
    { key: "expectation_overdrawn", stages: ["expectation_overdrawn"] },
    { key: "acceleration", stages: ["acceleration"] },
    { key: "supported", stages: ["supported", "consensus_resume"] },
    { key: "weak_to_strong", stages: ["weak_to_strong"] },
    { key: "divergence", stages: ["divergence"] },
    { key: "weak", stages: ["weak"] },
  ].map((item, order) => ({
    ...item,
    order,
    weight: stageWeight(item.stages),
    count: item.stages.reduce((sum, stage) => sum + (counts[stage] || 0), 0),
  })).filter((item) => item.count > 0)
    .sort((a, b) => b.weight - a.weight || b.count - a.count || a.order - b.order);

  let aggregateStage = "unknown";
  if (negativeHighImpact.length >= 2) aggregateStage = "negative_feedback";
  else if (aggregateCandidates.length) aggregateStage = aggregateCandidates[0].key;
  else if (negativeHighImpact.length === 1) aggregateStage = "divergence";

  let aggregateStageLabel = STAGE_LABELS[aggregateStage];
  if (aggregateStage === "negative_feedback") {
    aggregateStageLabel = "高影响核心负反馈扩散";
  } else if (
    aggregateStage === "expectation_overdrawn"
    && (counts.divergence || negativeHighImpact.length === 1)
  ) {
    aggregateStageLabel = divergenceHighImpact.length >= 2
      ? "预期透支·分歧扩散中"
      : "预期透支·局部分歧已出现";
  } else if (
    aggregateStage === "acceleration"
    && (counts.divergence || negativeHighImpact.length === 1)
  ) {
    aggregateStageLabel = divergenceHighImpact.length >= 2
      ? "加速阶段·分歧扩散中"
      : "加速阶段·局部分歧已出现";
  } else if (aggregateStage === "divergence" && negativeHighImpact.length === 1 && !counts.divergence) {
    aggregateStageLabel = "单点核心负反馈待验证";
  }

  let expectedTransition = { key: "cycle_continuation", label: "按当前周期继续验证" };
  if (accelerationPath) expectedTransition = { ...accelerationPath.primary };
  else {
    const dailyKey = String(marketState && marketState.dailyState && marketState.dailyState.key || "");
    if (dailyKey === "healthy_divergence") {
      expectedTransition = { key: "support_validation", label: "分化后验证承接" };
    } else if (dailyKey === "retreat_candidate") {
      expectedTransition = { key: "negative_feedback_expansion", label: "防范负反馈继续扩散" };
    } else if (dailyKey === "repair_strengthening") {
      expectedTransition = { key: "repair_continuation", label: "修复延续并等待主线确认" };
    }
  }

  let baseline = {
    key: expectedTransition.key,
    label: expectedTransition.label,
    reason: "由legacy核心篮子与旧市场状态生成",
    source: "legacy_sentiment_cycle",
    actionable: aggregateStage !== "unknown",
  };
  if (canonicalEmotion.supplied) {
    baseline = canonicalEmotionBaseline(canonicalEmotion);
    accelerationPath = null;
    if (canonicalEmotion.usable) {
      aggregateStage = canonicalEmotion.key;
      aggregateStageLabel = canonicalEmotion.label;
      expectedTransition = { ...baseline };
    } else {
      aggregateStage = "unknown";
      aggregateStageLabel = "阶段待确认（canonical情绪模型不可用）";
      expectedTransition = { ...baseline };
    }
  }

  return {
    marketRegime: {
      key: cycleKey,
      label: canonicalIndex.usable ? canonicalIndex.label : CYCLE_LABELS[cycleKey],
      source: regimeSource,
      canonical: canonicalIndex.supplied,
      smallCycle: canonicalIndex.usable ? canonicalIndex.smallCycle : null,
    },
    aggregateStage,
    aggregateStageLabel,
    stageSource: canonicalEmotion.supplied
      ? (canonicalEmotion.usable ? "canonical_emotion_cycle" : "canonical_unavailable")
      : "legacy_core_basket",
    baseline,
    tomorrowBaseline: baseline,
    expectedTransition,
    divergenceSize: divergence.size,
    divergenceQuality: divergence.quality,
    coreBasket: {
      total: marketItems.length,
      totalIncludingSelectedCandidate: items.length,
      tracked: tracked.length,
      highImpact: highImpact.length,
      positiveIndependentCount: independentPositiveIds.size,
      negativeHighImpactCount: negativeHighImpactIds.size,
      negativeFeedbackState: negativeHighImpactIds.size >= 2
        ? { key: "expanding", label: "高影响核心负反馈扩散" }
        : negativeHighImpactIds.size === 1
          ? { key: "isolated", label: "单点核心负反馈待验证" }
          : { key: "none", label: "未见高影响核心负反馈" },
      divergenceState: divergenceHighImpact.length >= 2
        ? { key: "expanding", label: "高影响核心分歧扩散" }
        : divergenceHighImpact.length === 1
          ? { key: "isolated", label: "局部核心分歧待验证" }
          : { key: "none", label: "未见高影响核心分歧" },
      acceleratedCount: acceleratedIds.size,
      independentAcceleratedCount: independentAcceleratedIds.size,
      selectedCandidateExcludedFromPositiveValidation: selectedCandidatePresent,
      selectedCandidateCode: selected || null,
      counts,
      countsIncludingSelectedCandidate: allCounts,
      legacyUsedForAggregate: !canonicalEmotion.supplied,
      legacyUsedForScoring: !canonicalEmotion.supplied,
    },
    items,
    accelerationPath,
    canonical: {
      indexCycleRegime: {
        supplied: canonicalIndex.supplied,
        usable: canonicalIndex.usable,
        unavailable: canonicalIndex.unavailable,
        source: canonicalIndex.source,
        reason: canonicalIndex.reason,
      },
      emotionCycle: {
        supplied: canonicalEmotion.supplied,
        usable: canonicalEmotion.usable,
        unavailable: canonicalEmotion.unavailable,
        stageKnown: canonicalEmotion.stageKnown,
        source: canonicalEmotion.source,
        reason: canonicalEmotion.reason,
      },
    },
  };
}

function assessPreviousTradingDay(context) {
  const meta = isObject(context.previousTradingDay) ? context.previousTradingDay : {};
  const dates = isObject(context.limitStats && context.limitStats.dates) ? context.limitStats.dates : {};
  const previousDates = isObject(context.previousLimitStats && context.previousLimitStats.dates)
    ? context.previousLimitStats.dates
    : {};
  const previousArchiveMeta = isObject(context.previousPayload && context.previousPayload.archiveMeta)
    ? context.previousPayload.archiveMeta
    : {};
  const expectedDate = normalizeDate(
    meta.expectedDate || meta.expectedPreviousTradingDate || (dates.verified === true ? dates.prev : ""),
  );
  const actualDate = normalizeDate(
    meta.actualDate
      || meta.previousArchiveDate
      || previousArchiveMeta.tradingDate
      || previousDates.today,
  );
  const snapshotKind = String(meta.snapshotKind || previousArchiveMeta.snapshotKind || "").toLowerCase();
  const verified = meta.verified === true || meta.exactPreviousTradingDay === true || dates.verified === true;
  const exactArchive = Boolean(
    verified
    && expectedDate
    && actualDate
    && expectedDate === actualDate
    && snapshotKind === "closing"
    && isObject(context.previousSnapshot),
  );
  const providerPreviousDateVerified = Boolean(
    dates.verified === true
    && expectedDate
    && normalizeDate(dates.prev) === expectedDate,
  );
  let reason = "缺少经校验的T-1收盘归档";
  if (exactArchive) reason = `已匹配精确T-1收盘归档 ${actualDate}`;
  else if (expectedDate && actualDate && expectedDate !== actualDate) {
    reason = `期望T-1为${expectedDate}，实际归档为${actualDate}，禁止跨日比较`;
  } else if (actualDate && snapshotKind !== "closing") {
    reason = `T-1快照类型为${snapshotKind || "unknown"}，不是收盘归档`;
  }
  return {
    exactArchive,
    expectedDate: expectedDate || null,
    actualDate: actualDate || null,
    snapshotKind: snapshotKind || null,
    providerPreviousDateVerified,
    reason,
  };
}

function extractContext(payload, options = {}) {
  const source = isObject(payload) ? payload : {};
  const market = isObject(source.market) ? source.market : {};
  const previousPayload = isObject(options.previousPayload)
    ? options.previousPayload
    : (isObject(source.previousPayload) ? source.previousPayload : null);
  const previousMarket = isObject(previousPayload && previousPayload.market) ? previousPayload.market : {};
  const snapshot = isObject(options.snapshot)
    ? options.snapshot
    : (isObject(market.snapshot) ? market.snapshot : (isObject(source.snapshot) ? source.snapshot : {}));
  const limitStats = isObject(options.limitStats)
    ? options.limitStats
    : (isObject(market.limitStats) ? market.limitStats : (isObject(source.limitStats) ? source.limitStats : {}));
  const marketState = isObject(options.marketState)
    ? options.marketState
    : (isObject(market.state) ? market.state : (isObject(source.marketState) ? source.marketState : {}));
  const previousSnapshot = isObject(options.previousSnapshot)
    ? options.previousSnapshot
    : (isObject(previousMarket.snapshot) ? previousMarket.snapshot : {});
  const previousLimitStats = isObject(options.previousLimitStats)
    ? options.previousLimitStats
    : (isObject(previousMarket.limitStats) ? previousMarket.limitStats : {});
  const candidates = Array.isArray(options.coreStocks)
    ? options.coreStocks
    : (Array.isArray(source.candidates) ? source.candidates : []);
  const selectedCandidateCode = String(
    options.selectedCandidateCode
      || source.selectedCandidateCode
      || "",
  ).trim();
  const providerTradingDate = normalizeDate(
    limitStats && limitStats.dates && limitStats.dates.today,
  );
  const emotionTradingDate = normalizeDate(source.marketEmotion && source.marketEmotion.tradingDate);
  const premarketModels = isObject(source.premarketModels) ? source.premarketModels : {};
  const topLevelCoreEmotion = isObject(source.coreEmotion) ? source.coreEmotion : {};
  const tomorrowDecision = isObject(source.tomorrowDecision) ? source.tomorrowDecision : {};
  const decisionCoreEmotion = isObject(tomorrowDecision.coreEmotion) ? tomorrowDecision.coreEmotion : {};
  const canonicalIndexInput = firstProvided([
    { owner: options, key: "indexCycleRegime", source: "options.indexCycleRegime" },
    { owner: source, key: "indexCycleRegime", source: "payload.indexCycleRegime" },
    { owner: premarketModels, key: "indexCycleRegime", source: "payload.premarketModels.indexCycleRegime" },
    { owner: marketState, key: "indexCycleRegime", source: "payload.market.state.indexCycleRegime" },
  ]);
  const canonicalEmotionInput = firstProvided([
    { owner: options, key: "emotionCycle", source: "options.emotionCycle" },
    { owner: source, key: "emotionCycle", source: "payload.emotionCycle" },
    { owner: premarketModels, key: "emotionCycle", source: "payload.premarketModels.emotionCycle" },
    { owner: topLevelCoreEmotion, key: "emotionCycle", source: "payload.coreEmotion.emotionCycle" },
    { owner: decisionCoreEmotion, key: "emotionCycle", source: "payload.tomorrowDecision.coreEmotion.emotionCycle" },
  ]);
  return {
    payload: source,
    snapshot,
    limitStats,
    marketState,
    previousPayload,
    previousSnapshot,
    previousLimitStats,
    previousTradingDay: options.previousTradingDay || source.previousTradingDay,
    coreStocks: candidates,
    selectedCandidateCode,
    tradingDate: providerTradingDate || emotionTradingDate || null,
    providerTradingDate: providerTradingDate || null,
    canonicalIndex: inspectCanonicalIndex(canonicalIndexInput),
    canonicalEmotion: inspectCanonicalEmotion(canonicalEmotionInput),
    options,
  };
}

function indexStructureSignal(indexStructures) {
  const recognized = { uptrend: 0, repair: 0, sideways: 0, bottoming: 0, downtrend: 0 };
  (Array.isArray(indexStructures) ? indexStructures : []).forEach((row) => {
    const raw = String(row && (row.trendKey || row.trendLabel) || "").toLowerCase();
    let key = "";
    if (/uptrend|上升|多头/.test(raw)) key = "uptrend";
    else if (/repair|修复|回暖/.test(raw)) key = "repair";
    else if (/sideways|震荡|区间/.test(raw)) key = "sideways";
    else if (/bottom|筑底|止跌/.test(raw)) key = "bottoming";
    else if (/downtrend|下降|空头|走弱/.test(raw)) key = "downtrend";
    if (key) recognized[key] += 1;
  });
  const total = Object.values(recognized).reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  const ratio = (key) => recognized[key] / total;
  let effect = { strengthen: 0, range_divergence: 3, weaken: 0 };
  let summary = "指数结构分散，按震荡验证";
  if (ratio("uptrend") >= 0.5) {
    effect = { strengthen: 10, range_divergence: -2, weaken: -5 };
    summary = "多数主要指数处于上升结构";
  } else if (ratio("downtrend") + ratio("bottoming") >= 0.5) {
    effect = { strengthen: -4, range_divergence: 2, weaken: 10 };
    summary = "多数主要指数处于下行或筑底结构";
  } else if (ratio("repair") >= 0.5) {
    effect = { strengthen: 4, range_divergence: 5, weaken: -2 };
    summary = "多数主要指数处于修复结构";
  } else if (ratio("sideways") >= 0.5) {
    effect = { strengthen: 0, range_divergence: 8, weaken: 0 };
    summary = "多数主要指数处于区间震荡";
  }
  return { counts: recognized, total, effect, summary };
}

function updateRules() {
  return [
    {
      time: "09:25",
      purpose: "竞价只更新先验，不直接追价",
      upgradeConditions: [
        "主要指数竞价方向一致，且市场宽度预估没有明显背离",
        "至少两只独立高影响核心同步超预期，板块不是单票孤立高开",
        "昨日负反馈核心没有继续批量低开核按钮",
      ],
      downgradeConditions: [
        "权重指数与短线核心同时低于预期",
        "加速核心出现集体高开透支，跟随与容量承接缺失",
        "昨日强势批次出现成片负反馈",
      ],
      guardrails: ["单只推荐候选独强不得上调市场加强概率", "即使加强概率上升，个股价格已透支也不得追高"],
    },
    {
      time: "09:35",
      purpose: "用开盘后的真实承接完成首次可交易更新",
      upgradeConditions: [
        "指数、市场宽度和成交承接至少两项同步改善",
        "主动核心、先锋与容量中军中至少两类形成共振",
        "加速后的首次分歧缩量或快速收回，未扩散为负反馈",
      ],
      downgradeConditions: [
        "指数反抽但上涨家数继续收缩，形成权重掩护式背离",
        "高影响核心放量跌破首次承接低点且反抽不过均价",
        "跌停、大跌或炸板从单点扩散到多个核心方向",
      ],
      guardrails: ["加强确认主要用于加仓，不是追第一段加速", "验证成立但赔率消失时，动作仍是取消买入"],
    },
  ];
}

function buildTomorrowMarketForecast(payload, options = {}) {
  const context = extractContext(payload, options);
  const {
    snapshot,
    limitStats,
    marketState,
    previousSnapshot,
    previousLimitStats,
    canonicalIndex,
    canonicalEmotion,
  } = context;
  const legacyCycleKey = normalizeCycle(
    marketState && (marketState.structuralCycle || marketState.cycle || marketState.observedCycle),
  );
  const cycleKey = canonicalIndex.usable
    ? canonicalIndex.key
    : canonicalIndex.supplied
      ? "unknown"
      : legacyCycleKey;
  const scores = { ...CYCLE_PRIORS[cycleKey] };
  const indexOutlook = buildTomorrowIndexPath(payload, {
    ...options,
    previousPayload: context.previousPayload,
    previousTradingDay: context.previousTradingDay,
  });
  const profitEffectOutlook = buildTomorrowProfitEffectForecast(payload, {
    ...options,
    previousPayload: context.previousPayload,
    previousTradingDay: context.previousTradingDay,
    emotionCycle: options.emotionCycle,
  });
  const evidence = [];
  const addEvidence = (id, label, scope, effect, detail, available = true) => {
    const row = {
      id,
      label,
      scope,
      available: Boolean(available),
      effect: available && effect ? { ...effect } : null,
      detail: String(detail || ""),
    };
    evidence.push(row);
    if (row.available) shiftScore(scores, effect);
  };

  if (cycleKey === "unknown") {
    addEvidence(
      "cycle_prior",
      "指数大周期",
      "index",
      null,
      canonicalIndex.supplied ? canonicalIndex.reason : "指数周期缺失，使用中性规则先验",
      false,
    );
  } else {
    addEvidence(
      "cycle_prior",
      "指数大周期",
      "index",
      { strengthen: 0, range_divergence: 0, weaken: 0 },
      `${canonicalIndex.usable ? canonicalIndex.label : CYCLE_LABELS[cycleKey]}作为基础先验；${canonicalIndex.usable ? "来自canonical indexCycleRegime" : "来自legacy周期"}，它决定环境，不直接替代买点`,
      true,
    );
  }

  const structure = indexStructureSignal(snapshot.indexStructures);
  if (structure) {
    addEvidence(
      "index_structure",
      "主要指数结构",
      "index",
      structure.effect,
      `${structure.summary}（有效覆盖${structure.total}个指数）`,
    );
  } else {
    addEvidence("index_structure", "主要指数结构", "index", null, "指数均线结构缺失，未计分", false);
  }

  const avgIndexChange = finiteNumber(snapshot.avgIndexChange);
  if (avgIndexChange == null) {
    addEvidence("index_day", "指数当日强弱", "index", null, "指数平均涨跌幅缺失，未按0处理", false);
  } else {
    let effect = { strengthen: 0, range_divergence: 2, weaken: 0 };
    if (avgIndexChange >= 1.5) effect = { strengthen: 4, range_divergence: 3, weaken: -2 };
    else if (avgIndexChange >= 0.6) effect = { strengthen: 3, range_divergence: 2, weaken: -1 };
    else if (avgIndexChange <= -1.5) effect = { strengthen: -3, range_divergence: 2, weaken: 8 };
    else if (avgIndexChange <= -0.6) effect = { strengthen: -2, range_divergence: 3, weaken: 5 };
    addEvidence("index_day", "指数当日强弱", "index", effect, `主要指数平均${avgIndexChange >= 0 ? "+" : ""}${avgIndexChange.toFixed(2)}%`);
  }

  const breadth = finiteNumber(snapshot.breadth);
  if (breadth == null) {
    addEvidence("market_breadth", "市场宽度", "index", null, "上涨覆盖率缺失，未按0处理", false);
  } else {
    let effect = { strengthen: 0, range_divergence: 3, weaken: 0 };
    if (breadth >= 0.65) effect = { strengthen: 8, range_divergence: -2, weaken: -2 };
    else if (breadth <= 0.35) effect = { strengthen: -3, range_divergence: 2, weaken: 9 };
    else if (breadth >= 0.45 && breadth <= 0.6) effect = { strengthen: 0, range_divergence: 5, weaken: 0 };
    let detail = `上涨覆盖率${Math.round(breadth * 100)}%`;
    if (avgIndexChange != null && avgIndexChange >= 0.8 && breadth < 0.58) {
      effect = {
        strengthen: effect.strengthen - 1,
        range_divergence: effect.range_divergence + 7,
        weaken: effect.weaken + 2,
      };
      detail += "，指数上涨但个股覆盖不足，存在指数强/个股分化";
    }
    addEvidence("market_breadth", "市场宽度", "index", effect, detail);
  }

  const previousAssessment = assessPreviousTradingDay(context);
  const currentAmount = finiteNumber(snapshot.shszAmountYi ?? snapshot.totalAmountYi);
  const previousAmount = finiteNumber(previousSnapshot.shszAmountYi ?? previousSnapshot.totalAmountYi);
  if (previousAssessment.exactArchive && currentAmount != null && previousAmount != null && previousAmount > 0) {
    const ratio = currentAmount / previousAmount;
    let effect = { strengthen: 0, range_divergence: 3, weaken: 0 };
    if (ratio >= 1.1) effect = { strengthen: 5, range_divergence: 1, weaken: -2 };
    else if (ratio < 0.75) effect = { strengthen: -2, range_divergence: 1, weaken: 7 };
    addEvidence("turnover_comparison", "两市成交承接", "index", effect, `精确T-1成交比${Math.round(ratio * 100)}%`);
  } else {
    addEvidence(
      "turnover_comparison",
      "两市成交承接",
      "index",
      null,
      `${previousAssessment.reason}；成交额环比不参与评分`,
      false,
    );
  }

  const ztToday = finiteNumber(limitStats.ztToday);
  const dtToday = finiteNumber(limitStats.dtToday);
  const providerPrevZt = finiteNumber(limitStats.ztPrev);
  const providerPrevDt = finiteNumber(limitStats.dtPrev);
  const archivePrevZt = finiteNumber(previousLimitStats.ztToday);
  const archivePrevDt = finiteNumber(previousLimitStats.dtToday);
  const ztPrev = previousAssessment.providerPreviousDateVerified ? providerPrevZt : archivePrevZt;
  const dtPrev = previousAssessment.providerPreviousDateVerified ? providerPrevDt : archivePrevDt;
  const exactLimitComparison = Boolean(
    (previousAssessment.providerPreviousDateVerified || previousAssessment.exactArchive)
    && ztToday != null && dtToday != null && ztPrev != null && dtPrev != null,
  );
  if (exactLimitComparison) {
    const ztRatio = ztPrev > 0 ? ztToday / ztPrev : null;
    const dtExpansion = dtToday - dtPrev;
    let effect = { strengthen: 0, range_divergence: 3, weaken: 0 };
    if (ztRatio != null && ztRatio >= 1.1 && dtToday <= dtPrev) {
      effect = { strengthen: 6, range_divergence: -1, weaken: -2 };
    } else if ((ztRatio != null && ztRatio < 0.8) || dtExpansion >= Math.max(3, dtPrev * 0.5)) {
      effect = { strengthen: -2, range_divergence: 4, weaken: 6 };
    }
    addEvidence("limit_comparison", "极端情绪跨日变化", "emotion", effect, `涨停${ztPrev}→${ztToday}，跌停${dtPrev}→${dtToday}`);
  } else {
    addEvidence("limit_comparison", "极端情绪跨日变化", "emotion", null, "缺少经交易日校验的完整涨跌停对比，未计分", false);
  }

  if (dtToday == null) {
    addEvidence("current_extreme_feedback", "当日极端负反馈", "emotion", null, "当日跌停数缺失，未按0处理", false);
  } else {
    let effect = { strengthen: 0, range_divergence: 1, weaken: 0 };
    if (dtToday >= 15) effect = { strengthen: -2, range_divergence: 2, weaken: 7 };
    else if (dtToday <= 5) effect = { strengthen: 2, range_divergence: 0, weaken: -2 };
    addEvidence("current_extreme_feedback", "当日极端负反馈", "emotion", effect, `当日跌停${dtToday}只`);
  }

  const dailyKey = String(marketState && marketState.dailyState && marketState.dailyState.key || "");
  const dailyEffects = {
    repair_strengthening: { strengthen: 7, range_divergence: 0, weaken: -3 },
    healthy_divergence: { strengthen: 0, range_divergence: 8, weaken: -1 },
    mixed_divergence: { strengthen: -2, range_divergence: 7, weaken: 3 },
    retreat_candidate: { strengthen: -4, range_divergence: 2, weaken: 12 },
    ice_point: { strengthen: -1, range_divergence: 4, weaken: 5 },
    repair: { strengthen: 3, range_divergence: 4, weaken: -1 },
  };
  if (canonicalEmotion.supplied && canonicalEmotion.usable) {
    addEvidence(
      "daily_state",
      "今日情绪状态",
      "emotion",
      { strengthen: 0, range_divergence: 0, weaken: 0 },
      "canonical emotionCycle已接管阶段；legacy dailyState仅保留诊断，不重复计分",
      true,
    );
  } else if (canonicalEmotion.supplied) {
    addEvidence("daily_state", "今日情绪状态", "emotion", null, `${canonicalEmotion.reason}；禁止用legacy dailyState回填`, false);
  } else if (dailyEffects[dailyKey]) {
    addEvidence("daily_state", "今日情绪状态", "emotion", dailyEffects[dailyKey], String(marketState.dailyState.label || dailyKey));
  } else {
    addEvidence("daily_state", "今日情绪状态", "emotion", null, "今日情绪状态缺失或不可识别，未计分", false);
  }

  const profitScore = finiteNumber(marketState && marketState.profitEffect && marketState.profitEffect.score);
  const lossScore = finiteNumber(marketState && marketState.lossEffect && marketState.lossEffect.score);
  if (profitScore != null && lossScore != null) {
    const margin = profitScore - lossScore;
    let effect = { strengthen: 0, range_divergence: 3, weaken: 0 };
    if (margin >= 25) effect = { strengthen: 4, range_divergence: 2, weaken: -2 };
    else if (margin <= -20) effect = { strengthen: -3, range_divergence: 2, weaken: 7 };
    addEvidence("profit_loss_effect", "赚钱与亏钱效应", "emotion", effect, `赚钱效应${profitScore.toFixed(1)}，亏钱效应${lossScore.toFixed(1)}`);
  } else {
    addEvidence("profit_loss_effect", "赚钱与亏钱效应", "emotion", null, "赚钱或亏钱效应分缺失，未按0处理", false);
  }

  const sentimentCycle = buildSentimentCycle(
    marketState,
    context.coreStocks,
    context.selectedCandidateCode,
    {
      ...options,
      _canonicalIndexView: canonicalIndex,
      _canonicalEmotionView: canonicalEmotion,
    },
  );
  const basket = sentimentCycle.coreBasket;
  if (canonicalEmotion.supplied) {
    basket.legacyUsedForScoring = false;
    const effect = canonicalEmotion.usable && canonicalEmotion.stageKnown
      ? canonicalEmotionEffect(canonicalEmotion.key)
      : null;
    addEvidence(
      "core_emotion_basket",
      "canonical情绪状态机",
      "emotion",
      effect,
      canonicalEmotion.usable
        ? canonicalEmotion.stageKnown
          ? `${canonicalEmotion.label}；次日基线：${sentimentCycle.baseline.label}；legacy核心阶段未重复计分`
          : "canonical情绪阶段为unknown；legacy核心阶段禁止回填"
        : canonicalEmotion.reason,
      Boolean(effect),
    );
  } else if (!basket.tracked) {
    addEvidence(
      "core_emotion_basket",
      "高影响核心篮子",
      "emotion",
      null,
      basket.selectedCandidateExcludedFromPositiveValidation
        ? "已排除推荐票；剩余独立核心阶段不足，不能验证市场加强"
        : "核心生命周期阶段未确认，候选涨幅不代替阶段识别",
      false,
    );
  } else {
    let effect = { strengthen: 0, range_divergence: 0, weaken: 0 };
    const notes = [];
    if (basket.positiveIndependentCount >= 2) {
      effect.strengthen += Math.min(6, 2 + basket.positiveIndependentCount);
      effect.range_divergence -= 1;
      notes.push(`${basket.positiveIndependentCount}只非推荐候选核心形成正向共振`);
    } else {
      notes.push("正向核心不足2只，不能验证市场加强");
    }
    if (basket.negativeHighImpactCount >= 1) {
      effect.strengthen -= Math.min(4, basket.negativeHighImpactCount * 2);
      effect.weaken += Math.min(9, 3 + basket.negativeHighImpactCount * 2);
      notes.push(`${basket.negativeHighImpactCount}只高影响核心出现负反馈`);
    }
    if (basket.independentAcceleratedCount) {
      if (cycleKey === "main_rise") {
        effect.strengthen += 2;
        effect.range_divergence += 4;
      } else if (["range", "chaos"].includes(cycleKey)) {
        effect.strengthen -= 1;
        effect.range_divergence += 6;
        effect.weaken += 2;
      } else if (cycleKey === "retreat") {
        effect.strengthen -= 2;
        effect.range_divergence += 2;
        effect.weaken += 8;
      }
      notes.push(`${basket.independentAcceleratedCount}只非推荐候选核心进入加速/透支阶段，按${CYCLE_LABELS[cycleKey]}周期推演后续分歧`);
    }
    addEvidence("core_emotion_basket", "高影响核心篮子", "emotion", effect, notes.join("；"));
  }

  const probabilities = normalizeScores(scores, MARKET_PATH_KEYS);
  const primary = primaryFromProbabilities(probabilities, MARKET_PATH_KEYS, MARKET_PATH_LABELS);
  const scenarios = MARKET_PATH_KEYS.map((key) => ({
    key,
    label: MARKET_PATH_LABELS[key],
    probability: probabilities[key],
  }));
  const scoredEvidence = evidence.filter((item) => item.id !== "cycle_prior");
  const knownEvidenceCount = scoredEvidence.filter((item) => item.available).length;
  const totalEvidenceCount = scoredEvidence.length;
  const coverage = totalEvidenceCount ? knownEvidenceCount / totalEvidenceCount : 0;
  const hasIndexFoundation = evidence.some((item) => (
    ["index_structure", "index_day", "market_breadth"].includes(item.id) && item.available
  ));
  let confidence = 22 + coverage * 42 + (previousAssessment.exactArchive ? 10 : -8);
  if (structure && breadth != null) confidence += 6;
  confidence = clamp(Math.round(confidence), 15, 78);
  if (!previousAssessment.exactArchive) confidence = Math.min(confidence, 55);
  if (!hasIndexFoundation) confidence = Math.min(confidence, 38);
  if (cycleKey === "unknown") confidence = Math.min(confidence, 42);
  const missingFields = scoredEvidence.filter((item) => !item.available).map((item) => item.id);
  if (canonicalIndex.unavailable) missingFields.push("canonical_index_cycle");
  if (canonicalEmotion.unavailable || (canonicalEmotion.usable && !canonicalEmotion.stageKnown)) {
    missingFields.push("canonical_emotion_cycle");
  }
  if (canonicalIndex.unavailable || canonicalEmotion.unavailable) confidence = Math.min(confidence, 30);
  else if (canonicalEmotion.usable && !canonicalEmotion.stageKnown) confidence = Math.min(confidence, 38);
  const confidenceLabel = confidence >= 68 ? "中高" : confidence >= 50 ? "中等" : confidence >= 35 ? "偏低" : "低";
  const canonicalFailClosed = canonicalIndex.unavailable || canonicalEmotion.unavailable;
  const grade = canonicalFailClosed
    ? "insufficient"
    : previousAssessment.exactArchive && coverage >= 0.75
    ? "good"
    : coverage >= 0.45 && hasIndexFoundation
      ? "limited"
      : "insufficient";

  return {
    version: 1,
    outlookAxesVersion: 1,
    tradingDate: context.tradingDate,
    method: "rule_prior",
    methodLabel: "规则先验（未历史校准）",
    calibrated: false,
    prior: { ...CYCLE_PRIORS[cycleKey] },
    probabilities,
    primary,
    scenarios,
    indexOutlook,
    profitEffectOutlook,
    confidence,
    confidenceLabel,
    dataQuality: {
      grade,
      providerTradingDate: context.providerTradingDate,
      exactPreviousTradingDay: previousAssessment.exactArchive,
      providerPreviousDateVerified: previousAssessment.providerPreviousDateVerified,
      expectedPreviousTradingDate: previousAssessment.expectedDate,
      previousArchiveDate: previousAssessment.actualDate,
      previousSnapshotKind: previousAssessment.snapshotKind,
      knownEvidenceCount,
      totalEvidenceCount,
      coveragePct: Math.round(coverage * 100),
      missingFields,
      canonicalModels: {
        indexCycleRegime: {
          supplied: canonicalIndex.supplied,
          usable: canonicalIndex.usable,
          unavailable: canonicalIndex.unavailable,
          source: canonicalIndex.source,
          reason: canonicalIndex.reason,
        },
        emotionCycle: {
          supplied: canonicalEmotion.supplied,
          usable: canonicalEmotion.usable,
          unavailable: canonicalEmotion.unavailable,
          stageKnown: canonicalEmotion.stageKnown,
          source: canonicalEmotion.source,
          reason: canonicalEmotion.reason,
        },
      },
      notes: [
        "当前为确定性规则先验，不是历史回测胜率；完成逐日样本校准前 calibrated 永远为 false。",
        previousAssessment.reason,
        "推荐候选自身的上涨已从正向市场加强验证中排除；至少需要两只独立高影响核心共振。",
        canonicalFailClosed
          ? "canonical模型不可用：已fail-closed，禁止用legacy强标签回填，置信度上限30。"
          : canonicalEmotion.usable
            ? "canonical emotionCycle已作为唯一情绪阶段与基线来源，legacy阶段不重复计分。"
            : "canonical emotionCycle未提供，保留legacy兼容路径。",
      ],
    },
    evidence,
    sentimentCycle,
    updateRules: updateRules(),
  };
}

module.exports = {
  MARKET_PATH_KEYS,
  MARKET_PATH_LABELS,
  ACCELERATION_PATH_KEYS,
  buildTomorrowMarketForecast,
  buildSentimentCycle,
  assessAccelerationTransition,
  classifyCoreStage,
  normalizeCycle,
  normalizeDate,
};
