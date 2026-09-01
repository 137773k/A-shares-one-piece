"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "theme-cycle-server-"));
process.env.A_SHARE_RUNTIME_DIR = runtimeRoot;
process.env.MOBILE_APP_PASSWORD = process.env.MOBILE_APP_PASSWORD || "test-only";

const serverPath = process.env.SERVER_MODULE
  ? path.resolve(process.env.SERVER_MODULE)
  : path.join(__dirname, "server");
const themeLibraryPath = process.env.THEME_LIBRARY_MODULE
  ? path.resolve(process.env.THEME_LIBRARY_MODULE)
  : path.join(__dirname, "theme-library");
const { _internals } = require(serverPath);
const { themeLibrarySnapshotFromPayload, applyThemeCycleIdentitiesToCandidates } = _internals;
const { THEME_LIBRARY_CLASSIFIER_VERSION } = require(themeLibraryPath);

const historyDir = path.join(runtimeRoot, "data", "history");
fs.mkdirSync(historyDir, { recursive: true });

const LEGACY_CLASSIFIER_VERSION = "theme-library-v4-cycle-role-contract";
const MEDICAL_SUBTHEME = "创新药";

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
    mainFamily: MEDICAL_SUBTHEME,
    mainConcept: MEDICAL_SUBTHEME,
    concepts: [MEDICAL_SUBTHEME],
    themeAttribution: {
      verified: true,
      selectionEligible: true,
      conflict: false,
      primaryThemeName: MEDICAL_SUBTHEME,
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

function legacyPayload(tradingDate, previousTradingDate, candidates, options = {}) {
  const topicLeader = options.topicLeaderCode
    ? candidates.find((row) => row.code === options.topicLeaderCode)
    : candidates[0];
  return {
    fetchedAt: `${tradingDate}T07:20:00.000Z`,
    stale: false,
    fetchError: null,
    fetchStatus: { level: "ok" },
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
      mainLine: { name: MEDICAL_SUBTHEME, family: MEDICAL_SUBTHEME },
      items: [{
        name: MEDICAL_SUBTHEME,
        family: MEDICAL_SUBTHEME,
        displayName: MEDICAL_SUBTHEME,
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
    themeLibrary: {
      schemaVersion: 1,
      classifierVersion: LEGACY_CLASSIFIER_VERSION,
      tradingDate,
      snapshotKind: options.snapshotKind || "closing",
      available: true,
      themes: [{ id: MEDICAL_SUBTHEME, name: MEDICAL_SUBTHEME, stocks: [] }],
    },
  };
}

function writeArchive(payload) {
  const date = String(payload.archiveMeta.tradingDate);
  fs.writeFileSync(path.join(historyDir, `${date}.json`), JSON.stringify(payload), "utf8");
  const indexFile = path.join(historyDir, "index.json");
  const current = fs.existsSync(indexFile)
    ? JSON.parse(fs.readFileSync(indexFile, "utf8"))
    : [];
  const next = current.filter((row) => row && row.date !== date);
  next.push({ date, archivedAt: `${date}T08:00:00.000Z` });
  next.sort((left, right) => left.date.localeCompare(right.date));
  fs.writeFileSync(indexFile, JSON.stringify(next), "utf8");
}

function themeOf(snapshot) {
  const theme = snapshot.themes.find((row) => row.name === "医药") || snapshot.themes[0];
  assert.ok(theme, "fixture must produce one medical theme");
  return theme;
}

function activeCode(snapshot) {
  const leadership = themeOf(snapshot).cycleLeadership;
  return leadership && leadership.primary && leadership.primary.activePrimary !== false
    ? leadership.primary.code
    : null;
}

function factIncumbent(shape) {
  return stock("ASSET_INCUMBENT", {
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
        : {
            proactive: false,
            followerCount: 0,
            breadthLift: 0,
            priceDiscovery: { noPriceDiscovery: false },
          },
    }),
  });
}

function dailyHeight(code = "ASSET_DAILY_HEIGHT") {
  return stock(code, {
    role: "龙头",
    changePct: 10,
    combinedRank: 1,
    eastRank: 1,
    thsRank: 3,
    leadership: {
      persistentRecognition: false,
      impactScore: 0,
      structure: { frameworkIntact: true, breakdown: false },
      history: { appearances: 1, coreHits: 0, activeHits: 0 },
      initiative: {
        proactive: false,
        followerCount: 0,
        breadthLift: 0,
        priceDiscovery: { noPriceDiscovery: false },
      },
    },
  });
}

test.after(() => {
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

test("service uses provider dates.prev only and never substitutes an existing T-2 closing", () => {
  const t2 = legacyPayload("2026-06-01", "2026-05-29", [factIncumbent({
    role: "龙头",
    changePct: 9.9,
    rank: 2,
    impactScore: 20,
    appearances: 3,
    coreHits: 2,
    activeHits: 1,
  })]);
  writeArchive(t2);

  const current = legacyPayload("2026-06-03", "2026-06-02", [factIncumbent({
    role: "后排观察",
    changePct: 1,
    rank: 7,
    impactScore: 20,
    appearances: 4,
    coreHits: 2,
    activeHits: 1,
  })]);
  const snapshot = themeLibrarySnapshotFromPayload(current, "server-exact-prev-test", {
    forceRebuild: true,
  });
  const leadership = themeOf(snapshot).cycleLeadership;

  assert.strictEqual(leadership.frozen, true);
  assert.strictEqual(leadership.freezeReason, "exact_previous_closing_missing");
  assert.strictEqual(leadership.expectedPreviousTradingDate, "2026-06-02");
  assert.notStrictEqual(leadership.sourcePreviousTradingDate, "2026-06-01");
  assert.strictEqual(activeCode(snapshot), null, "T-2 must not create or advance cycle identity");
});

test("legacy v4 closing archives migrate through the exact provider chain into v5", () => {
  const day07 = legacyPayload("2026-08-07", "2026-08-06", [factIncumbent({
    role: "龙头",
    changePct: 9.97,
    rank: 2,
    impactScore: 0,
    appearances: 2,
    coreHits: 1,
    activeHits: 0,
  })]);
  const day10 = legacyPayload("2026-08-10", "2026-08-07", [factIncumbent({
    role: "龙头",
    changePct: 9.94,
    rank: 1,
    impactScore: 0,
    appearances: 2,
    coreHits: 1,
    activeHits: 0,
  })]);
  const day11 = legacyPayload("2026-08-11", "2026-08-10", [factIncumbent({
    role: "龙头",
    changePct: 9.97,
    rank: 2,
    impactScore: 25,
    appearances: 3,
    coreHits: 2,
    activeHits: 1,
  }), dailyHeight("ASSET_HEIGHT_11")]);
  const day12 = legacyPayload("2026-08-12", "2026-08-11", [factIncumbent({
    role: "后排观察",
    changePct: 6.53,
    rank: 1,
    impactScore: 25,
    appearances: 4,
    coreHits: 3,
    activeHits: 1,
  }), dailyHeight("ASSET_HEIGHT_12")]);
  [day07, day10, day11, day12].forEach(writeArchive);

  const day13 = legacyPayload("2026-08-13", "2026-08-12", [factIncumbent({
    role: "后排观察",
    changePct: 0.57,
    rank: 7,
    impactScore: 25,
    appearances: 4,
    coreHits: 2,
    activeHits: 1,
  }), dailyHeight()], { topicLeaderCode: "ASSET_DAILY_HEIGHT" });
  const snapshot = themeLibrarySnapshotFromPayload(day13, "current-cache", {
    forceRebuild: true,
  });
  const theme = themeOf(snapshot);
  const leadership = theme.cycleLeadership;

  assert.strictEqual(snapshot.classifierVersion, THEME_LIBRARY_CLASSIFIER_VERSION);
  assert.strictEqual(day13.themeLibrary.classifierVersion, LEGACY_CLASSIFIER_VERSION, "migration must not mutate source archive data");
  assert.strictEqual(leadership.frozen, false);
  assert.strictEqual(leadership.sourcePreviousTradingDate, "2026-08-12");
  assert.strictEqual(leadership.state, "confirmed");
  assert.strictEqual(activeCode(snapshot), "ASSET_INCUMBENT");
  assert.deepStrictEqual(leadership.primary.confirmedTradingDates.slice(0, 2), [
    "2026-08-10",
    "2026-08-11",
  ]);

  const projectedLeader = theme.stocks.find((row) => row.code === "ASSET_INCUMBENT");
  const projectedHeight = theme.dailyHeightStocks.find((row) => row.code === "ASSET_DAILY_HEIGHT");
  assert.ok(projectedLeader && projectedLeader.roleKinds.includes("cycleLeader"));
  assert.ok(projectedHeight && projectedHeight.roleKinds.includes("dailyHeight"));
  assert.ok(!projectedHeight.roleKinds.includes("cycleLeader"));
  assert.strictEqual(
    theme.stocks.some((row) => row.code === "ASSET_DAILY_HEIGHT" && row.roleKinds.includes("cycleLeader")),
    false,
    "today's height stock must not replace an established cycle leader",
  );
});

test("same closing payload recomputation is idempotent at the service boundary", () => {
  const current = legacyPayload("2026-08-13", "2026-08-12", [factIncumbent({
    role: "后排观察",
    changePct: 0.57,
    rank: 7,
    impactScore: 25,
    appearances: 4,
    coreHits: 2,
    activeHits: 1,
  }), dailyHeight()], { topicLeaderCode: "ASSET_DAILY_HEIGHT" });
  const first = themeLibrarySnapshotFromPayload(current, "same-day-recompute", { forceRebuild: true });
  const second = themeLibrarySnapshotFromPayload(current, "same-day-recompute", { forceRebuild: true });
  const before = themeOf(first).cycleLeadership;
  const after = themeOf(second).cycleLeadership;

  assert.strictEqual(after.settledTradingDate, before.settledTradingDate);
  assert.strictEqual(after.activeLeaderCode, before.activeLeaderCode);
  assert.deepStrictEqual(after.primary.confirmedTradingDates, before.primary.confirmedTradingDates);
  assert.strictEqual(after.primary.validImpactDays, before.primary.validImpactDays);
  assert.strictEqual(after.primary.history.length, before.primary.history.length);
});

test("settled cycle identity is projected back to candidates before downstream decisions", () => {
  assert.strictEqual(typeof applyThemeCycleIdentitiesToCandidates, "function");
  const payload = {
    candidates: [
      { code: "ASSET_INCUMBENT", leadership: { coreIdentityQualified: false } },
      { code: "ASSET_DAILY_HEIGHT", role: "龙头", leadership: {} },
      { code: "ASSET_DUAL_AXIS", role: "龙头", roleKind: "dailyHeight", roleScope: "session", dailyRole: "当日高度", leadership: {} },
      { code: "ASSET_STALE", leadership: { cycleIdentity: { state: "confirmed", activePrimary: true }, sessionIdentity: { tradingDate: "2026-08-12", dailyHeight: true } } },
    ],
    themeLibrary: {
      tradingDate: "2026-08-13",
      themes: [{
        id: "THEME_MEDICAL",
        name: "医药",
        dailyHeightStocks: [{ code: "ASSET_DAILY_HEIGHT", roleKinds: ["dailyHeight"] }],
        roleMembershipByCode: {
          ASSET_DAILY_HEIGHT: { dailyHeight: true },
          ASSET_DUAL_AXIS: { dailyHeight: true },
        },
        cycleLeadership: {
          themeKey: "医药",
          cycleInstanceId: "theme-cycle-v1:medical:2026-08-10",
          settledTradingDate: "2026-08-13",
          frozen: false,
          identities: {
            ASSET_INCUMBENT: {
              code: "ASSET_INCUMBENT",
              state: "confirmed",
              identityEstablished: true,
              activePrimary: true,
              confirmedTradingDates: ["2026-08-10", "2026-08-11"],
              impactTradingDates: ["2026-08-10", "2026-08-11"],
            },
            ASSET_DAILY_HEIGHT: {
              code: "ASSET_DAILY_HEIGHT",
              state: "candidate",
              identityEstablished: false,
              activePrimary: false,
              confirmedTradingDates: [],
              impactTradingDates: ["2026-08-13"],
            },
            ASSET_DUAL_AXIS: {
              code: "ASSET_DUAL_AXIS",
              state: "confirmed",
              identityEstablished: true,
              activePrimary: true,
              confirmedTradingDates: ["2026-08-10", "2026-08-11"],
              impactTradingDates: ["2026-08-10", "2026-08-11"],
            },
          },
        },
      }],
    },
  };

  applyThemeCycleIdentitiesToCandidates(payload);
  const incumbent = payload.candidates.find((row) => row.code === "ASSET_INCUMBENT");
  const height = payload.candidates.find((row) => row.code === "ASSET_DAILY_HEIGHT");
  const dual = payload.candidates.find((row) => row.code === "ASSET_DUAL_AXIS");
  const stale = payload.candidates.find((row) => row.code === "ASSET_STALE");

  assert.strictEqual(incumbent.leadership.cycleIdentity.identityEstablished, true);
  assert.strictEqual(incumbent.leadership.cycleIdentity.activePrimary, true);
  assert.strictEqual(incumbent.leadership.cycleIdentity.themeName, "医药");
  assert.strictEqual(height.leadership.cycleIdentity.identityEstablished, false);
  assert.strictEqual(height.roleKind, "dailyHeight", "theme daily-height membership must restore the current-session role axis");
  assert.strictEqual(height.roleScope, "session");
  assert.strictEqual(height.dailyRole, "当日高度");
  assert.deepStrictEqual(height.leadership.dailyHeightMembership.themeNames, ["医药"]);
  assert.strictEqual(height.leadership.sessionIdentity.dailyHeight, true);
  assert.strictEqual(height.leadership.sessionIdentity.tradingDate, "2026-08-13");
  assert.strictEqual(dual.leadership.cycleIdentity.identityEstablished, true, "same-stock cross-day identity must survive the session role axis");
  assert.strictEqual(dual.leadership.sessionIdentity.dailyHeight, true, "same stock may be a cycle leader and today's height at the same time");
  assert.strictEqual(stale.leadership.cycleIdentity, null, "identities absent from the current settled library must fail closed");
  assert.strictEqual(stale.leadership.sessionIdentity, null, "yesterday's daily-height identity must not leak into a new session");
});
