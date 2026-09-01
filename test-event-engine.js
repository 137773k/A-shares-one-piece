"use strict";

const assert = require("assert");
const { buildEventInference, classifyCategory, classifyDirection } = require("./event-engine");

function stock(overrides = {}) {
  return {
    code: "300001",
    name: "算力核心",
    concepts: ["人工智能", "算力"],
    mainConcept: "人工智能",
    role: "龙头",
    ticketType: "容量票",
    amountYi: 85,
    changePct: 3.5,
    inBothSources: true,
    score: 120,
    klineProfile: {
      rise2: 4,
      rise10: 8,
      rise20: 12,
      rise30: 16,
      nearHigh20: false,
      newHigh: false,
      volumeBreakout: true,
      pctFromHigh: 8,
    },
    evidence: {
      checked: true,
      announcements: [],
      reports: [{ title: "AI算力需求驱动核心业务增长" }],
    },
    ...overrides,
  };
}

function market(overrides = {}) {
  return {
    market: {
      state: { cycle: "混沌", subPhase: "混沌", operation: "聚焦" },
      snapshot: { avgIndexChange: -0.2, breadth: 0.55, shszAmountYi: 13000 },
      tradingStyle: { topDirection: "人工智能", preference: "轮动回流" },
    },
    marketEmotion: { light: "yellow", score: 62, quality: "修复待确认" },
    ...overrides,
  };
}

console.log("=== event-engine 测试 ===");

// 1. 垃圾信息必须在评分前过滤，不能因为标题带AI就混进事件池。
let result = buildEventInference({
  newsItems: [
    { title: "AI圈新首富诞生", summary: "个人财富排名变化", time: "2026-07-19 09:00:00" },
    { title: "投资者继续看好中国AI", summary: "某机构人士表达信心", time: "2026-07-19 09:05:00" },
  ],
  candidates: [stock()],
  ...market(),
  now: "2026-07-19T10:00:00+08:00",
});
assert.strictEqual(result.qualifiedEvents.length, 0);
assert.strictEqual(result.watchEvents.length, 0);
assert.strictEqual(result.filteredCount, 2);
console.log("✓ 垃圾过滤:财富榜/泛观点不进入事件池");

// 2. 官方、日期明确、产业传导清晰的发布会可以进入核心事件。
result = buildEventInference({
  newsItems: [{
    title: "工信部宣布7月25日召开人工智能产业大会",
    summary: "工信部正式发布会议安排，将集中发布算力基础设施和人工智能产业政策。",
    time: "2026-07-19 09:00:00",
  }],
  candidates: [
    stock(),
    stock({ code: "300002", name: "AI中军", role: "中军", amountYi: 120, changePct: 2.2 }),
    stock({ code: "300003", name: "AI跟随", role: "补涨", amountYi: 35, changePct: 1.1 }),
  ],
  ...market(),
  now: "2026-07-19T10:00:00+08:00",
});
assert.strictEqual(result.qualifiedEvents.length, 1);
assert.strictEqual(result.qualifiedEvents[0].source.level, "A");
assert.ok(["E3", "E4"].includes(result.qualifiedEvents[0].importance.grade));
assert.strictEqual(result.qualifiedEvents[0].eventDate, "2026-07-25");
assert.ok(result.qualifiedEvents[0].anchors.items.length >= 2);
assert.ok(result.qualifiedEvents[0].anchors.items.length <= 5);
console.log("✓ 事件准入:官方+明确日期+真实映射→E3/E4核心事件");

// 3. 核心和板块已经大幅上涨、创新高时，必须识别为充分交易/兑现风险。
const crowded = [1, 2, 3, 4].map((index) => stock({
  code: `30000${index}`,
  name: `AI核心${index}`,
  role: index === 1 ? "龙头" : "中军",
  amountYi: 100 - index * 5,
  changePct: 7 - index,
  klineProfile: {
    rise2: 14,
    rise10: 35,
    rise20: 58,
    rise30: 70,
    nearHigh20: true,
    newHigh: true,
    volumeBreakout: true,
    pctFromHigh: 0,
  },
}));
result = buildEventInference({
  newsItems: [{
    title: "工信部宣布7月20日召开人工智能产业大会",
    summary: "将正式发布人工智能产业支持政策。",
    time: "2026-07-19 09:00:00",
  }],
  candidates: crowded,
  ...market(),
  now: "2026-07-19T10:00:00+08:00",
});
const crowdedEvent = result.qualifiedEvents[0];
assert.ok(crowdedEvent.pricing.score >= 70, `预期交易度应≥70，实际${crowdedEvent.pricing.score}`);
assert.ok(["P3", "P4", "P5"].includes(crowdedEvent.lifecycle.code));
assert.ok(["T0", "T1"].includes(crowdedEvent.trading.grade));
assert.ok(crowdedEvent.scenarios.some((item) => item.type === "cashout"));
console.log("✓ 预期交易度:高位扩散+临近落地→充分交易并防兑现");

// 4. 退潮/红灯里的正面事件只能是潜在催化，不能直接改变周期或升级成可执行买点。
result = buildEventInference({
  newsItems: [{
    title: "工信部发布人工智能产业支持政策",
    summary: "政策正式印发，支持算力基础设施建设。",
    time: "2026-07-19 09:00:00",
  }],
  candidates: [stock({ changePct: -4, amountYi: 25, role: "观察", inBothSources: false })],
  ...market({
    market: {
      state: { cycle: "退潮", subPhase: "退潮中期", operation: "防守" },
      snapshot: { avgIndexChange: -2.5, breadth: 0.18, shszAmountYi: 9000 },
      tradingStyle: { topDirection: "医药", preference: "防守" },
    },
    marketEmotion: { light: "red", score: 25, quality: "负反馈严重" },
  }),
  now: "2026-07-19T10:00:00+08:00",
});
const weakMarketEvent = result.qualifiedEvents[0];
assert.ok(["T0", "T1"].includes(weakMarketEvent.trading.grade));
assert.strictEqual(result.marketContext.cycle, "退潮");
assert.ok(weakMarketEvent.systemIntegration.marketNote.includes("不能改变周期"));
console.log("✓ 周期隔离:退潮正面事件只作潜在催化，不改周期");

// 5. 单条未核实媒体消息不能进入系统，只能观察。
result = buildEventInference({
  newsItems: [{
    title: "消息称某海外巨头或将发布新一代AI芯片",
    summary: "据知情人士透露，具体时间和产品参数尚未确认。",
    time: "2026-07-19 09:00:00",
  }],
  candidates: [stock()],
  ...market(),
  now: "2026-07-19T10:00:00+08:00",
});
assert.strictEqual(result.qualifiedEvents.length, 0);
assert.ok(result.watchEvents.length <= 1);
console.log("✓ 来源闸门:单条传闻不能进入现有决策系统");

// 6. 核心验证标的必须有流动性、行情数据和真实映射，最多保留5只。
result = buildEventInference({
  newsItems: [{
    title: "工信部发布人工智能产业支持政策",
    summary: "政策正式印发，支持算力基础设施建设。",
    time: "2026-07-19 09:00:00",
  }],
  candidates: [
    stock(),
    stock({ code: "300010", name: "无量概念股", amountYi: 0.8 }),
    stock({ code: "300011", name: "数据缺失股", klineProfile: null }),
    stock({ code: "300012", name: "医药无关股", concepts: ["创新药"], mainConcept: "创新药" }),
  ],
  ...market(),
  now: "2026-07-19T10:00:00+08:00",
});
const anchorNames = result.qualifiedEvents[0].anchors.items.map((item) => item.name);
assert.ok(anchorNames.includes("算力核心"));
assert.ok(!anchorNames.includes("无量概念股"));
assert.ok(!anchorNames.includes("数据缺失股"));
assert.ok(!anchorNames.includes("医药无关股"));
console.log("✓ 核心锚点:真实映射+流动性+完整数据硬门槛");

// 7. 正面产业事件没有任何合格A股验证锚点时，不能接入买入条件。
result = buildEventInference({
  newsItems: [{
    title: "工信部宣布7月25日召开人工智能产业大会",
    summary: "将正式发布人工智能产业支持政策。",
    time: "2026-07-19 09:00:00",
  }],
  candidates: [stock({ code: "300012", name: "医药无关股", concepts: ["创新药"], mainConcept: "创新药" })],
  ...market(),
  now: "2026-07-19T10:00:00+08:00",
});
assert.strictEqual(result.qualifiedEvents.length, 0);
assert.ok(result.watchEvents.length >= 1);
console.log("✓ 买入隔离:无合格A股锚点的正面事件只能观察");

// 8. 系统性负面事件可以进入风险提醒，但永远不能生成事件买点。
result = buildEventInference({
  newsItems: [{
    title: "韩国交易所宣布芯片股大跌触发熔断",
    summary: "半导体板块暴跌，市场风险快速扩散。",
    time: "2026-07-19 09:00:00",
  }],
  candidates: [],
  ...market(),
  now: "2026-07-19T10:00:00+08:00",
});
const riskEvent = result.qualifiedEvents[0];
assert.ok(riskEvent, "系统性风险应进入合格风险事件");
assert.strictEqual(riskEvent.systemIntegration.mode, "risk");
assert.ok(riskEvent.systemIntegration.entryGate.includes("只收紧"));
assert.ok(riskEvent.trading.label.includes("风险"));
assert.strictEqual(riskEvent.lifecycle.code, "P5");
assert.ok(riskEvent.scenarios.some((item) => item.type === "risk-spread"));
assert.ok(!riskEvent.scenarios.some((item) => item.type === "strengthen"));
console.log("✓ 风险隔离:负面系统事件只收紧买入权限，不给反向买点");

// 9. “发布/发布会”本身不是利好，战争、袭击、熔断和疫情必须优先识别为风险。
assert.strictEqual(classifyDirection("某国卫生部发布通报：非洲猪瘟疫情非常严峻").code, "negative");
assert.strictEqual(classifyDirection("公司发布普通说明").code, "neutral");
assert.strictEqual(classifyCategory("韩国股市大跌并触发熔断", null).code, "systemic");
assert.strictEqual(classifyCategory("美军空袭造成多人死亡", null).code, "systemic");
console.log("✓ 语义纠偏:发布不等于利好，战争/熔断/疫情优先判风险");

// 10. 事件辅助层遇到坏数据也必须降级为空结果，不能拖垮主抓取流程。
assert.doesNotThrow(() => {
  const malformed = buildEventInference({ newsItems: [null, 42, {}], candidates: [null], now: "invalid-date" });
  assert.strictEqual(malformed.version, "event-inference-v2");
  assert.strictEqual(malformed.qualifiedEvents.length, 0);
});
console.log("✓ 稳定隔离:坏消息数据不会拖垮主抓取流程");

// 11. 没有A股/资产传导渠道的系统性新闻不进入风险约束或观察池。
result = buildEventInference({
  newsItems: [{
    title: "某国卫生部发表通报：袭击造成多人死亡",
    summary: "当地卫生部公布最新伤亡数据。",
    time: "2026-07-19 09:00:00",
  }],
  candidates: [],
  ...market(),
  now: "2026-07-19T10:00:00+08:00",
});
assert.strictEqual(result.qualifiedEvents.length, 0);
assert.strictEqual(result.watchEvents.length, 0);
assert.ok(result.filtered.some((item) => item.reason.includes("传导路径")));
console.log("✓ 风险传导门槛:无A股/资产通道的伤亡新闻直接过滤");

// 12. 已落地较久的非风险事件进入P6衰减，不再被误判成潜伏期。
result = buildEventInference({
  newsItems: [{
    title: "工信部宣布7月10日召开人工智能产业大会",
    summary: "大会正式发布人工智能产业支持政策。",
    time: "2026-07-10 09:00:00",
  }],
  candidates: [stock()],
  ...market(),
  now: "2026-07-19T10:00:00+08:00",
});
assert.strictEqual(result.qualifiedEvents[0].lifecycle.code, "P6");
console.log("✓ 生命周期:落地较久的事件进入P6影响衰减");

// 13. 早报/晚报等消息拼盘不能被当成单一高分事件。
result = buildEventInference({
  newsItems: [{
    title: "早报",
    summary: "人工智能、半导体、创新药、原油等十条消息汇总，工信部宣布召开会议。",
    time: "2026-07-19 08:00:00",
  }],
  candidates: [stock()],
  ...market(),
  now: "2026-07-19T10:00:00+08:00",
});
assert.strictEqual(result.qualifiedEvents.length, 0);
assert.strictEqual(result.watchEvents.length, 0);
assert.strictEqual(result.filteredCount, 1);
console.log("✓ 聚合防误判:早报/晚报类消息拼盘在评分前过滤");

// 14. 未来重大事件必须独立输出并按落地日期排序，已发生事件不能再占据前排。
const lowAltitudeCore = stock({
  code: "300100",
  name: "低空核心",
  concepts: ["低空经济", "eVTOL"],
  mainConcept: "低空经济",
  evidence: {
    checked: true,
    announcements: [{ title: "低空经济订单落地公告" }],
    reports: [],
  },
});
result = buildEventInference({
  newsItems: [
    {
      title: "SpaceX星舰7月10日完成试飞",
      summary: "商业航天节点已经落地。",
      eventDate: "2026-07-10",
      source: "韭研公社时间轴",
      sourceProvider: "jiuyan",
      sourceGrade: 3,
      sourceGradeLabel: "三星/重点",
    },
    {
      title: "2026国际低空经济博览会",
      summary: "大会将于7月22日举行。",
      eventDate: "2026-07-22",
      source: "韭研公社时间轴",
      sourceProvider: "jiuyan",
      sourceGrade: 3,
      sourceGradeLabel: "三星/重点",
      themes: ["低空经济"],
    },
  ],
  candidates: [lowAltitudeCore],
  ...market(),
  now: "2026-07-19T10:00:00+08:00",
});
assert.strictEqual(result.futureMajorEvents[0].title, "2026国际低空经济博览会");
assert.ok(result.futureMajorEvents.every((event) => event.eventDate && event.daysUntil >= 0));
assert.ok(result.landedEvents.some((event) => event.title.includes("SpaceX")));
console.log("✓ 未来优先:未来重大节点单列，已落地事件转入复盘");

// 15. 未来事件要同时给出影响板块和动态验证股，且股票资格必须有明确状态。
const lowAltitudeEvent = result.futureMajorEvents[0];
assert.ok(lowAltitudeEvent.impact.sectors.includes("低空经济"));
assert.ok(lowAltitudeEvent.impactStocks.some((item) => item.name === "低空核心" && item.qualified));
assert.ok(lowAltitudeEvent.impact.transmissionPaths.some((item) => item.includes("适航") || item.includes("核心股")));
console.log("✓ 影响映射:未来事件输出板块、传导逻辑和合格验证股");

// 16. 宏观日历可以映射板块，但候选池没有真实受益股时不能硬塞固定股票名单。
result = buildEventInference({
  newsItems: [{
    title: "中国7月一年期、五年期LPR",
    summary: "7月20日公布最新报价。",
    eventDate: "2026-07-20",
    source: "韭研公社时间轴",
    sourceProvider: "jiuyan",
  }],
  candidates: [stock()],
  ...market(),
  now: "2026-07-19T10:00:00+08:00",
});
assert.ok(result.futureMajorEvents[0].impact.sectors.includes("银行"));
assert.strictEqual(result.futureMajorEvents[0].impactStocks.length, 0);
console.log("✓ 不硬凑股票:有板块映射但无真实候选时明确留空");

// 17. 产品涨价不能因为“涨价”两个字被误归为资源品。
result = buildEventInference({
  newsItems: [{
    title: "爱科赛博：测试电源等产品涨价5%-10%",
    summary: "7月20日起调整测试电源产品价格。",
    eventDate: "2026-07-20",
    source: "韭研公社时间轴",
    sourceProvider: "jiuyan",
  }],
  candidates: [stock({ code: "300200", name: "电源核心", concepts: ["电力电子", "储能"], mainConcept: "电力电子" })],
  ...market(),
  now: "2026-07-19T10:00:00+08:00",
});
assert.ok(result.futureMajorEvents[0].themes.includes("电力电子/储能"));
assert.ok(!result.futureMajorEvents[0].themes.includes("资源品"));
console.log("✓ 精准分类:产品涨价按产业归类，不再泛化成资源品");

// 18. 时间轴标记的未来上市/IPO节点属于可跟踪事件，不能被基础过滤器误删。
result = buildEventInference({
  newsItems: [{
    title: "长鑫预计7月上市",
    summary: "存储芯片公司预计于7月31日完成上市节点。",
    eventDate: "2026-07-31",
    source: "韭研公社时间轴",
    sourceProvider: "jiuyan",
    sourceGrade: 3,
    sourceGradeLabel: "三星/重点",
    themes: ["存储", "长鑫科技"],
  }],
  candidates: [stock({ code: "600001", name: "存储核心", concepts: ["存储芯片"], mainConcept: "存储芯片" })],
  ...market(),
  now: "2026-07-19T10:00:00+08:00",
});
assert.ok(result.futureMajorEvents.some((event) => event.title.includes("长鑫")));
console.log("✓ 未来节点准入:上市/IPO类重大日历事件不会被误删");

// 19. 同名的月度交割节点必须按日期分别保留，不能被标题聚类合并成一个事件。
result = buildEventInference({
  newsItems: [
    {
      title: "股指期货和股指期权交割日",
      summary: "中金所股指期货与股指期权合约按第三个星期五交割。",
      eventDate: "2026-08-21",
      source: "中国金融期货交易所交割规则",
      sourceProvider: "cffex-settlement-rule",
      sourceType: "official",
      sourceGrade: 3,
      sourceGradeLabel: "官方规则/资金节点",
      calendarRole: "short-term-risk",
      calendarKind: "market-structure",
    },
    {
      title: "股指期货和股指期权交割日",
      summary: "中金所股指期货与股指期权合约按第三个星期五交割。",
      eventDate: "2026-09-18",
      source: "中国金融期货交易所交割规则",
      sourceProvider: "cffex-settlement-rule",
      sourceType: "official",
      sourceGrade: 3,
      sourceGradeLabel: "官方规则/资金节点",
      calendarRole: "short-term-risk",
      calendarKind: "market-structure",
    },
  ],
  candidates: [],
  ...market(),
  now: "2026-07-19T10:00:00+08:00",
});
assert.strictEqual(result.futureMajorEvents.filter((event) => event.calendarKind === "market-structure").length, 2);
assert.ok(result.futureMajorEvents.every((event) => !event.eligibleForSystem));
assert.ok(result.futureMajorEvents.every((event) => event.systemIntegration.entryGate.includes("不直接生成买点")));
console.log("✓ 月度资金节点:不同日期分别保留，完整展示但不直接生成买点");

// 20. 美联储官方日历与专业时间轴同日互证后仍属于短线风险日历，不篡改周期或买点。
result = buildEventInference({
  newsItems: [
    {
      title: "美联储FOMC公布利率决议",
      summary: "政策声明对应北京时间7月30日凌晨，A股开盘验证全球风险偏好。",
      eventDate: "2026-07-30",
      source: "美国联邦储备委员会官方日历",
      sourceProvider: "federal-reserve-calendar",
      sourceType: "official",
      sourceGrade: 1,
      sourceGradeLabel: "官方/宏观重点",
      calendarRole: "short-term-risk",
      calendarKind: "monetary-policy",
      calendarMeta: { label: "美联储议息", watchItems: ["美元指数", "美债收益率"] },
    },
    {
      title: "美联储FOMC公布利率决议",
      summary: "7月30日公布利率决议。",
      eventDate: "2026-07-30",
      source: "韭研公社时间轴",
      sourceProvider: "jiuyan",
    },
  ],
  candidates: [stock()],
  ...market(),
  now: "2026-07-19T10:00:00+08:00",
});
const fomcRisk = result.futureMajorEvents.find((event) => event.calendarKind === "monetary-policy");
assert.ok(fomcRisk);
assert.strictEqual(fomcRisk.source.corroboration, 2);
assert.strictEqual(fomcRisk.eligibleForSystem, false);
assert.strictEqual(fomcRisk.calendarMeta.label, "美联储议息");
assert.ok(fomcRisk.systemIntegration.marketNote.includes("周期保持不变"));
console.log("✓ 宏观风险节点:多来源互证并保留细节，但不反向改写周期和买点");

console.log("\n全部测试通过 ✅");
