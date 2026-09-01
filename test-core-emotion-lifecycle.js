"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildCoreEmotionBasket } = require("./core-emotion-lifecycle");
const { buildTomorrowMarketForecast } = require("./tomorrow-market-forecast");
const { buildEmotionCycleState, resolveEmotionBigCycle } = require("./emotion-cycle-engine");

function emotionEffectContext(overrides = {}) {
  return {
    version: 1,
    status: "available",
    calibrated: false,
    tradingDate: overrides.tradingDate || null,
    previousTradingDate: overrides.previousTradingDate || null,
    profit: {
      score: overrides.profitScore ?? 72,
      trend: overrides.profitTrend || "improving",
    },
    loss: {
      score: overrides.lossScore ?? 28,
      trend: overrides.lossTrend || "improving",
    },
    guardrails: {
      wholeMarketOnly: true,
      indexDirectionExcluded: true,
      candidateLeadershipExcluded: true,
      hotDirectionsExcluded: true,
    },
  };
}

function verifiedSession(overrides = {}) {
  return {
    openChangePct: 2,
    currentChangePct: 7,
    maxChangePct: 8,
    minChangePct: 1,
    limitTouched: false,
    limitOpenCount: 0,
    resealedAfterOpen: false,
    closedAtLimit: false,
    postTouchMaxPullbackPct: null,
    ...overrides,
  };
}

function leadership(overrides = {}) {
  const initiativeOverrides = overrides.initiative || {};
  const historyOverrides = overrides.history || {};
  const structureOverrides = overrides.structure || {};
  return {
    recognized: true,
    persistentRecognition: false,
    coreIdentityQualified: false,
    impactScore: 0,
    ...overrides,
    initiative: {
      score: 40,
      proactive: false,
      capacity: false,
      dataQuality: "收盘代理",
      session: null,
      ...initiativeOverrides,
    },
    history: { appearances: 0, ...historyOverrides },
    structure: { breakdown: false, ...structureOverrides },
  };
}

function candidate(code, name, overrides = {}) {
  return {
    code,
    name,
    role: "龙头",
    changePct: 10,
    amountYi: 10,
    speculation: { expectation: "在途", boards: 1, ...overrides.speculation },
    klineProfile: { lastTradingDate: "2026-08-07", ...overrides.klineProfile },
    leadership: leadership(overrides.leadership),
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => !["speculation", "klineProfile", "leadership"].includes(key))),
  };
}

function verifiedExactT1Context(overrides = {}) {
  return {
    tradingDate: "2026-08-24",
    expectedPreviousTradingDate: "2026-08-21",
    previousTradingDate: "2026-08-21",
    previousSnapshotKind: "closing",
    exactPreviousTradingDay: true,
    previousEvidenceVerified: true,
    ...overrides,
  };
}

function verifiedBasketOptions(previousPayload) {
  return {
    previousPayload,
    tradingContext: verifiedExactT1Context({
      tradingDate: "2026-08-07",
      expectedPreviousTradingDate: "2026-08-06",
      previousTradingDate: "2026-08-06",
    }),
  };
}

function payload(candidates, options = {}) {
  return {
    market: {
      snapshot: options.snapshot || {},
      limitStats: {
        dates: { today: "20260807", prev: "20260806", verified: true },
      },
      state: { structuralCycle: options.cycle || "震荡" },
    },
    candidates,
    bestPicks: options.bestPicks || { picks: [] },
    themeLibrary: {
      available: true,
      stale: false,
      tradingDate: "2026-08-07",
      previousTradingDate: "2026-08-06",
      previousDateVerified: true,
      snapshotKind: "closing",
      themes: [{
        name: "医药",
        stocks: options.themeStocks || [],
      }],
    },
  };
}

function themeCore(code, name, key = "leader", label = "龙头") {
  return {
    code,
    name,
    primaryRole: label,
    tags: [{ key, label, reason: `${name}${label}已验证`, verified: true }],
  };
}

test("real-like medical basket promotes Hayao/Baihua as anchors without treating a speculation hint as lifecycle truth", () => {
  const hayao = candidate("600664", "哈药股份", {
    changePct: 9.97,
    popularity: "2天2板",
    eastRank: 2,
    thsRank: 3,
    speculation: { expectation: "透支", boards: 2 },
    leadership: {
      cycleIdentity: { identityEstablished: true, activePrimary: true, state: "confirmed" },
      persistentRecognition: true,
      history: { appearances: 3 },
      initiative: { score: 43, proactive: false, capacity: false, dataQuality: "收盘代理" },
    },
  });
  const baihua = candidate("600721", "百花医药", {
    changePct: 10.02,
    popularity: "5天5板",
    eastRank: 5,
    thsRank: 9,
    speculation: { expectation: "透支", boards: 5 },
    leadership: {
      persistentRecognition: true,
      history: { appearances: 2 },
      initiative: {
        score: 50,
        proactive: false,
        dataQuality: "分时验证",
        session: verifiedSession({ limitTouched: true, limitOpenCount: 1, resealedAfterOpen: true, closedAtLimit: true }),
      },
    },
  });
  const zhaoyan = candidate("603127", "昭衍新药", {
    changePct: 10.01,
    speculation: { expectation: "在途", boards: 1 },
    leadership: {
      persistentRecognition: false,
      coreIdentityQualified: false,
      history: { appearances: 0 },
      initiative: { score: 39, proactive: false, capacity: false, dataQuality: "收盘代理" },
    },
  });
  const source = payload([hayao, baihua, zhaoyan], {
    themeStocks: [themeCore("600664", "哈药股份"), themeCore("600721", "百花医药")],
  });
  const basket = buildCoreEmotionBasket(source);

  assert.deepEqual(basket.items.map((item) => item.name).sort(), ["哈药股份", "百花医药"].sort());
  assert.ok(basket.items.every((item) => item.sentimentStage !== "expectation_overdrawn"));
  assert.ok(basket.items.every((item) => item.lifecycle.expectationRiskHint.usedForStage === false));
  assert.deepEqual(
    new Set(basket.emotionCycle.anchorLayers.A.map((item) => item.name)),
    new Set(["哈药股份", "百花医药"]),
  );
  assert.ok(basket.rejected.some((item) => item.name === "昭衍新药" && item.reasons.includes("历史出现次数为0")));
  assert.equal(source.candidates[0].sentimentStage, undefined, "纯模块不得修改原候选");
});

test("weak-to-strong uses exact T-1 first and rise2 math only as downgraded fallback", () => {
  const core = candidate("000001", "主动核心", {
    changePct: 7,
    leadership: {
      coreIdentityQualified: true,
      impactScore: 90,
      initiative: { score: 88, proactive: true, capacity: true, dataQuality: "分时验证", session: verifiedSession() },
    },
  });
  const previousPayload = {
    archiveMeta: { tradingDate: "2026-08-06", snapshotKind: "closing" },
    market: { limitStats: { dates: { today: "20260806" } } },
    candidates: [{ code: "000001", name: "主动核心", changePct: -4 }],
  };
  const exact = buildCoreEmotionBasket(payload([core]), verifiedBasketOptions(previousPayload));
  assert.equal(exact.items[0].sentimentStage, "weak_to_strong");
  assert.equal(exact.items[0].lifecycle.previousChange.source, "exact_t1_closing_archive");

  const inferredCore = candidate("000001", "主动核心", {
    changePct: 7,
    klineProfile: { rise2: 2 },
    leadership: core.leadership,
  });
  const inferred = buildCoreEmotionBasket(payload([inferredCore]));
  assert.equal(inferred.items[0].sentimentStage, "weak_to_strong");
  assert.equal(inferred.items[0].lifecycle.previousChange.source, "rise2_mathematical_inference");
  assert.ok(inferred.items[0].lifecycle.confidence < exact.items[0].lifecycle.confidence);
});

test("single-day surge is unknown; acceleration requires continuity or multi-board evidence", () => {
  const singleDay = candidate("000002", "单日强票", {
    changePct: 10,
    leadership: {
      coreIdentityQualified: true,
      impactScore: 90,
      initiative: { score: 90, proactive: true, capacity: true, dataQuality: "分时验证", session: verifiedSession({ currentChangePct: 10, maxChangePct: 10 }) },
    },
  });
  const continuous = candidate("000003", "连续强票", {
    changePct: 10,
    klineProfile: { rise2: 16 },
    leadership: singleDay.leadership,
  });
  const boards = candidate("000004", "连板核心", {
    changePct: 10,
    speculation: { expectation: "在途", boards: 3 },
    leadership: {
      recognized: true,
      cycleIdentity: { identityEstablished: true, activePrimary: true, state: "confirmed" },
    },
  });
  const basket = buildCoreEmotionBasket(payload([singleDay, continuous, boards]));
  const byName = Object.fromEntries(basket.items.map((item) => [item.name, item]));

  assert.equal(byName["单日强票"].sentimentStage, "unknown");
  assert.equal(byName["连续强票"].sentimentStage, "acceleration");
  assert.equal(byName["连板核心"].sentimentStage, "acceleration");
});

test("verified reseal creates support; only real price feedback, not a positive-day structure flag, creates negative feedback", () => {
  const supported = candidate("000005", "承接核心", {
    changePct: 10,
    leadership: {
      coreIdentityQualified: true,
      initiative: {
        score: 82,
        proactive: true,
        capacity: false,
        dataQuality: "分时验证",
        session: verifiedSession({ currentChangePct: 10, maxChangePct: 10, limitTouched: true, limitOpenCount: 2, resealedAfterOpen: true, closedAtLimit: true }),
      },
    },
  });
  const negative = candidate("000006", "负反馈核心", {
    changePct: -6,
    leadership: { coreIdentityQualified: true, structure: { breakdown: true } },
  });
  const positiveStructureBreak = candidate("000016", "破位修复核心", {
    changePct: 10,
    leadership: { coreIdentityQualified: true, structure: { breakdown: true } },
  });
  const basket = buildCoreEmotionBasket(payload([supported, negative, positiveStructureBreak]));
  const byName = Object.fromEntries(basket.items.map((item) => [item.name, item]));

  assert.equal(byName["承接核心"].sentimentStage, "supported");
  assert.equal(byName["负反馈核心"].sentimentStage, "negative_feedback");
  assert.notEqual(byName["破位修复核心"].sentimentStage, "negative_feedback");
});

test("legacy market structural cycle cannot condition a core lifecycle after emotion big-cycle resolution", () => {
  const overdrawn = candidate("000007", "透支核心", {
    speculation: { expectation: "透支", boards: 3 },
    leadership: {
      recognized: true,
      cycleIdentity: { identityEstablished: true, activePrimary: true, state: "confirmed" },
    },
  });
  const previousPayload = {
    archiveMeta: { tradingDate: "2026-08-06", snapshotKind: "closing" },
    market: { limitStats: { dates: { today: "20260806" } } },
    candidates: [{ code: "000007", name: "透支核心", changePct: 8 }],
    tomorrowDecision: {
      coreEmotion: { items: [{ code: "000007", name: "透支核心", stage: "acceleration" }] },
    },
  };
  const mainRise = buildCoreEmotionBasket(payload([overdrawn], { cycle: "主升" }), verifiedBasketOptions(previousPayload));
  const range = buildCoreEmotionBasket(payload([overdrawn], { cycle: "震荡" }), verifiedBasketOptions(previousPayload));
  const retreat = buildCoreEmotionBasket(payload([overdrawn], { cycle: "退潮" }), verifiedBasketOptions(previousPayload));

  assert.ok([mainRise, range, retreat].every((result) => result.items[0].sentimentStage === "expectation_overdrawn"));
  assert.ok([mainRise, range, retreat].every((result) => result.emotionCycle.bigCycle.key === "chaos"));
  assert.ok([mainRise, range, retreat].every((result) => result.items[0].lifecycle.marketRegime.key === "chaos"));
  assert.ok([mainRise, range, retreat].every((result) => result.items[0].lifecycle.expectedTransition.key === "range_divergence"));
});

test("selected Shenghong clone remains leave-one-out and cannot self-confirm market strengthening", () => {
  const shenghong = candidate("300476", "胜宏科技", {
    changePct: 12.01,
    klineProfile: { rise2: 18.6 },
    leadership: {
      coreIdentityQualified: true,
      persistentRecognition: true,
      impactScore: 100,
      initiative: { score: 97, proactive: true, capacity: true, dataQuality: "分时验证", session: verifiedSession({ currentChangePct: 12.01, maxChangePct: 14.2 }) },
    },
  });
  const source = payload([shenghong], {
    cycle: "主升",
    themeStocks: [themeCore("300476", "胜宏科技", "capacity", "中军")],
  });
  const basket = buildCoreEmotionBasket(source, { selectedCandidateCode: "300476" });
  const withSelected = buildTomorrowMarketForecast(source, {
    coreStocks: basket.items,
    selectedCandidateCode: "300476",
  });
  const withoutCore = buildTomorrowMarketForecast(source, { coreStocks: [] });

  assert.equal(basket.items[0].lifecycle.selectedCandidate, true);
  assert.equal(basket.items[0].sentimentStage, "acceleration");
  assert.deepEqual(withSelected.probabilities, withoutCore.probabilities);
  assert.equal(withSelected.sentimentCycle.coreBasket.positiveIndependentCount, 0);
  assert.equal(withSelected.sentimentCycle.coreBasket.independentAcceleratedCount, 0);
});

test("exact T-1 frozen stage drives cross-day acceleration and support transitions", () => {
  const active = candidate("000020", "跨日核心", {
    changePct: 7,
    leadership: {
      coreIdentityQualified: true,
      impactScore: 90,
      initiative: {
        score: 88,
        proactive: true,
        capacity: true,
        dataQuality: "分时验证",
        session: verifiedSession({ currentChangePct: 7, maxChangePct: 8 }),
      },
    },
  });
  const previousPayload = {
    archiveMeta: { tradingDate: "2026-08-06", snapshotKind: "closing" },
    market: { limitStats: { dates: { today: "20260806" } } },
    candidates: [{ code: "000020", name: "跨日核心", changePct: 4 }],
    tomorrowDecision: {
      coreEmotion: { items: [{ code: "000020", name: "跨日核心", stage: "weak_to_strong" }] },
    },
  };
  const acceleration = buildCoreEmotionBasket(payload([active]), verifiedBasketOptions(previousPayload));

  assert.equal(acceleration.items[0].sentimentStage, "acceleration");
  assert.equal(acceleration.items[0].lifecycle.previousStage, "weak_to_strong");
  assert.equal(acceleration.items[0].lifecycle.source, "cross_day_weak_to_strong_acceleration");
  assert.equal(acceleration.dataQuality.previousLifecycleCount, 1);

  previousPayload.tomorrowDecision.coreEmotion.items[0].stage = "divergence";
  active.leadership.initiative.session = verifiedSession({
    currentChangePct: 10,
    maxChangePct: 10,
    limitTouched: true,
    limitOpenCount: 1,
    resealedAfterOpen: true,
    closedAtLimit: true,
  });
  const support = buildCoreEmotionBasket(payload([active]), verifiedBasketOptions(previousPayload));
  assert.equal(support.items[0].sentimentStage, "supported");
  assert.equal(support.items[0].lifecycle.previousStage, "divergence");
  assert.equal(support.items[0].lifecycle.source, "cross_day_intraday_support");
});

test("A/B/C anchor layers rank Hayao and Baihua first while theme-only ordinary stocks stay in breadth", () => {
  const hayao = candidate("600664", "哈药股份", {
    popularity: "2天2板",
    eastRank: 2,
    thsRank: 3,
    speculation: { expectation: "透支", boards: 2 },
    leadership: { persistentRecognition: true, history: { appearances: 3, coreHits: 1 } },
  });
  const baihua = candidate("600721", "百花医药", {
    popularity: "5天5板",
    eastRank: 5,
    thsRank: 9,
    speculation: { expectation: "透支", boards: 5 },
    leadership: { persistentRecognition: true, history: { appearances: 2, coreHits: 1 } },
  });
  const aili = candidate("603221", "爱丽家居", {
    role: "后排观察",
    popularity: "12天11板",
    eastRank: 8,
    thsRank: 4,
    speculation: { expectation: "透支", boards: 10 },
    leadership: {
      history: { appearances: 1 },
      initiative: {
        score: 45,
        proactive: false,
        capacity: false,
        dataQuality: "分时验证",
        priceDiscovery: { noPriceDiscovery: true, suspectedOneWord: true },
        session: verifiedSession({
          openChangePct: 10,
          currentChangePct: 10,
          maxChangePct: 10,
          minChangePct: 10,
          limitTouched: true,
          closedAtLimit: true,
        }),
      },
    },
  });
  const fengfan = candidate("601700", "风范股份", {
    role: "后排观察",
    popularity: "6天5板",
    eastRank: 26,
    thsRank: 26,
    speculation: { expectation: "透支", boards: 5 },
    leadership: { persistentRecognition: true, history: { appearances: 2 } },
  });
  const capacity = candidate("000657", "容量确认", {
    role: "中军",
    changePct: 6,
    amountYi: 80,
    eastRank: 15,
    thsRank: 18,
    leadership: {
      impactScore: 75,
      initiative: {
        score: 82,
        proactive: true,
        capacity: true,
        dataQuality: "分时验证",
        session: verifiedSession({ currentChangePct: 6, maxChangePct: 7, minChangePct: -1 }),
      },
    },
  });
  const ordinary = candidate("000099", "普通题材票", {
    popularity: "首板",
    eastRank: 45,
    thsRank: 48,
    leadership: { history: { appearances: 0 } },
  });
  const basket = buildCoreEmotionBasket(payload(
    [ordinary, fengfan, aili, capacity, hayao, baihua],
    {
      themeStocks: [
        themeCore("600664", "哈药股份"),
        themeCore("600721", "百花医药"),
        themeCore("000657", "容量确认", "capacity", "中军"),
        themeCore("000099", "普通题材票"),
      ],
    },
  ));

  const layerA = basket.emotionCycle.anchorLayers.A.map((item) => item.name);
  const layerB = basket.emotionCycle.anchorLayers.B.map((item) => item.name);
  const layerC = basket.emotionCycle.anchorLayers.C.map((item) => item.name);
  assert.ok(["哈药股份", "百花医药", "爱丽家居", "风范股份"].every((name) => layerA.includes(name)));
  assert.ok(layerB.includes("容量确认"));
  assert.ok(layerC.includes("普通题材票"), "题材verified角色不能单独晋级A");
  assert.deepEqual(
    new Set(basket.emotionCycle.rankedAnchors.slice(0, 2).map((item) => item.name)),
    new Set(["哈药股份", "百花医药"]),
  );
  const ailiAnchor = basket.emotionCycle.rankedAnchors.find((item) => item.name === "爱丽家居");
  assert.equal(ailiAnchor.current.oneWord, true);
  assert.equal(ailiAnchor.support.score, null, "一字板只贡献热度，承接必须unknown");
  assert.equal(ailiAnchor.damage.score, null, "一字板不能以零伤害稀释真实换手样本的伤害分");
  assert.equal(ailiAnchor.participation.marketEmotionEligible, false, "全天锁死只能证明高度一致，不是可参与情绪");
  assert.equal(ailiAnchor.participation.heightConsensusEligible, true);
  assert.notEqual(basket.emotionCycle.current.key, "climax", "不能靠一字高标解锁全市高潮");
  assert.equal(basket.emotionCycle.tomorrowPaths.length, 3);
});

test("ordinary speculation expectation cannot create a phase when intraday and T-1 are missing", () => {
  const ordinary = candidate("000088", "普通透支提示票", {
    speculation: { expectation: "透支", boards: 1 },
    leadership: {
      coreIdentityQualified: true,
      history: { appearances: 0 },
      initiative: { score: 40, proactive: false, capacity: false, dataQuality: "收盘代理", session: null },
    },
  });
  const basket = buildCoreEmotionBasket(payload([ordinary]));
  const anchor = basket.emotionCycle.rankedAnchors[0];

  assert.equal(basket.items[0].sentimentStage, "unknown");
  assert.equal(basket.items[0].lifecycle.expectationRiskHint.usedForStage, false);
  assert.equal(anchor.expectationRisk.key, "high");
  assert.equal(anchor.expectationRisk.usedForStage, false);
  assert.equal(anchor.support.score, null);
  assert.equal(basket.emotionCycle.previous.available, false);
  assert.equal(basket.emotionCycle.current.key, "unknown");
  assert.equal(basket.emotionCycle.current.crossDayVerified, false);
});

test("dailyHeight裸龙头只保留高度风险，不得成为情绪核心身份来源；confirmed周期身份仍可", () => {
  const dailyHeight = candidate("P1_DAILY_HEIGHT", "匿名当日高度", {
    role: "龙头",
    roleKind: "dailyHeight",
    roleScope: "session",
    dailyRole: "当日高度",
    popularity: "3连板",
    speculation: { expectation: "在途", boards: 3, consecutiveBoards: 3 },
    eastRank: 18,
    thsRank: 24,
    leadership: {
      recognized: true,
      persistentRecognition: false,
      coreIdentityQualified: false,
      history: { appearances: 0, coreHits: 0 },
      initiative: { score: 42, proactive: false, capacity: false, dataQuality: "收盘代理" },
    },
  });
  const unverified = buildCoreEmotionBasket(payload([dailyHeight]));
  const unverifiedAnchor = unverified.emotionCycle.rankedAnchors[0];

  assert.equal(unverified.items.some((item) => item.code === dailyHeight.code), false);
  assert.ok(unverified.rejected.some((item) => item.code === dailyHeight.code));
  assert.notEqual(unverifiedAnchor.anchorRole, "leader");
  assert.ok(unverifiedAnchor.influenceScore.components.height.score > 0);

  const confirmed = candidate("P1_CONFIRMED_CYCLE", "匿名已确认周期核心", {
    role: "龙头",
    roleKind: "cycleLeader",
    roleScope: "cycle",
    popularity: "2天2板",
    speculation: { expectation: "在途", boards: 2, consecutiveBoards: 2 },
    leadership: {
      recognized: true,
      persistentRecognition: true,
      coreIdentityQualified: false,
      cycleIdentity: { identityEstablished: true, activePrimary: true, state: "confirmed" },
      history: { appearances: 2, coreHits: 1 },
      initiative: { score: 55, proactive: false, capacity: false, dataQuality: "收盘代理" },
    },
  });
  const verified = buildCoreEmotionBasket(payload([confirmed]));
  const verifiedAnchor = verified.emotionCycle.rankedAnchors[0];
  assert.ok(verified.items.some((item) => item.code === confirmed.code));
  assert.equal(verifiedAnchor.anchorRole, "leader");
});

function directEmotionStock(code, name, options = {}) {
  const boardLabel = options.boardLabel || "2天2板";
  const current = options.currentChangePct ?? 3;
  const maximum = options.maxChangePct ?? 10;
  const minimum = options.minChangePct ?? 2;
  const role = options.role || "龙头";
  return candidate(code, name, {
    role,
    amountYi: options.amountYi ?? 10,
    ...(options.canonicalThemeFamily ? { canonicalThemeFamily: options.canonicalThemeFamily } : {}),
    ...(options.oneWord === true ? { oneWord: true } : {}),
    popularity: boardLabel,
    eastRank: options.eastRank ?? 5,
    thsRank: options.thsRank ?? 8,
    changePct: current,
    speculation: { expectation: options.expectation || "在途", boards: options.boards ?? 2 },
    emotionIdentity: { verifiedThemeRoles: options.verifiedThemeRoles || ["leader"] },
    leadership: {
      impactScore: options.impactScore ?? 0,
      persistentRecognition: options.persistentRecognition !== false,
      history: { appearances: options.appearances ?? 2, coreHits: options.coreHits ?? 1 },
      initiative: {
        score: options.initiativeScore ?? 55,
        proactive: options.proactive === true,
        capacity: options.capacity === true,
        dataQuality: options.dataQuality || "分时验证",
        session: options.session === null ? null : verifiedSession({
          openChangePct: options.openChangePct ?? 9,
          currentChangePct: current,
          maxChangePct: maximum,
          minChangePct: minimum,
          limitTouched: options.limitTouched === true,
          closedAtLimit: options.closedAtLimit === true,
          resealedAfterOpen: options.resealedAfterOpen === true,
          limitOpenCount: options.limitOpenCount ?? 0,
          postTouchMaxPullbackPct: options.postTouchMaxPullbackPct ?? null,
        }),
      },
    },
  });
}

test("a phase cannot change with only two anchors; the third independent role unlocks realization", () => {
  const leader = directEmotionStock("000101", "兑现龙头", {
    boardLabel: "2天2板",
    currentChangePct: 3,
    maxChangePct: 10,
    openChangePct: 9,
  });
  const height = directEmotionStock("000102", "兑现高标", {
    boardLabel: "5天5板",
    boards: 5,
    currentChangePct: 3,
    maxChangePct: 10,
    openChangePct: 9,
  });
  const breadth = directEmotionStock("000103", "首板先锋", {
    role: "启动跟随",
    boardLabel: "首板",
    boards: 1,
    eastRank: 45,
    thsRank: 48,
    persistentRecognition: false,
    appearances: 0,
    coreHits: 0,
    verifiedThemeRoles: ["pioneer"],
    currentChangePct: 10,
    maxChangePct: 10,
    openChangePct: 2,
  });
  const base = {
    exactPreviousTradingDay: true,
    tradingContext: verifiedExactT1Context(),
    previousState: { key: "climax", confidence: 80 },
  };
  const twoOnly = buildEmotionCycleState({ ...base, currentItems: [leader, height] });
  const withBreadth = buildEmotionCycleState({ ...base, currentItems: [leader, height, breadth] });

  assert.equal(twoOnly.transition.qualified, false);
  assert.equal(twoOnly.current.key, "climax", "样本不足时必须维持T-1状态");
  assert.equal(withBreadth.transition.qualified, true);
  assert.equal(withBreadth.transition.independentSampleCount, 3);
  assert.ok(withBreadth.transition.roleCount >= 2);
  assert.equal(withBreadth.current.key, "realization");
  assert.equal(withBreadth.transition.changed, true);
});

test("cross-day damage progresses from harmful divergence to retreat", () => {
  const damagedLeader = directEmotionStock("000201", "受损龙头", {
    currentChangePct: -6,
    maxChangePct: 5,
    openChangePct: 4,
  });
  const damagedHeight = directEmotionStock("000202", "受损高标", {
    boardLabel: "5天5板",
    boards: 5,
    currentChangePct: -7,
    maxChangePct: 4,
    openChangePct: 3,
  });
  const damagedPioneer = directEmotionStock("000203", "受损先锋", {
    role: "启动先锋",
    boardLabel: "首板",
    boards: 1,
    eastRank: 45,
    thsRank: 48,
    persistentRecognition: false,
    appearances: 0,
    coreHits: 0,
    verifiedThemeRoles: ["pioneer"],
    currentChangePct: -5,
    maxChangePct: 4,
    openChangePct: 2,
  });
  const currentItems = [damagedLeader, damagedHeight, damagedPioneer];
  const harmful = buildEmotionCycleState({
    currentItems,
    exactPreviousTradingDay: true,
    tradingContext: verifiedExactT1Context(),
    previousState: { key: "climax" },
  });
  const retreat = buildEmotionCycleState({
    currentItems,
    exactPreviousTradingDay: true,
    tradingContext: verifiedExactT1Context(),
    previousState: { key: "harmful" },
  });

  assert.equal(harmful.transition.qualified, true);
  assert.equal(harmful.current.key, "harmful");
  assert.equal(retreat.current.key, "retreat");
  assert.deepEqual(retreat.tomorrowPaths.map((item) => item.key), ["weaken", "diverge", "strengthen"]);
  assert.equal(retreat.tomorrowBaseline.key, "weaken");
  assert.equal(retreat.tomorrowPaths[0].isBaseline, true);
});

test("the state machine exposes acceleration and cross-day support as distinct phases", () => {
  const leader = directEmotionStock("000301", "加速龙头", {
    eastRank: 15,
    thsRank: 18,
    boardLabel: "2天2板",
    currentChangePct: 10,
    maxChangePct: 10,
    openChangePct: 5,
    minChangePct: 5,
  });
  const height = directEmotionStock("000302", "加速高标", {
    eastRank: 24,
    thsRank: 27,
    boardLabel: "4天4板",
    boards: 4,
    currentChangePct: 10,
    maxChangePct: 10,
    openChangePct: 5,
    minChangePct: 5,
  });
  const breadth = directEmotionStock("000303", "加速跟随", {
    role: "启动跟随",
    boardLabel: "首板",
    boards: 1,
    eastRank: 45,
    thsRank: 48,
    persistentRecognition: false,
    appearances: 0,
    coreHits: 0,
    verifiedThemeRoles: ["pioneer"],
    currentChangePct: 10,
    maxChangePct: 10,
    openChangePct: 2,
  });
  const acceleration = buildEmotionCycleState({ currentItems: [leader, height, breadth] });
  assert.equal(acceleration.current.key, "acceleration");

  const supportLeader = directEmotionStock("000311", "承接龙头", {
    currentChangePct: 10,
    maxChangePct: 10,
    minChangePct: 0,
    openChangePct: 2,
    limitTouched: true,
    closedAtLimit: true,
    resealedAfterOpen: true,
    limitOpenCount: 1,
  });
  const supportHeight = directEmotionStock("000312", "承接高标", {
    boardLabel: "5天5板",
    boards: 5,
    currentChangePct: 10,
    maxChangePct: 10,
    minChangePct: 0,
    openChangePct: 2,
    limitTouched: true,
    closedAtLimit: true,
    resealedAfterOpen: true,
    limitOpenCount: 1,
  });
  const supportBreadth = { ...breadth, code: "000313", name: "承接跟随" };
  const support = buildEmotionCycleState({
    currentItems: [supportLeader, supportHeight, supportBreadth],
    exactPreviousTradingDay: true,
    tradingContext: verifiedExactT1Context(),
    previousState: { key: "realization" },
  });
  assert.equal(support.transition.qualified, true);
  assert.equal(support.current.key, "support");
  assert.ok(support.metrics.support.confirmedAnchorCount >= 2);
});

test("anonymous majority divergence with weak support and medium damage is medium divergence, not acceleration", () => {
  const hotLeader = directEmotionStock("ANON_SD_1", "anonymous-hot-leader", {
    boardLabel: "4天4板",
    boards: 4,
    eastRank: 1,
    thsRank: 2,
    currentChangePct: -1,
    openChangePct: 3,
    maxChangePct: 4,
    minChangePct: -3,
  });
  const hotHeight = directEmotionStock("ANON_SD_2", "anonymous-hot-height", {
    boardLabel: "5天5板",
    boards: 5,
    eastRank: 3,
    thsRank: 4,
    currentChangePct: -1,
    openChangePct: 3,
    maxChangePct: 4,
    minChangePct: -3,
  });
  const capacityCore = directEmotionStock("ANON_SD_3", "anonymous-capacity-core", {
    role: "中军",
    verifiedThemeRoles: ["capacity"],
    capacity: true,
    proactive: true,
    initiativeScore: 82,
    amountYi: 100,
    currentChangePct: -1,
    openChangePct: 3,
    maxChangePct: 4,
    minChangePct: -3,
  });
  const breadth = directEmotionStock("ANON_SD_4", "anonymous-breadth", {
    role: "启动先锋",
    boardLabel: "首板",
    boards: 1,
    verifiedThemeRoles: ["pioneer"],
    persistentRecognition: false,
    appearances: 0,
    coreHits: 0,
    eastRank: 45,
    thsRank: 48,
    currentChangePct: -1,
    openChangePct: 3,
    maxChangePct: 4,
    minChangePct: -3,
  });
  const state = buildEmotionCycleState({
    currentItems: [hotLeader, hotHeight, capacityCore, breadth],
  });

  assert.equal(state.transition.qualified, true);
  assert.ok(state.participation.divergentAnchorCount >= 3);
  assert.ok(state.participation.repairFailedCount >= 3);
  assert.ok(state.metrics.heat.highAnchorCount >= 2, "高热锚存在，但其分歧状态不得贡献加速确认");
  assert.equal(state.metrics.heat.accelerationEligibleAnchorCount, 0);
  assert.equal(state.metrics.heat.climaxConfirmationAnchorCount, 0);
  assert.ok(state.metrics.support.score < 40);
  assert.ok(state.metrics.damage.score >= 25 && state.metrics.damage.score < 50);
  assert.equal(state.current.phaseKey, "strong_divergence");
  assert.equal(state.current.label, "中等分歧");
  assert.equal(state.current.divergenceIntensity.key, "medium");
  assert.equal(state.current.divergenceIntensity.label, "中等分歧");
  assert.equal(state.current.legacyKey, "realization");
  assert.notEqual(state.current.key, "acceleration");
  assert.equal(state.tomorrowBaseline.key, "diverge");
  assert.match(state.tomorrowBaseline.label, /分歧延续/);
  assert.match(state.tomorrowBaseline.reason, /已经处于强分歧/);
  assert.doesNotMatch(state.tomorrowBaseline.reason, /加速\/兑现/);

  const retreatHasPriority = buildEmotionCycleState({
    currentItems: [hotLeader, hotHeight, capacityCore, breadth],
    exactPreviousTradingDay: true,
    tradingContext: verifiedExactT1Context(),
    previousState: { key: "retreat" },
  });
  assert.equal(retreatHasPriority.current.key, "retreat", "已确认退潮不得被中等强分歧倒推回兑现阶段");
  assert.equal(retreatHasPriority.current.phaseKey, "retreat");

  const supportedOne = directEmotionStock("ANON_SD_5", "anonymous-supported-one", {
    role: "中军",
    verifiedThemeRoles: ["capacity"],
    capacity: true,
    proactive: true,
    initiativeScore: 82,
    amountYi: 100,
    currentChangePct: 10,
    openChangePct: 2,
    maxChangePct: 10,
    minChangePct: 0,
    limitTouched: true,
    limitOpenCount: 2,
    resealedAfterOpen: true,
    closedAtLimit: true,
  });
  const supportedTwo = directEmotionStock("ANON_SD_6", "anonymous-supported-two", {
    boardLabel: "3天3板",
    boards: 3,
    currentChangePct: 10,
    openChangePct: 2,
    maxChangePct: 10,
    minChangePct: 0,
    limitTouched: true,
    limitOpenCount: 1,
    resealedAfterOpen: true,
    closedAtLimit: true,
  });
  const mixedStrongDivergence = buildEmotionCycleState({
    currentItems: [hotLeader, hotHeight, capacityCore, supportedOne, supportedTwo, breadth],
    exactPreviousTradingDay: true,
    tradingContext: verifiedExactT1Context(),
    previousState: { key: "acceleration" },
  });
  assert.ok(mixedStrongDivergence.participation.supportedDivergenceCount >= 2);
  assert.ok(mixedStrongDivergence.participation.repairFailedCount >= 3);
  assert.ok(mixedStrongDivergence.metrics.support.score < 40);
  assert.ok(mixedStrongDivergence.metrics.damage.score >= 25 && mixedStrongDivergence.metrics.damage.score < 50);
  assert.equal(mixedStrongDivergence.current.phaseKey, "strong_divergence", "少数回封不得覆盖多数修复失败形成的强分歧");
});

test("explicit excludedCandidateCodes applies deterministic leave-one-out", () => {
  const firstPick = directEmotionStock("000401", "推荐一号", {
    boardLabel: "5天5板",
    boards: 5,
    currentChangePct: 10,
  });
  const secondPick = directEmotionStock("000402", "推荐二号", {
    boardLabel: "4天4板",
    boards: 4,
    currentChangePct: 10,
  });
  const independent = directEmotionStock("000403", "独立市场锚", {
    role: "启动先锋",
    boardLabel: "2天2板",
    boards: 2,
    verifiedThemeRoles: ["pioneer"],
    currentChangePct: 10,
  });
  const basket = buildCoreEmotionBasket(
    payload([firstPick, secondPick, independent]),
    { excludedCandidateCodes: [firstPick.code, secondPick.code] },
  );
  const anchors = new Map(basket.emotionCycle.rankedAnchors.map((row) => [row.code, row]));
  const lifecycle = new Map(basket.items.map((row) => [row.code, row.lifecycle]));

  assert.equal(anchors.get(firstPick.code).excludedFromMarketState, true);
  assert.equal(anchors.get(secondPick.code).excludedFromMarketState, true);
  assert.equal(anchors.get(independent.code).excludedFromMarketState, false);
  assert.equal(lifecycle.get(firstPick.code).selectedCandidate, true);
  assert.equal(lifecycle.get(secondPick.code).selectedCandidate, true);
  assert.equal(basket.emotionCycle.metrics.selectedCandidateExcludedCount, 2);
  assert.deepEqual(
    new Set(basket.emotionCycle.dataQuality.excludedCandidateCodes),
    new Set([firstPick.code, secondPick.code]),
  );
  assert.equal(basket.emotionCycle.transition.qualified, false);
  assert.equal(basket.emotionCycle.current.key, "unknown", "推荐票全部剔除后不能靠一只独立锚确认市场高潮");
});

test("canonical medical family can be locally climaxed while capacity confirmation remains split", () => {
  const medical = [
    directEmotionStock("600664", "哈药股份", {
      canonicalThemeFamily: "医药",
      boardLabel: "2天2板",
      boards: 2,
      eastRank: 2,
      thsRank: 3,
      currentChangePct: 10,
      minChangePct: 5,
    }),
    directEmotionStock("600721", "百花医药", {
      canonicalThemeFamily: "医药",
      boardLabel: "5天5板",
      boards: 5,
      eastRank: 5,
      thsRank: 9,
      currentChangePct: 10,
      minChangePct: 5,
    }),
    directEmotionStock("603221", "爱丽家居", {
      canonicalThemeFamily: "医药",
      role: "高度核心",
      boardLabel: "12天11板",
      boards: 11,
      eastRank: 8,
      thsRank: 4,
      currentChangePct: 10,
      oneWord: true,
    }),
    directEmotionStock("601700", "风范股份", {
      canonicalThemeFamily: "医药",
      role: "高度核心",
      boardLabel: "6天5板",
      boards: 5,
      eastRank: 26,
      thsRank: 26,
      currentChangePct: 10,
      minChangePct: 5,
    }),
  ];
  const supportedCapacity = directEmotionStock("000501", "容量承接", {
    canonicalThemeFamily: "AI算力",
    role: "容量中军",
    amountYi: 80,
    impactScore: 78,
    initiativeScore: 82,
    proactive: true,
    capacity: true,
    currentChangePct: 10,
    openChangePct: 2,
    minChangePct: 0,
    limitTouched: true,
    closedAtLimit: true,
    resealedAfterOpen: true,
    limitOpenCount: 1,
  });
  const damagedCapacity = directEmotionStock("000502", "容量受损", {
    canonicalThemeFamily: "机器人",
    role: "容量中军",
    amountYi: 90,
    impactScore: 80,
    initiativeScore: 84,
    proactive: true,
    capacity: true,
    currentChangePct: -6,
    openChangePct: 4,
    maxChangePct: 5,
    minChangePct: -7,
  });
  const basket = buildCoreEmotionBasket(payload([...medical, supportedCapacity, damagedCapacity]));
  const medicalStage = basket.emotionCycle.themeStages.find((row) => row.name === "医药");

  assert.ok(medicalStage, "候选自带canonicalThemeFamily不能被core覆盖为空");
  assert.equal(medicalStage.current.key, "climax");
  assert.equal(medicalStage.anchorCount, 4);
  assert.equal(basket.emotionCycle.current.key, "climax");
  assert.equal(basket.emotionCycle.current.focusTheme, "医药");
  assert.equal(basket.emotionCycle.current.scope, "high_board_market_with_local_theme");
  assert.equal(basket.emotionCycle.marketStructure.capacity.key, "split");
  assert.equal(basket.emotionCycle.marketStructure.capacity.supportedCount, 1);
  assert.equal(basket.emotionCycle.marketStructure.capacity.damagedCount, 1);
  assert.match(basket.emotionCycle.current.reason, /医药形成局部一致高潮/);
  assert.match(basket.emotionCycle.current.reason, /容量确认仍分化/);
});

test("climax path and big cycle are independent from index MA/regime inputs", () => {
  const climaxItems = [
    directEmotionStock("000601", "高潮高度一", {
      boardLabel: "5天5板",
      boards: 5,
      eastRank: 1,
      thsRank: 2,
      currentChangePct: 10,
      minChangePct: 5,
    }),
    directEmotionStock("000602", "高潮高度二", {
      boardLabel: "4天4板",
      boards: 4,
      eastRank: 3,
      thsRank: 4,
      currentChangePct: 10,
      minChangePct: 5,
    }),
    directEmotionStock("000603", "高潮先锋", {
      role: "启动先锋",
      boardLabel: "2天2板",
      boards: 2,
      eastRank: 6,
      thsRank: 8,
      verifiedThemeRoles: ["pioneer"],
      currentChangePct: 10,
      minChangePct: 5,
    }),
  ];
  const partialInput = {
    currentItems: climaxItems,
    indexCycleRegime: { structuralCycle: "混沌", shortTerm: { key: "partial_main_rise" } },
  };
  const mainInput = {
    currentItems: climaxItems,
    indexCycleRegime: { structuralCycle: "主升", shortTerm: { key: "full_main_rise" } },
  };
  const partial = buildEmotionCycleState(partialInput);
  const partialAgain = buildEmotionCycleState(partialInput);
  const main = buildEmotionCycleState(mainInput);

  assert.equal(partial.current.key, "climax");
  assert.equal(main.current.key, "climax");
  assert.equal(partial.cycleCondition.key, "chaos");
  assert.equal(main.cycleCondition.key, "chaos");
  assert.deepEqual(partial.bigCycle, main.bigCycle);
  assert.deepEqual(partial.cycleCondition, partial.bigCycle);
  assert.equal(partial.bigCycle.reasonCode, "first_generation_cannot_self_bootstrap_main_rise");
  assert.equal(partial.tomorrowBaseline.key, "diverge");
  assert.equal(main.tomorrowBaseline.key, "diverge");
  assert.equal(partial.tomorrowBaseline.rank, 1);
  assert.match(partial.tomorrowBaseline.label, /兑现优先/);
  assert.match(main.tomorrowBaseline.label, /兑现优先/);
  assert.equal(partial.executionPermission.immediate, false);
  assert.equal(partial.executionPermission.conditional, true);
  assert.equal(main.executionPermission.immediate, false);
  assert.equal(main.executionPermission.conditional, true);
  assert.equal(partial.executionPermission.immediateEntry, false);
  assert.equal(partial.executionPermission.conditionalAfterSupport, true);
  assert.match(main.tomorrowPaths[0].action, /只有真实承接成立/);
  assert.deepEqual(partial.tomorrowPaths.map((row) => row.key), ["diverge", "strengthen", "weaken"]);
  assert.deepEqual(partial.tomorrowPaths.map((row) => row.rank), [1, 2, 3]);
  assert.equal(partial.tomorrowPaths[0].isBaseline, true);
  assert.deepEqual(partial.tomorrowBaseline, partialAgain.tomorrowBaseline);
  assert.deepEqual(partial.tomorrowPaths, partialAgain.tomorrowPaths);
});

test("emotion big-cycle resolver requires exact T-1 before acceleration can become main-rise", () => {
  const generationContext = {
    generationId: "2026-08-27:close-v1",
    tradingDate: "2026-08-27",
    asOf: "2026-08-27T15:10:00+08:00",
  };
  const current = { key: "acceleration", phaseKey: "acceleration" };
  const metrics = {
    heat: { score: 76 },
    support: { score: 68, primaryCoreScore: 72 },
    damage: { score: 12, primaryCoreScore: 10, harmfulAnchorCount: 0 },
  };
  const transition = { qualified: true, independentSampleCount: 4, primaryAnchorCount: 3, roleCount: 3 };
  const firstGeneration = resolveEmotionBigCycle({
    current,
    metrics,
    transition,
    generationContext,
    indexCycleRegime: { structuralCycle: "主升", shortTerm: { key: "full_main_rise" } },
  });
  const exactT1 = resolveEmotionBigCycle({
    current,
    previous: {
      key: "acceleration",
      exactCanonical: true,
      exactPreviousTradingDay: true,
    },
    previousBigCycle: { key: "chaos" },
    metrics,
    transition,
    generationContext,
    indexCycleRegime: { structuralCycle: "退潮", shortTerm: { key: "decline" } },
  });

  assert.equal(firstGeneration.key, "chaos");
  assert.equal(firstGeneration.reasonCode, "first_generation_cannot_self_bootstrap_main_rise");
  assert.equal(exactT1.key, "main_rise");
  assert.equal(exactT1.source, "emotion_hsd_market_effect_state_machine_v2");
  assert.deepEqual(exactT1.generationContext, generationContext);
  assert.equal(exactT1.transition.from, "chaos");
  assert.equal(exactT1.transition.to, "main_rise");
  assert.equal(exactT1.transition.changed, true);
});

test("emotion big-cycle resolver requires broad loss or cross-day persistence before confirming retreat", () => {
  const base = {
    current: { key: "harmful", phaseKey: "harmful" },
    previous: {
      key: "realization",
      exactCanonical: true,
      exactPreviousTradingDay: true,
    },
    previousBigCycle: { key: "range" },
    metrics: {
      heat: { score: 38 },
      support: { score: 24, primaryCoreScore: 20 },
      damage: { score: 71, primaryCoreScore: 74, harmfulAnchorCount: 2 },
    },
  };
  const unqualified = resolveEmotionBigCycle({
    ...base,
    transition: { qualified: false, primaryAnchorCount: 2 },
  });
  const qualified = resolveEmotionBigCycle({
    ...base,
    transition: { qualified: true, primaryAnchorCount: 2, independentSampleCount: 3, roleCount: 2 },
  });
  const broadLossConfirmed = resolveEmotionBigCycle({
    ...base,
    transition: { qualified: true, primaryAnchorCount: 2, independentSampleCount: 3, roleCount: 2 },
    emotionEffectContext: emotionEffectContext({
      profitScore: 34,
      lossScore: 76,
      lossTrend: "worsening",
    }),
    snapshotKind: "closing",
  });

  assert.equal(unqualified.key, "chaos");
  assert.equal(qualified.key, "chaos", "单日两只核心受损但缺少市场扩散时不得直接确认退潮");
  assert.equal(broadLossConfirmed.key, "retreat");
  assert.equal(broadLossConfirmed.reasonCode, "broad_loss_and_multi_anchor_damage_confirmed");
  assert.match(broadLossConfirmed.transition.evidence.join(" "), /harmfulAnchorCount=2/);
  assert.match(broadLossConfirmed.transition.evidence.join(" "), /fullMarketRetreatConfirmed=true/);
});

test("two high-position profit-taking failures cannot override healthy whole-market profit effect", () => {
  const result = resolveEmotionBigCycle({
    current: {
      key: "realization",
      phaseKey: "post_heat_divergence",
      divergenceQuality: { key: "support_intact" },
    },
    previous: {
      key: "acceleration",
      exactCanonical: true,
      exactPreviousTradingDay: true,
    },
    previousBigCycle: { key: "main_rise" },
    metrics: {
      heat: { score: 62.4 },
      support: { score: 42.7, primaryCoreScore: 42.7 },
      damage: { score: 30.7, primaryCoreScore: 30.7, harmfulAnchorCount: 2 },
    },
    transition: { qualified: true, primaryAnchorCount: 8, independentSampleCount: 121, roleCount: 4 },
    emotionEffectContext: emotionEffectContext({
      profitScore: 85,
      lossScore: 8.8,
      lossTrend: "improving",
    }),
    snapshotKind: "closing",
  });

  assert.equal(result.key, "main_rise");
  assert.equal(result.reasonCode, "main_rise_healthy_divergence_held");
  assert.match(result.transition.evidence.join(" "), /broadMarketRejectsRetreat=true/);
  assert.equal(result.guardrails.singleDayMultiAnchorDamageCannotSetRetreat, true);
});

test("confirmed five-day window is the only big-cycle authority while the daily phase remains separate", () => {
  const generationContext = {
    generationId: "2026-08-28:2026-08-28T15:10:00.000Z",
    tradingDate: "2026-08-28",
    asOf: "2026-08-28T15:10:00.000Z",
  };
  const emotionBigCycleWindow = {
    version: 1,
    method: "five_day_weighted_emotion_big_cycle_window_v1",
    horizon: "rolling_5_trading_days",
    status: "available",
    key: "main_rise",
    tradingDate: "2026-08-28",
    generationContext,
    candidate: {
      key: "main_rise",
      confirmed: true,
      reasonCode: "two_day_main_rise_confirmed",
      reason: "五日加权结构与最近两日同时确认主升。",
    },
    observations: ["24", "25", "26", "27", "28"].map((day) => ({
      tradingDate: `2026-08-${day}`,
      profitScore: 75,
      lossScore: 20,
      coreContinuityScore: 65,
      complete: true,
    })),
    evidence: ["加权赚钱=75", "加权亏钱=20"],
  };
  const result = resolveEmotionBigCycle({
    current: { key: "harmful", phaseKey: "harmful" },
    previous: {
      key: "realization",
      exactCanonical: true,
      exactPreviousTradingDay: true,
    },
    previousBigCycle: { key: "range" },
    metrics: {
      heat: { score: 55 },
      support: { score: 20, primaryCoreScore: 18 },
      damage: { score: 78, primaryCoreScore: 80, harmfulAnchorCount: 3 },
    },
    transition: { qualified: true, primaryAnchorCount: 3 },
    emotionBigCycleWindow,
    generationContext,
    snapshotKind: "closing",
  });

  assert.equal(result.key, "main_rise");
  assert.equal(result.status, "canonical");
  assert.equal(result.source, "five_day_weighted_emotion_big_cycle_window_v1");
  assert.equal(result.horizon, "rolling_5_trading_days");
  assert.equal(result.windowDays, 5);
  assert.equal(result.reasonCode, "two_day_main_rise_confirmed");
  assert.equal(result.transition.qualified, true);
});

test("incomplete or mismatched five-day evidence preserves T-1 only as unavailable", () => {
  const generationContext = {
    generationId: "2026-08-28:2026-08-28T15:10:00.000Z",
    tradingDate: "2026-08-28",
    asOf: "2026-08-28T15:10:00.000Z",
  };
  const result = resolveEmotionBigCycle({
    current: { key: "acceleration", phaseKey: "acceleration" },
    previous: {
      key: "support",
      exactCanonical: true,
      exactPreviousTradingDay: true,
    },
    previousBigCycle: { key: "range" },
    metrics: {
      heat: { score: 80 },
      support: { score: 72, primaryCoreScore: 74 },
      damage: { score: 8, primaryCoreScore: 6, harmfulAnchorCount: 0 },
    },
    transition: { qualified: true, primaryAnchorCount: 3 },
    emotionBigCycleWindow: {
      version: 1,
      method: "five_day_weighted_emotion_big_cycle_window_v1",
      horizon: "rolling_5_trading_days",
      status: "unavailable",
      key: "unavailable",
      tradingDate: "2026-08-27",
      generationContext: {
        generationId: "2026-08-27:stale",
        tradingDate: "2026-08-27",
        asOf: "2026-08-27T15:10:00.000Z",
      },
      candidate: { confirmed: false, reasonCode: "five_day_window_incomplete" },
      observations: [],
      blockers: ["five_day_window_incomplete"],
    },
    generationContext,
    snapshotKind: "closing",
  });

  assert.equal(result.key, "range");
  assert.equal(result.status, "unavailable");
  assert.equal(result.reasonCode, "five_day_window_generation_mismatch");
  assert.equal(result.transition.qualified, false);
});

test("cold-cycle recovery and ice-point entry cannot skip state-machine steps", () => {
  const baseWindow = {
    version: 1,
    method: "five_day_weighted_emotion_big_cycle_window_v1",
    horizon: "rolling_5_trading_days",
    status: "available",
    tradingDate: "2026-08-28",
    candidate: { confirmed: true, reason: "五日窗口已确认" },
    observations: ["24", "25", "26", "27", "28"].map((day) => ({ tradingDate: `2026-08-${day}`, complete: true })),
  };
  const common = {
    current: { key: "support", phaseKey: "support" },
    previous: { key: "support", exactCanonical: true, exactPreviousTradingDay: true },
    metrics: {
      heat: { score: 50 },
      support: { score: 70, primaryCoreScore: 72 },
      damage: { score: 12, primaryCoreScore: 10, harmfulAnchorCount: 0 },
    },
    transition: { qualified: true, primaryAnchorCount: 2 },
    snapshotKind: "closing",
  };
  const recovery = resolveEmotionBigCycle({
    ...common,
    previousBigCycle: { key: "retreat" },
    emotionBigCycleWindow: {
      ...baseWindow,
      key: "main_rise",
      candidate: { ...baseWindow.candidate, key: "main_rise", reasonCode: "two_day_main_rise_confirmed" },
    },
  });
  const iceEntry = resolveEmotionBigCycle({
    ...common,
    previousBigCycle: { key: "range" },
    emotionBigCycleWindow: {
      ...baseWindow,
      key: "ice_point",
      candidate: { ...baseWindow.candidate, key: "ice_point", reasonCode: "two_day_extreme_freeze_confirmed" },
    },
  });

  assert.equal(recovery.key, "chaos");
  assert.equal(recovery.reasonCode, "cold_cycle_recovery_returns_to_chaos_first");
  assert.equal(iceEntry.key, "retreat");
  assert.equal(iceEntry.reasonCode, "ice_point_requires_retreat_lineage");
});

test("retreat/ice support returns to chaos first while main-rise healthy divergence is preserved", () => {
  const exactPrevious = {
    key: "retreat",
    exactCanonical: true,
    exactPreviousTradingDay: true,
  };
  const recovery = resolveEmotionBigCycle({
    current: { key: "support", phaseKey: "support" },
    previous: exactPrevious,
    previousBigCycle: { key: "retreat" },
    metrics: {
      heat: { score: 48 },
      support: { score: 70, primaryCoreScore: 72 },
      damage: { score: 18, primaryCoreScore: 16, harmfulAnchorCount: 0 },
    },
    transition: { qualified: true, primaryAnchorCount: 2 },
    dailyState: { key: "repair_strengthening" },
  });
  const healthyMainRise = resolveEmotionBigCycle({
    current: {
      key: "realization",
      phaseKey: "post_heat_divergence",
      divergenceQuality: { key: "support_intact" },
    },
    previous: {
      key: "acceleration",
      exactCanonical: true,
      exactPreviousTradingDay: true,
    },
    previousBigCycle: { key: "main_rise" },
    metrics: {
      heat: { score: 63 },
      support: { score: 64, primaryCoreScore: 68 },
      damage: { score: 28, primaryCoreScore: 25, harmfulAnchorCount: 0 },
    },
    transition: { qualified: true, primaryAnchorCount: 2 },
    dailyState: { key: "healthy_divergence" },
  });

  assert.equal(recovery.key, "chaos");
  assert.equal(recovery.reasonCode, "retreat_or_ice_support_returns_to_chaos_first");
  assert.equal(healthyMainRise.key, "main_rise");
  assert.equal(healthyMainRise.reasonCode, "main_rise_healthy_divergence_held");
});

test("daily-state alone cannot set emotion ice-point", () => {
  const source = payload([]);
  source.market.state.dailyState = { key: "ice_point", label: "冰点观察" };
  source.premarketModels = {
    generationContext: {
      generationId: "2026-08-07:close-v1",
      tradingDate: "2026-08-07",
      asOf: "2026-08-07T15:10:00+08:00",
    },
    indexCycleRegime: { structuralCycle: "主升" },
  };
  const basket = buildCoreEmotionBasket(source);

  assert.equal(basket.emotionCycle.bigCycle.key, "chaos");
  assert.equal(basket.emotionCycle.cycleCondition.key, "chaos");
  assert.deepEqual(
    basket.emotionCycle.bigCycle.generationContext,
    source.premarketModels.generationContext,
  );
  assert.equal(basket.emotionCycle.bigCycle.guardrails.dailyStateCannotSetEmotionBigCycle, true);
  assert.match(basket.emotionCycle.bigCycle.evidence.join(" "), /effectContext=unavailable/);
});

test("core lifecycle consumes same-generation whole-market emotion effect context", () => {
  const source = payload([]);
  source.market.state.emotionEffectContext = emotionEffectContext({
    tradingDate: "2026-08-07",
    previousTradingDate: "2026-08-06",
    profitScore: 74,
    lossScore: 26,
  });
  source.market.state.emotionEffectContext.status = "ready";
  source.premarketModels = {
    generationContext: {
      generationId: "2026-08-07:close-v1",
      tradingDate: "2026-08-07",
      asOf: "2026-08-07T15:10:00+08:00",
    },
  };

  const basket = buildCoreEmotionBasket(source);

  assert.equal(basket.emotionCycle.bigCycle.composite.available, true);
  assert.equal(basket.emotionCycle.bigCycle.composite.profitScore, 74);
  assert.equal(basket.emotionCycle.bigCycle.composite.lossScore, 26);
  assert.equal(basket.emotionCycle.bigCycle.composite.source.indexDirectionExcluded, true);
});

test("emotion ice-point requires retreat lineage, low profit and contracting loss", () => {
  const result = resolveEmotionBigCycle({
    current: { key: "unknown" },
    previous: {
      key: "retreat",
      exactCanonical: true,
      exactPreviousTradingDay: true,
    },
    previousBigCycle: { key: "retreat" },
    metrics: {
      heat: { score: 26 },
      support: { score: 20 },
      damage: { score: 42, harmfulAnchorCount: 0 },
    },
    transition: { qualified: false },
    emotionEffectContext: emotionEffectContext({
      profitScore: 24,
      lossScore: 54,
      lossTrend: "improving",
    }),
    snapshotKind: "closing",
  });

  assert.equal(result.key, "ice_point");
  assert.equal(result.reasonCode, "cold_breadth_without_damage_expansion");
  assert.equal(result.composite.available, true);
  assert.equal(result.guardrails.icePointRequiresRetreatLineageAndLossContraction, true);
});

test("full-market conflict blocks a new main-rise even when core anchors accelerate", () => {
  const result = resolveEmotionBigCycle({
    current: { key: "acceleration", phaseKey: "acceleration" },
    previous: {
      key: "acceleration",
      exactCanonical: true,
      exactPreviousTradingDay: true,
    },
    previousBigCycle: { key: "range" },
    metrics: {
      heat: { score: 82 },
      support: { score: 72, primaryCoreScore: 74 },
      damage: { score: 18, primaryCoreScore: 16, harmfulAnchorCount: 0 },
    },
    transition: { qualified: true, primaryAnchorCount: 3 },
    emotionEffectContext: emotionEffectContext({ profitScore: 72, lossScore: 62, lossTrend: "worsening" }),
    snapshotKind: "closing",
  });

  assert.equal(result.key, "chaos");
  assert.equal(result.reasonCode, "full_market_effect_does_not_confirm_main_rise");
  assert.equal(result.composite.conflict, true);
});

test("intraday evidence never advances the confirmed emotion big-cycle", () => {
  const result = resolveEmotionBigCycle({
    current: { key: "acceleration", phaseKey: "acceleration" },
    previous: {
      key: "support",
      exactCanonical: true,
      exactPreviousTradingDay: true,
    },
    previousBigCycle: { key: "range" },
    metrics: {
      heat: { score: 86 },
      support: { score: 80, primaryCoreScore: 82 },
      damage: { score: 8, primaryCoreScore: 6, harmfulAnchorCount: 0 },
    },
    transition: { qualified: true, primaryAnchorCount: 3 },
    emotionEffectContext: emotionEffectContext({ profitScore: 90, lossScore: 8 }),
    snapshotKind: "intraday",
  });

  assert.equal(result.key, "range");
  assert.equal(result.reasonCode, "intraday_keeps_exact_t1_big_cycle");
  assert.equal(result.transition.changed, false);
});

test("all emotion anchors use one 0-100 influence score and evidence count never changes weight", () => {
  const base = directEmotionStock("600001", "统一口径样本", {
    boardLabel: "2天2板",
    boards: 2,
    eastRank: 12,
    thsRank: 18,
    currentChangePct: 6,
  });
  const duplicatedEvidence = {
    ...base,
    sentimentEvidence: Array.from({ length: 20 }, (_, index) => ({
      id: `duplicate-${index}`,
      detail: "重复文本证据不得变成权重",
    })),
    leadership: {
      ...base.leadership,
      reasons: Array(20).fill("重复原因"),
    },
  };
  const plain = buildEmotionCycleState({ currentItems: [base] }).rankedAnchors[0];
  const duplicated = buildEmotionCycleState({ currentItems: [duplicatedEvidence] }).rankedAnchors[0];

  assert.equal(plain.anchorScore, duplicated.anchorScore);
  assert.ok(plain.anchorScore >= 0 && plain.anchorScore <= 100);
  assert.equal(plain.anchorScore, plain.influenceScore.score);
  assert.equal(plain.heat.score, plain.influenceScore.score);
  assert.equal(plain.influenceScore.evidenceCountAffectsScore, false);
  assert.equal(
    Object.values(plain.influenceScore.components).reduce((sum, component) => sum + component.score, 0),
    plain.anchorScore,
  );
  assert.equal(plain.influenceWeightPct, 100);
});

test("cross-platform Top100, market height and turnover reseal expose separate contributions", () => {
  const heightLeader = directEmotionStock("600011", "市场高度", {
    boardLabel: "5天5板",
    boards: 5,
    eastRank: 88,
    thsRank: 96,
    currentChangePct: 10,
  });
  const resealedAnchor = directEmotionStock("600012", "换手回封样本", {
    boardLabel: "2天2板",
    boards: 2,
    eastRank: 7,
    thsRank: 11,
    currentChangePct: 10,
    openChangePct: 3,
    minChangePct: 1,
    limitTouched: true,
    closedAtLimit: true,
    resealedAfterOpen: true,
    limitOpenCount: 1,
  });
  const state = buildEmotionCycleState({ currentItems: [resealedAnchor, heightLeader] });
  const height = state.rankedAnchors.find((row) => row.code === heightLeader.code);
  const resealed = state.rankedAnchors.find((row) => row.code === resealedAnchor.code);

  assert.equal(height.popularity.withinTop100, true);
  assert.ok(height.influenceScore.components.popularity.score > 0, "Top100末端仍应有小额、有界的名次贡献");
  assert.equal(height.influenceScore.components.height.marketLeader, true);
  assert.ok(height.influenceScore.components.height.marketLeaderBonus > 0);
  assert.equal(resealed.support.breakdown.priceDiscovery.eligible, true);
  assert.equal(resealed.support.breakdown.turnoverReseal.score, 45);
  assert.match(resealed.support.breakdown.turnoverReseal.detail, /换手破板后.*回封/);
});

test("real pre-open Hayao facts make it an A-layer key anchor without name hard-coding", () => {
  const hayaoFacts = {
    role: "龙头",
    popularity: "2天2板",
    eastRank: 2,
    thsRank: 5,
    combinedRank: 2,
    inBothSources: true,
    changePct: 0,
    speculation: { expectation: "透支", boards: 2 },
    leadership: {
      cycleIdentity: { identityEstablished: true, activePrimary: true, state: "confirmed" },
      persistentRecognition: true,
      recognized: true,
      coreIdentityQualified: false,
      impactScore: 0,
      history: { appearances: 3, coreHits: 1 },
      initiative: {
        score: 31,
        proactive: false,
        capacity: false,
        dataQuality: "收盘代理",
        session: null,
        priceDiscovery: { noPriceDiscovery: false, suspectedOneWord: false },
      },
    },
  };
  const hayao = candidate("600664", "哈药股份", hayaoFacts);
  const anonymousTwin = candidate("600665", "非硬编码同条件样本", hayaoFacts);
  const state = buildEmotionCycleState({ currentItems: [hayao, anonymousTwin] });
  const byCode = new Map(state.rankedAnchors.map((row) => [row.code, row]));

  for (const code of ["600664", "600665"]) {
    const anchor = byCode.get(code);
    assert.equal(anchor.layer, "A");
    assert.equal(anchor.anchorRole, "leader");
    assert.ok(anchor.anchorScore >= 75, `双榜Top5+2连板+跨日辨识度应成为关键锚，实得${anchor.anchorScore}`);
    assert.equal(anchor.influenceScore.components.popularity.crossPlatform, true);
    assert.equal(anchor.signals.structuralContinuity, true);
    assert.equal(anchor.current.changePct, null, "盘前无价格的伪0涨跌幅必须是unknown");
    assert.equal(anchor.influenceWeightPct, 50);
  }
  assert.equal(byCode.get("600664").anchorScore, byCode.get("600665").anchorScore);
  assert.equal(state.scoreStandard.weightNormalizedTotalPct, 100);
});

test("core basket publishes the same unified score through every compatibility field", () => {
  const hayao = candidate("600664", "哈药股份", {
    role: "龙头",
    popularity: "2天2板",
    eastRank: 2,
    thsRank: 5,
    changePct: 0,
    speculation: { expectation: "透支", boards: 2 },
    leadership: {
      persistentRecognition: true,
      recognized: true,
      history: { appearances: 3, coreHits: 1 },
      initiative: { score: 31, proactive: false, capacity: false, dataQuality: "收盘代理", session: null },
    },
  });
  const basket = buildCoreEmotionBasket(payload([hayao]));
  const item = basket.items[0];

  assert.equal(item.emotionWeight, item.emotionAnchor.score);
  assert.equal(item.emotionImpact.score, item.emotionAnchor.score);
  assert.deepEqual(item.emotionImpact.breakdown, item.emotionAnchor.influenceScore.components);
  assert.equal(item.emotionImpact.scoreStandard, "emotion_anchor_influence_100_v2");
  assert.equal(item.emotionImpact.evidenceCountAffectsScore, false);
});

test("turnover two-board anchor outweighs a five-board one-word anchor on profit effect, not market impact", () => {
  const hayaoLike = candidate("600664", "换手二连人气锚", {
    role: "龙头",
    popularity: "2天2板",
    eastRank: 2,
    thsRank: 5,
    speculation: { boards: 2 },
    klineProfile: {
      lastSession: {
        verified: true,
        completed: true,
        snapshotKind: "closing",
        tradingDate: "2026-08-10",
        openChangePct: 3,
        currentChangePct: 10,
        maxChangePct: 10,
        minChangePct: 1,
        limitTouched: true,
        limitOpenCount: 1,
        resealedAfterOpen: true,
        closedAtLimit: true,
        oneWord: false,
      },
    },
    leadership: {
      persistentRecognition: true,
      recognized: true,
      history: { appearances: 3, coreHits: 1 },
    },
  });
  const baihuaLike = candidate("600721", "一字五连空间锚", {
    role: "高度核心",
    popularity: "5天5板",
    eastRank: 3,
    thsRank: 6,
    speculation: { boards: 5 },
    klineProfile: {
      lastSession: {
        verified: true,
        completed: true,
        snapshotKind: "closing",
        tradingDate: "2026-08-10",
        openChangePct: 10,
        currentChangePct: 10,
        maxChangePct: 10,
        minChangePct: 10,
        limitTouched: true,
        limitOpenCount: 0,
        resealedAfterOpen: false,
        closedAtLimit: true,
        oneWord: true,
        noPriceDiscovery: true,
      },
    },
    leadership: {
      persistentRecognition: true,
      recognized: true,
      history: { appearances: 2, coreHits: 1 },
    },
  });
  const state = buildEmotionCycleState({ currentItems: [hayaoLike, baihuaLike] });
  const byCode = new Map(state.rankedAnchors.map((row) => [row.code, row]));
  const hayao = byCode.get("600664");
  const baihua = byCode.get("600721");

  assert.equal(hayao.layer, "A");
  assert.equal(baihua.layer, "A");
  assert.equal(hayao.priceDiscoveryType, "turnover_reseal");
  assert.equal(baihua.priceDiscoveryType, "one_word");
  assert.ok(baihua.influenceWeightPct > hayao.influenceWeightPct, "五连空间锚仍可保持更高市场影响权重");
  assert.ok(hayao.profitEffectScore > baihua.profitEffectScore, "真实换手回封才是更强赚钱效应样本");
  assert.ok(hayao.profitEffectWeightPct > baihua.profitEffectWeightPct);
  assert.equal(
    Math.round((hayao.profitEffectWeightPct + baihua.profitEffectWeightPct) * 10) / 10,
    100,
  );
  assert.equal(baihua.support.score, null, "一字空间锚不得伪造承接分");
});

test("unverified lastSession cannot manufacture price discovery or profit-effect weight", () => {
  const unverified = candidate("600699", "未验证历史分时", {
    popularity: "2天2板",
    eastRank: 2,
    thsRank: 5,
    speculation: { boards: 2 },
    klineProfile: {
      lastSession: {
        verified: false,
        completed: true,
        snapshotKind: "closing",
        currentChangePct: 10,
        limitOpenCount: 1,
        closedAtLimit: true,
      },
    },
    leadership: { persistentRecognition: true, history: { appearances: 3, coreHits: 1 } },
  });
  const anchor = buildEmotionCycleState({ currentItems: [unverified] }).rankedAnchors[0];

  assert.equal(anchor.priceDiscoveryType, "unknown");
  assert.equal(anchor.profitEffectScore, null);
  assert.equal(anchor.profitEffectWeightPct, 0);
  assert.equal(anchor.profitEffect.dataQuality, "unverified");
});

test("dual-Top10 persistent historical core promotes 3-day-2-board popularity anchors without name hard-coding", () => {
  const popularCoreFacts = {
    role: "高人气趋势样本",
    price: 12.34,
    changePct: 9.84,
    amountYi: 36,
    popularity: "3天2板",
    eastRank: 1,
    thsRank: 1,
    speculation: { boards: 2 },
    leadership: {
      recognized: true,
      persistentRecognition: true,
      coreIdentityQualified: false,
      history: { appearances: 3, coreHits: 1 },
      initiative: { score: 59, proactive: true, capacity: true, dataQuality: "收盘代理", session: null },
    },
  };
  const hayao = candidate("600664", "哈药股份", popularCoreFacts);
  const anonymousPositive = candidate("600665", "匿名人气核心", popularCoreFacts);
  const anonymousNegative = candidate("600666", "匿名缺历史核心", {
    ...popularCoreFacts,
    leadership: {
      ...popularCoreFacts.leadership,
      history: { appearances: 3, coreHits: 0 },
    },
  });
  const source = payload([anonymousNegative, hayao, anonymousPositive]);
  const basket = buildCoreEmotionBasket(source);
  const anchors = new Map(basket.emotionCycle.rankedAnchors.map((row) => [row.code, row]));
  const hayaoAnchor = anchors.get("600664");
  const positiveAnchor = anchors.get("600665");
  const negativeAnchor = anchors.get("600666");

  assert.equal(hayaoAnchor.board.exactConsecutive, false, "3天2板不得伪造成2连板");
  assert.equal(hayaoAnchor.layer, "A");
  assert.equal(hayaoAnchor.anchorRole, "popular_core");
  assert.equal(hayaoAnchor.signals.popularCore, true);
  assert.equal(hayaoAnchor.signals.proactiveCapacity, false, "capacity=true但主动容量分59未达B层门槛，不得压制popularCore");
  assert.ok(hayaoAnchor.influenceWeightPct > 0);
  assert.equal(positiveAnchor.layer, "A");
  assert.equal(positiveAnchor.anchorRole, "popular_core");
  assert.equal(positiveAnchor.anchorScore, hayaoAnchor.anchorScore, "同事实匿名样本必须与哈药同分同层");
  assert.equal(negativeAnchor.signals.popularCore, false);
  assert.equal(negativeAnchor.layer, "C", "只有双榜+持续性，没有历史核心影响不得晋A");
  assert.ok(basket.items.some((row) => row.code === "600664"), "popularCore交叉证据应通过核心篮子资格");
  assert.ok(basket.items.some((row) => row.code === "600665"));
  assert.ok(!basket.items.some((row) => row.code === "600666"));
});

test("popularCore does not weaken verified-role-alone and leave-one-out guardrails", () => {
  const selectedPopularCore = candidate("600667", "已选人气核心", {
    role: "高人气趋势样本",
    price: 10,
    changePct: 9,
    popularity: "3天2板",
    eastRank: 2,
    thsRank: 4,
    speculation: { boards: 2 },
    leadership: {
      recognized: true,
      persistentRecognition: true,
      history: { appearances: 2, coreHits: 1 },
    },
  });
  const roleOnly = candidate("600668", "仅题材角色", {
    role: "观察",
    changePct: 1,
    popularity: "首板",
    eastRank: 60,
    thsRank: 70,
    leadership: { recognized: false, persistentRecognition: false, history: { appearances: 0, coreHits: 0 } },
  });
  const basket = buildCoreEmotionBasket(payload([selectedPopularCore, roleOnly], {
    themeStocks: [themeCore(roleOnly.code, roleOnly.name)],
  }), { selectedCandidateCode: selectedPopularCore.code });
  const selected = basket.emotionCycle.rankedAnchors.find((row) => row.code === selectedPopularCore.code);
  const ordinary = basket.emotionCycle.rankedAnchors.find((row) => row.code === roleOnly.code);

  assert.equal(selected.layer, "A");
  assert.equal(selected.excludedFromMarketState, true);
  assert.equal(selected.influenceWeightPct, 0);
  assert.equal(selected.profitEffectWeightPct, 0);
  assert.equal(ordinary.layer, "C");
  assert.equal(ordinary.signals.popularCore, false);
});

test("stale completed lastSession is explicit and cannot manufacture profit effect", () => {
  const stale = candidate("600698", "stale-session-fixture", {
    popularity: "2-day 2-board",
    eastRank: 2,
    thsRank: 5,
    speculation: { boards: 2 },
    klineProfile: {
      lastSession: {
        verified: true,
        completed: true,
        snapshotKind: "closing",
        tradingDate: "2026-08-07",
        openChangePct: 10,
        currentChangePct: 10,
        maxChangePct: 10,
        minChangePct: 8,
        limitOpenCount: null,
        resealedAfterOpen: true,
        closedAtLimit: true,
      },
    },
    leadership: { persistentRecognition: true, history: { appearances: 3, coreHits: 1 } },
  });
  const anchor = buildEmotionCycleState({
    currentItems: [stale],
    tradingContext: { expectedPreviousTradingDate: "2026-08-10" },
  }).rankedAnchors[0];

  assert.equal(anchor.priceDiscoveryType, "unknown");
  assert.equal(anchor.priceDiscovery.source, "stale_last_session");
  assert.equal(anchor.priceDiscovery.dataQuality, "stale_last_session");
  assert.equal(anchor.profitEffectScore, null);
  assert.equal(anchor.profitEffectWeightPct, 0);
  assert.equal(anchor.profitEffect.dataQuality, "stale_last_session");
});

test("daily OHLC reseal stays conservative when the exact open count is unavailable", () => {
  const resealed = candidate("600697", "daily-ohlc-reseal-fixture", {
    popularity: "2-day 2-board",
    eastRank: 3,
    thsRank: 6,
    speculation: { boards: 2 },
    klineProfile: {
      lastSession: {
        verified: true,
        completed: true,
        snapshotKind: "closing",
        tradingDate: "2026-08-10",
        openChangePct: 10,
        currentChangePct: 10,
        maxChangePct: 10,
        minChangePct: 8,
        limitOpenCount: null,
        resealedAfterOpen: true,
        closedAtLimit: true,
        oneWord: false,
      },
    },
    leadership: { persistentRecognition: true, history: { appearances: 3, coreHits: 1 } },
  });
  const anchor = buildEmotionCycleState({
    currentItems: [resealed],
    tradingContext: { expectedPreviousTradingDate: "2026-08-10" },
  }).rankedAnchors[0];
  const evidence = anchor.priceDiscovery.evidence.join(" ");

  assert.equal(anchor.priceDiscoveryType, "turnover_reseal");
  assert.match(evidence, /exact open count|\u7cbe\u786e\u5f00\u677f\u6b21\u6570/i);
  assert.doesNotMatch(evidence, /\u5f00\u677f1\u6b21|opened exactly once/i);
});

test("one-word height consensus never counts as participatory emotion or climax confirmation", () => {
  const lockedHeight = directEmotionStock("601001", "一字高度一", {
    boardLabel: "6天6板",
    boards: 6,
    eastRank: 1,
    thsRank: 2,
    currentChangePct: 10,
    maxChangePct: 10,
    minChangePct: 10,
    openChangePct: 10,
    oneWord: true,
    closedAtLimit: true,
  });
  const lockedLeader = directEmotionStock("601002", "一字龙头二", {
    boardLabel: "5天5板",
    boards: 5,
    eastRank: 3,
    thsRank: 4,
    currentChangePct: 10,
    maxChangePct: 10,
    minChangePct: 10,
    openChangePct: 10,
    oneWord: true,
    closedAtLimit: true,
  });
  const tradedPioneer = directEmotionStock("601003", "换手先锋", {
    role: "启动先锋",
    boardLabel: "首板",
    boards: 1,
    eastRank: 20,
    thsRank: 25,
    verifiedThemeRoles: ["pioneer"],
    currentChangePct: 7,
    maxChangePct: 8,
    minChangePct: 2,
    openChangePct: 3,
  });
  const state = buildEmotionCycleState({ currentItems: [lockedHeight, lockedLeader, tradedPioneer] });
  const locked = state.rankedAnchors.filter((row) => row.current.oneWord);

  assert.equal(locked.length, 2);
  assert.ok(locked.every((row) => row.participation.marketEmotionEligible === false));
  assert.ok(locked.every((row) => row.participation.climaxEligible === false));
  assert.ok(locked.every((row) => row.participation.heightConsensusEligible === true));
  assert.equal(state.participation.oneWordExcludedCount, 2);
  assert.equal(state.participation.climaxEligibleCount, 1);
  assert.notEqual(state.current.key, "climax");
  assert.equal(state.current.consensusPhase.key, "climax", "一字高度只能进入独立的高度一致度层");
  assert.equal(state.current.participatoryPhase.key, state.current.phaseKey);
});

test("exact T-1 climax plus two tradable divergent cores with support intact becomes post-climax divergence", () => {
  const hayao = directEmotionStock("600664", "换手烂板核心", {
    boardLabel: "3天3板",
    boards: 3,
    eastRank: 1,
    thsRank: 2,
    currentChangePct: 10,
    openChangePct: 4,
    maxChangePct: 10,
    minChangePct: 1,
    limitTouched: true,
    limitOpenCount: 4,
    resealedAfterOpen: true,
    closedAtLimit: true,
  });
  const fenghua = directEmotionStock("000636", "趋势核心分歧回封", {
    role: "中军",
    verifiedThemeRoles: ["capacity"],
    capacity: true,
    initiativeScore: 82,
    proactive: true,
    amountYi: 120,
    boardLabel: "2天2板",
    boards: 2,
    eastRank: 4,
    thsRank: 6,
    currentChangePct: 10,
    openChangePct: -1,
    maxChangePct: 10,
    minChangePct: -2,
    limitTouched: true,
    limitOpenCount: 2,
    resealedAfterOpen: true,
    closedAtLimit: true,
  });
  const breadth = directEmotionStock("001001", "换手宽度", {
    role: "启动先锋",
    boardLabel: "首板",
    boards: 1,
    eastRank: 30,
    thsRank: 35,
    persistentRecognition: false,
    appearances: 0,
    coreHits: 0,
    verifiedThemeRoles: ["pioneer"],
    currentChangePct: 5,
    openChangePct: 1,
    maxChangePct: 7,
    minChangePct: -1,
  });
  const state = buildEmotionCycleState({
    currentItems: [hayao, fenghua, breadth],
    exactPreviousTradingDay: true,
    tradingContext: verifiedExactT1Context(),
    previousState: { key: "climax", confidence: 84 },
  });

  assert.equal(state.previous.exactCanonical, true);
  assert.equal(state.previous.participatoryPhase.key, "climax");
  assert.equal(state.previous.consensusPhase.key, "unknown");
  assert.equal(state.current.key, "realization", "保留旧下游可识别的兼容key");
  assert.equal(state.current.legacyKey, "realization");
  assert.equal(state.current.phaseKey, "post_climax_divergence");
  assert.equal(state.current.label, "高潮后·中等分歧");
  assert.equal(state.current.divergenceIntensity.key, "medium");
  assert.equal(state.current.divergenceQuality.key, "benign");
  assert.equal(state.current.supportState.key, "strong");
  assert.equal(state.phaseQuality.key, "support_intact");
  assert.equal(state.phaseQuality.label, "暂偏良性");
  assert.ok(state.participation.divergentAnchorCount >= 2);
  assert.ok(state.participation.supportedDivergenceCount >= 2);
});

test("one deep-water reseal is only an individual local repair and cannot upgrade the whole market", () => {
  const deepRepair = directEmotionStock("001258", "深水回封样本", {
    boardLabel: "2天2板",
    boards: 2,
    eastRank: 3,
    thsRank: 5,
    currentChangePct: 10,
    openChangePct: -4,
    maxChangePct: 10,
    minChangePct: -9,
    limitTouched: true,
    limitOpenCount: 1,
    resealedAfterOpen: true,
    closedAtLimit: true,
  });
  const steadyCore = directEmotionStock("001259", "稳定核心", {
    currentChangePct: 8,
    openChangePct: 8,
    maxChangePct: 9,
    minChangePct: 7,
  });
  const breadth = directEmotionStock("001260", "稳定宽度", {
    role: "启动先锋",
    boardLabel: "首板",
    boards: 1,
    verifiedThemeRoles: ["pioneer"],
    persistentRecognition: false,
    appearances: 0,
    coreHits: 0,
    currentChangePct: 5,
    openChangePct: 4,
    maxChangePct: 6,
    minChangePct: 3,
  });
  const state = buildEmotionCycleState({
    currentItems: [deepRepair, steadyCore, breadth],
    exactPreviousTradingDay: true,
    tradingContext: verifiedExactT1Context(),
    previousState: { key: "climax" },
  });
  const repaired = state.rankedAnchors.find((row) => row.code === "001258");

  assert.equal(repaired.participation.individualState, "local_repair");
  assert.equal(state.participation.localRepairCount, 1);
  assert.notEqual(state.current.key, "support");
  assert.notEqual(state.current.phaseKey, "post_climax_divergence");
});

test("post-climax wording requires exact T-1 and two failed repairs are needed for realization", () => {
  const failedOne = directEmotionStock("002001", "修复失败一", {
    currentChangePct: 6,
    openChangePct: 7,
    maxChangePct: 10,
    minChangePct: 4,
    limitTouched: true,
    closedAtLimit: false,
    postTouchMaxPullbackPct: 3,
  });
  const failedTwo = directEmotionStock("002002", "修复失败二", {
    boardLabel: "4天4板",
    boards: 4,
    currentChangePct: 5,
    openChangePct: 6,
    maxChangePct: 10,
    minChangePct: 3,
    limitTouched: true,
    closedAtLimit: false,
    postTouchMaxPullbackPct: 4,
  });
  const breadth = directEmotionStock("002003", "失败扩散样本", {
    role: "启动先锋",
    boardLabel: "首板",
    boards: 1,
    verifiedThemeRoles: ["pioneer"],
    persistentRecognition: false,
    appearances: 0,
    coreHits: 0,
    currentChangePct: -1,
    openChangePct: 3,
    maxChangePct: 5,
    minChangePct: -2,
  });
  const exact = buildEmotionCycleState({
    currentItems: [failedOne, failedTwo, breadth],
    exactPreviousTradingDay: true,
    tradingContext: verifiedExactT1Context(),
    previousState: { key: "climax" },
  });
  const missingT1 = buildEmotionCycleState({ currentItems: [failedOne, failedTwo, breadth] });
  const singleFailure = buildEmotionCycleState({
    currentItems: [failedOne, steadyParticipatingCore(), breadth],
    exactPreviousTradingDay: true,
    tradingContext: verifiedExactT1Context(),
    previousState: { key: "climax" },
  });

  assert.equal(exact.participation.repairFailedCount, 2);
  assert.equal(exact.current.key, "realization");
  assert.notEqual(singleFailure.current.key, "realization");
  assert.notEqual(singleFailure.current.key, "retreat");
  assert.notEqual(missingT1.current.phaseKey, "post_climax_divergence");
  assert.doesNotMatch(missingT1.current.label, /高潮后/);
});

test("exact T-1 canonical state carries its verified trading-date identity", () => {
  const exact = buildEmotionCycleState({
    currentItems: [],
    exactPreviousTradingDay: true,
    previousState: { key: "harmful", label: "非良性分歧" },
    tradingContext: {
      tradingDate: "2026-08-24",
      expectedPreviousTradingDate: "2026-08-21",
      previousTradingDate: "2026-08-21",
      previousSnapshotKind: "closing",
      exactPreviousTradingDay: true,
      previousEvidenceVerified: true,
    },
  });
  assert.equal(exact.previous.available, true);
  assert.equal(exact.previous.exactCanonical, true);
  assert.equal(exact.previous.tradingDate, "2026-08-21");
  assert.equal(exact.previous.authority, "canonical_exact_closing_state");
  assert.equal(exact.previous.exactPreviousTradingDay, true);
  assert.equal(exact.dataQuality.previousStateDateAligned, true);

  const mismatched = buildEmotionCycleState({
    currentItems: [],
    exactPreviousTradingDay: true,
    previousState: { key: "harmful", label: "非良性分歧" },
    tradingContext: {
      tradingDate: "2026-08-24",
      expectedPreviousTradingDate: "2026-08-21",
      previousTradingDate: "2026-08-20",
      previousSnapshotKind: "closing",
      exactPreviousTradingDay: true,
      previousEvidenceVerified: true,
    },
  });
  assert.equal(mismatched.previous.available, false);
  assert.equal(mismatched.previous.exactCanonical, false);
  assert.equal(mismatched.previous.tradingDate, null);
  assert.equal(mismatched.previous.exactPreviousTradingDay, false);
  assert.equal(mismatched.dataQuality.previousStateDateAligned, false);
  assert.equal(mismatched.current.crossDayVerified, false);

  for (const tradingContext of [
    verifiedExactT1Context({ previousTradingDate: null }),
    verifiedExactT1Context({ expectedPreviousTradingDate: null, previousTradingDate: null }),
    verifiedExactT1Context({ previousSnapshotKind: "intraday" }),
    verifiedExactT1Context({ previousEvidenceVerified: false }),
    verifiedExactT1Context({
      tradingDate: "2026-08-20",
      expectedPreviousTradingDate: "2026-08-21",
      previousTradingDate: "2026-08-21",
    }),
  ]) {
    const rejected = buildEmotionCycleState({
      currentItems: [],
      exactPreviousTradingDay: true,
      previousState: { key: "harmful", label: "非良性分歧" },
      tradingContext,
    });
    assert.equal(rejected.previous.available, false);
    assert.equal(rejected.previous.exactCanonical, false);
    assert.equal(rejected.previous.tradingDate, null);
    assert.equal(rejected.current.crossDayVerified, false);
    assert.equal(rejected.dataQuality.exactPreviousTradingDay, false);
  }
});

function steadyParticipatingCore() {
  return directEmotionStock("002004", "稳定可参与核心", {
    currentChangePct: 7,
    openChangePct: 6,
    maxChangePct: 8,
    minChangePct: 5,
  });
}

test("verified exact-current closing path proxy contributes price movement without inventing intraday events", () => {
  const closingProxy = candidate("600696", "current-closing-path-proxy", {
    popularity: "3-day 2-board",
    eastRank: 2,
    thsRank: 4,
    speculation: { boards: 2 },
    leadership: {
      persistentRecognition: true,
      history: { appearances: 3, coreHits: 1 },
      initiative: {
        score: 62,
        proactive: true,
        dataQuality: "收盘路径代理",
        session: {
          verified: true,
          completed: true,
          snapshotKind: "closing",
          tradingDate: "2026-08-11",
          openChangePct: -2,
          currentChangePct: 10,
          maxChangePct: 10,
          minChangePct: -5,
          limitTouched: true,
          closedAtLimit: true,
          limitOpenCount: null,
          limitTouchCount: null,
          resealedAfterOpen: null,
          lastResealTime: null,
          finalSealMinutes: null,
        },
      },
    },
  });
  const state = buildEmotionCycleState({
    currentItems: [closingProxy],
    tradingContext: {
      tradingDate: "2026-08-11",
      expectedPreviousTradingDate: "2026-08-10",
    },
  });
  const anchor = state.rankedAnchors[0];
  const evidence = [
    ...(anchor.priceDiscovery.evidence || []),
    ...(anchor.support.evidence || []),
    anchor.support.breakdown.priceDiscovery.detail,
  ].join(" ");

  assert.equal(anchor.priceDiscovery.source, "trusted_current_closing_path_proxy");
  assert.equal(anchor.priceDiscovery.sessionGranularity, "closing_path_proxy");
  assert.equal(anchor.priceDiscoveryType, "turnover_limit");
  assert.equal(anchor.participation.marketEmotionEligible, true);
  assert.equal(anchor.participation.divergence, true);
  assert.equal(anchor.participation.facts.openedLimit, false);
  assert.equal(anchor.participation.facts.limitOpenCount, null);
  assert.equal(anchor.participation.facts.resealed, false);
  assert.equal(anchor.support.breakdown.turnoverReseal.score, 0);
  assert.equal(anchor.support.breakdown.turnoverReseal.verified, false);
  assert.match(evidence, /收盘.*OHLC|OHLC.*收盘/);
  assert.doesNotMatch(evidence, /开板\d+次|尾盘回封|均线承接/);

  const stale = buildEmotionCycleState({
    currentItems: [closingProxy],
    tradingContext: { tradingDate: "2026-08-12" },
  }).rankedAnchors[0];
  assert.equal(stale.priceDiscoveryType, "unknown", "收盘路径代理日期不等于当前交易日时不得参与");
});

test("post-heat follows exact T-1 participatory acceleration plus current breadth even without one-word consensus", () => {
  const first = directEmotionStock("002101", "supported-core-one", {
    boardLabel: "3天3板",
    boards: 3,
    currentChangePct: 10,
    openChangePct: 2,
    maxChangePct: 10,
    minChangePct: -1,
    limitTouched: true,
    limitOpenCount: 2,
    resealedAfterOpen: true,
    closedAtLimit: true,
  });
  const second = directEmotionStock("002102", "supported-core-two", {
    role: "中军",
    verifiedThemeRoles: ["capacity"],
    capacity: true,
    initiativeScore: 82,
    amountYi: 100,
    currentChangePct: 10,
    openChangePct: 1,
    maxChangePct: 10,
    minChangePct: -2,
    limitTouched: true,
    limitOpenCount: 1,
    resealedAfterOpen: true,
    closedAtLimit: true,
  });
  const breadth = directEmotionStock("002103", "participatory-breadth", {
    role: "启动先锋",
    boardLabel: "首板",
    boards: 1,
    verifiedThemeRoles: ["pioneer"],
    persistentRecognition: false,
    appearances: 0,
    coreHits: 0,
    currentChangePct: 10,
    openChangePct: 3,
    maxChangePct: 10,
    minChangePct: 1,
  });
  const exactBase = {
    exactPreviousTradingDay: true,
    tradingContext: verifiedExactT1Context(),
  };
  const accelerationOnly = buildEmotionCycleState({
    ...exactBase,
    currentItems: [first, second, breadth],
    previousState: { key: "acceleration" },
  });
  const consensusWithoutBreadth = buildEmotionCycleState({
    ...exactBase,
    currentItems: [first, second],
    previousState: { key: "acceleration", consensusPhase: "climax" },
  });
  const consensusWithBreadth = buildEmotionCycleState({
    ...exactBase,
    currentItems: [first, second, breadth],
    previousState: { key: "acceleration", consensusPhase: "climax" },
  });

  assert.equal(accelerationOnly.current.phaseKey, "post_heat_divergence");
  assert.equal(accelerationOnly.current.label, "高热后·中等分歧");
  assert.equal(accelerationOnly.current.divergenceIntensity.key, "medium");
  assert.equal(accelerationOnly.current.previousHeatBasis, "participatory_acceleration_plus_current_breadth");
  assert.equal(accelerationOnly.previous.participatoryPhase.key, "acceleration");
  assert.equal(accelerationOnly.previous.consensusPhase.key, "unknown");
  assert.notEqual(consensusWithoutBreadth.current.phaseKey, "post_climax_divergence");
  assert.equal(consensusWithBreadth.previous.consensusPhase.key, "climax");
  assert.equal(consensusWithBreadth.current.phaseKey, "post_heat_divergence");
  assert.equal(consensusWithBreadth.current.label, "高热后·中等分歧");
  assert.equal(consensusWithBreadth.current.previousClimaxBasis, null);
  assert.equal(consensusWithBreadth.current.previousHeatBasis, "participatory_acceleration_plus_current_breadth");
});

test("real-count regression: 12 primary divergences and 8 intact supports outrank two hot anchors", () => {
  const rows = Array.from({ length: 12 }, (_, index) => {
    const supported = index < 8;
    const highAnchor = index < 2;
    return directEmotionStock(String(603000 + index), `real-session-core-${index + 1}`, {
      role: highAnchor ? (index === 0 ? "龙头" : "高度核心") : "中军",
      verifiedThemeRoles: highAnchor ? [index === 0 ? "leader" : "height"] : ["capacity"],
      boardLabel: highAnchor ? "3天3板" : "2天2板",
      boards: highAnchor ? 3 : 2,
      eastRank: highAnchor ? index + 1 : 20 + index,
      thsRank: highAnchor ? index + 2 : 30 + index,
      amountYi: highAnchor ? 30 : 100,
      capacity: !highAnchor,
      proactive: !highAnchor,
      initiativeScore: highAnchor ? 68 : 82,
      currentChangePct: supported ? 10 : 5,
      openChangePct: supported ? 2 : 7,
      maxChangePct: 10,
      minChangePct: supported ? 0 : 3,
      limitTouched: supported,
      limitOpenCount: supported ? 2 : 0,
      resealedAfterOpen: supported,
      closedAtLimit: supported,
    });
  });
  const state = buildEmotionCycleState({
    currentItems: rows,
    exactPreviousTradingDay: true,
    tradingContext: verifiedExactT1Context(),
    previousState: { key: "acceleration", consensusPhase: "climax", confidence: 68 },
  });

  assert.equal(state.participation.primaryEligibleCount, 12);
  assert.equal(state.participation.divergentAnchorCount, 12);
  assert.equal(state.participation.supportedDivergenceCount, 8);
  assert.equal(state.metrics.heat.climaxAnchorCount, 2);
  assert.equal(state.current.key, "realization");
  assert.equal(state.current.phaseKey, "post_heat_divergence");
  assert.equal(state.current.label, "高热后·中等分歧");
  assert.equal(state.current.divergenceIntensity.key, "medium");
  assert.equal(state.current.divergenceQuality.key, "benign");
  assert.equal(state.phaseQuality.key, "support_intact");
});
