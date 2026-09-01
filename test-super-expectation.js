"use strict";

const assert = require("assert");
const {
  SUPER_EXPECTATION_VERSION,
  buildCandidateStage,
  buildSuperExpectationRadar,
  classifyExpectationPath,
  classifyPreviousDayState,
  reportedBoardHeight,
} = require("./super-expectation");
const { buildPreviousLimitUpSeeds } = require("./quant-decision/limit-up-pullback-repair");

function leadership(overrides = {}) {
  return {
    coreIdentityQualified: true,
    persistentRecognition: true,
    identity: "主动型容量龙头",
    levelLabel: "方向核心",
    impactScore: 62,
    structure: {
      frameworkIntact: true,
      overextended: false,
      breakdown: false,
    },
    history: {
      appearances: 4,
      coreHits: 3,
      activeHits: 2,
    },
    initiative: {
      score: 76,
      proactive: true,
      capacity: true,
      retentionPct: 78,
      dataQuality: "分时验证",
      priceDiscovery: {
        noPriceDiscovery: false,
      },
    },
    ...overrides,
  };
}

function stock(code, name, overrides = {}) {
  return {
    code,
    name,
    price: 10,
    prevClose: 10,
    changePct: 2,
    amountYi: 35,
    turnoverRate: 12,
    mainConcept: "新能源",
    mainFamily: "新能源",
    concepts: ["新能源"],
    role: "龙头",
    popularity: "首板",
    leadership: leadership(),
    ...overrides,
  };
}

function supportingPeers() {
  return [
    stock("000002", "方向中军", {
      price: 10.5,
      changePct: 5,
      role: "中军",
      popularity: "",
      leadership: leadership({
        identity: "主动容量核心",
        impactScore: 45,
      }),
    }),
    stock("000003", "方向核心二", {
      price: 10.3,
      changePct: 3,
      popularity: "",
      leadership: leadership({
        identity: "情绪核心",
        initiative: {
          score: 65,
          proactive: true,
          capacity: false,
          retentionPct: 70,
          dataQuality: "分时验证",
          priceDiscovery: { noPriceDiscovery: false },
        },
      }),
    }),
    stock("000004", "方向跟随", {
      price: 10.2,
      changePct: 2,
      role: "补涨",
      popularity: "",
      leadership: {
        coreIdentityQualified: false,
        persistentRecognition: false,
        initiative: { score: 30, proactive: false, capacity: false, priceDiscovery: { noPriceDiscovery: false } },
      },
    }),
  ];
}

function supportingPeersFor(direction) {
  return supportingPeers().map((item) => ({
    ...item,
    mainConcept: direction,
    mainFamily: direction,
    concepts: [direction],
  }));
}

function payload(candidates, overrides = {}) {
  return {
    fetchedAt: "2026-07-27T15:10:00+08:00",
    candidates,
    topicBoard: {
      mainLine: {
        name: "新能源",
        family: "新能源",
        matchNames: ["新能源"],
      },
    },
    hotConcepts: [{ name: "新能源", family: "新能源" }],
    market: {
      state: { cycle: "混沌", subPhase: "分歧修复" },
      limitStats: { dates: { today: "2026-07-27", prev: "2026-07-24" } },
    },
    marketEmotion: { light: "yellow", quality: "分化修复" },
    ...overrides,
  };
}

function archiveFor(candidate, date = "2026-07-27") {
  return {
    date,
    payload: {
      superExpectation: {
        version: SUPER_EXPECTATION_VERSION,
        tradingDate: date,
        candidates: [candidate],
      },
    },
  };
}

function nextTradingDayPayload(candidates, overrides = {}) {
  return payload(candidates, {
    fetchedAt: "2026-07-28T10:10:00+08:00",
    market: {
      state: { cycle: "混沌", subPhase: "修复增强" },
      limitStats: { dates: { today: "2026-07-28", prev: "2026-07-27", verified: true } },
    },
    marketEmotion: { light: "green", quality: "赚钱效应扩散" },
    ...overrides,
  });
}

console.log("=== 超预期两阶段测试 ===");

// 1. 炸板标签不应丢失此前连板高度，否则会把高位断板误判为普通炸板。
{
  const row = stock("000001", "高度核心", { popularity: "6连板炸板" });
  assert.strictEqual(reportedBoardHeight(row), 6);
  console.log("✓ 炸板后仍保留此前连板高度");
}

// 2. 只有核心、负面预期、板块支撑同时通过，才进入明日候选池。
let frozenCandidate;
{
  const leader = stock("000001", "高度核心", {
    price: 9.7,
    changePct: -3,
    popularity: "6连板断板",
  });
  const ordinary = stock("000009", "普通形态票", {
    price: 9.7,
    changePct: -3,
    popularity: "5连板断板",
    leadership: {
      coreIdentityQualified: false,
      persistentRecognition: false,
      initiative: { score: 35, proactive: false, capacity: false, priceDiscovery: { noPriceDiscovery: false } },
    },
  });
  const model = buildCandidateStage(payload([leader, ordinary, ...supportingPeers()]));
  assert.strictEqual(model.candidates.length, 1);
  assert.strictEqual(model.candidates[0].code, "000001");
  assert.strictEqual(model.candidates[0].today.patternLabel, "6板高位炸板/断板");
  assert(model.candidates[0].baseline.expectedOpenRangePct[1] < 0, "应冻结次日偏弱的正常预期");
  assert(!model.candidates.some((row) => row.code === "000009"), "普通形态票不得混入");
  assert(model.rejected.length >= 2, "未入选的已识别核心必须保留明细");
  assert(model.rejected.every((row) => row.gates.length === 3 && Array.isArray(row.fails) && row.fails.length), "每只未入选核心必须说明三道门槛和具体原因");
  frozenCandidate = model.candidates[0];
  console.log("✓ 明日候选严格执行三道门槛，未入选核心保留逐只原因");
}

// 3. 非当前主线的高位情绪核心可以进入预期差观察，但只靠连板标签的伪核心不行。
{
  const emotionLeader = stock("001258", "轮动情绪核心", {
    price: 13.03,
    prevClose: 12.11,
    changePct: 7.6,
    amountYi: 27.1,
    turnoverRate: 22.08,
    mainConcept: "绿色电力",
    mainFamily: "绿色电力",
    concepts: ["绿色电力"],
    popularity: "7天6板断板",
    leadership: leadership({
      coreIdentityQualified: false,
      recognized: true,
      identity: "情绪/历史核心",
      impactScore: 0,
      history: { appearances: 3, coreHits: 2, activeHits: 0 },
      initiative: {
        score: 60,
        proactive: true,
        capacity: false,
        retentionPct: null,
        dataQuality: "收盘代理",
        priceDiscovery: { noPriceDiscovery: false, suspectedOneWord: false },
        session: {
          tradingDate: "2026-07-27",
          openChangePct: 2.5,
          currentChangePct: 7.6,
          maxChangePct: 10,
          minChangePct: 1.8,
          intradayRangePct: 8.2,
          limitTouched: true,
          firstLimitTime: "10:08",
          limitOpenCount: 1,
          closedAtLimit: false,
        },
      },
    }),
  });
  const tagOnly = stock("000815", "标签伪核心", {
    price: 16.13,
    prevClose: 15.73,
    changePct: 2.5,
    amountYi: null,
    turnoverRate: null,
    mainConcept: "绿色电力",
    mainFamily: "绿色电力",
    concepts: ["绿色电力"],
    popularity: "6天4板",
    leadership: leadership({
      coreIdentityQualified: true,
      recognized: true,
      identity: "历史情绪核心",
      impactScore: 0,
      history: { appearances: 2, coreHits: 2, activeHits: 1 },
      initiative: {
        score: 15,
        proactive: false,
        capacity: false,
        retentionPct: null,
        dataQuality: "收盘代理",
        priceDiscovery: { noPriceDiscovery: false, suspectedOneWord: false },
      },
    }),
  });
  const model = buildCandidateStage(payload([emotionLeader, tagOnly], {
    hotConcepts: [{ name: "绿色电力", family: "绿色电力" }],
  }));
  assert(model.candidates.some((row) => row.code === "001258"), "真实高位情绪核心应保留观察资格");
  assert(!model.candidates.some((row) => row.code === "000815"), "缺主动性和真实成交证据的标签票不得入选");
  console.log("✓ 轮动情绪核心与连板标签伪核心已分开");
}

// 4. 次日平开转强、主动进攻且板块同步时，确认超预期并分别生成持仓/空仓动作。
{
  const currentLeader = stock("000001", "高度核心", {
    price: 10.67,
    prevClose: 9.7,
    changePct: 10,
    popularity: "首板",
    leadership: leadership({
      impactScore: 78,
      initiative: {
        score: 88,
        proactive: true,
        capacity: true,
        retentionPct: 92,
        dataQuality: "分时验证",
        priceDiscovery: { noPriceDiscovery: false },
        session: {
          openChangePct: 0,
          currentChangePct: 10,
          maxChangePct: 10,
          minChangePct: -0.5,
          intradayRangePct: 10.5,
          firstRedMinute: 571,
          firstRedTime: "09:31",
        },
      },
    }),
  });
  const today = payload([currentLeader, ...supportingPeers()], {
    fetchedAt: "2026-07-28T10:10:00+08:00",
    market: {
      state: { cycle: "混沌", subPhase: "修复增强" },
      limitStats: { dates: { today: "2026-07-28", prev: "2026-07-27" } },
    },
    marketEmotion: { light: "green", quality: "赚钱效应扩散" },
  });
  const previousArchive = archiveFor(frozenCandidate);
  const model = buildSuperExpectationRadar(today, previousArchive);
  const validation = model.validationStage.validations[0];
  assert.strictEqual(validation.status, "confirmed");
  assert.strictEqual(validation.nature.key, "turn");
  assert(/持有/.test(validation.holder.action));
  assert(validation.outsider.routes.length > 0);
  assert(validation.checks.find((row) => row.label === "竞价超过正常预期").passed);
  assert(validation.checks.find((row) => row.label === "板块核心同步确认").passed);
  console.log("✓ 次日确认后分别给出持仓与空仓执行路径");
}

// 5. 只有个股强、板块不跟时不能确认，只能按修复观察。
{
  const isolated = stock("000001", "孤立强势核心", {
    price: 10.67,
    prevClose: 9.7,
    changePct: 10,
    popularity: "首板",
    leadership: leadership({
      initiative: {
        score: 88,
        proactive: true,
        capacity: true,
        retentionPct: 90,
        dataQuality: "分时验证",
        priceDiscovery: { noPriceDiscovery: false },
        session: {
          openChangePct: 0,
          currentChangePct: 10,
          maxChangePct: 10,
          minChangePct: -0.3,
          firstRedMinute: 571,
          firstRedTime: "09:31",
        },
      },
    }),
  });
  const previousArchive = archiveFor(frozenCandidate);
  const model = buildSuperExpectationRadar(nextTradingDayPayload([isolated]), previousArchive);
  const validation = model.validationStage.validations[0];
  assert.notStrictEqual(validation.status, "confirmed");
  assert.strictEqual(validation.nature.key, "repair");
  assert(/不追|等待|观察/.test(validation.outsider.action));
  console.log("✓ 孤立强势不升级为确认超预期");
}

// 6. 分时接口失败时可用开高低收降级验证，但必须同时具备板块响应、真实换手和历史地位。
{
  const quoteFallback = stock("000001", "行情降级核心", {
    price: 10.67,
    prevClose: 9.7,
    open: 9.7,
    high: 10.67,
    low: 9.65,
    changePct: 10,
    turnoverRate: 10,
    popularity: "首板",
    leadership: leadership({
      initiative: {
        score: 56,
        proactive: false,
        capacity: false,
        retentionPct: null,
        dataQuality: "收盘代理",
        priceDiscovery: { noPriceDiscovery: false },
        session: null,
      },
    }),
  });
  const previousArchive = archiveFor(frozenCandidate);
  const model = buildSuperExpectationRadar(nextTradingDayPayload([quoteFallback, ...supportingPeers()]), previousArchive);
  const validation = model.validationStage.validations[0];
  assert.strictEqual(validation.status, "confirmed");
  assert.strictEqual(validation.comparison.actualOpenPct, 0);
  assert(validation.checks.find((row) => row.label === "个股保持主动性").value.includes("收盘代理"));
  console.log("✓ 分时失败时使用开高低收严格降级，不因缺接口丢失真实超预期");
}

// 7. 同样是炸板下跌，必须区分被大盘/板块拖累的被动弱与个股独立走坏的主动弱。
{
  const weakPeers = [
    stock("000012", "弱市板块核心一", { changePct: -3.5, popularity: "", role: "中军" }),
    stock("000013", "弱市板块核心二", { changePct: -2.8, popularity: "", role: "龙头" }),
  ];
  const weakMarket = {
    snapshot: { avgIndexChange: -1.25, breadth: 0.26 },
    state: {
      cycle: "混沌",
      subPhase: "负反馈扩散",
      dailyState: { key: "retreat_candidate", label: "负反馈扩散·退潮候选" },
      profitEffect: { score: 24 },
      lossEffect: { score: 76 },
    },
    limitStats: { dates: { today: "2026-07-27", prev: "2026-07-24" } },
  };
  const passive = stock("000010", "被动炸板核心", {
    price: 9.6,
    changePct: -4,
    popularity: "4连板炸板",
    leadership: leadership({
      initiative: {
        score: 61,
        proactive: false,
        capacity: true,
        relativeStrength: -0.5,
        peerMedianChangePct: -3.2,
        retentionPct: 58,
        dataQuality: "分时验证",
        priceDiscovery: { noPriceDiscovery: false },
      },
    }),
  });
  const active = stock("000011", "主动走弱核心", {
    price: 9.4,
    changePct: -6,
    popularity: "4连板炸板",
    leadership: leadership({
      structure: {
        frameworkIntact: false,
        overextended: false,
        breakdown: true,
      },
      initiative: {
        score: 32,
        proactive: false,
        capacity: true,
        relativeStrength: -4,
        peerMedianChangePct: -2,
        retentionPct: 22,
        dataQuality: "分时验证",
        priceDiscovery: { noPriceDiscovery: false },
      },
    }),
  });
  const model = buildCandidateStage(payload([passive, active, ...weakPeers], { market: weakMarket }));
  const passiveCandidate = model.candidates.find((row) => row.code === "000010");
  const activeRejected = model.rejected.find((row) => row.code === "000011");
  assert(passiveCandidate, "被大盘和板块拖累、但没有独立走坏的核心应进入弱转强候选");
  assert.strictEqual(passiveCandidate.today.strengthNatureKey, "passive_weak");
  assert.strictEqual(passiveCandidate.baseline.routeKey, "weak_to_strong");
  assert(activeRejected, "个股独立走坏必须保留在未入选明细");
  assert(activeRejected.gates.find((gate) => gate.key === "expectation").note.includes("主动弱"));
  console.log("✓ 被动弱与主动弱已按相对强度、承接和结构分开");
}

// 8. 市场/板块弱而核心逆势抗跌时，走强上加强路线；普通翻红不能再算超预期。
let resilientCandidate;
{
  const weakPeers = [
    stock("000022", "板块核心一", { changePct: -3.2, popularity: "", role: "中军" }),
    stock("000023", "板块核心二", { changePct: -2.4, popularity: "", role: "龙头" }),
  ];
  const resilient = stock("000021", "弱市抗跌核心", {
    price: 10.25,
    changePct: 2.5,
    popularity: "",
    leadership: leadership({
      initiative: {
        score: 78,
        proactive: true,
        capacity: true,
        relativeStrength: 5.3,
        peerMedianChangePct: -2.8,
        retentionPct: 76,
        dataQuality: "分时验证",
        priceDiscovery: { noPriceDiscovery: false },
      },
    }),
  });
  const weakMarket = {
    snapshot: { avgIndexChange: -1.1, breadth: 0.3 },
    state: {
      cycle: "混沌",
      subPhase: "弱势分化",
      dailyState: { key: "retreat_candidate", label: "负反馈扩散·退潮候选" },
      profitEffect: { score: 30 },
      lossEffect: { score: 70 },
    },
    limitStats: { dates: { today: "2026-07-27", prev: "2026-07-24" } },
  };
  const model = buildCandidateStage(payload([resilient, ...weakPeers], { market: weakMarket }));
  resilientCandidate = model.candidates.find((row) => row.code === "000021");
  assert(resilientCandidate, "弱市抗跌且结构完整的核心应进入候选");
  assert.strictEqual(resilientCandidate.today.strengthNatureKey, "weak_market_resilient");
  assert.strictEqual(resilientCandidate.baseline.routeKey, "strong_on_strong");
  assert(resilientCandidate.baseline.overExpectedOpenPct >= 4, "强转强不能用普通红开作为确认线");
  console.log("✓ 弱市抗跌核心进入强转强路线，并抬高次日确认基线");
}

// 9. 强转强必须同时接住高开、保持主动并获得板块响应；高开低走不能确认。
{
  const strongCurrent = stock("000021", "弱市抗跌核心", {
    price: 10.85,
    prevClose: 10.25,
    open: 10.66,
    high: 10.97,
    low: 10.6,
    changePct: 5.9,
    leadership: leadership({
      impactScore: 78,
      initiative: {
        score: 86,
        proactive: true,
        capacity: true,
        relativeStrength: 3.5,
        peerMedianChangePct: 2.4,
        retentionPct: 74,
        dataQuality: "分时验证",
        priceDiscovery: { noPriceDiscovery: false },
        session: {
          openChangePct: 4,
          currentChangePct: 5.9,
          maxChangePct: 7,
          minChangePct: 3.4,
          intradayRangePct: 3.6,
          firstRedMinute: 570,
          firstRedTime: "09:30",
        },
      },
    }),
  });
  const previousArchive = archiveFor(resilientCandidate);
  const confirmedModel = buildSuperExpectationRadar(nextTradingDayPayload([strongCurrent, ...supportingPeers()]), previousArchive);
  const confirmed = confirmedModel.validationStage.validations[0];
  assert.strictEqual(confirmed.status, "confirmed");
  assert.strictEqual(confirmed.nature.key, "strengthening");
  assert(confirmed.checks.find((row) => row.label === "高开后守住强势区").passed);

  const faded = stock("000021", "弱市抗跌核心", {
    price: 10.3,
    prevClose: 10.25,
    open: 10.66,
    high: 10.87,
    low: 10.2,
    changePct: 0.5,
    leadership: leadership({
      initiative: {
        score: 72,
        proactive: true,
        capacity: true,
        relativeStrength: 1,
        peerMedianChangePct: -0.5,
        retentionPct: 18,
        dataQuality: "分时验证",
        priceDiscovery: { noPriceDiscovery: false },
        session: {
          openChangePct: 4,
          currentChangePct: 0.5,
          maxChangePct: 6,
          minChangePct: -0.5,
          intradayRangePct: 6.5,
          firstRedMinute: 570,
          firstRedTime: "09:30",
        },
      },
    }),
  });
  const fadedModel = buildSuperExpectationRadar(nextTradingDayPayload([faded, ...supportingPeers()]), previousArchive);
  const fadedValidation = fadedModel.validationStage.validations[0];
  assert.notStrictEqual(fadedValidation.status, "confirmed");
  assert.strictEqual(fadedValidation.checks.find((row) => row.label === "高开后守住强势区").passed, false);
  console.log("✓ 强转强要求高开、承接、主动性和板块响应共同成立");
}

// 10. 有研新材：早盘从低位主动拉板后稳定封住，全天大振幅不能冒充烂板分歧。
{
  const direction = "PCB概念";
  const youyan = stock("600206", "有研新材", {
    price: 48.17,
    prevClose: 43.79,
    changePct: 10,
    mainConcept: direction,
    mainFamily: direction,
    concepts: [direction],
    popularity: "3连板",
    leadership: leadership({
      impactScore: 74,
      initiative: {
        score: 98,
        proactive: true,
        capacity: true,
        relativeStrength: 5.4,
        peerMedianChangePct: 4.6,
        retentionPct: 100,
        dataQuality: "分时验证",
        priceDiscovery: { noPriceDiscovery: false },
        session: {
          tradingDate: "2026-08-06",
          openChangePct: 5,
          currentChangePct: 10,
          maxChangePct: 10,
          minChangePct: 2.3,
          intradayRangePct: 7.7,
          limitTouched: true,
          firstLimitTime: "09:38",
          limitOpenCount: 0,
          longestOpenMinutes: 0,
          resealedAfterOpen: false,
          closedAtLimit: true,
          finalSealMinutes: 232,
        },
      },
    }),
  });
  const testPayload = payload([youyan, ...supportingPeersFor(direction)], {
    topicBoard: { mainLine: { name: direction, family: direction, matchNames: [direction] } },
    hotConcepts: [{ name: direction, family: direction }],
    market: {
      state: { cycle: "主升", subPhase: "上升加强" },
      limitStats: { dates: { today: "2026-08-06", prev: "2026-08-05", verified: true } },
    },
  });
  const state = classifyPreviousDayState(youyan, testPayload);
  const model = buildCandidateStage(testPayload);
  assert.strictEqual(state.key, "stable_strong");
  assert.strictEqual(state.label, "正常强势延续");
  assert(!model.candidates.some((row) => row.code === "600206"), "正常强势不能伪装成弱转强候选");
  assert.strictEqual(model.rejected.find((row) => row.code === "600206").today.strengthNatureKey, "stable_strong");
  console.log("✓ 有研新材式主动稳定封板归正常强势，不再被全天振幅误判为烂板");
}

// 11. 利通电子：历史3板标签不是紧邻T-1的断板事实，普通跟随弱不能继承旧弱转强资格。
{
  const direction = "PCB概念";
  const litong = stock("603629", "利通电子", {
    price: 127.4,
    prevClose: 122.52,
    changePct: 3.98,
    mainConcept: direction,
    mainFamily: direction,
    concepts: [direction],
    popularity: "3连板",
    leadership: leadership({
      initiative: {
        score: 65,
        proactive: false,
        capacity: true,
        relativeStrength: -0.6,
        peerMedianChangePct: 4.6,
        retentionPct: 62,
        dataQuality: "分时验证",
        priceDiscovery: { noPriceDiscovery: false },
        session: {
          tradingDate: "2026-08-07",
          openChangePct: -0.2,
          currentChangePct: 3.98,
          maxChangePct: 6.02,
          minChangePct: -2.1,
          intradayRangePct: 8.12,
          limitTouched: false,
          firstLimitTime: null,
          limitOpenCount: 0,
          closedAtLimit: false,
        },
      },
    }),
  });
  const testPayload = payload([litong, ...supportingPeersFor(direction)], {
    topicBoard: { mainLine: { name: direction, family: direction, matchNames: [direction] } },
    hotConcepts: [{ name: direction, family: direction }],
    market: {
      state: { cycle: "主升", subPhase: "分歧" },
      limitStats: { dates: { today: "2026-08-07", prev: "2026-08-06", verified: true } },
    },
  });
  const state = classifyPreviousDayState(litong, testPayload);
  const model = buildCandidateStage(testPayload);
  assert.strictEqual(state.key, "no_clear_state");
  assert(!model.candidates.some((row) => row.code === "603629"));
  assert(!model.rejected.find((row) => row.code === "603629").gates.find((gate) => gate.key === "expectation").passed);
  console.log("✓ 利通电子式历史板高不再跨日冒充T-1断板，普通跟随弱直接排除");
}

// 12. 哈药股份：前期龙头连续上涨后，紧邻T-1大阴分歧且结构未坏，可冻结弱转强基线。
let hayaoCandidate;
{
  const direction = "创新药";
  const hayao = stock("600664", "哈药股份", {
    price: 6.22,
    prevClose: 6.9,
    changePct: -9.86,
    amountYi: 18,
    turnoverRate: 10.7,
    mainConcept: direction,
    mainFamily: direction,
    concepts: [direction],
    popularity: "",
    role: "前期龙头",
    klineProfile: {
      rise10: 68,
      rise20: 105,
      pctFromHigh: 10,
      nearHigh20: true,
    },
    leadership: leadership({
      coreIdentityQualified: false,
      recognized: true,
      persistentRecognition: true,
      identity: "历史情绪核心",
      impactScore: 68,
      history: { appearances: 6, coreHits: 4, activeHits: 3 },
      structure: { frameworkIntact: true, overextended: false, breakdown: false },
      initiative: {
        score: 52,
        proactive: false,
        capacity: false,
        relativeStrength: 0.4,
        peerMedianChangePct: -10.2,
        retentionPct: 42,
        dataQuality: "分时验证",
        priceDiscovery: { noPriceDiscovery: false },
        session: {
          tradingDate: "2026-08-06",
          openChangePct: -1,
          currentChangePct: -9.86,
          maxChangePct: 0.5,
          minChangePct: -10,
          intradayRangePct: 10.5,
          limitTouched: false,
          firstLimitTime: null,
          limitOpenCount: 0,
          closedAtLimit: false,
        },
      },
    }),
  });
  const peers = supportingPeersFor(direction).map((item, index) => ({
    ...item,
    changePct: index === 0 ? -8.5 : index === 1 ? -6.2 : -3,
  }));
  const testPayload = payload([hayao, ...peers], {
    topicBoard: { mainLine: { name: direction, family: direction, matchNames: [direction] } },
    hotConcepts: [{ name: direction, family: direction, sector: { changePct: -4.2 } }],
    market: {
      state: { cycle: "主升", subPhase: "主升分歧" },
      limitStats: { dates: { today: "2026-08-06", prev: "2026-08-05", verified: true } },
    },
  });
  const state = classifyPreviousDayState(hayao, testPayload);
  const model = buildCandidateStage(testPayload);
  hayaoCandidate = model.candidates.find((row) => row.code === "600664");
  assert.strictEqual(state.pattern.key, "core_bearish_divergence");
  assert(hayaoCandidate, "前期龙头大阴分歧且结构未坏，应保留弱转强观察资格");
  assert.strictEqual(hayaoCandidate.baseline.routeKey, "weak_to_strong");
  assert.strictEqual(hayaoCandidate.today.patternLabel, "前期龙头大阴分歧");
  console.log("✓ 哈药股份式前期龙头大阴分歧进入弱转强，身份不再依赖当日连板标签");
}

// 13. 云南锗业：主升分歧中炸板后秒回封仍属强，次日明显高开验证的是强转强。
let yunnanCandidate;
{
  const direction = "稀有金属";
  const yunnan = stock("002428", "云南锗业", {
    price: 90.98,
    prevClose: 82.71,
    changePct: 10,
    amountYi: 70.6,
    turnoverRate: 11.97,
    mainConcept: direction,
    mainFamily: direction,
    concepts: [direction],
    popularity: "首板",
    leadership: leadership({
      impactScore: 76,
      initiative: {
        score: 88,
        proactive: true,
        capacity: true,
        relativeStrength: 5.7,
        peerMedianChangePct: 4.3,
        retentionPct: 100,
        dataQuality: "分时验证",
        priceDiscovery: { noPriceDiscovery: false },
        session: {
          tradingDate: "2026-08-06",
          openChangePct: 7.6,
          currentChangePct: 10,
          maxChangePct: 10,
          minChangePct: 6.4,
          intradayRangePct: 3.6,
          limitTouched: true,
          firstLimitTime: "09:31",
          limitOpenCount: 1,
          longestOpenMinutes: 2,
          lastResealTime: "09:34",
          resealedAfterOpen: true,
          closedAtLimit: true,
          finalSealMinutes: 236,
        },
      },
    }),
  });
  const testPayload = payload([yunnan, ...supportingPeersFor(direction)], {
    topicBoard: { mainLine: { name: direction, family: direction, matchNames: [direction] } },
    hotConcepts: [{ name: direction, family: direction, sector: { changePct: 3.2 } }],
    market: {
      state: { cycle: "主升", subPhase: "主升分歧" },
      limitStats: { dates: { today: "2026-08-06", prev: "2026-08-05", verified: true } },
    },
  });
  const state = classifyPreviousDayState(yunnan, testPayload);
  const model = buildCandidateStage(testPayload);
  yunnanCandidate = model.candidates.find((row) => row.code === "002428");
  assert.strictEqual(state.key, "strong_reseal");
  assert(yunnanCandidate, "主升分歧中的快速回封核心应进入强转强观察");
  assert.strictEqual(yunnanCandidate.baseline.routeKey, "strong_on_strong");
  assert.strictEqual(yunnanCandidate.baseline.routeLabel, "强转强路线");
  assert.deepStrictEqual(yunnanCandidate.baseline.expectedOpenRangePct, [2.5, 5]);
  assert.strictEqual(yunnanCandidate.baseline.overExpectedOpenPct, 6);

  const current = stock("002428", "云南锗业", {
    price: 100.08,
    prevClose: 90.98,
    open: 97.35,
    high: 100.08,
    low: 97.1,
    changePct: 10,
    amountYi: 78,
    turnoverRate: 12,
    mainConcept: direction,
    mainFamily: direction,
    concepts: [direction],
    popularity: "2连板",
    leadership: leadership({
      impactScore: 82,
      initiative: {
        score: 90,
        proactive: true,
        capacity: true,
        relativeStrength: 5.2,
        peerMedianChangePct: 4.8,
        retentionPct: 100,
        dataQuality: "分时验证",
        priceDiscovery: { noPriceDiscovery: false },
        session: {
          tradingDate: "2026-08-07",
          openChangePct: 7,
          currentChangePct: 10,
          maxChangePct: 10,
          minChangePct: 6.7,
          intradayRangePct: 3.3,
          firstRedMinute: 570,
          firstRedTime: "09:30",
        },
      },
    }),
  });
  const nextPayload = payload([current, ...supportingPeersFor(direction)], {
    fetchedAt: "2026-08-07T10:10:00+08:00",
    topicBoard: { mainLine: { name: direction, family: direction, matchNames: [direction] } },
    hotConcepts: [{ name: direction, family: direction, sector: { changePct: 4.1 } }],
    market: {
      state: { cycle: "主升", subPhase: "回流加强" },
      limitStats: { dates: { today: "2026-08-07", prev: "2026-08-06", verified: true } },
    },
    marketEmotion: { light: "green", quality: "主线回流" },
  });
  const validation = buildSuperExpectationRadar(nextPayload, archiveFor(yunnanCandidate, "2026-08-06"))
    .validationStage.validations[0];
  assert.strictEqual(validation.status, "confirmed");
  assert.strictEqual(validation.comparison.actualOpenPct, 7);
  assert.strictEqual(validation.comparison.routeLabel, "强转强路线");
  console.log("✓ 云南锗业式主升分歧秒回封走强转强，+7%竞价可完成路线确认");
}

// 14. 超预期基线只对紧邻下一交易日有效，T-2旧候选必须自动过期。
{
  const staleCandidate = {
    ...hayaoCandidate,
    baseline: {
      ...hayaoCandidate.baseline,
      sourceTradeDate: "2026-08-05",
    },
  };
  const currentPayload = payload([], {
    market: {
      state: { cycle: "主升", subPhase: "主升分歧" },
      limitStats: { dates: { today: "2026-08-07", prev: "2026-08-06", verified: true } },
    },
  });
  const model = buildSuperExpectationRadar(currentPayload, archiveFor(staleCandidate, "2026-08-05"));
  assert.strictEqual(model.validationStage.validations.length, 0);
  assert.strictEqual(model.counts.expired, 1);
  console.log("✓ T-2旧候选自动过期，只验证紧邻上一交易日冻结的基线");
}

// 15. 精确T-1收盘涨停后的回撤只建立待纠偏弱基线，不直接授予买点。
function previousLimitUpPullback(code, overrides = {}) {
  return stock(code, `前板回撤${code}`, {
    price: 9.8,
    prevClose: 10,
    changePct: -2,
    popularity: "",
    previousLimitUpOnly: true,
    previousLimitUpEvidence: {
      verified: true,
      tradingDate: "2026-07-24",
      closedAtLimit: true,
      priceDiscoveryVerified: true,
    },
    leadership: leadership({
      initiative: {
        score: 54,
        proactive: false,
        capacity: true,
        relativeStrength: 0,
        peerMedianChangePct: -2,
        retentionPct: 58,
        dataQuality: "分时验证",
        priceDiscovery: { noPriceDiscovery: false },
      },
    }),
    ...overrides,
  });
}

{
  const pullback = previousLimitUpPullback("000031");
  const testPayload = payload([pullback, ...supportingPeers()]);
  const state = classifyPreviousDayState(pullback, testPayload);
  const expectation = classifyExpectationPath(pullback, testPayload);
  const model = buildCandidateStage(testPayload);
  const candidate = model.candidates.find((row) => row.code === "000031");

  assert.strictEqual(state.key, "weak_baseline");
  assert.strictEqual(state.pattern.key, "limit_up_pullback_repair");
  assert.strictEqual(state.pattern.label, "前板回撤·待纠偏");
  assert.strictEqual(expectation.qualified, true);
  assert.strictEqual(expectation.routeKey, "weak_to_strong");
  assert(candidate, "精确前板、T日收跌且结构未破坏时应建立弱转强观察基线");
  assert.strictEqual(candidate.today.patternKey, "limit_up_pullback_repair");
  assert.strictEqual(candidate.candidateState, "弱转强路线·待验证");
  assert.match(candidate.baseline.normalPath, /不能因前一日涨停直接当作买点/);
  assert(candidate.nextDayChecks.length >= 4, "前板回撤仍须经过次日竞价、承接、主动性与板块确认");
  console.log("✓ 精确前板回撤只建立待纠偏弱基线，仍保留次日确认门槛");
}

// 16. 错日、缺证据、非收盘涨停、一字板、结构破坏或T日未收跌均不得进入前板回撤模式。
{
  const wrongDate = previousLimitUpPullback("000032", {
    previousLimitUpEvidence: {
      verified: true,
      tradingDate: "2026-07-23",
      closedAtLimit: true,
      priceDiscoveryVerified: true,
    },
  });
  const missingEvidence = previousLimitUpPullback("000033");
  delete missingEvidence.previousLimitUpEvidence;
  const touchedOnly = previousLimitUpPullback("000034", {
    previousLimitUpEvidence: {
      verified: true,
      tradingDate: "2026-07-24",
      closedAtLimit: false,
      priceDiscoveryVerified: true,
    },
  });
  const oneWord = previousLimitUpPullback("000035", {
    previousLimitUpEvidence: {
      verified: true,
      tradingDate: "2026-07-24",
      closedAtLimit: true,
      priceDiscoveryVerified: false,
      suspectedOneWord: true,
    },
  });
  const brokenStructure = previousLimitUpPullback("000036", {
    leadership: leadership({
      structure: { frameworkIntact: false, overextended: false, breakdown: true },
      initiative: {
        score: 35,
        proactive: false,
        capacity: true,
        relativeStrength: -3,
        peerMedianChangePct: -1,
        retentionPct: 20,
        dataQuality: "分时验证",
        priceDiscovery: { noPriceDiscovery: false },
      },
    }),
  });
  const notDown = previousLimitUpPullback("000037", { changePct: 0 });

  [wrongDate, missingEvidence, touchedOnly, oneWord, brokenStructure, notDown].forEach((row) => {
    const state = classifyPreviousDayState(row, payload([row, ...supportingPeers()]));
    assert.notStrictEqual(
      state.pattern && state.pattern.key,
      "limit_up_pullback_repair",
      `${row.code}不满足完整证据链，不得进入前板回撤模式`,
    );
  });
  console.log("✓ 前板回撤模式对错日、缺证据、一字板和结构破坏严格失败关闭");
}

// 17. 前板回撤事实不能绕过主动弱淘汰；弱环境同步回撤才标记为被动弱待纠偏。
{
  const activeWeak = previousLimitUpPullback("000038", {
    changePct: -4,
    leadership: leadership({
      initiative: {
        score: 30,
        proactive: false,
        capacity: true,
        relativeStrength: -4,
        peerMedianChangePct: -1,
        retentionPct: 20,
        dataQuality: "分时验证",
        priceDiscovery: { noPriceDiscovery: false },
      },
    }),
  });
  const activePayload = payload([activeWeak, ...supportingPeers()]);
  const activeExpectation = classifyExpectationPath(activeWeak, activePayload);
  const activeModel = buildCandidateStage(activePayload);
  assert.strictEqual(activeExpectation.key, "active_weak");
  assert.strictEqual(activeExpectation.qualified, false);
  assert(!activeModel.candidates.some((row) => row.code === "000038"), "主动走坏不能凭前板身份进入候选");

  const passiveWeak = previousLimitUpPullback("000039", {
    changePct: -4,
    leadership: leadership({
      initiative: {
        score: 50,
        proactive: false,
        capacity: true,
        relativeStrength: -0.2,
        peerMedianChangePct: -3.8,
        retentionPct: 58,
        dataQuality: "分时验证",
        priceDiscovery: { noPriceDiscovery: false },
      },
    }),
  });
  const weakMarket = {
    snapshot: { avgIndexChange: -1.1, breadth: 0.3 },
    state: {
      cycle: "混沌",
      subPhase: "负反馈扩散",
      dailyState: { key: "retreat_candidate", label: "负反馈扩散·退潮候选" },
      profitEffect: { score: 28 },
      lossEffect: { score: 72 },
    },
    limitStats: { dates: { today: "2026-07-27", prev: "2026-07-24", verified: true } },
  };
  const passivePayload = payload([passiveWeak, ...supportingPeers()], { market: weakMarket });
  const passiveExpectation = classifyExpectationPath(passiveWeak, passivePayload);
  assert.strictEqual(passiveExpectation.key, "passive_weak");
  assert.strictEqual(passiveExpectation.qualified, true);
  assert.strictEqual(passiveExpectation.patternKey, "limit_up_pullback_repair");
  assert.match(passiveExpectation.label, /等纠偏/);

  const escapeButPreferred = previousLimitUpPullback("000040", {
    flowNature: { key: "escape", confidence: 0.9, conflict: false },
  });
  const escapeExpectation = classifyExpectationPath(
    escapeButPreferred,
    payload([escapeButPreferred, ...supportingPeers()]),
  );
  assert.strictEqual(escapeExpectation.qualified, true);
  assert.strictEqual(escapeExpectation.patternKey, "limit_up_pullback_repair");
  assert.match(escapeExpectation.evidence.join("；"), /资金出逃仅作风险备注/);

  const realSeed = buildPreviousLimitUpSeeds({
    archiveMeta: { tradingDate: "2026-07-24", snapshotKind: "closing" },
    tradingDate: "2026-07-24",
    market: {
      limitStats: {
        dates: { today: "20260724" },
        pool: [{ code: "000041", name: "真实契约前板", highDays: "首板" }],
      },
    },
    candidates: [{
      code: "000041",
      klineProfile: {
        lastSession: {
          tradingDate: "2026-07-24",
          snapshotKind: "closing",
          verified: true,
          completed: true,
          oneWord: false,
          noPriceDiscovery: false,
        },
      },
    }],
  }, { expectedTradingDate: "2026-07-24" })[0];
  const realContractStock = previousLimitUpPullback("000041", {
    previousLimitUpEvidence: realSeed.previousLimitUpEvidence,
    flowNature: { key: "escape", confidence: 0.9, conflict: false },
  });
  const realContractState = classifyPreviousDayState(
    realContractStock,
    payload([realContractStock, ...supportingPeers()]),
  );
  const realContractExpectation = classifyExpectationPath(
    realContractStock,
    payload([realContractStock, ...supportingPeers()]),
  );
  assert.strictEqual(realContractState.pattern.key, "limit_up_pullback_repair");
  assert.strictEqual(realContractExpectation.qualified, true);
  console.log("✓ 前板回撤继续由统一路径区分主动弱淘汰与被动弱待纠偏");
}

console.log("=== 超预期两阶段测试全部通过 ===");
