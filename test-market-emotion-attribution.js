"use strict";

const assert = require("assert");
const { _internals } = require("./server");

const { buildMarketEmotionObservation } = _internals;

function candidate(code, name, changePct, options = {}) {
  return {
    code,
    name,
    changePct,
    amountYi: options.amountYi == null ? 45 : options.amountYi,
    mainConcept: "存储芯片",
    mainFamily: "存储芯片",
    concept: "存储芯片",
    role: options.role || "观察",
    klineProfile: {
      rise10: options.rise10 == null ? 2 : options.rise10,
      rise20: options.rise20 == null ? 4 : options.rise20,
      pctFromHigh: options.pctFromHigh == null ? 8 : options.pctFromHigh,
      newHigh: false,
      nearHigh20: false,
    },
    leadership: {
      identity: options.identity || (options.oldCore ? "历史情绪核心" : "地位待确认"),
      levelLabel: options.identity || (options.oldCore ? "历史情绪核心" : "地位待确认"),
      tradeState: options.tradeState || "仅观察",
      coreQualified: Boolean(options.coreQualified),
      coreIdentityQualified: Boolean(options.coreIdentityQualified),
      tradeQualified: Boolean(options.tradeQualified),
      initiative: {
        score: options.initiativeScore == null ? 30 : options.initiativeScore,
        label: options.initiativeScore >= 60 ? "主动发起" : "主动性不足",
        dataQuality: "测试快照",
      },
      structure: {
        grade: "B",
        positionLabel: "中位承接",
        chipLabel: "筹码待验证",
      },
      history: options.oldCore
        ? {
          appearances: options.appearances == null ? 3 : options.appearances,
          coreHits: options.coreHits == null ? 2 : options.coreHits,
          activeHits: options.activeHits == null ? 1 : options.activeHits,
        }
        : { appearances: 0, coreHits: 0, activeHits: 0 },
    },
  };
}

function payload(candidates) {
  return {
    fetchedAt: "2099-01-15T15:05:00+08:00",
    candidates,
    selected: [],
    hotConcepts: [{ name: "存储芯片", family: "存储芯片" }],
    topicBoard: {
      mainLine: { name: "存储芯片", family: "存储芯片" },
    },
    market: {
      snapshot: {
        asOf: "2099-01-15T15:05:00+08:00",
        tradingDate: "2099-01-15",
        breadth: 0.62,
        avgIndexChange: 0.85,
        shszAmountYi: 20000,
      },
      state: {
        cycle: "混沌",
        dailyState: { key: "repair_strengthening" },
      },
      limitStats: {
        ztToday: 58,
        ztPrev: 45,
        dtToday: 5,
        dtPrev: 11,
      },
    },
  };
}

console.log("=== 市场情绪归因测试 ===");

{
  const preserved = candidate("600000", "盘前报价缺失样本", 0, {
    oldCore: true,
    initiativeScore: 75,
  });
  preserved.price = null;
  preserved.amountYi = null;
  preserved.leadership.initiative.session = {
    tradingDate: "2099-01-15",
    currentChangePct: 7.6,
  };
  const model = buildMarketEmotionObservation(payload([preserved]));
  const oldCore = model.structureEvidence.oldCore.items.find((item) => item.code === "600000");
  assert(oldCore);
  assert.strictEqual(oldCore.changePct, 7.6);
  assert(oldCore.evidenceTags.some((tag) => tag.includes("收盘验证")));
  console.log("✓ 盘前报价为空时沿用已验证收盘涨幅，不把核心误判成0%掉队");
}

{
  const model = buildMarketEmotionObservation(payload([
    candidate("600001", "超跌甲", 9.8, { rise10: -18, rise20: -24, pctFromHigh: 35 }),
    candidate("600002", "超跌乙", 6.2, { rise10: -12, rise20: -19, pctFromHigh: 28 }),
    candidate("600003", "老核心甲", 4.1, { oldCore: true, initiativeScore: 42 }),
    candidate("600004", "新近核心", 12.1, {
      oldCore: true,
      identity: "情绪/历史核心",
      initiativeScore: 88,
      coreHits: 1,
      activeHits: 0,
    }),
  ]));

  assert.strictEqual(model.structureType, "超跌修复主导 · 老核心未带节奏");
  assert.strictEqual(model.evidence.oversoldDominant, true);
  assert.strictEqual(model.evidence.oldCoreLed, false);
  assert.deepStrictEqual(
    model.structureEvidence.oversold.items.map((item) => item.name),
    ["超跌甲", "超跌乙"],
  );
  assert.strictEqual(model.structureEvidence.oldCore.status, "not-leading");
  assert(model.structureEvidence.oldCore.summary.includes("主动性不足"));
  assert(!model.structureEvidence.oldCore.items.some((item) => item.name === "新近核心"));
  console.log("✓ 超跌走强不会再被误写成老核心主导");
}

{
  const model = buildMarketEmotionObservation(payload([
    candidate("600011", "老核心领涨", 8.6, {
      oldCore: true,
      initiativeScore: 86,
      tradeState: "主攻候选",
    }),
    candidate("600012", "老核心跟随", 4.3, {
      oldCore: true,
      initiativeScore: 35,
    }),
  ]));

  assert.strictEqual(model.structureType, "老核心带动修复");
  assert.strictEqual(model.evidence.oldCoreLed, true);
  assert.strictEqual(model.structureEvidence.oldCore.status, "leading");
  assert.strictEqual(model.structureEvidence.oldCore.items[0].driverState, "率先发动");
  assert(model.structureEvidence.oldCore.items.some((item) => item.driverState === "跟随/修复"));
  console.log("✓ 只有“率先发动 + 其他老核心跟随”才确认带节奏");
}

console.log("市场情绪归因测试全部通过 ✅");
