"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const server = require(path.resolve(__dirname, process.env.TEST_SERVER_PATH || "./server.js"));

function closingArchive() {
  return {
    fetchedAt: "2026-08-13T07:58:42.764Z",
    updatedAt: "2026-08-13T07:58:42.764Z",
    asOf: "2026-08-13T08:00:00.000Z",
    generationId: "2026-08-13:2026-08-13T08:00:00.000Z",
    archiveMeta: {
      tradingDate: "2026-08-13",
      snapshotKind: "closing",
    },
    market: {
      limitStats: {
        dates: {
          today: "20260813",
          prev: "20260812",
          verified: true,
        },
      },
    },
    sources: {
      hotRanks: {
        eastmoney: {
          tradingDate: "2026-08-13",
          marketDataTradingDate: "2026-08-13",
          observationPhase: "postclose",
          snapshotKind: "closing",
          complete: true,
        },
        ths: {
          tradingDate: "2026-08-13",
          marketDataTradingDate: "2026-08-13",
          observationPhase: "postclose",
          snapshotKind: "closing",
          complete: true,
        },
      },
    },
    candidates: [{ code: "910001", name: "收盘核心样本" }],
  };
}

function preopenPayload(codes = ["920001", "920002"]) {
  return {
    fetchedAt: "2026-08-13T19:34:58.114Z",
    market: {
      limitStats: {
        dates: {
          today: "20260813",
          prev: "20260812",
          verified: true,
        },
      },
    },
    sources: {
      hotRanks: {
        unionCount: codes.length,
        overlapCount: 0,
        eastmoney: {
          tradingDate: "2026-08-14",
          marketDataTradingDate: "2026-08-13",
          observationPhase: "preopen",
          snapshotKind: "live-observation",
          complete: true,
        },
        ths: {
          tradingDate: "2026-08-14",
          marketDataTradingDate: "2026-08-13",
          observationPhase: "preopen",
          snapshotKind: "live-observation",
          complete: true,
        },
      },
    },
    candidates: codes.map((code, index) => ({
      code,
      name: `盘前观察${index + 1}`,
      eastRank: index + 1,
      thsRank: codes.length - index,
    })),
  };
}

function futureRankPayload(observationPhase, codes = ["940001", "940002"]) {
  const payload = preopenPayload(codes);
  payload.fetchedAt = "2026-08-14T02:15:00.000Z";
  for (const source of [payload.sources.hotRanks.eastmoney, payload.sources.hotRanks.ths]) {
    source.observationPhase = observationPhase;
  }
  return payload;
}

test("next-session preopen ranks use the exact prior closing bundle as the decision basis", () => {
  const resolveBasis = server._internals.resolveCanonicalClosingDecisionBasis;
  assert.equal(typeof resolveBasis, "function");
  const archived = closingArchive();
  const result = resolveBasis(preopenPayload(), {
    readClosingArchive: (date) => date === "2026-08-13" ? archived : null,
  });

  assert.equal(result.status, "frozen_closing");
  assert.equal(result.usable, true);
  assert.equal(result.payload.candidates[0].code, "910001");
  assert.equal(result.payload.decisionBasis.tradingDate, "2026-08-13");
  assert.equal(result.payload.decisionBasis.snapshotKind, "closing");
  assert.equal(result.payload.decisionBasis.asOf, archived.asOf);
  assert.equal(result.payload.preopenObservation.tradingDate, "2026-08-14");
  assert.equal(result.payload.preopenObservation.usedForClosingDecision, false);
});

test("next-session intraday ranks also require the exact prior closing bundle", () => {
  const resolveBasis = server._internals.resolveCanonicalClosingDecisionBasis;
  const archived = closingArchive();
  const result = resolveBasis(futureRankPayload("intraday"), {
    readClosingArchive: (date) => date === "2026-08-13" ? archived : null,
  });

  assert.equal(result.status, "frozen_closing");
  assert.equal(result.usable, true);
  assert.equal(result.payload.candidates[0].code, "910001");
  assert.equal(result.payload.decisionBasis.futureRanksExcluded, true);
  assert.equal(result.payload.decisionBasis.preopenRanksExcluded, true, "legacy flag remains compatible");
  assert.equal(result.payload.rankObservation.tradingDate, "2026-08-14");
  assert.deepEqual(result.payload.rankObservation.observationPhases, ["intraday"]);
  assert.equal(result.payload.rankObservation.usedForClosingDecision, false);
  assert.equal(result.payload.preopenObservation.usedForClosingDecision, false, "legacy observation alias remains read-only");
});

test("next-session intraday ranks fail closed when the exact prior close is missing", () => {
  const resolveBasis = server._internals.resolveCanonicalClosingDecisionBasis;
  const result = resolveBasis(futureRankPayload("intraday"), { readClosingArchive: () => null });

  assert.equal(result.status, "unavailable");
  assert.equal(result.usable, false);
  assert.equal(result.payload, null);
  assert.equal(result.observation.usedForClosingDecision, false);
  assert.deepEqual(result.observation.observationPhases, ["intraday"]);
  assert.match(result.reason, /closing/i);
});

test("normalizing a frozen close preserves its closing asOf and generation identity", () => {
  const resolveBasis = server._internals.resolveCanonicalClosingDecisionBasis;
  const normalize = server._internals.normalizeHotStocksFallbackResponse;
  const archived = closingArchive();
  const frozen = resolveBasis(futureRankPayload("intraday"), {
    readClosingArchive: () => archived,
  }).payload;
  const normalized = normalize(frozen, "", { stamp: false });

  assert.equal(frozen.decisionBasis.asOf, archived.asOf);
  assert.equal(frozen.decisionBasis.generationId, archived.generationId);
  assert.equal(normalized.asOf, archived.asOf);
  assert.equal(normalized.generationId, archived.generationId);
  assert.equal(normalized.decisionBasis.asOf, archived.asOf);
  assert.equal(normalized.decisionBasis.generationId, archived.generationId);
  assert.equal(normalized.rankObservation.usedForClosingDecision, false);
});

test("different preopen lists cannot rewrite the same frozen closing candidate roster", () => {
  const resolveBasis = server._internals.resolveCanonicalClosingDecisionBasis;
  const archived = closingArchive();
  const options = { readClosingArchive: () => archived };
  const first = resolveBasis(preopenPayload(["920001", "920002"]), options);
  const second = resolveBasis(preopenPayload(["930001", "930002", "930003"]), options);

  assert.deepEqual(first.payload.candidates, second.payload.candidates);
  assert.equal(first.payload.decisionBasis.asOf, second.payload.decisionBasis.asOf);
  assert.notDeepEqual(
    first.payload.preopenObservation.topCandidates,
    second.payload.preopenObservation.topCandidates,
  );
});

test("a valid same-day post-close payload remains the current closing basis", () => {
  const resolveBasis = server._internals.resolveCanonicalClosingDecisionBasis;
  const payload = closingArchive();
  const result = resolveBasis(payload, {
    readClosingArchive: () => assert.fail("same-day closing must not read a replacement archive"),
  });

  assert.equal(result.status, "current_closing");
  assert.equal(result.usable, true);
  assert.equal(result.payload, payload);
});

test("missing exact closing archive fails closed instead of mixing future ranks with old prices", () => {
  const resolveBasis = server._internals.resolveCanonicalClosingDecisionBasis;
  const result = resolveBasis(preopenPayload(), { readClosingArchive: () => null });

  assert.equal(result.status, "unavailable");
  assert.equal(result.usable, false);
  assert.equal(result.payload, null);
  assert.match(result.reason, /closing/i);
});
