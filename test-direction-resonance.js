"use strict";

const assert = require("assert");
const { _internals } = require("./server");

const { classifyDirectionResonance, buildRiskBoard, coreWatchConceptTags, estimateTurnoverFromFloatCap, applyRepairCoreRetention } = _internals;

console.log("=== 方向分层与核心活口测试 ===");

{
  const state = classifyDirectionResonance({
    sector: { name: "存储芯片", changePct: -0.55 },
    indexChange: -2.24,
    count: 22,
    limitCount: 5,
    avgChangePct: 0.8,
    upRate: 0.59,
    downRate: 0.32,
    strongCount: 7,
  });
  assert.strictEqual(state.resonance, true);
  assert.strictEqual(state.resonanceType, "relative");
  assert.strictEqual(state.resonanceLabel, "相对抗跌共振");
  assert.strictEqual(state.isCoreDirection, true);
  assert.strictEqual(state.repairKey, "active");
  console.log("✓ 板块仍下跌但显著强于指数且内部有赚钱梯队，识别为相对抗跌共振");
}

{
  const directionState = classifyDirectionResonance({
    sector: { name: "核心方向", changePct: -3.2 },
    indexChange: -1,
    count: 12,
    limitCount: 2,
    avgChangePct: -2.8,
    upRate: 0.2,
    downRate: 0.75,
    strongCount: 2,
  });
  const concept = {
    name: "核心方向",
    count: 12,
    limitCount: 2,
    resonance: directionState.resonance,
    isCoreDirection: directionState.isCoreDirection,
    directionState,
  };
  const risk = buildRiskBoard({ cycle: "混沌" }, [concept], { level: "低风险" });
  assert.strictEqual(directionState.dailyKey, "loss");
  assert.strictEqual(directionState.isCoreDirection, true);
  assert(!risk.blockedConcepts.includes("核心方向"), "核心方向单日亏钱不能被当成一日游硬删除");
  assert(risk.items.some((item) => item.name === "核心方向" && item.blocked === false));
  console.log("✓ 核心方向的单日亏钱效应保留为风险观察，不再硬拉黑整个方向");
}

{
  const directionState = classifyDirectionResonance({
    sector: { name: "普通题材", changePct: -2.5 },
    indexChange: -0.5,
    count: 3,
    limitCount: 0,
    avgChangePct: -2.2,
    upRate: 0,
    downRate: 1,
    strongCount: 0,
  });
  const risk = buildRiskBoard({ cycle: "混沌" }, [{
    name: "普通题材",
    count: 3,
    limitCount: 0,
    resonance: directionState.resonance,
    isCoreDirection: directionState.isCoreDirection,
    directionState,
  }], { level: "低风险" });
  assert(risk.blockedConcepts.includes("普通题材"));
  console.log("✓ 普通弱题材仍按持续性不足过滤，核心例外不会扩散成普遍放行");
}

{
  const tags = coreWatchConceptTags({
    mainConcept: "AI算力 / 存储芯片（含先进封装/算力租赁）",
  });
  assert.deepStrictEqual(tags.slice(0, 2), ["AI算力", "存储芯片"]);
  console.log("✓ 留存核心可从历史方向还原标准概念标签，供每日重抓重新注入方向池");
}

{
  const turnover = estimateTurnoverFromFloatCap({
    open: 190,
    close: 197,
    high: 200,
    low: 188,
    amount: 3.35e9,
  }, {
    price: 197,
    floatMktCapYi: 59.8,
  }, 197);
  assert.ok(turnover > 50 && turnover < 60, `估算换手应接近真实57%，实际${turnover}`);
  console.log("✓ 腾讯备用K线缺历史换手时，可由流通盘与成交额稳定还原换手口径");
}

{
  const candidate = {
    code: "301583",
    name: "托伦斯",
    setup: "剔除",
    selected: false,
    rejects: [
      "普通热度方向未形成相对强度或内部修复，暂不提取价值",
      "不在东方财富/同花顺热度榜，仅场外观察、不入围核心标的池",
      "原交易硬门槛未通过：量比不足",
    ],
    reasons: [],
    leadership: { repairCoreQualified: true },
  };
  applyRepairCoreRetention([candidate]);
  assert.strictEqual(candidate.selected, false, "保留观察不等于自动买入");
  assert.strictEqual(candidate.setup, "核心活口·次日验证");
  assert(candidate.rejects.some((item) => item.includes("量比不足")), "真正的交易硬门槛必须保留");
  assert(!candidate.rejects.some((item) => item.includes("热度榜")), "核心活口不因暂时掉出热榜消失");
  console.log("✓ 核心活口只移除方向/热榜误杀，真实硬门槛仍保留且不自动生成买点");
}

console.log("方向分层与核心活口测试全部通过");
