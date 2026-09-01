"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildAuctionExpectation, judgeAuction, isLocked, addPlan, todayPlans, normalizePlan } = require("./preplan");

const TEST = path.join(os.tmpdir(), "test-preplans.json");
if (fs.existsSync(TEST)) fs.unlinkSync(TEST);

console.log("=== preplan 测试 ===");

// 1. 强状态票:标准三段(≥3符合 / >7超 / <0不及)
let e = buildAuctionExpectation({ yesterdayStrength: "strong" });
assert(e.meetPct === 3 && e.beyondPct === 7 && e.failBelowPct === 0);
console.log("✓ 强状态:高开≥3%符合 >7%超预期 平低开不及");

// 2. 弱一档:阈值下移
e = buildAuctionExpectation({ yesterdayStrength: "normal" });
assert(e.meetPct === 1.5 && e.beyondPct === 5);
console.log("✓ 弱一档:阈值下移(≥1.5% / >5%)");

// 3. 承接档位:好→判定线上移(身价更高),差→下移(平开算正常)
e = buildAuctionExpectation({ yesterdayStrength: "strong", chengjie: "strong" });
assert(e.meetPct === 4 && e.beyondPct === 8, "承接强:高开4%才算符合它的身价");
e = buildAuctionExpectation({ yesterdayStrength: "strong", chengjie: "weak" });
assert(e.meetPct === 2 && e.beyondPct === 6 && e.failBelowPct === -1, "承接弱:2%即符合,平开不算不及(低开1%以上才不及)");
e = buildAuctionExpectation({ yesterdayStrength: "strong", chengjie: "乱填" });
assert(e.meetPct === 3, "非法档位按常规处理");
console.log("✓ 承接:强→线上移(4%符合) 弱→线下移(2%符合,平开=正常发挥)");

// 3b. 弱承接判定:平开(0%)不判不及,低开-1.5%才判
const weakPlan = { dualLogic: false, auctionExpectation: buildAuctionExpectation({ yesterdayStrength: "strong", chengjie: "weak" }) };
assert(judgeAuction(weakPlan, 0).verdict === "不及预期(灰区)", "弱承接平开=灰区非硬不及");
assert(judgeAuction(weakPlan, -1.5).verdict === "不及预期");
console.log("✓ 弱承接判定:平开走灰区,低开1%以上才硬判不及");

// 4. 判定:四种情形(含灰区)
const strongPlan = { dualLogic: false, auctionExpectation: buildAuctionExpectation({ yesterdayStrength: "strong" }) };
assert(judgeAuction(strongPlan, 8).verdict === "超预期");
assert(judgeAuction(strongPlan, 4).verdict === "符合预期");
assert(judgeAuction(strongPlan, -1).verdict === "不及预期");
assert(judgeAuction(strongPlan, 1.5).verdict === "不及预期(灰区)"); // 0~3之间=勉强偏弱
console.log("✓ 判定:高开8超/4符合/-1不及/1.5灰区");

// 5. 判定动作与 sell-engine 衔接:双逻辑不及预期→砍博弈仓
const dualPlan = { dualLogic: true, auctionExpectation: buildAuctionExpectation({ yesterdayStrength: "strong" }) };
let j = judgeAuction(dualPlan, -2);
assert(j.action.includes("砍博弈仓"));
j = judgeAuction(strongPlan, -2);
assert(j.action.includes("一次清仓"));
console.log("✓ 衔接:不及预期→单逻辑清仓/双逻辑砍半,与A闸一致");

// 6. 双逻辑必须盘前写清 A/B 两条
let r = normalizePlan({ code: "001309", planDate: "2099-01-01", dualLogic: true, logicA: "博竞价" });
assert(!r.ok && r.errors[0].includes("logicB"));
console.log("✓ 铁律:双逻辑缺B逻辑直接拒——资格盘前挣");

// 7. 锁定:当天09:15后拒绝新增(用固定时间模拟)
const day = "2099-06-01";
const before915 = new Date("2099-06-01T09:00:00");
const after915 = new Date("2099-06-01T09:30:00");
r = addPlan(TEST, { code: "001309", name: "德明利", planDate: day, dualLogic: false, logicA: "博回流", yesterdayStrength: "strong" }, before915);
assert(r.ok);
r = addPlan(TEST, { code: "600601", name: "方正科技", planDate: day, dualLogic: false, logicA: "追板", yesterdayStrength: "strong" }, after915);
assert(!r.ok && r.errors[0].includes("锁定"));
console.log("✓ 锁定:09:00能录,09:30拒绝——盘中不许补计划");

// 8. 锁定前同日同票可覆盖(改预案)
r = addPlan(TEST, { code: "001309", name: "德明利", planDate: day, dualLogic: true, logicA: "博竞价溢价", logicB: "存储板块回流", isExpectedReflowDay: true, yesterdayStrength: "strong" }, before915);
assert(r.ok && r.dayCount === 1, "覆盖不新增");
console.log("✓ 覆盖:锁定前改预案不产生重复条目");

// 9. 超5只提醒(行情特别好4-5只,超了警告乱枪打鸟)
for (let i = 0; i < 5; i++) {
  r = addPlan(TEST, { code: `00000${i}`, name: `票${i}`, planDate: day, dualLogic: false, logicA: "x", yesterdayStrength: "normal" }, before915);
}
assert(r.warn && r.warn.includes("乱枪打鸟"));
console.log("✓ 数量提醒:第6只触发'乱枪打鸟'警告");

// 10. 历史计划永久锁定
assert(isLocked({ planDate: "2020-01-01" }, new Date("2099-06-01T08:00:00")));
console.log("✓ 历史计划永久锁定,不可篡改(保证回看数据真实)");

fs.unlinkSync(TEST);
console.log("\n全部测试通过 ✅");
