"use strict";

/**
 * 盘前选股六步流程投影层。
 *
 * 这个模块不预测、不打分、不补齐缺失值，只把 hot-stocks payload 中已经存在的
 * 结论按「指数 -> 偏好 -> 情绪 -> 方向 -> 个股 -> 买卖计划」重新组织，并在安全
 * 边界上做三件事：显式上游否决向下游级联、候选票不参与上游自证、异常价格不
 * 输出具体买卖建议。
 *
 * 同一文件可被 Node/CommonJS require，也可直接用 <script> 加载后通过
 * globalThis.PremarketFlow 使用。
 */
(function exposePremarketFlow(root, factory) {
  const workbenchApi = typeof module === "object" && module && module.exports
    ? require("./preplan-scenario-workbench")
    : root && root.PreplanScenarioWorkbench;
  const api = factory(workbenchApi);
  if (typeof module === "object" && module && module.exports) module.exports = api;
  if (root) root.PremarketFlow = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createPremarketFlowApi(workbenchApi) {
  const FLOW_STEPS = Object.freeze([
    Object.freeze({ key: "indexOpportunity", order: 1, title: "指数机会" }),
    Object.freeze({ key: "direction", order: 2, title: "题材筛选" }),
    Object.freeze({ key: "tradingPreference", order: 3, title: "炒作偏好" }),
    Object.freeze({ key: "emotionStage", order: 4, title: "情绪阶段" }),
    Object.freeze({ key: "stocks", order: 5, title: "核心个股" }),
    Object.freeze({ key: "tradePlan", order: 6, title: "买卖计划" }),
  ]);

  const FLOW_STEP_KEYS = Object.freeze(FLOW_STEPS.map((step) => step.key));

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!isObject(value)) return value;
    const result = {};
    Object.keys(value).forEach((key) => {
      if (value[key] !== undefined) result[key] = clone(value[key]);
    });
    return result;
  }

  function text(value) {
    if (value === null || value === undefined) return null;
    const cleaned = String(value).trim();
    return cleaned || null;
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function booleanOrNull(value) {
    return typeof value === "boolean" ? value : null;
  }

  function firstObject(...values) {
    return values.find(isObject) || {};
  }

  function firstArray(...values) {
    return values.find(Array.isArray) || [];
  }

  function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null);
  }

  function firstText(...values) {
    for (const value of values) {
      const cleaned = text(value);
      if (cleaned !== null) return cleaned;
    }
    return null;
  }

  function uniqueTexts(values) {
    const seen = new Set();
    const result = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const cleaned = text(value);
      if (cleaned === null || seen.has(cleaned)) return;
      seen.add(cleaned);
      result.push(cleaned);
    });
    return result;
  }

  function stockCode(value) {
    return firstText(value && value.code, value && value.secCode, value && value.stockCode, value && value.symbol);
  }

  function canonicalAllocationOf(candidate) {
    if (!isObject(candidate) || text(candidate.selectionAuthority) !== "unified_decision_chain_v3") return null;
    const source = firstObject(candidate.canonicalAllocation, candidate.positionAllocation);
    const allocation = {
      relativeWeightPct: numberOrNull(source.relativeWeightPct),
      initialPortfolioPct: numberOrNull(source.initialPortfolioPct),
      maximumPortfolioPct: numberOrNull(source.maximumPortfolioPct),
    };
    return Object.values(allocation).every((value) => value !== null && value >= 0)
      ? allocation : null;
  }

  function legacyPositionObservation(candidate) {
    const existing = isObject(candidate && candidate.legacyObservation)
      ? clone(candidate.legacyObservation) : {};
    const positions = isObject(existing.position) ? existing.position : {};
    if (candidate && Object.prototype.hasOwnProperty.call(candidate, "position")) positions.topLevel = clone(candidate.position);
    if (isObject(candidate && candidate.stopLossPlan)
      && Object.prototype.hasOwnProperty.call(candidate.stopLossPlan, "position")) {
      positions.stopLossPlan = clone(candidate.stopLossPlan.position);
    }
    if (isObject(candidate && candidate.advice)
      && Object.prototype.hasOwnProperty.call(candidate.advice, "position")) {
      positions.advice = clone(candidate.advice.position);
    }
    return Object.keys(positions).length ? {
      ...existing,
      position: positions,
      executionAuthority: false,
    } : existing;
  }

  function evidenceTexts(...values) {
    const rows = [];
    values.forEach((value) => {
      if (!Array.isArray(value)) return;
      value.forEach((item) => {
        if (typeof item === "string" || typeof item === "number") {
          rows.push(item);
        } else if (isObject(item)) {
          rows.push(firstText(item.detail, item.summary, item.reason, item.label));
        }
      });
    });
    return uniqueTexts(rows);
  }

  function commonStep(key, status, blockedBy, conclusion, evidence) {
    const definition = FLOW_STEPS.find((step) => step.key === key);
    return {
      key,
      order: definition.order,
      title: definition.title,
      status,
      blockedBy: uniqueTexts(blockedBy),
      conclusion: text(conclusion),
      evidence: uniqueTexts(evidence),
    };
  }

  function applyInheritedStatus(hasData, inheritedBlockers, ownBlocked) {
    if (inheritedBlockers.length || ownBlocked) return "blocked";
    return hasData ? "ready" : "unknown";
  }

  function canonicalContractState(model) {
    const source = isObject(model) ? model : {};
    const present = Object.keys(source).length > 0 && (
      Number(source.version || 0) >= 1
      || Object.prototype.hasOwnProperty.call(source, "available")
      || text(source.method) !== null
    );
    const usable = present
      && Number(source.version || 0) >= 1
      && source.available !== false
      && text(source.method) !== "unavailable";
    return { present, usable };
  }

  function canonicalThemeLibraryState(themeLibrary) {
    const source = isObject(themeLibrary) ? themeLibrary : {};
    const present = Object.keys(source).length > 0 && (
      Array.isArray(source.themes)
      || Object.prototype.hasOwnProperty.call(source, "available")
      || Number(source.schemaVersion || 0) >= 1
      || text(source.classifierVersion) !== null
    );
    const usable = present && source.available !== false && Array.isArray(source.themes);
    return { present, usable };
  }

  function projectStructure(row) {
    const source = isObject(row) ? row : {};
    return {
      code: stockCode(source),
      name: text(source.name),
      date: text(source.date),
      close: numberOrNull(source.close),
      changePct: numberOrNull(source.changePct),
      ma5: numberOrNull(source.ma5),
      ma10: numberOrNull(source.ma10),
      ma20: numberOrNull(source.ma20),
      ma30: numberOrNull(source.ma30),
      ma60: numberOrNull(source.ma60),
      slope5: numberOrNull(source.slope5),
      slope10: numberOrNull(source.slope10),
      slope20: numberOrNull(source.slope20),
      trendKey: text(source.trendKey),
      trendLabel: text(source.trendLabel),
    };
  }

  function resolveContext(payload) {
    const source = isObject(payload) ? payload : {};
    const market = firstObject(source.market);
    const marketState = firstObject(market.state, source.marketState);
    const tomorrowDecision = firstObject(source.tomorrowDecision);
    const structuralResolution = firstObject(marketState.structuralResolution);
    const indexEnvironment = firstObject(
      source.indexOpportunity,
      marketState.indexEnvironment,
      structuralResolution.indexEnvironment,
    );
    const snapshot = firstObject(market.snapshot, source.marketSnapshot);
    const forecast = firstObject(
      source.tomorrowDecision && source.tomorrowDecision.forecast,
      source.tomorrowMarketForecast,
      source.marketForecast,
      source.forecast,
    );
    const sentimentCycle = firstObject(
      forecast.sentimentCycle,
      source.tomorrowDecision && source.tomorrowDecision.market,
    );
    const premarketModels = firstObject(source.premarketModels);
    const marketPhaseDetail = firstObject(
      source.marketPhaseDetail,
      tomorrowDecision.market && tomorrowDecision.market.phaseDetail,
      marketState.phaseDetail,
    );
    return {
      source,
      market,
      marketState,
      indexEnvironment,
      snapshot,
      forecast,
      sentimentCycle,
      premarketModels,
      marketPhaseDetail,
      indexOpportunityEvidence: isObject(source.indexOpportunityEvidence)
        ? source.indexOpportunityEvidence
        : null,
      indexCycleRegime: firstObject(
        premarketModels.indexCycleRegime,
        marketState.indexCycleRegime,
        source.indexCycleRegime,
      ),
      tradingStylePreference: firstObject(
        premarketModels.tradingStylePreference,
        source.tradingStylePreference,
        source.market && source.market.tradingStyle && source.market.tradingStyle.preferenceModel,
      ),
      emotionCycle: firstObject(
        premarketModels.emotionCycle,
        source.emotionCycle,
        source.tomorrowDecision && source.tomorrowDecision.coreEmotion && source.tomorrowDecision.coreEmotion.emotionCycle,
      ),
      marketStrengthSource: firstObject(source.marketStrengthSource),
      externalRisk: firstObject(market.externalRisk, source.externalRisk),
      tradingStyle: firstObject(market.tradingStyle, source.tradingStyle),
      marketEmotion: firstObject(source.marketEmotion),
      topicBoard: firstObject(source.topicBoard),
      leadershipBoard: firstObject(source.leadershipBoard),
      themeLibrary: firstObject(source.themeLibrary),
      bestPicks: firstObject(source.bestPicks),
      tomorrowDecision,
      riskBoard: firstObject(source.riskBoard),
    };
  }

  function explicitIndexPermission(context) {
    const source = context.source;
    const index = context.indexEnvironment;
    const canonicalPermission = firstObject(context.indexCycleRegime.positionPermission);
    const canonicalAllowNew = booleanOrNull(canonicalPermission.allowNew);
    if (canonicalAllowNew !== null) return canonicalAllowNew;
    const explicit = booleanOrNull(firstDefined(
      source.indexOpportunity && source.indexOpportunity.allowTrade,
      source.indexOpportunity && source.indexOpportunity.allowed,
      source.indexOpportunity && source.indexOpportunity.tradable,
      index.allowTrade,
      index.allowed,
      index.tradable,
    ));
    if (explicit !== null) return explicit;
    const position = text(context.marketState.position) || "";
    const hardZero = /空仓|禁止(?:新)?开仓|暂停(?:新)?开仓|不得新开仓/.test(position)
      || /(?:^|[^\d])0(?:\.0+)?\s*%(?:[^\d]|$)/.test(position)
      || /^\s*0(?:\.0+)?\s*$/.test(position);
    return hardZero ? false : null;
  }

  function normalizedKey(value) {
    return (text(value) || "unknown").toLowerCase();
  }

  function isUnavailableKey(value) {
    return ["", "unknown", "unavailable"].includes(normalizedKey(value));
  }

  function chooseIndexTomorrowMainPath({
    indexUsable,
    mediumTerm,
    shortTerm,
    intraday,
    phaseAvailable,
    tomorrowBaseline,
  }) {
    if (!indexUsable) {
      return {
        key: "evidence_insufficient",
        label: "指数证据不足，等待确认",
        source: "index_cycle_regime",
      };
    }

    const mediumKey = normalizedKey(mediumTerm.key);
    const shortKey = normalizedKey(shortTerm.key);
    const intradayKey = normalizedKey(intraday.key);
    const baselineKey = normalizedKey(tomorrowBaseline.key);
    const phaseRiskControl = phaseAvailable && (
      baselineKey === "risk_control"
      || tomorrowBaseline.riskDefault === true
      || normalizedKey(tomorrowBaseline.status) === "risk_default"
    );
    if (phaseRiskControl) {
      return {
        key: "risk_control",
        label: firstText(tomorrowBaseline.label, "风险控制优先"),
        source: "market_phase_detail",
      };
    }
    if (mediumKey === "decline" || shortKey === "weakening") {
      return {
        key: "weakness_continuation_or_repair",
        label: "弱势延续，先看修复能否成立",
        source: "index_cycle_regime",
      };
    }
    if (mediumKey === "range" && shortKey === "range") {
      return {
        key: "range_continuation_wait_break",
        label: "震荡延续，等待方向确认",
        source: "index_cycle_regime",
      };
    }
    if (phaseAvailable && baselineKey === "divergence_continuation") {
      return {
        key: baselineKey,
        label: firstText(tomorrowBaseline.label, "分歧延续优先"),
        source: "market_phase_detail",
      };
    }
    if (shortKey === "main_rise" || shortKey === "partial_main_rise" || mediumKey === "main_rise") {
      if (["gap_fade", "weak_close"].includes(intradayKey)) {
        return {
          key: "main_rise_with_intraday_pressure",
          label: "主升结构内承压，等待承接修复",
          source: "index_cycle_regime",
        };
      }
      return {
        key: shortKey === "partial_main_rise" ? "partial_main_rise_wait_resonance" : "main_rise_continuation_confirm",
        label: shortKey === "partial_main_rise" ? "部分主升，等待全市场共振" : "主升延续，等待承接确认",
        source: "index_cycle_regime",
      };
    }
    if (mediumKey === "repair_candidate" || mediumKey === "repair" || shortKey === "repair") {
      return {
        key: "repair_continuation_wait_resonance",
        label: "修复延续，等待全市场共振",
        source: "index_cycle_regime",
      };
    }
    return {
      key: "range_continuation_wait_break",
      label: "震荡延续，等待方向确认",
      source: "index_cycle_regime",
    };
  }

  function buildIndexTomorrowPlan(context) {
    const regime = context.indexCycleRegime;
    const mediumTerm = firstObject(regime.mediumTerm);
    const shortTerm = firstObject(regime.shortTerm);
    const intraday = firstObject(regime.intraday);
    const fiveDay = firstObject(intraday.fiveDay);
    const validation = firstObject(regime.validation);
    const positionPermission = firstObject(regime.positionPermission);
    const phaseDetail = context.marketPhaseDetail;
    const tomorrowBaseline = firstObject(
      phaseDetail.tomorrowBaseline,
      context.tomorrowDecision.tomorrowBaseline,
    );
    const selectionPolicy = firstObject(
      phaseDetail.selectionPolicy,
      context.tomorrowDecision.selectionPolicy,
    );
    const canonicalState = canonicalContractState(regime);
    const dataQuality = firstObject(regime.dataQuality);
    const qualityKey = normalizedKey(firstDefined(dataQuality.grade, dataQuality.status));
    const indexUsable = canonicalState.usable
      && !isUnavailableKey(mediumTerm.key)
      && !isUnavailableKey(shortTerm.key)
      && !["insufficient", "unavailable", "invalid"].includes(qualityKey);
    const phaseAvailable = normalizedKey(phaseDetail.status) === "available"
      && normalizedKey(tomorrowBaseline.status) !== "risk_default"
      && tomorrowBaseline.riskDefault !== true;
    const main = chooseIndexTomorrowMainPath({
      indexUsable,
      mediumTerm,
      shortTerm,
      intraday,
      phaseAvailable,
      tomorrowBaseline,
    });

    const indexAllowNew = indexUsable && positionPermission.allowNew === true;
    const indexAllowAdd = indexUsable && positionPermission.allowAdd === true;
    const policyMode = normalizedKey(selectionPolicy.mode);
    const phaseBlocked = !phaseAvailable
      || ["blocked", "blocked_new_entry", "unavailable"].includes(policyMode)
      || normalizedKey(tomorrowBaseline.key) === "risk_control";
    const conditionalAfterSupport = !phaseBlocked && policyMode === "conditional_after_support";
    const phaseImmediate = !phaseBlocked && selectionPolicy.allowImmediateEntry === true;
    const phaseCanActivate = !phaseBlocked
      && selectionPolicy.canActivate !== false
      && (
        conditionalAfterSupport
        || phaseImmediate
        || selectionPolicy.canActivate === true
      );
    const canActivate = indexAllowNew && phaseCanActivate;
    const allowNew = canActivate && phaseImmediate;
    const allowAdd = allowNew && indexAllowAdd && selectionPolicy.allowAdd === true;
    const actionMode = allowNew ? "allowed" : canActivate && conditionalAfterSupport ? "wait_for_support" : "observe";
    const actionLabel = actionMode === "allowed"
      ? "按确认条件执行"
      : actionMode === "wait_for_support"
        ? "等待真实承接后再评估"
        : "观察，等待09:25/09:35确认";
    const actionReasons = uniqueTexts([
      !indexUsable ? "多周期指数证据不可用" : null,
      indexUsable && !indexAllowNew ? firstText(positionPermission.label, positionPermission.note, "指数仓位权限未开放新开仓") : null,
      !phaseAvailable ? firstText(tomorrowBaseline.reason, selectionPolicy.label, "市场阶段证据不可用") : null,
      phaseBlocked && phaseAvailable ? firstText(selectionPolicy.label, tomorrowBaseline.label, "阶段策略阻断新开仓") : null,
      conditionalAfterSupport ? firstText(selectionPolicy.label, "需等真实承接确认") : null,
      allowNew ? firstText(selectionPolicy.label, positionPermission.label, "两层权限均已明确开放") : null,
    ]);
    const fiveDayKey = normalizedKey(fiveDay.key);
    const rhythmNote = fiveDayKey === "weakening"
      ? "5日节奏转弱：开盘确认前保持观察，不改写中短周期主路径。"
      : ["advance", "constructive_with_pullback"].includes(fiveDayKey)
        ? "5日节奏向上：仅在权限已开放时提高执行效率，不改写主路径。"
        : fiveDayKey === "mixed"
          ? "5日节奏分化：按开盘检查点分步确认，不改写主路径。"
          : "5日节奏证据不足：按默认检查点复核，不改写主路径。";

    return {
      version: 1,
      method: "deterministic_conditional_path",
      status: !indexUsable ? "unavailable" : phaseAvailable ? "available" : "index_only",
      probability: null,
      calibrated: false,
      mainPath: {
        ...main,
        status: indexUsable ? "baseline_unconfirmed" : "evidence_insufficient",
        basis: uniqueTexts([
          mediumTerm.label,
          shortTerm.label,
          intraday.label,
          phaseAvailable ? tomorrowBaseline.label : null,
        ]),
        probability: null,
        calibrated: false,
      },
      upwardRevision: {
        key: "upgrade",
        label: "上修条件",
        status: "condition_pending",
        conditions: evidenceTexts(firstArray(validation.upgrade)),
        result: "条件成立后重新计算主路径与执行权限；未成立前不提前上修。",
        probability: null,
        calibrated: false,
      },
      downwardRevision: {
        key: "downgrade",
        label: "下修条件",
        status: "condition_pending",
        conditions: evidenceTexts(firstArray(validation.downgrade)),
        result: "任一风险条件成立即下修，执行权限按更严格结果收紧。",
        probability: null,
        calibrated: false,
      },
      executionRhythm: {
        key: isUnavailableKey(fiveDay.key) ? "unknown" : text(fiveDay.key),
        label: firstText(fiveDay.label, "5日节奏待确认"),
        role: "timing_only",
        note: rhythmNote,
        checkpoints: ["09:25", "09:35"],
        probability: null,
        calibrated: false,
      },
      action: {
        mode: actionMode,
        label: actionLabel,
        allowNew,
        allowAdd,
        canActivate,
        checkpoints: ["09:25", "09:35"],
        reasons: actionReasons,
        probability: null,
        calibrated: false,
      },
      evidenceBoundary: {
        legacyForecastIgnored: true,
        fiveDayAffectsMainPath: false,
        fiveDayRole: "execution_rhythm_only",
        permissionRule: "most_restrictive_intersection",
        noCalibratedProbability: true,
      },
    };
  }

  function buildIndexOpportunity(context, inheritedBlockers) {
    const index = context.indexEnvironment;
    const regime = context.indexCycleRegime;
    const mediumTerm = firstObject(regime.mediumTerm);
    const shortTerm = firstObject(regime.shortTerm);
    const intradayRhythm = firstObject(regime.intraday);
    const marketConsensus = firstObject(regime.marketConsensus);
    const positionPermission = firstObject(regime.positionPermission);
    const canonicalState = canonicalContractState(regime);
    const canonicalAvailable = canonicalState.usable;
    const legacyAllowed = !canonicalState.present;
    const snapshot = context.snapshot;
    const forecast = context.forecast;
    const externalRisk = context.externalRisk;
    const externalSignal = firstObject(context.marketStrengthSource.external);
    const tradeWindow = firstObject(context.marketState.tradeWindow, context.source.tradeWindow);
    const structures = firstArray(index.structures, snapshot.indexStructures).map(projectStructure);
    const permissionValue = canonicalState.present && !canonicalState.usable
      ? false
      : explicitIndexPermission(context);
    const permission = permissionValue === true ? "allowed" : permissionValue === false ? "blocked" : "unknown";
    const hasData = Boolean(
      firstText(regime.summary, mediumTerm.label, shortTerm.label, legacyAllowed ? index.key : null, legacyAllowed ? index.label : null, legacyAllowed ? index.cycle : null, legacyAllowed ? index.summary : null)
      || structures.length
      || firstText(forecast.primary && forecast.primary.label),
    );
    const ownBlocked = permissionValue === false || (canonicalState.present && !canonicalState.usable);
    const ownBlockers = ownBlocked ? ["indexOpportunity"] : [];
    const status = applyInheritedStatus(hasData, inheritedBlockers, ownBlocked);
    const indexTomorrowPlan = buildIndexTomorrowPlan(context);
    const step = commonStep(
      "indexOpportunity",
      status,
      [...inheritedBlockers, ...ownBlockers],
      firstText(regime.summary, shortTerm.label, mediumTerm.label, legacyAllowed ? index.summary : null, legacyAllowed ? index.label : null, legacyAllowed ? index.cycle : null),
      evidenceTexts(
        mediumTerm.evidence,
        shortTerm.evidence,
        intradayRhythm.evidence,
        marketConsensus.reasons,
        index.evidence,
        firstArray(forecast.evidence).filter((item) => item && item.scope === "index"),
        externalRisk.reasons,
        externalSignal.evidence,
      ),
    );
    return {
      ...step,
      permission,
      label: firstText(shortTerm.label, legacyAllowed ? index.label : null),
      keyValue: firstText(shortTerm.key, legacyAllowed ? index.key : null),
      cycle: firstText(mediumTerm.label, legacyAllowed ? index.cycle : null),
      tone: firstText(intradayRhythm.tone, legacyAllowed ? index.tone : null),
      verified: canonicalAvailable ? booleanOrNull(shortTerm.confirmed) : booleanOrNull(index.verified),
      metrics: {
        avgIndexChange: numberOrNull(firstDefined(index.avgIndexChange, snapshot.avgIndexChange)),
        breadth: numberOrNull(firstDefined(index.breadth, snapshot.breadth)),
        allAChangePct: numberOrNull(firstDefined(index.allAChangePct, snapshot.allA && snapshot.allA.changePct)),
        totalAmountYi: numberOrNull(firstDefined(snapshot.totalAmountYi, snapshot.shszAmountYi)),
      },
      structures,
      regimeVersion: numberOrNull(regime.version),
      canonicalState,
      mediumTerm: clone(mediumTerm),
      shortTerm: clone(shortTerm),
      intradayRhythm: clone(intradayRhythm),
      marketConsensus: clone(marketConsensus),
      opportunities: clone(firstArray(regime.opportunities)),
      warnings: clone(firstArray(regime.warnings)),
      tomorrowPaths: clone(firstArray(regime.tomorrowPaths)),
      validation: clone(firstObject(regime.validation)),
      positionPermission: clone(positionPermission),
      dataQuality: clone(firstObject(regime.dataQuality)),
      fiveDayEvidence: context.indexOpportunityEvidence === null
        ? null
        : clone(context.indexOpportunityEvidence),
      indexTomorrowPlan,
      forecast: {
        primaryKey: text(forecast.primary && forecast.primary.key),
        primaryLabel: text(forecast.primary && forecast.primary.label),
        probability: numberOrNull(forecast.primary && forecast.primary.probability),
        calibrated: booleanOrNull(forecast.calibrated),
      },
      tradeWindow: {
        key: text(tradeWindow.key),
        label: text(tradeWindow.label),
        tone: text(tradeWindow.tone),
        allowNew: booleanOrNull(tradeWindow.allowNew),
        allowAdd: booleanOrNull(tradeWindow.allowAdd),
        summary: text(tradeWindow.summary),
      },
      positionGuide: firstText(positionPermission.label, positionPermission.note, tradeWindow.positionGuide, context.marketState.positionGuide),
      positionLimit: Array.isArray(positionPermission.positionRangePct)
        && positionPermission.positionRangePct.length >= 2
        ? `${positionPermission.positionRangePct[0]}%-${positionPermission.positionRangePct[1]}%`
        : text(context.marketState.position),
      externalRisk: {
        available: booleanOrNull(firstDefined(externalRisk.available, externalSignal.available)),
        label: firstText(externalRisk.level, externalSignal.label),
        risk: numberOrNull(externalRisk.risk),
        penalty: numberOrNull(externalRisk.penalty),
        summary: firstText(externalRisk.summary, externalSignal.label),
      },
      ownBlocked,
    };
  }

  function independentRows(rows, candidateCodes) {
    const excluded = new Set(candidateCodes);
    return firstArray(rows).filter((row) => {
      if (!isObject(row)) return false;
      if (row.selectedCandidate === true) return false;
      const code = stockCode(row);
      return !code || !excluded.has(code);
    });
  }

  function projectPreferenceExample(row) {
    const source = isObject(row) ? row : {};
    return {
      code: stockCode(source),
      name: text(source.name),
      role: text(source.role),
      ticketType: text(source.ticketType),
      concept: firstText(source.concept, source.mainConcept),
      changePct: numberOrNull(source.changePct),
      effectType: text(source.effectType),
      reason: text(source.reason),
      eastRank: numberOrNull(source.eastRank),
      thsRank: numberOrNull(source.thsRank),
      crossListed: booleanOrNull(source.crossListed),
      executable: booleanOrNull(source.executable),
      quoteState: text(source.quoteState),
      note: text(source.note),
    };
  }

  function buildTradingPreference(context, inheritedBlockers, candidateCodes) {
    const style = context.tradingStyle;
    const preferenceModel = context.tradingStylePreference;
    const canonicalState = canonicalContractState(preferenceModel);
    const canonicalAvailable = canonicalState.usable;
    const legacyAllowed = !canonicalState.present;
    const marketOrganization = firstObject(preferenceModel.marketOrganization);
    const currentObservationDominantPath = firstObject(
      preferenceModel.currentObservationDominantPath,
      preferenceModel.dominantPath,
    );
    const persistentPreference = firstObject(preferenceModel.persistentPreference);
    const persistenceContractPresent = Number(preferenceModel.version || 0) >= 3
      && Number(persistentPreference.version || 0) >= 1;
    const persistentPrimary = firstObject(persistentPreference.primaryPath);
    const dominantPath = persistenceContractPresent
      ? Object.keys(persistentPrimary).length
        ? {
            ...persistentPrimary,
            status: persistentPreference.status === "parallel" ? "parallel" : "dominant",
            paths: Array.isArray(persistentPreference.confirmedPaths)
              ? persistentPreference.confirmedPaths.map((row) => text(row && row.key)).filter(Boolean)
              : [text(persistentPrimary.key)].filter(Boolean),
            reason: text(persistentPreference.conclusion),
          }
        : { key: "unknown", label: "持续偏好尚未确认", status: "unknown", paths: [], reason: text(persistentPreference.conclusion) }
      : currentObservationDominantPath;
    const executionPreference = firstObject(preferenceModel.executionPreference);
    const directionPermission = persistenceContractPresent
      ? firstObject(preferenceModel.persistentDirectionPermission)
      : firstObject(preferenceModel.directionPermission);
    const representativesByPath = firstObject(preferenceModel.representatives);
    const observationRepresentativesByPath = firstObject(preferenceModel.observationRepresentatives);
    const analysis = firstObject(style.analysis);
    const profitEffect = firstObject(analysis.profitEffect);
    const canonicalExamples = canonicalAvailable
      ? ["highTrend", "lowLaunch", "boardEmotion"].flatMap((key) => {
          const observations = firstArray(observationRepresentativesByPath[key]);
          const strictRepresentatives = firstArray(representativesByPath[key]);
          const rows = observations.length ? observations : strictRepresentatives;
          return rows.map((row) => ({
            ...row,
            effectType: firstText(row.effectType, preferenceModel.paths && preferenceModel.paths[key] && preferenceModel.paths[key].label),
          }));
        })
      : [];
    const rawExamples = canonicalAvailable
      ? canonicalExamples
      : legacyAllowed
        ? firstArray(analysis.examples, profitEffect.cases)
        : [];
    const examples = independentRows(rawExamples, candidateCodes).map(projectPreferenceExample);
    const hasData = canonicalAvailable
      ? Boolean(firstText(marketOrganization.label, dominantPath.label, executionPreference.summary, persistentPreference.conclusion))
      : legacyAllowed && Boolean(firstText(style.style, style.preference, style.bias, analysis.conclusion));
    const executionStatus = text(directionPermission.executionStatus);
    const executionBlocked = canonicalAvailable
      ? !["allowed", "conditional"].includes(executionStatus)
      : false;
    const ownBlocked = (canonicalState.present && !canonicalAvailable) || executionBlocked;
    const ownBlockers = ownBlocked ? ["tradingPreference"] : [];
    const status = applyInheritedStatus(hasData, inheritedBlockers, ownBlocked);
    const step = commonStep(
      "tradingPreference",
      status,
      [...inheritedBlockers, ...ownBlockers],
      canonicalAvailable
        ? [persistentPreference.conclusion, marketOrganization.label, dominantPath.label, executionPreference.summary].filter(Boolean).join("；")
        : legacyAllowed ? firstText(analysis.conclusion, style.preference, style.style) : null,
      canonicalAvailable
        ? evidenceTexts(
            marketOrganization.evidence,
            ...Object.values(firstObject(preferenceModel.paths)).map((path) => path && path.evidence),
          )
        : legacyAllowed ? evidenceTexts(analysis.reverseLogic, profitEffect.continuityReasons) : [],
    );
    return {
      ...step,
      style: firstText(marketOrganization.label, legacyAllowed ? style.style : null),
      preference: firstText(dominantPath.label, legacyAllowed ? style.preference : null),
      bias: firstText(executionPreference.summary, legacyAllowed ? style.bias : null),
      topDirection: legacyAllowed ? text(style.topDirection) : null,
      continuity: legacyAllowed ? text(profitEffect.continuity) : null,
      counts: {
        topMembers: numberOrNull(style.topMembers),
        topLimitCount: numberOrNull(style.topLimitCount),
        hotLimitCount: numberOrNull(style.hotLimitCount),
        trendWaveCount: numberOrNull(style.trendWaveCount),
        capacityTrendCount: numberOrNull(style.capacityTrendCount),
      },
      independentExamples: examples,
      excludedCandidateCodes: candidateCodes.filter((code) => rawExamples.some((row) => stockCode(row) === code)),
      preferenceVersion: numberOrNull(preferenceModel.version),
      conclusionState: persistenceContractPresent
        ? text(preferenceModel.persistentConclusionState)
        : text(preferenceModel.conclusionState),
      persistentConclusionState: text(preferenceModel.persistentConclusionState),
      sourceCoverage: clone(firstObject(preferenceModel.sourceCoverage)),
      canonicalState,
      marketOrganization: clone(marketOrganization),
      dominantPath: clone(dominantPath),
      currentObservationDominantPath: clone(currentObservationDominantPath),
      persistentPreference: clone(persistentPreference),
      persistence: clone(firstObject(preferenceModel.persistence)),
      lossEffect: clone(firstObject(preferenceModel.lossEffect)),
      paths: clone(firstObject(preferenceModel.paths)),
      executionPreference: clone(executionPreference),
      opportunities: clone(firstArray(preferenceModel.opportunities)),
      cautions: clone(firstArray(preferenceModel.cautions)),
      observationRepresentatives: clone(observationRepresentativesByPath),
      representatives: clone(representativesByPath),
      tomorrowPaths: clone(firstArray(preferenceModel.tomorrowPaths)),
      directionPermission: clone(directionPermission),
      executionBlocked,
      ownBlocked,
    };
  }

  function projectCoreItem(row) {
    const source = isObject(row) ? row : {};
    return {
      code: stockCode(source),
      name: text(source.name),
      stage: text(source.stage),
      stageLabel: text(source.stageLabel),
      previousStage: text(source.previousStage),
      impact: numberOrNull(firstDefined(source.impact, source.weight)),
      confidence: numberOrNull(source.confidence),
      source: text(source.source),
    };
  }

  function explicitEmotionPermission(emotion) {
    const light = firstText(emotion.light, emotion.lightLabel, emotion.riskLight);
    const redLight = Boolean(light && (light.toLowerCase() === "red" || /红灯/.test(light)));
    if (emotion.riskBlockNewEntry === true || emotion.allowNew === false || redLight) return false;
    return booleanOrNull(firstDefined(emotion.allowTrade, emotion.allowed, emotion.allowNew));
  }

  function buildEmotionStage(context, inheritedBlockers, candidateCodes) {
    const emotion = context.marketEmotion;
    const cycle = context.sentimentCycle;
    const emotionCycle = context.emotionCycle;
    const canonicalState = canonicalContractState(emotionCycle);
    const canonicalAvailable = canonicalState.usable;
    const legacyAllowed = !canonicalState.present;
    const currentEmotion = firstObject(emotionCycle.current);
    const emotionMetrics = firstObject(emotionCycle.metrics);
    const basket = firstObject(cycle.coreBasket);
    const canonicalAnchors = canonicalAvailable ? firstArray(emotionCycle.rankedAnchors) : [];
    const rawItems = canonicalAvailable
      ? canonicalAnchors.map((row) => ({
          ...row,
          stage: firstText(row.stage, currentEmotion.key),
          stageLabel: firstText(row.stageLabel, currentEmotion.label),
          impact: firstDefined(row.anchorScore, row.weight),
          confidence: firstDefined(row.confidence, currentEmotion.confidence),
          source: firstText(row.source, row.layerLabel),
        }))
      : legacyAllowed
        ? firstArray(cycle.items, context.tomorrowDecision.coreEmotion && context.tomorrowDecision.coreEmotion.items)
        : [];
    const independentItems = independentRows(rawItems, candidateCodes).map(projectCoreItem);
    const canonicalPermission = firstObject(emotionCycle.executionPermission);
    const canonicalPermissionStatus = text(canonicalPermission.status);
    const legacyPermissionValue = explicitEmotionPermission(emotion);
    const canonicalHardBlock = canonicalAvailable && (
      ["harmful", "retreat"].includes(String(currentEmotion.key || ""))
      || canonicalPermissionStatus === "blocked"
    );
    const canonicalWaitForSupport = canonicalAvailable
      && canonicalPermission.immediateEntry === false
      && canonicalPermission.conditionalAfterSupport === true;
    const canonicalObserveOnly = canonicalAvailable
      && canonicalPermission.immediateEntry === false
      && canonicalPermission.conditionalAfterSupport !== true;
    const permissionValue = canonicalState.present && !canonicalAvailable
      ? false
      : canonicalHardBlock
        ? false
        : canonicalWaitForSupport
          ? null
          : canonicalAvailable && canonicalPermission.immediateEntry === true
            ? true
            : legacyPermissionValue;
    const ownBlocked = permissionValue === false
      || canonicalObserveOnly
      || (canonicalState.present && !canonicalAvailable);
    const ownBlockers = ownBlocked ? ["emotionStage"] : [];
    const hasData = canonicalAvailable
      ? Boolean(firstText(currentEmotion.key, currentEmotion.label) && currentEmotion.key !== "unknown")
      : legacyAllowed && Boolean(firstText(
          emotion.cycle,
          emotion.summary,
          cycle.aggregateStage,
          cycle.aggregateStageLabel,
          cycle.marketRegime && cycle.marketRegime.label,
        ));
    const status = canonicalAvailable && !hasData && !inheritedBlockers.length && !ownBlocked
      ? "unknown"
      : applyInheritedStatus(hasData, inheritedBlockers, ownBlocked);
    const canonicalBaseline = firstObject(emotionCycle.tomorrowBaseline);
    const expected = canonicalAvailable ? canonicalBaseline : firstObject(cycle.expectedTransition);
    const reportedExcluded = booleanOrNull(basket.selectedCandidateExcludedFromPositiveValidation);
    const independentPositiveCount = reportedExcluded === false && candidateCodes.length
      ? null
      : numberOrNull(basket.positiveIndependentCount);
    const step = commonStep(
      "emotionStage",
      status,
      [...inheritedBlockers, ...ownBlockers],
      canonicalAvailable
        ? firstText(currentEmotion.label, currentEmotion.reason)
        : legacyAllowed ? firstText(emotion.summary, cycle.aggregateStageLabel, cycle.marketRegime && cycle.marketRegime.label) : null,
      canonicalAvailable
        ? evidenceTexts(
            emotionCycle.dataQuality && emotionCycle.dataQuality.notes,
            ...canonicalAnchors.slice(0, 8).map((row) => row && row.heat && row.heat.evidence),
          )
        : legacyAllowed ? evidenceTexts(emotion.evidence, cycle.verification) : [],
    );
    return {
      ...step,
      permission: permissionValue === true
        ? "allowed"
        : permissionValue === false || ownBlocked
          ? "blocked"
          : canonicalWaitForSupport
            ? "conditional_after_support"
            : "unknown",
      cycle: canonicalAvailable ? "高位短线情绪" : legacyAllowed ? firstText(cycle.marketRegime && cycle.marketRegime.label, emotion.cycle) : null,
      cycleKey: canonicalAvailable ? "short_term_emotion" : legacyAllowed ? text(cycle.marketRegime && cycle.marketRegime.key) : null,
      stage: canonicalAvailable ? text(currentEmotion.key) : legacyAllowed ? text(cycle.aggregateStage) : null,
      stageLabel: canonicalAvailable ? text(currentEmotion.label) : legacyAllowed ? text(cycle.aggregateStageLabel) : null,
      light: text(emotion.light),
      lightLabel: text(emotion.lightLabel),
      action: text(emotion.action),
      expectedTransition: {
        key: text(expected.key),
        label: text(expected.label),
        probability: canonicalAvailable ? null : numberOrNull(expected.probability),
      },
      divergence: {
        size: canonicalAvailable ? null : text(cycle.divergenceSize),
        quality: canonicalAvailable ? null : text(cycle.divergenceQuality),
      },
      emotionVersion: numberOrNull(emotionCycle.version),
      canonicalState,
      currentEmotion: clone(currentEmotion),
      previousEmotion: clone(firstObject(emotionCycle.previous)),
      transition: clone(firstObject(emotionCycle.transition)),
      cycleCondition: clone(firstObject(emotionCycle.cycleCondition)),
      themeStages: clone(firstArray(emotionCycle.themeStages)),
      marketStructure: clone(firstObject(emotionCycle.marketStructure)),
      emotionMetrics: clone(emotionMetrics),
      anchorLayers: clone(firstObject(emotionCycle.anchorLayers)),
      rankedAnchors: clone(canonicalAnchors.filter((row) => !candidateCodes.includes(stockCode(row)))),
      isolatedAnchors: clone(canonicalAnchors.filter((row) => candidateCodes.includes(stockCode(row)))),
      tomorrowPaths: clone(firstArray(emotionCycle.tomorrowPaths)),
      tomorrowBaseline: clone(canonicalBaseline),
      executionPermission: clone(canonicalPermission),
      conditionalAfterSupport: canonicalWaitForSupport,
      guardrails: clone(firstObject(emotionCycle.guardrails)),
      dataQuality: clone(firstObject(emotionCycle.dataQuality)),
      independentCoreValidation: {
        selectedCandidateCodes: candidateCodes.slice(),
        candidateExcluded: true,
        sourceReportedExclusion: reportedExcluded,
        positiveIndependentCount: independentPositiveCount,
        negativeHighImpactCount: numberOrNull(basket.negativeHighImpactCount),
        acceleratedIndependentCount: numberOrNull(basket.independentAcceleratedCount),
        items: independentItems,
      },
      ownBlocked,
    };
  }

  function projectThemeStock(row) {
    const source = isObject(row) ? row : {};
    const verifiedTags = firstArray(source.tags)
      .filter((tag) => isObject(tag) && tag.verified === true)
      .map((tag) => ({
        key: text(tag.key),
        label: text(tag.label),
        reason: text(tag.reason),
        style: text(tag.style),
        verified: true,
      }));
    return {
      code: stockCode(source),
      name: text(source.name),
      primaryRole: text(source.primaryRole),
      verifiedTags,
      detailTags: uniqueTexts(source.detailTags),
      roleStyles: uniqueTexts(source.roleStyles),
      subThemeTags: uniqueTexts(source.subThemeTags),
      changePct: numberOrNull(source.changePct),
      price: numberOrNull(source.price),
      amountYi: numberOrNull(source.amountYi),
      ticketType: text(source.ticketType),
      identity: text(source.identity),
      tradeState: text(source.tradeState),
    };
  }

  function canonicalThemeReasons(reasons) {
    return uniqueTexts(reasons).filter((reason) => !/^\s*(龙头|先锋|中军|补涨|低位补涨)\s*[：:]/.test(reason));
  }

  function projectDirection(row, canonicalTheme = false) {
    const source = isObject(row) ? row : {};
    const state = firstObject(source.directionState);
    const memberStats = firstObject(source.memberStats);
    const sector = firstObject(source.sector);
    const roleCounts = firstObject(source.roleCounts);
    const hotVerification = firstObject(source.hotVerification);
    return {
      id: firstText(source.id, source.family, source.name),
      name: text(source.name),
      family: text(source.family),
      displayName: text(source.displayName),
      aliases: uniqueTexts(source.aliases),
      subthemes: uniqueTexts(source.subthemes),
      subthemeDecision: clone(firstObject(source.globalSubthemeDecision, source.subthemeDecision)),
      medicalParent: booleanOrNull(source.medicalParent),
      label: text(source.label),
      summary: text(source.summary),
      isMainLine: booleanOrNull(source.isMainLine),
      isCoreDirection: booleanOrNull(firstDefined(source.isCoreDirection, state.isCoreDirection)),
      resonance: booleanOrNull(firstDefined(source.resonance, state.resonance)),
      sustained: booleanOrNull(firstDefined(source.sustained, state.sustained)),
      resonanceType: firstText(source.resonanceType, state.resonanceType),
      resonanceLabel: firstText(source.resonanceLabel, state.resonanceLabel),
      relativeToIndex: numberOrNull(firstDefined(source.relativeToIndex, state.relativeToIndex)),
      dailyKey: text(state.dailyKey),
      dailyLabel: text(state.dailyLabel),
      repairKey: text(state.repairKey),
      repairLabel: text(state.repairLabel),
      score: numberOrNull(source.score),
      memberCount: numberOrNull(firstDefined(source.count, memberStats.sampleCount)),
      limitCount: numberOrNull(source.limitCount),
      sectorName: firstText(sector.name, source.sectorName),
      sectorChangePct: numberOrNull(firstDefined(sector.changePct, source.sectorChangePct)),
      reasons: canonicalTheme ? canonicalThemeReasons(source.reasons) : uniqueTexts(source.reasons),
      poolType: text(source.poolType),
      poolState: firstText(source.poolState, hotVerification.state),
      directionConfirmationEligible: booleanOrNull(source.directionConfirmationEligible),
      directExecutionEligible: false,
      hotVerification: {
        state: text(hotVerification.state),
        label: text(hotVerification.label),
        hotStockCount: numberOrNull(hotVerification.hotStockCount),
        eastmoneyCount: numberOrNull(hotVerification.eastmoneyCount),
        thsCount: numberOrNull(hotVerification.thsCount),
        crossListedCount: numberOrNull(hotVerification.crossListedCount),
        representativeCodes: uniqueTexts(hotVerification.representativeCodes),
        priority: text(hotVerification.priority),
      },
      roleCounts: {
        leader: numberOrNull(roleCounts["龙头"]),
        pioneer: numberOrNull(roleCounts["先锋"]),
        capacity: numberOrNull(roleCounts["中军"]),
        followUp: numberOrNull(roleCounts["补涨"]),
      },
      stocks: canonicalTheme ? firstArray(source.stocks).map(projectThemeStock) : [],
    };
  }

  function directionExplicitlyBlocked(primary, riskBoard) {
    if (!isObject(primary)) return false;
    if (primary.blocked === true || primary.tradable === false || primary.allowed === false) return true;
    const name = text(primary.name);
    return Boolean(name && firstArray(riskBoard.blockedConcepts).map(text).includes(name));
  }

  function themeStockCodes(theme) {
    const subthemeDecision = firstObject(theme && theme.globalSubthemeDecision, theme && theme.subthemeDecision);
    const mainAttack = firstObject(subthemeDecision.mainAttackSubtheme);
    if (Array.isArray(mainAttack.memberCodes)) return uniqueTexts(mainAttack.memberCodes);
    return uniqueTexts(firstArray(theme && theme.stocks).map(stockCode));
  }

  function carrierCodesForDirection(tradingPreference) {
    const permission = firstObject(tradingPreference && tradingPreference.directionPermission);
    if (Array.isArray(permission.primaryEligibleCarrierCodes)) {
      return uniqueTexts(permission.primaryEligibleCarrierCodes);
    }
    return uniqueTexts(permission.eligibleCarrierCodes);
  }

  function directionHasEvidence(theme) {
    const source = isObject(theme) ? theme : {};
    const state = firstObject(source.directionState);
    return source.isMainLine === true
      || source.isCoreDirection === true
      || state.isCoreDirection === true
      || source.resonance === true
      || state.resonance === true
      || source.sustained === true
      || state.sustained === true;
  }

  function themeIdentity(theme) {
    return firstText(theme && theme.id, theme && theme.family, theme && theme.name);
  }

  function buildDirectionPool(context, inheritedBlockers) {
    const topicBoard = context.topicBoard;
    const themeLibrary = context.themeLibrary;
    const themeState = canonicalThemeLibraryState(themeLibrary);
    const hasCanonicalLibrary = themeState.usable;
    const poolContract = firstObject(themeLibrary.candidateThemePool);
    const hasPoolContract = hasCanonicalLibrary
      && Number(themeLibrary.poolContractVersion || poolContract.version || 0) >= 1;
    const sourceItems = hasCanonicalLibrary
      ? themeLibrary.themes
      : themeState.present
        ? []
        : firstArray(topicBoard.items).length
          ? firstArray(topicBoard.items)
          : Object.keys(firstObject(topicBoard.mainLine)).length
            ? [topicBoard.mainLine]
            : [];
    const canonical = hasCanonicalLibrary;
    const items = sourceItems.map((item) => projectDirection(item, canonical));
    const confirmationThemeIds = hasPoolContract
      ? uniqueTexts(poolContract.confirmationThemeIds)
      : sourceItems.map(themeIdentity).filter(Boolean);
    const confirmationSet = new Set(confirmationThemeIds);
    const priorityVerificationThemeIds = hasPoolContract
      ? uniqueTexts(poolContract.priorityVerificationThemeIds)
      : confirmationThemeIds.slice();
    const retainedObservationThemeIds = hasPoolContract
      ? uniqueTexts(poolContract.retainedObservationThemeIds)
      : [];
    const preliminarySource = firstObject(
      sourceItems.find((item) => item && item.isMainLine === true),
      sourceItems.find((item) => item && item.isCoreDirection === true),
      sourceItems[0],
    );
    const preliminaryPrimary = Object.keys(preliminarySource).length
      ? projectDirection(preliminarySource, canonical)
      : null;
    const poolUnavailable = (themeState.present && !themeState.usable)
      || (hasPoolContract && poolContract.available === false)
      || (hasPoolContract && !sourceItems.length);
    const poolOwnBlockers = poolUnavailable ? ["direction"] : [];
    const hasData = sourceItems.length > 0;
    const status = applyInheritedStatus(hasData, inheritedBlockers, poolUnavailable);
    const step = commonStep(
      "direction",
      status,
      [...inheritedBlockers, ...poolOwnBlockers],
      themeState.present && !themeState.usable
        ? firstText(themeLibrary.error, themeLibrary.reason, "题材库不可用，方向判断已暂停")
        : hasPoolContract
          ? confirmationThemeIds.length
            ? `题材主池中有${confirmationThemeIds.length}个方向与双榜Top100同时出现，进入后续验证。`
            : "题材主池已保留，但暂时没有方向通过双榜Top100验证。"
          : firstText(topicBoard.conclusion, preliminaryPrimary && preliminaryPrimary.summary, preliminaryPrimary && preliminaryPrimary.label),
      preliminaryPrimary ? preliminaryPrimary.reasons : [],
    );
    return {
      ...step,
      source: hasCanonicalLibrary ? "themeLibrary" : themeState.present ? "themeLibrary-unavailable" : "topicBoard",
      canonicalState: themeState,
      poolContractVersion: hasPoolContract ? Number(themeLibrary.poolContractVersion || poolContract.version) : null,
      poolStatus: status,
      primary: preliminaryPrimary,
      items,
      candidatePool: {
        source: hasPoolContract ? firstText(poolContract.source, "theme_library_main") : hasCanonicalLibrary ? "theme_library_legacy" : "topic_board_legacy",
        available: hasData && !poolUnavailable,
        hotRankCoverage: clone(firstObject(poolContract.hotRankCoverage)),
        mainThemeIds: hasPoolContract ? uniqueTexts(poolContract.mainThemeIds) : sourceItems.map(themeIdentity).filter(Boolean),
        priorityVerificationThemeIds,
        confirmationThemeIds,
        retainedObservationThemeIds,
        hotOnlyDiscoveries: clone(firstArray(poolContract.hotOnlyDiscoveries)).map((item) => ({
          ...item,
          directExecutionEligible: false,
          directionConfirmationEligible: false,
        })),
        directExecutionEligible: false,
        guardrails: uniqueTexts(poolContract.guardrails),
      },
      confirmationThemeIds,
      retainedObservationThemeIds,
      hotOnlyDiscoveryCount: firstArray(poolContract.hotOnlyDiscoveries).length,
      _sourceItems: sourceItems,
      _confirmationSet: confirmationSet,
      poolOwnBlocked: poolUnavailable,
      ownBlocked: poolUnavailable,
    };
  }

  function confirmDirection(context, inheritedBlockers, directionPool, tradingPreference, emotionStage) {
    const themeLibrary = context.themeLibrary;
    const themeState = directionPool.canonicalState;
    const hasCanonicalLibrary = Boolean(themeState && themeState.usable);
    const sourceItems = firstArray(directionPool._sourceItems);
    const hasPoolContract = Number(directionPool.poolContractVersion || 0) >= 1;
    const confirmationSet = directionPool._confirmationSet instanceof Set
      ? directionPool._confirmationSet
      : new Set(directionPool.confirmationThemeIds || []);
    const confirmationSourceItems = hasPoolContract
      ? sourceItems.filter((item) => confirmationSet.has(themeIdentity(item)))
      : sourceItems;
    const carrierCodes = carrierCodesForDirection(tradingPreference);
    const carrierSet = new Set(carrierCodes);
    const rankedByStyle = hasCanonicalLibrary && carrierCodes.length
      ? confirmationSourceItems
        .map((item, index) => ({
          item,
          index,
          matches: themeStockCodes(item).filter((code) => carrierSet.has(code)).length,
          hasEvidence: directionHasEvidence(item),
        }))
        .sort((left, right) => (
          right.matches - left.matches
          || Number(Boolean(right.item && right.item.isMainLine)) - Number(Boolean(left.item && left.item.isMainLine))
          || left.index - right.index
        ))
      : [];
    const primarySource = hasCanonicalLibrary
      ? firstObject(
        rankedByStyle[0] && rankedByStyle[0].matches > 0 ? rankedByStyle[0].item : null,
        confirmationSourceItems.find((item) => item && item.isMainLine === true),
        confirmationSourceItems.find((item) => item && item.isCoreDirection === true),
        confirmationSourceItems[0],
        sourceItems.find((item) => item && item.isMainLine === true),
        sourceItems[0],
      )
      : themeState.present
        ? {}
        : firstObject(context.topicBoard.mainLine, sourceItems.find((item) => item && item.isCoreDirection));
    const primary = Object.keys(primarySource).length ? projectDirection(primarySource, hasCanonicalLibrary) : null;
    const subthemeDecision = firstObject(primary && primary.subthemeDecision);
    const subthemeContractPresent = Number(subthemeDecision.version || 0) >= 1;
    const confirmedMainAttack = firstObject(subthemeDecision.mainAttackSubtheme);
    const noConfirmedMainAttack = subthemeContractPresent && !Object.keys(confirmedMainAttack).length;
    const eligibleDirectionSources = hasCanonicalLibrary && carrierCodes.length
      ? rankedByStyle
        .filter((row) => (
          row.matches > 0
          && row.hasEvidence
          && !directionExplicitlyBlocked(row.item, context.riskBoard)
        ))
        .slice(0, 3)
        .map((row) => row.item)
      : [];
    const eligibleDirections = eligibleDirectionSources.map((item) => projectDirection(item, true));
    const intersectionStockCodes = hasCanonicalLibrary && carrierCodes.length
      ? uniqueTexts(eligibleDirectionSources.flatMap(themeStockCodes))
      : primarySource ? themeStockCodes(primarySource) : [];
    const styleAlignmentRequired = Boolean(tradingPreference && tradingPreference.canonicalState && tradingPreference.canonicalState.usable)
      && carrierCodes.length > 0;
    const styleCarrierMatchCount = primarySource && styleAlignmentRequired
      ? themeStockCodes(primarySource).filter((code) => carrierSet.has(code)).length
      : null;
    const emotionConfirmed = Boolean(emotionStage && emotionStage.status === "ready" && emotionStage.permission !== "blocked");
    const poolReady = directionPool.poolStatus === "ready";
    const poolHasConfirmableDirection = !hasPoolContract || confirmationSourceItems.length > 0;
    const ownBlocked = directionPool.poolOwnBlocked === true
      || !poolReady
      || directionExplicitlyBlocked(primarySource, context.riskBoard)
      || !poolHasConfirmableDirection
      || (styleAlignmentRequired && (styleCarrierMatchCount === 0 || eligibleDirections.length === 0))
      || !emotionConfirmed
      || noConfirmedMainAttack;
    const confirmationBlocked = ownBlocked || inheritedBlockers.length > 0;
    const allowedStockCodes = confirmationBlocked ? [] : intersectionStockCodes;
    const step = commonStep(
      "direction",
      directionPool.poolStatus,
      directionPool.blockedBy,
      directionPool.conclusion,
      directionPool.evidence,
    );
    return {
      ...step,
      status: confirmationBlocked ? "blocked" : step.status,
      blockedBy: confirmationBlocked
        ? uniqueTexts([...inheritedBlockers, ...(ownBlocked ? ["direction"] : [])])
        : step.blockedBy,
      conclusion: subthemeContractPresent ? subthemeDecision.conclusion : step.conclusion,
      source: directionPool.source,
      canonicalState: clone(themeState),
      poolContractVersion: directionPool.poolContractVersion,
      poolStatus: directionPool.poolStatus,
      candidatePool: clone(directionPool.candidatePool),
      primary,
      eligibleDirections,
      focusDirection: themeState.present && !themeState.usable
        ? null
        : firstText(confirmedMainAttack.name),
      subthemeDecision: clone(subthemeDecision),
      items: clone(directionPool.items),
      styleCarrierCodes: carrierCodes,
      styleCarrierMatchCount,
      emotionConfirmed,
      screeningStatus: directionPool.poolStatus,
      executionBlocked: confirmationBlocked,
      confirmation: {
        status: confirmationBlocked ? "blocked" : "confirmed",
        blockedBy: uniqueTexts([
          ...inheritedBlockers,
          ...(ownBlocked ? ["direction"] : []),
        ]),
        poolThemeIds: directionPool.confirmationThemeIds.slice(),
        styleCarrierCodes: carrierCodes.slice(),
        eligibleThemeIds: eligibleDirectionSources.map(themeIdentity).filter(Boolean),
        eligibleStockCodes: allowedStockCodes.slice(),
        emotionConfirmed,
        hotOnlyExcluded: true,
      },
      allowedStockCodes,
      ownBlocked,
    };
  }

  function resolveRawCandidates(context) {
    const decision = context.tomorrowDecision;
    const unifiedChain = firstObject(context.source.unifiedDecisionChain);
    const formalProjectionPresent = Number(unifiedChain.version || 0) === 3
      && text(unifiedChain.authority) === "canonical_stock_decision"
      && text(context.bestPicks.selectionAuthority) === "unified_decision_chain_v3"
      && Number(context.bestPicks.decisionChainVersion || 0) === 3;
    if (formalProjectionPresent) return firstArray(context.bestPicks.picks).filter(isObject);
    const hasCanonicalDecision = Number(decision.version || 0) >= 1 && text(decision.method) !== null;
    if (!hasCanonicalDecision) return firstArray(context.bestPicks.picks, decision.candidates).filter(isObject);
    const rawByCode = new Map(firstArray(context.bestPicks.picks)
      .filter(isObject)
      .map((row) => [stockCode(row), row]));
    return firstArray(decision.candidates).filter(isObject).map((ticket) => {
      const raw = rawByCode.get(stockCode(ticket));
      return raw ? { ...raw, ...ticket, advice: firstObject(ticket.advice, raw.advice) } : { ...ticket };
    });
  }

  function candidateCodesFromContext(context) {
    const scenarioCandidates = firstArray(context.bestPicks.scenarioPlans)
      .map((plan) => plan && plan.candidate)
      .filter(isObject);
    const rows = [
      ...firstArray(context.bestPicks.picks),
      ...firstArray(context.tomorrowDecision.candidates),
      ...firstArray(context.tomorrowDecision.contingencies),
      ...scenarioCandidates,
    ].filter(isObject);
    const basketCode = text(context.sentimentCycle.coreBasket && context.sentimentCycle.coreBasket.selectedCandidateCode);
    return uniqueTexts([...rows.map(stockCode), basketCode]);
  }

  function priceIntegrity(candidate, globalIntegrity) {
    const local = firstObject(candidate.priceIntegrity);
    const price = numberOrNull(firstDefined(local.price, candidate.price, candidate.close, candidate.lastPrice));
    const reasons = [];
    if (price === null || price <= 0) reasons.push("missing_or_invalid_price");
    if (local.valid === false) reasons.push("price_marked_invalid");
    if (local.consistent === false) reasons.push("price_inconsistent");
    const localStatus = firstText(local.status, local.grade);
    if (localStatus && /^(invalid|error|failed|unavailable|warn)$/i.test(localStatus)) reasons.push("price_integrity_not_passed");
    const globalStatus = firstText(globalIntegrity.status, globalIntegrity.grade);
    if (globalStatus && !/^(pass|ok|valid)$/i.test(globalStatus)) reasons.push("global_price_integrity_not_passed");
    if (firstArray(local.errors).length) reasons.push("price_integrity_errors_present");
    return {
      status: reasons.length ? "blocked" : "usable",
      price,
      valid: booleanOrNull(local.valid),
      consistent: booleanOrNull(local.consistent),
      sourceStatus: localStatus,
      reasons: uniqueTexts(reasons),
    };
  }

  function rawAdvice(candidate) {
    const nested = firstObject(candidate.advice);
    const canonicalAllocation = canonicalAllocationOf(candidate);
    return {
      buy: clone(firstDefined(nested.buy, candidate.buy, candidate.tradePlan && candidate.tradePlan.buy) ?? null),
      hold: clone(firstDefined(nested.hold, candidate.hold, candidate.tradePlan && candidate.tradePlan.hold) ?? null),
      sell: clone(firstDefined(nested.sell, candidate.sell, candidate.tradePlan && candidate.tradePlan.sell) ?? null),
      holdingPeriod: clone(firstDefined(nested.holdingPeriod, candidate.holdingPeriod) ?? null),
      // 兼容 position 字段只镜像统一链仓位，绝不再读取旧 candidate/stopLossPlan/advice 仓位。
      position: clone(canonicalAllocation),
      canonicalAllocation: clone(canonicalAllocation),
      allocationAuthority: canonicalAllocation ? "unified_decision_chain_v3" : null,
      legacyObservation: legacyPositionObservation(candidate),
      triggers: clone(firstArray(
        candidate.triggers,
        candidate.tomorrowExecution && candidate.tomorrowExecution.triggers,
      )),
      cancelConditions: clone(firstArray(
        candidate.cancelConditions,
        candidate.tomorrowExecution && candidate.tomorrowExecution.cancelConditions,
      )),
    };
  }

  function meaningfulAdvicePart(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (isObject(value)) return Object.keys(value).length > 0;
    return true;
  }

  function adviceCompleteness(advice) {
    const fields = {
      buy: meaningfulAdvicePart(advice.buy),
      hold: meaningfulAdvicePart(advice.hold),
      sell: meaningfulAdvicePart(advice.sell),
      holdingPeriod: meaningfulAdvicePart(advice.holdingPeriod),
    };
    const missing = Object.keys(fields).filter((key) => fields[key] !== true);
    return {
      complete: missing.length === 0,
      fields,
      missing,
    };
  }

  function projectCandidate(candidate, globalIntegrity, strictExecutionContract = false) {
    const integrity = priceIntegrity(candidate, globalIntegrity);
    const advice = rawAdvice(candidate);
    const adviceIntegrity = adviceCompleteness(advice);
    const safeAdvice = integrity.status === "usable" && adviceIntegrity.complete ? advice : null;
    const execution = firstObject(candidate.tomorrowExecution);
    const leadership = firstObject(candidate.leadership);
    const hardGate = firstObject(candidate.hardGate);
    const qualificationGates = {
      tomorrowEntryQualified: booleanOrNull(firstDefined(
        execution.tomorrowEntryQualified,
        candidate.tomorrowEntryQualified,
      )),
      candidateTradeQualified: booleanOrNull(candidate.tradeQualified),
      leadershipTradeQualified: booleanOrNull(leadership.tradeQualified),
      hardGatePassed: booleanOrNull(hardGate.pass),
    };
    const requiredGateEntries = Object.entries(qualificationGates);
    const missingRequiredGates = strictExecutionContract
      ? requiredGateEntries.filter(([, value]) => value !== true).map(([key]) => key)
      : [];
    const marketQualified = strictExecutionContract
      ? missingRequiredGates.length === 0
      : qualificationGates.tomorrowEntryQualified === true
        && qualificationGates.candidateTradeQualified !== false
        && qualificationGates.leadershipTradeQualified !== false
        && qualificationGates.hardGatePassed !== false;
    return {
      code: stockCode(candidate),
      name: text(candidate.name),
      role: text(candidate.role),
      direction: firstText(candidate.mainConcept, candidate.focusDirection, candidate.concept),
      identity: firstText(candidate.identity, leadership.identity, leadership.levelLabel),
      stateLabel: firstText(candidate.stateLabel, execution.stateLabel),
      qualified: marketQualified,
      qualificationGates,
      executionContractVersion: strictExecutionContract ? 3 : null,
      missingRequiredGates,
      price: integrity.price,
      changePct: numberOrNull(candidate.changePct),
      amountYi: numberOrNull(candidate.amountYi),
      priceIntegrity: integrity,
      evidence: evidenceTexts(candidate.reasons, candidate.evidence, execution.evidence),
      canonicalAllocation: clone(advice.canonicalAllocation),
      allocationAuthority: advice.allocationAuthority,
      legacyObservation: clone(advice.legacyObservation),
      advice: safeAdvice,
      adviceIntegrity,
      adviceBlocked: integrity.status !== "usable" || !adviceIntegrity.complete,
    };
  }

  function buildStocks(context, inheritedBlockers, tradingPreference, direction) {
    const globalIntegrity = firstObject(context.bestPicks.priceIntegrity);
    const strictExecutionContract = Number(context.bestPicks.executionVersion || 0) >= 3;
    const styleCanonical = Boolean(tradingPreference && tradingPreference.canonicalState && tradingPreference.canonicalState.usable);
    const styleCodes = new Set(uniqueTexts(
      firstObject(tradingPreference && tradingPreference.directionPermission).primaryEligibleCarrierCodes
        || firstObject(tradingPreference && tradingPreference.directionPermission).eligibleCarrierCodes,
    ));
    const directionCanonical = Boolean(direction && direction.canonicalState && direction.canonicalState.usable);
    const directionCodes = new Set(uniqueTexts(direction && direction.allowedStockCodes));
    const candidates = resolveRawCandidates(context).map((candidate) => {
      const projected = projectCandidate(candidate, globalIntegrity, strictExecutionContract);
      const styleMatch = styleCanonical ? styleCodes.has(projected.code) : null;
      const directionMatch = directionCanonical ? directionCodes.has(projected.code) : null;
      const qualified = projected.qualified === true && styleMatch !== false && directionMatch !== false;
      const unqualifiedReasons = [];
      if (projected.qualified !== true) unqualifiedReasons.push("candidate_execution_gate_failed");
      if (styleMatch === false) unqualifiedReasons.push("style_path_mismatch");
      if (directionMatch === false) unqualifiedReasons.push("direction_mismatch");
      if (!projected.adviceIntegrity.complete) unqualifiedReasons.push("incomplete_trade_lifecycle_advice");
      return {
        ...projected,
        qualified,
        styleMatch,
        directionMatch,
        unqualifiedReasons,
      };
    });
    const explicitlyUnavailable = context.bestPicks.available === false;
    const allUnsafe = candidates.length > 0 && candidates.every((candidate) => candidate.adviceBlocked);
    const allExplicitlyUnqualified = candidates.length > 0 && candidates.every((candidate) => candidate.qualified === false);
    const ownBlocked = explicitlyUnavailable || allUnsafe || allExplicitlyUnqualified;
    const ownBlockers = ownBlocked ? ["stocks"] : [];
    const hasData = candidates.length > 0 || explicitlyUnavailable;
    const status = applyInheritedStatus(hasData, inheritedBlockers, ownBlocked);
    const step = commonStep(
      "stocks",
      status,
      [...inheritedBlockers, ...ownBlockers],
      firstText(context.bestPicks.note, context.tomorrowDecision.direction && context.tomorrowDecision.direction.reason),
      [],
    );
    return {
      ...step,
      available: booleanOrNull(context.bestPicks.available),
      candidates,
      unsafeCandidateCodes: candidates.filter((candidate) => candidate.adviceBlocked).map((candidate) => candidate.code),
      unqualifiedCandidateCodes: candidates.filter((candidate) => candidate.qualified === false).map((candidate) => candidate.code),
      styleEligibleCodes: [...styleCodes],
      directionEligibleCodes: [...directionCodes],
      ownBlocked,
    };
  }

  function projectTradePlan(candidate, executionMode) {
    return {
      code: candidate.code,
      name: candidate.name,
      buy: clone(candidate.advice.buy),
      hold: clone(candidate.advice.hold),
      sell: clone(candidate.advice.sell),
      holdingPeriod: clone(candidate.advice.holdingPeriod),
      // post-close旧契约仍读取position；这里给它的是canonical镜像，不是legacy仓位。
      position: clone(candidate.canonicalAllocation),
      canonicalAllocation: clone(candidate.canonicalAllocation),
      allocationAuthority: candidate.allocationAuthority,
      legacyObservation: clone(candidate.legacyObservation),
      triggers: clone(candidate.advice.triggers),
      cancelConditions: clone(candidate.advice.cancelConditions),
      executionMode,
    };
  }

  function buildTradePlan(context, inheritedBlockers, priorSteps, stocks) {
    const upstreamReady = priorSteps.every((step) => step.status === "ready");
    const styleExecutionBlocked = priorSteps.some((step) => step.key === "tradingPreference" && step.executionBlocked === true);
    const emotionStep = priorSteps.find((step) => step.key === "emotionStage") || {};
    const conditionalAfterSupport = emotionStep.conditionalAfterSupport === true;
    const safeCandidates = stocks.candidates.filter((candidate) => (
      candidate.qualified === true
      && candidate.advice
      && !candidate.adviceBlocked
      && (!conditionalAfterSupport || (
        candidate.advice.triggers.length > 0
        && candidate.advice.cancelConditions.length > 0
      ))
    ));
    const canIssueAdvice = upstreamReady && !styleExecutionBlocked && inheritedBlockers.length === 0 && safeCandidates.length > 0;
    const candidateExecutionMode = conditionalAfterSupport ? "conditional_after_support" : "normal";
    const hasSourcePlan = safeCandidates.length > 0;
    const status = inheritedBlockers.length
      ? "blocked"
      : canIssueAdvice
        ? "ready"
        : hasSourcePlan
          ? "unknown"
          : stocks.status === "blocked"
          ? "blocked"
          : "unknown";
    const executionMode = status === "blocked" ? "blocked" : candidateExecutionMode;
    const plans = canIssueAdvice ? safeCandidates.map((candidate) => projectTradePlan(candidate, executionMode)) : [];
    const blockers = inheritedBlockers.length
      ? inheritedBlockers
      : styleExecutionBlocked ? ["tradingPreference"]
      : stocks.status === "blocked" ? ["stocks"] : [];
    const step = commonStep(
      "tradePlan",
      status,
      blockers,
      firstText(context.tomorrowDecision.action && context.tomorrowDecision.action.summary, context.bestPicks.note),
      evidenceTexts(
        context.tomorrowDecision.validation && context.tomorrowDecision.validation.upgrade,
        context.tomorrowDecision.validation && context.tomorrowDecision.validation.downgrade,
      ),
    );
    const legacyPlan = {
      ...step,
      canIssueAdvice,
      executionMode,
      plans,
      invalidation: clone(firstDefined(context.tomorrowDecision.invalidation, null)),
    };
    const workbench = workbenchApi && typeof workbenchApi.buildPreplanScenarioWorkbench === "function"
      ? workbenchApi.buildPreplanScenarioWorkbench(context.source, { formalPlans: plans })
      : null;
    const workbenchValid = workbenchApi && typeof workbenchApi.validatePreplanScenarioWorkbench === "function"
      ? workbenchApi.validatePreplanScenarioWorkbench(workbench)
      : false;
    return workbenchValid
      ? { ...legacyPlan, ...workbench, plans }
      : {
        ...legacyPlan,
        version: 2,
        method: "conditional_playbook_projection_v1",
        dataStatus: "unavailable",
        executionStatus: plans.length ? "open" : "closed",
        scenarioContext: null,
        conditionalScripts: [],
        formalPlans: plans,
        diagnosticOnly: [],
        hardBlocks: [{ scope: "data", key: "conditional_playbook_projection_unavailable", reason: "条件剧本投影不可用", recoverable: false }],
        holdingManagement: { independent: true, route: "#sell-advisor", label: "持仓与卖出方案独立运行" },
        reviewSchedule: ["09:25", "09:35", "首次分歧", "14:30"],
      };
  }

  function nextBlockers(current, step) {
    return uniqueTexts([
      ...current,
      ...(step.ownBlocked ? [step.key] : []),
    ]);
  }

  function stripInternalFlags(step) {
    const result = { ...step };
    delete result.ownBlocked;
    delete result.poolOwnBlocked;
    delete result._sourceItems;
    delete result._confirmationSet;
    return result;
  }

  function buildPremarketFlow(payload) {
    const context = resolveContext(payload);
    const candidateCodes = candidateCodesFromContext(context);
    let blockers = [];

    const indexOpportunityInternal = buildIndexOpportunity(context, blockers);
    const indexBlockers = nextBlockers(blockers, indexOpportunityInternal);

    // 第二步先建立题材候选池；这里只做“主池 / 热榜验证 / 热榜新发现”分层，
    // 不读取风格或情绪结论，因此不是把旧的方向页机械挪到前面。
    const directionPoolInternal = buildDirectionPool(context, indexBlockers);

    // 风格与情绪都只继承指数硬否决，二者彼此独立，也不继承题材预选结果，
    // 防止“先选题材，再用同一批票证明风格/情绪”的自证循环。
    const tradingPreferenceInternal = buildTradingPreference(context, indexBlockers, candidateCodes);
    const emotionStageInternal = buildEmotionStage(context, indexBlockers, candidateCodes);

    let confirmationBlockers = indexBlockers.slice();
    confirmationBlockers = nextBlockers(confirmationBlockers, tradingPreferenceInternal);
    confirmationBlockers = nextBlockers(confirmationBlockers, emotionStageInternal);
    const directionInternal = confirmDirection(
      context,
      confirmationBlockers,
      directionPoolInternal,
      tradingPreferenceInternal,
      emotionStageInternal,
    );
    blockers = nextBlockers(confirmationBlockers, directionInternal);

    const stocksInternal = buildStocks(context, blockers, tradingPreferenceInternal, directionInternal);
    blockers = nextBlockers(blockers, stocksInternal);

    const priorSteps = [
      indexOpportunityInternal,
      directionInternal,
      tradingPreferenceInternal,
      emotionStageInternal,
      stocksInternal,
    ];
    const tradePlan = buildTradePlan(context, blockers, priorSteps, stocksInternal);

    const indexOpportunity = stripInternalFlags(indexOpportunityInternal);
    const tradingPreference = stripInternalFlags(tradingPreferenceInternal);
    const emotionStage = stripInternalFlags(emotionStageInternal);
    const direction = stripInternalFlags(directionInternal);
    const stocks = stripInternalFlags(stocksInternal);
    const steps = [indexOpportunity, direction, tradingPreference, emotionStage, stocks, tradePlan];

    return {
      version: 1,
      sourceUpdatedAt: firstText(context.source.updatedAt, context.source.fetchedAt),
      stepOrder: FLOW_STEP_KEYS.slice(),
      status: tradePlan.status,
      blockedAt: blockers.length ? blockers[0] : null,
      indexTomorrowPlan: clone(indexOpportunity.indexTomorrowPlan),
      indexOpportunity,
      tradingPreference,
      emotionStage,
      direction,
      stocks,
      tradePlan,
      steps,
      integrity: {
        candidateSelfProofExcluded: true,
        excludedCandidateCodes: candidateCodes,
        themePoolBuiltBeforeWholeMarketAnalysis: true,
        wholeMarketStyleIndependentOfThemePool: true,
        wholeMarketEmotionIndependentOfThemePool: true,
        hotOnlyDirectionsCannotExecute: true,
        unknownNumbersPreservedAsNull: true,
        concreteAdviceRequiresUsablePrice: true,
        deterministicIndexTomorrowPlan: true,
        legacyForecastExcludedFromIndexTomorrowPlan: true,
        fiveDayOnlyAffectsExecutionRhythm: true,
        canonicalAllocationOnly: true,
        legacyPositionObservationOnly: true,
      },
    };
  }

  return Object.freeze({
    FLOW_STEPS,
    FLOW_STEP_KEYS,
    buildPremarketFlow,
  });
}));
