"use strict";
/**
 * news-fetcher.js —— 消息面数据源(东财 7×24 快讯 + 个股新闻 + 个股研报 + 巨潮公告)
 *
 * 端点参数移植自 simonlin1212/a-stock-data(Apache-2.0)的 SKILL 文档,用 Node 重写:
 *   - 全球快讯: np-weblist.eastmoney.com getFastNewsList(财联社快讯2026-05下线后的免费替代)
 *   - 个股新闻: search-api-web.eastmoney.com JSONP(东财搜索接口)
 *   - 个股研报: reportapi.eastmoney.com/report/list(机构/评级/EPS预测)
 *   - 个股公告: cninfo.com.cn hisAnnouncement(巨潮,orgId 动态映射+硬编码兜底)
 *
 * 内置东财节流(emGet):所有本模块的东财请求串行化、最小间隔1s+随机抖动——
 * 东财风控阈值约为 每秒>5次/单IP并发≥10 会临时封IP,与主管线的抓取错峰共存。
 * 巨潮走独立队列(cninfoPost,间隔0.5s),与东财互不排队。
 * 全部函数失败时安全返回 [],不让消息面故障拖垮选股主流程。
 */

const NEWS_CFG = {
  minIntervalMs: 1000,   // 两次东财请求最小间隔(批量时自动降速)
  jitterMs: [100, 500],  // 随机抖动区间
  timeoutMs: 15000,
  ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
};

// ============ 东财统一节流入口(串行 + 间隔 + 抖动) ============
let emQueue = Promise.resolve();
let emLastCall = 0;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function emGet(url, headers = {}, cfg = NEWS_CFG) {
  const run = async () => {
    const wait = cfg.minIntervalMs - (Date.now() - emLastCall);
    if (wait > 0) await sleep(wait + cfg.jitterMs[0] + Math.random() * (cfg.jitterMs[1] - cfg.jitterMs[0]));
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": cfg.ua, Accept: "*/*", ...headers },
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`${url} ${response.status}`);
      return await response.text();
    } finally {
      emLastCall = Date.now();
    }
  };
  const p = emQueue.then(run, run);
  emQueue = p.catch(() => {}); // 队列不因单次失败断链
  return p;
}

// ============ 纯解析(可离线测试) ============
function stripHtml(s) {
  return String(s || "").replace(/<[^>]+>/g, "");
}

/** 解析全球快讯响应 → [{title, summary, time}] */
function normalizeFastNews(payload) {
  const list = (payload && payload.data && payload.data.fastNewsList) || [];
  return (Array.isArray(list) ? list : []).map((item) => ({
    title: stripHtml(item.title),
    summary: stripHtml(item.summary || "").slice(0, 200),
    time: item.showTime || "",
  })).filter((n) => n.title);
}

/** 解析个股新闻 JSONP → [{title, content, time, source, url}] */
function parseStockNewsJsonp(text) {
  const raw = String(text || "");
  const start = raw.indexOf("(");
  const end = raw.lastIndexOf(")");
  if (start < 0 || end <= start) return [];
  let d;
  try { d = JSON.parse(raw.slice(start + 1, end)); } catch (e) { return []; }
  // 注意:部分IP被东财间歇风控时只返回 passportWeb 而无 cmsArticleWebOld → 安全返回空
  const articles = (d && d.result && d.result.cmsArticleWebOld) || [];
  return (Array.isArray(articles) ? articles : []).map((a) => ({
    title: stripHtml(a.title),
    content: stripHtml(a.content || "").slice(0, 200),
    time: a.date || "",
    source: a.mediaName || "",
    url: a.url || "",
  })).filter((n) => n.title);
}

/** 巨潮 announcementTime 是 Unix 毫秒 → YYYY-MM-DD */
function cninfoTsToDate(ts) {
  if (typeof ts === "number" && Number.isFinite(ts)) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  return ts ? String(ts).slice(0, 10) : "";
}

/** 解析巨潮公告响应 → [{title, type, date, url}] */
function normalizeAnnouncements(payload) {
  const list = (payload && payload.announcements) || [];
  return (Array.isArray(list) ? list : []).map((a) => ({
    title: stripHtml(a.announcementTitle),
    type: a.announcementTypeName || "",
    date: cninfoTsToDate(a.announcementTime),
    url: a.announcementId ? `https://www.cninfo.com.cn/new/disclosure/detail?annoId=${a.announcementId}` : "",
  })).filter((n) => n.title);
}

/** 解析东财研报响应 → [{title, org, rating, date, epsThisYear}] */
function normalizeReports(payload) {
  const list = (payload && payload.data) || [];
  return (Array.isArray(list) ? list : []).map((r) => ({
    title: stripHtml(r.title),
    org: r.orgSName || "",
    rating: r.emRatingName || "",
    date: String(r.publishDate || "").slice(0, 10),
    epsThisYear: r.predictThisYearEps || null,
  })).filter((n) => n.title);
}

/**
 * 新闻关键词命中(给 analyzeNewsRisk 用的抗噪版):
 * 7×24 快讯里 关税/加息/地缘 之类词几乎天天出现,单条提及不代表系统性风险。
 * 规则:同一关键词出现在 ≥minTitles 条不同新闻的标题里才算命中(默认2条)。
 */
function newsKeywordHits(rows, keywords, minTitles = 2) {
  const titles = (rows || []).map((n) => String(n.title || "")).filter(Boolean);
  return (keywords || []).filter(
    (word) => titles.filter((t) => t.includes(word)).length >= minTitles,
  );
}

// ============ 抓取 ============
/** 东财全球财经快讯(7×24滚动) */
async function fetchGlobalNews(pageSize = 50) {
  try {
    const params = new URLSearchParams({
      client: "web", biz: "web_724", fastColumn: "102", sortEnd: "",
      pageSize: String(pageSize),
      req_trace: `${Date.now()}${Math.floor(Math.random() * 1e6)}`,
    });
    const text = await emGet(
      `https://np-weblist.eastmoney.com/comm/web/getFastNewsList?${params}`,
      { Referer: "https://kuaixun.eastmoney.com/" },
    );
    return normalizeFastNews(JSON.parse(text));
  } catch (e) {
    return [];
  }
}

/** 东财个股研报(近 lookbackDays 天,默认180天,单页) */
async function fetchStockReports(code, pageSize = 8, lookbackDays = 180) {
  try {
    const begin = new Date(Date.now() - lookbackDays * 86400000);
    const p = (n) => String(n).padStart(2, "0");
    const beginStr = `${begin.getFullYear()}-${p(begin.getMonth() + 1)}-${p(begin.getDate())}`;
    const params = new URLSearchParams({
      industryCode: "*", pageSize: String(pageSize), industry: "*",
      rating: "*", ratingChange: "*",
      beginTime: beginStr, endTime: "2030-01-01",
      pageNo: "1", fields: "", qType: "0",
      orgCode: "", code: String(code), rcode: "",
      p: "1", pageNum: "1", pageNumber: "1",
    });
    const text = await emGet(
      `https://reportapi.eastmoney.com/report/list?${params}`,
      { Referer: "https://data.eastmoney.com/" },
    );
    return normalizeReports(JSON.parse(text));
  } catch (e) {
    return [];
  }
}

// ============ 巨潮公告(独立节流队列,不与东财排队) ============
let cnQueue = Promise.resolve();
let cnLastCall = 0;
const CN_MIN_INTERVAL = 500;

function cninfoPost(url, form, headers = {}, cfg = NEWS_CFG) {
  const run = async () => {
    const wait = CN_MIN_INTERVAL - (Date.now() - cnLastCall);
    if (wait > 0) await sleep(wait + 50 + Math.random() * 200);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "User-Agent": cfg.ua,
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: "https://www.cninfo.com.cn/new/disclosure",
          Origin: "https://www.cninfo.com.cn",
          ...headers,
        },
        body: new URLSearchParams(form).toString(),
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`${url} ${response.status}`);
      return await response.text();
    } finally {
      cnLastCall = Date.now();
    }
  };
  const p = cnQueue.then(run, run);
  cnQueue = p.catch(() => {});
  return p;
}

// 巨潮 股票→orgId 映射(模块级缓存,首次拉取全程复用)
// ⚠️ orgId 并非统一 gssx0{code} 格式(601318→9900002221 等),硬编码会导致部分股票查不到公告
let cninfoOrgIdMap = null;

async function loadCninfoOrgIds(cfg = NEWS_CFG) {
  if (cninfoOrgIdMap) return cninfoOrgIdMap;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
    const response = await fetch("https://www.cninfo.com.cn/new/data/szse_stock.json", {
      signal: controller.signal,
      headers: { "User-Agent": cfg.ua },
    });
    clearTimeout(timeout);
    const data = await response.json();
    cninfoOrgIdMap = new Map(((data && data.stockList) || []).map((s) => [s.code, s.orgId]));
  } catch (e) {
    cninfoOrgIdMap = new Map(); // 拉取失败留空Map,走硬编码兜底,下次进程重启再试
  }
  return cninfoOrgIdMap;
}

function cninfoOrgIdFallback(code) {
  if (code.startsWith("6")) return `gssh0${code}`;
  if (code.startsWith("8") || code.startsWith("4")) return `gsbj0${code}`;
  return `gssz0${code}`;
}

/** 巨潮个股公告 */
async function fetchAnnouncements(code, pageSize = 8) {
  try {
    const map = await loadCninfoOrgIds();
    const orgId = map.get(String(code)) || cninfoOrgIdFallback(String(code));
    const text = await cninfoPost("https://www.cninfo.com.cn/new/hisAnnouncement/query", {
      stock: `${code},${orgId}`,
      tabName: "fulltext",
      pageSize: String(pageSize),
      pageNum: "1",
      column: "", category: "", plate: "", seDate: "",
      searchkey: "", secid: "", sortName: "", sortType: "",
      isHLtitle: "true",
    });
    return normalizeAnnouncements(JSON.parse(text));
  } catch (e) {
    return [];
  }
}

/** 东财个股新闻(JSONP)。code 传6位代码;间歇性返回空属东财对IP的风控,重试即可 */
async function fetchStockNews(code, pageSize = 10) {
  try {
    const inner = JSON.stringify({
      uid: "", keyword: String(code),
      type: ["cmsArticleWebOld"],
      client: "web", clientType: "web", clientVersion: "curr",
      param: { cmsArticleWebOld: { searchScope: "default", sort: "default", pageIndex: 1, pageSize, preTag: "", postTag: "" } },
    });
    const params = new URLSearchParams({ cb: "jQuery_news", param: inner });
    const text = await emGet(
      `https://search-api-web.eastmoney.com/search/jsonp?${params}`,
      { Referer: "https://so.eastmoney.com/" },
    );
    return parseStockNewsJsonp(text);
  } catch (e) {
    return [];
  }
}

module.exports = {
  NEWS_CFG,
  fetchGlobalNews, fetchStockNews, fetchStockReports, fetchAnnouncements,
  normalizeFastNews, parseStockNewsJsonp, normalizeAnnouncements, normalizeReports,
  newsKeywordHits, stripHtml, cninfoTsToDate,
};
