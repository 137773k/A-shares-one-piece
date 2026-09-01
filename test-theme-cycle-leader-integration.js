"use strict";

const assert = require("assert");
const test = require("node:test");
const path = require("path");

const themeLibraryPath = process.env.THEME_LIBRARY_MODULE
  ? path.resolve(process.env.THEME_LIBRARY_MODULE)
  : path.join(__dirname, "theme-library");
const { buildThemeLibrarySnapshot } = require(themeLibraryPath);

const THEME_KEY = "THEME_ALPHA";

function leaderEvidence(overrides = {}) {
  return {
    persistentRecognition: true,
    impactScore: 30,
    structure: { frameworkIntact: true, breakdown: false },
    history: { appearances: 2, coreHits: 1, activeHits: 1 },
    initiative: {
      proactive: true,
      dataQuality: "分时验证",
      firstAttackTime: "10:06",
      followerCount: 2,
      breadthLift: 1,
      priceDiscovery: { noPriceDiscovery: false },
    },
    ...overrides,
  };
}

function stock(code, overrides = {}) {
  return {
    code,
    name: code,
    mainFamily: THEME_KEY,
    mainConcept: THEME_KEY,
    concepts: [THEME_KEY],
    themeAttribution: {
      verified: true,
      selectionEligible: true,
      conflict: false,
      primaryThemeName: THEME_KEY,
    },
    role: "后排观察",
    score: 80,
    combinedRank: 20,
    eastRank: 20,
    thsRank: 20,
    inBothSources: true,
    changePct: 3,
    amountYi: 20,
    leadership: leaderEvidence(),
    ...overrides,
  };
}

function payload(tradingDate, previousTradingDate, candidates, options = {}) {
  const topicLeader = options.topicLeaderCode
    ? candidates.find((row) => row.code === options.topicLeaderCode)
    : candidates[0];
  return {
    fetchedAt: `${tradingDate}T07:10:00.000Z`,
    archiveMeta: {
      tradingDate,
      snapshotKind: options.snapshotKind || "closing",
    },
    market: {
      cycleLabel: options.marketCycleLabel || "repair",
      limitStats: {
        dates: {
          today: tradingDate,
          prev: previousTradingDate,
          verified: options.providerDatesVerified !== false,
        },
      },
    },
    topicBoard: {
      mainLine: { name: THEME_KEY, family: THEME_KEY },
      items: [{
        name: THEME_KEY,
        family: THEME_KEY,
        displayName: THEME_KEY,
        label: "主线持续",
        sustained: true,
        score: 240,
        count: candidates.length,
        limitCount: candidates.filter((row) => Number(row.changePct || 0) >= 9.8).length,
        leader: topicLeader,
        leaders: topicLeader ? [topicLeader] : [],
      }],
    },
    candidates,
  };
}

function buildDay(dayPayload, previousThemeLibrary = null, options = {}) {
  return buildThemeLibrarySnapshot(dayPayload, {
    sourceMode: "cycle-leader-integration-test",
    snapshotKind: options.snapshotKind || dayPayload.archiveMeta.snapshotKind || "closing",
    generatedAt: options.generatedAt || `${dayPayload.archiveMeta.tradingDate}T07:20:00.000Z`,
    previousThemeLibrary,
  });
}

function onlyTheme(snapshot) {
  assert.strictEqual(snapshot.themes.length, 1, "anonymous fixture must create one theme");
  return snapshot.themes[0];
}

function cycleState(snapshot) {
  const theme = onlyTheme(snapshot);
  assert.ok(
    theme.cycleLeadership && typeof theme.cycleLeadership === "object",
    "theme-library must expose a cross-day cycleLeadership settlement",
  );
  return theme.cycleLeadership;
}

function activeCode(snapshot) {
  const state = cycleState(snapshot);
  return state.primary && state.primary.activePrimary !== false ? state.primary.code : null;
}

function confirmedPrimary() {
  const first = buildDay(payload("2026-08-03", "2026-07-31", [stock("ASSET_A")], {
    marketCycleLabel: "repair",
  }));
  const second = buildDay(payload("2026-08-04", "2026-08-03", [stock("ASSET_A")], {
    marketCycleLabel: "main_rise",
  }), first);
  return { first, second };
}

test("two exact consecutive closing evidence days confirm one cycle leader", () => {
  const { first, second } = confirmedPrimary();
  const firstState = cycleState(first);
  const secondState = cycleState(second);

  assert.strictEqual(firstState.state, "candidate");
  assert.strictEqual(activeCode(first), null, "one day must not establish cycle leadership");
  assert.strictEqual(secondState.state, "confirmed");
  assert.strictEqual(activeCode(second), "ASSET_A");
  assert.deepStrictEqual(secondState.primary.confirmedTradingDates, ["2026-08-03", "2026-08-04"]);
  assert.strictEqual(secondState.settledTradingDate, "2026-08-04");
  assert.strictEqual(secondState.sourcePreviousTradingDate, "2026-08-03");
});

test("one strong limit-up day cannot let a challenger replace a confirmed leader", () => {
  const { second } = confirmedPrimary();
  const incumbentWeak = stock("ASSET_A", {
    changePct: 1.2,
    leadership: leaderEvidence({ impactScore: 0, initiative: { proactive: false } }),
  });
  const oneDayChallenger = stock("ASSET_B", {
    role: "龙头",
    changePct: 10,
    combinedRank: 1,
    eastRank: 1,
    thsRank: 1,
    leadership: leaderEvidence({ impactScore: 45 }),
  });
  const third = buildDay(payload("2026-08-05", "2026-08-04", [incumbentWeak, oneDayChallenger], {
    topicLeaderCode: "ASSET_B",
  }), second);
  const state = cycleState(third);

  assert.strictEqual(activeCode(third), "ASSET_A");
  assert.strictEqual(state.primary.state, "retained");
  assert.strictEqual(state.challenger.code, "ASSET_B");
  assert.strictEqual(state.challenger.state, "candidate");
  assert.strictEqual(state.replacement, null);
});

test("same-cycle attention and intact structure retain a confirmed leader through an ordinary weak day", () => {
  const { second } = confirmedPrimary();
  const weak = stock("ASSET_A", {
    changePct: -1.4,
    leadership: leaderEvidence({ impactScore: 0, initiative: { proactive: false } }),
  });
  const third = buildDay(payload("2026-08-05", "2026-08-04", [weak]), second);
  const state = cycleState(third);

  assert.strictEqual(activeCode(third), "ASSET_A");
  assert.strictEqual(state.primary.state, "retained");
  assert.strictEqual(state.primary.activePrimary, true);
  assert.strictEqual(state.primary.consecutiveNoImpactDays, 0, "identity support is not a no-impact failure day");
  assert.strictEqual(state.primary.identityEstablished, true);
});

test("missing exact T-1 freezes identity even when a T-2 snapshot is supplied", () => {
  const { second } = confirmedPrimary();
  const current = buildDay(payload("2026-08-06", "2026-08-05", [stock("ASSET_A", {
    changePct: -2,
    leadership: leaderEvidence({ impactScore: 0, initiative: { proactive: false } }),
  })]), second);
  const state = cycleState(current);

  assert.strictEqual(state.frozen, true);
  assert.strictEqual(state.freezeReason, "exact_previous_closing_missing");
  assert.strictEqual(state.expectedPreviousTradingDate, "2026-08-05");
  assert.strictEqual(state.sourcePreviousTradingDate, "2026-08-04");
  assert.strictEqual(state.settledTradingDate, "2026-08-04");
  assert.strictEqual(activeCode(current), "ASSET_A");
  assert.strictEqual(state.primary.consecutiveNoImpactDays, 0, "missing T-1 must not count as a weak day");
});

test("intraday or unverified provider dates freeze the cross-day identity", async (t) => {
  const { second } = confirmedPrimary();

  await t.test("intraday snapshot", () => {
    const currentPayload = payload("2026-08-05", "2026-08-04", [stock("ASSET_A")], {
      snapshotKind: "intraday",
    });
    const current = buildDay(currentPayload, second, { snapshotKind: "intraday" });
    const state = cycleState(current);
    assert.strictEqual(state.frozen, true);
    assert.strictEqual(state.freezeReason, "current_snapshot_not_closing");
    assert.strictEqual(state.settledTradingDate, "2026-08-04");
  });

  await t.test("provider dates not verified", () => {
    const current = buildDay(payload("2026-08-05", "2026-08-04", [stock("ASSET_A")], {
      providerDatesVerified: false,
    }), second);
    const state = cycleState(current);
    assert.strictEqual(state.frozen, true);
    assert.strictEqual(state.freezeReason, "provider_trading_dates_unverified");
    assert.strictEqual(state.settledTradingDate, "2026-08-04");
  });
});

test("same-day closing recomputation is idempotent", () => {
  const { second } = confirmedPrimary();
  const replayPayload = payload("2026-08-04", "2026-08-03", [stock("ASSET_A")]);
  const replay = buildDay(replayPayload, second, {
    generatedAt: "2026-08-04T07:55:00.000Z",
  });
  const before = cycleState(second);
  const after = cycleState(replay);

  assert.strictEqual(after.settledTradingDate, before.settledTradingDate);
  assert.deepStrictEqual(after.primary.confirmedTradingDates, before.primary.confirmedTradingDates);
  assert.strictEqual(after.primary.validImpactDays, before.primary.validImpactDays);
  assert.strictEqual(after.primary.history.length, before.primary.history.length);
});

test("daily height and cycle leader may be different stocks without granting the height stock core identity", () => {
  const { second } = confirmedPrimary();
  const incumbent = stock("ASSET_A", { changePct: 2.1 });
  const dailyHeight = stock("ASSET_B", {
    role: "龙头",
    changePct: 10,
    combinedRank: 1,
    eastRank: 1,
    thsRank: 1,
    leadership: {
      persistentRecognition: false,
      impactScore: 0,
      structure: { frameworkIntact: true, breakdown: false },
      history: { appearances: 1, coreHits: 0, activeHits: 0 },
    },
  });
  const third = buildDay(payload("2026-08-05", "2026-08-04", [incumbent, dailyHeight], {
    topicLeaderCode: "ASSET_B",
  }), second);
  const theme = onlyTheme(third);
  const cycleLeader = theme.stocks.find((row) => row.code === "ASSET_A");
  const height = theme.dailyHeightStocks.find((row) => row.code === "ASSET_B");

  assert.strictEqual(activeCode(third), "ASSET_A");
  assert.ok(cycleLeader.roleKinds.includes("cycleLeader"));
  assert.ok(height.roleKinds.includes("dailyHeight"));
  assert.ok(!height.roleKinds.includes("cycleLeader"));
  assert.ok(!height.cycleIdentity || height.cycleIdentity.identityEstablished !== true);
  assert.strictEqual(theme.stocks.some((row) => row.code === "ASSET_B" && row.roleKinds.includes("cycleLeader")), false);
});

test("cycleInstanceId is stable for one theme episode despite intraday market-cycle label changes", () => {
  const { first, second } = confirmedPrimary();
  const firstState = cycleState(first);
  const secondState = cycleState(second);

  assert.strictEqual(firstState.cycleInstanceId, "theme-cycle-v1:THEME_ALPHA:2026-08-03");
  assert.strictEqual(secondState.cycleInstanceId, firstState.cycleInstanceId);
  assert.strictEqual(firstState.episodeStartedOn, "2026-08-03");
  assert.strictEqual(secondState.episodeStartedOn, "2026-08-03");
});

test("anonymous 08-10 through 08-13 replay retains the established leader without code or name rules", () => {
  const incumbent = (shape) => stock("ASSET_A", {
    role: shape.role,
    changePct: shape.changePct,
    combinedRank: shape.rank,
    eastRank: shape.rank,
    thsRank: Math.min(100, shape.rank + 2),
    leadership: leaderEvidence({
      persistentRecognition: true,
      impactScore: shape.impactScore,
      history: {
        appearances: shape.appearances,
        coreHits: shape.coreHits,
        activeHits: shape.activeHits,
      },
      initiative: shape.impactScore > 0
        ? leaderEvidence().initiative
        : { proactive: false, followerCount: 0, breadthLift: 0 },
    }),
  });
  const backRow = (changePct) => stock("ASSET_B", {
    role: "后排观察",
    changePct,
    combinedRank: 1,
    eastRank: 1,
    thsRank: 3,
    leadership: {
      persistentRecognition: false,
      impactScore: 0,
      structure: { frameworkIntact: true, breakdown: false },
      history: { appearances: 1, coreHits: 0, activeHits: 0 },
    },
  });

  const day10 = buildDay(payload("2026-08-10", "2026-08-07", [incumbent({
    role: "龙头",
    changePct: 9.94,
    rank: 1,
    impactScore: 0,
    appearances: 2,
    coreHits: 1,
    activeHits: 0,
  })], { marketCycleLabel: "repair" }));
  const day11 = buildDay(payload("2026-08-11", "2026-08-10", [incumbent({
    role: "龙头",
    changePct: 9.97,
    rank: 2,
    impactScore: 25,
    appearances: 3,
    coreHits: 2,
    activeHits: 1,
  }), backRow(10)], { marketCycleLabel: "main_rise" }), day10);
  const day12 = buildDay(payload("2026-08-12", "2026-08-11", [incumbent({
    role: "后排观察",
    changePct: 6.53,
    rank: 1,
    impactScore: 25,
    appearances: 4,
    coreHits: 3,
    activeHits: 1,
  }), backRow(10)], { marketCycleLabel: "high_divergence" }), day11);
  const day13 = buildDay(payload("2026-08-13", "2026-08-12", [incumbent({
    role: "后排观察",
    changePct: 0.57,
    rank: 7,
    impactScore: 25,
    appearances: 4,
    coreHits: 2,
    activeHits: 1,
  }), backRow(10)], { marketCycleLabel: "divergence" }), day12);

  assert.strictEqual(cycleState(day10).state, "candidate");
  assert.strictEqual(activeCode(day11), "ASSET_A");
  assert.strictEqual(activeCode(day12), "ASSET_A");
  assert.strictEqual(activeCode(day13), "ASSET_A");
  assert.strictEqual(cycleState(day13).primary.identityEstablished, true);
  assert.strictEqual(cycleState(day13).primary.activePrimary, true);
  assert.strictEqual(cycleState(day13).cycleInstanceId, cycleState(day10).cycleInstanceId);
  assert.deepStrictEqual(cycleState(day13).primary.confirmedTradingDates.slice(0, 2), [
    "2026-08-10",
    "2026-08-11",
  ]);
});
