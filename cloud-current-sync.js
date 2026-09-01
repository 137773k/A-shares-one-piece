"use strict";

/**
 * Read-only cloud-current transport for the desktop runtime.
 *
 * A verified cloud closing generation is retained under data/cloud-current.
 * This module deliberately never reads or writes .hot-stocks-cache.json,
 * data/history, or the desktop UI/backend integration points.
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { resolveFetchEvidenceQuality } = require("./fetch-evidence-quality");
const {
  httpsGetBuffer,
  platformDownloadToFile,
} = require("./cloud-history-sync");

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 750;
const DEFAULT_MAX_MANIFEST_BYTES = 512 * 1024;
const DEFAULT_MAX_FILE_BYTES = 128 * 1024 * 1024;
const CURRENT_GENERATION_COMPONENTS = Object.freeze([
  "themeLibrary",
  "premarketModels",
  "emotionCycle",
  "marketPhaseDetail",
  "emotionCoreEvidence",
  "tomorrowDecision",
  "recentIndexEmotionRelation",
  "postCloseOpportunity",
]);

class CloudCurrentSyncError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "CloudCurrentSyncError";
    this.code = code;
    this.retryable = Boolean(options.retryable);
    if (options.cause) this.cause = options.cause;
    if (options.details !== undefined) this.details = options.details;
  }
}

let activeSync = null;
let syncStatus = idleStatus();

function idleStatus() {
  return {
    state: "idle",
    running: false,
    startedAt: null,
    finishedAt: null,
    manifestUrl: null,
    tradingDate: null,
    generationId: null,
    result: null,
    error: null,
  };
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getCloudCurrentSyncStatus() {
  return cloneJson(syncStatus);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function boundedInteger(value, fallback, min, max, label) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new CloudCurrentSyncError("CONFIG_INVALID", `${label} 必须是 ${min}-${max} 的整数`);
  }
  return number;
}

function readConfigFile(configPath) {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("配置根节点不是对象");
    }
    return parsed;
  } catch (error) {
    if (error && error.code === "ENOENT") return {};
    throw new CloudCurrentSyncError(
      "CONFIG_INVALID",
      `无法读取云当前快照配置：${error.message}`,
      { cause: error },
    );
  }
}

function assertHttpsUrl(rawUrl, label) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch (error) {
    throw new CloudCurrentSyncError("CONFIG_INVALID", `${label} 不是合法 URL`, { cause: error });
  }
  if (url.protocol !== "https:") {
    throw new CloudCurrentSyncError("HTTPS_REQUIRED", `${label} 必须使用 HTTPS`);
  }
  if (url.username || url.password) {
    throw new CloudCurrentSyncError("CONFIG_INVALID", `${label} 不允许携带凭据`);
  }
  return url;
}

function deriveCurrentManifestUrl(historyManifestUrl) {
  const url = assertHttpsUrl(historyManifestUrl, "manifestUrl");
  const parts = url.pathname.split("/");
  parts[parts.length - 1] = "current-manifest";
  url.pathname = parts.join("/");
  url.search = "";
  url.hash = "";
  return url;
}

function loadCloudCurrentSyncConfig(options = {}) {
  const env = options.env || process.env;
  const runtimeDir = path.resolve(options.runtimeDir || env.A_SHARE_RUNTIME_DIR || __dirname);
  const configPath = path.resolve(
    options.configPath || path.join(runtimeDir, "data", "cloud-sync-config.json"),
  );
  const fileConfig = options.skipConfigFile ? {} : readConfigFile(configPath);
  const explicit = options.config && typeof options.config === "object" ? options.config : {};
  const envConfig = {
    enabled: firstDefined(env.A_SHARE_CLOUD_CURRENT_SYNC_ENABLED, env.A_SHARE_CLOUD_SYNC_ENABLED),
    currentManifestUrl: env.A_SHARE_CLOUD_CURRENT_MANIFEST_URL,
    manifestUrl: env.A_SHARE_CLOUD_SYNC_MANIFEST_URL,
    token: firstDefined(env.A_SHARE_CLOUD_CURRENT_SYNC_TOKEN, env.A_SHARE_CLOUD_SYNC_TOKEN),
    timeoutMs: firstDefined(env.A_SHARE_CLOUD_CURRENT_TIMEOUT_MS, env.A_SHARE_CLOUD_SYNC_TIMEOUT_MS),
    retries: firstDefined(env.A_SHARE_CLOUD_CURRENT_RETRIES, env.A_SHARE_CLOUD_SYNC_RETRIES),
    retryDelayMs: firstDefined(
      env.A_SHARE_CLOUD_CURRENT_RETRY_DELAY_MS,
      env.A_SHARE_CLOUD_SYNC_RETRY_DELAY_MS,
    ),
    maxFileBytes: firstDefined(
      env.A_SHARE_CLOUD_CURRENT_MAX_FILE_BYTES,
      env.A_SHARE_CLOUD_SYNC_MAX_FILE_BYTES,
    ),
  };
  for (const key of Object.keys(envConfig)) {
    if (envConfig[key] === undefined) delete envConfig[key];
  }
  const merged = { ...fileConfig, ...envConfig, ...explicit };
  let currentManifestUrl = firstDefined(
    merged.currentManifestUrl,
    merged.currentManifestURL,
  );
  if (!currentManifestUrl) {
    const historyManifestUrl = firstDefined(merged.manifestUrl, merged.manifestURL);
    if (historyManifestUrl) currentManifestUrl = deriveCurrentManifestUrl(historyManifestUrl);
  }
  if (!currentManifestUrl && merged.baseUrl) {
    currentManifestUrl = new URL(
      merged.currentManifestPath || "current-manifest",
      assertHttpsUrl(merged.baseUrl, "baseUrl"),
    );
  }
  if (!currentManifestUrl) {
    throw new CloudCurrentSyncError(
      "CONFIG_MISSING",
      `缺少 currentManifestUrl 或 manifestUrl（配置文件：${configPath}）`,
    );
  }
  const manifestUrl = assertHttpsUrl(currentManifestUrl, "currentManifestUrl");
  const token = String(firstDefined(merged.currentToken, merged.token, merged.bearerToken) || "").trim();
  if (!token) throw new CloudCurrentSyncError("CONFIG_MISSING", "缺少云当前快照 Bearer token");
  if (/[\r\n"]/.test(token)) {
    throw new CloudCurrentSyncError("CONFIG_INVALID", "Bearer token 含有不安全的控制字符");
  }
  if (!parseBoolean(merged.enabled, true)) {
    throw new CloudCurrentSyncError("SYNC_DISABLED", "云当前快照同步已停用");
  }
  return {
    runtimeDir,
    configPath,
    manifestUrl: manifestUrl.toString(),
    token,
    timeoutMs: boundedInteger(
      merged.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      1_000,
      15 * 60_000,
      "timeoutMs",
    ),
    retries: boundedInteger(merged.retries, DEFAULT_RETRIES, 0, 10, "retries"),
    retryDelayMs: boundedInteger(
      merged.retryDelayMs,
      DEFAULT_RETRY_DELAY_MS,
      0,
      60_000,
      "retryDelayMs",
    ),
    maxManifestBytes: boundedInteger(
      merged.maxManifestBytes,
      DEFAULT_MAX_MANIFEST_BYTES,
      1_024,
      8 * 1024 * 1024,
      "maxManifestBytes",
    ),
    maxFileBytes: boundedInteger(
      merged.maxFileBytes,
      DEFAULT_MAX_FILE_BYTES,
      1_024,
      512 * 1024 * 1024,
      "maxFileBytes",
    ),
  };
}

function normalizeTradingDate(value) {
  const text = String(value == null ? "" : value).trim();
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function shortString(value, maxLength = 64) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function validIsoTimestamp(value) {
  const text = shortString(value, 64);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
}

function optionalBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function hasErrorValue(value) {
  if (value === undefined || value === null || value === false || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function versionValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return shortString(value, 128);
}

function componentVersion(payload, name) {
  const component = plainObject(payload && payload[name]) || {};
  const lineage = plainObject(component.lineage) || {};
  return {
    version: versionValue(component.version),
    schemaVersion: versionValue(component.schemaVersion),
    contractVersion: versionValue(component.contractVersion),
    classifierVersion: versionValue(component.classifierVersion || lineage.classifierVersion),
    executionVersion: versionValue(component.executionVersion),
    method: shortString(component.method, 128),
  };
}

function currentVersionMetadata(payload) {
  const decision = plainObject(payload && payload.tomorrowDecision) || {};
  const forecast = plainObject(decision.forecast) || {};
  return {
    modelVersions: {
      premarketModels: componentVersion(payload, "premarketModels"),
      tomorrowDecision: componentVersion(payload, "tomorrowDecision"),
      tomorrowMarketForecast: {
        version: versionValue(forecast.version),
        method: shortString(forecast.method, 128),
        calibrated: optionalBoolean(forecast.calibrated),
      },
    },
    componentVersions: Object.fromEntries(CURRENT_GENERATION_COMPONENTS.map((name) => (
      [name, componentVersion(payload, name)]
    ))),
  };
}

function declaredSnapshotKind(payload) {
  const candidates = [
    payload && payload.archiveMeta && payload.archiveMeta.snapshotKind,
    payload && payload.decisionBasis && payload.decisionBasis.snapshotKind,
    payload && payload.themeLibrary && payload.themeLibrary.snapshotKind,
  ];
  for (const value of candidates) {
    const kind = String(value || "").trim().toLowerCase();
    if (kind === "closing" || kind === "intraday") return kind;
  }
  return "unknown";
}

function currentRankMetadata(payload) {
  const hotRanks = plainObject(payload && payload.sources && payload.sources.hotRanks);
  const normalize = (provider) => {
    const row = plainObject(hotRanks && hotRanks[provider]);
    if (!row) return null;
    const kind = String(row.snapshotKind || "").trim().toLowerCase();
    return {
      ok: optionalBoolean(row.ok),
      complete: optionalBoolean(row.complete),
      tradingDate: normalizeTradingDate(row.tradingDate),
      marketDataTradingDate: normalizeTradingDate(row.marketDataTradingDate),
      snapshotKind: kind === "closing" || kind === "intraday" ? kind : null,
      isFallback: optionalBoolean(row.isFallback),
      hasError: hasErrorValue(row.error),
    };
  };
  return { eastmoney: normalize("eastmoney"), ths: normalize("ths") };
}

function currentGenerationMetadata(payload, tradingDate, fetchedAt) {
  const expectedGenerationId = tradingDate && fetchedAt ? `${tradingDate}:${fetchedAt}` : null;
  const components = {};
  const reasons = [];
  for (const name of CURRENT_GENERATION_COMPONENTS) {
    const component = plainObject(payload && payload[name]);
    if (!component) {
      reasons.push(`${name}_missing`);
      components[name] = { generationId: null, tradingDate: null, asOf: null };
      continue;
    }
    const generation = plainObject(component.generation) || {};
    const generationId = shortString(
      component.generationId || generation.generationId || generation.id,
      160,
    );
    const componentDate = normalizeTradingDate(component.tradingDate);
    const componentAsOf = validIsoTimestamp(
      component.asOf || component.generatedAt || component.sourceUpdatedAt,
    );
    components[name] = { generationId, tradingDate: componentDate, asOf: componentAsOf };
    if (!generationId) reasons.push(`${name}_generation_missing`);
    else if (!expectedGenerationId || generationId !== expectedGenerationId) {
      reasons.push(`${name}_generation_mismatch`);
    }
    if (component.tradingDate !== undefined && componentDate !== tradingDate) {
      reasons.push(`${name}_trading_date_mismatch`);
    }
    if (
      (component.asOf !== undefined
        || component.generatedAt !== undefined
        || component.sourceUpdatedAt !== undefined)
      && componentAsOf !== fetchedAt
    ) reasons.push(`${name}_asof_mismatch`);
  }
  return {
    expectedGenerationId,
    consistent: reasons.length === 0,
    reasons,
    components,
  };
}

function extractCurrentQualityMetadata(payload) {
  const reasons = [];
  const snapshot = plainObject(payload && payload.market && payload.market.snapshot) || {};
  const limitDates = plainObject(
    payload && payload.market && payload.market.limitStats && payload.market.limitStats.dates,
  ) || {};
  const decisionBasis = plainObject(payload && payload.decisionBasis) || {};
  const themeLibrary = plainObject(payload && payload.themeLibrary) || {};
  const providerTradingDate = normalizeTradingDate(limitDates.today);
  const snapshotTradingDate = normalizeTradingDate(snapshot.tradingDate);
  const basisTradingDate = normalizeTradingDate(decisionBasis.tradingDate);
  const themeTradingDate = normalizeTradingDate(themeLibrary.tradingDate);
  const tradingDate = snapshotTradingDate || providerTradingDate || basisTradingDate || themeTradingDate;
  const fetchedAt = validIsoTimestamp(payload && payload.fetchedAt);
  const updatedAt = validIsoTimestamp(payload && payload.updatedAt);
  const fetchStatus = plainObject(payload && payload.fetchStatus) || {};
  const fetchLevel = shortString(fetchStatus.level, 32);
  const normalizedFetchLevel = fetchLevel ? fetchLevel.toLowerCase() : null;
  const fetchEvidenceQuality = resolveFetchEvidenceQuality(payload, tradingDate);
  const fetchItems = Array.isArray(fetchStatus.items) ? fetchStatus.items : [];
  const stale = Boolean(payload && (payload.stale === true || fetchStatus.stale === true));
  const fetchError = Boolean(
    hasErrorValue(payload && payload.fetchError)
    || hasErrorValue(fetchStatus.error)
    || hasErrorValue(fetchStatus.errors)
    || fetchItems.some((item) => item && (
      item.ok === false || hasErrorValue(item.error) || hasErrorValue(item.errors)
    )),
  );
  const hotRanks = currentRankMetadata(payload);

  if (!tradingDate) reasons.push("trading_date_missing");
  if (!providerTradingDate) reasons.push("provider_trading_date_missing");
  else if (providerTradingDate !== tradingDate) reasons.push("provider_trading_date_mismatch");
  if (!snapshotTradingDate) reasons.push("snapshot_trading_date_missing");
  else if (snapshotTradingDate !== tradingDate) reasons.push("snapshot_trading_date_mismatch");
  if (limitDates.verified !== true) reasons.push("provider_trading_date_unverified");
  if (!basisTradingDate || basisTradingDate !== tradingDate) reasons.push("decision_basis_date_mismatch");
  if (!themeTradingDate || themeTradingDate !== tradingDate) reasons.push("theme_library_date_mismatch");

  const declaredKinds = [
    ["decision_basis", decisionBasis.snapshotKind],
    ["theme_library", themeLibrary.snapshotKind],
    ["archive_meta", payload && payload.archiveMeta && payload.archiveMeta.snapshotKind],
  ];
  for (const [label, value] of declaredKinds) {
    if (value !== undefined && value !== null && String(value).trim()) {
      if (String(value).trim().toLowerCase() !== "closing") reasons.push(`${label}_not_closing`);
    }
  }
  if (String(decisionBasis.status || "").trim().toLowerCase() !== "current_closing") {
    reasons.push("decision_basis_not_current_closing");
  }
  if (declaredSnapshotKind(payload) !== "closing") reasons.push("snapshot_not_closing");
  if (!fetchEvidenceQuality.closingEvidenceUsable) reasons.push(...(
    fetchEvidenceQuality.reasons.length ? fetchEvidenceQuality.reasons : ["fetch_evidence_unusable"]
  ));
  if (stale) reasons.push("snapshot_stale");
  if (fetchError) reasons.push("snapshot_fetch_error");
  if (!fetchedAt) reasons.push("fetched_at_missing_or_invalid");
  if (updatedAt && fetchedAt && updatedAt !== fetchedAt) reasons.push("updated_at_mismatch");

  for (const provider of ["eastmoney", "ths"]) {
    const row = hotRanks[provider];
    if (!row) {
      reasons.push(`${provider}_rank_missing`);
      continue;
    }
    if (row.ok === false) reasons.push(`${provider}_rank_failed`);
    if (row.complete !== true) reasons.push(`${provider}_rank_incomplete`);
    if (row.tradingDate !== tradingDate) reasons.push(`${provider}_rank_date_mismatch`);
    if (row.marketDataTradingDate !== tradingDate) reasons.push(`${provider}_market_date_mismatch`);
    if (row.snapshotKind !== "closing") reasons.push(`${provider}_rank_not_closing`);
    if (row.isFallback !== false) reasons.push(`${provider}_rank_fallback_or_unknown`);
    if (row.hasError) reasons.push(`${provider}_rank_error`);
  }

  const generation = currentGenerationMetadata(payload, tradingDate, fetchedAt);
  reasons.push(...generation.reasons);
  const versions = currentVersionMetadata(payload);
  const requiredVersions = [
    ["theme_library_schema", versions.componentVersions.themeLibrary.schemaVersion],
    ["theme_library_classifier", versions.componentVersions.themeLibrary.classifierVersion],
    ["premarket_models", versions.modelVersions.premarketModels.version],
    ["emotion_cycle", versions.componentVersions.emotionCycle.version],
    ["market_phase_detail", versions.componentVersions.marketPhaseDetail.version],
    ["emotion_core_contract", versions.componentVersions.emotionCoreEvidence.contractVersion],
    ["emotion_core_classifier", versions.componentVersions.emotionCoreEvidence.classifierVersion],
    ["tomorrow_decision", versions.modelVersions.tomorrowDecision.version],
    ["tomorrow_forecast", versions.modelVersions.tomorrowMarketForecast.version],
  ];
  for (const [label, value] of requiredVersions) {
    if (value === null) reasons.push(`${label}_version_missing`);
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    parseOk: true,
    canonicalEligible: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    tradingDate,
    providerTradingDate,
    snapshotTradingDate,
    basisTradingDate,
    themeTradingDate,
    snapshotKind: declaredSnapshotKind(payload),
    fetchedAt,
    updatedAt,
    fetchLevel: normalizedFetchLevel,
    stale,
    fetchError,
    hotRanks,
    generation,
    ...versions,
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function resolveFileUrl(href, manifestUrl) {
  let url;
  try {
    const text = String(href || "");
    url = /^\/(?!\/)/.test(text)
      ? new URL(text.replace(/^\/+/, ""), new URL(".", manifestUrl))
      : new URL(text, manifestUrl);
  } catch (error) {
    throw new CloudCurrentSyncError("MANIFEST_INVALID", "当前快照下载路径无效", { cause: error });
  }
  if (url.protocol !== "https:") {
    throw new CloudCurrentSyncError("HTTPS_REQUIRED", "当前快照下载必须使用 HTTPS");
  }
  if (url.origin !== manifestUrl.origin) {
    throw new CloudCurrentSyncError(
      "ORIGIN_MISMATCH",
      "当前快照与清单不同源，拒绝转发 Bearer token",
    );
  }
  if (url.username || url.password) {
    throw new CloudCurrentSyncError("MANIFEST_INVALID", "当前快照 URL 不允许携带凭据");
  }
  return url;
}

function normalizeCurrentManifest(rawManifest, config) {
  if (!plainObject(rawManifest) || rawManifest.version !== 1) {
    throw new CloudCurrentSyncError("MANIFEST_INVALID", "当前快照清单版本或根节点无效");
  }
  const raw = plainObject(rawManifest.current);
  if (!raw) throw new CloudCurrentSyncError("MANIFEST_INVALID", "清单缺少 current 节点");
  if (!Number.isSafeInteger(raw.size) || raw.size <= 0 || raw.size > config.maxFileBytes) {
    throw new CloudCurrentSyncError("MANIFEST_INVALID", "当前快照 size 无效或超限");
  }
  const sha256 = String(raw.sha256 || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new CloudCurrentSyncError("MANIFEST_INVALID", "当前快照 SHA-256 无效");
  }
  const tradingDate = normalizeTradingDate(raw.tradingDate);
  const fetchedAt = validIsoTimestamp(raw.fetchedAt);
  const updatedAt = raw.updatedAt == null ? null : validIsoTimestamp(raw.updatedAt);
  const expectedGenerationId = tradingDate && fetchedAt ? `${tradingDate}:${fetchedAt}` : null;
  if (!tradingDate || !fetchedAt || raw.generationId !== expectedGenerationId) {
    throw new CloudCurrentSyncError("GENERATION_MISMATCH", "清单日期、fetchedAt 与 generationId 不一致");
  }
  const quality = plainObject(raw.quality);
  const reasons = quality && Array.isArray(quality.reasons) ? quality.reasons : null;
  if (
    raw.canonicalEligible !== true
    || String(raw.snapshotKind || "").toLowerCase() !== "closing"
    || !quality
    || quality.parseOk !== true
    || quality.canonicalEligible !== true
    || !Array.isArray(reasons)
    || reasons.length !== 0
    || !plainObject(quality.generation)
    || quality.generation.consistent !== true
    || quality.generation.expectedGenerationId !== expectedGenerationId
  ) {
    throw new CloudCurrentSyncError(
      "CURRENT_NOT_CANONICAL",
      "云端当前快照未通过完整收盘代次质量门",
      { details: { reasons: reasons || ["manifest_quality_invalid"] } },
    );
  }
  const manifestUrl = assertHttpsUrl(config.manifestUrl, "currentManifestUrl");
  const fileUrl = resolveFileUrl(raw.path, manifestUrl);
  return {
    version: 1,
    generatedAt: validIsoTimestamp(rawManifest.generatedAt),
    path: String(raw.path),
    url: fileUrl.toString(),
    size: raw.size,
    sha256,
    mtime: raw.mtime || null,
    tradingDate,
    snapshotKind: "closing",
    fetchedAt,
    updatedAt,
    generationId: expectedGenerationId,
    canonicalEligible: true,
    modelVersions: cloneJson(raw.modelVersions),
    componentVersions: cloneJson(raw.componentVersions),
    quality: cloneJson(quality),
  };
}

function validateCurrentPayload(payload, entry) {
  if (!plainObject(payload)) {
    throw new CloudCurrentSyncError("JSON_ROOT_INVALID", "当前快照 JSON 根节点必须是对象");
  }
  const quality = extractCurrentQualityMetadata(payload);
  if (!quality.canonicalEligible) {
    const generationMismatch = quality.reasons.some((reason) => /generation_?mismatch/.test(reason));
    throw new CloudCurrentSyncError(
      generationMismatch ? "GENERATION_MISMATCH" : "CURRENT_NOT_CANONICAL",
      "下载快照未通过桌面端独立质量复核",
      { details: { reasons: quality.reasons } },
    );
  }
  if (
    quality.tradingDate !== entry.tradingDate
    || quality.fetchedAt !== entry.fetchedAt
    || quality.snapshotKind !== entry.snapshotKind
    || quality.generation.expectedGenerationId !== entry.generationId
  ) {
    throw new CloudCurrentSyncError("GENERATION_MISMATCH", "下载快照与清单代次不一致");
  }
  if (
    stableJson(quality.modelVersions) !== stableJson(entry.modelVersions)
    || stableJson(quality.componentVersions) !== stableJson(entry.componentVersions)
  ) {
    throw new CloudCurrentSyncError("VERSION_MISMATCH", "下载快照的模型/组件版本与清单不一致");
  }
  return quality;
}

function delay(ms) {
  return ms ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function withRetry(operation, options) {
  let lastError;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      return await operation(attempt + 1);
    } catch (error) {
      lastError = error;
      if (error && error.retryable === false) throw error;
      if (attempt >= options.retries) throw error;
      await (options.sleep || delay)(options.retryDelayMs * (attempt + 1));
    }
  }
  throw lastError;
}

async function fetchCurrentManifest(config, options) {
  const requestBuffer = options.requestBuffer || httpsGetBuffer;
  return withRetry(async (attempt) => {
    const response = await requestBuffer(config.manifestUrl, {
      token: config.token,
      timeoutMs: config.timeoutMs,
      maxBytes: config.maxManifestBytes,
      attempt,
    });
    const bytes = Buffer.isBuffer(response) ? response : Buffer.from(response);
    if (bytes.length > config.maxManifestBytes) {
      throw new CloudCurrentSyncError("RESPONSE_TOO_LARGE", "当前快照清单超过大小限制");
    }
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    } catch (error) {
      throw new CloudCurrentSyncError(
        "MANIFEST_JSON_INVALID",
        `当前快照清单不是合法 JSON：${error.message}`,
        { retryable: true, cause: error },
      );
    }
    return normalizeCurrentManifest(parsed, config);
  }, {
    retries: config.retries,
    retryDelayMs: config.retryDelayMs,
    sleep: options.sleep,
  });
}

async function sha256File(filePath) {
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new CloudCurrentSyncError("LOCAL_FILE_INVALID", "本地云快照必须是普通文件");
  }
  const hash = crypto.createHash("sha256");
  let size = 0;
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => { size += chunk.length; hash.update(chunk); });
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return { size, sha256: hash.digest("hex") };
}

async function readAndValidateFile(filePath, entry) {
  const digest = await sha256File(filePath);
  if (digest.size !== entry.size) {
    throw new CloudCurrentSyncError("SIZE_MISMATCH", "当前快照字节数与清单不一致", { retryable: true });
  }
  if (digest.sha256 !== entry.sha256) {
    throw new CloudCurrentSyncError("HASH_MISMATCH", "当前快照 SHA-256 与清单不一致", { retryable: true });
  }
  let payload;
  try {
    const bytes = await fsp.readFile(filePath);
    payload = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new CloudCurrentSyncError("JSON_INVALID", `当前快照不是合法 JSON：${error.message}`, {
      cause: error,
    });
  }
  return { ...digest, quality: validateCurrentPayload(payload, entry) };
}

async function pathState(filePath, entry) {
  try {
    const digest = await sha256File(filePath);
    return {
      exists: true,
      matches: digest.size === entry.size && digest.sha256 === entry.sha256,
      digest,
    };
  } catch (error) {
    if (error && error.code === "ENOENT") return { exists: false, matches: false, digest: null };
    throw error;
  }
}

function ensureInside(root, candidate) {
  const relative = path.relative(root, candidate);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) return candidate;
  throw new CloudCurrentSyncError("PATH_ESCAPE", "云当前快照路径越界");
}

function tempFileName(tempDir) {
  return path.join(
    tempDir,
    `.current-${process.pid}-${Date.now()}-${crypto.randomBytes(8).toString("hex")}.tmp`,
  );
}

async function downloadAndValidate(entry, tempFile, config, options) {
  const downloader = options.downloadToFile || platformDownloadToFile;
  return withRetry(async (attempt) => {
    await fsp.unlink(tempFile).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    try {
      await downloader(entry.url, tempFile, {
        token: config.token,
        timeoutMs: config.timeoutMs,
        maxBytes: config.maxFileBytes,
        expected: entry,
        attempt,
      });
      const handle = await fsp.open(tempFile, "r+");
      try { await handle.sync(); } finally { await handle.close(); }
      return await readAndValidateFile(tempFile, entry);
    } catch (error) {
      await fsp.unlink(tempFile).catch(() => {});
      throw error;
    }
  }, {
    retries: config.retries,
    retryDelayMs: config.retryDelayMs,
    sleep: options.sleep,
  });
}

async function atomicInstall(tempFile, targetFile, entry) {
  const existing = await pathState(targetFile, entry);
  if (existing.exists) {
    if (!existing.matches) {
      throw new CloudCurrentSyncError("LOCAL_COLLISION", "目标云快照已存在但字节不同，拒绝覆盖");
    }
    await fsp.unlink(tempFile).catch(() => {});
    return false;
  }
  try {
    await fsp.rename(tempFile, targetFile);
    return true;
  } catch (error) {
    if (["EEXIST", "ENOTEMPTY", "EPERM"].includes(error && error.code)) {
      const raced = await pathState(targetFile, entry);
      if (raced.matches) {
        await fsp.unlink(tempFile).catch(() => {});
        return false;
      }
    }
    throw error;
  }
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw new CloudCurrentSyncError("LOCAL_METADATA_INVALID", `无法读取本地云快照元数据：${error.message}`, {
      cause: error,
    });
  }
}

async function writeJsonAtomic(filePath, value) {
  const temp = `${filePath}.${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.tmp`;
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  let handle;
  try {
    handle = await fsp.open(temp, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await fsp.rename(temp, filePath);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fsp.unlink(temp).catch(() => {});
  }
}

function metadataFor(entry, config, relativePath, verifiedAt) {
  return {
    manifest: {
      version: 1,
      verifiedAt,
      source: {
        manifestUrl: config.manifestUrl,
        generatedAt: entry.generatedAt,
      },
      current: {
        tradingDate: entry.tradingDate,
        snapshotKind: entry.snapshotKind,
        fetchedAt: entry.fetchedAt,
        updatedAt: entry.updatedAt,
        generationId: entry.generationId,
        size: entry.size,
        sha256: entry.sha256,
        relativePath,
        canonicalEligible: true,
        modelVersions: entry.modelVersions,
        componentVersions: entry.componentVersions,
        quality: entry.quality,
      },
    },
    pointer: {
      version: 1,
      updatedAt: verifiedAt,
      tradingDate: entry.tradingDate,
      snapshotKind: entry.snapshotKind,
      fetchedAt: entry.fetchedAt,
      generationId: entry.generationId,
      size: entry.size,
      sha256: entry.sha256,
      relativePath,
    },
  };
}

function samePointer(pointer, entry, relativePath) {
  return plainObject(pointer)
    && pointer.version === 1
    && pointer.tradingDate === entry.tradingDate
    && pointer.generationId === entry.generationId
    && pointer.sha256 === entry.sha256
    && pointer.size === entry.size
    && pointer.relativePath === relativePath;
}

function safeError(error, token) {
  const raw = error && error.message ? String(error.message) : String(error);
  return {
    code: error && error.code || "UNKNOWN_ERROR",
    message: token ? raw.split(token).join("[redacted]") : raw,
    retryable: Boolean(error && error.retryable),
    details: error && error.details !== undefined ? cloneJson(error.details) : undefined,
  };
}

async function runCloudCurrentSync(options) {
  const startedAt = new Date().toISOString();
  let config;
  try {
    config = loadCloudCurrentSyncConfig(options);
    syncStatus = {
      ...idleStatus(),
      state: "running",
      running: true,
      startedAt,
      manifestUrl: config.manifestUrl,
    };
    const entry = await fetchCurrentManifest(config, options);
    syncStatus.tradingDate = entry.tradingDate;
    syncStatus.generationId = entry.generationId;

    const root = path.resolve(config.runtimeDir, "data", "cloud-current");
    const dateDir = ensureInside(root, path.join(root, entry.tradingDate));
    const tempDir = ensureInside(root, path.join(root, ".tmp"));
    const targetFile = ensureInside(root, path.join(dateDir, `${entry.sha256}.json`));
    const manifestFile = ensureInside(root, path.join(root, "manifest.json"));
    const pointerFile = ensureInside(root, path.join(root, "pointer.json"));
    const relativePath = path.relative(root, targetFile).split(path.sep).join("/");
    await fsp.mkdir(dateDir, { recursive: true });
    await fsp.mkdir(tempDir, { recursive: true });

    const existingPointer = await readJsonIfExists(pointerFile);
    if (plainObject(existingPointer)) {
      const existingTime = Date.parse(existingPointer.fetchedAt || "");
      const incomingTime = Date.parse(entry.fetchedAt);
      if (Number.isFinite(existingTime) && existingTime > incomingTime) {
        const result = {
          ok: true,
          state: "success",
          kind: "ignored_older",
          tradingDate: entry.tradingDate,
          generationId: entry.generationId,
          sha256: entry.sha256,
          pointerPreserved: true,
        };
        syncStatus = { ...syncStatus, state: "success", running: false, finishedAt: new Date().toISOString(), result };
        return result;
      }
      if (
        existingPointer.generationId === entry.generationId
        && existingPointer.sha256
        && existingPointer.sha256 !== entry.sha256
      ) {
        throw new CloudCurrentSyncError(
          "GENERATION_COLLISION",
          "同一 generationId 对应了不同 SHA-256，拒绝改写指针",
        );
      }
    }

    const local = await pathState(targetFile, entry);
    let installed = false;
    if (local.exists) {
      if (!local.matches) {
        throw new CloudCurrentSyncError("LOCAL_COLLISION", "目标云快照文件已存在但校验不一致");
      }
      await readAndValidateFile(targetFile, entry);
    } else {
      const tempFile = tempFileName(tempDir);
      try {
        await downloadAndValidate(entry, tempFile, config, options);
        installed = await atomicInstall(tempFile, targetFile, entry);
      } finally {
        await fsp.unlink(tempFile).catch(() => {});
      }
    }

    const verifiedAt = new Date().toISOString();
    const metadata = metadataFor(entry, config, relativePath, verifiedAt);
    const pointerUnchanged = samePointer(existingPointer, entry, relativePath);
    if (!pointerUnchanged) {
      await writeJsonAtomic(manifestFile, metadata.manifest);
      await writeJsonAtomic(pointerFile, metadata.pointer);
    }
    const result = {
      ok: true,
      state: "success",
      kind: installed ? "imported" : "same",
      tradingDate: entry.tradingDate,
      generationId: entry.generationId,
      fetchedAt: entry.fetchedAt,
      sha256: entry.sha256,
      size: entry.size,
      path: targetFile,
      relativePath,
      pointerUpdated: !pointerUnchanged,
    };
    syncStatus = {
      ...syncStatus,
      state: "success",
      running: false,
      finishedAt: new Date().toISOString(),
      result,
    };
    return result;
  } catch (error) {
    const safe = safeError(error, config && config.token);
    syncStatus = {
      ...syncStatus,
      state: "failed",
      running: false,
      finishedAt: new Date().toISOString(),
      error: safe,
    };
    error.syncResult = { ok: false, state: "failed", error: safe };
    throw error;
  }
}

function syncCloudCurrent(options = {}) {
  if (activeSync) return activeSync;
  const running = runCloudCurrentSync(options);
  const wrapped = running.finally(() => {
    if (activeSync === wrapped) activeSync = null;
  });
  activeSync = wrapped;
  return wrapped;
}

function resetCloudCurrentSyncStateForTests() {
  if (activeSync) throw new Error("不能在同步运行时重置状态");
  syncStatus = idleStatus();
}

async function loadVerifiedCloudCurrentSnapshot(options = {}) {
  const runtimeDir = path.resolve(options.runtimeDir || process.env.A_SHARE_RUNTIME_DIR || __dirname);
  const root = path.resolve(runtimeDir, "data", "cloud-current");
  const pointerFile = path.join(root, "pointer.json");
  const manifestFile = path.join(root, "manifest.json");
  const pointer = await readJsonIfExists(pointerFile);
  const manifest = await readJsonIfExists(manifestFile);
  if (!plainObject(pointer) || pointer.version !== 1) {
    throw new CloudCurrentSyncError("CURRENT_POINTER_MISSING", "本机尚无已验证的云端正式快照");
  }
  const current = plainObject(manifest && manifest.current);
  const tradingDate = normalizeTradingDate(pointer.tradingDate);
  const fetchedAt = validIsoTimestamp(pointer.fetchedAt);
  const sha256 = String(pointer.sha256 || "").trim().toLowerCase();
  const generationId = tradingDate && fetchedAt ? `${tradingDate}:${fetchedAt}` : null;
  const relativePath = String(pointer.relativePath || "").replace(/\\/g, "/");
  if (
    !tradingDate
    || !fetchedAt
    || pointer.generationId !== generationId
    || !/^[a-f0-9]{64}$/.test(sha256)
    || !Number.isSafeInteger(pointer.size)
    || pointer.size <= 0
    || relativePath !== `${tradingDate}/${sha256}.json`
  ) {
    throw new CloudCurrentSyncError("CURRENT_POINTER_INVALID", "本机云端正式快照指针无效");
  }
  if (
    !current
    || current.canonicalEligible !== true
    || current.tradingDate !== tradingDate
    || current.fetchedAt !== fetchedAt
    || current.generationId !== generationId
    || current.sha256 !== sha256
    || current.size !== pointer.size
    || current.relativePath !== relativePath
  ) {
    throw new CloudCurrentSyncError("CURRENT_MANIFEST_MISMATCH", "本机云端正式快照清单与指针不一致");
  }
  const filePath = ensureInside(root, path.resolve(root, ...relativePath.split("/")));
  const realRoot = await fsp.realpath(root);
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new CloudCurrentSyncError("LOCAL_FILE_INVALID", "云端正式快照不是普通文件");
  }
  const realFile = await fsp.realpath(filePath);
  if (path.relative(realRoot, realFile).startsWith("..") || path.isAbsolute(path.relative(realRoot, realFile))) {
    throw new CloudCurrentSyncError("PATH_ESCAPE", "云端正式快照真实路径越界");
  }
  const digest = await sha256File(filePath);
  if (digest.size !== pointer.size || digest.sha256 !== sha256) {
    throw new CloudCurrentSyncError("LOCAL_INTEGRITY_MISMATCH", "云端正式快照本地字节校验失败");
  }
  const bytes = await fsp.readFile(filePath);
  let payload;
  try {
    payload = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new CloudCurrentSyncError("JSON_INVALID", `云端正式快照不是合法 JSON：${error.message}`, {
      cause: error,
    });
  }
  const entry = {
    tradingDate,
    fetchedAt,
    snapshotKind: "closing",
    generationId,
    modelVersions: current.modelVersions,
    componentVersions: current.componentVersions,
  };
  const quality = validateCurrentPayload(payload, entry);
  return {
    payload,
    bytes,
    filePath,
    pointer: cloneJson(pointer),
    manifest: cloneJson(manifest),
    quality,
  };
}

async function main() {
  try {
    const result = await syncCloudCurrent();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(error.syncResult || { ok: false, error: safeError(error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  CloudCurrentSyncError,
  loadCloudCurrentSyncConfig,
  normalizeCurrentManifest,
  extractCurrentQualityMetadata,
  validateCurrentPayload,
  syncCloudCurrent,
  getCloudCurrentSyncStatus,
  loadVerifiedCloudCurrentSnapshot,
  resetCloudCurrentSyncStateForTests,
  sha256File,
};
