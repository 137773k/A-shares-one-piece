const form = document.querySelector("#scoreForm");















const stockForm = document.querySelector("#stockForm");















const saveReview = document.querySelector("#saveReview");















const watchlistBody = document.querySelector("#watchlistBody");









const sellAdvisorForm = document.querySelector("#sellAdvisorForm");









const sellAdvisorHoldings = document.querySelector("#sellAdvisorHoldings");









const sellAdvisorReport = document.querySelector("#sellAdvisorReport");









const sellAdvisorContext = document.querySelector("#sellAdvisorContext");









const sellAdvisorMeta = document.querySelector("#sellAdvisorMeta");









const sellAdvisorCount = document.querySelector("#sellAdvisorCount");









const sellAdvisorUpdatedAt = document.querySelector("#sellAdvisorUpdatedAt");









const sellAdvisorRefreshBtn = document.querySelector("#sellAdvisorRefreshBtn");














const historyList = document.querySelector("#historyList");















const fetchHotStocks = document.querySelector("#fetchHotStocks");















const fetchHotStocksDash = document.querySelector("#fetchHotStocksDash");

const cloudHistorySyncBtn = document.querySelector("#cloudHistorySyncBtn");
const cloudHistorySyncStatus = document.querySelector("#cloudHistorySyncStatus");
const cloudCurrentSyncStatus = document.querySelector("#cloudCurrentSyncStatus");
const localVerifyHotStocksBtn = document.querySelector("#localVerifyHotStocksBtn");
const decisionAuthorityLanesView = document.querySelector("#decisionAuthorityLanes");
const decisionAuthorityCurrent = document.querySelector("#decisionAuthorityCurrent");
const decisionLaneLocalBtn = document.querySelector("#decisionLaneLocal");
const decisionLaneCloudBtn = document.querySelector("#decisionLaneCloud");















const selectedStocks = document.querySelector("#selectedStocks");















const rejectedStocks = document.querySelector("#rejectedStocks");















const hotConcepts = document.querySelector("#hotConcepts");















const realtimeQuotes = document.querySelector("#realtimeQuotes");















const realtimeHealth = document.querySelector("#realtimeHealth");















const publicDataUrl = window.PUBLIC_DATA_URL || "";

const HOT_STOCKS_FETCH_TIMEOUT_MS = 85000;

async function fetchWithTimeout(url, options = {}, timeoutMs = HOT_STOCKS_FETCH_TIMEOUT_MS, consumeResponse = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return typeof consumeResponse === "function" ? await consumeResponse(response) : response;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("抓取超时，已停止等待失效数据源");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}































const CYCLE_COLORS = { 主升: "#e23b3b", 震荡: "#6f7783", 混沌: "#8a8f99", 退潮: "#2f7fd1", 冰点: "#2f7fd1" };

function normalizeBigCycleLabelForDisplay(value) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw || /修复|repair|recovery|反弹|rebound|分歧|diverg|加强|strengthen|加速|acceleration|候选|candidate|partial/.test(raw)) return "";
  if (["主升", "主升期", "main_rise", "mainrise", "markup"].includes(raw)) return "主升";
  if (["震荡", "震荡期", "range", "sideways"].includes(raw)) return "震荡";
  if (["混沌", "混沌期", "chaos", "mixed"].includes(raw)) return "混沌";
  if (["退潮", "退潮期", "retreat", "mark_down", "mark-down"].includes(raw)) return "退潮";
  if (["冰点", "冰点期", "ice", "ice_point"].includes(raw)) return "冰点";
  return "";
}

function sanitizeDecisionStockDecoration(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const sanitized = { ...source };
  delete sanitized.position;
  for (const key of ["stopLossPlan", "plan"]) {
    const nested = sanitized[key];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
    sanitized[key] = { ...nested };
    delete sanitized[key].position;
  }
  if (sanitized.card && typeof sanitized.card === "object" && !Array.isArray(sanitized.card)) {
    sanitized.card = { ...sanitized.card };
    const cardPlan = sanitized.card.plan;
    if (cardPlan && typeof cardPlan === "object" && !Array.isArray(cardPlan)) {
      sanitized.card.plan = { ...cardPlan };
      delete sanitized.card.plan.position;
    }
  }
  return sanitized;
}

function canonicalPositionAllocationText(value) {
  const allocation = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const initial = Number(allocation.initialPortfolioPct);
  const maximum = Number(allocation.maximumPortfolioPct);
  if (!Number.isFinite(initial) || !Number.isFinite(maximum) || initial < 0 || maximum < initial) return "";
  const display = (number) => Number.isInteger(number) ? String(number) : String(Math.round(number * 100) / 100);
  return `初始 ${display(initial)}% · 上限 ${display(maximum)}%`;
}

function resolveUnifiedDecisionChainProjection(payload) {
  const sanitizeDecoration = typeof sanitizeDecisionStockDecoration === "function"
    ? sanitizeDecisionStockDecoration
    : (value) => {
      const safe = value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
      delete safe.position;
      for (const key of ["stopLossPlan", "plan"]) {
        if (!safe[key] || typeof safe[key] !== "object" || Array.isArray(safe[key])) continue;
        safe[key] = { ...safe[key] };
        delete safe[key].position;
      }
      if (safe.card && typeof safe.card === "object" && !Array.isArray(safe.card)) {
        safe.card = { ...safe.card };
        if (safe.card.plan && typeof safe.card.plan === "object" && !Array.isArray(safe.card.plan)) {
          safe.card.plan = { ...safe.card.plan };
          delete safe.card.plan.position;
        }
      }
      return safe;
    };
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const chain = source.unifiedDecisionChain && typeof source.unifiedDecisionChain === "object"
    && !Array.isArray(source.unifiedDecisionChain)
    ? source.unifiedDecisionChain
    : null;
  const chainGeneration = chain && chain.generation && typeof chain.generation === "object"
    && !Array.isArray(chain.generation)
    ? chain.generation
    : {};
  const integrity = chain && chain.integrity && typeof chain.integrity === "object"
    && !Array.isArray(chain.integrity)
    ? chain.integrity
    : {};
  const marketStage = chain && chain.marketStage && typeof chain.marketStage === "object"
    && !Array.isArray(chain.marketStage)
    ? chain.marketStage
    : {};
  const authorization = chain && chain.authorization && typeof chain.authorization === "object"
    && !Array.isArray(chain.authorization)
    ? chain.authorization
    : {};
  const positionPermission = authorization.positionPermission && typeof authorization.positionPermission === "object"
    && !Array.isArray(authorization.positionPermission)
    ? authorization.positionPermission
    : {};
  const tradePermission = authorization.tradePermission && typeof authorization.tradePermission === "object"
    && !Array.isArray(authorization.tradePermission)
    ? authorization.tradePermission
    : {};
  const result = chain && chain.result && typeof chain.result === "object" && !Array.isArray(chain.result)
    ? chain.result
    : {};
  const observationCandidates = chain && chain.observationCandidates
    && typeof chain.observationCandidates === "object" && !Array.isArray(chain.observationCandidates)
    ? chain.observationCandidates : {};
  const text = (value) => String(value == null ? "" : value).trim();
  const codeOf = (value) => text(value && (value.code || value.secCode || value.stockCode || value.symbol)).toUpperCase();
  const rows = (value) => Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : [];
  const payloadGenerationId = text(source.generationId);
  const chainGenerationId = text(chainGeneration.generationId);
  const payloadTradingDate = text(source.tradingDate);
  const chainTradingDate = text(chainGeneration.tradingDate);
  const payloadAsOf = text(source.asOf);
  const chainAsOf = text(chainGeneration.asOf);
  const rawStocks = rows(result.stocks).slice(0, 6);
  const rawCodes = rawStocks.map(codeOf);
  const rawObservationStocks = rows(observationCandidates.stocks).slice(0, 6);
  const allowedObservationFields = new Set([
    "rank", "tierKey", "tierLabel", "setupKey", "setupLabel", "setupEvidence", "code", "name",
    "path", "paths", "pathLabel", "theme", "role", "observationReason", "expectation",
    "postEntryNextDayExpectation", "entryConfirmation", "capitalPreference", "profitPreference", "environmentFit",
    "leadership", "hardGatePassed", "opportunityDataCompleteness", "shortTermOpportunityStructure",
    "riskNotes", "executionFeasibility", "marketCapFit", "missingConditions", "confirmationConditions",
    "reopenConditions", "cancelConditions", "opportunityScore", "observationOnly", "executable",
    "executionAuthority",
  ]);
  const allowedExecutionFeasibilityFields = new Set([
    "version", "authority", "status", "executableNow", "canGrantExecution", "onlyTightens",
    "riskPenalty", "slippageRisk", "blockers", "cautions", "evidence", "rule",
  ]);
  const observationFieldsInvalid = rawObservationStocks.some((stock) => {
    const feasibility = stock.executionFeasibility && typeof stock.executionFeasibility === "object"
      && !Array.isArray(stock.executionFeasibility) ? stock.executionFeasibility : null;
    return stock.observationOnly !== true
      || stock.executable !== false
      || stock.executionAuthority !== false
      || Object.keys(stock).some((key) => !allowedObservationFields.has(key))
      || !feasibility
      || Number(feasibility.version) !== 1
      || feasibility.authority !== "unified_execution_feasibility_v1"
      || !["ready", "conditional", "blocked"].includes(text(feasibility.status))
      || feasibility.executableNow !== false
      || feasibility.canGrantExecution !== false
      || feasibility.onlyTightens !== true
      || Object.keys(feasibility).some((key) => !allowedExecutionFeasibilityFields.has(key));
  });
  const observationExpectationInvalid = rawObservationStocks.some((stock) => {
    const expectation = stock.expectation && typeof stock.expectation === "object"
      && !Array.isArray(stock.expectation) ? stock.expectation : {};
    const label = typeof expectation.label === "string" ? expectation.label.trim() : "";
    const evidenceValid = Array.isArray(expectation.evidence)
      && expectation.evidence.length > 0
      && expectation.evidence.every((item) => typeof item === "string" && item.trim());
    const sourcesValid = Array.isArray(expectation.evidenceSources)
      && expectation.evidenceSources.length > 0
      && expectation.evidenceSources.every((item) => typeof item === "string" && item.trim());
    const allowedKeys = new Set(["status", "label", "evidence", "evidenceSources"]);
    const forbiddenPromise = /保证|必涨|稳赚|零风险|无风险|满仓|梭哈|下单|直接买|立即买|必须买|无脑打板/.test(label);
    return expectation.status !== "qualified"
      || !label
      || label !== text(stock.observationReason)
      || !evidenceValid
      || expectation.evidence[0].trim() !== label
      || !sourcesValid
      || forbiddenPromise
      || Object.keys(expectation).some((key) => !allowedKeys.has(key));
  });
  const observationAuthorityFitInvalid = rawObservationStocks.some((stock) => {
    const environment = stock.environmentFit && typeof stock.environmentFit === "object"
      && !Array.isArray(stock.environmentFit) ? stock.environmentFit : {};
    const capital = stock.capitalPreference && typeof stock.capitalPreference === "object"
      && !Array.isArray(stock.capitalPreference) ? stock.capitalPreference : {};
    const profit = stock.profitPreference && typeof stock.profitPreference === "object"
      && !Array.isArray(stock.profitPreference) ? stock.profitPreference : {};
    return environment.status !== "matched"
      || environment.matched !== true
      || environment.generationAligned !== true
      || environment.marketEnvironmentKnown !== true
      || environment.activePathMatched !== true
      || environment.themeMatched !== true
      || capital.status !== "confirmed_match"
      || capital.matched !== true
      || profit.status !== "matched"
      || profit.matched !== true
      || !text(profit.primaryPath)
      || !Array.isArray(profit.matchedPaths)
      || !profit.matchedPaths.map(text).includes(text(profit.primaryPath));
  });
  const postEntryExpectationInvalid = rawObservationStocks.some((stock) => {
    const expectation = stock.postEntryNextDayExpectation
      && typeof stock.postEntryNextDayExpectation === "object"
      && !Array.isArray(stock.postEntryNextDayExpectation)
      ? stock.postEntryNextDayExpectation : {};
    const confirmation = stock.entryConfirmation
      && typeof stock.entryConfirmation === "object"
      && !Array.isArray(stock.entryConfirmation)
      ? stock.entryConfirmation : {};
    const preference = source.premarketModels && source.premarketModels.tradingStylePreference
      && typeof source.premarketModels.tradingStylePreference === "object"
      && !Array.isArray(source.premarketModels.tradingStylePreference)
      ? source.premarketModels.tradingStylePreference : {};
    const preferencePaths = preference.paths && typeof preference.paths === "object" && !Array.isArray(preference.paths)
      ? preference.paths : {};
    const canonicalPath = preferencePaths[text(stock.path)] && typeof preferencePaths[text(stock.path)] === "object"
      && !Array.isArray(preferencePaths[text(stock.path)]) ? preferencePaths[text(stock.path)] : {};
    const stage = text(canonicalPath.stage).toLowerCase();
    const expectedDefinition = stock.hardGatePassed === true && text(confirmation.status) === "waiting_trigger"
      ? text(stock.tierKey) === "limit_up_pullback_repair"
        ? { key: "pullback_repair_premium", label: "修复延续 / 冲击前高", riskLabel: "修复失败或再度走弱" }
        : text(stock.path) === "boardEmotion"
          ? {
            key: "board_premium",
            label: /acceleration|climax/.test(stage) ? "先看溢价 / 更防分歧兑现" : "核心溢价 / 晋级验证",
            riskLabel: "分歧兑现或高标负反馈",
          }
          : text(stock.path) === "lowLaunch"
            ? { key: "launch_premium", label: "启动溢价 / 题材继续发酵", riskLabel: "冲高回落或首板失败" }
            : text(stock.path) === "highTrend"
              ? {
                key: "trend_premium",
                label: /acceleration/.test(stage) ? "冲高溢价 / 更防兑现" : "趋势延续 / 再冲高",
                riskLabel: "趋势破位或低开兑现",
              }
              : null
      : null;
    const allowedKeys = new Set([
      "version", "status", "horizon", "premise", "key", "label", "riskLabel", "entryCondition",
      "invalidation", "basis", "pathStage", "probability", "calibrated", "observationOnly", "executionAuthority",
    ]);
    const conditionalInvalid = expectation.status === "conditional" && (
      !expectedDefinition
      || expectation.key !== expectedDefinition.key
      || expectation.label !== expectedDefinition.label
      || expectation.riskLabel !== expectedDefinition.riskLabel
      || expectation.premise !== "仅在明日确认条件满足后假设参与"
      || !stage || text(expectation.pathStage).toLowerCase() !== stage
      || typeof expectation.entryCondition !== "string" || !expectation.entryCondition.trim()
      || typeof expectation.invalidation !== "string" || !expectation.invalidation.trim()
      || typeof expectation.basis !== "string" || !expectation.basis.trim()
    );
    const unavailableInvalid = expectation.status === "unavailable" && (
      expectedDefinition !== null
      || expectation.key !== null
      || expectation.label !== "不适用（当前无买点）"
      || expectation.riskLabel !== "不预设上涨"
      || expectation.premise !== "买点确认未通过时不生成持有预期"
    );
    return Number(expectation.version) !== 1
      || !["conditional", "unavailable"].includes(text(expectation.status))
      || text(expectation.horizon) !== "entry_t_plus_1"
      || !text(expectation.label)
      || expectation.probability !== null
      || expectation.calibrated !== false
      || expectation.observationOnly !== true
      || expectation.executionAuthority !== false
      || Object.keys(expectation).some((key) => !allowedKeys.has(key))
      || conditionalInvalid
      || unavailableInvalid;
  });
  const opportunityDataCompletenessInvalid = rawObservationStocks.some((stock) => {
    const completeness = stock.opportunityDataCompleteness
      && typeof stock.opportunityDataCompleteness === "object"
      && !Array.isArray(stock.opportunityDataCompleteness)
      ? stock.opportunityDataCompleteness : {};
    const evidence = completeness.evidence && typeof completeness.evidence === "object"
      && !Array.isArray(completeness.evidence) ? completeness.evidence : {};
    return Number(completeness.version) !== 1
      || completeness.status !== "complete"
      || completeness.qualified !== true
      || completeness.opportunityEligible !== true
      || text(completeness.tradingDate) !== chainTradingDate
      || !Array.isArray(completeness.missingFields) || completeness.missingFields.length > 0
      || !Array.isArray(completeness.blockers) || completeness.blockers.length > 0
      || !Array.isArray(completeness.riskNotes)
      || completeness.fundFlowRequired !== false
      || !["price", "amount", "liquidityCapacity", "marketCap", "session"]
        .every((key) => evidence[key] && typeof evidence[key] === "object" && evidence[key].usable === true)
      || !evidence.fundFlow || typeof evidence.fundFlow !== "object" || evidence.fundFlow.required !== false;
  });
  const entryConfirmationInvalid = rawObservationStocks.some((stock) => {
    const confirmation = stock.entryConfirmation && typeof stock.entryConfirmation === "object"
      && !Array.isArray(stock.entryConfirmation) ? stock.entryConfirmation : {};
    const status = text(confirmation.status);
    const type = text(confirmation.type);
    const expectedType = stock.hardGatePassed !== true
      ? null
      : text(stock.tierKey) === "limit_up_pullback_repair"
        ? "support_or_breakout"
        : text(stock.path) === "boardEmotion" ? "reseal_board"
          : text(stock.path) === "lowLaunch" ? "first_board_or_breakout"
            : text(stock.path) === "highTrend" ? "support_reclaim" : null;
    const forbiddenFields = [
      "positionAllocation", "canonicalAllocation", "position", "positionPct", "positionPercent",
      "positionLimit", "recommendedPosition", "suggestedPosition", "targetPosition", "allocation",
      "buy", "sell", "hold", "order", "orderIntent", "orderPlan", "tradePlan", "execution",
      "executionPlan", "tomorrowTradePlan", "action", "side", "quantity", "qty", "lots", "shares",
      "entry", "entryPrice", "buyPrice", "limitPrice", "canBuy", "allowBuy", "tradeAllowed",
      "executionAllowed",
    ];
    const allowedConfirmationKeys = new Set([
      "version", "status", "type", "label", "reason", "avoid", "activated", "triggerConditions",
      "invalidation", "observationOnly", "executionAuthority",
    ]);
    const executionFeasibility = stock.executionFeasibility
      && typeof stock.executionFeasibility === "object"
      && !Array.isArray(stock.executionFeasibility) ? stock.executionFeasibility : null;
    const semanticMismatch = stock.hardGatePassed !== true
      ? status !== "blocked" || confirmation.type !== null
      : expectedType
        ? status !== "waiting_trigger" || typeof confirmation.type !== "string" || type !== expectedType
        : status !== "unavailable" || confirmation.type !== null;
    const postEntry = stock.postEntryNextDayExpectation
      && typeof stock.postEntryNextDayExpectation === "object"
      && !Array.isArray(stock.postEntryNextDayExpectation)
      ? stock.postEntryNextDayExpectation : {};
    const expectedLabels = {
      reseal_board: ["充分换手后的回封板", "回封板确认（当前未触发）"],
      support_or_breakout: ["承接转强 / 放量突破"],
      first_board_or_breakout: ["先锋首板 / 容量突破"],
      support_reclaim: ["回踩承接 / 重新转强"],
    };
    const label = typeof confirmation.label === "string" ? confirmation.label.trim() : "";
    const labelSemanticMismatch = status === "waiting_trigger"
      ? !expectedLabels[type] || !expectedLabels[type].includes(label)
      : status === "blocked"
        ? !["当前不可确认（成交额不足）", "当前不可确认（方向未通过）", "当前不可确认（硬门槛未过）"].includes(label)
        : !["买点确认待数据补足", "买点确认方式待识别"].includes(label);
    const stringFieldsValid = ["reason", "avoid", "invalidation"]
      .every((key) => typeof confirmation[key] === "string" && confirmation[key].trim());
    const triggerConditionsValid = Array.isArray(confirmation.triggerConditions)
      && confirmation.triggerConditions.length > 0
      && confirmation.triggerConditions.every((item) => typeof item === "string" && item.trim());
    return Number(confirmation.version) !== 1
      || !["waiting_trigger", "blocked", "unavailable"].includes(status)
      || !label
      || !stringFieldsValid
      || confirmation.activated !== false
      || confirmation.observationOnly !== true
      || confirmation.executionAuthority !== false
      || (status === "waiting_trigger" && !triggerConditionsValid)
      || Object.keys(confirmation).some((key) => !allowedConfirmationKeys.has(key))
      || forbiddenFields.some((key) => Object.prototype.hasOwnProperty.call(stock, key))
      || typeof stock.hardGatePassed !== "boolean"
      || !["limit_up_pullback_repair", "reopen_candidate", "path_representative", "hard_gate_failed"].includes(text(stock.tierKey))
      || !executionFeasibility
      || Number(executionFeasibility.version) !== 1
      || executionFeasibility.authority !== "unified_execution_feasibility_v1"
      || !["ready", "conditional", "blocked"].includes(text(executionFeasibility.status))
      || executionFeasibility.executableNow !== false
        || executionFeasibility.canGrantExecution !== false
        || executionFeasibility.onlyTightens !== true
        || executionFeasibility.allowNew === true
        || executionFeasibility.allowAdd === true
        || executionFeasibility.canExecute === true
      || semanticMismatch
      || labelSemanticMismatch
      || (status === "waiting_trigger" ? postEntry.status !== "conditional" : postEntry.status !== "unavailable");
  });
  const selectedCodes = Array.isArray(result.selectedCodes) ? result.selectedCodes.map((value) => text(value).toUpperCase()) : [];
  const blockers = [];
  if (!chain) blockers.push("统一决策链缺失");
  if (chain && chain.version !== 3) blockers.push("统一决策链版本必须为v3");
  if (chain && text(chain.method) !== "strict_sequential_fail_closed_v1") blockers.push("统一决策链严格顺序方法不匹配");
  if (chain && text(chain.authority) !== "canonical_stock_decision") blockers.push("统一决策链权威来源不正确");
  if (chain && chainGeneration.aligned !== true) blockers.push("统一决策链内部代次未对齐");
  if (chain && (!payloadGenerationId || !chainGenerationId || payloadGenerationId !== chainGenerationId)) {
    blockers.push("统一决策链与当前快照代次不一致");
  }
  if (chain && (!payloadTradingDate || !chainTradingDate || payloadTradingDate !== chainTradingDate)) {
    blockers.push("统一决策链与当前快照交易日不一致");
  }
  if (chain && (!payloadAsOf || !chainAsOf || payloadAsOf !== chainAsOf)) blockers.push("统一决策链与当前快照asOf不一致");
  if (chain && integrity.ok !== true) blockers.push("统一决策链完整性未通过");
  if (chain && integrity.failClosed !== true) blockers.push("统一决策链未声明失败关闭");
  if (chain && integrity.noForcedCandidate !== true) blockers.push("统一决策链未声明禁止强行补位");
  if (chain && integrity.postEntryExpectationConditionalOnly !== true) {
    blockers.push("统一决策链未声明买后次日预期仅为条件路径");
  }
  if (chain && integrity.entryConfirmationRequired !== true) {
    blockers.push("统一决策链未声明机会股必须给出买点确认方式");
  }
  if (chain && integrity.opportunityDataCompletenessRequired !== true) {
    blockers.push("统一决策链未声明机会关键数据契约为必须项");
  }
  if (chain && observationFieldsInvalid) blockers.push("观察候选泄漏仓位、买点或执行权限");
  if (chain && observationExpectationInvalid) blockers.push("观察机会股看点不是合规的证据摘要");
  if (chain && observationAuthorityFitInvalid) blockers.push("观察机会股未通过当前环境、持续赚钱偏好、题材与资金偏好交集");
  if (chain && postEntryExpectationInvalid) blockers.push("观察机会股买后次日预期契约不完整");
  if (chain && opportunityDataCompletenessInvalid) blockers.push("观察机会股当日关键数据契约不完整");
  if (chain && entryConfirmationInvalid) blockers.push("观察机会股买点确认方式契约不完整");
  const expectedStrictOrder = [
    "market_stage",
    "authorization",
    "profit_effect",
    "theme",
    "stock_mode",
    "stock_hard_gate",
    "result_stocks",
    "participation_allocation",
  ];
  const strictOrder = Array.isArray(integrity.strictOrder) ? integrity.strictOrder.map(text) : [];
  if (chain && (strictOrder.length !== expectedStrictOrder.length
    || strictOrder.some((key, index) => key !== expectedStrictOrder[index]))) blockers.push("统一决策链严格顺序完整性校验失败");
  if (chain && (integrity.maxResultStocks !== 5 || result.maxStocks !== 5)) blockers.push("统一决策链结果上限必须为5只");
  if (chain && (!chain.marketStage || !chain.authorization || !chain.profitEffect || !chain.theme
    || !chain.stockMode || !chain.stockSelectionContext || !chain.result)) blockers.push("统一决策链必需层缺失");
  if (chain && (!marketStage.bigCycle || !text(marketStage.bigCycle.key) || !text(marketStage.bigCycle.label)
    || typeof marketStage.passed !== "boolean")) blockers.push("统一决策链市场阶段结构非法");
  if (chain && (typeof authorization.passed !== "boolean" || typeof tradePermission.allowNew !== "boolean")) {
    blockers.push("统一决策链交易授权结构非法");
  }
  const positionCeilingPct = Number(positionPermission.positionCeilingPct);
  const initialActivationPct = Number(positionPermission.initialActivationPct);
  if (chain && (![positionCeilingPct, initialActivationPct].every(Number.isFinite)
    || positionCeilingPct < 0 || initialActivationPct < 0 || initialActivationPct > positionCeilingPct)) {
    blockers.push("统一决策链仓位权限结构非法");
  }
  const resultStatus = text(result.status);
  if (chain && !["ready", "blocked", "no_candidate"].includes(resultStatus)) blockers.push("统一决策链结果状态非法");
  if (rawStocks.length > 5 || rawCodes.some((code) => !code) || new Set(rawCodes).size !== rawCodes.length) {
    blockers.push("统一决策链结果股票结构非法");
  }
  if (result.selectedCount === null || result.selectedCount === undefined
    || !Number.isInteger(result.selectedCount)
    || !Array.isArray(result.selectedCodes)
    || Number(result.selectedCount) !== rawStocks.length
    || selectedCodes.length !== rawCodes.length
    || selectedCodes.some((code, index) => code !== rawCodes[index])) {
    blockers.push("统一决策链结果数量或代码校验失败");
  }
  if (resultStatus === "ready" && rawStocks.length === 0) blockers.push("统一决策链声称可执行但没有结果股");
  if (resultStatus !== "ready" && rawStocks.length > 0) blockers.push("统一决策链关闭状态仍携带结果股");
  if (chain && (authorization.passed !== true || tradePermission.allowNew !== true) && rawStocks.length > 0) {
    blockers.push("统一决策链交易授权关闭但仍携带结果股");
  }
  const allocationRows = rawStocks.map((stock) => stock.positionAllocation && typeof stock.positionAllocation === "object"
    ? stock.positionAllocation : {});
  const allocationValuesValid = allocationRows.every((allocation) => {
    const relative = Number(allocation.relativeWeightPct);
    const initial = Number(allocation.initialPortfolioPct);
    const maximum = Number(allocation.maximumPortfolioPct);
    return [relative, initial, maximum].every(Number.isFinite)
      && relative >= 0 && initial >= 0 && maximum >= initial;
  });
  const allocationTotal = (key) => allocationRows.reduce((sum, allocation) => sum + (Number(allocation[key]) || 0), 0);
  const allocationEquals = (left, right) => Math.abs(Number(left) - Number(right)) <= 0.05;
  if (chain && resultStatus === "ready" && (
    !allocationValuesValid
    || !allocationEquals(allocationTotal("relativeWeightPct"), 100)
    || !allocationEquals(allocationTotal("initialPortfolioPct"), Number(positionPermission.initialActivationPct))
    || !allocationEquals(allocationTotal("maximumPortfolioPct"), Number(positionPermission.positionCeilingPct))
  )) blockers.push("统一决策链仓位分配合计校验失败");

  const contractReady = blockers.length === 0;
  const sourceExecutionFreshness = typeof resolvePayloadExecutionFreshness === "function"
    ? resolvePayloadExecutionFreshness(source)
    : { formalOpportunityEligible: true, evidenceUsable: true, blockers: [] };
  const executionOpen = Boolean(
    contractReady
    && sourceExecutionFreshness.formalOpportunityEligible === true
    && marketStage.passed === true
    && authorization.passed === true
    && tradePermission.allowNew === true
    && Number(positionPermission.positionCeilingPct) > 0
    && String(result.status || "") === "ready"
    && rawStocks.length > 0,
  );
  const sourcePositionRange = Array.isArray(positionPermission.sourceRangePct)
    ? positionPermission.sourceRangePct.map(Number).filter(Number.isFinite)
    : [];
  const sourcePositionCeilingPct = sourcePositionRange.length === 2
    ? Math.max(0, sourcePositionRange[1])
    : 0;
  const authorizationOpen = Boolean(
    contractReady
    && sourceExecutionFreshness.formalOpportunityEligible === true
    && authorization.passed === true
    && tradePermission.allowNew === true
    && Number(positionPermission.positionCeilingPct) > 0,
  );
  const positionMode = executionOpen
    ? "active"
    : authorizationOpen && sourcePositionCeilingPct > 0
      ? "waiting_candidate"
      : sourcePositionCeilingPct > 0
        ? "risk_only"
        : "closed";
  const decorations = new Map();
  const addDecoration = (item) => {
    const code = codeOf(item);
    if (!code) return;
    decorations.set(code, { ...(decorations.get(code) || {}), ...item });
  };
  rows(source.selected).forEach(addDecoration);
  rows(source.candidates).forEach(addDecoration);
  const bestPicks = source.bestPicks && typeof source.bestPicks === "object" ? source.bestPicks : {};
  rows(bestPicks.decisionPool).forEach(addDecoration);
  rows(bestPicks.picks).forEach(addDecoration);
  rows(bestPicks.scenarioPlans).forEach((plan) => addDecoration(plan && plan.candidate));
  const tomorrowDecision = source.tomorrowDecision && typeof source.tomorrowDecision === "object" ? source.tomorrowDecision : {};
  const tomorrowDecorationAligned = Boolean(
    contractReady
    && chainGenerationId
    && text(tomorrowDecision.generationId) === chainGenerationId
    && text(tomorrowDecision.tradingDate) === chainTradingDate
    && text(tomorrowDecision.asOf) === chainAsOf,
  );
  (tomorrowDecorationAligned ? rows(tomorrowDecision.contingencies) : []).forEach(addDecoration);
  (tomorrowDecorationAligned ? rows(tomorrowDecision.candidates) : []).forEach(addDecoration);
  const opportunityDirections = tomorrowDecorationAligned && tomorrowDecision.opportunityMap && Array.isArray(tomorrowDecision.opportunityMap.directions)
    ? tomorrowDecision.opportunityMap.directions
    : tomorrowDecorationAligned && Array.isArray(tomorrowDecision.opportunityDirections) ? tomorrowDecision.opportunityDirections : [];
  rows(opportunityDirections).forEach((direction) => rows(direction.tradeCandidates || direction.candidates).forEach(addDecoration));
  const stocks = executionOpen ? rawStocks.map((stock) => {
    const code = codeOf(stock);
    const decorated = sanitizeDecoration(decorations.get(code) || {});
    const canonicalStock = sanitizeDecoration(stock);
    return {
      ...decorated,
      ...canonicalStock,
      code,
      name: text(canonicalStock.name || decorated.name || code),
      participationValue: stock.participationValue && typeof stock.participationValue === "object" ? { ...stock.participationValue } : null,
      riskAdjustment: stock.riskAdjustment && typeof stock.riskAdjustment === "object" ? { ...stock.riskAdjustment } : null,
      positionAllocation: stock.positionAllocation && typeof stock.positionAllocation === "object" ? { ...stock.positionAllocation } : null,
      selectionAuthority: "unified_decision_chain_v3",
    };
  }) : [];
  const observationStocks = contractReady
    ? rawObservationStocks.slice(0, 5).filter((stock) => (
      stock.observationOnly === true
      && stock.executable === false
      && stock.executionAuthority === false
      && !(stock.positionAllocation && typeof stock.positionAllocation === "object")
      && !(stock.buy && typeof stock.buy === "object")
    )).map((stock) => ({ ...stock }))
    : [];
  const sumAllocation = (key) => stocks.reduce((sum, stock) => {
    const value = Number(stock && stock.positionAllocation && stock.positionAllocation[key]);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const chainReasons = [
    ...(Array.isArray(marketStage.blockers) ? marketStage.blockers : []),
    ...(Array.isArray(authorization.reasons) ? authorization.reasons : []),
    ...(Array.isArray(result.blockers) ? result.blockers : []),
    ...(sourceExecutionFreshness.formalOpportunityEligible === true
      ? [] : Array.isArray(sourceExecutionFreshness.blockers) ? sourceExecutionFreshness.blockers : ["抓取证据不允许正式机会"]),
  ].map(text).filter(Boolean);
  return {
    canonical: true,
    contractReady,
    executionOpen,
    sourceExecutionFreshness,
    chain,
    generationAligned: contractReady,
    generationId: contractReady ? chainGenerationId : "",
    tradingDate: contractReady ? chainTradingDate : "",
    asOf: contractReady ? chainAsOf : "",
    marketStage: contractReady ? marketStage : {},
    authorization: contractReady ? authorization : {},
    result: contractReady ? result : {},
    stocks,
    observationCandidates: observationStocks,
    observationCandidateStatus: text(observationCandidates.status),
    observationCandidateBlockers: Array.isArray(observationCandidates.blockers)
      ? observationCandidates.blockers.map(text).filter(Boolean) : [],
    selectedCodes: stocks.map((stock) => stock.code),
    initialPortfolioPct: executionOpen ? round2(sumAllocation("initialPortfolioPct")) : 0,
    maximumPortfolioPct: executionOpen ? round2(sumAllocation("maximumPortfolioPct")) : 0,
    positionCeilingPct: executionOpen ? Math.max(0, Number(positionPermission.positionCeilingPct) || 0) : 0,
    sourcePositionRangePct: sourcePositionRange.length === 2 ? sourcePositionRange : null,
    sourcePositionCeilingPct,
    positionMode,
    contractErrors: [...blockers],
    decisionReasons: Array.from(new Set(chainReasons)),
    blockers: Array.from(new Set([...blockers, ...chainReasons])),
    rule: "正式阶段、许可、候选与仓位只读统一决策链v3；其他模型只能补充同代同代码证据",
  };
}































function setText(selector, text) {















  const el = document.querySelector(selector);















  if (el) el.textContent = text;















}































// 短线偏好 → 趋势 / 连板 / 轮动 / 主线 的口语标签















function shortPreferenceLabel(preference) {















  const map = {















    "趋势二波/三波": "趋势（二波/三波）",















    "高标抱团": "连板 / 高标抱团",















    "主线进攻": "主线龙头进攻",















    "轮动回流": "轮动回流",















  };















  return map[preference] || preference || "--";















}































// ===== 炒作逻辑 / 预期状态（自动 + 手动补事件，手动优先，存本地） =====















let lastHotPayload = null;
let indexOpportunityEvidenceRequest = null;
const indexOpportunityEvidenceLoads = new WeakMap();
const PREMARKET_DIRECT_BUY_MAX_AGE_MS = 20 * 60 * 60 * 1000;
const premarketDirectBuyFreshPayloads = new WeakMap();
let premarketDirectBuyFreshnessTimer = null;
let premarketDirectBuyFreshnessTimerPayload = null;
let activeDecisionAuthority = "unknown";
let activeDecisionAuthorityDetail = "";
let activeUnifiedProjectionReady = false;
let cloudCurrentAuthorityConfigured = null;
let cloudCurrentSyncFlight = null;
const decisionAuthorityLanes = {
  active: "unknown",
  cloud: null,
  local: null,
};

function decisionAuthorityLaneText(value) {
  return String(value == null ? "" : value).trim();
}

function decisionAuthorityPayloadTradingDate(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const asOf = source.asOf && typeof source.asOf === "object" ? source.asOf : {};
  const generation = source.generationContext && typeof source.generationContext === "object"
    ? source.generationContext
    : {};
  return decisionAuthorityLaneText(
    source.tradingDate
    || source.market && source.market.snapshot && source.market.snapshot.tradingDate
    || source.tomorrowDecision && source.tomorrowDecision.tradingDate
    || source.decisionBasis && source.decisionBasis.tradingDate
    || generation.tradingDate
    || asOf.tradingDate
    || source.market && source.market.limitStats && source.market.limitStats.dates
      && source.market.limitStats.dates.today,
  );
}

function decisionAuthorityPayloadGenerationId(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const generation = source.generationContext && typeof source.generationContext === "object"
    ? source.generationContext
    : {};
  return decisionAuthorityLaneText(
    source.generationId
    || source.tomorrowDecision && source.tomorrowDecision.generationId
    || source.decisionBasis && source.decisionBasis.generationId
    || generation.generationId
    || generation.id,
  );
}

function decisionAuthorityPayloadAsOf(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const asOf = source.asOf && typeof source.asOf === "object" ? source.asOf : {};
  const generation = source.generationContext && typeof source.generationContext === "object"
    ? source.generationContext
    : {};
  return decisionAuthorityLaneText(
    typeof source.asOf === "string" ? source.asOf : ""
    || source.tomorrowDecision && source.tomorrowDecision.asOf
    || source.decisionBasis && source.decisionBasis.asOf
    || generation.asOf
    || asOf.iso
    || asOf.timestamp
    || source.fetchedAt
    || source.updatedAt,
  );
}

function decisionAuthorityGenerationTimestamp(value) {
  const raw = decisionAuthorityLaneText(value);
  if (!raw) return null;
  const direct = Date.parse(raw);
  if (Number.isFinite(direct)) return direct;
  const iso = raw.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})/);
  const parsed = iso ? Date.parse(iso[0]) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function decisionAuthorityLaneMeta(authority, payload) {
  const key = authority === "cloud" ? "cloud" : "local";
  const generationId = decisionAuthorityPayloadGenerationId(payload);
  const asOf = decisionAuthorityPayloadAsOf(payload);
  const generationTimestamp = decisionAuthorityGenerationTimestamp(asOf)
    ?? decisionAuthorityGenerationTimestamp(generationId)
    ?? decisionAuthorityGenerationTimestamp(payload && payload.fetchedAt)
    ?? decisionAuthorityGenerationTimestamp(payload && payload.updatedAt);
  return {
    key,
    authority: key === "cloud" ? "cloud_formal" : "local_observation",
    label: key === "cloud" ? "云端正式" : "本机最新",
    tradingDate: decisionAuthorityPayloadTradingDate(payload),
    generationId,
    asOf,
    generationTimestamp,
  };
}

function compareDecisionAuthorityLaneMeta(candidate, current) {
  if (!candidate && !current) return 0;
  if (candidate && !current) return 1;
  if (!candidate && current) return -1;
  const candidateDate = decisionAuthorityLaneText(candidate.tradingDate);
  const currentDate = decisionAuthorityLaneText(current.tradingDate);
  if (candidateDate && currentDate && candidateDate !== currentDate) {
    return candidateDate > currentDate ? 1 : -1;
  }
  if (candidateDate && !currentDate) return 1;
  if (!candidateDate && currentDate) return -1;
  const candidateTime = Number(candidate.generationTimestamp);
  const currentTime = Number(current.generationTimestamp);
  const candidateTimeReady = Number.isFinite(candidateTime);
  const currentTimeReady = Number.isFinite(currentTime);
  if (candidateTimeReady && currentTimeReady && candidateTime !== currentTime) {
    return candidateTime > currentTime ? 1 : -1;
  }
  if (candidateTimeReady && !currentTimeReady) return 1;
  if (!candidateTimeReady && currentTimeReady) return -1;
  return 0;
}

function decisionAuthorityGenerationClock(meta) {
  if (!meta || !Number.isFinite(Number(meta.generationTimestamp))) return "--";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(Number(meta.generationTimestamp)));
  } catch {
    return "--";
  }
}

function rememberDecisionAuthorityLane(authority, payload, options = {}) {
  if (!payload || typeof payload !== "object") return null;
  const key = authority === "cloud" ? "cloud" : "local";
  const previous = decisionAuthorityLanes[key];
  const lane = {
    key,
    payload,
    meta: decisionAuthorityLaneMeta(key, payload),
    detail: decisionAuthorityLaneText(options.detail) || previous && previous.detail || "",
    executionAuthority: key === "cloud" && options.executionAuthority === true,
  };
  decisionAuthorityLanes[key] = lane;
  if (options.active === true) decisionAuthorityLanes.active = key;

  const localLane = key === "local" ? lane : decisionAuthorityLanes.local;
  const cloudLane = key === "cloud" ? lane : decisionAuthorityLanes.cloud;
  if (localLane && cloudLane && compareDecisionAuthorityLaneMeta(localLane.meta, cloudLane.meta) > 0) {
    cloudLane.executionAuthority = false;
    try { setPremarketDirectBuyPayloadFresh(cloudLane.payload, false); } catch { /* newer local observation closes old cloud execution */ }
  }
  if (key === "local") {
    lane.executionAuthority = false;
    payload.executionAuthority = false;
    try { setPremarketDirectBuyPayloadFresh(payload, false); } catch { /* local lane is observation-only */ }
  }
  return lane;
}

function renderDecisionAuthorityLaneCards() {
  const activeKey = decisionAuthorityLanes.active;
  const activeLane = decisionAuthorityLanes[activeKey] || null;
  const fillLaneButton = (button, lane, fallbackAuthority) => {
    if (!button) return;
    const span = button.querySelector("span");
    const strong = button.querySelector("strong");
    const small = button.querySelector("small");
    button.disabled = !lane;
    button.setAttribute("aria-pressed", lane && lane.key === activeKey ? "true" : "false");
    if (!lane) {
      if (strong) strong.textContent = "暂无快照";
      if (small) small.textContent = `authority=${fallbackAuthority}`;
      return;
    }
    const clock = decisionAuthorityGenerationClock(lane.meta);
    const localNewer = lane.key === "cloud" && decisionAuthorityLanes.local
      && compareDecisionAuthorityLaneMeta(decisionAuthorityLanes.local.meta, lane.meta) > 0;
    if (span) span.textContent = lane.meta.label;
    if (strong) strong.textContent = `${lane.meta.tradingDate || "日期待确认"} · generation ${clock}`;
    if (small) small.textContent = `authority=${lane.meta.authority} · executionAuthority=${lane.executionAuthority === true}${localNewer ? " · 落后本机" : ""}`;
    button.title = `generation=${lane.meta.generationId || "--"}; asOf=${lane.meta.asOf || "--"}`;
    button.dataset.tradingDate = lane.meta.tradingDate || "";
    button.dataset.generationId = lane.meta.generationId || "";
  };

  fillLaneButton(decisionLaneLocalBtn, decisionAuthorityLanes.local, "local_observation");
  fillLaneButton(decisionLaneCloudBtn, decisionAuthorityLanes.cloud, "cloud_formal");
  if (decisionAuthorityLanesView) decisionAuthorityLanesView.dataset.activeAuthority = activeLane ? activeLane.meta.authority : "unknown";
  if (decisionAuthorityCurrent) {
    const span = decisionAuthorityCurrent.querySelector("span");
    const strong = decisionAuthorityCurrent.querySelector("strong");
    const small = decisionAuthorityCurrent.querySelector("small");
    const activeClock = activeLane ? decisionAuthorityGenerationClock(activeLane.meta) : "--";
    const activeSource = activeLane && activeLane.key === "cloud" ? "云端同步" : "本机核验";
    const otherLane = activeLane && activeLane.key === "cloud" ? decisionAuthorityLanes.local : decisionAuthorityLanes.cloud;
    const activeNewer = Boolean(activeLane && otherLane
      && compareDecisionAuthorityLaneMeta(activeLane.meta, otherLane.meta) > 0);
    const sameGeneration = Boolean(activeLane && otherLane
      && compareDecisionAuthorityLaneMeta(activeLane.meta, otherLane.meta) === 0);
    const activePayload = activeLane && activeLane.payload && typeof activeLane.payload === "object"
      ? activeLane.payload : null;
    const restoredOnly = Boolean(activePayload && activePayload.restoredFromDisk === true
      && activePayload.clientRefreshVerified !== true);
    let shanghaiToday = "";
    try {
      shanghaiToday = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    } catch { /* label remains conservative when the client clock cannot be read */ }
    const restoredToday = Boolean(restoredOnly && activeLane.meta.tradingDate
      && activeLane.meta.tradingDate === shanghaiToday);
    const currentLabel = !activeLane
      ? "等待决策快照"
      : restoredOnly
      ? restoredToday ? "已恢复今日收盘快照（核对中）" : "已恢复历史快照"
      : activeLane.executionAuthority === true
        ? "当前有效决策"
        : "当前观察快照（无执行权）";
    if (span) span.textContent = currentLabel;
    if (strong) strong.textContent = activeLane
      ? `${activeLane.meta.tradingDate || "日期待确认"} · ${activeClock} · ${activeSource}`
      : "等待决策快照";
    if (small) small.textContent = activeLane
      ? restoredOnly
        ? restoredToday
          ? "今日收盘快照已恢复，后台正在核对数据源与完整性；核对完成前不授予执行权"
          : "这是磁盘保留快照，后台正在核对最新交易日；未完成前不得当作当天决策"
        : activeLane.executionAuthority !== true
          ? "当日数据已经更新；质量门或交易权限仍关闭，当前结果只供观察"
        : sameGeneration
        ? "本机与云端已经对齐，页面只展示一份结果"
        : activeNewer
          ? `已自动采用较新的${activeSource}结果${activeLane.key === "local" ? "，云端稍后同步" : ""}`
          : "系统自动采用最新且完整的结果"
      : "系统自动采用最新且完整的结果";
    decisionAuthorityCurrent.title = activeLane
      ? `generation=${activeLane.meta.generationId || "--"}; asOf=${activeLane.meta.asOf || "--"}`
      : "";
  }
  try {
    document.documentElement.dataset.decisionAuthority = activeLane ? activeLane.meta.authority : "unknown";
    document.documentElement.dataset.decisionTradingDate = activeLane && activeLane.meta.tradingDate || "";
    document.documentElement.dataset.decisionGenerationId = activeLane && activeLane.meta.generationId || "";
  } catch { /* DOM metadata is supplementary */ }
}

function activateDecisionAuthorityLane(authority, options = {}) {
  const key = authority === "cloud" ? "cloud" : "local";
  const lane = decisionAuthorityLanes[key];
  if (!lane || !lane.payload) return false;
  if (key === "cloud" && decisionAuthorityLanes.local
    && compareDecisionAuthorityLaneMeta(decisionAuthorityLanes.local.meta, lane.meta) > 0) {
    lane.executionAuthority = false;
  }
  if (lane.executionAuthority !== true) {
    try { setPremarketDirectBuyPayloadFresh(lane.payload, false); } catch { /* inactive execution proof stays closed */ }
  }
  decisionAuthorityLanes.active = key;
  try {
    renderHotStocks(lane.payload);
  } catch (error) {
    console.error(`[decision-lane-render:${key}]`, error && error.stack || error);
    throw error;
  }
  setDecisionAuthority(key, lane.payload, decisionAuthorityLaneText(options.detail) || lane.detail);
  renderDecisionAuthorityLaneCards();
  return true;
}

function acceptDecisionAuthorityLane(authority, payload, options = {}) {
  const key = authority === "cloud" ? "cloud" : "local";
  const currentLane = decisionAuthorityLanes[decisionAuthorityLanes.active] || null;
  const lane = rememberDecisionAuthorityLane(key, payload, options);
  if (!lane) return { activated: false, lane: null };
  const freshness = currentLane ? compareDecisionAuthorityLaneMeta(lane.meta, currentLane.meta) : 1;
  const shouldActivate = !currentLane
    || freshness > 0
    || (freshness === 0 && lane.executionAuthority === true && currentLane.executionAuthority !== true);
  if (shouldActivate) {
    return {
      activated: activateDecisionAuthorityLane(key, { detail: options.detail }),
      lane,
    };
  }
  renderDecisionAuthorityLaneCards();
  return { activated: false, lane };
}
const themeLibraryViewState = {
  loaded: false,
  loading: false,
  requestId: 0,
  apiLoaded: false,
  refreshing: false,
  selectedDate: "",
  latestDate: "",
  response: null,
};
let sellAdvisorStorageStatus = "连接本地持仓文件中";
let sellAdvisorSaveChain = Promise.resolve();
let sellAdvisorHoldingsReady = Promise.resolve();















let editingSpecCode = null;















const SPEC_OVERRIDES_KEY = "shortModelSpecOverrides";































function getSpecOverrides() {















  return safeParseJSON(localStorage.getItem(SPEC_OVERRIDES_KEY) || "{}", {});















}































function saveSpecOverride(code, data) {















  const all = getSpecOverrides();















  all[code] = { expectation: data.expectation, logic: data.logic, source: "manual" };















  localStorage.setItem(SPEC_OVERRIDES_KEY, JSON.stringify(all));















}































// 有效炒作逻辑：手动标注覆盖自动判断















function getEffectiveSpec(stock) {















  const auto = stock.speculation || { logic: "", expectation: "在途", risk: "", source: "auto" };















  const override = getSpecOverrides()[stock.code];















  if (!override || !override.expectation) return auto;















  return {















    logic: override.logic || auto.logic,















    expectation: override.expectation,















    risk: override.expectation === auto.expectation ? auto.risk : "手动标注的预期状态",















    source: "manual",















  };















}































function specEditorHtml(code, spec) {















  const options = ["在途", "透支", "兑现"]















    .map((v) => `<option value="${v}" ${spec.expectation === v ? "selected" : ""}>${v}</option>`)















    .join("");















  return `<div class="spec-box spec-editing" data-spec-card="${code}">















    <label class="spec-field">预期状态















      <select data-spec-field="expectation">${options}</select>















    </label>















    <label class="spec-field">炒作逻辑 / 补事件（如：SpaceX 上市预期，落地即兑现）















      <textarea data-spec-field="logic" rows="3">${escapeHtml(spec.logic || "")}</textarea>















    </label>















    <div class="spec-editor-actions">















      <button class="primary-btn spec-save-btn" data-spec-save="${code}" type="button">保存</button>















      <button class="spec-cancel-btn" data-spec-cancel="${code}" type="button">取消</button>















    </div>















  </div>`;















}































// 按预期状态做减法：在途留入选池，透支/兑现移到剔除区















function renderSelectionPools(payload) {















  const unifiedProjection = resolveUnifiedDecisionChainProjection(payload);
  const all = unifiedProjection.executionOpen ? unifiedProjection.stocks : [];















  const keep = [];















  const specCut = [];















  for (const stock of all) {















    keep.push(stock);















  }































  selectedStocks.dataset.payload = JSON.stringify(keep);















  selectedStocks.innerHTML = keep.length















    ? keep.map((stock) => stockCard(stock)).join("")















    : `<div class="empty-state">${escapeHtml(unifiedProjection.blockers[0] || "统一决策链当前没有授权结果股，继续空仓等待；旧 selected 不会补位。")}</div>`;































  const cutCards = [















    ...specCut.map((stock) => stockCard(stock, true)),















    ...(payload.rejected || []).map((stock) => stockCard(stock, true)),















  ];















  rejectedStocks.innerHTML = cutCards.length ? cutCards.join("") : `<div class="empty-state">暂无剔除项。</div>`;
  syncPremarketLegacyExecutionControls(lastPremarketFlowModel);
}































function handleSpecAction(event) {















  const editBtn = event.target.closest("[data-spec-edit]");















  if (editBtn) {















    editingSpecCode = editBtn.dataset.specEdit;















    if (lastHotPayload) renderSelectionPools(lastHotPayload);















    return;















  }















  const cancelBtn = event.target.closest("[data-spec-cancel]");















  if (cancelBtn) {















    editingSpecCode = null;















    if (lastHotPayload) renderSelectionPools(lastHotPayload);















    return;















  }















  const saveBtn = event.target.closest("[data-spec-save]");















  if (saveBtn) {















    const code = saveBtn.dataset.specSave;















    const card = saveBtn.closest("[data-spec-card]");















    if (card) {















      saveSpecOverride(code, {















        expectation: card.querySelector('[data-spec-field="expectation"]').value,















        logic: card.querySelector('[data-spec-field="logic"]').value.trim(),















      });















    }















    editingSpecCode = null;















    if (lastHotPayload) renderSelectionPools(lastHotPayload);















  }















}































function safeParseJSON(raw, fallback) {















  try {















    return JSON.parse(raw);















  } catch {















    return fallback;















  }















}































function escapeHtml(value) {















  return String(value ?? "").replace(/[&<>"']/g, (char) => ({















    "&": "&amp;",















    "<": "&lt;",















    ">": "&gt;",















    '"': "&quot;",















    "'": "&#39;",















  })[char]);















}































function formatScore(value) {















  const num = Number(value);















  return Number.isFinite(num) ? num.toFixed(1) : "--";















}































const state = {















  watchlist: safeParseJSON(localStorage.getItem("shortModelWatchlist") || "[]", []),















  history: safeParseJSON(localStorage.getItem("shortModelHistory") || "[]", []),















  entryHistory: safeParseJSON(localStorage.getItem("shortModelEntryHistory") || "[]", []),









  sellAdvisorHoldings: safeParseJSON(localStorage.getItem("shortModelSellAdvisorHoldings") || "[]", []),














};































function value(name) {















  return Number(new FormData(form).get(name));















}































function weighted(parts) {















  return Math.round(parts.reduce((sum, [score, weight]) => sum + score * weight, 0));















}































function getScores() {















  const regime = weighted([















    [value("indexTrend"), 0.3],















    [value("marketBreadth"), 0.25],















    [value("emotion"), 0.25],















    [value("volume"), 0.2],















  ]);































  const sector = weighted([















    [value("relativeStrength"), 0.35],















    [value("leaderDepth"), 0.2],















    [value("continuity"), 0.15],















    [value("sectorVolume"), 0.15],















    [value("catalyst"), 0.15],















  ]);































  const stock = weighted([















    [value("position"), 0.25],















    [value("pattern"), 0.2],















    [value("stockStrength"), 0.2],















    [value("liquidity"), 0.15],















    [100 - value("crowding"), 0.1],















    [value("catalyst"), 0.1],















  ]);































  const total = Math.round(regime * 0.4 + sector * 0.32 + stock * 0.28);















  return { regime, sector, stock, total };















}































function cycleName(score) {















  if (score >= 75) return "强势环境";















  if (score >= 60) return "中性偏强";















  if (score >= 45) return "弱势改善";















  return "防守环境";















}































function positionByCycle(cycle) {















  const map = {















    强势环境: "80%-100%",















    中性偏强: "40%-60%",















    弱势改善: "20%-40%",















    防守环境: "0%",















  };















  return map[cycle];















}































function styleByScores({ regime, sector, stock }) {















  if (regime < 45) return "空仓防守";















  if (regime >= 75 && sector >= 70) return "主线龙头首次分歧";















  if (sector >= 65 && stock >= 70) return "回流第一强";















  if (regime < 60 && stock >= 78) return "抱团核心试错";















  return "等待确认";















}































function actionByScores(scores) {















  const cycle = cycleName(scores.regime);















  if (cycle === "防守环境") return "不开新仓";















  if (scores.sector < 55) return "方向不够强";















  if (scores.stock < 65) return "只观察核心";















  if (cycle === "弱势改善") return "小仓试错";















  if (cycle === "中性偏强") return "半仓做回流";















  return "核心仓位进攻";















}































function strategyByScores(scores) {















  const cycle = cycleName(scores.regime);















  const style = styleByScores(scores);















  const action = actionByScores(scores);































  if (cycle === "防守环境") {















    return "当前按退潮处理，优先观察亏钱效应是否收敛。不开新仓，只记录高标反馈、跌停扩散和次日修复强度。";















  }































  if (action === "方向不够强") {















    return "市场有一定修复，但板块承接不足。明日不追后排，只等最强方向出现回流确认。";















  }































  if (style === "主线龙头首次分歧") {















    return "明日只盯主线核心，买点限制在首次分歧转强或回踩关键位不破；不及预期、板块回流失败、龙头转弱即退出。";















  }































  if (style === "回流第一强") {















    return "明日按轮动回流处理，只做资金认可方向里的第一强。高开过多不追，回流失败或后排先掉队则降低仓位。";















  }































  if (style === "抱团核心试错") {















    return "明日只允许小仓试错抱团核心，不能扩散到后排。若情绪无法继续抱团，次日直接撤退。";















  }































  return "明日等待确认信号，重点观察指数修复、活跃板块承接和核心票是否给出弱转强。";















}































function updateView() {















  const scores = getScores();















  const cycle = cycleName(scores.regime);















  const action = actionByScores(scores);































  document.querySelector("#totalScore").textContent = scores.total;















  // 顶部状态板由实时抓取驱动（见 renderHotStocks），手动打分只更新本页结果，避免两处“周期”打架















  document.querySelector("#cycleResult").textContent = `${cycle} ${scores.regime}`;















  document.querySelector("#sectorResult").textContent = scores.sector;















  document.querySelector("#stockResult").textContent = scores.stock;















  document.querySelector("#actionResult").textContent = action;















  document.querySelector("#strategyText").textContent = strategyByScores(scores);















}































function persist() {















  localStorage.setItem("shortModelWatchlist", JSON.stringify(state.watchlist));















  localStorage.setItem("shortModelHistory", JSON.stringify(state.history));
  localStorage.setItem("shortModelSellAdvisorHoldings", JSON.stringify(state.sellAdvisorHoldings));














  localStorage.setItem("shortModelEntryHistory", JSON.stringify(state.entryHistory));















}































function localSellAdvisorHoldings() {
  return Array.isArray(state.sellAdvisorHoldings)
    ? state.sellAdvisorHoldings.filter((item) => item && String(item.code || "").trim())
    : [];
}

function saveSellAdvisorHoldingsToDisk() {
  const snapshot = localSellAdvisorHoldings().map((item) => ({ ...item }));
  sellAdvisorSaveChain = sellAdvisorSaveChain.catch(() => null).then(async () => {
    const response = await fetch("/api/sell-advisor/holdings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holdings: snapshot }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || `持仓保存失败（${response.status}）`);
    sellAdvisorStorageStatus = snapshot.length ? "持仓已永久保存" : "本地持仓文件已同步";
    return result;
  });
  return sellAdvisorSaveChain;
}

async function initializeSellAdvisorHoldings() {
  const browserHoldings = localSellAdvisorHoldings();
  try {
    const response = await fetch("/api/sell-advisor/holdings", { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `持仓读取失败（${response.status}）`);

    const diskHoldings = Array.isArray(result.holdings) ? result.holdings : [];
    const diskCodes = new Set(diskHoldings.map((item) => String(item.code || "").trim()).filter(Boolean));
    const browserOnly = browserHoldings.filter((item) => !diskCodes.has(String(item.code || "").trim()));
    state.sellAdvisorHoldings = [...diskHoldings, ...browserOnly];
    persist();

    if (browserOnly.length) {
      await saveSellAdvisorHoldingsToDisk();
      sellAdvisorStorageStatus = "原有持仓已迁移并永久保存";
    } else {
      sellAdvisorStorageStatus = state.sellAdvisorHoldings.length ? "持仓已从本地文件恢复" : "本地持仓文件已连接";
    }
  } catch (error) {
    state.sellAdvisorHoldings = browserHoldings;
    sellAdvisorStorageStatus = "本地文件暂不可用，已保留浏览器备份";
    console.error("Sell advisor holdings restore failed:", error);
  }
  renderSellAdvisor(lastHotPayload || null);
}

function renderWatchlist() {















  if (!state.watchlist.length) {















    watchlistBody.innerHTML = `<tr><td colspan="5">还没有标的，先把核心票加入池子。</td></tr>`;















    return;















  }































  watchlistBody.innerHTML = state.watchlist















    .map(















      (item, index) => `















        <tr>















          <td><strong>${escapeHtml(item.stockName)}</strong></td>















          <td>${escapeHtml(item.sectorName)}</td>















          <td>${escapeHtml(item.role)}</td>















          <td>${escapeHtml(item.plan || "待补充")}</td>















          <td><button class="delete-btn" data-delete="${index}" type="button">删除</button></td>















        </tr>















      `,















    )















    .join("");















}































function renderHistory() {















  if (!state.history.length) {















    historyList.innerHTML = `<div class="history-card"><div><span>暂无记录</span><strong>保存今日复盘后会显示在这里。</strong></div></div>`;















    return;















  }































  historyList.innerHTML = state.history















    .slice()















    .reverse()















    .map(















      (item) => `















        <article class="history-card">















          <div><span>日期</span><strong>${escapeHtml(item.date)}</strong></div>















          <div><span>手工环境分层</span><strong>${escapeHtml(item.cycle)}</strong></div>















          <div><span>综合分</span><strong>${escapeHtml(item.total)}</strong></div>















          <div><span>打法</span><strong>${escapeHtml(item.style)}</strong></div>















          <div><span>动作</span><strong>${escapeHtml(item.action)}</strong></div>















        </article>















      `,















    )















    .join("");















}































function renderEntryHistory() {















  const entryHistoryList = document.querySelector("#entryHistoryList");















  if (!entryHistoryList) return;































  if (!state.entryHistory.length) {















    entryHistoryList.innerHTML = `<div class="history-card archive-card"><div><span>暂无入选记录</span><strong>抓取到的核心标的会按日期沉淀到这里，展示次日回测与复盘结果。</strong></div></div>`;















    return;















  }































  entryHistoryList.innerHTML = state.entryHistory















    .map(















      (item) => `















        <article class="history-card archive-card">















          <div><span>日期</span><strong>${item.date}</strong></div>















          <div><span>周期 / 动作</span><strong>${item.cycle} · ${item.operation}</strong></div>















          <div><span>主线题材</span><strong>${item.mainLine}</strong></div>















          <div><span>持续性</span><strong>${item.continuity}</strong></div>















          <div class="archive-picks">















            ${















              (item.picks || []).length















                ? item.picks















                    .map(















                      (pick) => `















                        <span>${pick.name} · ${pick.role} · ${pick.nextDay}</span>















                      `,















                    )















                    .join("")















                : "<span>暂无核心入选</span>"















            }















          </div>















        </article>















      `,















    )















    .join("");















}































function formatNumber(value) {















  if (!Number.isFinite(Number(value))) return "--";















  return Number(value).toFixed(2);















}































function formatTime(iso) {















  if (!iso) return "--";















  return new Date(iso).toLocaleString("zh-CN", { hour12: false });















}































function formatMaybeNumber(value, digits = 2) {















  const num = Number(value);















  if (!Number.isFinite(num) || num === 0) return "--";















  return num.toFixed(digits);















}































// 成交额（元）→ A股习惯口径：万亿 / 亿 / 万















function formatAmount(value) {















  const num = Number(value);















  if (!Number.isFinite(num) || num === 0) return "--";















  if (num >= 1e12) return `${(num / 1e12).toFixed(2)}万亿`;















  if (num >= 1e8) return `${(num / 1e8).toFixed(2)}亿`;















  if (num >= 1e4) return `${(num / 1e4).toFixed(2)}万`;















  return num.toFixed(0);















}































function renderRealtime(payload) {















  const updatedAt = payload.updatedAt || payload.fetchedAt;















  const sourceLabel = payload.source || "--";















  const quotes = payload.data || [];















  const health = payload.health || [];















  const healthMap = new Map(health.map((item) => [item.source, item]));































  const updatedNode = document.querySelector("#realtimeUpdatedAt");















  const sourceNode = document.querySelector("#realtimeSourceLabel");















  if (updatedNode) updatedNode.textContent = formatTime(updatedAt);















  if (sourceNode) sourceNode.textContent = sourceLabel;































  if (realtimeQuotes) {















    realtimeQuotes.innerHTML = quotes.length















      ? quotes















          .map(















            (item) => `















              <div class="realtime-row">















                <div>















                  <span>${escapeHtml(item.symbol)} · ${escapeHtml(item.name)}</span>















                  <strong>${formatNumber(item.last_price)}</strong>















                </div>















                <div>















                  <span>${formatNumber(item.pct_change)}%</span>















                  <strong>成交 ${formatAmount(item.turnover)}</strong>















                </div>















              </div>















            `,















          )















          .join("")















      : `<div class="empty-state">暂无实时行情。</div>`;















  }































  if (realtimeHealth) {















    realtimeHealth.innerHTML = health.length















      ? health















          .map((item) => {















            const attempted = Boolean(item.last_attempt_at);















            const status = item.success ? "正常" : attempted ? "异常" : "待命";















            const detail = item.last_error || item.last_success_at || (attempted ? "无错误" : "兜底待命，未启用");















            return `















              <div class="realtime-health-row">















                <div>















                  <span>${escapeHtml(item.source)} · ${status}</span>















                  <strong>${item.latency_ms == null ? "--" : `${item.latency_ms} ms`}</strong>















                </div>















                <em>${escapeHtml(detail)}</em>















              </div>















            `;















          })















          .join("")















      : `<div class="empty-state">暂无数据源状态。</div>`;















  }















}































// 硬筛选标签：区分「数据缺失没法验证」和「验证了真不合格」——前者⚠️黄标待补，后者✗红标















function hardGateTag(gate) {















  if (!gate) return "";















  const MISSING_KLINE = "缺K线无法验证趋势结构";















  const softHtml = (gate.softFlags || []).length















    ? `<span class="gate-tag gate-soft">⚠️${gate.softFlags[0]}</span>`















    : "";















  if (gate.pass) return `<span class="gate-tag gate-pass">硬筛选✓</span>${softHtml}`;















  if ((gate.hardFails || [])[0] === MISSING_KLINE) {















    return `<span class="gate-tag gate-missing">⚠️数据缺失待补（缺K线，非不合格）</span>`;















  }















  return `<span class="gate-tag gate-fail">✗未通过 ${gate.hardFails[0] || ""}</span>${softHtml}`;















}































function stockCard(stock, rejected = false) {















  const reasons = rejected && stock.rejects?.length ? stock.rejects : (stock.reasons || []);















  const reasonHtml = reasons.length















    ? reasons.map((reason) => `<li>${reason}</li>`).join("")















    : "<li>热度不足或缺少明确板块共振，暂不进入核心池。</li>";















  const spec = getEffectiveSpec(stock);
  const chainAllocation = stock && stock.positionAllocation && typeof stock.positionAllocation === "object"
    ? stock.positionAllocation
    : null;
  const chainAllocationText = canonicalPositionAllocationText(chainAllocation);
  const chainAllocationTag = chainAllocationText
    ? `<span class="type-tag">统一链仓位 ${escapeHtml(chainAllocationText)}</span>`
    : "";















  const expClass = { 在途: "spec-active", 透支: "spec-overdrawn", 兑现: "spec-realized" }[spec.expectation] || "spec-active";















  const specBlock =















    editingSpecCode === stock.code















      ? specEditorHtml(stock.code, spec)















      : `<div class="spec-box ${expClass}">















          <div class="spec-head">















            <span class="spec-tag">炒作预期 · ${spec.expectation}${spec.source === "manual" ? "（手动）" : ""}</span>















            <button class="spec-edit-btn" data-spec-edit="${stock.code}" type="button">编辑 / 补事件</button>















          </div>















          <p class="spec-logic">${escapeHtml(spec.logic || "—")}</p>















          ${spec.risk ? `<p class="spec-risk">${escapeHtml(spec.risk)}</p>` : ""}















        </div>`;































  const kp = stock.klineProfile;















  const chipTag = kp















    ? `<span class="chip-tag chip-${{ 舒服: "good", 一般: "mid", 套牢压力: "bad" }[kp.chipComfort] || "mid"}">${kp.isNewListing ? escapeHtml(kp.newStockChipState || "次新筹码待验证") + (Number.isFinite(Number(kp.effectiveTurnover5)) ? `·5日有效换手${escapeHtml(String(kp.effectiveTurnover5))}%` : "") + (kp.turnoverDataQuality ? `·${escapeHtml(kp.turnoverDataQuality)}` : "") : `筹码${kp.chipComfort || "未知"}${kp.chipComfort && kp.chipComfort !== "一般" ? `·距高${kp.pctFromHigh}%` : ""}`}</span>`















    : "";































  const backtest = stock.backtest;















  const backtestHtml = backtest















    ? `<div class="stock-backtest">















        <div class="stock-backtest-head">















          <strong>倒退回测：${backtest.summary.verdict}</strong>















          <span>${backtest.mode} · 样本 ${backtest.summary.sampleCount}</span>















        </div>















        <div class="stock-backtest-metrics">















          <span>次日胜率 ${backtest.summary.winRate1d}%</span>















          <span>次日均收 ${formatNumber(backtest.summary.avgNextClose)}%</span>















          <span>三日最高 ${formatNumber(backtest.summary.avgMax3d)}%</span>















          <span>最深回撤 ${formatNumber(backtest.summary.worstDrawdown)}%</span>















        </div>















        <p>${backtest.summary.note}</p>















        ${















          backtest.cases.length















            ? `<div class="backtest-cases">















                ${backtest.cases















                  .slice(0, 3)















                  .map(















                    (item) => `















                      <span>${item.date} · ${item.type} · 次日${formatNumber(item.nextClosePct)}% · 三日${formatNumber(item.max3dPct)}%</span>















                    `,















                  )















                  .join("")}















              </div>`















            : ""















        }















      </div>`















    : "";































  const ev = stock.evidence || {};















  const evidenceItems = [















    ...(ev.announcements || []).slice(0, 2).map((n) => ({ kind: "ann", label: "公告", time: n.date, title: n.title, url: n.url, source: n.type })),















    ...(ev.reports || []).slice(0, 2).map((n) => ({ kind: "rpt", label: "研报", time: n.date, title: n.title, url: "", source: `${n.org || ""}${n.rating ? "·" + n.rating : ""}` })),















    ...(stock.newsFeed || []).slice(0, 3).map((n) => ({ kind: "news", label: "新闻", time: String(n.time || "").slice(5, 16), title: n.title, url: n.url, source: n.source })),















  ];















  const newsHtml = evidenceItems.length















    ? `<div class="news-box">















        <div class="news-head">消息面 · 公告 / 研报 / 新闻</div>















        ${evidenceItems















          .map(















            (n) =>















              `<p class="news-item"><span class="news-kind news-kind-${n.kind}">${n.label}</span><span class="news-time">${escapeHtml(n.time || "")}</span>${















                n.url















                  ? `<a href="${escapeHtml(n.url)}" target="_blank" rel="noopener">${escapeHtml(n.title)}</a>`















                  : escapeHtml(n.title)















              }${n.source ? `<span class="news-source">${escapeHtml(n.source)}</span>` : ""}</p>`,















          )















          .join("")}















      </div>`















    : "";































  return `















    <article class="stock-pick-card ${rejected ? "rejected" : ""}">















      <div class="stock-pick-head">















        <div>















          <h4>${stock.name || "--"} <small>${stock.code} · ${stock.board}</small></h4>















        </div>















        <div class="score-badge">${formatScore(stock.score)}</div>















      </div>















      <div class="stock-tags">















        <span class="role-tag">${stock.role || "角色待定"}</span>















        <span class="type-tag">${stock.ticketType || "票型待定"}</span>















        <span>${stock.setup}</span>















        <span>${stock.mainConcept || "未归类"}</span>















        <span>${stock.klineProfile ? stock.klineProfile.wave : "形态未知"}</span>















        ${chipTag}















        <span>涨跌 ${formatNumber(stock.changePct)}%</span>















        <span>换手 ${formatNumber(stock.turnoverRate)}%</span>















        <span>多单 ${stock.gamePlan ? stock.gamePlan.longStrength : "--"}</span>















        <span>热榜 ${stock.combinedRank}</span>















        ${hardGateTag(stock.hardGate)}

        ${chainAllocationTag}















      </div>















      ${specBlock}















      ${newsHtml}















      <ul class="reason-list">${reasonHtml}</ul>















      ${backtestHtml}















      ${















        stock.gamePlan















          ? `<div class="game-plan ${stock.gamePlan.canGame ? "can-game" : ""}">















              <div class="game-plan-head">















                <strong>${stock.gamePlan.decision}</strong>















                <span>多单强度 ${stock.gamePlan.longStrength}/100</span>















              </div>















              <p>${stock.gamePlan.gameReason}</p>















              <p>${stock.gamePlan.gameTarget}</p>















              <p>${stock.gamePlan.sectorLine}</p>















              <p>${stock.gamePlan.preferenceLine}</p>















              <p>${stock.gamePlan.priceLine}</p>















              <p>${stock.gamePlan.longLine}</p>















              <p>${stock.gamePlan.holderLine}</p>















            </div>`















          : ""















      }















      ${















        stock.tradePlan















          ? `<div class="trade-plan">















              <div><span>买点</span><p>${stock.tradePlan.buy}</p></div>















              <div><span>次日</span><p>${stock.tradePlan.nextDay}</p></div>















              <div><span>卖点</span><p>${stock.tradePlan.sell}</p></div>















              <div><span>风险</span><p>${stock.tradePlan.risk}</p></div>















              ${















                stock.stopLossPlan















                  ? `<div class="spl-row">















                      <span class="spl-mode">${stock.stopLossPlan.mode}</span>















                      <span class="spl-loss">止损 ${stock.stopLossPlan.stopLoss.range[0]}%~${stock.stopLossPlan.stopLoss.range[1]}%</span>















                      <span class="spl-profit">止盈 +${stock.stopLossPlan.takeProfit.range[0]}%~+${stock.stopLossPlan.takeProfit.range[1]}%</span>















                      <span class="spl-rr">盈亏比 ${stock.stopLossPlan.riskReward}</span>















                    </div>















                    <p class="spl-basis">止损依据：${stock.stopLossPlan.stopLoss.basis}；止盈依据：${stock.stopLossPlan.takeProfit.basis}</p>`















                  : ""















              }















            </div>`















          : ""















      }















      ${















        rejected















          ? `<button class="preplan-entry-btn" data-preplan="${stock.code}" type="button">录预案</button>`















          : `<div class="stock-card-actions">















              <button class="primary-btn add-pick-btn" data-code="${stock.code}" type="button">加入核心标的池</button>















              <button class="preplan-entry-btn" data-preplan="${stock.code}" type="button">录预案</button>















            </div>`















      }















    </article>















  `;















}































function renderMarketState(market, payload = null) {















  const snapshot = market.snapshot;















  const state = market.state;















  const external = market.externalRisk;
  const unifiedProjection = resolveUnifiedDecisionChainProjection(payload);
  const unifiedStage = unifiedProjection.marketStage || {};
  const unifiedBigCycle = unifiedStage.bigCycle && typeof unifiedStage.bigCycle === "object" ? unifiedStage.bigCycle : {};
  const unifiedTradeValue = unifiedProjection.authorization && unifiedProjection.authorization.tradeValue
    && typeof unifiedProjection.authorization.tradeValue === "object" ? unifiedProjection.authorization.tradeValue : {};















  const breadthBreakdown = snapshot.marketBreadth || null;















  document.querySelector("#marketCycle").textContent = unifiedProjection.contractReady
    ? String(unifiedBigCycle.label || "大周期待确认")
    : "统一决策链待确认";















  document.querySelector("#marketOperation").textContent = unifiedProjection.executionOpen
    ? `交易授权开启 · ${unifiedTradeValue.label || "条件执行"}`
    : "交易授权关闭";















  const marketAmountText =















    Number.isFinite(Number(snapshot.shszAmountYi)) && Number(snapshot.shszAmountYi) > 0















      ? `${formatMaybeNumber(snapshot.shszAmountYi, 2)} 亿`















      : Number.isFinite(Number(snapshot.totalAmountYi)) && Number(snapshot.totalAmountYi) > 0















        ? `${formatMaybeNumber(snapshot.totalAmountYi, 2)} 亿`















        : "--";















  document.querySelector("#marketAmount").textContent = marketAmountText;















  document.querySelector("#marketBreadth").textContent =















    Number.isFinite(Number(snapshot.upCount)) && Number.isFinite(Number(snapshot.downCount))















      ? `${snapshot.upCount}/${snapshot.downCount}`















      : "--";















  document.querySelector("#marketScore").textContent = unifiedTradeValue.numericScore == null ? "未校准" : unifiedTradeValue.numericScore;















  document.querySelector("#marketPosition").textContent = unifiedProjection.executionOpen ? `${unifiedProjection.maximumPortfolioPct}%` : "0%";















  document.querySelector("#tradingStyle").textContent = market.tradingStyle.style;















  document.querySelector("#tradingPreference").textContent = market.tradingStyle.preference;















  document.querySelector("#tradingBias").textContent = market.tradingStyle.bias;















  document.querySelector("#marketSummary").textContent = unifiedProjection.executionOpen
    ? `统一决策链v3已授权${unifiedProjection.stocks.length}只结果股，初始${unifiedProjection.initialPortfolioPct}%，仓位上限${unifiedProjection.maximumPortfolioPct}%。`
    : `${unifiedProjection.blockers[0] || "统一决策链未产生可执行结果"}。当前新仓仓位为0%。`;































  document.querySelector("#externalLevel").textContent = `${external.level} · 风险${external.risk} · 扣${external.penalty}`;















  document.querySelector("#externalIndexes").innerHTML = external.indexes.length















    ? external.indexes















        .map(















          (item) => `















            <div>















              <span>${item.name}</span>















              <strong>${formatMaybeNumber(item.changePct)}%</strong>















            </div>















          `,















        )















        .join("")















    : `<div><span>外部指数</span><strong>暂无数据</strong></div>`;















  document.querySelector("#externalReasons").innerHTML = external.reasons















    .map((reason) => `<span>${reason}</span>`)















    .join("");































  const breadthNode = document.querySelector("#marketBreadthBreakdown");















  if (breadthNode) {















    breadthNode.innerHTML = breadthBreakdown















      ? [















          ["上证", breadthBreakdown.sh],















          ["深证", breadthBreakdown.sz],















          ["创业板", breadthBreakdown.cyb],















        ]















          .map(([label, item]) => {















            if (!item) return "";















            return `















              <div class="breadth-item">















                <span>${label}</span>















                <strong>${item.up}/${item.down}</strong>















                <em>平 ${item.flat || 0} | 涨占比 ${formatMaybeNumber(item.ratio, 2)}%</em>















              </div>















            `;















          })















          .join("")















      : `<div class="empty-state">暂无分市场涨跌家数，先看总口径。</div>`;















  }















}































function renderUsFramework(payload) {















  const framework = payload && payload.usFramework && typeof payload.usFramework === "object" ? payload.usFramework : {};
  const frameworkSignals = Array.isArray(framework.signals) ? framework.signals : [];
  const frameworkIndexes = Array.isArray(framework.indexes) ? framework.indexes : [];
  const frameworkReasons = Array.isArray(framework.reasons) ? framework.reasons : [];
  const frameworkStats = framework.stats && typeof framework.stats === "object" ? framework.stats : {};















  const level = document.querySelector("#usFrameworkLevel");















  const headline = document.querySelector("#usFrameworkHeadline");















  const subline = document.querySelector("#usFrameworkSubline");















  const signals = document.querySelector("#usFrameworkSignals");















  const indexes = document.querySelector("#usFrameworkIndexes");















  const reasons = document.querySelector("#usFrameworkReasons");















  const weighted = document.querySelector("#usFrameworkWeighted");















  const tech = document.querySelector("#usFrameworkTech");















  const broad = document.querySelector("#usFrameworkBroad");































  if (!framework) {















    if (level) level.textContent = "等待抓取";















    if (headline) headline.textContent = "这里单独看美股涨跌，判断它对 A 股次日开盘和风格的预期。";















    if (subline) subline.textContent = "先看纳指和费半，再看标普和道指，最后落到 A 股是偏进攻、偏防守，还是偏分化。";















    if (signals) signals.innerHTML = "";















    if (indexes) indexes.innerHTML = "";















    if (reasons) reasons.innerHTML = "";















    if (weighted) weighted.textContent = "--";















    if (tech) tech.textContent = "--";















    if (broad) broad.textContent = "--";















    return;















  }































  if (level) level.textContent = framework.level;















  if (headline) headline.textContent = framework.headline;















  if (subline) subline.textContent = framework.subline;















  if (signals) {















    signals.innerHTML = frameworkSignals.map((item) => `<span>${item}</span>`).join("");















  }















  if (indexes) {















    indexes.innerHTML = frameworkIndexes.length















      ? frameworkIndexes















          .map(















            (item) => `















              <div>















                <span>${item.name}${item.role ? ` · ${item.role}` : ""}</span>















                <strong>${formatMaybeNumber(item.changePct)}%</strong>















              </div>















            `,















          )















          .join("")















      : `<div><span>美股指数</span><strong>暂无数据</strong></div>`;















  }















  if (reasons) {















    reasons.innerHTML = frameworkReasons.length















      ? frameworkReasons.map((reason) => `<span>${reason}</span>`).join("")















      : `<span>暂无明确偏向</span>`;















  }















  if (weighted) weighted.textContent = `${formatMaybeNumber(frameworkStats.weightedChange)}%`;















  if (tech) tech.textContent = `${formatMaybeNumber(frameworkStats.techChange)}%`;















  if (broad) broad.textContent = `${formatMaybeNumber(frameworkStats.broadChange)}%`;































  const topHeadline = document.querySelector("#usFrameworkHeadlineTop");















  const topSubline = document.querySelector("#usFrameworkSublineTop");















  const topLevel = document.querySelector("#usFrameworkLevelTop");















  const topExpectation = document.querySelector("#usFrameworkExpectationTop");















  const topStyle = document.querySelector("#usFrameworkStyleTop");















  const topOpen = document.querySelector("#usFrameworkOpenBias");















  const topOpenText = document.querySelector("#usFrameworkOpenText");















  const topStyleText = document.querySelector("#usFrameworkStyleText");















  const techMeta = document.querySelector("#usTechMeta");















  const techList = document.querySelector("#usTechList");































  if (topHeadline) topHeadline.textContent = framework.headline;















  if (topSubline) topSubline.textContent = framework.subline;















  if (topLevel) topLevel.textContent = framework.level;















  if (topExpectation) topExpectation.textContent = framework.expectation;















  if (topStyle) topStyle.textContent = framework.styleBias;















  if (topOpen) topOpen.textContent = framework.openBias;















  if (topOpenText) topOpenText.textContent = framework.openBias;















  if (topStyleText) topStyleText.textContent = framework.styleBias;































  if (techMeta) {















    techMeta.textContent = framework.techQuotes && framework.techQuotes.length ? `${framework.techQuotes.length} 只` : "暂无数据";















  }















  if (techList) {















    const techQuotes = (framework.techQuotes || []).slice(0, 12);















    techList.innerHTML = techQuotes.length















      ? techQuotes















          .map(















            (item) => `















              <article class="us-tech-card">















                <div class="us-tech-head">















                  <div>















                    <strong>${escapeHtml(item.name)}</strong>















                    <small>${escapeHtml(item.symbol)} · ${escapeHtml(item.theme || "")}</small>















                  </div>















                  <span class="us-tech-badge">${formatMaybeNumber(item.changePct)}%</span>















                </div>















                <div class="us-tech-price">只看涨跌，不把价格当核心判断</div>















              </article>















            `,















          )















          .join("")















      : `<div class="empty-state">暂无美股科技股数据。</div>`;















  }















}































const WORKFLOW_STAGE_DEFINITIONS = Object.freeze([
  { key: "command", label: "明日决策", entryView: "decision" },
  { key: "selection", label: "盘后复盘", entryView: "index-opportunity" },
  { key: "execution", label: "盘中执行", entryView: "dashboard" },
  { key: "position", label: "持仓卖出", entryView: "sell-advisor" },
  { key: "review", label: "复盘总结", entryView: "review-conclusion" },
]);

const WORKFLOW_VIEW_STAGE = Object.freeze({
  decision: "command",
  "index-opportunity": "selection",
  "trading-preference": "selection",
  "emotion-stage": "selection",
  "theme-library": "selection",
  "auto-picker": "selection",
  preplan: "selection",
  dashboard: "execution",
  us: "execution",
  survivors: "execution",
  "sell-advisor": "position",
  "review-conclusion": "review",
  journal: "review",
});

const WORKFLOW_LAYER_DEFINITIONS = Object.freeze([
  { key: "observation", label: "观察层", entryView: "dashboard" },
  { key: "decision", label: "决策层", entryView: "decision" },
]);

const WORKFLOW_VIEW_LAYER = Object.freeze({
  decision: "decision",
  "index-opportunity": "observation",
  "trading-preference": "observation",
  "emotion-stage": "observation",
  "theme-library": "observation",
  "auto-picker": "observation",
  preplan: "decision",
  dashboard: "observation",
  us: "observation",
  survivors: "observation",
  "sell-advisor": "decision",
  "review-conclusion": "observation",
  journal: "observation",
});

const WORKFLOW_VIEW_ALIASES = Object.freeze({
  "market-emotion": "emotion-stage",
  "us-dashboard": "us",
  "event-inference": "theme-library",
  watchlist: "auto-picker",
  "super-expectation": "preplan",
});

const WORKFLOW_DEFAULT_VIEW = "decision";
let lastHandledWorkflowHash = "";
let workflowScrollResetTimer = null;

function resetWorkflowScrollPosition() {
  const scrollTop = () => window.scrollTo({ top: 0, left: 0 });
  const nextFrame = typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : (callback) => setTimeout(callback, 0);
  scrollTop();
  nextFrame(() => nextFrame(scrollTop));
  if (workflowScrollResetTimer) clearTimeout(workflowScrollResetTimer);
  workflowScrollResetTimer = setTimeout(scrollTop, 180);
}

function normalizeWorkflowView(view) {
  const normalized = String(view || "").trim().replace(/^#/, "");
  const canonical = WORKFLOW_VIEW_ALIASES[normalized] || normalized;
  return Object.prototype.hasOwnProperty.call(WORKFLOW_VIEW_STAGE, canonical)
    ? canonical
    : WORKFLOW_DEFAULT_VIEW;
}

function workflowViewFromHash() {
  const rawHash = String(window.location.hash || "").replace(/^#/, "");
  try {
    return normalizeWorkflowView(decodeURIComponent(rawHash));
  } catch {
    return WORKFLOW_DEFAULT_VIEW;
  }
}

function syncWorkflowStageAria(stage) {
  if (!stage) return;
  const stageKey = String(stage.dataset.workflowLayer || stage.dataset.workflowStage || "").trim();
  const summary = stage.querySelector(":scope > .workflow-stage-toggle");
  const items = stage.querySelector(":scope > .workflow-stage-items");
  if (!summary || !items || !stageKey) return;
  if (!items.id) items.id = `workflow-layer-${stageKey}-items`;
  summary.setAttribute("aria-controls", items.id);
  summary.setAttribute("aria-expanded", stage.open ? "true" : "false");
}

function syncWorkflowNavigation(view, activeNav = null) {
  const normalizedView = normalizeWorkflowView(view);
  const mappedStageKey = WORKFLOW_VIEW_STAGE[normalizedView] || "command";
  const stageDefinition = WORKFLOW_STAGE_DEFINITIONS.find((stage) => stage.key === mappedStageKey)
    || WORKFLOW_STAGE_DEFINITIONS[0];
  const stageKey = stageDefinition.key;
  const mappedLayerKey = WORKFLOW_VIEW_LAYER[normalizedView] || "decision";
  const layerDefinition = WORKFLOW_LAYER_DEFINITIONS.find((layer) => layer.key === mappedLayerKey);
  const layerKey = layerDefinition ? layerDefinition.key : mappedLayerKey === "personal" ? "personal" : "decision";
  const activeItem = activeNav || document.querySelector(`.nav-item[data-view="${normalizedView}"]`);
  const ownerStage = activeItem && activeItem.closest(".workflow-layer")
    || layerKey !== "personal" && document.querySelector(`.workflow-layer[data-workflow-layer="${layerKey}"]`)
    || null;

  document.querySelectorAll(".workflow-layer").forEach((stage) => {
    const isOwner = stage === ownerStage;
    stage.classList.toggle("is-active", isOwner);
    stage.open = isOwner;
    const summary = stage.querySelector(":scope > .workflow-stage-toggle");
    if (summary) {
      if (isOwner) summary.setAttribute("aria-current", "step");
      else summary.removeAttribute("aria-current");
    }
    syncWorkflowStageAria(stage);
  });
  document.body.dataset.workflowStage = stageKey;
  document.body.dataset.workflowLayer = layerKey;
}

function navigateToWorkflowView(view, options = {}) {
  const targetView = normalizeWorkflowView(view);
  const historyMode = options.historyMode || "push";
  const canonicalHash = `#${targetView}`;
  const state = { workflowView: targetView };

  try {
    if (historyMode === "replace") {
      window.history.replaceState(state, "", canonicalHash);
    } else if (historyMode === "push" && window.location.hash !== canonicalHash) {
      window.history.pushState(state, "", canonicalHash);
    }
  } catch {
    if (window.location.hash !== canonicalHash) window.location.hash = targetView;
  }

  lastHandledWorkflowHash = canonicalHash;
  switchMode(targetView);
  return targetView;
}

function syncWorkflowLocationFromHash() {
  const targetView = workflowViewFromHash();
  const canonicalHash = `#${targetView}`;
  if (window.location.hash !== canonicalHash) {
    try {
      window.history.replaceState({ workflowView: targetView }, "", canonicalHash);
    } catch {
      window.location.hash = targetView;
    }
  }
  if (lastHandledWorkflowHash === canonicalHash && document.body.dataset.mode === targetView) return;
  lastHandledWorkflowHash = canonicalHash;
  switchMode(targetView);
}

function initializeWorkflowNavigation() {
  if (document.body.dataset.workflowNavigationReady === "true") return;
  document.body.dataset.workflowNavigationReady = "true";

  const stages = Array.from(document.querySelectorAll(".workflow-layer"));
  stages.forEach((stage) => {
    syncWorkflowStageAria(stage);
    stage.addEventListener("toggle", () => {
      if (stage.open) {
        stages.forEach((otherStage) => {
          if (otherStage !== stage && otherStage.open) otherStage.open = false;
        });
      }
      stages.forEach(syncWorkflowStageAria);
    });
  });

  window.addEventListener("popstate", syncWorkflowLocationFromHash);
  window.addEventListener("hashchange", syncWorkflowLocationFromHash);
}

function switchMode(view) {
  view = normalizeWorkflowView(view);















  document.querySelectorAll(".nav-item").forEach((nav) =>















    nav.classList.toggle("active", nav.dataset.view === view),















  );















  document.querySelectorAll(".nav-item").forEach((nav) => {
    if (nav.dataset.view === view) nav.setAttribute("aria-current", "page");
    else nav.removeAttribute("aria-current");
  });

  document.querySelectorAll("main section[data-view]").forEach((section) =>















    section.classList.toggle("view-hidden", section.dataset.view !== view),















  );















  document.body.dataset.mode = view;

  const activeNav = document.querySelector(`.nav-item[data-view="${view}"]`);
  const workspaceViewTitle = document.querySelector("#workspaceViewTitle");
  if (workspaceViewTitle) {
    workspaceViewTitle.textContent = activeNav && activeNav.dataset.label
      ? activeNav.dataset.label
      : "盘后策略工作台";
  }

  const mobileAppTitle = document.querySelector("#mobileAppTitle");
  if (mobileAppTitle) {
    mobileAppTitle.textContent = activeNav && activeNav.dataset.label
      ? activeNav.dataset.label
      : "A股复盘";
  }
  syncWorkflowNavigation(view, activeNav);
  renderActivePremarketFlowView(view);















  resetWorkflowScrollPosition();















  if (view === "preplan") refreshPreplanView();

  if (
    view === "theme-library"
    && (!themeLibraryViewState.response || !Array.isArray(themeLibraryViewState.response.availableDates) || themeLibraryViewState.response.availableDates.length <= 1)
  ) {
    loadThemeLibrary();
  }















  if (view === "journal") {















    loadJournal();















    loadArchiveList();















    try {















      const saved = safeParseJSON(localStorage.getItem("shortModelOutlook") || "null", null);















      if (saved) renderTomorrowOutlook({ tomorrowOutlook: saved });















    } catch {}















  }















}































function renderGlobalNews(payload) {















  const node = document.querySelector("#globalNewsList");















  if (!node) return;















  const rows = (payload.news && payload.news.global) || [];















  node.innerHTML = rows.length















    ? `<div class="news-head">7×24 快讯</div>` +















      rows















        .slice(0, 8)















        .map(















          (n) =>















            `<p class="news-item"><span class="news-time">${escapeHtml(String(n.time || "").slice(5, 16))}</span>${escapeHtml(n.title)}</p>`,















        )















        .join("")















    : "";















}































function renderRiskBoard(payload) {















  const riskBoard = payload.riskBoard;















  const level = document.querySelector("#riskBoardLevel");















  const summary = document.querySelector("#riskBoardSummary");















  const list = document.querySelector("#riskBoardList");































  if (!riskBoard) {















    if (level) level.textContent = "等待抓取";















    if (summary) summary.textContent = "这里会提示近期亏钱效应较大的方向，并直接屏蔽这些方向进入候选池。";















    if (list) list.innerHTML = "";















    return;















  }































  level.textContent = riskBoard.level;















  summary.textContent = riskBoard.summary;















  list.innerHTML = riskBoard.items.length















    ? riskBoard.items















        .map(















          (item) => `















            <article class="risk-card ${item.blocked ? "blocked" : ""}">















              <div class="risk-card-head">















                <div>















                  <strong>${item.name}</strong>















                  <span>${item.blockedType}</span>















                </div>















                <span class="risk-level">${item.severity}</span>















              </div>















              <p>${item.effect}</p>















              <div class="risk-card-reasons">















                <span>${item.reason}</span>















              </div>















            </article>















          `,















        )















        .join("")















    : `<div class="empty-state">暂无明显亏钱效应方向。</div>`;















}































function renderMasterLeader(payload) {















  renderAnchors(payload);















}































function renderAnchors(payload) {















  const board = payload && payload.leadershipBoard || {};
  const leaders = Array.isArray(board.leaders)
    ? board.leaders.filter((row) => row && (
        row.coreIdentityQualified === true || row.tradeQualified === true || row.coreQualified === true
      ))
    : [];
  const anchorText = (row) => String(row && (row.anchorType || row.identity) || "");
  const emotion = leaders.find((row) => /主动|龙头/.test(anchorText(row))) || leaders[0] || null;















  const capacity = leaders.find((row) => /容量|中军/.test(anchorText(row))) || null;































  const emotionTitle = document.querySelector("#emotionAnchorTitle");















  const emotionMeta = document.querySelector("#emotionAnchorMeta");















  const emotionReason = document.querySelector("#emotionAnchorReason");















  const capacityTitle = document.querySelector("#capacityAnchorTitle");















  const capacityMeta = document.querySelector("#capacityAnchorMeta");















  const capacityReason = document.querySelector("#capacityAnchorReason");































  if (emotion && emotionTitle && emotionMeta && emotionReason) {















    emotionTitle.textContent = `${emotion.name} ${emotion.code}`;















    emotionMeta.textContent = `${emotion.concept || board.focusDirection || "当前主线"} · ${emotion.anchorType || emotion.identity || "主动核心"} · 核心身份已验证`;















    emotionReason.textContent = emotion.executionNote || emotion.reason || "主动性与方向影响已经验证，交易资格仍按位置和筹码单独判断。";















  } else {















    if (emotionTitle) emotionTitle.textContent = "暂无明确总龙头";















    if (emotionMeta) emotionMeta.textContent = "市场合力未收敛";















    if (emotionReason) emotionReason.textContent = "当前没有通过主动性、真实带动和持续辨识验证的核心，不用普通候选补位。";















  }































  if (capacity && capacityTitle && capacityMeta && capacityReason) {















    capacityTitle.textContent = `${capacity.name} ${capacity.code}`;















    capacityMeta.textContent = `${capacity.concept || board.focusDirection || "当前主线"} · ${capacity.anchorType || capacity.identity || "容量核心"} · 承接观察`;















    capacityReason.textContent = capacity.executionNote || capacity.reason || "容量承接已验证，是否交易仍看位置、筹码和明日触发。";















  } else {















    if (capacityTitle) capacityTitle.textContent = "暂无明确容量锚定中军";















    if (capacityMeta) capacityMeta.textContent = "承接票未收敛";















    if (capacityReason) capacityReason.textContent = "先看主线里的容量承接是谁，而不是把情绪票当成容量票。";















  }















}































function renderStyleAnalysis(analysis) {















  const conclusion = document.querySelector("#styleAnalysisConclusion");















  const reverseLogic = document.querySelector("#styleReverseLogic");















  const profitLocation = document.querySelector("#profitLocation");















  const profitContinuity = document.querySelector("#profitContinuity");















  const profitCases = document.querySelector("#profitCases");















  const continuityReasons = document.querySelector("#continuityReasons");































  if (!analysis) {















    conclusion.textContent = "等待抓取";















    reverseLogic.innerHTML = `<div>倒推路径：先看赚钱效应在哪里，再看载体，再看能否持续，最后决定选股方案。</div>`;















    profitLocation.textContent = "--";















    profitContinuity.textContent = "--";















    profitCases.innerHTML = "";















    continuityReasons.innerHTML = "";















    return;















  }































  conclusion.textContent = analysis.conclusion;















  profitLocation.textContent = analysis.profitEffect.location;















  profitContinuity.textContent = analysis.profitEffect.continuity;















  reverseLogic.innerHTML = analysis.reverseLogic.map((item, index) => `<div><span>${index + 1}</span><p>${item}</p></div>`).join("");















  profitCases.innerHTML = analysis.examples.length















    ? analysis.examples















        .map(















          (item) => `















            <article class="profit-case">















              <div class="profit-case-head">















                <strong>${item.name}</strong>















                <span>${item.effectType}</span>















              </div>















              <div class="profit-case-tags">















                <span>${item.code}</span>















                <span>${item.role}</span>















                <span>${item.ticketType}</span>















                <span>${item.concept}</span>















              </div>















              <p>${item.reason}</p>















              <div class="profit-case-metrics">















                <span>涨跌 ${formatNumber(item.changePct)}%</span>















                <span>形态 ${item.wave}</span>















                <span>多单 ${item.longStrength}</span>















              </div>















            </article>















          `,















        )















        .join("")















    : `<div class="empty-state">暂无足够清晰的赚钱效应案例。</div>`;















  continuityReasons.innerHTML = analysis.profitEffect.continuityReasons















    .map((reason) => `<span>${reason}</span>`)















    .join("");















}































if (sellAdvisorForm) {
  sellAdvisorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await sellAdvisorHoldingsReady.catch(() => null);
    const data = Object.fromEntries(new FormData(sellAdvisorForm).entries());
    const code = String(data.code || "").trim();
    if (!code) return;
    const payload = lastHotPayload || null;
    const selected = payload && Array.isArray(payload.selected) ? payload.selected.find((item) => String(item.code || "").trim() === code) : null;
    const holding = {
      code,
      name: String(data.name || selected?.name || code).trim(),
      sector: String(data.sector || selected?.mainConcept || selected?.concept || "").trim(),
      role: String(data.role || selected?.role || "核心回撤").trim(),
      buyPrice: Number(data.buyPrice || 0),
      // 留空时保持为0，渲染时始终从 selected/candidates/rejected/coreWatch
      // 的全量最新快照取价，避免把录入当日行情永久保存成“手填现价”。
      currentPrice: data.currentPrice ? Number(data.currentPrice) : 0,
      positionPct: data.positionPct ? Number(data.positionPct) : null,
      buyReason: String(data.buyReason || "").trim(),
      note: String(data.note || "").trim(),
    };
    const index = state.sellAdvisorHoldings.findIndex((item) => String(item.code || "").trim() === code);
    if (index >= 0) state.sellAdvisorHoldings[index] = { ...state.sellAdvisorHoldings[index], ...holding };
    else state.sellAdvisorHoldings.unshift(holding);
    persist();
    sellAdvisorForm.reset();
    renderSellAdvisor(lastHotPayload || payload);
    try {
      await saveSellAdvisorHoldingsToDisk();
    } catch (error) {
      sellAdvisorStorageStatus = "保存失败，浏览器备份仍在";
      console.error("Sell advisor holdings save failed:", error);
      window.alert(`持仓没有写入本地文件：${error.message || "未知错误"}`);
    }
    renderSellAdvisor(lastHotPayload || payload);
  });
}









if (sellAdvisorHoldings) {
  sellAdvisorHoldings.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-sell-delete]");
    if (!button) return;
    await sellAdvisorHoldingsReady.catch(() => null);
    state.sellAdvisorHoldings.splice(Number(button.dataset.sellDelete), 1);
    persist();
    renderSellAdvisor(lastHotPayload || null);
    try {
      await saveSellAdvisorHoldingsToDisk();
    } catch (error) {
      sellAdvisorStorageStatus = "删除未写入本地文件，浏览器备份仍在";
      console.error("Sell advisor holdings delete failed:", error);
      window.alert(`删除结果没有写入本地文件：${error.message || "未知错误"}`);
    }
    renderSellAdvisor(lastHotPayload || null);
  });
}









if (sellAdvisorRefreshBtn) {
  sellAdvisorRefreshBtn.addEventListener("click", () => {
    if (lastHotPayload) renderSellAdvisor(lastHotPayload);
    else loadHotStocks();
  });
}









function renderBacktestSummary(payload) {














  const all = [...payload.selected, ...payload.rejected].filter((stock) => stock.backtest);















  const tested = all.filter((stock) => stock.backtest.summary.sampleCount > 0);















  const label = document.querySelector("#backtestSummaryLabel");















  const samples = document.querySelector("#btSamples");















  const winRate = document.querySelector("#btWinRate");















  const avgClose = document.querySelector("#btAvgClose");















  const avgMax = document.querySelector("#btAvgMax");















  const note = document.querySelector("#backtestNote");































  if (!tested.length) {















    label.textContent = "样本不足";















    samples.textContent = "0";















    winRate.textContent = "--";















    avgClose.textContent = "--";















    avgMax.textContent = "--";















    note.textContent = "近180日没有找到足够多的相似触发点，回测不作为加分项。";















    return;















  }































  const totalSamples = tested.reduce((sum, stock) => sum + stock.backtest.summary.sampleCount, 0);















  const avgWinRate = tested.reduce((sum, stock) => sum + stock.backtest.summary.winRate1d, 0) / tested.length;















  const close = tested.reduce((sum, stock) => sum + stock.backtest.summary.avgNextClose, 0) / tested.length;















  const max = tested.reduce((sum, stock) => sum + stock.backtest.summary.avgMax3d, 0) / tested.length;















  const strongCount = tested.filter((stock) => ["历史有效", "可验证"].includes(stock.backtest.summary.verdict)).length;































  const poolCount = tested.filter((stock) => stock.backtest.mode === "同类模式池").length;















  label.textContent = strongCount ? `${strongCount}/${tested.length} 只通过验证` : "整体偏弱";















  samples.textContent = totalSamples;















  winRate.textContent = `${Math.round(avgWinRate)}%`;















  avgClose.textContent = `${formatNumber(close)}%`;















  avgMax.textContent = `${formatNumber(max)}%`;















  note.textContent = `用当前风格偏好倒推近180日相似触发点；其中${poolCount}只因单股样本不足，采用同类模式池。若回测偏弱，只能降低预期，不能因为热度高就硬做。`;















}































function renderFramework(payload) {















  const framework = payload.framework;















  const headline = document.querySelector("#frameworkHeadline");















  const subline = document.querySelector("#frameworkSubline");















  const continuityLabel = document.querySelector("#frameworkContinuityLabel");















  const signals = document.querySelector("#frameworkSignals");















  const reasons = document.querySelector("#frameworkReasons");































  if (!framework) {















    if (headline) headline.textContent = "等待抓取";















    if (subline) subline.textContent = "框架栏会把本轮周期上涨逻辑、持续性和大资金信号一起写清楚。";















    if (continuityLabel) continuityLabel.textContent = "等待抓取";















    if (signals) signals.innerHTML = "";















    if (reasons) reasons.innerHTML = "";















    return;















  }































  headline.textContent = framework.headline;















  subline.textContent = framework.subline;















  continuityLabel.textContent = framework.continuityLabel;















  signals.innerHTML = framework.signals.map((item) => `<span>${item}</span>`).join("");















  reasons.innerHTML = framework.continuityReasons.map((item) => `<span>${item}</span>`).join("");















}































function renderTopicBoard(payload) {















  const topicBoard = payload.topicBoard;















  const conclusion = document.querySelector("#topicBoardConclusion");















  const list = document.querySelector("#topicBoardList");































  if (!topicBoard) {















    if (conclusion) conclusion.textContent = "等待抓取";















    if (list) list.innerHTML = "";















    return;















  }































  conclusion.textContent = topicBoard.conclusion;















  list.innerHTML = topicBoard.items.length















    ? topicBoard.items















        .slice(0, 6)















        .map(















          (item) => `















            <article class="topic-card ${item.sustained ? "solid" : ""}">















              <div class="topic-card-head">















                <div>















                  <strong>${item.displayName || item.name}</strong>















                  <span>${item.sectorName} · ${formatNumber(item.sectorChangePct)}%</span>















                </div>















                <span class="topic-label">${item.label}</span>















              </div>















              <div class="topic-card-metrics">















                <span>热度 ${formatScore(item.score)}</span>















                <span>上榜 ${item.count}只</span>















                <span>连板高度 ${item.limitCount}只</span>















                <span>${escapeHtml(item.resonanceLabel || (item.resonance === true ? "板块共振" : item.resonance === false ? "共振不足" : "共振未验证"))}</span>
                ${item.directionState ? `<span>${escapeHtml(item.directionState.coreLabel || "方向待确认")}</span><span>${escapeHtml(item.directionState.dailyLabel || "当日效应待确认")}</span><span>${escapeHtml(item.directionState.repairLabel || "修复待确认")}</span>` : ""}















              </div>















              <div class="topic-card-tags">















                <span>${















                  item.leaders && item.leaders.length > 1















                    ? `板块强势梯队 ${item.leaders.map((l) => l.name).join(" / ")}`















                    : item.leader















                      ? `龙头 ${item.leader.name}`















                      : "龙头待确认"















                }</span>















                <span>${item.zhongjun ? `中军 ${item.zhongjun.name}` : "中军待确认"}</span>















                <span>${item.lowLevel ? `低位补涨 ${item.lowLevel.name}` : "低位补涨待确认"}</span>















                <span>${item.limitHeight ? `高度 ${formatNumber(item.limitHeight)}%` : "高度待确认"}</span>















              </div>















              <p>${item.summary}</p>















              <div class="topic-card-reasons">















                ${item.reasons.map((reason) => `<span>${reason}</span>`).join("")}















              </div>















            </article>















          `,















        )















        .join("")















    : `<div class="empty-state">题材栏暂时没有足够清晰的主线，当前更适合继续等待或观察。</div>`;















}































function recordEntryHistory(payload) {















  const projection = resolveUnifiedDecisionChainProjection(payload);
  const date = projection.tradingDate || (payload.updatedAt ? new Date(payload.updatedAt).toLocaleDateString("zh-CN") : "--");















  const cycle = projection.marketStage && projection.marketStage.bigCycle && projection.marketStage.bigCycle.label || "--";















  const operation = projection.executionOpen ? "交易授权开启" : "交易授权关闭";















  const mainLine = projection.chain && projection.chain.theme && Array.isArray(projection.chain.theme.themes)
    ? projection.chain.theme.themes.join(" / ") || "暂无授权主线"
    : "暂无授权主线";















  const continuity = payload.framework?.continuityLabel || payload.market?.tradingStyle?.analysis?.profitEffect?.continuity || "--";















  const picks = projection.stocks.map((item) => ({















    code: item.code || "",
    name: item.name || "--",















    role: item.role || "角色待定",















    nextDay: item.backtest















      ? `${item.backtest.summary.verdict} · 次日${formatNumber(item.backtest.summary.avgNextClose)}%`















      : "暂无次日回测",

    participationValue: item.participationValue || null,
    positionAllocation: item.positionAllocation || null,















  }));































  const key = projection.generationId || `${date}-${mainLine}`;















  state.entryHistory = state.entryHistory.filter((item) => item.key !== key);















  state.entryHistory.unshift({















    key,















    date,















    cycle,















    operation,















    mainLine,















    continuity,















    picks,

    decisionChain: {
      version: Number(projection.chain && projection.chain.version) || 3,
      authority: projection.chain && projection.chain.authority || "canonical_stock_decision",
      generationId: projection.generationId,
      tradingDate: projection.tradingDate,
      asOf: projection.asOf,
      contractReady: projection.contractReady,
      executionOpen: projection.executionOpen,
      marketStage: projection.marketStage,
      authorization: projection.authorization,
      result: {
        status: projection.result && projection.result.status || "blocked",
        selectedCodes: projection.selectedCodes,
        initialPortfolioPct: projection.initialPortfolioPct,
        maximumPortfolioPct: projection.maximumPortfolioPct,
      },
      blockers: projection.blockers,
    },
    legacyObservation: {
      selected: (Array.isArray(payload.selected) ? payload.selected : [])
        .map((row) => ({ code: row && row.code, name: row && row.name }))
        .filter((row) => row.code),
    },















  });















  state.entryHistory = state.entryHistory.slice(0, 12);















  persist();















  renderEntryHistory();















}































function resolveKlineFetchDisplayStatus(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const diagnostics = root.sources
    && root.sources.klineDiagnostics
    && typeof root.sources.klineDiagnostics === "object"
    && !Array.isArray(root.sources.klineDiagnostics)
    ? root.sources.klineDiagnostics
    : null;
  const marketScope = diagnostics && diagnostics.marketScope
    && typeof diagnostics.marketScope === "object" && !Array.isArray(diagnostics.marketScope)
    ? diagnostics.marketScope : null;
  const fetchStatus = root.fetchStatus && typeof root.fetchStatus === "object" ? root.fetchStatus : {};
  const allCandidates = Array.isArray(root.candidates)
    ? root.candidates
    : [...(Array.isArray(root.selected) ? root.selected : []), ...(Array.isArray(root.rejected) ? root.rejected : [])];
  const candidates = allCandidates.filter((candidate) => candidate && candidate.previousLimitUpOnly !== true);
  const finite = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  };
  const countFrom = (source, keys) => {
    if (!source) return null;
    for (const key of keys) {
      const number = finite(source[key]);
      if (number !== null) return Math.floor(number);
    }
    return null;
  };
  const normalizeDate = (value) => {
    const match = String(value || "").match(/20\d{2}-\d{2}-\d{2}/);
    return match ? match[0] : null;
  };
  const candidateLineageRoots = (candidate) => {
    const dataLineage = candidate && candidate.dataLineage && typeof candidate.dataLineage === "object"
      ? candidate.dataLineage : null;
    const lineage = candidate && candidate.lineage && typeof candidate.lineage === "object"
      ? candidate.lineage : null;
    return [
      candidate && candidate.klineDataLineage,
      candidate && candidate.klineDataStatus,
      candidate && candidate.klineLineage,
      candidate && candidate.klineProfileLineage,
      dataLineage && dataLineage.kline,
      dataLineage && dataLineage.klineProfile,
      lineage && lineage.kline,
      candidate && candidate.klineProfile && candidate.klineProfile.lineage,
    ].filter((item) => item && typeof item === "object" && !Array.isArray(item));
  };
  const candidateSource = (candidate, roots) => [
    ...roots.flatMap((item) => [item.source, item.provider, item.sourceType, item.mode, item.state, item.freshness]),
    candidate && typeof candidate.klineDataStatus === "string" ? candidate.klineDataStatus : "",
    candidate && candidate.klineProfile && candidate.klineProfile.lastSession
      && candidate.klineProfile.lastSession.source,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join(" ");
  const cachedCandidates = [];
  const inferred = { live: 0, fallback: 0, cached: 0 };
  let profiledCandidateCount = 0;
  let profiledClosingEvidenceCount = 0;
  let profiledUsableClosingCount = 0;
  candidates.forEach((candidate) => {
    if (!candidate || typeof candidate !== "object" || !candidate.klineProfile) return;
    profiledCandidateCount += 1;
    const roots = candidateLineageRoots(candidate);
    const source = candidateSource(candidate, roots);
    const session = candidate.klineProfile.lastSession && typeof candidate.klineProfile.lastSession === "object"
      ? candidate.klineProfile.lastSession : {};
    const lineageClosing = roots.find((item) => (
      Object.prototype.hasOwnProperty.call(item, "verified")
      || Object.prototype.hasOwnProperty.call(item, "completed")
      || Object.prototype.hasOwnProperty.call(item, "closingComplete")
    ));
    const sessionReportsClosing = Object.prototype.hasOwnProperty.call(session, "verified")
      || Object.prototype.hasOwnProperty.call(session, "completed");
    if (lineageClosing || sessionReportsClosing) {
      profiledClosingEvidenceCount += 1;
      const verified = lineageClosing && Object.prototype.hasOwnProperty.call(lineageClosing, "verified")
        ? lineageClosing.verified === true : session.verified === true;
      const completed = lineageClosing && (
        Object.prototype.hasOwnProperty.call(lineageClosing, "completed")
        || Object.prototype.hasOwnProperty.call(lineageClosing, "closingComplete")
      )
        ? (lineageClosing.completed === true || lineageClosing.closingComplete === true)
        : session.completed === true;
      if (verified && completed) profiledUsableClosingCount += 1;
    }
    const cached = candidate.klineProfileCached === true
      || roots.some((item) => item.cached === true || item.isCached === true || item.fromCache === true)
      || /cache(?:d)?/.test(source);
    if (cached) {
      inferred.cached += 1;
      cachedCandidates.push({ candidate, roots });
    } else if (/tencent|fallback|backup|alternate/.test(source)) {
      inferred.fallback += 1;
    } else {
      inferred.live += 1;
    }
  });
  const providerDiagnostics = diagnostics && diagnostics.providers && typeof diagnostics.providers === "object"
    ? diagnostics.providers : {};
  const eastProvider = providerDiagnostics.eastmoney || providerDiagnostics.east || null;
  const tencentProvider = providerDiagnostics.tencent || null;
  const live = countFrom(eastProvider, ["succeeded", "successCount", "freshCount"])
    ?? countFrom(diagnostics, ["live", "primary", "east", "eastmoney", "realtime", "freshCount"])
    ?? (candidates.length ? inferred.live : null);
  const fallback = countFrom(tencentProvider, ["succeeded", "successCount", "freshCount"])
    ?? countFrom(diagnostics, ["fallback", "backup", "tencent", "alternate"])
    ?? (candidates.length ? inferred.fallback : null);
  const sameDayCacheCount = countFrom(marketScope, ["sameDayCacheCount", "sameDayCache", "sameDayCached"])
    ?? countFrom(diagnostics, ["sameDayCacheCount", "sameDayCache", "sameDayCached"]);
  const staleCacheCount = countFrom(marketScope, ["staleCacheCount", "staleCacheRejected", "staleCacheRejectedCount", "staleCached"])
    ?? countFrom(diagnostics, ["staleCacheCount", "staleCacheRejected", "staleCacheRejectedCount", "staleCached"]);
  const reportedCached = countFrom(diagnostics, ["cached", "cache", "cacheCount", "cacheHitCount"])
    ?? (sameDayCacheCount !== null || staleCacheCount !== null
      ? Number(sameDayCacheCount || 0) + Number(staleCacheCount || 0)
      : null);
  const cached = reportedCached === null
    ? (candidates.length ? inferred.cached : null)
    : Math.max(reportedCached, inferred.cached);
  const failed = countFrom(marketScope, ["failed", "fail", "failureCount", "liveFailureCount"])
    ?? countFrom(diagnostics, ["failed", "fail", "failureCount", "liveFailureCount"]);
  const profileFailures = countFrom(marketScope, ["profileFailures", "profileFailed", "profileFailureCount"])
    ?? countFrom(diagnostics, ["profileFailures", "profileFailed", "profileFailureCount"]);
  const klineItem = (Array.isArray(fetchStatus.items) ? fetchStatus.items : []).find((item) => (
    item && /K线|均线/i.test(String(item.name || ""))
  ));
  const requestedCount = countFrom(marketScope, ["requested", "requestedCount", "targetCount"])
    ?? countFrom(diagnostics, ["requested", "requestedCount", "targetCount"])
    ?? countFrom(klineItem, ["requestedCount", "requested", "targetCount"]);
  const unavailableCount = countFrom(marketScope, ["unavailable", "unavailableCount", "unresolvedCount"])
    ?? countFrom(diagnostics, ["unavailable", "unavailableCount", "unresolvedCount"])
    ?? countFrom(klineItem, ["unavailableCount", "unavailable", "unresolvedCount"]);
  const evidenceStatus = String(
    fetchStatus.evidenceStatus
    || diagnostics && diagnostics.evidenceStatus
    || klineItem && klineItem.evidenceStatus
    || "",
  ).trim().toLowerCase();
  const hasSignal = Boolean(diagnostics)
    || Boolean(klineItem)
    || Boolean(String(fetchStatus.mode || fetchStatus.evidenceStatus || "").trim())
    || cachedCandidates.length > 0
    || candidates.some((candidate) => candidate && candidate.klineProfile);
  if (!hasSignal) return null;

  const cacheDates = [];
  const addDate = (value) => {
    const date = normalizeDate(value);
    if (date && !cacheDates.includes(date)) cacheDates.push(date);
  };
  let directCacheDateEvidence = false;
  if (diagnostics) {
    [
      diagnostics.cacheTradingDate,
      diagnostics.cachedTradingDate,
      diagnostics.cacheDate,
      diagnostics.cacheMarketDataTradingDate,
    ].forEach((value) => {
      if (normalizeDate(value)) directCacheDateEvidence = true;
      addDate(value);
    });
    [marketScope && marketScope.cacheTradingDates, diagnostics.cacheTradingDates, diagnostics.cachedTradingDates].forEach((values) => {
      const dateValues = Array.isArray(values)
        ? values : values && typeof values === "object" ? Object.keys(values) : [];
      dateValues.forEach((value) => {
        if (normalizeDate(value)) directCacheDateEvidence = true;
        addDate(value);
      });
    });
  }
  let cachedCandidateDateEvidenceCount = 0;
  let cachedCandidateClosingEvidenceCount = 0;
  let cachedCandidateUsableClosingCount = 0;
  let cachedCandidateClosingEvidenceInvalid = false;
  cachedCandidates.forEach(({ candidate, roots }) => {
    const profile = candidate.klineProfile || {};
    const session = profile.lastSession && typeof profile.lastSession === "object" ? profile.lastSession : {};
    const lineageDate = roots.map((item) => (
      item.cacheTradingDate
      || item.cachedTradingDate
      || item.profileTradingDate
      || item.marketDataTradingDate
      || item.tradingDate
    )).find(normalizeDate);
    const candidateDate = normalizeDate(lineageDate || profile.lastTradingDate || session.tradingDate);
    if (candidateDate) cachedCandidateDateEvidenceCount += 1;
    addDate(candidateDate);
    const lineageClosing = roots.find((item) => (
      Object.prototype.hasOwnProperty.call(item, "verified")
      || Object.prototype.hasOwnProperty.call(item, "completed")
      || Object.prototype.hasOwnProperty.call(item, "closingComplete")
    ));
    const sessionReportsClosing = Object.prototype.hasOwnProperty.call(session, "verified")
      || Object.prototype.hasOwnProperty.call(session, "completed");
    if (lineageClosing || sessionReportsClosing) {
      cachedCandidateClosingEvidenceCount += 1;
      const verified = lineageClosing && Object.prototype.hasOwnProperty.call(lineageClosing, "verified")
        ? lineageClosing.verified === true : session.verified === true;
      const completed = lineageClosing && (
        Object.prototype.hasOwnProperty.call(lineageClosing, "completed")
        || Object.prototype.hasOwnProperty.call(lineageClosing, "closingComplete")
      )
        ? (lineageClosing.completed === true || lineageClosing.closingComplete === true)
        : session.completed === true;
      if (verified && completed) cachedCandidateUsableClosingCount += 1;
      else cachedCandidateClosingEvidenceInvalid = true;
    }
  });
  cacheDates.sort();

  const cacheAges = [];
  const addAgeMinutes = (value, divisor = 1) => {
    const number = finite(value);
    if (number !== null) cacheAges.push(number / divisor);
  };
  const collectAge = (source) => {
    if (!source) return;
    ["cacheAgeMinutes", "cachedAgeMinutes", "maxCacheAgeMinutes", "oldestCacheAgeMinutes", "cacheAgeMins", "cacheMaxAgeMinutes", "ageMinutes"]
      .forEach((key) => addAgeMinutes(source[key]));
    ["cacheAgeMs", "cachedAgeMs", "maxCacheAgeMs", "oldestCacheAgeMs", "ageMs"]
      .forEach((key) => addAgeMinutes(source[key], 60000));
  };
  collectAge(diagnostics);
  cachedCandidates.forEach(({ roots }) => roots.forEach(collectAge));
  const cacheAgeMinutes = cacheAges.length ? Math.max(...cacheAges) : null;
  const expectedCompletedTradingDate = normalizeDate(
    marketScope && (marketScope.expectedCompletedTradingDate || marketScope.expectedTradingDate)
    || diagnostics && (diagnostics.expectedCompletedTradingDate || diagnostics.expectedTradingDate)
    || klineItem && (klineItem.expectedCompletedTradingDate || klineItem.expectedTradingDate),
  );
  const payloadTradingDate = normalizeDate(
    root.tradingDate || root.asOf && root.asOf.tradingDate,
  );
  const tradingDate = normalizeDate(
    expectedCompletedTradingDate
    || root.tradingDate
    || root.tradingDate
    || (root.generationContext && root.generationContext.tradingDate)
    || (root.archiveMeta && root.archiveMeta.tradingDate),
  );
  const cacheUsed = Number(cached || 0) > 0;
  const availableCount = [live, fallback, cached].reduce((sum, value) => sum + Number(value || 0), 0);
  const explicitState = String(
    marketScope && (marketScope.statusKey || marketScope.state || marketScope.status || marketScope.mode || marketScope.freshness)
    || diagnostics && (diagnostics.statusKey || diagnostics.state || diagnostics.status || diagnostics.mode || diagnostics.freshness)
    || fetchStatus.mode
    || klineItem && klineItem.statusKey
    || "",
  )
    .trim().toLowerCase();
  const candidateLineageStale = cachedCandidates.some(({ roots }) => roots.some((item) => (
    item.dateAligned === false || /stale_cache|expired/.test(String(item.mode || item.state || "").toLowerCase())
  )));
  const candidateLineageSameDay = cachedCandidates.length > 0 && cachedCandidates.every(({ roots }) => roots.some((item) => (
    item.dateAligned === true || /same_day_cache/.test(String(item.mode || item.state || "").toLowerCase())
  )));
  const explicitlyStale = root.stale === true
    || (diagnostics && (diagnostics.stale === true || diagnostics.cacheStale === true))
    || Number(staleCacheCount || 0) > 0
    || candidateLineageStale
    || /stale|expired|old[_-]?cache/.test(explicitState);
  const explicitlySameDay = explicitState === "degraded_same_day_cache"
    || (cacheUsed && Number(sameDayCacheCount || 0) === Number(cached || 0))
    || candidateLineageSameDay;
  const sameDayCache = cacheUsed
    && Boolean(tradingDate)
    && cacheDates.length > 0
    && (directCacheDateEvidence || (
      cachedCandidates.length > 0
      && cachedCandidateDateEvidenceCount === cachedCandidates.length
      && cachedCandidates.length >= Number(cached || 0)
    ))
    && cachedCandidates.length > 0
    && cachedCandidateClosingEvidenceCount === cachedCandidates.length
    && cachedCandidateUsableClosingCount === cachedCandidates.length
    && cacheDates.every((date) => date === tradingDate);
  const mismatchedCacheDate = cacheUsed
    && Boolean(tradingDate)
    && cacheDates.some((date) => date !== tradingDate);
  const hasFailure = Number(failed || 0) > 0
    || Number(profileFailures || 0) > 0
    || Boolean(klineItem && klineItem.ok === false);
  const restoredAwaitingRefresh = root.restoredFromDisk === true
    && root.clientRefreshVerified !== true;
  let state = "live_complete";
  let level = "ok";
  let label = "✓ K线实时来源完整";
  if (explicitState === "unavailable" || Number(unavailableCount || 0) > 0) {
    state = "unavailable";
    level = availableCount > 0 ? "partial" : "fail";
    label = availableCount > 0 ? "⚠️ 部分K线来源不可用" : "✗ K线数据不可用";
  } else if (cacheUsed && (explicitlyStale || mismatchedCacheDate)) {
    state = "stale_cache";
    level = "fail";
    label = "✗ 实时K线失败·使用非当日缓存";
  } else if (cacheUsed && cachedCandidateClosingEvidenceInvalid) {
    state = "unavailable";
    level = "fail";
    label = "✗ K线缓存收盘证据不完整";
  } else if (cacheUsed && restoredAwaitingRefresh) {
    state = "restored_snapshot";
    level = "partial";
    const restoredDate = payloadTradingDate || (cacheDates.length === 1 ? cacheDates[0] : "");
    label = `↻ 已恢复${restoredDate ? ` ${restoredDate} ` : ""}收盘快照·等待后台核对`;
  } else if (cacheUsed && (sameDayCache || explicitlySameDay)) {
    state = "degraded_same_day_cache";
    level = "partial";
    const verifiedCacheDate = cacheDates.length === 1 ? cacheDates[0] : "";
    const verifiedCacheCount = Math.max(Number(cached || 0), cachedCandidates.length);
    label = verifiedCacheDate
      ? `⚠️ 部分实时源失败·${verifiedCacheCount > 0 ? `${verifiedCacheCount}只` : ""}使用${verifiedCacheDate}缓存`
      : "⚠️ 部分实时源失败·缓存交易日未验证";
  } else if (cacheUsed) {
    state = "unavailable";
    level = "fail";
    label = "✗ K线缓存交易日未验证";
  } else if (hasFailure || (candidates.length > 0 && availableCount === 0)) {
    state = "unavailable";
    level = availableCount > 0 ? "partial" : "fail";
    label = availableCount > 0 ? "⚠️ 部分K线来源不可用" : "✗ K线数据不可用";
  }

  const countParts = [
    ["实时", live],
    ["备用", fallback],
    ["缓存", cached],
    ["失败", failed],
  ].filter(([, value]) => value !== null).map(([name, value]) => `${name} ${value}`);
  if (cacheDates.length === 1) countParts.push(`缓存交易日 ${cacheDates[0]}`);
  else if (cacheDates.length > 1) countParts.push(`缓存交易日 ${cacheDates[0]}～${cacheDates.at(-1)}`);
  if (cachedCandidateClosingEvidenceCount > 0) {
    countParts.push(`已验证收盘 ${cachedCandidateUsableClosingCount}/${cachedCandidateClosingEvidenceCount}`);
  }
  if (cacheAgeMinutes !== null) countParts.push(`缓存年龄 ${Math.max(0, Math.round(cacheAgeMinutes))}分钟`);
  return {
    state,
    level,
    label,
    counts: { live, fallback, cached, failed },
    cacheTradingDates: cacheDates,
    cacheAgeMinutes,
    evidenceStatus,
    expectedCompletedTradingDate,
    payloadTradingDate,
    requestedCount,
    unavailableCount,
    profiledCandidateCount,
    profiledClosingEvidenceCount,
    profiledUsableClosingCount,
    cachedCandidateCount: cachedCandidates.length,
    cachedCandidateDateEvidenceCount,
    cachedCandidateClosingEvidenceCount,
    cachedCandidateUsableClosingCount,
    detail: countParts.length ? `K线来源：${countParts.join(" · ")}` : "K线来源：未返回可验证诊断",
  };
}

function resolvePayloadExecutionFreshness(payload) {
  const root = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const kline = resolveKlineFetchDisplayStatus(root);
  const blockers = [];
  const evidenceStatus = String(kline && kline.evidenceStatus || "").trim().toLowerCase();
  const state = String(kline && kline.state || "unavailable");
  if (evidenceStatus !== "complete") blockers.push("抓取证据状态不是complete");
  if (!kline) blockers.push("K线来源诊断缺失");
  if (state === "stale_cache") blockers.push("K线仅有跨日旧缓存");
  if (state === "unavailable") blockers.push("K线证据不可用");
  if (Number(kline && kline.unavailableCount || 0) > 0) blockers.push("仍有K线不可用候选");

  if (state === "degraded_same_day_cache") {
    const expectedDate = String(kline.expectedCompletedTradingDate || "").trim();
    const payloadDate = String(kline.payloadTradingDate || "").trim();
    const cacheCount = Number(kline.counts && kline.counts.cached || 0);
    const unavailableKnown = kline.unavailableCount !== null && kline.unavailableCount !== undefined;
    if (!expectedDate || !payloadDate || expectedDate !== payloadDate) {
      blockers.push("当日缓存的应完成交易日未对齐");
    }
    if (!unavailableKnown || Number(kline.unavailableCount) !== 0) {
      blockers.push("当日缓存仍有未解析K线");
    }
    if (cacheCount <= 0) blockers.push("当日缓存命中数缺失");
    if (
      kline.cachedCandidateCount < cacheCount
      || kline.cachedCandidateDateEvidenceCount < cacheCount
      || kline.cachedCandidateClosingEvidenceCount < cacheCount
      || kline.cachedCandidateUsableClosingCount < cacheCount
    ) blockers.push("当日缓存的verified/completed覆盖不完整");
    if (Array.isArray(kline.cacheTradingDates) && (
      !kline.cacheTradingDates.length
      || kline.cacheTradingDates.some((date) => date !== expectedDate)
    )) blockers.push("缓存K线交易日与应完成日不一致");
    const requestedCount = Number(kline.requestedCount);
    if (Number.isFinite(requestedCount) && requestedCount > 0
      && kline.profiledUsableClosingCount < requestedCount) {
      blockers.push("全量K线verified/completed覆盖不完整");
    }
  }

  const eligibleState = state === "live_complete" || state === "degraded_same_day_cache";
  const evidenceUsable = Boolean(eligibleState && blockers.length === 0);
  return {
    state,
    evidenceStatus: evidenceStatus || "missing",
    evidenceUsable,
    directBuyEligible: evidenceUsable,
    formalOpportunityEligible: evidenceUsable,
    degraded: state === "degraded_same_day_cache",
    blockers: Array.from(new Set(blockers)),
    kline,
  };
}

function resolveLatestCompletedTradingDaySnapshot(payload) {
  const executionFreshness = resolvePayloadExecutionFreshness(payload);
  const kline = executionFreshness && executionFreshness.kline || {};
  const expectedTradingDate = postCloseOpportunityText(kline.expectedCompletedTradingDate);
  const payloadTradingDate = postCloseOpportunityText(
    kline.payloadTradingDate
    || payload && (payload.tradingDate || payload.asOf && payload.asOf.tradingDate),
  );
  const eligible = Boolean(
    executionFreshness.evidenceUsable === true
    && expectedTradingDate
    && payloadTradingDate
    && expectedTradingDate === payloadTradingDate
    && payload && payload.stale !== true
    && !postCloseOpportunityText(payload && payload.fetchError)
  );
  return {
    eligible,
    tradingDate: payloadTradingDate || expectedTradingDate || "",
    expectedTradingDate,
    executionFreshness,
  };
}

// 抓取状态框：成功/部分失败/失败必须明示——静默回退拿旧数据冒充新抓取会误导周期判断















function renderFetchStatus(fetchStatus, payload = null) {















  const badges = document.querySelectorAll("#fetchStatusBadge, #fetchStatusBadgeDecision");















  const issues = document.querySelector("#fetchStatusIssues");















  if (!badges.length) return;

  const klineSourceStatus = payload ? resolveKlineFetchDisplayStatus(payload) : null;
  if (!fetchStatus && klineSourceStatus && klineSourceStatus.state !== "live_complete") {
    fetchStatus = { level: klineSourceStatus.level, label: klineSourceStatus.label, items: [] };
  }















  if (!fetchStatus) {















    // 老缓存数据没有状态字段：按未知处理，同样要提醒















    badges.forEach((b) => {















      b.textContent = "⚠️ 抓取状态未知（旧缓存数据，建议重新抓取）";















      b.className = "fetch-status-badge fs-partial";















    });















    if (issues) issues.innerHTML = "";















    return;















  }















  const levelRank = { ok: 0, partial: 1, fail: 2 };
  const displayStatus = fetchStatus && klineSourceStatus && klineSourceStatus.state !== "live_complete"
    ? (() => {
      const originalLevel = String(fetchStatus.level || "partial");
      const originalMoreSevere = Number(levelRank[originalLevel] || 0) > Number(levelRank[klineSourceStatus.level] || 0);
      const originalLabel = String(fetchStatus.label || "").trim();
      const preserveLabel = fetchStatus.preserveLabel === true && Boolean(originalLabel);
      return {
        ...fetchStatus,
        level: originalMoreSevere ? originalLevel : klineSourceStatus.level,
        label: preserveLabel
          ? originalLabel
          : originalMoreSevere && originalLabel && !/数据完整/.test(originalLabel)
          ? `${originalLabel}；${klineSourceStatus.label.replace(/^[✓✗⚠️\s]+/, "")}`
          : klineSourceStatus.label,
      };
    })()
    : fetchStatus;

  badges.forEach((b) => {















    b.textContent = displayStatus.label;















    b.className = `fetch-status-badge fs-${displayStatus.level}`;

    if (klineSourceStatus && typeof b.setAttribute === "function") {
      b.setAttribute("data-kline-source-state", klineSourceStatus.state);
    }















  });















  if (issues) {















    const sourceItems = (fetchStatus.items || []).filter((item) => (
      !klineSourceStatus || String(item && item.name || "").trim() !== "K线/均线"
    ));

    const failed = sourceItems.filter((item) => !item.ok);















    const degraded = sourceItems.filter((item) => item.ok && item.degraded === true);
    const ok = sourceItems.filter((item) => item.ok && item.degraded !== true);















    issues.innerHTML = [















      ...(klineSourceStatus ? [
        `<span class="fs-item ${klineSourceStatus.state === "live_complete" ? "fs-good" : "fs-bad"}" data-kline-source-state="${escapeHtml(klineSourceStatus.state)}">${klineSourceStatus.state === "live_complete" ? "✓" : klineSourceStatus.level === "fail" ? "✗" : "⚠"} ${escapeHtml(klineSourceStatus.detail)}</span>`,
      ] : []),
      ...failed.map((item) => `<span class="fs-item fs-bad">✗ ${escapeHtml(item.name)}：${escapeHtml(item.note || "失败")}</span>`),
      ...degraded.map((item) => `<span class="fs-item fs-warn">⚠ ${escapeHtml(item.name)}：${escapeHtml(item.note || "部分降级")}</span>`),















      ...ok.map((item) => `<span class="fs-item fs-good">✓ ${escapeHtml(item.name)} ${escapeHtml(item.note || "")}</span>`),















    ].join("");















  }















}































function renderExternalCoreAlert(payload) {
  const alertEl = document.querySelector("#externalCoreAlert");
  const quotesEl = document.querySelector("#externalCoreQuotes");
  const framework = payload && payload.usFramework ? payload.usFramework : {};
  const alert = payload && payload.externalCoreAlert
    ? payload.externalCoreAlert
    : (framework.coreAlert || { active: false, items: [] });
  const quotes = Array.isArray(framework.techQuotes) ? framework.techQuotes : [];

  if (quotesEl) {
    quotesEl.innerHTML = quotes.length
      ? quotes.map((item) => {
          const changePct = Number(item.changePct);
          const available = item.quoteAvailable !== false && item.changePct !== null && item.changePct !== undefined && Number.isFinite(changePct);
          const isAlert = available && changePct <= -5;
          const signed = available ? `${changePct > 0 ? "+" : ""}${formatMaybeNumber(changePct, 2)}%` : "报价暂缺";
          return `
            <div class="external-core-quote${isAlert ? " is-alert" : ""}${available ? "" : " is-missing"}">
              <span>${escapeHtml(item.market || "外围")} · ${escapeHtml(item.theme || "核心资产")}</span>
              <strong>${escapeHtml(item.name || item.symbol || "--")}</strong>
              <small>${signed}${isAlert ? " · 触发警觉" : ""}</small>
            </div>`;
        }).join("")
      : `<p class="decision-note">外围核心股报价暂未抓到，稍后可重新抓取。</p>`;
  }

  if (!alertEl) return;
  const koreaAnchorDefinitions = [
    { symbol: "000660", name: "SK海力士", market: "韩国", theme: "存储芯片 / HBM" },
    { symbol: "005930", name: "三星电子", market: "韩国", theme: "存储芯片 / 半导体" },
  ];
  const koreaAnchors = koreaAnchorDefinitions.map((definition) => {
    const quote = quotes.find((item) => String(item.symbol || "") === definition.symbol || String(item.name || "") === definition.name);
    return quote ? { ...definition, ...quote } : { ...definition, changePct: null, price: null, quoteAvailable: false };
  });
  const koreaAnchorSymbols = new Set(koreaAnchorDefinitions.map((item) => item.symbol));
  const allQuotes = [
    ...koreaAnchors,
    ...quotes.filter((item) => !koreaAnchorSymbols.has(String(item.symbol || ""))),
  ];
  const marketOrder = ["韩国", "日本", "美国"];
  const marketGroups = new Map();
  for (const item of allQuotes) {
    const market = item.market || "其他外围";
    if (!marketGroups.has(market)) marketGroups.set(market, []);
    marketGroups.get(market).push(item);
  }
  const orderedGroups = [...marketGroups.entries()].sort((left, right) => {
    const leftIndex = marketOrder.indexOf(left[0]);
    const rightIndex = marketOrder.indexOf(right[0]);
    return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex) || left[0].localeCompare(right[0]);
  });
  const triggeredCount = allQuotes.filter((item) => {
    const changePct = Number(item.changePct);
    return item.quoteAvailable !== false && item.changePct !== null && item.changePct !== undefined && Number.isFinite(changePct) && changePct <= -5;
  }).length;
  const missingCount = allQuotes.filter((item) => item.quoteAvailable === false || item.changePct === null || item.changePct === undefined || !Number.isFinite(Number(item.changePct))).length;
  alertEl.hidden = false;

  alertEl.innerHTML = `
    <div class="external-core-alert-head">
      <div><strong>⚠️ 外围核心全景</strong><span>海力士 / 三星常驻；其余核心股跌幅达到或超过5%触发警觉</span></div>
      <div class="external-core-alert-stats"><b>监测 ${allQuotes.length}只</b><b class="is-triggered">触发 ${triggeredCount}只</b>${missingCount ? `<b class="is-missing">缺失 ${missingCount}只</b>` : ""}</div>
    </div>
    <div class="external-core-market-groups">
      ${orderedGroups.map(([market, rows]) => {
        const marketTriggered = rows.filter((item) => item.changePct !== null && item.changePct !== undefined && Number.isFinite(Number(item.changePct)) && Number(item.changePct) <= -5).length;
        return `<section class="external-core-market-group">
          <header><strong>${escapeHtml(market)}</strong><span>${rows.length}只${marketTriggered ? ` · ${marketTriggered}只触发` : ""}</span></header>
          <div>${rows.map((item) => {
            const changePct = Number(item.changePct);
            const hasQuote = item.quoteAvailable !== false && item.changePct !== null && item.changePct !== undefined && Number.isFinite(changePct);
            const isAlert = hasQuote && changePct <= -5;
            const changeText = hasQuote ? `${changePct > 0 ? "+" : ""}${formatMaybeNumber(changePct, 2)}%` : "报价暂缺";
            return `<span class="external-core-alert-item${koreaAnchorSymbols.has(String(item.symbol || "")) ? " is-anchor" : ""}${isAlert ? " is-alert" : ""}${hasQuote ? "" : " is-missing"}">
              <b>${escapeHtml(item.name || item.symbol || "--")}</b><em>${escapeHtml(item.theme || "核心资产")}</em><strong>${escapeHtml(changeText)}${isAlert ? " · 警觉" : ""}</strong>
            </span>`;
          }).join("")}</div>
        </section>`;
      }).join("")}
    </div>
    <p class="external-core-alert-note">${escapeHtml(alert.note || "仅页面提醒，不参与周期、评分、选股或买卖决策")} · 数据时间 ${escapeHtml(formatTime(payload && (payload.fetchedAt || payload.updatedAt)))}</p>`;
}

const THEME_LIBRARY_DISPLAY_ROLES = ["周期龙头", "当日龙头", "高度风险", "容量中军", "补涨"];

function themeLibraryRoleStocks(theme, role) {
  const structural = Array.isArray(theme && theme.stocks) ? theme.stocks : [];
  const dailyHeight = Array.isArray(theme && theme.dailyHeightStocks) ? theme.dailyHeightStocks : [];
  const roleCards = Array.isArray(theme && theme.roleEvidenceCards) ? theme.roleEvidenceCards : [];
  const cardKey = role === "周期龙头" ? "cycleLeader" : role === "当日龙头" || role === "当日先锋" ? "dailyLeader" : "";
  const card = cardKey ? roleCards.find((row) => row && row.roleKey === cardKey) : null;
  if (card) return card.stock ? [card.stock] : [];
  const all = role === "高度风险" || role === "当日高度" ? [...dailyHeight, ...structural] : structural;
  const rows = all.filter((stock) => {
    const tags = Array.isArray(stock && stock.tags) ? stock.tags : [];
    const kinds = Array.isArray(stock && stock.roleKinds) ? stock.roleKinds : [];
    const styles = Array.isArray(stock && stock.roleStyles) ? stock.roleStyles : [];
    if (role === "周期龙头") {
      if (kinds.length) return kinds.includes("cycleLeader");
      return Boolean(stock && stock.cycleIdentity && stock.cycleIdentity.crossDayPersistent === true)
        || (tags.some((tag) => tag && (tag.key === "leader" || tag.label === "龙头"))
          && styles.some((style) => /周期龙头|趋势总龙/.test(String(style || ""))));
    }
    if (role === "高度风险" || role === "当日高度") {
      return kinds.includes("dailyHeight")
        || tags.some((tag) => tag && (tag.key === "daily_height" || tag.label === "当日高度"))
        || styles.some((style) => /当日高度龙|连板高标/.test(String(style || "")));
    }
    if (role === "当日龙头" || role === "当日先锋") return kinds.includes("dailyLeader") || kinds.includes("dailyPioneer") || tags.some((tag) => tag && (tag.key === "pioneer" || tag.label === "先锋"));
    if (role === "容量中军") return kinds.includes("capacityCore") || tags.some((tag) => tag && (tag.key === "capacity" || tag.label === "中军"));
    if (role === "补涨") return kinds.includes("catchup") || tags.some((tag) => tag && (tag.key === "catchup" || tag.label === "补涨"));
    return false;
  });
  const seen = new Set();
  return rows.filter((stock) => {
    const key = String(stock && (stock.code || stock.name) || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function themeLibraryChangeMap(comparison) {
  return new Map(
    (comparison && Array.isArray(comparison.themeChanges) ? comparison.themeChanges : [])
      .map((change) => [String(change && change.id || ""), change]),
  );
}

function themeLibraryRankBadge(change, comparisonAvailable) {
  if (!comparisonAvailable || !change) return "";
  if (change.isNew) return `<span class="theme-history-badge is-new">新晋</span>`;
  const delta = Number(change.rankChange || 0);
  if (delta > 0) return `<span class="theme-history-badge is-up">排名 ↑${delta}</span>`;
  if (delta < 0) return `<span class="theme-history-badge is-down">排名 ↓${Math.abs(delta)}</span>`;
  return `<span class="theme-history-badge">连续热门</span>`;
}

function renderThemeLibraryStock(stock, role) {
  const change = Number(stock && stock.changePct);
  const hasChange = Number.isFinite(change);
  const changeClass = !hasChange ? "" : change > 0 ? " is-up" : change < 0 ? " is-down" : "";
  const roleTag = (stock.tags || []).find((tag) => {
    if (role === "周期龙头") return tag && (tag.key === "leader" || tag.label === "龙头");
    if (role === "高度风险" || role === "当日高度") return tag && (tag.key === "daily_height" || tag.label === "当日高度" || tag.label === "龙头");
    if (role === "当日龙头" || role === "当日先锋") return tag && (tag.key === "pioneer" || tag.label === "先锋");
    if (role === "容量中军") return tag && (tag.key === "capacity" || tag.label === "中军");
    return tag && (tag.key === "catchup" || tag.label === "补涨");
  }) || {};
  const detailTags = Array.isArray(stock.detailTags) ? stock.detailTags : [];
  const roleStyles = Array.isArray(stock.roleStyles) ? stock.roleStyles : [];
  const subThemeTags = Array.isArray(stock.subThemeTags) ? stock.subThemeTags : [];
  const todayState = typeof stock.todayState === "string"
    ? stock.todayState
    : String(stock.todayStateLabel || "");
  const identityLabel = role === "高度风险" || role === "当日高度"
    ? "高度风险观察"
    : String(stock.identity || "");
  const visibleTags = Array.from(new Set([todayState, ...roleStyles, ...subThemeTags, ...detailTags].filter(Boolean))).slice(0, 3);
  return `
    <article class="theme-stock-row" title="${escapeHtml(roleTag.reason || "")}">
      <div class="theme-stock-main">
        <strong>${escapeHtml(stock.name || stock.code || "--")}</strong>
        <span>${escapeHtml(stock.code || "")}${identityLabel ? ` · ${escapeHtml(identityLabel)}` : ""}</span>
      </div>
      <div class="theme-stock-data">
        <b class="theme-stock-change${changeClass}">${hasChange ? `${change > 0 ? "+" : ""}${change.toFixed(2)}%` : "--"}</b>
        ${Number(stock.amountYi) > 0 ? `<small>${formatMaybeNumber(stock.amountYi, 1)}亿</small>` : ""}
      </div>
      ${visibleTags.length ? `<div class="theme-stock-tags">${visibleTags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
    </article>`;
}

function renderThemeLibraryRole(theme, role) {
  const rows = themeLibraryRoleStocks(theme, role);
  const roleClass = { 周期龙头: "leader", 高度风险: "height", 当日高度: "height", 当日龙头: "pioneer", 当日先锋: "pioneer", 容量中军: "capacity", 补涨: "catchup" }[role] || "neutral";
  const emptyText = {
    周期龙头: "当前没有足够跨日证据确认周期龙头。",
    高度风险: "当前没有需要单列的高位负反馈观察票。",
    当日高度: "当前没有需要单列的高位负反馈观察票。",
    当日龙头: "今天没有通过同日主动带动验证的龙头。",
    当日先锋: "今天没有通过同日主动带动验证的龙头。",
    容量中军: "当前没有通过容量承接验证的中军。",
    补涨: "当前没有通过验证的补涨。",
  }[role] || `当前没有通过系统验证的${role}。`;
  return `
    <section class="theme-role-column role-${roleClass}">
      <header>
        <span class="theme-role-tag">${escapeHtml(role)}</span>
        <small>${rows.length ? `${rows.length}只` : "待确认"}</small>
      </header>
      <div class="theme-role-stocks">
        ${rows.length ? rows.map((stock) => renderThemeLibraryStock(stock, role)).join("") : `<p>${escapeHtml(emptyText)}</p>`}
      </div>
    </section>`;
}

function themeRoleEvidenceCard(theme, roleKey) {
  return (Array.isArray(theme && theme.roleEvidenceCards) ? theme.roleEvidenceCards : [])
    .find((card) => card && card.roleKey === roleKey) || null;
}

function themeRoleStatusText(status, roleKey) {
  const key = String(status || "").toLowerCase();
  if (key === "challenged") return "受损/挑战中";
  if (key === "retained") return "周期身份保留";
  if (key === "confirmed") return roleKey === "dailyLeader" ? "当日带动已确认" : "跨日身份已确认";
  if (key === "risk_watch" || key === "risk_marker") return "只看风险，不作买点";
  if (key === "unavailable" || key === "unknown") return "数据不足";
  return "等待确认";
}

function themeRoleEvidenceRows(item) {
  return Array.isArray(item && item.evidence) ? item.evidence.filter(Boolean) : [];
}

function themeRoleEvidenceGaps(item) {
  return Array.isArray(item && item.gaps) ? item.gaps.filter(Boolean) : [];
}

function renderThemeRoleEvidenceArticle(item) {
  const stock = item.stock || {};
  const change = Number(stock.changePct);
  const hasChange = Number.isFinite(change);
  const changeClass = !hasChange ? "" : change > 0 ? " is-up" : change < 0 ? " is-down" : "";
  const labels = Array.from(new Set((item.labels || []).filter(Boolean)));
  const evidence = themeRoleEvidenceRows(item);
  const gaps = themeRoleEvidenceGaps(item);
  const sources = Array.from(new Set([
    item.source,
    ...evidence.map((row) => row && row.source),
  ].filter(Boolean)));
  const dates = Array.from(new Set([
    item.tradingDate,
    ...evidence.map((row) => row && row.tradingDate),
  ].filter(Boolean)));
  const challenged = String(item.status || "").toLowerCase() === "challenged";
  return `
    <article class="theme-role-evidence-card${challenged ? " is-challenged" : ""}" data-theme-role-stock="${escapeHtml(stock.code || stock.name || "unknown")}">
      <div class="theme-role-evidence-stock-head">
        <div><strong>${escapeHtml(stock.name || stock.code || "--")}</strong><span>${escapeHtml(stock.code || "")}</span></div>
        <b class="theme-stock-change${changeClass}">${hasChange ? `${change > 0 ? "+" : ""}${change.toFixed(2)}%` : "--"}</b>
      </div>
      <div class="theme-role-evidence-labels">
        ${labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}
        <span class="is-status">${escapeHtml(themeRoleStatusText(item.status, item.primaryRoleKey))}</span>
      </div>
      ${challenged ? `<p class="theme-role-evidence-warning">原周期身份仍保留，但当前已受损；不可执行，也不会因单日涨停自动换龙。</p>` : ""}
      <p class="theme-role-evidence-boundary">角色观察层 · 不可执行</p>
      <details class="theme-role-evidence-details">
        <summary>验证与证据</summary>
        <div class="theme-role-evidence-body">
          ${evidence.length ? `<ul>${evidence.map((row) => `<li><b>${escapeHtml(row.key || "证据")}</b><span>${escapeHtml(Array.isArray(row.value) ? row.value.join("、") : row.value === true ? "成立" : row.value === false ? "不成立" : row.value ?? "--")}</span><small>${escapeHtml(row.source || "来源待确认")}</small></li>`).join("")}</ul>` : `<p>当前没有可展开的原始证据。</p>`}
          <div class="theme-role-evidence-meta"><b>来源</b><span class="theme-role-evidence-source">${escapeHtml(sources.join("；") || "来源待确认")}</span><b>日期</b><span>${escapeHtml(dates.join("、") || "日期待确认")}</span></div>
          <div class="theme-role-evidence-gaps"><b>缺口</b>${gaps.length ? `<ul>${gaps.map((gap) => `<li>${escapeHtml(gap)}</li>`).join("")}</ul>` : `<span>当前角色证据无额外缺口；交易条件仍须独立验证。</span>`}</div>
        </div>
      </details>
    </article>`;
}

function renderThemeRoleEvidenceEmpty(roleKey, item) {
  const status = String(item && item.status || "none").toLowerCase();
  const mergedIntoPrimary = Boolean(item && item.stock);
  const messages = {
    cycleLeader: status === "unavailable" || status === "unknown"
      ? "数据不足，无法判断周期龙头"
      : "本周期暂无已确认龙头",
    dailyLeader: mergedIntoPrimary
      ? "与周期龙头为同一只，已合并展示"
      : status === "unavailable" || status === "unknown"
      ? "数据不足，无法判断当日龙头"
      : "当日暂无已确认龙头",
    heightRisk: "当前暂无需要单列的高位负反馈观察票",
  };
  const evidence = themeRoleEvidenceRows(item);
  const gaps = themeRoleEvidenceGaps(item);
  const evidenceText = evidence.map((row) => `${row.key || "核验"}=${Array.isArray(row.value) ? row.value.join("、") : row.value}（${row.source || "来源待确认"}）`).join("；");
  return `<div class="theme-role-evidence-empty">
    <strong>${escapeHtml(messages[roleKey] || "当前暂无角色证据")}</strong>
    ${evidence.length ? `<p>证据：${escapeHtml(evidenceText)}</p>` : ""}
    <p>缺口：${escapeHtml(gaps.length ? gaps.join("；") : "当前角色无额外缺口；交易条件仍须独立验证")}</p>
    <small>来源 ${escapeHtml(item && item.source || "待确认")} · ${escapeHtml(item && item.tradingDate || "日期待确认")} · 不可执行</small>
  </div>`;
}

function themeRoleEvidenceSections(theme) {
  const cycle = themeRoleEvidenceCard(theme, "cycleLeader") || {
    roleKey: "cycleLeader", roleLabel: "周期龙头", status: "unavailable", stock: null,
    source: "legacy.theme.stocks", tradingDate: "", evidence: [], gaps: ["缺少周期角色证据契约"], executionEligible: false,
  };
  const daily = themeRoleEvidenceCard(theme, "dailyLeader") || {
    roleKey: "dailyLeader", roleLabel: "当日龙头", status: "unavailable", stock: null,
    source: "legacy.theme.stocks", tradingDate: "", evidence: [], gaps: ["缺少同日主动带动证据契约"], executionEligible: false,
  };
  const heightRows = (Array.isArray(theme && theme.heightRiskStocks) && theme.heightRiskStocks.length
    ? theme.heightRiskStocks
    : Array.isArray(theme && theme.dailyHeightStocks) ? theme.dailyHeightStocks : []);
  const roleInputs = [
    { roleKey: "cycleLeader", roleLabel: "周期龙头", item: cycle, rows: cycle.stock ? [cycle] : [] },
    { roleKey: "dailyLeader", roleLabel: "当日龙头", item: daily, rows: daily.stock ? [daily] : [] },
    { roleKey: "heightRisk", roleLabel: "高度风险", item: { status: "none", source: "theme.dailyHeightStocks", tradingDate: theme && theme.themeCycle && theme.themeCycle.tradingDate, evidence: [], gaps: [] }, rows: heightRows.map((stock) => ({ ...stock, stock })) },
  ];
  const combined = new Map();
  roleInputs.forEach((group, priority) => {
    group.rows.forEach((row) => {
      const stock = row.stock || {};
      const code = String(stock.code || stock.name || "");
      if (!code) return;
      if (!combined.has(code)) combined.set(code, {
        stock,
        primaryRoleKey: group.roleKey,
        priority,
        labels: [],
        status: row.status,
        source: row.source,
        tradingDate: row.tradingDate,
        evidence: [],
        gaps: [],
      });
      const target = combined.get(code);
      target.labels.push(group.roleLabel);
      target.evidence.push(...themeRoleEvidenceRows(row));
      target.gaps.push(...themeRoleEvidenceGaps(row));
      if (priority < target.priority) {
        target.priority = priority;
        target.primaryRoleKey = group.roleKey;
        target.status = row.status;
        target.source = row.source;
        target.tradingDate = row.tradingDate;
      }
    });
  });
  const items = Array.from(combined.values()).map((item) => ({
    ...item,
    labels: Array.from(new Set(item.labels)),
    evidence: item.evidence.filter((row, index, rows) => rows.findIndex((candidate) => `${candidate && candidate.key}|${candidate && candidate.source}` === `${row && row.key}|${row && row.source}`) === index),
    gaps: Array.from(new Set(item.gaps.filter(Boolean))),
  }));
  return roleInputs.map((group) => ({
    ...group,
    items: items.filter((item) => item.primaryRoleKey === group.roleKey),
  }));
}

function renderThemeRoleEvidenceGrid(theme) {
  return `<div class="theme-role-evidence-grid">
    ${themeRoleEvidenceSections(theme).map((group) => `
      <section class="theme-role-evidence-section role-${escapeHtml(group.roleKey)}" data-theme-role-key="${escapeHtml(group.roleKey)}">
        <header><span class="theme-role-tag">${escapeHtml(group.roleLabel)}</span><small>${group.items.length ? `${group.items.length}只` : themeRoleStatusText(group.item && group.item.status, group.roleKey)}</small></header>
        <div class="theme-role-evidence-list">${group.items.length ? group.items.map(renderThemeRoleEvidenceArticle).join("") : renderThemeRoleEvidenceEmpty(group.roleKey, group.item)}</div>
      </section>`).join("")}
  </div>`;
}

function renderThemeCycleContext(theme) {
  const cycle = theme && theme.themeCycle || {};
  return `<div class="theme-cycle-context"><span>具体题材周期</span><strong>${escapeHtml(theme && theme.name || "题材待确认")}</strong><b>${escapeHtml(cycle.label || "题材周期待确认")}</b><small>来源 ${escapeHtml(cycle.source || "待确认")} · ${escapeHtml(cycle.tradingDate || "日期待确认")}</small></div>`;
}

function renderThemeMarketCycle(snapshot) {
  const cycle = snapshot && snapshot.marketCycle || {};
  return `<section class="theme-market-cycle"><span>当前市场周期</span><strong>${escapeHtml(cycle.label || "大周期待确认")}</strong>${cycle.detailLabel ? `<b>${escapeHtml(cycle.detailLabel)}</b>` : ""}<small>来源 ${escapeHtml(cycle.source || "待确认")} · ${escapeHtml(cycle.tradingDate || snapshot && snapshot.tradingDate || "日期待确认")}</small></section>`;
}

function renderMainThemeDecision(snapshot) {
  const decision = snapshot && snapshot.mainThemeDecision || {};
  if (!decision || Number(decision.version || 0) < 1) return "";
  const family = decision.family || {};
  const familyState = decision.confirmedFamily && decision.confirmedFamily.state;
  const familyStateLabel = {
    confirmed: "主线家族已确认",
    retained: "历史主线家族保留",
    challenged: "历史主线家族受挑战",
    expired: "历史主线家族已失效",
  }[familyState] || "跨日身份待确认";
  const currentBest = decision.todayBestSubtheme || {};
  const auditBest = decision.currentBestSubtheme || {};
  const mainAttack = decision.mainAttackSubtheme || {};
  const currentGaps = Array.isArray(auditBest.gaps) ? auditBest.gaps.slice(0, 3) : [];
  return `
    <section class="theme-main-decision ${mainAttack.name ? "is-confirmed" : "is-pending"}" data-theme-decision-status="${escapeHtml(decision.status || "unknown")}">
      <div><span>主线家族</span><strong>${escapeHtml(family.name || "待确认")}</strong><small>${escapeHtml(familyStateLabel)}</small></div>
      <div><span>今日最强细分</span><strong>${escapeHtml(currentBest.name || "暂无")}</strong><small>${currentBest.name ? `精确样本${Number(currentBest.exactSampleCount || 0)}只 · 上涨率${Number.isFinite(Number(currentBest.upRate)) ? `${(Number(currentBest.upRate) * 100).toFixed(1)}%` : "--"} · 中位${Number.isFinite(Number(currentBest.medianChangePct)) ? `${Number(currentBest.medianChangePct).toFixed(2)}%` : "--"}` : auditBest.name ? `最高分候选${auditBest.name}未通过：${currentGaps.join("；")}` : "没有细分通过完整证据读取"}</small></div>
      <div class="theme-main-decision-result"><span>最终主攻</span><strong>${escapeHtml(mainAttack.name || "暂无唯一主攻细分")}</strong><small>${escapeHtml(mainAttack.name ? `最近3个收盘确认${mainAttack.confirmationCount || 0}次` : decision.conclusion || currentGaps.join("；") || "硬门槛或跨日确认不足")}</small></div>
    </section>`;
}

function renderThemeSubthemeAudit(theme) {
  const decision = theme && (theme.subthemeDecision || theme.globalSubthemeDecision) || {};
  if (!decision || Number(decision.version || 0) < 1) return "";
  const currentBest = decision.currentBestSubtheme || decision.currentBest || {};
  const gaps = Array.isArray(currentBest.gaps) ? currentBest.gaps.slice(0, 4) : [];
  return `<div class="theme-subtheme-audit"><span>细分核验</span><strong>${escapeHtml(currentBest.name || "暂无候选")}</strong><small>${escapeHtml(gaps.length ? gaps.join("；") : decision.conclusion || "等待精确细分证据")}</small></div>`;
}

function decisionThemeMetricNumber(value) {
  if (value === null || value === undefined || value === "") return NaN;
  return Number(value);
}

function renderDecisionThemeCard(theme) {
  const score = decisionThemeMetricNumber(theme && theme.score);
  const count = decisionThemeMetricNumber(theme && theme.count);
  const todayLimitUpCount = decisionThemeMetricNumber(theme && theme.todayLimitUpCount);
  const sectorChange = decisionThemeMetricNumber(theme && theme.sector && theme.sector.changePct);
  const subthemes = Array.isArray(theme && theme.subthemes) && theme.subthemes.length
    ? theme.subthemes.filter(Boolean).slice(0, 8)
    : Array.isArray(theme && theme.aliases) ? theme.aliases.filter(Boolean).slice(0, 8) : [];
  const summary = String(theme && theme.summary || "").trim();
  const name = String(theme && (theme.name || theme.displayName) || "--").trim();
  const displayName = String(theme && theme.displayName || "").trim();
  const description = displayName && displayName !== name ? displayName : summary;
  const secondaryRoles = ["容量中军", "补涨"];
  return `
    <article class="decision-topic decision-topic-rich" data-theme-id="${escapeHtml(theme && (theme.id || theme.family || theme.name) || "")}">
      <div class="decision-topic-head">
        <div>
          <strong>${escapeHtml(name)}</strong>
          ${description ? `<p>${escapeHtml(description)}</p>` : ""}
        </div>
        <span class="topic-label">${escapeHtml(theme && theme.label || (theme && theme.isMainLine ? "主线" : "热门观察"))}</span>
      </div>
      <div class="decision-topic-tags decision-topic-metrics">
        <span>热度 ${Number.isFinite(score) ? score.toFixed(1) : "--"}</span>
        <span>热股 ${Number.isFinite(count) ? count : Number(theme && theme.stockCount || 0)}只</span>
        <span>今日涨停 ${Number.isFinite(todayLimitUpCount) ? `${Math.max(0, Math.trunc(todayLimitUpCount))}只` : "--"}</span>
        ${Number.isFinite(sectorChange) ? `<span>板块 ${sectorChange > 0 ? "+" : ""}${sectorChange.toFixed(2)}%</span>` : ""}
      </div>
      ${subthemes.length ? `<div class="decision-topic-subthemes"><b>细分</b>${subthemes.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div>` : ""}
      ${renderThemeCycleContext(theme)}
      ${renderThemeRoleEvidenceGrid(theme)}
      <div class="theme-role-grid decision-topic-role-grid theme-role-secondary-grid">
        ${secondaryRoles.map((role) => renderThemeLibraryRole(theme, role)).join("")}
      </div>
    </article>`;
}

function renderThemeLibraryResponse(response) {
  const list = document.querySelector("#themeLibraryList");
  const meta = document.querySelector("#themeLibraryMeta");
  const summary = document.querySelector("#themeLibrarySummary");
  const select = document.querySelector("#themeLibraryDateSelect");
  if (!list || !meta || !summary || !select) return;

  const snapshot = response && response.snapshot ? response.snapshot : response;
  const themes = Array.isArray(snapshot && snapshot.themes) ? snapshot.themes : [];
  const rawDates = Array.isArray(response && response.availableDates) ? response.availableDates : [];
  const dates = rawDates.map((item) => typeof item === "string" ? { date: item } : item).filter((item) => item && item.date);
  if (snapshot && snapshot.tradingDate && !dates.some((item) => item.date === snapshot.tradingDate)) {
    dates.unshift({ date: snapshot.tradingDate, themeCount: snapshot.themeCount, stockCount: snapshot.stockCount });
  }
  const latestDate = response && response.latestDate || dates[0] && dates[0].date || snapshot && snapshot.tradingDate || "";
  themeLibraryViewState.loaded = true;
  themeLibraryViewState.selectedDate = snapshot && snapshot.tradingDate || "";
  themeLibraryViewState.latestDate = latestDate;
  themeLibraryViewState.response = response;

  select.innerHTML = dates.length
    ? dates.map((item) => `<option value="${escapeHtml(item.date)}"${item.date === themeLibraryViewState.selectedDate ? " selected" : ""}>${escapeHtml(item.date)}${item.date === latestDate ? " · 最新" : ""}</option>`).join("")
    : `<option value="${escapeHtml(themeLibraryViewState.selectedDate)}">${escapeHtml(themeLibraryViewState.selectedDate || "暂无日期")}</option>`;

  const comparison = response && response.comparison || null;
  const comparisonAvailable = Boolean(response && response.previousAvailable && comparison && comparison.exactPreviousAvailable);
  const expectedPreviousDate = response && response.expectedPreviousDate || snapshot && snapshot.previousTradingDate || "";
  const isHistory = Boolean(latestDate && snapshot && snapshot.tradingDate && snapshot.tradingDate !== latestDate);
  const sourceText = snapshot && snapshot.sourceMode === "legacy-derived" ? "旧归档兼容提取" : isHistory ? "历史快照" : "最新市场快照";
  const previousText = comparisonAvailable
    ? `已对比上一交易日 ${escapeHtml(comparison.previousDate || expectedPreviousDate)}`
    : expectedPreviousDate ? `上一交易日 ${escapeHtml(expectedPreviousDate)} 暂无快照，不冒用更早日期` : "暂无上一交易日对比";
  meta.innerHTML = `<div><strong>${escapeHtml(snapshot && snapshot.tradingDate || "--")}</strong><span>${escapeHtml(sourceText)} · ${previousText}</span></div><span>更新时间 ${escapeHtml(formatTime(snapshot && (snapshot.sourceUpdatedAt || snapshot.generatedAt)))}</span>`;

  const newCount = comparisonAvailable ? (comparison.newThemes || []).length : null;
  const continuedCount = comparisonAvailable ? (comparison.continuedThemes || []).length : null;
  summary.innerHTML = `
    <div><span>热门题材</span><strong>${Number(snapshot && snapshot.themeCount || themes.length)}</strong></div>
    <div><span>角色股票</span><strong>${Number(snapshot && snapshot.stockCount || 0)}</strong></div>
    <div><span>新晋题材</span><strong>${newCount === null ? "--" : newCount}</strong></div>
    <div><span>延续题材</span><strong>${continuedCount === null ? "--" : continuedCount}</strong></div>`;

  if (!themes.length) {
    list.innerHTML = `<div class="empty-state">该交易日没有可用的热门题材角色快照。</div>`;
    return;
  }
  const changeMap = themeLibraryChangeMap(comparison);
  list.innerHTML = `${renderThemeMarketCycle(snapshot)}${renderMainThemeDecision(snapshot)}${themes.map((theme) => {
    const change = changeMap.get(String(theme.id || theme.family || theme.name || "")) || theme.history;
    const sectorChange = Number(theme.sector && theme.sector.changePct);
    const hasSectorChange = Number.isFinite(sectorChange);
    const todayLimitUpCount = decisionThemeMetricNumber(theme.todayLimitUpCount);
    const hasTodayLimitUpCount = Number.isFinite(todayLimitUpCount);
    const rankNumber = Number(theme.rank);
    const rankText = Number.isFinite(rankNumber) ? String(Math.max(0, Math.trunc(rankNumber))).padStart(2, "0") : "--";
    return `
      <article class="panel theme-library-card${theme.isMainLine ? " is-mainline" : ""}">
        <header class="theme-library-card-head">
          <div class="theme-library-title">
            <span class="theme-library-rank">${escapeHtml(rankText)}</span>
            <div>
              <h3>${escapeHtml(theme.name || "未命名题材")}</h3>
              <p>${escapeHtml(theme.displayName && theme.displayName !== theme.name ? theme.displayName : theme.summary || "按当日市场热度与板块结构生成")}</p>
            </div>
          </div>
          <div class="theme-library-card-tags">
            ${theme.isMainLine ? `<span class="theme-state-tag is-mainline">主线</span>` : ""}
            <span class="theme-state-tag">${escapeHtml(theme.label || "热门观察")}</span>
            ${themeLibraryRankBadge(change, comparisonAvailable)}
          </div>
        </header>
        <div class="theme-library-metrics">
          <span>热度 <b>${formatMaybeNumber(theme.score, 1)}</b></span>
          <span>热股 <b>${Number(theme.count || 0)}只</b></span>
          <span>今日涨停 <b>${hasTodayLimitUpCount ? `${Math.max(0, Math.trunc(todayLimitUpCount))}只` : "--"}</b></span>
          <span>板块 <b class="${hasSectorChange && sectorChange > 0 ? "is-up" : hasSectorChange && sectorChange < 0 ? "is-down" : ""}">${hasSectorChange ? `${sectorChange > 0 ? "+" : ""}${sectorChange.toFixed(2)}%` : "--"}</b></span>
          <span>${escapeHtml(theme.resonanceLabel || (theme.resonance ? "板块共振" : "等待共振"))}</span>
        </div>
        ${renderThemeSubthemeAudit(theme)}
        ${renderThemeCycleContext(theme)}
        ${renderThemeRoleEvidenceGrid(theme)}
        <div class="theme-role-grid theme-role-secondary-grid">
          ${["容量中军", "补涨"].map((role) => renderThemeLibraryRole(theme, role)).join("")}
        </div>
      </article>`;
  }).join("")}`;
}

function renderThemeLibraryFromPayload(payload, options = {}) {
  const snapshot = payload && payload.themeLibrary;
  if (!snapshot || !Array.isArray(snapshot.themes)) return;
  const force = options.force === true;
  if (!force && themeLibraryViewState.refreshing) return;
  if (!force && themeLibraryViewState.selectedDate && themeLibraryViewState.selectedDate !== themeLibraryViewState.latestDate) return;
  if (!force && themeLibraryViewState.apiLoaded) {
    if (!themeLibraryViewState.loading && !themeLibraryViewState.refreshing) loadThemeLibrary();
    return;
  }
  renderThemeLibraryResponse({
    ok: true,
    available: snapshot.available,
    selectedDate: snapshot.tradingDate,
    latestDate: snapshot.tradingDate,
    expectedPreviousDate: snapshot.previousTradingDate || null,
    previousAvailable: false,
    availableDates: themeLibraryViewState.response && themeLibraryViewState.response.availableDates || [{ date: snapshot.tradingDate }],
    comparison: null,
    snapshot,
  });
}

function setThemeLibraryLoading(message = "正在读取题材库…") {
  const meta = document.querySelector("#themeLibraryMeta");
  if (meta) meta.textContent = message;
}

async function loadThemeLibrary(date = "") {
  const requestId = ++themeLibraryViewState.requestId;
  themeLibraryViewState.loading = true;
  setThemeLibraryLoading(date ? `正在读取 ${date} 题材快照…` : "正在读取最新题材快照…");
  try {
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    const response = await fetch(`/api/theme-library${query}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || payload.available === false) throw new Error(payload.error || "题材库读取失败");
    if (requestId !== themeLibraryViewState.requestId) return false;
    themeLibraryViewState.apiLoaded = true;
    renderThemeLibraryResponse(payload);
    return true;
  } catch (error) {
    if (requestId !== themeLibraryViewState.requestId) return false;
    if (!date && lastHotPayload && lastHotPayload.themeLibrary) {
      themeLibraryViewState.apiLoaded = false;
      renderThemeLibraryFromPayload(lastHotPayload, { force: true });
      const meta = document.querySelector("#themeLibraryMeta");
      if (meta) meta.textContent = `历史接口暂不可用，当前显示最新快照：${error.message}`;
    } else {
      const list = document.querySelector("#themeLibraryList");
      if (list) list.innerHTML = `<div class="empty-state">题材库读取失败：${escapeHtml(error.message)}</div>`;
      setThemeLibraryLoading("题材库读取失败");
    }
    return false;
  } finally {
    if (requestId === themeLibraryViewState.requestId) themeLibraryViewState.loading = false;
  }
}

const PREMARKET_VIEW_STEP = Object.freeze({
  "index-opportunity": "indexOpportunity",
  "trading-preference": "tradingPreference",
  "emotion-stage": "emotionStage",
  "theme-library": "direction",
  "auto-picker": "stocks",
  preplan: "tradePlan",
});

let lastPremarketFlowModel = null;

function premarketFinite(value) {
  const number = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(number) ? number : null;
}

function premarketNumber(value, digits = 2, suffix = "") {
  const number = premarketFinite(value);
  return number === null ? "--" : `${number.toFixed(digits)}${suffix}`;
}

function premarketDivergenceText(size, quality) {
  const labels = {
    small: "小分歧",
    medium: "中等分歧",
    large: "大分歧",
    benign: "良性",
    healthy: "良性",
    mixed: "待确认",
    harmful: "非良性",
    unknown: "待确认",
  };
  const parts = [size, quality]
    .flatMap((value) => String(value || "").trim().toLowerCase().split(/[\s/_-]+/))
    .filter(Boolean)
    .map((value) => labels[value] || value);
  return parts.length ? parts.join(" · ") : "--";
}

function premarketValueText(value, fallback = "--") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const rows = value.map((item) => premarketValueText(item, "")).filter(Boolean);
    return rows.length ? rows.join("；") : fallback;
  }
  if (typeof value === "object") {
    const preferredKeys = [
      "summary", "display", "statusLabel", "action", "note", "plan", "rule",
      "label", "text", "verdictLabel", "priceRange", "pctRange",
    ];
    for (const key of preferredKeys) {
      if (value[key] !== null && value[key] !== undefined && value[key] !== "") {
        return premarketValueText(value[key], fallback);
      }
    }
    const parts = Object.entries(value)
      .filter(([, item]) => typeof item === "string" || typeof item === "number")
      .slice(0, 4)
      .map(([key, item]) => `${key}：${item}`);
    return parts.length ? parts.join("；") : fallback;
  }
  return fallback;
}

function premarketStatusMeta(step) {
  const status = String(step && step.status || "unknown");
  const conclusionState = String(step && step.conclusionState || "");
  const dominantPathStatus = String(step && step.dominantPath && step.dominantPath.status || "unknown");
  if (step && step.key === "tradingPreference" && conclusionState === "intraday_provisional") {
    return { label: "盘中待确认", className: "is-waiting" };
  }
  if (step && step.key === "tradingPreference" && conclusionState === "preopen_provisional") {
    return { label: "盘前待确认", className: "is-waiting" };
  }
  if (
    step
    && step.key === "tradingPreference"
    && Number(step.preferenceVersion || 0) >= 3
    && step.persistentPreference
    && ["accumulating", "unavailable"].includes(String(step.persistentPreference.status || ""))
  ) return { label: "持续样本待积累", className: "is-waiting" };
  const persistentV3 = Boolean(step && Number(step.preferenceVersion || 0) >= 3);
  const persistentStatus = String(step && step.persistentPreference && step.persistentPreference.status || "");
  const stylePathConfirmed = Boolean(
    step
    && step.key === "tradingPreference"
    && step.canonicalState
    && step.canonicalState.usable === true
    && ["dominant", "parallel"].includes(dominantPathStatus)
    && (persistentV3
      ? conclusionState === "confirmed" && ["dominant", "parallel"].includes(persistentStatus)
      : !conclusionState || conclusionState === "confirmed"),
  );
  if (stylePathConfirmed && step.executionBlocked === true) {
    return { label: "风格已确认 · 执行受限", className: "is-conditional" };
  }
  if (status === "blocked") return { label: "已否决", className: "is-blocked" };
  if (status !== "ready") return { label: "待确认", className: "is-waiting" };
  if (step && step.permission === "unknown") return { label: "待验证", className: "is-conditional" };
  return { label: "已确认", className: "is-confirmed" };
}

function premarketMetricHtml(label, value, note = "") {
  return `
    <div class="premarket-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(premarketValueText(value))}</strong>
      ${note ? `<p>${escapeHtml(note)}</p>` : ""}
    </div>
  `;
}

function premarketItemHtml(label, title, note = "") {
  return `
    <article class="premarket-item-card">
      <span>${escapeHtml(label || "观察")}</span>
      <strong>${escapeHtml(premarketValueText(title))}</strong>
      ${note ? `<p>${escapeHtml(premarketValueText(note, ""))}</p>` : ""}
    </article>
  `;
}

function premarketTextRows(value) {
  const rows = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return rows.map((item) => premarketValueText(item, "")).filter(Boolean);
}

function premarketRuleScore(value) {
  const number = premarketFinite(value);
  return number === null ? "待确认" : `${Number(number.toFixed(1))} / 100`;
}

function premarketProjectionCardHtml({ eyebrow = "观察", title = "--", note = "", details = [], tone = "", theme = "" } = {}) {
  const toneClass = ["good", "warn", "danger", "muted"].includes(tone) ? ` is-${tone}` : "";
  const detailRows = premarketTextRows(details);
  return `
    <article class="premarket-projection-card${toneClass}">
      <span>${escapeHtml(premarketValueText(eyebrow, "观察"))}</span>
      <strong>${escapeHtml(premarketValueText(title))}</strong>
      ${theme ? `<mark class="premarket-stock-theme">所属题材：${escapeHtml(premarketValueText(theme, "题材待确认"))}</mark>` : ""}
      ${note ? `<p>${escapeHtml(premarketValueText(note, ""))}</p>` : ""}
      ${detailRows.length ? `
        <details class="premarket-card-evidence">
          <summary>验证与证据 <span>${detailRows.length} 条 · 不计入分数</span></summary>
          <ul>${detailRows.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </details>
      ` : ""}
    </article>
  `;
}

function premarketPlainIndexText(value) {
  let text = premarketValueText(value, "");
  if (!text) return "";
  const replacements = [
    [/中期修复向主升确认/g, "大盘进一步走强"],
    [/短线主升的5日线承接/g, "强势指数回调后重新稳住"],
    [/中期主升尚未确认/g, "现在还不是全面主升"],
    [/确认后才向下游开放全市场主升权限；确认前只按修复候选处理。/g, "多数主要指数继续一起走强后才算成立；在此之前只按逐步转强处理。"],
    [/只把它视为节奏机会；仍需题材、个股和价格校验通过。/g, "回调后重新稳住只能说明指数环境还可以，最终仍要看题材和个股。"],
    [/站上20日线只代表修复改善；60日线与20日斜率未共同确认前，不得升级为中期主升。/g, "多数指数虽然已经转强，但还没有形成全面主升，所以不能放大仓位。"],
    [/结构边界与降级条件保持可见。/g, "最重要的停止条件。"],
  ];
  replacements.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });
  return text;
}

function premarketIndexVerdict(step) {
  const quality = step && step.dataQuality && typeof step.dataQuality === "object" ? step.dataQuality : {};
  const canonicalState = step && step.canonicalState && typeof step.canonicalState === "object" ? step.canonicalState : {};
  const position = step && step.positionPermission && typeof step.positionPermission === "object"
    ? step.positionPermission
    : {};
  const missing = Array.isArray(quality.missing) ? quality.missing.filter(Boolean) : [];
  const usable = Boolean(
    step && step.verified === true
    || canonicalState.usable === true
    || quality.usable === true
    || quality.available === true
    || quality.grade === "complete"
  );
  if (!step || !usable && (step.verified === false || quality.grade === "missing" || missing.length)) {
    return "指数数据还没齐，暂时不判断机会";
  }
  if (step.status === "blocked" || step.permission === "blocked" || position.allowNew === false) {
    return "指数暂时没有交易机会";
  }
  if (position.allowAdd === false || position.ceiling === "reduced" || step.positionLimit) {
    return "指数有机会，但只能控制仓位";
  }
  return "指数有机会";
}

function premarketPlainPreferenceText(value) {
  let text = premarketPlainEmotionText(value) || premarketValueText(value, "");
  if (!text) return "";
  const replacements = [
    [/买点必须由核心与路径同步确认/g, "买点要等资金偏好和最强核心股同时确认"],
    [/低位启动/g, "低位刚启动的股票"],
    [/连板情绪/g, "连板人气股"],
    [/高位趋势/g, "高位趋势股"],
    [/充分换手后的回封/g, "充分成交后重新封住涨停"],
    [/只做核心/g, "只考虑最强的核心股"],
    [/不追后排/g, "不追跟风股"],
    [/主动容量/g, "主动走强的大成交核心股"],
    [/先锋首板确认/g, "最先启动的首板股确认走强"],
    [/路径同步确认/g, "资金偏好和核心股同时确认"],
  ];
  replacements.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });
  return text;
}

function premarketPreferenceConclusion(step) {
  const dominant = step && step.dominantPath && typeof step.dominantPath === "object" ? step.dominantPath : {};
  const persistent = step && step.persistentPreference && typeof step.persistentPreference === "object" ? step.persistentPreference : {};
  const execution = step && step.executionPreference && typeof step.executionPreference === "object" ? step.executionPreference : {};
  const conclusionState = String(step && step.conclusionState || "");
  const observationPhase = String(step && step.sourceCoverage && step.sourceCoverage.observationPhase || "");
  const pathLabel = premarketPlainPreferenceText(dominant.label || step && (step.preference || step.style) || "市场偏好还要确认");
  const method = execution.primary === "回封"
    ? "更适合等最强股充分成交后重新封住，不追跟风股。"
    : premarketPlainPreferenceText(execution.summary || execution.primary || "等核心股出现清楚买点再做");
  if (!pathLabel) return method || "市场偏好还要确认";
  if (conclusionState === "intraday_provisional" || observationPhase === "intraday") {
    return `盘中暂见${pathLabel}，尚未经过收盘确认。${method || "等收盘样本确认后再筛选核心股。"}`;
  }
  if (conclusionState === "preopen_provisional" || observationPhase === "preopen") {
    return `盘前暂按${pathLabel}观察，开盘与收盘证据尚未确认。${method || "等待有效样本形成。"}`;
  }
  if (conclusionState !== "confirmed") {
    const today = step && step.currentObservationDominantPath && step.currentObservationDominantPath.label;
    return `持续炒作偏好尚未确认；${today ? `今日暂见${premarketPlainPreferenceText(today)}，` : ""}单日强弱不改写正式偏好。${method || "暂不据此筛选核心股。"}`;
  }
  return `市场持续偏好${pathLabel}。${persistent.windowDays ? `依据最近${persistent.windowDays}个T+1窗口，` : ""}${method || "等核心股出现清楚买点再做。"}`;
}

function premarketProjectionSectionHtml(key, title, subtitle, cards) {
  const rows = (Array.isArray(cards) ? cards : []).filter(Boolean);
  if (!rows.length) return "";
  return `
    <section class="premarket-projection" data-premarket-projection="${escapeHtml(key)}">
      <div class="premarket-projection-heading">
        <div>
          <h4>${escapeHtml(title)}</h4>
          ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
        </div>
      </div>
      <div class="premarket-projection-grid">${rows.join("")}</div>
    </section>
  `;
}

function premarketIndexEvidenceWindowDates(evidence) {
  const source = evidence && typeof evidence === "object" ? evidence : {};
  const quality = source.dataQuality && typeof source.dataQuality === "object" ? source.dataQuality : {};
  const requestedValue = premarketFinite(quality.requestedDays);
  const requestedDays = requestedValue === null ? 5 : Math.max(1, Math.min(5, Math.round(requestedValue)));
  const dates = new Set();
  const addDate = (value) => {
    const date = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dates.add(date);
  };
  [source.index && source.index.points, source.turnover && source.turnover.points].forEach((rows) => {
    (Array.isArray(rows) ? rows : []).forEach((row) => addDate(row && row.tradingDate));
  });
  [quality.missingDates, quality.gaps].forEach((rows) => {
    (Array.isArray(rows) ? rows : []).forEach((row) => addDate(
      row && typeof row === "object" ? row.tradingDate || row.date : row,
    ));
  });
  return Array.from(dates).sort().slice(-requestedDays);
}

function premarketIndexEvidenceSlots(rows, kind, windowDates = []) {
  const slotsByDate = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const source = row && typeof row === "object" ? row : {};
    const tradingDate = String(source.tradingDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDate)) return;
    const slot = {
      tradingDate,
      quality: premarketValueText(source.quality, ""),
      valid: false,
    };
    const strictClosing = String(source.quality || "").trim().toLowerCase() === "strict_closing";
    if (kind === "index") {
      const open = premarketFinite(source.open);
      const high = premarketFinite(source.high);
      const low = premarketFinite(source.low);
      const close = premarketFinite(source.close);
      const valid = strictClosing
        && [open, high, low, close].every((value) => value !== null)
        && high >= Math.max(open, close)
        && low <= Math.min(open, close)
        && high >= low;
      Object.assign(slot, { open, high, low, close, valid });
    } else {
      const amountYi = premarketFinite(source.amountYi);
      Object.assign(slot, { amountYi, valid: strictClosing && amountYi !== null && amountYi > 0 });
    }
    slotsByDate.set(tradingDate, slot);
  });
  const dates = (Array.isArray(windowDates) && windowDates.length
    ? windowDates
    : Array.from(slotsByDate.keys()).sort().slice(-5));
  return dates.map((tradingDate) => slotsByDate.get(tradingDate) || {
    tradingDate,
    quality: "missing",
    valid: false,
  });
}

function premarketIndexShortDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  return match ? `${match[2]}-${match[3]}` : "--";
}

function premarketIndexSourceLabel(value) {
  const raw = premarketValueText(value, "");
  const labels = {
    "ths-public-page": "同花顺公开行情",
    closing_market_snapshot: "正式收盘快照",
  };
  return labels[raw.trim().toLowerCase()] || raw;
}

function premarketIndexKlineSvg(indexEvidence, slots, windowLabel) {
  const validSlots = slots.filter((slot) => slot && slot.valid === true);
  if (validSlots.length < 2) return "";
  const values = validSlots.flatMap((slot) => [slot.open, slot.high, slot.low, slot.close]);
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  const padding = maximum === minimum ? Math.max(Math.abs(maximum) * 0.005, 1) : (maximum - minimum) * 0.08;
  minimum -= padding;
  maximum += padding;
  const width = 520;
  const height = 210;
  const left = 48;
  const right = 14;
  const top = 18;
  const bottom = 38;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const slotWidth = innerWidth / Math.max(slots.length, 1);
  const bodyWidth = Math.min(26, slotWidth * 0.42);
  const y = (value) => top + ((maximum - value) / (maximum - minimum)) * innerHeight;
  const number = (value) => Number(value.toFixed(2));
  const priceLabel = (value) => Math.abs(value) >= 1000 ? value.toFixed(0) : value.toFixed(2);
  const grid = [0, 0.5, 1].map((ratio) => {
    const gridY = top + ratio * innerHeight;
    const value = maximum - ratio * (maximum - minimum);
    return `<line class="premarket-index-grid-line" x1="${left}" y1="${number(gridY)}" x2="${width - right}" y2="${number(gridY)}"></line><text class="premarket-index-axis-label" x="${left - 6}" y="${number(gridY + 4)}" text-anchor="end">${escapeHtml(priceLabel(value))}</text>`;
  }).join("");
  const candles = slots.map((slot, index) => {
    const centerX = left + slotWidth * (index + 0.5);
    const dateLabel = escapeHtml(premarketIndexShortDate(slot.tradingDate));
    if (!slot.valid) {
      return `<g class="premarket-index-missing-slot" data-date="${escapeHtml(slot.tradingDate)}" data-quality="missing"><title>${escapeHtml(`${slot.tradingDate} 质量未通过`)}</title><line x1="${number(centerX)}" y1="${top}" x2="${number(centerX)}" y2="${top + innerHeight}" pathLength="1"></line><text x="${number(centerX)}" y="${number(top + innerHeight / 2)}" text-anchor="middle">质量未通过</text><text class="premarket-index-date-label" x="${number(centerX)}" y="${height - 12}" text-anchor="middle">${dateLabel}</text></g>`;
    }
    const openY = y(slot.open);
    const closeY = y(slot.close);
    const bodyTop = Math.min(openY, closeY);
    const rawBodyHeight = Math.abs(closeY - openY);
    const bodyHeight = Math.max(1.5, rawBodyHeight);
    const adjustedTop = rawBodyHeight < 1.5 ? bodyTop - (1.5 - rawBodyHeight) / 2 : bodyTop;
    const tone = slot.close > slot.open ? "is-up" : slot.close < slot.open ? "is-down" : "is-flat";
    const accessibleValue = `${slot.tradingDate} 开${priceLabel(slot.open)} 高${priceLabel(slot.high)} 低${priceLabel(slot.low)} 收${priceLabel(slot.close)}`;
    return `<g class="premarket-index-candle ${tone}" data-date="${escapeHtml(slot.tradingDate)}"><title>${escapeHtml(accessibleValue)}</title><line x1="${number(centerX)}" y1="${number(y(slot.high))}" x2="${number(centerX)}" y2="${number(y(slot.low))}"></line><rect x="${number(centerX - bodyWidth / 2)}" y="${number(adjustedTop)}" width="${number(bodyWidth)}" height="${number(bodyHeight)}" rx="1"></rect><text class="premarket-index-date-label" x="${number(centerX)}" y="${height - 12}" text-anchor="middle">${dateLabel}</text></g>`;
  }).join("");
  const name = premarketValueText(indexEvidence && indexEvidence.name, "同花顺全A(沪深)");
  const title = `${name} · ${windowLabel}`;
  const description = `${slots.length}个交易日槽位中${validSlots.length}个通过质量门；缺失槽保留原位，不补零、不插值。`;
  return `<svg class="premarket-index-svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="premarketIndexKlineTitle premarketIndexKlineDesc"><title id="premarketIndexKlineTitle">${escapeHtml(title)}</title><desc id="premarketIndexKlineDesc">${escapeHtml(description)}</desc>${grid}${candles}</svg>`;
}

function premarketIndexTurnoverSvg(slots, windowLabel) {
  const validSlots = slots.filter((slot) => slot && slot.valid === true);
  if (validSlots.length < 2) return "";
  const width = 420;
  const height = 210;
  const left = 48;
  const right = 14;
  const top = 18;
  const bottom = 38;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const slotWidth = innerWidth / Math.max(slots.length, 1);
  const barWidth = Math.min(36, slotWidth * 0.58);
  const maximum = Math.max(...validSlots.map((slot) => slot.amountYi)) * 1.08;
  const number = (value) => Number(value.toFixed(2));
  const bars = slots.map((slot, index) => {
    const centerX = left + slotWidth * (index + 0.5);
    const dateLabel = escapeHtml(premarketIndexShortDate(slot.tradingDate));
    if (!slot.valid) {
      return `<g class="premarket-index-missing-slot" data-date="${escapeHtml(slot.tradingDate)}" data-quality="missing"><title>${escapeHtml(`${slot.tradingDate} 质量未通过`)}</title><line x1="${number(centerX)}" y1="${top}" x2="${number(centerX)}" y2="${top + innerHeight}" pathLength="1"></line><text x="${number(centerX)}" y="${number(top + innerHeight / 2)}" text-anchor="middle">质量未通过</text><text class="premarket-index-date-label" x="${number(centerX)}" y="${height - 12}" text-anchor="middle">${dateLabel}</text></g>`;
    }
    const barHeight = Math.max(1, slot.amountYi / maximum * innerHeight);
    const y = top + innerHeight - barHeight;
    const shortAmount = slot.amountYi >= 10000 ? `${Number((slot.amountYi / 10000).toFixed(2))}万亿` : `${Math.round(slot.amountYi)}亿`;
    return `<g class="premarket-index-turnover-bar" data-date="${escapeHtml(slot.tradingDate)}"><title>${escapeHtml(`${slot.tradingDate} 两市成交额 ${Number(slot.amountYi.toFixed(2)).toLocaleString("zh-CN")}亿元`)}</title><rect x="${number(centerX - barWidth / 2)}" y="${number(y)}" width="${number(barWidth)}" height="${number(barHeight)}" rx="3"></rect><text class="premarket-index-bar-value" x="${number(centerX)}" y="${number(Math.max(top + 10, y - 5))}" text-anchor="middle">${escapeHtml(shortAmount)}</text><text class="premarket-index-date-label" x="${number(centerX)}" y="${height - 12}" text-anchor="middle">${dateLabel}</text></g>`;
  }).join("");
  const maxLabel = `${Math.round(maximum).toLocaleString("zh-CN")}亿`;
  const description = `${slots.length}个交易日槽位中${validSlots.length}个收盘成交额通过质量门；缺失槽保留原位，不补零、不插值。`;
  return `<svg class="premarket-index-svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="premarketIndexTurnoverTitle premarketIndexTurnoverDesc"><title id="premarketIndexTurnoverTitle">${escapeHtml(`两市成交额 · ${windowLabel}`)}</title><desc id="premarketIndexTurnoverDesc">${escapeHtml(description)}</desc><line class="premarket-index-grid-line" x1="${left}" y1="${top + innerHeight}" x2="${width - right}" y2="${top + innerHeight}"></line><text class="premarket-index-axis-label" x="${left - 6}" y="${top + 4}" text-anchor="end">${escapeHtml(maxLabel)}</text>${bars}</svg>`;
}

function premarketIndexEvidenceChartsHtml(step) {
  const evidence = step && step.fiveDayEvidence && typeof step.fiveDayEvidence === "object"
    ? step.fiveDayEvidence
    : null;
  if (!evidence) {
    return `<section class="premarket-index-evidence" data-flow-role="five-day-evidence"><div class="premarket-index-evidence-heading"><div><span>五日证据图</span><h3>最近5个交易日</h3></div></div><div class="empty-state">五日收盘证据正在读取，暂不生成图形。</div></section>`;
  }
  const indexEvidence = evidence.index && typeof evidence.index === "object" ? evidence.index : {};
  const turnoverEvidence = evidence.turnover && typeof evidence.turnover === "object" ? evidence.turnover : {};
  const quality = evidence.dataQuality && typeof evidence.dataQuality === "object" ? evidence.dataQuality : {};
  const windowDates = premarketIndexEvidenceWindowDates(evidence);
  const indexSlots = premarketIndexEvidenceSlots(indexEvidence.points, "index", windowDates);
  const turnoverSlots = premarketIndexEvidenceSlots(turnoverEvidence.points, "turnover", windowDates);
  const requestedValue = premarketFinite(quality.requestedDays);
  const requestedDays = requestedValue === null ? 5 : Math.max(1, Math.min(5, Math.round(requestedValue)));
  const inferredAvailable = Math.min(
    indexSlots.filter((slot) => slot.valid).length,
    turnoverSlots.filter((slot) => slot.valid).length,
  );
  const availableValue = premarketFinite(quality.availableDays);
  const availableDays = availableValue === null
    ? inferredAvailable
    : Math.min(inferredAvailable, Math.max(0, Math.min(requestedDays, Math.round(availableValue))));
  const windowLabel = `最近${requestedDays}个交易日（${availableDays}/${requestedDays}可用）`;
  const status = String(quality.status || "").toLowerCase();
  const unavailable = status === "unavailable";
  const missingDates = (Array.isArray(quality.missingDates) ? quality.missingDates : [])
    .map((value) => String(value || "").trim())
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  const qualityNotes = [];
  if (!unavailable && (quality.consecutive === false || missingDates.length)) {
    const missingLabel = missingDates.length
      ? `${missingDates.map(premarketIndexShortDate).join("、")}快照质量未通过`
      : "实际交易日窗口存在隔离缺口";
    qualityNotes.push(`${missingLabel}，保留空槽；${availableDays}/${requestedDays}日可用。五日均值不计算，不以更早日期补位。`);
  } else if (quality.note) {
    qualityNotes.push(premarketValueText(quality.note, ""));
  }
  const klineSvg = premarketIndexKlineSvg(indexEvidence, indexSlots, windowLabel);
  const turnoverSvg = premarketIndexTurnoverSvg(turnoverSlots, windowLabel);
  const unit = premarketValueText(turnoverEvidence.unit, "亿元");
  const turnoverFacts = [];
  const latestAmount = premarketFinite(turnoverEvidence.latestAmountYi);
  const latestVsPrevious = premarketFinite(turnoverEvidence.latestVsPreviousPct);
  if (latestAmount !== null) turnoverFacts.push(`最新 ${Number(latestAmount.toFixed(2)).toLocaleString("zh-CN")} ${unit}`);
  if (latestVsPrevious !== null) turnoverFacts.push(`较前一交易日 ${latestVsPrevious >= 0 ? "+" : ""}${Number(latestVsPrevious.toFixed(2))}%`);
  const completeWindow = status === "complete" && availableDays === requestedDays && quality.consecutive !== false;
  if (completeWindow) {
    const average = premarketFinite(turnoverEvidence.averageAmountYi);
    const vsAverage = premarketFinite(turnoverEvidence.vsAveragePct);
    const rangePosition = premarketFinite(turnoverEvidence.rangePositionPct);
    if (average !== null) turnoverFacts.push(`5日均额 ${Number(average.toFixed(2)).toLocaleString("zh-CN")} ${unit}`);
    if (vsAverage !== null) turnoverFacts.push(`较5日均额 ${vsAverage >= 0 ? "+" : ""}${Number(vsAverage.toFixed(2))}%`);
    if (rangePosition !== null) turnoverFacts.push(`5日区间位置 ${Number(rangePosition.toFixed(1))}%`);
  }
  const sourceLine = (name, source) => [premarketValueText(name, ""), premarketIndexSourceLabel(source)].filter(Boolean).join(" · ");
  return `
    <section class="premarket-index-evidence${unavailable ? " is-unavailable" : ""}" data-flow-role="five-day-evidence">
      <div class="premarket-index-evidence-heading">
        <div><span>五日证据图</span><h3>${escapeHtml(windowLabel)}</h3></div>
        ${quality.strictClosingOnly === true ? "<mark>仅收盘快照</mark>" : ""}
      </div>
      ${qualityNotes.length ? `<p class="premarket-index-quality-note">${qualityNotes.map((note) => escapeHtml(note)).join("；")}</p>` : ""}
      <div class="premarket-index-chart-grid">
        <article class="premarket-index-chart-card">
          <header><div><span>全A指数</span><h4>${escapeHtml(premarketValueText(indexEvidence.name, "同花顺全A(沪深)"))}</h4></div><small>${escapeHtml(sourceLine(indexEvidence.code, indexEvidence.source))}</small></header>
          ${klineSvg || `<div class="empty-state">${escapeHtml(unavailable ? premarketValueText(quality.note, "五日指数证据读取失败。") : "有效收盘数据少于2日，K线证据不足。")}</div>`}
        </article>
        <article class="premarket-index-chart-card">
          <header><div><span>两市成交额</span><h4>收盘成交额</h4></div><small>${escapeHtml(premarketIndexSourceLabel(turnoverEvidence.source) || "正式收盘快照")}</small></header>
          ${turnoverSvg || `<div class="empty-state">${escapeHtml(unavailable ? premarketValueText(quality.note, "五日成交额证据读取失败。") : "有效收盘数据少于2日，成交额证据不足。")}</div>`}
          ${turnoverFacts.length ? `<p class="premarket-index-chart-summary">${turnoverFacts.map((fact) => escapeHtml(fact)).join(" · ")}</p>` : ""}
        </article>
      </div>
    </section>
  `;
}

function premarketIndexPlanText(value, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (Array.isArray(value)) {
    const rows = value.map((item) => premarketIndexPlanText(item, "")).filter(Boolean);
    return rows.length ? rows.join("；") : fallback;
  }
  if (!value || typeof value !== "object") return fallback;
  for (const key of ["label", "title", "summary", "result", "action", "note", "text", "display", "time", "at"]) {
    const text = premarketIndexPlanText(value[key], "");
    if (text) return text;
  }
  return fallback;
}

function premarketIndexPlanRows(value) {
  const rows = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return rows.map((item) => premarketIndexPlanText(item, "")).filter(Boolean);
}

function premarketIndexTomorrowPlanHtml(step) {
  const plan = step && step.indexTomorrowPlan && typeof step.indexTomorrowPlan === "object"
    ? step.indexTomorrowPlan
    : {};
  const definitions = [
    ["mainPath", "明日主路径", "muted"],
    ["upwardRevision", "向上修正条件", "good"],
    ["downwardRevision", "向下修正条件", "danger"],
  ];
  const cards = definitions.map(([key, eyebrow, tone]) => {
    const value = plan[key];
    if (value === null || value === undefined || value === "") return "";
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const title = premarketIndexPlanText(source.label || source.title || source.summary || value, "路径待验证");
    const note = premarketIndexPlanText(source.result || source.action || source.note, "");
    const details = [source.conditions, source.condition, source.trigger, source.validation]
      .flatMap((row) => premarketIndexPlanRows(row));
    return premarketProjectionCardHtml({ eyebrow, title, note: note === title ? "" : note, details, tone });
  }).filter(Boolean);
  if (!cards.length) {
    return `<section class="premarket-projection" data-premarket-projection="index-tomorrow-plan" data-flow-role="index-tomorrow-paths"><div class="premarket-projection-heading"><div><h4>明日可能路径</h4><p>只展示规则条件，不展示概率百分比。</p></div></div><div class="empty-state">明日路径证据不足，暂不生成方向承诺。</div></section>`;
  }
  return `<div data-flow-role="index-tomorrow-paths">${premarketProjectionSectionHtml("index-tomorrow-plan", "明日可能路径", "主路径、向上修正和向下修正只按条件验证，不展示概率百分比。", cards)}</div>`;
}

function premarketIndexActionText(step) {
  const plan = step && step.indexTomorrowPlan && typeof step.indexTomorrowPlan === "object"
    ? step.indexTomorrowPlan
    : {};
  const positionPermission = step && step.positionPermission && typeof step.positionPermission === "object"
    ? step.positionPermission
    : {};
  const tradeWindow = step && step.tradeWindow && typeof step.tradeWindow === "object" ? step.tradeWindow : {};
  const blocked = Boolean(
    step && (step.status === "blocked" || step.permission === "blocked")
    || positionPermission.allowNew === false
    || tradeWindow.allowNew === false,
  );
  if (blocked) return "当前权限只允许观察，暂不新开仓；等待下一次质量校验与开盘验证。";
  const action = premarketIndexPlanText(plan.action, "");
  const permission = premarketStepImpact(step);
  return action ? `${action}${permission && permission !== action ? ` ${permission}` : ""}` : permission;
}

function premarketIndexActionHtml(step) {
  const plan = step && step.indexTomorrowPlan && typeof step.indexTomorrowPlan === "object"
    ? step.indexTomorrowPlan
    : {};
  const status = premarketStatusMeta(step);
  const rhythm = premarketIndexPlanText(plan.executionRhythm, "");
  const actionSource = plan.action && typeof plan.action === "object" ? plan.action : {};
  const checkpoints = premarketIndexPlanRows(actionSource.checkpoints || plan.checkpoints);
  return `
    <section class="premarket-index-action-card ${status.className}" data-flow-role="handoff">
      <span>怎么办</span>
      <strong>${escapeHtml(premarketIndexActionText(step))}</strong>
      ${rhythm ? `<p>执行节奏：${escapeHtml(rhythm)}</p>` : ""}
      ${checkpoints.length ? `<p>复核：${checkpoints.map((item) => escapeHtml(item)).join("、")}</p>` : ""}
    </section>
  `;
}

function premarketIndexProjectionHtml(step) {
  const opportunities = (Array.isArray(step && step.opportunities) ? step.opportunities : [])
    .filter((item) => item && typeof item === "object");
  const warnings = (Array.isArray(step && step.warnings) ? step.warnings : [])
    .filter((item) => item && typeof item === "object");
  const tomorrowPaths = (Array.isArray(step && step.tomorrowPaths) ? step.tomorrowPaths : [])
    .filter((item) => item && typeof item === "object").slice(0, 3);
  const plainOpportunity = (item) => {
    if (item.key === "medium_upgrade_confirmation") {
      return {
        title: "大盘进一步走强",
        note: "多数主要指数继续一起走强才算成立；如果重新明显转弱，就放弃。",
      };
    }
    if (item.key === "short_main_rise_ma5_support") {
      return {
        title: "强势指数回调后重新稳住",
        note: "回调没有破坏整体上升趋势并重新走强，可以继续关注；趋势被破坏就放弃。",
      };
    }
    const trigger = premarketTextRows(item.trigger)[0];
    const cancel = premarketTextRows(item.cancel)[0];
    return {
      title: premarketPlainIndexText(item.label || item.title || "指数机会待确认"),
      note: [
        trigger ? `成立：${premarketPlainIndexText(trigger)}` : premarketPlainIndexText(item.action || "等待确认"),
        cancel ? `放弃：${premarketPlainIndexText(cancel)}` : "",
      ].filter(Boolean).join("；"),
    };
  };
  const opportunityCards = opportunities.slice(0, 2).map((item) => {
    const plain = plainOpportunity(item);
    return premarketProjectionCardHtml({
      eyebrow: "机会",
      title: plain.title,
      note: plain.note,
      tone: item.status === "active" ? "good" : "muted",
    });
  });
  const primaryWarning = warnings[0] || (step && step.invalidation ? {
    label: "停止交易的红线",
    detail: step.invalidation,
  } : null);
  const warningCards = primaryWarning ? [premarketProjectionCardHtml({
    eyebrow: "红线",
    title: primaryWarning.key === "medium_not_confirmed"
      ? "现在还不是全面主升，不能放大仓位"
      : premarketPlainIndexText(primaryWarning.label || "出现明显转弱就停止"),
    note: primaryWarning.key === "medium_not_confirmed"
      ? "指数虽然整体偏强，但强弱并不一致；如果多数指数一起转弱，就暂停新开仓。"
      : premarketPlainIndexText(primaryWarning.detail || primaryWarning.text || "市场明显转弱时暂停新开仓"),
    tone: "danger",
  })] : [];
  const detailedOpportunityCards = opportunities.map((item) => premarketProjectionCardHtml({
    eyebrow: item.status === "active" ? "当前机会" : "机会观察",
    title: item.label || item.title || "指数机会待确认",
    note: item.action || "等待触发条件",
    details: [
      ...premarketTextRows(item.targets).map((text) => `观察：${text}`),
      ...premarketTextRows(item.trigger).map((text) => `触发：${text}`),
      ...premarketTextRows(item.cancel).map((text) => `取消：${text}`),
    ],
    tone: item.status === "active" ? "good" : "muted",
  }));
  const pathCards = tomorrowPaths.map((path, index) => premarketProjectionCardHtml({
    eyebrow: `明日路径 ${index + 1}`,
    title: path.label || "路径待确认",
    note: path.result || path.action || "等待验证",
    details: premarketTextRows(path.conditions || path.trigger).map((text) => `验证：${text}`),
    tone: path.permission === "downgrade" ? "danger" : path.permission === "upgrade" ? "good" : "muted",
  }));
  const mediumTerm = step && step.mediumTerm || {};
  const shortTerm = step && step.shortTerm || {};
  const intradayRhythm = step && step.intradayRhythm || {};
  const marketConsensus = step && step.marketConsensus || {};
  const externalRisk = step && step.externalRisk || {};
  const detailMetricRows = [
    ["中期结构", mediumTerm.label || "--", "20/60日结构"],
    ["短周期", shortTerm.label || "--", "5日线与5日斜率判断短结构，当日OHLC只看节奏"],
    ["日内节奏", intradayRhythm.label || "--", intradayRhythm.confirmed === false ? "分时证据不足" : ""],
    ["市场共振", marketConsensus.label || "--", marketConsensus.confirmed === false ? "还不能当作全面主升" : ""],
    ["外围影响", externalRisk.label || "--", externalRisk.summary || "只调整风险，不单独决定交易"],
  ];
  const shortIndexes = shortTerm && Array.isArray(shortTerm.indexes) ? shortTerm.indexes : [];
  const mediumIndexes = mediumTerm && Array.isArray(mediumTerm.indexes) ? mediumTerm.indexes : [];
  const detailIndexRows = shortIndexes.slice(0, 4).map((item) => {
    const medium = mediumIndexes.find((row) => String(row && row.code || "") === String(item && item.code || "")) || {};
    return premarketItemHtml(
      item.name || item.code || "指数",
      item.label || item.trendLabel || "结构待确认",
      [medium.label, premarketFinite(item.changePct) === null ? null : premarketNumber(item.changePct, 2, "%")].filter(Boolean).join(" · "),
    );
  });
  const detailedHtml = `
    <details class="premarket-detail-disclosure">
      <summary><span>展开看完整规则依据</span><small>均线结构、旧规则机会与风险红线</small></summary>
      <div class="premarket-detail-disclosure-body">
        <div class="premarket-metric-grid">${detailMetricRows.map((row) => premarketMetricHtml(row[0], row[1], row[2])).join("")}</div>
        ${premarketProjectionSectionHtml("index-legacy-opportunities", "旧规则机会摘要", "仅作详细依据，不替代上方明日主路径。", opportunityCards)}
        ${premarketProjectionSectionHtml("index-warnings", "停止交易的条件", "保留最重要的一条风险红线。", warningCards)}
        ${premarketProjectionSectionHtml("index-all-opportunities", "完整机会依据", "原始触发条件与取消条件。", detailedOpportunityCards)}
        ${premarketProjectionSectionHtml("index-legacy-tomorrow-paths", "旧规则补充路径", "仅在详细依据中保留，不展示伪概率。", pathCards)}
        ${detailIndexRows.length ? `<div class="premarket-item-grid">${detailIndexRows.join("")}</div>` : ""}
      </div>
    </details>`;
  return [
    premarketIndexTomorrowPlanHtml(step),
    premarketIndexActionHtml(step),
    detailedHtml,
  ].join("");
}

function premarketPreferenceProjectionHtml(step) {
  const paths = step && step.paths && typeof step.paths === "object" ? step.paths : {};
  const pathDefinitions = [
    ["highTrend", "高位趋势"],
    ["lowLaunch", "低位启动"],
    ["boardEmotion", "连板情绪"],
  ];
  const execution = step && step.executionPreference && typeof step.executionPreference === "object"
    ? step.executionPreference
    : {};
  const methods = execution.methods && typeof execution.methods === "object"
    ? Object.values(execution.methods).filter((item) => item && typeof item === "object")
    : [];
  const observationRepresentatives = step && step.observationRepresentatives && typeof step.observationRepresentatives === "object"
    ? step.observationRepresentatives
    : {};
  const dominant = step && step.dominantPath && typeof step.dominantPath === "object" ? step.dominantPath : {};
  const persistent = step && step.persistentPreference && typeof step.persistentPreference === "object"
    ? step.persistentPreference
    : {};
  const lossEffect = step && step.lossEffect && typeof step.lossEffect === "object" ? step.lossEffect : {};
  const persistencePaths = persistent.paths && typeof persistent.paths === "object" ? persistent.paths : {};
  const persistentPrimary = persistent.primaryPath && typeof persistent.primaryPath === "object" ? persistent.primaryPath : {};
  const switchLabel = {
    initial_persistent_confirmation: "持续偏好已确认",
    incumbent_retained: "原偏好继续保持",
    challenger_observed: "新风格观察中",
    confirmed_switch: "风格切换已确认",
    incumbent_loss_without_challenger: "原偏好转弱，暂无替代",
    parallel_persistent_profit: "两种风格持续并行",
    not_ready: "持续样本积累中",
  }[persistent.switchState] || "持续样本积累中";
  const persistenceSummaryHtml = Number(persistent.version || 0) >= 1 ? `
    <section class="style-persistence-summary" data-style-persistence-status="${escapeHtml(persistent.status || "unknown")}">
      <article><span>持续赚钱偏好</span><strong>${escapeHtml(persistentPrimary.label || "尚未确认")}</strong><small>${escapeHtml(persistent.conclusion || "至少需要3个有效T+1窗口")}</small></article>
      <article><span>风格切换</span><strong>${escapeHtml(switchLabel)}</strong><small>单日强弱不会切换正式偏好</small></article>
      <article class="is-loss"><span>持续亏钱效应</span><strong>${escapeHtml(lossEffect.headline || "样本积累中")}</strong><small>${escapeHtml(lossEffect.definition || "只统计买入后的T+1负反馈")}</small></article>
    </section>` : "";
  const t1EffectCards = pathDefinitions.map(([key, fallback]) => {
    const effect = persistencePaths[key] && typeof persistencePaths[key] === "object" ? persistencePaths[key] : {};
    const validDays = premarketFinite(effect.validDays);
    const matched = premarketFinite(effect.totalMatchedSamples);
    const closeMedian = premarketFinite(effect.medianNextClosePct);
    const chaseMedian = premarketFinite(effect.medianOpenToClosePct);
    const negativeRate = premarketFinite(effect.negativeRate);
    return premarketProjectionCardHtml({
      eyebrow: `${effect.label || fallback} · T+1效果`,
      title: effect.persistentLoss ? "持续亏钱" : effect.persistentProfit ? "持续赚钱" : "样本积累/混合",
      note: validDays === null ? "暂无可用收盘窗口" : `${validDays}/${effect.requiredDays || 3}个有效窗口 · ${matched || 0}个股票日`,
      details: [
        closeMedian === null ? "隔日持有反馈待确认" : `T收→T+1收中位：${premarketNumber(closeMedian, 2, "%")}`,
        chaseMedian === null ? "次日追入反馈待确认" : `T+1开→收中位：${premarketNumber(chaseMedian, 2, "%")}`,
        negativeRate === null ? "负反馈率待确认" : `T+1负反馈率：${premarketNumber(negativeRate * 100, 1, "%")}`,
        effect.latestEvidence || "等待冻结样本完成T+1结算",
      ],
      tone: effect.persistentLoss ? "danger" : effect.persistentProfit ? "good" : "muted",
    });
  });
  const dominantKeys = Array.isArray(dominant.paths) && dominant.paths.length
    ? dominant.paths.filter((key) => pathDefinitions.some(([pathKey]) => pathKey === key))
    : pathDefinitions.some(([key]) => key === dominant.key) ? [dominant.key] : [];
  const allObservationRows = pathDefinitions.flatMap(([key, fallback]) => (
    Array.isArray(observationRepresentatives[key])
      ? observationRepresentatives[key].map((item) => ({ item, key, pathLabel: fallback }))
      : []
  ));
  const exampleRows = [];
  const exampleSeen = new Set();
  const addExample = (row) => {
    const key = String(row && row.item && (row.item.code || row.item.name) || "").trim();
    if (!key || exampleSeen.has(key) || exampleRows.length >= 3) return;
    exampleSeen.add(key);
    exampleRows.push(row);
  };
  dominantKeys.forEach((key) => addExample(allObservationRows.find((row) => row.key === key)));
  allObservationRows
    .slice()
    .sort((left, right) => {
      const leftRank = Math.min(premarketFinite(left.item.eastRank) ?? 999, premarketFinite(left.item.thsRank) ?? 999);
      const rightRank = Math.min(premarketFinite(right.item.eastRank) ?? 999, premarketFinite(right.item.thsRank) ?? 999);
      return leftRank - rightRank;
    })
    .forEach(addExample);
  const exampleCards = exampleRows.map(({ item, key, pathLabel }) => {
    const eastRank = premarketFinite(item.eastRank);
    const thsRank = premarketFinite(item.thsRank);
    const boardCount = premarketFinite(item.consecutiveBoards);
    const rankFact = eastRank !== null && thsRank !== null
      ? `东方财富第${eastRank}、同花顺第${thsRank}`
      : eastRank !== null ? `东方财富第${eastRank}` : thsRank !== null ? `同花顺第${thsRank}` : "热榜名次还要确认";
    const eventFact = boardCount !== null && boardCount >= 2
      ? `${boardCount}连板，${rankFact}`
      : boardCount === 1
        ? `刚启动涨停，${rankFact}`
        : premarketFinite(item.changePct) !== null
          ? `当日涨跌${premarketNumber(item.changePct, 2, "%")}，${rankFact}`
          : rankFact;
    const meaning = key === "boardEmotion"
      ? "说明连板人气股仍有资金关注"
      : key === "lowLaunch"
        ? "说明低位新启动也有资金参与"
        : "说明高位趋势方向仍有人关注，但是否能买还要等买点";
    return premarketProjectionCardHtml({
      eyebrow: `${premarketPlainPreferenceText(pathLabel)}代表`,
      title: `${item.name || "--"}${item.code ? ` ${item.code}` : ""}`,
      theme: item.concept || item.direction || "题材待确认",
      note: `${eventFact}，${meaning}。`,
      details: [
        item.note || "用于验证市场资金偏好",
        "这只是市场例子，不等于可以买；还要继续通过题材、情绪和买点筛选。",
      ],
      tone: dominantKeys.includes(key) ? "good" : "muted",
    });
  });
  const preferredMethod = methods.find((item) => item.status === "preferred")
    || methods.find((item) => item.label === execution.primary)
    || null;
  const avoidedMethod = methods.find((item) => item.status === "avoid") || null;
  const persistentPreferenceConfirmed = Boolean(persistentPrimary.label)
    && ["confirmed", "retained", "switched", "parallel"].includes(String(persistent.status || ""));
  const preferredTitle = !persistentPreferenceConfirmed
    ? "只记录今日风格，不据此开仓"
    : preferredMethod && preferredMethod.label === "回封"
    ? "等最强股充分成交后重新封住，再考虑小仓参与"
    : preferredMethod && preferredMethod.label === "追板"
      ? "只看最先启动、确认走强的核心股"
      : preferredMethod && preferredMethod.label === "低吸"
        ? "只在核心股回落后稳住时考虑低吸"
        : premarketPlainPreferenceText(preferredMethod && (preferredMethod.reasons || preferredMethod.label) || "等核心股出现清楚买点再做");
  const avoidedTitle = premarketPlainPreferenceText(
    avoidedMethod && avoidedMethod.reasons && avoidedMethod.reasons[0]
      || "不追跟风股，也不因为热榜靠前就直接买入",
  );
  const actionCards = [
    premarketProjectionCardHtml({
      eyebrow: "明天怎么做",
      title: preferredTitle,
      note: persistentPreferenceConfirmed
        ? "持续偏好、题材方向和核心股要同时对得上，少一个条件都先等。"
        : "至少积累3个有效T+1窗口后，才允许持续偏好参与选股。",
      tone: "good",
    }),
    premarketProjectionCardHtml({
      eyebrow: "明天先回避",
      title: avoidedTitle,
      note: "跟风股即使上涨，也不能代替核心股确认方向。",
      tone: "danger",
    }),
  ];
  const pathCards = pathDefinitions.map(([key, fallback]) => {
    const path = paths[key] && typeof paths[key] === "object" ? paths[key] : {};
    const sample = premarketFinite(path.sampleCount);
    return premarketProjectionCardHtml({
      eyebrow: path.label || fallback,
      title: `${premarketRuleScore(path.score)} · ${path.statusLabel || "待确认"}`,
      note: [path.stageLabel, sample === null ? null : `${sample}只独立样本`].filter(Boolean).join(" · ") || "证据待确认",
      details: path.evidence,
      tone: path.status === "active" ? "good" : path.status === "candidate" ? "warn" : "muted",
    });
  });
  const methodCards = methods.map((item) => premarketProjectionCardHtml({
    eyebrow: item.statusLabel || "执行手法",
    title: `${item.label || "手法待确认"} · ${premarketRuleScore(item.score)}`,
    note: item.label === execution.primary ? "当前首选手法" : "条件满足后才执行",
    details: item.reasons,
    tone: item.status === "preferred" ? "good" : item.status === "avoid" ? "danger" : "muted",
  }));
  const observationCards = allObservationRows.slice(0, 9).map(({ item, key, pathLabel }) => {
    const eastRank = premarketFinite(item.eastRank);
    const thsRank = premarketFinite(item.thsRank);
    const boardCount = premarketFinite(item.consecutiveBoards);
    const rankText = [
      eastRank === null ? null : `东财第${eastRank}`,
      thsRank === null ? null : `同花顺第${thsRank}`,
    ].filter(Boolean).join(" · ") || "热榜名次待确认";
    const isDominant = dominantKeys.includes(key);
    return premarketProjectionCardHtml({
      eyebrow: isDominant ? "当前偏好代表" : "其他路径代表",
      title: `${item.name || "--"}${item.code ? ` ${item.code}` : ""}`,
      theme: item.concept || item.direction || "题材待确认",
      note: [pathLabel, boardCount && boardCount > 0 ? `${boardCount}连板` : null, rankText].filter(Boolean).join(" · "),
      details: [
        item.note || "用于验证市场资金风格",
        "观察代表只参与风格判断；未通过个股执行门槛前，不等于买入推荐。",
      ],
      tone: isDominant ? "warn" : "muted",
    });
  });
  const representatives = step && step.representatives && typeof step.representatives === "object"
    ? step.representatives
    : {};
  const directionPermission = step && step.directionPermission && typeof step.directionPermission === "object"
    ? step.directionPermission
    : {};
  const primaryCarrierCodes = new Set(Array.isArray(directionPermission.primaryEligibleCarrierCodes)
    ? directionPermission.primaryEligibleCarrierCodes.map((code) => String(code || "").trim()).filter(Boolean)
    : []);
  const contingencyCarrierCodes = new Set(Array.isArray(directionPermission.contingencyEligibleCarrierCodes)
    ? directionPermission.contingencyEligibleCarrierCodes.map((code) => String(code || "").trim()).filter(Boolean)
    : []);
  const representativeCards = pathDefinitions.flatMap(([key, fallback]) => (
    Array.isArray(representatives[key]) ? representatives[key].map((item) => ({ item, pathLabel: fallback })) : []
  )).filter((item) => {
    const gate = item && item.item && item.item.qualification;
    return gate && gate.selected === true && gate.gamePlan === true
      && gate.leadership === true && gate.realConcept === true;
  }).slice(0, 9).map(({ item, pathLabel }) => {
    const code = String(item.code || "").trim();
    const isPrimaryCarrier = primaryCarrierCodes.has(code);
    const isContingencyCarrier = !isPrimaryCarrier && contingencyCarrierCodes.has(code);
    return premarketProjectionCardHtml({
      eyebrow: isPrimaryCarrier ? "主路径载体" : isContingencyCarrier ? "次级路径观察" : "严格合格代表·未授权",
      title: `${item.name || "--"}${code ? ` ${code}` : ""}`,
      theme: item.concept || item.direction || "题材待确认",
      note: [pathLabel, item.concept, item.role, premarketFinite(item.consecutiveBoards ?? item.boardCount) > 0
        ? `${item.consecutiveBoards ?? item.boardCount}连板`
        : null].filter(Boolean).join(" · "),
      details: [
        "已通过 selected、gamePlan、leadership 与真实概念归属四道门槛",
        isContingencyCarrier ? "仅属于次级路径；路径切换前不是当前主选" : !isPrimaryCarrier ? "未获得当前路径执行授权" : "已进入当前主路径载体白名单",
      ],
      tone: isPrimaryCarrier && step.status !== "blocked" ? "good" : isContingencyCarrier ? "warn" : "muted",
    });
  });
  if (!representativeCards.length) {
    representativeCards.push(premarketProjectionCardHtml({
      eyebrow: "严格合格代表",
      title: "当前暂无合格案例",
      note: "不使用后排、未入选或概念错配个股补位。",
      tone: "muted",
    }));
  }
  const opportunityCards = (Array.isArray(step && step.opportunities) ? step.opportunities : [])
    .filter((item) => item && typeof item === "object").slice(0, 4).map((item) => premarketProjectionCardHtml({
    eyebrow: "机会点",
    title: item.title || item.label || "机会待确认",
    note: item.action || "等待触发",
    details: [
      ...premarketTextRows(item.trigger).map((text) => `触发：${text}`),
      ...premarketTextRows(item.cancel).map((text) => `取消：${text}`),
    ],
    tone: "good",
  }));
  const cautionCards = (Array.isArray(step && step.cautions) ? step.cautions : [])
    .filter((item) => item && typeof item === "object").slice(0, 5).map((item) => premarketProjectionCardHtml({
    eyebrow: "注意事项",
    title: item.text || item.label || "风险提醒",
    note: item.level === "high" ? "高优先级红线" : "执行时复核",
    tone: item.level === "high" ? "danger" : "warn",
  }));
  const tomorrowCards = (Array.isArray(step && step.tomorrowPaths) ? step.tomorrowPaths : [])
    .filter((item) => item && typeof item === "object").slice(0, 3).map((item, index) => premarketProjectionCardHtml({
    eyebrow: `明日路径 ${index + 1}`,
    title: item.label || "路径待确认",
    note: item.outcome || item.action || "等待验证",
    details: premarketTextRows(item.verify || item.trigger).map((text) => `验证：${text}`),
    tone: item.key === "all_fail" ? "danger" : item.key === "strengthen" ? "good" : "warn",
  }));
  const sourceCoverage = step && step.sourceCoverage && typeof step.sourceCoverage === "object" ? step.sourceCoverage : {};
  const quotePending = premarketFinite(sourceCoverage.quotePending);
  const quotePendingText = quotePending === null
    ? "缺报价不会按0%计分"
    : sourceCoverage.observationPhase === "preopen"
      ? `${quotePending}只盘前报价待形成；不按0%计分`
      : `${quotePending}只实时报价暂缺；不按0%计分`;
  const coverageRows = [
    ["东方财富热榜", `${premarketFinite(sourceCoverage.eastmoneyCount ?? sourceCoverage.east) ?? "--"}只`, "最多读取前100"],
    ["同花顺热榜", `${premarketFinite(sourceCoverage.thsCount ?? sourceCoverage.ths) ?? "--"}只`, "最多读取前100"],
    ["去重样本", `${premarketFinite(sourceCoverage.unionCount ?? sourceCoverage.union) ?? "--"}只`, `${premarketFinite(sourceCoverage.crossListedCount ?? sourceCoverage.intersection) ?? "--"}只同时进入两榜`],
    ["行情报价", `${premarketFinite(sourceCoverage.quoteKnownCount ?? sourceCoverage.quoteUsable) ?? "--"}只可用`, quotePendingText],
  ];
  const detailHtml = `
    <details class="premarket-detail-disclosure">
      <summary><span>查看分数、热榜覆盖和完整证据</span><small>内部核验信息默认收起</small></summary>
      <div class="premarket-detail-disclosure-body">
        <div class="premarket-metric-grid">${coverageRows.map((row) => premarketMetricHtml(row[0], row[1], row[2])).join("")}</div>
        ${premarketProjectionSectionHtml("preference-paths", "三条资金路径评分", "统一采用百分制，证据数量不直接加分。", pathCards)}
        ${premarketProjectionSectionHtml("preference-observation-representatives", "全部市场观察代表", "只用来解释资金偏好，不等于买入推荐。", observationCards)}
        ${premarketProjectionSectionHtml("preference-methods", "执行手法评分", execution.summary || "按当前资金偏好选择手法。", methodCards)}
        ${premarketProjectionSectionHtml("preference-representatives", "严格合格代表", "只展示通过全部资格门槛的股票。", representativeCards)}
        ${premarketProjectionSectionHtml("preference-opportunities", "完整机会点", "仍要同时满足路径与个股资格。", opportunityCards)}
        ${premarketProjectionSectionHtml("preference-cautions", "完整注意事项", "单只股票不能定义整个市场风格。", cautionCards)}
        ${premarketProjectionSectionHtml("preference-tomorrow-paths", "明日路径与验证", "加强、正常兑现和明显转弱分别验证。", tomorrowCards)}
      </div>
    </details>`;
  return [
    persistenceSummaryHtml,
    premarketProjectionSectionHtml("preference-t1-effects", "三类风格的T+1赚钱 / 亏钱效应", "T日收盘冻结样本，T+1收盘结算；不把当天涨跌冒充偏好。", t1EffectCards),
    premarketProjectionSectionHtml("preference-real-examples", "三个今日观察例子", "只解释当天发生了什么，不直接改变持续偏好。", exampleCards),
    premarketProjectionSectionHtml("preference-actions", "明天怎么应对", "先看怎么做，再看什么不能做。", actionCards),
    detailHtml,
  ].join("");
}

function premarketPlainEmotionText(value) {
  let text = premarketValueText(value, "");
  if (!text) return "";
  const exactReplacements = [
    ["前置分歧或退潮后，至少两只A/B锚形成真实承接并获得广度确认", "前面有过分歧或行情转弱，现在至少两只重点股已经稳住，而且有更多股票跟着走强"],
    ["多只A层主锚进入高热区，且多角色广度确认高潮", "多只人气核心股一起走强，板块里也有更多股票跟涨，已经进入高潮"],
    ["已有真实承接，仍需多锚同步才能升级", "现在买盘已经能接住，但还要看到多只重点股一起走强，才算行情进一步变强"],
    ["承接确认后再加强", "先确认买盘接得住，再看能不能继续走强"],
    ["承接确认后条件允许", "确认买盘接得住后，才可以按条件操作"],
    ["承接后重新加速", "稳住以后继续走强"],
    ["分歧兑现并验证承接", "强势股有人卖出，再看买盘能不能接住"],
    ["转入非良性分歧/退潮", "亏钱效应扩大，行情开始转弱"],
    ["换手开板后回封", "涨停打开并换手后，又重新封住涨停"],
    ["非一字换手封板", "经过换手后封住涨停"],
    ["非一字涨停换手封板", "经过换手后封住涨停"],
    ["有效价格发现", "盘中有真实买卖和换手"],
    ["一字/无价格发现", "一字封死，几乎没有成交换手"],
    ["价格全程锁定且无换手开板记录", "全天封死涨停，几乎没有真实换手"],
    ["开板后收于涨停；精确开板次数待分时确认", "涨停打开后最终重新封住，具体开板次数还要看分时数据"],
    ["只做主锚确认或充分换手后的分歧转强，不追一字和后排一致。", "只考虑最强的重点股，等充分换手并重新走强后再买；不追一字涨停，也不买跟风股。"],
    ["先观察主升内分歧；真实承接成立后才允许重新一致或核心试错。", "先看强势股回落时有没有人接；只有重新稳住，才考虑小仓位尝试最强股。"],
    ["停止新开仓，只处理持仓风险；等待新的跨日承接状态。", "停止新开仓，只处理已有持仓；等下一个交易日确认有资金接盘后再说。"],
    ["至少3个独立样本继续有效，A/B锚不少于2只且覆盖2种角色", "至少3只不同类型的代表股保持强势，其中至少2只是人气核心股或大成交核心股"],
    ["已知承接分不下降，非一字核心出现真实换手或回封", "已经有人接盘的股票不能转弱，同时至少一只非一字核心股要经过换手或重新封板"],
    ["伤害分不向更多核心扩散", "亏钱不能向更多重点股扩散"],
    ["承接仍为unknown却直接高开加速", "还没看清有没有人接盘，就直接高开加速"],
    ["高伤害核心增加", "明显走弱的重点股变多"],
  ];
  exactReplacements.forEach(([source, target]) => {
    text = text.split(source).join(target);
  });
  const phraseReplacements = [
    [/赚钱效应分=人气([\d.]+)\+连续性([\d.]+)\+价格发现([\d.]+)\+结果([\d.]+)/g, "赚钱表现由人气$1分、持续性$2分、真实换手$3分和收盘结果$4分组成"],
    [/市场影响权重/g, "对市场影响"],
    [/赚钱效应权重/g, "赚钱示范作用"],
    [/价格发现/g, "实际成交表现"],
    [/赚钱效应/g, "赚钱表现"],
    [/H\s*热度/g, "市场热度"],
    [/C\s*承接/g, "接盘力度"],
    [/D\s*伤害/g, "亏钱风险"],
    [/规则分/g, "分数"],
    [/A\/B锚/g, "最重要的人气股或大成交核心股"],
    [/A层主锚/g, "最重要的人气股"],
    [/B层主锚/g, "大成交核心股"],
    [/C层广度/g, "跟随股的整体表现"],
    [/A层/g, "最重要的人气股"],
    [/B层/g, "大成交核心股"],
    [/C层/g, "跟随观察股"],
    [/观察锚/g, "观察代表股"],
    [/主锚/g, "重点股"],
    [/多锚/g, "多只重点股"],
    [/锚点/g, "代表股"],
    [/情绪锚/g, "人气代表股"],
    [/锚/g, "重点股"],
    [/广度确认/g, "有更多股票跟随"],
    [/广度/g, "跟随股票的数量"],
    [/真实承接/g, "买盘真正接住"],
    [/承接位/g, "企稳的位置"],
    [/均价承接/g, "均价附近能否稳住"],
    [/承接/g, "买盘接得住"],
    [/前置分歧/g, "前面先出现分歧"],
    [/退潮/g, "行情转弱"],
    [/高热区/g, "很强势的状态"],
    [/高热/g, "很强势"],
    [/高伤害核心/g, "亏钱风险较大的重点股"],
    [/高伤害/g, "亏钱风险较大"],
    [/伤害分/g, "亏钱风险"],
    [/负反馈/g, "亏钱效应"],
    [/独立样本/g, "不同的股票"],
    [/样本/g, "股票"],
    [/角色/g, "类型"],
    [/真实换手/g, "有充分的成交换手"],
    [/充分换手/g, "成交充分"],
    [/非一字涨停换手封板/g, "经过换手后封住涨停"],
    [/回封/g, "炸板后重新封住涨停"],
    [/一字(?!涨停)/g, "一字涨停"],
    [/兑现/g, "资金卖出"],
    [/主升内分歧/g, "上涨过程中的分歧"],
    [/核心试错/g, "小仓位尝试最强股"],
    [/容量确认/g, "大成交核心股的表现"],
    [/跨日/g, "下一交易日"],
    [/unknown/g, "还看不清"],
  ];
  phraseReplacements.forEach(([pattern, target]) => {
    text = text.replace(pattern, target);
  });
  return text;
}

function premarketEmotionLayerLabel(layer) {
  return ({
    A: "最重要的人气股",
    B: "大成交核心股",
    C: "跟随观察股",
  })[String(layer || "").toUpperCase()] || "观察股";
}

function premarketEmotionStageLabel(key, fallback = "") {
  return ({
    acceleration: "多只人气股正在一起走强",
    climax: "市场已经非常火热",
    realization: "强势股开始有人卖出",
    support: "买盘正在接住卖盘",
    harmful: "亏钱效应正在扩大",
    retreat: "行情已经转弱",
    unknown: "目前还看不清",
  })[String(key || "")] || premarketPlainEmotionText(fallback) || "目前还看不清";
}

function premarketEmotionConclusion(step) {
  const current = step && step.currentEmotion && typeof step.currentEmotion === "object"
    ? step.currentEmotion
    : {};
  return ({
    acceleration: "多只重要人气股正在一起走强，行情还在加速，但不要追已经涨高的跟随股。",
    climax: "市场已经很热，多只重要人气股都在高位，明天先防冲高回落和炸板。",
    realization: "强势股开始有人卖出，先看重点股回落时有没有买盘接住。",
    support: "现在至少两只重点股已经稳住，也有更多股票跟着走强，市场接盘情况正在变好。",
    harmful: "至少两只重点股明显走弱，亏钱效应正在扩大，先不要急着开新仓。",
    retreat: "亏钱效应还在扩大，行情已经转弱，先控制仓位，等重点股重新稳住。",
    unknown: "目前还看不清市场处在哪个阶段，先观察，不急着下单。",
  })[String(current.key || "unknown")] || premarketPlainEmotionText(current.reason) || "目前还看不清，先观察，不急着下单。";
}

function premarketEmotionProjectionHtml(step) {
  const layerRank = { A: 0, B: 1, C: 2 };
  const pctText = (value) => {
    const pct = premarketFinite(value);
    return pct === null ? "待确认" : `${pct}%`;
  };
  const discoveryLabel = (item) => {
    const explicit = item && item.priceDiscovery && item.priceDiscovery.label;
    if (explicit) return premarketPlainEmotionText(explicit);
    const labels = {
      turnover_reseal: "开板后有成交，再次封住涨停",
      turnover_limit: "不是一字涨停，经过成交后封住涨停",
      active_price_discovery: "盘中有真实买卖",
      one_word: "一字涨停，几乎没有换手机会",
      unknown: "实际成交表现还看不清",
    };
    return labels[item && item.priceDiscoveryType] || "实际成交表现还看不清";
  };
  const countText = (value) => {
    const count = premarketFinite(value);
    return count === null ? "待确认" : `${count}只`;
  };
  const allAnchors = (Array.isArray(step && step.rankedAnchors) ? step.rankedAnchors : [])
    .filter((item) => item && item.excludedFromMarketState !== true)
    .slice()
    .sort((left, right) => (
      (layerRank[left.layer] ?? 3) - (layerRank[right.layer] ?? 3)
      || (premarketFinite(right.influenceWeightPct) ?? -1) - (premarketFinite(left.influenceWeightPct) ?? -1)
      || (premarketFinite(right.anchorScore) ?? -1) - (premarketFinite(left.anchorScore) ?? -1)
    ));
  const anchors = allAnchors.slice(0, 9);
  const isolatedAnchors = (Array.isArray(step && step.isolatedAnchors) ? step.isolatedAnchors : [])
    .filter((item) => item && premarketFinite(item.profitEffectScore) !== null)
    .slice()
    .sort((left, right) => (
      (premarketFinite(right.profitEffectScore) ?? -1) - (premarketFinite(left.profitEffectScore) ?? -1)
      || (premarketFinite(right.anchorScore) ?? -1) - (premarketFinite(left.anchorScore) ?? -1)
    ))
    .slice(0, 4);
  const anchorCards = anchors.map((item) => {
    const heat = premarketFinite(item.heat && item.heat.score);
    const support = premarketFinite(item.support && item.support.score);
    const damage = premarketFinite(item.damage && item.damage.score);
    return premarketProjectionCardHtml({
      eyebrow: premarketEmotionLayerLabel(item.layer),
      title: `${item.name || "--"}${item.code ? ` ${item.code}` : ""} · 当前强弱 ${premarketRuleScore(item.anchorScore)}`,
      theme: item.direction || item.concept || item.theme || "题材待确认",
      note: [
        `对市场影响 ${pctText(item.influenceWeightPct)}`,
        `市场热度 ${premarketRuleScore(heat)}`,
        `接盘力度 ${premarketRuleScore(support)}`,
        `亏钱风险 ${premarketRuleScore(damage)}`,
      ].filter(Boolean).join(" · "),
      details: [
        ...premarketTextRows(item.heat && item.heat.evidence).map((text) => `市场热度：${premarketPlainEmotionText(text)}`),
        ...premarketTextRows(item.support && item.support.evidence).map((text) => `接盘力度：${premarketPlainEmotionText(text)}`),
        ...premarketTextRows(item.damage && item.damage.evidence).map((text) => `亏钱风险：${premarketPlainEmotionText(text)}`),
      ],
      tone: item.layer === "A" ? "good" : item.layer === "B" ? "warn" : "muted",
    });
  });
  const profitCards = allAnchors
    .filter((item) => premarketFinite(item.profitEffectScore) !== null)
    .slice()
    .sort((left, right) => (
      (premarketFinite(right.profitEffectWeightPct) ?? -1) - (premarketFinite(left.profitEffectWeightPct) ?? -1)
      || (premarketFinite(right.profitEffectScore) ?? -1) - (premarketFinite(left.profitEffectScore) ?? -1)
    ))
    .slice(0, 5)
    .map((item, index) => premarketProjectionCardHtml({
      eyebrow: index === 0 ? "最能带动赚钱的代表股" : "其他赚钱代表股",
      title: `${item.name || "--"}${item.code ? ` ${item.code}` : ""} · 赚钱表现 ${premarketRuleScore(item.profitEffectScore)}`,
      theme: item.direction || item.concept || item.theme || "题材待确认",
      note: `${discoveryLabel(item)} · 赚钱示范作用 ${pctText(item.profitEffectWeightPct)} · 对市场影响 ${pctText(item.influenceWeightPct)}`,
      details: [
        ...premarketTextRows(item.priceDiscovery && item.priceDiscovery.evidence).map((text) => `实际成交表现：${premarketPlainEmotionText(text)}`),
        ...premarketTextRows(item.profitEffect && item.profitEffect.evidence).map((text) => `赚钱表现：${premarketPlainEmotionText(text)}`),
      ],
      tone: index === 0 ? "good" : item.priceDiscoveryType === "one_word" ? "warn" : "muted",
    }));
  const isolatedProfitCards = isolatedAnchors.map((item) => premarketProjectionCardHtml({
    eyebrow: "推荐股单独观察 · 不参与市场判断",
    title: `${item.name || "--"}${item.code ? ` ${item.code}` : ""} · 赚钱表现 ${premarketRuleScore(item.profitEffectScore)}`,
    theme: item.direction || item.concept || item.theme || "题材待确认",
    note: `${discoveryLabel(item)} · 该股不参与市场影响计算，也不能用自己证明自己的买点`,
    details: [
      ...premarketTextRows(item.priceDiscovery && item.priceDiscovery.evidence).map((text) => `实际成交表现：${premarketPlainEmotionText(text)}`),
      ...premarketTextRows(item.profitEffect && item.profitEffect.evidence).map((text) => `赚钱表现：${premarketPlainEmotionText(text)}`),
    ],
    tone: "warn",
  }));
  const marketStructure = step && step.marketStructure && typeof step.marketStructure === "object"
    ? step.marketStructure
    : {};
  const capacity = marketStructure.capacity && typeof marketStructure.capacity === "object"
    ? marketStructure.capacity
    : {};
  const themeStages = (Array.isArray(step && step.themeStages) ? step.themeStages : [])
    .filter((item) => item && typeof item === "object");
  const structureCards = themeStages.slice(0, 3).map((item) => {
    const primaryAnchorCount = premarketFinite(item.primaryAnchorCount);
    return premarketProjectionCardHtml({
      eyebrow: "板块当前情况",
      title: `${item.name || "未归类"} · ${premarketPlainEmotionText(item.current && item.current.label || "还看不清")}`,
      note: premarketPlainEmotionText(item.current && item.current.reason || (primaryAnchorCount === null ? "重点股数量还看不清" : `${primaryAnchorCount}只重点股已经确认`)),
      details: (Array.isArray(item.anchors) ? item.anchors : []).map((anchor) => (
        `${anchor.name || anchor.code || "--"} · ${premarketEmotionLayerLabel(anchor.layer)} · 当前强弱 ${premarketRuleScore(anchor.score)}`
      )),
      tone: item.current && item.current.key === "climax" ? "warn" : "muted",
    });
  });
  if (Object.keys(capacity).length) {
    const totalCount = premarketFinite(capacity.total);
    const supportedCount = premarketFinite(capacity.supportedCount);
    const damagedCount = premarketFinite(capacity.damagedCount);
    const unknownCount = premarketFinite(capacity.unknownCount);
    const neutralCount = totalCount === null
      ? null
      : Math.max(0, totalCount - (supportedCount ?? 0) - (damagedCount ?? 0) - (unknownCount ?? 0));
    structureCards.push(premarketProjectionCardHtml({
      eyebrow: "大成交股票情况",
      title: "大成交核心股整体表现",
      note: `大成交核心股共${countText(totalCount)}｜走稳${countText(supportedCount)}｜走弱${countText(damagedCount)}｜表现一般${countText(neutralCount)}｜数据不足${countText(unknownCount)}`,
      tone: capacity.key === "support" ? "good" : capacity.key === "negative" ? "danger" : "warn",
    }));
  }
  const paths = (Array.isArray(step && step.tomorrowPaths) ? step.tomorrowPaths : [])
    .filter((item) => item && typeof item === "object")
    .slice()
    .sort((left, right) => (premarketFinite(left.rank) ?? 99) - (premarketFinite(right.rank) ?? 99))
    .slice(0, 3);
  const pathCards = paths.map((item, index) => premarketProjectionCardHtml({
    eyebrow: item.isBaseline ? "明天最可能怎么走" : `另一种可能 ${index + 1}`,
    title: premarketPlainEmotionText(item.label || "还看不清"),
    note: premarketPlainEmotionText(item.action || "等待多只重点股一起确认"),
    details: [
      ...premarketTextRows(item.trigger).map((text) => `出现这些情况：${premarketPlainEmotionText(text)}`),
      ...premarketTextRows(item.cancel).map((text) => `不符合的情况：${premarketPlainEmotionText(text)}`),
    ],
    tone: item.key === "weaken" ? "danger" : item.isBaseline ? "warn" : "muted",
  }));
  return [
    premarketProjectionSectionHtml("emotion-structure", "哪些板块最热", "看热门板块里的强势股，以及大成交股票能不能稳住。", structureCards),
    premarketProjectionSectionHtml("emotion-isolated-anchors", "推荐股单独看", "推荐股的表现会照常显示，但不会拿它来给自己的买点作证明。", isolatedProfitCards),
    premarketProjectionSectionHtml("emotion-profit-effect", "赚钱代表股", "看谁真正让参与资金赚到钱，不会因为一字涨停板数高就给高分。", profitCards),
    premarketProjectionSectionHtml("emotion-anchors", "重点股现在强不强", "所有分数都是满分 100；证据多少不直接加分。", anchorCards),
    premarketProjectionSectionHtml("emotion-tomorrow-paths", "明天可能怎么走", "列出最可能和另外两种走势，并告诉你分别要看什么。", pathCards),
  ].join("");
}

function premarketStepProjectionHtml(step) {
  if (!step) return "";
  if (step.key === "indexOpportunity") return premarketIndexProjectionHtml(step);
  if (step.key === "tradingPreference" && step.preferenceVersion) return premarketPreferenceProjectionHtml(step);
  if (step.key === "emotionStage" && step.emotionVersion) return premarketEmotionProjectionHtml(step);
  return "";
}

function premarketStepImpact(step, payload = null) {
  if (!step) return "等待上游数据。";
  if (step.status === "blocked") return step.key === "emotionStage"
    ? "下一步先观察，暂时不给出买入操作。"
    : "当前只能先观察，后面不生成具体买入方案。";
  if (step.key === "indexOpportunity") {
    const position = premarketValueText(
      step.positionLimit || step.positionPermission && step.positionPermission.label || step.positionGuide,
      "指数许可范围",
    );
    return `后续所有选择都不得突破${position}。`;
  }
  if (step.key === "tradingPreference") {
    return "后面只看符合当前资金偏好的题材和核心股，不拿跟风股凑数。";
  }
  if (step.key === "emotionStage") {
    const permission = step.executionPermission || {};
    if (permission.status === "conditional") return "等重点股稳住、更多股票跟着走强后，才考虑按条件操作。";
    if (["blocked", "forbidden", "observe"].includes(permission.status)) return "先观察，不急着买；等市场重新稳住再判断。";
    return premarketPlainEmotionText(permission.label || step.action) || "根据市场现在是走强还是转弱，决定买入、低吸或继续等待。";
  }
  if (step.key === "direction") {
    const decision = step.subthemeDecision || {};
    const mainAttack = decision.mainAttackSubtheme || {};
    if (mainAttack.name) return `核心个股只从已确认主攻细分“${mainAttack.name}”中产生。`;
    if (decision.family && decision.family.name) return `保留“${decision.family.name}”家族观察，但没有唯一主攻细分时不向个股步骤授予方向资格。`;
    return "没有合格方向时，个股步骤不得补票。";
  }
  if (step.key === "stocks") {
    const names = (Array.isArray(step.candidates) ? step.candidates : [])
      .filter((item) => item && item.qualified === true)
      .map((item) => item && item.name)
      .filter(Boolean)
      .slice(0, 3);
    return names.length ? `只为 ${names.join("、")} 生成条件计划。` : "没有合格个股，买卖计划保持空仓。";
  }
  if (step.key === "tradePlan") {
    return premarketExecutablePlans(step, payload, { requireFresh: true }).length
      ? "次日只按触发条件执行，未触发就等待。"
      : "当前不具备生成可执行买卖点的条件。";
  }
  return premarketValueText(step.conclusion, "等待下一步。");
}

function premarketExecutablePlans(step, payload = null, options = {}) {
  const sanitizePlan = typeof sanitizeDecisionStockDecoration === "function"
    ? sanitizeDecisionStockDecoration
    : (value) => {
      const safe = value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
      delete safe.position;
      for (const key of ["stopLossPlan", "plan"]) {
        if (!safe[key] || typeof safe[key] !== "object" || Array.isArray(safe[key])) continue;
        safe[key] = { ...safe[key] };
        delete safe[key].position;
      }
      if (safe.card && typeof safe.card === "object" && !Array.isArray(safe.card)) {
        safe.card = { ...safe.card };
        if (safe.card.plan && typeof safe.card.plan === "object" && !Array.isArray(safe.card.plan)) {
          safe.card.plan = { ...safe.card.plan };
          delete safe.card.plan.position;
        }
      }
      return safe;
    };
  if (options.requireFresh === true && !premarketDirectBuyPayloadFresh(payload)) return [];
  const unifiedProjection = resolveUnifiedDecisionChainProjection(payload);
  if (!unifiedProjection.executionOpen) return [];
  const authorizedStocks = new Map(unifiedProjection.stocks.map((stock) => [
    String(stock && stock.code || "").trim().toUpperCase(),
    stock,
  ]));
  if (
    !step
    || step.key !== "tradePlan"
    || step.status !== "ready"
    || step.canIssueAdvice !== true
    || String(step.executionMode || "").trim() === "blocked"
    || !Array.isArray(step.plans)
  ) return [];
  const planCodes = step.plans.map((plan) => String(
    plan && typeof plan === "object" && !Array.isArray(plan)
      ? plan.code || plan.stockCode || plan.symbol || ""
      : "",
  ).trim().toUpperCase()).filter(Boolean);
  if (new Set(planCodes).size !== planCodes.length) return [];
  return step.plans.map((plan) => {
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) return false;
    const code = String(plan.code || plan.stockCode || plan.symbol || "").trim();
    if (!/^\d{6}$/.test(code)) return false;
    const canonicalStock = authorizedStocks.get(code.toUpperCase());
    if (!canonicalStock) return false;
    const lifecycleComplete = ["buy", "hold", "sell", "holdingPeriod"]
      .every((key) => Boolean(premarketValueText(plan[key], "").trim()));
    if (!lifecycleComplete || String(plan.executionMode || "").trim() === "blocked") return false;
    const conditional = [step.executionMode, plan.executionMode]
      .some((value) => String(value || "").trim() === "conditional_after_support");
    if (conditional && (
      !premarketValueText(plan.triggers, "").trim()
      || !premarketValueText(plan.cancelConditions, "").trim()
    )) return false;
    const sanitizedPlan = sanitizePlan(plan);
    return {
      ...sanitizedPlan,
      positionAllocation: canonicalStock.positionAllocation && typeof canonicalStock.positionAllocation === "object"
        ? { ...canonicalStock.positionAllocation }
        : null,
      selectionAuthority: "unified_decision_chain_v3",
    };
  }).filter(Boolean);
}

function premarketStepMetrics(step, payload = null) {
  if (!step) return [];
  if (step.key === "indexOpportunity") {
    const metrics = step.metrics || {};
    const forecast = step.forecast || {};
    const tradeWindow = step.tradeWindow || {};
    const mediumTerm = step.mediumTerm || {};
    const shortTerm = step.shortTerm || {};
    const intradayRhythm = step.intradayRhythm || {};
    const marketConsensus = step.marketConsensus || {};
    const positionPermission = step.positionPermission || {};
    const externalRisk = step.externalRisk || {};
    const permissionLabel = positionPermission.label || tradeWindow.label || ({
      allowed: "允许按计划交易",
      blocked: "指数条件不允许交易",
      unknown: "等待核心确认",
    }[step.permission] || "等待确认");
    if (step.regimeVersion) {
      return [
        ["明日仓位上限", step.positionLimit || positionPermission.label || "--", "指数只决定最多做多少，题材和个股还要继续筛选"],
      ];
    }
    return [
      ["指数结构", step.label || step.cycle || "--", step.verified === false ? "结构尚未验证" : "结构数据已读取"],
      ["交易许可", permissionLabel, tradeWindow.summary || step.positionGuide || ""],
      ["仓位上限", step.positionLimit || "--", step.positionGuide || ""],
      ["主要指数均值", premarketNumber(metrics.avgIndexChange, 2, "%"), ""],
      ["上涨覆盖率", metrics.breadth === null || metrics.breadth === undefined ? "--" : premarketNumber(Number(metrics.breadth) * 100, 1, "%"), ""],
      ["明日指数路径", forecast.primaryLabel ? `${forecast.primaryLabel}${premarketFinite(forecast.probability) === null ? "" : ` ${premarketNumber(forecast.probability, 0, "%")}`}` : "--", forecast.calibrated === false ? "规则先验，非历史胜率" : ""],
      ["外围修正", externalRisk.label || "--", externalRisk.summary || "只修正风险，不单独决定交易"],
    ];
  }
  if (step.key === "tradingPreference") {
    const organization = step.marketOrganization || {};
    const dominant = step.dominantPath || {};
    const permission = step.directionPermission || {};
    const sourceCoverage = step.sourceCoverage || {};
    if (step.preferenceVersion) {
      return [];
    }
    return [
      ["市场风格", step.style, ""],
      ["资金偏好", step.preference, step.bias || ""],
      ["持续性", step.continuity, ""],
      ["最聚焦方向", step.topDirection, ""],
    ];
  }
  if (step.key === "emotionStage") {
    const current = step.currentEmotion || {};
    const baseline = step.tomorrowBaseline || step.expectedTransition || {};
    const metrics = step.emotionMetrics || {};
    const heat = metrics.heat || {};
    const support = metrics.support || {};
    const damage = metrics.damage || {};
    if (step.emotionVersion) {
      return [
        ["市场现在怎样", premarketEmotionStageLabel(current.key, current.label || step.stageLabel), premarketPlainEmotionText(current.reason)],
        ["明天先看什么", premarketPlainEmotionText(baseline.label || "还看不清"), premarketPlainEmotionText(baseline.reason || "开盘前和开盘后还要继续观察")],
        ["市场热度", premarketRuleScore(heat.score), premarketFinite(heat.highAnchorCount) === null ? "" : `${heat.highAnchorCount}只股票很强势`],
        ["接盘力度", premarketRuleScore(support.score), premarketFinite(support.unknownCount) === null ? "" : `${support.unknownCount}只股票还看不清`],
        ["亏钱风险", premarketRuleScore(damage.score), premarketFinite(damage.harmfulAnchorCount) === null ? "" : `${damage.harmfulAnchorCount}只重点股亏钱风险较大`],
      ];
    }
    return [
      ["情绪周期", step.cycle, step.lightLabel || ""],
      ["核心阶段", step.stageLabel, ""],
      ["明日基础路径", baseline.label || "--", "盘前与早盘仍需验证"],
      ["分歧性质", premarketDivergenceText(step.divergence && step.divergence.size, step.divergence && step.divergence.quality), ""],
    ];
  }
  if (step.key === "direction") {
    const primary = step.primary || {};
    const decision = step.subthemeDecision || primary.subthemeDecision || {};
    const mainAttack = decision.mainAttackSubtheme || {};
    const currentBest = decision.todayBestSubtheme || decision.currentWinner || {};
    const auditBest = decision.currentBestSubtheme || decision.currentBest || {};
    const familyName = decision.family && decision.family.name || primary.family || primary.name || step.focusDirection;
    const blocked = step.status === "blocked" || (Array.isArray(step.blockedBy) && step.blockedBy.length > 0);
    return [
      ["主线家族", familyName || "待确认", decision.confirmedFamily && decision.confirmedFamily.state || primary.label || ""],
      ["今日最强细分", currentBest.name || "暂无", currentBest.name ? `${premarketFinite(currentBest.upRate) === null ? "上涨率待确认" : `上涨率${premarketNumber(currentBest.upRate * 100, 1, "%")}`} · 中位${premarketFinite(currentBest.medianChangePct) === null ? "--" : premarketNumber(currentBest.medianChangePct, 2, "%")}` : auditBest.name ? `最高分候选${auditBest.name}未通过完整门槛` : "没有细分通过完整证据读取"],
      [blocked ? "观察方向" : "主攻方向", mainAttack.name || "暂无唯一主攻细分", blocked ? "上游未授权，不作为主攻" : mainAttack.name ? `跨日确认${mainAttack.confirmationCount || 0}次` : decision.conclusion || "硬门槛或跨日确认不足"],
      ["家族样本", premarketFinite(primary.memberCount) === null ? "--" : `${primary.memberCount}只`, `家族涨停/高度${premarketFinite(primary.limitCount) === null ? "--" : `${primary.limitCount}只`}，不得计入单一细分`],
    ];
  }
  if (step.key === "stocks") {
    const rows = Array.isArray(step.candidates) ? step.candidates : [];
    const qualifiedRows = rows.filter((item) => item && item.qualified === true);
    return [
      ["合格候选", `${qualifiedRows.length}只`, rows.length > qualifiedRows.length ? `${rows.length - qualifiedRows.length}只仅观察` : ""],
      ["价格安全", step.unsafeCandidateCodes && step.unsafeCandidateCodes.length ? `${step.unsafeCandidateCodes.length}只异常` : "未发现异常", ""],
    ];
  }
  if (step.key === "tradePlan") {
    const rows = premarketExecutablePlans(step, payload, { requireFresh: true });
    return [
      ["可执行计划", `${rows.length}份`, ""],
      ["计划状态", rows.length ? "条件执行" : "不开新仓", ""],
    ];
  }
  return [];
}

function premarketStepItems(step) {
  if (!step) return [];
  if (step.key === "indexOpportunity") {
    if (step.regimeVersion) return [];
    const shortIndexes = step.shortTerm && Array.isArray(step.shortTerm.indexes) ? step.shortTerm.indexes : [];
    const mediumIndexes = step.mediumTerm && Array.isArray(step.mediumTerm.indexes) ? step.mediumTerm.indexes : [];
    const rows = shortIndexes.length ? shortIndexes : (Array.isArray(step.structures) ? step.structures : []);
    return rows.slice(0, 4).map((item) => {
      const medium = mediumIndexes.find((row) => String(row && row.code || "") === String(item && item.code || "")) || {};
      return [
        item.name || item.code || "指数",
        item.label || item.trendLabel || item.trendKey || "结构待确认",
        [
          medium.label,
          premarketFinite(item.changePct) === null ? null : premarketNumber(item.changePct, 2, "%"),
          premarketFinite(item.close) === null ? null : `收 ${premarketValueText(item.close)}`,
        ].filter(Boolean).join(" · "),
      ];
    });
  }
  if (step.key === "tradingPreference") {
    if (step.preferenceVersion) return [];
    return (Array.isArray(step.independentExamples) ? step.independentExamples : []).slice(0, 4).map((item) => [
      item.effectType || item.ticketType || "独立样本",
      `${item.name || "--"}${item.code ? ` ${item.code}` : ""}`,
      [item.role, item.concept, premarketFinite(item.changePct) === null ? null : premarketNumber(item.changePct, 2, "%")].filter(Boolean).join(" · "),
    ]);
  }
  if (step.key === "emotionStage") {
    if (step.emotionVersion) return [];
    const rows = step.independentCoreValidation && Array.isArray(step.independentCoreValidation.items)
      ? step.independentCoreValidation.items
      : [];
    const relevant = rows.filter((item) => item && item.stage && item.stage !== "unknown");
    return (relevant.length ? relevant : rows).slice(0, 8).map((item) => [
      item.stageLabel || "阶段待确认",
      `${item.name || "--"}${item.code ? ` ${item.code}` : ""}`,
      premarketFinite(item.impact) === null ? "" : `情绪权重 ${premarketNumber(item.impact, 0)}`,
    ]);
  }
  if (step.key === "direction") {
    return (Array.isArray(step.items) ? step.items : []).slice(0, 3).map((item) => [
      item.isCoreDirection ? "主方向" : item.label || "观察方向",
      item.name || item.displayName || "--",
      [item.resonanceLabel, item.dailyLabel, item.summary].filter(Boolean).join(" · "),
    ]);
  }
  if (step.key === "stocks") {
    return (Array.isArray(step.candidates) ? step.candidates : []).slice(0, 6).map((item) => [
      item.qualified === true ? "交易候选" : item.role || "观察",
      `${item.name || "--"}${item.code ? ` ${item.code}` : ""}`,
      [item.direction, item.identity, item.stateLabel, premarketFinite(item.changePct) === null ? null : premarketNumber(item.changePct, 2, "%")].filter(Boolean).join(" · "),
    ]);
  }
  return [];
}

function premarketPlanItems(step, payload = null) {
  const plans = premarketExecutablePlans(step, payload, { requireFresh: true });
  return plans.map((plan) => {
    const name = `${plan.name || "--"}${plan.code ? ` ${plan.code}` : ""}`;
    const buy = premarketValueText(plan.buy, "未形成买点");
    const hold = premarketValueText(plan.hold, "成交后再判断");
    const sell = premarketValueText(plan.sell, "按实际成本重算");
    const days = premarketValueText(plan.holdingPeriod, "持有期待确认");
    const triggers = premarketValueText(plan.triggers, "");
    const cancels = premarketValueText(plan.cancelConditions, "");
    return `
      <article class="premarket-item-card">
        <span>个股计划</span>
        <strong>${escapeHtml(name)}</strong>
        <p><b>买入：</b>${escapeHtml(buy)}</p>
        <p><b>持有：</b>${escapeHtml(hold)} · ${escapeHtml(days)}</p>
        <p><b>卖出：</b>${escapeHtml(sell)}</p>
        ${triggers ? `<p><b>触发：</b>${escapeHtml(triggers)}</p>` : ""}
        ${cancels ? `<p><b>取消：</b>${escapeHtml(cancels)}</p>` : ""}
      </article>
    `;
  }).join("");
}

function premarketDirectBuyPlans(step, payload) {
  const unifiedProjection = resolveUnifiedDecisionChainProjection(payload);
  if (!unifiedProjection.executionOpen) return [];
  const authorizedCodes = new Set(unifiedProjection.selectedCodes);
  const executablePlans = premarketExecutablePlans(step, payload, { requireFresh: true })
    .filter((plan) => authorizedCodes.has(String(plan && (plan.code || plan.stockCode || plan.symbol) || "").trim().toUpperCase()));
  const report = payload && payload.postCloseOpportunity && typeof payload.postCloseOpportunity === "object"
    ? payload.postCloseOpportunity
    : null;
  const marketPermission = report && report.marketPermission && typeof report.marketPermission === "object"
    ? report.marketPermission
    : null;
  const payloadGenerations = [
    payload && payload.premarketModels && payload.premarketModels.generationId,
    payload && payload.tomorrowDecision && payload.tomorrowDecision.generationId,
    payload && payload.recentIndexEmotionRelation && payload.recentIndexEmotionRelation.generationId,
  ].map(postCloseOpportunityText);
  const rootGeneration = premarketDirectBuyPayloadGeneration(payload);
  const reportGeneration = postCloseOpportunityText(report && report.generationId);
  const relationGeneration = postCloseOpportunityText(report && report.recentRelation && report.recentRelation.generationId);
  const reportOpportunitySource = postCloseOpportunityText(report && report.sources && report.sources.opportunityCards);
  if (
    !executablePlans.length
    || !report
    || report.status !== "opportunities"
    || !premarketDirectBuyPayloadFresh(payload)
    || !rootGeneration
    || payloadGenerations.some((generation) => !generation)
    || !reportGeneration
    || !relationGeneration
    || rootGeneration !== reportGeneration
    || relationGeneration !== reportGeneration
    || payloadGenerations.some((generation) => generation !== reportGeneration)
    || reportOpportunitySource !== "premarketFlow.tradePlan.plans"
    || !marketPermission
    || marketPermission.canCreateOpportunities !== true
    || !["allowed", "conditional"].includes(String(marketPermission.status || "").trim())
    || !report.noOpportunity
    || report.noOpportunity.active !== false
    || !hasReadyPostCloseOpportunity(payload)
  ) return [];
  const confirmedKeys = new Set((Array.isArray(report.confirmedThemes) ? report.confirmedThemes : [])
    .map(postCloseOpportunityThemeKey)
    .filter(Boolean));
  const opportunityDirections = payload && payload.tomorrowDecision
    && payload.tomorrowDecision.opportunityMap
    && Array.isArray(payload.tomorrowDecision.opportunityMap.directions)
    ? payload.tomorrowDecision.opportunityMap.directions
    : [];
  const canonicalCandidatesByCode = new Map();
  opportunityDirections.forEach((direction) => {
    if (!direction || typeof direction !== "object" || Array.isArray(direction)) return;
    const directionKeys = new Set([direction.id, direction.name, direction.family]
      .map((value) => postCloseOpportunityText(value).toLowerCase())
      .filter(Boolean));
    if (!directionKeys.size) return;
    (Array.isArray(direction.tradeCandidates) ? direction.tradeCandidates : []).forEach((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
      if (candidate.active !== true || candidate.tradeQualified !== true) return;
      const code = postCloseOpportunityCode(candidate);
      if (!code) return;
      const rows = canonicalCandidatesByCode.get(code) || [];
      rows.push({ directionKeys });
      canonicalCandidatesByCode.set(code, rows);
    });
  });
  if (!canonicalCandidatesByCode.size) return [];
  const executableByCode = new Map(executablePlans.map((plan) => [
    String(plan.code || plan.stockCode || plan.symbol || "").trim().toUpperCase(),
    plan,
  ]));
  const cards = (Array.isArray(report.opportunityCards) ? report.opportunityCards : [])
    .filter((card) => authorizedCodes.has(postCloseOpportunityCode(card)));
  const seenCodes = new Set();
  const sameValue = (left, right) => {
    const normalize = (value) => premarketValueText(value, "").replace(/\s+/g, " ").trim();
    const leftText = normalize(left);
    const rightText = normalize(right);
    return Boolean(leftText && rightText && leftText === rightText);
  };
  const rows = cards.map((card) => {
    if (!card || typeof card !== "object" || Array.isArray(card) || !postCloseOpportunityPlanReady(card)) return null;
    const code = postCloseOpportunityCode(card);
    if (!code || seenCodes.has(code)) return null;
    seenCodes.add(code);
    const plan = executableByCode.get(code);
    const cardPlan = card.plan;
    if (!plan || !cardPlan || typeof cardPlan !== "object" || Array.isArray(cardPlan)) return null;
    const themeKey = postCloseOpportunityText(card.themeId || card.themeName).toLowerCase();
    const sourcePlan = postCloseOpportunityText(card.source && card.source.plan);
    const sourceCandidate = postCloseOpportunityText(card.source && card.source.candidate);
    const themeId = postCloseOpportunityText(card.themeId);
    const cardThemeKeys = new Set([card.themeId, card.themeName]
      .map((value) => postCloseOpportunityText(value).toLowerCase())
      .filter(Boolean));
    const canonicalCandidateAligned = (canonicalCandidatesByCode.get(code) || [])
      .some((row) => Array.from(cardThemeKeys).some((key) => row.directionKeys.has(key)));
    const canonicalCardId = themeId && `${themeId}:${code}`;
    const planName = postCloseOpportunityText(plan.name || code);
    const cardName = postCloseOpportunityText(card.name);
    const fieldsAligned = ["buy", "hold", "sell", "holdingPeriod", "triggers", "cancelConditions"]
      .every((key) => sameValue(plan[key], cardPlan[key]));
    const riskAligned = sameValue(plan.riskExit || plan.sell, cardPlan.riskExit || cardPlan.sell);
    const executionModeAligned = sameValue(plan.executionMode, cardPlan.executionMode);
    if (
      !themeKey
      || !themeId
      || !confirmedKeys.has(themeKey)
      || !postCloseOpportunityText(card.themeName)
      || sourcePlan !== "premarketFlow.tradePlan.plans"
      || sourceCandidate !== "opportunityMap.directions[].tradeCandidates"
      || !canonicalCandidateAligned
      || postCloseOpportunityText(card.id) !== canonicalCardId
      || !planName
      || planName !== cardName
      || !fieldsAligned
      || !riskAligned
      || !executionModeAligned
    ) return null;
    return {
      code: String(plan.code || plan.stockCode || plan.symbol || "").trim(),
      name: plan.name || code,
      theme: card.themeName,
      buy: plan.buy,
      triggers: plan.triggers,
      positionAllocation: plan.positionAllocation && typeof plan.positionAllocation === "object"
        ? { ...plan.positionAllocation }
        : null,
      cancelConditions: plan.cancelConditions,
      riskExit: plan.riskExit || plan.sell,
    };
  });
  return rows.length && rows.every(Boolean) ? rows : [];
}

function premarketDirectBuyPayloadGeneration(payload) {
  return postCloseOpportunityText(payload && payload.generationId);
}

function premarketDirectBuyPayloadTimestamp(payload) {
  const value = payload && [payload.fetchedAt, payload.updatedAt, payload.generatedAt]
    .find((item) => postCloseOpportunityText(item));
  const timestamp = Date.parse(postCloseOpportunityText(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function premarketDirectBuyPayloadFresh(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const proof = premarketDirectBuyFreshPayloads.get(payload);
  if (!proof || typeof proof !== "object") return false;
  const executionFreshness = resolvePayloadExecutionFreshness(payload);
  const generationId = premarketDirectBuyPayloadGeneration(payload);
  const tradingDate = postCloseOpportunityText(payload.tradingDate || payload.asOf && payload.asOf.tradingDate);
  const sourceTimestamp = premarketDirectBuyPayloadTimestamp(payload);
  const now = Date.now();
  return Boolean(
    executionFreshness.directBuyEligible === true
    && payload.stale !== true
    && !postCloseOpportunityText(payload.fetchError)
    && payload.servedFromCache !== true
    && payload.backgroundRefresh !== true
    && generationId
    && tradingDate
    && generationId.startsWith(`${tradingDate}:`)
    && sourceTimestamp !== null
    && sourceTimestamp === proof.sourceTimestamp
    && generationId === proof.generationId
    && tradingDate === proof.tradingDate
    && now <= proof.expiresAt
    && now - sourceTimestamp <= PREMARKET_DIRECT_BUY_MAX_AGE_MS
    && sourceTimestamp - now <= 5 * 60 * 1000
  );
}

function setPremarketDirectBuyPayloadFresh(payload, fresh) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const executionFreshness = resolvePayloadExecutionFreshness(payload);
  const generationId = premarketDirectBuyPayloadGeneration(payload);
  const tradingDate = postCloseOpportunityText(payload.tradingDate || payload.asOf && payload.asOf.tradingDate);
  const sourceTimestamp = premarketDirectBuyPayloadTimestamp(payload);
  const now = Date.now();
  const eligible = Boolean(
    fresh === true
    && executionFreshness.directBuyEligible === true
    && payload.stale !== true
    && !postCloseOpportunityText(payload.fetchError)
    && payload.servedFromCache !== true
    && payload.backgroundRefresh !== true
    && generationId
    && tradingDate
    && generationId.startsWith(`${tradingDate}:`)
    && sourceTimestamp !== null
    && now - sourceTimestamp <= PREMARKET_DIRECT_BUY_MAX_AGE_MS
    && sourceTimestamp - now <= 5 * 60 * 1000
  );
  if (eligible) {
    const expiresAt = sourceTimestamp + PREMARKET_DIRECT_BUY_MAX_AGE_MS;
    premarketDirectBuyFreshPayloads.set(payload, {
      generationId,
      tradingDate,
      sourceTimestamp,
      expiresAt,
      sourceState: executionFreshness.state,
      evidenceStatus: executionFreshness.evidenceStatus,
    });
    if (premarketDirectBuyFreshnessTimer && typeof clearTimeout === "function") {
      clearTimeout(premarketDirectBuyFreshnessTimer);
    }
    premarketDirectBuyFreshnessTimer = null;
    premarketDirectBuyFreshnessTimerPayload = payload;
    if (typeof setTimeout === "function") {
      premarketDirectBuyFreshnessTimer = setTimeout(() => {
        if (premarketDirectBuyFreshnessTimerPayload !== payload) return;
        premarketDirectBuyFreshPayloads.delete(payload);
        premarketDirectBuyFreshnessTimer = null;
        premarketDirectBuyFreshnessTimerPayload = null;
        if (lastHotPayload === payload) {
          try { renderPremarketFlow(payload); } catch { /* 过期后继续保持不可执行 */ }
        }
      }, Math.max(0, expiresAt - now + 50));
      if (premarketDirectBuyFreshnessTimer && typeof premarketDirectBuyFreshnessTimer.unref === "function") {
        premarketDirectBuyFreshnessTimer.unref();
      }
    }
  } else {
    premarketDirectBuyFreshPayloads.delete(payload);
    if (premarketDirectBuyFreshnessTimerPayload === payload) {
      if (premarketDirectBuyFreshnessTimer && typeof clearTimeout === "function") {
        clearTimeout(premarketDirectBuyFreshnessTimer);
      }
      premarketDirectBuyFreshnessTimer = null;
      premarketDirectBuyFreshnessTimerPayload = null;
    }
  }
  return eligible;
}

function premarketDirectBuyPromptHtml(step, payload) {
  const allocationText = (allocation) => {
    if (typeof canonicalPositionAllocationText === "function") return canonicalPositionAllocationText(allocation);
    const initial = Number(allocation && allocation.initialPortfolioPct);
    const maximum = Number(allocation && allocation.maximumPortfolioPct);
    return Number.isFinite(initial) && Number.isFinite(maximum) && initial >= 0 && maximum >= initial
      ? `初始 ${initial}% · 上限 ${maximum}%`
      : "";
  };
  const executablePlans = premarketExecutablePlans(step, payload, { requireFresh: true });
  const rows = premarketDirectBuyPlans(step, payload);
  if (!rows.length) {
    const strictReviewPending = executablePlans.length > 0;
    return `
      <section class="premarket-direct-buy is-empty" data-flow-role="direct-buy" data-direct-buy-count="0" aria-label="直接买入提示">
        <header>
          <div><span>直接买入提示</span><h3>当前暂无可买入股票</h3></div>
          <em>不开新仓</em>
        </header>
        <p>${strictReviewPending
          ? "已有条件计划，但最终机会卡尚未通过同代、题材归属与完整性复核，暂不提示买入。"
          : "可执行计划为 0 份，继续空仓观察，等待 09:25 与 09:35 的独立确认。"}</p>
      </section>`;
  }
  return `
    <section class="premarket-direct-buy is-ready" data-flow-role="direct-buy" data-direct-buy-count="${rows.length}" aria-label="直接买入提示">
      <header>
        <div><span>直接买入提示</span><h3>${rows.length}只股票进入最终买入提示</h3></div>
        <em>${rows.length}只</em>
      </header>
      <div class="premarket-direct-buy-grid">
        ${rows.map((row) => `
          <article class="premarket-direct-buy-card">
            <span>条件满足后可买入</span>
            <h4>${escapeHtml(premarketValueText(row.name, "名称待确认"))}<small>${escapeHtml(row.code)}</small></h4>
            ${row.theme ? `<p><b>所属方向：</b>${escapeHtml(premarketValueText(row.theme, ""))}</p>` : ""}
            <p><b>买入条件：</b>${escapeHtml(premarketValueText(row.buy, "未形成买点"))}</p>
            <p><b>触发确认：</b>${escapeHtml(premarketValueText(row.triggers, "等待触发确认"))}</p>
            <p><b>统一链仓位：</b>${escapeHtml(allocationText(row.positionAllocation) || "统一决策链仓位待确认")}</p>
            <p><b>取消条件：</b>${escapeHtml(premarketValueText(row.cancelConditions, "出现取消条件则不买"))}</p>
            <p><b>风险退出：</b>${escapeHtml(premarketValueText(row.riskExit, "按实际成本重算"))}</p>
          </article>`).join("")}
      </div>
      <p class="premarket-direct-buy-boundary">这里只显示同代、题材确认且进入最终机会卡的股票；未触发或出现取消条件时不买入。</p>
    </section>`;
}

function premarketEvidenceHtml(step) {
  const evidence = Array.isArray(step && step.evidence) ? step.evidence.filter(Boolean).slice(0, 12) : [];
  if (!evidence.length) return "";
  const displayEvidence = step && step.key === "emotionStage" && step.emotionVersion
    ? evidence.map((item) => premarketPlainEmotionText(item))
    : evidence;
  return `
    <details class="premarket-evidence" data-flow-role="evidence">
      <summary>为什么这样判断 <span>${evidence.length} 条证据</span></summary>
      <ul>${displayEvidence.map((item) => `<li>${escapeHtml(premarketValueText(item, ""))}</li>`).join("")}</ul>
    </details>
  `;
}

function premarketGuardHtml(step) {
  const blockers = Array.isArray(step && step.blockedBy) ? step.blockedBy.filter(Boolean) : [];
  const invalidation = step && step.invalidation ? premarketValueText(step.invalidation, "") : "";
  if (!blockers.length && !invalidation) return "";
  const blockerLabels = blockers.map((key) => ({
      indexOpportunity: "指数机会",
      tradingPreference: "炒作偏好",
      emotionStage: "情绪阶段",
      direction: "主攻方向",
      stocks: "核心个股",
    }[key] || key));
  const message = blockers.length
    ? step && step.key === "emotionStage"
      ? `暂时不能买：${blockerLabels.join("、")}这一步还没有通过`
      : `上游否决：${blockerLabels.join("、")}`
    : invalidation;
  const title = step && step.key === "emotionStage" ? "为什么暂时不能买" : "执行红线";
  return `
    <div class="premarket-guard-card" data-flow-role="guard">
      <strong>${title}</strong>
      <p>${escapeHtml(message)}</p>
      ${invalidation && blockers.length ? `<p>${escapeHtml(invalidation)}</p>` : ""}
    </div>
  `;
}

function premarketConclusionText(step, payload = null) {
  if (!step) return "等待本步数据。";
  if (step.key === "indexOpportunity" && step.regimeVersion) {
    return premarketIndexVerdict(step);
  }
  if (step.key === "tradingPreference" && step.preferenceVersion) {
    return premarketPreferenceConclusion(step);
  }
  if (step.key === "emotionStage") {
    const current = step.currentEmotion || {};
    if (step.emotionVersion) return premarketEmotionConclusion(step) || premarketPlainEmotionText(current.reason);
    const parts = [step.cycle, step.stageLabel, step.lightLabel].filter(Boolean);
    return parts.length ? parts.join(" · ") : premarketValueText(step.conclusion, "情绪阶段待确认");
  }
  if (step.key === "direction") {
    const primary = step.primary || {};
    const decision = step.subthemeDecision || primary.subthemeDecision || {};
    const mainAttack = decision.mainAttackSubtheme || {};
    const familyName = decision.family && decision.family.name || primary.family || primary.name;
    const blocked = step.status === "blocked" || (Array.isArray(step.blockedBy) && step.blockedBy.length > 0);
    if (mainAttack.name && !blocked) return `主线家族 ${familyName || "待确认"} · 主攻细分 ${mainAttack.name}`;
    if (blocked && primary.name) return `题材库观察：${primary.name} · 上游未授权，不作为主攻`;
    if (blocked && familyName) return `题材库观察：${familyName} · 上游未授权，不作为主攻`;
    if (familyName) return `主线家族 ${familyName} · 暂无唯一主攻细分`;
    return "当前无合格主攻方向，不向个股步骤补票";
  }
  if (step.key === "stocks") {
    const rows = Array.isArray(step.candidates) ? step.candidates.filter((item) => item && item.qualified === true) : [];
    return rows.length
      ? `合格核心个股：${rows.slice(0, 3).map((item) => item.name || item.code).filter(Boolean).join("、")}`
      : "当前无合格核心个股，不补票";
  }
  if (step.key === "tradePlan") {
    const plans = premarketExecutablePlans(step, payload, { requireFresh: true });
    return plans.length
      ? `${plans.length} 份买卖计划可按条件执行`
      : "当前不开新仓，等待合格个股与触发条件";
  }
  return premarketValueText(step.conclusion, "等待本步数据。");
}

function renderPreplanScenarioWorkbench(step, payload = null) {
  const safeList = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
  const safeText = (value, fallback = "") => String(value == null ? "" : value).replace(/\s+/g, " ").trim() || fallback;
  const guardrails = step && step.guardrails && typeof step.guardrails === "object" ? step.guardrails : {};
  const integrity = step && step.integrity && typeof step.integrity === "object" ? step.integrity : {};
  const scenarioContext = step && step.scenarioContext && typeof step.scenarioContext === "object" ? step.scenarioContext : null;
  const scenarios = scenarioContext ? safeList(scenarioContext.scenarios) : [];
  const scripts = safeList(step && step.conditionalScripts);
  const formalPlans = safeList(step && step.formalPlans);
  const forbiddenKeys = ["buy", "sell", "hold", "holdingPeriod", "position", "positionAllocation", "canonicalAllocation", "order", "orderPlan", "allocation", "firstPositionPct"];
  const weights = scenarios.map((row) => Number(row && row.modelWeightPct));
  const contractValid = step
    && Number(step.version) === 2
    && safeText(step.method) === "conditional_playbook_projection_v1"
    && ["ready", "unavailable"].includes(safeText(step.dataStatus))
    && guardrails.scenarioCannotGrantExecution === true
    && guardrails.observationCannotGrantExecution === true
    && guardrails.formalPlansFromUnifiedChainOnly === true
    && guardrails.noForcedCandidate === true
    && guardrails.sameGenerationRequired === true
    && (step.dataStatus !== "ready" || (
      scenarios.length === 3
      && new Set(scenarios.map((row) => safeText(row && row.key))).size === 3
      && weights.every((weight) => Number.isFinite(weight) && weight >= 0 && weight <= 100)
      && Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 100) < 0.01
      && scripts.every((row) => row && row.observationOnly === true && row.executable === false
        && row.executionAuthority === false && row.positionAuthority === false
        && forbiddenKeys.every((key) => !(key in row)))
      && integrity.sameGeneration === true
      && integrity.observationFieldsStripped === true
      && integrity.formalAndObservationDisjoint === true
      && integrity.scenarioWeightsSumTo100 === true
    ));
  if (!contractValid || step.dataStatus !== "ready") {
    return `
      <section class="preplan-workbench is-unavailable" data-flow-step="tradePlan" data-flow-role="step-summary">
        <header><div><span>次日条件剧本</span><h3>数据契约不可用</h3></div><em>执行关闭</em></header>
        <p>同代情景或观察池校验未通过，本页不生成条件剧本。</p>
        <a href="#sell-advisor">持仓与卖出方案仍独立运行</a>
      </section>`;
  }
  const conditionalCards = scripts.map((row, index) => {
    const activation = safeList(row.activationConditions).slice(0, 2);
    const invalidation = safeList(row.invalidationConditions).slice(0, 2);
    const expectation = row.tPlusOneExpectation && typeof row.tPlusOneExpectation === "object" ? row.tPlusOneExpectation : {};
    return `
      <article class="preplan-focus-card" data-focus-code="${escapeHtml(safeText(row.code))}" data-focus-level="conditional">
        <header><span>${escapeHtml(String(index + 1).padStart(2, "0"))}</span><div><strong>${escapeHtml(safeText(row.name, row.code))}</strong><small>${escapeHtml(safeText(row.code))} · ${escapeHtml(safeText(row.theme || row.pathLabel, "方向待确认"))}</small></div><em>重点观察</em></header>
        <p><b>看点</b><span>${escapeHtml(safeText(expectation.label || row.reason, "待确认"))}</span></p>
        <p><b>增强</b><span>${escapeHtml(activation.length ? activation.map((item) => safeText(item)).join("；") : "核心主动性与板块同步待确认")}</span></p>
        <p><b>失效</b><span>${escapeHtml(invalidation.length ? invalidation.map((item) => safeText(item)).join("；") : "负反馈扩散或结构破坏")}</span></p>
        <footer>09:25初筛 · 09:35复核 · 仅观察无执行权</footer>
      </article>`;
  }).join("");
  const formalCards = formalPlans.map((row, index) => `
    <article class="preplan-focus-card is-formal" data-focus-code="${escapeHtml(safeText(row.code))}" data-focus-level="formal">
      <header><span>${escapeHtml(String(index + scripts.length + 1).padStart(2, "0"))}</span><div><strong>${escapeHtml(safeText(row.name, row.code))}</strong><small>${escapeHtml(safeText(row.code))}</small></div><em>正式计划待复核</em></header>
      <p><b>看点</b><span>已进入统一决策链正式计划，仍须盘中证据确认</span></p>
      <p><b>增强</b><span>${escapeHtml(safeText(row.triggers, "按正式计划触发条件复核"))}</span></p>
      <p><b>失效</b><span>${escapeHtml(safeText(row.cancelConditions, "出现取消条件即失效"))}</span></p>
      <footer>09:25初筛 · 09:35复核 · 未触发不执行</footer>
    </article>`).join("");
  const focusCount = scripts.length + formalPlans.length;
  return `
    <section class="preplan-focus-board" data-flow-step="tradePlan" data-flow-role="step-summary" data-focus-count="${focusCount}">
      <header><div><span>重点观察标的</span><h3>${focusCount}只 · 09:25 / 09:35复核</h3></div><em>仅作重点观察</em></header>
      <p class="preplan-focus-note">只看标的、增强条件和失效条件；不代表买入建议。</p>
      <div class="preplan-focus-grid" data-flow-role="plans">${formalCards}${conditionalCards || '<p class="preplan-focus-empty">当前没有通过重点观察门槛的标的。</p>'}</div>
      <p class="preplan-focus-boundary">09:25只作初筛，09:35复核核心主动性、板块同步与真实承接。</p>
    </section>`;
}

function renderPremarketStepHtml(step, payload = null) {
  if (step && step.key === "tradePlan" && Number(step.version) === 2) {
    return renderPreplanScenarioWorkbench(step, payload);
  }
  const status = premarketStatusMeta(step);
  const metrics = premarketStepMetrics(step, payload);
  const items = premarketStepItems(step);
  const conclusion = premarketConclusionText(step, payload);
  const projection = premarketStepProjectionHtml(step);
  const indexStep = Boolean(step && step.key === "indexOpportunity");
  const planItems = step && step.key === "tradePlan" ? premarketPlanItems(step, payload) : "";
  const directBuyPrompt = step && step.key === "tradePlan" ? premarketDirectBuyPromptHtml(step, payload) : "";
  const feedback = step && step.key === "emotionStage"
    ? '<div class="premarket-feedback-note">系统判断整个市场时，不会拿推荐股给自己作证。一只推荐股上涨，也不能说明整个市场和板块都变强。</div>'
    : step && step.key === "tradePlan"
      ? '<div class="premarket-feedback-note">盘后先生成条件计划；次日 9:25 与 9:35 用独立核心篮子升级或取消，市场全面加强主要用于加仓，不等待涨高后才首次买入。</div>'
      : "";
  return `
    ${indexStep ? premarketIndexEvidenceChartsHtml(step) : ""}
    <article class="premarket-conclusion-card ${status.className}${indexStep ? " is-index-only" : ""}" data-flow-step="${escapeHtml(step && step.key || "unknown")}" data-flow-role="step-summary">
      <div class="premarket-conclusion-main" data-flow-role="conclusion">
        <span>${step && step.key === "emotionStage" ? "现在怎么看" : indexStep ? "当前机会结论" : "本步直接结论"}</span>
        <h3>${escapeHtml(conclusion)}</h3>
        <p>${step && step.key === "emotionStage" ? "更新时间" : "数据时间"}：${escapeHtml(formatTime(lastPremarketFlowModel && lastPremarketFlowModel.sourceUpdatedAt))}</p>
      </div>
      ${indexStep ? "" : `<div class="premarket-next-output" data-flow-role="handoff">
        <span>${step && step.key === "emotionStage" ? "下一步怎么做" : "传递给下一步"}</span>
        <strong>${escapeHtml(premarketStepImpact(step, payload))}</strong>
      </div>`}
    </article>
    ${!indexStep && metrics.length ? `<div class="premarket-metric-grid">${metrics.map((row) => premarketMetricHtml(row[0], row[1], row[2])).join("")}</div>` : ""}
    ${directBuyPrompt}
    ${projection}
    ${indexStep && metrics.length ? `<div class="premarket-metric-grid">${metrics.map((row) => premarketMetricHtml(row[0], row[1], row[2])).join("")}</div>` : ""}
    ${items.length ? `<div class="premarket-item-grid" data-flow-role="${step && step.key === "stocks" ? "candidates" : "details"}">${items.map((row) => premarketItemHtml(row[0], row[1], row[2])).join("")}</div>` : ""}
    ${planItems ? `<div class="premarket-item-grid" data-flow-role="plans">${planItems}</div>` : ""}
    ${feedback}
    ${premarketGuardHtml(step)}
    ${premarketEvidenceHtml(step)}
  `;
}

function premarketExecutablePlanCodes(model, payload = null) {
  const tradePlan = model && model.tradePlan && typeof model.tradePlan === "object" ? model.tradePlan : {};
  return new Set(premarketExecutablePlans(tradePlan, payload, { requireFresh: true })
    .map((plan) => String(plan && (plan.code || plan.stockCode || plan.symbol) || "").trim())
    .filter(Boolean));
}

function syncPremarketLegacyExecutionControls(model, payload = lastHotPayload) {
  const legacyPlanWorkspace = document.querySelector("#preplanLegacyWorkspace");
  const planCodes = premarketExecutablePlanCodes(model, payload);
  const planExecutionAllowed = planCodes.size > 0;
  if (legacyPlanWorkspace) {
    legacyPlanWorkspace.hidden = !planExecutionAllowed;
    legacyPlanWorkspace.inert = !planExecutionAllowed;
    legacyPlanWorkspace.setAttribute("aria-hidden", planExecutionAllowed ? "false" : "true");
  }
  document.querySelectorAll("#auto-picker [data-preplan]").forEach((button) => {
    const code = String(button.dataset && button.dataset.preplan || "").trim();
    const allowed = planExecutionAllowed && planCodes.has(code);
    button.disabled = !allowed;
    button.setAttribute("aria-disabled", allowed ? "false" : "true");
    button.title = allowed ? "" : "该股票没有进入最终可执行计划，不能录入执行预案";
  });
}

function premarketUnavailableIndexEvidence(note = "五日证据读取失败，请稍后重试。") {
  return {
    index: { code: "883421", name: "同花顺全A(沪深)", source: null, points: [] },
    turnover: { unit: "亿元", source: null, points: [] },
    dataQuality: {
      status: "unavailable",
      requestedDays: 5,
      availableDays: 0,
      strictClosingOnly: true,
      consecutive: null,
      gaps: [],
      excluded: [],
      missingDates: [],
      note,
    },
  };
}

function premarketAttachIndexOpportunityEvidence(model, payload) {
  const step = model && model.indexOpportunity && typeof model.indexOpportunity === "object"
    ? model.indexOpportunity
    : null;
  if (!step) return model;
  const source = payload && payload.indexOpportunityEvidence && typeof payload.indexOpportunityEvidence === "object"
    ? payload.indexOpportunityEvidence
    : null;
  if (source) {
    step.fiveDayEvidence = source.fiveDayEvidence && typeof source.fiveDayEvidence === "object"
      ? source.fiveDayEvidence
      : source;
  }
  const payloadPlan = payload && payload.indexTomorrowPlan && typeof payload.indexTomorrowPlan === "object"
    ? payload.indexTomorrowPlan
    : payload && payload.premarketModels && payload.premarketModels.indexTomorrowPlan && typeof payload.premarketModels.indexTomorrowPlan === "object"
      ? payload.premarketModels.indexTomorrowPlan
      : null;
  const evidencePlan = source && source.indexTomorrowPlan && typeof source.indexTomorrowPlan === "object"
    ? source.indexTomorrowPlan
    : null;
  if (!step.indexTomorrowPlan && (payloadPlan || evidencePlan)) step.indexTomorrowPlan = payloadPlan || evidencePlan;
  return model;
}

function loadIndexOpportunityEvidence(payload) {
  if (!payload || typeof payload !== "object") return Promise.resolve(null);
  if (payload.indexOpportunityEvidence && typeof payload.indexOpportunityEvidence === "object") {
    return Promise.resolve(payload.indexOpportunityEvidence);
  }
  const existingLoad = indexOpportunityEvidenceLoads.get(payload);
  if (existingLoad) return existingLoad;
  if (!indexOpportunityEvidenceRequest) {
    const request = fetch("/api/index-opportunity/evidence", { cache: "no-store" })
      .then(async (response) => {
        if (!response || response.ok !== true) throw new Error(`HTTP ${response && response.status || 0}`);
        const body = await response.json();
        if (!body || body.ok !== true || !body.evidence || typeof body.evidence !== "object") {
          throw new Error("invalid evidence response");
        }
        return { ok: true, evidence: body.evidence };
      })
      .catch((error) => {
        console.warn("[index-opportunity-evidence] load failed", error);
        return { ok: false, evidence: null };
      });
    indexOpportunityEvidenceRequest = request;
    void request.finally(() => {
      if (indexOpportunityEvidenceRequest === request) indexOpportunityEvidenceRequest = null;
    });
  }
  const load = indexOpportunityEvidenceRequest.then((result) => {
    if (payload !== lastHotPayload) return result.ok ? result.evidence : null;
    payload.indexOpportunityEvidence = result.ok
      ? result.evidence
      : premarketUnavailableIndexEvidence();
    renderPremarketFlow(payload);
    return result.ok ? result.evidence : null;
  });
  indexOpportunityEvidenceLoads.set(payload, load);
  return load;
}

function renderPremarketFlow(payload) {
  const api = globalThis.PremarketFlow;
  if (!api || typeof api.buildPremarketFlow !== "function") {
    lastPremarketFlowModel = null;
    syncPremarketLegacyExecutionControls(null);
    return null;
  }
  try {
    const model = api.buildPremarketFlow(payload || {});
    premarketAttachIndexOpportunityEvidence(model, payload || {});
    lastPremarketFlowModel = model;
    const targets = {
      indexOpportunity: ["#premarketIndexBody", "#premarketIndexStatus"],
      tradingPreference: ["#premarketPreferenceBody", "#premarketPreferenceStatus"],
      emotionStage: ["#premarketEmotionBody", "#premarketEmotionStatus"],
      direction: ["#premarketDirectionFlow", null],
      stocks: ["#premarketStockFlow", null],
      tradePlan: ["#premarketTradePlanFlow", null],
    };
    Object.entries(targets).forEach(([key, selectors]) => {
      const step = model[key];
      const body = document.querySelector(selectors[0]);
      if (body) body.innerHTML = renderPremarketStepHtml(step, payload || {});
      if (selectors[1]) {
        const statusNode = document.querySelector(selectors[1]);
        if (statusNode) {
          const status = premarketStatusMeta(step);
          statusNode.textContent = status.label;
          statusNode.className = `premarket-step-status ${status.className}`;
        }
      }
    });
    syncPremarketLegacyExecutionControls(model, payload || {});
    document.body.dataset.premarketBlockedAt = model.blockedAt || "";
    return model;
  } catch (error) {
    console.error("[premarket-flow] render failed", error);
    lastPremarketFlowModel = null;
    syncPremarketLegacyExecutionControls(null);
    ["#premarketIndexBody", "#premarketPreferenceBody", "#premarketEmotionBody", "#premarketDirectionFlow", "#premarketStockFlow", "#premarketTradePlanFlow"].forEach((selector) => {
      const node = document.querySelector(selector);
      if (node) node.innerHTML = '<div class="empty-state">盘后复盘流程暂时无法读取，已停止生成交易建议。</div>';
    });
    const legacyPlanWorkspace = document.querySelector("#preplanLegacyWorkspace");
    if (legacyPlanWorkspace) {
      legacyPlanWorkspace.hidden = true;
      legacyPlanWorkspace.inert = true;
      legacyPlanWorkspace.setAttribute("aria-hidden", "true");
    }
    return null;
  }
}

function renderActivePremarketFlowView(view) {
  const key = PREMARKET_VIEW_STEP[String(view || "")];
  if (!key || !lastHotPayload) return;
  renderPremarketFlow(lastHotPayload);
}

function postCloseOpportunityText(value) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) {
    return value.map((item) => postCloseOpportunityText(item)).filter(Boolean).join("；");
  }
  if (!value || typeof value !== "object") return "";
  const preferredKeys = ["summary", "display", "label", "text", "description", "condition", "value"];
  for (const key of preferredKeys) {
    const text = postCloseOpportunityText(value[key]);
    if (text) return text;
  }
  return "";
}

function postCloseOpportunityThemeKey(theme) {
  if (!theme || typeof theme !== "object" || Array.isArray(theme)) return "";
  return postCloseOpportunityText(theme.id || theme.family || theme.name).toLowerCase();
}

function postCloseOpportunityCode(stock) {
  if (!stock || typeof stock !== "object" || Array.isArray(stock)) return "";
  return postCloseOpportunityText(stock.code).toUpperCase();
}

function postCloseOpportunityRole(core) {
  const labels = {
    sentiment: "情绪核心",
    capacity: "容量核心",
    height: "高度核心",
    pioneer: "先锋",
    follow: "跟随",
    current_core: "当前核心",
    historical_core: "历史核心",
  };
  const values = [core && core.role, core && core.identity].map(postCloseOpportunityText).filter(Boolean);
  for (const raw of values) {
    const normalized = raw.toLowerCase();
    if (labels[normalized]) return labels[normalized];
    if (/[\u3400-\u9fff]/.test(raw)) return raw;
  }
  return "待确认";
}

function postCloseOpportunityGenerationAligned(payload, report) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (!report || typeof report !== "object" || Array.isArray(report)) return false;

  const payloadGenerations = [
    payload.premarketModels && payload.premarketModels.generationId,
    payload.tomorrowDecision && payload.tomorrowDecision.generationId,
    payload.recentIndexEmotionRelation && payload.recentIndexEmotionRelation.generationId,
  ].map(postCloseOpportunityText).filter(Boolean);
  const reportGeneration = postCloseOpportunityText(report.generationId);
  const relationGeneration = postCloseOpportunityText(report.recentRelation && report.recentRelation.generationId);
  const allGenerations = [...payloadGenerations, reportGeneration, relationGeneration].filter(Boolean);

  if (!allGenerations.length) return true;
  if (!reportGeneration || !relationGeneration) return false;
  return new Set(allGenerations).size === 1;
}

function postCloseOpportunityIntegrityReady(report) {
  const integrity = report && typeof report === "object" && !Array.isArray(report)
    && report.integrity && typeof report.integrity === "object" && !Array.isArray(report.integrity)
    ? report.integrity
    : null;
  const observationDeclared = Boolean(
    report && (Array.isArray(report.opportunityObservationCards)
      || report.opportunityObservationState && typeof report.opportunityObservationState === "object")
  );
  const observationReady = !observationDeclared || Boolean(
    integrity
    && integrity.opportunityObservationCardsFromUnifiedChainOnly === true
    && integrity.opportunityObservationCardsCannotGrantExecution === true
    && integrity.observationAndExecutionCodesSeparated === true
  );
  return Boolean(
    integrity
    && integrity.failClosed === true
    && integrity.generationAligned === true
    && integrity.opportunityCardsFromFinalPlansOnly === true
    && integrity.observationLayersDoNotGrantExecution === true
    && integrity.watchAndExecutionCodesSeparated === true
    && observationReady
  );
}

function postCloseOpportunityPlanReady(card) {
  const plan = card && typeof card === "object" && !Array.isArray(card)
    && card.plan && typeof card.plan === "object" && !Array.isArray(card.plan)
    ? card.plan
    : null;
  if (!plan) return false;
  return Boolean(
    postCloseOpportunityText(plan.triggers)
    && postCloseOpportunityText(plan.cancelConditions)
    && postCloseOpportunityText(plan.riskExit || plan.sell)
  );
}

function hasReadyPostCloseOpportunity(payload) {
  const unifiedProjection = resolveUnifiedDecisionChainProjection(payload);
  const authorizedCodes = new Set(unifiedProjection.selectedCodes);
  const report = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload.postCloseOpportunity
    : null;
  if (!report || typeof report !== "object" || Array.isArray(report)) return false;
  if (!postCloseOpportunityGenerationAligned(payload, report)) return false;
  if (report.method === "unavailable") return false;
  if (!report.dataStatus || report.dataStatus.status !== "ready" || report.dataStatus.usable !== true) return false;
  if (!report.marketPermission || typeof report.marketPermission !== "object") return false;
  if (!postCloseOpportunityIntegrityReady(report)) return false;
  if (!Array.isArray(report.candidateThemes) || !Array.isArray(report.confirmedThemes) || !Array.isArray(report.opportunityCards)) return false;
  if (!report.noOpportunity || typeof report.noOpportunity !== "object") return false;

  if (report.status === "opportunities") {
    if (!unifiedProjection.executionOpen) return false;
    if (report.noOpportunity.active !== false || !report.opportunityCards.length) return false;
    if (!report.opportunityCards.every(postCloseOpportunityPlanReady)) return false;
    if (!report.opportunityCards.every((card) => authorizedCodes.has(postCloseOpportunityCode(card)))) return false;
    const confirmedKeys = new Set(report.confirmedThemes.map(postCloseOpportunityThemeKey).filter(Boolean));
    return report.opportunityCards.some((card) => {
      if (!card || typeof card !== "object" || Array.isArray(card)) return false;
      const themeKey = postCloseOpportunityText(card.themeId || card.themeName).toLowerCase();
      return Boolean(themeKey && confirmedKeys.has(themeKey) && postCloseOpportunityCode(card) && postCloseOpportunityText(card.themeName));
    });
  }

  if (report.status === "no_opportunity") {
    const reasons = Array.isArray(report.noOpportunity.reasons)
      ? report.noOpportunity.reasons.map(postCloseOpportunityText).filter(Boolean)
      : [];
    const nextChecks = Array.isArray(report.noOpportunity.nextChecks)
      ? report.noOpportunity.nextChecks.map(postCloseOpportunityText).filter(Boolean)
      : [];
    return report.noOpportunity.active === true
      && report.opportunityCards.length === 0
      && reasons.length > 0
      && nextChecks.length > 0;
  }

  return false;
}

function postCloseOpportunityRows(value, limit = 3, observationOnly = false) {
  const rows = Array.isArray(value) ? value : value == null ? [] : [value];
  return rows.map((item) => {
    const text = postCloseOpportunityText(item);
    if (!observationOnly || !text) return text;
    return text
      .replace(/可以买入?/g, "可继续观察")
      .replace(/买入/g, "继续观察")
      .replace(/下单/g, "进入最终计划")
      .replace(/(?:新)?开仓/g, "进入最终计划")
      .replace(/加仓/g, "提高关注级别");
  }).filter(Boolean).slice(0, limit);
}

function postCloseOpportunityDate(value) {
  const text = postCloseOpportunityText(value);
  const match = text.match(/^(?:\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : text || "日期待确认";
}

function postCloseRelationLabel(value) {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? postCloseOpportunityText(value.relationLabel || value.label || value.relationKey || value.key || value.relation)
    : postCloseOpportunityText(value);
  const key = raw.toLowerCase();
  const labels = {
    resonance_up: "指数和能参与的人气核心一起走强",
    index_strong_emotion_weak: "指数走强，但能参与的人气核心偏弱",
    index_up_emotion_divergence: "指数走强，但能参与的人气核心偏弱",
    index_weak_emotion_strong: "指数走弱，但能参与的人气核心仍强",
    resonance_down: "指数和能参与的人气核心一起走弱",
    switching: "近期关系还在切换",
    unknown: "有效数据不足，关系待确认",
  };
  if (labels[key]) return labels[key];
  if (/指数.*同向走强|共振.*走强/.test(raw)) return labels.resonance_up;
  if (/指数.*走强.*情绪.*走弱|指数强.*情绪弱/.test(raw)) return labels.index_strong_emotion_weak;
  if (/指数.*走弱.*情绪.*走强|指数弱.*情绪强/.test(raw)) return labels.index_weak_emotion_strong;
  if (/指数.*同向走弱|共振.*走弱/.test(raw)) return labels.resonance_down;
  return raw || labels.unknown;
}

function postCloseWatchUse(card) {
  const usage = postCloseOpportunityText(card && card.usage).toLowerCase();
  const role = postCloseOpportunityText(card && card.role).toLowerCase();
  if (usage === "height_only" || /height|高度/.test(role)) return "高度观察";
  if (usage === "validate_emotion" || /sentiment|情绪/.test(role)) return "情绪验证";
  if (/capacity|容量/.test(role)) return "容量验证";
  return "趋势验证";
}

function postCloseCoreStatus(card) {
  const status = postCloseOpportunityText(card && (card.coreStatus || card.identity)).toLowerCase();
  if (/^current$|current_core|当前|当下|现任/.test(status)) {
    return { label: "当下核心", truth: "是，当前核心身份已确认" };
  }
  if (/^historical$|historical_core|history|历史|前期/.test(status)) {
    return { label: "历史核心", truth: "历史上是，目前需要重新确认" };
  }
  return { label: "核心身份待确认", truth: "待确认，暂不能当作真正核心" };
}

function postCloseOpportunityObservationProjection(payload, report, formalCodes = new Set()) {
  const unified = resolveUnifiedDecisionChainProjection(payload);
  const sourceRows = Array.isArray(unified.observationCandidates) ? unified.observationCandidates : [];
  const sourceByCode = new Map(sourceRows.map((stock) => [postCloseOpportunityCode(stock), stock]));
  const reportRows = Array.isArray(report && report.opportunityObservationCards)
    ? report.opportunityObservationCards : [];
  const reportByCode = new Map(reportRows.map((card) => [postCloseOpportunityCode(card), card]));
  const eligible = (stock) => {
    if (!stock || typeof stock !== "object" || Array.isArray(stock)) return false;
    const completeness = stock.opportunityDataCompleteness && typeof stock.opportunityDataCompleteness === "object"
      ? stock.opportunityDataCompleteness : {};
    const expectation = stock.expectation && typeof stock.expectation === "object" ? stock.expectation : {};
    const confirmation = stock.entryConfirmation && typeof stock.entryConfirmation === "object"
      ? stock.entryConfirmation : {};
    const postEntry = stock.postEntryNextDayExpectation && typeof stock.postEntryNextDayExpectation === "object"
      ? stock.postEntryNextDayExpectation : {};
    const profit = stock.profitPreference && typeof stock.profitPreference === "object" ? stock.profitPreference : {};
    const capital = stock.capitalPreference && typeof stock.capitalPreference === "object" ? stock.capitalPreference : {};
    const feasibility = stock.executionFeasibility && typeof stock.executionFeasibility === "object"
      ? stock.executionFeasibility : {};
    return Boolean(
      stock.observationOnly === true
      && stock.executable === false
      && stock.executionAuthority === false
      && stock.hardGatePassed === true
      && completeness.status === "complete"
      && completeness.qualified === true
      && completeness.opportunityEligible === true
      && !postCloseOpportunityRows(completeness.missingFields, 99).length
      && !postCloseOpportunityRows(completeness.blockers, 99).length
      && expectation.status === "qualified"
      && postCloseOpportunityText(expectation.label)
      && confirmation.status === "waiting_trigger"
      && confirmation.activated === false
      && postCloseOpportunityText(confirmation.label)
      && postEntry.status === "conditional"
      && postEntry.horizon === "entry_t_plus_1"
      && postEntry.probability === null
      && postEntry.calibrated === false
      && profit.matched === true
      && capital.matched === true
      && ["ready", "conditional"].includes(postCloseOpportunityText(feasibility.status).toLowerCase())
      && !postCloseOpportunityRows(feasibility.blockers, 99).length
    );
  };
  const rows = unified.contractReady ? sourceRows.filter(eligible).map((stock) => {
    const code = postCloseOpportunityCode(stock);
    if (!code || formalCodes.has(code)) return null;
    const projected = reportByCode.get(code) || {};
    const confirmation = stock.entryConfirmation || {};
    const postEntry = stock.postEntryNextDayExpectation || {};
    const cancelConditions = postCloseOpportunityRows(stock.cancelConditions, 3, true);
    return {
      code,
      name: postCloseOpportunityText(projected.name || stock.name) || code,
      themeName: postCloseOpportunityText(projected.themeName || stock.theme) || "题材待确认",
      pathLabel: postCloseOpportunityText(projected.pathLabel || stock.pathLabel) || "路径待确认",
      role: postCloseOpportunityText(projected.role || stock.role) || "角色待确认",
      tierLabel: postCloseOpportunityText(projected.tierLabel || stock.tierLabel) || "机会观察",
      reason: postCloseOpportunityText(projected.reason || stock.observationReason || stock.expectation && stock.expectation.label) || "明日预期待确认",
      entryConfirmation: postCloseOpportunityText(projected.entryConfirmation || confirmation.label) || "买点确认待补",
      nextDayExpectation: postCloseOpportunityText(projected.nextDayExpectation || postEntry.label) || "买后次日预期待补",
      cancelCondition: postCloseOpportunityText(projected.cancelCondition || cancelConditions[0] || confirmation.invalidation || postEntry.invalidation) || "观察条件失效时取消",
      missingCondition: postCloseOpportunityText(projected.missingCondition) || postCloseOpportunityRows(stock.missingConditions, 3, true)[0] || "等待统一交易授权开放",
      sourceScope: postCloseOpportunityText(projected.sourceScope) || "current_market_sample",
      observationOnly: true,
      executionAuthority: false,
    };
  }).filter(Boolean).slice(0, 5) : [];
  const reportState = report && report.opportunityObservationState && typeof report.opportunityObservationState === "object"
    ? report.opportunityObservationState : {};
  const sourceCount = sourceRows.length;
  const status = !unified.contractReady
    ? "unavailable"
    : rows.length ? "available" : "empty";
  return {
    declared: Boolean(
      payload && payload.unifiedDecisionChain && typeof payload.unifiedDecisionChain === "object"
      || report && Array.isArray(report.opportunityObservationCards)
      || report && report.opportunityObservationState && typeof report.opportunityObservationState === "object"
    ),
    status,
    sourceCount,
    eligibleCount: rows.length,
    rejectedCount: Math.max(0, sourceCount - rows.length),
    reason: status === "unavailable"
      ? "统一机会观察池未通过数据或代次校验，不沿用旧观察票。"
      : rows.length
        ? postCloseOpportunityText(reportState.reason) || `当前有${rows.length}只通过观察级硬门槛，仍未获得交易授权。`
        : sourceCount
          ? "现有候选均未通过观察级硬门槛、数据完整度与明日确认条件。"
          : "当前没有通过观察门槛的机会观察股。",
    rows,
  };
}

function renderPostCloseOpportunity(payload) {
  const mount = document.querySelector("#postCloseOpportunityView");
  if (!mount) return "missing_mount";

  const renderUnavailable = (reason = "本次盘后报告没有完整返回，暂时不能判断明日机会。") => {
    mount.dataset.state = "unavailable";
    mount.setAttribute("aria-busy", "false");
    mount.innerHTML = `
      <div class="post-close-opportunity-hero">
        <span data-role="eyebrow">明日机会</span>
        <strong data-role="opportunity-headline">盘后数据未准备好</strong>
        <p data-role="opportunity-reason">${escapeHtml(reason)}</p>
      </div>
      <section class="post-close-opportunity-section">
        <header><h3>什么时候重新看</h3><p>不沿用上一次报告</p></header>
        <div class="post-close-opportunity-theme-grid">
          <article class="post-close-opportunity-theme-card">
            <strong>等本次报告补齐</strong>
            <p>盘后数据、方向确认和股票计划都完整返回后，再判断明日机会。</p>
          </article>
        </div>
      </section>`;
    return "unavailable";
  };

  try {
    const report = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload.postCloseOpportunity
      : null;
    if (!report || typeof report !== "object" || Array.isArray(report)) return renderUnavailable();
    const unifiedProjection = resolveUnifiedDecisionChainProjection(payload);
    const authorizedStocksByCode = new Map(unifiedProjection.stocks.map((stock) => [
      postCloseOpportunityCode(stock),
      stock,
    ]));
    if (!postCloseOpportunityGenerationAligned(payload, report)) {
      return renderUnavailable("本次行情和盘后报告不是同一批数据，正在重新生成，暂不沿用旧结论。");
    }

    const reportStatus = postCloseOpportunityText(report.status);
    const dataStatus = report.dataStatus && typeof report.dataStatus === "object" ? report.dataStatus : null;
    const permission = report.marketPermission && typeof report.marketPermission === "object"
      ? report.marketPermission
      : null;
    const integrity = report.integrity && typeof report.integrity === "object" ? report.integrity : null;
    const candidateThemes = Array.isArray(report.candidateThemes)
      ? report.candidateThemes.filter((item) => item && typeof item === "object" && !Array.isArray(item))
      : null;
    const confirmedThemes = Array.isArray(report.confirmedThemes)
      ? report.confirmedThemes.filter((item) => item && typeof item === "object" && !Array.isArray(item))
      : null;
    const rawCards = Array.isArray(report.opportunityCards)
      ? report.opportunityCards.filter((item) => item && typeof item === "object" && !Array.isArray(item))
      : null;
    const recentRelation = report.recentRelation && typeof report.recentRelation === "object" && !Array.isArray(report.recentRelation)
      ? report.recentRelation
      : null;
    const setupCards = Array.isArray(report.setupCards)
      ? report.setupCards.filter((item) => item && typeof item === "object" && !Array.isArray(item)).slice(0, 2)
      : [];
    const rawWatchCards = Array.isArray(report.watchCards)
      ? report.watchCards.filter((item) => item && typeof item === "object" && !Array.isArray(item)).slice(0, 5)
      : null;
    const noOpportunity = report.noOpportunity && typeof report.noOpportunity === "object"
      ? report.noOpportunity
      : null;

    const contractShapeValid = ["opportunities", "no_opportunity"].includes(reportStatus)
      && dataStatus
      && typeof dataStatus.usable === "boolean"
      && permission
      && integrity
      && postCloseOpportunityIntegrityReady(report)
      && candidateThemes
      && confirmedThemes
      && rawCards;
    if (!contractShapeValid) return renderUnavailable();

    const confirmedKeys = new Set(confirmedThemes.map(postCloseOpportunityThemeKey).filter(Boolean));
    const seenThemeKeys = new Set();
    const selectedThemes = [];
    const addTheme = (theme, confirmed) => {
      if (selectedThemes.length >= 3) return;
      const key = postCloseOpportunityThemeKey(theme);
      if (!key || seenThemeKeys.has(key)) return;
      seenThemeKeys.add(key);
      selectedThemes.push({
        theme,
        key,
        confirmed,
      });
    };
    confirmedThemes.forEach((theme) => addTheme(theme, true));
    candidateThemes.forEach((theme) => addTheme(theme, false));

    const roleByThemeAndCode = new Map();
    selectedThemes.forEach(({ theme, key }) => {
      const cores = Array.isArray(theme.cores) ? theme.cores : [];
      cores.forEach((core) => {
        const code = postCloseOpportunityCode(core);
        if (!code) return;
        const role = postCloseOpportunityRole(core);
        roleByThemeAndCode.set(`${key}|${code}`, role);
      });
    });

    const seenOpportunityCodes = new Set();
    const opportunityStocks = rawCards.map((card) => {
      const themeKey = postCloseOpportunityText(card.themeId || card.themeName).toLowerCase();
      const code = postCloseOpportunityCode(card);
      const name = postCloseOpportunityText(card.name) || code;
      const themeName = postCloseOpportunityText(card.themeName);
      const canonicalStock = authorizedStocksByCode.get(code);
      if (
        !themeKey
        || !confirmedKeys.has(themeKey)
        || !code
        || !name
        || !themeName
        || seenOpportunityCodes.has(code)
        || !postCloseOpportunityPlanReady(card)
        || !canonicalStock
      ) return null;
      seenOpportunityCodes.add(code);
      const plan = card.plan && typeof card.plan === "object" && !Array.isArray(card.plan) ? card.plan : {};
      const cardRole = postCloseOpportunityRole(card);
      return {
        type: "opportunity",
        code,
        name,
        themeName,
        role: cardRole !== "待确认" ? cardRole : roleByThemeAndCode.get(`${themeKey}|${code}`) || "待确认",
        trigger: postCloseOpportunityText(plan.triggers) || "待确认",
        cancel: postCloseOpportunityText(plan.cancelConditions) || "待确认",
        positionAllocation: canonicalStock.positionAllocation && typeof canonicalStock.positionAllocation === "object"
          ? { ...canonicalStock.positionAllocation }
          : null,
        riskExit: postCloseOpportunityText(plan.riskExit || plan.sell),
      };
    }).filter(Boolean).slice(0, 5);
    const formalCodes = new Set(opportunityStocks.map((stock) => stock.code));
    const opportunityObservation = postCloseOpportunityObservationProjection(payload, report, formalCodes);

    const dataReady = dataStatus.status === "ready" && dataStatus.usable === true;
    const opportunityStateValid = reportStatus !== "opportunities" || (
      dataReady
      && permission.canCreateOpportunities === true
      && ["allowed", "conditional"].includes(postCloseOpportunityText(permission.status))
      && unifiedProjection.executionOpen === true
      && rawCards.every(postCloseOpportunityPlanReady)
      && rawCards.every((card) => authorizedStocksByCode.has(postCloseOpportunityCode(card)))
      && opportunityStocks.length > 0
      && noOpportunity
      && noOpportunity.active === false
    );
    if (!opportunityStateValid) return renderUnavailable();

    const reasonRows = noOpportunity && Array.isArray(noOpportunity.reasons)
      ? noOpportunity.reasons.map(postCloseOpportunityText).filter(Boolean).slice(0, 3)
      : [];
    const reopenRows = noOpportunity && Array.isArray(noOpportunity.nextChecks)
      ? noOpportunity.nextChecks.map(postCloseOpportunityText).filter(Boolean).slice(0, 3)
      : [];
    if (reportStatus === "no_opportunity" && (
      rawCards.length > 0
      || !noOpportunity
      || noOpportunity.active !== true
      || !reasonRows.length
      || !reopenRows.length
    )) return renderUnavailable();

    const unavailableByData = reportStatus === "no_opportunity" && !dataReady;
    const state = reportStatus === "opportunities"
      ? "actionable"
      : unavailableByData
        ? "unavailable"
        : postCloseOpportunityText(permission.status) === "blocked" ? "blocked" : "observe_only";
    const hasModeOrObservation = setupCards.some((card) => (
      postCloseOpportunityText(card.status).toLowerCase() !== "cancelled"
    ))
      || opportunityObservation.rows.length > 0
      || Boolean(rawWatchCards && rawWatchCards.length)
      || selectedThemes.length > 0;
    const headline = state === "actionable"
      ? "明日有条件机会"
      : state === "unavailable"
        ? "盘后数据未准备好"
        : hasModeOrObservation
          ? "暂时没有可直接执行的机会"
          : "暂时无明确机会";
    const heroReason = state === "actionable"
      ? `有 ${selectedThemes.filter((item) => item.confirmed).length} 个方向已确认、${opportunityStocks.length} 份严格计划，仍要等盘中触发。`
      : reasonRows[0] || (hasModeOrObservation
        ? "盘后找到了值得研究的结构，但还没有通过全部执行门槛。"
        : "目前连稳定模式和有效验证核心都没有形成，明天先观察。 ");

    const themeSection = (title, note, rows) => {
      if (!rows.length) return "";
      return `
        <section class="post-close-opportunity-section">
          <header><h3>${title}</h3><p>${note}</p></header>
          <div class="post-close-opportunity-theme-grid">
            ${rows.map(({ theme }) => {
              const name = postCloseOpportunityText(theme.name || theme.family || theme.id) || "题材待确认";
              const cores = Array.isArray(theme.cores)
                ? theme.cores.map((core) => postCloseOpportunityText(core.name || core.code)).filter(Boolean).slice(0, 2)
                : [];
              return `<article class="post-close-opportunity-theme-card"><strong>${escapeHtml(name)}</strong><p>${cores.length ? `代表股票：${cores.map(escapeHtml).join("、")}` : "代表股票待确认"}</p></article>`;
            }).join("")}
          </div>
        </section>`;
    };

    const displayedThemes = state === "unavailable" ? [] : selectedThemes;

    const relationSection = (() => {
      if (state === "unavailable" || !recentRelation) return "";
      const relationToday = recentRelation.today && typeof recentRelation.today === "object"
        ? recentRelation.today
        : {};
      const todayIndex = relationToday.index && typeof relationToday.index === "object"
        ? relationToday.index
        : {};
      const todayEmotion = relationToday.emotion && typeof relationToday.emotion === "object"
        ? relationToday.emotion
        : {};
      const dominant = recentRelation.dominant && typeof recentRelation.dominant === "object"
        ? recentRelation.dominant
        : {};
      const transition = recentRelation.transition && typeof recentRelation.transition === "object"
        ? recentRelation.transition
        : {};
      const daily = Array.isArray(recentRelation.daily)
        ? recentRelation.daily.filter((item) => item && typeof item === "object").slice(-3)
        : [];
      if (!daily.length && Object.keys(relationToday).length) daily.push(relationToday);
      const todayKey = postCloseOpportunityText(
        relationToday.relationKey || recentRelation.relation || dominant.key,
      ).toLowerCase();
      const todayLabel = postCloseRelationLabel(
        relationToday.relationLabel || todayKey || recentRelation.summary,
      );
      const todayIndexLabel = postCloseOpportunityText(
        todayIndex.shortTermLabel || todayIndex.label || recentRelation.indexState,
      ) || "指数状态待确认";
      const todayEmotionLabel = [
        postCloseOpportunityText(todayEmotion.phaseLabel || recentRelation.emotionState),
        postCloseOpportunityText(todayEmotion.qualityLabel),
      ].filter((value, index, rows) => value && rows.indexOf(value) === index).join(" · ") || "情绪状态待确认";
      const seesawConfirmed = dominant.seesawConfirmed === true || transition.seesawConfirmed === true;
      const isDivergence = [
        "index_strong_emotion_weak",
        "index_up_emotion_divergence",
        "index_weak_emotion_strong",
      ].includes(todayKey) || /指数.*(?:走强|强).*(?:情绪|人气核心).*(?:走弱|弱)|指数.*(?:走弱|弱).*(?:情绪|人气核心).*(?:走强|强)/.test(todayLabel);
      const todayNote = isDivergence
        ? seesawConfirmed
          ? "同一背离已连续出现，并有资金切换证据，跷跷板关系获得确认。"
          : "今天出现指数与人气核心背离，尚不能确认跷跷板。"
        : postCloseOpportunityText(transition.note || recentRelation.summary || dominant.reason)
          || "今天的变化仍要结合后续交易日确认。";
      const confirmedByFiveDay = dominant.confirmedByFiveDay === true;
      const confirmText = confirmedByFiveDay
        ? "近5日只作确认：近期主导关系已得到连续数据支持。"
        : "近5日只作确认：目前还没有形成稳定确认。";
      const dailyRows = daily.length ? daily : [{ tradingDate: recentRelation.asOf, relationLabel: todayLabel }];
      return `
        <section class="post-close-opportunity-section post-close-opportunity-relation">
          <header><h3>近期指数—情绪关系</h3><p>最近3日看变化，近5日只作确认</p></header>
          <div class="post-close-opportunity-today-change">
            <span>今日变化</span>
            <strong>${escapeHtml(todayLabel)}</strong>
            <div class="post-close-opportunity-today-facts">
              <span>指数：${escapeHtml(todayIndexLabel)}</span>
              <span>情绪：${escapeHtml(todayEmotionLabel)}</span>
            </div>
            <p>${escapeHtml(todayNote)}</p>
          </div>
          <div class="post-close-opportunity-relation-grid">
            ${dailyRows.slice(-3).map((day) => `
              <article class="post-close-opportunity-relation-day">
                <span>${escapeHtml(postCloseOpportunityDate(day.tradingDate || day.date || day.asOf))}</span>
                <strong>${escapeHtml(postCloseRelationLabel(day))}</strong>
              </article>`).join("")}
          </div>
      <p class="post-close-opportunity-confirm-note">${escapeHtml(confirmText)} 一字和高度只单列观察，不纳入换手核心情绪方向判断。</p>
        </section>`;
    })();

    const planCodes = formalCodes;
    const watchStocks = [];
    const seenWatchCodes = new Set();
    const addWatch = (card, fallbackTheme = "待确认", fallbackRole = "待确认") => {
      if (watchStocks.length >= 5) return;
      const code = postCloseOpportunityCode(card);
      const name = postCloseOpportunityText(card && card.name) || code;
      if (!code || !name || planCodes.has(code) || seenWatchCodes.has(code)) return;
      seenWatchCodes.add(code);
      const status = postCloseCoreStatus(card);
      const usage = postCloseWatchUse(card);
      const role = postCloseOpportunityRole(card);
      const why = postCloseOpportunityRows(card && card.why, 3, true);
      const trigger = postCloseOpportunityRows(card && card.trigger, 3, true);
      const cancel = postCloseOpportunityRows(card && card.cancel, 3, true);
      watchStocks.push({
        code,
        name,
        themeName: postCloseOpportunityText(card && (card.themeName || card.themeId)) || fallbackTheme,
        role: role !== "待确认" ? role : fallbackRole,
        usage,
        coreStatus: status.label,
        coreTruth: status.truth,
        why: why.length ? why.join("；") : "待确认",
        trigger: trigger.length ? trigger.join("；") : "待确认",
        cancel: cancel.length ? cancel.join("；") : "待确认",
        heightOnly: postCloseOpportunityText(card && card.usage).toLowerCase() === "height_only",
      });
    };
    if (state !== "unavailable" && rawWatchCards) {
      rawWatchCards.forEach((card) => addWatch(card));
    } else if (state !== "unavailable" && !rawWatchCards) {
      displayedThemes.forEach(({ theme, key }) => {
        if (opportunityStocks.length + watchStocks.length >= 5) return;
        const themeName = postCloseOpportunityText(theme.name || theme.family || theme.id) || "待确认";
        const cores = Array.isArray(theme.cores) ? theme.cores : [];
        cores.forEach((core) => {
          if (opportunityStocks.length + watchStocks.length >= 5) return;
          addWatch(core, themeName, roleByThemeAndCode.get(`${key}|${postCloseOpportunityCode(core)}`) || "待确认");
        });
      });
    }

    const watchByCode = new Map(watchStocks.map((stock) => [stock.code, stock]));
    opportunityStocks.forEach((stock) => watchByCode.set(stock.code, stock));
    const setupSection = state === "unavailable" || !setupCards.length ? "" : `
      <section class="post-close-opportunity-section post-close-opportunity-setup-section">
        <header><h3>可复制模式</h3><p>模式层：盘后复盘找到的结构，不等于最终计划</p></header>
        <div class="post-close-opportunity-setup-grid">
          ${setupCards.map((card) => {
            const status = postCloseOpportunityText(card.status).toLowerCase();
            const statusLabel = status === "plan_ready"
              ? "模式成立"
              : status === "condition_watch"
                ? "观察验证中"
                : status === "cancelled" ? "模式已取消" : "证据待补";
            const why = postCloseOpportunityRows(card.why, 3, true);
            const trigger = postCloseOpportunityRows(card.trigger, 3, true);
            const cancel = postCloseOpportunityRows(card.cancel, 3, true);
            const benchmark = card.benchmark && typeof card.benchmark === "object" ? card.benchmark : null;
            const validationCodes = [];
            if (benchmark && postCloseOpportunityCode(benchmark)) validationCodes.push(postCloseOpportunityCode(benchmark));
            if (Array.isArray(card.validationCodes)) {
              card.validationCodes.map((value) => postCloseOpportunityText(value).toUpperCase()).filter(Boolean).forEach((code) => {
                if (!validationCodes.includes(code)) validationCodes.push(code);
              });
            }
            const validationRows = validationCodes.slice(0, 3).map((code) => {
              const known = watchByCode.get(code);
              if (known) return `${known.name} ${known.code}（${known.themeName || "题材待确认"}）`;
              if (benchmark && postCloseOpportunityCode(benchmark) === code) {
                const name = postCloseOpportunityText(benchmark.name) || code;
                const themeName = postCloseOpportunityText(benchmark.themeName || benchmark.themeId) || "题材待确认";
                return `${name} ${code}（${themeName}）`;
              }
              return `${code}（身份待确认）`;
            });
            return `
              <article class="post-close-opportunity-setup-card">
                <header><strong>${escapeHtml(postCloseOpportunityText(card.label) || "模式待确认")}</strong><span>${escapeHtml(statusLabel)}</span></header>
                <p>${escapeHtml(postCloseOpportunityRows(card.summary, 1, true)[0] || "模式说明待确认")}</p>
                <div data-field="why"><span>为什么值得研究</span><div>${escapeHtml(why.length ? why.join("；") : "待确认")}</div></div>
                <div data-field="normal"><span>正常走法</span><div>${escapeHtml(postCloseOpportunityRows(card.normalPath, 1, true)[0] || "待确认")}</div></div>
                <div data-field="trigger"><span>观察触发</span><div>${escapeHtml(trigger.length ? trigger.join("；") : "待确认")}</div></div>
                <div data-field="cancel"><span>取消观察</span><div>${escapeHtml(cancel.length ? cancel.join("；") : "待确认")}</div></div>
                <div data-field="risk"><span>主要风险</span><div>${escapeHtml(postCloseOpportunityRows(card.risk, 1, true)[0] || "待确认")}</div></div>
                <div data-field="validation"><span>验证核心</span><div>${escapeHtml(validationRows.length ? validationRows.join("、") : "待确认")}</div></div>
              </article>`;
          }).join("")}
        </div>
      </section>`;

    const watchSection = state === "unavailable" || !watchStocks.length ? "" : `
      <section class="post-close-opportunity-section post-close-opportunity-watch-section">
        <header><h3>验证核心</h3><p>观察验证层：这些是观察股，只负责验证模式，不等于买点</p></header>
        <div class="post-close-opportunity-core-grid">
          ${watchStocks.map((stock) => `
            <article class="post-close-opportunity-core-card post-close-opportunity-watch-card">
              <header>
                <div><strong>${escapeHtml(stock.name)} ${escapeHtml(stock.code)}</strong><small>所属题材：${escapeHtml(stock.themeName)} · 角色：${escapeHtml(stock.role)}</small></div>
                <span class="post-close-opportunity-card-status">${escapeHtml(stock.usage)}</span>
              </header>
              <div data-field="identity"><span>身份</span><div>${escapeHtml(stock.coreStatus)}</div></div>
              <div data-field="core-truth"><span>是否真正核心</span><div>${escapeHtml(stock.coreTruth)}</div></div>
              <div data-field="why"><span>为什么看</span><div>${escapeHtml(stock.why)}</div></div>
              <div data-field="trigger"><span>观察什么</span><div>${escapeHtml(stock.trigger)}</div></div>
              <div data-field="cancel"><span>何时取消</span><div>${escapeHtml(stock.cancel)}</div></div>
        ${stock.heightOnly ? '<p class="post-close-opportunity-height-note">只看空间，不代表交易许可，也不等于买点。</p>' : ""}
            </article>`).join("")}
        </div>
      </section>`;

    const layerSummarySection = state === "unavailable" ? "" : `
      <section class="post-close-opportunity-layer-summary" aria-label="核心观察分层数量">
        <article class="is-plan"><span>严格计划</span><strong>${opportunityStocks.length}只</strong><small>全部门槛通过后才出现</small></article>
        <article class="is-observation"><span>机会观察</span><strong>${opportunityObservation.rows.length}只</strong><small>有条件预期，尚无交易授权</small></article>
        <article class="is-validation"><span>验证核心</span><strong>${watchStocks.length}只</strong><small>只验证题材、情绪和高度</small></article>
      </section>`;

    const opportunityObservationSection = state === "unavailable" || !opportunityObservation.declared ? "" : `
      <section class="post-close-opportunity-section post-close-opportunity-observation-section" data-observation-state="${escapeHtml(opportunityObservation.status)}">
        <header><h3>机会观察股 · ${opportunityObservation.rows.length}只</h3><p>通过观察级硬门槛；需要盘中确认，不授予交易权限</p></header>
        ${opportunityObservation.rows.length ? `
          <div class="post-close-opportunity-core-grid post-close-opportunity-observation-grid">
            ${opportunityObservation.rows.map((stock) => `
              <article class="post-close-opportunity-core-card post-close-opportunity-observation-card">
                <header>
                  <div><strong>${escapeHtml(stock.name)} ${escapeHtml(stock.code)}</strong><small>${escapeHtml(stock.themeName)} · ${escapeHtml(stock.pathLabel)} · ${escapeHtml(stock.role)}</small></div>
                  <span class="post-close-opportunity-card-status">${escapeHtml(stock.tierLabel)}</span>
                </header>
                ${stock.sourceScope === "supplemental_t1_observation" ? '<p class="post-close-opportunity-source-note">T-1补充观察 · 不参与市场偏好归纳</p>' : ""}
                <div data-field="reason"><span>看点</span><div>${escapeHtml(stock.reason)}</div></div>
                <div data-field="confirmation"><span>确认</span><div>${escapeHtml(stock.entryConfirmation)}</div></div>
                <div data-field="next-day"><span>买后次日</span><div>${escapeHtml(stock.nextDayExpectation)}</div></div>
                <div data-field="cancel"><span>取消</span><div>${escapeHtml(stock.cancelCondition)}</div></div>
              </article>`).join("")}
          </div>` : `<div class="post-close-opportunity-layer-empty post-close-opportunity-observation-empty"><strong>暂无合格观察</strong><p>${escapeHtml(opportunityObservation.reason)}</p></div>`}
      </section>`;

    const executionSection = state === "unavailable" ? "" : `
      <section class="post-close-opportunity-section post-close-opportunity-plan-section">
        <header><h3>严格计划卡</h3><p>可执行计划层：只有这一层通过后，才讨论盘中触发</p></header>
        ${opportunityStocks.length ? `
          <div class="post-close-opportunity-core-grid">
            ${opportunityStocks.map((stock) => `
              <article class="post-close-opportunity-core-card post-close-opportunity-plan-card">
                <header>
                  <div><strong>${escapeHtml(stock.name)} ${escapeHtml(stock.code)}</strong><small>所属题材：${escapeHtml(stock.themeName)} · 角色：${escapeHtml(stock.role)}</small></div>
                  <span class="post-close-opportunity-card-status">可执行计划（机会卡）</span>
                </header>
                <div data-field="trigger"><span>触发条件</span><div>${escapeHtml(stock.trigger)}</div></div>
                <div data-field="cancel"><span>取消条件</span><div>${escapeHtml(stock.cancel)}</div></div>
                <div data-field="position"><span>统一链仓位</span><div>${escapeHtml(canonicalPositionAllocationText(stock.positionAllocation) || "统一决策链仓位待确认")}</div></div>
                <div data-field="risk-exit"><span>风险退出</span><div>${escapeHtml(stock.riskExit)}</div></div>
              </article>`).join("")}
          </div>` : '<div class="post-close-opportunity-layer-empty">当前没有通过全部门槛的严格计划。</div>'}
      </section>`;

    const reasonSection = state === "actionable" ? "" : `
      <section class="post-close-opportunity-section">
        <header><h3>${state === "unavailable" ? "为什么现在不能判断" : "为什么暂时不开仓"}</h3><p>只列关键原因</p></header>
        <div class="post-close-opportunity-theme-grid">
          ${reasonRows.map((reason) => `<article class="post-close-opportunity-theme-card"><strong>原因</strong><p>${escapeHtml(reason)}</p></article>`).join("")}
        </div>
      </section>
      <section class="post-close-opportunity-section">
        <header><h3>什么时候重新看</h3><p>条件没满足前不打开机会</p></header>
        <div class="post-close-opportunity-theme-grid">
          ${reopenRows.map((condition) => `<article class="post-close-opportunity-theme-card"><strong>重新开放条件</strong><p>${escapeHtml(condition)}</p></article>`).join("")}
        </div>
      </section>`;

    const confirmedRows = displayedThemes.filter((item) => item.confirmed);
    const observationRows = displayedThemes.filter((item) => !item.confirmed);
    const analysisBody = [
      relationSection,
      setupSection,
      themeSection("已确认方向", "已通过盘后确认，仍要等盘中触发", confirmedRows),
      themeSection("观察方向", "值得关注，但现在还不能当作已确认机会", observationRows),
    ].filter(Boolean).join("");
    const analysisSection = analysisBody ? `
      <details class="post-close-opportunity-analysis-details">
        <summary><span>展开指数关系与模式分析</span><small>默认收起，不遮挡核心观察票</small></summary>
        <div class="post-close-opportunity-analysis-body">${analysisBody}</div>
      </details>` : "";
    mount.dataset.state = state;
    mount.setAttribute("aria-busy", "false");
    mount.innerHTML = `
      <div class="post-close-opportunity-hero">
        <span data-role="eyebrow">明日机会</span>
        <strong data-role="opportunity-headline">${headline}</strong>
        <p data-role="opportunity-reason">${escapeHtml(heroReason)}</p>
      </div>
      ${layerSummarySection}
      ${opportunityObservationSection}
      ${watchSection}
      ${executionSection}
      ${reasonSection}
      ${analysisSection}`;
    return state;
  } catch (error) {
    console.error("[post-close-opportunity] render failed", error);
    return renderUnavailable();
  }
}

function resolveTodaySpeculationStage(payload) {
  const projection = resolveUnifiedDecisionChainProjection(payload);
  const bigCycle = projection.marketStage && projection.marketStage.bigCycle
    && typeof projection.marketStage.bigCycle === "object"
    ? projection.marketStage.bigCycle
    : {};
  const label = projection.contractReady
    ? normalizeBigCycleLabelForDisplay(bigCycle.key || bigCycle.label)
    : "";
  return {
    label: label || "--",
    source: "unifiedDecisionChain.marketStage.bigCycle",
    generationAligned: projection.contractReady,
    contractReady: projection.contractReady,
    blockers: projection.blockers,
  };
}

function renderHotStocks(payload) {

  renderPostCloseOpportunity(payload);















  const stamp = payload.fetchedAt || payload.updatedAt;















  document.querySelector("#hotUpdatedAt").textContent = formatTime(stamp);















  document.querySelector("#eastCount").textContent = `${payload.sources.eastmoney} 只`;















  document.querySelector("#thsCount").textContent = `${payload.sources.ths} 只`;















  renderFetchStatus(payload.fetchStatus, payload);















  renderMarketState(payload.market, payload);















  renderUsFramework(payload);
  renderExternalCoreAlert(payload);















  renderGlobalNews(payload);















  renderRiskBoard(payload);















  renderMasterLeader(payload);















  renderFramework(payload);















  renderTopicBoard(payload);















  renderStyleAnalysis(payload.market.tradingStyle.analysis);















  renderBacktestSummary(payload);































  // 共振三态展示：true=共振 / false=未共振 / null=板块行情没抓到（未验证≠未共振）















  const unclassifiedNote =















    payload.fetchStatus && payload.fetchStatus.unclassified















      ? `<span class="fs-unclassified">⚠️ 另有 ${payload.fetchStatus.unclassified} 只板块标签缺失（数据待补），不作为方向参与排序</span>`















      : "";















  hotConcepts.innerHTML =















    (payload.hotConcepts.length















      ? payload.hotConcepts















          .map((item) => {















            const sectorText = item.sector ? `${item.sector.name} ${formatNumber(item.sector.changePct)}%` : "无板块匹配";















            const resonanceText = item.resonanceLabel || (item.resonance === true ? "共振" : item.resonance === false ? "共振不足" : "共振未验证");
            const stateText = item.directionState ? `${item.directionState.coreLabel || "方向待确认"} / ${item.directionState.dailyLabel || "效应待确认"} / ${item.directionState.repairLabel || "修复待确认"}` : "";















            return `<span>${escapeHtml(resonanceText)} · ${escapeHtml(item.displayName || item.name)} · ${item.count}只 · 热${item.heatScore} / 共${item.resonanceScore} · ${escapeHtml(sectorText)}${stateText ? ` · ${escapeHtml(stateText)}` : ""}</span>`;















          })















          .join("")















      : "<span>暂无方向聚集</span>") + unclassifiedNote;































  const cycleState = (payload.market && payload.market.state) || {};















  const tradingStyle = (payload.market && payload.market.tradingStyle) || {};















  const cycleColor = CYCLE_COLORS[cycleState.cycle] || "#8a8f99";
  const frameStage = resolveTodaySpeculationStage(payload);
  const frameStageColor = CYCLE_COLORS[frameStage.label] || cycleColor;
  const unifiedDecisionProjection = resolveUnifiedDecisionChainProjection(payload);































  const cycleBadge = document.querySelector("#selectedCycleBadge");















  if (cycleBadge) {















    const parts = [frameStage.label || "--"];















    parts.push(unifiedDecisionProjection.executionOpen ? "交易授权开启" : "交易授权关闭");















    parts.push(`仓位${unifiedDecisionProjection.executionOpen ? `${unifiedDecisionProjection.maximumPortfolioPct}%` : "0%"}`);















    cycleBadge.textContent = parts.join(" · ");















    cycleBadge.style.color = frameStageColor;















    cycleBadge.style.fontWeight = "700";















  }































  // 今日炒作框架：炒作阶段 + 短线偏好 + 操作/仓位 + 打法















  setText("#frameStage", frameStage.label);















  setText("#framePreference", shortPreferenceLabel(tradingStyle.preference));















  setText("#frameOperation", unifiedDecisionProjection.executionOpen ? "交易授权开启" : "交易授权关闭");















  setText("#framePosition", unifiedDecisionProjection.executionOpen ? `${unifiedDecisionProjection.maximumPortfolioPct}%` : "0%");















  setText("#frameDirection", unifiedDecisionProjection.executionOpen
    && unifiedDecisionProjection.chain && unifiedDecisionProjection.chain.theme
    && Array.isArray(unifiedDecisionProjection.chain.theme.themes)
    ? unifiedDecisionProjection.chain.theme.themes.join(" / ") || "--"
    : "--");















  setText("#frameScore", unifiedDecisionProjection.contractReady
    && unifiedDecisionProjection.authorization && unifiedDecisionProjection.authorization.tradeValue
    ? unifiedDecisionProjection.authorization.tradeValue.label || "未校准"
    : "--");















  setText("#frameBias", tradingStyle.bias || "先判断当前处于什么炒作阶段，再决定短线偏好是趋势、连板还是轮动。");















  const frameStageEl = document.querySelector("#frameStage");















  if (frameStageEl) {
    frameStageEl.style.color = frameStageColor;
    frameStageEl.dataset.source = frameStage.source;
    frameStageEl.dataset.generationAligned = String(frameStage.generationAligned);
  }















  const framePrefEl = document.querySelector("#framePreference");















  if (framePrefEl) framePrefEl.style.color = frameStageColor;































  // 顶部状态板与实时抓取同源，避免和「今日炒作框架」打架















  setText("#regimeLabel", frameStage.label || "--");






























  setText("#styleLabel", tradingStyle.style || "--");































  // 涨跌停情绪温度：今日涨停/跌停 + 涨停数趋势（前日→昨日→今日），判断升温/退潮















  const limitStats = (payload.market && payload.market.limitStats) || null;















  const emoEl = document.querySelector("#frameEmotion");















  if (emoEl) {















    if (limitStats) {















      const trend = `${limitStats.ztPrev2} → ${limitStats.ztPrev} → ${limitStats.ztToday}`;















      const heating = limitStats.ztToday - limitStats.ztPrev;















      // 涨停数量回落只代表赚钱效应降温，不能单独定义为“退潮”。
      // 退潮必须由后端结合跌停扩散、核心负反馈、赚钱效应坍缩等条件确认。
      const arrow = heating > 0 ? "↑ 涨停升温" : heating < 0 ? "↓ 涨停降温" : "→ 涨停持平";















      const arrowColor = heating > 0 ? "#e23b3b" : heating < 0 ? "#9a6a13" : "#8a8f99";















      const zh = limitStats.ztHistory ? `<small>（曾涨${limitStats.ztHistory}）</small>` : "";















      const dh = limitStats.dtToday != null && limitStats.dtHistory ? `<small>（曾跌${limitStats.dtHistory}）</small>` : "";















      const dtNum = limitStats.dtToday == null ? "—" : limitStats.dtToday;















      const d = limitStats.dates && limitStats.dates.today;















      const dateLabel = d ? `${Number(d.slice(4, 6))}/${Number(d.slice(6, 8))}收盘` : "最近收盘";















      const src = limitStats.source === "ths" ? "同花顺·沪深口径(不含北交所)" : "东财";















      emoEl.innerHTML =















        `${dateLabel} 封涨停 <b>${limitStats.ztToday}</b>${zh} · 封跌停 <b>${dtNum}</b>${dh}` +















        ` ｜ 涨停趋势（前→昨→今） <b>${trend}</b>` +















        ` <span style="color:${arrowColor};font-weight:800">${arrow}</span>` +















        ` <small style="color:#9aa4ad">· ${src}</small>`;















    } else {















      emoEl.textContent = "涨跌停数据暂不可用（数据源限流时会缺省）";















    }















  }































  lastHotPayload = payload;
  renderPremarketFlow(payload);
  void loadIndexOpportunityEvidence(payload);
  renderThemeLibraryFromPayload(payload);















  renderSelectionPools(payload);















  renderDecision(payload); // 今日决策页：四块结论卡
  renderMarketEmotion(payload); // 市场情绪页：锚点验证情绪，主动核心获得交易资格
  renderSuperExpectation(payload); // 超预期页：盘后按五种互斥状态归类，再分别验证弱转强/强转强路线
  renderEventInference(payload); // 事件预期差：严格准入，只辅助方向和买入前置条件
  renderReviewConclusion(payload); // 复盘结论页：把今日定性、明日执行与候选价格汇总















  renderSurvivorBoard(payload); // 活口观察：分歧日板块活口















  renderSellAdvisor(payload); // 卖出方案：持仓收盘复盘
  renderTomorrowOutlook(payload); // 明日预期：分歧衰减→情景+验证+动作






























  recordEntryHistory(payload);















  persistPreplanContext(payload); // 预案页要用：周期门槛常驻 + 候选池带出昨收/MA5















}































// ===== 交易日志（journal.js 前端入口）：录交易 → 出口归因统计，系统验证自己 =====















async function loadJournal() {















  try {















    const [statsRes, tradesRes] = await Promise.all([















      fetch("/api/journal/stats", { cache: "no-store" }),















      fetch("/api/journal/trades", { cache: "no-store" }),















    ]);















    const stats = await statsRes.json();















    const { trades } = await tradesRes.json();















    renderJournalStats(stats);















    renderJournalTrades(trades || []);















  } catch (error) {















    const meta = document.querySelector("#journalStatsMeta");















    if (meta) meta.textContent = `读取失败：${error.message}`;















  }















}































function renderJournalStats(stats) {















  const meta = document.querySelector("#journalStatsMeta");















  const grid = document.querySelector("#journalStatsGrid");















  const table = document.querySelector("#journalExitTable");















  if (!grid) return;















  if (!stats || !stats.count) {















    if (meta) meta.textContent = "暂无记录——每笔平仓都录进来，规则准不准由数据说话";















    grid.innerHTML = "";















    if (table) table.innerHTML = "";















    return;















  }















  if (meta) meta.textContent = `共 ${stats.count} 笔平仓`;















  grid.innerHTML = [















    ["胜率", `${stats.winRatePct}%`],















    ["平均盈利", `+${stats.avgWinPct}%`],















    ["平均亏损", `${stats.avgLossPct}%`],















    ["盈亏比", stats.plRatio ?? "--"],















    ["单笔期望", `${stats.expectancyPct}%`],















    ["累计盈亏", `${stats.cumulativePnlPct}%`],















    ["最大回撤", `${stats.maxDrawdownPct}%`],















  ]















    .map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`)















    .join("");















  if (table) {















    const adherenceTable = (stats.byAdherence || []).length















      ? `<h4 class="journal-sub-title">纪律偏离度 · 三组对比（验证纪律值多少钱）</h4>















        <table class="journal-exit-table">















          <thead><tr><th>组别</th><th>笔数</th><th>胜率</th><th>平均盈亏</th><th>合计贡献</th><th>盈亏比</th></tr></thead>















          <tbody>${stats.byAdherence















            .map(















              (row) =>















                `<tr class="adh-${row.group} ${row.totalPnlPct < 0 ? "exit-losing" : "exit-winning"}">















                  <td>${escapeHtml(row.label)}</td><td>${row.count}</td><td>${row.winRatePct}%</td>















                  <td>${row.avgPnlPct >= 0 ? "+" : ""}${row.avgPnlPct}%</td>















                  <td>${row.totalPnlPct >= 0 ? "+" : ""}${row.totalPnlPct}%</td>















                  <td>${row.plRatio == null ? "--" : row.plRatio}</td>















                </tr>`,















            )















            .join("")}</tbody>















        </table>















        <p class="decision-note">${escapeHtml(stats.adherenceHint || "")}</p>`















      : "";















    table.innerHTML = `















      <table class="journal-exit-table">















        <thead><tr><th>出口（最亏的排最上=先看病灶）</th><th>笔数</th><th>平均盈亏</th><th>合计盈亏</th></tr></thead>















        <tbody>${(stats.byExit || [])















          .map(















            (row) =>















              `<tr class="${row.totalPnlPct < 0 ? "exit-losing" : "exit-winning"}">















                <td>${escapeHtml(row.gate)}</td><td>${row.count}</td>















                <td>${row.avgPnlPct >= 0 ? "+" : ""}${row.avgPnlPct}%</td>















                <td>${row.totalPnlPct >= 0 ? "+" : ""}${row.totalPnlPct}%</td>















              </tr>`,















          )















          .join("")}</tbody>















      </table>















      <p class="decision-note">${escapeHtml(stats.hint || "")}</p>















      ${adherenceTable}`;















  }















}































function renderJournalTrades(trades) {















  const count = document.querySelector("#journalTradesCount");















  const list = document.querySelector("#journalTradesList");















  if (!list) return;















  if (count) count.textContent = `${trades.length} 笔`;















  list.innerHTML = trades.length















    ? trades















        .slice()















        .reverse()















        .slice(0, 20)















        .map(















          (t) => `















        <div class="journal-trade-row ${t.pnlPct >= 0 ? "trade-win" : "trade-loss"}">















          <div class="jt-main"><strong>${escapeHtml(t.name || t.code)}</strong><small>${escapeHtml(t.code)} · ${escapeHtml(t.sector || "")}</small></div>















          <div class="jt-pnl">${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct}%</div>















          <div class="jt-detail">${escapeHtml(t.buyDate)} 买 ${t.buyPrice} → ${escapeHtml(t.sellDate)} 卖 ${t.sellPrice}</div>















          <div class="jt-exit">${escapeHtml(t.exitGate)}${















            t.planAdherence















              ? ` <span class="jt-adh jt-adh-${t.planAdherence}" ${t.deviationNote ? `title="${escapeHtml(t.deviationNote)}"` : ""}>${















                  { followed: "按预案", deviated: "⚠️偏离", no_plan: "系统外" }[t.planAdherence] || t.planAdherence















                }</span>`















              : ""















          }</div>















        </div>`,















        )















        .join("")















    : `<p class="decision-note">还没有记录。</p>`;















}































// ===== 盘后归档（archiver.js 前端入口） =====















const ARCHIVE_STATE_KEY = "archiveHistoryState";















function readArchiveState() {















  return safeParseJSON(localStorage.getItem(ARCHIVE_STATE_KEY) || "null", { rows: [], reports: {} }) || { rows: [], reports: {} };















}















function writeArchiveState(state) {















  const next = {















    rows: Array.isArray(state.rows) ? state.rows.slice(0, 60) : [],















    reports: state.reports && typeof state.reports === "object" ? state.reports : {},















  };















  localStorage.setItem(ARCHIVE_STATE_KEY, JSON.stringify(next));















}















function cacheArchiveRows(rows) {















  const state = readArchiveState();















  state.rows = Array.isArray(rows) ? rows.slice(0, 60) : [];















  writeArchiveState(state);















}















function cacheArchiveReport(date, markdown) {















  if (!date || !markdown) return;















  const state = readArchiveState();















  state.reports = state.reports && typeof state.reports === "object" ? state.reports : {};















  state.reports[date] = markdown;















  writeArchiveState(state);















}















function getCachedArchiveReport(date) {















  const state = readArchiveState();















  return (state.reports && state.reports[date]) || "";















}















function renderArchiveRows(rows) {















  return (rows || []).length















    ? rows















        .slice(0, 30)















        .map(















          (r) => `















          <button class="archive-row" data-report-date="${escapeHtml(r.date)}" type="button">















            <strong>${escapeHtml(r.date)}</strong>















            <span>${escapeHtml(r.cycle || "")}${r.subPhase && r.subPhase !== r.cycle ? "路" + escapeHtml(r.subPhase) : ""}</span>















            <span>娑ㄥ仠${r.ztToday == null ? "鈥?" : r.ztToday} 璺屽仠${r.dtToday == null ? "鈥?" : r.dtToday}${r.zbRatePct != null ? " 鐐告澘鐜?" + r.zbRatePct + "%" : ""}</span>















            <span>${(r.topConcepts || []).slice(0, 3).map(escapeHtml).join(" / ")}</span>















          </button>`,















        )















        .join("")















    : `<p class="decision-note">杩樻病鏈夊綊妗ｈ褰曗€斺€旀敹鐩樻姄鍙栧悗鐐逛笂闈㈢殑鎸夐挳钀藉簱銆?/p>`;















}















async function loadArchiveList() {















  const list = document.querySelector("#archiveIndexList");















  if (!list) return;















  try {















    const res = await fetch("/api/archive/list", { cache: "no-store" });















    const data = await res.json();















    const rows = Array.isArray(data.rows) ? data.rows : [];















    if (rows.length) {















      cacheArchiveRows(rows);















      list.innerHTML = renderArchiveRows(rows);















      return;















    }















    const cached = readArchiveState().rows || [];















    if (cached.length) {















      list.innerHTML = renderArchiveRows(cached);















      return;















    }















    list.innerHTML = `<p class="decision-note">杩樻病鏈夊綊妗ｈ褰曗€斺€旀敹鐩樻姄鍙栧悗鐐逛笂闈㈢殑鎸夐挳钀藉簱銆?/p>`;















  } catch (error) {















    const cached = readArchiveState().rows || [];















    list.innerHTML = cached.length















      ? renderArchiveRows(cached)















      : `<p class="decision-note">褰掓。鍒楄〃璇诲彇澶辫触锛?{escapeHtml(error.message)}</p>`;















  }















}































document.addEventListener("click", async (event) => {















  const runBtn = event.target.closest("#archiveRunBtn");















  if (runBtn) {















    const msg = document.querySelector("#archiveRunMsg");















    runBtn.disabled = true;















    try {















      const res = await fetch("/api/archive/run", { method: "POST" });















      const data = await res.json();















      if (msg) msg.textContent = data.ok ? `鉁?${data.date} 宸插綊妗ｏ細${data.summary.cycle}${data.summary.subPhase ? "路" + data.summary.subPhase : ""}锛屾定鍋?{data.summary.ztToday ?? "鈥?}` : `褰掓。澶辫触锛?{data.error}`;















      if (data.ok) {















        try {















          const reportRes = await fetch(`/api/archive/report?date=${data.date}`, { cache: "no-store" });















          const reportData = await reportRes.json();















          if (reportData.ok && reportData.markdown) cacheArchiveReport(data.date, reportData.markdown);















        } catch {}















      }















      loadArchiveList();















    } catch (error) {















      if (msg) msg.textContent = `褰掓。澶辫触锛?{error.message}`;















    } finally {















      runBtn.disabled = false;















    }















    return;















  }















  const row = event.target.closest("[data-report-date]");















  if (row) {















    const view = document.querySelector("#archiveReportView");















    if (!view) return;















    try {















      const res = await fetch(`/api/archive/report?date=${row.dataset.reportDate}`, { cache: "no-store" });















      const data = await res.json();















      view.hidden = false;















      if (data.ok) {















        view.textContent = data.markdown;















        cacheArchiveReport(row.dataset.reportDate, data.markdown);















      } else {















        const cached = getCachedArchiveReport(row.dataset.reportDate);















        view.textContent = cached || `璇诲彇澶辫触锛?{data.error}`;















      }















      view.scrollIntoView({ behavior: "smooth", block: "nearest" });















    } catch (error) {















      view.hidden = false;















      view.textContent = getCachedArchiveReport(row.dataset.reportDate) || `璇诲彇澶辫触锛?{error.message}`;















    }















  }















});















document.addEventListener("click", async (event) => {















  const runBtn = event.target.closest("#archiveRunBtn");















  if (runBtn) {















    const msg = document.querySelector("#archiveRunMsg");















    runBtn.disabled = true;















    try {















      const res = await fetch("/api/archive/run", { method: "POST" });















      const data = await res.json();















      if (msg) msg.textContent = data.ok ? `✓ ${data.date} 已归档：${data.summary.cycle}${data.summary.subPhase ? "·" + data.summary.subPhase : ""}，涨停${data.summary.ztToday ?? "—"}` : `归档失败：${data.error}`;















      loadArchiveList();















    } catch (error) {















      if (msg) msg.textContent = `归档失败：${error.message}`;















    } finally {















      runBtn.disabled = false;















    }















    return;















  }















  const row = event.target.closest("[data-report-date]");















  if (row) {















    const view = document.querySelector("#archiveReportView");















    if (!view) return;















    try {















      const res = await fetch(`/api/archive/report?date=${row.dataset.reportDate}`, { cache: "no-store" });















      const data = await res.json();















      view.hidden = false;















      view.textContent = data.ok ? data.markdown : `读取失败：${data.error}`;















      view.scrollIntoView({ behavior: "smooth", block: "nearest" });















    } catch (error) {















      view.hidden = false;















      view.textContent = `读取失败：${error.message}`;















    }















  }















});































// ===== 明日可能预期：分歧衰减信号 → 情景A回流/情景B延续 + 验证信号 + 动作 =====















function buildTomorrowOutlookViewModel(source) {
  const hasLivePayload = Boolean(
    source
      && source.tomorrowOutlook
      && (source.unifiedDecisionChain || source.marketState || source.topicBoard || source.candidates || source.selected || source.survivorBoard || source.hotConcepts || source.masterLeader || source.capacityAnchor)
  );
  const outlook = hasLivePayload
    ? (source.tomorrowOutlook || {})
    : (source && source.tomorrowOutlook ? source.tomorrowOutlook : source || {});
  const payload = hasLivePayload ? source : null;
  const unifiedProjection = payload ? resolveUnifiedDecisionChainProjection(payload) : null;
  const savedProjectionValid = Boolean(
    !payload
    && outlook
    && Number(outlook.schemaVersion) === 3
    && outlook.authority === "unified_decision_chain_v3",
  );

  const clean = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  const safeList = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);
  const conceptLabel = (concept, fallback = "暂无明确主线") => {
    if (!concept) return fallback;
    const label = clean(concept.displayName || concept.name || concept.family);
    return label || fallback;
  };
  const stockLabel = (stock, fallback = "暂无") => {
    if (!stock) return fallback;
    const name = clean(stock.name || stock.displayName || stock.code);
    if (!name || name === "--") return fallback;
    const code = clean(stock.code || "");
    return code && code !== "--" ? `${name} ${code}` : name;
  };
  const conceptMatchesStock = (stock, concept) => {
    if (!stock || !concept) return false;
    const conceptNames = [concept.name, concept.displayName, concept.family].map(clean).filter(Boolean);
    const stockNames = [stock.mainConcept, stock.mainFamily, stock.concept].map(clean).filter(Boolean);
    return stockNames.some((stockName) => conceptNames.some((conceptName) => stockName === conceptName || stockName.includes(conceptName) || conceptName.includes(stockName)));
  };
  const roleWeight = (stock) => {
    const role = clean(stock && stock.role);
    const ticketType = clean(stock && stock.ticketType);
    if (role === "龙头") return 4;
    if (role === "中军") return 3;
    if (ticketType === "容量票") return 2;
    if (role === "补涨") return 1;
    return 0;
  };
  const stockWeight = (stock) => {
    if (!stock) return -Infinity;
    return (
      roleWeight(stock) * 1000 +
      (Number(stock.score) || 0) * 10 +
      Math.max(Number(stock.changePct) || 0, 0) * 5 +
      Math.max(Number(stock.amountYi) || 0, 0)
    );
  };
  const pickStock = (list, preferRole = "") => {
    const pool = safeList(list).slice().sort((a, b) => {
      const aPrefer = preferRole && clean(a.role) === preferRole ? 1 : 0;
      const bPrefer = preferRole && clean(b.role) === preferRole ? 1 : 0;
      if (aPrefer !== bPrefer) return bPrefer - aPrefer;
      return stockWeight(b) - stockWeight(a);
    });
    return pool[0] || null;
  };
  const dedupeStrings = (items) => Array.from(new Set((items || []).map(clean).filter(Boolean)));
  const buildScenario = ({ kind, tag, title, summary, anchors, verify, action }) => ({
    kind,
    tag,
    title,
    summary,
    anchors: dedupeStrings(anchors),
    verify: dedupeStrings(verify),
    action: clean(action),
  });

  const marketState = payload ? (payload.marketState || {}) : {};
  const topicBoard = payload ? (payload.topicBoard || {}) : {};
  const hotConcepts = safeList(payload ? payload.hotConcepts : outlook.hotConcepts).slice().sort((a, b) => (Number(b && b.score) || 0) - (Number(a && a.score) || 0));
  const selected = payload
    ? (unifiedProjection.executionOpen ? unifiedProjection.stocks : [])
    : (savedProjectionValid ? safeList(outlook.selected) : []);
  const candidates = selected;
  const survivorItems = safeList(payload ? ((payload.survivorBoard && payload.survivorBoard.items) || []) : ((outlook.survivorBoard && outlook.survivorBoard.items) || []));
  const authorizedCodes = new Set(candidates.map((stock) => clean(stock && stock.code)).filter(Boolean));
  const authorizedAnchor = (stock) => stock && authorizedCodes.has(clean(stock.code)) ? stock : null;
  const masterLeader = payload ? authorizedAnchor(payload.masterLeader) : (savedProjectionValid ? outlook.masterLeader : null);
  const emotionAnchor = payload ? (authorizedAnchor(payload.emotionAnchor) || masterLeader) : (savedProjectionValid ? outlook.emotionAnchor || masterLeader : null);
  const capacityAnchor = payload ? authorizedAnchor(payload.capacityAnchor) : (savedProjectionValid ? outlook.capacityAnchor : null);

  const chainThemeNames = payload && unifiedProjection.contractReady
    && unifiedProjection.chain && unifiedProjection.chain.theme && Array.isArray(unifiedProjection.chain.theme.themes)
    ? unifiedProjection.chain.theme.themes.map(clean).filter(Boolean)
    : savedProjectionValid ? safeList(outlook.authorizedThemes).map(clean).filter(Boolean) : [];
  const conceptByName = (name) => {
    const normalizedName = clean(name);
    if (!normalizedName) return null;
    return hotConcepts.find((concept) => {
    const labels = [concept && concept.name, concept && concept.displayName, concept && concept.family].map(clean).filter(Boolean);
      return labels.some((label) => label === normalizedName || label.includes(normalizedName) || normalizedName.includes(label));
    }) || { name: normalizedName, displayName: normalizedName, authority: "unified_decision_chain_v3" };
  };
  const focusConcept = conceptByName(chainThemeNames[0]);
  const secondaryConcept = conceptByName(chainThemeNames[1]);
  const focusConceptLabel = conceptLabel(focusConcept, "暂无明确主线");
  const secondaryConceptLabel = conceptLabel(secondaryConcept, "次强方向");

  const leadershipBoard = payload
    ? (payload.leadershipBoard || {})
    : (outlook.leadershipBoard || {});
  const byCode = new Map(candidates.map((stock) => [clean(stock && stock.code), stock]));
  const leadershipRows = [];
  const seenLeadershipCodes = new Set();
  safeList(leadershipBoard.tradeCarriers).concat(safeList(leadershipBoard.leaders)).forEach((row) => {
    const code = clean(row && row.code);
    if (!code || !authorizedCodes.has(code) || seenLeadershipCodes.has(code)) return;
    seenLeadershipCodes.add(code);
    const sourceStock = byCode.get(code) || {};
    leadershipRows.push({ ...sourceStock, ...row, leadership: sourceStock.leadership || row });
  });
  // 核心锚定只接受后端明确确认的核心身份。旧 role、selected、热榜第一名
  // 都不能兜底成“龙头”，否则会把一字高度票和普通候选硬贴成核心。
  const identityCores = leadershipRows
    .filter((stock) => stock && (
      stock.coreIdentityQualified === true
      || stock.tradeQualified === true
      || stock.coreQualified === true
    ))
    .sort((a, b) => {
      const initiativeDiff = Number(b.initiative && b.initiative.score || b.leadership && b.leadership.initiative && b.leadership.initiative.score || 0)
        - Number(a.initiative && a.initiative.score || a.leadership && a.leadership.initiative && a.leadership.initiative.score || 0);
      if (initiativeDiff) return initiativeDiff;
      return Number(b.amountYi || 0) - Number(a.amountYi || 0);
    });
  const executionOrderedCores = identityCores.slice().sort((a, b) => {
    const aTrade = a && (a.tradeQualified === true || a.coreQualified === true) ? 1 : 0;
    const bTrade = b && (b.tradeQualified === true || b.coreQualified === true) ? 1 : 0;
    if (aTrade !== bTrade) return bTrade - aTrade;
    const initiativeDiff = Number(b && b.initiative && b.initiative.score || 0)
      - Number(a && a.initiative && a.initiative.score || 0);
    if (initiativeDiff) return initiativeDiff;
    return Number(b && b.amountYi || 0) - Number(a && a.amountYi || 0);
  });
  const focusIdentityCores = identityCores.filter((stock) => !focusConcept || conceptMatchesStock(stock, focusConcept));
  const secondaryIdentityCores = identityCores.filter((stock) => secondaryConcept && conceptMatchesStock(stock, secondaryConcept));
  const focusExecutionCores = executionOrderedCores.filter((stock) => !focusConcept || conceptMatchesStock(stock, focusConcept));
  const secondaryExecutionCores = executionOrderedCores.filter((stock) => secondaryConcept && conceptMatchesStock(stock, secondaryConcept));
  const coreType = (stock) => clean(stock && (stock.anchorType || stock.identity || stock.leadership && (stock.leadership.anchorType || stock.leadership.identity)));
  const isCapacityCore = (stock) => /容量|中军|capacity/i.test(coreType(stock));
  const isActiveCore = (stock) => /主动|龙头|leader/i.test(coreType(stock));
  const focusLeaderStock = focusIdentityCores.find(isActiveCore) || focusIdentityCores[0] || null;
  const focusCapacityStock = focusIdentityCores.find(isCapacityCore) || null;
  const secondaryLeaderStock = secondaryIdentityCores.find(isActiveCore) || secondaryIdentityCores[0] || null;
  const identityCoreCodes = new Set(identityCores.map((stock) => clean(stock && stock.code)).filter(Boolean));
  const verifiedSurvivorItems = survivorItems.filter((item) => identityCoreCodes.has(clean(item && item.code)));
  const liveStock = verifiedSurvivorItems[0] || null;
  const liveLimitStock = verifiedSurvivorItems.find((item) => item.limitUp) || liveStock || null;
  const defensiveStock = liveLimitStock || liveStock || focusCapacityStock || focusLeaderStock || null;
  const coreStockEntries = [];
  const pushCoreStock = (label, stock, note = "") => {
    const value = stockLabel(stock);
    if (!value) return;
    if (coreStockEntries.some((item) => item.value === value)) return;
    coreStockEntries.push({ label: clean(label), value, note: clean(note) });
  };
  const coreLabel = (stock, fallback) => {
    const type = coreType(stock);
    const base = /主动.*容量|容量.*主动/.test(type)
      ? "主动容量"
      : /容量|中军|capacity/i.test(type)
        ? "容量核心"
        : /情绪|生态|sentiment/i.test(type)
          ? "情绪生态"
          : /主动|龙头|leader/i.test(type)
            ? "主动核心"
            : fallback;
    const state = clean(stock && (stock.tradeState || stock.leadership && stock.leadership.tradeState));
    return state ? `${base}·${state}` : base;
  };
  const coreNote = (stock) => clean(stock && (
    stock.executionNote
    || stock.flowNature && stock.flowNature.label
    || stock.reason
  ));
  focusExecutionCores.slice(0, 4).forEach((stock) => {
    pushCoreStock(coreLabel(stock, "核心验证"), stock, coreNote(stock));
  });
  pushCoreStock(coreLabel(secondaryLeaderStock, "次强核心"), secondaryLeaderStock, coreNote(secondaryLeaderStock));
  const coreStocks = coreStockEntries.slice(0, 4);

  const signals = safeList(outlook.signals).map((signal) => ({
    name: clean(signal.name),
    note: clean(signal.note),
    ok: signal.ok === true ? true : signal.ok === false ? false : null,
  }));
  const knownSignals = signals.filter((signal) => signal.ok !== null);
  const signalSummary = signals.length
    ? knownSignals.length
      ? `已判定 ${knownSignals.length}/${signals.length}${signals.length - knownSignals.length ? `，其余 ${signals.length - knownSignals.length} 项因缺昨日归档/对比样本未展开` : ""}`
      : "本次信号大多无法验证，先看明早竞价和高标开盘。"
    : "暂无可用信号，先看明早竞价和高标开盘。";

  const marketCycle = payload
    ? clean(unifiedProjection.contractReady && unifiedProjection.marketStage && unifiedProjection.marketStage.bigCycle && unifiedProjection.marketStage.bigCycle.label)
    : (savedProjectionValid ? clean(outlook.marketCycle) : "");
  const marketSubPhase = payload
    ? clean(unifiedProjection.contractReady && unifiedProjection.marketStage && (
      unifiedProjection.marketStage.smallCycle && unifiedProjection.marketStage.smallCycle.label
      || unifiedProjection.marketStage.transition && unifiedProjection.marketStage.transition.label
    ))
    : (savedProjectionValid ? clean(outlook.marketSubPhase) : "");
  const chainTradeValueScore = payload && unifiedProjection.authorization && unifiedProjection.authorization.tradeValue
    ? Number(unifiedProjection.authorization.tradeValue.score) : NaN;
  const marketScore = payload
    ? (Number.isFinite(chainTradeValueScore) ? chainTradeValueScore : null)
    : (savedProjectionValid && Number.isFinite(Number(outlook.marketScore)) ? Number(outlook.marketScore) : null);
  const scoreText = marketScore == null ? "未知" : `${marketScore}分`;

  const mode = payload && !unifiedProjection.executionOpen
    ? "blocked"
    : marketCycle === "退潮" || marketCycle === "冰点"
    ? "riskoff"
    : outlook.bias === "偏回流"
      ? "reflow"
      : outlook.bias === "偏延续"
        ? "continue"
        : outlook.bias === "常规"
          ? "rotation"
          : "balance";

  const modeLabelMap = {
    reflow: "轮动回流",
    continue: "分歧延续",
    rotation: "常规轮动",
    balance: "方向待确认",
    riskoff: "继续防守",
    blocked: "交易授权关闭",
  };
  const headlineMap = {
    reflow: "明日主预期：主线回流，优先看核心承接",
    continue: "明日主预期：分歧延续，先看抗跌活口",
    rotation: "明日主预期：常规轮动，围绕主线核心看延续",
    balance: "明日主预期：方向待确认，等竞价和高标给答案",
    riskoff: "明日主预期：继续走弱概率上升，先按退潮防守",
    blocked: "明日主预期：统一决策链未授权新开仓",
  };
  const headline = mode === "blocked" ? headlineMap.blocked : clean(outlook.headline) || headlineMap[mode];

  const summaryParts = [];
  if (marketCycle) summaryParts.push(`周期 ${marketCycle}${marketSubPhase ? `·${marketSubPhase}` : ""}`);
  if (scoreText !== "未知") summaryParts.push(`赚钱效应 ${scoreText}`);
  summaryParts.push(`主线 ${focusConceptLabel}`);
  if (focusLeaderStock) summaryParts.push(`主动核心 ${stockLabel(focusLeaderStock)}`);
  if (focusCapacityStock && focusCapacityStock !== focusLeaderStock) summaryParts.push(`容量 ${stockLabel(focusCapacityStock)}`);
  const subline = clean(outlook.subline) || summaryParts.join(" · ");
  const basisLine = clean(outlook.basisLine || outlook.biasNote || outlook.keyLine);

  const anchors = [];
  const pushAnchor = (label, value, note = "") => {
    const text = clean(value);
    if (!text) return;
    if (anchors.some((anchor) => anchor.value === text)) return;
    anchors.push({ label: clean(label), value: text, note: clean(note) });
  };
  pushAnchor("周期", marketCycle ? `${marketCycle}${marketSubPhase ? `·${marketSubPhase}` : ""}` : "暂无");
  pushAnchor("赚钱效应", scoreText);
  pushAnchor("主线", focusConceptLabel, focusConcept && focusConcept.reason);
  if (secondaryConceptLabel && secondaryConceptLabel !== focusConceptLabel) {
    pushAnchor("次强", secondaryConceptLabel, secondaryConcept && secondaryConcept.reason);
  }

  const scenarioStockLabel = (stock) => stockLabel(stock, "");
  const focusCoreAnchors = focusExecutionCores.slice(0, 3).map(scenarioStockLabel).filter(Boolean);
  const secondaryCoreAnchors = secondaryExecutionCores.slice(0, 3).map(scenarioStockLabel).filter(Boolean);
  const primaryAnchors = [focusConceptLabel, ...focusCoreAnchors];
  const secondaryAnchors = [secondaryConceptLabel, ...(secondaryCoreAnchors.length ? secondaryCoreAnchors : focusCoreAnchors)];
  const riskAnchors = focusCoreAnchors.length
    ? focusCoreAnchors
    : [scenarioStockLabel(focusCapacityStock), scenarioStockLabel(defensiveStock), scenarioStockLabel(focusLeaderStock)].filter(Boolean);

  let scenarios = [];
  if (mode === "blocked") {
    scenarios = [
      buildScenario({
        kind: "risk",
        tag: "统一授权",
        title: "保持空仓或只管理已有持仓",
        summary: "统一决策链没有授权新增仓位，旧热榜、旧候选和旧明日预期都不能恢复交易资格。",
        anchors: [],
        verify: ["等待同一代次统一决策链重新授权", "重新授权前不新增仓位"],
        action: "新增仓位保持0%，已有持仓按独立卖出规则管理。",
      }),
    ];
  } else if (mode === "reflow") {
    scenarios = [
      buildScenario({
        kind: "primary",
        tag: "主预期",
        title: "主线回流",
        summary: `${focusConceptLabel} 若继续获得承接，明天先看主线核心是否回到主动。`,
        anchors: primaryAnchors,
        verify: ["高标不再大面积核按钮", `${focusConceptLabel} 核心开盘不破`, "成交承接不继续缩"],
        action: "只在主线核心里做回流，不追后排；没承接就等。",
      }),
      buildScenario({
        kind: "secondary",
        tag: "次预期",
        title: "强方向兑现后轮动",
        summary: `如果今天最强方向先兑现，资金会切向次强方向 ${secondaryConceptLabel}，先找还能承接的核心。`,
        anchors: secondaryAnchors,
        verify: ["强方向冲高回落", "次强方向开始放量", "活口没有同步掉队"],
        action: "核心里找新承接，不接兑现段。",
      }),
      buildScenario({
        kind: "risk",
        tag: "风险",
        title: "继续走弱",
        summary: "若指数和情绪继续下探，回流预期失效，先按退潮防守。",
        anchors: riskAnchors,
        verify: ["指数继续破位", "跌停/炸板继续扩大", "活口数量减少"],
        action: "不追反弹，等冰点修复再看。",
      }),
    ];
  } else if (mode === "continue") {
    scenarios = [
      buildScenario({
        kind: "primary",
        tag: "主预期",
        title: "分歧延续",
        summary: `今天的负反馈如果没消化，明天先看 ${focusConceptLabel} 核心能不能抗住。`,
        anchors: primaryAnchors,
        verify: ["高标继续转弱", "跌停仍在扩", "承接没有回暖"],
        action: "不接盘中反抽，只等分歧继续衰减。",
      }),
      buildScenario({
        kind: "secondary",
        tag: "次预期",
        title: "局部修复",
        summary: "如果只有少数活口先行，把它当局部修复，不上升为全市场回流。",
        anchors: [scenarioStockLabel(defensiveStock), secondaryConceptLabel, scenarioStockLabel(secondaryLeaderStock)],
        verify: ["少数活口先行", "板块扩散不足", "指数未同步转强"],
        action: "只看活口和核心，不追扩散。",
      }),
      buildScenario({
        kind: "risk",
        tag: "风险",
        title: "继续下探",
        summary: "若指数和情绪继续走弱，先看防守锚能不能扛住。",
        anchors: riskAnchors,
        verify: ["指数再度走弱", "跌停/炸板继续放大", "活口数量减少"],
        action: "不接反弹，等冰点或修复确认。",
      }),
    ];
  } else if (mode === "rotation") {
    scenarios = [
      buildScenario({
        kind: "primary",
        tag: "主预期",
        title: "常规轮动",
        summary: `今天不是明显分歧，明天更像围绕 ${focusConceptLabel} 和 ${secondaryConceptLabel} 做轮动。`,
        anchors: primaryAnchors,
        verify: ["主线方向继续有梯队", "核心票不大幅补跌", "量能不明显塌"],
        action: "以主线核心和容量票为先，不追后排杂毛。",
      }),
      buildScenario({
        kind: "secondary",
        tag: "次预期",
        title: "强方向兑现",
        summary: "若今日强方向先兑现，资金会切到次强方向，先看承接。",
        anchors: secondaryAnchors,
        verify: ["强方向冲高回落", "次强方向开始放量", "主线仍有活口"],
        action: "兑现段不接，等次强方向给确认。",
      }),
      buildScenario({
        kind: "risk",
        tag: "风险",
        title: "缩量失真",
        summary: "如果成交和承接同步收缩，轮动会失真，先看防守锚。",
        anchors: riskAnchors,
        verify: ["成交额明显缩", "承接转弱", "活口数量下降"],
        action: "先降期待，等更清晰的回流信号。",
      }),
    ];
  } else if (mode === "riskoff") {
    scenarios = [
      buildScenario({
        kind: "primary",
        tag: "主预期",
        title: "继续防守",
        summary: "如果明天继续下跌，先把市场按退潮/冰点处理，只看抗跌活口。",
        anchors: riskAnchors,
        verify: ["指数继续破位", "高标继续核按钮", "活口数量减少"],
        action: "不追反弹，先等冰点修复。",
      }),
      buildScenario({
        kind: "secondary",
        tag: "次预期",
        title: "冰点修复",
        summary: "如果盘中先出现修复，仍要先确认活口和承接，不抢第一段反弹。",
        anchors: [scenarioStockLabel(defensiveStock), secondaryConceptLabel, scenarioStockLabel(secondaryLeaderStock)],
        verify: ["活口先翻红", "跌停收敛", "承接重新回来"],
        action: "只做确认后的修复，不抢第一波。",
      }),
      buildScenario({
        kind: "risk",
        tag: "风险",
        title: "杀跌延伸",
        summary: "若反弹失败，退潮继续延伸，核心只留观察，不急着进场。",
        anchors: [scenarioStockLabel(focusLeaderStock), scenarioStockLabel(focusCapacityStock), scenarioStockLabel(defensiveStock)],
        verify: ["反弹冲高回落", "跌停不收敛", "成交承接继续恶化"],
        action: "等情绪真正止跌再看。",
      }),
    ];
  } else {
    scenarios = [
      buildScenario({
        kind: "primary",
        tag: "主预期",
        title: "方向待确认",
        summary: "信号不够完整，明早还是先看竞价和高标开盘。",
        anchors: primaryAnchors,
        verify: ["竞价没有明显核按钮", "主线核心不破", "成交承接不继续缩"],
        action: "先观察，不提前押方向。",
      }),
      buildScenario({
        kind: "secondary",
        tag: "次预期",
        title: "局部轮动",
        summary: `若 ${focusConceptLabel} 没有直接走出来，资金可能先在次强方向 ${secondaryConceptLabel} 里打转。`,
        anchors: secondaryAnchors,
        verify: ["次强方向先放量", "主线未完全失效", "活口仍在"],
        action: "只看核心，不追噪音。",
      }),
      buildScenario({
        kind: "risk",
        tag: "风险",
        title: "继续回落",
        summary: "如果市场继续跌，先把仓位按防守思路处理，等更明确的修复。",
        anchors: riskAnchors,
        verify: ["指数走弱", "跌停不收敛", "活口减少"],
        action: "空仓或轻仓观察，等确认后再出手。",
      }),
    ];
  }

  const savedAnchors = safeList(outlook.anchors).map((anchor) => ({
    label: clean(anchor.label),
    value: clean(anchor.value),
    note: clean(anchor.note),
  })).filter((anchor) => anchor.value);
  const savedCoreStocks = safeList(outlook.coreStocks).map((anchor) => ({
    label: clean(anchor.label),
    value: clean(anchor.value),
    note: clean(anchor.note),
  })).filter((anchor) => anchor.value);
  const savedScenarios = safeList(outlook.scenarios).map((scenario, index) => ({
    kind: clean(scenario.kind) || (index === 0 ? "primary" : index === 1 ? "secondary" : "risk"),
    tag: clean(scenario.tag) || clean(scenario.label) || (index === 0 ? "主预期" : index === 1 ? "次预期" : "风险"),
    title: clean(scenario.title) || clean(scenario.name) || "待定",
    summary: clean(scenario.summary) || clean(scenario.note) || clean(scenario.action) || "",
    anchors: dedupeStrings(scenario.anchors || []),
    verify: dedupeStrings(scenario.verify || []),
    action: clean(scenario.action || ""),
  })).filter((scenario) => scenario.title || scenario.summary || scenario.action);

  return {
    ...outlook,
    schemaVersion: 3,
    authority: "unified_decision_chain_v3",
    contractReady: payload ? unifiedProjection.contractReady : savedProjectionValid && outlook.contractReady === true,
    executionOpen: payload ? unifiedProjection.executionOpen : savedProjectionValid && outlook.executionOpen === true,
    generationId: payload ? unifiedProjection.generationId : clean(outlook.generationId),
    tradingDate: payload ? unifiedProjection.tradingDate : clean(outlook.tradingDate),
    marketCycle,
    marketSubPhase,
    marketScore,
    authorizedThemes: chainThemeNames,
    selected: candidates,
    biasClass: { 偏回流: "ob-reflow", 偏延续: "ob-continue", 均衡: "ob-even", 常规: "ob-normal" }[outlook.bias] || "ob-normal",
    biasBadge: mode === "blocked" ? modeLabelMap.blocked : clean(outlook.biasBadge) || modeLabelMap[mode],
    headline,
    subline,
    basisLine,
    signalSummary,
    signals,
    anchors: payload ? anchors : savedAnchors,
    coreStocks: payload ? coreStocks : (savedCoreStocks.length ? savedCoreStocks : coreStocks),
    coreIdentityReady: identityCores.length > 0,
    scenarios: payload ? scenarios : (savedScenarios.length ? savedScenarios : scenarios),
  };
}
function outlookHtml(viewModel) {
  const model = viewModel || {};
  const signals = Array.isArray(model.signals) ? model.signals.filter(Boolean) : [];
  const signalChips = signals.length
    ? signals
        .map((signal) => {
          const cls = signal.ok === true ? "ok" : signal.ok === false ? "bad" : "na";
          const mark = signal.ok === true ? "✓" : signal.ok === false ? "✗" : "⚠️";
          const title = signal.note ? ` title="${escapeHtml(signal.note)}"` : "";
          return `<span class="outlook-signal os-${cls}"${title}>${mark} ${escapeHtml(signal.name || "信号")}</span>`;
        })
        .join("")
    : `<span class="outlook-signal os-na">⚠️ 暂无可用信号</span>`;

  const anchors = Array.isArray(model.anchors) ? model.anchors : [];
  const anchorChips = anchors
    .map((anchor) => {
      const title = anchor.note ? ` title="${escapeHtml(anchor.note)}"` : "";
      return `<span class="outlook-anchor"${title}><strong>${escapeHtml(anchor.label || "锚点")}</strong><span>${escapeHtml(anchor.value || "--")}</span></span>`;
    })
    .join("");

  const scenarios = Array.isArray(model.scenarios) ? model.scenarios : [];
  const renderScenarioCard = (scenario) => {
    const kind = scenario.kind || "secondary";
    const cardClass = `outlook-scenario is-${kind}`;
    const tag = scenario.tag || (kind === "primary" ? "主预期" : kind === "risk" ? "风险" : "次预期");
    const anchorsHtml = Array.isArray(scenario.anchors) && scenario.anchors.length
      ? `<div class="outlook-scenario-anchors">${scenario.anchors.map((anchor) => `<span class="outlook-scenario-anchor">${escapeHtml(anchor)}</span>`).join("")}</div>`
      : "";
    const verifyTargets = Array.isArray(scenario.anchors)
      ? scenario.anchors.filter((anchor) => /\b\d{6}\b/.test(String(anchor || ""))).slice(0, 3)
      : [];
    const verifyTargetsHtml = verifyTargets.length
      ? `<p class="outlook-verify-targets"><b>具体标的：</b>${verifyTargets.map((target) => escapeHtml(target)).join("、")}</p>`
      : `<p class="outlook-verify-targets is-empty"><b>具体标的：</b>当前数据暂未识别出可验证核心，先不做个股结论</p>`;
    const verifyHtml = Array.isArray(scenario.verify) && scenario.verify.length
      ? `<div class="outlook-verify"><span>明早验证：</span>${verifyTargetsHtml}<ul>${scenario.verify.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`
      : "";
    return `
      <div class="${cardClass}">
        <span class="outlook-scenario-tag">${escapeHtml(tag)}</span>
        <strong>${escapeHtml(scenario.title || scenario.name || "待定")}</strong>
        ${scenario.summary ? `<p class="outlook-scenario-summary">${escapeHtml(scenario.summary)}</p>` : ""}
        ${anchorsHtml}
        ${verifyHtml}
        ${scenario.action ? `<p class="outlook-action">→ ${escapeHtml(scenario.action)}</p>` : ""}
      </div>`;
  };

  const primaryScenario = scenarios[0] || null;
  const sideScenarios = scenarios.slice(1, 3);

  return `
    <div class="outlook-panel">
      <div class="outlook-head">
        <div class="outlook-head-text">
          <p class="outlook-kicker">明日主预期</p>
          <h4 class="outlook-title">${escapeHtml(model.headline || model.biasNote || "明日预期待确认")}</h4>
        </div>
        <span class="outlook-bias ${model.biasClass || "ob-normal"}">${escapeHtml(model.biasBadge || (model.bias === "常规" ? "常规轮动" : model.bias || "方向待确认"))}</span>
      </div>
      ${model.subline ? `<p class="outlook-subline">${escapeHtml(model.subline)}</p>` : ""}
      ${model.basisLine ? `<p class="outlook-basisline">${escapeHtml(model.basisLine)}</p>` : ""}
      <div class="outlook-core-box${Array.isArray(model.coreStocks) && model.coreStocks.length ? "" : " is-empty"}">
        <span class="outlook-core-label">核心锚定</span>
        <div class="outlook-core-stocks">${Array.isArray(model.coreStocks) && model.coreStocks.length
          ? model.coreStocks.map((anchor) => {
              const title = anchor.note ? ` title="${escapeHtml(anchor.note)}"` : "";
              return `<span class="outlook-core-stock"${title}><em>${escapeHtml(anchor.label || "核心")}</em><strong>${escapeHtml(anchor.value || "--")}</strong></span>`;
            }).join("")
          : `<span class="outlook-core-empty"><strong>暂无合格核心</strong><small>不以连板高度、热榜或普通候选强制补位</small></span>`}</div>
      </div>
      ${anchorChips ? `<div class="outlook-anchors">${anchorChips}</div>` : ""}
      ${primaryScenario ? `<div class="outlook-main-scenario">${renderScenarioCard(primaryScenario)}</div>` : ""}
      ${sideScenarios.length ? `<div class="outlook-scenario-grid">${sideScenarios.map(renderScenarioCard).join("")}</div>` : ""}
      ${model.signalSummary ? `<p class="outlook-signal-summary">${escapeHtml(model.signalSummary)}</p>` : ""}
      <div class="outlook-signals">${signalChips}</div>
      <p class="decision-note">${escapeHtml(model.keyLine || "")}${model.prevArchiveDate ? `（昨日对比基于 ${model.prevArchiveDate} 归档）` : "（⚠️无昨日归档，衰减对比缺失——收盘后记得点归档落库）"}</p>
    </div>`;
}
function renderTomorrowOutlook(payload) {
  const viewModel = buildTomorrowOutlookViewModel(payload);

  const biasClass = viewModel
    ? viewModel.biasClass || { 偏回流: "ob-reflow", 偏延续: "ob-continue", 均衡: "ob-even", 常规: "ob-normal" }[viewModel.bias] || "ob-normal"
    : "ob-normal";

  for (const [biasSel, bodySel] of [
    ["#decisionOutlookBias", "#decisionOutlookBody"],
    ["#ppOutlookBias", "#ppOutlookBody"],
    ["#jnOutlookBias", "#jnOutlookBody"], // 交易日志页:看预期→顺手归档,同一动线
  ]) {
    const biasEl = document.querySelector(biasSel);
    const bodyEl = document.querySelector(bodySel);

    if (biasEl && viewModel) {
      biasEl.textContent = viewModel.biasBadge || (viewModel.bias === "常规" ? "常规轮动" : `明日${viewModel.bias || "方向待确认"}`);
      biasEl.className = `outlook-bias ${biasClass}`;
    }

    if (bodyEl) bodyEl.innerHTML = outlookHtml(viewModel);
  }

  // 存下来给预案页离线用（预案页可能在未抓取时打开）
  try {
    if (viewModel) localStorage.setItem("shortModelOutlook", JSON.stringify(viewModel));
  } catch {}
}































// ===== 活口观察：板块被杀跌时逆势走强的票，回流日的资金记忆点 =====















function renderSurvivorBoard(payload) {















  const env = document.querySelector("#survivorEnv");















  const list = document.querySelector("#survivorList");















  if (!env || !list) return;















  const sb = payload.survivorBoard;















  if (!sb) {















    env.textContent = "旧缓存数据无活口字段，请重新抓取";















    return;















  }















  env.textContent = sb.divergenceDay ? "大分歧日 · 活口含金量高" : "非大分歧日";















  env.className = sb.divergenceDay ? "survivor-env-hot" : "survivor-env-normal";































  if (!sb.items.length) {















    list.innerHTML = `<p class="decision-note">${escapeHtml(sb.envNote)}</p>















      <p class="decision-note">今日热门方向里没有符合标准的活口（板块没被杀跌，或杀跌方向全军覆没）——不硬凑。</p>`;















    return;















  }















  list.innerHTML =















    `<p class="decision-note">${escapeHtml(sb.envNote)}</p>` +















    sb.items















      .map(















        (item) => `















      <article class="survivor-card ${item.limitUp ? "survivor-limit" : ""}">















        <div class="survivor-head">















          <div>















            <strong>${escapeHtml(item.name)}</strong>















            <small>${item.code} · ${escapeHtml(item.concept)}</small>















          </div>















          <div class="survivor-badges">















            ${item.limitUp ? `<span class="survivor-tag st-limit">真涨停</span>` : ""}















            ${item.popularity ? `<span class="survivor-tag">${escapeHtml(item.popularity)}</span>` : ""}















            ${item.isST ? `<span class="survivor-tag st-warn">ST票·仅观察</span>` : ""}















          </div>















        </div>















        <div class="survivor-metrics">















          <span>它 <b class="${item.changePct >= 0 ? "up" : "down"}">${item.changePct >= 0 ? "+" : ""}${item.changePct}%</b></span>















          <span>${escapeHtml(item.baseLabel)}</span>















          <span>逆势强度 <b>+${item.edge}pt</b></span>















          <span>热榜 ${item.combinedRank}</span>















        </div>















        <p class="survivor-reason">${escapeHtml(item.reason)}</p>















      </article>`,















      )















      .join("");















}































// ===== 今日决策页：只给结论，不给分析过程（详细面板在各自视图里保留） =====















function renderMarketEmotion(payload) {
  const model = payload && payload.marketEmotion ? payload.marketEmotion : null;
  const hero = document.querySelector("#marketEmotionHero");
  const review = document.querySelector("#marketEmotionReview");
  const metrics = document.querySelector("#marketEmotionMetrics");
  const groups = document.querySelector("#marketEmotionGroups");
  const validation = document.querySelector("#marketEmotionValidation");
  const meta = document.querySelector("#marketEmotionMeta");
  if (!hero || !metrics || !groups || !validation) return;

  if (!model) {
    hero.className = "market-emotion-hero is-empty";
    hero.innerHTML = `
      <div class="market-light" aria-hidden="true"><span></span></div>
      <div><p class="market-emotion-kicker">市场层前置条件</p><h3>暂无修复质量数据</h3><p>重新抓取一次市场数据后自动生成。</p></div>`;
    metrics.innerHTML = "";
    if (review) review.innerHTML = `<p class="decision-note">当前快照还没有复盘总结。</p>`;
    groups.innerHTML = `<p class="decision-note">当前快照还没有市场情绪观察结果。</p>`;
    validation.innerHTML = "";
    if (meta) meta.textContent = "等待抓取";
    return;
  }

  const light = ["green", "yellow", "red"].includes(model.light) ? model.light : "yellow";
  const structureEvidence = model.structureEvidence && typeof model.structureEvidence === "object"
    ? model.structureEvidence
    : {};
  const driverStatusLabel = {
    leading: "正在主导",
    present: "已有表现",
    partial: "有领涨、缺跟随",
    "not-leading": "未带节奏",
    absent: "暂无标的",
  };
  const driverPct = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "--";
    return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
  };
  const renderDriverEvidence = (driver, kind) => {
    if (!driver || typeof driver !== "object") return "";
    const items = Array.isArray(driver.items) ? driver.items.filter(Boolean) : [];
    const status = String(driver.status || "absent");
    return `
      <section class="market-emotion-driver is-${escapeHtml(status)}">
        <header>
          <span>${escapeHtml(driver.label || (kind === "old-core" ? "老核心带动验证" : "超跌修复标的"))}</span>
          <b>${escapeHtml(driverStatusLabel[status] || "等待确认")}</b>
        </header>
        <p>${escapeHtml(driver.summary || "暂无明确证据")}</p>
        <div class="market-emotion-driver-stocks">
          ${items.length ? items.map((item) => {
            const tags = Array.isArray(item.evidenceTags) ? item.evidenceTags.filter(Boolean) : [];
            return `
              <div class="market-emotion-driver-stock">
                <span><strong>${escapeHtml(item.name || "--")}</strong><small>${escapeHtml(item.code || "")}</small></span>
                <b>${driverPct(item.changePct)}</b>
                ${item.driverState ? `<em>${escapeHtml(item.driverState)}</em>` : ""}
                ${tags.length ? `<small>${tags.map((tag) => escapeHtml(tag)).join(" · ")}</small>` : ""}
              </div>`;
          }).join("") : `<span class="market-emotion-driver-empty">当前没有通过这组证据门槛的标的</span>`}
        </div>
      </section>`;
  };
  const driverEvidenceHtml = Object.keys(structureEvidence).length
    ? `
      <div class="market-emotion-driver-board">
        ${renderDriverEvidence(structureEvidence.oversold, "oversold")}
        ${renderDriverEvidence(structureEvidence.oldCore, "old-core")}
      </div>`
    : "";
  hero.className = `market-emotion-hero is-${light}`;
  hero.innerHTML = `
    <div class="market-light" aria-label="${escapeHtml(model.lightLabel || "市场灯")}"><span></span></div>
    <div class="market-emotion-hero-copy">
      <div class="market-emotion-hero-topline">
        <span class="market-emotion-kicker">${escapeHtml(model.lightLabel || "市场灯")} · ${escapeHtml(model.quality || "等待判断")}</span>
        <strong>${escapeHtml(String(model.score == null ? "--" : model.score))}<small>/100</small></strong>
      </div>
      <h3>${escapeHtml(model.structureType || "市场结构待判断")}</h3>
      <p>${escapeHtml(model.summary || "--")}</p>
      ${driverEvidenceHtml}
      <div class="market-emotion-action">
        <span>明日基础预期</span><b>${escapeHtml(model.nextDayBase || "--")}</b>
        <em>${escapeHtml(model.action || "--")}</em>
      </div>
    </div>`;

  if (review) {
    const reviewModel = model.review || {};
    const facts = Array.isArray(reviewModel.facts) ? reviewModel.facts : [];
    const tomorrow = reviewModel.tomorrow || {};
    const onlyRows = Array.isArray(tomorrow.only) ? tomorrow.only : [];
    const avoidRows = Array.isArray(tomorrow.avoid) ? tomorrow.avoid : [];
    const timeline = Array.isArray(tomorrow.timeline) ? tomorrow.timeline : [];
    review.innerHTML = `
      <div class="market-review-line is-${light}">
        <span>今日定性</span>
        <strong>${escapeHtml(reviewModel.oneLine || `${model.lightLabel || "市场灯"} · ${model.quality || "等待判断"}`)}</strong>
      </div>
      <div class="market-review-grid">
        <section class="market-review-today">
          <h4>今天发生了什么</h4>
          <div class="market-review-facts">
            ${facts.map((item) => `<p><b>${escapeHtml(item.label || "观察")}</b><span>${escapeHtml(item.text || "--")}</span></p>`).join("") || `<p><span>${escapeHtml(model.summary || "--")}</span></p>`}
          </div>
        </section>
        <section class="market-review-tomorrow">
          <h4>明天怎么做</h4>
          <p class="market-review-base"><b>基础预期</b><span>${escapeHtml(tomorrow.base || model.nextDayBase || "--")}</span><em>${escapeHtml(tomorrow.positionLimit || model.action || "--")}</em></p>
          <div class="market-review-do-dont">
            <div class="is-do"><strong>只做</strong><ul>${onlyRows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul></div>
            <div class="is-dont"><strong>不做</strong><ul>${avoidRows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul></div>
          </div>
          <div class="market-review-timeline">
            ${timeline.map((step) => `<div><b>${escapeHtml(step.time || "--")}</b><span><strong>${escapeHtml(step.title || "观察")}</strong><small>${escapeHtml(step.text || "")}</small></span></div>`).join("")}
          </div>
          ${tomorrow.invalidation ? `<p class="market-review-invalid"><b>全部取消：</b>${escapeHtml(tomorrow.invalidation)}</p>` : ""}
        </section>
      </div>`;
  }

  const statusLabel = { pass: "通过", warn: "观察", fail: "不通过" };
  metrics.innerHTML = (Array.isArray(model.metrics) ? model.metrics : []).filter(Boolean).map((item) => `
    <article class="market-emotion-metric is-${escapeHtml(item.status || "warn")}">
      <div><span>${escapeHtml(item.label || "指标")}</span><b>${escapeHtml(statusLabel[item.status] || "观察")}</b></div>
      <strong>${escapeHtml(item.value || "--")}</strong>
      <p>${escapeHtml(item.note || "")}</p>
    </article>`).join("");

  const pct = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "--";
    return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
  };
  groups.innerHTML = (Array.isArray(model.groups) ? model.groups : []).filter(Boolean).map((group) => {
    const items = Array.isArray(group.items) ? group.items.filter(Boolean) : [];
    return `
      <article class="market-emotion-group is-${escapeHtml(group.status || "mixed")}">
        <div class="market-emotion-group-head">
          <div><h4>${escapeHtml(group.title || "观察组")}</h4><p>${escapeHtml(group.subtitle || "")}</p></div>
          <span>${escapeHtml(group.summary || "--")}</span>
        </div>
        <div class="market-emotion-stock-list">
          ${items.length ? items.map((item) => {
            const available = item.todayAvailable !== false && Number.isFinite(Number(item.changePct));
            const change = available ? Number(item.changePct) : null;
            const direction = !available ? "missing" : change > 0 ? "up" : change < 0 ? "down" : "flat";
            const historyText = item.historyHits ? `近3日出现${item.historyHits}次` : "";
            const evidenceTags = Array.isArray(item.evidenceTags) ? item.evidenceTags.filter(Boolean) : [];
            const initiativeScore = Number(item.initiativeScore);
            const hasLeadership = item.coreQualified
              || group.key === "carriers"
              || (item.identity && item.identity !== "地位待确认");
            const leadershipTags = hasLeadership ? `
              <div class="market-emotion-stock-leadership">
                <span class="is-state-${item.tradeState === "主攻候选" ? "attack" : item.tradeState === "等回踩" ? "wait" : "observe"}">${escapeHtml(item.tradeState || "仅观察")}</span>
                <span>${escapeHtml(item.identity || "地位待确认")}</span>
                <span>${escapeHtml(item.initiativeLabel || "主动性待确认")}${Number.isFinite(initiativeScore) ? ` ${escapeHtml(String(initiativeScore))}` : ""} · ${escapeHtml(item.initiativeDataQuality || "数据待确认")}</span>
                <span>结构${escapeHtml(item.structureGrade || "--")} · ${escapeHtml(item.positionLabel || "位置待确认")}</span>
                <span>${escapeHtml(item.chipLabel || "筹码待确认")}</span>
              </div>
              <p class="market-emotion-stock-execution">${escapeHtml(item.executionNote || "等待验证")}</p>` : "";
            return `
              <div class="market-emotion-stock is-${direction}">
                <div class="market-emotion-stock-name">
                  <strong>${escapeHtml(item.name || "--")}</strong><small>${escapeHtml(item.code || "")}</small>
                </div>
                <b>${available ? pct(change) : "今日未进热榜"}</b>
                <div class="market-emotion-stock-tags">
                  <span>${escapeHtml(item.role || "观察")}</span>
                  <span>${escapeHtml(item.shape || "区间待确认")}</span>
                  ${historyText ? `<span>${escapeHtml(historyText)}</span>` : ""}
                  ${item.driverState ? `<span class="is-driver-state">${escapeHtml(item.driverState)}</span>` : ""}
                  ${evidenceTags.map((tag) => `<span class="is-evidence">${escapeHtml(tag)}</span>`).join("")}
                </div>
                <p>${escapeHtml(item.concept || "方向待识别")}${Number.isFinite(Number(item.amountYi)) && available ? ` · 成交${escapeHtml(String(item.amountYi))}亿` : ""}</p>
                ${leadershipTags}
              </div>`;
          }).join("") : `<p class="decision-note">当前没有符合这组条件的标的。</p>`}
        </div>
      </article>`;
  }).join("");

  const columns = [
    { key: "upgrade", title: "升级绿灯", tone: "upgrade" },
    { key: "hold", title: "维持黄灯", tone: "hold" },
    { key: "downgrade", title: "转为红灯", tone: "downgrade" },
  ];
  validation.innerHTML = columns.map((column) => {
    const rows = model.validation && Array.isArray(model.validation[column.key]) ? model.validation[column.key] : [];
    return `
      <article class="market-emotion-rule is-${column.tone}">
        <h4>${column.title}</h4>
        <ul>${rows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>
      </article>`;
  }).join("");

  if (meta) {
    const time = model.asOf ? formatTime(model.asOf) : "--";
    meta.textContent = `${model.tradingDate || "最近交易日"}交易日 · 快照生成 ${time} · 锚点只验证情绪，主动龙头才有交易资格`;
  }
}

function renderSuperExpectation(payload) {
  const model = payload && payload.superExpectation ? payload.superExpectation : null;
  const hero = document.querySelector("#superExpectationHero");
  const countsNode = document.querySelector("#superExpectationCounts");
  const candidatesNode = document.querySelector("#superExpectationCandidates");
  const rejectedNode = document.querySelector("#superExpectationRejected");
  const validationsNode = document.querySelector("#superExpectationValidations");
  const candidateMeta = document.querySelector("#superExpectationCandidateMeta");
  const validationMeta = document.querySelector("#superExpectationValidationMeta");
  const meta = document.querySelector("#superExpectationMeta");
  if (!hero || !countsNode || !candidatesNode || !validationsNode) return;

  const pct = (value, fallback = "待确认") => {
    if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return `${number > 0 ? "+" : ""}${number.toFixed(1)}%`;
  };
  const rowsHtml = (rows, emptyText) => {
    const items = Array.isArray(rows) ? rows.filter(Boolean) : [];
    return items.length
      ? items.map((row) => `<li>${escapeHtml(row)}</li>`).join("")
      : `<li>${escapeHtml(emptyText)}</li>`;
  };

  if (!model) {
    hero.className = "super-expectation-hero is-empty";
    countsNode.innerHTML = "";
    candidatesNode.innerHTML = `<div class="super-expectation-empty"><strong>当前快照还没有超预期筛选</strong><span>重新抓取后生成，不会把普通强势票放进来。</span></div>`;
    if (rejectedNode) {
      rejectedNode.hidden = true;
      rejectedNode.innerHTML = "";
    }
    validationsNode.innerHTML = `<div class="super-expectation-empty"><strong>暂无待验证记录</strong><span>有昨日候选后，次日自动比较真实走势。</span></div>`;
    if (candidateMeta) candidateMeta.textContent = "等待盘后筛选";
    if (validationMeta) validationMeta.textContent = "等待次日行情";
    if (meta) meta.textContent = "等待抓取";
    return;
  }

  const counts = model.counts || {};
  const candidates = model.candidateStage && Array.isArray(model.candidateStage.candidates)
    ? model.candidateStage.candidates.filter(Boolean)
    : Array.isArray(model.candidates) ? model.candidates.filter(Boolean) : [];
  const rejected = model.candidateStage && Array.isArray(model.candidateStage.rejected)
    ? model.candidateStage.rejected.filter(Boolean)
    : [];
  const validations = model.validationStage && Array.isArray(model.validationStage.validations)
    ? model.validationStage.validations.filter(Boolean)
    : [];

  hero.className = `super-expectation-hero${model.degraded ? " is-degraded" : ""}`;
  hero.innerHTML = `
    <div class="super-expectation-hero-copy">
      <span>本页唯一原则</span>
      <h3>${escapeHtml(model.principle || "先把今日状态归入唯一一类，再判断明天是否真正超预期。")}</h3>
      <p>今日只归入稳定强、强势回封、有效弱基线、普通弱、主动失败之一；明日只走弱转强或强转强两条路线。</p>
    </div>
    <div class="super-expectation-gates">
      <span><b>01</b>核心身份</span>
      <span><b>02</b>强弱性质</span>
      <span><b>03</b>板块基础</span>
      <span><b>04</b>真实承接</span>
    </div>`;

  const countRows = [
    ["扫描核心", counts.scannedCore, "只统计已通过核心身份门槛"],
    ["明日候选", counts.candidates, "已冻结弱转强/强转强基线"],
    ["今日验证", counts.validating, "只接续紧邻上一交易日候选"],
    ["已经确认", counts.confirmed, "竞价、主动性与板块共振通过"],
    ["初步成立", counts.initial, "仍缺一项关键确认"],
    ["确认失效", counts.failed, "实际走势回到正常或更弱路径"],
  ];
  countsNode.innerHTML = countRows.map(([label, value, note], index) => `
    <div class="${index === 3 ? "is-confirmed" : index === 5 ? "is-failed" : ""}">
      <span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value == null ? 0 : value))}</strong><small>${escapeHtml(note)}</small>
    </div>`).join("");

  if (candidateMeta) {
    const rejected = model.candidateStage && Number(model.candidateStage.rejectedCoreCount || 0);
    candidateMeta.textContent = `${candidates.length}只入选 · ${rejected || 0}只核心未过强弱性质/板块门槛`;
  }
  candidatesNode.innerHTML = candidates.length ? candidates.map((candidate) => {
    const today = candidate.today || {};
    const core = candidate.core || {};
    const sector = candidate.sector || {};
    const baseline = candidate.baseline || {};
    const checks = Array.isArray(candidate.nextDayChecks) ? candidate.nextDayChecks.filter(Boolean) : [];
    const range = Array.isArray(baseline.expectedOpenRangePct) ? baseline.expectedOpenRangePct : [];
    const peers = Array.isArray(sector.corePeerNames) && sector.corePeerNames.length
      ? sector.corePeerNames
      : Array.isArray(sector.positivePeerNames) ? sector.positivePeerNames : [];
    return `
      <article class="super-candidate-card priority-${escapeHtml(String(candidate.priority || "B").toLowerCase())}">
        <header>
          <div class="super-candidate-rank"><span>${escapeHtml(candidate.priority || "B")}级</span><b>${escapeHtml(String(candidate.priorityScore == null ? "--" : candidate.priorityScore))}</b></div>
          <div class="super-candidate-title">
            <div><h4>${escapeHtml(candidate.name || "--")}</h4><small>${escapeHtml(candidate.code || "")} · ${escapeHtml(candidate.direction || "方向待确认")}</small></div>
            <span>${escapeHtml(today.strengthNatureLabel || today.patternLabel || baseline.routeLabel || "预期路径")}</span>
          </div>
          <div class="super-candidate-state"><span>明日状态</span><b>${escapeHtml(candidate.candidateState || "待次日验证")}</b></div>
        </header>
        <div class="super-candidate-thesis">
          <div>
            <span>为什么它有资格</span>
            <strong>${escapeHtml(core.identity || candidate.role || "核心身份")}</strong>
            <ul>${rowsHtml(core.evidence, "核心证据待补")}</ul>
          </div>
          <div>
            <span>今天属于什么</span>
            <strong>${escapeHtml(today.strengthNatureLabel || baseline.todayNatureLabel || "强弱性质待确认")}</strong>
            <p>${escapeHtml(today.reason || "等待强弱归因")}</p>
            <small>${Array.isArray(today.strengthEvidence) && today.strengthEvidence.length ? escapeHtml(today.strengthEvidence.slice(0, 3).join("；")) : "相对市场与板块的证据待补"}</small>
          </div>
          <div>
            <span>明日走哪条路线</span>
            <strong>${escapeHtml(baseline.routeLabel || "预期路线待确认")}</strong>
            <p>${escapeHtml(baseline.normalPath || "--")}</p>
          </div>
          <div>
            <span>板块支撑</span>
            <strong>${escapeHtml(`${sector.direction || candidate.direction || "方向待确认"} · ${sector.score == null ? "--" : sector.score}/100`)}</strong>
            <p>${escapeHtml(sector.note || "--")}</p>
            <small>${peers.length ? `验证核心：${escapeHtml(peers.join("、"))}` : "同方向核心待确认"}</small>
          </div>
        </div>
        <div class="super-baseline">
          <span>明日正常预期</span>
          <strong>${range.length >= 2 ? `${pct(range[0])} ～ ${pct(range[1])}` : "区间待确认"}</strong>
          <i></i>
          <span>${escapeHtml(baseline.routeLabel || "超预期")}确认线</span>
          <strong>竞价不低于 ${pct(baseline.overExpectedOpenPct)}</strong>
          ${baseline.overExpectedPrice != null ? `<em>参考价约 ${escapeHtml(String(baseline.overExpectedPrice))}</em>` : ""}
        </div>
        <div class="super-next-checks">
          ${checks.map((check, index) => `<div><b>${String(index + 1).padStart(2, "0")}</b><span><strong>${escapeHtml(check.stage || "验证")}</strong><small>${escapeHtml(check.condition || "--")}</small></span></div>`).join("")}
        </div>
        <footer>
          <p><b>位置风险：</b>${escapeHtml(candidate.risk || "等待结构判断")}</p>
          <p><b>立即取消：</b>${escapeHtml(candidate.invalidation || "--")}</p>
        </footer>
      </article>`;
  }).join("") : `
    <div class="super-expectation-empty is-strict">
      <strong>今天没有符合条件的核心</strong>
      <span>只有“核心身份＋清晰预期路径＋板块回流基础”同时成立才会出现；主动弱和普通抗跌不会被硬塞进来。</span>
    </div>`;

  if (rejectedNode) {
    rejectedNode.hidden = !rejected.length;
    rejectedNode.innerHTML = rejected.length ? `
      <div class="super-rejected-head">
        <div>
          <strong>未入选核心明细</strong>
          <span>这些票属于当前核心观察范围，但没有同时通过“核心地位＋今日强弱性质＋板块基础/回流”三道门槛。</span>
        </div>
        <b>${escapeHtml(String(rejected.length))}只</b>
      </div>
      <div class="super-rejected-grid">
        ${rejected.map((item) => {
          const today = item.today || {};
          const gates = Array.isArray(item.gates) ? item.gates.filter(Boolean) : [];
          const fails = Array.isArray(item.fails) ? item.fails.filter(Boolean) : [];
          const natureLabel = today.strengthNatureLabel || today.patternLabel || item.strengthNatureLabel || item.patternLabel || "强弱性质待确认";
          const baselineDate = today.stateSourceTradeDate
            || item.baselineDate
            || item.baseline && (item.baseline.sourceTradeDate || item.baseline.tradingDate)
            || "";
          const passedCount = Number.isFinite(Number(item.passedGateCount))
            ? Number(item.passedGateCount)
            : gates.filter((gate) => gate.passed).length;
          return `
            <article class="super-rejected-card">
              <header>
                <div>
                  <h4>${escapeHtml(item.name || "--")}</h4>
                  <small>${escapeHtml(item.code || "")} · ${escapeHtml(item.direction || "方向待确认")} · ${escapeHtml(item.role || "核心观察")}</small>
                </div>
                <span class="is-${passedCount === 2 ? "near" : "blocked"}">${escapeHtml(String(passedCount))}/3通过</span>
              </header>
              <div class="super-rejected-facts">
                <span>今日 ${pct(today.changePct)}</span>
                <span>${escapeHtml(natureLabel)}${baselineDate ? ` · 基线 ${escapeHtml(baselineDate)}` : ""}</span>
              </div>
              <div class="super-rejected-gates">
                ${gates.map((gate) => `
                  <div class="${gate.passed ? "is-pass" : "is-fail"}">
                    <i>${gate.passed ? "✓" : "×"}</i>
                    <span><b>${escapeHtml(gate.label || "门槛")}</b><small>${escapeHtml(gate.note || "待确认")}</small></span>
                  </div>`).join("")}
              </div>
              <p><b>未入选：</b>${escapeHtml(fails.join("；") || "未同时通过三道门槛")}</p>
            </article>`;
        }).join("")}
      </div>` : "";
  }

  if (validationMeta) {
    const expiredCount = Number(counts.expired || 0);
    validationMeta.textContent = validations.length
      ? `${validations.length}只验证中 · 确认${Number(counts.confirmed || 0)} · 初步${Number(counts.initial || 0)} · 失效${Number(counts.failed || 0)}${expiredCount ? ` · 过期${expiredCount}` : ""}`
      : expiredCount ? `${expiredCount}条旧基线已过期，不参与今日验证` : "暂无上一交易日候选需要验证";
  }
  validationsNode.innerHTML = validations.length ? validations.map((item) => {
    const comparison = item.comparison || {};
    const nature = item.nature || {};
    const holder = item.holder || {};
    const outsider = item.outsider || {};
    const checks = Array.isArray(item.checks) ? item.checks.filter(Boolean) : [];
    const routes = Array.isArray(outsider.routes) ? outsider.routes.filter(Boolean) : [];
    const expected = Array.isArray(comparison.expectedOpenRangePct) ? comparison.expectedOpenRangePct : [];
    const statusClass = ["confirmed", "initial", "failed", "missing"].includes(item.status) ? item.status : "waiting";
    return `
      <article class="super-validation-card is-${escapeHtml(statusClass)}">
        <header>
          <div>
            <span>${escapeHtml(nature.label || "等待判断")}</span>
            <h4>${escapeHtml(item.name || "--")} <small>${escapeHtml(item.code || "")} · ${escapeHtml(item.direction || "方向待确认")}</small></h4>
          </div>
          <div class="super-validation-score"><span>${escapeHtml(item.statusLabel || "等待确认")}</span><strong>${item.confirmationScore == null ? "--" : escapeHtml(String(item.confirmationScore))}<small>/100</small></strong></div>
        </header>
        <p class="super-nature-note">${escapeHtml(nature.note || "等待更多行情证据。")}</p>
        <div class="super-comparison">
          <div><span>昨日冻结路线</span><b>${escapeHtml(comparison.routeLabel || "预期路线待确认")}</b></div>
          <div><span>昨日正常预期</span><b>${expected.length >= 2 ? `${pct(expected[0])} ～ ${pct(expected[1])}` : "待确认"}</b></div>
          <div><span>超预期确认线</span><b>${pct(comparison.overExpectedOpenPct)}</b></div>
          <div><span>今日实际竞价</span><b>${pct(comparison.actualOpenPct)}</b></div>
          <div><span>当前表现</span><b>${pct(comparison.currentPct)}</b></div>
        </div>
        <div class="super-check-grid">
          ${checks.length ? checks.map((check) => `<div class="${check.passed ? "is-pass" : "is-wait"}"><i>${check.passed ? "✓" : "·"}</i><span><b>${escapeHtml(check.label || "验证项")}</b><small>${escapeHtml(check.value || "待确认")}</small></span></div>`).join("") : `<p class="decision-note">当前行情未覆盖，不能用缺数据替代判断。</p>`}
        </div>
        <div class="super-action-grid">
          <section class="is-holder">
            <div><span>我已持有</span><b>${escapeHtml(holder.action || "等待判断")}</b></div>
            <p>${escapeHtml(holder.now || "--")}</p>
            <ul>
              <li><b>何时加：</b>${escapeHtml(holder.addCondition || "不加仓")}</li>
              <li><b>何时卖：</b>${escapeHtml(holder.sellCondition || "等待条件")}</li>
            </ul>
          </section>
          <section class="is-outsider">
            <div><span>我未持有</span><b>${escapeHtml(outsider.action || "等待判断")}</b></div>
            <p><strong>首选买法：</strong>${escapeHtml(outsider.preferredEntry || "无")}</p>
            <div class="super-entry-routes">
              ${routes.map((route) => `<div><b>${escapeHtml(route.label || "确认买点")}</b><span>${escapeHtml(route.condition || "--")}</span></div>`).join("") || `<div><b>暂不买</b><span>${escapeHtml(outsider.skipReason || "条件尚未成立")}</span></div>`}
            </div>
            ${routes.length && outsider.skipReason ? `<small>放弃条件：${escapeHtml(outsider.skipReason)}</small>` : ""}
          </section>
        </div>
        <footer><b>超预期失效：</b>${escapeHtml(item.invalidation || "实际走势回到原本正常预期或更弱路径，立即取消。")}</footer>
      </article>`;
  }).join("") : `
    <div class="super-expectation-empty">
      <strong>今天没有需要接续验证的昨日候选</strong>
      <span>第一步产生候选并保存后，只会在紧邻下一交易日按弱转强或强转强路线给出应对。</span>
    </div>`;

  if (meta) {
    const time = model.generatedAt ? formatTime(model.generatedAt) : "--";
    meta.textContent = `${model.tradingDate || "最近交易日"} · ${model.degraded ? "数据降级，禁止执行" : "盘后预筛＋次日验证"} · ${time}`;
  }
}

function renderEventTimelineCalendar(payload) {
  const list = document.querySelector("#eventCalendarList");
  const meta = document.querySelector("#eventCalendarMeta");
  if (!list || !meta) return;
  const calendar = payload && payload.eventCalendar && typeof payload.eventCalendar === "object" ? payload.eventCalendar : null;
  const items = calendar && Array.isArray(calendar.items) ? calendar.items : [];
  const status = calendar && calendar.status || {};
  const statusLabel = {
    live: "实时成功",
    "cache-fresh": "已恢复保存数据",
    partial: "部分更新",
    "stale-cache": "接口失败，缓存兜底",
    unavailable: "暂不可用",
  }[status.state] || "等待状态";
  if (!items.length) {
    meta.textContent = `0条 · ${statusLabel}`;
    list.innerHTML = `<p class="decision-note">${escapeHtml(status.message || "当前没有可展示的时间轴事件。")}</p>`;
    return;
  }

  const todayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date()).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  const displayMap = new Map();
  for (const item of items) {
    const key = `${String(item && item.eventDate || "日期待确认")}|${String(item && item.title || "未命名事件")}`;
    const sourceLabel = item && (item.source || item.publisher || item.sourceProvider) || "来源待确认";
    if (!displayMap.has(key)) {
      displayMap.set(key, { ...item, displaySources: [sourceLabel], corroborationCount: 1 });
      continue;
    }
    const current = displayMap.get(key);
    if (!current.displaySources.includes(sourceLabel)) current.displaySources.push(sourceLabel);
    current.corroborationCount += 1;
    if (item.sourceType === "official" && current.sourceType !== "official") {
      displayMap.set(key, { ...current, ...item, displaySources: current.displaySources, corroborationCount: current.corroborationCount });
    }
  }
  const displayItems = [...displayMap.values()].sort((left, right) => String(left.eventDate || "").localeCompare(String(right.eventDate || "")) || String(left.title || "").localeCompare(String(right.title || "")));
  const future = displayItems.filter((item) => String(item.eventDate || "") >= today);
  const riskCount = future.filter((item) => item && item.calendarRole === "short-term-risk").length;
  meta.textContent = `已保存${items.length}条来源记录 · 未来${future.length}个事件节点 · 风险日历${riskCount}个 · ${statusLabel}`;
  const visible = future.length ? future : displayItems;
  const groups = new Map();
  for (const item of visible) {
    const key = String(item.eventDate || "日期待确认");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  list.innerHTML = [...groups.entries()].map(([date, rows]) => {
    const parsed = new Date(`${date}T00:00:00+08:00`);
    const weekday = Number.isFinite(parsed.getTime()) ? weekdays[parsed.getDay()] : "";
    return `<section class="event-calendar-day">
      <div class="event-calendar-date"><b>${escapeHtml(date)}</b><span>${escapeHtml(weekday)}</span></div>
      <div class="event-calendar-items">
        ${rows.map((item) => {
          const isRiskCalendar = item && item.calendarRole === "short-term-risk";
          const grade = isRiskCalendar && item.calendarMeta && item.calendarMeta.label
            ? item.calendarMeta.label
            : item.sourceGradeLabel && item.sourceGradeLabel !== "未标级" ? item.sourceGradeLabel : "产业/日历事件";
          const themes = Array.isArray(item.themes) ? item.themes.join(" / ") : "";
          const sources = Array.isArray(item.displaySources) ? item.displaySources.join(" + ") : item.source || item.publisher || "来源待确认";
          const timeBasis = item.calendarMeta && item.calendarMeta.timeBasis ? item.calendarMeta.timeBasis : "";
          return `<div class="event-calendar-item ${Number(item.sourceGrade) === 1 ? "is-heavy" : Number(item.sourceGrade) === 3 ? "is-focus" : ""}${isRiskCalendar ? " is-risk-calendar" : ""}">
            <span>${escapeHtml(grade)}</span>
            <div><strong>${escapeHtml(item.title || "未命名事件")}</strong>${item.corroborationCount > 1 ? `<b>${item.corroborationCount}个来源互证</b>` : ""}</div>
            <small>${escapeHtml([themes, timeBasis].filter(Boolean).join(" · ") || "影响方向等待市场反馈")}</small>
            <em>来源：${escapeHtml(sources)}</em>
          </div>`;
        }).join("")}
      </div>
    </section>`;
  }).join("");
}

function renderEventInference(payload) {
  renderEventTimelineCalendar(payload);
  const model = payload && payload.eventInference ? payload.eventInference : null;
  const hero = document.querySelector("#eventInferenceHero");
  const metrics = document.querySelector("#eventInferenceMetrics");
  const futureMajor = document.querySelector("#eventFutureMajorList");
  const futureMajorMeta = document.querySelector("#eventFutureMajorMeta");
  const qualified = document.querySelector("#eventInferenceQualified");
  const watch = document.querySelector("#eventInferenceWatch");
  const landed = document.querySelector("#eventLandedList");
  const landedMeta = document.querySelector("#eventLandedMeta");
  const filtered = document.querySelector("#eventInferenceFiltered");
  const filteredMeta = document.querySelector("#eventInferenceFilteredMeta");
  const meta = document.querySelector("#eventInferenceMeta");
  const sourcePanel = document.querySelector("#eventInferenceSources");
  const decisionGate = document.querySelector("#decisionEventGate");
  const decisionBody = document.querySelector("#decisionEventBody");
  const reviewMeta = document.querySelector("#reviewConclusionEventMeta");
  const reviewBody = document.querySelector("#reviewConclusionEvents");

  const showEmpty = () => {
    if (hero) {
      hero.className = "event-inference-hero is-empty";
      hero.innerHTML = `<div><span class="event-rule-badge">严格准入</span><h3>当前快照还没有事件推演</h3><p>重新抓取后，系统会先过滤垃圾信息，再判断预期交易程度。</p></div><div class="event-inference-principle">事件不改周期 · 不直接加分 · 不生成无条件买点</div>`;
    }
    if (metrics) metrics.innerHTML = "";
    if (futureMajor) futureMajor.innerHTML = `<p class="decision-note">当前没有未来重大事件推演。</p>`;
    if (futureMajorMeta) futureMajorMeta.textContent = "0条";
    if (qualified) qualified.innerHTML = `<p class="decision-note">当前没有合格事件。</p>`;
    if (watch) watch.innerHTML = `<p class="decision-note">当前没有观察事件。</p>`;
    if (landed) landed.innerHTML = `<p class="decision-note">当前没有已落地事件。</p>`;
    if (landedMeta) landedMeta.textContent = "0条";
    if (filtered) filtered.innerHTML = "";
    if (filteredMeta) filteredMeta.textContent = "0条";
    if (meta) meta.textContent = "等待抓取";
    if (sourcePanel) sourcePanel.innerHTML = `<span class="event-source-chip is-waiting"><b>消息来源</b> 等待抓取</span>`;
    if (decisionGate) decisionGate.textContent = "事件不加仓";
    if (decisionBody) decisionBody.innerHTML = `<p class="decision-note">暂无合格事件，原情绪周期与买入规则照常运行。</p>`;
    if (reviewMeta) reviewMeta.textContent = "暂无合格事件";
    if (reviewBody) reviewBody.innerHTML = `<p class="decision-note">事件层没有新增结论，不影响本次复盘。</p>`;
  };

  if (!model) {
    showEmpty();
    return;
  }

  const qualifiedRows = Array.isArray(model.qualifiedEvents) ? model.qualifiedEvents : [];
  const futureRows = Array.isArray(model.futureMajorEvents) ? model.futureMajorEvents : [];
  const watchRows = Array.isArray(model.watchEvents) ? model.watchEvents : [];
  const landedRows = Array.isArray(model.landedEvents) ? model.landedEvents : [];
  const filteredRows = Array.isArray(model.filtered) ? model.filtered : [];
  const sourceRows = Array.isArray(model.sources) ? model.sources : [];
  const context = model.marketContext || {};
  const top = qualifiedRows[0] || null;
  const scoreText = (value) => Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : "--";
  const pctText = (value) => Number.isFinite(Number(value)) ? `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(2)}%` : "--";
  const sourceState = (state) => ({
    live: "实时成功",
    "cache-fresh": "本地已保存",
    partial: "部分成功",
    "stale-cache": "失败后缓存兜底",
    unavailable: "暂不可用",
  }[state] || "状态待确认");
  const uiTodayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date()).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  const uiTodayKey = `${uiTodayParts.year}-${uiTodayParts.month}-${uiTodayParts.day}`;
  const tradingDaysBetween = (fromDate, toDate) => {
    const parse = (value) => {
      const matched = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!matched) return null;
      return Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
    };
    const start = parse(fromDate);
    const target = parse(toDate);
    if (!Number.isFinite(start) || !Number.isFinite(target)) return null;
    if (start === target) return 0;
    const direction = target > start ? 1 : -1;
    const oneDay = 24 * 60 * 60 * 1000;
    let cursor = start;
    let count = 0;
    let guard = 0;
    while (cursor !== target && guard < 740) {
      cursor += direction * oneDay;
      const weekday = new Date(cursor).getUTCDay();
      if (weekday !== 0 && weekday !== 6) count += direction;
      guard += 1;
    }
    return cursor === target ? count : null;
  };
  const eventTimingView = (event) => {
    const tradingDays = event && event.eventDate ? tradingDaysBetween(uiTodayKey, event.eventDate) : null;
    if (!Number.isFinite(tradingDays)) {
      return {
        tradingDays: null,
        distanceLabel: "日期确认后自动倒计时",
        label: "时间待确认",
        className: "unknown",
        stageIndex: 0,
        progress: 0,
        action: "先确认准确日期和议程，不因为模糊时间提前交易。",
      };
    }
    if (tradingDays < 0) {
      return {
        tradingDays,
        distanceLabel: `已过去约${Math.abs(tradingDays)}个交易日`,
        label: "已经发生 · 转入复盘",
        className: "landed",
        stageIndex: 4,
        progress: 100,
        action: "核对事件结果、板块兑现和核心股承接，不再按未来预期处理。",
      };
    }
    if (tradingDays === 0) {
      return {
        tradingDays,
        distanceLabel: "今天就是事件日",
        label: "今天落地 · 看市场反馈",
        className: "landed",
        stageIndex: 4,
        progress: 100,
        action: "比较实际结果与市场预期，只在核心股和板块共同承接时确认超预期。",
      };
    }
    if (tradingDays <= 2) {
      return {
        tradingDays,
        distanceLabel: `约还有${tradingDays}个交易日`,
        label: "临近事件 · 防提前兑现",
        className: "cashout",
        stageIndex: 3,
        progress: 84,
        action: "不再盲目追高，重点看预期是否已经打满以及核心股能否继续承接。",
      };
    }
    if (tradingDays <= 6) {
      return {
        tradingDays,
        distanceLabel: `约还有${tradingDays}个交易日`,
        label: "资金预热验证期",
        className: "warming",
        stageIndex: 2,
        progress: 62,
        action: "确认板块是否扩散、成交是否连续放大；若已经加速，开始防范预期过满。",
      };
    }
    if (tradingDays <= 10) {
      return {
        tradingDays,
        distanceLabel: `约还有${tradingDays}个交易日`,
        label: "进入提前观察期",
        className: "observe",
        stageIndex: 1,
        progress: 40,
        action: "开始看板块能否跑赢大盘、量能是否连续增加、是否出现有辨识度的核心股。",
      };
    }
    if (tradingDays <= 15) {
      return {
        tradingDays,
        distanceLabel: `约还有${tradingDays}个交易日`,
        label: "即将进入观察期",
        className: "prepare",
        stageIndex: 0,
        progress: 20,
        action: "先建立板块与核心股观察清单，等待资金出现真实异动。",
      };
    }
    return {
      tradingDays,
      distanceLabel: `约还有${tradingDays}个交易日`,
      label: "远期信息收集",
      className: "far",
      stageIndex: 0,
      progress: 8,
      action: "先确认事件真实性、议程和受益路径，不因为远期概念提前交易。",
    };
  };
  const dateText = (event) => {
    if (!event.eventDate) return "日期待明确";
    return `${event.eventDate} · ${eventTimingView(event).distanceLabel}`;
  };
  const card = (event, mode = "qualified") => {
    const anchors = event.anchors && Array.isArray(event.anchors.items) ? event.anchors.items : [];
    const scenarios = Array.isArray(event.scenarios) ? event.scenarios : [];
    const evidence = event.pricing && Array.isArray(event.pricing.evidence) ? event.pricing.evidence : [];
    const integration = event.systemIntegration || {};
    const sector = event.anchors && event.anchors.sector ? event.anchors.sector : null;
    const themes = Array.isArray(event.themes) ? event.themes : [];
    const origin = event.source && event.source.origin || "";
    const providerGrade = event.source && event.source.providerGrade || "";
    return `
      <article class="event-card is-${escapeHtml(mode)}">
        <div class="event-card-head">
          <div>
            <div class="event-card-tags">
              <span class="is-source">来源：${escapeHtml(event.source && event.source.label || "待核实")}${origin ? ` · ${escapeHtml(origin)}` : ""}${providerGrade ? ` · ${escapeHtml(providerGrade)}` : ""}</span>
              <span class="is-importance">重要性：${escapeHtml(event.importance && event.importance.label || "普通信息")}</span>
              <span>市场阶段：${escapeHtml(event.lifecycle && event.lifecycle.label || "待判断")}</span>
              <span class="is-trading">交易状态：${escapeHtml(event.trading && event.trading.label || "无主动交易价值")}</span>
            </div>
            <h4>${escapeHtml(event.title || "未命名事件")}</h4>
            <p class="event-card-summary">${escapeHtml(event.summary || event.category && event.category.label || "等待补充事件事实")}</p>
          </div>
          <div class="event-pricing-score"><strong>${scoreText(event.pricing && event.pricing.score)}</strong><span>预期交易度</span><small>${escapeHtml(event.pricing && event.pricing.label || "无法判断")}</small></div>
        </div>
        <div class="event-card-meta">
          <span>${escapeHtml(dateText(event))}</span>
          <span>${escapeHtml(event.category && event.category.label || "事件待分类")}</span>
          <span>${escapeHtml(event.direction && event.direction.label || "方向待验证")}</span>
          <span>市场认可 ${scoreText(event.pricing && event.pricing.recognitionScore)}/100</span>
        </div>
        ${themes.length ? `<div class="event-theme-list">${themes.map((theme) => `<span>${escapeHtml(theme)}</span>`).join("")}</div>` : ""}
        ${evidence.length ? `<div class="event-evidence">${evidence.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</div>` : ""}
        <div class="event-anchor-block">
          <div class="event-subtitle"><strong>核心验证标的</strong><span>${escapeHtml(event.anchors && event.anchors.rule || "先验证核心，再判断事件是否有效")}</span></div>
          <div class="event-anchor-list">
            ${anchors.length ? anchors.map((anchor) => `
              <div class="event-anchor">
                <div><strong>${escapeHtml(anchor.name || anchor.code || "--")}</strong><small>${escapeHtml(anchor.code || "")} · ${escapeHtml(anchor.type || "验证锚点")}</small></div>
                <b>${scoreText(anchor.score)}分</b>
                <span>${escapeHtml(anchor.role || "观察")} · ${pctText(anchor.changePct)} · 成交${Number.isFinite(Number(anchor.amountYi)) ? Number(anchor.amountYi).toFixed(1) : "--"}亿</span>
                <em>${escapeHtml(anchor.evidenceLevel || "等待证据")}</em>
              </div>`).join("") : `<p class="decision-note">暂时没有达到流动性、辨识度和真实映射门槛的核心标的。</p>`}
          </div>
          ${sector ? `<p class="event-sector-anchor"><b>板块确认：</b>${escapeHtml(sector.name || "事件方向观察组")}，${scoreText(sector.positiveCount)}/${scoreText(sector.sampleCount)}只上涨。</p>` : ""}
        </div>
        ${mode === "qualified" ? `
          <div class="event-scenario-grid">
            ${scenarios.map((scenario) => `<div class="is-${escapeHtml(scenario.type || "observe")}"><strong>${escapeHtml(scenario.label || "验证路径")}</strong><p>${escapeHtml(scenario.condition || "等待验证")}</p></div>`).join("")}
          </div>
          <div class="event-system-gate">
            <p><b>带入当前系统：</b>${escapeHtml(integration.marketNote || context.note || "事件不能改变情绪周期")}</p>
            <p><b>买入前置：</b>${escapeHtml(integration.entryGate || "市场总开关和核心锚点未确认前，不生成买点。")}</p>
            <p><b>失效条件：</b>${escapeHtml(integration.invalidation || "核心与板块不共振则取消。")}</p>
          </div>` : `<div class="event-watch-note">未达到接入门槛：只保留观察，不进入复盘结论和买入条件。</div>`}
      </article>`;
  };

  const futureCard = (event, index = 0) => {
    const impact = event && event.impact || {};
    const sectors = Array.isArray(impact.sectors) ? impact.sectors : [];
    const paths = Array.isArray(impact.transmissionPaths) ? impact.transmissionPaths : [];
    const stocks = Array.isArray(event && event.impactStocks) ? event.impactStocks : [];
    const calendarMeta = event && event.calendarMeta && typeof event.calendarMeta === "object" ? event.calendarMeta : null;
    const isRiskCalendar = event && event.calendarRole === "short-term-risk";
    const timing = eventTimingView(event);
    const distance = timing.distanceLabel;
    const providerGrade = event && event.source && event.source.providerGrade || "日历事件";
    const pricing = event && event.pricing || {};
    const lifecycle = event && event.lifecycle || {};
    const timingRisk = ["P3", "P4"].includes(lifecycle.code)
      ? "市场预期已经交易较充分；即使事件还没发生，也要优先防范高开兑现。"
      : isRiskCalendar
        ? `${timing.action} 该节点只提高风险观察优先级，不直接生成买点。`
        : timing.action;
    const timingSteps = ["提前收集", "进入观察", "资金预热", "防范兑现", "落地验证"];
    const calendarMechanism = calendarMeta && Array.isArray(calendarMeta.impactMechanism) ? calendarMeta.impactMechanism : [];
    const calendarWatchItems = calendarMeta && Array.isArray(calendarMeta.watchItems) ? calendarMeta.watchItems : [];
    return `<details class="event-future-card is-${escapeHtml(timing.className)}${isRiskCalendar ? " is-risk-calendar" : ""}" ${index === 0 ? "open" : ""}>
      <summary class="event-future-summary">
        <div class="event-future-date"><strong>${escapeHtml(event.eventDate || "日期待确认")}</strong><span>${escapeHtml(distance)}</span></div>
        <div class="event-future-title">
          <div>${isRiskCalendar ? `<span class="is-risk-calendar-label">短线风险日历</span>` : ""}<span>${escapeHtml(providerGrade)}</span><span>${escapeHtml(event.importance && event.importance.label || "待评级")}</span><span>${escapeHtml(lifecycle.label || "市场尚未确认")}</span></div>
          <h4>${escapeHtml(event.title || "未命名事件")}</h4>
          <p>${escapeHtml(event.summary || event.category && event.category.label || "等待补充事件信息")}</p>
        </div>
        <div class="event-stage-pill is-${escapeHtml(timing.className)}"><small>当前阶段</small><strong>${escapeHtml(timing.label)}</strong><span>${escapeHtml(distance)}</span></div>
        <div class="event-future-pricing"><strong>${isRiskCalendar && !Number(pricing.sampleCount) ? "--" : scoreText(pricing.score)}</strong><span>${isRiskCalendar ? "市场反馈" : "已交易程度"}</span><small>${escapeHtml(isRiskCalendar && !Number(pricing.sampleCount) ? "等待A股验证" : pricing.label || "无法判断")}</small></div>
        <span class="event-future-toggle">展开详情</span>
      </summary>
      <div class="event-future-body">
      ${calendarMeta ? `<div class="event-calendar-detail">
        <div class="event-calendar-detail-head"><b>${escapeHtml(calendarMeta.label || "短线风险节点")}</b><span>${escapeHtml(calendarMeta.timeBasis || "按A股交易时段观察")}</span></div>
        <dl>
          ${calendarMeta.meetingWindow ? `<div><dt>原始日期</dt><dd>${escapeHtml(calendarMeta.meetingWindow)}</dd></div>` : ""}
          ${calendarMeta.chinaObservationDate ? `<div><dt>A股观察日</dt><dd>${escapeHtml(calendarMeta.chinaObservationDate)}</dd></div>` : ""}
          ${calendarMeta.sourceBasis ? `<div class="is-wide"><dt>日期依据</dt><dd>${escapeHtml(calendarMeta.sourceBasis)}</dd></div>` : ""}
        </dl>
        ${calendarMechanism.length ? `<section><b>为什么影响短线</b>${calendarMechanism.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</section>` : ""}
        ${calendarWatchItems.length ? `<section><b>当天核对什么</b><div>${calendarWatchItems.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</div></section>` : ""}
      </div>` : ""}
      <div class="event-timing-card is-${escapeHtml(timing.className)}">
        <div class="event-timing-copy"><span>事件节奏</span><strong>${escapeHtml(timing.label)}</strong><em>${escapeHtml(distance)}</em></div>
        <div class="event-timing-track" role="img" aria-label="${escapeHtml(`事件进度：${timing.label}`)}"><i style="--timing-progress:${Math.max(0, Math.min(100, timing.progress))}%"></i></div>
        <div class="event-timing-labels">${timingSteps.map((step, stepIndex) => `<span class="${stepIndex === timing.stageIndex ? "is-active" : ""}">${escapeHtml(step)}</span>`).join("")}</div>
        <p><b>现在只做：</b>${escapeHtml(timing.action)}<em>进入观察期不等于出现买点。</em></p>
      </div>
      <div class="event-future-section">
        <b>可能影响板块</b>
        <div class="event-impact-sector-list">${sectors.length ? sectors.map((sectorName) => `<span>${escapeHtml(sectorName)}</span>`).join("") : `<em>暂时没有清晰A股产业映射，不硬贴板块。</em>`}</div>
      </div>
      <div class="event-future-section">
        <b>传导逻辑</b>
        <div class="event-impact-paths">${paths.length ? paths.map((path) => `<p>${escapeHtml(path)}</p>`).join("") : `<p>${escapeHtml(impact.directionNote || "等待结果与市场价格共同验证。")}</p>`}</div>
      </div>
      <div class="event-future-section is-stock-section">
        <b>哪些股票</b>
        <div class="event-impact-stocks">${stocks.length ? stocks.map((stock) => `
          <div class="event-impact-stock ${stock.qualified ? "is-qualified" : "is-candidate"}">
            <div><strong>${escapeHtml(stock.name || "--")}</strong><small>${escapeHtml(stock.code || "")} · ${escapeHtml(stock.concept || "事件映射")}</small></div>
            <span>${escapeHtml(stock.status || "观察")}${Number.isFinite(Number(stock.score)) ? ` · ${scoreText(stock.score)}分` : ""}</span>
            <em>${escapeHtml(stock.role || "观察")} · ${pctText(stock.changePct)} · 成交${Number.isFinite(Number(stock.amountYi)) ? Number(stock.amountYi).toFixed(1) : "--"}亿</em>
            <p>${escapeHtml(stock.reason || "等待验证")}</p>
          </div>`).join("") : `<p class="event-no-stock">当前动态候选池没有通过真实映射的股票，不使用固定名单硬凑；后续抓取出现合格核心时会自动补入。</p>`}</div>
      </div>
      <div class="event-future-gate"><p><b>方向判断：</b>${escapeHtml(impact.directionNote || "不预设涨跌，等待A股反馈。")}</p><p><b>当前节奏：</b>${escapeHtml(timingRisk)}</p></div>
      </div>
    </details>`;
  };

  if (hero) {
    hero.className = `event-inference-hero ${qualifiedRows.length ? "has-qualified" : "is-clean"}`;
    hero.innerHTML = `
      <div><span class="event-rule-badge">${qualifiedRows.length ? "发现合格事件" : "严格筛选完成"}</span><h3>${escapeHtml(model.summary || "事件筛选完成")}</h3><p>${escapeHtml(model.sourceNote || "自动快讯经过来源、重要性和A股映射三重过滤。")}</p></div>
      <div class="event-inference-principle"><b>当前周期：${escapeHtml(context.cycle || "未知")}</b><span>${escapeHtml(context.note || "事件不改周期，不直接加分。")}</span></div>`;
  }
  if (sourcePanel) {
    sourcePanel.innerHTML = sourceRows.length
      ? sourceRows.map((source) => {
        const age = Number.isFinite(Number(source.cacheAgeMinutes)) ? ` · 缓存${Math.max(0, Math.round(Number(source.cacheAgeMinutes)))}分钟` : "";
        const count = Number.isFinite(Number(source.itemCount)) ? ` · ${Math.max(0, Number(source.itemCount))}条` : "";
        return `<span class="event-source-chip is-${escapeHtml(source.state || "unknown")}" title="${escapeHtml(source.message || "")}"><b>${escapeHtml(source.label || "未知来源")} · ${escapeHtml(sourceState(source.state))}</b><em>${escapeHtml(`${count}${age}`.replace(/^ · /, ""))}</em></span>`;
      }).join("")
      : `<span class="event-source-chip is-waiting"><b>消息来源</b> 本轮没有来源状态</span>`;
  }
  if (metrics) {
    const rows = [
      ["未来重大节点", futureRows.length, "尚未发生，按日期优先"],
      ["已有验证股票", futureRows.filter((event) => Array.isArray(event.impactStocks) && event.impactStocks.some((stock) => stock.qualified)).length, "通过真实映射和流动性门槛"],
      ["合格事件", qualifiedRows.length, "E3/E4并通过来源门槛"],
      ["已发生事件", landedRows.length, "仅用于兑现与承接复盘"],
      ["过滤信息", Number(model.filteredCount) || 0, "垃圾信息已拦截"],
      ["市场环境", context.cycle || "未知", `${context.subPhase || "待确认"} · ${context.light || "yellow"}`],
    ];
    metrics.innerHTML = rows.map((row) => `<div><span>${escapeHtml(row[0])}</span><strong>${escapeHtml(String(row[1]))}</strong><small>${escapeHtml(row[2])}</small></div>`).join("");
  }
  if (futureMajor) {
    const visibleFutureRows = futureRows;
    futureMajor.innerHTML = visibleFutureRows.length
      ? visibleFutureRows.map((event, index) => futureCard(event, index)).join("")
      : `<p class="decision-note">未来时间轴中暂时没有达到重大性门槛的事件。普通日历信息仍保存在上方，但不会硬映射板块和股票。</p>`;
  }
  if (futureMajorMeta) {
    const qualifiedStockCount = futureRows.filter((event) => Array.isArray(event.impactStocks) && event.impactStocks.some((stock) => stock.qualified)).length;
    futureMajorMeta.textContent = `${futureRows.length}个节点 · ${qualifiedStockCount}个已有核心验证股`;
  }
  if (qualified) qualified.innerHTML = qualifiedRows.length ? qualifiedRows.map((event) => card(event, "qualified")).join("") : `<p class="decision-note">本轮没有E3/E4合格事件。没有事件也是结论，原系统照常运行。</p>`;
  if (watch) {
    const futureIds = new Set(futureRows.map((event) => event && event.id).filter(Boolean));
    const remainingWatchRows = watchRows.filter((event) => !futureIds.has(event && event.id) && !(
      event && event.daysUntil !== null && event.daysUntil !== undefined && Number.isFinite(Number(event.daysUntil)) && Number(event.daysUntil) < 0
    ));
    const visibleWatchRows = remainingWatchRows;
    watch.innerHTML = visibleWatchRows.length
      ? visibleWatchRows.map((event) => card(event, "watch")).join("")
      : `<p class="decision-note">本轮没有需要保留观察的事件。</p>`;
  }
  if (landed) {
    const visibleLandedRows = landedRows;
    landed.innerHTML = visibleLandedRows.length
      ? `${visibleLandedRows.map((event) => {
        const stocks = Array.isArray(event.impactStocks) ? event.impactStocks.filter((stock) => stock.qualified) : [];
        const sectors = event.impact && Array.isArray(event.impact.sectors) ? event.impact.sectors : [];
        return `<div class="event-landed-row">
          <div><strong>${escapeHtml(event.title || "未命名事件")}</strong><small>${escapeHtml(event.eventDate || "日期不明")} · ${escapeHtml(event.lifecycle && event.lifecycle.label || "落地验证")}</small></div>
          <span>${sectors.length ? sectors.map((sectorName) => escapeHtml(sectorName)).join(" / ") : "暂无清晰板块映射"}</span>
          <em>${stocks.length ? `验证股：${stocks.map((stock) => `${escapeHtml(stock.name)} ${escapeHtml(stock.code)}`).join("、")}` : "没有合格核心验证股"}</em>
          <b>已交易${scoreText(event.pricing && event.pricing.score)} · ${escapeHtml(event.pricing && event.pricing.label || "待复盘")}</b>
        </div>`;
      }).join("")}`
      : `<p class="decision-note">当前没有已落地事件。</p>`;
  }
  if (landedMeta) landedMeta.textContent = `${landedRows.length}条`;
  if (filtered) filtered.innerHTML = filteredRows.length ? filteredRows.map((item) => `<div><strong>${escapeHtml(item.title || "无标题")}</strong><span>${escapeHtml(item.reason || "未通过门槛")}</span></div>`).join("") : `<p class="decision-note">暂无过滤记录。</p>`;
  if (filteredMeta) filteredMeta.textContent = `${Number(model.filteredCount) || 0}条`;
  if (meta) meta.textContent = `${formatTime(model.generatedAt)} · ${qualifiedRows.length}个合格事件 · 时间轴和推演均已自动保存`;

  if (!top) {
    if (decisionGate) decisionGate.textContent = "事件不加仓";
    if (decisionBody) decisionBody.innerHTML = `<p><b>结论：</b>本轮无合格E3/E4事件，原情绪周期、市场总开关和个股买点照常执行，不因普通消息增加仓位。</p>`;
    if (reviewMeta) reviewMeta.textContent = "无合格事件";
    if (reviewBody) reviewBody.innerHTML = `<p class="decision-note">事件层没有新增结论；今日复盘仍以市场情绪、承接和量能为主。</p>`;
    return;
  }

  const topIntegration = top.systemIntegration || {};
  const topAnchors = top.anchors && Array.isArray(top.anchors.items) ? top.anchors.items.slice(0, 3) : [];
  const riskOnly = topIntegration.mode === "risk";
  const executable = topIntegration.mode === "conditional" && top.trading && ["T2", "T3"].includes(top.trading.grade);
  if (decisionGate) {
    decisionGate.className = `event-decision-gate ${riskOnly ? "is-risk" : executable ? "is-conditional" : "is-observe"}`;
    decisionGate.textContent = riskOnly ? "风险约束" : executable ? "有条件观察" : "只提醒，不开仓";
  }
  if (decisionBody) {
    decisionBody.innerHTML = `
      <div class="decision-event-summary">
        <strong>${escapeHtml(top.title || "事件待确认")}</strong>
        <div><span>${escapeHtml(top.importance && top.importance.grade || "E0")}</span><span>${escapeHtml(top.lifecycle && top.lifecycle.label || "待判断")}</span><span>预期交易度${scoreText(top.pricing && top.pricing.score)}</span><span>${escapeHtml(top.trading && top.trading.grade || "T0")}</span></div>
        <p>${escapeHtml(topIntegration.marketNote || "事件不能改变当前周期。")}</p>
        <p><b>必须先过：</b>${escapeHtml(topIntegration.entryGate || "市场总开关与核心锚点共同确认。")}</p>
        <p><b>明日看谁：</b>${topAnchors.length ? topAnchors.map((anchor) => `${escapeHtml(anchor.name)}（${escapeHtml(anchor.type)}）`).join("、") : "暂无合格核心验证标的，不能执行"}</p>
      </div>`;
  }
  if (reviewMeta) reviewMeta.textContent = `${top.importance && top.importance.grade || "E0"} · ${top.lifecycle && top.lifecycle.label || "待判断"} · ${top.trading && top.trading.grade || "T0"}`;
  if (reviewBody) {
    const focusScenario = Array.isArray(top.scenarios)
      ? top.scenarios.find((item) => item.type === (riskOnly ? "risk-spread" : "cashout"))
      : null;
    reviewBody.innerHTML = `
      <div class="review-event-summary">
        <strong>${escapeHtml(top.title || "事件待确认")}</strong>
        <p>${escapeHtml(topIntegration.directionNote || "优先看核心验证标的，而不是新闻标题。")}</p>
        <p><b>${riskOnly ? "风险处理" : "兑现风险"}：</b>${escapeHtml(focusScenario && focusScenario.condition || (riskOnly ? "外部风险未被A股承接前，继续收紧买入权限。" : "临近事件节点时重新判断预期交易度。"))}</p>
        <p><b>复盘定位：</b>${escapeHtml(topIntegration.marketNote || "事件只作辅助，不改变周期。")}</p>
      </div>`;
  }
}

function resolveTomorrowDecisionCandidateProjection(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const unified = resolveUnifiedDecisionChainProjection(source);
  const tomorrowDecision = source.tomorrowDecision && typeof source.tomorrowDecision === "object"
    ? source.tomorrowDecision
    : {};
  const tomorrowDecorationAligned = Boolean(
    unified.contractReady
    && String(tomorrowDecision.generationId || "").trim() === unified.generationId
    && String(tomorrowDecision.tradingDate || "").trim() === unified.tradingDate
    && String(tomorrowDecision.asOf || "").trim() === unified.asOf,
  );
  const scenarioRows = tomorrowDecorationAligned && Array.isArray(tomorrowDecision.scenarios)
    ? tomorrowDecision.scenarios.filter(Boolean) : [];
  const scenarioByKey = new Map(scenarioRows.map((item) => [String(item && item.key || ""), item]));
  const primaryScenarioKey = tomorrowDecorationAligned ? String(tomorrowDecision.primaryScenarioKey || "") : "";
  const primary = unified.stocks.map((item, index) => {
    const buy = item.buy && typeof item.buy === "object" ? item.buy : {};
    const scenarioKey = String(item.scenarioKey || primaryScenarioKey || `result_${index + 1}`);
    const scenario = scenarioByKey.get(scenarioKey) || {};
    return {
      ...item,
      decisionRole: "primary",
      scenarioKey,
      scenarioLabel: String(item.scenarioLabel || scenario.label || "统一决策链结果"),
      stockTriggers: Array.isArray(item.stockTriggers)
        ? item.stockTriggers
        : Array.isArray(buy.triggers) ? buy.triggers : [],
      cancelConditions: Array.isArray(item.cancelConditions)
        ? item.cancelConditions
        : Array.isArray(buy.cancelConditions) ? buy.cancelConditions : [],
      oneLineReason: item.oneLineReason || buy.summary || "",
      pricePhaseLabel: item.pricePhaseLabel || item.phase || item.stateLabel || "",
    };
  });
  const blockedCandidates = unified.contractReady
    ? (Array.isArray(unified.result.rejected) ? unified.result.rejected.filter(Boolean) : [])
    : unified.blockers.length ? [{ name: "统一决策链", reasons: unified.blockers }] : [];
  const scenarioPlans = primary.map((candidate) => ({
    key: candidate.scenarioKey,
    label: `${candidate.scenarioLabel} · 结果股`,
    title: "统一决策链结果股",
    statusLabel: "已通过完整授权链",
    candidate,
    marketSignals: [],
  }));
  return {
    canonical: true,
    contractReady: unified.contractReady,
    executionOpen: unified.executionOpen,
    unified,
    decision: unified.chain,
    primaryGatePassed: unified.executionOpen,
    primaryGateReasons: unified.executionOpen ? [] : unified.blockers,
    primary,
    observations: unified.observationCandidates || [],
    contingencies: [],
    executable: primary,
    blockedCandidates,
    scenarioPlans,
    pickRows: scenarioPlans.map((plan) => ({ ...plan.candidate, tomorrowPath: plan })),
    contingencyRows: [],
    priceIntegrity: null,
    legacyNote: "旧候选只作证据，不得补位统一决策链结果。",
  };
}

function renderUnifiedObservationCandidates(rows) {
  const observations = Array.isArray(rows) ? rows.filter((item) => item && typeof item === "object").slice(0, 5) : [];
  if (!observations.length) return "";
  const tierCounts = observations.reduce((acc, row) => {
    const key = String(row.tierKey || "path_representative");
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
  const tierSummary = [
    `A层重开${tierCounts.reopen_candidate || 0}只`,
    `B层代表${tierCounts.path_representative || 0}只`,
    `C层失败${tierCounts.hard_gate_failed || 0}只`,
  ].join(" · ");
  return `
    <details class="tomorrow-path-observation" data-decision-role="unified-observation-candidates" open>
      <summary>统一观察候选 · ${observations.length}只（无仓位、无买点）</summary>
      <section class="decision-execution-watch is-premium">
        <header><div><strong>授权关闭后的分层观察对象</strong><span>${escapeHtml(tierSummary)}；只用于等待条件重开，绝不补入正式结果股</span></div><b>最多5只</b></header>
        <div class="decision-execution-watch-list">
          ${observations.map((row) => {
            const missing = Array.isArray(row.missingConditions) ? row.missingConditions.filter(Boolean) : [];
            const reopen = Array.isArray(row.reopenConditions) ? row.reopenConditions.filter(Boolean) : [];
            const cancel = Array.isArray(row.cancelConditions) ? row.cancelConditions.filter(Boolean) : [];
            const leadership = row.leadership && typeof row.leadership === "object" ? row.leadership : {};
            return `<article data-execution="observation-only">
              <div><strong>${escapeHtml(row.name || row.code || "未命名标的")}</strong><span>${escapeHtml(row.code || "")} · ${escapeHtml(row.pathLabel || row.path || "路径待确认")}</span></div>
              <small>${escapeHtml(row.tierLabel || "B层·路径代表观察")} · ${escapeHtml(row.theme || "题材待确认")} · 主动性${Number.isFinite(Number(leadership.initiativeScore)) ? escapeHtml(String(leadership.initiativeScore)) : "--"} · ${escapeHtml(leadership.dataQuality || "数据待确认")}</small>
              <p><b>当前缺口</b> · ${escapeHtml(missing.slice(0, 3).join("；") || "统一交易授权未开放")}</p>
              <p><b>重开条件</b> · ${escapeHtml(reopen.slice(0, 3).join("；") || "重新通过完整决策链")}</p>
              ${cancel.length ? `<p><b>取消条件</b> · ${escapeHtml(cancel.slice(0, 2).join("；"))}</p>` : ""}
            </article>`;
          }).join("")}
        </div>
      </section>
    </details>`;
}

function renderBlockedCandidateDiagnostics(rows) {
  const blockedRows = Array.isArray(rows) ? rows.filter((item) => item && typeof item === "object") : [];
  if (!blockedRows.length) return "";
  return `
    <details class="tomorrow-path-observation" data-decision-role="blocked-diagnostics">
      <summary>不可执行诊断 · ${blockedRows.length}只（禁止执行）</summary>
      <section class="decision-execution-watch is-risk">
        <header><div><strong>已被最终决策拦截</strong><span>仅用于解释为何淘汰，不是候选或备选</span></div><b>${blockedRows.length}只</b></header>
        <div class="decision-execution-watch-list">
          ${blockedRows.map((row) => {
            const reasons = Array.isArray(row.reasons)
              ? row.reasons.filter(Boolean)
              : Array.isArray(row.blockers) ? row.blockers.filter(Boolean) : [];
            return `<article data-execution="blocked">
              <div><strong>${escapeHtml(row.name || row.code || "未命名标的")}</strong>${row.code ? `<span>${escapeHtml(String(row.code))}</span>` : ""}</div>
              <small>禁止执行${row.scenarioKey ? ` · ${escapeHtml(String(row.scenarioKey))}` : ""}</small>
              <p><b>淘汰原因</b> · ${escapeHtml(reasons.join("；") || "未通过最终决策硬门槛")}</p>
            </article>`;
          }).join("")}
        </div>
      </section>
    </details>`;
}

function renderContingencyCandidateObservations(rows) {
  const contingencyRows = Array.isArray(rows) ? rows.filter((item) => item && typeof item === "object") : [];
  if (!contingencyRows.length) return "";
  return `
    <details class="tomorrow-path-observation" data-decision-role="contingency-observation">
      <summary>条件备选观察 · ${contingencyRows.length}只（不是当前可执行）</summary>
      <section class="decision-execution-watch is-premium">
        <header><div><strong>路径切换后重新评估</strong><span>这里只保留观察身份，不生成当前买入卡</span></div><b>${contingencyRows.length}只</b></header>
        <div class="decision-execution-watch-list">
          ${contingencyRows.map((row) => `
            <article data-execution="contingency">
              <div><strong>${escapeHtml(row.name || row.code || "未命名标的")}</strong>${row.code ? `<span>${escapeHtml(String(row.code))}</span>` : ""}</div>
              <small>${escapeHtml(row.scenarioLabel || row.scenarioKey || "非主路径")} · 条件备选</small>
              <p><b>不是当前可执行</b> · 路径切换后重新评估，届时仍须重新通过价格、承接与完整性门槛。</p>
            </article>`).join("")}
        </div>
      </section>
    </details>`;
}

function renderCanonicalDecisionEmptyState(projection) {
  const safeProjection = projection && typeof projection === "object" ? projection : {};
  const decision = safeProjection.decision && typeof safeProjection.decision === "object" ? safeProjection.decision : {};
  const action = decision.action && typeof decision.action === "object" ? decision.action : {};
  const verdictDetail = decision.verdictDetail && typeof decision.verdictDetail === "object" ? decision.verdictDetail : {};
  const hasContingencies = Array.isArray(safeProjection.contingencies) && safeProjection.contingencies.length > 0;
  const planText = action.summary || verdictDetail.summary || (hasContingencies
    ? "主路径没有可执行候选；条件备选只观察，路径切换后重新评估。"
    : "主路径与条件备选均无合格股票，继续空仓等待。");
  return `
    <div class="decision-plan-without-ticket" data-decision-source="canonical">
      <div class="decision-no-entry">
        <b>最终决策：没有可执行主候选</b>
        <p>旧最优解不会补位；只有通过完整授权链的主路径候选才能进入执行区。</p>
      </div>
      <div class="decision-plan-summary">
        <span>当前动作</span>
        <strong>${escapeHtml(planText)}</strong>
        <p>被拦截的股票只会出现在下方“不可执行诊断”，且明确禁止执行。</p>
      </div>
      ${renderContingencyCandidateObservations(safeProjection.contingencies)}
      ${renderBlockedCandidateDiagnostics(safeProjection.blockedCandidates)}
    </div>`;
}

function renderReviewConclusion(payload) {
  const model = payload && payload.marketEmotion ? payload.marketEmotion : null;
  const review = model && model.review ? model.review : null;
  const hero = document.querySelector("#reviewConclusionHero");
  const today = document.querySelector("#reviewConclusionToday");
  const tomorrow = document.querySelector("#reviewConclusionTomorrow");
  const picks = document.querySelector("#reviewConclusionPicks");
  const meta = document.querySelector("#reviewConclusionMeta");
  const audit = document.querySelector("#reviewConclusionPriceAudit");
  if (!hero || !today || !tomorrow || !picks) return;

  if (!model || !review) {
    hero.className = "review-conclusion-hero is-empty";
    hero.innerHTML = `<span>等待结论</span><div><h3>还没有可用的盘后快照</h3><p>重新抓取后自动生成复盘结论。</p></div>`;
    today.innerHTML = `<p class="decision-note">当前快照还没有复盘结论。</p>`;
    tomorrow.innerHTML = `<p class="decision-note">等待市场情绪结论。</p>`;
    picks.innerHTML = `<p class="decision-note">等待候选与价格校验。</p>`;
    if (meta) meta.textContent = "等待抓取";
    if (audit) audit.textContent = "等待价格校验";
    return;
  }

  const light = ["green", "yellow", "red"].includes(model.light) ? model.light : "yellow";
  const facts = Array.isArray(review.facts) ? review.facts : [];
  const next = review.tomorrow || {};
  const unifiedProjection = resolveUnifiedDecisionChainProjection(payload);
  const rawOnlyRows = Array.isArray(next.only) ? next.only : [];
  const rawAvoidRows = Array.isArray(next.avoid) ? next.avoid : [];
  const rawTimeline = Array.isArray(next.timeline) ? next.timeline : [];
  const onlyRows = unifiedProjection.executionOpen
    ? rawOnlyRows
    : [
      "只观察统一链列出的观察候选，不下单、不预设仓位",
      "等待市场授权、题材/模式与个股分时触发重新同时通过",
    ];
  const avoidRows = unifiedProjection.executionOpen
    ? rawAvoidRows
    : Array.from(new Set([
      "不把观察候选、旧selected或旧复盘核心写成可执行股票",
      "统一链重开前不新增仓位",
      ...rawAvoidRows,
    ]));
  const timeline = unifiedProjection.executionOpen
    ? rawTimeline
    : rawTimeline.map((step) => ({
      ...step,
      title: "只观察，不下单",
      text: `${String(step && step.text || "观察市场、方向与个股承接。")} 统一决策链重新授权前不执行。`,
    }));
  const reviewPositionLimit = unifiedProjection.executionOpen
    ? String(next.positionLimit || model.action || "--")
    : "0%（统一决策链未授权）";
  const unifiedStage = unifiedProjection.marketStage;
  const reviewBigCycle = String(unifiedStage && unifiedStage.bigCycle && unifiedStage.bigCycle.label || "待确认");
  const reviewTransition = String(
    unifiedStage && unifiedStage.transition
    && !/^(none|not_active)$/.test(String(unifiedStage.transition.key || unifiedStage.transition.status || ""))
    && unifiedStage.transition.label || "",
  );
  const reviewSmallCycle = String(unifiedStage && unifiedStage.smallCycle && unifiedStage.smallCycle.label || "待确认");
  const finalConclusion = `今天是${model.quality || "待判断"}，结构为${model.structureType || "待判断"}；明天按“${next.base || model.nextDayBase || "等待确认"}”执行。`;

  hero.className = `review-conclusion-hero is-${light}`;
  hero.innerHTML = `
    <span>${escapeHtml(model.lightLabel || "市场灯")}</span>
    <div>
      <p>最终复盘结论</p>
      <h3>${escapeHtml(review.oneLine || `${model.quality || "待判断"} · ${model.structureType || "市场结构待判断"}`)}</h3>
      <strong>${escapeHtml(finalConclusion)}</strong>
      <div class="review-conclusion-tags">
        <em>大周期：${escapeHtml(reviewBigCycle)}${reviewTransition ? ` · 过渡节点：${escapeHtml(reviewTransition)}` : ""} · 小周期：${escapeHtml(reviewSmallCycle)}</em>
        <em>明日仓位：${escapeHtml(unifiedProjection.executionOpen ? `${unifiedProjection.maximumPortfolioPct}%` : "0%（统一决策链未授权）")}</em>
        <em>价格：最新收盘价三源校验</em>
      </div>
    </div>`;

  today.innerHTML = `
    <div class="review-conclusion-facts">
      ${facts.map((item, index) => `
        <div><b>${index + 1}</b><p><strong>${escapeHtml(item.label || "观察")}</strong><span>${escapeHtml(item.text || "--")}</span></p></div>`).join("") || `<p class="decision-note">${escapeHtml(model.summary || "--")}</p>`}
    </div>
    ${renderMarketStrengthReviewDetails(payload && payload.marketStrengthSource)}`;

  tomorrow.innerHTML = `
    <div class="review-conclusion-base"><span>基础预期</span><strong>${escapeHtml(next.base || model.nextDayBase || "--")}</strong><b>${escapeHtml(reviewPositionLimit)}</b></div>
    <div class="review-conclusion-do-dont">
      <div class="is-do"><strong>明日只做</strong><ul>${onlyRows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul></div>
      <div class="is-dont"><strong>明日不做</strong><ul>${avoidRows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul></div>
    </div>
    <div class="review-conclusion-timeline">
      ${timeline.map((step) => `<div><b>${escapeHtml(step.time || "--")}</b><p><strong>${escapeHtml(step.title || "观察")}</strong><span>${escapeHtml(step.text || "")}</span></p></div>`).join("")}
    </div>
    ${next.invalidation ? `<p class="review-conclusion-invalid"><b>全部取消：</b>${escapeHtml(next.invalidation)}</p>` : ""}
    ${renderTomorrowDecisionReviewDetails(payload && payload.tomorrowDecision)}`;

  const candidateProjection = resolveTomorrowDecisionCandidateProjection(payload);
  const priceAudit = candidateProjection.priceIntegrity;
  if (audit) {
    if (candidateProjection.canonical) {
      const pass = candidateProjection.contractReady === true;
      audit.className = `review-conclusion-price-audit ${pass ? "is-pass" : "is-warn"}`;
      audit.textContent = pass
        ? `✓ 已按统一决策链v3筛选 · ${candidateProjection.primary.length}只结果股`
        : `✕ ${candidateProjection.primaryGateReasons[0] || "统一决策链完整性异常"}，暂停执行`;
    } else {
      const pass = priceAudit && priceAudit.status === "pass";
      audit.className = `review-conclusion-price-audit ${pass ? "is-pass" : "is-warn"}`;
      audit.textContent = pass
        ? `✓ ${priceAudit.checkedCount || 0}只价格校验通过`
        : "✕ 价格校验异常，暂停使用买点";
    }
  }

  const pickRows = candidateProjection.pickRows;
  const pickHtml = pickRows.length ? pickRows.map((pick, index) => {
    const latestPrice = Number(pick.price);
    const lines = pick.tomorrowPath && Array.isArray(pick.stockTriggers)
      ? pick.stockTriggers.slice(0, 3)
      : pick.buy && Array.isArray(pick.buy.auctionLines) ? pick.buy.auctionLines.slice(0, 3) : [];
    const consistent = !pick.priceIntegrity || pick.priceIntegrity.consistent !== false;
    const leadership = pick.leadership || {};
    const initiative = leadership.initiative || {};
    const structure = leadership.structure || {};
    const path = pick.tomorrowPath || null;
    const participationValue = pick.participationValue && typeof pick.participationValue === "object"
      ? pick.participationValue : {};
    const positionAllocation = pick.positionAllocation && typeof pick.positionAllocation === "object"
      ? pick.positionAllocation : {};
    const participationScore = Number(participationValue.score);
    const initialPortfolioPct = Number(positionAllocation.initialPortfolioPct);
    const maximumPortfolioPct = Number(positionAllocation.maximumPortfolioPct);
    const allocationHtml = Number.isFinite(participationScore)
      || Number.isFinite(initialPortfolioPct)
      || Number.isFinite(maximumPortfolioPct)
      ? `<div class="review-conclusion-allocation"><span>参与价值 ${Number.isFinite(participationScore) ? escapeHtml(participationScore.toFixed(2)) : "--"}</span><b>初始 ${Number.isFinite(initialPortfolioPct) ? escapeHtml(initialPortfolioPct.toFixed(2)) : "--"}% · 上限 ${Number.isFinite(maximumPortfolioPct) ? escapeHtml(maximumPortfolioPct.toFixed(2)) : "--"}%</b></div>`
      : "";
    return `
      <article class="review-conclusion-pick ${consistent ? "is-valid" : "is-blocked"}">
        <div class="review-conclusion-pick-head">
          <span>${escapeHtml(path ? path.label : `候选${index + 1}`)}</span>
          <div><strong>${escapeHtml(pick.name || pick.code || "--")}</strong><small>${escapeHtml(pick.code || "")} · ${escapeHtml(path ? (pick.pricePhaseLabel || pick.stateLabel || path.title) : leadership.identity || pick.role || "观察")} · ${escapeHtml(path ? "条件命中才执行" : leadership.tradeState || pick.slotLabel || "仅观察")}</small></div>
          <b>${Number.isFinite(latestPrice) ? latestPrice.toFixed(2) : "--"}<small>最新收盘</small></b>
        </div>
        <p>${consistent
          ? escapeHtml(path
            ? `${path.marketCondition || "先判市场路径"} ${pick.oneLineReason || "等待个股触发。"}`
            : `主动性${initiative.label || "待确认"} ${Number.isFinite(Number(initiative.score)) ? String(initiative.score) : "--"}（${initiative.dataQuality || "数据待确认"}） · 结构${structure.grade || "--"} · ${structure.positionLabel || "位置待确认"}`)
          : "价格源校验未通过，本票买点已关闭。"}</p>
        ${allocationHtml}
        <ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
      </article>`;
  }).join("") : `<p class="decision-note">${escapeHtml(candidateProjection.canonical
    ? "最终决策当前没有可执行候选；旧最优解不会补位。"
    : candidateProjection.legacyNote || "当前没有可执行候选，空仓也是结论。")}</p>`;
  picks.innerHTML = pickHtml
    + renderUnifiedObservationCandidates(candidateProjection.observations)
    + renderContingencyCandidateObservations(candidateProjection.contingencies)
    + renderBlockedCandidateDiagnostics(candidateProjection.blockedCandidates);

  if (meta) {
    const time = model.asOf ? formatTime(model.asOf) : "--";
    meta.textContent = `${model.tradingDate || "最近交易日"} · 快照 ${time} · 自动保存`;
  }
}

function cleanDirectDirection(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return (text.split("（含")[0].split("(含")[0].trim() || "暂无明确方向");
}

function directDecisionTextRows(...values) {
  const rows = [];
  values.flat(Infinity).forEach((value) => {
    if (value === null || value === undefined || value === "") return;
    const text = typeof value === "object"
      ? String(value.reason || value.summary || value.detail || value.label || value.text || "")
      : String(value);
    text.split(/[；;。]+/).map((item) => item.trim()).filter(Boolean).forEach((item) => rows.push(item));
  });
  return rows;
}

function directPlainGateReason(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/数据|报价|样本/.test(text) && /缺|不足|不完整|待补|未知|unknown/i.test(text)) {
    return "关键市场数据还没齐，暂时不能可靠判断明日机会。";
  }
  if (/指数环境与短线赚钱效应尚未形成可执行组合/.test(text)) {
    return "大盘环境和短线赚钱表现还没有一起转强，现在买入胜算不够。";
  }
  if (/周期.*(?:没有|无).*交易窗口/.test(text)) {
    return "大盘走势和短线节奏还没有同时给出合适买点。";
  }
  if (/当前没有盘后直接执行的标的|没有.*直接执行.*标的/.test(text)) {
    return "目前有关注方向，但还没有一只股票出现清楚、可执行的买点。";
  }
  if (/主路径无合格载体|无合格载体|没有合格.*载体/.test(text)) {
    return "最符合当前市场走法的股票还没通过全部条件，所以先不硬选。";
  }
  if (/决策未开放候选激活权限|候选激活权限/.test(text)) {
    return "现在只能先观察，候选股还不能转成正式交易计划。";
  }
  if (/禁止新开仓|交易窗口.*(?:关闭|禁止)|不允许.*执行|执行权限.*(?:关闭|blocked)/i.test(text)) {
    return "当前市场条件还不支持新开仓。";
  }
  if (/核心身份仍保留/.test(text)) {
    return "重点股仍值得观察，但明天要先看卖盘出来后能不能重新稳住。";
  }
  let plain = text
    .replace(/主路径/g, "当前主要方向")
    .replace(/载体/g, "股票")
    .replace(/执行闸门|交易闸门/g, "交易条件")
    .replace(/激活权限/g, "进入交易计划的条件")
    .replace(/负反馈扩散/g, "更多重点股一起转弱")
    .replace(/承接/g, "回落后能稳住")
    .replace(/兑现/g, "卖盘增加")
    .replace(/回流/g, "资金重新回来");
  if (!/[。！？]$/.test(plain)) plain += "。";
  return plain;
}

function directPlainReopenCondition(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/主动龙头率先发动.*容量承接.*板块扩散/.test(text)) {
    return "最强的带头股先走强，同时大成交核心能稳住，板块里有更多股票跟涨。";
  }
  if (/板块成交放大.*少数超跌票/.test(text)) {
    return "板块要有真实放量，不能只是少数跌多了的股票反弹。";
  }
  if (/有效突破|新高扩散/.test(text)) {
    return "核心股有效突破，并且有更多同板块股票跟着走强。";
  }
  let plain = text
    .replace(/主动龙头/g, "最强的带头股")
    .replace(/容量/g, "大成交核心股")
    .replace(/承接/g, "回落后稳住")
    .replace(/扩散/g, "有更多股票跟涨")
    .replace(/升级绿灯|由黄灯升级绿灯/g, "重新开放交易机会")
    .replace(/共振/g, "一起走强");
  if (!/[。！？]$/.test(plain)) plain += "。";
  return plain;
}

function buildDirectDecisionSummary(payload, strengthModel) {
  const bestPicks = payload && payload.bestPicks && typeof payload.bestPicks === "object" ? payload.bestPicks : {};
  const marketEmotion = payload && payload.marketEmotion && typeof payload.marketEmotion === "object" ? payload.marketEmotion : {};
  const tomorrow = marketEmotion.review && marketEmotion.review.tomorrow && typeof marketEmotion.review.tomorrow === "object"
    ? marketEmotion.review.tomorrow
    : {};
  const themes = payload && payload.themeLibrary && Array.isArray(payload.themeLibrary.themes)
    ? payload.themeLibrary.themes
    : [];
  const tomorrowDecision = payload && payload.tomorrowDecision && typeof payload.tomorrowDecision === "object"
    ? payload.tomorrowDecision
    : null;
  const unifiedProjection = resolveUnifiedDecisionChainProjection(payload);
  const sourcePositionCeiling = Math.max(0, Number(unifiedProjection.sourcePositionCeilingPct) || 0);
  const positionPlan = unifiedProjection.executionOpen ? {
    label: `初始${unifiedProjection.initialPortfolioPct}% · 上限${unifiedProjection.maximumPortfolioPct}%`,
    hint: "已通过市场、方向、个股与仓位授权",
  } : unifiedProjection.positionMode === "waiting_candidate" && sourcePositionCeiling > 0 ? {
    label: `新仓0% · 条件上限${sourcePositionCeiling}%`,
    hint: "市场权限已开放，但还没有通过全部门槛的个股",
  } : unifiedProjection.positionMode === "risk_only" && sourcePositionCeiling > 0 ? {
    label: `新仓0% · 持仓风险上限${sourcePositionCeiling}%`,
    hint: "当前只管理已有持仓；核心率先走强后重新计算新仓",
  } : {
    label: "新仓0% · 风险上限未开放",
    hint: "不是固定空仓；市场与核心触发条件通过后会自动重算",
  };
  if (!unifiedProjection.contractReady || !tomorrowDecision || Number(tomorrowDecision.version || 0) < 1) {
    const marketStage = unifiedProjection.marketStage || {};
    const bigCycle = marketStage.bigCycle && typeof marketStage.bigCycle === "object" ? marketStage.bigCycle : {};
    const smallCycle = marketStage.smallCycle && typeof marketStage.smallCycle === "object" ? marketStage.smallCycle : {};
    const executionRows = unifiedProjection.stocks.map((candidate) => ({
      code: String(candidate.code || ""),
      name: String(candidate.name || candidate.code || "--"),
      direction: String(candidate.theme || candidate.mainConcept || "题材待确认"),
      identity: String(candidate.stockMode || candidate.identity || candidate.role || "结果股"),
      phase: String(candidate.pricePhaseLabel || candidate.stateLabel || "统一链已授权"),
      pathLabel: "统一决策链",
      buy: "等待同代执行计划补齐后再下单",
      hold: "未成交前不适用持有建议",
      sell: "成交后按真实成本重算卖出线",
      holdingPeriod: "T+1强制复核",
      participationValue: candidate.participationValue || null,
      riskAdjustedParticipationScore: candidate.riskAdjustedParticipationScore,
      positionAllocation: candidate.positionAllocation || null,
    }));
    return {
      tone: unifiedProjection.executionOpen ? "warn" : "neutral",
      todayTitle: unifiedProjection.contractReady ? String(bigCycle.label || "大周期待确认") : "统一决策链待确认",
      tomorrowBase: unifiedProjection.executionOpen ? "统一决策链已授权，但还需同代买卖触发计划" : (unifiedProjection.blockers[0] || "统一决策链未授权"),
      permission: positionPlan.label,
      positionHint: positionPlan.hint,
      direction: String(unifiedProjection.chain && unifiedProjection.chain.theme && unifiedProjection.chain.theme.label || "暂无授权方向"),
      directionPath: unifiedProjection.executionOpen ? "仅统一决策链结果股可进入执行区" : "旧候选只作证据，不得补位",
      opportunity: null,
      candidates: executionRows,
      contingencies: [],
      action: unifiedProjection.executionOpen ? "等待买卖触发计划与盘中承接同时确认。" : "统一决策链未授权，明日空仓等待。",
      cancel: unifiedProjection.blockers[0] || "统一决策链关闭或代次不一致时全部取消",
      priceAuditLabel: "",
      forecast: null,
      tomorrowBaseline: null,
      state: {
        cycle: String(bigCycle.label || "待确认"),
        bigCycle: String(bigCycle.label || "待确认"),
        bigCycleStatus: String(bigCycle.status || "unavailable"),
        bigCycleReasonCode: String(bigCycle.reasonCode || ""),
        bigCycleReason: String(bigCycle.reason || ""),
        bigCycleEvidence: Array.isArray(bigCycle.evidence) ? bigCycle.evidence.map(String).filter(Boolean) : [],
        bigCycleWindowDays: Number(bigCycle.windowDays) || null,
        bigCycleWindow: bigCycle.window && typeof bigCycle.window === "object" ? bigCycle.window : null,
        bigCycleSource: String(bigCycle.source || ""),
        bigCycleCalibrated: bigCycle.calibrated === true,
        smallCycle: String(smallCycle.label || "待确认"),
        generationId: unifiedProjection.generationId,
        tradingDate: unifiedProjection.tradingDate,
      },
      validation: { upgrade: [], hold: [], downgrade: [] },
      unifiedPreference: null,
      canonical: true,
    };
  }
  if (tomorrowDecision && Number(tomorrowDecision.version || 0) >= 1) {
    const canonicalCandidateProjection = resolveTomorrowDecisionCandidateProjection(payload);
    const tomorrowDecorationAligned = Boolean(
      unifiedProjection.contractReady
      && unifiedProjection.generationId
      && String(tomorrowDecision.generationId || "").trim() === unifiedProjection.generationId
      && String(tomorrowDecision.tradingDate || "").trim() === unifiedProjection.tradingDate
      && String(tomorrowDecision.asOf || "").trim() === unifiedProjection.asOf,
    );
    const safeList = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
    const textOf = (value, fallback = "--") => {
      if (typeof value === "string" && value.trim()) return value.trim();
      if (!value || typeof value !== "object") return fallback;
      return String(value.summary || value.display || value.instruction || value.text || value.label || fallback).trim();
    };
    const pathKey = (value) => {
      const key = String(value || "").trim();
      if (key === "rotation") return "range_divergence";
      if (key === "weakRepair") return "weaken";
      return key;
    };
    const scenarioOrder = ["strengthen", "range_divergence", "weaken"];
    const scenarioLabels = { strengthen: "加强", range_divergence: "震荡分化", weaken: "减弱" };
    const scenarioMap = new Map();
    (tomorrowDecorationAligned ? safeList(tomorrowDecision.scenarios) : []).forEach((scenario) => {
      const key = pathKey(scenario && scenario.key);
      if (scenarioOrder.includes(key) && !scenarioMap.has(key)) scenarioMap.set(key, scenario);
    });
    const scenarios = scenarioOrder.map((key) => {
      const source = scenarioMap.get(key) || {};
      const rawProbability = source.probability;
      const probability = rawProbability === null || rawProbability === undefined || rawProbability === ""
        ? NaN
        : Number(rawProbability);
      return {
        key,
        label: String(source.label || scenarioLabels[key]),
        probability: Number.isFinite(probability) && probability >= 0 && probability <= 100 ? probability : null,
        summary: String(source.summary || ""),
      };
    });
    const probabilityTotal = scenarios.reduce((sum, scenario) => sum + Number(scenario.probability || 0), 0);
    const probabilityAvailable = scenarios.every((scenario) => scenario.probability !== null)
      && Math.abs(probabilityTotal - 100) < 0.05;
    const primaryScenarioKey = pathKey(
      tomorrowDecorationAligned
        ? (tomorrowDecision.primaryScenarioKey || tomorrowDecision.primary && tomorrowDecision.primary.key)
        : "",
    );
    const primaryScenario = scenarios.find((scenario) => scenario.key === primaryScenarioKey) || null;
    const directionModel = tomorrowDecorationAligned && tomorrowDecision.direction && typeof tomorrowDecision.direction === "object"
      ? tomorrowDecision.direction
      : {};
    const forceCash = !canonicalCandidateProjection.primaryGatePassed;
    const normalizeCandidate = (candidate, fallbackRole = "primary") => {
      const executionAdvice = candidate && candidate.executionAdvice && typeof candidate.executionAdvice === "object"
        ? candidate.executionAdvice
        : candidate && candidate.advice && typeof candidate.advice === "object" ? candidate.advice : candidate || {};
      const holding = executionAdvice.holdingPeriod || candidate && candidate.holdingPeriod || {};
      const expectedDays = holding && holding.expectedDays && typeof holding.expectedDays === "object"
        ? holding.expectedDays
        : executionAdvice.hold && executionAdvice.hold.expectedDays && typeof executionAdvice.hold.expectedDays === "object"
          ? executionAdvice.hold.expectedDays
          : null;
      const holdingLabel = textOf(holding, "") || (expectedDays && Number.isFinite(Number(expectedDays.min)) && Number.isFinite(Number(expectedDays.max))
        ? `${Number(expectedDays.min)}—${Number(expectedDays.max)}个交易日`
        : expectedDays && expectedDays.status === "unavailable" ? "条件持有 · 暂无统计期限" : "T+1强制复核");
      const participationValue = candidate && candidate.participationValue && typeof candidate.participationValue === "object"
        ? candidate.participationValue : null;
      const positionAllocation = candidate && candidate.positionAllocation && typeof candidate.positionAllocation === "object"
        ? candidate.positionAllocation : null;
      return {
        code: String(candidate && candidate.code || ""),
        name: String(candidate && (candidate.name || candidate.code) || "--"),
        direction: String(candidate && candidate.direction || directionModel.name || "暂无明确方向"),
        identity: String(candidate && (candidate.identity || candidate.role) || "条件候选"),
        phase: String(candidate && (candidate.phase || candidate.stateLabel || candidate.pricePhaseLabel) || "等待确认"),
        scenarioRole: String(candidate && candidate.scenarioRole || fallbackRole),
        pathLabel: String(candidate && (candidate.pathLabel || candidate.scenarioLabel) || primaryScenario && primaryScenario.label || "条件路径"),
        buy: textOf(candidate && candidate.buy, textOf(executionAdvice.buy, "没有形成可执行买点")),
        hold: textOf(candidate && candidate.hold, textOf(executionAdvice.hold, "未成交前不适用持有建议")),
        sell: textOf(candidate && candidate.sell, textOf(executionAdvice.sell, "成交后按真实成本重算卖出线")),
        holdingPeriod: holdingLabel,
        upgrade: textOf(candidate && candidate.upgrade || executionAdvice.upgrade, "市场与板块共振后才允许升级"),
        downgrade: textOf(candidate && candidate.downgrade || executionAdvice.downgrade, "承接失败或负反馈扩散立即取消"),
        participationValue,
        riskAdjustedParticipationScore: Number.isFinite(Number(candidate && candidate.riskAdjustedParticipationScore))
          ? Number(candidate.riskAdjustedParticipationScore) : null,
        positionAllocation,
      };
    };
    const dedupeCandidates = (rows, role) => {
      const seen = new Set();
      return safeList(rows).map((candidate) => normalizeCandidate(candidate, role)).filter((candidate) => {
        const key = candidate.code || candidate.name;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 5);
    };
    const projectedCandidates = forceCash ? [] : dedupeCandidates(canonicalCandidateProjection.primary, "primary");
    const contingencies = dedupeCandidates(canonicalCandidateProjection.contingencies, "contingency")
      .filter((candidate) => !projectedCandidates.some((primary) => (primary.code || primary.name) === (candidate.code || candidate.name)));
    const projectedObservationRows = safeList(canonicalCandidateProjection.observations)
      .filter((row) => row && typeof row === "object");
    const observationByCode = new Map(projectedObservationRows.map((row) => [
      String(row.code || row.secCode || row.stockCode || row.symbol || "").trim(),
      row,
    ]).filter(([code]) => code));
    const rawOpportunitySource = (() => {
      const opportunityMap = tomorrowDecorationAligned ? tomorrowDecision.opportunityMap : null;
      if (opportunityMap && typeof opportunityMap === "object" && !Array.isArray(opportunityMap)) return opportunityMap;
      const opportunityDirections = tomorrowDecorationAligned ? tomorrowDecision.opportunityDirections : null;
      if (Array.isArray(opportunityDirections)) return { directions: opportunityDirections };
      if (opportunityDirections && typeof opportunityDirections === "object") return opportunityDirections;
      return null;
    })();
    const postCloseOpportunity = payload && payload.postCloseOpportunity && typeof payload.postCloseOpportunity === "object"
      ? payload.postCloseOpportunity
      : {};
    const postCloseGenerationId = String(postCloseOpportunity.generationId || "").trim();
    const postCloseTradingDate = String(postCloseOpportunity.tradingDate || "").trim();
    const postCloseAsOf = String(postCloseOpportunity.asOf || "").trim();
    const decisionGenerationId = String(tomorrowDecision.generationId || "").trim();
    const postCloseGenerationAligned = Boolean(
      tomorrowDecorationAligned
      && postCloseGenerationId
      && decisionGenerationId === canonicalCandidateProjection.unified.generationId
      && postCloseGenerationId === canonicalCandidateProjection.unified.generationId
      && postCloseTradingDate === canonicalCandidateProjection.unified.tradingDate
      && postCloseAsOf === canonicalCandidateProjection.unified.asOf,
    );
    const conditionalSetupCards = postCloseGenerationAligned && Array.isArray(postCloseOpportunity.setupCards)
      ? postCloseOpportunity.setupCards.filter((card) => {
        const status = String(card && card.status || "").trim().toLowerCase();
        return status === "condition_watch" || status === "plan_ready";
      })
      : [];
    const strictOpportunityCards = postCloseGenerationAligned && Array.isArray(postCloseOpportunity.opportunityCards)
      ? postCloseOpportunity.opportunityCards.filter(Boolean)
      : [];
    const conditionalSetupCount = strictOpportunityCards.length ? 0 : conditionalSetupCards.length;
    const referenceEvidence = (value) => (Array.isArray(value) ? value : value ? [value] : []).map((row) => {
      if (typeof row === "string") return row.trim();
      if (!row || typeof row !== "object") return "";
      return String(row.detail || row.reason || row.summary || row.label || row.text || "").trim();
    }).filter(Boolean).slice(0, 3);
    const directionEvidenceRows = (value) => {
      const directRows = referenceEvidence(value);
      if (!value || typeof value !== "object" || Array.isArray(value)) return directRows;
      const reasonLabels = {
        direction_resonance: "板块与市场形成共振",
        direction_sustained: "赚钱效应具备延续性",
        direction_mainline: "当前主线方向",
        direction_breadth_passed: "板块广度达到门槛",
        high_impact_anchor_present: "有高影响力的情绪代表股",
        same_family_merged: "同族题材已合并去重",
        blocked_subthemes_filtered: "风险子题材已剔除",
      };
      const metricRows = [];
      const breadthCount = Number(value.breadthCount ?? value.count ?? value.stockCount);
      const limitCount = Number(value.limitCount);
      if (Number.isFinite(breadthCount) || Number.isFinite(limitCount)) {
        metricRows.push([
          Number.isFinite(breadthCount) ? `覆盖${Math.round(breadthCount)}只` : "",
          Number.isFinite(limitCount) ? `涨停${Math.round(limitCount)}只` : "",
        ].filter(Boolean).join(" · "));
      }
      const filteredSubthemes = safeList(value.filteredRiskSubthemes)
        .map((row) => String(row || "").trim())
        .filter(Boolean);
      if (filteredSubthemes.length) metricRows.push(`已剔除风险子题材：${filteredSubthemes.join("、")}`);
      const reasonRows = safeList(value.reasonCodes).map((code) => reasonLabels[String(code)] || "").filter(Boolean);
      return Array.from(new Set([...directRows, ...metricRows, ...reasonRows])).slice(0, 4);
    };
    const referenceIdentityLabels = {
      capacity: "大成交核心股",
      height: "高位人气股",
      sentiment: "人气核心股",
      negative: "明显走弱的代表股",
      current_core: "当前核心股",
      historical_core: "过去的人气股",
    };
    const referenceStateLabels = {
      acceleration: "正在加速",
      divergence: "出现分化",
      supported: "有人接住抛盘",
      consensus_resume: "重新走强",
      expectation_overdrawn: "涨得太快",
      negative_feedback: "明显走弱",
      weak_to_strong: "弱转强",
      weak: "弱势",
      unknown: "阶段待确认",
      tradeable: "符合条件",
      watch_only: "只观察",
    };
    const directionRoleLabels = {
      main: "主方向",
      parallel: "并行方向",
      primary: "主方向",
    };
    const referenceRows = (value, kind, directionName) => {
      const seen = new Set();
      return safeList(value).map((item) => {
        const code = String(item && (item.code || item.secCode || item.stockCode || item.symbol) || "").trim();
        const observation = kind === "trade" ? observationByCode.get(code) : null;
        if (kind === "trade" && !observation) return null;
        const reference = observation || item;
        const name = String(reference && (reference.name || reference.stockName || code) || "").trim();
        const key = code || name;
        if (!key || seen.has(key)) return null;
        seen.add(key);
        const weight = Number(reference && (reference.impactWeight ?? reference.emotionWeight ?? reference.weight));
        const identityKey = String(reference && (reference.anchorType || reference.identityState || reference.identity || reference.role || reference.primaryRole || reference.tierLabel) || "").trim();
        const stateKey = String(reference && (reference.state || reference.tradeState || reference.stageLabel || reference.stage) || "").trim();
        return {
          code,
          name,
          direction: directionName,
          kind,
          identity: referenceIdentityLabels[identityKey]
            || identityKey
              .replace(/容量锚点/g, "大成交核心股")
              .replace(/高度锚点/g, "高位人气股")
              .replace(/情绪锚点/g, "人气核心股")
              .replace(/负反馈锚点/g, "明显走弱的代表股")
            || (kind === "anchor" ? "情绪核心股" : "交易核心股"),
          state: referenceStateLabels[stateKey] || stateKey || "等待确认",
          weight: Number.isFinite(weight) ? weight : null,
          evidence: referenceEvidence(reference && (reference.evidence || reference.missingConditions || reference.observationReason)),
          observationSource: kind === "trade" ? "unifiedDecisionChain.observationCandidates" : "emotionAnchorEvidence",
        };
      }).filter(Boolean);
    };
    const rawOpportunityDirections = rawOpportunitySource ? safeList(rawOpportunitySource.directions).map((item, index) => {
      const directionName = cleanDirectDirection(item && (item.name || item.direction || item.family) || `方向${index + 1}`);
      const threadRoleKey = String(item && (item.threadRole || item.role || item.position) || "parallel").trim();
      const directionStateKey = String(item && (item.state || item.statusLabel || item.status) || "watch_only").trim();
      return {
        name: directionName,
        threadRole: directionRoleLabels[threadRoleKey] || threadRoleKey || "并行方向",
        state: referenceStateLabels[directionStateKey] || directionStateKey || "等待确认",
        evidence: directionEvidenceRows(item && item.evidence),
        emotionAnchors: referenceRows(item && (item.emotionAnchors || item.anchors), "anchor", directionName),
        tradeCandidates: referenceRows(item && (item.tradeCandidates || item.candidates), "trade", directionName),
      };
    }).filter((item) => item.name) : [];
    const opportunityStatus = String(rawOpportunitySource && (rawOpportunitySource.status || rawOpportunitySource.statusLabel) || "").trim();
    const opportunityGate = rawOpportunitySource && rawOpportunitySource.globalGate;
    const decisionPermissionSource = tomorrowDecorationAligned && tomorrowDecision.permission && typeof tomorrowDecision.permission === "object" && !Array.isArray(tomorrowDecision.permission)
      ? tomorrowDecision.permission
      : {};
    const premarketGateSource = tomorrowDecorationAligned && tomorrowDecision.premarketGate && typeof tomorrowDecision.premarketGate === "object"
      ? tomorrowDecision.premarketGate
      : {};
    const gateValidation = tomorrowDecorationAligned && tomorrowDecision.validation && typeof tomorrowDecision.validation === "object"
      ? tomorrowDecision.validation
      : {};
    const rawGateReasons = directDecisionTextRows(
      opportunityGate && opportunityGate.reasons,
      opportunityGate && opportunityGate.reason,
      decisionPermissionSource.reasons,
      premarketGateSource.reasons,
    );
    const dataIncomplete = (!rawOpportunitySource && !conditionalSetupCount)
      || /unknown|pending|data[_ -]?(?:missing|incomplete)|数据.*(?:缺|不足|待补)/i.test(opportunityStatus)
      || rawGateReasons.some((reason) => /数据|报价|样本/.test(reason) && /缺|不足|不完整|待补|未知|unknown/i.test(reason));
    const gateExplicitlyBlocked = opportunityGate === false
      || Boolean(opportunityGate && typeof opportunityGate === "object" && (
        opportunityGate.allowTrade === false
        || opportunityGate.allowNew === false
        || opportunityGate.canTrade === false
        || opportunityGate.canTradeCandidates === false
        || opportunityGate.executionAllowed === false
        || /blocked|observe|no[_ -]?trade|cash|wait|禁止|仅观察|无交易/.test(String(opportunityGate.status || opportunityGate.key || "").toLowerCase())
      ));
    const legacyOpportunityBlocked = gateExplicitlyBlocked
      || /blocked|observe|no[_ -]?trade|cash|wait|禁止|仅观察|无交易/.test(opportunityStatus.toLowerCase());
    const opportunityNoTrade = forceCash;
    const opportunityDirections = rawOpportunityDirections;
    const candidates = opportunityNoTrade ? [] : projectedCandidates;
    const opportunityState = dataIncomplete
      ? "data_pending"
      : conditionalSetupCount && !candidates.length
        ? "conditional_setups"
      : rawOpportunityDirections.length && !candidates.length
        ? "direction_wait_entry"
        : !rawOpportunityDirections.length
          ? "no_opening_opportunity"
          : "conditional";
    const opportunityTitle = ({
      data_pending: "数据还没齐，暂时不判断",
      conditional_setups: `已发现${conditionalSetupCount}个条件机会，暂无可直接执行买点`,
      direction_wait_entry: "有方向，但暂时没有合适买点",
      no_opening_opportunity: "暂时没有合适的新开仓机会",
      conditional: `${rawOpportunityDirections.length}个方向，等待买点确认`,
    })[opportunityState];
    const fallbackReason = opportunityState === "data_pending"
      ? "关键市场数据还没齐，暂时不能可靠判断明日机会。"
      : opportunityState === "conditional_setups"
        ? "符合个人交易逻辑的结构已经出现，但还要等核心股给出触发信号；这是条件机会，不是确认买点。"
      : opportunityState === "direction_wait_entry"
        ? "目前有关注方向，但还没有一只股票出现清楚、可执行的买点。"
        : opportunityState === "no_opening_opportunity"
          ? "目前没有方向和股票同时通过条件，所以先不新开仓。"
          : "方向已经出现，但仍要等核心股给出清楚买点。";
    const reasonSeen = new Set();
    const mappedGateReasons = rawGateReasons.map(directPlainGateReason).filter((reason) => {
      if (!reason || reasonSeen.has(reason)) return false;
      reasonSeen.add(reason);
      return true;
    });
    const stateReasonRows = opportunityState === "data_pending"
      ? []
      : mappedGateReasons.filter((reason) => (
        opportunityState !== "no_opening_opportunity" || !/有关注方向/.test(reason)
      ));
    const plainReasons = Array.from(new Set([fallbackReason, ...stateReasonRows])).slice(0, 3);
    const reopenSeen = new Set();
    const reopenConditions = directDecisionTextRows(
      opportunityGate && (opportunityGate.reopenConditions || opportunityGate.openConditions),
      gateValidation.upgrade,
    ).map(directPlainReopenCondition).filter((condition) => {
      if (!condition || reopenSeen.has(condition)) return false;
      reopenSeen.add(condition);
      return true;
    }).slice(0, 2);
    if (opportunityState === "data_pending") {
      reopenConditions.splice(0, reopenConditions.length, "等关键市场数据补齐后，再重新判断有没有机会。");
    } else if (!reopenConditions.length && opportunityState === "conditional_setups") {
      reopenConditions.push("等核心股完成分歧后的重新走强，并且题材里有其他股票一起跟上。", "如果市场转入退潮，这些条件机会全部取消。");
    } else if (!reopenConditions.length && opportunityState === "direction_wait_entry") {
      reopenConditions.push("等最强的核心股出现清楚买点，而且开盘后没有明显转弱。");
    }
    const opportunity = {
      available: true,
      status: opportunityNoTrade ? "observe_only" : "conditional",
      noTrade: opportunityNoTrade,
      state: opportunityState,
      title: opportunityTitle,
      gateText: plainReasons[0] || fallbackReason,
      reasons: plainReasons.slice(0, 3),
      reopenConditions,
      directions: opportunityDirections,
      conditionalSetupCount,
      legacyObservationBlocked: legacyOpportunityBlocked,
    };
    const confidenceSource = tomorrowDecorationAligned && tomorrowDecision.confidence && typeof tomorrowDecision.confidence === "object"
      ? tomorrowDecision.confidence
      : {};
    const confidenceScore = Number(confidenceSource.score);
    const confidenceCalibrated = confidenceSource.calibrated === true || tomorrowDecision.calibrated === true;
    const sourceConfidenceLabel = String(confidenceSource.label || confidenceSource.level || "").trim();
    const forecastSource = tomorrowDecorationAligned && tomorrowDecision.forecast && typeof tomorrowDecision.forecast === "object"
      ? tomorrowDecision.forecast
      : {};
    const forecastQuality = forecastSource.dataQuality && typeof forecastSource.dataQuality === "object"
      ? forecastSource.dataQuality
      : {};
    const forecastCoveragePct = Number(forecastQuality.coveragePct);
    const knownEvidenceCount = Number(forecastQuality.knownEvidenceCount);
    const totalEvidenceCount = Number(forecastQuality.totalEvidenceCount);
    const normalizeRuleOutlook = (raw, valueField = "weight") => {
      const sourceOutlook = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      const quality = sourceOutlook.dataQuality && typeof sourceOutlook.dataQuality === "object"
        ? sourceOutlook.dataQuality
        : {};
      const scenarioRows = Array.isArray(sourceOutlook.scenarios) ? sourceOutlook.scenarios : [];
      const normalizedScenarios = scenarioRows.map((scenario) => {
        const value = Number(scenario && scenario[valueField]);
        return {
          key: String(scenario && scenario.key || ""),
          label: String(scenario && scenario.label || "情景"),
          value: Number.isFinite(value) && value >= 0 && value <= 100 ? value : null,
        };
      }).filter((scenario) => scenario.key);
      const primarySource = sourceOutlook.primary && typeof sourceOutlook.primary === "object"
        ? sourceOutlook.primary
        : {};
      const primaryKey = String(primarySource.key || "");
      return {
        available: sourceOutlook.available === true && normalizedScenarios.length > 0,
        calibrated: sourceOutlook.calibrated === true,
        probabilitySemantics: sourceOutlook.probabilitySemantics === true,
        methodLabel: String(sourceOutlook.methodLabel || "规则权重（未历史校准）"),
        primaryKey,
        primary: normalizedScenarios.find((scenario) => scenario.key === primaryKey) || null,
        scenarios: normalizedScenarios,
        coveragePct: Number.isFinite(Number(quality.coveragePct)) ? Number(quality.coveragePct) : null,
        missingFields: Array.isArray(quality.missingFields) ? quality.missingFields.map(String).filter(Boolean) : [],
        note: String(quality.note || ""),
        notes: Array.isArray(quality.notes) ? quality.notes.map(String).filter(Boolean) : [],
        riskContext: sourceOutlook.riskContext && typeof sourceOutlook.riskContext === "object"
          ? { ...sourceOutlook.riskContext }
          : null,
      };
    };
    const indexOutlook = forecastSource.indexOutlook && typeof forecastSource.indexOutlook === "object"
      ? normalizeRuleOutlook(forecastSource.indexOutlook, "weight")
      : null;
    const profitEffectOutlook = forecastSource.profitEffectOutlook && typeof forecastSource.profitEffectOutlook === "object"
      ? normalizeRuleOutlook(forecastSource.profitEffectOutlook, "weight")
      : null;
    const confidence = {
      score: Number.isFinite(confidenceScore) ? confidenceScore : null,
      label: confidenceCalibrated
        ? (sourceConfidenceLabel || (Number.isFinite(confidenceScore) ? `已校准证据 · ${Math.round(confidenceScore)}/100` : "已校准证据待计算"))
        : (Number.isFinite(confidenceScore) ? `规则判断置信 · ${Math.round(confidenceScore)}/100` : "规则判断置信待计算"),
      sourceLabel: sourceConfidenceLabel,
      reason: String(confidenceSource.reason || ""),
      calibrated: confidenceCalibrated,
      method: String(confidenceSource.method || tomorrowDecision.method || "rule_prior"),
      isWinRate: false,
      coveragePct: Number.isFinite(forecastCoveragePct) && forecastCoveragePct >= 0 && forecastCoveragePct <= 100
        ? Math.round(forecastCoveragePct)
        : null,
      knownEvidenceCount: Number.isFinite(knownEvidenceCount) ? knownEvidenceCount : null,
      totalEvidenceCount: Number.isFinite(totalEvidenceCount) ? totalEvidenceCount : null,
      missingFields: Array.isArray(forecastQuality.missingFields)
        ? forecastQuality.missingFields.map(String).filter(Boolean)
        : [],
    };
    const canonicalGenerationId = String(unifiedProjection.generationId || "").trim();
    const tomorrowGenerationId = String(tomorrowDecision.generationId || "").trim();
    const tomorrowGenerationAligned = Boolean(
      unifiedProjection.contractReady
      && canonicalGenerationId
      && tomorrowGenerationId === canonicalGenerationId
      && String(tomorrowDecision.tradingDate || "").trim() === unifiedProjection.tradingDate
      && String(tomorrowDecision.asOf || "").trim() === unifiedProjection.asOf,
    );
    const stateModel = tomorrowGenerationAligned && tomorrowDecision.market && typeof tomorrowDecision.market === "object"
      ? tomorrowDecision.market
      : {};
    const rawUnifiedQuantFactors = payload && payload.unifiedQuantFactors
      && typeof payload.unifiedQuantFactors === "object"
      ? payload.unifiedQuantFactors
      : null;
    const marketCapCarrierContext = stateModel.marketCapCarrier && typeof stateModel.marketCapCarrier === "object"
      ? stateModel.marketCapCarrier
      : null;
    const phaseDetail = stateModel.phaseDetail && typeof stateModel.phaseDetail === "object"
      ? stateModel.phaseDetail
      : {};
    const phaseIndexSubPhase = phaseDetail.indexSubPhase && typeof phaseDetail.indexSubPhase === "object"
      ? phaseDetail.indexSubPhase
      : stateModel.indexSubPhase && typeof stateModel.indexSubPhase === "object" ? stateModel.indexSubPhase : {};
    const phaseEmotionStage = phaseDetail.emotionStage && typeof phaseDetail.emotionStage === "object"
      ? phaseDetail.emotionStage
      : {};
    const phaseMediumStructure = phaseDetail.mediumStructure && typeof phaseDetail.mediumStructure === "object"
      ? phaseDetail.mediumStructure
      : stateModel.mediumStructure && typeof stateModel.mediumStructure === "object" ? stateModel.mediumStructure : {};
    const phaseIndexShortStructure = phaseDetail.indexShortStructure && typeof phaseDetail.indexShortStructure === "object"
      ? phaseDetail.indexShortStructure
      : {};
    const phaseIndexShortAligned = Number(phaseIndexShortStructure.windowDays) === 5
      && phaseIndexShortStructure.status !== "unavailable";
    const phaseDailyRhythm = phaseDetail.dailyRhythm && typeof phaseDetail.dailyRhythm === "object"
      ? phaseDetail.dailyRhythm
      : {};
    const phaseTomorrowBaseline = phaseDetail.tomorrowBaseline && typeof phaseDetail.tomorrowBaseline === "object"
      ? phaseDetail.tomorrowBaseline
      : tomorrowGenerationAligned && tomorrowDecision.tomorrowBaseline && typeof tomorrowDecision.tomorrowBaseline === "object"
        ? tomorrowDecision.tomorrowBaseline
        : null;
    const unifiedMarketStage = unifiedProjection.contractReady ? unifiedProjection.marketStage : null;
    const sameCanonicalGeneration = (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const nestedGenerationId = String(value.generationId || "").trim();
      if (!nestedGenerationId) return false;
      return Boolean(canonicalGenerationId && nestedGenerationId === canonicalGenerationId);
    };
    const rawDecisionContext = phaseDetail.decisionContext && typeof phaseDetail.decisionContext === "object"
      ? phaseDetail.decisionContext
      : stateModel.decisionContext && typeof stateModel.decisionContext === "object"
        ? stateModel.decisionContext
        : null;
    const decisionContext = sameCanonicalGeneration(rawDecisionContext) ? rawDecisionContext : null;
    const rawBigCycleContext = unifiedMarketStage && unifiedMarketStage.bigCycle
      && typeof unifiedMarketStage.bigCycle === "object"
      ? unifiedMarketStage.bigCycle
      : decisionContext && decisionContext.bigCycle && typeof decisionContext.bigCycle === "object"
        ? decisionContext.bigCycle
        : null;
    const canonicalBigCycleLabel = normalizeBigCycleLabelForDisplay(
      rawBigCycleContext && (rawBigCycleContext.key || rawBigCycleContext.label),
    );
    const bigCycleContext = rawBigCycleContext && canonicalBigCycleLabel
      ? { ...rawBigCycleContext, label: canonicalBigCycleLabel }
      : null;
    const transitionContext = unifiedMarketStage && unifiedMarketStage.transition
      && typeof unifiedMarketStage.transition === "object"
      ? unifiedMarketStage.transition
      : decisionContext && decisionContext.transition && typeof decisionContext.transition === "object"
        ? decisionContext.transition
        : null;
    const smallCycleContext = unifiedMarketStage && unifiedMarketStage.smallCycle
      && typeof unifiedMarketStage.smallCycle === "object"
      ? unifiedMarketStage.smallCycle
      : decisionContext && decisionContext.smallCycle && typeof decisionContext.smallCycle === "object"
        ? decisionContext.smallCycle
        : null;
    const smallCycleIndexStructure = smallCycleContext && smallCycleContext.indexStructure
      && typeof smallCycleContext.indexStructure === "object"
      ? smallCycleContext.indexStructure
      : {};
    const smallCycleIndexAligned = Number(smallCycleIndexStructure.windowDays) === 5;
    const emotionStageContext = unifiedMarketStage && unifiedMarketStage.emotionStage
      && typeof unifiedMarketStage.emotionStage === "object"
      ? unifiedMarketStage.emotionStage
      : decisionContext && decisionContext.emotionStage && typeof decisionContext.emotionStage === "object"
        ? decisionContext.emotionStage
        : null;
    const speculationPreferenceContext = decisionContext
      && decisionContext.speculationPreference
      && typeof decisionContext.speculationPreference === "object"
      ? decisionContext.speculationPreference
      : null;
    const preferenceContextFallbackReason = speculationPreferenceContext
      ? ""
      : rawDecisionContext && !decisionContext
        ? "炒作偏好数据与本次明日决策不是同一代，旧结果已拒绝沿用"
        : decisionContext
          ? "本次同代决策上下文未生成炒作偏好结果"
          : "本次明日决策没有生成同代炒作偏好观察数据";
    const rawEmotionCoreEvidence = tomorrowGenerationAligned && tomorrowDecision.emotionCoreEvidence && typeof tomorrowDecision.emotionCoreEvidence === "object"
      ? tomorrowDecision.emotionCoreEvidence
      : null;
    const projectEmotionCoreEvidenceRow = (row) => {
      const theme = row && row.theme && typeof row.theme === "object" ? row.theme : {};
      const dataQuality = row && row.dataQuality && typeof row.dataQuality === "object"
        ? row.dataQuality
        : {};
      const evidenceLabelMap = {
        cycle_identity_established: "题材周期身份已建立",
        active_primary: "是否为题材唯一主核心",
        cycle_identity_state: "周期身份状态",
        confirmed_trading_dates: "跨日确认交易日",
        valid_impact_days: "有效影响天数",
        current_state: "当日状态",
        support_score: "承接分",
        damage_score: "伤害分",
        core_lifecycle_evidence: "核心生命周期证据",
        closing_session_completed: "收盘会话已完成",
        height_risk_only: "仅作高度风险观察",
      };
      const stringifyEvidenceValue = (value, key = "") => {
        if (Array.isArray(value)) return value.map(String).filter(Boolean).join("、");
        if (key === "active_primary" && typeof value === "boolean") return value ? "是" : "否";
        if (value === true) return "已确认";
        if (value === false) return "未确认";
        if (value === null || value === undefined) return "";
        if (typeof value === "object") return String(value.detail || value.label || value.text || "").trim();
        return String(value).trim();
      };
      const evidenceNumberOrNull = (...values) => {
        for (const value of values) {
          const number = Number(value);
          if (value !== null && value !== undefined && value !== "" && Number.isFinite(number)) return number;
        }
        return null;
      };
      const evidence = safeList(row && row.evidence).map((item) => {
        if (typeof item === "string") return item.trim();
        if (!item || typeof item !== "object") return "";
        const direct = String(item.detail || item.label || item.text || "").trim();
        if (direct) return direct;
        const key = String(item.key || "").trim();
        const value = stringifyEvidenceValue(item.value, key);
        const label = evidenceLabelMap[key] || key;
        return label && value ? `${label}：${value}` : label || value;
      }).filter(Boolean);
      const fineThemeName = String(theme.fineThemeName || theme.fine || "").trim();
      const parentThemeName = String(theme.parentThemeName || theme.parent || theme.label || "").trim();
      return {
        code: String(row && row.code || "").trim(),
        name: String(row && (row.name || row.code) || "").trim(),
        rank: String(row && (row.rank || row.identity && row.identity.rank) || "").trim(),
        currentState: String(row && (row.currentState || row.state || row.session && row.session.state) || "unknown").trim(),
        theme: {
          fineThemeName,
          parentThemeName,
          label: fineThemeName && parentThemeName && fineThemeName !== parentThemeName
            ? `${fineThemeName}（${parentThemeName}）`
            : fineThemeName || parentThemeName || "题材待确认",
        },
        supportScore: evidenceNumberOrNull(row && row.supportScore, row && row.session && row.session.supportScore),
        damageScore: evidenceNumberOrNull(row && row.damageScore, row && row.session && row.session.damageScore),
        positiveInfluenceScore: evidenceNumberOrNull(row && row.positiveInfluenceScore),
        negativeInfluenceScore: evidenceNumberOrNull(row && row.negativeInfluenceScore),
        signedInfluenceScore: evidenceNumberOrNull(row && row.signedInfluenceScore),
        riskPressureScore: evidenceNumberOrNull(row && row.riskPressureScore),
        riskPressureConfirmed: row && row.riskPressureConfirmed === true,
        negativeFeedbackAmplified: row && row.negativeFeedbackAmplified === true,
        voteRole: String(row && row.voteRole || "").trim(),
        selectionAuthority: row && row.selectionAuthority === true,
        executionAuthority: row && row.executionAuthority === true,
        votingWeight: evidenceNumberOrNull(row && row.votingWeight),
        evidence,
        source: String(row && (row.source || row.session && row.session.source || row.identity && row.identity.source) || "unknown").trim(),
        identitySource: String(row && (row.identitySource || row.identity && row.identity.source) || "").trim(),
        sessionSource: String(row && (row.sessionSource || row.session && row.session.source) || "").trim(),
        contractAsOf: String(row && (row.contractAsOf || row.asOf) || "").trim(),
        identitySourceAsOf: String(row && (row.identitySourceAsOf || row.identity && row.identity.asOf) || "").trim(),
        sessionSourceAsOf: String(row && (row.sessionSourceAsOf || row.session && row.session.asOf) || "").trim(),
        asOf: String(row && (row.contractAsOf || row.asOf) || "").trim(),
        dataQuality: String(typeof (row && row.dataQuality) === "string"
          ? row.dataQuality
          : dataQuality.grade || dataQuality.source || "待确认").trim(),
      };
    };
    const buildEmotionCoreEvidenceProjection = () => {
      if (!rawEmotionCoreEvidence) {
        return {
          status: "missing",
          reason: "新契约尚未生成",
          emotionStagePath: null,
          strictEmotionCores: [],
          heightRiskBarometers: [],
          themeCycles: [],
          transition: { status: "unavailable", label: "跨日阶段待同版本T-1收盘证据" },
          summary: { strictCoreCount: 0, divergent: { count: 0, names: [] }, supported: { count: 0, names: [] }, repairFailed: { count: 0, names: [] }, participating: { count: 0, names: [] }, riskBarometerCount: 0 },
        };
      }
      const evidenceGeneration = rawEmotionCoreEvidence.generation && typeof rawEmotionCoreEvidence.generation === "object"
        ? rawEmotionCoreEvidence.generation
        : {};
      const evidenceGenerationId = String(rawEmotionCoreEvidence.generationId || evidenceGeneration.generationId || evidenceGeneration.id || "").trim();
      const evidenceTradingDate = String(rawEmotionCoreEvidence.tradingDate || evidenceGeneration.tradingDate || "").trim();
      const evidenceAsOf = String(rawEmotionCoreEvidence.asOf || evidenceGeneration.asOf || "").trim();
      const canonicalTradingDate = String(tomorrowDecision.tradingDate || "").trim();
      const canonicalAsOf = String(tomorrowDecision.asOf || "").trim();
      const topGenerationId = String(rawEmotionCoreEvidence.generationId || "").trim();
      const topTradingDate = String(rawEmotionCoreEvidence.tradingDate || "").trim();
      const topAsOf = String(rawEmotionCoreEvidence.asOf || "").trim();
      const nestedGenerationId = String(evidenceGeneration.generationId || evidenceGeneration.id || "").trim();
      const nestedTradingDate = String(evidenceGeneration.tradingDate || "").trim();
      const nestedAsOf = String(evidenceGeneration.asOf || "").trim();
      const exactLineage = Boolean(
        canonicalGenerationId
        && canonicalTradingDate
        && canonicalAsOf
        && evidenceGenerationId === canonicalGenerationId
        && evidenceTradingDate === canonicalTradingDate
        && evidenceAsOf === canonicalAsOf
        && topGenerationId === canonicalGenerationId
        && topTradingDate === canonicalTradingDate
        && topAsOf === canonicalAsOf
        && nestedGenerationId === canonicalGenerationId
        && nestedTradingDate === canonicalTradingDate
        && nestedAsOf === canonicalAsOf
      );
      const integrity = rawEmotionCoreEvidence.integrity && typeof rawEmotionCoreEvidence.integrity === "object"
        ? rawEmotionCoreEvidence.integrity
        : {};
      const requiredIntegrityKeys = [
        "poolsDisjoint",
        "namedRowsBackSummary",
        "sameGeneration",
        "strictRowsQualifiedOnly",
        "riskRowsCannotVote",
        "strictCoreBasketMaxFive",
        "scoreSummaryDerivedFromRows",
      ];
      const integrityAllGreen = requiredIntegrityKeys.every((key) => integrity[key] === true)
        && Object.values(integrity).filter((value) => typeof value === "boolean").every((value) => value === true);
      const evidenceContractVersion = Number(rawEmotionCoreEvidence.contractVersion == null
        ? rawEmotionCoreEvidence.version
        : rawEmotionCoreEvidence.contractVersion);
      const supportedContractVersion = evidenceContractVersion === 2;
      const rawStrictRows = safeList(rawEmotionCoreEvidence.strictEmotionCores);
      const rawRiskRows = safeList(rawEmotionCoreEvidence.heightRiskBarometers);
      const rawThemeCycles = safeList(rawEmotionCoreEvidence.themeCycles);
      const rawStrictCodes = rawStrictRows.map((row) => String(row && row.code || "").trim());
      const rawRiskCodes = rawRiskRows.map((row) => String(row && row.code || "").trim());
      const rowStructureValid = rawStrictRows.length <= 5
        && rawStrictRows.every((row) => String(row && row.code || "").trim()
          && String(row && row.name || "").trim()
          && Number.isFinite(Number(row.positiveInfluenceScore))
          && Number.isFinite(Number(row.negativeInfluenceScore))
          && Number.isFinite(Number(row.signedInfluenceScore))
          && Math.abs(Number(row.signedInfluenceScore)
            - (Number(row.positiveInfluenceScore) - Number(row.negativeInfluenceScore))) < 0.001
          && String(row.voteRole || "").trim()
          && row.selectionAuthority === false
          && row.executionAuthority === false)
        && rawRiskRows.every((row) => String(row && row.code || "").trim()
          && String(row && row.name || "").trim()
          && row.votingWeight !== null
          && row.votingWeight !== undefined
          && Number(row.votingWeight) === 0
          && Number(row.positiveInfluenceScore) === 0
          && Number(row.negativeInfluenceScore) === 0
          && Number(row.signedInfluenceScore) === 0
          && String(row.voteRole || "") === "height_context"
          && row.executionAuthority === false)
        && new Set(rawStrictCodes).size === rawStrictCodes.length
        && new Set(rawRiskCodes).size === rawRiskCodes.length
        && rawRiskCodes.every((code) => !rawStrictCodes.includes(code));
      const rowLineageMatches = (row) => Boolean(
        row
        && typeof row === "object"
        && !Array.isArray(row)
        && String(row.generationId || "").trim() === evidenceGenerationId
        && String(row.tradingDate || "").trim() === evidenceTradingDate
        && String(row.asOf || "").trim() === evidenceAsOf
        && Number(row.contractVersion) === 2
      );
      const nestedThemeLineageValid = rawThemeCycles.every((group) => {
        if (!group || typeof group !== "object" || Array.isArray(group)) return false;
        const nestedRows = [
          ...safeList(group.strictEmotionCores),
          ...safeList(group.heightRiskBarometers),
          ...safeList(group.coreCandidates),
        ];
        return rowLineageMatches(group.theme)
          && rowLineageMatches(group.cycle)
          && nestedRows.every(rowLineageMatches);
      });
      const rowLineageValid = rawStrictRows.every(rowLineageMatches)
        && rawRiskRows.every(rowLineageMatches)
        && nestedThemeLineageValid;
      const nestedStrictRowsForStage = rawThemeCycles.flatMap((group) => safeList(group && group.strictEmotionCores));
      const strictRowEligibleForStage = (row) => {
        const classification = row && row.classification && typeof row.classification === "object"
          ? row.classification
          : {};
        const qualification = row && row.qualification && typeof row.qualification === "object"
          ? row.qualification
          : {};
        const identity = row && row.identity && typeof row.identity === "object" ? row.identity : {};
        const stateEvidence = safeList(row && row.evidence).find((entry) => (
          entry && typeof entry === "object" && String(entry.key || "") === "current_state"
        ));
        const states = [
          row && row.currentState,
          row && row.state,
          row && row.session && row.session.state,
          stateEvidence && stateEvidence.value,
        ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
        return rowLineageMatches(row)
          && classification.strictEmotionCore === true
          && classification.heightRiskBarometer === false
          && Number(row.votingWeight) === 1
          && Number.isFinite(Number(row.positiveInfluenceScore))
          && Number.isFinite(Number(row.negativeInfluenceScore))
          && Number.isFinite(Number(row.signedInfluenceScore))
          && String(row.voteRole || "").trim()
          && row.executionAuthority === false
          && qualification.passed === true
          && String(qualification.authority || "") === "theme_cycle_leadership"
          && String(qualification.version || "") === "strict-core-qualification-v2"
          && String(identity.authority || "") === "theme_cycle_leadership"
          && states.length > 0
          && new Set(states).size === 1;
      };
      const nestedStrictCodesForStage = nestedStrictRowsForStage.map((row) => String(row && row.code || "").trim());
      const strictCodeSetsMatchForStage = rawStrictCodes.length === nestedStrictCodesForStage.length
        && new Set(rawStrictCodes).size === rawStrictCodes.length
        && new Set(nestedStrictCodesForStage).size === nestedStrictCodesForStage.length
        && rawStrictCodes.every((code) => nestedStrictCodesForStage.includes(code));
      const strictRowsValidForStage = rawStrictRows.length > 0
        && strictCodeSetsMatchForStage
        && rawStrictRows.every(strictRowEligibleForStage)
        && nestedStrictRowsForStage.every(strictRowEligibleForStage);
      const strictPhaseCounts = {
        negative_feedback: 0,
        divergence: 0,
        support_repair: 0,
        participating: 0,
        unknown: 0,
      };
      rawStrictRows.forEach((row) => {
        const state = String(row && (row.currentState || row.state || row.session && row.session.state) || "").toLowerCase();
        if (/repair_failed|negative_feedback|修复失败|负反馈/.test(state)) strictPhaseCounts.negative_feedback += 1;
        else if (/support|承接|local_repair|divergence_supported|局部修复/.test(state)) strictPhaseCounts.support_repair += 1;
        else if (/diverg|分歧/.test(state)) strictPhaseCounts.divergence += 1;
        else if (/participat|normal|active|正常参与/.test(state)) strictPhaseCounts.participating += 1;
        else strictPhaseCounts.unknown += 1;
      });
      const backendCurrentPathNode = rawEmotionCoreEvidence.emotionStagePath
        && rawEmotionCoreEvidence.emotionStagePath.nodes
        && rawEmotionCoreEvidence.emotionStagePath.nodes.current
        && typeof rawEmotionCoreEvidence.emotionStagePath.nodes.current === "object"
        ? rawEmotionCoreEvidence.emotionStagePath.nodes.current : {};
      const strictPhaseWinner = String(backendCurrentPathNode.status || "") === "ready"
        && String(backendCurrentPathNode.key || "").trim()
        && String(backendCurrentPathNode.stageLabel || backendCurrentPathNode.label || "").trim()
        ? [
            String(backendCurrentPathNode.key).trim(),
            String(backendCurrentPathNode.stageLabel || backendCurrentPathNode.label).trim(),
          ]
        : null;
      const strictStageValidation = {
        rowsValid: strictRowsValidForStage,
        strictCoreCount: rawStrictRows.length,
        phaseKey: strictPhaseWinner ? strictPhaseWinner[0] : null,
        phaseLabel: strictPhaseWinner ? strictPhaseWinner[1] : null,
        weightedByBackendInfluence: true,
      };
      const rawSummary = rawEmotionCoreEvidence.summary && typeof rawEmotionCoreEvidence.summary === "object"
        ? rawEmotionCoreEvidence.summary : {};
      const rawInfluence = rawSummary.influence && typeof rawSummary.influence === "object"
        ? rawSummary.influence : {};
      const expectedPositiveTotal = Math.round(rawStrictRows.reduce((sum, row) => sum + Number(row.positiveInfluenceScore || 0), 0) * 10) / 10;
      const expectedNegativeTotal = Math.round(rawStrictRows.reduce((sum, row) => sum + Number(row.negativeInfluenceScore || 0), 0) * 10) / 10;
      const expectedSignedTotal = Math.round((expectedPositiveTotal - expectedNegativeTotal) * 10) / 10;
      const influenceSummaryValid = Number(rawInfluence.positiveTotal) === expectedPositiveTotal
        && Number(rawInfluence.negativeTotal) === expectedNegativeTotal
        && Number(rawInfluence.signedTotal) === expectedSignedTotal
        && Number(rawSummary.selectedCoreCount) === rawStrictRows.length
        && Number(rawSummary.strictCandidateCount) >= rawStrictRows.length;
      const ready = rawEmotionCoreEvidence.status === "ready"
        && exactLineage
        && integrityAllGreen
        && supportedContractVersion
        && rowStructureValid
        && rowLineageValid
        && influenceSummaryValid
        && !(rawEmotionCoreEvidence.dataQuality && rawEmotionCoreEvidence.dataQuality.failClosed === true)
        && !(rawEmotionCoreEvidence.dataQuality && rawEmotionCoreEvidence.dataQuality.usable === false);
      if (!ready) {
        const reason = !exactLineage
          ? "同代校验未通过"
          : !supportedContractVersion ? "契约版本不受支持"
            : !integrityAllGreen ? "完整性校验未通过"
              : !rowStructureValid ? "分池结构校验未通过"
                : !rowLineageValid ? "逐行代际校验未通过"
                  : !influenceSummaryValid ? "正负影响汇总校验未通过" : "后端证据尚未达到可用状态";
        return {
          status: "unavailable",
          reason,
          emotionStagePath: null,
          strictEmotionCores: [],
          heightRiskBarometers: [],
          themeCycles: [],
          transition: { status: "unavailable", label: "跨日阶段待同版本T-1收盘证据" },
          summary: { strictCoreCount: 0, divergent: { count: 0, names: [] }, supported: { count: 0, names: [] }, repairFailed: { count: 0, names: [] }, participating: { count: 0, names: [] }, riskBarometerCount: 0 },
        };
      }
      const strictEmotionCores = rawStrictRows
        .map(projectEmotionCoreEvidenceRow)
        .filter((row) => row.code && row.name);
      const strictCodes = new Set(strictEmotionCores.map((row) => row.code));
      const heightRiskBarometers = rawRiskRows
        .map(projectEmotionCoreEvidenceRow)
        .filter((row) => row.code && row.name && !strictCodes.has(row.code) && row.votingWeight === 0);
      const stateBucket = (row) => {
        const state = String(row && row.currentState || "").toLowerCase();
        if (/repair_failed|negative_feedback|修复失败|负反馈/.test(state)) return "repairFailed";
        if (/support|承接|local_repair|divergence_supported/.test(state)) return "supported";
        if (/diverg|分歧/.test(state)) return "divergent";
        if (/participat|normal_participation|正常参与/.test(state)) return "participating";
        return "other";
      };
      const divergentRows = strictEmotionCores.filter((row) => stateBucket(row) === "divergent");
      const supportedRows = strictEmotionCores.filter((row) => stateBucket(row) === "supported");
      const repairFailedRows = strictEmotionCores.filter((row) => stateBucket(row) === "repairFailed");
      const participatingRows = strictEmotionCores.filter((row) => stateBucket(row) === "participating");
      const themeCycles = rawThemeCycles.map((group) => {
        const theme = group && group.theme && typeof group.theme === "object" ? group.theme : {};
        const cycle = group && group.cycle && typeof group.cycle === "object" ? group.cycle : {};
        const fineThemeName = String(theme.fineThemeName || theme.fine || "").trim();
        const parentThemeName = String(theme.parentThemeName || theme.parent || theme.label || "").trim();
        const groupStrictRows = safeList(group && group.strictEmotionCores);
        const groupCandidateRows = safeList(group && group.coreCandidates);
        const groupRiskRows = safeList(group && group.heightRiskBarometers);
        const relatedOnly = theme.relatedOnly === true
          || String(theme.attributionStatus || "") === "risk_relation_only"
          || String(theme.authority || "") === "risk_relation_only"
          || String(theme.key || "").startsWith("risk-related:")
          || String(cycle.state || cycle.key || "") === "risk_observation_only";
        const rawCycleState = String(cycle.state || "").trim();
        const rawCycleLabel = String(cycle.label || cycle.state || cycle.key || "").trim();
        const cycleStateLabels = {
          confirmed: "周期已确认",
          retained: "核心延续",
          challenged: "核心受挑战",
          candidate: "周期候选",
          unknown: "周期待确认",
          active: "周期进行中",
          rising: "题材上升期",
        };
        const readableCycleState = cycleStateLabels[rawCycleState.toLowerCase()] || "";
        const cycleLabel = readableCycleState && rawCycleLabel.includes(rawCycleState)
          ? rawCycleLabel.replace(rawCycleState, readableCycleState)
          : cycleStateLabels[rawCycleLabel.toLowerCase()] || rawCycleLabel || "周期状态待确认";
        return {
          relatedOnly,
          empty: groupStrictRows.length + groupCandidateRows.length + groupRiskRows.length === 0,
          fineThemeName: fineThemeName || "细分题材待核实",
          parentThemeName,
          label: fineThemeName
            ? (parentThemeName && fineThemeName !== parentThemeName ? `${fineThemeName}（${parentThemeName}）` : fineThemeName)
            : `细分题材待核实${parentThemeName ? `（${parentThemeName}）` : ""}`,
          cycleLabel,
          strictCoreNames: groupStrictRows.map((row) => String(row && (row.name || row.code) || "").trim()).filter(Boolean),
        };
      }).filter((group) => !group.relatedOnly && !group.empty);
      const rawTransition = rawEmotionCoreEvidence.transition && typeof rawEmotionCoreEvidence.transition === "object"
        ? rawEmotionCoreEvidence.transition
        : {};
      const previousTransition = rawTransition.previous && typeof rawTransition.previous === "object" ? rawTransition.previous : {};
      const currentTransition = rawTransition.current && typeof rawTransition.current === "object" ? rawTransition.current : {};
      const transitionLabel = (value) => String(value && (
        value.label
        || value.stageLabel
        || value.phaseLabel
        || value.stage && value.stage.label
      ) || "").trim();
      const previousTransitionLabel = transitionLabel(previousTransition);
      const currentTransitionLabel = transitionLabel(currentTransition);
      const expectedPreviousTradingDate = String(rawTransition.expectedPreviousTradingDate || "").trim();
      const previousTransitionDate = String(previousTransition.tradingDate || "").trim();
      const currentTransitionDate = String(currentTransition.tradingDate || "").trim();
      const previousClosingVerified = previousTransition.snapshotKind === "closing" && previousTransition.completed === true;
      const currentClosingVerified = currentTransition.snapshotKind === "closing" && currentTransition.completed === true;
      const transitionContractVersionValid = Number(previousTransition.contractVersion) === 2
        && Number(currentTransition.contractVersion) === 2;
      const explicitSameVersion = rawTransition.sameVersion === true
        || rawTransition.integrity && rawTransition.integrity.sameVersion === true
        || rawTransition.integrity && rawTransition.integrity.sameContractVersion === true;
      const transition = rawTransition.status === "ready"
        && explicitSameVersion
        && transitionContractVersionValid
        && previousTransitionLabel
        && currentTransitionLabel
        && expectedPreviousTradingDate
        && previousTransitionDate === expectedPreviousTradingDate
        && currentTransitionDate === evidenceTradingDate
        && previousClosingVerified
        && currentClosingVerified
        ? { status: "ready", previousLabel: previousTransitionLabel, currentLabel: currentTransitionLabel, label: `昨日${previousTransitionLabel} → 今日${currentTransitionLabel}` }
        : { status: "unavailable", label: "跨日阶段待同版本T-1收盘证据" };
      return {
        status: "ready",
        generationId: evidenceGenerationId,
        tradingDate: evidenceTradingDate,
        asOf: evidenceAsOf,
        previousEvidenceRecovery: rawEmotionCoreEvidence.previousEvidenceRecovery
          && typeof rawEmotionCoreEvidence.previousEvidenceRecovery === "object"
          ? { ...rawEmotionCoreEvidence.previousEvidenceRecovery }
          : null,
        emotionStagePath: rawEmotionCoreEvidence.emotionStagePath && typeof rawEmotionCoreEvidence.emotionStagePath === "object"
          ? rawEmotionCoreEvidence.emotionStagePath
          : null,
        strictStageValidation,
        strictEmotionCores,
        heightRiskBarometers,
        themeCycles,
        transition,
        summary: {
          strictCoreCount: strictEmotionCores.length,
          strictCandidateCount: Number(rawSummary.strictCandidateCount) || strictEmotionCores.length,
          selectedCoreCount: strictEmotionCores.length,
          excludedByLimitCount: Math.max(0, Number(rawSummary.excludedByLimitCount) || 0),
          influence: {
            positiveTotal: Number(rawInfluence.positiveTotal),
            negativeTotal: Number(rawInfluence.negativeTotal),
            signedTotal: Number(rawInfluence.signedTotal),
            positiveCount: Number(rawInfluence.positiveCount),
            negativeCount: Number(rawInfluence.negativeCount),
            neutralCount: Number(rawInfluence.neutralCount),
            winner: String(rawInfluence.winner || "mixed"),
            calibrated: false,
          },
          divergent: { count: divergentRows.length, codes: divergentRows.map((row) => row.code), names: divergentRows.map((row) => row.name) },
          supported: { count: supportedRows.length, codes: supportedRows.map((row) => row.code), names: supportedRows.map((row) => row.name) },
          repairFailed: { count: repairFailedRows.length, codes: repairFailedRows.map((row) => row.code), names: repairFailedRows.map((row) => row.name) },
          participating: { count: participatingRows.length, codes: participatingRows.map((row) => row.code), names: participatingRows.map((row) => row.name) },
          riskBarometerCount: heightRiskBarometers.length,
        },
      };
    };
    const emotionCoreEvidence = buildEmotionCoreEvidenceProjection();
    const coreEmotionSource = sameCanonicalGeneration(tomorrowDecision.coreEmotion)
      ? tomorrowDecision.coreEmotion
      : {};
    const emotionCycleSource = coreEmotionSource.emotionCycle && typeof coreEmotionSource.emotionCycle === "object"
      ? coreEmotionSource.emotionCycle
      : {};
    const rawStrictTransition = rawEmotionCoreEvidence
      && rawEmotionCoreEvidence.transition
      && typeof rawEmotionCoreEvidence.transition === "object"
      ? rawEmotionCoreEvidence.transition
      : {};
    const authoritativeStagePath = emotionCoreEvidence && emotionCoreEvidence.status === "ready"
      && emotionCoreEvidence.emotionStagePath && typeof emotionCoreEvidence.emotionStagePath === "object"
      ? emotionCoreEvidence.emotionStagePath
      : null;
    const authoritativePathNodes = authoritativeStagePath
      && authoritativeStagePath.nodes && typeof authoritativeStagePath.nodes === "object"
      ? authoritativeStagePath.nodes
      : {};
    const authoritativePreviousNode = authoritativePathNodes.previous
      && typeof authoritativePathNodes.previous === "object"
      ? authoritativePathNodes.previous
      : {};
    const authoritativeCurrentNode = authoritativePathNodes.current
      && typeof authoritativePathNodes.current === "object"
      ? authoritativePathNodes.current
      : {};
    const previousEvidenceRecovery = emotionCoreEvidence
      && emotionCoreEvidence.previousEvidenceRecovery
      && typeof emotionCoreEvidence.previousEvidenceRecovery === "object"
      ? emotionCoreEvidence.previousEvidenceRecovery
      : {};
    const expectedPreviousTradingDate = String(
      rawStrictTransition.expectedPreviousTradingDate
      || previousEvidenceRecovery.tradingDate
      || authoritativePreviousNode.tradingDate
      || "",
    ).trim();
    const nodeStrictCoreCount = (node) => {
      const evidence = node && node.evidence && typeof node.evidence === "object" ? node.evidence : {};
      const number = Number(evidence.strictCoreCount);
      return evidence.strictCoreCount !== null && evidence.strictCoreCount !== undefined && Number.isFinite(number)
        ? number
        : null;
    };
    const previousStrictCoreCount = nodeStrictCoreCount(authoritativePreviousNode);
    const currentStrictCoreCount = nodeStrictCoreCount(authoritativeCurrentNode);
    const previousRecoveryStatus = String(previousEvidenceRecovery.status || "").trim();
    const previousContractRecovered = Boolean(
      ["stored", "replayed_fail_closed"].includes(previousRecoveryStatus)
      && expectedPreviousTradingDate
      && String(previousEvidenceRecovery.tradingDate || authoritativePreviousNode.tradingDate || "").trim() === expectedPreviousTradingDate
      && String(authoritativePreviousNode.snapshotKind || "").toLowerCase() === "closing"
      && String(authoritativePreviousNode.status || "").toLowerCase() !== "unavailable",
    );
    const emotionUnavailableReasons = (() => {
      const reasonRows = [];
      const addReasonRows = (value) => {
        if (Array.isArray(value)) value.forEach(addReasonRows);
        else if (value !== null && value !== undefined && String(value).trim()) reasonRows.push(String(value).trim());
      };
      const cyclePrevious = emotionCycleSource.previous && typeof emotionCycleSource.previous === "object"
        ? emotionCycleSource.previous
        : {};
      const cycleQuality = emotionCycleSource.dataQuality && typeof emotionCycleSource.dataQuality === "object"
        ? emotionCycleSource.dataQuality
        : {};
      const rawEvidenceQuality = rawEmotionCoreEvidence && rawEmotionCoreEvidence.dataQuality && typeof rawEmotionCoreEvidence.dataQuality === "object"
        ? rawEmotionCoreEvidence.dataQuality
        : {};
      const rawStagePath = authoritativeStagePath || {};
      const rawStageQuality = rawStagePath.dataQuality && typeof rawStagePath.dataQuality === "object"
        ? rawStagePath.dataQuality
        : {};
      if (!authoritativeStagePath) {
        addReasonRows(phaseEmotionStage.reason);
        addReasonRows(emotionCycleSource.current && emotionCycleSource.current.reason);
        addReasonRows(cyclePrevious.source);
        addReasonRows(cyclePrevious.reason);
        addReasonRows(cycleQuality.reasonCodes);
        addReasonRows(cycleQuality.notes);
      }
      addReasonRows(rawEvidenceQuality.reasonCodes);
      addReasonRows(rawEvidenceQuality.reason);
      if (!authoritativeStagePath) {
        addReasonRows(rawEmotionCoreEvidence && rawEmotionCoreEvidence.transition && rawEmotionCoreEvidence.transition.reason);
      }
      addReasonRows(rawStageQuality.reasonCodes);
      addReasonRows(rawStagePath.gaps);
      const token = reasonRows.join(" ").toLowerCase();
      const labels = [];
      if (!previousContractRecovered
        && /quarant|ineligible|quality[_ -]?(?:isolat|reject)|质量[^；，,]*隔离|隔离[^；，,]*质量/.test(token)) {
        labels.push("T-1历史因质量门隔离");
      }
      if (!previousContractRecovered
        && /exact[_ -]?t-?1|not[_ -]?exact[_ -]?t-?1|t-?1[_ -]?(?:state|closing)[_ -]?(?:missing|unavailable)|缺少[^；，,]*t-?1|上一交易日[^；，,]*(?:缺|不可用)/i.test(token)) {
        labels.push("缺少可用的精确T-1收盘状态");
      }
      if (/previous[_ -]?evidence[_ -]?future[_ -]?dated|未来日期血缘/.test(token)) {
        labels.push("T-1严格核心证据含未来日期血缘");
      }
      if (/previous[_ -]?strict[_ -]?core[_ -]?insufficient|昨日严格核心不足/.test(token)) {
        labels.push(previousStrictCoreCount === 0
          ? "昨日严格核心资格结果为空（0只）"
          : "昨日严格核心未形成可确认阶段");
      }
      if (/generation[^；，,]*(?:mismatch|failed)|generated[_ -]?at[_ -]?mismatch|same[_ -]?generation[^；，,]*(?:failed|mismatch)|同代[^；，,]*(?:失败|不一致|未通过)/.test(token)) {
        labels.push("当前严格核心同代校验失败");
      }
      if (/current[_ -]?strict[_ -]?core[_ -]?insufficient|今日严格核心不足|当前样本尚不足/.test(token)) {
        labels.push(currentStrictCoreCount === 0
          ? "当前严格核心资格结果为空（0只）"
          : "今日严格情绪核心证据不足");
      }
      if (!labels.length) {
        const explicit = String(phaseEmotionStage.reason || emotionCycleSource.current && emotionCycleSource.current.reason || "").trim();
        if (explicit) labels.push(explicit);
      }
      return [...new Set(labels)].slice(0, 3);
    })();
    const rawStrictEvidenceSummary = rawEmotionCoreEvidence
      && rawEmotionCoreEvidence.summary
      && typeof rawEmotionCoreEvidence.summary === "object"
      ? rawEmotionCoreEvidence.summary
      : {};
    const rawStrictCoreCount = Number.isFinite(Number(rawStrictEvidenceSummary.strictCoreCount))
      ? Number(rawStrictEvidenceSummary.strictCoreCount)
      : rawEmotionCoreEvidence && Array.isArray(rawEmotionCoreEvidence.strictEmotionCores)
        ? rawEmotionCoreEvidence.strictEmotionCores.length
        : null;
    const rawRiskBarometerCount = Number.isFinite(Number(
      rawStrictEvidenceSummary.heightRiskBarometerCount ?? rawStrictEvidenceSummary.riskBarometerCount,
    ))
      ? Number(rawStrictEvidenceSummary.heightRiskBarometerCount ?? rawStrictEvidenceSummary.riskBarometerCount)
      : rawEmotionCoreEvidence && Array.isArray(rawEmotionCoreEvidence.heightRiskBarometers)
        ? rawEmotionCoreEvidence.heightRiskBarometers.length
        : null;
    const strictEvidenceGaps = (() => {
      if (authoritativeStagePath) {
        const rows = [];
        const previousStatus = String(authoritativePreviousNode.status || "unavailable").toLowerCase();
        const currentStatus = String(authoritativeCurrentNode.status || "unavailable").toLowerCase();
        const pathReasonCodes = safeList(
          authoritativeStagePath.dataQuality && authoritativeStagePath.dataQuality.reasonCodes,
        ).map(String);
        if (pathReasonCodes.includes("previous_evidence_future_dated")) {
          rows.push(`${expectedPreviousTradingDate || "上一交易日"}严格核心证据含未来日期血缘，已拒绝使用`);
        } else if (previousStatus === "unavailable" && !previousContractRecovered) {
          rows.push(`缺少${expectedPreviousTradingDate || "上一交易日"}可用的同版本严格核心收盘契约`);
        } else if (previousStatus === "insufficient") {
          rows.push(previousStrictCoreCount === 0
            ? `${expectedPreviousTradingDate || "上一交易日"}收盘契约已${previousRecoveryStatus === "replayed_fail_closed" ? "回放恢复" : "读取"}；严格核心资格结果为0只，无法确认昨日阶段`
            : `${expectedPreviousTradingDate || "上一交易日"}已有${previousStrictCoreCount ?? "若干"}只严格核心，但状态未形成可确认多数`);
        }
        if (currentStatus === "unavailable") {
          rows.push("本次严格核心证据不可用，无法确认今日阶段");
        } else if (currentStatus === "insufficient") {
          rows.push(currentStrictCoreCount === 0
            ? "当前严格核心资格结果为空（0只）：没有股票同时满足跨日周期身份、当前主核心和严格收盘资格；不是档案缺失"
            : `今日已有${currentStrictCoreCount ?? "若干"}只严格核心，但状态未知、混合或打平，尚未形成多数`);
        }
        return [...new Set(rows.filter(Boolean))];
      }
      const rows = emotionUnavailableReasons.map((reason) => {
        const value = String(reason || "").trim();
        if (/精确T-1/.test(value)) {
          return `缺少${expectedPreviousTradingDate || "上一交易日"}精确T-1严格核心收盘证据`;
        }
        if (/今日严格情绪核心证据不足/.test(value)) {
          return rawStrictCoreCount === null
            ? "今日通过身份与同代校验的严格情绪核心不足，无法形成阶段投票"
            : `今日通过身份与同代校验的严格情绪核心为${rawStrictCoreCount}只，无法形成阶段投票`;
        }
        if (/当前严格核心同代校验失败/.test(value)) {
          return "严格核心证据与本次明日决策代次不一致，旧数据已拒绝沿用";
        }
        if (/T-1历史因质量门隔离/.test(value)) {
          return "T-1严格核心历史快照未通过质量门，已隔离不用";
        }
        return value;
      }).filter(Boolean);
      return [...new Set(rows)];
    })();
    const strictEvidenceExcluded = rawRiskBarometerCount !== null && rawRiskBarometerCount > 0
      ? [`现有${rawRiskBarometerCount}只高位负反馈观察票投票权重为0；非机会、非推荐，不能替代严格情绪核心`]
      : [];
    const anchorLayers = emotionCycleSource.anchorLayers && typeof emotionCycleSource.anchorLayers === "object"
      ? emotionCycleSource.anchorLayers
      : {};
    const sourceAnchors = [
      ...safeList(anchorLayers.A).map((item) => ({ ...item, projectionLayer: "A" })),
      ...safeList(anchorLayers.B).map((item) => ({ ...item, projectionLayer: "B" })),
    ];
    if (!sourceAnchors.length) {
      safeList(coreEmotionSource.items).forEach((item) => sourceAnchors.push({ ...item, projectionLayer: item.layer || "A" }));
    }
    const anchorSeen = new Set();
    const canonicalAnchors = sourceAnchors.filter((item) => {
      const key = String(item && (item.code || item.name) || "").trim();
      if (!key || anchorSeen.has(key)) return false;
      anchorSeen.add(key);
      return true;
    });
    const numberOrNull = (...values) => {
      for (const value of values) {
        const number = Number(value);
        if (value !== null && value !== undefined && value !== "" && Number.isFinite(number)) return number;
      }
      return null;
    };
    const eventProjection = (item) => {
      const priceDiscovery = item && item.priceDiscovery && typeof item.priceDiscovery === "object"
        ? item.priceDiscovery
        : {};
      const support = item && item.support && typeof item.support === "object" ? item.support : {};
      const supportBreakdown = support.breakdown && typeof support.breakdown === "object" ? support.breakdown : {};
      const turnoverReseal = supportBreakdown.turnoverReseal && typeof supportBreakdown.turnoverReseal === "object"
        ? supportBreakdown.turnoverReseal
        : {};
      const damage = item && item.damage && typeof item.damage === "object" ? item.damage : {};
      const eventConfirmation = item && item.eventConfirmation && typeof item.eventConfirmation === "object"
        ? item.eventConfirmation
        : item && item.confirmedEvent && typeof item.confirmedEvent === "object" ? item.confirmedEvent : {};
      const participation = item && item.participation && typeof item.participation === "object"
        ? item.participation
        : {};
      const participationFacts = participation.facts && typeof participation.facts === "object"
        ? participation.facts
        : {};
      const priceSession = priceDiscovery.session && typeof priceDiscovery.session === "object"
        ? priceDiscovery.session
        : {};
      const closingStrength = supportBreakdown.closingStrength && typeof supportBreakdown.closingStrength === "object"
        ? supportBreakdown.closingStrength
        : {};
      const recovery = supportBreakdown.recovery && typeof supportBreakdown.recovery === "object"
        ? supportBreakdown.recovery
        : {};
      const closingPathProxy = String(priceDiscovery.sessionGranularity || "") === "closing_path_proxy"
        || String(priceDiscovery.source || "") === "trusted_current_closing_path_proxy";
      const oneWord = Boolean(item && item.current && item.current.oneWord === true)
        || String(priceDiscovery.type || "") === "one_word";
      const verifiedSource = /^(?:verified_intraday|cross_day_intraday|verified_completed)/.test(String(item && item.source || ""));
      const tradable = !oneWord && (
        priceDiscovery.trusted === true
        && !["unknown", "one_word"].includes(String(priceDiscovery.type || ""))
        || verifiedSource
      );
      const role = String(item && (item.anchorRole || item.role || "") || "").toLowerCase();
      const roleLabel = String(item && (item.anchorRoleLabel || item.identity || "") || "");
      const stage = String(item && (item.stage || item.stageKey || "") || "").toLowerCase();
      const exactEventConfirmed = eventConfirmation.confirmed === true
        && !closingPathProxy
        && priceDiscovery.eventEvidenceEligible !== false;
      const lowPct = numberOrNull(
        eventConfirmation.lowPct,
        eventConfirmation.intradayLowPct,
        eventConfirmation.lowFromPreviousPct,
      );
      const closingPathChangePct = numberOrNull(priceSession.currentChangePct, closingStrength.changePct);
      const closingPathRecoveryPct = numberOrNull(participationFacts.recoveryPct, recovery.valuePct);
      const explicitClosingPathLowPct = numberOrNull(priceSession.minChangePct, participationFacts.minimumPct);
      const closingPathLowPct = explicitClosingPathLowPct !== null
        ? explicitClosingPathLowPct
        : closingPathChangePct !== null && closingPathRecoveryPct !== null
          ? closingPathChangePct - closingPathRecoveryPct
          : null;
      const closingPathAtLimit = priceDiscovery.closedAtLimit === true
        || priceSession.closedAtLimit === true
        || String(priceDiscovery.type || "") === "turnover_limit";
      const resealed = !closingPathProxy && turnoverReseal.verified === true
        || exactEventConfirmed && (eventConfirmation.resealed === true || eventConfirmation.tailReseal === true);
      const damageText = safeList(damage.evidence).map(String).join("；");
      const isCapacity = /capacity|trend/.test(role) || /容量|趋势/.test(roleLabel);
      const isHighCore = /height|leader|popular_core|sentiment/.test(role)
        || /高度|龙头|人气/.test(roleLabel)
        || item && item.projectionLayer === "A";
      const hasDivergence = /divergence|mixed|harmful/.test(`${stage} ${String(support.status || "")} ${String(damage.status || "")}`)
        || /触板|回落|分歧|破板/.test(damageText)
        || resealed;
    let event = support.status === "supported" || resealed ? "分歧后有承接" : "承接结构待确认";
      if (closingPathProxy
        && participation.individualState === "local_repair"
        && closingPathLowPct !== null
        && closingPathLowPct <= -7
        && closingPathAtLimit) {
        event = "深水分歧后收板";
      } else if (resealed && exactEventConfirmed && lowPct !== null && lowPct <= -7) {
        event = "深水分歧后回封";
      } else if (isCapacity && hasDivergence) {
        event = "趋势核心冲板分歧";
      } else if (isHighCore && hasDivergence) {
        event = "高位换手分歧";
      }
      const confirmedDetails = [];
      const limitOpenCount = numberOrNull(eventConfirmation.limitOpenCount, eventConfirmation.breakCount);
      if (exactEventConfirmed && limitOpenCount !== null && limitOpenCount > 0) {
        confirmedDetails.push(`炸板${Math.round(limitOpenCount)}次`);
      }
      if (exactEventConfirmed && eventConfirmation.tailReseal === true) confirmedDetails.push("尾盘回封");
      if (!confirmedDetails.length && !closingPathProxy && turnoverReseal.verified === true) confirmedDetails.push("换手回封已确认");
      if (!confirmedDetails.length && closingPathProxy) confirmedDetails.push("收盘OHLC路径已确认；具体分时过程待确认");
      if (!confirmedDetails.length && priceDiscovery.trusted === true) confirmedDetails.push("当日分时已确认");
      return {
        oneWord,
        tradable,
        row: {
          code: String(item && item.code || ""),
          name: String(item && (item.name || item.code) || "--"),
          direction: String(item && item.direction || "题材待确认"),
          role: roleLabel || (isCapacity ? "趋势核心" : isHighCore ? "人气核心" : "市场核心"),
          event,
          detail: confirmedDetails.join(" · ") || "具体分时细节待确认",
        },
      };
    };
    const projectedAnchors = canonicalAnchors.map((item) => ({ item, projection: eventProjection(item) }));
    const heightConsensus = projectedAnchors
      .filter(({ projection }) => projection.oneWord)
      .slice(0, 3)
      .map(({ item }) => ({
        code: String(item.code || ""),
        name: String(item.name || item.code || "--"),
        direction: String(item.direction || "题材待确认"),
        role: String(item.anchorRoleLabel || item.identity || "高度核心"),
        event: "一字高标，只说明市场高度与一致度",
        detail: String(item.board && item.board.label || "无换手价格发现"),
      }));
    const tradableAnchorPool = projectedAnchors.filter(({ projection }) => projection.tradable);
    const selectedTradableAnchors = [];
    ["高位换手分歧", "深水分歧后回封", "趋势核心冲板分歧"].forEach((event) => {
      const match = tradableAnchorPool.find(({ projection }) => (
        projection.row.event === event && !selectedTradableAnchors.includes(projection)
      ));
      if (match) selectedTradableAnchors.push(match.projection);
    });
    tradableAnchorPool.forEach(({ projection }) => {
      if (selectedTradableAnchors.length < 4 && !selectedTradableAnchors.includes(projection)) {
        selectedTradableAnchors.push(projection);
      }
    });
    const tradableCoreEvidence = selectedTradableAnchors.map((projection) => projection.row);
    const emotionCurrent = emotionStageContext && typeof emotionStageContext === "object"
      ? emotionStageContext
      : emotionCycleSource.current && typeof emotionCycleSource.current === "object"
        ? emotionCycleSource.current
        : {};
    const emotionPrevious = unifiedMarketStage && unifiedMarketStage.previousEmotionStage
      && typeof unifiedMarketStage.previousEmotionStage === "object"
      ? unifiedMarketStage.previousEmotionStage
      : emotionCycleSource.previous && typeof emotionCycleSource.previous === "object"
        ? emotionCycleSource.previous
        : {};
    const emotionMetrics = emotionCycleSource.metrics && typeof emotionCycleSource.metrics === "object"
      ? emotionCycleSource.metrics
      : {};
    const heatMetrics = emotionMetrics.heat && typeof emotionMetrics.heat === "object" ? emotionMetrics.heat : {};
    const supportMetrics = emotionMetrics.support && typeof emotionMetrics.support === "object" ? emotionMetrics.support : {};
    const damageMetrics = emotionMetrics.damage && typeof emotionMetrics.damage === "object" ? emotionMetrics.damage : {};
    const rawCorePhase = String(stateModel.corePhase || stateModel.sentimentStage || "").trim();
    const hasExplicitCanonicalPhase = Boolean(String(emotionCurrent.phaseKey || "").trim());
    const currentPhaseKey = String(emotionCurrent.phaseKey || emotionCurrent.key || stateModel.corePhaseKey || "").toLowerCase();
    const canonicalCurrentPhaseLabel = String(emotionCurrent.label || "").trim();
    const previousPhaseKey = String(emotionPrevious.key || "").toLowerCase();
    const rawDivergenceQuality = String(stateModel.divergenceQuality || "").toLowerCase();
    const canonicalPhaseQuality = emotionCycleSource.phaseQuality && typeof emotionCycleSource.phaseQuality === "object"
      ? emotionCycleSource.phaseQuality
      : {};
    const canonicalQualityKey = String(emotionCurrent.qualityKey || canonicalPhaseQuality.key || "").toLowerCase();
    const canonicalQualityLabel = String(emotionCurrent.qualityLabel || canonicalPhaseQuality.label || "").trim();
    const hasClimaxContext = previousPhaseKey === "climax"
      || /高潮/.test(rawCorePhase)
      || Number(heatMetrics.climaxAnchorCount) >= 2 && Number(heatMetrics.oneWordCount) >= 1;
    const hasDivergenceContext = ["divergence", "strong_divergence", "support", "realization", "post_climax_divergence", "post_heat_divergence"].includes(currentPhaseKey)
      || Boolean(rawDivergenceQuality)
      || Number(emotionCycleSource.participation && emotionCycleSource.participation.divergentAnchorCount) >= 2
      || tradableCoreEvidence.some((item) => /分歧/.test(item.event));
    const corePhaseLabels = {
      climax: "高潮",
      acceleration: "加速",
      divergence: "分歧",
      support: "分歧后有承接",
      realization: "兑现",
      post_climax_divergence: "高潮后分歧",
      post_heat_divergence: "高热后分歧",
      strong_divergence: "强分歧",
      ebb: "退潮",
    };
    const phaseEmotionToken = `${phaseEmotionStage.key || ""} ${phaseEmotionStage.label || ""} ${emotionStageContext && emotionStageContext.status || ""} ${emotionStageContext && emotionStageContext.label || ""}`.toLowerCase();
    const hasObservedEmotionContext = Boolean(
      emotionStageContext
      && /^(?:observed|confirmed)$/.test(String(emotionStageContext.status || "").toLowerCase())
      && String(emotionStageContext.label || "").trim()
      && !/待确认|unknown|unavailable/.test(String(emotionStageContext.label || "").toLowerCase()),
    );
    const strictCurrentNodeToken = `${authoritativeCurrentNode.key || ""} ${authoritativeCurrentNode.label || ""}`.toLowerCase();
    const strictStageValidation = emotionCoreEvidence
      && emotionCoreEvidence.strictStageValidation
      && typeof emotionCoreEvidence.strictStageValidation === "object"
      ? emotionCoreEvidence.strictStageValidation
      : {};
    const strictEvidenceStageReady = Boolean(
      authoritativeStagePath
      && emotionCoreEvidence
      && String(authoritativeCurrentNode.status || "").toLowerCase() === "ready"
      && String(authoritativeCurrentNode.tradingDate || "").trim() === String(emotionCoreEvidence.tradingDate || "").trim()
      && String(authoritativeCurrentNode.snapshotKind || "").toLowerCase() === "closing"
      && Number(authoritativeCurrentNode.contractVersion) === 2
      && String(authoritativeCurrentNode.classifierVersion || "").trim() === "strict-core-qualification-v2"
      && currentStrictCoreCount !== null
      && currentStrictCoreCount > 0
      && currentStrictCoreCount === Number(emotionCoreEvidence.summary && emotionCoreEvidence.summary.strictCoreCount)
      && strictStageValidation.rowsValid === true
      && Number(strictStageValidation.strictCoreCount) === currentStrictCoreCount
      && String(strictStageValidation.phaseKey || "") === String(authoritativeCurrentNode.key || "")
      && String(strictStageValidation.phaseLabel || "") === String(authoritativeCurrentNode.label || "")
      && !/unknown|unavailable|待确认|证据不足/.test(strictCurrentNodeToken)
    );
    const strictEmotionStageUnavailable = !strictEvidenceStageReady;
    const emotionStageUnavailable = !hasObservedEmotionContext && (
      /unknown|unavailable|待确认|证据不足/.test(phaseEmotionToken)
      || (!String(phaseEmotionStage.key || "").trim()
        && !String(phaseEmotionStage.label || "").trim()
        && !hasExplicitCanonicalPhase
        && !String(rawCorePhase || "").trim())
    );
    const projectedCorePhase = emotionStageUnavailable
      ? "待确认"
      : String(phaseEmotionStage.label || "").trim() || (hasExplicitCanonicalPhase
        ? String(canonicalCurrentPhaseLabel || corePhaseLabels[currentPhaseKey] || "待确认")
        : hasClimaxContext && hasDivergenceContext
          ? "高潮后分歧"
          : String(canonicalCurrentPhaseLabel || corePhaseLabels[currentPhaseKey] || rawCorePhase || "待确认"));
    const explicitDivergenceIntensity = emotionStageContext && emotionStageContext.divergenceIntensity
      && typeof emotionStageContext.divergenceIntensity === "object"
      ? emotionStageContext.divergenceIntensity
      : phaseEmotionStage.divergenceIntensity && typeof phaseEmotionStage.divergenceIntensity === "object"
        ? phaseEmotionStage.divergenceIntensity
        : null;
    const explicitDivergenceQuality = emotionStageContext && emotionStageContext.divergenceQuality
      && typeof emotionStageContext.divergenceQuality === "object"
      ? emotionStageContext.divergenceQuality
      : phaseEmotionStage.divergenceQuality && typeof phaseEmotionStage.divergenceQuality === "object"
        ? phaseEmotionStage.divergenceQuality
        : null;
    const explicitSupportState = emotionStageContext && emotionStageContext.supportState
      && typeof emotionStageContext.supportState === "object"
      ? emotionStageContext.supportState
      : phaseEmotionStage.supportState && typeof phaseEmotionStage.supportState === "object"
        ? phaseEmotionStage.supportState
        : null;
    const projectedDivergenceIntensity = emotionStageUnavailable
      ? "待确认"
      : String(explicitDivergenceIntensity && explicitDivergenceIntensity.label || "待确认");
    const projectedDivergenceQuality = emotionStageUnavailable
      ? "待确认"
      : String(explicitDivergenceQuality && explicitDivergenceQuality.label || "").trim() || (canonicalQualityKey === "support_intact"
      ? "承接尚在，暂偏良性"
      : /repair_failed|support_weak|harmful/.test(canonicalQualityKey)
        ? "承接偏弱，亏钱效应在扩散"
        : canonicalQualityLabel && !/待确认|unknown/i.test(canonicalQualityLabel)
          ? canonicalQualityLabel
          : rawDivergenceQuality === "benign"
      ? "承接尚在，暂偏良性"
        : /harmful|malignant|weak/.test(rawDivergenceQuality)
          ? "承接偏弱，亏钱效应在扩散"
          : hasDivergenceContext && Number(supportMetrics.confirmedAnchorCount) >= 2 && Number(damageMetrics.harmfulAnchorCount || 0) < 2
            ? "承接尚在，暂偏良性"
          : hasDivergenceContext ? "承接仍需确认" : "待确认");
    const projectedSupportState = emotionStageUnavailable
      ? "待确认"
      : String(explicitSupportState && explicitSupportState.label || "待确认");
    const formatDecisionDataTime = (value) => {
      if (!value) return "待确认";
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return String(value);
      try {
        return new Intl.DateTimeFormat("zh-CN", {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(date);
      } catch (_) {
        return String(value);
      }
    };
    const validation = tomorrowDecorationAligned && tomorrowDecision.validation && typeof tomorrowDecision.validation === "object"
      ? tomorrowDecision.validation
      : {};
    const projectedCycle = normalizeBigCycleLabelForDisplay(
      unifiedMarketStage && unifiedMarketStage.bigCycle
      && (unifiedMarketStage.bigCycle.key || unifiedMarketStage.bigCycle.label),
    ) || "大周期待确认";
    const projectedBigCycle = String(bigCycleContext && bigCycleContext.label || projectedCycle);
    const projectedTransition = transitionContext
      && !/^(none|not_active)$/.test(String(transitionContext.key || transitionContext.status || ""))
      ? String(transitionContext.label || "过渡节点观察")
      : "";
    const projectedSmallCycle = String(smallCycleContext && smallCycleContext.label || "小周期待确认");
    const projectedEmotionStage = emotionStageUnavailable
      ? "情绪阶段待确认"
      : String(emotionStageContext && emotionStageContext.label || projectedCorePhase || "情绪阶段待确认");
    const projectedPreviousEmotionAvailable = emotionPrevious.available === true;
    const projectedPreviousEmotionStage = projectedPreviousEmotionAvailable
      ? String(
        emotionPrevious.label
        || emotionPrevious.participatoryPhase && emotionPrevious.participatoryPhase.label
        || "T-1情绪状态待确认",
      )
      : "T-1情绪状态待确认";
    const projectedPreviousEmotionTradingDate = String(
      emotionPrevious.tradingDate
      || emotionPrevious.replayAudit && emotionPrevious.replayAudit.targetTradingDate
      || emotionCycleSource.expectedPreviousTradingDate
      || "",
    );
    const projectedPreviousEmotionAuthority = String(emotionPrevious.authority || emotionPrevious.source || "");
    const rawProjectedIndexSubPhase = String(phaseIndexSubPhase.label || "").trim();
    const rawProjectedIndexSubPhaseToken = `${phaseIndexSubPhase.key || ""} ${rawProjectedIndexSubPhase}`.toLowerCase();
    const structuralIndexSubPhase = phaseMediumStructure.confirmed === true
      ? (/震荡|range|sideways/.test(projectedCycle)
        ? "震荡结构·暂无主升细分"
        : /退潮|weakening|retreat|decline/.test(projectedCycle)
            ? "退潮结构·暂无主升细分"
            : /冰点|ice[_ -]?point/.test(projectedCycle)
              ? "冰点结构·暂无主升细分"
              : "")
      : "";
    const projectedIndexSubPhase = (!rawProjectedIndexSubPhaseToken || /structure[_ -]?pending|unknown|unavailable|待确认/.test(rawProjectedIndexSubPhaseToken))
      ? structuralIndexSubPhase || rawProjectedIndexSubPhase || "细分阶段待确认"
      : rawProjectedIndexSubPhase;
    const projectedEmotionReason = strictEmotionStageUnavailable
      ? emotionUnavailableReasons.join("；") || String(emotionStageContext && emotionStageContext.reason || phaseEmotionStage.reason || "当前严格情绪证据不足，无法确认情绪阶段")
      : "";
    const rawBaselineToken = phaseTomorrowBaseline
      ? `${phaseTomorrowBaseline.key || ""} ${phaseTomorrowBaseline.status || ""} ${phaseTomorrowBaseline.label || ""}`.toLowerCase()
      : "";
    const hasStrictEvidenceContext = Boolean(
      authoritativeStagePath
      || phaseTomorrowBaseline
      || String(phaseEmotionStage.key || "").trim()
      || String(phaseEmotionStage.label || "").trim()
      || rawEmotionCoreEvidence && Object.keys(rawEmotionCoreEvidence).length
    );
    const useRiskDefaultBaseline = strictEmotionStageUnavailable && hasStrictEvidenceContext && (
      !phaseTomorrowBaseline
      || phaseTomorrowBaseline.riskDefault === true
      || /unknown|unavailable|待确认|evidence[_ -]?insufficient|risk[_ -]?default/.test(rawBaselineToken)
    );
    const baselineCheckpoints = phaseTomorrowBaseline && Array.isArray(phaseTomorrowBaseline.checkpoints)
      ? phaseTomorrowBaseline.checkpoints.map(String).filter(Boolean)
      : Array.isArray(decisionPermissionSource.checkpoints)
        ? decisionPermissionSource.checkpoints.map(String).filter(Boolean)
        : ["09:25", "09:35"];
    const strictEvidenceConfirmationConditions = (() => {
      const rows = [];
      if (strictEvidenceGaps.some((item) => /T-1/.test(item))) {
        rows.push(`补齐${expectedPreviousTradingDate || "上一交易日"}同版本T-1严格核心收盘证据`);
      }
      if (strictEvidenceGaps.some((item) => /严格情绪核心.*(?:不足|为\d+只)|阶段投票/.test(item))) {
        rows.push("当日严格情绪核心形成可投票样本");
      }
      if (strictEvidenceGaps.some((item) => /代次不一致/.test(item))) {
        rows.push("严格核心证据与本次明日决策使用相同代次");
      }
      if (baselineCheckpoints.length) {
        rows.push(`${baselineCheckpoints.join("/")}复核核心主动性、承接与负反馈扩散`);
      }
      return [...new Set(rows)];
    })();
    const projectedTomorrowBaseline = useRiskDefaultBaseline ? {
      key: "evidence_insufficient_defensive_observe",
      label: "严格情绪阶段待确认·防守观察",
      status: "risk_default",
      rank: null,
      probability: null,
      calibrated: false,
      riskDefault: true,
      stageInferred: false,
      action: String(phaseTomorrowBaseline && phaseTomorrowBaseline.action || "暂不新开仓"),
      checkpoints: baselineCheckpoints.length ? baselineCheckpoints : ["09:25", "09:35"],
      reason: strictEvidenceGaps.join("；") || String(phaseTomorrowBaseline && phaseTomorrowBaseline.reason || projectedEmotionReason || "严格情绪阶段证据缺口尚未定位，执行层按风险默认处理"),
      evidenceGaps: strictEvidenceGaps,
      excludedEvidence: strictEvidenceExcluded,
      confirmationConditions: strictEvidenceConfirmationConditions,
    } : phaseTomorrowBaseline ? {
      key: String(phaseTomorrowBaseline.key || ""),
      label: String(phaseTomorrowBaseline.label || "明日基准待确认"),
      status: String(phaseTomorrowBaseline.status || "baseline_unconfirmed"),
      rank: Number.isFinite(Number(phaseTomorrowBaseline.rank)) ? Number(phaseTomorrowBaseline.rank) : null,
      probability: phaseTomorrowBaseline.probability == null ? null : Number(phaseTomorrowBaseline.probability),
      calibrated: phaseTomorrowBaseline.calibrated === true,
      riskDefault: phaseTomorrowBaseline.riskDefault === true,
      stageInferred: phaseTomorrowBaseline.stageInferred === true,
      action: String(phaseTomorrowBaseline.action || ""),
      checkpoints: baselineCheckpoints,
      reason: String(phaseTomorrowBaseline.reason || ""),
      evidenceGaps: [],
      excludedEvidence: [],
      confirmationConditions: [],
    } : null;
    const displayProbabilityAvailable = probabilityAvailable && !useRiskDefaultBaseline;
    const todayTitleParts = [projectedBigCycle];
    if (projectedTransition) todayTitleParts.push(`过渡${projectedTransition}`);
    if (smallCycleContext && projectedSmallCycle && !/待确认/.test(projectedSmallCycle)) todayTitleParts.push(projectedSmallCycle);
    if (projectedIndexSubPhase && !/待确认/.test(projectedIndexSubPhase)) todayTitleParts.push(projectedIndexSubPhase);
    if (projectedEmotionStage && !/待确认/.test(projectedEmotionStage)) {
      todayTitleParts.push(`情绪${projectedEmotionStage}`);
    }
    const todayTitle = Array.from(new Set(todayTitleParts.filter(Boolean))).join(" · ")
      || "今日结论待确认";
    const primaryText = primaryScenario
      ? `${primaryScenario.label}${displayProbabilityAvailable ? ` ${primaryScenario.probability}%` : ""}`
      : "明日主路径待确认";
    return {
      tone: ["good", "warn", "bad", "neutral"].includes(tomorrowDecision.tone)
        ? tomorrowDecision.tone
        : forceCash || !candidates.length ? "neutral" : marketEmotion.light === "green" ? "good" : "warn",
      todayTitle,
      tomorrowBase: useRiskDefaultBaseline
        ? `严格阶段待确认：${strictEvidenceGaps.join("；") || "证据缺口尚未定位"}；暂无概率判断`
        : textOf(tomorrowDecorationAligned && tomorrowDecision.summary, `${primaryText}${primaryScenario && primaryScenario.summary ? ` · ${primaryScenario.summary}` : ""}`),
      permission: positionPlan.label,
      positionHint: positionPlan.hint,
      direction: cleanDirectDirection(
        unifiedProjection.chain && unifiedProjection.chain.theme
        && Array.isArray(unifiedProjection.chain.theme.themes)
        && unifiedProjection.chain.theme.themes[0]
        || directionModel.name
        || "暂无明确方向",
      ),
      directionPath: String(directionModel.path || directionModel.reason || (candidates.length ? "主路径候选" : "主路径没有合格执行票")),
      opportunity,
      candidates,
      contingencies,
      action: textOf(tomorrowDecorationAligned && tomorrowDecision.action, candidates.length ? "按统一决策链结果条件执行，不用高开代替买点。" : "统一决策链没有授权结果股，明日空仓等待。"),
      cancel: textOf(tomorrowDecorationAligned && (tomorrowDecision.invalidation || validation.invalidation), "统一决策链关闭、错代或市场与核心负反馈扩散时，全部候选失效"),
      priceAuditLabel: String(tomorrowDecorationAligned && tomorrowDecision.integrity && tomorrowDecision.integrity.priceLabel || ""),
      forecast: {
        available: displayProbabilityAvailable,
        withheldByEvidenceGate: useRiskDefaultBaseline,
        primaryScenarioKey,
        primaryScenario,
        scenarios,
        confidence,
        indexOutlook,
        profitEffectOutlook,
      },
      tomorrowBaseline: projectedTomorrowBaseline,
      state: {
        cycle: projectedCycle,
        bigCycle: projectedBigCycle,
        bigCycleStatus: String(bigCycleContext && bigCycleContext.status || "canonical"),
        bigCycleReasonCode: String(bigCycleContext && bigCycleContext.reasonCode || ""),
        bigCycleReason: String(bigCycleContext && bigCycleContext.reason || ""),
        bigCycleEvidence: bigCycleContext && Array.isArray(bigCycleContext.evidence)
          ? bigCycleContext.evidence.map(String).filter(Boolean) : [],
        bigCycleWindowDays: Number(bigCycleContext && bigCycleContext.windowDays) || null,
        bigCycleWindow: bigCycleContext && bigCycleContext.window && typeof bigCycleContext.window === "object"
          ? bigCycleContext.window : null,
        bigCycleSource: String(bigCycleContext && bigCycleContext.source || ""),
        bigCycleCalibrated: bigCycleContext && bigCycleContext.calibrated === true,
        transition: projectedTransition,
        transitionStatus: String(transitionContext && transitionContext.status || "not_active"),
        transitionReason: String(transitionContext && transitionContext.reason || ""),
        smallCycle: projectedSmallCycle,
        smallCycleStatus: String(smallCycleContext && smallCycleContext.status || "unavailable"),
        smallCycleReason: String(smallCycleContext && smallCycleContext.reason || ""),
        indexSubPhase: projectedIndexSubPhase,
        indexShortStructure: String(
          phaseIndexShortAligned && phaseIndexShortStructure.label
          || smallCycleIndexAligned && smallCycleIndexStructure.label
          || "指数5日结构待确认",
        ),
        indexShortStructureConflict: phaseIndexShortAligned && phaseIndexShortStructure.conflictWithSmallCycle === true
          || smallCycleIndexAligned && smallCycleIndexStructure.conflict === true,
        dailyRhythm: String(phaseDailyRhythm.label || "当日节奏待确认"),
        mediumStructure: String(phaseMediumStructure.label || "").trim() || "中期结构待确认",
        corePhase: projectedCorePhase,
        emotionStage: projectedEmotionStage,
        emotionStageStatus: emotionStageUnavailable
          ? "unavailable"
          : String(emotionStageContext && emotionStageContext.status || (phaseEmotionStage.label ? "observed" : "unavailable")),
        emotionStageReason: projectedEmotionReason || String(emotionStageContext && emotionStageContext.reason || phaseEmotionStage.reason || ""),
        previousEmotionStage: projectedPreviousEmotionStage,
        previousEmotionAvailable: projectedPreviousEmotionAvailable,
        previousEmotionTradingDate: projectedPreviousEmotionTradingDate,
        previousEmotionAuthority: projectedPreviousEmotionAuthority,
        strictEmotionStageStatus: strictEmotionStageUnavailable ? "unavailable" : "confirmed",
        strictEmotionStageReason: strictEmotionStageUnavailable
          ? hasStrictEvidenceContext
            ? projectedEmotionReason || String(phaseEmotionStage.reason || "严格情绪阶段未确认")
            : ""
          : String(authoritativeCurrentNode.reason || authoritativeCurrentNode.label || phaseEmotionStage.reason || ""),
        tradingPreference: speculationPreferenceContext && Array.isArray(speculationPreferenceContext.labels)
          ? Array.from(new Set(speculationPreferenceContext.labels.map(String).filter(Boolean)))
          : [],
        confirmedTradingPreference: speculationPreferenceContext && Array.isArray(speculationPreferenceContext.confirmedLabels)
          ? Array.from(new Set(speculationPreferenceContext.confirmedLabels.map(String).filter(Boolean)))
          : [],
        tradingPreferenceItems: speculationPreferenceContext && Array.isArray(speculationPreferenceContext.items)
          ? speculationPreferenceContext.items.map((item) => ({
            key: String(item && item.key || ""),
            label: String(item && item.label || ""),
            status: String(item && item.status || "observed"),
            score: item && item.score !== null && item.score !== undefined && Number.isFinite(Number(item.score)) ? Number(item.score) : null,
            count: item && item.count !== null && item.count !== undefined && Number.isFinite(Number(item.count)) ? Number(item.count) : null,
            note: String(item && item.note || ""),
          })).filter((item) => item.label)
          : [],
        preferenceStatus: String(speculationPreferenceContext && (
          speculationPreferenceContext.conclusionStatus || speculationPreferenceContext.status
        ) || "unavailable"),
        preferenceReason: String(speculationPreferenceContext && speculationPreferenceContext.reason || preferenceContextFallbackReason),
        preferenceGaps: speculationPreferenceContext && Array.isArray(speculationPreferenceContext.gaps)
          ? Array.from(new Set(speculationPreferenceContext.gaps.map(String).filter(Boolean)))
          : [preferenceContextFallbackReason].filter(Boolean),
        preferenceConfirmationConditions: speculationPreferenceContext && Array.isArray(speculationPreferenceContext.confirmationConditions)
          ? Array.from(new Set(speculationPreferenceContext.confirmationConditions.map(String).filter(Boolean)))
          : ["生成与本次明日决策同代的全市场资金路径与题材角色数据"],
        preferenceObservationOnly: speculationPreferenceContext
          ? speculationPreferenceContext.observationOnly !== false
          : true,
        marketCapCarrier: marketCapCarrierContext ? {
          key: String(marketCapCarrierContext.key || "unknown"),
          label: String(marketCapCarrierContext.label || "市值载体待确认"),
          status: String(marketCapCarrierContext.status || "unavailable"),
          carrierLabel: String(marketCapCarrierContext.carrierLabel || "市值偏好待确认"),
          marketAmountYi: Number.isFinite(Number(marketCapCarrierContext.marketAmountYi)) ? Number(marketCapCarrierContext.marketAmountYi) : null,
          breadthPct: Number.isFinite(Number(marketCapCarrierContext.breadthPct)) ? Number(marketCapCarrierContext.breadthPct) : null,
          avgIndexChange: Number.isFinite(Number(marketCapCarrierContext.avgIndexChange)) ? Number(marketCapCarrierContext.avgIndexChange) : null,
          reason: String(marketCapCarrierContext.reason || ""),
          confirmation: Array.isArray(marketCapCarrierContext.confirmation)
            ? marketCapCarrierContext.confirmation.map(String).filter(Boolean)
            : [],
          observationOnly: marketCapCarrierContext.observationOnly !== false,
          calibrated: marketCapCarrierContext.calibrated === true,
          opportunityGateImpact: marketCapCarrierContext.opportunityGateImpact === true,
          preferredBucketKeys: Array.isArray(marketCapCarrierContext.preferredBucketKeys)
            ? marketCapCarrierContext.preferredBucketKeys.map(String).filter(Boolean)
            : [],
          preferredBuckets: Array.isArray(marketCapCarrierContext.preferredBuckets)
            ? marketCapCarrierContext.preferredBuckets.map((bucket) => ({ ...bucket }))
            : [],
          coverage: marketCapCarrierContext.coverage && typeof marketCapCarrierContext.coverage === "object"
            ? { ...marketCapCarrierContext.coverage }
            : null,
          evidence: Array.isArray(marketCapCarrierContext.evidence)
            ? marketCapCarrierContext.evidence.map((row) => ({ ...row }))
            : [],
          candidateSample: marketCapCarrierContext.candidateSample && typeof marketCapCarrierContext.candidateSample === "object"
            ? { ...marketCapCarrierContext.candidateSample }
            : null,
        } : null,
        strictEvidenceGaps,
        strictEvidenceExcluded,
        strictEvidenceConfirmationConditions,
        divergenceIntensity: projectedDivergenceIntensity,
        divergenceQuality: projectedDivergenceQuality,
        supportState: projectedSupportState,
        emotionCoreEvidence,
        emotionPath: emotionCoreEvidence && emotionCoreEvidence.emotionStagePath
          ? {
            ...emotionCoreEvidence.emotionStagePath,
            previousEvidenceRecovery: emotionCoreEvidence.previousEvidenceRecovery || null,
          }
          : null,
        heightConsensus,
        tradableCoreEvidence,
        tradingDate: String(unifiedProjection.tradingDate || ""),
        asOf: tomorrowDecorationAligned ? String(tomorrowDecision.asOf || "") : "",
        dataTime: tomorrowDecorationAligned ? formatDecisionDataTime(tomorrowDecision.asOf) : "待确认",
        version: Number(unifiedProjection.chain && unifiedProjection.chain.version) || null,
        generationId: canonicalGenerationId,
      },
      validation: {
        upgrade: safeList(validation.upgrade).map(String).filter(Boolean),
        hold: safeList(validation.hold).map(String).filter(Boolean),
        downgrade: safeList(validation.downgrade).map(String).filter(Boolean),
      },
      unifiedPreference: tomorrowDecorationAligned && payload && payload.unifiedQuantFactors && payload.unifiedQuantFactors.speculationPreference
        ? payload.unifiedQuantFactors.speculationPreference
        : null,
      canonical: true,
    };
  }
  throw new Error("统一决策链摘要未按失败关闭路径返回");
}

function renderMarketStrengthReviewDetails(model) {
  if (!model || !Number(model.version)) return "";
  const safeTone = (value) => ["good", "warn", "bad", "neutral"].includes(value) ? value : "neutral";
  const pct = (value, digits = 1) => {
    const number = Number(value);
    return Number.isFinite(number) ? `${number > 0 ? "+" : ""}${number.toFixed(digits)}%` : "—";
  };
  const chain = Array.isArray(model.chain) ? model.chain.filter(Boolean) : [];
  const metrics = model.metrics && typeof model.metrics === "object" ? model.metrics : {};
  const layers = [model.marketSurface, model.capacity, model.flowNature].filter((item) => item && typeof item === "object");
  if (!chain.length && !layers.length) return "";
  return `
    <details class="causal-evidence-disclosure review-strength-details">
      <summary><span>查看市场判断链与量化依据</span><small>详细论证已从“明日决策”移到这里</small></summary>
      <div class="review-strength-detail-body">
        ${chain.length ? `<div class="causal-chain-steps">${chain.map((item) => `
          <article class="causal-step is-${safeTone(item.tone)}">
            <span><b>${escapeHtml(item.index || "--")}</b>${escapeHtml(item.title || "判断")}</span>
            <strong>${escapeHtml(item.label || "--")}</strong>
            <small>${escapeHtml(item.summary || "")}</small>
          </article>`).join("")}</div>` : ""}
        <div class="causal-quick-facts">
          <span>普通样本开盘→收盘 <b>${pct(metrics.medianOpenToClosePct)}</b></span>
          <span>成交前10加权 <b>${pct(metrics.top10WeightedOpenToClosePct)}</b></span>
          <span>成交前10在开盘价上方 <b>${metrics.top10AmountAboveOpenRate == null ? "—" : `${escapeHtml(String(metrics.top10AmountAboveOpenRate))}%成交额`}</b></span>
          <span>成交前10高开兑现 <b>${metrics.top10GapFadeRate == null ? "—" : `${escapeHtml(String(metrics.top10GapFadeRate))}%`}</b></span>
        </div>
        ${layers.length ? `<div class="causal-layer-contrast">${layers.map((item) => `
          <section class="is-${safeTone(item.tone)}"><span>${escapeHtml(item === model.marketSurface ? "市场表面" : item === model.capacity ? "核心容量" : "资金性质")}</span><strong>${escapeHtml(item.label || "待确认")}</strong><small>${escapeHtml(item.summary || "")}</small></section>`).join("")}</div>` : ""}
      </div>
    </details>`;
}

function renderTomorrowDecisionReviewDetails(decision) {
  const forecast = decision && decision.forecast && typeof decision.forecast === "object"
    ? decision.forecast
    : null;
  if (!forecast || Number(forecast.version || 0) < 1) return "";
  const evidence = Array.isArray(forecast.evidence) ? forecast.evidence.filter(Boolean) : [];
  const updates = Array.isArray(forecast.updateRules) ? forecast.updateRules.filter(Boolean) : [];
  const quality = forecast.dataQuality && typeof forecast.dataQuality === "object" ? forecast.dataQuality : {};
  const coreEmotion = decision && decision.coreEmotion && typeof decision.coreEmotion === "object"
    ? decision.coreEmotion
    : {};
  const coreQuality = coreEmotion.dataQuality && typeof coreEmotion.dataQuality === "object"
    ? coreEmotion.dataQuality
    : {};
  const coreStageLabels = {
    weak: "弱势",
    weak_to_strong: "弱转强",
    acceleration: "加速",
    expectation_overdrawn: "预期透支",
    divergence: "分歧兑现",
    supported: "分歧后承接",
    consensus_resume: "重新一致",
    negative_feedback: "负反馈",
    unknown: "阶段待确认",
  };
  const corePriority = { negative_feedback: 0, divergence: 1, expectation_overdrawn: 2, acceleration: 3, supported: 4, consensus_resume: 4, weak_to_strong: 5, weak: 6, unknown: 7 };
  const coreItems = (Array.isArray(coreEmotion.items) ? coreEmotion.items : [])
    .filter(Boolean)
    .slice()
    .sort((left, right) => {
      const selectedDelta = Number(Boolean(right.selectedCandidate)) - Number(Boolean(left.selectedCandidate));
      if (selectedDelta) return selectedDelta;
      const priorityDelta = Number(corePriority[left.stage] ?? 99) - Number(corePriority[right.stage] ?? 99);
      if (priorityDelta) return priorityDelta;
      return Number(right.weight || 0) - Number(left.weight || 0);
    })
    .slice(0, 8);
  const methodLabel = forecast.calibrated === true
    ? "历史样本已校准"
    : String(forecast.methodLabel || "规则先验（未历史校准）");
  const evidenceHtml = evidence.length ? `
    <div class="causal-chain-steps">
      ${evidence.map((item, index) => `
        <article class="causal-step is-${item.available === false ? "neutral" : "good"}">
          <span><b>${String(index + 1).padStart(2, "0")}</b>${escapeHtml(item.scope === "emotion" ? "短线情绪" : "指数环境")}</span>
          <strong>${escapeHtml(item.label || "判断依据")}</strong>
          <small>${escapeHtml(item.detail || (item.available === false ? "本项数据缺失，未按0计分" : "已纳入规则先验"))}</small>
        </article>`).join("")}
    </div>` : `<p class="decision-note">当前没有可展示的概率依据。</p>`;
  const updateHtml = updates.length ? `
    <div class="review-conclusion-timeline tomorrow-forecast-update-list">
      ${updates.map((rule) => {
        const upgrade = Array.isArray(rule.upgradeConditions) ? rule.upgradeConditions[0] : "";
        const downgrade = Array.isArray(rule.downgradeConditions) ? rule.downgradeConditions[0] : "";
        return `<div><b>${escapeHtml(rule.time || "盘中")}</b><p><strong>${escapeHtml(rule.purpose || "更新主路径")}</strong><span>升级：${escapeHtml(upgrade || "等待独立市场证据")}；降级：${escapeHtml(downgrade || "负反馈扩散时收紧")}</span></p></div>`;
      }).join("")}
    </div>` : "";
  const coreHtml = coreItems.length ? `
    <section class="review-core-emotion-basket">
      <div class="review-core-emotion-head">
        <strong>高影响核心情绪篮子</strong>
        <span>${escapeHtml(coreQuality.exactPreviousTradingDay ? "已校验精确T-1" : "缺精确T-1 · 当日规则识别")}</span>
      </div>
      <div class="review-core-emotion-grid">
        ${coreItems.map((item) => {
          const evidenceRows = Array.isArray(item.evidence) ? item.evidence.filter(Boolean) : [];
          return `<article class="is-${escapeHtml(String(item.stage || "unknown"))}">
            <div><strong>${escapeHtml(item.name || item.code || "未命名核心")}</strong><small>${escapeHtml(item.code || "")}</small></div>
            <span>${escapeHtml(coreStageLabels[item.stage] || item.stage || "阶段待确认")} · 权重${escapeHtml(String(Number.isFinite(Number(item.weight)) ? Math.round(Number(item.weight)) : "--"))}</span>
            <p>${escapeHtml(evidenceRows[0] || "阶段证据待补齐")}</p>
            ${item.selectedCandidate ? `<em>推荐票 · 已从市场概率验证中剔除</em>` : ""}
          </article>`;
        }).join("")}
      </div>
      <p class="decision-note">这里只展示影响市场情绪的核心票及其阶段证据；单点负反馈只记为待验证，至少两只独立高影响核心同步负反馈才定义为扩散。</p>
    </section>` : `<p class="decision-note">核心情绪阶段尚无可信股票级证据，未用普通涨幅或单只推荐票补齐。</p>`;
  return `
    <details class="causal-evidence-disclosure review-tomorrow-forecast-details">
      <summary><span>查看明日规则先验依据与早盘更新规则</span><small>${escapeHtml(methodLabel)} · 覆盖${escapeHtml(String(quality.coveragePct == null ? "--" : quality.coveragePct))}%</small></summary>
      <div class="review-strength-detail-body">
        ${coreHtml}
        ${evidenceHtml}
        ${updateHtml}
        <p class="decision-note">规则先验占比不是历史胜率；09:25、09:35只用指数、市场宽度及候选股以外的核心篮子更新，单只推荐票上涨不能证明市场加强。</p>
      </div>
    </details>`;
}

function renderEmotionStagePath(path) {
  if (!path || typeof path !== "object" || Array.isArray(path)) return "";
  const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
  const text = (value, fallback = "") => {
    const normalized = String(value == null ? "" : value).trim();
    return normalized || fallback;
  };
  const readableLabels = {
    exact_t1_closing_unavailable: "缺少同版本精确T-1收盘严格核心证据",
    previous_evidence_future_dated: "T-1严格核心证据含未来日期血缘，已拒绝使用",
    previous_strict_core_insufficient: "昨日严格核心资格或状态不足，阶段暂不确认",
    current_strict_core_insufficient: "今日严格核心状态未形成多数，阶段暂不确认",
    strict_core_empty: "严格核心资格结果为空（0只）",
    strict_core_state_unknown: "严格核心状态待确认",
    strict_core_state_mixed_or_tied: "严格核心状态混合或打平",
    cycle_identity_established: "周期核心身份已建立",
    active_primary: "是否为题材唯一主核心",
    cycle_identity_state: "周期身份状态",
    confirmed_trading_dates: "跨日确认日期",
    valid_impact_days: "有效影响天数",
    current_state: "当日状态",
    support_score: "承接分",
    damage_score: "负反馈分",
    core_lifecycle_evidence: "收盘路径证据",
    closing_session_completed: "收盘数据完整",
    theme_cycle_leadership: "题材周期身份",
    emotion_anchor_session: "当日情绪状态",
    core_emotion_lifecycle: "核心情绪生命周期",
    "tencent-kline": "腾讯收盘K线",
    cross_session_identity: "跨日周期身份",
    height_risk_trace: "仅观察负反馈 · 非机会",
    repair_failed: "修复失败",
    local_repair: "局部修复",
    divergence: "分歧",
    divergent: "分歧",
    supported: "承接",
    participating: "周期内平稳运行",
    negative_feedback: "高位负反馈",
    unknown: "待确认",
  };
  const readableValue = (value) => {
    if (Array.isArray(value)) return value.map((item) => readableValue(item)).filter(Boolean).join("、");
    if (typeof value === "boolean") return value ? "是" : "否";
    const raw = text(value);
    return readableLabels[raw] || raw;
  };
  const evidenceText = (value) => {
    if (typeof value === "string") return readableLabels[value.trim()] || value.trim();
    if (!value || typeof value !== "object") return "";
    const rawLabel = text(value.label || value.key);
    const label = readableLabels[rawLabel] || rawLabel;
    const detailValue = value.detail != null ? value.detail : value.text != null ? value.text : value.value;
    const detail = readableValue(detailValue);
    return label && detail ? `${label}：${detail}` : label || detail;
  };
  const rawNodes = path.nodes && typeof path.nodes === "object" ? path.nodes : {};
  const rawPrevious = path.previous && typeof path.previous === "object" ? path.previous : rawNodes.previous || {};
  const rawCurrent = path.current && typeof path.current === "object" ? path.current : rawNodes.current || {};
  const rawTomorrow = path.tomorrow && typeof path.tomorrow === "object" ? path.tomorrow : rawNodes.tomorrow || {};
  const previousEvidenceRecovery = path.previousEvidenceRecovery
    && typeof path.previousEvidenceRecovery === "object"
    ? path.previousEvidenceRecovery
    : {};
  const stageStateLabels = {
    divergent: "分歧",
    divergence: "分歧",
    supported: "承接",
    repairFailed: "修复失败",
    repair_failed: "修复失败",
    local_repair: "局部修复",
    participating: "周期内平稳运行",
    negative_feedback: "高位负反馈",
    unknown: "待确认",
  };
  const strictStatesFromEvidence = (node) => {
    const direct = list(node && node.strictCoreStates);
    if (direct.length) return direct;
    const evidence = node && node.evidence && typeof node.evidence === "object" ? node.evidence : {};
    const seen = new Set();
    const rows = [];
    ["repairFailed", "supported", "divergent", "participating", "unknown"].forEach((groupKey) => {
      const group = evidence[groupKey] && typeof evidence[groupKey] === "object" ? evidence[groupKey] : {};
      list(group.rows).forEach((row) => {
        const code = text(row && row.code);
        const name = text(row && (row.name || row.code));
        const dedupeKey = code || name;
        if (!dedupeKey || seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        rows.push({
          ...row,
          code,
          name,
          stateKey: groupKey === "repairFailed" ? "repair_failed" : groupKey,
          stateLabel: stageStateLabels[groupKey] || "状态待确认",
          evidence: list(row && row.evidence),
        });
      });
    });
    return rows;
  };
  const normalizedObservedNode = (node) => {
    const evidence = node && node.evidence && typeof node.evidence === "object" ? node.evidence : {};
    const strictCoreCount = evidence.strictCoreCount !== null
      && evidence.strictCoreCount !== undefined
      && Number.isFinite(Number(evidence.strictCoreCount))
      ? Number(evidence.strictCoreCount)
      : null;
    return {
      status: text(node && node.status, "unavailable"),
      tradingDate: text(node && node.tradingDate),
      stageKey: text(node && (node.stageKey || node.key)),
      stageLabel: text(node && (node.stageLabel || node.label)),
      strictCoreStatus: text(node && node.strictCoreStatus, text(node && node.status, "unavailable")),
      strictCoreCount,
      phaseReason: text(node && node.phaseReason),
      strictCoreStates: strictStatesFromEvidence(node),
      unavailableReason: text(node && (node.unavailableReason || node.reason), list(node && node.gaps).map(evidenceText).filter(Boolean).join("；")),
    };
  };
  const previous = normalizedObservedNode(rawPrevious);
  const current = normalizedObservedNode(rawCurrent);
  const exactPreviousTradingDay = typeof path.exactPreviousTradingDay === "boolean"
    ? path.exactPreviousTradingDay
    : text(rawPrevious.snapshotKind).toLowerCase() === "closing" && text(rawPrevious.status).toLowerCase() !== "unavailable";
  const expectedPreviousTradingDate = text(path.expectedPreviousTradingDate, text(rawPrevious.tradingDate));
  const emotionCoreRoleLabel = (value) => ({
    primary_leader: "题材主龙头",
    risk_core: "风险情绪核心",
    capacity_core: "容量情绪核心",
    height_core: "高度情绪核心",
    repair_core: "修复情绪核心",
    co_core: "共同情绪核心",
  }[text(value).toLowerCase()] || "市场情绪核心");
  const stateRows = (node) => list(node && node.strictCoreStates).map((row) => {
    const evidence = list(row && row.evidence).map(evidenceText).filter(Boolean);
    const positive = Number.isFinite(Number(row && row.positiveInfluenceScore)) ? Number(row.positiveInfluenceScore) : null;
    const negative = Number.isFinite(Number(row && row.negativeInfluenceScore)) ? Number(row.negativeInfluenceScore) : null;
    const signed = Number.isFinite(Number(row && row.signedInfluenceScore)) ? Number(row.signedInfluenceScore) : null;
    return `
      <article class="emotion-stage-core-state" data-emotion-core-state="${escapeHtml(text(row && row.stateKey, "unknown"))}">
        <header><strong>${escapeHtml(text(row && (row.name || row.code), "市场情绪核心待确认"))}</strong><small>${escapeHtml(`${text(row && row.code)} · ${emotionCoreRoleLabel(row && row.voteRole)}`)}</small></header>
        <mark>${escapeHtml(text(row && row.stateLabel, "状态待确认"))}</mark>
        ${positive !== null && negative !== null && signed !== null ? `<p>正面${escapeHtml(String(positive))} · 负面${escapeHtml(String(negative))} · 净影响${escapeHtml(`${signed > 0 ? "+" : ""}${signed}`)}（规则分，非概率）</p>` : ""}
        ${evidence.length ? `<ul>${evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : '<p>该核心的具名证据待补足。</p>'}
      </article>`;
  }).join("");
  const unavailableReason = (node, fallback) => text(
    node && (node.unavailableReason || node.reason),
    list(path.gaps).map(evidenceText).filter(Boolean)[0] || fallback,
  );
  const renderObservedNode = (key, heading, node) => {
    const nodeStatus = text(node && node.status, "unavailable").toLowerCase();
    const strictStatus = text(node && node.strictCoreStatus, nodeStatus).toLowerCase();
    const previousUnavailable = key === "previous" && exactPreviousTradingDay !== true;
    const unavailable = previousUnavailable || nodeStatus === "unavailable";
    const insufficient = !unavailable && (nodeStatus === "insufficient" || strictStatus === "insufficient");
    const confirmed = !unavailable && !insufficient && nodeStatus === "ready" && strictStatus === "ready";
    const date = previousUnavailable
      ? text(expectedPreviousTradingDate, "上一交易日待确认")
      : text(node && node.tradingDate, key === "previous" ? "上一交易日待确认" : "当前交易日待确认");
    if (unavailable) {
      return `
        <article data-emotion-path-node="${key}" class="emotion-stage-path-node is-unavailable" data-stage-confirmed="false">
          <header><span>${heading}</span><small>${escapeHtml(date)}</small></header>
          <strong>阶段证据不可用</strong>
          <p>${escapeHtml(unavailableReason(node, key === "previous" ? "缺少精确T-1收盘快照，无法确认昨日严格核心阶段" : "当前严格核心证据不可用"))}</p>
        </article>`;
    }
    if (insufficient) {
      const rows = stateRows(node);
      const count = node && node.strictCoreCount;
      const emptyQualification = count === 0;
      const recoveredPrevious = key === "previous"
        && ["stored", "replayed_fail_closed"].includes(text(previousEvidenceRecovery.status))
        && text(previousEvidenceRecovery.tradingDate) === text(node && node.tradingDate);
      const title = emptyQualification
        ? (recoveredPrevious ? "T-1档案已恢复，严格核心资格为0只" : "当前严格核心资格结果为空（0只）")
        : count !== null && count !== undefined
          ? `已有${count}只严格核心，但状态未形成多数`
          : "严格核心不足，阶段待确认";
      const reason = emptyQualification
        ? (recoveredPrevious
          ? "收盘契约已按原始历史代次完成回放；当日没有股票通过严格核心资格，无法确认昨日阶段。"
          : "证据契约已完成同代校验，但没有股票同时满足跨日周期身份、当前主核心和严格收盘资格；不是档案缺失。")
        : unavailableReason(node, "严格核心状态未知、混合或打平，不能用高度风险票补位");
      return `
        <article data-emotion-path-node="${key}" class="emotion-stage-path-node is-insufficient" data-stage-confirmed="false">
          <header><span>${heading}</span><small>${escapeHtml(date)}</small></header>
          <strong>${escapeHtml(title)}</strong>
          <p>${escapeHtml(reason)}</p>
          ${rows ? `<div class="emotion-stage-insufficient-evidence"><b>已核实但尚未形成多数的严格核心</b>${rows}</div>` : ""}
        </article>`;
    }
    const rows = stateRows(node);
    return `
      <article data-emotion-path-node="${key}" class="emotion-stage-path-node${confirmed ? " is-ready" : " is-insufficient"}" data-stage-confirmed="${confirmed ? "true" : "false"}">
        <header><span>${heading}</span><small>${escapeHtml(date)}</small></header>
        <strong>${escapeHtml(text(node && node.stageLabel, confirmed ? "阶段已确认" : "阶段待确认"))}</strong>
        ${confirmed ? (rows || '<p>本节点暂无具名严格核心状态。</p>') : '<p>严格核心证据尚未形成可确认结论。</p>'}
      </article>`;
  };
  const tomorrow = rawTomorrow;
  const triggers = list(tomorrow.triggers || tomorrow.trigger).map(evidenceText).filter(Boolean);
  const cancelConditions = list(tomorrow.cancelConditions || tomorrow.cancel).map(evidenceText).filter(Boolean);
  const rawScenarioInference = tomorrow.scenarioInference && typeof tomorrow.scenarioInference === "object"
    ? tomorrow.scenarioInference : null;
  const scenarioLabelMap = {
    repair_or_consensus: "修复延续 / 重新一致",
    divergence_continuation: "分歧延续",
    negative_feedback_expansion: "负反馈扩散",
  };
  const scenarioInferenceContract = (() => {
    if (!rawScenarioInference) return { status: "missing", valid: false, inference: null };
    const guardrails = rawScenarioInference.guardrails && typeof rawScenarioInference.guardrails === "object"
      ? rawScenarioInference.guardrails : {};
    const integrity = rawScenarioInference.integrity && typeof rawScenarioInference.integrity === "object"
      ? rawScenarioInference.integrity : {};
    const confidence = rawScenarioInference.confidence && typeof rawScenarioInference.confidence === "object"
      ? rawScenarioInference.confidence : {};
    const scenarios = list(rawScenarioInference.scenarios);
    const keys = scenarios.map((row) => text(row && row.key));
    const weights = scenarios.map((row) => Number(row && row.modelWeightPct));
    const readyRowsValid = rawScenarioInference.status !== "ready" || (
      scenarios.length === 3
      && new Set(keys).size === 3
      && ["repair_or_consensus", "divergence_continuation", "negative_feedback_expansion"].every((key) => keys.includes(key))
      && weights.every((weight) => Number.isFinite(weight) && weight >= 0 && weight <= 100)
      && Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 100) < 0.01
      && scenarios.every((row) => row && row.probability === null && row.calibrated === false)
    );
    const valid = Number(rawScenarioInference.version) === 1
      && text(rawScenarioInference.method) === "same_generation_evidence_weighted_emotion_scenario_v1"
      && rawScenarioInference.calibrated === false
      && rawScenarioInference.probability === null
      && text(rawScenarioInference.tradingDate) === text(current.tradingDate)
      && guardrails.observationOnly === true
      && guardrails.emotionStageAuthority === false
      && guardrails.selectionAuthority === false
      && guardrails.executionAuthority === false
      && guardrails.positionAuthority === false
      && guardrails.probabilityAuthority === false
      && guardrails.historicalCalibrationRequiredForProbabilityClaim === true
      && readyRowsValid
      && (rawScenarioInference.status !== "ready" || (
        integrity.sameGeneration === true
        && integrity.scenarioWeightsSumTo100 === true
        && integrity.groupWeightsSumTo100 === true
        && integrity.criticalGroupsReady === true
        && integrity.noTradeAuthority === true
        && Number.isFinite(Number(confidence.score))
      ));
    return {
      status: valid ? text(rawScenarioInference.status, "unavailable") : "invalid",
      valid,
      inference: valid ? rawScenarioInference : null,
    };
  })();
  const scenarioInferenceHtml = (() => {
    if (!rawScenarioInference) return "";
    if (!scenarioInferenceContract.valid) {
      return '<section class="emotion-scenario-inference is-unavailable"><header><div><span>当下证据动态推演</span><strong>契约校验未通过</strong></div></header><p>继续只使用规则基准，不显示推演百分比。</p></section>';
    }
    const inference = scenarioInferenceContract.inference;
    const confidence = inference.confidence && typeof inference.confidence === "object" ? inference.confidence : {};
    const groups = list(inference.groups);
    if (inference.status !== "ready") {
      return `<section class="emotion-scenario-inference is-unavailable"><header><div><span>当下证据动态推演</span><strong>证据不足</strong></div></header><p>关键证据组未齐，继续只使用规则基准，不强行生成百分比。</p></section>`;
    }
    const canShowPercentages = confidence.canShowPercentages === true;
    const scenarios = list(inference.scenarios).slice().sort((left, right) => Number(left.rank) - Number(right.rank));
    const cards = scenarios.map((scenario) => {
      const key = text(scenario && scenario.key);
      const weight = Number(scenario && scenario.modelWeightPct);
      return `<article data-emotion-scenario="${escapeHtml(key)}" class="${Number(scenario.rank) === 1 ? "is-primary" : ""}"><span>${escapeHtml(String(scenario.rank || "--").padStart(2, "0"))}</span><div><strong>${escapeHtml(scenarioLabelMap[key] || text(scenario && scenario.label, "情景待确认"))}</strong><small>${canShowPercentages ? `动态权重 ${escapeHtml(String(weight))}%` : `第${escapeHtml(String(scenario.rank || "--"))}顺位`}</small></div></article>`;
    }).join("");
    const groupRows = groups.map((group) => {
      const primaryKey = text(group && group.primaryScenario);
      const reasons = list(group && group.reasons).map(text).filter(Boolean).slice(0, 3);
      return `<article><header><strong>${escapeHtml(text(group && group.label, "证据组"))}</strong><small>权重${escapeHtml(String(group && group.weight == null ? "--" : group.weight))}% · 覆盖${escapeHtml(String(group && group.coveragePct == null ? "--" : group.coveragePct))}%</small></header><p>组内倾向：${escapeHtml(scenarioLabelMap[primaryKey] || "待确认")}</p>${reasons.length ? `<ul>${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>` : ""}</article>`;
    }).join("");
    return `
      <section class="emotion-scenario-inference is-ready" data-emotion-scenario-inference="ready">
        <header><div><span>当下证据动态推演</span><strong>三种下一交易日情景</strong></div><em>可信度${escapeHtml(text(confidence.label, "待确认"))} · ${escapeHtml(String(confidence.score))}/100</em></header>
        <div class="emotion-scenario-grid">${cards}</div>
        <p class="emotion-scenario-boundary">${canShowPercentages ? "百分比是当前证据的模型推演权重" : "当前只展示情景顺位"}，尚未历史校准，不是历史胜率，不生成买点、仓位或交易权限。</p>
        <details class="emotion-scenario-details"><summary>查看五组证据如何形成推演</summary><div>${groupRows}</div></details>
      </section>`;
  })();
  const observedSummaryStatus = (key, node) => {
    const nodeStatus = text(node && node.status, "unavailable").toLowerCase();
    const strictStatus = text(node && node.strictCoreStatus, nodeStatus).toLowerCase();
    if (key === "previous" && exactPreviousTradingDay !== true) return "证据不可用";
    if (nodeStatus === "unavailable") return "证据不可用";
    if (nodeStatus === "insufficient" || strictStatus === "insufficient") {
      const exactZero = node && node.strictCoreCount !== null
        && node.strictCoreCount !== undefined
        && Number(node.strictCoreCount) === 0;
      return exactZero ? "核心资格0只" : "状态待确认";
    }
    return text(node && node.stageLabel, "阶段已确认");
  };
  const previousSummaryDate = exactPreviousTradingDay === true
    ? text(previous.tradingDate, expectedPreviousTradingDate || "日期待确认")
    : text(expectedPreviousTradingDate, "日期待确认");
  const currentSummaryDate = text(current.tradingDate, "日期待确认");
  const tomorrowSummaryLabel = text(tomorrow.label, "观察基准待确认");
  const pathSummaryHtml = `
    <div class="emotion-stage-path-summary" aria-label="情绪阶段三段状态">
      <article data-emotion-path-summary-node="previous" class="${exactPreviousTradingDay === true && previous.status === "ready" ? "is-ready" : "is-pending"}"><span>上一交易日状态</span><strong>${escapeHtml(observedSummaryStatus("previous", previous))}</strong><small>${escapeHtml(previousSummaryDate)}</small></article>
      <article data-emotion-path-summary-node="current" class="${current.status === "ready" ? "is-ready" : "is-pending"}"><span>最新收盘状态</span><strong>${escapeHtml(observedSummaryStatus("current", current))}</strong><small>${escapeHtml(currentSummaryDate)}</small></article>
      <article data-emotion-path-summary-node="tomorrow" class="is-baseline"><span>下一交易日观察基准</span><strong>${escapeHtml(tomorrowSummaryLabel)}</strong><small>规则基准 · 非概率</small></article>
    </div>`;
  const tomorrowNode = `
    <article data-emotion-path-node="tomorrow" class="emotion-stage-path-node is-tomorrow" data-stage-confirmed="false">
      <header><span>下一交易日观察基准</span><small>规则基准（未做历史校准）</small></header>
      <strong>${escapeHtml(text(tomorrow.label, "明日路径待确认"))}</strong>
      <p>这是规则生成的准备路径，不是历史胜率或概率承诺；盘前与开盘后必须重新验证。</p>
      ${scenarioInferenceHtml}
      <div class="emotion-stage-path-conditions">
        <section><b>触发条件</b>${triggers.length ? `<ul>${triggers.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : '<p>触发条件待确认。</p>'}</section>
        <section><b>取消条件</b>${cancelConditions.length ? `<ul>${cancelConditions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : '<p>取消条件待确认。</p>'}</section>
      </div>
    </article>`;
  const backendRiskRows = rawCurrent.riskContext && typeof rawCurrent.riskContext === "object"
    ? list(rawCurrent.riskContext.rows)
    : [];
  const riskRows = list(path.riskBarometers).concat(backendRiskRows).filter((row, index, rows) => {
    const code = text(row && row.code);
    return Number(row && row.votingWeight) === 0
      && rows.findIndex((candidate) => text(candidate && candidate.code) === code) === index;
  }).map((row) => ({
    ...row,
    stateLabel: text(row && row.stateLabel, stageStateLabels[text(row && row.state)] || "风险状态待确认"),
    evidence: list(row && row.evidence).length ? list(row.evidence) : [text(row && row.source)].filter(Boolean),
  }));
  const displayedRiskRows = riskRows.slice(0, 4);
  const riskHtml = riskRows.length ? `
    <section class="emotion-stage-risk-context">
      <header><strong>高位负反馈观察（非机会）</strong><span>共${escapeHtml(String(riskRows.length))}只，展示前${escapeHtml(String(displayedRiskRows.length))}只 · 仅观察负反馈 · 非推荐 · 投票权重0</span></header>
      <div>${displayedRiskRows.map((row) => {
        const evidence = list(row && row.evidence).map(evidenceText).filter(Boolean);
        return `<article class="emotion-stage-risk-card" data-emotion-risk-barometer="${escapeHtml(text(row && row.code, "unknown"))}"><div><strong>${escapeHtml(text(row && (row.name || row.code), "高位风向标"))}</strong><small>${escapeHtml(text(row && row.code))}</small></div><mark>${escapeHtml(text(row && row.stateLabel, "节点待确认"))}</mark>${evidence.length ? `<p>${escapeHtml(evidence.join("；"))}</p>` : ""}</article>`;
      }).join("")}</div>
    </section>` : "";
  return `
    <section class="emotion-stage-path is-${escapeHtml(text(path.status, "unavailable"))}" data-emotion-stage-path>
      <header class="emotion-stage-path-heading"><div><span>情绪阶段路径</span><strong>上一交易日状态 → 最新收盘状态 → 下一交易日观察基准</strong></div><p>阶段由最多5只市场情绪核心按正负影响加权；其他高位票仅作0票旁证。</p></header>
      ${pathSummaryHtml}
      <div class="emotion-stage-path-track">
        ${renderObservedNode("previous", "上一交易日状态", previous)}
        ${renderObservedNode("current", "最新收盘状态", current)}
        ${tomorrowNode}
      </div>
      ${riskHtml}
    </section>`;
}

function decisionFocusStateLabel(value) {
  const key = String(value || "").trim().toLowerCase();
  const labels = {
    local_repair: "承接",
    divergence_supported: "分歧后承接",
    divergence: "分歧",
    repair_failed: "修复失败",
    negative_feedback: "负反馈",
    normal_participation: "平稳运行",
    consensus_resume: "重新走强",
    acceleration: "加速",
  };
  return labels[key] || String(value || "状态待确认").trim();
}

function buildDecisionFocusStocks(payload, projection = null) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const unified = projection && typeof projection === "object"
    ? projection
    : resolveUnifiedDecisionChainProjection(source);
  const text = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  const codeOf = (value) => text(value && (value.code || value.secCode || value.stockCode || value.symbol)).toUpperCase();
  const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
  const candidateByCode = new Map(list(source.candidates).map((row) => [codeOf(row), row]));
  const opportunityRows = [];
  const anchorRows = [];
  const opportunitySeen = new Set();
  const anchorSeen = new Set();
  const pushOpportunity = (row) => {
    const code = codeOf(row);
    if (!code || opportunitySeen.has(code) || opportunityRows.length >= 5) return;
    opportunitySeen.add(code);
    opportunityRows.push({ ...row, code });
  };
  const pushAnchor = (row) => {
    const code = codeOf(row);
    if (!code || anchorSeen.has(code) || anchorRows.length >= 5) return;
    anchorSeen.add(code);
    anchorRows.push({ ...row, code });
  };

  if (!unified.contractReady) {
    return {
      version: 1,
      status: "unavailable",
      executionOpen: false,
      formalCount: 0,
      rows: [],
      anchorRows: [],
      note: unified.blockers && unified.blockers[0] || "统一决策链待确认，暂不生成重点股票",
      anchorNote: "严格情绪核心证据待确认",
    };
  }

  const evidence = source.emotionCoreEvidence && typeof source.emotionCoreEvidence === "object"
    ? source.emotionCoreEvidence
    : source.tomorrowDecision && source.tomorrowDecision.emotionCoreEvidence
      && typeof source.tomorrowDecision.emotionCoreEvidence === "object"
      ? source.tomorrowDecision.emotionCoreEvidence
      : {};
  const evidenceAligned = Boolean(
    evidence.status === "ready"
    && text(evidence.generationId) === unified.generationId
    && text(evidence.tradingDate) === unified.tradingDate
    && text(evidence.asOf) === unified.asOf,
  );
  if (evidenceAligned) {
    list(evidence.strictEmotionCores).forEach((core) => {
      const code = codeOf(core);
      const candidate = candidateByCode.get(code) || {};
      const leadership = candidate.leadership && typeof candidate.leadership === "object" ? candidate.leadership : {};
      const hardGate = candidate.hardGate && typeof candidate.hardGate === "object" ? candidate.hardGate : {};
      const hardFails = list(hardGate.hardFails).map(text).filter(Boolean);
      const theme = text(core.theme && core.theme.label || candidate.mainConcept || candidate.mainFamily || "题材待确认");
      const stateLabel = decisionFocusStateLabel(core.currentState || core.stateKey || core.stateLabel);
      const identity = text(leadership.identity || ({ primary: "主核心", secondary: "次核心" }[String(core.rank || "").toLowerCase()]) || "严格情绪核心");
      const conclusion = hardGate.pass === true
        ? `个股硬门槛已通过；当前${stateLabel}，但统一交易授权关闭，仅观察不执行`
        : `${hardFails.slice(0, 2).join("；") || "个股执行门槛未完整通过"}；当前不通过`;
      pushAnchor({
        code,
        name: text(core.name || candidate.name || code),
        status: "emotion_anchor",
        statusLabel: "市场情绪锚（不参与机会排名）",
        systemPosition: [theme, identity, stateLabel].filter(Boolean).join(" · "),
        conclusion: `${conclusion}；仅用于判断情绪与题材状态，不参与机会优先级`,
        executable: false,
      });
    });
  }

  list(unified.observationCandidates).forEach((stock) => {
    const tierKey = text(stock.tierKey);
    const carrierFit = stock.carrierFit && typeof stock.carrierFit === "object"
      ? stock.carrierFit
      : {};
    const leadershipQualified = Boolean(
      stock.leadership
      && typeof stock.leadership === "object"
      && stock.leadership.tradeQualified === true
    );
    const expectation = stock.expectation && typeof stock.expectation === "object" ? stock.expectation : {};
    const capitalPreference = stock.capitalPreference && typeof stock.capitalPreference === "object"
      ? stock.capitalPreference
      : {};
    const profitPreference = stock.profitPreference && typeof stock.profitPreference === "object"
      ? stock.profitPreference
      : {};
    const expectationOpportunityQualified = expectation.status === "qualified"
      && capitalPreference.matched !== false
      && profitPreference.matched === true;
    const recoveredLegacyModePending = tierKey === "hard_gate_failed"
      && stock.hardGatePassed === true
      && leadershipQualified
      && carrierFit.eligible !== false;
    const opportunityEligible = expectationOpportunityQualified
      && (tierKey !== "hard_gate_failed" || recoveredLegacyModePending);
    if (!opportunityEligible) return;
    const missing = list(stock.missingConditions).map(text).filter(Boolean);
    const theme = text(stock.theme || stock.mainConcept || "题材待确认");
    const path = text(stock.pathLabel || stock.path || "路径观察");
    const expectationLabel = text(expectation.label || stock.observationReason || "明日预期待确认");
    const capitalLabel = text(capitalPreference.bucketLabel || stock.marketCapFit && stock.marketCapFit.bucketLabel);
    const profitMatched = profitPreference.matched === true || Boolean(path);
    const cancelConditions = list(stock.cancelConditions).map(text).filter(Boolean);
    pushOpportunity({
      ...stock,
      name: text(stock.name || stock.code),
      status: "observation",
      statusLabel: recoveredLegacyModePending
        ? "条件观察·模式待确认"
        : text(stock.tierLabel || "系统观察"),
      systemPosition: [theme, path, capitalLabel ? `资金偏好${capitalLabel}` : ""].filter(Boolean).join(" · "),
      conclusion: [
        `明日预期：${expectationLabel}`,
        profitMatched ? `赚钱效应：${path}` : "",
        missing.length ? `待确认：${missing.slice(0, 2).join("；")}` : "统一交易授权尚未开放",
        cancelConditions.length ? `取消：${cancelConditions[0]}` : "",
      ].filter(Boolean).join("；"),
      executable: false,
    });
  });

  return {
    version: 1,
    status: opportunityRows.length ? "observation" : anchorRows.length ? "anchors_only" : "empty",
    executionOpen: unified.executionOpen,
    formalCount: unified.executionOpen ? unified.stocks.length : 0,
    rows: opportunityRows,
    anchorRows,
    note: opportunityRows.length
      ? "统一链机会观察 · 匹配偏好 · 非买点 · 买点按路径确认"
      : Array.isArray(unified.observationCandidateBlockers) && unified.observationCandidateBlockers.length
        ? unified.observationCandidateBlockers[0]
        : "本代没有同时具备当前环境、权威题材、持续赚钱效应与资金偏好交集的机会观察股",
    anchorNote: anchorRows.length
      ? "市场情绪锚只用于判断情绪和题材强弱，不参与机会排名"
      : "本代没有同代严格情绪核心锚点",
  };
}

function renderDecisionFocusStocksTable(model) {
  const source = model && typeof model === "object" ? model : {};
  const rows = Array.isArray(source.rows) ? source.rows.slice(0, 5) : [];
  const anchorRows = Array.isArray(source.anchorRows) ? source.anchorRows.slice(0, 5) : [];
  const itemText = (value, fallback = "待确认") => String(value == null ? "" : value).trim() || fallback;
  const itemList = (value) => Array.isArray(value) ? value.map((item) => itemText(item, "")).filter(Boolean) : [];
  const compactOpportunityText = (value, type = "") => {
    let result = itemText(value, type === "cancel" ? "预期失效" : "待确认");
    const replacements = [
      [/只在对应市场路径命中后取得条件博弈资格/g, "板块回流时看承接"],
      [/共封装光学\(CPO\)主动核心仍有次日承接或延续预期/g, "CPO主动核心延续"],
      [/CPO主动核心仍有次日承接预期/g, "CPO主动核心延续"],
      [/连板情绪属于当前成立的赚钱效应路径/g, "连板溢价 / 回封"],
      [/未形成明确连板情绪或容量中军属性，先观察承接/g, "确认核心属性"],
      [/仅有观察性题材成员证据；缺少可选股的已核实精确题材归属/g, "核实题材归属"],
      [/均线非多头排列\(5>10>20\)/g, "均线转多头"],
      [/5日线未持续向上/g, "MA5转升"],
      [/上方套牢与筹码压力偏重/g, "化解套牢压力"],
      [/5日均成交额[^；，]*不足5亿/g, "成交额达到5亿"],
      [/持续辨识度尚未验证，开盘快速封板不单独定义核心/g, "确认持续辨识度"],
      [/不属于当前主线方向/g, "确认方向回流"],
      [/没有验证出主动进攻或带动性/g, "确认主动带动"],
      [/只有孤立涨停/g, "孤立上涨"],
      [/容量不跟或首板负反馈扩散/g, "容量不跟 / 负反馈扩散"],
      [/高标A杀/g, "高标A杀"],
      [/回封失败并向中高位扩散/g, "回封失败"],
      [/板块回流且个股重新取得相对强度/g, "板块回流 + 个股转强"],
      [/放量跌破今日低点或结构锚点/g, "放量破位"],
    ];
    replacements.forEach(([pattern, replacement]) => { result = result.replace(pattern, replacement); });
    result = result.replace(/；+/g, " / ").replace(/\s*\/\s*\/\s*/g, " / ").trim();
    const limit = type === "expectation" ? 24 : 30;
    return result.length > limit ? `${result.slice(0, limit)}…` : result;
  };
  const tableBody = (items, emptyText) => items.length ? items.map((row) => `
    <tr data-focus-stock-code="${escapeHtml(row.code || "")}" data-focus-stock-status="${escapeHtml(row.status || "observation")}">
      <td class="direct-focus-stock-name">
        <strong>${escapeHtml(row.name || row.code || "--")}</strong>
        <small>${escapeHtml(row.code || "")}</small>
        <em class="is-${escapeHtml(row.status || "observation")}">${escapeHtml(row.statusLabel || "系统观察")}</em>
      </td>
      <td><p>${escapeHtml(row.systemPosition || "系统定位待确认")}</p></td>
      <td><p>${escapeHtml(row.conclusion || "等待下一代数据重新判断")}</p></td>
    </tr>`).join("") : `<tr class="is-empty"><td colspan="3">${escapeHtml(emptyText)}</td></tr>`;
  const table = (items, emptyText, headings = ["股票", "系统定位", "结论"]) => `
    <div class="direct-focus-table-wrap">
      <table>
        <thead><tr>${headings.map((heading) => `<th>${escapeHtml(heading)}</th>`).join("")}</tr></thead>
        <tbody>${tableBody(items, emptyText)}</tbody>
      </table>
    </div>`;
  const opportunityCards = rows.length ? `
    <div class="direct-opportunity-stock-grid">
      ${rows.map((row, index) => {
        const expectation = row.expectation && typeof row.expectation === "object" ? row.expectation : {};
        const postEntryExpectation = row.postEntryNextDayExpectation
          && typeof row.postEntryNextDayExpectation === "object"
          ? row.postEntryNextDayExpectation : {};
        const entryConfirmation = row.entryConfirmation && typeof row.entryConfirmation === "object"
          ? row.entryConfirmation : {};
        const capital = row.capitalPreference && typeof row.capitalPreference === "object" ? row.capitalPreference : {};
        const profit = row.profitPreference && typeof row.profitPreference === "object" ? row.profitPreference : {};
        const missing = itemList(row.missingConditions).slice(0, 1).map((item) => compactOpportunityText(item, "confirm"));
        const cancels = itemList(row.cancelConditions).slice(0, 1).map((item) => compactOpportunityText(item, "cancel"));
        const expectationLabel = compactOpportunityText(expectation.label || row.observationReason, "expectation");
        const postEntryExpectationLabel = postEntryExpectation.status === "conditional"
          ? compactOpportunityText(postEntryExpectation.label, "post_entry")
          : itemText(postEntryExpectation.label, "不适用（当前无买点）");
        const entryConfirmationLabel = itemText(
          entryConfirmation.label,
          missing.join(" / ") || "当前不可确认",
        );
        const capitalLabel = itemText(capital.bucketLabel || row.marketCapFit && row.marketCapFit.bucketLabel, "市值偏好待确认");
        const profitLabel = itemText(row.pathLabel || row.path || profit.primaryPath, "赚钱效应路径待确认");
        const themeLabel = itemText(row.theme || row.mainConcept, "题材待确认");
        const setupLabel = itemText(row.setupLabel, "");
        return `
          <article class="direct-opportunity-stock-card" data-focus-stock-code="${escapeHtml(row.code || "")}" data-focus-stock-status="observation">
            <header>
              <b>${String(index + 1).padStart(2, "0")}</b>
              <div><strong>${escapeHtml(row.name || row.code || "--")}</strong><small>${escapeHtml(row.code || "")}</small></div>
            </header>
            <div class="direct-opportunity-tags">
              ${setupLabel ? `<span class="is-setup">${escapeHtml(setupLabel)}</span>` : ""}
              <span>${escapeHtml(themeLabel)}</span>
              <span>${escapeHtml(profitLabel)}</span>
              <span>${escapeHtml(capitalLabel)}</span>
            </div>
            <div class="direct-opportunity-summary">
              <p class="is-focus"><span>看点</span><strong>${escapeHtml(expectationLabel)}</strong></p>
              <p class="is-entry-confirmation" data-entry-confirmation="${escapeHtml(entryConfirmation.type || entryConfirmation.status || "unavailable")}"><span>买点确认</span><strong>${escapeHtml(entryConfirmationLabel)}</strong></p>
              <p class="is-next-day" data-post-entry-expectation="${escapeHtml(postEntryExpectation.key || "unavailable")}"><span>买后次日</span><strong>${escapeHtml(postEntryExpectationLabel)}</strong></p>
              <p class="is-cancel"><span>失效</span><strong>${escapeHtml(cancels.join(" / ") || "预期或偏好失效")}</strong></p>
            </div>
          </article>`;
      }).join("")}
    </div>` : `<div class="direct-opportunity-empty">${escapeHtml(source.note || "本代没有形成机会观察股")}</div>`;
  const opportunityHeaderNote = rows.length
    ? source.note || "系统自动判断，最多展示5只"
    : "5只是上限，只展示通过全部观察门槛的股票";
  const opportunitySection = `
    <section class="direct-focus-stocks is-opportunity" data-decision-focus-stocks data-focus-kind="opportunity" data-focus-source="unifiedDecisionChain.observationCandidates" data-focus-count="${rows.length}" data-focus-status="${escapeHtml(source.status || "empty")}">
      <header>
        <div><span>系统机会观察</span><strong>机会观察股${rows.length ? ` · ${rows.length}只` : ""}</strong></div>
        <small>${escapeHtml(opportunityHeaderNote)}</small>
      </header>
      ${opportunityCards}
    </section>`;
  const anchorSection = anchorRows.length ? `
    <section class="direct-focus-stocks is-emotion-anchor" data-decision-focus-anchors data-focus-kind="emotion-anchor" data-focus-ranking="excluded">
      <header>
        <div><span>独立市场证据</span><strong>市场情绪锚（不参与机会排名）</strong></div>
        <small>${escapeHtml(source.anchorNote || "只作市场观察，不参与机会排序")}</small>
      </header>
      ${table(anchorRows, source.anchorNote || "本代没有严格情绪核心")}
    </section>` : "";
  return `${opportunitySection}${anchorSection}`;
}

function renderDecisionDirectSummary(summary) {
  const forecast = summary && summary.forecast && typeof summary.forecast === "object" ? summary.forecast : null;
  const tomorrowBaseline = summary && summary.tomorrowBaseline && typeof summary.tomorrowBaseline === "object"
    ? summary.tomorrowBaseline
    : null;
  const confidence = forecast && forecast.confidence && typeof forecast.confidence === "object" ? forecast.confidence : {};
  const scenarios = forecast && Array.isArray(forecast.scenarios) ? forecast.scenarios : [];
  const indexOutlook = forecast && forecast.indexOutlook && typeof forecast.indexOutlook === "object"
    ? forecast.indexOutlook
    : null;
  const profitEffectOutlook = forecast && forecast.profitEffectOutlook && typeof forecast.profitEffectOutlook === "object"
    ? forecast.profitEffectOutlook
    : null;
  const scenarioTone = { strengthen: "good", range_divergence: "warn", weaken: "bad" };
  const indexScenarioTone = { repair_up: "good", range: "warn", weak_close: "bad" };
  const profitScenarioTone = { strengthen: "good", healthy_divergence: "warn", negative_feedback: "bad" };
  const riskDefaultBaseline = tomorrowBaseline && (
    tomorrowBaseline.riskDefault === true || tomorrowBaseline.status === "risk_default"
  );
  const baselineCheckpoints = tomorrowBaseline && Array.isArray(tomorrowBaseline.checkpoints)
    ? tomorrowBaseline.checkpoints.filter(Boolean).join("/")
    : "09:25/09:35";
  const baselineEvidenceGaps = tomorrowBaseline && Array.isArray(tomorrowBaseline.evidenceGaps)
    ? tomorrowBaseline.evidenceGaps.map(String).filter(Boolean)
    : [];
  const baselineExcludedEvidence = tomorrowBaseline && Array.isArray(tomorrowBaseline.excludedEvidence)
    ? tomorrowBaseline.excludedEvidence.map(String).filter(Boolean)
    : [];
  const baselineConfirmationConditions = tomorrowBaseline && Array.isArray(tomorrowBaseline.confirmationConditions)
    ? tomorrowBaseline.confirmationConditions.map(String).filter(Boolean)
    : [];
  const confidenceMeta = confidence.calibrated
    ? `已校准 · ${confidence.label || "置信待确认"}`
    : [
      confidence.coveragePct === null ? "证据覆盖待确认" : `证据覆盖 ${confidence.coveragePct}%`,
      confidence.label || "规则判断置信待计算",
      "非胜率",
    ].join(" · ");
  const baselineEvidenceHtml = riskDefaultBaseline ? `
    <div class="direct-evidence-diagnosis">
      <p><b>缺少什么</b><span>${escapeHtml(baselineEvidenceGaps.join("；") || tomorrowBaseline.reason || "严格阶段证据缺口尚未定位")}</span></p>
      ${baselineExcludedEvidence.length ? `<p><b>为何不能补位</b><span>${escapeHtml(baselineExcludedEvidence.join("；"))}</span></p>` : ""}
      ${baselineConfirmationConditions.length ? `<p><b>确认条件</b><span>${escapeHtml(baselineConfirmationConditions.join("；"))}</span></p>` : ""}
    </div>` : "";
  const baselineHtml = tomorrowBaseline && ["baseline_unconfirmed", "risk_default"].includes(tomorrowBaseline.status) ? `
    <section class="direct-forecast-card is-baseline-unconfirmed${riskDefaultBaseline ? " is-risk-default" : ""}">
      <header>
        <div><span>明日基准</span><strong>${escapeHtml(tomorrowBaseline.label || "待确认")}</strong></div>
        <em>${escapeHtml(riskDefaultBaseline ? "风险默认 · 非市场阶段" : "规则基准 · 尚未做历史胜率校准")}</em>
      </header>
      <p>${riskDefaultBaseline
        ? `${escapeHtml(tomorrowBaseline.action || "暂不新开仓")}；${escapeHtml(baselineCheckpoints)}再验证。此项只限制执行，不代表已判断市场阶段。`
        : "这是当前证据下的第一顺位准备路径，盘前与开盘后仍需按承接、负反馈和核心主动性更新。"}</p>
      ${baselineEvidenceHtml}
    </section>` : "";
  const indexOutlookHtml = indexOutlook ? `
    <section class="direct-forecast-card is-index-outlook" data-outlook-axis="index">
      <header>
        <div><span>明日指数路径</span><strong>${escapeHtml(indexOutlook.primary && indexOutlook.primary.label || "指数路径待确认")}</strong></div>
        <em>${escapeHtml(indexOutlook.available
          ? `独立指数模型 · 证据覆盖${indexOutlook.coveragePct == null ? "待确认" : `${indexOutlook.coveragePct}%`} · 规则权重非概率`
          : "关键指数证据不足 · 已失败关闭")}</em>
      </header>
      ${indexOutlook.available ? `<div class="direct-probability-grid">
        ${indexOutlook.scenarios.map((scenario) => {
          const value = Number.isFinite(Number(scenario.value)) ? Number(scenario.value) : null;
          const active = scenario.key === indexOutlook.primaryKey;
          return `<div class="is-${indexScenarioTone[scenario.key] || "neutral"}${active ? " is-primary" : ""}"><span>${escapeHtml(scenario.label || "情景")}</span><b>${value === null ? "--" : `权重${escapeHtml(String(value))}`}</b><i><u style="width:${value === null ? 0 : Math.max(0, Math.min(100, value))}%"></u></i></div>`;
        }).join("")}
      </div>` : ""}
      <p>${escapeHtml(indexOutlook.available
        ? indexOutlook.riskContext && indexOutlook.riskContext.note || "大周期只约束风险与仓位，不直接决定次日指数方向。"
        : `缺少：${indexOutlook.missingFields.join("、") || "关键指数收盘证据"}`)}</p>
    </section>` : "";
  const profitEffectOutlookHtml = profitEffectOutlook ? `
    <section class="direct-forecast-card is-profit-effect-outlook" data-outlook-axis="profit-effect">
      <header>
        <div><span>明日赚钱效应</span><strong>${escapeHtml(profitEffectOutlook.primary && profitEffectOutlook.primary.label || "赚钱效应路径待确认")}</strong></div>
        <em>${escapeHtml(profitEffectOutlook.available
          ? `独立赚钱效应模型 · 证据覆盖${profitEffectOutlook.coveragePct == null ? "待确认" : `${profitEffectOutlook.coveragePct}%`} · 规则权重非概率`
          : "关键赚钱效应证据不足 · 已失败关闭")}</em>
      </header>
      ${profitEffectOutlook.available ? `<div class="direct-probability-grid">
        ${profitEffectOutlook.scenarios.map((scenario) => {
          const value = Number.isFinite(Number(scenario.value)) ? Number(scenario.value) : null;
          const active = scenario.key === profitEffectOutlook.primaryKey;
          return `<div class="is-${profitScenarioTone[scenario.key] || "neutral"}${active ? " is-primary" : ""}"><span>${escapeHtml(scenario.label || "情景")}</span><b>${value === null ? "--" : `权重${escapeHtml(String(value))}`}</b><i><u style="width:${value === null ? 0 : Math.max(0, Math.min(100, value))}%"></u></i></div>`;
        }).join("")}
      </div>` : ""}
      <p>${escapeHtml(profitEffectOutlook.available
        ? profitEffectOutlook.notes.find((note) => /大周期|指数/.test(note)) || "本轴只读取赚钱/亏钱效应、市场宽度、涨跌停、成交承接与canonical情绪，不由指数涨跌代替。"
        : `缺少：${profitEffectOutlook.missingFields.join("、") || "关键赚钱效应收盘证据"}`)}</p>
    </section>` : "";
  const legacyPathForecastHtml = forecast && !profitEffectOutlook ? `
    <section class="direct-forecast-card">
      <header>
        <div><span>旧版综合路径</span><strong>${riskDefaultBaseline
          ? "严格阶段待确认，暂无概率判断"
          : `${escapeHtml(forecast.primaryScenario && forecast.primaryScenario.label || "待确认")}${forecast.available && forecast.primaryScenario ? ` ${escapeHtml(String(forecast.primaryScenario.probability))}%` : ""}`}</strong></div>
        <em>${escapeHtml(`历史兼容 · 尚未拆分指数与赚钱效应 · ${confidenceMeta}`)}</em>
      </header>
      ${riskDefaultBaseline ? "" : `<div class="direct-probability-grid">
        ${scenarios.map((scenario) => {
          const probability = forecast.available && Number.isFinite(Number(scenario.probability)) ? Number(scenario.probability) : null;
          const active = scenario.key === forecast.primaryScenarioKey;
          return `<div class="is-${scenarioTone[scenario.key] || "neutral"}${active ? " is-primary" : ""}"><span>${escapeHtml(scenario.label || "情景")}</span><b>${probability === null ? "--" : `${escapeHtml(String(probability))}%`}</b><i><u style="width:${probability === null ? 0 : Math.max(0, Math.min(100, probability))}%"></u></i></div>`;
        }).join("")}
      </div>`}
      ${riskDefaultBaseline
        ? `<p>未输出百分比：${escapeHtml(baselineEvidenceGaps.join("；") || "严格阶段证据缺口尚未定位")}。规则情景只保留为后台排序，不在主决策区输出百分比；执行以上方防守基准为准。</p>`
        : forecast.available ? "" : `<p>旧快照没有完整概率契约，本页不会补造百分比。</p>`}
    </section>` : "";
  const forecastHtml = `${baselineHtml}${indexOutlookHtml}${profitEffectOutlookHtml}${legacyPathForecastHtml}`;
  const state = summary && summary.state && typeof summary.state === "object" ? summary.state : null;
  const compactStageValue = (value, fallback = "待确认") => {
    const cleaned = String(value || "").trim()
      .replace(/^[·\s]+|[·\s]+$/g, "")
      .replace(/·?不改写大周期/g, "")
      .replace(/·?暂无主升细分/g, "")
      .replace(/过渡(?=修复|反弹|观察)/g, "");
    return cleaned || fallback;
  };
  const stageSummaryItems = [
    { key: "big-cycle", label: "5日情绪大周期", value: compactStageValue(state && (state.bigCycle || state.cycle)) },
    { key: "transition", label: "过渡节点", value: compactStageValue(state && state.transition, "无周期切换") },
    { key: "small-cycle", label: "小周期", value: compactStageValue(state && state.smallCycle) },
    { key: "index-short-structure", label: "指数5日结构", value: compactStageValue(state && state.indexShortStructure) },
    { key: "emotion", label: "情绪阶段", value: compactStageValue(state && (state.emotionStage || state.corePhase)) },
  ];
  const stageSummaryHtml = `
    <div class="direct-stage-summary-grid" aria-label="今日市场阶段" title="${escapeHtml(summary && summary.todayTitle || "今日阶段待确认")}">
      ${stageSummaryItems.map((item) => `<div data-stage-summary="${escapeHtml(item.key)}"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join("")}
    </div>`;
  const bigCycleWindow = state && state.bigCycleWindow && typeof state.bigCycleWindow === "object"
    ? state.bigCycleWindow : null;
  const bigCycleWindowRows = bigCycleWindow && Array.isArray(bigCycleWindow.observations)
    ? bigCycleWindow.observations.filter(Boolean) : [];
  const bigCycleWindowDates = bigCycleWindowRows
    .map((item) => String(item && item.tradingDate || "").trim())
    .filter(Boolean);
  const bigCycleEvidence = state && Array.isArray(state.bigCycleEvidence)
    ? state.bigCycleEvidence.filter(Boolean).slice(0, 5) : [];
  const bigCycleReasonHtml = state ? `
    <section class="direct-speculation-context direct-big-cycle-evidence" data-big-cycle-window="${escapeHtml(String(state.bigCycleWindowDays || 0))}">
      <header><span>5日周期依据</span><small>${escapeHtml(bigCycleWindowDates.length
        ? `${bigCycleWindowDates[0]} 至 ${bigCycleWindowDates.at(-1)} · ${state.bigCycleCalibrated ? "已校准" : "未历史校准"}`
        : "窗口证据待确认")}</small></header>
      <p><b>${escapeHtml(state.bigCycle || state.cycle || "大周期待确认")}</b><span>${escapeHtml(state.bigCycleReason || "五日证据尚未完成确认。")}</span></p>
      ${bigCycleEvidence.length ? `<details><summary>查看5日证据</summary><p>${escapeHtml(bigCycleEvidence.join("；"))}</p></details>` : ""}
    </section>` : "";
  const unifiedPreference = summary && summary.unifiedPreference
    ? summary.unifiedPreference
    : null;
  const unifiedPreferenceHtml = unifiedPreference ? `
    <section class="direct-speculation-context" data-preference-mode="macro_micro_overlay">
      <header><span>统一炒作偏好</span><small>宏观旧模型 + 微观新模型并列使用</small></header>
      <div class="direct-speculation-tags">
        <span class="is-observed">宏观：${escapeHtml(unifiedPreference.macro && unifiedPreference.macro.label || "待确认")}<small>板块轮动 / 聚焦结构</small></span>
        <span class="is-observed">微观：${escapeHtml(unifiedPreference.micro && unifiedPreference.micro.label || "待确认")}<small>低位启动 / 高位趋势等路径</small></span>
      </div>
      <p><b>组合规则</b><span>${escapeHtml(unifiedPreference.combined && unifiedPreference.combined.rule || "宏观判断市场如何组织，微观判断资金通过哪类股票表达；两者不互相覆盖。")}</span></p>
    </section>` : "";
  const tradingPreference = state && Array.isArray(state.tradingPreference)
    ? Array.from(new Set(state.tradingPreference.map((item) => String(item || "").trim()).filter(Boolean)))
    : [];
  const confirmedTradingPreference = new Set(state && Array.isArray(state.confirmedTradingPreference)
    ? state.confirmedTradingPreference.map((item) => String(item || "").trim()).filter(Boolean)
    : []);
  const tradingPreferenceItems = state && Array.isArray(state.tradingPreferenceItems)
    ? state.tradingPreferenceItems.filter((item) => item && item.label)
    : [];
  const preferenceItemByLabel = new Map(tradingPreferenceItems.map((item) => [String(item.label), item]));
  const preferenceGaps = state && Array.isArray(state.preferenceGaps)
    ? state.preferenceGaps.map(String).filter(Boolean)
    : [];
  const preferenceConfirmationConditions = state && Array.isArray(state.preferenceConfirmationConditions)
    ? state.preferenceConfirmationConditions.map(String).filter(Boolean)
    : [];
  const preferenceStatus = String(state && state.preferenceStatus || "unavailable");
  const preferenceHeaderNote = tradingPreference.length
    ? confirmedTradingPreference.size
      ? `已确认${confirmedTradingPreference.size}项 · 其余为观察 · 不改变交易权限`
      : "只有候选观察 · 尚无确认主导 · 不改变交易权限"
    : "本代偏好结论未生成 · 不改变交易权限";
  const preferenceDetailHtml = state ? `
    <section class="direct-speculation-context" data-observation-only="${state.preferenceObservationOnly !== false ? "true" : "false"}" data-preference-status="${escapeHtml(preferenceStatus)}">
      <header><span>当下炒作偏好</span><small>${escapeHtml(preferenceHeaderNote)}</small></header>
      <div class="direct-speculation-tags">${tradingPreference.length
        ? tradingPreference.map((label) => {
          const item = preferenceItemByLabel.get(label) || {};
          const metric = item.score !== null && item.score !== undefined
            ? `${item.score}分`
            : item.count !== null && item.count !== undefined ? `${item.count}只` : "";
          const stateLabel = confirmedTradingPreference.has(label) ? "主导" : "观察";
          return `<span class="${confirmedTradingPreference.has(label) ? "is-confirmed" : "is-observed"}">${escapeHtml(label)}<small>${escapeHtml(metric ? `${stateLabel} · ${metric}` : stateLabel)}</small></span>`;
        }).join("")
        : '<span class="is-unavailable">本代偏好结论未生成</span>'}</div>
      <p><b>${tradingPreference.length ? "偏好原因" : "未确认原因"}</b><span>${escapeHtml(state.preferenceReason || "本次明日决策没有生成同代炒作偏好观察数据。")}</span></p>
      ${preferenceGaps.length ? `<p><b>${tradingPreference.length ? "仍待确认" : "具体缺口"}</b><span>${escapeHtml(preferenceGaps.join("；"))}</span></p>` : ""}
      ${preferenceConfirmationConditions.length ? `<p><b>确认条件</b><span>${escapeHtml(preferenceConfirmationConditions.join("；"))}</span></p>` : ""}
    </section>` : "";
  const preferenceHtml = `${unifiedPreferenceHtml}${preferenceDetailHtml}`;
  const marketCapCarrier = state && state.marketCapCarrier && typeof state.marketCapCarrier === "object"
    ? state.marketCapCarrier
    : null;
  const marketCapCarrierMetrics = marketCapCarrier ? [
    marketCapCarrier.marketAmountYi === null ? "成交额缺失" : `两市${marketCapCarrier.marketAmountYi}亿`,
    marketCapCarrier.breadthPct === null ? "上涨占比缺失" : `上涨占比${marketCapCarrier.breadthPct}%`,
    marketCapCarrier.avgIndexChange === null
      ? "指数方向缺失"
      : `指数均值${marketCapCarrier.avgIndexChange > 0 ? "+" : ""}${marketCapCarrier.avgIndexChange}%`,
  ] : [];
  const marketCapCarrierConfirmation = marketCapCarrier && Array.isArray(marketCapCarrier.confirmation)
    ? marketCapCarrier.confirmation.filter(Boolean)
    : [];
  const marketCapCoverage = marketCapCarrier && marketCapCarrier.coverage && typeof marketCapCarrier.coverage === "object"
    ? marketCapCarrier.coverage
    : null;
  const marketCapEvidence = marketCapCarrier && Array.isArray(marketCapCarrier.evidence)
    ? marketCapCarrier.evidence[0]
    : null;
  const marketCapSampleText = marketCapCoverage
    ? `可用${marketCapCoverage.usableSampleCount ?? "--"}/${marketCapCoverage.candidateCount ?? "--"}只 · 覆盖${marketCapCoverage.usablePct ?? "--"}%`
    : "样本覆盖待确认";
  const marketCapComparisonText = marketCapEvidence && marketCapEvidence.preferredMetrics && marketCapEvidence.otherMetrics
    ? `优先侧上涨率${marketCapEvidence.preferredMetrics.positiveRatePct ?? "--"}%、中位涨幅${marketCapEvidence.preferredMetrics.medianChangePct ?? "--"}%；其他侧上涨率${marketCapEvidence.otherMetrics.positiveRatePct ?? "--"}%、中位涨幅${marketCapEvidence.otherMetrics.medianChangePct ?? "--"}%`
    : "市值桶表现差异待确认";
  const marketCapStatusText = marketCapCarrier && marketCapCarrier.status === "confirmed"
    ? "机会准入已启用"
    : marketCapCarrier && ["mixed", "observed"].includes(marketCapCarrier.status) ? "仅软提示" : "证据不足";
  const marketCapStatusClass = marketCapCarrier && marketCapCarrier.status === "confirmed"
    ? "is-confirmed"
    : marketCapCarrier && ["mixed", "observed"].includes(marketCapCarrier.status) ? "is-observed" : "is-unavailable";
  const marketCapCarrierHtml = marketCapCarrier ? `
    <section class="direct-speculation-context direct-market-cap-carrier" data-observation-only="true" data-carrier-regime="${escapeHtml(marketCapCarrier.key || "unknown")}">
      <header><span>动态市值赚钱效应</span><small>只约束机会候选 · 不打开交易权限 · 未历史校准</small></header>
      <div class="direct-speculation-tags">
        <span class="${marketCapStatusClass}">${escapeHtml(marketCapCarrier.label || "市值载体待确认")}<small>${escapeHtml(marketCapStatusText)}</small></span>
        <span class="${marketCapCarrier.status === "confirmed" ? "is-confirmed" : "is-observed"}">${escapeHtml(marketCapCarrier.carrierLabel || "市值偏好待确认")}<small>总市值主口径</small></span>
      </div>
      <p><b>市场证据</b><span>${escapeHtml(marketCapCarrierMetrics.join(" · "))}</span></p>
      <p><b>候选样本</b><span>${escapeHtml(`${marketCapSampleText}；${marketCapComparisonText}`)}</span></p>
      <p><b>判断边界</b><span>${escapeHtml(marketCapCarrier.reason || "缺少成交质量证据，不推断市值偏好。")}</span></p>
      ${marketCapCarrierConfirmation.length ? `<p><b>后续确认</b><span>${escapeHtml(marketCapCarrierConfirmation.join("；"))}</span></p>` : ""}
    </section>` : "";
  const heightConsensus = state && Array.isArray(state.heightConsensus) ? state.heightConsensus : [];
  const tradableCoreEvidence = state && Array.isArray(state.tradableCoreEvidence) ? state.tradableCoreEvidence : [];
  const emotionCoreEvidence = state && state.emotionCoreEvidence && typeof state.emotionCoreEvidence === "object"
    ? state.emotionCoreEvidence
    : null;
  const emotionPathHtml = typeof renderEmotionStagePath === "function"
    ? renderEmotionStagePath(state && state.emotionPath)
    : "";
  const emotionEvidenceGaps = state && Array.isArray(state.strictEvidenceGaps)
    ? state.strictEvidenceGaps.map(String).filter(Boolean)
    : [];
  const emotionEvidenceExcluded = state && Array.isArray(state.strictEvidenceExcluded)
    ? state.strictEvidenceExcluded.map(String).filter(Boolean)
    : [];
  const emotionEvidenceConditions = state && Array.isArray(state.strictEvidenceConfirmationConditions)
    ? state.strictEvidenceConfirmationConditions.map(String).filter(Boolean)
    : [];
  const emotionEvidenceGapText = emotionEvidenceGaps.join("；");
  const emotionEvidenceGapHeading = /缺少|不可用|未来日期|隔离/.test(emotionEvidenceGapText)
    ? "缺少什么"
    : /资格结果为空|为0只/.test(emotionEvidenceGapText)
      ? "当前资格结果"
      : "为何未形成多数";
  const emotionUnavailableHtml = state
    && state.strictEmotionStageStatus === "unavailable"
    && String(state.strictEmotionStageReason || state.emotionStageReason || "").trim()
    ? `<section class="direct-evidence-gap-panel">
        <header><strong>严格情绪阶段为何未确认</strong><span>观察层可以描述节奏，但不会替代严格阶段</span></header>
        <div><b>${escapeHtml(emotionEvidenceGapHeading)}</b><ul>${(emotionEvidenceGaps.length ? emotionEvidenceGaps : [state.strictEmotionStageReason || state.emotionStageReason]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
        ${emotionEvidenceExcluded.length ? `<div><b>未计入阶段投票</b><ul>${emotionEvidenceExcluded.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
        ${emotionEvidenceConditions.length ? `<div><b>确认条件</b><ul>${emotionEvidenceConditions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
      </section>`
    : "";
  const emotionEvidenceRows = (rows) => rows.map((item) => `
    <article>
      <div><strong>${escapeHtml(item && item.name || "--")}</strong>${item && item.code ? `<small>${escapeHtml(item.code)}</small>` : ""}</div>
      <mark>${escapeHtml(item && item.direction || "题材待确认")} · ${escapeHtml(item && item.role || "角色待确认")}</mark>
      <p>${escapeHtml(item && item.event || "状态待确认")}</p>
      <span>${escapeHtml(item && item.detail || "具体分时细节待确认")}</span>
    </article>`).join("");
  const legacyEmotionEvidenceHtml = `
    <div class="direct-emotion-evidence-grid">
      <section class="is-consensus">
        <header><strong>高度与一致度</strong><span>一字高标只说明市场高度，不代表能参与</span></header>
        ${heightConsensus.length
          ? `<div>${emotionEvidenceRows(heightConsensus)}</div>`
          : '<p class="direct-emotion-evidence-empty">暂时没有同一批数据确认的一字高标。</p>'}
      </section>
      <section class="is-tradable">
      <header><strong>换手核心观察证据</strong><span>有真实换手、可检验承接；不代表交易许可</span></header>
        ${tradableCoreEvidence.length
          ? `<div>${emotionEvidenceRows(tradableCoreEvidence)}</div>`
          : '<p class="direct-emotion-evidence-empty">换手核心的分时证据仍待确认，不用一字高标补位。</p>'}
      </section>
    </div>`;
  const strictCoreStateLabel = (value) => {
    const key = String(value || "").toLowerCase();
    if (/support|承接|local_repair|divergence_supported/.test(key)) return "承接";
    if (/repair_failed|negative_feedback|修复失败|负反馈/.test(key)) return "负反馈 / 修复失败";
    if (/diverg|分歧/.test(key)) return "分歧";
    if (/participat|normal_participation|正常参与/.test(key)) return "周期内平稳运行";
    if (/consensus|一致/.test(key)) return "一致";
    return value && value !== "unknown" ? String(value) : "待确认";
  };
  const strictCoreRankLabel = (item) => ({
    primary_leader: "题材主龙头",
    risk_core: "风险情绪核心",
    capacity_core: "容量情绪核心",
    height_core: "高度情绪核心",
    repair_core: "修复情绪核心",
    co_core: "共同情绪核心",
  }[String(item && item.voteRole || "").toLowerCase()]
    || ({ primary: "题材主龙头", co_core: "共同情绪核心", secondary: "共同情绪核心" }[String(item && item.rank || "").toLowerCase()])
    || "市场情绪核心");
  const strictCoreCards = (rows, risk = false) => rows.map((item) => {
    const evidence = Array.isArray(item && item.evidence)
      ? item.evidence.filter(Boolean).map((entry) => String(entry)
        .replaceAll("正常参与", "周期内平稳运行")
        .replaceAll("可参与核心", "换手核心"))
      : [];
    const supportScore = Number.isFinite(Number(item && item.supportScore)) ? String(Number(item.supportScore)) : "--";
    const damageScore = Number.isFinite(Number(item && item.damageScore)) ? String(Number(item.damageScore)) : "--";
    const positiveInfluence = Number.isFinite(Number(item && item.positiveInfluenceScore)) ? String(Number(item.positiveInfluenceScore)) : "--";
    const negativeInfluence = Number.isFinite(Number(item && item.negativeInfluenceScore)) ? String(Number(item.negativeInfluenceScore)) : "--";
    const signedInfluence = Number.isFinite(Number(item && item.signedInfluenceScore))
      ? `${Number(item.signedInfluenceScore) > 0 ? "+" : ""}${Number(item.signedInfluenceScore)}` : "--";
    const riskPressure = Number.isFinite(Number(item && item.riskPressureScore)) ? String(Number(item.riskPressureScore)) : null;
    const riskPressureNote = item && item.voteRole === "risk_core" && riskPressure !== null
      ? `<span>风险压力：<b>${escapeHtml(riskPressure)}</b>（${item.riskPressureConfirmed === true ? "负反馈已确认" : "仅预警，负反馈未确认"}）</span>`
      : "";
    const sourceMeta = item && (item.identitySource || item.sessionSource)
      ? `${item.identitySource ? `<span>身份来源：${escapeHtml(item.identitySource)}</span>` : ""}${item.sessionSource ? `<span>收盘来源：${escapeHtml(item.sessionSource)}</span>` : ""}`
      : `<span>来源：${escapeHtml(item && item.source || "unknown")}</span>`;
    const sourceTimeMeta = `<span>契约时间：${escapeHtml(item && item.contractAsOf || "待确认")}</span><span>${item && item.identitySourceAsOf ? `身份来源时间：${escapeHtml(item.identitySourceAsOf)}` : "身份来源时间待确认"}</span><span>${item && item.sessionSourceAsOf ? `收盘来源时间：${escapeHtml(item.sessionSourceAsOf)}` : "收盘来源时间待确认"}</span>`;
    return `
      <article class="direct-core-evidence-card${risk ? " is-risk" : " is-strict"}">
        <header><div><strong>${escapeHtml(item && item.name || "--")}</strong><small>${escapeHtml(item && item.code || "")}</small></div><em>${escapeHtml(risk ? "负反馈观察 · 非推荐" : strictCoreRankLabel(item))}</em></header>
        <mark>${escapeHtml(item && item.theme && item.theme.label || "题材待确认")}</mark>
        <div class="direct-core-evidence-metrics"><span>状态：<b>${escapeHtml(strictCoreStateLabel(item && item.currentState))}</b></span>${risk ? `<span>承接：<b>${escapeHtml(supportScore)}</b></span><span>伤害：<b>${escapeHtml(damageScore)}</b></span>` : `<span>正面影响：<b>${escapeHtml(positiveInfluence)}</b></span><span>负面影响：<b>${escapeHtml(negativeInfluence)}</b></span><span>净影响：<b>${escapeHtml(signedInfluence)}</b></span>${riskPressureNote}`}</div>
        <p>${evidence.length ? `证据：${escapeHtml(evidence.join("；"))}` : "证据：待补充"}</p>
        <footer>${sourceMeta}<span>数据：${escapeHtml(item && item.dataQuality || "待确认")}</span>${sourceTimeMeta}</footer>
      </article>`;
  }).join("");
  const emotionCoreEvidenceHtml = emotionCoreEvidence && emotionCoreEvidence.status === "ready" ? (() => {
    const strictRows = Array.isArray(emotionCoreEvidence.strictEmotionCores) ? emotionCoreEvidence.strictEmotionCores : [];
    const riskRows = Array.isArray(emotionCoreEvidence.heightRiskBarometers) ? emotionCoreEvidence.heightRiskBarometers : [];
    const themeCycles = Array.isArray(emotionCoreEvidence.themeCycles) ? emotionCoreEvidence.themeCycles : [];
    const transition = emotionCoreEvidence.transition && typeof emotionCoreEvidence.transition === "object"
      ? emotionCoreEvidence.transition
      : { status: "unavailable", label: "跨日阶段待同版本T-1收盘证据" };
    const coreSummary = emotionCoreEvidence.summary && typeof emotionCoreEvidence.summary === "object" ? emotionCoreEvidence.summary : {};
    const divergent = coreSummary.divergent && typeof coreSummary.divergent === "object" ? coreSummary.divergent : { count: 0, names: [] };
    const supported = coreSummary.supported && typeof coreSummary.supported === "object" ? coreSummary.supported : { count: 0, names: [] };
    const repairFailed = coreSummary.repairFailed && typeof coreSummary.repairFailed === "object" ? coreSummary.repairFailed : { count: 0, names: [] };
    const participating = coreSummary.participating && typeof coreSummary.participating === "object" ? coreSummary.participating : { count: 0, names: [] };
    const divergentNames = Array.isArray(divergent.names) && divergent.names.length ? divergent.names.join("、") : "无";
    const supportedNames = Array.isArray(supported.names) && supported.names.length ? supported.names.join("、") : "无";
    const repairFailedNames = Array.isArray(repairFailed.names) && repairFailed.names.length ? repairFailed.names.join("、") : "无";
    const participatingNames = Array.isArray(participating.names) && participating.names.length ? participating.names.join("、") : "无";
    const strictNames = strictRows.length ? strictRows.map((row) => row.name).filter(Boolean).join("、") : "市场情绪核心待确认";
    const influence = coreSummary.influence && typeof coreSummary.influence === "object" ? coreSummary.influence : {};
    const influenceWinnerLabel = ({ positive: "正面影响占优", negative: "负面影响占优", mixed: "正负影响均衡" })[String(influence.winner || "mixed")] || "影响待确认";
    const candidateCount = Number(coreSummary.strictCandidateCount || strictRows.length);
    const adverseStrictCoreCount = Number(divergent.count || 0) + Number(repairFailed.count || 0);
    const stageEvidenceGap = /强分歧/.test(String(state && state.corePhase || "")) && adverseStrictCoreCount < 2;
    const themeCycleHtml = themeCycles.length
      ? themeCycles.map((group) => `<span><b>${escapeHtml(group.label || "细分题材待核实")}</b><small>${escapeHtml(group.cycleLabel || "周期状态待确认")}</small></span>`).join("")
      : '<span><b>细分题材待核实</b><small>未用个股主概念补位</small></span>';
    return `
      <div class="direct-core-evidence-board">
        <p class="direct-core-audit-boundary"><strong>审计层，尚未接管上方情绪阶段/交易权限</strong>${stageEvidenceGap ? '<span>旧阶段口径与严格核心证据存在差异，下一阶段校准；当前不据此开仓。</span>' : ""}</p>
        <section class="direct-current-theme-cycles">
          <header><strong>当前市场周期 → 当前炒作题材周期 → 市场情绪核心</strong><span>题材唯一主龙头与市场多核心分开识别</span></header>
          <div><span class="is-market"><b>${escapeHtml(state && state.cycle || "市场周期待确认")}</b><small>当前市场周期</small></span><i>→</i><div>${themeCycleHtml}</div><i>→</i><span class="is-core"><b>${escapeHtml(strictNames)}</b><small>最多5只市场情绪核心</small></span></div>
          <p class="direct-core-transition${transition.status === "ready" ? " is-ready" : " is-unavailable"}">${escapeHtml(transition.label || "跨日阶段待同版本T-1收盘证据")}</p>
        </section>
        <section class="direct-core-evidence-pool is-strict">
          <header><div><strong>市场情绪核心（最多5只）</strong><span>主龙头、高度、容量、修复和风险核心可并存；只影响情绪，不等于机会股</span></div><em>${escapeHtml(String(strictRows.length))}/${escapeHtml(String(candidateCount))}只</em></header>
          <p class="direct-core-evidence-summary"><strong>规则影响：正面${escapeHtml(String(influence.positiveTotal ?? "--"))}</strong><strong>负面${escapeHtml(String(influence.negativeTotal ?? "--"))}</strong><strong>净影响${escapeHtml(String(influence.signedTotal ?? "--"))}</strong><strong>${escapeHtml(influenceWinnerLabel)} · 非概率</strong></p>
          <p class="direct-core-evidence-summary"><strong>${escapeHtml(String(divergent.count || 0))}只分歧：${escapeHtml(divergentNames)}</strong><strong>${escapeHtml(String(supported.count || 0))}只承接：${escapeHtml(supportedNames)}</strong><strong>${escapeHtml(String(repairFailed.count || 0))}只修复失败：${escapeHtml(repairFailedNames)}</strong><strong>${escapeHtml(String(participating.count || 0))}只平稳运行：${escapeHtml(participatingNames)}</strong></p>
          <div class="direct-core-evidence-cards">${strictRows.length ? strictCoreCards(strictRows) : '<p class="direct-emotion-evidence-empty">本代数据没有通过跨日身份与完整收盘校验的市场情绪核心。</p>'}</div>
        </section>
        <section class="direct-core-evidence-pool is-risk">
          <header><div><strong>高位负反馈观察（非机会）</strong><span>仅用于观察负反馈；非推荐、非机会，投票权重0，不参与周期、排名或交易资格</span></div><em>${escapeHtml(String(riskRows.length))}只</em></header>
          <div class="direct-core-evidence-cards">${riskRows.length ? strictCoreCards(riskRows, true) : '<p class="direct-emotion-evidence-empty">本代数据没有需单列的高位负反馈观察票。</p>'}</div>
        </section>
      </div>`;
  })() : `
    <div class="direct-core-evidence-unavailable"><strong>严格核心证据暂不可用</strong><span>${escapeHtml(emotionCoreEvidence && emotionCoreEvidence.reason || "新契约尚未生成")}</span><small>跨日阶段待同版本T-1收盘证据</small></div>
    ${legacyEmotionEvidenceHtml}`;
  const stateHtml = state ? `
    <section class="direct-canonical-state" data-canonical-generation="${escapeHtml(state.generationId || "unknown")}">
      <div class="direct-state-grid">
        <div data-state-card="structure-detail"><span>结构细分</span><strong>${escapeHtml(state.indexSubPhase || "待确认")}</strong></div>
        <div data-state-card="emotion-stage"><span>情绪阶段<small class="direct-state-label-note">阶段、强度、质量分开判定</small></span><strong>${escapeHtml(state.emotionStage || state.corePhase || "待确认")}</strong><small>强度：${escapeHtml(state.divergenceIntensity || "待确认")} · 质量：${escapeHtml(state.divergenceQuality || "待确认")} · ${escapeHtml(state.supportState || "承接待确认")}</small>${state.strictEmotionStageStatus === "confirmed" ? "<small>严格核心证据已形成</small>" : state.emotionStageStatus === "observed" ? "<small>节奏观察 · 严格核心待确认</small>" : ""}</div>
        <div data-state-card="t1-authoritative-emotion"><span>T-1权威情绪（综合锚）<small class="direct-state-label-note">情绪引擎跨日基准，不替代严格核心T-1</small></span><strong>${escapeHtml(state.previousEmotionStage || "T-1情绪状态待确认")}</strong><small>${escapeHtml(state.previousEmotionTradingDate || "日期待确认")} · ${state.previousEmotionAvailable ? escapeHtml(state.previousEmotionAuthority === "canonical_exact_closing_replay" ? "同引擎权威回放" : "canonical收盘冻结") : "跨日证据未通过"}</small></div>
      </div>
      ${preferenceHtml}
      ${marketCapCarrierHtml}
      <p class="direct-cycle-context">当日节奏：${escapeHtml(state.dailyRhythm || "待确认")}；中期结构：${escapeHtml(state.mediumStructure || "待确认")}；分歧强度：${escapeHtml(state.divergenceIntensity || "待确认")}；分歧质量：${escapeHtml(state.divergenceQuality || "待确认")}；承接状态：${escapeHtml(state.supportState || "待确认")}</p>
      ${emotionUnavailableHtml}
      ${emotionPathHtml}
      ${emotionCoreEvidenceHtml}
      <footer class="direct-state-meta">
        <span>数据时间 ${escapeHtml(state.dataTime || state.asOf || "待确认")}</span>
        <span>决策 v${escapeHtml(state.version == null ? "--" : String(state.version))}</span>
        <code>${escapeHtml(state.generationId || "generation 待确认")}</code>
      </footer>
    </section>` : "";
  const opportunity = summary && summary.opportunity && typeof summary.opportunity === "object" ? summary.opportunity : null;
  const opportunityDirections = opportunity && Array.isArray(opportunity.directions) ? opportunity.directions : [];
  const referenceCard = (item, kind, noTrade) => {
    const evidence = Array.isArray(item && item.evidence) ? item.evidence.filter(Boolean) : [];
    const badge = kind === "anchor"
      ? "市场情绪锚 · 不参与机会排名"
      : noTrade ? "机会观察 · 非买点" : "机会观察 · 等待交易条件";
    return `
      <article class="direct-opportunity-reference is-${kind}" data-focus-kind="${kind === "anchor" ? "emotion-anchor-evidence" : "opportunity"}"${kind === "trade" ? ' data-focus-source="unifiedDecisionChain.observationCandidates"' : ""}>
        <div><strong>${escapeHtml(item && item.name || "--")}</strong><small>${escapeHtml(item && item.code || "")}</small><em>${escapeHtml(badge)}</em></div>
        <mark>所属题材：${escapeHtml(item && item.direction || "题材待确认")}</mark>
        <p>${escapeHtml([item && item.identity, item && item.state].filter(Boolean).join(" · ") || "状态待确认")}</p>
        ${Number.isFinite(Number(item && item.weight)) ? `<span>对市场判断的影响 ${escapeHtml(String(Math.round(Number(item.weight))))}</span>` : ""}
        ${evidence.length ? `<ul>${evidence.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>` : ""}
      </article>`;
  };
  const probabilityObservationText = (value, fallback = "") => {
    let result = String(value == null ? "" : value).trim() || fallback;
    result = result
      .replace(/有方向，但暂时没有合适买点/g, "有方向，继续观察概率变化")
      .replace(/暂时没有合适的新开仓机会/g, "当前没有形成机会观察方向")
      .replace(/(\d+)个方向，等待买点确认/g, "$1个方向，继续观察概率变化")
      .replace(/目前有关注方向，但还没有一只股票出现清楚、可执行的买点。?/g, "目前有关注方向，继续观察核心表现和情景概率变化。")
      .replace(/仍需市场方向与个股买点同时确认/g, "继续观察市场方向、核心状态与情景概率是否同步");
    return result;
  };
  const opportunityReasons = opportunity && Array.isArray(opportunity.reasons)
    ? opportunity.reasons.slice(0, 3).map((row) => probabilityObservationText(row)) : [];
  const reopenConditions = opportunity && Array.isArray(opportunity.reopenConditions)
    ? opportunity.reopenConditions.slice(0, 2).map((row) => probabilityObservationText(row)) : [];
  const opportunityExplanationHtml = opportunity && (opportunity.noTrade || opportunity.state !== "conditional") ? `
    <div class="direct-opportunity-explanation">
      <section>
        <strong>为什么暂时不做</strong>
        ${opportunityReasons.length ? `<ul>${opportunityReasons.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>` : `<p>${escapeHtml(opportunity.gateText || "当前还没有清楚、可执行的买点。")}</p>`}
      </section>
      ${reopenConditions.length ? `<section><strong>什么变化后可以做</strong><ul>${reopenConditions.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul></section>` : ""}
    </div>` : "";
  const opportunityHtml = opportunity && opportunity.available ? `
    <section class="direct-opportunity-map${opportunity.noTrade ? " is-observe-only" : ""}">
      <header>
        <div><span>明日机会方向</span><strong>${escapeHtml(probabilityObservationText(opportunity.title, opportunityDirections.length ? `${opportunityDirections.length}个方向，继续观察概率变化` : "当前没有形成机会观察方向"))}</strong><p>${escapeHtml(probabilityObservationText(opportunity.gateText, "继续观察市场方向、核心状态与情景概率是否同步"))}</p></div>
        <em>${escapeHtml(opportunity.noTrade ? "概率观察 · 非确定性结论" : "概率观察持续更新")}</em>
      </header>
      ${opportunityExplanationHtml}
      ${opportunityDirections.length ? `<div class="direct-opportunity-grid">${opportunityDirections.map((direction, index) => {
        const anchors = Array.isArray(direction.emotionAnchors) ? direction.emotionAnchors : [];
        const trades = Array.isArray(direction.tradeCandidates) ? direction.tradeCandidates : [];
        const evidence = Array.isArray(direction.evidence) ? direction.evidence.filter(Boolean) : [];
        return `
          <article class="direct-opportunity-direction">
            <header><span>${escapeHtml(String(index + 1).padStart(2, "0"))}</span><div><strong>${escapeHtml(direction.name || `方向${index + 1}`)}</strong><p>${escapeHtml([direction.threadRole, direction.state].filter(Boolean).join(" · ") || "并行观察")}</p></div></header>
            ${evidence.length ? `<details class="direct-opportunity-direction-evidence"><summary>为什么关注这个方向</summary><ul class="direct-opportunity-evidence">${evidence.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul></details>` : ""}
            <div class="direct-opportunity-who" data-focus-kind="opportunity" data-focus-source="unifiedDecisionChain.observationCandidates">
              <strong>机会观察股</strong>
              ${trades.length ? `<section><header><span>符合当前资金偏好的观察对象</span><small>只来自统一决策链观察候选，不代表买点</small></header><div>${trades.map((item) => referenceCard(item, "trade", opportunity.noTrade)).join("")}</div></section>` : `<p class="direct-opportunity-empty">本方向无符合当前资金偏好的机会股</p>`}
            </div>
            ${anchors.length ? `<aside class="direct-opportunity-anchor-evidence" data-focus-kind="emotion-anchor-evidence" data-focus-ranking="excluded"><header><span>市场情绪锚（不参与机会排名）</span><small>独立证据区，只用于判断方向和市场强弱</small></header><div>${anchors.map((item) => referenceCard(item, "anchor", opportunity.noTrade)).join("")}</div></aside>` : ""}
          </article>`;
      }).join("")}</div>` : `<p class="direct-opportunity-empty">当前没有通过方向证据门槛的板块；不从题材库硬凑方向。</p>`}
    </section>` : "";
  const validation = summary && summary.validation && typeof summary.validation === "object" ? summary.validation : {};
  const upgrade = Array.isArray(validation.upgrade) ? validation.upgrade[0] : "";
  const downgrade = Array.isArray(validation.downgrade) ? validation.downgrade[0] : "";
  const validationHtml = upgrade || downgrade ? `
    <div class="direct-validation-grid">
      <div class="is-upgrade"><span>升级 / 加仓</span><p>${escapeHtml(upgrade || "必须由市场、方向和核心共同确认")}</p></div>
      <div class="is-downgrade"><span>降级 / 取消</span><p>${escapeHtml(downgrade || "负反馈扩散或核心承接失败即取消")}</p></div>
    </div>` : "";
  const focusStocksHtml = renderDecisionFocusStocksTable(summary && summary.focusStocks);
  return `
    <header class="direct-decision-head">
      <div class="direct-decision-head-main">
        <span>今日结论</span>
        ${stageSummaryHtml}
      </div>
    </header>
    ${bigCycleReasonHtml}
    ${forecastHtml}
    ${focusStocksHtml}
    ${stateHtml}
    ${opportunityHtml}
    ${opportunity && opportunity.available ? "" : `<div class="direct-decision-main"><section class="direct-direction-card">
        <span>明日机会方向</span>
        <strong>${escapeHtml(summary.direction)}</strong>
        <p>${escapeHtml(summary.directionPath)}</p>
      </section></div>`}
    <section class="direct-action-card"><span>明天怎么办</span><strong>${escapeHtml(opportunity && opportunity.noTrade ? "明天先观察，不急着买；只有上面的条件重新满足后，再考虑开仓。" : summary.action)}</strong></section>
    ${validationHtml}
    <div class="direct-cancel-line"><span>这个判断什么时候作废</span><p>${escapeHtml(directPlainGateReason(summary.cancel))}</p>${summary.priceAuditLabel ? `<em>${escapeHtml(summary.priceAuditLabel)}</em>` : ""}</div>
    <footer class="direct-decision-footer">
      <span>概率依据、核心票反馈和完整判断链已归入“复盘结论”。</span>
      <button type="button" data-open-review-conclusion>查看复盘依据</button>
    </footer>`;
}

function renderMarketStrengthSource(payload) {
  const node = document.querySelector("#decisionCausalChain");
  if (!node) return;
  const model = payload && payload.marketStrengthSource && typeof payload.marketStrengthSource === "object"
    ? payload.marketStrengthSource
    : {};
  const unifiedProjection = resolveUnifiedDecisionChainProjection(payload);
  const hasDirectDecisionData = Boolean(payload && payload.unifiedDecisionChain);
  if (!Number(model.version) && !hasDirectDecisionData) {
    node.className = "decision-causal-chain is-empty";
    node.innerHTML = `
      <div class="decision-causal-empty">
        <span>今日结论</span>
        <strong>当前快照还不能生成明日执行方案，重新抓取后再判断</strong>
      </div>`;
    return;
  }

  const safeTone = (value) => ["good", "warn", "bad", "neutral"].includes(value) ? value : "neutral";
  const pct = (value, digits = 1) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return `${number > 0 ? "+" : ""}${number.toFixed(digits)}%`;
  };
  const chain = Array.isArray(model.chain) ? model.chain.filter(Boolean) : [];
  const metrics = model.metrics && typeof model.metrics === "object" ? model.metrics : {};
  const evidence = model.evidence && typeof model.evidence === "object" ? model.evidence : {};
  const style = model.style && typeof model.style === "object" ? model.style : {};
  const cycleRead = model.cycleRead && typeof model.cycleRead === "object" ? model.cycleRead : {};
  const marketSurface = model.marketSurface && typeof model.marketSurface === "object" ? model.marketSurface : {};
  const capacity = model.capacity && typeof model.capacity === "object" ? model.capacity : {};
  const flowNature = model.flowNature && typeof model.flowNature === "object" ? model.flowNature : {};
  const hardVeto = model.hardVeto && typeof model.hardVeto === "object" ? model.hardVeto : {};
  const sampleQuality = model.sampleQuality && typeof model.sampleQuality === "object" ? model.sampleQuality : {};
  const sourceTone = safeTone(model.source && model.source.tone);
  const directCycle = String(cycleRead.displayCycle || cycleRead.label || "周期待确认");
  const directFlow = String(flowNature.label || capacity.label || model.headline || "资金路径待确认");
  const directTitle = hardVeto.active
    ? `${directCycle} · ${directFlow} · 不确认主升`
    : `${directCycle} · ${directFlow}`;
  const evidenceRows = (items, kind, emptyText, limit = 5) => {
    const rows = Array.isArray(items) ? items.filter(Boolean).slice(0, limit) : [];
    if (!rows.length) return `<p class="causal-evidence-empty">${escapeHtml(emptyText)}</p>`;
    return `<div class="causal-evidence-list">${rows.map((item) => {
      const move = kind === "external" ? item.changePct : kind === "fade" ? item.openToClosePct : item.closeChangePct;
      const detail = kind === "external"
        ? [item.market, item.theme].filter(Boolean).join(" · ")
        : kind === "style"
          ? [item.concept, item.note].filter(Boolean).join(" · ")
          : kind === "capacity"
            ? `成交${Number.isFinite(Number(item.amountYi)) ? `${Number(item.amountYi).toFixed(1)}亿` : "—"} · 昨收→收盘 ${pct(item.closeChangePct)} · 开盘→收盘 ${pct(item.openToClosePct)}`
            : kind === "anchor"
              ? `${item.boardBroken ? "触板后回落 · " : ""}振幅${pct(item.intradayAmplitudePct)} · 收盘位于日内${Number.isFinite(Number(item.closeLocationPct)) ? `${Number(item.closeLocationPct).toFixed(0)}%` : "—"}位置`
              : `开盘→收盘 ${pct(item.openToClosePct)}${item.identity ? ` · ${item.identity}` : ""}`;
      const displayMove = ["fade", "capacity", "anchor"].includes(kind) ? item.openToClosePct : move;
      return `
        <span class="causal-evidence-chip">
          <b>${escapeHtml(item.name || "--")}</b>
          <small>${escapeHtml(detail || item.code || "")}</small>
          <em class="${Number(displayMove) > 0 ? "is-up" : Number(displayMove) < 0 ? "is-down" : ""}">${pct(displayMove)}</em>
        </span>`;
    }).join("")}</div>`;
  };
  const vetoReasons = Array.isArray(hardVeto.reasons) ? hardVeto.reasons.filter(Boolean) : [];
  const vetoPanel = hardVeto.active ? `
    <section class="causal-veto-panel" role="status">
      <header><span>核心容量硬否决</span><strong>${escapeHtml(hardVeto.label || "内生接力不成立")}</strong></header>
      <ul>${vetoReasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>
      <p>指数和多数股票收涨，只能说明市场表面修复；成交额前列的今日买盘亏损时，不能判定主升或内生接力。</p>
    </section>` : `
    <section class="causal-veto-panel is-pass">
      <header><span>核心容量硬门槛</span><strong>未触发否决</strong></header>
      <p>仍需同时验证成交额前列承接、先验核心溢价和下一交易日持续性。</p>
    </section>`;

  const summary = buildDirectDecisionSummary(payload, model);
  summary.focusStocks = buildDecisionFocusStocks(payload, unifiedProjection);
  node.className = `decision-causal-chain decision-direct-card is-${summary.tone}`;
  node.dataset.source = "unified-decision-chain-v3";
  node.dataset.contractReady = unifiedProjection.contractReady ? "true" : "false";
  node.dataset.generation = summary.state && summary.state.generationId ? summary.state.generationId : "";
  node.innerHTML = renderDecisionDirectSummary(summary);
  const reviewButton = node.querySelector("[data-open-review-conclusion]");
  if (reviewButton) reviewButton.addEventListener("click", () => {
    navigateToWorkflowView("review-conclusion");
  });
}

function renderDecision(payload) {















  const st = payload.market && payload.market.state;















  const snapshot = payload.market && payload.market.snapshot;















  const limitStats = payload.market && payload.market.limitStats;















  renderMarketStrengthSource(payload);
  if (!st) return;

  const shockTransition = st.shockTransition && st.shockTransition.active ? st.shockTransition : null;
  const asMarketObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const safeMarketTone = (value) => ["good", "warn", "bad", "neutral"].includes(value) ? value : "neutral";
  const strengthModel = asMarketObject(payload.marketStrengthSource);
  const strengthCycleRead = asMarketObject(strengthModel.cycleRead);
  const strengthCapacity = asMarketObject(strengthModel.capacity);
  const strengthMarketSurface = asMarketObject(strengthModel.marketSurface);
  const strengthHardVeto = asMarketObject(strengthModel.hardVeto);
  const hasStrengthHardVeto = strengthHardVeto.active === true;
  const indexEnvironment = asMarketObject(st.indexEnvironment);
  const tradeWindow = asMarketObject(st.tradeWindow);
  const unifiedDecisionProjection = resolveUnifiedDecisionChainProjection(payload);
  const unifiedStage = asMarketObject(unifiedDecisionProjection.marketStage);
  const unifiedBigCycle = asMarketObject(unifiedStage.bigCycle);
  const unifiedTransition = asMarketObject(unifiedStage.transition);
  const unifiedSmallCycle = asMarketObject(unifiedStage.smallCycle);
  const effectiveCycle = String(unifiedBigCycle.label || "--");
  const effectiveSmallCycle = String(unifiedSmallCycle.label || "小周期待确认");
  const cycleWasOverridden = Boolean(
    effectiveCycle !== "--"
    && String(effectiveCycle) !== String(st.cycle || ""),
  );
  const dailyState = asMarketObject(st.dailyState);
  const profitEffect = asMarketObject(st.profitEffect);
  const lossEffect = asMarketObject(st.lossEffect);
  const cycleDataQuality = asMarketObject(st.dataQuality);
  const effectAttribution = asMarketObject(st.effectAttribution);
  const effectScoreText = (value) => Number.isFinite(Number(value)) ? `${Math.round(Number(value))}分` : "待计算";
  const layerReferenceHtml = (groups) => {
    const safeGroups = Array.isArray(groups) ? groups : [];
    if (!safeGroups.length) return "";
    return `
      <div class="market-layer-references">
        ${safeGroups.map((group) => {
          const items = Array.isArray(group && group.items) ? group.items.filter(Boolean) : [];
          const groupTone = safeMarketTone(group && group.tone);
          return `
            <div class="market-layer-reference-group" data-tone="${groupTone}">
              <span>${escapeHtml(group && group.label || "标的参考")}</span>
              <div>
                ${items.length
                  ? items.map((item) => `
                    <span class="market-layer-stock-ref">
                      <b>${escapeHtml(item && item.name || "--")}</b>
                      ${item && item.code ? `<em>${escapeHtml(item.code)}</em>` : ""}
                      ${Number.isFinite(Number(item && item.changePct))
                        ? `<i class="${Number(item.changePct) > 0 ? "is-up" : Number(item.changePct) < 0 ? "is-down" : ""}">${Number(item.changePct) > 0 ? "+" : ""}${Number(item.changePct).toFixed(2)}%</i>`
                        : ""}
                    </span>`).join("")
                  : `<small>${escapeHtml(group && group.emptyText || "暂无符合条件的标的")}</small>`}
              </div>
            </div>`;
        }).join("")}
      </div>`;
  };
  const layerCard = ({ title, label, summary, tone = "neutral", className = "", referenceGroups = [] }) => `
    <article class="market-layer-card ${className}${referenceGroups.length ? " has-references" : ""}" data-tone="${safeMarketTone(tone)}">
      <span>${escapeHtml(title)}</span>
      <strong>${escapeHtml(label || "--")}</strong>
      <small>${escapeHtml(summary || "等待新快照计算")}</small>
      ${layerReferenceHtml(referenceGroups)}
    </article>`;
  const effectPctText = (value) => Number.isFinite(Number(value))
    ? `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(2)}%`
    : "—";
  const effectStatusText = (status) => ({
    strong: "已确认",
    pass: "成立",
    contracting: "收缩",
    mixed: "分化",
    unverified: "未确认",
    expanding: "扩散",
    fail: "不成立",
  }[status] || "待确认");
  const effectTone = (status) => (
    ["strong", "pass", "contracting"].includes(status)
      ? "good"
      : ["expanding", "fail"].includes(status)
        ? "bad"
        : status === "unverified" ? "neutral" : "warn"
  );
  const effectStockHtml = (stock) => {
    const change = Number(stock && stock.changePct);
    const changeClass = Number.isFinite(change) ? (change > 0 ? "is-up" : change < 0 ? "is-down" : "") : "";
    const evidence = Array.isArray(stock && stock.evidence) ? stock.evidence.filter(Boolean) : [];
    const flowLabel = stock && stock.flowNature && stock.flowNature.label ? ` · ${stock.flowNature.label}` : "";
    return `
      <article class="effect-stock-row">
        <div class="effect-stock-head">
          <div>
            <strong>${escapeHtml(stock && stock.name || "--")}</strong>
            <span>${escapeHtml(stock && stock.code || "")}${stock && stock.typeLabel ? ` · ${escapeHtml(stock.typeLabel)}` : ""}${flowLabel ? escapeHtml(flowLabel) : ""}</span>
          </div>
          <b class="${changeClass}">${effectPctText(stock && stock.changePct)}</b>
        </div>
        ${evidence.length ? `<p>${evidence.map((item) => escapeHtml(item)).join(" · ")}</p>` : ""}
      </article>`;
  };
  const effectDirectionHtml = (direction) => `
    <div class="effect-direction-row">
      <strong>${escapeHtml(direction && direction.name || "--")}</strong>
      <span>${escapeHtml(direction && direction.breadthLabel || "覆盖待确认")} · 样本${direction && direction.sampleCount != null ? escapeHtml(String(direction.sampleCount)) : "—"}只 · 上涨${direction && direction.upRate != null ? escapeHtml(String(direction.upRate)) + "%" : "—"} · 中位数${effectPctText(direction && direction.medianChangePct)}</span>
    </div>`;
  const effectGroupHtml = (group) => {
    const items = Array.isArray(group && group.items) ? group.items : [];
    const directions = Array.isArray(group && group.directions) ? group.directions : [];
    const open = group && group.status !== "unverified" ? " open" : "";
    return `
      <details class="effect-cause-group" data-tone="${effectTone(group && group.status)}"${open}>
        <summary>
          <span>
            <strong>${escapeHtml(group && group.title || "--")}</strong>
            <small>${escapeHtml(group && group.summary || "等待证据")}</small>
          </span>
          <b>${effectStatusText(group && group.status)}${items.length ? ` · ${items.length}只` : ""}</b>
        </summary>
        <div class="effect-cause-content">
          ${directions.map(effectDirectionHtml).join("")}
          ${items.map(effectStockHtml).join("")}
          ${!directions.length && !items.length ? '<p class="effect-empty">没有满足条件的代表标的，因此本项不能作为今日结论依据。</p>' : ""}
        </div>
      </details>`;
  };
  const effectProofHtml = (layer) => `
    <article class="effect-proof-card" data-tone="${effectTone(layer && layer.status)}">
      <div><span>${escapeHtml(layer && layer.title || "--")}</span><b>${escapeHtml(layer && layer.label || "待确认")}</b></div>
      <ul>${(Array.isArray(layer && layer.evidence) ? layer.evidence : []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </article>`;
  const effectAttributionHtml = () => {
    if (!effectAttribution.version) return "";
    const proofLayers = Array.isArray(effectAttribution.proofLayers) ? effectAttribution.proofLayers : [];
    const profitMap = asMarketObject(effectAttribution.profitMap);
    const lossMap = asMarketObject(effectAttribution.lossMap);
    const profitGroups = Array.isArray(profitMap.groups) ? profitMap.groups : [];
    const lossGroups = Array.isArray(lossMap.groups) ? lossMap.groups : [];
    const contradictions = Array.isArray(effectAttribution.contradictions) ? effectAttribution.contradictions : [];
    const validation = asMarketObject(effectAttribution.validation);
    const upgrades = Array.isArray(validation.upgrade) ? validation.upgrade : [];
    const invalidations = Array.isArray(validation.invalidate) ? validation.invalidate : [];
    return `
      <section class="effect-attribution-board">
        <header class="effect-attribution-head">
          <div>
            <span>赚钱 / 亏钱因果归因</span>
            <h4>${escapeHtml(effectAttribution.headline || "市场与短线分层待确认")}</h4>
            <p>${escapeHtml(effectAttribution.summary || "等待方向和核心证据")}</p>
          </div>
          <div class="effect-structure-tags">
            <span>强度：${escapeHtml(profitMap.strengthLabel || "待确认")}</span>
            <span>覆盖：${escapeHtml(profitMap.coverageLabel || "待确认")}</span>
            <span>持续：${escapeHtml(profitMap.continuityLabel || "待确认")}</span>
          </div>
        </header>
        <div class="effect-proof-grid">${proofLayers.map(effectProofHtml).join("")}</div>
        <div class="effect-map-grid">
          <section class="effect-map-column is-profit">
            <header><span>赚钱效应定位</span><strong>${escapeHtml(profitMap.headline || "赚钱位置待确认")}</strong></header>
            ${profitGroups.map(effectGroupHtml).join("")}
          </section>
          <section class="effect-map-column is-loss">
            <header><span>亏钱效应定位</span><strong>${escapeHtml(lossMap.headline || "亏钱位置待确认")}</strong></header>
            ${lossGroups.map(effectGroupHtml).join("")}
          </section>
        </div>
        ${contradictions.length ? `
          <section class="effect-counterevidence">
            <strong>反面证据 · 为什么不能只看总分</strong>
            <ul>${contradictions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          </section>` : ""}
        <div class="effect-validation-grid">
          <section>
            <strong>升级条件 · 何时才能确认全面加强</strong>
            <ul>${upgrades.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          </section>
          <section>
            <strong>证伪条件 · 什么出现就说明判断错了</strong>
            <ul>${invalidations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          </section>
        </div>
      </section>`;
  };

  const effectPanel = document.querySelector("#decisionEffectPanel");
  const effectBody = document.querySelector("#decisionEffectBody");
  if (effectPanel && effectBody) {
    const attributionHtml = effectAttributionHtml();
    effectPanel.hidden = !attributionHtml;
    effectBody.innerHTML = attributionHtml
      ? `<details class="decision-deep-dive"><summary><span>赚钱 / 亏钱完整因果证据</span><small>${escapeHtml(effectAttribution.headline || "展开查看方向、标的与反证")}</small></summary>${attributionHtml}</details>`
      : "";
  }































  // ① 大盘：红黄绿灯 + 一句话















  const marketBody = document.querySelector("#decisionMarketBody");















  if (marketBody) {















    const light = unifiedDecisionProjection.executionOpen
      ? unifiedDecisionProjection.authorization.status === "conditional" ? "yellow" : "green"
      : "red";















    const verdict = unifiedDecisionProjection.executionOpen
      ? unifiedDecisionProjection.authorization.status === "conditional" ? "条件授权" : "交易授权开启"
      : "不做新仓";















    const cycleExplain = cycleWasOverridden && indexEnvironment.summary
      ? indexEnvironment.summary
      : Array.isArray(st.cycleReasons) && st.cycleReasons.length















      ? st.cycleReasons.join("；")















      : "今天的盘面强弱、涨跌家数和涨停延续性，还不足以把它推到更强周期。";















    const phaseExplain = shockTransition
      ? `基础周期仍是${shockTransition.baseCycle}，但今天是${shockTransition.damageLevel}；执行按退潮防守，次日10:50只验证，收盘后再确认纠偏或退潮。`
      :















      st.subPhase === "强回流"















        ? "这是混沌里的强回流：核心方向已经站出来了，但扩散还没跟上，离真正主升还差一步。"















        : st.subPhase === "高位分歧"















          ? "这是高位分歧：已经很强，但分歧和兑现压力也大。"















          : st.subPhase === "高潮加速"















            ? "这是高潮加速：强是强，但更接近阶段顶部。"















            : dailyState.summary || "阶段判断同时看赚钱效应、亏钱效应及其扩散方向。";















    const structuralResolution = asMarketObject(st.structuralResolution);
    const attributionScopes = Array.isArray(effectAttribution.scopes) ? effectAttribution.scopes : [];
    const marketScope = attributionScopes.find((item) => item && item.key === "market") || {};
    const shortCoreScope = attributionScopes.find((item) => item && item.key === "short-core") || {};
    const tradeableScope = attributionScopes.find((item) => item && item.key === "tradeable") || {};
    const lossScope = attributionScopes.find((item) => item && item.key === "loss") || {};
    const marketLayerHtml = `
      <details class="decision-market-evidence">
        <summary><span>查看完整周期与赚钱 / 亏钱分层</span><small>指数定环境，短线窗口定买点 · 默认收起</small></summary>
        <div class="market-layer-board">
        ${layerCard({
          title: "指数环境（决定基础周期）",
          label: indexEnvironment.label || effectiveCycle || "指数结构待确认",
          summary: indexEnvironment.summary || "只看主要指数K线结构，不由题材热度或单只股票改写周期",
          tone: indexEnvironment.tone || "neutral",
        })}
        ${layerCard({
          title: "短线窗口（决定现在能不能买）",
          label: tradeWindow.label || "短线窗口待确认",
          summary: tradeWindow.summary || "再看同花顺全A、赚钱/亏钱效应和核心票是否率先走强",
          tone: tradeWindow.tone || "neutral",
          referenceGroups: Array.isArray(tradeWindow.coreEvidence) && tradeWindow.coreEvidence.length
            ? [{ label: "核心验证", tone: tradeWindow.tone || "neutral", items: tradeWindow.coreEvidence }]
            : [],
        })}
        ${layerCard({
      title: "5日情绪大周期（短线情绪算法）",
          label: effectiveCycle,
          summary: cycleWasOverridden
            ? unifiedBigCycle.reason || indexEnvironment.summary || "宏观结构已按统一口径重新定性"
            : unifiedBigCycle.reason || structuralResolution.reason || "大周期变化较慢，以收盘和连续性确认",
          tone: cycleWasOverridden ? "warn" : "neutral",
        })}
        ${layerCard({
          title: "过渡节点（观察轴）",
          label: unifiedTransition.status === "not_active" ? "无周期切换" : unifiedTransition.label || "过渡节点待确认",
          summary: unifiedTransition.reason || "修复、反弹、分歧和加强只记录在这里，不得覆盖五态大周期",
          tone: unifiedTransition.status === "observed" ? "warn" : "neutral",
        })}
        ${layerCard({
          title: "小周期（微观算法）",
          label: effectiveSmallCycle,
          summary: unifiedSmallCycle.reason || "在大周期内部判断短周期节奏；不覆盖、不改写大周期结论",
          tone: unifiedSmallCycle.status === "unavailable" ? "warn" : "neutral",
        })}
        ${layerCard({
          title: "今日状态",
          label: effectAttribution.headline || dailyState.label || st.subPhase || "待新快照计算",
          summary: effectAttribution.summary || dailyState.summary || "旧缓存口径，重新抓取后生成今日状态",
          tone: dailyState.tone || "neutral",
        })}
        ${layerCard({
          title: "全市场统计赚钱效应",
          label: profitEffect.label ? `${profitEffect.label} · ${effectScoreText(profitEffect.score)}` : "待新快照计算",
          summary: "描述涨停、市场广度、指数与成交，不直接等于短线可交易",
          tone: profitEffect.tone || "neutral",
          referenceGroups: Array.isArray(marketScope.referenceGroups) ? marketScope.referenceGroups : [],
        })}
        ${layerCard({
          title: "短线核心赚钱效应",
          label: shortCoreScope.label || "待新快照计算",
          summary: shortCoreScope.summary || "等待核心主动性、负反馈与方向覆盖数据",
          tone: shortCoreScope.tone || "neutral",
          referenceGroups: Array.isArray(shortCoreScope.referenceGroups) ? shortCoreScope.referenceGroups : [],
        })}
        ${layerCard({
          title: "可交易赚钱效应",
          label: tradeableScope.label || "待新快照计算",
          summary: tradeableScope.summary || "只统计同时通过主动性、核心地位与结构门槛的载体",
          tone: tradeableScope.tone || "neutral",
          referenceGroups: Array.isArray(tradeableScope.referenceGroups) ? tradeableScope.referenceGroups : [],
        })}
        ${layerCard({
          title: "全市场统计亏钱效应",
          label: lossEffect.label ? `${lossEffect.label} · ${effectScoreText(lossEffect.score)}` : "待新快照计算",
          summary: "极端负反馈收缩，不代表主线老核心已经止跌",
          tone: lossEffect.tone || "neutral",
          referenceGroups: Array.isArray(lossScope.referenceGroups) ? lossScope.referenceGroups : [],
        })}
        ${layerCard({
          title: "数据完整性",
          label: cycleDataQuality.label || "旧缓存待校验",
          summary: cycleDataQuality.summary || "重新抓取后核对真正上一有效交易日",
          tone: cycleDataQuality.tone || "neutral",
          className: "is-quality",
        })}
        </div>
      </details>`;

    marketBody.innerHTML = `















      <div class="decision-verdict dv-${light}">















        <strong>${verdict}</strong>















        <span>${effectiveCycle} · ${unifiedDecisionProjection.executionOpen ? "交易授权开启" : "交易授权关闭"}</span>















      </div>

      ${marketLayerHtml}















      <div class="decision-facts">















        <span>统一链仓位 <b>${unifiedDecisionProjection.executionOpen ? `${unifiedDecisionProjection.maximumPortfolioPct}%` : "0%"}</b></span>















        <span title="这里只是全市场收盘统计分，不代表日内追涨资金赚钱">全市场统计分 <b>${st.marketScore}</b>（非交易分）</span>















        <span>两市成交 <b>${snapshot ? formatAmount(snapshot.shszAmountYi) : "--"}</b></span>















        <span>涨跌比 <b>${snapshot && snapshot.upCount != null ? snapshot.upCount + "/" + snapshot.downCount : "--"}</b></span>















      </div>`;















    marketBody.insertAdjacentHTML(















      "beforeend",















      `<details class="decision-rationale-disclosure">
         <summary><span>查看周期判断原话</span><small>结论保留，减少首页长段落</small></summary>
         <p class="decision-note">大白话：${escapeHtml(cycleExplain)}</p>
         <p class="decision-note">${escapeHtml(phaseExplain)}</p>
         <p class="decision-note">${shockTransition ? "判断链路：外围警觉只作归因提示；操作先按退潮级防守，真正的周期确认只看次日A股自身修复。" : "判断链路：指数K线定基础环境 → 同花顺全A与赚钱/亏钱效应定交易窗口 → 市场风格和热门题材定方向 → 核心票定执行。指数分歧但全A抗跌、核心先走强可以小仓拿先手；次日环境改善且同一核心加强后，已有先手才允许加仓。"}</p>
       </details>`,















    );















  }































  // ② 情绪















  const emotionBody = document.querySelector("#decisionEmotionBody");















  if (emotionBody) {















    if (limitStats) {















      const heating = limitStats.ztToday - limitStats.ztPrev;















      const rawArrow = dailyState.label || (heating > 0 ? "升温 ↑" : heating < 0 ? "涨停回落·待判断" : "持平 →");
      const arrow = hasStrengthHardVeto ? `市场表面：${rawArrow}` : rawArrow;















      const cls = dailyState.tone === "good"
        ? "dv-green"
        : dailyState.tone === "bad"
          ? "dv-red"
          : "dv-yellow";

      const limitCount = (value) => value == null || value === "" ? "—" : String(value);
      const limitDate = (value, fallback) => {
        const raw = String(value || "").replace(/\D/g, "");
        return raw.length === 8 ? `${Number(raw.slice(4, 6))}/${Number(raw.slice(6, 8))}` : fallback;
      };
      const limitDates = limitStats.dates || {};
      const prev2Date = limitDate(limitDates.prev2, "前二交易日");
      const prevDate = limitDate(limitDates.prev, "上一交易日");
      const todayDate = limitDate(limitDates.today, "今日");















      emotionBody.innerHTML = `















        <div class="decision-verdict ${cls}">















          <strong>${shockTransition ? "大分歧 ↓" : arrow}</strong>















          <span>
            涨停：前二交易日（${prev2Date}）${limitCount(limitStats.ztPrev2)}只 · 上一交易日（${prevDate}）${limitCount(limitStats.ztPrev)}只 · 今日（${todayDate}）${limitCount(limitStats.ztToday)}只<br>
            跌停：前二交易日（${prev2Date}）${limitCount(limitStats.dtPrev2)}只 · 上一交易日（${prevDate}）${limitCount(limitStats.dtPrev)}只 · 今日（${todayDate}）${limitCount(limitStats.dtToday)}只
          </span>















        </div>















        <p class="decision-note">${escapeHtml(shockTransition
          ? "外围冲击下出现退潮级表现；这不是直接改写基础周期，次日10:50验证、收盘确认。"
          : hasStrengthHardVeto
            ? `${strengthMarketSurface.label || "指数与广度改善"}，但${strengthCapacity.label || "核心容量承接不足"}；涨停家数和收盘上涨只代表市场表面，不能据此确认短线主升。`
          : st.subPhase === "高位分歧"
            ? "情绪处于高位分歧：涨停多但兑现压力大，追高容易接最后一棒。"
            : st.subPhase === "高潮加速"
              ? "情绪高潮加速：赚钱效应最强但接近顶部，锁利优先。"
              : dailyState.summary || "涨停数量回落不等于退潮；还要同时看跌停扩散、核心负反馈和赚钱方向是否延续。")}</p>`;















    } else {















      emotionBody.innerHTML = `<p class="decision-note">⚠️涨跌停数据未取到，情绪阶段无法判定（不猜）。</p>`;















    }















  }































  // ③ 方向：与题材库共用同一份母题材、角色与股票明细；旧数据才回退 topicBoard 摘要















  const topicsBody = document.querySelector("#decisionTopicsBody");















  if (topicsBody) {
    const libraryThemes = payload && payload.themeLibrary && Array.isArray(payload.themeLibrary.themes)
      ? payload.themeLibrary.themes.slice(0, 3)
      : [];
    if (libraryThemes.length) {
      topicsBody.dataset.source = "theme-library";
      topicsBody.innerHTML = `<div class="decision-topic-sync-note"><span>与题材库同步</span><small>母题材、角色和股票明细采用同一口径</small></div>${libraryThemes.map(renderDecisionThemeCard).join("")}`;
    } else if (payload.topicBoard) {
      topicsBody.dataset.source = "topic-board-fallback";















    const items = (payload.topicBoard.items || []).slice(0, 3);















    topicsBody.innerHTML = items.length















      ? items















          .map(















            (item) => `















        <div class="decision-topic">















          <div class="decision-topic-head">















            <strong>${escapeHtml(item.displayName || item.name)}</strong>















            <span class="topic-label">${escapeHtml(item.label || "热门观察")}</span>















          </div>















          <div class="decision-topic-tags">















            <span>${escapeHtml(item.leaders && item.leaders.length > 1 ? "板块强势梯队 " + item.leaders.map((l) => l.name).join(" / ") : item.leader ? "板块强势票 " + item.leader.name : "强势梯队待确认")}</span>















            <span>${escapeHtml(item.zhongjun ? "中军 " + item.zhongjun.name : "中军待确认")}</span>















            <span>上榜${Number(item.count || 0)}只 · 涨停${Number(item.limitCount || 0)}只</span>















          </div>















        </div>`,















          )















          .join("")















      : `<p class="decision-note">今日没有聚出值得留意的方向。</p>`;
    } else {
      topicsBody.dataset.source = "empty";
      topicsBody.innerHTML = `<p class="decision-note">今日没有聚出值得留意的方向。</p>`;
    }















  }































  // ④ 明日最优解















  const picksBody = document.querySelector("#decisionPicksBody");















  if (picksBody) {















    const candidateProjection = resolveTomorrowDecisionCandidateProjection(payload);
    const formalRows = candidateProjection.primary.slice(0, 5);
    const instructionText = (value, fallback) => {
      if (typeof value === "string" && value.trim()) return value.trim();
      if (value && typeof value === "object") {
        return String(value.summary || value.label || value.text || value.instruction || fallback).trim();
      }
      return fallback;
    };
    if (!candidateProjection.executionOpen || !formalRows.length) {
      picksBody.innerHTML = renderCanonicalDecisionEmptyState(candidateProjection);
    } else {
      picksBody.innerHTML = `
        <section class="tomorrow-path-board" data-decision-source="unified-decision-chain-v3">
          <header class="tomorrow-path-board-head">
            <div><span>统一决策链结果股</span><strong>完整展示最终授权结果（最多5只）</strong><p>旧热榜、旧候选和个人观察条件都不能增删结果股。</p></div>
            <b>${formalRows.length}只已授权</b>
          </header>
          <div class="tomorrow-path-grid">
            ${formalRows.map((candidate, index) => {
              const allocation = candidate.positionAllocation && typeof candidate.positionAllocation === "object"
                ? candidate.positionAllocation : {};
              const participation = candidate.participationValue && typeof candidate.participationValue === "object"
                ? candidate.participationValue : {};
              return `
                <article class="tomorrow-path-card is-ready" data-code="${escapeHtml(candidate.code || "")}">
                  <header class="tomorrow-path-card-head">
                    <span><b>${String(index + 1).padStart(2, "0")}</b>统一链第${index + 1}位</span>
                    <em>最终授权结果</em>
                  </header>
                  <div class="tomorrow-path-candidate">
                    <div><strong>${escapeHtml(candidate.name || candidate.code || "--")}</strong>${candidate.code ? `<span>${escapeHtml(String(candidate.code))}</span>` : ""}<b>${escapeHtml(candidate.stockMode || candidate.identity || candidate.role || "结果股")}</b></div>
                  </div>
                  <div class="tomorrow-path-allocation">
                    <span>参与价值 <b>${Number.isFinite(Number(participation.score)) ? escapeHtml(String(participation.score)) : "待校准"}</b></span>
                    <span>相对权重 <b>${Number(allocation.relativeWeightPct) || 0}%</b></span>
                    <span>初始仓位 <b>${Number(allocation.initialPortfolioPct) || 0}%</b></span>
                    <span>仓位上限 <b>${Number(allocation.maximumPortfolioPct) || 0}%</b></span>
                  </div>
                  <div class="tomorrow-path-plain-rules">
                    <section class="is-buy"><small>买入触发</small><p>${escapeHtml(instructionText(candidate.buy, "等待同代执行计划与盘中承接确认"))}</p></section>
                    <section><small>持有复核</small><p>${escapeHtml(instructionText(candidate.hold, "成交后T+1强制复核"))}</p></section>
                    <section class="is-no-buy"><small>取消/卖出</small><p>${escapeHtml(instructionText(candidate.sell, "承接失败或统一链关闭时取消"))}</p></section>
                  </div>
                </article>`;
            }).join("")}
          </div>
        </section>`;
    }
  }































  const coreWatchBtn = document.querySelector("#openCoreWatchBtn");















  const coreWatchPanel = document.querySelector("#coreWatchPanel");















  const coreWatchMeta = document.querySelector("#coreWatchMeta");















  const coreWatchBody = document.querySelector("#coreWatchBody");































  function formatCoreWatchDate(value) {















    if (!value) return "--";















    return String(value).slice(0, 10);















  }































  function renderCoreWatchTable(coreWatch) {
    if (!coreWatchPanel || !coreWatchBody || !coreWatchMeta) return;
    const entries = Array.isArray(coreWatch && coreWatch.entries) ? coreWatch.entries.slice() : [];
    const entryTradingDate = (entry) => {
      const history = Array.isArray(entry && entry.history) ? entry.history : [];
      const latest = entry && (entry.latestSnapshot || history[history.length - 1]);
      return String(latest && latest.date || entry && entry.lastSeenAt || "").slice(0, 10);
    };
    const latestEntryDate = entries.map(entryTradingDate).filter(Boolean).sort().slice(-1)[0] || "";
    const today = String(coreWatch && coreWatch.tradingDate || latestEntryDate || "").slice(0, 10);
    const currentEntries = entries.filter((entry) => entryTradingDate(entry) === today);
    const historyEntries = entries.filter((entry) => entryTradingDate(entry) !== today);
    coreWatchPanel.hidden = false;
    coreWatchMeta.textContent = entries.length ? `当前 ${currentEntries.length} 只 · 历史 ${historyEntries.length} 只 · 30天滚动留存` : "暂无核心观察";
    const renderRows = (list, sectionMode) => list
      .map((entry) => {
        const history = Array.isArray(entry.history) ? entry.history : [];
        const latest = entry.latestSnapshot || history[history.length - 1] || {};
        const leadership = latest.leadership || entry.leadership || {};
        const initiative = leadership.initiative || {};
        const structure = leadership.structure || {};
        const statusRaw = String(entry.status || "");
        const isCurrent = sectionMode === "current";
        const refreshedOnly = isCurrent && latest.source === "retained-refresh";
        const status = isCurrent ? (refreshedOnly ? "今日复核" : "今日核心") : "历史留存";
        const statusClass = isCurrent ? "today" : "stale";
        const historyHtml = history
          .slice(-3)
          .map((item) => `<span class="core-watch-chip">${escapeHtml(String(item.date || "").slice(5, 10))} <b>${formatScore(item.score)}</b>${item.leadership && item.leadership.tradeState ? ` · ${escapeHtml(item.leadership.tradeState)}` : ""}</span>`)
          .join("");
        const reason = leadership.executionNote || (latest.reasons && latest.reasons[0]) || entry.initialSnapshot?.roleReason || entry.roleReason || "主线里还有辨识度，暂时不从核心池里移除";
        const detail = [leadership.identity || entry.role || latest.role || "核心观察", leadership.tradeState || entry.setup || latest.setup || "观察"].filter(Boolean).join(" · ");
        const windowText = `${formatCoreWatchDate(entry.firstSeenAt)} → ${formatCoreWatchDate(entry.expiresAt)}`;
        const remainDays = Math.max(0, Math.ceil(((new Date(String(entry.expiresAt || "")).getTime() - Date.now()) / 86400000))) || 0;
        return `
          <tr>
            <td>
              <strong>${escapeHtml(entry.name || latest.name || entry.code || "--")}</strong>
              <small>${escapeHtml(entry.code || latest.code || "--")}</small>
            </td>
            <td>
              <div>${escapeHtml(entry.board || latest.board || "未分类")}</div>
              <small>${escapeHtml(entry.mainConcept || latest.mainConcept || "未分类")}</small>
            </td>
            <td>
              <div class="core-watch-role-line">
                <span class="core-watch-status ${statusClass}">${escapeHtml(status)}</span>
                <b>${escapeHtml(leadership.levelLabel || entry.role || latest.role || "核心观察")}</b>
              </div>
              <small>${escapeHtml(detail)}</small>
              <small>${escapeHtml(initiative.label || "主动性待确认")} ${Number.isFinite(Number(initiative.score)) ? escapeHtml(String(initiative.score)) : "--"} · ${escapeHtml(initiative.dataQuality || "数据待确认")}</small>
              <small>结构${escapeHtml(structure.grade || "--")} · ${escapeHtml(structure.positionLabel || "位置待确认")} · ${escapeHtml(structure.chipLabel || "筹码待确认")}</small>
            </td>
            <td>
              <div>${windowText}</div>
              <small>首次 ${formatTime(entry.firstSeenAt)} · 最近入选 ${formatTime(entry.lastSeenAt)}${entry.lastRefreshedAt ? ` · 今日复核 ${formatTime(entry.lastRefreshedAt)}` : ""}</small>
              <small>剩余 ${remainDays} 天</small>
            </td>
            <td>
              <div class="core-watch-history">${historyHtml || "<span class='core-watch-chip'>暂无轨迹</span>"}</div>
              <small>已留存 ${history.length} 天</small>
            </td>
            <td>
              <div class="core-watch-reason">${escapeHtml(reason)}</div>
              <small>评分 ${formatScore(entry.score || latest.score)} · ${escapeHtml(latest.marketCycle || "")}${latest.marketSubPhase ? " / " + escapeHtml(latest.marketSubPhase) : ""}</small>
            </td>
          </tr>`;
      })
      .join("");
    coreWatchBody.innerHTML = entries.length
      ? `
        <div class="core-watch-summary">
          <span>当前追踪 <b>${entries.length}</b> 只</span>
          <span>当前核心 <b>${currentEntries.length}</b> 只</span>
          <span>历史留存 <b>${historyEntries.length}</b> 只</span>
          <span>窗口 <b>${coreWatch.windowDays || 30}</b> 天</span>
          <span>最近同步 <b>${formatTime(coreWatch.updatedAt || coreWatch.fetchedAt || coreWatch.lastUpdatedAt || "")}</b></span>
        </div>
        <div class="core-watch-group">
          <h4 class="core-watch-section-title">当前核心</h4>
          ${currentEntries.length
            ? `<div class="core-watch-table-wrap">
                <table class="core-watch-table">
                  <thead>
                    <tr>
                      <th>核心票</th>
                      <th>板块</th>
                      <th>地位 / 交易资格</th>
                      <th>30天窗口</th>
                      <th>历史轨迹</th>
                      <th>最新提示</th>
                    </tr>
                  </thead>
                  <tbody>${renderRows(currentEntries, "current")}</tbody>
                </table>
              </div>`
            : `<p class="decision-note">今天没有新的核心票留在当前池里。</p>`}
        </div>
        <div class="core-watch-group">
          <h4 class="core-watch-section-title">历史留存</h4>
          ${historyEntries.length
            ? `<div class="core-watch-table-wrap">
                <table class="core-watch-table">
                  <thead>
                    <tr>
                      <th>核心票</th>
                      <th>板块</th>
                      <th>地位 / 交易资格</th>
                      <th>30天窗口</th>
                      <th>历史轨迹</th>
                      <th>最新提示</th>
                    </tr>
                  </thead>
                  <tbody>${renderRows(historyEntries, "history")}</tbody>
                </table>
              </div>`
            : `<p class="decision-note">暂时还没有历史留存，等后面跨天抓取后这里会慢慢长出来。</p>`}
        </div>`
      : `<p class="decision-note">当前还没有沉淀出核心观察票，先抓取一次后再看表格。</p>`;
  }


  async function loadCoreWatchPool(forceRemote = false) {

















    if (!coreWatchPanel || !coreWatchBody || !coreWatchMeta) return;















    coreWatchPanel.hidden = false;















    coreWatchMeta.textContent = "\u6b63\u5728\u52a0\u8f7d...";














    try {















      if (!forceRemote && lastHotPayload && lastHotPayload.coreWatch && Array.isArray(lastHotPayload.coreWatch.entries)) {















        renderCoreWatchTable(lastHotPayload.coreWatch);















        return;















      }















      const res = await fetch("/api/core-watch/list", { cache: "no-store" });















      const data = await res.json();















      if (!res.ok) throw new Error(data.error || "\u83b7\u53d6\u6838\u5fc3\u89c2\u5bdf\u5931\u8d25");














      renderCoreWatchTable(data);















    } catch (error) {















      coreWatchMeta.textContent = "\u52a0\u8f7d\u5931\u8d25";














      coreWatchBody.innerHTML = `<p class="decision-note">\u6838\u5fc3\u89c2\u5bdf\u6c60\u52a0\u8f7d\u5931\u8d25\uff1a${escapeHtml(error.message)}</p>`;














    }















  }































  if (coreWatchBtn) {















    coreWatchBtn.onclick = async () => {















      if (coreWatchPanel.hidden) {















        await loadCoreWatchPool();















      } else {















        coreWatchPanel.hidden = true;















        return;















      }















      if (!coreWatchPanel.hidden) {















        coreWatchPanel.scrollIntoView({ behavior: "smooth", block: "start" });















      }















    };















  }































  if (coreWatchPanel && !coreWatchPanel.hidden) {















    renderCoreWatchTable(lastHotPayload && lastHotPayload.coreWatch ? lastHotPayload.coreWatch : payload.coreWatch || null);















  }















}































async function deprecatedHotStocksLegacyRequest(options = {}) {

  const preserveCurrent = Boolean(options.preserveCurrent);

  const preservePostCloseOpportunity = preserveCurrent && hasReadyPostCloseOpportunity(lastHotPayload);

  if (!preservePostCloseOpportunity) renderPostCloseOpportunity(null);















  fetchHotStocks.disabled = true;















  fetchHotStocks.textContent = "抓取中...";















  if (fetchHotStocksDash) {















    fetchHotStocksDash.disabled = true;















    fetchHotStocksDash.textContent = "抓取中...";















  }















  const decisionBtn = document.querySelector("#fetchHotStocksDecision");















  if (decisionBtn) {















    decisionBtn.disabled = true;















    decisionBtn.textContent = "抓取中（约1-2分钟）...";















  }















  const picksBody = document.querySelector("#decisionPicksBody");















  if (picksBody && !preserveCurrent) picksBody.innerHTML = `<p class="decision-note">正在抓取双榜热股、K线与板块行情，生成决策…</p>`;















  if (!preserveCurrent) setText("#frameBias", "正在抓取东方财富 + 同花顺热榜并判断炒作阶段……");















  if (!preserveCurrent) selectedStocks.innerHTML = `<div class="empty-state">正在抓取东方财富和同花顺各前 100 热股，并按你的框架筛选。</div>`;















  if (!preserveCurrent) rejectedStocks.innerHTML = "";































  try {















    let payload = null;
    let payloadSource = "";















    let lastError = null;















    for (const url of ["/api/hot-stocks", publicDataUrl].filter(Boolean)) {















      try {















        const requestResult = await fetchWithTimeout(
          url,
          { cache: "no-store" },
          HOT_STOCKS_FETCH_TIMEOUT_MS,
          async (response) => ({ response, payload: await response.json() }),
        );
        const response = requestResult && requestResult.response ? requestResult.response : requestResult;
        const data = requestResult && Object.prototype.hasOwnProperty.call(requestResult, "payload")
          ? requestResult.payload
          : await response.json();















        if (!response.ok) throw new Error(data.detail || data.error || "抓取失败");















        payload = data;
        payloadSource = url;















        break;















      } catch (error) {















        lastError = error;















      }















    }















    if (!payload) throw lastError || new Error("抓取失败");















    if (!payload.fetchedAt) payload.fetchedAt = new Date().toISOString();















    renderHotStocks(payload);















    loadRealtime(); // 抓取后用最新龙头票刷新「核心指数与个股」实时面板
    return { ok: true, payload, source: payloadSource };















  } catch (error) {

    if (!preservePostCloseOpportunity) renderPostCloseOpportunity(null);















    const rawMessage = String((error && error.message) || "未知错误");
    const message = /Failed to fetch|NetworkError/i.test(rawMessage)
      ? "无法连接本地服务（5173），请确认服务已启动"
      : rawMessage;
    if (!preserveCurrent || !lastHotPayload) {
      selectedStocks.innerHTML = `<div class="empty-state">抓取失败：${escapeHtml(message)}</div>`;
      setText("#frameBias", `抓取失败：${message}`);
      if (picksBody) picksBody.innerHTML = `<p class="decision-note">抓取失败：${escapeHtml(message)}</p>`;
    }
    renderFetchStatus({
      level: "fail",
      label: `✗ 本次抓取失败：${message}`,
      items: [],
    });
    return { ok: false, error: message };















  } finally {















    fetchHotStocks.disabled = false;















    fetchHotStocks.textContent = "抓取热股池并筛选";















    if (fetchHotStocksDash) {















      fetchHotStocksDash.disabled = false;















      fetchHotStocksDash.textContent = "抓取并刷新";















    }















    const decisionBtnDone = document.querySelector("#fetchHotStocksDecision");















    if (decisionBtnDone) {















      decisionBtnDone.disabled = false;















      decisionBtnDone.textContent = "一键抓取并生成决策";















    }















  }















}































const HOT_STOCKS_REFRESH_POLL_TIMEOUT_MS = 120000;
const HOT_STOCKS_REFRESH_POLL_INTERVAL_MS = 1500;
const HOT_STOCKS_REFRESH_REQUEST_TIMEOUT_MS = 10000;

let hotStocksRefreshFlight = null;

function hotStocksSetButtonsLoading(loading) {
  let decisionBtn = null;
  try {
    decisionBtn = document.querySelector("#fetchHotStocksDecision");
  } catch {
    decisionBtn = null;
  }
  const configs = [
    { node: fetchHotStocks, busy: "后台刷新中...", idle: "抓取热股池并筛选" },
    { node: fetchHotStocksDash, busy: "后台刷新中...", idle: "抓取并刷新" },
    { node: decisionBtn, busy: "后台刷新中（保留现有决策）...", idle: "一键抓取并生成决策" },
  ];
  configs.forEach(({ node, busy, idle }) => {
    if (!node) return;
    try { node.disabled = Boolean(loading); } catch { /* 单个节点异常不影响其他按钮恢复 */ }
    try {
      if (loading && typeof node.setAttribute === "function") node.setAttribute("aria-busy", "true");
      if (!loading && typeof node.removeAttribute === "function") node.removeAttribute("aria-busy");
    } catch { /* 同上 */ }
    try { node.textContent = loading ? busy : idle; } catch { /* 同上 */ }
  });
}

function hotStocksFriendlyError(error) {
  const raw = String(error && error.message || error || "未知错误");
  return /Failed to fetch|NetworkError/i.test(raw)
    ? "无法连接本地服务（5173），请确认服务已启动"
    : raw;
}

function hotStocksRenderRefreshStage(stage, details = {}) {
  const hasSnapshot = details.hasSnapshot === undefined ? Boolean(lastHotPayload) : Boolean(details.hasSnapshot);
  const payload = details.payload || (hasSnapshot ? lastHotPayload : null);
  const error = details.error ? hotStocksFriendlyError(details.error) : "";
  const sourceStatus = payload && payload.fetchStatus;
  const rawSnapshotDate = String(payload && (payload.tradingDate
    || payload.generationContext && payload.generationContext.tradingDate
    || payload.market && payload.market.limitStats && payload.market.limitStats.dates
      && payload.market.limitStats.dates.today) || "").trim();
  const snapshotDateMatch = rawSnapshotDate.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  const snapshotDate = snapshotDateMatch
    ? `${snapshotDateMatch[1]}-${snapshotDateMatch[2]}-${snapshotDateMatch[3]}` : "";
  const partial = Boolean(payload && payload.stale === true)
    || Boolean(sourceStatus && sourceStatus.level && sourceStatus.level !== "ok");
  const status = {
    cached: {
      level: "partial",
      label: `↻ 已恢复${snapshotDate ? ` ${snapshotDate} ` : ""}收盘快照 · 正在核对最新交易日`,
      items: sourceStatus && sourceStatus.items || [],
    },
    running: {
      level: "partial",
      label: hasSnapshot
        ? `↻ 已有${snapshotDate ? ` ${snapshotDate} ` : ""}快照 · 后台刷新中（旧结果仅保留展示）`
        : "↻ 尚无快照 · 后台刷新中",
      items: [],
    },
    succeeded: {
      level: partial ? "partial" : "ok",
      label: partial
        ? "✓ 后台刷新完成 · 已载入新快照（部分数据源异常）"
        : "✓ 后台刷新完成 · 已自动载入最新快照",
      items: sourceStatus && sourceStatus.items || [],
    },
    latestTradingDay: {
      level: partial ? "partial" : "ok",
      label: `✓ 后台刷新完成 · 当前无新交易日数据，沿用${details.tradingDate ? ` ${details.tradingDate} ` : "上一交易日"}收盘快照`,
      preserveLabel: true,
      items: sourceStatus && sourceStatus.items || [],
    },
    observationOnly: {
      level: "partial",
      label: `✓ ${snapshotDate ? `${snapshotDate} ` : "当日"}数据已抓取 · 正式决策条件未齐，仅供观察`,
      items: sourceStatus && sourceStatus.items || [],
    },
    legacy: {
      level: "partial",
      label: hasSnapshot
        ? "⚠ 已有快照 · 旧版接口无法跟踪后台完成状态"
        : "⚠ 旧版接口未返回可确认的新快照",
      items: sourceStatus && sourceStatus.items || [],
    },
    failed: {
      level: hasSnapshot ? "partial" : "fail",
      label: hasSnapshot
        ? `⚠ 后台刷新失败 · 仍显示${snapshotDate ? ` ${snapshotDate} ` : "原"}快照：${error || "未知错误"}`
        : `✗ 后台刷新失败：${error || "未知错误"}`,
      items: [],
    },
  }[stage];
  if (!status) return;
  try {
    renderFetchStatus(status, payload);
  } catch (error) {
    try { console.error("刷新状态渲染失败", error); } catch { /* no-op */ }
  }
}

async function hotStocksJsonRequest(url, options = {}, timeoutMs = HOT_STOCKS_REFRESH_REQUEST_TIMEOUT_MS) {
  const result = await fetchWithTimeout(
    url,
    options,
    timeoutMs,
    async (response) => {
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        if (response.status !== 404) throw error;
      }
      return { response, payload };
    },
  );
  if (result && result.response) return result;
  const response = result;
  return { response, payload: await response.json() };
}

function cloudCurrentShanghaiTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(value)).replace(/\//g, "-");
  } catch {
    return "";
  }
}

function setDecisionAuthority(authority, payload, detail = "") {
  activeDecisionAuthority = authority;
  activeDecisionAuthorityDetail = String(detail || "");
  const laneKey = authority === "cloud" ? "cloud" : authority === "local" ? "local" : "";
  if (laneKey && payload && typeof decisionAuthorityLanes !== "undefined"
    && typeof rememberDecisionAuthorityLane === "function") {
    const retainedExecution = decisionAuthorityLanes[laneKey]
      && decisionAuthorityLanes[laneKey].payload === payload
      && decisionAuthorityLanes[laneKey].executionAuthority === true;
    rememberDecisionAuthorityLane(laneKey, payload, {
      active: true,
      detail,
      executionAuthority: retainedExecution,
    });
  }
  const unifiedProjection = typeof resolveUnifiedDecisionChainProjection === "function"
    ? resolveUnifiedDecisionChainProjection(payload)
    : { contractReady: authority === "cloud" };
  activeUnifiedProjectionReady = Boolean(authority === "cloud" && unifiedProjection.contractReady);
  if (typeof renderDecisionAuthorityLaneCards === "function") renderDecisionAuthorityLaneCards();
  if (!cloudCurrentSyncStatus) return;
  const generationId = payload && (
    payload.tomorrowDecision && payload.tomorrowDecision.generationId
    || payload.generationId
    || payload.decisionBasis && payload.decisionBasis.generationId
  );
  const fetchedAt = payload && payload.fetchedAt;
  const tradingDate = payload && (
    payload.market && payload.market.snapshot && payload.market.snapshot.tradingDate
    || payload.market && payload.market.limitStats && payload.market.limitStats.dates
      && payload.market.limitStats.dates.today
  );
  if (authority === "cloud") {
    const meta = typeof decisionAuthorityLaneMeta === "function"
      ? decisionAuthorityLaneMeta("cloud", payload)
      : { tradingDate };
    const time = typeof decisionAuthorityGenerationClock === "function"
      ? decisionAuthorityGenerationClock(meta)
      : cloudCurrentShanghaiTime(fetchedAt);
    cloudCurrentSyncStatus.textContent = `✓ 当前决策已同步${meta.tradingDate ? ` · ${meta.tradingDate}` : ""}${time !== "--" ? ` · ${time}` : ""}${activeUnifiedProjectionReady ? "" : " · 规则校验未通过"}`;
    cloudCurrentSyncStatus.dataset.syncStatus = "succeeded";
    cloudCurrentSyncStatus.title = detail || `authority=cloud_formal；generation=${generationId || "--"}`;
  } else if (authority === "local") {
    const meta = typeof decisionAuthorityLaneMeta === "function"
      ? decisionAuthorityLaneMeta("local", payload)
      : { tradingDate };
    const time = typeof decisionAuthorityGenerationClock === "function"
      ? decisionAuthorityGenerationClock(meta)
      : cloudCurrentShanghaiTime(fetchedAt);
    cloudCurrentSyncStatus.textContent = `当前决策已更新${meta.tradingDate ? ` · ${meta.tradingDate}` : ""}${time !== "--" ? ` · ${time}` : ""}`;
    cloudCurrentSyncStatus.dataset.syncStatus = "local";
    cloudCurrentSyncStatus.title = detail || `authority=local_observation；executionAuthority=false${tradingDate ? `；交易日=${tradingDate}` : ""}`;
  } else {
    cloudCurrentSyncStatus.textContent = "正式决策待同步";
    cloudCurrentSyncStatus.dataset.syncStatus = "idle";
    cloudCurrentSyncStatus.title = detail;
  }
}

function renderCloudCurrentSyncStatus(payload) {
  if (!cloudCurrentSyncStatus) return;
  const sync = payload && payload.sync && typeof payload.sync === "object" ? payload.sync : payload || {};
  cloudCurrentAuthorityConfigured = sync.configured === false ? false
    : sync.configured === true ? true : cloudCurrentAuthorityConfigured;
  const raw = String(sync.status || sync.state || "idle").toLowerCase();
  const status = raw === "success" ? "succeeded" : raw;
  const last = sync.lastResult || sync.result || {};
  const fetchedAt = last.fetchedAt || sync.result && sync.result.fetchedAt;
  const time = cloudCurrentShanghaiTime(fetchedAt);
  const labels = {
    disabled: "云端正式决策未配置",
    idle: sync.snapshotAvailable ? "已有已验证正式决策" : "正式决策待同步",
    running: "↻ 正在核对云端正式决策",
    succeeded: `✓ 云端正式决策已核对${time ? ` · ${time}` : ""}${activeUnifiedProjectionReady ? " · 统一决策链v3" : " · 失败关闭"}`,
    failed: sync.snapshotAvailable
      ? "新快照未通过质量门 · 沿用上次已验证版本"
      : "云端正式决策暂不可用",
  };
  cloudCurrentSyncStatus.textContent = labels[status] || labels.idle;
  cloudCurrentSyncStatus.dataset.syncStatus = status;
  cloudCurrentSyncStatus.title = sync.lastError || sync.disabledReason
    || (Array.isArray(sync.lastErrorDetails && sync.lastErrorDetails.reasons)
      ? sync.lastErrorDetails.reasons.join("；") : "")
    || (activeDecisionAuthority === "cloud" ? activeDecisionAuthorityDetail : "");
}

async function readCloudCurrentSyncStatus() {
  try {
    const { response, payload } = await hotStocksJsonRequest(
      "/api/cloud-current-sync/status",
      { cache: "no-store" },
      HOT_STOCKS_REFRESH_REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) throw new Error(payload && payload.error || "云端正式决策状态读取失败");
    renderCloudCurrentSyncStatus(payload);
    return payload.sync || payload;
  } catch (error) {
    if (cloudCurrentSyncStatus && activeDecisionAuthority !== "cloud") {
      cloudCurrentSyncStatus.textContent = "云端正式决策状态不可用";
      cloudCurrentSyncStatus.dataset.syncStatus = "failed";
      cloudCurrentSyncStatus.title = error.message;
    }
    return null;
  }
}

async function loadVerifiedCloudCurrentPayload(options = {}) {
  const { response, payload } = await hotStocksJsonRequest(
    "/api/cloud-current-sync/payload",
    { cache: "no-store" },
    HOT_STOCKS_FETCH_TIMEOUT_MS,
  );
  if (!response.ok) {
    const error = new Error(payload && payload.error || "本机尚无已验证的云端正式决策");
    error.code = payload && payload.code || `HTTP_${response.status}`;
    throw error;
  }
  if (!payload || typeof payload !== "object") throw new Error("云端正式决策内容为空");
  const expectedGeneration = postCloseOpportunityText(options.expectedGeneration);
  const payloadGeneration = premarketDirectBuyPayloadGeneration(payload);
  if (options.directBuyFresh === true && (!expectedGeneration || payloadGeneration !== expectedGeneration)) {
    const error = new Error("云端刷新代次与正式决策快照不一致，已阻断直接买入提示");
    error.code = "CLOUD_CURRENT_GENERATION_MISMATCH";
    throw error;
  }
  const directBuyEligible = options.directBuyFresh === true
    ? setPremarketDirectBuyPayloadFresh(payload, true)
    : false;
  setPremarketDirectBuyPayloadFresh(payload, false);
  if (options.directBuyFresh === true && !directBuyEligible) {
    const error = new Error("云端正式决策快照已过期或来源状态不允许执行");
    error.code = "CLOUD_CURRENT_NOT_FRESH";
    throw error;
  }
  const projectionDetail = payload.localUnifiedProjection
    && payload.localUnifiedProjection.status === "ready"
    ? "云端原始股票与交易许可保持不变；周期、情绪和T-1状态使用本机同代统一因子v6投影。"
    : "";
  const detail = [options.detail, projectionDetail].filter(Boolean).join("；");
  const laneResult = acceptDecisionAuthorityLane("cloud", payload, {
    detail,
    executionAuthority: directBuyEligible,
    forceActivate: options.forceActivate === true,
    preferIfNewer: options.preferIfNewer !== false,
  });
  if (laneResult.activated) {
    hotStocksRenderRefreshStage("cached", { hasSnapshot: true, payload });
    loadRealtime();
  }
  if (directBuyEligible && laneResult.activated && laneResult.lane.executionAuthority === true) {
    setPremarketDirectBuyPayloadFresh(payload, true);
    try {
      renderPremarketFlow(payload);
    } catch (error) {
      setPremarketDirectBuyPayloadFresh(payload, false);
      throw error;
    }
  } else {
    setPremarketDirectBuyPayloadFresh(payload, false);
    if (laneResult.activated) renderPremarketFlow(payload);
  }
  return payload;
}

async function pollCloudCurrentSync() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const sync = await readCloudCurrentSyncStatus();
    if (!sync || String(sync.status || sync.state || "").toLowerCase() !== "running") return sync;
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  }
  throw new Error("云端正式决策核对超过3分钟；将继续显示上次已验证版本");
}

async function runCloudCurrentSync(options = {}) {
  if (cloudCurrentSyncFlight) return cloudCurrentSyncFlight;
  const flight = (async () => {
    if (lastHotPayload) {
      setPremarketDirectBuyPayloadFresh(lastHotPayload, false);
      renderPremarketFlow(lastHotPayload);
    }
    if (cloudCurrentSyncStatus) {
      cloudCurrentSyncStatus.textContent = "↻ 正在核对云端正式决策";
      cloudCurrentSyncStatus.dataset.syncStatus = "running";
    }
    try {
      const { response, payload } = await hotStocksJsonRequest(
        "/api/cloud-current-sync/run",
        { method: "POST", cache: "no-store" },
        HOT_STOCKS_REFRESH_REQUEST_TIMEOUT_MS,
      );
      if (!response.ok) {
        renderCloudCurrentSyncStatus(payload);
        return { ok: false, configured: payload && payload.sync && payload.sync.configured !== false, error: payload && payload.error };
      }
      renderCloudCurrentSyncStatus(payload);
      const sync = await pollCloudCurrentSync();
      const snapshot = await loadVerifiedCloudCurrentPayload({
        detail: "云端原始快照已通过服务器侧与电脑侧双重质量校验。",
        directBuyFresh: true,
        expectedGeneration: sync && (sync.generationId || sync.lastResult && (sync.lastResult.generationId || sync.lastResult.fetchedAt)),
      });
      return { ok: true, configured: true, mode: "cloud-canonical", payload: snapshot, sync };
    } catch (error) {
      const sync = await readCloudCurrentSyncStatus();
      try {
        const snapshot = await loadVerifiedCloudCurrentPayload({
          detail: `云端新代次未通过质量门或暂时不可达；继续沿用上次已验证版本。${error.message || ""}`,
        });
        return { ok: true, configured: cloudCurrentAuthorityConfigured !== false, fresh: false, mode: "cloud-canonical-retained", payload: snapshot, sync };
      } catch {
        if (cloudCurrentSyncStatus) {
          cloudCurrentSyncStatus.textContent = "云端正式决策暂不可用";
          cloudCurrentSyncStatus.dataset.syncStatus = "failed";
          cloudCurrentSyncStatus.title = error.message || "";
        }
        return { ok: false, configured: cloudCurrentAuthorityConfigured !== false, error: error.message || "云端正式决策同步失败" };
      }
    }
  })();
  cloudCurrentSyncFlight = flight;
  try {
    return await flight;
  } finally {
    if (cloudCurrentSyncFlight === flight) cloudCurrentSyncFlight = null;
  }
}

function rawClosingComparison(official, observed) {
  const pathValue = (root, pathText) => pathText.split(".").reduce((value, key) => (
    value == null ? undefined : value[key]
  ), root);
  const stable = (value) => JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
  });
  const fields = [
    ["交易日", "market.snapshot.tradingDate"],
    ["指数", "market.snapshot.indexes"],
    ["两市成交额", "market.snapshot.shszAmountYi"],
    ["全市场成交额", "market.snapshot.totalAmountYi"],
    ["上涨家数", "market.snapshot.upCount"],
    ["下跌家数", "market.snapshot.downCount"],
    ["平盘家数", "market.snapshot.flatCount"],
    ["市场宽度", "market.snapshot.breadth"],
    ["指数均幅", "market.snapshot.avgIndexChange"],
    ["涨停数", "market.limitStats.ztToday"],
    ["跌停数", "market.limitStats.dtToday"],
    ["昨日涨停数", "market.limitStats.ztPrev"],
    ["昨日跌停数", "market.limitStats.dtPrev"],
  ];
  const differences = fields.filter(([, pathText]) => (
    stable(pathValue(official, pathText)) !== stable(pathValue(observed, pathText))
  )).map(([label]) => label);
  return { total: fields.length, equal: fields.length - differences.length, differences };
}

async function runLocalHotStocksVerification() {
  if (localVerifyHotStocksBtn) {
    localVerifyHotStocksBtn.disabled = true;
    localVerifyHotStocksBtn.textContent = "本机核验中...";
  }
  const laneAware = typeof decisionAuthorityLanes !== "undefined"
    && typeof rememberDecisionAuthorityLane === "function";
  const official = laneAware && decisionAuthorityLanes.cloud
    ? decisionAuthorityLanes.cloud.payload
    : activeDecisionAuthority === "cloud" ? lastHotPayload : null;
  const officialDirectBuyFresh = Boolean(official && premarketDirectBuyPayloadFresh(official));
  const officialGeneration = premarketDirectBuyPayloadGeneration(official);
  try {
    const localResult = await loadHotStocks({ forceLocal: true, reason: "local-verification" });
    if (!localResult || !localResult.ok || !localResult.payload) return localResult;
    const comparison = official ? rawClosingComparison(official, localResult.payload) : null;
    const comparisonDetail = comparison && comparison.differences.length === 0
      ? `本机交叉核验：${comparison.equal}/${comparison.total}项核心收盘原始值一致；云端正式快照单独保留。`
      : comparison
        ? `本机交叉核验：${comparison.equal}/${comparison.total}项一致；差异=${comparison.differences.join("、") || "未知"}。`
        : "本机独立观察；尚无云端正式快照可供交叉核验。";
    if (laneAware) {
      setPremarketDirectBuyPayloadFresh(localResult.payload, false);
      localResult.payload.executionAuthority = false;
      lastHotPayload = localResult.payload;
      rememberDecisionAuthorityLane("local", localResult.payload, {
        active: true,
        detail: comparisonDetail,
        executionAuthority: false,
      });
      if (decisionAuthorityLanes.cloud) decisionAuthorityLanes.cloud.detail = comparisonDetail;
      setDecisionAuthority("local", localResult.payload, comparisonDetail);
      try { renderPremarketFlow(localResult.payload); } catch { /* 本机核验始终保持观察权限 */ }
      renderDecisionAuthorityLaneCards();
      if (localResult.reusedLatestCompletedTradingDay === true) {
        const latestCompletedTradingDay = resolveLatestCompletedTradingDaySnapshot(localResult.payload);
        hotStocksRenderRefreshStage("latestTradingDay", {
          hasSnapshot: true,
          payload: localResult.payload,
          tradingDate: latestCompletedTradingDay.tradingDate,
        });
      }
    } else if (official) {
      // 兼容仅抽取本函数的旧测试环境；实际页面使用上方双 lane，不再恢复旧云端覆盖本机。
      try {
        await loadVerifiedCloudCurrentPayload({
          detail: comparison && comparison.differences.length === 0
            ? `本机交叉核验：${comparison.equal}/${comparison.total}项核心收盘原始值一致；正式决策仍使用云端同代快照。`
            : `本机交叉核验：${comparison && comparison.equal || 0}/${comparison && comparison.total || 0}项一致；差异=${comparison && comparison.differences.join("、") || "未知"}。本机结果已阻断，未覆盖正式决策。`,
          directBuyFresh: officialDirectBuyFresh,
          expectedGeneration: officialGeneration,
        });
      } catch (error) {
        setPremarketDirectBuyPayloadFresh(localResult.payload, false);
        if (lastHotPayload) {
          setPremarketDirectBuyPayloadFresh(lastHotPayload, false);
          try { renderPremarketFlow(lastHotPayload); } catch { /* 核验恢复失败时保持不可执行 */ }
        }
        throw error;
      }
    }
    return { ...localResult, comparison };
  } finally {
    if (localVerifyHotStocksBtn) {
      localVerifyHotStocksBtn.disabled = false;
      localVerifyHotStocksBtn.textContent = "本机独立核验";
    }
  }
}

async function loadHotStocksLegacyRequest() {
  let lastError = null;
  for (const url of ["/api/hot-stocks", publicDataUrl].filter(Boolean)) {
    try {
      const { response, payload } = await hotStocksJsonRequest(
        url,
        { cache: "no-store" },
        HOT_STOCKS_FETCH_TIMEOUT_MS,
      );
      if (!response.ok) throw new Error(payload && (payload.detail || payload.error) || "抓取失败");
      if (!payload || typeof payload !== "object") throw new Error("抓取结果为空");
      setPremarketDirectBuyPayloadFresh(payload, false);
      renderHotStocks(payload);
      setDecisionAuthority("local", payload);
      loadRealtime();
      const directBuyFresh = url === "/api/hot-stocks"
        && payload.servedFromCache !== true
        && payload.backgroundRefresh !== true
        && payload.restoredFromDisk !== true
        && setPremarketDirectBuyPayloadFresh(payload, true);
      if (directBuyFresh) {
        try {
          renderPremarketFlow(payload);
        } catch (error) {
          setPremarketDirectBuyPayloadFresh(payload, false);
          throw error;
        }
      }
      return { ok: true, fresh: directBuyFresh, payload, source: url };
    } catch (error) {
      if (lastHotPayload) {
        setPremarketDirectBuyPayloadFresh(lastHotPayload, false);
        try { renderPremarketFlow(lastHotPayload); } catch { /* failed load remains observation-only */ }
      }
      lastError = error;
    }
  }
  return { ok: false, error: hotStocksFriendlyError(lastError || new Error("抓取失败")) };
}

function normalizeHotStocksRefreshContract(payload) {
  const raw = payload && payload.refresh && typeof payload.refresh === "object"
    ? payload.refresh
    : payload && payload.job && typeof payload.job === "object"
      ? payload.job
      : null;
  if (!raw) return null;
  const sourceStatus = String(raw.status || raw.state || "idle").toLowerCase();
  const statusMap = {
    queued: "running",
    pending: "running",
    refreshing: "running",
    complete: "succeeded",
    completed: "succeeded",
    success: "succeeded",
    done: "succeeded",
    error: "failed",
  };
  const status = ["idle", "running", "succeeded", "failed"].includes(sourceStatus)
    ? sourceStatus
    : statusMap[sourceStatus] || "idle";
  return {
    status,
    inFlight: raw.inFlight === true || status === "running",
    startedAt: raw.startedAt || null,
    completedAt: raw.completedAt || raw.finishedAt || null,
    lastSuccessAt: raw.lastSuccessAt || (status === "succeeded" ? raw.finishedAt || raw.fetchedAt || null : null),
    generationId: raw.generationId || raw.taskId || (status === "succeeded" ? raw.fetchedAt || null : null),
    lastError: raw.lastError || raw.error || null,
  };
}

function hotStocksRefreshFailure(state) {
  const error = new Error(state && state.lastError || "后台刷新失败");
  error.code = "HOT_STOCKS_REFRESH_FAILED";
  return error;
}

function hotStocksRefreshTimeout() {
  const error = new Error("后台刷新超过120秒，已停止轮询；后台任务可能仍在继续");
  error.code = "HOT_STOCKS_REFRESH_TIMEOUT";
  return error;
}

async function pollHotStocksRefresh(initialState, options = {}) {
  let state = initialState;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const sleep = typeof options.sleep === "function"
    ? options.sleep
    : (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
  const deadlineAt = Number.isFinite(Number(options.deadlineAt))
    ? Number(options.deadlineAt)
    : now() + HOT_STOCKS_REFRESH_POLL_TIMEOUT_MS;
  const intervalMs = Math.max(0, Number(options.intervalMs ?? HOT_STOCKS_REFRESH_POLL_INTERVAL_MS));
  const requestStatus = typeof options.requestStatus === "function"
    ? options.requestStatus
    : async (remainingMs) => {
        const { response, payload } = await hotStocksJsonRequest(
          "/api/hot-stocks/status",
          { cache: "no-store" },
          Math.max(1, Math.min(HOT_STOCKS_REFRESH_REQUEST_TIMEOUT_MS, remainingMs)),
        );
        if (!response.ok) throw new Error(payload && (payload.detail || payload.error) || "刷新状态查询失败");
        const contract = normalizeHotStocksRefreshContract(payload);
        if (!contract) throw new Error("刷新状态响应缺少 refresh 字段");
        return contract;
      };

  while (true) {
    if (state && state.status === "succeeded") return state;
    if (state && state.status === "failed") throw hotStocksRefreshFailure(state);
    const remainingBeforeSleep = deadlineAt - now();
    if (remainingBeforeSleep <= 0) throw hotStocksRefreshTimeout();
    await sleep(Math.min(intervalMs, remainingBeforeSleep));
    const remainingBeforeRequest = deadlineAt - now();
    if (remainingBeforeRequest <= 0) throw hotStocksRefreshTimeout();
    state = await requestStatus(remainingBeforeRequest);
  }
}

async function loadHotStocksRefreshCache(options = {}) {
  const { response, payload } = await hotStocksJsonRequest(
    "/api/hot-stocks/cache",
    { cache: "no-store" },
    HOT_STOCKS_FETCH_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(payload && (payload.detail || payload.error) || "最新快照读取失败");
  if (!payload || typeof payload !== "object") throw new Error("最新快照内容为空");
  const expectedGeneration = postCloseOpportunityText(options.expectedGeneration);
  const payloadGeneration = premarketDirectBuyPayloadGeneration(payload);
  if (!expectedGeneration || !payloadGeneration || payloadGeneration !== expectedGeneration) {
    const error = new Error("后台刷新成功代次与缓存快照不一致，已保留旧页面并阻断执行");
    error.code = "HOT_STOCKS_REFRESH_GENERATION_MISMATCH";
    throw error;
  }
  const directBuyEligible = setPremarketDirectBuyPayloadFresh(payload, true);
  setPremarketDirectBuyPayloadFresh(payload, false);
  // 成功且代次一致的抓取结果始终可以用于观察。执行资格由独立的
  // freshness/quality 门控制，不能因为正式决策被阻断就把整页数据隐藏。
  payload.clientRefreshVerified = true;
  renderHotStocks(payload);
  setDecisionAuthority("local", payload);
  loadRealtime();
  setPremarketDirectBuyPayloadFresh(payload, directBuyEligible);
  try {
    renderPremarketFlow(payload);
  } catch (error) {
    setPremarketDirectBuyPayloadFresh(payload, false);
    throw error;
  }
  return payload;
}

async function performHotStocksLoad(options = {}) {
  let preserveCurrent = false;
  let preservePostCloseOpportunity = false;
  let picksBody = null;
  try {
    hotStocksSetButtonsLoading(true);
    preserveCurrent = Boolean(options && options.preserveCurrent) || Boolean(lastHotPayload);
    preservePostCloseOpportunity = preserveCurrent && hasReadyPostCloseOpportunity(lastHotPayload);

    if (lastHotPayload) {
      setPremarketDirectBuyPayloadFresh(lastHotPayload, false);
      renderPremarketFlow(lastHotPayload);
    }

    if (!preservePostCloseOpportunity) renderPostCloseOpportunity(null);
    picksBody = document.querySelector("#decisionPicksBody");
    if (picksBody && !preserveCurrent) picksBody.innerHTML = `<p class="decision-note">正在启动后台抓取，生成决策…</p>`;
    if (!preserveCurrent) {
      setText("#frameBias", "正在启动后台抓取并生成决策……");
      if (selectedStocks) selectedStocks.innerHTML = `<div class="empty-state">正在抓取东方财富和同花顺热榜，请稍候。</div>`;
      if (rejectedStocks) rejectedStocks.innerHTML = "";
    }
    hotStocksRenderRefreshStage("running", { hasSnapshot: preserveCurrent });

    const startResult = await hotStocksJsonRequest(
      "/api/hot-stocks/refresh",
      { method: "POST", cache: "no-store" },
      HOT_STOCKS_REFRESH_REQUEST_TIMEOUT_MS,
    );
    const refreshContract = normalizeHotStocksRefreshContract(startResult.payload);
    if (startResult.response.status === 404) {
      const legacyResult = await loadHotStocksLegacyRequest({ preserveCurrent });
      const fresh = Boolean(legacyResult && legacyResult.ok === true && legacyResult.fresh === true);
      if (legacyResult && legacyResult.ok) {
        hotStocksRenderRefreshStage(fresh ? "succeeded" : "legacy", {
          hasSnapshot: Boolean(lastHotPayload),
          payload: legacyResult.payload,
        });
        return { ...legacyResult, fresh, mode: "legacy" };
      }
      hotStocksRenderRefreshStage("failed", {
        hasSnapshot: Boolean(lastHotPayload),
        error: legacyResult && legacyResult.error || "旧版抓取接口失败",
      });
      return { ...(legacyResult || { ok: false }), fresh: false, mode: "legacy" };
    }
    if (!startResult.response.ok) {
      throw new Error(startResult.payload && (startResult.payload.detail || startResult.payload.error) || "后台刷新启动失败");
    }
    if (!refreshContract) throw new Error("后台刷新响应缺少 refresh 字段");

    const completedRefresh = await pollHotStocksRefresh(refreshContract);
    const payload = await loadHotStocksRefreshCache({ expectedGeneration: completedRefresh.generationId });
    const fresh = premarketDirectBuyPayloadFresh(payload);
    const latestCompletedTradingDay = resolveLatestCompletedTradingDaySnapshot(payload);
    const reuseLatestCompletedTradingDay = !fresh && latestCompletedTradingDay.eligible;
    const observationOnly = !fresh && !reuseLatestCompletedTradingDay;
    hotStocksRenderRefreshStage(
      reuseLatestCompletedTradingDay ? "latestTradingDay" : observationOnly ? "observationOnly" : "succeeded",
      {
        hasSnapshot: true,
        payload,
        tradingDate: latestCompletedTradingDay.tradingDate,
      },
    );
    return {
      ok: true,
      fresh,
      observationOnly,
      reusedLatestCompletedTradingDay: reuseLatestCompletedTradingDay,
      mode: "background",
      source: "/api/hot-stocks",
      refreshSource: "/api/hot-stocks/refresh",
      transport: "background-refresh",
      payload,
      refresh: completedRefresh,
    };
  } catch (error) {
    if (lastHotPayload) {
      setPremarketDirectBuyPayloadFresh(lastHotPayload, false);
      try { renderPremarketFlow(lastHotPayload); } catch { /* failed refresh remains observation-only */ }
    }
    try {
      if (!preservePostCloseOpportunity) renderPostCloseOpportunity(null);
    } catch { /* 终态仍由外层 finally 恢复 */ }
    const message = hotStocksFriendlyError(error);
    if (!preserveCurrent || !lastHotPayload) {
      try { if (selectedStocks) selectedStocks.innerHTML = `<div class="empty-state">抓取失败：${escapeHtml(message)}</div>`; } catch { /* no-op */ }
      try { setText("#frameBias", `抓取失败：${message}`); } catch { /* no-op */ }
      try { if (picksBody) picksBody.innerHTML = `<p class="decision-note">抓取失败：${escapeHtml(message)}</p>`; } catch { /* no-op */ }
    }
    hotStocksRenderRefreshStage("failed", { hasSnapshot: Boolean(lastHotPayload), error });
    return { ok: false, fresh: false, error: message };
  } finally {
    hotStocksSetButtonsLoading(false);
  }
}

async function loadHotStocks(options = {}) {
  if (hotStocksRefreshFlight) return hotStocksRefreshFlight;
  const flight = performHotStocksLoad(options && typeof options === "object" ? options : {});
  hotStocksRefreshFlight = flight;
  try {
    return await flight;
  } finally {
    if (hotStocksRefreshFlight === flight) hotStocksRefreshFlight = null;
  }
}

async function restoreSavedHotStocks() {
  try {
    const { response, payload } = await hotStocksJsonRequest(
      "/api/hot-stocks/cache",
      { cache: "no-store" },
      HOT_STOCKS_FETCH_TIMEOUT_MS,
    );
    if (!response.ok) return false;
    setPremarketDirectBuyPayloadFresh(payload, false);
    acceptDecisionAuthorityLane("local", payload, {
      detail: "本机磁盘中的最新完整决策快照。",
      preferIfNewer: true,
    });
    hotStocksRenderRefreshStage("cached", { hasSnapshot: true, payload });
    loadRealtime();
    return true;
  } catch {
    return false;
  }
}

async function refreshRestoredHotStocks(payload) {
  const restoredPayload = payload && typeof payload === "object" ? payload : null;
  if (!restoredPayload) return loadHotStocks({ preserveCurrent: true, reason: "initialize-cache-refresh", forceLocal: true });
  try {
    const { response, payload: statusPayload } = await hotStocksJsonRequest(
      "/api/hot-stocks/status",
      { cache: "no-store" },
      HOT_STOCKS_REFRESH_REQUEST_TIMEOUT_MS,
    );
    const refresh = response.ok ? normalizeHotStocksRefreshContract(statusPayload) : null;
    const restoredGeneration = premarketDirectBuyPayloadGeneration(restoredPayload);
    if (refresh && refresh.status === "succeeded" && restoredGeneration
      && refresh.generationId === restoredGeneration) {
      restoredPayload.clientRefreshVerified = true;
      renderDecisionAuthorityLaneCards();
      hotStocksRenderRefreshStage("succeeded", { hasSnapshot: true, payload: restoredPayload });
      return { ok: true, fresh: false, mode: "already-refreshed", payload: restoredPayload, refresh };
    }
  } catch { /* status is advisory; the real refresh below remains authoritative */ }
  return loadHotStocks({ preserveCurrent: true, reason: "initialize-cache-refresh", forceLocal: true });
}

async function initializeHotStocks() {
  const restored = await restoreSavedHotStocks();
  const restoredLocalPayload = restored && decisionAuthorityLanes.local
    ? decisionAuthorityLanes.local.payload : null;
  let retainedCloud = null;
  try {
    retainedCloud = await loadVerifiedCloudCurrentPayload({
      detail: "已验证云端决策；系统会与本机快照自动比较代次。",
    });
  } catch { /* 首次启用时可能还没有云端正式快照 */ }
  const cloudStatus = await readCloudCurrentSyncStatus();
  if (cloudStatus && cloudStatus.configured === true) {
    if (retainedCloud || restored) {
      runCloudCurrentSync().catch(() => {});
      if (restored) {
        refreshRestoredHotStocks(restoredLocalPayload).catch(() => {});
      }
      const activeLane = decisionAuthorityLanes[decisionAuthorityLanes.active] || null;
      return {
        ok: true,
        fresh: false,
        mode: "latest-verified-snapshot",
        payload: activeLane && activeLane.payload || retainedCloud,
      };
    }
    const cloud = await runCloudCurrentSync();
    if (cloud && cloud.ok) return cloud;
  }
  if (restored) {
    refreshRestoredHotStocks(restoredLocalPayload).catch(() => {});
    const activeLane = decisionAuthorityLanes[decisionAuthorityLanes.active] || null;
    return { ok: true, fresh: false, mode: "local-cache", payload: activeLane && activeLane.payload || lastHotPayload };
  }
  return loadHotStocks({ preserveCurrent: restored, reason: "initialize", forceLocal: true });
}

const CLOUD_HISTORY_SYNC_POLL_MS = 1200;
const CLOUD_HISTORY_SYNC_POLL_TIMEOUT_MS = 300000;
let cloudHistorySyncFlight = null;

function cloudHistorySyncCounts(sync) {
  const result = sync && (sync.lastResult || sync.result || sync.summary) || {};
  const count = (value, fallback = 0) => {
    if (Array.isArray(value)) return value.length;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const imported = count(result.imported, count(result.importedCount));
  const quarantined = count(result.quarantined, count(result.quarantinedCount));
  const failed = count(result.failed, count(result.failedCount));
  const structurallyAccepted = count(
    result.structurallyAcceptedEntries,
    count(result.eligibleEntries, count(result.manifestEntries)),
  );
  const ineligible = count(
    result.ineligibleEntries,
    quarantined + count(result.localInvalid, count(result.localInvalidCount)),
  );
  const exact = count(result.exactEntries);
  const legacy = count(result.legacyEligibleEntries);
  return {
    imported,
    revisions: count(
      result.revisions,
      count(result.revisionCount, count(result.conflicts) + count(result.quarantined)),
    ),
    quarantined,
    checked: structurallyAccepted,
    usable: count(
      result.formalEligibleEntries,
      exact + legacy || Math.max(0, structurallyAccepted - ineligible - failed),
    ),
    isolated: ineligible,
    exact,
    legacy,
    failed,
  };
}

function renderCloudHistorySyncStatus(payload) {
  if (!cloudHistorySyncStatus) return;
  const sync = payload && payload.sync && typeof payload.sync === "object" ? payload.sync : payload || {};
  const rawStatus = String(sync.status || sync.state || "idle").toLowerCase();
  const counts = cloudHistorySyncCounts(sync);
  const normalizedStatus = rawStatus === "success" ? "succeeded" : rawStatus;
  // Older backends used "partial" for intentional quality isolation.  Do not
  // present that as a failure when failedCount is zero.
  const status = normalizedStatus === "partial" && counts.failed === 0
    ? "succeeded"
    : normalizedStatus;
  const labels = {
    disabled: "云端补齐未配置",
    idle: "云端待核对",
    running: "↻ 正在核对云端历史",
    succeeded: `✓ 云端${counts.checked}份已核对 · 可用${counts.usable}份 · 隔离${counts.isolated}份`,
    partial: `⚠ 云端${counts.checked}份已核对 · 可用${counts.usable}份 · 隔离${counts.isolated}份 · 失败${counts.failed}份`,
    failed: `⚠ 云端核对失败${counts.failed ? ` ${counts.failed}份` : ""} · 本地数据未受影响`,
  };
  cloudHistorySyncStatus.textContent = labels[status] || labels.idle;
  cloudHistorySyncStatus.dataset.syncStatus = status;
  const detail = sync.lastError || sync.disabledReason
    || (Array.isArray(sync.errors) && sync.errors[0] && sync.errors[0].message) || "";
  cloudHistorySyncStatus.title = detail
    || (counts.isolated ? `${counts.isolated}份低质量快照仅保存为隔离修订，未进入正式历史` : "");
  if (cloudHistorySyncBtn) {
    cloudHistorySyncBtn.disabled = status === "running" || status === "disabled";
    cloudHistorySyncBtn.textContent = status === "running" ? "☁ 核对中..." : "☁ 云端补齐";
  }
}

async function readCloudHistorySyncStatus() {
  try {
    const response = await fetch("/api/cloud-history-sync/status", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "云端同步状态读取失败");
    renderCloudHistorySyncStatus(payload);
    return payload.sync || payload;
  } catch (error) {
    renderCloudHistorySyncStatus({ status: "failed", lastError: error.message });
    return null;
  }
}

async function pollCloudHistorySync() {
  const deadline = Date.now() + CLOUD_HISTORY_SYNC_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const sync = await readCloudHistorySyncStatus();
    if (!sync || String(sync.status || sync.state || "").toLowerCase() !== "running") return sync;
    await new Promise((resolve) => setTimeout(resolve, CLOUD_HISTORY_SYNC_POLL_MS));
  }
  throw new Error("云端历史核对超过5分钟；后台可能仍在继续，本地数据不会被覆盖");
}

async function runCloudHistorySync() {
  if (cloudHistorySyncFlight) return cloudHistorySyncFlight;
  const flight = (async () => {
    if (cloudHistorySyncBtn) {
      cloudHistorySyncBtn.disabled = true;
      cloudHistorySyncBtn.textContent = "☁ 核对中...";
    }
    renderCloudHistorySyncStatus({ status: "running" });
    try {
      const response = await fetch("/api/cloud-history-sync/run", { method: "POST", cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "云端历史核对启动失败");
      renderCloudHistorySyncStatus(payload);
      const sync = await pollCloudHistorySync();
      const finalStatus = String(sync && (sync.status || sync.state) || "").toLowerCase();
      if (["succeeded", "success", "partial"].includes(finalStatus)) {
        try { await loadArchiveList(); } catch { /* 历史列表下次进入时仍会重新读取 */ }
      }
      return sync;
    } catch (error) {
      renderCloudHistorySyncStatus({ status: "failed", lastError: error.message });
      return null;
    } finally {
      if (cloudHistorySyncBtn && cloudHistorySyncStatus?.dataset.syncStatus !== "running") {
        cloudHistorySyncBtn.disabled = cloudHistorySyncStatus?.dataset.syncStatus === "disabled";
        cloudHistorySyncBtn.textContent = "☁ 云端补齐";
      }
    }
  })();
  cloudHistorySyncFlight = flight;
  try {
    return await flight;
  } finally {
    if (cloudHistorySyncFlight === flight) cloudHistorySyncFlight = null;
  }
}

async function loadRealtime() {















  try {















    const response = await fetch("/api/realtime", { cache: "no-store" });















    const payload = await response.json();















    if (!response.ok) throw new Error(payload.error || "实时行情获取失败");















    renderRealtime(payload);















  } catch (error) {















    if (realtimeQuotes) realtimeQuotes.innerHTML = `<div class="empty-state">实时行情获取失败：${escapeHtml(error.message)}</div>`;















    if (realtimeHealth) realtimeHealth.innerHTML = `<div class="empty-state">无法读取数据源状态。</div>`;















  }















}































form.addEventListener("input", updateView);































stockForm.addEventListener("submit", (event) => {















  event.preventDefault();















  const data = Object.fromEntries(new FormData(stockForm).entries());















  state.watchlist.push(data);















  persist();















  renderWatchlist();















  stockForm.reset();















});































function sellAdvisorNorm(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s·()（）/_\-—,，。；;:：]/g, "");
}









function sellAdvisorSameDay(left, right) {
  return String(left || "").slice(0, 10) === String(right || "").slice(0, 10);
}

function sellAdvisorResolveDecisionContext(payload) {
  const legacyMarketState = payload?.market?.state || {};
  const projection = resolveUnifiedDecisionChainProjection(payload);
  const decision = payload?.tomorrowDecision || {};
  const decorationAligned = Boolean(
    projection.contractReady
    && projection.generationId
    && String(decision.generationId || "").trim() === projection.generationId
    && String(decision.tradingDate || "").trim() === projection.tradingDate
    && String(decision.asOf || "").trim() === projection.asOf,
  );
  const decisionMarket = decorationAligned && decision?.market || {};
  const decisionContext = decorationAligned && (decisionMarket?.decisionContext || decisionMarket?.phaseDetail?.decisionContext) || {};
  const opportunityMap = decorationAligned && decision?.opportunityMap || {};
  const directions = Array.isArray(opportunityMap.directions)
    ? opportunityMap.directions.filter((item) => item && (item.name || item.family || item.id))
    : [];
  const authorizedThemes = projection.chain && projection.chain.theme && Array.isArray(projection.chain.theme.themes)
    ? projection.chain.theme.themes.map(String).filter(Boolean) : [];
  const mainDirection = directions.find((item) => authorizedThemes.includes(String(item.name || item.family || item.id || ""))) || null;
  const permission = projection.authorization || {};
  const tomorrowBaseline = decorationAligned && (decision?.tomorrowBaseline || decisionMarket?.phaseDetail?.tomorrowBaseline) || {};
  const bigCycle = String(projection.marketStage?.bigCycle?.label || "大周期待确认").trim();
  const smallCycle = String(projection.marketStage?.smallCycle?.label || "小周期待确认").trim();
  const canonicalCycle = bigCycle;
  const position = projection.executionOpen ? `${projection.maximumPortfolioPct}%` : "0%";
  const operation = projection.executionOpen ? "交易授权开启" : "交易授权关闭";
  const mainLine = authorizedThemes.length ? {
    name: authorizedThemes[0],
    displayName: authorizedThemes.join(" / "),
    aliases: authorizedThemes,
    authority: "unified_decision_chain_v3",
  } : null;

  return {
    decision,
    decisionMarket,
    decisionContext,
    directions,
    mainDirection,
    mainLine,
    tomorrowBaseline,
    permission,
    bigCycle,
    smallCycle,
    canonicalCycle,
    position,
    operation,
    structureLabel: String(projection.marketStage?.transition?.label || "").trim(),
    mediumStructureLabel: "",
    emotionStage: String(projection.marketStage?.emotionStage?.label || "").trim(),
    strictEmotionStage: String(projection.marketStage?.previousEmotionStage?.label || "").trim(),
    speculationPreference: decisionContext?.speculationPreference || null,
    gateClosed: !projection.executionOpen,
    decisionChainProjection: projection,
    marketState: {
      ...legacyMarketState,
      cycle: canonicalCycle,
      subPhase: smallCycle,
      position,
      operation,
    },
  };
}

function sellAdvisorBuildContextFacts(payload) {
  const context = sellAdvisorResolveDecisionContext(payload);
  const directionLabels = context.directions.map((item, index) => {
    const role = item.threadRole === "main" || (!item.threadRole && index === 0) ? "主方向" : "并行方向";
    const name = String(item.name || item.family || item.id || "--").trim();
    const family = String(item.family || "").trim();
    return `${role} ${name}${family && family !== name ? `（${family}）` : ""}`;
  });
  const anchorLabels = context.directions.flatMap((item) => {
    const directionName = String(item.name || item.family || item.id || "方向").trim();
    const anchor = Array.isArray(item.emotionAnchors) ? item.emotionAnchors.find((entry) => entry && (entry.name || entry.code)) : null;
    return anchor ? [`${directionName}：${anchor.name || anchor.code}`] : [];
  });
  const preference = context.speculationPreference;
  const confirmedPreference = Array.isArray(preference?.confirmedLabels) ? preference.confirmedLabels.filter(Boolean) : [];
  const observedPreference = Array.isArray(preference?.observedLabels) ? preference.observedLabels.filter(Boolean) : [];
  const structure = [context.mediumStructureLabel, context.structureLabel].filter(Boolean).join(" / ");
  const emotionNote = context.strictEmotionStage && context.strictEmotionStage !== context.emotionStage
    ? `严格口径：${context.strictEmotionStage}`
    : "";

  return {
    context,
    metaText: `${context.bigCycle} / ${context.smallCycle} · ${context.operation}`,
    facts: [
      { label: "当前周期", value: `${context.bigCycle} / ${context.smallCycle}` },
      { label: "操作", value: context.operation, note: `仓位上限 ${context.position}` },
      { label: "主线", value: context.mainLine?.displayName || context.mainLine?.name || "暂无明确主线" },
      directionLabels.length
        ? { label: "热点方向", value: directionLabels.join(" / "), note: context.gateClosed ? "当前只观察" : "" }
        : null,
      structure ? { label: "市场结构", value: structure } : null,
      context.emotionStage ? { label: "情绪节奏", value: context.emotionStage, note: emotionNote } : null,
      preference?.summary
        ? {
            label: "炒作偏好",
            value: preference.summary,
            note: [
              confirmedPreference.length ? `已确认：${confirmedPreference.join("、")}` : "",
              observedPreference.length ? `观察：${observedPreference.join("、")}` : "",
            ].filter(Boolean).join("；"),
          }
        : null,
      context.tomorrowBaseline?.label
        ? { label: "明日基准", value: context.tomorrowBaseline.label, note: context.tomorrowBaseline.reason || "" }
        : null,
      anchorLabels.length ? { label: "方向锚点（观察）", value: anchorLabels.join(" / ") } : null,
    ].filter(Boolean),
  };
}









function sellAdvisorMatchesMainLine(holding, mainLine) {
  if (!holding || !mainLine) return false;
  const sector = sellAdvisorNorm(holding.sector || holding.mainConcept || holding.concept || "");
  if (!sector) return false;
  const names = [mainLine.name, mainLine.family, mainLine.displayName, ...(mainLine.aliases || [])].filter(Boolean);
  return names.some((name) => {
    const normalized = sellAdvisorNorm(name);
    return normalized && (sector.includes(normalized) || normalized.includes(sector));
  });
}










function sellAdvisorCollectConceptNames(record) {
  if (!record) return [];
  const values = [
    record.name,
    record.displayName,
    record.family,
    record.sectorName,
    record.mainConcept,
    record.mainFamily,
    record.label,
    record.summary,
    ...(Array.isArray(record.aliases) ? record.aliases : []),
    ...(Array.isArray(record.matchNames) ? record.matchNames : []),
    ...(Array.isArray(record.concepts) ? record.concepts : []),
  ];
  return values
    .flat()
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}










function sellAdvisorMatchStrength(sourceNames, holdingTokens) {
  const source = Array.from(new Set(sourceNames.map((item) => sellAdvisorNorm(item)).filter(Boolean)));
  const target = Array.from(new Set(holdingTokens.map((item) => sellAdvisorNorm(item)).filter(Boolean)));
  if (!source.length || !target.length) return 0;
  let best = 0;
  for (const left of source) {
    for (const right of target) {
      if (!left || !right) continue;
      if (left === right) best = Math.max(best, 100);
      else if (left.includes(right) || right.includes(left)) best = Math.max(best, 82);
      else if (left.length > 3 && right.length > 3 && (left.slice(0, 3) === right.slice(0, 3) || left.slice(-3) === right.slice(-3))) {
        best = Math.max(best, 60);
      }
    }
  }
  return best;
}










function sellAdvisorFindStockSnapshot(holding, payload) {
  const code = String(holding && holding.code ? holding.code : "").trim();
  if (!code || !payload) return null;
  const pools = [
    payload.selected,
    payload.candidates,
    payload.rejected,
    payload.coreWatch && Array.isArray(payload.coreWatch.entries) ? payload.coreWatch.entries : [],
  ];
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    const hit = pool.find((item) => String(item && item.code ? item.code : "").trim() === code);
    if (hit) return hit;
  }
  return null;
}

function sellAdvisorCurrentStockPool(payload) {
  const byCode = new Map();
  [payload?.candidates, payload?.selected, payload?.rejected].forEach((pool) => {
    if (!Array.isArray(pool)) return;
    pool.forEach((item) => {
      const code = String(item?.code || "").trim();
      if (!code) return;
      const current = byCode.get(code);
      const currentKeys = current && typeof current === "object" ? Object.keys(current).length : 0;
      const nextKeys = item && typeof item === "object" ? Object.keys(item).length : 0;
      if (!current || nextKeys > currentKeys) byCode.set(code, item);
    });
  });
  return Array.from(byCode.values());
}

function sellAdvisorSplitDirectionTokens(value) {
  return String(value || "")
    .split(/[\/|、,，；;]/)
    .map((item) => item.trim())
    .filter((item) => item && !/^(AI算力|科技|大科技|人工智能|主线)$/.test(item));
}

function sellAdvisorBuildDirectionContext(holding, payload, conceptProfile) {
  const snapshot = conceptProfile?.snapshot || null;
  const directionName = String(
    snapshot?.mainConcept
    || holding?.mainConcept
    || sellAdvisorSplitDirectionTokens(holding?.sector)[0]
    || snapshot?.mainFamily
    || conceptProfile?.title
    || "所属方向"
  ).trim();
  const directionNorm = sellAdvisorNorm(directionName);
  const holdingCode = String(holding?.code || snapshot?.code || "").trim();
  const peers = sellAdvisorCurrentStockPool(payload).filter((record) => {
    if (!record || !record.code) return false;
    if (String(record.code).trim() === holdingCode) return true;
    const exactNames = [record.mainConcept, ...(Array.isArray(record.concepts) ? record.concepts : [])]
      .map((item) => sellAdvisorNorm(item))
      .filter(Boolean);
    if (directionNorm && exactNames.some((item) => item === directionNorm || item.includes(directionNorm) || directionNorm.includes(item))) {
      return true;
    }
    if (directionNorm && sellAdvisorNorm(record.mainFamily) === directionNorm) return true;
    return false;
  });

  if (snapshot && !peers.some((item) => String(item?.code || "").trim() === holdingCode)) {
    peers.push(snapshot);
  }
  return { name: directionName || "所属方向", peers };
}










function sellAdvisorResolveConceptProfile(holding, payload) {
  const snapshot = sellAdvisorFindStockSnapshot(holding, payload);
  const topicBoard = payload && payload.topicBoard ? payload.topicBoard : null;
  const hotConcepts = payload && Array.isArray(payload.hotConcepts) ? payload.hotConcepts : [];
  const decisionContext = sellAdvisorResolveDecisionContext(payload);
  const mainLine = decisionContext.mainLine;
  const decisionDirections = decisionContext.directions;
  const holdingTokens = [
    holding && holding.code,
    holding && holding.name,
    holding && holding.sector,
    holding && holding.mainConcept,
    holding && holding.concept,
    snapshot && snapshot.name,
    snapshot && snapshot.mainConcept,
    snapshot && snapshot.mainFamily,
    snapshot && snapshot.sectorName,
    ...(snapshot && Array.isArray(snapshot.concepts) ? snapshot.concepts : []),
  ]
    .flat()
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  const pool = [];
  if (mainLine) {
    pool.push({
      kind: "mainline",
      rank: 0,
      score: Number(mainLine?.evidence?.rankingScore || mainLine?.score || 0),
      record: mainLine,
    });
  }
  decisionDirections.forEach((item, index) => {
    if (item === decisionContext.mainDirection) return;
    pool.push({
      kind: "hot",
      rank: index + 1,
      score: Number(item?.evidence?.rankingScore || item?.evidence?.themeScore || item?.score || 0),
      record: {
        ...item,
        displayName: String(item?.name || item?.family || item?.id || "--"),
        aliases: Array.from(new Set([
          ...(Array.isArray(item?.aliases) ? item.aliases : []),
          ...(Array.isArray(item?.evidence?.sourceThemeNames) ? item.evidence.sourceThemeNames : []),
        ].filter(Boolean))),
      },
    });
  });
  hotConcepts.forEach((item, index) => {
    pool.push({
      kind: "hot",
      rank: decisionDirections.length + index + 1,
      score: Number(item && item.score ? item.score : 0),
      record: item,
    });
  });
  if (topicBoard && Array.isArray(topicBoard.items)) {
    topicBoard.items.forEach((item, index) => {
      pool.push({
        kind: "board",
        rank: index + 1,
        score: Number(item && item.score ? item.score : 0),
        record: item,
      });
    });
  }

  let best = null;
  for (const item of pool) {
    const names = sellAdvisorCollectConceptNames(item.record);
    const match = sellAdvisorMatchStrength(names, holdingTokens);
    if (!match) continue;
    const candidate = {
      ...item,
      match,
      names,
      label: String(item.record?.displayName || item.record?.name || item.record?.family || item.record?.mainConcept || item.record?.sectorName || "--"),
    };
    if (!best || candidate.match > best.match || (candidate.match === best.match && candidate.score > best.score)) {
      best = candidate;
    }
  }

  const sameMain = sellAdvisorMatchStrength(sellAdvisorCollectConceptNames(mainLine), holdingTokens) > 0;
  const hotCore = best && best.kind === "hot" && best.rank <= 3 && best.match >= 60;
  const boardCore = best && best.kind === "board" && best.rank <= 3 && best.match >= 60;
  const sameFamily = best && best.match >= 60 && best.rank <= 3;
  const snapshotCore = Boolean(
    snapshot && snapshot.leadership && snapshot.leadership.coreIdentityQualified === true
  );
  let relation = "非主线";
  if (sameMain) relation = "同主线";
  else if (hotCore) relation = "主线核心";
  else if (sameFamily || boardCore) relation = "家族核心";
  else if (snapshotCore && best) relation = "观察核心";

  return {
    snapshot,
    best,
    relation,
    sameMain,
    sameFamily,
    hotCore,
    boardCore,
    snapshotCore,
    title: best
      ? (() => {
          const family = String(best.record?.family || "").trim();
          const name = String(best.record?.name || "").trim();
          if (family && name && family !== name) return `${family} / ${name}`;
          return best.label;
        })()
      : String(holding && (holding.sector || holding.mainConcept || holding.concept) ? (holding.sector || holding.mainConcept || holding.concept) : "未填板块"),
  };
}










function sellAdvisorResolveIndexExpectation(payload) {
  const marketState = sellAdvisorResolveDecisionContext(payload).marketState;
  const externalRisk = payload && payload.market && payload.market.externalRisk ? payload.market.externalRisk : null;
  const usFramework = payload && payload.usFramework ? payload.usFramework : null;
  const rawScore = Number(marketState.metrics && marketState.metrics.indexScore);
  let score = Number.isFinite(rawScore) && rawScore > 0 ? rawScore : 0;
  let source = Number.isFinite(rawScore) && rawScore > 0 ? "市场指标" : "环境推导";
  if (!score) {
    score = 52;
    const externalLevel = String(externalRisk?.level || "");
    if (/低风险/.test(externalLevel)) score += 10;
    else if (/中风险/.test(externalLevel)) score += 2;
    else if (/高风险/.test(externalLevel)) score -= 12;

    const usLevel = String(usFramework?.level || "");
    if (/偏多|向上|强/.test(usLevel)) score += 5;
    else if (/偏空|弱/.test(usLevel)) score -= 5;

    const cycle = String(marketState.cycle || "");
    if (/混沌|冰点/.test(cycle)) score += 2;
    if (/退潮/.test(cycle)) score -= 8;
    score = Math.max(0, Math.min(100, Math.round(score)));
  }
  const label = score >= 72 ? "指数偏正" : score >= 56 ? "指数中性" : score >= 40 ? "指数偏弱" : "指数承压";
  const note = score >= 72
    ? "外部环境给面子，指数不拖后腿，卖点可以稍微放宽"
    : score >= 56
      ? "指数是中性底色，混沌期更多看板块和核心，不是归零处理"
      : score >= 40
        ? "指数偏弱，但还没到必须全清的级别"
        : "指数承压，弱票要优先减";
  return { score, label, note, source };
}












function sellAdvisorResolvePrice(holding, payload) {
  const snapshot = sellAdvisorFindStockSnapshot(holding, payload);
  const live = Number(snapshot && (snapshot.price || snapshot.close || snapshot.lastPrice) ? (snapshot.price || snapshot.close || snapshot.lastPrice) : 0);
  if (Number.isFinite(live) && live > 0) return { price: live, source: "全量最新快照" };
  const manual = Number(holding && holding.currentPrice ? holding.currentPrice : 0);
  if (Number.isFinite(manual) && manual > 0) return { price: manual, source: "手填现价" };
  const buy = Number(holding && holding.buyPrice ? holding.buyPrice : 0);
  if (Number.isFinite(buy) && buy > 0) return { price: buy, source: "无行情，仅显示买入价" };
  return { price: 0, source: "暂无价格" };
}









function sellAdvisorBuildExitChain({ assessment, snapshot, currentPrice, positionPct }) {
  const engine = window.SellExitEngine;
  if (!engine || typeof engine.buildSellAdvisorTimeline !== "function") {
    return {
      levels: [],
      currentAction: "卖出引擎未加载，禁止生成机械卖点",
      positionImpact: "等待页面重新加载后复核",
      timeline: [{
        title: "数据保护",
        trigger: "卖出规则模块未正确加载",
        action: "不输出‘卖一半’或‘清仓’等伪精确动作",
        nextCheck: "刷新页面并重新抓取最新快照",
      }],
    };
  }
  return engine.buildSellAdvisorTimeline({
    assessment,
    snapshot,
    currentPrice,
    positionPct,
    holderLine: snapshot?.gamePlan?.holderLine,
    tradeSell: snapshot?.tradePlan?.sell,
  });
}

function buildSellAdvisorAssessment(holding, payload) {
  const canonicalContext = sellAdvisorResolveDecisionContext(payload);
  const marketState = canonicalContext.marketState;
  const tradingStyle = payload && payload.market && payload.market.tradingStyle ? payload.market.tradingStyle : {};
  const mainLine = canonicalContext.mainLine;
  const usFramework = payload && payload.usFramework ? payload.usFramework : null;
  const tomorrowOutlook = payload && payload.tomorrowOutlook ? payload.tomorrowOutlook : null;
  const coreEntries = payload && payload.coreWatch && Array.isArray(payload.coreWatch.entries) ? payload.coreWatch.entries : [];
  const coreHit = coreEntries.find((item) => String(item.code || "").trim() === String(holding.code || "").trim());
  const priceInfo = sellAdvisorResolvePrice(holding, payload);
  const conceptProfile = sellAdvisorResolveConceptProfile(holding, payload);
  const directionContext = sellAdvisorBuildDirectionContext(holding, payload, conceptProfile);
  const snapshot = conceptProfile.snapshot || null;
  const buyPrice = Number(holding.buyPrice || 0);
  const currentPrice = Number(priceInfo.price || 0);
  const pnlPct = buyPrice > 0 && currentPrice > 0 ? ((currentPrice - buyPrice) / buyPrice) * 100 : null;
  const sameMain = conceptProfile.sameMain || sellAdvisorMatchesMainLine(holding, mainLine);
  const role = String(snapshot?.role || holding.role || "").trim();
  const verifiedCore = Boolean(snapshot?.leadership?.coreIdentityQualified === true);
  const sectorName = String(
    holding.sector ||
    conceptProfile.title ||
    snapshot?.mainConcept ||
    snapshot?.mainFamily ||
    snapshot?.concept ||
    mainLine?.displayName ||
    mainLine?.name ||
    "未填板块"
  ).trim();
  let score = 50;
  const factorRows = [];
  const addFactor = (label, value, note, weight = 0) => {
    score += weight;
    factorRows.push({ label, value, note, weight });
  };

  if (marketState.cycle === "退潮") {
    addFactor("情绪预期", "退潮", "大周期先收缩，卖出优先级最高", -26);
  } else if (marketState.cycle === "冰点") {
    addFactor("情绪预期", "冰点", "冰点更看核心回流，不是所有票都该立刻走", -3);
  } else if (marketState.cycle === "混沌") {
    addFactor("情绪预期", "混沌", "混沌期靠试错，但不在核心里的持仓要更谨慎", -4);
  } else if (marketState.cycle === "主升") {
    addFactor("情绪预期", "主升", "主升期强票容错高，先等回流再砍", 8);
  } else if (marketState.cycle === "震荡") {
    addFactor("情绪预期", "震荡", "震荡期最怕拖，卖出纪律要更硬", -8);
  }

  if (sameMain) {
    const mainName = mainLine?.displayName || mainLine?.name || "当前主线";
    addFactor("板块回流", "同主线", `它还在${mainName}这条线上，先看回流是否延续`, 18);
  } else if (conceptProfile.hotCore) {
    addFactor("板块回流", "主线核心", `它属于${conceptProfile.title}这条强势家族，今天更像混沌期预期内分歧，不该按脱离主线处理`, 14);
  } else if (conceptProfile.sameFamily || conceptProfile.boardCore) {
    addFactor("板块回流", "家族核心", `它属于${conceptProfile.title}的核心圈，板块只是轮动分歧，不是彻底走坏`, 10);
  } else {
    addFactor("板块回流", "不在主线", "和当前主线/强势家族都不沾边，板块回流的支撑就弱了", -14);
  }

  if (verifiedCore) {
    addFactor("核心回流", "系统确认核心", "核心身份由主动性、持续辨识度和结构验证确认，不采信手填角色", 14);
  } else if (coreHit) {
    addFactor("核心回流", "历史核心", "历史上是核心，但今天不在最强序列里", 6);
  } else {
    addFactor("核心回流", "非核心/待验证", "手填龙头或中军不会自动获得核心容错", -10);
  }

  const indexSignal = sellAdvisorResolveIndexExpectation(payload);
  addFactor("指数预期", indexSignal.label, `${indexSignal.note}（${indexSignal.source}）`, indexSignal.score >= 72 ? 6 : indexSignal.score >= 56 ? 2 : indexSignal.score >= 40 ? -4 : -8);

  const positionText = String(marketState.position || tradingStyle.position || "");
  if (positionText) {
    const posWeight = /0%-20%/.test(positionText) ? -6 : /20%-40%/.test(positionText) ? -3 : /40%-60%/.test(positionText) ? 1 : 0;
    addFactor("资金预期", positionText, `当前建议仓位 ${positionText}，资金风格更偏${tradingStyle.preference || "观察"}`, posWeight);
  } else if (tradingStyle.preference) {
    addFactor("资金预期", tradingStyle.preference, `资金偏好是 ${tradingStyle.preference}，决定卖点不要脱离板块节奏`, 0);
  }

  if (canonicalContext.tomorrowBaseline?.label) {
    addFactor(
      "明日预期",
      canonicalContext.tomorrowBaseline.label,
      canonicalContext.tomorrowBaseline.reason || "按明日决策统一基准执行",
      canonicalContext.tomorrowBaseline.riskDefault === true ? -5 : 0,
    );
  } else if (tomorrowOutlook && tomorrowOutlook.bias) {
    const outlookNote = tomorrowOutlook.biasNote || tomorrowOutlook.keyLine || "明日节奏继续按收盘结论执行";
    const outlookWeight = tomorrowOutlook.bias === "首次分歧" ? -5 : tomorrowOutlook.bias === "常规" ? 2 : 0;
    addFactor("明日预期", tomorrowOutlook.bias, outlookNote, outlookWeight);
  }

  if (verifiedCore && role === "龙头") score += 8;
  else if (verifiedCore && role === "中军") score += 5;
  else if (role === "后排") score -= 8;
  else if (role === "补涨") score -= 2;

  const flowNature = snapshot?.flowNature;
  if (flowNature && flowNature.label) {
    addFactor(
      "资金性质",
      flowNature.key === "realization" ? `${flowNature.label}（非出逃）` : flowNature.label,
      Array.isArray(flowNature.evidence) && flowNature.evidence.length
        ? flowNature.evidence.slice(0, 2).join("；")
        : "资金性质按个股、方向、市场三层证据判断，净流出不单独定性",
      0,
    );
  }

  const structureState = snapshot?.leadership?.structure;
  if (structureState) {
    addFactor(
      "结构状态",
      structureState.breakdown ? "结构破坏" : structureState.frameworkIntact ? "结构完整" : "结构待确认",
      `${structureState.grade ? `结构${structureState.grade}；` : ""}${structureState.positionLabel || "位置待确认"}`,
      0,
    );
  }

  if (pnlPct != null) {
    if (pnlPct >= 10) {
      addFactor("浮盈状态", `${formatNumber(pnlPct)}%`, "浮盈已经够厚，先看能不能守住利润", -6);
    } else if (pnlPct <= -5) {
      addFactor("浮盈状态", `${formatNumber(pnlPct)}%`, "浮亏偏大，弱环境里不宜硬扛", -10);
    } else {
      addFactor("浮盈状态", `${formatNumber(pnlPct)}%`, "盈亏不大，卖点主要看结构而不是情绪", 0);
    }
  }

  if (holding.positionPct != null && Number(holding.positionPct) >= 40) {
    addFactor("仓位大小", `${holding.positionPct}%`, "仓位偏重，卖点要更早一点", -4);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const bestConceptRecord = conceptProfile.best?.record || null;
  const bestHasSectorQuote = Boolean(
    bestConceptRecord?.sector && Number.isFinite(Number(bestConceptRecord.sector.changePct))
  ) || Boolean(
    bestConceptRecord?.sectorName && !/未匹配|缺失/.test(String(bestConceptRecord.sectorName))
  );
  const sectorCandidates = [
    bestHasSectorQuote ? bestConceptRecord?.sector?.changePct : null,
    bestHasSectorQuote ? bestConceptRecord?.sectorChangePct : null,
    sameMain && mainLine?.sectorName && !/未匹配|缺失/.test(String(mainLine.sectorName))
      ? mainLine?.sectorChangePct
      : null,
  ];
  const sectorRaw = sectorCandidates.find((value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)));
  const engine = window.SellExitEngine;
  const strengthAssessment = engine && typeof engine.assessSellPosition === "function"
    ? engine.assessSellPosition({
        snapshot,
        marketState,
        role,
        positionPct: holding.positionPct,
        concept: {
          relation: conceptProfile.relation,
          sameMain,
          sameFamily: conceptProfile.sameFamily,
          hotCore: conceptProfile.hotCore,
          boardCore: conceptProfile.boardCore,
          sectorChangePct: sectorRaw === undefined ? null : Number(sectorRaw),
        },
      })
    : {
        state: "WEAK_PENDING",
        label: "数据待确认",
        tone: "trim",
        summary: "卖出判断模块未加载，当前不能确认弱仓。",
        verifiedCore: false,
        individualEvidence: ["卖出判断模块未加载"],
        board: { label: "板块待确认", evidence: ["数据不足"] },
        market: { label: "市场待确认", evidence: ["数据不足"] },
        dataNotes: ["禁止按综合评分机械卖出"],
        weakRule: {
          headline: "弱仓=个股3项中至少2项 + 对照层至少1项",
          individual: ["均价下≥5分钟", "未收回零轴", "落后方向≥2个百分点"],
          context: ["板块/市场至少一层确认"],
          exclusions: "单独低开、净流出或非核心身份都不算弱仓。",
        },
        weakSellPct: 0,
        portfolioPctToSell: null,
        portfolioPctLeft: null,
      };
  const exitPlan = sellAdvisorBuildExitChain({
    assessment: strengthAssessment,
    snapshot,
    currentPrice,
    positionPct: holding.positionPct,
  });
  const simplePlan = engine && typeof engine.buildSimpleSellPlan === "function"
    ? engine.buildSimpleSellPlan({
        assessment: strengthAssessment,
        snapshot,
        currentPrice,
        positionPct: holding.positionPct,
      })
    : {
        principle: "先看板块核心，再看自己的票；核心强、自己不跟，才进入卖出流程。",
        current: {
          key: "WAIT_COMPARE",
          label: "等待明早对照",
          tone: "hold",
          action: "先不卖，等待板块核心与本票强弱对照",
          reason: "卖出判断模块未加载，不能假装卖点已经触发。",
        },
        steps: [],
        hardLine: "个股结构破位或确认资金出逃，直接卖完。",
      };
  const cyclePlan = engine && typeof engine.buildCycleAwareSellPlan === "function"
    ? engine.buildCycleAwareSellPlan({
        assessment: strengthAssessment,
        market: marketState,
        holding: {
          ...(snapshot || {}),
          code: String(snapshot?.code || holding.code || ""),
          name: String(snapshot?.name || holding.name || holding.code || "--"),
          role: role || "未分级",
          mainConcept: snapshot?.mainConcept || directionContext.name,
        },
        direction: directionContext,
      })
    : {
        tone: "neutral",
        currentState: {
          market: { label: "市场状态待确认", summary: "卖出周期模块未加载" },
          direction: { label: "方向状态待确认", summary: "同方向股票池待恢复", name: directionContext.name },
          holding: { label: "持仓身份待确认", summary: "不能用计划替代当前状态" },
        },
        anchors: { emotion: [], capacity: [], negative: [] },
        primaryExpectation: {
          label: "明日主预期待确认",
          summary: "页面模块未加载，禁止生成机械卖法。",
          tone: "neutral",
        },
        scenarios: [],
        dataWarnings: ["周期卖出模块未加载"],
      };
  const action = cyclePlan.currentState.holding.label;
  const actionTone = cyclePlan.tone === "bad" ? "exit" : cyclePlan.tone === "warn" ? "trim" : "hold";
  const sellChain = Array.isArray(exitPlan.timeline) ? exitPlan.timeline : [];
  const summary = `${cyclePlan.currentState.market.label}；${cyclePlan.currentState.direction.label}；身份：${cyclePlan.currentState.holding.label}。`;
  const sellPlan = sellChain.map((step) => `${step.title}：${step.trigger}；${step.action}；${step.nextCheck}`);

  return {
    name: String(snapshot?.name || holding.name || holding.code || "--"),
    code: String(holding.code || snapshot?.code || "--"),
    sector: sectorName,
    role: role || "未分级",
    buyPrice,
    currentPrice,
    pnlPct,
    positionPct: holding.positionPct != null ? Number(holding.positionPct) : null,
    priceSource: priceInfo.source,
    action,
    actionTone,
    score,
    summary,
    sellPlan,
    sellChain,
    exitPlan,
    simplePlan,
    cyclePlan,
    directionContext,
    strengthAssessment,
    factorRows,
    coreState: strengthAssessment.verifiedCore ? "系统确认核心" : coreHit ? "历史核心" : "非核心/待验证",
    mainLineName: mainLine?.displayName || mainLine?.name || "暂无明确主线",
    matchingMainLine: sameMain,
    tradingStyle: tradingStyle.preference || "未明示",
    updatedAt: payload && (payload.updatedAt || payload.fetchedAt) ? String(payload.updatedAt || payload.fetchedAt) : "",
    note: String(holding.note || "").trim(),
    buyReason: String(holding.buyReason || "").trim(),
  };
}









function renderSellAdvisor(payloadArg) {
  if (!sellAdvisorContext || !sellAdvisorMeta || !sellAdvisorHoldings || !sellAdvisorReport || !sellAdvisorCount || !sellAdvisorUpdatedAt) return;
  const payload = payloadArg || lastHotPayload || null;
  const holdings = Array.isArray(state.sellAdvisorHoldings) ? state.sellAdvisorHoldings.slice() : [];
  const contextModel = payload ? sellAdvisorBuildContextFacts(payload) : null;

  sellAdvisorCount.textContent = `${holdings.length} 只`;
  sellAdvisorUpdatedAt.textContent = payload && (payload.updatedAt || payload.fetchedAt) ? formatTime(payload.updatedAt || payload.fetchedAt) : "--";
  const sellAdvisorContextText = contextModel ? contextModel.metaText : "等待抓取";
  sellAdvisorMeta.textContent = `${sellAdvisorContextText} · ${sellAdvisorStorageStatus} · 当前卡片仅为日线观察层，V7分钟卖出缺证据时不执行旧模型`;

  if (contextModel) {
    sellAdvisorContext.innerHTML = `<div class="decision-facts">${contextModel.facts.map((item) => `
      <span>${escapeHtml(item.label)}：<b>${escapeHtml(item.value)}</b>${item.note ? ` · ${escapeHtml(item.note)}` : ""}</span>
    `).join("")}</div>`;
  } else {
    sellAdvisorContext.textContent = "先抓一次最新快照，再把你的持仓录进来。";
  }

  if (!holdings.length) {
    sellAdvisorHoldings.innerHTML = `<div class="empty-state">还没有录入持仓。先填一只你真实买入的股票，再让模型按板块回流、核心回流、指数预期、资金预期、情绪预期一起给卖法。</div>`;
    sellAdvisorReport.innerHTML = `<div class="empty-state">卖出方案会在这里显示。当前先用最新快照和你的持仓，别拿空仓硬推结论。</div>`;
    return;
  }

  const assessed = holdings.map((holding) => buildSellAdvisorAssessment(holding, payload));
  const renderSellAnchorGroup = (title, subtitle, anchors) => `
    <section class="sell-anchor-group">
      <div class="sell-anchor-group-head">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(subtitle)}</span>
      </div>
      <div class="sell-anchor-list">
        ${Array.isArray(anchors) && anchors.length ? anchors.map((anchor) => `
          <div class="sell-anchor-chip ${Number(anchor.changePct) >= 0 ? "positive" : "negative"}">
            <div>
              <strong>${escapeHtml(anchor.name || anchor.code || "--")}</strong>
              <span>${escapeHtml(anchor.code || "")}</span>
            </div>
            <b>${Number(anchor.changePct) >= 0 ? "+" : ""}${formatNumber(anchor.changePct)}%</b>
            ${Number(anchor.amountYi) > 0 ? `<small>成交 ${formatNumber(anchor.amountYi)}亿</small>` : ""}
          </div>
        `).join("") : `<span class="sell-anchor-empty">当前快照不足，明日盘前补齐后再验证</span>`}
      </div>
    </section>
  `;
  sellAdvisorHoldings.innerHTML = assessed
    .map((item, index) => `
      <article class="sell-advisor-holding ${item.actionTone}">
        <div class="sell-advisor-holding-head">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.code)} · ${escapeHtml(item.sector)} · ${escapeHtml(item.role)}</span>
          </div>
          <button type="button" class="ghost-btn" data-sell-delete="${index}">删除</button>
        </div>
        <div class="sell-advisor-holding-facts">
          <span>买入价 <b>${item.buyPrice ? formatNumber(item.buyPrice) : "--"}</b></span>
          <span>现价 <b>${item.currentPrice ? formatNumber(item.currentPrice) : "--"}</b></span>
          <span>浮盈 <b>${item.pnlPct == null ? "--" : `${formatNumber(item.pnlPct)}%`}</b></span>
          <span>仓位 <b>${item.positionPct == null ? "--" : `${item.positionPct}%`}</b></span>
        </div>
        <p class="sell-advisor-mini">${escapeHtml(item.summary)}</p>
      </article>
    `)
    .join("");

  sellAdvisorReport.innerHTML = assessed
    .map((item) => `
      <article class="sell-advisor-report-card ${item.actionTone}">
        <div class="sell-advisor-report-head">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.code)} · ${escapeHtml(item.sector)} · ${escapeHtml(item.priceSource)}</span>
          </div>
          <b class="sell-advisor-action">${escapeHtml(item.action)}</b>
        </div>
        <div class="sell-cycle-sequence">先定环境，再定身份，最后才谈卖点</div>
        <div class="sell-cycle-state-grid">
          <section class="sell-cycle-state-card market">
            <span>① 市场周期</span>
            <strong>${escapeHtml(item.cyclePlan.currentState.market.label)}</strong>
            <p>${escapeHtml(item.cyclePlan.currentState.market.summary)}</p>
          </section>
          <section class="sell-cycle-state-card direction">
            <span>② ${escapeHtml(item.cyclePlan.currentState.direction.name)}方向</span>
            <strong>${escapeHtml(item.cyclePlan.currentState.direction.label)}</strong>
            <p>${escapeHtml(item.cyclePlan.currentState.direction.summary)}</p>
          </section>
          <section class="sell-cycle-state-card holding">
            <span>③ 当前持仓身份</span>
            <strong>${escapeHtml(item.cyclePlan.currentState.holding.label)}</strong>
            <p>${escapeHtml(item.cyclePlan.currentState.holding.summary)}</p>
          </section>
        </div>
        <section class="sell-primary-expectation ${escapeHtml(item.cyclePlan.primaryExpectation.tone)}">
          <div>
            <span>④ 明日主预期</span>
            <small>这是推演，不是当前状态</small>
          </div>
          <strong>${escapeHtml(item.cyclePlan.primaryExpectation.label)}</strong>
          <p>${escapeHtml(item.cyclePlan.primaryExpectation.summary)}</p>
        </section>
        <section class="sell-anchor-panel">
          <div class="sell-panel-title">
            <strong>明日看谁，直接点名</strong>
            <span>同方向锚点随最新快照动态更新</span>
          </div>
          <div class="sell-anchor-groups">
            ${renderSellAnchorGroup("情绪方向标", "看辨识度是否延续", item.cyclePlan.anchors.emotion)}
            ${renderSellAnchorGroup("容量承接锚点", "看方向是否真加强", item.cyclePlan.anchors.capacity)}
            ${renderSellAnchorGroup("负反馈锚点", "看老核心是否止跌", item.cyclePlan.anchors.negative)}
          </div>
        </section>
        <section class="sell-scenario-panel">
          <div class="sell-panel-title">
            <strong>⑤ 明天出现什么，就怎么卖</strong>
            <span>先匹配情景，再执行动作</span>
          </div>
          <div class="sell-scenario-grid">
            ${item.cyclePlan.scenarios.map((scenario) => `
              <article class="sell-scenario-card ${escapeHtml(scenario.tone)}">
                <strong>${escapeHtml(scenario.label)}</strong>
                <div><span>出现什么</span><p>${escapeHtml(scenario.condition)}</p></div>
                <div><span>怎么处理</span><p>${escapeHtml(scenario.action)}</p></div>
              </article>
            `).join("")}
          </div>
        </section>
        ${item.cyclePlan.dataWarnings.length ? `
          <div class="sell-cycle-warning"><strong>数据复核：</strong>${escapeHtml(item.cyclePlan.dataWarnings.join("；"))}</div>
        ` : ""}
        <details class="sell-advisor-evidence">
          <summary>查看本票判断依据（可选）</summary>
          <div class="sell-advisor-evidence-grid">
            <div>
              <span>板块对照</span>
              <strong>${escapeHtml(item.strengthAssessment.board.label)}</strong>
              <p>${escapeHtml(item.strengthAssessment.board.evidence.join("；"))}</p>
            </div>
            <div>
              <span>个股表现</span>
              <strong>${item.strengthAssessment.individualWeakCount > 0 ? "存在被动信号" : "暂未转弱"}</strong>
              <p>${escapeHtml(item.strengthAssessment.individualEvidence.join("；"))}</p>
            </div>
            <div>
              <span>资金性质</span>
              <strong>${escapeHtml(item.strengthAssessment.flowLabel)}</strong>
              <p>正常兑现不等于出逃；只有确认出逃才直接清仓。</p>
            </div>
            <div>
              <span>关键价位</span>
              <strong>${(item.exitPlan.levels || []).filter((level) => level.value != null).map((level) => `${escapeHtml(level.label)} ${formatNumber(level.value)}`).join(" · ") || "数据待补"}</strong>
              <p>价位只用于确认转弱，不能脱离板块核心单独决定卖点。</p>
            </div>
          </div>
          ${item.buyReason ? `<p><strong>买入逻辑：</strong>${escapeHtml(item.buyReason)}</p>` : ""}
          ${item.note ? `<p><strong>备注：</strong>${escapeHtml(item.note)}</p>` : ""}
        </details>
      </article>
    `)
    .join("");
}









watchlistBody.addEventListener("click", (event) => {














  const button = event.target.closest("[data-delete]");















  if (!button) return;















  state.watchlist.splice(Number(button.dataset.delete), 1);















  persist();















  renderWatchlist();















});































selectedStocks.addEventListener("click", (event) => {















  const button = event.target.closest("[data-code]");















  if (!button) return;































  const picks = safeParseJSON(selectedStocks.dataset.payload || "[]", []);















  const stock = picks.find((item) => item.code === button.dataset.code);















  if (!stock) return;































  state.watchlist.push({















    stockName: `${stock.name} ${stock.code}`,















    sectorName: stock.mainConcept,















    role: `${stock.role || "角色待定"} / ${stock.setup}`,















    plan: `入选理由：${stock.reasons.join("；")}。博弈：${stock.gamePlan.decision}，${stock.gamePlan.gameTarget}。买点：${stock.tradePlan.buy} 次日卖点：${stock.tradePlan.nextDay} 卖点：${stock.tradePlan.sell}`,















  });















  persist();















  renderWatchlist();















  button.textContent = "已加入";















});































selectedStocks.addEventListener("click", handleSpecAction);















rejectedStocks.addEventListener("click", handleSpecAction);































saveReview.addEventListener("click", () => {















  const scores = getScores();















  const cycle = cycleName(scores.regime);















  state.history.push({















    date: new Date().toLocaleDateString("zh-CN"),















    cycle,















    total: scores.total,















    style: styleByScores(scores),















    action: actionByScores(scores),















  });















  persist();















  renderHistory();















});































fetchHotStocks.addEventListener("click", loadHotStocks);















if (fetchHotStocksDash) fetchHotStocksDash.addEventListener("click", loadHotStocks);















const fetchHotStocksDecision = document.querySelector("#fetchHotStocksDecision");















if (fetchHotStocksDecision) {
  fetchHotStocksDecision.addEventListener("click", () => loadHotStocks({
    preserveCurrent: true,
    reason: "decision-button",
    forceLocal: true,
  }));
}
const marketEmotionRefreshBtn = document.querySelector("#marketEmotionRefreshBtn");
if (marketEmotionRefreshBtn) marketEmotionRefreshBtn.addEventListener("click", loadHotStocks);
const superExpectationRefreshBtn = document.querySelector("#superExpectationRefreshBtn");
if (superExpectationRefreshBtn) {
  superExpectationRefreshBtn.addEventListener("click", async () => {
    if (superExpectationRefreshBtn.disabled) return;
    const originalLabel = superExpectationRefreshBtn.textContent;
    superExpectationRefreshBtn.disabled = true;
    superExpectationRefreshBtn.setAttribute("aria-busy", "true");
    superExpectationRefreshBtn.textContent = "正在抓取并验证…";
    try {
      await loadHotStocks();
    } finally {
      superExpectationRefreshBtn.disabled = false;
      superExpectationRefreshBtn.removeAttribute("aria-busy");
      superExpectationRefreshBtn.textContent = originalLabel;
    }
  });
}
const eventInferenceRefreshBtn = document.querySelector("#eventInferenceRefreshBtn");
async function refreshEventTimeline() {
  if (!eventInferenceRefreshBtn) return;
  const originalLabel = eventInferenceRefreshBtn.textContent;
  eventInferenceRefreshBtn.disabled = true;
  eventInferenceRefreshBtn.textContent = "正在更新完整事件日历…";
  const meta = document.querySelector("#eventInferenceMeta");
  if (meta) meta.textContent = "服务端抓取、校验并保存中";
  try {
    const response = await fetch("/api/event-timeline/refresh", {
      method: "POST",
      cache: "no-store",
    });
    const payload = await response.json();
    if (response.status === 409) {
      await loadHotStocks();
      return;
    }
    if (!response.ok) throw new Error(payload.detail || payload.error || "事件时间轴更新失败");
    renderEventInference(payload);
  } catch (error) {
    if (meta) meta.textContent = `更新失败：${error && error.message || "未知错误"}；原市场决策不受影响`;
  } finally {
    eventInferenceRefreshBtn.disabled = false;
    eventInferenceRefreshBtn.textContent = originalLabel;
  }
}
if (eventInferenceRefreshBtn) eventInferenceRefreshBtn.addEventListener("click", refreshEventTimeline);
const reviewConclusionRefreshBtn = document.querySelector("#reviewConclusionRefreshBtn");
if (reviewConclusionRefreshBtn) reviewConclusionRefreshBtn.addEventListener("click", loadHotStocks);































// ===== 交易日志表单 =====















const journalForm = document.querySelector("#journalForm");















if (journalForm) {















  journalForm.addEventListener("submit", async (event) => {















    event.preventDefault();















    const msg = document.querySelector("#journalFormMsg");















    const data = Object.fromEntries(new FormData(journalForm).entries());















    data.dualLogic = journalForm.querySelector('[name="dualLogic"]').checked;















    try {















      const res = await fetch("/api/journal/add", {















        method: "POST",















        headers: { "Content-Type": "application/json" },















        body: JSON.stringify(data),















      });















      const result = await res.json();















      if (result.ok) {















        if (msg) {















          msg.textContent =















            `✓ 已记录：${result.trade.name || result.trade.code} ${result.trade.pnlPct >= 0 ? "+" : ""}${result.trade.pnlPct}% · ${result.trade.exitGate}` +















            (result.notice ? ` ｜ ⚠️${result.notice}` : "");















        }















        journalForm.reset();















        toggleDeviationNote();















        loadJournal();















      } else if (msg) {















        msg.textContent = `保存失败：${result.error || "参数无效"}`;















      }















    } catch (error) {















      if (msg) msg.textContent = `保存失败：${error.message}`;















    }















  });















  // 纪律选择联动：选"偏离"时备注必填并显示















  const adherenceSelect = journalForm.querySelector("#planAdherenceSelect");















  const deviationLabel = journalForm.querySelector("#deviationNoteLabel");















  function toggleDeviationNote() {















    const isDeviated = adherenceSelect && adherenceSelect.value === "deviated";















    if (deviationLabel) {















      deviationLabel.hidden = !isDeviated;















      const input = deviationLabel.querySelector("input");















      if (input) input.required = isDeviated;















    }















  }















  window.toggleDeviationNote = toggleDeviationNote; // 提交重置后复位















  if (adherenceSelect) adherenceSelect.addEventListener("change", toggleDeviationNote);















  toggleDeviationNote();































  // 代码自动带出名称/方向（复用预案页的候选池缓存）















  journalForm.querySelector('[name="code"]').addEventListener("change", (event) => {















    const c = getPpCandidates()[event.target.value.trim()];















    if (!c) return;















    const nameInput = journalForm.querySelector('[name="name"]');















    const sectorInput = journalForm.querySelector('[name="sector"]');















    if (nameInput && !nameInput.value) nameInput.value = c.name || "";















    if (sectorInput && !sectorInput.value) sectorInput.value = c.sector || "";















  });















}































// ===== 盘前预案 + 红线清单（preplan.js 后端的前端入口）=====















const preplanForm = document.querySelector("#preplanForm");















const preplanList = document.querySelector("#preplanList");















const PP_STATE_KEY = "shortModelMarketState";















const PP_CANDIDATES_KEY = "shortModelPpCandidates";















const ppRedlineCache = {}; // `${code}|${date}` → 已生成的红线卡，避免重复请求































function ppYmd(d = new Date()) {















  const p = (n) => String(n).padStart(2, "0");















  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;















}















// 与后端 preplan.js 同一把锁：计划日当天 09:15 后不可改（历史永久锁定，未来可改）















function ppIsLocked(planDate) {















  if (!planDate) return false;















  const now = new Date();















  const today = ppYmd(now);















  if (planDate < today) return true;















  if (planDate > today) return false;















  return now.getHours() * 60 + now.getMinutes() >= 9 * 60 + 15;















}















// 默认计划日：09:15 前=今天，之后=下一天；跳过周末















function ppDefaultPlanDate() {















  const d = new Date();















  if (d.getHours() * 60 + d.getMinutes() >= 9 * 60 + 15) d.setDate(d.getDate() + 1);















  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);















  return ppYmd(d);















}































function getPpCandidates() {















  return safeParseJSON(localStorage.getItem(PP_CANDIDATES_KEY) || "{}", {});















}































// 抓取热股后落地：市场周期状态（表单顶常驻）+ 候选池（代码带出名称/方向/昨收/MA5）















function persistPreplanContext(payload) {















  try {















    const projection = resolveUnifiedDecisionChainProjection(payload);
    localStorage.setItem(PP_STATE_KEY, JSON.stringify({
      schemaVersion: 3,
      authority: "unified_decision_chain_v3",
      generationId: projection.generationId,
      tradingDate: projection.tradingDate,
      asOf: projection.asOf,
      contractReady: projection.contractReady,
      executionOpen: projection.executionOpen,
      marketStage: projection.marketStage,
      authorization: projection.authorization,
      result: {
        status: projection.result && projection.result.status || "blocked",
        selectedCodes: projection.selectedCodes,
        stocks: projection.stocks,
      },
      initialPortfolioPct: projection.initialPortfolioPct,
      maximumPortfolioPct: projection.maximumPortfolioPct,
      blockers: projection.blockers,
      legacyObservation: {
        selectedCodes: (Array.isArray(payload.selected) ? payload.selected : []).map((row) => String(row && row.code || "")).filter(Boolean),
      },
      savedAt: payload.fetchedAt || payload.updatedAt || payload.asOf,
    }));

    const pools = projection.stocks;















    const map = {};















    for (const s of pools) {















      if (!s.code) continue;















      map[s.code] = {















        name: s.name || "",















        sector: s.mainConcept || "",















        board: /^(30|68)/.test(String(s.code)) ? "20cm" : "主板",















        prevClose: s.klineProfile ? s.klineProfile.lastClose : null,















        ma5: s.klineProfile ? s.klineProfile.ma5 : null,















      };















    }















    localStorage.setItem(PP_CANDIDATES_KEY, JSON.stringify(map));















    fillPpDatalist(map);















  } catch {}















}































function fillPpDatalist(map) {















  const dl = document.querySelector("#ppCandidates");















  if (!dl) return;















  dl.innerHTML = Object.entries(map)















    .map(([code, c]) => `<option value="${code}">${escapeHtml(c.name)} · ${escapeHtml(c.sector || "")}</option>`)















    .join("");















}































// 表单顶部常驻：今日情绪周期 + 分数门槛（数据来自最近一次热股抓取）















function renderPpCycleBar() {















  const saved = safeParseJSON(localStorage.getItem(PP_STATE_KEY) || "null", null);















  const valid = Boolean(
    saved
    && saved.schemaVersion === 3
    && saved.authority === "unified_decision_chain_v3"
    && saved.contractReady === true
    && String(saved.generationId || "").trim()
    && String(saved.tradingDate || "").trim()
    && String(saved.asOf || "").trim(),
  );
  const stage = valid && saved.marketStage && typeof saved.marketStage === "object" ? saved.marketStage : {};
  const bigCycle = stage.bigCycle && typeof stage.bigCycle === "object" ? stage.bigCycle : {};
  const transition = stage.transition && typeof stage.transition === "object" ? stage.transition : {};
  const smallCycle = stage.smallCycle && typeof stage.smallCycle === "object" ? stage.smallCycle : {};
  const authorization = valid && saved.authorization && typeof saved.authorization === "object" ? saved.authorization : {};
  const tradeValue = authorization.tradeValue && typeof authorization.tradeValue === "object" ? authorization.tradeValue : {};















  const cycleEl = document.querySelector("#ppCycle");















  if (!valid) {















    if (cycleEl) cycleEl.textContent = "未知（先去「选股分析」抓取一次）";















    return;















  }















  if (cycleEl) {















    const cycleLabel = String(bigCycle.label || "--");
    cycleEl.textContent = cycleLabel;
    cycleEl.style.color = CYCLE_COLORS[cycleLabel] || "#8a8f99";















  }















  setText("#ppSubPhase", [
    transition.status && transition.status !== "not_active" ? transition.label : "",
    smallCycle.label,
  ].filter(Boolean).map((value) => `· ${value}`).join(" "));















  setText("#ppScore", tradeValue.label || "--");















  setText("#ppMinScore", saved.executionOpen ? `授权${Array.isArray(saved.result && saved.result.selectedCodes) ? saved.result.selectedCodes.length : 0}只` : "0只");















  setText("#ppPosition", saved.executionOpen ? `${Number(saved.maximumPortfolioPct) || 0}%` : "0%");















  setText("#ppStateTime", saved.savedAt ? formatTime(saved.savedAt) : "--");















}































// 锁定状态：横幅 + 表单只读















function updatePpLockUI() {















  if (!preplanForm) return;















  const planDate = preplanForm.elements.planDate.value;















  const locked = ppIsLocked(planDate);















  const lockEl = document.querySelector("#ppLockState");















  if (lockEl) {















    lockEl.textContent = locked















      ? `🔒 ${planDate || "该交易日"} 已过 09:15 锁定——盘中不许补预案，双逻辑资格是盘前挣的`















      : `✏️ ${planDate || "所选交易日"} 未锁定，09:15 前可录入 / 修改（同日同票覆盖）`;















    lockEl.classList.toggle("pp-locked-banner", locked);















  }















  for (const el of preplanForm.elements) {















    if (el.name === "planDate") continue; // 换个日期要始终可操作















    el.disabled = locked;















  }















}































// 双逻辑切换：logicB 显示且必填















function updatePpLogicFields() {















  const dual = preplanForm.elements.logicType.value === "dual";















  const bField = document.querySelector("#ppLogicBField");















  if (bField) bField.classList.toggle("pp-hidden", !dual);















  preplanForm.elements.logicB.required = dual;















}































function ppSetMsg(text, kind) {















  const msg = document.querySelector("#ppFormMsg");















  if (!msg) return;















  msg.textContent = text;















  msg.className = `preplan-form-msg${kind ? ` pp-${kind}` : ""}`;















}































async function submitPreplan(event) {















  event.preventDefault();















  const fd = new FormData(preplanForm);















  const dual = fd.get("logicType") === "dual";















  const logicA = String(fd.get("logicA") || "").trim();















  const logicB = String(fd.get("logicB") || "").trim();















  const code = String(fd.get("code") || "").trim();















  const planDate = String(fd.get("planDate") || "");

  if (!premarketExecutablePlanCodes(lastPremarketFlowModel, lastHotPayload).has(code)) {
    ppSetMsg("该股票没有进入当前最终可执行计划，禁止手输或从旧候选补录预案", "error");
    syncPremarketLegacyExecutionControls(lastPremarketFlowModel);
    return;
  }































  // 后端本来就会拒，这里提前拦并把原因说清楚















  if (dual && (!logicA || !logicB)) {















    ppSetMsg("双逻辑票 logicA（预期逻辑）和 logicB（板块回流逻辑）都必填，缺一个禁止提交——资格盘前挣", "error");















    return;















  }















  if (!dual && !logicA) {















    ppSetMsg("缺 logicA：买入逻辑一句话都写不出来的票，不该进预案", "error");















    return;















  }















  if (ppIsLocked(planDate)) {















    ppSetMsg(`${planDate} 已过 09:15 锁定，拒绝录入/修改`, "error");















    updatePpLockUI();















    return;















  }































  const cand = getPpCandidates()[code] || {};















  const body = {















    code,















    planDate,















    name: String(fd.get("name") || "").trim() || cand.name || "",















    sector: String(fd.get("sector") || "").trim() || cand.sector || "",















    dualLogic: dual,















    logicA,















    logicB: dual ? logicB : "",















    isExpectedReflowDay: fd.get("isExpectedReflowDay") === "on",















    chengjie: fd.get("chengjie"),















    yesterdayStrength: fd.get("yesterdayStrength"),















    buyPlan: String(fd.get("buyPlan") || "").trim(),















    board: cand.board || (/^(30|68)/.test(code) ? "20cm" : "主板"),















  };































  const btn = document.querySelector("#ppSubmitBtn");















  btn.disabled = true;















  try {















    const response = await fetch("/api/preplan/add", {















      method: "POST",















      headers: { "Content-Type": "application/json" },















      body: JSON.stringify(body),















    });















    const result = await response.json();















    if (!result.ok) {















      ppSetMsg((result.errors || [result.error || "提交失败"]).join("；"), "error");















      return;















    }















    // 后端警告原样展示（如"当日预案超5只"）















    ppSetMsg(















      `已保存 ${result.plan.name || result.plan.code} · ${result.plan.planDate}（当日第 ${result.dayCount} 只）${result.warn ? `｜${result.warn}` : ""}`,















      result.warn ? "warn" : "ok",















    );















    delete ppRedlineCache[`${code}|${planDate}`];















    await loadPreplanList(); // 保存成功 → 立即生成该票红线卡















  } catch (error) {















    ppSetMsg(`提交失败：${error.message}`, "error");















  } finally {















    btn.disabled = false;















  }















}































// 预案列表：今日及未来的计划（今晚录明天的也要看得见）















async function loadPreplanList() {















  if (!preplanList) return;















  try {















    const response = await fetch("/api/preplan/review", { cache: "no-store" });















    const payload = await response.json();















    const today = ppYmd();















    const plans = (payload.plans || [])















      .filter((p) => p.planDate >= today)















      .sort((a, b) => (a.planDate === b.planDate ? (a.code < b.code ? -1 : 1) : a.planDate < b.planDate ? -1 : 1));















    if (!plans.length) {















      preplanList.innerHTML = `<div class="empty-state">还没有预案。每晚复盘后从候选池「录预案」，保存即生成红线卡。</div>`;















      return;















    }















    preplanList.innerHTML = plans.map(ppPlanCardHtml).join("");















    await Promise.all(plans.map((plan) => loadRedlineFor(plan)));















  } catch (error) {















    preplanList.innerHTML = `<div class="empty-state">预案加载失败：${escapeHtml(error.message)}</div>`;















  }















}































function ppPlanCardHtml(plan) {















  const locked = ppIsLocked(plan.planDate);















  const e = plan.auctionExpectation || {};















  return `















    <article class="preplan-card ${locked ? "pp-card-locked" : ""}" data-pp-card="${plan.code}|${plan.planDate}">















      <div class="preplan-card-head">















        <h4>${escapeHtml(plan.name || "--")} <small>${plan.code} · ${plan.planDate}</small></h4>















        <span class="pp-lock-tag">${locked ? "🔒 已锁定" : "✏️ 可改"}</span>















      </div>















      <div class="stock-tags">















        <span class="${plan.dualLogic ? "pp-tag-dual" : "pp-tag-single"}">${plan.dualLogic ? "双逻辑" : "单逻辑"}</span>















        ${plan.isExpectedReflowDay ? `<span class="pp-tag-reflow">预期内回流日</span>` : ""}















        <span>承接${{ strong: "强", normal: "常规", weak: "弱" }[e.chengjie] || "常规"}</span>















        <span>昨日${e.yesterdayStrength === "strong" ? "强状态" : "弱一档"}</span>















        ${plan.sector ? `<span>${escapeHtml(plan.sector)}</span>` : ""}















      </div>















      <p class="pp-logic"><b>A·预期逻辑：</b>${escapeHtml(plan.logicA || "—")}</p>















      ${plan.dualLogic ? `<p class="pp-logic"><b>B·回流逻辑：</b>${escapeHtml(plan.logicB || "—")}</p>` : ""}















      ${plan.buyPlan ? `<p class="pp-note">备注：${escapeHtml(plan.buyPlan)}</p>` : ""}















      <div class="redline-slot" data-rl-slot="${plan.code}|${plan.planDate}">红线卡生成中…</div>















      <div class="judge-row pp-card-judge">















        <input class="pp-judge-pct" type="number" step="0.01" placeholder="实际开盘涨幅 %" />















        <button class="primary-btn" data-pp-judge="${plan.code}|${plan.planDate}" type="button">竞价判定</button>















      </div>















      <div class="pp-judge-result"></div>















    </article>















  `;















}































// 拉红线卡并填充；manual 传 {prevClose, ma5} 用于数据缺失时手动补















async function loadRedlineFor(plan, manual) {















  const key = `${plan.code}|${plan.planDate}`;















  const slot = document.querySelector(`[data-rl-slot="${key}"]`);















  if (!slot) return;















  try {















    let cached = !manual && ppRedlineCache[key];















    if (!cached) {















      const response = await fetch("/api/redline", {















        method: "POST",















        headers: { "Content-Type": "application/json" },















        body: JSON.stringify({ code: plan.code, date: plan.planDate, ...(manual || {}) }),















      });















      cached = await response.json();















      if (cached.ok) ppRedlineCache[key] = cached;















    }















    slot.innerHTML = cached.ok ? redlineCardHtml(cached.card, cached.quoteSource, key) : `<span class="pp-error">${escapeHtml(cached.error || "红线卡生成失败")}</span>`;















  } catch (error) {















    slot.innerHTML = `<span class="pp-error">红线卡生成失败：${escapeHtml(error.message)}</span>`;















  }















}































const RL_SOURCE_LABEL = { "hot-stocks-cache": "热股缓存", "kline-live": "实时K线", manual: "手动补录", unavailable: "无数据源" };































function redlineCardHtml(card, quoteSource, key) {















  const auctionHtml = card.auction















    ? `<li class="rl-item"><b>① 竞价判定线</b><ul class="rl-auction">















        ${card.auction.lines.map((line, i) => `<li class="rl-line-${i}">${escapeHtml(line)}</li>`).join("")}















      </ul></li>`















    : `<li class="rl-item rl-missing-line"><b>① 竞价判定线</b> ⚠️缺昨收，无法换算价格</li>`;















  const stopHtml = card.hardStop.priceRange















    ? `<li class="rl-item rl-stop"><b>② 硬止损价</b> <strong>${card.hardStop.priceRange[0].toFixed(2)} ~ ${card.hardStop.priceRange[1].toFixed(2)}</strong>（${card.hardStop.pctRange[0]}%~${card.hardStop.pctRange[1]}%）<em>不可谈判</em><small>${escapeHtml(card.hardStop.note)}</small></li>`















    : `<li class="rl-item rl-missing-line"><b>② 硬止损价</b> ${card.hardStop.pctRange[0]}%~${card.hardStop.pctRange[1]}%（⚠️缺昨收，价格待补）</li>`;















  const breakEvenHtml = card.breakEven.price















    ? `<li class="rl-item"><b>③ 保本武装线</b> <strong>${card.breakEven.price.toFixed(2)}</strong>（+3%）<small>${escapeHtml(card.breakEven.rule)}</small></li>`















    : `<li class="rl-item rl-missing-line"><b>③ 保本武装线</b> +3%（⚠️缺昨收，价格待补）</li>`;















  const fillHtml = card.missing.length















    ? `<div class="rl-fill-row">















        ⚠️缺 ${card.missing.join(" / ")}，手动补：















        <input class="rl-fill-prev" type="number" step="0.01" placeholder="昨收" />















        <input class="rl-fill-ma5" type="number" step="0.01" placeholder="MA5" />















        <button data-rl-fill="${key}" type="button">补数据重算</button>















      </div>`















    : "";















  return `















    <div class="redline-card">















      <div class="redline-title">















        <b>🚩 红线卡 ${escapeHtml(card.name || "")} ${card.code}</b>















        <span>${card.board.label} · 基准昨收 ${card.basis.prevClose != null ? card.basis.prevClose.toFixed(2) : "缺"} · 涨停${card.board.limitUpPrice != null ? card.board.limitUpPrice.toFixed(2) : "--"} / 跌停${card.board.limitDownPrice != null ? card.board.limitDownPrice.toFixed(2) : "--"} · ${RL_SOURCE_LABEL[quoteSource] || quoteSource}</span>















      </div>















      ${fillHtml}















      <ol class="rl-lines">















        ${auctionHtml}















        ${stopHtml}















        ${breakEvenHtml}















        <li class="rl-item"><b>④ 分时回撤</b> ${escapeHtml(card.intradayPullback)}</li>















        <li class="rl-item ${card.closeLine.ma5 == null ? "rl-missing-line" : ""}"><b>⑤ 尾盘线</b> ${escapeHtml(card.closeLine.rule)}</li>















        ${card.bGate ? `<li class="rl-item rl-bgate"><b>⑥ B闸</b> ${escapeHtml(card.bGate.rule)}</li>` : ""}















      </ol>















    </div>















  `;















}































// 竞价判定结果渲染（预案卡内联 + 独立判定框共用）















function judgeResultHtml(result) {















  const color = { 超预期: "#e23b3b", 符合预期: "#e08a00", 不及预期: "#2f7fd1", "不及预期(灰区)": "#8a8f99" }[result.verdict] || "#8a8f99";















  return `















    <div class="judge-verdict" style="border-left-color:${color}">















      <strong style="color:${color}">${escapeHtml(result.verdict || "--")}</strong>















      <span>开盘 ${result.actualOpenPct}%${result.plan ? ` · ${escapeHtml(result.plan.name || result.plan.code)}${result.plan.dualLogic ? " · 双逻辑" : " · 单逻辑"}` : ""}</span>















      <p>${escapeHtml(result.action || "")}</p>















      ${result.expectation ? `<small>${escapeHtml(result.expectation)}</small>` : ""}















    </div>















  `;















}































async function requestJudge(code, actualOpenPct, date) {















  const response = await fetch("/api/preplan/judge", {















    method: "POST",















    headers: { "Content-Type": "application/json" },















    body: JSON.stringify({ code, actualOpenPct, ...(date ? { date } : {}) }),















  });















  return response.json();















}































function refreshPreplanView() {















  renderPpCycleBar();















  if (preplanForm && !preplanForm.elements.planDate.value) {















    preplanForm.elements.planDate.value = ppDefaultPlanDate();















  }















  updatePpLockUI();















  fillPpDatalist(getPpCandidates());















  loadPreplanList();















  // 明日预期：本次会话没抓取时，从上次抓取的缓存恢复（带日期，旧了能看出来）















  try {















    const saved = safeParseJSON(localStorage.getItem("shortModelOutlook") || "null", null);















    if (saved && document.querySelector("#ppOutlookBody")) {















      renderTomorrowOutlook({ tomorrowOutlook: saved });















    }















  } catch {}















}































if (preplanForm) {















  preplanForm.addEventListener("submit", submitPreplan);















  preplanForm.elements.planDate.addEventListener("change", updatePpLockUI);















  for (const radio of preplanForm.querySelectorAll('input[name="logicType"]')) {















    radio.addEventListener("change", updatePpLogicFields);















  }















  // 从候选池选代码 → 自动带出名称/方向















  preplanForm.elements.code.addEventListener("change", () => {















    const cand = getPpCandidates()[preplanForm.elements.code.value.trim()];















    if (!cand) return;















    if (!preplanForm.elements.name.value) preplanForm.elements.name.value = cand.name;















    if (!preplanForm.elements.sector.value) preplanForm.elements.sector.value = cand.sector;















  });































  // 预案卡内动作：竞价判定 / 缺数据手动补















  preplanList.addEventListener("click", async (event) => {















    const fillBtn = event.target.closest("[data-rl-fill]");















    if (fillBtn) {















      const [code, date] = fillBtn.dataset.rlFill.split("|");















      const row = fillBtn.closest(".rl-fill-row");















      const prevClose = Number(row.querySelector(".rl-fill-prev").value) || undefined;















      const ma5 = Number(row.querySelector(".rl-fill-ma5").value) || undefined;















      await loadRedlineFor({ code, planDate: date }, { prevClose, ma5 });















      return;















    }















    const judgeBtn = event.target.closest("[data-pp-judge]");















    if (judgeBtn) {















      const [code, date] = judgeBtn.dataset.ppJudge.split("|");















      const cardEl = judgeBtn.closest(".preplan-card");















      const resultEl = cardEl.querySelector(".pp-judge-result");















      const pct = cardEl.querySelector(".pp-judge-pct").value;















      if (pct === "") {















        resultEl.innerHTML = `<span class="pp-error">先输入实际开盘涨幅%（9:25 集合竞价结果）</span>`;















        return;















      }















      try {















        const result = await requestJudge(code, Number(pct), date);















        resultEl.innerHTML = result.ok ? judgeResultHtml(result) : `<span class="pp-error">${escapeHtml(result.error || "判定失败")}</span>`;















      } catch (error) {















        resultEl.innerHTML = `<span class="pp-error">判定失败：${escapeHtml(error.message)}</span>`;















      }















    }















  });































  // 独立判定框：没预案的票也能问，答案就是后端那句"系统外操作不该买"















  document.querySelector("#judgeBtn").addEventListener("click", async () => {















    const code = document.querySelector("#judgeCode").value.trim();















    const pct = document.querySelector("#judgePct").value;















    const resultEl = document.querySelector("#judgeResult");















    if (!code || pct === "") {















      resultEl.innerHTML = `<span class="pp-error">代码和实际开盘涨幅%都要填</span>`;















      return;















    }















    try {















      const result = await requestJudge(code, Number(pct));















      resultEl.innerHTML = result.ok ? judgeResultHtml(result) : `<div class="judge-verdict judge-no-plan"><strong>🚫 ${escapeHtml(result.error || "判定失败")}</strong></div>`;















    } catch (error) {















      resultEl.innerHTML = `<span class="pp-error">判定失败：${escapeHtml(error.message)}</span>`;















    }















  });















}































// 个股卡「录预案」→ 切到预案页并预填















function openPreplanForm(code) {















  navigateToWorkflowView("preplan");















  const cand = getPpCandidates()[code] || {};















  preplanForm.elements.code.value = code;















  preplanForm.elements.name.value = cand.name || "";















  preplanForm.elements.sector.value = cand.sector || "";















  if (!preplanForm.elements.planDate.value) preplanForm.elements.planDate.value = ppDefaultPlanDate();















  updatePpLockUI();















  ppSetMsg(`已带出 ${cand.name || code}，补齐逻辑后保存`, "");















}















for (const pool of [selectedStocks, rejectedStocks]) {















  pool.addEventListener("click", (event) => {















    const button = event.target.closest("[data-preplan]");















    if (button) {
      const code = String(button.dataset && button.dataset.preplan || "").trim();
    if (button.disabled || !premarketExecutablePlanCodes(lastPremarketFlowModel, lastHotPayload).has(code)) return;
      openPreplanForm(code);
    }















  });















}































document.querySelectorAll(".nav-item").forEach((item) => {















  item.addEventListener("click", (event) => {















    event.preventDefault();















    navigateToWorkflowView(item.dataset.view);















  });















});































document.querySelectorAll("[data-mode-view]").forEach((item) => {















  item.addEventListener("click", () => {















    navigateToWorkflowView(item.dataset.modeView);















  });















});































const themeLibraryDateSelect = document.querySelector("#themeLibraryDateSelect");
const themeLibraryLatestBtn = document.querySelector("#themeLibraryLatestBtn");
const themeLibraryRefreshBtn = document.querySelector("#themeLibraryRefreshBtn");

if (themeLibraryDateSelect) {
  themeLibraryDateSelect.addEventListener("change", () => {
    const date = String(themeLibraryDateSelect.value || "").trim();
    if (date) loadThemeLibrary(date);
  });
}
if (themeLibraryLatestBtn) {
  themeLibraryLatestBtn.addEventListener("click", () => loadThemeLibrary());
}
if (themeLibraryRefreshBtn) {
  themeLibraryRefreshBtn.addEventListener("click", async () => {
    const originalLabel = themeLibraryRefreshBtn.textContent;
    const refreshIntentId = ++themeLibraryViewState.requestId;
    themeLibraryViewState.refreshing = true;
    themeLibraryRefreshBtn.disabled = true;
    themeLibraryRefreshBtn.textContent = "正在更新…";
    setThemeLibraryLoading("正在抓取最新市场并生成题材快照…");
    try {
      const result = await loadHotStocks();
      if (refreshIntentId !== themeLibraryViewState.requestId) return;
      if (!result || result.ok !== true || result.fresh !== true || result.payload && result.payload.stale === true) {
        const reason = result && result.error || "实时服务未返回可归档的新快照";
        setThemeLibraryLoading(`更新失败，仍显示原题材快照：${reason}`);
        return;
      }
      await loadThemeLibrary();
    } finally {
      themeLibraryViewState.refreshing = false;
      themeLibraryRefreshBtn.disabled = false;
      themeLibraryRefreshBtn.textContent = originalLabel;
    }
  });
}

initializeWorkflowNavigation();
navigateToWorkflowView(workflowViewFromHash(), { historyMode: "replace" });































updateView();















renderWatchlist();















renderHistory();















loadRealtime();















sellAdvisorHoldingsReady = initializeSellAdvisorHoldings();

initializeHotStocks().catch(() => {});
readCloudHistorySyncStatus();
































// ========== 盘后归档按钮 ==========
const archiveBtn = document.querySelector("#archiveBtn");
if (cloudHistorySyncBtn) cloudHistorySyncBtn.addEventListener("click", runCloudHistorySync);
if (localVerifyHotStocksBtn) localVerifyHotStocksBtn.addEventListener("click", runLocalHotStocksVerification);
if (decisionLaneLocalBtn) decisionLaneLocalBtn.addEventListener("click", () => activateDecisionAuthorityLane("local", { detail: "手动切换到本机最新观察快照。" }));
if (decisionLaneCloudBtn) decisionLaneCloudBtn.addEventListener("click", () => activateDecisionAuthorityLane("cloud", { detail: "手动切换到已验证云端正式快照。" }));
if (archiveBtn) {
  archiveBtn.addEventListener("click", async () => {
    if (activeDecisionAuthority === "cloud") {
      alert("当前展示的是手机云端已验证正式决策。它已由云端归档并通过云端历史同步保存；本按钮不会用本机缓存覆盖它。");
      return;
    }
    if (!confirm("确认要归档今日数据吗？\n\n这会将当前数据保存到 data/history/ 目录，供明日回流预期功能使用。")) {
      return;
    }

    archiveBtn.disabled = true;
    archiveBtn.textContent = "💾 归档中...";

    try {
      const response = await fetch("/api/archive/run", { method: "POST" });
      const result = await response.json();

      if (result.ok) {
        alert(`✅ 归档成功！\n\n日期：${result.date}\n摘要：${result.summary || "已保存"}\n\n数据已保存到 data/history/${result.date}.json`);
        archiveBtn.textContent = "✅ 已归档";
        setTimeout(() => {
          archiveBtn.textContent = "💾 盘后归档";
          archiveBtn.disabled = false;
        }, 3000);
      } else {
        alert(`❌ 归档失败\n\n${result.error || "未知错误"}`);
        archiveBtn.textContent = "💾 盘后归档";
        archiveBtn.disabled = false;
      }
    } catch (error) {
      alert(`❌ 归档失败\n\n${error.message}`);
      archiveBtn.textContent = "💾 盘后归档";
      archiveBtn.disabled = false;
    }
  });
}
