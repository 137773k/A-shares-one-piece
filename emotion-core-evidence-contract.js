"use strict";

/**
 * 严格情绪核心证据契约。
 *
 * 这个模块只负责把已经完成身份校验的候选投影成可追溯证据，绝不重算
 * 最终情绪阶段或交易权限。高度风险风向标与严格核心始终分池，且前者
 * 永远没有情绪核心投票权。
 */

const EMOTION_CORE_EVIDENCE_CONTRACT_VERSION = 2;
const MAX_STRICT_EMOTION_CORES = 5;
const STRICT_AUTHORITY = "theme_cycle_leadership";
const SUPPORTED_THEME_LIBRARY_CLASSIFIERS = new Set([
  "theme-library-v5-cycle-leader-state",
  "theme-library-v7-role-authority-evidence",
  "theme-library-v8-family-subtheme-decision",
]);
const STRICT_CORE_CLASSIFIER_VERSION = "strict-core-qualification-v2";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return String(value == null ? "" : value).trim();
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampScore(value) {
  const number = finite(value);
  return number === null ? 0 : Math.max(0, Math.min(100, Math.round(number * 10) / 10));
}

function clone(value, fallback = null) {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function uniqueStrings(value) {
  return [...new Set(list(value).map(text).filter(Boolean))];
}

function sourceMeta(value) {
  const source = isObject(value) ? value : {};
  return {
    generationId: text(source.generationId),
    tradingDate: text(source.tradingDate),
    asOf: text(source.asOf),
    contractVersion: finite(source.contractVersion),
  };
}

function expectedMeta(input) {
  const generation = isObject(input && input.generation) ? input.generation : {};
  return {
    generationId: text(generation.id || generation.generationId),
    tradingDate: text(generation.tradingDate),
    asOf: text(generation.asOf),
    contractVersion: finite(input && input.contractVersion) ?? finite(generation.contractVersion),
  };
}

function metaMismatch(meta, expected, reasonCodes) {
  if (meta.generationId && meta.generationId !== expected.generationId) reasonCodes.add("generation_mismatch");
  if (meta.tradingDate && meta.tradingDate !== expected.tradingDate) reasonCodes.add("trading_date_mismatch");
  if (meta.asOf && meta.asOf !== expected.asOf) reasonCodes.add("as_of_mismatch");
  if (meta.contractVersion !== null && meta.contractVersion !== expected.contractVersion) {
    reasonCodes.add("contract_version_mismatch");
  }
}

function validateLineage(input, expected) {
  const reasonCodes = new Set();
  if (!expected.generationId) reasonCodes.add("generation_missing");
  if (!expected.tradingDate) reasonCodes.add("trading_date_missing");
  if (!expected.asOf) reasonCodes.add("as_of_missing");
  if (expected.contractVersion !== EMOTION_CORE_EVIDENCE_CONTRACT_VERSION) {
    reasonCodes.add("contract_version_mismatch");
  }

  const inspect = (value) => {
    if (!isObject(value)) return;
    metaMismatch(sourceMeta(value), expected, reasonCodes);
  };

  inspect(input && input.marketCycle);
  list(input && input.themeCycles).forEach((group) => {
    inspect(group && group.theme);
    inspect(group && group.cycle);
    list(group && group.candidates).forEach((row) => {
      inspect(row && row.qualification);
      inspect(row && row.theme);
      inspect(row && row.cycle);
      inspect(row && row.identity);
      inspect(row && row.session);
      inspect(row && row.dataQuality);
      list(row && row.evidence).forEach(inspect);
    });
  });

  return [...reasonCodes];
}

function requiredTraceReasonCodes(row) {
  const reasons = [];
  if (!text(row && row.code)) reasons.push("code_missing");
  if (!text(row && row.name)) reasons.push("name_missing");
  if (!isObject(row && row.qualification)) reasons.push("qualification_missing");
  if (!isObject(row && row.theme)) reasons.push("theme_missing");
  if (!isObject(row && row.cycle)) reasons.push("cycle_missing");
  if (!isObject(row && row.identity)) reasons.push("identity_missing");
  if (!isObject(row && row.session)) reasons.push("session_missing");
  if (!Array.isArray(row && row.evidence)) reasons.push("evidence_missing");
  if (!isObject(row && row.dataQuality)) reasons.push("data_quality_missing");
  if (row && row.qualification && row.qualification.passed !== true) reasons.push("qualification_not_passed");
  if (text(row && row.qualification && row.qualification.authority) !== STRICT_AUTHORITY) {
    reasons.push("qualification_authority_invalid");
  }
  if (text(row && row.identity && row.identity.authority) !== STRICT_AUTHORITY) {
    reasons.push("identity_authority_invalid");
  }
  if (row && row.classification && row.classification.strictEmotionCore === true) {
    if (text(row.session && row.session.snapshotKind).toLowerCase() !== "closing") reasons.push("strict_session_not_closing");
    if (row.session && row.session.completed !== true) reasons.push("strict_session_not_completed");
    if (row.session && row.session.verified !== true) reasons.push("strict_session_not_verified");
    if (row.dataQuality && row.dataQuality.complete !== true) reasons.push("strict_data_quality_incomplete");
  }
  return reasons;
}

function verifiedNegativeFeedback(row, state, strict) {
  if (!strict || !/repair_failed|negative_feedback|a_kill|breakdown|修复失败|负反馈|a杀/i.test(text(state))) {
    return false;
  }
  const session = isObject(row && row.session) ? row.session : {};
  const dataQuality = isObject(row && row.dataQuality) ? row.dataQuality : {};
  return text(session.snapshotKind).toLowerCase() === "closing"
    && session.completed === true
    && session.verified === true
    && dataQuality.complete !== false;
}

function roleText(row) {
  return [
    row && row.role,
    row && row.ticketType,
    row && row.dailyRole,
    row && row.identity && row.identity.kind,
    row && row.identity && row.identity.rank,
    row && row.identity && row.identity.role,
    row && row.leadership && row.leadership.identity,
    row && row.leadership && row.leadership.levelLabel,
  ].map(text).filter(Boolean).join("；");
}

function influenceProjection({ row, strict, risk }) {
  const source = isObject(row) ? row : {};
  const classification = isObject(source.classification) ? source.classification : {};
  const identity = isObject(source.identity) ? source.identity : {};
  const session = isObject(source.session) ? source.session : {};
  const state = text(source.state || session.state).toLowerCase();
  const role = roleText(source);
  const board = isObject(source.board) ? source.board : {};
  const pureHeightContext = risk === true || classification.heightRiskBarometer === true && strict !== true;
  const negativeFeedback = verifiedNegativeFeedback(source, state, strict === true);
  const rawPositive = clampScore(session.supportScore);
  const rawNegative = clampScore(session.damageScore);
  const primaryLeader = strict === true && (
    identity.activePrimary === true
    || text(identity.rank).toLowerCase() === "primary"
    || /primary_leader|主龙头|主核心/.test(role.toLowerCase())
  );
  const heightCore = strict === true && (
    finite(board.consecutiveBoards) >= 3
    || finite(board.boardsInWindow) >= 4
    || /高度|高标|height/.test(role.toLowerCase())
  );
  const capacityCore = strict === true && /中军|容量|capacity|zhongjun/.test(role.toLowerCase());
  const repairCore = strict === true && /support|承接|local_repair|divergence_supported|修复/.test(state);
  const riskPressure = strict === true && (
    negativeFeedback
    || heightCore && (/diverg|realization|分歧|兑现/.test(state) || rawNegative >= 20)
    || /风险|risk/.test(role.toLowerCase())
  );
  const riskCore = riskPressure;
  const coreRoles = {
    primaryLeader,
    heightCore,
    capacityCore,
    repairCore,
    riskCore,
  };
  let voteRole = "candidate_context";
  if (pureHeightContext) voteRole = "height_context";
  else if (riskCore) voteRole = "risk_core";
  else if (primaryLeader) voteRole = "primary_leader";
  else if (capacityCore) voteRole = "capacity_core";
  else if (heightCore) voteRole = "height_core";
  else if (repairCore) voteRole = "repair_core";
  else if (strict === true) voteRole = "co_core";

  const positiveInfluenceScore = strict === true ? rawPositive : 0;
  const negativeInfluenceScore = strict === true
    ? negativeFeedback ? clampScore(rawNegative * 1.2 + 10) : rawNegative
    : 0;
  const riskPressureScore = strict === true && riskPressure
    ? negativeFeedback ? negativeInfluenceScore : Math.max(rawNegative, heightCore ? 25 : 0)
    : 0;
  return {
    positiveInfluenceScore,
    negativeInfluenceScore,
    signedInfluenceScore: Math.round((positiveInfluenceScore - negativeInfluenceScore) * 10) / 10,
    voteRole,
    coreRoles,
    riskPressureScore,
    riskPressureConfirmed: negativeFeedback,
    negativeFeedbackAmplified: negativeFeedback,
    votingWeight: strict === true ? 1 : 0,
    observationOnly: true,
    selectionAuthority: false,
    executionAuthority: false,
  };
}

const STRICT_ROLE_PRIORITY = Object.freeze({
  risk_core: 600,
  primary_leader: 500,
  capacity_core: 400,
  height_core: 300,
  repair_core: 200,
  co_core: 100,
});

function selectStrictCoreBasket(rows) {
  const sourceRows = list(rows).slice();
  const ranked = sourceRows.sort((left, right) => {
    const roleGap = (STRICT_ROLE_PRIORITY[right.voteRole] || 0) - (STRICT_ROLE_PRIORITY[left.voteRole] || 0);
    if (roleGap) return roleGap;
    const impactGap = (finite(right.identity && right.identity.validImpactDays) || 0)
      - (finite(left.identity && left.identity.validImpactDays) || 0);
    if (impactGap) return impactGap;
    const influenceGap = Math.max(right.positiveInfluenceScore || 0, right.negativeInfluenceScore || 0)
      - Math.max(left.positiveInfluenceScore || 0, left.negativeInfluenceScore || 0);
    if (influenceGap) return influenceGap;
    return text(left.code).localeCompare(text(right.code));
  });
  if (ranked.length <= MAX_STRICT_EMOTION_CORES) return ranked;
  const riskCore = ranked.find((row) => row.voteRole === "risk_core") || null;
  if (!riskCore) return ranked.slice(0, MAX_STRICT_EMOTION_CORES);
  return [riskCore, ...ranked.filter((row) => row.code !== riskCore.code)
    .slice(0, MAX_STRICT_EMOTION_CORES - 1)];
}

function projectCandidate(row, expected, options = {}) {
  const projected = clone(row, {});
  projected.code = text(row && row.code);
  projected.name = text(row && row.name) || projected.code;
  projected.state = text(row && (row.state || row.session && row.session.state)) || "unknown";
  projected.currentState = projected.state;
  projected.supportScore = finite(row && row.session && row.session.supportScore);
  projected.damageScore = finite(row && row.session && row.session.damageScore);
  projected.identitySource = text(row && row.identity && row.identity.source)
    || text(row && row.qualification && row.qualification.authority)
    || "unknown";
  projected.sessionSource = text(row && row.session && row.session.source) || "unknown";
  projected.source = projected.identitySource;
  projected.contractAsOf = expected.asOf;
  projected.identitySourceAsOf = text(row && row.identity && row.identity.sourceAsOf) || null;
  projected.sessionSourceAsOf = text(row && row.session && row.session.sourceAsOf) || null;
  projected.sourceAsOf = projected.sessionSourceAsOf || projected.identitySourceAsOf;
  projected.generationId = expected.generationId;
  projected.tradingDate = expected.tradingDate;
  projected.asOf = expected.asOf;
  projected.contractVersion = EMOTION_CORE_EVIDENCE_CONTRACT_VERSION;
  Object.assign(projected, influenceProjection({
    row: projected,
    strict: projected.classification && projected.classification.strictEmotionCore === true,
    risk: options.risk === true,
  }));
  projected.classification = {
    ...(projected.classification || {}),
    riskCore: projected.coreRoles && projected.coreRoles.riskCore === true,
  };
  if (isObject(projected.qualification)) projected.qualification.version = STRICT_CORE_CLASSIFIER_VERSION;
  if (isObject(projected.identity)) projected.identity.voteRole = projected.voteRole;
  return projected;
}

function emptyRollup() {
  return { count: 0, codes: [], names: [], rows: [] };
}

function rollup(rows, predicate) {
  const selected = rows.filter(predicate).map((row) => ({
    code: row.code,
    name: row.name,
    state: row.currentState || row.state || "unknown",
    supportScore: row.supportScore,
    damageScore: row.damageScore,
    theme: clone(row.theme, {}),
    source: row.source || "unknown",
    asOf: row.asOf || null,
    evidence: clone(row.evidence, []),
    positiveInfluenceScore: row.positiveInfluenceScore,
    negativeInfluenceScore: row.negativeInfluenceScore,
    signedInfluenceScore: row.signedInfluenceScore,
    riskPressureScore: row.riskPressureScore,
    riskPressureConfirmed: row.riskPressureConfirmed,
    voteRole: row.voteRole,
    executionAuthority: false,
  }));
  return {
    count: selected.length,
    codes: selected.map((row) => row.code),
    names: selected.map((row) => row.name),
    rows: selected,
  };
}

function normalizedState(row) {
  return text(row && (row.currentState || row.state || row.session && row.session.state)).toLowerCase();
}

function influenceSummary(rows) {
  const cores = list(rows);
  const positiveTotal = Math.round(cores.reduce((sum, row) => sum + clampScore(row.positiveInfluenceScore), 0) * 10) / 10;
  const negativeTotal = Math.round(cores.reduce((sum, row) => sum + clampScore(row.negativeInfluenceScore), 0) * 10) / 10;
  const signedTotal = Math.round((positiveTotal - negativeTotal) * 10) / 10;
  const positiveCount = cores.filter((row) => Number(row.signedInfluenceScore) > 5).length;
  const negativeCount = cores.filter((row) => Number(row.signedInfluenceScore) < -5).length;
  const neutralCount = Math.max(0, cores.length - positiveCount - negativeCount);
  return {
    positiveTotal,
    negativeTotal,
    signedTotal,
    positiveCount,
    negativeCount,
    neutralCount,
    winner: signedTotal > 5 ? "positive" : signedTotal < -5 ? "negative" : "mixed",
    calibrated: false,
    unit: "rule_impact_points",
  };
}

function summaryFrom(strictRows, riskRows) {
  const participating = rollup(strictRows, (row) => /participat|normal|active|正常参与/.test(normalizedState(row)));
  return {
    strictCoreCount: strictRows.length,
    heightRiskBarometerCount: riskRows.length,
    riskBarometerCount: riskRows.length,
    participating,
    neutral: participating,
    divergent: rollup(strictRows, (row) => /diverg|分歧/.test(normalizedState(row))),
    support: rollup(strictRows, (row) => /support|承接|local_repair|divergence_supported/.test(normalizedState(row))),
    supported: rollup(strictRows, (row) => /support|承接|local_repair|divergence_supported/.test(normalizedState(row))),
    repairFailed: rollup(strictRows, (row) => /repair_failed|negative_feedback|修复失败|负反馈/.test(normalizedState(row))),
    unknown: rollup(strictRows, (row) => !normalizedState(row) || /unknown|pending|待确认/.test(normalizedState(row))),
    influence: influenceSummary(strictRows),
  };
}

function unavailableResult(input, expected, reasonCodes) {
  const summary = {
    strictCoreCount: 0,
    heightRiskBarometerCount: 0,
    riskBarometerCount: 0,
    participating: emptyRollup(),
    neutral: emptyRollup(),
    divergent: emptyRollup(),
    support: emptyRollup(),
    supported: emptyRollup(),
    repairFailed: emptyRollup(),
    unknown: emptyRollup(),
    influence: influenceSummary([]),
  };
  return {
    version: EMOTION_CORE_EVIDENCE_CONTRACT_VERSION,
    contractVersion: EMOTION_CORE_EVIDENCE_CONTRACT_VERSION,
    method: "strict_emotion_core_evidence_v2",
    calibrated: false,
    status: "unavailable",
    generation: {
      id: expected.generationId || null,
      generationId: expected.generationId || null,
      tradingDate: expected.tradingDate || null,
      asOf: expected.asOf || null,
    },
    generationId: expected.generationId || null,
    tradingDate: expected.tradingDate || null,
    asOf: expected.asOf || null,
    marketCycle: null,
    themeCycles: [],
    strictEmotionCores: [],
    heightRiskBarometers: [],
    coreCandidates: [],
    summary,
    decision: clone(input && input.existingDecision, {}),
    integrity: {
      poolsDisjoint: true,
      namedRowsBackSummary: true,
      sameGeneration: false,
      strictRowsQualifiedOnly: true,
      riskRowsCannotVote: true,
      strictCoreBasketMaxFive: true,
      scoreSummaryDerivedFromRows: true,
      finalEmotionStageUnchanged: true,
      tradePermissionUnchanged: true,
    },
    guardrails: {
      emotionStageAuthority: false,
      executionAuthority: false,
      riskBarometerVoteEligible: false,
      riskCoreSelectionAuthority: false,
      strictCoreBasketMaximum: MAX_STRICT_EMOTION_CORES,
      summaryDerivedFromItems: true,
    },
    dataQuality: {
      failClosed: true,
      usable: false,
      reasonCodes: uniqueStrings(reasonCodes),
      rejectedRows: [],
    },
  };
}

function buildEmotionCoreEvidenceContract(input = {}) {
  const expected = expectedMeta(input);
  const lineageReasonCodes = validateLineage(input, expected);
  if (lineageReasonCodes.length) return unavailableResult(input, expected, lineageReasonCodes);

  const strictByCode = new Map();
  const riskByCode = new Map();
  const candidateByCode = new Map();
  const rejectedRows = [];
  const outputThemes = [];

  list(input.themeCycles).forEach((group) => {
    const groupStrict = [];
    const groupRisk = [];
    const groupCandidates = [];
    list(group && group.candidates).forEach((row) => {
      const code = text(row && row.code);
      if (!code) {
        rejectedRows.push({ code: null, name: text(row && row.name) || null, reasonCodes: ["code_missing"] });
        return;
      }
      const inputClassification = isObject(row.classification) ? row.classification : {};
      const strictClassification = inputClassification.strictEmotionCore === true;
      const riskClassification = inputClassification.heightRiskBarometer === true && !strictClassification;
      const classification = {
        ...inputClassification,
        strictEmotionCore: strictClassification,
        heightRiskBarometer: riskClassification,
      };
      const normalizedRow = { ...row, classification };
      if (classification.coreCandidate === true && !candidateByCode.has(code)) {
        const projected = projectCandidate(normalizedRow, expected, { risk: riskClassification });
        candidateByCode.set(code, projected);
        groupCandidates.push(projected);
      }

      if (classification.strictEmotionCore === true) {
        const reasonCodes = requiredTraceReasonCodes(normalizedRow);
        if (reasonCodes.length) {
          rejectedRows.push({ code, name: text(row.name) || code, reasonCodes });
        } else if (!strictByCode.has(code)) {
          const projected = projectCandidate(normalizedRow, expected);
          strictByCode.set(code, projected);
          groupStrict.push(projected);
        }
      }

      if (classification.heightRiskBarometer === true && !riskByCode.has(code)) {
        const projected = projectCandidate(normalizedRow, expected, { risk: true });
        riskByCode.set(code, projected);
        groupRisk.push(projected);
      }
    });

    outputThemes.push({
      theme: clone(group && group.theme, {}),
      cycle: clone(group && group.cycle, {}),
      strictEmotionCores: groupStrict,
      heightRiskBarometers: groupRisk.filter((row) => !strictByCode.has(row.code)),
      coreCandidates: groupCandidates,
    });
  });

  const allStrictEmotionCores = [...strictByCode.values()];
  const strictEmotionCores = selectStrictCoreBasket(allStrictEmotionCores);
  const strictCodes = new Set(strictEmotionCores.map((row) => row.code));
  const strictOrder = new Map(strictEmotionCores.map((row, index) => [row.code, index]));
  const heightRiskBarometers = [...riskByCode.values()].filter((row) => !strictCodes.has(row.code));
  outputThemes.forEach((group) => {
    group.strictEmotionCores = group.strictEmotionCores
      .filter((row) => strictCodes.has(row.code))
      .sort((left, right) => (strictOrder.get(left.code) || 0) - (strictOrder.get(right.code) || 0));
    group.heightRiskBarometers = group.heightRiskBarometers.filter((row) => !strictCodes.has(row.code));
  });
  const summary = summaryFrom(strictEmotionCores, heightRiskBarometers);
  summary.strictCandidateCount = allStrictEmotionCores.length;
  summary.selectedCoreCount = strictEmotionCores.length;
  summary.excludedByLimitCount = Math.max(0, allStrictEmotionCores.length - strictEmotionCores.length);
  const poolsDisjoint = heightRiskBarometers.every((row) => !strictCodes.has(row.code));
  const namedRowsBackSummary = [summary.divergent, summary.support, summary.repairFailed, summary.participating, summary.unknown]
    .every((group) => group.count === group.rows.length && group.rows.every((row) => row.code && row.name));
  const riskRowsCannotVote = [
    ...heightRiskBarometers,
    ...[...candidateByCode.values()].filter((row) => row.classification && row.classification.heightRiskBarometer === true),
  ].every((row) => row.votingWeight === 0);
  const status = strictEmotionCores.length || heightRiskBarometers.length ? "ready" : "insufficient";

  return {
    version: EMOTION_CORE_EVIDENCE_CONTRACT_VERSION,
    contractVersion: EMOTION_CORE_EVIDENCE_CONTRACT_VERSION,
    method: "strict_emotion_core_evidence_v2",
    calibrated: false,
    status,
    generation: {
      id: expected.generationId,
      generationId: expected.generationId,
      tradingDate: expected.tradingDate,
      asOf: expected.asOf,
    },
    generationId: expected.generationId,
    tradingDate: expected.tradingDate,
    asOf: expected.asOf,
    marketCycle: clone(input.marketCycle, {}),
    themeCycles: outputThemes,
    strictEmotionCores,
    heightRiskBarometers,
    coreCandidates: [...candidateByCode.values()],
    summary,
    decision: clone(input.existingDecision, {}),
    integrity: {
      poolsDisjoint,
      namedRowsBackSummary,
      sameGeneration: true,
      strictRowsQualifiedOnly: strictEmotionCores.every((row) => (
        row.qualification && row.qualification.passed === true
        && row.qualification.authority === STRICT_AUTHORITY
        && row.identity && row.identity.authority === STRICT_AUTHORITY
      )),
      riskRowsCannotVote,
      strictCoreBasketMaxFive: strictEmotionCores.length <= MAX_STRICT_EMOTION_CORES,
      scoreSummaryDerivedFromRows: true,
      finalEmotionStageUnchanged: true,
      tradePermissionUnchanged: true,
    },
    guardrails: {
      emotionStageAuthority: false,
      executionAuthority: false,
      riskBarometerVoteEligible: false,
      riskCoreSelectionAuthority: false,
      strictCoreBasketMaximum: MAX_STRICT_EMOTION_CORES,
      summaryDerivedFromItems: true,
    },
    dataQuality: {
      failClosed: false,
      usable: status === "ready",
      reasonCodes: status === "ready" ? [] : ["strict_core_evidence_insufficient"],
      rejectedRows,
      strictCoreRowsBeforeLimit: allStrictEmotionCores.length,
      strictCoreRowsExcludedByLimit: Math.max(0, allStrictEmotionCores.length - strictEmotionCores.length),
    },
  };
}

function stockCode(value) {
  return text(value && (value.code || value.secCode || value.symbol));
}

function stockName(value, fallback = "") {
  return text(value && value.name) || fallback;
}

function anchorState(anchor, item) {
  const participation = isObject(anchor && anchor.participation) ? anchor.participation : {};
  const direct = text(participation.individualState).toLowerCase();
  if (direct) return direct;
  const stage = text(item && (item.sentimentStage || item.stage)).toLowerCase();
  if (stage === "negative_feedback") return "repair_failed";
  if (stage === "supported" || stage === "consensus_resume" || stage === "weak_to_strong") return "support";
  return stage || "unknown";
}

function anchorScore(anchor, side) {
  const participation = isObject(anchor && anchor.participation) ? anchor.participation : {};
  const facts = isObject(participation.facts) ? participation.facts : {};
  const bucket = isObject(anchor && anchor[side]) ? anchor[side] : {};
  return finite(side === "support" ? facts.supportScore : facts.damageScore) ?? finite(bucket.score);
}

function metadata(expected) {
  return {
    generationId: expected.generationId,
    tradingDate: expected.tradingDate,
    asOf: expected.asOf,
    contractVersion: EMOTION_CORE_EVIDENCE_CONTRACT_VERSION,
  };
}

function buildThemeProjection(theme, expected) {
  const name = text(theme && theme.name) || text(theme && theme.id) || "题材待确认";
  const parent = text(theme && theme.family) || text(theme && theme.id) || name;
  const fine = name && name !== parent ? name : null;
  const relatedOnly = theme && theme.relatedOnly === true;
  return {
    key: text(theme && (theme.id || theme.family || theme.name)) || name,
    fine,
    fineThemeName: fine,
    parent,
    parentThemeName: parent,
    label: name,
    currentExpression: name,
    sectorBenchmark: text(theme && theme.sector && theme.sector.name) || null,
    attributionStatus: text(theme && theme.attributionStatus)
      || (relatedOnly ? "risk_relation_only" : fine ? "theme_library_expression" : "parent_verified_fine_pending"),
    authority: text(theme && theme.attributionAuthority)
      || (relatedOnly ? "risk_relation_only" : STRICT_AUTHORITY),
    relatedOnly,
    sourceAsOf: text(theme && theme.sourceAsOf) || null,
    ...metadata(expected),
  };
}

function buildCycleProjection(theme, identity, expected) {
  const leadership = isObject(theme && theme.cycleLeadership) ? theme.cycleLeadership : {};
  const cycleInstanceId = text(leadership.cycleInstanceId)
    || text(identity && identity.cycleInstanceId)
    || `theme-cycle-unavailable:${text(theme && (theme.id || theme.name)) || "unknown"}`;
  const state = text(identity && identity.state) || text(leadership.state) || "unknown";
  return {
    key: cycleInstanceId,
    label: `${text(theme && theme.name) || "题材"}·${state}`,
    state,
    cycleInstanceId,
    marketKey: "market-structural-cycle",
    themeKey: text(theme && (theme.id || theme.family || theme.name)) || "unknown",
    settledTradingDate: text(leadership.settledTradingDate) || expected.tradingDate,
    frozen: leadership.frozen === true || identity && identity.frozen === true,
    sourceAsOf: text(theme && theme.sourceAsOf) || null,
    ...metadata(expected),
  };
}

function currentSessionOf(candidate) {
  const kline = isObject(candidate && candidate.klineProfile) ? candidate.klineProfile : {};
  return isObject(kline.lastSession) ? kline.lastSession : {};
}

function exactCompletedSession(candidate, expected) {
  const session = currentSessionOf(candidate);
  return text(session.tradingDate) === expected.tradingDate
    && session.completed === true
    && session.verified === true
    && text(session.snapshotKind).toLowerCase() === "closing";
}

function evidenceRowsFor(candidate, identity, anchor, item, expected, strict) {
  const rows = [];
  const add = (key, value, source) => rows.push({ key, value, source, ...metadata(expected) });
  if (strict) {
    add("cycle_identity_established", true, "theme_cycle_leadership");
    add("active_primary", identity && identity.activePrimary === true, "theme_cycle_leadership");
    add("cycle_identity_state", text(identity && identity.state) || "unknown", "theme_cycle_leadership");
    const dates = uniqueStrings(identity && (identity.confirmedTradingDates || identity.evidenceDates));
    if (dates.length) add("confirmed_trading_dates", dates, "theme_cycle_leadership");
    if (finite(identity && identity.validImpactDays) !== null) {
      add("valid_impact_days", finite(identity.validImpactDays), "theme_cycle_leadership");
    }
  } else {
    add("height_risk_only", true, "height_risk_trace");
  }
  const participation = isObject(anchor && anchor.participation) ? anchor.participation : {};
  if (text(participation.individualState)) add("current_state", text(participation.individualState), "emotion_anchor_session");
  if (anchorScore(anchor, "support") !== null) add("support_score", anchorScore(anchor, "support"), "emotion_anchor_session");
  if (anchorScore(anchor, "damage") !== null) add("damage_score", anchorScore(anchor, "damage"), "emotion_anchor_session");
  const itemEvidence = list(item && item.lifecycle && item.lifecycle.evidence).map((row) => text(row && (row.detail || row.label || row))).filter(Boolean);
  if (itemEvidence.length) add("core_lifecycle_evidence", itemEvidence.slice(0, 3), "core_emotion_lifecycle");
  const session = currentSessionOf(candidate);
  if (session.completed === true) add("closing_session_completed", true, text(session.source) || "unknown");
  return rows;
}

function normalizedCandidateRow({ candidate, identity, leadership, theme, anchor, item, expected, strict, risk, coreCandidate }) {
  const code = stockCode(candidate) || text(identity && identity.code) || stockCode(anchor) || stockCode(item);
  const name = stockName(candidate, stockName(anchor, stockName(item, code)));
  const themeProjection = buildThemeProjection(theme, expected);
  const cycleProjection = buildCycleProjection(theme, identity, expected);
  const priceDiscovery = isObject(anchor && anchor.priceDiscovery) ? anchor.priceDiscovery : {};
  const session = currentSessionOf(candidate);
  const eventEvidenceEligible = priceDiscovery.eventEvidenceEligible === true;
  const state = anchorState(anchor, item);
  const qualificationReasons = strict
    ? ["题材周期身份已建立", "至少2个有效影响日", "周期实例对齐", "同交易日完整收盘"]
    : [risk ? "仅确认高度风险观察身份，未取得严格情绪核心资格" : "题材周期核心资格尚未建立"];
  const normalized = {
    code,
    name,
    classification: {
      strictEmotionCore: strict,
      heightRiskBarometer: risk,
      coreCandidate: coreCandidate || strict,
    },
    qualification: {
      passed: strict,
      authority: STRICT_AUTHORITY,
      version: STRICT_CORE_CLASSIFIER_VERSION,
      reasons: qualificationReasons,
      ...metadata(expected),
    },
    theme: themeProjection,
    cycle: cycleProjection,
    identity: {
      kind: strict ? "cycle_emotion_core" : risk ? "height_risk_barometer" : "cycle_core_candidate",
      authority: STRICT_AUTHORITY,
      rank: strict ? (identity && identity.activePrimary === true ? "primary" : "co_core") : risk ? "risk_watch" : "candidate",
      source: strict ? "cross_session_identity" : risk ? "height_risk_trace" : "theme_cycle_candidate",
      evidence: strict
        ? identity && identity.activePrimary === true
          ? ["跨日题材周期身份已确认", "当前为该题材唯一主核心"]
          : ["跨日题材周期身份已确认", "当前为市场共同情绪核心，不代表题材唯一主核心"]
        : [risk ? "高度与负反馈只作风险观察" : "尚未达到跨日主核心确认门槛"],
      active: strict,
      activePrimary: identity && identity.activePrimary === true,
      state: text(identity && identity.state) || "candidate",
      cycleInstanceId: cycleProjection.cycleInstanceId,
      confirmedTradingDates: uniqueStrings(identity && identity.confirmedTradingDates),
      evidenceDates: uniqueStrings(identity && identity.evidenceDates),
      validImpactDays: finite(identity && identity.validImpactDays),
      sourceAsOf: text(theme && theme.sourceAsOf) || null,
      ...metadata(expected),
    },
    session: {
      state,
      supportScore: anchorScore(anchor, "support"),
      damageScore: anchorScore(anchor, "damage"),
      source: text(priceDiscovery.source) || text(session.source) || "unknown",
      snapshotKind: text(session.snapshotKind) || "unknown",
      completed: session.completed === true,
      verified: session.verified === true,
      sessionGranularity: text(priceDiscovery.sessionGranularity) || (session.completed === true ? "closing" : "unknown"),
      eventEvidenceEligible,
      sourceAsOf: text(session.asOf || session.updatedAt) || null,
      ...metadata(expected),
    },
    evidence: evidenceRowsFor(candidate, identity, anchor, item, expected, strict),
    dataQuality: {
      grade: eventEvidenceEligible ? "verified_intraday" : session.completed === true ? "closing_path_verified_event_pending" : "degraded",
      source: text(priceDiscovery.source) || text(session.source) || "unknown",
      complete: session.completed === true && session.verified === true,
      eventEvidenceEligible,
      ...metadata(expected),
    },
    state,
    board: clone(anchor && anchor.board, null),
  };
  Object.assign(normalized, influenceProjection({
    row: {
      ...normalized,
      role: candidate && candidate.role,
      ticketType: candidate && candidate.ticketType,
      dailyRole: candidate && candidate.dailyRole,
      leadership: candidate && candidate.leadership,
      identity: {
        ...normalized.identity,
        role: identity && identity.role,
      },
    },
    strict,
    risk,
  }));
  normalized.classification.riskCore = normalized.coreRoles.riskCore === true;
  normalized.identity.voteRole = normalized.voteRole;
  return normalized;
}

function syntheticRiskTheme(candidate, anchor, expected) {
  const related = text(candidate && candidate.mainConcept)
    || text(anchor && anchor.direction)
    || "题材主归属待确认";
  return {
    id: `risk-related:${related}`,
    name: related,
    family: text(candidate && candidate.mainFamily) || related,
    sector: { name: "仅作风险关联，不代表主归属" },
    relatedOnly: true,
    attributionStatus: "risk_relation_only",
    attributionAuthority: "risk_relation_only",
    cycleLeadership: {
      state: "risk_observation_only",
      cycleInstanceId: `risk-observation:${related}:${expected.tradingDate}`,
      frozen: false,
    },
  };
}

function validIsoTime(value) {
  const raw = text(value);
  if (!raw) return null;
  const millis = Date.parse(raw);
  return Number.isFinite(millis) ? millis : null;
}

function themeLibraryPreflight(themeLibrary, expected) {
  const reasonCodes = [];
  if (themeLibrary.available !== true) reasonCodes.push("theme_library_not_available");
  if (themeLibrary.stale !== false) reasonCodes.push("theme_library_stale_or_unknown");
  if (finite(themeLibrary.schemaVersion) === null) reasonCodes.push("theme_library_schema_version_missing");
  const classifierVersion = text(themeLibrary.classifierVersion);
  if (!classifierVersion) reasonCodes.push("theme_library_classifier_version_missing");
  else if (!SUPPORTED_THEME_LIBRARY_CLASSIFIERS.has(classifierVersion)) {
    reasonCodes.push("theme_library_classifier_version_unsupported");
  }

  const tradingDate = text(themeLibrary.tradingDate);
  if (!tradingDate) reasonCodes.push("theme_library_trading_date_missing");
  else if (tradingDate !== expected.tradingDate) reasonCodes.push("theme_library_trading_date_mismatch");

  const snapshotKind = text(themeLibrary.snapshotKind).toLowerCase();
  if (!snapshotKind) reasonCodes.push("theme_library_snapshot_kind_missing");
  else if (snapshotKind !== "closing") reasonCodes.push("theme_library_not_closing");

  const generatedAt = text(themeLibrary.generatedAt);
  const generatedMillis = validIsoTime(generatedAt);
  if (!generatedAt) reasonCodes.push("theme_library_generated_at_missing");
  else if (generatedMillis === null) reasonCodes.push("theme_library_generated_at_invalid");
  else if (generatedAt !== expected.asOf) {
    reasonCodes.push("theme_library_generated_at_mismatch");
  }

  const sourceGenerationId = text(themeLibrary.generationId);
  if (!sourceGenerationId) reasonCodes.push("theme_library_generation_missing");
  else if (sourceGenerationId !== expected.generationId) {
    reasonCodes.push("theme_library_generation_mismatch");
  }
  if (!Array.isArray(themeLibrary.themes)) reasonCodes.push("theme_library_themes_missing");
  return uniqueStrings(reasonCodes);
}

function boardValue(anchor, compact, key) {
  const anchorBoard = isObject(anchor && anchor.board) ? anchor.board : {};
  const compactBoard = isObject(compact && compact.board) ? compact.board : {};
  return Math.max(
    finite(anchorBoard[key]) || 0,
    finite(compactBoard[key]) || 0,
    key === "consecutiveBoards" ? (finite(compact && compact.consecutiveBoards) || 0) : 0,
    key === "boardsInWindow" ? (finite(compact && compact.boardsInWindow) || 0) : 0,
  );
}

function qualifiesHeightRisk(anchor, compact) {
  if (anchor && anchor.classification && anchor.classification.heightRiskBarometerVerified === true) return true;
  return boardValue(anchor, compact, "consecutiveBoards") >= 3
    || boardValue(anchor, compact, "boardsInWindow") >= 4;
}

function qualifiesCoreCandidate(identity, leadership, code, cycleAligned) {
  if (!cycleAligned || !isObject(identity) || identity.frozen === true) return false;
  const state = text(identity.state).toLowerCase();
  if (["expired", "replaced"].includes(state)) return false;
  const validImpactDays = finite(identity.validImpactDays) || uniqueStrings(identity.impactTradingDates).length;
  const consecutiveNoImpactDays = finite(identity.consecutiveNoImpactDays) || 0;
  const primaryCode = text(leadership && leadership.primary && leadership.primary.code);
  const challengerCode = text(leadership && leadership.challenger && leadership.challenger.code);
  return validImpactDays >= 1
    && consecutiveNoImpactDays < 3
    && (code === primaryCode || code === challengerCode || identity.identityEstablished === true);
}

function transitionUnavailable(expectedPreviousTradingDate, reason = "previous_strict_core_contract_unavailable_or_not_same_version") {
  return {
    status: "unavailable",
    reason,
    expectedPreviousTradingDate: text(expectedPreviousTradingDate) || null,
    sameVersion: false,
    previous: null,
    current: null,
  };
}

function completeRowMetaMatches(row, expected) {
  return Boolean(
    isObject(row)
    && text(row.generationId) === expected.generationId
    && text(row.tradingDate) === expected.tradingDate
    && text(row.asOf) === expected.asOf
    && finite(row.contractVersion) === EMOTION_CORE_EVIDENCE_CONTRACT_VERSION,
  );
}

function previousRowLineageMatches(row, expected) {
  if (!completeRowMetaMatches(row, expected)) return false;
  const nested = [row.qualification, row.theme, row.cycle, row.identity, row.session, row.dataQuality];
  if (nested.some((entry) => !completeRowMetaMatches(entry, expected))) return false;
  const evidenceRows = Array.isArray(row.evidence) ? row.evidence : null;
  if (!evidenceRows || evidenceRows.some((entry) => !completeRowMetaMatches(entry, expected))) return false;

  const currentStateEvidence = evidenceRows.find((entry) => text(entry && entry.key) === "current_state");
  const states = [
    row.currentState,
    row.state,
    row.session && row.session.state,
    currentStateEvidence && currentStateEvidence.value,
  ].map((value) => text(value).toLowerCase()).filter(Boolean);
  if (!states.length || new Set(states).size !== 1) return false;

  const noLaterThanEvidence = (value) => {
    const timestamp = text(value);
    if (!timestamp) return true;
    const millis = Date.parse(timestamp);
    const expectedMillis = Date.parse(expected.asOf);
    return Number.isFinite(millis)
      && Number.isFinite(expectedMillis)
      && millis <= expectedMillis
      && shanghaiTradingDateFromTimestamp(timestamp) <= expected.tradingDate;
  };
  if ([
    row.contractAsOf,
    row.identitySourceAsOf,
    row.sessionSourceAsOf,
    row.sourceAsOf,
    row.theme && row.theme.sourceAsOf,
    row.cycle && row.cycle.sourceAsOf,
    row.identity && row.identity.sourceAsOf,
    row.session && row.session.sourceAsOf,
  ].some((value) => !noLaterThanEvidence(value))) return false;

  const historicalDates = [
    row.cycle && row.cycle.settledTradingDate,
    ...list(row.identity && row.identity.confirmedTradingDates),
    ...list(row.identity && row.identity.evidenceDates),
  ].map(text).filter(Boolean);
  if (historicalDates.some((date) => date > expected.tradingDate)) return false;

  const strict = row.classification && row.classification.strictEmotionCore === true;
  if (strict && (
    text(row.session && row.session.snapshotKind).toLowerCase() !== "closing"
    || row.session.completed !== true
    || row.session.verified !== true
    || !currentStateEvidence
  )) return false;
  return true;
}

function uniqueCodeSet(rows) {
  const codes = list(rows).map((row) => text(row && row.code)).filter(Boolean);
  return codes.length === new Set(codes).size ? new Set(codes) : null;
}

function sameCodeSet(left, right) {
  if (!(left instanceof Set) || !(right instanceof Set) || left.size !== right.size) return false;
  return [...left].every((code) => right.has(code));
}

function shanghaiTradingDateFromTimestamp(value) {
  const timestamp = text(value);
  const millis = Date.parse(timestamp);
  if (!timestamp || !Number.isFinite(millis)) return null;
  return new Date(millis + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function evidenceAsOfMatchesTradingDate(previousEvidence, expectedTradingDate) {
  return evidenceAsOfAssessment(previousEvidence, expectedTradingDate) === "valid";
}

function evidenceAsOfAssessment(previousEvidence, expectedTradingDate) {
  const expectedDate = text(expectedTradingDate);
  if (!expectedDate) return "incomplete";
  const generation = isObject(previousEvidence && previousEvidence.generation)
    ? previousEvidence.generation
    : {};
  const basis = isObject(previousEvidence && previousEvidence.basis)
    ? previousEvidence.basis
    : {};
  const timestamps = [
    previousEvidence && previousEvidence.asOf,
    generation.asOf,
    basis.asOf,
  ].map(text);
  const dates = timestamps.map(shanghaiTradingDateFromTimestamp);
  if (timestamps.some((timestamp) => !timestamp) || dates.some((date) => !date)) return "incomplete";
  if (dates.some((date) => date > expectedDate)) return "future";
  return dates.every((date) => date === expectedDate) ? "valid" : "incomplete";
}

function validatePreviousEvidence(previousEvidence, expectedPreviousTradingDate, classifierVersion) {
  if (!isObject(previousEvidence) || previousEvidence.status !== "ready") return null;
  if (finite(previousEvidence.contractVersion) !== EMOTION_CORE_EVIDENCE_CONTRACT_VERSION) return null;
  if (text(previousEvidence.lineage && previousEvidence.lineage.classifierVersion) !== classifierVersion) return null;

  const expected = {
    generationId: text(previousEvidence.generationId),
    tradingDate: text(previousEvidence.tradingDate),
    asOf: text(previousEvidence.asOf),
  };
  if (!text(expectedPreviousTradingDate) || expected.tradingDate !== text(expectedPreviousTradingDate)) return null;
  if (!expected.generationId || !expected.asOf) return null;
  if (!evidenceAsOfMatchesTradingDate(previousEvidence, expected.tradingDate)) return null;

  const generation = isObject(previousEvidence.generation) ? previousEvidence.generation : {};
  if (text(generation.id) !== expected.generationId
    || text(generation.generationId) !== expected.generationId
    || text(generation.tradingDate) !== expected.tradingDate
    || text(generation.asOf) !== expected.asOf) return null;

  const basis = isObject(previousEvidence.basis) ? previousEvidence.basis : {};
  if (text(basis.snapshotKind).toLowerCase() !== "closing"
    || text(basis.tradingDate) !== expected.tradingDate
    || text(basis.asOf) !== expected.asOf) return null;

  const strictRows = Array.isArray(previousEvidence.strictEmotionCores) ? previousEvidence.strictEmotionCores : null;
  const riskRows = Array.isArray(previousEvidence.heightRiskBarometers) ? previousEvidence.heightRiskBarometers : null;
  const candidateRows = Array.isArray(previousEvidence.coreCandidates) ? previousEvidence.coreCandidates : null;
  const themeCycles = Array.isArray(previousEvidence.themeCycles) ? previousEvidence.themeCycles : null;
  if (!strictRows || !riskRows || !candidateRows || !themeCycles) return null;

  const nestedStrictRows = themeCycles.flatMap((group) => (
    Array.isArray(group && group.strictEmotionCores) ? group.strictEmotionCores : []
  ));
  const nestedRiskRows = themeCycles.flatMap((group) => (
    Array.isArray(group && group.heightRiskBarometers) ? group.heightRiskBarometers : []
  ));
  const nestedCandidateRows = themeCycles.flatMap((group) => (
    Array.isArray(group && group.coreCandidates) ? group.coreCandidates : []
  ));
  const strictCodes = uniqueCodeSet(strictRows);
  const riskCodes = uniqueCodeSet(riskRows);
  const nestedStrictCodes = uniqueCodeSet(nestedStrictRows);
  const nestedRiskCodes = uniqueCodeSet(nestedRiskRows);
  const candidateCodes = uniqueCodeSet(candidateRows);
  const nestedCandidateCodes = uniqueCodeSet(nestedCandidateRows);
  if (!strictCodes || !riskCodes || !nestedStrictCodes || !nestedRiskCodes || !candidateCodes || !nestedCandidateCodes) return null;
  if (!sameCodeSet(strictCodes, nestedStrictCodes)
    || !sameCodeSet(riskCodes, nestedRiskCodes)
    || !sameCodeSet(candidateCodes, nestedCandidateCodes)
    || [...riskCodes].some((code) => strictCodes.has(code))) return null;

  const strictPool = [...strictRows, ...nestedStrictRows];
  const riskPool = [...riskRows, ...nestedRiskRows];
  const allCandidateRows = [...candidateRows, ...nestedCandidateRows];
  if (strictRows.length > MAX_STRICT_EMOTION_CORES || strictPool.some((row) => (
    !completeRowMetaMatches(row, expected)
    || !row.classification
    || row.classification.strictEmotionCore !== true
    || row.classification.heightRiskBarometer === true
    || row.votingWeight !== 1
    || !row.qualification
    || row.qualification.passed !== true
    || text(row.qualification.authority) !== STRICT_AUTHORITY
    || finite(row.positiveInfluenceScore) === null
    || finite(row.negativeInfluenceScore) === null
    || finite(row.signedInfluenceScore) === null
    || !text(row.voteRole)
    || row.executionAuthority !== false
  ))) return null;
  if (riskPool.some((row) => (
    !completeRowMetaMatches(row, expected)
    || !row.classification
    || row.classification.heightRiskBarometer !== true
    || row.classification.strictEmotionCore === true
    || row.votingWeight !== 0
    || row.positiveInfluenceScore !== 0
    || row.negativeInfluenceScore !== 0
    || row.signedInfluenceScore !== 0
    || text(row.voteRole) !== "height_context"
    || row.executionAuthority !== false
  ))) return null;
  if (allCandidateRows.some((row) => (
    !completeRowMetaMatches(row, expected)
    || row.classification && row.classification.heightRiskBarometer === true && row.votingWeight !== 0
    || row.executionAuthority !== false
  ))) return null;

  const integrity = isObject(previousEvidence.integrity) ? previousEvidence.integrity : {};
  if (integrity.poolsDisjoint !== true
    || integrity.namedRowsBackSummary !== true
    || integrity.sameGeneration !== true
    || integrity.strictRowsQualifiedOnly !== true
    || integrity.riskRowsCannotVote !== true
    || integrity.strictCoreBasketMaxFive !== true
    || integrity.scoreSummaryDerivedFromRows !== true) return null;

  const summary = isObject(previousEvidence.summary) ? previousEvidence.summary : {};
  const influence = isObject(summary.influence) ? summary.influence : {};
  const expectedInfluence = influenceSummary(strictRows);
  if (finite(influence.positiveTotal) !== expectedInfluence.positiveTotal
    || finite(influence.negativeTotal) !== expectedInfluence.negativeTotal
    || finite(influence.signedTotal) !== expectedInfluence.signedTotal
    || finite(influence.positiveCount) !== expectedInfluence.positiveCount
    || finite(influence.negativeCount) !== expectedInfluence.negativeCount
    || finite(influence.neutralCount) !== expectedInfluence.neutralCount
    || text(influence.winner) !== expectedInfluence.winner) return null;

  const guardrails = isObject(previousEvidence.guardrails) ? previousEvidence.guardrails : {};
  if (guardrails.emotionStageAuthority !== false
    || guardrails.executionAuthority !== false
    || guardrails.riskBarometerVoteEligible !== false
    || guardrails.riskCoreSelectionAuthority !== false
    || finite(guardrails.strictCoreBasketMaximum) !== MAX_STRICT_EMOTION_CORES) return null;
  const dataQuality = isObject(previousEvidence.dataQuality) ? previousEvidence.dataQuality : {};
  if (dataQuality.failClosed !== false || dataQuality.usable !== true) return null;
  const historicalReplay = isObject(previousEvidence.historicalReplay)
    ? previousEvidence.historicalReplay
    : null;
  if (historicalReplay && (
    text(historicalReplay.status) !== "fail_closed_current_session_only"
    || text(historicalReplay.tradingDate) !== expected.tradingDate
    || text(historicalReplay.asOf) !== expected.asOf
    || text(historicalReplay.generationId) !== expected.generationId
    || finite(historicalReplay.strictCoreCount) !== strictRows.length
    || finite(historicalReplay.riskBarometerCount) !== riskRows.length
    || historicalReplay.currentSessionContractRecovered !== true
    || historicalReplay.crossDayEmotionStateRecovered !== false
    || historicalReplay.previousArchiveReadAllowed !== false
    || historicalReplay.postCloseReportSkipped !== true
    || historicalReplay.futureDataUsed !== false
    || historicalReplay.emotionStageAuthority !== false
    || historicalReplay.tradePermissionAuthority !== false
  )) return null;
  return {
    strictRows,
    riskRows,
    expected,
    snapshotKind: "closing",
    classifierVersion,
  };
}

function strictCorePhase(strictRows) {
  const rows = list(strictRows);
  if (!rows.length) return { status: "insufficient", key: null, label: null, reason: "strict_core_empty" };
  const counts = {
    negative_feedback: 0,
    divergence: 0,
    support_repair: 0,
    participating: 0,
    unknown: 0,
  };
  const scores = {
    negative_feedback: 0,
    divergence: 0,
    support_repair: 0,
    participating: 0,
  };
  rows.forEach((row) => {
    const state = normalizedState(row);
    if (/repair_failed|negative_feedback|修复失败|负反馈/.test(state)) {
      counts.negative_feedback += 1;
      scores.negative_feedback += Math.max(1, Number(row.negativeInfluenceScore || 0));
    } else if (/support|承接|local_repair|divergence_supported|局部修复/.test(state)) {
      counts.support_repair += 1;
      scores.support_repair += Math.max(1, Number(row.positiveInfluenceScore || 0));
    } else if (/diverg|分歧/.test(state)) {
      counts.divergence += 1;
      scores.divergence += Math.max(
        1,
        Number(row.riskPressureScore || 0),
        Number(row.negativeInfluenceScore || 0),
        Number(row.positiveInfluenceScore || 0),
      );
    } else if (/participat|normal|active|正常参与/.test(state)) {
      counts.participating += 1;
      scores.participating += Math.max(1, Number(row.positiveInfluenceScore || 0));
    }
    else counts.unknown += 1;
  });
  const phases = [
    ["negative_feedback", "负反馈"],
    ["divergence", "分歧"],
    ["support_repair", "承接修复"],
    ["participating", "周期内平稳运行"],
  ];
  const ranked = phases.slice().sort((left, right) => scores[right[0]] - scores[left[0]]);
  const winner = ranked[0];
  const runnerUp = ranked[1];
  if (!winner || scores[winner[0]] <= 0 || scores[winner[0]] === scores[runnerUp[0]]) {
    return {
      status: "insufficient",
      key: null,
      label: null,
      reason: counts.unknown ? "strict_core_state_unknown" : "strict_core_state_mixed_or_tied",
      counts,
      scores,
    };
  }
  return { status: "ready", key: winner[0], label: winner[1], reason: null, counts, scores };
}

function transitionLabel(previous, current) {
  const exact = {
    "divergence:divergence": "昨日分歧 → 今日分歧延续",
    "divergence:support_repair": "昨日分歧 → 今日承接修复",
    "participating:divergence": "昨日周期内平稳运行 → 今日转分歧",
  };
  return exact[`${previous.key}:${current.key}`] || `昨日${previous.label} → 今日${current.label}`;
}

function buildStrictCoreTransition(result, previousEvidence, expectedPreviousTradingDate) {
  const validatedPrevious = validatePreviousEvidence(
    previousEvidence,
    expectedPreviousTradingDate,
    text(result && result.lineage && result.lineage.classifierVersion),
  );
  if (!validatedPrevious) return transitionUnavailable(expectedPreviousTradingDate);
  const previousPhase = strictCorePhase(validatedPrevious.strictRows);
  const currentPhase = strictCorePhase(result && result.strictEmotionCores);
  if (previousPhase.status !== "ready" || currentPhase.status !== "ready") {
    return transitionUnavailable(expectedPreviousTradingDate, "strict_core_phase_unknown");
  }
  const previous = {
    key: previousPhase.key,
    label: previousPhase.label,
    tradingDate: validatedPrevious.expected.tradingDate,
    snapshotKind: validatedPrevious.snapshotKind,
    completed: true,
    contractVersion: EMOTION_CORE_EVIDENCE_CONTRACT_VERSION,
  };
  const current = {
    key: currentPhase.key,
    label: currentPhase.label,
    tradingDate: result.tradingDate,
    snapshotKind: "closing",
    completed: true,
    contractVersion: EMOTION_CORE_EVIDENCE_CONTRACT_VERSION,
  };
  return {
    status: "ready",
    key: `${previous.key}_to_${current.key}`,
    label: transitionLabel(previous, current),
    expectedPreviousTradingDate: text(expectedPreviousTradingDate),
    sameVersion: true,
    previous,
    current,
  };
}

function previousEvidenceAssessment(previousEvidence, expectedPreviousTradingDate, classifierVersion) {
  const expectedDate = text(expectedPreviousTradingDate);
  if (!expectedDate || !isObject(previousEvidence)) {
    return {
      status: "unavailable",
      reasonCodes: ["exact_t1_closing_unavailable"],
      validated: null,
      phase: null,
    };
  }
  const asOfAssessment = evidenceAsOfAssessment(previousEvidence, expectedDate);
  if (asOfAssessment !== "valid") {
    return {
      status: "unavailable",
      reasonCodes: [asOfAssessment === "future"
        ? "previous_evidence_future_dated"
        : "previous_evidence_incomplete"],
      validated: null,
      phase: null,
    };
  }
  const basis = isObject(previousEvidence.basis) ? previousEvidence.basis : {};
  const exactClosing = text(previousEvidence.tradingDate) === expectedDate
    && text(basis.tradingDate) === expectedDate
    && text(basis.snapshotKind).toLowerCase() === "closing";
  if (!exactClosing) {
    return {
      status: "unavailable",
      reasonCodes: ["exact_t1_closing_unavailable"],
      validated: null,
      phase: null,
    };
  }
  const validated = validatePreviousEvidence(previousEvidence, expectedDate, classifierVersion);
  if (!validated) {
    return {
      status: "insufficient",
      reasonCodes: ["previous_evidence_incomplete"],
      validated: null,
      phase: null,
    };
  }
  const phase = strictCorePhase(validated.strictRows);
  if (phase.status !== "ready") {
    return {
      status: "insufficient",
      reasonCodes: ["previous_strict_core_insufficient"],
      validated,
      phase,
    };
  }
  return { status: "ready", reasonCodes: [], validated, phase };
}

function strictPhaseEvidence(strictRows) {
  const summary = summaryFrom(list(strictRows), []);
  return {
    strictCoreCount: summary.strictCoreCount,
    divergent: clone(summary.divergent, emptyRollup()),
    supported: clone(summary.supported, emptyRollup()),
    repairFailed: clone(summary.repairFailed, emptyRollup()),
    participating: clone(summary.participating, emptyRollup()),
    unknown: clone(summary.unknown, emptyRollup()),
  };
}

function riskContext(rows) {
  const projected = list(rows).map((row) => ({
    code: text(row && row.code) || null,
    name: text(row && row.name) || text(row && row.code) || null,
    state: normalizedState(row) || "unknown",
    votingWeight: 0,
    source: text(row && row.source) || "unknown",
    asOf: text(row && row.asOf) || null,
  })).filter((row) => row.code);
  return {
    count: projected.length,
    votingWeight: 0,
    rows: projected,
  };
}

function unavailablePhaseNode(slot, status, tradingDate, reasonCodes, riskRows = [], strictRows = [], phaseReason = null) {
  return {
    slot,
    status,
    key: null,
    label: null,
    tradingDate: text(tradingDate) || null,
    snapshotKind: "closing",
    contractVersion: EMOTION_CORE_EVIDENCE_CONTRACT_VERSION,
    classifierVersion: STRICT_CORE_CLASSIFIER_VERSION,
    evidence: strictPhaseEvidence(strictRows),
    riskContext: riskContext(riskRows),
    phaseReason: text(phaseReason) || null,
    weightedCounts: null,
    weightedScores: null,
    gaps: uniqueStrings(reasonCodes),
  };
}

function readyPhaseNode(slot, phase, strictRows, riskRows, meta) {
  return {
    slot,
    status: "ready",
    key: phase.key,
    label: phase.label,
    tradingDate: text(meta && meta.tradingDate) || null,
    snapshotKind: "closing",
    contractVersion: EMOTION_CORE_EVIDENCE_CONTRACT_VERSION,
    classifierVersion: STRICT_CORE_CLASSIFIER_VERSION,
    evidence: strictPhaseEvidence(strictRows),
    riskContext: riskContext(riskRows),
    weightedCounts: clone(phase.counts, {}),
    weightedScores: clone(phase.scores, {}),
    gaps: [],
  };
}

function uncalibratedTomorrowNode(existingDecision) {
  const decision = isObject(existingDecision) ? existingDecision : {};
  const baseline = isObject(decision.tomorrowBaseline) ? decision.tomorrowBaseline : {};
  const key = text(baseline.key);
  const label = text(baseline.label);
  const available = Boolean(key || label);
  return {
    key: key || null,
    label: label || null,
    status: available ? "baseline_unconfirmed" : "unavailable",
    rank: finite(baseline.rank),
    probability: null,
    calibrated: false,
    trigger: uniqueStrings(baseline.trigger || baseline.triggers),
    cancel: uniqueStrings(baseline.cancel || baseline.cancelConditions),
    source: "existingDecision.tomorrowBaseline",
  };
}

function pathGapText(reasonCode) {
  const labels = {
    exact_t1_closing_unavailable: "缺少 exact T-1 收盘严格核心证据",
    previous_evidence_future_dated: "昨日严格核心证据含未来日期血缘，已拒绝使用",
    previous_evidence_incomplete: "昨日严格核心证据的版本、分类器或同代完整性不足",
    previous_strict_core_insufficient: "昨日严格核心不足，不能确认昨日阶段",
    current_strict_core_insufficient: "今日严格核心不足，不能确认今日阶段",
    tomorrow_baseline_unavailable: "明日未校准基准缺失",
  };
  return labels[reasonCode] || reasonCode;
}

function buildEmotionStagePath(result, previousEvidence, expectedPreviousTradingDate, existingDecision) {
  const classifierVersion = text(result && result.lineage && result.lineage.classifierVersion)
    || STRICT_CORE_CLASSIFIER_VERSION;
  const previousAssessment = previousEvidenceAssessment(
    previousEvidence,
    expectedPreviousTradingDate,
    classifierVersion,
  );
  const currentStrictRows = list(result && result.strictEmotionCores);
  const currentRiskRows = list(result && result.heightRiskBarometers);
  const currentPhase = strictCorePhase(currentStrictRows);
  const currentReady = result && result.status !== "unavailable" && currentPhase.status === "ready";
  const tomorrow = uncalibratedTomorrowNode(existingDecision);
  const reasonCodes = [...previousAssessment.reasonCodes];
  if (!currentReady) reasonCodes.push("current_strict_core_insufficient");
  if (tomorrow.status === "unavailable") reasonCodes.push("tomorrow_baseline_unavailable");

  let status = "ready";
  if (previousAssessment.status === "unavailable") status = "unavailable";
  else if (previousAssessment.status === "insufficient" || !currentReady || tomorrow.status === "unavailable") {
    status = "insufficient";
  }

  const previous = previousAssessment.status === "ready"
    ? readyPhaseNode(
      "previous",
      previousAssessment.phase,
      previousAssessment.validated.strictRows,
      previousAssessment.validated.riskRows,
      previousAssessment.validated.expected,
    )
    : unavailablePhaseNode(
      "previous",
      previousAssessment.status,
      expectedPreviousTradingDate,
      previousAssessment.reasonCodes,
      previousAssessment.validated && previousAssessment.validated.riskRows || [],
      previousAssessment.validated && previousAssessment.validated.strictRows || [],
      previousAssessment.phase && previousAssessment.phase.reason,
    );
  const current = currentReady
    ? readyPhaseNode("current", currentPhase, currentStrictRows, currentRiskRows, {
      tradingDate: result && result.tradingDate,
    })
    : unavailablePhaseNode(
      "current",
      "insufficient",
      result && result.tradingDate,
      ["current_strict_core_insufficient"],
      currentRiskRows,
      currentStrictRows,
      currentPhase.reason,
    );
  const transition = previousAssessment.status === "ready" && currentReady
    ? {
      status: "ready",
      key: `${previousAssessment.phase.key}_to_${currentPhase.key}`,
      label: transitionLabel(previousAssessment.phase, currentPhase),
    }
    : { status, key: null, label: null };

  return {
    version: 1,
    contractVersion: EMOTION_CORE_EVIDENCE_CONTRACT_VERSION,
    method: "strict_core_closing_path_with_uncalibrated_baseline_v1",
    calibrated: false,
    status,
    order: ["previous", "current", "tomorrow"],
    nodes: { previous, current, tomorrow },
    transition,
    gaps: uniqueStrings(reasonCodes).map(pathGapText),
    guardrails: {
      emotionStageAuthority: false,
      selectionPolicyAuthority: false,
      permissionAuthority: false,
      forecastAuthority: false,
    },
    dataQuality: {
      usable: status === "ready",
      reasonCodes: uniqueStrings(reasonCodes),
    },
  };
}

function buildEmotionCoreEvidenceFromPayload(options = {}) {
  const payload = isObject(options.payload) ? options.payload : {};
  const coreEmotionBasket = isObject(options.coreEmotionBasket) ? options.coreEmotionBasket : {};
  const phaseDetail = isObject(options.marketPhaseDetail) ? options.marketPhaseDetail : {};
  const generation = isObject(options.generation) ? options.generation : {};
  const expected = {
    generationId: text(generation.id || generation.generationId),
    tradingDate: text(generation.tradingDate),
    asOf: text(generation.asOf),
    contractVersion: EMOTION_CORE_EVIDENCE_CONTRACT_VERSION,
  };
  const themeLibrary = isObject(payload.themeLibrary) ? payload.themeLibrary : {};
  const adapterReasonCodes = themeLibraryPreflight(themeLibrary, expected);
  if (adapterReasonCodes.length) {
    const unavailable = unavailableResult(
      { existingDecision: clone(options.existingDecision, {}) },
      expected,
      adapterReasonCodes,
    );
    unavailable.basis = {
      tradingDate: expected.tradingDate,
      snapshotKind: "closing",
      asOf: expected.asOf,
      source: "same_generation_closing_payload",
    };
    unavailable.lineage = {
      identityAuthority: STRICT_AUTHORITY,
      currentStateSource: "emotion_anchor_session",
      themeLibraryTradingDate: text(themeLibrary.tradingDate) || null,
      themeLibraryGeneratedAt: text(themeLibrary.generatedAt) || null,
      themeLibrarySnapshotKind: text(themeLibrary.snapshotKind) || null,
      classifierVersion: STRICT_CORE_CLASSIFIER_VERSION,
    };
    unavailable.transition = buildStrictCoreTransition(
      unavailable,
      options.previousEvidence,
      options.expectedPreviousTradingDate,
    );
    unavailable.emotionStagePath = buildEmotionStagePath(
      unavailable,
      options.previousEvidence,
      options.expectedPreviousTradingDate,
      options.existingDecision,
    );
    return unavailable;
  }
  const candidates = list(payload.candidates);
  const candidateByCode = new Map(candidates.map((candidate) => [stockCode(candidate), candidate]).filter(([code]) => code));
  const items = list(coreEmotionBasket.items);
  const itemByCode = new Map(items.map((item) => [stockCode(item), item]).filter(([code]) => code));
  const emotionCycle = isObject(coreEmotionBasket.emotionCycle) ? coreEmotionBasket.emotionCycle : {};
  const anchors = list(emotionCycle.rankedAnchors);
  const anchorByCode = new Map(anchors.map((anchor) => [stockCode(anchor), anchor]).filter(([code]) => code));
  const themes = list(themeLibrary.themes);
  const grouped = [];
  const assignedCodes = new Set();
  const consistencyWarnings = [];

  themes.forEach((theme) => {
    const leadership = isObject(theme.cycleLeadership) ? theme.cycleLeadership : {};
    const identities = isObject(leadership.identities) ? leadership.identities : {};
    const dailyHeightRows = list(theme.dailyHeightStocks);
    const dailyHeightByCode = new Map(dailyHeightRows.map((row) => [stockCode(row), row]).filter(([code]) => code));
    const heightCodes = new Set(dailyHeightByCode.keys());
    const codes = new Set([...Object.keys(identities), ...heightCodes]);
    const normalizedRows = [];
    codes.forEach((code) => {
      const identity = isObject(identities[code]) ? identities[code] : {};
      const compactHeightRow = dailyHeightByCode.get(code) || null;
      const candidate = candidateByCode.get(code) || compactHeightRow || { code };
      const anchor = anchorByCode.get(code) || null;
      const item = itemByCode.get(code) || null;
      const strictState = text(identity.state).toLowerCase();
      const leadershipCycleId = text(leadership.cycleInstanceId);
      const identityCycleId = text(identity.cycleInstanceId);
      const cycleAligned = Boolean(leadershipCycleId && identityCycleId && leadershipCycleId === identityCycleId);
      const leadershipReady = finite(leadership.version) === 1
        && text(leadership.settledTradingDate) === expected.tradingDate
        && leadership.frozen !== true;
      if (identityCycleId && leadershipCycleId && !cycleAligned) {
        consistencyWarnings.push({
          code,
          name: stockName(candidate, code),
          reason: "cycle_instance_mismatch",
          authoritativeSource: STRICT_AUTHORITY,
        });
      }
      const validImpactDays = finite(identity.validImpactDays)
        ?? uniqueStrings(identity.impactTradingDates).length;
      const strict = leadershipReady
        && cycleAligned
        && identity.identityEstablished === true
        && validImpactDays >= 2
        && ["confirmed", "retained", "challenged"].includes(strictState)
        && identity.frozen !== true
        && exactCompletedSession(candidate, expected);
      const rawRisk = qualifiesHeightRisk(anchor, compactHeightRow);
      const risk = rawRisk && !strict;
      const coreCandidate = strict || qualifiesCoreCandidate(identity, leadership, code, cycleAligned);
      if (!strict && !risk && !coreCandidate) return;
      const sourcedTheme = { ...theme, sourceAsOf: text(themeLibrary.generatedAt) || null };
      normalizedRows.push(normalizedCandidateRow({ candidate, identity, leadership, theme: sourcedTheme, anchor, item, expected, strict, risk, coreCandidate }));
      assignedCodes.add(code);

      const candidateCycle = candidate && candidate.leadership && candidate.leadership.cycleIdentity;
      if (strict && isObject(candidateCycle)
        && (candidateCycle.identityEstablished !== true
          || text(candidateCycle.state) !== text(identity.state)
          || text(candidateCycle.cycleInstanceId) && text(candidateCycle.cycleInstanceId) !== identityCycleId)) {
        consistencyWarnings.push({
          code,
          name: stockName(candidate, code),
          reason: "candidate_cycle_identity_conflicts_with_theme_cycle_authority",
          authoritativeSource: STRICT_AUTHORITY,
        });
      }
    });
    const sourcedTheme = { ...theme, sourceAsOf: text(themeLibrary.generatedAt) || null };
    grouped.push({
      theme: buildThemeProjection(sourcedTheme, expected),
      cycle: buildCycleProjection(sourcedTheme, leadership.primary || {}, expected),
      candidates: normalizedRows,
    });
  });

  anchors.forEach((anchor) => {
    const code = stockCode(anchor);
    const heightRisk = qualifiesHeightRisk(anchor, null);
    if (!code || !heightRisk || assignedCodes.has(code)) return;
    const candidate = candidateByCode.get(code) || { code, name: stockName(anchor, code) };
    const theme = syntheticRiskTheme(candidate, anchor, expected);
    grouped.push({
      theme: buildThemeProjection(theme, expected),
      cycle: buildCycleProjection(theme, {}, expected),
      candidates: [normalizedCandidateRow({
        candidate,
        identity: {},
        theme,
        anchor,
        item: itemByCode.get(code) || null,
        expected,
        strict: false,
        risk: true,
        coreCandidate: false,
      })],
    });
    assignedCodes.add(code);
  });

  const marketCycle = {
    key: text(phaseDetail.structuralCycle) === "主升" ? "main_rise" : text(phaseDetail.structuralCycle) || "unknown",
    label: text(phaseDetail.structuralCycle) || "市场周期待确认",
    detail: clone(phaseDetail.indexSubPhase, null),
    ...metadata(expected),
  };
  const result = buildEmotionCoreEvidenceContract({
    contractVersion: EMOTION_CORE_EVIDENCE_CONTRACT_VERSION,
    generation: { id: expected.generationId, ...metadata(expected) },
    marketCycle,
    themeCycles: grouped,
    existingDecision: clone(options.existingDecision, {}),
  });
  result.basis = {
    tradingDate: expected.tradingDate,
    snapshotKind: "closing",
    asOf: expected.asOf,
    source: "same_generation_closing_payload",
  };
  result.lineage = {
    identityAuthority: STRICT_AUTHORITY,
    currentStateSource: "emotion_anchor_session",
    themeLibraryTradingDate: text(themeLibrary.tradingDate) || null,
    themeLibraryGeneratedAt: text(themeLibrary.generatedAt) || null,
    themeLibrarySnapshotKind: text(themeLibrary.snapshotKind) || null,
    classifierVersion: STRICT_CORE_CLASSIFIER_VERSION,
  };
  result.transition = buildStrictCoreTransition(result, options.previousEvidence, options.expectedPreviousTradingDate);
  result.dataQuality = {
    ...result.dataQuality,
    consistencyWarnings,
  };
  result.emotionStagePath = buildEmotionStagePath(
    result,
    options.previousEvidence,
    options.expectedPreviousTradingDate,
    options.existingDecision,
  );
  return result;
}

module.exports = {
  EMOTION_CORE_EVIDENCE_CONTRACT_VERSION,
  MAX_STRICT_EMOTION_CORES,
  STRICT_CORE_CLASSIFIER_VERSION,
  STRICT_AUTHORITY,
  buildEmotionCoreEvidenceContract,
  buildEmotionCoreEvidenceFromPayload,
  previousRowLineageMatches,
  validatePreviousEvidence,
};
