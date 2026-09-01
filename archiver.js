"use strict";
/**
 * archiver.js —— 盘后落库 + 复盘报告(闭环的"历史沉淀层")
 *
 * 你的系统是实时快照型:情绪周期/板块强度/候选打分算完收盘就丢了。
 * 这个模块每天收盘后把它们存下来,让系统开始"攒历史"——
 * 没有历史,"周期分类准不准 / 主升日打板溢价是不是真高"永远无法验证。
 *
 * 产出(默认在 ./data 下):
 *   data/history/YYYY-MM-DD.json   当日完整快照(原样归档,字段以后要什么有什么)
 *   data/history/index.json        每日摘要索引(轻量,一天一行,统计直接读它)
 *   data/history-revisions/local/YYYY-MM-DD/<sha256>.json  同日覆盖前的原字节修订
 *   data/reports/YYYY-MM-DD.md     当日复盘报告(给人看的)
 *
 * 用法(独立运行,不侵入 server.js):
 *   node archiver.js                     # 从本机运行中的服务抓 /api/hot-stocks
 *   node archiver.js --port 8000        # 指定端口
 *   node archiver.js --file dump.json   # 或从 --dump-data 导出的文件归档(离线)
 * 定时:crontab 加一行  35 15 * * 1-5  cd /path/to/project && node archiver.js
 * (或接 node-cron 进 server.js,见文件底部注释)
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { isDeepStrictEqual } = require("util");
const { buildNewsSection } = require("./news-digest");
const { normalizeTradingDate } = require("./theme-library");
const {
  buildDecisionReceipt,
  validateDecisionReceipt,
} = require("./quant-decision/decision-receipt");

const APP_ROOT = path.resolve(process.env.A_SHARE_RUNTIME_DIR || __dirname);
const DATA_DIR = path.join(APP_ROOT, "data");
const HIST_DIR = path.join(DATA_DIR, "history");
const REPORT_DIR = path.join(DATA_DIR, "reports");
const REVISION_DIR = path.join(DATA_DIR, "history-revisions", "local");

// ============ 小工具 ============
function todayYmd(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fallback; }
}
function fsyncDirectoryBestEffort(dir) {
  let fd;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch (_) {
    // Windows generally does not allow fsync on directory handles. The file
    // itself is still fsynced before rename, which is the important guarantee.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
function atomicWriteBuffer(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tempFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  let fd;
  try {
    fd = fs.openSync(tempFile, "wx", 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempFile, file);
    fsyncDirectoryBestEffort(path.dirname(file));
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) { /* already closed */ }
    }
    try { fs.rmSync(tempFile, { force: true }); } catch (_) { /* best effort cleanup */ }
    throw error;
  }
}
function serializeJson(obj) {
  return Buffer.from(JSON.stringify(obj, null, 2), "utf8");
}
function writeJson(file, obj) {
  atomicWriteBuffer(file, serializeJson(obj));
}
function listArchiveSnapshotFiles(histDir = HIST_DIR) {
  try {
    return fs.readdirSync(histDir)
      .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file) && file !== 'index.json')
      .sort();
  } catch {
    return [];
  }
}
function summarizeArchiveSnapshot(histDir, file) {
  const date = file.slice(0, 10);
  const payload = readJson(path.join(histDir, file), null);
  if (!payload || typeof payload !== "object") return { date, summary: null };
  const payloadDate = providerTradingDate(payload);
  const archiveDate = normalizeTradingDate(
    payload && payload.archiveMeta && payload.archiveMeta.tradingDate,
  );
  if ((payloadDate && payloadDate !== date) || (archiveDate && archiveDate !== date)) {
    return { date, summary: null };
  }
  return { date, summary: extractSummary(payload, date) };
}
function loadArchiveIndex(histDir = HIST_DIR) {
  const indexFile = path.join(histDir, 'index.json');
  const saved = Array.isArray(readJson(indexFile, [])) ? readJson(indexFile, []) : [];
  const inspectedSnapshots = listArchiveSnapshotFiles(histDir)
    .map((file) => summarizeArchiveSnapshot(histDir, file));
  const invalidSnapshotDates = new Set(
    inspectedSnapshots.filter((item) => !item.summary).map((item) => item.date),
  );
  const fromSnapshots = inspectedSnapshots.map((item) => item.summary).filter(Boolean);
  const merged = new Map();
  for (const row of saved) {
    if (row && row.date && !invalidSnapshotDates.has(row.date)) merged.set(row.date, row);
  }
  for (const row of fromSnapshots) {
    if (row && row.date) merged.set(row.date, row);
  }
  return Array.from(merged.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}
function rebuildArchiveIndex(histDir = HIST_DIR) {
  const index = listArchiveSnapshotFiles(histDir)
    .map((file) => summarizeArchiveSnapshot(histDir, file).summary)
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  writeJson(path.join(histDir, "index.json"), index);
  return index;
}
function get(obj, keys, fallback = null) { // 容错取值:字段名可能随版本变
  for (const k of keys) {
    const v = k.split(".").reduce((o, p) => (o == null ? undefined : o[p]), obj);
    if (v !== undefined && v !== null) return v;
  }
  return fallback;
}

// ============ 纯逻辑:从完整快照提取每日摘要(防御式,可测) ============
function extractSummary(payload, date) {
  const ms = get(payload, ["market.state", "marketState", "market_state", "analysis.marketState"], {}) || {};
  const limit = get(payload, ["market.limitStats", "limitStats", "limit_stats"], {}) || {};
  const concepts = get(payload, ["hotConcepts", "hot_concepts", "topicBoard.concepts"], []) || [];
  const candidates = get(payload, ["candidates", "rows", "stocks"], []) || [];

  const numOrNull = (v) => (v === null || v === undefined || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const zt = numOrNull(get(limit, ["ztToday", "zt_today", "zt"], null));
  const ztHistory = numOrNull(get(limit, ["ztHistory", "zt_history"], null));
  const zbRate = zt !== null && ztHistory !== null && ztHistory > 0
    ? Math.round(((ztHistory - zt) / ztHistory) * 1000) / 10
    : null;

  const topConcepts = (Array.isArray(concepts) ? concepts : [])
    .slice(0, 5)
    .map((c) => get(c, ["name", "concept", "title"], String(c)))
    .filter(Boolean);

  const topCandidates = (Array.isArray(candidates) ? candidates : [])
    .slice(0, 8)
    .map((s) => ({
      code: get(s, ["code", "symbol"], ""),
      name: get(s, ["name"], ""),
      role: get(s, ["role"], ""),
      score: get(s, ["score", "totalScore"], null),
      concept: get(s, ["mainConcept", "concept", "sector", "theme"], ""),
    }));
  const archivedAt = [
    get(payload, ["archiveMeta.archivedAt"], null),
    get(payload, ["archiveMeta.fetchedAt"], null),
    get(payload, ["fetchedAt"], null),
  ].find((value) => value !== null && value !== undefined && String(value).trim() !== "") || null;

  return {
    date,
    cycle: get(ms, ["cycle"], "未知"),
    subPhase: get(ms, ["subPhase", "sub_phase"], ""),
    position: get(ms, ["position"], ""),
    ztToday: zt,
    dtToday: numOrNull(get(limit, ["dtToday", "dt_today", "dt"], null)),
    zbRatePct: zbRate,          // 炸板率%
    topConcepts,                 // 当日最强题材 top5
    topCandidates,               // 候选池 top8(含角色/得分)
    archivedAt,
    decisionReceiptStatus: get(payload, ["decisionReceipt.status"], "missing"),
    decisionReceiptId: get(payload, ["decisionReceipt.receiptId"], null),
    decisionResultStatus: get(payload, ["decisionReceipt.decision.result.status"], "unavailable"),
    decisionResultCount: numOrNull(get(payload, ["decisionReceipt.decision.result.selectedCount"], null)),
  };
}

// ============ 数据组装:把 payload 里各供应商的原料喂给 news-digest(唯一消息面大脑) ============
// 供应商:fetchExternalSnapshot(外围指数,含SOX费半)/ fetchGlobalNews(7×24快讯)/
//        同花顺涨停池透传(limitStats.pool)/ evidence.announcements(巨潮公告)
function assembleNewsInputs(payload, summary) {
  const indexes = (((payload || {}).market || {}).externalRisk || {}).indexes || [];
  const byCode = (code) => {
    const hit = indexes.find((i) => String(i.code || "").toUpperCase() === code);
    const v = hit ? Number(hit.changePct) : NaN;
    return Number.isFinite(v) ? v : undefined;
  };
  // 预案票优先(公告排雷针对明天要动手的票);无预案则用入选票
  const plans = readJson(path.join(DATA_DIR, "preplans.json"), []);
  const planCodes = new Set(plans.filter((p) => p.planDate >= summary.date).map((p) => p.code));
  const cands = (payload && payload.candidates) || [];
  const annSources = cands.filter(
    (c) => (planCodes.size ? planCodes.has(c.code) : c.selected) && c.evidence && (c.evidence.announcements || []).length,
  );
  const announcements = annSources.flatMap((c) =>
    c.evidence.announcements.slice(0, 2).map((a) => ({ code: c.code, name: c.name, title: a.title })),
  );
  return {
    overseas: { nasdaqPct: byCode("NDX"), soxPct: byCode("SOX"), spPct: byCode("SPX"), dowPct: byCode("DJIA") },
    cycleInfo: { cycle: summary.cycle, subPhase: summary.subPhase },
    newsItems: ((payload || {}).news && payload.news.global) || [],
    ztPool: (((payload || {}).market || {}).limitStats || {}).pool || [],
    announcements,
  };
}

// ============ 纯逻辑:生成 markdown 复盘报告(可测) ============
function buildReport(summary, prevSummary, newsSection) {
  const s = summary;
  const lines = [];
  lines.push(`# ${s.date} 盘后复盘(系统自动归档)`);
  lines.push("");
  lines.push(`## 市场状态`);
  lines.push(`- 情绪周期:**${s.cycle}**${s.subPhase ? ` / ${s.subPhase}` : ""}${s.position ? `(建议仓位:${s.position})` : ""}`);
  lines.push(`- 涨停 ${s.ztToday ?? "?"} 家,跌停 ${s.dtToday ?? "?"} 家,炸板率 ${s.zbRatePct ?? "?"}%`);
  lines.push(`- 决策凭证:${s.decisionReceiptStatus || "missing"};正式结果:${s.decisionResultCount ?? "不可核验"}只${s.decisionReceiptId ? `(${s.decisionReceiptId})` : ""}`);
  if (prevSummary) {
    const dz = (s.ztToday ?? 0) - (prevSummary.ztToday ?? 0);
    lines.push(`- 环比昨日:涨停 ${dz >= 0 ? "+" : ""}${dz} 家(昨日周期:${prevSummary.cycle}${prevSummary.subPhase ? "/" + prevSummary.subPhase : ""})`);
    if (prevSummary.cycle !== s.cycle) {
      lines.push(`- ⚠️ **周期切换:${prevSummary.cycle} → ${s.cycle}**,按说明书调整总仓位与出手频率`);
    }
  }
  if (newsSection && newsSection.markdown) {
    lines.push("");
    lines.push(newsSection.markdown);
  }
  lines.push("");
  lines.push(`## 主线题材(当日最强)`);
  lines.push(s.topConcepts.length ? s.topConcepts.map((c, i) => `${i + 1}. ${c}`).join("\n") : "(无数据)");
  lines.push("");
  lines.push(`## 候选池 Top`);
  if (s.topCandidates.length) {
    lines.push(`| 代码 | 名称 | 角色 | 题材 | 得分 |`);
    lines.push(`|---|---|---|---|---|`);
    for (const c of s.topCandidates) {
      lines.push(`| ${c.code} | ${c.name} | ${c.role || "—"} | ${c.concept || "—"} | ${c.score ?? "—"} |`);
    }
  } else lines.push("(无数据)");
  lines.push("");
  lines.push(`## 明日待办(人工填)`);
  lines.push(`- [ ] 从候选池圈定核心观察票,写明:单/双逻辑、是否预期回流日、买点预案`);
  lines.push(`- [ ] 检查持仓:同板块是否超2只 / 账户距高点回撤多少`);
  lines.push(`- [ ] 平仓的票记进 /api/journal/add(老实标出口代号)`);
  lines.push("");
  lines.push(`> 本报告由 archiver 自动生成;完整快照见 data/history/${s.date}.json`);
  return lines.join("\n");
}

// ============ IO:抓取 + 归档 ============
function fetchPayload(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/hot-stocks", timeout: 300000 }, (res) => { // 全量抓取管线实测可达2-3分钟
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error("响应不是合法JSON")); }
      });
    });
    req.on("timeout", () => { req.destroy(new Error("请求超时(服务在跑吗?)")); });
    req.on("error", reject);
  });
}

function providerTradingDate(payload) {
  return normalizeTradingDate(
    payload && payload.market && payload.market.limitStats && payload.market.limitStats.dates
      && payload.market.limitStats.dates.today,
  );
}

function shanghaiClock(value) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function prepareDecisionArchivePayload(payload, date, options = {}) {
  const archiveDate = normalizeTradingDate(date || providerTradingDate(payload));
  if (!archiveDate) throw new Error("行情源交易日缺失，无法生成决策凭证");
  const generationContext = payload && payload.generationContext && typeof payload.generationContext === "object"
    ? payload.generationContext : {};
  const capturedAt = generationContext.asOf || payload && (payload.asOf || payload.fetchedAt || payload.updatedAt);
  const capturedClock = shanghaiClock(capturedAt);
  const declaredKind = String(payload && payload.archiveMeta && payload.archiveMeta.snapshotKind || "").toLowerCase();
  const snapshotKind = ["closing", "intraday"].includes(declaredKind)
    ? declaredKind
    : capturedClock && capturedClock.date === archiveDate && capturedClock.minute >= 15 * 60
      ? "closing" : "intraday";
  const decisionReceiptRequired = options.requireCanonicalDecisionReceipt === true
    || (options.requireCanonicalDecisionReceipt !== false && snapshotKind === "closing");
  const previousPayload = options.previousPayload && typeof options.previousPayload === "object"
    ? options.previousPayload : null;
  let previousLiveReceipt = null;
  if (previousPayload && previousPayload.decisionReceipt) {
    const previousInspection = validateDecisionReceipt(previousPayload.decisionReceipt, {
      sourcePayload: previousPayload,
      snapshotKind: previousPayload.archiveMeta && previousPayload.archiveMeta.snapshotKind,
    });
    if (previousInspection.liveCanonical) {
      previousLiveReceipt = previousPayload.decisionReceipt;
    }
  }
  const base = {
    ...payload,
    archiveMeta: {
      ...(payload && payload.archiveMeta || {}),
      mode: options.mode || "cli",
      trigger: options.trigger || "archiver-cli",
      tradingDate: archiveDate,
      snapshotKind,
      asOf: generationContext.asOf || capturedAt || null,
      generationId: generationContext.generationId || payload && payload.generationId || null,
      generationContext,
      archivedAt: options.archivedAt || new Date().toISOString(),
      decisionReceiptRequired,
    },
  };
  const provisionalReceipt = buildDecisionReceipt(base, { snapshotKind });
  const lineage = previousLiveReceipt && previousLiveReceipt.receiptId !== provisionalReceipt.receiptId
    ? {
      supersedesReceiptId: previousLiveReceipt.receiptId,
      supersedeReason: String(options.supersedeReason || "CLI同交易日更晚收盘代次替换"),
    }
    : null;
  const decisionReceipt = lineage
    ? buildDecisionReceipt(base, { snapshotKind, lineage })
    : provisionalReceipt;
  const inspection = validateDecisionReceipt(decisionReceipt, { sourcePayload: base, snapshotKind });
  if (decisionReceiptRequired && !inspection.liveCanonical) {
    throw new Error(`正式收盘决策凭证不可用:${inspection.reasons.join(",") || decisionReceipt.integrity.blockers.join(",")}`);
  }
  return { ...base, decisionReceipt };
}

function sameJsonContent(bytes, payload) {
  try {
    return isDeepStrictEqual(JSON.parse(bytes.toString("utf8")), payload);
  } catch (_) {
    return false;
  }
}

function preservePreviousRevision(snapFile, date, revisionDir) {
  const originalBytes = fs.readFileSync(snapFile);
  const sha256 = crypto.createHash("sha256").update(originalBytes).digest("hex");
  const revisionFile = path.join(revisionDir, date, `${sha256}.json`);
  if (fs.existsSync(revisionFile)) {
    const savedBytes = fs.readFileSync(revisionFile);
    if (!savedBytes.equals(originalBytes)) {
      throw new Error(`历史修订SHA-256冲突，拒绝覆盖: ${revisionFile}`);
    }
    return revisionFile;
  }
  atomicWriteBuffer(revisionFile, originalBytes);
  return revisionFile;
}

function archive(payload, date = providerTradingDate(payload), dirs = { hist: HIST_DIR, report: REPORT_DIR }, newsSection = null) {
  const providerDate = providerTradingDate(payload);
  const archiveDate = normalizeTradingDate(date);
  if (!archiveDate) throw new Error("行情源交易日缺失或显式归档日期无效，拒绝按系统日期归档");
  if (providerDate && providerDate !== archiveDate) {
    throw new Error(`行情源交易日(${providerDate})与显式归档日期(${archiveDate})不一致，拒绝归档`);
  }
  const receiptRequired = payload && payload.archiveMeta
    && payload.archiveMeta.decisionReceiptRequired === true;
  if (payload && payload.decisionReceipt && typeof payload.decisionReceipt === "object") {
    const receiptInspection = validateDecisionReceipt(payload.decisionReceipt, {
      sourcePayload: payload,
      snapshotKind: payload.archiveMeta && payload.archiveMeta.snapshotKind,
    });
    if (!receiptInspection.wellFormed) {
      throw new Error(`决策凭证完整性失败，拒绝归档:${receiptInspection.reasons.join(",")}`);
    }
    if (receiptRequired && !receiptInspection.liveCanonical) {
      throw new Error(`收盘决策凭证非live_canonical，拒绝正式归档:${receiptInspection.reasons.join(",") || receiptInspection.status}`);
    }
    const receiptDate = normalizeTradingDate(payload.decisionReceipt.generation && payload.decisionReceipt.generation.tradingDate);
    if (receiptInspection.liveCanonical && receiptDate !== archiveDate) {
      throw new Error(`决策凭证交易日(${receiptDate || "缺失"})与归档日(${archiveDate})不一致，拒绝归档`);
    }
  } else if (receiptRequired) {
    throw new Error("正式收盘归档缺少决策凭证，拒绝归档");
  }
  const resolvedDirs = {
    hist: dirs && dirs.hist || HIST_DIR,
    report: dirs && dirs.report || REPORT_DIR,
    revision: dirs && (dirs.revision || dirs.revisionDir || dirs.revisions) || REVISION_DIR,
  };
  // 1) 完整快照原样归档
  const snapFile = path.join(resolvedDirs.hist, `${archiveDate}.json`);
  if (receiptRequired && fs.existsSync(snapFile)) {
    const previousPayload = readJson(snapFile, null);
    const previousReceipt = previousPayload && previousPayload.decisionReceipt;
    const nextReceipt = payload && payload.decisionReceipt;
    const previousReceiptInspection = previousReceipt ? validateDecisionReceipt(previousReceipt, {
      sourcePayload: previousPayload,
      snapshotKind: previousPayload.archiveMeta && previousPayload.archiveMeta.snapshotKind,
    }) : { liveCanonical: false };
    if (previousReceiptInspection.liveCanonical
      && nextReceipt && previousReceipt.receiptId !== nextReceipt.receiptId) {
      const lineage = nextReceipt.lineage && typeof nextReceipt.lineage === "object"
        ? nextReceipt.lineage : {};
      if (lineage.supersedesReceiptId !== previousReceipt.receiptId
        || !String(lineage.supersedeReason || "").trim()) {
        throw new Error("同日正式决策凭证发生变化但缺少正确supersedes谱系，拒绝静默覆盖");
      }
    }
  }
  const nextBytes = serializeJson(payload);
  let revisionFile = null;
  let snapshotChanged = true;
  if (fs.existsSync(snapFile)) {
    const previousBytes = fs.readFileSync(snapFile);
    if (sameJsonContent(previousBytes, payload)) {
      snapshotChanged = false;
    } else {
      // The old snapshot is copied byte-for-byte before the live file changes.
      revisionFile = preservePreviousRevision(snapFile, archiveDate, resolvedDirs.revision);
    }
  }
  if (snapshotChanged) atomicWriteBuffer(snapFile, nextBytes);
  // 2) 摘要追加进索引(同日重跑则覆盖当日行)
  const idxFile = path.join(resolvedDirs.hist, "index.json");
  const index = loadArchiveIndex(resolvedDirs.hist);
  const summary = extractSummary(payload, archiveDate);
  const pos = index.findIndex((r) => r.date === archiveDate);
  const prevSummary = index.filter((r) => r.date < archiveDate).sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
  if (pos >= 0) index[pos] = summary; else index.push(summary);
  index.sort((a, b) => (a.date < b.date ? -1 : 1));
  writeJson(idxFile, index);
  // 3) 复盘报告
  const reportFile = path.join(resolvedDirs.report, `${archiveDate}.md`);
  fs.mkdirSync(resolvedDirs.report, { recursive: true });
  fs.writeFileSync(reportFile, buildReport(summary, prevSummary, newsSection), "utf8");
  return { snapFile, idxFile, reportFile, revisionFile, snapshotChanged, summary };
}

// ============ CLI ============
async function main() {
  const args = process.argv.slice(2);
  const portIdx = args.indexOf("--port");
  const fileIdx = args.indexOf("--file");
  const port = portIdx >= 0 ? Number(args[portIdx + 1]) : Number(process.env.PORT) || 5173; // 与 server.js 默认端口一致

  let payload;
  if (fileIdx >= 0) {
    payload = readJson(args[fileIdx + 1], null);
    if (!payload) { console.error("读取 --file 失败"); process.exit(1); }
  } else {
    try {
      payload = await fetchPayload(port);
    } catch (e) {
      console.error(`抓取 http://127.0.0.1:${port}/api/hot-stocks 失败:${e.message}`);
      console.error(`提示:确认服务已启动,或用 node server.js --dump-data > dump.json && node archiver.js --file dump.json`);
      process.exit(1);
    }
  }
  const date = providerTradingDate(payload);
  if (!date) {
    console.error("行情源交易日缺失，已取消归档，避免生成休市日或错档快照");
    process.exit(1);
  }
  const existingFile = path.join(HIST_DIR, `${date}.json`);
  const previousPayload = readJson(existingFile, null);
  const currentClock = shanghaiClock(new Date().toISOString());
  if (previousPayload && previousPayload.archiveMeta && previousPayload.archiveMeta.snapshotKind === "closing"
    && currentClock && currentClock.date > date) {
    console.log(`⏭ ${date} 已有冻结收盘档，CLI不会在后续日期重写历史凭证`);
    return;
  }
  const archivePayload = prepareDecisionArchivePayload(payload, date, { previousPayload });
  if (previousPayload && previousPayload.archiveMeta && previousPayload.archiveMeta.snapshotKind === "closing"
    && archivePayload.archiveMeta.snapshotKind !== "closing") {
    console.log(`⏭ ${date} 已有收盘档，盘中载荷不能覆盖`);
    return;
  }
  // 消息面速览:原料从 payload 组装,大脑在 news-digest(全仓库唯一消息面数据流)
  const newsSection = buildNewsSection(assembleNewsInputs(archivePayload, extractSummary(archivePayload, date)));
  const out = archive(archivePayload, date, undefined, newsSection);
  console.log(`✅ 已归档 ${out.summary.date}(消息面:外围${newsSection.tone}${newsSection.hint ? "/含组合提示" : ""})`);
  console.log(`   快照: ${out.snapFile}`);
  console.log(`   索引: ${out.idxFile}(现有 ${readJson(out.idxFile, []).length} 天)`);
  console.log(`   报告: ${out.reportFile}`);
  console.log(`   摘要: 周期=${out.summary.cycle}${out.summary.subPhase ? "/" + out.summary.subPhase : ""} 涨停=${out.summary.ztToday} 炸板率=${out.summary.zbRatePct}%`);
}

if (require.main === module) main();

module.exports = {
  extractSummary,
  buildReport,
  archive,
  todayYmd,
  assembleNewsInputs,
  loadArchiveIndex,
  rebuildArchiveIndex,
  prepareDecisionArchivePayload,
};

/* ── 可选:接 node-cron 进 server.js 自动跑(不想手动的话)──
 * npm i node-cron 后,在 server.js 的 main() 里加:
 *   const cron = require("node-cron");
 *   const { archive } = require("./archiver");
 *   cron.schedule("35 15 * * 1-5", async () => {          // 交易日 15:35
 *     try { archive(await hotStocksPayload()); console.log("盘后归档完成"); }
 *     catch (e) { console.error("盘后归档失败:", e.message); }
 *   });
 * 直接调 hotStocksPayload() 复用进程内数据,连 HTTP 都不用走。
 */
