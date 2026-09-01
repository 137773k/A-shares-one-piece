"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

let reviewModule = null;
let reviewModuleLoadError = null;
try {
  const implementationPath = process.env.THEME_ATTRIBUTION_REVIEW_MODULE
    ? path.resolve(process.env.THEME_ATTRIBUTION_REVIEW_MODULE)
    : path.join(__dirname, "theme-attribution-review");
  reviewModule = require(implementationPath);
} catch (error) {
  reviewModuleLoadError = error;
}

const CONTRACT_VERSION = 1;
const BASE_GENERATION = Object.freeze({
  generationId: "2026-08-14:2026-08-14T15:42:44.984Z",
  tradingDate: "2026-08-14",
  asOf: "2026-08-14T15:42:44.984Z",
});
const NEXT_GENERATION = Object.freeze({
  generationId: "2026-08-15:2026-08-15T15:10:00.000Z",
  tradingDate: "2026-08-15",
  asOf: "2026-08-15T15:10:00.000Z",
});
const REVIEW_ID = "theme-review-002428-20260814";
const STOCK_CODE = "002428";

function requireApi(name) {
  assert.ifError(reviewModuleLoadError);
  assert.equal(
    typeof reviewModule[name],
    "function",
    `theme-attribution-review.js 必须导出 ${name}`,
  );
  return reviewModule[name];
}

function decisionSnapshot() {
  return {
    strictExecutable: false,
    permission: {
      status: "blocked",
      allowNew: false,
      maxPositionPct: 0,
      reason: "既有执行闸门关闭",
    },
    opportunityCount: 2,
    opportunities: [
      { code: "600487", state: "watch_only" },
      { code: "600664", state: "watch_only" },
    ],
  };
}

function context(overrides = {}) {
  return {
    currentGeneration: { ...BASE_GENERATION },
    decision: decisionSnapshot(),
    now: "2026-08-14T16:00:00.000Z",
    ...overrides,
  };
}

function event(type, expectedRevision, overrides = {}) {
  const payload = overrides.payload || {};
  return {
    eventId: overrides.eventId || `${REVIEW_ID}:${type}:${expectedRevision + 1}`,
    reviewId: REVIEW_ID,
    stockCode: STOCK_CODE,
    type,
    expectedRevision,
    occurredAt: overrides.occurredAt || `2026-08-14T15:${String(50 + expectedRevision).padStart(2, "0")}:00.000Z`,
    actor: overrides.actor || { type: "human", id: "local-user" },
    payload,
  };
}

function draftEvent(overrides = {}) {
  return event("draft_saved", 0, {
    eventId: "theme-review-event-draft",
    ...overrides,
    payload: {
      attribution: {
        parentTheme: "算力租赁",
        fineTheme: "CPO/光模块",
        note: "人工提出的细分题材，尚未交叉验证",
      },
      baseGeneration: { ...BASE_GENERATION },
      ...(overrides.payload || {}),
    },
  });
}

function humanConfirmedEvent(overrides = {}) {
  return event("human_confirmed", 1, {
    eventId: "theme-review-event-human-confirmed",
    ...overrides,
    payload: {
      confirmation: {
        confirmedBy: "local-user",
        confirmedAt: "2026-08-14T15:51:00.000Z",
        statement: "确认该股票按CPO/光模块方向观察",
      },
      ...(overrides.payload || {}),
    },
  });
}

function corroborationEvent(verdict = "supports", overrides = {}) {
  return event("corroboration_recorded", 2, {
    eventId: `theme-review-event-corroboration-${verdict}`,
    ...overrides,
    payload: {
      verdict,
      evidence: {
        evidenceId: `independent-evidence-${verdict}`,
        sourceKind: "verified_theme_board",
        sourceRef: "theme-board:CPO/光模块:2026-08-14-close",
        observedAt: "2026-08-14T15:52:00.000Z",
        verified: true,
        independent: true,
        parentTheme: "算力租赁",
        fineTheme: "CPO/光模块",
      },
      ...(overrides.payload || {}),
    },
  });
}

function apply(previousReview, nextEvent, overrides = {}) {
  const applyThemeAttributionReviewEvent = requireApi("applyThemeAttributionReviewEvent");
  return applyThemeAttributionReviewEvent({
    previousReview,
    event: nextEvent,
    ...context(overrides),
  });
}

function buildDraft(overrides = {}) {
  const result = apply(null, draftEvent(), overrides);
  assert.equal(result.ok, true);
  return result.review;
}

function buildHumanConfirmed(overrides = {}) {
  const draft = buildDraft(overrides);
  const result = apply(draft, humanConfirmedEvent(), overrides);
  assert.equal(result.ok, true);
  return result.review;
}

function buildCorroborated(overrides = {}) {
  const humanConfirmed = buildHumanConfirmed(overrides);
  const result = apply(humanConfirmed, corroborationEvent("supports"), overrides);
  assert.equal(result.ok, true);
  return result.review;
}

function assertDecisionUnchanged(result, expected) {
  assert.deepEqual(result.decision, expected);
  assert.equal(result.decision.strictExecutable, false);
  assert.deepEqual(result.decision.permission, expected.permission);
  assert.equal(result.decision.opportunityCount, expected.opportunityCount);
  assert.equal(result.decision.opportunities.length, expected.opportunities.length);
}

test("draft can save a human theme proposal without manufacturing evidence or eligibility", () => {
  const expectedDecision = decisionSnapshot();
  const result = apply(null, draftEvent(), { decision: expectedDecision });

  assert.equal(result.ok, true);
  assert.equal(result.review.contractVersion, CONTRACT_VERSION);
  assert.equal(result.review.reviewId, REVIEW_ID);
  assert.equal(result.review.stockCode, STOCK_CODE);
  assert.equal(result.review.revision, 1);
  assert.equal(result.review.status, "draft");
  assert.equal(result.review.selectionEligible, false);
  assert.deepEqual(result.review.baseGeneration, BASE_GENERATION);
  assert.deepEqual(result.review.attribution, {
    parentTheme: "算力租赁",
    fineTheme: "CPO/光模块",
    note: "人工提出的细分题材，尚未交叉验证",
  });
  assert.deepEqual(result.review.evidence, []);
  assert.equal(result.review.integrity.baseGenerationCurrent, true);
  assert.equal(result.review.integrity.humanInputAdvisoryOnly, true);
  assertDecisionUnchanged(result, expectedDecision);
});

test("human confirmation remains advisory and cannot enter selection before corroboration", () => {
  const draft = buildDraft();
  const result = apply(draft, humanConfirmedEvent());

  assert.equal(result.ok, true);
  assert.equal(result.review.revision, 2);
  assert.equal(result.review.status, "human_confirmed_advisory");
  assert.equal(result.review.selectionEligible, false);
  assert.equal(result.review.humanConfirmation.confirmedBy, "local-user");
  assert.deepEqual(result.review.evidence, []);
  assert.ok(result.review.reasonCodes.includes("independent_corroboration_required"));
});

test("only matching verified independent corroboration makes the attribution selection-eligible", () => {
  const humanConfirmed = buildHumanConfirmed();
  const result = apply(humanConfirmed, corroborationEvent("supports"));

  assert.equal(result.ok, true);
  assert.equal(result.review.revision, 3);
  assert.equal(result.review.status, "corroborated");
  assert.equal(result.review.selectionEligible, true);
  assert.equal(result.review.evidence.length, 1);
  assert.equal(result.review.evidence[0].verified, true);
  assert.equal(result.review.evidence[0].independent, true);
  assert.equal(result.review.evidence[0].fineTheme, "CPO/光模块");
  assert.equal(result.review.integrity.baseGenerationCurrent, true);
});

test("verified contradictory evidence fails closed even after prior corroboration", () => {
  const corroborated = buildCorroborated();
  const conflictingEvent = event("corroboration_recorded", 3, {
    eventId: "theme-review-event-corroboration-conflict",
    payload: {
      verdict: "conflicts",
      evidence: {
        evidenceId: "independent-evidence-conflict",
        sourceKind: "verified_theme_board",
        sourceRef: "theme-board:第三代半导体:2026-08-14-close",
        observedAt: "2026-08-14T15:52:00.000Z",
        verified: true,
        independent: true,
        parentTheme: "半导体",
        fineTheme: "第三代半导体",
      },
    },
  });
  const result = apply(corroborated, conflictingEvent);

  assert.equal(result.ok, true);
  assert.equal(result.review.status, "conflicted");
  assert.equal(result.review.selectionEligible, false);
  assert.equal(result.review.integrity.conflict, true);
  assert.ok(result.review.reasonCodes.includes("attribution_evidence_conflict"));
});

test("withdrawn and expired reviews are terminally ineligible", async (t) => {
  for (const scenario of [
    { type: "review_withdrawn", status: "withdrawn", reason: "人工撤销错误归属" },
    { type: "review_expired", status: "expired", reason: "当前题材周期已经结束" },
  ]) {
    await t.test(scenario.status, () => {
      const corroborated = buildCorroborated();
      const terminalEvent = event(scenario.type, 3, {
        eventId: `theme-review-event-${scenario.status}`,
        payload: { reason: scenario.reason },
      });
      const result = apply(corroborated, terminalEvent);
      assert.equal(result.ok, true);
      assert.equal(result.review.status, scenario.status);
      assert.equal(result.review.selectionEligible, false);
      assert.equal(result.review.terminalReason, scenario.reason);
    });
  }
});

test("expectedRevision conflict rejects the append without mutating prior state", () => {
  const draft = buildDraft();
  const staleWriterEvent = event("human_confirmed", 0, {
    eventId: "theme-review-event-stale-writer",
    payload: { confirmation: { confirmedBy: "stale-writer" } },
  });
  const expectedDecision = decisionSnapshot();
  const before = structuredClone(draft);
  const result = apply(draft, staleWriterEvent, { decision: expectedDecision });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "theme_review_revision_conflict");
  assert.equal(result.error.expectedRevision, 0);
  assert.equal(result.error.actualRevision, 1);
  assert.deepEqual(result.review, before);
  assert.equal(result.review.events.length, 1);
  assertDecisionUnchanged(result, expectedDecision);
});

test("corroborated attribution becomes ineligible when its base generation is stale", () => {
  const corroborated = buildCorroborated();
  const replayThemeAttributionReviewEvents = requireApi("replayThemeAttributionReviewEvents");
  const result = replayThemeAttributionReviewEvents({
    events: corroborated.events,
    ...context({ currentGeneration: { ...NEXT_GENERATION } }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.review.status, "corroborated");
  assert.equal(result.review.integrity.baseGenerationCurrent, false);
  assert.equal(result.review.selectionEligible, false);
  assert.ok(result.review.reasonCodes.includes("base_generation_stale"));
});

test("manual payload cannot change strict execution, permission, or opportunity quantity", () => {
  const expectedDecision = decisionSnapshot();
  const humanConfirmed = buildHumanConfirmed({ decision: expectedDecision });
  const hostilePayload = corroborationEvent("supports", {
    payload: {
      verdict: "supports",
      evidence: {
        evidenceId: "independent-evidence-hostile-payload",
        sourceKind: "verified_theme_board",
        sourceRef: "theme-board:CPO/光模块:2026-08-14-close",
        observedAt: "2026-08-14T15:52:00.000Z",
        verified: true,
        independent: true,
        parentTheme: "算力租赁",
        fineTheme: "CPO/光模块",
      },
      strictExecutable: true,
      permission: { status: "open", allowNew: true, maxPositionPct: 100 },
      opportunityCount: 999,
      opportunities: [{ code: STOCK_CODE, state: "executable" }],
    },
  });
  const result = apply(humanConfirmed, hostilePayload, { decision: expectedDecision });

  assert.equal(result.ok, true);
  assert.equal(result.review.selectionEligible, true, "题材归属可进入筛选，不等于取得交易权限");
  assertDecisionUnchanged(result, expectedDecision);
  assert.equal(result.review.strictExecutable, undefined);
  assert.equal(result.review.permission, undefined);
  assert.equal(result.review.opportunityCount, undefined);
});

test("append-only event replay is deterministic and duplicate event ids are idempotent", () => {
  const events = [draftEvent(), humanConfirmedEvent(), corroborationEvent("supports")];
  const replayThemeAttributionReviewEvents = requireApi("replayThemeAttributionReviewEvents");
  const expectedDecision = decisionSnapshot();
  const first = replayThemeAttributionReviewEvents({
    events,
    ...context({ decision: expectedDecision }),
  });
  const replayed = replayThemeAttributionReviewEvents({
    events: [...events, structuredClone(events[2])],
    ...context({ decision: expectedDecision }),
  });

  assert.equal(first.ok, true);
  assert.equal(replayed.ok, true);
  assert.deepEqual(replayed.review, first.review);
  assert.equal(replayed.review.revision, 3);
  assert.equal(replayed.review.events.length, 3);
  assert.equal(new Set(replayed.review.events.map((row) => row.eventId)).size, 3);
  assertDecisionUnchanged(replayed, expectedDecision);

  const duplicateAppend = apply(first.review, structuredClone(events[2]), { decision: expectedDecision });
  assert.equal(duplicateAppend.ok, true);
  assert.deepEqual(duplicateAppend.review, first.review);
  assertDecisionUnchanged(duplicateAppend, expectedDecision);
});
