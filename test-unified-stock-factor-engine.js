"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  STOCK_FACTOR_AUTHORITY,
  STOCK_FACTOR_VERSION,
  buildUnifiedStockFactorDecision,
} = require("./quant-decision/stock-factor-engine");

function fixture(overrides = {}) {
  const stock = {
    code: "000001",
    price: 10,
    priceIntegrity: { status: "pass", valid: true, consistent: true, price: 10 },
    role: "龙头",
    setup: "低位启动·承接",
    ticketType: "容量票",
    changePct: 3,
    turnoverRate: 10,
    volumeRatio: 1.5,
    mainInflowYi: 2,
    eastRank: 8,
    inBothSources: true,
    klineProfile: {
      wave: "一波启动",
      rise10: 8,
      pctFromHigh: 6,
      chipComfort: "舒服",
    },
    leadership: {
      level: "L3",
      coreIdentityQualified: true,
      persistentRecognition: true,
      tradeState: "可交易",
      initiative: { score: 70, dataQuality: "分时验证" },
      directionState: { isCoreDirection: true, resonance: true, resonanceType: "absolute" },
      structure: { grade: "A" },
    },
    backtest: { summary: { sampleCount: 10, winRate3d: 60, avgNextClose: 1, worstDrawdown: -10 } },
    hardGate: { pass: true },
    tomorrowExecution: {
      tomorrowEntryQualified: true,
      triggers: ["承接确认"],
      cancelConditions: ["跌破关键位"],
    },
    gamePlan: { canGame: true },
    score: 999,
    ...overrides,
  };
  return {
    stock,
    decisionKey: "混沌",
    themeEvidence: { focusHit: 20, supportHit: 8, mainHit: 12, threshold: 8 },
    roleAuthority: { cycleLeader: true, rollingCapacity: false, coreAuthorized: true },
    survivorScore: 4,
    reflowBonus: 2,
    modeAllowed: true,
    dataComplete: true,
    riskPassed: true,
    upstreamGate: true,
    priceIntegrity: stock.priceIntegrity,
  };
}

test("统一个股因子引擎输出唯一authority与三层评分", () => {
  const result = buildUnifiedStockFactorDecision(fixture());
  assert.equal(result.authority, STOCK_FACTOR_AUTHORITY);
  assert.equal(result.version, STOCK_FACTOR_VERSION);
  assert.equal(result.hardGate.pass, true);
  assert.equal(Number.isFinite(result.participationValue.score), true);
  assert.equal(result.riskAdjustment.score <= 0, true);
  assert.equal(result.finalScore, result.participationValue.score + result.riskAdjustment.score);
  assert.equal(result.deduplication.baseObservationScoreUsed, false);
});

test("旧stock.score无论多高都不进入正式个股因子", () => {
  const high = buildUnifiedStockFactorDecision(fixture({ score: 999999 }));
  const low = buildUnifiedStockFactorDecision(fixture({ score: -999999 }));
  assert.equal(high.finalScore, low.finalScore);
  assert.equal(Object.prototype.hasOwnProperty.call(high.participationValue.components, "legacyScore"), false);
});

test("任一硬门槛失败时参与价值和最终分不计算", () => {
  const input = fixture();
  input.themeEvidence.focusHit = 3;
  input.themeEvidence.mainHit = 2;
  const result = buildUnifiedStockFactorDecision(input);
  assert.equal(result.hardGate.pass, false);
  assert.equal(result.participationValue, null);
  assert.equal(result.riskAdjustment, null);
  assert.equal(result.finalScore, null);
  assert.match(result.hardGate.blockers.join("；"), /题材匹配/);
});

test("同一只股票在不同大小周期下由统一引擎重算而不是沿用旧分", () => {
  const chaos = buildUnifiedStockFactorDecision(fixture());
  const mainRiseInput = fixture();
  mainRiseInput.decisionKey = "主升";
  const mainRise = buildUnifiedStockFactorDecision(mainRiseInput);
  assert.notEqual(chaos.finalScore, mainRise.finalScore);
  assert.equal(chaos.authority, mainRise.authority);
});

test("量比低于1.2不阻断因子计算，但流动性得分低于正常放量", () => {
  const normal = buildUnifiedStockFactorDecision(fixture({ volumeRatio: 1.2 }));
  const mildShrink = buildUnifiedStockFactorDecision(fixture({ volumeRatio: 1.1 }));
  const shrink = buildUnifiedStockFactorDecision(fixture({ volumeRatio: 0.8 }));
  const overheated = buildUnifiedStockFactorDecision(fixture({ volumeRatio: 4 }));
  assert.equal(normal.hardGate.pass, true);
  assert.equal(mildShrink.hardGate.pass, true);
  assert.equal(shrink.hardGate.pass, true);
  assert(normal.participationValue.components.liquidity > mildShrink.participationValue.components.liquidity);
  assert(mildShrink.participationValue.components.liquidity > shrink.participationValue.components.liquidity);
  assert(normal.participationValue.components.liquidity > overheated.participationValue.components.liquidity);
});

test("大周期决定领导力总权重，退潮期领导力不获得新开仓排序权", () => {
  const cases = [
    ["混沌", 0.25],
    ["主升", 0.45],
    ["震荡", 0.35],
    ["冰点", 0.3],
    ["退潮", 0],
  ];
  for (const [decisionKey, expected] of cases) {
    const input = fixture();
    input.decisionKey = decisionKey;
    input.smallCycleKey = "平稳运行";
    const result = buildUnifiedStockFactorDecision(input);
    assert.equal(result.leadershipWeighting.overallWeight, expected, decisionKey);
  }
});

test("小周期只调整领导力内部侧重，启动看主动性，加强看周期身份", () => {
  const launchInput = fixture();
  launchInput.smallCycleKey = "低位启动";
  launchInput.stock.leadership.directionState = { isCoreDirection: false, resonance: false };
  const launch = buildUnifiedStockFactorDecision(launchInput);
  assert.deepEqual(launch.leadershipWeighting.componentWeights, {
    initiative: 0.55,
    identity: 0.15,
    direction: 0.3,
  });

  const strengtheningInput = fixture();
  strengtheningInput.smallCycleKey = "加强";
  strengtheningInput.stock.leadership.directionState = { isCoreDirection: false, resonance: false };
  const strengthening = buildUnifiedStockFactorDecision(strengtheningInput);
  assert.deepEqual(strengthening.leadershipWeighting.componentWeights, {
    initiative: 0.3,
    identity: 0.45,
    direction: 0.25,
  });
  assert.notEqual(launch.leadershipWeighting.qualityScore, strengthening.leadershipWeighting.qualityScore);

  const repairStrengtheningInput = fixture();
  repairStrengtheningInput.smallCycleKey = "修复加强";
  const repairStrengthening = buildUnifiedStockFactorDecision(repairStrengtheningInput);
  assert.equal(repairStrengthening.leadershipWeighting.profileKey, "strengthening");
});

test("分时领导力未验证时保留观察分，但领导力质量分上限60", () => {
  const input = fixture();
  input.stock.leadership.initiative.dataQuality = "收盘代理";
  input.stock.leadership.initiative.score = 100;
  const result = buildUnifiedStockFactorDecision(input);
  assert.equal(result.leadershipWeighting.intradayVerified, false);
  assert(result.leadershipWeighting.qualityScore <= 60);
});

test("完整分钟OHLC、收盘价格序列和盘中部分数据使用不同领导力证据权重", () => {
  const fullInput = fixture();
  fullInput.stock.leadership.initiative.dataQualityKey = "exact_closing_full_ohlc";
  fullInput.stock.leadership.initiative.dataQualityLabel = "完整分时验证";
  const full = buildUnifiedStockFactorDecision(fullInput);

  const priceInput = fixture();
  priceInput.stock.leadership.initiative.dataQualityKey = "exact_closing_price_series";
  priceInput.stock.leadership.initiative.dataQualityLabel = "价格序列分时验证";
  const price = buildUnifiedStockFactorDecision(priceInput);

  const partialInput = fixture();
  partialInput.stock.leadership.initiative.dataQuality = "分时部分验证";
  partialInput.stock.leadership.initiative.dataQualityKey = "partial_session";
  partialInput.stock.leadership.initiative.dataQualityLabel = "盘中部分分时验证";
  const partial = buildUnifiedStockFactorDecision(partialInput);

  assert.equal(full.leadershipWeighting.evidenceWeight, 1);
  assert.equal(price.leadershipWeighting.evidenceWeight, 0.85);
  assert.equal(partial.leadershipWeighting.evidenceWeight, 0.55);
  assert(full.leadershipWeighting.qualityScore > price.leadershipWeighting.qualityScore);
  assert(price.leadershipWeighting.qualityScore > partial.leadershipWeighting.qualityScore);
  assert.equal(partial.leadershipWeighting.intradayVerified, false);
  assert(partial.leadershipWeighting.qualityScore <= 50);
});

test("一字锁价或价格不可核验时，执行可行性只能收紧并直接关闭个股因子", () => {
  const lockedInput = fixture();
  lockedInput.stock.leadership.initiative.priceDiscovery = { noPriceDiscovery: true };
  const locked = buildUnifiedStockFactorDecision(lockedInput);
  assert.equal(locked.executionFeasibility.status, "blocked");
  assert.equal(locked.executionFeasibility.canGrantExecution, false);
  assert.equal(locked.hardGate.pass, false);
  assert.equal(locked.finalScore, null);

  const missingPriceInput = fixture({ price: null, priceIntegrity: { status: "unavailable", valid: false } });
  missingPriceInput.priceIntegrity = missingPriceInput.stock.priceIntegrity;
  const missingPrice = buildUnifiedStockFactorDecision(missingPriceInput);
  assert.equal(missingPrice.executionFeasibility.status, "blocked");
  assert.match(missingPrice.hardGate.blockers.join("；"), /价格/);
});

test("量比过热和高换手不伪造滑点，只以风险罚分降低参与价值", () => {
  const normal = buildUnifiedStockFactorDecision(fixture({ volumeRatio: 1.5, turnoverRate: 12 }));
  const crowded = buildUnifiedStockFactorDecision(fixture({ volumeRatio: 4.2, turnoverRate: 35, changePct: 9 }));
  assert.equal(crowded.executionFeasibility.status, "conditional");
  assert.equal(crowded.executionFeasibility.slippageRisk, "high");
  assert(crowded.riskAdjustment.components.executionFeasibility < normal.riskAdjustment.components.executionFeasibility);
  assert.equal(crowded.executionFeasibility.executableNow, false);
});
