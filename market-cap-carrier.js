"use strict";

const VERSION = 2;
const AMOUNT_THRESHOLD_YI = 25000;
const MIN_USABLE_SAMPLE = 12;
const MIN_SPLIT_SAMPLE = 8;
const MIN_USABLE_COVERAGE = 0.5;
const CONFIRMED_SCORE_GAP = 12;
const SPLIT_TIE_TOLERANCE = 0.5;
const MARKET_CAP_BUCKETS = Object.freeze([
  Object.freeze({ key: "under_50", label: "50亿以下", min: 0, max: 50 }),
  Object.freeze({ key: "50_100", label: "50-100亿", min: 50, max: 100 }),
  Object.freeze({ key: "100_300", label: "100-300亿", min: 100, max: 300 }),
  Object.freeze({ key: "300_500", label: "300-500亿", min: 300, max: 500 }),
  Object.freeze({ key: "500_1000", label: "500-1000亿", min: 500, max: 1000 }),
  Object.freeze({ key: "over_1000", label: "1000亿以上", min: 1000, max: null }),
]);

function finite(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  const number = finite(value);
  if (number === null) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function capFromRaw(value) {
  const number = finite(value);
  if (number === null || number <= 0) return null;
  return number >= 1000000 ? number / 100000000 : number;
}

function firstCap(stock, directKeys, rawKeys) {
  for (const key of directKeys) {
    const value = finite(stock && stock[key]);
    if (value !== null && value > 0) return value;
  }
  for (const key of rawKeys) {
    const value = capFromRaw(stock && stock[key]);
    if (value !== null) return value;
  }
  return null;
}

function capBucket(totalCapYi) {
  const value = finite(totalCapYi);
  if (value === null || value <= 0) return { key: "unknown", label: "总市值未知" };
  const bucket = MARKET_CAP_BUCKETS.find((item) => value >= item.min && (item.max === null || value < item.max));
  return bucket ? { key: bucket.key, label: bucket.label } : { key: "unknown", label: "总市值未知" };
}

function marketEvidence(snapshot) {
  const amountYi = finite(snapshot && (snapshot.shszAmountYi ?? snapshot.totalAmountYi));
  const breadth = finite(snapshot && snapshot.breadth);
  const avgIndexChange = finite(snapshot && snapshot.avgIndexChange);
  const amountKnown = amountYi !== null && amountYi > 0;
  const breadthKnown = breadth !== null && breadth >= 0 && breadth <= 1;
  const indexKnown = avgIndexChange !== null;
  return {
    amountYi: amountKnown ? round(amountYi, 2) : null,
    breadth: breadthKnown ? round(breadth, 4) : null,
    breadthPct: breadthKnown ? round(breadth * 100, 1) : null,
    avgIndexChange: indexKnown ? round(avgIndexChange, 2) : null,
    complete: amountKnown && breadthKnown && indexKnown,
    missing: [
      !amountKnown ? "两市成交额" : null,
      !breadthKnown ? "上涨占比" : null,
      !indexKnown ? "主要指数均值" : null,
    ].filter(Boolean),
  };
}

function commonContract() {
  return {
    version: VERSION,
    method: "same_day_candidate_bucket_comparison_unvalidated_v2",
    calibrated: false,
    observationOnly: true,
    scoreAdjustment: 0,
    hardGateImpact: false,
    tradePermissionImpact: false,
    opportunityGateImpact: false,
  };
}

function classifyMarketCapCarrierRegime(snapshot = {}) {
  const evidence = marketEvidence(snapshot);
  const base = {
    ...commonContract(),
    thresholdAmountYi: AMOUNT_THRESHOLD_YI,
    marketAmountYi: evidence.amountYi,
    breadth: evidence.breadth,
    breadthPct: evidence.breadthPct,
    avgIndexChange: evidence.avgIndexChange,
    tradingDate: String(snapshot && snapshot.tradingDate || "") || null,
    dataQuality: {
      status: evidence.complete ? "complete" : "incomplete",
      complete: evidence.complete,
      missing: evidence.missing,
    },
  };

  if (!evidence.complete) {
    return {
      ...base,
      status: "unavailable",
      key: "unknown",
      label: "市值载体待确认",
      carrierLabel: "缺少成交质量证据，不推断市值偏好",
      preferredTotalCapYi: null,
      reason: `缺少${evidence.missing.join("、") || "必要市场数据"}，观察因子按不可用处理。`,
      confirmation: ["补齐两市成交额、上涨占比和主要指数均值"],
    };
  }

  if (evidence.amountYi >= AMOUNT_THRESHOLD_YI) {
    if (evidence.breadth < 0.3 || evidence.avgIndexChange <= -1.5) {
      return {
        ...base,
        status: "mixed",
        key: "panic_volume",
        label: "放量杀跌",
        carrierLabel: "成交额不可用于确认大市值载体",
        preferredTotalCapYi: null,
        reason: `两市成交${evidence.amountYi}亿，但上涨占比${evidence.breadthPct}%、指数均值${evidence.avgIndexChange}%；放量主要反映风险释放。`,
        confirmation: ["上涨占比回到55%以上", "主要指数均值转正", "成交维持25000亿以上"],
      };
    }
    if (evidence.breadth >= 0.55 && evidence.avgIndexChange > 0) {
      return {
        ...base,
        status: "mixed",
        key: "risk_on_capacity",
        label: "放量进攻",
        carrierLabel: "放量进攻，等待候选样本确认主导市值桶",
        preferredTotalCapYi: null,
        reason: `两市成交${evidence.amountYi}亿，上涨占比${evidence.breadthPct}%且指数均值${evidence.avgIndexChange}%；只确认容量扩张环境，不预设大市值必然占优。`,
        confirmation: ["比较固定市值桶的当日上涨率、中位涨幅和强势率", "候选样本形成清晰差异后再启用机会准入"],
      };
    }
    return {
      ...base,
      status: "mixed",
      key: "high_turnover_unconfirmed",
      label: "高成交待定向",
      carrierLabel: "成交质量未确认，暂不切换市值偏好",
      preferredTotalCapYi: null,
      reason: `两市成交${evidence.amountYi}亿，但上涨占比${evidence.breadthPct}%、指数均值${evidence.avgIndexChange}%未同时满足进攻确认。`,
      confirmation: ["上涨占比达到55%以上", "主要指数均值转正", "确认成交由主动买盘而非风险释放贡献"],
    };
  }

  return {
    ...base,
    status: "mixed",
    key: "low_liquidity",
    label: "25000亿以下市场",
    carrierLabel: "低成交环境，等待候选样本确认主导市值桶",
    preferredTotalCapYi: null,
    reason: `两市成交${evidence.amountYi}亿，低于${AMOUNT_THRESHOLD_YI}亿；不固定写死500亿边界，由当日可见候选表现动态确认。`,
    confirmation: ["比较固定市值桶的当日上涨率、中位涨幅和强势率", "候选样本形成清晰差异后再启用机会准入"],
  };
}

function candidatePerformance(stock) {
  const changePct = finite(stock && stock.changePct);
  if (changePct === null) {
    return { usable: false, changePct: null, positive: null, strong: null, negative: null, source: "missing" };
  }
  return {
    usable: true,
    changePct: round(changePct, 2),
    positive: changePct > 0,
    strong: changePct >= 3,
    negative: changePct <= -3,
    source: "candidate.changePct",
  };
}

function isCapacityTrend(stock) {
  const text = [
    stock && stock.ticketType,
    stock && stock.role,
    stock && stock.dailyRole,
    stock && stock.setup,
    stock && stock.klineProfile && stock.klineProfile.wave,
    stock && stock.leadership && stock.leadership.identity,
  ].filter(Boolean).join(" ");
  return /容量|趋势|中军|二波|三波/.test(text);
}

function observeStockMarketCapCarrier(stock = {}, regime = {}) {
  const totalCapYi = firstCap(stock, ["totalMktCapYi", "totalMarketCapYi"], ["totalMarketValue", "totalMarketCap"]);
  const floatCapYi = firstCap(stock, ["floatMktCapYi", "floatMarketCapYi"], ["floatMarketValue", "floatMarketCap"]);
  const bucket = capBucket(totalCapYi);
  const performance = candidatePerformance(stock);
  const capacityTrend = isCapacityTrend(stock);
  let alignment = "neutral";
  let label = "市值载体中性观察";

  if (totalCapYi === null) {
    alignment = "unknown";
    label = "总市值缺失，无法判断载体区间";
  } else if (regime.status === "confirmed" && Array.isArray(regime.preferredBucketKeys)) {
    if (regime.preferredBucketKeys.includes(bucket.key)) {
      alignment = "aligned";
      label = `位于当日确认的优先市值桶（${bucket.label}）`;
    } else {
      alignment = "outside_confirmed_band";
      label = `不在当日确认的优先市值桶（${bucket.label}）`;
    }
  } else if (regime.key === "panic_volume") {
    alignment = "risk_observation";
    label = "放量杀跌环境，不启用市值偏好";
  } else if (regime.key === "unknown") {
    alignment = "unknown";
    label = "市场证据不完整，市值匹配待确认";
  }

  return {
    ...commonContract(),
    regimeKey: String(regime.key || "unknown"),
    totalCapYi: round(totalCapYi, 1),
    floatCapYi: round(floatCapYi, 1),
    capDataQuality: totalCapYi === null ? "total_cap_missing" : "total_cap_available",
    bucketKey: bucket.key,
    bucketLabel: bucket.label,
    capacityTrend,
    performance,
    alignment,
    label,
    reason: totalCapYi === null
      ? `${label}；流通市值${floatCapYi === null ? "也缺失" : `约${round(floatCapYi, 1)}亿，仅作流动性辅助`}。`
      : `总市值约${round(totalCapYi, 1)}亿（${bucket.label}）；${label}。`,
  };
}

function median(values) {
  const ordered = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function performanceMetrics(rows) {
  const usable = rows.filter((row) => row && row.performance && row.performance.usable === true);
  const changes = usable.map((row) => row.performance.changePct);
  const count = usable.length;
  if (!count) {
    return { count: 0, positiveRatePct: null, strongRatePct: null, negativeRatePct: null, medianChangePct: null, averageChangePct: null, score: null };
  }
  const positiveRatePct = usable.filter((row) => row.performance.positive).length / count * 100;
  const strongRatePct = usable.filter((row) => row.performance.strong).length / count * 100;
  const negativeRatePct = usable.filter((row) => row.performance.negative).length / count * 100;
  const medianChangePct = median(changes);
  const averageChangePct = changes.reduce((sum, value) => sum + value, 0) / count;
  const medianComponent = Math.max(0, Math.min(100, ((medianChangePct + 5) / 15) * 100));
  const score = positiveRatePct * 0.4 + strongRatePct * 0.3 + medianComponent * 0.3;
  return {
    count,
    positiveRatePct: round(positiveRatePct, 1),
    strongRatePct: round(strongRatePct, 1),
    negativeRatePct: round(negativeRatePct, 1),
    medianChangePct: round(medianChangePct, 2),
    averageChangePct: round(averageChangePct, 2),
    score: round(score, 2),
  };
}

function dynamicPreferenceProfile(regime, observations) {
  const rows = observations.filter(Boolean);
  const totalCapKnownCount = rows.filter((row) => row.totalCapYi !== null).length;
  const usableRows = rows.filter((row) => row.totalCapYi !== null && row.performance && row.performance.usable === true);
  const coveragePct = rows.length ? usableRows.length / rows.length * 100 : 0;
  const bucketStats = MARKET_CAP_BUCKETS.map((bucket, index) => ({
    ...bucket,
    order: index,
    ...performanceMetrics(usableRows.filter((row) => row.bucketKey === bucket.key)),
  }));
  const base = {
    coverage: {
      candidateCount: rows.length,
      totalCapKnownCount,
      usableSampleCount: usableRows.length,
      usablePct: round(coveragePct, 1),
      minimumUsableSample: MIN_USABLE_SAMPLE,
      minimumUsablePct: round(MIN_USABLE_COVERAGE * 100, 0),
    },
    sample: {
      universe: "same_day_visible_candidate_pool",
      tradingDate: regime.tradingDate || null,
      bucketStats,
    },
    preferredBucketKeys: [],
    excludedBucketKeys: [],
    preferredBuckets: [],
    evidence: [],
  };
  if (regime.dataQuality && regime.dataQuality.complete !== true) {
    return { ...base, status: "unavailable", reason: "市场成交质量证据不完整，市值赚钱效应画像失败关闭。" };
  }
  if (usableRows.length < MIN_USABLE_SAMPLE || coveragePct < MIN_USABLE_COVERAGE * 100) {
    return {
      ...base,
      status: "unavailable",
      reason: `市值与当日涨跌幅同时可用${usableRows.length}只、覆盖${round(coveragePct, 1)}%，不足以确认市值赚钱效应。`,
    };
  }
  const splitCandidates = [];
  for (let index = 0; index < MARKET_CAP_BUCKETS.length - 1; index += 1) {
    const lower = usableRows.filter((row) => MARKET_CAP_BUCKETS.findIndex((bucket) => bucket.key === row.bucketKey) <= index);
    const upper = usableRows.filter((row) => MARKET_CAP_BUCKETS.findIndex((bucket) => bucket.key === row.bucketKey) > index);
    if (lower.length < MIN_SPLIT_SAMPLE || upper.length < MIN_SPLIT_SAMPLE) continue;
    const lowerMetrics = performanceMetrics(lower);
    const upperMetrics = performanceMetrics(upper);
    const signedGap = lowerMetrics.score - upperMetrics.score;
    splitCandidates.push({ index, lowerMetrics, upperMetrics, signedGap: round(signedGap, 2), gap: round(Math.abs(signedGap), 2) });
  }
  if (!splitCandidates.length) {
    return { ...base, status: "mixed", reason: "有效样本已具备，但固定市值桶两侧样本不足，暂不启用机会准入。" };
  }
  const strongestGap = Math.max(...splitCandidates.map((item) => item.gap));
  const nearBest = splitCandidates.filter((item) => item.gap >= strongestGap - SPLIT_TIE_TOLERANCE);
  const best = nearBest.sort((left, right) => {
    const leftPreferredLower = left.signedGap > 0;
    const rightPreferredLower = right.signedGap > 0;
    if (leftPreferredLower && rightPreferredLower) return right.index - left.index;
    if (!leftPreferredLower && !rightPreferredLower) return left.index - right.index;
    return right.gap - left.gap;
  })[0];
  const preferredLower = best.signedGap > 0;
  const preferredBuckets = MARKET_CAP_BUCKETS.filter((bucket, index) => preferredLower ? index <= best.index : index > best.index);
  const excludedBuckets = MARKET_CAP_BUCKETS.filter((bucket) => !preferredBuckets.some((preferred) => preferred.key === bucket.key));
  const evidence = [
    {
      key: "same_day_bucket_separation",
      source: "candidate.changePct",
      calibrated: false,
      preferredSide: preferredLower ? "lower_cap_side" : "higher_cap_side",
      boundary: `${MARKET_CAP_BUCKETS[best.index].label}/${MARKET_CAP_BUCKETS[best.index + 1].label}`,
      scoreGap: best.gap,
      preferredMetrics: preferredLower ? best.lowerMetrics : best.upperMetrics,
      otherMetrics: preferredLower ? best.upperMetrics : best.lowerMetrics,
      note: "仅比较当日可见候选表现，不代表历史胜率。",
    },
  ];
  if (best.gap < CONFIRMED_SCORE_GAP) {
    return { ...base, status: "mixed", evidence, reason: `市值桶两侧表现差${best.gap}分，未达到${CONFIRMED_SCORE_GAP}分确认阈值。` };
  }
  return {
    ...base,
    status: "confirmed",
    opportunityGateImpact: true,
    preferredBucketKeys: preferredBuckets.map((bucket) => bucket.key),
    excludedBucketKeys: excludedBuckets.map((bucket) => bucket.key),
    preferredBuckets: preferredBuckets.map(({ key, label, min, max }) => ({ key, label, min, max })),
    preferredTotalCapYi: {
      min: preferredBuckets[0].min,
      max: preferredBuckets[preferredBuckets.length - 1].max,
      label: preferredBuckets.map((bucket) => bucket.label).join("、"),
    },
    evidence,
    reason: `当日候选样本在${preferredBuckets.map((bucket) => bucket.label).join("、")}表现更强，规则差${best.gap}分；仅用于机会候选准入，不改变情绪核心身份与交易权限。`,
  };
}

function summarizeMarketCapCarrier(regime = {}, observations = []) {
  const rows = Array.isArray(observations) ? observations.filter(Boolean) : [];
  const bucketCounts = rows.reduce((acc, row) => {
    const key = String(row.bucketKey || "unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const profile = dynamicPreferenceProfile(regime, rows);
  const preferredLabels = profile.preferredBuckets.map((bucket) => bucket.label);
  return {
    ...regime,
    ...profile,
    carrierLabel: profile.status === "confirmed"
      ? `当日优先市值桶：${preferredLabels.join("、")}`
      : regime.carrierLabel,
    opportunityGateImpact: profile.status === "confirmed",
    candidateSample: {
      count: rows.length,
      totalCapKnownCount: rows.filter((row) => row.totalCapYi !== null).length,
      alignedCount: rows.filter((row) => row.alignment === "aligned").length,
      upperBandCount: rows.filter((row) => row.alignment === "upper_band").length,
      bucketCounts,
    },
  };
}

function rebuildMarketCapCarrierPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (!payload.market || typeof payload.market !== "object") payload.market = {};
  const regime = classifyMarketCapCarrierRegime(payload.market.snapshot || {});
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const observations = candidates.map((stock) => observeStockMarketCapCarrier(stock, regime));
  const summary = summarizeMarketCapCarrier(regime, observations);
  candidates.forEach((stock, index) => {
    const observation = observeStockMarketCapCarrier(stock, summary);
    if (stock && typeof stock === "object") stock.marketCapCarrier = observation;
    observations[index] = observation;
  });
  payload.market.marketCapCarrier = summary;
  return payload.market.marketCapCarrier;
}

module.exports = {
  AMOUNT_THRESHOLD_YI,
  MARKET_CAP_BUCKETS,
  capBucket,
  classifyMarketCapCarrierRegime,
  observeStockMarketCapCarrier,
  summarizeMarketCapCarrier,
  dynamicPreferenceProfile,
  rebuildMarketCapCarrierPayload,
};
