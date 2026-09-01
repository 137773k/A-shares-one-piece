"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PROFIT_EFFECT_PATH_KEYS,
  buildTomorrowProfitEffectForecast,
} = require("./tomorrow-profit-effect-forecast");

function canonicalEmotion({ intensity = "medium", quality = "neutral", support = "mixed" } = {}) {
  const labels = {
    small: "小分歧",
    medium: "中等分歧",
    large: "大分歧",
    benign: "良性",
    neutral: "中性待确认",
    non_benign: "非良性",
    strong: "承接强",
    mixed: "承接一般",
    weak: "承接弱",
  };
  return {
    version: 1,
    method: "anchor_hcd_state_machine",
    calibrated: false,
    current: {
      key: "realization",
      phaseKey: "post_climax_divergence",
      label: labels[intensity],
      divergenceIntensity: { key: intensity, label: labels[intensity] },
      divergenceQuality: { key: quality, label: labels[quality] },
      supportState: { key: support, label: labels[support], score: support === "strong" ? 65 : support === "weak" ? 30 : 47 },
    },
  };
}

function previousPayload({ amount = 20500, zt = 46, dt = 11 } = {}) {
  return {
    archiveMeta: {
      tradingDate: "2026-08-24",
      snapshotKind: "closing",
    },
    market: {
      snapshot: { shszAmountYi: amount },
      limitStats: {
        ztToday: zt,
        dtToday: dt,
        dates: { today: "20260824" },
      },
    },
  };
}

function fixture(overrides = {}) {
  return {
    market: {
      snapshot: {
        breadth: overrides.breadth ?? 0.769,
        shszAmountYi: overrides.amount ?? 18318,
        avgIndexChange: overrides.avgIndexChange ?? 1.5,
        indexStructures: overrides.indexStructures || [{ trendKey: "uptrend" }],
      },
      limitStats: {
        ztToday: overrides.ztToday ?? 65,
        dtToday: overrides.dtToday ?? 2,
        ztPrev: overrides.ztPrev ?? 46,
        dtPrev: overrides.dtPrev ?? 11,
        dates: {
          today: "20260825",
          prev: "20260824",
          verified: true,
        },
      },
      state: {
        structuralCycle: overrides.structuralCycle || "退潮",
        indexCycleRegime: overrides.indexCycleRegime || { structuralCycle: "退潮" },
        profitEffect: { score: overrides.profitScore ?? 75 },
        lossEffect: { score: overrides.lossScore ?? 25 },
      },
    },
    emotionCycle: overrides.emotionCycle || canonicalEmotion(overrides.emotionOptions),
    candidates: overrides.candidates || [],
  };
}

function sumWeights(result) {
  return PROFIT_EFFECT_PATH_KEYS.reduce((sum, key) => sum + result.weights[key], 0);
}

test("strong repair with shrinking turnover and ordinary divergence support is healthy divergence, not index strengthening", () => {
  const result = buildTomorrowProfitEffectForecast(fixture(), {
    previousPayload: previousPayload(),
  });

  assert.equal(result.available, true);
  assert.equal(result.primary.key, "healthy_divergence");
  assert.equal(sumWeights(result), 100);
  assert.equal(result.calibrated, false);
  assert.ok(result.weights.healthy_divergence > result.weights.strengthen);
  assert.match(
    result.evidence.find((row) => row.id === "turnover_comparison").detail,
    /89%/,
  );
});

test("big cycle, index moving-average structure, index return, and specific candidates cannot change profit-effect weights", () => {
  const base = buildTomorrowProfitEffectForecast(fixture({
    structuralCycle: "退潮",
    avgIndexChange: -3,
    indexStructures: [{ trendKey: "downtrend" }],
    candidates: [{ code: "601869", totalMarketCapYi: 3266, currentChangePct: 10 }],
  }), { previousPayload: previousPayload() });
  const changedForbiddenInputs = buildTomorrowProfitEffectForecast(fixture({
    structuralCycle: "主升",
    indexCycleRegime: { structuralCycle: "主升" },
    avgIndexChange: 4,
    indexStructures: [{ trendKey: "uptrend" }, { trendKey: "uptrend" }],
    candidates: [{ code: "000001", totalMarketCapYi: 80, currentChangePct: -10 }],
  }), { previousPayload: previousPayload() });

  assert.deepEqual(changedForbiddenInputs.weights, base.weights);
  assert.deepEqual(changedForbiddenInputs.primary, base.primary);
});

test("missing exact T-1 closing turnover archive fails closed instead of treating missing as zero", () => {
  const result = buildTomorrowProfitEffectForecast(fixture(), {
    previousPayload: {
      ...previousPayload(),
      archiveMeta: { tradingDate: "2026-08-22", snapshotKind: "closing" },
    },
  });

  assert.equal(result.available, false);
  assert.equal(result.status, "unavailable");
  assert.equal(result.primary.key, "unavailable");
  assert.deepEqual(result.weights, {
    strengthen: null,
    healthy_divergence: null,
    negative_feedback: null,
  });
  assert.ok(result.dataQuality.missingFields.includes("turnover_comparison"));
  assert.equal(result.dataQuality.failClosed, true);
});

test("incomplete canonical emotion dimensions fail closed and legacy daily state cannot fill them", () => {
  const incompleteEmotion = canonicalEmotion();
  delete incompleteEmotion.current.supportState;
  const payload = fixture({ emotionCycle: incompleteEmotion });
  payload.market.state.dailyState = { key: "repair_strengthening", label: "修复加强" };
  const result = buildTomorrowProfitEffectForecast(payload, {
    previousPayload: previousPayload(),
  });

  assert.equal(result.available, false);
  assert.ok(!result.dataQuality.missingFields.includes("emotion_divergence_intensity"));
  assert.ok(!result.dataQuality.missingFields.includes("emotion_divergence_quality"));
  assert.ok(result.dataQuality.missingFields.includes("emotion_support_quality"));
  assert.equal(result.dataQuality.canonicalEmotion.usable, false);
});

test("loss dominance, narrow breadth, weaker limits, harmful divergence, and weak support rank negative feedback first", () => {
  const result = buildTomorrowProfitEffectForecast(fixture({
    breadth: 0.18,
    amount: 14000,
    ztToday: 22,
    dtToday: 20,
    profitScore: 22,
    lossScore: 72,
    emotionOptions: { intensity: "large", quality: "non_benign", support: "weak" },
  }), {
    previousPayload: previousPayload({ amount: 20500, zt: 60, dt: 6 }),
  });

  assert.equal(result.available, true);
  assert.equal(result.primary.key, "negative_feedback");
  assert.ok(result.weights.negative_feedback > result.weights.healthy_divergence);
  assert.equal(sumWeights(result), 100);
});
