"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  WINDOW_WEIGHTS,
  classifyEmotionBigCycleWindow,
} = require("./emotion-big-cycle-window");

function observation(tradingDate, profitScore, lossScore, coreContinuityScore, complete = true) {
  return { tradingDate, profitScore, lossScore, coreContinuityScore, complete };
}

test("five-day metrics use oldest-to-newest weights 8/12/20/25/35", () => {
  const result = classifyEmotionBigCycleWindow([
    observation("2026-08-24", 0, 20, 50),
    observation("2026-08-25", 0, 20, 50),
    observation("2026-08-26", 0, 20, 50),
    observation("2026-08-27", 0, 20, 50),
    observation("2026-08-28", 100, 20, 50),
  ]);
  assert.deepEqual(WINDOW_WEIGHTS, [8, 12, 20, 25, 35]);
  assert.equal(result.metrics.weightedProfitScore, 35);
  assert.equal(result.metrics.weightedLossScore, 20);
  assert.equal(result.metrics.weightedCoreContinuityScore, 50);
});

test("main rise requires a complete window and confirmation on both latest days", () => {
  const result = classifyEmotionBigCycleWindow([
    observation("2026-08-24", 66, 32, 60),
    observation("2026-08-25", 67, 31, 61),
    observation("2026-08-26", 68, 30, 62),
    observation("2026-08-27", 74, 24, 72),
    observation("2026-08-28", 78, 20, 76),
  ]);
  assert.equal(result.key, "main_rise");
  assert.equal(result.candidate.confirmed, true);
  assert.equal(result.candidate.reasonCode, "two_day_main_rise_confirmed");
  assert.deepEqual(result.confirmation.recentTwoStates, ["main_rise", "main_rise"]);
  assert.match(result.evidence.join("；"), /最近两日=主升\/主升/);
});

test("one-day strength spike cannot switch the big cycle to main rise", () => {
  const result = classifyEmotionBigCycleWindow([
    observation("2026-08-24", 55, 40, 50),
    observation("2026-08-25", 58, 38, 52),
    observation("2026-08-26", 60, 36, 54),
    observation("2026-08-27", 50, 45, 45),
    observation("2026-08-28", 85, 15, 85),
  ]);
  assert.equal(result.key, "chaos");
  assert.equal(result.candidate.confirmed, false);
  assert.equal(result.candidate.reasonCode, "recent_two_switch_unconfirmed");
});

test("range requires two recent range days plus the five-day weighted structure", () => {
  const result = classifyEmotionBigCycleWindow([
    observation("2026-08-24", 48, 43, 44),
    observation("2026-08-25", 50, 42, 45),
    observation("2026-08-26", 52, 40, 47),
    observation("2026-08-27", 54, 39, 48),
    observation("2026-08-28", 56, 38, 50),
  ]);
  assert.equal(result.key, "range");
  assert.equal(result.candidate.reasonCode, "two_day_range_confirmed");
});

test("retreat may downgrade immediately when full-market loss is expanding", () => {
  const result = classifyEmotionBigCycleWindow([
    observation("2026-08-27", 58, 53, 46),
    observation("2026-08-28", 48, 66, 38),
  ]);
  assert.equal(result.key, "retreat");
  assert.equal(result.candidate.reasonCode, "full_market_loss_expanding");
  assert.equal(result.confirmation.lossExpansion, true);
});

test("retreat also requires cross-day persistence when loss is high but not expanding", () => {
  const result = classifyEmotionBigCycleWindow([
    observation("2026-08-27", 48, 67, 39),
    observation("2026-08-28", 46, 68, 37),
  ]);
  assert.equal(result.key, "retreat");
  assert.equal(result.candidate.reasonCode, "full_market_loss_persistent_two_days");
  assert.equal(result.confirmation.lossPersistence, true);
});

test("one isolated high-loss day without expansion or persistence is not called retreat", () => {
  const result = classifyEmotionBigCycleWindow([
    observation("2026-08-24", 52, 45, 46),
    observation("2026-08-25", 54, 43, 48),
    observation("2026-08-26", 50, 48, 44),
    observation("2026-08-27", 38, 70, 28),
    observation("2026-08-28", 52, 61, 42),
  ]);
  assert.equal(result.key, "chaos");
  assert.equal(result.confirmation.lossExpansion, false);
  assert.equal(result.confirmation.lossPersistence, false);
});

test("ice point needs two extreme days and loss expansion to stop accelerating", () => {
  const result = classifyEmotionBigCycleWindow([
    observation("2026-08-24", 28, 71, 24),
    observation("2026-08-25", 29, 70, 25),
    observation("2026-08-26", 27, 72, 23),
    observation("2026-08-27", 25, 74, 20),
    observation("2026-08-28", 24, 76, 18),
  ]);
  assert.equal(result.key, "ice_point");
  assert.equal(result.candidate.reasonCode, "two_day_extreme_freeze_confirmed");
});

test("missing observations cannot upgrade to main rise", () => {
  const result = classifyEmotionBigCycleWindow([
    observation("2026-08-24", 75, 20, 75),
    observation("2026-08-25", 76, 19, 76),
    observation("2026-08-26", null, 18, 77, false),
    observation("2026-08-27", 78, 17, 78),
    observation("2026-08-28", 79, 16, 79),
  ]);
  assert.equal(result.key, "unavailable");
  assert.equal(result.candidate.reasonCode, "five_day_window_incomplete");
  assert.equal(result.guardrails.missingCannotUpgrade, true);
});

test("missing older days do not hide a verified loss-expansion retreat downgrade", () => {
  const result = classifyEmotionBigCycleWindow([
    observation("2026-08-26", null, null, null, false),
    observation("2026-08-27", 50, 52, 45),
    observation("2026-08-28", 44, 65, 36),
  ]);
  assert.equal(result.key, "retreat");
  assert.equal(result.candidate.reasonCode, "full_market_loss_expanding");
});

test("an incomplete latest day makes the window unavailable", () => {
  const result = classifyEmotionBigCycleWindow([
    observation("2026-08-24", 70, 25, 70),
    observation("2026-08-25", 71, 24, 71),
    observation("2026-08-26", 72, 23, 72),
    observation("2026-08-27", 73, 22, 73),
    observation("2026-08-28", null, null, null, false),
  ]);
  assert.equal(result.key, "unavailable");
  assert.equal(result.candidate.reasonCode, "recent_two_incomplete");
});

test("input is sorted, duplicate dates use the last observation, and only five dates remain", () => {
  const input = [
    observation("2026-08-28", 80, 18, 80),
    observation("2026-08-25", 70, 28, 70),
    observation("2026-08-27", 79, 19, 79),
    observation("2026-08-24", 68, 30, 68),
    observation("2026-08-26", 72, 26, 72),
    observation("2026-08-23", 10, 80, 10),
    observation("2026-08-28", 82, 16, 82),
  ];
  const before = JSON.stringify(input);
  const result = classifyEmotionBigCycleWindow(input);
  assert.equal(result.observations.length, 5);
  assert.deepEqual(result.observations.map((item) => item.tradingDate), [
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
  ]);
  assert.equal(result.observations[4].profitScore, 82);
  assert.equal(JSON.stringify(input), before, "pure function must not mutate its input");
});

test("empty input returns unavailable with explicit evidence", () => {
  const result = classifyEmotionBigCycleWindow([]);
  assert.equal(result.status, "unavailable");
  assert.equal(result.key, "unavailable");
  assert.deepEqual(result.blockers, ["window_empty"]);
  assert.match(result.evidence[0], /缺少五日情绪观察/);
});
