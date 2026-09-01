"use strict";

const assert = require("assert");
const { resolveDecisionPrice, repriceAuctionLine, applyBestPickPriceIntegrity } = require("./price-integrity");

console.log("=== price-integrity 测试 ===");

let resolved = resolveDecisionPrice({
  code: "002384",
  price: 260.37,
  prevClose: 236.70,
  changePct: 10,
  klineProfile: { lastClose: 260.37 },
});
assert.strictEqual(resolved.price, 260.37);
assert.strictEqual(resolved.source, "latest-price");
assert.strictEqual(resolved.consistent, true);
console.log("✓ 最新价优先，不再误取昨收");

resolved = resolveDecisionPrice({
  price: 236.70,
  prevClose: 236.70,
  changePct: 10,
  klineProfile: { lastClose: 260.37 },
});
assert.strictEqual(resolved.price, 260.37);
assert.strictEqual(resolved.repaired, true);
console.log("✓ 最新价误等于昨收时，自动用K线末值纠正");

resolved = resolveDecisionPrice({ prevClose: 73.57, changePct: 5.84 });
assert.strictEqual(resolved.price, 77.87);
assert.strictEqual(resolved.source, "derived-from-change");
console.log("✓ 最新价与K线都缺失时，可由昨收和涨跌幅反推");

assert.strictEqual(
  repriceAuctionLine("开盘价 > 74.67 (+1.5%) → 先不追", 77.87),
  "开盘价 > 79.04 (+1.5%) → 先不追",
);
assert.strictEqual(
  repriceAuctionLine("71.36 ~ 74.67 (-3%~+1.5%) → 观察区", 77.87),
  "75.53 ~ 79.04 (-3%~+1.5%) → 观察区",
);
console.log("✓ 竞价单点与区间按最新收盘价重算");

const repaired = applyBestPickPriceIntegrity({
  available: true,
  picks: [{
    code: "002156",
    name: "通富微电",
    price: 73.57,
    buy: { auctionLines: ["开盘价 > 74.67 (+1.5%) → 先不追", "71.36 ~ 74.67 (-3%~+1.5%) → 观察区"] },
    sell: {
      hardStop: { pctRange: [-5.6, -5], priceRange: [69.45, 69.89], note: "当前以73.57为参考" },
      breakEven: { pct: 3, price: 75.78 },
    },
  }],
}, [{
  code: "002156",
  price: 77.87,
  prevClose: 73.57,
  changePct: 5.84,
  klineProfile: { lastClose: 77.87 },
}]);
assert.strictEqual(repaired.picks[0].price, 77.87);
assert.deepStrictEqual(repaired.picks[0].sell.hardStop.priceRange, [73.51, 73.98]);
assert.strictEqual(repaired.picks[0].sell.breakEven.price, 80.21);
assert.strictEqual(repaired.priceIntegrity.status, "pass");
assert.strictEqual(repaired.priceIntegrity.repairedCount, 1);
console.log("✓ 缓存中的买点、止损与保本线会同步纠正");

const blocked = applyBestPickPriceIntegrity({
  available: true,
  picks: [{ code: "000001", name: "异常样本", price: 10, buy: { auctionLines: ["开盘价 > 10.15 (+1.5%)"] }, sell: { hardStop: { pctRange: [-5], priceRange: [9.5] }, breakEven: { pct: 3, price: 10.3 } } }],
}, [{ code: "000001", price: 12, prevClose: 10, changePct: 2, klineProfile: { lastClose: 12 } }]);
assert.strictEqual(blocked.priceIntegrity.status, "warn");
assert.strictEqual(blocked.picks[0].buy.priceBlocked, true);
assert(blocked.picks[0].buy.auctionLines[0].includes("暂停生成买点"));
assert.strictEqual(blocked.picks[0].sell.hardStop.priceRange, null);
console.log("✓ 三源校验不一致时关闭买点，不带病输出价格");

console.log("price-integrity 测试全部通过");
