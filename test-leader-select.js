"use strict";
const assert = require("assert");
const { isLimitUp, boardHeight, leaderPower, pickZhongjun, roleContext, classifyRole, buildTotalLeader, rankTier } = require("./leader-select");

console.log("=== leader-select 测试 ===");

// ① 真涨停:20cm票+12%不算涨停(旧版9.5会误判——你的核心场景)
const cy12 = { code: "300001", name: "某创业板", price: 112, prevClose: 100, changePct: 12 };
assert(!isLimitUp(cy12), "创业板+12%不是涨停");
const cy20 = { code: "300001", name: "某创业板", price: 120, prevClose: 100, changePct: 20 };
assert(isLimitUp(cy20), "创业板+20%封死是涨停");
const zb10 = { code: "600601", name: "方正科技", price: 11.0, prevClose: 10.0, changePct: 10 };
assert(isLimitUp(zb10), "主板+10%是涨停");
// 数据源直给涨停价优先
assert(isLimitUp({ code: "688001", name: "科创", price: 24.0, limitUpPrice: 24.0 }));
assert(!isLimitUp({ code: "688001", name: "科创", price: 23.5, limitUpPrice: 24.0 }));
// ST 5%
assert(isLimitUp({ code: "600000", name: "ST某某", price: 10.5, prevClose: 10.0 }));
console.log("✓ ①真涨停:20cm+12%不误判/主板10%/ST5%/直给涨停价优先");

// ③ 炸板不加分
assert(boardHeight({ popularity: "炸板", changePct: 15, price: 115, prevClose: 100, code: "300009", name: "x" }) === 0, "炸板=0");
assert(boardHeight({ popularity: "地板" }) === 0);
assert(boardHeight({ popularity: "6连板" }) === 6);
assert(boardHeight({ popularity: "首板" }) === 1);
// 同花顺实际标签格式(集成时实测):"X天Y板" 取板数Y
assert(boardHeight({ popularity: "4天3板" }) === 3, "4天3板=3板");
assert(boardHeight({ popularity: "11天7板" }) === 7, "11天7板=7板");
assert(boardHeight({ popularity: "2天1板" }) === 1);
console.log("✓ ③白名单:炸板/地板0分,6连板=6,X天Y板=Y板,旧版'含板就+20'的反向奖励已除");

// ② 涨停先决:排名60的真涨停 必须压过 排名5的没涨停(旧版反过来)
const realZt = { code: "A", name: "a", price: 20, prevClose: 18.18, popularity: "首板", combinedRank: 60, changePct: 10.0 };
const hotNoZt = { code: "B", name: "b", price: 105, prevClose: 100, combinedRank: 5, changePct: 5 };
assert(leaderPower(realZt) > leaderPower(hotNoZt), "真涨停必须压过纯热度");
// 连板高度分层:5板 > 首板(旧版同分)
const b5 = { code: "C", name: "c", price: 20, prevClose: 18.18, popularity: "5连板", combinedRank: 20 };
const b1 = { code: "D", name: "d", price: 20, prevClose: 18.18, popularity: "首板", combinedRank: 8 };
assert(leaderPower(b5) > leaderPower(b1), "5板核心稳压首板跟风(哪怕首板热度更高)");
console.log("✓ ②龙头强度:涨停先决压热度,梯队高度主导");

// ④ 中军:死鱼排除 + NaN修复
const zj = pickZhongjun([
  { code: "E", name: "e", floatMarketValue: 800e8, changePct: -3, amountYi: 20 },  // 死鱼:大市值但-3%没承接
  { code: "F", name: "f", floatMarketValue: 600e8, changePct: 1.2, amountYi: 40 }, // 合格锚
  { code: "G", name: "g", totalMarketValue: 900e8, changePct: 0.5, amountYi: 50 }, // 只有总市值(旧版NaN源)
]);
assert(zj.code === "G", `应选市值最大且不弱的G,实际${zj && zj.code}`);
const zj2 = pickZhongjun([{ code: "E", name: "e", floatMarketValue: 800e8, changePct: -3, amountYi: 20 }]);
assert(zj2 === null, "全是死鱼=该方向无中军");
console.log("✓ ④中军:-3%死鱼不当锚,totalMarketValue兜底不再NaN,可返回'无中军'");

// roleContext + classifyRole 端到端
const rows = [
  { code: "A1", name: "核心5板", concepts: ["CPO"], price: 20, prevClose: 18.18, popularity: "5连板", combinedRank: 15, changePct: 10, turnoverRate: 18 },
  { code: "A2", name: "热度王没板", concepts: ["CPO"], price: 105, prevClose: 100, combinedRank: 1, changePct: 5, turnoverRate: 20 },
  { code: "A3", name: "首板跟风", concepts: ["CPO"], price: 22, prevClose: 20, popularity: "首板", combinedRank: 25, changePct: 10 },
  { code: "A4", name: "容量锚", concepts: ["CPO"], floatMarketValue: 700e8, price: 50, prevClose: 49, combinedRank: 8, changePct: 2, amountYi: 60 },
];
const ctx = roleContext(rows, [{ name: "CPO" }]);
assert(ctx.get("CPO").leaderCode === "A1", "龙头=5板核心,不是热度王");
assert(ctx.get("CPO").zhongjunCode === "A4");
assert(classifyRole(rows[0], "CPO", ctx).role === "龙头");
assert(classifyRole(rows[3], "CPO", ctx).role === "中军");
assert(classifyRole(rows[2], "CPO", ctx).role === "补涨");
assert(classifyRole(rows[1], "CPO", ctx).role === "后排观察", "没涨停的热度王只能后排");
console.log("✓ 端到端:5板核心当龙头/热度王没板只配后排/容量锚中军/首板补涨");

// 方向内全无涨停 → 无龙头(而不是硬凑一个)
const ctx2 = roleContext(
  [{ code: "X", name: "x", concepts: ["杂毛"], price: 103, prevClose: 100, combinedRank: 3, changePct: 3 }],
  [{ name: "杂毛" }]);
assert(ctx2.get("杂毛").leaderCode === null, "无涨停方向不硬凑龙头(说明书:一定要有涨停板)");
console.log("✓ 硬条件:方向内无真涨停=今日无龙头,不硬凑");

// ⑥ 总龙头只在selected池内
// 回归：历史“X天Y板”只能表示近期高度，不能替代今天真实涨停。
// 当天真实涨停仍保留 dailyHeight（当日高度）资格。
const dailyHeight = {
  code: "DH1",
  name: "匿名当日高度",
  concepts: ["ROLE_REGRESSION"],
  popularity: "5天4板",
  price: 11,
  prevClose: 10,
  changePct: 10,
  combinedRank: 80,
};
const dailyHeightContext = roleContext([dailyHeight], [{ name: "ROLE_REGRESSION" }]);
assert.strictEqual(dailyHeightContext.get("ROLE_REGRESSION").leaderCode, "DH1", "当天真涨停仍应保留 dailyHeight 资格");
assert.strictEqual(classifyRole(dailyHeight, "ROLE_REGRESSION", dailyHeightContext).role, "龙头", "当天真涨停可以作为当日高度");

const historicalBoardCases = [
  {
    code: "HIST1",
    name: "匿名断板样本",
    concepts: ["ROLE_REGRESSION"],
    popularity: "10天7板",
    price: 9.7,
    prevClose: 10,
    changePct: -3,
    combinedRank: 1,
  },
  {
    code: "HIST2",
    name: "匿名跌停样本",
    concepts: ["ROLE_REGRESSION"],
    popularity: "14天9板",
    price: 9,
    prevClose: 10,
    changePct: -10,
    combinedRank: 1,
  },
];
const historicalBoardMisclassifications = historicalBoardCases.map((stock) => {
  const context = roleContext([stock], [{ name: "ROLE_REGRESSION" }]);
  const classified = classifyRole(stock, "ROLE_REGRESSION", context);
  return {
    code: stock.code,
    leaderCode: context.get("ROLE_REGRESSION").leaderCode,
    role: classified.role,
    reason: classified.reason,
  };
}).filter((row) => row.leaderCode || row.role === "龙头" || /真涨停/.test(String(row.reason || "")));
assert.deepStrictEqual(
  historicalBoardMisclassifications,
  [],
  "历史几天几板但今天未涨停或跌停，不得再 classifyRole 为真涨停龙头",
);

const cands = [
  { code: "T1", name: "被剔除的共识票", selected: false, role: "龙头", mainConcept: "CPO", score: 90, price: 20, prevClose: 18.18, popularity: "6连板", combinedRank: 2, inBothSources: true },
  { code: "T2", name: "入围核心", selected: true, role: "龙头", mainConcept: "CPO", score: 80, price: 20, prevClose: 18.18, popularity: "4连板", combinedRank: 6, inBothSources: true },
];
const tl = buildTotalLeader(cands, { mainLine: { name: "CPO", leader: { code: "T1" } } }, {});
assert(tl.code === "T2", "共识票被剔除→不认,选入围里最强的");
assert(buildTotalLeader([{ code: "T3", selected: false }], {}, {}) === null, "全剔除=无总龙头(退潮期正常)");
console.log("✓ ⑥总龙头:不给被剔除的票封王,全剔除返回null");

// P1契约：旧缓存仍可能同时带 selected=true 与裸 role="龙头"，但只要明确
// 标注为 session/dailyHeight，就只能代表当日高度，不能成为跨周期总龙头。
const cachedDailyHeight = {
  code: "P1_DAILY_HEIGHT",
  name: "匿名旧缓存当日高度",
  selected: true,
  role: "龙头",
  roleKind: "dailyHeight",
  roleScope: "session",
  dailyRole: "当日高度",
  mainConcept: "ROLE_P1",
  combinedRank: 1,
  score: 999,
  popularity: "4连板",
};
assert.strictEqual(
  buildTotalLeader([cachedDailyHeight], { mainLine: { name: "ROLE_P1", leader: { code: cachedDailyHeight.code } } }, {}),
  null,
  "旧缓存的selected dailyHeight/session不能因裸role=龙头获得总龙头",
);

const verifiedCycleLeader = {
  code: "P1_CYCLE_LEADER",
  name: "匿名周期龙头",
  selected: false,
  role: "龙头",
  roleKind: "cycleLeader",
  roleScope: "cycle",
  mainConcept: "ROLE_P1",
  combinedRank: 50,
  score: 10,
  cycleIdentity: {
    identityEstablished: true,
    activePrimary: true,
    state: "confirmed",
  },
  leadership: {
    coreIdentityQualified: false,
    cycleIdentity: {
      identityEstablished: true,
      activePrimary: true,
      state: "confirmed",
    },
  },
};
assert.strictEqual(
  buildTotalLeader([cachedDailyHeight, verifiedCycleLeader], { mainLine: { name: "ROLE_P1" } }, {}).code,
  verifiedCycleLeader.code,
  "已确认cycleLeader即使当天分数较低，仍应保留总龙头身份",
);
console.log("✓ P1总龙头契约：当日高度不越权，已确认周期龙头仍可用");

// ⑤ 分段化
assert(rankTier(3) === 3 && rankTier(25) === 2 && rankTier(50) === 1 && rankTier(70) === 0 && rankTier(undefined) === 0);
console.log("✓ ⑤排名分段:前10/前30/前60/其余,黑盒榜单抖动不再主导");

console.log("\n全部测试通过 ✅");
