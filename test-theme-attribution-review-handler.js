"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");

const {
  createThemeAttributionReviewHandler,
  loadThemeAttributionReviewEvents,
  appendThemeAttributionReviewEvent,
} = require("./theme-attribution-review");

const GENERATION = Object.freeze({
  generationId: "2026-08-15:2026-08-15T15:10:00.000Z",
  tradingDate: "2026-08-15",
  asOf: "2026-08-15T15:10:00.000Z",
});

const REFRESHED_GENERATION = Object.freeze({
  generationId: "2026-08-15:2026-08-15T15:30:00.000Z",
  tradingDate: "2026-08-15",
  asOf: "2026-08-15T15:30:00.000Z",
});

function currentContext(generation = GENERATION) {
  return {
    currentGeneration: { ...generation },
    decision: {
      strictExecutable: false,
      permission: { status: "blocked", allowNew: false },
      opportunityCount: 0,
      opportunities: [],
    },
    candidates: [{
      code: "002428",
      name: "匿名样本",
      concepts: ["光纤概念", "第三代半导体"],
      themeAttribution: { verified: false, selectionEligible: false },
    }],
  };
}

function makeHandler(file, overrides = {}) {
  return createThemeAttributionReviewHandler({
    file,
    loadCurrentContext: currentContext,
    now: () => "2026-08-15T15:20:00.000Z",
    ...overrides,
  });
}

async function invoke(handler, {
  method = "GET",
  url = "/api/theme-attribution-reviews",
  body,
  remoteAddress = "127.0.0.1",
  trustedWrite = false,
} = {}) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const request = Readable.from(raw ? [raw] : []);
  request.method = method;
  request.url = url;
  request.headers = raw ? { "content-type": "application/json" } : {};
  request.socket = { remoteAddress };
  request.themeReviewWriteAuthorized = trustedWrite;
  const result = { status: 0, headers: {}, body: null };
  const response = {
    writeHead(status, headers) {
      result.status = status;
      result.headers = headers || {};
    },
    end(value) {
      result.body = value ? JSON.parse(String(value)) : null;
    },
  };
  const handled = await handler(request, response, new URL(url, "http://localhost").pathname);
  assert.equal(handled, true);
  return result;
}

function proposal(overrides = {}) {
  return {
    action: "propose",
    requestId: "review-request-1",
    expectedRevision: 0,
    stockCode: "002428",
    generationId: GENERATION.generationId,
    tradingDate: GENERATION.tradingDate,
    asOf: GENERATION.asOf,
    parentTheme: "AI算力",
    fineTheme: "光纤概念",
    evidenceNote: "用户根据公司业务与当日炒作方向提出，等待独立数据核实",
    ...overrides,
  };
}

test("本地API把人工题材提案追加到独立审计日志，不改交易决策", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-review-handler-"));
  const file = path.join(dir, "theme-attribution-review.ndjson");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const handler = makeHandler(file);

  const created = await invoke(handler, { method: "POST", body: proposal() });
  assert.equal(created.status, 201);
  assert.equal(created.body.ok, true);
  assert.equal(created.body.review.status, "draft");
  assert.equal(created.body.review.revision, 1);
  assert.equal(created.body.review.selectionEligible, false);
  assert.equal(created.body.authority, "human_proposal_only");
  assert.equal(created.body.affectsTradingPermission, false);
  assert.deepEqual(created.body.decision, currentContext().decision);
  assert.equal(loadThemeAttributionReviewEvents(file).length, 1);

  const listed = await invoke(handler, {
    url: "/api/theme-attribution-reviews?stockCode=002428",
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.reviews.length, 1);
  assert.equal(listed.body.reviews[0].attribution.fineTheme, "光纤概念");
  assert.equal(listed.body.reviews[0].integrity.humanInputAdvisoryOnly, true);
});

test("重复requestId幂等，旧revision或同ID不同内容返回409且不追加", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-review-idempotent-"));
  const file = path.join(dir, "theme-attribution-review.ndjson");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const handler = makeHandler(file);

  assert.equal((await invoke(handler, { method: "POST", body: proposal() })).status, 201);
  assert.equal((await invoke(handler, { method: "POST", body: proposal() })).status, 200);
  assert.equal(loadThemeAttributionReviewEvents(file).length, 1);

  const conflictingId = await invoke(handler, {
    method: "POST",
    body: proposal({ fineTheme: "第三代半导体" }),
  });
  assert.equal(conflictingId.status, 409);
  assert.equal(conflictingId.body.error.code, "theme_review_event_id_conflict");

  const stale = await invoke(handler, {
    method: "POST",
    body: proposal({ requestId: "review-request-stale", fineTheme: "第三代半导体" }),
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "theme_review_revision_conflict");
  assert.equal(loadThemeAttributionReviewEvents(file).length, 1);
});

test("写接口拒绝错代、未知股票、越权字段、非本机连接与伪造系统佐证", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-review-guard-"));
  const file = path.join(dir, "theme-attribution-review.ndjson");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const handler = makeHandler(file);

  const stale = await invoke(handler, {
    method: "POST",
    body: proposal({ generationId: "2026-08-14:old" }),
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "base_generation_stale");

  const missing = await invoke(handler, {
    method: "POST",
    body: proposal({ stockCode: "600000", requestId: "missing-stock" }),
  });
  assert.equal(missing.status, 404);

  const hostile = await invoke(handler, {
    method: "POST",
    body: proposal({ strictExecutable: true, permission: { allowNew: true } }),
  });
  assert.equal(hostile.status, 400);
  assert.equal(hostile.body.error.code, "theme_review_forbidden_field");

  const fakeEvidence = await invoke(handler, {
    method: "POST",
    body: proposal({ evidence: { verified: true, independent: true } }),
  });
  assert.equal(fakeEvidence.status, 400);

  const remote = await invoke(handler, {
    method: "POST",
    remoteAddress: "192.168.1.20",
    body: proposal(),
  });
  assert.equal(remote.status, 403);
  assert.equal(loadThemeAttributionReviewEvents(file).length, 0);
});

test("候选标签可选择，自定义题材可保存但始终保持待交叉验证", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-review-custom-"));
  const file = path.join(dir, "theme-attribution-review.ndjson");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const handler = makeHandler(file);

  const custom = await invoke(handler, {
    method: "POST",
    body: proposal({
      requestId: "custom-theme",
      inputMode: "custom",
      parentTheme: "半导体",
      fineTheme: "先进封装",
    }),
  });
  assert.equal(custom.status, 201);
  assert.equal(custom.body.review.attribution.fineTheme, "先进封装");
  assert.equal(custom.body.review.selectionEligible, false);
  assert.ok(custom.body.review.reasonCodes.includes("independent_corroboration_required"));
});

test("已通过手机服务端鉴权的非loopback请求可写，未认证远程请求仍拒绝", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-review-mobile-auth-"));
  const file = path.join(dir, "theme-attribution-review.ndjson");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const handler = makeHandler(file, {
    // 最小可信边界：由外层 mobileAuth 验证会话后提供；handler 不解析或信任客户端自报字段。
    isTrustedWriteRequest: (request) => request.themeReviewWriteAuthorized === true,
  });

  const unauthenticated = await invoke(handler, {
    method: "POST",
    remoteAddress: "192.168.1.20",
    body: proposal({ requestId: "remote-unauthenticated" }),
  });
  assert.equal(unauthenticated.status, 403);
  assert.equal(loadThemeAttributionReviewEvents(file).length, 0);

  const authenticated = await invoke(handler, {
    method: "POST",
    remoteAddress: "192.168.1.20",
    trustedWrite: true,
    body: proposal({ requestId: "remote-authenticated" }),
  });
  assert.equal(authenticated.status, 201, authenticated.body && authenticated.body.error && authenticated.body.error.code);
  assert.equal(authenticated.body.review.status, "draft");
  assert.equal(authenticated.body.affectsTradingPermission, false);
  assert.equal(loadThemeAttributionReviewEvents(file).length, 1);
});

test("同股票同交易日刷新generation后可开启新复核周期，旧审计保留且资格不跨代", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-review-generation-refresh-"));
  const file = path.join(dir, "theme-attribution-review.ndjson");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let activeGeneration = GENERATION;
  const handler = makeHandler(file, {
    loadCurrentContext: () => currentContext(activeGeneration),
  });

  const first = await invoke(handler, { method: "POST", body: proposal({ requestId: "generation-one-draft" }) });
  assert.equal(first.status, 201);
  const oldReviewId = first.body.review.reviewId;
  const confirmed = await invoke(handler, {
    method: "POST",
    body: proposal({
      action: "confirm",
      requestId: "generation-one-confirm",
      expectedRevision: 1,
    }),
  });
  assert.equal(confirmed.status, 201);
  appendThemeAttributionReviewEvent(file, {
    eventId: "generation-one-system-support",
    reviewId: oldReviewId,
    stockCode: "002428",
    type: "corroboration_recorded",
    expectedRevision: 2,
    occurredAt: "2026-08-15T15:21:00.000Z",
    actor: { type: "system", id: "theme-library" },
    payload: {
      verdict: "supports",
      evidence: {
        evidenceId: "theme-library-002428-generation-one",
        sourceKind: "theme-library",
        sourceRef: "theme-library://2026-08-15/002428",
        observedAt: "2026-08-15T15:21:00.000Z",
        verified: true,
        independent: true,
        parentTheme: "AI算力",
        fineTheme: "光纤概念",
      },
    },
  });

  const beforeRefresh = await invoke(handler, { url: "/api/theme-attribution-reviews?stockCode=002428" });
  assert.equal(beforeRefresh.body.reviews[0].selectionEligible, true);

  activeGeneration = REFRESHED_GENERATION;
  const staleListing = await invoke(handler, { url: "/api/theme-attribution-reviews?stockCode=002428" });
  assert.equal(staleListing.body.reviews[0].selectionEligible, false, "旧代资格不得跨代沿用");
  assert.ok(staleListing.body.reviews[0].reasonCodes.includes("base_generation_stale"));

  const reopened = await invoke(handler, {
    method: "POST",
    body: proposal({
      requestId: "generation-two-draft",
      expectedRevision: 0,
      generationId: REFRESHED_GENERATION.generationId,
      tradingDate: REFRESHED_GENERATION.tradingDate,
      asOf: REFRESHED_GENERATION.asOf,
      fineTheme: "第三代半导体",
    }),
  });
  assert.equal(reopened.status, 201, reopened.body && reopened.body.error && reopened.body.error.code);
  assert.notEqual(reopened.body.review.reviewId, oldReviewId, "新generation必须使用新的复核周期");
  assert.equal(reopened.body.review.revision, 1);
  assert.deepEqual(reopened.body.review.baseGeneration, REFRESHED_GENERATION);
  assert.equal(reopened.body.review.selectionEligible, false);

  const afterRefresh = await invoke(handler, { url: "/api/theme-attribution-reviews?stockCode=002428" });
  assert.equal(afterRefresh.body.reviews.length, 2, "旧审计和新复核周期必须同时保留");
  const oldReview = afterRefresh.body.reviews.find((review) => review.reviewId === oldReviewId);
  const newReview = afterRefresh.body.reviews.find((review) => review.reviewId === reopened.body.review.reviewId);
  assert.equal(oldReview.selectionEligible, false);
  assert.ok(oldReview.reasonCodes.includes("base_generation_stale"));
  assert.equal(newReview.selectionEligible, false);
  assert.equal(loadThemeAttributionReviewEvents(file).length, 4);
});
