"use strict";

const assert = require("assert");
const { buildMarketStrengthSource } = require("./market-strength-source");

function stock(index, {
  gap = 0,
  intraday = 0,
  core = false,
  proactive = false,
  concept = "存储芯片",
  amountYi = 30 + index,
} = {}) {
  const prevClose = 100;
  const open = prevClose * (1 + gap / 100);
  const price = open * (1 + intraday / 100);
  const high = Math.max(open, price) * (1 + (Math.abs(intraday) > 3 ? 0.01 : 0.002));
  const low = Math.min(open, price) * (1 - (Math.abs(intraday) > 3 ? 0.01 : 0.002));
  return {
    code: String(600000 + index),
    name: `样本${index}`,
    prevClose,
    open,
    high,
    low,
    price,
    changePct: ((price - prevClose) / prevClose) * 100,
    amountYi,
    mainConcept: concept,
    selected: index % 2 === 0,
    score: 70 - index,
    leadership: core ? {
      identity: proactive ? "核心活口/修复发起者" : "情绪/历史核心",
      coreIdentityQualified: true,
      initiative: {
        score: proactive ? 82 : 48,
        proactive,
      },
    } : null,
  };
}

function payload(candidates, options = {}) {
  const externalChange = options.externalChange == null ? 0.2 : options.externalChange;
  return {
    updatedAt: "2026-07-31T08:00:00.000Z",
    market: {
      snapshot: { breadth: options.breadth == null ? 0.5 : options.breadth },
      state: {
        cycle: options.cycle || "混沌",
        structuralCycle: options.cycle || "混沌",
        structuralResolution: options.structuralResolution || null,
        effectAttribution: {
          profitMap: {
            groups: [{
              key: "oversold-repair",
              title: "低位超跌 / 破位修复",
              status: "mixed",
              summary: "超跌修复有表现，持续性待确认。",
              items: candidates.slice(0, 3).map((item) => ({
                code: item.code,
                name: item.name,
                concept: item.mainConcept,
                changePct: item.changePct,
                typeLabel: "超跌修复",
              })),
            }],
          },
        },
      },
      externalRisk: {
        indexes: [
          { code: "NDX", name: "纳斯达克", changePct: externalChange },
          { code: "SPX", name: "标普500", changePct: externalChange / 2 },
        ],
      },
    },
    usFramework: {
      techQuotes: Array.from({ length: 6 }, (_, index) => ({
        symbol: `EXT${index}`,
        name: index === 0 ? "SK海力士" : index === 1 ? "三星电子" : `外围核心${index}`,
        market: index < 2 ? "韩国" : "美国",
        theme: "半导体",
        changePct: externalChange,
        quoteAvailable: true,
      })),
    },
    candidates,
    marketEmotion: { tradingDate: "2026-07-31" },
  };
}

console.log("=== 上涨来源与内循环转化测试 ===");

{
  const candidates = Array.from({ length: 12 }, (_, index) => stock(index, {
    gap: 2.5,
    intraday: index < 2 ? -0.4 : -2,
    core: index < 4,
    proactive: index === 0,
  }));
  const input = payload(candidates, { externalChange: 2.6, breadth: 0.44 });
  const before = JSON.stringify(input.candidates);
  const result = buildMarketStrengthSource(input);
  assert.strictEqual(result.source.key, "external-unconverted", "外围高开后兑现必须判为未转成内循环");
  assert.strictEqual(result.conversion.key, "failed", "高开兑现应明确标记转化失败");
  assert.ok(["new-entrant-loss", "holder-profit-only"].includes(result.entrantProfit.key), "当日买盘不能误写主动赚钱");
  assert.strictEqual(result.cycleRead.label, "禁止周期升级", "外围刺激未转化不得升级周期");
  assert.strictEqual(result.flowNature.key, "profit-taking", "高开后回落但相对昨收未恐慌破位时应识别为兑现");
  assert.strictEqual(JSON.stringify(input.candidates), before, "分析层不得修改候选股票数据");
  console.log("✓ 外围刺激 + 高开兑现：不升级周期");
}

{
  const largeFades = Array.from({ length: 10 }, (_, index) => stock(index, {
    gap: 8,
    intraday: -6 - index * 0.1,
    core: index < 6,
    amountYi: 180 - index * 5,
  }));
  const smallWinners = Array.from({ length: 20 }, (_, index) => stock(index + 20, {
    gap: 0.5,
    intraday: 7 + index * 0.05,
    core: false,
    amountYi: 5 + index * 0.1,
  }));
  const result = buildMarketStrengthSource(payload([...largeFades, ...smallWinners], {
    externalChange: 2.8,
    breadth: 0.82,
    cycle: "主升",
    structuralResolution: { changed: true, previousCycle: "修复", cycle: "主升" },
  }));
  assert.ok(result.metrics.medianOpenToClosePct > 0, "普通样本应被小票上涨推成正中位数，用于复现旧误判");
  assert.ok(result.metrics.top10WeightedOpenToClosePct < -5, "成交额前10名必须识别出真实追高亏损");
  assert.strictEqual(result.hardVeto.active, true, "核心容量成片高开低走必须触发硬否决");
  assert.strictEqual(result.entrantProfit.key, "new-entrant-loss", "普通样本上涨不能掩盖核心新进资金亏损");
  assert.strictEqual(result.source.key, "external-unconverted", "外围高开且容量核心兑现必须判为未转化");
  assert.strictEqual(result.conversion.label, "内生接力失败");
  assert.strictEqual(result.cycleRead.label, "撤销“主升”升级", "修复日不能因表面普涨直接升级主升");
  assert.strictEqual(result.cycleRead.displayCycle, "修复观察");
  console.log("✓ 小票普涨 + 核心容量兑现：硬否决主升与内生接力");
}

{
  const candidates = Array.from({ length: 12 }, (_, index) => stock(index, {
    gap: -0.5,
    intraday: -6 - index * 0.1,
    core: index < 8,
    amountYi: 100 - index,
  }));
  const result = buildMarketStrengthSource(payload(candidates, { externalChange: -2.8, breadth: 0.22 }));
  assert.strictEqual(result.flowNature.key, "panic-exit", "低开后核心容量继续放量收低且市场广度恶化应识别为恐慌出逃");
  assert.strictEqual(result.source.key, "domestic-core-fade");
  console.log("✓ 高开兑现与恐慌出逃：按日内路径和市场广度分开");
}

{
  const candidates = Array.from({ length: 12 }, (_, index) => stock(index, {
    gap: 0.2,
    intraday: 2.2 + index * 0.05,
    core: index < 4,
    proactive: index < 3,
  }));
  const result = buildMarketStrengthSource(payload(candidates, { externalChange: 0.3, breadth: 0.7 }));
  assert.strictEqual(result.source.key, "internal-active", "无外围强刺激、盘中广泛走强应判A股内生主动");
  assert.strictEqual(result.entrantProfit.key, "active-profit", "开盘买入者普遍盈利应判主动赚钱");
  assert.strictEqual(result.conversion.key, "converted", "主动核心、广度与当日买盘共同成立应通过内循环");
  assert.strictEqual(result.cycleRead.label, "形成主升候选证据", "只新增候选证据，不直接改写基础周期");
  console.log("✓ A股盘中主动扩散：识别内生上涨");
}

{
  const candidates = Array.from({ length: 12 }, (_, index) => stock(index, {
    gap: 1.8,
    intraday: 1.5 + index * 0.04,
    core: index < 4,
    proactive: index < 3,
  }));
  const result = buildMarketStrengthSource(payload(candidates, { externalChange: 2.4, breadth: 0.68 }));
  assert.strictEqual(result.source.key, "external-converted", "外围点火后A股继续承接应判内外共振转化");
  assert.strictEqual(result.conversion.key, "converted");
  assert.strictEqual(result.entrantProfit.key, "active-profit");
  assert.ok(result.style.references.length > 0, "赚钱风格必须带具体标的证据");
  console.log("✓ 外围点火 + A股接力：识别内外共振转化");
}

console.log("上涨来源与内循环转化测试全部通过 ✅");
