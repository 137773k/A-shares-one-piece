"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const API_URL = "https://app.jiuyangongshe.com/jystock-app/api/v1/timeline/list";
const PUBLIC_URL = "https://www.jiuyangongshe.com/timeline";
const SIGN_PREFIX = "Uu0KfOB8iUP69d3c:";
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MONTH_OFFSETS = [-1, 0, 1, 2, 3];
const CACHE_VERSION = 1;

let apiClockOffsetMs = 0;
const inflight = new Map();

function cleanText(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function validDate(value) {
  const match = String(value || "").match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function nowDate(value) {
  const date = new Date(value == null ? Date.now() : value);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function shanghaiDateParts(value) {
  const date = nowDate(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function monthKey(value, offset = 0) {
  const parts = shanghaiDateParts(value);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1 + Number(offset || 0), 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function requestedMonths(value, offsets = DEFAULT_MONTH_OFFSETS) {
  return [...new Set((Array.isArray(offsets) ? offsets : DEFAULT_MONTH_OFFSETS).map((offset) => monthKey(value, offset)))];
}

function createRequestToken(timestamp) {
  return crypto.createHash("md5").update(`${SIGN_PREFIX}${timestamp}`).digest("hex");
}

function importanceHint(grade) {
  const numeric = Number(grade);
  if (numeric === 1) return "五星/重磅";
  if (numeric === 3) return "三星/重点";
  if (numeric === 5) return "一星/普通";
  return "未标级";
}

function normalizeTimelineItem(item, groupDate) {
  if (!item || typeof item !== "object") return null;
  const timeline = item.timeline && typeof item.timeline === "object" ? item.timeline : {};
  const title = cleanText(item.title);
  const eventDate = validDate(timeline.date || groupDate);
  if (!title || !eventDate) return null;
  const content = cleanText(item.content || item.summary).slice(0, 1600);
  const themes = (Array.isArray(timeline.theme_list) ? timeline.theme_list : [])
    .map((theme) => cleanText(theme && theme.name))
    .filter(Boolean);
  const articleId = cleanText(item.article_id);
  const timelineId = cleanText(timeline.timeline_id);
  const fallbackId = crypto.createHash("sha1").update(`${eventDate}|${title}`).digest("hex").slice(0, 20);
  const grade = Number.isFinite(Number(timeline.grade)) ? Number(timeline.grade) : null;
  return {
    id: `jiuyan:${timelineId || articleId || fallbackId}`,
    articleId: articleId || null,
    timelineId: timelineId || null,
    title,
    summary: content,
    content,
    time: cleanText(timeline.create_time),
    eventDate,
    source: "韭研公社时间轴",
    publisher: "韭研公社",
    sourceProvider: "jiuyan",
    sourceType: "professional-calendar",
    sourceGrade: grade,
    sourceGradeLabel: importanceHint(grade),
    sourceUrl: PUBLIC_URL,
    themes,
  };
}

function normalizeTimelineResponse(payload) {
  if (!payload || typeof payload !== "object") throw new Error("韭研时间轴返回为空");
  if (Number(payload.errCode) !== 0) throw new Error(cleanText(payload.msg) || `韭研时间轴错误码 ${payload.errCode}`);
  if (!Array.isArray(payload.data)) throw new Error("韭研时间轴数据结构异常");
  const rows = [];
  for (const group of payload.data) {
    if (!group || !Array.isArray(group.list)) continue;
    for (const item of group.list) {
      const normalized = normalizeTimelineItem(item, group.date);
      if (normalized) rows.push(normalized);
    }
  }
  return dedupeItems(rows);
}

function dedupeItems(rows) {
  const byId = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.title || !row.eventDate) continue;
    const key = row.timelineId || row.articleId || `${row.eventDate}|${row.title}`;
    const previous = byId.get(key);
    if (!previous) {
      byId.set(key, row);
      continue;
    }
    const richer = String(row.summary || "").length >= String(previous.summary || "").length ? row : previous;
    byId.set(key, {
      ...previous,
      ...row,
      summary: richer.summary,
      content: richer.content,
      themes: [...new Set([...(previous.themes || []), ...(row.themes || [])])],
    });
  }
  return [...byId.values()].sort((left, right) => (
    String(left.eventDate).localeCompare(String(right.eventDate))
    || Number(left.sourceGrade || 99) - Number(right.sourceGrade || 99)
    || String(left.title).localeCompare(String(right.title), "zh-CN")
  ));
}

function readTimelineCache(cacheFile) {
  if (!cacheFile) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (!parsed || parsed.version !== CACHE_VERSION || !Array.isArray(parsed.items)) return null;
    return { ...parsed, items: dedupeItems(parsed.items) };
  } catch {
    return null;
  }
}

function writeTimelineCache(cacheFile, record) {
  if (!cacheFile) return false;
  const folder = path.dirname(cacheFile);
  const tempFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(folder, { recursive: true });
    const json = `${JSON.stringify(record, null, 2)}\n`;
    fs.writeFileSync(tempFile, json, "utf8");
    try {
      fs.renameSync(tempFile, cacheFile);
    } catch {
      fs.writeFileSync(cacheFile, json, "utf8");
      try { fs.unlinkSync(tempFile); } catch {}
    }
    return true;
  } catch {
    try { fs.unlinkSync(tempFile); } catch {}
    return false;
  }
}

function cacheAgeMinutes(cache, nowMs) {
  const fetchedAt = new Date(cache && cache.fetchedAt || 0).getTime();
  return Number.isFinite(fetchedAt) && fetchedAt > 0 ? Math.max(0, Math.round((nowMs - fetchedAt) / 60000)) : null;
}

function dateDistanceDays(dateText, value) {
  const parts = shanghaiDateParts(value);
  const today = Date.UTC(parts.year, parts.month - 1, parts.day);
  const match = String(dateText || "").match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Math.round((target - today) / 86400000);
}

function scopedItems(rows, value, pastDays = 5, futureDays = 120) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const distance = dateDistanceDays(row.eventDate, value);
    return distance != null && distance >= -Math.abs(pastDays) && distance <= Math.abs(futureDays);
  });
}

function trimHistory(rows, value) {
  return dedupeItems(rows).filter((row) => {
    const distance = dateDistanceDays(row.eventDate, value);
    return distance != null && distance >= -730 && distance <= 370;
  }).slice(-4000);
}

function updateClockOffsetFromResponse(response, localNow) {
  try {
    const header = response && response.headers && response.headers.get && response.headers.get("date");
    const serverNow = new Date(header || "").getTime();
    if (!Number.isFinite(serverNow)) return;
    const offset = serverNow - localNow;
    if (Math.abs(offset) >= 60000 && Math.abs(offset) <= 86400000) apiClockOffsetMs = offset;
  } catch {}
}

async function requestMonth(month, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("当前运行环境不支持网络请求");
  const timeoutMs = Math.max(2000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const retries = Math.max(0, Number(options.retries == null ? 2 : options.retries));
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const localNow = Date.now();
    const timestamp = String(localNow + apiClockOffsetMs);
    try {
      const response = await fetchImpl(API_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json",
          platform: "3",
          timestamp,
          token: createRequestToken(timestamp),
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ grade: 0, keyword: "", theme_id: "", date: month }),
      });
      updateClockOffsetFromResponse(response, localNow);
      if (response && response.ok === false) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      return normalizeTimelineResponse(payload);
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  const message = lastError && lastError.name === "AbortError" ? "请求超时" : cleanText(lastError && lastError.message) || "请求失败";
  throw new Error(`${month} ${message}`);
}

function sourceStatus(state, details = {}) {
  return {
    key: "jiuyan",
    label: "韭研公社时间轴",
    state,
    ok: state !== "unavailable",
    sourceUrl: PUBLIC_URL,
    ...details,
  };
}

async function fetchTimelineInternal(options = {}) {
  const current = nowDate(options.now);
  const nowMs = current.getTime();
  const months = requestedMonths(current, options.monthOffsets);
  const cache = readTimelineCache(options.cacheFile);
  const ttlMs = Math.max(0, Number(options.ttlMs == null ? DEFAULT_TTL_MS : options.ttlMs));
  const age = cacheAgeMinutes(cache, nowMs);
  const cacheFresh = cache && age != null && age * 60000 <= ttlMs && months.every((month) => (cache.months || []).includes(month));
  if (!options.forceRefresh && cacheFresh) {
    const items = scopedItems(cache.items, current, options.pastDays, options.futureDays);
    return {
      items,
      status: sourceStatus("cache-fresh", {
        fetchedAt: cache.fetchedAt,
        servedAt: current.toISOString(),
        cacheAgeMinutes: age,
        itemCount: items.length,
        requestedMonths: months,
        succeededMonths: months,
        failedMonths: [],
        message: "30分钟内已有成功数据，直接使用本地缓存",
      }),
    };
  }

  const outcomes = await Promise.all(months.map(async (month) => {
    try {
      return { month, ok: true, items: await requestMonth(month, options) };
    } catch (error) {
      return { month, ok: false, items: [], error: cleanText(error && error.message) || "请求失败" };
    }
  }));
  const succeeded = outcomes.filter((item) => item.ok);
  const failed = outcomes.filter((item) => !item.ok);
  const freshItems = dedupeItems(succeeded.flatMap((item) => item.items));
  const previousItems = cache && Array.isArray(cache.items) ? cache.items : [];

  if (succeeded.length) {
    const history = trimHistory([...previousItems, ...freshItems], current);
    const fetchedAt = current.toISOString();
    writeTimelineCache(options.cacheFile, {
      version: CACHE_VERSION,
      fetchedAt,
      lastSuccessfulAt: fetchedAt,
      lastAttemptAt: fetchedAt,
      months: [...new Set([...(cache && cache.months || []), ...succeeded.map((item) => item.month)])],
      lastErrors: failed.map((item) => item.error),
      items: history,
    });
    const items = scopedItems(history, current, options.pastDays, options.futureDays);
    const state = failed.length ? "partial" : "live";
    return {
      items,
      status: sourceStatus(state, {
        fetchedAt,
        servedAt: fetchedAt,
        cacheAgeMinutes: 0,
        itemCount: items.length,
        fetchedCount: freshItems.length,
        requestedMonths: months,
        succeededMonths: succeeded.map((item) => item.month),
        failedMonths: failed.map((item) => item.month),
        message: failed.length ? `部分月份更新失败，失败月份继续使用历史缓存` : "韭研时间轴实时抓取成功并已保存",
      }),
    };
  }

  if (cache && cache.items.length) {
    const items = scopedItems(cache.items, current, options.pastDays, options.futureDays);
    writeTimelineCache(options.cacheFile, {
      ...cache,
      lastAttemptAt: current.toISOString(),
      lastErrors: failed.map((item) => item.error),
    });
    return {
      items,
      status: sourceStatus("stale-cache", {
        fetchedAt: cache.fetchedAt || cache.lastSuccessfulAt || null,
        servedAt: current.toISOString(),
        cacheAgeMinutes: age,
        itemCount: items.length,
        requestedMonths: months,
        succeededMonths: [],
        failedMonths: failed.map((item) => item.month),
        message: "韭研接口暂时不可用，已自动使用上次成功保存的数据",
      }),
    };
  }

  return {
    items: [],
    status: sourceStatus("unavailable", {
      fetchedAt: null,
      servedAt: current.toISOString(),
      cacheAgeMinutes: null,
      itemCount: 0,
      requestedMonths: months,
      succeededMonths: [],
      failedMonths: failed.map((item) => item.month),
      message: "韭研接口不可用且本地尚无缓存；事件层已隔离，不影响原系统",
    }),
  };
}

function fetchJiuyanTimeline(options = {}) {
  const key = path.resolve(options.cacheFile || path.join(process.cwd(), ".jiuyan-timeline-cache.json"));
  if (inflight.has(key)) return inflight.get(key);
  const task = fetchTimelineInternal({ ...options, cacheFile: key });
  inflight.set(key, task);
  task.finally(() => {
    if (inflight.get(key) === task) inflight.delete(key);
  }).catch(() => {});
  return task;
}

function loadCachedJiuyanTimeline(options = {}) {
  const cacheFile = path.resolve(options.cacheFile || path.join(process.cwd(), ".jiuyan-timeline-cache.json"));
  const cache = readTimelineCache(cacheFile);
  const current = nowDate(options.now);
  if (!cache) return null;
  const items = scopedItems(cache.items, current, options.pastDays, options.futureDays);
  return {
    items,
    status: sourceStatus("cache-fresh", {
      fetchedAt: cache.fetchedAt || cache.lastSuccessfulAt || null,
      servedAt: current.toISOString(),
      cacheAgeMinutes: cacheAgeMinutes(cache, current.getTime()),
      itemCount: items.length,
      requestedMonths: requestedMonths(current, options.monthOffsets),
      succeededMonths: cache.months || [],
      failedMonths: [],
      message: "软件启动后已恢复本地保存的韭研时间轴",
    }),
  };
}

module.exports = {
  API_URL,
  PUBLIC_URL,
  createRequestToken,
  requestedMonths,
  normalizeTimelineItem,
  normalizeTimelineResponse,
  fetchJiuyanTimeline,
  loadCachedJiuyanTimeline,
};
