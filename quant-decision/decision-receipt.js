"use strict";

const crypto = require("node:crypto");
const {
  MAX_RESULT_STOCKS,
  UNIFIED_DECISION_CHAIN_VERSION,
} = require("./decision-chain");
const { UNIFIED_QUANT_FACTORS_VERSION } = require("../unified-quant-factors");

const DECISION_RECEIPT_VERSION = 1;
const DECISION_RECEIPT_AUTHORITY = "canonical_decision_receipt_v1";
const DECISION_RECEIPT_METHOD = "same_generation_canonical_projection_sha256_v1";
const GENERATION_CONTEXT_VERSION = 1;
const LIVE_CANONICAL_STATUS = "live_canonical";
const UNAVAILABLE_STATUS = "unavailable";
const HASH_ALGORITHM = "sha256";
const CANONICAL_CHAIN_AUTHORITY = "canonical_stock_decision";
const CANONICAL_CHAIN_METHOD = "strict_sequential_fail_closed_v1";
const CANONICAL_FACTOR_METHOD = `strict_sequential_decision_chain_v${UNIFIED_DECISION_CHAIN_VERSION}`;
const CANONICAL_SELECTION_AUTHORITY = `unified_decision_chain_v${UNIFIED_DECISION_CHAIN_VERSION}`;
const EXECUTION_REPLAY_RULE_AUTHORITY = "canonical_next_day_trigger_window_v1";
const CLOSING_SNAPSHOT_KIND = "closing";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function text(value) {
  return String(value == null ? "" : value).trim();
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function unique(values) {
  return [...new Set(rows(values).map(text).filter(Boolean))];
}

function codeOf(value) {
  return text(value && (value.code || value.secCode || value.stockCode || value.symbol));
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function minuteOf(value) {
  const match = text(value).match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

function machineReplayRuleValid(value) {
  const rule = isObject(value) ? value : {};
  const earliest = minuteOf(rule.earliestTime);
  const latest = minuteOf(rule.latestTime);
  const referencePrice = finite(rule.referencePrice);
  return finite(rule.version) === 1
    && text(rule.authority) === EXECUTION_REPLAY_RULE_AUTHORITY
    && referencePrice !== null
    && referencePrice > 0
    && earliest !== null
    && latest !== null
    && earliest <= latest
    && finite(rule.maxGapPct) !== null;
}

function allocationInspection(stocks, positionPermission = {}) {
  const sourceStocks = rows(stocks);
  const expectedInitial = finite(positionPermission.initialActivationPct);
  const expectedMaximum = finite(positionPermission.positionCeilingPct);
  const allocations = sourceStocks.map((stock) => sourceValue(stock, "positionAllocation"));
  const fieldsInvalid = allocations.some((allocation) => {
    const relative = finite(allocation.relativeWeightPct);
    const initial = finite(allocation.initialPortfolioPct);
    const maximum = finite(allocation.maximumPortfolioPct);
    return relative === null || initial === null || maximum === null
      || relative < 0 || initial < 0 || maximum < 0
      || relative > 100 || initial > maximum || maximum > 100;
  });
  const relativeTotalPct = round2(allocations.reduce(
    (sum, allocation) => sum + Math.max(0, finite(allocation.relativeWeightPct) || 0), 0,
  ));
  const initialTotalPct = round2(allocations.reduce(
    (sum, allocation) => sum + Math.max(0, finite(allocation.initialPortfolioPct) || 0), 0,
  ));
  const maximumTotalPct = round2(allocations.reduce(
    (sum, allocation) => sum + Math.max(0, finite(allocation.maximumPortfolioPct) || 0), 0,
  ));
  const totalsInvalid = Boolean(sourceStocks.length) && (
    expectedInitial === null
    || expectedMaximum === null
    || expectedInitial < 0
    || expectedMaximum < 0
    || expectedInitial > expectedMaximum
    || expectedMaximum > 100
    || Math.abs(relativeTotalPct - 100) > 0.11
    || Math.abs(initialTotalPct - expectedInitial) > 0.11
    || Math.abs(maximumTotalPct - expectedMaximum) > 0.11
  );
  return {
    valid: !fieldsInvalid && !totalsInvalid,
    relativeTotalPct,
    initialTotalPct,
    maximumTotalPct,
  };
}

function normalizeForStableJson(value, stack = new Set(), arrayItem = false) {
  if (value === null) return null;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return value;
  if (kind === "number") return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
  if (kind === "undefined" || kind === "function" || kind === "symbol") {
    return arrayItem ? null : undefined;
  }
  if (kind === "bigint") throw new TypeError("BigInt cannot be serialized as canonical JSON");
  if (kind !== "object") return arrayItem ? null : undefined;
  if (stack.has(value)) throw new TypeError("Circular structure cannot be serialized as canonical JSON");

  stack.add(value);
  let normalized;
  if (Array.isArray(value)) {
    normalized = value.map((item) => normalizeForStableJson(item, stack, true));
  } else if (value instanceof Date) {
    const time = value.getTime();
    normalized = Number.isFinite(time) ? value.toISOString() : null;
  } else {
    normalized = {};
    Object.keys(value).sort().forEach((key) => {
      const item = normalizeForStableJson(value[key], stack, false);
      if (item !== undefined) normalized[key] = item;
    });
  }
  stack.delete(value);
  return normalized;
}

function stableSerialize(value) {
  const normalized = normalizeForStableJson(value);
  const serialized = JSON.stringify(normalized);
  if (serialized === undefined) throw new TypeError("Value cannot be serialized as canonical JSON");
  return serialized;
}

function sha256Hex(value) {
  return crypto.createHash(HASH_ALGORITHM).update(String(value), "utf8").digest("hex");
}

function stableSha256(value) {
  return sha256Hex(stableSerialize(value));
}

function cloneCanonical(value) {
  return JSON.parse(stableSerialize(value));
}

function validTradingDate(value) {
  const date = text(value);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function validAsOf(value) {
  return Boolean(text(value)) && Number.isFinite(Date.parse(value));
}

function generationIdentity(value) {
  const source = isObject(value) ? value : {};
  return {
    generationId: text(source.generationId) || null,
    tradingDate: text(source.tradingDate) || null,
    asOf: text(source.asOf) || null,
  };
}

function sameGeneration(left, right) {
  const a = generationIdentity(left);
  const b = generationIdentity(right);
  return Boolean(
    a.generationId
    && a.tradingDate
    && a.asOf
    && a.generationId === b.generationId
    && a.tradingDate === b.tradingDate
    && a.asOf === b.asOf,
  );
}

function sourceValue(payload, key) {
  return isObject(payload && payload[key]) ? payload[key] : {};
}

function validateCanonicalSource(payload, options = {}) {
  const source = isObject(payload) ? payload : {};
  const snapshotKind = text(options.snapshotKind);
  const generationContext = sourceValue(source, "generationContext");
  const chain = sourceValue(source, "unifiedDecisionChain");
  const factors = sourceValue(source, "unifiedQuantFactors");
  const bestPicks = sourceValue(source, "bestPicks");
  const bestPickRows = rows(bestPicks.picks);
  const chainGeneration = sourceValue(chain, "generation");
  const factorGeneration = sourceValue(factors, "generation");
  const chainIntegrity = sourceValue(chain, "integrity");
  const factorIntegrity = sourceValue(factors, "integrity");
  const authorization = sourceValue(chain, "authorization");
  const tradePermission = sourceValue(authorization, "tradePermission");
  const result = sourceValue(chain, "result");
  const resultStocks = rows(result.stocks);
  const selectedCodes = rows(result.selectedCodes).map(text).filter(Boolean);
  const stockCodes = resultStocks.map(codeOf).filter(Boolean);
  const observations = sourceValue(chain, "observationCandidates");
  const observationStocks = rows(observations.stocks);
  const factorCandidates = sourceValue(factors, "candidates");
  const factorPermission = sourceValue(factors, "permission");
  const factorFinalPermission = sourceValue(factorPermission, "final");
  const factorPermissionIntegrity = sourceValue(factorPermission, "integrity");
  const positionPermission = sourceValue(authorization, "positionPermission");
  const allocation = allocationInspection(resultStocks, positionPermission);
  const executionEvidenceByCode = {};
  const reasons = [];

  if (snapshotKind !== CLOSING_SNAPSHOT_KIND) reasons.push("snapshot_not_closing");

  if (!isObject(source.generationContext)) reasons.push("generation_context_missing");
  if (finite(generationContext.version) !== GENERATION_CONTEXT_VERSION) {
    reasons.push("generation_context_version_mismatch");
  }
  if (!generationIdentity(generationContext).generationId
    || !validTradingDate(generationContext.tradingDate)
    || !validAsOf(generationContext.asOf)) {
    reasons.push("generation_context_incomplete");
  }

  if (!isObject(source.unifiedDecisionChain)) reasons.push("unified_decision_chain_missing");
  if (finite(chain.version) !== UNIFIED_DECISION_CHAIN_VERSION) {
    reasons.push("unified_decision_chain_version_mismatch");
  }
  if (text(chain.authority) !== CANONICAL_CHAIN_AUTHORITY) {
    reasons.push("unified_decision_chain_authority_invalid");
  }
  if (text(chain.method) !== CANONICAL_CHAIN_METHOD) {
    reasons.push("unified_decision_chain_method_invalid");
  }
  if (chainIntegrity.ok !== true
    || chainIntegrity.failClosed !== true
    || finite(chainIntegrity.maxResultStocks) !== MAX_RESULT_STOCKS
    || chainIntegrity.noForcedCandidate !== true
    || chainIntegrity.legacySelectedCanGrantMode !== false
    || chainIntegrity.observationCandidatesCannotGrantExecution !== true) {
    reasons.push("unified_decision_chain_integrity_invalid");
  }

  if (!isObject(source.unifiedQuantFactors)) reasons.push("unified_quant_factors_missing");
  if (finite(factors.version) !== UNIFIED_QUANT_FACTORS_VERSION) {
    reasons.push("unified_quant_factors_version_mismatch");
  }
  if (text(factors.method) !== CANONICAL_FACTOR_METHOD) {
    reasons.push("unified_quant_factors_method_invalid");
  }
  if (factorIntegrity.ok !== true
    || factorIntegrity.failClosed !== true
    || factorIntegrity.legacySelectedIsNotExecution !== true
    || factorIntegrity.observationCannotGrantPermission !== true
    || factorIntegrity.strictSequentialDecisionChain !== true
    || factorIntegrity.maxFiveFinalStocks !== true
    || factorIntegrity.stockFactorEngineAligned !== true) {
    reasons.push("unified_quant_factors_integrity_invalid");
  }

  if (chainGeneration.aligned !== true
    || factorGeneration.aligned !== true
    || !sameGeneration(generationContext, chainGeneration)
    || !sameGeneration(generationContext, factorGeneration)) {
    reasons.push("generation_not_aligned");
  }

  if (!isObject(factors.decisionChain)) {
    reasons.push("unified_quant_factors_chain_missing");
  } else {
    try {
      if (stableSha256(factors.decisionChain) !== stableSha256(chain)) {
        reasons.push("unified_quant_factors_chain_mismatch");
      }
    } catch (_error) {
      reasons.push("source_serialization_failed");
    }
  }

  const resultStatus = text(result.status);
  if (!isObject(chain.result)
    || !["ready", "no_candidate", "blocked"].includes(resultStatus)
    || finite(result.maxStocks) !== MAX_RESULT_STOCKS) {
    reasons.push("result_contract_invalid");
  }
  if (resultStocks.length > MAX_RESULT_STOCKS || selectedCodes.length > MAX_RESULT_STOCKS) {
    reasons.push("result_count_exceeds_limit");
  }
  if (finite(result.selectedCount) !== resultStocks.length
    || selectedCodes.join(",") !== stockCodes.join(",")
    || stockCodes.length !== resultStocks.length
    || new Set(stockCodes).size !== stockCodes.length) {
    reasons.push("result_codes_or_count_mismatch");
  }
  if ((resultStatus === "blocked" || resultStatus === "no_candidate") && resultStocks.length) {
    reasons.push("non_ready_result_contains_stocks");
  }
  if (resultStatus === "ready" && !resultStocks.length) reasons.push("ready_result_is_empty");
  if ((authorization.passed !== true || tradePermission.allowNew !== true) && resultStocks.length) {
    reasons.push("authorization_closed_with_results");
  }
  if (!allocation.valid) reasons.push("result_allocation_invalid");

  if (resultStocks.length) {
    if (text(bestPicks.selectionAuthority) !== CANONICAL_SELECTION_AUTHORITY
      || finite(bestPicks.decisionChainVersion) !== UNIFIED_DECISION_CHAIN_VERSION) {
      reasons.push("best_picks_authority_invalid");
    }
    const selectionContext = sourceValue(bestPicks, "selectionContext");
    if (!sameGeneration(generationContext, selectionContext)) {
      reasons.push("best_picks_generation_not_aligned");
    }
    resultStocks.forEach((stock) => {
      const code = codeOf(stock);
      const matches = bestPickRows.filter((pick) => codeOf(pick) === code);
      if (!code || matches.length !== 1) {
        reasons.push("best_picks_result_match_missing_or_ambiguous");
        return;
      }
      const pick = matches[0];
      if (!machineReplayRuleValid(pick.executionReplayRule)) {
        reasons.push("execution_replay_rule_missing_or_invalid");
        return;
      }
      const nestedCancelConditions = rows(pick.tomorrowExecution && pick.tomorrowExecution.cancelConditions);
      executionEvidenceByCode[code] = {
        executionReplayRule: pick.executionReplayRule,
        price: finite(pick.price),
        priceIntegrity: isObject(pick.priceIntegrity) ? pick.priceIntegrity : null,
        buy: isObject(pick.buy) ? pick.buy : null,
        sell: isObject(pick.sell) ? pick.sell : null,
        cancelConditions: rows(pick.cancelConditions).length
          ? rows(pick.cancelConditions) : nestedCancelConditions,
      };
    });
  }

  if (observations.observationOnly !== true
    || observations.executionAuthority !== false
    || finite(observations.maxStocks) !== MAX_RESULT_STOCKS
    || observationStocks.length > MAX_RESULT_STOCKS
    || finite(observations.selectedCount) !== observationStocks.length
    || rows(observations.selectedCodes).map(text).filter(Boolean).join(",")
      !== observationStocks.map(codeOf).filter(Boolean).join(",")
    || observationStocks.some((stock) => (
      stock.observationOnly !== true
      || stock.executable !== false
      || stock.executionAuthority !== false
      || Object.prototype.hasOwnProperty.call(stock, "positionAllocation")
      || Object.prototype.hasOwnProperty.call(stock, "canonicalAllocation")
      || Object.prototype.hasOwnProperty.call(stock, "position")
      || Object.prototype.hasOwnProperty.call(stock, "buy")
    ))) {
    reasons.push("observation_candidate_boundary_invalid");
  }

  if (finite(factorCandidates.finalResultCount) !== resultStocks.length
    || rows(factorCandidates.finalResultCodes).map(text).filter(Boolean).join(",") !== stockCodes.join(",")
    || finite(factorCandidates.maxFinalResults) !== MAX_RESULT_STOCKS
    || factorCandidates.legacySelectedIsExecutionAuthority !== false) {
    reasons.push("unified_quant_factors_result_projection_mismatch");
  }
  if (text(factorFinalPermission.authority) !== "unified_decision_chain"
    || factorPermissionIntegrity.source !== "unified_decision_chain"
    || factorPermissionIntegrity.chainValid !== true
    || factorPermissionIntegrity.generationAligned !== true) {
    reasons.push("unified_quant_factors_permission_authority_invalid");
  }

  return {
    valid: unique(reasons).length === 0,
    reasons: unique(reasons),
    generation: generationIdentity(generationContext),
    chain,
    factors,
    result,
    observations,
    executionEvidenceByCode,
    snapshotKind,
  };
}

function sourceMetadata(inspection) {
  const chain = inspection.chain;
  const factors = inspection.factors;
  return {
    snapshotKind: inspection.snapshotKind,
    generationContext: {
      version: GENERATION_CONTEXT_VERSION,
      ...inspection.generation,
    },
    unifiedDecisionChain: {
      version: finite(chain.version),
      authority: text(chain.authority) || null,
      method: text(chain.method) || null,
      generation: cloneCanonical(sourceValue(chain, "generation")),
    },
    unifiedQuantFactors: {
      version: finite(factors.version),
      method: text(factors.method) || null,
      generation: cloneCanonical(sourceValue(factors, "generation")),
      factorRegistryHash: Array.isArray(factors.factorRegistry)
        ? stableSha256(factors.factorRegistry) : null,
      stockFactorEngineAuthority: text(factors.integrity && factors.integrity.stockFactorEngineAuthority) || null,
      stockFactorEngineVersion: finite(factors.integrity && factors.integrity.stockFactorEngineVersion),
    },
    canonicalResultPath: "unifiedDecisionChain.result.stocks",
    legacySelectedIsExecutionAuthority: false,
  };
}

function factorSnapshot(factors) {
  return cloneCanonical({
    version: factors.version,
    method: factors.method,
    generation: factors.generation,
    marketStage: factors.marketStage,
    speculationPreference: factors.speculationPreference,
    profitEffects: factors.profitEffects,
    permission: factors.permission,
    candidates: factors.candidates,
    roleContract: factors.roleContract,
    integrity: factors.integrity,
  });
}

function liveDecisionProjection(inspection) {
  const chain = inspection.chain;
  const result = cloneCanonical(chain.result);
  result.stocks = rows(result.stocks).map((stock) => {
    const evidence = inspection.executionEvidenceByCode[codeOf(stock)] || {};
    return {
      ...stock,
      executionReplayRule: cloneCanonical(evidence.executionReplayRule),
      price: evidence.price,
      priceIntegrity: cloneCanonical(evidence.priceIntegrity),
      buy: cloneCanonical(evidence.buy),
      sell: cloneCanonical(evidence.sell),
      cancelConditions: cloneCanonical(evidence.cancelConditions),
    };
  });
  return cloneCanonical({
    marketStage: chain.marketStage,
    authorization: chain.authorization,
    profitEffect: chain.profitEffect,
    theme: chain.theme,
    stockMode: chain.stockMode,
    stockSelectionContext: chain.stockSelectionContext,
    steps: chain.steps,
    result,
    observationCandidates: chain.observationCandidates,
    chainIntegrity: chain.integrity,
    factorSnapshot: factorSnapshot(inspection.factors),
  });
}

function unavailableDecisionProjection() {
  return {
    authoritative: false,
    result: {
      status: UNAVAILABLE_STATUS,
      authoritative: false,
      maxStocks: MAX_RESULT_STOCKS,
      selectedCount: 0,
      selectedCodes: [],
      stocks: [],
      rule: "权威统一链不可核验时不读取旧selected，也不推断或补足正式结果",
    },
  };
}

function sourceHashPayload(payload, snapshotKind) {
  const source = isObject(payload) ? payload : {};
  return {
    snapshotKind: text(snapshotKind) || null,
    generationContext: source.generationContext,
    unifiedDecisionChain: source.unifiedDecisionChain,
    unifiedQuantFactors: source.unifiedQuantFactors,
    bestPicks: source.bestPicks,
  };
}

function attachHashes(baseReceipt, sourcePayload, snapshotKind) {
  const decisionHash = stableSha256(baseReceipt.decision);
  const sourceHash = sourcePayload
    ? stableSha256(sourceHashPayload(sourcePayload, snapshotKind)) : null;
  const receiptId = baseReceipt.status === LIVE_CANONICAL_STATUS && baseReceipt.generation.tradingDate
    ? `${baseReceipt.generation.tradingDate}:${decisionHash.slice(0, 24)}`
    : `unavailable:${decisionHash.slice(0, 24)}`;
  const withHashInputs = {
    ...baseReceipt,
    receiptId,
    hashes: {
      algorithm: HASH_ALGORITHM,
      decisionHash,
      sourceHash,
    },
  };
  const receiptHash = stableSha256(withHashInputs);
  return {
    ...withHashInputs,
    hashes: {
      ...withHashInputs.hashes,
      receiptHash,
    },
  };
}

function fallbackGeneration(payload) {
  const context = sourceValue(isObject(payload) ? payload : {}, "generationContext");
  const generation = generationIdentity(context);
  return {
    ...generation,
    aligned: false,
  };
}

function lineageFromOptions(options = {}) {
  const nested = isObject(options.lineage) ? options.lineage : {};
  const supersedesReceiptId = text(
    options.supersedesReceiptId || nested.supersedesReceiptId,
  ) || null;
  const supersedeReason = text(
    options.supersedeReason || nested.supersedeReason,
  ) || null;
  return {
    lineage: supersedesReceiptId || supersedeReason ? {
      supersedesReceiptId,
      supersedeReason,
    } : null,
    valid: Boolean(
      (!supersedesReceiptId && !supersedeReason)
      || (supersedesReceiptId && supersedeReason)
    ),
  };
}

function buildDecisionReceipt(payload = {}, options = {}) {
  const snapshotKind = text(options.snapshotKind);
  const lineageInput = lineageFromOptions(options);
  let inspection;
  try {
    inspection = validateCanonicalSource(payload, { snapshotKind });
  } catch (_error) {
    inspection = {
      valid: false,
      reasons: ["source_serialization_failed"],
      generation: generationIdentity(sourceValue(isObject(payload) ? payload : {}, "generationContext")),
      chain: {},
      factors: {},
      snapshotKind,
    };
  }
  if (!lineageInput.valid) {
    inspection.valid = false;
    inspection.reasons = unique([...(inspection.reasons || []), "lineage_invalid"]);
  }

  const liveCanonical = inspection.valid === true;
  const generation = liveCanonical
    ? { ...inspection.generation, aligned: true }
    : fallbackGeneration(payload);
  let source;
  let decision;
  try {
    source = liveCanonical ? sourceMetadata(inspection) : {
      snapshotKind: snapshotKind || null,
      generationContext: {
        version: finite(payload && payload.generationContext && payload.generationContext.version),
        ...generationIdentity(payload && payload.generationContext),
      },
      unifiedDecisionChain: {
        version: finite(payload && payload.unifiedDecisionChain && payload.unifiedDecisionChain.version),
        authority: text(payload && payload.unifiedDecisionChain && payload.unifiedDecisionChain.authority) || null,
        method: text(payload && payload.unifiedDecisionChain && payload.unifiedDecisionChain.method) || null,
      },
      unifiedQuantFactors: {
        version: finite(payload && payload.unifiedQuantFactors && payload.unifiedQuantFactors.version),
        method: text(payload && payload.unifiedQuantFactors && payload.unifiedQuantFactors.method) || null,
      },
      canonicalResultPath: "unifiedDecisionChain.result.stocks",
      legacySelectedIsExecutionAuthority: false,
    };
    decision = liveCanonical ? liveDecisionProjection(inspection) : unavailableDecisionProjection();
  } catch (_error) {
    inspection.valid = false;
    inspection.reasons = unique([...(inspection.reasons || []), "source_serialization_failed"]);
    source = {
      canonicalResultPath: "unifiedDecisionChain.result.stocks",
      legacySelectedIsExecutionAuthority: false,
    };
    decision = unavailableDecisionProjection();
  }

  let status = inspection.valid === true ? LIVE_CANONICAL_STATUS : UNAVAILABLE_STATUS;
  if (status === LIVE_CANONICAL_STATUS && lineageInput.lineage) {
    const provisionalDecisionHash = stableSha256(decision);
    const provisionalReceiptId = generation.tradingDate
      ? `${generation.tradingDate}:${provisionalDecisionHash.slice(0, 24)}`
      : null;
    if (lineageInput.lineage.supersedesReceiptId === provisionalReceiptId) {
      status = UNAVAILABLE_STATUS;
      inspection.reasons = unique([...(inspection.reasons || []), "lineage_cannot_supersede_self"]);
      decision = unavailableDecisionProjection();
    }
  }
  const baseReceipt = {
    version: DECISION_RECEIPT_VERSION,
    authority: DECISION_RECEIPT_AUTHORITY,
    method: DECISION_RECEIPT_METHOD,
    status,
    generation: status === LIVE_CANONICAL_STATUS ? generation : { ...generation, aligned: false },
    source,
    decision,
    lineage: status === LIVE_CANONICAL_STATUS ? lineageInput.lineage : null,
    integrity: {
      ok: status === LIVE_CANONICAL_STATUS,
      failClosed: true,
      sameGenerationRequired: true,
      maxResultStocks: MAX_RESULT_STOCKS,
      emptyCanonicalResultAllowed: true,
      noForcedCandidate: true,
      legacySelectedIsNotExecution: true,
      canonicalResultPath: "unifiedDecisionChain.result.stocks",
      blockers: status === LIVE_CANONICAL_STATUS ? [] : unique(inspection.reasons),
    },
  };

  try {
    return attachHashes(
      baseReceipt,
      status === LIVE_CANONICAL_STATUS ? payload : null,
      snapshotKind,
    );
  } catch (_error) {
    const safeBase = {
      ...baseReceipt,
      status: UNAVAILABLE_STATUS,
      generation: { ...baseReceipt.generation, aligned: false },
      decision: unavailableDecisionProjection(),
      lineage: null,
      integrity: {
        ...baseReceipt.integrity,
        ok: false,
        blockers: unique([...(baseReceipt.integrity.blockers || []), "source_serialization_failed"]),
      },
    };
    return attachHashes(safeBase, null, snapshotKind);
  }
}

function validateDecisionReceipt(receipt, options = {}) {
  const source = isObject(receipt) ? receipt : {};
  const reasons = [];
  const generation = sourceValue(source, "generation");
  const metadata = sourceValue(source, "source");
  const chainMetadata = sourceValue(metadata, "unifiedDecisionChain");
  const factorMetadata = sourceValue(metadata, "unifiedQuantFactors");
  const integrity = sourceValue(source, "integrity");
  const decision = sourceValue(source, "decision");
  const result = sourceValue(decision, "result");
  const stocks = rows(result.stocks);
  const selectedCodes = rows(result.selectedCodes).map(text).filter(Boolean);
  const stockCodes = stocks.map(codeOf).filter(Boolean);
  const hashes = sourceValue(source, "hashes");
  const snapshotKind = text(metadata.snapshotKind);
  const requestedSnapshotKind = text(options.snapshotKind);
  const authorization = sourceValue(decision, "authorization");
  const positionPermission = sourceValue(authorization, "positionPermission");
  const allocation = allocationInspection(stocks, positionPermission);
  const lineage = isObject(source.lineage) ? source.lineage : null;

  if (finite(source.version) !== DECISION_RECEIPT_VERSION) reasons.push("decision_receipt_version_mismatch");
  if (text(source.authority) !== DECISION_RECEIPT_AUTHORITY) reasons.push("decision_receipt_authority_invalid");
  if (text(source.method) !== DECISION_RECEIPT_METHOD) reasons.push("decision_receipt_method_invalid");
  if (![LIVE_CANONICAL_STATUS, UNAVAILABLE_STATUS].includes(text(source.status))) {
    reasons.push("decision_receipt_status_invalid");
  }
  if (integrity.failClosed !== true
    || finite(integrity.maxResultStocks) !== MAX_RESULT_STOCKS
    || integrity.legacySelectedIsNotExecution !== true
    || text(integrity.canonicalResultPath) !== "unifiedDecisionChain.result.stocks") {
    reasons.push("decision_receipt_integrity_invalid");
  }
  if (source.lineage !== null && source.lineage !== undefined && !lineage) {
    reasons.push("decision_receipt_lineage_invalid");
  }
  if (lineage && (
    !text(lineage.supersedesReceiptId)
    || !text(lineage.supersedeReason)
    || text(lineage.supersedesReceiptId) === text(source.receiptId)
  )) {
    reasons.push("decision_receipt_lineage_invalid");
  }

  if (source.status === LIVE_CANONICAL_STATUS) {
    if (snapshotKind !== CLOSING_SNAPSHOT_KIND
      || requestedSnapshotKind && requestedSnapshotKind !== CLOSING_SNAPSHOT_KIND
      || requestedSnapshotKind && requestedSnapshotKind !== snapshotKind) {
      reasons.push("snapshot_not_closing");
    }
    if (integrity.ok !== true || generation.aligned !== true
      || !generationIdentity(generation).generationId
      || !validTradingDate(generation.tradingDate)
      || !validAsOf(generation.asOf)) {
      reasons.push("decision_receipt_generation_invalid");
    }
    if (finite(metadata.generationContext && metadata.generationContext.version) !== GENERATION_CONTEXT_VERSION
      || !sameGeneration(generation, metadata.generationContext)
      || !sameGeneration(generation, chainMetadata.generation)
      || !sameGeneration(generation, factorMetadata.generation)) {
      reasons.push("decision_receipt_generation_mismatch");
    }
    if (finite(chainMetadata.version) !== UNIFIED_DECISION_CHAIN_VERSION
      || text(chainMetadata.authority) !== CANONICAL_CHAIN_AUTHORITY
      || text(chainMetadata.method) !== CANONICAL_CHAIN_METHOD) {
      reasons.push("decision_receipt_chain_authority_invalid");
    }
    if (finite(factorMetadata.version) !== UNIFIED_QUANT_FACTORS_VERSION
      || text(factorMetadata.method) !== CANONICAL_FACTOR_METHOD) {
      reasons.push("decision_receipt_factor_contract_invalid");
    }
    if (!["ready", "no_candidate", "blocked"].includes(text(result.status))
      || finite(result.maxStocks) !== MAX_RESULT_STOCKS
      || stocks.length > MAX_RESULT_STOCKS
      || finite(result.selectedCount) !== stocks.length
      || selectedCodes.join(",") !== stockCodes.join(",")
      || stockCodes.length !== stocks.length
      || new Set(stockCodes).size !== stockCodes.length) {
      reasons.push("decision_receipt_result_invalid");
    }
    if (!allocation.valid) reasons.push("decision_receipt_allocation_invalid");
    if (stocks.some((stock) => !machineReplayRuleValid(stock.executionReplayRule))) {
      reasons.push("decision_receipt_execution_replay_rule_invalid");
    }
  } else {
    if (integrity.ok !== false || generation.aligned !== false
      || result.authoritative !== false || result.status !== UNAVAILABLE_STATUS
      || stocks.length !== 0 || finite(result.selectedCount) !== 0
      || lineage !== null) {
      reasons.push("unavailable_receipt_is_not_fail_closed");
    }
  }

  if (text(hashes.algorithm) !== HASH_ALGORITHM
    || !/^[a-f0-9]{64}$/.test(text(hashes.decisionHash))
    || !/^[a-f0-9]{64}$/.test(text(hashes.receiptHash))) {
    reasons.push("decision_receipt_hash_contract_invalid");
  } else {
    let computedDecisionHash = null;
    let computedReceiptHash = null;
    try {
      computedDecisionHash = stableSha256(source.decision);
      const withoutReceiptHash = cloneCanonical(source);
      delete withoutReceiptHash.hashes.receiptHash;
      computedReceiptHash = stableSha256(withoutReceiptHash);
    } catch (_error) {
      reasons.push("decision_receipt_serialization_failed");
    }
    if (computedDecisionHash && computedDecisionHash !== hashes.decisionHash) {
      reasons.push("decision_hash_mismatch");
    }
    if (computedReceiptHash && computedReceiptHash !== hashes.receiptHash) {
      reasons.push("receipt_hash_mismatch");
    }
    const expectedReceiptId = source.status === LIVE_CANONICAL_STATUS && generation.tradingDate
      ? `${generation.tradingDate}:${text(hashes.decisionHash).slice(0, 24)}`
      : `unavailable:${text(hashes.decisionHash).slice(0, 24)}`;
    if (text(source.receiptId) !== expectedReceiptId) reasons.push("receipt_id_mismatch");
  }
  if (source.status === LIVE_CANONICAL_STATUS && !/^[a-f0-9]{64}$/.test(text(hashes.sourceHash))) {
    reasons.push("source_hash_missing_or_invalid");
  }

  let sourceHashVerified = null;
  if (source.status === LIVE_CANONICAL_STATUS && isObject(options.sourcePayload)) {
    try {
      const verificationSnapshotKind = requestedSnapshotKind || snapshotKind;
      sourceHashVerified = stableSha256(
        sourceHashPayload(options.sourcePayload, verificationSnapshotKind),
      ) === hashes.sourceHash;
      if (!sourceHashVerified) reasons.push("source_hash_mismatch");
      const sourceInspection = validateCanonicalSource(options.sourcePayload, {
        snapshotKind: verificationSnapshotKind,
      });
      if (source.status === LIVE_CANONICAL_STATUS && !sourceInspection.valid) {
        reasons.push("receipt_source_no_longer_canonical");
      }
    } catch (_error) {
      sourceHashVerified = false;
      reasons.push("source_hash_verification_failed");
    }
  }

  const uniqueReasons = unique(reasons);
  return {
    valid: source.status === LIVE_CANONICAL_STATUS && uniqueReasons.length === 0,
    wellFormed: uniqueReasons.length === 0,
    liveCanonical: source.status === LIVE_CANONICAL_STATUS && uniqueReasons.length === 0,
    status: text(source.status) || UNAVAILABLE_STATUS,
    reasons: uniqueReasons,
    sourceHashVerified,
  };
}

module.exports = {
  DECISION_RECEIPT_VERSION,
  DECISION_RECEIPT_AUTHORITY,
  DECISION_RECEIPT_METHOD,
  GENERATION_CONTEXT_VERSION,
  LIVE_CANONICAL_STATUS,
  UNAVAILABLE_STATUS,
  stableSerialize,
  sha256Hex,
  stableSha256,
  validateCanonicalSource,
  buildDecisionReceipt,
  validateDecisionReceipt,
};
