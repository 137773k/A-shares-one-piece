"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "theme-leader-role-server-"));
process.env.A_SHARE_RUNTIME_DIR = runtimeRoot;
process.env.MOBILE_APP_PASSWORD = process.env.MOBILE_APP_PASSWORD || "test-only";

const serverPath = process.env.SERVER_MODULE
  ? path.resolve(process.env.SERVER_MODULE)
  : path.join(__dirname, "server");
const themeLibraryPath = process.env.THEME_LIBRARY_MODULE
  ? path.resolve(process.env.THEME_LIBRARY_MODULE)
  : path.join(__dirname, "theme-library");
const { _internals } = require(serverPath);
const { THEME_LIBRARY_CLASSIFIER_VERSION } = require(themeLibraryPath);
const {
  applyThemeCycleIdentitiesToCandidates,
  candidateRoleAuthority,
  themeLibrarySnapshotFromPayload,
} = _internals;

const TRADING_DATE = "2026-08-05";
const THEME_KEY = "THEME_SERVER_ANONYMOUS";

function candidate() {
  return {
    code: "ASSET_SERVER_A",
    name: "ASSET_SERVER_A",
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
    changePct: 2,
    amountYi: 20,
    leadership: {
      persistentRecognition: false,
      impactScore: 0,
      structure: { frameworkIntact: true, breakdown: false },
      history: { appearances: 1, coreHits: 0, activeHits: 0 },
      initiative: {
        proactive: false,
        dataQuality: "分时验证",
        tradingDate: TRADING_DATE,
        source: "anonymous_server_fixture",
        firstAttackTime: null,
        followerCount: 0,
        breadthLift: 0,
        priceDiscovery: { noPriceDiscovery: false },
      },
    },
  };
}

function payloadWithSavedTheme(savedRoleEvidenceCards) {
  const row = candidate();
  return {
    fetchedAt: `${TRADING_DATE}T07:10:00.000Z`,
    archiveMeta: { tradingDate: TRADING_DATE, snapshotKind: "closing" },
    market: {
      limitStats: {
        dates: {
          today: TRADING_DATE,
          prev: "2026-08-04",
          // Keep archive lookup out of this unit test. A provider-date freeze is
          // still expected to emit the new role evidence contract.
          verified: false,
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
        count: 1,
        limitCount: 0,
        leader: row,
        leaders: [row],
      }],
    },
    candidates: [row],
    themeLibrary: {
      schemaVersion: 1,
      classifierVersion: THEME_LIBRARY_CLASSIFIER_VERSION,
      tradingDate: TRADING_DATE,
      generatedAt: `${TRADING_DATE}T07:20:00.000Z`,
      snapshotKind: "closing",
      sourceMode: "legacy-saved-without-role-contract",
      available: true,
      stale: false,
      legacySentinel: "must_be_rebuilt",
      themes: [{
        id: THEME_KEY,
        name: THEME_KEY,
        family: THEME_KEY,
        cycleLeadership: {
          version: 1,
          themeKey: THEME_KEY,
          state: "candidate",
          primary: null,
          challenger: null,
          identities: {},
          activeLeaderCode: null,
          settledTradingDate: TRADING_DATE,
          frozen: false,
        },
        ...(savedRoleEvidenceCards === undefined ? {} : { roleEvidenceCards: savedRoleEvidenceCards }),
      }],
    },
  };
}

function assertRebuiltWithRoleContract(snapshot) {
  assert.ok(snapshot && typeof snapshot === "object");
  assert.notStrictEqual(
    snapshot.legacySentinel,
    "must_be_rebuilt",
    "server hydration must reject a saved snapshot that lacks the complete role-evidence contract",
  );
  assert.ok(Array.isArray(snapshot.themes) && snapshot.themes.length === 1);
  const cards = snapshot.themes[0].roleEvidenceCards;
  assert.ok(Array.isArray(cards), "rebuilt snapshot must emit roleEvidenceCards");
  assert.deepStrictEqual(cards.map((card) => card.roleKey), ["cycleLeader", "dailyLeader"]);
  cards.forEach((card) => {
    assert.strictEqual(card.tradingDate, TRADING_DATE);
    assert.ok(typeof card.source === "string" && card.source.length > 0);
    assert.ok(Array.isArray(card.evidence) && card.evidence.length > 0);
    assert.ok(Array.isArray(card.gaps));
    assert.strictEqual(card.executionEligible, false);
  });
}

test.after(() => {
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

test("server rebuilds same-classifier saved snapshots that predate roleEvidenceCards", () => {
  const snapshot = themeLibrarySnapshotFromPayload(
    payloadWithSavedTheme(undefined),
    "role-evidence-server-test",
  );
  assertRebuiltWithRoleContract(snapshot);
});

test("server rejects superficially present role cards when evidence lineage is incomplete", () => {
  const malformed = [
    {
      roleKey: "cycleLeader",
      roleScope: "cycle",
      status: "none",
      stock: null,
      evidence: [],
      gaps: [],
      executionEligible: false,
    },
    {
      roleKey: "dailyLeader",
      roleScope: "session",
      status: "none",
      stock: null,
      evidence: [],
      gaps: [],
      executionEligible: false,
    },
  ];
  const snapshot = themeLibrarySnapshotFromPayload(
    payloadWithSavedTheme(malformed),
    "role-evidence-server-test",
  );
  assertRebuiltWithRoleContract(snapshot);
});

test("an observation-only cycle identity cannot open core authority, while exact verified attribution can", () => {
  const makePayload = (executionEligible) => ({
    candidates: [{ code: "ASSET_AUTHORITY", leadership: {} }],
    themeLibrary: {
      tradingDate: TRADING_DATE,
      themes: [{
        id: THEME_KEY,
        name: THEME_KEY,
        cycleLeadership: {
          themeKey: THEME_KEY,
          cycleInstanceId: `theme-cycle-v1:${THEME_KEY}:2026-08-03`,
          state: "confirmed",
          activeLeaderCode: "ASSET_AUTHORITY",
          settledTradingDate: TRADING_DATE,
          frozen: false,
          identities: {
            ASSET_AUTHORITY: {
              code: "ASSET_AUTHORITY",
              state: "confirmed",
              identityEstablished: true,
              activePrimary: true,
              validImpactDays: 2,
              impactTradingDates: ["2026-08-04", TRADING_DATE],
            },
          },
        },
        roleAuthorityByCode: {
          ASSET_AUTHORITY: {
            cycleLeader: executionEligible,
            executionEligible,
            source: executionEligible ? "candidate.themeAttribution" : "candidate.concepts.exact",
            tradingDate: TRADING_DATE,
          },
        },
        roleMembershipByCode: {},
        dailyHeightStocks: [],
      }],
    },
  });

  const observation = makePayload(false);
  applyThemeCycleIdentitiesToCandidates(observation);
  assert.strictEqual(observation.candidates[0].leadership.cycleIdentity.identityEstablished, true);
  assert.strictEqual(observation.candidates[0].leadership.cycleIdentity.executionEligible, false);
  assert.strictEqual(candidateRoleAuthority(observation.candidates[0]).cycleLeader, false);
  assert.strictEqual(candidateRoleAuthority(observation.candidates[0]).coreAuthorized, false);

  const verified = makePayload(true);
  applyThemeCycleIdentitiesToCandidates(verified);
  assert.strictEqual(verified.candidates[0].leadership.cycleIdentity.executionEligible, true);
  assert.strictEqual(candidateRoleAuthority(verified.candidates[0]).cycleLeader, true);
  assert.strictEqual(candidateRoleAuthority(verified.candidates[0]).coreAuthorized, true);
});

test("missing per-stock role authority fails closed even when a legacy role label says cycle leader", () => {
  const legacy = {
    roleKind: "cycleLeader",
    roleScope: "cycle",
    leadership: {
      cycleIdentity: {
        identityEstablished: true,
        activePrimary: true,
        state: "confirmed",
      },
    },
  };
  assert.strictEqual(candidateRoleAuthority(legacy).cycleLeader, false);
  assert.strictEqual(candidateRoleAuthority(legacy).coreAuthorized, false);
});
