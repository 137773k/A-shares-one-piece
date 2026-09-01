"use strict";

const assert = require("assert");
const path = require("path");
const test = require("node:test");

const themeLibraryPath = process.env.THEME_LIBRARY_MODULE
  ? path.resolve(process.env.THEME_LIBRARY_MODULE)
  : path.join(__dirname, "theme-library");
const {
  THEME_LIBRARY_CLASSIFIER_VERSION,
  buildThemeLibrarySnapshot,
} = require(themeLibraryPath);

const THEME_KEY = "THEME_ANONYMOUS";

function initiative(tradingDate, overrides = {}) {
  return {
    proactive: false,
    dataQuality: "分时验证",
    tradingDate,
    source: "anonymous_intraday_fixture",
    firstAttackTime: null,
    followerCount: 0,
    breadthLift: 0,
    priceDiscovery: { noPriceDiscovery: false },
    ...overrides,
  };
}

function leadership(tradingDate, overrides = {}) {
  const base = {
    persistentRecognition: false,
    impactScore: 0,
    structure: { frameworkIntact: true, breakdown: false },
    history: { appearances: 1, coreHits: 0, activeHits: 0 },
    initiative: initiative(tradingDate),
  };
  return {
    ...base,
    ...overrides,
    structure: { ...base.structure, ...(overrides.structure || {}) },
    history: { ...base.history, ...(overrides.history || {}) },
    initiative: { ...base.initiative, ...(overrides.initiative || {}) },
  };
}

function stock(code, tradingDate, overrides = {}) {
  const base = {
    code,
    name: code,
    mainFamily: THEME_KEY,
    mainConcept: THEME_KEY,
    concepts: [THEME_KEY],
    themeAttribution: {
      verified: true,
      selectionEligible: true,
      conflict: false,
      primaryThemeName: THEME_KEY,
    },
    role: "后排观察",
    score: 80,
    combinedRank: 20,
    eastRank: 20,
    thsRank: 20,
    inBothSources: true,
    changePct: 2,
    amountYi: 20,
    leadership: leadership(tradingDate),
  };
  return {
    ...base,
    ...overrides,
    leadership: overrides.leadership || base.leadership,
  };
}

function payload(tradingDate, previousTradingDate, candidates, options = {}) {
  const themeFamily = options.themeFamily || THEME_KEY;
  const topicLeader = options.topicLeaderCode
    ? candidates.find((row) => row.code === options.topicLeaderCode)
    : candidates[0];
  return {
    fetchedAt: `${tradingDate}T07:10:00.000Z`,
    archiveMeta: { tradingDate, snapshotKind: options.snapshotKind || "closing" },
    market: {
      cycleLabel: options.marketCycleLabel || "main_rise",
      limitStats: {
        dates: {
          today: tradingDate,
          prev: previousTradingDate,
          verified: options.providerDatesVerified !== false,
        },
      },
    },
    topicBoard: {
      mainLine: { name: THEME_KEY, family: themeFamily },
      items: [{
        name: THEME_KEY,
        family: themeFamily,
        displayName: THEME_KEY,
        aliases: Array.isArray(options.themeAliases) ? options.themeAliases : [],
        matchNames: [
          THEME_KEY,
          ...(Array.isArray(options.themeAliases) ? options.themeAliases : []),
        ],
        label: options.themeLabel || "主线持续",
        sustained: options.sustained !== false,
        resonance: options.resonance === true,
        reasons: Array.isArray(options.themeReasons) ? options.themeReasons : [],
        score: 240,
        count: candidates.length,
        limitCount: candidates.filter((row) => Number(row.changePct || 0) >= 9.8).length,
        leader: topicLeader,
        leaders: topicLeader ? [topicLeader] : [],
      }],
    },
    candidates,
  };
}

function buildDay(dayPayload, previousThemeLibrary = null, options = {}) {
  return buildThemeLibrarySnapshot(dayPayload, {
    sourceMode: options.sourceMode || "anonymous-theme-role-contract-test",
    snapshotKind: dayPayload.archiveMeta.snapshotKind,
    generatedAt: `${dayPayload.archiveMeta.tradingDate}T07:20:00.000Z`,
    previousThemeLibrary,
  });
}

function onlyTheme(snapshot) {
  assert.strictEqual(snapshot.themes.length, 1, "anonymous fixture must create exactly one theme");
  return snapshot.themes[0];
}

function roleCards(theme) {
  assert.ok(
    Array.isArray(theme.roleEvidenceCards),
    "theme must expose roleEvidenceCards instead of asking the UI to infer leaders from daily height",
  );
  assert.strictEqual(theme.roleEvidenceCards.length, 2, "each theme must expose exactly two leader axes");
  assert.deepStrictEqual(
    theme.roleEvidenceCards.map((card) => card.roleKey),
    ["cycleLeader", "dailyLeader"],
    "the two stable axes are cycleLeader and dailyLeader",
  );
  return Object.fromEntries(theme.roleEvidenceCards.map((card) => [card.roleKey, card]));
}

function assertTraceableRole(card, tradingDate) {
  assert.ok(card && typeof card === "object");
  assert.strictEqual(card.tradingDate, tradingDate, `${card.roleKey} must identify its evidence trading date`);
  assert.strictEqual(typeof card.source, "string", `${card.roleKey} must identify its source`);
  assert.ok(card.source.length > 0, `${card.roleKey} source cannot be blank`);
  assert.ok(Array.isArray(card.evidence), `${card.roleKey} evidence must be an array`);
  assert.ok(card.evidence.length > 0, `${card.roleKey} must explain the result even when it is none/unavailable`);
  card.evidence.forEach((row) => {
    assert.ok(row && typeof row.key === "string" && row.key.length > 0, "evidence key is required");
    assert.ok(typeof row.source === "string" && row.source.length > 0, "evidence source is required");
    assert.strictEqual(row.tradingDate, tradingDate, "evidence cannot borrow another session's date");
  });
  assert.ok(Array.isArray(card.gaps), `${card.roleKey} gaps must always be explicit`);
  assert.strictEqual(card.executionEligible, false, "a role observation must never open trading permission");
}

function establishedLeaderDayOne() {
  const tradingDate = "2026-08-03";
  return buildDay(payload(tradingDate, "2026-07-31", [stock("ASSET_A", tradingDate, {
    changePct: 6,
    leadership: leadership(tradingDate, {
      persistentRecognition: true,
      impactScore: 35,
      history: { appearances: 2, coreHits: 1, activeHits: 1 },
      initiative: {
        proactive: true,
        firstAttackTime: "09:36",
        followerCount: 2,
        breadthLift: 1,
      },
    }),
  })]));
}

function confirmedLeader() {
  const first = establishedLeaderDayOne();
  const tradingDate = "2026-08-04";
  const second = buildDay(payload(tradingDate, "2026-08-03", [stock("ASSET_A", tradingDate, {
    changePct: 5,
    leadership: leadership(tradingDate, {
      persistentRecognition: true,
      impactScore: 35,
      history: { appearances: 3, coreHits: 2, activeHits: 2 },
      initiative: {
        proactive: true,
        firstAttackTime: "09:38",
        followerCount: 2,
        breadthLift: 1,
      },
    }),
  })]), first);
  return { first, second };
}

test("role contract always exposes the cycle-leader and daily-leader axes with traceable evidence", () => {
  const tradingDate = "2026-08-05";
  const snapshot = buildDay(payload(tradingDate, "2026-08-04", [stock("ASSET_A", tradingDate)]));
  const cards = roleCards(onlyTheme(snapshot));

  assertTraceableRole(cards.cycleLeader, tradingDate);
  assertTraceableRole(cards.dailyLeader, tradingDate);
  assert.strictEqual(cards.cycleLeader.roleScope, "cycle");
  assert.strictEqual(cards.dailyLeader.roleScope, "session");
  assert.strictEqual(cards.cycleLeader.status, "none", "complete evidence with no confirmed cycle identity is none");
  assert.strictEqual(cards.dailyLeader.status, "none", "verified same-day evidence with no active drive is none");
  assert.strictEqual(cards.cycleLeader.stock, null);
  assert.strictEqual(cards.dailyLeader.stock, null);
  assert.ok(cards.cycleLeader.gaps.length > 0);
  assert.ok(cards.dailyLeader.gaps.length > 0);
});

test("one strong limit-up session may be daily leader but cannot create a cycle leader", () => {
  const tradingDate = "2026-08-05";
  const oneDay = stock("ASSET_ONE_DAY", tradingDate, {
    role: "龙头",
    changePct: 10,
    combinedRank: 1,
    leadership: leadership(tradingDate, {
      persistentRecognition: true,
      impactScore: 45,
      history: { appearances: 1, coreHits: 1, activeHits: 1 },
      initiative: {
        proactive: true,
        firstAttackTime: "09:31",
        followerCount: 4,
        breadthLift: 2,
      },
    }),
  });
  const cards = roleCards(onlyTheme(buildDay(payload(tradingDate, "2026-08-04", [oneDay]))));

  assert.strictEqual(cards.cycleLeader.status, "none");
  assert.strictEqual(cards.cycleLeader.stock, null);
  assert.strictEqual(cards.dailyLeader.status, "confirmed");
  assert.strictEqual(cards.dailyLeader.stock.code, "ASSET_ONE_DAY");
});

test("exact raw concepts membership may supply observation evidence without attribution or execution authority", () => {
  const firstDate = "2026-08-03";
  const firstMember = stock("ASSET_EXACT_MEMBER", firstDate, {
    mainFamily: "",
    mainConcept: "",
    concepts: [THEME_KEY],
    leadership: leadership(firstDate, {
      persistentRecognition: true,
      impactScore: 35,
      history: { appearances: 2, coreHits: 1, activeHits: 1 },
      initiative: {
        proactive: true,
        firstAttackTime: "09:36",
        followerCount: 2,
        breadthLift: 1,
      },
    }),
  });
  delete firstMember.themeAttribution;
  const first = buildDay(payload(firstDate, "2026-07-31", [firstMember]));

  const secondDate = "2026-08-04";
  const secondMember = stock("ASSET_EXACT_MEMBER", secondDate, {
    mainFamily: "",
    mainConcept: "",
    concepts: [THEME_KEY],
    leadership: leadership(secondDate, {
      persistentRecognition: true,
      impactScore: 35,
      history: { appearances: 3, coreHits: 2, activeHits: 2 },
      initiative: {
        proactive: true,
        firstAttackTime: "09:38",
        followerCount: 2,
        breadthLift: 1,
      },
    }),
  });
  delete secondMember.themeAttribution;
  const second = buildDay(payload(secondDate, firstDate, [secondMember]), first);
  const theme = onlyTheme(second);

  assert.strictEqual(
    theme.cycleLeadership.primary && theme.cycleLeadership.primary.identityEstablished,
    true,
    "exact membership in raw concepts must not be permanently frozen by missing attribution",
  );
  assert.strictEqual(theme.cycleLeadership.primary.code, "ASSET_EXACT_MEMBER");
  const cards = roleCards(theme);
  assert.strictEqual(cards.cycleLeader.stock.code, "ASSET_EXACT_MEMBER");
  assert.strictEqual(cards.cycleLeader.executionEligible, false);
  assert.strictEqual(theme.roleAuthorityByCode.ASSET_EXACT_MEMBER.cycleLeader, false);
  assert.strictEqual(theme.roleAuthorityByCode.ASSET_EXACT_MEMBER.executionEligible, false);
  assert.strictEqual(theme.directExecutionEligible, false);
  assert.strictEqual(secondMember.themeAttribution, undefined, "test must not smuggle in selection eligibility");
});

test("mainConcept or alias-only fuzzy association cannot establish cycle identity", () => {
  const alias = "THEME_ALIAS_ONLY";
  const memberFor = (tradingDate) => {
    const row = stock("ASSET_ALIAS_ONLY", tradingDate, {
      mainFamily: "",
      mainConcept: alias,
      concepts: [],
      leadership: leadership(tradingDate, {
        persistentRecognition: true,
        impactScore: 45,
        history: { appearances: 3, coreHits: 2, activeHits: 2 },
        initiative: {
          proactive: true,
          firstAttackTime: "09:31",
          followerCount: 5,
          breadthLift: 3,
        },
      }),
    });
    delete row.themeAttribution;
    return row;
  };
  const first = buildDay(payload("2026-08-03", "2026-07-31", [memberFor("2026-08-03")], {
    themeAliases: [alias],
  }));
  const second = buildDay(payload("2026-08-04", "2026-08-03", [memberFor("2026-08-04")], {
    themeAliases: [alias],
  }), first);
  const theme = onlyTheme(second);
  const identity = theme.cycleLeadership.identities.ASSET_ALIAS_ONLY;

  assert.ok(!identity || identity.identityEstablished !== true, "fuzzy alias association cannot vote for cycle identity");
  const cards = roleCards(theme);
  assert.notStrictEqual(cards.cycleLeader.status, "confirmed");
  assert.strictEqual(cards.cycleLeader.stock, null);
});

test("raw concepts matching only a parent family cannot establish a specific-theme cycle identity", () => {
  const parentFamily = "PARENT_THEME_ONLY";
  const memberFor = (tradingDate) => {
    const row = stock("ASSET_PARENT_CONCEPT", tradingDate, {
      mainFamily: parentFamily,
      mainConcept: parentFamily,
      concepts: [parentFamily],
      leadership: leadership(tradingDate, {
        persistentRecognition: true,
        impactScore: 45,
        history: { appearances: 3, coreHits: 2, activeHits: 2 },
        initiative: {
          proactive: true,
          firstAttackTime: "09:31",
          followerCount: 5,
          breadthLift: 3,
        },
      }),
    });
    delete row.themeAttribution;
    return row;
  };
  const first = buildDay(payload("2026-08-03", "2026-07-31", [memberFor("2026-08-03")], {
    themeFamily: parentFamily,
  }));
  const second = buildDay(payload("2026-08-04", "2026-08-03", [memberFor("2026-08-04")], {
    themeFamily: parentFamily,
  }), first);
  const theme = onlyTheme(second);
  const identity = theme.cycleLeadership.identities.ASSET_PARENT_CONCEPT;

  assert.ok(!identity || identity.identityEstablished !== true, "parent-family raw concept cannot vote for the specific theme cycle");
  const cards = roleCards(theme);
  assert.notStrictEqual(cards.cycleLeader.status, "confirmed");
  assert.strictEqual(cards.cycleLeader.stock, null);
});

test("verified parentThemeName alone cannot establish a specific-theme cycle identity", () => {
  const parentFamily = "PARENT_ATTRIBUTION_ONLY";
  const memberFor = (tradingDate) => stock("ASSET_PARENT_ATTRIBUTION", tradingDate, {
    mainFamily: parentFamily,
    mainConcept: parentFamily,
    concepts: [],
    themeAttribution: {
      verified: true,
      selectionEligible: true,
      conflict: false,
      primaryThemeName: "",
      fineThemeName: "",
      parentThemeName: parentFamily,
    },
    leadership: leadership(tradingDate, {
      persistentRecognition: true,
      impactScore: 45,
      history: { appearances: 3, coreHits: 2, activeHits: 2 },
      initiative: {
        proactive: true,
        firstAttackTime: "09:31",
        followerCount: 5,
        breadthLift: 3,
      },
    }),
  });
  const first = buildDay(payload("2026-08-03", "2026-07-31", [memberFor("2026-08-03")], {
    themeFamily: parentFamily,
  }));
  const second = buildDay(payload("2026-08-04", "2026-08-03", [memberFor("2026-08-04")], {
    themeFamily: parentFamily,
  }), first);
  const theme = onlyTheme(second);
  const identity = theme.cycleLeadership.identities.ASSET_PARENT_ATTRIBUTION;

  assert.ok(!identity || identity.identityEstablished !== true, "parentThemeName cannot vote for a specific-theme cycle");
  const cards = roleCards(theme);
  assert.notStrictEqual(cards.cycleLeader.status, "confirmed");
  assert.strictEqual(cards.cycleLeader.stock, null);
});

test("cycle leader and daily leader are independent axes and may point to the same stock", () => {
  const { second } = confirmedLeader();
  const theme = onlyTheme(second);
  const cards = roleCards(theme);

  assert.strictEqual(cards.cycleLeader.status, "confirmed");
  assert.strictEqual(cards.dailyLeader.status, "confirmed");
  assert.strictEqual(cards.cycleLeader.stock.code, "ASSET_A");
  assert.strictEqual(cards.dailyLeader.stock.code, "ASSET_A");
  assert.strictEqual(theme.roleAuthorityByCode.ASSET_A.cycleLeader, true);
  assert.strictEqual(theme.roleAuthorityByCode.ASSET_A.executionEligible, true);
  assert.ok(cards.cycleLeader.evidence.some((row) => row.key === "cycle_identity_established" && row.value === true));
  assert.ok(cards.dailyLeader.evidence.some((row) => row.key === "same_day_proactive" && row.value === true));
  assert.ok(cards.dailyLeader.evidence.some((row) => (
    row.key === "follower_count" && Number(row.value) > 0
  ) || (
    row.key === "breadth_lift" && Number(row.value) > 0
  )), "daily leader requires observed same-day follower or breadth impact");
});

test("an ordinary weak day retains the established cycle leader without daily re-confirmation", () => {
  const { second } = confirmedLeader();
  const tradingDate = "2026-08-05";
  const weak = stock("ASSET_A", tradingDate, {
    changePct: -1.5,
    leadership: leadership(tradingDate, {
      persistentRecognition: true,
      impactScore: 0,
      history: { appearances: 4, coreHits: 2, activeHits: 2 },
    }),
  });
  const theme = onlyTheme(buildDay(payload(tradingDate, "2026-08-04", [weak]), second));
  const cards = roleCards(theme);

  assert.strictEqual(cards.cycleLeader.status, "retained");
  assert.strictEqual(cards.cycleLeader.stock.code, "ASSET_A");
  assert.strictEqual(cards.cycleLeader.executionEligible, false);
});

test("retained cycle identity discloses closing-proxy evidence quality without losing identity", () => {
  const { second } = confirmedLeader();
  const tradingDate = "2026-08-05";
  const proxyOnly = stock("ASSET_A", tradingDate, {
    changePct: -0.8,
    leadership: leadership(tradingDate, {
      persistentRecognition: true,
      impactScore: 0,
      history: { appearances: 4, coreHits: 2, activeHits: 2 },
      initiative: {
        proactive: false,
        dataQuality: "收盘路径代理",
        source: "anonymous_closing_proxy_fixture",
        firstAttackTime: null,
        followerCount: 0,
        breadthLift: 0,
      },
    }),
  });
  const theme = onlyTheme(buildDay(payload(tradingDate, "2026-08-04", [proxyOnly]), second));
  const cards = roleCards(theme);

  assert.strictEqual(cards.cycleLeader.status, "retained", "evidence quality disclosure must not erase established identity");
  assert.strictEqual(cards.cycleLeader.stock.code, "ASSET_A");
  assert.ok(cards.cycleLeader.evidence.some((row) => (
    row.key === "identity_evidence_quality" && row.value === "收盘路径代理"
  )), "cycle card must disclose the non-intraday identity evidence quality");
  assert.ok(cards.cycleLeader.gaps.some((gap) => (
    /尚未验证分时层面的真实跨股票因果带动/.test(String(gap))
  )), "cycle card must state that real intraday cross-stock causality is not verified");
  assert.strictEqual(cards.cycleLeader.executionEligible, false);
});

test("historical proxy confirmation days remain disclosed even when the current day has intraday data", () => {
  const memberFor = (tradingDate, dataQuality, impactScore) => stock("ASSET_HISTORY_QUALITY", tradingDate, {
    changePct: impactScore > 0 ? 5 : -0.5,
    leadership: leadership(tradingDate, {
      persistentRecognition: true,
      impactScore,
      history: { appearances: 4, coreHits: 3, activeHits: 2 },
      initiative: {
        proactive: impactScore > 0,
        dataQuality,
        source: `quality_fixture_${tradingDate}`,
        firstAttackTime: impactScore > 0 ? "09:35" : null,
        followerCount: impactScore > 0 ? 2 : 0,
        breadthLift: impactScore > 0 ? 1 : 0,
      },
    }),
  });
  const first = buildDay(payload("2026-08-03", "2026-07-31", [
    memberFor("2026-08-03", "收盘路径代理", 35),
  ]));
  const second = buildDay(payload("2026-08-04", "2026-08-03", [
    memberFor("2026-08-04", "收盘路径代理", 35),
  ]), first);
  const third = buildDay(payload("2026-08-05", "2026-08-04", [
    memberFor("2026-08-05", "分时验证", 0),
  ]), second);
  const card = roleCards(onlyTheme(third)).cycleLeader;
  const historicalQuality = card.evidence.filter((row) => row.key === "identity_impact_evidence_quality");

  assert.strictEqual(card.status, "retained");
  assert.deepStrictEqual(
    historicalQuality.map((row) => [row.evidenceTradingDate, row.value]),
    [["2026-08-03", "收盘路径代理"], ["2026-08-04", "收盘路径代理"]],
  );
  historicalQuality.forEach((row) => assert.ok(typeof row.source === "string" && row.source.length > 0));
  assert.ok(card.gaps.some((gap) => /尚未验证分时层面的真实跨股票因果带动/.test(String(gap))));
});

test("theme-cycle label remains theme-level one-day risk while leader identity is retained separately", () => {
  const { second } = confirmedLeader();
  const tradingDate = "2026-08-05";
  const retainedLeader = stock("ASSET_A", tradingDate, {
    changePct: -1,
    leadership: leadership(tradingDate, {
      persistentRecognition: true,
      impactScore: 0,
      history: { appearances: 4, coreHits: 2, activeHits: 2 },
      initiative: {
        proactive: false,
        dataQuality: "收盘路径代理",
        firstAttackTime: null,
        followerCount: 0,
        breadthLift: 0,
      },
    }),
  });
  const theme = onlyTheme(buildDay(payload(tradingDate, "2026-08-04", [retainedLeader], {
    themeLabel: "一日游风险",
    sustained: false,
    resonance: false,
    themeReasons: ["题材内多数成员当日走弱"],
  }), second));
  const cards = roleCards(theme);

  assert.strictEqual(cards.cycleLeader.status, "retained", "leader identity remains an independent cross-day fact");
  assert.strictEqual(theme.themeCycle.topicLabel, "一日游风险", "theme cycle must preserve the topic-level label separately");
  assert.strictEqual(theme.themeCycle.label, "跨日仍在榜·明显走弱", "public label must describe the theme-cycle state, not the leader identity");
  assert.strictEqual(theme.themeCycle.leaderIdentityState, "retained");
  assert.strictEqual(theme.themeCycle.state, "weakening_risk", "explicit one-day risk must win over retained leader identity");
  assert.strictEqual(theme.themeCycle.sustained, false);
  assert.strictEqual(theme.themeCycle.resonance, false);
  assert.deepStrictEqual(theme.themeCycle.reasons, ["题材内多数成员当日走弱"]);
});

test("a damaged or limit-down cycle leader remains visible as challenged and non-executable", () => {
  const { second } = confirmedLeader();
  const tradingDate = "2026-08-05";
  const damaged = stock("ASSET_A", tradingDate, {
    changePct: -10,
    leadership: leadership(tradingDate, {
      persistentRecognition: true,
      impactScore: 0,
      structure: { frameworkIntact: false, breakdown: true },
      history: { appearances: 4, coreHits: 2, activeHits: 2 },
    }),
  });
  const theme = onlyTheme(buildDay(payload(tradingDate, "2026-08-04", [damaged]), second));
  const identity = theme.cycleLeadership.primary;

  assert.strictEqual(identity.code, "ASSET_A");
  assert.strictEqual(identity.state, "challenged");
  const cards = roleCards(theme);
  assert.strictEqual(cards.cycleLeader.status, "challenged");
  assert.strictEqual(cards.cycleLeader.stock.code, "ASSET_A");
  assert.strictEqual(cards.cycleLeader.executionEligible, false);
  const visible = theme.stocks.find((row) => row.code === "ASSET_A");
  assert.ok(visible, "challenged incumbent must remain in the current cycle-leader column");
  assert.ok(visible.roleKinds.includes("cycleLeader"));
});

test("one-day challenger cannot replace the incumbent cycle leader even when topicBoard.leader points at it", () => {
  const { second } = confirmedLeader();
  const tradingDate = "2026-08-05";
  const incumbent = stock("ASSET_A", tradingDate, {
    changePct: 1,
    leadership: leadership(tradingDate, {
      persistentRecognition: true,
      impactScore: 0,
      history: { appearances: 4, coreHits: 2, activeHits: 2 },
    }),
  });
  const challenger = stock("ASSET_B", tradingDate, {
    role: "龙头",
    changePct: 10,
    combinedRank: 1,
    leadership: leadership(tradingDate, {
      persistentRecognition: true,
      impactScore: 45,
      history: { appearances: 1, coreHits: 1, activeHits: 1 },
      initiative: {
        proactive: true,
        firstAttackTime: "09:30",
        followerCount: 5,
        breadthLift: 3,
      },
    }),
  });
  const theme = onlyTheme(buildDay(payload(tradingDate, "2026-08-04", [incumbent, challenger], {
    topicLeaderCode: "ASSET_B",
  }), second));
  const cards = roleCards(theme);

  assert.strictEqual(cards.cycleLeader.stock.code, "ASSET_A");
  assert.strictEqual(cards.cycleLeader.status, "retained");
  assert.strictEqual(cards.dailyLeader.stock.code, "ASSET_B", "the challenger may independently lead today's session");
  assert.strictEqual(theme.cycleLeadership.replacement, null);
});

test("daily leader uses exact same-day active-driving evidence and is capped at one stock per theme", () => {
  const tradingDate = "2026-08-05";
  const first = stock("ASSET_FIRST", tradingDate, {
    changePct: 6,
    leadership: leadership(tradingDate, {
      initiative: {
        proactive: true,
        firstAttackTime: "09:31",
        followerCount: 3,
        breadthLift: 2,
      },
    }),
  });
  const second = stock("ASSET_SECOND", tradingDate, {
    changePct: 7,
    combinedRank: 1,
    leadership: leadership(tradingDate, {
      initiative: {
        proactive: true,
        firstAttackTime: "09:34",
        followerCount: 5,
        breadthLift: 3,
      },
    }),
  });
  const theme = onlyTheme(buildDay(payload(tradingDate, "2026-08-04", [second, first])));
  const cards = roleCards(theme);

  assert.strictEqual(theme.roleEvidenceCards.filter((card) => card.roleKey === "dailyLeader").length, 1);
  assert.strictEqual(cards.dailyLeader.status, "confirmed");
  assert.strictEqual(cards.dailyLeader.stock.code, "ASSET_FIRST", "earliest verified active driver wins the daily role");
  assertTraceableRole(cards.dailyLeader, tradingDate);
});

test("stale active evidence cannot become today's leader or today's pioneer", () => {
  const tradingDate = "2026-08-05";
  const stale = stock("ASSET_STALE", tradingDate, {
    changePct: 7,
    leadership: leadership(tradingDate, {
      initiative: {
        proactive: true,
        tradingDate: "2026-08-04",
        firstAttackTime: "09:31",
        followerCount: 5,
        breadthLift: 3,
      },
    }),
  });
  const theme = onlyTheme(buildDay(payload(tradingDate, "2026-08-04", [stale])));

  assert.strictEqual(theme.dailyPioneerStocks.length, 0, "session roles must reject stale initiative evidence");
  const cards = roleCards(theme);
  assert.notStrictEqual(cards.dailyLeader.status, "confirmed");
  assert.strictEqual(cards.dailyLeader.stock, null);
});

test("daily height stays a separate risk observation and cannot masquerade as daily leader", () => {
  const tradingDate = "2026-08-05";
  const height = stock("ASSET_HEIGHT", tradingDate, {
    role: "龙头",
    changePct: 10,
    combinedRank: 1,
    leadership: leadership(tradingDate, {
      initiative: {
        proactive: false,
        firstAttackTime: null,
        followerCount: 0,
        breadthLift: 0,
      },
    }),
  });
  const theme = onlyTheme(buildDay(payload(tradingDate, "2026-08-04", [height])));
  const heightRow = theme.dailyHeightStocks.find((row) => row.code === "ASSET_HEIGHT");

  assert.ok(heightRow, "the high stock remains visible in dailyHeightStocks");
  assert.strictEqual(heightRow.status, "risk_watch");
  assert.strictEqual(heightRow.tradingDate, tradingDate);
  assert.ok(typeof heightRow.source === "string" && heightRow.source.length > 0);
  assert.ok(Array.isArray(heightRow.evidence) && heightRow.evidence.length > 0);
  heightRow.evidence.forEach((row) => {
    assert.ok(typeof row.source === "string" && row.source.length > 0);
    assert.strictEqual(row.tradingDate, tradingDate);
  });
  assert.ok(Array.isArray(heightRow.gaps));
  assert.strictEqual(heightRow.executionEligible, false);

  const cards = roleCards(theme);
  assert.strictEqual(cards.dailyLeader.status, "none");
  assert.strictEqual(cards.dailyLeader.stock, null);
});

test("missing theme-member evidence is unavailable, not a fabricated none result", () => {
  const tradingDate = "2026-08-05";
  const theme = onlyTheme(buildDay(payload(tradingDate, "2026-08-04", [])));
  const cards = roleCards(theme);

  assert.strictEqual(cards.cycleLeader.status, "unavailable");
  assert.strictEqual(cards.dailyLeader.status, "unavailable");
  assert.strictEqual(cards.cycleLeader.stock, null);
  assert.strictEqual(cards.dailyLeader.stock, null);
  assert.ok(cards.cycleLeader.gaps.length > 0);
  assert.ok(cards.dailyLeader.gaps.length > 0);
  assertTraceableRole(cards.cycleLeader, tradingDate);
  assertTraceableRole(cards.dailyLeader, tradingDate);
});

test("theme-cycle history is derived from the exact previous snapshot before API decoration", () => {
  const { second } = confirmedLeader();
  const theme = onlyTheme(second);

  assert.strictEqual(theme.themeCycle.history.continued, true);
  assert.strictEqual(theme.themeCycle.history.isNew, false);
  assert.strictEqual(theme.themeCycle.history.comparisonUnavailable, false);
  assert.strictEqual(theme.themeCycle.state, "continued_unverified");
  assert.strictEqual(theme.themeCycle.label, "跨日仍在榜·强度待确认");
});

test("legacy or archive replay classification is disclosed without rewriting it as an original archived confirmation", () => {
  const first = establishedLeaderDayOne();
  const tradingDate = "2026-08-04";
  const second = buildDay(payload(tradingDate, "2026-08-03", [stock("ASSET_A", tradingDate, {
    changePct: 5,
    leadership: leadership(tradingDate, {
      persistentRecognition: true,
      impactScore: 35,
      history: { appearances: 3, coreHits: 2, activeHits: 2 },
      initiative: { proactive: true, firstAttackTime: "09:38", followerCount: 2, breadthLift: 1 },
    }),
  })]), first, { sourceMode: "legacy-derived" });
  const card = roleCards(onlyTheme(second)).cycleLeader;

  assert.strictEqual(card.status, "confirmed");
  assert.strictEqual(card.sourceMode, "legacy-derived");
  assert.strictEqual(card.classifierVersion, THEME_LIBRARY_CLASSIFIER_VERSION);
  assert.ok(card.evidence.some((row) => (
    row.key === "identity_classification_mode" && row.value === "history_replay_reclassified"
  )));
  assert.ok(card.gaps.some((gap) => /新版规则基于历史数据回放，不是原归档当时已确认/.test(String(gap))));
});

test("a legacy topic limitCount cannot masquerade as today's limit-up count", () => {
  const tradingDate = "2026-08-05";
  const weak = stock("ASSET_RECENT_HEIGHT", tradingDate, {
    changePct: -3,
    popularity: "5天4板",
    leadership: leadership(tradingDate),
  });
  const day = payload(tradingDate, "2026-08-04", [weak]);
  day.topicBoard.items[0].limitCount = 2;
  const theme = onlyTheme(buildDay(day));

  assert.strictEqual(theme.limitCount, 2, "legacy count remains for compatibility");
  assert.strictEqual(theme.todayLimitUpCount, 0, "all members are down today, so today's limit-up count is zero");
  assert.strictEqual(theme.recentHeightCount, 1, "historical board height is exposed separately");
});

test("market-cycle labels do not self-verify without explicit structural evidence", () => {
  const tradingDate = "2026-08-05";
  const snapshot = buildDay(payload(tradingDate, "2026-08-04", [stock("ASSET_MARKET", tradingDate)]));

  assert.strictEqual(snapshot.marketCycle.key, "main_rise");
  assert.strictEqual(snapshot.marketCycle.verified, false);
  assert.strictEqual(snapshot.marketCycle.source, "market.cycleLabel");
  assert.strictEqual(snapshot.marketCycle.reason, null);
  assert.deepStrictEqual(snapshot.marketCycle.evidence, []);
  assert.strictEqual(snapshot.marketCycle.coverage, null);
  assert.ok(snapshot.marketCycle.gaps.some((gap) => /结构证据/.test(String(gap))));
});

test("market-cycle evidence projection preserves verified structure lineage", () => {
  const tradingDate = "2026-08-05";
  const day = payload(tradingDate, "2026-08-04", [stock("ASSET_MARKET_VERIFIED", tradingDate)]);
  day.market.state = {
    structuralResolution: {
      structuralCycle: "main_rise",
      reason: "three of four broad indices remain in an uptrend",
      indexEnvironment: {
        verified: true,
        evidence: [{ key: "valid_index_count", value: 3 }],
        coverage: { validIndexCount: 3, totalIndexCount: 4 },
      },
    },
  };
  const marketCycle = buildDay(day).marketCycle;

  assert.strictEqual(marketCycle.verified, true);
  assert.strictEqual(marketCycle.reason, "three of four broad indices remain in an uptrend");
  assert.deepStrictEqual(marketCycle.evidence, [{ key: "valid_index_count", value: 3 }]);
  assert.deepStrictEqual(marketCycle.coverage, { validIndexCount: 3, totalIndexCount: 4 });
  assert.deepStrictEqual(marketCycle.gaps, []);
  assert.strictEqual(marketCycle.tradingDate, tradingDate);
  assert.ok(marketCycle.asOf);
});

test("market-cycle coverage preserves numeric structureCoverage and trendCounts", () => {
  const tradingDate = "2026-08-05";
  const day = payload(tradingDate, "2026-08-04", [stock("ASSET_MARKET_COVERAGE", tradingDate)]);
  day.market.state = {
    structuralResolution: {
      structuralCycle: "main_rise",
      indexEnvironment: {
        verified: true,
        structureCoverage: 4,
        trendCounts: { uptrend: 3, downtrend: 1 },
        evidence: ["four-index structure available"],
      },
    },
  };
  const marketCycle = buildDay(day).marketCycle;

  assert.strictEqual(marketCycle.verified, true);
  assert.deepStrictEqual(marketCycle.coverage, {
    structureCoverage: 4,
    trendCounts: { uptrend: 3, downtrend: 1 },
  });
});
