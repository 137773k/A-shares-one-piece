"use strict";

const fs = require("fs");
const path = require("path");

const FED_CALENDAR_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
const CFFEX_RULE_URL = "https://www.cffex.com.cn/jystz/20250110/42236.html";
const CACHE_VERSION = 1;
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 9000;

const MONTH_INDEX = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

// Official schedules are retained only as an offline safety net. Live refreshes still
// prefer the Federal Reserve calendar and overwrite the cache when successful.
const BUILTIN_FOMC_SCHEDULE = {
  2026: [
    [0, "27-28", false],
    [2, "17-18", true],
    [3, "28-29", false],
    [5, "16-17", true],
    [6, "28-29", false],
    [8, "15-16", true],
    [9, "27-28", false],
    [11, "8-9", true],
  ],
  2027: [
    [0, "26-27", false],
    [2, "16-17", true],
    [3, "27-28", false],
    [5, "8-9", true],
    [6, "27-28", false],
    [8, "14-15", true],
    [9, "26-27", false],
    [11, "7-8", true],
  ],
};

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function dateKey(year, monthIndex, day) {
  const value = new Date(Date.UTC(Number(year), Number(monthIndex), Number(day)));
  if (!Number.isFinite(value.getTime())) return null;
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function addUtcDays(value, days) {
  const matched = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return null;
  const date = new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return dateKey(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function shanghaiDateKey(value) {
  const date = new Date(value || Date.now());
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateDistanceDays(left, right) {
  const parse = (value) => {
    const matched = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return matched ? Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])) : NaN;
  };
  const start = parse(left);
  const end = parse(right);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 86400000) : null;
}

function fomcEvent(year, monthIndex, dateRange, hasProjections, sourceMode = "live") {
  const days = String(dateRange || "").replace(/\*/g, "").match(/\d{1,2}/g) || [];
  if (!days.length) return null;
  const startDay = Number(days[0]);
  const decisionDay = Number(days[days.length - 1]);
  const officialDecisionDate = dateKey(year, monthIndex, decisionDay);
  const meetingStartDate = dateKey(year, monthIndex, startDay);
  const eventDate = addUtcDays(officialDecisionDate, 1);
  if (!officialDecisionDate || !eventDate) return null;
  const projectionNote = hasProjections ? "，并发布经济预测摘要（SEP）" : "";
  const sourceSuffix = sourceMode === "live" ? "" : "（离线备份）";
  return {
    id: `fomc-${officialDecisionDate}`,
    title: "美联储FOMC公布利率决议",
    summary: `FOMC于美国当地${meetingStartDate}至${officialDecisionDate}召开${projectionNote}；政策声明对应北京时间次日凌晨，A股在${eventDate}开盘验证全球风险偏好传导。`,
    content: "重点追踪美元指数、美债收益率、人民币汇率、黄金与全球科技股反馈；方向取决于结果和指引相对市场预期更鹰还是更鸽。",
    eventDate,
    time: `${eventDate} 02:00:00`,
    source: `美国联邦储备委员会官方日历${sourceSuffix}`,
    publisher: "Federal Reserve",
    sourceProvider: "federal-reserve-calendar",
    sourceType: "official",
    sourceGrade: 1,
    sourceGradeLabel: "官方/宏观重点",
    sourceUrl: FED_CALENDAR_URL,
    themes: ["FOMC", "美联储", "利率决议", "全球风险偏好"],
    calendarRole: "short-term-risk",
    calendarKind: "monetary-policy",
    calendarMeta: {
      label: "美联储议息",
      officialDate: officialDecisionDate,
      meetingWindow: `${meetingStartDate} 至 ${officialDecisionDate}`,
      chinaObservationDate: eventDate,
      timeBasis: "北京时间次日凌晨，A股于当日开盘验证",
      sourceBasis: sourceMode === "live" ? "美联储官方会议日历实时读取" : "美联储官方会议日历内置备份，恢复联网后会自动校准",
      impactMechanism: [
        "美元和美债收益率先反应，再传导至人民币汇率、北向敏感资产与高估值科技。",
        "真正影响短线的不是加息或降息四个字，而是结果、点阵图和记者会相对市场预期的偏差。",
      ],
      watchItems: ["美元指数与美债收益率", "纳指、费半及海外半导体核心", "人民币汇率与A股高估值科技开盘承接"],
    },
  };
}

function parseFomcCalendarHtml(html) {
  const source = String(html || "");
  const markers = [...source.matchAll(/(20\d{2}) FOMC Meetings/g)];
  const rows = [];
  for (let index = 0; index < markers.length; index += 1) {
    const year = Number(markers[index][1]);
    const start = markers[index].index || 0;
    const end = index + 1 < markers.length ? markers[index + 1].index : source.length;
    const block = source.slice(start, end);
    const meetingPattern = /fomc-meeting__month[^>]*>\s*<strong>([A-Za-z]+)<\/strong><\/div>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)<\/div>/gi;
    for (const match of block.matchAll(meetingPattern)) {
      const monthIndex = MONTH_INDEX[String(match[1] || "").toLowerCase()];
      const rawDates = cleanText(match[2]);
      if (!Number.isInteger(monthIndex) || !rawDates) continue;
      const event = fomcEvent(year, monthIndex, rawDates, rawDates.includes("*"), "live");
      if (event) rows.push(event);
    }
  }
  return rows;
}

function builtinFomcEvents() {
  return Object.entries(BUILTIN_FOMC_SCHEDULE).flatMap(([year, meetings]) => meetings
    .map(([monthIndex, range, projections]) => fomcEvent(Number(year), monthIndex, range, projections, "builtin"))
    .filter(Boolean));
}

function thirdFriday(year, monthIndex) {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const firstFriday = 1 + ((5 - first.getUTCDay() + 7) % 7);
  return dateKey(year, monthIndex, firstFriday + 14);
}

function cffexSettlementEvent(year, monthIndex) {
  const eventDate = thirdFriday(year, monthIndex);
  if (!eventDate) return null;
  return {
    id: `cffex-settlement-${eventDate.slice(0, 7)}`,
    title: "股指期货和股指期权交割日",
    summary: "中金所股指期货与股指期权合约通常在到期月份第三个星期五交割；交割和展期可能放大指数权重、期现基差及尾盘资金波动。",
    content: "该节点不预设涨跌，只提高对指数权重、期指基差、成交量和尾盘异动的观察优先级。",
    eventDate,
    time: `${eventDate} 15:00:00`,
    source: "中国金融期货交易所交割规则",
    publisher: "中国金融期货交易所",
    sourceProvider: "cffex-settlement-rule",
    sourceType: "official",
    sourceGrade: 3,
    sourceGradeLabel: "官方规则/资金节点",
    sourceUrl: CFFEX_RULE_URL,
    themes: ["股指期货", "股指期权", "交割日", "指数权重"],
    calendarRole: "short-term-risk",
    calendarKind: "market-structure",
    calendarMeta: {
      label: "股指交割",
      officialDate: eventDate,
      meetingWindow: eventDate,
      chinaObservationDate: eventDate,
      timeBasis: "A股交易时段，重点观察午后与尾盘",
      sourceBasis: "依据中金所第三个星期五交割规则推算；遇法定假日或不交易时以下一交易日及当月通知为准",
      impactMechanism: [
        "合约到期、移仓与现金交割可能放大期现基差、指数权重和尾盘成交，但不天然代表利空或利好。",
        "只有指数、权重、期指基差与市场广度同时异常，才把波动归因升级为交割影响。",
      ],
      watchItems: ["IF/IH/IC/IM期指基差", "沪深300、上证50及指数权重", "14:00后成交量与尾盘方向", "涨跌家数是否与指数背离"],
    },
  };
}

function buildCffexSettlementEvents(nowValue, monthsAhead = 12) {
  const currentKey = shanghaiDateKey(nowValue);
  const matched = currentKey.match(/^(\d{4})-(\d{2})-/);
  const startYear = Number(matched && matched[1]);
  const startMonth = Number(matched && matched[2]) - 1;
  const rows = [];
  for (let offset = -1; offset <= monthsAhead; offset += 1) {
    const cursor = new Date(Date.UTC(startYear, startMonth + offset, 1));
    const event = cffexSettlementEvent(cursor.getUTCFullYear(), cursor.getUTCMonth());
    if (event) rows.push(event);
  }
  return rows;
}

function readCache(cacheFile) {
  try {
    if (!cacheFile || !fs.existsSync(cacheFile)) return null;
    const parsed = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (!parsed || parsed.version !== CACHE_VERSION || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(cacheFile, items, updatedAt) {
  if (!cacheFile) return;
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  const tempFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify({ version: CACHE_VERSION, updatedAt, items }, null, 2), "utf8");
  fs.renameSync(tempFile, cacheFile);
}

function scopeItems(items, nowValue, pastDays = 5, futureDays = 370) {
  const today = shanghaiDateKey(nowValue);
  return (Array.isArray(items) ? items : [])
    .filter((item) => {
      const distance = dateDistanceDays(today, item && item.eventDate);
      return Number.isFinite(distance) && distance >= -pastDays && distance <= futureDays;
    })
    .sort((left, right) => String(left.eventDate || "").localeCompare(String(right.eventDate || "")) || String(left.title || "").localeCompare(String(right.title || "")));
}

function sourceStatus(key, label, state, itemCount, message, nowIso, extra = {}) {
  return {
    key,
    label,
    state,
    ok: state === "live" || state === "cache-fresh" || state === "stale-cache" || state === "partial",
    itemCount: Number(itemCount) || 0,
    fetchedAt: extra.fetchedAt || nowIso,
    servedAt: nowIso,
    message,
    sourceUrl: extra.sourceUrl || null,
    cacheAgeMinutes: Number.isFinite(Number(extra.cacheAgeMinutes)) ? Number(extra.cacheAgeMinutes) : null,
  };
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl || fetch)(url, {
      headers: { "user-agent": "Mozilla/5.0 A-share-event-calendar/1.0" },
      signal: controller.signal,
    });
    if (!response || !response.ok) throw new Error(`HTTP ${response && response.status || "unknown"}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMarketCalendar(options = {}) {
  const now = new Date(options.now || Date.now());
  const nowIso = Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();
  const cache = readCache(options.cacheFile);
  const cacheAgeMs = cache && cache.updatedAt ? Math.max(0, nowMs - new Date(cache.updatedAt).getTime()) : Infinity;
  const ttlMs = Number(options.ttlMs) || DEFAULT_TTL_MS;
  let fomcItems = [];
  let fomcState = "live";
  let fomcMessage = "美联储官方会议日历读取成功";
  let fetchedAt = nowIso;

  if (!options.forceRefresh && cache && cacheAgeMs <= ttlMs) {
    fomcItems = cache.items;
    fomcState = "cache-fresh";
    fomcMessage = "使用已保存的美联储官方会议日历";
    fetchedAt = cache.updatedAt || nowIso;
  } else {
    try {
      const html = await fetchText(FED_CALENDAR_URL, options);
      fomcItems = parseFomcCalendarHtml(html);
      if (fomcItems.length < 8) throw new Error("官方页面未解析出完整会议日历");
      writeCache(options.cacheFile, fomcItems, nowIso);
    } catch (error) {
      if (cache && cache.items.length) {
        fomcItems = cache.items;
        fomcState = "stale-cache";
        fomcMessage = `美联储官网暂不可达，继续使用上次保存日历：${error.message || "unknown"}`;
        fetchedAt = cache.updatedAt || nowIso;
      } else {
        fomcItems = builtinFomcEvents();
        fomcState = "partial";
        fomcMessage = `美联储官网暂不可达，使用官方日历离线备份：${error.message || "unknown"}`;
      }
    }
  }

  const cffexItems = buildCffexSettlementEvents(nowIso, Number(options.monthsAhead) || 12);
  const scopedFomc = scopeItems(fomcItems, nowIso);
  const scopedCffex = scopeItems(cffexItems, nowIso);
  const statuses = [
    sourceStatus(
      "federal-reserve-calendar",
      "美联储FOMC官方日历",
      fomcState,
      scopedFomc.length,
      fomcMessage,
      nowIso,
      { fetchedAt, sourceUrl: FED_CALENDAR_URL, cacheAgeMinutes: Number.isFinite(cacheAgeMs) ? cacheAgeMs / 60000 : null },
    ),
    sourceStatus(
      "cffex-settlement-rule",
      "中金所交割规则日历",
      "live",
      scopedCffex.length,
      "按中金所第三个星期五规则生成，遇休市顺延并以当月通知为准",
      nowIso,
      { sourceUrl: CFFEX_RULE_URL },
    ),
  ];
  return {
    version: "market-calendar-v1",
    updatedAt: nowIso,
    items: [...scopedFomc, ...scopedCffex].sort((left, right) => String(left.eventDate).localeCompare(String(right.eventDate))),
    statuses,
    status: {
      key: "market-risk-calendar",
      label: "短线风险日历",
      state: fomcState === "live" ? "live" : "partial",
      ok: true,
      itemCount: scopedFomc.length + scopedCffex.length,
      servedAt: nowIso,
      message: "股指交割与美联储议息节点均已加入，作为短线情绪风险观察，不直接生成买点",
    },
  };
}

function loadCachedMarketCalendar(options = {}) {
  const nowIso = new Date(options.now || Date.now()).toISOString();
  const cache = readCache(options.cacheFile);
  const fomcItems = cache && cache.items.length ? cache.items : builtinFomcEvents();
  const fomcState = cache && cache.items.length ? "stale-cache" : "partial";
  const scopedFomc = scopeItems(fomcItems, nowIso);
  const scopedCffex = scopeItems(buildCffexSettlementEvents(nowIso, Number(options.monthsAhead) || 12), nowIso);
  return {
    version: "market-calendar-v1",
    updatedAt: cache && cache.updatedAt || nowIso,
    items: [...scopedFomc, ...scopedCffex].sort((left, right) => String(left.eventDate).localeCompare(String(right.eventDate))),
    statuses: [
      sourceStatus("federal-reserve-calendar", "美联储FOMC官方日历", fomcState, scopedFomc.length, cache ? "已恢复上次保存的美联储官方日历" : "使用美联储官方日历离线备份，联网后自动校准", nowIso, { fetchedAt: cache && cache.updatedAt, sourceUrl: FED_CALENDAR_URL }),
      sourceStatus("cffex-settlement-rule", "中金所交割规则日历", "live", scopedCffex.length, "按中金所第三个星期五规则生成，遇休市顺延并以当月通知为准", nowIso, { sourceUrl: CFFEX_RULE_URL }),
    ],
    status: {
      key: "market-risk-calendar",
      label: "短线风险日历",
      state: "partial",
      ok: true,
      itemCount: scopedFomc.length + scopedCffex.length,
      servedAt: nowIso,
      message: "已恢复短线风险日历",
    },
  };
}

function mergeCalendarSources(...sources) {
  const rows = sources.filter((source) => source && typeof source === "object");
  const items = rows.flatMap((source) => Array.isArray(source.items) ? source.items : []);
  const statuses = rows.flatMap((source) => Array.isArray(source.statuses)
    ? source.statuses
    : source.status ? [source.status] : []);
  const servedAt = statuses.map((status) => status && status.servedAt).filter(Boolean).sort().pop() || new Date().toISOString();
  const liveCount = statuses.filter((status) => status && status.state === "live").length;
  const unavailableCount = statuses.filter((status) => status && status.state === "unavailable").length;
  const state = unavailableCount === statuses.length && statuses.length ? "unavailable" : liveCount === statuses.length ? "live" : "partial";
  return {
    version: "combined-event-calendar-v1",
    updatedAt: servedAt,
    items: items.sort((left, right) => String(left && left.eventDate || "").localeCompare(String(right && right.eventDate || ""))),
    statuses,
    status: {
      key: "combined-event-calendar",
      label: "完整事件日历",
      state,
      ok: state !== "unavailable",
      itemCount: items.length,
      servedAt,
      message: "产业时间轴与短线风险日历已合并保存",
    },
  };
}

module.exports = {
  FED_CALENDAR_URL,
  CFFEX_RULE_URL,
  parseFomcCalendarHtml,
  buildCffexSettlementEvents,
  fetchMarketCalendar,
  loadCachedMarketCalendar,
  mergeCalendarSources,
};
