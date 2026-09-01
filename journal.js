"use strict";
/**
 * journal.js —— 交易日志 + 出口归因统计(验证闭环)
 * 记录每笔已平仓交易,按「卖出出口」分组统计:哪条线在赚钱、哪条在亏钱。
 * 这是系统"验证自己"的一环:14:50回流线/保本线/高点回撤准不准,由这里的数据回答。
 *
 * 存储:JSON 文件(与 server.js 的 readJsonFile/writeJsonFile 习惯一致)。
 * 挂载:createJournalHandler 返回 (request, response, pathname) => bool,
 *       在 handleApi 里 404 之前调用即可(见 INTEGRATION.md)。
 */

const fs = require("fs");
const path = require("path");

const EXITS = {
  "1": "①开盘不及预期",
  "2": "②回流没来止损(14:00-14:50)",
  "3": "③破五日线",
  "4": "④强回流止盈",
  "5": "⑤硬止损(-7%/-12%)",
  "6": "⑥高点回撤/保本线(盘中动态)",
  "7": "⑦加速见顶止盈",
};

function loadTrades(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function saveTrades(file, trades) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(trades, null, 2), "utf8");
}

// ===== 纪律偏离度:对比"按预案执行/偏离预案/系统外交易"三组盈亏,用数据验证纪律价值 =====
const ADHERENCE = {
  followed: "按预案执行",
  deviated: "偏离预案",
  no_plan: "系统外交易",
  unknown: "未标注(存量)",
};

/** 用 买入日期+代码 查当日预案(只读 preplan 的数据文件,不动其逻辑) */
function findPreplan(preplanFile, code, buyDate) {
  try {
    const plans = JSON.parse(fs.readFileSync(preplanFile, "utf8"));
    if (!Array.isArray(plans)) return null;
    return plans.find((p) => String(p.code) === String(code) && String(p.planDate) === String(buyDate)) || null;
  } catch (e) {
    return null;
  }
}

/** 追加一笔已平仓交易;buyPrice/sellPrice 必填,自动算盈亏% */
function addTrade(file, rec, options = {}) {
  const trades = loadTrades(file);
  const buy = Number(rec.buyPrice);
  const sell = Number(rec.sellPrice);
  if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy <= 0) {
    return { ok: false, error: "buyPrice/sellPrice 必须为有效数字" };
  }

  // 纪律偏离度:必填三选一(兼容 snake_case 入参,存储统一 camelCase)
  let adherence = String(rec.planAdherence || rec.plan_adherence || "");
  const deviationNote = String(rec.deviationNote || rec.deviation_note || "");
  if (!["followed", "deviated", "no_plan"].includes(adherence)) {
    return { ok: false, error: "planAdherence 必填三选一:followed(按预案)/deviated(偏离)/no_plan(系统外)" };
  }
  if (adherence === "deviated" && !deviationNote.trim()) {
    return { ok: false, error: "偏离预案必须写 deviationNote(预案要求什么/实际做了什么/为什么偏离)——不写清楚,同样的偏离会重复" };
  }

  // 自动校验:买入日期+代码查预案。查不到却标 followed/deviated → 自动改标 no_plan。
  // 不阻止记录本身——系统外操作也必须记账,这正是要抓的数据。
  const runtimeRoot = path.resolve(process.env.A_SHARE_RUNTIME_DIR || __dirname);
  const preplanFile = options.preplanFile || path.join(runtimeRoot, "data", "preplans.json");
  const matchedPlan = findPreplan(preplanFile, rec.code, rec.buyDate);
  let adherenceNotice = null;
  if (!matchedPlan && adherence !== "no_plan") {
    adherenceNotice = `该票 ${rec.buyDate || "当日"} 无预案记录,已自动改标为「系统外交易」(原填:${ADHERENCE[adherence]})`;
    adherence = "no_plan";
  }

  const trade = {
    id: trades.length + 1,
    code: String(rec.code || ""),
    name: String(rec.name || ""),
    sector: String(rec.sector || ""),
    dualLogic: !!rec.dualLogic,
    entryReason: String(rec.entryReason || ""),
    buyDate: String(rec.buyDate || ""),
    buyPrice: buy,
    positionPct: Number(rec.positionPct) || null,
    layers: Number(rec.layers) || 1,
    sellDate: String(rec.sellDate || ""),
    sellPrice: sell,
    exitGate: EXITS[String(rec.exitGate)] || String(rec.exitGate || "未标注"),
    pnlPct: Math.round(((sell - buy) / buy) * 10000) / 100,
    note: String(rec.note || ""),
    planAdherence: adherence,
    deviationNote: adherence === "deviated" ? deviationNote.trim() : "",
    // 查到预案时快照关联(预案无id,按 planDate+code 定位;存快照便于事后对照,预案09:15后已锁不会漂移)
    preplanRef: matchedPlan
      ? { planDate: matchedPlan.planDate, code: matchedPlan.code, dualLogic: !!matchedPlan.dualLogic }
      : null,
    createdAt: new Date().toISOString(),
  };
  trades.push(trade);
  saveTrades(file, trades);
  return { ok: true, trade, ...(adherenceNotice ? { notice: adherenceNotice } : {}) };
}

/** 核心统计:胜率/盈亏比/期望/最大回撤/各出口归因(纯函数,可测) */
function computeStats(trades) {
  const done = (trades || []).filter((t) => Number.isFinite(t.pnlPct));
  const n = done.length;
  if (!n) return { count: 0 };

  const wins = done.filter((t) => t.pnlPct > 0).map((t) => t.pnlPct);
  const losses = done.filter((t) => t.pnlPct < 0).map((t) => t.pnlPct);
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const avgWin = wins.length ? sum(wins) / wins.length : 0;
  const avgLoss = losses.length ? sum(losses) / losses.length : 0; // 负数

  // 最大回撤:按成交顺序累计盈亏%曲线的峰谷差
  let equity = 0, peak = 0, maxDD = 0;
  for (const t of done) {
    equity += t.pnlPct;
    if (equity > peak) peak = equity;
    if (equity - peak < maxDD) maxDD = equity - peak;
  }

  // 出口归因
  const byExit = {};
  for (const t of done) {
    const g = t.exitGate || "未标注";
    if (!byExit[g]) byExit[g] = { count: 0, totalPnl: 0 };
    byExit[g].count += 1;
    byExit[g].totalPnl += t.pnlPct;
  }
  const exitRows = Object.entries(byExit)
    .map(([gate, v]) => ({
      gate,
      count: v.count,
      avgPnlPct: Math.round((v.totalPnl / v.count) * 100) / 100,
      totalPnlPct: Math.round(v.totalPnl * 100) / 100,
    }))
    .sort((a, b) => a.totalPnlPct - b.totalPnlPct); // 最亏的排最上,先看病灶

  // 纪律偏离度分组:按预案/偏离/系统外 三组盈亏对比(老记录无字段 → unknown,不报错)
  const byAdh = {};
  for (const t of done) {
    const g = ["followed", "deviated", "no_plan"].includes(t.planAdherence) ? t.planAdherence : "unknown";
    if (!byAdh[g]) byAdh[g] = [];
    byAdh[g].push(t.pnlPct);
  }
  const adherenceRows = ["followed", "deviated", "no_plan", "unknown"]
    .filter((g) => byAdh[g] && byAdh[g].length)
    .map((g) => {
      const arr = byAdh[g];
      const w = arr.filter((x) => x > 0);
      const l = arr.filter((x) => x < 0);
      const aw = w.length ? sum(w) / w.length : 0;
      const al = l.length ? sum(l) / l.length : 0;
      return {
        group: g,
        label: ADHERENCE[g],
        count: arr.length,
        winRatePct: Math.round((w.length / arr.length) * 1000) / 10,
        avgPnlPct: Math.round((sum(arr) / arr.length) * 100) / 100,
        totalPnlPct: Math.round(sum(arr) * 100) / 100,
        plRatio: al !== 0 ? Math.round((aw / Math.abs(al)) * 100) / 100 : null,
      };
    });

  return {
    count: n,
    winRatePct: Math.round((wins.length / n) * 1000) / 10,
    avgWinPct: Math.round(avgWin * 100) / 100,
    avgLossPct: Math.round(avgLoss * 100) / 100,
    plRatio: avgLoss !== 0 ? Math.round((avgWin / Math.abs(avgLoss)) * 100) / 100 : null,
    expectancyPct: Math.round((sum(done.map((t) => t.pnlPct)) / n) * 100) / 100,
    cumulativePnlPct: Math.round(equity * 100) / 100,
    maxDrawdownPct: Math.round(maxDD * 100) / 100,
    byExit: exitRows,
    hint: "看点:笔数多但合计为负的出口=那条线要调参;平均盈亏高的出口=有效卖法,多用。",
    byAdherence: adherenceRows,
    adherenceHint: "纪律价值由这三行回答:若「按预案」组期望明显高于「偏离/系统外」,纪律就是钱;若相反,该修的是预案质量,不是执行。",
  };
}

/** 读取 POST body(JSON) */
function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (c) => {
      raw += c;
      if (raw.length > 1e6) { reject(new Error("body too large")); request.destroy(); }
    });
    request.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(new Error("invalid JSON body")); }
    });
    request.on("error", reject);
  });
}

/**
 * 挂载器:返回 async handler(request, response, pathname) → 是否已处理
 * 路由:
 *   POST /api/journal/add    body=交易记录(exitGate 传 1-7 代号)
 *   GET  /api/journal/trades 全部记录
 *   GET  /api/journal/stats  统计
 */
function createJournalHandler(options = {}) {
  const runtimeRoot = path.resolve(process.env.A_SHARE_RUNTIME_DIR || __dirname);
  const file = options.file || path.join(runtimeRoot, "data", "trade-journal.json");
  const preplanFile = options.preplanFile || path.join(runtimeRoot, "data", "preplans.json");
  const send = options.sendJson || ((res, status, payload) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
  });

  return async function journalHandler(request, response, pathname) {
    if (!pathname.startsWith("/api/journal")) return false;

    if (pathname === "/api/journal/add" && request.method === "POST") {
      try {
        const body = await readBody(request);
        const result = addTrade(file, body, { preplanFile });
        send(response, result.ok ? 200 : 400, result);
      } catch (e) {
        send(response, 400, { ok: false, error: e.message });
      }
      return true;
    }
    if (pathname === "/api/journal/trades") {
      send(response, 200, { trades: loadTrades(file) });
      return true;
    }
    if (pathname === "/api/journal/stats") {
      send(response, 200, computeStats(loadTrades(file)));
      return true;
    }
    send(response, 404, { error: "journal route not found" });
    return true;
  };
}

module.exports = { EXITS, ADHERENCE, addTrade, loadTrades, computeStats, createJournalHandler, findPreplan };
