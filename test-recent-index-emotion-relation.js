"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildRecentIndexEmotionRelation } = require("./recent-index-emotion-relation");

function marketSnapshot({
  changes = [0.8, 1.1, 1.3, 0.9],
  breadth = 0.68,
  closePosition = 0.82,
  amountYi = 12000,
  fundSwitchEvidence = false,
} = {}) {
  const low = 100;
  const high = 110;
  const price = low + (high - low) * closePosition;
  return {
    indexes: changes.map((changePct, index) => ({
      code: ["000001", "399001", "399006", "000688"][index],
      name: ["上证指数", "深证成指", "创业板指", "科创50"][index],
      changePct,
    })),
    breadth,
    totalAmountYi: amountYi,
    allA: { low, high, price, breadth, amountYi },
    fundSwitchEvidence,
  };
}

function emotionCycle(phaseKey, {
  phaseLabel,
  consensusKey = "unknown",
  consensusLabel = "高度一致度待确认",
  oneWordExcludedCount = 0,
} = {}) {
  return {
    current: {
      key: phaseKey === "post_heat_divergence" ? "realization" : phaseKey,
      phaseKey,
      participatoryPhase: {
        key: phaseKey,
        label: phaseLabel || phaseKey,
        marketEmotionEligible: true,
      },
      consensusPhase: {
        key: consensusKey,
        label: consensusLabel,
        marketEmotionEligible: false,
      },
    },
    participation: {
      eligibleAnchorCount: 12,
      primaryEligibleCount: 5,
      oneWordExcludedCount,
      rule: "一字只计高度，可参与层决定情绪",
    },
  };
}

function day(tradingDate, {
  changes,
  breadth,
  closePosition,
  amountYi,
  previousAmountYi = 10000,
  fundSwitchEvidence,
  phaseKey = "acceleration",
  phaseLabel,
  consensusKey,
  consensusLabel,
  oneWordExcludedCount,
} = {}) {
  return {
    tradingDate,
    indexCycleRegime: {
      shortTerm: { key: "main_rise", label: "短线主升" },
      mediumTerm: { key: "main_rise", label: "中期主升" },
    },
    emotionCycle: emotionCycle(phaseKey, {
      phaseLabel,
      consensusKey,
      consensusLabel,
      oneWordExcludedCount,
    }),
    marketSnapshot: marketSnapshot({
      changes,
      breadth,
      closePosition,
      amountYi,
      fundSwitchEvidence,
    }),
    previousAmountYi,
  };
}

test("returns the plain-language contract, sorts days and does not mutate input", () => {
  const input = {
    days: [
      day("2026-08-12"),
      day("2026-08-10", { amountYi: 10500 }),
      day("2026-08-11", { amountYi: 11000 }),
    ],
  };
  const frozenCopy = JSON.parse(JSON.stringify(input));
  const result = buildRecentIndexEmotionRelation(input);

  assert.equal(result.title, "近期指数—情绪关系");
  assert.equal(result.today.title, "今日变化");
  assert.equal(result.version, 1);
  assert.equal(result.method, "recent_index_participatory_emotion_relation");
  assert.equal(result.calibrated, false);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.window, { short: 3, confirm: 5, available: 3 });
  assert.deepEqual(result.daily.map((item) => item.tradingDate), [
    "2026-08-10",
    "2026-08-11",
    "2026-08-12",
  ]);
  assert.deepEqual(input, frozenCopy);
  assert.equal(result.integrity.sorted, true);
  assert.equal(result.integrity.missingValuesKeptNull, true);
});

test("uses multiple index facts and only the participatory emotion layer", () => {
  const result = buildRecentIndexEmotionRelation({
    days: [
      day("2026-08-10", { amountYi: 10500 }),
      day("2026-08-11", {
        amountYi: 12000,
        phaseKey: "post_heat_divergence",
        phaseLabel: "高热后分歧",
        consensusKey: "climax",
        consensusLabel: "高度一致",
        oneWordExcludedCount: 6,
      }),
    ],
  });

  assert.equal(result.today.index.strength, "strong");
  assert.equal(result.today.index.evidence.primaryIndexes.direction, "strong");
  assert.equal(result.today.index.evidence.breadth.direction, "strong");
  assert.equal(result.today.index.evidence.closePosition.direction, "strong");
  assert.equal(result.today.index.evidence.volumeSupport.direction, "strong");
  assert.equal(result.today.emotion.strength, "weak");
  assert.equal(result.today.emotion.phaseKey, "post_heat_divergence");
  assert.equal(result.today.relationKey, "index_strong_emotion_weak");
  assert.equal(result.heightConsensus.today.key, "climax");
  assert.equal(result.heightConsensus.today.oneWordExcludedCount, 6);
  assert.equal(result.integrity.heightConsensusSeparated, true);
  assert.equal(result.integrity.oneWordCannotSetEmotion, true);
});

test("a single divergent day is not called a seesaw", () => {
  const result = buildRecentIndexEmotionRelation({
    days: [
      day("2026-08-10", { phaseKey: "acceleration", fundSwitchEvidence: true }),
      day("2026-08-11", {
        phaseKey: "post_heat_divergence",
        phaseLabel: "高热后分歧",
        amountYi: 12500,
        fundSwitchEvidence: true,
      }),
    ],
  });

  assert.equal(result.today.relationKey, "index_strong_emotion_weak");
  assert.equal(result.dominant.key, "switching");
  assert.equal(result.dominant.seesawConfirmed, false);
  assert.equal(result.transition.seesawConfirmed, false);
  assert.match(result.opportunityBias.reason, /单日|尚未确认|不能认定/);
  assert.equal(result.opportunityBias.riskAdjustment, "reduce");
  assert.equal("positionMultiplier" in result.opportunityBias, false);
});

test("two consecutive same-direction divergences need volume or fund-switch evidence to confirm seesaw", () => {
  const confirmed = buildRecentIndexEmotionRelation({
    days: [
      day("2026-08-10", { phaseKey: "acceleration", amountYi: 10000 }),
      day("2026-08-11", {
        phaseKey: "post_heat_divergence",
        amountYi: 12000,
        previousAmountYi: 10000,
      }),
      day("2026-08-12", {
        phaseKey: "post_climax_divergence",
        amountYi: 13500,
        previousAmountYi: 12000,
      }),
    ],
  });

  assert.equal(confirmed.dominant.key, "index_strong_emotion_weak");
  assert.equal(confirmed.dominant.seesawConfirmed, true);
  assert.equal(confirmed.daily[1].switchingEvidence.volumeExpanded, true);
  assert.equal(confirmed.daily[2].switchingEvidence.volumeExpanded, true);

  const unconfirmed = buildRecentIndexEmotionRelation({
    days: [
      day("2026-08-11", {
        phaseKey: "post_heat_divergence",
        amountYi: 9800,
        previousAmountYi: 10000,
      }),
      day("2026-08-12", {
        phaseKey: "post_climax_divergence",
        amountYi: 9700,
        previousAmountYi: 9800,
      }),
    ],
  });

  assert.equal(unconfirmed.dominant.key, "index_strong_emotion_weak");
  assert.equal(unconfirmed.dominant.seesawConfirmed, false);
});

test("missing data stays null and fewer than two valid days is insufficient", () => {
  const result = buildRecentIndexEmotionRelation({
    days: [{
      tradingDate: "2026-08-12",
      indexCycleRegime: { shortTerm: { key: "main_rise" } },
      emotionCycle: {
        current: {
          consensusPhase: {
            key: "climax",
            label: "高度一致",
            marketEmotionEligible: false,
          },
        },
      },
      marketSnapshot: { indexes: [{ name: "上证指数", changePct: null }] },
    }],
  });

  assert.equal(result.status, "insufficient");
  assert.deepEqual(result.window, { short: 3, confirm: 5, available: 0 });
  assert.equal(result.dominant.key, "unknown");
  assert.equal(result.today.relationKey, "unknown");
  assert.equal(result.today.index.evidence.primaryIndexes.averageChangePct, null);
  assert.equal(result.today.index.evidence.breadth.value, null);
  assert.equal(result.today.index.evidence.closePosition.value, null);
  assert.equal(result.today.index.evidence.volumeSupport.ratio, null);
  assert.equal(result.today.emotion.phaseKey, null);
  assert.equal(result.heightConsensus.today.key, "climax");
  assert.equal(result.heightConsensus.today.oneWordExcludedCount, null);
  assert.equal(result.opportunityBias.riskAdjustment, "avoid");
  assert.ok(result.dataQuality.missingByDate[0].fields.includes("participatory_emotion_phase"));
});

test("broad index weakness plus participatory retreat is resonance down and avoids new risk", () => {
  const result = buildRecentIndexEmotionRelation({
    days: [
      day("2026-08-11", {
        changes: [-0.9, -1.1, -1.5, -1.2],
        breadth: 0.3,
        closePosition: 0.18,
        amountYi: 12000,
        phaseKey: "retreat",
      }),
      day("2026-08-12", {
        changes: [-1.2, -1.6, -2.1, -1.7],
        breadth: 0.22,
        closePosition: 0.12,
        amountYi: 13500,
        previousAmountYi: 12000,
        phaseKey: "harmful",
      }),
    ],
  });

  assert.equal(result.today.relationKey, "resonance_down");
  assert.equal(result.dominant.key, "resonance_down");
  assert.equal(result.opportunityBias.riskAdjustment, "avoid");
});
