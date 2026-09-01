"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = __dirname;
const FIXTURE_PATH = path.join(
  ROOT,
  "test-fixtures",
  "post-close-opportunity",
  "mainline-core-normal-divergence-reflow.json",
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const fixture = readJson(FIXTURE_PATH);
const decisionArchive = readJson(path.join(ROOT, "data", "history", "2026-08-10.json"));
const outcomeArchive = readJson(path.join(ROOT, "data", "history", "2026-08-11.json"));

function stockFrom(archive, code) {
  for (const bucket of [archive.selected, archive.rejected, archive.candidates]) {
    const row = Array.isArray(bucket) ? bucket.find((item) => item && item.code === code) : null;
    if (row) return row;
  }
  return null;
}

function leaderFrom(archive, code) {
  return (archive.leadershipBoard?.leaders || []).find((item) => item.code === code) || null;
}

function themeFrom(archive, code) {
  return (archive.themeLibrary?.themes || []).find((theme) => (
    Array.isArray(theme.stocks) && theme.stocks.some((stock) => stock.code === code)
  )) || null;
}

function styleCaseFrom(archive, code) {
  return (archive.market?.tradingStyle?.analysis?.examples || []).find((item) => item.code === code) || null;
}

function getField(root, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => (
    value == null ? undefined : value[key]
  ), root);
}

function ruleMatches(root, rule, fieldKey = "field", operatorKey = "operator") {
  const actual = getField(root, rule[fieldKey]);
  switch (rule[operatorKey]) {
    case "lt": return actual < rule.value;
    case "eq_true": return actual === true;
    case "eq_false": return actual === false;
    case "not_null": return actual !== null && actual !== undefined;
    default: throw new Error(`Unsupported fixture operator: ${rule[operatorKey]}`);
  }
}

function collectKeys(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, item] of Object.entries(value)) {
    output.push(key);
    collectKeys(item, output);
  }
  return output;
}

test("golden fixture is parseable, versioned, deidentified, and source-linked", () => {
  assert.equal(fixture.contractVersion, 1);
  assert.equal(fixture.fixtureKind, "post_close_opportunity_golden");
  assert.equal(fixture.privacy.deidentified, true);
  assert.equal(fixture.privacy.containsAccountIdentity, false);
  assert.equal(fixture.privacy.containsAccountSize, false);
  assert.equal(fixture.privacy.containsExactUserOrders, false);

  const archiveRefs = fixture.sourceRefs.filter((ref) => ref.kind === "closing_archive");
  assert.deepEqual(archiveRefs.map((ref) => ref.path), [
    "data/history/2026-08-10.json",
    "data/history/2026-08-11.json",
  ]);
  archiveRefs.forEach((ref) => assert.equal(fs.existsSync(path.join(ROOT, ref.path)), true));

  const forbiddenPersonalKeys = new Set([
    "userName",
    "accountId",
    "accountName",
    "phone",
    "email",
    "wxid",
    "address",
  ]);
  const fixtureKeys = collectKeys(fixture);
  assert.deepEqual(fixtureKeys.filter((key) => forbiddenPersonalKeys.has(key)), []);
});

test("decision-time facts stay byte-for-byte aligned with the 2026-08-10 closing archive", () => {
  const stock = stockFrom(decisionArchive, "000636");
  const leader = leaderFrom(decisionArchive, "000636");
  const theme = themeFrom(decisionArchive, "000636");
  const styleCase = styleCaseFrom(decisionArchive, "000636");
  const market = decisionArchive.market;
  const input = fixture.decisionInput;

  assert.ok(stock && leader && theme && styleCase);
  assert.equal(decisionArchive.archiveMeta.snapshotKind, "closing");
  assert.equal(decisionArchive.archiveMeta.tradingDate, fixture.timeline.decisionTradingDate);
  assert.equal(input.market.archiveCycle, market.state.cycle);
  assert.equal(input.market.structuralCycle, market.state.structuralCycle);
  assert.deepEqual(input.market.snapshot, {
    upCount: market.snapshot.upCount,
    downCount: market.snapshot.downCount,
    flatCount: market.snapshot.flatCount,
    breadth: market.snapshot.breadth,
    totalAmountYi: market.snapshot.totalAmountYi,
    avgIndexChangePct: market.snapshot.avgIndexChange,
    limitUpCount: market.limitStats.ztToday,
    limitDownCount: market.limitStats.dtToday,
    profitEffectScore: market.state.profitEffect.score,
    lossEffectScore: market.state.lossEffect.score,
  });
  assert.deepEqual(input.subject.ohlc, {
    previousClose: stock.prevClose,
    open: stock.open,
    high: stock.high,
    low: stock.low,
    close: stock.price,
    changePct: stock.changePct,
  });
  assert.deepEqual(input.subject.liquidity, {
    amountYi: stock.amountYi,
    turnoverRatePct: stock.turnoverRate,
    volumeRatio: stock.volumeRatio,
    mainInflowYi: stock.mainInflowYi,
  });
  assert.equal(input.stylePreference.marketPreference, market.tradingStyle.preference);
  assert.equal(input.stylePreference.subjectEffectType, styleCase.effectType);
  assert.equal(input.stylePreference.subjectRole, styleCase.role);
  assert.equal(input.stylePreference.ticketType, styleCase.ticketType);
  assert.equal(input.stylePreference.initiative.score, leader.initiative.score);
  assert.equal(input.themeOwnership.decisionTimePrimary.name, stock.mainConcept);
  assert.equal(input.themeOwnership.decisionTimePrimary.family, stock.mainFamily);
  assert.deepEqual(input.themeOwnership.decisionTimeRelated.map((item) => item.name), ["超级电容"]);
  assert.equal(input.themeOwnership.themeState.rank, theme.rank);
  assert.equal(input.themeOwnership.themeState.isMainLine, theme.isMainLine);
  assert.equal(input.themeOwnership.themeState.resonance, theme.resonance);
  assert.equal(input.themeOwnership.themeState.sustained, theme.sustained);
  assert.equal(input.subject.role.identity, leader.identity);
  assert.equal(input.subject.location.pctBelow120DayHigh, leader.structure.pctFromHigh);
  assert.equal(input.subject.location.pctAboveRecentWeightedCost, leader.structure.closeToCostPct);
  assert.equal(input.subject.location.pctAboveMa5, leader.structure.distanceMa5Pct);
  assert.equal(input.subject.location.pctAboveMa20, leader.structure.distanceMa20Pct);
  assert.equal(input.subject.boardHistory.boards, stock.speculation.boards);
});

test("outcome facts stay aligned with the 2026-08-11 closing archive", () => {
  const stock = stockFrom(outcomeArchive, "000636");
  const leader = leaderFrom(outcomeArchive, "000636");
  const theme = themeFrom(outcomeArchive, "000636");
  const market = outcomeArchive.market;
  const outcome = fixture.nextSessionOutcome;
  const session = leader.initiative.session;

  assert.ok(stock && leader && theme && session);
  assert.equal(outcomeArchive.archiveMeta.snapshotKind, "closing");
  assert.equal(outcomeArchive.archiveMeta.tradingDate, fixture.timeline.outcomeTradingDate);
  assert.deepEqual(outcome.market, {
    archiveCycle: market.state.cycle,
    dailyState: market.state.dailyState.label,
    upCount: market.snapshot.upCount,
    downCount: market.snapshot.downCount,
    flatCount: market.snapshot.flatCount,
    breadth: market.snapshot.breadth,
    totalAmountYi: market.snapshot.totalAmountYi,
    avgIndexChangePct: market.snapshot.avgIndexChange,
    limitUpCount: market.limitStats.ztToday,
    limitDownCount: market.limitStats.dtToday,
    profitEffectScore: market.state.profitEffect.score,
    lossEffectScore: market.state.lossEffect.score,
    profitPresent: market.state.tradeWindow.current.profitPresent,
    lossControlled: market.state.tradeWindow.current.lossControlled,
  });
  assert.deepEqual(outcome.subject.ohlc, {
    previousClose: stock.prevClose,
    open: stock.open,
    high: stock.high,
    low: stock.low,
    close: stock.price,
    changePct: stock.changePct,
  });
  assert.equal(outcome.subject.liquidity.amountYi, stock.amountYi);
  assert.equal(outcome.subject.liquidity.klineAmountYi, stock.klineProfile.lastSession.amountYi);
  assert.equal(outcome.subject.liquidity.turnoverRatePct, stock.turnoverRate);
  assert.equal(outcome.subject.liquidity.mainInflowYi, stock.mainInflowYi);
  assert.equal(outcome.subject.role.level, leader.level);
  assert.equal(outcome.subject.role.identity, leader.identity);
  assert.equal(outcome.subject.initiative.score, leader.initiative.score);
  assert.equal(outcome.subject.initiative.followerCount, leader.initiative.followerCount);
  assert.equal(outcome.subject.structure.breakdown, leader.structure.breakdown);
  assert.deepEqual(outcome.subject.intraday, {
    openChangePct: session.openChangePct,
    currentChangePct: session.currentChangePct,
    maxChangePct: session.maxChangePct,
    minChangePct: session.minChangePct,
    firstRedTime: session.firstRedTime,
    firstAttackTime: session.firstAttackTime,
    firstStrongTime: session.firstStrongTime,
    limitTouched: session.limitTouched,
    firstLimitTime: session.firstLimitTime,
    limitTouchCount: session.limitTouchCount,
    limitOpenCount: session.limitOpenCount,
    lastResealTime: session.lastResealTime,
    resealedAfterOpen: session.resealedAfterOpen,
    closedAtLimit: session.closedAtLimit,
    finalSealMinutes: session.finalSealMinutes,
    postTouchMaxPullbackPct: session.postTouchMaxPullbackPct,
  });
  assert.equal(outcome.theme.outcomeTimePrimary, theme.name);
  assert.equal(outcome.theme.outcomeTimeFamily, theme.family);
  assert.equal(outcome.theme.resonance, theme.resonance);
  assert.equal(outcome.theme.sustained, theme.sustained);
  assert.equal(outcome.theme.isMainLine, theme.isMainLine);
  assert.equal(outcome.theme.hotMemberCount, theme.count);
  assert.equal(outcome.theme.limitCount, theme.limitCount);
});

test("cycle contract keeps the main-rise claim unconfirmed and permits only a conditional setup", () => {
  assert.equal(fixture.decisionInput.market.archiveCycle, "修复");
  assert.equal(fixture.decisionInput.market.userHypothesis.smallCycle, "主升");
  assert.equal(fixture.decisionInput.market.userHypothesis.confirmedByArchive, null);
  assert.equal(fixture.decisionInput.market.archivedExecutionPermission.status, "blocked");
  assert.equal(fixture.expectedOutput.cyclePermission.status, "conditional");
  assert.equal(fixture.expectedOutput.cyclePermission.allowSetupPlanning, true);
  assert.equal(fixture.expectedOutput.cyclePermission.allowUnconditionalEntry, false);
  assert.equal(fixture.expectedOutput.cyclePermission.allowChase, false);
  assert.equal(fixture.expectedOutput.cyclePermission.mainRiseConfirmed, null);
  assert.equal(fixture.expectedOutput.cyclePermission.maxPositionFraction, null);
});

test("relative-low remains frame-dependent and is never treated as a first-board signal", () => {
  const location = fixture.decisionInput.subject.location;
  assert.equal(location.relativeLowConclusion, "frame_dependent");
  assert.equal(location.relativeLowOnlyVersusPriorPeak, true);
  assert.equal(location.relativeLowVersusShortTermCost, false);
  assert.equal(location.overextended, true);
  assert.equal(fixture.decisionInput.subject.boardHistory.boards, 0);
  assert.equal(fixture.decisionInput.subject.boardHistory.firstBoardClassification, false);
  assert.equal(fixture.expectedOutput.classification.notFirstBoardSetup, true);
  assert.equal(fixture.nextSessionOutcome.subject.intraday.limitTouched, true);
  assert.equal(fixture.nextSessionOutcome.subject.intraday.closedAtLimit, false);
  assert.equal(fixture.nextSessionOutcome.subject.boardHistory.firstBoardClassification, false);
});

test("theme ownership is time-scoped and does not upgrade the unverified MLCC label", () => {
  const ownership = fixture.decisionInput.themeOwnership;
  const contract = fixture.expectedOutput.themeContract;
  assert.deepEqual(ownership.decisionTimePrimary, {
    name: "共封装光学(CPO)",
    family: "AI算力",
    assertionType: "confirmed_fact",
  });
  assert.deepEqual(contract.relatedNames, ["超级电容"]);
  assert.equal(ownership.userReportedRelated[0].name, "MLCC");
  assert.equal(ownership.userReportedRelated[0].confirmedByArchive, null);
  assert.equal(contract.mlccVerified, null);
  assert.equal(contract.mustNotOverwritePrimaryWithOutcomeTheme, true);
  assert.equal(fixture.nextSessionOutcome.theme.outcomeTimePrimary, "PCB概念");
  assert.equal(fixture.nextSessionOutcome.theme.linkedDecisionTheme, "共封装光学(CPO)");
});

test("next-session triggers fire, cancellation rules stay false, and the one-third trim remains a scenario", () => {
  const rules = fixture.expectedOutput.nextSessionRules;
  assert.ok(rules.triggers.length >= 3);
  assert.ok(rules.cancels.length >= 3);

  for (const rule of rules.triggers) {
    assert.equal(ruleMatches(fixture, rule), true, `${rule.id} primary condition should match`);
    if (rule.confirmationField) {
      assert.equal(
        ruleMatches(fixture, {
          field: rule.confirmationField,
          operator: rule.confirmationOperator,
          value: rule.confirmationValue ?? null,
        }),
        true,
        `${rule.id} confirmation should match`,
      );
    }
  }
  for (const rule of rules.cancels) {
    assert.equal(ruleMatches(fixture, rule), false, `${rule.id} should not fire in this outcome`);
    assert.equal(rule.deadline, null, "an unverified deadline must remain null");
  }

  const riskAction = fixture.expectedOutput.riskActionScenario;
  const review = fixture.deidentifiedReviewScenario;
  assert.equal(riskAction.when, "limit_touch_after_reflow");
  assert.equal(riskAction.action, "trim");
  assert.equal(riskAction.fractionOfPreActionPosition, 1 / 3);
  assert.equal(riskAction.assessment, "reasonable_de_risking_not_proven_optimal");
  assert.equal(review.reportedExitFraction, 1 / 3);
  assert.equal(review.reportedExitPrice, null);
  assert.equal(review.reportedExitTime, null);
  assert.equal(review.remainingPositionFraction, null);
});

test("all explicitly unknown trade details remain null instead of being backfilled from the chart", () => {
  assert.ok(Object.keys(fixture.unknowns).length >= 10);
  for (const [key, value] of Object.entries(fixture.unknowns)) {
    assert.equal(value, null, `${key} must remain null`);
  }
  assert.equal(fixture.deidentifiedReviewScenario.entryPrice, null);
  assert.equal(fixture.deidentifiedReviewScenario.entryTime, null);
  assert.equal(fixture.deidentifiedReviewScenario.openingPositionFraction, null);
  assert.equal(fixture.expectedOutput.riskActionScenario.exactFillPrice, null);
  assert.equal(fixture.expectedOutput.riskActionScenario.exactFillTime, null);
});
