"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTomorrowOpportunityMap } = require("./tomorrow-opportunity-map");

function theme(name, family, stockRows, overrides = {}) {
  return {
    id: family,
    name,
    displayName: name,
    family,
    rank: 1,
    isMainLine: false,
    sustained: false,
    resonance: true,
    score: 100,
    count: Math.max(2, stockRows.length),
    limitCount: 1,
    stockCount: stockRows.length,
    aliases: [],
    stocks: stockRows,
    ...overrides,
  };
}

function themeStock(code, name, overrides = {}) {
  return {
    code,
    name,
    primaryRole: "龙头",
    identity: "当前核心",
    tags: [{ key: "leader", label: "龙头", verified: true }],
    ...overrides,
  };
}

function core(code, name, weight, stage = "supported", overrides = {}) {
  return {
    code,
    name,
    weight,
    stage,
    confidence: 82,
    source: "test_fixture",
    evidence: [`${name}的可验证证据`],
    ...overrides,
  };
}

function payloadCandidate(code, name, direction, overrides = {}) {
  const leadershipOverrides = overrides.leadership || {};
  return {
    code,
    name,
    mainConcept: direction,
    price: 10,
    tradeQualified: true,
    priceIntegrity: { price: 10, valid: true, consistent: true },
    tomorrowExecution: {
      tomorrowEntryQualified: true,
      triggers: ["市场与方向同步确认"],
      cancelConditions: ["方向失去共振"],
    },
    hardGate: { pass: true },
    ...overrides,
    leadership: {
      coreIdentityQualified: true,
      tradeQualified: true,
      identity: "当前核心龙头",
      ...leadershipOverrides,
    },
  };
}

function ticket(code, name, direction, scenarioKey = "range_divergence", overrides = {}) {
  return {
    code,
    name,
    direction,
    scenarioKey,
    scenarioLabel: scenarioKey,
    status: "conditional",
    blockers: [],
    buy: {
      summary: "条件满足后小仓试错",
      triggers: ["市场与方向同步确认"],
      cancelConditions: ["方向失去共振"],
    },
    ...overrides,
  };
}

function fixture(overrides = {}) {
  const themes = overrides.themes || [];
  return {
    themeLibrary: {
      available: true,
      stale: false,
      tradingDate: "2026-08-11",
      themes,
      ...(overrides.themeLibrary || {}),
    },
    candidates: overrides.candidates || [],
    riskBoard: overrides.riskBoard || {},
    decision: {
      executionVersion: 3,
      tradingDate: "2026-08-11",
      primaryScenarioKey: "range_divergence",
      permission: {
        status: "conditional",
        canActivate: true,
        executionMode: "normal",
      },
      candidates: overrides.decisionCandidates || [],
      contingencies: overrides.contingencies || [],
      coreEmotion: { items: overrides.coreItems || [] },
      ...(overrides.decision || {}),
    },
    ...(overrides.input || {}),
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

test("builds at most three parallel directions, merges families, and separates anchors from tickets", () => {
  const themes = [
    theme("共封装光学(CPO)", "AI算力", [themeStock("000001", "科技龙一")], {
      rank: 1,
      isMainLine: true,
      sustained: true,
      aliases: ["PCB概念"],
      count: 8,
      limitCount: 4,
      score: 500,
    }),
    theme("PCB概念", "AI算力", [themeStock("000002", "科技中军")], {
      rank: 3,
      sustained: true,
      resonance: false,
      count: 5,
      score: 260,
    }),
    theme("医药", "医药", [themeStock("600001", "医药龙头")], {
      rank: 2,
      count: 6,
      limitCount: 3,
      score: 300,
    }),
    theme("机器人", "机器人", [themeStock("300001", "机器人龙头")], {
      rank: 4,
      resonance: false,
      sustained: true,
      count: 4,
      score: 220,
    }),
    theme("低空经济", "低空经济", [themeStock("002001", "低空龙头")], {
      rank: 5,
      resonance: false,
      isMainLine: true,
      count: 3,
      score: 100,
    }),
  ];
  const input = fixture({
    themes,
    candidates: [
      payloadCandidate("000001", "科技龙一", "共封装光学(CPO)"),
      payloadCandidate("600001", "医药龙头", "医药"),
    ],
    decisionCandidates: [ticket("000001", "科技龙一", "共封装光学(CPO)")],
    contingencies: [ticket("600001", "医药龙头", "医药", "strengthen")],
    coreItems: [
      core("000001", "科技龙一", 90),
      core("000002", "科技中军", 59),
      core("600001", "医药龙头", 85),
      core("300001", "机器人龙头", 80),
      core("002001", "低空龙头", 75),
    ],
  });

  const result = buildTomorrowOpportunityMap(input);

  assert.equal(result.directions.length, 3);
  assert.deepEqual(result.directions.map((row) => row.family), ["AI算力", "医药", "机器人"]);
  assert.equal(result.directions.filter((row) => row.family === "AI算力").length, 1);
  assert.deepEqual(
    result.directions[0].evidence.sourceThemeNames.sort(),
    ["PCB概念", "共封装光学(CPO)"].sort(),
  );
  assert.ok(result.directions[0].evidence.reasonCodes.includes("same_family_merged"));
  assert.ok(result.directions.every((row) => row.emotionAnchors.every((anchor) => anchor.impactWeight >= 60)));
  assert.equal(result.directions[0].emotionAnchors.length, 1, "59分核心不得成为高影响锚点");
  assert.equal(result.directions[0].tradeCandidates[0].activation, "primary_path");
  assert.equal(result.directions[0].tradeCandidates[0].active, true);
  assert.equal(result.directions[0].emotionAnchors[0].usage, "anchor_and_trade");
  assert.equal(result.directions[1].tradeCandidates[0].activation, "path_switch_only");
  assert.equal(result.directions[1].tradeCandidates[0].active, false);
  assert.equal(result.directions[1].state, "watch_only", "备选路径不能冒充当前买点");
  assert.equal(result.status, "tradeable");
  assert.ok(result.rejectedDirections.some((row) => (
    row.family === "低空经济" && row.reasonCodes.includes("direction_limit")
  )));
  assert.equal(result.integrity.anchorCandidateContractsSeparated, true);
});

test("closed rhythm gate keeps directions and anchors but removes every trade candidate", () => {
  const input = fixture({
    themes: [theme("医药", "医药", [themeStock("600001", "医药龙头")], { count: 6 })],
    candidates: [payloadCandidate("600001", "医药龙头", "医药")],
    decisionCandidates: [ticket("600001", "医药龙头", "医药")],
    coreItems: [core("600001", "医药龙头", 88)],
    decision: {
      permission: {
        status: "blocked",
        canActivate: false,
        executionMode: "blocked",
        summary: "兑现日不开放新仓",
      },
    },
  });

  const result = buildTomorrowOpportunityMap(input);

  assert.equal(result.globalGate.status, "closed");
  assert.equal(result.directions.length, 1);
  assert.equal(result.directions[0].emotionAnchors.length, 1);
  assert.deepEqual(result.directions[0].tradeCandidates, []);
  assert.equal(result.directions[0].state, "watch_only");
  assert.equal(result.status, "watch_only");
  assert.equal(result.integrity.closedGateStripsTradeCandidates, true);
});

test("a high-impact historical anchor is observable but never promoted to a trade candidate", () => {
  const historical = payloadCandidate("600002", "历史龙头", "医药", {
    leadership: {
      coreIdentityQualified: false,
      tradeQualified: true,
      identity: "情绪/历史核心",
    },
  });
  const input = fixture({
    themes: [theme("医药", "医药", [themeStock("600002", "历史龙头", { identity: "情绪/历史核心" })], { count: 5 })],
    candidates: [historical],
    decisionCandidates: [ticket("600002", "历史龙头", "医药")],
    coreItems: [core("600002", "历史龙头", 92)],
  });

  const result = buildTomorrowOpportunityMap(input);

  assert.equal(result.directions.length, 1);
  assert.equal(result.directions[0].emotionAnchors[0].identityState, "historical_core");
  assert.equal(result.directions[0].emotionAnchors[0].usage, "anchor_only");
  assert.deepEqual(result.directions[0].tradeCandidates, []);
  assert.equal(result.status, "watch_only");
});

test("rejects directions without signal, breadth, or a 60-point emotion anchor", () => {
  const input = fixture({
    themes: [
      theme("无信号", "无信号", [themeStock("000101", "无信号票")], {
        resonance: false,
        sustained: false,
        isMainLine: false,
        count: 5,
      }),
      theme("单票主线", "单票主线", [themeStock("000102", "单票")], {
        resonance: false,
        sustained: false,
        isMainLine: true,
        count: 1,
        stockCount: 1,
        limitCount: 0,
      }),
      theme("锚点不足", "锚点不足", [themeStock("000103", "低权重票")], {
        count: 4,
      }),
    ],
    coreItems: [
      core("000101", "无信号票", 75),
      core("000102", "单票", 76),
      core("000103", "低权重票", 59),
    ],
  });

  const result = buildTomorrowOpportunityMap(input);
  const rejected = new Map(result.rejectedDirections.map((row) => [row.family, row.reasonCodes]));

  assert.equal(result.directions.length, 0);
  assert.ok(rejected.get("无信号").includes("direction_signal_missing"));
  assert.ok(rejected.get("单票主线").includes("direction_breadth_missing"));
  assert.ok(rejected.get("锚点不足").includes("high_impact_anchor_missing"));
  assert.equal(result.status, "none");
});

test("excludes explicit, risk-board, and systemically negative directions but not a single risk anchor", () => {
  const input = fixture({
    themes: [
      theme("显式风险", "显式风险", [themeStock("000201", "风险票")], { count: 4, risk: true }),
      theme("风险板方向", "风险板方向", [themeStock("000202", "屏蔽票")], { count: 4 }),
      theme("双负反馈", "双负反馈", [
        themeStock("000203", "负反馈一"),
        themeStock("000204", "负反馈二"),
      ], { count: 5 }),
      theme("单负反馈仍观察", "单负反馈仍观察", [themeStock("000205", "风险锚点")], { count: 5 }),
    ],
    coreItems: [
      core("000201", "风险票", 80),
      core("000202", "屏蔽票", 81),
      core("000203", "负反馈一", 85, "negative_feedback"),
      core("000204", "负反馈二", 75, "negative_feedback"),
      core("000205", "风险锚点", 70, "negative_feedback"),
    ],
    riskBoard: { blockedConcepts: ["风险板方向"] },
  });

  const result = buildTomorrowOpportunityMap(input);
  const rejected = new Map(result.rejectedDirections.map((row) => [row.family, row.reasonCodes]));

  assert.deepEqual(result.directions.map((row) => row.family), ["单负反馈仍观察"]);
  assert.equal(result.directions[0].emotionAnchors[0].anchorType, "negative");
  assert.ok(rejected.get("显式风险").includes("risk_direction_explicit"));
  assert.ok(rejected.get("风险板方向").includes("risk_board_blocked"));
  assert.ok(rejected.get("双负反馈").includes("risk_anchor_dominance"));
});

test("a blocked subtheme does not hide its broader parallel direction", () => {
  const input = fixture({
    themes: [theme("医药", "医药", [themeStock("600664", "哈药股份")], {
      aliases: ["创新药", "医药电商"],
      count: 11,
      limitCount: 5,
      score: 283,
    })],
    coreItems: [core("600664", "哈药股份", 87, "acceleration")],
    riskBoard: { blockedConcepts: ["医药电商"] },
  });

  const result = buildTomorrowOpportunityMap(input);

  assert.deepEqual(result.directions.map((row) => row.family), ["医药"]);
  assert.deepEqual(result.directions[0].emotionAnchors.map((row) => row.code), ["600664"]);
  assert.equal(result.rejectedDirections.some((row) => row.family === "医药"), false);
});

test("a blocked child theme is filtered while a safe sibling keeps the family observable", () => {
  const input = fixture({
    themes: [
      theme("医药电商", "医药", [themeStock("600001", "电商跟随")], { id: "医药电商", rank: 1, count: 6 }),
      theme("创新药", "医药", [themeStock("600664", "哈药股份")], { id: "创新药", rank: 2, count: 8, limitCount: 3 }),
    ],
    coreItems: [
      core("600001", "电商跟随", 72),
      core("600664", "哈药股份", 87, "acceleration"),
    ],
    riskBoard: { blockedConcepts: ["医药电商"] },
  });

  const result = buildTomorrowOpportunityMap(input);

  assert.equal(result.directions.length, 1);
  assert.equal(result.directions[0].family, "医药");
  assert.equal(result.directions[0].name, "创新药");
  assert.deepEqual(result.directions[0].emotionAnchors.map((row) => row.code), ["600664"]);
  assert.deepEqual(result.directions[0].evidence.filteredRiskSubthemes, ["医药电商"]);
  assert.ok(result.directions[0].evidence.reasonCodes.includes("blocked_subthemes_filtered"));
});

test("a family with only blocked child themes is rejected instead of promoted", () => {
  const input = fixture({
    themes: [theme("医药电商", "医药", [themeStock("600001", "电商跟随")], {
      id: "医药电商",
      count: 6,
    })],
    coreItems: [core("600001", "电商跟随", 72)],
    riskBoard: { blockedConcepts: ["医药电商"] },
  });

  const result = buildTomorrowOpportunityMap(input);

  assert.equal(result.directions.length, 0);
  assert.ok(result.rejectedDirections.some((row) => row.family === "医药" && row.reasonCodes.includes("risk_board_blocked")));
});

test("an explicitly risky child theme is filtered without killing its safe family sibling", () => {
  const input = fixture({
    themes: [
      theme("风险医药子题材", "医药", [
        themeStock("600001", "风险跟随"),
        themeStock("600664", "哈药股份"),
      ], {
        id: "风险医药子题材",
        rank: 1,
        count: 6,
        risk: true,
      }),
      theme("创新药", "医药", [themeStock("600664", "哈药股份")], {
        id: "创新药",
        rank: 2,
        count: 8,
        limitCount: 3,
      }),
    ],
    coreItems: [
      core("600001", "风险跟随", 72),
      core("600664", "哈药股份", 87, "acceleration"),
    ],
    candidates: [
      payloadCandidate("600001", "风险跟随", "医药"),
      payloadCandidate("600664", "哈药股份", "创新药"),
    ],
    decisionCandidates: [
      ticket("600001", "风险跟随", "医药"),
      ticket("600664", "哈药股份", "创新药"),
    ],
  });

  const result = buildTomorrowOpportunityMap(input);

  assert.equal(result.directions.length, 1);
  assert.equal(result.directions[0].family, "医药");
  assert.deepEqual(result.directions[0].emotionAnchors.map((row) => row.code), ["600664"]);
  assert.deepEqual(result.directions[0].tradeCandidates.map((row) => row.code), ["600664"]);
  assert.deepEqual(result.directions[0].evidence.filteredRiskSubthemes, ["风险医药子题材"]);
  assert.equal(result.rejectedDirections.some((row) => row.family === "医药"), false);
});

test("is deterministic and does not mutate frozen inputs", () => {
  const input = fixture({
    themes: [theme("科技", "科技", [themeStock("000301", "科技核心")], { count: 4 })],
    coreItems: [core("000301", "科技核心", 80)],
  });
  deepFreeze(input);

  const first = buildTomorrowOpportunityMap(input);
  const second = buildTomorrowOpportunityMap(input);

  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(input), true);
});

test("unavailable theme library fails closed with an auditable rejection", () => {
  const result = buildTomorrowOpportunityMap(fixture({
    themes: [],
    themeLibrary: { available: false },
  }));

  assert.equal(result.globalGate.status, "closed");
  assert.equal(result.status, "none");
  assert.deepEqual(result.directions, []);
  assert.ok(result.rejectedDirections.some((row) => row.reasonCodes.includes("theme_library_unavailable")));
  assert.equal(result.integrity.ok, false);
});
