"use strict";

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPreviousLimitUpSeeds,
  classifyLimitUpPullbackRepair,
  excludePreviousLimitUpOnly,
} = require("./quant-decision/limit-up-pullback-repair");

const PREVIOUS_DATE = "2026-08-25";
const CURRENT_DATE = "2026-08-26";

function previousPayload(overrides = {}) {
  return {
    archiveMeta: {
      tradingDate: PREVIOUS_DATE,
      snapshotKind: "closing",
      asOf: "2026-08-25T07:00:00.000Z",
      generationId: "2026-08-25:g1",
    },
    generationContext: {
      tradingDate: PREVIOUS_DATE,
      generationId: "2026-08-25:g1",
    },
    tradingDate: PREVIOUS_DATE,
    market: {
      limitStats: {
        dates: { today: "20260825" },
        pool: [
          { code: "000001", name: "样本股", reason: "当日主线", highDays: "首板" },
          { code: "000002", name: "池内无候选", reason: "其他", highDays: "2天2板" },
        ],
      },
    },
    candidates: [
      {
        code: "000001",
        name: "样本股",
        concepts: ["机器人", { name: "人形机器人" }],
        mainConcept: "机器人",
        mainFamily: "高端制造",
        totalMarketValue: 12800000000,
        floatMarketValue: 9600000000,
        floatMktCapYi: 96,
        selected: true,
        score: 99,
        tradeQualified: true,
        executionAuthority: true,
        hardGate: { pass: true },
        klineProfile: {
          lastSession: {
            tradingDate: PREVIOUS_DATE,
            snapshotKind: "closing",
            verified: true,
            completed: true,
            oneWord: false,
            noPriceDiscovery: false,
            source: "tencent-kline",
          },
        },
      },
    ],
    ...overrides,
  };
}

function currentPayload(overrides = {}) {
  return {
    tradingDate: CURRENT_DATE,
    market: {
      limitStats: {
        dates: { verified: true, today: "20260826", prev: "20260825" },
      },
    },
    ...overrides,
  };
}

function qualifiedStock(evidenceOverrides = {}, stockOverrides = {}) {
  const seed = buildPreviousLimitUpSeeds(previousPayload(), {
    expectedTradingDate: PREVIOUS_DATE,
  })[0];
  return {
    ...seed,
    previousLimitUpEvidence: {
      ...seed.previousLimitUpEvidence,
      ...evidenceOverrides,
    },
    changePct: -2.35,
    klineProfile: {
      structureBreak: false,
      lastSession: {
        tradingDate: CURRENT_DATE,
        snapshotKind: "closing",
        verified: true,
        completed: true,
        changePct: -2.35,
      },
    },
    flowNature: {
      key: "realization",
      label: "资金兑现",
      confidence: 0.78,
      conflict: false,
    },
    tomorrowExecution: {
      bucket: "premium",
      pricePhaseKey: "divergence",
      status: "watch",
      actionLabel: "观察承接纠偏",
    },
    gamePlan: { canGame: true, decision: "当前路径条件观察" },
    ...stockOverrides,
  };
}

test("T-1 exact closing limit pool builds identifier-only seeds and preserves historical theme labels", () => {
  const seeds = buildPreviousLimitUpSeeds(previousPayload(), {
    expectedTradingDate: PREVIOUS_DATE,
  });

  assert.equal(seeds.length, 2);
  const matched = seeds.find((seed) => seed.code === "000001");
  assert.ok(matched);
  assert.equal(matched.name, "样本股");
  assert.deepEqual(matched.concepts, ["机器人", { name: "人形机器人" }]);
  assert.equal(matched.mainConcept, "机器人");
  assert.equal(matched.mainFamily, "高端制造");
  assert.equal(matched.previousLimitUpEvidence.exactClosing, true);
  assert.equal(matched.previousLimitUpEvidence.closedAtLimit, true);
  assert.equal(matched.previousLimitUpEvidence.priceDiscoveryVerified, true);
  assert.equal(matched.previousLimitUpEvidence.oneWord, false);
  assert.equal(matched.previousLimitUpEvidence.noPriceDiscovery, false);
  assert.deepEqual(matched.previousLimitUpEvidence.capitalReference, {
    tradingDate: PREVIOUS_DATE,
    totalMarketValue: 12800000000,
    floatMarketValue: 9600000000,
    floatMktCapYi: 96,
  });
  ["selected", "score", "tradeQualified", "executionAuthority", "hardGate"].forEach((key) => {
    assert.equal(Object.prototype.hasOwnProperty.call(matched, key), false, `${key} must not cross T-1 boundary`);
  });

  const poolOnly = seeds.find((seed) => seed.code === "000002");
  assert.equal(poolOnly.previousLimitUpEvidence.closedAtLimit, true);
  assert.equal(poolOnly.previousLimitUpEvidence.priceDiscoveryVerified, false);
});

test("wrong date, non-closing archive and missing expected date all fail closed", () => {
  assert.deepEqual(buildPreviousLimitUpSeeds(previousPayload(), { expectedTradingDate: "2026-08-24" }), []);
  assert.deepEqual(buildPreviousLimitUpSeeds(previousPayload({
    archiveMeta: { tradingDate: PREVIOUS_DATE, snapshotKind: "intraday" },
  }), { expectedTradingDate: PREVIOUS_DATE }), []);
  assert.deepEqual(buildPreviousLimitUpSeeds(previousPayload(), {}), []);
});

test("qualified setup requires exact previous limit-up and verified current down close", () => {
  const result = classifyLimitUpPullbackRepair(qualifiedStock(), currentPayload());

  assert.equal(result.qualified, true);
  assert.equal(result.setupKey, "limit_up_pullback_repair");
  assert.equal(result.label, "前板回撤");
  assert.equal(result.observationOnly, true);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.focus, "昨日涨停，今日回撤但结构未坏");
  assert.ok(result.confirmationConditions.length >= 2);
  assert.ok(result.cancelConditions.length >= 2);
});

test("one-word board or missing price discovery cannot enter repair setup", () => {
  const stock = qualifiedStock({
    priceDiscoveryVerified: false,
    oneWord: true,
    noPriceDiscovery: true,
    priceDiscovery: { confirmed: false, oneWord: true, noPriceDiscovery: true },
  });
  const result = classifyLimitUpPullbackRepair(stock, currentPayload());
  assert.equal(result.qualified, false);
  assert.ok(result.reasonCodes.includes("previous_price_discovery_unconfirmed"));
});

test("date mismatch, missing closing evidence and a non-down T session fail closed", () => {
  const dateMismatch = classifyLimitUpPullbackRepair(
    qualifiedStock({ tradingDate: "2026-08-24" }),
    currentPayload(),
  );
  assert.ok(dateMismatch.reasonCodes.includes("previous_limit_up_date_mismatch"));

  const missingClose = classifyLimitUpPullbackRepair(qualifiedStock({}, {
    klineProfile: { structureBreak: false },
  }), currentPayload());
  assert.ok(missingClose.reasonCodes.includes("current_closing_evidence_missing"));

  const notDown = classifyLimitUpPullbackRepair(qualifiedStock({}, {
    changePct: 0.5,
    klineProfile: {
      structureBreak: false,
      lastSession: {
        tradingDate: CURRENT_DATE,
        snapshotKind: "closing",
        verified: true,
        completed: true,
        changePct: 0.5,
      },
    },
  }), currentPayload());
  assert.ok(notDown.reasonCodes.includes("current_session_not_down"));
});

test("structure break and fatal execution states fail closed, but fund escape remains observable", () => {
  const structure = classifyLimitUpPullbackRepair(qualifiedStock({}, {
    klineProfile: {
      structureBreak: true,
      lastSession: {
        tradingDate: CURRENT_DATE,
        snapshotKind: "closing",
        verified: true,
        completed: true,
        changePct: -3,
      },
    },
  }), currentPayload());
  assert.ok(structure.reasonCodes.includes("current_structure_broken"));

  const escape = classifyLimitUpPullbackRepair(qualifiedStock({}, {
    flowNature: { key: "escape", confidence: 0.81, conflict: false },
  }), currentPayload());
  assert.equal(escape.qualified, true);
  assert.match(escape.evidence.join("；"), /escape.*不作观察否决/);

  const failed = classifyLimitUpPullbackRepair(qualifiedStock({}, {
    hardGate: { pass: false, hardFails: ["停牌"] },
  }), currentPayload());
  assert.ok(failed.reasonCodes.includes("explicit_stock_failure"));
});

test("missing structure fails closed while missing fund-flow evidence does not block observation", () => {
  const missingStructure = classifyLimitUpPullbackRepair(qualifiedStock({}, {
    klineProfile: {
      lastSession: {
        tradingDate: CURRENT_DATE,
        snapshotKind: "closing",
        verified: true,
        completed: true,
        changePct: -1,
      },
    },
  }), currentPayload());
  assert.ok(missingStructure.reasonCodes.includes("current_structure_evidence_missing"));

  const missingFlow = classifyLimitUpPullbackRepair(qualifiedStock({}, { flowNature: null }), currentPayload());
  assert.equal(missingFlow.qualified, true);
  assert.match(missingFlow.evidence.join("；"), /资金性质缺失.*不作观察否决/);
});

test("previousLimitUpOnly rows are excluded from every market sample projection", () => {
  const normal = { code: "000001" };
  const only = { code: "000002", previousLimitUpOnly: true };
  assert.deepEqual(excludePreviousLimitUpOnly([normal, only]), [normal]);

  const serverSource = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  assert.match(serverSource, /conceptStats\(marketProfiled,/);
  assert.match(serverSource, /classifyTradingStyle\(marketState, hotConcepts, marketProfiled\)/);
  assert.match(serverSource, /const candidates = excludePreviousLimitUpOnly\(allCandidates\)/);
  assert.match(serverSource, /buildTradingStylePreference\(marketSamplePayload\(payload\)/);
  assert.match(serverSource, /DATA_CAPABILITIES\.STOCK_EVIDENCE,[\s\S]*?\[marketProfiled\]/);
  assert.match(serverSource, /marketProfiled\.forEach\(\(stock\) => \{/);
  assert.match(serverSource, /klineOk: marketProfiled\.filter/);
  assert.match(serverSource, /buildMarketEffectAttribution\(marketSamplePayload\(payload\)\)/);
  assert.match(serverSource, /previousLimitUpQuoteTargets/);
  assert.match(serverSource, /executionAuthority: false/);
});
