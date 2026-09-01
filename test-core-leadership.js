"use strict";

const assert = require("assert");
const { LEADERSHIP_SCHEMA_VERSION, buildCoreLeadershipBoard, selectLeadershipTargets, buildStructureProfile, parseIntradayTrendPayload, parseTencentMinutePayload } = require("./core-leadership");

const topicBoard = {
  mainLine: {
    name: "AI算力",
    family: "AI算力",
    matchNames: ["AI算力"],
  },
};

function healthyKline(overrides = {}) {
  return {
    lastClose: 100,
    ma5: 98,
    ma10: 97,
    ma20: 95,
    ma60: 90,
    rise10: 10,
    rise20: 16,
    pctFromHigh: 5,
    position120Pct: 68,
    chipComfort: "舒服",
    longBearBreak3d: false,
    structureBreak: false,
    ...overrides,
  };
}

function stock(code, overrides = {}) {
  return {
    code,
    name: code,
    mainConcept: "AI算力",
    concepts: ["AI算力"],
    changePct: 1,
    amountYi: 35,
    combinedRank: 50,
    inBothSources: false,
    role: "后排观察",
    klineProfile: healthyKline(),
    ...overrides,
  };
}

function intraday(firstAttackMinute, rows, overrides = {}) {
  return {
    source: "eastmoney_trends2",
    asOf: "15:00",
    firstAttackMinute,
    firstAttackTime: `${String(Math.floor(firstAttackMinute / 60)).padStart(2, "0")}:${String(firstAttackMinute % 60).padStart(2, "0")}`,
    retentionPct: 82,
    rows: rows.map(([minute, changePct]) => ({ minute, changePct })),
    ...overrides,
  };
}

function activeGroup(activeOverrides = {}, passiveOverrides = {}) {
  const active = stock("ACTIVE", {
    name: "主动容量龙头",
    changePct: 8,
    amountYi: 120,
    mainInflowYi: 8,
    combinedRank: 3,
    inBothSources: true,
    role: "龙头",
    ...activeOverrides,
  });
  const passive = stock("PASSIVE", {
    name: "被动大成交中军",
    changePct: 2,
    amountYi: 220,
    combinedRank: 12,
    inBothSources: true,
    role: "中军",
    ...passiveOverrides,
  });
  const followerA = stock("FOLLOW_A", { changePct: 3, amountYi: 55 });
  const followerB = stock("FOLLOW_B", { changePct: 1.5, amountYi: 45 });

  const intradayByCode = new Map([
    ["ACTIVE", intraday(575, [[575, 2.2], [595, 6], [615, 8]])],
    ["FOLLOW_A", intraday(590, [[575, 0.2], [590, 2.1], [595, 3]])],
    ["FOLLOW_B", intraday(600, [[575, 0], [595, 1.2], [600, 2.1]])],
    ["PASSIVE", intraday(605, [[575, 0.1], [595, 1.1], [605, 2]])],
  ]);
  return { candidates: [active, passive, followerA, followerB], intradayByCode };
}

function build(candidates, intradayByCode = new Map(), overrides = {}) {
  return buildCoreLeadershipBoard({
    candidates,
    topicBoard,
    intradayByCode,
    archives: [],
    generatedAt: "2026-07-22T15:10:00+08:00",
    ...overrides,
  });
}

console.log("=== core-leadership 测试 ===");

// 1. 主动性与容量可以同时成立；该身份应具备主攻资格。
{
  const group = activeGroup();
  const board = build(group.candidates, group.intradayByCode);
  const leader = board.tradeCarriers.find((row) => row.code === "ACTIVE");
  assert(leader, "主动容量龙头必须进入可交易载体池");
  assert.strictEqual(leader.identity, "主动型容量龙头");
  assert.strictEqual(leader.coreIdentityQualified, true);
  assert.strictEqual(leader.tradeQualified, true);
  assert.strictEqual(leader.coreQualified, true);
  assert.strictEqual(leader.coreQualified, leader.tradeQualified, "旧字段必须与交易资格保持同义");
  assert.strictEqual(leader.anchorType, "主动容量核心");
  assert.strictEqual(leader.tradeState, "主攻候选");
  assert.strictEqual(leader.initiative.proactive, true);
  assert.strictEqual(leader.initiative.capacity, true);
  console.log("✓ 主动进攻与容量属性同时成立，可判主动型容量龙头");
}

// 2. 只有大成交、没有率先发动和带动性的被动中军，不能压过主动发动者。
{
  const group = activeGroup();
  const board = build(group.candidates, group.intradayByCode);
  const active = group.candidates.find((row) => row.code === "ACTIVE").leadership;
  const passive = group.candidates.find((row) => row.code === "PASSIVE").leadership;
  assert.strictEqual(board.leaders[0].code, "ACTIVE");
  assert(active.initiative.score > passive.initiative.score, "主动发动者的主动性分必须高于被动大成交中军");
  assert.strictEqual(passive.initiative.proactive, false);
  assert.strictEqual(passive.tradeState, "仅观察");
  assert(!board.tradeCarriers.some((row) => row.code === "PASSIVE"));
  console.log("✓ 被动大成交不压过主动发动者，只作为容量观察");
}

// 3. 老核心即使有辨识度和短线反抽，整体框架破位后也只能作为情绪观察。
{
  const group = activeGroup({
    code: "BROKEN",
    name: "破位老核心",
    klineProfile: healthyKline({
      lastClose: 72,
      ma5: 76,
      ma10: 82,
      ma20: 92,
      ma60: 98,
      pctFromHigh: 35,
      chipComfort: "套牢压力",
      longBearBreak3d: true,
      structureBreak: true,
    }),
  });
  group.intradayByCode.set("BROKEN", group.intradayByCode.get("ACTIVE"));
  group.intradayByCode.delete("ACTIVE");
  const board = build(group.candidates, group.intradayByCode);
  const brokenStock = group.candidates.find((row) => row.code === "BROKEN");
  assert.strictEqual(brokenStock.leadership.structure.breakdown, true);
  assert.strictEqual(brokenStock.leadership.coreIdentityQualified, true, "破位不能抹掉已验证核心身份");
  assert.strictEqual(brokenStock.leadership.tradeQualified, false);
  assert.strictEqual(brokenStock.leadership.coreQualified, false);
  assert.strictEqual(brokenStock.leadership.tradeState, "仅观察");
  assert(brokenStock.leadership.hardFails.includes("整体K线框架未通过"));
  assert(board.observations.some((row) => row.code === "BROKEN"));
  assert(!board.tradeCarriers.some((row) => row.code === "BROKEN"));
  console.log("✓ 破位老核心保留情绪观察身份，但不获得交易资格");
}

// 4. 框架完整、成交很大，但没有主动进攻证据时仍然只能观察。
{
  const passive = stock("NO_ACTIVE", {
    name: "无主动性容量中军",
    changePct: 1.3,
    amountYi: 180,
    combinedRank: 2,
    inBothSources: true,
    role: "中军",
  });
  const peers = [
    stock("PEER_1", { changePct: 1.1, amountYi: 80 }),
    stock("PEER_2", { changePct: 1.4, amountYi: 60 }),
    stock("PEER_3", { changePct: 1.2, amountYi: 50 }),
  ];
  const board = build([passive, ...peers]);
  assert.strictEqual(passive.leadership.structure.frameworkIntact, true);
  assert.strictEqual(passive.leadership.initiative.proactive, false);
  assert.strictEqual(passive.leadership.coreQualified, false);
  assert.strictEqual(passive.leadership.tradeState, "仅观察");
  assert(passive.leadership.hardFails.includes("没有验证出主动进攻或带动性"));
  assert(!board.tradeCarriers.some((row) => row.code === "NO_ACTIVE"));
  console.log("✓ 无主动性不因容量或结构完整而升级为龙头");
}

// 5. 主动核心若短线明显过热，龙头地位保留，但交易状态必须降为等回踩。
{
  const group = activeGroup({
    code: "HOT",
    name: "过热主动核心",
    price: 130,
    klineProfile: healthyKline({
      lastClose: 130,
      ma5: 119,
      ma10: 112,
      ma20: 100,
      ma60: 88,
      rise10: 32,
      rise20: 48,
      pctFromHigh: 2,
    }),
  });
  group.intradayByCode.set("HOT", group.intradayByCode.get("ACTIVE"));
  group.intradayByCode.delete("ACTIVE");
  const board = build(group.candidates, group.intradayByCode);
  const hot = group.candidates.find((row) => row.code === "HOT").leadership;
  assert.strictEqual(hot.initiative.proactive, true);
  assert.strictEqual(hot.structure.frameworkIntact, true);
  assert.strictEqual(hot.structure.overextended, true);
  assert.strictEqual(hot.coreQualified, true);
  assert.strictEqual(hot.tradeState, "等回踩");
  assert(board.tradeCarriers.some((row) => row.code === "HOT" && row.tradeState === "等回踩"));
  console.log("✓ 过热主动核心保留龙头资格，但禁止追价、等待回踩");
}

// 6. 分时缺失必须安全降级；仅靠弱收盘代理不能误判为主动核心。
{
  const weakProxy = stock("WEAK_PROXY", {
    name: "弱代理样本",
    changePct: undefined,
    amountYi: 160,
    mainInflowYi: null,
    combinedRank: 1,
    inBothSources: true,
    role: "龙头",
  });
  const peers = [
    stock("WEAK_PEER_1", { changePct: 0.8, amountYi: 70 }),
    stock("WEAK_PEER_2", { changePct: 1.1, amountYi: 60 }),
    stock("WEAK_PEER_3", { changePct: 0.5, amountYi: 50 }),
  ];
  let board;
  assert.doesNotThrow(() => {
    board = build([weakProxy, ...peers], new Map());
  });
  assert.strictEqual(board.dataQuality, "主线分时不足，使用收盘代理");
  assert.strictEqual(weakProxy.leadership.initiative.dataQuality, "收盘代理");
  assert.strictEqual(weakProxy.leadership.initiative.proactive, false);
  assert.strictEqual(weakProxy.leadership.coreQualified, false);
  assert.strictEqual(weakProxy.leadership.tradeState, "仅观察");
  assert(Number.isFinite(weakProxy.leadership.initiative.score));
  console.log("✓ 分时缺失不崩溃，弱收盘代理不通过主动性门槛");
}

// 7. 距前高较远不等于硬套牢：低位站回MA20/MA60并完成换手修复，应保留交易资格。
{
  const group = activeGroup({
    code: "RECOVERED",
    name: "低位换手修复核心",
    turnoverRate: 16,
    volumeRatio: 1.6,
    klineProfile: healthyKline({
      lastClose: 92,
      ma5: 91,
      ma10: 90,
      ma20: 88,
      ma60: 89,
      vwap20: 87,
      rise10: 6,
      rise20: -4,
      pctFromHigh: 32,
      position120Pct: 30,
      chipComfort: "套牢压力",
      volumeBreakout: true,
      amountTrendRatio: 1.15,
      longBearBreak3d: false,
      structureBreak: false,
    }),
  });
  group.intradayByCode.set("RECOVERED", group.intradayByCode.get("ACTIVE"));
  group.intradayByCode.delete("ACTIVE");
  const board = build(group.candidates, group.intradayByCode);
  const recovered = group.candidates.find((row) => row.code === "RECOVERED").leadership;
  assert.strictEqual(recovered.initiative.proactive, true);
  assert.strictEqual(recovered.structure.trendHealthy, true);
  assert.strictEqual(recovered.structure.breakdown, false);
  assert.strictEqual(recovered.structure.chipRepairing, true);
  assert.strictEqual(
    recovered.structure.chipPressure,
    false,
    "已站回MA20/MA60并放量换手时，不应仅因距前高较远判定硬筹码压力"
  );
  assert.strictEqual(recovered.structure.frameworkIntact, true);
  assert.strictEqual(recovered.coreQualified, true);
  assert.notStrictEqual(recovered.tradeState, "仅观察");
  assert(board.tradeCarriers.some((row) => row.code === "RECOVERED"));
  console.log("✓ 深跌后收复MA20/MA60且换手修复，不被距前高单指标误杀");
}

// 8. 同样距前高较远，若成本未收复且修复量不足，必须保留套牢压力并仅观察。
{
  const group = activeGroup({
    code: "TRAPPED",
    name: "未完成修复核心",
    turnoverRate: 2.1,
    volumeRatio: 0.65,
    klineProfile: healthyKline({
      lastClose: 78,
      ma5: 79,
      ma10: 81,
      ma20: 88,
      ma60: 92,
      vwap20: 87,
      rise10: -5,
      rise20: -16,
      pctFromHigh: 32,
      position120Pct: 30,
      chipComfort: "中性",
      volumeBreakout: false,
      amountTrendRatio: 0.65,
      longBearBreak3d: false,
      structureBreak: false,
    }),
  });
  group.intradayByCode.set("TRAPPED", group.intradayByCode.get("ACTIVE"));
  group.intradayByCode.delete("ACTIVE");
  build(group.candidates, group.intradayByCode);
  const trapped = group.candidates.find((row) => row.code === "TRAPPED").leadership;
  assert.strictEqual(trapped.initiative.proactive, true, "应隔离验证结构门槛，而不是被主动性提前淘汰");
  assert.strictEqual(trapped.structure.trendHealthy, false);
  assert.strictEqual(trapped.structure.chipRepairing, false);
  assert.strictEqual(trapped.structure.chipPressure, true);
  assert.strictEqual(trapped.coreQualified, false);
  assert.strictEqual(trapped.tradeState, "仅观察");
  assert(trapped.hardFails.includes("上方套牢与筹码压力偏重"));
  console.log("✓ 未收复成本且量能不足时保留套牢压力，只作观察");
}

// 9. 有真实分时时，尾盘才落后发动、没有跟随和扩散的大涨票不得借收盘强度冒充主动进攻。
{
  const group = activeGroup({
    code: "LATE_SOLO",
    name: "尾盘孤立大涨样本",
    changePct: 9,
  });
  group.intradayByCode.set("LATE_SOLO", intraday(885, [[575, 0], [840, 0.5], [885, 2.2], [895, 9]]));
  group.intradayByCode.delete("ACTIVE");
  build(group.candidates, group.intradayByCode);
  const lateSolo = group.candidates.find((row) => row.code === "LATE_SOLO").leadership;
  assert.strictEqual(lateSolo.initiative.dataQuality, "分时验证");
  assert(lateSolo.initiative.score >= 58, "样本需保证总分够高，以隔离验证真实带动性门槛");
  assert(lateSolo.initiative.leadMinutes < 0, "该票应明显晚于方向典型发动时点");
  assert.strictEqual(lateSolo.initiative.followerCount, 0);
  assert.strictEqual(lateSolo.initiative.breadthLift, 0);
  assert.strictEqual(lateSolo.initiative.proactive, false);
  assert.strictEqual(lateSolo.coreQualified, false);
  assert.strictEqual(lateSolo.tradeState, "仅观察");
  console.log("✓ 尾盘孤立大涨且0跟随0扩散，有真实分时时不得判主动进攻");
}

// 10. 原交易硬门槛拥有最终否决权；主动性和龙头身份都不能绕过 hardGate.pass=false。
{
  const group = activeGroup({
    code: "HARD_BLOCKED",
    name: "硬门槛否决主动龙头",
    hardGate: {
      pass: false,
      hardFails: ["换手过大", "关键结构不合格"],
    },
  });
  group.intradayByCode.set("HARD_BLOCKED", group.intradayByCode.get("ACTIVE"));
  group.intradayByCode.delete("ACTIVE");
  const board = build(group.candidates, group.intradayByCode);
  const blocked = group.candidates.find((row) => row.code === "HARD_BLOCKED").leadership;
  assert.strictEqual(blocked.initiative.proactive, true);
  assert(["L3", "L4"].includes(blocked.level));
  assert.strictEqual(blocked.structure.frameworkIntact, true);
  assert.strictEqual(blocked.coreIdentityQualified, true, "交易硬门槛不能反向抹掉核心身份");
  assert.strictEqual(blocked.tradeQualified, false);
  assert.strictEqual(blocked.coreQualified, false);
  assert.strictEqual(blocked.tradeState, "仅观察");
  assert(blocked.hardFails.some((reason) => reason.includes("原交易硬门槛未通过")));
  assert(!board.tradeCarriers.some((row) => row.code === "HARD_BLOCKED"));
  console.log("✓ hardGate.pass=false 否决主动龙头交易资格，只保留观察");
}

// 11. 空值不是低位或放量证据：position120Pct/amountTrendRatio 为 null 时不能误触发换手修复。
{
  const group = activeGroup({
    code: "NULL_REPAIR",
    name: "空值换手误判样本",
    klineProfile: healthyKline({
      lastClose: 92,
      ma5: 91,
      ma10: 90,
      ma20: 88,
      ma60: 89,
      vwap20: 87,
      pctFromHigh: 32,
      position120Pct: null,
      chipComfort: "套牢压力",
      volumeBreakout: false,
      amountTrendRatio: null,
      longBearBreak3d: false,
      structureBreak: false,
    }),
  });
  group.intradayByCode.set("NULL_REPAIR", group.intradayByCode.get("ACTIVE"));
  group.intradayByCode.delete("ACTIVE");
  build(group.candidates, group.intradayByCode);
  const nullRepair = group.candidates.find((row) => row.code === "NULL_REPAIR").leadership;
  assert.strictEqual(nullRepair.structure.trendHealthy, true);
  assert.strictEqual(nullRepair.structure.chipRepairing, false);
  assert.strictEqual(nullRepair.structure.chipPressure, true);
  assert.strictEqual(nullRepair.coreQualified, false);
  assert.strictEqual(nullRepair.tradeState, "仅观察");
  console.log("✓ 低位和量能字段为空时不伪造换手修复证据");
}

// 12. 主线候选不足3只时仍需优先全量抓取主线，不能被全市场高成交/高涨幅样本挤出目标池。
{
  const mainA = stock("MAIN_A", {
    name: "主线低排序样本A",
    amountYi: 3,
    changePct: -1,
    combinedRank: 998,
  });
  const mainB = stock("MAIN_B", {
    name: "主线低排序样本B",
    amountYi: 2,
    changePct: -2,
    combinedRank: 999,
  });
  const marketRows = Array.from({ length: 20 }, (_, index) => stock(`OTHER_${index}`, {
    name: `非主线高排序样本${index}`,
    mainConcept: "医药",
    concepts: ["医药"],
    amountYi: 300 - index,
    changePct: 9 - index * 0.1,
    combinedRank: index + 1,
    role: index < 8 ? "龙头" : "中军",
  }));
  const targets = selectLeadershipTargets([...marketRows, mainA, mainB], topicBoard, 14);
  const targetCodes = new Set(targets.map((row) => row.code));
  assert(targetCodes.has("MAIN_A"), "主线只有2只时必须抓取主线A的分时");
  assert(targetCodes.has("MAIN_B"), "主线只有2只时必须抓取主线B的分时");
  assert(targetCodes.has("OTHER_0"), "全市场热榜前排必须保留分时名额，不能只抓当前主线");
  console.log("✓ 全市场候选很多时，两只主线标的仍完整进入分时目标池");
}

// 13. 同交易日的已验证主动性在接口失败时保留，但当前收盘明显转弱必须撤销 proactive。
{
  const verifiedGroup = activeGroup();
  build(verifiedGroup.candidates, verifiedGroup.intradayByCode);
  const verifiedFloor = { ...verifiedGroup.candidates.find((row) => row.code === "ACTIVE").leadership.initiative };
  assert.strictEqual(verifiedFloor.dataQuality, "分时验证");
  assert.strictEqual(verifiedFloor.proactive, true);
  const floorMap = new Map([["ACTIVE", verifiedFloor]]);

  const stableGroup = activeGroup();
  stableGroup.intradayByCode.delete("ACTIVE");
  build(stableGroup.candidates, stableGroup.intradayByCode, { initiativeFloorByCode: floorMap });
  const stable = stableGroup.candidates.find((row) => row.code === "ACTIVE").leadership;
  assert.strictEqual(stable.initiative.dataQuality, "分时验证");
  assert.strictEqual(stable.initiative.preservedFromEarlierFetch, true);
  assert.strictEqual(stable.initiative.proactive, true);
  assert(stable.initiative.score >= verifiedFloor.score);

  const weakGroup = activeGroup({
    changePct: -7,
    mainInflowYi: -5,
  });
  weakGroup.intradayByCode.delete("ACTIVE");
  build(weakGroup.candidates, weakGroup.intradayByCode, { initiativeFloorByCode: floorMap });
  const weak = weakGroup.candidates.find((row) => row.code === "ACTIVE").leadership;
  assert.strictEqual(weak.initiative.dataQuality, "分时验证");
  assert.strictEqual(weak.initiative.preservedFromEarlierFetch, true);
  assert.strictEqual(weak.initiative.proactive, false);
  assert(weak.initiative.score <= 57);
  assert.strictEqual(weak.coreQualified, false);
  assert.strictEqual(weak.tradeState, "仅观察");
  console.log("✓ 同日分时失败保留已验证 floor，当前明显转弱则撤销主动资格");
}

// 14. 新一字锁板没有价格发现：09:30和后续时间相关性不得建立主动性或核心身份。
{
  const locked = stock("LOCKED", {
    name: "新一字高度样本",
    price: 110,
    open: 110,
    high: 110,
    low: 110,
    prevClose: 100,
    limitUpPrice: 110,
    changePct: 10,
    amountYi: 8,
    combinedRank: 2,
    inBothSources: true,
    role: "龙头",
    popularity: "首板",
  });
  const followerA = stock("LOCK_FOLLOW_A", { changePct: 4, amountYi: 45 });
  const followerB = stock("LOCK_FOLLOW_B", { changePct: 3, amountYi: 40 });
  const intradayByCode = new Map([
    ["LOCKED", intraday(570, [[570, 10], [600, 10], [720, 10], [900, 10]])],
    ["LOCK_FOLLOW_A", intraday(585, [[570, 0], [585, 2.2], [600, 4]])],
    ["LOCK_FOLLOW_B", intraday(590, [[570, 0], [590, 2.1], [605, 3]])],
  ]);
  const board = build([locked, followerA, followerB], intradayByCode);
  const result = locked.leadership;
  assert.strictEqual(result.initiative.priceDiscovery.suspectedOneWord, true);
  assert.strictEqual(result.initiative.priceDiscovery.noPriceDiscovery, true);
  assert.strictEqual(result.initiative.firstAttackTime, "09:30", "可保留客观时间用于展示");
  assert.strictEqual(result.initiative.leadMinutes, null, "一字的09:30不得作为领先分钟证据");
  assert.strictEqual(result.initiative.followerCount, 0, "一字后上涨不得机械计为followers");
  assert.strictEqual(result.initiative.breadthLift, 0, "一字后扩散不得机械归因为该票");
  assert.strictEqual(result.initiative.proactive, false);
  assert.strictEqual(result.coreIdentityQualified, false);
  assert.strictEqual(result.tradeQualified, false);
  assert.strictEqual(result.coreQualified, false);
  assert.strictEqual(result.anchorType, "高度观察");
  assert.strictEqual(result.tradeState, "仅观察");
  assert(!board.leaders.some((row) => row.code === "LOCKED"), "新一字高度票不能进入核心leaders");
  assert(!board.tradeCarriers.some((row) => row.code === "LOCKED"));
  console.log("✓ 新一字锁板只计高度观察，09:30与后续followers不建立主动性");
}

// 15. 已有多日真实影响的一字票可保留历史情绪身份，但本日仍无交易资格。
{
  const historicalRows = ["2026-07-20", "2026-07-21"].map((date) => ({
    date,
    payload: {
      candidates: [{
        code: "HIST_LOCKED",
        role: "龙头",
        selected: true,
        leadership: { initiative: { score: 82 } },
      }],
    },
  }));
  const locked = stock("HIST_LOCKED", {
    name: "历史影响一字样本",
    price: 110,
    open: 110,
    high: 110,
    low: 110,
    prevClose: 100,
    limitUpPrice: 110,
    changePct: 10,
    amountYi: 9,
    combinedRank: 4,
    inBothSources: true,
    role: "龙头",
    popularity: "3连板",
  });
  const intradayByCode = new Map([
    ["HIST_LOCKED", intraday(570, [[570, 10], [600, 10], [900, 10]])],
  ]);
  const board = build([locked], intradayByCode, { archives: historicalRows });
  const result = locked.leadership;
  assert.strictEqual(result.initiative.priceDiscovery.historicalImpact, true);
  assert.strictEqual(result.initiative.proactive, false, "历史身份不能把本日一字反推成主动进攻");
  assert.strictEqual(result.coreIdentityQualified, true, "已有多日影响可保留情绪核心身份");
  assert.strictEqual(result.anchorType, "历史情绪核心");
  assert.strictEqual(result.tradeQualified, false);
  assert.strictEqual(result.coreQualified, false);
  assert.strictEqual(result.tradeState, "仅观察");
  assert(board.leaders.some((row) => row.code === "HIST_LOCKED" && row.coreIdentityQualified));
  assert(!board.tradeCarriers.some((row) => row.code === "HIST_LOCKED"));
  console.log("✓ 历史影响一字票保留情绪身份，但不凭本日锁板获得交易资格");
}

assert.strictEqual(LEADERSHIP_SCHEMA_VERSION, 7, "分时来源质量、收盘完整性、封板顺序与量比软门槛必须通过schema版本触发缓存迁移");

// 16. 旧缓存只有涨停收盘、没有分时/OHLC时，不得用收盘代理恢复主动核心。
{
  const cachedLimit = stock("CACHE_LIMIT", {
    name: "旧缓存涨停样本",
    price: 110,
    prevClose: 100,
    limitUpPrice: 110,
    changePct: 10,
    amountYi: 12,
    combinedRank: 3,
    role: "龙头",
  });
  const board = build([cachedLimit], new Map());
  const result = cachedLimit.leadership;
  assert.strictEqual(result.initiative.priceDiscovery.limitUpDiscoveryUnverified, true);
  assert.strictEqual(result.initiative.priceDiscovery.noPriceDiscovery, true);
  assert.strictEqual(result.initiative.proactive, false);
  assert.strictEqual(result.coreIdentityQualified, false);
  assert(!board.leaders.some((row) => row.code === "CACHE_LIMIT"));
  console.log("✓ 旧缓存涨停缺少价格发现时不恢复主动核心");
}

// role="龙头" 只是当日高度的兼容展示字段时，不能累计为跨日核心命中。
// 连续两天的 session/dailyHeight 若能让第三天的一字票恢复“历史核心”，
// 说明当日榜单语义仍污染了周期身份。
{
  const dailyHeightArchives = ["2026-07-20", "2026-07-21"].map((date) => ({
    date,
    payload: {
      candidates: [{
        code: "ANON_DAILY_HEIGHT",
        name: "匿名当日高度",
        role: "龙头",
        roleKind: "dailyHeight",
        roleScope: "session",
        dailyRole: "当日高度",
        selected: false,
      }],
    },
  }));
  const locked = stock("ANON_DAILY_HEIGHT", {
    name: "匿名当日高度",
    price: 110,
    open: 110,
    high: 110,
    low: 110,
    prevClose: 100,
    limitUpPrice: 110,
    changePct: 10,
    amountYi: 8,
    combinedRank: 5,
    inBothSources: true,
    role: "龙头",
    roleKind: "dailyHeight",
    roleScope: "session",
    dailyRole: "当日高度",
    popularity: "3连板",
  });
  const intradayByCode = new Map([
    ["ANON_DAILY_HEIGHT", intraday(570, [[570, 10], [600, 10], [900, 10]])],
  ]);
  const board = build([locked], intradayByCode, { archives: dailyHeightArchives });
  assert.strictEqual(
    locked.leadership.history.coreHits,
    0,
    "session/dailyHeight 不能累计为跨日 coreHits",
  );
  assert.strictEqual(
    locked.leadership.initiative.priceDiscovery.historicalImpact,
    false,
    "仅有两天当日高度记录不能建立历史核心影响",
  );
  assert.strictEqual(locked.leadership.coreIdentityQualified, false);
  assert(!board.leaders.some((row) => row.code === "ANON_DAILY_HEIGHT"));
  console.log("✓ 当日高度不会跨日累计为周期核心");
}

// P1契约：dailyHeight/session 的裸“龙头”文本既不能给主动性加龙头角色分，
// 也不能让 legacyRecognized 把它包装成情绪/历史核心；确认的周期身份仍可保留。
{
  const plain = stock("P1_ROLE_BASELINE", {
    name: "匿名普通样本",
    role: "后排观察",
    roleKind: "dailyHeight",
    roleScope: "session",
    dailyRole: "当日高度",
    changePct: 4,
    amountYi: 12,
    combinedRank: 35,
    inBothSources: false,
  });
  const dailyHeight = stock("P1_ROLE_DAILY", {
    ...plain,
    code: "P1_ROLE_DAILY",
    name: "匿名当日高度样本",
    role: "龙头",
  });
  const plainIntraday = intraday(600, [[575, 0], [600, 2], [720, 4]], { retentionPct: 55 });
  const dailyIntraday = intraday(600, [[575, 0], [600, 2], [720, 4]], { retentionPct: 55 });
  build(
    [plain, dailyHeight],
    new Map([
      [plain.code, plainIntraday],
      [dailyHeight.code, dailyIntraday],
    ]),
  );
  assert.strictEqual(
    dailyHeight.leadership.initiative.score,
    plain.leadership.initiative.score,
    "dailyHeight/session的裸role=龙头不得获得主动性角色加分",
  );
  assert.strictEqual(dailyHeight.leadership.recognized, plain.leadership.recognized);
  assert.strictEqual(dailyHeight.leadership.coreIdentityQualified, false);
  assert(
    !/情绪|历史核心/.test(String(dailyHeight.leadership.identity || "")),
    "dailyHeight/session不能经legacyRecognized变成周期核心身份",
  );

  const confirmed = stock("P1_ROLE_CONFIRMED", {
    name: "匿名已确认周期核心",
    role: "龙头",
    roleKind: "cycleLeader",
    roleScope: "cycle",
    cycleIdentity: { identityEstablished: true, activePrimary: true, state: "confirmed" },
    leadership: {
      cycleIdentity: { identityEstablished: true, activePrimary: true, state: "confirmed" },
    },
    changePct: 4,
    amountYi: 12,
    combinedRank: 35,
    inBothSources: false,
  });
  build([confirmed], new Map([[confirmed.code, plainIntraday]]));
  assert.strictEqual(
    confirmed.leadership.recognized,
    true,
    "confirmed cycle identity仍应保留周期核心辨识度",
  );
  assert.notStrictEqual(confirmed.leadership.identity, "跟随观察");
  console.log("✓ P1核心领导力契约：当日高度无龙头角色红利，确认周期身份仍保留");
}

// 17. 开盘一分钟内快速封板但成交小、无历史辨识度时，即使后续方向上涨，
// 也只能列核心候选/观察，不能把时间相关性写成核心因果关系。
{
  const fastLocked = stock("FAST_LOCK", {
    name: "开盘快速封板低成交样本",
    price: 110,
    open: 107.2,
    high: 110,
    low: 107.2,
    prevClose: 100,
    limitUpPrice: 110,
    changePct: 10,
    amountYi: 14.5,
    combinedRank: 2,
    inBothSources: true,
    role: "龙头",
  });
  const followerA = stock("FAST_FOLLOW_A", { changePct: 4, amountYi: 50 });
  const followerB = stock("FAST_FOLLOW_B", { changePct: 3.5, amountYi: 45 });
  const intradayByCode = new Map([
    ["FAST_LOCK", intraday(570, [[570, 7.2], [571, 10], [600, 10], [900, 10]], { retentionPct: 100 })],
    ["FAST_FOLLOW_A", intraday(585, [[570, 0], [585, 2.3], [600, 4]])],
    ["FAST_FOLLOW_B", intraday(590, [[570, 0], [590, 2.1], [605, 3.5]])],
  ]);
  const board = build([fastLocked, followerA, followerB], intradayByCode);
  const result = fastLocked.leadership;
  assert.strictEqual(result.initiative.priceDiscovery.noPriceDiscovery, false, "该样本不是严格一字板");
  assert.strictEqual(result.initiative.proactive, true, "可保留客观主动性观察");
  assert.strictEqual(result.persistentRecognition, false, "无历史、无容量的开盘快速封板不具备持续辨识度");
  assert.strictEqual(result.coreIdentityQualified, false);
  assert.strictEqual(result.tradeQualified, false);
  assert(!board.leaders.some((row) => row.code === "FAST_LOCK"));
  assert(result.identityFails.some((reason) => reason.includes("持续辨识度")));
  console.log("✓ 开盘快速封板有跟随但无历史与容量时，不把时间相关性误判为核心");
}

// 18. 次新股高换手且守住近期成交成本，应识别为筹码重置，而不是按距阶段高点判套牢。
{
  const structure = buildStructureProfile(stock("NEW_RESET", {
    price: 197,
    klineProfile: {
      lastClose: 197,
      isNewListing: true,
      tradingDays: 13,
      rise10: 24,
      rise20: 24,
      pctFromHigh: 18,
      effectiveTurnover5: 96,
      recentWeightedCost: 184,
      closeToCostPct: 7.1,
      closePositionPct: 78,
      newStockChipState: "筹码快速重置",
      newStockDistributionRisk: false,
      structureBreak: false,
      longBearBreak3d: false,
    },
  }));
  assert.strictEqual(structure.isNewListing, true);
  assert.strictEqual(structure.chipPressure, false);
  assert.strictEqual(structure.frameworkIntact, true);
  assert.strictEqual(structure.chipLabel, "筹码快速重置");
  assert(structure.evidence.some((item) => item.includes("有效换手")));
  console.log("✓ 次新高换手守住成本识别为筹码快速重置，不按60日高点误判套牢");
}

// 19. 次新高换手后跌破换手成本，才按派发风险处理。
{
  const structure = buildStructureProfile(stock("NEW_DISTRIBUTION", {
    price: 145,
    klineProfile: {
      lastClose: 145,
      isNewListing: true,
      tradingDays: 16,
      rise10: -12,
      pctFromHigh: 35,
      effectiveTurnover5: 91,
      recentWeightedCost: 158,
      closeToCostPct: -8.2,
      closePositionPct: 22,
      newStockChipState: "高换手派发风险",
      newStockDistributionRisk: true,
      structureBreak: false,
      longBearBreak3d: false,
    },
  }));
  assert.strictEqual(structure.chipPressure, true);
  assert.strictEqual(structure.breakdown, true);
  assert.strictEqual(structure.frameworkIntact, false);
  console.log("✓ 次新高换手且跌破成本才判派发风险");
}

// 20. 非主线但属于核心方向的主动活口，只获得修复观察身份，不自动获得交易资格。
{
  const group = activeGroup();
  group.candidates.forEach((item) => {
    item.mainConcept = "存储芯片";
    item.concepts = ["存储芯片"];
    item.directionState = { isCoreDirection: true, dailyKey: "loss", dailyLabel: "今日亏钱效应" };
  });
  const board = build(group.candidates, group.intradayByCode);
  const active = group.candidates.find((item) => item.code === "ACTIVE").leadership;
  assert.strictEqual(active.focusMatch, false);
  assert.strictEqual(active.repairCoreQualified, true);
  assert.strictEqual(active.tradeQualified, false);
  assert.strictEqual(active.tradeState, "修复观察");
  assert(board.observations.some((item) => item.code === "ACTIVE" && item.repairCoreQualified));
  console.log("✓ 核心方向主动活口保留为修复观察，但不会绕过主线门槛自动买入");
}

// 21. 全天从低位拉到涨停、触板后始终封住，应记录为0次开板。
// 这条事实是有研新材“不属于烂板弱基线”的底层保障。
{
  const stable = stock("600206", {
    name: "稳定封板样本",
    price: 11,
    prevClose: 10,
    limitUpPrice: 11,
    changePct: 10,
    amountYi: 42,
    role: "龙头",
    popularity: "3连板",
  });
  const intradayByCode = new Map([[
    "600206",
    intraday(575, [
      [570, 2.3],
      [575, 6],
      [578, 10],
      [579, 10],
      [580, 10],
      [900, 10],
    ], {
      tradingDate: "2026-08-06",
      prevClose: 10,
      retentionPct: 100,
    }),
  ]]);
  build([stable], intradayByCode);
  const session = stable.leadership.initiative.session;
  assert.strictEqual(session.limitTouched, true);
  assert.strictEqual(session.firstLimitTime, "09:38");
  assert.strictEqual(session.limitOpenCount, 0);
  assert.strictEqual(session.resealedAfterOpen, false);
  console.log("✓ 低位主动拉板后稳定封住被记录为0次开板，不用全天振幅冒充烂板");
}

// 22. 首次触板后短暂打开再封住，必须保留“开板→回封”的先后顺序。
// 这条事实用于区分快速强势回封与真正的反复烂板。
{
  const resealed = stock("002428", {
    name: "快速回封样本",
    price: 11,
    prevClose: 10,
    limitUpPrice: 11,
    changePct: 10,
    amountYi: 70,
    role: "龙头",
    popularity: "首板",
  });
  const summary = intraday(571, [], {
    tradingDate: "2026-08-06",
    prevClose: 10,
    retentionPct: 100,
    rows: [
      { minute: 570, time: "09:30", changePct: 7, high: 10.7 },
      { minute: 571, time: "09:31", changePct: 9.7, high: 11 },
      { minute: 572, time: "09:32", changePct: 9.5, high: 10.98 },
      { minute: 573, time: "09:33", changePct: 10, high: 11 },
      { minute: 574, time: "09:34", changePct: 10, high: 11 },
      { minute: 900, time: "15:00", changePct: 10, high: 11 },
    ],
  });
  build([resealed], new Map([["002428", summary]]));
  const session = resealed.leadership.initiative.session;
  assert.strictEqual(session.limitTouched, true);
  assert.strictEqual(session.limitOpenCount, 1);
  assert.strictEqual(session.longestOpenMinutes, 2);
  assert.strictEqual(session.lastResealTime, "09:33");
  assert.strictEqual(session.resealedAfterOpen, true);
  console.log("✓ 触板后短暂打开再封住完整记录为开板1次与最后回封时间");
}

// 23. 腾讯分钟兜底必须读取供应商交易日，并按累计成交额计算当日成交。
{
  const parsed = parseTencentMinutePayload({
    data: {
      sh600460: {
        data: {
          date: "20260821",
          data: [
            "0930 10.10 100 1010.00",
            "0931 10.30 220 2246.00",
            "0932 10.60 360 3724.00",
            "1500 10.80 500 5340.00",
          ],
        },
        qt: { sh600460: ["1", "腾讯分钟样本", "600460", "10.60", "10.00"] },
      },
    },
  }, "sh600460", 10);
  assert.strictEqual(parsed.source, "tencent_minute_query");
  assert.strictEqual(parsed.tradingDate, "2026-08-21");
  assert.strictEqual(parsed.firstAttackTime, "09:31");
  assert.strictEqual(parsed.rows[1].amount, 1236);
  assert.strictEqual(parsed.evidenceQuality.qualityKey, "exact_closing_price_series");
  assert.strictEqual(parsed.evidenceQuality.evidenceWeight, 0.85);
  assert.strictEqual(parsed.fieldLimitations.length, 1);
  const east = parseIntradayTrendPayload({
    data: {
      preClose: 10,
      trends: [
        "2026-08-21 09:30,10.1,10.1,10.2,10.0,100,1010,10.1",
        "2026-08-21 15:00,10.8,10.8,10.9,10.7,500,5340,10.5",
      ],
    },
  }, 10);
  assert.strictEqual(east.evidenceQuality.qualityKey, "exact_closing_full_ohlc");
  assert.strictEqual(east.evidenceQuality.evidenceWeight, 1);
  console.log("✓ 腾讯分钟兜底保留同日、攻击时间与累计成交证据边界");
}

// 24. 上午缓存即使是真实分钟数据，也不能冒充完整收盘分时并取得交易资格。
{
  const partial = parseTencentMinutePayload({
    data: {
      sh600460: {
        data: {
          date: "20260821",
          data: ["0930 10.10 100 1010.00", "1000 10.80 500 5340.00"],
        },
        qt: { sh600460: ["1", "上午部分样本", "600460", "10.80", "10.00"] },
      },
    },
  }, "sh600460", 10);
  assert.strictEqual(partial.evidenceQuality.qualityKey, "partial_session");
  const group = activeGroup({ code: "PARTIAL", name: "上午部分分时样本" });
  group.intradayByCode.delete("ACTIVE");
  group.intradayByCode.set("PARTIAL", partial);
  build(group.candidates, group.intradayByCode);
  const leadership = group.candidates.find((row) => row.code === "PARTIAL").leadership;
  assert.strictEqual(leadership.initiative.dataQuality, "分时部分验证");
  assert.strictEqual(leadership.initiative.session.closingComplete, false);
  assert.strictEqual(leadership.tradeQualified, false);
  assert(leadership.hardFails.includes("分时只覆盖部分交易时段，不能授予收盘交易资格"));
  console.log("✓ 上午部分分时明确降级，不能冒充完整收盘分时取得交易资格");
}

console.log("\ncore-leadership 测试全部通过 ✅");
