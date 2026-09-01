"use strict";

const {
  MEDICAL_FAMILY,
  canonicalThemeFamily,
  isExplicitFamilySubtheme,
  isMedicalThemeName,
  topicThemeNames,
  stockMedicalSubthemes,
} = require("./theme-taxonomy");
const { advanceThemeCycleLeaders } = require("./cycle-leader-state");
const { normalizeBigCycle, normalizeBigCycleKey } = require("./quant-decision/market-cycle-contract");

const THEME_LIBRARY_SCHEMA_VERSION = 1;
const THEME_LIBRARY_CLASSIFIER_VERSION = "theme-library-v8-family-subtheme-decision";
const THEME_POOL_CONTRACT_VERSION = 1;
const SUBTHEME_DECISION_VERSION = 1;
const SUBTHEME_THRESHOLDS = Object.freeze({
  minimumExactSamples: 4,
  minimumUpRate: 0.55,
  minimumMedianChangePct: 0,
  minimumStrongOrLimitCount: 2,
  minimumProactiveCoreCount: 1,
  minimumFollowerCount: 2,
  minimumLeadScoreGap: 10,
  confirmationOccurrences: 2,
  confirmationWindowCloses: 3,
});
const HOT_RANK_TARGET = 100;
const ROLE_ORDER = ["龙头", "先锋", "中军", "补涨"];
const DISPLAY_ROLE_ORDER = ["龙头", "当日高度", "先锋", "中军", "补涨"];
const PRIMARY_ROLE_PRIORITY = new Map([
  ["龙头", 4],
  ["中军", 3],
  ["补涨", 2],
  ["先锋", 1],
]);

function clean(value) {
  return String(value ?? "").trim();
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 1) {
  const number = finite(value);
  if (number === null) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function unique(values) {
  return Array.from(new Set((values || []).map(clean).filter(Boolean)));
}

function normalizeTradingDate(value) {
  const digits = clean(value).replace(/\D/g, "");
  if (digits.length !== 8) return "";
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function themeLibraryGenerationId(tradingDateValue, generatedAtValue) {
  const tradingDate = normalizeTradingDate(tradingDateValue);
  const generatedAt = clean(generatedAtValue);
  const generatedMillis = Date.parse(generatedAt);
  if (!tradingDate || !Number.isFinite(generatedMillis)) return null;
  const generatedTradingDate = new Date(generatedMillis + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (generatedTradingDate !== tradingDate) return null;
  return `${tradingDate}:${generatedAt}`;
}

function themeLibraryTradingDate(payload) {
  const providerDate = normalizeTradingDate(
    payload && payload.market && payload.market.limitStats && payload.market.limitStats.dates
      && payload.market.limitStats.dates.today,
  );
  if (providerDate) return providerDate;
  return normalizeTradingDate(
    payload && payload.archiveMeta && payload.archiveMeta.tradingDate
      || payload && payload.themeLibrary && payload.themeLibrary.tradingDate
      || "",
  );
}

function stockCode(stock) {
  return clean(stock && (stock.code || stock.secCode));
}

function stockInitiative(stock) {
  return stock && stock.leadership && stock.leadership.initiative
    || stock && stock.initiative
    || {};
}

function isLikelyLimitUp(stock) {
  const leadership = stock && stock.leadership || {};
  const structure = leadership.structure || stock && stock.klineProfile || {};
  if (structure.isNewListing === true || structure.newStockReset === true) return false;
  const changePct = finite(stock && stock.changePct);
  if (changePct === null) return false;
  const code = stockCode(stock);
  const name = clean(stock && stock.name);
  const threshold = /(^|[^A-Z])\*?ST/i.test(name)
    ? 5
    : /^(300|301|688|689)/.test(code)
      ? 20
      : /^(4|8|92)/.test(code)
        ? 30
        : 10;
  return changePct >= threshold - 0.18 && changePct <= threshold + 0.8;
}

function firstAttackMinutes(stock) {
  const initiative = stockInitiative(stock);
  const rawMinutes = finite(
    initiative.firstAttackMinute
      ?? (initiative.session && initiative.session.firstAttackMinute),
  );
  if (rawMinutes !== null) return rawMinutes;
  const time = clean(
    initiative.firstAttackTime
      || initiative.session && initiative.session.firstAttackTime,
  );
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.POSITIVE_INFINITY;
}

function isVerifiedPioneer(stock, expectedTradingDate = "") {
  const initiative = stockInitiative(stock);
  const expectedDate = normalizeTradingDate(expectedTradingDate);
  const evidenceDate = normalizeTradingDate(
    initiative.tradingDate
      || initiative.session && (initiative.session.tradingDate || initiative.session.date),
  );
  if (expectedDate && evidenceDate && evidenceDate !== expectedDate) return false;
  const priceDiscovery = initiative.priceDiscovery || {};
  const firstAttackTime = clean(
    initiative.firstAttackTime
      || initiative.session && initiative.session.firstAttackTime,
  );
  return initiative.proactive === true
    && initiative.dataQuality === "分时验证"
    && priceDiscovery.noPriceDiscovery !== true
    && Boolean(firstAttackTime)
    && (Number(initiative.followerCount || 0) > 0 || Number(initiative.breadthLift || 0) > 0);
}

function isVerifiedDailyLeader(stock, expectedTradingDate = "") {
  return isVerifiedPioneer(stock, expectedTradingDate);
}

function themeKeys(theme) {
  return unique([
    theme && theme.name,
    theme && theme.family,
    theme && theme.sectorName,
    theme && theme.sector && theme.sector.name,
    ...(Array.isArray(theme && theme.aliases) ? theme.aliases : []),
    ...(Array.isArray(theme && theme.matchNames) ? theme.matchNames : []),
  ]);
}

function stockMatchesTheme(stock, theme) {
  const keys = new Set(themeKeys(theme));
  if (!keys.size) return false;
  if (keys.has(clean(stock && stock.mainFamily)) || keys.has(clean(stock && stock.mainConcept))) return true;
  return (Array.isArray(stock && stock.concepts) ? stock.concepts : []).some((name) => keys.has(clean(name)));
}

function validHotRank(value, target = HOT_RANK_TARGET) {
  const rank = finite(value);
  return rank !== null && rank >= 1 && rank <= target;
}

function hotRankMembership(stock, target = HOT_RANK_TARGET) {
  const eastmoney = validHotRank(stock && stock.eastRank, target);
  const ths = validHotRank(stock && stock.thsRank, target);
  return {
    eastmoney,
    ths,
    crossListed: eastmoney && ths,
    inTop100: eastmoney || ths,
  };
}

function sourceActualCount(source) {
  if (typeof source === "number") return Math.max(0, Number(source));
  if (!source || typeof source !== "object") return null;
  return finite(source.actualCount ?? source.count ?? source.sampleCount);
}

function buildHotRankCoverage(payload, candidates) {
  const sources = payload && payload.sources || {};
  const hotRanks = sources && sources.hotRanks || {};
  const memberships = candidates.map((stock) => hotRankMembership(stock));
  const observedEast = memberships.filter((item) => item.eastmoney).length;
  const observedThs = memberships.filter((item) => item.ths).length;
  const declaredEast = sourceActualCount(hotRanks.eastmoney) ?? sourceActualCount(sources.eastmoney);
  const declaredThs = sourceActualCount(hotRanks.ths) ?? sourceActualCount(sources.ths);
  const east = Math.max(observedEast, declaredEast ?? 0);
  const ths = Math.max(observedThs, declaredThs ?? 0);
  const reported = declaredEast !== null || declaredThs !== null || observedEast > 0 || observedThs > 0;
  const state = !reported
    ? "unreported"
    : east >= HOT_RANK_TARGET && ths >= HOT_RANK_TARGET
      ? "ready"
      : east > 0 && ths > 0
        ? "partial"
        : east > 0 || ths > 0
          ? "single_source"
          : "pending";
  return {
    targetPerSource: HOT_RANK_TARGET,
    eastmoneyCount: east,
    thsCount: ths,
    unionCount: memberships.filter((item) => item.inTop100).length,
    intersectionCount: memberships.filter((item) => item.crossListed).length,
    state,
    complete: state === "ready",
  };
}

function buildThemeHotVerification(theme, candidates, coverage) {
  const rankedMembers = candidates
    .filter((stock) => stockMatchesTheme(stock, theme))
    .map((stock) => ({ stock, membership: hotRankMembership(stock) }))
    .filter((entry) => entry.membership.inTop100);
  const matched = rankedMembers.length > 0;
  const complete = coverage.complete === true;
  const state = matched
    ? complete ? "main_and_hot" : "main_and_hot_pending"
    : complete ? "theme_only" : "hot_data_pending";
  return {
    state,
    label: state === "main_and_hot"
      ? "题材主池与双榜Top100同时出现，优先验证"
      : state === "main_and_hot_pending"
        ? "题材已上热榜，但双榜Top100还没抓完整"
        : state === "theme_only"
          ? "题材主池保留观察，热榜暂未验证"
          : "热榜数据未完整，暂不确认",
    hotStockCount: rankedMembers.length,
    eastmoneyCount: rankedMembers.filter((entry) => entry.membership.eastmoney).length,
    thsCount: rankedMembers.filter((entry) => entry.membership.ths).length,
    crossListedCount: rankedMembers.filter((entry) => entry.membership.crossListed).length,
    representativeCodes: rankedMembers
      .slice()
      .sort((left, right) => (
        Number(left.stock && left.stock.combinedRank || Number.POSITIVE_INFINITY)
        - Number(right.stock && right.stock.combinedRank || Number.POSITIVE_INFINITY)
      ))
      .slice(0, 12)
      .map((entry) => stockCode(entry.stock))
      .filter(Boolean),
    priority: matched ? "priority_verify" : "observe_only",
    directionConfirmationEligible: state === "main_and_hot",
    directExecutionEligible: false,
  };
}

function discoveryThemeName(stock) {
  return clean(stock && (stock.mainFamily || stock.mainConcept));
}

function buildHotOnlyDiscoveries(mainThemes, candidates, coverage, maxThemes = 12) {
  const grouped = new Map();
  candidates.forEach((stock) => {
    const membership = hotRankMembership(stock);
    if (!membership.inTop100 || mainThemes.some((theme) => stockMatchesTheme(stock, theme))) return;
    const name = discoveryThemeName(stock);
    if (!name || name === "未归类") return;
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name).push({ stock, membership });
  });
  return Array.from(grouped.entries())
    .map(([name, entries]) => ({
      id: name,
      name,
      family: name,
      poolType: "hot_discovery",
      state: coverage.complete ? "hot_only" : "hot_only_pending",
      label: coverage.complete ? "热榜新方向观察" : "热榜数据待补齐",
      directExecutionEligible: false,
      directionConfirmationEligible: false,
      reason: coverage.complete
        ? "只在热榜出现，尚未进入题材主池，不能直接生成交易计划。"
        : "双榜Top100尚未抓完整，不能把零散热股当成新方向。",
      hotVerification: {
        hotStockCount: entries.length,
        eastmoneyCount: entries.filter((entry) => entry.membership.eastmoney).length,
        thsCount: entries.filter((entry) => entry.membership.ths).length,
        crossListedCount: entries.filter((entry) => entry.membership.crossListed).length,
      },
      stocks: entries
        .slice()
        .sort((left, right) => (
          Number(left.stock && left.stock.combinedRank || Number.POSITIVE_INFINITY)
          - Number(right.stock && right.stock.combinedRank || Number.POSITIVE_INFINITY)
        ))
        .slice(0, 8)
        .map(({ stock, membership }) => ({
          code: stockCode(stock),
          name: clean(stock && stock.name) || stockCode(stock),
          mainConcept: clean(stock && stock.mainConcept),
          mainFamily: clean(stock && stock.mainFamily),
          eastRank: validHotRank(stock && stock.eastRank) ? Number(stock.eastRank) : null,
          thsRank: validHotRank(stock && stock.thsRank) ? Number(stock.thsRank) : null,
          crossListed: membership.crossListed,
        })),
    }))
    .sort((left, right) => (
      right.hotVerification.crossListedCount - left.hotVerification.crossListedCount
      || right.hotVerification.hotStockCount - left.hotVerification.hotStockCount
      || left.name.localeCompare(right.name, "zh-CN")
    ))
    .slice(0, maxThemes);
}

function stockSortScore(stock) {
  const initiative = stockInitiative(stock);
  return Number(stock && stock.score || 0) * 100
    + Number(stock && stock.initiativeScore || initiative.score || 0) * 10
    + Number(stock && stock.changePct || 0)
    + Math.min(300, Number(stock && stock.amountYi || 0)) / 100;
}

function clamp(value, min, max) {
  const number = finite(value);
  if (number === null) return min;
  return Math.max(min, Math.min(max, number));
}

function stockBoardHeight(stock) {
  const popularity = clean(stock && stock.popularity);
  const consecutive = popularity.match(/(\d+)\s*连板/);
  if (consecutive) return Math.min(10, Number(consecutive[1]));
  const daysBoards = popularity.match(/(\d+)\s*天\s*(\d+)\s*板/);
  if (daysBoards) return Math.min(10, Number(daysBoards[2]));
  if (/首板/.test(popularity)) return 1;
  return isLikelyLimitUp(stock) ? 1 : 0;
}

function stockHistoryAppearances(stock) {
  const history = stock && stock.leadership && stock.leadership.history || {};
  if (Number.isFinite(Number(history.appearances))) return Number(history.appearances);
  return Array.isArray(history.records) ? history.records.length : 0;
}

function stockHistoryMetric(stock, key) {
  const history = stock && stock.leadership && stock.leadership.history || {};
  const value = finite(history[key]);
  return value === null ? 0 : Math.max(0, value);
}

function stockStructureIntact(stock) {
  const leadership = stock && stock.leadership || {};
  const structure = leadership.structure || stock && stock.klineProfile || {};
  return structure.breakdown !== true && structure.frameworkIntact !== false;
}

function explicitCycleIdentity(stock) {
  const identity = stock && stock.leadership && stock.leadership.cycleIdentity;
  if (!identity || typeof identity !== "object") return null;
  const state = clean(identity.state).toLowerCase();
  const established = identity.identityEstablished === true
    && ["confirmed", "retained", "challenged"].includes(state);
  const activePrimary = established
    && identity.activePrimary === true
    && ["confirmed", "retained"].includes(state);
  return {
    cycleInstanceId: clean(identity.cycleInstanceId) || null,
    state: state || "candidate",
    identityEstablished: established,
    activePrimary,
    method: "explicit_cycle_state",
    calibrated: identity.calibrated === true,
    evidenceDates: unique(identity.confirmedTradingDates || identity.evidenceDates || []),
  };
}

// 周期龙头身份与当日涨停严格分开：涨停只描述今天的强度，不能建立跨日身份。
// 旧缓存还没有 cycleIdentity 时，仅允许“持续出现 + 核心命中 + 已验证跨票影响”
// 的保守兼容证据建立临时周期身份；没有影响证据宁可留空。
function cycleIdentityOf(stock) {
  const explicit = explicitCycleIdentity(stock);
  if (explicit) return explicit;
  const leadership = stock && stock.leadership || {};
  const initiative = stockInitiative(stock);
  const appearances = stockHistoryAppearances(stock);
  const coreHits = stockHistoryMetric(stock, "coreHits");
  const activeHits = stockHistoryMetric(stock, "activeHits");
  const impactScore = Math.max(0, Number(leadership.impactScore || 0));
  const crossStockImpact = impactScore >= 30
    || activeHits >= 2
    || Number(initiative.followerCount || 0) >= 2
    || Number(initiative.breadthLift || 0) > 0;
  const established = leadership.persistentRecognition === true
    && appearances >= 2
    && coreHits >= 1
    && crossStockImpact
    && stockStructureIntact(stock);
  const history = leadership.history || {};
  return {
    cycleInstanceId: clean(history.cycleInstanceId) || null,
    state: established ? "retained" : "candidate",
    identityEstablished: established,
    activePrimary: established,
    method: "legacy_rolling_verified_impact",
    calibrated: false,
    evidenceDates: unique((Array.isArray(history.records) ? history.records : [])
      .filter((record) => record && record.impactVerified === true)
      .map((record) => record.tradingDate)),
    appearances,
    coreHits,
    activeHits,
    impactScore: round(impactScore, 1),
  };
}

function cycleLeaderScore(stock) {
  const identity = cycleIdentityOf(stock);
  if (!identity.identityEstablished) return Number.NEGATIVE_INFINITY;
  const rank = finite(stock && stock.combinedRank);
  const rankSupport = rank === null ? 0 : Math.max(0, 40 - rank);
  return (identity.method === "explicit_cycle_state" ? 10000 : 0)
    + Number(identity.coreHits || stockHistoryMetric(stock, "coreHits")) * 120
    + Number(identity.impactScore || stock && stock.leadership && stock.leadership.impactScore || 0) * 4
    + Number(identity.activeHits || stockHistoryMetric(stock, "activeHits")) * 30
    + Number(identity.appearances || stockHistoryAppearances(stock)) * 20
    + rankSupport
    + (stock && stock.inBothSources === true ? 20 : 0)
    + (identity.activePrimary === true ? 50000 : 0)
    + (identity.state === "challenged" ? 25000 : 0);
}

function cycleLeaderThemeEligible(stock, theme) {
  if (theme && theme.medicalParent === true) return stockMedicalSubthemes(stock).length > 0;
  const exactThemeName = clean(theme && theme.name);
  if (!exactThemeName) return false;
  const attribution = stock && (stock.themeAttribution || stock.themeOwnership) || {};
  if (attribution.conflict !== true && attribution.verified === true) {
    const attributedNames = new Set(unique([
      attribution.primaryThemeName,
      attribution.fineThemeName,
      attribution.primary && attribution.primary.name,
    ]));
    if (attributedNames.has(exactThemeName)) return true;
  }
  // 观察性题材成员证据与交易权限必须分开。供应商当前会话的原始
  // concepts 精确命中题材名，可以让周期状态机观察该股票；但它不会
  // 写入 selectionEligible，也绝不会因此取得交易权限。mainConcept、
  // mainFamily 或 alias 仅为聚类关联，不足以建立周期身份。
  const rawConcepts = new Set(unique(stock && stock.concepts || []));
  return rawConcepts.has(exactThemeName);
}

function cycleLeaderThemeEvidenceSource(stock, theme) {
  if (theme && theme.medicalParent === true && stockMedicalSubthemes(stock).length > 0) {
    return "theme-taxonomy.medicalSubthemes";
  }
  const exactThemeName = clean(theme && theme.name);
  if (!exactThemeName) return "unverified_theme_association";
  const attribution = stock && (stock.themeAttribution || stock.themeOwnership) || {};
  if (attribution.conflict !== true && attribution.verified === true) {
    const attributedNames = new Set(unique([
      attribution.primaryThemeName,
      attribution.fineThemeName,
      attribution.primary && attribution.primary.name,
    ]));
    if (attributedNames.has(exactThemeName)) {
      return "candidate.themeAttribution";
    }
  }
  const rawConcepts = new Set(unique(stock && stock.concepts || []));
  return rawConcepts.has(exactThemeName)
    ? "candidate.concepts.exact"
    : "unverified_theme_association";
}

function verifiedCycleLeaderAttribution(stock, theme) {
  const exactThemeName = clean(theme && theme.name);
  const attribution = stock && (stock.themeAttribution || stock.themeOwnership) || {};
  if (
    !exactThemeName
    || attribution.verified !== true
    || attribution.selectionEligible !== true
    || attribution.conflict === true
  ) return false;
  return unique([
    attribution.primaryThemeName,
    attribution.fineThemeName,
    attribution.primary && attribution.primary.name,
  ]).includes(exactThemeName);
}

function cycleLeaderMembershipAuthority(stock, theme, identity, tradingDate) {
  const evidenceTradingDate = normalizeTradingDate(tradingDate);
  const identityEligible = Boolean(
    identity
    && identity.identityEstablished === true
    && identity.activePrimary === true
    && ["confirmed", "retained"].includes(clean(identity.state).toLowerCase()),
  );
  const attributionEligible = verifiedCycleLeaderAttribution(stock, theme);
  const executionEligible = identityEligible && attributionEligible;
  const membershipSource = cycleLeaderThemeEvidenceSource(stock, theme);
  return {
    version: 1,
    cycleLeader: executionEligible,
    observationEligible: cycleLeaderThemeEligible(stock, theme),
    executionEligible,
    source: attributionEligible ? "candidate.themeAttribution" : membershipSource,
    tradingDate: evidenceTradingDate,
    evidence: [
      roleEvidenceRow("cycle_identity_authority_eligible", identityEligible, "theme.cycleLeadership.identities", evidenceTradingDate),
      roleEvidenceRow("verified_exact_theme_attribution", attributionEligible, "candidate.themeAttribution", evidenceTradingDate),
    ],
    gaps: executionEligible
      ? []
      : attributionEligible
        ? ["周期身份尚未达到已确认且仍为当前主龙头"]
        : ["仅有观察性题材成员证据；缺少可选股的已核实精确题材归属"],
  };
}

function themeCycleKey(theme) {
  if (theme && theme.medicalParent === true) return MEDICAL_FAMILY;
  return clean(theme && (theme.id || theme.family || theme.name));
}

function themeCycleInstanceId(themeKey, episodeStartedOn) {
  const key = clean(themeKey);
  const startedOn = normalizeTradingDate(episodeStartedOn);
  return key && startedOn
    ? `theme-cycle-v1:${encodeURIComponent(key)}:${startedOn}`
    : null;
}

function themeLeaderObservation(stock, theme) {
  const leadership = stock && stock.leadership || {};
  const initiative = stockInitiative(stock);
  const history = leadership.history || {};
  const appearances = stockHistoryAppearances(stock);
  const coreHits = stockHistoryMetric(stock, "coreHits");
  const activeHits = stockHistoryMetric(stock, "activeHits");
  const impactScore = Math.max(0, Number(leadership.impactScore || 0));
  const followerCount = Math.max(0, Number(initiative.followerCount || 0));
  const breadthLift = Math.max(0, Number(initiative.breadthLift || 0));
  const combinedRank = finite(stock && stock.combinedRank);
  const priceDiscovery = initiative.priceDiscovery || {};
  const structureIntact = stockStructureIntact(stock);
  const participatory = priceDiscovery.noPriceDiscovery !== true
    && priceDiscovery.suspectedOneWord !== true;
  // activeHits is a rolling history counter, not proof that this session led
  // other stocks. Current impact must come from this session's influence data.
  // 25 points may come from the capacity-core base score alone. It is not proof
  // that the stock moved other stocks, so only the established current-influence
  // threshold (30) or direct follower/breadth evidence can advance leader identity.
  const explicitImpact = impactScore >= 30 || followerCount >= 2 || breadthLift > 0;
  const sustainedMarketFocus = leadership.persistentRecognition === true
    && appearances >= 2
    && stock && stock.inBothSources === true
    && combinedRank !== null
    && combinedRank <= 10
    && isLikelyLimitUp(stock);
  const identitySupport = structureIntact
    && participatory
    && leadership.persistentRecognition === true
    && appearances >= 2
    && coreHits >= 1
    && (stock && stock.inBothSources === true || combinedRank !== null && combinedRank <= 20);
  const leadershipStrength = Math.max(0,
    (combinedRank === null ? 0 : Math.max(0, 101 - combinedRank))
    + (stock && stock.inBothSources === true ? 10 : 0)
    + (leadership.persistentRecognition === true ? 15 : 0)
    + Math.min(5, appearances) * 3
    + Math.min(5, coreHits) * 4
    + (explicitImpact ? 10 : 0)
    + (isLikelyLimitUp(stock) ? 15 : 0));
  const themeEligible = cycleLeaderThemeEligible(stock, theme);
  const membershipSource = cycleLeaderThemeEvidenceSource(stock, theme);
  const dataComplete = Boolean(
    stockCode(stock)
    && themeEligible
    && leadership.structure
    && typeof leadership.structure === "object"
    && typeof leadership.structure.frameworkIntact === "boolean"
    && typeof leadership.persistentRecognition === "boolean"
    && history
    && typeof history === "object"
    && Number.isFinite(Number(history.appearances))
    && Number.isFinite(Number(history.coreHits)),
  );
  return {
    code: stockCode(stock),
    dataComplete,
    validCrossStockImpact: dataComplete
      && structureIntact
      && participatory
      && leadership.persistentRecognition === true
      && (explicitImpact || sustainedMarketFocus),
    identitySupport: dataComplete && identitySupport,
    leadershipStrength,
    limitUp: isLikelyLimitUp(stock),
    hardBreak: leadership.structure && leadership.structure.breakdown === true,
    negativeFeedback: leadership.structure && leadership.structure.breakdown === true
      && finite(stock && stock.changePct) !== null
      && Number(stock.changePct) < 0,
    source: "theme-library.themeLeaderObservation",
    dataQuality: clean(initiative.dataQuality) || "unavailable",
    evidence: {
      membershipSource,
      explicitImpact,
      sustainedMarketFocus,
      impactScore,
      activeHits,
      followerCount,
      breadthLift,
      appearances,
      coreHits,
      combinedRank,
      identitySupport,
    },
  };
}

function previousThemeFor(previousThemeLibrary, theme) {
  const themes = Array.isArray(previousThemeLibrary && previousThemeLibrary.themes)
    ? previousThemeLibrary.themes
    : [];
  const key = themeCycleKey(theme);
  return themes.find((row) => themeCycleKey(row) === key) || null;
}

function cycleStateSummary(state, metadata = {}) {
  const identities = state && state.identities && typeof state.identities === "object"
    ? state.identities
    : {};
  const activeCode = clean(state && state.activeLeaderCode);
  const ordered = Object.values(identities).filter((row) => row && clean(row.code));
  const score = (row) => (
    (row.activePrimary === true ? 100000 : 0)
    + (row.identityEstablished === true ? 10000 : 0)
    + Number(row.averageImpactStrength || 0) * 10
    + Number(row.validImpactDays || 0) * 100
    - Number(row.consecutiveNoImpactDays || 0) * 10
  );
  ordered.sort((left, right) => score(right) - score(left) || clean(left.code).localeCompare(clean(right.code)));
  const primary = (activeCode && identities[activeCode]) || ordered[0] || null;
  const challenger = ordered
    .filter((row) => !primary || clean(row.code) !== clean(primary.code))
    .sort((left, right) => score(right) - score(left) || clean(left.code).localeCompare(clean(right.code)))[0] || null;
  return {
    version: Number(state && state.version || 1),
    themeKey: clean(metadata.themeKey) || null,
    cycleInstanceId: clean(state && state.cycleInstanceId) || null,
    episodeStartedOn: normalizeTradingDate(metadata.episodeStartedOn) || null,
    state: clean(primary && primary.state) || "candidate",
    primary: primary ? { ...primary } : null,
    challenger: challenger ? { ...challenger } : null,
    identities,
    activeLeaderCode: activeCode || null,
    replacement: state && state.replacement || null,
    settledTradingDate: normalizeTradingDate(metadata.settledTradingDate) || null,
    expectedPreviousTradingDate: normalizeTradingDate(metadata.expectedPreviousTradingDate) || null,
    sourcePreviousTradingDate: normalizeTradingDate(metadata.sourcePreviousTradingDate) || null,
    frozen: state && state.frozen === true,
    freezeReason: clean(metadata.freezeReason) || null,
    calibrated: false,
  };
}

function freezeCycleLeadership(previousLeadership, metadata) {
  const previous = previousLeadership && typeof previousLeadership === "object"
    ? previousLeadership
    : null;
  const state = previous ? {
    version: Number(previous.version || 1),
    cycleInstanceId: clean(previous.cycleInstanceId) || null,
    activeLeaderCode: clean(previous.activeLeaderCode || previous.primary && previous.primary.activePrimary !== false && previous.primary.code) || null,
    identities: previous.identities && typeof previous.identities === "object"
      ? previous.identities
      : Object.fromEntries([previous.primary, previous.challenger]
        .filter((row) => row && clean(row.code))
        .map((row) => [clean(row.code), row])),
    replacement: previous.replacement || null,
    lastEvaluatedTradingDate: normalizeTradingDate(previous.settledTradingDate) || null,
    frozen: true,
  } : {
    version: 1,
    cycleInstanceId: null,
    activeLeaderCode: null,
    identities: {},
    replacement: null,
    lastEvaluatedTradingDate: null,
    frozen: true,
  };
  return cycleStateSummary(state, {
    ...metadata,
    episodeStartedOn: previous && previous.episodeStartedOn,
    settledTradingDate: previous && previous.settledTradingDate,
  });
}

function resolveThemeCycleLeadership(theme, candidates, context = {}) {
  const tradingDate = normalizeTradingDate(context.tradingDate);
  const expectedPreviousTradingDate = normalizeTradingDate(context.expectedPreviousTradingDate);
  const previousThemeLibrary = context.previousThemeLibrary && typeof context.previousThemeLibrary === "object"
    ? context.previousThemeLibrary
    : null;
  const previousTheme = previousThemeFor(previousThemeLibrary, theme);
  const previousLeadership = previousTheme && previousTheme.cycleLeadership || null;
  const sourcePreviousTradingDate = normalizeTradingDate(previousThemeLibrary && previousThemeLibrary.tradingDate);
  const themeKey = themeCycleKey(theme);
  const snapshotKind = clean(context.snapshotKind).toLowerCase();
  const previousSnapshotKind = clean(previousThemeLibrary && previousThemeLibrary.snapshotKind).toLowerCase();

  if (snapshotKind !== "closing") {
    return freezeCycleLeadership(previousLeadership, {
      themeKey,
      expectedPreviousTradingDate,
      sourcePreviousTradingDate,
      freezeReason: "current_snapshot_not_closing",
    });
  }
  if (context.providerDatesVerified !== true) {
    return freezeCycleLeadership(previousLeadership, {
      themeKey,
      expectedPreviousTradingDate,
      sourcePreviousTradingDate,
      freezeReason: "provider_trading_dates_unverified",
    });
  }
  if (context.exactPreviousMissing === true) {
    return freezeCycleLeadership(previousLeadership, {
      themeKey,
      expectedPreviousTradingDate,
      sourcePreviousTradingDate,
      freezeReason: "exact_previous_closing_missing",
    });
  }

  const sameDayReplay = previousLeadership
    && sourcePreviousTradingDate === tradingDate
    && normalizeTradingDate(previousLeadership.settledTradingDate) === tradingDate;
  if (sameDayReplay) {
    return cycleStateSummary({
      version: previousLeadership.version,
      cycleInstanceId: previousLeadership.cycleInstanceId,
      activeLeaderCode: previousLeadership.activeLeaderCode,
      identities: previousLeadership.identities,
      replacement: previousLeadership.replacement,
      frozen: false,
    }, {
      themeKey,
      episodeStartedOn: previousLeadership.episodeStartedOn,
      settledTradingDate: previousLeadership.settledTradingDate,
      expectedPreviousTradingDate,
      sourcePreviousTradingDate: previousLeadership.sourcePreviousTradingDate,
    });
  }

  const previousSupplied = Boolean(previousThemeLibrary);
  const exactPreviousSnapshot = previousSupplied
    && sourcePreviousTradingDate === expectedPreviousTradingDate
    && previousSnapshotKind === "closing";
  if (previousSupplied && !exactPreviousSnapshot) {
    return freezeCycleLeadership(previousLeadership, {
      themeKey,
      expectedPreviousTradingDate,
      sourcePreviousTradingDate,
      freezeReason: "exact_previous_closing_missing",
    });
  }
  // 精确的上一交易日快照存在、但该题材当日尚未出现时，说明这是新题材
  // 的首个观察日，不是数据缺失。此时从 candidate 开始累计，不能冻结。
  const exactPrevious = exactPreviousSnapshot && previousTheme && previousLeadership;

  const previousState = exactPrevious ? {
    version: previousLeadership.version,
    cycleInstanceId: previousLeadership.cycleInstanceId,
    activeLeaderCode: previousLeadership.activeLeaderCode,
    identities: previousLeadership.identities,
    replacement: previousLeadership.replacement,
    lastEvaluatedTradingDate: previousLeadership.settledTradingDate,
    frozen: false,
  } : null;
  const previousExpired = previousLeadership && previousLeadership.state === "expired";
  const episodeStartedOn = previousState && !previousExpired
    ? normalizeTradingDate(previousLeadership.episodeStartedOn) || tradingDate
    : tradingDate;
  const cycleInstanceId = previousState && !previousExpired
    ? clean(previousState.cycleInstanceId) || themeCycleInstanceId(themeKey, episodeStartedOn)
    : themeCycleInstanceId(themeKey, episodeStartedOn);
  const members = candidates.filter((stock) => stockMatchesTheme(stock, theme));
  const observations = members
    .map((stock) => themeLeaderObservation(stock, theme))
    .filter((row) => row.code);
  const dataComplete = Boolean(tradingDate && cycleInstanceId && observations.length > 0);
  const nextState = advanceThemeCycleLeaders(previousState, {
    cycleInstanceId,
    tradingDate,
    dataComplete,
    observations,
  });
  return cycleStateSummary(nextState, {
    themeKey,
    episodeStartedOn,
    settledTradingDate: dataComplete ? tradingDate : previousLeadership && previousLeadership.settledTradingDate,
    expectedPreviousTradingDate,
    sourcePreviousTradingDate: exactPrevious ? sourcePreviousTradingDate : null,
    freezeReason: dataComplete ? null : "theme_evidence_incomplete",
  });
}

function projectCycleIdentityForTheme(candidates, cycleLeadership, theme, tradingDate) {
  const identities = cycleLeadership && cycleLeadership.identities || {};
  return candidates.map((stock) => {
    const code = stockCode(stock);
    const identity = identities[code];
    if (!identity) return stock;
    const existing = stock && stock.leadership && stock.leadership.cycleIdentity;
    const preserveEstablished = existing
      && existing.identityEstablished === true
      && ["confirmed", "retained", "challenged"].includes(clean(existing.state).toLowerCase())
      && identity.identityEstablished !== true;
    const projectedIdentity = preserveEstablished ? existing : {
      cycleInstanceId: cycleLeadership.cycleInstanceId,
      state: identity.state,
      identityEstablished: identity.identityEstablished === true,
      activePrimary: identity.activePrimary === true,
      confirmedTradingDates: unique(identity.confirmedTradingDates || []),
      evidenceDates: unique(identity.impactTradingDates || []),
      settledTradingDate: cycleLeadership.settledTradingDate,
      frozen: cycleLeadership.frozen === true,
      calibrated: false,
    };
    const membershipAuthority = cycleLeaderMembershipAuthority(
      stock,
      theme,
      projectedIdentity,
      tradingDate,
    );
    return {
      ...stock,
      leadership: {
        ...(stock.leadership || {}),
        cycleIdentity: {
          ...projectedIdentity,
          executionEligible: membershipAuthority.executionEligible,
          membershipAuthority,
        },
      },
    };
  });
}

function cycleLeaderPlan(members, theme, cycleLeadership = null) {
  const eligible = members
    .filter((stock) => cycleLeaderThemeEligible(stock, theme))
    .filter((stock) => cycleIdentityOf(stock).identityEstablished === true)
    .sort((left, right) => cycleLeaderScore(right) - cycleLeaderScore(left) || stockCode(left).localeCompare(stockCode(right)));
  const activeCode = clean(cycleLeadership && cycleLeadership.activeLeaderCode);
  const primaryCode = clean(cycleLeadership && cycleLeadership.primary && cycleLeadership.primary.code);
  const primaryState = clean(cycleLeadership && cycleLeadership.primary && cycleLeadership.primary.state).toLowerCase();
  const selectedCode = activeCode || (primaryState === "challenged" ? primaryCode : "");
  const leader = (selectedCode && eligible.find((stock) => stockCode(stock) === selectedCode))
    || ((!cycleLeadership || clean(cycleLeadership.state).toLowerCase() === "candidate")
      ? eligible.find((stock) => cycleIdentityOf(stock).activePrimary === true) || null
      : null)
    || null;
  const identity = leader ? cycleIdentityOf(leader) : null;
  const challenged = identity && identity.state === "challenged";
  return leader ? [{
    stock: leader,
    style: challenged ? "周期龙头·受损/挑战中" : "周期龙头",
    roleKind: "cycleLeader",
    roleScope: "cycle",
    reason: challenged
      ? "跨日周期身份仍保留，但当前结构受损或负反馈明显；只作周期风险锚，不具备执行资格"
      : "本轮周期内持续受到资金关注，并已有跨股票影响证据；单日不涨停不会立刻失去身份",
  }] : [];
}

function todayStateOf(stock) {
  const leadership = stock && stock.leadership || {};
  const initiative = stockInitiative(stock);
  const structure = leadership.structure || stock && stock.klineProfile || {};
  const changePct = finite(stock && stock.changePct);
  const relativeStrength = finite(initiative.relativeStrength);
  if (isLikelyLimitUp(stock)) return "今日涨停";
  if (structure.breakdown === true || structure.frameworkIntact === false) return "今日结构受损";
  if (initiative.proactive === true) return "今日主动走强";
  if (changePct !== null && changePct <= -5) return "今日明显走弱";
  if (leadership.persistentRecognition === true && relativeStrength !== null && relativeStrength <= -2) return "今日被动分歧";
  if (changePct !== null && changePct >= 3) return "今日走强";
  if (changePct !== null && changePct >= 0) return "今日震荡";
  if (changePct !== null) return "今日偏弱";
  return "今日表现待确认";
}

function dailyHeightPlan(members, excludedCodes = new Set()) {
  return members
    .filter((stock) => !excludedCodes.has(stockCode(stock)) && isLikelyLimitUp(stock))
    .sort((left, right) => (
      stockBoardHeight(right) - stockBoardHeight(left)
      || stockSortScore(right) - stockSortScore(left)
      || stockCode(left).localeCompare(stockCode(right))
    ))
    .slice(0, 3)
    .map((stock) => ({
      stock,
      style: stockBoardHeight(stock) >= 3 ? "连板高标" : "当日强势",
      roleKind: "dailyHeight",
      roleScope: "session",
      reason: `收盘涨幅达到该板块涨停阈值，近期高度记录${stockBoardHeight(stock)}板；只代表当日高度，不等于周期龙头`,
    }));
}

// 医药母题材的“总龙头”强调多日趋势和持续辨识度；连板高度仍保留，
// 但不再让一个子题材的普通首板仅凭当日选股分就自动获得龙头身份。
function medicalTrendLeaderScore(stock) {
  if (!isLikelyLimitUp(stock)) return Number.NEGATIVE_INFINITY;
  const profile = stock && stock.klineProfile || {};
  const leadership = stock && stock.leadership || {};
  const wave = clean(profile.wave);
  const ma5 = finite(profile.ma5);
  const ma10 = finite(profile.ma10);
  const ma20 = finite(profile.ma20);
  const bullishMa = ma5 !== null && ma10 !== null && ma20 !== null && ma5 > ma10 && ma10 > ma20;
  const rank = finite(stock && stock.combinedRank);
  const rankScore = rank === null ? 0 : rank <= 10 ? 12 : rank <= 30 ? 8 : rank <= 60 ? 4 : 0;
  const waveScore = /三波|高位趋势/.test(wave) ? 24 : /二波/.test(wave) ? 16 : /趋势一波/.test(wave) ? 8 : 0;
  const persistenceScore = leadership.persistentRecognition === true ? 24 : 0;
  const historyScore = Math.min(15, Math.max(0, stockHistoryAppearances(stock)) * 5);
  const nearHighScore = profile.nearHigh20 === true || profile.newHigh === true ? 6 : 0;
  return 30
    + clamp(profile.rise20, 0, 120) * 0.65
    + clamp(profile.rise30, 0, 160) * 0.25
    + waveScore
    + persistenceScore
    + historyScore
    + nearHighScore
    + (bullishMa ? 8 : 0)
    + stockBoardHeight(stock) * 4
    + rankScore
    + (stock && stock.inBothSources === true ? 8 : 0);
}

function stockMarketValue(stock) {
  return Number(stock && (stock.floatMarketValue || stock.totalMarketValue) || 0);
}

function isEstablishedMedicalLeader(stock) {
  const profile = stock && stock.klineProfile || {};
  const leadership = stock && stock.leadership || {};
  const ma5 = finite(profile.ma5);
  const ma10 = finite(profile.ma10);
  const ma20 = finite(profile.ma20);
  const historyAppearances = stockHistoryAppearances(stock);
  const nearHigh = profile.nearHigh20 === true
    || profile.newHigh === true
    || (finite(profile.pctFromHigh) !== null && Number(profile.pctFromHigh) <= 8);
  return isLikelyLimitUp(stock)
    && (leadership.persistentRecognition === true || historyAppearances >= 2)
    && finite(profile.rise20) !== null
    && Number(profile.rise20) >= 25
    && ma5 !== null && ma10 !== null && ma20 !== null
    && ma5 > ma10 && ma10 > ma20
    && nearHigh;
}

function medicalRolePlan(members, theme, cycleLeadership = null) {
  const leaders = cycleLeaderPlan(members, theme, cycleLeadership).map((entry) => ({
    ...entry,
    style: entry.style === "周期龙头·受损/挑战中" ? entry.style : "趋势总龙",
  }));
  const leaderCodes = new Set(leaders.map((entry) => stockCode(entry.stock)));
  const dailyHeights = dailyHeightPlan(members, leaderCodes);
  const capacity = members
    .filter((stock) => !leaderCodes.has(stockCode(stock)))
    .filter((stock) => stockMarketValue(stock) > 500e8 && Number(stock && stock.changePct) >= 0)
    .sort((left, right) => (
      Number(right && right.amountYi || 0) - Number(left && left.amountYi || 0)
      || stockMarketValue(right) - stockMarketValue(left)
    ))[0] || null;
  const catchups = members
    .filter((stock) => !leaderCodes.has(stockCode(stock)))
    .filter((stock) => clean(stock && stock.role) === "补涨" && isLikelyLimitUp(stock))
    .sort((left, right) => stockSortScore(right) - stockSortScore(left));
  return { leaders, dailyHeights, capacity, catchups };
}

function isMedicalTopic(theme) {
  return topicThemeNames(theme).some(isMedicalThemeName);
}

function consolidateMedicalTopics(boardItems, candidates) {
  const sourceRows = boardItems
    .map((theme, index) => ({ theme, index }))
    .filter((entry) => isMedicalTopic(entry.theme));
  if (!sourceRows.length) return boardItems.slice();

  const sourceThemes = sourceRows.map((entry) => entry.theme);
  const primary = sourceThemes[0];
  const medicalCandidates = candidates.filter((stock) => stockMedicalSubthemes(stock).length > 0);
  const observedSubthemes = unique([
    ...sourceThemes.flatMap(topicThemeNames),
    ...medicalCandidates.flatMap(stockMedicalSubthemes),
  ]).filter((name) => name !== MEDICAL_FAMILY && isMedicalThemeName(name));
  const sectorChanges = sourceThemes
    .map((theme) => finite(theme && (theme.sectorChangePct ?? (theme.sector && theme.sector.changePct))))
    .filter((value) => value !== null);
  const score = sourceThemes.reduce((sum, theme) => sum + Number(theme && theme.score || 0), 0);
  const heatScore = sourceThemes.reduce((sum, theme) => sum + Number(theme && theme.heatScore || 0), 0);
  const medicalCodes = new Set(medicalCandidates.map(stockCode).filter(Boolean));
  const reasons = unique([
    "流感、肝炎、创新药与 CRO 等分支统一按医药母题材观察",
    ...sourceThemes.flatMap((theme) => Array.isArray(theme && theme.reasons) ? theme.reasons : []),
  ]);
  const merged = {
    ...primary,
    id: MEDICAL_FAMILY,
    name: MEDICAL_FAMILY,
    family: MEDICAL_FAMILY,
    displayName: MEDICAL_FAMILY,
    aliases: observedSubthemes,
    matchNames: unique([MEDICAL_FAMILY, ...observedSubthemes]),
    subthemes: observedSubthemes,
    medicalParent: true,
    sourceThemeNames: unique(sourceThemes.map((theme) => clean(theme && theme.name))),
    count: medicalCodes.size || sourceThemes.reduce((sum, theme) => sum + Number(theme && theme.count || 0), 0),
    limitCount: medicalCandidates.filter(isLikelyLimitUp).length
      || sourceThemes.reduce((sum, theme) => sum + Number(theme && theme.limitCount || 0), 0),
    score: score || Number(primary && primary.score || 0),
    heatScore: heatScore || Number(primary && primary.heatScore || 0),
    sustained: sourceThemes.some((theme) => theme && theme.sustained === true),
    resonance: sourceThemes.some((theme) => theme && theme.resonance === true),
    resonanceLabel: sourceThemes.find((theme) => clean(theme && theme.resonanceLabel))?.resonanceLabel || "",
    sectorName: "医药分支综合",
    sectorChangePct: sectorChanges.length
      ? sectorChanges.reduce((sum, value) => sum + value, 0) / sectorChanges.length
      : null,
    sector: {
      ...(primary && primary.sector || {}),
      name: "医药分支综合",
      changePct: sectorChanges.length
        ? sectorChanges.reduce((sum, value) => sum + value, 0) / sectorChanges.length
        : null,
    },
    summary: `医药母题材，涵盖${observedSubthemes.slice(0, 6).join("、") || "当日活跃分支"}；角色按母题材统一重排。`,
    reasons,
    leader: null,
    leaders: [],
    zhongjun: null,
    lowLevel: null,
  };
  const firstMedicalIndex = sourceRows[0].index;
  const mergedRows = boardItems
    .filter((theme) => !isMedicalTopic(theme));
  mergedRows.splice(Math.min(firstMedicalIndex, mergedRows.length), 0, merged);
  return mergedRows
    .map((theme, index) => ({ theme, index }))
    .sort((left, right) => Number(right.theme && right.theme.score || 0) - Number(left.theme && left.theme.score || 0) || left.index - right.index)
    .map((entry) => entry.theme);
}

function mergeStock(seed, candidateByCode) {
  const code = stockCode(seed);
  const candidate = code ? candidateByCode.get(code) : null;
  if (!candidate) return seed || null;
  return { ...(seed || {}), ...candidate };
}

function roleReason(role, stock) {
  const initiative = stockInitiative(stock);
  if (role === "龙头") {
    return clean(stock && stock.roleReason)
      || clean(stock && stock.leadership && (stock.leadership.levelLabel || stock.leadership.identity))
      || "题材内辨识度、强度与核心地位领先";
  }
  if (role === "先锋") {
    const time = clean(initiative.firstAttackTime || initiative.session && initiative.session.firstAttackTime);
    const followers = Number(initiative.followerCount || 0);
    const breadth = Number(initiative.breadthLift || 0);
    return `${time || "盘中"}率先发动${followers > 0 ? `，带动${followers}只同方向股票` : breadth > 0 ? `，方向强势家数增加${breadth}只` : ""}`;
  }
  if (role === "中军") {
    const amount = finite(stock && stock.amountYi);
    return amount !== null ? `成交${round(amount, 1)}亿，承担题材容量承接` : "题材内容量与趋势承接代表";
  }
  return clean(stock && stock.roleReason) || clean(stock && stock.setup) || "题材内低位或弹性补涨代表";
}

function compactStock(stock, tags, theme) {
  const initiative = stockInitiative(stock);
  const leadership = stock && stock.leadership || {};
  const tagLabels = new Set(tags.map((tag) => tag.label));
  const primaryRole = DISPLAY_ROLE_ORDER
    .filter((role) => tagLabels.has(role))
    .sort((left, right) => (PRIMARY_ROLE_PRIORITY.get(right) || 0) - (PRIMARY_ROLE_PRIORITY.get(left) || 0))[0]
    || "先锋";
  const changePct = finite(stock && stock.changePct);
  const detailTags = unique([
    isLikelyLimitUp(stock) ? "涨停" : "",
    initiative.proactive === true ? "主动进攻" : "",
    stock && stock.inBothSources === true ? "双榜" : "",
    leadership.tradeState,
  ]).slice(0, 3);
  const roleStyles = unique(tags.map((tag) => tag.style));
  const roleKinds = unique(tags.flatMap((tag) => {
    const kind = tag.roleKind || ({
      龙头: "cycleLeader",
      当日高度: "dailyHeight",
      先锋: "dailyLeader",
      中军: "capacityCore",
      补涨: "catchup",
    })[tag.label];
    return kind === "dailyLeader" || kind === "dailyPioneer"
      ? ["dailyLeader", "dailyPioneer"]
      : [kind];
  }));
  const subThemeTags = theme && theme.medicalParent === true
    ? stockMedicalSubthemes(stock).filter((name) => (theme.subthemes || []).includes(name)).slice(0, 3)
    : [];
  const identity = cycleIdentityOf(stock);
  const isCycleLeader = roleKinds.includes("cycleLeader");
  const dailyPioneer = roleKinds.includes("dailyPioneer");
  const dailyHeight = roleKinds.includes("dailyHeight");
  return {
    code: stockCode(stock),
    name: clean(stock && stock.name) || stockCode(stock),
    primaryRole,
    tags: tags.sort((left, right) => DISPLAY_ROLE_ORDER.indexOf(left.label) - DISPLAY_ROLE_ORDER.indexOf(right.label)),
    roleKinds,
    detailTags,
    roleStyles,
    // A stock may retain cross-day recognition while serving as a capacity core
    // or another role. Only the single stock selected by cycleLeaderPlan owns the
    // public cycle-leader identity; otherwise the UI could show several leaders.
    cycleIdentity: isCycleLeader && identity.identityEstablished ? {
      cycleInstanceId: identity.cycleInstanceId,
      state: identity.state,
      crossDayPersistent: true,
      identityEstablished: true,
      activePrimary: identity.activePrimary === true,
      evidenceDates: unique(identity.evidenceDates || []),
      executionEligible: identity.executionEligible === true,
      membershipAuthority: identity.membershipAuthority || null,
    } : null,
    todayState: {
      limitUp: isLikelyLimitUp(stock),
      dailyHeight,
      dailyPioneer,
    },
    todayStateLabel: todayStateOf(stock),
    subThemeTags,
    changePct: round(changePct, 2),
    price: round(stock && stock.price, 2),
    amountYi: round(stock && stock.amountYi, 1),
    score: round(stock && stock.score, 1),
    combinedRank: finite(stock && stock.combinedRank),
    ticketType: clean(stock && stock.ticketType),
    identity: clean(leadership.identity || leadership.levelLabel),
    tradeState: clean(leadership.tradeState),
    initiative: {
      score: round((stock && stock.initiativeScore) ?? initiative.score, 1),
      firstAttackTime: clean(initiative.firstAttackTime || initiative.session && initiative.session.firstAttackTime),
      followerCount: Number(initiative.followerCount || 0),
      breadthLift: Number(initiative.breadthLift || 0),
      dataQuality: clean(initiative.dataQuality),
    },
  };
}

function buildThemeStocks(theme, candidates, options = {}) {
  const maxPerRole = {
    龙头: Math.max(1, Number(options.leaderLimit || 3)),
    先锋: 1,
    中军: Math.max(1, Number(options.capacityLimit || 3)),
    补涨: Math.max(1, Number(options.catchupLimit || 3)),
  };
  const candidateByCode = new Map(candidates.map((stock) => [stockCode(stock), stock]).filter(([code]) => code));
  const members = candidates.filter((stock) => stockMatchesTheme(stock, theme));
  const cycleLeadership = options.cycleLeadership || null;
  const medicalPlan = theme && theme.medicalParent === true
    ? medicalRolePlan(members, theme, cycleLeadership)
    : null;
  const cycleLeaders = medicalPlan ? medicalPlan.leaders : cycleLeaderPlan(members, theme, cycleLeadership);
  const cycleLeaderCodes = new Set(cycleLeaders.map((entry) => stockCode(entry.stock)));
  const allDailyHeightEntries = dailyHeightPlan(members, new Set());
  const dailyHeightEntries = medicalPlan ? medicalPlan.dailyHeights : dailyHeightPlan(members, cycleLeaderCodes);
  const dailyHeightCodes = new Set(dailyHeightEntries.map((entry) => stockCode(entry.stock)).filter(Boolean));
  const tagged = new Map();

  const addTag = (seed, role, verified = true, meta = {}) => {
    const stock = mergeStock(seed, candidateByCode);
    const code = stockCode(stock);
    if (!stock || !code || !ROLE_ORDER.includes(role)) return;
    if (!tagged.has(code)) tagged.set(code, { stock, tags: [] });
    const entry = tagged.get(code);
    entry.stock = { ...entry.stock, ...stock };
    if (!entry.tags.some((tag) => tag.label === role)) {
      entry.tags.push({
        key: { 龙头: "leader", 先锋: "pioneer", 中军: "capacity", 补涨: "catchup" }[role],
        label: role,
        reason: clean(meta.reason) || roleReason(role, stock),
        style: clean(meta.style),
        roleKind: clean(meta.roleKind) || ({ 龙头: "cycleLeader", 先锋: "dailyLeader", 中军: "capacityCore", 补涨: "catchup" })[role],
        roleScope: clean(meta.roleScope) || ({ 龙头: "cycle", 先锋: "session", 中军: "rolling", 补涨: "session" })[role],
        verified,
      });
    }
  };

  cycleLeaders.slice(0, maxPerRole.龙头).forEach((entry) => {
    addTag(entry.stock, "龙头", true, entry);
  });

  const pioneerPool = members
    .filter((stock) => !dailyHeightCodes.has(stockCode(stock)))
    .filter((stock) => isVerifiedDailyLeader(stock, options.tradingDate))
    .sort((left, right) => (
      firstAttackMinutes(left) - firstAttackMinutes(right)
      || Number(stockInitiative(right).followerCount || 0) - Number(stockInitiative(left).followerCount || 0)
      || Number(stockInitiative(right).breadthLift || 0) - Number(stockInitiative(left).breadthLift || 0)
      || stockSortScore(right) - stockSortScore(left)
    ));
  pioneerPool.slice(0, maxPerRole.先锋).forEach((stock) => addTag(stock, "先锋", true));

  const capacitySeeds = medicalPlan
    ? [medicalPlan.capacity].filter(Boolean)
    : [
        theme && theme.zhongjun,
        ...members
          .filter((stock) => clean(stock && stock.role) === "中军")
          .sort((left, right) => Number(right && right.amountYi || 0) - Number(left && left.amountYi || 0) || stockSortScore(right) - stockSortScore(left)),
      ].filter(Boolean);
  unique(capacitySeeds.map(stockCode)).filter((code) => !dailyHeightCodes.has(code)).slice(0, maxPerRole.中军).forEach((code) => {
    const seed = capacitySeeds.find((stock) => stockCode(stock) === code);
    addTag(seed, "中军", true, medicalPlan ? { style: "容量核心", reason: "医药母题材内成交额与市值承接领先" } : {});
  });

  const catchupSeeds = medicalPlan
    ? medicalPlan.catchups
    : [
        theme && theme.lowLevel,
        ...members
          .filter((stock) => clean(stock && stock.role) === "补涨")
          .sort((left, right) => stockSortScore(right) - stockSortScore(left)),
      ].filter((stock) => (
        clean(stock && stock.role) === "补涨"
        || /补涨/.test(clean(stock && stock.ticketType))
        || /低位|首板|二板/.test(clean(stock && stock.setup))
      ));
  unique(catchupSeeds.map(stockCode)).filter((code) => !dailyHeightCodes.has(code)).slice(0, maxPerRole.补涨).forEach((code) => {
    const seed = catchupSeeds.find((stock) => stockCode(stock) === code);
    addTag(seed, "补涨", true);
  });

  const stocks = Array.from(tagged.values())
    .map((entry) => compactStock(entry.stock, entry.tags, theme))
    .sort((left, right) => (
      (PRIMARY_ROLE_PRIORITY.get(right.primaryRole) || 0) - (PRIMARY_ROLE_PRIORITY.get(left.primaryRole) || 0)
      || Number(right.score || 0) - Number(left.score || 0)
    ));
  const evidenceTradingDate = normalizeTradingDate(options.tradingDate);
  const dailyHeightStocks = dailyHeightEntries.map((entry) => ({
    ...compactStock(entry.stock, [{
      key: "daily_height",
      label: "当日高度",
      reason: entry.reason,
      style: entry.style,
      roleKind: "dailyHeight",
      roleScope: "session",
      verified: true,
    }], theme),
    status: "risk_watch",
    source: "theme-library.dailyHeightPlan",
    tradingDate: evidenceTradingDate,
    evidence: [
      {
        key: "price_threshold_limit",
        value: true,
        source: "candidate.changePct",
        tradingDate: evidenceTradingDate,
      },
      {
        key: "recent_board_height",
        value: stockBoardHeight(entry.stock),
        source: "candidate.popularity",
        tradingDate: evidenceTradingDate,
      },
    ],
    gaps: isVerifiedDailyLeader(entry.stock, evidenceTradingDate)
      ? ["只代表高度风险；周期身份仍需跨日确认"]
      : ["只代表高度风险，尚无跨日带动证据"],
    executionEligible: false,
  }));
  const roleMembershipByCode = Object.fromEntries(allDailyHeightEntries.map((entry) => [
    stockCode(entry.stock),
    {
      dailyHeight: true,
      roleKind: "dailyHeight",
      roleScope: "session",
      dailyRole: "当日高度",
      todayState: todayStateOf(entry.stock),
    },
  ]).filter(([code]) => code));
  return { stocks, dailyHeightStocks, roleMembershipByCode };
}

function roleEvidenceRow(key, value, source, tradingDate, extras = {}) {
  return {
    key,
    value,
    source,
    tradingDate,
    ...extras,
  };
}

function cycleLeaderEvidenceCard(theme, members, cycleLeadership, roleProjection, context = {}) {
  const tradingDate = normalizeTradingDate(context.tradingDate);
  const source = "themeLibrary.cycleLeadership";
  const unavailable = !tradingDate
    || !members.length
    || cycleLeadership && cycleLeadership.frozen === true;
  const visibleLeader = (roleProjection.stocks || []).find((stock) => (
    Array.isArray(stock && stock.roleKinds) && stock.roleKinds.includes("cycleLeader")
  )) || null;
  const identity = visibleLeader && cycleLeadership && cycleLeadership.identities
    ? cycleLeadership.identities[visibleLeader.code] || cycleLeadership.primary
    : null;
  const visibleLeaderMember = visibleLeader
    ? members.find((stock) => stockCode(stock) === visibleLeader.code) || null
    : null;
  const leaderInitiative = visibleLeaderMember ? stockInitiative(visibleLeaderMember) : {};
  const leaderEvidenceQuality = clean(leaderInitiative && leaderInitiative.dataQuality) || "收盘路径代理";
  const identityHistory = Array.isArray(identity && identity.history) ? identity.history : [];
  const impactTradingDates = unique(identity && identity.impactTradingDates || []);
  const identityImpactQuality = impactTradingDates.map((evidenceTradingDate) => {
    const event = identityHistory.slice().reverse().find((row) => (
      row
      && normalizeTradingDate(row.tradingDate) === normalizeTradingDate(evidenceTradingDate)
      && row.type === "impact"
    )) || null;
    return {
      evidenceTradingDate: normalizeTradingDate(evidenceTradingDate) || evidenceTradingDate,
      dataQuality: clean(event && event.dataQuality) || "unavailable",
      source: clean(event && event.source) || "themeLibrary.cycleLeadership.identity.history",
    };
  });
  const allConfirmationDaysIntraday = identityImpactQuality.length > 0
    && identityImpactQuality.every((row) => row.dataQuality === "分时验证");
  const hasVerifiedIntradayImpact = leaderEvidenceQuality === "分时验证"
    && allConfirmationDaysIntraday;
  const status = unavailable
    ? "unavailable"
    : visibleLeader && ["confirmed", "retained", "challenged"].includes(clean(identity && identity.state).toLowerCase())
      ? clean(identity.state).toLowerCase()
      : "none";
  const evidence = unavailable
    ? [roleEvidenceRow(
        "cycle_evidence_coverage",
        false,
        source,
        tradingDate,
        { note: clean(cycleLeadership && cycleLeadership.freezeReason) || "theme_member_evidence_missing" },
      )]
    : visibleLeader
      ? [
          roleEvidenceRow("cycle_identity_established", identity && identity.identityEstablished === true, `${source}.identities.${visibleLeader.code}`, tradingDate),
          roleEvidenceRow("valid_impact_days", Number(identity && identity.validImpactDays || 0), `${source}.identities.${visibleLeader.code}.validImpactDays`, tradingDate),
          roleEvidenceRow("impact_trading_dates", unique(identity && identity.impactTradingDates || []), `${source}.identities.${visibleLeader.code}.impactTradingDates`, tradingDate),
          roleEvidenceRow("cycle_membership_source", cycleLeaderThemeEvidenceSource(
            visibleLeaderMember,
            theme,
          ), "candidate.themeMembership", tradingDate),
          roleEvidenceRow("identity_evidence_quality", leaderEvidenceQuality, "candidate.leadership.initiative.dataQuality", tradingDate),
          ...identityImpactQuality.map((row) => roleEvidenceRow(
            "identity_impact_evidence_quality",
            row.dataQuality,
            row.source,
            tradingDate,
            { evidenceTradingDate: row.evidenceTradingDate },
          )),
          roleEvidenceRow("structure_intact", status !== "challenged", `candidate.leadership.structure.${visibleLeader.code}`, tradingDate),
        ]
      : [
          roleEvidenceRow("cycle_identity_established", false, `${source}.identities`, tradingDate),
          roleEvidenceRow("evaluated_member_count", members.length, "theme.members", tradingDate),
        ];
  const qualityGaps = visibleLeader && !hasVerifiedIntradayImpact
    ? ["当前周期身份包含收盘路径代理，尚未验证分时层面的真实跨股票因果带动"]
    : [];
  const sourceMode = clean(context.sourceMode) || "derived-current";
  const classifierVersion = clean(context.classifierVersion) || THEME_LIBRARY_CLASSIFIER_VERSION;
  const replayReclassified = sourceMode === "legacy-derived" || sourceMode === "archive-replay";
  evidence.push(
    roleEvidenceRow("snapshot_source_mode", sourceMode, "themeLibrary.sourceMode", tradingDate),
    roleEvidenceRow("classifier_version", classifierVersion, "themeLibrary.classifierVersion", tradingDate),
  );
  if (replayReclassified) {
    evidence.push(roleEvidenceRow(
      "identity_classification_mode",
      "history_replay_reclassified",
      "themeLibrary.sourceMode",
      tradingDate,
    ));
  }
  const replayGaps = replayReclassified
    ? ["新版规则基于历史数据回放，不是原归档当时已确认"]
    : [];
  const gaps = unavailable
    ? [clean(cycleLeadership && cycleLeadership.freezeReason) || "题材成员或精确收盘证据不足", ...replayGaps]
    : status === "challenged"
      ? ["当前结构受损或负反馈明显，需重新验证承接与跨股票影响", ...qualityGaps, ...replayGaps]
      : status === "none"
        ? ["本周期尚未达到至少两个不同交易日的跨股票影响确认", ...replayGaps]
        : ["身份只说明周期地位，明日承接与交易条件仍需独立验证", ...qualityGaps, ...replayGaps];
  return {
    roleKey: "cycleLeader",
    roleLabel: "周期龙头",
    roleScope: "cycle",
    status,
    stock: unavailable ? null : visibleLeader,
    tradingDate,
    source,
    sourceMode,
    classifierVersion,
    evidence,
    gaps,
    executionEligible: false,
  };
}

function dailyLeaderEvidenceCard(theme, members, context = {}) {
  const tradingDate = normalizeTradingDate(context.tradingDate);
  const source = "leadership.initiative.session";
  const eligibleMembers = members.filter((stock) => cycleLeaderThemeEligible(stock, theme));
  const sessionEvidenceMembers = eligibleMembers.filter((stock) => {
    const initiative = stockInitiative(stock);
    const evidenceDate = normalizeTradingDate(
      initiative.tradingDate
        || initiative.session && (initiative.session.tradingDate || initiative.session.date),
    );
    return initiative.dataQuality === "分时验证"
      && (!tradingDate || !evidenceDate || evidenceDate === tradingDate);
  });
  const leader = eligibleMembers
    .filter((stock) => isVerifiedDailyLeader(stock, tradingDate))
    .sort((left, right) => (
      firstAttackMinutes(left) - firstAttackMinutes(right)
      || Number(stockInitiative(right).followerCount || 0) - Number(stockInitiative(left).followerCount || 0)
      || Number(stockInitiative(right).breadthLift || 0) - Number(stockInitiative(left).breadthLift || 0)
      || stockCode(left).localeCompare(stockCode(right))
    ))[0] || null;
  const unavailable = !tradingDate || !eligibleMembers.length || !sessionEvidenceMembers.length;
  const initiative = leader ? stockInitiative(leader) : {};
  const compact = leader ? compactStock(leader, [{
    key: "pioneer",
    label: "先锋",
    reason: roleReason("先锋", leader),
    style: "当日龙头",
    roleKind: "dailyLeader",
    roleScope: "session",
    verified: true,
  }], theme) : null;
  const status = unavailable ? "unavailable" : leader ? "confirmed" : "none";
  const sourceMode = clean(context.sourceMode) || "derived-current";
  const classifierVersion = clean(context.classifierVersion) || THEME_LIBRARY_CLASSIFIER_VERSION;
  const evidence = unavailable
    ? [roleEvidenceRow("same_day_initiative_coverage", false, source, tradingDate)]
    : leader
      ? [
          roleEvidenceRow("same_day_proactive", initiative.proactive === true, "initiative.proactive", tradingDate),
          roleEvidenceRow("first_attack_time", clean(initiative.firstAttackTime || initiative.session && initiative.session.firstAttackTime), "initiative.session.firstAttackTime", tradingDate),
          roleEvidenceRow("follower_count", Number(initiative.followerCount || 0), "initiative.followerCount", tradingDate),
          roleEvidenceRow("breadth_lift", Number(initiative.breadthLift || 0), "initiative.breadthLift", tradingDate),
          roleEvidenceRow("price_discovery_participatory", initiative.priceDiscovery && initiative.priceDiscovery.noPriceDiscovery !== true, "initiative.priceDiscovery", tradingDate),
        ]
      : [
          roleEvidenceRow("same_day_proactive_driver", false, source, tradingDate),
          roleEvidenceRow("evaluated_member_count", sessionEvidenceMembers.length, "theme.members", tradingDate),
        ];
  evidence.push(
    roleEvidenceRow("snapshot_source_mode", sourceMode, "themeLibrary.sourceMode", tradingDate),
    roleEvidenceRow("classifier_version", classifierVersion, "themeLibrary.classifierVersion", tradingDate),
  );
  const gaps = unavailable
    ? ["缺少同交易日分时主动性与跨股票带动证据"]
    : leader
      ? ["当日龙头只描述今日主动带动，不等于周期龙头或可执行买点"]
      : ["没有股票同时满足率先发动、可参与价格发现和带动同题材股票"];
  return {
    roleKey: "dailyLeader",
    roleLabel: "当日龙头",
    roleScope: "session",
    status,
    stock: unavailable ? null : compact,
    tradingDate,
    source,
    sourceMode,
    classifierVersion,
    evidence,
    gaps,
    executionEligible: false,
  };
}

function buildRoleEvidenceCards(theme, candidates, cycleLeadership, roleProjection, context = {}) {
  const members = candidates.filter((stock) => stockMatchesTheme(stock, theme));
  return [
    cycleLeaderEvidenceCard(theme, members, cycleLeadership, roleProjection, context),
    dailyLeaderEvidenceCard(theme, members, context),
  ];
}

function fallbackTopicItems(payload) {
  return (Array.isArray(payload && payload.hotConcepts) ? payload.hotConcepts : []).map((theme) => ({
    ...theme,
    label: theme && theme.isCoreDirection ? "核心方向" : theme && theme.resonance ? "共振热点" : "热门观察",
  }));
}

function marketCycleEvidence(payload, tradingDate, generatedAt) {
  const state = payload && payload.market && payload.market.state || {};
  const resolution = state.structuralResolution || {};
  const raw = clean(
    state.structuralCycle
      || resolution.structuralCycle
      || state.cycle
      || payload && payload.market && payload.market.cycleLabel,
  );
  const normalized = normalizeBigCycle(raw);
  const detail = resolution.indexSubPhase || state.indexSubPhase || {};
  const indexEnvironment = resolution.indexEnvironment && typeof resolution.indexEnvironment === "object"
    ? resolution.indexEnvironment
    : state.indexEnvironment && typeof state.indexEnvironment === "object"
      ? state.indexEnvironment
      : payload && payload.market && payload.market.indexEnvironment && typeof payload.market.indexEnvironment === "object"
        ? payload.market.indexEnvironment
        : {};
  const evidence = Array.isArray(indexEnvironment.evidence)
    ? indexEnvironment.evidence.map((row) => row && typeof row === "object" ? { ...row } : row)
    : Array.isArray(resolution.evidence)
      ? resolution.evidence.map((row) => row && typeof row === "object" ? { ...row } : row)
      : [];
  const rawCoverage = indexEnvironment.coverage && typeof indexEnvironment.coverage === "object"
    ? indexEnvironment.coverage
    : resolution.coverage && typeof resolution.coverage === "object"
      ? resolution.coverage
      : null;
  const structureCoverage = finite(indexEnvironment.structureCoverage ?? resolution.structureCoverage);
  const trendCounts = indexEnvironment.trendCounts && typeof indexEnvironment.trendCounts === "object"
    ? { ...indexEnvironment.trendCounts }
    : resolution.trendCounts && typeof resolution.trendCounts === "object"
      ? { ...resolution.trendCounts }
      : null;
  const coverage = rawCoverage
    ? { ...rawCoverage }
    : structureCoverage !== null
      ? { structureCoverage, trendCounts }
      : null;
  const structuralSourceAvailable = Boolean(normalized);
  const explicitlyVerified = indexEnvironment.verified === true
    || resolution.verified === true
    || coverage && (coverage.verified === true || coverage.complete === true);
  const hasTraceableStructure = evidence.length > 0 || coverage && Object.keys(coverage).length > 0;
  const verified = Boolean(structuralSourceAvailable && explicitlyVerified && hasTraceableStructure);
  const gaps = verified
    ? []
    : !structuralSourceAvailable
      ? ["仅有周期标签，缺少已验证的指数结构证据"]
      : !explicitlyVerified
        ? ["指数结构证据尚未明确标记为已验证"]
        : ["指数结构已标记验证，但缺少可追溯证据或覆盖范围"];
  return {
    key: normalizeBigCycleKey(raw) || "unknown",
    label: normalized ? `大周期${normalized}` : "大周期待确认",
    detailKey: clean(detail.key) || null,
    detailLabel: clean(detail.label) || null,
    source: resolution.structuralCycle || state.structuralCycle
      ? "market.state.structuralResolution"
      : "market.cycleLabel",
    tradingDate,
    asOf: clean(generatedAt) || null,
    verified,
    reason: clean(resolution.reason || indexEnvironment.reason) || null,
    evidence,
    coverage,
    gaps,
  };
}

function themeCycleEvidence(theme, cycleLeadership, tradingDate, historyOverride = null) {
  const topicLabel = clean(theme && (theme.topicLabel || theme.label)) || "题材周期待确认";
  const sustained = typeof (theme && theme.sustained) === "boolean" ? theme.sustained : null;
  const resonance = typeof (theme && theme.resonance) === "boolean" ? theme.resonance : null;
  const history = historyOverride && typeof historyOverride === "object"
    ? historyOverride
    : theme && theme.history && typeof theme.history === "object" ? theme.history : {};
  const isNew = typeof history.isNew === "boolean"
    ? history.isNew
    : typeof (theme && theme.isNew) === "boolean" ? theme.isNew : null;
  const continued = typeof history.continued === "boolean"
    ? history.continued
    : typeof (theme && theme.continued) === "boolean" ? theme.continued : null;
  const comparisonUnavailable = history.comparisonUnavailable === true
    || isNew === null && continued === null;
  const sectorChangePct = finite(theme && (theme.sectorChangePct ?? (theme.sector && theme.sector.changePct)));
  const explicitWeakening = /一日游|退潮|风险|全跌|走弱/.test(topicLabel);
  const state = explicitWeakening
    ? "weakening_risk"
    : isNew
      ? "new_watch"
      : continued && resonance && sectorChangePct !== null && sectorChangePct > 0
        ? "continued_strengthening_watch"
        : continued
          ? "continued_unverified"
          : "unavailable";
  const leaderIdentityState = clean(cycleLeadership && cycleLeadership.state).toLowerCase() || "candidate";
  const labelByState = {
    new_watch: "新启动观察",
    continued_strengthening_watch: "跨日延续·当日走强",
    continued_unverified: "跨日仍在榜·强度待确认",
    weakening_risk: "跨日仍在榜·明显走弱",
    unavailable: "数据不足",
  };
  return {
    key: themeCycleKey(theme) || "unknown",
    topicLabel,
    label: labelByState[state] || labelByState.unavailable,
    state,
    source: "topicBoard.items",
    tradingDate,
    sustained,
    resonance,
    reasons: unique(theme && theme.reasons || []),
    history: { isNew, continued, comparisonUnavailable },
    sectorChangePct,
    directionState: theme && theme.directionState && typeof theme.directionState === "object"
      ? { ...theme.directionState }
      : null,
    leaderIdentityState,
    cycleInstanceId: clean(cycleLeadership && cycleLeadership.cycleInstanceId) || null,
    episodeStartedOn: normalizeTradingDate(cycleLeadership && cycleLeadership.episodeStartedOn) || null,
    settledTradingDate: normalizeTradingDate(cycleLeadership && cycleLeadership.settledTradingDate) || null,
    evidenceStatus: state === "unavailable" ? "unavailable" : "observed",
  };
}

function themeCycleHistoryEvidence(theme, previousThemeLibrary, context = {}) {
  const expectedPreviousTradingDate = normalizeTradingDate(context.expectedPreviousTradingDate);
  const previousTradingDate = normalizeTradingDate(previousThemeLibrary && previousThemeLibrary.tradingDate);
  const previousSnapshotKind = clean(previousThemeLibrary && previousThemeLibrary.snapshotKind).toLowerCase();
  const exactPreviousAvailable = Boolean(
    context.providerDatesVerified === true
    && expectedPreviousTradingDate
    && previousTradingDate === expectedPreviousTradingDate
    && previousSnapshotKind === "closing",
  );
  if (!exactPreviousAvailable) {
    return { isNew: null, continued: null, comparisonUnavailable: true };
  }
  const continued = Boolean(previousThemeFor(previousThemeLibrary, theme));
  return { isNew: !continued, continued, comparisonUnavailable: false };
}

function median(values) {
  const rows = (values || []).map(finite).filter((value) => value !== null).sort((left, right) => left - right);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
}

function exactSubthemeMembers(candidates, subthemeName) {
  const target = clean(subthemeName);
  if (!target) return [];
  // mainConcept/mainFamily 是聚类后的派生标签，不能作为“精确细分归属”。
  // 这里只读取原始 concepts；否则一个家族被命名成 CPO 后会再次把全家族算进 CPO。
  return (Array.isArray(candidates) ? candidates : []).filter((stock) => unique(
    Array.isArray(stock && stock.concepts) ? stock.concepts : [],
  ).includes(target));
}

function declaredSubthemeSeeds(theme, candidates) {
  const family = canonicalThemeFamily(theme && (theme.family || theme.name));
  const declaredRows = Array.isArray(theme && theme.subthemeCandidates)
    ? theme.subthemeCandidates.filter((row) => row && typeof row === "object")
    : [];
  const declaredByName = new Map(declaredRows.map((row) => [clean(row.name), row]));
  const observedNames = unique([
    theme && theme.primarySubtheme,
    ...(Array.isArray(theme && theme.aliases) ? theme.aliases : []),
    ...(Array.isArray(theme && theme.matchNames) ? theme.matchNames : []),
    ...declaredRows.map((row) => row.name),
    ...(Array.isArray(candidates) ? candidates : []).flatMap((stock) => [
      stock && stock.mainConcept,
      ...(Array.isArray(stock && stock.concepts) ? stock.concepts : []),
    ]),
  ]).filter((name) => isExplicitFamilySubtheme(name, family));
  const names = observedNames.length ? observedNames : unique([theme && theme.name]).filter(Boolean);
  return names.map((name) => ({ name, declared: declaredByName.get(name) || null }));
}

function scoreExactSubtheme(seed, candidates, tradingDate) {
  const members = exactSubthemeMembers(candidates, seed.name);
  const changes = members.map((stock) => finite(stock && stock.changePct)).filter((value) => value !== null);
  const upCount = changes.filter((value) => value > 0).length;
  const upRate = changes.length ? upCount / changes.length : null;
  const medianChangePct = median(changes);
  const strongOrLimitMembers = members.filter((stock) => (
    isLikelyLimitUp(stock) || (finite(stock && stock.changePct) ?? -Infinity) >= 5
  ));
  const limitUpMembers = members.filter(isLikelyLimitUp);
  const proactiveCoreMembers = members.filter((stock) => {
    const initiative = stockInitiative(stock);
    return isVerifiedPioneer(stock, tradingDate)
      && Number(initiative.followerCount || 0) >= SUBTHEME_THRESHOLDS.minimumFollowerCount;
  });
  const declaredResonance = seed.declared && seed.declared.resonance;
  const resonanceVerified = declaredResonance === true;
  const targetStrongCount = Math.max(2, Math.ceil(members.length * 0.25));
  const breadthScore = upRate === null ? 0 : clamp(upRate, 0, 1) * 35;
  const medianScore = medianChangePct === null ? 0 : clamp((medianChangePct + 2) / 8, 0, 1) * 25;
  const strongScore = clamp(strongOrLimitMembers.length / targetStrongCount, 0, 1) * 20;
  const initiativeScore = proactiveCoreMembers.length ? 20 : 0;
  const score = round(breadthScore + medianScore + strongScore + initiativeScore, 1);
  const gates = {
    exactSample: members.length >= SUBTHEME_THRESHOLDS.minimumExactSamples,
    upRate: upRate !== null && upRate >= SUBTHEME_THRESHOLDS.minimumUpRate,
    medianChange: medianChangePct !== null && medianChangePct > SUBTHEME_THRESHOLDS.minimumMedianChangePct,
    strongOrLimit: strongOrLimitMembers.length >= SUBTHEME_THRESHOLDS.minimumStrongOrLimitCount,
    proactiveCore: proactiveCoreMembers.length >= SUBTHEME_THRESHOLDS.minimumProactiveCoreCount,
    resonance: resonanceVerified,
  };
  const gaps = unique([
    !gates.exactSample ? `精确样本${members.length}只，至少${SUBTHEME_THRESHOLDS.minimumExactSamples}只` : null,
    !gates.upRate ? `上涨率${upRate === null ? "未知" : `${round(upRate * 100, 1)}%`}，需≥${round(SUBTHEME_THRESHOLDS.minimumUpRate * 100, 1)}%` : null,
    !gates.medianChange ? `中位涨幅${medianChangePct === null ? "未知" : `${round(medianChangePct, 2)}%`}，需>0%` : null,
    !gates.strongOrLimit ? `强势/涨停${strongOrLimitMembers.length}只，至少${SUBTHEME_THRESHOLDS.minimumStrongOrLimitCount}只` : null,
    !gates.proactiveCore ? `缺少带动至少${SUBTHEME_THRESHOLDS.minimumFollowerCount}只同细分股票的主动核心` : null,
    !gates.resonance ? "细分自身板块共振尚未验证" : null,
  ]);
  return {
    name: seed.name,
    family: canonicalThemeFamily(seed.name),
    score,
    exactSampleCount: members.length,
    upRate: upRate === null ? null : round(upRate, 3),
    medianChangePct: round(medianChangePct, 2),
    strongOrLimitCount: strongOrLimitMembers.length,
    limitUpCount: limitUpMembers.length,
    proactiveCoreCount: proactiveCoreMembers.length,
    proactiveCoreCodes: proactiveCoreMembers.map(stockCode).filter(Boolean),
    memberCodes: members.map(stockCode).filter(Boolean),
    resonanceVerified,
    gates,
    gaps,
    baseQualified: Object.values(gates).every(Boolean),
    source: "exact_subtheme_members_only",
  };
}

function buildSubthemeDecision(theme, candidates, previousTheme, context = {}) {
  const tradingDate = normalizeTradingDate(context.tradingDate);
  const exactPreviousAvailable = context.exactPreviousAvailable === true;
  const snapshotKind = clean(context.snapshotKind).toLowerCase();
  const closingEligible = snapshotKind === "closing";
  const ranked = declaredSubthemeSeeds(theme, candidates)
    .map((seed) => scoreExactSubtheme(seed, candidates, tradingDate))
    .sort((left, right) => right.score - left.score || right.strongOrLimitCount - left.strongOrLimitCount || right.exactSampleCount - left.exactSampleCount);
  const structurallyQualified = ranked.filter((row) => row.baseQualified);
  const currentBest = ranked[0] || null;
  const topQualified = structurallyQualified[0] || null;
  const secondQualified = structurallyQualified[1] || null;
  const leadScoreGap = topQualified
    ? secondQualified ? round(topQualified.score - secondQualified.score, 1) : 100
    : null;
  const uniqueLeader = Boolean(
    topQualified
    && leadScoreGap >= SUBTHEME_THRESHOLDS.minimumLeadScoreGap
  );
  const currentWinner = uniqueLeader ? {
    ...topQualified,
    leadScoreGap,
  } : null;
  if (topQualified && !uniqueLeader) {
    topQualified.gaps = unique([
      ...topQualified.gaps,
      `领先第二细分${leadScoreGap}分，需≥${SUBTHEME_THRESHOLDS.minimumLeadScoreGap}分`,
    ]);
  }

  const previousDecision = previousTheme && previousTheme.subthemeDecision
    && Number(previousTheme.subthemeDecision.version || 0) === SUBTHEME_DECISION_VERSION
    ? previousTheme.subthemeDecision
    : null;
  const previousHistory = exactPreviousAvailable && previousDecision
    && previousDecision.history && Array.isArray(previousDecision.history.closingWinners)
    ? previousDecision.history.closingWinners
    : [];
  const closingWinners = previousHistory
    .filter((row) => row && normalizeTradingDate(row.tradingDate) && normalizeTradingDate(row.tradingDate) !== tradingDate)
    .concat(closingEligible ? [{ tradingDate, name: currentWinner && currentWinner.name || null, qualified: Boolean(currentWinner) }] : [])
    .slice(-SUBTHEME_THRESHOLDS.confirmationWindowCloses);
  const confirmationCount = currentWinner
    ? closingWinners.filter((row) => row.qualified === true && clean(row.name) === currentWinner.name).length
    : 0;
  const mainAttackSubtheme = currentWinner
    && closingEligible
    && exactPreviousAvailable
    && confirmationCount >= SUBTHEME_THRESHOLDS.confirmationOccurrences
    ? { ...currentWinner, confirmed: true, confirmationCount }
    : null;
  const historicalSubtheme = previousDecision && previousDecision.mainAttackSubtheme
    ? { ...previousDecision.mainAttackSubtheme, historicalOnly: !mainAttackSubtheme }
    : null;
  const status = !closingEligible ? "intraday_observation"
    : mainAttackSubtheme ? "confirmed"
    : currentWinner ? exactPreviousAvailable ? "pending_confirmation" : "history_unavailable"
      : "no_unique_main_attack";
  const conclusion = mainAttackSubtheme
    ? `今日主攻细分：${mainAttackSubtheme.name}`
    : currentWinner
      ? `${currentWinner.name}通过当日门槛，但跨日确认仅${confirmationCount}/${SUBTHEME_THRESHOLDS.confirmationOccurrences}`
      : currentBest
        ? `暂无唯一主攻细分；当前最强候选${currentBest.name}仍有门槛未通过`
        : "暂无唯一主攻细分；缺少精确细分样本";
  return {
    version: SUBTHEME_DECISION_VERSION,
    method: "exact_subtheme_two_close_confirmation_v1",
    calibrated: false,
    status,
    family: canonicalThemeFamily(theme && (theme.family || theme.name)),
    tradingDate,
    snapshotKind: snapshotKind || "unknown",
    thresholds: { ...SUBTHEME_THRESHOLDS },
    currentBest,
    currentWinner,
    mainAttackSubtheme,
    switchCandidate: currentWinner && !mainAttackSubtheme ? { ...currentWinner } : null,
    historicalSubtheme,
    ranked,
    conclusion,
    history: {
      exactPreviousAvailable,
      confirmationCount,
      closingWinners,
    },
    guardrails: {
      familyMetricsCannotPromoteSubtheme: true,
      exactMembershipRequired: true,
      historicalIdentityCannotSetTodayMainAttack: true,
      closingOnlyConfirmation: true,
      emptyMainAttackAllowed: true,
      executionAuthority: false,
    },
  };
}

function buildMainThemeDecision(themes, previousThemeLibrary, context = {}) {
  const tradingDate = normalizeTradingDate(context.tradingDate);
  const snapshotKind = clean(context.snapshotKind).toLowerCase() || "unknown";
  const closingEligible = snapshotKind === "closing";
  const exactPreviousAvailable = context.exactPreviousAvailable === true;
  const currentFamilyTheme = (themes || []).find((theme) => theme && theme.isMainLine === true)
    || (themes || [])[0]
    || null;
  const currentFamily = currentFamilyTheme ? {
    id: clean(currentFamilyTheme.id || currentFamilyTheme.family || currentFamilyTheme.name),
    name: clean(currentFamilyTheme.family || currentFamilyTheme.name),
    label: clean(currentFamilyTheme.label),
    sustained: currentFamilyTheme.sustained === true,
  } : null;
  const allCandidates = [];
  const seen = new Set();
  (themes || []).forEach((theme) => {
    const rows = theme && theme.subthemeDecision && Array.isArray(theme.subthemeDecision.ranked)
      ? theme.subthemeDecision.ranked
      : [];
    rows.forEach((row) => {
      const key = `${clean(row.family)}::${clean(row.name)}`;
      if (!row || !row.name || seen.has(key)) return;
      seen.add(key);
      allCandidates.push({ ...row, family: clean(row.family || theme.family || theme.name) });
    });
  });
  const ranked = allCandidates.sort((left, right) => (
    right.score - left.score
    || right.strongOrLimitCount - left.strongOrLimitCount
    || right.exactSampleCount - left.exactSampleCount
  ));
  const qualified = ranked.filter((row) => row.baseQualified === true);
  const top = qualified[0] || null;
  const runnerUp = qualified[1] || null;
  const leadScoreGap = top ? runnerUp ? round(top.score - runnerUp.score, 1) : 100 : null;
  const currentWinner = top && leadScoreGap >= SUBTHEME_THRESHOLDS.minimumLeadScoreGap
    ? { ...top, leadScoreGap }
    : null;
  const coLeading = Boolean(top && runnerUp && leadScoreGap < SUBTHEME_THRESHOLDS.minimumLeadScoreGap);

  const previousDecision = previousThemeLibrary && previousThemeLibrary.mainThemeDecision
    && Number(previousThemeLibrary.mainThemeDecision.version || 0) === SUBTHEME_DECISION_VERSION
    ? previousThemeLibrary.mainThemeDecision
    : null;
  const previousHistory = exactPreviousAvailable && previousDecision && previousDecision.history
    ? previousDecision.history
    : {};
  const priorClosingWinners = Array.isArray(previousHistory.closingWinners)
    ? previousHistory.closingWinners
    : [];
  const closingWinners = priorClosingWinners
    .filter((row) => row && normalizeTradingDate(row.tradingDate) && normalizeTradingDate(row.tradingDate) !== tradingDate)
    .concat(closingEligible ? [{
      tradingDate,
      generationId: clean(context.generationId) || null,
      asOf: clean(context.asOf) || null,
      classifierVersion: THEME_LIBRARY_CLASSIFIER_VERSION,
      snapshotKind,
      winner: currentWinner && currentWinner.name || null,
      family: currentWinner && currentWinner.family || null,
      qualified: Boolean(currentWinner),
    }] : [])
    .slice(-SUBTHEME_THRESHOLDS.confirmationWindowCloses);
  const confirmationCount = currentWinner
    ? closingWinners.filter((row) => row.qualified === true && clean(row.winner) === currentWinner.name).length
    : 0;
  const mainAttackSubtheme = currentWinner
    && closingEligible
    && exactPreviousAvailable
    && confirmationCount >= SUBTHEME_THRESHOLDS.confirmationOccurrences
    ? { ...currentWinner, confirmed: true, confirmationCount }
    : null;

  const priorFamilyWinners = Array.isArray(previousHistory.familyWinners)
    ? previousHistory.familyWinners
    : [];
  const familyWinners = priorFamilyWinners
    .filter((row) => row && normalizeTradingDate(row.tradingDate) && normalizeTradingDate(row.tradingDate) !== tradingDate)
    .concat(closingEligible ? [{
      tradingDate,
      generationId: clean(context.generationId) || null,
      asOf: clean(context.asOf) || null,
      classifierVersion: THEME_LIBRARY_CLASSIFIER_VERSION,
      snapshotKind,
      family: currentFamily && currentFamily.name || null,
      qualified: Boolean(currentFamily),
    }] : [])
    .slice(-SUBTHEME_THRESHOLDS.confirmationWindowCloses);
  const familyConfirmationCount = currentFamily
    ? familyWinners.filter((row) => row.qualified === true && clean(row.family) === currentFamily.name).length
    : 0;
  const previousConfirmedFamily = previousDecision && previousDecision.confirmedFamily
    ? { ...previousDecision.confirmedFamily }
    : null;
  const confirmedFamily = currentFamily
    && closingEligible
    && exactPreviousAvailable
    && familyConfirmationCount >= SUBTHEME_THRESHOLDS.confirmationOccurrences
    ? { ...currentFamily, state: "confirmed", confirmationCount: familyConfirmationCount }
    : previousConfirmedFamily
      ? {
          ...previousConfirmedFamily,
          state: currentFamily && currentFamily.name === previousConfirmedFamily.name ? "retained" : "challenged",
        }
      : null;
  const historicalSubtheme = previousDecision && previousDecision.mainAttackSubtheme
    ? { ...previousDecision.mainAttackSubtheme, historicalOnly: true }
    : null;
  const status = !closingEligible ? "intraday_observation"
    : mainAttackSubtheme ? "confirmed_main_attack"
      : coLeading ? "co_leading"
        : currentWinner ? exactPreviousAvailable ? "pending" : "history_unavailable"
          : "none";
  const familyLabel = currentFamily && currentFamily.name || "主线家族待确认";
  const conclusion = mainAttackSubtheme
    ? `主线家族：${familyLabel}；今日主攻细分：${mainAttackSubtheme.name}`
    : coLeading
      ? `主线家族：${familyLabel}；多个细分接近，暂无唯一主攻细分`
      : currentWinner
        ? `主线家族：${familyLabel}；${currentWinner.name}当日占优，等待跨日确认`
        : `主线家族：${familyLabel}；今日暂无唯一主攻细分`;
  return {
    version: SUBTHEME_DECISION_VERSION,
    method: "global_exact_subtheme_two_of_three_closing_v1",
    calibrated: false,
    tradingDate,
    snapshotKind,
    status,
    family: currentFamily,
    confirmedFamily,
    historicalFamily: previousConfirmedFamily,
    currentBestSubtheme: ranked[0] || null,
    todayBestSubtheme: currentWinner,
    currentWinner,
    runnerUp,
    leadScoreGap,
    mainAttackSubtheme,
    switchCandidate: currentWinner && !mainAttackSubtheme ? { ...currentWinner } : null,
    historicalSubtheme,
    ranked,
    conclusion,
    history: {
      exactPreviousAvailable,
      confirmationCount,
      familyConfirmationCount,
      closingWinners,
      familyWinners,
    },
    guardrails: {
      exactOriginalConceptsOnly: true,
      globalCrossFamilyRanking: true,
      currentCloseMustWin: true,
      twoOfThreeClosingRequired: true,
      missingExactT1FailsClosed: true,
      intradayCannotAdvanceHistory: true,
      historicalIdentityCannotSetTodayMainAttack: true,
      familyMetricsCannotPromoteSubtheme: true,
      emptyMainAttackAllowed: true,
      executionAuthority: false,
    },
  };
}

function buildThemeLibrarySnapshot(payload, options = {}) {
  const tradingDate = normalizeTradingDate(options.tradingDate) || themeLibraryTradingDate(payload);
  const providerDates = payload && payload.market && payload.market.limitStats
    && payload.market.limitStats.dates || {};
  const previousDateVerified = providerDates.verified !== false;
  const expectedPreviousTradingDate = normalizeTradingDate(providerDates.prev);
  const previousTradingDate = previousDateVerified ? expectedPreviousTradingDate : "";
  const candidates = Array.isArray(payload && payload.candidates) ? payload.candidates : [];
  // 题材主池只能来自题材库/题材板自身已经形成的结构。热门榜只负责发现和验证，
  // 不能在主池缺失时把 hotConcepts 反向提升成可执行主池。
  const sourceBoardItems = payload && payload.topicBoard && Array.isArray(payload.topicBoard.items)
    ? payload.topicBoard.items
    : [];
  const legacyHotThemes = sourceBoardItems.length ? [] : fallbackTopicItems(payload);
  const boardItems = consolidateMedicalTopics(sourceBoardItems, candidates);
  const hotRankCoverage = buildHotRankCoverage(payload, candidates);
  const maxThemes = Math.max(1, Math.min(20, Number(options.maxThemes || 8)));
  const mainLine = payload && payload.topicBoard && payload.topicBoard.mainLine || {};
  const snapshotSourceMode = clean(options.sourceMode || "derived-current");
  const mainLineKeys = new Set(themeKeys(mainLine));
  const themes = boardItems
    .filter((theme) => clean(theme && theme.name) && clean(theme && theme.name) !== "未归类")
    .slice(0, maxThemes)
    .map((theme, index) => {
      const themeMembers = candidates.filter((stock) => stockMatchesTheme(stock, theme));
      const themeHistory = themeCycleHistoryEvidence(theme, options.previousThemeLibrary || null, {
        expectedPreviousTradingDate,
        providerDatesVerified: previousDateVerified,
      });
      const previousTheme = previousThemeFor(options.previousThemeLibrary || null, theme);
      const subthemeDecision = buildSubthemeDecision(theme, candidates, previousTheme, {
        tradingDate,
        exactPreviousAvailable: themeHistory.comparisonUnavailable === false,
        snapshotKind: clean(options.snapshotKind || payload && payload.archiveMeta && payload.archiveMeta.snapshotKind),
      });
      const cycleLeadership = resolveThemeCycleLeadership(theme, candidates, {
        tradingDate,
        expectedPreviousTradingDate,
        providerDatesVerified: previousDateVerified,
        snapshotKind: clean(options.snapshotKind || payload && payload.archiveMeta && payload.archiveMeta.snapshotKind),
        previousThemeLibrary: options.previousThemeLibrary || null,
        exactPreviousMissing: options.exactPreviousMissing === true,
      });
      const candidatesWithCycleIdentity = projectCycleIdentityForTheme(candidates, cycleLeadership, theme, tradingDate);
      const roleProjection = buildThemeStocks(theme, candidatesWithCycleIdentity, {
        ...options,
        tradingDate,
        cycleLeadership,
      });
      const stocks = roleProjection.stocks;
      const dailyHeightStocks = roleProjection.dailyHeightStocks;
      const roleMembershipByCode = roleProjection.roleMembershipByCode;
      const dailyPioneerStocks = stocks.filter((stock) => stock.roleKinds.includes("dailyPioneer"));
      const dailyLeaderStocks = stocks.filter((stock) => stock.roleKinds.includes("dailyLeader"));
      const roleEvidenceCards = buildRoleEvidenceCards(
        theme,
        candidatesWithCycleIdentity,
        cycleLeadership,
        roleProjection,
        {
          tradingDate,
          sourceMode: snapshotSourceMode,
          classifierVersion: THEME_LIBRARY_CLASSIFIER_VERSION,
        },
      );
      const roleAuthorityByCode = Object.fromEntries(Object.keys(cycleLeadership.identities || {}).map((code) => {
        const member = candidatesWithCycleIdentity.find((stock) => stockCode(stock) === code);
        const membershipAuthority = member && member.leadership && member.leadership.cycleIdentity
          && member.leadership.cycleIdentity.membershipAuthority;
        return [code, membershipAuthority || cycleLeaderMembershipAuthority(
          member,
          theme,
          cycleLeadership.identities[code],
          tradingDate,
        )];
      }));
      const hotVerification = buildThemeHotVerification(theme, candidates, hotRankCoverage);
      const roleCounts = Object.fromEntries(DISPLAY_ROLE_ORDER.map((role) => [
        role,
        role === "当日高度"
          ? dailyHeightStocks.length
          : stocks.filter((stock) => stock.tags.some((tag) => tag.label === role)).length,
      ]));
      const keys = themeKeys(theme);
      return {
        id: clean(theme.family || theme.name),
        rank: index + 1,
        name: clean(theme.name),
        displayName: clean(theme.displayName || theme.name),
        family: clean(theme.family || theme.name),
        aliases: unique(theme.aliases || []).slice(0, 12),
        subthemes: unique(theme.subthemes || []).slice(0, 20),
        subthemeDecision,
        medicalParent: theme.medicalParent === true,
        sourceThemeNames: unique(theme.sourceThemeNames || []).slice(0, 12),
        isMainLine: keys.some((key) => mainLineKeys.has(key)),
        label: clean(theme.label || (theme.resonance ? "共振热点" : "热门观察")),
        sustained: theme.sustained === true,
        score: round(theme.score, 1),
        count: Number(theme.count || 0),
        limitCount: Number(theme.limitCount || 0),
        todayLimitUpCount: themeMembers.filter(isLikelyLimitUp).length,
        recentHeightCount: themeMembers.filter((stock) => stockBoardHeight(stock) > 0).length,
        resonance: theme.resonance === true,
        resonanceLabel: clean(theme.resonanceLabel),
        sector: {
          name: clean(theme.sectorName || theme.sector && theme.sector.name),
          changePct: round(theme.sectorChangePct ?? (theme.sector && theme.sector.changePct), 2),
          amountYi: round(theme.sector && theme.sector.amountYi, 1),
        },
        summary: clean(theme.summary),
        reasons: unique(theme.reasons || []).slice(0, 6),
        poolType: "theme_main",
        poolState: hotVerification.state,
        hotVerification,
        directionConfirmationEligible: hotVerification.directionConfirmationEligible,
        directExecutionEligible: false,
        cycleLeadership,
        themeCycle: themeCycleEvidence(theme, cycleLeadership, tradingDate, themeHistory),
        roleEvidenceCards,
        roleAuthorityByCode,
        roleCounts,
        stockCount: new Set([...stocks, ...dailyHeightStocks].map((stock) => stock.code)).size,
        stocks,
        dailyHeightStocks,
        roleMembershipByCode,
        dailyPioneerStocks,
        dailyLeaderStocks,
      };
    });
  const hotOnlyDiscoveries = buildHotOnlyDiscoveries(boardItems, candidates, hotRankCoverage);
  const priorityVerificationThemes = themes.filter((theme) => (
    theme.hotVerification && ["main_and_hot", "main_and_hot_pending"].includes(theme.hotVerification.state)
  ));
  const confirmationThemeIds = themes
    .filter((theme) => theme.directionConfirmationEligible === true)
    .map((theme) => theme.id);
  const retainedObservationThemes = themes.filter((theme) => (
    theme.directionConfirmationEligible !== true
  ));
  const stockCodes = new Set(themes.flatMap((theme) => [
    ...theme.stocks,
    ...(Array.isArray(theme.dailyHeightStocks) ? theme.dailyHeightStocks : []),
  ].map((stock) => stock.code)).filter(Boolean));
  const sourceUpdatedAt = clean(payload && (payload.fetchedAt || payload.updatedAt));
  const generatedAt = clean(options.generatedAt || sourceUpdatedAt || new Date().toISOString());
  const generationId = themeLibraryGenerationId(tradingDate, generatedAt);
  const snapshotKind = clean(options.snapshotKind || payload && payload.archiveMeta && payload.archiveMeta.snapshotKind) || null;
  const exactPreviousLibraryAvailable = Boolean(
    previousDateVerified
    && expectedPreviousTradingDate
    && normalizeTradingDate(options.previousThemeLibrary && options.previousThemeLibrary.tradingDate) === expectedPreviousTradingDate
    && clean(options.previousThemeLibrary && options.previousThemeLibrary.snapshotKind).toLowerCase() === "closing"
    && clean(options.previousThemeLibrary && options.previousThemeLibrary.classifierVersion) === THEME_LIBRARY_CLASSIFIER_VERSION
  );
  const mainThemeDecision = buildMainThemeDecision(themes, options.previousThemeLibrary || null, {
    tradingDate,
    snapshotKind,
    generationId,
    asOf: generatedAt,
    exactPreviousAvailable: exactPreviousLibraryAvailable,
  });
  themes.forEach((theme) => {
    if (
      mainThemeDecision.family
      && clean(theme && (theme.family || theme.name)) === clean(mainThemeDecision.family.name)
    ) theme.globalSubthemeDecision = mainThemeDecision;
  });
  return {
    schemaVersion: THEME_LIBRARY_SCHEMA_VERSION,
    classifierVersion: THEME_LIBRARY_CLASSIFIER_VERSION,
    poolContractVersion: THEME_POOL_CONTRACT_VERSION,
    tradingDate,
    previousTradingDate: previousTradingDate || null,
    previousDateVerified,
    generatedAt,
    marketCycle: marketCycleEvidence(payload, tradingDate, generatedAt),
    generationId,
    sourceUpdatedAt: sourceUpdatedAt || null,
    snapshotKind,
    sourceMode: snapshotSourceMode,
    available: themes.length > 0,
    stale: payload && payload.stale === true,
    mainThemeDecision,
    themeCount: themes.length,
    stockCount: stockCodes.size,
    roleCounts: Object.fromEntries(DISPLAY_ROLE_ORDER.map((role) => [
      role,
      themes.reduce((sum, theme) => sum + Number(theme.roleCounts[role] || 0), 0),
    ])),
    candidateThemePool: {
      version: THEME_POOL_CONTRACT_VERSION,
      source: "theme_library_main",
      available: themes.length > 0,
      hotRankCoverage,
      mainThemeIds: themes.map((theme) => theme.id),
      priorityVerificationThemeIds: priorityVerificationThemes.map((theme) => theme.id),
      confirmationThemeIds,
      retainedObservationThemeIds: retainedObservationThemes.map((theme) => theme.id),
      hotOnlyDiscoveries,
      directExecutionEligible: false,
      guardrails: [
        "题材主池与双榜Top100同时出现时优先验证，但仍不能直接生成交易计划",
        "只在题材主池出现的方向继续观察，不因暂未上热榜直接删除",
        "只在热榜出现的方向进入新方向观察，不得直接执行",
        "全市场风格和全市场情绪必须独立计算，不能由本池反向自证",
      ],
    },
    pools: {
      main: {
        source: "topicBoard.items",
        available: themes.length > 0,
        themeIds: themes.map((theme) => theme.id),
      },
      hotDiscovery: {
        source: "eastmoney_top100+ths_top100",
        available: hotRankCoverage.unionCount > 0,
        coverage: hotRankCoverage,
        themes: hotOnlyDiscoveries,
        directExecutionEligible: false,
      },
    },
    legacyHotThemesIgnoredAsMainPool: legacyHotThemes.map((theme) => clean(theme && theme.name)).filter(Boolean),
    themes,
  };
}

function stockRoleMap(theme) {
  const result = new Map();
  (theme && Array.isArray(theme.stocks) ? theme.stocks : []).forEach((stock) => {
    const labels = (stock.tags || []).map((tag) => clean(tag.label)).filter(Boolean).sort().join("+");
    if (stock.code) result.set(stock.code, labels);
  });
  return result;
}

function compareThemeLibrarySnapshots(current, previous) {
  const currentThemes = Array.isArray(current && current.themes) ? current.themes : [];
  const previousThemes = Array.isArray(previous && previous.themes) ? previous.themes : [];
  const hasPrevious = Boolean(previous && previous.tradingDate);
  const previousById = new Map(previousThemes.map((theme) => [clean(theme.id || theme.family || theme.name), theme]));
  const currentIds = new Set(currentThemes.map((theme) => clean(theme.id || theme.family || theme.name)));
  const themeChanges = currentThemes.map((theme) => {
    const id = clean(theme.id || theme.family || theme.name);
    const prior = previousById.get(id);
    if (!prior) {
      return {
        id,
        name: theme.name,
        isNew: hasPrevious,
        continued: false,
        comparisonUnavailable: !hasPrevious,
        previousRank: null,
        rankChange: null,
        roleChanges: [],
      };
    }
    const currentRoles = stockRoleMap(theme);
    const previousRoles = stockRoleMap(prior);
    const roleChanges = [];
    currentRoles.forEach((roles, code) => {
      const before = previousRoles.get(code);
      if (!before) roleChanges.push({ code, from: null, to: roles, type: "entered" });
      else if (before !== roles) roleChanges.push({ code, from: before, to: roles, type: "changed" });
    });
    previousRoles.forEach((roles, code) => {
      if (!currentRoles.has(code)) roleChanges.push({ code, from: roles, to: null, type: "exited" });
    });
    return {
      id,
      name: theme.name,
      isNew: false,
      continued: true,
      previousRank: Number(prior.rank || 0) || null,
      rankChange: Number(prior.rank || 0) && Number(theme.rank || 0) ? Number(prior.rank) - Number(theme.rank) : 0,
      roleChanges,
    };
  });
  return {
    previousDate: clean(previous && previous.tradingDate) || null,
    exactPreviousAvailable: hasPrevious,
    newThemes: themeChanges.filter((change) => change.isNew).map((change) => change.name),
    continuedThemes: themeChanges.filter((change) => change.continued).map((change) => change.name),
    droppedThemes: hasPrevious
      ? previousThemes.filter((theme) => !currentIds.has(clean(theme.id || theme.family || theme.name))).map((theme) => theme.name)
      : [],
    roleChangeCount: themeChanges.reduce((sum, change) => sum + change.roleChanges.length, 0),
    themeChanges,
  };
}

module.exports = {
  THEME_LIBRARY_SCHEMA_VERSION,
  THEME_LIBRARY_CLASSIFIER_VERSION,
  THEME_POOL_CONTRACT_VERSION,
  SUBTHEME_DECISION_VERSION,
  SUBTHEME_THRESHOLDS,
  HOT_RANK_TARGET,
  ROLE_ORDER,
  DISPLAY_ROLE_ORDER,
  normalizeTradingDate,
  themeLibraryGenerationId,
  themeLibraryTradingDate,
  isVerifiedPioneer,
  isVerifiedDailyLeader,
  isLikelyLimitUp,
  stockMatchesTheme,
  buildThemeLibrarySnapshot,
  buildSubthemeDecision,
  buildMainThemeDecision,
  compareThemeLibrarySnapshots,
  themeCycleEvidence,
};
