"use strict";
const assert = require("assert");
const { classifyBoard, hardStopRange, buildRedlineCard } = require("./redline");

console.log("=== redline 测试 ===");

// 1. 板别识别复用 LIMIT_RULES:主板/创业板/科创板/北交/ST
let b = classifyBoard({ code: "000001", name: "平安银行" });
assert(b.limitPct === 0.10 && b.label === "主板(10cm)");
b = classifyBoard({ code: "300750", name: "宁德时代" });
assert(b.limitPct === 0.20 && b.label === "20cm");
b = classifyBoard({ code: "688981", name: "中芯国际" });
assert(b.limitPct === 0.20 && b.label === "20cm");
b = classifyBoard({ code: "832000", name: "某北交票" });
assert(b.limitPct === 0.30 && b.label === "北交(30cm)");
b = classifyBoard({ code: "600000", name: "ST某某" });
assert(b.limitPct === 0.05 && b.label === "ST(5cm)");
console.log("✓ 板别识别:主板10cm/创科20cm/北交30cm/ST5cm");

// 2. 硬止损档位:主板-6~-7;20cm及以上-10~-12;ST贴跌停前-4~-5
assert.deepStrictEqual(hardStopRange(0.10), [-6, -7]);
assert.deepStrictEqual(hardStopRange(0.20), [-10, -12]);
assert.deepStrictEqual(hardStopRange(0.30), [-10, -12]);
assert.deepStrictEqual(hardStopRange(0.05), [-4, -5]);
console.log("✓ 硬止损档位:主板-6~-7% / 20cm-10~-12% / ST-4~-5%");

// 3. 竞价判定线换算成具体价格(强状态标准三段:≥3符合 >7超 <0不及)
let card = buildRedlineCard({
  code: "000001", name: "测试主板", prevClose: 10,
  auctionExpectation: { meetPct: 3, beyondPct: 7, failBelowPct: 0 },
});
assert(card.auction.meetPrice === 10.3, `meetPrice=${card.auction.meetPrice}`);
assert(card.auction.beyondPrice === 10.7);
assert(card.auction.failPrice === 10.0);
assert(card.auction.grayZone[0] === 10.0 && card.auction.grayZone[1] === 10.3);
console.log("✓ 竞价线:昨收10 → 符合≥10.30 / 超预期>10.70 / 不及<10.00 / 灰区10.00~10.30");

// 4. 承接弱(判定线下移,平开走灰区、低开1%以上才不及):failBelowPct=-1
card = buildRedlineCard({
  code: "300001", name: "测试创业", prevClose: 20,
  auctionExpectation: { meetPct: 2, beyondPct: 6, failBelowPct: -1 },
});
assert(card.auction.meetPrice === 20.4);
assert(card.auction.beyondPrice === 21.2);
assert(card.auction.failPrice === 19.8, `failPrice=${card.auction.failPrice}`);
console.log("✓ 承接弱:不及线下移至-1%(昨收20→19.80),平开在灰区");

// 5. 硬止损换算成价格区间,默认以昨收为基准,标"不可谈判"
card = buildRedlineCard({ code: "000001", name: "主板票", prevClose: 10 });
assert.deepStrictEqual(card.hardStop.pctRange, [-6, -7]);
assert(card.hardStop.priceRange[0] === 9.4 && card.hardStop.priceRange[1] === 9.3);
assert(card.hardStop.note.includes("不可谈判"));
card = buildRedlineCard({ code: "688111", name: "20cm票", prevClose: 100 });
assert(card.hardStop.priceRange[0] === 90 && card.hardStop.priceRange[1] === 88);
console.log("✓ 硬止损价:主板10→9.40~9.30;20cm 100→90.00~88.00;标注不可谈判");

// 6. 传入实际买入价则止损/保本按买入价换算
card = buildRedlineCard({ code: "000001", name: "主板票", prevClose: 10, buyPrice: 11 });
assert(card.basis.used === "buyPrice");
assert(card.hardStop.priceRange[0] === 10.34 && card.hardStop.priceRange[1] === 10.23);
assert(card.breakEven.price === 11.33);
console.log("✓ 有买入价:止损/保本改按买入价11换算(保本11.33)");

// 7. 保本武装线:+3%
card = buildRedlineCard({ code: "000001", name: "主板票", prevClose: 10 });
assert(card.breakEven.pct === 3 && card.breakEven.price === 10.3);
console.log("✓ 保本武装线:+3% → 10.30");

// 8. 尾盘线:MA5具体价格;缺MA5时标数据缺失
card = buildRedlineCard({ code: "000001", name: "主板票", prevClose: 10, ma5: 9.87 });
assert(card.closeLine.ma5 === 9.87 && card.closeLine.rule.includes("14:55"));
assert(!card.missing.includes("MA5"));
card = buildRedlineCard({ code: "000001", name: "主板票", prevClose: 10 });
assert(card.closeLine.ma5 === null && card.missing.includes("MA5"));
console.log("✓ 尾盘线:14:55现价<MA5(9.87)收盘清;缺MA5入missing");

// 9. 缺昨收:竞价线/止损价都算不了,missing 标记,不抛异常
card = buildRedlineCard({ code: "000001", name: "主板票", auctionExpectation: { meetPct: 3, beyondPct: 7, failBelowPct: 0 } });
assert(card.auction === null && card.hardStop.priceRange === null && card.missing.includes("昨收"));
console.log("✓ 缺昨收:价格线为null并入missing,不抛异常");

// 10. B闸窗口:双逻辑+预期回流日才有;单逻辑/非回流日没有
card = buildRedlineCard({ code: "000001", name: "x", prevClose: 10, dualLogic: true, isExpectedReflowDay: true });
assert(card.bGate && card.bGate.window === "14:00-14:50" && card.bGate.rule.includes("14:45"));
card = buildRedlineCard({ code: "000001", name: "x", prevClose: 10, dualLogic: true, isExpectedReflowDay: false });
assert(card.bGate === null);
card = buildRedlineCard({ code: "000001", name: "x", prevClose: 10, dualLogic: false, isExpectedReflowDay: true });
assert(card.bGate === null);
console.log("✓ B闸:仅双逻辑+预期回流日标注14:00-14:50窗口");

// 11. 涨跌停价参考(板别换算)+分时回撤规则文字
card = buildRedlineCard({ code: "300001", name: "创业票", prevClose: 10 });
assert(card.board.limitUpPrice === 12 && card.board.limitDownPrice === 8);
assert(card.intradayPullback.includes("3-5%") && card.intradayPullback.includes("5.5-6%") && card.intradayPullback.includes("5分钟"));
console.log("✓ 涨跌停参考价 + 分时回撤规则文字齐全");

// 12. 价格保留两位小数(A股最小变动0.01)
card = buildRedlineCard({ code: "000001", name: "x", prevClose: 33.33, auctionExpectation: { meetPct: 3, beyondPct: 7, failBelowPct: 0 } });
assert(card.auction.meetPrice === 34.33 && card.auction.beyondPrice === 35.66);
console.log("✓ 价格两位小数:33.33×1.03=34.33 / ×1.07=35.66");

console.log("\n全部 redline 测试通过 ✅");
