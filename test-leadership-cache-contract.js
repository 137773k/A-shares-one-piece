"use strict";

const assert = require("assert");
const { _internals } = require("./server");
const { LEADERSHIP_SCHEMA_VERSION } = require("./core-leadership");

const { normalizeLeadershipPayload, buildMarketEmotionObservation } = _internals;

function topicBoard() {
  return {
    items: [],
    mainLine: {
      name: "AI算力",
      family: "AI算力",
      displayName: "AI算力",
      matchNames: ["AI算力"],
      count: 4,
      resonance: true,
      sustained: true,
      label: "主线持续",
    },
  };
}

function market() {
  return {
    state: {
      cycle: "混沌",
      subPhase: "混沌中期",
      operation: "谨慎参与",
      position: "20%-40%",
    },
    limitStats: {
      todayLimitUp: 42,
      todayLimitDown: 5,
    },
  };
}

function oldCandidate(code, overrides = {}) {
  return {
    code,
    name: `旧缓存样本${code}`,
    price: 10,
    prevClose: 9.8,
    changePct: 2.04,
    amountYi: 20,
    score: 70,
    selected: false,
    role: "中军",
    mainConcept: "AI算力",
    concepts: ["AI算力"],
    klineProfile: {
      lastClose: 10,
      ma5: 9.9,
      ma10: 9.8,
      ma20: 9.6,
      ma60: 9.2,
      pctFromHigh: 8,
      position120Pct: 60,
      rise10: 5,
      rise20: 9,
      longBearBreak3d: false,
      structureBreak: false,
    },
    ...overrides,
  };
}

function assertFiniteNumbers(value, path = "root") {
  if (typeof value === "number") {
    assert(Number.isFinite(value), `${path} 必须是有限数字，实际为 ${String(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteNumbers(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => assertFiniteNumbers(item, `${path}.${key}`));
  }
}

function assertBestPicksTreeSafe(value, path = "bestPicks") {
  assert.notStrictEqual(value, undefined, `${path} 不得为 undefined`);
  if (typeof value === "number") {
    assert(Number.isFinite(value), `${path} 不得出现 NaN 或 Infinity`);
    assert.notStrictEqual(value, -999, `${path} 不得泄漏内部 -999 哨兵`);
    assert.notStrictEqual(value, -500, `${path} 不得泄漏内部 -500 哨兵`);
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assert(Object.prototype.hasOwnProperty.call(value, index), `${path}[${index}] 不得为空槽`);
      assertBestPicksTreeSafe(value[index], `${path}[${index}]`);
    }
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      assertBestPicksTreeSafe(item, `${path}.${key}`);
    });
  }
}

console.log("=== leadership 缓存契约测试 ===");

// 1. 旧缓存没有 leadershipBoard，也没有 stock.leadership，恢复时必须安全补齐。
{
  const payload = {
    fetchedAt: "2026-07-22T15:10:00+08:00",
    candidates: [
      oldCandidate("000001"),
      oldCandidate("000002", {
        price: 8.4,
        prevClose: 8.5,
        changePct: -1.18,
        amountYi: 12,
        score: 55,
        role: "后排观察",
        klineProfile: null,
      }),
    ],
    topicBoard: topicBoard(),
    hotConcepts: [],
    market: market(),
    tomorrowOutlook: null,
  };

  let normalized;
  assert.doesNotThrow(() => {
    normalized = normalizeLeadershipPayload(payload);
  }, "完全没有领导力字段的旧缓存应可安全迁移");
  assert.strictEqual(normalized, payload, "normalize 应原位补齐缓存对象");
  assert(normalized.leadershipBoard && normalized.leadershipBoard.version >= 1);
  assert.strictEqual(normalized.leadershipBoard.counts.candidates, payload.candidates.length);
  payload.candidates.forEach((candidate) => {
    assert(candidate.leadership && candidate.leadership.version >= 1, `${candidate.code} 必须补齐 leadership`);
    assert(Number.isFinite(candidate.leadership.initiative.score), `${candidate.code} 主动性评分必须有限`);
    assert(Number.isFinite(candidate.leadership.impactScore), `${candidate.code} 影响力评分必须有限`);
    assertFiniteNumbers(candidate.leadership, `candidates.${candidate.code}.leadership`);
  });
  assertBestPicksTreeSafe(normalized.bestPicks);
  assert.strictEqual(normalized.bestPicks.executionVersion, 3, "旧缓存必须迁移到 executionVersion 3");
  console.log("✓ 无领导力字段的旧缓存可安全迁移，候选数值均为有限值");
}

// 2. 已保存的高质量“分时验证”不得在重启恢复时被收盘代理覆盖。
// 同时让该票概念不匹配，触发内部 -999 闸门，验证哨兵不会写入 bestPicks。
{
  const preservedLeadership = {
    version: LEADERSHIP_SCHEMA_VERSION,
    level: "L4",
    levelLabel: "主动核心",
    identity: "主动型容量龙头",
    anchorType: "主动容量核心",
    focusMatch: false,
    recognized: true,
    persistentRecognition: true,
    repairCoreQualified: false,
    coreDirectionMatch: false,
    directionState: {},
    coreIdentityQualified: true,
    tradeQualified: true,
    coreQualified: true,
    tradeState: "主攻候选",
    executionNote: "保留分时验证结果",
    identityFails: [],
    hardFails: [],
    initiative: {
      score: 88,
      label: "主动发起并带动",
      proactive: true,
      capacity: true,
      capacityFloorYi: 30,
      relativeStrength: 6.5,
      peerMedianChangePct: 1.2,
      firstAttackTime: "09:35",
      leadMinutes: 18,
      followerCount: 3,
      breadthLift: 4.2,
      retentionPct: 86,
      dataQuality: "分时验证",
      evidence: ["09:35率先发起，随后3只同方向标的跟随"],
    },
    structure: {
      grade: "A",
      frameworkIntact: true,
      breakdown: false,
      overextended: false,
      trendHealthy: true,
      chipPressure: false,
      chipRepairing: false,
      chipLabel: "上方筹码较轻",
      positionLabel: "中位承接区",
      distanceMa20Pct: 3.2,
      distanceMa5Pct: 1.1,
      pctFromHigh: 6,
      evidence: ["关键成本区尚未有效破坏"],
    },
    history: {
      appearances: 2,
      coreHits: 2,
      selectedHits: 1,
      activeHits: 2,
    },
    impactScore: 42,
  };
  const candidate = oldCandidate("000003", {
    name: "分时结果保留样本",
    selected: true,
    role: "龙头",
    mainConcept: "完全无关方向",
    concepts: ["完全无关方向"],
    leadership: preservedLeadership,
  });
  const payload = {
    fetchedAt: "2026-07-22T15:10:00+08:00",
    candidates: [candidate],
    leadershipBoard: {
      version: LEADERSHIP_SCHEMA_VERSION,
      focusDirection: "AI算力",
      generatedAt: "2026-07-22T15:10:00+08:00",
      dataQuality: "分时验证",
      principle: "主动性第一",
      leaders: [],
      tradeCarriers: [],
      observations: [],
      counts: { candidates: 1, intraday: 1, leaders: 1, tradeCarriers: 1 },
    },
    topicBoard: topicBoard(),
    hotConcepts: [],
    market: market(),
    tomorrowOutlook: null,
  };

  assert.doesNotThrow(() => normalizeLeadershipPayload(payload));
  assert.strictEqual(candidate.leadership, preservedLeadership, "已有领导力对象不应被迁移重算替换");
  assert.strictEqual(candidate.leadership.initiative.dataQuality, "分时验证");
  assert.strictEqual(candidate.leadership.initiative.score, 88);
  assert.notStrictEqual(candidate.leadership.initiative.dataQuality, "收盘代理");
  assert(payload.bestPicks && Array.isArray(payload.bestPicks.picks));
  assert.strictEqual(payload.bestPicks.picks.length, 0, "概念闸门淘汰允许 picks 为空，但内部哨兵不得外泄");
  assertBestPicksTreeSafe(payload.bestPicks);

  // 同一候选切换到“主升分歧”，会走内部 -500 闸门；缓存树仍必须只保留正常业务值。
  payload.market.state.cycle = "主升";
  payload.market.state.subPhase = "高位分歧";
  assert.doesNotThrow(() => normalizeLeadershipPayload(payload));
  assert.strictEqual(candidate.leadership.initiative.dataQuality, "分时验证");
  assert.strictEqual(payload.bestPicks.picks.length, 0);
  assertBestPicksTreeSafe(payload.bestPicks);
  console.log("✓ 已保存的分时验证不会降级为收盘代理，-999/-500 闸门值均不进入 bestPicks");
}

// 3. 健康分化日即使指数和广度偏弱，也不能单项触发红灯；
// 同时旧 selected 中的一字高度票不得重新混入情绪/容量核心锚点。
{
  const falseAnchor = oldCandidate("000815", {
    name: "美利云",
    selected: true,
    changePct: 10.03,
    limitUp: true,
    leadership: {
      coreIdentityQualified: false,
      tradeQualified: false,
      coreQualified: false,
      anchorType: "高度观察",
      tradeState: "仅观察",
      initiative: { score: 0, proactive: false },
    },
  });
  const verifiedCore = oldCandidate("000938", {
    name: "紫光股份",
    selected: false,
    changePct: 3.5,
    amountYi: 120,
    leadership: {
      coreIdentityQualified: true,
      tradeQualified: true,
      coreQualified: true,
      anchorType: "主动容量核心",
      identity: "主动型容量龙头",
      tradeState: "等回踩",
      initiative: { score: 88, proactive: true },
      structure: { newHigh: false, nearHigh20: true },
    },
  });
  const payload = {
    fetchedAt: "2026-07-22T15:10:00+08:00",
    candidates: [falseAnchor, verifiedCore],
    selected: [falseAnchor],
    leadershipBoard: {
      version: LEADERSHIP_SCHEMA_VERSION,
      leaders: [{ ...verifiedCore, coreIdentityQualified: true, tradeQualified: true }],
      tradeCarriers: [{ ...verifiedCore, coreIdentityQualified: true, tradeQualified: true }],
    },
    topicBoard: topicBoard(),
    hotConcepts: [],
    market: {
      state: {
        cycle: "混沌",
        subPhase: "混沌中期",
        dailyState: { key: "healthy_divergence", label: "健康分化·兑现" },
      },
      snapshot: {
        avgIndexChange: -1.13,
        breadth: 0.28,
        shszAmountYi: 26500,
      },
      limitStats: {
        ztPrev: 120,
        ztToday: 46,
        dtPrev: 20,
        dtToday: 8,
        dates: { today: "2026-07-22" },
      },
    },
  };
  const observation = buildMarketEmotionObservation(payload);
  assert.notStrictEqual(observation.light, "red", "健康分化且跌停收缩时，指数偏弱不能单独触发红灯");
  const anchorGroup = observation.groups.find((group) => group.key === "anchors");
  assert(anchorGroup, "必须输出情绪/容量锚点组");
  assert.deepStrictEqual(anchorGroup.items.map((item) => item.name), ["紫光股份"]);
  console.log("✓ 健康分化不因指数单项转红，旧 selected 高度票不会回流到核心锚点");
}

// 4. executionVersion v2 缓存必须重算为 v3，旧交易结论不得继续展示。
{
  const payload = {
    fetchedAt: "2026-07-22T15:10:00+08:00",
    candidates: [oldCandidate("000004")],
    topicBoard: topicBoard(),
    hotConcepts: [],
    market: market(),
    tomorrowOutlook: null,
    bestPicks: {
      executionVersion: 2,
      available: true,
      picks: [{ code: "LEGACY", name: "旧版错误候选" }],
    },
  };

  assert.doesNotThrow(() => normalizeLeadershipPayload(payload));
  assert.strictEqual(payload.bestPicks.executionVersion, 3, "v2 bestPicks 必须重算到 v3");
  assert(Array.isArray(payload.bestPicks.picks));
  assert(!payload.bestPicks.picks.some((item) => item && item.code === "LEGACY"), "旧版候选不得残留");
  assertBestPicksTreeSafe(payload.bestPicks);
  console.log("✓ executionVersion v2 缓存会重算为 v3，旧交易结论不会残留");
}

// 5. 迁移异常时必须清空旧 v2 交易结论，同时保留原始候选数据。
{
  const candidate = oldCandidate("000005");
  const candidateBefore = JSON.parse(JSON.stringify(candidate));
  const payload = {
    fetchedAt: "2026-07-22T15:10:00+08:00",
    candidates: [candidate],
    topicBoard: topicBoard(),
    hotConcepts: [],
    tomorrowOutlook: null,
    bestPicks: {
      executionVersion: 2,
      available: true,
      picks: [{ code: "LEGACY", name: "迁移失败前的旧候选" }],
    },
  };
  Object.defineProperty(payload, "market", {
    enumerable: true,
    configurable: true,
    get() {
      throw new Error("forced migration failure");
    },
  });

  assert.doesNotThrow(() => normalizeLeadershipPayload(payload));
  assert.strictEqual(payload.bestPicks.executionVersion, 3);
  assert.strictEqual(payload.bestPicks.available, false);
  assert.strictEqual(payload.bestPicks.tradeDisabled, true);
  assert.strictEqual(payload.bestPicks.migrationFailed, true);
  assert.deepStrictEqual(payload.bestPicks.picks, [], "迁移失败时不得继续展示旧 v2 候选");
  assert.deepStrictEqual(candidate, candidateBefore, "失败兜底不得改写原始候选数据");
  assertBestPicksTreeSafe(payload.bestPicks);
  console.log("✓ 迁移异常会切换到安全不可交易 v3 兜底，并保留原始候选数据");
}

console.log("leadership 缓存契约测试全部通过 ✅");
