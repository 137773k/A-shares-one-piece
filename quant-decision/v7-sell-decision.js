"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { selectV7MinuteEvidenceFromCaches } = require("./outcome-evidence");
const { normalizeCode, normalizeTradingDate, securityIdentity } = require("./minute-evidence");
const {
  evaluateV7MinuteSell,
  V7_SELL_STRATEGY_AUTHORITY,
  V7_SELL_STRATEGY_VERSION,
  V7_SELL_STRATEGY_METHOD,
  v7StableSha256,
} = require("../sell-engine");

const V7_SELL_DECISION_ENTRY_VERSION = 1;
const V7_SELL_DECISION_ENTRY_AUTHORITY = "canonical_v7_sell_decision_entry_v1";
const V7_POSITION_CONTEXT_AUTHORITY = "canonical_position_state_context_v1";
const V7_DAILY_CONTEXT_AUTHORITY = "canonical_v7_daily_sell_context_v1";
const DEFAULT_CACHE_FILES = Object.freeze([
  "jqdata-minute-outcomes.json",
  "akshare-sina-1m-outcomes.json",
]);

function readMinuteCaches(root) {
  const dataDirectory = path.join(path.resolve(root), "data");
  const caches = [];
  const audit = [];
  for (const name of DEFAULT_CACHE_FILES) {
    const file = path.join(dataDirectory, name);
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      caches.push(value);
      audit.push({ name, status: "loaded" });
    } catch (error) {
      audit.push({
        name,
        status: error && error.code === "ENOENT" ? "missing" : "invalid",
      });
    }
  }
  return { caches, audit };
}

function contextAssessment(envelope, authority, tradingDate) {
  const source = envelope && typeof envelope === "object" ? envelope : {};
  const payload = source.payload && typeof source.payload === "object" ? source.payload : {};
  const timestamp = Date.parse(String(payload.sourceTimestamp || payload.asOf || "").replace(" ", "T") + (
    /(?:Z|[+-]\d{2}:?\d{2})$/.test(String(payload.sourceTimestamp || payload.asOf || "")) ? "" : "+08:00"
  ));
  const deadline = Date.parse(`${tradingDate}T14:55:00+08:00`);
  const security = securityIdentity(payload.securityId || payload.code);
  const valid = source.verified === true
    && source.authority === authority
    && source.executionAuthority === false
    && source.canonicalPayloadHash === v7StableSha256(payload)
    && normalizeTradingDate(payload.tradingDate) === tradingDate
    && security.code
    && security.exchangeConsistent
    && String(payload.generationId || "").trim().length > 0
    && /^[a-f0-9]{64}$/.test(String(payload.sourceDecisionHash || ""))
    && Number.isFinite(timestamp)
    && timestamp <= deadline;
  return { valid, payload };
}

function unavailableResult(blockers) {
  return {
    version: V7_SELL_STRATEGY_VERSION,
    authority: V7_SELL_STRATEGY_AUTHORITY,
    method: V7_SELL_STRATEGY_METHOD,
    status: "unavailable",
    executionAuthority: false,
    formalPerformanceEligible: false,
    authorityBindingStatus: "pending_validated_dataset_manifest_and_receipt_anchor",
    blockers,
    upperLayer: { status: "not_executed" },
    lowerLayer: { core1m: null, full1mTick: null, combineMetrics: false },
  };
}

function evaluateV7SellDecision(input = {}, options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  const loaded = Array.isArray(options.minuteCaches)
    ? { caches: options.minuteCaches, audit: [{ name: "injected_test_cache", status: "loaded" }] }
    : readMinuteCaches(root);
  const tradingDate = normalizeTradingDate(input.tradingDate);
  const positionAssessment = contextAssessment(
    input.positionContext,
    V7_POSITION_CONTEXT_AUTHORITY,
    tradingDate,
  );
  const dailyAssessment = contextAssessment(
    input.dailyContext,
    V7_DAILY_CONTEXT_AUTHORITY,
    tradingDate,
  );
  const position = positionAssessment.payload;
  const upperAssessment = contextAssessment(
    input.upperLayer,
    "canonical_sell_upper_context_v1",
    tradingDate,
  );
  const upperPayload = upperAssessment.payload;
  const code = normalizeCode(position.securityId || position.code);
  const positionSecurity = securityIdentity(position.securityId || position.code);
  const priceBasis = position.priceBasis && typeof position.priceBasis === "object"
    ? position.priceBasis : {};
  const pricePayload = priceBasis.payload && typeof priceBasis.payload === "object"
    ? priceBasis.payload : {};
  const priceSecurity = securityIdentity(pricePayload.securityId);
  const priceBasisAligned = priceBasis.verified === true
    && priceBasis.canonicalPayloadHash === v7StableSha256(pricePayload)
    && pricePayload.generationId === position.generationId
    && normalizeTradingDate(pricePayload.tradingDate) === tradingDate
    && positionSecurity.exchangeConsistent
    && priceSecurity.exchangeConsistent
    && positionSecurity.code === priceSecurity.code
    && positionSecurity.exchange === priceSecurity.exchange
    && /^[a-f0-9]{64}$/.test(String(pricePayload.sourceHash || ""));
  const identityAligned = positionAssessment.valid
    && dailyAssessment.valid
    && upperAssessment.valid
    && code === normalizeCode(dailyAssessment.payload.securityId || dailyAssessment.payload.code)
    && code === normalizeCode(upperPayload.securityId || upperPayload.code)
    && position.generationId === dailyAssessment.payload.generationId
    && position.generationId === upperPayload.generationId
    && position.sourceDecisionHash === dailyAssessment.payload.sourceDecisionHash
    && position.sourceDecisionHash === upperPayload.sourceDecisionHash
    && priceBasisAligned;
  const minuteEvidence = selectV7MinuteEvidenceFromCaches({
    code,
    tradingDate,
    caches: loaded.caches,
  });
  const result = identityAligned
    ? evaluateV7MinuteSell({
      tradingDate,
      minuteEvidence,
      position,
      dailyContext: dailyAssessment.payload,
      upperLayer: input.upperLayer,
    })
    : unavailableResult(["production_context_identity_or_integrity_invalid"]);
  const identity = {
    securityId: code,
    tradingDate,
    generationId: identityAligned ? position.generationId : null,
    sourceDecisionHash: identityAligned ? position.sourceDecisionHash : null,
  };
  const output = {
    version: V7_SELL_DECISION_ENTRY_VERSION,
    authority: V7_SELL_DECISION_ENTRY_AUTHORITY,
    strategyAuthority: V7_SELL_STRATEGY_AUTHORITY,
    strategyVersion: V7_SELL_STRATEGY_VERSION,
    status: result.status,
    executionAuthority: false,
    formalPerformanceEligible: false,
    identity,
    cacheAudit: loaded.audit,
    minuteEvidence: {
      authority: minuteEvidence.authority,
      status: minuteEvidence.status,
      priceTier: minuteEvidence.selectedPriceEvidence
        ? minuteEvidence.selectedPriceEvidence.tier : null,
      priceSource: minuteEvidence.selectedPriceEvidence
        ? minuteEvidence.selectedPriceEvidence.source : null,
      sealTickReady: minuteEvidence.capabilities.sealDecayThirtySecondRule,
      blockers: minuteEvidence.blockers,
    },
    result,
    rule: "生产入口只接受哈希绑定的持仓/日线上下文并从固定分钟缓存重建证据；不接收手工Tick或已选择分钟证据，缺失即失败关闭",
  };
  output.decisionHash = v7StableSha256({
    version: output.version,
    authority: output.authority,
    identity: output.identity,
    minuteEvidence: output.minuteEvidence,
    result: output.result,
  });
  return output;
}

module.exports = {
  V7_SELL_DECISION_ENTRY_VERSION,
  V7_SELL_DECISION_ENTRY_AUTHORITY,
  V7_POSITION_CONTEXT_AUTHORITY,
  V7_DAILY_CONTEXT_AUTHORITY,
  DEFAULT_CACHE_FILES,
  readMinuteCaches,
  evaluateV7SellDecision,
};
