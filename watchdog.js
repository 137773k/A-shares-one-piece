"use strict";
/**
 * watchdog.js —— 盘中预警(闭环最后一块:让闸门"自己吼你")
 *
 * 问题:sell-engine 是"有人问才答"的纯函数,盘中没人盯着问,闸门=摆设。
 * 10月那种五连阴硬扛,本质就是"规则在、没人执行"。本模块就是那个
 * 每分钟盯一轮、触发就吼你的角色。
 *
 * 设计(纯逻辑,不抓数据不定时):
 *   调用方(server.js 里 setInterval 每60秒)喂入:
 *     - 持仓列表(含成本/仓位状态)
 *     - 今日预案(preplan.todayPlans → dualLogic/isExpectedReflowDay/board)
 *     - 实时快照(price/dayHigh/aboveVwap/vwapBrokenMinutes/ma5/reflowConfirmed)
 *     - 账户净值 {peak, current}
 *   返回:本轮新增预警列表(已去重分级),由调用方推送(console/钉钉/Server酱)
 *
 * ⚠️当前定位(用户拍板):不接盘中轮询、不加 setInterval——自己盯盘;
 *   本模块后续用途是"预案红线生成器"(录预案时把该票的硬止损/保本/回撤/五日线红线算好打印)。
 *
 * 分级:
 *   red    立即动手:硬止损 / A闸不及预期 / B闸回流没来 / 保本线 / 账户熔断
 *   orange 准备动手:高点回撤 / 14:55破五日线
 *   info   提前提醒:14:40回流窗口倒计时 / 09:25竞价判定提醒
 *
 * 去重:同一票同一闸门,当天只吼一次(watchState 由调用方持有,每日清空)
 */

const { evaluateSellSignals, accountCircuitBreaker } = require("./sell-engine");

const WATCH_CFG = {
  reflowRemindTime: "14:40",   // 回流窗口倒计时提醒(距14:50截止还有10分钟)
  auctionRemindTime: "09:25",  // 竞价出来,提醒去 /api/preplan/judge 判定
  redGates: ["⑤硬止损", "①开盘不及预期", "②回流没来止损", "⑥保本线", "账户熔断"],
  orangeGates: ["⑥高点回撤", "③破五日线", "⑤硬止损(加仓份额)"],
  ignoreActions: ["持有", "不动", "转格局仓·持有"], // 非动作型结果不预警
};

function t2m(hhmm) { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; }

function levelOf(gate, cfg = WATCH_CFG) {
  if (cfg.redGates.some((g) => gate.startsWith(g))) return "red";
  if (cfg.orangeGates.some((g) => gate.startsWith(g))) return "orange";
  return "orange"; // 未知闸门宁可吵一点
}

function mkAlert(level, code, name, gate, action, reason, time) {
  return { level, code, name, gate, action, reason, time };
}

/** 新建每日看盘状态(每个交易日开盘前重置一次) */
function newWatchState(date) {
  return { date, alerted: {} }; // alerted["code|gate"] = true
}

/**
 * 跑一轮巡检(纯函数):
 * inputs = {
 *   time: "HH:MM",
 *   positions: [{ code, name, costPrice, addOnPrice?, gambleSold?, isHighFlyer?, peakGainArmed? }],
 *   plans:     preplan.todayPlans() 的结果(按 code 匹配出 dualLogic/isExpectedReflowDay/board)
 *   snapshots: { [code]: { price, dayHigh, aboveVwap, vwapBrokenMinutes, ma5, reflowConfirmed, openPct? } },
 *   account:   { peak, current }   // 账户净值
 * }
 * 返回 { alerts: [...], state }  —— alerts 只含本轮"新"预警
 */
function runLegacyWatchCycle(state, inputs, cfg = WATCH_CFG) {
  const alerts = [];
  const now = t2m(inputs.time);
  const seen = (key) => state.alerted[key];
  const mark = (key) => { state.alerted[key] = true; };

  // ── 账户级熔断(凌驾于个股) ──
  if (inputs.account) {
    const cb = accountCircuitBreaker(inputs.account);
    if (cb.triggered && !seen("ACCOUNT|熔断")) {
      mark("ACCOUNT|熔断");
      alerts.push(mkAlert("red", "ACCOUNT", "账户", "账户熔断",
        cb.action, `账户自高点回撤${cb.drawdownPct}%>15%`, inputs.time));
    }
  }

  // ── 定时提醒(与个股无关) ──
  if (now >= t2m(cfg.auctionRemindTime) && now < t2m(cfg.auctionRemindTime) + 5 && !seen("SYS|竞价提醒")) {
    mark("SYS|竞价提醒");
    alerts.push(mkAlert("info", "SYS", "系统", "竞价判定提醒",
      "对今日每只预案票 POST /api/preplan/judge 录入实际开盘涨幅", "竞价已出,按预案判定超/符合/不及", inputs.time));
  }

  // ── 逐持仓喂 sell-engine ──
  for (const p of inputs.positions || []) {
    const snap = (inputs.snapshots || {})[p.code];
    if (!snap) continue;
    const plan = (inputs.plans || []).find((x) => x.code === p.code) || {};

    // 回流窗口倒计时(仅双逻辑+预期回流日+尚未确认)
    if (plan.dualLogic && plan.isExpectedReflowDay && snap.reflowConfirmed !== true &&
        now >= t2m(cfg.reflowRemindTime) && now < t2m("14:50") && !seen(`${p.code}|回流倒计时`)) {
      mark(`${p.code}|回流倒计时`);
      alerts.push(mkAlert("info", p.code, p.name, "回流窗口倒计时",
        "距14:50截止不足10分钟:板块回流仍未确认,准备执行B闸止损底仓",
        "预期内回流日,回流未至", inputs.time));
    }

    const pos = {
      costPrice: p.costPrice,
      addOnPrice: p.addOnPrice,
      board: plan.board || p.board || "主板",
      dualLogic: !!plan.dualLogic,
      gambleSold: !!p.gambleSold,
      isExpectedReflowDay: !!plan.isExpectedReflowDay,
      isHighFlyer: !!p.isHighFlyer,
      peakGainArmed: !!p.peakGainArmed,
    };
    const ctx = {
      time: inputs.time,
      price: snap.price,
      dayHigh: snap.dayHigh,
      auction: snap.auction || null, // 竞价判定结果可由 preplan.judge 回填
      aboveVwap: !!snap.aboveVwap,
      vwapBrokenMinutes: snap.vwapBrokenMinutes || 0,
      ma5: snap.ma5,
      reflowConfirmed: snap.reflowConfirmed === undefined ? null : snap.reflowConfirmed,
    };

    for (const a of evaluateSellSignals(pos, ctx)) {
      if (cfg.ignoreActions.includes(a.action) || a.gate === "—" || a.gate === "观察") continue;
      const key = `${p.code}|${a.gate}`;
      if (seen(key)) continue;
      mark(key);
      alerts.push(mkAlert(levelOf(a.gate, cfg), p.code, p.name, a.gate, `${a.action}(${a.portion})`, a.reason, inputs.time));
    }
  }

  return { alerts, state };
}

/** V7当前是盘后/回放策略，盘中watchdog明确关闭卖出动作。 */
function runWatchCycle(state, inputs = {}) {
  const alerts = [];
  const seen = (key) => state.alerted[key];
  const mark = (key) => { state.alerted[key] = true; };
  for (const position of inputs.positions || []) {
    const code = String(position.code || "");
    const key = `${code}|V7数据未就绪`;
    if (!seen(key)) {
      mark(key);
      alerts.push(mkAlert(
        "info",
        code,
        position.name || code,
        "V7数据未就绪",
        "盘中不生成卖出动作",
        "V7仅用于盘后完整一分钟回放；旧实时闸门已隔离为显式legacy对照",
        inputs.time || "--:--",
      ));
    }
  }
  return {
    authority: "canonical_v7_watchdog_projection_v1",
    status: "disabled_post_close_replay_only",
    executionAuthority: false,
    alerts,
    state,
  };
}

/** 预警格式化(推送用):红色带🚨,一条一行 */
function formatAlerts(alerts) {
  const icon = { red: "🚨", orange: "⚠️", info: "ℹ️" };
  return alerts.map((a) =>
    `${icon[a.level] || ""}[${a.time}] ${a.name}(${a.code}) 触发【${a.gate}】→ ${a.action}\n   ${a.reason}`
  ).join("\n");
}

/**
 * 推送插槽:默认打印;回家部署后换成钉钉/Server酱只改这里。
 * 钉钉示例(部署时解开):
 *   const https = require("https");
 *   function notify(text) {
 *     const body = JSON.stringify({ msgtype: "text", text: { content: "盘中预警\n" + text } });
 *     const req = https.request("https://oapi.dingtalk.com/robot/send?access_token=你的token",
 *       { method: "POST", headers: { "Content-Type": "application/json" } });
 *     req.write(body); req.end();
 *   }
 */
function createNotifier(fn) {
  return typeof fn === "function" ? fn : (text) => console.log(text);
}

module.exports = {
  WATCH_CFG,
  newWatchState,
  runWatchCycle,
  runLegacyWatchCycle,
  formatAlerts,
  createNotifier,
};

/* ── 部署时接进 server.js(回家再做,先留样板)──
 * const { newWatchState, runWatchCycle, formatAlerts, createNotifier } = require("./watchdog");
 * const { todayPlans } = require("./preplan");
 * let watchState = newWatchState(todayYmd());
 * const notify = createNotifier(); // 换钉钉时传自己的函数
 * setInterval(async () => {
 *   const t = nowHm();
 *   if (t < "09:25" || t > "15:00") return;              // 只在盘中跑
 *   if (watchState.date !== todayYmd()) watchState = newWatchState(todayYmd());
 *   const inputs = {
 *     time: t,
 *     positions: loadPositions(),                        // 你的持仓来源(手动JSON即可)
 *     plans: todayPlans(preplanFile),
 *     snapshots: await fetchRealtimeSnapshots(),         // 复用你现有实时抓取
 *     account: loadAccountEquity(),
 *   };
 *   const { alerts } = runWatchCycle(watchState, inputs);
 *   if (alerts.length) notify(formatAlerts(alerts));
 * }, 60 * 1000);
 */
