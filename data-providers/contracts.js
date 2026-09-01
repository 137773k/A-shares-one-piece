"use strict";

const DATA_BUNDLE_VERSION = 1;
const DATA_BUNDLE_AUTHORITY = "a_share_market_data_bundle_v1";
const PROVIDER_CONTRACT_VERSION = 1;

const CAPABILITIES = Object.freeze({
  HOT_RANK_EASTMONEY: "hot_rank_eastmoney",
  HOT_RANK_THS: "hot_rank_ths",
  MARKET_SNAPSHOT: "market_snapshot",
  EXTERNAL_SNAPSHOT: "external_snapshot",
  LIMIT_STATS: "limit_stats",
  GLOBAL_NEWS: "global_news",
  EVENT_TIMELINE: "event_timeline",
  MARKET_CALENDAR: "market_calendar",
  QUOTES: "quotes",
  DAILY_KLINE: "daily_kline",
  SECTORS: "sectors",
  STOCK_EVIDENCE: "stock_evidence",
  INTRADAY_LEADERSHIP: "intraday_leadership",
  STOCK_NEWS: "stock_news",
});

const CAPABILITY_VALUES = Object.freeze(Object.values(CAPABILITIES));
const QUALITY_STATES = Object.freeze(["live", "verified_cache", "partial", "unavailable"]);
const FORBIDDEN_AUTHORITY_KEYS = Object.freeze(new Set([
  "bestPicks",
  "decisionReceipt",
  "marketPhaseDetail",
  "positionAllocation",
  "premarketModels",
  "selectionAuthority",
  "tradePermission",
  "unifiedDecisionChain",
  "unifiedQuantFactors",
]));

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function normalizeTradingDate(value) {
  const match = text(value).match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function validIso(value) {
  return Boolean(text(value) && Number.isFinite(Date.parse(value)));
}

function findForbiddenAuthority(value, path = "data", depth = 0) {
  if (depth > 10 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < Math.min(value.length, 1000); index += 1) {
      const found = findForbiddenAuthority(value[index], `${path}[${index}]`, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (FORBIDDEN_AUTHORITY_KEYS.has(key)) return nestedPath;
    if (["executionAuthority", "positionAuthority"].includes(key) && nested === true) return nestedPath;
    const found = findForbiddenAuthority(nested, nestedPath, depth + 1);
    if (found) return found;
  }
  return null;
}

function validateProviderDescriptor(provider) {
  const reasons = [];
  const source = provider && typeof provider === "object" ? provider : {};
  if (source.contractVersion !== PROVIDER_CONTRACT_VERSION) reasons.push("provider_contract_version_invalid");
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(text(source.id))) reasons.push("provider_id_invalid");
  if (!text(source.label)) reasons.push("provider_label_missing");
  if (!['user', 'licensed', 'broker', 'local_file', 'community_free'].includes(text(source.kind))) {
    reasons.push("provider_kind_invalid");
  }
  if (source.executionAuthority !== false) reasons.push("provider_execution_authority_must_be_false");
  const capabilities = Array.isArray(source.capabilities) ? source.capabilities : [];
  if (!capabilities.length) reasons.push("provider_capabilities_missing");
  if (capabilities.some((capability) => !CAPABILITY_VALUES.includes(capability))) {
    reasons.push("provider_capability_unknown");
  }
  if (new Set(capabilities).size !== capabilities.length) reasons.push("provider_capability_duplicate");
  if (typeof source.invoke !== "function") reasons.push("provider_invoke_missing");
  return { valid: reasons.length === 0, reasons };
}

function createCapabilityEnvelope(input = {}) {
  const capability = text(input.capability);
  const providerId = text(input.providerId);
  const observedAt = text(input.observedAt) || new Date().toISOString();
  const tradingDate = normalizeTradingDate(input.tradingDate) || null;
  const quality = QUALITY_STATES.includes(text(input.quality)) ? text(input.quality) : "live";
  const data = input.data === undefined ? null : input.data;
  const errors = Array.isArray(input.errors) ? input.errors.map(text).filter(Boolean) : [];
  return {
    version: PROVIDER_CONTRACT_VERSION,
    capability,
    providerId,
    observedAt,
    tradingDate,
    adjustment: text(input.adjustment) || null,
    quality,
    usable: quality !== "unavailable" && data !== null,
    data,
    errors,
    executionAuthority: false,
  };
}

function validateCapabilityEnvelope(envelope, options = {}) {
  const reasons = [];
  const source = envelope && typeof envelope === "object" ? envelope : {};
  if (source.version !== PROVIDER_CONTRACT_VERSION) reasons.push("capability_envelope_version_invalid");
  if (!CAPABILITY_VALUES.includes(source.capability)) reasons.push("capability_envelope_capability_invalid");
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(text(source.providerId))) reasons.push("capability_envelope_provider_invalid");
  if (!validIso(source.observedAt)) reasons.push("capability_envelope_observed_at_invalid");
  if (!QUALITY_STATES.includes(source.quality)) reasons.push("capability_envelope_quality_invalid");
  if (source.executionAuthority !== false) reasons.push("capability_envelope_execution_authority_invalid");
  if (source.usable === true && source.data === null) reasons.push("capability_envelope_usable_data_missing");
  const expectedTradingDate = normalizeTradingDate(options.expectedTradingDate);
  if (expectedTradingDate && source.tradingDate && source.tradingDate !== expectedTradingDate) {
    reasons.push("capability_envelope_trading_date_mismatch");
  }
  const expectedAdjustment = text(options.expectedAdjustment);
  if (expectedAdjustment && source.adjustment && source.adjustment !== expectedAdjustment) {
    reasons.push("capability_envelope_adjustment_mismatch");
  }
  const forbidden = findForbiddenAuthority(source.data);
  if (forbidden) reasons.push(`capability_envelope_forbidden_authority:${forbidden}`);
  return { valid: reasons.length === 0, reasons };
}

function createDataBundle({ generationContext = null, envelopes = [] } = {}) {
  const sourceEnvelopes = Array.isArray(envelopes) ? envelopes : [];
  const capabilities = {};
  const data = {};
  const lineage = [];
  const invalid = [];
  sourceEnvelopes.forEach((envelope) => {
    const inspection = validateCapabilityEnvelope(envelope, {
      expectedTradingDate: generationContext && generationContext.tradingDate,
    });
    if (!inspection.valid) {
      invalid.push({ capability: envelope && envelope.capability || null, reasons: inspection.reasons });
      return;
    }
    capabilities[envelope.capability] = {
      providerId: envelope.providerId,
      observedAt: envelope.observedAt,
      tradingDate: envelope.tradingDate,
      adjustment: envelope.adjustment,
      quality: envelope.quality,
      usable: envelope.usable,
    };
    data[envelope.capability] = envelope.data;
    lineage.push({ capability: envelope.capability, ...capabilities[envelope.capability] });
  });
  const usableCount = Object.values(capabilities).filter((entry) => entry.usable === true).length;
  return {
    version: DATA_BUNDLE_VERSION,
    authority: DATA_BUNDLE_AUTHORITY,
    generationContext,
    capabilities,
    data,
    lineage,
    quality: {
      status: invalid.length ? "invalid" : usableCount === sourceEnvelopes.length ? "complete" : "partial",
      requestedCount: sourceEnvelopes.length,
      usableCount,
      invalid,
    },
    executionAuthority: false,
  };
}

module.exports = {
  CAPABILITIES,
  CAPABILITY_VALUES,
  DATA_BUNDLE_AUTHORITY,
  DATA_BUNDLE_VERSION,
  PROVIDER_CONTRACT_VERSION,
  QUALITY_STATES,
  createCapabilityEnvelope,
  createDataBundle,
  findForbiddenAuthority,
  normalizeTradingDate,
  validateCapabilityEnvelope,
  validateProviderDescriptor,
};
