"use strict";
/**
 * test-selection-replay.js —— 用真实抓取缓存回放 周期→风险栏→打分 全链路
 *
 * 背景:2026-07-05 用户真实抓取(.hot-stocks-cache.json)出现四个问题:
 *   ①主升·高位分歧仍给70%-100%仓位 ②抓取失败静默回退无提示
 *   ③"未归类"16只(报价补全失败的残缺行)霸榜热度方向 ④主升周期0入选
 * 根因:K线/板块行情两个接口失败后,"数据缺失"被当成"验证不合格"处理,层层连锁清零。
 * 本回放用同一份真实数据验证修复:数据缺失降级为⚠️待补,不再一票全灭。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { _internals } = require("./server");
const { roleContext } = require("./leader-select");
const { classifyMarket, classifyTradingStyle, conceptStats, clusterHotConcepts, buildRiskBoard, scoreCandidate, buildFetchStatus, buildBestPicks, buildTopicBoard, buildSurvivorBoard, buildTomorrowOutlook, highBoardFeedback } = _internals;

function serverFunction(name, nextName) {
  const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert(start >= 0 && end > start, `无法从 server.js 提取 ${name}`);
  return Function(`"use strict"; return (${source.slice(start, end).trim()});`)();
}

// 当日高度可留在题材强势榜观察，但不得写进30天核心留存池。
{
  const collectCoreWatchSeeds = serverFunction("collectCoreWatchSeeds", "isCoreWatchCandidate");
  const dailyHeight = {
    code: "ANON_CORE_WATCH_HEIGHT",
    name: "匿名当日高度",
    role: "龙头",
    roleKind: "dailyHeight",
    roleScope: "session",
    dailyRole: "当日高度",
    selected: true,
  };
  const seeds = collectCoreWatchSeeds({
    candidates: [dailyHeight],
    selected: [dailyHeight],
    topicBoard: {
      items: [{ name: "匿名题材", leaders: [dailyHeight], leader: dailyHeight }],
    },
  });
  assert.strictEqual(
    seeds.some((stock) => stock.code === dailyHeight.code),
    false,
    "session/dailyHeight 不能作为 topic-leader 或 selected 写入跨日核心观察池",
  );
}

// 回归契约：classifyRole 已经区分“当日高度”和跨日周期角色，scoreCandidate
// 必须把这组语义完整带进候选；只留下 role="龙头" 会让下游误当周期龙头。
{
  const dailyHeight = {
    code: "600001",
    name: "匿名当日高度",
    concepts: ["角色透传契约"],
    price: 11,
    prevClose: 10,
    changePct: 10,
    popularity: "4连板",
    combinedRank: 1,
    eastRank: 1,
    thsRank: 1,
    inBothSources: true,
    turnoverRate: 15,
    amountYi: 20,
    mainInflowYi: 2,
    mainInflowRatio: 5,
    klineProfile: null,
  };
  const contractConcepts = [{
    name: "角色透传契约",
    matchNames: ["角色透传契约"],
    count: 3,
    limitCount: 2,
    resonance: true,
    score: 50,
    isCoreDirection: true,
    directionState: { isCoreDirection: true, dailyLabel: "核心方向" },
  }];
  const scoredDailyHeight = scoreCandidate(
    dailyHeight,
    contractConcepts,
    { cycle: "主升", subPhase: "分歧", position: "30%-50%", operation: "条件参与", trend: "主升", score: 70 },
    roleContext([dailyHeight], contractConcepts),
    { preference: "轮动回流" },
    null,
    { blockedConcepts: [], blockedTicketTypes: [], blockedSetups: [] },
  );
  assert.deepStrictEqual(
    {
      roleScope: scoredDailyHeight.roleScope,
      dailyRole: scoredDailyHeight.dailyRole,
      roleKind: scoredDailyHeight.roleKind,
    },
    { roleScope: "session", dailyRole: "当日高度", roleKind: "dailyHeight" },
    "scoreCandidate 必须透传当日高度的 roleScope/dailyRole/roleKind，不能只留下裸 role=龙头",
  );

  const eligibilityMarketState = {
    cycle: "主升",
    subPhase: "分歧",
    position: "30%-50%",
    operation: "条件参与",
    trend: "主升",
    score: 70,
    minScore: 0,
    allowSetups: ["核心打板/分歧转强", "轮动回流第一强", "核心观察"],
  };
  const scoreRoleEligibility = (coreIdentityQualified) => {
    const stock = {
      ...dailyHeight,
      leadership: { coreIdentityQualified },
    };
    return scoreCandidate(
      stock,
      contractConcepts,
      eligibilityMarketState,
      roleContext([stock], contractConcepts),
      { preference: "轮动回流" },
      null,
      { blockedConcepts: [], blockedTicketTypes: [], blockedSetups: [] },
    );
  };

  const unverifiedDailyHeight = scoreRoleEligibility(false);
  assert.notStrictEqual(
    unverifiedDailyHeight.ticketType,
    "情绪龙头票",
    "只有 dailyHeight/session、没有核心身份验证的票，不得被包装成情绪龙头票",
  );
  assert.notStrictEqual(
    unverifiedDailyHeight.setup,
    "核心打板/分歧转强",
    "只有当日高度不能直接得到核心打板/分歧转强方案",
  );
  assert.strictEqual(
    unverifiedDailyHeight.selected,
    false,
    "即使分数、题材、热榜和其他门槛均满足，也不能仅凭裸 role=龙头入选",
  );

  const verifiedCoreDailyHeight = scoreRoleEligibility(true);
  assert.strictEqual(
    verifiedCoreDailyHeight.ticketType,
    "情绪龙头票",
    "核心身份验证通过后，才可恢复情绪龙头票资格",
  );
  assert.strictEqual(
    verifiedCoreDailyHeight.setup,
    "核心打板/分歧转强",
    "核心身份验证通过且其他门槛满足时，可恢复核心方案",
  );
  assert.strictEqual(
    verifiedCoreDailyHeight.selected,
    true,
    "核心身份验证通过且其他门槛满足时，候选才可入选",
  );
}

const cacheFile = path.join(__dirname, ".hot-stocks-cache.json");
if (!fs.existsSync(cacheFile)) {
  console.log("跳过:无 .hot-stocks-cache.json(需先真实抓取一次)");
  process.exit(0);
}
const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
// 主动模拟当日故障(不依赖缓存本身缺不缺数据,保证测试确定性):
//   ①K线全部抓取失败(剥离 klineProfile) ②板块行情抓取失败(sectorRows=[])
const rows = (cache.candidates || [])
  .filter((s) => s.name) // 数据质量闸:残缺行(无名)剔除
  // leadership 是由K线、分时和硬门槛共同派生的结果；模拟K线故障时必须一并清掉，
  // 否则会把“旧领导力资格”和“当前无K线评分”混在一起，制造不存在的回放矛盾。
  .map((s) => ({ ...s, klineProfile: null, leadership: null }));
const brokenRows = (cache.candidates || []).filter((s) => !s.name);
const snapshot = cache.market.snapshot;
const limitStats = cache.market.limitStats || null;
const externalRisk = cache.market.externalRisk || null;
const sectorRows = []; // 故障模拟:板块行情抓取失败

console.log("=== 选股链路回放(真实缓存:" + String(cache.updatedAt).slice(0, 10) + ") ===");
console.log(`样本:候选${(cache.candidates || []).length}只(残缺${brokenRows.length}只已剔除),原入选${(cache.selected || []).length}只`);

// 1. 方向聚合:不再出现"未归类"伪方向;同链条题材聚成一簇
const hotConcepts = clusterHotConcepts(conceptStats(rows, sectorRows, snapshot).slice(0, 20), rows).slice(0, 10);
assert(!hotConcepts.some((c) => c.name === "未归类"), "未归类不许作为方向");
assert(hotConcepts.length > 0, "应聚合出具体方向");
assert(hotConcepts.every((c) => c.resonance === null), "板块行情缺失时共振应为null(未验证),不是false");
console.log(`✓ 方向聚合:${hotConcepts.length}个方向,第一方向「${hotConcepts[0].displayName}」`);

// 1b. 题材聚类不变式(缓存每日更新,不锁定具体板块名):
//   ①任意两个簇不得共享概念名(归并必须彻底)
//   ②共享一只涨停票只代表个股概念交叉，不再强迫不同产业族合并；用确定性样本验证同族合并与跨族隔离
{
  const seen = new Map();
  for (const c of hotConcepts) for (const n of c.matchNames) {
    assert(!seen.has(n), `概念「${n}」出现在两个簇(${seen.get(n)}/${c.name}),归并不彻底`);
    seen.set(n, c.name);
  }
  const limitCodes = (concept) => new Set(rows.filter((s) => (s.concepts || []).includes(concept) && (s.changePct >= 9.5 || /连板|首板/.test(s.popularity || ""))).map((s) => s.code));
  let crossThemeSharedLimitPairs = 0;
  for (const a of seen.keys()) for (const b of seen.keys()) {
    if (a >= b) continue;
    const shared = [...limitCodes(a)].filter((x) => limitCodes(b).has(x));
    if (shared.length && seen.get(a) !== seen.get(b)) crossThemeSharedLimitPairs += 1;
  }
  const aiRows = [
    { code: "AI-A", name: "AI-A", concepts: ["存储芯片", "共封装光学(CPO)"], changePct: 10, price: 10, amountYi: 10, popularity: "首板" },
    { code: "AI-B", name: "AI-B", concepts: ["存储芯片"], changePct: 5, price: 8, amountYi: 8 },
    { code: "AI-C", name: "AI-C", concepts: ["共封装光学(CPO)"], changePct: 4, price: 7, amountYi: 7 },
  ];
  const aiClusters = clusterHotConcepts(conceptStats(aiRows, [], snapshot), aiRows);
  const aiFamily = aiClusters.find((c) => c.family === "AI算力");
  assert(aiFamily && aiFamily.name === "AI算力", "AI家族必须用家族名展示，不能把家族统计冠到CPO头上");
  assert(aiFamily.matchNames.includes("存储芯片") && aiFamily.matchNames.includes("共封装光学(CPO)"), "同属AI算力链的概念必须保留家族关系");
  const storageSubtheme = aiFamily.subthemeCandidates.find((row) => row.name === "存储芯片");
  const cpoSubtheme = aiFamily.subthemeCandidates.find((row) => row.name === "共封装光学(CPO)");
  assert.equal(aiFamily.count, 3, "家族统计可以覆盖三只AI样本");
  assert.equal(storageSubtheme.count, 2, "存储细分只能统计精确存储成员");
  assert.equal(cpoSubtheme.count, 2, "CPO细分只能统计精确CPO成员");

  const protectedRows = [
    { code: "P-A", name: "P-A", concepts: ["军工", "共封装光学(CPO)"], changePct: 10, price: 10, amountYi: 10, popularity: "首板" },
    { code: "P-B", name: "P-B", concepts: ["军工"], changePct: 5, price: 8, amountYi: 8 },
    { code: "P-C", name: "P-C", concepts: ["共封装光学(CPO)"], changePct: 4, price: 7, amountYi: 7 },
  ];
  const protectedClusters = clusterHotConcepts(conceptStats(protectedRows, [], snapshot), protectedRows);
  const militaryCluster = protectedClusters.find((c) => c.matchNames.includes("军工"));
  const aiCluster = protectedClusters.find((c) => c.matchNames.includes("共封装光学(CPO)"));
  assert(militaryCluster && aiCluster && militaryCluster !== aiCluster, "跨保护产业族即使共享涨停成员也不得强制合并");
  const merged = hotConcepts.filter((c) => c.aliases.length);
  console.log(`✓ 题材聚类不变式通过;跨题材共享涨停对${crossThemeSharedLimitPairs}组仅作交叉标记;归并簇${merged.length}个:${merged.map((c) => c.displayName).join(" | ") || "今日无可归并链条"}`);
}

// 2. 周期与仓位:高位分歧仓位必须下调,不许维持70%-100%
const marketState = classifyMarket(snapshot, hotConcepts, externalRisk, limitStats);
console.log(`  周期=${marketState.cycle}·${marketState.subPhase} 操作=${marketState.operation} 仓位=${marketState.position}`);
if (marketState.cycle === "主升" && marketState.subPhase === "高位分歧") {
  assert(marketState.position === "30%-50%", `高位分歧仓位应为30%-50%,实际${marketState.position}`);
  assert(marketState.operation === "减仓防守", `高位分歧操作应为减仓防守,实际${marketState.operation}`);
  console.log("✓ 高位分歧:仓位 70%-100% → 30%-50%,操作 进攻 → 减仓防守");
}

// 3. 风险栏:共振null(无法验证)不许拉黑方向
const riskBoard = buildRiskBoard(marketState, hotConcepts, externalRisk);
assert(riskBoard.blockedConcepts.length === 0, `板块数据缺失时风险栏不应拉黑方向,实际拉黑:${riskBoard.blockedConcepts.join(",")}`);
console.log("✓ 风险栏:板块行情缺失 → 不再把全部方向标成一日游拉黑");

// 4. 打分与入选:缺K线软标待补,主升周期应有票入选
const contexts = roleContext(rows, hotConcepts);
const tradingStyle = classifyTradingStyle(marketState, hotConcepts, rows);
const scored = rows.map((s) => scoreCandidate(s, hotConcepts, marketState, contexts, tradingStyle, externalRisk, riskBoard));
const selected = scored.filter((s) => s.selected).sort((a, b) => b.score - a.score);
const klineRejects = scored.filter((s) => (s.rejects || []).some((r) => r.includes("缺K线")));
assert(klineRejects.length === 0, "缺K线不许再作为剔除理由");
// 入选数量按周期检验:主升必须有票(数据缺失不许清零);冰点/退潮少选零选是纪律,不是bug
if (marketState.cycle === "主升") {
  assert(selected.length > 0, "主升周期用同一份数据必须有票入选");
}
console.log(`✓ 缺K线硬拒清零;${marketState.cycle}周期入选 ${selected.length} 只:`);
for (const s of selected.slice(0, 8)) {
  console.log(`   ${s.name}(${s.code}) 分${s.score} ${s.mainConcept} ${s.role} [${s.setup}]${(s.reasons || []).some((r) => r.includes("K线数据缺失")) ? " ⚠️K线待补" : ""}`);
}

// 4b. 归簇不变式:每只票的 mainConcept 必须是其概念所属簇的主名(不被第一个标签拆走)
for (const s of scored) {
  if (!(s.concepts || []).length) continue;
  const cluster = hotConcepts.find((c) => c.matchNames.some((n) => s.concepts.includes(n)));
  if (cluster) assert(s.mainConcept === cluster.name, `${s.name} 应归入「${cluster.name}」簇,实际=${s.mainConcept}`);
}
const multiLeaderClusters = hotConcepts
  .map((c) => ({ name: c.displayName, leaders: scored.filter((s) => s.mainConcept === c.name && s.role === "龙头") }))
  .filter((x) => x.leaders.length > 1);
console.log(`✓ 归簇不变式通过;龙头梯队(多核方向):${multiLeaderClusters.map((x) => `${x.name.slice(0, 14)}→${x.leaders.map((l) => l.name).join("/")}`).join(" | ") || "今日各方向单龙头"}`);

// 4c. 明日最优解:只有关键数据契约完整时才出1-3张卡；主升也允许宁缺毋滥
const topicBoard = buildTopicBoard(hotConcepts, scored, marketState, externalRisk);
const bestPicks = buildBestPicks(scored, topicBoard, marketState);
if (marketState.cycle === "主升") {
  if (bestPicks.available) {
    assert(bestPicks.picks.length >= 1 && bestPicks.picks.length <= 3, "主升期有完整机会时最多给3张最优解卡");
  } else {
    assert(bestPicks.note && bestPicks.note.length > 4, "主升期关键数据不完整时必须明确空结果原因");
  }
} else if (!bestPicks.available) {
  assert(bestPicks.note && bestPicks.note.length > 4, "无最优解时必须说明原因(宁缺勿滥要说人话)");
}
assert(bestPicks.picks.length <= 3, "最优解最多3张卡");
for (const p of bestPicks.picks) {
  assert(p.why.length >= 2, `${p.name} 必须给出为什么是它`);
  assert(p.sell.hardStop && Array.isArray(p.sell.hardStop.pctRange), `${p.name} 必须带硬止损档位`);
  if (p.price) assert(p.sell.hardStop.priceRange && p.sell.hardStop.priceRange[0] > 0, `${p.name} 有现价时硬止损必须换算成具体价格`);
}
assert(bestPicks.note.includes("高位分歧") === (marketState.subPhase === "高位分歧"), "高位分歧必须在最优解顶部警示");
console.log(`✓ 明日最优解:${bestPicks.picks.map((p) => `${p.slotLabel}·${p.name}${p.price ? "@" + p.price : ""}`).join(" | ")}`);
console.log(`  提示:${bestPicks.note}`);

// 4d. 活口栏:板块被杀跌时的逆势强票;不变式验证(不锁定具体票,数据每天变)
const survivorBoard = buildSurvivorBoard(hotConcepts, scored, marketState, limitStats);
assert(typeof survivorBoard.divergenceDay === "boolean" && survivorBoard.envNote, "活口栏必须给出分歧日判定与环境说明");
for (const it of survivorBoard.items) {
  assert(it.edge >= 4, `${it.name} 活口逆势强度必须≥4pt,实际${it.edge}`);
  assert(it.limitUp || it.changePct >= 2, `${it.name} 活口必须真涨停或涨幅≥2%`);
  assert(it.reason.includes("活"), `${it.name} 必须带人话理由`);
}
console.log(`✓ 活口栏:${survivorBoard.divergenceDay ? "大分歧日" : "非分歧日"},活口${survivorBoard.items.length}只${survivorBoard.items.length ? ":" + survivorBoard.items.map((i) => `${i.name}(${i.concept.slice(0, 8)}…它${i.changePct >= 0 ? "+" : ""}${i.changePct}%/基准${i.basePct}%)`).join(" | ") : "(板块没被杀跌或无幸存者,不硬凑)"}`);

// 4e. 明日预期:分歧衰减信号→情景A/B+验证+动作(不变式,不锁定具体倾向——数据每天变)
const outlook = buildTomorrowOutlook(scored, marketState, limitStats, snapshot, survivorBoard);
assert(["偏回流", "偏延续", "均衡", "常规"].includes(outlook.bias), `bias 非法:${outlook.bias}`);
assert(outlook.signals.length === 4, "必须输出4个衰减信号(跌停/高标负反馈/抢先手/承接)");
for (const s of outlook.signals) {
  assert([true, false, null].includes(s.ok) && s.note, `信号${s.name}必须给出事实依据或明示数据缺失`);
}
const expectedScenarioCount = outlook.chaosDivergence && outlook.chaosDivergence.blockTomorrowReflow
  ? 3
  : outlook.inDivergence
    ? 2
    : 1;
assert(outlook.scenarios.length === expectedScenarioCount, `剧本数量应与环境分支一致，预期${expectedScenarioCount}个、实际${outlook.scenarios.length}个`);
for (const sc of outlook.scenarios) {
  assert(sc.verify.length >= 2 && sc.action.length > 10, `${sc.name} 必须带验证信号与具体动作`);
}
if (outlook.inDivergence && !(outlook.chaosDivergence && outlook.chaosDivergence.blockTomorrowReflow)) {
  assert(outlook.scenarios[0].action.includes("双共振") || outlook.scenarios[0].action.includes("活口"), "回流情景动作必须落到 活口/核心/老龙头 与双共振买点");
  assert(outlook.scenarios[1].action.includes("冰点") || outlook.scenarios[1].action.includes("买点前置"), "延续情景必须体现买点前置/冰点日博弈规则");
}
const hb = highBoardFeedback(scored);
assert(hb.total >= 0 && (hb.hitRatio === null || (hb.hitRatio >= 0 && hb.hitRatio <= 100)), "高标负反馈口径合法");
console.log(`✓ 明日预期:${outlook.bias}(${outlook.biasNote.slice(0, 40)}…)`);
console.log(`  信号:${outlook.signals.map((s) => (s.ok === true ? "✓" : s.ok === false ? "✗" : "⚠️") + s.name).join(" ")}${outlook.prevArchiveDate ? " | 昨日归档:" + outlook.prevArchiveDate : " | 无昨日归档"}`);

// 5. 抓取状态:失败源必须被点名
const fetchStatus = buildFetchStatus({
  eastRank: new Array(cache.sources.eastmoney || 0), thsRows: new Array(cache.sources.ths || 0),
  brokenRows, klineOk: rows.filter((s) => s.klineProfile).length, total: rows.length,
  unclassified: rows.filter((s) => !(s.concepts || []).length).length,
  sectorRows, marketSnapshot: snapshot, limitStats, externalSnapshot: { available: false },
});
assert(fetchStatus.level !== "ok", "多源失败时状态不许是ok");
assert(fetchStatus.items.some((i) => !i.ok && i.name === "K线/均线"), "K线失败必须被点名");
assert(fetchStatus.items.some((i) => !i.ok && i.name === "板块行情"), "板块行情失败必须被点名");
console.log(`✓ 抓取状态:${fetchStatus.label}`);
console.log(`  明细:${fetchStatus.items.map((i) => (i.ok ? "✓" : "✗") + i.name).join(" ")}`);

console.log("\n全部回放断言通过 ✅");
