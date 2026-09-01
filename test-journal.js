"use strict";
/**
 * test-journal.js —— 交易日志 + 纪律偏离度测试
 * 覆盖:三种 adherence 值 / deviated 缺 note 拒录 / 无预案自动改标 no_plan /
 *      老数据(无 planAdherence 字段)统计归入 unknown 不崩 / 三组分组统计数值
 * 全部使用假数据(代码000000系,测试铁律:禁用真实股票编数据)。
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { addTrade, loadTrades, computeStats, ADHERENCE } = require("./journal");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "journal-test-"));
const FILE = path.join(tmp, "trades.json");
const PREPLANS = path.join(tmp, "preplans.json");
const opt = { preplanFile: PREPLANS };

// 预案 fixture:000001T 在 2026-01-05 有预案;其余票无预案
fs.writeFileSync(
  PREPLANS,
  JSON.stringify([{ planDate: "2026-01-05", code: "000000", name: "测试票A", dualLogic: true, logicA: "a", logicB: "b" }]),
  "utf8",
);

console.log("=== journal 纪律偏离度测试 ===");

// 1. planAdherence 必填:缺失/非法值拒录
let r = addTrade(FILE, { code: "000000", buyDate: "2026-01-05", buyPrice: 10, sellPrice: 11, exitGate: "4" }, opt);
assert(!r.ok && /planAdherence/.test(r.error), "缺 planAdherence 应拒录");
r = addTrade(FILE, { code: "000000", buyDate: "2026-01-05", buyPrice: 10, sellPrice: 11, exitGate: "4", planAdherence: "乱填" }, opt);
assert(!r.ok, "非法 adherence 值应拒录");
console.log("✓ planAdherence 必填三选一,缺失/非法拒录");

// 2. deviated 缺 deviationNote 拒录;补上后成功
r = addTrade(FILE, { code: "000000", buyDate: "2026-01-05", buyPrice: 10, sellPrice: 9.5, exitGate: "5", planAdherence: "deviated" }, opt);
assert(!r.ok && /deviationNote/.test(r.error), "deviated 缺 note 应拒录");
r = addTrade(FILE, { code: "000000", name: "测试票A", buyDate: "2026-01-05", buyPrice: 10, sellPrice: 9.5, exitGate: "5", planAdherence: "deviated", deviationNote: "预案要求竞价符合才买,实际低开也追了,怕踏空" }, opt);
assert(r.ok && r.trade.planAdherence === "deviated" && r.trade.deviationNote.includes("怕踏空"), "deviated+note 应成功");
assert(r.trade.preplanRef && r.trade.preplanRef.planDate === "2026-01-05" && r.trade.preplanRef.dualLogic === true, "有预案应带快照关联");
console.log("✓ deviated 缺 note 拒录;补 note 成功并快照关联预案");

// 3. followed:有预案正常记;snake_case 入参兼容
r = addTrade(FILE, { code: "000000", name: "测试票A", buyDate: "2026-01-05", buyPrice: 10, sellPrice: 10.8, exitGate: "4", plan_adherence: "followed" }, opt);
assert(r.ok && r.trade.planAdherence === "followed" && !r.notice, "有预案标 followed 应原样保留");
console.log("✓ followed 有预案原样记录;snake_case 入参兼容");

// 4. 无预案却标 followed → 自动改标 no_plan,记录不被阻止,给提示
r = addTrade(FILE, { code: "000001T", name: "测试票B", buyDate: "2026-01-06", buyPrice: 20, sellPrice: 21, exitGate: "4", planAdherence: "followed" }, opt);
assert(r.ok, "无预案也必须能记账(系统外操作正是要抓的数据)");
assert(r.trade.planAdherence === "no_plan", "无预案应自动改标 no_plan");
assert(r.notice && r.notice.includes("无预案"), "自动改标必须给提示");
assert(r.trade.preplanRef === null, "无预案不应有快照");
console.log("✓ 无预案自动改标 no_plan,不阻止记录,提示明示");

// 5. no_plan 直接记
r = addTrade(FILE, { code: "000002T", name: "测试票C", buyDate: "2026-01-06", buyPrice: 30, sellPrice: 28.5, exitGate: "1", planAdherence: "no_plan" }, opt);
assert(r.ok && r.trade.planAdherence === "no_plan" && !r.notice, "no_plan 直接记录无提示");
console.log("✓ no_plan 正常记录");

// 6. 老数据兼容:手工塞一条无 planAdherence 字段的存量记录 → 统计归 unknown 不崩
const trades = loadTrades(FILE);
trades.push({ id: 99, code: "000003T", name: "存量老记录", buyPrice: 10, sellPrice: 10.5, pnlPct: 5, exitGate: "④强回流止盈" });
fs.writeFileSync(FILE, JSON.stringify(trades), "utf8");
const stats = computeStats(loadTrades(FILE));
assert(stats.count === 5, `应统计5笔,实际${stats.count}`);
const groups = Object.fromEntries(stats.byAdherence.map((g) => [g.group, g]));
assert(groups.unknown && groups.unknown.count === 1, "老记录应归入 unknown 组且不崩");
console.log("✓ 存量老数据归入 unknown 组,统计不报错");

// 7. 三组分组统计数值核对
assert(groups.followed.count === 1 && groups.followed.totalPnlPct === 8 && groups.followed.winRatePct === 100, "followed 组:1笔 +8%");
assert(groups.deviated.count === 1 && groups.deviated.totalPnlPct === -5, "deviated 组:1笔 -5%");
assert(groups.no_plan.count === 2, "no_plan 组:2笔(直接标的+自动改标的)");
assert(Math.abs(groups.no_plan.totalPnlPct - 0) < 0.01, `no_plan 合计应为 +5-5=0,实际${groups.no_plan.totalPnlPct}`);
assert(stats.adherenceHint && stats.adherenceHint.includes("纪律"), "必须带解读提示");
assert(stats.byExit.length >= 2, "原7出口归因不受影响");
console.log("✓ 三组统计数值正确:", stats.byAdherence.map((g) => `${g.label}${g.count}笔·合计${g.totalPnlPct >= 0 ? "+" : ""}${g.totalPnlPct}%`).join(" | "));

fs.rmSync(tmp, { recursive: true, force: true });
console.log("\n全部测试通过 ✅");
