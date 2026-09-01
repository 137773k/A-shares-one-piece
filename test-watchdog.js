"use strict";
const assert = require("assert");
const { newWatchState, runWatchCycle, runLegacyWatchCycle, formatAlerts } = require("./watchdog");

console.log("=== watchdog 测试 ===");

const plans = [
  { code: "001309", dualLogic: true, isExpectedReflowDay: true, board: "主板" },
  { code: "600601", dualLogic: false, isExpectedReflowDay: false, board: "主板" },
];

// 1. 正常持有:不产生预警
let st = newWatchState("2026-07-02");
let r = runLegacyWatchCycle(st, {
  time: "10:30",
  positions: [{ code: "600601", name: "方正科技", costPrice: 100 }],
  plans,
  snapshots: { "600601": { price: 102, dayHigh: 102.5, aboveVwap: true, vwapBrokenMinutes: 0, ma5: 98 } },
});
assert(r.alerts.length === 0);
console.log("✓ 正常持有不吵人");

// 2. 保本线触发→red,且第二轮不重复吼
st = newWatchState("2026-07-02");
const bePos = [{ code: "600601", name: "方正科技", costPrice: 100 }];
const beSnap = { "600601": { price: 100.2, dayHigh: 105, aboveVwap: false, vwapBrokenMinutes: 3, ma5: 98 } };
r = runLegacyWatchCycle(st, { time: "11:00", positions: bePos, plans, snapshots: beSnap });
assert(r.alerts.length === 1 && r.alerts[0].level === "red" && r.alerts[0].gate.includes("保本"));
r = runLegacyWatchCycle(st, { time: "11:01", positions: bePos, plans, snapshots: beSnap });
assert(r.alerts.length === 0, "同闸门第二轮应静默");
console.log("✓ 保本线red预警,去重:第二轮静默");

// 3. 硬止损→red
st = newWatchState("2026-07-02");
r = runLegacyWatchCycle(st, {
  time: "13:10",
  positions: [{ code: "600601", name: "方正科技", costPrice: 100 }],
  plans,
  snapshots: { "600601": { price: 92.5, dayHigh: 100, aboveVwap: false, vwapBrokenMinutes: 8, ma5: 98 } },
});
assert(r.alerts.some((a) => a.gate.includes("硬止损") && a.level === "red"));
console.log("✓ 硬止损red");

// 4. 高点回撤→orange
st = newWatchState("2026-07-02");
r = runLegacyWatchCycle(st, {
  time: "10:00",
  positions: [{ code: "600601", name: "方正科技", costPrice: 90 }],
  plans,
  snapshots: { "600601": { price: 104.5, dayHigh: 110, aboveVwap: false, vwapBrokenMinutes: 6, ma5: 95 } },
});
assert(r.alerts.some((a) => a.gate.includes("高点回撤") && a.level === "orange"));
console.log("✓ 高点回撤orange");

// 5. 回流窗口倒计时:14:40提醒info,且仅对"双逻辑+预期回流日+未确认"
st = newWatchState("2026-07-02");
r = runLegacyWatchCycle(st, {
  time: "14:41",
  positions: [
    { code: "001309", name: "德明利", costPrice: 100 },
    { code: "600601", name: "方正科技", costPrice: 100 },
  ],
  plans,
  snapshots: {
    "001309": { price: 101, dayHigh: 103, aboveVwap: true, vwapBrokenMinutes: 0, ma5: 98, reflowConfirmed: false },
    "600601": { price: 101, dayHigh: 103, aboveVwap: true, vwapBrokenMinutes: 0, ma5: 98 } },
});
const cd = r.alerts.filter((a) => a.gate.includes("倒计时"));
assert(cd.length === 1 && cd[0].code === "001309" && cd[0].level === "info");
console.log("✓ 回流倒计时:只提醒双逻辑回流日的票,单逻辑票不打扰");

// 6. 14:46回流仍未确认→B闸red
r = runLegacyWatchCycle(st, {
  time: "14:46",
  positions: [{ code: "001309", name: "德明利", costPrice: 100 }],
  plans,
  snapshots: { "001309": { price: 99.5, dayHigh: 103, aboveVwap: true, vwapBrokenMinutes: 0, ma5: 97, reflowConfirmed: false } },
});
assert(r.alerts.some((a) => a.gate.includes("回流没来") && a.level === "red"));
console.log("✓ B闸:14:46回流没来red吼止损");

// 7. 竞价判定提醒:09:25 info,一天一次
st = newWatchState("2026-07-02");
r = runLegacyWatchCycle(st, { time: "09:26", positions: [], plans, snapshots: {} });
assert(r.alerts.some((a) => a.gate.includes("竞价判定")));
r = runLegacyWatchCycle(st, { time: "09:27", positions: [], plans, snapshots: {} });
assert(!r.alerts.some((a) => a.gate.includes("竞价判定")));
console.log("✓ 竞价提醒09:25一次,不重复");

// 8. 账户熔断→red
st = newWatchState("2026-07-02");
r = runLegacyWatchCycle(st, { time: "10:00", positions: [], plans, snapshots: {}, account: { peak: 100, current: 83 } });
assert(r.alerts.some((a) => a.gate === "账户熔断" && a.level === "red"));
console.log("✓ 账户熔断:-17%触发red");

// 9. 格式化输出
const text = formatAlerts(r.alerts);
assert(text.includes("🚨") && text.includes("账户熔断"));
console.log("✓ 格式化:红色带🚨可直接推送");

// 10. 权威入口缺V7结果时失败关闭，不能回退到上述旧闸门。
st = newWatchState("2026-07-02");
r = runWatchCycle(st, {
  time: "14:55",
  positions: [{ code: "600601", name: "方正科技", costPrice: 100 }],
  snapshots: { "600601": { price: 80, dayHigh: 105, ma5: 98 } },
});
assert(r.authority === "canonical_v7_watchdog_projection_v1");
assert(r.executionAuthority === false);
assert(r.alerts.length === 1 && r.alerts[0].gate === "V7数据未就绪");
assert(!r.alerts.some((a) => a.gate.includes("硬止损")));
console.log("✓ V7权威入口缺证据时关闭，不回退旧模型");

console.log("\n全部测试通过 ✅");
