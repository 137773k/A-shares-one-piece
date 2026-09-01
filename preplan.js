"use strict";
/**
 * preplan.js —— 盘前计划录入 + 竞价预期判定(sell-engine 的"弹药库")
 *
 * 解决的问题:sell-engine 的 dualLogic / isExpectedReflowDay / auction 三个输入
 * 要求「盘前写死」,但系统里没有承载这个动作的地方。本模块就是那个地方。
 *
 * 核心机制:
 *   1. 每晚复盘后录入 2-5 只核心票预案(票/逻辑/回流日/竞价预期/买点/仓位)
 *   2. 竞价预期按你的模型自动生成三段区间(高开≥3%符合、<0%不及、>7%超预期);
 *      按承接档位平移判定线:承接好=资金抢筹,正常预期本就更高 → 线上移+1%;
 *      承接差=没人接,平开低开是正常发挥 → 线下移-1%;昨日弱一档的票基准整体下移
 *   3. ⚠️ 计划在当天 09:15 后【锁定】,任何修改被拒——
 *      「双逻辑资格是盘前挣的,不许盘中补」从口头纪律变成代码机制
 *   4. 盘中喂实际开盘涨幅 → 自动判定 超/符合/不及预期 → 直接给出对应闸门动作,
 *      输出可原样作为 sell-engine 的 ctx.auction
 *
 * 路由(与 journal 同风格挂进 handleApi):
 *   POST /api/preplan/add      录一条计划(盘前)
 *   GET  /api/preplan/today    今日全部计划(盘中随时查)
 *   POST /api/preplan/judge    喂实际开盘涨幅,返回判定+动作
 *   GET  /api/preplan/review   历史计划回看(与 archiver/journal 对账用)
 */

const fs = require("fs");
const path = require("path");

// ============ 竞价预期模型(你的原话参数化,统计后可调) ============
const AUCTION_CFG = {
  // 昨日强状态(带动性涨停+辨识度核心):标准三段
  strong: { meetPct: 3, beyondPct: 7 },   // ≥3%符合;>7%超预期;<0%不及
  // 昨日弱一档(跟风上板/非带动性):阈值整体下移
  normal: { meetPct: 1.5, beyondPct: 5 },
  failBelowPct: 0,      // 平开/低开(<0%)直接判不及预期
  // 承接档位 → 涨跌幅判定线整体平移(±1%):
  // 承接好=资金抢筹,正常预期本就该高开更多 → 判定线上移;
  // 承接差=没人接,平开低开才是正常发挥 → 判定线下移
  chengjieShift: { strong: +1, normal: 0, weak: -1 },
  lockTime: "09:15",    // 当天此时点后计划锁定
  grayZoneNote: "0%~符合线之间=勉强/偏弱,按不及预期处理但可人工复核",
};

function t2m(hhmm) { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; }
function todayYmd(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function nowHm(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ============ 纯逻辑 ============
/** 生成竞价预期三段区间 */
function buildAuctionExpectation(input, cfg = AUCTION_CFG) {
  const base = input.yesterdayStrength === "strong" ? cfg.strong : cfg.normal;
  const cj = ["strong", "normal", "weak"].includes(input.chengjie) ? input.chengjie : "normal";
  const shift = cfg.chengjieShift[cj];
  // 承接差的票:平开是正常发挥,不及预期线也随之下移(低开1%以上才算不及)
  const failLine = cfg.failBelowPct + (cj === "weak" ? shift : 0);
  return {
    yesterdayStrength: input.yesterdayStrength === "strong" ? "strong" : "normal",
    chengjie: cj,
    meetPct: Math.round((base.meetPct + shift) * 10) / 10,     // ≥此值=符合
    beyondPct: Math.round((base.beyondPct + shift) * 10) / 10, // >此值=超预期
    failBelowPct: failLine,                                     // <此值=不及
    note: `承接${cj === "strong" ? "强(判定线上移:身价更高)" : cj === "weak" ? "弱(判定线下移:平开算正常)" : "常规"};高开≥${base.meetPct + shift}%符合;>${base.beyondPct + shift}%超预期;<${failLine}%不及预期`,
  };
}

/** 盘中判定:实际开盘涨幅 → 超/符合/不及预期 + 对应闸门动作 */
function judgeAuction(plan, actualOpenPct, cfg = AUCTION_CFG) {
  const e = plan.auctionExpectation;
  const pct = Number(actualOpenPct);
  if (!e || !Number.isFinite(pct)) return { verdict: null, error: "缺预期或开盘涨幅无效" };

  let verdict, action;
  if (pct > e.beyondPct) {
    verdict = "超预期";
    action = plan.addOnPlan
      ? `不卖;观察弱转强三条件(开盘5分钟超预期✓已占一条),满足则按预案加仓:${plan.addOnPlan}`
      : "不卖;可观察是否触发弱转强加仓";
  } else if (pct >= e.meetPct) {
    verdict = "符合预期";
    action = "持有,交给盘中闸门(保本线/高点回撤/回流窗口/五日线)";
  } else if (pct < e.failBelowPct) {
    verdict = "不及预期";
    action = plan.dualLogic
      ? "双逻辑:砍博弈仓1/2;底仓按回流逻辑管(预期回流日则14:00-14:50判定)"
      : "单逻辑:一次清仓,不等五日线";
  } else {
    verdict = "不及预期(灰区)";
    action = (plan.dualLogic ? "按双逻辑砍博弈仓" : "按单逻辑清仓") + `;${cfg.grayZoneNote}`;
  }
  return { verdict, actualOpenPct: pct, action, expectation: e.note };
}

/** 锁定检查:计划日当天 09:15 后不可改 */
function isLocked(plan, now = new Date(), cfg = AUCTION_CFG) {
  const today = todayYmd(now);
  if (plan.planDate < today) return true;                       // 历史计划永久锁定
  if (plan.planDate > today) return false;                      // 未来计划(今晚录明天的)可改
  return t2m(nowHm(now)) >= t2m(cfg.lockTime);                  // 当天:09:15后锁
}

/** 校验并规范化一条计划 */
function normalizePlan(rec) {
  const errors = [];
  if (!rec.code) errors.push("缺 code");
  if (!rec.planDate) errors.push("缺 planDate(计划针对哪个交易日,YYYY-MM-DD)");
  if (rec.dualLogic && !(rec.logicA && rec.logicB)) {
    errors.push("双逻辑票必须写清 logicA(预期逻辑)和 logicB(板块回流逻辑)——资格盘前挣");
  }
  if (!rec.dualLogic && !rec.logicA) errors.push("缺 logicA(买入逻辑一句话)");
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    plan: {
      planDate: String(rec.planDate),
      code: String(rec.code),
      name: String(rec.name || ""),
      sector: String(rec.sector || ""),
      role: String(rec.role || ""),                    // 龙头/容量/情绪
      dualLogic: !!rec.dualLogic,
      logicA: String(rec.logicA || ""),                // 预期逻辑(竞价验证)
      logicB: String(rec.logicB || ""),                // 板块回流逻辑(14:00-14:50验证)
      isExpectedReflowDay: !!rec.isExpectedReflowDay,
      auctionExpectation: buildAuctionExpectation({
        yesterdayStrength: rec.yesterdayStrength,      // "strong" | "normal"
        chengjie: rec.chengjie,                        // 承接:"strong"(抢筹,线上移)|"normal"|"weak"(没人接,线下移)
      }),
      buyPlan: String(rec.buyPlan || ""),              // 买点预案
      firstPositionPct: Number(rec.firstPositionPct) || null, // 首仓比例
      addOnPlan: String(rec.addOnPlan || ""),          // 加仓触发条件
      board: rec.board === "20cm" ? "20cm" : "主板",
      hardStopPct: rec.board === "20cm" ? -12 : -7,    // 自动带出红线
      createdAt: new Date().toISOString(),
      locked: false,
    },
  };
}

// ============ 存储 ============
function loadPlans(file) {
  try { const d = JSON.parse(fs.readFileSync(file, "utf8")); return Array.isArray(d) ? d : []; }
  catch (e) { return []; }
}
function savePlans(file, plans) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(plans, null, 2), "utf8");
}

function addPlan(file, rec, now = new Date()) {
  const r = normalizePlan(rec);
  if (!r.ok) return { ok: false, errors: r.errors };
  // 锁定机制:针对已到锁定时点的交易日,拒绝新增/覆盖
  if (isLocked({ planDate: r.plan.planDate }, now)) {
    return { ok: false, errors: [`${r.plan.planDate} 已过 ${AUCTION_CFG.lockTime} 锁定,盘中不许补计划——双逻辑资格是盘前挣的`] };
  }
  const plans = loadPlans(file);
  // 同日同票覆盖(锁定前允许改预案)
  const i = plans.findIndex((p) => p.planDate === r.plan.planDate && p.code === r.plan.code);
  if (i >= 0) plans[i] = r.plan; else plans.push(r.plan);
  savePlans(file, plans);
  const dayCount = plans.filter((p) => p.planDate === r.plan.planDate).length;
  const warn = dayCount > 5 ? `⚠️ 当日预案已 ${dayCount} 只(常态2-3,行情特别好4-5)——超了,想想是不是在乱枪打鸟` : null;
  return { ok: true, plan: r.plan, dayCount, warn };
}

function todayPlans(file, date = todayYmd()) {
  return loadPlans(file).filter((p) => p.planDate === date);
}

// ============ HTTP 挂载器(与 journal 同风格) ============
function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (c) => { raw += c; if (raw.length > 1e6) { reject(new Error("body too large")); request.destroy(); } });
    request.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(new Error("invalid JSON body")); } });
    request.on("error", reject);
  });
}

function createPreplanHandler(options = {}) {
  const runtimeRoot = path.resolve(process.env.A_SHARE_RUNTIME_DIR || __dirname);
  const file = options.file || path.join(runtimeRoot, "data", "preplans.json");
  const send = options.sendJson || ((res, status, payload) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
  });
  const authorizePlanCode = typeof options.authorizePlanCode === "function"
    ? options.authorizePlanCode
    : null;

  return async function preplanHandler(request, response, pathname) {
    if (!pathname.startsWith("/api/preplan")) return false;

    if (pathname === "/api/preplan/add" && request.method === "POST") {
      try {
        const body = await readBody(request);
        const code = String(body && body.code || "").trim();
        let authorized = false;
        try {
          authorized = !!authorizePlanCode && await authorizePlanCode(code, body) === true;
        } catch {
          authorized = false;
        }
        if (!authorized) {
          send(response, 403, { ok: false, error: "该股票未进入当前最终可执行计划，禁止录入盘前预案" });
          return true;
        }
        send(response, 200, addPlan(file, body));
      }
      catch (e) { send(response, 400, { ok: false, error: e.message }); }
      return true;
    }
    if (pathname === "/api/preplan/today") {
      const plans = todayPlans(file);
      send(response, 200, { date: todayYmd(), count: plans.length, plans });
      return true;
    }
    if (pathname === "/api/preplan/judge" && request.method === "POST") {
      try {
        const body = await readBody(request); // {code, actualOpenPct, date?}
        const date = body.date || todayYmd();
        const plan = loadPlans(file).find((p) => p.planDate === date && p.code === String(body.code));
        if (!plan) { send(response, 404, { ok: false, error: `无 ${date} ${body.code} 的盘前计划——没预案的票按系统外操作,不该买` }); return true; }
        send(response, 200, { ok: true, plan: { code: plan.code, name: plan.name, dualLogic: plan.dualLogic, isExpectedReflowDay: plan.isExpectedReflowDay }, ...judgeAuction(plan, body.actualOpenPct) });
      } catch (e) { send(response, 400, { ok: false, error: e.message }); }
      return true;
    }
    if (pathname === "/api/preplan/review") {
      send(response, 200, { plans: loadPlans(file) });
      return true;
    }
    send(response, 404, { error: "preplan route not found" });
    return true;
  };
}

module.exports = {
  AUCTION_CFG, buildAuctionExpectation, judgeAuction, isLocked, normalizePlan,
  addPlan, todayPlans, loadPlans, createPreplanHandler, todayYmd,
};
