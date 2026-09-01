"use strict";

(function exposePreplanScenarioWorkbench(root, factory) {
  const api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  if (root) root.PreplanScenarioWorkbench = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createPreplanScenarioWorkbenchApi() {
  const VERSION = 2;
  const METHOD = "conditional_playbook_projection_v1";
  const SCENARIO_KEYS = Object.freeze([
    "repair_or_consensus",
    "divergence_continuation",
    "negative_feedback_expansion",
  ]);
  const FORBIDDEN_OBSERVATION_KEYS = Object.freeze([
    "buy", "sell", "hold", "holdingPeriod", "position", "positionAllocation",
    "canonicalAllocation", "order", "orderPlan", "allocation", "firstPositionPct",
  ]);

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function list(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function text(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function clone(value, fallback = null) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return fallback; }
  }

  function finite(value) {
    const number = Number(value);
    return value !== null && value !== undefined && value !== "" && Number.isFinite(number) ? number : null;
  }

  function generationFrom(payload) {
    const source = isObject(payload) ? payload : {};
    const nested = isObject(source.generationContext) ? source.generationContext : {};
    return {
      generationId: text(source.generationId || nested.generationId),
      tradingDate: text(source.tradingDate || nested.tradingDate),
      asOf: text(source.asOf || nested.asOf),
    };
  }

  function sameGeneration(value, expected) {
    const source = isObject(value) ? value : {};
    const nested = isObject(source.generation) ? source.generation
      : isObject(source.generationContext) ? source.generationContext : {};
    return text(source.generationId || nested.generationId) === expected.generationId
      && text(source.tradingDate || nested.tradingDate) === expected.tradingDate
      && text(source.asOf || nested.asOf) === expected.asOf;
  }

  function uniqueStrings(values) {
    return [...new Set(list(values).map((value) => {
      if (typeof value === "string" || typeof value === "number") return text(value);
      if (!isObject(value)) return "";
      return text(value.label || value.summary || value.text || value.condition || value.reason || value.value);
    }).filter(Boolean))];
  }

  function scenarioContract(payload, expected) {
    const decision = isObject(payload.tomorrowDecision) ? payload.tomorrowDecision : {};
    const raw = isObject(decision.emotionScenarioInference) ? decision.emotionScenarioInference
      : isObject(payload.emotionScenarioInference) ? payload.emotionScenarioInference : {};
    const guardrails = isObject(raw.guardrails) ? raw.guardrails : {};
    const rows = list(raw.scenarios);
    const keys = rows.map((row) => text(row && row.key));
    const weights = rows.map((row) => finite(row && row.modelWeightPct));
    const valid = raw.status === "ready"
      && Number(raw.version) === 1
      && raw.calibrated === false
      && raw.probability === null
      && sameGeneration(raw, expected)
      && rows.length === 3
      && new Set(keys).size === 3
      && SCENARIO_KEYS.every((key) => keys.includes(key))
      && weights.every((weight) => weight !== null && weight >= 0 && weight <= 100)
      && Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 100) < 0.01
      && rows.every((row) => row.probability === null && row.calibrated === false)
      && guardrails.observationOnly === true
      && guardrails.executionAuthority === false
      && guardrails.selectionAuthority === false
      && guardrails.positionAuthority === false
      && guardrails.probabilityAuthority === false;
    if (!valid) return null;
    return {
      source: "emotionScenarioInference",
      calibrated: false,
      probability: null,
      confidence: clone(raw.confidence, {}),
      scenarios: rows.map((row) => ({
        key: text(row.key),
        label: text(row.label),
        modelWeightPct: finite(row.modelWeightPct),
        rank: finite(row.rank),
        calibrated: false,
        probability: null,
      })).sort((left, right) => left.rank - right.rank),
    };
  }

  function observationContract(payload, expected) {
    const chain = isObject(payload.unifiedDecisionChain) ? payload.unifiedDecisionChain : {};
    const generation = isObject(chain.generation) ? chain.generation : {};
    const observations = isObject(chain.observationCandidates) ? chain.observationCandidates : {};
    const aligned = Number(chain.version) === 3
      && text(chain.authority) === "canonical_stock_decision"
      && sameGeneration({ generation }, expected)
      && observations.status === "available"
      && observations.observationOnly === true
      && observations.executionAuthority === false;
    return aligned ? list(observations.stocks) : null;
  }

  function codeOf(value) {
    return text(value && (value.code || value.stockCode || value.symbol)).toUpperCase();
  }

  function conditionalEligible(stock) {
    const completeness = isObject(stock.opportunityDataCompleteness) ? stock.opportunityDataCompleteness : {};
    const expectation = isObject(stock.expectation) ? stock.expectation : {};
    const entry = isObject(stock.entryConfirmation) ? stock.entryConfirmation : {};
    const nextDay = isObject(stock.postEntryNextDayExpectation) ? stock.postEntryNextDayExpectation : {};
    const feasibility = isObject(stock.executionFeasibility) ? stock.executionFeasibility : {};
    return /^\d{6}$/.test(codeOf(stock))
      && stock.hardGatePassed === true
      && completeness.status === "complete"
      && completeness.qualified === true
      && completeness.opportunityEligible === true
      && expectation.status === "qualified"
      && entry.status === "waiting_trigger"
      && nextDay.status === "conditional"
      && ["ready", "conditional"].includes(text(feasibility.status))
      && list(feasibility.blockers).length === 0
      && stock.observationOnly === true
      && stock.executable === false
      && stock.executionAuthority === false;
  }

  function scenarioKeysFor(stock) {
    const path = text(stock && stock.path).toLowerCase();
    const keys = ["repair_or_consensus", "divergence_continuation"];
    if (/risk|negative|退潮|负反馈/.test(path)) return ["negative_feedback_expansion"];
    return keys;
  }

  function projectConditionalScript(stock) {
    const entry = isObject(stock.entryConfirmation) ? stock.entryConfirmation : {};
    const nextDay = isObject(stock.postEntryNextDayExpectation) ? stock.postEntryNextDayExpectation : {};
    const expectation = isObject(stock.expectation) ? stock.expectation : {};
    const activationConditions = uniqueStrings([
      ...list(entry.triggerConditions),
      entry.reason,
    ]);
    const invalidationConditions = uniqueStrings([
      entry.invalidation,
      nextDay.invalidation,
      nextDay.riskLabel,
    ]);
    const pendingConditions = uniqueStrings(list(stock.missingConditions)
      .filter((value) => !/统一交易授权尚未开放/.test(text(value))));
    return {
      code: codeOf(stock),
      name: text(stock.name),
      theme: text(stock.theme || stock.mainConcept),
      path: text(stock.path),
      pathLabel: text(stock.pathLabel || stock.setupLabel),
      role: text(stock.role || stock.tierLabel),
      state: "watching",
      stateLabel: "盘后观察",
      matchedScenarioKeys: scenarioKeysFor(stock),
      reason: text(stock.observationReason || expectation.label),
      activationConditions,
      invalidationConditions,
      pendingConditions,
      checkpointPlan: [
        { time: "09:25", status: "pending", label: "竞价初筛", checks: ["竞价只作初筛，不单独确认"] },
        { time: "09:35", status: "pending", label: "早盘确认", checks: activationConditions.length ? activationConditions : ["核心主动性、板块同步与真实承接待确认"] },
      ],
      tPlusOneExpectation: {
        label: text(nextDay.label || expectation.label),
        riskLabel: text(nextDay.riskLabel),
        premise: text(nextDay.premise),
        calibrated: false,
        probability: null,
      },
      nextReviewTime: "09:25",
      observationOnly: true,
      executable: false,
      executionAuthority: false,
      selectionAuthority: false,
      positionAuthority: false,
    };
  }

  function projectDiagnostic(stock) {
    const missing = uniqueStrings(stock && stock.missingConditions);
    return {
      code: codeOf(stock),
      name: text(stock && stock.name),
      state: "hard_blocked",
      stateLabel: "硬门槛未过，仅作诊断",
      reasons: missing.filter((value) => /原交易硬门槛|均线|不属于当前主线方向|成交额不足|价格异常|流动性|停牌|一字/.test(value)).slice(0, 4),
      observationOnly: true,
      executable: false,
      executionAuthority: false,
      positionAuthority: false,
    };
  }

  function safeFormalPlans(plans) {
    const seen = new Set();
    return list(plans).map((plan) => clone(plan, null)).filter((plan) => {
      const code = codeOf(plan);
      if (!plan || !/^\d{6}$/.test(code) || seen.has(code)) return false;
      seen.add(code);
      return true;
    });
  }

  function unavailable(expected, reasonCodes) {
    return {
      version: VERSION,
      method: METHOD,
      dataStatus: "unavailable",
      executionStatus: "closed",
      generation: clone(expected, {}),
      generationId: expected.generationId,
      tradingDate: expected.tradingDate,
      asOf: expected.asOf,
      posture: { key: "data_unavailable", label: "数据不可用", reason: "同代情景或观察契约未通过", nextCheckpoints: ["09:25", "09:35"] },
      scenarioContext: null,
      conditionalScripts: [],
      formalPlans: [],
      diagnosticOnly: [],
      hardBlocks: list(reasonCodes).map((key) => ({ scope: "data", code: null, key, reason: key, recoverable: false })),
      holdingManagement: { independent: true, route: "#sell-advisor", label: "持仓与卖出方案独立运行" },
      reviewSchedule: ["09:25", "09:35", "首次分歧", "14:30"],
      guardrails: {
        scenarioCannotGrantExecution: true,
        observationCannotGrantExecution: true,
        formalPlansFromUnifiedChainOnly: true,
        noForcedCandidate: true,
        sameGenerationRequired: true,
      },
      integrity: { sameGeneration: false, observationFieldsStripped: true, formalAndObservationDisjoint: true },
    };
  }

  function buildPreplanScenarioWorkbench(payloadInput = {}, options = {}) {
    const payload = isObject(payloadInput) ? payloadInput : {};
    const expected = generationFrom(payload);
    if (!expected.generationId || !expected.tradingDate || !expected.asOf) return unavailable(expected, ["generation_incomplete"]);
    const scenarioContext = scenarioContract(payload, expected);
    const observations = observationContract(payload, expected);
    if (!scenarioContext || !observations) return unavailable(expected, [!scenarioContext ? "scenario_contract_invalid" : "observation_contract_invalid"]);

    const formalPlans = safeFormalPlans(options.formalPlans);
    const formalCodes = new Set(formalPlans.map(codeOf));
    const conditionalScripts = [];
    const diagnosticOnly = [];
    const seen = new Set();
    observations.forEach((stock) => {
      const code = codeOf(stock);
      if (!code || seen.has(code) || formalCodes.has(code)) return;
      seen.add(code);
      if (conditionalEligible(stock)) conditionalScripts.push(projectConditionalScript(stock));
      else diagnosticOnly.push(projectDiagnostic(stock));
    });
    const executionStatus = formalPlans.length ? "open" : "closed";
    const posture = formalPlans.length
      ? { key: "formal_plan_ready", label: "正式计划待盘中触发", reason: `${formalPlans.length}份正式计划来自统一决策链`, nextCheckpoints: ["09:25", "09:35"] }
      : conditionalScripts.length
        ? { key: "observe_for_activation", label: "暂不立即开新仓", reason: `保留${conditionalScripts.length}份条件观察剧本`, nextCheckpoints: ["09:25", "09:35"] }
        : { key: "no_setup", label: "当前无条件剧本", reason: "观察池没有通过条件剧本门槛", nextCheckpoints: ["09:25", "09:35"] };
    const formalAndObservationDisjoint = conditionalScripts.every((row) => !formalCodes.has(row.code));
    return {
      version: VERSION,
      method: METHOD,
      dataStatus: "ready",
      executionStatus,
      generation: clone(expected, {}),
      generationId: expected.generationId,
      tradingDate: expected.tradingDate,
      asOf: expected.asOf,
      posture,
      scenarioContext,
      conditionalScripts,
      formalPlans,
      diagnosticOnly,
      hardBlocks: executionStatus === "closed" ? [{ scope: "market", code: null, key: "execution_authority_closed", reason: "统一决策链未开放新仓执行权限", recoverable: true }] : [],
      holdingManagement: { independent: true, route: "#sell-advisor", label: "持仓与卖出方案独立运行" },
      reviewSchedule: ["09:25", "09:35", "首次分歧", "14:30"],
      guardrails: {
        scenarioCannotGrantExecution: true,
        observationCannotGrantExecution: true,
        formalPlansFromUnifiedChainOnly: true,
        noForcedCandidate: true,
        sameGenerationRequired: true,
      },
      integrity: {
        sameGeneration: true,
        observationFieldsStripped: conditionalScripts.every((row) => FORBIDDEN_OBSERVATION_KEYS.every((key) => !(key in row))),
        formalAndObservationDisjoint,
        scenarioWeightsSumTo100: Math.abs(scenarioContext.scenarios.reduce((sum, row) => sum + Number(row.modelWeightPct || 0), 0) - 100) < 0.01,
        duplicateCodesRemoved: true,
      },
    };
  }

  function validatePreplanScenarioWorkbench(value, expectedGeneration = null) {
    if (!isObject(value) || Number(value.version) !== VERSION || value.method !== METHOD) return false;
    const expected = expectedGeneration || value.generation;
    if (!expected || !sameGeneration(value, expected)) return false;
    const guards = isObject(value.guardrails) ? value.guardrails : {};
    if (guards.scenarioCannotGrantExecution !== true || guards.observationCannotGrantExecution !== true
      || guards.formalPlansFromUnifiedChainOnly !== true || guards.noForcedCandidate !== true
      || guards.sameGenerationRequired !== true) return false;
    if (value.dataStatus === "unavailable") return list(value.conditionalScripts).length === 0 && list(value.formalPlans).length === 0;
    const scripts = list(value.conditionalScripts);
    const diagnostics = list(value.diagnosticOnly);
    return value.dataStatus === "ready"
      && ["closed", "open"].includes(value.executionStatus)
      && scripts.every((row) => row.observationOnly === true && row.executable === false
        && row.executionAuthority === false && row.positionAuthority === false
        && FORBIDDEN_OBSERVATION_KEYS.every((key) => !(key in row)))
      && diagnostics.every((row) => row.observationOnly === true && row.executionAuthority === false)
      && isObject(value.integrity)
      && value.integrity.sameGeneration === true
      && value.integrity.observationFieldsStripped === true
      && value.integrity.formalAndObservationDisjoint === true
      && value.integrity.scenarioWeightsSumTo100 === true;
  }

  return Object.freeze({
    VERSION,
    METHOD,
    SCENARIO_KEYS,
    FORBIDDEN_OBSERVATION_KEYS,
    buildPreplanScenarioWorkbench,
    validatePreplanScenarioWorkbench,
  });
}));
