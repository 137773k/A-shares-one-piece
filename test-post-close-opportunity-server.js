"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.MOBILE_APP_PASSWORD = process.env.MOBILE_APP_PASSWORD || "test-only";

const { buildPremarketFlow } = require("./premarket-flow");
const { _internals } = require("./server");

function loadCurrentSnapshot() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, ".hot-stocks-cache.json"), "utf8"));
}

test("server persists one traceable post-close report derived from the canonical snapshot", () => {
  const payload = loadCurrentSnapshot();
  const report = _internals.refreshPostCloseOpportunityReport(payload);
  const flow = buildPremarketFlow(payload);
  const planCodes = new Set((flow.tradePlan && flow.tradePlan.plans || []).map((row) => String(row.code || "")));

  assert.equal(payload.postCloseOpportunity, report);
  assert.equal(report.version, 1);
  assert.equal(report.method, "rule_based");
  assert.equal(report.calibrated, false);
  const expectedGenerationId = payload.tomorrowDecision && payload.tomorrowDecision.generationId
    || payload.premarketModels && payload.premarketModels.generationId
    || `${report.tradingDate || "unknown"}:${report.asOf}`;
  assert.equal(report.generationId, expectedGenerationId);
  assert.equal(report.integrity.failClosed, true);
  assert.equal(report.integrity.opportunityCardsFromFinalPlansOnly, true);
  assert.ok(report.candidateThemes.length <= 3);
  assert.ok(report.opportunityCards.length <= 5);
  assert.ok(report.opportunityCards.every((card) => planCodes.has(String(card.code || ""))));
});

test("server clears any stale opportunity when the current snapshot cannot be read", () => {
  const payload = {
    postCloseOpportunity: {
      version: 1,
      status: "opportunities",
      opportunityCards: [{ code: "STALE001" }],
    },
  };
  Object.defineProperty(payload, "themeLibrary", {
    enumerable: true,
    get() {
      throw new Error("hostile current snapshot");
    },
  });

  const report = _internals.refreshPostCloseOpportunityReport(payload);
  assert.equal(report.method, "unavailable");
  assert.equal(report.dataStatus.usable, false);
  assert.equal(report.marketPermission.status, "blocked");
  assert.deepEqual(report.opportunityCards, []);
  assert.equal(report.integrity.failClosed, true);
  assert.doesNotMatch(JSON.stringify(report), /STALE001/);
});

test("server gives legacy snapshots a trace id from trading date and snapshot time", () => {
  const payload = loadCurrentSnapshot();
  payload.fetchedAt = "2026-08-11T15:58:56.264Z";
  if (payload.tomorrowDecision) delete payload.tomorrowDecision.generationId;
  if (payload.premarketModels) delete payload.premarketModels.generationId;

  const report = _internals.refreshPostCloseOpportunityReport(payload);
  assert.equal(report.asOf, payload.fetchedAt);
  assert.equal(report.generationId, `${report.tradingDate || "unknown"}:${payload.fetchedAt}`);
});

test("server rebuilds a traceable recent index-emotion relation from closing archives", () => {
  const payload = loadCurrentSnapshot();
  delete payload.recentIndexEmotionRelation;
  const expectedDate = String(payload.market && payload.market.limitStats && payload.market.limitStats.dates
    && payload.market.limitStats.dates.today || "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");

  assert.equal(typeof _internals.refreshRecentIndexEmotionRelation, "function");
  const relation = _internals.refreshRecentIndexEmotionRelation(payload);

  assert.equal(payload.recentIndexEmotionRelation, relation);
  assert.equal(relation.calibrated, false);
  assert.equal(relation.integrity && relation.integrity.failClosed, true);
  assert.ok(["ready", "insufficient"].includes(String(relation.status || "")));
  assert.ok(Array.isArray(relation.daily));
  assert.ok(relation.daily.length >= 2);
  assert.equal(relation.tradingDate, expectedDate);
  assert.ok(relation.today && relation.today.tradingDate === expectedDate);
  assert.doesNotMatch(JSON.stringify(relation), /今日指数.{0,2}情绪关系/);
  assert.doesNotMatch(JSON.stringify(relation), /概率\s*[:：]?\s*\d/);
});

test("post-close report consumes the same recent relation without turning observation into permission", () => {
  const payload = loadCurrentSnapshot();
  const relation = _internals.refreshRecentIndexEmotionRelation(payload);
  const report = _internals.refreshPostCloseOpportunityReport(payload);

  assert.equal(report.recentRelation.generationId, relation.generationId);
  assert.equal(report.recentRelation.tradingDate, relation.tradingDate);
  assert.equal(report.recentRelation.status, relation.status);
  assert.equal(report.recentRelation.title, "近期指数—情绪关系");
  assert.ok(report.recentRelation.daily.length >= 2);
  assert.equal(report.marketPermission.canCreateOpportunities, false);
  assert.deepEqual(report.opportunityCards, []);
  assert.equal(report.integrity.failClosed, true);
});

test("recent relation fails closed when the current snapshot is unreadable", () => {
  const payload = {};
  Object.defineProperty(payload, "market", {
    enumerable: true,
    get() {
      throw new Error("hostile recent relation snapshot");
    },
  });

  const relation = _internals.refreshRecentIndexEmotionRelation(payload);
  assert.equal(relation.status, "insufficient");
  assert.equal(relation.integrity.failClosed, true);
  assert.deepEqual(relation.daily, []);
  assert.equal(relation.dominant && relation.dominant.key, "unknown");
});
