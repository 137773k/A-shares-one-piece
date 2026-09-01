"use strict";

const assert = require("assert");
const test = require("node:test");
const path = require("path");

let cycleLeaderStateApi = null;
let cycleLeaderStateLoadError = null;
try {
  const implementationPath = process.env.CYCLE_LEADER_STATE_MODULE
    ? path.resolve(process.env.CYCLE_LEADER_STATE_MODULE)
    : path.join(__dirname, "cycle-leader-state");
  cycleLeaderStateApi = require(implementationPath);
} catch (error) {
  cycleLeaderStateLoadError = error;
}

function requireApi(name) {
  assert.ifError(cycleLeaderStateLoadError);
  assert.strictEqual(
    typeof cycleLeaderStateApi[name],
    "function",
    `cycle-leader-state.js must export ${name}`,
  );
  return cycleLeaderStateApi[name];
}

function observation(tradingDate, overrides = {}) {
  return {
    tradingDate,
    cycleInstanceId: "cycle-alpha",
    code: "STOCK_A",
    dataComplete: true,
    limitUp: false,
    validCrossStockImpact: false,
    hardBreak: false,
    negativeFeedback: false,
    ...overrides,
  };
}

function advance(previous, tradingDate, overrides = {}) {
  const advanceCycleLeaderState = requireApi("advanceCycleLeaderState");
  return advanceCycleLeaderState(previous, observation(tradingDate, overrides));
}

function confirmStockA() {
  const dayOne = advance(null, "2026-08-03", {
    limitUp: true,
    validCrossStockImpact: true,
  });
  return advance(dayOne, "2026-08-04", {
    validCrossStockImpact: true,
  });
}

test("one strong day is only a candidate and cannot establish cycle leadership", () => {
  const state = advance(null, "2026-08-03", {
    limitUp: true,
    validCrossStockImpact: true,
  });

  assert.strictEqual(state.state, "candidate");
  assert.strictEqual(state.identityEstablished, false);
  assert.strictEqual(state.activePrimary, false);
  assert.strictEqual(state.validImpactDays, 1);
  assert.deepStrictEqual(state.confirmedTradingDates, []);
  assert.strictEqual(state.calibrated, false, "default rule thresholds are not statistical calibration");
  assert.deepStrictEqual(state.thresholds, {
    confirmImpactDays: 2,
    challengeNoImpactDays: 2,
    expireNoImpactDays: 3,
  });
});

test("a confirmed leader is retained after one valid weak day", () => {
  const confirmed = confirmStockA();
  const retained = advance(confirmed, "2026-08-05", {
    validCrossStockImpact: false,
  });

  assert.strictEqual(confirmed.state, "confirmed");
  assert.strictEqual(confirmed.identityEstablished, true);
  assert.strictEqual(retained.state, "retained");
  assert.strictEqual(retained.identityEstablished, true);
  assert.strictEqual(retained.activePrimary, true);
  assert.strictEqual(retained.consecutiveNoImpactDays, 1);
});

test("same-cycle attention and intact structure retain a leader without daily re-confirmation", () => {
  const confirmed = confirmStockA();
  const dayOne = advance(confirmed, "2026-08-05", {
    validCrossStockImpact: false,
    identitySupport: true,
  });
  const dayTwo = advance(dayOne, "2026-08-06", {
    validCrossStockImpact: false,
    identitySupport: true,
  });

  assert.strictEqual(dayTwo.state, "retained");
  assert.strictEqual(dayTwo.activePrimary, true);
  assert.strictEqual(dayTwo.identityEstablished, true);
  assert.strictEqual(dayTwo.consecutiveNoImpactDays, 0, "supported consolidation must not count as identity failure");
  assert.strictEqual(dayTwo.history.at(-1).type, "identity_supported");
});

test("missing data freezes identity and counters instead of counting as weakness", () => {
  const confirmed = confirmStockA();
  const frozen = advance(confirmed, "2026-08-05", {
    dataComplete: false,
    validCrossStockImpact: false,
  });

  assert.strictEqual(frozen.state, confirmed.state);
  assert.strictEqual(frozen.identityEstablished, confirmed.identityEstablished);
  assert.strictEqual(frozen.validImpactDays, confirmed.validImpactDays);
  assert.strictEqual(frozen.consecutiveNoImpactDays, confirmed.consecutiveNoImpactDays);
  assert.deepStrictEqual(frozen.confirmedTradingDates, confirmed.confirmedTradingDates);
  assert.strictEqual(frozen.lastEvaluatedTradingDate, confirmed.lastEvaluatedTradingDate);
  assert.strictEqual(frozen.frozen, true);
});

test("two distinct valid cross-stock impact days confirm the identity", () => {
  const dayOne = advance(null, "2026-08-03", {
    validCrossStockImpact: true,
  });
  const dayTwo = advance(dayOne, "2026-08-04", {
    validCrossStockImpact: true,
  });

  assert.strictEqual(dayOne.state, "candidate");
  assert.strictEqual(dayTwo.state, "confirmed");
  assert.strictEqual(dayTwo.identityEstablished, true);
  assert.strictEqual(dayTwo.activePrimary, true);
  assert.strictEqual(dayTwo.validImpactDays, 2);
  assert.deepStrictEqual(dayTwo.confirmedTradingDates, ["2026-08-03", "2026-08-04"]);
});

test("two valid no-impact days challenge a leader and the third expires it", () => {
  const confirmed = confirmStockA();
  const weakOne = advance(confirmed, "2026-08-05");
  const challenged = advance(weakOne, "2026-08-06");
  const expired = advance(challenged, "2026-08-07");

  assert.strictEqual(weakOne.state, "retained");
  assert.strictEqual(challenged.state, "challenged");
  assert.strictEqual(challenged.identityEstablished, true, "challenge must preserve established history");
  assert.strictEqual(challenged.activePrimary, false);
  assert.strictEqual(challenged.consecutiveNoImpactDays, 2);
  assert.strictEqual(expired.state, "expired");
  assert.strictEqual(expired.identityEstablished, true, "expiry is current-cycle inactivity, not history deletion");
  assert.strictEqual(expired.activePrimary, false);
  assert.strictEqual(expired.consecutiveNoImpactDays, 3);
});

test("a challenger replaces only after it is confirmed and the old leader is challenged", () => {
  const advanceThemeCycleLeaders = requireApi("advanceThemeCycleLeaders");
  const themeObservation = (tradingDate, observations) => ({
    tradingDate,
    cycleInstanceId: "cycle-alpha",
    dataComplete: true,
    observations,
  });
  const row = (code, validCrossStockImpact) => ({
    code,
    validCrossStockImpact,
    hardBreak: false,
    negativeFeedback: false,
  });

  let state = advanceThemeCycleLeaders(null, themeObservation("2026-08-03", [row("STOCK_A", true)]));
  state = advanceThemeCycleLeaders(state, themeObservation("2026-08-04", [row("STOCK_A", true)]));
  assert.strictEqual(state.activeLeaderCode, "STOCK_A");

  state = advanceThemeCycleLeaders(state, themeObservation("2026-08-05", [
    row("STOCK_A", false),
    row("STOCK_B", true),
  ]));
  assert.strictEqual(state.activeLeaderCode, "STOCK_A");
  assert.strictEqual(state.identities.STOCK_B.state, "candidate");

  state = advanceThemeCycleLeaders(state, themeObservation("2026-08-06", [
    row("STOCK_A", false),
    row("STOCK_B", true),
  ]));
  assert.strictEqual(state.activeLeaderCode, "STOCK_B");
  assert.strictEqual(state.identities.STOCK_B.state, "confirmed");
  assert.strictEqual(state.identities.STOCK_B.activePrimary, true);
  assert.strictEqual(state.identities.STOCK_A.state, "replaced");
  assert.strictEqual(state.identities.STOCK_A.activePrimary, false);
  assert.strictEqual(state.identities.STOCK_A.replacedBy, "STOCK_B");
  assert.strictEqual(state.replacement.from, "STOCK_A");
  assert.strictEqual(state.replacement.to, "STOCK_B");
  assert.strictEqual(state.replacement.tradingDate, "2026-08-06");
});

test("a new cycle instance cannot inherit identity from the previous cycle", () => {
  const confirmed = confirmStockA();
  const nextCycle = advance(confirmed, "2026-08-10", {
    cycleInstanceId: "cycle-beta",
    validCrossStockImpact: true,
  });

  assert.strictEqual(nextCycle.cycleInstanceId, "cycle-beta");
  assert.strictEqual(nextCycle.state, "candidate");
  assert.strictEqual(nextCycle.identityEstablished, false);
  assert.strictEqual(nextCycle.activePrimary, false);
  assert.strictEqual(nextCycle.validImpactDays, 1);
  assert.deepStrictEqual(nextCycle.confirmedTradingDates, []);
});

test("replaying the same trading day is idempotent", () => {
  const confirmed = confirmStockA();
  const first = advance(confirmed, "2026-08-05", {
    validCrossStockImpact: false,
  });
  const replay = advance(first, "2026-08-05", {
    validCrossStockImpact: false,
  });

  assert.deepStrictEqual(replay, first);
});

test("hard break plus negative feedback challenges current activity without deleting history", () => {
  const confirmed = confirmStockA();
  const challenged = advance(confirmed, "2026-08-05", {
    hardBreak: true,
    negativeFeedback: true,
    validCrossStockImpact: false,
  });

  assert.strictEqual(challenged.state, "challenged");
  assert.strictEqual(challenged.identityEstablished, true);
  assert.strictEqual(challenged.activePrimary, false);
  assert.strictEqual(challenged.expiredAt, null);
  assert.deepStrictEqual(challenged.confirmedTradingDates, confirmed.confirmedTradingDates);
  assert.strictEqual(challenged.validImpactDays, confirmed.validImpactDays);
  assert(challenged.history.length >= confirmed.history.length, "the negative event must remain auditable");
});
