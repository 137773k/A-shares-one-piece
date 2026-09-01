"use strict";

/**
 * Read-only cloud -> desktop history synchronizer.
 *
 * The cloud endpoint is an evidence source, never an authority allowed to
 * overwrite a desktop snapshot.  A date that is absent locally is installed in
 * data/history.  A different cloud revision for an existing date is retained
 * under data/history-revisions/cloud.  index.json is deliberately not edited:
 * callers may provide onIndexUpdate(plan), or consume result.indexUpdate.
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { resolveFetchEvidenceQuality } = require("./fetch-evidence-quality");

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 750;
const DEFAULT_MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 4_000;

class CloudHistorySyncError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "CloudHistorySyncError";
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
    currentDate: null,
    manifestUrl: null,
    summary: emptySummary(),
    errors: [],
  };
}

function emptySummary() {
  return {
    manifestEntries: 0,
    // Backward-compatible: eligibleEntries historically meant only that an
    // entry passed manifest structure/security checks, not that its market
    // evidence was formally usable.
    eligibleEntries: 0,
    structurallyAcceptedEntries: 0,
    formalEligibleEntries: 0,
    exactEntries: 0,
    legacyEligibleEntries: 0,
    ineligibleEntries: 0,
    structurallyRejectedEntries: 0,
    same: 0,
    imported: 0,
    conflicts: 0,
    quarantined: 0,
    localInvalid: 0,
    rejected: 0,
    failed: 0,
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function getCloudHistorySyncStatus() {
  return cloneJson(syncStatus);
}

function setStatus(patch) {
  syncStatus = { ...syncStatus, ...patch };
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
    throw new CloudHistorySyncError("CONFIG_INVALID", `${label} 必须是 ${min}-${max} 的整数`);
  }
  return number;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
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
    throw new CloudHistorySyncError("CONFIG_INVALID", `无法读取云历史同步配置：${error.message}`, {
      cause: error,
    });
  }
}

function assertHttpsUrl(rawUrl, label = "URL") {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch (error) {
    throw new CloudHistorySyncError("CONFIG_INVALID", `${label} 不是合法 URL`, { cause: error });
  }
  if (url.protocol !== "https:") {
    throw new CloudHistorySyncError("HTTPS_REQUIRED", `${label} 必须使用 HTTPS`);
  }
  if (url.username || url.password) {
    throw new CloudHistorySyncError("CONFIG_INVALID", `${label} 不允许在 URL 中携带凭据`);
  }
  return url;
}

function loadCloudHistorySyncConfig(options = {}) {
  const env = options.env || process.env;
  const runtimeDir = path.resolve(
    options.runtimeDir || env.A_SHARE_RUNTIME_DIR || __dirname,
  );
  const configPath = path.resolve(
    options.configPath || path.join(runtimeDir, "data", "cloud-sync-config.json"),
  );
  const fileConfig = options.skipConfigFile ? {} : readConfigFile(configPath);
  const explicit = options.config && typeof options.config === "object" ? options.config : {};

  // Environment variables override the on-disk file.  Explicit programmatic
  // options override both, which keeps tests and embedding deterministic.
  const envConfig = {
    enabled: firstDefined(env.A_SHARE_CLOUD_SYNC_ENABLED, env.CLOUD_HISTORY_SYNC_ENABLED),
    manifestUrl: firstDefined(
      env.A_SHARE_CLOUD_SYNC_MANIFEST_URL,
      env.CLOUD_HISTORY_MANIFEST_URL,
    ),
    token: firstDefined(env.A_SHARE_CLOUD_SYNC_TOKEN, env.CLOUD_HISTORY_BEARER_TOKEN),
    timeoutMs: firstDefined(env.A_SHARE_CLOUD_SYNC_TIMEOUT_MS, env.CLOUD_HISTORY_TIMEOUT_MS),
    retries: firstDefined(env.A_SHARE_CLOUD_SYNC_RETRIES, env.CLOUD_HISTORY_RETRIES),
    retryDelayMs: firstDefined(
      env.A_SHARE_CLOUD_SYNC_RETRY_DELAY_MS,
      env.CLOUD_HISTORY_RETRY_DELAY_MS,
    ),
    maxFileBytes: firstDefined(env.A_SHARE_CLOUD_SYNC_MAX_FILE_BYTES),
  };
  for (const key of Object.keys(envConfig)) {
    if (envConfig[key] === undefined) delete envConfig[key];
  }

  const merged = { ...fileConfig, ...envConfig, ...explicit };
  let manifestUrl = firstDefined(merged.manifestUrl, merged.manifestURL);
  if (!manifestUrl && merged.baseUrl) {
    manifestUrl = new URL(merged.manifestPath || "/manifest", assertHttpsUrl(merged.baseUrl, "baseUrl"));
  }
  if (!manifestUrl) {
    throw new CloudHistorySyncError(
      "CONFIG_MISSING",
      `缺少 manifestUrl（配置文件：${configPath}）`,
    );
  }
  const manifest = assertHttpsUrl(manifestUrl, "manifestUrl");
  const token = String(firstDefined(merged.token, merged.bearerToken) || "").trim();
  if (!token) {
    throw new CloudHistorySyncError("CONFIG_MISSING", "缺少云历史同步 Bearer token");
  }
  if (/[\r\n"]/.test(token)) {
    throw new CloudHistorySyncError("CONFIG_INVALID", "Bearer token 含有不安全的控制字符");
  }
  const enabled = parseBoolean(merged.enabled, true);
  if (!enabled) {
    throw new CloudHistorySyncError("SYNC_DISABLED", "云历史同步已在配置中停用");
  }

  return {
    runtimeDir,
    configPath,
    manifestUrl: manifest.toString(),
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
      32 * 1024 * 1024,
      "maxManifestBytes",
    ),
    maxFileBytes: boundedInteger(
      merged.maxFileBytes,
      DEFAULT_MAX_FILE_BYTES,
      1_024,
      1024 * 1024 * 1024,
      "maxFileBytes",
    ),
    maxEntries: boundedInteger(
      merged.maxEntries,
      DEFAULT_MAX_ENTRIES,
      1,
      20_000,
      "maxEntries",
    ),
  };
}

function authHeaders(token, accept = "application/json") {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "User-Agent": "a-share-desktop-cloud-history-sync/1",
  };
}

function httpStatusError(statusCode, url) {
  const retryable = statusCode === 408 || statusCode === 429 || statusCode >= 500;
  return new CloudHistorySyncError(
    "HTTP_STATUS",
    `云端请求失败：HTTP ${statusCode} (${url.origin}${url.pathname})`,
    { retryable, details: { statusCode } },
  );
}

function httpsGetBuffer(rawUrl, options) {
  const url = assertHttpsUrl(rawUrl, "请求 URL");
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      reject(error instanceof CloudHistorySyncError
        ? error
        : new CloudHistorySyncError("NETWORK_ERROR", `云端网络请求失败：${error.message}`, {
          cause: error,
          retryable: true,
        }));
    };
    const req = https.request(url, {
      method: "GET",
      headers: authHeaders(options.token),
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        fail(httpStatusError(res.statusCode || 0, url));
        return;
      }
      const chunks = [];
      let total = 0;
      res.on("data", (chunk) => {
        total += chunk.length;
        if (total > options.maxBytes) {
          req.destroy(new CloudHistorySyncError(
            "RESPONSE_TOO_LARGE",
            `云端清单超过 ${options.maxBytes} 字节限制`,
            { retryable: false },
          ));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve(Buffer.concat(chunks, total));
      });
      res.on("error", fail);
    });
    const deadline = setTimeout(() => {
      req.destroy(new CloudHistorySyncError("REQUEST_TIMEOUT", "云端清单请求超时", {
        retryable: true,
      }));
    }, options.timeoutMs);
    req.on("error", fail);
    req.end();
  });
}

async function httpsDownloadToFile(rawUrl, destination, options) {
  const url = assertHttpsUrl(rawUrl, "文件 URL");
  const handle = await fsp.open(destination, "wx");
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: authHeaders(options.token, "application/json, application/octet-stream"),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || (error && error.name === "AbortError")) {
        throw new CloudHistorySyncError("REQUEST_TIMEOUT", "云端快照下载超时", {
          retryable: true,
          cause: error,
        });
      }
      throw new CloudHistorySyncError("NETWORK_ERROR", `云端文件下载失败：${error.message}`, {
        cause: error,
        retryable: true,
      });
    }
    if (response.status !== 200) {
      if (response.body) await response.body.cancel().catch(() => {});
      throw httpStatusError(response.status, url);
    }
    if (!response.body) {
      throw new CloudHistorySyncError("NETWORK_ERROR", "云端文件响应缺少正文", {
        retryable: true,
      });
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
      await response.body.cancel().catch(() => {});
      throw new CloudHistorySyncError(
        "RESPONSE_TOO_LARGE",
        `云端快照超过 ${options.maxBytes} 字节限制`,
        { retryable: false },
      );
    }
    const reader = response.body.getReader();
    const hash = crypto.createHash("sha256");
    let total = 0;
    while (true) {
      let item;
      try {
        item = await reader.read();
      } catch (error) {
        if (controller.signal.aborted || (error && error.name === "AbortError")) {
          throw new CloudHistorySyncError("REQUEST_TIMEOUT", "云端快照下载超时", {
            retryable: true,
            cause: error,
          });
        }
        throw new CloudHistorySyncError("NETWORK_ERROR", `云端文件下载失败：${error.message}`, {
          retryable: true,
          cause: error,
        });
      }
      if (item.done) break;
      const chunk = Buffer.from(item.value.buffer, item.value.byteOffset, item.value.byteLength);
      total += chunk.length;
      if (total > options.maxBytes) {
        controller.abort();
        throw new CloudHistorySyncError(
          "RESPONSE_TOO_LARGE",
          `云端快照超过 ${options.maxBytes} 字节限制`,
          { retryable: false },
        );
      }
      let offset = 0;
      while (offset < chunk.length) {
        const written = await handle.write(chunk, offset, chunk.length - offset, null);
        if (!written.bytesWritten) throw new Error("写入云端快照临时文件时返回 0 字节");
        offset += written.bytesWritten;
      }
      hash.update(chunk);
    }
    await handle.sync();
    return { size: total, sha256: hash.digest("hex") };
  } finally {
    clearTimeout(deadline);
    await handle.close().catch(() => {});
  }
}

function curlConfigQuoted(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function curlDownloadToFile(rawUrl, destination, options) {
  const url = assertHttpsUrl(rawUrl, "文件 URL");
  const spawnImpl = options.spawnImpl || spawn;
  const executable = options.curlExecutable || (process.platform === "win32" ? "curl.exe" : "curl");
  const timeoutSeconds = Math.max(1, Math.ceil(options.timeoutMs / 1000));
  const args = [
    "--config", "-",
    "--output", destination,
    "--write-out", "%{http_code}",
    "--max-time", String(timeoutSeconds),
    "--connect-timeout", String(Math.min(timeoutSeconds, 20)),
    "--max-filesize", String(options.maxBytes),
    "--proto", "=https",
    "--tlsv1.2",
  ];
  const configText = [
    `url = ${curlConfigQuoted(url.toString())}`,
    `header = ${curlConfigQuoted(`Authorization: Bearer ${options.token}`)}`,
    `header = ${curlConfigQuoted("Accept: application/json, application/octet-stream")}`,
    "silent",
    "show-error",
    "fail",
    "no-progress-meter",
    "compressed",
    "",
  ].join("\n");
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(executable, args, {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(new CloudHistorySyncError(
        error && error.code === "ENOENT" ? "CURL_UNAVAILABLE" : "NETWORK_ERROR",
        `无法启动系统下载器：${error.message}`,
        { retryable: error && error.code !== "ENOENT", cause: error },
      ));
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardDeadline);
      if (error) reject(error); else resolve(value);
    };
    const hardDeadline = setTimeout(() => {
      child.kill();
      finish(new CloudHistorySyncError("REQUEST_TIMEOUT", "云端快照下载超时", {
        retryable: true,
      }));
    }, options.timeoutMs + 5_000);
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 128) stdout += chunk.toString("utf8").slice(0, 128 - stdout.length);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 2_048) stderr += chunk.toString("utf8").slice(0, 2_048 - stderr.length);
    });
    child.on("error", (error) => {
      finish(new CloudHistorySyncError(
        error && error.code === "ENOENT" ? "CURL_UNAVAILABLE" : "NETWORK_ERROR",
        `系统下载器启动失败：${error.message}`,
        { retryable: error && error.code !== "ENOENT", cause: error },
      ));
    });
    child.on("close", (code) => {
      const statusCode = Number(String(stdout).trim().slice(-3));
      if (code === 0 && statusCode === 200) {
        finish(null, { transport: "curl" });
        return;
      }
      const timeout = code === 28;
      finish(new CloudHistorySyncError(
        timeout ? "REQUEST_TIMEOUT" : "CURL_DOWNLOAD_FAILED",
        timeout
          ? "云端快照下载超时"
          : `系统下载器失败（exit=${code}, http=${Number.isFinite(statusCode) ? statusCode : "unknown"}）：${stderr.trim() || "无错误正文"}`,
        { retryable: timeout || code === 5 || code === 6 || code === 7 || code === 18 || code === 22 || code === 56 },
      ));
    });
    child.stdin.on("error", (error) => {
      if (error && error.code !== "EPIPE") {
        finish(new CloudHistorySyncError("NETWORK_ERROR", `系统下载器配置写入失败：${error.message}`, {
          retryable: true,
          cause: error,
        }));
      }
    });
    child.stdin.end(configText);
  });
}

async function platformDownloadToFile(rawUrl, destination, options) {
  if (process.platform !== "win32") return httpsDownloadToFile(rawUrl, destination, options);
  try {
    return await curlDownloadToFile(rawUrl, destination, options);
  } catch (error) {
    if (!error || error.code !== "CURL_UNAVAILABLE") throw error;
    return httpsDownloadToFile(rawUrl, destination, options);
  }
}

function delay(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(operation, options) {
  let lastError;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      return await operation(attempt + 1);
    } catch (error) {
      lastError = error;
      const retryable = error && error.retryable !== false;
      if (!retryable || attempt >= options.retries) throw error;
      if (typeof options.onRetry === "function") {
        options.onRetry(error, attempt + 1);
      }
      await (options.sleep || delay)(options.retryDelayMs * (attempt + 1));
    }
  }
  throw lastError;
}

function validYmd(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function normalizeTradingDate(value) {
  const text = String(value || "").trim();
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return null;
}

function hasErrorValue(value) {
  if (value === undefined || value === null || value === false || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function manifestReject(date, code, message) {
  return { date: validYmd(date) ? date : null, stage: "manifest", code, message };
}

function normalizeManifest(rawManifest, config) {
  if (!rawManifest || typeof rawManifest !== "object" || Array.isArray(rawManifest)) {
    throw new CloudHistorySyncError("MANIFEST_INVALID", "云端清单根节点必须是对象");
  }
  if (rawManifest.version !== 1) {
    throw new CloudHistorySyncError("MANIFEST_INVALID", "云端清单 version 必须为 1");
  }
  const files = rawManifest.files;
  if (!Array.isArray(files)) {
    throw new CloudHistorySyncError("MANIFEST_INVALID", "云端清单缺少 files 数组");
  }
  if (files.length > config.maxEntries) {
    throw new CloudHistorySyncError(
      "MANIFEST_INVALID",
      `云端清单包含 ${files.length} 项，超过 ${config.maxEntries} 项限制`,
    );
  }

  const manifestUrl = new URL(config.manifestUrl);
  const candidates = [];
  const rejected = [];
  for (const raw of files) {
    const date = raw && raw.date;
    const reject = (code, message) => rejected.push(manifestReject(date, code, message));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      reject("ENTRY_INVALID", "清单项不是对象");
      continue;
    }
    if (!validYmd(date)) {
      reject("DATE_INVALID", "清单日期不是有效的 YYYY-MM-DD");
      continue;
    }
    if (raw.name !== undefined && raw.name !== `${date}.json`) {
      reject("NAME_MISMATCH", "清单文件名与日期不一致");
      continue;
    }
    if (!Number.isSafeInteger(raw.size) || raw.size <= 0 || raw.size > config.maxFileBytes) {
      reject("SIZE_INVALID", "清单文件大小无效或超过限制");
      continue;
    }
    const sha256 = String(raw.sha256 || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      reject("HASH_INVALID", "清单 SHA-256 无效");
      continue;
    }
    const quality = raw.quality && typeof raw.quality === "object" ? raw.quality : {};
    const manifestFormalReasons = [];
    if (raw.snapshotKind !== undefined
      && String(raw.snapshotKind || "").toLowerCase() !== "closing") {
      manifestFormalReasons.push("manifest_snapshot_not_closing");
    }
    if (raw.stale === true) manifestFormalReasons.push("manifest_stale");
    if (hasErrorValue(raw.fetchError)) manifestFormalReasons.push("manifest_fetch_error");
    if (quality.dateMatches === false) manifestFormalReasons.push("manifest_date_failed");
    if (quality.providerDateVerified === false) manifestFormalReasons.push("manifest_provider_date_failed");
    if (quality.rankSourcesComplete === false) manifestFormalReasons.push("manifest_rank_sources_incomplete");
    if (quality.rankMetadataPresent === true && quality.formalEligible === false) {
      manifestFormalReasons.push("manifest_modern_rank_unverified");
    }
    const manifestFetchLevel = firstDefined(
      raw.fetchStatus && raw.fetchStatus.level,
      quality.fetchLevel,
    );
    const manifestEvidenceStatus = String(firstDefined(
      raw.fetchStatus && raw.fetchStatus.evidenceStatus,
      quality.evidenceStatus,
    ) || "").toLowerCase();
    const manifestKlineStatus = String(firstDefined(
      raw.fetchStatus && raw.fetchStatus.mode,
      quality.klineStatusKey,
    ) || "").toLowerCase();
    const manifestEvidenceUsable = manifestEvidenceStatus === "complete"
      && ["live_complete", "degraded_same_day_cache"].includes(manifestKlineStatus)
      && firstDefined(raw.exactClosing, quality.exactClosing) === true;
    if (manifestFetchLevel !== undefined
      && String(manifestFetchLevel || "").toLowerCase() !== "ok"
      && !manifestEvidenceUsable) {
      manifestFormalReasons.push("manifest_fetch_level_not_ok");
    }

    const href = firstDefined(raw.url, raw.downloadUrl, raw.path);
    if (!href) {
      reject("URL_MISSING", "清单项缺少下载路径");
      continue;
    }
    let fileUrl;
    try {
      const hrefText = String(href);
      // Preserve a reverse-proxy prefix when the private sidecar emits an
      // internal root-relative path such as /files/YYYY-MM-DD.json.
      fileUrl = /^\/(?!\/)/.test(hrefText)
        ? new URL(hrefText.replace(/^\/+/, ""), new URL(".", manifestUrl))
        : new URL(hrefText, manifestUrl);
    } catch {
      reject("URL_INVALID", "清单项下载路径无效");
      continue;
    }
    if (fileUrl.protocol !== "https:") {
      reject("HTTPS_REQUIRED", "快照下载必须使用 HTTPS");
      continue;
    }
    if (fileUrl.origin !== manifestUrl.origin) {
      reject("ORIGIN_MISMATCH", "快照下载地址与清单不同源，拒绝转发 Bearer token");
      continue;
    }
    if (fileUrl.username || fileUrl.password) {
      reject("URL_INVALID", "快照下载 URL 不允许携带凭据");
      continue;
    }
    candidates.push({
      date,
      name: `${date}.json`,
      url: fileUrl.toString(),
      size: raw.size,
      sha256,
      mtime: raw.mtime || null,
      snapshotKind: String(raw.snapshotKind || "").toLowerCase() || null,
      stale: raw.stale,
      fetchError: raw.fetchError,
      archiveMeta: raw.archiveMeta && typeof raw.archiveMeta === "object" ? cloneJson(raw.archiveMeta) : null,
      fetchedAt: raw.fetchedAt || null,
      fetchStatus: raw.fetchStatus && typeof raw.fetchStatus === "object" ? cloneJson(raw.fetchStatus) : null,
      hotRanks: raw.hotRanks && typeof raw.hotRanks === "object" ? cloneJson(raw.hotRanks) : null,
      quality: cloneJson(quality),
      declaredFormalEligible: typeof firstDefined(raw.formalEligible, quality.formalEligible) === "boolean"
        ? firstDefined(raw.formalEligible, quality.formalEligible)
        : null,
      declaredExact: firstDefined(raw.exactClosing, quality.exactClosing) === true,
      declaredLegacyEligible: firstDefined(
        raw.legacyClosingEligible,
        quality.legacyClosingEligible,
      ) === true,
      declaredQualityTier: String(firstDefined(raw.qualityTier, quality.qualityTier) || "")
        .trim()
        .toLowerCase() || null,
      manifestFormalReasons,
    });
  }

  // Ambiguous duplicate dates are rejected as a group.  Selecting whichever
  // appeared first would turn manifest order into an unreviewed overwrite rule.
  const byDate = new Map();
  for (const entry of candidates) {
    const group = byDate.get(entry.date) || [];
    group.push(entry);
    byDate.set(entry.date, group);
  }
  const entries = [];
  for (const [date, group] of byDate) {
    if (group.length !== 1) {
      rejected.push(manifestReject(date, "DUPLICATE_DATE", "清单同一日期存在多个文件"));
    } else {
      entries.push(group[0]);
    }
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  const exactEntries = entries.filter((entry) => (
    entry.declaredExact || entry.declaredQualityTier === "exact"
  )).length;
  const legacyEligibleEntries = entries.filter((entry) => (
    !entry.declaredExact
    && entry.declaredQualityTier !== "exact"
    && (entry.declaredLegacyEligible || ["legacy", "legacy_closing_ok"].includes(entry.declaredQualityTier))
  )).length;
  const formalEligibleEntries = entries.filter((entry) => (
    entry.declaredFormalEligible === true
    || entry.declaredExact
    || entry.declaredLegacyEligible
    || ["exact", "legacy", "legacy_closing_ok"].includes(entry.declaredQualityTier)
  )).length;
  const ineligibleEntries = entries.filter((entry) => (
    entry.declaredFormalEligible === false
    || ["ineligible", "invalid", "closing_partial"].includes(entry.declaredQualityTier)
  )).length;
  return {
    version: 1,
    generatedAt: rawManifest.generatedAt || null,
    total: files.length,
    entries,
    rejected,
    qualityCounts: {
      structurallyAcceptedEntries: entries.length,
      formalEligibleEntries,
      exactEntries,
      legacyEligibleEntries,
      ineligibleEntries,
      structurallyRejectedEntries: rejected.length,
    },
  };
}

function valueAt(object, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => (
    value === undefined || value === null ? undefined : value[key]
  ), object);
}

function validateSnapshotPayload(payload, entry) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new CloudHistorySyncError("SNAPSHOT_INVALID", "快照 JSON 根节点必须是对象", {
      retryable: false,
    });
  }

  const invalidReasons = [];
  const partialReasons = [];
  const addInvalid = (reason) => {
    if (!invalidReasons.includes(reason)) invalidReasons.push(reason);
  };
  const addPartial = (reason) => {
    if (!partialReasons.includes(reason)) partialReasons.push(reason);
  };
  for (const reason of (entry.manifestFormalReasons || [])) {
    if (/stale|fetch_error|date_|provider_date|snapshot_not_closing/.test(reason)) addInvalid(reason);
    else addPartial(reason);
  }

  const datePaths = [
    "date",
    "tradingDate",
    "archiveMeta.tradingDate",
    "decisionBasis.tradingDate",
    "postCloseOpportunity.tradingDate",
    "tomorrowDecision.tradingDate",
    "themeLibrary.tradingDate",
    "market.limitStats.dates.today",
  ];
  const dateEvidence = [];
  for (const field of datePaths) {
    const raw = valueAt(payload, field);
    if (raw === undefined || raw === null || raw === "") continue;
    const normalized = normalizeTradingDate(raw);
    if (!normalized || !validYmd(normalized)) {
      addInvalid(`snapshot_date_invalid:${field}`);
      continue;
    }
    dateEvidence.push({ field, date: normalized });
    if (normalized !== entry.date) addInvalid(`snapshot_date_mismatch:${field}:${normalized}`);
  }
  if (!dateEvidence.length) addInvalid("snapshot_date_missing");

  const providerDatePaths = [
    "market.limitStats.dates.today",
    "market.providerTradingDate",
    "market.snapshot.tradingDate",
    "providerTradingDate",
    "sources.providerTradingDate",
  ];
  const providerDateEvidence = [];
  for (const field of providerDatePaths) {
    const raw = valueAt(payload, field);
    if (raw === undefined || raw === null || raw === "") continue;
    const normalized = normalizeTradingDate(raw);
    providerDateEvidence.push({ field, date: normalized });
    if (!normalized || !validYmd(normalized) || normalized !== entry.date) {
      addInvalid(`snapshot_provider_date_mismatch:${field}:${normalized || "invalid"}`);
    }
  }
  if (!providerDateEvidence.length) addInvalid("snapshot_provider_date_missing");

  const stalePaths = ["stale", "meta.stale", "fetchStatus.stale", "dataStatus.stale"];
  if (stalePaths.some((field) => valueAt(payload, field) === true)) {
    addInvalid("snapshot_stale");
  }
  const errorPaths = ["fetchError", "meta.fetchError", "fetchStatus.fetchError"];
  if (errorPaths.some((field) => hasErrorValue(valueAt(payload, field)))) {
    addInvalid("snapshot_fetch_error");
  }
  const fetchLevel = String(valueAt(payload, "fetchStatus.level") || "").toLowerCase();
  const fetchEvidenceQuality = resolveFetchEvidenceQuality(payload, entry.date);
  if (!fetchEvidenceQuality.closingEvidenceUsable) {
    addPartial(`snapshot_fetch_evidence_unusable:${fetchEvidenceQuality.reasons.join("+") || fetchLevel || "unknown"}`);
  }
  const fetchedAt = valueAt(payload, "fetchedAt");
  const fetchedText = String(fetchedAt || "");
  const fetchedMs = Date.parse(fetchedText);
  if (!fetchedAt || Number.isNaN(fetchedMs) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(fetchedText)) {
    addInvalid("snapshot_fetched_at_missing_or_invalid");
  } else {
    // China A-share close evidence: 15:05 Asia/Shanghai or any later local
    // calendar day.  Adding eight hours and reading UTC avoids host-timezone
    // dependence on both Windows and Linux.
    const shanghai = new Date(fetchedMs + 8 * 60 * 60 * 1000);
    const shanghaiDate = shanghai.toISOString().slice(0, 10);
    const shanghaiMinutes = shanghai.getUTCHours() * 60 + shanghai.getUTCMinutes();
    if (shanghaiDate < entry.date || (shanghaiDate === entry.date && shanghaiMinutes < 15 * 60 + 5)) {
      addInvalid(`snapshot_fetched_before_close:${shanghaiDate}T${String(Math.floor(shanghaiMinutes / 60)).padStart(2, "0")}:${String(shanghaiMinutes % 60).padStart(2, "0")}`);
    }
  }
  if (valueAt(payload, "archiveMeta.tradingDate") !== entry.date) {
    addInvalid("snapshot_archive_date_missing_or_mismatch");
  }
  if (String(valueAt(payload, "archiveMeta.snapshotKind") || "").toLowerCase() !== "closing") {
    addInvalid("snapshot_archive_not_closing");
  }

  const closingPaths = ["snapshotKind", "archiveMeta.snapshotKind", "decisionBasis.snapshotKind"];
  const closingEvidence = [];
  for (const field of closingPaths) {
    const raw = valueAt(payload, field);
    if (raw === undefined || raw === null || raw === "") continue;
    closingEvidence.push({ field, value: String(raw).toLowerCase() });
  }
  if (!closingEvidence.length) addInvalid("snapshot_closing_unverified");
  const notClosing = closingEvidence.find((evidence) => evidence.value !== "closing");
  if (notClosing) addInvalid(`snapshot_not_closing:${notClosing.field}`);

  if (valueAt(payload, "market.limitStats.dates.verified") === false) {
    addInvalid("snapshot_provider_date_unverified");
  }
  if (valueAt(payload, "postCloseOpportunity.dataStatus.usable") === false) {
    addPartial("snapshot_data_unusable");
  }
  const decisionStatus = String(valueAt(payload, "decisionBasis.status") || "").toLowerCase();
  if (decisionStatus === "unavailable") addInvalid("snapshot_decision_basis_unavailable");

  const sourceHotRanks = valueAt(payload, "sources.hotRanks");
  const modernRankEvidence = Boolean(
    sourceHotRanks && typeof sourceHotRanks === "object" && !Array.isArray(sourceHotRanks),
  );
  let modernRankComplete = false;
  if (modernRankEvidence) {
    modernRankComplete = true;
    for (const provider of ["eastmoney", "ths"]) {
      const row = sourceHotRanks[provider];
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        modernRankComplete = false;
        addPartial(`snapshot_modern_rank_missing:${provider}`);
        continue;
      }
      // Some current closing snapshots omit `ok` once the more specific
      // completeness/date/kind/fallback evidence is present.  Absence is not a
      // failure; an explicit false remains disqualifying.
      if (row.ok === false || row.complete !== true || row.isFallback !== false) {
        modernRankComplete = false;
        addPartial(`snapshot_modern_rank_incomplete:${provider}`);
      }
      for (const field of ["tradingDate", "marketDataTradingDate"]) {
        const rankDate = normalizeTradingDate(row[field]);
        if (!rankDate || rankDate !== entry.date) {
          modernRankComplete = false;
          addInvalid(`snapshot_modern_rank_date_mismatch:${provider}:${field}`);
        }
      }
      if (String(row.snapshotKind || "").toLowerCase() !== "closing") {
        modernRankComplete = false;
        addInvalid(`snapshot_modern_rank_not_closing:${provider}`);
      }
    }
    if (valueAt(payload, "market.limitStats.dates.verified") !== true) {
      modernRankComplete = false;
      addPartial("snapshot_modern_provider_date_not_explicitly_verified");
    }
    const archivedAt = String(valueAt(payload, "archiveMeta.archivedAt") || "");
    if (!archivedAt || Number.isNaN(Date.parse(archivedAt))) {
      modernRankComplete = false;
      addPartial("snapshot_modern_archived_at_missing_or_invalid");
    }
  }

  const items = valueAt(payload, "fetchStatus.items");
  if (Array.isArray(items)) {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const isRankSource = /热榜/.test(String(item.name || item.provider || ""))
        || item.targetCount !== undefined
        || item.marketDataTradingDate !== undefined;
      if (!isRankSource) continue;
      const completeEnough = Object.prototype.hasOwnProperty.call(item, "complete")
        ? item.complete === true
        : item.ok === true;
      if (!completeEnough) addPartial(`snapshot_rank_incomplete:${String(item.name || item.provider || "unknown")}`);
      if (item.isFallback === true) addPartial(`snapshot_rank_fallback:${String(item.name || item.provider || "unknown")}`);
      if (hasErrorValue(item.error)) addPartial(`snapshot_rank_error:${String(item.name || item.provider || "unknown")}`);
      for (const field of ["tradingDate", "marketDataTradingDate"]) {
        if (item[field] === undefined || item[field] === null || item[field] === "") continue;
        const itemDate = normalizeTradingDate(item[field]);
        if (!itemDate || itemDate !== entry.date) {
          addInvalid(`snapshot_rank_date_mismatch:${String(item.name || item.provider || "unknown")}`);
        }
      }
      if (item.snapshotKind && String(item.snapshotKind).toLowerCase() !== "closing") {
        addInvalid(`snapshot_rank_not_closing:${String(item.name || item.provider || "unknown")}`);
      }
      if (/stale/i.test(String(item.freshness || ""))) {
        addInvalid(`snapshot_rank_stale:${String(item.name || item.provider || "unknown")}`);
      }
    }
  }

  const formalReasons = [...invalidReasons, ...partialReasons];
  const qualityTier = invalidReasons.length
    ? "invalid"
    : (partialReasons.length
      ? "closing_partial"
      : (modernRankEvidence && modernRankComplete ? "exact" : "legacy_closing_ok"));
  return {
    dateEvidence,
    providerDateEvidence,
    closingEvidence,
    formalEligible: qualityTier === "exact" || qualityTier === "legacy_closing_ok",
    qualityTier,
    formalReasons,
    invalidReasons,
    partialReasons,
  };
}

async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    let size = 0;
    const input = fs.createReadStream(file);
    input.on("data", (chunk) => {
      size += chunk.length;
      hash.update(chunk);
    });
    input.on("error", reject);
    input.on("end", () => resolve({ size, sha256: hash.digest("hex") }));
  });
}

async function inspectExisting(file, expected) {
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) return { exists: true, matches: false, reason: "not_file" };
    const digest = await sha256File(file);
    return {
      exists: true,
      matches: digest.size === expected.size && digest.sha256 === expected.sha256,
      ...digest,
    };
  } catch (error) {
    if (error && error.code === "ENOENT") return { exists: false, matches: false };
    throw error;
  }
}

async function validateDownloadedFile(tempFile, entry) {
  const digest = await sha256File(tempFile);
  if (digest.size !== entry.size) {
    throw new CloudHistorySyncError(
      "SIZE_MISMATCH",
      `下载大小 ${digest.size} 与清单 ${entry.size} 不一致`,
      { retryable: true },
    );
  }
  if (digest.sha256 !== entry.sha256) {
    throw new CloudHistorySyncError("HASH_MISMATCH", "下载文件 SHA-256 与清单不一致", {
      retryable: true,
    });
  }
  let payload;
  try {
    const bytes = await fsp.readFile(tempFile);
    payload = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new CloudHistorySyncError("JSON_INVALID", `下载文件不是合法 JSON：${error.message}`, {
      retryable: false,
      cause: error,
    });
  }
  const evidence = validateSnapshotPayload(payload, entry);
  return { ...digest, evidence };
}

function tempName(targetDir, date) {
  const suffix = crypto.randomBytes(8).toString("hex");
  return path.join(targetDir, `.${date}.cloud-sync-${process.pid}-${Date.now()}-${suffix}.tmp`);
}

async function atomicRename(tempFile, targetFile, expected) {
  const before = await inspectExisting(targetFile, expected);
  if (before.exists) {
    if (before.matches) {
      await fsp.unlink(tempFile).catch(() => {});
      return { installed: false, alreadyPresent: true };
    }
    throw new CloudHistorySyncError("TARGET_EXISTS", "目标文件在安装前出现且内容不同，拒绝覆盖", {
      retryable: false,
    });
  }
  try {
    await fsp.rename(tempFile, targetFile);
    return { installed: true, alreadyPresent: false };
  } catch (error) {
    if (["EEXIST", "ENOTEMPTY", "EPERM"].includes(error && error.code)) {
      const after = await inspectExisting(targetFile, expected);
      if (after.matches) {
        await fsp.unlink(tempFile).catch(() => {});
        return { installed: false, alreadyPresent: true };
      }
    }
    throw error;
  }
}

function safeError(error, token) {
  const rawMessage = error && error.message ? String(error.message) : String(error);
  const message = token ? rawMessage.split(token).join("[redacted]") : rawMessage;
  return {
    code: (error && error.code) || "UNKNOWN_ERROR",
    message,
    retryable: Boolean(error && error.retryable),
  };
}

async function downloadAndValidate(entry, tempFile, context) {
  const downloader = context.downloadToFile || platformDownloadToFile;
  return withRetry(async (attempt) => {
    await fsp.unlink(tempFile).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    try {
      await downloader(entry.url, tempFile, {
        token: context.config.token,
        timeoutMs: context.config.timeoutMs,
        maxBytes: context.config.maxFileBytes,
        expected: entry,
        attempt,
      });
      const tempHandle = await fsp.open(tempFile, "r+");
      try {
        await tempHandle.sync();
      } finally {
        await tempHandle.close();
      }
      return await validateDownloadedFile(tempFile, entry);
    } catch (error) {
      await fsp.unlink(tempFile).catch(() => {});
      throw error;
    }
  }, {
    retries: context.config.retries,
    retryDelayMs: context.config.retryDelayMs,
    sleep: context.sleep,
  });
}

async function processEntry(entry, context) {
  const historyFile = path.join(context.historyDir, `${entry.date}.json`);
  const revisionFile = path.join(context.revisionDir, `${entry.date}--${entry.sha256}.json`);
  const local = await inspectExisting(historyFile, entry);
  if (local.matches) {
    const checked = await validateDownloadedFile(historyFile, entry);
    return {
      kind: checked.evidence.formalEligible ? "same" : "local_invalid",
      date: entry.date,
      path: historyFile,
      sha256: entry.sha256,
      size: entry.size,
      retainedInPlace: !checked.evidence.formalEligible,
      qualityTier: checked.evidence.qualityTier,
      qualityReasons: checked.evidence.formalReasons,
    };
  }

  // If the formal date already exists, or the manifest already says this file
  // is not formal-grade, an identical retained revision can satisfy the sync
  // without another network transfer.  Re-parse it before trusting its quality.
  if (local.exists || entry.manifestFormalReasons.length > 0) {
    const retained = await inspectExisting(revisionFile, entry);
    if (retained.matches) {
      const checked = await validateDownloadedFile(revisionFile, entry);
      const quarantined = !checked.evidence.formalEligible;
      return {
        kind: quarantined ? "quarantined" : "conflict",
        date: entry.date,
        path: revisionFile,
        localPath: local.exists ? historyFile : undefined,
        sha256: entry.sha256,
        size: entry.size,
        alreadyPresent: true,
        conflict: local.exists,
        qualityTier: checked.evidence.qualityTier,
        qualityReasons: checked.evidence.formalReasons,
      };
    }
    if (retained.exists) {
      throw new CloudHistorySyncError(
        "REVISION_COLLISION",
        "同哈希命名的云端修订文件内容不符，拒绝覆盖",
        { retryable: false },
      );
    }
  }

  await fsp.mkdir(context.tempDir, { recursive: true });
  const tempFile = tempName(context.tempDir, entry.date);
  try {
    const checked = await downloadAndValidate(entry, tempFile, context);
    const formalEligible = checked.evidence.formalEligible;

    // Re-evaluate after the network wait.  A local archiver may have created the
    // date while this sync was downloading; it remains authoritative.
    const currentLocal = await inspectExisting(historyFile, entry);
    if (currentLocal.matches) {
      await fsp.unlink(tempFile).catch(() => {});
      return {
        kind: "same",
        date: entry.date,
        path: historyFile,
        sha256: entry.sha256,
        size: entry.size,
        raced: !local.exists,
        qualityTier: checked.evidence.qualityTier,
      };
    }

    const conflict = currentLocal.exists;
    const quarantined = !formalEligible;
    const targetFile = (conflict || quarantined) ? revisionFile : historyFile;
    await fsp.mkdir(path.dirname(targetFile), { recursive: true });
    const installed = await atomicRename(tempFile, targetFile, entry);
    return {
      kind: quarantined ? "quarantined" : (conflict ? "conflict" : "imported"),
      date: entry.date,
      path: targetFile,
      localPath: conflict ? historyFile : undefined,
      sha256: entry.sha256,
      size: entry.size,
      alreadyPresent: installed.alreadyPresent,
      conflict,
      qualityTier: checked.evidence.qualityTier,
      qualityReasons: checked.evidence.formalReasons,
    };
  } finally {
    await fsp.unlink(tempFile).catch(() => {});
  }
}

async function fetchManifest(config, options) {
  const requestBuffer = options.requestBuffer || httpsGetBuffer;
  const raw = await withRetry(async (attempt) => {
    const bytes = await requestBuffer(config.manifestUrl, {
      token: config.token,
      timeoutMs: config.timeoutMs,
      maxBytes: config.maxManifestBytes,
      attempt,
    });
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (buffer.length > config.maxManifestBytes) {
      throw new CloudHistorySyncError("RESPONSE_TOO_LARGE", "云端清单超过大小限制", {
        retryable: false,
      });
    }
    try {
      return JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, ""));
    } catch (error) {
      throw new CloudHistorySyncError("MANIFEST_JSON_INVALID", `云端清单不是合法 JSON：${error.message}`, {
        retryable: true,
        cause: error,
      });
    }
  }, {
    retries: config.retries,
    retryDelayMs: config.retryDelayMs,
    sleep: options.sleep,
  });
  return normalizeManifest(raw, config);
}

async function runCloudHistorySync(options) {
  const startedAt = new Date().toISOString();
  let config;
  try {
    config = loadCloudHistorySyncConfig(options);
  } catch (error) {
    const failure = safeError(error);
    syncStatus = {
      ...idleStatus(),
      state: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      errors: [failure],
    };
    throw error;
  }

  const historyDir = path.join(config.runtimeDir, "data", "history");
  const revisionDir = path.join(config.runtimeDir, "data", "history-revisions", "cloud");
  syncStatus = {
    ...idleStatus(),
    state: "running",
    running: true,
    startedAt,
    manifestUrl: config.manifestUrl,
  };

  const result = {
    ok: false,
    state: "running",
    startedAt,
    finishedAt: null,
    manifest: null,
    same: [],
    imported: [],
    conflicts: [],
    quarantined: [],
    localInvalid: [],
    rejected: [],
    failed: [],
    indexUpdate: {
      required: false,
      dates: [],
      importedDates: [],
      excludeDates: [],
      callbackInvoked: false,
      callbackResult: null,
      error: null,
    },
  };

  try {
    const manifest = await fetchManifest(config, options);
    result.manifest = {
      version: manifest.version,
      generatedAt: manifest.generatedAt,
      total: manifest.total,
      eligible: manifest.entries.length,
      ...manifest.qualityCounts,
      declaredQualityCounts: cloneJson(manifest.qualityCounts),
    };
    result.rejected.push(...manifest.rejected);
    syncStatus.summary.manifestEntries = manifest.total;
    syncStatus.summary.eligibleEntries = manifest.entries.length;
    syncStatus.summary.structurallyAcceptedEntries = manifest.qualityCounts.structurallyAcceptedEntries;
    syncStatus.summary.formalEligibleEntries = manifest.qualityCounts.formalEligibleEntries;
    syncStatus.summary.exactEntries = manifest.qualityCounts.exactEntries;
    syncStatus.summary.legacyEligibleEntries = manifest.qualityCounts.legacyEligibleEntries;
    syncStatus.summary.ineligibleEntries = manifest.qualityCounts.ineligibleEntries;
    syncStatus.summary.structurallyRejectedEntries = manifest.qualityCounts.structurallyRejectedEntries;
    syncStatus.summary.rejected = manifest.rejected.length;

    const context = {
      config,
      historyDir,
      revisionDir,
      tempDir: path.join(config.runtimeDir, "data", ".cloud-sync-tmp"),
      downloadToFile: options.downloadToFile,
      sleep: options.sleep,
    };
    for (const entry of manifest.entries) {
      setStatus({ currentDate: entry.date });
      try {
        const item = await processEntry(entry, context);
        if (item.kind === "same") result.same.push(item);
        if (item.kind === "imported") result.imported.push(item);
        if (item.kind === "conflict") result.conflicts.push(item);
        if (item.kind === "quarantined") {
          result.quarantined.push(item);
          result.rejected.push({
            date: item.date,
            stage: "quality",
            code: "QUARANTINED",
            message: `云端快照仅保留为 ${item.qualityTier} 修订，不进入正式历史`,
            qualityTier: item.qualityTier,
            reasons: item.qualityReasons,
            path: item.path,
          });
        }
        if (item.kind === "local_invalid") {
          result.localInvalid.push(item);
          result.rejected.push({
            date: item.date,
            stage: "quality",
            code: "LOCAL_INVALID_RETAINED",
            message: "本地同字节文件质量不合格；原文件保留，但应从历史索引排除",
            qualityTier: item.qualityTier,
            reasons: item.qualityReasons,
            path: item.path,
          });
        }
      } catch (error) {
        result.failed.push({ date: entry.date, stage: "file", ...safeError(error, config.token) });
      }
      syncStatus.summary = {
        ...syncStatus.summary,
        same: result.same.length,
        imported: result.imported.length,
        conflicts: result.conflicts.length,
        quarantined: result.quarantined.length,
        localInvalid: result.localInvalid.length,
        rejected: result.rejected.length,
        failed: result.failed.length,
      };
    }

    result.indexUpdate.importedDates = result.imported.map((item) => item.date);
    result.indexUpdate.excludeDates = result.localInvalid.map((item) => item.date);
    result.indexUpdate.dates = [...result.indexUpdate.importedDates];
    result.indexUpdate.required = result.indexUpdate.importedDates.length > 0
      || result.indexUpdate.excludeDates.length > 0;
    if (result.indexUpdate.required && typeof options.onIndexUpdate === "function") {
      result.indexUpdate.callbackInvoked = true;
      try {
        result.indexUpdate.callbackResult = await options.onIndexUpdate({
          runtimeDir: config.runtimeDir,
          historyDir,
          imported: cloneJson(result.imported),
          excludeDates: [...result.indexUpdate.excludeDates],
          manifest: cloneJson(result.manifest),
        });
      } catch (error) {
        result.indexUpdate.error = safeError(error, config.token);
        result.failed.push({ date: null, stage: "index", ...result.indexUpdate.error });
      }
    }

    const qualityChecked = [
      ...result.same,
      ...result.imported,
      ...result.conflicts,
      ...result.quarantined,
      ...result.localInvalid,
    ];
    const exactEntries = qualityChecked.filter((item) => item.qualityTier === "exact").length;
    const legacyEligibleEntries = qualityChecked.filter((item) => (
      item.qualityTier === "legacy_closing_ok"
    )).length;
    result.manifest.formalEligibleEntries = exactEntries + legacyEligibleEntries;
    result.manifest.exactEntries = exactEntries;
    result.manifest.legacyEligibleEntries = legacyEligibleEntries;
    result.manifest.ineligibleEntries = qualityChecked.length
      - result.manifest.formalEligibleEntries;

    // Quality isolation is a successful, intentional outcome.  Only actual
    // transport/integrity/index failures make the run partial or failed.
    const hasFailure = result.failed.length > 0;
    const hasUsefulOutcome = result.same.length
      + result.imported.length
      + result.conflicts.length
      + result.quarantined.length
      + result.localInvalid.length > 0;
    result.state = hasFailure ? (hasUsefulOutcome ? "partial" : "failed") : "success";
    result.ok = !hasFailure;
    result.finishedAt = new Date().toISOString();
    syncStatus = {
      ...syncStatus,
      state: result.state,
      running: false,
      finishedAt: result.finishedAt,
      currentDate: null,
      summary: {
        manifestEntries: result.manifest.total,
        eligibleEntries: result.manifest.eligible,
        structurallyAcceptedEntries: result.manifest.structurallyAcceptedEntries,
        formalEligibleEntries: result.manifest.formalEligibleEntries,
        exactEntries: result.manifest.exactEntries,
        legacyEligibleEntries: result.manifest.legacyEligibleEntries,
        ineligibleEntries: result.manifest.ineligibleEntries,
        structurallyRejectedEntries: result.manifest.structurallyRejectedEntries,
        same: result.same.length,
        imported: result.imported.length,
        conflicts: result.conflicts.length,
        quarantined: result.quarantined.length,
        localInvalid: result.localInvalid.length,
        rejected: result.rejected.length,
        failed: result.failed.length,
      },
      errors: cloneJson(result.failed),
    };
    return result;
  } catch (error) {
    const failure = safeError(error, config.token);
    result.state = "failed";
    result.ok = false;
    result.finishedAt = new Date().toISOString();
    result.failed.push({ date: null, stage: "manifest", ...failure });
    syncStatus = {
      ...syncStatus,
      state: "failed",
      running: false,
      finishedAt: result.finishedAt,
      currentDate: null,
      errors: cloneJson(result.failed),
    };
    error.syncResult = result;
    throw error;
  }
}

function syncCloudHistory(options = {}) {
  if (activeSync) return activeSync;
  const running = runCloudHistorySync(options);
  const wrapped = running.finally(() => {
    if (activeSync === wrapped) activeSync = null;
  });
  activeSync = wrapped;
  return wrapped;
}

function resetCloudHistorySyncStateForTests() {
  if (activeSync) throw new Error("不能在同步运行时重置状态");
  syncStatus = idleStatus();
}

async function main() {
  try {
    const result = await syncCloudHistory();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const output = error.syncResult || { ok: false, error: safeError(error) };
    process.stderr.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  CloudHistorySyncError,
  loadCloudHistorySyncConfig,
  normalizeManifest,
  validateSnapshotPayload,
  sha256File,
  syncCloudHistory,
  getCloudHistorySyncStatus,
  resetCloudHistorySyncStateForTests,
  // Exported for deterministic unit tests; production callers normally use
  // syncCloudHistory only.
  httpsGetBuffer,
  httpsDownloadToFile,
  curlDownloadToFile,
  platformDownloadToFile,
};
