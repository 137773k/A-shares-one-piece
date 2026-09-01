"use strict";
const assert = require("assert");
const {
  SELL_POSITION_STATE,
  evaluateSellSignals,
  addOnSignal,
  accountCircuitBreaker,
  sectorConcentrationCheck,
  assessSellPosition,
  buildSellReferenceLevels,
  buildSellAdvisorTimeline,
  buildSimpleSellPlan,
  buildCycleAwareSellPlan,
} = require("./sell-engine");
const { addTrade, loadTrades, computeStats } = require("./journal");
const fs = require("fs");
const os = require("os");
const path = require("path");

function first(actions) { return actions[0]; }
const basePos = { costPrice: 100, board: "主板", dualLogic: false, gambleSold: false, isExpectedReflowDay: false, isHighFlyer: false };
const baseCtx = { time: "10:30", price: 102, dayHigh: 103, auction: "符合预期", aboveVwap: true, vwapBrokenMinutes: 0, ma5: 98, reflowConfirmed: null };

console.log("=== sell-engine 测试 ===");

// 1. 硬止损最高优先(主板-7)
let a = evaluateSellSignals({ ...basePos }, { ...baseCtx, price: 92.9, dayHigh: 100 });
assert(first(a).gate.includes("硬止损") && first(a).action === "一次清仓");
console.log("✓ 硬止损:主板-7.1%触发,一次清");

// 20cm 到 -10 不触发(线是-12)
a = evaluateSellSignals({ ...basePos, board: "20cm" }, { ...baseCtx, price: 90, dayHigh: 100, aboveVwap: true });
assert(!first(a).gate.includes("硬止损"));
console.log("✓ 硬止损:20cm在-10%不误触(-12线)");

// 2. 单逻辑开盘不及预期 → 一次清
a = evaluateSellSignals({ ...basePos }, { ...baseCtx, time: "09:35", auction: "不及预期", price: 99, dayHigh: 100 });
assert(first(a).gate.includes("不及预期") && first(a).action === "一次清仓");
console.log("✓ A闸:单逻辑竞价证伪一次清");

// 3. 双逻辑开盘不及预期 → 只砍博弈仓
a = evaluateSellSignals({ ...basePos, dualLogic: true }, { ...baseCtx, time: "09:35", auction: "不及预期", price: 99, dayHigh: 100 });
assert(first(a).action === "卖出博弈仓" && first(a).portion === "1/2");
console.log("✓ A闸:双逻辑只砍一半,底仓留给B逻辑");

// 4. 09:45 之后竞价闸不再触发(过了判定窗口)
a = evaluateSellSignals({ ...basePos }, { ...baseCtx, time: "10:00", auction: "不及预期", price: 99, dayHigh: 100 });
assert(!first(a).gate.includes("不及预期"));
console.log("✓ A闸:09:45后不再用竞价判定");

// 5. B闸:预期内回流日,14:46 回流未确认 → 止损底仓
a = evaluateSellSignals({ ...basePos, dualLogic: true, isExpectedReflowDay: true },
  { ...baseCtx, time: "14:46", reflowConfirmed: false, price: 99, dayHigh: 100 });
assert(first(a).gate.includes("回流没来"));
console.log("✓ B闸:14:45后仍无回流→止损,不拖尾盘");

// 6. B闸:14:20 回流未确认 → 还在窗口内,不砍(等到14:45)
a = evaluateSellSignals({ ...basePos, dualLogic: true, isExpectedReflowDay: true },
  { ...baseCtx, time: "14:20", reflowConfirmed: false, price: 99, dayHigh: 100 });
assert(!first(a).gate.includes("回流没来"));
console.log("✓ B闸:窗口中段不提前砍,给回流时间");

// 7. 非预期回流日:窗口内回流没来也不触发快线
a = evaluateSellSignals({ ...basePos, dualLogic: true, isExpectedReflowDay: false },
  { ...baseCtx, time: "14:46", reflowConfirmed: false, price: 99, dayHigh: 100 });
assert(!first(a).gate.includes("回流没来"));
console.log("✓ B闸:非预期回流日不用快线误杀慢逻辑");

// 8. 保本线:冲高+5%后回落到成本 → 触发
a = evaluateSellSignals({ ...basePos }, { ...baseCtx, price: 100.3, dayHigh: 105 });
assert(first(a).gate.includes("保本"));
console.log("✓ 保本线:曾+5%回落至成本→不许赚变亏");

// 9. 保本线:只冲高+2%(未达+3%武装线)回落 → 不触发
a = evaluateSellSignals({ ...basePos }, { ...baseCtx, price: 100.3, dayHigh: 102, aboveVwap: true });
assert(!first(a).gate.includes("保本"));
console.log("✓ 保本线:浮盈<3%不武装,防被日内波动扫出");

// 10. 高点回撤:回撤5%+破分时均价6分钟 → 减
a = evaluateSellSignals({ ...basePos, peakGainArmed: false, costPrice: 90 },
  { ...baseCtx, price: 104.5, dayHigh: 110, aboveVwap: false, vwapBrokenMinutes: 6 });
assert(first(a).gate.includes("高点回撤"));
console.log("✓ 高点回撤:回撤5%+破均价确认=真掉头,减");

// 11. 高点回撤:回撤5%但仍在均价上 → 判洗盘不动
a = evaluateSellSignals({ ...basePos, costPrice: 90 },
  { ...baseCtx, price: 104.5, dayHigh: 110, aboveVwap: true, vwapBrokenMinutes: 0 });
assert(first(a).action === "不动");
console.log("✓ 高点回撤:在均价上方=洗盘,不被洗下车");

// 12. 高位妖股阈值放宽:回撤4.5%不触发(线5.5)
a = evaluateSellSignals({ ...basePos, isHighFlyer: true, costPrice: 90 },
  { ...baseCtx, price: 105.05, dayHigh: 110, aboveVwap: false, vwapBrokenMinutes: 9 });
assert(!first(a).gate.includes("高点回撤"));
console.log("✓ 妖股阈值:4.5%回撤不触发(5.5线),给波动空间");

// 13. 五日线兜底:14:56 现价<MA5 → 清
a = evaluateSellSignals({ ...basePos, costPrice: 90 }, { ...baseCtx, time: "14:56", price: 97, ma5: 98, dayHigh: 99, aboveVwap: true });
assert(a.some((x) => x.gate.includes("五日线")));
console.log("✓ 五日线:14:55后现价<MA5收盘清");

// 14. 加仓份额单独止损
a = evaluateSellSignals({ ...basePos, costPrice: 90, addOnPrice: 105 },
  { ...baseCtx, price: 100, dayHigh: 106, aboveVwap: true });
assert(a.some((x) => x.gate.includes("加仓份额")));
console.log("✓ 加仓份额:-4.8%单独砍,不牵连底仓(底仓仍+11%)");

console.log("\n=== 网页卖出顾问：弱仓与卖出比例 ===");
const supportiveMarket = {
  cycle: "混沌",
  subPhase: "健康分化·兑现",
  dailyState: { key: "healthy_divergence", label: "健康分化·兑现", retreatCandidate: false },
  profitEffect: { score: 53 },
  lossEffect: { score: 31, trend: "improving" },
};
const panicMarket = {
  cycle: "退潮",
  dailyState: { key: "retreat_candidate", label: "负反馈扩散", retreatCandidate: true },
  profitEffect: { score: 22 },
  lossEffect: { score: 78, trend: "worsening" },
};
const strongCoreSnapshot = {
  code: "000001",
  price: 108,
  changePct: 3,
  volumeRatio: 1.2,
  klineProfile: { ma5: 102, ma10: 99, structureBreak: false, longBearBreak3d: false },
  leadership: {
    coreIdentityQualified: true,
    tradeQualified: true,
    initiative: { score: 86, relativeStrength: 3.2, retentionPct: 72 },
    structure: { frameworkIntact: true, breakdown: false, grade: "B" },
  },
};

let diagnosis = assessSellPosition({
  snapshot: {
    ...strongCoreSnapshot,
    flowNature: { key: "realization", label: "资金兑现", confidence: 0.88, conflict: false },
  },
  marketState: supportiveMarket,
  concept: { sameMain: true, relation: "同主线" },
  role: "中军",
  positionPct: 30,
});
assert.strictEqual(diagnosis.state, SELL_POSITION_STATE.NORMAL_REALIZATION);
assert.strictEqual(diagnosis.weakConfirmed, false);
const realizationDiagnosis = diagnosis;
console.log("✓ 净流出被三层承接解释为正常兑现，不机械卖出");

diagnosis = assessSellPosition({
  snapshot: {
    code: "000002",
    price: 19,
    changePct: -3.5,
    volumeRatio: 1.5,
    flowNature: { key: "uncertain", label: "资金性质待确认", confidence: 0.3 },
    klineProfile: { ma5: 19.8, ma10: 18.6, structureBreak: false },
    leadership: {
      coreIdentityQualified: false,
      initiative: { score: 42, relativeStrength: -3.1, retentionPct: 31 },
      structure: { frameworkIntact: true, breakdown: false, grade: "B" },
    },
  },
  marketState: supportiveMarket,
  concept: { sameMain: true, relation: "同主线" },
  role: "后排观察",
  positionPct: 30,
});
assert.strictEqual(diagnosis.state, SELL_POSITION_STATE.WEAK_CONFIRMED);
assert.strictEqual(diagnosis.weakSellPct, 67);
assert.strictEqual(diagnosis.portfolioPctToSell, 20.1);
assert.strictEqual(diagnosis.portfolioPctLeft, 9.9);
const confirmedWeakDiagnosis = diagnosis;
console.log("✓ 强板块中后排多项掉队=确认弱仓；30%仓卖67%=减20.1个百分点");

diagnosis = assessSellPosition({
  snapshot: {
    ...strongCoreSnapshot,
    flowNature: { key: "uncertain", label: "资金性质待确认", confidence: 0.3 },
  },
  marketState: panicMarket,
  concept: { sameMain: true, relation: "同主线" },
  role: "龙头",
});
assert.strictEqual(diagnosis.state, SELL_POSITION_STATE.HOLD_STRONG);
assert.strictEqual(diagnosis.weakConfirmed, false);
console.log("✓ 市场弱不能单独把主动核心判成弱仓");

diagnosis = assessSellPosition({
  snapshot: {
    ...strongCoreSnapshot,
    flowNature: { key: "escape", label: "资金出逃", confidence: 0.83, conflict: false },
  },
  marketState: panicMarket,
  concept: { sectorChangePct: -3.2, relation: "非主线" },
  role: "中军",
  positionPct: 25,
});
assert.strictEqual(diagnosis.state, SELL_POSITION_STATE.ESCAPE);
assert.strictEqual(diagnosis.weakSellPct, 100);
const escapeDiagnosis = diagnosis;
console.log("✓ 多维资金出逃为终态，清仓100%");

diagnosis = assessSellPosition({
  snapshot: {
    code: "000003",
    price: 12,
    changePct: 0.5,
    flowNature: { key: "uncertain", confidence: 0.3 },
    leadership: { initiative: { relativeStrength: 0.2 } },
  },
  marketState: supportiveMarket,
  concept: { sameMain: true, relation: "同主线" },
  role: "后排",
});
assert.strictEqual(diagnosis.state, SELL_POSITION_STATE.WEAK_PENDING);
assert.strictEqual(diagnosis.weakConfirmed, false);
console.log("✓ K线/分时数据不足只标待确认，不输出‘弱仓已触发’");

const levels = buildSellReferenceLevels({ snapshot: strongCoreSnapshot, currentPrice: 108, verifiedCore: true });
assert.strictEqual(levels.find((item) => item.key === "zero").value, 108);
assert.strictEqual(levels.find((item) => item.key === "ma5").value, 102);
const timeline = buildSellAdvisorTimeline({ assessment: diagnosis, snapshot: strongCoreSnapshot, currentPrice: 108, positionPct: 30 });
assert(timeline.timeline.some((step) => /三项中至少两项/.test(step.trigger)));
assert(timeline.timeline.some((step) => /10:50/.test(step.title)));
console.log("✓ 页面预案明确零轴/MA5与9:25、9:35、10:50触发门槛");

console.log("\n=== 网页卖出顾问：简明执行主线 ===");
const realizationPlan = buildSimpleSellPlan({ assessment: realizationDiagnosis, positionPct: 30 });
assert.strictEqual(realizationPlan.current.key, "NORMAL_REALIZATION");
assert(/不因资金流出/.test(realizationPlan.current.action));
console.log("✓ 正常兑现不被误写成卖点");

const expectedWeakDiagnosis = assessSellPosition({
  snapshot: {
    code: "000004",
    price: 20.2,
    changePct: 0.6,
    volumeRatio: 0.9,
    flowNature: { key: "uncertain", confidence: 0.3 },
    klineProfile: { ma5: 19.5, ma10: 18.8, structureBreak: false },
    leadership: {
      coreIdentityQualified: false,
      initiative: { score: 61, relativeStrength: -2.6, retentionPct: 62 },
      structure: { frameworkIntact: true, breakdown: false, grade: "B" },
    },
  },
  marketState: supportiveMarket,
  concept: { sameMain: true, relation: "同主线" },
  role: "中军",
  positionPct: 30,
});
const expectedWeakPlan = buildSimpleSellPlan({ assessment: expectedWeakDiagnosis, positionPct: 30 });
assert.strictEqual(expectedWeakPlan.current.key, "EXPECTED_WEAK");
assert(/第一次反抽仍不跟/.test(expectedWeakPlan.current.action));
assert(/卖当前持仓的1\/2|先减15个百分点/.test(expectedWeakPlan.steps.find((step) => step.key === "first_sell").action));
console.log("✓ 核心走强而本票被动，只标预期弱；第一次反抽仍不跟才卖1/2");

const confirmedWeakPlan = buildSimpleSellPlan({ assessment: confirmedWeakDiagnosis, positionPct: 30 });
assert.strictEqual(confirmedWeakPlan.current.key, "CONFIRMED_WEAK");
assert(/全部剩余持仓/.test(confirmedWeakPlan.current.action));
console.log("✓ 确认转弱后卖完剩余持仓");

const escapePlan = buildSimpleSellPlan({ assessment: escapeDiagnosis, positionPct: 25 });
assert.strictEqual(escapePlan.current.key, "CLEAR");
assert(/全部剩余持仓/.test(escapePlan.current.action));
assert(/单纯低开、净流出、市场下跌都不能单独触发/.test(escapePlan.hardLine));
console.log("✓ 结构破位/资金出逃进入清仓线，单项噪声不触发");

console.log("\n=== 网页卖出顾问：周期驱动五层卖法 ===");
const toreLonPlan = buildCycleAwareSellPlan({
  assessment: realizationDiagnosis,
  market: {
    cycle: "混沌",
    dailyState: {
      key: "retreat_candidate",
      label: "大分歧·退潮候选",
      retreatCandidate: true,
      reasons: ["指数偏弱", "亏钱效应仍高"],
    },
    profitEffect: { score: 37.8 },
    lossEffect: { score: 74.5 },
  },
  holding: {
    code: "301583", name: "托伦斯", role: "龙头", mainConcept: "存储芯片",
    changePct: 20, amountYi: 22, popularity: "4天3板",
    leadership: { initiative: { score: 92, proactive: true } },
  },
  direction: {
    name: "存储芯片",
    peers: [
      { code: "301583", name: "托伦斯", role: "龙头", changePct: 20, amountYi: 22, popularity: "4天3板", leadership: { initiative: { score: 92, proactive: true } } },
      { code: "002156", name: "通富微电", role: "容量", changePct: 9.77, amountYi: 198.2, leadership: { initiative: { score: 100, proactive: true } } },
      { code: "000021", name: "深科技", role: "容量", changePct: 7.42, amountYi: 85.9, leadership: { initiative: { score: 70, proactive: true } } },
      { code: "002185", name: "华天科技", role: "容量", changePct: 5.09, amountYi: 96.4, leadership: { initiative: { score: 80, proactive: true } } },
      { code: "000815", name: "美利云", role: "历史核心", changePct: -8.74, amountYi: 18, leadership: { identity: "历史核心", coreIdentityQualified: true, initiative: { priceDiscovery: { historicalImpact: true } } } },
      { code: "001309", name: "德明利", role: "历史龙头", changePct: -8.07, amountYi: 103.6, concepts: ["存储芯片"], leadership: { identity: "情绪锚点", impactScore: 25, history: { appearances: 3 } } },
    ],
  },
});
assert(/混沌/.test(toreLonPlan.currentState.market.label));
assert.strictEqual(toreLonPlan.currentState.direction.label, "局部强回流 · 内部大分化");
assert.strictEqual(toreLonPlan.currentState.holding.label, "逆势回流情绪锚点");
assert(/先兑现/.test(toreLonPlan.primaryExpectation.label));
assert.deepStrictEqual(toreLonPlan.anchors.capacity.map((item) => item.name), ["通富微电", "深科技", "华天科技"]);
assert.deepStrictEqual(toreLonPlan.anchors.negative.map((item) => item.name), ["美利云", "德明利"]);
assert(/1\/2/.test(toreLonPlan.scenarios.find((item) => item.key === "realization").action));
assert(/2\/3/.test(toreLonPlan.scenarios.find((item) => item.key === "isolated").action));
assert(/通富微电/.test(toreLonPlan.scenarios.find((item) => item.key === "strengthen").condition));
assert(/美利云/.test(toreLonPlan.scenarios.find((item) => item.key === "strengthen").condition));
console.log("✓ 托伦斯先定混沌弱市与存储分化，再用明确锚点生成兑现/加强分支");

const hardExitCyclePlan = buildCycleAwareSellPlan({
  assessment: escapeDiagnosis,
  market: panicMarket,
  holding: { code: "301583", name: "托伦斯", role: "龙头", changePct: 20, popularity: "4天3板" },
  direction: { name: "存储芯片", peers: [] },
});
assert.strictEqual(hardExitCyclePlan.primaryExpectation.tone, "bad");
assert(/原逻辑失效/.test(hardExitCyclePlan.primaryExpectation.label));
assert(/直接卖完/.test(hardExitCyclePlan.scenarios.find((item) => item.key === "realization").action));
console.log("✓ 结构破坏/资金出逃优先级高于逆势涨停身份，不会被回流预期覆盖");

console.log("\n=== 加仓/账户级 ===");
// 弱转强三条件
assert(addOnSignal({ open5minBeyondExpectation: true, sectorResonance: true, reclaimedPrevHigh: true, currentLayers: 1 }).allow);
assert(!addOnSignal({ open5minBeyondExpectation: true, sectorResonance: false, reclaimedPrevHigh: true }).allow);
assert(!addOnSignal({ open5minBeyondExpectation: true, sectorResonance: true, reclaimedPrevHigh: true, currentLayers: 3 }).allow);
console.log("✓ 弱转强:三条件齐才加,缺一不加,3层封顶");

// 熔断:高点100回撤到84 → 触发
let cb = accountCircuitBreaker({ peak: 100, current: 84 });
assert(cb.triggered && cb.drawdownPct === 16);
cb = accountCircuitBreaker({ peak: 100, current: 90 });
assert(!cb.triggered);
console.log("✓ 熔断:-16%触发强制半仓,-10%不触发");

// 板块集中度:CPO已持2只再买第3只 → 拒
let sc = sectorConcentrationCheck(
  [{ sector: "CPO", weightPct: 20 }, { sector: "CPO", weightPct: 15 }, { sector: "存储", weightPct: 10 }],
  { sector: "CPO", weightPct: 15 });
assert(!sc.allow);
sc = sectorConcentrationCheck([{ sector: "CPO", weightPct: 20 }], { sector: "存储", weightPct: 15 });
assert(sc.allow);
console.log("✓ 板块集中度:同板块第3只拒绝(假分散),跨板块放行");

console.log("\n=== journal 统计 ===");
const TEST = path.join(os.tmpdir(), "test-journal.json");
if (fs.existsSync(TEST)) fs.unlinkSync(TEST);
const demo = [
  // 测试铁律:不用真实股票名编数据,统一测试票
  { code: "001", name: "测试票甲", sector: "存储", buyPrice: 100, sellPrice: 112, exitGate: "4" },
  { code: "002", name: "测试票乙", sector: "CPO", buyPrice: 50, sellPrice: 56, exitGate: "4" },
  { code: "003", name: "测试票丙", sector: "液冷", buyPrice: 30, sellPrice: 33, exitGate: "3" },
  { code: "004", name: "A", sector: "存储", buyPrice: 20, sellPrice: 21.6, exitGate: "4" },
  { code: "005", name: "B", sector: "CPO", buyPrice: 40, sellPrice: 42, exitGate: "6" },
  { code: "006", name: "C", sector: "杂毛", buyPrice: 15, sellPrice: 13.95, exitGate: "1" },
  { code: "007", name: "D", sector: "杂毛", buyPrice: 25, sellPrice: 23.25, exitGate: "2" },
  { code: "008", name: "E", sector: "退潮", buyPrice: 18, sellPrice: 16.74, exitGate: "5" },
  { code: "009", name: "F", sector: "退潮", buyPrice: 22, sellPrice: 20.9, exitGate: "3" },
  { code: "010", name: "G", sector: "退潮", buyPrice: 12, sellPrice: 11.4, exitGate: "2" },
];
// planAdherence 现为必填(纪律偏离度追踪);此段只验出口归因统计,统一标 no_plan
demo.forEach((t) => assert(addTrade(TEST, { ...t, planAdherence: "no_plan" }).ok));
const stats = computeStats(loadTrades(TEST));
assert(stats.count === 10 && stats.winRatePct === 50);
assert(Math.abs(stats.avgWinPct - 9.4) < 0.01 && Math.abs(stats.avgLossPct - (-6.2)) < 0.01);
assert(Math.abs(stats.maxDrawdownPct - (-31)) < 0.01);
console.log(`✓ 统计:胜率${stats.winRatePct}% 盈亏比${stats.plRatio} 期望${stats.expectancyPct}% 最大回撤${stats.maxDrawdownPct}%`);
console.log("✓ 出口归因(最亏在最上):");
stats.byExit.forEach((r) => console.log(`   ${r.gate}  ${r.count}笔  合计${r.totalPnlPct}%`));
fs.unlinkSync(TEST);

console.log("\n全部测试通过 ✅");
