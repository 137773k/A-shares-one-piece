"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const THEME_ATTRIBUTION_REVIEW_CONTRACT_VERSION = 1;
const TERMINAL_STATUSES = new Set(["withdrawn", "expired"]);

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function generationOf(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    generationId: clean(source.generationId),
    tradingDate: clean(source.tradingDate),
    asOf: clean(source.asOf),
  };
}

function sameGeneration(left, right) {
  const a = generationOf(left);
  const b = generationOf(right);
  return Boolean(a.generationId && a.tradingDate && a.asOf)
    && a.generationId === b.generationId
    && a.tradingDate === b.tradingDate
    && a.asOf === b.asOf;
}

function attributionOf(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    parentTheme: clean(source.parentTheme),
    fineTheme: clean(source.fineTheme),
    note: clean(source.note),
  };
}

function evidenceOf(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    evidenceId: clean(source.evidenceId),
    sourceKind: clean(source.sourceKind),
    sourceRef: clean(source.sourceRef),
    observedAt: clean(source.observedAt),
    verified: source.verified === true,
    independent: source.independent === true,
    parentTheme: clean(source.parentTheme),
    fineTheme: clean(source.fineTheme),
  };
}

function normalizedEvent(input) {
  const event = input && typeof input === "object" ? input : {};
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  const normalized = {
    eventId: clean(event.eventId),
    reviewId: clean(event.reviewId),
    stockCode: clean(event.stockCode),
    type: clean(event.type),
    expectedRevision: Number(event.expectedRevision),
    occurredAt: clean(event.occurredAt),
    actor: clone(event.actor && typeof event.actor === "object" ? event.actor : {}),
    payload: {},
  };

  if (normalized.type === "draft_saved") {
    normalized.payload = {
      attribution: attributionOf(payload.attribution),
      baseGeneration: generationOf(payload.baseGeneration),
    };
  } else if (normalized.type === "human_confirmed") {
    normalized.payload = {
      confirmation: clone(payload.confirmation && typeof payload.confirmation === "object" ? payload.confirmation : {}),
    };
  } else if (normalized.type === "corroboration_recorded") {
    normalized.payload = {
      verdict: clean(payload.verdict),
      evidence: evidenceOf(payload.evidence),
    };
  } else if (normalized.type === "review_withdrawn" || normalized.type === "review_expired") {
    normalized.payload = { reason: clean(payload.reason) };
  }
  return normalized;
}

function eventIsValid(event) {
  return Boolean(
    event.eventId
    && event.reviewId
    && event.stockCode
    && event.occurredAt
    && Number.isInteger(event.expectedRevision)
    && event.expectedRevision >= 0
    && [
      "draft_saved",
      "human_confirmed",
      "corroboration_recorded",
      "review_withdrawn",
      "review_expired",
    ].includes(event.type),
  );
}

function matchingSupportEvidence(review, row) {
  const evidence = evidenceOf(row);
  const attribution = attributionOf(review && review.attribution);
  return verifiedIndependentEvidence(evidence)
    && evidence.parentTheme === attribution.parentTheme
    && evidence.fineTheme === attribution.fineTheme;
}

function verifiedIndependentEvidence(row) {
  const evidence = evidenceOf(row);
  return evidence.verified === true
    && evidence.independent === true
    && Boolean(evidence.evidenceId && evidence.sourceKind && evidence.sourceRef);
}

function reasonCodesFor(review, currentGeneration) {
  const reasons = [];
  const evidence = Array.isArray(review && review.evidence) ? review.evidence : [];
  const hasMatchingSupport = evidence.some((row) => row.verdict === "supports" && matchingSupportEvidence(review, row));
  const baseGenerationCurrent = sameGeneration(review && review.baseGeneration, currentGeneration);
  if (["draft", "human_confirmed_advisory"].includes(clean(review && review.status)) || !hasMatchingSupport) {
    reasons.push("independent_corroboration_required");
  }
  if (clean(review && review.status) === "conflicted") reasons.push("attribution_evidence_conflict");
  if (clean(review && review.status) === "withdrawn") reasons.push("review_withdrawn");
  if (clean(review && review.status) === "expired") reasons.push("review_expired");
  if (!baseGenerationCurrent) reasons.push("base_generation_stale");
  return Array.from(new Set(reasons));
}

function projectReview(input, currentGeneration) {
  if (!input) return null;
  const review = clone(input);
  const evidence = Array.isArray(review.evidence) ? review.evidence : [];
  const baseGenerationCurrent = sameGeneration(review.baseGeneration, currentGeneration);
  const conflict = review.status === "conflicted";
  const hasMatchingSupport = evidence.some((row) => row.verdict === "supports" && matchingSupportEvidence(review, row));
  review.integrity = {
    baseGenerationCurrent,
    humanInputAdvisoryOnly: true,
    conflict,
  };
  review.selectionEligible = review.status === "corroborated"
    && hasMatchingSupport
    && baseGenerationCurrent
    && !conflict;
  review.reasonCodes = reasonCodesFor(review, currentGeneration);
  return review;
}

function failure(code, previousReview, decision, details = {}) {
  return {
    ok: false,
    error: { code, ...details },
    review: previousReview || null,
    decision,
  };
}

function applyThemeAttributionReviewEvent(options = {}) {
  const previousReview = options.previousReview && typeof options.previousReview === "object"
    ? options.previousReview
    : null;
  const decision = options.decision;
  const event = normalizedEvent(options.event);
  const currentGeneration = generationOf(options.currentGeneration);

  if (!eventIsValid(event)) {
    return failure("theme_review_event_invalid", previousReview, decision);
  }

  const priorEvents = previousReview && Array.isArray(previousReview.events)
    ? previousReview.events
    : [];
  const duplicate = priorEvents.find((row) => clean(row && row.eventId) === event.eventId);
  if (duplicate) {
    if (JSON.stringify(duplicate) !== JSON.stringify(event)) {
      return failure("theme_review_event_id_conflict", previousReview, decision, { eventId: event.eventId });
    }
    return {
      ok: true,
      review: projectReview(previousReview, currentGeneration),
      decision,
    };
  }

  const actualRevision = Number(previousReview && previousReview.revision || 0);
  if (event.expectedRevision !== actualRevision) {
    return failure("theme_review_revision_conflict", previousReview, decision, {
      expectedRevision: event.expectedRevision,
      actualRevision,
    });
  }

  if (!previousReview && event.type !== "draft_saved") {
    return failure("theme_review_draft_required", null, decision);
  }
  if (previousReview && (
    clean(previousReview.reviewId) !== event.reviewId
    || clean(previousReview.stockCode) !== event.stockCode
  )) {
    return failure("theme_review_aggregate_mismatch", previousReview, decision);
  }
  if (previousReview && event.type === "draft_saved") {
    return failure("theme_review_draft_already_exists", previousReview, decision);
  }

  let next;
  if (!previousReview) {
    const baseGeneration = generationOf(event.payload.baseGeneration);
    const attribution = attributionOf(event.payload.attribution);
    if (!baseGeneration.generationId || !baseGeneration.tradingDate || !baseGeneration.asOf
      || !attribution.parentTheme || !attribution.fineTheme) {
      return failure("theme_review_draft_invalid", null, decision);
    }
    next = {
      contractVersion: THEME_ATTRIBUTION_REVIEW_CONTRACT_VERSION,
      reviewId: event.reviewId,
      stockCode: event.stockCode,
      revision: 1,
      status: "draft",
      baseGeneration,
      attribution,
      humanConfirmation: null,
      evidence: [],
      terminalReason: null,
      createdAt: event.occurredAt,
      updatedAt: event.occurredAt,
      events: [event],
    };
  } else {
    next = clone(previousReview);
    next.revision = actualRevision + 1;
    next.updatedAt = event.occurredAt;
    next.events = [...priorEvents.map(clone), event];
    next.evidence = Array.isArray(next.evidence) ? next.evidence : [];

    if (event.type === "review_withdrawn") {
      next.status = "withdrawn";
      next.terminalReason = event.payload.reason;
    } else if (event.type === "review_expired") {
      next.status = "expired";
      next.terminalReason = event.payload.reason;
    } else if (!TERMINAL_STATUSES.has(next.status) && next.status !== "conflicted") {
      if (event.type === "human_confirmed") {
        const confirmation = clone(event.payload.confirmation);
        if (clean(confirmation.confirmedBy) && clean(confirmation.confirmedAt)) {
          next.humanConfirmation = confirmation;
          if (next.status !== "corroborated") next.status = "human_confirmed_advisory";
        }
      } else if (event.type === "corroboration_recorded") {
        const row = { ...event.payload.evidence, verdict: event.payload.verdict };
        if (!next.evidence.some((entry) => clean(entry && entry.evidenceId) === row.evidenceId)) {
          next.evidence.push(row);
        }
        const independentlyVerified = verifiedIndependentEvidence(row);
        if (event.payload.verdict === "conflicts" && independentlyVerified) {
          next.status = "conflicted";
        } else if (event.payload.verdict === "supports"
          && matchingSupportEvidence(next, row)
          && next.humanConfirmation) {
          next.status = "corroborated";
        }
      }
    }
  }

  return {
    ok: true,
    review: projectReview(next, currentGeneration),
    decision,
  };
}

function replayThemeAttributionReviewEvents(options = {}) {
  const events = Array.isArray(options.events) ? options.events : [];
  let review = null;
  for (const event of events) {
    const result = applyThemeAttributionReviewEvent({
      previousReview: review,
      event,
      currentGeneration: options.currentGeneration,
      decision: options.decision,
      now: options.now,
    });
    if (!result.ok) return result;
    review = result.review;
  }
  return {
    ok: true,
    review: projectReview(review, options.currentGeneration),
    decision: options.decision,
  };
}

function loadThemeAttributionReviewEvents(file) {
  if (!file || !fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.trim()) return [];
  return raw.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      const event = JSON.parse(line);
      if (!eventIsValid(normalizedEvent(event))) throw new Error("invalid event");
      return event;
    } catch (error) {
      const wrapped = new Error(`theme review log is corrupt at line ${index + 1}`);
      wrapped.code = "theme_review_log_corrupt";
      throw wrapped;
    }
  });
}

function appendThemeAttributionReviewEvent(file, event) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const handle = fs.openSync(file, "a");
  try {
    fs.writeSync(handle, `${JSON.stringify(event)}\n`, null, "utf8");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function reviewsFromEvents(events, currentGeneration, decision) {
  const groups = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const reviewId = clean(event && event.reviewId);
    if (!reviewId) continue;
    if (!groups.has(reviewId)) groups.set(reviewId, []);
    groups.get(reviewId).push(event);
  }
  return Array.from(groups.values()).map((rows) => replayThemeAttributionReviewEvents({
    events: rows,
    currentGeneration,
    decision,
  })).map((result) => {
    if (!result.ok) {
      const error = new Error(result.error && result.error.code || "theme review replay failed");
      error.code = result.error && result.error.code || "theme_review_replay_failed";
      throw error;
    }
    return result.review;
  }).filter(Boolean);
}

function readJsonBody(request, limit = 32768) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw, "utf8") > limit) {
        const error = new Error("request body too large");
        error.code = "theme_review_body_too_large";
        reject(error);
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        const error = new Error("invalid JSON body");
        error.code = "theme_review_invalid_json";
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function isLoopbackAddress(value) {
  const address = clean(value).toLowerCase();
  return address === "127.0.0.1"
    || address === "::1"
    || address === "localhost"
    || address.startsWith("::ffff:127.");
}

function reviewIdForGeneration(stockCode, generation) {
  const normalized = generationOf(generation);
  const fingerprint = crypto.createHash("sha256")
    .update(`${normalized.generationId}|${normalized.tradingDate}|${normalized.asOf}`)
    .digest("hex")
    .slice(0, 16);
  return `theme-review-${stockCode}-${normalized.tradingDate.replace(/-/g, "")}-${fingerprint}`;
}

function safeInputText(value, maxLength) {
  return clean(value).normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").slice(0, maxLength);
}

function handlerError(send, response, status, code, details = {}) {
  send(response, status, { ok: false, error: { code, ...details } });
}

function createThemeAttributionReviewHandler(options = {}) {
  const runtimeRoot = path.resolve(process.env.A_SHARE_RUNTIME_DIR || __dirname);
  const file = options.file || path.join(runtimeRoot, "data", "theme-attribution-review.ndjson");
  const loadCurrentContext = typeof options.loadCurrentContext === "function"
    ? options.loadCurrentContext
    : () => ({ currentGeneration: {}, decision: null, candidates: [] });
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const isTrustedWriteRequest = typeof options.isTrustedWriteRequest === "function"
    ? options.isTrustedWriteRequest
    : () => false;
  const send = options.sendJson || ((response, status, payload) => {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(payload));
  });

  return async function themeAttributionReviewHandler(request, response, pathname) {
    if (pathname !== "/api/theme-attribution-reviews") return false;
    let context;
    try {
      context = await loadCurrentContext();
    } catch (error) {
      handlerError(send, response, 503, "theme_review_context_unavailable", { message: clean(error && error.message) });
      return true;
    }
    const currentGeneration = generationOf(context && context.currentGeneration);
    const decision = context && context.decision;
    const candidates = Array.isArray(context && context.candidates) ? context.candidates : [];

    if (request.method === "GET") {
      try {
        const query = new URL(request.url || pathname, "http://localhost").searchParams;
        const stockCode = clean(query.get("stockCode"));
        const reviews = reviewsFromEvents(loadThemeAttributionReviewEvents(file), currentGeneration, decision)
          .filter((review) => !stockCode || review.stockCode === stockCode);
        send(response, 200, {
          ok: true,
          authority: "human_proposal_only",
          affectsTradingPermission: false,
          currentGeneration,
          reviews,
        });
      } catch (error) {
        handlerError(send, response, 500, error.code || "theme_review_read_failed");
      }
      return true;
    }

    if (request.method !== "POST") {
      handlerError(send, response, 405, "theme_review_method_not_allowed");
      return true;
    }
    let trustedWrite = false;
    try {
      trustedWrite = isTrustedWriteRequest(request) === true;
    } catch {
      trustedWrite = false;
    }
    if (!isLoopbackAddress(request.socket && request.socket.remoteAddress) && !trustedWrite) {
      handlerError(send, response, 403, "theme_review_local_only");
      return true;
    }
    if (!/application\/json/i.test(clean(request.headers && request.headers["content-type"]))) {
      handlerError(send, response, 415, "theme_review_json_required");
      return true;
    }

    try {
      const body = await readJsonBody(request);
      const allowed = new Set([
        "action", "requestId", "expectedRevision", "stockCode",
        "generationId", "tradingDate", "asOf", "parentTheme", "fineTheme",
        "inputMode", "evidenceNote", "reason",
      ]);
      const forbidden = Object.keys(body || {}).find((key) => !allowed.has(key));
      if (forbidden) {
        handlerError(send, response, 400, "theme_review_forbidden_field", { field: forbidden });
        return true;
      }
      const action = safeInputText(body.action, 24);
      const requestId = safeInputText(body.requestId, 128);
      const stockCode = safeInputText(body.stockCode, 12);
      const expectedRevision = Number(body.expectedRevision);
      const suppliedGeneration = generationOf(body);
      if (!["propose", "confirm", "withdraw"].includes(action)
        || !requestId
        || !/^\d{6}$/.test(stockCode)
        || !Number.isInteger(expectedRevision)
        || expectedRevision < 0) {
        handlerError(send, response, 400, "theme_review_request_invalid");
        return true;
      }
      if (!sameGeneration(suppliedGeneration, currentGeneration)) {
        handlerError(send, response, 409, "base_generation_stale", { currentGeneration });
        return true;
      }
      const candidate = candidates.find((row) => clean(row && (row.code || row.secCode || row.stockCode)) === stockCode);
      if (!candidate) {
        handlerError(send, response, 404, "theme_review_stock_not_in_generation");
        return true;
      }

      const events = loadThemeAttributionReviewEvents(file);
      const reviewId = reviewIdForGeneration(stockCode, currentGeneration);
      const reviewEvents = events.filter((row) => clean(row && row.reviewId) === reviewId);
      const replay = replayThemeAttributionReviewEvents({ events: reviewEvents, currentGeneration, decision });
      if (!replay.ok) {
        handlerError(send, response, 409, replay.error.code, replay.error);
        return true;
      }
      const existingEvent = events.find((row) => clean(row && row.eventId) === requestId);
      const occurredAt = existingEvent ? clean(existingEvent.occurredAt) : clean(now());
      const common = {
        eventId: requestId,
        reviewId,
        stockCode,
        expectedRevision,
        occurredAt,
        actor: { type: "human", id: "local-user" },
      };
      let event;
      if (action === "propose") {
        const parentTheme = safeInputText(body.parentTheme, 80);
        const fineTheme = safeInputText(body.fineTheme, 80);
        const note = safeInputText(body.evidenceNote, 500);
        if (!parentTheme || !fineTheme) {
          handlerError(send, response, 400, "theme_review_attribution_required");
          return true;
        }
        const inputMode = safeInputText(body.inputMode, 16);
        const candidateTags = Array.from(new Set((Array.isArray(candidate.concepts) ? candidate.concepts : [])
          .map((value) => safeInputText(value, 80)).filter(Boolean)));
        if (inputMode === "candidate" && !candidateTags.includes(fineTheme)) {
          handlerError(send, response, 400, "theme_review_candidate_tag_mismatch");
          return true;
        }
        event = {
          ...common,
          type: "draft_saved",
          payload: {
            attribution: { parentTheme, fineTheme, note },
            baseGeneration: currentGeneration,
          },
        };
      } else if (action === "confirm") {
        event = {
          ...common,
          type: "human_confirmed",
          payload: {
            confirmation: {
              confirmedBy: "local-user",
              confirmedAt: occurredAt,
              statement: "人工确认该题材归属提案，等待独立证据交叉验证。",
            },
          },
        };
      } else {
        event = {
          ...common,
          type: "review_withdrawn",
          payload: { reason: safeInputText(body.reason, 300) || "人工撤销题材归属提案" },
        };
      }

      const result = applyThemeAttributionReviewEvent({
        previousReview: replay.review,
        event,
        currentGeneration,
        decision,
        now: occurredAt,
      });
      if (!result.ok) {
        const conflictCodes = new Set([
          "theme_review_revision_conflict",
          "theme_review_event_id_conflict",
          "theme_review_aggregate_mismatch",
          "theme_review_draft_already_exists",
        ]);
        handlerError(send, response, conflictCodes.has(result.error.code) ? 409 : 400, result.error.code, result.error);
        return true;
      }
      const duplicate = Boolean(existingEvent);
      if (!duplicate) appendThemeAttributionReviewEvent(file, normalizedEvent(event));
      send(response, duplicate ? 200 : 201, {
        ok: true,
        authority: "human_proposal_only",
        affectsTradingPermission: false,
        review: result.review,
        decision,
      });
    } catch (error) {
      handlerError(send, response, error.code === "theme_review_body_too_large" ? 413 : 400, error.code || "theme_review_write_failed");
    }
    return true;
  };
}

module.exports = {
  THEME_ATTRIBUTION_REVIEW_CONTRACT_VERSION,
  applyThemeAttributionReviewEvent,
  replayThemeAttributionReviewEvents,
  loadThemeAttributionReviewEvents,
  appendThemeAttributionReviewEvent,
  createThemeAttributionReviewHandler,
};
