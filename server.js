const http = require("http");















const fs = require("fs");















const path = require("path");















const { execFile } = require("child_process");

const clean = (value) => String(value ?? "").trim();















const { promisify } = require("util");















const { computeMaProfile, hardGate, classifySubPhase, tradeMode, stopProfitLoss } = require("./trading-rules");
const { classifyFundFlow } = require("./flow-classifier");
const { buildTomorrowExecutionBoard } = require("./tomorrow-execution");
const { buildTomorrowMarketForecast } = require("./tomorrow-market-forecast");
const { buildCoreEmotionBasket } = require("./core-emotion-lifecycle");
const { buildTomorrowDecision } = require("./tomorrow-decision");
const { buildTomorrowOpportunityMap } = require("./tomorrow-opportunity-map");
const { buildPostCloseOpportunityReport } = require("./post-close-opportunity");
const { createThemeAttributionReviewHandler } = require("./theme-attribution-review");
const { buildRecentIndexEmotionRelation } = require("./recent-index-emotion-relation");
const {
  INDEX_CYCLE_REGIME_VERSION,
  buildIndexCycleRegime,
} = require("./index-cycle-regime");
const { buildMarketPhaseDetail } = require("./market-phase-detail");
const { buildTomorrowDecisionContext } = require("./tomorrow-decision-context");
const {
  EMOTION_CORE_EVIDENCE_CONTRACT_VERSION,
  MAX_STRICT_EMOTION_CORES,
  STRICT_CORE_CLASSIFIER_VERSION,
  buildEmotionCoreEvidenceContract,
  buildEmotionCoreEvidenceFromPayload,
  previousRowLineageMatches,
  validatePreviousEvidence,
} = require("./emotion-core-evidence-contract");
const {
  buildEmotionScenarioInference,
  unavailableEmotionScenarioInference,
  validateEmotionScenarioInference,
} = require("./emotion-scenario-inference");
const {
  STYLE_CLASSIFIER_VERSION,
  STYLE_RULE_SIGNATURE,
  buildTradingStylePreference,
} = require("./trading-style-preference");
const { buildEmotionCycleState } = require("./emotion-cycle-engine");
const { buildPremarketFlow } = require("./premarket-flow");
const { serveIndexOpportunityEvidence } = require("./index-opportunity-evidence");
const { resolveFetchEvidenceQuality } = require("./fetch-evidence-quality");
const {
  HOT_RANK_TARGET,
  canonicalHotRankRows,
  publicRankMeta,
  rankStatusNote,
  resolveHotRankSource,
  updateHotRankCache,
} = require("./hot-rank-source");
const {
  CAPABILITIES: DATA_CAPABILITIES,
  DataProviderRegistry,
  createDataBundle,
  createFreeFallbackProvider,
  loadConfiguredProviders,
} = require("./data-providers");

const { resolveDecisionPrice, applyBestPickPriceIntegrity } = require("./price-integrity");















const { evaluateV7SellDecision } = require("./quant-decision/v7-sell-decision");
const {
  buildPreviousLimitUpSeeds,
  excludePreviousLimitUpOnly,
} = require("./quant-decision/limit-up-pullback-repair");















const { createJournalHandler } = require("./journal");















const journalHandler = createJournalHandler({ sendJson }); // 复用现有的 sendJson















const { createPreplanHandler, loadPlans: loadPreplans, todayYmd: preplanTodayYmd, buildAuctionExpectation } = require("./preplan");















function isCurrentExecutablePreplanCode(code) {
  try {
    const normalizedCode = String(code || "").trim();
    if (!normalizedCode) return false;
    const payload = normalizeHotStocksFallbackResponse(loadHotStocksFallback());
    const authority = inspectAuthoritativeDecisionChain(payload);
    if (!authority.valid || !authority.selectedCodeSet.has(normalizedCode)) return false;
    const authorization = authority.chain.authorization || {};
    const tradePermission = authorization.tradePermission || {};
    if (authorization.passed !== true || tradePermission.allowNew !== true) return false;
    const flow = buildPremarketFlow(payload);
    const tradePlan = flow && flow.tradePlan && typeof flow.tradePlan === "object" ? flow.tradePlan : {};
    return tradePlan.status === "ready"
      && tradePlan.canIssueAdvice === true
      && Array.isArray(tradePlan.plans)
      && tradePlan.plans.some((plan) => (
        String(plan && plan.code || "").trim() === normalizedCode
        && authority.selectedCodeSet.has(String(plan && plan.code || "").trim())
      ));
  } catch {
    return false;
  }
}

const preplanHandler = createPreplanHandler({ sendJson, authorizePlanCode: isCurrentExecutablePreplanCode });

const themeAttributionReviewHandler = createThemeAttributionReviewHandler({
  sendJson,
  loadCurrentContext: () => themeAttributionReviewContext(loadHotStocksFallback()),
});















const { buildRedlineCard } = require("./redline");















const { fetchGlobalNews, fetchStockNews, fetchStockReports, fetchAnnouncements, newsKeywordHits } = require("./news-fetcher");
const {
  LEADERSHIP_SCHEMA_VERSION,
  timeToMinutes,
  parseIntradayTrendPayload,
  parseTencentMinutePayload,
  normalizeIntradayEvidenceSummary,
  isClosingIntradayInitiative,
  selectLeadershipTargets,
  buildCoreLeadershipBoard,
} = require("./core-leadership");
const { buildSuperExpectationRadar } = require("./super-expectation");
const { buildEventInference } = require("./event-engine");
const { fetchJiuyanTimeline, loadCachedJiuyanTimeline } = require("./jiuyan-timeline");
const { fetchMarketCalendar, loadCachedMarketCalendar, mergeCalendarSources } = require("./market-calendar");
const {
  ENGINE_VERSION: MARKET_CYCLE_ENGINE_VERSION,
  analyzeMarketCycleEffects,
  buildEmotionEffectContext,
  analyzeIndexEnvironment,
  analyzeTradingWindow,
  resolveStructuralCycle,
} = require("./market-cycle-engine");
const {
  VERSION: EMOTION_BIG_CYCLE_WINDOW_VERSION,
  METHOD: EMOTION_BIG_CYCLE_WINDOW_METHOD,
  WINDOW_DAYS: EMOTION_BIG_CYCLE_WINDOW_DAYS,
  buildEmotionBigCycleWindow,
} = require("./emotion-big-cycle-window");
const { buildMarketEffectAttribution } = require("./market-effect-attribution");
const { buildMarketStrengthSource } = require("./market-strength-source");
const {
  THEME_LIBRARY_CLASSIFIER_VERSION,
  buildThemeLibrarySnapshot,
  compareThemeLibrarySnapshots,
  normalizeTradingDate: normalizeThemeLibraryDate,
  themeCycleEvidence,
  themeLibraryGenerationId,
  themeLibraryTradingDate,
} = require("./theme-library");
const {
  AI_COMPUTE_FAMILY,
  MEDICAL_FAMILY,
  canonicalThemeFamily,
} = require("./theme-taxonomy");

function buildEventInferenceSnapshot(payload) {
  try {
    const globalNews = payload && payload.news && Array.isArray(payload.news.global) ? payload.news.global : [];
    const eventCalendar = payload && payload.eventCalendar && typeof payload.eventCalendar === "object"
      ? payload.eventCalendar
      : { items: [], status: null };
    const eastmoneyState = payload && payload.stale ? "stale-cache" : globalNews.length ? "live" : "unavailable";
    const calendarStatuses = Array.isArray(eventCalendar.statuses)
      ? eventCalendar.statuses
      : eventCalendar.status ? [eventCalendar.status] : [];
    const sourceStatuses = [
      {
        key: "eastmoney-news",
        label: "东财7×24",
        state: eastmoneyState,
        ok: globalNews.length > 0,
        itemCount: globalNews.length,
        fetchedAt: payload && (payload.fetchedAt || payload.updatedAt) || null,
        message: globalNews.length ? (eastmoneyState === "live" ? "财经快讯抓取成功" : "正在使用已保存快讯") : "本轮没有取得快讯",
      },
      ...calendarStatuses,
    ];
    return buildEventInference({
      newsItems: [
        ...(Array.isArray(eventCalendar.items) ? eventCalendar.items : []),
        ...globalNews.map((item) => ({
          ...item,
          source: item && item.source || "东方财富7×24",
          publisher: item && item.publisher || "东方财富",
          sourceProvider: item && item.sourceProvider || "eastmoney-news",
        })),
      ],
      candidates: payload && Array.isArray(payload.candidates) ? payload.candidates : [],
      market: payload && payload.market || {},
      marketEmotion: payload && payload.marketEmotion || null,
      sourceStatuses,
      now: eventCalendar && eventCalendar.status && eventCalendar.status.servedAt
        || payload && (payload.fetchedAt || payload.updatedAt)
        || new Date().toISOString(),
    });
  } catch (error) {
    return {
      version: "event-inference-v2",
      generatedAt: new Date().toISOString(),
      sourceNote: "事件辅助层本轮降级，不影响行情、周期、候选和原决策流程。",
      marketContext: {
        cycle: payload && payload.market && payload.market.state && payload.market.state.cycle || "未知",
        subPhase: payload && payload.market && payload.market.state && payload.market.state.subPhase || "未知",
        light: payload && payload.marketEmotion && payload.marketEmotion.light || "yellow",
        note: "事件模块异常已隔离，原系统照常运行。",
      },
      summary: "事件推演本轮降级，原系统照常运行。",
      qualifiedEvents: [],
      watchEvents: [],
      filteredCount: 0,
      filtered: [],
      sources: [],
      topEventId: null,
      degraded: true,
      error: String(error && error.message || error || "unknown error"),
    };
  }
}

const { buildTodayStrongPool, buildReflowPoolStocks, buildMainLinePool, buildLowPositionPool, buildSurvivorPoolStocks, mixPools } = require("./pool-builders");
const {
  cacheArchiveDirFor,
  readRetainedJson,
  writeRetainedJson,
} = require("./cache-retention");
const {
  loadCloudHistorySyncConfig,
  syncCloudHistory,
  getCloudHistorySyncStatus,
} = require("./cloud-history-sync");
const {
  loadCloudCurrentSyncConfig,
  syncCloudCurrent,
  getCloudCurrentSyncStatus,
  loadVerifiedCloudCurrentSnapshot,
} = require("./cloud-current-sync");
const { rebuildArchiveIndex } = require("./archiver");

// ===== 昨日快照持久化：用于回流预期判断 =====
let yesterdaySnapshot = null;

function loadYesterdaySnapshot() {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
  const histFile = path.join(runtimeRoot, 'data', 'history', `${ymd}.json`);

  try {
    if (fs.existsSync(histFile)) {
      const content = fs.readFileSync(histFile, 'utf8');
      yesterdaySnapshot = JSON.parse(content);
      console.log(`✓ 加载昨日快照：${ymd}`);
    } else {
      console.log(`⚠ 昨日快照不存在：${ymd}，回流预期功能降级`);
      yesterdaySnapshot = null;
    }
  } catch (e) {
    console.error('加载昨日快照失败：', e.message);
    yesterdaySnapshot = null;
  }
}















const { isLimitUp, boardHeight, rankTier, roleContext, classifyRole, buildTotalLeader: pickTotalLeader, attachScoreParts } = require("./leader-select");
const {
  classifyMarketCapCarrierRegime,
  observeStockMarketCapCarrier,
  summarizeMarketCapCarrier,
} = require("./market-cap-carrier");
const { buildUnifiedQuantFactors } = require("./unified-quant-factors");
const {
  STOCK_FACTOR_AUTHORITY,
  STOCK_FACTOR_VERSION,
  buildUnifiedStockFactorDecision,
} = require("./quant-decision/stock-factor-engine");
const {
  buildPremarketGateFromFlow,
  executeUnifiedDecisionChain,
  inspectAuthoritativeDecisionChain: inspectDecisionChainAuthority,
  unavailableDecisionChain,
  applyDecisionChainToBestPicks,
} = require("./quant-decision/decision-chain");
const {
  LIVE_CANONICAL_STATUS,
  buildDecisionReceipt,
  validateDecisionReceipt,
} = require("./quant-decision/decision-receipt");
const {
  BIG_CYCLE_VALUES,
  normalizeBigCycle,
  normalizeBigCycleKey,
} = require("./quant-decision/market-cycle-contract");































const execFileAsync = promisify(execFile);















const root = __dirname;

// Desktop builds keep mutable caches and user records outside the installed app.
const runtimeRoot = path.resolve(process.env.A_SHARE_RUNTIME_DIR || root);

let cloudHistorySyncLastResult = null;
let cloudHistorySyncSchedulerStarted = false;
let cloudCurrentSyncLastResult = null;
let cloudCurrentSyncSchedulerStarted = false;

function cloudHistorySyncConfiguration() {
  try {
    const config = loadCloudHistorySyncConfig({ runtimeDir: runtimeRoot });
    return { configured: true, manifestUrl: config.manifestUrl };
  } catch (error) {
    return {
      configured: false,
      disabledReason: String(error && error.message || "云端历史同步未配置"),
      code: String(error && error.code || "CONFIG_MISSING"),
    };
  }
}

function summarizeCloudHistorySyncResult(result) {
  if (!result || typeof result !== "object") return null;
  const count = (value) => Array.isArray(value) ? value.length : 0;
  const manifest = result.manifest && typeof result.manifest === "object" ? result.manifest : {};
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const exactEntries = number(manifest.exactEntries);
  const legacyEligibleEntries = number(manifest.legacyEligibleEntries);
  return {
    state: result.state || null,
    startedAt: result.startedAt || null,
    finishedAt: result.finishedAt || null,
    importedCount: count(result.imported),
    conflictCount: count(result.conflicts),
    revisionCount: count(result.conflicts) + count(result.quarantined),
    quarantinedCount: count(result.quarantined),
    rejectedCount: count(result.rejected),
    failedCount: count(result.failed),
    // Keep the old operational counts above, while exposing evidence-quality
    // counts with names that cannot be confused with structural acceptance.
    structurallyAcceptedEntries: number(
      manifest.structurallyAcceptedEntries,
      number(manifest.eligible),
    ),
    formalEligibleEntries: number(
      manifest.formalEligibleEntries,
      exactEntries + legacyEligibleEntries,
    ),
    exactEntries,
    legacyEligibleEntries,
    ineligibleEntries: number(
      manifest.ineligibleEntries,
      count(result.quarantined) + count(result.localInvalid),
    ),
    structurallyRejectedEntries: number(manifest.structurallyRejectedEntries),
    indexRows: result.indexUpdate && result.indexUpdate.callbackResult
      && Number(result.indexUpdate.callbackResult.rows) || null,
  };
}

function publicCloudHistorySyncStatus() {
  const core = getCloudHistorySyncStatus();
  const configuration = cloudHistorySyncConfiguration();
  const statusMap = {
    idle: configuration.configured ? "idle" : "disabled",
    running: "running",
    success: "succeeded",
    partial: "partial",
    failed: "failed",
  };
  const status = statusMap[core.state] || (configuration.configured ? "idle" : "disabled");
  const firstError = Array.isArray(core.errors) && core.errors.length ? core.errors[0] : null;
  return {
    ...core,
    status,
    configured: configuration.configured,
    manifestUrl: configuration.configured ? configuration.manifestUrl : null,
    disabledReason: configuration.configured ? null : configuration.disabledReason,
    lastError: firstError && firstError.message || null,
    lastResult: cloudHistorySyncLastResult,
  };
}

function startCloudHistorySync(trigger = "manual") {
  const configuration = cloudHistorySyncConfiguration();
  if (!configuration.configured) {
    return {
      accepted: false,
      reused: false,
      trigger,
      error: configuration.disabledReason,
      code: configuration.code,
    };
  }
  const reused = getCloudHistorySyncStatus().running === true;
  const task = syncCloudHistory({
    runtimeDir: runtimeRoot,
    onIndexUpdate: ({ historyDir }) => {
      const index = rebuildArchiveIndex(historyDir);
      loadYesterdaySnapshot();
      return { rows: index.length };
    },
  });
  task.then((result) => {
    cloudHistorySyncLastResult = summarizeCloudHistorySyncResult(result);
    if (!result.indexUpdate || !result.indexUpdate.callbackInvoked) loadYesterdaySnapshot();
  }).catch((error) => {
    console.error(`[cloud-history-sync] ${trigger} failed: ${String(error && error.message || error)}`);
  });
  return { accepted: true, reused, trigger };
}

function startCloudHistorySyncScheduler() {
  if (cloudHistorySyncSchedulerStarted) return;
  cloudHistorySyncSchedulerStarted = true;
  const initialTimer = setTimeout(() => {
    if (cloudHistorySyncConfiguration().configured) startCloudHistorySync("startup");
  }, 15_000);
  if (typeof initialTimer.unref === "function") initialTimer.unref();
  const interval = setInterval(() => {
    if (cloudHistorySyncConfiguration().configured) startCloudHistorySync("periodic");
  }, 30 * 60_000);
  if (typeof interval.unref === "function") interval.unref();
}

function cloudCurrentSyncConfiguration() {
  try {
    const config = loadCloudCurrentSyncConfig({ runtimeDir: runtimeRoot });
    return { configured: true, manifestUrl: config.manifestUrl };
  } catch (error) {
    return {
      configured: false,
      disabledReason: String(error && error.message || "云端正式决策同步未配置"),
      code: String(error && error.code || "CONFIG_MISSING"),
    };
  }
}

function publicCloudCurrentSyncStatus() {
  const core = getCloudCurrentSyncStatus();
  const configuration = cloudCurrentSyncConfiguration();
  const statusMap = {
    idle: configuration.configured ? "idle" : "disabled",
    running: "running",
    success: "succeeded",
    failed: "failed",
  };
  const status = statusMap[core.state] || (configuration.configured ? "idle" : "disabled");
  const error = core.error && typeof core.error === "object" ? core.error : null;
  return {
    ...core,
    status,
    configured: configuration.configured,
    manifestUrl: configuration.configured ? configuration.manifestUrl : null,
    disabledReason: configuration.configured ? null : configuration.disabledReason,
    snapshotAvailable: fs.existsSync(path.join(runtimeRoot, "data", "cloud-current", "pointer.json")),
    lastError: error && error.message || null,
    lastErrorCode: error && error.code || null,
    lastErrorDetails: error && error.details || null,
    lastResult: cloudCurrentSyncLastResult,
  };
}

function startCloudCurrentSync(trigger = "manual") {
  const configuration = cloudCurrentSyncConfiguration();
  if (!configuration.configured) {
    return {
      accepted: false,
      reused: false,
      trigger,
      error: configuration.disabledReason,
      code: configuration.code,
    };
  }
  const reused = getCloudCurrentSyncStatus().running === true;
  const task = syncCloudCurrent({ runtimeDir: runtimeRoot });
  task.then((result) => {
    cloudCurrentSyncLastResult = result;
  }).catch((error) => {
    console.error(`[cloud-current-sync] ${trigger} failed: ${String(error && error.message || error)}`);
  });
  return { accepted: true, reused, trigger };
}

function startCloudCurrentSyncScheduler() {
  if (cloudCurrentSyncSchedulerStarted) return;
  cloudCurrentSyncSchedulerStarted = true;
  const initialTimer = setTimeout(() => {
    if (cloudCurrentSyncConfiguration().configured) startCloudCurrentSync("startup");
  }, 5_000);
  if (typeof initialTimer.unref === "function") initialTimer.unref();
  const interval = setInterval(() => {
    if (cloudCurrentSyncConfiguration().configured) startCloudCurrentSync("periodic");
  }, 5 * 60_000);
  if (typeof interval.unref === "function") interval.unref();
}

let cloudUnifiedProjectionCache = null;

function cloudSnapshotWithUnifiedProjection(verified) {
  const pointer = verified && verified.pointer && typeof verified.pointer === "object"
    ? verified.pointer : {};
  const sourceSha256 = String(pointer.sha256 || "").trim();
  const pointerGenerationId = String(pointer.generationId || "").trim();
  const pointerTradingDate = normalizeTradingDate(pointer.tradingDate);
  const officialPayload = JSON.parse(verified && Buffer.isBuffer(verified.bytes)
    ? verified.bytes.toString("utf8") : "null");
  const inspected = inspectDecisionChainAuthority(officialPayload, { requireBestPicksProjection: true });
  const unified = officialPayload && officialPayload.unifiedQuantFactors;
  const unifiedGeneration = unified && unified.generation && typeof unified.generation === "object"
    ? unified.generation : {};
  const officialGenerationId = String(inspected.generation && inspected.generation.generationId || "").trim();
  const officialTradingDate = normalizeTradingDate(inspected.generation && inspected.generation.tradingDate);
  const officialAsOf = String(inspected.generation && inspected.generation.asOf || "").trim();
  const reasons = [
    ...inspected.reasons,
    !sourceSha256 ? "云端原始快照SHA-256证据缺失" : null,
    !pointerGenerationId ? "云端指针代次缺失" : null,
    !pointerTradingDate ? "云端指针交易日缺失" : null,
    pointerGenerationId && pointerGenerationId !== officialGenerationId
      ? "云端指针与冻结决策链代次不一致" : null,
    pointerTradingDate && pointerTradingDate !== officialTradingDate
      ? "云端指针与冻结决策链交易日不一致" : null,
    !unified || Number(unified.version) < 6 ? "云端冻结统一量化因子v6缺失" : null,
    !unified || !unified.integrity || unified.integrity.ok !== true || unified.integrity.failClosed !== true
      ? "云端冻结统一量化因子完整性未通过" : null,
    String(unifiedGeneration.generationId || "").trim() !== officialGenerationId
      || normalizeTradingDate(unifiedGeneration.tradingDate) !== officialTradingDate
      || String(unifiedGeneration.asOf || "").trim() !== officialAsOf
      ? "云端冻结统一量化因子与决策链不在同一代次" : null,
  ].filter(Boolean);
  if (reasons.length) {
    const audit = {
      version: 1,
      status: "rejected",
      authority: "cloud_frozen_unified_decision_chain_v3",
      failClosed: true,
      localDecisionRecomputed: false,
      localHistoryUsed: false,
      sourceSnapshotSha256: sourceSha256 || null,
      pointerGenerationId: pointerGenerationId || null,
      pointerTradingDate: pointerTradingDate || null,
      officialGenerationId: officialGenerationId || null,
      officialTradingDate: officialTradingDate || null,
      reasons: [...new Set(reasons)],
    };
    const error = new Error(`云端冻结权威v3决策链未通过校验：${audit.reasons.join("；")}`);
    error.code = "CLOUD_FROZEN_DECISION_INVALID";
    error.audit = audit;
    throw error;
  }
  if (
    cloudUnifiedProjectionCache
    && cloudUnifiedProjectionCache.sourceSha256 === sourceSha256
    && cloudUnifiedProjectionCache.sourceGenerationId === officialGenerationId
    && cloudUnifiedProjectionCache.sourceTradingDate === officialTradingDate
    && Buffer.isBuffer(cloudUnifiedProjectionCache.bytes)
  ) {
    return cloudUnifiedProjectionCache;
  }
  const responsePayload = officialPayload;
  responsePayload.cloudDecisionVerification = {
    version: 1,
    status: "verified",
    authority: "cloud_frozen_unified_decision_chain_v3",
    failClosed: true,
    sourceGenerationId: officialGenerationId,
    sourceTradingDate: officialTradingDate,
    sourceAsOf: officialAsOf,
    sourceSnapshotSha256: sourceSha256,
    unifiedQuantFactorsVersion: Number(unified.version),
    unifiedDecisionChainVersion: Number(inspected.chain.version),
    frozenDecisionPreserved: true,
    localDecisionRecomputed: false,
    localHistoryUsed: false,
    note: "桌面端只验证并保留云端已冻结的同代v3决策链；不读取本机T-1档案，不重算周期、许可、候选股或仓位。",
  };
  responsePayload.localUnifiedProjection = {
    version: 3,
    status: "not_applied",
    authority: "verified_cloud_frozen_decision_passthrough",
    sourceGenerationId: officialGenerationId,
    sourceSnapshotSha256: sourceSha256,
    localDecisionRecomputed: false,
    localHistoryUsed: false,
    officialCandidatesPreserved: true,
    note: "本机投影已禁用；执行语义仅来自已验证的云端冻结v3决策链。",
  };
  const bytes = Buffer.from(JSON.stringify(responsePayload), "utf8");
  cloudUnifiedProjectionCache = {
    sourceSha256,
    sourceGenerationId: officialGenerationId,
    sourceTradingDate: officialTradingDate,
    bytes,
    payload: responsePayload,
  };
  return cloudUnifiedProjectionCache;
}

async function sendVerifiedCloudCurrentSnapshot(response) {
  try {
    const verified = await loadVerifiedCloudCurrentSnapshot({ runtimeDir: runtimeRoot });
    const projected = cloudSnapshotWithUnifiedProjection(verified);
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": projected.bytes.length,
      "Cache-Control": "no-store",
      "X-Cloud-Trading-Date": verified.pointer.tradingDate,
      "X-Cloud-Generation-Id": verified.pointer.generationId,
      "X-Cloud-Snapshot-Sha256": verified.pointer.sha256,
      "X-Cloud-Decision-Authority": "frozen-decision-chain-v3",
      "X-Local-Unified-Projection": "not-applied",
    });
    response.end(projected.bytes);
  } catch (error) {
    const missing = error && ["CURRENT_POINTER_MISSING", "ENOENT"].includes(error.code);
    sendJson(response, missing ? 404 : 409, {
      ok: false,
      error: String(error && error.message || "云端正式决策读取失败"),
      code: String(error && error.code || "CLOUD_CURRENT_INVALID"),
      audit: error && error.audit || null,
    });
  }
}















const eastmoneySnapshotFile = path.join(runtimeRoot, ".eastmoney-market.json");
const eastmoneySnapshotArchiveDir = cacheArchiveDirFor(eastmoneySnapshotFile);















const chromePaths = [















  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",















  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",















  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",















  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",















];































let marketBrowserRunner = null;































function sleep(ms) {















  return new Promise((resolve) => setTimeout(resolve, ms));















}































async function fetchViaCdp(pageUrl, evaluateExpression) {















  const chromePath = chromePaths.find((candidate) => fs.existsSync(candidate));















  if (!chromePath) {















    throw new Error("browser_not_found");















  }































  const profileDir = path.join(runtimeRoot, ".cache", "eastmoney-cdp-profile");















  fs.mkdirSync(profileDir, { recursive: true });















  const port = 9222;















  const args = [















    "--headless=new",















    "--disable-gpu",















    "--remote-debugging-port=" + port,















    "--user-data-dir=" + profileDir,















    "--no-first-run",















    "--no-default-browser-check",















    "about:blank",















  ];































  if (marketBrowserRunner) {















    try {















      marketBrowserRunner.kill("SIGKILL");















    } catch {}















    marketBrowserRunner = null;















  }































  const browser = require("child_process").spawn(chromePath, args, {















    detached: true,















    stdio: "ignore",















    windowsHide: true,















  });































  const versionUrl = `http://127.0.0.1:${port}/json/version`;















  let version = null;















  for (let i = 0; i < 50; i += 1) {















    try {















      const response = await fetch(versionUrl);















      if (response.ok) {















        version = await response.json();















        break;















      }















    } catch {}















    await sleep(200);















  }















  if (!version) {















    try {















      browser.kill("SIGKILL");















    } catch {}















    throw new Error("browser_cdp_unavailable");















  }































  const listResponse = await fetch(`http://127.0.0.1:${port}/json/list`);















  const targets = await listResponse.json();















  const wsUrl = targets[0] && targets[0].webSocketDebuggerUrl;















  if (!wsUrl) {















    try {















      browser.kill("SIGKILL");















    } catch {}















    throw new Error("browser_target_missing");















  }































  // ws 懒加载:仅无头浏览器CDP兜底路径需要。这样没装 node_modules 也能直接 node server.js 启动















  let WebSocket;















  try {















    WebSocket = require("ws");















  } catch {















    try { browser.kill("SIGKILL"); } catch {}















    throw new Error("browser_cdp_needs_ws(可选依赖未安装,跳过CDP兜底)");















  }















  const ws = new WebSocket(wsUrl);















  let id = 0;















  const pending = new Map();















  ws.on("message", (buffer) => {















    const message = JSON.parse(buffer.toString("utf8"));















    if (!message.id || !pending.has(message.id)) return;















    const entry = pending.get(message.id);















    pending.delete(message.id);















    if (message.error) {















      entry.reject(new Error(message.error.message || "cdp_error"));















      return;















    }















    entry.resolve(message.result);















  });































  await new Promise((resolve, reject) => {















    ws.once("open", resolve);















    ws.once("error", reject);















  });































  const send = (method, params = {}) =>















    new Promise((resolve, reject) => {















      const messageId = ++id;















      pending.set(messageId, { resolve, reject });















      ws.send(JSON.stringify({ id: messageId, method, params }));















    });































  try {















    await send("Page.enable");















    await send("Runtime.enable");















    await send("Page.navigate", { url: pageUrl });















    await sleep(5000);















    const result = await send("Runtime.evaluate", {















      expression: evaluateExpression,















      awaitPromise: true,















      returnByValue: true,















    });















    return result.result.value;















  } finally {















    try {















      ws.close();















    } catch {}















    try {















      browser.kill("SIGKILL");















    } catch {}















  }















}































const port = Number(process.env.PORT || 5173);















const hotStocksCacheFile = path.join(runtimeRoot, ".hot-stocks-cache.json");
const hotStocksCacheArchiveDir = cacheArchiveDirFor(hotStocksCacheFile);
const hotRankCacheFile = path.join(runtimeRoot, ".hot-rank-cache.json");
const hotRankCacheArchiveDir = cacheArchiveDirFor(hotRankCacheFile);
const jiuyanTimelineCacheFile = path.join(runtimeRoot, ".jiuyan-timeline-cache.json");
const marketCalendarCacheFile = path.join(runtimeRoot, ".market-calendar-cache.json");















const cycleStateFile = path.join(runtimeRoot, ".cycle-state.json");
const cycleHistoryDir = path.join(runtimeRoot, "data", "cycle-history");
const cycleHistoryRevisionDir = path.join(runtimeRoot, "data", "cycle-history-revisions", "local");

const klineProfileCacheFile = path.join(runtimeRoot, "data", "kline-profile-cache.json");
const klineProfileSeedFile = path.join(root, "data", "seed-kline-profiles.json");
const intradayLeadershipCacheFile = path.join(runtimeRoot, "data", "intraday-leadership-cache.json");































function isAfterMarketClose(now = new Date()) {















  const clock = shanghaiClockParts(now);
  const minutes = clock ? clock.hour * 60 + clock.minute : now.getHours() * 60 + now.getMinutes();















  return minutes >= 15 * 60;















}































// 五大周期显式转移。修复属于过渡/小周期，不进入大周期枚举。















const BIG_CYCLE_TRANSITIONS = Object.freeze({
  冰点: Object.freeze(["冰点", "退潮", "混沌"]),
  混沌: Object.freeze(["混沌", "主升", "震荡", "退潮"]),
  主升: Object.freeze(["主升", "震荡", "退潮"]),
  震荡: Object.freeze(["震荡", "主升", "混沌", "退潮"]),
  退潮: Object.freeze(["退潮", "冰点", "混沌", "震荡"]),
});















function applyCycleIrreversibility(rawCycle, today, options = {}) {















  try {















    const stored = readJsonFile(cycleStateFile); // { cycle, date }
    const storedCycle = normalizeBigCycle(stored && (stored.structuralCycle || stored.cycle));
    rawCycle = normalizeBigCycle(rawCycle) || storedCycle || "混沌";















    // 凌晨/盘前(00:00-09:20)：行情接口的"今日"已滚动到新交易日但只有残值















    // （涨停数/成交额都不是有效收盘数据），用它判周期是垃圾进垃圾出——















    // 不确认、不落盘，沿用上一交易日已确认的周期















    const afterClose = options.afterClose ?? isAfterMarketClose(options.now || new Date());















    if (!afterClose) {















      return storedCycle || rawCycle;















    }















    if (stored && stored.date === today) return rawCycle; // 同日收盘重算以当日原始判定为准，避免旧结论继续压住新盘面















    const last = storedCycle || rawCycle;















    let finalCycle = rawCycle;















    if (last && last !== rawCycle) {















      const allowedTransitions = BIG_CYCLE_TRANSITIONS[last] || [];















      const transitionKnown = BIG_CYCLE_VALUES.includes(rawCycle);















      if (transitionKnown) {















        const canAdvance = allowedTransitions.includes(rawCycle);















        if (canAdvance) finalCycle = rawCycle;















        else finalCycle = last; // 非法跳转维持上一收盘大周期















      }















    }















    writeJsonFile(cycleStateFile, { cycle: finalCycle, date: today });















    return finalCycle;















  } catch {















    return rawCycle;















  }















}















const DATA_SOURCE_CACHE_TTL_MS = Number(process.env.DATA_SOURCE_CACHE_TTL_MS || 3000);















const DATA_SOURCE_TIMEOUT_MS = Number(process.env.DATA_SOURCE_TIMEOUT_MS || 8000);















const DEFAULT_REALTIME_SYMBOLS = ["000001.SZ", "600000.SH", "399001.SZ", "399006.SZ"];















const DATA_SOURCE_ORDER = ["tencent", "mock", "fallback"];































const dataSourceHealth = new Map();















const dataSourceCache = new Map();































const types = {















  ".html": "text/html; charset=utf-8",















  ".css": "text/css; charset=utf-8",















  ".js": "application/javascript; charset=utf-8",















};































function sendJson(response, status, payload) {















  response.writeHead(status, {















    "Content-Type": "application/json; charset=utf-8",















    "Cache-Control": "no-store",















  });















  response.end(JSON.stringify(payload));















}































function readJsonFile(filePath) {















  try {















    return JSON.parse(fs.readFileSync(filePath, "utf8"));















  } catch (error) {
    return null;















  }















}































function writeJsonFile(filePath, payload) {















  try {















    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");















  } catch {















    return null;















  }















}































const coreWatchFile = path.join(runtimeRoot, "data", "core-watch.json");
const coreWatchArchiveDir = path.join(runtimeRoot, "data", "cache-history", "core-watch");
const sellAdvisorHoldingsFile = path.join(runtimeRoot, "data", "sell-advisor-holdings.json");
const sellAdvisorHoldingsArchiveDir = path.join(runtimeRoot, "data", "cache-history", "sell-advisor-holdings");















const CORE_WATCH_WINDOW_DAYS = 30;































function sanitizeSellAdvisorHolding(raw) {
  if (!raw || typeof raw !== "object") return null;
  const code = clean(raw.code).slice(0, 20);
  if (!code) return null;
  const finiteNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const nullableNumber = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  return {
    code,
    name: clean(raw.name || code).slice(0, 80),
    sector: clean(raw.sector).slice(0, 120),
    role: clean(raw.role || "核心回撤").slice(0, 40),
    buyPrice: finiteNumber(raw.buyPrice),
    currentPrice: finiteNumber(raw.currentPrice),
    positionPct: nullableNumber(raw.positionPct),
    buyReason: clean(raw.buyReason).slice(0, 500),
    note: clean(raw.note).slice(0, 1000),
  };
}

function sanitizeSellAdvisorHoldings(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .map(sanitizeSellAdvisorHolding)
    .filter((item) => {
      if (!item || seen.has(item.code)) return false;
      seen.add(item.code);
      return true;
    })
    .slice(0, 100);
}

function readSellAdvisorHoldingsStore() {
  const raw = readRetainedJson(sellAdvisorHoldingsFile, { archiveDir: sellAdvisorHoldingsArchiveDir }) || {};
  const holdings = Array.isArray(raw) ? raw : raw.holdings;
  return {
    version: 1,
    updatedAt: Array.isArray(raw) ? null : raw.updatedAt || null,
    holdings: sanitizeSellAdvisorHoldings(holdings),
  };
}

function writeSellAdvisorHoldingsStore(rows) {
  const store = {
    version: 1,
    updatedAt: nowIso(),
    holdings: sanitizeSellAdvisorHoldings(rows),
  };
  if (!writeRetainedJson(sellAdvisorHoldingsFile, store, { archiveDir: sellAdvisorHoldingsArchiveDir })) {
    throw new Error("持仓本地文件写入失败");
  }
  return store;
}

function addDaysYmd(ymd, days) {















  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;















  const d = new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));















  d.setDate(d.getDate() + days);















  const p = (n) => String(n).padStart(2, "0");















  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());















}































function readCoreWatchStore() {















  const raw = readRetainedJson(coreWatchFile, { archiveDir: coreWatchArchiveDir }) || {};















  return {















    version: Number(raw.version || 1),
    updatedAt: raw.updatedAt || null,
    tradingDate: raw.tradingDate || null,















    windowDays: Number(raw.windowDays) > 0 ? Number(raw.windowDays) : CORE_WATCH_WINDOW_DAYS,















    entries: Array.isArray(raw.entries) ? raw.entries : [],















  };















}































function writeCoreWatchStore(store) {















  if (!writeRetainedJson(coreWatchFile, store, { archiveDir: coreWatchArchiveDir })) {
    console.error("核心观察池写入失败，已保留上一份有效归档");
    return false;
  }
  return true;















}































function coreWatchSnapshot(stock, payload, stamp) {















  const marketState = (payload.market && payload.market.state) || {};















  const limitStats = (payload.market && payload.market.limitStats) || null;















  return {















    date: marketSnapshotTradingDate(payload) || (shanghaiClockParts(stamp) || {}).date || String(stamp).slice(0, 10),















    ts: stamp,















    code: String(stock.code || stock.symbol || ""),















    name: stock.name || "",















    board: stock.board || "",















    mainConcept: stock.mainConcept || stock.concept || "???",















    role: stock.role || "????",















    roleKind: stock.roleKind || null,

    roleScope: stock.roleScope || null,

    dailyRole: stock.dailyRole || null,

    roleReason: stock.roleReason || "",















    setup: stock.setup || stock.ticketType || "观察",
    source: stock.coreWatchSource || (stock.coreWatchRetained ? "retained-refresh" : "current"),















    score: Number(stock.score || 0),















    changePct: Number(stock.changePct || 0),















    turnoverRate: Number(stock.turnoverRate || 0) || null,















    selected: Boolean(stock.selected),















    inBothSources: Boolean(stock.inBothSources),
    isDriver: Boolean(stock.isDriver),
    initiativeScore: Number.isFinite(Number(stock.initiativeScore)) ? Number(stock.initiativeScore) : null,
    leadership: stock.leadership ? {
      version: Number(stock.leadership.version || 1),
      level: stock.leadership.level || "L1",
      levelLabel: stock.leadership.levelLabel || "普通跟随",
      identity: stock.leadership.identity || "跟随观察",
      focusMatch: Boolean(stock.leadership.focusMatch),
      recognized: Boolean(stock.leadership.recognized),
      coreQualified: Boolean(stock.leadership.coreQualified),
      coreIdentityQualified: Boolean(stock.leadership.coreIdentityQualified),
      repairCoreQualified: Boolean(stock.leadership.repairCoreQualified),
      tradeState: stock.leadership.tradeState || "仅观察",
      executionNote: stock.leadership.executionNote || "等待验证",
      hardFails: Array.isArray(stock.leadership.hardFails) ? stock.leadership.hardFails.slice() : [],
      impactScore: Number.isFinite(Number(stock.leadership.impactScore)) ? Number(stock.leadership.impactScore) : null,
      initiative: stock.leadership.initiative || null,
      structure: stock.leadership.structure || null,
    } : null,















    marketCycle: marketState.cycle || "",















    marketSubPhase: marketState.subPhase || "",















    marketOperation: marketState.operation || "",















    limitUpCount: limitStats ? Number(limitStats.ztToday || 0) : null,















    limitDownCount: limitStats ? Number(limitStats.dtToday || 0) : null,















    reasons: Array.isArray(stock.reasons) ? stock.reasons.slice(0, 4) : [],















    rejects: Array.isArray(stock.rejects) ? stock.rejects.slice(0, 4) : [],















  };















}































function collectCoreWatchSeeds(payload) {
  const seeds = [];
  const seen = new Set();
  const candidateByCode = new Map(
    ((payload && payload.candidates) || []).map((stock) => [String(stock && (stock.code || stock.symbol) || "").trim(), stock]),
  );
  const pushSeed = (stock, sourceKind) => {
    if (!stock) return;
    const cycleIdentity = stock && stock.leadership && stock.leadership.cycleIdentity || {};
    const verifiedCycleCore = Boolean(
      stock.roleKind === "cycleLeader"
      || stock.roleScope === "cycle"
      || cycleIdentity.identityEstablished === true
        && cycleIdentity.activePrimary !== false
        && ["confirmed", "retained"].includes(String(cycleIdentity.state || "")),
    );
    if ((stock.roleKind === "dailyHeight" || stock.roleScope === "session" || stock.dailyRole === "当日高度")
      && !verifiedCycleCore) return;
    const code = String(stock.code || stock.symbol || "").trim();
    if (!code || seen.has(code)) return;
    const seed = { ...(candidateByCode.get(code) || {}), ...stock };
    if (sourceKind) seed.coreWatchSource = sourceKind;
    seeds.push(seed);
    seen.add(code);
  };

  const leadershipCarriers = payload && payload.leadershipBoard && Array.isArray(payload.leadershipBoard.tradeCarriers)
    ? payload.leadershipBoard.tradeCarriers
    : [];
  for (const stock of leadershipCarriers) pushSeed(stock, "active-leader");
  const leadershipObservations = payload && payload.leadershipBoard && Array.isArray(payload.leadershipBoard.observations)
    ? payload.leadershipBoard.observations
    : [];
  for (const stock of leadershipObservations.filter((item) => item && item.repairCoreQualified)) {
    pushSeed(stock, "repair-core");
  }

  const topicItems = Array.isArray(payload && payload.topicBoard && payload.topicBoard.items) ? payload.topicBoard.items : [];
  for (const item of topicItems) {
    const topicName = String(item && (item.displayName || item.name || item.family) || "").trim();
    const pushTopicSeed = (stock, sourceKind) => {
      if (!stock) return;
      pushSeed({
        ...stock,
        mainConcept: stock.mainConcept || stock.concept || topicName,
        concept: stock.concept || stock.mainConcept || topicName,
      }, sourceKind);
    };
    if (Array.isArray(item.leaders)) {
      for (const leader of item.leaders) pushTopicSeed(leader, "topic-leader");
    }
    pushTopicSeed(item.leader, "topic-leader");
    pushTopicSeed(item.zhongjun, "topic-zhongjun");
  }

  for (const stock of (payload && payload.candidates) || []) {
    if (stock && stock.coreWatchRetained) pushSeed(stock, "retained-refresh");
  }

  if (!seeds.length) {
    for (const stock of (payload && payload.selected) || []) {
      if (stock && (stock.role === "龙头" || stock.role === "中军" || stock.ticketType === "容量票")) {
        pushSeed(stock, "selected");
      }
    }
  }

  return seeds;
}

function isCoreWatchCandidate(stock) {

  if (stock && stock.leadership && stock.leadership.coreQualified) return true;
  if (stock && stock.leadership && stock.leadership.repairCoreQualified) return true;
  if (stock && stock.coreWatchRetained) return true;















  const score = Number(stock && stock.score);















  if (!Number.isFinite(score) || score < 62) return false;















  const code = String((stock && (stock.code || stock.symbol)) || "");















  if (!code) return false;















  const concept = String((stock && (stock.mainConcept || stock.concept)) || "").trim();















  if (!concept || concept === "???" || concept === "?????") return false;















  const role = String((stock && stock.role) || "");















  const setup = String((stock && stock.setup) || "");















  if (["总龙头", "龙头", "中军"].includes(role)) return true;















  if (["核心回撤", "核心低吸", "趋势回撤", "回流低吸", "容量趋势"].includes(setup)) return true;















  return Boolean(stock && stock.selected && score >= 70);















}































function syncCoreWatchPool(payload) {















  const stamp = payload && (payload.fetchedAt || payload.updatedAt) ? String(payload.fetchedAt || payload.updatedAt) : nowIso();















  const today = marketSnapshotTradingDate(payload) || (shanghaiClockParts(stamp) || {}).date || stamp.slice(0, 10);















  const windowDays = CORE_WATCH_WINDOW_DAYS;















  const store = readCoreWatchStore();















  store.windowDays = windowDays;















  const byCode = new Map((store.entries || []).map((entry) => [String(entry.code || ""), entry]));































  for (const stock of collectCoreWatchSeeds(payload)) {















    if (!isCoreWatchCandidate(stock)) continue;















    const code = String(stock.code || stock.symbol || "");















    if (!code) continue;















    const snapshot = coreWatchSnapshot(stock, payload, stamp);















    let entry = byCode.get(code);















    if (!entry) {















      entry = {















        code,















        name: stock.name || "",















        board: snapshot.board,















        mainConcept: snapshot.mainConcept,















        role: snapshot.role,















        setup: snapshot.setup,















        score: snapshot.score,















        firstSeenAt: stamp,















        lastSeenAt: stamp,















        expiresAt: addDaysYmd(today, windowDays),















        initialSnapshot: snapshot,















        latestSnapshot: snapshot,















        history: [snapshot],















      };















      byCode.set(code, entry);















    } else {















      const existingSnapshot = entry.latestSnapshot || (Array.isArray(entry.history) ? entry.history[entry.history.length - 1] : null);
      const qualityRank = (initiative) => {
        const key = String(initiative && initiative.dataQualityKey || "");
        if (key === "exact_closing_full_ohlc") return 5;
        if (key === "exact_closing_price_series") return 4;
        if (key.startsWith("exact_closing_")) return 3;
        if (key === "partial_session") return 2;
        return ({ 分时验证: 3, 分时部分验证: 2, 收盘代理: 1, 数据待确认: 0 }[String(initiative && initiative.dataQuality || "")] ?? 0);
      };
      const existingQuality = existingSnapshot && existingSnapshot.leadership && existingSnapshot.leadership.initiative || null;
      const incomingQuality = snapshot.leadership && snapshot.leadership.initiative || null;
      if (existingSnapshot && existingSnapshot.date === snapshot.date && qualityRank(existingQuality) > qualityRank(incomingQuality)) {
        snapshot.leadership = existingSnapshot.leadership;
        snapshot.isDriver = Boolean(existingSnapshot.isDriver);
        snapshot.initiativeScore = Number.isFinite(Number(existingSnapshot.initiativeScore))
          ? Number(existingSnapshot.initiativeScore)
          : snapshot.initiativeScore;
      }

      entry.name = stock.name || entry.name || "";















      entry.board = snapshot.board;















      entry.mainConcept = snapshot.mainConcept;















      entry.role = snapshot.role;















      entry.setup = snapshot.setup;















      entry.score = snapshot.score;















      entry.latestSnapshot = snapshot;















      entry.lastRefreshedAt = stamp;
      if (stock.coreWatchSource !== "retained-refresh") {
        entry.lastSeenAt = stamp;















        entry.expiresAt = addDaysYmd(today, windowDays);
      }















      if (!entry.initialSnapshot) entry.initialSnapshot = snapshot;















      entry.history = Array.isArray(entry.history) ? entry.history : [];















      if (!entry.history.length || entry.history[entry.history.length - 1].date !== snapshot.date) {















        entry.history.push(snapshot);















      } else {
        entry.history[entry.history.length - 1] = snapshot;
      }















    }















    entry.history = Array.isArray(entry.history) ? entry.history.slice(-windowDays) : [snapshot];















    entry.daysTracked = entry.history.length;















    entry.status = snapshot.selected ? "active" : "watch";















    entry.windowDays = windowDays;















  }































  const entries = Array.from(byCode.values())















    .filter((entry) => !entry.expiresAt || entry.expiresAt >= today)















    .sort((a, b) => {















      if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);















      if ((b.lastSeenAt || "") !== (a.lastSeenAt || "")) return String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || ""));















      return String(a.code || "").localeCompare(String(b.code || ""));















    });















  const activeCount = entries.filter((entry) => {
    const latestDate = entry && entry.latestSnapshot && entry.latestSnapshot.date;
    const lastSeenDate = entry && entry.lastSeenAt && shanghaiClockParts(entry.lastSeenAt);
    return String(latestDate || (lastSeenDate && lastSeenDate.date) || "") === today;
  }).length;















  const next = { version: 2, updatedAt: stamp, tradingDate: today, windowDays, entries };















  writeCoreWatchStore(next);















  return { ...next, trackedCount: entries.length, activeCount };















}































function nowIso() {















  return new Date().toISOString();















}































function normalizeTradingDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 8) return "";
  const ymd = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const parsed = new Date(`${ymd}T00:00:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? "" : ymd;
}

function coreWatchConceptTags(entry) {
  const latest = entry && entry.latestSnapshot || {};
  const raw = String(latest.mainConcept || entry && entry.mainConcept || "").trim();
  if (!raw) return [];
  return Array.from(new Set(
    raw
      .split(/[\/｜、,，]/)
      .map((value) => value.replace(/[（(]含.*$/, "").trim())
      .filter((value) => value && value !== "未归类")
      .slice(0, 6),
  ));
}

function loadRetainedCoreWatchSeeds(options = {}) {
  const store = readCoreWatchStore();
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const maxAgeDays = Number.isFinite(Number(options.maxAgeDays)) ? Number(options.maxAgeDays) : 14;
  const maxItems = Number.isFinite(Number(options.maxItems)) ? Number(options.maxItems) : 24;
  const cutoff = nowMs - maxAgeDays * 86400000;
  return (store.entries || [])
    .filter((entry) => {
      const seen = Date.parse(String(entry && entry.lastSeenAt || ""));
      return entry && entry.code && Number.isFinite(seen) && seen >= cutoff;
    })
    .sort((a, b) => {
      const dateDiff = Date.parse(String(b.lastSeenAt || "")) - Date.parse(String(a.lastSeenAt || ""));
      if (dateDiff) return dateDiff;
      const aInitiative = Number(a.latestSnapshot && a.latestSnapshot.initiativeScore || 0);
      const bInitiative = Number(b.latestSnapshot && b.latestSnapshot.initiativeScore || 0);
      return bInitiative - aInitiative;
    })
    .slice(0, maxItems)
    .map((entry) => {
      const latest = entry.latestSnapshot || {};
      const concepts = coreWatchConceptTags(entry);
      return {
        code: String(entry.code),
        secCode: String(entry.code),
        name: String(entry.name || latest.name || ""),
        concepts,
        mainConcept: concepts[0] || String(entry.mainConcept || latest.mainConcept || ""),
        coreWatchRetained: true,
        coreWatchLastSeenAt: entry.lastSeenAt || null,
        coreWatchPriorRole: entry.role || latest.role || null,
        coreWatchPriorScore: Number(entry.score || latest.score || 0),
      };
    });
}

function shanghaiClockParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function marketSnapshotTradingDate(payload) {
  const marketDate = normalizeTradingDate(
    payload && payload.market && payload.market.limitStats && payload.market.limitStats.dates
      ? payload.market.limitStats.dates.today
      : "",
  );
  if (marketDate) return marketDate;
  const capturedAt = payload && (payload.fetchedAt || payload.updatedAt);
  if (!capturedAt) return "";
  const clock = shanghaiClockParts(capturedAt);
  return clock ? clock.date : "";
}

function marketSnapshotKind(payload, tradingDate = marketSnapshotTradingDate(payload)) {
  const declaredKind = String(payload && payload.archiveMeta && payload.archiveMeta.snapshotKind || "").toLowerCase();
  if (declaredKind === "intraday") return "intraday";
  if (!tradingDate) return "unknown";
  const capturedAt = payload && (payload.fetchedAt || payload.updatedAt);
  if (!capturedAt || !Number.isFinite(Date.parse(String(capturedAt)))) {
    return declaredKind === "closing" ? "closing" : "unknown";
  }
  const capturedClock = shanghaiClockParts(capturedAt);
  return capturedClock && (
    tradingDate < capturedClock.date
    || (tradingDate === capturedClock.date && (capturedClock.hour > 15 || (capturedClock.hour === 15 && capturedClock.minute >= 5)))
  ) ? "closing" : "intraday";
}

function createGenerationContext(input = {}) {
  const tradingDate = normalizeTradingDate(input && input.tradingDate) || null;
  const asOf = String(input && input.asOf || nowIso()).trim();
  if (!asOf || !Number.isFinite(Date.parse(asOf))) {
    throw new Error("invalid_generation_as_of");
  }
  const generationId = `${tradingDate || "unknown"}:${asOf}`;
  const declaredGenerationId = String(input && input.generationId || "").trim();
  if (declaredGenerationId && declaredGenerationId !== generationId) {
    throw new Error("generation_context_id_mismatch");
  }
  return Object.freeze({
    version: 1,
    asOf,
    generationId,
    tradingDate,
  });
}

function resolveGenerationContext(payload, suppliedContext = null) {
  const existingContext = payload && payload.generationContext
    && typeof payload.generationContext === "object"
    ? payload.generationContext
    : null;
  const seed = suppliedContext && typeof suppliedContext === "object"
    ? suppliedContext
    : existingContext || {};
  const payloadTradingDate = normalizeTradingDate(marketSnapshotTradingDate(payload));
  const topLevelTradingDate = normalizeTradingDate(payload && payload.tradingDate);
  const tradingDate = normalizeTradingDate(seed.tradingDate)
    || payloadTradingDate
    || topLevelTradingDate
    || null;
  const payloadAsOf = String(payload && (payload.asOf || payload.fetchedAt || payload.updatedAt) || "").trim();
  const payloadGenerationId = String(payload && payload.generationId || "").trim();
  const asOf = String(seed.asOf || payloadAsOf || "").trim() || nowIso();
  const resolved = createGenerationContext({
    tradingDate,
    asOf,
    generationId: seed.generationId || payload && payload.generationId,
  });

  if (payloadTradingDate && resolved.tradingDate !== payloadTradingDate) {
    throw new Error("generation_context_trading_date_mismatch");
  }
  if (suppliedContext && payloadAsOf && resolved.asOf !== payloadAsOf) {
    throw new Error("generation_context_as_of_mismatch");
  }
  if ((suppliedContext || existingContext) && payloadGenerationId && resolved.generationId !== payloadGenerationId) {
    throw new Error("generation_context_payload_id_mismatch");
  }
  if (existingContext && suppliedContext) {
    const existing = createGenerationContext(existingContext);
    if (
      existing.asOf !== resolved.asOf
      || existing.generationId !== resolved.generationId
      || existing.tradingDate !== resolved.tradingDate
    ) throw new Error("generation_context_replacement_rejected");
  }
  if (existingContext && payloadAsOf && resolved.asOf !== payloadAsOf) {
    throw new Error("generation_context_payload_time_mismatch");
  }
  if (
    Object.isFrozen(seed)
    && Number(seed.version || 0) === 1
    && seed.asOf === resolved.asOf
    && seed.generationId === resolved.generationId
    && (seed.tradingDate || null) === resolved.tradingDate
  ) return seed;
  return resolved;
}

function attachGenerationContext(payload, generationContext) {
  if (!payload || typeof payload !== "object") return generationContext;
  payload.generationContext = generationContext;
  payload.asOf = generationContext.asOf;
  payload.generationId = generationContext.generationId;
  if (generationContext.tradingDate) payload.tradingDate = generationContext.tradingDate;
  if (!payload.fetchedAt) payload.fetchedAt = generationContext.asOf;
  if (!payload.updatedAt) payload.updatedAt = generationContext.asOf;
  return generationContext;
}

function strictExactClosingEvidence(payload, expectedDateValue) {
  const expectedDate = normalizeTradingDate(expectedDateValue);
  const fetchLevel = String(payload && payload.fetchStatus && payload.fetchStatus.level || "")
    .trim()
    .toLowerCase();
  const fetchEvidenceQuality = resolveFetchEvidenceQuality(payload, expectedDate);
  const payloadDate = normalizeTradingDate(marketSnapshotTradingDate(payload));
  const archiveDateRaw = String(payload && payload.archiveMeta && payload.archiveMeta.tradingDate || "").trim();
  const archiveDate = normalizeTradingDate(archiveDateRaw);
  const themeDateRaw = String(payload && payload.themeLibrary && payload.themeLibrary.tradingDate || "").trim();
  const themeDate = normalizeTradingDate(themeDateRaw);
  const snapshotKind = marketSnapshotKind(payload, expectedDate);
  const themeSnapshotKind = String(
    payload && payload.themeLibrary && payload.themeLibrary.snapshotKind || "",
  ).trim().toLowerCase();
  const reasons = [];

  if (!payload || typeof payload !== "object") reasons.push("payload_missing");
  if (!expectedDate) reasons.push("expected_date_missing");
  if (!fetchEvidenceQuality.closingEvidenceUsable) {
    reasons.push(...(fetchEvidenceQuality.reasons.length
      ? fetchEvidenceQuality.reasons : ["fetch_evidence_unusable"]));
  }
  if (payload && payload.stale === true) reasons.push("payload_stale");
  if (String(payload && payload.fetchError || "").trim()) reasons.push("fetch_error_present");
  if (!payloadDate || payloadDate !== expectedDate) reasons.push("payload_date_mismatch");
  if (archiveDateRaw && archiveDate !== expectedDate) reasons.push("archive_date_mismatch");
  if (themeDateRaw && themeDate !== expectedDate) reasons.push("theme_date_mismatch");
  if (snapshotKind !== "closing") reasons.push("snapshot_not_closing");
  if (themeSnapshotKind && themeSnapshotKind !== "closing") reasons.push("theme_snapshot_not_closing");
  const canonicalAsOf = String(payload && (payload.fetchedAt || payload.updatedAt) || "").trim();
  const canonicalClock = shanghaiClockParts(canonicalAsOf);
  if (payload && expectedDate && (
    !canonicalAsOf
    || !canonicalClock
    || canonicalClock.date !== expectedDate
    || !exactClosingRawEnvelopeMatches(payload, expectedDate, canonicalAsOf)
  )) reasons.push("raw_generation_envelope_mismatch");

  if (payload && payload.generationContext && typeof payload.generationContext === "object") {
    try {
      const context = createGenerationContext(payload.generationContext);
      const payloadAsOf = String(payload.asOf || payload.fetchedAt || payload.updatedAt || "").trim();
      if (context.tradingDate !== expectedDate) reasons.push("generation_date_mismatch");
      if (payloadAsOf && context.asOf !== payloadAsOf) reasons.push("generation_as_of_mismatch");
    } catch (_) {
      reasons.push("generation_context_invalid");
    }
  }

  return Object.freeze({
    ok: reasons.length === 0,
    expectedDate: expectedDate || null,
    payloadDate: payloadDate || null,
    snapshotKind,
    fetchLevel: fetchLevel || null,
    fetchEvidenceQuality,
    reasons: Object.freeze(reasons),
  });
}

function decisionRankSources(payload) {
  const hotRanks = payload && payload.sources && payload.sources.hotRanks;
  if (!hotRanks || typeof hotRanks !== "object") return [];
  return [hotRanks.eastmoney, hotRanks.ths].filter((row) => row && typeof row === "object");
}

function isExactClosingDecisionPayload(payload, tradingDate = marketSnapshotTradingDate(payload)) {
  const date = normalizeTradingDate(tradingDate);
  if (!payload || !date || !Array.isArray(payload.candidates) || !payload.candidates.length) return false;
  const rankSources = decisionRankSources(payload);
  if (rankSources.length !== 2) return false;
  const ranksMatchClosing = rankSources.every((meta) => (
    normalizeTradingDate(meta.tradingDate) === date
    && normalizeTradingDate(meta.marketDataTradingDate || meta.tradingDate) === date
    && String(meta.snapshotKind || "").toLowerCase() === "closing"
    && meta.complete === true
  ));
  return ranksMatchClosing && marketSnapshotKind(payload, date) === "closing";
}

function crossDateRankObservation(payload, tradingDate = marketSnapshotTradingDate(payload)) {
  const marketDate = normalizeTradingDate(tradingDate);
  if (!marketDate) return null;
  const rankSources = decisionRankSources(payload);
  const futureRows = rankSources.filter((meta) => {
    const rankDate = normalizeTradingDate(meta.tradingDate);
    const marketDataDate = normalizeTradingDate(meta.marketDataTradingDate);
    return rankDate > marketDate
      && marketDataDate === marketDate;
  });
  if (!futureRows.length) return null;
  const tradingDates = futureRows.map((meta) => normalizeTradingDate(meta.tradingDate)).filter(Boolean);
  const observationPhases = Array.from(new Set(futureRows.map((meta) => (
    String(meta.observationPhase || "unknown").trim().toLowerCase() || "unknown"
  )))).sort();
  return {
    kind: "future_rank_observation",
    tradingDate: tradingDates.sort().at(-1) || null,
    marketDataTradingDate: marketDate,
    asOf: String(payload && (payload.fetchedAt || payload.updatedAt) || "").trim() || null,
    observationPhases,
    usedForClosingDecision: false,
    rankSources: payload.sources.hotRanks,
  };
}

// Compatibility name for older callers. Safety is date-based: a next-session
// rank cannot enter the closing decision even if the provider labels it intraday.
function crossDatePreopenObservation(payload, tradingDate = marketSnapshotTradingDate(payload)) {
  return crossDateRankObservation(payload, tradingDate);
}

function compactPreopenCandidates(payload) {
  return (Array.isArray(payload && payload.candidates) ? payload.candidates : [])
    .filter((stock) => stock && (stock.code || stock.secCode))
    .map((stock) => ({
      code: String(stock.code || stock.secCode || ""),
      name: String(stock.name || ""),
      eastRank: Number.isFinite(Number(stock.eastRank)) ? Number(stock.eastRank) : null,
      thsRank: Number.isFinite(Number(stock.thsRank)) ? Number(stock.thsRank) : null,
      combinedRank: Number.isFinite(Number(stock.combinedRank)) ? Number(stock.combinedRank) : null,
      concepts: Array.isArray(stock.concepts) ? stock.concepts.map(String).filter(Boolean).slice(0, 4) : [],
    }))
    .sort((left, right) => {
      const leftRank = left.combinedRank || left.eastRank || left.thsRank || 999;
      const rightRank = right.combinedRank || right.eastRank || right.thsRank || 999;
      return leftRank - rightRank || left.code.localeCompare(right.code);
    })
    .slice(0, 30);
}

function mergePreopenRankCandidates(eastRows, thsRows) {
  const byCode = new Map();
  for (const stock of [...(Array.isArray(eastRows) ? eastRows : []), ...(Array.isArray(thsRows) ? thsRows : [])]) {
    const code = String(stock && (stock.code || stock.secCode) || "");
    if (!code) continue;
    byCode.set(code, { ...(byCode.get(code) || {}), ...stock, code });
  }
  return [...byCode.values()];
}

function resolveCanonicalClosingDecisionBasis(payload, options = {}) {
  const tradingDate = normalizeTradingDate(marketSnapshotTradingDate(payload));
  if (isExactClosingDecisionPayload(payload, tradingDate)) {
    return {
      status: "current_closing",
      usable: true,
      payload,
      basis: {
        tradingDate,
        snapshotKind: "closing",
        asOf: String(payload.fetchedAt || payload.updatedAt || "").trim() || null,
      },
    };
  }

  const observation = crossDateRankObservation(payload, tradingDate);
  if (!observation) {
    return { status: "current_observation", usable: true, payload, basis: null };
  }

  const readClosingArchive = typeof options.readClosingArchive === "function"
    ? options.readClosingArchive
    : (date) => readJsonFile(path.join(runtimeRoot, "data", "history", `${date}.json`));
  const archive = readClosingArchive(tradingDate);
  if (!isExactClosingDecisionPayload(archive, tradingDate)) {
    return {
      status: "unavailable",
      usable: false,
      payload: null,
      reason: "exact_closing_archive_missing",
      observation,
    };
  }

  const closing = JSON.parse(JSON.stringify(archive));
  const basisAsOf = String(closing.asOf || closing.fetchedAt || closing.updatedAt || "").trim() || null;
  const basisGenerationId = String(
    closing.generationId
    || closing.premarketModels && closing.premarketModels.generationId
    || closing.tomorrowDecision && closing.tomorrowDecision.generationId
    || "",
  ).trim() || null;
  closing.decisionBasis = {
    version: 1,
    status: "frozen_closing",
    tradingDate,
    snapshotKind: "closing",
    asOf: basisAsOf,
    generationId: basisGenerationId,
    source: "exact_same_trading_date_closing_archive",
    futureRanksExcluded: true,
    preopenRanksExcluded: true,
  };
  closing.preopenObservation = {
    version: 1,
    status: "observed_separately",
    tradingDate: observation.tradingDate,
    marketDataTradingDate: observation.marketDataTradingDate,
    asOf: observation.asOf,
    observationPhases: observation.observationPhases,
    usedForClosingDecision: false,
    source: observation.rankSources,
    topCandidates: compactPreopenCandidates(payload),
    note: "次日未来榜单只作观察，不改写上一交易日的收盘周期、情绪、题材和选股结论。",
  };
  closing.rankObservation = closing.preopenObservation;
  closing.servedAt = observation.asOf || closing.servedAt || basisAsOf;
  return {
    status: "frozen_closing",
    usable: true,
    payload: closing,
    basis: closing.decisionBasis,
    observation: closing.rankObservation,
  };
}

function failClosedDecisionBasisPayload(payload, resolution) {
  const observation = resolution && resolution.observation || crossDateRankObservation(payload);
  const rankObservation = observation ? {
    version: 1,
    status: "observed_separately",
    tradingDate: observation.tradingDate,
    marketDataTradingDate: observation.marketDataTradingDate,
    asOf: observation.asOf,
    observationPhases: observation.observationPhases,
    usedForClosingDecision: false,
    source: observation.rankSources,
    topCandidates: compactPreopenCandidates(payload),
    note: "未来榜单已收到，但因收盘基准缺失，本轮不生成交易结论。",
  } : null;
  return {
    ...payload,
    candidates: [],
    selected: [],
    rejected: [],
    hotConcepts: [],
    topicBoard: { version: 1, items: [], mainLine: null },
    leadershipBoard: null,
    bestPicks: {
      executionVersion: 3,
      available: false,
      tradeDisabled: true,
      picks: [],
      watchlist: [],
      scenarioPlans: [],
      note: "缺少同交易日精确收盘归档，已阻止未来榜单与昨日价格混算。",
    },
    decisionBasis: {
      version: 1,
      status: "unavailable",
      tradingDate: observation && observation.marketDataTradingDate || marketSnapshotTradingDate(payload) || null,
      snapshotKind: null,
      asOf: null,
      source: "exact_same_trading_date_closing_archive_missing",
      futureRanksExcluded: true,
      preopenRanksExcluded: true,
    },
    rankObservation,
    preopenObservation: rankObservation,
    fetchStatus: {
      level: "fail",
      label: "缺少同交易日精确收盘归档，未来榜单观察不能替代收盘决策。",
      items: [],
      unclassified: 0,
    },
  };
}

const CYCLE_HISTORY_SCHEMA_VERSION = 2;
const CYCLE_HISTORY_AUTHORITY = "local_observation_cycle_v2";

function cycleGenerationContextOf(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const nested = source.generationContext && typeof source.generationContext === "object"
    ? source.generationContext
    : {};
  const tradingDate = normalizeThemeLibraryDate(
    nested.tradingDate
      || source.tradingDate
      || source.market && source.market.limitStats && source.market.limitStats.dates
        && source.market.limitStats.dates.today,
  );
  const generationId = String(nested.generationId || source.generationId || "").trim();
  const asOf = String(nested.asOf || source.asOf || source.fetchedAt || source.updatedAt || "").trim();
  return { tradingDate, generationId, asOf };
}

function inspectCycleHistorySnapshot(payload, expectedDate = "") {
  const reasons = [];
  const source = payload && typeof payload === "object" ? payload : {};
  const expected = normalizeThemeLibraryDate(expectedDate);
  const context = cycleGenerationContextOf(source);
  const state = source.market && source.market.state && typeof source.market.state === "object"
    ? source.market.state
    : null;
  const resolution = state && state.structuralResolution && typeof state.structuralResolution === "object"
    ? state.structuralResolution
    : null;
  const indexEnvironment = resolution && resolution.indexEnvironment
    && typeof resolution.indexEnvironment === "object"
    ? resolution.indexEnvironment
    : state && state.indexEnvironment && typeof state.indexEnvironment === "object"
      ? state.indexEnvironment
      : null;
  const limitDate = normalizeThemeLibraryDate(
    source.market && source.market.limitStats && source.market.limitStats.dates
      && source.market.limitStats.dates.today,
  );
  const emotionEffectContext = state && state.emotionEffectContext
    && typeof state.emotionEffectContext === "object" ? state.emotionEffectContext : null;
  const emotionBigCycleWindow = state && state.emotionBigCycleWindow
    && typeof state.emotionBigCycleWindow === "object" ? state.emotionBigCycleWindow : null;
  const emotionWindowGeneration = cycleGenerationContextOf(emotionBigCycleWindow || {});

  if (Number(source.schemaVersion) !== CYCLE_HISTORY_SCHEMA_VERSION) reasons.push("schema_version_mismatch");
  if (source.authority !== CYCLE_HISTORY_AUTHORITY) reasons.push("authority_mismatch");
  if (source.executionAuthority !== false) reasons.push("execution_authority_must_be_false");
  if (source.snapshotKind !== "closing") reasons.push("snapshot_not_closing");
  if (Number(source.engineVersion) !== MARKET_CYCLE_ENGINE_VERSION) reasons.push("engine_version_mismatch");
  if (Number(source.indexCycleRegimeVersion) !== INDEX_CYCLE_REGIME_VERSION) reasons.push("index_regime_version_mismatch");
  if (!context.tradingDate || expected && context.tradingDate !== expected) reasons.push("trading_date_mismatch");
  if (!context.generationId) reasons.push("generation_id_missing");
  if (!context.asOf || !Number.isFinite(Date.parse(context.asOf))) reasons.push("as_of_invalid");
  if (limitDate !== context.tradingDate) reasons.push("provider_trading_date_mismatch");
  if (!source.market || !source.market.snapshot || typeof source.market.snapshot !== "object") reasons.push("market_snapshot_missing");
  if (!state) reasons.push("market_state_missing");
  if (!normalizeBigCycle(state && (state.structuralCycle || state.cycle))) reasons.push("structural_cycle_invalid");
  if (!state || !state.dailyState || typeof state.dailyState !== "object") reasons.push("daily_state_missing");
  if (!resolution) reasons.push("structural_resolution_missing");
  if (resolution && Number(resolution.engineVersion || resolution.version) !== MARKET_CYCLE_ENGINE_VERSION) {
    reasons.push("structural_resolution_version_mismatch");
  }
  if (!indexEnvironment) reasons.push("index_environment_missing");
  if (!emotionEffectContext) reasons.push("emotion_effect_context_missing");
  if (!emotionBigCycleWindow) reasons.push("emotion_big_cycle_window_missing");
  if (emotionBigCycleWindow && (
    Number(emotionBigCycleWindow.version) !== EMOTION_BIG_CYCLE_WINDOW_VERSION
    || emotionBigCycleWindow.method !== EMOTION_BIG_CYCLE_WINDOW_METHOD
    || Number(emotionBigCycleWindow.windowDays) !== EMOTION_BIG_CYCLE_WINDOW_DAYS
  )) reasons.push("emotion_big_cycle_window_version_mismatch");
  if (emotionBigCycleWindow && normalizeCycleYmd(emotionBigCycleWindow.tradingDate) !== context.tradingDate) {
    reasons.push("emotion_big_cycle_window_trading_date_mismatch");
  }
  if (emotionBigCycleWindow && (
    emotionWindowGeneration.generationId !== context.generationId
    || emotionWindowGeneration.asOf !== context.asOf
  )) reasons.push("emotion_big_cycle_window_generation_mismatch");

  return {
    ok: reasons.length === 0,
    reasons,
    context,
    state,
    resolution,
    indexEnvironment,
  };
}

function buildCycleHistorySnapshot(payload, generationContext = null) {
  if (!payload || typeof payload !== "object") return null;
  let context;
  try {
    context = resolveGenerationContext(payload, generationContext);
  } catch {
    return null;
  }
  const tradingDate = normalizeThemeLibraryDate(context.tradingDate);
  const market = payload.market && typeof payload.market === "object" ? payload.market : {};
  const state = market.state && typeof market.state === "object" ? market.state : {};
  const sourceResolution = state.structuralResolution && typeof state.structuralResolution === "object"
    ? state.structuralResolution
    : {};
  const sourceRegime = payload.premarketModels && payload.premarketModels.indexCycleRegime
    && typeof payload.premarketModels.indexCycleRegime === "object"
    ? payload.premarketModels.indexCycleRegime
    : {};
  const sourceIndexEnvironment = sourceResolution.indexEnvironment
    && typeof sourceResolution.indexEnvironment === "object"
    ? sourceResolution.indexEnvironment
    : state.indexEnvironment && typeof state.indexEnvironment === "object"
      ? state.indexEnvironment
      : sourceRegime;
  const indexEnvironment = sourceIndexEnvironment && Object.keys(sourceIndexEnvironment).length
    ? { ...sourceIndexEnvironment, generationContext: { ...context } }
    : null;
  const structuralCycle = normalizeBigCycle(state.structuralCycle || sourceResolution.structuralCycle || state.cycle);
  const snapshotKind = marketSnapshotKind(payload, tradingDate);
  if (!tradingDate || snapshotKind !== "closing" || !structuralCycle || !indexEnvironment) return null;

  return {
    schemaVersion: CYCLE_HISTORY_SCHEMA_VERSION,
    authority: CYCLE_HISTORY_AUTHORITY,
    executionAuthority: false,
    tradingDate,
    generationId: context.generationId,
    asOf: context.asOf,
    generationContext: { ...context },
    snapshotKind,
    engineVersion: MARKET_CYCLE_ENGINE_VERSION,
    indexCycleRegimeVersion: INDEX_CYCLE_REGIME_VERSION,
    market: {
      snapshot: market.snapshot && typeof market.snapshot === "object" ? market.snapshot : {},
      limitStats: market.limitStats && typeof market.limitStats === "object" ? market.limitStats : {},
      state: {
        structuralCycle,
        cycle: structuralCycle,
        dailyState: state.dailyState && typeof state.dailyState === "object"
          ? { ...state.dailyState, generationContext: { ...context } }
          : null,
        profitEffect: state.profitEffect && typeof state.profitEffect === "object" ? state.profitEffect : null,
        lossEffect: state.lossEffect && typeof state.lossEffect === "object" ? state.lossEffect : null,
        emotionEffectContext: state.emotionEffectContext && typeof state.emotionEffectContext === "object"
          ? state.emotionEffectContext : null,
        emotionBigCycleWindow: state.emotionBigCycleWindow && typeof state.emotionBigCycleWindow === "object"
          ? state.emotionBigCycleWindow : null,
        indexEnvironment,
        structuralResolution: {
          ...sourceResolution,
          version: MARKET_CYCLE_ENGINE_VERSION,
          engineVersion: MARKET_CYCLE_ENGINE_VERSION,
          structuralCycle,
          cycle: structuralCycle,
          generationContext: { ...context },
          indexEnvironment,
        },
      },
    },
    premarketModels: {
      indexCycleRegime: {
        ...sourceRegime,
        version: INDEX_CYCLE_REGIME_VERSION,
        generationContext: { ...context },
      },
    },
    topicBoard: payload.topicBoard && payload.topicBoard.mainLine
      ? { mainLine: payload.topicBoard.mainLine }
      : null,
    persistence: {
      purpose: "跨交易日周期识别，不承载选股、仓位或交易授权",
      formalDecisionArchive: false,
    },
  };
}

function persistCycleHistorySnapshot(payload, options = {}) {
  const tradingDate = normalizeThemeLibraryDate(
    payload && payload.market && payload.market.limitStats && payload.market.limitStats.dates
      && payload.market.limitStats.dates.today,
  );
  const snapshotKind = tradingDate ? marketSnapshotKind(payload, tradingDate) : "unknown";
  if (snapshotKind !== "closing") {
    return { ok: true, required: false, skipped: true, reason: "cycle-history-closing-only", tradingDate, snapshotKind };
  }
  const snapshot = buildCycleHistorySnapshot(payload, options.generationContext || null);
  if (!snapshot) {
    const state = payload && payload.market && payload.market.state && typeof payload.market.state === "object"
      ? payload.market.state : {};
    const resolution = state.structuralResolution && typeof state.structuralResolution === "object"
      ? state.structuralResolution : {};
    const sourceRegime = payload && payload.premarketModels && payload.premarketModels.indexCycleRegime;
    const blockers = [];
    if (!normalizeBigCycle(state.structuralCycle || resolution.structuralCycle || state.cycle)) {
      blockers.push("structural_cycle_invalid");
    }
    if (!(resolution.indexEnvironment || state.indexEnvironment || sourceRegime)) {
      blockers.push("index_environment_missing");
    }
    return {
      ok: false,
      required: true,
      skipped: true,
      reason: "cycle-snapshot-build-failed",
      tradingDate,
      snapshotKind,
      blockers: blockers.length ? blockers : ["cycle_snapshot_build_failed"],
    };
  }
  const inspection = inspectCycleHistorySnapshot(snapshot, tradingDate);
  if (!snapshot || !inspection.ok) {
    return {
      ok: false,
      required: true,
      skipped: true,
      reason: "cycle-history-invalid",
      tradingDate,
      snapshotKind,
      blockers: inspection.reasons,
    };
  }

  const historyDir = options.historyDir || cycleHistoryDir;
  const revisionDir = options.revisionDir || path.join(cycleHistoryRevisionDir, tradingDate);
  const filePath = path.join(historyDir, `${tradingDate}.json`);
  const existing = readJsonFile(filePath);
  const existingInspection = inspectCycleHistorySnapshot(existing, tradingDate);
  if (existingInspection.ok) {
    const existingTime = Date.parse(existingInspection.context.asOf);
    const candidateTime = Date.parse(inspection.context.asOf);
    if (existingTime > candidateTime) {
      return {
        ok: false,
        required: true,
        skipped: true,
        reason: "newer-cycle-history-exists",
        tradingDate,
        snapshotKind,
        storedGenerationId: existingInspection.context.generationId,
        candidateGenerationId: inspection.context.generationId,
      };
    }
    if (existingInspection.context.generationId === inspection.context.generationId) {
      return {
        ok: true,
        required: true,
        skipped: true,
        reason: "same-cycle-generation-exists",
        tradingDate,
        snapshotKind,
        generationId: inspection.context.generationId,
        filePath,
      };
    }
  }

  const written = writeRetainedJson(filePath, snapshot, { archiveDir: revisionDir });
  if (!written) {
    return { ok: false, required: true, skipped: false, reason: "cycle-history-write-failed", tradingDate, snapshotKind };
  }
  const reloaded = readJsonFile(filePath);
  const reloadedInspection = inspectCycleHistorySnapshot(reloaded, tradingDate);
  const sameGeneration = reloadedInspection.ok
    && reloadedInspection.context.generationId === inspection.context.generationId
    && reloadedInspection.context.asOf === inspection.context.asOf;
  if (!sameGeneration) {
    return {
      ok: false,
      required: true,
      skipped: false,
      reason: "cycle-history-readback-mismatch",
      tradingDate,
      snapshotKind,
      blockers: reloadedInspection.reasons,
    };
  }
  return {
    ok: true,
    required: true,
    skipped: false,
    tradingDate,
    snapshotKind,
    generationId: inspection.context.generationId,
    filePath,
  };
}

function markCycleHistoryUnavailable(payload, result) {
  if (!payload || typeof payload !== "object") return payload;
  const blockers = Array.isArray(result && result.blockers)
    ? result.blockers.filter(Boolean) : [];
  const reason = String(result && result.reason || "cycle-history-unavailable");
  payload.executionAuthority = false;
  payload.cycleHistoryAvailability = {
    status: "unavailable",
    observationOnly: true,
    executionAuthority: false,
    tradingDate: result && result.tradingDate || marketSnapshotTradingDate(payload) || null,
    reason,
    blockers,
    note: "当日行情已保留，但跨日情绪大周期证据未通过；当前结果仅供观察，不授予交易权限。",
  };
  const currentFetchStatus = payload.fetchStatus && typeof payload.fetchStatus === "object"
    ? payload.fetchStatus : {};
  const currentItems = Array.isArray(currentFetchStatus.items) ? currentFetchStatus.items : [];
  payload.fetchStatus = {
    ...currentFetchStatus,
    level: currentFetchStatus.level === "fail" ? "fail" : "partial",
    operationalLevel: currentFetchStatus.operationalLevel === "fail" ? "fail" : "degraded",
    evidenceStatus: "incomplete",
    items: currentItems.concat({
      name: "情绪大周期历史",
      ok: false,
      note: `当日行情已更新；周期历史未通过：${reason}${blockers.length ? ` (${blockers.join(",")})` : ""}`,
      statusKey: "cycle_history_unavailable",
      blockers,
    }),
  };
  return payload;
}

function loadCycleHistorySnapshot(tradingDate, options = {}) {
  const expectedDate = normalizeThemeLibraryDate(tradingDate);
  if (!expectedDate) return null;
  const historyDir = options.historyDir || cycleHistoryDir;
  const filePath = path.join(historyDir, `${expectedDate}.json`);
  const payload = readJsonFile(filePath);
  const inspection = inspectCycleHistorySnapshot(payload, expectedDate);
  if (!inspection.ok) return null;
  return { date: expectedDate, payload, fresh: true, inspection, filePath };
}

function loadEmotionBigCycleWindowRecords(payload, currentTradingDate, options = {}) {
  const currentDate = normalizeCycleYmd(currentTradingDate);
  const historyDir = options.historyDir || path.join(runtimeRoot, "data", "history");
  if (!payload || !currentDate) return [];
  const descending = [{ date: currentDate, payload, source: "current-generation" }];
  let cursor = payload;
  for (let index = 0; index < EMOTION_BIG_CYCLE_WINDOW_DAYS; index += 1) {
    const previousDate = normalizeCycleYmd(
      cursor && cursor.market && cursor.market.limitStats && cursor.market.limitStats.dates
        && cursor.market.limitStats.dates.prev,
    );
    if (!previousDate || !fs.existsSync(historyDir)) break;
    const previousPayload = readJsonFile(path.join(historyDir, `${previousDate}.json`));
    if (!previousPayload) break;
    descending.push({
      date: previousDate,
      payload: previousPayload,
      source: "formal-closing-archive",
    });
    cursor = previousPayload;
  }
  return descending.reverse();
}

function emotionBigCycleCoreContinuity(payload) {
  const state = payload && payload.market && payload.market.state;
  const leadership = state && state.profitEffect && state.profitEffect.components
    && state.profitEffect.components.leadership;
  const direct = Number(leadership && leadership.score);
  if (Number.isFinite(direct) && direct >= 0 && direct <= 100) {
    return { score: direct, source: "market.state.profitEffect.components.leadership.score" };
  }
  const support = Number(payload && payload.emotionCycle && payload.emotionCycle.metrics
    && payload.emotionCycle.metrics.support && payload.emotionCycle.metrics.support.score);
  if (Number.isFinite(support) && support >= 0 && support <= 100) {
    return { score: support, source: "emotionCycle.metrics.support.score" };
  }
  return { score: null, source: "unavailable" };
}

function buildEmotionBigCycleWindowForPayload(payload, options = {}) {
  const currentDate = normalizeCycleYmd(
    options.tradingDate
    || payload && payload.tradingDate
    || marketSnapshotTradingDate(payload),
  );
  const generationContext = (() => {
    try { return resolveGenerationContext(payload, options.generationContext || null); } catch { return null; }
  })();
  const historyDir = options.historyDir || path.join(runtimeRoot, "data", "history");
  const records = loadEmotionBigCycleWindowRecords(payload, currentDate, { historyDir });
  const inspectClosingEvidence = typeof options.inspectClosingEvidence === "function"
    ? options.inspectClosingEvidence : strictExactClosingEvidence;
  const observations = [];
  const lineage = [];
  for (let index = 1; index < records.length; index += 1) {
    const previous = records[index - 1];
    const current = records[index];
    const currentEvidence = inspectClosingEvidence(current.payload, current.date);
    const previousEvidence = inspectClosingEvidence(previous.payload, previous.date);
    const declaredPreviousDate = normalizeCycleYmd(
      current.payload && current.payload.market && current.payload.market.limitStats
        && current.payload.market.limitStats.dates && current.payload.market.limitStats.dates.prev,
    );
    const dateAligned = Boolean(
      current.date
      && previous.date
      && declaredPreviousDate === previous.date
      && currentEvidence.ok
      && previousEvidence.ok
    );
    const effect = buildEmotionEffectContext({
      snapshot: current.payload && current.payload.market && current.payload.market.snapshot,
      limitStats: current.payload && current.payload.market && current.payload.market.limitStats,
      previousSnapshot: previous.payload && previous.payload.market && previous.payload.market.snapshot,
      previousLimit: previous.payload && previous.payload.market && previous.payload.market.limitStats,
    });
    const core = emotionBigCycleCoreContinuity(current.payload);
    const effectDate = normalizeCycleYmd(effect && effect.tradingDate);
    const effectPreviousDate = normalizeCycleYmd(effect && effect.previousTradingDate);
    const complete = Boolean(
      dateAligned
      && effect && effect.status === "ready"
      && effectDate === current.date
      && effectPreviousDate === previous.date
      && Number.isFinite(Number(effect.profit && effect.profit.score))
      && Number.isFinite(Number(effect.loss && effect.loss.score))
      && Number.isFinite(Number(core.score))
    );
    observations.push({
      tradingDate: current.date,
      profitScore: effect && effect.profit && effect.profit.score,
      lossScore: effect && effect.loss && effect.loss.score,
      coreContinuityScore: core.score,
      complete,
    });
    const context = cycleGenerationContextOf(current.payload);
    lineage.push({
      tradingDate: current.date || null,
      previousTradingDate: previous.date || null,
      generationId: context.generationId || null,
      asOf: context.asOf || null,
      source: current.source,
      exactClosing: currentEvidence.ok === true,
      exactPreviousClosing: previousEvidence.ok === true,
      dateAligned,
      effectStatus: effect && effect.status || "unavailable",
      effectVersion: effect && effect.version || null,
      coreContinuitySource: core.source,
      complete,
    });
  }
  const classified = buildEmotionBigCycleWindow(observations);
  return {
    ...classified,
    version: EMOTION_BIG_CYCLE_WINDOW_VERSION,
    method: EMOTION_BIG_CYCLE_WINDOW_METHOD,
    horizon: "rolling_5_trading_days",
    authoritativeInput: "exact_closing_whole_market_effect_plus_core_continuity",
    generationContext: generationContext ? { ...generationContext } : null,
    tradingDate: currentDate || null,
    lineage,
  };
}

function hydrateEmotionCyclePersistenceEvidence(payload, options = {}) {
  const source = payload && typeof payload === "object" ? payload : null;
  const market = source && source.market && typeof source.market === "object" ? source.market : null;
  const state = market && market.state && typeof market.state === "object" ? market.state : null;
  const snapshot = market && market.snapshot && typeof market.snapshot === "object" ? market.snapshot : null;
  const limitStats = market && market.limitStats && typeof market.limitStats === "object" ? market.limitStats : null;
  if (!source || !state || !snapshot || !limitStats) {
    return { ok: false, reason: "emotion_cycle_market_context_missing" };
  }

  let generationContext;
  try {
    generationContext = resolveGenerationContext(source, options.generationContext || null);
  } catch (error) {
    return { ok: false, reason: "emotion_cycle_generation_invalid", error: error.message };
  }
  const previousPayload = Object.prototype.hasOwnProperty.call(options, "previousPayload")
    ? options.previousPayload
    : loadExactPreviousDecisionPayload(source);
  const previousMarket = previousPayload && previousPayload.market && typeof previousPayload.market === "object"
    ? previousPayload.market : null;
  const previousSnapshot = previousMarket && previousMarket.snapshot && typeof previousMarket.snapshot === "object"
    ? previousMarket.snapshot : null;
  const previousLimit = previousMarket && previousMarket.limitStats && typeof previousMarket.limitStats === "object"
    ? previousMarket.limitStats : null;

  const expectedPreviousTradingDate = limitStats.dates && limitStats.dates.verified === true
    ? normalizeCycleYmd(limitStats.dates.prev) : "";
  const retainedEffect = state.emotionEffectContext && typeof state.emotionEffectContext === "object"
    ? state.emotionEffectContext : null;
  const retainedEffectAligned = Boolean(
    retainedEffect
    && retainedEffect.status === "ready"
    && normalizeCycleYmd(retainedEffect.tradingDate) === generationContext.tradingDate
    && (!expectedPreviousTradingDate
      || normalizeCycleYmd(retainedEffect.previousTradingDate) === expectedPreviousTradingDate),
  );
  const effectContext = retainedEffectAligned ? retainedEffect : buildEmotionEffectContext({
    snapshot,
    limitStats,
    previousSnapshot,
    previousLimit,
  });
  state.emotionEffectContext = effectContext;

  const retainedWindow = state.emotionBigCycleWindow && typeof state.emotionBigCycleWindow === "object"
    ? state.emotionBigCycleWindow : null;
  const retainedWindowContext = cycleGenerationContextOf(retainedWindow || {});
  const retainedWindowAligned = Boolean(
    retainedWindow
    && Number(retainedWindow.version) === EMOTION_BIG_CYCLE_WINDOW_VERSION
    && retainedWindow.method === EMOTION_BIG_CYCLE_WINDOW_METHOD
    && normalizeCycleYmd(retainedWindow.tradingDate) === generationContext.tradingDate
    && retainedWindowContext.generationId === generationContext.generationId
    && retainedWindowContext.asOf === generationContext.asOf,
  );
  state.emotionBigCycleWindow = retainedWindowAligned ? retainedWindow : buildEmotionBigCycleWindowForPayload(source, {
    generationContext,
    ...(options.historyDir ? { historyDir: options.historyDir } : {}),
  });

  const windowContext = cycleGenerationContextOf(state.emotionBigCycleWindow || {});
  const effectReady = effectContext && effectContext.status === "ready"
    && normalizeCycleYmd(effectContext.tradingDate) === generationContext.tradingDate;
  const windowAligned = Boolean(
    state.emotionBigCycleWindow
    && normalizeCycleYmd(state.emotionBigCycleWindow.tradingDate) === generationContext.tradingDate
    && windowContext.generationId === generationContext.generationId
    && windowContext.asOf === generationContext.asOf,
  );
  return {
    ok: Boolean(effectReady && windowAligned),
    reason: effectReady ? (windowAligned ? "ready" : "emotion_big_cycle_window_misaligned") : "emotion_effect_context_incomplete",
    generationContext,
    effectStatus: effectContext && effectContext.status || "unavailable",
    windowStatus: state.emotionBigCycleWindow && state.emotionBigCycleWindow.status || "unavailable",
  };
}

function indexEnvironmentGenerationAligned(candidate, envelope, expectedDate, version) {
  if (!candidate || typeof candidate !== "object") return false;
  if (Number(version) !== INDEX_CYCLE_REGIME_VERSION && Number(version) !== MARKET_CYCLE_ENGINE_VERSION) return false;
  const expected = cycleGenerationContextOf(envelope);
  const actual = cycleGenerationContextOf(candidate);
  if (!expected.tradingDate || expected.tradingDate !== normalizeThemeLibraryDate(expectedDate)) return false;
  if (!actual.tradingDate || actual.tradingDate !== expected.tradingDate) return false;
  if (!actual.generationId || actual.generationId !== expected.generationId) return false;
  if (!actual.asOf || actual.asOf !== expected.asOf) return false;
  return Boolean(candidate.mediumTerm && candidate.shortTerm);
}

function selectPreviousIndexEnvironment(cyclePayload, formalPayload, expectedDate) {
  const cycleInspection = inspectCycleHistorySnapshot(cyclePayload, expectedDate);
  if (cycleInspection.ok) return cycleInspection.indexEnvironment;

  const formal = formalPayload && typeof formalPayload === "object" ? formalPayload : {};
  const regime = formal.premarketModels && formal.premarketModels.indexCycleRegime;
  if (indexEnvironmentGenerationAligned(regime, formal, expectedDate, regime && regime.version)) return regime;

  const resolution = formal.market && formal.market.state && formal.market.state.structuralResolution;
  const environment = resolution && resolution.indexEnvironment;
  if (indexEnvironmentGenerationAligned(
    environment,
    formal,
    expectedDate,
    resolution && (resolution.engineVersion || resolution.version),
  )) return environment;
  return null;
}

function autoArchiveMarketSnapshot(payload, options = {}) {
  if (!payload || typeof payload !== "object") return { ok: false, skipped: true, reason: "empty-payload" };
  const tradingDate = normalizeThemeLibraryDate(
    payload && payload.market && payload.market.limitStats && payload.market.limitStats.dates
      && payload.market.limitStats.dates.today,
  );
  if (!tradingDate) return { ok: false, skipped: true, reason: "missing-provider-trading-date" };

  let generationContext;
  try {
    generationContext = resolveGenerationContext(payload, options.generationContext || null);
    attachGenerationContext(payload, generationContext);
  } catch (error) {
    return { ok: false, skipped: true, reason: "invalid-generation-context", error: error.message };
  }
  const capturedAt = generationContext.asOf;
  const snapshotKind = marketSnapshotKind(
    payload.fetchedAt || payload.updatedAt ? payload : { ...payload, fetchedAt: capturedAt },
    tradingDate,
  );
  const trigger = options.trigger || "successful-fetch";
  const productionReceiptTriggers = new Set([
    "successful-fetch",
    "manual-button",
    "server-startup",
    "event-timeline-refresh",
  ]);
  const decisionReceiptRequired = options.requireCanonicalDecisionReceipt === true
    || (options.requireCanonicalDecisionReceipt !== false
      && snapshotKind === "closing"
      && productionReceiptTriggers.has(trigger));
  const historyDir = path.join(runtimeRoot, "data", "history");
  const reportDir = path.join(runtimeRoot, "data", "reports");
  const snapshotFile = path.join(historyDir, `${tradingDate}.json`);
  const existing = readJsonFile(snapshotFile);
  const existingAt = existing && (existing.fetchedAt || existing.updatedAt);
  const existingTime = Date.parse(existingAt || "");
  const candidateTime = Date.parse(capturedAt);
  const existingKind = existing ? marketSnapshotKind(existing, tradingDate) : null;
  const candidateClock = shanghaiClockParts(capturedAt);
  if (existingKind === "closing" && snapshotKind !== "closing") {
    return { ok: true, skipped: true, reason: "closing-snapshot-already-exists", tradingDate, snapshotKind };
  }
  if (
    options.force !== true
    && existingKind === "closing"
    && snapshotKind === "closing"
    && candidateClock
    && candidateClock.date > tradingDate
  ) {
    return { ok: true, skipped: true, reason: "historical-closing-snapshot-frozen", tradingDate, snapshotKind };
  }
  if (Number.isFinite(existingTime) && Number.isFinite(candidateTime) && existingTime >= candidateTime) {
    return { ok: true, skipped: true, reason: "same-or-newer-snapshot-exists", tradingDate, snapshotKind };
  }

  try {
    const { archive } = require("./archiver");
    const themeLibrarySnapshot = themeLibrarySnapshotFromPayload(payload, "archive-captured", {
      generationContext,
    });
    const archivePayloadBase = {
      ...payload,
      generationContext,
      ...(themeLibrarySnapshot ? {
        themeLibrary: { ...themeLibrarySnapshot, generationContext, tradingDate, snapshotKind },
      } : {}),
      archiveMeta: {
        ...(payload.archiveMeta || {}),
        mode: options.mode || "auto",
        trigger,
        tradingDate,
        snapshotKind,
        asOf: generationContext.asOf,
        generationId: generationContext.generationId,
        generationContext,
        archivedAt: nowIso(),
        decisionReceiptRequired,
      },
    };
    let receiptLineage = null;
    if (existing && existing.decisionReceipt) {
      const existingReceiptInspection = validateDecisionReceipt(existing.decisionReceipt, {
        sourcePayload: existing,
        snapshotKind: existing.archiveMeta && existing.archiveMeta.snapshotKind,
      });
      if (existingReceiptInspection.liveCanonical) {
        receiptLineage = {
          supersedesReceiptId: existing.decisionReceipt.receiptId,
          supersedeReason: String(
            options.supersedeReason
            || `同一交易日更晚的收盘代次替换(${trigger})`,
          ),
        };
      }
    }
    const decisionReceipt = buildDecisionReceipt(archivePayloadBase, {
      snapshotKind,
      lineage: receiptLineage,
    });
    const receiptInspection = validateDecisionReceipt(decisionReceipt, {
      sourcePayload: archivePayloadBase,
      snapshotKind,
    });
    if (decisionReceiptRequired && !receiptInspection.liveCanonical) {
      return {
        ok: false,
        skipped: true,
        reason: "canonical-decision-receipt-unavailable",
        tradingDate,
        snapshotKind,
        receiptStatus: decisionReceipt.status,
        blockers: receiptInspection.reasons.length
          ? receiptInspection.reasons
          : decisionReceipt.integrity && decisionReceipt.integrity.blockers || [],
      };
    }
    const archivePayload = { ...archivePayloadBase, decisionReceipt };
    const result = archive(archivePayload, tradingDate, { hist: historyDir, report: reportDir });
    let outcomeSettlement = null;
    if (snapshotKind === "closing" && options.settlePreviousDecision !== false) {
      try {
        const { settleExactPreviousDecision } = require("./quant-decision/decision-ledger");
        outcomeSettlement = settleExactPreviousDecision(archivePayload, { runtimeRoot, historyDir });
      } catch (settlementError) {
        outcomeSettlement = {
          ok: false,
          skipped: false,
          reason: "decision-outcome-settlement-failed",
          error: String(settlementError && settlementError.message || settlementError),
        };
        console.error(`[decision-outcome] ${tradingDate} settlement failed: ${outcomeSettlement.error}`);
      }
    }
    console.log(`[market-archive] ${tradingDate} ${snapshotKind} saved (${trigger}; receipt=${decisionReceipt.status})`);
    return {
      ok: true,
      skipped: false,
      tradingDate,
      snapshotKind,
      receiptId: decisionReceipt.receiptId,
      receiptStatus: decisionReceipt.status,
      canonicalDecisionReceipt: decisionReceipt.status === LIVE_CANONICAL_STATUS,
      outcomeSettlement,
      summary: result.summary,
    };
  } catch (error) {
    console.error(`[market-archive] ${tradingDate} save failed: ${error.message}`);
    return { ok: false, skipped: false, tradingDate, snapshotKind, error: error.message };
  }
}

let themeLibraryCatalogCache = { signature: "", records: [] };
const themeLibraryFileRecordCache = new Map();

function themeLibrarySnapshotFromPayload(payload, sourceMode = "legacy-derived", options = {}) {
  if (!payload || typeof payload !== "object") return null;
  const hasGenerationContext = Boolean(
    options.generationContext
    || payload.generationContext && typeof payload.generationContext === "object",
  );
  const generationContext = hasGenerationContext
    ? resolveGenerationContext(payload, options.generationContext || null)
    : null;
  const tradingDate = generationContext && generationContext.tradingDate || themeLibraryTradingDate(payload);
  const saved = payload.themeLibrary;
  const savedHasCycleLeadership = Boolean(
    saved
    && Array.isArray(saved.themes)
    && saved.themes.every((theme) => theme && theme.cycleLeadership && typeof theme.cycleLeadership === "object"),
  );
  const savedHasRoleEvidence = Boolean(
    saved
    && Array.isArray(saved.themes)
    && saved.themes.every((theme) => {
      const cards = Array.isArray(theme && theme.roleEvidenceCards) ? theme.roleEvidenceCards : [];
      if (cards.length !== 2) return false;
      const byKey = new Map(cards.map((card) => [String(card && card.roleKey || ""), card]));
      return ["cycleLeader", "dailyLeader"].every((key) => {
        const card = byKey.get(key);
        return card
          && typeof card.source === "string"
          && card.source.trim().length > 0
          && normalizeThemeLibraryDate(card.tradingDate) === tradingDate
          && Array.isArray(card.evidence)
          && card.evidence.length > 0
          && card.evidence.every((row) => (
            row
            && typeof row.key === "string"
            && row.key.trim().length > 0
            && typeof row.source === "string"
            && row.source.trim().length > 0
            && normalizeThemeLibraryDate(row.tradingDate) === tradingDate
          ))
          && Array.isArray(card.gaps)
          && card.sourceMode === saved.sourceMode
          && card.classifierVersion === THEME_LIBRARY_CLASSIFIER_VERSION
          && card.executionEligible === false;
      });
    }),
  );
  const savedHasRoleAuthority = Boolean(
    saved
    && Array.isArray(saved.themes)
    && saved.themes.every((theme) => {
      const authorityByCode = theme && theme.roleAuthorityByCode;
      if (!authorityByCode || typeof authorityByCode !== "object" || Array.isArray(authorityByCode)) return false;
      const identities = theme && theme.cycleLeadership && theme.cycleLeadership.identities;
      return Object.keys(identities && typeof identities === "object" ? identities : {}).every((code) => {
        const authority = authorityByCode[code];
        return authority
          && typeof authority.executionEligible === "boolean"
          && typeof authority.cycleLeader === "boolean"
          && typeof authority.source === "string"
          && authority.source.trim().length > 0
          && normalizeThemeLibraryDate(authority.tradingDate) === tradingDate;
      });
    }),
  );
  const savedGeneratedAt = String(saved && saved.generatedAt || "").trim();
  const derivedGenerationId = themeLibraryGenerationId(tradingDate, savedGeneratedAt);
  const savedMatchesGeneration = !generationContext || Boolean(
    savedGeneratedAt === generationContext.asOf
    && derivedGenerationId === generationContext.generationId
    && normalizeThemeLibraryDate(saved && saved.tradingDate) === generationContext.tradingDate,
  );
  if (
    options.forceRebuild !== true
    && saved
    && Number(saved.schemaVersion || 0) >= 1
    && saved.classifierVersion === THEME_LIBRARY_CLASSIFIER_VERSION
    && savedHasCycleLeadership
    && savedHasRoleEvidence
    && savedHasRoleAuthority
    && Array.isArray(saved.themes)
    && normalizeThemeLibraryDate(saved.tradingDate) === tradingDate
    && savedMatchesGeneration
  ) {
    const declaredKind = String(saved.snapshotKind || "").toLowerCase();
    return {
      ...saved,
      ...(generationContext ? { generationContext } : {}),
      tradingDate,
      generationId: derivedGenerationId,
      sourceUpdatedAt: saved.sourceUpdatedAt || payload.fetchedAt || payload.updatedAt || null,
      snapshotKind: declaredKind === "closing" || declaredKind === "intraday"
        ? declaredKind
        : marketSnapshotKind(payload, tradingDate),
      stale: saved.stale === true || payload.stale === true,
    };
  }
  const providerDates = payload && payload.market && payload.market.limitStats
    && payload.market.limitStats.dates || {};
  const expectedPreviousTradingDate = providerDates.verified === true
    ? normalizeCycleYmd(providerDates.prev || "")
    : "";
  const replayDepth = Math.max(0, Number(options.replayDepth || 0));
  let previousThemeLibrary = options.previousThemeLibrary || null;
  let exactPreviousMissing = false;
  if (
    !previousThemeLibrary
    && expectedPreviousTradingDate
    && options.allowPreviousArchiveRead === false
  ) exactPreviousMissing = true;
  if (
    options.allowPreviousArchiveRead !== false
    && !previousThemeLibrary
    && expectedPreviousTradingDate
    && replayDepth < 30
  ) {
    const previousArchive = loadPrevArchive(tradingDate, {
      expectedDate: expectedPreviousTradingDate,
      requireExact: true,
    });
    if (previousArchive && previousArchive.fresh === true && previousArchive.payload) {
      previousThemeLibrary = themeLibrarySnapshotFromPayload(
        previousArchive.payload,
        "archive-replay",
        { replayDepth: replayDepth + 1 },
      );
      if (
        !previousThemeLibrary
        || normalizeThemeLibraryDate(previousThemeLibrary.tradingDate) !== expectedPreviousTradingDate
        || String(previousThemeLibrary.snapshotKind || "").toLowerCase() !== "closing"
      ) previousThemeLibrary = null;
    }
    if (!previousThemeLibrary) exactPreviousMissing = true;
  }
  const built = buildThemeLibrarySnapshot(payload, {
    tradingDate,
    snapshotKind: marketSnapshotKind(payload, tradingDate),
    sourceMode,
    previousThemeLibrary,
    exactPreviousMissing,
    ...(generationContext ? { generatedAt: generationContext.asOf } : {}),
  });
  return generationContext ? { ...built, generationContext } : built;
}

function applyThemeCycleIdentitiesToCandidates(payload) {
  if (!payload || !Array.isArray(payload.candidates)) return payload;
  const themes = payload.themeLibrary && Array.isArray(payload.themeLibrary.themes)
    ? payload.themeLibrary.themes
    : [];
  const projectedByCode = new Map();
  const dailyHeightByCode = new Map();
  const sessionMembershipContractAvailable = themes.some((theme) => (
    theme && theme.roleMembershipByCode && typeof theme.roleMembershipByCode === "object"
  ));
  const sessionTradingDate = String(
    payload.themeLibrary && payload.themeLibrary.tradingDate
    || payload.market && payload.market.limitStats && payload.market.limitStats.dates && payload.market.limitStats.dates.today
    || payload.tradingDate
    || "",
  ).trim() || null;
  const stateWeight = { confirmed: 5, retained: 4, challenged: 3, provisional: 2, candidate: 1, replaced: 0, expired: -1 };
  const projectionWeight = (row) => (
    (row.executionEligible === true ? 2_000_000 : 0)
    + (row.activePrimary === true ? 1_000_000 : 0)
    + (row.identityEstablished === true ? 100_000 : 0)
    + Number(stateWeight[String(row.state || "")] || 0) * 10_000
    + Number(row.averageImpactStrength || 0) * 10
    + Number(row.validImpactDays || 0)
  );

  themes.forEach((theme) => {
    const leadership = theme && theme.cycleLeadership && typeof theme.cycleLeadership === "object"
      ? theme.cycleLeadership
      : null;
    const identities = leadership && leadership.identities && typeof leadership.identities === "object"
      ? leadership.identities
      : {};
    Object.entries(identities).forEach(([rawCode, identity]) => {
      const code = String(identity && identity.code || rawCode || "").trim();
      if (!code || !identity || typeof identity !== "object") return;
      const membershipAuthority = theme && theme.roleAuthorityByCode
        && typeof theme.roleAuthorityByCode === "object"
        ? theme.roleAuthorityByCode[code] || null
        : null;
      const identityCanExecute = identity.identityEstablished === true
        && identity.activePrimary === true
        && ["confirmed", "retained"].includes(String(identity.state || ""))
        && membershipAuthority
        && membershipAuthority.executionEligible === true
        && membershipAuthority.cycleLeader === true;
      const projection = {
        version: 1,
        source: "theme_library_cycle_state_v1",
        themeId: String(theme && theme.id || "").trim() || null,
        themeName: String(theme && theme.name || "").trim() || null,
        themeKey: String(leadership.themeKey || "").trim() || null,
        cycleInstanceId: String(leadership.cycleInstanceId || "").trim() || null,
        state: String(identity.state || "candidate"),
        identityEstablished: identity.identityEstablished === true,
        activePrimary: identity.activePrimary === true,
        confirmedTradingDates: Array.from(new Set(Array.isArray(identity.confirmedTradingDates) ? identity.confirmedTradingDates : [])),
        evidenceDates: Array.from(new Set(Array.isArray(identity.impactTradingDates) ? identity.impactTradingDates : [])),
        settledTradingDate: String(leadership.settledTradingDate || "").trim() || null,
        frozen: leadership.frozen === true,
        calibrated: false,
        averageImpactStrength: Number(identity.averageImpactStrength || 0),
        validImpactDays: Number(identity.validImpactDays || 0),
        executionEligible: identityCanExecute === true,
        membershipAuthority: membershipAuthority && typeof membershipAuthority === "object"
          ? { ...membershipAuthority, executionEligible: identityCanExecute === true }
          : {
              version: 1,
              cycleLeader: false,
              executionEligible: false,
              source: "unavailable",
              tradingDate: sessionTradingDate,
              gaps: ["缺少逐股题材归属权限证据，已按不可执行处理"],
            },
      };
      const current = projectedByCode.get(code);
      if (!current || projectionWeight(projection) > projectionWeight(current)) projectedByCode.set(code, projection);
    });
    const registerDailyHeight = (rawCode) => {
      const code = String(rawCode || "").trim();
      if (!code) return;
      const current = dailyHeightByCode.get(code) || {
        version: 1,
        source: "theme_library_daily_height_v1",
        roleKind: "dailyHeight",
        roleScope: "session",
        dailyRole: "当日高度",
        themeIds: [],
        themeNames: [],
      };
      const themeId = String(theme && theme.id || "").trim();
      const themeName = String(theme && theme.name || "").trim();
      if (themeId && !current.themeIds.includes(themeId)) current.themeIds.push(themeId);
      if (themeName && !current.themeNames.includes(themeName)) current.themeNames.push(themeName);
      dailyHeightByCode.set(code, current);
    };
    Object.entries(theme && theme.roleMembershipByCode && typeof theme.roleMembershipByCode === "object"
      ? theme.roleMembershipByCode : {}).forEach(([code, membership]) => {
      if (membership && membership.dailyHeight === true) registerDailyHeight(code);
    });
    (Array.isArray(theme && theme.dailyHeightStocks) ? theme.dailyHeightStocks : []).forEach((row) => {
      registerDailyHeight(row && (row.code || row.secCode || row.stockCode));
    });
  });

  payload.candidates.forEach((stock) => {
    if (!stock || typeof stock !== "object") return;
    const code = String(stock.code || stock.secCode || "").trim();
    stock.leadership = stock.leadership && typeof stock.leadership === "object"
      ? stock.leadership
      : {};
    const cycleProjection = projectedByCode.get(code) || null;
    stock.leadership.cycleIdentity = cycleProjection;
    const dailyHeight = dailyHeightByCode.get(code) || null;
    stock.leadership.dailyHeightMembership = dailyHeight;
    const candidateSessionHeight = !sessionMembershipContractAvailable && (stock.roleKind === "dailyHeight"
      || stock.dailyRole === "当日高度"
      || stock.roleScope === "session" && /高度/.test(String(stock.dailyRole || stock.role || "")));
    stock.leadership.sessionIdentity = dailyHeight || candidateSessionHeight ? {
      version: 1,
      source: dailyHeight ? "theme_library_daily_height_v1" : "candidate_session_role_v1",
      tradingDate: sessionTradingDate,
      dailyHeight: true,
      themeIds: dailyHeight ? dailyHeight.themeIds.slice() : [],
      themeNames: dailyHeight ? dailyHeight.themeNames.slice() : [],
      calibrated: false,
    } : null;
    const verifiedCycleCore = cycleProjection
      && cycleProjection.identityEstablished === true
      && cycleProjection.activePrimary === true
      && ["confirmed", "retained"].includes(String(cycleProjection.state || ""))
      && cycleProjection.executionEligible === true;
    if (dailyHeight && !(verifiedCycleCore && stock.roleKind === "cycleLeader" && stock.roleScope === "cycle")) {
      stock.roleKind = "dailyHeight";
      stock.roleScope = "session";
      stock.dailyRole = "当日高度";
    }
  });
  return payload;
}

function themeLibraryRecordPriority(record) {
  const snapshotKind = String(record.snapshot.snapshotKind || "").toLowerCase();
  const updatedClock = shanghaiClockParts(record.snapshot.sourceUpdatedAt || record.snapshot.generatedAt || "");
  const currentFresh = record.sourceType === "current-cache"
    && record.snapshot.stale !== true
    && updatedClock
    && updatedClock.date === record.snapshot.tradingDate;
  const sourcePriority = snapshotKind === "closing"
    ? record.sourceType === "archive" ? 40 : currentFresh ? 41 : 35
    : snapshotKind === "intraday"
      ? record.sourceType === "archive" ? 20 : currentFresh ? 21 : 15
      : record.sourceType === "archive" ? 10 : currentFresh ? 11 : 5;
  const timestamp = Date.parse(record.snapshot.sourceUpdatedAt || record.snapshot.generatedAt || "");
  return sourcePriority * 1e15 + (Number.isFinite(timestamp) ? timestamp : record.mtimeMs || 0);
}

function loadThemeLibraryFileRecord(entry, sourceType) {
  const signature = `${sourceType}:${entry.size}:${Math.round(entry.mtimeMs)}`;
  const cached = themeLibraryFileRecordCache.get(entry.filePath);
  if (cached && cached.signature === signature) return cached.record;
  const payload = readJsonFile(entry.filePath);
  const snapshot = themeLibrarySnapshotFromPayload(payload, sourceType === "archive" ? "legacy-derived" : "current-cache");
  const record = snapshot && snapshot.tradingDate && snapshot.available
    ? {
        ...entry,
        snapshot,
        sourceType,
        filenameMismatch: Boolean(entry.fileDate && entry.fileDate !== snapshot.tradingDate),
      }
    : null;
  themeLibraryFileRecordCache.set(entry.filePath, { signature, record });
  return record;
}

function loadThemeLibraryCatalog() {
  const historyDir = path.join(runtimeRoot, "data", "history");
  const archiveFiles = fs.existsSync(historyDir)
    ? fs.readdirSync(historyDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name))
      .map((entry) => {
        const filePath = path.join(historyDir, entry.name);
        try {
          const stat = fs.statSync(filePath);
          return { filePath, fileDate: entry.name.slice(0, 10), mtimeMs: stat.mtimeMs, size: stat.size };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
    : [];
  let currentFile = null;
  try {
    const stat = fs.statSync(hotStocksCacheFile);
    currentFile = { filePath: hotStocksCacheFile, fileDate: null, mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    currentFile = null;
  }
  const signature = [...archiveFiles, ...(currentFile ? [currentFile] : [])]
    .map((entry) => `${entry.filePath}:${entry.size}:${Math.round(entry.mtimeMs)}`)
    .join("|");
  if (themeLibraryCatalogCache.signature === signature) return themeLibraryCatalogCache.records;

  const records = archiveFiles
    .map((entry) => loadThemeLibraryFileRecord(entry, "archive"))
    .filter(Boolean);
  if (currentFile) {
    const currentRecord = loadThemeLibraryFileRecord(currentFile, "current-cache");
    if (currentRecord) records.push(currentRecord);
  }
  const activePaths = new Set([...archiveFiles, ...(currentFile ? [currentFile] : [])].map((entry) => entry.filePath));
  themeLibraryFileRecordCache.forEach((_value, filePath) => {
    if (!activePaths.has(filePath)) themeLibraryFileRecordCache.delete(filePath);
  });

  const byDate = new Map();
  records.forEach((record) => {
    const current = byDate.get(record.snapshot.tradingDate);
    if (!current || themeLibraryRecordPriority(record) > themeLibraryRecordPriority(current)) {
      byDate.set(record.snapshot.tradingDate, record);
    }
  });
  const deduped = Array.from(byDate.values())
    .sort((left, right) => right.snapshot.tradingDate.localeCompare(left.snapshot.tradingDate));
  themeLibraryCatalogCache = { signature, records: deduped };
  return deduped;
}

function buildThemeLibraryApiResponse(requestedDate = "") {
  const records = loadThemeLibraryCatalog();
  if (!records.length) {
    return { status: 404, payload: { ok: false, available: false, error: "暂无题材库快照，请先完成一次市场抓取" } };
  }
  const selected = requestedDate
    ? records.find((record) => record.snapshot.tradingDate === requestedDate)
    : records[0];
  if (!selected) {
    return {
      status: 404,
      payload: {
        ok: false,
        available: false,
        error: `${requestedDate} 没有题材库快照`,
        latestDate: records[0].snapshot.tradingDate,
        availableDates: records.map((record) => record.snapshot.tradingDate),
      },
    };
  }
  const expectedPreviousDate = selected.snapshot.previousDateVerified === false
    ? ""
    : normalizeThemeLibraryDate(selected.snapshot.previousTradingDate);
  const previous = expectedPreviousDate
    ? records.find((record) => record.snapshot.tradingDate === expectedPreviousDate)
    : null;
  const comparison = compareThemeLibrarySnapshots(selected.snapshot, previous && previous.snapshot);
  const changes = new Map(comparison.themeChanges.map((change) => [change.id, change]));
  const snapshot = {
    ...selected.snapshot,
    themes: selected.snapshot.themes.map((theme) => {
      const history = changes.get(String(theme.id || theme.family || theme.name || "").trim()) || null;
      return {
        ...theme,
        history,
        themeCycle: themeCycleEvidence(
          theme,
          theme.cycleLeadership,
          selected.snapshot.tradingDate,
          history,
        ),
      };
    }),
  };
  return {
    status: 200,
    payload: {
      ok: true,
      available: true,
      selectedDate: snapshot.tradingDate,
      latestDate: records[0].snapshot.tradingDate,
      expectedPreviousDate: expectedPreviousDate || null,
      previousAvailable: Boolean(previous),
      availableDates: records.map((record) => ({
        date: record.snapshot.tradingDate,
        themeCount: record.snapshot.themeCount,
        stockCount: record.snapshot.stockCount,
        generatedAt: record.snapshot.sourceUpdatedAt || record.snapshot.generatedAt,
        sourceMode: record.snapshot.sourceMode,
      })),
      comparison,
      snapshot,
      archiveMeta: {
        sourceType: selected.sourceType,
        filenameMismatch: selected.filenameMismatch,
        fileDate: selected.fileDate,
      },
    },
  };
}

function roundNumber(value, digits = 2) {















  const num = Number(value);















  if (!Number.isFinite(num)) return 0;















  const factor = 10 ** digits;















  return Math.round(num * factor) / factor;















}































function parseNumber(value, fallback = 0) {















  const num = Number(value);















  return Number.isFinite(num) ? num : fallback;















}































function pickValue(row, keys) {















  if (!row) return undefined;















  for (const key of keys) {















    const value = row[key];















    if (value !== undefined && value !== null && value !== "") return value;















  }















  return undefined;















}































function pickNumber(row, keys, fallback = 0) {















  return parseNumber(pickValue(row, keys), fallback);















}































function normalizeAshareSymbol(raw) {















  const text = String(raw || "").trim().replace(/\s+/g, "");















  if (!text) return "";















  const upper = text.toUpperCase();















  let match = upper.match(/^(\d{6})\.(SZ|SH)$/);















  if (match) return `${match[1]}.${match[2]}`;















  match = upper.match(/^(SZ|SH)(\d{6})$/);















  if (match) return `${match[2]}.${match[1]}`;















  match = upper.match(/^(\d{6})$/);















  if (match) return `${match[1]}.${match[1].startsWith("6") ? "SH" : "SZ"}`;















  return "";















}































function displaySymbolFromAshare(raw) {















  return normalizeAshareSymbol(raw);















}































function toTencentSymbol(raw) {















  const normalized = normalizeAshareSymbol(raw);















  if (!normalized) return "";















  const [code, market] = normalized.split(".");















  return `${market === "SH" ? "sh" : "sz"}${code}`;















}































function normalizeSymbolList(symbols) {















  const rawList = Array.isArray(symbols)















    ? symbols















    : String(symbols || "")















        .split(/[\s,;]+/)















        .filter(Boolean);















  const seen = new Set();















  const normalized = [];















  for (const raw of rawList) {















    const symbol = normalizeAshareSymbol(raw);















    if (!symbol || seen.has(symbol)) continue;















    seen.add(symbol);















    normalized.push(symbol);















  }















  return normalized;















}































function formatTradeTime(raw) {















  const text = String(raw || "").trim();















  if (!text) return nowIso();















  if (/^\d{14}$/.test(text)) {















    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} ${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}`;















  }















  if (/^\d{8}$/.test(text)) {















    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} 00:00:00`;















  }















  return text;















}































function defaultHealth(source) {















  return {















    source,















    success: false,















    last_success_at: null,















    last_error: null,















    latency_ms: null,















    last_attempt_at: null,















  };















}































function recordSourceHealth(source, patch = {}) {















  const prev = dataSourceHealth.get(source) || defaultHealth(source);















  const next = {















    ...prev,















    ...patch,















    source,















    last_attempt_at: nowIso(),















  };















  dataSourceHealth.set(source, next);















  return next;















}































function getDataSourceHealthSnapshot() {















  return DATA_SOURCE_ORDER.map((source) => dataSourceHealth.get(source) || defaultHealth(source));















}































function getCacheEntry(key) {















  const entry = dataSourceCache.get(key);















  if (!entry) return null;















  if (entry.expiresAt <= Date.now()) {















    dataSourceCache.delete(key);















    return null;















  }















  return entry.value;















}































function setCacheEntry(key, value, ttlMs = DATA_SOURCE_CACHE_TTL_MS) {















  dataSourceCache.set(key, {















    value,















    expiresAt: Date.now() + ttlMs,















  });















}































function normalizeTickRow(row, source, symbolHint) {















  const symbol = displaySymbolFromAshare(pickValue(row, ["symbol", "code", "sec_code", "secCode", "ticker"]) || symbolHint);















  if (!symbol) return null;































  const lastPrice = roundNumber(pickNumber(row, ["last_price", "price", "now", "close", "现价"], 0), 2);















  const prevClose = roundNumber(pickNumber(row, ["prev_close", "pre_close", "preClose", "昨收", "last_close"], 0), 2);















  const open = roundNumber(pickNumber(row, ["open", "open_price", "今开"], 0), 2);















  const high = roundNumber(pickNumber(row, ["high", "high_price", "最高"], 0), 2);















  const low = roundNumber(pickNumber(row, ["low", "low_price", "最低"], 0), 2);















  const volume = roundNumber(pickNumber(row, ["volume", "vol", "成交量", "volumn"], 0), 0);















  let turnover = pickNumber(row, ["turnover", "amount", "money", "amt", "成交额", "成交金额"], 0);















  if (!turnover && volume && lastPrice) {















    turnover = roundNumber(volume * lastPrice, 0);















  }















  let pctChange = pickNumber(row, ["pct_change", "change_pct", "percent", "涨跌幅"], 0);















  if (!pctChange && prevClose) {















    pctChange = roundNumber(((lastPrice - prevClose) / prevClose) * 100, 2);















  } else {















    pctChange = roundNumber(pctChange, 2);















  }































  return {















    symbol,















    name: String(pickValue(row, ["name", "stock_name", "sec_name", "名称", "简称"]) || symbol),















    trade_time: formatTradeTime(pickValue(row, ["trade_time", "datetime", "time", "更新时间"])),















    last_price: lastPrice,















    prev_close: prevClose,















    open,















    high,















    low,















    volume,















    turnover: roundNumber(turnover, 0),















    pct_change: pctChange,















    source,















  };















}































function buildMockQuote(symbol, index = 0) {















  const normalized = displaySymbolFromAshare(symbol);















  const seed = Number((normalized || "000000.SZ").replace(/\D/g, "").slice(-6)) || index + 1;















  const base = roundNumber(8 + (seed % 5000) / 1000, 2);















  const delta = ((seed % 37) - 18) / 1000;















  const lastPrice = roundNumber(base * (1 + delta), 2);















  const prevClose = roundNumber(base, 2);















  const open = roundNumber(base * (1 + (((seed % 13) - 6) / 1000)), 2);















  const high = roundNumber(Math.max(lastPrice, open) * 1.01, 2);















  const low = roundNumber(Math.min(lastPrice, open) * 0.99, 2);















  const volume = Math.round(200000 + (seed % 800000));















  const turnover = Math.round(volume * lastPrice);















  const pct_change = roundNumber(((lastPrice - prevClose) / prevClose) * 100, 2);































  return {















    symbol: normalized,















    name: `Mock${normalized.slice(0, 6)}`,















    trade_time: nowIso(),















    last_price: lastPrice,















    prev_close: prevClose,















    open,















    high,















    low,















    volume,















    turnover,















    pct_change,















    source: "mock",















  };















}































function mergeQuotesByOrder(symbols, rows) {















  const map = new Map(rows.map((row) => [row.symbol, row]));















  return symbols.map((symbol) => map.get(symbol)).filter(Boolean);















}































class MarketDataSource {















  constructor(name) {















    this.name = name;















  }































  async fetchTicks() {















    throw new Error("not_implemented");















  }















}































class MockMarketDataSource extends MarketDataSource {















  constructor() {















    super("mock");















  }































  async fetchTicks(symbols) {















    const normalizedSymbols = normalizeSymbolList(symbols);















    const startedAt = Date.now();















    const rows = normalizedSymbols.map((symbol, index) => buildMockQuote(symbol, index));















    recordSourceHealth(this.name, {















      success: true,















      last_success_at: nowIso(),















      last_error: null,















      latency_ms: Date.now() - startedAt,















    });















    return { source: this.name, data: rows };















  }















}































class TencentDataSource extends MarketDataSource {















  constructor() {















    super("tencent");















  }































  async fetchTicks(symbols) {















    const normalizedSymbols = normalizeSymbolList(symbols);















    if (!normalizedSymbols.length) {















      throw new Error("empty_symbol_list");















    }































    const cacheKey = `${this.name}|${normalizedSymbols.join(",")}`;















    const cached = getCacheEntry(cacheKey);















    if (cached) return cached;































    const startedAt = Date.now();















    const requestSymbols = normalizedSymbols.map((symbol) => toTencentSymbol(symbol)).filter(Boolean);















    const url = `https://qt.gtimg.cn/q=${requestSymbols.join(",")}`;















    const response = await fetch(url, {















      headers: {















        "User-Agent": "Mozilla/5.0",















        Referer: "https://gu.qq.com/",















      },















      signal: AbortSignal.timeout(DATA_SOURCE_TIMEOUT_MS),















    });































    if (!response.ok) {















      throw new Error(`tencent_http_${response.status}`);















    }































    const buffer = Buffer.from(await response.arrayBuffer());















    const text = new TextDecoder("gb18030").decode(buffer);















    const rows = [];















    const regex = /v_([a-z]{2}\d{6})="([^"]*)"/g;















    let match;































    while ((match = regex.exec(text))) {















      const requestSymbol = match[1];















      const arr = match[2].split("~");















      const symbol = `${arr[2] || requestSymbol.slice(2)}.${requestSymbol.startsWith("sh") ? "SH" : "SZ"}`;















      const amountParts = String(arr[35] || "").split("/");















      const turnover = parseNumber(amountParts[2], 0) || roundNumber(parseNumber(arr[57], 0) * 10000, 0);















      const normalized = normalizeTickRow(















        {















          symbol,















          name: arr[1],















          trade_time: arr[30],















          last_price: arr[3],















          prev_close: arr[4],















          open: arr[5],















          high: arr[33],















          low: arr[34],















          volume: arr[6],















          turnover,















          pct_change: arr[32],















        },















        this.name,















        symbol,















      );















      if (normalized) rows.push(normalized);















    }































    const payload = { source: this.name, data: mergeQuotesByOrder(normalizedSymbols, rows) };















    recordSourceHealth(this.name, {















      success: true,















      last_success_at: nowIso(),















      last_error: null,















      latency_ms: Date.now() - startedAt,















    });















    setCacheEntry(cacheKey, payload);















    return payload;















  }















}































class MootdxDataSource extends MarketDataSource {















  constructor() {















    super("mootdx");















  }































  async fetchTicks(symbols) {















    const normalizedSymbols = normalizeSymbolList(symbols);















    if (!normalizedSymbols.length) {















      throw new Error("empty_symbol_list");















    }































    const cacheKey = `${this.name}|${normalizedSymbols.join(",")}`;















    const cached = getCacheEntry(cacheKey);















    if (cached) return cached;































    const startedAt = Date.now();















    let lastError = null;















    const script = `















import json















import sys















try:















    from mootdx.quotes import Quotes















    symbols = json.loads(sys.argv[1])















    client = Quotes.factory(market='std')















    result = client.quotes(symbol=symbols)















    if result is None:















        print(json.dumps({"ok": True, "rows": []}, ensure_ascii=False))















    else:















        try:















            rows = result.to_dict(orient='records')















        except Exception:















            rows = result















        print(json.dumps({"ok": True, "rows": rows}, ensure_ascii=False, default=str))















except Exception as exc:















    print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))















`;































    for (const command of ["python", "py"]) {















      try {















        const { stdout } = await execFileAsync(command, ["-c", script, JSON.stringify(normalizedSymbols.map((item) => item.slice(0, 6)))], {















          windowsHide: true,















          maxBuffer: 20 * 1024 * 1024,















          env: {















            ...process.env,















            PYTHONIOENCODING: "utf-8",















          },















        });















        const parsed = JSON.parse(stdout);















        if (!parsed.ok) {















          throw new Error(parsed.error || "mootdx_error");















        }















        const rows = (parsed.rows || [])















          .map((row, index) => normalizeTickRow(row, this.name, normalizedSymbols[index]))















          .filter(Boolean);















        const payload = {















          source: this.name,















          data: mergeQuotesByOrder(normalizedSymbols, rows.length ? rows : normalizedSymbols.map((symbol, index) => buildMockQuote(symbol, index))),















        };















        recordSourceHealth(this.name, {















          success: true,















          last_success_at: nowIso(),















          last_error: null,















          latency_ms: Date.now() - startedAt,















        });















        setCacheEntry(cacheKey, payload);















        return payload;















      } catch (error) {















        lastError = error;















      }















    }































    recordSourceHealth(this.name, {















      success: false,















      last_error: lastError ? lastError.message : "mootdx_unavailable",















      latency_ms: Date.now() - startedAt,















    });















    throw lastError || new Error("mootdx_unavailable");















  }















}































class FallbackMarketDataSource extends MarketDataSource {















  constructor(sources = [new TencentDataSource(), new MockMarketDataSource()]) {















    super("fallback");















    this.sources = sources;















  }































  async fetchTicks(symbols) {















    const normalizedSymbols = normalizeSymbolList(symbols);















    const cacheKey = `${this.name}|${normalizedSymbols.join(",")}`;















    const cached = getCacheEntry(cacheKey);















    if (cached) return cached;































    const startedAt = Date.now();















    const remaining = new Set(normalizedSymbols);















    const rowsBySymbol = new Map();















    const sourceChain = [];































    for (const source of this.sources) {















      if (!remaining.size) break;















      try {















        const response = await source.fetchTicks([...remaining]);















        sourceChain.push(response.source || source.name);















        for (const row of response.data || []) {















          if (row && row.symbol) {















            rowsBySymbol.set(row.symbol, row);















            remaining.delete(row.symbol);















          }















        }















      } catch (error) {















        sourceChain.push(`${source.name}:error`);















        recordSourceHealth(source.name, {















          success: false,















          last_error: error.message,















          latency_ms: Date.now() - startedAt,















        });















      }















    }































    for (const symbol of remaining) {















      rowsBySymbol.set(symbol, buildMockQuote(symbol));















    }































    const data = normalizedSymbols.map((symbol) => rowsBySymbol.get(symbol)).filter(Boolean);















    const payload = {















      source: data.length && data.every((row) => row.source === data[0].source) ? data[0].source : "fallback",















      source_chain: sourceChain,















      data,















    };















    recordSourceHealth(this.name, {















      success: true,















      last_success_at: nowIso(),















      last_error: null,















      latency_ms: Date.now() - startedAt,















    });















    setCacheEntry(cacheKey, payload);















    return payload;















  }















}































const realtimeMarketDataSource = new FallbackMarketDataSource();































function loadHotStocksFallback() {
  const runtime = readRetainedJson(hotStocksCacheFile, { archiveDir: hotStocksCacheArchiveDir });
  const seed = readJsonFile(path.join(root, "data", "seed-hot-stocks.json"));
  const profileCount = (payload) => ((payload && payload.candidates) || []).filter((item) => item && item.klineProfile).length;
  if (runtime && (profileCount(runtime) > 0 || !seed)) return runtime;
  return seed || runtime || readJsonFile(path.join(root, "dist", "data.json"));
}

function themeAttributionReviewContext(input) {
  const payload = input && typeof input === "object" ? input : {};
  const decision = payload.tomorrowDecision && typeof payload.tomorrowDecision === "object"
    ? payload.tomorrowDecision
    : {};
  const generationId = String(payload.generationId || decision.generationId || "").trim();
  const tradingDate = String(
    payload.tradingDate
    || decision.tradingDate
    || payload.market && payload.market.limitStats && payload.market.limitStats.dates
      && payload.market.limitStats.dates.today
    || generationId.split(":")[0]
    || "",
  ).trim();
  const asOf = String(
    payload.asOf
    || payload.fetchedAt
    || payload.updatedAt
    || decision.asOf
    || (generationId.includes(":") ? generationId.slice(generationId.indexOf(":") + 1) : "")
    || "",
  ).trim();
  return {
    currentGeneration: { generationId, tradingDate, asOf },
    decision,
    candidates: Array.isArray(payload.candidates) ? payload.candidates : [],
  };
}

function loadHotRankCache() {
  return readRetainedJson(hotRankCacheFile, { archiveDir: hotRankCacheArchiveDir }) || {
    version: 1,
    targetCount: HOT_RANK_TARGET,
    sources: {},
  };
}

function cachedClosingRankSource(cache, source) {
  const sourceCache = cache && cache.sources && cache.sources[source];
  return sourceCache && sourceCache.lastClosing || null;
}

function persistHotRankCache(cache, resolutions, stamp = new Date()) {
  const hasDirectRows = ["eastmoney", "ths"].some((source) => {
    const result = resolutions && resolutions[source];
    return result && result.rows && result.rows.length && result.meta && result.meta.isFallback !== true;
  });
  if (!hasDirectRows) return cache;
  const next = updateHotRankCache(cache, resolutions, stamp);
  return writeRetainedJson(hotRankCacheFile, next, { archiveDir: hotRankCacheArchiveDir }) || next;
}

function hotRankSourceSummary(eastmoney, ths) {
  const eastCodes = new Set((eastmoney && eastmoney.rows || []).map((item) => item.code));
  const thsCodes = new Set((ths && ths.rows || []).map((item) => item.code));
  const union = new Set([...eastCodes, ...thsCodes]);
  const overlapCount = [...eastCodes].filter((code) => thsCodes.has(code)).length;
  return {
    targetPerSource: HOT_RANK_TARGET,
    unionCount: union.size,
    overlapCount,
    eastmoney: publicRankMeta(eastmoney && eastmoney.meta),
    ths: publicRankMeta(ths && ths.meta),
  };
}

function normalizeCycleYmd(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return String(value || "");
}

function classifyShockRepair(snapshot, limitStats, previousPayload) {
  const previousSnapshot = previousPayload && previousPayload.market ? previousPayload.market.snapshot : null;
  const previousLimit = previousPayload && previousPayload.market ? previousPayload.market.limitStats : null;
  const signals = [];
  const push = (name, ok, note) => signals.push({ name, ok, note });
  const optionalFinite = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const breadth = optionalFinite(snapshot && snapshot.breadth);
  const avgIndexChange = optionalFinite(snapshot && snapshot.avgIndexChange);
  const dtToday = optionalFinite(limitStats && limitStats.dtToday);
  const ztToday = optionalFinite(limitStats && limitStats.ztToday);
  // 涨跌停接口已经给出真正上一交易日的口径，优先使用它；历史归档只作兜底。
  // 这样即使本地少归档一天，也不会把数天前的涨跌停拿来冒充“昨天”。
  const directPrevDt = optionalFinite(limitStats && limitStats.dtPrev);
  const directPrevZt = optionalFinite(limitStats && limitStats.ztPrev);
  const archivedPrevDt = optionalFinite(previousLimit && previousLimit.dtToday);
  const archivedPrevZt = optionalFinite(previousLimit && previousLimit.ztToday);
  const prevDt = Number.isFinite(directPrevDt) ? directPrevDt : archivedPrevDt;
  const prevZt = Number.isFinite(directPrevZt) ? directPrevZt : archivedPrevZt;

  push(
    "市场广度修复",
    Number.isFinite(breadth) ? breadth >= 0.35 : null,
    Number.isFinite(breadth) ? `上涨占比${Math.round(breadth * 100)}%（确认线35%）` : "上涨家数数据缺失",
  );
  push(
    "指数止跌",
    Number.isFinite(avgIndexChange) ? avgIndexChange >= -0.8 : null,
    Number.isFinite(avgIndexChange) ? `主要指数均值${avgIndexChange.toFixed(2)}%（确认线-0.80%）` : "指数数据缺失",
  );
  push(
    "跌停显著缩减",
    Number.isFinite(dtToday) && Number.isFinite(prevDt) && prevDt > 0 ? dtToday <= Math.min(15, prevDt * 0.5) : null,
    Number.isFinite(dtToday) && Number.isFinite(prevDt) ? `跌停${prevDt}→${dtToday}（至少缩减一半）` : "缺前一交易日跌停对比",
  );
  push(
    "涨停企稳",
    Number.isFinite(ztToday) && Number.isFinite(prevZt) && prevZt > 0 ? ztToday >= Math.max(30, prevZt * 0.9) : null,
    Number.isFinite(ztToday) && Number.isFinite(prevZt) ? `涨停${prevZt}→${ztToday}（不再继续明显缩减）` : "缺前一交易日涨停对比",
  );

  const knownCount = signals.filter((item) => item.ok !== null).length;
  const okCount = signals.filter((item) => item.ok === true).length;
  return {
    comparisonReady: knownCount >= 3,
    confirmed: knownCount >= 3 && okCount >= 3,
    okCount,
    knownCount,
    signals,
    previousSource: Number.isFinite(directPrevDt) && Number.isFinite(directPrevZt) ? "limit-stats" : "archive",
  };
}

function applyShockAwareCycleTransition(observedCycle, todayKey, options = {}) {
  observedCycle = normalizeBigCycle(observedCycle) || "混沌";
  const today = normalizeCycleYmd(todayKey);
  const afterClose = Boolean(options.afterClose);
  const stored = readJsonFile(cycleStateFile) || null;
  const storedTransition = stored && stored.shockTransition ? stored.shockTransition : null;
  const tradingDates = options.limitStats && options.limitStats.dates ? options.limitStats.dates : null;
  const tradingDatesVerified = Boolean(tradingDates && tradingDates.verified === true);
  const expectedPrevDate = tradingDatesVerified ? normalizeCycleYmd(tradingDates.prev) : "";
  const previousArchive = loadPrevArchive(today, {
    expectedDate: expectedPrevDate,
    requireExact: Boolean(expectedPrevDate),
  });
  const previousPayload = previousArchive ? previousArchive.payload : null;
  const previousArchiveFresh = Boolean(
    previousArchive
    && previousPayload
    && (!expectedPrevDate || normalizeCycleYmd(previousArchive.date) === expectedPrevDate),
  );
  const previousState = previousPayload && previousPayload.market ? previousPayload.market.state : null;
  const archivedBaseCycle = normalizeBigCycle(previousState && (previousState.structuralCycle || previousState.cycle));
  const externalAlertActive = Boolean(options.externalCoreAlert && options.externalCoreAlert.active);
  const snapshot = options.snapshot || null;
  const limitStats = options.limitStats || null;
  const optionalShockNumber = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const index = optionalShockNumber(snapshot && snapshot.avgIndexChange);
  const breadth = optionalShockNumber(snapshot && snapshot.breadth);
  const dtToday = optionalShockNumber(limitStats && limitStats.dtToday);
  const ztToday = optionalShockNumber(limitStats && limitStats.ztToday);
  const ztPrev = optionalShockNumber(limitStats && limitStats.ztPrev);
  const ztCollapse = Number.isFinite(ztToday) && Number.isFinite(ztPrev) && ztPrev > 0 && ztToday <= ztPrev * 0.65;
  const retreatLevelDamage =
    observedCycle === "退潮" &&
    Number.isFinite(index) && index <= -1.1 &&
    Number.isFinite(breadth) && breadth < 0.28 &&
    ((Number.isFinite(dtToday) && dtToday >= 15) || ztCollapse);
  const persist = (cycle, shockTransition) => {
    const canonicalCycle = normalizeBigCycle(cycle) || "混沌";
    writeJsonFile(cycleStateFile, {
      cycle: canonicalCycle,
      structuralCycle: canonicalCycle,
      date: String(todayKey || ""),
      shockTransition,
    });
  };

  if (storedTransition && storedTransition.active) {
    const startedOn = normalizeCycleYmd(storedTransition.startedOn || stored.date);
    const sameShockDay = startedOn === today;
    if (sameShockDay) {
      const active = {
        ...storedTransition,
        externalAlertActive: storedTransition.externalAlertActive || externalAlertActive,
        stage: "待次日验证",
      };
      const activeCycle = normalizeBigCycle(active.baseCycle) || "混沌";
      persist(activeCycle, active);
      return { cycle: activeCycle, observedCycle, shockTransition: active };
    }

    // 冲击验证只允许发生在紧邻的下一个有效交易日。
    // 若中间缺档或程序数天未运行，旧冲击不得跨日拖延后再强制确认退潮。
    const startedAtMs = Date.parse(`${startedOn}T00:00:00Z`);
    const todayAtMs = Date.parse(`${today}T00:00:00Z`);
    const calendarAgeDays = Number.isFinite(startedAtMs) && Number.isFinite(todayAtMs)
      ? Math.round((todayAtMs - startedAtMs) / 86400000)
      : null;
    // 数据源暂时无法校验交易日时，也不能让旧冲击永久挂起。
    // 允许周五到周一这类最多3个自然日的正常跨度；更久则只作历史记录，不再参与周期确认。
    const expiredWithoutVerifiedCalendar = !expectedPrevDate
      && Number.isFinite(calendarAgeDays)
      && calendarAgeDays > 3;
    if ((expectedPrevDate && startedOn !== expectedPrevDate) || expiredWithoutVerifiedCalendar) {
      const fallbackCycle = normalizeBigCycle(options.structuralCycleHint)
        || normalizeBigCycle(storedTransition.baseCycle)
        || normalizeBigCycle(observedCycle)
        || "混沌";
      const expired = {
        ...storedTransition,
        active: false,
        stage: "验证过期",
        resolvedOn: today,
        resolution: expectedPrevDate
          ? `冲击发生日${startedOn || "未知"}不是上一交易日${expectedPrevDate}，已取消跨日退潮确认`
          : `冲击已过去${calendarAgeDays}个自然日且交易日来源未校验，已取消过期的退潮确认`,
        dataQuality: {
          previousTradingDate: expectedPrevDate || null,
          previousArchiveFresh,
          issues: [expectedPrevDate
            ? "冲击验证未发生在紧邻的下一有效交易日"
            : "交易日来源未校验且冲击已超过3个自然日"],
        },
      };
      persist(fallbackCycle, expired);
      return { cycle: fallbackCycle, observedCycle, shockTransition: expired };
    }

    const repair = classifyShockRepair(snapshot, limitStats, previousPayload);
    if (!expectedPrevDate || !previousArchiveFresh || !afterClose || !repair.comparisonReady) {
      const active = {
        ...storedTransition,
        stage: !expectedPrevDate
          ? "等待上一交易日标识"
          : !previousArchiveFresh
            ? "等待上一交易日完整归档"
            : afterClose
              ? "等待完整收盘对比"
              : "次日10:50验证中",
        repair,
        dataQuality: {
          previousTradingDate: expectedPrevDate || null,
          previousArchiveFresh,
          issues: previousArchiveFresh ? [] : ["缺少真正上一交易日的完整归档，禁止确认周期切换"],
        },
      };
      const activeCycle = normalizeBigCycle(active.baseCycle) || "混沌";
      persist(activeCycle, active);
      return { cycle: activeCycle, observedCycle, shockTransition: active };
    }

    const repaired = repair.confirmed;
    const cycle = repaired ? (normalizeBigCycle(storedTransition.baseCycle) || "混沌") : "退潮";
    const resolved = {
      ...storedTransition,
      active: false,
      stage: repaired ? "纠偏确认" : "退潮确认",
      resolvedOn: today,
      resolution: repaired ? "A股自身修复成立，基础周期继续按混沌" : "A股自身修复不足，正式确认退潮",
      repair,
    };
    persist(cycle, resolved);
    return { cycle, observedCycle, shockTransition: resolved };
  }

  const previousBaseCycle = archivedBaseCycle
    || normalizeBigCycle(stored && (stored.structuralCycle || stored.cycle))
    || null;
  if (afterClose && previousBaseCycle === "混沌" && retreatLevelDamage) {
    const active = {
      active: true,
      label: externalAlertActive ? "外围冲击型大分歧" : "异常冲击型大分歧",
      stage: "待次日验证",
      startedOn: today,
      baseCycle: "混沌",
      observedCycle: "退潮",
      executionCycle: "退潮",
      damageLevel: "退潮级表现",
      checkpoint: "10:50",
      confirmation: "次日收盘确认",
      externalAlertActive,
      attributionNote: externalAlertActive
        ? "外围核心股警觉与A股同步下挫，仅用于冲击归因提示，不直接参与评分或选股"
        : "未用外围提醒改变评分；先按单日异常冲击等待A股自身确认",
    };
    persist("混沌", active);
    return { cycle: "混沌", observedCycle, shockTransition: active };
  }

  const useEffectEngine = Boolean(options.marketEffects && options.marketEffects.dailyState);
  const cycle = useEffectEngine
    ? observedCycle
    : applyCycleIrreversibility(observedCycle, todayKey, { afterClose, now: options.now });
  if (useEffectEngine && afterClose) persist(cycle, null);
  return {
    cycle,
    observedCycle,
    shockTransition: !useEffectEngine && stored && stored.date === String(todayKey || "") && storedTransition && !storedTransition.active
      ? storedTransition
      : null,
  };
}

function loadEastmoneySnapshotFallback() {
  return readRetainedJson(eastmoneySnapshotFile, { archiveDir: eastmoneySnapshotArchiveDir });
}































async function refreshEastmoneySnapshot() {















  try {















    const scriptPath = path.join(root, "eastmoney-fetcher.js");















    const { stdout } = await execFileAsync(process.execPath, [scriptPath, eastmoneySnapshotFile], {















      windowsHide: true,















      maxBuffer: 20 * 1024 * 1024,















      env: {
        ...process.env,
        ...(process.versions && process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      },















    });















    const parsed = JSON.parse(stdout);















    return parsed.parsed || loadEastmoneySnapshotFallback();















  } catch {















    return loadEastmoneySnapshotFallback();















  }















}































function stampPayloadBase(payload, errorMessage = "", options = {}) {















  const stamp = new Date().toISOString();
  const cachedAt = payload.fetchedAt || payload.updatedAt || null;
  const backgroundRefresh = Boolean(options.backgroundRefresh);















  return {















    ...payload,















    // 缓存回退时保留原快照时间，避免旧数据被误认为刚抓到的新数据。
    updatedAt: payload.updatedAt || cachedAt,















    fetchedAt: payload.fetchedAt || cachedAt,

    servedAt: stamp,

    refreshingInBackground: backgroundRefresh,















    stale: Boolean(errorMessage),















    fetchError: errorMessage || null,















    // 慢数据源超时会继续在后台刷新；其他异常则明确标为失败。















    fetchStatus: {















      level: backgroundRefresh ? "partial" : "fail",















      label: backgroundRefresh
        ? `⚠ 实时源响应较慢，后台仍在刷新；先展示 ${String(cachedAt || "").slice(0, 16) || "最近一次"} 的有效快照`
        : `✗ 本次抓取失败（${errorMessage || "数据源不可用"}），当前展示的是 ${String(cachedAt || "").slice(0, 16) || "旧"} 的缓存数据`,















      items: [],















      unclassified: (payload.fetchStatus && payload.fetchStatus.unclassified) || 0,















    },















  };















}































function invalidateLegacyFiveDayIndexStructures(payload) {
  if (!payload || typeof payload !== "object") return payload;
  try {
    const market = payload.market && typeof payload.market === "object" ? payload.market : {};
    const snapshot = market.snapshot && typeof market.snapshot === "object" ? market.snapshot : {};
    const rows = Array.isArray(snapshot.indexStructures) ? snapshot.indexStructures : [];
    if (!rows.length || rows.every(hasCanonicalFiveDaySlope)) return payload;
    return {
      ...payload,
      market: {
        ...market,
        snapshot: {
          ...snapshot,
          indexStructures: [],
          indexStructuresDataQuality: {
            status: "unavailable",
            tradingDate: indexStructureTradingDate(snapshot.tradingDate || payload.tradingDate) || null,
            complete: false,
            reason: "legacy_slope5_window_rejected",
          },
          indexStructuresSource: "none",
          indexStructuresPreservedFromEarlierFetch: false,
          indexStructureProvenance: {
            dataQuality: "unavailable",
            source: "none",
            preservedFromEarlierFetch: false,
            tradingDate: indexStructureTradingDate(snapshot.tradingDate || payload.tradingDate) || null,
            complete: false,
            reason: "legacy_slope5_window_rejected",
          },
        },
      },
    };
  } catch {
    return payload;
  }
}

function normalizeHotStocksFallbackResponse(payload, errorMessage = "", options = {}) {
  if (!payload || typeof payload !== "object") return null;

  let basisResolution;
  try {
    basisResolution = resolveCanonicalClosingDecisionBasis(payload);
  } catch (_) {
    // Preserve the fallback normalizer's non-throwing contract for hostile or
    // partially migrated payloads. The existing migration path below will
    // strip unsafe fields and fail closed where required.
    basisResolution = {
      status: "current_observation",
      usable: true,
      payload,
      basis: null,
    };
  }
  let canonicalPayload = basisResolution.status === "frozen_closing"
    ? basisResolution.payload
    : basisResolution.status === "unavailable"
      ? failClosedDecisionBasisPayload(payload, basisResolution)
      : payload;
  canonicalPayload = invalidateLegacyFiveDayIndexStructures(canonicalPayload);
  if (!canonicalPayload.decisionBasis && basisResolution.basis) {
    canonicalPayload.decisionBasis = {
      version: 1,
      status: basisResolution.status,
      ...basisResolution.basis,
      source: "current_same_trading_date_closing_snapshot",
      preopenRanksExcluded: false,
    };
  }

  // A fallback response may come from an older on-disk schema.  Always run it
  // through the canonical migration before it can reach /api/hot-stocks.  Keep
  // source timestamps intact: servedAt describes this response, while
  // fetchedAt/updatedAt/asOf must continue to describe the cached snapshot.
  const sourceTimes = {
    fetchedAt: canonicalPayload.fetchedAt,
    updatedAt: canonicalPayload.updatedAt,
    asOf: canonicalPayload.asOf,
  };
  const responsePayload = options.stamp === false
    ? canonicalPayload
    : stampPayloadBase(canonicalPayload, errorMessage, options);
  const normalized = normalizeLeadershipPayload(responsePayload);
  if (!normalized || typeof normalized !== "object") return normalized;
  for (const key of ["fetchedAt", "updatedAt", "asOf"]) {
    if (sourceTimes[key] !== undefined) normalized[key] = sourceTimes[key];
  }
  return normalized;
}

function stampPayload(payload, errorMessage = "", options = {}) {
  return normalizeHotStocksFallbackResponse(payload, errorMessage, { ...options, stamp: true });
}

function marketPrefix(secCode) {















  if (secCode.startsWith("SH")) return `1.${secCode.slice(2)}`;















  if (secCode.startsWith("SZ")) return `0.${secCode.slice(2)}`;















  if (secCode.startsWith("6")) return `1.${secCode}`;















  return `0.${secCode}`;















}































function normalizeCode(raw) {















  return String(raw || "").replace(/^SH|^SZ/i, "");















}































function boardName(code) {















  if (code.startsWith("688") || code.startsWith("689")) return "科创板";















  if (code.startsWith("300") || code.startsWith("301")) return "创业板";















  if (code.startsWith("8") || code.startsWith("4")) return "北交所";















  return "主板";















}































function clamp(value, min, max) {















  return Math.max(min, Math.min(max, value));















}































function moneyYi(value) {















  return Math.round((Number(value || 0) / 100000000) * 10) / 10;















}































function sinaAmountYi(rawAmount) {















  return Math.round((Number(rawAmount || 0) / 100000) * 100) / 100;















}































// push2 行情集群风控封禁时的同API镜像：延迟集群15分钟，盘前/盘后复盘等价















// （2026-07-05 实测：push2 对本机 IP TLS 层重置，node/curl/浏览器全挂，push2delay 正常）















const HOST_FALLBACKS = { "push2.eastmoney.com": "push2delay.eastmoney.com" };































async function fetchJson(url, options = {}) {

  // A primary host and its mirror must consume one caller-owned budget. Without
  // a shared deadline each retry can silently restart the full timeout.
  const configuredTimeoutMs = Math.max(100, Number(options.timeoutMs) || DATA_SOURCE_TIMEOUT_MS);
  const inheritedDeadlineAt = Number(options.deadlineAt);
  options = {
    ...options,
    deadlineAt: Number.isFinite(inheritedDeadlineAt) && inheritedDeadlineAt > 0
      ? inheritedDeadlineAt
      : Date.now() + configuredTimeoutMs,
  };















  try {















    return await fetchJsonDirect(url, options);















  } catch (error) {















    for (const [host, mirror] of Object.entries(HOST_FALLBACKS)) {















      if (url.includes(`//${host}/`)) {















        try {















          return await fetchJsonDirect(url.replace(`//${host}/`, `//${mirror}/`), options);















        } catch {}















      }















    }















    throw error;















  }















}































function fetchDeadlineError(url, cause) {
  const error = new Error(`${url} exceeded the shared fetch deadline`);
  error.code = "FETCH_DEADLINE_EXCEEDED";
  if (cause !== undefined) error.cause = cause;
  return error;
}

function promiseWithinDeadline(factory, remainingMs, onTimeout, url = "request") {
  if (!(remainingMs > 0)) return Promise.reject(fetchDeadlineError(url));
  let timer;
  return Promise.race([
    Promise.resolve().then(factory),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        try { if (typeof onTimeout === "function") onTimeout(); } catch (_) {}
        reject(fetchDeadlineError(url));
      }, remainingMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function fetchJsonDirect(url, options = {}) {
  const configuredTimeoutMs = Math.max(100, Number(options.timeoutMs) || DATA_SOURCE_TIMEOUT_MS);
  const requestedDeadlineAt = Number(options.deadlineAt);
  const deadlineAt = Number.isFinite(requestedDeadlineAt) && requestedDeadlineAt > 0
    ? requestedDeadlineAt
    : Date.now() + configuredTimeoutMs;
  const remainingMs = () => Math.max(0, deadlineAt - Date.now());
  const fetchImpl = typeof options._fetchImpl === "function" ? options._fetchImpl : fetch;
  const execFileImpl = typeof options._execFileAsync === "function" ? options._execFileAsync : execFileAsync;
  const {
    timeoutMs: _timeoutMs,
    deadlineAt: _deadlineAt,
    _fetchImpl,
    _execFileAsync,
    signal: externalSignal,
    ...requestOptions
  } = options;

  if (externalSignal && externalSignal.aborted) {
    throw externalSignal.reason || new Error("request aborted");
  }

  const controller = new AbortController();
  const abortFromExternal = () => controller.abort(externalSignal && externalSignal.reason);
  if (externalSignal) externalSignal.addEventListener("abort", abortFromExternal, { once: true });

  let nativeError;
  try {
    return await promiseWithinDeadline(async () => {
      const response = await fetchImpl(url, {
        ...requestOptions,
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/json,text/plain,*/*",
          ...(requestOptions.headers || {}),
        },
      });
      if (!response.ok) throw new Error(`${url} ${response.status}`);
      // Keep the deadline active through body consumption and JSON parsing.
      return await response.json();
    }, remainingMs(), () => controller.abort(), url);
  } catch (error) {
    nativeError = error;
  } finally {
    if (externalSignal) externalSignal.removeEventListener("abort", abortFromExternal);
  }

  if (externalSignal && externalSignal.aborted) {
    throw externalSignal.reason || nativeError;
  }
  const curlRemainingMs = remainingMs();
  if (!(curlRemainingMs > 0) || (nativeError && nativeError.code === "FETCH_DEADLINE_EXCEEDED")) {
    throw fetchDeadlineError(url, nativeError);
  }

  const curlTimeoutSeconds = Math.max(0.1, curlRemainingMs / 1000).toFixed(3);
  const curlArgs = [
    "-sSL",
    "--noproxy",
    "*",
    "--ssl-no-revoke",
    "--connect-timeout",
    curlTimeoutSeconds,
    "--max-time",
    curlTimeoutSeconds,
  ];
  if (options.method) curlArgs.push("-X", options.method);
  for (const [key, value] of Object.entries(options.headers || {})) {
    curlArgs.push("-H", `${key}: ${value}`);
  }
  if (options.body !== undefined) {
    curlArgs.push("--data-binary", typeof options.body === "string" ? options.body : JSON.stringify(options.body));
  }
  curlArgs.push(url);

  try {
    const curlBin = process.platform === "win32" ? "curl.exe" : "curl";
    const { stdout } = await promiseWithinDeadline(
      () => execFileImpl(curlBin, curlArgs, {
        env: {
          ...process.env,
          HTTP_PROXY: "",
          HTTPS_PROXY: "",
          http_proxy: "",
          https_proxy: "",
          ALL_PROXY: "",
          all_proxy: "",
          NO_PROXY: "",
          no_proxy: "",
        },
        windowsHide: process.platform === "win32",
        maxBuffer: 20 * 1024 * 1024,
        timeout: Math.max(1, remainingMs()),
      }),
      remainingMs(),
      null,
      url,
    );
    return JSON.parse(stdout);
  } catch (curlError) {
    if (!(remainingMs() > 0) || (curlError && curlError.code === "FETCH_DEADLINE_EXCEEDED")) {
      throw fetchDeadlineError(url, nativeError || curlError);
    }
    throw nativeError;
  }
}

async function fetchText(url, options = {}) {















  const response = await fetch(url, {















    ...options,















    headers: {















      "User-Agent": "Mozilla/5.0",















      Accept: "text/plain,*/*",















      ...(options.headers || {}),















    },















  });































  if (!response.ok) {















    throw new Error(`${url} ${response.status}`);















  }































  return response.text();















}































async function fetchAkshareMarketSnapshot() {















  try {















    const script = `















import json















import sys















import akshare as ak































df = ak.stock_zh_a_spot_em()















if df is None or df.empty:















    print(json.dumps({"ok": False}))















    sys.exit(0)































code_col = "代码" if "代码" in df.columns else None















name_col = "名称" if "名称" in df.columns else None















amount_col = "成交额" if "成交额" in df.columns else None















change_col = "涨跌幅" if "涨跌幅" in df.columns else None















up_col = "上涨家数" if "上涨家数" in df.columns else None















down_col = "下跌家数" if "下跌家数" in df.columns else None















flat_col = "平盘家数" if "平盘家数" in df.columns else None































def row(code):















    if code_col is None:















        return None















    hit = df[df[code_col].astype(str) == code]















    if hit.empty:















        return None















    return hit.iloc[0]































def to_float(v):















    try:















        return float(v)















    except Exception:















        return 0.0































rows = []















for code in ["000001", "399001", "399006", "899001", "000688"]:















    hit = row(code)















    if hit is None:















        continue















    rows.append({















        "code": code,















        "name": str(hit[name_col]) if name_col else code,















        "price": to_float(hit["最新价"]) if "最新价" in hit else 0,















        "changePct": to_float(hit[change_col]) if change_col else 0,















        "amountYi": round(to_float(hit[amount_col]) / 100000000, 2) if amount_col else 0,















        "up": int(to_float(hit[up_col])) if up_col else 0,















        "down": int(to_float(hit[down_col])) if down_col else 0,















        "flat": int(to_float(hit[flat_col])) if flat_col else 0,















    })































print(json.dumps({"ok": True, "rows": rows}, ensure_ascii=False))















`;































    const { stdout } = await execFileAsync("python", ["-c", script], {















      windowsHide: true,















      maxBuffer: 20 * 1024 * 1024,















      env: {















        ...process.env,















        PYTHONIOENCODING: "utf-8",















      },















    });















    const parsed = JSON.parse(stdout);















    if (!parsed.ok) return null;















    const rows = parsed.rows || [];















    if (!rows.length) return null;















    const indexes = rows.map((item) => ({















      code: item.code,















      name: item.name,















      price: Number(item.price || 0),















      changePct: Number(item.changePct || 0),















      amountYi: Number(item.amountYi || 0),















      up: Number(item.up || 0),















      down: Number(item.down || 0),















      flat: Number(item.flat || 0),















    }));















    const sh = indexes.find((item) => item.code === "000001") || {};















    const sz = indexes.find((item) => item.code === "399001") || {};















    const cy = indexes.find((item) => item.code === "399006") || {};















    const bj = indexes.find((item) => item.code === "899001") || {};















    const kc = indexes.find((item) => item.code === "000688") || {};















    const upCount = indexes.reduce((sum, item) => sum + Number(item.up || 0), 0);















    const downCount = indexes.reduce((sum, item) => sum + Number(item.down || 0), 0);















    return {















      indexes,















      shszAmountYi: Math.round((Number(sh.amountYi || 0) + Number(sz.amountYi || 0) + Number(bj.amountYi || 0)) * 100) / 100,















      totalAmountYi: Math.round(indexes.reduce((sum, item) => sum + Number(item.amountYi || 0), 0) * 100) / 100,















      upCount,















      downCount,















      breadth: upCount + downCount ? upCount / (upCount + downCount) : 0.5,















      avgIndexChange: (Number(sh.changePct || 0) + Number(sz.changePct || 0) + Number(cy.changePct || 0)) / 3,















      kechuangChange: Number(kc.changePct || 0),















      source: "akshare",















    };















  } catch {















    return null;















  }















}































async function fetchEastmoneyRank() {















  try {















    const payload = {















      appId: "appId01",















      globalId: "786e4c21-70dc-435a-93bb-38",















      marketType: "",















      pageNo: 1,















      pageSize: HOT_RANK_TARGET,















    };































    const result = await fetchJson("https://emappdata.eastmoney.com/stockrank/getAllCurrentList", {















      method: "POST",















      body: JSON.stringify(payload),















      headers: {















        "Content-Type": "application/json",















        Referer: "https://guba.eastmoney.com/",















      },















    });































    const rows = canonicalHotRankRows((result.data || []).slice(0, HOT_RANK_TARGET).map((item) => ({















      code: normalizeCode(item.sc),















      secCode: item.sc,















      eastRank: Number(item.rk),















      eastRankChange: Number(item.hisRc || 0),















    })), "eastmoney");
    return { rows, fetchedAt: new Date().toISOString(), error: null };






























  } catch (error) {















    return { rows: [], fetchedAt: new Date().toISOString(), error: String(error && error.message || error || "eastmoney-rank-fetch-failed") };
  }















}































async function fetchEastmoneyQuotes(rankRows) {















  try {















    if (!rankRows.length) return new Map();































    const secids = rankRows.map((item) => marketPrefix(item.secCode || item.code)).filter(Boolean).join(",");















    const fields = "f12,f14,f2,f3,f6,f8,f10,f15,f16,f17,f18,f20,f21,f62";















    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${fields}&secids=${secids}`;















    const result = await fetchJson(url, {















      headers: { Referer: "https://quote.eastmoney.com/" },















    });































    return new Map(















      ((result.data && result.data.diff) || []).map((item) => [















        normalizeCode(item.f12),















        {















          name: item.f14,















          price: Number(item.f2),

          high: Number(item.f15),

          low: Number(item.f16),

          open: Number(item.f17),















          changePct: Number(item.f3),















          amountYi: moneyYi(item.f6),















          turnoverRate: Number(item.f8),















          volumeRatio: Number(item.f10),















          // 昨收:isLimitUp 按板块规则(主板10%/20cm 20%/ST 5%/北交所30%)推算涨停价。















          // ⚠️不要喂 f51:ulist 口径下 f51 不是涨停价(是金额类字段),喂了会让涨停永远判不出















          prevClose: Number(item.f18),















          totalMarketValue: Number(item.f20),















          floatMarketValue: Number(item.f21),















          floatMktCapYi: moneyYi(item.f21), // 流通市值(亿),hardGate 换手率分档用































          mainInflowYi: moneyYi(item.f62),















        },















      ]),















    );















  } catch {















    return new Map();















  }















}































async function fetchEastmoneyAshareRows() {















  const rows = [];















  const pageSize = 5000;















  let pageNo = 1;















  let total = Infinity;































  while (rows.length < total) {















    const url =















      "https://push2.eastmoney.com/api/qt/clist/get?ut=13697a1cc677c8bfa9a496437bfef419&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:0+t:81,m:1+t:23,m:0+t:86&pn=" +















      pageNo +















      "&pz=" +















      pageSize +















      "&po=1&fid=f6&fltt=2&invt=2&fields=f1,f152,f12,f13,f14,f2,f3,f4,f5,f6&wbp2u=0|0|0|0|web";































    const result = await fetchJson(url, {















      headers: { Referer: "https://stock.eastmoney.com/shichang.html" },















    });































    const diff = Object.values((result.data && result.data.diff) || {}).map((item) => ({















      code: item.f12,















      name: item.f14,















      amountRaw: Number(item.f6 || 0),















      changePct: Number(item.f3 || 0),















      market: classifyAshareMarket(String(item.f12 || ""), Number(item.f13 || 0)),















    }));































    rows.push(...diff);















    total = Number((result.data && result.data.total) || diff.length || 0);















    if (!diff.length || pageNo * pageSize >= total) break;















    pageNo += 1;















  }































  return rows;















}































function classifyAshareMarket(code, marketFlag = 0) {















  if (marketFlag === 1 || code.startsWith("6")) return "sh";















  if (code.startsWith("300") || code.startsWith("301")) return "cyb";















  if (code.startsWith("8") || code.startsWith("4") || code.startsWith("92")) return "sz";















  return "sz";















}































function countBreadthByMarket(rows) {















  const result = {















    sh: { up: 0, down: 0, flat: 0 },















    sz: { up: 0, down: 0, flat: 0 },















    cyb: { up: 0, down: 0, flat: 0 },















  };































  for (const row of rows || []) {















    const market = row.market || classifyAshareMarket(String(row.code || ""), row.marketFlag || 0);















    const bucket = result[market];















    if (!bucket) continue;















    const change = Number(row.changePct || 0);















    if (change > 0) bucket.up += 1;















    else if (change < 0) bucket.down += 1;















    else bucket.flat += 1;















  }































  return result;















}































function countTotalBreadth(rows) {















  let up = 0;















  let down = 0;















  let flat = 0;















  for (const row of rows || []) {















    const change = Number(row.changePct || 0);















    if (change > 0) up += 1;















    else if (change < 0) down += 1;















    else flat += 1;















  }















  return { up, down, flat };















}































async function fetchEastmoneyMarketOverview() {















  try {















    let snapshot = loadEastmoneySnapshotFallback();















    if (!snapshot || !snapshot.shszAmountYi) {















      snapshot = await refreshEastmoneySnapshot();















    }















    if (!snapshot || !snapshot.shszAmountYi) return null;















    let marketBreadth = null;















    try {















      const rows = await fetchEastmoneyAshareRows();















      const breadth = countBreadthByMarket(rows);















      const total = countTotalBreadth(rows);















      const shTotal = breadth.sh.up + breadth.sh.down;















      const szTotal = breadth.sz.up + breadth.sz.down;















      const cybTotal = breadth.cyb.up + breadth.cyb.down;















      marketBreadth = {















        sh: {















          up: breadth.sh.up,















          down: breadth.sh.down,















          flat: breadth.sh.flat,















          ratio: shTotal ? roundNumber((breadth.sh.up / shTotal) * 100, 2) : 0,















        },















        sz: {















          up: breadth.sz.up,















          down: breadth.sz.down,















          flat: breadth.sz.flat,















          ratio: szTotal ? roundNumber((breadth.sz.up / szTotal) * 100, 2) : 0,















        },















        cyb: {















          up: breadth.cyb.up,















          down: breadth.cyb.down,















          flat: breadth.cyb.flat,















          ratio: cybTotal ? roundNumber((breadth.cyb.up / cybTotal) * 100, 2) : 0,















        },















      };















      snapshot = {















        ...snapshot,















        upCount: total.up,















        downCount: total.down,















        flatCount: total.flat,















        breadth: total.up + total.down ? total.up / (total.up + total.down) : Number(snapshot.breadth || 0.5),















      };















      try {















        writeRetainedJson(eastmoneySnapshotFile, snapshot, { archiveDir: eastmoneySnapshotArchiveDir });















      } catch {}















    } catch {}















    const payload = {















      indexes: [],















      shszAmountYi: Number(snapshot.shszAmountYi || 0),















      totalAmountYi: Number(snapshot.totalAmountYi || snapshot.shszAmountYi || 0),















      upCount: Number(snapshot.upCount || 0),















      downCount: Number(snapshot.downCount || 0),















      breadth: Number(snapshot.breadth || 0.5),















      avgIndexChange: 0,















      kechuangChange: 0,















      source: snapshot.source || "eastmoney-dom",















    };















    if (marketBreadth) {















      payload.marketBreadth = marketBreadth;















    }















    return payload;















  } catch {















    return null;















  }















}































function parseSinaMarketLines(text) {















  const nameMap = {















    s_sh000001: "上证指数",















    s_sz399001: "深证成指",















    s_sz399006: "创业板指",















    s_sh000688: "科创50",















    s_sz000688: "科创50",















  };































  const quotes = [];















  const pattern = /var hq_str_([^=]+)="([^"]*)";?/g;















  let match;































  while ((match = pattern.exec(text))) {















    const code = match[1];















    const parts = match[2].split(",");















    const price = Number(parts[1] || 0);















    const change = Number(parts[2] || 0);















    const changePct = Number(parts[3] || 0);















    const amountRaw = Number(parts[5] || 0);































    quotes.push({















      code,















      name: nameMap[code] || code,















      price,















      changePct,















      amountYi: sinaAmountYi(amountRaw),















      volumeRaw: Number(parts[4] || 0),















    });















  }































  return quotes;















}































function estimateBreadthFromIndexes(indexes) {















  const positive = indexes.filter((item) => Number(item.changePct || 0) > 0).length;















  const negative = indexes.filter((item) => Number(item.changePct || 0) < 0).length;















  const flat = Math.max(0, indexes.length - positive - negative);















  const base = 5000;















  const upCount = Math.max(0, Math.round(base * (positive / Math.max(1, indexes.length))));















  const downCount = Math.max(0, Math.round(base * (negative / Math.max(1, indexes.length))));















  return { upCount, downCount, flat };















}































function parseKlineRows(result) {















  return ((result.data && result.data.klines) || []).map((line) => {















    const [date, open, close, high, low, volume, amount, amplitude, changePct, change, turnover] = line.split(",");















    return {















      date,















      open: Number(open),















      close: Number(close),















      high: Number(high),















      low: Number(low),















      amount: Number(amount),















      changePct: Number(changePct),















      turnover: Number(turnover),















    };















  });















}































// K线来源默认统计槽：并发请求（realtime/回测/红线卡）共用会互相污染，















// 需要精确计数的调用方（如 fetchStatus）必须传自己的局部 stats 对象















function createKlineSourceStats() {
  return {
    requested: 0,
    east: 0,
    tencent: 0,
    cached: 0,
    sameDayCache: 0,
    liveAccepted: 0,
    liveDateMismatch: 0,
    staleCacheRejected: 0,
    unavailable: 0,
    fail: 0,
    eastAttempts: 0,
    tencentAttempts: 0,
    tencentHttpAttempts: 0,
    tencentRetrySuccess: 0,
    tencentRaw: 0,
    tencentRawAttempts: 0,
    tencentQfqFallbacks: 0,
    eastFailures: 0,
    tencentFailures: 0,
    eastConsecutiveFailures: 0,
    tencentConsecutiveFailures: 0,
    eastSkipped: 0,
    tencentSkipped: 0,
    sourceErrorSamples: [],
    cacheTradingDates: {},
    cacheAgeMinutes: [],
    deadlineAt: null,
    deadlineExceeded: false,
  };
}

function summarizeKlineProfileScope(rows, aggregateStats = {}) {
  const items = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const codes = new Set(items.map((item) => String(item.code || item.secCode || "")).filter(Boolean));
  const summary = createKlineSourceStats();
  summary.requested = items.length;
  items.forEach((item) => {
    const profile = item.klineProfile && typeof item.klineProfile === "object" ? item.klineProfile : null;
    const lineage = item.klineProfileLineage && typeof item.klineProfileLineage === "object"
      ? item.klineProfileLineage
      : profile && profile.dataLineage && typeof profile.dataLineage === "object"
        ? profile.dataLineage : {};
    const mode = String(lineage.mode || "").toLowerCase();
    const source = String(lineage.source || profile && profile.dataLineage && profile.dataLineage.source || "").toLowerCase();
    if (profile) {
      const cached = item.klineProfileCached === true || mode === "same_day_cache";
      if (cached) {
        summary.cached += 1;
        summary.sameDayCache += 1;
        const tradingDate = normalizeTradingDate(lineage.tradingDate || profile.lastTradingDate);
        if (tradingDate) summary.cacheTradingDates[tradingDate] = Number(summary.cacheTradingDates[tradingDate] || 0) + 1;
        const age = Number(lineage.cacheAgeMinutes);
        if (Number.isFinite(age)) summary.cacheAgeMinutes.push(age);
      } else {
        summary.liveAccepted += 1;
        if (source.includes("east")) summary.east += 1;
        else if (source.includes("tencent")) summary.tencent += 1;
      }
    } else {
      summary.unavailable += 1;
      summary.profileFailures = Number(summary.profileFailures || 0) + 1;
    }
    if (lineage.liveFetchFailed === true) summary.fail += 1;
    if (mode.includes("stale_cache_rejected") || mode.includes("future_cache_rejected")) {
      summary.staleCacheRejected += 1;
    }
    if (mode.includes("date_mismatch")) summary.liveDateMismatch += 1;
  });
  summary.sourceErrorSamples = (Array.isArray(aggregateStats.sourceErrorSamples)
    ? aggregateStats.sourceErrorSamples : []).filter((entry) => codes.has(String(entry && entry.code || ""))).slice(0, 12);
  summary.profileErrorSamples = (Array.isArray(aggregateStats.profileErrorSamples)
    ? aggregateStats.profileErrorSamples : []).filter((entry) => codes.has(String(entry && entry.code || ""))).slice(0, 12);
  return summary;
}

const KLINE_PROFILE_TOTAL_TIMEOUT_MS = Math.max(
  15000,
  Number(process.env.KLINE_PROFILE_TOTAL_TIMEOUT_MS || 35000),
);
const KLINE_PROFILE_CONCURRENCY = Math.max(
  1,
  Math.min(4, Number(process.env.KLINE_PROFILE_CONCURRENCY || 1)),
);
const KLINE_PROFILE_PACING_MS = Math.max(
  0,
  Math.min(250, Number(process.env.KLINE_PROFILE_PACING_MS || 50)),
);

const klineSourceStats = createKlineSourceStats();

function klineCircuitShouldAttempt(stats, source) {
  const state = stats && typeof stats === "object" ? stats : klineSourceStats;
  if (Number.isFinite(Number(state.deadlineAt)) && Number(state.deadlineAt) > 0
    && Date.now() >= Number(state.deadlineAt)) {
    state.deadlineExceeded = true;
    state[`${source}Skipped`] = Number(state[`${source}Skipped`] || 0) + 1;
    return false;
  }
  const disabledKey = `${source}Disabled`;
  if (state[disabledKey] !== true) return true;
  const skippedKey = `${source}Skipped`;
  state[skippedKey] = Number(state[skippedKey] || 0) + 1;
  const probeEvery = source === "tencent" ? 16 : 32;
  return state[skippedKey] % probeEvery === 0;
}

function recordKlineSourceFailure(stats, source, error, stock) {
  const state = stats && typeof stats === "object" ? stats : klineSourceStats;
  const failuresKey = `${source}Failures`;
  const consecutiveKey = `${source}ConsecutiveFailures`;
  state[failuresKey] = Number(state[failuresKey] || 0) + 1;
  state[consecutiveKey] = Number(state[consecutiveKey] || 0) + 1;
  const threshold = source === "tencent" ? 12 : 3;
  if (state[consecutiveKey] >= threshold) state[`${source}Disabled`] = true;
  if (!Array.isArray(state.sourceErrorSamples)) state.sourceErrorSamples = [];
  if (state.sourceErrorSamples.length < 12) {
    state.sourceErrorSamples.push({
      source,
      code: String(stock && (stock.code || stock.secCode) || "") || null,
      errorCode: String(error && error.code || "") || null,
      message: String(error && error.message || error || "unknown").slice(0, 180),
    });
  }
}

function recordKlineSourceSuccess(stats, source) {
  const state = stats && typeof stats === "object" ? stats : klineSourceStats;
  state[source] = Number(state[source] || 0) + 1;
  state[`${source}ConsecutiveFailures`] = 0;
  state[`${source}Disabled`] = false;
}

function attachKlineRowsMeta(rows, meta) {
  const result = Array.isArray(rows) ? rows : [];
  Object.defineProperty(result, "sourceMeta", {
    value: { ...(meta || {}) },
    enumerable: false,
    configurable: true,
  });
  return result;
}































/** 腾讯K线兜底：东财 push2his 被风控封禁时切换（qfq前复权，与东财口径一致）。















 *  腾讯此接口不带成交额，用日均价×成交量估算（误差约1-2%，仅影响5日均额这类粗筛）。 */















async function fetchTencentKlineRowsLegacy(stock, limit = 180) {















  try {















    const secid = marketPrefix(stock.secCode || stock.code); // "0.002747" / "1.600580"















    const [mkt, code] = secid.split(".");















    if (mkt !== "0" && mkt !== "1") return []; // 腾讯接口只覆盖沪深















    const symbol = (mkt === "1" ? "sh" : "sz") + code;















    const result = await fetchJson(















      `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,${limit},qfq`,















      { headers: { Referer: "https://gu.qq.com/" }, timeoutMs: 4000 },















    );















    const node = result.data && result.data[symbol];















    const lines = (node && (node.qfqday || node.day)) || [];















    const rows = lines.map((line) => {















      const [date, open, close, high, low, volume] = line;















      const o = Number(open), c = Number(close), h = Number(high), l = Number(low), v = Number(volume);















      return {















        date,















        open: o, close: c, high: h, low: l,















        amount: v * 100 * ((o + c + h + l) / 4), // 手→股 × 日均价 ≈ 成交额（估算）















        changePct: 0, // 下面按昨收补算















        turnover: 0,  // 腾讯不带换手，回测处有 !day.turnover 缺省保护















      };















    });















    for (let i = 1; i < rows.length; i++) {















      const prev = rows[i - 1].close;















      if (prev > 0) rows[i].changePct = Math.round(((rows[i].close - prev) / prev) * 10000) / 100;















    }















    return rows;















  } catch {















    return [];















  }















}































async function fetchTencentKlineRows(stock, limit = 180, options = {}) {
  const source = stock && typeof stock === "object" ? stock : {};
  const secid = marketPrefix(source.secCode || source.code);
  const [market, code] = String(secid || "").split(".");
  if (!code || !["0", "1"].includes(market)) {
    return attachKlineRowsMeta([], { source: "tencent", status: "unsupported_market" });
  }
  const symbol = `${market === "1" ? "sh" : "sz"}${code}`;
  const fetcher = typeof options._fetchJson === "function" ? options._fetchJson : fetchJson;
  const attempts = Math.max(1, Math.min(3, Number(options.attempts || 2)));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await fetcher(
        `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,${limit},qfq`,
        {
          headers: { Referer: "https://gu.qq.com/" },
          timeoutMs: 5500,
          deadlineAt: Number.isFinite(Number(options.deadlineAt)) ? Number(options.deadlineAt) : undefined,
        },
      );
      const node = result && result.data && result.data[symbol];
      const lines = node && (node.qfqday || node.day);
      const rows = (Array.isArray(lines) ? lines : []).map((line) => {
        const [date, open, close, high, low, volume] = Array.isArray(line) ? line : [];
        const o = Number(open), c = Number(close), h = Number(high), l = Number(low), v = Number(volume);
        if (![o, c, h, l, v].every(Number.isFinite) || !date) return null;
        return {
          date: String(date),
          open: o,
          close: c,
          high: h,
          low: l,
          amount: v * 100 * ((o + c + h + l) / 4),
          changePct: 0,
          turnover: 0,
        };
      }).filter(Boolean);
      for (let index = 1; index < rows.length; index += 1) {
        const previousClose = Number(rows[index - 1].close);
        if (previousClose > 0) {
          rows[index].changePct = Math.round(((rows[index].close - previousClose) / previousClose) * 10000) / 100;
        }
      }
      if (rows.length) {
        return attachKlineRowsMeta(rows, {
          source: "tencent",
          status: attempt > 1 ? "live_retry_success" : "live_success",
          attempt,
          amountEstimated: true,
          priceAdjustment: "qfq",
          trendComparable: true,
          fetchedAt: new Date().toISOString(),
        });
      }
      lastError = Object.assign(new Error("tencent_kline_empty"), { code: "KLINE_EMPTY" });
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      if (Number.isFinite(Number(options.deadlineAt)) && Date.now() >= Number(options.deadlineAt)) break;
      await new Promise((resolve) => setTimeout(resolve, 120 * attempt));
    }
  }
  return attachKlineRowsMeta([], {
    source: "tencent",
    status: "live_failed",
    attempts,
    errorCode: String(lastError && lastError.code || "") || null,
    error: String(lastError && lastError.message || lastError || "tencent_kline_failed").slice(0, 180),
  });
}

async function fetchTencentRawKlineRows(stock, limit = 180, options = {}) {
  const source = stock && typeof stock === "object" ? stock : {};
  const secid = marketPrefix(source.secCode || source.code);
  const [market, code] = String(secid || "").split(".");
  if (!code || !["0", "1"].includes(market)) {
    return attachKlineRowsMeta([], { source: "tencent_raw", status: "unsupported_market" });
  }
  const symbol = `${market === "1" ? "sh" : "sz"}${code}`;
  const fetcher = typeof options._fetchJson === "function" ? options._fetchJson : fetchJson;
  try {
    const result = await fetcher(
      `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${symbol},day,,,${limit}`,
      {
        headers: { Referer: "https://gu.qq.com/" },
        timeoutMs: 5000,
        deadlineAt: Number.isFinite(Number(options.deadlineAt)) ? Number(options.deadlineAt) : undefined,
      },
    );
    const node = result && result.data && result.data[symbol];
    const lines = node && node.day;
    const rows = (Array.isArray(lines) ? lines : []).map((line) => {
      const [date, open, close, high, low, volume] = Array.isArray(line) ? line : [];
      const o = Number(open), c = Number(close), h = Number(high), l = Number(low), v = Number(volume);
      if (![o, c, h, l, v].every(Number.isFinite) || !date) return null;
      return {
        date: String(date),
        open: o,
        close: c,
        high: h,
        low: l,
        amount: v * 100 * ((o + c + h + l) / 4),
        changePct: 0,
        turnover: 0,
      };
    }).filter(Boolean);
    let suspiciousGapCount = 0;
    for (let index = 1; index < rows.length; index += 1) {
      const previousClose = Number(rows[index - 1].close);
      if (previousClose > 0) {
        rows[index].changePct = Math.round(((rows[index].close - previousClose) / previousClose) * 10000) / 100;
        if (Math.abs(rows[index].changePct) > 35) suspiciousGapCount += 1;
      }
    }
    if (!rows.length) throw Object.assign(new Error("tencent_raw_kline_empty"), { code: "KLINE_EMPTY" });
    return attachKlineRowsMeta(rows, {
      source: "tencent_raw",
      status: suspiciousGapCount ? "live_unadjusted_incomparable" : "live_unadjusted_fallback",
      amountEstimated: true,
      priceAdjustment: "none",
      trendComparable: suspiciousGapCount === 0,
      suspiciousGapCount,
      attempt: 1,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return attachKlineRowsMeta([], {
      source: "tencent_raw",
      status: "live_failed",
      attempts: 1,
      errorCode: String(error && error.code || "") || null,
      error: String(error && error.message || error || "tencent_raw_kline_failed").slice(0, 180),
    });
  }
}

async function fetchKlineRowsFreeFallback(stock, limit = 180, stats = klineSourceStats) {















  const secid = marketPrefix(stock.secCode || stock.code);















  const url =















    `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}` +















    `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=${limit}`;































  try {















    if (!klineCircuitShouldAttempt(stats, "east")) {
      throw Object.assign(new Error("eastmoney kline circuit probe pending"), { code: "CIRCUIT_OPEN" });
    }
    stats.eastAttempts = Number(stats.eastAttempts || 0) + 1;

    const result = await fetchJson(url, {
      headers: { Referer: "https://quote.eastmoney.com/" },
      timeoutMs: 5000,
      deadlineAt: Number.isFinite(Number(stats.deadlineAt)) ? Number(stats.deadlineAt) : undefined,
    });















    const rows = parseKlineRows(result);
    if (!rows.length) throw Object.assign(new Error("eastmoney_kline_empty"), { code: "KLINE_EMPTY" });















    if (rows.length) {















      recordKlineSourceSuccess(stats, "east");















      return attachKlineRowsMeta(rows, {
        source: "eastmoney",
        status: "live_success",
        amountEstimated: false,
        fetchedAt: new Date().toISOString(),
      });















    }















  } catch (error) {
    if (!error || error.code !== "CIRCUIT_OPEN") {
      recordKlineSourceFailure(stats, "east", error, stock);
    }
  }































  // 东财K线失败（常见：push2his 风控封禁）→ 腾讯兜底















  let tencentRows = attachKlineRowsMeta([], { source: "tencent", status: "circuit_open" });
  if (klineCircuitShouldAttempt(stats, "tencent")) {
    stats.tencentAttempts = Number(stats.tencentAttempts || 0) + 1;
    if (klineCircuitShouldAttempt(stats, "tencentQfq")) {
      tencentRows = await fetchTencentKlineRows(stock, limit, {
        attempts: 2,
        deadlineAt: stats.deadlineAt,
      });
      const qfqMeta = tencentRows.sourceMeta || {};
      if (tencentRows.length) {
        recordKlineSourceSuccess(stats, "tencentQfq");
      } else {
        recordKlineSourceFailure(
          stats,
          "tencentQfq",
          Object.assign(new Error(qfqMeta.error || "tencent_qfq_kline_failed"), {
            code: qfqMeta.errorCode || "KLINE_FETCH_FAILED",
          }),
          stock,
        );
      }
    } else {
      tencentRows = attachKlineRowsMeta([], {
        source: "tencent",
        status: "qfq_circuit_open",
        attempts: 0,
      });
    }
    let attemptMeta = tencentRows.sourceMeta || {};
    if (!tencentRows.length && Date.now() < Number(stats.deadlineAt || 0)) {
      const primaryFailure = { ...attemptMeta };
      stats.tencentRawAttempts = Number(stats.tencentRawAttempts || 0) + 1;
      const rawRows = await fetchTencentRawKlineRows(stock, limit, {
        deadlineAt: stats.deadlineAt,
      });
      const rawMeta = rawRows.sourceMeta || {};
      if (rawRows.length) {
        stats.tencentRaw = Number(stats.tencentRaw || 0) + 1;
        stats.tencentQfqFallbacks = Number(stats.tencentQfqFallbacks || 0) + 1;
        attachKlineRowsMeta(rawRows, {
          ...rawMeta,
          totalAttempts: Math.max(0, Number(primaryFailure.attempts ?? primaryFailure.attempt ?? 0))
            + Math.max(1, Number(rawMeta.attempts || rawMeta.attempt || 1)),
          primaryFailure: {
            source: primaryFailure.source || "tencent",
            status: primaryFailure.status || "live_failed",
            errorCode: primaryFailure.errorCode || null,
            error: primaryFailure.error || null,
          },
        });
        tencentRows = rawRows;
      } else {
        attachKlineRowsMeta(tencentRows, {
          ...attemptMeta,
          rawFailure: rawMeta.error || "tencent_raw_kline_failed",
          totalAttempts: Math.max(0, Number(attemptMeta.attempts ?? attemptMeta.attempt ?? 0))
            + Math.max(1, Number(rawMeta.attempts || rawMeta.attempt || 1)),
        });
      }
      attemptMeta = tencentRows.sourceMeta || {};
    }
    stats.tencentHttpAttempts = Number(stats.tencentHttpAttempts || 0)
      + Math.max(1, Number(attemptMeta.totalAttempts || attemptMeta.attempt || attemptMeta.attempts || 1));
    if (tencentRows.length && Number(attemptMeta.attempt || 1) > 1) {
      stats.tencentRetrySuccess = Number(stats.tencentRetrySuccess || 0) + 1;
    }
  }















  if (tencentRows.length) recordKlineSourceSuccess(stats, "tencent");















  else {
    const sourceMeta = tencentRows.sourceMeta || {};
    if (sourceMeta.status !== "circuit_open") {
      recordKlineSourceFailure(
        stats,
        "tencent",
        Object.assign(new Error(sourceMeta.error || "tencent_kline_failed"), {
          code: sourceMeta.errorCode || "KLINE_FETCH_FAILED",
        }),
        stock,
      );
    }
    stats.fail = Number(stats.fail || 0) + 1;
  }















  return tencentRows;
}

async function fetchKlineRows(stock, limit = 180, stats = klineSourceStats, options = {}) {
  stats.requested = Number(stats.requested || 0) + 1;
  const registry = options.providerRegistry || getMarketDataProviderRegistry();
  const result = await registry.invoke(DATA_CAPABILITIES.DAILY_KLINE, [stock, limit, stats], {
    observedAt: nowIso(),
  });
  if (result.envelope && result.envelope.usable === true && Array.isArray(result.envelope.data)) {
    return result.envelope.data;
  }
  return attachKlineRowsMeta([], {
    source: "provider-registry",
    status: "unavailable",
    errorCode: "DATA_PROVIDER_CAPABILITY_UNAVAILABLE",
    error: (result.attempts || []).flatMap((attempt) => attempt.reasons || []).join("；").slice(0, 300),
  });
}































function estimateTurnoverFromFloatCap(row, stock, referencePrice) {
  const floatMktCapYi = Number(stock && stock.floatMktCapYi);
  const refPrice = Number(referencePrice || stock && stock.price || row && row.close);
  const amount = Number(row && row.amount);
  const prices = [row && row.open, row && row.close, row && row.high, row && row.low]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  const averagePrice = prices.length
    ? prices.reduce((sum, value) => sum + value, 0) / prices.length
    : null;
  if (!(floatMktCapYi > 0) || !(refPrice > 0) || !(amount > 0) || !(averagePrice > 0)) return null;
  const estimatedFloatShares = floatMktCapYi * 1e8 / refPrice;
  const turnover = amount / (averagePrice * estimatedFloatShares) * 100;
  return Number.isFinite(turnover) && turnover > 0 && turnover <= 300 ? turnover : null;
}

function buildRecentLimitUpEvidence(stock, rows, completedSessionIndex) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const lastIndex = Math.min(Number(completedSessionIndex), sourceRows.length - 1);
  if (!Number.isInteger(lastIndex) || lastIndex < 1) {
    return {
      version: 1,
      verified: false,
      basis: "completed_daily_close",
      sampleSize: Math.max(0, lastIndex + 1),
      window5: { count: 0, dates: [] },
      window10: { count: 0, dates: [] },
      reason: "completed_daily_history_insufficient",
    };
  }

  const datesForWindow = (windowSize) => {
    const firstIndex = Math.max(1, lastIndex - windowSize + 1);
    const dates = [];
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const row = sourceRows[index];
      const previous = sourceRows[index - 1];
      if (!row || !previous) continue;
      if (isLimitUp({
        code: stock && stock.code,
        name: stock && stock.name,
        price: Number(row.close),
        prevClose: Number(previous.close),
      })) {
        dates.push(String(row.date || ""));
      }
    }
    return dates.filter(Boolean);
  };

  const dates5 = datesForWindow(5);
  const dates10 = datesForWindow(10);
  return {
    version: 1,
    verified: true,
    basis: "completed_daily_close",
    completedTradingDate: String(sourceRows[lastIndex] && sourceRows[lastIndex].date || "") || null,
    sampleSize: Math.min(10, lastIndex + 1),
    window5: { count: dates5.length, dates: dates5 },
    window10: { count: dates10.length, dates: dates10 },
  };
}

function classifyKlineWave(input = {}) {
  const rise10 = Number(input.rise10);
  const rise20 = Number(input.rise20);
  if (input.deepHistoricalRepair === true && Number.isFinite(rise20) && rise20 >= 15) {
    return "历史高位深跌修复";
  }
  if (Number.isFinite(rise20) && rise20 >= 35
    && input.nearHigh20 === true && input.currentHighTrendStructure === true) {
    return "三波/高位趋势";
  }
  if (Number.isFinite(rise10) && rise10 >= 15
    && input.nearHigh20 === true && input.volumeBreakout === true
    && input.currentHighTrendStructure === true) {
    return "二波趋势重建";
  }
  if (Number.isFinite(rise20) && rise20 >= 15 && input.waveShortTrendAligned === true) {
    return "趋势一波";
  }
  return "非趋势波段";
}

async function fetchKlineProfile(stock, stats = klineSourceStats) {















  try {















    // 走 fetchKlineRows：东财失败自动切腾讯兜底（风控封禁时K线画像不再全军覆没）















    const rows = await fetchKlineRows(stock, 120, stats);
    const rowSourceMeta = rows && rows.sourceMeta && typeof rows.sourceMeta === "object"
      ? { ...rows.sourceMeta }
      : { source: "unknown", status: "unavailable", amountEstimated: null, fetchedAt: null };































    // 次新股本来就没有完整的 20/60 日K线，不能因为样本不足直接丢掉。
    // 至少 3 个交易日即可建立“换手-成本”画像；老股仍沿用完整均线结构。
    if (rows.length < 3) return null;































    const last = rows[rows.length - 1];















    const prev10 = rows[Math.max(0, rows.length - 11)];















    const prev20 = rows[Math.max(0, rows.length - 21)];















    const prev30 = rows[Math.max(0, rows.length - 31)];















    const high20 = Math.max(...rows.slice(-20).map((item) => item.high));















    const avgAmount5 = rows.slice(-6, -1).reduce((sum, item) => sum + item.amount, 0) / Math.max(1, rows.slice(-6, -1).length);















    const low20 = Math.min(...rows.slice(-20).map((item) => item.low));

    // 龙头交易资格需要观察完整框架，而不只是近20日涨幅。
    // 以下字段全部沿用同一复权K线计算，避免把除权/复权差异误判成破位或暴涨。
    const window60 = rows.slice(-60);
    const window120 = rows.slice(-120);
    const avgClose = (items) => items.length
      ? items.reduce((sum, item) => sum + Number(item.close || 0), 0) / items.length
      : null;
    const weightedClose = (items) => {
      const totalAmount = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      if (!totalAmount) return avgClose(items);
      return items.reduce((sum, item) => sum + Number(item.close || 0) * Number(item.amount || 0), 0) / totalAmount;
    };
    const roundPct = (value) => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
    const tradingDays = rows.length;
    const isNewListing = tradingDays < 60;
    const recentRows = rows.slice(-Math.min(10, tradingDays));
    let exactTurnoverCount = 0;
    let estimatedTurnoverCount = 0;
    const turnoverSeries = recentRows.map((item, index, list) => {
      const raw = Number(item.turnover || 0);
      if (raw > 0) {
        exactTurnoverCount += 1;
        return raw;
      }
      // 腾讯K线没有历史换手：用当前流通市值反推流通股本，再由每日成交额估算换手。
      // 该口径只作为次新筹码交换的兜底，并在数据质量字段中明确标注为估算。
      const estimated = isNewListing
        ? estimateTurnoverFromFloatCap(item, stock, Number(stock && stock.price) || Number(last.close))
        : null;
      if (estimated !== null) {
        estimatedTurnoverCount += 1;
        return estimated;
      }
      if (index === list.length - 1 && Number(stock && stock.turnoverRate) > 0) return Number(stock.turnoverRate);
      return 0;
    });
    const validTurnovers = turnoverSeries.filter((value) => value > 0);
    const recent5Turnovers = turnoverSeries.slice(-Math.min(5, turnoverSeries.length)).filter((value) => value > 0);
    const effectiveTurnover = (values) => values.length
      ? (1 - values.reduce((left, value) => left * (1 - clamp(value / 100, 0, 0.95)), 1)) * 100
      : null;
    const avgTurnover5 = recent5Turnovers.length
      ? recent5Turnovers.reduce((sum, value) => sum + value, 0) / recent5Turnovers.length
      : null;
    const effectiveTurnover5 = effectiveTurnover(recent5Turnovers);
    const effectiveTurnover10 = effectiveTurnover(validTurnovers);
    const recentWeightedCost = weightedClose(recentRows);
    const recentHigh = Math.max(...recentRows.map((item) => Number(item.high || item.close || 0)));
    const recentLow = Math.min(...recentRows.map((item) => Number(item.low || item.close || Infinity)));
    const closeToCostPct = recentWeightedCost
      ? ((Number(last.close || 0) - recentWeightedCost) / recentWeightedCost) * 100
      : null;
    const closePositionPct = recentHigh > recentLow
      ? ((Number(last.close || 0) - recentLow) / (recentHigh - recentLow)) * 100
      : null;
    const ma60 = avgClose(window60);
    const ma120 = avgClose(window120);
    const ma20Frame = avgClose(rows.slice(-20));
    const vwap20 = weightedClose(rows.slice(-20));
    const vwap60 = weightedClose(window60);
    const high120 = Math.max(...window120.map((item) => Number(item.high || item.close || 0)));
    const low120 = Math.min(...window120.map((item) => Number(item.low || item.close || Infinity)));
    const position120Pct = high120 > low120
      ? ((last.close - low120) / (high120 - low120)) * 100
      : null;
    const prior20Rows = rows.slice(-21, -1);
    const prior20Low = prior20Rows.length ? Math.min(...prior20Rows.map((item) => Number(item.low || item.close || Infinity))) : null;
    const structureBreak = Boolean(prior20Low && last.close < prior20Low * 0.98)
      || Boolean(ma60 && ma20Frame && last.close < ma60 * 0.92 && ma20Frame < ma60);
    const last5Amount = rows.slice(-5).reduce((sum, item) => sum + Number(item.amount || 0), 0) / Math.max(1, rows.slice(-5).length);
    const prev5Amount = rows.slice(-10, -5).reduce((sum, item) => sum + Number(item.amount || 0), 0) / Math.max(1, rows.slice(-10, -5).length);
    const amountTrendRatio = prev5Amount ? last5Amount / prev5Amount : null;
    const peakIndex = window120.reduce((bestIndex, item, index, list) => (
      Number(item.high || 0) > Number(list[bestIndex] && list[bestIndex].high || 0) ? index : bestIndex
    ), 0);
    const prePeakRows = window120.slice(Math.max(0, peakIndex - 60), peakIndex + 1);
    const prePeakBase = prePeakRows.length ? Math.min(...prePeakRows.map((item) => Number(item.low || item.close || Infinity))) : null;
    const runupToHighPct = prePeakBase && high120 > prePeakBase ? ((high120 - prePeakBase) / prePeakBase) * 100 : null;
    const retraceOfRunupPct = prePeakBase && high120 > prePeakBase
      ? ((high120 - last.close) / (high120 - prePeakBase)) * 100
      : null;































    const rise10 = prev10 && prev10.close ? ((last.close - prev10.close) / prev10.close) * 100 : 0;















    const rise20 = prev20 && prev20.close ? ((last.close - prev20.close) / prev20.close) * 100 : 0;















    const rise30 = prev30 && prev30.close ? ((last.close - prev30.close) / prev30.close) * 100 : 0;















    const rise2 = rows.length >= 3 && rows[rows.length - 3] && rows[rows.length - 3].close















      ? ((last.close - rows[rows.length - 3].close) / rows[rows.length - 3].close) * 100















      : 0;















    const nearHigh20 = high20 ? last.close >= high20 * 0.96 : false;















    const volumeBreakout = avgAmount5 ? last.amount >= avgAmount5 * 1.45 : false;

    const waveMa5 = avgClose(rows.slice(-5));
    const waveMa10 = avgClose(rows.slice(-10));
    const longHighDistancePct = high120 > 0 ? ((high120 - last.close) / high120) * 100 : null;
    const waveShortTrendAligned = [waveMa5, waveMa10, ma20Frame].every(Number.isFinite)
      && waveMa5 >= waveMa10 && waveMa10 >= ma20Frame && last.close >= ma20Frame;
    const waveMediumTrendSupported = [ma20Frame, ma60].every(Number.isFinite)
      && last.close >= ma60 * 0.98 && ma20Frame >= ma60 * 0.92;
    const waveRetraceShallow = Number.isFinite(retraceOfRunupPct) && retraceOfRunupPct <= 40;
    const waveNearLongHigh = Number.isFinite(longHighDistancePct) && longHighDistancePct <= 18;
    const deepHistoricalRepair = Number.isFinite(longHighDistancePct) && longHighDistancePct > 20
      || Number.isFinite(retraceOfRunupPct) && retraceOfRunupPct > 40
      || Number.isFinite(ma60) && last.close < ma60 * 0.98;
    const currentHighTrendStructure = waveShortTrendAligned
      && waveMediumTrendSupported
      && waveRetraceShallow
      && waveNearLongHigh;















    const pullbackDepth = high20 ? ((high20 - low20) / high20) * 100 : 0;















    const legacyWave = deepHistoricalRepair && rise20 >= 15
      ? "历史高位深跌修复"
      :















      rise20 >= 35 && nearHigh20 && currentHighTrendStructure















        ? "三波/高位趋势"















        : rise10 >= 15 && nearHigh20 && volumeBreakout && currentHighTrendStructure















          ? "二波趋势重建"















          : rise20 >= 15 && last.close > prev20.close && waveShortTrendAligned















            ? "趋势一波"















            : "非趋势波段";
    const wave = classifyKlineWave({
      rise10,
      rise20,
      nearHigh20,
      volumeBreakout,
      currentHighTrendStructure,
      deepHistoricalRepair,
      waveShortTrendAligned,
    });
    void legacyWave;































    // 筹码舒服度：距 60 日前高越近、上方套牢越轻、拉升承接压力越小。创新高=上方无套牢=最舒服。















    const high60 = Math.max(...rows.slice(-60).map((item) => item.high));















    const pctFromHigh = high60 ? Math.round(((high60 - last.close) / high60) * 1000) / 10 : 0;















    const newHigh = high60 ? last.close >= high60 * 0.995 : false;















    const turnoverDataQuality = exactTurnoverCount >= Math.min(3, tradingDays)
      ? "历史换手已验证"
      : estimatedTurnoverCount >= Math.min(3, tradingDays)
        ? "历史换手按流通盘估算"
        : validTurnovers.length
          ? "换手部分验证"
          : "换手待验证";
    const rapidReset = Boolean(
      isNewListing
      && effectiveTurnover5 !== null
      && effectiveTurnover5 >= 70
      && closeToCostPct !== null
      && closeToCostPct >= -3
      && (closePositionPct === null || closePositionPct >= 50)
      && !structureBreak
    );
    const rebuilding = Boolean(
      isNewListing
      && !rapidReset
      && effectiveTurnover5 !== null
      && effectiveTurnover5 >= 45
      && closeToCostPct !== null
      && closeToCostPct >= -5
      && !structureBreak
    );
    // 高换手本身不代表筹码差。只有“高换手 + 跌回近期成交成本下方/弱收盘”才是派发风险。
    const newStockDistributionRisk = Boolean(
      isNewListing
      && effectiveTurnover5 !== null
      && effectiveTurnover5 >= 55
      && (
        (closeToCostPct !== null && closeToCostPct <= -6)
        || (closePositionPct !== null && closePositionPct <= 30)
        || Number(last.changePct || 0) <= -7
        || structureBreak
      )
    );
    const newStockChipState = !isNewListing
      ? null
      : newStockDistributionRisk
        ? "高换手派发风险"
        : rapidReset
          ? "筹码快速重置"
          : rebuilding
            ? "换手重建中"
            : validTurnovers.length
              ? "筹码待交换"
              : "次新筹码待验证";
    const chipComfort = isNewListing
      ? newStockDistributionRisk
        ? "套牢压力"
        : rapidReset
          ? "舒服"
          : "一般"
      : newHigh || pctFromHigh <= 6
        ? "舒服"
        : pctFromHigh <= 18
          ? "一般"
          : "套牢压力";































    const maProfile = computeMaProfile(rows) || {};

    // Keep the most recent *completed* daily session separate from a live
    // intraday K-line row.  The emotion model may use this snapshot before the
    // opening auction has produced a trustworthy quote, so missing live prices
    // must not erase the previous session's price-discovery facts.
    const shanghaiNow = shanghaiClockParts(new Date());
    const lastRowDate = normalizeTradingDate(last && last.date);
    const currentDailyBarStillOpen = Boolean(
      shanghaiNow
      && lastRowDate
      && lastRowDate === shanghaiNow.date
      && (shanghaiNow.hour < 15 || (shanghaiNow.hour === 15 && shanghaiNow.minute < 5)),
    );
    const completedSessionIndex = currentDailyBarStillOpen ? rows.length - 2 : rows.length - 1;
    const completedSession = completedSessionIndex >= 0 ? rows[completedSessionIndex] : null;
    const completedSessionPrevious = completedSessionIndex > 0 ? rows[completedSessionIndex - 1] : null;
    const completedPrevClose = Number(completedSessionPrevious && completedSessionPrevious.close);
    const completedOpen = Number(completedSession && completedSession.open);
    const completedHigh = Number(completedSession && completedSession.high);
    const completedLow = Number(completedSession && completedSession.low);
    const completedClose = Number(completedSession && completedSession.close);
    const completedPct = (price) => (
      Number.isFinite(price) && price > 0 && Number.isFinite(completedPrevClose) && completedPrevClose > 0
        ? Math.round(((price / completedPrevClose) - 1) * 10000) / 100
        : null
    );
    const completedClosedAtLimit = Boolean(
      completedSession
      && isLimitUp({
        code: stock && stock.code,
        name: stock && stock.name,
        price: completedClose,
        prevClose: completedPrevClose,
      }),
    );
    const completedOpenedAtLimit = Boolean(
      completedSession
      && isLimitUp({
        code: stock && stock.code,
        name: stock && stock.name,
        price: completedOpen,
        prevClose: completedPrevClose,
      }),
    );
    const completedLowAtLimit = Boolean(
      completedSession
      && isLimitUp({
        code: stock && stock.code,
        name: stock && stock.name,
        price: completedLow,
        prevClose: completedPrevClose,
      }),
    );
    const completedPrices = [completedOpen, completedHigh, completedLow, completedClose]
      .filter((value) => Number.isFinite(value) && value > 0);
    const completedOneWord = Boolean(
      completedClosedAtLimit
      && completedPrices.length === 4
      && Math.max(...completedPrices) - Math.min(...completedPrices) <= 0.011,
    );
    // Daily OHLC can prove an opening-limit break and close-limit recovery, but
    // cannot prove an intraday "second-level reseal" or count multiple opens.
    const completedResealedAfterOpen = Boolean(
      completedClosedAtLimit && completedOpenedAtLimit && !completedLowAtLimit,
    );
    const recentLimitUp = buildRecentLimitUpEvidence(stock, rows, completedSessionIndex);















    return {















      rise10: Math.round(rise10 * 10) / 10,















      rise20: Math.round(rise20 * 10) / 10,















      rise30: Math.round(rise30 * 10) / 10,















      rise2: Math.round(rise2 * 10) / 10,















      nearHigh20,















      volumeBreakout,















      pullbackDepth: Math.round(pullbackDepth * 10) / 10,















      wave,















      pctFromHigh,















      newHigh,















      chipComfort,
      tradingDays,
      isNewListing,
      turnoverDataQuality,
      avgTurnover5: roundPct(avgTurnover5),
      effectiveTurnover5: roundPct(effectiveTurnover5),
      effectiveTurnover10: roundPct(effectiveTurnover10),
      recentWeightedCost: Number.isFinite(recentWeightedCost) ? Math.round(recentWeightedCost * 100) / 100 : null,
      closeToCostPct: roundPct(closeToCostPct),
      closePositionPct: roundPct(closePositionPct),
      newStockChipState,
      newStockDistributionRisk,















      ma5: maProfile.ma5,















      ma10: maProfile.ma10,















      ma20: maProfile.ma20,

      ma60: Number.isFinite(ma60) ? Math.round(ma60 * 100) / 100 : null,

      ma120: Number.isFinite(ma120) ? Math.round(ma120 * 100) / 100 : null,

      vwap20: Number.isFinite(vwap20) ? Math.round(vwap20 * 100) / 100 : null,

      vwap60: Number.isFinite(vwap60) ? Math.round(vwap60 * 100) / 100 : null,

      high120: Number.isFinite(high120) ? Math.round(high120 * 100) / 100 : null,

      low120: Number.isFinite(low120) ? Math.round(low120 * 100) / 100 : null,

      position120Pct: Number.isFinite(position120Pct) ? Math.round(position120Pct * 10) / 10 : null,

      structureBreak,

      amountTrendRatio: Number.isFinite(amountTrendRatio) ? Math.round(amountTrendRatio * 100) / 100 : null,

      runupToHighPct: Number.isFinite(runupToHighPct) ? Math.round(runupToHighPct * 10) / 10 : null,

      retraceOfRunupPct: Number.isFinite(retraceOfRunupPct) ? Math.round(retraceOfRunupPct * 10) / 10 : null,















      ma5Rising: maProfile.ma5Rising,















      longBearBreak3d: maProfile.longBearBreak3d,















      avgAmount5Yi: Number.isFinite(maProfile.avgAmount5Yi)
        ? maProfile.avgAmount5Yi
        : Math.round((rows.slice(-5).reduce((sum, item) => sum + Number(item.amount || 0), 0) / Math.max(1, rows.slice(-5).length) / 1e8) * 100) / 100,

      recentLimitUp,















      // Preserve the latest completed session so pre-open quote placeholders
      // cannot erase the distinction between one-word boards and traded reseals.
      lastSession: completedSession ? {
        tradingDate: String(completedSession.date || "") || null,
        open: Number.isFinite(completedOpen) ? completedOpen : null,
        high: Number.isFinite(completedHigh) ? completedHigh : null,
        low: Number.isFinite(completedLow) ? completedLow : null,
        close: Number.isFinite(completedClose) ? completedClose : null,
        changePct: completedPct(completedClose)
          ?? (Number.isFinite(Number(completedSession.changePct)) ? Number(completedSession.changePct) : null),
        openChangePct: completedPct(completedOpen),
        currentChangePct: completedPct(completedClose)
          ?? (Number.isFinite(Number(completedSession.changePct)) ? Number(completedSession.changePct) : null),
        maxChangePct: completedPct(completedHigh),
        minChangePct: completedPct(completedLow),
        closedAtLimit: completedClosedAtLimit,
        oneWord: completedOneWord,
        noPriceDiscovery: completedOneWord,
        // Daily OHLC proves whether a limit-open/recovery happened, but not the
        // precise number of opens. Keep the count unknown unless intraday data
        // supplies it; a one-word bar can safely state zero.
        limitOpenCount: completedOneWord ? 0 : null,
        resealedAfterOpen: completedResealedAfterOpen,
        amountYi: Number.isFinite(Number(completedSession.amount))
          ? Math.round(Number(completedSession.amount) / 1e6) / 100
          : null,
        turnoverRate: Number(completedSession.turnover) > 0 ? Number(completedSession.turnover) : null,
        source: rowSourceMeta.source === "eastmoney" ? "eastmoney-kline"
          : /^tencent/.test(String(rowSourceMeta.source || "")) ? "tencent-kline" : "unknown-kline",
        snapshotKind: "closing",
        verified: true,
        completed: true,
      } : null,
      lastTradingDate: String(last && last.date || ""),
      lastClose: Number.isFinite(maProfile.lastClose) ? maProfile.lastClose : Number(last.close || 0),
      dataLineage: {
        version: 1,
        mode: "live",
        source: rowSourceMeta.source || "unknown",
        sourceStatus: rowSourceMeta.status || "unknown",
        amountEstimated: rowSourceMeta.amountEstimated === true,
        priceAdjustment: rowSourceMeta.priceAdjustment || null,
        trendComparable: rowSourceMeta.trendComparable !== false,
        suspiciousGapCount: Number(rowSourceMeta.suspiciousGapCount || 0),
        fetchedAt: rowSourceMeta.fetchedAt || new Date().toISOString(),
        tradingDate: String(completedSession && completedSession.date || last && last.date || "") || null,
        liveFetchFailed: false,
        cacheAccepted: false,
      },















    };















  } catch {















    return null;















  }















}































function prioritizeKlineProfileFetchRows(rows, options = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const cachedProfiles = options.cachedProfiles && typeof options.cachedProfiles === "object"
    ? options.cachedProfiles : {};
  const expectedTradingDate = normalizeTradingDate(options.expectedTradingDate);
  return sourceRows
    .map((stock, originalIndex) => {
      const code = String(stock && (stock.code || stock.secCode) || "");
      const cacheAssessment = assessCachedKlineProfile(cachedProfiles[code], {
        expectedTradingDate,
        now: options.now instanceof Date ? options.now : undefined,
      });
      return {
        stock,
        originalIndex,
        supplemental: stock && stock.previousLimitUpOnly === true,
        sameDayCacheUsable: cacheAssessment.usable === true,
      };
    })
    .sort((left, right) => (
      Number(left.supplemental) - Number(right.supplemental)
      || Number(left.sameDayCacheUsable) - Number(right.sameDayCacheUsable)
      || left.originalIndex - right.originalIndex
    ));
}

async function enrichKlineProfiles(rows, stats = klineSourceStats, options = {}) {
  if (!Number.isFinite(Number(stats.deadlineAt)) || Number(stats.deadlineAt) <= Date.now()) {
    stats.deadlineAt = Date.now() + KLINE_PROFILE_TOTAL_TIMEOUT_MS;
    stats.deadlineExceeded = false;
  }
  const fetchQueue = prioritizeKlineProfileFetchRows(rows, options);















  const chunks = [];















  for (let index = 0; index < fetchQueue.length; index += KLINE_PROFILE_CONCURRENCY) {















    chunks.push(fetchQueue.slice(index, index + KLINE_PROFILE_CONCURRENCY));















  }































  const enriched = [];
  const fetchProfile = typeof options._fetchProfile === "function"
    ? options._fetchProfile : fetchKlineProfile;















  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];















    const profiles = await Promise.all(chunk.map(async (entry) => {
      const stock = entry.stock;
      const profile = await fetchProfile(stock, stats);
      if (!profile) {
        stats.profileFailures = Number(stats.profileFailures || 0) + 1;
        if (!Array.isArray(stats.profileErrorSamples)) stats.profileErrorSamples = [];
        if (stats.profileErrorSamples.length < 12) {
          stats.profileErrorSamples.push({
            code: String(stock && (stock.code || stock.secCode) || "") || null,
            errorCode: "KLINE_PROFILE_UNAVAILABLE",
            message: "实时K线不足以构建画像，等待同交易日缓存质量校验",
          });
        }
      }
      return profile;
    }));















    enriched.push(















      ...chunk.map((entry, index) => ({















        ...entry.stock,















        klineProfile: profiles[index],
        __klineOriginalIndex: entry.originalIndex,















      })),















    );















    // 批次间节流：减少逐票请求突发；总阶段deadline仍限制最坏耗时。















    if (chunkIndex < chunks.length - 1 && KLINE_PROFILE_PACING_MS > 0
      && Date.now() < Number(stats.deadlineAt || 0)) {
      await new Promise((resolve) => setTimeout(resolve, KLINE_PROFILE_PACING_MS));
    }















  }































  return enriched
    .sort((left, right) => left.__klineOriginalIndex - right.__klineOriginalIndex)
    .map(({ __klineOriginalIndex, ...row }) => row);















}































async function fetchThsHotList() {















  try {















    const url =















      "https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock?stock_type=a&type=hour&list_type=normal";















    const result = await fetchJson(url, {















      headers: { Referer: "https://eq.10jqka.com.cn/" },















    });































    const rows = canonicalHotRankRows(((result.data && result.data.stock_list) || []).slice(0, HOT_RANK_TARGET).map((item) => ({















      code: normalizeCode(item.code),















      name: item.name,















      thsRank: Number(item.order),















      heat: Number(item.rate || 0),















      thsRankChange: Number(item.hot_rank_chg || 0),















      changePct: Number(item.rise_and_fall),















      concepts: (item.tag && item.tag.concept_tag) || [],















      popularity: item.tag && item.tag.popularity_tag ? item.tag.popularity_tag : "",















      topic: item.topic && item.topic.title ? item.topic.title : "",















    })), "ths");
    return { rows, fetchedAt: new Date().toISOString(), error: null };






























  } catch (error) {















    return { rows: [], fetchedAt: new Date().toISOString(), error: String(error && error.message || error || "ths-rank-fetch-failed") };
  }















}































// 实时市场快照：用东财指数接口一次拿到「两市成交额 + 涨跌家数 + 各指数涨跌」，















// 全部纯 HTTP、无需本地浏览器。上证综指(1.000001)≈沪市全口径，深证成指(0.399001)≈深市全口径。















function parseHtmlNumber(value) {
  const text = String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/,/g, "")
    .trim();
  const match = text.match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function extractThsDetailValue(html, label) {
  const escaped = String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(html || "").match(new RegExp(`<dt>\\s*${escaped}\\s*<\\/dt>\\s*<dd[^>]*>([\\s\\S]*?)<\\/dd>`, "i"));
  return match ? match[1] : "";
}

async function fetchThsAllAIndexSnapshot() {
  const response = await fetch("http://q.10jqka.com.cn/thshy/detail/code/883421/", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      Referer: "http://q.10jqka.com.cn/",
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`同花顺全A HTTP ${response.status}`);
  const html = new TextDecoder("gb18030").decode(await response.arrayBuffer());
  const currentMatch = html.match(/class=["'][^"']*board-xj[^"']*["'][^>]*>([^<]+)</i);
  const changeMatch = html.match(/class=["']board-zdf["'][^>]*>([\s\S]*?)<\/p>/i);
  const changeNumbers = String(changeMatch && changeMatch[1] || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .match(/[+-]?\d+(?:\.\d+)?/g) || [];
  const breadthHtml = extractThsDetailValue(html, "涨跌家数");
  const breadthNumbers = breadthHtml.match(/\d+(?:\.\d+)?/g) || [];
  const price = parseHtmlNumber(currentMatch && currentMatch[1]);
  const change = changeNumbers.length ? Number(changeNumbers[0]) : null;
  const changePct = changeNumbers.length > 1 ? Number(changeNumbers[1]) : null;
  const upCount = breadthNumbers.length ? Number(breadthNumbers[0]) : null;
  const downCount = breadthNumbers.length > 1 ? Number(breadthNumbers[1]) : null;
  if (!Number.isFinite(price) || !Number.isFinite(changePct)) throw new Error("同花顺全A字段解析失败");
  return {
    code: "883421",
    name: "同花顺全A(沪深)",
    price,
    change: Number.isFinite(change) ? change : null,
    changePct,
    open: parseHtmlNumber(extractThsDetailValue(html, "今开")),
    prevClose: parseHtmlNumber(extractThsDetailValue(html, "昨收")),
    low: parseHtmlNumber(extractThsDetailValue(html, "最低")),
    high: parseHtmlNumber(extractThsDetailValue(html, "最高")),
    upCount: Number.isFinite(upCount) ? upCount : null,
    downCount: Number.isFinite(downCount) ? downCount : null,
    breadth: Number.isFinite(upCount) && Number.isFinite(downCount) && upCount + downCount > 0
      ? upCount / (upCount + downCount)
      : null,
    netFlowYi: parseHtmlNumber(extractThsDetailValue(html, "资金净流入(亿)")),
    amountYi: parseHtmlNumber(extractThsDetailValue(html, "成交额(亿)")),
    source: "ths-public-page",
    asOf: new Date().toISOString(),
  };
}

function movingAverageAt(rows, endExclusive, size) {
  const start = Math.max(0, endExclusive - size);
  const values = rows.slice(start, endExclusive).map((item) => Number(item.close)).filter(Number.isFinite);
  return values.length === size ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function movingAverageSlopeAt(rows, endExclusive, size, lag = 1) {
  const current = movingAverageAt(rows, endExclusive, size);
  const previous = movingAverageAt(rows, Math.max(0, endExclusive - lag), size);
  return Number.isFinite(current) && Number.isFinite(previous) && previous !== 0
    ? ((current - previous) / previous) * 100
    : null;
}

const INDEX_STRUCTURE_TARGET_CODES = ["000001", "399001", "399006", "000688"];
const INDEX_STRUCTURE_REQUIRED_NUMBERS = [
  "close", "ma5", "ma10", "ma20", "ma30", "ma60", "slope5", "slope10", "slope20",
];

function hasCanonicalFiveDaySlope(row) {
  return Number(row && row.shortStructureWindowDays) === 5
    && Number(row && row.slope5LagDays) === 1;
}

function indexStructureTradingDate(value) {
  const match = String(value || "").match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function trustedIndexStructureSource(row) {
  const source = String(row && row.source || "").toLowerCase();
  return source === "tencent-kline"
    || source === "tencent-raw-kline"
    || source === "cache:tencent-kline"
    || source === "cache:tencent-raw-kline"
    || source === "archive:tencent-kline"
    || source === "archive:tencent-raw-kline";
}

function completeTrustedIndexStructures(rows, tradingDate) {
  const targetDate = indexStructureTradingDate(tradingDate);
  if (!targetDate || !Array.isArray(rows)) return null;
  const byCode = new Map(rows.map((row) => [String(row && row.code || ""), row]));
  const normalized = [];
  for (const code of INDEX_STRUCTURE_TARGET_CODES) {
    const row = byCode.get(code);
    if (!row || !trustedIndexStructureSource(row)) return null;
    if (!hasCanonicalFiveDaySlope(row)) return null;
    if (indexStructureTradingDate(row.date || row.tradingDate) !== targetDate) return null;
    if (!INDEX_STRUCTURE_REQUIRED_NUMBERS.every((field) => row[field] !== null
      && row[field] !== undefined
      && row[field] !== ""
      && Number.isFinite(Number(row[field])))) return null;
    normalized.push({ ...row, code, date: targetDate });
  }
  return normalized;
}

function applyLiveIndexQuotes(structures, liveIndexes) {
  const quoteMap = new Map((Array.isArray(liveIndexes) ? liveIndexes : [])
    .map((row) => [String(row && row.code || ""), row]));
  return structures.map((row) => {
    const quote = quoteMap.get(String(row.code || "")) || {};
    const livePrice = Number(quote.price);
    const liveChangePct = Number(quote.changePct);
    return {
      ...row,
      ...(Number.isFinite(livePrice) && livePrice > 0 ? { close: livePrice } : {}),
      ...(Number.isFinite(liveChangePct) ? { changePct: liveChangePct } : {}),
    };
  });
}

function resolveIndexMarketStructures(options = {}) {
  const fetchedStructures = Array.isArray(options.fetchedStructures) ? options.fetchedStructures : [];
  const inferredDate = fetchedStructures.length
    ? indexStructureTradingDate(fetchedStructures[0] && (fetchedStructures[0].date || fetchedStructures[0].tradingDate))
    : "";
  const tradingDate = indexStructureTradingDate(options.tradingDate) || inferredDate;
  const liveIndexes = Array.isArray(options.liveIndexes) ? options.liveIndexes : [];
  const fresh = completeTrustedIndexStructures(fetchedStructures, tradingDate);
  if (fresh) {
    const freshSource = String(fresh[0] && fresh[0].source || "tencent-kline").replace(/^(cache|archive):/, "");
    return {
      indexStructures: applyLiveIndexQuotes(fresh, liveIndexes).map((row) => ({
        ...row,
        source: freshSource,
        originSource: freshSource,
        dataQuality: "live_verified",
        preservedFromEarlierFetch: false,
      })),
      dataQuality: { status: "live_verified", tradingDate, complete: true },
      source: freshSource,
      preservedFromEarlierFetch: false,
    };
  }

  const retained = (Array.isArray(options.retainedSnapshots) ? options.retainedSnapshots : [])
    .map((item, order) => ({
      ...item,
      order,
      time: Date.parse(item && (item.capturedAt || item.snapshot && item.snapshot.updatedAt) || ""),
    }))
    .sort((a, b) => (Number.isFinite(b.time) ? b.time : 0) - (Number.isFinite(a.time) ? a.time : 0) || b.order - a.order);
  for (const item of retained) {
    const snapshot = item && item.snapshot && typeof item.snapshot === "object" ? item.snapshot : null;
    const complete = completeTrustedIndexStructures(snapshot && snapshot.indexStructures, tradingDate);
    if (!complete) continue;
    const kind = item.kind === "archive" ? "archive" : "cache";
    const baseSource = String(complete[0] && (complete[0].originSource || complete[0].source) || "tencent-kline")
      .replace(/^(cache|archive):/, "");
    const source = `${kind}:${baseSource}`;
    return {
      indexStructures: applyLiveIndexQuotes(complete, liveIndexes).map((row) => ({
        ...row,
        source,
        originSource: baseSource,
        dataQuality: "same_day_preserved",
        preservedFromEarlierFetch: true,
      })),
      dataQuality: { status: "same_day_preserved", tradingDate, complete: true },
      source,
      preservedFromEarlierFetch: true,
    };
  }

  return {
    indexStructures: [],
    dataQuality: { status: "unavailable", tradingDate: tradingDate || null, complete: false },
    source: "none",
    preservedFromEarlierFetch: false,
  };
}

function loadRetainedIndexStructureSnapshots() {
  const retained = [];
  const current = readJsonFile(eastmoneySnapshotFile);
  if (current) {
    retained.push({ kind: "cache", capturedAt: current.updatedAt || current.asOf || null, snapshot: current });
  }
  if (!fs.existsSync(eastmoneySnapshotArchiveDir)) return retained;
  for (const entry of fs.readdirSync(eastmoneySnapshotArchiveDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(eastmoneySnapshotArchiveDir, entry.name);
    const snapshot = readJsonFile(filePath);
    if (!snapshot) continue;
    let capturedAt = snapshot.updatedAt || snapshot.asOf || null;
    if (!capturedAt) {
      try { capturedAt = fs.statSync(filePath).mtime.toISOString(); } catch {}
    }
    retained.push({ kind: "archive", capturedAt, snapshot });
  }
  return retained;
}

async function fetchIndexMarketStructures(indexes = []) {
  const quoteMap = new Map((Array.isArray(indexes) ? indexes : []).map((item) => [String(item.code || ""), item]));
  const targets = [
    { code: "000001", secCode: "SH000001", name: "上证指数" },
    { code: "399001", secCode: "SZ399001", name: "深证成指" },
    { code: "399006", secCode: "SZ399006", name: "创业板指" },
    { code: "000688", secCode: "SH000688", name: "科创50" },
  ];
  const results = await Promise.allSettled(targets.map(async (target) => {
    let rows = await fetchTencentKlineRows(target, 90);
    if (!rows.length) {
      const rawRows = await fetchTencentRawKlineRows(target, 90);
      const rawMeta = rawRows && rawRows.sourceMeta || {};
      if (rawRows.length && rawMeta.trendComparable === true) rows = rawRows;
    }
    if (!rows.length) return null;
    const rowSourceMeta = rows.sourceMeta || {};
    const indexSource = rowSourceMeta.source === "tencent_raw"
      ? "tencent-raw-kline"
      : "tencent-kline";
    const quote = quoteMap.get(target.code) || {};
    const lastIndex = rows.length - 1;
    const last = { ...rows[lastIndex] };
    if (Number(quote.price) > 0) last.close = Number(quote.price);
    if (Number.isFinite(Number(quote.changePct))) last.changePct = Number(quote.changePct);
    const normalizedRows = rows.slice();
    normalizedRows[lastIndex] = last;
    const end = normalizedRows.length;
    const ma5 = movingAverageAt(normalizedRows, end, 5);
    const ma10 = movingAverageAt(normalizedRows, end, 10);
    const ma20 = movingAverageAt(normalizedRows, end, 20);
    const ma30 = movingAverageAt(normalizedRows, end, 30);
    const ma60 = movingAverageAt(normalizedRows, end, 60);
    // MA5斜率按相邻交易日比较，保证“5日结构”对短线节奏及时响应；
    // 跨日确认仍由市场周期状态机负责，不能用放慢斜率窗口替代滞回。
    const previousMa10 = movingAverageAt(normalizedRows, Math.max(0, end - 5), 10);
    const previousMa20 = movingAverageAt(normalizedRows, Math.max(0, end - 5), 20);
    const pctSlope = (current, previous) => Number.isFinite(current) && Number.isFinite(previous) && previous !== 0
      ? ((current - previous) / previous) * 100
      : null;
    const slope5 = movingAverageSlopeAt(normalizedRows, end, 5, 1);
    const slope10 = pctSlope(ma10, previousMa10);
    const slope20 = pctSlope(ma20, previousMa20);
    const close = Number(last.close || 0);
    const lows20 = normalizedRows.slice(-20).map((item) => Number(item.low || item.close)).filter(Number.isFinite);
    const low20 = lows20.length ? Math.min(...lows20) : null;
    const distance20dLowPct = low20 && close ? ((close - low20) / low20) * 100 : null;
    let trendKey = "sideways";
    let trendLabel = "区间震荡";
    if (ma20 && ma10 && ma5 && close >= ma20 && ma5 >= ma10 && ma10 >= ma20 && (slope10 === null || slope10 >= 0)) {
      trendKey = "uptrend";
      trendLabel = "站上20日线且短中期均线向上";
    } else if (ma20 && ma5 && close >= ma5 && close < ma20 && slope5 !== null && slope5 > 0) {
      trendKey = "repair";
      trendLabel = "仍在20日线下，但5日线转强修复";
    } else if (ma20 && close >= ma20 && ma30 && close < ma30 && (slope5 || 0) > 0) {
      trendKey = "repair";
      trendLabel = "已收复20日线，仍在中期压力下修复";
    } else if (ma20 && close < ma20 && (slope20 || 0) < 0) {
      if (distance20dLowPct !== null && distance20dLowPct <= 5 && (slope5 || 0) >= 0) {
        trendKey = "bottoming";
        trendLabel = "下降结构低位止跌/筑底";
      } else {
        trendKey = "downtrend";
        trendLabel = "20日线下方且中期趋势仍向下";
      }
    }
    return {
      code: target.code,
      name: target.name,
      date: last.date || null,
      close: roundNumber(close, 2),
      changePct: roundNumber(Number(last.changePct || 0), 2),
      ma5: roundNumber(ma5, 2),
      ma10: roundNumber(ma10, 2),
      ma20: roundNumber(ma20, 2),
      ma30: roundNumber(ma30, 2),
      ma60: roundNumber(ma60, 2),
      slope5: roundNumber(slope5, 2),
      slope5LagDays: 1,
      shortStructureWindowDays: 5,
      slope10: roundNumber(slope10, 2),
      slope20: roundNumber(slope20, 2),
      distance20dLowPct: roundNumber(distance20dLowPct, 2),
      trendKey,
      trendLabel,
      source: indexSource,
      originSource: indexSource,
      priceAdjustment: rowSourceMeta.priceAdjustment || "qfq",
      dataQuality: "live_verified",
      preservedFromEarlierFetch: false,
    };
  }));
  return results.map((result) => result.status === "fulfilled" ? result.value : null).filter(Boolean);
}

async function refreshFrozenFiveDayIndexStructures(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const market = source.market && typeof source.market === "object" ? source.market : {};
  const snapshot = market.snapshot && typeof market.snapshot === "object" ? market.snapshot : {};
  const tradingDate = indexStructureTradingDate(
    source.tradingDate
    || source.generationContext && source.generationContext.tradingDate
    || snapshot.tradingDate
    || market.limitStats && market.limitStats.dates && market.limitStats.dates.today,
  );
  try {
    const fetchedStructures = await fetchIndexMarketStructures(snapshot.indexes);
    const resolved = resolveIndexMarketStructures({
      tradingDate,
      fetchedStructures,
      liveIndexes: snapshot.indexes,
      retainedSnapshots: [],
    });
    const refreshed = resolved.indexStructures.length === INDEX_STRUCTURE_TARGET_CODES.length;
    return {
      payload: {
        ...source,
        market: {
          ...market,
          snapshot: {
            ...snapshot,
            tradingDate: tradingDate || snapshot.tradingDate || null,
            indexStructures: refreshed ? resolved.indexStructures : [],
            indexStructuresDataQuality: resolved.dataQuality,
            indexStructuresSource: resolved.source,
            indexStructuresPreservedFromEarlierFetch: resolved.preservedFromEarlierFetch,
            indexStructureProvenance: {
              dataQuality: resolved.dataQuality.status,
              source: resolved.source,
              preservedFromEarlierFetch: resolved.preservedFromEarlierFetch,
              tradingDate: resolved.dataQuality.tradingDate,
              complete: resolved.dataQuality.complete,
              slope5LagDays: refreshed ? 1 : null,
              shortStructureWindowDays: refreshed ? 5 : null,
            },
          },
        },
      },
      diagnostics: {
        version: 1,
        status: refreshed ? "refreshed" : "unavailable",
        tradingDate: tradingDate || null,
        source: resolved.source,
        slope5LagDays: refreshed ? 1 : null,
        shortStructureWindowDays: refreshed ? 5 : null,
        observedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      payload: invalidateLegacyFiveDayIndexStructures(source),
      diagnostics: {
        version: 1,
        status: "unavailable",
        tradingDate: tradingDate || null,
        source: "none",
        slope5LagDays: null,
        shortStructureWindowDays: null,
        observedAt: new Date().toISOString(),
        error: String(error && error.message || error),
      },
    };
  }
}

async function fetchEastmoneyIndexSnapshot() {















  const url =















    "https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f12,f14,f2,f3,f6,f104,f105,f106,f124&secids=1.000001,0.399001,0.399006,1.000688";















  const result = await fetchJson(url, { headers: { Referer: "https://quote.eastmoney.com/" } });















  const diff = Object.values((result.data && result.data.diff) || {});















  if (!diff.length) return null;































  const indexes = [];















  const by = {};
  const quoteEpochSeconds = [];















  for (const item of diff) {















    const code = String(item.f12 || "");
    const quoteEpoch = Number(item.f124 || 0);
    if (Number.isFinite(quoteEpoch) && quoteEpoch > 0) quoteEpochSeconds.push(quoteEpoch > 1e12 ? quoteEpoch / 1000 : quoteEpoch);















    by[code] = {















      changePct: Number(item.f3 || 0),















      amountYi: Number(item.f6 || 0) / 1e8,















      up: Number(item.f104 || 0),















      down: Number(item.f105 || 0),















      flat: Number(item.f106 || 0),















    };















    indexes.push({















      code,















      name: item.f14,















      price: Number(item.f2 || 0),















      changePct: Number(item.f3 || 0),















      amountYi: roundNumber(Number(item.f6 || 0) / 1e8, 2),















    });















  }































  const sh = by["000001"]; // 沪市（含科创）















  const sz = by["399001"]; // 深市（含创业板）















  const cyb = by["399006"]; // 创业板















  const kc = by["000688"]; // 科创50
  const quoteClock = quoteEpochSeconds.length
    ? shanghaiClockParts(new Date(Math.max(...quoteEpochSeconds) * 1000))
    : null;
  const quoteTradingDate = quoteClock ? quoteClock.date : "";















  if (!sh || !sz || !(sh.amountYi + sz.amountYi > 0)) return null;































  const upCount = (sh.up || 0) + (sz.up || 0);















  const downCount = (sh.down || 0) + (sz.down || 0);















  const flatCount = (sh.flat || 0) + (sz.flat || 0);















  const shszAmountYi = roundNumber(sh.amountYi + sz.amountYi, 2);































  const mk = (up, down, flat) => {















    const t = up + down;















    return { up, down, flat, ratio: t ? roundNumber((up / t) * 100, 2) : 0 };















  };















  // 深主板 = 深市全口径 − 创业板















  const szMainUp = Math.max(0, (sz.up || 0) - (cyb ? cyb.up || 0 : 0));















  const szMainDown = Math.max(0, (sz.down || 0) - (cyb ? cyb.down || 0 : 0));















  const szMainFlat = Math.max(0, (sz.flat || 0) - (cyb ? cyb.flat || 0 : 0));































  const changes = [sh.changePct, sz.changePct, cyb ? cyb.changePct : null].filter(















    (v) => v !== null && Number.isFinite(v),















  );















  const avgIndexChange = changes.length















    ? roundNumber(changes.reduce((a, b) => a + b, 0) / changes.length, 2)















    : 0;































  return {















    indexes,















    shszAmountYi,















    totalAmountYi: shszAmountYi,















    upCount,















    downCount,















    flatCount,















    breadth: upCount + downCount ? upCount / (upCount + downCount) : 0.5,















    avgIndexChange,















    kechuangChange: kc ? roundNumber(kc.changePct, 2) : 0,
    ...(await (async () => {
      const [allAResult, structuresResult] = await Promise.allSettled([
        fetchThsAllAIndexSnapshot(),
        fetchIndexMarketStructures(indexes),
      ]);
      const fetchedStructures = structuresResult.status === "fulfilled" ? structuresResult.value : [];
      const fetchedTradingDate = quoteTradingDate
        || indexStructureTradingDate(fetchedStructures[0] && fetchedStructures[0].date);
      const fetchedComplete = completeTrustedIndexStructures(fetchedStructures, fetchedTradingDate);
      const resolvedStructures = resolveIndexMarketStructures({
        tradingDate: fetchedTradingDate,
        fetchedStructures,
        liveIndexes: indexes,
        retainedSnapshots: fetchedComplete ? [] : loadRetainedIndexStructureSnapshots(),
      });
      return {
        allA: allAResult.status === "fulfilled" ? allAResult.value : null,
        tradingDate: resolvedStructures.dataQuality.tradingDate || quoteTradingDate || null,
        indexStructures: resolvedStructures.indexStructures,
        indexStructuresDataQuality: resolvedStructures.dataQuality,
        indexStructuresSource: resolvedStructures.source,
        indexStructuresPreservedFromEarlierFetch: resolvedStructures.preservedFromEarlierFetch,
        indexStructureProvenance: {
          dataQuality: resolvedStructures.dataQuality.status,
          source: resolvedStructures.source,
          preservedFromEarlierFetch: resolvedStructures.preservedFromEarlierFetch,
          tradingDate: resolvedStructures.dataQuality.tradingDate,
          complete: resolvedStructures.dataQuality.complete,
        },
      };
    })()),















    source: "eastmoney-live",















    marketBreadth: {















      sh: mk(sh.up || 0, sh.down || 0, sh.flat || 0),















      sz: mk(szMainUp, szMainDown, szMainFlat),















      cyb: mk(cyb ? cyb.up || 0 : 0, cyb ? cyb.down || 0 : 0, cyb ? cyb.flat || 0 : 0),















    },















  };















}































async function fetchMarketSnapshot() {















  const zeroSnapshot = {















    indexes: [],















    shszAmountYi: 0,















    totalAmountYi: 0,















    upCount: null,















    downCount: null,















    flatCount: null,















    breadth: 0.5,















    avgIndexChange: 0,















    kechuangChange: 0,















    source: "none",















  };































  // 实时优先：直接抓当下行情















  try {















    const live = await fetchEastmoneyIndexSnapshot();















    if (live && live.shszAmountYi > 0) {















      try {















        writeRetainedJson(eastmoneySnapshotFile, { ...live, updatedAt: new Date().toISOString() }, { archiveDir: eastmoneySnapshotArchiveDir });















      } catch {}















      return { ...live, asOf: new Date().toISOString() };















    }















  } catch {}































  // 兜底：实时失败时才用本地缓存 / 旧概览















  try {















    const snapshot = loadEastmoneySnapshotFallback();















    if (snapshot && Number(snapshot.shszAmountYi || 0) > 0) {















      return {















        indexes: snapshot.indexes || [],















        shszAmountYi: Number(snapshot.shszAmountYi || 0),















        totalAmountYi: Number(snapshot.totalAmountYi || snapshot.shszAmountYi || 0),















        upCount: Number(snapshot.upCount || 0),















        downCount: Number(snapshot.downCount || 0),















        flatCount: Number(snapshot.flatCount || 0),















        breadth: Number(snapshot.breadth || 0.5),















        avgIndexChange: Number(snapshot.avgIndexChange || 0),















        kechuangChange: Number(snapshot.kechuangChange || 0),
        allA: snapshot.allA && typeof snapshot.allA === "object" ? snapshot.allA : null,
        indexStructures: Array.isArray(snapshot.indexStructures) ? snapshot.indexStructures : [],















        // 缓存回退必须改写来源标记——缓存文件里存的 "eastmoney-live" 是写入时的标记，















        // 原样带出会冒充实时（33101.07亿假"实时"事故的根源），必须打上 cache: 前缀















        source: `cache:${snapshot.source || "snapshot"}`,















        asOf: snapshot.updatedAt || null, // 缓存数据必须带上时间，前端要提示"可能过时"















        ...(snapshot.marketBreadth ? { marketBreadth: snapshot.marketBreadth } : {}),















      };















    }































    const marketOverview = await fetchEastmoneyMarketOverview();















    if (marketOverview && marketOverview.shszAmountYi > 0) {















      return marketOverview;















    }















  } catch {}































  return zeroSnapshot;















}































async function fetchExternalSnapshot() {















  const url =















    "https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f12,f14,f2,f3&secids=100.DJIA,100.NDX,100.SPX,100.HSI,100.N225,100.SOX"; // SOX=费半,news-digest 外围风向用































  try {















    const result = await fetchJson(url, { headers: { Referer: "https://quote.eastmoney.com/" } });















    const indexes = ((result.data && result.data.diff) || []).map((item) => ({















      code: item.f12,















      name: item.f14,















      price: Number(item.f2),















      changePct: Number(item.f3),















    }));















    return { available: true, indexes };















  } catch (error) {















    return { available: false, indexes: [], error: error.message };















  }















}































function analyzeNewsRisk(thsRows, globalNews = []) {















  const negativeKeywords = [















    "战争",















    "冲突",















    "制裁",















    "关税",















    "加息",















    "降级",















    "暴跌",















    "危机",















    "地缘",















    "停火破裂",















    "袭击",















    "动乱",















  ];















  const positiveKeywords = ["降息", "刺激", "利好", "回购", "增持", "政策支持", "突破", "合作"];















  const texts = thsRows















    .flatMap((item) => [item.topic, item.popularity, ...(item.concepts || [])])















    .filter(Boolean)















    .map(String);















  const joined = texts.join(" ");















  // 热榜话题:出现即命中;7×24快讯:同词≥2条标题才命中(关税/地缘类词几乎天天见报,单条=噪音)















  const newsNegative = newsKeywordHits(globalNews, negativeKeywords);















  const newsPositive = newsKeywordHits(globalNews, positiveKeywords);















  const negativeHits = [...new Set([...negativeKeywords.filter((word) => joined.includes(word)), ...newsNegative])];















  const positiveHits = [...new Set([...positiveKeywords.filter((word) => joined.includes(word)), ...newsPositive])];















  const score = clamp(negativeHits.length * 12 - positiveHits.length * 6, 0, 40);































  return {















    score,















    negativeHits,















    positiveHits,















    newsCount: globalNews.length,















    sample: [...globalNews.slice(0, 6).map((n) => n.title), ...texts.slice(0, 6)],















  };















}































function assessExternalRisk(externalSnapshot, newsRisk) {















  const indexes = externalSnapshot.indexes || [];















  const hsi = indexes.find((item) => item.code === "HSI");















  const ndx = indexes.find((item) => item.code === "NDX");















  const spx = indexes.find((item) => item.code === "SPX");















  const n225 = indexes.find((item) => item.code === "N225");















  const reasons = [];















  let risk = 0;































  for (const item of [hsi, ndx, spx, n225].filter(Boolean)) {















    if (item.changePct <= -1.5) {















      risk += 18;















      reasons.push(`${item.name}跌${Math.abs(item.changePct)}%`);















    } else if (item.changePct <= -0.8) {















      risk += 10;















      reasons.push(`${item.name}偏弱`);















    } else if (item.changePct >= 1) {















      risk -= 5;















    }















  }































  if (newsRisk.score > 0) {















    risk += newsRisk.score;















    reasons.push(`消息风险关键词：${newsRisk.negativeHits.join("、") || "无明显关键词"}`);















  }































  risk = clamp(risk, 0, 100);















  const level = risk >= 60 ? "高风险" : risk >= 32 ? "中风险" : "低风险";















  const penalty = risk >= 60 ? 18 : risk >= 32 ? 10 : risk >= 18 ? 5 : 0;































  return {















    level,















    risk,















    penalty,















    reasons: reasons.length ? reasons : ["外部环境未见明显系统性压力"],















    indexes,















    newsRisk,















    available: externalSnapshot.available,















  };















}































async function buildUsFramework(externalRisk) {















  const indexes = (externalRisk && externalRisk.indexes) || [];















  const ndx = indexes.find((item) => item.code === "NDX");















  const spx = indexes.find((item) => item.code === "SPX");















  const djia = indexes.find((item) => item.code === "DJIA");















  const sox = indexes.find((item) => item.code === "SOX");















  const techWatchlist = [

    { secid: "177.000660", symbol: "000660", name: "SK海力士", market: "韩国", theme: "存储芯片 / HBM" },

    { secid: "177.005930", symbol: "005930", name: "三星电子", market: "韩国", theme: "存储芯片 / 半导体" },

    { secid: "176.2760", symbol: "2760", name: "东京电子设备", market: "日本", theme: "半导体设备" },

    { secid: "176.6857", symbol: "6857", name: "爱德万测试", market: "日本", theme: "半导体设备 / 测试" },

    { secid: "106.TSM", symbol: "TSM", name: "台积电", market: "美国", theme: "晶圆代工 / AI芯片" },















    { symbol: "MU", name: "美光科技", theme: "存储芯片 / AI算力" },















    { symbol: "SNDK", name: "闪迪", theme: "存储芯片 / AI算力" },















    { symbol: "NVDA", name: "英伟达", theme: "AI算力 / GPU" },















    { symbol: "AMD", name: "超威半导体", theme: "AI算力 / CPU-GPU" },















    { symbol: "AVGO", name: "博通", theme: "AI算力 / 网络芯片" },















    { symbol: "ASML", name: "阿斯麦", theme: "半导体设备" },















    { symbol: "ARM", name: "Arm Holdings plc ADR", theme: "AI芯片架构" },















    { symbol: "MRVL", name: "迈威尔科技", theme: "AI算力 / 数据中心" },















    { symbol: "LRCX", name: "拉姆研究", theme: "半导体设备" },















    { symbol: "AMAT", name: "应用材料", theme: "半导体设备" },















    { symbol: "KLAC", name: "科磊", theme: "半导体设备" },















    { symbol: "WDC", name: "西部数据", theme: "存储芯片" },















    { symbol: "QCOM", name: "高通", theme: "AI终端 / 芯片" },















    { symbol: "NXPI", name: "恩智浦半导体", theme: "汽车芯片 / 半导体" },















    { symbol: "INTC", name: "英特尔", theme: "CPU / 半导体" },















    { symbol: "TXN", name: "德州仪器", theme: "模拟芯片" },















    { symbol: "CRUS", name: "凌云半导体", theme: "音频 / 芯片" },















  ];































  const normalizeUsPrice = (raw) => {















    const n = Number(raw || 0);















    if (!Number.isFinite(n) || n <= 0) return 0;















    return n > 1000 ? roundNumber(n / 10000, 2) : roundNumber(n, 2);















  };































  let techQuotes = [];















  try {















    const secids = techWatchlist.map((item) => item.secid || `105.${item.symbol}`).join(",");















    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f12,f14,f2,f3&secids=${secids}`;















    const result = await fetchJson(url, { headers: { Referer: "https://quote.eastmoney.com/" } });















    const diff = ((result.data && result.data.diff) || []).map((item) => ({















      symbol: String(item.f12 || "").trim(),















      name: item.f14 || String(item.f12 || ""),















      rawPrice: Number(item.f2 || 0),















      changePct: roundNumber(Number(item.f3 || 0), 2),















    }));















    const bySymbol = new Map(diff.map((item) => [item.symbol, item]));















    techQuotes = techWatchlist















      .map((item) => {















        const quote = bySymbol.get(item.symbol);















        if (!quote) return { ...item, market: item.market || "美国", price: null, changePct: null, quoteAvailable: false };
        const price = item.market && item.market !== "美国"
          ? roundNumber(quote.rawPrice, 2)
          : normalizeUsPrice(quote.rawPrice);
        return { ...item, ...quote, market: item.market || "美国", price, rawPrice: undefined, quoteAvailable: true };















      })















      .filter(Boolean);















  } catch {}































  if (!techQuotes.length) {
    techQuotes = techWatchlist.map((item) => ({
      ...item,
      market: item.market || "美国",
      price: null,
      changePct: null,
      quoteAvailable: false,
    }));
  }

  const entries = [















    { code: "NDX", name: "纳指", item: ndx, weight: 0.4, role: "科技风险偏好" },















    { code: "SOX", name: "费半", item: sox, weight: 0.3, role: "AI算力 / 半导体" },















    { code: "SPX", name: "标普", item: spx, weight: 0.2, role: "大盘广度" },















    { code: "DJIA", name: "道指", item: djia, weight: 0.1, role: "权重承接" },















  ].filter((entry) => entry.item);































  if (!entries.length) {















    return {















      available: false,















      level: "等待抓取",















      headline: "暂无美股指数数据",















      subline: "这里会单独看美股四大指数，专门判断对 A 股次日开盘和风格偏好的影响。",















      expectation: "等待抓取",















      openBias: "等待抓取",















      styleBias: "等待抓取",















      signals: [],















      reasons: [],















      indexes: [],















      techQuotes: [],

      coreAlert: {
        active: false,
        thresholdPct: -5,
        monitoredCount: 0,
        items: [],
        note: "仅页面提醒，不参与周期、评分、选股或买卖决策",
      },















    };















  }































  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0) || 1;















  const weightedChange = entries.reduce((sum, entry) => sum + Number(entry.item.changePct || 0) * entry.weight, 0) / totalWeight;















  const techChange =















    ((ndx ? Number(ndx.changePct || 0) * 0.6 : 0) + (sox ? Number(sox.changePct || 0) * 0.4 : 0)) /















    Math.max(0.0001, (ndx ? 0.6 : 0) + (sox ? 0.4 : 0) || 1);















  const broadChange =















    ((spx ? Number(spx.changePct || 0) * 0.6 : 0) + (djia ? Number(djia.changePct || 0) * 0.4 : 0)) /















    Math.max(0.0001, (spx ? 0.6 : 0) + (djia ? 0.4 : 0) || 1);































  const changeCount = entries.reduce(















    (acc, entry) => {















      const value = Number(entry.item.changePct || 0);















      if (value > 0) acc.up += 1;















      else if (value < 0) acc.down += 1;















      else acc.flat += 1;















      return acc;















    },















    { up: 0, down: 0, flat: 0 },















  );































  const strongTech = ndx && sox && Number(ndx.changePct || 0) > 0.8 && Number(sox.changePct || 0) > 0.8;















  const techLead = Number(techChange || 0) >= Number(broadChange || 0) + 0.35;















  const broadLead = Number(broadChange || 0) > Number(techChange || 0) + 0.35;































  let level = "中性";















  let expectation = "平开观察";















  let openBias = "平开";















  let styleBias = "题材轮动";















  const reasons = [];































  if (weightedChange >= 1.2) {















    level = "偏强";















    expectation = "高开偏强";















    openBias = "高开";















  } else if (weightedChange >= 0.5) {















    level = "温和偏强";















    expectation = "高开后观察承接";















    openBias = "高开";















  } else if (weightedChange <= -1.2) {















    level = "偏弱";















    expectation = "低开承压";















    openBias = "低开";















  } else if (weightedChange <= -0.5) {















    level = "温和偏弱";















    expectation = "平开偏弱";















    openBias = "低开/平开";















  }































  if (strongTech || techLead) {















    styleBias = "AI算力 / 半导体";















    reasons.push("纳指和费半更强，说明外盘风险偏好更偏科技");















  } else if (broadLead) {















    styleBias = "权重 / 防守";















    reasons.push("标普和道指相对更稳，外盘更像权重托底而不是纯科技扩散");















  } else {















    styleBias = "均衡轮动";















    reasons.push("科技和权重都没有明显单边压制，A股更像分化轮动");















  }































  if (Number(ndx?.changePct || 0) > 0.8) reasons.push(`纳指${roundNumber(ndx.changePct, 2)}%，风险偏好在抬头`);















  if (Number(sox?.changePct || 0) > 0.8) reasons.push(`费半${roundNumber(sox.changePct, 2)}%，对 AI 算力 / 半导体更友好`);















  if (Number(spx?.changePct || 0) < 0) reasons.push(`标普${roundNumber(spx.changePct, 2)}%，说明广度还没完全同步`);















  if (Number(djia?.changePct || 0) > 0.8) reasons.push(`道指${roundNumber(djia.changePct, 2)}%，权重端承接不差`);































  const headline = `美股框架判断：${level}，对 A 股次日更偏${expectation}`;















  const subline = "这里单独看外盘对 A 股开盘和风格的影响，不替代 A 股自身周期判断。";















  const signals = [















    `外盘结论：${level}`,















    `A股预期：${expectation}`,















    `开盘倾向：${openBias}`,















    `风格偏好：${styleBias}`,















  ];

  const coreAlertItems = techQuotes
    .filter((item) => Number(item.changePct) <= -5)
    .map((item) => ({
      symbol: item.symbol,
      name: item.name,
      market: item.market || "美国",
      theme: item.theme,
      price: Number(item.price || 0),
      changePct: roundNumber(Number(item.changePct || 0), 2),
    }));
  const coreAlert = {
    active: coreAlertItems.length > 0,
    thresholdPct: -5,
    monitoredCount: techWatchlist.length,
    items: coreAlertItems,
    note: "仅页面提醒，不参与周期、评分、选股或买卖决策",
  };































  return {















    available: true,















    level,















    headline,















    subline,















    expectation,















    openBias,















    styleBias,















    signals,















    reasons,















    indexes: entries.map((entry) => ({















      code: entry.code,















      name: entry.name,















      role: entry.role,















      price: Number(entry.item.price || 0),















      changePct: Number(entry.item.changePct || 0),















    })),















    techQuotes,

    coreAlert,















    stats: {















      weightedChange: roundNumber(weightedChange, 2),















      techChange: roundNumber(techChange, 2),















      broadChange: roundNumber(broadChange, 2),















      up: changeCount.up,















      down: changeCount.down,















      flat: changeCount.flat,















    },















  };















}































async function fetchEastmoneySectors() {















  try {















    const common = "pn=1&pz=500&po=1&np=1&fltt=2&invt=2&fid=f3&fields=f12,f14,f3,f6,f62";















    const urls = [















      `https://push2.eastmoney.com/api/qt/clist/get?${common}&fs=m:90+t:2`,















      `https://push2.eastmoney.com/api/qt/clist/get?${common}&fs=m:90+t:3`,















    ];































    const results = await Promise.all(















      urls.map((url) => fetchJson(url, { headers: { Referer: "https://quote.eastmoney.com/" } })),















    );































    return results.flatMap((result) =>















      ((result.data && result.data.diff) || []).map((item) => ({















        code: item.f12,















        name: item.f14,















        changePct: Number(item.f3),















        amountYi: moneyYi(item.f6),















        mainInflowYi: moneyYi(item.f62),















      })),















    );















  } catch {















    return [];















  }















}































function normalizeThemeName(name) {















  return String(name || "")















    .replace(/概念|板块|指数|精选|持股|_含一字|昨日|Ⅲ|Ⅱ|Ⅰ|A股/g, "")















    .replace(/[()（）\s]/g, "")















    .toLowerCase();















}































function findSectorMatch(conceptName, sectorRows) {















  const target = normalizeThemeName(conceptName);















  if (!target) return null;































  return (















    sectorRows.find((item) => normalizeThemeName(item.name) === target) ||















    sectorRows.find((item) => {















      const sector = normalizeThemeName(item.name);















      return sector && (target.includes(sector) || sector.includes(target));















    }) ||















    null















  );















}































function classifyMarket(snapshot, hotConcepts, externalRisk, limitStats, options = {}) {
  snapshot = snapshot && typeof snapshot === "object" ? snapshot : {};
  hotConcepts = Array.isArray(hotConcepts) ? hotConcepts : [];
  limitStats = limitStats && typeof limitStats === "object" ? limitStats : {};
  const safeMarketNumber = (value, fallback = 0) => {
    if (value === null || value === undefined || value === "") return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };















  const amount = safeMarketNumber(snapshot.shszAmountYi);















  const breadth = safeMarketNumber(snapshot.breadth);















  const index = safeMarketNumber(snapshot.avgIndexChange);















  const topConcept = hotConcepts[0];















  const directionFocus = topConcept ? safeMarketNumber(topConcept.score) : 0;















  const volumeScore = clamp((amount - 9000) / 9000, 0, 1);















  const breadthScore = clamp((breadth - 0.32) / 0.36, 0, 1);















  const indexScore = clamp((index + 1.2) / 2.4, 0, 1);















  const focusScore = clamp(directionFocus / 140, 0, 1);















  const marketScore = Math.round(















    (volumeScore * 0.3 + breadthScore * 0.25 + indexScore * 0.25 + focusScore * 0.2) * 100,















  ) - (externalRisk ? safeMarketNumber(externalRisk.penalty) : 0);































  // 清晰主线（有龙头有中军）：领涨方向已归类（非“未归类”）、有上榜密度（≥5只）和连板高度（≥3）。















  // 注：板块指数共振(resonance)经常匹配不到，不作硬性要求，否则会把 PCB 这种强主线漏判。















  const clearMainline = Boolean(















    topConcept && topConcept.name !== "未归类" && topConcept.count >= 5 && topConcept.limitCount >= 3,















  );















  // 情绪持续确认：涨停数连续两日站住高位（不是底部刚反弹的单日脉冲），即“市场走稳”















  const heatConfirmed = limitStats















    ? limitStats.ztToday >= 60 && limitStats.ztPrev >= 45 && limitStats.ztToday >= limitStats.ztPrev * 0.8















    : breadth > 0.6;































  let observedCycle = "混沌";















  if (index <= -1.1 && breadth < 0.28) observedCycle = "退潮";















  else if (index < -0.35 && breadth < 0.38) observedCycle = "冰点";















  // 主升 = 主线站稳 + 情绪持续确认 + 大盘不弱 + 扩散足够；只有核心很强但扩散不够时，先按混沌/强回流看















  else if (clearMainline && heatConfirmed && marketScore >= 68 && index > 0 && breadth >= 0.5) observedCycle = "主升";















  else if (clearMainline && heatConfirmed && marketScore >= 68 && index > 0) observedCycle = "混沌";















  // 有人气但主线未确立 = 试错期（底部刚确认、还没走出主线，按混沌处理）















  else if (breadth >= 0.5 && index > -0.2 && !clearMainline) observedCycle = "混沌";















  // 修复只描述当日/小周期改善；大周期仍按混沌保留，等待跨日结构确认。
  else if (index > -0.2 && breadth >= 0.42 && marketScore >= 52) observedCycle = "混沌";















  else if (focusScore >= 0.58 && breadth >= 0.32) observedCycle = "混沌";































  // 五大周期通过显式转移矩阵推进，修复节点不再进入大周期。















  const todayYmd = (limitStats && limitStats.dates && limitStats.dates.today) || dateToYmd(new Date());









  const currentYmd = dateToYmd(new Date());









  const afterClose = currentYmd !== todayYmd ? true : isAfterMarketClose();
  const tradingDates = limitStats && limitStats.dates ? limitStats.dates : {};
  const expectedPrevDate = tradingDates.verified === true ? normalizeCycleYmd(tradingDates.prev) : "";
  const previousArchive = expectedPrevDate
    ? loadPrevArchive(normalizeCycleYmd(todayYmd), { expectedDate: expectedPrevDate, requireExact: true })
    : null;
  const previousDecisionPayload = previousArchive && previousArchive.payload ? previousArchive.payload : null;
  const previousCycleArchive = expectedPrevDate ? loadCycleHistorySnapshot(expectedPrevDate) : null;
  const previousCyclePayload = previousCycleArchive && previousCycleArchive.payload
    ? previousCycleArchive.payload
    : null;
  const previousIndexEnvironment = selectPreviousIndexEnvironment(
    previousCyclePayload,
    previousDecisionPayload,
    expectedPrevDate,
  );
  const previousCycleState = previousCyclePayload && previousCyclePayload.market
    ? previousCyclePayload.market.state || null
    : previousIndexEnvironment && previousDecisionPayload && previousDecisionPayload.market
      ? previousDecisionPayload.market.state || null
      : null;
  const previousObservationPayload = previousCyclePayload || previousDecisionPayload;
  const previousMarket = previousObservationPayload && previousObservationPayload.market
    ? previousObservationPayload.market
    : null;
  const previousPayload = previousDecisionPayload || previousCyclePayload;
  const storedCycleContext = readJsonFile(cycleStateFile) || null;
  const storedTransitionContext = storedCycleContext && storedCycleContext.shockTransition
    ? storedCycleContext.shockTransition
    : null;
  const storedCycleMatchesPreviousDate = Boolean(
    expectedPrevDate
    && normalizeCycleYmd(storedCycleContext && storedCycleContext.date) === expectedPrevDate,
  );
  const previousCycle = previousCycleState
    ? previousCycleState.structuralCycle || previousCycleState.cycle
    : storedCycleMatchesPreviousDate && storedTransitionContext && storedTransitionContext.baseCycle
      ? storedTransitionContext.baseCycle
      : storedCycleMatchesPreviousDate && storedCycleContext
        ? storedCycleContext.structuralCycle || storedCycleContext.cycle
        : null;
  const legacyObservedCycle = observedCycle;
  const marketEffects = analyzeMarketCycleEffects({
    snapshot,
    limitStats,
    previousSnapshot: previousMarket ? previousMarket.snapshot : null,
    previousLimit: previousMarket ? previousMarket.limitStats : null,
    leadership: Array.isArray(options.candidates) ? options.candidates : options.leadership,
    directions: hotConcepts,
  });
  const rawMarketDataQuality = marketEffects.dataQuality || {};
  const exactArchiveFresh = Boolean(
    previousCycleArchive && previousCycleArchive.fresh && previousCycleState
    || previousArchive && previousArchive.fresh && previousIndexEnvironment && previousCycleState,
  );
  const comparisonInputsAvailable = Boolean(rawMarketDataQuality.previousTradingDayAvailable);
  const historyFresh = exactArchiveFresh && comparisonInputsAvailable;
  // “主升”必须是同一条主线的跨日延续，不能把上一交易日的主升标签
  // 无条件继承给今天新冒出的轮动方向。名称、家族和别名任一一致才算延续。
  const normalizeDirectionIdentity = (value) => String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s·•_/\\-]+/g, "");
  const directionIdentityKeys = (direction) => {
    if (!direction || typeof direction !== "object") return [];
    return [...new Set([
      direction.family,
      direction.name,
      ...(Array.isArray(direction.aliases) ? direction.aliases : []),
    ].map(normalizeDirectionIdentity).filter(Boolean))];
  };
  const archivedPreviousMainline = previousPayload && previousPayload.topicBoard
    ? previousPayload.topicBoard.mainLine
    : null;
  const previousStructuralResolution = previousCycleState
    ? previousCycleState.structuralResolution
    : null;
  const savedMainlineTolerance = previousStructuralResolution
    && previousStructuralResolution.mainlineTolerance
    && typeof previousStructuralResolution.mainlineTolerance === "object"
    ? previousStructuralResolution.mainlineTolerance
    : null;
  // 兼容三日容错上线前已经生成的归档：旧版本会在断线首日直接从主升降为修复。
  // 这里只把明确记录了“上一周期主升 + 主线未延续”的那一天还原为观察第1天。
  const legacyToleranceAnchor = previousStructuralResolution
    && previousStructuralResolution.previousCycle === "主升"
    && previousStructuralResolution.cycle !== "主升"
    && previousStructuralResolution.mainlineContinuity
    && previousStructuralResolution.mainlineContinuity.known === true
    && previousStructuralResolution.mainlineContinuity.continuous === false
    ? String(previousStructuralResolution.mainlineContinuity.previous || "").trim()
    : "";
  const legacyMainlineTolerance = !savedMainlineTolerance && legacyToleranceAnchor
    ? {
        active: true,
        breakDays: 1,
        baseCycle: "主升",
        anchor: legacyToleranceAnchor,
        anchorKeys: [normalizeDirectionIdentity(legacyToleranceAnchor)].filter(Boolean),
      }
    : null;
  const previousMainlineTolerance = savedMainlineTolerance && savedMainlineTolerance.active === true
    ? savedMainlineTolerance
    : legacyMainlineTolerance;
  const archivedPreviousMainlineName = archivedPreviousMainline
    ? String(archivedPreviousMainline.name || archivedPreviousMainline.displayName || archivedPreviousMainline.family || "").trim()
    : "";
  const previousMainlineName = previousMainlineTolerance && previousMainlineTolerance.anchor
    ? String(previousMainlineTolerance.anchor).trim()
    : archivedPreviousMainlineName;
  const savedAnchorKeys = previousMainlineTolerance && Array.isArray(previousMainlineTolerance.anchorKeys)
    ? previousMainlineTolerance.anchorKeys.map(normalizeDirectionIdentity).filter(Boolean)
    : [];
  const previousMainlineKeys = savedAnchorKeys.length
    ? [...new Set(savedAnchorKeys)]
    : previousMainlineTolerance && previousMainlineTolerance.anchor
      ? [normalizeDirectionIdentity(previousMainlineTolerance.anchor)].filter(Boolean)
      : directionIdentityKeys(archivedPreviousMainline);
  const currentStrongDirections = hotConcepts.filter((direction) => (
    direction
    && direction.name !== "未归类"
    && safeMarketNumber(direction.count) >= 5
    && safeMarketNumber(direction.limitCount) >= 3
  ));
  const continuingDirection = currentStrongDirections.find((direction) => {
    const currentKeys = directionIdentityKeys(direction);
    return currentKeys.some((key) => previousMainlineKeys.includes(key));
  }) || null;
  const currentMainlineNames = currentStrongDirections
    .map((direction) => String(direction.name || direction.displayName || direction.family || "").trim())
    .filter(Boolean);
  const directionInputsAvailable = previousMainlineKeys.length > 0
    && hotConcepts.some((direction) => direction && direction.name && direction.name !== "未归类");
  const mainlineContinuityKnown = historyFresh && directionInputsAvailable;
  const mainlineContinuous = Boolean(continuingDirection);
  const previousMainlineBreakDays = previousMainlineTolerance
    ? Math.max(0, Math.round(safeMarketNumber(previousMainlineTolerance.breakDays)))
    : 0;
  const mainlineToleranceBaseCycle = previousMainlineTolerance
    ? "主升"
    : previousCycle === "主升"
      ? "主升"
      : null;
  const rawCoverageScore = Number(rawMarketDataQuality.score);
  marketEffects.dataQuality = {
    ...rawMarketDataQuality,
    inputCoverageScore: Number.isFinite(rawCoverageScore) ? rawCoverageScore : null,
    comparisonInputsAvailable,
    previousTradingDayAvailable: historyFresh,
    grade: historyFresh ? rawMarketDataQuality.grade : "unverified",
    score: historyFresh
      ? rawMarketDataQuality.score
      : Math.min(Number.isFinite(rawCoverageScore) ? rawCoverageScore : 0, 60),
    previousTradingDate: expectedPrevDate || null,
    previousArchiveDate: previousArchive ? previousArchive.date : null,
    previousArchiveFresh: exactArchiveFresh,
    structuralTransitionReady: historyFresh,
    label: historyFresh
      ? rawMarketDataQuality.label || "数据完整"
      : exactArchiveFresh
        ? "上一交易日关键字段不完整"
        : expectedPrevDate
          ? "上一交易日归档缺失"
          : "交易日未校验",
    tone: historyFresh ? rawMarketDataQuality.tone || "good" : "warn",
    summary: historyFresh
      ? `已使用上一有效交易日${expectedPrevDate}收盘快照`
      : exactArchiveFresh
        ? `${expectedPrevDate}收盘归档存在，但缺少涨停、跌停或成交等关键对比字段：禁止切换基础周期`
        : expectedPrevDate
          ? `缺少${expectedPrevDate}完整收盘快照：今天状态可判断，但禁止强制切换基础周期`
          : "交易日来源尚未通过校验：只判断今天状态，不确认跨日周期变化",
    issues: [
      ...(Array.isArray(rawMarketDataQuality.issues) ? rawMarketDataQuality.issues : []),
      ...(historyFresh
        ? []
        : [exactArchiveFresh
          ? `${expectedPrevDate}收盘归档关键字段不完整`
          : expectedPrevDate
            ? `缺少${expectedPrevDate}完整收盘归档`
            : "上一交易日未经数据源校验"]),
    ],
  };
  if (marketEffects.dailyState) {
    const rawDailyConfidence = Number(marketEffects.dailyState.confidence);
    marketEffects.dailyState = {
      ...marketEffects.dailyState,
      comparisonVerified: historyFresh,
      confidence: historyFresh
        ? marketEffects.dailyState.confidence
        : Math.min(Number.isFinite(rawDailyConfidence) ? rawDailyConfidence : 0, 65),
    };
  }
  const indexEnvironment = analyzeIndexEnvironment({
    snapshot,
    indexStructures: snapshot.indexStructures,
    previousCycle,
  });
  const tradeWindow = analyzeTradingWindow({
    snapshot,
    limitStats,
    candidates: Array.isArray(options.candidates) ? options.candidates : [],
    dailyState: marketEffects.dailyState,
    profitEffect: marketEffects.profitEffect,
    lossEffect: marketEffects.lossEffect,
    previousSnapshot: previousMarket ? previousMarket.snapshot : null,
    previousLimit: previousMarket ? previousMarket.limitStats : null,
    previousCandidates: previousPayload && Array.isArray(previousPayload.candidates) ? previousPayload.candidates : [],
    previousMarketState: previousCycleState,
  });
  const structuralResolution = resolveStructuralCycle({
    previousCycle,
    legacyCycle: legacyObservedCycle,
    dailyState: marketEffects.dailyState,
    previousDailyState: previousMarket && previousMarket.state ? previousMarket.state.dailyState : null,
    profitEffect: marketEffects.profitEffect,
    lossEffect: marketEffects.lossEffect,
    tradeWindow,
    historyFresh,
    afterClose,
    clearMainline,
    heatConfirmed,
    marketScore,
    mainlineContinuityKnown,
    mainlineContinuous,
    previousMainlineName,
    currentMainlineNames,
    mainlineToleranceDays: 3,
    previousMainlineBreakDays,
    mainlineToleranceBaseCycle,
    mainlineAnchorKeys: previousMainlineKeys,
    indexEnvironment,
    previousIndexEnvironment,
    previousStructuralResolution,
    previousMarketState: previousCycleState,
  });
  observedCycle = structuralResolution.cycle;









  const transitionResult = applyShockAwareCycleTransition(observedCycle, todayYmd, {
    afterClose,
    snapshot,
    limitStats,
    externalCoreAlert: options.externalCoreAlert || null,
    structuralCycleHint: structuralResolution.cycle,
    marketEffects,
  });
  let cycle = transitionResult.cycle;
  const shockTransition = transitionResult.shockTransition || null;































  // 兼容旧字段语义：rawCycle / observedCycle 始终表示当日原始观测，
  // 基础结构结论单独放在 structuralCycle / structuralResolution 中。
  const rawCycle = legacyObservedCycle;















  let { subPhase, reasons: subPhaseReasons } = classifySubPhase(cycle, limitStats);

  if (shockTransition && shockTransition.active) {
    subPhase = shockTransition.label;
    subPhaseReasons = [
      `基础周期保留${shockTransition.baseCycle}，当日呈现${shockTransition.damageLevel}`,
      "操作按退潮级防守，次日10:50只验证、不抢修复",
      "是否纠偏或确认退潮，以次日收盘后的A股自身修复证据为准",
    ];
  }















  if (rawCycle === "混沌" && clearMainline && heatConfirmed && marketScore >= 68 && index > 0) {















    subPhase = "强回流";















    subPhaseReasons = [















      `核心主线已经站出来了（${topConcept ? topConcept.name : "未命名方向"}），但扩散还没跟上`,















      `涨跌家数比只有 ${Math.round(breadth * 100)}%，还没到主升要求`,















      "所以先按混沌里的强回流处理，而不是直接叫主升",















    ];















  }































  if (
    !(shockTransition && shockTransition.active)
    && cycle !== "主升"
    && marketEffects.dailyState
    && marketEffects.dailyState.key !== "data_insufficient"
  ) {
    subPhase = marketEffects.dailyState.label;
    subPhaseReasons = Array.isArray(marketEffects.dailyState.reasons)
      ? marketEffects.dailyState.reasons
      : [];
  }
  if (
    !(shockTransition && shockTransition.active)
    && marketEffects.dailyState
    && marketEffects.dailyState.key === "data_insufficient"
  ) {
    subPhase = marketEffects.dailyState.label;
    subPhaseReasons = Array.isArray(marketEffects.dailyState.reasons)
      ? marketEffects.dailyState.reasons
      : ["关键行情数据不足，本次只保留缓存，不生成进攻结论"];
  }

  const mainlineTolerance = structuralResolution && structuralResolution.mainlineTolerance
    ? structuralResolution.mainlineTolerance
    : null;
  if (
    !(shockTransition && shockTransition.active)
    && mainlineTolerance
    && mainlineTolerance.active === true
    && (!marketEffects.dailyState || marketEffects.dailyState.key !== "data_insufficient")
  ) {
    const breakDays = Math.max(1, Math.round(safeMarketNumber(mainlineTolerance.breakDays) || 1));
    const remainingDays = Math.max(0, Math.round(safeMarketNumber(mainlineTolerance.remainingDays) || 0));
    subPhaseReasons = [
      ...(Array.isArray(subPhaseReasons) ? subPhaseReasons : []),
      `题材观察：${mainlineTolerance.anchor || previousMainlineName || "原题材"}连续${breakDays}个交易日未恢复，还剩${remainingDays}个收盘验证机会`,
      "三日容错只保留原题材观察资格，不改变指数周期、建议仓位或买点。",
    ];
  }

  let operation = "聚焦";















  if (cycle === "主升") operation = "进攻";















  if (cycle === "退潮" || cycle === "冰点") operation = "防守";















  if (cycle === "震荡") operation = "聚焦承接";















  if (externalRisk && externalRisk.level === "高风险" && operation === "进攻") operation = "聚焦";















  if (externalRisk && externalRisk.level === "高风险" && ["混沌", "震荡"].includes(cycle)) operation = "防守观察";































  let position =















    cycle === "主升"















      ? "70%-100%"















      : cycle === "震荡"















        ? "30%-50%"















        : cycle === "混沌"















          ? "20%-40%"















          : cycle === "冰点"















            ? "0%-20%"















            : "0%";































  // 主升不是铁板一块：子阶段决定仓位——主升中才配进攻仓；















  // 高潮加速=锁利不接最后一棒；高位分歧=减仓为主（与 stopProfitLoss 的止损上移逻辑同源）















  if (cycle === "主升" && subPhase === "高潮加速") {















    position = "50%-70%";















    operation = "锁利兑现";















  }















  if (cycle === "主升" && subPhase === "高位分歧") {















    position = "30%-50%";















    operation = "减仓防守";















  }































  let minScore =















    cycle === "主升" ? 66 : cycle === "震荡" ? 76 : cycle === "混沌" ? 78 : cycle === "冰点" ? 86 : 999;































  let allowSetups =















    cycle === "主升"















      ? ["核心打板/分歧转强", "轮动回流第一强", "核心观察"]















      : cycle === "震荡"















        ? ["轮动回流第一强", "核心打板/分歧转强"]















        : cycle === "混沌"















          ? ["混沌低位试错", "轮动回流第一强", "核心打板/分歧转强"]















          : cycle === "冰点"















            ? ["抱团核心试错"]















            : [];

  if (shockTransition && shockTransition.active) {
    operation = "防守观察";
    position = "0%";
    minScore = 999;
    allowSetups = [];
  }

  if (marketEffects.dailyState && marketEffects.dailyState.key === "data_insufficient") {
    operation = "等待数据";
    position = "0%";
    minScore = 999;
    allowSetups = [];
  } else if (marketEffects.dailyState && marketEffects.dailyState.key === "retreat_candidate") {
    operation = "防守观察";
    position = "0%";
    minScore = 999;
    allowSetups = [];
  } else if (marketEffects.dailyState && marketEffects.dailyState.key === "ice_point" && cycle !== "冰点") {
    operation = "防守";
    position = "0%-20%";
    minScore = Math.max(minScore, 86);
    allowSetups = ["抱团核心试错"];
  }

  // 交易窗口与指数周期分层：指数分歧时，全A抗跌且核心先走强，可以给先手；
  // 只有次日环境改善、同一核心继续加强，才把“已有先手”升级为可确认加仓。
  if (!(shockTransition && shockTransition.active) && marketEffects.dailyState.key !== "data_insufficient") {
    if (tradeWindow.key === "negative_feedback") {
      operation = "防守观察";
      position = "0%";
      minScore = 999;
      allowSetups = [];
    } else if (tradeWindow.key === "preemptive_core") {
      operation = "先手试错";
      position = "10%-20%";
      minScore = Math.max(minScore, 76);
      allowSetups = ["混沌低位试错", "轮动回流第一强", "核心打板/分歧转强"];
    } else if (tradeWindow.key === "warming_confirmed") {
      operation = "回暖确认";
      position = cycle === "主升" ? "50%-70%" : "30%-50%";
      minScore = Math.max(minScore, 72);
      allowSetups = ["轮动回流第一强", "核心打板/分歧转强"];
    }
  }































  const summary = [















    `两市成交额约 ${amount} 亿`,















    `涨跌家数比 ${Math.round(breadth * 100)}%`,















    `主要指数均值 ${index.toFixed(2)}%`,















    topConcept ? `最聚焦方向 ${topConcept.name}` : "方向聚焦不足",















    clearMainline















      ? breadth >= 0.5















        ? `主线已确立：${topConcept.name}（共振+连板高度）`















        : `主线有苗头：${topConcept.name}（核心很强，但扩散还不够，先按强回流看）`















      : "主线未确立，按试错期处理（等走出共振主线再升级）",















    limitStats ? `涨停 ${limitStats.ztToday}（${limitStats.ztPrev2}→${limitStats.ztPrev}→${limitStats.ztToday}）/ 跌停 ${limitStats.dtToday}` : "涨跌停数据未取到",















    externalRisk ? `外部环境${externalRisk.level}` : "外部环境未计入",
    `今日状态 ${marketEffects.dailyState.label}`,
    `${marketEffects.profitEffect.label} ${marketEffects.profitEffect.score}分`,
    `${marketEffects.lossEffect.label} ${marketEffects.lossEffect.score}分`,
    `短线窗口 ${tradeWindow.label}`,
    marketEffects.dataQuality.summary,















  ];















  if (cycle === "主升" && (subPhase === "高潮加速" || subPhase === "高位分歧")) {















    summary.push(`子阶段${subPhase}：仓位下调至${position}，${subPhase === "高位分歧" ? "减仓为主、止损上移" : "锁利为主、不接最后一棒"}`);















  }































  if (shockTransition && shockTransition.active) {
    summary.push(`基础周期${cycle}，当日${shockTransition.damageLevel}；仓位${position}，等待次日10:50验证与收盘确认`);
  }

  const cycleReasons = [];















  if (shockTransition && shockTransition.active) {
    cycleReasons.push(`基础周期仍是${shockTransition.baseCycle}，没有用单日外围冲击直接改写周期`);
    cycleReasons.push(`当日指数${index.toFixed(2)}%、上涨占比${Math.round(breadth * 100)}%，属于${shockTransition.damageLevel}`);
    cycleReasons.push("执行按退潮级防守；次日10:50只验证，收盘后再确认纠偏或退潮");
    cycleReasons.push(shockTransition.attributionNote);
  } else if (marketEffects && marketEffects.dailyState) {
    cycleReasons.push(`基础周期：${cycle}；今日状态：${marketEffects.dailyState.label}`);
    cycleReasons.push(structuralResolution.reason);
    cycleReasons.push(marketEffects.dailyState.summary);
    cycleReasons.push(marketEffects.profitEffect.summary);
    cycleReasons.push(marketEffects.lossEffect.summary);
    cycleReasons.push(`短线交易窗口：${tradeWindow.label}；${tradeWindow.summary}`);
    if (!historyFresh) cycleReasons.push(marketEffects.dataQuality.summary);
  } else if (index <= -1.1 && breadth < 0.28) {















    cycleReasons.push(`指数跌得很重（${index.toFixed(2)}%），而且跌多涨少（${Math.round(breadth * 100)}%）`);















    cycleReasons.push("这更像退潮，不是冰点");















  } else if (index < -0.35 && breadth < 0.38) {















    cycleReasons.push(`指数偏弱（${index.toFixed(2)}%），涨跌家数也不理想（${Math.round(breadth * 100)}%）`);















    cycleReasons.push("盘面还在冰冷区，所以归到冰点");















  } else if (rawCycle === "混沌" && clearMainline && heatConfirmed && marketScore >= 68 && index > 0) {















    cycleReasons.push(`核心主线已经出来了，但涨跌家数比只有 ${Math.round(breadth * 100)}%，扩散没有跟上`);















    cycleReasons.push("这不是主升，更像强回流混沌");















  } else {















    cycleReasons.push(`今天的盘面本身并不冰冷：指数均值 ${index.toFixed(2)}%，涨跌家数比 ${Math.round(breadth * 100)}%`);















    if (cycle === "冰点") {















      cycleReasons.push("但周期锁把昨天确认过的冰点延续到了今天");















    } else {















      cycleReasons.push("它更像混沌/修复，不够资格直接叫冰点");















    }















  }















  if (!marketEffects && limitStats && limitStats.ztToday != null && limitStats.ztPrev != null) {















    cycleReasons.push(`涨停从 ${limitStats.ztPrev} 到 ${limitStats.ztToday}，说明情绪还没真正回暖到进攻态`);















  }















  if (externalRisk && externalRisk.level) {















    cycleReasons.push(`外部环境是 ${externalRisk.level}，模型会更偏防守`);















  }































  return {















    cycle,















    subPhase,















    subPhaseReasons,















    rawCycle,

    observedCycle: legacyObservedCycle,

    structuralObservedCycle: observedCycle,

    structuralCycle: cycle,
    bigCycleTransition: structuralResolution.transition,
    smallCycle: structuralResolution.smallCycle,

    shockTransition,

    legacyObservedCycle,

    structuralResolution,
    indexEnvironment,
    tradeWindow,

    dailyState: marketEffects.dailyState,

    profitEffect: marketEffects.profitEffect,

    lossEffect: marketEffects.lossEffect,

    emotionEffectContext: marketEffects.emotionEffectContext || null,

    dataQuality: marketEffects.dataQuality,















    cycleReasons,















    operation,















    position,















    marketScore,















    minScore,















    allowSetups,















    summary,















    metrics: {















      volumeScore: Math.round(volumeScore * 100),















      breadthScore: Math.round(breadthScore * 100),















      indexScore: Math.round(indexScore * 100),















      focusScore: Math.round(focusScore * 100),















    },















    externalPenalty: externalRisk ? externalRisk.penalty : 0,















  };















}































function classifyTradingStyle(marketState, hotConcepts, rows) {















  const topConcept = hotConcepts[0];















  const topMembers = topConcept















    ? rows.filter((item) => (topConcept.matchNames || [topConcept.name]).some((n) => (item.concepts || []).includes(n)))















    : [];















  const topLimitCount = topMembers.filter((item) => isLimitUp(item) || boardHeight(item) > 0).length;















  const hotLimitCount = rows.filter((item) => isLimitUp(item) || boardHeight(item) > 0).length;















  const focusRatio = rows.length ? topMembers.length / rows.length : 0;















  const trendWaveCount = rows.filter((item) => {















    const wave = item.klineProfile && item.klineProfile.wave;















    return ["二波突破", "二波趋势重建", "三波/高位趋势"].includes(wave);















  }).length;















  const capacityTrendCount = rows.filter(















    (item) => item.ticketType === "容量票" && item.klineProfile && item.klineProfile.wave !== "非趋势波段",















  ).length;































  let style = "个股轮动";















  let preference = "轮动回流";















  if (marketState.cycle === "退潮") style = "防守空仓";















  else if (marketState.cycle === "冰点") style = "情绪抱团";















  else if (topConcept && topConcept.count >= 5 && topLimitCount >= 3 && marketState.cycle === "主升") style = "板块主升";















  else if (topConcept && topConcept.count >= 4 && topLimitCount >= 2) style = "板块轮动";















  else if (hotLimitCount >= 5 && focusRatio < 0.18) style = "个股轮动";















  else if (topConcept && topConcept.count >= 3) style = "板块轮动";































  if (trendWaveCount >= 8 || capacityTrendCount >= 5) preference = "趋势二波/三波";















  if (style === "情绪抱团" || (hotLimitCount >= 10 && marketState.cycle === "冰点")) preference = "高标抱团";















  if (style === "板块轮动" || style === "个股轮动") preference = "轮动回流";















  if (style === "板块主升") preference = "主线进攻";

  if (marketState.shockTransition && marketState.shockTransition.active) {
    style = "防守空仓";
    preference = "等待纠偏确认";
  }































  const bias =















    preference === "趋势二波/三波"















      ? "优先容量趋势与二波突破，买在分歧承接，不追情绪加速"















      : preference === "高标抱团"















        ? "只看高辨识度核心，买在分歧承接或充分换手回封"















        : preference === "轮动回流"















          ? "博弈次日资金回流溢价，只做回流第一强"















          : style === "板块主升"















      ? "进攻核心龙头，优先首次分歧和分歧转一致"















      : style === "板块轮动"















        ? "聚焦回流第一强，避免后排追高"















        : style === "情绪抱团"















          ? "只看绝对核心，小仓试错，不扩散"















          : style === "防守空仓"















            ? "不开放新仓，只观察修复信号"















            : "做减法，只看个股强辨识度";































  return {















    style,















    preference,















    bias,















    topDirection: topConcept ? topConcept.name : "无明显主线",















    topMembers: topMembers.length,















    topLimitCount,















    hotLimitCount,















    trendWaveCount,















    capacityTrendCount,















  };















}































function isLimitLike(stock) {















  return isLimitUp(stock) || boardHeight(stock) > 0;















}































function isTrendLike(stock) {















  const wave = stock.klineProfile && stock.klineProfile.wave;















  return ["二波突破", "二波趋势重建", "三波/高位趋势"].includes(wave);















}































function stockCase(stock, reason, effectType) {















  return {















    name: stock.name || "--",















    code: stock.code,















    role: stock.role || "角色待定",















    ticketType: stock.ticketType || "票型待定",















    concept: stock.mainConcept || (stock.concepts && stock.concepts[0]) || "未归类",















    changePct: Number(stock.changePct || 0),















    wave: stock.klineProfile ? stock.klineProfile.wave : "形态未确认",















    longStrength: stock.gamePlan ? stock.gamePlan.longStrength : capitalLongSignal(stock).strength,















    score: stock.score || 0,















    effectType,















    reason,















  };















}































function uniqueCases(stocks, count, reasonBuilder, effectType) {















  const seen = new Set();















  const result = [];































  for (const stock of stocks) {















    if (!stock || seen.has(stock.code)) continue;















    seen.add(stock.code);















    result.push(stockCase(stock, reasonBuilder(stock), effectType));















    if (result.length >= count) break;















  }































  return result;















}































function continuityView(tradingStyle, marketState, hotConcepts, examples, externalRisk) {















  const topConcept = hotConcepts[0];















  const breadthScore = marketState.metrics ? marketState.metrics.breadthScore : 50;















  const externalHigh = externalRisk && externalRisk.level === "高风险";















  const externalMid = externalRisk && externalRisk.level === "中风险";















  const reasons = [];















  let level = "弱";















  let label = "弱持续性";































  if (marketState.cycle === "退潮") {















    reasons.push("周期处在退潮，亏钱效应优先级高于进攻信号");















    reasons.push("即使有个股上榜，也更像局部反抽，不适合扩散");















  } else if (tradingStyle.preference === "主线进攻") {















    const strongMainline = topConcept && topConcept.resonance && topConcept.count >= 5 && topConcept.limitCount >= 3;















    level = strongMainline && breadthScore >= 45 && !externalHigh ? "强" : "中";















    label = level === "强" ? "强持续性" : "中等持续性";















    reasons.push(















      topConcept















        ? `${topConcept.name}同时具备热榜密度、涨停/连板数量和板块指数共振`















        : "主线方向样本不足",















    );















    reasons.push(breadthScore >= 45 ? "市场宽度没有明显拖累主线扩散" : "市场宽度偏弱，主线扩散需要次日确认");















  } else if (tradingStyle.preference === "趋势二波/三波") {















    level = tradingStyle.capacityTrendCount >= 5 && !externalHigh ? "中偏强" : "中";















    label = `${level}持续性`;















    reasons.push(`趋势/二波样本${tradingStyle.trendWaveCount}只，容量趋势样本${tradingStyle.capacityTrendCount}只`);















    reasons.push("持续性要看容量中军是否继续放量强于指数");















  } else if (tradingStyle.preference === "高标抱团") {















    level = marketState.cycle === "冰点" ? "弱到中" : "中";















    label = `${level}持续性`;















    reasons.push("赚钱效应集中在高辨识度核心，后排扩散持续性不足");















    reasons.push("能否延续取决于核心高标次日是否继续超预期、负反馈是否收敛");















  } else if (tradingStyle.preference === "轮动回流") {















    const hasResonance = topConcept && topConcept.resonance;















    level = hasResonance && topConcept.count >= 4 && !externalHigh ? "中" : "弱到中";















    label = `${level}持续性`;















    reasons.push(















      topConcept















        ? `${topConcept.name}热度靠前，${hasResonance ? "有板块共振" : "板块共振不足"}`















        : "没有明显聚焦方向",















    );















    reasons.push("轮动行情持续性通常靠次日回流确认，不能按主升行情连续加速预期处理");















  }































  if (externalHigh || externalMid) {















    reasons.push(`外部/消息面为${externalRisk.level}，需要降低持续性预期`);















    if (externalHigh) {















      level = "弱";















      label = "弱持续性";















    }















  }































  if (!examples.length) reasons.push("当前缺少足够清晰的赚钱效应案例，优先等待下一次确认");































  return {















    level,















    label,















    reasons,















  };















}































function summarizeStockSignal(stock) {















  if (!stock) return null;















  return {















    name: stock.name || "--",















    code: stock.code,















    role: stock.role || "角色待定",















    ticketType: stock.ticketType || "票型待定",















    changePct: Number(stock.changePct || 0),















    score: Number(stock.score || 0),
    isDriver: Boolean(stock.isDriver),
    initiativeScore: Number.isFinite(Number(stock.initiativeScore)) ? Number(stock.initiativeScore) : null,
    leadership: stock.leadership ? {
      level: stock.leadership.level || "L1",
      levelLabel: stock.leadership.levelLabel || "普通跟随",
      identity: stock.leadership.identity || "跟随观察",
      coreQualified: Boolean(stock.leadership.coreQualified),
      tradeState: stock.leadership.tradeState || "仅观察",
      executionNote: stock.leadership.executionNote || "等待验证",
      initiative: stock.leadership.initiative || null,
      structure: stock.leadership.structure || null,
    } : null,















  };















}































// 总龙头选取逻辑已迁移至 leader-select.js 的 buildTotalLeader(只在 selected 池内选,















// 共识票被剔除则不认,涨停判定用真涨停+连板高度);本函数只负责组装展示对象。















function buildTotalLeader(candidates, topicBoard, marketState) {















  const mainLine = topicBoard.mainLine || null;















  const mainLineName = mainLine ? mainLine.name : null;































  const master = pickTotalLeader(candidates, topicBoard, marketState);















  if (!master) {















    return {















      name: "暂无明确总龙头",















      code: "--",















      role: "暂无",















      ticketType: "暂无",















      concept: mainLineName || "无明确主线",















      reason: "当前没有入围的总龙头候选（全部被剔除或退潮期空仓），先观察主线是否形成。",















      score: 0,















      changePct: 0,















      longStrength: 0,















      amountYi: 0,















      anchor: false,















      kind: "total",















    };















  }































  const anchorReasons = [];















  if (mainLine && mainLine.sustained) anchorReasons.push("主线已形成");















  if (mainLine && mainLine.resonance) anchorReasons.push("板块与指数共振");















  if (master.role === "龙头") anchorReasons.push("板块内高度第一");















  if (master.inBothSources) anchorReasons.push("市场合力双榜共振");















  if (isLimitUp(master)) anchorReasons.push(`真涨停封板${boardHeight(master) > 1 ? `，梯队高度${boardHeight(master)}板` : ""}`);















  if (master.gamePlan && master.gamePlan.longStrength >= 65) anchorReasons.push("大资金跟随确认");















  if (mainLineName && master.mainConcept === mainLineName) anchorReasons.push("处于当前主线方向");















  if (marketState.cycle === "主升") anchorReasons.push("主升期更容易形成总龙头");































  return {















    name: master.name || "--",















    code: master.code,















    role: master.role || "角色待定",















    ticketType: master.ticketType || "票型待定",















    concept: master.mainConcept || mainLineName || "未归类",















    reason: anchorReasons.length ? anchorReasons.join("；") : "市场合力与市场高度绑定，先锚定主线里最强共识票。",















    score: master.score || 0,















    changePct: Number(master.changePct || 0),















    longStrength: master.gamePlan ? master.gamePlan.longStrength : 0,















    amountYi: Number(master.amountYi || 0),















    anchor: true,















    kind: "total",















  };















}































function buildCapacityAnchor(candidates, topicBoard, marketState) {















  const mainLineName = topicBoard.mainLine ? topicBoard.mainLine.name : null;















  const pool = candidates.filter((stock) => !mainLineName || stock.mainConcept === mainLineName);















  const corePool = pool.filter((stock) => stock.role === "中军" || stock.ticketType === "容量票");















  const ranked = (corePool.length ? corePool : pool).slice().sort((a, b) => {















    const aMain = mainLineName && a.mainConcept === mainLineName ? 40 : 0;















    const bMain = mainLineName && b.mainConcept === mainLineName ? 40 : 0;















    const aCore = (a.role === "中军" ? 40 : 0) + (a.ticketType === "容量票" ? 25 : 0);















    const bCore = (b.role === "中军" ? 40 : 0) + (b.ticketType === "容量票" ? 25 : 0);















    const aAmount = Math.min(20, Math.round(Number(a.amountYi || 0) * 0.5));















    const bAmount = Math.min(20, Math.round(Number(b.amountYi || 0) * 0.5));















    const aLong = a.gamePlan ? Math.min(18, Math.round(a.gamePlan.longStrength * 0.2)) : 0;















    const bLong = b.gamePlan ? Math.min(18, Math.round(b.gamePlan.longStrength * 0.2)) : 0;















    const aScore = aMain + aCore + aAmount + aLong + (a.inBothSources ? 10 : 0);















    const bScore = bMain + bCore + bAmount + bLong + (b.inBothSources ? 10 : 0);















    return bScore - aScore;















  });































  const master = ranked[0] || null;















  if (!master) {















    return {















      name: "暂无明确容量锚定中军",















      code: "--",















      role: "暂无",















      ticketType: "暂无",















      concept: mainLineName || "无明确主线",















      reason: "当前没有足够清晰的容量锚，先观察主线是否形成。",















      score: 0,















      changePct: 0,















      longStrength: 0,















      amountYi: 0,















      anchor: false,















      kind: "capacity",















    };















  }































  const anchorReasons = [];















  if (master.role === "中军") anchorReasons.push("方向内中军属性");















  if (master.ticketType === "容量票") anchorReasons.push("容量承接更强");















  if (Number(master.amountYi || 0) >= 20) anchorReasons.push(`成交额${Math.round(Number(master.amountYi || 0) * 10) / 10}亿`);















  if (master.gamePlan && master.gamePlan.longStrength >= 65) anchorReasons.push("大资金承接信号强");















  if (master.inBothSources) anchorReasons.push("双榜共振");















  if (mainLineName && master.mainConcept === mainLineName) anchorReasons.push("处于当前主线方向");















  if (marketState.cycle === "主升") anchorReasons.push("主升期更容易成为容量锚定中军");































  return {















    name: master.name || "--",















    code: master.code,















    role: master.role || "角色待定",















    ticketType: master.ticketType || "票型待定",















    concept: master.mainConcept || mainLineName || "未归类",















    reason: anchorReasons.length ? anchorReasons.join("；") : "容量锚定中军，优先跟随其承接判断主线强弱。",















    score: master.score || 0,















    changePct: Number(master.changePct || 0),















    longStrength: master.gamePlan ? master.gamePlan.longStrength : 0,















    amountYi: Number(master.amountYi || 0),















    anchor: true,















    kind: "capacity",















  };















}































function buildEmotionAnchor(candidates, topicBoard, marketState) {















  return buildTotalLeader(candidates, topicBoard, marketState);















}































function buildMasterLeader(candidates, topicBoard, marketState) {















  return buildTotalLeader(candidates, topicBoard, marketState);















}































function buildTopicBoard(hotConcepts, candidates, marketState, externalRisk) {















  const items = hotConcepts















    .map((concept) => {















      const members = candidates.filter((stock) => stock.mainConcept === concept.name || stock.mainFamily === concept.family);















      // 题材内部排序只能使用角色、涨停高度、热榜与成交额等原子事实，
      // 不能再读取候选总分，否则会形成“题材给个股加分、个股总分再决定题材”的反馈环。
      const ordered = members.slice().sort((a, b) => {
        const authorityDiff = Number(candidateRoleAuthority(b).coreAuthorized) - Number(candidateRoleAuthority(a).coreAuthorized);
        if (authorityDiff) return authorityDiff;
        const limitDiff = Number(isLimitUp(b)) - Number(isLimitUp(a));
        if (limitDiff) return limitDiff;
        const heightDiff = Number(boardHeight(b) || 0) - Number(boardHeight(a) || 0);
        if (heightDiff) return heightDiff;
        const rankA = Number(a && a.combinedRank) || Number.MAX_SAFE_INTEGER;
        const rankB = Number(b && b.combinedRank) || Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) return rankA - rankB;
        const amountDiff = Number(b && b.amountYi || 0) - Number(a && a.amountYi || 0);
        if (amountDiff) return amountDiff;
        return Number(b && b.changePct || 0) - Number(a && a.changePct || 0);
      });















      // 龙头梯队:classifyRole 已允许方向多核并列,这里把梯队全列出来(最多3只),不再只封一只















      const leaders = ordered.filter((item) => item.role === "龙头").slice(0, 3);















      // 没有经过角色验证的龙头就明确留空，不能把方向总分第一名强贴“龙头”。
      const leader = leaders[0] || null;















      const zhongjun =















        ordered.find((item) => item.role === "中军") ||















        ordered.find((item) => item.ticketType === "容量票") ||















        null;















      const lowLevel =















        ordered.find((item) => item.role === "补涨") ||















        ordered.find((item) => item.role !== "龙头" && item.role !== "中军" && item.combinedRank >= 4 && item.changePct >= 0) ||















        null;















      const roleCoverage = Number(Boolean(leader)) + Number(Boolean(zhongjun)) + Number(Boolean(lowLevel));















      const limitHeight = Math.max(0, ...ordered.map((item) => (isLimitUp(item) || boardHeight(item) > 0 ? item.changePct : 0)));















      const topicScore = Math.round(















        concept.score +















          roleCoverage * 10 +















          concept.limitCount * 4 +















          (concept.resonance ? 10 : 0) +















          (leader ? 4 : 0) +















          (zhongjun ? 4 : 0) +















          (lowLevel ? 4 : 0),















      );































      const sustained = concept.resonance && concept.count >= 4 && concept.limitCount >= 2 && roleCoverage >= 3;















      const watchable = concept.count >= 3 && roleCoverage >= 2 && concept.limitCount >= 1;















      const label = sustained ? "主线持续" : watchable ? "可继续观察" : "一日游风险";















      const reasons = [















        concept.resonance
          ? `${concept.resonanceLabel || "板块共振"}${concept.relativeToIndex !== null && concept.relativeToIndex !== undefined ? `（相对指数${concept.relativeToIndex >= 0 ? "+" : ""}${concept.relativeToIndex}个百分点）` : ""}`
          : concept.resonance === false
            ? "板块共振不足"
            : "板块共振未验证(行情数据缺失)",
        `${concept.directionState && concept.directionState.coreLabel || "方向地位待确认"} · ${concept.directionState && concept.directionState.dailyLabel || "当日效应待确认"} · ${concept.directionState && concept.directionState.repairLabel || "修复待确认"}`,















        leaders.length > 1















          ? `板块强势梯队：${leaders.map((item) => item.name).join(" / ")}（不等同于核心认证）`















          : leader















            ? `龙头：${leader.name}`















            : "龙头不清晰",















        zhongjun ? `中军：${zhongjun.name}` : "中军不足",















        lowLevel ? `低位补涨：${lowLevel.name}` : "低位补涨不足",















        `连板高度 ${concept.limitCount} 只`,















      ];































      if (limitHeight > 0) reasons.push(`板内出现${limitHeight.toFixed(1)}%真涨停高度票`);















      if (externalRisk && externalRisk.level === "高风险") reasons.push("外部环境高风险，持续性折扣");















      if (marketState.cycle === "退潮") reasons.push("退潮期题材持续性显著下降");































    return {















      name: concept.name,















      family: concept.family || concept.name,















      displayName:















        concept.family && concept.family !== concept.name















          ? `${concept.family} / ${concept.displayName || concept.name}`















          : concept.displayName || concept.name, // 聚类簇名:主概念（含别名列表）















        aliases: concept.aliases || [],
        primarySubtheme: concept.primarySubtheme || null,
        subthemeCandidates: Array.isArray(concept.subthemeCandidates)
          ? concept.subthemeCandidates.map((row) => ({ ...row }))
          : [],
        aggregationLevel: concept.aggregationLevel || "theme",
        exactSubthemeMetricsRequired: concept.exactSubthemeMetricsRequired === true,















        sectorName: concept.sector ? concept.sector.name : "未匹配板块",















        sectorChangePct: concept.sector ? Number(concept.sector.changePct || 0) : 0,















        score: topicScore,















        count: concept.count,















        limitCount: concept.limitCount,















        resonance: concept.resonance,
        resonanceType: concept.resonanceType || "unverified",
        resonanceLabel: concept.resonanceLabel || "板块行情待验证",
        relativeToIndex: concept.relativeToIndex,
        memberStats: concept.memberStats || null,
        isCoreDirection: Boolean(concept.isCoreDirection),
        directionState: concept.directionState || null,















        label,















        sustained,















        summary: sustained















          ? `${concept.displayName || concept.name}具备龙头、中军、低位补涨和连板高度，属于当前可跟随的主线方向。`















          : watchable















            ? `${concept.displayName || concept.name}结构还在确认中，能看但不能当成稳态主线。`















            : `${concept.displayName || concept.name}更像一日游题材，持续性不足，适合只观察不重仓。`,















        reasons,















        leader: summarizeStockSignal(leader),















        leaders: leaders.map((item) => summarizeStockSignal(item)), // 龙头梯队(≤3只)















        zhongjun: summarizeStockSignal(zhongjun),















        lowLevel: summarizeStockSignal(lowLevel),















        limitHeight: Math.round(limitHeight * 10) / 10,















      };















    })















    .sort((a, b) => b.score - a.score);































  const hotConceptPool = Array.isArray(hotConcepts) ? hotConcepts.slice().sort((a, b) => (Number(b && b.score) || 0) - (Number(a && a.score) || 0)) : [];
  const preferredFamily = hotConceptPool.length ? String(hotConceptPool[0].family || hotConceptPool[0].name || "").trim() : "";
  const preferredName = hotConceptPool.length ? String(hotConceptPool[0].name || hotConceptPool[0].displayName || "").trim() : "";
  const preferredItems = preferredFamily || preferredName
    ? items.filter((item) => item.family === preferredFamily || item.name === preferredName || item.displayName === preferredName)
    : items;
  // 主线选择：优先考虑真实强度（sustained+连板高度+共振），而不是简单取聚类第一名
  const strongCandidates = items.filter(item => item.sustained && item.limitCount >= 3);
  const resonanceCandidates = items.filter(item => item.resonance && item.limitCount >= 2);
  const limitCandidates = items.filter(item => item.limitCount >= 4);

  let mainLine = null;
  // 优先级调整：高连板（≥7）> sustained+高连板 > 中连板（≥4）> 共振+连板 > preferredItems[0] > items[0]
  // 原因：存储芯片9板虽无共振，但连板高度远超军工6板+共振，应优先选择
  const veryHighLimitCandidates = items.filter(item => item.limitCount >= 7);
  const mediumLimitCandidates = items.filter(item => item.limitCount >= 4);

  if (veryHighLimitCandidates.length) {
    mainLine = veryHighLimitCandidates.sort((a, b) => b.limitCount - a.limitCount || b.score - a.score)[0];
  } else if (strongCandidates.length) {
    mainLine = strongCandidates.sort((a, b) => b.limitCount - a.limitCount || b.score - a.score)[0];
  } else if (mediumLimitCandidates.length) {
    mainLine = mediumLimitCandidates.sort((a, b) => b.limitCount - a.limitCount || b.score - a.score)[0];
  } else if (resonanceCandidates.length) {
    mainLine = resonanceCandidates.sort((a, b) => b.limitCount - a.limitCount || b.score - a.score)[0];
  } else {
    mainLine = preferredItems[0] || items[0] || null;
  }































  return {















    items,















    mainLine,















    conclusion: mainLine















      ? `${mainLine.name}是当前更接近主线的题材，持续性判断为${mainLine.label}`















      : "当前题材偏分散，暂未形成稳定主线",















  };















}































function buildFrameworkView(analysis, marketState, topicBoard, candidates, totalLeader, capacityAnchor) {















  const mainLine = topicBoard.mainLine;















  const moneySignals = candidates















    .filter((stock) => stock.gamePlan && stock.gamePlan.longStrength >= 65)















    .slice(0, 4)















    .map((stock) => `${stock.name}(${stock.role || "角色待定"}·${stock.gamePlan.longStrength})`);































  const summary = mainLine















    ? `本轮周期上涨的炒作逻辑集中在「${mainLine.name}」，市场正在验证龙头、中军和低位补涨的结构。`















    : `当前市场没有形成足够清晰的主线，先按风格偏好和仓位纪律做减法。`;































  const continuityLabel = mainLine ? mainLine.label : analysis.profitEffect.continuity;















  const continuityReasons = mainLine ? mainLine.reasons : analysis.profitEffect.continuityReasons;































  return {















    headline: summary,















    subline: `周期：${marketState.cycle}，操作：${marketState.operation}，仓位建议：${marketState.position}`,















    totalLeader,















    emotionAnchor: totalLeader,















    capacityAnchor,















    continuityLabel,















    continuityReasons,















    moneySignals,















    signals: [















      `主线方向：${mainLine ? mainLine.name : "暂无明确主线"}`,















      `总龙头：${totalLeader ? `${totalLeader.name}(${totalLeader.code})` : "暂无明确总龙头"}`,















      `容量锚定中军：${capacityAnchor ? `${capacityAnchor.name}(${capacityAnchor.code})` : "暂无明确容量锚定中军"}`,















      `持续性：${continuityLabel}`,















      "锚定规则：市场合力与市场高度绑定，总龙头由共识和高度共同决定",















      `验证逻辑：龙头高标 + 容量中军 + 低位补涨 + 连板高度`,















      moneySignals.length ? `大资金进场：${moneySignals.join("、")}` : "大资金确认不足，暂不把单点异动当主线",















      "跟随市场逻辑，先验证，再扩散，不做一日游逻辑",















    ],















  };















}































function buildRiskBoard(marketState, hotConcepts, externalRisk) {















  const blockedConcepts = [];















  const items = [];















  const blockedTicketTypes = new Set();















  const blockedSetups = new Set();































  // resonance=null（板块行情没抓到）不许当"未共振"拉黑——















  // 否则板块接口一次故障会把全部方向标成一日游、屏蔽整个候选池















  const oneDayRisks = hotConcepts















    .filter((concept) => concept.resonance !== null && !(concept.resonance && concept.count >= 4 && concept.limitCount >= 2))















    .slice(0, 6);































  for (const concept of oneDayRisks) {















    const coreDirection = Boolean(concept.isCoreDirection || (concept.directionState && concept.directionState.isCoreDirection));
    // 核心方向可以“今天亏钱、等待修复”，不能因为单日未共振就被当成垃圾题材永久拉黑。
    if (!coreDirection) blockedConcepts.push(concept.name);















    items.push({















      name: concept.name,















      severity: coreDirection ? "中" : concept.limitCount >= 1 ? "中" : "高",















      effect: coreDirection ? "保留核心活口，等待修复确认" : concept.limitCount >= 1 ? "次日冲高兑现概率大" : "一日游概率高",















      reason: coreDirection
        ? `${concept.directionState && concept.directionState.dailyLabel || "今日方向偏弱"}；这是核心方向的当日负反馈，不等同于方向失效`
        : concept.resonance















        ? `板块有热度，但龙头/中军/低位补涨结构不完整，容易只做一天`















        : `普通方向未形成相对强度或内部修复，热度容易退散`,















      blocked: !coreDirection,















      blockedType: coreDirection ? "核心方向负反馈" : "题材一日游",
      directionState: concept.directionState || null,















    });















  }































  if (marketState.cycle === "退潮") {















    blockedTicketTypes.add("情绪龙头票");















    blockedTicketTypes.add("补涨弹性票");















    blockedSetups.add("核心打板/分歧转强");















    items.unshift({















      name: "高标连板接力",















      severity: "高",















      effect: "次日负反馈大",















      reason: "退潮期高标连板容易出现核按钮和炸板扩散，接力方向不进入候选池",















      blocked: true,















      blockedType: "高标连板退潮",















    });















  }































  if (marketState.cycle === "冰点") {















    blockedTicketTypes.add("情绪龙头票");















    blockedSetups.add("核心打板/分歧转强");















    items.unshift({















      name: "情绪冰点追高",















      severity: "高",















      effect: "次日溢价差",















      reason: "冰点期追高容易被反向兑现，除绝对核心外不做情绪接力候选",















      blocked: true,















      blockedType: "情绪冰点",















    });















  }































  if (externalRisk && externalRisk.level === "高风险") {















    blockedTicketTypes.add("情绪龙头票");















    blockedTicketTypes.add("补涨弹性票");















    items.unshift({















      name: "外部风险冲击",















      severity: "高",















      effect: "高弹性方向先降权",















      reason: "外部指数和消息面波动偏大，优先保留容量趋势和绝对核心，减少情绪方向暴露",















      blocked: true,















      blockedType: "外部环境",















    });















  }































  if (marketState.cycle === "混沌") {















    blockedSetups.add("轮动回流第一强");















  }































  const mainLine = hotConcepts.find((concept) => concept.resonance && concept.count >= 4 && concept.limitCount >= 2) || hotConcepts[0] || null;















  if (mainLine && mainLine.resonance && mainLine.count >= 4) {















    blockedConcepts.splice(















      0,















      blockedConcepts.length,















      ...blockedConcepts.filter((name) => name !== mainLine.name),















    );















    items.unshift({















      name: "主线共振优先",















      severity: "低",















      effect: "主线即使有负反馈也更容易被盘活",















      reason: `当前应优先跟随主线「${mainLine.name}」；只要指数/板块共振仍在，局部负反馈更像换手和分歧，不应先把主线打死。`,















      blocked: false,















      blockedType: "主线优先",















    });















  }































  const level = items.some((item) => item.severity === "高") ? "高风险" : items.length ? "中风险" : "低风险";















  const summary =















    level === "高风险"















      ? "当前亏钱效应偏强，候选池只保留极少数核心结构，情绪追高方向先剔除。"















      : level === "中风险"















        ? "当前存在一日游和回撤风险，先过滤掉持续性不足的方向。"















        : "当前风险可控，但仍需按题材持续性做减法。";































  return {















    level,















    summary,















    items,















    blockedConcepts,















    blockedTicketTypes: [...blockedTicketTypes],















    blockedSetups: [...blockedSetups],















  };















}































function buildStyleAnalysis(tradingStyle, marketState, hotConcepts, candidates, externalRisk) {















  const ranked = candidates.slice().sort((a, b) => b.score - a.score);















  const tradable = ranked.filter((item) => !item.rejects.length);















  const sampleBase = tradable.length ? tradable : ranked;















  const topConcept = hotConcepts[0];































  const emotionCases = uniqueCases(















    sampleBase















      .filter((item) => isLimitLike(item) && (item.role === "龙头" || item.ticketType === "情绪龙头票" || item.role === "补涨"))















      .sort((a, b) => b.score - a.score),















    4,















    (stock) => `涨停/连板标签提供辨识度，角色为${stock.role}，适合验证高标抱团或情绪接力是否成立`,















    "高标情绪",















  );































  const trendCases = uniqueCases(















    sampleBase















      .filter((item) => isTrendLike(item) || item.ticketType === "容量票")















      .sort((a, b) => {















        const aLong = a.gamePlan ? a.gamePlan.longStrength : 0;















        const bLong = b.gamePlan ? b.gamePlan.longStrength : 0;















        return bLong - aLong || b.score - a.score;















      }),















    4,















    (stock) => `形态为${stock.klineProfile?.wave || "容量趋势"}，多单强度${stock.gamePlan?.longStrength || "--"}，更适合看趋势承接`,















    "容量趋势",















  );































  const rotationCases = uniqueCases(















    sampleBase















      .filter((item) => {















        const conceptInfo = hotConcepts.find((concept) => concept.name === item.mainConcept);















        return item.inBothSources && conceptInfo && conceptInfo.count >= 3 && item.changePct >= 2;















      })















      .sort((a, b) => b.score - a.score),















    4,















    (stock) => `东方财富与同花顺双榜共振，且${stock.mainConcept}方向上榜密度高，适合观察次日回流溢价`,















    "轮动回流",















  );































  const mainlineCases = uniqueCases(















    sampleBase















      .filter((item) => topConcept && item.mainConcept === topConcept.name)















      .sort((a, b) => b.score - a.score),















    4,















    (stock) => `${topConcept.name}方向内核心样本，角色为${stock.role}，用于验证板块主线是否继续扩散`,















    "主线共振",















  );































  let examples = rotationCases;















  let location = "热度方向的次日回流溢价";















  if (tradingStyle.preference === "主线进攻") {















    examples = mainlineCases.length ? mainlineCases : rotationCases;















    location = "主线板块的龙头、中军和补涨联动";















  } else if (tradingStyle.preference === "趋势二波/三波") {















    examples = trendCases.length ? trendCases : rotationCases;















    location = "容量趋势和二波/三波形态的承接";















  } else if (tradingStyle.preference === "高标抱团") {















    examples = emotionCases.length ? emotionCases : mainlineCases;















    location = "高辨识度情绪核心或连板抱团";















  }















  if (!examples.length) {















    examples = uniqueCases(















      sampleBase.slice(0, 4),















      4,















      (stock) => `综合分${stock.score}，热度排名${stock.combinedRank}，作为当前样本池里最接近核心的观察对象`,















      "综合样本",















    );















  }































  const continuity = continuityView(tradingStyle, marketState, hotConcepts, examples, externalRisk);















  const topDirectionText = topConcept















    ? `${topConcept.name}：热榜${topConcept.count}只，涨停/连板${topConcept.limitCount}只，${topConcept.resonance ? "板块指数共振" : "板块指数未共振"}`















    : "暂无明显聚焦方向";















  const exampleNames = examples.length















    ? examples.slice(0, 3).map((item) => `${item.name}(${item.role})`).join("、")















    : "暂无清晰案例";































  return {















    conclusion: `当前风格偏好判为「${tradingStyle.preference}」`,















    location,















    reverseLogic: [















      `先看结果：赚钱效应主要落在「${location}」，代表案例是 ${exampleNames}。`,















      `再倒推方向：${topDirectionText}，这是判断资金是否聚焦、是否跟指数共振的核心证据。`,















      `再倒推风格：趋势二波/三波样本${tradingStyle.trendWaveCount}只，容量趋势样本${tradingStyle.capacityTrendCount}只，涨停/连板样本${tradingStyle.hotLimitCount}只，所以当前偏好不是主观猜测，而是由样本分布推出。`,















      `最后倒推持续性：${continuity.label}，原因是${continuity.reasons.join("；")}。`,















    ],















    examples,















    profitEffect: {















      location,















      cases: examples,















      continuity: continuity.label,















      continuityLevel: continuity.level,















      continuityReasons: continuity.reasons,















    },















    buckets: {















      emotion: emotionCases,















      trend: trendCases,















      rotation: rotationCases,















      mainline: mainlineCases,















    },















  };















}































function summarizeDirectionMembers(changes = []) {
  const valid = changes.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) {
    return { sampleCount: 0, avgChangePct: null, medianChangePct: null, upRate: null, downRate: null, strongCount: 0 };
  }
  const middle = Math.floor(valid.length / 2);
  const medianChangePct = valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
  return {
    sampleCount: valid.length,
    avgChangePct: Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 100) / 100,
    medianChangePct: Math.round(medianChangePct * 100) / 100,
    upRate: Math.round((valid.filter((value) => value > 0).length / valid.length) * 1000) / 1000,
    downRate: Math.round((valid.filter((value) => value < 0).length / valid.length) * 1000) / 1000,
    strongCount: valid.filter((value) => value >= 3).length,
  };
}

function classifyDirectionResonance(input = {}) {
  const sector = input.sector || null;
  const indexChange = Number.isFinite(Number(input.indexChange)) ? Number(input.indexChange) : 0;
  const count = Number(input.count || 0);
  const limitCount = Number(input.limitCount || 0);
  const avgChangePct = input.avgChangePct !== null && input.avgChangePct !== undefined && Number.isFinite(Number(input.avgChangePct)) ? Number(input.avgChangePct) : null;
  const upRate = input.upRate !== null && input.upRate !== undefined && Number.isFinite(Number(input.upRate)) ? Number(input.upRate) : null;
  const downRate = input.downRate !== null && input.downRate !== undefined && Number.isFinite(Number(input.downRate)) ? Number(input.downRate) : null;
  const strongCount = Number(input.strongCount || 0);
  const sectorChangePct = sector && Number.isFinite(Number(sector.changePct)) ? Number(sector.changePct) : null;
  const relativeToIndex = sectorChangePct === null ? null : Math.round((sectorChangePct - indexChange) * 100) / 100;
  const memberRelativeToIndex = avgChangePct === null ? null : Math.round((avgChangePct - indexChange) * 100) / 100;
  const breadthConfirmed = limitCount >= 1 || strongCount >= 2 || (upRate !== null && upRate >= 0.45);
  const absolute = sectorChangePct !== null && sectorChangePct > 0 && relativeToIndex >= 0;
  const relative = sectorChangePct !== null && sectorChangePct <= 0 && relativeToIndex >= 0.8 && breadthConfirmed;
  const internalRepair = sectorChangePct !== null
    && count >= 5
    && (limitCount >= 2 || strongCount >= 3)
    && ((upRate !== null && upRate >= 0.35) || (memberRelativeToIndex !== null && memberRelativeToIndex >= 1.5))
    && relativeToIndex >= -0.3;
  let resonanceType = "none";
  let resonance = false;
  if (absolute) {
    resonanceType = "absolute";
    resonance = true;
  } else if (relative) {
    resonanceType = "relative";
    resonance = true;
  } else if (internalRepair) {
    resonanceType = "repair";
    resonance = true;
  } else if (sectorChangePct === null) {
    resonanceType = "unverified";
    resonance = null;
  }
  const isCoreDirection = Boolean(count >= 6 && (limitCount >= 2 || strongCount >= 3 || (upRate !== null && upRate >= 0.55)));
  let dailyKey = "mixed";
  if ((avgChangePct !== null && avgChangePct >= 1.5) || (upRate !== null && upRate >= 0.65)) dailyKey = "profit";
  else if ((avgChangePct !== null && avgChangePct <= -1.5) || (downRate !== null && downRate >= 0.65)) dailyKey = "loss";
  const dailyLabel = dailyKey === "profit" ? "今日赚钱效应" : dailyKey === "loss" ? "今日亏钱效应" : "今日分化";
  const repairKey = resonanceType === "relative" || resonanceType === "repair"
    ? "active"
    : isCoreDirection && dailyKey === "loss"
      ? "watch"
      : "none";
  const resonanceLabel = resonanceType === "absolute"
    ? "绝对共振"
    : resonanceType === "relative"
      ? "相对抗跌共振"
      : resonanceType === "repair"
        ? "内部修复共振"
        : resonanceType === "unverified"
          ? "板块行情待验证"
          : "共振不足";
  const repairLabel = repairKey === "active" ? "修复信号已出现" : repairKey === "watch" ? "等待修复发起者" : "暂无修复信号";
  return {
    resonance,
    resonanceType,
    resonanceLabel,
    relativeToIndex,
    memberRelativeToIndex,
    isCoreDirection,
    coreLabel: isCoreDirection ? "核心方向" : "一般方向",
    dailyKey,
    dailyLabel,
    repairKey,
    repairLabel,
  };
}

function conceptStats(rows, sectorRows, snapshot) {















  const stats = new Map();
  const hotSourceRows = rows.filter((item) => !(item && item.coreWatchRetained && !item.eastRank && !item.thsRank));































  for (const item of hotSourceRows) {















    // 没有概念标签的票不聚合成"未归类"伪方向——方向必须有具体板块名，















    // 标签缺失是数据质量问题（由 fetchStatus.unclassified 明示），不是一个可交易的方向















    const concepts = (item.concepts || []).filter(Boolean);















    if (!concepts.length) continue;















    for (const concept of concepts.slice(0, 2)) {















      const current = stats.get(concept) || { count: 0, avgRank: 0, limitCount: 0, changes: [] };















      current.count += 1;















      current.avgRank += item.combinedRank || 31;















      if (isLimitUp(item) || boardHeight(item) > 0) current.limitCount += 1;
      if (Number.isFinite(Number(item.changePct))) current.changes.push(Number(item.changePct));















      stats.set(concept, current);















    }















  }































  const index = snapshot ? snapshot.avgIndexChange : 0;































  return [...stats.entries()]















    .map(([name, stat]) => {















      const sector = findSectorMatch(name, sectorRows || []);















      const avgRank = stat.avgRank / stat.count;
      const memberStats = summarizeDirectionMembers(stat.changes);















      const heatScore = stat.count * 18 + stat.limitCount * 10 + Math.max(0, 50 - avgRank);















      const relativeToIndex = sector ? sector.changePct - index : 0;















      const resonanceScore = sector















        ? clamp(relativeToIndex / 4, 0, 1) * 36 +















          (sector.changePct > 0 ? 18 : 0) +















          (sector.mainInflowYi > 0 ? 12 : 0) +















          clamp(sector.amountYi / 800, 0, 1) * 14















        : 8;















      // 共振三态：true=验证了共振 / false=验证了未共振 / null=板块行情没抓到、无法验证















      // null 不许当 false 用——"无法验证"不是"不合格"（下游剔除/风险栏都要区分）















      const directionState = classifyDirectionResonance({
        sector,
        indexChange: index,
        count: stat.count,
        limitCount: stat.limitCount,
        ...memberStats,
      });































      return {















        name,















        count: stat.count,















        avgRank,















        limitCount: stat.limitCount,















        heatScore: Math.round(heatScore),















        resonanceScore: Math.round(resonanceScore),















        score: Math.round(heatScore * 0.62 + resonanceScore * 0.38),















        resonance: directionState.resonance,
        resonanceType: directionState.resonanceType,
        resonanceLabel: directionState.resonanceLabel,
        relativeToIndex: directionState.relativeToIndex,
        memberStats,
        isCoreDirection: directionState.isCoreDirection,
        directionState,
        indexChange: index,















        sector,















      };















    })















    .sort((a, b) => b.score - a.score);















}































// ===== 相关题材聚类：同链条概念不许各立山头 =====















// 现实：一只票带多个概念标签（埃斯顿=工业母机+人形机器人），旧逻辑取第一个匹配，















// 把同一条炒作链硬拆成多个"方向"、各封各的龙头。合并判据全部是可验证事实（无人工映射表）：















//   ① 成员重叠率（交集/较小集）≥50% —— 两个标签圈的是同一批票















//   ② 共享真涨停成员 —— 同一只涨停核心同时带两个概念 = 同一条主线（埃斯顿案例）















// 迭代合并直到稳定：减速器↔工业母机↔人形机器人这类链式关系要能传递归并。















function clusterHotConcepts(concepts, rows) {
  const clusterRows = rows.filter((item) => !(item && item.coreWatchRetained && !item.eastRank && !item.thsRank));















  const conceptGroupMap = new Map([















    ["存储芯片", "AI算力"],















    ["CPO", "AI算力"],















    ["共封装光学(CPO)", "AI算力"],















    ["光模块", "AI算力"],















    ["光纤概念", "AI算力"],















    ["算力租赁", "AI算力"],















    ["服务器", "AI算力"],















    ["液冷服务器", "AI算力"],















    ["先进封装", "AI算力"],















  ]);















  const resolveGroup = (name) => canonicalThemeFamily(name);















  let clusters = concepts.map((c) => {















    const targetGroup = resolveGroup(c.name);















    const members = clusterRows.filter((s) => (s.concepts || []).some((conceptName) => resolveGroup(conceptName) === targetGroup));















    return {















      base: c,















      names: [c.name],















      members: new Set(members.map((s) => s.code)),















      limitMembers: new Set(members.filter((s) => isLimitUp(s) || boardHeight(s) > 0).map((s) => s.code)),















    };















  });
  // 互斥规则：防止"军工"和"AI算力/存储芯片"合并
  const exclusiveGroups = [
    new Set(["军工信息化", "军工", "军民融合", "商业航天", "国防军工", "航母", "国产航母", "卫星导航", "海工装备"]),
    new Set(["AI算力", "存储芯片", "CPO", "先进封装", "算力租赁", "共封装光学(CPO)", "光模块", "光纤概念", "服务器", "液冷服务器", "中国AI 50", "东数西算(算力)", "国家大基金持股", "高端装备"])
  ];

  const areExclusive = (nameA, nameB) => {
    for (const group of exclusiveGroups) {
      if (group.has(nameA) && group.has(nameB)) return false; // 同组可合并
      if (group.has(nameA) || group.has(nameB)) {
        // 有一个在互斥组，检查另一个是否在其他互斥组
        for (const otherGroup of exclusiveGroups) {
          if (otherGroup !== group && ((group.has(nameA) && otherGroup.has(nameB)) || (group.has(nameB) && otherGroup.has(nameA)))) {
            return true; // 跨组互斥
          }
        }
      }
    }
    return false;
  };

































  const canMerge = (a, b) => {
































    // 家族级聚类只能合并显式属于同一母题材的细分。尤其 AI 算力与医药，
    // 不能因为一只股票概念交叉就把 PCB、氟化工等其他交易逻辑并入。
    const familyA = resolveGroup(a.names[0]);
    const familyB = resolveGroup(b.names[0]);
    if (
      familyA !== familyB
      && [AI_COMPUTE_FAMILY, MEDICAL_FAMILY].some((family) => familyA === family || familyB === family)
    ) return false;

    // 检查互斥规则
































    if (areExclusive(a.names[0], b.names[0])) return false;
















    const small = a.members.size <= b.members.size ? a : b;















    const big = small === a ? b : a;















    if (!small.members.size) return false;















    const inter = [...small.members].filter((x) => big.members.has(x)).length;















    if (inter / small.members.size >= 0.5) return true;















    return [...a.limitMembers].some((x) => b.limitMembers.has(x));















  };































  let changed = true;















  while (changed) {















    changed = false;















    outer: for (let i = 0; i < clusters.length; i++) {















      for (let j = i + 1; j < clusters.length; j++) {















        if (!canMerge(clusters[i], clusters[j])) continue;















        const [into, from] = [clusters[i], clusters[j]]; // i 在前=score更高,做主概念















        into.names.push(...from.names);















        for (const x of from.members) into.members.add(x);















        for (const x of from.limitMembers) into.limitMembers.add(x);















        clusters.splice(j, 1);















        changed = true;















        break outer;















      }















    }















  }































  const conceptByName = new Map((concepts || []).map((item) => [item.name, item]));
  return clusters















    .map((cl) => {















      const family = resolveGroup(cl.base.name);
      const familyCluster = cl.names.some((name) => name !== family && resolveGroup(name) === family);
      const name = familyCluster ? family : cl.base.name;
      const aliases = cl.names.filter((item) => item && item !== name);
      const matchNames = Array.from(new Set([name, ...cl.names]));
      const subthemeCandidates = cl.names
        .filter((item) => item && item !== family && resolveGroup(item) === family)
        .map((item) => conceptByName.get(item))
        .filter(Boolean)
        .map((item) => ({
          name: item.name,
          family,
          score: Number(item.score || 0),
          count: Number(item.count || 0),
          limitCount: Number(item.limitCount || 0),
          avgRank: Number.isFinite(Number(item.avgRank)) ? Number(item.avgRank) : null,
          resonance: item.resonance === true ? true : item.resonance === false ? false : null,
          resonanceType: item.resonanceType || "unverified",
          resonanceLabel: item.resonanceLabel || "板块行情待验证",
          relativeToIndex: Number.isFinite(Number(item.relativeToIndex)) ? Number(item.relativeToIndex) : null,
          memberStats: item.memberStats || null,
          sector: item.sector || null,
        }))
        .sort((left, right) => right.score - left.score || right.limitCount - left.limitCount || right.count - left.count);
      const memberRows = clusterRows.filter((item) => cl.members.has(item.code));
      const memberStats = summarizeDirectionMembers(memberRows.map((item) => item.changePct));
      const indexChange = Number(cl.base.indexChange || 0);
      const sector = cl.names
        .map((name) => conceptByName.get(name))
        .filter((item) => item && item.sector)
        .sort((a, b) => Number(b.relativeToIndex || -99) - Number(a.relativeToIndex || -99))[0]?.sector || cl.base.sector || null;
      const directionState = classifyDirectionResonance({
        sector,
        indexChange,
        count: cl.members.size,
        limitCount: cl.limitMembers.size,
        ...memberStats,
      });















      return {















        ...cl.base,















        family,















        name,















        aliases,















        matchNames,















        displayName: familyCluster
          ? `${family}（细分：${aliases.join("/")}）`
          : aliases.length ? `${name}（含${aliases.join("/")}）` : name,
        primarySubtheme: familyCluster ? cl.base.name : null,
        subthemeCandidates,
        aggregationLevel: familyCluster ? "family" : "theme",
        exactSubthemeMetricsRequired: familyCluster,
        sector,
        resonance: directionState.resonance,
        resonanceType: directionState.resonanceType,
        resonanceLabel: directionState.resonanceLabel,
        relativeToIndex: directionState.relativeToIndex,
        memberStats,
        isCoreDirection: directionState.isCoreDirection,
        directionState,















        count: cl.members.size,















        limitCount: cl.limitMembers.size,















        // 热度按聚类后的真实规模重估（沿用 conceptStats 同款公式的规模项）















        heatScore: Math.round(cl.members.size * 18 + cl.limitMembers.size * 10 + Math.max(0, 50 - cl.base.avgRank)),















        score: Math.round(















          (cl.members.size * 18 + cl.limitMembers.size * 10 + Math.max(0, 50 - cl.base.avgRank)) * 0.62 +















            cl.base.resonanceScore * 0.38,















        ),















      };















    })















    .sort((a, b) => b.score - a.score);















}































// roleContext / classifyRole 已迁移至 leader-select.js(真涨停先决+连板高度主导+中军当日不弱)































function classifyTicketType(stock, role = "") {















  const floatValueYi = Number(stock.floatMarketValue || stock.totalMarketValue || 0) / 100000000;















  const amountYi = Number(stock.amountYi || 0);















  const isLargeValue = floatValueYi >= 350 || amountYi >= 35;















  const isBoard = isLimitUp(stock) || boardHeight(stock) > 0;































  if (role === "中军" || isLargeValue) {















    return {















      type: "容量票",















      reason: `流通市值约${Math.round(floatValueYi)}亿、成交额${amountYi || "--"}亿，适合看趋势承接和资金容量`,















    };















  }































  if (role === "补涨") {















    return {















      type: "补涨弹性票",















      reason: "同方向次强弹性，依赖龙头超预期和板块扩散",















    };















  }































  if ((role === "龙头" || !role) && isBoard && !isLargeValue) {















    return {















      type: "情绪龙头票",















      reason: "涨停/连板辨识度强，主要博弈分歧转一致和次日溢价",















    };















  }































  return {















    type: "趋势观察票",















    reason: "未形成明确连板情绪或容量中军属性，先观察承接",















  };















}































function buildTradePlan(stock, role, marketState, tradingStyle, ticketType) {















  let buy = "等待确认，不主动追高";















  let nextDay = "次日以是否有溢价和承接作为去留依据";















  let sell = "不及预期、板块回流失败或跌破分时均线转弱则退出";















  let risk = "不做后排扩散，仓位服从当前周期";















  let gameTarget = "博弈方向：先看资金愿不愿意给溢价";































  if (ticketType.type === "容量票") {















    buy = "容量票不按情绪打板处理，优先看板块共振后的低吸承接：回踩均线不破、分时承接强、成交额继续放大时参与。";















    nextDay = "次日不要求连板，要求放量趋势上行或强于指数；高开过多但量能不跟，容易冲高兑现。";















    sell = "跌破前一日承接低点、板块指数转弱、主力净流入转负或放量长上影，先卖第一笔。";















    risk = "容量票吃的是趋势和资金容量，不是连板溢价，不能用情绪票的加速预期来要求。";















    gameTarget = "博弈方向：趋势延续和容量承接，不博弈纯情绪溢价。";















  }































  if (tradingStyle.preference === "趋势二波/三波") {















    if (ticketType.type === "容量票" || ["二波突破", "二波趋势重建", "三波/高位趋势"].includes(stock.klineProfile?.wave)) {















      buy = "趋势二波/三波偏好下，优先买分歧后的趋势承接：回踩5日线/分时均价线不破、放量重新转强时参与。";















      nextDay = "次日看趋势延续和成交额承接，不要求连板；若高开冲高但量能背离，先兑现。";















      sell = "跌破趋势承接位、放量长上影、二波突破失败或板块容量中军转弱，先卖第一笔。";















      risk = "趋势票买的是二波/三波持续，不是情绪秒板；追高一致加速会降低盈亏比。";















      gameTarget = "博弈方向：趋势和二波延续，核心看承接与量能，不赌单日高潮。";















    }















  }































  if (ticketType.type !== "容量票" && tradingStyle.style === "板块主升") {















    if (role === "龙头") {















      buy = "优先买首次分歧转强，盘中炸板回封或分歧后承接不破均价线可参与；强一致高开秒板不追，只等换手确认。";















      nextDay = "次日预期应有高溢价或继续加速，低开不能快速翻红视为不及预期。";















      sell = "龙头断板且不能弱转强、板块涨停梯队掉队、放量长上影即减仓或退出。";















      gameTarget = "博弈方向：连板溢价和情绪接力，重点看次日是否继续给高溢价。";















    } else if (role === "中军") {















      buy = "板块主升时，中军适合低吸承接，不适合无脑打板；回踩均线或盘中分歧承接强再买。";















      nextDay = "次日看是否继续放量趋势上行，不能跟随板块走强就降低预期。";















      sell = "跌破前一日低点或板块龙头转弱时退出。";















      gameTarget = "博弈方向：趋势承接，不是单纯连板溢价。";















    } else if (role === "补涨") {















      buy = "只做龙头持续超预期后的补涨首板或二板确认，不能在补涨后半段追高。";















      nextDay = "次日必须有连板或高溢价，否则补涨属性容易兑现。";















      sell = "低于预期竞价、开盘冲高回落、龙头分歧扩大就卖。";















      gameTarget = "博弈方向：板块扩散后的补涨溢价。";















    }















  } else if (ticketType.type !== "容量票" && tradingStyle.style === "板块轮动") {















    buy = "只买回流第一强，优先分歧低吸或回流确认；高开过多不追，等盘中换手和板块回流确认。";















    nextDay = "次日看板块是否继续回流，若只有个股独强但板块不跟，按兑现处理。";















    sell = "板块回流失败、后排不跟、核心冲高回落即减仓。";















    gameTarget = "博弈方向：次日回流溢价，不赌连续加速。";















  } else if (ticketType.type !== "容量票" && tradingStyle.style === "个股轮动") {















    buy = "个股轮动期不做板块扩散，只看双榜共振且辨识度最高的核心；买点以弱转强或充分分歧后的承接为主。";















    nextDay = "次日必须强于同批热股，否则说明资金切换。";















    sell = "热度排名下滑、竞价不及预期、开盘不能快速转强就退出。";















    gameTarget = "博弈方向：个股轮动中的次日溢价。";















  } else if (ticketType.type !== "容量票" && tradingStyle.style === "情绪抱团") {















    buy = "混沌期优先试错低位新东西：先看首板、二板和近两天开始转强的票，不碰高位追涨；买点放在分歧承接，不买一致加速。";















    nextDay = "次日要看低位试错有没有继续被资金接住；如果只是一日游或没有延续，直接撤退。";















    sell = "低开低走、炸板不回封、同类高标负反馈扩大，立刻退出。";















    risk = "这是混沌里的试错，不是主升追高；核心是判断新方向能不能站住。";















    gameTarget = "博弈方向：低位新方向的次日延续和板块确认。";















  } else if (tradingStyle.style === "防守空仓") {















    buy = "当前不开放新仓，只记录观察。";















    nextDay = "等待亏钱效应收敛和修复信号。";















    sell = "已有持仓以降风险为主。";















    gameTarget = "博弈方向：先活下来，不参与新溢价。";















  }































  if (















    ticketType.type !== "容量票" &&















    ticketType.type !== "补涨弹性票" &&















    marketState.cycle === "冰点" &&















    role !== "龙头"















  ) {















    buy = "冰点期非龙头不买，只作为情绪观察样本。";















  }































  return {















    style: tradingStyle.style,















    ticketType: ticketType.type,















    gameTarget,















    buy,















    nextDay,















    sell,















    risk,















  };















}































function capitalLongSignal(stock) {















  let strength = 0;















  const reasons = [];































  if (stock.mainInflowYi > 0) {















    strength += 35;















    reasons.push(`主力净流入${stock.mainInflowYi}亿`);















  }















  if (stock.amountYi >= 15) {















    strength += 25;















    reasons.push(`成交额${stock.amountYi}亿`);















  } else if (stock.amountYi >= 8) {















    strength += 16;















    reasons.push(`成交额${stock.amountYi}亿`);















  }















  if (stock.volumeRatio >= 1.5) {















    strength += 18;















    reasons.push(`量比${stock.volumeRatio}`);















  } else if (stock.volumeRatio >= 1.1) {















    strength += 10;















    reasons.push(`量比${stock.volumeRatio}`);















  }















  if (stock.turnoverRate >= 8 && stock.turnoverRate <= 35) {















    strength += 18;















    reasons.push(`换手${stock.turnoverRate}%`);















  }















  if (isLimitUp(stock)) {















    strength += 12;















    reasons.push("真涨停封板，资金确认");















  }































  return {















    strength: Math.min(100, Math.round(strength)),















    pass: strength >= 65,















    reasons,















  };















}































function pct(from, to) {















  if (!from) return 0;















  return ((to - from) / from) * 100;















}































function avg(values) {















  const valid = values.filter((value) => Number.isFinite(value));















  if (!valid.length) return 0;















  return valid.reduce((sum, value) => sum + value, 0) / valid.length;















}































function maxDrawdownFromEntry(entry, rows) {















  if (!entry || !rows.length) return 0;















  return Math.min(...rows.map((item) => pct(entry, item.low)));















}































function classifyBacktestSignal(day, prevRows, stock, tradingStyle) {















  const prev5 = prevRows.slice(-5);















  const prev20 = prevRows.slice(-20);















  const avgAmount5 = avg(prev5.map((item) => item.amount));















  const high20 = prev20.length ? Math.max(...prev20.map((item) => item.high)) : day.high;















  const low20 = prev20.length ? Math.min(...prev20.map((item) => item.low)) : day.low;















  const rise20 = prev20.length ? pct(prev20[0].close, day.close) : 0;















  const nearHigh20 = high20 ? day.close >= high20 * 0.94 : false;















  const volumeBreakout = avgAmount5 ? day.amount >= avgAmount5 * 1.18 : false;















  // 历史K线的涨停判定:用当日收盘 vs 前收按板块规则推算(修旧版9.5%线对20cm票的误判)















  const isLimit = isLimitUp({















    code: stock.code,















    name: stock.name,















    price: day.close,















    prevClose: prevRows.length ? prevRows[prevRows.length - 1].close : null,















  });















  const turnoverOk = !day.turnover || (day.turnover >= 3 && day.turnover <= 42);















  const trendSignal = nearHigh20 && volumeBreakout && rise20 >= 8 && day.changePct >= 1.2 && day.changePct <= 9.2;















  const capacitySignal = stock.ticketType === "容量票" && volumeBreakout && day.changePct >= 0.8 && day.changePct <= 8.8;















  const emotionSignal = isLimit && turnoverOk;















  const rotationSignal = day.changePct >= 2.5 && volumeBreakout && nearHigh20;































  if (stock.ticketType === "容量票" && capacitySignal) {















    return { pass: true, type: "容量趋势触发", reason: "成交放大且涨幅未过度加速，符合容量票承接倒推条件" };















  }































  if (stock.ticketType === "情绪龙头票" && emotionSignal) {















    return { pass: true, type: "情绪龙头触发", reason: "当日涨停且换手未失控，符合情绪龙头倒推条件" };















  }































  if (stock.ticketType === "补涨弹性票" && (emotionSignal || rotationSignal)) {















    return { pass: true, type: "补涨弹性触发", reason: "涨停或放量接近阶段高点，符合补涨弹性倒推条件" };















  }































  if (stock.ticketType === "趋势观察票" && (trendSignal || rotationSignal)) {















    return { pass: true, type: "趋势观察触发", reason: "放量接近20日高点，符合趋势/轮动观察倒推条件" };















  }































  if (tradingStyle.preference === "趋势二波/三波" && (trendSignal || capacitySignal)) {















    return { pass: true, type: "趋势/容量触发", reason: "放量接近20日高点，涨幅未过度加速，符合趋势二波或容量承接的倒推条件" };















  }































  if (tradingStyle.preference === "高标抱团" && emotionSignal) {















    return { pass: true, type: "高标抱团触发", reason: "当日涨停且换手未失控，符合高辨识度情绪核心的倒推条件" };















  }































  if (tradingStyle.preference === "轮动回流" && rotationSignal) {















    return { pass: true, type: "轮动回流触发", reason: "放量上攻并接近20日高点，适合观察次日回流溢价" };















  }































  if (tradingStyle.preference === "主线进攻" && (emotionSignal || trendSignal)) {















    return { pass: true, type: "主线进攻触发", reason: "涨停辨识度或趋势承接成立，符合主线核心倒推条件" };















  }































  return { pass: false };















}































function buildBacktestSummary(trades) {















  if (!trades.length) {















    return {















      sampleCount: 0,















      winRate1d: 0,















      winRate3d: 0,















      avgNextOpen: 0,















      avgNextClose: 0,















      avgMax3d: 0,















      worstDrawdown: 0,















      verdict: "样本不足",















      note: "近180日内没有找到足够相似的历史触发点，暂不把回测当作加分项。",















    };















  }































  const winRate1d = (trades.filter((item) => item.nextClosePct > 0).length / trades.length) * 100;















  const winRate3d = (trades.filter((item) => item.max3dPct > 2).length / trades.length) * 100;















  const avgNextOpen = avg(trades.map((item) => item.nextOpenPct));















  const avgNextClose = avg(trades.map((item) => item.nextClosePct));















  const avgMax3d = avg(trades.map((item) => item.max3dPct));















  const worstDrawdown = Math.min(...trades.map((item) => item.maxDrawdownPct));















  let verdict = "谨慎";















  if (trades.length >= 3 && winRate1d >= 60 && avgNextClose > 1) verdict = "可验证";















  if (trades.length >= 4 && winRate1d >= 70 && avgMax3d > 4) verdict = "历史有效";















  if (avgNextClose < 0 || worstDrawdown <= -8) verdict = "回测偏弱";































  return {















    sampleCount: trades.length,















    winRate1d: Math.round(winRate1d),















    winRate3d: Math.round(winRate3d),















    avgNextOpen: Math.round(avgNextOpen * 100) / 100,















    avgNextClose: Math.round(avgNextClose * 100) / 100,















    avgMax3d: Math.round(avgMax3d * 100) / 100,















    worstDrawdown: Math.round(worstDrawdown * 100) / 100,















    verdict,















    note:















      verdict === "历史有效"















        ? "历史相似触发后次日和三日溢价都较好，可作为当前候选加分。"















        : verdict === "可验证"















          ? "历史相似触发有一定溢价，但仍要服从当下周期和板块共振。"















          : verdict === "回测偏弱"















            ? "历史相似触发后收益或回撤不理想，当前只能降低预期。"















            : "样本或收益质量一般，不能单独作为买入理由。",















  };















}































function runStockBacktest(stock, rows, tradingStyle) {















  const trades = [];















  if (rows.length < 45) {















    return {















      summary: buildBacktestSummary([]),















      cases: [],















      trades: [],















    };















  }































  for (let index = 25; index < rows.length - 3; index += 1) {















    const day = rows[index];















    const prevRows = rows.slice(Math.max(0, index - 25), index);















    const signal = classifyBacktestSignal(day, prevRows, stock, tradingStyle);















    if (!signal.pass) continue;































    const next = rows[index + 1];















    const next3 = rows.slice(index + 1, index + 4);















    const entry = day.close;















    trades.push({















      date: day.date,















      type: signal.type,















      reason: signal.reason,















      triggerChangePct: Math.round(day.changePct * 100) / 100,















      triggerTurnover: Math.round((day.turnover || 0) * 100) / 100,















      nextOpenPct: Math.round(pct(entry, next.open) * 100) / 100,















      nextClosePct: Math.round(pct(entry, next.close) * 100) / 100,















      max3dPct: Math.round(pct(entry, Math.max(...next3.map((item) => item.high))) * 100) / 100,















      maxDrawdownPct: Math.round(maxDrawdownFromEntry(entry, next3) * 100) / 100,















    });















  }































  const recentTrades = trades.slice(-8).reverse();















  return {















    summary: buildBacktestSummary(trades),















    cases: recentTrades,















    trades,















  };















}































async function enrichBacktests(candidates, tradingStyle) {















  const targets = candidates.slice(0, 16);















  const chunks = [];















  for (let index = 0; index < targets.length; index += 4) {















    chunks.push(targets.slice(index, index + 4));















  }































  const byCode = new Map();















  const poolTrades = new Map();















  for (const chunk of chunks) {















    const rowsList = await Promise.all(chunk.map((stock) => fetchKlineRows(stock, 180)));















    for (let index = 0; index < chunk.length; index += 1) {















      const stock = chunk[index];















      const result = runStockBacktest(stock, rowsList[index], tradingStyle);















      byCode.set(stock.code, result);















      const bucket = stock.ticketType || "未分类";















      const current = poolTrades.get(bucket) || [];















      current.push(...result.trades.map((trade) => ({ ...trade, stockName: stock.name, code: stock.code })));















      poolTrades.set(bucket, current);















    }















  }































  return candidates.map((stock) => ({















    ...stock,















    backtest: (() => {















      const own = byCode.get(stock.code) || {















        summary: buildBacktestSummary([]),















        cases: [],















        trades: [],















      };















      const pool = poolTrades.get(stock.ticketType || "未分类") || [];















      const poolSummary = buildBacktestSummary(pool);















      const mode = own.summary.sampleCount >= 3 ? "个股历史" : poolSummary.sampleCount >= 3 ? "同类模式池" : "样本不足";















      const effectiveSummary =















        mode === "个股历史"















          ? own.summary















          : mode === "同类模式池"















            ? {















                ...poolSummary,















                verdict: `模式${poolSummary.verdict}`,















                note: `个股历史样本不足，改用${stock.ticketType}同类模式池倒推：${poolSummary.note}`,















              }















            : own.summary;















      const effectiveCases =















        mode === "个股历史"















          ? own.cases















          : pool















              .slice(-8)















              .reverse()















              .map((item) => ({















                ...item,















                type: `${item.stockName} ${item.type}`,















              }));































      return {















        mode,















        summary: effectiveSummary,















        ownSummary: own.summary,















        poolSummary,















        cases: effectiveCases,















      };















    })(),















  }));















}































function buildGamePlan(stock, conceptInfo, role, marketState, tradingStyle, ticketType) {















  const longSignal = capitalLongSignal(stock);















  const isResonance = Boolean(conceptInfo && conceptInfo.resonance);















  const sectorLine = isResonance















    ? `板块可博弈：${conceptInfo.resonanceLabel || "共振成立"}，热榜内有${conceptInfo.count}只同方向股票。`















    : marketState.cycle === "冰点"















      ? "板块未共振，但冰点期允许少数情绪抱团核心试错。"















      : "板块暂未与指数共振，不满足主动博弈条件。";































  let priceLine = "个股涨幅未进入强势区，先观察承接。";















  if (ticketType.type === "容量票") {















    if (stock.changePct >= 7) {















      priceLine = "容量票涨幅过大时不适合追高，优先等盘中回踩承接或次日分歧低吸。";















    } else if (stock.changePct >= 2) {















      priceLine = "容量票涨幅2%-7%更适合博弈，重点看趋势承接、成交额和主力净流入延续。";















    } else {















      priceLine = "容量票涨幅不强，只能作为板块中军观察，等放量站强再考虑。";















    }















  } else if (isLimitUp(stock)) {















    priceLine = "情绪票真涨停封板，适合看换手回封/分歧转一致，不适合一致缩量追高。";















  } else if (stock.changePct >= 5) {















    priceLine = "情绪票涨幅5%以上，适合看板块回流后的半路确认或所属预期路线的承接确认。";















  } else if (stock.changePct >= 2) {















    priceLine = "情绪票涨幅2%-5%，只在板块明确回流且承接强时低吸。";















  }































  const longLine = longSignal.pass















    ? `多单达标：${longSignal.reasons.join("，")}，可视为大资金入场代理信号。`















    : `多单未达标：当前强度${longSignal.strength}/100，需等待主力净流入、成交额或量比进一步确认。`;































  let holderLine = "持筹方：以不及预期先减仓为原则，保留强更强的机会。";















  let preferenceLine =















    tradingStyle.preference === "趋势二波/三波"















      ? `风格偏好：趋势二波/三波，当前形态为${stock.klineProfile?.wave || "未知"}。`















      : tradingStyle.preference === "高标抱团"















        ? "风格偏好：高标抱团，只做最高辨识度核心。"















        : tradingStyle.preference === "轮动回流"















          ? "风格偏好：轮动回流，核心目标是博弈次日资金回流溢价。"















          : "风格偏好：主线进攻，围绕核心方向做首次分歧。";















  if (ticketType.type === "容量票") {















    holderLine = "容量票持筹方：次日低开超过-2%且不能快速收回均价线，先卖第一笔；放量跌破前一日承接低点，卖第二笔或清仓。";















  } else if (ticketType.type === "补涨弹性票") {















    holderLine = "补涨持筹方：次日不连板或高开冲高回落，先卖第一笔；龙头分歧扩大，直接降低预期。";















  } else if (tradingStyle.style === "板块主升") {















    holderLine = "持筹方：次日高开3%-6%且板块继续共振可持有；低开超过-2%且5分钟不能翻红，先卖第一笔。";















  } else if (tradingStyle.style === "板块轮动") {















    holderLine = "持筹方：次日高开超过5%但板块不跟，冲高先卖第一笔；低开超过-1.5%且回流失败，先卖第一笔。";















  } else if (tradingStyle.style === "情绪抱团") {















    holderLine = "持筹方：次日没有溢价或低开超过-1%就是不及预期，先卖第一笔；炸板不回封或同类高标负反馈，清仓。";















  } else if (tradingStyle.style === "个股轮动") {















    holderLine = "持筹方：次日不能强于同批热股就先卖第一笔；热度排名回落或开盘跌破-2%，降低预期。";















  }































  let canGame =















    (isResonance || marketState.cycle === "冰点") &&















    longSignal.pass &&















    (stock.changePct >= 5 || role === "龙头") &&















    role !== "后排观察";































  if (ticketType.type === "容量票") {















    canGame =















      (isResonance || stock.inBothSources) &&















      longSignal.strength >= 58 &&















      stock.amountYi >= 15 &&















      stock.changePct >= 1.5 &&















      stock.changePct <= 8.5;















  }































  if (tradingStyle.preference === "趋势二波/三波") {















    canGame =















      longSignal.strength >= 58 &&















      (["二波突破", "二波趋势重建", "三波/高位趋势"].includes(stock.klineProfile?.wave) || ticketType.type === "容量票") &&















      stock.changePct >= 1.5 &&















      stock.changePct <= 8.5;















  }































  if (tradingStyle.preference === "高标抱团") {















    canGame = longSignal.pass && ticketType.type === "情绪龙头票" && role === "龙头";















  }































  if (tradingStyle.preference === "轮动回流") {















    canGame =















      longSignal.strength >= 60 &&















      (isResonance || stock.inBothSources) &&















      role !== "后排观察" &&















      stock.changePct >= 2;















  }































  return {















    canGame,















    gameType: ticketType.type,















    gameReason: ticketType.reason,















    longStrength: longSignal.strength,















    sectorLine,















    preferenceLine,















    priceLine,















    longLine,















    holderLine,















    decision: canGame ? `${ticketType.type}满足博弈条件` : `${ticketType.type}暂不满足完整博弈条件`,















  };















}































// 炒作逻辑 + 预期状态：题材层面自动给出炒作逻辑；用连板/涨幅/K线形态判断预期是「在途/透支/兑现」。















// 事件类催化（如某IPO落地）数据源里没有，由前端手动补充并覆盖。















function buildSpeculation(stock, hotConcepts, role) {















  const boards = boardHeight(stock); // 白名单解析:首板=1、N连板=N,炸板/地板=0















  const kp = stock.klineProfile || {};















  const rise20 = Number(kp.rise20 || 0);















  const wave = kp.wave || "形态未确认";















  const changePct = Number(stock.changePct || 0);















  const concept = stock.mainConcept || (stock.concepts && stock.concepts[0]) || "未归类题材";















  const resonant = (hotConcepts || []).some((item) => item.name === concept && item.resonance);















  const conceptTags = (stock.concepts || []).filter(Boolean).slice(0, 3).join("、");































  const chipNote =















    kp.chipComfort === "舒服"















      ? `筹码舒服（${kp.newHigh ? "创新高、上方无套牢" : "贴近前高、套牢轻"}）。`















      : kp.chipComfort === "套牢压力"















        ? `上方套牢重（距前高 ${kp.pctFromHigh}%），承接压力大。`















        : "";















  // 消息面证据:公告/研报佐证炒作逻辑;两样都没有=纯情绪驱动,明确标出















  const ev = stock.evidence || {};















  const latestAnn = (ev.announcements || [])[0];















  const evReports = ev.reports || [];















  const trimTitle = (t) => (String(t).length > 32 ? String(t).slice(0, 32) + "…" : String(t));















  let evidenceNote = "";















  if (latestAnn) evidenceNote += `最新公告(${latestAnn.date})：《${trimTitle(latestAnn.title)}》。`;















  if (evReports.length) {















    const r0 = evReports[0];















    evidenceNote += `近半年研报${evReports.length}篇，最新：${r0.org}${r0.rating ? "「" + r0.rating + "」" : ""}（${r0.date}）。`;















  }















  if (ev.checked && !latestAnn && !evReports.length) {















    evidenceNote = "近期无公告、无研报覆盖——炒作属纯情绪/传闻驱动，逻辑证伪要快。";















  }































  const logic =















    `主炒题材：${concept}` +















    (conceptTags ? `（${conceptTags}）` : "") +















    `；角色：${role || stock.role || "待定"}；` +















    (resonant ? "板块与指数共振，主线属性强。" : "板块独立发酵，持续性需验证。") +















    chipNote +















    evidenceNote;































  let expectation = "在途";















  let risk = "";















  if (kp.nearHigh20 && changePct <= -3) {















    expectation = "兑现";















    risk = `高位当日大幅回落（${changePct}%），疑似利好兑现/资金离场，注意退潮。`;















  } else if (boards >= 3 && changePct <= 0) {















    expectation = "兑现";















    risk = `${boards}连板高位当日未能转强，接力/兑现风险大。`;















  } else if (boards >= 4 || rise20 >= 60) {















    const bits = [];















    if (boards >= 4) bits.push(`${boards}连板`);















    if (rise20 >= 60) bits.push(`近20日+${rise20}%`);















    expectation = "透支";















    risk = `${bits.join("、")}，情绪与涨幅高度透支，分歧即走、不宜追高。`;















  } else if (wave === "三波/高位趋势" && rise20 >= 30) {















    expectation = "透支";















    risk = `高位三波（近20日+${rise20}%），主升后段，预期已大幅反映在价格里，追高风险高。`;















  } else if (["二波突破", "二波趋势重建"].includes(wave) || boards >= 2 || rise20 >= 20) {















    expectation = "在途";















    risk =















      ["二波突破", "二波趋势重建"].includes(wave)















        ? "二波突破，预期延续中，回踩承接是买点。"















        : `趋势途中（${boards ? boards + "板/" : ""}近20日+${rise20}%），预期仍在发酵，跟随承接、不追高。`;















  } else {















    expectation = "在途";















    risk = "低位/启动段，预期尚未充分发酵，仍有空间。";















  }































  return { logic, expectation, risk, boards, rise20: Math.round(rise20 * 10) / 10, wave, source: "auto" };















}































function buildChaosTrialSignal(stock, conceptInfo, meta = {}) {

  const kp = stock.klineProfile || {};
  const role = clean((meta.role || stock.role || ""));
  const ticketType = clean((meta.ticketType || stock.ticketType || ""));
  const setup = clean((meta.setup || stock.setup || ""));

  const boards = boardHeight(stock);
  const rise10 = Number(kp.rise10 || 0);
  const rise30 = Number(kp.rise30 || 0);
  const rise2 = Number(kp.rise2 || 0);
  const pctFromHigh = Number(kp.pctFromHigh || 0);
  const reasons = [];
  let score = 0;

  if (boards === 1) {
    score += 4;
    reasons.push("同板块首板，属于新东西刚露头");
  } else if (boards === 2) {
    score += 5;
    reasons.push("同板块二板，说明方向开始被市场确认");
  } else if (boards >= 3) {
    score -= 2;
    reasons.push(String(boards) + "连板已经不算低位，更偏接力");
  }

  const leaderLike = /\u9f99\u5934/.test(role) || (/\u4e2d\u519b/.test(role) && /\u5bb9\u91cf\u7968/.test(ticketType) && Number(stock.changePct || 0) >= 0 && (rise2 >= 0 || /\u56de\u6d41|\u627f\u63a5|\u6838\u5fc3\u6253\u677f|\u5206\u6b67\u8f6c\u5f3a/.test(setup)));

  if (leaderLike) {
    score += /\u9f99\u5934/.test(role) ? 4 : 3;
    reasons.push(/\u9f99\u5934/.test(role) ? "龙头票，混沌期先看它是否代表这条链" : "链条代表票，虽是中军外观但具备龙头承接");
  } else if (/\u4e2d\u519b/.test(role)) {
    score += 1;
    reasons.push("中军可作为承接参考，但不是混沌期主角");
  }
  if (/\u5bb9\u91cf\u7968/.test(ticketType)) {
    score += 1;
    reasons.push("容量属性只作辅助，不直接等于龙头");
  }
  if (/\u6838\u5fc3\u6253\u677f|\u5206\u6b67\u8f6c\u5f3a|\u56de\u6d41|\u627f\u63a5/.test(setup)) {
    score += 2;
    reasons.push("形态偏" + setup);
  }

  if (Number.isFinite(rise10)) {
    if (rise10 <= 8) {
      score += 3;
      reasons.push("近10日涨幅仅 " + rise10 + "%");
    } else if (rise10 <= 15) {
      score += 1;
      reasons.push("近10日涨幅 " + rise10 + "% 还没明显走远");
    } else {
      score -= 1;
    }
  }

  if (Number.isFinite(rise30)) {
    if (rise30 <= 15) {
      score += 3;
      reasons.push("近30日涨幅仅 " + rise30 + "%");
    } else if (rise30 <= 25) {
      score += 1;
      reasons.push("近30日涨幅 " + rise30 + "% 还算克制");
    } else {
      score -= 1;
    }
  }

  if (Number.isFinite(pctFromHigh) && pctFromHigh >= 10) {
    score += 1;
    reasons.push("离60日高点还有 " + pctFromHigh + "%");
  }

  if (Number.isFinite(rise2)) {
    if (rise2 >= 6) {
      score += 3;
      reasons.push("最近两天涨幅 " + rise2 + "%");
    } else if (rise2 >= 3) {
      score += 2;
      reasons.push("最近两天开始转强，涨幅 " + rise2 + "%");
    } else if (rise2 >= 0) {
      score += 1;
      reasons.push("最近两天没有转弱，涨幅 " + rise2 + "%");
    }
  }

  if (conceptInfo && conceptInfo.count >= 3) {
    score += 1;
    reasons.push("同板块至少有 " + conceptInfo.count + " 只热度票，方向不是孤票");
  }
  if (conceptInfo && conceptInfo.limitCount >= 1 && boards <= 2) {
    score += 2;
    reasons.push("板块内已经有 " + conceptInfo.limitCount + " 只涨停/连板，说明方向开始冒头");
  }

  const pass =
    (leaderLike && (boards === 1 || boards === 2 || rise2 >= 0)) ||
    (boards === 1 || boards === 2) ||
    (rise10 <= 15 && rise30 <= 25 && pctFromHigh >= 8) ||
    (rise2 >= 3 && rise10 <= 18) ||
    (leaderLike && conceptInfo && conceptInfo.count >= 3 && (rise2 >= 0 || /\u6838\u5fc3\u6253\u677f|\u5206\u6b67\u8f6c\u5f3a|\u56de\u6d41|\u627f\u63a5/.test(setup)));


  return {
    pass: pass && score >= 3,
    score,
    boards,
    rise10: Math.round(rise10 * 10) / 10,
    rise30: Math.round(rise30 * 10) / 10,
    rise2: Math.round(rise2 * 10) / 10,
    reasons,
  };
}































function scoreCandidate(stock, hotConcepts, marketState, contexts, tradingStyle, externalRisk, riskBoard) {















  const reasons = [];















  let rejects = [];

  if (stock && stock.marketCapCarrier && stock.marketCapCarrier.reason) {
    reasons.push(`市值载体观察：${stock.marketCapCarrier.reason}不参与评分或交易权限。`);
  }















  const board = boardName(stock.code);















  // 簇感知匹配：票的任一概念命中方向簇（含别名）就归入该簇，主概念名统一















  // （埃斯顿[工业母机,人形机器人] → 归入"人形机器人"簇，不再被第一个标签拆走）















  const conceptInfo =















    hotConcepts.find((item) => (item.matchNames || [item.name]).some((n) => stock.concepts.includes(n))) || null;















  const concept = conceptInfo ? conceptInfo.name : stock.concepts[0] || "未归类";
  const directionState = conceptInfo && conceptInfo.directionState ? conceptInfo.directionState : null;
  const isCoreDirection = Boolean(conceptInfo && (conceptInfo.isCoreDirection || (directionState && directionState.isCoreDirection)));
  const focusConcept = Array.isArray(hotConcepts) ? hotConcepts[0] : null; // 临时焦点，topicBoard创建后会二次过滤
  const focusConceptName = focusConcept ? clean(focusConcept.name || focusConcept.displayName || focusConcept.family) : "";
  const focusConceptFamily = focusConcept ? clean(focusConcept.family || focusConcept.name || focusConcept.displayName) : "";
  const focusConceptAliases = focusConcept
    ? Array.from(new Set([
        focusConceptName,
        focusConceptFamily,
        clean(focusConcept.displayName),
        ...(Array.isArray(focusConcept.matchNames) ? focusConcept.matchNames : []),
      ].map((value) => clean(value)).filter(Boolean)))
    : [];
  const stockConceptTexts = [
    stock.mainConcept,
    stock.mainFamily,
    stock.concept,
    ...(Array.isArray(stock.concepts) ? stock.concepts : []),
  ].map((value) => clean(value)).filter(Boolean);
  const focusConceptMatch = !!focusConcept && stockConceptTexts.some((text) =>
    focusConceptAliases.some((alias) =>
      text === alias || text.includes(alias) || alias.includes(text),
    ),
  );















  const roleInfo = classifyRole(stock, concept, contexts);
  const leadershipState = stock && stock.leadership && typeof stock.leadership === "object"
    ? stock.leadership
    : {};
  const cycleIdentityState = leadershipState.cycleIdentity && typeof leadershipState.cycleIdentity === "object"
    ? leadershipState.cycleIdentity
    : stock && stock.cycleIdentity && typeof stock.cycleIdentity === "object"
      ? stock.cycleIdentity
      : {};
  const isVerifiedCycleCore = leadershipState.coreIdentityQualified === true || (
    cycleIdentityState.identityEstablished === true &&
    cycleIdentityState.activePrimary !== false &&
    ["confirmed", "retained"].includes(clean(cycleIdentityState.state || ""))
  );
  // “当日高度”只描述今天强，不自动获得周期龙头的选股和风控豁免。
  // 只有独立的跨日核心身份已被验证时，才允许继续按核心角色参与决策。
  const authorizationRole = roleInfo.dailyRole === "当日高度" && !isVerifiedCycleCore
    ? "当日高度"
    : roleInfo.role;
  if (roleInfo.dailyRole === "当日高度" && !isVerifiedCycleCore) {
    rejects.push("仅为当日高度，尚未验证为本轮周期核心；只作高度和风险观察");
  }















  const ticketType = classifyTicketType(stock, authorizationRole);
  const chaosLeaderProxy = marketState.cycle === "\u6df7\u6c8c" && authorizationRole !== "\u9f99\u5934" && /\u4e2d\u519b/.test(authorizationRole) && ticketType.type === "\u5bb9\u91cf\u7968" && Number(stock.changePct || 0) >= 0 && (/\u56de\u6d41|\u627f\u63a5|\u6838\u5fc3\u6253\u677f|\u5206\u6b67\u8f6c\u5f3a/.test(clean(stock.setup || "")) || Number(stock.changePct || 0) >= 0);
  if ((marketState.cycle === "\u6df7\u6c8c" || marketState.cycle === "\u4fee\u590d" || marketState.cycle === "\u51b0\u70b9" || marketState.cycle === "\u9707\u8361") && focusConcept && !focusConceptMatch && authorizationRole !== "\u9f99\u5934" && !chaosLeaderProxy) {
    rejects.push("?????????????????????????");
  }













  const tradePlan = buildTradePlan(stock, authorizationRole, marketState, tradingStyle, ticketType);















  const chaosTrial = marketState.cycle === "混沌" ? buildChaosTrialSignal(stock, conceptInfo, { role: authorizationRole, roleReason: roleInfo.reason, ticketType: ticketType.type || ticketType, ticketReason: ticketType.reason, setup: stock.setup || "" }) : null;















  const gate = hardGate(stock, {
    coreVolumeRelax:
      ["混沌", "冰点", "震荡"].includes(marketState.cycle) &&
      focusConceptMatch &&
      /龙头|中军/.test(authorizationRole),
  });















  // 数据缺失≠不合格：K线没抓到时无法验证趋势结构，软标待补而不是硬拒——















  // 否则一次K线接口故障会把全部候选清零（主升周期零入选的病根）















  const gateDataMissing =















    !gate.pass && gate.hardFails.length === 1 && gate.hardFails[0] === "缺K线无法验证趋势结构";















  if (!gate.pass && !gateDataMissing) {















    for (const fail of gate.hardFails) rejects.push(`硬筛选未过：${fail}`);















  }















  if (gateDataMissing) {















    reasons.push("⚠️K线数据缺失，趋势/均线结构未验证（非不合格，开盘前需人工确认五日线）");















  }















  if (!conceptInfo) {















    rejects.push("不在当前热板块内，先不纳入板块选股池");















  }















  const splMode = tradeMode({ role: authorizationRole, ticketType: ticketType.type, wave: stock.klineProfile && stock.klineProfile.wave });















  const stopLossPlan = stopProfitLoss(splMode, marketState);















  const gamePlan = buildGamePlan(stock, conceptInfo, authorizationRole, marketState, tradingStyle, ticketType);















  const capitalSignal = capitalLongSignal(stock);















  const logicStable = Boolean(















    conceptInfo && conceptInfo.count >= 3 && (conceptInfo.limitCount >= 2 || conceptInfo.resonance || isCoreDirection),















  );















  const mainlineException =















    conceptInfo && conceptInfo.resonance && conceptInfo.count >= 4 && conceptInfo.limitCount >= 2;































  if (board === "北交所") rejects.push("非当前模型主战场");















  if (stock.name && stock.name.includes("ST")) rejects.push("ST/风险警示票剔除");















  if (board === "科创板" && Math.abs(stock.changePct) > 25) rejects.push("新股或异常波动，先剔除");















  if (stock.changePct <= -7) rejects.push("当日负反馈过强");















  if (stock.turnoverRate && stock.turnoverRate > 55) {
    const profile = stock.klineProfile || {};
    if (profile.isNewListing && !profile.newStockDistributionRisk) {
      reasons.push(`次新股换手${stock.turnoverRate}%：按筹码重置与近期成本判断，不因高换手单项剔除`);
    } else {
      rejects.push("换手过大，筹码波动风险高");
    }
  }















  if (marketState.cycle === "退潮") rejects.push("当前周期为退潮，模型不开放新仓");















  if (conceptInfo && conceptInfo.resonance === false && marketState.cycle !== "冰点") {















    if (isCoreDirection) {
      reasons.push(`${directionState && directionState.dailyLabel || "核心方向当日偏弱"}：方向仍保留，等待主动活口触发修复，不因单日未共振删除`);
    } else {
      rejects.push("普通热度方向未形成相对强度或内部修复，暂不提取价值");
    }















  } else if (conceptInfo && conceptInfo.resonance == null && marketState.cycle !== "冰点") {















    // 板块行情没抓到：共振无法验证，不作剔除依据（否则板块接口一挂全场剔除）















    reasons.push("⚠️板块行情数据缺失，共振未验证（不作剔除依据）");















  }















  if (riskBoard && riskBoard.blockedConcepts.includes(concept) && !mainlineException) {















    rejects.push("该方向亏钱效应过大，不进入候选池");















  }















  if (riskBoard && riskBoard.blockedTicketTypes.includes(ticketType.type) && !mainlineException) {















    rejects.push(`当前风险栏屏蔽${ticketType.type}`);















  }















  if (















    riskBoard &&















    riskBoard.blockedSetups.includes("核心打板/分歧转强") &&















    isLimitUp(stock) &&















    authorizationRole !== "龙头" &&















    !mainlineException















  ) {















    rejects.push("高标连板接力风险较大，不纳入候选");















  }















  if (!rejects.length && marketState.cycle !== "冰点" && conceptInfo && !logicStable && !stock.inBothSources) {















    rejects.push("题材持续性不足，容易是一日游逻辑");















  }















  if (!rejects.length && mainlineException) {















    reasons.push("主线共振：即使局部负反馈较大，也优先作为资金锚定观察");















  }















  if (marketState.cycle === "混沌") {















    if (chaosTrial) {















      reasons.push(`混沌低位试错：${chaosTrial.reasons.join("；")}`);















    } else {















      reasons.push("混沌期只保留高辨识度聚焦标的");















    }















  }































  const rankScore = Math.max(0, 100 - (stock.combinedRank - 1) * 3);















  const sourceScore = stock.inBothSources ? 16 : 6;















  const conceptScore = conceptInfo ? Math.min(42, conceptInfo.score) : 5;
  const focusConceptBonus = focusConcept
    ? ((marketState.cycle === "混沌" || marketState.cycle === "冰点" || marketState.cycle === "震荡")
      ? (focusConceptMatch ? 24 : -14)
      : (focusConceptMatch ? 10 : 0))
    : 0;















  const resonanceBonus = conceptInfo && conceptInfo.resonance ? 14 : 0;















  const momentumScore =















    isLimitUp(stock) ? 22 : stock.changePct >= 5 ? 16 : stock.changePct >= 0 ? 8 : -8;















  const boardScore = board === "主板" ? 8 : 4;















  const turnoverScore = !stock.turnoverRate















    ? 4















    : stock.turnoverRate >= 10 && stock.turnoverRate <= 28















      ? 20















      : stock.turnoverRate >= 8 && stock.turnoverRate <= 35















        ? 14















        : 6;















  const popularityScore = boardHeight(stock) > 0 || /持续上榜/.test(stock.popularity || "") ? 12 : 4;















  const crowdPenalty = stock.combinedRank <= 3 && isLimitUp(stock) ? 8 : 0;















  const capitalBonus = capitalSignal.pass ? Math.min(16, Math.round(capitalSignal.strength * 0.16)) : capitalSignal.strength >= 45 ? 6 : -6;















  const logicBonus = logicStable ? 14 : conceptInfo && conceptInfo.count >= 2 ? 6 : -6;















  const preferenceBonus =















    tradingStyle.preference === "趋势二波/三波" &&















    (ticketType.type === "容量票" || ["二波突破", "二波趋势重建", "三波/高位趋势"].includes(stock.klineProfile?.wave))















      ? 16















      : tradingStyle.preference === "高标抱团" && ticketType.type === "情绪龙头票" && authorizationRole === "龙头"















        ? 16















        : tradingStyle.preference === "轮动回流" && stock.inBothSources && conceptInfo && conceptInfo.count >= 3















          ? 12















          : 0;















  const externalPenalty =















    externalRisk && externalRisk.level === "高风险"















      ? authorizationRole === "龙头" && stock.inBothSources















        ? 8















        : 18















      : externalRisk && externalRisk.level === "中风险"















        ? 8















        : 0;































  // 筹码舒服度加权：前期亏钱效应大（试错/退潮/修复/冰点）时，上方套牢的承接压力是关键，















  // 优先筹码舒服（突破/接近前高），回避深套票。主升期权重降低。















  const overhangMarket = ["退潮", "冰点", "混沌"].includes(marketState.cycle);















  const chipComfortLevel = stock.klineProfile && stock.klineProfile.chipComfort;















  const chipBonus =















    chipComfortLevel === "舒服"















      ? overhangMarket















        ? 12















        : 6















      : chipComfortLevel === "套牢压力"















        ? overhangMarket















          ? -15















          : -8















        : 0;































  const baseScore =















    rankScore * 0.16 +















    sourceScore +















    conceptScore +
    focusConceptBonus +















    momentumScore +















    boardScore +















    turnoverScore +















    popularityScore -















    crowdPenalty +















    resonanceBonus +















    capitalBonus +















    logicBonus +















    preferenceBonus -















    externalPenalty +















    chipBonus;















  // 旧版 fineTune 会对已进入 baseScore 的原子事实重复加权，已从统一量化分中删除。







































































































































  const score = Math.round(baseScore * 100) / 100;































  if (stock.inBothSources) reasons.push("东方财富与同花顺热度共振");
  if (focusConcept) reasons.push(focusConceptMatch ? `当前焦点方向命中：${focusConceptName || focusConceptFamily}` : `未命中当前焦点方向：${focusConceptName || focusConceptFamily}`);















  if (stock.klineProfile && stock.klineProfile.isNewListing) {
    reasons.push(`${stock.klineProfile.newStockChipState || "次新筹码待验证"}：近5日有效换手约${stock.klineProfile.effectiveTurnover5 ?? "--"}%，相对近期成本${stock.klineProfile.closeToCostPct ?? "--"}%（${stock.klineProfile.turnoverDataQuality || "换手口径待验证"}）`);
  } else if (chipComfortLevel === "舒服") {















    reasons.push(















      stock.klineProfile && stock.klineProfile.newHigh















        ? "筹码舒服：创60日新高，上方无套牢、承接压力小"















        : "筹码舒服：接近前高，上方套牢轻、承接压力小",















    );















  } else if (chipComfortLevel === "套牢压力") {















    reasons.push(`上方套牢重（距前高 ${stock.klineProfile.pctFromHigh}%），拉升承接压力大、筹码不舒服`);















  }















  if (conceptInfo && conceptInfo.count >= 3) reasons.push(`${concept}方向上榜密度高`);















  if (conceptInfo && conceptInfo.resonance) {















    const sectorText = conceptInfo.sector
      ? `${conceptInfo.sector.name}${Number(conceptInfo.sector.changePct || 0) >= 0 ? "+" : ""}${conceptInfo.sector.changePct}%`
      : "内部成员强度";
    reasons.push(`${conceptInfo.resonanceLabel || "板块共振"}：${sectorText}，相对指数${Number(conceptInfo.relativeToIndex || 0) >= 0 ? "+" : ""}${conceptInfo.relativeToIndex ?? "--"}个百分点`);















  } else if (marketState.cycle === "冰点") {















    reasons.push("冰点期允许少数未共振的情绪抱团核心作为试错观察");















  }















  if (isLimitUp(stock)) reasons.push("当日真涨停封板，情绪辨识度强");















  if (stock.turnoverRate >= 8 && stock.turnoverRate <= 35) reasons.push("换手处于可博弈区间");















  if (capitalSignal.reasons.length) {















    reasons.push(`大资金进场：${capitalSignal.reasons.join("，")}`);















  } else {















    reasons.push("大资金进场信号不足，需继续观察");















  }















  reasons.push(logicStable ? "炒作逻辑可持续，非一日游结构" : "炒作逻辑偏单点，持续性不足");















  if (stock.popularity && boardHeight(stock) > 0) reasons.push(`短线标签：${stock.popularity}`);















  else if (/[炸地]板/.test(stock.popularity || "")) reasons.push(`短线标签：${stock.popularity}（炸板/地板，负面信号）`);















  if (stock.thsRankChange > 0 || stock.eastRankChange > 0) reasons.push("热度排名上升");















  reasons.push(`板块角色：${roleInfo.role}，${roleInfo.reason}`);















  reasons.push(`市场偏好：${tradingStyle.preference}`);















  if (riskBoard && riskBoard.blockedConcepts.includes(concept)) {















    reasons.push("风险栏提示：该方向近期亏钱效应较大");















  }















  if (externalPenalty > 0) reasons.push(`外部/消息面风险扣分：${externalRisk.level}，扣${externalPenalty}分`);















  if (stock.klineProfile) reasons.push(`形态画像：${stock.klineProfile.wave}，近10日${stock.klineProfile.rise10}%`);















  if (marketState.cycle === "主升") reasons.push("主升期允许核心方向进攻");















  if (/repair/.test(String(marketState.bigCycleTransition && marketState.bigCycleTransition.key || ""))) {
    reasons.push("小周期修复节点优先比较回流核心，但不改写大周期或交易许可");
  }















  if (marketState.cycle === "混沌") reasons.push("混沌期只保留高辨识度聚焦标的");















  if (marketState.cycle === "冰点") reasons.push("冰点期仅作为抱团核心试错观察");































  let setup = "观察";















  if (rejects.length) setup = "剔除";















  else if (score >= 78 && isLimitUp(stock)) setup = "核心打板/分歧转强";















  else if (score >= 70 && conceptInfo && conceptInfo.count >= 3) setup = "轮动回流第一强";















  else if (score >= 62) setup = "核心观察";































  if (!rejects.length && marketState.cycle === "冰点") {















    if (!(stock.inBothSources && score >= 120 && boardHeight(stock) > 0)) {















      rejects.push("冰点期只保留双榜共振的绝对核心");















      setup = "剔除";















    } else {















      setup = "抱团核心试错";















    }















  }































  if (!rejects.length && marketState.cycle === "混沌") {















    if (!chaosTrial || !chaosTrial.pass) {















      rejects.push("混沌期优先做低位试错，链条核心中军/容量票若承接成立可例外");















      setup = "剔除";















    } else if (score >= 70) {















      setup = "混沌低位试错";















    }















  }































  if (
    !rejects.length
    && /repair/.test(String(marketState.bigCycleTransition && marketState.bigCycleTransition.key || ""))
    && !conceptInfo
  ) {















    rejects.push("小周期修复节点只保留方向明确的回流核心");















    setup = "剔除";















  }































  if (!rejects.length && tradingStyle.preference === "趋势二波/三波" && preferenceBonus === 0) {















    rejects.push("当前偏趋势二波/三波，非趋势容量或二波形态降级观察");















    setup = "剔除";















  }































  if (!rejects.length && tradingStyle.preference === "高标抱团" && preferenceBonus === 0) {















    rejects.push("当前偏高标抱团，非高辨识度情绪龙头剔除");















    setup = "剔除";















  }































  if (!rejects.length && externalRisk && externalRisk.level === "高风险" && authorizationRole !== "龙头") {















    rejects.push("外部环境高风险，非核心龙头不进入博弈池");















    setup = "剔除";















  }































  // 入围观察门槛：核心标的池样本取「东方财富热度Top100 ∪ 同花顺热度Top100」（短线炒作离不开热度）。















  // 两榜都没上榜的，仅作场外观察、不入围核心池。















  if (!rejects.length && !stock.eastRank && !stock.thsRank) {















    rejects.push("不在东方财富/同花顺热度榜，仅场外观察、不入围核心标的池");















    setup = "剔除";















  }































  // ⑦分项得分随票输出(scoreParts),archiver 落库后做单因子归因:哪项在赚钱、哪项在坑















  // 细分主攻必须等精确成员与跨日收盘确认完成后才能聚焦。这里尚未生成
  // themeLibrary.mainThemeDecision，因此禁止再用 hotConcepts[0] 提前删票。
  const mixedCycleFocusOnly = false;
  const focusCoreWindow =
    mixedCycleFocusOnly &&
    focusConceptMatch &&
    (marketState.cycle === "混沌"
      ? /龙头|中军|首板|二板|低位|回流/.test(authorizationRole) || /首板|二板|低位|回流/.test(setup)
      : /龙头|中军|回流/.test(authorizationRole) || /首板|二板|低位|回流/.test(setup));
  const severeReject = rejects.some((reason) => /换手过大|主力净流出|资金净流出|缺K线无法验证趋势结构/.test(String(reason || "")));
  if (focusCoreWindow && !severeReject) {
    rejects = rejects.filter((reason) => !/硬筛选未过：均线非多头排列|硬筛选未过：量比.*不足|硬筛选未过：换手率.*不足/.test(String(reason || "")));
    if (setup === "剔除") {
      setup = /龙头|中军/.test(authorizationRole) ? "核心打板/分歧转强" : "混沌低位试错";
    }
  }

  return attachScoreParts(















    {















      ...stock,















      board,















      mainConcept: concept,















      mainFamily: conceptInfo ? (conceptInfo.family || conceptInfo.name) : concept,
      directionState,
      directionResonance: conceptInfo ? {
        type: conceptInfo.resonanceType || "unverified",
        label: conceptInfo.resonanceLabel || "板块行情待验证",
        relativeToIndex: conceptInfo.relativeToIndex,
      } : null,















      role: roleInfo.role,

      roleKind: roleInfo.dailyRole ? "dailyHeight" : roleInfo.roleKind || null,

      roleScope: roleInfo.roleScope || null,

      dailyRole: roleInfo.dailyRole || null,















      roleReason: roleInfo.reason,















      ticketType: ticketType.type,















      ticketReason: ticketType.reason,















      tradePlan,















      hardGate: gate,















      stopLossPlan,















      gamePlan,















      score,















      setup,















      selected:















        !rejects.length &&















        score >= marketState.minScore &&















        marketState.allowSetups.includes(setup) &&















        !(riskBoard && riskBoard.blockedSetups.includes(setup)) &&
        (!["混沌", "冰点", "震荡"].includes(marketState.cycle) || focusConceptMatch || authorizationRole === "龙头"),















      reasons,















      rejects,















      speculation: buildSpeculation(stock, hotConcepts, authorizationRole),















      chaosTrial,















    },















    {















      rankScore, sourceScore, conceptScore, momentumScore, boardScore,















      turnoverScore, popularityScore, crowdPenalty, resonanceBonus, capitalBonus,















      logicBonus, preferenceBonus, externalPenalty, chipBonus,















    },















  );















}































// ===== 涨停数 / 跌停数（判断情绪周期：升温 / 退潮）=====















function ymdToDate(ymd) {















  return new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));















}















function dateToYmd(d) {















  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;















}















function priorTradingDays(qdate, n) {















  const out = [];















  const d = ymdToDate(qdate);















  while (out.length < n) {















    d.setDate(d.getDate() - 1);















    const day = d.getDay();















    if (day !== 0 && day !== 6) out.push(dateToYmd(d)); // 跳过周末（节假日罕见，可接受）















  }















  return out;















}































// 东财涨停板池：data.tc=涨停数，data.qdate=最新交易日















async function fetchZtCount(date) {















  try {















    const url =















      `https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989` +















      `&dpt=wz.ztzt&Pageindex=0&pagesize=10&sort=fbt:asc&date=${date}`;















    const result = await fetchJson(url, { headers: { Referer: "https://quote.eastmoney.com/" } });















    if (result && result.data) {















      return { tc: Number(result.data.tc || 0), qdate: String(result.data.qdate || date) };















    }















  } catch {}















  return { tc: 0, qdate: date };















}































// 跌停数：跌停板池接口已废，改用全A底部按板块「贴近跌停幅度」精确计数（排除退市整理-50%噪音）















async function fetchDtCount() {















  // 干净的沪深京A股 fs（已排除退市/三板噪音），按各板块跌停幅度判定















  // 收紧到“封死跌停”附近，避免把大跌但未封板的票算进来















  const isLimitDown = (code, name, pct) => {















    if (/ST|退|摘|\*/.test(name)) return pct <= -4.85 && pct >= -5.5; // ST ±5%















    if (/^(8|4|92|43|83|87)/.test(code)) return pct <= -29.7 && pct >= -30.5; // 北交所 ±30%















    if (/^(30|68)/.test(code)) return pct <= -19.8 && pct >= -20.5; // 创业板 / 科创 ±20%















    return pct <= -9.8 && pct >= -10.5; // 主板 ±10%















  };















  // 单页抓取带重试+退避：偶发限流时自动恢复（用东财涨停板页自己的 ut/Referer）















  const fetchPage = async (pn) => {















    const url =















      `https://push2.eastmoney.com/api/qt/clist/get?ut=bd1d9ddb04089700cf9c27f6f7426281` +















      `&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048&pn=${pn}&pz=100&po=0&fid=f3&fltt=2&invt=2&fields=f3,f12,f14`;















    for (let attempt = 0; attempt < 3; attempt += 1) {















      try {















        const result = await fetchJson(url, { headers: { Referer: "https://quote.eastmoney.com/ztb/" }, timeoutMs: 8000 });















        const diff = Object.values((result.data && result.data.diff) || {});















        if (diff.length) return diff;















      } catch {}















      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));















    }















    return null;















  };































  let count = 0;















  let ok = false; // 是否至少成功抓到一页（区分“真 0 跌停”和“抓取失败”）















  for (const pn of [1, 2, 3]) {















    const diff = await fetchPage(pn);















    if (!diff) continue;















    ok = true;















    let pageHits = 0;















    for (const item of diff) {















      if (isLimitDown(String(item.f12 || ""), String(item.f14 || ""), Number(item.f3 || 0))) {















        count += 1;















        pageHits += 1;















      }















    }















    // 已排到跌幅较小的区间、本页无跌停，说明后面更不会有，提前结束















    if (diff.length < 100 || (pageHits === 0 && Number(diff[diff.length - 1] && diff[diff.length - 1].f3) > -9)) break;















  }















  return ok ? count : null; // 抓取全失败 → null（前端显示“—”，不显示误导性的 0）















}































// 同花顺涨停板复盘接口：一次返回封涨停/封跌停 + 曾涨停/曾跌停（含炸板），不限流、与同花顺页面一致















async function fetchThsLimitPool(date, limit = 1, options = {}) {















  // field 参数必须显式给,否则响应不含 reason_type(涨停原因)——实测坑















  const fieldParam =















    "199112,10,9001,330323,330324,330325,9002,330329,133971,133970,1968584,3475914,9003,9004";















  const url =















    `https://data.10jqka.com.cn/dataapi/limit_up/limit_up_pool?page=1&limit=${limit}&field=${fieldParam}&filter=HS,GEM2STAR&order_field=330324&order_type=0&date=${date}&_=${Date.now()}`;















  const attempts = Math.max(1, Math.min(3, Number(options.attempts) || 3));
  const timeoutMs = Math.max(2500, Math.min(8000, Number(options.timeoutMs) || 8000));
  for (let attempt = 0; attempt < attempts; attempt += 1) {















    try {















      const result = await fetchJson(url, {















        timeoutMs,















        headers: {















          Referer: "https://data.10jqka.com.cn/market/limitup/",















          "User-Agent":















            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",















        },















      });















      const data = result && result.data;















      if (data && data.limit_up_count && data.limit_down_count) return data;















    } catch {}















    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }















  }















  return null;















}































function thsLimitPayloadTradingDate(data, requestedDate) {
  if (!data || !data.limit_up_count || !data.limit_down_count) return "";
  const actualDate = String(data.date || "").replace(/\D/g, "");
  const expectedDate = String(requestedDate || "").replace(/\D/g, "");
  if (!actualDate || actualDate !== expectedDate) return "";
  const values = [
    data.limit_up_count && data.limit_up_count.today && data.limit_up_count.today.num,
    data.limit_down_count && data.limit_down_count.today && data.limit_down_count.today.num,
    data.limit_up_count && data.limit_up_count.today && data.limit_up_count.today.history_num,
    data.limit_down_count && data.limit_down_count.today && data.limit_down_count.today.history_num,
  ].map(Number).filter(Number.isFinite);
  return values.some((value) => value > 0) ? actualDate : "";
}

async function probePreviousThsTradingDays(baseDate, count = 2, maxLookbackDays = 14, deadlineMs = 20000) {
  const found = [];
  const cursor = ymdToDate(String(baseDate || ""));
  if (Number.isNaN(cursor.getTime())) return found;
  const deadline = Date.now() + Math.max(5000, Number(deadlineMs) || 20000);
  for (let scanned = 0; scanned < maxLookbackDays && found.length < count; scanned += 1) {
    if (Date.now() + 2500 > deadline) break;
    cursor.setDate(cursor.getDate() - 1);
    const candidate = dateToYmd(cursor);
    const payload = await fetchThsLimitPool(candidate, 1, { attempts: 1, timeoutMs: 2500 });
    if (thsLimitPayloadTradingDate(payload, candidate)) found.push(candidate);
  }
  return found;
}

async function fetchLimitStatsViaThs() {















  const num = (node, key) => Number((node && node[key] && node[key].num) || 0);
  const optionalNum = (node, key) => {
    const value = node && node[key] ? node[key].num : null;
    return value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
  };















  const hist = (node, key) => Number((node && node[key] && node[key].history_num) || 0);















  const cal = dateToYmd(new Date());















  let d0 = await fetchThsLimitPool(cal, 200); // limit=200(接口上限,实测):连池子一起拿,reason_type 透传给 news-digest















  if (!d0) return null;















  let baseDate = String(d0.date || cal);
  let calendarQuality = thsLimitPayloadTradingDate(d0, baseDate) ? "provider-scan" : "unknown";















  // 当天若还没交易（涨跌停都为0），回退到最近一个收盘交易日















  if (num(d0.limit_up_count, "today") === 0 && num(d0.limit_down_count, "today") === 0) {















    const [verifiedPrevDate] = await probePreviousThsTradingDays(baseDate, 1);
    const prevDate = verifiedPrevDate || priorTradingDays(baseDate, 1)[0];















    const dPrev = await fetchThsLimitPool(prevDate, 200);















    if (dPrev && num(dPrev.limit_up_count, "today") > 0) {















      d0 = dPrev;















      baseDate = String(dPrev.date || prevDate);
      calendarQuality = verifiedPrevDate ? "provider-scan" : "weekday-fallback";















    }















  }















  const verifiedPreviousDates = await probePreviousThsTradingDays(baseDate, 2);
  const fallbackPreviousDates = priorTradingDays(baseDate, 2);
  const prev = verifiedPreviousDates[0] || fallbackPreviousDates[0];
  const prev2 = verifiedPreviousDates[1] || fallbackPreviousDates[1];
  const datesVerified = calendarQuality === "provider-scan" && verifiedPreviousDates.length >= 2;















  const d2 = await fetchThsLimitPool(prev2);















  return {















    source: "ths",















    scope: "沪深", // 同花顺该口径不含北交所















    ztToday: num(d0.limit_up_count, "today"),















    ztPrev: num(d0.limit_up_count, "yesterday"),















    ztPrev2: d2 ? num(d2.limit_up_count, "today") : num(d0.limit_up_count, "yesterday"),















    dtToday: optionalNum(d0.limit_down_count, "today"),
    dtPrev: optionalNum(d0.limit_down_count, "yesterday"),
    dtPrev2: d2 ? optionalNum(d2.limit_down_count, "today") : null,















    ztHistory: hist(d0.limit_up_count, "today"), // 曾涨停（含炸板）















    dtHistory: hist(d0.limit_down_count, "today"), // 曾跌停















    dates: {
      today: baseDate,
      prev,
      prev2,
      verified: datesVerified,
      calendarQuality: datesVerified ? "provider-scan" : "weekday-fallback",
    },















    // 涨停池透传(供 news-digest 做涨停原因聚合;reason 实测为"题材A+题材B"格式)















    pool: (Array.isArray(d0.info) ? d0.info : []).map((row) => ({















      code: String(row.code || ""),















      name: String(row.name || ""),















      reason: String(row.reason_type || ""),















      highDays: String(row.high_days || ""),















    })),















  };















}































async function fetchLimitStats() {















  // 优先同花顺（与你看的一致、不限流、自动取最近收盘日），失败再回退东财















  const viaThs = await fetchLimitStatsViaThs().catch(() => null);















  if (viaThs && viaThs.ztToday > 0) return viaThs;















  try {















    const probe = await fetchZtCount(dateToYmd(new Date()));















    const qdate = probe.qdate;















    const [prev, prev2] = priorTradingDays(qdate, 2);















    const [prevZt, prev2Zt, dtToday] = await Promise.all([fetchZtCount(prev), fetchZtCount(prev2), fetchDtCount()]);















    return {















      source: "eastmoney",















      ztToday: probe.tc,















      dtToday,
      dtPrev: null,
      dtPrev2: null,















      ztPrev: prevZt.tc,















      ztPrev2: prev2Zt.tc,















      dates: {
        today: qdate,
        prev,
        prev2,
        verified: false,
        calendarQuality: "weekday-fallback",
      },















    };















  } catch {















    return null;















  }















}































// ── 消息面证据(公告+研报):热度前80逐只挂载,按日落盘缓存 ──















// 首轮现场抓最多 EVIDENCE_FETCH_CAP 只(约1秒/只,东财与巨潮双队列并行),















// 其余下轮刷新补齐;当日缓存命中则零开销。给 buildSpeculation 提供逻辑证据。















const evidenceCacheFile = path.join(runtimeRoot, "data", "evidence-cache.json");















const EVIDENCE_FETCH_CAP = 40;































async function enrichEvidence(stocks) {















  const pad = (n) => String(n).padStart(2, "0");















  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;















  const todayStr = ymd(new Date());















  const cache = readJsonFile(evidenceCacheFile) || {};















  let fetched = 0;















  for (const stock of stocks) {















    const hit = cache[stock.code];















    if (hit && hit.date === todayStr) {















      stock.evidence = { announcements: hit.announcements || [], reports: hit.reports || [], checked: true };















      continue;















    }















    if (fetched >= EVIDENCE_FETCH_CAP) continue;















    fetched += 1;















    const [announcements, reports] = await Promise.all([















      fetchAnnouncements(stock.code, 6),















      fetchStockReports(stock.code, 6),















    ]);















    cache[stock.code] = { date: todayStr, announcements, reports };















    stock.evidence = { announcements, reports, checked: true };















  }















  const cutoffStr = ymd(new Date(Date.now() - 3 * 86400000));















  for (const code of Object.keys(cache)) {















    if (!cache[code] || String(cache[code].date || "") < cutoffStr) delete cache[code];















  }















  try {















    fs.mkdirSync(path.dirname(evidenceCacheFile), { recursive: true });















    writeJsonFile(evidenceCacheFile, cache);















  } catch {}















}































// ===== 板块活口：分歧日里"板块死了它活着"的票，回流日的资金记忆点 =====















// 定义(用户口径,德明利/ST合力泰式案例)：热门方向大跌或内部大分歧时,逆势走强的成员。















// 识别全部基于当日可验证数据：















//   板块确有杀跌 = 板块指数≤-1.5%(用户在行情软件看到的口径,优先) 或 簇内≥半数下跌















//   活口 = 真涨停/有板 或 涨幅≥+2%,且比板块基准强≥4个百分点(显著逆势,不是少跌)















function buildSurvivorBoard(hotConcepts, candidates, marketState, limitStats) {















  const r2 = (x) => Math.round(Number(x) * 100) / 100;















  const dailyState = marketState && marketState.dailyState && typeof marketState.dailyState === "object"
    ? marketState.dailyState
    : null;
  const dailyKey = String(dailyState && dailyState.key || "");
  const legacyBigDivergence =















    marketState.cycle === "退潮" ||















    marketState.cycle === "冰点" ||















    marketState.subPhase === "高位分歧" ||















    Boolean(limitStats && limitStats.ztPrev && limitStats.ztToday < limitStats.ztPrev * 0.75) ||















    Boolean(limitStats && Number(limitStats.dtToday) >= 15);
  // 新版今日状态优先：健康分化不是“大分歧日”，真正的退潮候选才开启大分歧活口口径。
  // 没有新版字段的旧缓存继续使用原有判定，避免历史页面失效。
  const bigDivergence = dailyKey
    ? dailyKey === "retreat_candidate"
    : legacyBigDivergence;































  const items = [];















  for (const hc of hotConcepts) {















    const names = hc.matchNames || [hc.name];















    const members = candidates.filter((s) => (s.concepts || []).some((c) => names.includes(c)));















    if (members.length < 2) continue;















    const chgs = members.map((s) => Number(s.changePct)).filter(Number.isFinite);















    if (!chgs.length) continue;















    const avg = chgs.reduce((a, b) => a + b, 0) / chgs.length;















    const downRatio = chgs.filter((x) => x < 0).length / chgs.length;















    const sectorPct = hc.sector ? Number(hc.sector.changePct) : null;















    const base = Number.isFinite(sectorPct) ? sectorPct : avg;















    const baseLabel = Number.isFinite(sectorPct) ? `板块指数${r2(base)}%` : `簇内均涨${r2(base)}%`;















    if (!(base <= -1.5 || downRatio >= 0.5)) continue; // 板块没被杀跌,不谈活口































    const survivors = members















      .filter(















        (s) =>















          Number.isFinite(Number(s.changePct)) &&















          (isLimitUp(s) || boardHeight(s) > 0 || Number(s.changePct) >= 2) &&















          Number(s.changePct) - base >= 4,















      )















      .sort((a, b) => (isLimitUp(b) ? 1 : 0) - (isLimitUp(a) ? 1 : 0) || b.changePct - a.changePct)















      .slice(0, 2); // 每个方向最多2只:活口贵精不贵多































    for (const s of survivors) {















      items.push({















        code: s.code,















        name: s.name,















        concept: hc.displayName || hc.name,















        changePct: r2(s.changePct),















        basePct: r2(base),















        baseLabel,















        edge: r2(Number(s.changePct) - base),















        limitUp: isLimitUp(s),















        popularity: s.popularity || "",















        role: s.role || "",















        combinedRank: s.combinedRank,















        isST: /ST|退/.test(s.name || ""),















        reason: `${baseLabel}、簇内${Math.round(downRatio * 100)}%下跌,它${s.changePct >= 0 ? "+" : ""}${r2(s.changePct)}%${isLimitUp(s) ? "真涨停" : ""}——板块死了它活着,回流日资金优先记忆`,















      });















    }















  }















  items.sort((a, b) => (b.limitUp ? 1 : 0) - (a.limitUp ? 1 : 0) || b.edge - a.edge);
  items.sort((a, b) => (b.limitUp ? 1 : 0) - (a.limitUp ? 1 : 0) || b.edge - a.edge);

  // Fallback：如果items为空且是混沌期/冰点期，从候选池中选取当前热点的龙头中军
  if (items.length === 0 && (marketState.cycle === "混沌" || marketState.cycle === "冰点")) {
    const topConcepts = hotConcepts.slice(0, 2); // 取前2个热点
    for (const hc of topConcepts) {
      const names = hc.matchNames || [hc.name];
      const conceptMembers = candidates.filter((s) =>
        Number.isFinite(Number(s.changePct))
        && (s.concepts || []).some((c) => names.includes(c))
      );
      const memberAverage = conceptMembers.length
        ? conceptMembers.reduce((sum, item) => sum + Number(item.changePct), 0) / conceptMembers.length
        : null;
      const sectorPct = hc.sector ? Number(hc.sector.changePct) : null;
      const base = Number.isFinite(sectorPct) ? sectorPct : memberAverage;
      const baseLabel = Number.isFinite(sectorPct)
        ? `板块指数${r2(base)}%`
        : Number.isFinite(base)
          ? `篮内均涨${r2(base)}%`
          : "板块基准缺失";
      const leaders = conceptMembers
        .filter((s) => {
          const isLeaderOrZhongjun = /龙头|中军/.test(String(s.role || "").trim());
          const changePct = Number(s.changePct);
          const tradableStrength = isLimitUp(s) || boardHeight(s) > 0 || changePct >= 2;
          const hasRealEdge = Number.isFinite(base) && changePct - base >= 4;
          return isLeaderOrZhongjun && tradableStrength && hasRealEdge;
        })
        .sort((a, b) => {
          const aIsLeader = /龙头/.test(String(a.role || "").trim());
          const bIsLeader = /龙头/.test(String(b.role || "").trim());
          if (aIsLeader !== bIsLeader) return bIsLeader ? 1 : -1;
          return (Number(b.changePct) || 0) - (Number(a.changePct) || 0);
        })
        .slice(0, 3);

      for (const s of leaders) {
        items.push({
          code: s.code,
          name: s.name,
          concept: hc.displayName || hc.name,
          changePct: r2(s.changePct),
          basePct: r2(base),
          baseLabel,
          role: String(s.role || "").trim(),
          limitUp: isLimitUp(s),
          edge: r2(Number(s.changePct) - base),
          popularity: s.popularity || "",
          combinedRank: s.combinedRank,
          isST: /ST|退/.test(s.name || ""),
          reason: `候选池回补活口：${String(s.role || "核心").trim()}相对${baseLabel}强${r2(Number(s.changePct) - base)}个百分点，达到逆势活口硬门槛`,
        });
      }
    }
  }

  return {















    divergenceDay: bigDivergence,















    envNote: dailyKey === "healthy_divergence"
      ? `今日属于健康分化（${marketState.cycle}·${dailyState.label || marketState.subPhase}${limitStats ? `，涨停${limitStats.ztPrev ?? "—"}→${limitStats.ztToday ?? "—"}、跌停${limitStats.dtPrev ?? "—"}→${limitStats.dtToday ?? "—"}` : ""}）——活口用于验证赚钱方向能否延续，不把兑现直接当退潮`
      : bigDivergence















      ? `今日大分歧环境（${marketState.cycle}·${marketState.subPhase}${limitStats ? `，涨停${limitStats.ztPrev}→${limitStats.ztToday}、跌停${limitStats.dtToday == null ? "—" : limitStats.dtToday}` : ""}）——活口含金量高，回流日优先盯`















      : "今日非大分歧日，以下为板块内部分歧中的逆势强票，参考价值次一级",















    items,















  };















}































// ===== 明日预期：分歧不是一棒子打死,用当日数据推明日情景(买点前置) =====















// 用户规则(原话参数化):















//   分歧天数不按日历数,按【高标负反馈】算——高标核心的负反馈减弱,情绪分歧就在减弱;















//   负反馈依旧=亏钱效应与分歧依旧。分歧衰减信号:跌停减少/高标负反馈减少/有票抢先手/承接在。















//   衰减→明日博弈回流:指数回流+情绪回流=双共振买点,从活口/辨识度核心/老龙头里选。















//   分歧加大=二次分歧→第三日往往冰点日:博弈活口或盘中率先涨停。















function highBoardFeedback(candidates) {















  // 高标池:连板高度≥2(情绪载体);负反馈=重挫(≤-5%)与核按钮级(≤-8%)















  const pool = (candidates || []).filter((s) => boardHeight(s) >= 2 && Number.isFinite(Number(s.changePct)));















  const hit = pool.filter((s) => s.changePct <= -5);















  const nuked = pool.filter((s) => s.changePct <= -8);















  return {















    total: pool.length,















    hitCount: hit.length,















    nukedCount: nuked.length,















    hitRatio: pool.length ? Math.round((hit.length / pool.length) * 100) : null, // 无高标样本时=null,不猜















    names: hit.slice(0, 4).map((s) => `${s.name}${s.changePct <= -8 ? "(核)" : ""}`),















  };















}































/** 读最近一个交易日的归档快照(archiver 落库的第一个回报:今天能和昨天比) */















function loadPrevArchive(today, options = {}) {















  try {















    const todayDate = normalizeCycleYmd(today);
    const expectedDate = normalizeCycleYmd(options.expectedDate || "");
    const requireExact = Boolean(options.requireExact && expectedDate);
    if (!todayDate || requireExact && expectedDate >= todayDate) return null;
    const index = readJsonFile(path.join(runtimeRoot, "data", "history", "index.json")) || [];















    const rows = index
      .filter((row) => {
        const rowDate = normalizeCycleYmd(row && row.date);
        return Boolean(rowDate && rowDate < todayDate);
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const prev = requireExact ? { date: expectedDate } : rows[0];















    if (!prev) return null;















    const payload = readJsonFile(path.join(runtimeRoot, "data", "history", `${prev.date}.json`));
    if (payload && requireExact) {
      const evidence = strictExactClosingEvidence(payload, expectedDate);
      if (!evidence.ok) return null;
    }















    return payload
      ? {
        date: prev.date,
        payload,
        expectedDate: expectedDate || null,
        fresh: !expectedDate || normalizeCycleYmd(prev.date) === expectedDate,
      }
      : null;















  } catch {















    return null;















  }















}































function marketEmotionTradingDate(payload) {
  return marketSnapshotTradingDate(payload) || shanghaiClockParts(new Date()).date;
}

function loadExactPreviousDecisionPayload(payload) {
  const dates = payload && payload.market && payload.market.limitStats
    && payload.market.limitStats.dates || null;
  const tradingDate = normalizeCycleYmd(dates && dates.today);
  const expectedPreviousDate = dates && dates.verified === true
    ? normalizeCycleYmd(dates.prev)
    : "";
  if (!tradingDate || !expectedPreviousDate) return null;
  const archived = loadPrevArchive(tradingDate, {
    expectedDate: expectedPreviousDate,
    requireExact: true,
  });
  return archived && archived.payload ? archived.payload : null;
}

function emotionDecisionDateContext(payload, previousPayload) {
  const market = payload && payload.market && typeof payload.market === "object" ? payload.market : {};
  const limitStats = market.limitStats && typeof market.limitStats === "object" ? market.limitStats : {};
  const dates = limitStats.dates && typeof limitStats.dates === "object" ? limitStats.dates : {};
  const themeLibrary = payload && payload.themeLibrary && typeof payload.themeLibrary === "object"
    ? payload.themeLibrary
    : {};
  const previousMarket = previousPayload && previousPayload.market && typeof previousPayload.market === "object"
    ? previousPayload.market
    : {};
  const previousLimitStats = previousMarket.limitStats && typeof previousMarket.limitStats === "object"
    ? previousMarket.limitStats
    : {};
  const previousDates = previousLimitStats.dates && typeof previousLimitStats.dates === "object"
    ? previousLimitStats.dates
    : {};
  const previousArchiveMeta = previousPayload && previousPayload.archiveMeta
    && typeof previousPayload.archiveMeta === "object"
    ? previousPayload.archiveMeta
    : {};
  const previousThemeLibrary = previousPayload && previousPayload.themeLibrary
    && typeof previousPayload.themeLibrary === "object"
    ? previousPayload.themeLibrary
    : {};
  const currentTradingDate = normalizeCycleYmd(
    dates.today || themeLibrary.tradingDate || marketSnapshotTradingDate(payload),
  );
  const rawExpectedPreviousTradingDate = dates.verified === true
    ? normalizeCycleYmd(dates.prev)
    : themeLibrary.previousDateVerified === true
      ? normalizeCycleYmd(themeLibrary.previousTradingDate)
      : "";
  const expectedPreviousTradingDate = rawExpectedPreviousTradingDate
    && currentTradingDate
    && rawExpectedPreviousTradingDate < currentTradingDate
    ? rawExpectedPreviousTradingDate
    : "";
  const previousTradingDate = normalizeCycleYmd(
    previousArchiveMeta.tradingDate || previousDates.today || previousThemeLibrary.tradingDate,
  );
  const previousSnapshotKind = String(
    previousArchiveMeta.snapshotKind
    || previousThemeLibrary.snapshotKind
    || marketSnapshotKind(previousPayload, expectedPreviousTradingDate)
    || "",
  ).trim().toLowerCase();
  const previousEvidence = expectedPreviousTradingDate
    ? strictExactClosingEvidence(previousPayload, expectedPreviousTradingDate)
    : null;
  const exactPreviousTradingDay = Boolean(
    expectedPreviousTradingDate
    && previousTradingDate === expectedPreviousTradingDate
    && previousSnapshotKind === "closing"
    && previousEvidence
    && previousEvidence.ok === true,
  );
  return {
    currentTradingDate: currentTradingDate || null,
    expectedPreviousTradingDate: expectedPreviousTradingDate || null,
    previousTradingDate: previousTradingDate || null,
    previousSnapshotKind: previousSnapshotKind || null,
    exactPreviousTradingDay,
    previousEvidenceVerified: Boolean(previousEvidence && previousEvidence.ok === true),
    previousEvidenceReasons: previousEvidence ? previousEvidence.reasons : ["expected_date_missing"],
  };
}

function emotionSnapshotIdentity(payload, tradingDate) {
  const asOf = String(payload && (payload.fetchedAt || payload.updatedAt) || "").trim() || null;
  const normalizedDate = normalizeCycleYmd(tradingDate);
  return {
    tradingDate: normalizedDate || null,
    asOf,
    generationId: normalizedDate && asOf ? `${normalizedDate}:${asOf}` : null,
  };
}

function canonicalEmotionCandidateIsFrozen(cycle, previousPayload, context) {
  if (!context || context.exactPreviousTradingDay !== true || !cycle || typeof cycle !== "object") return false;
  if (Number(cycle.version || 0) < 2 || String(cycle.method || "") !== "anchor_hcd_state_machine") return false;
  const current = cycle.current && typeof cycle.current === "object" ? cycle.current : null;
  const stateKey = String(current && (current.key || current.stage) || "").trim();
  if (!stateKey || stateKey === "unknown") return false;
  const identity = emotionSnapshotIdentity(previousPayload, context.previousTradingDate);
  if (!identity.generationId || !identity.asOf) return false;
  if (String(cycle.generationId || "").trim() !== identity.generationId) return false;
  if (String(cycle.asOf || "").trim() !== identity.asOf) return false;
  const cycleTradingDate = normalizeCycleYmd(cycle.tradingDate || cycle.currentTradingDate);
  return Boolean(cycleTradingDate && cycleTradingDate === context.expectedPreviousTradingDate);
}

function canonicalFrozenEmotionCycle(previousPayload, context) {
  if (!previousPayload || typeof previousPayload !== "object") return null;
  const decision = previousPayload.tomorrowDecision && typeof previousPayload.tomorrowDecision === "object"
    ? previousPayload.tomorrowDecision
    : {};
  const coreEmotion = decision.coreEmotion && typeof decision.coreEmotion === "object"
    ? decision.coreEmotion
    : {};
  const models = previousPayload.premarketModels && typeof previousPayload.premarketModels === "object"
    ? previousPayload.premarketModels
    : {};
  const candidates = [previousPayload.emotionCycle, models.emotionCycle, coreEmotion.emotionCycle];
  return candidates.find((cycle) => canonicalEmotionCandidateIsFrozen(cycle, previousPayload, context)) || null;
}

function sanitizePreviousEmotionPayload(previousPayload, context, canonicalCycle = null) {
  if (!previousPayload || typeof previousPayload !== "object" || !context || !context.exactPreviousTradingDay) {
    return null;
  }
  const sanitized = { ...previousPayload };
  const decision = previousPayload.tomorrowDecision && typeof previousPayload.tomorrowDecision === "object"
    ? { ...previousPayload.tomorrowDecision }
    : null;
  const coreEmotion = decision && decision.coreEmotion && typeof decision.coreEmotion === "object"
    ? { ...decision.coreEmotion }
    : decision ? {} : null;
  const models = previousPayload.premarketModels && typeof previousPayload.premarketModels === "object"
    ? { ...previousPayload.premarketModels }
    : null;

  if (canonicalCycle) {
    sanitized.emotionCycle = canonicalCycle;
    if (models) {
      models.generationId = canonicalCycle.generationId;
      models.generatedAt = canonicalCycle.asOf;
      models.emotionCycle = canonicalCycle;
      sanitized.premarketModels = models;
    }
    if (decision) {
      decision.generationId = canonicalCycle.generationId;
      decision.asOf = canonicalCycle.asOf;
      if (coreEmotion) {
        coreEmotion.generationId = canonicalCycle.generationId;
        coreEmotion.asOf = canonicalCycle.asOf;
        coreEmotion.emotionCycle = canonicalCycle;
        decision.coreEmotion = coreEmotion;
      }
      sanitized.tomorrowDecision = decision;
    }
    return sanitized;
  }

  delete sanitized.emotionCycle;
  if (models) {
    delete models.emotionCycle;
    sanitized.premarketModels = models;
  }
  if (decision) {
    if (coreEmotion) {
      coreEmotion.items = [];
      delete coreEmotion.emotionCycle;
      decision.coreEmotion = coreEmotion;
    }
    sanitized.tomorrowDecision = decision;
  }
  return sanitized;
}

function finiteSessionCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
}

function finiteSessionNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeEmotionSession(session, currentTradingDate) {
  if (!session || typeof session !== "object") return null;
  const limitOpenCount = finiteSessionCount(session.limitOpenCount);
  const limitTouchCount = finiteSessionCount(session.limitTouchCount);
  const resealedAfterOpen = session.resealedAfterOpen === true
    ? true
    : session.resealedAfterOpen === false && limitOpenCount !== null
      ? false
      : null;
  const sanitized = {
    ...session,
    tradingDate: normalizeCycleYmd(session.tradingDate) || currentTradingDate || null,
    openChangePct: finiteSessionNumber(session.openChangePct),
    currentChangePct: finiteSessionNumber(session.currentChangePct),
    maxChangePct: finiteSessionNumber(session.maxChangePct),
    minChangePct: finiteSessionNumber(session.minChangePct),
    limitOpenCount,
    limitTouchCount,
    resealedAfterOpen,
    firstLimitTime: String(session.firstLimitTime || "").trim() || null,
    lastResealTime: String(session.lastResealTime || "").trim() || null,
    finalSealMinutes: finiteSessionNumber(session.finalSealMinutes),
    longestOpenMinutes: finiteSessionNumber(session.longestOpenMinutes),
  };
  return sanitized;
}

function prepareCurrentEmotionCandidate(stock, currentTradingDate) {
  if (!stock || typeof stock !== "object") return stock;
  const prepared = { ...stock };
  const leadership = stock.leadership && typeof stock.leadership === "object" ? { ...stock.leadership } : {};
  const initiative = leadership.initiative && typeof leadership.initiative === "object"
    ? { ...leadership.initiative }
    : {};
  const currentSession = initiative.session && typeof initiative.session === "object"
    ? initiative.session
    : null;
  const currentSessionDate = normalizeCycleYmd(currentSession && currentSession.tradingDate);
  const currentSessionCompleted = Boolean(
    currentSession && (
      currentSession.completed === true
      || /closing|closed|completed|收盘|完成/.test(String(currentSession.snapshotKind || currentSession.status || "").toLowerCase())
    )
  );
  const currentSessionQuality = String(initiative.dataQuality || "");
  const currentSessionMatches = Boolean(
    currentSession
    && (
      isClosingIntradayInitiative(initiative)
      || (
        currentSessionQuality === "收盘路径代理"
        && currentSession.verified === true
        && currentSessionCompleted
      )
    )
    && (!currentTradingDate || !currentSessionDate || currentSessionDate === currentTradingDate),
  );
  const profile = stock.klineProfile && typeof stock.klineProfile === "object" ? { ...stock.klineProfile } : {};
  const lastSession = profile.lastSession && typeof profile.lastSession === "object" ? profile.lastSession : null;
  const lastSessionDate = normalizeCycleYmd(lastSession && lastSession.tradingDate);
  const lastSessionCompleted = Boolean(
    lastSession && (
      lastSession.completed === true
      || /closing|closed|completed|收盘|完成/.test(String(lastSession.snapshotKind || lastSession.status || "").toLowerCase())
    )
  );
  const exactCurrentClosing = Boolean(
    lastSession
    && lastSession.verified === true
    && lastSessionCompleted
    && currentTradingDate
    && lastSessionDate === currentTradingDate,
  );

  if (currentSessionMatches) {
    initiative.session = sanitizeEmotionSession(currentSession, currentTradingDate);
  } else if (exactCurrentClosing) {
    initiative.dataQuality = "收盘路径代理";
    initiative.session = sanitizeEmotionSession({
      ...lastSession,
      verified: true,
      completed: true,
      snapshotKind: String(lastSession.snapshotKind || "closing"),
      limitOpenCount: null,
      limitTouchCount: null,
      resealedAfterOpen: null,
      intradayEventsVerified: false,
      firstLimitTime: null,
      lastResealTime: null,
      finalSealMinutes: null,
      longestOpenMinutes: null,
      postTouchMaxPullbackPct: null,
      retentionPct: null,
      proactive: null,
      priceDiscovery: null,
    }, currentTradingDate);
  } else if (currentSession) {
    initiative.dataQuality = currentSessionDate && currentTradingDate && currentSessionDate !== currentTradingDate
      ? "stale_session"
      : String(initiative.dataQuality || "unverified");
    initiative.session = sanitizeEmotionSession(currentSession, currentSessionDate || null);
  }

  leadership.initiative = initiative;
  prepared.leadership = leadership;
  prepared.klineProfile = profile;
  return prepared;
}

function prepareCurrentEmotionPayload(payload, currentTradingDate) {
  const prepared = { ...payload };
  prepared.candidates = Array.isArray(payload && payload.candidates)
    ? payload.candidates.map((stock) => prepareCurrentEmotionCandidate(stock, currentTradingDate))
    : [];
  return prepared;
}

function stampEmotionCycleSnapshot(cycle, snapshot = {}) {
  if (!cycle || typeof cycle !== "object") return cycle;
  const previous = cycle.previous && typeof cycle.previous === "object"
    ? { ...cycle.previous }
    : cycle.previous;
  if (snapshot.replayedPreviousEmotion && previous && previous.available === true) {
    const replayed = snapshot.replayedPreviousEmotion;
    const replayedCurrent = replayed.current && typeof replayed.current === "object"
      ? replayed.current
      : {};
    previous.source = String(replayed.source || "exact_t1_canonical_replay");
    previous.replayed = true;
    previous.authority = String(replayed.authority || "canonical_exact_closing_replay");
    previous.replayAudit = replayed.replayAudit && typeof replayed.replayAudit === "object"
      ? { ...replayed.replayAudit }
      : null;
    previous.tradingDate = String(
      replayed.tradingDate
      || replayed.currentTradingDate
      || replayed.replayAudit && replayed.replayAudit.targetTradingDate
      || snapshot.expectedPreviousTradingDate
      || previous.tradingDate
      || "",
    ).trim() || null;
    previous.label = String(replayedCurrent.label || previous.label || "").trim();
    ["lifecycle", "phase", "divergenceIntensity", "divergenceQuality", "supportState"].forEach((field) => {
      if (replayedCurrent[field] && typeof replayedCurrent[field] === "object") {
        previous[field] = { ...replayedCurrent[field] };
      }
    });
  }
  const cycleQuality = cycle.dataQuality && typeof cycle.dataQuality === "object"
    ? cycle.dataQuality
    : {};
  const expectedPreviousTradingDate = normalizeCycleYmd(snapshot.expectedPreviousTradingDate);
  const snapshotCurrentTradingDate = normalizeCycleYmd(snapshot.currentTradingDate);
  const snapshotPreviousTradingDate = normalizeCycleYmd(snapshot.previousTradingDate);
  const snapshotPreviousKind = String(snapshot.previousSnapshotKind || "").trim().toLowerCase();
  const qualityExpectedPreviousTradingDate = normalizeCycleYmd(cycleQuality.expectedPreviousTradingDate);
  const qualityPreviousTradingDate = normalizeCycleYmd(cycleQuality.previousTradingDate);
  const existingPreviousTradingDate = normalizeCycleYmd(previous && previous.tradingDate);
  const directCanonicalDateVerified = Boolean(
    previous
    && previous.available === true
    && previous.exactCanonical === true
    && cycleQuality.exactPreviousTradingDay === true
    && cycleQuality.previousStateDateAligned === true
    && snapshot.previousEvidenceVerified === true
    && snapshotPreviousKind === "closing"
    && expectedPreviousTradingDate
    && snapshotCurrentTradingDate
    && expectedPreviousTradingDate < snapshotCurrentTradingDate
    && snapshotPreviousTradingDate === expectedPreviousTradingDate
    && qualityExpectedPreviousTradingDate === expectedPreviousTradingDate
    && qualityPreviousTradingDate === expectedPreviousTradingDate,
  );
  if (directCanonicalDateVerified && !existingPreviousTradingDate) {
    previous.tradingDate = expectedPreviousTradingDate;
    previous.tradingDateSource = "verified_exact_t1_snapshot_stamp";
    if (!String(previous.authority || "").trim()) {
      previous.authority = "canonical_exact_closing_state";
    }
  }
  const finalPreviousTradingDate = normalizeCycleYmd(previous && previous.tradingDate);
  return {
    ...cycle,
    tradingDate: snapshot.currentTradingDate || null,
    currentTradingDate: snapshot.currentTradingDate || null,
    expectedPreviousTradingDate: snapshot.expectedPreviousTradingDate || null,
    generationId: snapshot.generationId || null,
    asOf: snapshot.asOf || null,
    basisTradingDate: snapshot.basisTradingDate || snapshot.currentTradingDate || null,
    basisSnapshotKind: snapshot.basisSnapshotKind || null,
    basisAsOf: snapshot.basisAsOf || snapshot.asOf || null,
    basisStatus: snapshot.basisStatus || null,
    previous,
    dataQuality: {
      ...(cycle.dataQuality && typeof cycle.dataQuality === "object" ? cycle.dataQuality : {}),
      currentTradingDate: snapshot.currentTradingDate || null,
      expectedPreviousTradingDate: snapshot.expectedPreviousTradingDate || null,
      generationId: snapshot.generationId || null,
      basisTradingDate: snapshot.basisTradingDate || snapshot.currentTradingDate || null,
      basisSnapshotKind: snapshot.basisSnapshotKind || null,
      basisAsOf: snapshot.basisAsOf || snapshot.asOf || null,
      basisStatus: snapshot.basisStatus || null,
      previousStateAuthority: previous && previous.available === true
        ? String(previous.authority || previous.source || "exact_t1_emotion_cycle")
        : null,
      previousTradingDate: finalPreviousTradingDate || qualityPreviousTradingDate || null,
      previousEvidenceVerified: Boolean(
        snapshot.previousEvidenceVerified === true
        && snapshotPreviousKind === "closing"
        && expectedPreviousTradingDate
        && snapshotPreviousTradingDate
        && snapshotCurrentTradingDate
        && expectedPreviousTradingDate < snapshotCurrentTradingDate
        && snapshotPreviousTradingDate === expectedPreviousTradingDate
      ),
      previousStateDateAligned: Boolean(
        cycleQuality.exactPreviousTradingDay === true
        && expectedPreviousTradingDate
        && finalPreviousTradingDate === expectedPreviousTradingDate
      ),
      previousStateReplayMode: previous && previous.replayAudit
        ? String(previous.replayAudit.mode || "") || null
        : null,
    },
  };
}

function replayExactPreviousEmotionCycle(previousPayload, context, options = {}) {
  if (!previousPayload || typeof previousPayload !== "object" || !context || !context.exactPreviousTradingDay) return null;
  const replayDepth = Number.isFinite(Number(options.replayDepth)) ? Number(options.replayDepth) : 0;
  const maxReplayDepth = Number.isFinite(Number(options.maxReplayDepth)) ? Number(options.maxReplayDepth) : 8;
  if (replayDepth > maxReplayDepth) return null;
  const targetDate = normalizeCycleYmd(context.previousTradingDate || context.expectedPreviousTradingDate);
  const visitedDates = Array.isArray(options.visitedDates) ? options.visitedDates.map(normalizeCycleYmd) : [];
  if (targetDate && visitedDates.includes(targetDate)) return null;
  const nextVisitedDates = targetDate ? [...visitedDates, targetDate] : [...visitedDates];
  const previousPreviousPayload = Object.prototype.hasOwnProperty.call(options, "previousPreviousPayload")
    ? options.previousPreviousPayload
    : loadExactPreviousDecisionPayload(previousPayload);
  const replayContext = emotionDecisionDateContext(previousPayload, previousPreviousPayload);
  let priorCanonical = null;
  let sanitizedPreviousPrevious = null;
  let replayMode = "exact_closing_single_day_bootstrap";
  if (previousPreviousPayload && replayContext.exactPreviousTradingDay === true) {
    priorCanonical = canonicalFrozenEmotionCycle(previousPreviousPayload, replayContext);
    if (!priorCanonical && replayDepth < maxReplayDepth) {
      priorCanonical = replayExactPreviousEmotionCycle(previousPreviousPayload, replayContext, {
        replayDepth: replayDepth + 1,
        maxReplayDepth,
        visitedDates: nextVisitedDates,
      });
    }
    sanitizedPreviousPrevious = sanitizePreviousEmotionPayload(
      previousPreviousPayload,
      replayContext,
      priorCanonical,
    );
    replayMode = priorCanonical
      ? "exact_closing_recursive_cross_day"
      : "exact_closing_t2_without_known_state";
  }
  const replayPayload = prepareCurrentEmotionPayload(previousPayload, replayContext.currentTradingDate);
  const identity = emotionSnapshotIdentity(previousPayload, replayContext.currentTradingDate);
  let basket;
  try {
    basket = buildCoreEmotionBasket(replayPayload, {
      previousPayload: sanitizedPreviousPrevious,
      currentTradingDate: replayContext.currentTradingDate,
      expectedPreviousTradingDate: replayContext.expectedPreviousTradingDate,
       tradingContext: {
         tradingDate: replayContext.currentTradingDate,
         snapshotKind: marketSnapshotKind(previousPayload, replayContext.currentTradingDate),
         expectedPreviousTradingDate: replayContext.expectedPreviousTradingDate,
        previousTradingDate: replayContext.previousTradingDate,
        previousSnapshotKind: replayContext.previousSnapshotKind,
        exactPreviousTradingDay: replayContext.exactPreviousTradingDay,
        previousEvidenceVerified: replayContext.previousEvidenceVerified,
      },
      selectedCandidateCode: "",
      excludedCandidateCodes: [],
      generationContext: identity.generationId ? { ...identity } : null,
    });
  } catch (_) {
    return null;
  }
  const replayCurrentKey = String(
    basket && basket.emotionCycle && basket.emotionCycle.current
      && (basket.emotionCycle.current.key || basket.emotionCycle.current.stage)
    || "",
  ).trim();
  if (!identity.generationId || !basket || !basket.emotionCycle || !replayCurrentKey || replayCurrentKey === "unknown") {
    return null;
  }
  return {
    ...stampEmotionCycleSnapshot(basket.emotionCycle, {
      currentTradingDate: replayContext.currentTradingDate,
      expectedPreviousTradingDate: replayContext.expectedPreviousTradingDate,
      generationId: identity.generationId,
      asOf: identity.asOf,
      replayedPreviousEmotion: priorCanonical && priorCanonical.replayed ? priorCanonical : null,
      previousTradingDate: replayContext.previousTradingDate,
      previousSnapshotKind: replayContext.previousSnapshotKind,
      previousEvidenceVerified: replayContext.previousEvidenceVerified,
    }),
    source: "exact_t1_canonical_replay",
    replayed: true,
    authority: "canonical_exact_closing_replay",
    replayAudit: {
      mode: replayMode,
      depth: replayDepth,
      targetTradingDate: replayContext.currentTradingDate || targetDate || null,
      expectedPreviousTradingDate: replayContext.expectedPreviousTradingDate || null,
      previousStateAvailable: Boolean(priorCanonical),
      previousStateSource: priorCanonical && (priorCanonical.source || "canonical_frozen") || null,
      failClosedOnUnknownCurrent: true,
    },
  };
}

function prepareEmotionBuildInputs(payload, previousPayload, options = {}) {
  const context = emotionDecisionDateContext(payload, previousPayload);
  const preparedPayload = prepareCurrentEmotionPayload(payload, context.currentTradingDate);
  let canonicalPreviousEmotion = canonicalFrozenEmotionCycle(previousPayload, context);
  let replayedPreviousEmotion = null;
  if (!canonicalPreviousEmotion && context.exactPreviousTradingDay && options.allowCanonicalReplay !== false) {
    const replayOptions = {};
    if (Object.prototype.hasOwnProperty.call(options, "previousPreviousPayload")) {
      replayOptions.previousPreviousPayload = options.previousPreviousPayload;
    }
    replayedPreviousEmotion = replayExactPreviousEmotionCycle(previousPayload, context, replayOptions);
    canonicalPreviousEmotion = replayedPreviousEmotion;
  }
  const sanitizedPreviousPayload = sanitizePreviousEmotionPayload(
    previousPayload,
    context,
    canonicalPreviousEmotion,
  );
  return {
    payload: preparedPayload,
    previousPayload: sanitizedPreviousPayload,
    currentTradingDate: context.currentTradingDate,
    expectedPreviousTradingDate: context.expectedPreviousTradingDate,
    previousTradingDate: context.previousTradingDate,
    previousSnapshotKind: context.previousSnapshotKind,
    exactPreviousTradingDay: context.exactPreviousTradingDay,
    previousEvidenceVerified: context.previousEvidenceVerified,
    canonicalPreviousEmotion,
    replayedPreviousEmotion,
  };
}

function unavailablePremarketModel(name, error) {
  return {
    version: 1,
    method: "unavailable",
    available: false,
    name,
    error: String(error && error.message || error || "unknown error"),
    dataQuality: {
      grade: "insufficient",
      notes: [`${name}构建失败，禁止用旧文案冒充新版结论。`],
    },
  };
}

function recommendationCandidateCodes(payload, options = {}) {
  const optionCodes = Array.isArray(options.excludedCandidateCodes) ? options.excludedCandidateCodes : [];
  const payloadCodes = Array.isArray(payload && payload.excludedCandidateCodes)
    ? payload.excludedCandidateCodes : [];
  return [...new Set([
    ...optionCodes.map((code) => String(code || "").trim()),
    ...payloadCodes.map((code) => String(code || "").trim()),
  ].filter(Boolean))];
}

function premarketGateFromFlow(flow) {
  return buildPremarketGateFromFlow(flow);
}

function inspectAuthoritativeDecisionChain(payload) {
  const inspected = inspectDecisionChainAuthority(payload, { requireBestPicksProjection: true });
  return {
    ...inspected,
    selectedCodeSet: new Set(inspected.selectedCodes),
  };
}

function canonicalSelectionContext(payload) {
  const phase = payload && payload.marketPhaseDetail && typeof payload.marketPhaseDetail === "object"
    ? payload.marketPhaseDetail : {};
  const context = phase.decisionContext && typeof phase.decisionContext === "object"
    ? phase.decisionContext : {};
  const bigCycle = context.bigCycle && typeof context.bigCycle === "object" ? context.bigCycle : {};
  const smallCycle = context.smallCycle && typeof context.smallCycle === "object" ? context.smallCycle : {};
  const generation = resolveGenerationContext(payload || {});
  const bigCycleLabel = normalizeBigCycle(bigCycle.label || bigCycle.key);
  const smallCycleLabel = String(smallCycle.label || smallCycle.key || "").trim();
  const phaseGenerationId = String(phase.generationId || "").trim();
  const contextGenerationId = String(context.generationId || "").trim();
  const phaseTradingDate = normalizeTradingDate(phase.tradingDate);
  const contextTradingDate = normalizeTradingDate(context.tradingDate);
  const phaseAsOf = String(phase.asOf || "").trim();
  const contextAsOf = String(context.asOf || "").trim();
  const aligned = Boolean(
    generation.generationId
    && generation.tradingDate
    && generation.asOf
    && phaseGenerationId
    && contextGenerationId
    && phaseTradingDate
    && contextTradingDate
    && phaseAsOf
    && contextAsOf
    && phaseGenerationId === generation.generationId
    && contextGenerationId === generation.generationId
    && phaseTradingDate === generation.tradingDate
    && contextTradingDate === generation.tradingDate
    && phaseAsOf === generation.asOf
    && contextAsOf === generation.asOf
  );
  const passed = Boolean(bigCycleLabel && smallCycleLabel && aligned);
  return {
    authority: "canonical_market_phase_detail",
    status: passed ? "passed" : "blocked",
    passed,
    generationId: generation.generationId || null,
    tradingDate: generation.tradingDate || null,
    asOf: generation.asOf || null,
    bigCycle: {
      key: String(bigCycle.key || "").trim() || null,
      label: bigCycleLabel || null,
    },
    smallCycle: {
      key: String(smallCycle.key || "").trim() || null,
      label: smallCycleLabel || null,
    },
    blockers: [
      !bigCycleLabel ? "权威大周期缺失或不属于统一五态枚举" : null,
      !smallCycleLabel ? "权威小周期缺失" : null,
      !aligned ? "选股周期上下文与当前代次不一致" : null,
    ].filter(Boolean),
  };
}

function buildCanonicalBestPicks(payload, previousPayload = null, options = {}) {
  const selectionContext = canonicalSelectionContext(payload);
  if (!selectionContext.passed) {
    return {
      executionVersion: 3,
      available: false,
      picks: [],
      decisionPool: [],
      scenarioPlans: [],
      selectionContext,
      note: `统一周期上下文未通过，禁止生成个股结果：${selectionContext.blockers.join("；")}`,
    };
  }
  const market = payload && payload.market && typeof payload.market === "object" ? payload.market : {};
  const candidates = Array.isArray(payload && payload.candidates) ? payload.candidates : [];
  const canonicalMarketState = {
    ...(market.state && typeof market.state === "object" ? market.state : {}),
    cycle: selectionContext.bigCycle.label,
    structuralCycle: selectionContext.bigCycle.label,
    subPhase: selectionContext.smallCycle.label,
  };
  refreshCandidateFlowAndGate(candidates, canonicalMarketState, market.limitStats || {});
  const factorContext = {
    authority: selectionContext.authority,
    generationId: selectionContext.generationId,
    tradingDate: selectionContext.tradingDate,
    asOf: selectionContext.asOf,
    bigCycle: { ...selectionContext.bigCycle },
    smallCycle: { ...selectionContext.smallCycle },
  };
  candidates.forEach((candidate) => {
    if (candidate && typeof candidate === "object") candidate.factorContext = factorContext;
  });
  const result = buildBestPicks(
    candidates,
    payload && payload.topicBoard || {},
    canonicalMarketState,
    Array.isArray(payload && payload.hotConcepts) ? payload.hotConcepts : [],
    payload && payload.survivorBoard || null,
    [],
    market.limitStats || null,
    previousPayload,
    payload && payload.tomorrowOutlook || null,
    {
      ...options,
      decisionContext: payload.marketPhaseDetail.decisionContext,
      requireCanonicalContext: true,
    },
  );
  const attachFactorContext = (rows) => (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    factorContext,
  }));
  return {
    ...result,
    factorEngineAuthority: STOCK_FACTOR_AUTHORITY,
    factorEngineVersion: STOCK_FACTOR_VERSION,
    picks: attachFactorContext(result && result.picks),
    decisionPool: attachFactorContext(result && result.decisionPool),
    selectionContext: {
      ...selectionContext,
      factorContextRecomputed: true,
      factorEngineAuthority: STOCK_FACTOR_AUTHORITY,
      factorEngineVersion: STOCK_FACTOR_VERSION,
    },
  };
}

function provisionalBestPicks(note = "等待权威市场阶段与统一个股因子引擎完成") {
  return {
    executionVersion: 3,
    available: false,
    provisional: true,
    executionAuthority: false,
    selectionAuthority: null,
    factorEngineAuthority: null,
    factorEngineVersion: null,
    picks: [],
    decisionPool: [],
    scenarioPlans: [],
    note,
  };
}

function marketSamplePayload(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.candidates)) return payload;
  const candidates = excludePreviousLimitUpOnly(payload.candidates).filter((stock) => stock && stock.styleOutcomeOnly !== true);
  return candidates.length === payload.candidates.length ? payload : { ...payload, candidates };
}

function buildPreviousStyleOutcomeSeeds(previousPayload, expectedTradingDate) {
  const model = previousPayload && previousPayload.premarketModels
    && previousPayload.premarketModels.tradingStylePreference;
  const cohorts = model && model.pathCohorts;
  if (
    !cohorts
    || cohorts.status !== "frozen"
    || normalizeCycleYmd(cohorts.tradingDate) !== normalizeCycleYmd(expectedTradingDate)
    || cohorts.snapshotKind !== "closing"
    || cohorts.classifierVersion !== STYLE_CLASSIFIER_VERSION
    || cohorts.ruleSignature !== STYLE_RULE_SIGNATURE
    || !cohorts.paths || typeof cohorts.paths !== "object"
  ) return [];
  const byCode = new Map();
  Object.entries(cohorts.paths).forEach(([pathKey, path]) => {
    (Array.isArray(path && path.samples) ? path.samples : []).forEach((sample) => {
      const code = String(sample && sample.code || "").trim();
      if (!/^\d{6}$/.test(code)) return;
      const current = byCode.get(code) || {
        code,
        name: String(sample.name || code),
        signalClose: Number.isFinite(Number(sample.signalClose)) ? Number(sample.signalClose) : null,
        priceLimitPct: Number.isFinite(Number(sample.priceLimitPct)) ? Number(sample.priceLimitPct) : null,
        pathKeys: [],
      };
      if (!current.pathKeys.includes(pathKey)) current.pathKeys.push(pathKey);
      byCode.set(code, current);
    });
  });
  return Array.from(byCode.values()).map((row) => ({
    ...row,
    styleOutcomeMembership: {
      version: 1,
      tradingDate: normalizeCycleYmd(expectedTradingDate),
      classifierVersion: STYLE_CLASSIFIER_VERSION,
      ruleSignature: STYLE_RULE_SIGNATURE,
      pathKeys: row.pathKeys.slice(),
      signalClose: row.signalClose,
      priceLimitPct: row.priceLimitPct,
    },
  }));
}

function styleOutcomeRowsOf(payload) {
  if (Array.isArray(payload && payload.styleOutcomeRows)) {
    return payload.styleOutcomeRows.filter((stock) => stock && stock.styleOutcomeMembership);
  }
  return Array.isArray(payload && payload.candidates)
    ? payload.candidates.filter((stock) => stock && stock.styleOutcomeMembership)
    : [];
}

function resolveStyleOutcomeRows(payload, options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "styleOutcomeRows")) {
    return Array.isArray(options.styleOutcomeRows) ? options.styleOutcomeRows : [];
  }
  return styleOutcomeRowsOf(payload);
}

function enforcePreviousLimitUpObservationOnly(stock) {
  if (!stock || stock.previousLimitUpOnly !== true) return stock;
  const rejection = "T-1涨停种子仅补齐当日行情与K线，不授予选股或交易权限";
  const rejects = Array.isArray(stock.rejects) ? stock.rejects.filter(Boolean) : [];
  stock.selected = false;
  stock.setup = "前板回撤观察";
  stock.observationOnly = true;
  stock.executionAuthority = false;
  stock.tradeQualified = false;
  stock.rejects = rejects.includes(rejection) ? rejects : rejects.concat(rejection);
  return stock;
}

function refreshPremarketModels(payload, options = {}) {
  if (!payload || typeof payload !== "object") return null;
  const generationContext = resolveGenerationContext(payload, options.generationContext || null);
  attachGenerationContext(payload, generationContext);
  const market = payload.market && typeof payload.market === "object" ? payload.market : {};
  const marketState = market.state && typeof market.state === "object" ? market.state : {};
  const snapshot = market.snapshot && typeof market.snapshot === "object" ? market.snapshot : {};
  const existingEmotionWindow = marketState.emotionBigCycleWindow
    && typeof marketState.emotionBigCycleWindow === "object"
    ? marketState.emotionBigCycleWindow : null;
  const existingEmotionWindowContext = cycleGenerationContextOf(existingEmotionWindow || {});
  const emotionWindowAligned = Boolean(
    existingEmotionWindow
    && Number(existingEmotionWindow.version) === EMOTION_BIG_CYCLE_WINDOW_VERSION
    && existingEmotionWindow.method === EMOTION_BIG_CYCLE_WINDOW_METHOD
    && normalizeCycleYmd(existingEmotionWindow.tradingDate) === generationContext.tradingDate
    && existingEmotionWindowContext.generationId === generationContext.generationId
    && existingEmotionWindowContext.asOf === generationContext.asOf
  );
  if (!emotionWindowAligned
    && options.allowEmotionBigCycleWindowHistoryRead !== false
    && market.state && typeof market.state === "object") {
    marketState.emotionBigCycleWindow = buildEmotionBigCycleWindowForPayload(payload, { generationContext });
  }
  const previousPayload = Object.prototype.hasOwnProperty.call(options, "previousPayload")
    ? options.previousPayload
    : loadExactPreviousDecisionPayload(payload);
  const errors = [];
  let indexCycleRegime;
  let tradingStylePreference;
  try {
    indexCycleRegime = buildIndexCycleRegime({
      generationContext,
      indexStructures: Array.isArray(snapshot.indexStructures) ? snapshot.indexStructures : [],
      snapshot,
      market,
      previous: previousPayload && previousPayload.market && previousPayload.market.snapshot || null,
      currentMarketState: marketState,
      previousMarketState: previousPayload && previousPayload.market && previousPayload.market.state || null,
    });
  } catch (error) {
    indexCycleRegime = unavailablePremarketModel("多周期指数状态", error);
    errors.push(indexCycleRegime.error);
  }
  try {
    tradingStylePreference = buildTradingStylePreference(marketSamplePayload(payload), {
      previousPayload: marketSamplePayload(previousPayload),
      outcomeRows: resolveStyleOutcomeRows(payload, options),
    });
  } catch (error) {
    tradingStylePreference = unavailablePremarketModel("炒作偏好", error);
    errors.push(tradingStylePreference.error);
  }
  const current = payload.premarketModels && typeof payload.premarketModels === "object"
    ? payload.premarketModels
    : {};
  const generatedAt = generationContext.asOf;
  const generationId = generationContext.generationId;
  const emotionCycle = unavailablePremarketModel("情绪状态机", "等待当前轮核心情绪构建");
  emotionCycle.pending = true;
  payload.premarketModels = {
    ...current,
    version: 2,
    generationContext,
    generatedAt,
    generationId,
    indexCycleRegime,
    tradingStylePreference,
    emotionCycle,
    integrity: {
      ok: false,
      status: errors.length ? "invalid" : "pending",
      errors,
      pending: ["emotionCycle"],
      legacyFallbackAllowed: false,
    },
  };
  if (market.state && typeof market.state === "object") market.state.indexCycleRegime = indexCycleRegime;
  if (market.tradingStyle && typeof market.tradingStyle === "object") {
    market.tradingStyle.preferenceModel = tradingStylePreference;
  }
  return payload.premarketModels;
}

function unavailablePostCloseOpportunityReport(error) {
  const message = String(error && error.message || error || "unknown error");
  return {
    version: 1,
    method: "unavailable",
    calibrated: false,
    generationId: null,
    asOf: null,
    tradingDate: null,
    status: "no_opportunity",
    dataStatus: {
      status: "unavailable",
      usable: false,
      reasonCodes: ["post_close_opportunity_build_failed"],
      reasons: ["盘后机会报告暂时无法生成，请重新抓取收盘数据。"],
      asOf: null,
    },
    marketPermission: {
      status: "blocked",
      canCreateOpportunities: false,
      positionLimit: null,
      blockedSteps: ["data"],
      reasonCodes: ["post_close_opportunity_build_failed"],
      reasons: ["盘后机会报告没有通过完整性检查。"],
    },
    candidateThemes: [],
    confirmedThemes: [],
    recentRelation: unavailableRecentIndexEmotionRelation(error),
    opportunityObservationState: {
      status: "unavailable",
      sourceCount: 0,
      eligibleCount: 0,
      rejectedCount: 0,
      reason: "盘后机会观察数据不可用，不沿用旧观察票。",
    },
    opportunityObservationCards: [],
    opportunityObservationRejected: [],
    setupCards: [],
    watchCards: [],
    opportunityCards: [],
    noOpportunity: {
      active: true,
      reasons: ["盘后机会报告暂时无法生成，请重新抓取收盘数据。"],
      nextChecks: ["重新抓取并确认指数、资金偏好、题材和核心股数据都已更新。"],
    },
    limits: { maxThemes: 3, maxCoresPerTheme: 2, maxCoreStocks: 5, maxOpportunityObservationCards: 5 },
    sources: {},
    integrity: {
      ok: false,
      failClosed: true,
      error: message,
      candidateAndConfirmedThemesSeparated: true,
      opportunityCardsFromFinalPlansOnly: true,
      opportunityObservationCardsFromUnifiedChainOnly: true,
      opportunityObservationCardsCannotGrantExecution: true,
      observationLayersDoNotGrantExecution: true,
      noInventedNumericForecast: true,
      attributionConflictsExcluded: true,
    },
  };
}

function unavailableRecentIndexEmotionRelation(error) {
  const message = String(error && error.message || error || "recent_relation_unavailable");
  let relation;
  try {
    relation = buildRecentIndexEmotionRelation({ days: [] });
  } catch (_) {
    relation = {
      version: 1,
      method: "recent_index_participatory_emotion_relation",
      calibrated: false,
      title: "近期指数—情绪关系",
      status: "insufficient",
      usability: { usable: false, key: "build_failed", minimumValidDays: 2, validDays: 0 },
      window: { short: 3, confirm: 5, available: 0 },
      dominant: { key: "unknown", label: "数据不足，关系待确认", seesawConfirmed: false },
      today: { title: "今日变化", tradingDate: null, valid: false, relationKey: "unknown" },
      transition: { seesawConfirmed: false },
      daily: [],
      opportunityBias: { key: "data_insufficient", riskAdjustment: "avoid" },
      dataQuality: { validObservationCount: 0 },
      integrity: {},
    };
  }
  return {
    ...relation,
    generationId: null,
    asOf: null,
    tradingDate: null,
    status: "insufficient",
    usability: {
      ...(relation.usability && typeof relation.usability === "object" ? relation.usability : {}),
      usable: false,
      key: "build_failed",
      reason: "近期收盘数据暂时无法完整读取，不能推断指数和情绪关系。",
    },
    daily: [],
    error: message,
    integrity: {
      ...(relation.integrity && typeof relation.integrity === "object" ? relation.integrity : {}),
      ok: false,
      failClosed: true,
    },
  };
}

function canonicalRecentEmotionCycle(payload) {
  if (!payload || typeof payload !== "object") return null;
  const tradingDate = normalizeCycleYmd(marketSnapshotTradingDate(payload));
  const asOf = String(payload.fetchedAt || payload.updatedAt || "").trim();
  const generationId = tradingDate && asOf ? `${tradingDate}:${asOf}` : "";
  if (!tradingDate || !asOf || !generationId) return null;
  const models = payload.premarketModels && typeof payload.premarketModels === "object"
    ? payload.premarketModels
    : {};
  const decision = payload.tomorrowDecision && typeof payload.tomorrowDecision === "object"
    ? payload.tomorrowDecision
    : {};
  const coreEmotion = decision.coreEmotion && typeof decision.coreEmotion === "object"
    ? decision.coreEmotion
    : {};
  const candidates = [models.emotionCycle, coreEmotion.emotionCycle, payload.emotionCycle];
  return candidates.find((cycle) => {
    if (!cycle || typeof cycle !== "object") return false;
    const current = cycle.current && typeof cycle.current === "object" ? cycle.current : {};
    const phaseKey = String(
      current.phaseKey
      || current.participatoryPhase && current.participatoryPhase.key
      || "",
    ).trim();
    return Number(cycle.version || 0) >= 2
      && String(cycle.method || "") === "anchor_hcd_state_machine"
      && normalizeCycleYmd(cycle.tradingDate || cycle.currentTradingDate) === tradingDate
      && String(cycle.generationId || "").trim() === generationId
      && String(cycle.asOf || "").trim() === asOf
      && Boolean(phaseKey);
  }) || null;
}

function recentRelationDay(payload, previousPayload, emotionCycle) {
  if (!payload || typeof payload !== "object") return null;
  const tradingDate = normalizeCycleYmd(marketSnapshotTradingDate(payload));
  if (!tradingDate || marketSnapshotKind(payload, tradingDate) !== "closing") return null;
  const market = payload.market && typeof payload.market === "object" ? payload.market : {};
  const marketSnapshot = market.snapshot && typeof market.snapshot === "object" ? market.snapshot : {};
  let indexCycleRegime = null;
  try {
    indexCycleRegime = buildIndexCycleRegime({
      generationContext: payload.generationContext && typeof payload.generationContext === "object"
        ? payload.generationContext
        : {
          generationId: String(payload.generationId || `${tradingDate}:${payload.fetchedAt || payload.updatedAt || ""}`),
          tradingDate,
          asOf: String(payload.fetchedAt || payload.updatedAt || ""),
        },
      indexStructures: Array.isArray(marketSnapshot.indexStructures) ? marketSnapshot.indexStructures : [],
      snapshot: marketSnapshot,
      market,
      previous: previousPayload && previousPayload.market && previousPayload.market.snapshot || null,
      currentMarketState: market.state && typeof market.state === "object" ? market.state : null,
      previousMarketState: previousPayload && previousPayload.market && previousPayload.market.state || null,
    });
  } catch (_) {
    indexCycleRegime = null;
  }
  return {
    tradingDate,
    indexCycleRegime,
    emotionCycle: emotionCycle || null,
    marketSnapshot,
    previousAmountYi: previousPayload && previousPayload.market && previousPayload.market.snapshot
      ? Number(previousPayload.market.snapshot.totalAmountYi || previousPayload.market.snapshot.shszAmountYi || 0) || null
      : null,
  };
}

function buildRecentIndexEmotionDays(payload) {
  const previous = loadExactPreviousDecisionPayload(payload);
  const previousPrevious = previous ? loadExactPreviousDecisionPayload(previous) : null;
  const previousThird = previousPrevious ? loadExactPreviousDecisionPayload(previousPrevious) : null;
  const currentEmotion = canonicalRecentEmotionCycle(payload);
  const previousContext = previous ? emotionDecisionDateContext(payload, previous) : null;
  const previousEmotion = previous && previousContext && previousContext.exactPreviousTradingDay
    ? canonicalFrozenEmotionCycle(previous, previousContext)
      || replayExactPreviousEmotionCycle(previous, previousContext, { previousPreviousPayload: previousPrevious })
    : null;
  const previousPreviousContext = previousPrevious
    ? emotionDecisionDateContext(previous, previousPrevious)
    : null;
  const previousPreviousEmotion = previousPrevious && previousPreviousContext
    && previousPreviousContext.exactPreviousTradingDay
    ? canonicalFrozenEmotionCycle(previousPrevious, previousPreviousContext)
      || replayExactPreviousEmotionCycle(previousPrevious, previousPreviousContext, {
        previousPreviousPayload: previousThird,
      })
    : null;
  return [
    recentRelationDay(previousThird, null, null),
    recentRelationDay(previousPrevious, previousThird, previousPreviousEmotion),
    recentRelationDay(previous, previousPrevious, previousEmotion),
    recentRelationDay(payload, previous, currentEmotion),
  ].filter(Boolean);
}

function refreshRecentIndexEmotionRelation(payload) {
  if (!payload || typeof payload !== "object") return unavailableRecentIndexEmotionRelation("payload_missing");
  try {
    const tradingDate = normalizeCycleYmd(marketSnapshotTradingDate(payload));
    const asOf = String(payload.fetchedAt || payload.updatedAt || "").trim() || null;
    const generationId = tradingDate && asOf ? `${tradingDate}:${asOf}` : null;
    const relation = buildRecentIndexEmotionRelation({ days: buildRecentIndexEmotionDays(payload) });
    const currentUsable = Boolean(
      relation.today && relation.today.valid === true && relation.today.tradingDate === tradingDate,
    );
    const usable = relation.status === "ready"
      && relation.usability && relation.usability.usable === true
      && currentUsable;
    const stamped = {
      ...relation,
      generationId,
      asOf,
      tradingDate: tradingDate || null,
      status: usable ? "ready" : "insufficient",
      usability: {
        ...(relation.usability && typeof relation.usability === "object" ? relation.usability : {}),
        usable,
        key: usable ? "usable" : "current_closing_relation_unavailable",
        reason: usable
          ? relation.usability.reason
          : "当前交易日的指数或可参与情绪数据不完整，不能沿用旧关系。",
      },
      integrity: {
        ...(relation.integrity && typeof relation.integrity === "object" ? relation.integrity : {}),
        ok: usable,
        failClosed: true,
        exactPreviousTradingDaysOnly: true,
        currentGenerationRequired: true,
      },
    };
    payload.recentIndexEmotionRelation = stamped;
    return stamped;
  } catch (error) {
    const relation = unavailableRecentIndexEmotionRelation(error);
    try { payload.recentIndexEmotionRelation = relation; } catch (_) { /* hostile payload */ }
    return relation;
  }
}

function canonicalAllocationMapFromAuthority(authority) {
  const chain = authority && authority.chain && typeof authority.chain === "object" ? authority.chain : {};
  const result = chain.result && typeof chain.result === "object" ? chain.result : {};
  const map = new Map();
  (Array.isArray(result.stocks) ? result.stocks : []).forEach((stock) => {
    const code = String(stock && (stock.code || stock.secCode) || "").trim();
    const source = stock && stock.positionAllocation && typeof stock.positionAllocation === "object"
      ? stock.positionAllocation : {};
    const allocation = {
      relativeWeightPct: Number(source.relativeWeightPct),
      initialPortfolioPct: Number(source.initialPortfolioPct),
      maximumPortfolioPct: Number(source.maximumPortfolioPct),
    };
    if (code && Object.values(allocation).every((value) => Number.isFinite(value) && value >= 0)) {
      map.set(code, allocation);
    }
  });
  return map;
}

function projectOpportunityCardsToCanonicalAllocation(cards, authority) {
  const allocationByCode = canonicalAllocationMapFromAuthority(authority);
  return (Array.isArray(cards) ? cards : []).map((card) => {
    const code = String(card && (card.code || card.secCode) || "").trim();
    const canonicalAllocation = allocationByCode.get(code);
    if (!canonicalAllocation) return null;
    const sourcePlan = card && card.plan && typeof card.plan === "object" ? card.plan : {};
    const existingLegacy = sourcePlan.legacyObservation && typeof sourcePlan.legacyObservation === "object"
      ? sourcePlan.legacyObservation : {};
    const sourcePosition = sourcePlan.position && typeof sourcePlan.position === "object"
      ? sourcePlan.position : null;
    const sourcePositionIsCanonical = sourcePosition
      && ["relativeWeightPct", "initialPortfolioPct", "maximumPortfolioPct"].every((key) => (
        Number(sourcePosition[key]) === canonicalAllocation[key]
      ));
    const legacyPosition = Object.prototype.hasOwnProperty.call(sourcePlan, "position")
      && !sourcePositionIsCanonical ? sourcePlan.position : null;
    return {
      ...card,
      canonicalAllocation: { ...canonicalAllocation },
      allocationAuthority: "unified_decision_chain_v3",
      plan: {
        ...sourcePlan,
        // post-close原始计划可能带旧position；正式字段始终覆盖为统一链仓位。
        position: { ...canonicalAllocation },
        canonicalAllocation: { ...canonicalAllocation },
        allocationAuthority: "unified_decision_chain_v3",
        legacyObservation: legacyPosition == null ? existingLegacy : {
          ...existingLegacy,
          position: {
            ...(existingLegacy.position && typeof existingLegacy.position === "object"
              ? existingLegacy.position : {}),
            sourcePlan: legacyPosition,
          },
          executionAuthority: false,
        },
      },
    };
  }).filter(Boolean);
}

function projectPostCloseOpportunityToDecisionChain(report, payload) {
  const source = report && typeof report === "object" ? report : unavailablePostCloseOpportunityReport("report_missing");
  const authority = inspectAuthoritativeDecisionChain(payload);
  const chain = authority.chain || {};
  const authorization = chain.authorization && typeof chain.authorization === "object" ? chain.authorization : {};
  const tradePermission = authorization.tradePermission && typeof authorization.tradePermission === "object"
    ? authorization.tradePermission : {};
  const positionPermission = authorization.positionPermission && typeof authorization.positionPermission === "object"
    ? authorization.positionPermission : {};
  const executionOpen = authority.valid
    && authorization.passed === true
    && tradePermission.allowNew === true;
  const allowedCodes = authority.selectedCodeSet || new Set();
  const opportunityCards = executionOpen
    ? projectOpportunityCardsToCanonicalAllocation(
      (Array.isArray(source.opportunityCards) ? source.opportunityCards : [])
        .filter((card) => allowedCodes.has(String(card && card.code || "").trim())),
      authority,
    ) : [];
  const reasons = executionOpen
    ? []
    : authority.valid
      ? (Array.isArray(tradePermission.reasons) && tradePermission.reasons.length
        ? tradePermission.reasons : ["统一决策链没有开放新仓权限。"])
      : (authority.reasons.length ? authority.reasons : ["统一决策链不可用。"]);
  const unifiedObservation = chain.observationCandidates && typeof chain.observationCandidates === "object"
    ? chain.observationCandidates : null;
  const unifiedObservationCodes = new Set((Array.isArray(unifiedObservation && unifiedObservation.stocks)
    ? unifiedObservation.stocks : [])
    .filter((stock) => stock
      && stock.observationOnly === true
      && stock.executionAuthority === false
      && stock.executable === false
      && stock.hardGatePassed === true)
    .map((stock) => String(stock.code || "").trim())
    .filter(Boolean));
  const opportunityObservationCards = authority.valid
    ? (Array.isArray(source.opportunityObservationCards) ? source.opportunityObservationCards : [])
      .filter((card) => {
        const code = String(card && card.code || "").trim();
        return Boolean(
          code
          && unifiedObservationCodes.has(code)
          && !opportunityCards.some((opportunity) => String(opportunity && opportunity.code || "").trim() === code)
          && card.observationOnly === true
          && card.executionAuthority === false
        );
      })
      .slice(0, 5)
      .map((card) => ({
        ...card,
        observationOnly: true,
        executionAuthority: false,
      }))
    : [];
  const sourceObservationState = source.opportunityObservationState
    && typeof source.opportunityObservationState === "object"
    ? source.opportunityObservationState : {};
  const opportunityObservationState = authority.valid
    ? {
        ...sourceObservationState,
        status: opportunityObservationCards.length ? "available" : "empty",
        eligibleCount: opportunityObservationCards.length,
        reason: opportunityObservationCards.length
          ? `当前有${opportunityObservationCards.length}只通过观察级硬门槛，仍未获得交易授权。`
          : sourceObservationState.reason || "当前没有通过观察级硬门槛的机会观察股。",
      }
    : {
        status: "unavailable",
        sourceCount: 0,
        eligibleCount: 0,
        rejectedCount: 0,
        reason: "统一决策链不可用，不沿用旧机会观察股。",
      };
  return {
    ...source,
    status: opportunityCards.length ? "opportunities" : "no_opportunity",
    marketPermission: {
      status: executionOpen ? String(tradePermission.status || "conditional") : "blocked",
      canCreateOpportunities: executionOpen && opportunityCards.length > 0,
      positionLimit: executionOpen ? Number(positionPermission.positionCeilingPct || 0) : 0,
      blockedSteps: executionOpen ? [] : ["unified_decision_chain"],
      reasonCodes: executionOpen ? [] : [authority.valid ? "chain_authorization_closed" : "chain_invalid"],
      reasons,
      authority: "unified_decision_chain_v3",
    },
    opportunityObservationState,
    opportunityObservationCards,
    opportunityCards,
    noOpportunity: opportunityCards.length
      ? { active: false, reasons: [], nextChecks: [] }
      : {
          active: true,
          reasons: reasons.slice(0, 3),
          nextChecks: Array.isArray(source.noOpportunity && source.noOpportunity.nextChecks)
            ? source.noOpportunity.nextChecks : [],
        },
    sources: {
      ...(source.sources && typeof source.sources === "object" ? source.sources : {}),
      opportunityObservationCards: "unifiedDecisionChain.observationCandidates.stocks",
      opportunityCards: "unifiedDecisionChain.result ∩ premarketFlow.tradePlan.plans",
      marketPermission: "unifiedDecisionChain.authorization",
    },
    integrity: {
      ...(source.integrity && typeof source.integrity === "object" ? source.integrity : {}),
      failClosed: true,
      unifiedDecisionChainValid: authority.valid,
      opportunityObservationCardsWithinDecisionChain: opportunityObservationCards.every((card) => (
        unifiedObservationCodes.has(String(card && card.code || "").trim())
      )),
      opportunityObservationCardsCannotGrantExecution: opportunityObservationCards.every((card) => (
        card && card.observationOnly === true && card.executionAuthority === false
      )),
      observationAndExecutionCodesSeparated: opportunityObservationCards.every((card) => (
        !opportunityCards.some((opportunity) => (
          String(opportunity && opportunity.code || "").trim() === String(card && card.code || "").trim()
        ))
      )),
      opportunityCardsWithinDecisionChain: opportunityCards.every((card) => (
        allowedCodes.has(String(card && card.code || "").trim())
      )),
      canonicalAllocationOnly: opportunityCards.every((card) => (
        card && card.allocationAuthority === "unified_decision_chain_v3"
        && card.plan && card.plan.allocationAuthority === "unified_decision_chain_v3"
      )),
      executionAuthority: "unified_decision_chain_v3",
    },
  };
}

function refreshPostCloseOpportunityReport(payload) {
  if (!payload || typeof payload !== "object") return unavailablePostCloseOpportunityReport("payload_missing");
  try {
    const relation = payload.recentIndexEmotionRelation && typeof payload.recentIndexEmotionRelation === "object"
      ? payload.recentIndexEmotionRelation
      : null;
    const generationId = String(
      payload.tomorrowDecision && payload.tomorrowDecision.generationId
      || payload.premarketModels && payload.premarketModels.generationId
      || "",
    ).trim();
    if (!relation || !generationId || String(relation.generationId || "").trim() !== generationId) {
      refreshRecentIndexEmotionRelation(payload);
    }
    const report = projectPostCloseOpportunityToDecisionChain(
      buildPostCloseOpportunityReport({ payload }),
      payload,
    );
    if (!report.generationId && report.asOf) {
      report.generationId = `${report.tradingDate || "unknown"}:${report.asOf}`;
    }
    payload.postCloseOpportunity = report;
    try { refreshUnifiedQuantFactors(payload); } catch (_) { /* unified projection remains isolated */ }
    return report;
  } catch (error) {
    const report = unavailablePostCloseOpportunityReport(error);
    try { payload.postCloseOpportunity = report; } catch (_) { /* hostile payload */ }
    try { refreshUnifiedQuantFactors(payload); } catch (_) { /* unified projection remains isolated */ }
    return report;
  }
}

function refreshUnifiedQuantFactors(payload) {
  if (!payload || typeof payload !== "object") return null;
  const unified = buildUnifiedQuantFactors(payload);
  payload.unifiedQuantFactors = unified;
  return unified;
}

function plainDecisionEvidenceSnapshot(decision) {
  const plainCopy = (value, fallback) => {
    try {
      return JSON.parse(JSON.stringify(value === undefined ? fallback : value));
    } catch (_) {
      return fallback;
    }
  };
  const finalEmotionStage = {
    key: String(decision && decision.market && decision.market.corePhaseKey || "") || null,
    label: String(decision && decision.market && decision.market.corePhase || "") || null,
  };
  const tradePermission = plainCopy(
    decision && decision.permission && typeof decision.permission === "object" ? decision.permission : {},
    {},
  );
  return {
    finalEmotionStage,
    tradePermission,
    market: {
      corePhase: finalEmotionStage.label,
      corePhaseKey: finalEmotionStage.key,
      phaseDetail: {
        emotionStage: plainCopy(
          decision && decision.market && decision.market.phaseDetail
            && decision.market.phaseDetail.emotionStage,
          null,
        ),
      },
    },
    tomorrowBaseline: plainCopy(decision && decision.tomorrowBaseline, null),
    verdict: decision && decision.verdict || null,
    permission: plainCopy(tradePermission, {}),
    scenarios: plainCopy(decision && decision.scenarios, []),
  };
}

function failClosedEmotionCoreEvidence({ generation, existingDecision, error }) {
  const meta = {
    generationId: String(generation && (generation.id || generation.generationId) || ""),
    tradingDate: String(generation && generation.tradingDate || ""),
    asOf: String(generation && generation.asOf || ""),
    contractVersion: EMOTION_CORE_EVIDENCE_CONTRACT_VERSION,
  };
  const empty = buildEmotionCoreEvidenceContract({
    contractVersion: EMOTION_CORE_EVIDENCE_CONTRACT_VERSION,
    generation: {
      id: meta.generationId,
      tradingDate: meta.tradingDate,
      asOf: meta.asOf,
      contractVersion: EMOTION_CORE_EVIDENCE_CONTRACT_VERSION,
    },
    marketCycle: { key: "unavailable", label: "evidence unavailable", ...meta },
    themeCycles: [],
    existingDecision,
  });
  return {
    ...empty,
    status: "unavailable",
    integrity: {
      ...(empty.integrity || {}),
      sameGeneration: false,
      finalEmotionStageUnchanged: true,
      tradePermissionUnchanged: true,
    },
    dataQuality: {
      ...(empty.dataQuality || {}),
      failClosed: true,
      usable: false,
      reasonCodes: ["emotion_core_evidence_build_failed"],
      error: String(error && error.message || error || "unknown error"),
    },
  };
}

function buildAttachedEmotionCoreEvidence({
  payload,
  coreEmotionBasket,
  marketPhaseDetail,
  generation,
  existingDecision,
  previousEvidence,
  expectedPreviousTradingDate,
  builder,
}) {
  try {
    const evidenceBuilder = typeof builder === "function" ? builder : buildEmotionCoreEvidenceFromPayload;
    const evidence = evidenceBuilder({
      payload,
      coreEmotionBasket,
      marketPhaseDetail,
      generation,
      existingDecision,
      previousEvidence,
      expectedPreviousTradingDate,
    });
    if (!evidence || typeof evidence !== "object") throw new Error("emotion_core_evidence_missing");
    if (String(evidence.generationId || "") !== String(generation.id || generation.generationId || "")
      || String(evidence.tradingDate || "") !== String(generation.tradingDate || "")
      || String(evidence.asOf || "") !== String(generation.asOf || "")) {
      throw new Error("emotion_core_evidence_generation_mismatch");
    }
    if (Number(evidence.contractVersion) !== EMOTION_CORE_EVIDENCE_CONTRACT_VERSION) {
      throw new Error("emotion_core_evidence_contract_version_mismatch");
    }
    if (!evidence.guardrails
      || evidence.guardrails.emotionStageAuthority !== false
      || evidence.guardrails.executionAuthority !== false
      || evidence.guardrails.riskBarometerVoteEligible !== false
      || evidence.guardrails.riskCoreSelectionAuthority !== false
      || Number(evidence.guardrails.strictCoreBasketMaximum) !== MAX_STRICT_EMOTION_CORES) {
      throw new Error("emotion_core_evidence_guardrail_invalid");
    }
    const strictRows = Array.isArray(evidence.strictEmotionCores) ? evidence.strictEmotionCores : [];
    const riskRows = Array.isArray(evidence.heightRiskBarometers) ? evidence.heightRiskBarometers : [];
    const coreCandidateRows = Array.isArray(evidence.coreCandidates) ? evidence.coreCandidates : [];
    const themeGroups = Array.isArray(evidence.themeCycles) ? evidence.themeCycles : [];
    const nestedStrictRows = themeGroups.flatMap((group) => Array.isArray(group && group.strictEmotionCores) ? group.strictEmotionCores : []);
    const nestedRiskRows = themeGroups.flatMap((group) => Array.isArray(group && group.heightRiskBarometers) ? group.heightRiskBarometers : []);
    const nestedCandidateRows = themeGroups.flatMap((group) => Array.isArray(group && group.coreCandidates) ? group.coreCandidates : []);
    const allRows = [...strictRows, ...riskRows, ...coreCandidateRows, ...nestedStrictRows, ...nestedRiskRows, ...nestedCandidateRows];
    const expectedGenerationId = String(generation.id || generation.generationId || "");
    const expectedTradingDate = String(generation.tradingDate || "");
    const expectedAsOf = String(generation.asOf || "");
    const rowMetadataMatches = (row) => Boolean(
      row
      && String(row.generationId || "") === expectedGenerationId
      && String(row.tradingDate || "") === expectedTradingDate
      && String(row.asOf || "") === expectedAsOf,
    );
    const strictPoolRows = [...strictRows, ...nestedStrictRows];
    const riskCandidateRows = [...coreCandidateRows, ...nestedCandidateRows].filter((row) => (
      row && row.classification && row.classification.heightRiskBarometer === true
    ));
    const riskPoolRows = [...riskRows, ...nestedRiskRows, ...riskCandidateRows];
    const topStrictCodes = strictRows.map((row) => String(row && row.code || "")).filter(Boolean);
    const nestedStrictCodes = nestedStrictRows.map((row) => String(row && row.code || "")).filter(Boolean);
    if (strictRows.length > MAX_STRICT_EMOTION_CORES
      || new Set(topStrictCodes).size !== topStrictCodes.length
      || new Set(nestedStrictCodes).size !== nestedStrictCodes.length
      || topStrictCodes.length !== nestedStrictCodes.length
      || topStrictCodes.some((code) => !nestedStrictCodes.includes(code))) {
      throw new Error("emotion_core_evidence_strict_basket_invalid");
    }
    if (evidence.status === "unavailable") {
      if (!evidence.dataQuality || evidence.dataQuality.failClosed !== true
        || strictRows.length || riskRows.length || coreCandidateRows.length
        || nestedStrictRows.length || nestedRiskRows.length || nestedCandidateRows.length) {
        throw new Error("emotion_core_evidence_unavailable_boundary_invalid");
      }
    } else if (!evidence.integrity || evidence.integrity.sameGeneration !== true) {
      throw new Error("emotion_core_evidence_same_generation_not_verified");
    }
    const strictCodes = new Set(strictPoolRows.map((row) => String(row && row.code || "")).filter(Boolean));
    if (strictPoolRows.some((row) => (
      !row || !row.qualification || row.qualification.authority !== "theme_cycle_leadership"
      || !row.identity || row.identity.authority !== "theme_cycle_leadership"
      || !rowMetadataMatches(row)
      || !Number.isFinite(Number(row.positiveInfluenceScore))
      || !Number.isFinite(Number(row.negativeInfluenceScore))
      || !Number.isFinite(Number(row.signedInfluenceScore))
      || Number(row.positiveInfluenceScore) < 0 || Number(row.positiveInfluenceScore) > 100
      || Number(row.negativeInfluenceScore) < 0 || Number(row.negativeInfluenceScore) > 100
      || Math.abs(Number(row.signedInfluenceScore)
        - (Number(row.positiveInfluenceScore) - Number(row.negativeInfluenceScore))) > 0.001
      || !String(row.voteRole || "").trim()
      || row.selectionAuthority !== false
      || row.executionAuthority !== false
    ))) throw new Error("emotion_core_evidence_authority_invalid");
    if (riskPoolRows.some((row) => (
      !row
      || !rowMetadataMatches(row)
      || row.votingWeight !== 0
      || Number(row.positiveInfluenceScore) !== 0
      || Number(row.negativeInfluenceScore) !== 0
      || Number(row.signedInfluenceScore) !== 0
      || String(row.voteRole || "") !== "height_context"
      || row.executionAuthority !== false
      || strictCodes.has(String(row.code || ""))
    ))) {
      throw new Error("emotion_core_evidence_pool_boundary_invalid");
    }
    if (allRows.some((row) => {
      if (!row || typeof row !== "object") return true;
      const classification = row.classification && typeof row.classification === "object" ? row.classification : {};
      const strict = classification.strictEmotionCore === true;
      const risk = classification.heightRiskBarometer === true;
      if (strict && risk) return true;
      if (risk && row.votingWeight !== 0) return true;
      if (strict) {
        if (!rowMetadataMatches(row)) return true;
        const identityCycleId = String(row.identity && row.identity.cycleInstanceId || "");
        const projectedCycleId = String(row.cycle && row.cycle.cycleInstanceId || "");
        if (!identityCycleId || !projectedCycleId || identityCycleId !== projectedCycleId) return true;
      }
      return false;
    })) throw new Error("emotion_core_evidence_nested_boundary_invalid");
    if (evidence.integrity && (
      evidence.integrity.riskRowsCannotVote !== true
      || evidence.integrity.strictCoreBasketMaxFive !== true
      || evidence.integrity.scoreSummaryDerivedFromRows !== true
    )) {
      throw new Error("emotion_core_evidence_risk_vote_integrity_invalid");
    }
    const influence = evidence.summary && evidence.summary.influence || {};
    const positiveTotal = Math.round(strictRows.reduce((sum, row) => sum + Number(row.positiveInfluenceScore || 0), 0) * 10) / 10;
    const negativeTotal = Math.round(strictRows.reduce((sum, row) => sum + Number(row.negativeInfluenceScore || 0), 0) * 10) / 10;
    const signedTotal = Math.round((positiveTotal - negativeTotal) * 10) / 10;
    if (Number(influence.positiveTotal) !== positiveTotal
      || Number(influence.negativeTotal) !== negativeTotal
      || Number(influence.signedTotal) !== signedTotal) {
      throw new Error("emotion_core_evidence_influence_summary_invalid");
    }
    return evidence;
  } catch (error) {
    return failClosedEmotionCoreEvidence({ generation, existingDecision, error });
  }
}

function storedPreviousEvidenceFromExactRaw(previousEvidence, previousRawPayload, expectedTradingDate) {
  if (!previousEvidence || typeof previousEvidence !== "object"
    || !previousRawPayload || typeof previousRawPayload !== "object") return null;
  const tradingDate = normalizeTradingDate(marketSnapshotTradingDate(previousRawPayload));
  const expectedDate = normalizeTradingDate(expectedTradingDate || "");
  const asOf = String(
    previousRawPayload.fetchedAt
    || previousRawPayload.updatedAt
    || "",
  ).trim();
  const asOfClock = shanghaiClockParts(asOf);
  if (!tradingDate
    || tradingDate !== expectedDate
    || !asOf
    || !asOfClock
    || asOfClock.date !== tradingDate
    || !strictExactClosingEvidence(previousRawPayload, tradingDate).ok) return null;
  const generationId = `${tradingDate}:${asOf}`;
  if (String(previousEvidence.tradingDate || "") !== tradingDate
    || String(previousEvidence.asOf || "") !== asOf
    || String(previousEvidence.generationId || "") !== generationId) return null;
  const validated = validatePreviousEvidence(
    previousEvidence,
    tradingDate,
    STRICT_CORE_CLASSIFIER_VERSION,
  );
  if (!validated) return null;
  const themeCycles = Array.isArray(previousEvidence.themeCycles)
    ? previousEvidence.themeCycles
    : [];
  const lineageRows = [
    ...(Array.isArray(previousEvidence.strictEmotionCores) ? previousEvidence.strictEmotionCores : []),
    ...(Array.isArray(previousEvidence.heightRiskBarometers) ? previousEvidence.heightRiskBarometers : []),
    ...(Array.isArray(previousEvidence.coreCandidates) ? previousEvidence.coreCandidates : []),
    ...themeCycles.flatMap((group) => [
      ...(Array.isArray(group && group.strictEmotionCores) ? group.strictEmotionCores : []),
      ...(Array.isArray(group && group.heightRiskBarometers) ? group.heightRiskBarometers : []),
      ...(Array.isArray(group && group.coreCandidates) ? group.coreCandidates : []),
    ]),
  ];
  if (lineageRows.some((row) => !previousRowLineageMatches(row, validated.expected))) return null;
  const strictRows = Array.isArray(previousEvidence.strictEmotionCores)
    ? previousEvidence.strictEmotionCores
    : [];
  const riskRows = Array.isArray(previousEvidence.heightRiskBarometers)
    ? previousEvidence.heightRiskBarometers
    : [];
  const summary = previousEvidence.summary && typeof previousEvidence.summary === "object"
    ? previousEvidence.summary
    : {};
  const summaryRiskCount = Number(
    summary.heightRiskBarometerCount ?? summary.riskBarometerCount,
  );
  if (Number(summary.strictCoreCount) !== strictRows.length
    || summaryRiskCount !== riskRows.length) return null;
  return previousEvidence;
}

function canonicalStoredEvidenceValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => canonicalStoredEvidenceValue(entry))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalStoredEvidenceValue(value[key]);
    return result;
  }, {});
}

function storedEvidenceCanonicalDigest(evidence) {
  if (!evidence || typeof evidence !== "object") return null;
  try {
    return JSON.stringify(canonicalStoredEvidenceValue(evidence));
  } catch (_) {
    return null;
  }
}

function exactClosingRawEnvelopeMatches(payload, tradingDate, asOf) {
  if (!payload || typeof payload !== "object" || !tradingDate || !asOf) return false;
  const expectedGenerationId = `${tradingDate}:${asOf}`;
  const generationContext = payload.generationContext && typeof payload.generationContext === "object"
    ? payload.generationContext
    : {};
  const archiveMeta = payload.archiveMeta && typeof payload.archiveMeta === "object"
    ? payload.archiveMeta
    : {};
  const archiveGenerationContext = archiveMeta.generationContext
    && typeof archiveMeta.generationContext === "object"
    ? archiveMeta.generationContext
    : {};
  const timestampFields = [
    payload.updatedAt,
    payload.asOf,
    generationContext.asOf,
    archiveMeta.asOf,
    archiveGenerationContext.asOf,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  if (timestampFields.some((value) => value !== asOf)) return false;
  const generationFields = [
    payload.generationId,
    generationContext.id,
    generationContext.generationId,
    archiveMeta.generationId,
    archiveGenerationContext.id,
    archiveGenerationContext.generationId,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  if (generationFields.some((value) => value !== expectedGenerationId)) return false;
  const dateFields = [
    payload.tradingDate,
    generationContext.tradingDate,
    archiveMeta.tradingDate,
    archiveGenerationContext.tradingDate,
  ]
    .map((value) => normalizeTradingDate(value || ""))
    .filter(Boolean);
  return dateFields.every((value) => value === tradingDate);
}

function replayExactClosingEmotionCoreEvidence(previousRawPayload, options = {}) {
  if (!previousRawPayload || typeof previousRawPayload !== "object") return null;
  const tradingDate = normalizeTradingDate(marketSnapshotTradingDate(previousRawPayload));
  const expectedTradingDate = normalizeTradingDate(options.expectedTradingDate || "");
  const asOf = String(
    previousRawPayload.fetchedAt
    || previousRawPayload.updatedAt
    || "",
  ).trim();
  const closingEvidence = strictExactClosingEvidence(previousRawPayload, tradingDate);
  const asOfClock = shanghaiClockParts(asOf);
  if (!tradingDate
    || !expectedTradingDate
    || tradingDate !== expectedTradingDate
    || !asOf
    || !asOfClock
    || asOfClock.date !== tradingDate
    || !exactClosingRawEnvelopeMatches(previousRawPayload, tradingDate, asOf)
    || !closingEvidence.ok) return null;

  let replayPayload;
  try {
    replayPayload = JSON.parse(JSON.stringify(previousRawPayload));
  } catch (_) {
    return null;
  }

  try {
    const generationContext = createGenerationContext({ tradingDate, asOf });
    attachGenerationContext(replayPayload, generationContext);
    replayPayload.themeLibrary = themeLibrarySnapshotFromPayload(
      replayPayload,
      "historical-current-session-replay",
      {
        forceRebuild: true,
        generationContext,
        allowPreviousArchiveRead: false,
      },
    );
    applyThemeCycleIdentitiesToCandidates(replayPayload);
    refreshPremarketModels(replayPayload, {
      generationContext,
      previousPayload: null,
      allowEmotionBigCycleWindowHistoryRead: false,
    });
    refreshTomorrowDecision(replayPayload, {
      generationContext,
      previousPayload: null,
      allowCanonicalReplay: false,
      allowHistoricalEvidenceReplay: false,
      allowPreviousArchiveRead: false,
      skipPostCloseOpportunityReport: true,
      selectedCandidateCode: "",
    });
    const evidence = replayPayload.emotionCoreEvidence
      && typeof replayPayload.emotionCoreEvidence === "object"
      ? replayPayload.emotionCoreEvidence
      : null;
    if (!evidence || evidence.status === "unavailable") return null;
    if (String(evidence.tradingDate || "") !== tradingDate
      || String(evidence.asOf || "") !== asOf
      || String(evidence.generationId || "") !== generationContext.generationId
      || String(evidence.basis && evidence.basis.tradingDate || "") !== tradingDate
      || String(evidence.basis && evidence.basis.snapshotKind || "").toLowerCase() !== "closing"
      || String(evidence.basis && evidence.basis.asOf || "") !== asOf) return null;
    const strictRows = Array.isArray(evidence.strictEmotionCores)
      ? evidence.strictEmotionCores
      : [];
    const riskRows = Array.isArray(evidence.heightRiskBarometers)
      ? evidence.heightRiskBarometers
      : [];
    if (strictRows.length) return null;
    if (riskRows.some((row) => !row || row.votingWeight !== 0)) return null;
    return {
      ...evidence,
      historicalReplay: {
        version: 1,
        status: "fail_closed_current_session_only",
        source: options.source || "exact_t1_closing_archive",
        tradingDate,
        asOf,
        generationId: generationContext.generationId,
        strictCoreCount: strictRows.length,
        riskBarometerCount: riskRows.length,
        currentSessionContractRecovered: true,
        crossDayEmotionStateRecovered: false,
        previousArchiveReadAllowed: false,
        postCloseReportSkipped: true,
        emotionStageAuthority: false,
        tradePermissionAuthority: false,
        futureDataUsed: false,
      },
    };
  } catch (_) {
    return null;
  }
}

function refreshTomorrowDecision(payload, options = {}) {
  if (!payload || typeof payload !== "object") return null;
  let marketState = {};
  let bestPicks = {};
  let marketEmotion = {};
  let generationContext = null;
  let asOf = null;
  let tradingDate = null;
  let snapshotGenerationId = null;
  try {
    generationContext = resolveGenerationContext(payload, options.generationContext || null);
    attachGenerationContext(payload, generationContext);
    const existingModels = payload.premarketModels && typeof payload.premarketModels === "object"
      ? payload.premarketModels
      : { version: 2 };
    const pendingEmotion = unavailablePremarketModel("情绪状态机", "等待当前轮核心情绪构建");
    pendingEmotion.pending = true;
    payload.premarketModels = {
      ...existingModels,
      version: 2,
      generationContext,
      generatedAt: generationContext.asOf,
      generationId: generationContext.generationId,
      emotionCycle: pendingEmotion,
      integrity: {
        ...(existingModels.integrity && typeof existingModels.integrity === "object" ? existingModels.integrity : {}),
        ok: false,
        status: "pending",
        pending: ["emotionCycle"],
        legacyFallbackAllowed: false,
      },
    };
  } catch (_) { /* hostile payloads are handled by the fail-safe below */ }
  try {
    if (!generationContext) {
      generationContext = resolveGenerationContext(payload, options.generationContext || null);
      attachGenerationContext(payload, generationContext);
    }
    const market = payload.market && typeof payload.market === "object" ? payload.market : {};
    marketState = market.state && typeof market.state === "object" ? market.state : {};
    bestPicks = payload.bestPicks && typeof payload.bestPicks === "object" ? payload.bestPicks : {};
    marketEmotion = payload.marketEmotion && typeof payload.marketEmotion === "object" ? payload.marketEmotion : {};
    // 在进入统一决策链前验证权威市场情绪对象可安全读取。恶意或损坏的
    // getter 必须进入既有 fail-safe，而不能因候选被提前清空而绕过校验。
    void marketEmotion.cycle;
    void bestPicks.focusDirection;
    asOf = generationContext.asOf;
    tradingDate = generationContext.tradingDate;
    snapshotGenerationId = generationContext.generationId;
    const basisResolution = resolveCanonicalClosingDecisionBasis(payload);
    if (["frozen_closing", "unavailable"].includes(basisResolution.status)) {
      throw new Error(basisResolution.status === "frozen_closing"
        ? "cross_date_preopen_payload_requires_closing_basis_normalization"
        : "exact_closing_decision_basis_unavailable");
    }
    if (!payload.decisionBasis && basisResolution.basis) {
      payload.decisionBasis = {
        version: 1,
        status: basisResolution.status,
        ...basisResolution.basis,
        source: "current_same_trading_date_closing_snapshot",
        preopenRanksExcluded: false,
      };
    }
    const decisionBasis = payload.decisionBasis && typeof payload.decisionBasis === "object"
      ? payload.decisionBasis
      : {
        status: "current_observation",
        tradingDate,
        snapshotKind: marketSnapshotKind(payload, tradingDate),
        asOf,
      };
    const currentModels = payload.premarketModels && typeof payload.premarketModels === "object"
      ? payload.premarketModels
      : { version: 2 };
    payload.premarketModels = {
      ...currentModels,
      version: 2,
      generationContext,
      generatedAt: asOf,
      generationId: snapshotGenerationId,
    };
    let picks = Array.isArray(bestPicks.picks) ? bestPicks.picks : [];
    const selectedCandidateCode = String(
      options.selectedCandidateCode
      || payload.selectedCandidateCode
      || "",
    ).trim();
    const excludedCandidateCodes = recommendationCandidateCodes(payload, options);
    const previousRawPayload = Object.prototype.hasOwnProperty.call(options, "previousPayload")
      ? options.previousPayload
      : loadExactPreviousDecisionPayload(payload);
    const prepareOptions = { allowCanonicalReplay: options.allowCanonicalReplay !== false };
    if (Object.prototype.hasOwnProperty.call(options, "previousPreviousPayload")) {
      prepareOptions.previousPreviousPayload = options.previousPreviousPayload;
    }
    const prepared = prepareEmotionBuildInputs(payload, previousRawPayload, prepareOptions);
    const coreEmotionBasket = buildCoreEmotionBasket(prepared.payload, {
      previousPayload: prepared.previousPayload,
      currentTradingDate: prepared.currentTradingDate,
      expectedPreviousTradingDate: prepared.expectedPreviousTradingDate,
       tradingContext: {
         tradingDate: prepared.currentTradingDate,
         snapshotKind: decisionBasis.snapshotKind || marketSnapshotKind(payload, prepared.currentTradingDate),
         expectedPreviousTradingDate: prepared.expectedPreviousTradingDate,
        previousTradingDate: prepared.previousTradingDate,
        previousSnapshotKind: prepared.previousSnapshotKind,
        exactPreviousTradingDay: prepared.exactPreviousTradingDay,
        previousEvidenceVerified: prepared.previousEvidenceVerified,
      },
      selectedCandidateCode,
       excludedCandidateCodes,
       snapshotKind: decisionBasis.snapshotKind || marketSnapshotKind(payload, prepared.currentTradingDate),
       generationContext,
    });
    let emotionCycle = coreEmotionBasket && coreEmotionBasket.emotionCycle;
    if (!emotionCycle || typeof emotionCycle !== "object") {
      try {
        emotionCycle = buildEmotionCycleState({
          currentItems: Array.isArray(prepared.payload.candidates) ? prepared.payload.candidates : [],
          previousPayload: prepared.previousPayload,
          exactPreviousTradingDay: prepared.exactPreviousTradingDay,
          selectedCandidateCode,
           excludedCandidateCodes,
           emotionEffectContext: marketState.emotionEffectContext || null,
           emotionBigCycleWindow: marketState.emotionBigCycleWindow || null,
           snapshotKind: decisionBasis.snapshotKind || marketSnapshotKind(payload, prepared.currentTradingDate),
           generationContext,
           tradingContext: {
             tradingDate: prepared.currentTradingDate,
             snapshotKind: decisionBasis.snapshotKind || marketSnapshotKind(payload, prepared.currentTradingDate),
            expectedPreviousTradingDate: prepared.expectedPreviousTradingDate,
            previousTradingDate: prepared.previousTradingDate,
            previousSnapshotKind: prepared.previousSnapshotKind,
            exactPreviousTradingDay: prepared.exactPreviousTradingDay,
            previousEvidenceVerified: prepared.previousEvidenceVerified,
          },
        });
      } catch (error) {
        emotionCycle = unavailablePremarketModel("情绪状态机", error);
      }
    }
    emotionCycle = stampEmotionCycleSnapshot(emotionCycle, {
      currentTradingDate: prepared.currentTradingDate,
      expectedPreviousTradingDate: prepared.expectedPreviousTradingDate,
      generationId: snapshotGenerationId,
      asOf,
      replayedPreviousEmotion: prepared.replayedPreviousEmotion,
      previousTradingDate: prepared.previousTradingDate,
      previousSnapshotKind: prepared.previousSnapshotKind,
      previousEvidenceVerified: prepared.previousEvidenceVerified,
      basisTradingDate: decisionBasis.tradingDate || prepared.currentTradingDate,
      basisSnapshotKind: decisionBasis.snapshotKind || marketSnapshotKind(payload, tradingDate),
      basisAsOf: decisionBasis.asOf || asOf,
      basisStatus: decisionBasis.status || null,
    });
    if (coreEmotionBasket && typeof coreEmotionBasket === "object") {
      coreEmotionBasket.emotionCycle = emotionCycle;
    }
    const premarketModels = payload.premarketModels && typeof payload.premarketModels === "object"
      ? payload.premarketModels
      : { version: 2 };
    const modelErrors = [];
    [premarketModels.indexCycleRegime, premarketModels.tradingStylePreference, emotionCycle].forEach((model) => {
      if (model && (model.available === false || model.method === "unavailable")) {
        modelErrors.push(String(model.error || model.name || "premarket_model_unavailable"));
      }
    });
    payload.premarketModels = {
      ...premarketModels,
      version: 2,
      generationContext,
      generatedAt: asOf,
      generationId: snapshotGenerationId,
      emotionCycle,
      integrity: {
        ok: modelErrors.length === 0,
        status: modelErrors.length ? "invalid" : "valid",
        errors: modelErrors,
        pending: [],
        legacyFallbackAllowed: false,
      },
    };
    payload.emotionCycle = emotionCycle;
    const cycleGenerationStamp = (value) => value && typeof value === "object"
      ? {
        ...value,
        generationId: snapshotGenerationId,
        tradingDate: prepared.currentTradingDate || tradingDate,
        asOf,
        generationContext: { ...generationContext },
      }
      : value;
    if (marketState && typeof marketState === "object") {
      if (marketState.structuralResolution && typeof marketState.structuralResolution === "object") {
        marketState.structuralResolution = {
          ...marketState.structuralResolution,
          generationContext: { ...generationContext },
          transition: cycleGenerationStamp(marketState.structuralResolution.transition),
        };
      }
      marketState.dailyState = cycleGenerationStamp(marketState.dailyState);
    }
    const phaseDetail = buildMarketPhaseDetail({
      generationContext,
      indexCycleRegime: payload.premarketModels && payload.premarketModels.indexCycleRegime || null,
      emotionCycle,
      limitStats: market.limitStats && typeof market.limitStats === "object" ? market.limitStats : {},
      snapshot: market.snapshot && typeof market.snapshot === "object" ? market.snapshot : {},
      marketState,
      previousMarketState: prepared.previousPayload && prepared.previousPayload.market && prepared.previousPayload.market.state || null,
    });
    const decisionContext = buildTomorrowDecisionContext({
      marketPhaseDetail: phaseDetail,
      indexCycleRegime: payload.premarketModels && payload.premarketModels.indexCycleRegime || null,
      tradingStylePreference: payload.premarketModels && payload.premarketModels.tradingStylePreference || null,
      themeLibrary: payload.themeLibrary,
      marketState,
      previousMarketState: prepared.previousPayload && prepared.previousPayload.market && prepared.previousPayload.market.state,
      limitStats: market.limitStats && typeof market.limitStats === "object" ? market.limitStats : {},
      generationId: snapshotGenerationId,
      tradingDate: prepared.currentTradingDate || tradingDate,
      asOf,
    });
    payload.marketPhaseDetail = {
      ...phaseDetail,
      decisionContext,
      generationContext,
      generationId: snapshotGenerationId,
      asOf,
      tradingDate: prepared.currentTradingDate || tradingDate,
      basisTradingDate: decisionBasis.tradingDate || prepared.currentTradingDate || tradingDate,
      basisSnapshotKind: decisionBasis.snapshotKind || null,
      basisAsOf: decisionBasis.asOf || asOf,
      basisStatus: decisionBasis.status || null,
    };
    if (marketState && typeof marketState === "object") {
      const priorIndexStructuralResolution = marketState.structuralResolution
        && typeof marketState.structuralResolution === "object"
        ? { ...marketState.structuralResolution }
        : null;
      marketState.phaseDetail = payload.marketPhaseDetail;
      // 兼容字段只能镜像当代权威大周期。当代未确认时必须明确写入
      // “未知”，不能留下旧缓存的混沌/主升/修复等标签让其他消费者误读。
      marketState.structuralCycle = phaseDetail.structuralCycle;
      marketState.indexStructuralCycle = phaseDetail.indexStructuralCycle;
      marketState.indexRiskResolution = priorIndexStructuralResolution;
      marketState.structuralResolution = {
        version: 1,
        method: "emotion_cycle_state_machine_projection",
        cycle: phaseDetail.structuralCycle,
        key: normalizeBigCycleKey(phaseDetail.structuralCycle),
        source: emotionCycle.bigCycle && emotionCycle.bigCycle.source || "emotion_cycle_state_machine",
        reasonCode: emotionCycle.bigCycle && emotionCycle.bigCycle.reasonCode || null,
        reason: emotionCycle.bigCycle && emotionCycle.bigCycle.reason || null,
        transition: emotionCycle.bigCycle && emotionCycle.bigCycle.transition || null,
        generationContext: { ...generationContext },
      };
      marketState.bigCycleTransition = phaseDetail.transition;
      marketState.emotionBigCycleTransition = emotionCycle.bigCycle && emotionCycle.bigCycle.transition || null;
      marketState.smallCycle = phaseDetail.smallCycle;
      marketState.indexSubPhase = phaseDetail.indexSubPhase;
      marketState.emotionPhase = phaseDetail.emotionStage;
    }
    // 市场情绪与风格先由独立市场证据生成，不读取旧bestPicks反向自证。
    // 权威大/小周期生成后，只在此处按同代 decisionContext 运行统一个股因子引擎。
    bestPicks = buildCanonicalBestPicks(payload, prepared.previousPayload);
    payload.bestPicks = bestPicks;
    // 个股硬门槛已按权威大/小周期重算，风格载体也必须在此后重建。
    // 旧selected/bestPicks不参与载体授权，因此这一步不会形成下游自证。
    payload.premarketModels.tradingStylePreference = buildTradingStylePreference(marketSamplePayload(payload), {
      previousPayload: marketSamplePayload(prepared.previousPayload),
      outcomeRows: resolveStyleOutcomeRows(payload, options),
    });
    if (market.tradingStyle && typeof market.tradingStyle === "object") {
      market.tradingStyle.preferenceModel = payload.premarketModels.tradingStylePreference;
    }
    picks = Array.isArray(bestPicks.picks) ? bestPicks.picks : [];
    if (marketState && typeof marketState === "object") {
      marketState.effectAttribution = buildMarketEffectAttribution(payload);
    }
    const forecast = buildTomorrowMarketForecast(payload, {
      previousPayload: prepared.previousPayload,
      selectedCandidateCode,
      coreStocks: Array.isArray(coreEmotionBasket && coreEmotionBasket.items) ? coreEmotionBasket.items : [],
      emotionCycle,
      indexCycleRegime: payload.premarketModels && payload.premarketModels.indexCycleRegime || null,
    });
    const preliminaryFlow = buildPremarketFlow(payload);
    const unifiedExecution = executeUnifiedDecisionChain({
      payload,
      bestPicks,
      premarketFlow: preliminaryFlow,
    });
    const premarketGate = unifiedExecution.premarketGate;
    const unifiedDecisionChain = unifiedExecution.decisionChain;
    payload.unifiedDecisionChain = unifiedDecisionChain;
    bestPicks = unifiedExecution.bestPicks;
    payload.bestPicks = bestPicks;
    picks = Array.isArray(bestPicks.picks) ? bestPicks.picks : [];
    const decision = buildTomorrowDecision({
      forecast,
      marketEmotion,
      marketState,
      tradeWindow: marketState.tradeWindow || {},
      shockTransition: marketState.shockTransition || {},
      riskBoard: payload.riskBoard || {},
      bestPicks,
      picks,
      scenarioPlans: Array.isArray(bestPicks.scenarioPlans) ? bestPicks.scenarioPlans : [],
      premarketGate,
      fillByCode: options.fillByCode,
    });
    decision.market = {
      ...(decision.market && typeof decision.market === "object" ? decision.market : {}),
      cycle: phaseDetail.structuralCycle === "未知"
        ? "周期待确认"
        : phaseDetail.structuralCycle,
      cycleKey: normalizeBigCycleKey(phaseDetail.structuralCycle),
      corePhase: phaseDetail.emotionStage.label || decision.market && decision.market.corePhase || "阶段待确认",
      corePhaseKey: phaseDetail.emotionStage.key || decision.market && decision.market.corePhaseKey || null,
      indexSubPhase: phaseDetail.indexSubPhase,
      indexStructuralCycle: phaseDetail.indexStructuralCycle,
      mediumStructure: phaseDetail.mediumStructure,
      decisionContext,
      phaseDetail: payload.marketPhaseDetail,
      marketCapCarrier: payload.market && payload.market.marketCapCarrier || null,
    };
    decision.tomorrowBaseline = phaseDetail.tomorrowBaseline;
    decision.selectionPolicy = phaseDetail.selectionPolicy;
    decision.asOf = asOf;
    decision.tradingDate = prepared.currentTradingDate || tradingDate;
    decision.generationId = snapshotGenerationId;
    decision.generationContext = generationContext;
    decision.coreEmotion = {
      version: Number(coreEmotionBasket && coreEmotionBasket.version || 1),
      method: coreEmotionBasket && coreEmotionBasket.method || "rule_derived",
      calibrated: coreEmotionBasket && coreEmotionBasket.calibrated === true,
      summary: coreEmotionBasket && coreEmotionBasket.summary || null,
      dataQuality: coreEmotionBasket && coreEmotionBasket.dataQuality || null,
      items: (Array.isArray(coreEmotionBasket && coreEmotionBasket.items) ? coreEmotionBasket.items : []).map((item) => ({
        code: String(item && (item.code || item.secCode) || ""),
        name: String(item && item.name || ""),
        stage: item && item.sentimentStage || "unknown",
        weight: Number(item && item.emotionWeight || 0),
        selectedCandidate: Boolean(item && item.lifecycle && item.lifecycle.selectedCandidate),
        confidence: item && item.lifecycle && item.lifecycle.confidence || 0,
        source: item && item.lifecycle && item.lifecycle.source || "unknown",
        expectedTransition: item && item.lifecycle && item.lifecycle.expectedTransition || null,
        evidence: Array.isArray(item && item.lifecycle && item.lifecycle.evidence)
          ? item.lifecycle.evidence.map((row) => String(row && (row.detail || row.label || row) || "")).filter(Boolean).slice(0, 4)
          : [],
      })),
      rejectedCount: Array.isArray(coreEmotionBasket && coreEmotionBasket.rejected) ? coreEmotionBasket.rejected.length : 0,
      generationContext,
      generationId: snapshotGenerationId,
      asOf,
      tradingDate: prepared.currentTradingDate || tradingDate,
      emotionCycle,
    };
    decision.premarketGate = premarketGate;
    decision.opportunityMap = buildTomorrowOpportunityMap({
      payload,
      decision,
      themeLibrary: themeLibrarySnapshotFromPayload(payload, "current-cache", {
        generationContext,
        allowPreviousArchiveRead: options.allowPreviousArchiveRead !== false,
      }) || {},
      candidates: Array.isArray(payload.candidates) ? payload.candidates : [],
      coreEmotionItems: decision.coreEmotion.items,
      riskBoard: payload.riskBoard || {},
      tradeWindow: marketState.tradeWindow || {},
    });
    const previousDecision = previousRawPayload && previousRawPayload.tomorrowDecision
      && typeof previousRawPayload.tomorrowDecision === "object"
      ? previousRawPayload.tomorrowDecision
      : {};
    const nestedPreviousEvidence = previousDecision.emotionCoreEvidence
      && typeof previousDecision.emotionCoreEvidence === "object"
      ? previousDecision.emotionCoreEvidence
      : null;
    const topLevelPreviousEvidence = previousRawPayload && previousRawPayload.emotionCoreEvidence
      && typeof previousRawPayload.emotionCoreEvidence === "object"
      ? previousRawPayload.emotionCoreEvidence
      : null;
    const validatedStoredPreviousEvidence = prepared.exactPreviousTradingDay
      ? [nestedPreviousEvidence, topLevelPreviousEvidence]
        .map((row) => storedPreviousEvidenceFromExactRaw(
          row,
          previousRawPayload,
          prepared.expectedPreviousTradingDate,
        ))
        .filter(Boolean)
      : [];
    const storedDigests = validatedStoredPreviousEvidence.map(storedEvidenceCanonicalDigest);
    const storedCopiesConflict = validatedStoredPreviousEvidence.length > 1 && (
      storedDigests.some((digest) => !digest)
      || new Set(storedDigests).size !== 1
    );
    const storedPreviousEvidence = !storedCopiesConflict
      ? validatedStoredPreviousEvidence[0] || null
      : null;
    const replayedPreviousEvidence = prepared.exactPreviousTradingDay
      && !storedPreviousEvidence
      && options.allowHistoricalEvidenceReplay !== false
      ? replayExactClosingEmotionCoreEvidence(previousRawPayload, {
        expectedTradingDate: prepared.expectedPreviousTradingDate,
      })
      : null;
    const previousEmotionCoreEvidence = prepared.exactPreviousTradingDay
      ? (storedPreviousEvidence || replayedPreviousEvidence)
      : null;
    const previousEvidenceRecovery = previousEmotionCoreEvidence ? {
      version: 1,
      status: replayedPreviousEvidence ? "replayed_fail_closed" : "stored",
      tradingDate: String(previousEmotionCoreEvidence.tradingDate || prepared.expectedPreviousTradingDate || "") || null,
      asOf: String(previousEmotionCoreEvidence.asOf || "") || null,
      generationId: String(previousEmotionCoreEvidence.generationId || "") || null,
      strictCoreCount: Array.isArray(previousEmotionCoreEvidence.strictEmotionCores)
        ? previousEmotionCoreEvidence.strictEmotionCores.length
        : 0,
      riskBarometerCount: Array.isArray(previousEmotionCoreEvidence.heightRiskBarometers)
        ? previousEmotionCoreEvidence.heightRiskBarometers.length
        : 0,
      currentSessionContractRecovered: replayedPreviousEvidence
        ? replayedPreviousEvidence.historicalReplay
          && replayedPreviousEvidence.historicalReplay.currentSessionContractRecovered === true
        : true,
      crossDayEmotionStateRecovered: replayedPreviousEvidence ? false : null,
      previousArchiveReadAllowed: replayedPreviousEvidence
        ? replayedPreviousEvidence.historicalReplay
          && replayedPreviousEvidence.historicalReplay.previousArchiveReadAllowed === true
        : null,
      emotionStageAuthority: false,
      tradePermissionAuthority: false,
      futureDataUsed: false,
    } : {
      version: 1,
      status: "unavailable",
      tradingDate: prepared.expectedPreviousTradingDate || null,
      emotionStageAuthority: false,
      tradePermissionAuthority: false,
      futureDataUsed: false,
    };
    const emotionCoreEvidence = {
      ...buildAttachedEmotionCoreEvidence({
        payload,
        coreEmotionBasket,
        marketPhaseDetail: payload.marketPhaseDetail,
        generation: {
          id: snapshotGenerationId,
          tradingDate: prepared.currentTradingDate || tradingDate,
          asOf,
        },
        existingDecision: plainDecisionEvidenceSnapshot(decision),
        previousEvidence: previousEmotionCoreEvidence,
        expectedPreviousTradingDate: prepared.expectedPreviousTradingDate,
        builder: options.emotionCoreEvidenceBuilder,
      }),
      generationContext,
      previousEvidenceRecovery,
    };
    const scenarioGeneration = {
      generationId: snapshotGenerationId,
      tradingDate: prepared.currentTradingDate || tradingDate,
      asOf,
    };
    let emotionScenarioInference;
    try {
      const scenarioBuilder = typeof options.emotionScenarioInferenceBuilder === "function"
        ? options.emotionScenarioInferenceBuilder
        : buildEmotionScenarioInference;
      const builtScenario = scenarioBuilder({
        payload,
        emotionCoreEvidence,
        existingDecision: decision,
        generation: scenarioGeneration,
      });
      emotionScenarioInference = validateEmotionScenarioInference(builtScenario, scenarioGeneration)
        ? builtScenario
        : unavailableEmotionScenarioInference(scenarioGeneration, ["scenario_contract_validation_failed"]);
    } catch (scenarioError) {
      emotionScenarioInference = unavailableEmotionScenarioInference(scenarioGeneration, [
        `scenario_builder_failed:${String(scenarioError && scenarioError.message || scenarioError || "unknown")}`,
      ]);
    }
    emotionCoreEvidence.emotionScenarioInference = emotionScenarioInference;
    if (emotionCoreEvidence.emotionStagePath
      && emotionCoreEvidence.emotionStagePath.nodes
      && emotionCoreEvidence.emotionStagePath.nodes.tomorrow) {
      emotionCoreEvidence.emotionStagePath.nodes.tomorrow.scenarioInference = emotionScenarioInference;
    }
    decision.emotionScenarioInference = emotionScenarioInference;
    decision.emotionCoreEvidence = emotionCoreEvidence;
    payload.emotionCoreEvidence = emotionCoreEvidence;
    payload.emotionScenarioInference = emotionScenarioInference;
    payload.tomorrowDecision = decision;
    // 统一链必须先完成仓位分配，再生成正式盘前计划；第一遍flow只用于上游门禁。
    // 因而正式payload中的flow在这里重建，position/canonicalAllocation均来自chain result。
    payload.premarketFlow = buildPremarketFlow(payload);
    if (options.skipPostCloseOpportunityReport !== true) {
      refreshPostCloseOpportunityReport(payload);
    }
    return decision;
  } catch (error) {
    const errorMessage = String(error && error.message || error || "unknown error");
    const safeField = (object, key, fallback = null) => {
      try {
        const value = object && object[key];
        return value === undefined || value === null ? fallback : value;
      } catch (_) {
        return fallback;
      }
    };
    const failedModelsSnapshot = safeField(payload, "premarketModels", {});
    const failedIndex = safeField(failedModelsSnapshot, "indexCycleRegime", {});
    const failedIndexUsable = Number(safeField(failedIndex, "version", 0)) >= 1
      && safeField(failedIndex, "available", true) !== false
      && String(safeField(failedIndex, "method", "") || "") !== "unavailable";
    const failedShortTerm = safeField(failedIndex, "shortTerm", {});
    const failedMediumTerm = safeField(failedIndex, "mediumTerm", {});
    if (!generationContext) {
      const payloadAsOf = String(
        safeField(payload, "fetchedAt", "") || safeField(payload, "updatedAt", "") || "",
      ).trim();
      generationContext = createGenerationContext({
        tradingDate: tradingDate || safeField(payload, "tradingDate", null),
        asOf: payloadAsOf && Number.isFinite(Date.parse(payloadAsOf)) ? payloadAsOf : nowIso(),
      });
      try { attachGenerationContext(payload, generationContext); } catch (_) { /* hostile payload */ }
    }
    tradingDate = generationContext.tradingDate;
    const failedAsOf = generationContext.asOf;
    const failedGenerationId = generationContext.generationId;
    const safeCycle = failedIndexUsable
      ? String(
        safeField(failedShortTerm, "label", null)
        || safeField(failedMediumTerm, "label", null)
        || "周期待确认",
      )
      : "周期待确认";
    try {
      const existingModels = failedModelsSnapshot;
      const failedEmotion = stampEmotionCycleSnapshot(
        unavailablePremarketModel("情绪状态机", errorMessage),
        {
          currentTradingDate: tradingDate,
          expectedPreviousTradingDate: null,
          generationId: failedGenerationId,
          asOf: failedAsOf,
        },
      );
      payload.premarketModels = {
        ...(existingModels && typeof existingModels === "object" ? existingModels : {}),
        version: 2,
        generationContext,
        generatedAt: failedAsOf,
        generationId: failedGenerationId,
        emotionCycle: failedEmotion,
        integrity: {
          ok: false,
          status: "invalid",
          errors: [errorMessage],
          pending: [],
          legacyFallbackAllowed: false,
        },
      };
      payload.emotionCycle = failedEmotion;
    } catch (_) { /* defensive getter/setter payload */ }
    const failedDecision = {
      version: 1,
      generationContext,
      generationId: failedGenerationId,
      asOf: failedAsOf,
      tradingDate,
      method: "unavailable",
      methodLabel: "决策链不可用",
      calibrated: false,
      verdict: "wait",
      tone: "bad",
      primaryScenarioKey: null,
      scenarios: [
        { key: "strengthen", label: "加强", probability: null },
        { key: "range_divergence", label: "震荡分化", probability: null },
        { key: "weaken", label: "减弱", probability: null },
      ],
      confidence: { score: null, label: "不可用", reason: "决策链构建失败，不生成概率或交易建议", method: "unavailable", calibrated: false },
      market: { cycle: safeCycle, corePhase: "阶段待确认" },
      direction: { status: "cash", name: null, path: "停止执行", reason: `决策链构建失败：${errorMessage}` },
      candidates: [],
      contingencies: [],
      permission: {
        status: "blocked",
        executionMode: "blocked",
        canActivate: false,
        allowImmediateEntry: false,
        allowAdd: false,
        reasons: [`决策链构建失败：${errorMessage}`],
        summary: "0% · 决策链不可用，禁止新开仓",
      },
      action: { key: "cash_wait", summary: "空仓等待；重新抓取并通过完整校验后再判断。" },
      invalidation: { conditions: ["决策链构建失败"], summary: "当前所有候选失效" },
      validation: {
        upgrade: [],
        hold: [],
        downgrade: [],
      },
      opportunityMap: {
        version: 1,
        tradingDate,
        status: "none",
        globalGate: {
          status: "closed",
          canOpen: false,
          canActivate: false,
          canTradeCandidates: false,
          primaryScenarioKey: null,
          reasonCodes: ["tomorrow_decision_build_failed"],
          reasons: [`决策链构建失败：${errorMessage}`],
        },
        directions: [],
        rejectedDirections: [],
        limits: { maxDirections: 3, maxAnchorsPerDirection: 2, maxTradeCandidatesPerDirection: 1 },
        integrity: {
          ok: false,
          error: "tomorrow_decision_build_failed",
          anchorCandidateContractsSeparated: true,
          closedGateStripsTradeCandidates: true,
        },
      },
      integrity: { ok: false, status: "invalid", errors: ["tomorrow_decision_build_failed"], warnings: [], error: errorMessage },
      forecast: null,
    };
    const failedEvidence = {
      ...failClosedEmotionCoreEvidence({
        generation: {
          id: failedGenerationId,
          tradingDate,
          asOf: failedAsOf,
        },
        existingDecision: plainDecisionEvidenceSnapshot(failedDecision),
        error: errorMessage,
      }),
      generationContext,
    };
    const failedScenarioInference = unavailableEmotionScenarioInference({
      generationId: failedGenerationId,
      tradingDate,
      asOf: failedAsOf,
    }, ["tomorrow_decision_build_failed"]);
    failedEvidence.emotionScenarioInference = failedScenarioInference;
    failedDecision.emotionScenarioInference = failedScenarioInference;
    failedDecision.emotionCoreEvidence = failedEvidence;
    try {
      payload.emotionCoreEvidence = failedEvidence;
      payload.emotionScenarioInference = failedScenarioInference;
      payload.tomorrowDecision = failedDecision;
      payload.unifiedDecisionChain = unavailableDecisionChain(payload, `决策链构建失败：${errorMessage}`);
      payload.bestPicks = applyDecisionChainToBestPicks(
        payload.bestPicks && typeof payload.bestPicks === "object" ? payload.bestPicks : {},
        payload.unifiedDecisionChain,
      );
      refreshPostCloseOpportunityReport(payload);
    } catch (_) { /* defensive getter/setter payload */ }
    return failedDecision;
  }
}

function buildSuperExpectationSnapshot(payload) {
  try {
    const tradingDate = marketEmotionTradingDate(payload);
    const limitDates = payload && payload.market && payload.market.limitStats
      && payload.market.limitStats.dates || null;
    const expectedPrevDate = limitDates && limitDates.verified === true
      ? normalizeCycleYmd(limitDates.prev || "")
      : "";
    const previousArchive = expectedPrevDate
      ? loadPrevArchive(tradingDate, {
        expectedDate: expectedPrevDate,
        requireExact: true,
      })
      : null;
    return buildSuperExpectationRadar(payload, previousArchive);
  } catch (error) {
    return {
      version: 3,
      generatedAt: payload && (payload.fetchedAt || payload.updatedAt) || new Date().toISOString(),
      tradingDate: marketEmotionTradingDate(payload),
      principle: "先把今日状态互斥归为稳定强、强势回封、有效弱基线、普通弱或主动失败，再分别进入弱转强/强转强路线；超预期不自动等于买入。",
      counts: { scannedCore: 0, candidates: 0, validating: 0, confirmed: 0, initial: 0, failed: 0, expired: 0 },
      candidateStage: {
        title: "明日超预期候选池",
        note: "本轮数据不完整，等待下一次完整抓取。",
        candidates: [],
        rejectedCoreCount: 0,
        rejected: [],
      },
      validationStage: {
        title: "今日超预期验证与应对",
        note: "本轮数据不完整，不能生成交易动作。",
        validations: [],
      },
      candidates: [],
      degraded: true,
      error: String(error && error.message || error || "unknown error"),
    };
  }
}

function loadMarketEmotionArchives(today, limit = 3) {
  try {
    const historyRoot = path.join(runtimeRoot, "data", "history");
    const index = readJsonFile(path.join(historyRoot, "index.json")) || [];
    return index
      .filter((row) => row && row.date && row.date < today)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, limit)
      .map((row) => ({ date: row.date, payload: readJsonFile(path.join(historyRoot, `${row.date}.json`)) }))
      .filter((row) => row.payload);
  } catch {
    return [];
  }
}

function marketEmotionCandidateView(stock, extra = {}) {
  if (!stock) return null;
  const profile = stock.klineProfile || {};
  const leadership = stock.leadership || extra.leadership || null;
  const numberOrNull = (value) => (
    value === null || value === undefined || value === ""
      ? null
      : Number.isFinite(Number(value))
        ? Number(value)
        : null
  );
  const directChangePct = numberOrNull(stock.changePct);
  const currentPrice = numberOrNull(stock.price);
  const currentAmountYi = numberOrNull(stock.amountYi);
  const preservedSession = leadership && leadership.initiative && leadership.initiative.session
    ? leadership.initiative.session
    : null;
  const preservedChangePct = numberOrNull(preservedSession && preservedSession.currentChangePct);
  const hasDirectQuote = (currentPrice !== null && currentPrice > 0)
    || (currentAmountYi !== null && currentAmountYi > 0)
    || (directChangePct !== null && directChangePct !== 0);
  const usePreservedClose = !hasDirectQuote && preservedChangePct !== null;
  const resolvedChangePct = usePreservedClose ? preservedChangePct : directChangePct;
  const initiative = leadership && leadership.initiative ? leadership.initiative : {};
  const initiativeScore = leadership ? numberOrNull(initiative.score) : null;
  const followerCount = Number(initiative.followerCount || 0);
  const rhythmLeaderQualified = Boolean(
    (initiativeScore !== null && initiativeScore >= 60)
    || (leadership && leadership.tradeState === "主攻候选")
    || (
      /分时验证/.test(String(initiative.dataQuality || ""))
      && preservedSession
      && preservedSession.firstAttackTime
      && followerCount >= 2
      && resolvedChangePct !== null
      && resolvedChangePct >= 3
    )
  );
  const todayAvailable = extra.todayAvailable === false
    ? false
    : extra.todayAvailable === true
      ? true
      : Boolean(hasDirectQuote || usePreservedClose);
  const evidenceTags = Array.isArray(extra.evidenceTags)
    ? extra.evidenceTags.filter(Boolean).map(String)
    : [];
  if (usePreservedClose) {
    evidenceTags.push(`沿用${String(preservedSession.tradingDate || "上一交易日")}收盘验证`);
  }
  const pctFromHigh = numberOrNull(profile.pctFromHigh);
  const shape = profile.newHigh
    ? "创新高"
    : profile.nearHigh20
      ? "接近前高"
      : pctFromHigh !== null && pctFromHigh <= 8
        ? `距前高${pctFromHigh.toFixed(1)}%`
        : "震荡/回撤区间";
  return {
    code: String(stock.code || stock.secCode || ""),
    name: String(stock.name || stock.code || "--"),
    role: String(stock.role || stock.ticketType || extra.role || "观察"),
    concept: String(stock.mainConcept || stock.mainFamily || stock.concept || extra.concept || ""),
    changePct: resolvedChangePct,
    amountYi: currentAmountYi,
    score: numberOrNull(stock.score),
    rise10: numberOrNull(profile.rise10),
    rise20: numberOrNull(profile.rise20),
    pctFromHigh,
    newHigh: Boolean(profile.newHigh),
    nearHigh20: Boolean(profile.nearHigh20),
    shape,
    identity: leadership ? String(leadership.identity || leadership.levelLabel || "地位待确认") : "地位待确认",
    leadershipLevel: leadership ? String(leadership.level || "L1") : "L1",
    initiativeScore,
    initiativeLabel: leadership ? String(leadership.initiative && leadership.initiative.label || "主动性待确认") : "主动性待确认",
    initiativeDataQuality: leadership ? String(leadership.initiative && leadership.initiative.dataQuality || "数据待确认") : "数据待确认",
    structureGrade: leadership ? String(leadership.structure && leadership.structure.grade || "--") : "--",
    positionLabel: leadership ? String(leadership.structure && leadership.structure.positionLabel || "位置待确认") : "位置待确认",
    chipLabel: leadership ? String(leadership.structure && leadership.structure.chipLabel || "筹码待确认") : "筹码待确认",
    tradeState: leadership ? String(leadership.tradeState || "仅观察") : "仅观察",
    executionNote: leadership ? String(leadership.executionNote || "等待验证") : "等待验证",
    coreQualified: Boolean(leadership && leadership.coreQualified),
    rhythmLeaderQualified,
    sourceDate: extra.sourceDate || null,
    todayAvailable,
    historyHits: Number(extra.historyHits || 0),
    evidenceTags,
  };
}

function marketEmotionGroupStats(items) {
  const available = (Array.isArray(items) ? items : []).filter((item) => item && item.todayAvailable !== false && Number.isFinite(Number(item.changePct)));
  const count = available.length;
  const avgChangePct = count
    ? Math.round((available.reduce((sum, item) => sum + Number(item.changePct), 0) / count) * 100) / 100
    : null;
  const ratio = (predicate) => count ? Math.round((available.filter(predicate).length / count) * 100) : 0;
  return {
    total: Array.isArray(items) ? items.length : 0,
    available: count,
    avgChangePct,
    positiveRate: ratio((item) => Number(item.changePct) > 0),
    strongRate: ratio((item) => Number(item.changePct) >= 3),
    limitRate: ratio((item) => Number(item.changePct) >= 9.5),
    newHighCount: available.filter((item) => item.newHigh).length,
    nearHighCount: available.filter((item) => item.nearHigh20).length,
    amountYi: Math.round(available.reduce((sum, item) => sum + Number(item.amountYi || 0), 0) * 10) / 10,
  };
}

/**
 * 市场情绪观察层：只判断修复质量与次日验证条件，不参与周期、评分、选股或买卖决策。
 * 三组股票全部动态生成：当天容量锚点、近1-3日情绪核心、超跌/老核心反弹。
 */
function buildMarketEmotionObservation(payload) {
  const market = payload && payload.market ? payload.market : {};
  const snapshot = market.snapshot || {};
  const state = market.state || {};
  const limitStats = market.limitStats || {};
  const candidates = Array.isArray(payload && payload.candidates) ? payload.candidates : [];
  const today = marketEmotionTradingDate(payload || {});
  const archives = loadMarketEmotionArchives(today, 3);
  const currentByCode = new Map(candidates.filter(Boolean).map((item) => [String(item.code || item.secCode || ""), item]));
  const currentByName = new Map(candidates.filter(Boolean).map((item) => [String(item.name || ""), item]));

  const uniqueStocks = (rows, limit) => {
    const seen = new Set();
    const result = [];
    for (const stock of rows.filter(Boolean)) {
      const key = String(stock.code || stock.secCode || stock.name || "");
      const placeholder = key === "--" || /暂无明确|暂无/.test(String(stock.name || ""));
      if (!key || placeholder || seen.has(key)) continue;
      seen.add(key);
      result.push(stock);
      if (result.length >= limit) break;
    }
    return result;
  };
  const resolvedEmotionChange = (stock) => {
    const view = marketEmotionCandidateView(stock);
    return view && view.todayAvailable !== false && Number.isFinite(Number(view.changePct))
      ? Number(view.changePct)
      : null;
  };
  const oversoldEvidenceTags = (stock) => {
    const profile = stock && stock.klineProfile ? stock.klineProfile : {};
    const tags = [];
    const rise10 = Number(profile.rise10);
    const rise20 = Number(profile.rise20);
    const pctFromHigh = Number(profile.pctFromHigh);
    if (Number.isFinite(rise10) && rise10 <= -8) tags.push(`近10日${rise10.toFixed(1)}%`);
    if (Number.isFinite(rise20) && rise20 <= -5) tags.push(`近20日${rise20.toFixed(1)}%`);
    if (Number.isFinite(pctFromHigh) && pctFromHigh >= 15) tags.push(`距阶段高点${pctFromHigh.toFixed(1)}%`);
    return tags;
  };

  const focusName = String(
    (payload && payload.topicBoard && payload.topicBoard.mainLine && (payload.topicBoard.mainLine.name || payload.topicBoard.mainLine.family))
    || (payload && payload.hotConcepts && payload.hotConcepts[0] && (payload.hotConcepts[0].name || payload.hotConcepts[0].family))
    || "",
  );
  const focusFamily = String(
    (payload && payload.topicBoard && payload.topicBoard.mainLine && payload.topicBoard.mainLine.family)
    || (payload && payload.hotConcepts && payload.hotConcepts[0] && payload.hotConcepts[0].family)
    || focusName,
  );
  const focusRows = candidates.filter((item) => {
    const conceptText = [item && item.mainConcept, item && item.mainFamily, item && item.concept].filter(Boolean).join(" ");
    return focusName && conceptText && (focusName.includes(conceptText) || conceptText.includes(focusName));
  });
  const leadershipBoard = payload && payload.leadershipBoard && typeof payload.leadershipBoard === "object"
    ? payload.leadershipBoard
    : {};
  const verifiedLeadershipRows = [
    ...(Array.isArray(leadershipBoard.leaders)
      ? leadershipBoard.leaders.filter((item) => item && item.coreIdentityQualified === true)
      : []),
    ...candidates.filter((item) => item && item.leadership && item.leadership.coreIdentityQualified === true),
  ];
  // 情绪/容量锚点只接受已经通过“核心身份”门槛的标的。旧 emotionAnchor、
  // selected、热榜角色不能兜底，否则会把一字高度票和普通中军重新包装成核心。
  const anchorSeeds = verifiedLeadershipRows.map((seed) => (
    currentByCode.get(String(seed && (seed.code || seed.secCode) || ""))
    || currentByName.get(String(seed && seed.name || ""))
    || seed
  ));
  const anchorItems = uniqueStocks(anchorSeeds, 5)
    .map((seed) => {
      const current = currentByCode.get(String(seed.code || seed.secCode || "")) || currentByName.get(String(seed.name || "")) || seed;
      return marketEmotionCandidateView(current);
    })
    .filter(Boolean);

  const recentMap = new Map();
  archives.forEach((entry, archiveIndex) => {
    const historyCandidates = Array.isArray(entry.payload && entry.payload.candidates) ? entry.payload.candidates : [];
    const sameFamily = historyCandidates.filter((stock) => {
      const familyText = String(stock && (stock.mainFamily || stock.mainConcept || stock.concept) || "");
      return focusFamily && familyText && (focusFamily.includes(familyText) || familyText.includes(focusFamily));
    });
    const recentSource = sameFamily.length >= 4 ? sameFamily : historyCandidates;
    recentSource.slice(0, 12).forEach((stock, rankIndex) => {
      const code = String(stock && (stock.code || stock.secCode) || "");
      if (!code) return;
      const row = recentMap.get(code) || { code, stock, hits: 0, latestDate: entry.date, weight: 0 };
      row.hits += 1;
      row.weight += (3 - archiveIndex) * 18 + Math.max(0, 12 - rankIndex) + (/龙头|中军/.test(String(stock.role || "")) ? 8 : 0);
      if (!row.latestDate || entry.date > row.latestDate) {
        row.latestDate = entry.date;
        row.stock = stock;
      }
      recentMap.set(code, row);
    });
  });
  const recentItems = Array.from(recentMap.values())
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8)
    .map((row) => {
      const current = currentByCode.get(row.code);
      return marketEmotionCandidateView(current || row.stock, {
        sourceDate: row.latestDate,
        todayAvailable: Boolean(current),
        historyHits: row.hits,
      });
    })
    .filter(Boolean);

  const oldCoreRows = candidates
    .filter((item) => {
      if (!item) return false;
      const code = String(item.code || item.secCode || "");
      const identity = String(item.leadership && (item.leadership.identity || item.leadership.levelLabel) || "");
      const history = recentMap.get(code);
      const leadershipHistory = item.leadership && item.leadership.history && typeof item.leadership.history === "object"
        ? item.leadership.history
        : {};
      const appearances = Number(leadershipHistory.appearances || 0);
      const coreHits = Number(leadershipHistory.coreHits || 0);
      const activeHits = Number(leadershipHistory.activeHits || 0);
      const explicitHistoricalCore = /历史情绪核心|老核心/.test(identity);
      const reactivatedHistoricalCore = coreHits >= 1
        && activeHits >= 1
        && !/情绪\/历史核心/.test(identity);
      // “情绪/历史核心”是兼容性宽标签，新近核心也可能拿到，不能单独证明它是老核心。
      // 老核心只接受明确的“历史情绪核心”，或曾有主动记录、如今重新激活的旧核心。
      return Boolean(
        (appearances >= 2 && explicitHistoricalCore)
        || (appearances >= 2 && reactivatedHistoricalCore)
        || (history && history.hits >= 2 && explicitHistoricalCore),
      );
    })
    .sort((a, b) => {
      const aCode = String(a.code || a.secCode || "");
      const bCode = String(b.code || b.secCode || "");
      const aHistory = recentMap.get(aCode);
      const bHistory = recentMap.get(bCode);
      const aInitiative = Number(a.leadership && a.leadership.initiative && a.leadership.initiative.score || 0);
      const bInitiative = Number(b.leadership && b.leadership.initiative && b.leadership.initiative.score || 0);
      const aWeight = Number(resolvedEmotionChange(a) || 0) * 4 + aInitiative / 5 + Number(aHistory && aHistory.hits || 0) * 3;
      const bWeight = Number(resolvedEmotionChange(b) || 0) * 4 + bInitiative / 5 + Number(bHistory && bHistory.hits || 0) * 3;
      return bWeight - aWeight;
    });
  const oldCoreItems = uniqueStocks(oldCoreRows, 8)
    .map((item) => {
      const code = String(item.code || item.secCode || "");
      const history = recentMap.get(code);
      const identity = String(item.leadership && (item.leadership.identity || item.leadership.levelLabel) || "");
      const leadershipHistory = item.leadership && item.leadership.history && typeof item.leadership.history === "object"
        ? item.leadership.history
        : {};
      const evidenceTags = [];
      if (Number(leadershipHistory.coreHits || 0) > 0) evidenceTags.push(`历史核心命中${Number(leadershipHistory.coreHits)}次`);
      if (history && history.hits) evidenceTags.push(`近3日候选出现${history.hits}次`);
      if (/历史情绪核心|老核心/.test(identity)) evidenceTags.push(identity);
      return marketEmotionCandidateView(item, {
        historyHits: Number(history && history.hits || 0),
        evidenceTags,
      });
    })
    .filter(Boolean);

  const oversoldSource = focusRows.length ? focusRows : candidates;
  const oversoldRows = oversoldSource
    .filter((item) => {
      const profile = item && item.klineProfile ? item.klineProfile : {};
      const change = resolvedEmotionChange(item);
      const rise10 = Number(profile.rise10);
      const rise20 = Number(profile.rise20);
      const pctFromHigh = Number(profile.pctFromHigh);
      const oversold = (Number.isFinite(rise10) && rise10 <= -8)
        || (Number.isFinite(rise20) && rise20 <= -5)
        || (Number.isFinite(pctFromHigh) && pctFromHigh >= 15);
      return change !== null
        && change >= 3
        && oversold
        && (Number(item.amountYi || 0) >= 20 || item.inBothSources);
    })
    .sort((a, b) => (
      (Number(resolvedEmotionChange(b) || 0) * 3 + Number(b.amountYi || 0) / 50)
      - (Number(resolvedEmotionChange(a) || 0) * 3 + Number(a.amountYi || 0) / 50)
    ));
  const oversoldItems = uniqueStocks(oversoldRows, 6)
    .map((item) => marketEmotionCandidateView(item, { evidenceTags: oversoldEvidenceTags(item) }))
    .filter(Boolean);

  const carrierRows = candidates
    .filter((item) => item && item.leadership && (
      item.leadership.tradeQualified === true
      || item.leadership.coreQualified === true
    ))
    .sort((a, b) => {
      const stateRank = { 主攻候选: 2, 等回踩: 1 };
      const stateDiff = (stateRank[b.leadership.tradeState] || 0) - (stateRank[a.leadership.tradeState] || 0);
      if (stateDiff) return stateDiff;
      return Number(b.leadership.initiative && b.leadership.initiative.score || 0)
        - Number(a.leadership.initiative && a.leadership.initiative.score || 0);
    });
  const carrierItems = uniqueStocks(carrierRows, 6).map((item) => marketEmotionCandidateView(item)).filter(Boolean);

  const anchorStats = marketEmotionGroupStats(anchorItems);
  const carrierStats = marketEmotionGroupStats(carrierItems);
  const recentStats = marketEmotionGroupStats(recentItems);
  const oversoldStats = marketEmotionGroupStats(oversoldItems);
  const oldCoreStats = marketEmotionGroupStats(oldCoreItems);
  const breadth = Number.isFinite(Number(snapshot.breadth))
    ? Number(snapshot.breadth)
    : (Number(snapshot.upCount || 0) + Number(snapshot.downCount || 0)
      ? Number(snapshot.upCount || 0) / (Number(snapshot.upCount || 0) + Number(snapshot.downCount || 0))
      : 0.5);
  const breadthPct = Math.round(breadth * 100);
  const avgIndexChange = Number(snapshot.avgIndexChange || 0);
  const ztToday = Number(limitStats.ztToday);
  const ztPrev = Number(limitStats.ztPrev);
  const dtToday = Number(limitStats.dtToday);
  const dtPrev = Number(limitStats.dtPrev);
  const limitRepair = Number.isFinite(ztToday) && Number.isFinite(ztPrev) && Number.isFinite(dtToday) && Number.isFinite(dtPrev)
    ? ztToday > ztPrev && dtToday < dtPrev
    : null;
  const expectedPreviousTradingDate = limitStats && limitStats.dates && limitStats.dates.verified === true
    ? normalizeCycleYmd(limitStats.dates.prev)
    : "";
  const exactPreviousArchive = expectedPreviousTradingDate
    ? loadPrevArchive(today, { expectedDate: expectedPreviousTradingDate, requireExact: true })
    : null;
  // 成交额环比只能比较行情源确认的真实 T-1 收盘。历史断档时宁可缺失，
  // 也不能拿更早归档冒充上一交易日，造成虚假的放量/缩量结论。
  const previousSnapshot = exactPreviousArchive && exactPreviousArchive.payload && exactPreviousArchive.payload.market
    ? exactPreviousArchive.payload.market.snapshot || {}
    : {};
  const currentAmountYi = Number(snapshot.shszAmountYi || snapshot.totalAmountYi);
  const previousAmountYi = Number(previousSnapshot.shszAmountYi || previousSnapshot.totalAmountYi);
  const volumeDeltaPct = Number.isFinite(currentAmountYi) && currentAmountYi > 0 && Number.isFinite(previousAmountYi) && previousAmountYi > 0
    ? Math.round(((currentAmountYi / previousAmountYi) - 1) * 1000) / 10
    : null;

  const indexRepairStrong = avgIndexChange >= 0.8 && breadthPct >= 55 && limitRepair !== false;
  const recentStrong = recentStats.available >= 3
    && Number(recentStats.avgChangePct || 0) >= 3
    && recentStats.positiveRate >= 60
    && recentStats.strongRate >= 40;
  const recentWeak = recentStats.available >= 3
    && (Number(recentStats.avgChangePct || 0) < 1 || recentStats.positiveRate < 45);
  const anchorStrong = anchorStats.available >= 2
    && Number(anchorStats.avgChangePct || 0) >= 3
    && anchorStats.positiveRate >= 60;
  const carrierStrong = carrierItems.length >= 1
    && carrierItems.some((item) => item.tradeState === "主攻候选" && Number(item.initiativeScore || 0) >= 60);
  const volumeStrong = volumeDeltaPct !== null && volumeDeltaPct >= 3;
  const volumeWeak = volumeDeltaPct !== null && volumeDeltaPct < -2;
  const breakoutStrong = anchorStats.newHighCount > 0 || (anchorStats.available >= 3 && anchorStats.nearHighCount / anchorStats.available >= 0.4);
  const oversoldDominant = oversoldStats.available >= 2
    && oversoldStats.strongRate >= 50
    && Number(oversoldStats.avgChangePct || 0) > Number(recentStats.avgChangePct || 0) + 1;
  const oldCoreStrongItems = oldCoreItems.filter((item) => (
    item.todayAvailable !== false
    && Number.isFinite(Number(item.changePct))
    && Number(item.changePct) >= 3
  ));
  const oldCoreLeaderItems = oldCoreStrongItems.filter((item) => (
    item.rhythmLeaderQualified === true
  ));
  const oldCoreLeaderCodes = new Set(oldCoreLeaderItems.map((item) => item.code));
  const oldCoreFollowerItems = oldCoreItems.filter((item) => (
    item.todayAvailable !== false
    && Number.isFinite(Number(item.changePct))
    && Number(item.changePct) >= 2
    && !oldCoreLeaderCodes.has(item.code)
  ));
  const oldCoreWeakItems = oldCoreItems.filter((item) => (
    item.todayAvailable !== false
    && Number.isFinite(Number(item.changePct))
    && Number(item.changePct) <= 0
  ));
  // “老核心主导”必须同时看到率先发动者与同类跟随，单只反弹不能写成带节奏。
  const oldCoreLed = oldCoreLeaderItems.length >= 1
    && oldCoreFollowerItems.length >= 1
    && oldCoreStats.positiveRate >= 50
    && Number(oldCoreStats.avgChangePct || 0) >= 2;

  let score = 0;
  score += avgIndexChange >= 1 ? 12 : avgIndexChange >= 0 ? 7 : 1;
  score += breadthPct >= 65 ? 12 : breadthPct >= 50 ? 7 : 1;
  score += limitRepair === true ? 10 : limitRepair === null ? 5 : 1;
  score += Number(recentStats.avgChangePct || 0) >= 4 ? 12 : Number(recentStats.avgChangePct || 0) >= 2 ? 8 : Number(recentStats.avgChangePct || 0) >= 0 ? 4 : 0;
  score += recentStats.positiveRate >= 65 ? 8 : recentStats.positiveRate >= 50 ? 5 : 1;
  score += recentStats.strongRate >= 50 ? 6 : recentStats.strongRate >= 25 ? 3 : 0;
  score += volumeDeltaPct === null ? 5 : volumeDeltaPct >= 5 ? 14 : volumeDeltaPct >= 0 ? 10 : volumeDeltaPct >= -5 ? 6 : 1;
  score += Number(anchorStats.avgChangePct || 0) >= 4 ? 8 : Number(anchorStats.avgChangePct || 0) >= 2 ? 5 : 1;
  score += anchorStats.positiveRate >= 60 ? 6 : anchorStats.positiveRate >= 40 ? 3 : 0;
  score += breakoutStrong ? 12 : anchorStats.nearHighCount > 0 ? 5 : 0;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const dailyStateKey = String(state && state.dailyState && state.dailyState.key || "");
  const dailyStateHealthy = ["repair_strengthening", "healthy_divergence"].includes(dailyStateKey);
  const lossFeedbackExpanded = Number.isFinite(dtToday)
    && dtToday >= 15
    && (!Number.isFinite(dtPrev) || dtToday > dtPrev);
  const profitEffectCollapsed = Number.isFinite(ztToday)
    && ztToday <= 20
    && (!Number.isFinite(ztPrev) || ztPrev <= 0 || ztToday < ztPrev * 0.65);
  const earningEffectExists = (Number.isFinite(ztToday) && ztToday >= 25)
    || carrierItems.some((item) => Number(item.changePct || 0) >= 3)
    || (anchorStats.available >= 2 && anchorStats.positiveRate >= 50);
  const extremeLossFeedback = Number.isFinite(dtToday)
    && dtToday >= 30
    && (!Number.isFinite(dtPrev) || dtToday > dtPrev);
  const indexBreadthWeak = avgIndexChange <= -0.8 || breadthPct < 35;
  // 指数下跌、上涨家数少只能说明盘面弱，不能单独等价为“资金出逃”。
  // 红灯必须由负反馈扩散 + 赚钱效应坍缩共同确认；健康分化日即使指数弱也保留试错权限。
  const hardRed = dailyStateKey === "retreat_candidate"
    || extremeLossFeedback
    || (!dailyStateHealthy
      && indexBreadthWeak
      && lossFeedbackExpanded
      && profitEffectCollapsed
      && !earningEffectExists);
  const highQuality = score >= 75 && indexRepairStrong && recentStrong && !volumeWeak && breakoutStrong;
  const light = hardRed ? "red" : highQuality ? "green" : "yellow";
  const lightLabel = light === "green" ? "绿灯" : light === "red" ? "红灯" : "黄灯";
  const quality = light === "green"
    ? "高质量修复 / 主线加强"
    : light === "red"
      ? "修复失败 / 负反馈扩散"
      : score >= 55
        ? "中等质量修复"
        : "低质量修复";
  const structureType = oversoldDominant && oldCoreLed
    ? "超跌与老核心共同主导"
    : oversoldDominant
      ? "超跌修复主导 · 老核心未带节奏"
      : oldCoreLed
        ? "老核心带动修复"
    : recentStrong && anchorStrong
      ? "主线核心共振"
      : anchorStrong
        ? "容量锚点带动、核心分化"
        : "存量轮动";
  const nextDayBase = light === "green"
    ? "主线加强后的分化，先看承接再加仓"
    : light === "red"
      ? "负反馈延续，取消新开仓"
      : "修复后的分化/兑现，不预设继续加强";
  const action = light === "green"
    ? "允许首仓1/3；近期核心与容量锚点继续同步、量能不退，再考虑加仓。"
    : light === "red"
      ? "停止新开仓，只处理持仓风险；等待指数、广度和核心组共同止跌。"
      : "只允许计划仓位的1/3试错，不直接加仓；9:30—9:35先看市场组是否同步。";

  const pctText = (value) => value === null ? "暂无跨日数据" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
  const summaryParts = [];
  if (indexRepairStrong) summaryParts.push("指数与市场广度修复成立");
  else summaryParts.push("指数/广度尚未共同确认");
  if (oversoldDominant) summaryParts.push("赚钱效应偏向超跌修复");
  if (oldCoreLed) summaryParts.push("老核心已有领涨与跟随");
  else if (oldCoreStrongItems.length) summaryParts.push("老核心有反弹但尚未形成带动");
  else summaryParts.push("老核心尚未出现明确领涨");
  if (recentStrong) summaryParts.push("近期情绪核心已有一致参与");
  else summaryParts.push("近期情绪核心参与不一致");
  if (volumeWeak) summaryParts.push("量能缩减");
  else if (volumeStrong) summaryParts.push("量能放大");
  else summaryParts.push("量能未明显放大");
  if (!breakoutStrong) summaryParts.push("关键锚点尚未形成突破扩散");

  const stockNames = (items, predicate = () => true, limit = 5) => items
    .filter((item) => item && predicate(item))
    .slice(0, limit)
    .map((item) => item.name || item.code)
    .filter(Boolean);
  const anchorNames = stockNames(anchorItems);
  const carrierNames = stockNames(carrierItems);
  const recentStrongNames = stockNames(
    recentItems,
    (item) => item.todayAvailable !== false && Number.isFinite(Number(item.changePct)) && Number(item.changePct) >= 3,
  );
  const recentWeakNames = stockNames(
    recentItems,
    (item) => item.todayAvailable !== false && Number.isFinite(Number(item.changePct)) && Number(item.changePct) <= 0,
  );
  const oversoldNames = stockNames(oversoldItems);
  const oldCoreLeaderNames = stockNames(oldCoreLeaderItems);
  const oldCoreFollowerNames = stockNames(oldCoreFollowerItems);
  const oldCoreStrongNames = stockNames(oldCoreStrongItems);
  const oldCoreWeakNames = stockNames(oldCoreWeakItems);
  const namesText = (names, fallback) => names.length ? names.join("、") : fallback;
  const stockMoveText = (items, fallback = "暂无明确标的", limit = 5) => {
    const rows = (Array.isArray(items) ? items : []).filter(Boolean).slice(0, limit);
    if (!rows.length) return fallback;
    return rows.map((item) => {
      const change = Number(item.changePct);
      return `${item.name || item.code}${Number.isFinite(change) ? `${change > 0 ? "+" : ""}${change.toFixed(2)}%` : ""}`;
    }).join("、");
  };
  const oldCoreDriverSummary = oldCoreLed
    ? `${stockMoveText(oldCoreLeaderItems)}率先发动，${stockMoveText(oldCoreFollowerItems)}跟随，确认老核心在带节奏`
    : oldCoreLeaderItems.length
      ? `${stockMoveText(oldCoreLeaderItems)}率先走强，但没有第二批老核心跟随，暂不能称主导`
      : oldCoreStrongItems.length
        ? `${stockMoveText(oldCoreStrongItems)}出现反弹，但主动性不足，暂不能称带节奏`
        : `老核心没有明确领涨${oldCoreWeakItems.length ? `，${stockMoveText(oldCoreWeakItems)}仍在掉队` : ""}`;
  const positionLimit = light === "green" ? "先开计划仓位1/3，确认加强后再加" : light === "red" ? "0%，禁止新开仓" : "最多计划仓位1/3试错";
  const onlyList = light === "red"
    ? ["只处理持仓风险，等待市场组共同止跌"]
    : [
      `只从主动进攻核心中选交易载体：${namesText(carrierNames, "当前没有通过主动性与结构门槛的龙头")}`,
      `情绪锚点只负责确认负反馈是否解除：${namesText(anchorNames, "等待情绪锚点出现")}`,
    ];
  const avoidList = [
    `不追超跌/老核心的单独反弹：${namesText(oversoldNames, "当前暂无明确样本")}`,
    "不做无主动性、无带动性的被动中军和后排跟风；结构好但位置过热也只等回踩",
  ];
  const buyGate = {
    light,
    lightLabel,
    quality,
    positionLimit,
    base: nextDayBase,
    only: onlyList,
    avoid: light === "red" ? ["不新开任何仓位", ...avoidList] : avoidList,
    timeline: [
      {
        time: "9:25",
        title: "只观察，不下单",
        text: "先看容量锚点、近期情绪核心是否明显低于预期；单票独强不算市场确认。",
      },
      {
        time: "9:30—9:35",
        title: light === "red" ? "红灯不触发买点" : `首次可交易信号：${positionLimit}`,
        text: "先验证主动龙头没有转为被动、板块跟随仍在扩散；只有结构完整的主动型容量/趋势龙头才允许个股买点生效。",
      },
      {
        time: "9:40—10:00",
        title: light === "green" ? "确认加强后才加仓" : "只有升级绿灯才允许加仓",
        text: "板块上涨家数扩散、核心不破承接低点且量价同步；否则保持试仓或空仓。",
      },
      {
        time: "10:50",
        title: "只复核矛盾盘面",
        text: "若早盘仍是分歧、没有资金修复，取消当日回流博弈，把观察节点后移。",
      },
    ],
    invalidation: "主动龙头丢失带动性、关键结构破位、板块只剩单票，或跌停/炸板重新扩散时，个股信号全部失效。",
  };
  const review = {
    title: "今日复盘总结",
    oneLine: `${lightLabel} · ${quality} · ${structureType}`,
    facts: [
      {
        label: "指数与情绪",
        text: `指数均值${avgIndexChange > 0 ? "+" : ""}${avgIndexChange.toFixed(2)}%，上涨占比${breadthPct}%；${Number.isFinite(ztToday) ? `涨停${ztPrev}→${ztToday}、跌停${dtPrev}→${dtToday}` : "涨跌停数据不足"}。`,
      },
      {
        label: "资金去向",
        text: `超跌修复看${stockMoveText(oversoldItems)}；主动交易载体看${namesText(carrierNames, "暂无通过硬门槛的龙头")}。`,
      },
      {
        label: "老核心节奏",
        text: `${oldCoreDriverSummary}${oldCoreWeakNames.length ? `；转弱/掉队：${oldCoreWeakNames.join("、")}` : ""}。`,
      },
      {
        label: "核心参与",
        text: `${recentStrongNames.length ? `${recentStrongNames.join("、")}参与较强` : "近期情绪核心暂无一致转强"}${recentWeakNames.length ? `；${recentWeakNames.join("、")}仍偏弱` : ""}。`,
      },
      {
        label: "修复缺陷",
        text: `${Number.isFinite(currentAmountYi) ? `两市成交${Math.round(currentAmountYi)}亿、环比${pctText(volumeDeltaPct)}` : "成交额缺失"}；容量锚点新高${anchorStats.newHighCount}只、接近前高${anchorStats.nearHighCount}只，${breakoutStrong ? "突破已有扩散" : "仍按区间修复看待"}。`,
      },
      {
        label: "最终定性",
        text: `${quality}，结构为${structureType}；明日基础预期是${nextDayBase}。`,
      },
    ],
    tomorrow: buyGate,
  };

  return {
    version: 1,
    observationOnly: true,
    asOf: snapshot.asOf || payload.fetchedAt || payload.updatedAt || null,
    tradingDate: today,
    cycle: state.cycle || "未知",
    light,
    lightLabel,
    score,
    quality,
    structureType,
    summary: `${summaryParts.join("；")}。`,
    structureEvidence: {
      oversold: {
        label: "超跌修复标的",
        status: oversoldDominant ? "leading" : oversoldItems.length ? "present" : "absent",
        summary: oversoldItems.length
          ? `${stockMoveText(oversoldItems)}；每只均列出近10/20日跌幅或距阶段高点位置`
          : "当前没有同时满足“前期跌幅明显 + 今日走强”的标的",
        items: oversoldItems.slice(0, 5),
      },
      oldCore: {
        label: "老核心带动验证",
        status: oldCoreLed ? "leading" : oldCoreLeaderItems.length ? "partial" : "not-leading",
        summary: oldCoreDriverSummary,
        items: oldCoreItems.slice(0, 6).map((item) => ({
          ...item,
          driverState: oldCoreLeaderCodes.has(item.code)
            ? "率先发动"
            : Number(item.changePct) >= 2
              ? "跟随/修复"
              : Number(item.changePct) > 0
                ? "小幅修复"
              : Number(item.changePct) <= 0
                ? "掉队"
                : "待确认",
        })),
      },
    },
    nextDayBase,
    action,
    review,
    metrics: [
      {
        key: "index",
        label: "指数与广度",
        status: indexRepairStrong ? "pass" : hardRed ? "fail" : "warn",
        value: `指数均值${avgIndexChange > 0 ? "+" : ""}${avgIndexChange.toFixed(2)}% · 上涨占比${breadthPct}%`,
        note: indexRepairStrong ? "修复成立" : "尚未共同确认",
      },
      {
        key: "limits",
        label: "涨跌停修复",
        status: limitRepair === true ? "pass" : limitRepair === false ? "fail" : "warn",
        value: Number.isFinite(ztToday) ? `涨停${ztPrev}→${ztToday} · 跌停${dtPrev}→${dtToday}` : "数据不足",
        note: limitRepair === true ? "负反馈明显收敛" : limitRepair === false ? "负反馈未收敛" : "等待数据",
      },
      {
        key: "recent-core",
        label: "近期核心参与",
        status: recentStrong ? "pass" : recentWeak ? "fail" : "warn",
        value: recentStats.avgChangePct === null ? "暂无样本" : `均涨${recentStats.avgChangePct > 0 ? "+" : ""}${recentStats.avgChangePct.toFixed(2)}% · ${recentStats.strongRate}%涨超3%`,
        note: recentStrong ? "核心形成一致性" : recentWeak ? "核心明显掉队" : "内部仍有分化",
      },
      {
        key: "active-leaders",
        label: "主动龙头资格",
        status: carrierStrong ? "pass" : "warn",
        value: carrierItems.length ? `通过硬门槛${carrierItems.length}只 · 主攻${carrierItems.filter((item) => item.tradeState === "主攻候选").length}只` : "暂无合格交易载体",
        note: carrierStrong ? "主动性与结构同时成立" : "情绪回暖不等于已有可交易龙头",
      },
      {
        key: "volume",
        label: "增量资金",
        status: volumeStrong ? "pass" : volumeWeak ? "fail" : "warn",
        value: Number.isFinite(currentAmountYi) ? `两市${Math.round(currentAmountYi)}亿 · 环比${pctText(volumeDeltaPct)}` : "成交额缺失",
        note: volumeStrong ? "增量确认" : volumeWeak ? "缩量修复" : "量能中性",
      },
      {
        key: "breakout",
        label: "突破与新高",
        status: breakoutStrong ? "pass" : "warn",
        value: `容量锚点新高${anchorStats.newHighCount}只 · 接近前高${anchorStats.nearHighCount}只`,
        note: breakoutStrong ? "高度空间打开" : "仍以区间修复看待",
      },
    ],
    groups: [
      {
        key: "anchors",
        title: "情绪与容量锚点",
        subtitle: "只判断负反馈与市场温度，不自动获得买入资格",
        status: anchorStrong ? "strong" : "mixed",
        summary: anchorStats.avgChangePct === null ? "暂无样本" : `平均${anchorStats.avgChangePct > 0 ? "+" : ""}${anchorStats.avgChangePct.toFixed(2)}% · 合计成交${anchorStats.amountYi}亿`,
        items: anchorItems,
      },
      {
        key: "carriers",
        title: "主动进攻核心 · 交易载体",
        subtitle: "主动性第一；同时通过核心地位、框架、筹码与位置门槛",
        status: carrierStrong ? "strong" : "mixed",
        summary: carrierItems.length ? `${carrierItems.length}只通过硬门槛 · ${carrierItems.filter((item) => item.tradeState === "等回踩").length}只只等回踩` : "宁缺毋滥，当前无合格龙头",
        items: carrierItems,
      },
      {
        key: "recent",
        title: "近期情绪核心",
        subtitle: "近1—3个交易日动态识别",
        status: recentStrong ? "strong" : recentWeak ? "weak" : "mixed",
        summary: recentStats.avgChangePct === null ? "暂无样本" : `平均${recentStats.avgChangePct > 0 ? "+" : ""}${recentStats.avgChangePct.toFixed(2)}% · 上涨占比${recentStats.positiveRate}%`,
        items: recentItems,
      },
      {
        key: "old-core",
        title: "老核心带动验证",
        subtitle: "必须有老核心率先发动，并出现其他老核心跟随，才可写“主导”",
        status: oldCoreLed ? "strong" : oldCoreWeakItems.length >= oldCoreFollowerItems.length ? "weak" : "mixed",
        summary: oldCoreDriverSummary,
        items: oldCoreItems.map((item) => ({
          ...item,
          driverState: oldCoreLeaderCodes.has(item.code)
            ? "率先发动"
            : Number(item.changePct) >= 2
              ? "跟随/修复"
              : Number(item.changePct) > 0
                ? "小幅修复"
              : Number(item.changePct) <= 0
                ? "掉队"
                : "待确认",
        })),
      },
      {
        key: "oversold",
        title: "超跌修复标的",
        subtitle: "明确列出前期跌幅依据；可与老核心身份重叠，但不再混写",
        status: oversoldDominant ? "strong" : "mixed",
        summary: oversoldStats.avgChangePct === null ? "暂无明显样本" : `平均${oversoldStats.avgChangePct > 0 ? "+" : ""}${oversoldStats.avgChangePct.toFixed(2)}% · ${oversoldStats.limitRate}%接近涨停`,
        items: oversoldItems,
      },
    ],
    validation: {
      upgrade: [
        "主动龙头率先发动，容量承接与板块扩散同步出现",
        "板块成交放大，不再只是少数超跌票上涨",
        "出现有效突破或新高扩散，再由黄灯升级绿灯",
      ],
      hold: [
        "老核心继续反弹，但近期核心仍分化",
        "指数上涨而量能不放大，维持黄灯和1/3试错",
      ],
      downgrade: [
        "主动龙头失去带动性、放量破坏关键结构或重新变成被动跟随",
        "指数短线强势或中期修复结构失效、跌停重新增加，转红并取消买点",
      ],
    },
    evidence: {
      currentAmountYi: Number.isFinite(currentAmountYi) ? currentAmountYi : null,
      previousAmountYi: Number.isFinite(previousAmountYi) ? previousAmountYi : null,
      volumeDeltaPct,
      breadthPct,
      avgIndexChange,
      limitRepair,
      recentStrong,
      anchorStrong,
      carrierStrong,
      oversoldDominant,
      oldCoreLed,
      breakoutStrong,
    },
  };
}

function classifyChaosDivergence(marketState, limitStats, snapshot, candidates) {
  if (!marketState || marketState.cycle !== "混沌") {
    return { active: false, level: "非混沌期", score: 0, evidence: [], blockTomorrowReflow: false };
  }

  const optionalFinite = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const dailyState = marketState.dailyState && typeof marketState.dailyState === "object"
    ? marketState.dailyState
    : null;
  const dailyKey = String(dailyState && dailyState.key || "");
  const dailyReasons = Array.isArray(dailyState && dailyState.reasons)
    ? dailyState.reasons.filter(Boolean)
    : [];
  if (dailyKey === "healthy_divergence") {
    return {
      active: true,
      level: "健康分化",
      score: 1,
      evidence: dailyReasons.length ? dailyReasons : [dailyState.summary || "强势批次兑现，但负反馈没有扩散"],
      blockTomorrowReflow: false,
      checkpoint: "开盘后持续验证",
      scope: "仅混沌期",
      dailyStateKey: dailyKey,
    };
  }
  if (dailyKey === "retreat_candidate") {
    return {
      active: true,
      level: "大分歧·退潮候选",
      score: 5,
      evidence: dailyReasons.length ? dailyReasons : [dailyState.summary || "赚钱效应坍缩且负反馈扩散"],
      blockTomorrowReflow: true,
      checkpoint: "10:50",
      scope: "仅混沌期",
      dailyStateKey: dailyKey,
    };
  }
  if (dailyKey === "data_insufficient") {
    return {
      active: true,
      level: "数据不足",
      score: 0,
      evidence: dailyReasons.length ? dailyReasons : ["跨交易日数据不足，不预设大分歧延续"],
      blockTomorrowReflow: false,
      checkpoint: "等待完整数据",
      scope: "仅混沌期",
      dailyStateKey: dailyKey,
    };
  }

  const evidence = [];
  let score = 0;
  let negativeFeedbackExpanded = false;
  let profitCollapsed = false;
  const dtToday = optionalFinite(limitStats && limitStats.dtToday);
  const dtPrev = optionalFinite(limitStats && limitStats.dtPrev);
  const ztToday = optionalFinite(limitStats && limitStats.ztToday);
  const ztPrev = optionalFinite(limitStats && limitStats.ztPrev);
  const avgIndexChange = optionalFinite(snapshot && snapshot.avgIndexChange);
  const breadth = optionalFinite(snapshot && snapshot.breadth);
  const highBoard = highBoardFeedback(candidates);

  if (dtToday !== null && dtPrev !== null) {
    if (dtToday >= 15 && dtToday > dtPrev) {
      score += 2;
      negativeFeedbackExpanded = true;
      evidence.push(`跌停${dtPrev}→${dtToday}，亏钱效应明显扩散`);
    } else if (dtToday >= 8 && dtToday >= dtPrev + 3) {
      score += 1;
      negativeFeedbackExpanded = true;
      evidence.push(`跌停${dtPrev}→${dtToday}，负反馈有所扩大`);
    } else if (dtToday < dtPrev) {
      score -= 1;
      evidence.push(`跌停${dtPrev}→${dtToday}，负反馈正在收缩`);
    }
  } else if (dtToday !== null && dtToday >= 15) {
    score += 1;
    evidence.push(`跌停${dtToday}只，但缺上一交易日对比，暂不确认是否扩散`);
  }

  if (ztPrev !== null && ztPrev > 0 && ztToday !== null) {
    const ratio = ztToday / ztPrev;
    if (ratio <= 0.65) {
      score += 2;
      profitCollapsed = true;
      evidence.push(`涨停${ztPrev}→${ztToday}，骤降${Math.round((1 - ratio) * 100)}%`);
    } else if (ratio < 0.8) {
      score += 1;
      evidence.push(`涨停${ztPrev}→${ztToday}，明显缩减`);
    }
  }

  if (avgIndexChange !== null) {
    if (avgIndexChange <= -2) {
      score += 2;
      evidence.push(`主要指数均值${avgIndexChange.toFixed(2)}%`);
    } else if (avgIndexChange <= -1) {
      score += 1;
      evidence.push(`主要指数均值${avgIndexChange.toFixed(2)}%`);
    }
  }

  if (breadth !== null) {
    if (breadth <= 0.3) {
      score += 2;
      evidence.push(`上涨占比仅${Math.round(breadth * 100)}%`);
    } else if (breadth <= 0.42) {
      score += 1;
      evidence.push(`上涨占比${Math.round(breadth * 100)}%，市场广度偏弱`);
    }
  }

  if (highBoard && Number.isFinite(Number(highBoard.hitRatio))) {
    const hitRatio = Number(highBoard.hitRatio);
    if (hitRatio >= 50) {
      score += 2;
      negativeFeedbackExpanded = true;
      evidence.push(`高标重挫占比${hitRatio}%`);
    } else if (hitRatio >= 30) {
      score += 1;
      evidence.push(`高标重挫占比${hitRatio}%`);
    }
  }

  score = Math.max(0, score);
  const level = dailyKey === "mixed_divergence"
    ? "普通分化"
    : score >= 4
      ? "大分歧"
      : score >= 2
        ? "中分歧"
        : score >= 1
          ? "小分歧"
          : "无明显分歧";
  // 新口径已有今日状态时，只有“退潮候选”才能阻断次日回流。
  // 旧缓存没有 dailyState 时也必须同时出现赚钱效应坍缩和负反馈扩散，
  // 不能再由指数走弱或涨停回落单独触发“大分歧延续”。
  const blockTomorrowReflow = dailyKey
    ? dailyKey === "retreat_candidate"
    : level === "大分歧" && negativeFeedbackExpanded && profitCollapsed;
  return {
    active: true,
    level,
    score,
    evidence: evidence.length ? evidence : ["当日未捕捉到明显分歧证据"],
    blockTomorrowReflow,
    checkpoint: "10:50",
    scope: "仅混沌期",
    dailyStateKey: dailyKey || null,
  };
}

function buildTomorrowOutlook(candidates, marketState, limitStats, snapshot, survivorBoard) {















  // 本地日期(toISOString 是 UTC,北京时间早上8点前会把"今天"算成昨天,归档就找不到了)















  const now = new Date();















  const pad = (n) => String(n).padStart(2, "0");















  const localToday = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const payloadTradingDate = normalizeCycleYmd(limitStats && limitStats.dates && limitStats.dates.today);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(payloadTradingDate) ? payloadTradingDate : localToday;















  const hbToday = highBoardFeedback(candidates);

  const chaosDivergence = classifyChaosDivergence(marketState, limitStats, snapshot, candidates);

  const shockTransition = marketState && marketState.shockTransition && marketState.shockTransition.active
    ? marketState.shockTransition
    : null;















  const tradingDates = limitStats && limitStats.dates && typeof limitStats.dates === "object"
    ? limitStats.dates
    : null;
  const expectedPrevDate = tradingDates && tradingDates.verified === true
    ? normalizeCycleYmd(tradingDates.prev)
    : "";
  // 明日预期只能使用经过行情源验证的真正T-1收盘归档。
  // 缺7月21日时宁可显示“无法对比”，也不能拿7月17日冒充昨天。
  const prev = expectedPrevDate
    ? loadPrevArchive(today, { expectedDate: expectedPrevDate, requireExact: true })
    : null;















  const prevPayload = prev ? prev.payload : null;















  const prevLimit = prevPayload && prevPayload.market ? prevPayload.market.limitStats : null;















  const prevSnapshot = prevPayload && prevPayload.market ? prevPayload.market.snapshot : null;















  const hbPrev = prevPayload ? highBoardFeedback(prevPayload.candidates) : null;































  // 今日是否处于分歧环境(不是分歧日就不硬套情景)















  const outlookDailyState = marketState && marketState.dailyState && typeof marketState.dailyState === "object"
    ? marketState.dailyState
    : null;
  const outlookDailyKey = String(outlookDailyState && outlookDailyState.key || "");
  const legacyInDivergence =















    marketState.cycle === "退潮" ||















    marketState.cycle === "冰点" ||















    marketState.subPhase === "高位分歧" ||















    Boolean(limitStats && limitStats.ztPrev && limitStats.ztToday < limitStats.ztPrev * 0.8) ||















    Boolean(limitStats && Number(limitStats.dtToday) >= 15);
  const inDivergence = outlookDailyKey
    ? ["healthy_divergence", "mixed_divergence", "retreat_candidate", "ice_point"].includes(outlookDailyKey)
    : legacyInDivergence;































  // 交易日防护:非交易时段抓取时,"今日"数据和昨日归档可能同属一个交易日——















  // 自己和自己比(45→45、成交额100%)是假信号,必须识别并标"无法对比"















  const dataDay = limitStats && limitStats.dates ? limitStats.dates.today : null;















  const prevDataDay = prevLimit && prevLimit.dates ? prevLimit.dates.today : null;















  const sameTradingDay = Boolean(dataDay && prevDataDay && dataDay === prevDataDay);
  const directPrevDt = expectedPrevDate && limitStats && limitStats.dtPrev !== null && limitStats.dtPrev !== undefined && limitStats.dtPrev !== ""
    ? Number(limitStats.dtPrev)
    : null;















  const sameDayNote = "昨日归档与当前数据同属一个交易日(非交易时段抓取),跨日对比无意义——开盘后重新抓取";































  // 四个分歧衰减信号(每个都给出事实依据;数据缺失=null,明示不猜)















  const signals = [];















  const push = (name, ok, note) => signals.push({ name, ok, note });































  if (sameTradingDay) {















    push("跌停缩减", null, sameDayNote);















  } else if (limitStats && Number.isFinite(directPrevDt)) {














    push("跌停缩减", Number(limitStats.dtToday) < directPrevDt, `跌停 ${directPrevDt} → ${limitStats.dtToday}（${expectedPrevDate}→${normalizeCycleYmd(dataDay || today)}）`);














  } else if (limitStats && prevLimit && Number.isFinite(Number(prevLimit.dtToday))) {















    push("跌停缩减", Number(limitStats.dtToday) < Number(prevLimit.dtToday), `跌停 ${prevLimit.dtToday} → ${limitStats.dtToday}`);















  } else {















    push("跌停缩减", null, limitStats ? "缺昨日归档,无法对比(收盘后记得点归档)" : "涨跌停数据缺失");















  }































  // 口径说明:高标池=当日热榜候选内连板≥2的票。被核按钮后掉出热榜的高标统计不到,















  // 负反馈可能被低估——该信号偏乐观时要人工看一眼昨日涨停池今日表现















  if (sameTradingDay) {















    push("高标负反馈减弱", null, sameDayNote);















  } else if (hbToday.hitRatio != null && hbPrev && hbPrev.hitRatio != null) {















    push(















      "高标负反馈减弱",















      hbToday.hitRatio < hbPrev.hitRatio,















      `高标重挫占比 ${hbPrev.hitRatio}% → ${hbToday.hitRatio}%(今日高标${hbToday.total}只,重挫${hbToday.hitCount}只${hbToday.nukedCount ? "、核按钮级" + hbToday.nukedCount + "只" : ""};口径:热榜内连板≥2,掉榜高标不计)`,















    );















  } else if (hbToday.hitRatio != null) {















    push("高标负反馈减弱", null, `今日高标重挫占比 ${hbToday.hitRatio}%,缺昨日归档无法比衰减`);















  } else {















    push("高标负反馈减弱", null, "今日候选池无连板≥2高标样本,负反馈无法量化");















  }































  const seizeCount = survivorBoard ? survivorBoard.items.filter((item) => item.limitUp).length : 0;















  push("有票抢先手", seizeCount > 0, seizeCount > 0 ? `${seizeCount}只活口逆势真涨停(见活口观察)` : "今日无活口涨停,先手迹象弱");































  if (sameTradingDay) {















    push("承接还在", null, sameDayNote);















  } else if (snapshot && prevSnapshot && Number(prevSnapshot.shszAmountYi) > 0) {















    const ratio = Number(snapshot.shszAmountYi) / Number(prevSnapshot.shszAmountYi);















    push("承接还在", ratio >= 0.85, `两市成交 ${prevSnapshot.shszAmountYi} → ${snapshot.shszAmountYi} 亿(${Math.round(ratio * 100)}%)`);















  } else {















    push("承接还在", null, "缺昨日成交额对比");















  }































  const okCount = signals.filter((s) => s.ok === true).length;















  const knownCount = signals.filter((s) => s.ok !== null).length;































  let bias, biasNote;















  if (outlookDailyKey === "healthy_divergence") {

    bias = "均衡";

    biasNote = `今日是健康分化：${outlookDailyState.summary || "强势批次兑现，但负反馈未扩散"} 明日不预设退潮或分歧延续，先验证赚钱方向承接能否加强。`;

  } else if (outlookDailyKey === "data_insufficient") {

    bias = "均衡";

    biasNote = "关键跨交易日数据不足，不生成方向性主预期；等待新快照与真正上一交易日收盘数据。";

  } else if (chaosDivergence.blockTomorrowReflow) {

    bias = "偏延续";

    biasNote = shockTransition
      ? `基础周期${shockTransition.baseCycle}，当日${shockTransition.damageLevel}（${chaosDivergence.evidence.join("；")}）——明日默认分歧延续，10:50前不提前博弈回流，收盘后再确认纠偏或退潮`
      : `混沌期大分歧（${chaosDivergence.evidence.join("；")}）——明日默认分歧延续，10:50前不提前博弈回流`;

  } else if (!inDivergence) {















    bias = "常规";















    biasNote = "今日非明显分歧日,按周期常规节奏执行,无需情景切换";















  } else if (knownCount <= 1) {















    // 可对比数据不足(通常是缺昨日归档),不硬下倾向结论——数据不够就说数据不够















    bias = "均衡";















    biasNote = `可判定信号仅 ${knownCount}/4(其余数据缺失),倾向无法可靠判定——明日以竞价和高标开盘表现实时定`;















  } else if (okCount >= 3) {















    bias = "偏回流";















    biasNote = `分歧衰减信号 ${okCount}/${knownCount} 成立——杀跌接近充分,明日回流概率占优`;















  } else if (okCount <= 1) {















    bias = "偏延续";















    biasNote = `分歧衰减信号仅 ${okCount}/${knownCount} 成立——负反馈未消化,明日二次分歧概率偏大`;















  } else {















    bias = "均衡";















    biasNote = `衰减信号 ${okCount}/${knownCount},五五开——明日方向由竞价和高标开盘表现决定`;















  }































  // 昨日是否已在分歧(用于"二次分歧→第三日冰点"链条)















  const prevWasDivergent = Boolean(















    prevLimit && (Number(prevLimit.dtToday) >= 15 || (prevLimit.ztPrev && prevLimit.ztToday < prevLimit.ztPrev * 0.8)),















  );































  const scenarios = outlookDailyKey === "healthy_divergence"
    ? [
        {
          name: "情景A · 分化后承接加强",
          verify: [
            "跌停与大跌家数不再扩散，昨日兑现方向没有继续批量核按钮",
            "主动核心、容量中军和活口率先走强，并能带动板块内赚钱效应扩散",
            "成交承接不塌缩，指数反弹与短线情绪至少形成一项共振",
          ],
          action: "只在市场门槛通过后，观察主动核心与活口的承接机会；先验证再执行，不因指数单独反弹追高。",
        },
        {
          name: "情景B · 兑现扩大为负反馈",
          verify: [
            "跌停、大跌或核心负反馈重新扩散",
            "赚钱方向只有脉冲，主动核心与容量中军无法持续带动",
            "成交明显缩减，昨日修复批次继续补跌",
          ],
          action: "买点前置条件失效，取消新开仓；待收盘重新判断是否升级为退潮候选，不在盘中凭K线形态直接定性。",
        },
      ]
    : chaosDivergence.blockTomorrowReflow
    ? [
        {
          name: "情景A · 大分歧延续（主预期）",
          verify: [
            "从开盘累计观察到10:50，不用单一时点替代整个早盘",
            "跌停/大跌数、高标负反馈是否继续扩大",
            "主线核心是否只有瞬间反抽、没有持续修复",
          ],
          action: "10:50前不执行回流计划，只跟踪收盘后选定的主线核心。",
        },
        {
          name: "情景B · 10:50修复确认",
          verify: ["负反馈明显收敛", "主线核心持续回流而不是脉冲", "指数与情绪至少一项不再创新低"],
          action: "只将原预案升级为「可评估执行」，不临时新选股、不追第一段反抽；周期是否纠偏仍等收盘确认。",
        },
        {
          name: "情景C · 修复未出现",
          verify: ["分歧加大或与早盘相当", "主线核心没有资金持续回流", "跌停/大跌数没有收敛"],
          action: "取消当日回流执行；若收盘仍无修复则正式确认退潮，最早博弈修复的评估窗口后移一个交易日。",
        },
      ]
    : inDivergence
      ? [
        {
          name: "\u60c5\u666fA \u00b7 \u56de\u6d41",
          verify: [
            "\u7ade\u4ef7:\u9ad8\u6807/\u6d3b\u53e3\u7ea2\u76d8\u9ad8\u5f00,\u65e0\u5927\u9762\u79ef\u4f4e\u5f00\u6838\u6309\u94ae",
            "\u8dcc\u505c\u8f83\u4eca\u65e5\u8fdb\u4e00\u6b65\u7f29\u51cf,\u6da8\u505c\u6570\u6b62\u6b65\u56de\u5347",
            "\u6307\u6570\u5206\u65f6\u56de\u6d41\u4f1e\u7a33(\u627f\u63a5\u91cf\u5728,\u4e0d\u521b\u65b0\u4f4e)",
          ],
          action:
            "\u6307\u6570\u56de\u6d41+\u60c5\u7eea\u56de\u6d41=\u53cc\u5171\u632f\u4e70\u70b9\u3002\u53ea\u4ece\u3010\u6d3b\u53e3\u3001\u524d\u671f\u8fa8\u8bc6\u5ea6\u6838\u5fc3\u3001\u8001\u9f99\u5934\u3011\u91cc\u9009(\u4f4e\u4f4d\u65b0\u7968\u4e00\u822c\u5c31\u5728\u6d3b\u53e3\u91cc),\u7ed5\u5f00\u540e\u6392\u6742\u6bdb;\u9996\u4ed3\u5c0f,\u786e\u8ba4\u518d\u52a0",
        },
        {
          name: "\u60c5\u666fB \u00b7 \u5206\u6b67\u5ef6\u7eed(\u4e8c\u6b21\u5206\u6b67)",
          verify: ["\u9ad8\u6807\u7ee7\u7eed\u6838\u6309\u94ae/\u8dcc\u505c\u653e\u5927", "\u6d3b\u53e3\u88ab\u8865\u8dcc,\u62a2\u5148\u624b\u5931\u8d25", "\u6210\u4ea4\u989d\u660e\u663e\u7f29\u51cf,\u627f\u63a5\u6d88\u5931"],
          action:
            "\u4e0d\u63a5\u76d8\u4e2d\u53cd\u5f39,\u5f53\u65e5\u4e0d\u52a8\u2014\u2014\u4e70\u70b9\u524d\u7f6e:\u4e8c\u6b21\u5206\u6b67\u540e\u7b2c\u4e09\u65e5\u5f80\u5f80\u662f\u51b0\u70b9\u65e5,\u5c45\u65f6\u535a\u5f00\u6d3b\u53e3\u6216\u76d8\u4e2d\u7387\u5148\u6da8\u505c\u7684\u7968;\u4eca\u665a\u628a\u5019\u9009\u6d3b\u53e3\u5199\u8fdb\u9884\u6848",
        },
      ]
    : [
        {
          name: "\u60c5\u666fA \u00b7 \u5ef6\u7eed\u5f53\u524d\u8282\u594f",
          verify: ["\u6da8\u505c\u6570\u6301\u7a33\u6216\u56de\u5347,\u8dcc\u505c\u4e0d\u653e\u5927", "\u4e3b\u7ebf\u65b9\u5411\u7ee7\u7eed\u6709\u6da8\u505c\u68b5\u961f"],
          action: "\u6309\u5f53\u524d\u5468\u671f\u4ed3\u4f4d\u4e0e\u6700\u4f18\u89e3\u6267\u884c,\u4e0d\u56e0\u5355\u65e5\u6ce2\u52a8\u5207\u6362\u6a21\u5f0f",
        },
      ];

  return {















    date: today,















    inDivergence: inDivergence || chaosDivergence.blockTomorrowReflow,

    divergenceLevel: chaosDivergence.active ? chaosDivergence.level : null,

    chaosDivergence,

    shockTransition,















    bias,















    biasNote,















    signals,















    scenarios,















    prevArchiveDate: prev ? prev.date : null,















    keyLine: outlookDailyKey === "healthy_divergence"
      ? "健康分化不是退潮：明日先验证赚钱方向承接与负反馈是否继续收缩，再区分加强还是转弱"
      : chaosDivergence.blockTomorrowReflow
      ? shockTransition
        ? "基础周期保留混沌；当日按退潮级防守。次日10:50只验证不执行，收盘后确认纠偏或退潮"
        : "仅混沌期：大分歧次日默认延续，10:50前只验证不执行；无修复则评估窗口后移一个交易日"
      : "分歧天数不按日历数,按高标负反馈算:负反馈减弱=分歧在减弱;等指数回流日=情绪回流双共振买点",















  };















}































// ===== 周期细分：每个大周期细分初/中/末期，不同阶段不同策略 =====

function classifyDetailedPhase(cycle, marketState, hotConcepts, limitStats, yesterdaySnapshot) {
  const zt = (limitStats && limitStats.ztToday) || 0;
  const ztPrev = (limitStats && limitStats.ztPrev) || 0;
  const zbRate = (limitStats && limitStats.ztHistory > 0) ? (limitStats.ztHistory - zt) / limitStats.ztHistory : 0;
  const dt = (limitStats && limitStats.dtToday) || 0;
  const marketScore = (marketState && marketState.marketScore) || 0;
  const breadth = (marketState && marketState.breadth) || 0;
  const index = (marketState && marketState.index) || 0;
  const dailyState = marketState && marketState.dailyState ? marketState.dailyState : null;
  const dailyKey = dailyState ? String(dailyState.key || "") : "";
  const profitScore = Number(marketState && marketState.profitEffect && marketState.profitEffect.score);
  const lossScore = Number(marketState && marketState.lossEffect && marketState.lossEffect.score);
  const lossTrend = String(marketState && marketState.lossEffect && marketState.lossEffect.trend || "unknown");

  const topConcept = (Array.isArray(hotConcepts) && hotConcepts.length > 0) ? hotConcepts[0] : null;
  const topLimit = topConcept ? (topConcept.limitCount || 0) : 0;
  const topResonance = topConcept ? (topConcept.resonance || false) : false;

  if (cycle === "混沌") {
    if (dailyKey === "repair_strengthening") {
      return { detailedPhase: "混沌末期", reasons: ["修复正在加强，主线和扩散继续确认后才升级主升"] };
    }
    if (["healthy_divergence", "mixed_divergence"].includes(dailyKey)) {
      return { detailedPhase: "混沌中期", reasons: ["赚钱效应仍在但资金分化兑现，按轮动/回流阶段处理"] };
    }
    if (zt < 45 && topLimit < 4) {
      return { detailedPhase: "混沌初期", reasons: ["涨停数<45，方向试错阶段，主线未明"] };
    }
    if (topLimit >= 5 && topResonance && marketScore >= 62) {
      return { detailedPhase: "混沌末期", reasons: ["主线雏形显现，等待扩散确认"] };
    }
    return { detailedPhase: "混沌中期", reasons: ["方向轮动或回流阶段"] };
  }

  if (cycle === "主升") {
    if (zt < 65 && zbRate < 0.1) {
      return { detailedPhase: "主升初期", reasons: ["主升刚启动，情绪稳定上行"] };
    }
    if (zt > 80 || (zbRate >= 0.15 && zbRate < 0.25)) {
      return { detailedPhase: "主升末期", reasons: ["涨停高位或炸板率抬头，警惕分歧"] };
    }
    return { detailedPhase: "主升中期", reasons: ["主升延续，结构稳定"] };
  }

  if (cycle === "震荡") {
    return { detailedPhase: "震荡期", reasons: ["横盘整理，方向未明"] };
  }

  if (cycle === "退潮") {
    if (dailyKey === "retreat_candidate" && lossTrend === "worsening") {
      return { detailedPhase: "退潮初期", reasons: ["赚钱效应坍缩且负反馈刚开始扩散"] };
    }
    if (dailyKey === "ice_point" || lossTrend === "improving") {
      return { detailedPhase: "退潮末期", reasons: ["亏钱效应由扩散转为收缩，开始等待冰点修复"] };
    }
    if (Number.isFinite(lossScore) && lossScore >= 70) {
      return { detailedPhase: "退潮中期", reasons: [`亏钱效应${lossScore}分，仍处于高位`] };
    }
    return { detailedPhase: "退潮初期", reasons: ["退潮已经确认，但负反馈强度仍待连续验证"] };
  }

  if (cycle === "冰点") {
    return { detailedPhase: "冰点", reasons: ["底部冰点，等待修复信号"] };
  }

  return { detailedPhase: cycle, reasons: [] };
}

// ===== 选股策略矩阵：不同周期阶段对应不同的池权重和加分规则 =====

const SELECTION_STRATEGY = {
  "混沌初期": {
    focus: "低位试错",
    pools: { reflow: 0.2, todayStrong: 0.2, mainLine: 0.1, lowPosition: 0.4, survivor: 0.1 },
    roleBonus: { 龙头: 8, 中军: 10, 补涨: 12, 后排: 5 },
    setupBonus: { 首板: 15, 二板: 12, 低位: 10, 回流: 8, 核心观察: 5 },
    note: "混沌初期：底部试错，优先低位+首二板，不追高连板"
  },

  "混沌中期": {
    focus: "回流预期",
    pools: { reflow: 0.35, todayStrong: 0.2, mainLine: 0.3, lowPosition: 0.05, survivor: 0.1 },
    roleBonus: { 龙头: 18, 中军: 8, 补涨: 6, 后排: -8 },
    setupBonus: { 回流: 12, 承接: 12, 低位: 8, 核心观察: 8, 分歧转强: 16 },
    note: "混沌中期：优先回流预期+主线核心方向，降低今日强度权重避免接力兑现"
  },

  "混沌末期": {
    focus: "主线卡位",
    pools: { reflow: 0.2, todayStrong: 0.1, mainLine: 0.6, lowPosition: 0.05, survivor: 0.05 },
    roleBonus: { 龙头: 18, 中军: 16, 补涨: 8, 后排: -8 },
    setupBonus: { 核心打板: 18, 分歧转强: 16, 回流: 12, 承接: 10 },
    note: "混沌末期：主线雏形显现，提前卡位核心龙头中军"
  },

  "主升初期": {
    focus: "主线接力",
    pools: { reflow: 0.1, todayStrong: 0.2, mainLine: 0.6, lowPosition: 0.05, survivor: 0.05 },
    roleBonus: { 龙头: 20, 中军: 16, 补涨: 10, 后排: -5 },
    setupBonus: { 核心打板: 20, 分歧转强: 16, 承接: 12, 打板: 18 },
    note: "主升初期：主升刚启动，龙头打板中军低吸"
  },

  "主升中期": {
    focus: "龙头延续",
    pools: { reflow: 0, todayStrong: 0.3, mainLine: 0.65, lowPosition: 0, survivor: 0.05 },
    roleBonus: { 龙头: 22, 中军: 16, 补涨: 8, 后排: -10 },
    setupBonus: { 核心打板: 22, 打板: 20, 回封: 18, 承接: 12 },
    note: "主升中期：做确定性，只做主线龙头中军"
  },

  "主升末期": {
    focus: "分歧卡位",
    pools: { reflow: 0.3, todayStrong: 0.1, mainLine: 0.5, lowPosition: 0.05, survivor: 0.05 },
    roleBonus: { 龙头: 18, 中军: 16, 补涨: 10, 后排: -8 },
    setupBonus: { 回封: 18, 分歧转强: 16, 核心观察: 12, 承接: 10, 高位: -15 },
    note: "主升末期：警惕分歧，龙头回封+中军承接"
  },

  "震荡期": {
    focus: "承接观察",
    pools: { reflow: 0.4, todayStrong: 0.2, mainLine: 0.2, lowPosition: 0.1, survivor: 0.1 },
    roleBonus: { 龙头: 12, 中军: 14, 补涨: 10, 后排: -3 },
    setupBonus: { 承接: 16, 回流: 14, 核心观察: 12, 低吸: 10 },
    note: "震荡期：看承接，不追高不抄底"
  },

  "退潮初期": {
    focus: "防守观察",
    pools: { reflow: 0.2, todayStrong: 0, mainLine: 0.2, lowPosition: 0, survivor: 0.6 },
    roleBonus: { 龙头: 14, 中军: 12, 补涨: -5, 后排: -15 },
    setupBonus: { 核心观察: 12, 承接: 8, 回流: 8 },
    note: "退潮初期：优先空仓，只看核心票能否守住"
  },

  "退潮中期": {
    focus: "空仓为主",
    pools: { reflow: 0.1, todayStrong: 0, mainLine: 0.1, lowPosition: 0, survivor: 0.8 },
    roleBonus: { 龙头: 12, 中军: 10, 补涨: -10, 后排: -20 },
    setupBonus: { 核心观察: 10 },
    note: "退潮中期：严格控制仓位，只看历史核心修复"
  },

  "退潮末期": {
    focus: "等待冰点",
    pools: { reflow: 0, todayStrong: 0, mainLine: 0, lowPosition: 0, survivor: 1.0 },
    roleBonus: { 龙头: 10, 中军: 8, 补涨: -15, 后排: -25 },
    setupBonus: {},
    note: "退潮末期：严格空仓，等待冰点修复信号"
  },

  "冰点": {
    focus: "核心修复",
    pools: { reflow: 0.1, todayStrong: 0, mainLine: 0.1, lowPosition: 0.1, survivor: 0.7 },
    roleBonus: { 龙头: 16, 中军: 14, 补涨: -3, 后排: -12 },
    setupBonus: { 核心修复: 18, 弱转强: 16, 低位: 12, 首板: 10 },
    note: "冰点：只盯历史核心修复，小仓试探"
  },

};

// ===== 回流预期判断：昨强+今弱+结构在 =====

function buildReflowExpectation(concept, candidates, yesterdaySnapshot, hotConcepts) {
  if (!concept || !yesterdaySnapshot) return null;

  const cleanConcept = String(concept || '').trim();
  if (!cleanConcept) return null;

  // 1. 昨天是否在强势榜TOP3
  const yesterdayHot = yesterdaySnapshot.hotConcepts || [];
  const wasYesterdayStrong = yesterdayHot.slice(0, 3).some((c) => {
    const name = String(c.displayName || c.name || '').trim();
    return name === cleanConcept && (c.limitCount >= 5 || c.resonance);
  });

  if (!wasYesterdayStrong) return null;

  // 2. 今天是否分歧（不是全灭）
  const conceptStocks = (Array.isArray(candidates) ? candidates : []).filter((s) =>
    String(s.mainConcept || s.mainFamily || '').trim() === cleanConcept
  );

  if (conceptStocks.length === 0) return null;

  const avgChange = conceptStocks.reduce((sum, s) => sum + ((s.changePct) || 0), 0) / conceptStocks.length;
  const coreStocks = conceptStocks.filter((s) => candidateRoleAuthority(s).coreAuthorized);
  const coreAlive = coreStocks.filter((s) => ((s.changePct) || -99) >= -4).length;

  // 分歧定义：平均跌幅-2%~-8%，但有核心票守住-4%以内
  const isDivergence = avgChange >= -8 && avgChange <= -2 && coreAlive >= 1;

  if (!isDivergence) return null;

  // 3. 今天是否还在热榜前10（结构还在）
  const todayHot = Array.isArray(hotConcepts) ? hotConcepts : [];
  const stillHot = todayHot.slice(0, 10).some((c) =>
    String(c.displayName || c.name || '').trim() === cleanConcept
  );

  if (!stillHot) return null;

  // 通过所有检查 → 有回流预期
  return {
    concept: cleanConcept,
    reason: `昨日强势(TOP3)→今日分歧(${avgChange.toFixed(1)}%)→结构还在(${coreAlive}核心存活)`,
    score: 20,
  };
}

// 为个股计算回流加分
function calcReflowBonus(stock, candidates, yesterdaySnapshot, hotConcepts) {
  const concept = String(stock.mainConcept || stock.mainFamily || '').trim();
  if (!concept) return 0;

  const expectation = buildReflowExpectation(concept, candidates, yesterdaySnapshot, hotConcepts);
  if (!expectation) return 0;

  // 基础回流分
  let bonus = expectation.score;

  // 如果是该概念的核心票，再加分
  if (candidateRoleAuthority(stock).coreAuthorized) bonus += 8;

  // 如果今天跌幅在-3%以内（守住了），再加分
  if (((stock.changePct) || -99) >= -3) bonus += 5;

  return bonus;
}

// ===== 明日最优解：把 周期→方向→龙头→红线价格 压缩成 1-3 张直接可执行的卡 =====















// 目标:开盘前不用看任何分析面板,只看这几张卡——为什么是它/怎么买/几块钱砍/仓位多少。















// 数据全部来自已验证的链路(聚类方向+龙头梯队+硬筛选+红线换算),这里只做压缩,不造新结论。
















function fundFlowDirectionStats(stock, candidates) {
  const concept = String(stock && (stock.mainConcept || stock.concept) || "").trim();
  const family = String(stock && stock.mainFamily || "").trim();
  let peers = (candidates || []).filter((item) => item && item !== stock && concept && (
    String(item.mainConcept || item.concept || "").trim() === concept
  ));
  // 细分方向样本不足时才回退到家族，避免把云计算、CPO、WiFi等宽泛
  // AI簇都误算成某只票的跟随与承接。
  if (peers.length < 2 && family) {
    peers = (candidates || []).filter((item) => item && item !== stock && String(item.mainFamily || "").trim() === family);
  }
  const changes = peers.map((item) => Number(item.changePct)).filter(Number.isFinite);
  const sortedChanges = changes.slice().sort((a, b) => a - b);
  const middle = Math.floor(sortedChanges.length / 2);
  const peerMedianChangePct = sortedChanges.length
    ? (sortedChanges.length % 2
      ? sortedChanges[middle]
      : (sortedChanges[middle - 1] + sortedChanges[middle]) / 2)
    : null;
  const stockChangeRaw = stock && stock.changePct;
  const stockChangePct = stockChangeRaw === null || stockChangeRaw === undefined || stockChangeRaw === ""
    ? null
    : Number(stockChangeRaw);
  const relativeStrength = Number.isFinite(stockChangePct) && peerMedianChangePct !== null
    ? Math.round((stockChangePct - peerMedianChangePct) * 10) / 10
    : null;
  const activeCount = peers.filter((item) => (
    item.leadership && item.leadership.initiative && item.leadership.initiative.proactive
  ) || Number(item.changePct) >= 3).length;
  const breakdownCount = peers.filter((item) => (
    item.klineProfile && item.klineProfile.structureBreak
  ) || Number(item.changePct) <= -5).length;
  const positiveRate = changes.length ? changes.filter((value) => value > 0).length / changes.length : null;
  const avgChangePct = changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : null;
  return {
    sampleSize: peers.length,
    positiveRate,
    avgChangePct,
    peerMedianChangePct,
    relativeStrength,
    activeCount,
    breakdownCount,
    state: positiveRate !== null && positiveRate >= 0.55 && breakdownCount <= Math.max(1, activeCount) ? "方向仍有承接" : "方向待确认",
  };
}

function normalizeFundFlowMarketState(marketState) {
  const state = marketState || {};
  const profitEffect = state.profitEffect && typeof state.profitEffect === "object"
    ? Number(state.profitEffect.score) : Number(state.profitEffect);
  const lossEffect = state.lossEffect && typeof state.lossEffect === "object"
    ? Number(state.lossEffect.score) : Number(state.lossEffect);
  const dayState = String(state.dailyState && state.dailyState.label || state.subPhase || "");
  return {
    ...state,
    profitEffect: Number.isFinite(profitEffect) ? profitEffect : null,
    lossEffect: Number.isFinite(lossEffect) ? lossEffect : null,
    dayState,
    panic: Boolean(state.dailyState && state.dailyState.retreatCandidate) || /退潮|恐慌/.test(String(state.cycle || "") + dayState),
    negativeFeedbackSpread: /负反馈扩散|恐慌|退潮/.test(dayState)
      ? true
      : /健康分化|修复|回暖/.test(dayState) ? false : null,
  };
}

function candidateRoleAuthority(stock) {
  const row = stock && typeof stock === "object" ? stock : {};
  const leadership = row.leadership && typeof row.leadership === "object" ? row.leadership : {};
  const cycleIdentity = leadership.cycleIdentity && typeof leadership.cycleIdentity === "object"
    ? leadership.cycleIdentity
    : row.cycleIdentity && typeof row.cycleIdentity === "object" ? row.cycleIdentity : {};
  const sessionIdentity = leadership.sessionIdentity && typeof leadership.sessionIdentity === "object"
    ? leadership.sessionIdentity : {};
  const cycleLeader = cycleIdentity.executionEligible === true
    && cycleIdentity.identityEstablished === true
    && cycleIdentity.activePrimary === true
    && ["confirmed", "retained"].includes(String(cycleIdentity.state || ""));
  const dailyHeight = !cycleLeader && (
    sessionIdentity.dailyHeight === true
    || row.roleKind === "dailyHeight"
    || row.dailyRole === "当日高度"
    || row.roleScope === "session" && /高度|龙头/.test(String(row.dailyRole || row.role || ""))
  );
  const rollingCapacity = !dailyHeight
    && row.roleKind === "capacityCore"
    && row.roleScope === "rolling";
  return {
    cycleLeader,
    rollingCapacity,
    dailyHeight,
    coreAuthorized: cycleLeader || rollingCapacity,
  };
}

function roleAuthoritySnapshot(candidates) {
  return JSON.stringify((Array.isArray(candidates) ? candidates : []).map((stock) => {
    const code = String(stock && (stock.code || stock.secCode) || "").trim();
    const leadership = stock && stock.leadership && typeof stock.leadership === "object" ? stock.leadership : {};
    const cycle = leadership.cycleIdentity || null;
    const session = leadership.sessionIdentity || null;
    return [code, stock && stock.roleKind || null, stock && stock.roleScope || null, stock && stock.dailyRole || null,
      cycle && cycle.state || null, cycle && cycle.identityEstablished === true, cycle && cycle.activePrimary === true,
      cycle && cycle.executionEligible === true,
      session && session.dailyHeight === true];
  }).sort((left, right) => left[0].localeCompare(right[0])));
}

function refreshCandidateFlowAndGate(candidates, marketState, limitStats) {
  const rows = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  const flowMarketState = normalizeFundFlowMarketState(marketState);
  rows.forEach((stock) => {
    const roleAuthority = candidateRoleAuthority(stock);
    const verifiedCycleCore = roleAuthority.cycleLeader;
    const rollingCapacityCore = roleAuthority.rollingCapacity;
    const directionStats = fundFlowDirectionStats(stock, rows);
    const flowNature = classifyFundFlow(stock, {
      marketState: flowMarketState,
      limitStats: limitStats || {},
      directionStats,
    });
    stock.flowNature = flowNature;
    const gate = hardGate(stock, {
      coreVolumeRelax: ["混沌", "冰点", "震荡"].includes(String(marketState && marketState.cycle || ""))
        && (verifiedCycleCore || rollingCapacityCore),
      capacityStock: stock.ticketType === "容量票" || rollingCapacityCore,
      marketState: flowMarketState,
      limitStats: limitStats || {},
      directionStats,
    });
    stock.hardGate = gate;
    const rejects = Array.isArray(stock.rejects) ? stock.rejects : [];
    stock.rejects = rejects.filter((reason) => !/^硬筛选未过[:：]/.test(String(reason || "")));
    const gateDataMissing = !gate.pass && gate.hardFails.length === 1 && gate.hardFails[0] === "缺K线无法验证趋势结构";
    if (!gate.pass && !gateDataMissing) {
      gate.hardFails.forEach((reason) => stock.rejects.push(`硬筛选未过：${reason}`));
    }
  });
  return rows;
}

function previousExecutionPhaseMap(snapshot, currentTradingDate) {
  const result = {};
  if (!snapshot || typeof snapshot !== "object") return result;
  const previousDate = String(
    snapshot.archiveMeta && snapshot.archiveMeta.tradingDate
    || snapshot.marketEmotion && snapshot.marketEmotion.tradingDate
    || snapshot.tomorrowOutlook && snapshot.tomorrowOutlook.date
    || "",
  ).trim();
  const currentDate = String(currentTradingDate || "").trim();
  // 同一交易日重复抓取不能让“启动”自动晋级为“确认”。只有明确更早的收盘快照才可继承阶段。
  if (!previousDate || !currentDate || previousDate >= currentDate) return result;
  (Array.isArray(snapshot.candidates) ? snapshot.candidates : []).forEach((stock) => {
    const code = String(stock && (stock.code || stock.secCode) || "").trim();
    const execution = stock && stock.tomorrowExecution;
    const phaseKey = String(execution && (execution.pricePhaseKey || execution.phaseKey) || "").trim();
    if (code && phaseKey) result[code] = { pricePhaseKey: phaseKey, tradingDate: previousDate };
  });
  const plans = snapshot.bestPicks && Array.isArray(snapshot.bestPicks.scenarioPlans)
    ? snapshot.bestPicks.scenarioPlans
    : [];
  plans.forEach((plan) => {
    const candidate = plan && plan.candidate;
    const code = String(candidate && candidate.code || "").trim();
    const phaseKey = String(candidate && (candidate.pricePhaseKey || candidate.phaseKey) || "").trim();
    if (code && phaseKey) result[code] = { pricePhaseKey: phaseKey, tradingDate: previousDate };
  });
  return result;
}

function buildBestPicks(candidates, topicBoard, marketState, hotConcepts = [], survivorBoard = null, sectorRows = [], limitStats = null, yesterdaySnapshot = null, tomorrowOutlook = null, options = {}) {
  const allCandidates = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
  const validationMode = String(options && options.validationMode || "").trim();
  const rankingStudy = validationMode === "ranking-study";
  const embeddedDecisionContext = marketState && marketState.phaseDetail
    && marketState.phaseDetail.decisionContext && typeof marketState.phaseDetail.decisionContext === "object"
    ? marketState.phaseDetail.decisionContext : null;
  const decisionContext = options && options.decisionContext && typeof options.decisionContext === "object"
    ? options.decisionContext : embeddedDecisionContext;
  const canonicalBigCycle = normalizeBigCycle(
    decisionContext && decisionContext.bigCycle
      && (decisionContext.bigCycle.label || decisionContext.bigCycle.key),
  );
  const canonicalSmallCycle = String(
    decisionContext && decisionContext.smallCycle
      && (decisionContext.smallCycle.label || decisionContext.smallCycle.key)
    || "",
  ).trim();
  if (options && options.requireCanonicalContext === true && (!canonicalBigCycle || !canonicalSmallCycle)) {
    return {
      executionVersion: 3,
      available: false,
      picks: [],
      decisionPool: [],
      scenarioPlans: [],
      note: "统一大周期或小周期上下文缺失，个股因子失败关闭。",
      selectionContext: {
        authority: "canonical_market_phase_detail",
        status: "blocked",
        passed: false,
      },
    };
  }
  const cycle = canonicalBigCycle || String(marketState && marketState.cycle ? marketState.cycle : "");
  const subPhase = canonicalSmallCycle || String(marketState && marketState.subPhase ? marketState.subPhase : "");
  const tradeWindow = marketState && marketState.tradeWindow && typeof marketState.tradeWindow === "object"
    ? marketState.tradeWindow
    : {};
  const preemptiveCoreCodes = new Set(
    (Array.isArray(tradeWindow.coreEvidence) ? tradeWindow.coreEvidence : [])
      .map((item) => String(item && item.code || "").trim())
      .filter(Boolean),
  );
  // 指数环境决定执行周期；主线三日容错仅是题材观察标签，不能改变选股周期。
  const executionCycle = normalizeBigCycle(cycle) || "混沌";
  const phaseText = executionCycle + subPhase;
  const detailedPhaseInfo = classifyDetailedPhase(executionCycle, marketState, hotConcepts, limitStats, yesterdaySnapshot);
  const detailedPhase = detailedPhaseInfo.detailedPhase;
  const strategy = SELECTION_STRATEGY[detailedPhase] || SELECTION_STRATEGY["混沌中期"];
  // 有效性验证固定使用当日旧 selected 短名单作共同样本池，只比较排序变化；
  // 正式执行仍使用 leadership/tomorrowExecution 严格池，二者不得混用。
  const leadershipReady = !rankingStudy && allCandidates.some((stock) => stock && stock.leadership);
  const blockedOverride = (stock) => /退潮|禁止新开|高风险|资金出逃|放量长阴|破位|缺K线|换手过大/.test(
    (Array.isArray(stock && stock.rejects) ? stock.rejects : []).join("；"),
  );
  const legacyPool = allCandidates.filter((stock) => stock.selected);
  const identityCorePool = allCandidates.filter((stock) => (
    stock.leadership
    && (
      stock.leadership.coreIdentityQualified === true
      || stock.leadership.coreQualified === true
      || stock.leadership.repairCoreQualified === true
    )
  ));
  const currentTradingDate = String(
    tomorrowOutlook && tomorrowOutlook.date
    || marketState && marketState.tradingDate
    || limitStats && (limitStats.qdate || limitStats.tradingDate)
    || "",
  ).trim();
  const tomorrowExecution = buildTomorrowExecutionBoard(allCandidates, {
    cycle: executionCycle,
    subPhase,
    detailedPhase,
    tradingDate: currentTradingDate,
    previousPhaseByCode: previousExecutionPhaseMap(yesterdaySnapshot, currentTradingDate),
    focusDirection: topicBoard && topicBoard.mainLine && (
      topicBoard.mainLine.displayName || topicBoard.mainLine.name || topicBoard.mainLine.family
    ),
  });
  const executionPickCode = (value) => String(value && (value.code || value.secCode || value.stockCode || value.symbol) || "").trim();
  const strictExecutionFailureReasons = (pick) => {
    const candidate = pick && typeof pick === "object" ? pick : {};
    const leadership = candidate.leadership && typeof candidate.leadership === "object" ? candidate.leadership : {};
    const hardGate = candidate.hardGate && typeof candidate.hardGate === "object" ? candidate.hardGate : {};
    const execution = candidate.tomorrowExecution && typeof candidate.tomorrowExecution === "object" ? candidate.tomorrowExecution : {};
    const reasons = [];
    if (execution.tomorrowEntryQualified !== true) reasons.push("明日入场资格未通过");
    if (candidate.tradeQualified !== true) reasons.push("候选个股交易资格未通过");
    if (leadership.tradeQualified !== true) reasons.push("核心地位交易资格未通过");
    if (hardGate.pass !== true) reasons.push("候选个股硬门槛未通过");
    return reasons;
  };
  const hardenScenarioPlans = (plans, fullPicks = []) => {
    const pickByCode = new Map(
      (Array.isArray(fullPicks) ? fullPicks : [])
        .map((pick) => [executionPickCode(pick), pick])
        .filter(([code]) => code),
    );
    return (Array.isArray(plans) ? plans : []).map((plan) => {
      const rawCandidate = plan && plan.candidate && typeof plan.candidate === "object" ? plan.candidate : null;
      if (!rawCandidate) {
        return {
          ...plan,
          executionVersion: 3,
          status: "empty",
          statusLabel: "暂无合格核心",
          candidate: null,
        };
      }
      const code = executionPickCode(rawCandidate);
      const fullPick = code ? pickByCode.get(code) : null;
      const reasons = strictExecutionFailureReasons(fullPick);
      if (!fullPick || reasons.length) {
        return {
          ...plan,
          executionVersion: 3,
          status: "blocked",
          statusLabel: "仅观察：未通过v3执行门槛",
          candidate: null,
          blockedCandidate: {
            code,
            name: String(rawCandidate.name || code || "候选").trim(),
            reasons: reasons.length ? reasons : ["候选执行字段缺失"],
          },
        };
      }
      return {
        ...plan,
        executionVersion: 3,
        status: "ready",
        statusLabel: "候选已通过v3执行门槛",
        blockedCandidate: null,
        candidate: {
          ...rawCandidate,
          executionVersion: 3,
          tradeQualified: true,
          hardGate: fullPick.hardGate,
          leadership: fullPick.leadership,
          tomorrowExecution: fullPick.tomorrowExecution,
          price: fullPick.price,
          priceSource: fullPick.priceSource,
          priceIntegrity: fullPick.priceIntegrity,
          marketCapCarrier: fullPick.marketCapCarrier || null,
          buy: fullPick.buy,
          sell: fullPick.sell,
        },
      };
    });
  };
  const tomorrowExecutionByCode = new Map(
    tomorrowExecution.entryPicks
      .concat(tomorrowExecution.premiumWatch, tomorrowExecution.riskWatch)
      .map((row) => [String(row.code || ""), row])
      .filter(([code]) => code),
  );
  allCandidates.forEach((stock) => {
    const code = String(stock.code || stock.secCode || "");
    stock.tomorrowExecution = tomorrowExecutionByCode.get(code) || null;
  });
  const tomorrowEntryPool = tomorrowExecution.entryStocks.filter((stock) => !blockedOverride(stock));
  const coreWatchlist = identityCorePool
    .slice()
    .sort((a, b) => {
      const aLeadership = a.leadership || {};
      const bLeadership = b.leadership || {};
      const activeDiff = Number(bLeadership.initiative && bLeadership.initiative.score || 0)
        - Number(aLeadership.initiative && aLeadership.initiative.score || 0);
      if (activeDiff) return activeDiff;
      return Number(b.amountYi || 0) - Number(a.amountYi || 0);
    })
    .slice(0, 6)
    .map((stock) => ({
      code: String(stock.code || stock.secCode || ""),
      name: String(stock.name || stock.code || "--"),
      identity: String(stock.leadership && stock.leadership.identity || "核心验证"),
      anchorType: String(stock.leadership && stock.leadership.anchorType || "核心验证"),
      tradeState: String(stock.leadership && stock.leadership.tradeState || "仅观察"),
      tradeQualified: Boolean(stock.leadership && stock.leadership.tradeQualified === true),
      flowKey: String(stock.flowNature && stock.flowNature.key || "uncertain"),
      flowLabel: String(stock.flowNature && stock.flowNature.label || "资金性质待确认"),
      note: String(stock.leadership && stock.leadership.executionNote || stock.flowNature && stock.flowNature.tradeBias || "等待次日触发"),
    }));
  const marketPlan = String(
    tomorrowOutlook && (tomorrowOutlook.biasNote || tomorrowOutlook.keyLine)
    || marketState && marketState.summary
    || "明日先验证市场承接，再决定是否执行个股买点。",
  );
  const poolMap = new Map();
  (leadershipReady ? tomorrowEntryPool : legacyPool).forEach((stock) => {
    const code = String(stock.code || stock.secCode || "");
    if (code) poolMap.set(code, stock);
  });
  if (tradeWindow.allowNew === true) {
    allCandidates.forEach((stock) => {
      const code = String(stock && (stock.code || stock.secCode) || "").trim();
      if (code && preemptiveCoreCodes.has(code) && !blockedOverride(stock)) poolMap.set(code, stock);
    });
  }
  const pool = Array.from(poolMap.values()).filter((stock) => !leadershipReady || (
    stock.leadership
    && (
      stock.tomorrowExecution && stock.tomorrowExecution.tomorrowEntryQualified === true
      || tradeWindow.allowNew === true && preemptiveCoreCodes.has(String(stock.code || stock.secCode || ""))
    )
    && !blockedOverride(stock)
  ));

  if (!rankingStudy && marketState && marketState.shockTransition && marketState.shockTransition.active) {
    return {
      executionVersion: 3,
      available: false,
      picks: [],
      note: "基础周期仍按混沌记录，但当日是退潮级冲击表现——0%防守，次日10:50只验证，收盘确认前不开新仓",
      detailedPhase,
      strategyNote: "外围提醒只作归因；是否纠偏由次日A股自身修复决定",
      premiumWatch: tomorrowExecution.premiumWatch,
      riskWatch: tomorrowExecution.riskWatch,
      executionCounts: tomorrowExecution.counts,
      scenarioPlans: hardenScenarioPlans(tomorrowExecution.scenarioPlans),
    };
  }

  if (!rankingStudy && /退潮/.test(phaseText) && tradeWindow.allowNew !== true) {
    return {
      executionVersion: 3,
      available: false,
      picks: [],
      note: "退潮周期不开新仓——空仓也是仓位，等修复信号再进场",
      detailedPhase,
      strategyNote: strategy.note,
      tradeWindow,
      premiumWatch: tomorrowExecution.premiumWatch,
      riskWatch: tomorrowExecution.riskWatch,
      executionCounts: tomorrowExecution.counts,
      scenarioPlans: hardenScenarioPlans(tomorrowExecution.scenarioPlans),
    };
  }

  if (!pool.length) {
    return {
      executionVersion: 3,
      ...(rankingStudy ? {
        validationOnly: true,
        studyScope: "relative_ranking_same_legacy_shortlist",
        factorUniverse: {
          source: "legacy_selected",
          sourceCount: legacyPool.length,
          rankedCount: 0,
          executionAuthority: false,
        },
      } : {}),
      available: false,
      picks: [],
      note: leadershipReady
        ? "当前没有盘后直接执行的标的；核心身份仍保留，明日按兑现回流、承接加强或资金出逃三种触发分别处理"
        : "今天没有筛出可用候选，宁缺毋滥，等盘后再看回流和核心确认",
      detailedPhase,
      strategyNote: strategy.note,
      marketPlan,
      watchlist: coreWatchlist,
      premiumWatch: tomorrowExecution.premiumWatch,
      riskWatch: tomorrowExecution.riskWatch,
      executionCounts: tomorrowExecution.counts,
      scenarioPlans: hardenScenarioPlans(tomorrowExecution.scenarioPlans),
    };
  }

  const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;
  const toNum = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  };
  const clean = (value) => String(value || "").trim();
  const splitTokens = (value) => clean(value).split(/[/、,，|·s（）()[]【】:_-]+/).map((item) => item.trim()).filter(Boolean);
  const uniq = (list) => Array.from(new Set((list || []).filter(Boolean)));
  const is20cm = (stock) => /^(30|68)/.test(clean(stock && stock.code)) || /创业板|科创板|北交/.test(clean(stock && stock.board));
  const labelConcept = (item) => clean(item && (item.displayName || item.name || item.family || ""));

  const collectConcept = (source, origin) => {
    if (!source) return null;
    const displayName = labelConcept(source);
    const family = clean(source.family || source.name || displayName);
    const name = clean(source.name || family || displayName);
    const aliases = Array.isArray(source.aliases) ? source.aliases.map(clean).filter(Boolean) : [];
    const keywords = uniq([displayName, family, name].concat(aliases).flatMap(splitTokens));
    const score = toNum(source.score);
    const count = toNum(source.count);
    const limitCount = toNum(source.limitCount);
    const resonance = !!source.resonance;
    const sustained = !!source.sustained;
    const label = clean(source.label);
    const reasons = Array.isArray(source.reasons) ? source.reasons.slice() : [];
    const power = score + count * 6 + limitCount * 7 + (resonance ? 18 : 0) + (sustained ? 14 : 0) + (label === "主线持续" ? 10 : 0) + (label === "可继续观察" ? 4 : 0) + (origin === "mainLine" ? 4 : 0) + (origin === "hot" ? 2 : 0);
    return { origin, key: family + "|" + name + "|" + displayName, displayName, family, name, aliases, keywords, score, count, limitCount, resonance, sustained, label, reasons, power };
  };

  const conceptPool = [];
  const pushConcept = (item, origin) => {
    const concept = collectConcept(item, origin);
    if (concept) conceptPool.push(concept);
  };

  pushConcept(topicBoard && topicBoard.mainLine, "mainLine");
  (Array.isArray(topicBoard && topicBoard.items) ? topicBoard.items : []).forEach((item) => pushConcept(item, "topic"));
  (Array.isArray(hotConcepts) ? hotConcepts : []).forEach((item) => pushConcept(item, "hot"));

  const uniqueConcepts = [];
  conceptPool.sort((a, b) => b.power - a.power).forEach((item) => {
    if (!uniqueConcepts.some((existing) => existing.key === item.key)) uniqueConcepts.push(item);
  });

  // decisionKey 仅是本函数内部策略分支；大周期始终由 executionCycle
  // 表示。主升分歧属于小周期策略，不能再写回个股的 cycle 字段。
  let decisionKey = executionCycle;
  if (executionCycle === "主升" && /高位分歧|高位震荡|分歧/.test(subPhase)) {
    decisionKey = "主升分歧";
  }

  const chaosLargeDivergenceGate = Boolean(
    decisionKey === "混沌"
      && tomorrowOutlook
      && tomorrowOutlook.chaosDivergence
      && tomorrowOutlook.chaosDivergence.blockTomorrowReflow,
  );

  const mainLine = collectConcept(topicBoard && topicBoard.mainLine, "mainLine");
  const strongMainLine = !!(topicBoard && topicBoard.mainLine && (topicBoard.mainLine.sustained || topicBoard.mainLine.resonance || toNum(topicBoard.mainLine.count) >= 4 || /主线持续/.test(clean(topicBoard.mainLine.label))));
  let focusConcept = uniqueConcepts[0] || mainLine || null;
  if ((decisionKey === "主升" || decisionKey === "主升分歧") && strongMainLine && mainLine) {
    focusConcept = mainLine;
  }
  if ((decisionKey === "混沌" || decisionKey === "冰点" || decisionKey === "震荡") && uniqueConcepts.length) {
    focusConcept = uniqueConcepts[0];
  }
  const supportConcept = uniqueConcepts.find((item) => !focusConcept || item.key !== focusConcept.key) || null;

  const stockTokens = (stock) => uniq([
    stock && stock.mainConcept,
    stock && stock.mainFamily,
    stock && stock.concept,
    stock && stock.board,
    stock && stock.sector,
    stock && stock.topic,
    stock && stock.ticketType,
    stock && stock.role,
    stock && stock.roleReason,
    stock && stock.setup,
    stock && stock.tradePlan && stock.tradePlan.style,
    stock && stock.gamePlan && stock.gamePlan.gameType,
    stock && stock.speculation && stock.speculation.logic,
  ].flatMap(splitTokens));

  const matchConceptScore = (stock, concept) => {
    if (!concept) return 0;
    const tokens = stockTokens(stock);
    let score = 0;
    if (clean(stock && stock.mainFamily) && clean(stock.mainFamily) === concept.family) score += 28;
    if (clean(stock && stock.mainConcept) && (clean(stock.mainConcept) === concept.name || clean(stock.mainConcept) === concept.displayName)) score += 24;
    if (clean(stock && stock.concept) && (clean(stock.concept) === concept.name || clean(stock.concept) === concept.family)) score += 16;
    if (tokens.some((token) => concept.keywords.includes(token))) score += 12;
    else if (tokens.some((token) => concept.keywords.some((word) => token.includes(word) || word.includes(token)))) score += 8;
    const text = [
      stock && stock.roleReason,
      stock && stock.ticketReason,
      stock && stock.tradePlan && stock.tradePlan.buy,
      stock && stock.tradePlan && stock.tradePlan.nextDay,
      stock && stock.gamePlan && stock.gamePlan.gameReason,
      stock && stock.speculation && stock.speculation.logic,
    ].map(clean).join(" ");
    if (text && concept.keywords.some((word) => text.includes(word))) score += 4;
    return score;
  };

  const survivorItems = Array.isArray(survivorBoard && survivorBoard.items) ? survivorBoard.items : [];
  const survivorByCode = new Map(survivorItems.map((item) => [clean(item && item.code), item]).filter(([key]) => key));
  const survivorByConcept = survivorItems.filter(Boolean);

  const survivorScore = (stock) => {
    const byCode = survivorByCode.get(clean(stock && stock.code));
    if (byCode) {
      return {
        score: (byCode.limitUp ? 14 : 10) + (candidateRoleAuthority(byCode).coreAuthorized ? 4 : 0),
        note: clean(byCode.concept || byCode.role || "历史核心"),
      };
    }
    const sameConcept = survivorByConcept.find((item) => {
      const conceptText = clean(item && item.concept);
      return conceptText && (conceptText === clean(stock && stock.mainConcept) || conceptText === clean(stock && stock.mainFamily));
    });
    if (sameConcept) {
      return {
        score: 6 + (candidateRoleAuthority(sameConcept).coreAuthorized ? 2 : 0),
        note: clean(sameConcept.concept || sameConcept.role || "历史留存"),
      };
    }
    return { score: 0, note: "" };
  };

  const factorDecisionByStock = new WeakMap();
  const recordFactorDecision = (stock, decision) => {
    factorDecisionByStock.set(stock, decision);
    if (stock && typeof stock === "object") stock.factorDecision = decision;
    return decision;
  };

  const buildScore = (stock) => {
    const focusHit = matchConceptScore(stock, focusConcept);
    const supportHit = supportConcept && focusConcept && supportConcept.key !== focusConcept.key ? matchConceptScore(stock, supportConcept) : 0;
    const mainHit = mainLine && (!focusConcept || mainLine.key !== focusConcept.key) ? matchConceptScore(stock, mainLine) : 0;
    const surv = survivorScore(stock);
    const authority = candidateRoleAuthority(stock);
    const isLeaderOrZhongjun = authority.coreAuthorized;
    let themeThreshold = 0;
    if (decisionKey === "混沌" || decisionKey === "冰点" || decisionKey === "震荡") {
      const isWindowCore = tradeWindow.allowNew === true && preemptiveCoreCodes.has(clean(stock && (stock.code || stock.secCode)));
      themeThreshold = isWindowCore ? 0 : isLeaderOrZhongjun ? 8 : 16;
    }
    if (decisionKey === "主升分歧") themeThreshold = 12;
    const rejectsText = (Array.isArray(stock && stock.rejects) ? stock.rejects : []).join("；");
    const upstreamGate = stock && stock.hardGate && typeof stock.hardGate === "object"
      ? stock.hardGate.pass === true
      : null;
    const repairNodeActive = /repair/.test(String(marketState && marketState.bigCycleTransition && marketState.bigCycleTransition.key || ""));
    const reflowBonus = (detailedPhase.includes("混沌") || repairNodeActive) && yesterdaySnapshot
      ? calcReflowBonus(stock, pool, yesterdaySnapshot, hotConcepts)
      : 0;
    if (reflowBonus > 0) stock._reflowBonus = reflowBonus;
    const factorDecision = buildUnifiedStockFactorDecision({
      stock,
      decisionKey,
      smallCycleKey: subPhase,
      themeEvidence: {
        focusHit,
        supportHit,
        mainHit,
        threshold: themeThreshold,
        focusRequired: Boolean(focusConcept),
      },
      roleAuthority: authority,
      survivorScore: surv.score,
      reflowBonus,
      modeAllowed: Boolean(
        rankingStudy && stock && stock.selected
        || authority.coreAuthorized
        || stock && stock.tomorrowExecution && stock.tomorrowExecution.tomorrowEntryQualified === true
        || tradeWindow.allowNew === true && preemptiveCoreCodes.has(clean(stock && (stock.code || stock.secCode))),
      ),
      dataComplete: !/缺K线|数据缺失|行情缺失/.test(rejectsText),
      riskPassed: !blockedOverride(stock),
      upstreamGate,
      priceIntegrity: resolveDecisionPrice(stock),
    });
    recordFactorDecision(stock, factorDecision);
    return Number.isFinite(factorDecision.finalScore)
      ? factorDecision.finalScore
      : themeThreshold === 12 ? -500 : -999;
  };

  const focusLabel = labelConcept(focusConcept);
  const supportLabel = labelConcept(supportConcept);
  const mainLabel = labelConcept(mainLine || (topicBoard && topicBoard.mainLine));
  const cycleText = executionCycle;
  const strategyCycleText = decisionKey === "主升分歧" ? "主升里的高位分歧" : executionCycle;

  // ========== 构建5个独立选股池 ==========
  const todayStrongPool = buildTodayStrongPool(pool, strategy, buildScore);
  const reflowPool = buildReflowPoolStocks(pool, yesterdaySnapshot, hotConcepts, strategy, buildReflowExpectation, calcReflowBonus);
  const mainLinePool = buildMainLinePool(pool, topicBoard, strategy);
  const lowPositionPool = buildLowPositionPool(pool, strategy);
  const survivorPool = buildSurvivorPoolStocks(pool, survivorBoard, strategy);

  // ========== 按策略权重混合池 ==========
  // 回流池现在有fallback逻辑，即使没有昨日快照也能工作，保持原始权重
  const mixedPool = mixPools({
    reflow: reflowPool,
    todayStrong: todayStrongPool,
    mainLine: mainLinePool,
    lowPosition: lowPositionPool,
    survivor: survivorPool
  }, strategy.pools);

  // 正式统一因子必须遍历完整严格候选池；旧五池只保留为观察与历史对照，
  // 不得在评分前过滤正式候选，否则后续统一链无法恢复被旧模型排除的股票。
  const canonicalFactorMode = options && options.requireCanonicalContext === true;
  const finalPool = rankingStudy || canonicalFactorMode
    ? pool
    : mixedPool.length > 0 ? mixedPool : pool;

  let topLeaderBest = null;
  let topLeaderScore = -Infinity;
  let best = null;
  const rankedPicks = [];

  finalPool.forEach((stock) => {
    const score = buildScore(stock);
    // -999/-500 只是内部“不满足概念闸门”的哨兵，绝不能进入页面、排序或缓存。
    if (!Number.isFinite(score) || score <= -500) return;
    const focusHit = matchConceptScore(stock, focusConcept);
    const supportHit = supportConcept && focusConcept && supportConcept.key !== focusConcept.key ? matchConceptScore(stock, supportConcept) : 0;
    const mainHit = mainLine && (!focusConcept || mainLine.key !== focusConcept.key) ? matchConceptScore(stock, mainLine) : 0;
    const surv = survivorScore(stock);
    const role = clean(stock && stock.role) || "未分级";
    const roleAuthority = candidateRoleAuthority(stock);
    const leadership = stock && stock.leadership ? stock.leadership : null;
    const tomorrowDecision = stock && stock.tomorrowExecution && typeof stock.tomorrowExecution === "object"
      ? stock.tomorrowExecution
      : null;
    const setup = clean(stock && stock.setup) || clean(stock && stock.ticketType) || "未给出setup";
    const tickerType = clean(stock && stock.ticketType);
    const board = clean(stock && stock.board) || "主板";
    const code = clean(stock && stock.code);
    const changePct = toNum(stock && stock.changePct);
    const priceResolution = resolveDecisionPrice(stock);
    const basePrice = toNum(priceResolution.price);
    const stockIs20cm = is20cm(stock);
    const mode = decisionKey === "主升"
      ? (/情绪龙头票/.test(tickerType) || roleAuthority.cycleLeader ? "打板" : "趋势")
      : decisionKey === "主升分歧"
        ? (/情绪龙头票/.test(tickerType) || roleAuthority.cycleLeader ? "回封" : "低吸")
        : decisionKey === "混沌"
          ? "回流试错"
          : decisionKey === "冰点"
              ? "核心修复"
              : clean(stock && stock.stopLossPlan && stock.stopLossPlan.mode) || "观察";
    const strongPct = /情绪龙头票/.test(tickerType) || /首板涨停/.test(clean(stock && stock.popularity))
      ? (stockIs20cm ? 7 : 4)
      : /容量票/.test(tickerType)
        ? 3
        : 4;
    const normalPct = /情绪龙头票/.test(tickerType) || /首板涨停/.test(clean(stock && stock.popularity))
      ? (stockIs20cm ? 3 : 1.5)
      : /容量票/.test(tickerType)
        ? 1.5
        : 2;
    const weakPct = /情绪龙头票/.test(tickerType) || /首板涨停/.test(clean(stock && stock.popularity))
      ? 0
      : -3;
    const upStrong = round2(basePrice * (1 + strongPct / 100));
    const upNormal = round2(basePrice * (1 + normalPct / 100));
    const downWeak = round2(basePrice * (1 + weakPct / 100));
    const hardRange = (() => {
      if (/情绪龙头票/.test(tickerType)) return stockIs20cm ? [-10, -12] : [-6, -7];
      const stopRange = stock && stock.stopLossPlan && stock.stopLossPlan.stopLoss && Array.isArray(stock.stopLossPlan.stopLoss.range) ? stock.stopLossPlan.stopLoss.range.slice(0, 2) : null;
      if (stopRange && stopRange.length === 2) return stopRange;
      return decisionKey === "混沌" || decisionKey === "冰点" ? [-3, -2] : [-2, -1];
    })();
    const hardPriceRange = hardRange.map((pct) => round2(basePrice * (1 + pct / 100)));
    const takeRange = stock && stock.stopLossPlan && stock.stopLossPlan.takeProfit && Array.isArray(stock.stopLossPlan.takeProfit.range) ? stock.stopLossPlan.takeProfit.range.slice(0, 2) : (decisionKey === "主升" ? [15, 25] : decisionKey === "主升分歧" ? [8, 15] : decisionKey === "混沌" ? [5, 12] : [5, 10]);
    const ma5 = stock && stock.klineProfile ? toNum(stock.klineProfile.ma5) : 0;
    const backtest = stock && stock.backtest && stock.backtest.summary ? stock.backtest.summary : null;
    const focusReason = focusConcept ? (focusConcept.reasons && focusConcept.reasons.length ? focusConcept.reasons[0] : (focusConcept.label || focusConcept.displayName || focusConcept.name)) : "";
    const supportReason = supportConcept ? (supportConcept.reasons && supportConcept.reasons.length ? supportConcept.reasons[0] : (supportConcept.label || supportConcept.displayName || supportConcept.name)) : "";
    const survivorNote = surv.note ? ("历史核心：" + surv.note + "，不是今天才冒出来的票") : "历史核心没有额外记忆，按当日结构判断";
    const cycleNote = decisionKey === "??"
      ? "主升期可以做今天最强的接力，但只做主线核心/中军，不追脱离主线的先队"
      : decisionKey === "????"
        ? "主升里的分歧可以看今天最强，但更要找仍能回流的核心，不能只把涨幅当明日答案"
      : decisionKey === "??"
        ? "混沌期优先博弈龙头票，今天最强只是当日答案，不要直接当成明日唯一最优解"
      : decisionKey === "??"
        ? "修复期优先低位和弱转强，回流没确认前不要追高位延续"
      : decisionKey === "??"
        ? "冰点只看核心修复和新生低位试错，没有回流就先等"
        : "震荡期优先看承接和回流，不把轮动当成趋势";
    const noteParts = [];
    if (focusLabel) noteParts.push("优先锚点：" + focusLabel + (supportLabel && supportLabel !== focusLabel ? "；次级观察 " + supportLabel : ""));
    if (mainLabel && mainLabel !== focusLabel) noteParts.push("主线背景：" + mainLabel);
    noteParts.push(strategyCycleText + "： " + cycleNote);
    if (focusReason) noteParts.push("锚点理由：" + focusReason);
    if (supportReason && supportLabel && supportLabel !== focusLabel) noteParts.push("次级理由：" + supportReason);
    if (surv.note) noteParts.push(survivorNote);

    const why = [];
    why.push("方向锚：" + (focusLabel || "当前方向") + (supportLabel && supportLabel !== focusLabel ? " / " + supportLabel : "") + "，" + (focusReason || "先按板块热度和结构强弱筛选"));
    why.push("角色结构：" + role + " · " + setup + "，" + (clean(stock && stock.roleReason) || clean(stock && stock.ticketReason) || "角色解释由当前结构决定"));
    why.push("周期判断：" + strategyCycleText + "，" + cycleNote);
    why.push("资金与历史：" + (toNum(stock && stock.turnoverRate) ? "换手 " + round2(stock.turnoverRate).toFixed(2) + "%，" : "") + (toNum(stock && stock.volumeRatio) ? "量比 " + round2(stock.volumeRatio).toFixed(2) + "，" : "") + (toNum(stock && stock.mainInflowYi) ? "主力净流入 " + round2(stock.mainInflowYi).toFixed(2) + "亿" : "资金数据按现有快照判断") + (backtest ? "；回测 " + clean(backtest.verdict || "未知") + "，次日胜率 " + round2(backtest.winRate3d || 0).toFixed(0) + "%" : ""));
    if (surv.note) why.push("历史记忆：" + survivorNote);

    const buyPlanParts = [];
    if (stock && stock.tradePlan && stock.tradePlan.buy) buyPlanParts.push(clean(stock.tradePlan.buy));
    if (decisionKey === "主升") buyPlanParts.push("主升期可以做今天最强的接力，但只做主线核心和中军，不追脱离主线的兑现。");
    else if (decisionKey === "主升分歧") buyPlanParts.push("主升里的分歧，先等回封或分歧转强，不在一致高开里硬接。");
    else if (decisionKey === "混沌") buyPlanParts.push("混沌期先看" + (focusLabel || "当前方向") + "是否回流，今天最强不直接等于明日最优解。");
    else if (decisionKey === "冰点") buyPlanParts.push("冰点只做核心修复或新生低位试错，没有回流就先放弃。");
    else buyPlanParts.push("先看板块承接，再看个股分时确认。");

    if (leadership && leadership.tradeState === "等回踩") {
      buyPlanParts.unshift("龙头地位成立，但当前偏离成本较大，只等回踩承接，不在一致加速中追价。");
    }
    if (tomorrowDecision && tomorrowDecision.tomorrowEntryQualified) {
      buyPlanParts.unshift(
        `${tomorrowDecision.stateLabel}已取得明日条件博弈资格；只有方向与个股承接同时触发才执行，明显高开导致赔率消失则自动取消。`,
      );
    }

    const buyNoteParts = [];
    if (stock && stock.gamePlan && stock.gamePlan.gameReason) buyNoteParts.push(clean(stock.gamePlan.gameReason));
    if (backtest && backtest.sampleCount) {
      buyNoteParts.push("近" + backtest.sampleCount + "日相似触发，次日胜率 " + round2(backtest.winRate3d || 0).toFixed(0) + "%");
    }
    if (/回测偏弱/.test(clean(backtest && backtest.verdict))) buyNoteParts.push("回测偏弱，仓位只给试错");
    else if (/回测/.test(clean(backtest && backtest.verdict))) buyNoteParts.push("回测结果一般，先按小仓位执行");
    else if (decisionKey === "混沌" || decisionKey === "冰点") buyNoteParts.push("今天强度能看，但明日要等回流确认");
    else buyNoteParts.push("只在确认后参与，不抢第一口");

    const buyAuctionLines = [];
    if (decisionKey === "主升") {
      buyAuctionLines.push("开盘价 > " + upStrong.toFixed(2) + " (+" + strongPct + "%) → 超预期:不追,只观察竞价承接与板块响应能否继续确认");
      buyAuctionLines.push("开盘价 ≥ " + upNormal.toFixed(2) + " (+" + normalPct + "%) → 符合:可跟随,优先看板块共振");
      buyAuctionLines.push(downWeak.toFixed(2) + " ~ " + upNormal.toFixed(2) + " (" + weakPct + "%~+" + normalPct + "%) → 灰区:等分时承接再定");
      buyAuctionLines.push("开盘价 < " + downWeak.toFixed(2) + " (" + weakPct + "%) → 不及预期:先看是否回收,不硬接");
    } else if (decisionKey === "主升分歧") {
      buyAuctionLines.push("开盘价 > " + upStrong.toFixed(2) + " (+" + strongPct + "%) → 强势但不追,优先看回封是否成立");
      buyAuctionLines.push("开盘价 ≥ " + upNormal.toFixed(2) + " (+" + normalPct + "%) → 符合:看承接,可等分歧转强");
      buyAuctionLines.push(downWeak.toFixed(2) + " ~ " + upNormal.toFixed(2) + " (" + weakPct + "%~+" + normalPct + "%) → 灰区:只看盘中回流");
      buyAuctionLines.push("开盘价 < " + downWeak.toFixed(2) + " (" + weakPct + "%) → 不及预期:先降级,不要硬接");
    } else {
      buyAuctionLines.push("开盘价 > " + upNormal.toFixed(2) + " (+" + normalPct + "%) → 先不追,只等回流确认");
      buyAuctionLines.push(downWeak.toFixed(2) + " ~ " + upNormal.toFixed(2) + " (" + weakPct + "%~+" + normalPct + "%) → 观察区:看板块回流和核心承接");
      buyAuctionLines.push("开盘价 < " + downWeak.toFixed(2) + " (" + weakPct + "%) → 直接降级,不把试错当接力");
      buyAuctionLines.push("只有出现分歧转强 / 回封 / 低位承接,才允许小仓");
    }

    if (chaosLargeDivergenceGate) {
      buyPlanParts.length = 0;
      buyPlanParts.push("混沌期大分歧后，明日默认分歧延续；10:50前只观察本票与主线核心，不执行回流买入。");
      buyNoteParts.length = 0;
      buyNoteParts.push("这是收盘后生成的次日条件预案；盘中只验证或取消，不临时新选股");
      buyAuctionLines.length = 0;
      buyAuctionLines.push("10:50前 → 禁止提前博弈回流，累计观察整个早盘分歧力度");
      buyAuctionLines.push("10:50负反馈收敛且主线核心持续修复 → 仅将原预案升级为可评估执行");
      buyAuctionLines.push("10:50分歧未收敛/无资金修复 → 取消当日计划，最早评估窗口后移一个交易日");
    }

    const sellHard = hardPriceRange;
    const breakEvenPrice = round2(basePrice * 1.03);
    const closeLine = ma5 ? "14:55 现价 < " + round2(ma5).toFixed(2) + " (MA5) → 收盘清" : "14:55 现价 < MA5 → 收盘清";
    const intradayPullback = decisionKey === "主升"
      ? "从当日高点回撤 3%-5% 且分时承接不回均价线 5 分钟以上 → 先减仓；若只是正常换手，不急着全砍"
      : decisionKey === "主升分歧"
        ? "从当日高点回撤 3%-5% 且板块不再共振 → 先卖第一笔；若再次回封/回流，减仓节奏放慢"
        : decisionKey === "混沌"
          ? "从当日高点回撤 2%-4% 且不能重新站回分时均价线 → 直接降仓；混沌里别把试错当接力"
          : decisionKey === "冰点"
              ? "只要核心修复没兑现且反抽不过分时均价线 → 先走；等真正修复再回看"
              : "回撤失去承接就先减，不要等最后一棒";
    const stopRangeText = hardRange[0] + "%~" + hardRange[1] + "%";
    const takeRangeText = takeRange[0] + "%~" + takeRange[1] + "%";
    const splNote = (stock && stock.stopLossPlan && stock.stopLossPlan.mode ? stock.stopLossPlan.mode : "趋势") + "模式：止损" + stopRangeText + "，止盈" + takeRangeText + "，盈亏比" + (stock && stock.stopLossPlan && stock.stopLossPlan.riskReward ? stock.stopLossPlan.riskReward : "未给出");

    const slotLabel = chaosLargeDivergenceGate
      ? "10:50观察"
      : decisionKey === "主升"
      ? (roleAuthority.cycleLeader ? "进攻首选" : roleAuthority.rollingCapacity ? "稳健承接" : "弹性备选")
      : decisionKey === "主升分歧"
        ? (roleAuthority.coreAuthorized ? "核心承接" : "分歧观察")
        : decisionKey === "混沌"
          ? (roleAuthority.coreAuthorized ? "回流首选" : (/首板|二板|低位/.test(clean(stock && stock.setup)) ? "试错备选" : "观察备选"))
          : decisionKey === "冰点"
              ? (roleAuthority.coreAuthorized ? "核心修复" : "低位试错")
              : "承接观察";

    const currentWhy = [];
    currentWhy.push("方向：" + (focusLabel || mainLabel || "当前方向") + (supportLabel && supportLabel !== focusLabel ? " / " + supportLabel : "") + "。");
    if (focusReason) currentWhy.push(focusReason);
    if (leadership) {
      currentWhy.push(
        `主动性：${clean(leadership.initiative && leadership.initiative.label || "待确认")} ${toNum(leadership.initiative && leadership.initiative.score)}/100；`
        + `${clean(leadership.identity || leadership.levelLabel || "地位待确认")}；结构${clean(leadership.structure && leadership.structure.grade || "--")}。`,
      );
      if (tomorrowDecision && tomorrowDecision.tomorrowEntryQualified) {
        currentWhy.push(`明日资格：${clean(tomorrowDecision.stateLabel)}；${clean(tomorrowDecision.actionLabel)}。`);
      } else {
        currentWhy.push(`交易资格：${clean(leadership.tradeState || "仅观察")}；${clean(leadership.executionNote || "等待验证")}。`);
      }
    }
    currentWhy.push("角色：" + role + "，" + setup + "。");
    currentWhy.push(cycleNote + "。");
    if (stock && stock.marketCapCarrier && stock.marketCapCarrier.reason) {
      currentWhy.push("市值载体观察：" + stock.marketCapCarrier.reason + "该项不参与评分或交易权限。");
    }
    const flowNature = stock && stock.flowNature && typeof stock.flowNature === "object"
      ? stock.flowNature
      : null;
    const flowPrefix = flowNature && flowNature.label
      ? `${flowNature.label}${flowNature.key === "realization" ? "（非出逃）" : ""}；`
      : "";
    currentWhy.push("资金：" + flowPrefix + "换手 " + (toNum(stock && stock.turnoverRate) ? round2(stock.turnoverRate).toFixed(2) + "%" : "缺") + "，量比 " + (toNum(stock && stock.volumeRatio) ? round2(stock.volumeRatio).toFixed(2) : "缺") + "，主力净流入 " + (toNum(stock && stock.mainInflowYi) ? round2(stock.mainInflowYi).toFixed(2) + "亿" : "缺") + "。");
    if (surv.note) currentWhy.push("历史记忆：" + surv.note + "。");
    if (backtest) currentWhy.push("回测：" + clean(backtest.verdict || "未知") + "，次日胜率 " + round2(backtest.winRate3d || 0).toFixed(0) + "%。");

    const bestPick = {
      executionVersion: 3,
      code,
      name: clean(stock && stock.name) || code || "--",
      tradeQualified: Boolean(leadership && leadership.tradeQualified === true),
      hardGate: stock && stock.hardGate && typeof stock.hardGate === "object"
        ? { ...stock.hardGate, pass: stock.hardGate.pass === true }
        : { pass: false, hardFails: ["候选个股硬门槛数据缺失"] },
      role,
      roleAuthority,
      slotLabel: tomorrowDecision && tomorrowDecision.tomorrowEntryQualified
        ? "明日可博弈"
        : leadership ? clean(leadership.tradeState || slotLabel) : slotLabel,
      score,
      factorDecision: factorDecisionByStock.get(stock) || null,
      mainConcept: clean(stock && stock.mainConcept) || mainLabel || "未归类",
      board,
      changePct: round2(changePct),
      price: round2(basePrice),
      priceSource: priceResolution.source,
      priceIntegrity: priceResolution,
      executionReplayRule: {
        version: 1,
        authority: "canonical_next_day_trigger_window_v1",
        calibrated: false,
        referencePrice: basePrice || null,
        earliestTime: chaosLargeDivergenceGate ? "10:50" : "09:35",
        latestTime: chaosLargeDivergenceGate ? "11:00" : "10:00",
        maxGapPct: normalPct,
        requirePositiveAmount: true,
        requireAboveAveragePrice: decisionKey === "主升" || decisionKey === "主升分歧",
        executionAuthority: false,
        rule: "仅供历史分钟回放；盘中仍需统一决策链保持授权",
      },
      marketCapCarrier: stock && stock.marketCapCarrier && typeof stock.marketCapCarrier === "object"
        ? stock.marketCapCarrier
        : null,
      why: currentWhy.filter(Boolean),
      buy: {
        mode: chaosLargeDivergenceGate ? "观察——10:50前不执行" : mode,
        plan: buyPlanParts.join(" "),
        auctionLines: buyAuctionLines,
        note: buyNoteParts.join("；"),
      },
      sell: {
        hardStop: {
          pctRange: hardRange,
          priceRange: sellHard,
          note: (is20cm(stock) && /情绪龙头票/.test(tickerType) ? "20cm 情绪票止损 -10%~-12%——不可谈判,触线即走;以当前快照为基准参考,实际买入后按买入价重算" : "按当前快照基准重算,跌破就先走") + "；当前以" + (basePrice ? basePrice.toFixed(2) : "买入价") + "为参考",
        },
        breakEven: {
          pct: 3,
          price: breakEvenPrice,
          rule: "浮盈站上此价后武装保本(止损上移至成本);以昨收为基准参考,实际买入后按买入价重算",
        },
        closeLine: {
          ma5: ma5 || null,
          rule: closeLine,
        },
        intradayPullback,
        splNote,
      },
      focusDirection: focusLabel,
      supportDirection: supportLabel,
      decisionKey: executionCycle,
      strategyKey: decisionKey,
      smallCycle: subPhase || null,
      leadership: leadership ? {
        level: leadership.level,
        levelLabel: leadership.levelLabel,
        identity: leadership.identity,
        anchorType: leadership.anchorType,
        coreIdentityQualified: Boolean(leadership.coreIdentityQualified),
        tradeQualified: leadership.tradeQualified === true,
        tomorrowEntryQualified: Boolean(tomorrowDecision && tomorrowDecision.tomorrowEntryQualified),
        tradeState: leadership.tradeState,
        executionNote: leadership.executionNote,
        initiative: leadership.initiative,
        structure: leadership.structure,
      } : null,
      tomorrowExecution: tomorrowDecision ? {
        bucket: tomorrowDecision.bucket,
        stateLabel: tomorrowDecision.stateLabel,
        actionLabel: tomorrowDecision.actionLabel,
        tomorrowEntryQualified: Boolean(tomorrowDecision.tomorrowEntryQualified),
        rank: tomorrowDecision.rank,
        evidence: Array.isArray(tomorrowDecision.evidence) ? tomorrowDecision.evidence.slice() : [],
        triggers: Array.isArray(tomorrowDecision.triggers) ? tomorrowDecision.triggers.slice() : [],
        cancelConditions: Array.isArray(tomorrowDecision.cancelConditions) ? tomorrowDecision.cancelConditions.slice() : [],
      } : null,
      flowNature: stock && stock.flowNature || null,
      note: noteParts.join("；"),
      cycle: executionCycle,
    };
    const rankedPick = { ...bestPick, turnoverRate: round2(toNum(stock && stock.turnoverRate)) };
    rankedPicks.push(rankedPick);

    if (decisionKey === "混沌" && roleAuthority.cycleLeader) {
      if (score > topLeaderScore) {
        topLeaderScore = score;
        topLeaderBest = rankedPick;
      }
    }

    if (!best || score > best.score || (score === best.score && round2(changePct) > round2(best.changePct)) || (score === best.score && round2(changePct) === round2(best.changePct) && toNum(stock && stock.turnoverRate) > toNum(best && best.turnoverRate))) {
      best = rankedPick;
    }
  });

  if (rankingStudy) {
    const validationPicks = rankedPicks
      .slice()
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.changePct !== a.changePct) return round2(toNum(b.changePct)) - round2(toNum(a.changePct));
        return toNum(b.turnoverRate) - toNum(a.turnoverRate);
      });
    return applyBestPickPriceIntegrity({
      executionVersion: 3,
      validationOnly: true,
      studyScope: "relative_ranking_same_legacy_shortlist",
      available: validationPicks.length > 0,
      picks: validationPicks,
      note: validationPicks.length
        ? "仅用于历史排序有效性研究：固定旧 selected 短名单，绕过市场执行许可，但保留个股三层因子硬门槛；不得解释为可执行信号。"
        : "旧 selected 短名单没有标的通过当前个股三层因子硬门槛。",
      detailedPhase,
      factorUniverse: {
        source: "legacy_selected",
        sourceCount: legacyPool.length,
        rankedCount: validationPicks.length,
        executionAuthority: false,
      },
    }, candidates);
  }

  if (decisionKey === "混沌" && topLeaderBest && (!best || !best.roleAuthority || best.roleAuthority.cycleLeader !== true)) {
    best = topLeaderBest;
  }

  if (!best) {
    return {
      executionVersion: 3,
      available: false,
      picks: [],
      note: "今天没有筛出明日可执行候选，宁缺毋滥；强势核心只做溢价验证，不拿观察票补位",
      detailedPhase,
      marketPlan,
      watchlist: coreWatchlist,
      premiumWatch: tomorrowExecution.premiumWatch,
      riskWatch: tomorrowExecution.riskWatch,
      executionCounts: tomorrowExecution.counts,
      scenarioPlans: hardenScenarioPlans(tomorrowExecution.scenarioPlans),
    };
  }

  const orderedPicks = [];
  const pushUniquePick = (pick) => {
    if (!pick) return;
    const code = clean(pick.code);
    if (!code) return;
    if (orderedPicks.some((item) => clean(item.code) === code)) return;
    orderedPicks.push(pick);
  };

  if (leadershipReady) {
    const activePriority = rankedPicks.slice().sort((a, b) => {
      const executionDiff = Number(b.tomorrowExecution && b.tomorrowExecution.rank || 0)
        - Number(a.tomorrowExecution && a.tomorrowExecution.rank || 0);
      if (executionDiff) return executionDiff;
      return Number(b.score || 0) - Number(a.score || 0);
    });
    best = activePriority[0] || best;
    activePriority.forEach(pushUniquePick);
  } else {
    const prioritySeeds = [];
    const pushPrioritySeed = (seed) => {
      const code = clean(seed && seed.code);
      if (!code) return;
      const pick = rankedPicks.find((item) => clean(item.code) === code);
      if (pick && !prioritySeeds.some((item) => clean(item.code) === code)) prioritySeeds.push(pick);
    };
    const topicMainLine = topicBoard && topicBoard.mainLine ? topicBoard.mainLine : null;
    if (topicMainLine) {
      pushPrioritySeed(topicMainLine.leader);
      pushPrioritySeed(topicMainLine.zhongjun);
      pushPrioritySeed(topicMainLine.lowLevel);
      if (Array.isArray(topicMainLine.leaders)) topicMainLine.leaders.slice(0, 3).forEach(pushPrioritySeed);
    }
    if (prioritySeeds.length) {
      best = prioritySeeds[0];
      prioritySeeds.forEach(pushUniquePick);
    }
    pushUniquePick(best);
  }
  rankedPicks
    .slice()
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.changePct !== a.changePct) return round2(toNum(b.changePct)) - round2(toNum(a.changePct));
      return toNum(b.turnoverRate) - toNum(a.turnoverRate);
    })
    .forEach(pushUniquePick);

  const strictOrderedPicks = orderedPicks.filter((pick) => strictExecutionFailureReasons(pick).length === 0);
  // 这里只形成最多5只的个股硬门槛结果池；最终参与价值与仓位配比
  // 由 unified decision chain 统一生成，任何上游关闭都必须把该池清空。
  const topPicks = strictOrderedPicks.slice(0, 5);
  const strictScenarioPlans = hardenScenarioPlans(tomorrowExecution.scenarioPlans, strictOrderedPicks);

  if (!topPicks.length) {
    return applyBestPickPriceIntegrity({
      executionVersion: 3,
      available: false,
      picks: [],
      note: "当前候选未同时通过明日资格、个股交易资格、核心地位和硬门槛，只保留观察，不生成可执行方案。",
      detailedPhase,
      marketPlan,
      watchlist: coreWatchlist,
      premiumWatch: tomorrowExecution.premiumWatch,
      riskWatch: tomorrowExecution.riskWatch,
      executionCounts: tomorrowExecution.counts,
      scenarioPlans: strictScenarioPlans,
      executionGate: {
        active: true,
        scope: "executionVersion>=3",
        label: "v3四道执行门槛未全部通过",
      },
    }, candidates);
  }
  const primaryPick = topPicks[0];

  const caution = chaosLargeDivergenceGate
    ? "混沌期大分歧：明日默认分歧延续，10:50前不执行回流计划；无修复则评估窗口后移一个交易日。"
    : decisionKey === "混沌" || decisionKey === "冰点" || decisionKey === "震荡"
      ? `${executionCycle}按回流与承接预期选，今天最强不直接等于明日最优解；优先看 ${focusLabel || "当前方向"} 的核心与低位试错。`
    : decisionKey === "主升分歧"
      ? "主升里的高位分歧，仍以主线核心和中军为先，不把当日最强简单等同于明日答案。"
      : "主升期可以做今天最强的接力，但只做主线核心/中军，不追纯兑现。";

  return applyBestPickPriceIntegrity({
    executionVersion: 3,
    available: true,
    picks: topPicks,
    // 内部决策池可大于页面结果上限，统一决策链完成赚钱效应、题材和模式交集后
    // 再从中输出最多5只，避免前5只被上游交集剔除后漏掉后续合格股票。
    decisionPool: strictOrderedPicks.slice(0, 20),
    marketPlan,
    watchlist: coreWatchlist,
    focusDirection: focusLabel,
    supportDirection: supportLabel,
    note: [caution, strategy.note, primaryPick.note].filter(Boolean).join(" "),
    detailedPhase, // 详细周期阶段
    detailedPhaseReasons: detailedPhaseInfo.reasons, // 阶段判断理由
    strategyFocus: strategy.focus, // 策略焦点
    executionGate: chaosLargeDivergenceGate
      ? {
          active: true,
          scope: "仅混沌期",
          label: "大分歧次日·10:50前不执行",
          checkpoint: "10:50",
          action: "无明显修复则取消当日回流计划，评估窗口后移一个交易日",
        }
      : { active: false },
    premiumWatch: tomorrowExecution.premiumWatch,
    riskWatch: tomorrowExecution.riskWatch,
    executionCounts: tomorrowExecution.counts,
    scenarioPlans: strictScenarioPlans,
    pools: { // 各池明细（前5）
      todayStrong: todayStrongPool.slice(0, 5).map(s => ({ code: s.code, name: s.name, score: s.poolScore, reason: s.poolReason })),
      reflow: reflowPool.slice(0, 5).map(s => ({ code: s.code, name: s.name, score: s.poolScore, reason: s.poolReason })),
      mainLine: mainLinePool.slice(0, 5).map(s => ({ code: s.code, name: s.name, score: s.poolScore, reason: s.poolReason })),
      lowPosition: lowPositionPool.slice(0, 5).map(s => ({ code: s.code, name: s.name, score: s.poolScore, reason: s.poolReason })),
      survivor: survivorPool.slice(0, 5).map(s => ({ code: s.code, name: s.name, score: s.poolScore, reason: s.poolReason }))
    }
  }, candidates);
}
function buildFetchStatus(ctx) {
















  const items = [];
  const supplementalKline = ctx.klineSupplemental && typeof ctx.klineSupplemental === "object"
    ? ctx.klineSupplemental : null;
  const hasExplicitKlineQuality = Number.isFinite(Number(ctx.klineRequested));
  const klineRequested = hasExplicitKlineQuality
    ? Math.max(0, Number(ctx.klineRequested)) : Math.max(0, Number(ctx.total || 0));
  const klineEast = Math.max(0, Number(ctx.klineEast || 0));
  const klineTencent = Math.max(0, Number(ctx.klineTencent || 0));
  const klineLiveResponses = klineEast + klineTencent;
  const klineLive = Number.isFinite(Number(ctx.klineLiveAccepted))
    ? Math.max(0, Number(ctx.klineLiveAccepted)) : klineLiveResponses;
  const klineSameDayCache = Math.max(0, Number((ctx.klineSameDayCache ?? ctx.klineCached) || 0));
  const klineUnavailable = hasExplicitKlineQuality
    ? Math.max(0, Number(ctx.klineUnavailable || 0))
    : Math.max(0, klineRequested - Math.max(0, Number(ctx.klineOk || 0)));
  const klineResolved = klineLive + klineSameDayCache;
  const klineStatusKey = !hasExplicitKlineQuality
    ? "legacy_unannotated"
    : klineUnavailable > 0 || klineResolved < klineRequested
      ? "unavailable"
      : klineSameDayCache > 0
        ? "degraded_same_day_cache"
        : "live_complete";
  const klineOperationalDegraded = klineStatusKey === "degraded_same_day_cache";
  const klineEligible = hasExplicitKlineQuality
    ? klineStatusKey !== "unavailable" && klineRequested > 0
    : Number(ctx.klineOk || 0) > 0;
  const klineNote = !hasExplicitKlineQuality ? "" : klineStatusKey === "live_complete"
    ? `实时K线完整：${klineLive}/${klineRequested}只`
    : klineStatusKey === "degraded_same_day_cache"
      ? `实时${klineLive}/${klineRequested}只；${klineSameDayCache}只使用${ctx.expectedCompletedKlineDate || "同交易日"}已验证缓存`
      : `仅${klineResolved}/${klineRequested}只取得合格K线；${klineUnavailable}只不可用，旧缓存已拒绝`;
  const klineDetails = {
    authority: "market_candidate_kline_scope",
    supplementalObservationExcluded: true,
    marketScope: {
      authority: "market_candidate_kline_scope",
      affectsClosingDecision: true,
      requestedCount: klineRequested,
      liveCount: klineLive,
      sameDayCacheCount: klineSameDayCache,
      unavailableCount: klineUnavailable,
      liveFailureCount: Math.max(0, Number(ctx.klineLiveFailed || 0)),
      eligibleForClosingDecision: klineEligible,
    },
    supplementalScope: supplementalKline ? {
      authority: "observation_only_supplemental_kline_scope",
      affectsClosingDecision: false,
      observationOnly: true,
      executionAuthority: false,
      requestedCount: Math.max(0, Number(supplementalKline.requested || 0)),
      liveCount: Math.max(0, Number(supplementalKline.liveAccepted || 0)),
      sameDayCacheCount: Math.max(0, Number(supplementalKline.sameDayCache || supplementalKline.cached || 0)),
      unavailableCount: Math.max(0, Number(supplementalKline.unavailable || 0)),
    } : null,
    statusKey: klineStatusKey,
    degraded: klineOperationalDegraded,
    liveComplete: klineStatusKey === "live_complete",
    eligibleForClosingDecision: klineEligible,
    requestedCount: klineRequested,
    marketCandidateCount: Math.max(0, Number(ctx.total || 0)),
    liveCount: klineLive,
    liveResponseCount: klineLiveResponses,
    eastmoneyCount: klineEast,
    tencentCount: klineTencent,
    sameDayCacheCount: klineSameDayCache,
    staleCacheRejectedCount: Math.max(0, Number(ctx.klineStaleCacheRejected || 0)),
    unavailableCount: klineUnavailable,
    liveFailureCount: Math.max(0, Number(ctx.klineLiveFailed || 0)),
    expectedCompletedTradingDate: ctx.expectedCompletedKlineDate || null,
    cacheTradingDates: ctx.klineCacheTradingDates && typeof ctx.klineCacheTradingDates === "object"
      ? { ...ctx.klineCacheTradingDates } : {},
    cacheMaxAgeMinutes: Number.isFinite(Number(ctx.klineCacheMaxAgeMinutes))
      ? Number(ctx.klineCacheMaxAgeMinutes) : null,
    sourceErrorSamples: Array.isArray(ctx.klineSourceErrorSamples)
      ? ctx.klineSourceErrorSamples.slice(0, 12) : [],
  };















  const push = (name, ok, note, details = {}) => items.push({ name, ok, note, ...details });















  const legacyRankMeta = (provider, rows) => ({
    provider,
    targetCount: HOT_RANK_TARGET,
    actualCount: Array.isArray(rows) ? rows.length : 0,
    complete: Array.isArray(rows) && rows.length === HOT_RANK_TARGET,
    freshness: "unverified",
    sourceQuality: "legacy-unannotated",
  });
  const eastRankMeta = publicRankMeta(ctx.rankSources && ctx.rankSources.eastmoney || legacyRankMeta("东方财富热榜", ctx.eastRank));
  const thsRankMeta = publicRankMeta(ctx.rankSources && ctx.rankSources.ths || legacyRankMeta("同花顺热榜", ctx.thsRows));
  push("东财热榜", ctx.eastRank.length > 0, rankStatusNote(eastRankMeta), eastRankMeta || {});















  push("同花顺热榜", ctx.thsRows.length > 0, rankStatusNote(thsRankMeta), thsRankMeta || {});















  push(















    "东财报价",















    ctx.brokenRows.length === 0,















    ctx.brokenRows.length ? `${ctx.brokenRows.length}只补全失败已剔除（含热榜前排）` : "完整",















  );















  push(















    "K线/均线",















    klineEligible,















    klineNote || (`${ctx.klineOk}/${ctx.total}只成功` +















      (ctx.klineTencent ? `（其中${ctx.klineTencent}只走腾讯兜底，成交额为估算）` : "") +

      (ctx.klineCached ? `（${ctx.klineCached}只使用最近有效K线缓存）` : "") +















      (ctx.klineOk === 0 ? "——趋势硬筛选全部降级为⚠️待补" : "")),
    klineDetails,















  );















  push(















    "板块行情",















    ctx.sectorRows.length > 0,















    ctx.sectorRows.length ? `${ctx.sectorRows.length}个板块` : "失败——共振/风险栏降级为未验证，不作剔除依据",















  );















  const snapLive = ctx.marketSnapshot.source === "eastmoney-live";















  push(















    "大盘快照",















    snapLive,















    snapLive















      ? `实时·两市${ctx.marketSnapshot.shszAmountYi}亿`















      : `来自缓存(${ctx.marketSnapshot.source || "无"}${ctx.marketSnapshot.asOf ? "·" + String(ctx.marketSnapshot.asOf).slice(0, 16) : ""})，成交额${ctx.marketSnapshot.shszAmountYi}亿可能过时`,















  );















  push(















    "涨跌停统计",















    Boolean(ctx.limitStats && ctx.limitStats.ztToday != null),















    ctx.limitStats ? `${ctx.limitStats.source === "ths" ? "同花顺" : "东财"}口径` : "失败",















  );















  push("外围指数", Boolean(ctx.externalSnapshot && ctx.externalSnapshot.available), ctx.externalSnapshot && ctx.externalSnapshot.available ? "正常" : "失败");































  if (supplementalKline && Number(supplementalKline.requested || 0) > 0) {
    const requested = Math.max(0, Number(supplementalKline.requested || 0));
    const live = Math.max(0, Number(supplementalKline.liveAccepted || 0));
    const cached = Math.max(0, Number(supplementalKline.sameDayCache || supplementalKline.cached || 0));
    const unavailable = Math.max(0, Number(supplementalKline.unavailable || 0));
    push(
      "T-1补充观察K线",
      true,
      unavailable > 0
        ? `${live + cached}/${requested}只取得当日合格K线；${unavailable}只仅关闭自身观察资格，不影响市场大周期`
        : `${requested}/${requested}只补充观察K线可用`,
      {
        degraded: unavailable > 0,
        observationOnly: true,
        executionAuthority: false,
        marketEvidenceImpact: false,
        requestedCount: requested,
        liveCount: live,
        sameDayCacheCount: cached,
        unavailableCount: unavailable,
        staleCacheRejectedCount: Math.max(0, Number(supplementalKline.staleCacheRejected || 0)),
        sourceErrorSamples: Array.isArray(supplementalKline.sourceErrorSamples)
          ? supplementalKline.sourceErrorSamples.slice(0, 12) : [],
      },
    );
  }

  const failed = items.filter((item) => !item.ok);
  const degraded = items.filter((item) => item.degraded === true);















  const level = failed.length === 0
    ? degraded.length ? "partial" : "ok"
    : failed.length <= 2 ? "partial" : "fail";
  const operationalLevel = failed.length ? level : degraded.length ? "degraded" : "live";















  return {















    level,
    operationalLevel,
    mode: klineStatusKey,
    evidenceStatus: failed.length ? "incomplete" : klineEligible ? "complete" : "unavailable",
    kline: { ...klineDetails },
    supplementalKline: supplementalKline ? {
      authority: "observation_only_supplemental_kline_scope",
      observationOnly: true,
      executionAuthority: false,
      marketEvidenceImpact: false,
      requestedCount: Math.max(0, Number(supplementalKline.requested || 0)),
      liveCount: Math.max(0, Number(supplementalKline.liveAccepted || 0)),
      sameDayCacheCount: Math.max(0, Number(supplementalKline.sameDayCache || supplementalKline.cached || 0)),
      unavailableCount: Math.max(0, Number(supplementalKline.unavailable || 0)),
    } : null,















    label:















      level === "ok"















        ? degraded.length
          ? `⚠️ 数据可用但部分来源降级：${degraded.map((item) => item.name).join("、")}`
          : "✓ 本次抓取：实时数据完整"















        : level === "partial"















          ? `⚠️ 本次抓取降级：${(failed.length ? failed : degraded).map((item) => item.name).join("、")}`















          : `✗ 本次抓取多源失败（${failed.map((item) => item.name).join("、")}），周期/仓位结论仅供参考`,















    items,















    unclassified: ctx.unclassified || 0,















  };















}































function expectedCompletedKlineTradingDate(limitStats, now = new Date()) {
  const dates = limitStats && typeof limitStats === "object" && limitStats.dates
    && typeof limitStats.dates === "object" ? limitStats.dates : {};
  if (dates.verified !== true) return null;
  const marketDate = normalizeTradingDate(dates.today);
  const previousDate = normalizeTradingDate(dates.prev);
  if (!marketDate) return previousDate || null;
  const clock = shanghaiClockParts(now);
  const marketDateIsToday = Boolean(clock && clock.date === marketDate);
  const completedDailyBarAvailable = Boolean(clock && (clock.hour * 60 + clock.minute) >= 15 * 60 + 5);
  if (marketDateIsToday && !completedDailyBarAvailable) return previousDate || null;
  return marketDate;
}

function assessCachedKlineProfile(profile, options = {}) {
  const source = profile && typeof profile === "object" ? profile : null;
  const expectedTradingDate = normalizeTradingDate(options.expectedTradingDate);
  const actualTradingDate = normalizeTradingDate(
    source && source.lastSession && source.lastSession.tradingDate
      || source && source.recentLimitUp && source.recentLimitUp.completedTradingDate
      || source && source.lastTradingDate,
  );
  const lineage = source && source.dataLineage && typeof source.dataLineage === "object"
    ? source.dataLineage : {};
  const capturedAt = String(lineage.fetchedAt || lineage.capturedAt || "").trim() || null;
  const capturedAtMs = capturedAt ? Date.parse(capturedAt) : NaN;
  const nowMs = options.now instanceof Date ? options.now.getTime() : Date.now();
  const cacheAgeMinutes = Number.isFinite(capturedAtMs)
    ? Math.max(0, Math.round(((nowMs - capturedAtMs) / 60000) * 10) / 10)
    : null;
  const lastSession = source && source.lastSession && typeof source.lastSession === "object"
    ? source.lastSession : {};
  const completedSessionValid = lastSession.verified === true
    && lastSession.completed === true
    && Number.isFinite(Number(lastSession.close))
    && Number(lastSession.close) > 0;
  const lastCloseValid = Number.isFinite(Number(source && source.lastClose))
    && Number(source && source.lastClose) > 0;
  const matureStructureValid = source && source.isNewListing === true
    ? Number.isFinite(Number(source.recentWeightedCost || source.lastClose))
    : [source && source.ma5, source && source.ma10, source && source.ma20]
      .every((value) => Number.isFinite(Number(value)) && Number(value) > 0);
  const trendComparable = lineage.trendComparable !== false;
  const evidenceComplete = Boolean(completedSessionValid && lastCloseValid && matureStructureValid && trendComparable);
  let status = "unavailable";
  let usable = false;
  let reason = "缓存K线不存在";
  if (source && !expectedTradingDate) {
    status = "cache_date_unverified";
    reason = "缺少本轮应完成交易日，拒绝缓存接管";
  } else if (source && !actualTradingDate) {
    status = "cache_date_missing";
    reason = "缓存K线缺少完成交易日，拒绝接管";
  } else if (source && actualTradingDate === expectedTradingDate && !evidenceComplete) {
    status = "same_day_cache_incomplete";
    reason = `缓存交易日匹配${expectedTradingDate}，但收盘会话或关键画像不完整，拒绝接管`;
  } else if (source && actualTradingDate === expectedTradingDate) {
    status = "same_day_cache";
    usable = true;
    reason = `缓存对应本轮应完成交易日${expectedTradingDate}`;
  } else if (source && actualTradingDate > expectedTradingDate) {
    status = "future_cache_rejected";
    reason = `缓存交易日${actualTradingDate}晚于本轮应完成交易日${expectedTradingDate}`;
  } else if (source) {
    status = "stale_cache_rejected";
    reason = `缓存交易日${actualTradingDate || "缺失"}不等于本轮应完成交易日${expectedTradingDate}`;
  }
  return {
    status,
    usable,
    expectedTradingDate: expectedTradingDate || null,
    actualTradingDate: actualTradingDate || null,
    capturedAt,
    cacheAgeMinutes,
    evidenceComplete,
    trendComparable,
    reason,
  };
}

function loadKlineProfileCache() {
  const seed = readJsonFile(klineProfileSeedFile) || {};
  const runtime = readJsonFile(klineProfileCacheFile) || {};
  const decorate = (profiles, cacheOrigin) => Object.fromEntries(
    Object.entries(profiles && typeof profiles === "object" ? profiles : {}).map(([code, profile]) => {
      const source = profile && typeof profile === "object" ? profile : {};
      const lineage = source.dataLineage && typeof source.dataLineage === "object"
        ? source.dataLineage : {};
      return [code, {
        ...source,
        dataLineage: {
          version: 1,
          ...lineage,
          mode: lineage.mode || "legacy_cache",
          source: lineage.source || cacheOrigin,
          fetchedAt: lineage.fetchedAt || null,
          tradingDate: lineage.tradingDate
            || source.lastSession && source.lastSession.tradingDate
            || source.lastTradingDate
            || null,
          cacheOrigin,
        },
      }];
    }),
  );
  return {
    ...decorate(seed.profiles, "seed_cache"),
    ...decorate(runtime.profiles, "runtime_cache"),
  };
}

function persistFreshKlineProfiles(rows) {
  const freshProfiles = Object.fromEntries(
    rows
      .filter((item) => item && item.code && item.klineProfile && !item.klineProfileCached)
      .map((item) => [String(item.code), item.klineProfile]),
  );
  if (!Object.keys(freshProfiles).length) return;
  writeJsonFile(klineProfileCacheFile, {
    updatedAt: new Date().toISOString(),
    profiles: {
      ...loadKlineProfileCache(),
      ...freshProfiles,
    },
  });
}

const INTRADAY_LEADERSHIP_TOTAL_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.INTRADAY_LEADERSHIP_TOTAL_TIMEOUT_MS || 12000),
);

function loadIntradayLeadershipEvidence(tradingDate) {
  const date = String(tradingDate || "").trim();
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) return new Map();
  const cache = readJsonFile(intradayLeadershipCacheFile) || {};
  const records = cache.dates && cache.dates[date] && typeof cache.dates[date] === "object"
    ? cache.dates[date] : {};
  return new Map(Object.entries(records).filter(([, summary]) => (
    summary
    && summary.tradingDate === date
    && Array.isArray(summary.rows)
    && summary.rows.length > 0
  )).map(([code, summary]) => [
    String(code),
    { ...normalizeIntradayEvidenceSummary(summary), cacheRestored: true },
  ]));
}

function persistIntradayLeadershipEvidence(tradingDate, evidence) {
  const date = String(tradingDate || "").trim();
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || !(evidence instanceof Map) || !evidence.size) return;
  const current = readJsonFile(intradayLeadershipCacheFile) || {};
  const dates = current.dates && typeof current.dates === "object" ? { ...current.dates } : {};
  const existing = dates[date] && typeof dates[date] === "object" ? { ...dates[date] } : {};
  evidence.forEach((summary, code) => {
    if (!summary || summary.tradingDate !== date || !Array.isArray(summary.rows) || !summary.rows.length) return;
    const previous = existing[code];
    const previousMinute = timeToMinutes(previous && previous.asOf);
    const currentMinute = timeToMinutes(summary.asOf);
    if (previous && Number.isFinite(previousMinute) && Number.isFinite(currentMinute) && previousMinute > currentMinute) return;
    existing[code] = { ...normalizeIntradayEvidenceSummary(summary), cacheRestored: false };
  });
  dates[date] = existing;
  Object.keys(dates).sort().slice(0, Math.max(0, Object.keys(dates).length - 10)).forEach((key) => delete dates[key]);
  writeJsonFile(intradayLeadershipCacheFile, {
    schemaVersion: 1,
    authority: "exact_date_intraday_leadership_evidence",
    updatedAt: new Date().toISOString(),
    dates,
  });
}

function tencentMinuteSymbol(stock) {
  return toTencentSymbol(stock && (stock.secCode || stock.code));
}

function observationRepresentativeLeadershipTargets(payload) {
  const candidates = Array.isArray(payload && payload.candidates) ? payload.candidates : [];
  const byCode = new Map(candidates.map((stock) => [String(stock && (stock.code || stock.secCode) || ""), stock]));
  const preference = payload && payload.premarketModels && payload.premarketModels.tradingStylePreference || {};
  const representatives = preference && preference.observationRepresentatives || {};
  const seen = new Set();
  return Object.values(representatives).flatMap((rows) => Array.isArray(rows) ? rows : [])
    .map((row) => byCode.get(String(row && (row.code || row.secCode) || "")))
    .filter((stock) => {
      const code = String(stock && (stock.code || stock.secCode) || "");
      if (!code || seen.has(code)) return false;
      seen.add(code);
      return true;
    });
}

function mergeLeadershipTargets(primary, secondary, limit = 30) {
  const seen = new Set();
  return [...(primary || []), ...(secondary || [])].filter((stock) => {
    const code = String(stock && (stock.code || stock.secCode) || "");
    if (!code || seen.has(code)) return false;
    seen.add(code);
    return true;
  }).slice(0, limit);
}

function leadershipEvidenceTargets(payload) {
  return mergeLeadershipTargets(
    selectLeadershipTargets(payload && payload.candidates || [], payload && payload.topicBoard || {}, 24),
    observationRepresentativeLeadershipTargets(payload),
    30,
  );
}

function summarizeIntradayEvidenceQuality(evidence) {
  const rows = evidence instanceof Map ? Array.from(evidence.values()) : [];
  const qualityCounts = {};
  const sourceCounts = { eastmoney: 0, tencent: 0, cache: 0 };
  let closingCompleteCount = 0;
  rows.forEach((raw) => {
    const summary = normalizeIntradayEvidenceSummary(raw);
    const key = String(summary && summary.evidenceQuality && summary.evidenceQuality.qualityKey || "unknown");
    qualityCounts[key] = Number(qualityCounts[key] || 0) + 1;
    if (summary && summary.evidenceQuality && summary.evidenceQuality.closingComplete) closingCompleteCount += 1;
    if (summary && summary.cacheRestored) sourceCounts.cache += 1;
    else if (summary && summary.source === "tencent_minute_query") sourceCounts.tencent += 1;
    else if (summary) sourceCounts.eastmoney += 1;
  });
  return {
    qualityCounts,
    sourceCounts,
    closingCompleteCount,
    partialSessionCount: rows.length - closingCompleteCount,
  };
}

async function fetchIntradayLeadershipProfiles(candidates, topicBoard, expectedTradingDate = "", sourceState = {}, options = {}) {
  const explicitTargets = Array.isArray(options.targets) ? options.targets.filter(Boolean) : [];
  const targets = explicitTargets.length
    ? mergeLeadershipTargets(explicitTargets, [], 30)
    : selectLeadershipTargets(candidates, topicBoard, 24);
  const result = new Map();
  const fresh = new Map();
  const cached = sourceState._skipIntradayCache
    ? new Map() : loadIntradayLeadershipEvidence(expectedTradingDate);
  const requestJson = typeof sourceState._intradayFetchJson === "function"
    ? sourceState._intradayFetchJson : fetchJson;
  const deadlineAt = Date.now() + INTRADAY_LEADERSHIP_TOTAL_TIMEOUT_MS;
  const chunks = [];
  for (let index = 0; index < targets.length; index += 4) chunks.push(targets.slice(index, index + 4));

  for (const chunk of chunks) {
    if (Date.now() >= deadlineAt || sourceState.intradayEastDisabled) break;
    const rows = await Promise.all(chunk.map(async (stock) => {
      const code = String(stock && (stock.code || stock.secCode) || "");
      if (!code || sourceState.intradayEastDisabled || Date.now() >= deadlineAt) return null;
      try {
        const secid = marketPrefix(stock.secCode || stock.code);
        const url = `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${encodeURIComponent(secid)}`
          + "&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13"
          + "&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0&iscca=0"
          + "&ut=7eea3edcaed734bea9cbfc24409ed989";
        const payload = await requestJson(url, {
          timeoutMs: Math.max(100, Math.min(6000, deadlineAt - Date.now())),
          deadlineAt,
          headers: { Referer: "https://quote.eastmoney.com/" },
        });
        const summary = parseIntradayTrendPayload(payload, stock.prevClose);
        if (summary && expectedTradingDate && summary.tradingDate !== expectedTradingDate) {
          return null;
        }
        return summary ? [code, { ...summary, fetchedAt: new Date().toISOString() }] : null;
      } catch {
        sourceState.intradayEastFailures = Number(sourceState.intradayEastFailures || 0) + 1;
        if (sourceState.intradayEastFailures >= 3) sourceState.intradayEastDisabled = true;
        return null;
      }
    }));
    rows.filter(Boolean).forEach(([code, summary]) => {
      result.set(code, summary);
      fresh.set(code, summary);
    });
  }

  const unresolved = targets.filter((stock) => {
    const code = String(stock && (stock.code || stock.secCode) || "");
    return code && !result.has(code);
  });
  const fallbackChunks = [];
  for (let index = 0; index < unresolved.length; index += 4) fallbackChunks.push(unresolved.slice(index, index + 4));
  for (const chunk of fallbackChunks) {
    if (Date.now() >= deadlineAt || sourceState.intradayTencentDisabled) break;
    const rows = await Promise.all(chunk.map(async (stock) => {
      const code = String(stock && (stock.code || stock.secCode) || "");
      const symbol = tencentMinuteSymbol(stock);
      if (!code || !symbol || Date.now() >= deadlineAt) return null;
      try {
        const payload = await requestJson(
          `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${encodeURIComponent(symbol)}`,
          {
            timeoutMs: Math.max(100, Math.min(5000, deadlineAt - Date.now())),
            deadlineAt,
            headers: { Referer: "https://gu.qq.com/" },
          },
        );
        const summary = parseTencentMinutePayload(payload, symbol, stock.prevClose);
        if (summary && expectedTradingDate && summary.tradingDate !== expectedTradingDate) return null;
        return summary ? [code, { ...summary, fetchedAt: new Date().toISOString() }] : null;
      } catch {
        sourceState.intradayTencentFailures = Number(sourceState.intradayTencentFailures || 0) + 1;
        if (sourceState.intradayTencentFailures >= 3) sourceState.intradayTencentDisabled = true;
        return null;
      }
    }));
    rows.filter(Boolean).forEach(([code, summary]) => {
      result.set(code, summary);
      fresh.set(code, summary);
    });
  }

  cached.forEach((summary, code) => {
    if (!result.has(code) && targets.some((stock) => String(stock && (stock.code || stock.secCode) || "") === code)) {
      result.set(code, summary);
    }
  });
  if (!sourceState._skipIntradayCache) persistIntradayLeadershipEvidence(expectedTradingDate, fresh);
  const qualitySummary = summarizeIntradayEvidenceQuality(result);
  sourceState.intradayLeadership = {
    authority: "exact_date_intraday_leadership_evidence",
    expectedTradingDate: expectedTradingDate || null,
    targetCount: targets.length,
    verifiedCount: result.size,
    missingCount: Math.max(0, targets.length - result.size),
    sourceCounts: qualitySummary.sourceCounts,
    qualityCounts: qualitySummary.qualityCounts,
    closingCompleteCount: qualitySummary.closingCompleteCount,
    partialSessionCount: qualitySummary.partialSessionCount,
    eastCircuitOpen: sourceState.intradayEastDisabled === true,
    tencentCircuitOpen: sourceState.intradayTencentDisabled === true,
  };
  return result;
}

function applyThemeDecisionToTopicBoard(topicBoard, themeLibrary) {
  if (!topicBoard || typeof topicBoard !== "object" || !themeLibrary || typeof themeLibrary !== "object") return topicBoard;
  const decision = themeLibrary.mainThemeDecision && typeof themeLibrary.mainThemeDecision === "object"
    ? themeLibrary.mainThemeDecision
    : null;
  if (!decision) return topicBoard;
  topicBoard.mainThemeDecision = decision;
  topicBoard.mainAttackSubtheme = decision.mainAttackSubtheme || null;
  topicBoard.conclusion = decision.conclusion || "今日暂无唯一主攻细分";
  const familyName = String(decision.family && decision.family.name || "").trim();
  const targets = [
    topicBoard.mainLine,
    ...(Array.isArray(topicBoard.items) ? topicBoard.items.filter((item) => (
      String(item && (item.family || item.name) || "").trim() === familyName
    )) : []),
  ].filter(Boolean);
  targets.forEach((item) => {
    item.subthemeDecision = decision;
    item.mainAttackSubtheme = decision.mainAttackSubtheme || null;
    item.currentBestSubtheme = decision.currentBestSubtheme || null;
  });
  return topicBoard;
}

function hydrateTopicBoardLeadership(topicBoard, candidates) {
  if (!topicBoard || !Array.isArray(topicBoard.items) || !Array.isArray(candidates)) return topicBoard;
  const byCode = new Map(candidates.map((stock) => [String(stock && (stock.code || stock.secCode) || ""), stock]));
  const hydrate = (summary) => {
    if (!summary) return summary;
    const source = byCode.get(String(summary.code || summary.secCode || ""));
    if (!source || !source.leadership) return summary;
    summary.isDriver = Boolean(source.isDriver);
    summary.initiativeScore = Number.isFinite(Number(source.initiativeScore)) ? Number(source.initiativeScore) : null;
    summary.leadership = source.leadership;
    return summary;
  };
  const hydrateItem = (item) => {
    if (!item) return;
    item.leader = hydrate(item.leader);
    item.zhongjun = hydrate(item.zhongjun);
    item.lowLevel = hydrate(item.lowLevel);
    if (Array.isArray(item.leaders)) item.leaders = item.leaders.map(hydrate);
  };
  topicBoard.items.forEach(hydrateItem);
  hydrateItem(topicBoard.mainLine);
  return topicBoard;
}

function applyRepairCoreRetention(candidates) {
  if (!Array.isArray(candidates)) return candidates;
  const directionOnlyReject = /未形成相对强度|未与指数\/板块行情形成共振|该方向亏钱效应过大|一日游逻辑|不在东方财富\/同花顺热度榜/;
  candidates.forEach((stock) => {
    const leadership = stock && stock.leadership;
    if (!leadership || leadership.repairCoreQualified !== true) return;
    const before = Array.isArray(stock.rejects) ? stock.rejects : [];
    stock.rejects = before.filter((reason) => !directionOnlyReject.test(String(reason || "")));
    stock.repairCoreCandidate = true;
    stock.selected = false;
    if (!stock.setup || stock.setup === "剔除") stock.setup = "核心活口·次日验证";
    stock.reasons = Array.from(new Set([
      ...(Array.isArray(stock.reasons) ? stock.reasons : []),
      "核心方向修复发起者：当日负反馈与方向失效分开处理，保留到次日验证池",
      "当前仅获得观察资格；板块回流、个股承接与买点触发同时成立后才执行",
    ]));
  });
  return candidates;
}

function collectVerifiedInitiativeFloors(payload, tradingDate, result = new Map()) {
  if (!payload || marketEmotionTradingDate(payload) !== tradingDate || !Array.isArray(payload.candidates)) return result;
  payload.candidates.forEach((stock) => {
    const code = String(stock && (stock.code || stock.secCode) || "");
    const initiative = stock && stock.leadership && stock.leadership.initiative;
    if (!code || result.has(code) || !isClosingIntradayInitiative(initiative)) return;
    const score = Number(initiative.score);
    if (!Number.isFinite(score)) return;
    result.set(code, { ...initiative, evidence: Array.isArray(initiative.evidence) ? [...initiative.evidence] : [] });
  });
  return result;
}

function loadVerifiedInitiativeFloors(tradingDate) {
  const result = collectVerifiedInitiativeFloors(readJsonFile(hotStocksCacheFile), tradingDate);
  if (result.size || !tradingDate || !fs.existsSync(hotStocksCacheArchiveDir)) return result;
  try {
    const entries = fs.readdirSync(hotStocksCacheArchiveDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name.startsWith(tradingDate))
      .map((entry) => {
        const filePath = path.join(hotStocksCacheArchiveDir, entry.name);
        try { return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs }; } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 24);
    for (const entry of entries) {
      collectVerifiedInitiativeFloors(readJsonFile(entry.filePath), tradingDate, result);
      if (result.size) break;
    }
  } catch {
    // 历史分时证据读取失败时继续使用本轮数据，不阻断主抓取。
  }
  return result;
}

function verifiedInitiativeFloorsForPayload(payload, tradingDate) {
  // 先保留本轮内存中的真实分时证据，再补充磁盘缓存。这样在角色身份重算时，
  // 不会把刚抓到的“分时验证”降级成收盘路径代理。
  const result = collectVerifiedInitiativeFloors(payload, tradingDate, new Map());
  const persisted = loadVerifiedInitiativeFloors(tradingDate);
  persisted.forEach((value, code) => {
    if (!result.has(code)) result.set(code, value);
  });
  return result;
}

function hasCompleteLeadershipSchema(stock) {
  const leadership = stock && stock.leadership;
  return Boolean(
    leadership
    && Number(leadership.version || 0) >= LEADERSHIP_SCHEMA_VERSION
    && leadership.initiative && Number.isFinite(Number(leadership.initiative.score))
    && leadership.structure && typeof leadership.structure.frameworkIntact === "boolean"
    && Array.isArray(leadership.hardFails)
    && typeof leadership.coreIdentityQualified === "boolean"
    && typeof leadership.persistentRecognition === "boolean"
    && typeof leadership.repairCoreQualified === "boolean"
    && typeof leadership.tradeQualified === "boolean"
    && typeof leadership.coreQualified === "boolean"
    && leadership.tradeState
  );
}

function refreshMarketCapCarrier(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (!payload.market || typeof payload.market !== "object") payload.market = {};
  const regime = classifyMarketCapCarrierRegime(payload.market.snapshot || {});
  const allCandidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const candidates = excludePreviousLimitUpOnly(allCandidates);
  const observations = candidates.map((stock) => {
    const observation = observeStockMarketCapCarrier(stock, regime);
    if (stock && typeof stock === "object") stock.marketCapCarrier = observation;
    return observation;
  });
  let summary = summarizeMarketCapCarrier(regime, observations);
  const alignedObservations = candidates.map((stock) => {
    const observation = observeStockMarketCapCarrier(stock, summary);
    if (stock && typeof stock === "object") stock.marketCapCarrier = observation;
    return observation;
  });
  summary = summarizeMarketCapCarrier(summary, alignedObservations);
  allCandidates.filter((stock) => stock && stock.previousLimitUpOnly === true).forEach((stock) => {
    stock.marketCapCarrier = {
      ...observeStockMarketCapCarrier(stock, summary),
      excludedFromMarketProfile: true,
      observationOnly: true,
      opportunityGateImpact: false,
      reason: "仅由T-1涨停种子补入，个股市值只作观察，不反向参与市值偏好归纳。",
    };
  });
  payload.market.marketCapCarrier = summary;
  return payload.market.marketCapCarrier;
}

function refreshCoreLeadership(payload, options = {}) {
  if (!payload || !Array.isArray(payload.candidates)) return null;
  const tradingDate = marketEmotionTradingDate(payload);
  const archives = loadMarketEmotionArchives(tradingDate, 3);
  const initiativeFloorByCode = options.initiativeFloorByCode instanceof Map
    ? options.initiativeFloorByCode
    : loadVerifiedInitiativeFloors(tradingDate);
  const intradayByCode = options.intradayByCode instanceof Map
    ? options.intradayByCode : new Map();
  const board = buildCoreLeadershipBoard({
    candidates: payload.candidates,
    topicBoard: payload.topicBoard || {},
    marketState: payload.market && payload.market.state || {},
    archives,
    intradayByCode,
    initiativeFloorByCode,
    generatedAt: payload.fetchedAt || payload.updatedAt || new Date().toISOString(),
  });
  applyRepairCoreRetention(payload.candidates);
  payload.leadershipBoard = board;
  hydrateTopicBoardLeadership(payload.topicBoard, payload.candidates);
  return board;
}

function normalizeLeadershipPayload(payload) {
  if (!payload || !Array.isArray(payload.candidates)) return payload;
  let normalizationFailed = false;
  try {
    const tradingDate = marketEmotionTradingDate(payload);
    refreshMarketCapCarrier(payload);
    const retainedIntradayByCode = loadIntradayLeadershipEvidence(tradingDate);
    const initiativeFloorByCode = verifiedInitiativeFloorsForPayload(payload, tradingDate);
    const authorityBeforeHydration = roleAuthoritySnapshot(payload.candidates);
    payload.themeLibrary = themeLibrarySnapshotFromPayload(payload, "cache-normalized-bootstrap", {
      forceRebuild: true,
    });
    applyThemeCycleIdentitiesToCandidates(payload);
    const authorityAfterHydration = roleAuthoritySnapshot(payload.candidates);
    const identityProjectionChanged = authorityAfterHydration !== authorityBeforeHydration;
    refreshCandidateFlowAndGate(
      payload.candidates,
      payload.market && payload.market.state || {},
      payload.market && payload.market.limitStats || {},
    );
    const hasCurrentLeadership = Boolean(
      payload.leadershipBoard
      && Number(payload.leadershipBoard.version || 0) >= LEADERSHIP_SCHEMA_VERSION
      && payload.candidates.length
      && payload.candidates.every(hasCompleteLeadershipSchema),
    );
    const needsEvidenceUpgrade = Array.from(new Set([
      ...initiativeFloorByCode.keys(),
      ...retainedIntradayByCode.keys(),
    ])).some((code) => {
      const stock = payload.candidates.find((item) => String(item && (item.code || item.secCode) || "") === code);
      return stock && stock.leadership && stock.leadership.initiative
        && !isClosingIntradayInitiative(stock.leadership.initiative);
    });
    // 已保存的分时主动性证据质量高于收盘代理。重启恢复时保留原结果，
    // 只有旧缓存缺字段才执行迁移重算，防止“分时验证”被降级覆盖。
    const leadershipRebuilt = !hasCurrentLeadership || needsEvidenceUpgrade || identityProjectionChanged;
    if (leadershipRebuilt) refreshCoreLeadership(payload, { initiativeFloorByCode, intradayByCode: retainedIntradayByCode });
    else hydrateTopicBoardLeadership(payload.topicBoard, payload.candidates);
    if (leadershipRebuilt) {
      const authorityBeforeFinalTheme = roleAuthoritySnapshot(payload.candidates);
      payload.themeLibrary = themeLibrarySnapshotFromPayload(payload, "cache-normalized-final", {
        forceRebuild: true,
      });
      applyThemeCycleIdentitiesToCandidates(payload);
      const authorityAfterFinalTheme = roleAuthoritySnapshot(payload.candidates);
      if (authorityAfterFinalTheme !== authorityBeforeFinalTheme) {
        refreshCoreLeadership(payload, { initiativeFloorByCode, intradayByCode: retainedIntradayByCode });
        payload.themeLibrary = themeLibrarySnapshotFromPayload(payload, "cache-normalized-settled", {
          forceRebuild: true,
        });
        applyThemeCycleIdentitiesToCandidates(payload);
      }
      refreshCandidateFlowAndGate(
        payload.candidates,
        payload.market && payload.market.state || {},
        payload.market && payload.market.limitStats || {},
      );
    }
    applyThemeDecisionToTopicBoard(payload.topicBoard, payload.themeLibrary);
    if (!payload.sources || typeof payload.sources !== "object") payload.sources = {};
    const retainedQualitySummary = summarizeIntradayEvidenceQuality(retainedIntradayByCode);
    const evidenceTargetCount = leadershipEvidenceTargets(payload).length;
    payload.sources.intradayLeadershipDiagnostics = {
      authority: "exact_date_intraday_leadership_evidence",
      expectedTradingDate: tradingDate || null,
      targetCount: evidenceTargetCount,
      verifiedCount: retainedIntradayByCode.size,
      missingCount: Math.max(0, evidenceTargetCount - retainedIntradayByCode.size),
      sourceCounts: retainedQualitySummary.sourceCounts,
      qualityCounts: retainedQualitySummary.qualityCounts,
      closingCompleteCount: retainedQualitySummary.closingCompleteCount,
      partialSessionCount: retainedQualitySummary.partialSessionCount,
      restoredFromExactDateCache: retainedIntradayByCode.size > 0,
    };
    // 旧缓存的bestPicks只是历史观察，不得在权威周期生成前重建或参与情绪/风格计算。
    // 正式bestPicks由refreshTomorrowDecision -> buildCanonicalBestPicks一次生成。
    payload.bestPicks = provisionalBestPicks("旧缓存决策已隔离，等待统一因子重建");
    if (payload.market && payload.market.state) {
      hydrateEmotionCyclePersistenceEvidence(payload, {
        generationContext: payload.generationContext || null,
      });
      payload.market.state.effectAttribution = buildMarketEffectAttribution(payload);
    }
    payload.marketEmotion = buildMarketEmotionObservation(payload);
    payload.marketStrengthSource = buildMarketStrengthSource(payload);
    payload.superExpectation = buildSuperExpectationSnapshot(payload);
    const styleOutcomeRowsForNormalization = styleOutcomeRowsOf(payload);
    const normalizationOptions = {
      generationContext: payload.generationContext || null,
      styleOutcomeRows: styleOutcomeRowsForNormalization,
    };
    refreshPremarketModels(payload, normalizationOptions);
    refreshTomorrowDecision(payload, normalizationOptions);
  } catch (error) {
    normalizationFailed = true;
    let bestPicksExecutionVersion = 0;
    try {
      bestPicksExecutionVersion = Number(payload.bestPicks && payload.bestPicks.executionVersion || 0);
    } catch (_) {
      bestPicksExecutionVersion = 0;
    }
    if (!Number.isFinite(bestPicksExecutionVersion) || bestPicksExecutionVersion < 3) {
      payload.bestPicks = {
        executionVersion: 3,
        available: false,
        tradeDisabled: true,
        degraded: true,
        migrationFailed: true,
        picks: [],
        note: "旧缓存执行方案迁移失败，已禁用旧方案；请重新抓取市场数据后再判断。",
        watchlist: [],
        premiumWatch: [],
        riskWatch: [],
        executionCounts: { checked: 0, eligible: 0, entry: 0, premium: 0, risk: 0, readyPaths: 0 },
        scenarioPlans: [],
        migrationError: String(error && error.message || error || "unknown error"),
      };
    }
    payload.leadershipBoard = payload.leadershipBoard || {
      version: LEADERSHIP_SCHEMA_VERSION,
      focusDirection: "当前主线",
      dataQuality: "旧缓存迁移失败，等待下一次抓取",
      principle: "主动性第一；情绪锚点不自动获得交易资格。",
      leaders: [],
      tradeCarriers: [],
      observations: [],
      counts: { candidates: payload.candidates.length, intraday: 0, leaders: 0, tradeCarriers: 0 },
      degraded: true,
      error: String(error && error.message || error || "unknown error"),
    };
  }
  let decisionNeedsRefresh = normalizationFailed;
  try {
    decisionNeedsRefresh = normalizationFailed
      || !payload.tomorrowDecision
      || Number(payload.tomorrowDecision.version || 0) < 1
      || !inspectAuthoritativeDecisionChain(payload).valid;
  } catch (_) {
    decisionNeedsRefresh = true;
  }
  if (decisionNeedsRefresh) {
    const styleOutcomeRowsForNormalization = styleOutcomeRowsOf(payload);
    const normalizationOptions = {
      generationContext: payload.generationContext || null,
      styleOutcomeRows: styleOutcomeRowsForNormalization,
    };
    try {
      if (!payload.premarketModels || Number(payload.premarketModels.version || 0) < 2) {
        refreshPremarketModels(payload, normalizationOptions);
      }
    } catch (_) {
      // refreshTomorrowDecision owns the final fail-closed boundary.  A hostile
      // or corrupt legacy field must not escape normalization a second time.
    }
    try {
      refreshTomorrowDecision(payload, normalizationOptions);
    } catch (_) {
      // refreshTomorrowDecision is defensive, but normalization itself must
      // remain non-throwing even for accessor-based corrupt fixtures.
    }
  }
  try {
    const report = payload.postCloseOpportunity;
    const generationId = String(
      payload.tomorrowDecision && payload.tomorrowDecision.generationId
      || payload.premarketModels && payload.premarketModels.generationId
      || "",
    );
    const snapshotAsOf = String(payload.fetchedAt || payload.updatedAt || "");
    const recentRelation = report && report.recentRelation;
    if (
      !report
      || Number(report.version || 0) < 1
      || !String(report.generationId || "")
      || (generationId && String(report.generationId || "") !== generationId)
      || (snapshotAsOf && String(report.asOf || "") !== snapshotAsOf)
      || !recentRelation
      || (generationId && String(recentRelation.generationId || "") !== generationId)
      || !Array.isArray(report.setupCards)
      || !Array.isArray(report.watchCards)
    ) refreshPostCloseOpportunityReport(payload);
  } catch (_) {
    refreshPostCloseOpportunityReport(payload);
  }
  try {
    refreshUnifiedQuantFactors(payload);
  } catch (_) {
    // The unified projection is read-only; canonical fail-closed decisions stay intact.
  }
  return payload;
}

async function enrichFrozenClosingRecentLimitUp(payload, stats = {}, enrichFn = enrichKlineProfiles) {
  const source = payload && typeof payload === "object" ? payload : {};
  const sourceCandidates = Array.isArray(source.candidates) ? source.candidates : [];
  const targetTradingDate = normalizeTradingDate(
    source.tradingDate
    || source.asOf && source.asOf.tradingDate
    || source.generationContext && source.generationContext.tradingDate,
  );
  const limitDates = source.market && source.market.limitStats && source.market.limitStats.dates || {};
  const expectedPreviousTradingDate = limitDates.verified === true
    ? normalizeTradingDate(limitDates.prev) : "";
  const previousPayload = expectedPreviousTradingDate
    ? loadExactPreviousDecisionPayload(source) : null;
  const previousLimitUpSeeds = buildPreviousLimitUpSeeds(previousPayload, {
    expectedTradingDate: expectedPreviousTradingDate,
  });
  const seedByCode = new Map(previousLimitUpSeeds.map((seed) => [String(seed.code || seed.secCode || ""), seed]));
  const sourceCodes = new Set(sourceCandidates.map((item) => String(item && (item.code || item.secCode) || "")));
  const candidates = sourceCandidates.map((item) => {
    const code = String(item && (item.code || item.secCode) || "");
    const seed = seedByCode.get(code);
    return seed ? {
      ...item,
      previousLimitUpSeed: true,
      previousLimitUpEvidence: seed.previousLimitUpEvidence,
    } : item;
  }).concat(previousLimitUpSeeds
    .filter((seed) => !sourceCodes.has(String(seed.code || seed.secCode || "")))
    .map((seed) => ({
      ...seed,
      previousLimitUpOnly: true,
      selected: false,
      tradeQualified: false,
      observationOnly: true,
      executionAuthority: false,
      setup: "前板回撤观察",
    })));
  const pending = candidates.filter((item) => !(
    item
    && item.previousLimitUpOnly !== true
    && item.klineProfile
    && item.klineProfile.recentLimitUp
    && item.klineProfile.recentLimitUp.verified === true
  ));

  const diagnostics = {
    version: 1,
    targetTradingDate: targetTradingDate || null,
    requested: pending.length,
    upgraded: 0,
    rejectedDateMismatch: 0,
    previousLimitUpSeedCount: previousLimitUpSeeds.length,
    previousLimitUpOnlyCount: candidates.filter((item) => item && item.previousLimitUpOnly === true).length,
    status: "not_needed",
  };
  if (!targetTradingDate) return { payload: source, diagnostics };
  if (!pending.length) {
    return {
      payload: { ...source, candidates },
      diagnostics: { ...diagnostics, status: previousLimitUpSeeds.length ? "seeded" : "not_needed" },
    };
  }

  let enriched = [];
  try {
    enriched = await enrichFn(pending, stats);
    if (enrichFn === enrichKlineProfiles) persistFreshKlineProfiles(enriched);
  } catch (error) {
    return {
      payload: source,
      diagnostics: {
        ...diagnostics,
        status: "failed",
        error: String(error && error.message || error || "recent limit-up enrichment failed"),
      },
    };
  }

  const profileByCode = new Map();
  for (const item of Array.isArray(enriched) ? enriched : []) {
    const evidence = item && item.klineProfile && item.klineProfile.recentLimitUp;
    if (!evidence || evidence.verified !== true) continue;
    const evidenceDate = normalizeTradingDate(evidence.completedTradingDate);
    if (evidenceDate !== targetTradingDate) {
      diagnostics.rejectedDateMismatch += 1;
      continue;
    }
    profileByCode.set(String(item.code || item.secCode || ""), item.klineProfile);
  }
  diagnostics.profileFailures = Number(stats && stats.profileFailures || 0);
  diagnostics.profileErrorSamples = Array.isArray(stats && stats.profileErrorSamples)
    ? stats.profileErrorSamples
    : [];

  if (!profileByCode.size) {
    return {
      payload: source,
      diagnostics: { ...diagnostics, status: "unavailable" },
    };
  }

  const nextCandidates = candidates.map((item) => {
    const code = String(item && (item.code || item.secCode) || "");
    const profile = profileByCode.get(code);
    if (!profile) return item;
    const evidence = profile.recentLimitUp;
    diagnostics.upgraded += 1;
    let projected = {
      ...item,
      klineProfile: {
        ...(item.klineProfile || {}),
        ...profile,
        recentLimitUp: evidence,
      },
    };
    if (item.previousLimitUpOnly === true) {
      const session = profile.lastSession && typeof profile.lastSession === "object"
        ? profile.lastSession : {};
      const close = Number(session.close || profile.lastClose);
      const changePct = Number(session.changePct ?? session.currentChangePct);
      const changeRatio = Number.isFinite(changePct) && changePct > -99.9 ? 1 + changePct / 100 : null;
      const previousClose = Number.isFinite(close) && close > 0 && changeRatio && changeRatio > 0
        ? close / changeRatio : null;
      const capitalReference = item.previousLimitUpEvidence
        && item.previousLimitUpEvidence.capitalReference || {};
      const scale = Number.isFinite(close) && close > 0 && Number.isFinite(previousClose) && previousClose > 0
        ? close / previousClose : null;
      const scaledCapital = (value) => {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 && scale
          ? Math.round(number * scale * 100) / 100 : null;
      };
      projected = enforcePreviousLimitUpObservationOnly({
        ...projected,
        price: Number.isFinite(close) && close > 0 ? close : null,
        close: Number.isFinite(close) && close > 0 ? close : null,
        open: Number.isFinite(Number(session.open)) ? Number(session.open) : null,
        high: Number.isFinite(Number(session.high)) ? Number(session.high) : null,
        low: Number.isFinite(Number(session.low)) ? Number(session.low) : null,
        prevClose: Number.isFinite(previousClose) && previousClose > 0 ? previousClose : null,
        changePct: Number.isFinite(changePct) ? changePct : null,
        amountYi: Number.isFinite(Number(session.amountYi)) ? Number(session.amountYi) : null,
        turnoverRate: Number.isFinite(Number(session.turnoverRate)) ? Number(session.turnoverRate) : null,
        totalMarketValue: scaledCapital(capitalReference.totalMarketValue),
        floatMarketValue: scaledCapital(capitalReference.floatMarketValue),
        floatMktCapYi: scaledCapital(capitalReference.floatMktCapYi),
        quoteAvailable: false,
        closingQuoteAvailable: true,
        priceSource: "frozen_closing_kline",
      });
    }
    return projected;
  });

  return {
    payload: { ...source, candidates: nextCandidates },
    diagnostics: { ...diagnostics, status: diagnostics.upgraded ? "upgraded" : "unavailable" },
  };
}

function mergeCachedRecentLimitUpEvidence(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const candidates = Array.isArray(source.candidates) ? source.candidates : [];
  const targetTradingDate = normalizeTradingDate(
    source.tradingDate
    || source.asOf && source.asOf.tradingDate
    || source.generationContext && source.generationContext.tradingDate,
  );
  const profiles = loadKlineProfileCache();
  const retained = loadHotStocksFallback();
  const retainedEvidence = new Map(
    (Array.isArray(retained && retained.candidates) ? retained.candidates : [])
      .map((item) => [
        String(item && (item.code || item.secCode) || ""),
        item && item.klineProfile && item.klineProfile.recentLimitUp,
      ]),
  );
  const archiveEvidence = new Map();
  const historyDir = path.join(runtimeRoot, "data", "history");
  const targetDateValue = targetTradingDate ? new Date(`${targetTradingDate}T00:00:00Z`) : null;
  const weekdaySessionsInclusive = (fromDate) => {
    const start = new Date(`${fromDate}T00:00:00Z`);
    if (!targetDateValue || Number.isNaN(start.getTime()) || start > targetDateValue) return Infinity;
    let count = 0;
    for (let cursor = new Date(start); cursor <= targetDateValue; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const weekday = cursor.getUTCDay();
      if (weekday !== 0 && weekday !== 6) count += 1;
    }
    return count;
  };
  if (targetTradingDate && fs.existsSync(historyDir)) {
    const archiveDates = fs.readdirSync(historyDir)
      .map((name) => String(name).match(/^(\d{4}-\d{2}-\d{2})\.json$/))
      .filter(Boolean)
      .map((match) => match[1])
      .filter((date) => weekdaySessionsInclusive(date) <= 10)
      .sort();
    for (const archiveDate of archiveDates) {
      const snapshot = readJsonFile(path.join(historyDir, `${archiveDate}.json`));
      for (const item of Array.isArray(snapshot && snapshot.candidates) ? snapshot.candidates : []) {
        const session = item && item.klineProfile && item.klineProfile.lastSession;
        if (!session || session.verified !== true || session.completed !== true || session.closedAtLimit !== true) continue;
        if (normalizeTradingDate(session.tradingDate) !== archiveDate) continue;
        const code = String(item.code || item.secCode || "");
        if (!code) continue;
        if (!archiveEvidence.has(code)) archiveEvidence.set(code, []);
        archiveEvidence.get(code).push(archiveDate);
      }
    }
  }
  let merged = 0;
  const nextCandidates = candidates.map((item) => {
    const existing = item && item.klineProfile && item.klineProfile.recentLimitUp;
    if (existing && existing.verified === true) return item;
    const code = String(item && (item.code || item.secCode) || "");
    const cached = profiles[code];
    const archivedDates = archiveEvidence.get(code) || [];
    const archiveDerived = archivedDates.length ? {
      version: 1,
      verified: true,
      basis: "archived_completed_daily_close_positive_evidence",
      completedTradingDate: targetTradingDate,
      sampleSize: null,
      positiveEvidenceOnly: true,
      window5: {
        dates: archivedDates.filter((date) => weekdaySessionsInclusive(date) <= 5),
      },
      window10: { dates: archivedDates },
    } : null;
    if (archiveDerived) {
      archiveDerived.window5.count = archiveDerived.window5.dates.length;
      archiveDerived.window10.count = archiveDerived.window10.dates.length;
    }
    const evidence = [cached && cached.recentLimitUp, retainedEvidence.get(code), archiveDerived]
      .find((value) => value && value.verified === true);
    if (!evidence || evidence.verified !== true) return item;
    if (normalizeTradingDate(evidence.completedTradingDate) !== targetTradingDate) return item;
    merged += 1;
    return {
      ...item,
      klineProfile: {
        ...(item.klineProfile || {}),
        recentLimitUp: evidence,
      },
    };
  });
  return {
    payload: { ...source, candidates: nextCandidates },
    diagnostics: {
      version: 1,
      targetTradingDate: targetTradingDate || null,
      candidateCount: candidates.length,
      merged,
      archivePositiveEvidenceCount: archiveEvidence.size,
      status: merged || candidates.every((item) => item && item.klineProfile && item.klineProfile.recentLimitUp)
        ? "ready"
        : "partial",
    },
  };
}

let configuredMarketDataRegistry = null;
const registeredMarketDataProviders = [];
let marketDataProviderDiagnostics = {
  version: 1,
  configured: false,
  mode: "auto",
  enabledCount: 0,
  errors: [],
  freeFallbackEnabled: true,
  credentialsStoredInConfig: false,
};

function createFreeFallbackMarketDataProvider() {
  return createFreeFallbackProvider({
    fetchEastmoneyRank,
    fetchThsHotList,
    fetchMarketSnapshot,
    fetchExternalSnapshot,
    fetchLimitStats,
    fetchGlobalNews,
    fetchEventTimeline: (options = {}) => fetchJiuyanTimeline(options),
    fetchMarketCalendar: (options = {}) => fetchMarketCalendar(options),
    fetchQuotes: (stocks) => fetchEastmoneyQuotes(stocks),
    fetchDailyKline: (stock, limit, stats) => fetchKlineRowsFreeFallback(stock, limit, stats),
    fetchSectors: () => fetchEastmoneySectors(),
    fetchStockEvidence: async (stocks) => {
      await enrichEvidence(stocks);
      return stocks.map((stock) => ({ code: stock.code, evidence: stock.evidence || null }));
    },
    fetchIntradayLeadership: (...args) => fetchIntradayLeadershipProfiles(...args),
    fetchStockNews: (code, limit) => fetchStockNews(code, limit),
  });
}

function createMarketDataProviderRegistry(providers = registeredMarketDataProviders) {
  const registry = new DataProviderRegistry();
  (Array.isArray(providers) ? providers : []).forEach((provider) => registry.register(provider));
  registry.register(createFreeFallbackMarketDataProvider());
  return registry;
}

function registerMarketDataProvider(provider) {
  if (configuredMarketDataRegistry) throw new Error("数据源注册必须在首次行情刷新前完成");
  registeredMarketDataProviders.push(provider);
  return provider;
}

function resetMarketDataProviderRegistryForTests() {
  configuredMarketDataRegistry = null;
  registeredMarketDataProviders.length = 0;
  marketDataProviderDiagnostics = {
    version: 1,
    configured: false,
    mode: "auto",
    enabledCount: 0,
    errors: [],
    freeFallbackEnabled: true,
    credentialsStoredInConfig: false,
  };
}

function getMarketDataProviderRegistry() {
  if (!configuredMarketDataRegistry) {
    const loaded = loadConfiguredProviders({ runtimeRoot });
    const registry = new DataProviderRegistry();
    [...registeredMarketDataProviders, ...loaded.providers].forEach((provider) => {
      try {
        registry.register(provider);
      } catch (error) {
        loaded.diagnostics.errors.push(`provider_registration_failed:${String(error && error.message || error).slice(0, 180)}`);
      }
    });
    registry.register(createFreeFallbackMarketDataProvider());
    configuredMarketDataRegistry = registry;
    marketDataProviderDiagnostics = {
      ...loaded.diagnostics,
      errors: Array.from(new Set(loaded.diagnostics.errors)),
    };
  }
  return configuredMarketDataRegistry;
}

function dataProviderStatus() {
  const registry = getMarketDataProviderRegistry();
  return {
    version: 1,
    providers: registry.list(),
    configuration: { ...marketDataProviderDiagnostics },
    engineLock: {
      authority: "a_share_decision_engine_lock_v1",
      version: "v1",
      decisionLogicMutableByProvider: false,
    },
  };
}

async function requiredProviderCapability(registry, capability, args = [], context = {}) {
  const result = await registry.invoke(capability, args, context);
  if (!result.envelope || result.envelope.usable !== true) {
    const error = new Error(`数据能力不可用：${capability}`);
    error.code = "DATA_PROVIDER_CAPABILITY_UNAVAILABLE";
    error.capability = capability;
    error.attempts = result.attempts;
    throw error;
  }
  return result;
}

function projectDataBundleMetadata(bundle) {
  return {
    version: bundle.version,
    authority: bundle.authority,
    generationContext: bundle.generationContext,
    capabilities: bundle.capabilities,
    lineage: bundle.lineage,
    quality: bundle.quality,
    executionAuthority: false,
  };
}

async function hotStocksPayload(options = {}) {















  try {















    const klineStats = createKlineSourceStats(); // 本次抓取的局部K线来源统计，不受并发请求污染















    const providerRegistry = options.providerRegistry || getMarketDataProviderRegistry();
    const providerObservedAt = nowIso();
    const providerResults = await Promise.all([















      requiredProviderCapability(providerRegistry, DATA_CAPABILITIES.HOT_RANK_EASTMONEY, [], { observedAt: providerObservedAt }),















      requiredProviderCapability(providerRegistry, DATA_CAPABILITIES.HOT_RANK_THS, [], { observedAt: providerObservedAt }),















      requiredProviderCapability(providerRegistry, DATA_CAPABILITIES.MARKET_SNAPSHOT, [], { observedAt: providerObservedAt }),















      requiredProviderCapability(providerRegistry, DATA_CAPABILITIES.EXTERNAL_SNAPSHOT, [], { observedAt: providerObservedAt }),















      requiredProviderCapability(providerRegistry, DATA_CAPABILITIES.LIMIT_STATS, [], { observedAt: providerObservedAt }),















      requiredProviderCapability(providerRegistry, DATA_CAPABILITIES.GLOBAL_NEWS, [40], { observedAt: providerObservedAt }),

      requiredProviderCapability(providerRegistry, DATA_CAPABILITIES.EVENT_TIMELINE, [{
        cacheFile: jiuyanTimelineCacheFile,
        forceRefresh: true,
      }], { observedAt: providerObservedAt }),

      requiredProviderCapability(providerRegistry, DATA_CAPABILITIES.MARKET_CALENDAR, [{
        cacheFile: marketCalendarCacheFile,
        forceRefresh: true,
      }], { observedAt: providerObservedAt }),















    ]);















    const [eastRankLive, thsRowsLive, marketSnapshot, externalSnapshot, limitStats, globalNews, jiuyanTimeline, marketRiskCalendar]
      = providerResults.map((result) => result.envelope.data);
    const dataProviderEnvelopes = providerResults.map((result) => result.envelope);

    const rankNow = new Date();
    const hotRankCache = loadHotRankCache();
    const eastRankResolution = resolveHotRankSource({
      source: "eastmoney",
      liveResult: eastRankLive,
      cachedClosing: cachedClosingRankSource(hotRankCache, "eastmoney"),
      limitStats,
      now: rankNow,
    });
    const thsRankResolution = resolveHotRankSource({
      source: "ths",
      liveResult: thsRowsLive,
      cachedClosing: cachedClosingRankSource(hotRankCache, "ths"),
      limitStats,
      now: rankNow,
    });
    persistHotRankCache(hotRankCache, { eastmoney: eastRankResolution, ths: thsRankResolution }, rankNow);
    const eastRank = eastRankResolution.rows;
    const thsRows = thsRankResolution.rows;
    const rankSources = hotRankSourceSummary(eastRankResolution, thsRankResolution);

    // 次日盘前热榜是新的注意力观察，但市场报价仍属于上一交易日。
    // 在这两个时点完成同步前，整个盘后决策链必须继续使用精确收盘归档，
    // 不能只冻结 emotionCycle 而让题材、角色和个人选股继续漂移。
    const preopenBasisProbe = {
      fetchedAt: rankNow.toISOString(),
      updatedAt: rankNow.toISOString(),
      market: { snapshot: marketSnapshot, limitStats },
      sources: { hotRanks: rankSources },
      candidates: mergePreopenRankCandidates(eastRank, thsRows),
    };
    const preopenBasis = resolveCanonicalClosingDecisionBasis(preopenBasisProbe);
    if (preopenBasis.status === "frozen_closing") {
      const indexStructureUpgrade = await refreshFrozenFiveDayIndexStructures(preopenBasis.payload);
      const recentLimitUpgrade = await enrichFrozenClosingRecentLimitUp(indexStructureUpgrade.payload, klineStats);
      const canonicalPayload = normalizeHotStocksFallbackResponse(recentLimitUpgrade.payload, "", { stamp: false });
      canonicalPayload.sources = {
        ...(canonicalPayload.sources || {}),
        indexFiveDayStructureMigration: indexStructureUpgrade.diagnostics,
        recentLimitUpSchemaEnrichment: recentLimitUpgrade.diagnostics,
      };
      const frozenGenerationContext = resolveGenerationContext(canonicalPayload);
      const cycleHistoryResult = persistCycleHistorySnapshot(canonicalPayload, {
        generationContext: frozenGenerationContext,
      });
      if (cycleHistoryResult.required === true && cycleHistoryResult.ok !== true) {
        markCycleHistoryUnavailable(canonicalPayload, cycleHistoryResult);
      }
      const retainedPayload = writeRetainedJson(hotStocksCacheFile, canonicalPayload, { archiveDir: hotStocksCacheArchiveDir });
      if (!retainedPayload) {
        const error = new Error("冻结收盘快照生成成功，但主缓存写入失败；本代次不得标记为刷新成功");
        error.code = "HOT_STOCKS_CACHE_WRITE_FAILED";
        throw error;
      }
      return canonicalPayload;
    }
    if (preopenBasis.status === "unavailable") {
      const unavailablePayload = normalizeLeadershipPayload(
        failClosedDecisionBasisPayload(preopenBasisProbe, preopenBasis),
      );
      const retainedPayload = writeRetainedJson(hotStocksCacheFile, unavailablePayload, { archiveDir: hotStocksCacheArchiveDir });
      if (!retainedPayload) {
        const error = new Error("不可用快照生成成功，但主缓存写入失败；本代次不得标记为刷新成功");
        error.code = "HOT_STOCKS_CACHE_WRITE_FAILED";
        throw error;
      }
      return unavailablePayload;
    }

    const combinedEventCalendar = mergeCalendarSources(jiuyanTimeline, marketRiskCalendar);
    const externalRisk = assessExternalRisk(externalSnapshot, analyzeNewsRisk(thsRows, globalNews));















    const usFramework = await buildUsFramework(externalRisk);















    const retainedCoreSeeds = loadRetainedCoreWatchSeeds();
    const previousLimitUpExpectedDate = limitStats && limitStats.dates
      && limitStats.dates.verified === true
      ? normalizeCycleYmd(limitStats.dates.prev)
      : "";
    const previousLimitUpPayload = previousLimitUpExpectedDate
      ? loadExactPreviousDecisionPayload({ market: { limitStats } })
      : null;
    const previousLimitUpSeeds = buildPreviousLimitUpSeeds(previousLimitUpPayload, {
      expectedTradingDate: previousLimitUpExpectedDate,
    });
    const styleOutcomeSeeds = buildPreviousStyleOutcomeSeeds(previousLimitUpPayload, previousLimitUpExpectedDate);
    const quoteTargetMap = new Map();
    [...eastRank, ...thsRows, ...retainedCoreSeeds].forEach((item) => {
      const code = String(item && (item.code || item.secCode) || "");
      if (code && !quoteTargetMap.has(code)) quoteTargetMap.set(code, item);
    });
    const quoteProviderResult = await requiredProviderCapability(
      providerRegistry,
      DATA_CAPABILITIES.QUOTES,
      [Array.from(quoteTargetMap.values())],
      {
        observedAt: nowIso(),
        tradingDate: limitStats && limitStats.dates && limitStats.dates.today,
        expectedTradingDate: limitStats && limitStats.dates && limitStats.dates.today,
      },
    );
    const eastQuotes = quoteProviderResult.envelope.data;
    dataProviderEnvelopes.push(quoteProviderResult.envelope);
    const supplementalQuoteTargetMap = new Map();
    [...previousLimitUpSeeds, ...styleOutcomeSeeds].forEach((seed) => {
      const code = String(seed && (seed.code || seed.secCode) || "");
      if (code && !quoteTargetMap.has(code) && !supplementalQuoteTargetMap.has(code)) supplementalQuoteTargetMap.set(code, seed);
    });
    const previousLimitUpQuoteTargets = Array.from(supplementalQuoteTargetMap.values());
    let previousLimitUpQuotes = new Map();
    if (previousLimitUpQuoteTargets.length) {
      try {
        const supplementalQuoteResult = await requiredProviderCapability(
          providerRegistry,
          DATA_CAPABILITIES.QUOTES,
          [previousLimitUpQuoteTargets],
          {
            observedAt: nowIso(),
            tradingDate: limitStats && limitStats.dates && limitStats.dates.today,
            expectedTradingDate: limitStats && limitStats.dates && limitStats.dates.today,
          },
        );
        previousLimitUpQuotes = supplementalQuoteResult.envelope.data;
      } catch {
        // 补充观察池报价失败不得污染或阻断主热榜报价。
        previousLimitUpQuotes = new Map();
      }
    }















    const map = new Map();































    for (const row of eastRank) {















      const quote = eastQuotes.get(row.code) || {};















      map.set(row.code, {















        ...row,















        ...quote,















        concepts: [],















        popularity: "",















        topic: "",















      });















    }































    for (const row of thsRows) {















      const existing = map.get(row.code) || {};















      map.set(row.code, {















        ...existing,















        ...row,















        name: existing.name || row.name,















        changePct: Number.isFinite(existing.changePct) ? existing.changePct : row.changePct,















        concepts: row.concepts || existing.concepts || [],















      });















    }































    for (const row of retainedCoreSeeds) {
      if (map.has(row.code)) {
        map.set(row.code, {
          ...map.get(row.code),
          coreWatchRetained: true,
          coreWatchLastSeenAt: row.coreWatchLastSeenAt,
        });
        continue;
      }
      const quote = eastQuotes.get(row.code) || {};
      map.set(row.code, {
        ...row,
        ...quote,
        name: quote.name || row.name,
        concepts: row.concepts || [],
        popularity: "核心观察留存",
        topic: "",
      });
    }

    for (const seed of previousLimitUpSeeds) {
      const code = String(seed && (seed.code || seed.secCode) || "");
      if (!code) continue;
      const existing = map.get(code);
      if (existing) {
        map.set(code, {
          ...existing,
          previousLimitUpSeed: true,
          previousLimitUpEvidence: seed.previousLimitUpEvidence,
        });
        continue;
      }
      const quote = eastQuotes.get(code) || previousLimitUpQuotes.get(code) || {};
      map.set(code, {
        ...seed,
        ...quote,
        code,
        secCode: String(quote.secCode || seed.secCode || code),
        name: String(quote.name || seed.name || code),
        concepts: Array.isArray(seed.concepts) ? seed.concepts.slice() : [],
        mainConcept: seed.mainConcept || null,
        mainFamily: seed.mainFamily || null,
        popularity: "前板回撤观察",
        topic: "",
        previousLimitUpSeed: true,
        previousLimitUpEvidence: seed.previousLimitUpEvidence,
      });
    }

    const styleOutcomeTradingDate = normalizeCycleYmd(limitStats && limitStats.dates && limitStats.dates.today);
    const styleOutcomeRows = styleOutcomeSeeds.map((seed) => {
      const code = String(seed && seed.code || "");
      const source = map.get(code) || previousLimitUpQuotes.get(code) || {};
      const price = Number(source.price);
      const changePct = Number(source.changePct);
      return {
        ...source,
        code,
        secCode: String(source.secCode || seed.secCode || code),
        name: String(source.name || seed.name || code),
        styleOutcomeOnly: true,
        observationOnly: true,
        executionAuthority: false,
        styleOutcomeMembership: seed.styleOutcomeMembership,
        styleOutcomeTradingDate,
        styleOutcomeQuoteVerified: Number.isFinite(price) && price > 0 && Number.isFinite(changePct),
      };
    });

    const hotRankCodes = new Set([...eastRank, ...thsRows].map((item) => item.code));
    const rankedMerged = [...map.values()]















      .map((item) => ({















        ...item,















        combinedRank: Math.min(item.eastRank || HOT_RANK_TARGET + 1, item.thsRank || HOT_RANK_TARGET + 1),















        inBothSources: Boolean(item.eastRank && item.thsRank),

        previousLimitUpOnly: item.previousLimitUpSeed === true && !hotRankCodes.has(item.code),















      }))















      .sort((a, b) => a.combinedRank - b.combinedRank);
    const topRows = rankedMerged.filter((item) => hotRankCodes.has(item.code));
    const topCodes = new Set(topRows.map((item) => item.code));
    const retainedRows = rankedMerged.filter((item) => (
      item.coreWatchRetained && !item.previousLimitUpOnly && !topCodes.has(item.code)
    ));
    const previousLimitUpOnlyRows = rankedMerged.filter((item) => item.previousLimitUpOnly && !topCodes.has(item.code));
    // 热榜主池保留两家 Top100 的真实完整并集；留存核心只作为额外复核对象注入，最多24只。
    // T-1涨停种子只为补齐T日行情/K线而附加，不占用热榜或留存核心样本名额。
    const merged = [...topRows, ...retainedRows.slice(0, 24), ...previousLimitUpOnlyRows];































    // 数据质量闸：东财报价补全失败且无同花顺兜底的行（无名/无价/无概念）是残缺数据，















    // 不进候选、不进方向聚合（否则聚成"未归类"伪方向霸榜）；数量在 fetchStatus 里明示















    const brokenRows = merged.filter((item) => !item.name);















    const usableRows = merged.filter((item) => item.name);































    const expectedCompletedKlineDate = expectedCompletedKlineTradingDate(limitStats, new Date());
    const cachedKlineProfiles = loadKlineProfileCache();
    const profiled = (await enrichKlineProfiles(usableRows, klineStats, {
      cachedProfiles: cachedKlineProfiles,
      expectedTradingDate: expectedCompletedKlineDate,
    })).map((item) => {















      const liveAssessment = assessCachedKlineProfile(item.klineProfile, {
        expectedTradingDate: expectedCompletedKlineDate,
      });
      const liveProfile = item.klineProfile && liveAssessment.usable ? item.klineProfile : null;
      if (liveProfile) {
        klineStats.liveAccepted = Number(klineStats.liveAccepted || 0) + 1;
      } else if (item.klineProfile) {
        klineStats.liveDateMismatch = Number(klineStats.liveDateMismatch || 0) + 1;
        klineStats.fail = Number(klineStats.fail || 0) + 1;
      }
      const rawCachedProfile = !liveProfile ? cachedKlineProfiles[String(item.code)] : null;
      const cacheAssessment = assessCachedKlineProfile(rawCachedProfile, {
        expectedTradingDate: expectedCompletedKlineDate,
      });
      const cachedProfile = rawCachedProfile && cacheAssessment.usable ? {
        ...rawCachedProfile,
        dataLineage: {
          ...(rawCachedProfile.dataLineage && typeof rawCachedProfile.dataLineage === "object"
            ? rawCachedProfile.dataLineage : {}),
          version: 1,
          mode: "same_day_cache",
          liveFetchFailed: true,
          cacheAccepted: true,
          expectedTradingDate: cacheAssessment.expectedTradingDate,
          tradingDate: cacheAssessment.actualTradingDate,
          cacheAgeMinutes: cacheAssessment.cacheAgeMinutes,
          cacheReason: cacheAssessment.reason,
        },
      } : null;
      if (cachedProfile) {
        klineStats.cached = Number(klineStats.cached || 0) + 1;
        klineStats.sameDayCache = Number(klineStats.sameDayCache || 0) + 1;
        const cacheDate = cacheAssessment.actualTradingDate || "unknown";
        klineStats.cacheTradingDates[cacheDate] = Number(klineStats.cacheTradingDates[cacheDate] || 0) + 1;
        if (cacheAssessment.cacheAgeMinutes !== null) klineStats.cacheAgeMinutes.push(cacheAssessment.cacheAgeMinutes);
      } else if (rawCachedProfile) {
        klineStats.staleCacheRejected = Number(klineStats.staleCacheRejected || 0) + 1;
      }
      if (!liveProfile && !cachedProfile) klineStats.unavailable = Number(klineStats.unavailable || 0) + 1;
      const preliminaryType = classifyTicketType({ ...item, klineProfile: liveProfile || cachedProfile || null });















      return {















        ...item,















        klineProfile: liveProfile || cachedProfile || null,
        klineProfileCached: Boolean(cachedProfile),
        klineProfileLineage: liveProfile && liveProfile.dataLineage
          ? { ...liveProfile.dataLineage }
          : cachedProfile && cachedProfile.dataLineage ? { ...cachedProfile.dataLineage }
            : {
                version: 1,
                mode: item.klineProfile ? `live_${liveAssessment.status}`
                  : rawCachedProfile ? cacheAssessment.status : "unavailable",
                liveFetchFailed: true,
                cacheAccepted: false,
                expectedTradingDate: liveAssessment.expectedTradingDate || cacheAssessment.expectedTradingDate,
                tradingDate: liveAssessment.actualTradingDate || cacheAssessment.actualTradingDate,
                cacheAgeMinutes: cacheAssessment.cacheAgeMinutes,
                cacheReason: item.klineProfile ? liveAssessment.reason : cacheAssessment.reason,
              },
        ticketType: preliminaryType.type,















        ticketReason: preliminaryType.reason,















      };















    });
    const marketProfiled = excludePreviousLimitUpOnly(profiled);
    const supplementalProfiled = profiled.filter((item) => item && item.previousLimitUpOnly === true);
    const marketKlineScope = summarizeKlineProfileScope(marketProfiled, klineStats);
    const supplementalKlineScope = summarizeKlineProfileScope(supplementalProfiled, klineStats);































    // 消息面证据:热度前80挂 公告+研报(当日缓存命中零开销),为炒作逻辑提供事实支撑















    persistFreshKlineProfiles(profiled);
    const evidenceProviderResult = await requiredProviderCapability(
      providerRegistry,
      DATA_CAPABILITIES.STOCK_EVIDENCE,
      [marketProfiled],
      { observedAt: nowIso() },
    );
    const evidenceByCode = new Map((Array.isArray(evidenceProviderResult.envelope.data)
      ? evidenceProviderResult.envelope.data : []).map((row) => [String(row && row.code || ""), row && row.evidence]));
    marketProfiled.forEach((stock) => {
      const evidence = evidenceByCode.get(String(stock && stock.code || ""));
      if (evidence && typeof evidence === "object") stock.evidence = evidence;
    });
    dataProviderEnvelopes.push(evidenceProviderResult.envelope);































    const sectorProviderResult = await requiredProviderCapability(
      providerRegistry,
      DATA_CAPABILITIES.SECTORS,
      [],
      { observedAt: nowIso() },
    );
    const sectorRows = sectorProviderResult.envelope.data;
    dataProviderEnvelopes.push(sectorProviderResult.envelope);















    // 先取前20做聚类（给合并留余量），同链条题材归并后再取前10个方向















    const hotConcepts = clusterHotConcepts(















      conceptStats(marketProfiled, sectorRows, marketSnapshot).slice(0, 20),















      marketProfiled,















    ).slice(0, 10);















    const contexts = roleContext(marketProfiled, hotConcepts);















    const marketState = classifyMarket(marketSnapshot, hotConcepts, externalRisk, limitStats, {
      externalCoreAlert: usFramework && usFramework.coreAlert ? usFramework.coreAlert : null,
      candidates: marketProfiled,
    });















    const tradingStyle = classifyTradingStyle(marketState, hotConcepts, marketProfiled);

    const marketCapCarrierRegime = classifyMarketCapCarrierRegime(marketSnapshot);
    const marketCapCarrierObservations = marketProfiled.map((item) => {
      const observation = observeStockMarketCapCarrier(item, marketCapCarrierRegime);
      item.marketCapCarrier = observation;
      return observation;
    });
    let marketCapCarrier = summarizeMarketCapCarrier(marketCapCarrierRegime, marketCapCarrierObservations);
    const alignedMarketCapCarrierObservations = marketProfiled.map((item) => {
      const observation = observeStockMarketCapCarrier(item, marketCapCarrier);
      item.marketCapCarrier = observation;
      return observation;
    });
    marketCapCarrier = summarizeMarketCapCarrier(marketCapCarrier, alignedMarketCapCarrierObservations);
    profiled.filter((item) => item.previousLimitUpOnly).forEach((item) => {
      item.marketCapCarrier = {
        ...observeStockMarketCapCarrier(item, marketCapCarrier),
        excludedFromMarketProfile: true,
        observationOnly: true,
        opportunityGateImpact: false,
        reason: "仅由T-1涨停种子补入，个股市值只作观察，不反向参与市值偏好归纳。",
      };
    });















    const riskBoard = buildRiskBoard(marketState, hotConcepts, externalRisk);
    const focusHotConcept = Array.isArray(hotConcepts) ? hotConcepts[0] : null; // 临时焦点，topicBoard创建后会二次过滤
    const focusHotConceptName = focusHotConcept ? String(focusHotConcept.name || focusHotConcept.displayName || "").trim() : "";
    const focusHotConceptFamily = focusHotConcept ? String(focusHotConcept.family || focusHotConcept.name || focusHotConcept.displayName || "").trim() : "";
  const mixedCycleFocusOnly = false;















    const scoredCandidates = profiled















      .map((item) => {
        const scored = scoreCandidate(item, hotConcepts, marketState, contexts, tradingStyle, externalRisk, riskBoard);
        enforcePreviousLimitUpObservationOnly(scored);
        if (mixedCycleFocusOnly && focusHotConcept) {
          const match = [scored.mainConcept, scored.mainFamily, scored.concept].some((value) => {
            const text = String(value || "").trim();
            if (!text) return false;
            return (
              text === focusHotConceptName ||
              text === focusHotConceptFamily ||
              focusHotConceptName.includes(text) ||
              focusHotConceptFamily.includes(text) ||
              text.includes(focusHotConceptName) ||
              text.includes(focusHotConceptFamily)
            );
          });
          // 只有已经核实的周期龙头/滚动容量中军可以豁免；当日高度不能借“龙头”旧称越权。
          const roleAuthority = candidateRoleAuthority(scored);
          if (!match && !roleAuthority.coreAuthorized) {
            scored.selected = false;
            scored.setup = "剔除";
            scored.rejects = Array.isArray(scored.rejects) ? scored.rejects.concat(["混沌期只保留焦点方向核心"]) : ["混沌期只保留焦点方向核心"];
          }
        }
        return scored;
      })















      .sort((a, b) => {















        if (a.selected !== b.selected) return a.selected ? -1 : 1;















        return b.score - a.score;















      });















    let candidates = await enrichBacktests(scoredCandidates, tradingStyle);
    let marketCandidates = excludePreviousLimitUpOnly(candidates);















    let topicBoard = buildTopicBoard(hotConcepts, marketCandidates, marketState, externalRisk);
    let decisionHotConcepts = hotConcepts;
    const canonicalLine = topicBoard && topicBoard.mainLine ? topicBoard.mainLine : null;
    const canonicalConceptIndex = canonicalLine && Array.isArray(hotConcepts)
      ? hotConcepts.findIndex((concept) => {
          const conceptName = String(concept && (concept.name || concept.displayName) || "").trim();
          const conceptFamily = String(concept && (concept.family || concept.name) || "").trim();
          const lineName = String(canonicalLine.name || canonicalLine.displayName || "").trim();
          const lineFamily = String(canonicalLine.family || canonicalLine.name || "").trim();
          return conceptName === lineName || conceptFamily === lineFamily;
        })
      : -1;
    if (mixedCycleFocusOnly && canonicalConceptIndex > 0) {
      const canonicalConcept = hotConcepts[canonicalConceptIndex];
      decisionHotConcepts = [canonicalConcept].concat(hotConcepts.filter((_, index) => index !== canonicalConceptIndex));
      const canonicalName = String(canonicalConcept.name || canonicalConcept.displayName || "").trim();
      const canonicalFamily = String(canonicalConcept.family || canonicalConcept.name || "").trim();
      const rescoredCandidates = profiled
        .map((item) => {
          const rescored = scoreCandidate(item, decisionHotConcepts, marketState, contexts, tradingStyle, externalRisk, riskBoard);
          enforcePreviousLimitUpObservationOnly(rescored);
          const matchesCanonical = [rescored.mainConcept, rescored.mainFamily, rescored.concept].some((value) => {
            const text = String(value || "").trim();
            return text && (
              text === canonicalName
              || text === canonicalFamily
              || canonicalName.includes(text)
              || canonicalFamily.includes(text)
              || text.includes(canonicalName)
              || text.includes(canonicalFamily)
            );
          });
          if (!matchesCanonical && !candidateRoleAuthority(rescored).coreAuthorized) {
            rescored.selected = false;
            rescored.setup = "剔除";
            rescored.rejects = Array.isArray(rescored.rejects)
              ? rescored.rejects.concat(["当前周期只保留统一主线方向核心"])
              : ["当前周期只保留统一主线方向核心"];
          }
          return rescored;
        })
        .sort((a, b) => {
          if (a.selected !== b.selected) return a.selected ? -1 : 1;
          return b.score - a.score;
        });
      candidates = await enrichBacktests(rescoredCandidates, tradingStyle);
      marketCandidates = excludePreviousLimitUpOnly(candidates);
      topicBoard = buildTopicBoard(decisionHotConcepts, marketCandidates, marketState, externalRisk);
    }
    if (["混沌", "冰点", "震荡"].includes(marketState.cycle) && topicBoard && Array.isArray(topicBoard.items) && topicBoard.items.length) {
      // topicBoard.mainLine = topicBoard.items[0]; // 已禁用：混沌期应基于真实主线强度选择，不应硬覆盖为第一名
    }
    const generationContext = createGenerationContext({
      tradingDate: limitStats && limitStats.dates && limitStats.dates.today,
      asOf: nowIso(),
    });
    const coreDataBundle = createDataBundle({ generationContext, envelopes: dataProviderEnvelopes });
    if (coreDataBundle.quality.status === "invalid") {
      const error = new Error("数据源输出未通过统一DataBundle契约");
      error.code = "DATA_BUNDLE_INVALID";
      error.details = coreDataBundle.quality.invalid;
      throw error;
    }
    const freshRoleContext = {
      generationContext,
      asOf: generationContext.asOf,
      generationId: generationContext.generationId,
      tradingDate: generationContext.tradingDate,
      updatedAt: generationContext.asOf,
      fetchedAt: generationContext.asOf,
      market: { snapshot: marketSnapshot, state: marketState, limitStats },
      topicBoard,
      hotConcepts: decisionHotConcepts,
      candidates,
    };
    freshRoleContext.themeLibrary = themeLibrarySnapshotFromPayload(freshRoleContext, "captured-bootstrap", {
      forceRebuild: true,
      generationContext,
    });
    applyThemeCycleIdentitiesToCandidates(freshRoleContext);

    // 基于topicBoard.mainLine进行二次过滤（这是真实主线，比hotConcepts[0]更准确）
    if (["混沌", "冰点", "震荡"].includes(marketState.cycle) && topicBoard && topicBoard.mainAttackSubtheme) {
      const focusLineName = String(topicBoard.mainLine.name || topicBoard.mainLine.displayName || "").trim();
      const focusLineFamily = String(topicBoard.mainLine.family || topicBoard.mainLine.name || "").trim();
      candidates.forEach((item) => {
        const match = [item && item.mainConcept, item && item.mainFamily, item && item.concept].some((value) => {
          const text = String(value || "").trim();
          return text && (text === focusLineName || text === focusLineFamily);
        });
        if (!match && !candidateRoleAuthority(item).coreAuthorized) {
          item.selected = false;
          if (item.setup && item.setup !== "剔除") item.setup = "剔除";
        }
      });
    }
    // 所有候选完成后再用“个股+细分方向+市场”三层证据重判资金性质，
    // 并按新自适应成交规则刷新交易门槛。净流出不再单项淘汰。
    refreshCandidateFlowAndGate(candidates, marketState, limitStats);















    // 主动性是龙头地位的首要条件。分时抓取失败时自动退回收盘代理，
    // 但不会把缺数据默认判成主动龙头，也不会阻断原有行情抓取。
    const leadershipTradingDate = generationContext.tradingDate || marketEmotionTradingDate(freshRoleContext);
    const retainedObservationBasis = readJsonFile(hotStocksCacheFile) || {};
    const leadershipTargets = mergeLeadershipTargets(
      selectLeadershipTargets(candidates, topicBoard, 24),
      observationRepresentativeLeadershipTargets({
        candidates,
        premarketModels: retainedObservationBasis.premarketModels || {},
      }),
      30,
    );
    const leadershipProviderResult = await requiredProviderCapability(
      providerRegistry,
      DATA_CAPABILITIES.INTRADAY_LEADERSHIP,
      [candidates, topicBoard, leadershipTradingDate, klineStats, { targets: leadershipTargets }],
      {
        observedAt: nowIso(),
        tradingDate: leadershipTradingDate,
        expectedTradingDate: leadershipTradingDate,
      },
    );
    const intradayLeadership = leadershipProviderResult.envelope.data;
    const initiativeFloorByCode = loadVerifiedInitiativeFloors(leadershipTradingDate);
    let leadershipBoard = buildCoreLeadershipBoard({
      candidates,
      topicBoard,
      marketState,
      intradayByCode: intradayLeadership,
      initiativeFloorByCode,
      archives: loadMarketEmotionArchives(leadershipTradingDate, 3),
    });

    freshRoleContext.leadershipBoard = leadershipBoard;
    const authorityBeforeFinalTheme = roleAuthoritySnapshot(candidates);
    freshRoleContext.themeLibrary = themeLibrarySnapshotFromPayload(freshRoleContext, "captured-final", {
      forceRebuild: true,
      generationContext,
    });
    applyThemeCycleIdentitiesToCandidates(freshRoleContext);
    if (roleAuthoritySnapshot(candidates) !== authorityBeforeFinalTheme) {
      leadershipBoard = buildCoreLeadershipBoard({
        candidates,
        topicBoard,
        marketState,
        intradayByCode: intradayLeadership,
        initiativeFloorByCode,
        archives: loadMarketEmotionArchives(leadershipTradingDate, 3),
      });
      freshRoleContext.leadershipBoard = leadershipBoard;
      freshRoleContext.themeLibrary = themeLibrarySnapshotFromPayload(freshRoleContext, "captured-settled", {
        forceRebuild: true,
        generationContext,
      });
      applyThemeCycleIdentitiesToCandidates(freshRoleContext);
    }
    refreshCandidateFlowAndGate(candidates, marketState, limitStats);
    applyRepairCoreRetention(candidates);
    hydrateTopicBoardLeadership(topicBoard, candidates);
    applyThemeDecisionToTopicBoard(topicBoard, freshRoleContext.themeLibrary);
    const emotionAnchor = buildEmotionAnchor(candidates, topicBoard, marketState);















    const capacityAnchor = buildCapacityAnchor(candidates, topicBoard, marketState);















    tradingStyle.analysis = buildStyleAnalysis(tradingStyle, marketState, decisionHotConcepts, marketCandidates, externalRisk);















    const framework = buildFrameworkView(















      tradingStyle.analysis,















      marketState,















      topicBoard,















      candidates,















      emotionAnchor,















      capacityAnchor,















    );















    const selectedLimit =















      marketState.cycle === "主升" ? 6















      : marketState.cycle === "震荡" ? 4















      : marketState.cycle === "混沌" ? 3















      : marketState.cycle === "冰点" ? 2















      : 0; // 退潮：不开放新仓，空仓































    // 消息面:给入选票挂近期个股新闻(东财节流串行约1秒/只,只做展示不参与打分)















    const newsTargets = candidates.filter((item) => item.selected).slice(0, Math.max(selectedLimit, 2));















    for (const item of newsTargets) {















      const stockNewsProviderResult = await requiredProviderCapability(
        providerRegistry,
        DATA_CAPABILITIES.STOCK_NEWS,
        [item.code, 6],
        { observedAt: nowIso() },
      );
      const feed = stockNewsProviderResult.envelope.data;















      if (feed.length) item.newsFeed = feed.slice(0, 3);















    }































    // 抓取状态明示：哪个源成功/失败/走了缓存，一目了然——失败静默回退误导判断是大忌















    const fetchStatus = buildFetchStatus({















      eastRank,















      thsRows,

      rankSources,















      brokenRows,















      klineOk: marketProfiled.filter((item) => item.klineProfile).length,
      klineRequested: Number(marketKlineScope.requested || 0),
      klineEast: Number(marketKlineScope.east || 0),
      klineLiveAccepted: Number(marketKlineScope.liveAccepted || 0),















      klineTencent: Number(marketKlineScope.tencent || 0),




      klineCached: Number(marketKlineScope.cached || 0),
      klineSameDayCache: Number(marketKlineScope.sameDayCache || 0),
      klineStaleCacheRejected: Number(marketKlineScope.staleCacheRejected || 0),
      klineUnavailable: Number(marketKlineScope.unavailable || 0),
      klineLiveFailed: Number(marketKlineScope.fail || 0),
      klineCacheTradingDates: { ...(marketKlineScope.cacheTradingDates || {}) },
      klineCacheMaxAgeMinutes: Array.isArray(marketKlineScope.cacheAgeMinutes) && marketKlineScope.cacheAgeMinutes.length
        ? Math.max(...marketKlineScope.cacheAgeMinutes) : null,
      klineSourceErrorSamples: Array.isArray(marketKlineScope.sourceErrorSamples)
        ? marketKlineScope.sourceErrorSamples.slice(0, 12) : [],
      klineSupplemental: supplementalKlineScope,
      expectedCompletedKlineDate,















      total: marketProfiled.length,















      unclassified: marketProfiled.filter((item) => !(item.concepts || []).filter(Boolean).length).length,















      sectorRows,















      marketSnapshot,















      limitStats,















      externalSnapshot,















    });































    const survivorBoard = buildSurvivorBoard(hotConcepts, marketCandidates, marketState, limitStats);

    const tomorrowOutlook = buildTomorrowOutlook(marketCandidates, marketState, limitStats, marketSnapshot, survivorBoard);















    const stamp = generationContext.asOf;





    const payload = {















      updatedAt: stamp,















      fetchedAt: stamp,















      sources: {















        eastmoney: eastRank.length,















        ths: thsRows.length,
        hotRanks: rankSources,
        dataProviderBundle: projectDataBundleMetadata(coreDataBundle),
        dataProviderConfiguration: { ...marketDataProviderDiagnostics },
        previousLimitUpSeeds: {
          authority: "exact_t1_closing_limit_pool",
          expectedTradingDate: previousLimitUpExpectedDate || null,
          exactPreviousPayloadAvailable: Boolean(previousLimitUpPayload),
          seedCount: previousLimitUpSeeds.length,
          previousLimitUpOnlyCount: previousLimitUpOnlyRows.length,
          quoteAvailableCount: profiled.filter((item) => (
            item.previousLimitUpOnly === true && Number.isFinite(Number(item.price)) && Number(item.price) > 0
          )).length,
          klineAvailableCount: profiled.filter((item) => (
            item.previousLimitUpOnly === true && item.klineProfile
          )).length,
          priceDiscoveryVerifiedCount: previousLimitUpSeeds.filter((seed) => (
            seed.previousLimitUpEvidence && seed.previousLimitUpEvidence.priceDiscoveryVerified === true
          )).length,
          marketSamplesExcluded: true,
          executionAuthority: false,
        },
        styleOutcomes: {
          authority: "frozen_t_close_style_cohort_t1_quote",
          previousTradingDate: previousLimitUpExpectedDate || null,
          requested: styleOutcomeSeeds.length,
          available: styleOutcomeRows.filter((row) => row.styleOutcomeQuoteVerified === true).length,
          marketSamplesExcluded: true,
          executionAuthority: false,
        },
        klineDiagnostics: {
          version: 3,
          authority: "market_candidate_kline_scope",
          supplementalObservationExcluded: true,
          statusKey: fetchStatus && fetchStatus.mode || null,
          expectedCompletedTradingDate: expectedCompletedKlineDate || null,
          requested: Number(marketKlineScope.requested || 0),
          marketCandidates: marketProfiled.length,
          supplementalCandidates: Number(supplementalKlineScope.requested || 0),
          east: Number(marketKlineScope.east || 0),
          tencent: Number(marketKlineScope.tencent || 0),
          liveAccepted: Number(marketKlineScope.liveAccepted || 0),
          liveDateMismatch: Number(marketKlineScope.liveDateMismatch || 0),
          cached: Number(marketKlineScope.cached || 0),
          sameDayCache: Number(marketKlineScope.sameDayCache || 0),
          staleCacheRejected: Number(marketKlineScope.staleCacheRejected || 0),
          unavailable: Number(marketKlineScope.unavailable || 0),
          failed: Number(marketKlineScope.fail || 0),
          totalRequested: Number(klineStats.requested || 0),
          totalUnavailable: Number(klineStats.unavailable || 0),
          marketScope: {
            authority: "market_candidate_kline_scope",
            affectsClosingDecision: true,
            statusKey: fetchStatus && fetchStatus.mode || null,
            expectedCompletedTradingDate: expectedCompletedKlineDate || null,
            requestedCount: Number(marketKlineScope.requested || 0),
            liveCount: Number(marketKlineScope.liveAccepted || 0),
            sameDayCacheCount: Number(marketKlineScope.sameDayCache || 0),
            staleCacheRejectedCount: Number(marketKlineScope.staleCacheRejected || 0),
            unavailableCount: Number(marketKlineScope.unavailable || 0),
            liveFailureCount: Number(marketKlineScope.fail || 0),
            profileFailureCount: Number(marketKlineScope.profileFailures || 0),
            eligibleForClosingDecision: Boolean(fetchStatus && fetchStatus.kline
              && fetchStatus.kline.eligibleForClosingDecision === true),
            cacheTradingDates: { ...(marketKlineScope.cacheTradingDates || {}) },
          },
          operationalTotals: {
            requested: Number(klineStats.requested || 0),
            liveAccepted: Number(klineStats.liveAccepted || 0),
            cached: Number(klineStats.cached || 0),
            sameDayCache: Number(klineStats.sameDayCache || 0),
            staleCacheRejected: Number(klineStats.staleCacheRejected || 0),
            unavailable: Number(klineStats.unavailable || 0),
            profileFailures: Number(klineStats.profileFailures || 0),
          },
          liveAttempts: {
            eastmoneyStocks: Number(klineStats.eastAttempts || 0),
            tencentStocks: Number(klineStats.tencentAttempts || 0),
            tencentHttpRequests: Number(klineStats.tencentHttpAttempts || 0),
            tencentRetrySuccesses: Number(klineStats.tencentRetrySuccess || 0),
            tencentRawRequests: Number(klineStats.tencentRawAttempts || 0),
            tencentRawSuccesses: Number(klineStats.tencentRaw || 0),
          },
          sourceFailures: {
            eastmoney: Number(klineStats.eastFailures || 0),
            tencent: Number(klineStats.tencentFailures || 0),
            tencentQfq: Number(klineStats.tencentQfqFailures || 0),
          },
          sourceSkipped: {
            eastmoney: Number(klineStats.eastSkipped || 0),
            tencent: Number(klineStats.tencentSkipped || 0),
          },
          circuitOpen: {
            eastmoney: klineStats.eastDisabled === true,
            tencent: klineStats.tencentDisabled === true,
            tencentQfq: klineStats.tencentQfqDisabled === true,
          },
          supplementalScope: {
            authority: "observation_only_supplemental_kline_scope",
            affectsClosingDecision: false,
            observationOnly: true,
            executionAuthority: false,
            marketEvidenceImpact: false,
            requestedCount: Number(supplementalKlineScope.requested || 0),
            liveCount: Number(supplementalKlineScope.liveAccepted || 0),
            sameDayCacheCount: Number(supplementalKlineScope.sameDayCache || 0),
            staleCacheRejectedCount: Number(supplementalKlineScope.staleCacheRejected || 0),
            unavailableCount: Number(supplementalKlineScope.unavailable || 0),
            liveFailureCount: Number(supplementalKlineScope.fail || 0),
            sourceErrorSamples: Array.isArray(supplementalKlineScope.sourceErrorSamples)
              ? supplementalKlineScope.sourceErrorSamples.slice(0, 12) : [],
            profileErrorSamples: Array.isArray(supplementalKlineScope.profileErrorSamples)
              ? supplementalKlineScope.profileErrorSamples.slice(0, 12) : [],
          },
          providers: {
            eastmoney: {
              succeeded: Number(marketKlineScope.east || 0),
              attemptedStocks: Number(klineStats.eastAttempts || 0),
              failures: Number(klineStats.eastFailures || 0),
              skipped: Number(klineStats.eastSkipped || 0),
              circuitOpen: klineStats.eastDisabled === true,
            },
            tencent: {
              succeeded: Number(marketKlineScope.tencent || 0),
              qfqSucceeded: Number(klineStats.tencentQfq || 0),
              qfqCircuitOpen: klineStats.tencentQfqDisabled === true,
              qfqFailures: Number(klineStats.tencentQfqFailures || 0),
              rawFallbackSucceeded: Number(klineStats.tencentRaw || 0),
              qfqFallbackCount: Number(klineStats.tencentQfqFallbacks || 0),
              attemptedStocks: Number(klineStats.tencentAttempts || 0),
              httpRequests: Number(klineStats.tencentHttpAttempts || 0),
              rawHttpRequests: Number(klineStats.tencentRawAttempts || 0),
              retrySuccesses: Number(klineStats.tencentRetrySuccess || 0),
              failures: Number(klineStats.tencentFailures || 0),
              skipped: Number(klineStats.tencentSkipped || 0),
              circuitOpen: klineStats.tencentDisabled === true,
            },
            cache: {
              acceptedSameDay: Number(marketKlineScope.sameDayCache || 0),
              rejectedStaleOrIncomplete: Number(marketKlineScope.staleCacheRejected || 0),
              tradingDates: { ...(marketKlineScope.cacheTradingDates || {}) },
            },
          },
          cacheTradingDates: { ...(marketKlineScope.cacheTradingDates || {}) },
          cacheMaxAgeMinutes: Array.isArray(marketKlineScope.cacheAgeMinutes) && marketKlineScope.cacheAgeMinutes.length
            ? Math.max(...marketKlineScope.cacheAgeMinutes) : null,
          sourceErrorSamples: Array.isArray(marketKlineScope.sourceErrorSamples)
            ? marketKlineScope.sourceErrorSamples.slice(0, 12) : [],
          profileFailures: Number(marketKlineScope.profileFailures || 0),
          profileErrorSamples: Array.isArray(marketKlineScope.profileErrorSamples)
            ? marketKlineScope.profileErrorSamples
            : [],
        },
        intradayLeadershipDiagnostics: klineStats.intradayLeadership || {
          authority: "exact_date_intraday_leadership_evidence",
          expectedTradingDate: leadershipTradingDate || null,
          targetCount: 0,
          verifiedCount: 0,
          missingCount: 0,
          sourceCounts: { eastmoney: 0, tencent: 0, cache: 0 },
        },

        jiuyanTimeline: jiuyanTimeline && Array.isArray(jiuyanTimeline.items) ? jiuyanTimeline.items.length : 0,

        marketRiskCalendar: marketRiskCalendar && Array.isArray(marketRiskCalendar.items) ? marketRiskCalendar.items.length : 0,















      },















      fetchStatus,

      eventCalendar: combinedEventCalendar,















      market: {















        snapshot: marketSnapshot,















        state: marketState,















        tradingStyle,

        marketCapCarrier,















        externalRisk,















        limitStats,















      },















      usFramework,

      externalCoreAlert: usFramework && usFramework.coreAlert
        ? usFramework.coreAlert
        : { active: false, thresholdPct: -5, monitoredCount: 0, items: [], note: "仅页面提醒，不参与决策" },















      riskBoard,















      framework,















      topicBoard,















      leadershipBoard,

      themeLibrary: freshRoleContext.themeLibrary,

      bestPicks: provisionalBestPicks(),















      survivorBoard,















      tomorrowOutlook,















      masterLeader: emotionAnchor,















      emotionAnchor,















      capacityAnchor,















      decisionHotConcepts,
      hotConcepts,















      news: { global: globalNews.slice(0, 20) },















      selected: candidates.filter((item) => item.selected).slice(0, selectedLimit),















      rejected: candidates.filter((item) => !item.selected).slice(0, 20),















      candidates,
      styleOutcomeRows,















    };































    attachGenerationContext(payload, generationContext);
    payload.coreWatch = syncCoreWatchPool(payload);
    if (payload.market && payload.market.state) {
      hydrateEmotionCyclePersistenceEvidence(payload, { generationContext });
      payload.market.state.effectAttribution = buildMarketEffectAttribution(marketSamplePayload(payload));
    }
    payload.marketEmotion = buildMarketEmotionObservation(payload);
    payload.marketStrengthSource = buildMarketStrengthSource(payload);
    payload.superExpectation = buildSuperExpectationSnapshot(payload);
    payload.eventInference = buildEventInferenceSnapshot(payload);
    applyThemeCycleIdentitiesToCandidates(payload);
    const styleOutcomeRowsForDecision = styleOutcomeRowsOf(payload);
    refreshPremarketModels(payload, { generationContext, styleOutcomeRows: styleOutcomeRowsForDecision });
    refreshTomorrowDecision(payload, { generationContext, styleOutcomeRows: styleOutcomeRowsForDecision });
    const cycleHistoryResult = persistCycleHistorySnapshot(payload, { generationContext });
    const formalArchiveResult = autoArchiveMarketSnapshot(payload, {
      trigger: "successful-fetch",
      generationContext,
    });
    payload.persistenceAudit = {
      version: 1,
      tradingDate: generationContext.tradingDate,
      generationId: generationContext.generationId,
      asOf: generationContext.asOf,
      cycleHistory: {
        ok: cycleHistoryResult.ok === true,
        required: cycleHistoryResult.required === true,
        skipped: cycleHistoryResult.skipped === true,
        reason: cycleHistoryResult.reason || null,
        blockers: Array.isArray(cycleHistoryResult.blockers) ? cycleHistoryResult.blockers.slice() : [],
      },
      formalDecisionHistory: {
        ok: formalArchiveResult.ok === true,
        skipped: formalArchiveResult.skipped === true,
        reason: formalArchiveResult.reason || null,
        receiptStatus: formalArchiveResult.receiptStatus || null,
      },
    };
    if (cycleHistoryResult.required === true && cycleHistoryResult.ok !== true) {
      markCycleHistoryUnavailable(payload, cycleHistoryResult);
    }















    const retainedPayload = writeRetainedJson(hotStocksCacheFile, payload, { archiveDir: hotStocksCacheArchiveDir });
    if (!retainedPayload) {
      const error = new Error("最新抓取已生成，但主缓存写入失败；本代次不得标记为刷新成功");
      error.code = "HOT_STOCKS_CACHE_WRITE_FAILED";
      throw error;
    }















    return payload;















  } catch (error) {















    const fallback = loadHotStocksFallback();















    if (fallback) {















      console.error(`[hot-stocks-payload] ${String(error && error.stack || error)}`);
      return stampPayload(fallback, error.message);















    }















    throw error;















  }















}































const HOT_STOCKS_RESPONSE_TIMEOUT_MS = Math.max(
  15000,
  Number(process.env.HOT_STOCKS_RESPONSE_TIMEOUT_MS || 40000),
);

function createHotStocksRefreshController(refreshFn, clock = () => new Date()) {
  let inFlightPromise = null;
  let state = {
    status: "idle",
    startedAt: null,
    completedAt: null,
    lastSuccessAt: null,
    generationId: null,
    lastError: null,
    quality: null,
    sourceLevel: null,
    evidenceStatus: null,
  };

  const nowIso = () => {
    const value = clock();
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  };
  const getStatus = () => ({ ...state, inFlight: Boolean(inFlightPromise) });

  function start() {
    if (inFlightPromise) {
      return { started: false, promise: inFlightPromise, refresh: getStatus() };
    }

    state = {
      ...state,
      status: "running",
      startedAt: nowIso(),
      completedAt: null,
      generationId: null,
      lastError: null,
      quality: null,
      sourceLevel: null,
      evidenceStatus: null,
    };

    let job;
    job = Promise.resolve()
      .then(() => refreshFn())
      .then((payload) => {
        // hotStocksPayload can deliberately return a stamped disk fallback.
        // That keeps the UI usable, but it is not a successful live refresh.
        if (payload && payload.stale === true) {
          const error = new Error(String(payload.fetchError || "刷新返回了过期快照"));
          error.code = "HOT_STOCKS_REFRESH_FALLBACK";
          throw error;
        }
        if (!payload || !String(payload.generationId || "").trim()) {
          const error = new Error("刷新结果缺少 generationId，不得标记为成功");
          error.code = "HOT_STOCKS_REFRESH_GENERATION_MISSING";
          throw error;
        }
        return payload;
      })
      .then(
        (payload) => {
          const completedAt = nowIso();
          const fetchStatus = payload.fetchStatus && typeof payload.fetchStatus === "object"
            ? payload.fetchStatus : {};
          state = {
            status: "succeeded",
            startedAt: state.startedAt,
            completedAt,
            lastSuccessAt: completedAt,
            generationId: String(payload.generationId).trim(),
            lastError: null,
            quality: String(fetchStatus.operationalLevel || "unknown"),
            sourceLevel: String(fetchStatus.level || "") || null,
            evidenceStatus: String(fetchStatus.evidenceStatus || "") || null,
          };
          return payload;
        },
        (error) => {
          state = {
            ...state,
            status: "failed",
            completedAt: nowIso(),
            generationId: null,
            lastError: String(error && error.message || error || "unknown error"),
          };
          throw error;
        },
      )
      .finally(() => {
        if (inFlightPromise === job) inFlightPromise = null;
      });

    inFlightPromise = job;
    // Background POST callers do not await the job; observe rejection here so
    // Node never reports it as an unhandled promise rejection.
    job.catch(() => {});
    return { started: true, promise: job, refresh: getStatus() };
  }

  return { getStatus, start };
}

const hotStocksRefreshController = createHotStocksRefreshController(() => hotStocksPayload());

const HOT_STOCKS_AUTO_REFRESH_CHECK_MS = Math.max(
  60_000,
  Number(process.env.HOT_STOCKS_AUTO_REFRESH_CHECK_MS || 5 * 60 * 1000),
);
const HOT_STOCKS_AUTO_REFRESH_RETRY_MS = Math.max(
  60_000,
  Number(process.env.HOT_STOCKS_AUTO_REFRESH_RETRY_MS || 15 * 60 * 1000),
);
const HOT_STOCKS_AUTO_REFRESH_START_DELAY_MS = Math.max(
  250,
  Number(process.env.HOT_STOCKS_AUTO_REFRESH_START_DELAY_MS || 1500),
);

function hotStocksAutoRefreshKey(now = new Date()) {
  const clock = shanghaiClockParts(now);
  if (!clock || !clock.date) return null;
  const date = new Date(`${clock.date}T12:00:00Z`);
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return `${clock.date}:non_trading_day`;
  const minutes = clock.hour * 60 + clock.minute;
  return `${clock.date}:${minutes >= 15 * 60 + 5 ? "postclose" : "preclose"}`;
}

function createHotStocksAutoRefreshScheduler(controller, options = {}) {
  const clock = typeof options.clock === "function" ? options.clock : () => new Date();
  const checkMs = Math.max(1, Number(options.checkMs || HOT_STOCKS_AUTO_REFRESH_CHECK_MS));
  const retryMs = Math.max(1, Number(options.retryMs || HOT_STOCKS_AUTO_REFRESH_RETRY_MS));
  const startDelayMs = Math.max(0, Number(options.startDelayMs ?? HOT_STOCKS_AUTO_REFRESH_START_DELAY_MS));
  let lastAttemptKey = null;
  let lastAttemptAt = 0;
  let lastSuccessKey = null;
  let stopped = false;

  const run = (reason = "periodic") => {
    if (stopped) return { started: false, reason: "stopped" };
    const now = clock();
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    const key = hotStocksAutoRefreshKey(now);
    if (!key || !Number.isFinite(nowMs)) return { started: false, reason: "clock_invalid" };
    const status = controller.getStatus();
    if (status.inFlight) return { started: false, reason: "in_flight", key };
    if (lastSuccessKey === key) return { started: false, reason: "already_succeeded", key };
    if (lastAttemptKey === key && nowMs - lastAttemptAt < retryMs) {
      return { started: false, reason: "retry_wait", key };
    }
    lastAttemptKey = key;
    lastAttemptAt = nowMs;
    const started = controller.start();
    started.promise.then(
      () => { lastSuccessKey = key; },
      (error) => {
        console.error(`[hot-stocks-auto-refresh:${reason}] ${String(error && error.message || error)}`);
      },
    );
    return { started: started.started, reason, key };
  };

  const startupTimer = setTimeout(() => run("startup"), startDelayMs);
  const interval = setInterval(() => run("periodic"), checkMs);
  if (typeof startupTimer.unref === "function") startupTimer.unref();
  if (typeof interval.unref === "function") interval.unref();
  return {
    run,
    stop() {
      stopped = true;
      clearTimeout(startupTimer);
      clearInterval(interval);
    },
    getStatus: () => ({ lastAttemptKey, lastAttemptAt, lastSuccessKey, stopped }),
  };
}

let hotStocksAutoRefreshScheduler = null;

function startHotStocksAutoRefreshScheduler() {
  if (!hotStocksAutoRefreshScheduler) {
    hotStocksAutoRefreshScheduler = createHotStocksAutoRefreshScheduler(hotStocksRefreshController);
  }
  return hotStocksAutoRefreshScheduler;
}

function getOrStartHotStocksRefresh() {
  return hotStocksRefreshController.start().promise;
}

async function stableHotStocksPayload() {
  const job = getOrStartHotStocksRefresh();
  let timeout;
  try {
    return await Promise.race([
      job,
      new Promise((resolve, reject) => {
        timeout = setTimeout(
          () => {
            const error = new Error("实时抓取响应较慢，已先切换最近缓存");
            error.code = "HOT_STOCKS_TIMEOUT";
            reject(error);
          },
          HOT_STOCKS_RESPONSE_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    console.error(`[hot-stocks-refresh] ${String(error && error.stack || error)}`);
    const fallback = loadHotStocksFallback();
    if (fallback) {
      return stampPayload(fallback, error.message, {
        backgroundRefresh: error && error.code === "HOT_STOCKS_TIMEOUT",
      });
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// 实时面板锚定：核心指数（大盘锚）+ 当前短线龙头/选中票（题材锚），从最新热股缓存动态读取















function deriveAnchorSymbols() {















  const indexSymbols = ["000001.SH", "399006.SZ"]; // 上证指数 + 创业板指















  const leaders = [];















  try {















    const cache = loadHotStocksFallback();















    const pool = cache ? (cache.selected && cache.selected.length ? cache.selected : cache.candidates || []) : [];















    for (const item of pool) {















      const sym = normalizeAshareSymbol(item && (item.code || item.symbol));















      if (sym && !leaders.includes(sym) && !indexSymbols.includes(sym)) leaders.push(sym);















      if (leaders.length >= 6) break;















    }















  } catch {}















  return leaders.length ? [...indexSymbols, ...leaders] : DEFAULT_REALTIME_SYMBOLS;















}































async function realtimePayload(symbols) {















  const normalizedSymbols = normalizeSymbolList(symbols);















  const fallbackSymbols = normalizedSymbols.length ? normalizedSymbols : deriveAnchorSymbols();















  const result = await realtimeMarketDataSource.fetchTicks(fallbackSymbols);















  return {















    updatedAt: nowIso(),















    fetchedAt: nowIso(),















    symbols: fallbackSymbols,















    source: result.source || "fallback",















    source_chain: result.source_chain || [],















    data: result.data || [],















    health: getDataSourceHealthSnapshot(),















  };















}































function readJsonBody(request) {















  return new Promise((resolve, reject) => {















    let raw = "";















    request.on("data", (chunk) => {















      raw += chunk;















      if (raw.length > 1e6) { reject(new Error("body too large")); request.destroy(); }















    });















    request.on("end", () => {















      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("invalid JSON body")); }















    });















    request.on("error", reject);















  });















}































/** 红线卡取数:优先热股缓存里的 klineProfile(免网络),缺了再实时拉一次K线兜底 */















async function resolveRedlineQuote(code) {















  const cached = loadHotStocksFallback();















  if (cached) {















    const pools = [...(cached.selected || []), ...(cached.rejected || []), ...(cached.candidates || [])];















    const hit = pools.find((s) => s.code === code);















    const kp = hit && hit.klineProfile;















    if (kp && kp.lastClose != null && kp.ma5 != null) {















      return { prevClose: kp.lastClose, ma5: kp.ma5, source: "hot-stocks-cache" };















    }















  }















  const rows = await fetchKlineRows({ code }, 30);















  const profile = computeMaProfile(rows);















  if (profile) return { prevClose: profile.lastClose, ma5: profile.ma5, source: "kline-live" };















  // 都拿不到:红线卡照出,价格线标数据缺失(buildRedlineCard 会入 missing)















  return { prevClose: null, ma5: null, source: "unavailable" };















}































async function handleApi(request, response, pathname) {

  if (pathname === "/api/cloud-current-sync/status") {
    if (request.method !== "GET") {
      sendJson(response, 405, { ok: false, error: "Method not allowed" });
      return;
    }
    sendJson(response, 200, { ok: true, sync: publicCloudCurrentSyncStatus() });
    return;
  }

  if (pathname === "/api/cloud-current-sync/run") {
    if (request.method !== "POST") {
      sendJson(response, 405, { ok: false, error: "Method not allowed" });
      return;
    }
    const started = startCloudCurrentSync("manual");
    if (!started.accepted) {
      sendJson(response, 503, {
        ok: false,
        error: started.error,
        code: started.code,
        sync: publicCloudCurrentSyncStatus(),
      });
      return;
    }
    sendJson(response, 202, {
      ok: true,
      accepted: true,
      reused: started.reused,
      sync: publicCloudCurrentSyncStatus(),
    });
    return;
  }

  if (pathname === "/api/cloud-current-sync/payload") {
    if (request.method !== "GET") {
      sendJson(response, 405, { ok: false, error: "Method not allowed" });
      return;
    }
    await sendVerifiedCloudCurrentSnapshot(response);
    return;
  }

  if (pathname === "/api/cloud-history-sync/status") {
    if (request.method !== "GET") {
      sendJson(response, 405, { ok: false, error: "Method not allowed" });
      return;
    }
    sendJson(response, 200, { ok: true, sync: publicCloudHistorySyncStatus() });
    return;
  }

  if (pathname === "/api/cloud-history-sync/run") {
    if (request.method !== "POST") {
      sendJson(response, 405, { ok: false, error: "Method not allowed" });
      return;
    }
    const started = startCloudHistorySync("manual");
    if (!started.accepted) {
      sendJson(response, 503, {
        ok: false,
        error: started.error,
        code: started.code,
        sync: publicCloudHistorySyncStatus(),
      });
      return;
    }
    sendJson(response, 202, {
      ok: true,
      accepted: true,
      reused: started.reused,
      sync: publicCloudHistorySyncStatus(),
    });
    return;
  }















  if (pathname === "/api/realtime") {















    try {















      const requestedSymbols = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`).searchParams.get("symbols");















      sendJson(response, 200, await realtimePayload(requestedSymbols || undefined));















    } catch (error) {















      sendJson(response, 200, {















        updatedAt: nowIso(),















        fetchedAt: nowIso(),















        symbols: DEFAULT_REALTIME_SYMBOLS,















        source: "mock",















        source_chain: [],















        data: DEFAULT_REALTIME_SYMBOLS.map((symbol, index) => buildMockQuote(symbol, index)),















        health: getDataSourceHealthSnapshot(),















        error: error.message,















      });















    }















    return;















  }































  if (pathname === "/api/data-sources/health") {















    sendJson(response, 200, {















      updatedAt: nowIso(),















      sources: getDataSourceHealthSnapshot(),















    });















    return;















  }































  if (await journalHandler(request, response, pathname)) return;















  if (await preplanHandler(request, response, pathname)) return;

  if (await themeAttributionReviewHandler(request, response, pathname)) return;































  // ===== 盘后归档（archiver.js 的界面入口）：一键落库 + 历史报告查看 =====















  if (pathname === "/api/archive/run" && request.method === "POST") {















    try {















      const payload = loadHotStocksFallback();















      if (!payload || !payload.updatedAt) {















        sendJson(response, 400, { ok: false, error: "无抓取缓存——先在页面抓取一次再归档" });















        return;















      }















      normalizeLeadershipPayload(payload);















      const date = marketSnapshotTradingDate(payload) || String(payload.updatedAt).slice(0, 10);















      const archivePayload = {
        ...payload,
        archiveMeta: {
          ...(payload.archiveMeta || {}),
          mode: "manual",
          trigger: "manual-button",
          tradingDate: date,
          snapshotKind: marketSnapshotKind(payload, date),
          archivedAt: nowIso(),
        },
      };
      const result = autoArchiveMarketSnapshot(archivePayload, { mode: "manual", trigger: "manual-button" });















      if (!result.ok) {
        sendJson(response, 400, { ok: false, error: result.error || result.reason || "归档失败" });
        return;
      }
      sendJson(response, 200, {
        ok: true,
        date: result.tradingDate,
        skipped: result.skipped,
        reason: result.reason || null,
        receiptId: result.receiptId || null,
        receiptStatus: result.receiptStatus || null,
        canonicalDecisionReceipt: result.canonicalDecisionReceipt === true,
        outcomeSettlement: result.outcomeSettlement || null,
        summary: result.summary || null,
      });















    } catch (error) {















      sendJson(response, 500, { ok: false, error: error.message });















    }















    return;















  }















  if (pathname === "/api/archive/list") {















    try {















      const { loadArchiveIndex } = require("./archiver");















      const index = loadArchiveIndex(path.join(runtimeRoot, "data", "history"));















      sendJson(response, 200, { rows: Array.isArray(index) ? index.slice().reverse() : [] });















    } catch (error) {















      sendJson(response, 500, { ok: false, error: error.message });















    }















    return;















  }















  if (pathname.startsWith("/api/archive/report")) {















    const date = String(new URL(request.url, "http://x").searchParams.get("date") || "");















    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {















      sendJson(response, 400, { ok: false, error: "date 参数格式应为 YYYY-MM-DD" });















      return;















    }















    try {















      const markdown = fs.readFileSync(path.join(runtimeRoot, "data", "reports", `${date}.md`), "utf8");















      sendJson(response, 200, { ok: true, date, markdown });















    } catch {















      sendJson(response, 404, { ok: false, error: `${date} 无归档报告` });















    }















    return;















  }































  if (pathname === "/api/decision-ledger/audit") {
    try {
      const { auditDecisionReceiptSnapshots } = require("./quant-decision/decision-receipt-audit");
      const historyDir = path.join(runtimeRoot, "data", "history");
      sendJson(response, 200, auditDecisionReceiptSnapshots(historyDir));
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/decision-ledger/current") {
    try {
      const requestUrl = new URL(request.url, "http://x");
      const requestedDate = normalizeTradingDate(requestUrl.searchParams.get("date"));
      const historyDir = path.join(runtimeRoot, "data", "history");
      const availableFiles = fs.existsSync(historyDir)
        ? fs.readdirSync(historyDir).filter((name) => /^20\d{2}-\d{2}-\d{2}\.json$/.test(name)).sort().reverse()
        : [];
      const selectedFile = requestedDate
        ? `${requestedDate}.json`
        : availableFiles.find((name) => {
          const snapshot = readJsonFile(path.join(historyDir, name));
          return snapshot && snapshot.decisionReceipt;
        });
      const snapshot = selectedFile ? readJsonFile(path.join(historyDir, selectedFile)) : null;
      if (!snapshot) {
        sendJson(response, 404, { ok: false, error: "没有找到对应的决策归档" });
        return;
      }
      const receipt = snapshot.decisionReceipt || null;
      const receiptInspection = receipt ? validateDecisionReceipt(receipt, {
        sourcePayload: snapshot,
        snapshotKind: snapshot.archiveMeta && snapshot.archiveMeta.snapshotKind,
      }) : { liveCanonical: false, reasons: ["legacy_archive_without_decision_receipt"] };
      const tradingDate = normalizeTradingDate(
        snapshot.archiveMeta && snapshot.archiveMeta.tradingDate
        || snapshot.market && snapshot.market.limitStats && snapshot.market.limitStats.dates
          && snapshot.market.limitStats.dates.today,
      );
      const outcome = tradingDate
        ? readJsonFile(path.join(runtimeRoot, "data", "decision-outcomes", `${tradingDate}.json`))
        : null;
      sendJson(response, 200, {
        ok: true,
        tradingDate,
        snapshotKind: snapshot.archiveMeta && snapshot.archiveMeta.snapshotKind || "unknown",
        asDecided: receiptInspection.liveCanonical === true,
        receiptStatus: receipt && receipt.status || "legacy_without_receipt",
        receiptInspection,
        receipt,
        outcome,
        rule: "只有live_canonical收盘凭证属于当晚真实输出；旧档与当前引擎回放不进入本接口的asDecided口径",
      });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/decision-ledger/settle" && request.method === "POST") {
    try {
      const { refreshDecisionOutcomeLedger } = require("./quant-decision/decision-ledger");
      sendJson(response, 200, refreshDecisionOutcomeLedger({ runtimeRoot }));
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/theme-library") {
    if (request.method !== "GET") {
      sendJson(response, 405, { ok: false, error: "Method Not Allowed" });
      return;
    }
    const rawDate = clean(new URL(request.url, "http://x").searchParams.get("date"));
    const requestedDate = rawDate ? normalizeThemeLibraryDate(rawDate) : "";
    if (rawDate && !requestedDate) {
      sendJson(response, 400, { ok: false, available: false, error: "date 参数格式应为 YYYY-MM-DD" });
      return;
    }
    try {
      const result = buildThemeLibraryApiResponse(requestedDate);
      sendJson(response, result.status, result.payload);
    } catch (error) {
      sendJson(response, 500, { ok: false, available: false, error: error.message || "题材库读取失败" });
    }
    return;
  }

  if (pathname === "/api/index-opportunity/evidence") {
    serveIndexOpportunityEvidence(request, response, {
      historyDir: path.join(runtimeRoot, "data", "history"),
      revisionRoot: path.join(runtimeRoot, "data", "history-revisions"),
      sendJson,
    });
    return;
  }

  if (pathname === "/api/data-providers/status") {
    if (request.method !== "GET") {
      sendJson(response, 405, { ok: false, error: "Method Not Allowed" });
      return;
    }
    sendJson(response, 200, { ok: true, dataProviders: dataProviderStatus() });
    return;
  }

  if (pathname === "/api/hot-stocks/status") {
    if (request.method !== "GET") {
      sendJson(response, 405, { ok: false, error: "Method Not Allowed" });
      return;
    }
    sendJson(response, 200, { ok: true, refresh: hotStocksRefreshController.getStatus() });
    return;
  }

  if (pathname === "/api/hot-stocks/refresh") {
    if (request.method !== "POST") {
      sendJson(response, 405, { ok: false, error: "Method Not Allowed" });
      return;
    }
    const started = hotStocksRefreshController.start();
    sendJson(response, 202, { ok: true, refresh: started.refresh });
    return;
  }

  if (pathname === "/api/hot-stocks/cache") {
    if (request.method !== "GET") {
      sendJson(response, 405, { ok: false, error: "Method Not Allowed" });
      return;
    }
    const cached = loadHotStocksFallback();
    if (!cached) {
      sendJson(response, 404, { error: "暂无已保存的抓取数据" });
      return;
    }

    // This endpoint remains read-only on disk, but the response must pass the
    // same in-memory canonical migration as /api/hot-stocks. Returning the raw
    // cache would let an old decision/bestPicks bypass the unified chain.
    const normalizedCached = normalizeHotStocksFallbackResponse(cached, "", { stamp: false });
    sendJson(response, 200, {
      ...normalizedCached,
      restoredFromDisk: true,
      savedAt: normalizedCached.updatedAt || normalizedCached.fetchedAt || null,
    });
    return;
  }

  if (pathname === "/api/core-watch/list") {















    const store = readCoreWatchStore();















    sendJson(response, 200, store);















    return;















  }















  if (pathname === "/api/sell-advisor/v7-evaluate") {
    if (request.method !== "POST") {
      sendJson(response, 405, { ok: false, error: "Method Not Allowed" });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const allowedKeys = new Set([
        "tradingDate", "positionContext", "dailyContext", "upperLayer",
      ]);
      const unknownKeys = Object.keys(body || {}).filter((key) => !allowedKeys.has(key));
      if (unknownKeys.length) {
        sendJson(response, 400, {
          ok: false,
          error: `V7卖出输入含未授权字段: ${unknownKeys.join(",")}`,
        });
        return;
      }
      const decision = evaluateV7SellDecision(body, { root: runtimeRoot });
      sendJson(response, 200, { ok: decision.status !== "unavailable", decision });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message || "V7卖出评估失败" });
    }
    return;
  }

  if (pathname === "/api/sell-advisor/holdings") {
    if (request.method === "GET") {
      sendJson(response, 200, readSellAdvisorHoldingsStore());
      return;
    }

    if (request.method === "PUT" || request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        if (!body || !Array.isArray(body.holdings)) {
          sendJson(response, 400, { ok: false, error: "holdings 必须是数组" });
          return;
        }
        const store = writeSellAdvisorHoldingsStore(body.holdings);
        sendJson(response, 200, { ok: true, ...store });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: error.message || "持仓保存失败" });
      }
      return;
    }

    sendJson(response, 405, { ok: false, error: "Method Not Allowed" });
    return;
  }

  if (pathname === "/api/event-timeline/refresh" && request.method === "POST") {
    const cached = loadHotStocksFallback();
    if (!cached) {
      sendJson(response, 409, { ok: false, error: "请先完成一次市场抓取，再单独更新事件时间轴" });
      return;
    }
    normalizeLeadershipPayload(cached);
    try {
      const [refreshedJiuyanTimeline, refreshedMarketCalendar] = await Promise.all([
        fetchJiuyanTimeline({
          cacheFile: jiuyanTimelineCacheFile,
          forceRefresh: true,
        }),
        fetchMarketCalendar({
          cacheFile: marketCalendarCacheFile,
          forceRefresh: true,
        }),
      ]);
      cached.eventCalendar = mergeCalendarSources(refreshedJiuyanTimeline, refreshedMarketCalendar);
      cached.eventInference = buildEventInferenceSnapshot(cached);
      writeRetainedJson(hotStocksCacheFile, cached, { archiveDir: hotStocksCacheArchiveDir });
      autoArchiveMarketSnapshot(cached, { trigger: "event-timeline-refresh" });
      sendJson(response, 200, {
        ok: true,
        updatedAt: nowIso(),
        eventCalendar: cached.eventCalendar,
        eventInference: cached.eventInference,
      });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: "事件时间轴更新失败",
        detail: error && error.message || "unknown error",
      });
    }
    return;
  }

  if (pathname === "/api/news") {















    sendJson(response, 200, { updatedAt: nowIso(), global: await fetchGlobalNews(50) });















    return;















  }































  // 红线卡:预案的百分比红线换算成具体价格(redline.js 纯函数,此处只负责找预案+喂昨收/MA5)















  if (pathname === "/api/redline" && request.method === "POST") {















    try {















      const body = await readJsonBody(request); // { code, date?, buyPrice? }















      const date = body.date || preplanTodayYmd();















      const plansFile = path.join(runtimeRoot, "data", "preplans.json");















      const plan = loadPreplans(plansFile).find((p) => p.planDate === date && p.code === String(body.code));















      if (!plan) {















        sendJson(response, 404, { ok: false, error: `无 ${date} ${body.code} 的盘前预案——先录预案再生成红线卡` });















        return;















      }















      const quote = await resolveRedlineQuote(plan.code);















      // 缓存/实时都拿不到时,允许前端手动补昨收/MA5(数据缺失待补的"补"字落地)















      const prevClose = quote.prevClose != null ? quote.prevClose : Number(body.prevClose) || null;















      const ma5 = quote.ma5 != null ? quote.ma5 : Number(body.ma5) || null;















      const usedManual = quote.prevClose == null && Number(body.prevClose) > 0;















      const card = buildRedlineCard({















        code: plan.code,















        name: plan.name,















        prevClose,















        ma5,















        buyPrice: body.buyPrice,















        auctionExpectation: plan.auctionExpectation,















        dualLogic: plan.dualLogic,















        isExpectedReflowDay: plan.isExpectedReflowDay,















      });















      sendJson(response, 200, { ok: true, quoteSource: usedManual ? "manual" : quote.source, card });















    } catch (error) {















      sendJson(response, 400, { ok: false, error: error.message });















    }















    return;















  }































  if (pathname !== "/api/hot-stocks") {















    sendJson(response, 404, { error: "Not found" });















    return;















  }































  try {















    sendJson(response, 200, await stableHotStocksPayload());















  } catch (error) {















    const fallback = loadHotStocksFallback();















    if (fallback) {















      sendJson(response, 200, stampPayload(fallback, error.message));















      return;















    }















    sendJson(response, 500, {















      error: "抓取热榜失败",















      detail: error.message,















    });















  }















}































async function main() {















  if (process.argv.includes("--dump-data")) {















    const payload = await hotStocksPayload();















    process.stdout.write(JSON.stringify(payload, null, 2));















    return;















  }































  const realtimeDumpIndex = process.argv.indexOf("--dump-realtime");















  if (realtimeDumpIndex >= 0) {















    const nextArg = process.argv[realtimeDumpIndex + 1];















    const symbols = nextArg && !nextArg.startsWith("--") ? nextArg.split(",") : DEFAULT_REALTIME_SYMBOLS;















    const payload = await realtimePayload(symbols);















    process.stdout.write(JSON.stringify(payload, null, 2));















    return;















  }































  const server = http.createServer((request, response) => {















    const url = new URL(request.url, `http://${request.headers.host}`);















    const pathname = decodeURIComponent(url.pathname);































    if (pathname.startsWith("/api/")) {















      handleApi(request, response, pathname);















      return;















    }































    const safePathname = pathname === "/" ? "/index.html" : pathname;















    const filePath = path.normalize(path.join(root, safePathname));































    if (!filePath.startsWith(root)) {















      response.writeHead(403);















      response.end("Forbidden");















      return;















    }































    fs.readFile(filePath, (error, content) => {















      if (error) {















        response.writeHead(404);















        response.end("Not found");















        return;















      }































      response.writeHead(200, {















        "Content-Type": types[path.extname(filePath)] || "application/octet-stream",















      });















      response.end(content);















    });















  });































  const host = process.env.HOST || "0.0.0.0";















  server.on("error", (error) => {















    if (error && error.code === "EADDRINUSE") {















      console.error(`\n[启动失败] 端口 ${port} 已被占用——通常是上一次的服务窗口没关。`);















      console.error(`处理办法:关闭之前的黑色命令行窗口后重试;或任务管理器里结束 Node.js 进程。\n`);















      process.exit(1);















    }















    throw error;















  });















  server.listen(port, host, () => {















    // 启动时加载昨日快照
    const startupSnapshot = readRetainedJson(hotStocksCacheFile, { archiveDir: hotStocksCacheArchiveDir });
    if (startupSnapshot) {
      normalizeLeadershipPayload(startupSnapshot);
      const startupCycleHistory = persistCycleHistorySnapshot(startupSnapshot);
      if (startupCycleHistory.required === true && startupCycleHistory.ok !== true) {
        console.error(`[cycle-history] startup backfill failed: ${startupCycleHistory.reason || "unknown"}`);
      }
      autoArchiveMarketSnapshot(startupSnapshot, { trigger: "server-startup" });
    }
    loadYesterdaySnapshot();
    startHotStocksAutoRefreshScheduler();
    startCloudHistorySyncScheduler();
    startCloudCurrentSyncScheduler();

    console.log(`A-share model site running at http://${host}:${port}`);















  });















}































if (require.main === module) {















  main().catch((error) => {















    console.error(error);















    process.exitCode = 1;















  });















}































module.exports = {

  main,















  hotStocksPayload,
  dataProviderInternals: {
    createFreeFallbackMarketDataProvider,
    createMarketDataProviderRegistry,
    dataProviderStatus,
    getMarketDataProviderRegistry,
    projectDataBundleMetadata,
    registerMarketDataProvider,
    requiredProviderCapability,
    resetMarketDataProviderRegistryForTests,
  },
  klineQualityInternals: {
    createKlineSourceStats,
    summarizeKlineProfileScope,
    klineCircuitShouldAttempt,
    recordKlineSourceFailure,
    recordKlineSourceSuccess,
    expectedCompletedKlineTradingDate,
    assessCachedKlineProfile,
    movingAverageSlopeAt,
    classifyKlineWave,
    fetchTencentRawKlineRows,
    fetchKlineRows,
    prioritizeKlineProfileFetchRows,
    enrichKlineProfiles,
  },















  // 内部函数导出仅供离线回放验证（test-selection-replay.js）：















  // 用真实抓取缓存重跑 周期→风险栏→打分 全链路，验证数据缺失降级逻辑















  _internals: { fetchJsonDirect, cloudSnapshotWithUnifiedProjection, fetchTencentKlineRows, createHotStocksRefreshController, createHotStocksAutoRefreshScheduler, hotStocksAutoRefreshKey, fetchIntradayLeadershipProfiles, loadIntradayLeadershipEvidence, persistIntradayLeadershipEvidence, classifyMarket, classifyTradingStyle, summarizeDirectionMembers, classifyDirectionResonance, conceptStats, clusterHotConcepts, buildRiskBoard, scoreCandidate, buildFetchStatus, buildBestPicks, buildCanonicalBestPicks, canonicalSelectionContext, inspectAuthoritativeDecisionChain, buildTopicBoard, buildSurvivorBoard, buildTomorrowOutlook, buildMarketEmotionObservation, buildSuperExpectationSnapshot, classifyChaosDivergence, classifyShockRepair, applyShockAwareCycleTransition, loadPrevArchive, loadExactPreviousDecisionPayload, emotionDecisionDateContext, canonicalFrozenEmotionCycle, sanitizePreviousEmotionPayload, prepareEmotionBuildInputs, replayExactPreviousEmotionCycle, replayExactClosingEmotionCoreEvidence, stampEmotionCycleSnapshot, marketSnapshotTradingDate, marketSnapshotKind, createGenerationContext, resolveGenerationContext, strictExactClosingEvidence, resolveCanonicalClosingDecisionBasis, isAfterMarketClose, thsLimitPayloadTradingDate, autoArchiveMarketSnapshot, buildCycleHistorySnapshot, inspectCycleHistorySnapshot, persistCycleHistorySnapshot, markCycleHistoryUnavailable, loadCycleHistorySnapshot, loadEmotionBigCycleWindowRecords, buildEmotionBigCycleWindowForPayload, hydrateEmotionCyclePersistenceEvidence, selectPreviousIndexEnvironment, highBoardFeedback, normalizeLeadershipPayload, normalizeHotStocksFallbackResponse, invalidateLegacyFiveDayIndexStructures, refreshMarketCapCarrier, refreshPremarketModels, refreshTomorrowDecision, refreshRecentIndexEmotionRelation, refreshPostCloseOpportunityReport, canonicalAllocationMapFromAuthority, projectOpportunityCardsToCanonicalAllocation, projectPostCloseOpportunityToDecisionChain, refreshUnifiedQuantFactors, refreshCoreLeadership, refreshCandidateFlowAndGate, candidateRoleAuthority, roleAuthoritySnapshot, fundFlowDirectionStats, coreWatchConceptTags, loadRetainedCoreWatchSeeds, estimateTurnoverFromFloatCap, buildRecentLimitUpEvidence, applyRepairCoreRetention, syncCoreWatchPool, themeLibrarySnapshotFromPayload, applyThemeCycleIdentitiesToCandidates, loadThemeLibraryCatalog, buildThemeLibraryApiResponse, resolveIndexMarketStructures, themeAttributionReviewContext },















};
