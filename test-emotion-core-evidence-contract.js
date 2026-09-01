"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

let contractModule = {};
let contractLoadError = null;
try {
  contractModule = require("./emotion-core-evidence-contract");
} catch (error) {
  contractLoadError = error;
}

const CONTRACT_VERSION = 2;
const GENERATION = Object.freeze({
  id: "anonymous-generation-20260814-close",
  tradingDate: "2026-08-14",
  asOf: "2026-08-14T15:10:00+08:00",
});

function adapterThemeLibraryMeta() {
  return {
    available: true,
    stale: false,
    schemaVersion: 1,
    classifierVersion: "theme-library-v5-cycle-leader-state",
    generationId: GENERATION.id,
  };
}

function buildContract(input) {
  assert.equal(
    typeof contractModule.buildEmotionCoreEvidenceContract,
    "function",
    `emotion-core-evidence-contract.js 必须导出 buildEmotionCoreEvidenceContract(input)${
      contractLoadError ? `；当前加载失败：${contractLoadError.code || contractLoadError.message}` : ""
    }`,
  );
  return contractModule.buildEmotionCoreEvidenceContract(input);
}

function sourceMeta(overrides = {}) {
  return {
    generationId: GENERATION.id,
    tradingDate: GENERATION.tradingDate,
    asOf: GENERATION.asOf,
    contractVersion: CONTRACT_VERSION,
    ...overrides,
  };
}

function anonymousTheme(key = "anonymous-theme-fine-a") {
  return {
    key,
    fine: `匿名细分题材-${key}`,
    parent: "匿名父题材",
    label: `匿名细分题材-${key}`,
    ...sourceMeta(),
  };
}

function anonymousCycle(themeKey = "anonymous-theme-fine-a") {
  return {
    key: "theme-cycle-rising",
    label: "题材上升周期",
    marketKey: "market-main-rise",
    themeKey,
    ...sourceMeta(),
  };
}

function strictCore(code, state = "divergent", overrides = {}) {
  const theme = anonymousTheme();
  const cycle = anonymousCycle(theme.key);
  const base = {
    code,
    name: `匿名严格核心-${code}`,
    classification: {
      strictEmotionCore: true,
      heightRiskBarometer: false,
      coreCandidate: true,
    },
    qualification: {
      passed: true,
      authority: "theme_cycle_leadership",
      version: "strict-core-qualification-v2",
      reasons: ["跨日身份成立", "题材共振与市场影响证据完整"],
      ...sourceMeta(),
    },
    theme,
    cycle,
    identity: {
      kind: "cycle_emotion_core",
      authority: "theme_cycle_leadership",
      rank: "primary",
      source: "cross_session_identity",
      evidence: ["跨日持续聚焦", "有可追溯跟随或恐慌传导"],
      active: true,
      ...sourceMeta(),
    },
    session: {
      state,
      supportScore: state === "support" ? 76 : 28,
      damageScore: state === "divergent" ? 58 : 18,
      source: "verified_closing_session",
      snapshotKind: "closing",
      completed: true,
      verified: true,
      ...sourceMeta(),
    },
    evidence: [
      { key: "theme_resonance", value: true, source: "verified_theme_snapshot", ...sourceMeta() },
      { key: "market_influence", value: true, source: "verified_following_trace", ...sourceMeta() },
    ],
    dataQuality: {
      grade: "verified",
      source: "verified_closing_session",
      complete: true,
      ...sourceMeta(),
    },
    state,
  };

  return {
    ...base,
    ...overrides,
    classification: { ...base.classification, ...(overrides.classification || {}) },
    qualification: { ...base.qualification, ...(overrides.qualification || {}) },
    theme: { ...base.theme, ...(overrides.theme || {}) },
    cycle: { ...base.cycle, ...(overrides.cycle || {}) },
    identity: { ...base.identity, ...(overrides.identity || {}) },
    session: { ...base.session, ...(overrides.session || {}) },
    dataQuality: { ...base.dataQuality, ...(overrides.dataQuality || {}) },
  };
}

function heightRiskBarometer(code, state = "divergent", overrides = {}) {
  const base = strictCore(code, state, {
    name: `匿名高度风险-${code}`,
    classification: {
      strictEmotionCore: false,
      heightRiskBarometer: true,
      coreCandidate: true,
    },
    qualification: {
      passed: false,
      reasons: ["仅确认高度风险观察身份，未取得严格情绪核心资格"],
    },
    identity: {
      kind: "height_risk_barometer",
      rank: "risk_watch",
      source: "height_risk_trace",
      evidence: ["高位负反馈风险可追溯"],
    },
  });
  return {
    ...base,
    ...overrides,
    classification: { ...base.classification, ...(overrides.classification || {}) },
    qualification: { ...base.qualification, ...(overrides.qualification || {}) },
    theme: { ...base.theme, ...(overrides.theme || {}) },
    cycle: { ...base.cycle, ...(overrides.cycle || {}) },
    identity: { ...base.identity, ...(overrides.identity || {}) },
    session: { ...base.session, ...(overrides.session || {}) },
    dataQuality: { ...base.dataQuality, ...(overrides.dataQuality || {}) },
  };
}

function unqualifiedStrictCore(code) {
  return strictCore(code, "support", {
    qualification: {
      passed: false,
      reasons: ["跨日核心资格未通过"],
    },
  });
}

function themeCycle(candidates, overrides = {}) {
  const theme = anonymousTheme(overrides.themeKey || "anonymous-theme-fine-a");
  return {
    theme,
    cycle: {
      ...anonymousCycle(theme.key),
      ...(overrides.cycle || {}),
    },
    candidates,
  };
}

function contractInput(candidates, overrides = {}) {
  const input = {
    contractVersion: CONTRACT_VERSION,
    generation: { ...GENERATION, contractVersion: CONTRACT_VERSION },
    marketCycle: {
      key: "market-main-rise",
      label: "市场主升周期",
      ...sourceMeta(),
    },
    themeCycles: [themeCycle(candidates)],
    existingDecision: {
      finalEmotionStage: {
        key: "existing-stage-must-not-change",
        label: "既有情绪阶段",
      },
      tradePermission: {
        status: "watch_only",
        allowNew: false,
        reason: "既有交易权限，本阶段不得重算",
      },
    },
    // 故意伪造；实现必须忽略输入汇总，并由最终具名 rows 反算。
    summary: {
      strictCoreCount: 999,
      heightRiskBarometerCount: 999,
      divergent: { count: 999, rows: [{ code: "FORGED" }] },
      support: { count: 999, rows: [{ code: "FORGED" }] },
    },
  };
  return { ...input, ...overrides };
}

function codes(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => row.code);
}

const PREVIOUS_GENERATION = Object.freeze({
  id: "anonymous-generation-20260813-close",
  tradingDate: "2026-08-13",
  asOf: "2026-08-13T15:10:00+08:00",
});

function replaceEvidenceGeneration(value, generation) {
  if (Array.isArray(value)) return value.map((entry) => replaceEvidenceGeneration(entry, generation));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = replaceEvidenceGeneration(entry, generation);
  }
  if (Object.prototype.hasOwnProperty.call(result, "generationId")) result.generationId = generation.id;
  if (Object.prototype.hasOwnProperty.call(result, "tradingDate")) result.tradingDate = generation.tradingDate;
  if (Object.prototype.hasOwnProperty.call(result, "asOf")) result.asOf = generation.asOf;
  if (Object.prototype.hasOwnProperty.call(result, "contractVersion")) result.contractVersion = CONTRACT_VERSION;
  return result;
}

function previousStrictCoreEvidence(strictState = "divergent", riskState = "support") {
  const built = buildContract(contractInput([
    strictCore("ANON-PREVIOUS-STRICT", strictState),
    heightRiskBarometer("ANON-PREVIOUS-RISK", riskState),
  ]));
  const evidence = replaceEvidenceGeneration(built, PREVIOUS_GENERATION);
  evidence.generation = {
    id: PREVIOUS_GENERATION.id,
    generationId: PREVIOUS_GENERATION.id,
    tradingDate: PREVIOUS_GENERATION.tradingDate,
    asOf: PREVIOUS_GENERATION.asOf,
  };
  evidence.basis = {
    tradingDate: PREVIOUS_GENERATION.tradingDate,
    snapshotKind: "closing",
    asOf: PREVIOUS_GENERATION.asOf,
    source: "same_generation_closing_payload",
  };
  evidence.lineage = {
    classifierVersion: "strict-core-qualification-v2",
  };
  return evidence;
}

function refreshInfluenceSummary(evidence) {
  const rows = evidence.strictEmotionCores || [];
  const positiveTotal = Math.round(rows.reduce((sum, row) => sum + Number(row.positiveInfluenceScore || 0), 0) * 10) / 10;
  const negativeTotal = Math.round(rows.reduce((sum, row) => sum + Number(row.negativeInfluenceScore || 0), 0) * 10) / 10;
  const signedTotal = Math.round((positiveTotal - negativeTotal) * 10) / 10;
  const positiveCount = rows.filter((row) => Number(row.signedInfluenceScore) > 5).length;
  const negativeCount = rows.filter((row) => Number(row.signedInfluenceScore) < -5).length;
  evidence.summary = evidence.summary || {};
  evidence.summary.strictCoreCount = rows.length;
  evidence.summary.influence = {
    positiveTotal,
    negativeTotal,
    signedTotal,
    positiveCount,
    negativeCount,
    neutralCount: rows.length - positiveCount - negativeCount,
    winner: signedTotal > 5 ? "positive" : signedTotal < -5 ? "negative" : "mixed",
    calibrated: false,
    unit: "rule_impact_points",
  };
}

function adapterOptionsForTransition(strictState = "divergence", riskState = "repair_failed", options = {}) {
  const strictCode = "ANON-CURRENT-STRICT";
  const riskCode = "ANON-CURRENT-RISK";
  const cycleInstanceId = "anonymous-transition-cycle";
  const completed = options.completed !== false;
  return {
    payload: {
      candidates: [
        {
          code: strictCode,
          name: "匿名当日严格核心",
          klineProfile: { lastSession: { tradingDate: GENERATION.tradingDate, snapshotKind: "closing", completed, verified: completed } },
        },
        {
          code: riskCode,
          name: "匿名当日高度风险",
          klineProfile: { lastSession: { tradingDate: GENERATION.tradingDate, snapshotKind: "closing", completed: true, verified: true } },
        },
      ],
      themeLibrary: {
        ...adapterThemeLibraryMeta(),
        tradingDate: GENERATION.tradingDate,
        generatedAt: GENERATION.asOf,
        snapshotKind: "closing",
        themes: [{
          id: "anonymous-transition-theme",
          name: "匿名跨日题材",
          family: "匿名父题材",
          cycleLeadership: {
            version: 1,
            settledTradingDate: GENERATION.tradingDate,
            cycleInstanceId,
            state: "retained",
            frozen: false,
            activeLeaderCode: strictCode,
            primary: { code: strictCode },
            identities: {
              [strictCode]: {
                code: strictCode,
                cycleInstanceId,
                state: "retained",
                identityEstablished: true,
                activePrimary: true,
                validImpactDays: 2,
              },
            },
          },
          dailyHeightStocks: [],
        }],
      },
    },
    coreEmotionBasket: {
      emotionCycle: {
        rankedAnchors: [
          { code: strictCode, name: "匿名当日严格核心", participation: { individualState: strictState } },
          { code: riskCode, name: "匿名当日高度风险", board: { boardsInWindow: 5 }, participation: { individualState: riskState } },
        ],
      },
    },
    marketPhaseDetail: { structuralCycle: "主升" },
    generation: GENERATION,
    previousEvidence: previousStrictCoreEvidence(options.previousState || "divergent", options.previousRiskState || "support"),
    expectedPreviousTradingDate: PREVIOUS_GENERATION.tradingDate,
  };
}

function assertNamedRowsBackSummary(summary) {
  for (const key of ["divergent", "support"]) {
    assert.ok(Array.isArray(summary[key].rows), `${key} 必须保留具名 rows`);
    assert.equal(summary[key].count, summary[key].rows.length, `${key}.count 必须由 rows 反算`);
    assert.ok(summary[key].rows.every((row) => row.code && row.name), `${key} rows 必须具名且带代码`);
  }
}

test("第一阶段契约导出独立纯函数，不借机改写最终情绪阶段或交易权限", () => {
  const input = contractInput([strictCore("ANON-CORE-PRESERVE", "support")]);
  const before = structuredClone(input);
  const result = buildContract(input);

  assert.deepEqual(input, before, "纯契约不得修改输入");
  assert.deepEqual(result.decision.finalEmotionStage, before.existingDecision.finalEmotionStage);
  assert.deepEqual(result.decision.tradePermission, before.existingDecision.tradePermission);
  assert.equal(result.integrity.finalEmotionStageUnchanged, true);
  assert.equal(result.integrity.tradePermissionUnchanged, true);
});

test("市场周期→细分题材周期→严格核心/高度风险完全分池，且汇总只由具名 rows 反算", () => {
  const candidates = [
    strictCore("ANON-CORE-DIVERGENT", "divergent"),
    strictCore("ANON-CORE-SUPPORT", "support"),
    heightRiskBarometer("ANON-RISK-DIVERGENT", "divergent"),
    unqualifiedStrictCore("ANON-UNQUALIFIED"),
  ];
  const result = buildContract(contractInput(candidates));
  const expectedStrictCodes = ["ANON-CORE-SUPPORT", "ANON-CORE-DIVERGENT"];
  const expectedRiskCodes = candidates
    .filter((row) => row.classification.heightRiskBarometer)
    .map((row) => row.code);

  assert.equal(result.status, "ready");
  assert.equal(result.marketCycle.key, "market-main-rise");
  assert.equal(result.themeCycles.length, 1);
  assert.equal(result.themeCycles[0].theme.fine, candidates[0].theme.fine);
  assert.equal(result.themeCycles[0].theme.parent, candidates[0].theme.parent);
  assert.equal(result.themeCycles[0].cycle.key, "theme-cycle-rising");
  assert.deepEqual(codes(result.strictEmotionCores), expectedStrictCodes);
  assert.deepEqual(codes(result.heightRiskBarometers), expectedRiskCodes);
  assert.deepEqual(codes(result.themeCycles[0].strictEmotionCores), expectedStrictCodes);
  assert.deepEqual(codes(result.themeCycles[0].heightRiskBarometers), expectedRiskCodes);

  const strictCodeSet = new Set(codes(result.strictEmotionCores));
  assert.ok(result.heightRiskBarometers.every((row) => !strictCodeSet.has(row.code)));
  assert.ok(result.heightRiskBarometers.every((row) => row.votingWeight === 0));
  assert.equal(result.summary.strictCoreCount, result.strictEmotionCores.length);
  assert.equal(result.summary.heightRiskBarometerCount, result.heightRiskBarometers.length);
  assertNamedRowsBackSummary(result.summary);
  assert.deepEqual(codes(result.summary.divergent.rows), ["ANON-CORE-DIVERGENT"]);
  assert.deepEqual(codes(result.summary.support.rows), ["ANON-CORE-SUPPORT"]);
  assert.ok(!codes(result.summary.divergent.rows).includes("ANON-RISK-DIVERGENT"));
  assert.ok(!codes(result.summary.support.rows).includes("ANON-UNQUALIFIED"));
  assert.equal(result.integrity.poolsDisjoint, true);
  assert.equal(result.integrity.namedRowsBackSummary, true);
  assert.equal(result.integrity.sameGeneration, true);
  assert.equal(result.integrity.strictRowsQualifiedOnly, true);
  assert.equal(result.integrity.riskRowsCannotVote, true);
});

test("严格核心必须逐行保留 qualification/theme/cycle/identity/session/evidence/dataQuality 可追溯证据", () => {
  const valid = strictCore("ANON-TRACEABLE-CORE", "divergent");
  const missingFields = [
    "qualification",
    "theme",
    "cycle",
    "identity",
    "session",
    "evidence",
    "dataQuality",
  ];
  const invalid = missingFields.map((field, index) => {
    const row = strictCore(`ANON-MISSING-${index + 1}`, "support");
    delete row[field];
    return row;
  });
  const nonAuthoritative = strictCore("ANON-NON-AUTHORITATIVE", "support", {
    qualification: { authority: "candidate_cycle_identity" },
    identity: { authority: "candidate_cycle_identity" },
  });
  invalid.push(nonAuthoritative);
  const result = buildContract(contractInput([valid, ...invalid]));

  assert.deepEqual(codes(result.strictEmotionCores), [valid.code]);
  const row = result.strictEmotionCores[0];
  assert.equal(row.qualification.passed, true);
  assert.equal(row.qualification.authority, "theme_cycle_leadership");
  assert.equal(row.theme.fine, valid.theme.fine);
  assert.equal(row.theme.parent, valid.theme.parent);
  assert.equal(row.cycle.key, valid.cycle.key);
  assert.equal(row.identity.rank, valid.identity.rank);
  assert.equal(row.identity.authority, "theme_cycle_leadership");
  assert.equal(row.identity.source, valid.identity.source);
  assert.deepEqual(row.identity.evidence, valid.identity.evidence);
  assert.equal(row.session.state, valid.session.state);
  assert.equal(row.session.supportScore, valid.session.supportScore);
  assert.equal(row.session.damageScore, valid.session.damageScore);
  assert.equal(row.session.source, valid.session.source);
  assert.equal(row.session.asOf, GENERATION.asOf);
  assert.deepEqual(row.evidence, valid.evidence);
  assert.deepEqual(row.dataQuality, valid.dataQuality);
  assert.equal(result.integrity.strictRowsQualifiedOnly, true);
  assert.deepEqual(
    new Set((result.dataQuality.rejectedRows || []).map((entry) => entry.code)),
    new Set(invalid.map((entry) => entry.code)),
  );
  assert.ok((result.dataQuality.rejectedRows || []).every((entry) => Array.isArray(entry.reasonCodes) && entry.reasonCodes.length));
});

test("同一股票重复出现时只保留一条，不能靠重复样本放大情绪投票或汇总", () => {
  const original = strictCore("ANON-DUPLICATE-CORE", "divergent");
  const candidates = [original, structuredClone(original), structuredClone(original)];
  const result = buildContract(contractInput(candidates));

  assert.deepEqual(codes(result.strictEmotionCores), [original.code]);
  assert.deepEqual(codes(result.summary.divergent.rows), [original.code]);
  assert.equal(result.summary.strictCoreCount, result.strictEmotionCores.length);
  assert.equal(result.summary.divergent.count, result.summary.divergent.rows.length);
  assert.equal(result.integrity.namedRowsBackSummary, true);
});

test("真实payload适配只认题材周期权威：候选字段冲突不能覆盖周期主核心，高度名单只能进风险池", () => {
  assert.equal(typeof contractModule.buildEmotionCoreEvidenceFromPayload, "function");
  const generationId = GENERATION.id;
  const payload = {
    fetchedAt: GENERATION.asOf,
    market: { state: { structuralCycle: "主升" } },
    candidates: [
      {
        code: "ANON-AUTH-PRIMARY",
        name: "匿名周期主核心",
        mainConcept: "匿名聚类标签",
        leadership: { cycleIdentity: { identityEstablished: false, activePrimary: false } },
        klineProfile: { lastSession: { tradingDate: GENERATION.tradingDate, snapshotKind: "closing", completed: true, verified: true } },
      },
      {
        code: "ANON-HEIGHT-RISK",
        name: "匿名高度风险",
        mainConcept: "匿名细分题材",
        klineProfile: { lastSession: { tradingDate: GENERATION.tradingDate, snapshotKind: "closing", completed: true, verified: true } },
      },
    ],
    themeLibrary: {
      ...adapterThemeLibraryMeta(),
      tradingDate: GENERATION.tradingDate,
      generatedAt: GENERATION.asOf,
      snapshotKind: "closing",
      themes: [{
        id: "anonymous-parent",
        name: "匿名细分题材",
        family: "匿名父题材",
        sector: { name: "匿名板块基准" },
        cycleLeadership: {
          version: 1,
          settledTradingDate: GENERATION.tradingDate,
          cycleInstanceId: "anonymous-cycle-1",
          state: "retained",
          activeLeaderCode: "ANON-AUTH-PRIMARY",
          primary: { code: "ANON-AUTH-PRIMARY" },
          challenger: { code: "ANON-HEIGHT-RISK" },
          identities: {
            "ANON-AUTH-PRIMARY": {
              code: "ANON-AUTH-PRIMARY",
              cycleInstanceId: "anonymous-cycle-1",
              state: "retained",
              identityEstablished: true,
              activePrimary: true,
              confirmedTradingDates: ["2026-08-12", "2026-08-13"],
              evidenceDates: ["2026-08-12", "2026-08-13"],
              validImpactDays: 2,
            },
            "ANON-HEIGHT-RISK": {
              code: "ANON-HEIGHT-RISK",
              cycleInstanceId: "anonymous-cycle-1",
              state: "candidate",
              identityEstablished: false,
              activePrimary: false,
              validImpactDays: 1,
              consecutiveNoImpactDays: 1,
              impactTradingDates: ["2026-08-13"],
            },
          },
        },
        dailyHeightStocks: [
          { code: "ANON-AUTH-PRIMARY", name: "匿名周期主核心" },
          { code: "ANON-HEIGHT-RISK", name: "匿名高度风险" },
        ],
      }],
    },
  };
  const coreEmotionBasket = {
    items: [{ code: "ANON-AUTH-PRIMARY", name: "匿名周期主核心", sentimentStage: "divergence", lifecycle: { coreQualification: { qualified: true, reasons: ["匿名资格通过"] } } }],
    emotionCycle: {
      rankedAnchors: [
        { code: "ANON-AUTH-PRIMARY", name: "匿名周期主核心", participation: { individualState: "divergence", facts: { supportScore: 21, damageScore: 43 } }, support: { score: 21 }, damage: { score: 43 }, priceDiscovery: { source: "trusted_current_closing_path_proxy", sessionGranularity: "closing_path_proxy", eventEvidenceEligible: false } },
        { code: "ANON-HEIGHT-RISK", name: "匿名高度风险", signals: { height: true }, board: { label: "匿名高位", boardsInWindow: 7 }, participation: { individualState: "repair_failed", facts: { supportScore: 4, damageScore: 88 } }, support: { score: 4 }, damage: { score: 88 }, priceDiscovery: { source: "trusted_current_closing_path_proxy", sessionGranularity: "closing_path_proxy", eventEvidenceEligible: false } },
      ],
    },
  };
  const existingDecision = {
    finalEmotionStage: { key: "existing-stage", label: "既有阶段" },
    tradePermission: { status: "watch_only", allowNew: false },
  };
  const result = contractModule.buildEmotionCoreEvidenceFromPayload({
    payload,
    coreEmotionBasket,
    marketPhaseDetail: { structuralCycle: "主升", indexSubPhase: { key: "main_rise_divergence", label: "主升内分歧" } },
    generation: { id: generationId, tradingDate: GENERATION.tradingDate, asOf: GENERATION.asOf },
    existingDecision,
  });

  assert.deepEqual(codes(result.strictEmotionCores), ["ANON-AUTH-PRIMARY"]);
  assert.deepEqual(codes(result.heightRiskBarometers), ["ANON-HEIGHT-RISK"]);
  assert.equal(result.strictEmotionCores[0].qualification.authority, "theme_cycle_leadership");
  assert.equal(result.strictEmotionCores[0].identity.active, true);
  assert.equal(result.strictEmotionCores[0].session.state, "divergence");
  assert.equal(result.strictEmotionCores[0].session.supportScore, 21);
  assert.equal(result.strictEmotionCores[0].session.damageScore, 43);
  assert.equal(result.heightRiskBarometers[0].votingWeight, 0);
  assert.equal(result.strictEmotionCores[0].classification.heightRiskBarometer, false);
  assert.equal(result.coreCandidates.find((row) => row.code === "ANON-HEIGHT-RISK").votingWeight, 0);
  assert.ok(result.dataQuality.consistencyWarnings.some((row) => row.code === "ANON-AUTH-PRIMARY"));
  assert.deepEqual(result.decision, existingDecision);
});

test("strict core requires an explicitly verified closing snapshot kind", () => {
  const code = "ANON-MISSING-CLOSING-KIND";
  const cycleInstanceId = "anonymous-cycle-closing-kind";
  const payload = {
    candidates: [{
      code,
      name: "anonymous missing closing kind",
      klineProfile: {
        lastSession: {
          tradingDate: GENERATION.tradingDate,
          completed: true,
          verified: true,
        },
      },
    }],
    themeLibrary: {
      ...adapterThemeLibraryMeta(),
      tradingDate: GENERATION.tradingDate,
      generatedAt: GENERATION.asOf,
      snapshotKind: "closing",
      themes: [{
        id: "anonymous-theme",
        name: "anonymous-theme",
        family: "anonymous-parent",
        cycleLeadership: {
          version: 1,
          settledTradingDate: GENERATION.tradingDate,
          cycleInstanceId,
          state: "retained",
          frozen: false,
          activeLeaderCode: code,
          primary: { code },
          identities: {
            [code]: {
              code,
              cycleInstanceId,
              state: "retained",
              identityEstablished: true,
              activePrimary: true,
              validImpactDays: 2,
            },
          },
        },
        dailyHeightStocks: [],
      }],
    },
  };
  const result = contractModule.buildEmotionCoreEvidenceFromPayload({
    payload,
    coreEmotionBasket: {
      emotionCycle: {
        rankedAnchors: [{
          code,
          participation: { individualState: "participating", facts: { supportScore: 40, damageScore: 10 } },
        }],
      },
    },
    marketPhaseDetail: { structuralCycle: "main_rise" },
    generation: GENERATION,
  });

  assert.deepEqual(codes(result.strictEmotionCores), []);
  assert.deepEqual(codes(result.coreCandidates), [code]);
});

test("仅由热点关联发现的高度风险票不得冒充已核实题材归属", () => {
  const payload = {
    candidates: [{
      code: "ANON-RELATED-RISK",
      name: "匿名关联风险",
      mainConcept: "匿名热点关联",
      mainFamily: "匿名宽板块",
      klineProfile: { lastSession: { tradingDate: GENERATION.tradingDate, snapshotKind: "closing", completed: true, verified: true } },
    }],
    themeLibrary: { ...adapterThemeLibraryMeta(), tradingDate: GENERATION.tradingDate, generatedAt: GENERATION.asOf, snapshotKind: "closing", themes: [] },
  };
  const result = contractModule.buildEmotionCoreEvidenceFromPayload({
    payload,
    coreEmotionBasket: {
      emotionCycle: { rankedAnchors: [{
        code: "ANON-RELATED-RISK",
        name: "匿名关联风险",
        signals: { height: true },
        board: { boardsInWindow: 5 },
        participation: { individualState: "repair_failed", facts: { supportScore: 3, damageScore: 82 } },
      }] },
    },
    marketPhaseDetail: { structuralCycle: "主升" },
    generation: GENERATION,
  });

  assert.deepEqual(codes(result.strictEmotionCores), []);
  assert.deepEqual(codes(result.heightRiskBarometers), ["ANON-RELATED-RISK"]);
  assert.equal(result.heightRiskBarometers[0].theme.relatedOnly, true);
  assert.equal(result.heightRiskBarometers[0].theme.attributionStatus, "risk_relation_only");
  assert.equal(result.heightRiskBarometers[0].theme.authority, "risk_relation_only");
  assert.equal(result.heightRiskBarometers[0].votingWeight, 0);
});

test("真实payload的题材库不是同一收盘交易日时必须整体关闭，不能给旧身份盖新代际", () => {
  const existingDecision = { finalEmotionStage: { key: "existing", label: "既有阶段" } };
  const result = contractModule.buildEmotionCoreEvidenceFromPayload({
    payload: {
      candidates: [],
      themeLibrary: { ...adapterThemeLibraryMeta(), tradingDate: "2026-08-13", generatedAt: GENERATION.asOf, snapshotKind: "closing", themes: [] },
    },
    coreEmotionBasket: {},
    marketPhaseDetail: { structuralCycle: "主升" },
    generation: GENERATION,
    existingDecision,
  });

  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.strictEmotionCores, []);
  assert.deepEqual(result.heightRiskBarometers, []);
  assert.ok(result.dataQuality.reasonCodes.includes("theme_library_trading_date_mismatch"));
  assert.deepEqual(result.decision, existingDecision);
});

test("真实payload缺少题材库收盘血缘字段时必须关闭，不能静默盖成当前代际", () => {
  for (const missingField of ["tradingDate", "generatedAt", "generationId", "snapshotKind"]) {
    const themeLibrary = { ...adapterThemeLibraryMeta(), tradingDate: GENERATION.tradingDate, generatedAt: GENERATION.asOf, snapshotKind: "closing", themes: [] };
    delete themeLibrary[missingField];
    const result = contractModule.buildEmotionCoreEvidenceFromPayload({
      payload: { candidates: [], themeLibrary },
      coreEmotionBasket: {},
      marketPhaseDetail: { structuralCycle: "主升" },
      generation: GENERATION,
    });
    assert.equal(result.status, "unavailable", `缺${missingField}必须关闭`);
    assert.equal(result.dataQuality.failClosed, true);
    assert.ok(result.dataQuality.reasonCodes.some((code) => code.includes("theme_library")));
  }
});

test("严格核心的身份周期必须与题材周期实例完全一致", () => {
  const payload = {
    candidates: [{
      code: "ANON-CYCLE-MISMATCH",
      name: "匿名错周期核心",
      klineProfile: { lastSession: { tradingDate: GENERATION.tradingDate, snapshotKind: "closing", completed: true, verified: true } },
    }],
    themeLibrary: {
      ...adapterThemeLibraryMeta(),
      tradingDate: GENERATION.tradingDate,
      generatedAt: GENERATION.asOf,
      snapshotKind: "closing",
      themes: [{
        id: "anonymous-theme",
        name: "匿名题材",
        family: "匿名父题材",
        cycleLeadership: {
          version: 1,
          settledTradingDate: GENERATION.tradingDate,
          cycleInstanceId: "theme-cycle-current",
          state: "retained",
          identities: {
            "ANON-CYCLE-MISMATCH": {
              code: "ANON-CYCLE-MISMATCH",
              cycleInstanceId: "theme-cycle-old",
              state: "retained",
              identityEstablished: true,
              activePrimary: true,
            },
          },
        },
        dailyHeightStocks: [],
      }],
    },
  };
  const result = contractModule.buildEmotionCoreEvidenceFromPayload({
    payload,
    coreEmotionBasket: {},
    marketPhaseDetail: { structuralCycle: "主升" },
    generation: GENERATION,
  });

  assert.deepEqual(result.strictEmotionCores, []);
  assert.ok(result.dataQuality.consistencyWarnings.some((row) => row.code === "ANON-CYCLE-MISMATCH" && row.reason === "cycle_instance_mismatch"));
});

test("首板或普通当日高度不能自动升级成高度风险风向标", () => {
  const payload = {
    candidates: [{
      code: "ANON-FIRST-BOARD",
      name: "匿名首板",
      klineProfile: { lastSession: { tradingDate: GENERATION.tradingDate, snapshotKind: "closing", completed: true, verified: true } },
    }],
    themeLibrary: {
      ...adapterThemeLibraryMeta(),
      tradingDate: GENERATION.tradingDate,
      generatedAt: GENERATION.asOf,
      snapshotKind: "closing",
      themes: [{
        id: "anonymous-theme",
        name: "匿名题材",
        family: "匿名父题材",
        cycleLeadership: {
          version: 1,
          settledTradingDate: GENERATION.tradingDate,
          cycleInstanceId: "theme-cycle-current",
          state: "candidate",
          identities: {},
        },
        dailyHeightStocks: [{ code: "ANON-FIRST-BOARD", name: "匿名首板" }],
      }],
    },
  };
  const result = contractModule.buildEmotionCoreEvidenceFromPayload({
    payload,
    coreEmotionBasket: { emotionCycle: { rankedAnchors: [{ code: "ANON-FIRST-BOARD", name: "匿名首板", board: { consecutiveBoards: 1, boardsInWindow: 1 }, signals: { height: false } }] } },
    marketPhaseDetail: { structuralCycle: "主升" },
    generation: GENERATION,
  });
  assert.deepEqual(result.heightRiskBarometers, []);
});

test("题材库同日但生成时间过旧、标记过期或分类器版本过旧时必须关闭", () => {
  const mutations = [
    {
      reason: "theme_library_generation_missing",
      apply(themeLibrary) { delete themeLibrary.generationId; },
    },
    {
      reason: "theme_library_generation_mismatch",
      apply(themeLibrary) { themeLibrary.generationId = "other-generation"; },
    },
    {
      reason: "theme_library_generated_at_mismatch",
      apply(themeLibrary) { themeLibrary.generatedAt = "2026-08-14T15:09:59+08:00"; },
    },
    {
      reason: "theme_library_generated_at_mismatch",
      apply(themeLibrary) { themeLibrary.generatedAt = "2026-08-14T00:00:00+08:00"; },
    },
    {
      reason: "theme_library_stale_or_unknown",
      apply(themeLibrary) { themeLibrary.stale = true; },
    },
    {
      reason: "theme_library_classifier_version_unsupported",
      apply(themeLibrary) { themeLibrary.classifierVersion = "theme-library-v4"; },
    },
  ];
  for (const mutation of mutations) {
    const themeLibrary = {
      ...adapterThemeLibraryMeta(),
      tradingDate: GENERATION.tradingDate,
      generatedAt: GENERATION.asOf,
      snapshotKind: "closing",
      themes: [],
    };
    mutation.apply(themeLibrary);
    const result = contractModule.buildEmotionCoreEvidenceFromPayload({
      payload: { candidates: [], themeLibrary },
      coreEmotionBasket: {},
      marketPhaseDetail: { structuralCycle: "主升" },
      generation: GENERATION,
    });
    assert.equal(result.status, "unavailable");
    assert.ok(result.dataQuality.reasonCodes.includes(mutation.reason));
  }
});

test("跨日阶段拒绝被篡改的影响汇总，不能绕过具名核心逐行校验", () => {
  const options = adapterOptionsForTransition("divergence", "repair_failed", {
    previousState: "divergent",
    previousRiskState: "support",
  });
  options.previousEvidence.summary = {
    strictCoreCount: 999,
    divergent: { count: 0, rows: [] },
    supported: { count: 999, rows: [{ code: "FORGED", name: "伪造汇总" }] },
  };
  const result = contractModule.buildEmotionCoreEvidenceFromPayload(options);

  assert.equal(result.transition.status, "unavailable");
  assert.equal(result.transition.reason, "previous_strict_core_contract_unavailable_or_not_same_version");
  assert.equal(result.transition.expectedPreviousTradingDate, PREVIOUS_GENERATION.tradingDate);
  assert.equal(result.transition.sameVersion, false);
  assert.equal(JSON.stringify(result.transition).includes("ANON-PREVIOUS-RISK"), false);
  assert.equal(JSON.stringify(result.transition).includes("FORGED"), false);
});

for (const scenario of [
  { previous: "divergent", current: "support", key: "divergence_to_support_repair", label: "昨日分歧 → 今日承接修复" },
    { previous: "participating", current: "divergence", key: "participating_to_divergence", label: "昨日周期内平稳运行 → 今日转分歧" },
]) {
  test(`严格核心跨日映射：${scenario.label}`, () => {
    const result = contractModule.buildEmotionCoreEvidenceFromPayload(adapterOptionsForTransition(
      scenario.current,
      "repair_failed",
      { previousState: scenario.previous, previousRiskState: "repair_failed" },
    ));
    assert.equal(result.transition.status, "ready");
    assert.equal(result.transition.key, scenario.key);
    assert.equal(result.transition.label, scenario.label);
  });
}

test("前一日严格核心契约任一血缘、收盘、分池或零投票条件不满足时 transition 必须关闭且不复用旧名字", () => {
  const invalidCases = [
    ["status", (evidence) => { evidence.status = "insufficient"; }],
    ["contractVersion", (evidence) => { evidence.contractVersion = 1; }],
    ["classifierVersion", (evidence) => { evidence.lineage.classifierVersion = "strict-core-qualification-v0"; }],
    ["snapshotKind", (evidence) => { evidence.basis.snapshotKind = "live"; }],
    ["exact T-1", (evidence) => { evidence.tradingDate = "2026-08-12"; }],
    ["generation envelope", (evidence) => { evidence.generation.generationId = "other-generation"; }],
    ["strict row metadata", (evidence) => { delete evidence.strictEmotionCores[0].asOf; }],
    ["risk zero vote", (evidence) => { evidence.heightRiskBarometers[0].votingWeight = 1; }],
    ["pool overlap", (evidence) => { evidence.heightRiskBarometers[0].code = evidence.strictEmotionCores[0].code; }],
  ];
  for (const [name, mutate] of invalidCases) {
    const options = adapterOptionsForTransition("support", "repair_failed");
    mutate(options.previousEvidence);
    const result = contractModule.buildEmotionCoreEvidenceFromPayload(options);
    assert.equal(result.transition.status, "unavailable", `${name} 必须关闭`);
    assert.equal(result.transition.previous, null, `${name} 不得输出前日阶段`);
    assert.equal(result.transition.current, null, `${name} 不得输出今日阶段`);
    assert.equal(JSON.stringify(result.transition).includes("匿名严格核心"), false, `${name} 不得复用旧名字`);
  }
});

test("当日 strictEmotionCores 为空时阶段为 unknown，transition 保持 unavailable", () => {
  const result = contractModule.buildEmotionCoreEvidenceFromPayload(adapterOptionsForTransition(
    "divergence",
    "repair_failed",
    { completed: false },
  ));
  assert.deepEqual(result.strictEmotionCores, []);
  assert.equal(result.transition.status, "unavailable");
  assert.equal(result.transition.previous, null);
  assert.equal(result.transition.current, null);
});

test("v2每行输出正负影响与voteRole，已验证负反馈可放大而纯高度旁证仍为0票", () => {
  const verifiedNegative = strictCore("ANON-VERIFIED-NEGATIVE", "repair_failed", {
    identity: { rank: "co_core", activePrimary: false, validImpactDays: 2 },
    session: { supportScore: 8, damageScore: 70 },
  });
  const pureHeight = heightRiskBarometer("ANON-PURE-HEIGHT", "repair_failed", {
    session: { supportScore: 3, damageScore: 92 },
  });
  const result = buildContract(contractInput([verifiedNegative, pureHeight]));
  const negativeRow = result.strictEmotionCores[0];
  const heightRow = result.heightRiskBarometers[0];

  assert.equal(result.contractVersion, 2);
  assert.equal(negativeRow.voteRole, "risk_core");
  assert.equal(negativeRow.negativeFeedbackAmplified, true);
  assert.ok(negativeRow.negativeInfluenceScore > verifiedNegative.session.damageScore);
  assert.equal(negativeRow.signedInfluenceScore, negativeRow.positiveInfluenceScore - negativeRow.negativeInfluenceScore);
  assert.equal(negativeRow.selectionAuthority, false);
  assert.equal(negativeRow.executionAuthority, false);
  assert.equal(heightRow.voteRole, "height_context");
  assert.equal(heightRow.votingWeight, 0);
  assert.equal(heightRow.positiveInfluenceScore, 0);
  assert.equal(heightRow.negativeInfluenceScore, 0);
  assert.equal(heightRow.signedInfluenceScore, 0);
  assert.equal(heightRow.executionAuthority, false);
});

test("identityEstablished的retained co-core不需activePrimary，高位风险可进risk_core但不冒充已确认负反馈", () => {
  const coCode = "ANON-RETAINED-HEIGHT-CORE";
  const pureHeightCode = "ANON-HEIGHT-CONTEXT-ONLY";
  const cycleInstanceId = "anonymous-v2-cycle";
  const closing = (code, name) => ({
    code,
    name,
    role: "高度核心",
    klineProfile: {
      lastSession: {
        tradingDate: GENERATION.tradingDate,
        snapshotKind: "closing",
        completed: true,
        verified: true,
        source: "verified-closing",
      },
    },
  });
  const payload = {
    candidates: [closing(coCode, "匿名跨日高度核心"), closing(pureHeightCode, "匿名单日高度")],
    themeLibrary: {
      ...adapterThemeLibraryMeta(),
      tradingDate: GENERATION.tradingDate,
      generatedAt: GENERATION.asOf,
      snapshotKind: "closing",
      themes: [{
        id: "anonymous-v2-theme",
        name: "匿名v2题材",
        family: "匿名父题材",
        cycleLeadership: {
          version: 1,
          settledTradingDate: GENERATION.tradingDate,
          cycleInstanceId,
          state: "retained",
          activeLeaderCode: "OTHER-ACTIVE-PRIMARY",
          primary: { code: "OTHER-ACTIVE-PRIMARY" },
          identities: {
            [coCode]: {
              code: coCode,
              cycleInstanceId,
              state: "retained",
              identityEstablished: true,
              activePrimary: false,
              validImpactDays: 2,
              confirmedTradingDates: ["2026-08-13", "2026-08-14"],
            },
          },
        },
        dailyHeightStocks: [
          { code: coCode, name: "匿名跨日高度核心" },
          { code: pureHeightCode, name: "匿名单日高度" },
        ],
      }],
    },
  };
  const result = contractModule.buildEmotionCoreEvidenceFromPayload({
    payload,
    coreEmotionBasket: {
      emotionCycle: {
        rankedAnchors: [
          {
            code: coCode,
            board: { consecutiveBoards: 4, boardsInWindow: 4 },
            participation: { individualState: "divergence", facts: { supportScore: 32, damageScore: 15 } },
          },
          {
            code: pureHeightCode,
            board: { consecutiveBoards: 4, boardsInWindow: 4 },
            participation: { individualState: "divergence", facts: { supportScore: 3, damageScore: 85 } },
          },
        ],
      },
    },
    marketPhaseDetail: { structuralCycle: "主升" },
    generation: GENERATION,
  });
  const coCore = result.strictEmotionCores.find((row) => row.code === coCode);
  const heightContext = result.heightRiskBarometers.find((row) => row.code === pureHeightCode);

  assert.ok(coCore, "activePrimary=false的跨日身份应进入co-core篮子");
  assert.equal(coCore.identity.activePrimary, false);
  assert.equal(coCore.voteRole, "risk_core");
  assert.equal(coCore.riskPressureConfirmed, false);
  assert.equal(coCore.negativeFeedbackAmplified, false);
  assert.equal(coCore.negativeInfluenceScore, 15);
  assert.ok(coCore.riskPressureScore >= 25);
  assert.equal(coCore.executionAuthority, false);
  assert.ok(heightContext);
  assert.equal(heightContext.voteRole, "height_context");
  assert.equal(heightContext.votingWeight, 0);
});

test("严格情绪核心篮子最多5只，并为risk_core保留1个角色位", () => {
  const rows = [
    strictCore("ANON-PRIMARY", "participating", { identity: { rank: "primary", activePrimary: true, validImpactDays: 4 } }),
    strictCore("ANON-CAPACITY", "participating", { role: "主动容量中军", identity: { rank: "co_core", activePrimary: false, validImpactDays: 3 } }),
    strictCore("ANON-HEIGHT", "participating", { board: { consecutiveBoards: 4 }, identity: { rank: "co_core", activePrimary: false, validImpactDays: 3 } }),
    strictCore("ANON-REPAIR", "support", { identity: { rank: "co_core", activePrimary: false, validImpactDays: 3 } }),
    strictCore("ANON-COCORE-A", "participating", { identity: { rank: "co_core", activePrimary: false, validImpactDays: 2 } }),
    strictCore("ANON-RISK-RESERVED", "repair_failed", { identity: { rank: "co_core", activePrimary: false, validImpactDays: 2 }, session: { supportScore: 4, damageScore: 65 } }),
  ];
  const result = buildContract(contractInput(rows));
  assert.equal(result.strictEmotionCores.length, 5);
  assert.ok(result.strictEmotionCores.some((row) => row.code === "ANON-RISK-RESERVED" && row.voteRole === "risk_core"));
  assert.equal(result.integrity.strictCoreBasketMaxFive, true);
  assert.equal(result.guardrails.strictCoreBasketMaximum, 5);
  assert.equal(result.dataQuality.strictCoreRowsBeforeLimit, 6);
  assert.equal(result.dataQuality.strictCoreRowsExcludedByLimit, 1);
  assert.ok(result.strictEmotionCores.every((row) => row.executionAuthority === false));
});

test("市场情绪核心不足5只时也按角色、跨日影响和代码稳定排序", () => {
  const rows = [
    strictCore("ANON-COCORE-Z", "participating", { identity: { rank: "co_core", activePrimary: false, validImpactDays: 2 } }),
    strictCore("ANON-PRIMARY-A", "support", { identity: { rank: "primary", activePrimary: true, validImpactDays: 3 } }),
    strictCore("ANON-RISK-B", "repair_failed", { identity: { rank: "co_core", activePrimary: false, validImpactDays: 2 }, session: { supportScore: 4, damageScore: 80 } }),
  ];
  const forward = buildContract(contractInput(rows));
  const reversed = buildContract(contractInput(rows.slice().reverse()));
  const forwardCodes = forward.strictEmotionCores.map((row) => row.code);
  const reversedCodes = reversed.strictEmotionCores.map((row) => row.code);

  assert.deepEqual(forwardCodes, reversedCodes);
  assert.deepEqual(forwardCodes, ["ANON-RISK-B", "ANON-PRIMARY-A", "ANON-COCORE-Z"]);
});

for (const mismatch of [
  {
    name: "generation",
    code: "generation_mismatch",
    apply(input) { input.themeCycles[0].cycle.generationId = "other-generation"; },
  },
  {
    name: "tradingDate",
    code: "trading_date_mismatch",
    apply(input) { input.themeCycles[0].cycle.tradingDate = "2026-08-13"; },
  },
  {
    name: "asOf",
    code: "as_of_mismatch",
    apply(input) { input.themeCycles[0].cycle.asOf = "2026-08-14T14:00:00+08:00"; },
  },
  {
    name: "contractVersion",
    code: "contract_version_mismatch",
    apply(input) { input.themeCycles[0].cycle.contractVersion = CONTRACT_VERSION + 1; },
  },
]) {
  test(`${mismatch.name} 错配时 fail-close：两池和阶段汇总均不得输出`, () => {
    const input = contractInput([
      strictCore(`ANON-MISMATCH-CORE-${mismatch.name}`, "divergent"),
      heightRiskBarometer(`ANON-MISMATCH-RISK-${mismatch.name}`, "support"),
    ]);
    mismatch.apply(input);
    const result = buildContract(input);

    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.strictEmotionCores, []);
    assert.deepEqual(result.heightRiskBarometers, []);
    assert.equal(result.summary.strictCoreCount, 0);
    assert.equal(result.summary.heightRiskBarometerCount, 0);
    assertNamedRowsBackSummary(result.summary);
    assert.equal(result.summary.divergent.count, 0);
    assert.equal(result.summary.support.count, 0);
    assert.equal(result.integrity.sameGeneration, false);
    assert.equal(result.integrity.finalEmotionStageUnchanged, true);
    assert.equal(result.integrity.tradePermissionUnchanged, true);
    assert.equal(result.dataQuality.failClosed, true);
    assert.ok(result.dataQuality.reasonCodes.includes(mismatch.code));
  });
}

function emotionStagePathOptions(currentState = "divergence", previousState = "divergent") {
  const options = adapterOptionsForTransition(currentState, "repair_failed", {
    previousState,
    previousRiskState: "repair_failed",
  });
  options.marketPhaseDetail = {
    structuralCycle: "主升",
    emotionStage: { key: "strong_divergence", label: "强分歧" },
    tomorrowBaseline: {
      key: "must-not-use-market-phase-baseline",
      label: "不得直接使用 marketPhaseDetail 基准",
      status: "baseline_unconfirmed",
      rank: 1,
      probability: 99,
      calibrated: true,
    },
    selectionPolicy: {
      mode: "conditional_after_support",
      label: "只在真实承接出现后参与",
    },
  };
  options.existingDecision = {
    market: {
      phaseDetail: {
        emotionStage: { key: "existing-strong-divergence", label: "既有强分歧结论" },
      },
    },
    selectionPolicy: {
      mode: "existing-selection-policy",
      label: "既有筛选权限不得改写",
    },
    tomorrowBaseline: {
      key: "divergence_continuation",
      label: "分歧延续优先",
      status: "baseline_unconfirmed",
      rank: 1,
      probability: 88,
      calibrated: true,
      trigger: ["严格核心分歧后出现真实承接"],
      cancel: ["严格核心负反馈继续扩散"],
      ignoredField: "不得进入路径白名单",
    },
    permission: {
      status: "watch_only",
      allowNew: false,
      reason: "既有交易权限不得改写",
    },
    forecast: {
      method: "rule_prior",
      calibrated: false,
      primary: { key: "range_divergence", probability: null },
    },
  };
  return options;
}

function requireEmotionStagePath(result) {
  assert.ok(
    result && result.emotionStagePath && typeof result.emotionStagePath === "object",
    "情绪核心证据必须新增独立 emotionStagePath；不能用旧 transition 或最终 emotionStage 冒充路径图契约",
  );
  return result.emotionStagePath;
}

test("情绪阶段路径按 昨日严格核心→今日严格核心→明日未校准基准 固定排序，且只作证据展示", () => {
  const options = emotionStagePathOptions("divergence", "divergent");
  const before = structuredClone(options);
  const result = contractModule.buildEmotionCoreEvidenceFromPayload(options);
  const path = requireEmotionStagePath(result);

  assert.deepEqual(path.order, ["previous", "current", "tomorrow"]);
  assert.equal(path.status, "ready");
  assert.equal(path.contractVersion, CONTRACT_VERSION);
  assert.equal(path.calibrated, false);
  assert.equal(path.nodes.previous.key, "divergence");
  assert.equal(path.nodes.previous.tradingDate, PREVIOUS_GENERATION.tradingDate);
  assert.equal(path.nodes.previous.snapshotKind, "closing");
  assert.equal(path.nodes.previous.contractVersion, CONTRACT_VERSION);
  assert.equal(path.nodes.previous.classifierVersion, "strict-core-qualification-v2");
  assert.equal(path.nodes.current.key, "divergence");
  assert.equal(path.nodes.current.tradingDate, GENERATION.tradingDate);
  assert.equal(path.nodes.current.snapshotKind, "closing");
  assert.equal(path.nodes.current.contractVersion, CONTRACT_VERSION);
  assert.equal(path.nodes.current.classifierVersion, "strict-core-qualification-v2");
  assert.deepEqual(path.nodes.tomorrow, {
    key: "divergence_continuation",
    label: "分歧延续优先",
    status: "baseline_unconfirmed",
    rank: 1,
    probability: null,
    calibrated: false,
    trigger: ["严格核心分歧后出现真实承接"],
    cancel: ["严格核心负反馈继续扩散"],
    source: "existingDecision.tomorrowBaseline",
  });
  assert.equal(path.transition.key, "divergence_to_divergence");
  assert.equal(path.transition.label, "昨日分歧 → 今日分歧延续");
  assert.deepEqual(path.guardrails, {
    emotionStageAuthority: false,
    selectionPolicyAuthority: false,
    permissionAuthority: false,
    forecastAuthority: false,
  });
  assert.deepEqual(options, before, "新增路径契约必须是纯投影，不能改写输入");
  assert.deepEqual(result.decision, before.existingDecision, "证据路径不能改写既有决策字段");

  const withoutRules = emotionStagePathOptions("divergence", "divergent");
  delete withoutRules.existingDecision.tomorrowBaseline.trigger;
  delete withoutRules.existingDecision.tomorrowBaseline.cancel;
  const emptyRuleNode = requireEmotionStagePath(
    contractModule.buildEmotionCoreEvidenceFromPayload(withoutRules),
  ).nodes.tomorrow;
  assert.deepEqual(emptyRuleNode.trigger, []);
  assert.deepEqual(emptyRuleNode.cancel, []);
});

for (const stateCase of [
  { state: "divergence", group: "divergent" },
  { state: "support", group: "supported" },
  { state: "repair_failed", group: "repairFailed" },
]) {
  test(`路径节点的${stateCase.group}必须由匿名严格核心 rows 反算，高度风险只能作为零票旁证`, () => {
    const options = emotionStagePathOptions(stateCase.state, "divergent");
    options.previousEvidence.summary = {
      strictCoreCount: 999,
      divergent: { count: 999, rows: [{ code: "FORGED-PREVIOUS", name: "伪造昨日汇总" }] },
    };
    const result = contractModule.buildEmotionCoreEvidenceFromPayload(options);
    const path = requireEmotionStagePath(result);
    const current = path.nodes.current;
    const group = current.evidence[stateCase.group];

    assert.equal(current.evidence.strictCoreCount, 1);
    assert.equal(group.count, 1);
    assert.deepEqual(group.codes, ["ANON-CURRENT-STRICT"]);
    assert.deepEqual(group.names, ["匿名当日严格核心"]);
    assert.equal(group.rows.length, 1);
    assert.equal(group.rows[0].code, "ANON-CURRENT-STRICT");
    assert.equal(group.rows[0].name, "匿名当日严格核心");
    assert.equal(path.nodes.previous.evidence.divergent.codes.includes("FORGED-PREVIOUS"), false);
    assert.equal(current.riskContext.count, 1);
    assert.equal(current.riskContext.votingWeight, 0);
    assert.ok(current.riskContext.rows.every((row) => row.votingWeight === 0));
    assert.equal(JSON.stringify(current.evidence).includes("ANON-CURRENT-RISK"), false);
  });
}

test("缺少 exact T-1 closing 时路径为 unavailable，不能编造昨日阶段", () => {
  const options = emotionStagePathOptions();
  options.previousEvidence = null;
  const path = requireEmotionStagePath(contractModule.buildEmotionCoreEvidenceFromPayload(options));

  assert.equal(path.status, "unavailable");
  assert.equal(path.nodes.previous.status, "unavailable");
  assert.equal(path.nodes.previous.key, null);
  assert.ok(path.dataQuality.reasonCodes.includes("exact_t1_closing_unavailable"));
  assert.ok(path.gaps.some((gap) => /exact T-1/.test(gap)));
});

test("T-1 证据即使血缘内部自洽，只要 asOf/generation 的上海日期晚于 tradingDate 就必须拒绝", () => {
  const options = emotionStagePathOptions();
  const futureAsOf = "2026-08-14T09:00:00+08:00";
  const futureGeneration = {
    id: `${PREVIOUS_GENERATION.tradingDate}:${futureAsOf}`,
    tradingDate: PREVIOUS_GENERATION.tradingDate,
    asOf: futureAsOf,
  };
  const futureDatedEvidence = replaceEvidenceGeneration(
    options.previousEvidence,
    futureGeneration,
  );
  futureDatedEvidence.generation = {
    id: futureGeneration.id,
    generationId: futureGeneration.id,
    tradingDate: futureGeneration.tradingDate,
    asOf: futureGeneration.asOf,
  };
  futureDatedEvidence.basis = {
    ...futureDatedEvidence.basis,
    tradingDate: futureGeneration.tradingDate,
    snapshotKind: "closing",
    asOf: futureGeneration.asOf,
  };
  options.previousEvidence = futureDatedEvidence;

  const result = contractModule.buildEmotionCoreEvidenceFromPayload(options);
  const path = requireEmotionStagePath(result);

  assert.equal(path.status, "unavailable");
  assert.equal(path.nodes.previous.status, "unavailable");
  assert.equal(path.nodes.previous.key, null);
  assert.ok(path.dataQuality.reasonCodes.includes("previous_evidence_future_dated"));
  assert.equal(path.dataQuality.reasonCodes.includes("previous_strict_core_insufficient"), false);
  assert.equal(result.transition.status, "unavailable");
  assert.equal(result.transition.sameVersion, false);
});

test("路径证据必须接收当前题材库分类器版本，不能因仍锁死旧 v5 而在真实链路整体关闭", () => {
  const options = emotionStagePathOptions();
  options.payload.themeLibrary.classifierVersion = "theme-library-v8-family-subtheme-decision";
  const result = contractModule.buildEmotionCoreEvidenceFromPayload(options);

  assert.notEqual(result.status, "unavailable");
  assert.equal(result.dataQuality.reasonCodes.includes("theme_library_classifier_version_unsupported"), false);
  assert.equal(requireEmotionStagePath(result).status, "ready");

  const future = emotionStagePathOptions();
  future.payload.themeLibrary.classifierVersion = "theme-library-v9-unreviewed-future-contract";
  const futureResult = contractModule.buildEmotionCoreEvidenceFromPayload(future);
  assert.equal(futureResult.status, "unavailable", "未审阅的未来分类器版本必须 fail-close");
  assert.ok(futureResult.dataQuality.reasonCodes.includes("theme_library_classifier_version_unsupported"));
});

test("当日没有严格核心时路径为 insufficient，不能让高度风险票补出今日阶段", () => {
  const options = emotionStagePathOptions("divergence", "divergent");
  options.payload.candidates[0].klineProfile.lastSession.completed = false;
  options.payload.candidates[0].klineProfile.lastSession.verified = false;
  const result = contractModule.buildEmotionCoreEvidenceFromPayload(options);
  const path = requireEmotionStagePath(result);

  assert.deepEqual(result.strictEmotionCores, []);
  assert.ok(result.heightRiskBarometers.length > 0);
  assert.equal(path.status, "insufficient");
  assert.equal(path.nodes.current.status, "insufficient");
  assert.equal(path.nodes.current.key, null);
  assert.ok(path.dataQuality.reasonCodes.includes("current_strict_core_insufficient"));
  assert.ok(path.gaps.some((gap) => /今日严格核心不足/.test(gap)));
});

test("T-1存在但 contractVersion/classifier/同代完整性不足时为 insufficient，不复用旧阶段", () => {
  const invalidCases = [
    ["contractVersion", (evidence) => { evidence.contractVersion = CONTRACT_VERSION + 1; }],
    ["classifier", (evidence) => { evidence.lineage.classifierVersion = "strict-core-qualification-v0"; }],
    ["generation completeness", (evidence) => { delete evidence.strictEmotionCores[0].asOf; }],
  ];
  for (const [name, mutate] of invalidCases) {
    const options = emotionStagePathOptions();
    mutate(options.previousEvidence);
    const path = requireEmotionStagePath(contractModule.buildEmotionCoreEvidenceFromPayload(options));
    assert.equal(path.status, "insufficient", name);
    assert.equal(path.nodes.previous.status, "insufficient", name);
    assert.equal(path.nodes.previous.key, null, name);
    assert.ok(path.dataQuality.reasonCodes.includes("previous_evidence_incomplete"), name);
  }

  const tiedOptions = emotionStagePathOptions();
  const tied = structuredClone(tiedOptions.previousEvidence.strictEmotionCores[0]);
  tied.code = "ANON-PREVIOUS-STRICT-TIED";
  tied.name = "匿名昨日严格核心-承接平票";
  tied.state = "support";
  tied.currentState = "support";
  tied.session.state = "support";
  tied.positiveInfluenceScore = 58;
  tied.negativeInfluenceScore = 18;
  tied.signedInfluenceScore = 40;
  tied.riskPressureScore = 0;
  tied.riskPressureConfirmed = false;
  tied.voteRole = "repair_core";
  const tiedStateEvidence = tied.evidence.find((row) => row.key === "current_state");
  if (tiedStateEvidence) tiedStateEvidence.value = "support";
  tiedOptions.previousEvidence.strictEmotionCores.push(tied);
  tiedOptions.previousEvidence.coreCandidates.push(structuredClone(tied));
  tiedOptions.previousEvidence.themeCycles[0].strictEmotionCores.push(structuredClone(tied));
  tiedOptions.previousEvidence.themeCycles[0].coreCandidates.push(structuredClone(tied));
  refreshInfluenceSummary(tiedOptions.previousEvidence);
  const tiedPath = requireEmotionStagePath(
    contractModule.buildEmotionCoreEvidenceFromPayload(tiedOptions),
  );
  assert.equal(tiedPath.status, "insufficient", "严格核心分歧/承接平票不得默认平稳运行");
  assert.equal(tiedPath.nodes.previous.status, "insufficient");
  assert.equal(tiedPath.nodes.previous.key, null);
  assert.equal(tiedPath.nodes.previous.evidence.strictCoreCount, 2, "阶段未确认也必须保留两只具名严格核心用于审计");
  assert.deepEqual(
    [...tiedPath.nodes.previous.evidence.divergent.codes, ...tiedPath.nodes.previous.evidence.supported.codes].sort(),
    ["ANON-PREVIOUS-STRICT", "ANON-PREVIOUS-STRICT-TIED"].sort(),
  );
  assert.ok(tiedPath.dataQuality.reasonCodes.includes("previous_strict_core_insufficient"));
});
