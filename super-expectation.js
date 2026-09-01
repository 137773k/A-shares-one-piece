"use strict";

const { isLimitUp, boardHeight } = require("./leader-select");
const { normalizeBigCycle } = require("./quant-decision/market-cycle-contract");

const SUPER_EXPECTATION_VERSION = 3;

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function average(values) {
  const rows = (values || []).filter((value) => Number.isFinite(value));
  if (!rows.length) return null;
  return rows.reduce((sum, value) => sum + value, 0) / rows.length;
}

function median(values) {
  const rows = (values || []).filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
}

function clean(value) {
  return String(value || "").trim();
}

function normalizeTradeDate(value) {
  const text = clean(value);
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const separated = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  return separated ? `${separated[1]}-${separated[2]}-${separated[3]}` : null;
}

function codeOf(stock) {
  return clean(stock && (stock.code || stock.secCode));
}

function unique(rows) {
  return Array.from(new Set((rows || []).map(clean).filter(Boolean)));
}

function limitThreshold(stock) {
  const code = codeOf(stock);
  const name = clean(stock && stock.name);
  if (/(^|[^A-Z])\*?ST/i.test(name)) return 4.7;
  if (/^(300|301|688|689)/.test(code)) return 19.2;
  if (/^(4|8)/.test(code)) return 29.0;
  return 9.55;
}

function reportedBoardHeight(stock) {
  const tag = clean(stock && stock.popularity);
  const continuous = tag.match(/(\d+)\s*连板/);
  if (continuous) return Math.min(Number(continuous[1]), 10);
  const interval = tag.match(/(\d+)\s*天\s*(\d+)\s*板/);
  if (interval) return Math.min(Number(interval[2]), 10);
  if (/首板/.test(tag)) return 1;
  return boardHeight(stock);
}

function directionKeys(stock) {
  return unique([
    stock && stock.mainFamily,
    stock && stock.mainConcept,
    stock && stock.concept,
    ...(Array.isArray(stock && stock.concepts) ? stock.concepts : []),
  ]);
}

function sameDirection(left, right) {
  const leftKeys = directionKeys(left);
  const rightKeys = directionKeys(right);
  return leftKeys.some((leftKey) => rightKeys.some((rightKey) => (
    leftKey === rightKey || leftKey.includes(rightKey) || rightKey.includes(leftKey)
  )));
}

function initiativeSession(stock) {
  const initiative = stock && stock.leadership && stock.leadership.initiative;
  const session = initiative && initiative.session;
  return session && typeof session === "object" ? session : null;
}

function buildCoreGate(stock) {
  const leadership = stock && stock.leadership && typeof stock.leadership === "object"
    ? stock.leadership
    : {};
  const initiative = leadership.initiative && typeof leadership.initiative === "object"
    ? leadership.initiative
    : {};
  const history = leadership.history && typeof leadership.history === "object"
    ? leadership.history
    : {};
  const priceDiscovery = initiative.priceDiscovery && typeof initiative.priceDiscovery === "object"
    ? initiative.priceDiscovery
    : {};
  const structure = leadership.structure && typeof leadership.structure === "object"
    ? leadership.structure
    : {};
  const kline = stock && stock.klineProfile && typeof stock.klineProfile === "object"
    ? stock.klineProfile
    : {};
  const height = reportedBoardHeight(stock);
  const amountYi = finite(stock && stock.amountYi);
  const turnoverRate = finite(stock && stock.turnoverRate);
  const currentPct = finite(stock && stock.changePct);
  const rise10 = finite(kline.rise10);
  const rise20 = finite(kline.rise20);
  const hasRealLiquidity = initiative.capacity === true
    || (amountYi !== null && amountYi >= 10)
    || (turnoverRate !== null && turnoverRate >= 8);
  const currentAttack = initiative.proactive === true && finite(initiative.score) !== null && Number(initiative.score) >= 58;
  const provenImpact = finite(leadership.impactScore) !== null && Number(leadership.impactScore) >= 30;
  const repeatedActiveHistory = Number(history.activeHits || 0) >= 2;
  const heightLeader = (
    height >= 3
    && /龙头|情绪核心/.test(`${clean(stock && stock.role)} ${clean(leadership.identity)} ${clean(leadership.levelLabel)}`)
    && hasRealLiquidity
  );
  // 超预期候选不能被“当前主线”单一标签锁死。高位情绪龙头即使来自
  // 轮动方向，只要历史核心地位、真实换手和主动性曾被验证，仍有资格作为
  // 次日预期差观察对象；这条旁路不赋予直接买入资格。
  const verifiedHeightCore = Boolean(
    leadership.recognized === true
    && leadership.persistentRecognition === true
    && height >= 4
    && /龙头|情绪核心/.test(`${clean(stock && stock.role)} ${clean(leadership.identity)} ${clean(leadership.levelLabel)}`)
    && Number(history.coreHits || 0) >= 2
    && hasRealLiquidity
    && (currentAttack || Number(history.activeHits || 0) >= 1)
  );
  // 历史龙头在大阴分歧日经常失去“当日连板/主动进攻”标签，但这不等于
  // 它的情绪锚点身份消失。仅对“前期有明显上涨 + 当日大阴 + 结构未坏”的
  // 精确场景开放旁路，避免把普通下跌跟随票一起放进来。
  const historicalBearishCore = Boolean(
    leadership.recognized === true
    && leadership.persistentRecognition === true
    && /龙头|情绪\/历史核心|历史核心|情绪核心/.test(
      `${clean(stock && stock.role)} ${clean(leadership.identity)} ${clean(leadership.levelLabel)}`,
    )
    && Number(history.coreHits || 0) >= 1
    && hasRealLiquidity
    && currentPct !== null && currentPct <= -5
    && (rise10 !== null && rise10 >= 12 || rise20 !== null && rise20 >= 25)
    && structure.frameworkIntact === true
    && structure.breakdown !== true
  );
  const identityPassed = leadership.coreIdentityQualified === true || verifiedHeightCore || historicalBearishCore;
  const recognitionPassed = leadership.persistentRecognition === true;
  const influencePassed = currentAttack || provenImpact || repeatedActiveHistory || heightLeader || historicalBearishCore;
  const lockedWithoutDiscovery = priceDiscovery.suspectedOneWord === true
    && Number(history.activeHits || 0) < 2;
  const passed = identityPassed && recognitionPassed && influencePassed && !lockedWithoutDiscovery;

  const evidence = [];
  if (identityPassed) evidence.push(clean(leadership.identity || leadership.levelLabel || "核心身份已验证"));
  if (verifiedHeightCore && leadership.coreIdentityQualified !== true) evidence.push("高位情绪核心：历史地位、真实换手与主动性已验证");
  if (historicalBearishCore) evidence.push("前期龙头大阴分歧：历史地位、前序涨幅与结构完整性已验证");
  if (currentAttack) evidence.push(`当日主动性${Math.round(Number(initiative.score || 0))}/100`);
  if (provenImpact) evidence.push(`真实带动${Math.round(Number(leadership.impactScore || 0))}/100`);
  if (repeatedActiveHistory) evidence.push(`近期开启主动进攻${Number(history.activeHits || 0)}次`);
  if (heightLeader) evidence.push(`${height}板高度且有真实换手`);
  if (initiative.capacity) evidence.push("具备容量承接");

  const fails = [];
  if (!identityPassed) fails.push("没有通过现有核心身份门槛");
  if (!recognitionPassed) fails.push("持续辨识度尚未验证");
  if (!influencePassed) fails.push("缺少主动性、带动性、反复验证或高度换手证据");
  if (lockedWithoutDiscovery) fails.push("一字锁板缺少价格发现，不能仅凭高度入选");

  return {
    passed,
    identityPassed,
    recognitionPassed,
    influencePassed,
    hasRealLiquidity,
    height,
    historicalBearishCore,
    evidence: unique(evidence),
    fails: unique(fails),
  };
}

function findTopicSupport(stock, payload) {
  const candidates = Array.isArray(payload && payload.candidates) ? payload.candidates.filter(Boolean) : [];
  const peers = candidates.filter((peer) => codeOf(peer) !== codeOf(stock) && sameDirection(stock, peer));
  const corePeers = peers.filter((peer) => {
    const leadership = peer && peer.leadership;
    const initiative = leadership && leadership.initiative;
    return leadership && leadership.coreIdentityQualified === true
      || initiative && initiative.proactive === true
      || /龙头|中军|核心/.test(clean(peer && peer.role));
  });
  const positivePeers = peers.filter((peer) => finite(peer && peer.changePct) !== null && Number(peer.changePct) >= 1.5);
  const strongPeers = peers.filter((peer) => finite(peer && peer.changePct) !== null && Number(peer.changePct) >= 5);
  const peerChanges = peers
    .map((peer) => finite(peer && peer.changePct))
    .filter((value) => value !== null);
  const peerMedianChangePct = median(peerChanges);
  const peerAverageChangePct = average(peerChanges);
  const peerDownCount = peerChanges.filter((value) => value < 0).length;
  const peerDownRatio = peerChanges.length ? peerDownCount / peerChanges.length : null;
  const stockKeys = directionKeys(stock);
  const mainLine = payload && payload.topicBoard && payload.topicBoard.mainLine || null;
  const mainLineKeys = unique([
    mainLine && mainLine.name,
    mainLine && mainLine.family,
    mainLine && mainLine.displayName,
    ...(Array.isArray(mainLine && mainLine.matchNames) ? mainLine.matchNames : []),
  ]);
  const mainLineMatch = stockKeys.some((stockKey) => mainLineKeys.some((key) => (
    stockKey === key || stockKey.includes(key) || key.includes(stockKey)
  )));
  const matchedHotConcepts = (Array.isArray(payload && payload.hotConcepts) ? payload.hotConcepts : []).filter((item) => {
    const keys = unique([item && item.name, item && item.family, item && item.displayName]);
    return stockKeys.some((stockKey) => keys.some((key) => (
      stockKey === key || stockKey.includes(key) || key.includes(stockKey)
    )));
  });
  const hotConceptMatch = matchedHotConcepts.length > 0;
  const matchedSectorChange = matchedHotConcepts
    .map((item) => finite(item && item.sector && item.sector.changePct))
    .find((value) => value !== null);
  const mainLineSectorChange = mainLineMatch
    && mainLine && mainLine.sectorName && !/未匹配|待确认/.test(clean(mainLine.sectorName))
    ? finite(mainLine.sectorChangePct)
    : null;
  const sectorChangePct = matchedSectorChange !== undefined
    ? matchedSectorChange
    : mainLineSectorChange;

  let score = 0;
  if (mainLineMatch) score += 35;
  if (hotConceptMatch) score += 15;
  if (corePeers.length >= 2) score += 25;
  else if (corePeers.length === 1) score += 15;
  if (positivePeers.length >= 3) score += 20;
  else if (positivePeers.length >= 1) score += 10;
  if (strongPeers.length >= 2) score += 15;
  else if (strongPeers.length === 1) score += 10;
  score = clamp(score, 0, 100);
  const breadthPassed = strongPeers.length >= 1
    || positivePeers.length >= 2
    || (corePeers.length >= 1 && positivePeers.length >= 1);
  const passed = score >= 35 && breadthPassed;
  const weak = Boolean(
    sectorChangePct !== null && sectorChangePct <= -1.5
    || peerMedianChangePct !== null && peerMedianChangePct <= -1.5
      && peerDownRatio !== null && peerDownRatio >= 0.5
  );
  // 板块当日下跌时不能用“今天有几只上涨”否定次日回流资格。
  // 这里只确认该方向仍有主线/热点身份和真实核心成员，实际回流留到次日再验证。
  const reflowPotential = passed || Boolean(
    (mainLineMatch || hotConceptMatch)
    && (corePeers.length >= 1 || peers.length >= 2)
  );

  return {
    passed,
    reflowPotential,
    weak,
    score,
    direction: stockKeys[0] || "方向待确认",
    mainLineMatch,
    hotConceptMatch,
    peerCount: peers.length,
    corePeerCount: corePeers.length,
    positivePeerCount: positivePeers.length,
    strongPeerCount: strongPeers.length,
    peerMedianChangePct: peerMedianChangePct === null ? null : round1(peerMedianChangePct),
    peerAverageChangePct: peerAverageChangePct === null ? null : round1(peerAverageChangePct),
    peerDownRatio: peerDownRatio === null ? null : round1(peerDownRatio),
    sectorChangePct: sectorChangePct === null ? null : round1(sectorChangePct),
    corePeerNames: unique(corePeers.map((peer) => clean(peer.name))).slice(0, 5),
    positivePeerNames: unique(positivePeers.map((peer) => clean(peer.name))).slice(0, 5),
    note: passed && score >= 60
      ? "板块核心与赚钱效应提供了明确支撑"
      : passed
        ? "存在板块支撑，但次日仍需确认回流强度"
        : "当前只有个股辨识度或静态主线标签，缺少同方向真实响应",
  };
}

function marketWeaknessContext(payload) {
  const market = payload && payload.market || {};
  const state = market.state || {};
  const dailyState = state.dailyState || {};
  const snapshot = market.snapshot || {};
  const profitScore = finite(state.profitEffect && state.profitEffect.score);
  const lossScore = finite(state.lossEffect && state.lossEffect.score);
  const avgIndexChange = finite(snapshot.avgIndexChange);
  const rawBreadth = finite(snapshot.breadth);
  const breadth = rawBreadth !== null && rawBreadth > 1 ? rawBreadth / 100 : rawBreadth;
  const dailyKey = clean(dailyState.key);
  const weak = Boolean(
    ["retreat_candidate", "ice_point"].includes(dailyKey)
    || avgIndexChange !== null && avgIndexChange <= -0.6
    || breadth !== null && breadth <= 0.38
    || lossScore !== null && lossScore >= 58
      && (profitScore === null || lossScore >= profitScore + 12)
  );
  const evidence = [];
  if (dailyState.label) evidence.push(`市场状态：${clean(dailyState.label)}`);
  if (avgIndexChange !== null) evidence.push(`主要指数均值${avgIndexChange >= 0 ? "+" : ""}${round1(avgIndexChange)}%`);
  if (breadth !== null) evidence.push(`上涨占比${Math.round(breadth * 100)}%`);
  if (profitScore !== null && lossScore !== null) evidence.push(`赚钱效应${round1(profitScore)} / 亏钱效应${round1(lossScore)}`);
  return {
    weak,
    dailyKey,
    label: clean(dailyState.label || state.subPhase || state.cycle || "市场状态待确认"),
    profitScore,
    lossScore,
    avgIndexChange,
    breadth,
    evidence,
  };
}

function tradingDateFromPayload(payload) {
  return normalizeTradeDate(
    payload && payload.market && payload.market.limitStats
    && payload.market.limitStats.dates && payload.market.limitStats.dates.today,
  );
}

function previousTradingDateFromPayload(payload) {
  return normalizeTradeDate(
    payload && payload.market && payload.market.limitStats
    && payload.market.limitStats.dates && payload.market.limitStats.dates.prev,
  );
}

function mainRiseContext(payload) {
  const state = payload && payload.market && payload.market.state || {};
  const cycle = clean(state.cycle);
  const subPhase = clean(state.subPhase);
  return {
    active: /主升|上升/.test(`${cycle} ${subPhase}`),
    cycle,
    subPhase,
  };
}

/**
 * 把T日事实先压成一个互斥状态，再决定T+1走哪条验证路线。
 * 关键约束：全天振幅不是炸板；历史板高也不是当天断板。
 */
function classifyPreviousDayState(stock, payload = null) {
  const session = initiativeSession(stock);
  const leadership = stock && stock.leadership || {};
  const initiative = leadership.initiative || {};
  const structure = leadership.structure || {};
  const history = leadership.history || {};
  const kline = stock && stock.klineProfile || {};
  const currentPct = finite(stock && stock.changePct);
  const threshold = limitThreshold(stock);
  const closedAtLimit = isLimitUp(stock);
  const height = reportedBoardHeight(stock);
  const maxPct = finite(session && session.maxChangePct);
  const touchedLimit = session && session.limitTouched === true
    || maxPct !== null && maxPct >= threshold;
  const explicitBroken = /炸板|断板/.test(clean(stock && stock.popularity));
  const explicitMessy = /烂板/.test(clean(stock && stock.popularity));
  const limitOpenCount = finite(session && session.limitOpenCount);
  const longestOpenMinutes = finite(session && session.longestOpenMinutes);
  const finalSealMinutes = finite(session && session.finalSealMinutes);
  const sequenceKnown = Boolean(session && (
    Object.prototype.hasOwnProperty.call(session, "limitOpenCount")
    || session.firstLimitTime
  ));
  const openedAfterTouch = Boolean(
    limitOpenCount !== null && limitOpenCount > 0
    || session && session.resealedAfterOpen === true,
  );
  const resealedAfterOpen = Boolean(
    closedAtLimit
    && openedAfterTouch
    && (session && session.resealedAfterOpen === true || session && session.lastResealTime),
  );
  const retentionPct = finite(initiative.retentionPct);
  const quickReseal = Boolean(
    resealedAfterOpen
    && longestOpenMinutes !== null && longestOpenMinutes <= 5
    && (finalSealMinutes === null || finalSealMinutes >= 20)
    && initiative.proactive === true
    && Number(initiative.score || 0) >= 58
    && (retentionPct === null || retentionPct >= 70)
  );
  const sourceTradeDate = normalizeTradeDate(session && session.tradingDate) || tradingDateFromPayload(payload);
  const previousTradeDate = previousTradingDateFromPayload(payload);
  const previousLimitUpEvidence = stock && stock.previousLimitUpEvidence
    && typeof stock.previousLimitUpEvidence === "object"
    ? stock.previousLimitUpEvidence
    : null;
  const previousLimitUpTradeDate = normalizeTradeDate(
    previousLimitUpEvidence && previousLimitUpEvidence.tradingDate,
  );
  const exactPreviousLimitUp = Boolean(
    previousLimitUpEvidence
    && (
      previousLimitUpEvidence.verified === true
      || previousLimitUpEvidence.status === "verified" && previousLimitUpEvidence.exactClosing === true
    )
    && previousTradeDate
    && previousLimitUpTradeDate === previousTradeDate
    && previousLimitUpEvidence.closedAtLimit === true
  );
  const previousBoardHadPriceDiscovery = Boolean(
    previousLimitUpEvidence
    && previousLimitUpEvidence.priceDiscoveryVerified === true
    && previousLimitUpEvidence.noPriceDiscovery !== true
    && previousLimitUpEvidence.suspectedOneWord !== true
    && previousLimitUpEvidence.oneWord !== true
  );
  const currentStructureIntact = structure.frameworkIntact === true
    && structure.breakdown !== true;

  if (
    closedAtLimit
    && !explicitMessy
    && !explicitBroken
    && (sequenceKnown && limitOpenCount === 0 || !sequenceKnown)
  ) {
    return {
      key: "stable_strong",
      label: "正常强势延续",
      category: "strong",
      routeKey: "normal_strong",
      sourceTradeDate,
      reason: session && session.firstLimitTime
        ? `${session.firstLimitTime}主动封板，触板后没有开板`
        : "收盘封住涨停，且没有触板后开板或烂板证据",
      evidence: unique([
        initiative.proactive === true ? `主动性${Math.round(Number(initiative.score || 0))}/100` : "",
        limitOpenCount === 0 ? "触板后开板0次" : "",
      ]),
      pattern: null,
    };
  }

  if (closedAtLimit && quickReseal) {
    const baseline = strongOnStrongBaseline(stock);
    return {
      key: "strong_reseal",
      label: "分歧秒回封·仍属强势",
      category: "strong",
      routeKey: "strong_on_strong",
      sourceTradeDate,
      reason: `触板后开板${Math.round(limitOpenCount || 1)}次，最长${round1(longestOpenMinutes)}分钟即回封，最终强度保留`,
      evidence: unique([
        session && session.lastResealTime ? `${session.lastResealTime}完成最后回封` : "快速回封",
        finalSealMinutes !== null ? `尾盘连续封板${Math.round(finalSealMinutes)}分钟` : "",
        retentionPct !== null ? `冲高强度保留${round1(retentionPct)}%` : "",
      ]),
      baseline,
      pattern: null,
    };
  }

  // 只有当前交易日确实触板未封住，或当前标签明确写着炸板/断板，
  // 才能冻结弱转强基线；绝不再用历史板高单独推断当天断板。
  if (!closedAtLimit && (touchedLimit || explicitBroken || session && session.firstLimitTime)) {
    const pattern = {
      key: "failed_board",
      label: height >= 3 ? `${height}板高位炸板/断板` : "核心炸板",
      severity: height >= 5 ? 100 : height >= 3 ? 88 : 75,
      expectedOpenRangePct: height >= 5 ? [-6, -2] : [-4, -1],
      overExpectedOpenPct: height >= 5 ? -1 : 0,
      normalPath: "正常预期是低开释放抛压，开盘先承受兑现与恐慌盘。",
      reason: touchedLimit ? "盘中触及涨停但未能封住" : "行情标签显示炸板或断板",
    };
    return {
      key: "weak_baseline",
      label: pattern.label,
      category: "weak",
      routeKey: "weak_to_strong",
      sourceTradeDate,
      reason: pattern.reason,
      evidence: unique([pattern.reason]),
      pattern,
    };
  }

  // 反复开板、长时间不能回封或只有文本烂板标签时，最终虽封住也仍是弱基线。
  // 注意：全日从低位拉到涨停造成的大振幅，不属于这里。
  if (closedAtLimit && (openedAfterTouch || explicitMessy || explicitBroken)) {
    const pattern = {
      key: "weak_reseal",
      label: "烂板换手/分歧回封",
      severity: height >= 4 ? 78 : 68,
      expectedOpenRangePct: [-2, 1],
      overExpectedOpenPct: 1.5,
      normalPath: "烂板回封后正常预期是次日先兑现，只有继续主动加强才算超预期。",
      reason: explicitMessy || explicitBroken
        ? "行情标签显示当日烂板/炸板后回封"
        : `触板后开板${Math.round(limitOpenCount || 1)}次，回封速度或封板质量未达到强势标准`,
    };
    return {
      key: "weak_baseline",
      label: pattern.label,
      category: "weak",
      routeKey: "weak_to_strong",
      sourceTradeDate,
      reason: pattern.reason,
      evidence: unique([pattern.reason]),
      pattern,
    };
  }

  // 精确T-1收盘涨停后的T日回撤只冻结为弱基线，不直接授予买点。
  // 日期、收盘封板、价格发现与当前结构任一项缺失都失败关闭；个股究竟是
  // 主动弱还是被环境拖累，继续交由 classifyExpectationPath 统一判断。
  if (
    !closedAtLimit
    && currentPct !== null && currentPct < 0
    && exactPreviousLimitUp
    && previousBoardHadPriceDiscovery
    && currentStructureIntact
  ) {
    const pattern = {
      key: "limit_up_pullback_repair",
      label: "前板回撤·待纠偏",
      severity: 60,
      expectedOpenRangePct: [-2, 1],
      overExpectedOpenPct: 1.5,
      normalPath: "前板回撤后的正常预期仍是延续分歧；只有次日竞价、承接、主动性与板块响应共同确认，才进入弱转强验证，不能因前一日涨停直接当作买点。",
      reason: `${previousLimitUpTradeDate}精确收盘涨停且存在价格发现，今日收跌${round1(Math.abs(currentPct))}%，当前关键结构尚未破坏`,
    };
    return {
      key: "weak_baseline",
      label: pattern.label,
      category: "weak",
      routeKey: "weak_to_strong",
      sourceTradeDate,
      reason: pattern.reason,
      evidence: unique([
        pattern.reason,
        "T-1收盘涨停证据已核验",
        "T-1存在价格发现，排除一字锁板",
        "当前关键结构未破坏",
      ]),
      pattern,
    };
  }

  const rise10 = finite(kline.rise10);
  const rise20 = finite(kline.rise20);
  const pctFromHigh = finite(kline.pctFromHigh);
  const priorRun = Boolean(
    rise10 !== null && rise10 >= 12
    || rise20 !== null && rise20 >= 25
    || kline.nearHigh20 === true && (pctFromHigh === null || pctFromHigh <= 22)
  );
  const historicalCore = Boolean(
    leadership.recognized === true
    && leadership.persistentRecognition === true
    && /龙头|情绪\/历史核心|历史核心|情绪核心/.test(
      `${clean(stock && stock.role)} ${clean(leadership.identity)} ${clean(leadership.levelLabel)}`,
    )
    && (Number(history.coreHits || 0) >= 1 || Number(history.activeHits || 0) >= 1 || Number(leadership.impactScore || 0) >= 30)
  );
  if (
    !closedAtLimit
    && currentPct !== null && currentPct <= -5
    && priorRun && historicalCore
    && structure.frameworkIntact === true && structure.breakdown !== true
  ) {
    const pattern = {
      key: "core_bearish_divergence",
      label: "前期龙头大阴分歧",
      severity: currentPct <= -8 ? 92 : 72,
      expectedOpenRangePct: currentPct <= -8 ? [-5, -2] : [-3, 0],
      overExpectedOpenPct: currentPct <= -8 ? -1 : 0.5,
      normalPath: "前期龙头大阴分歧后，正常预期是继续释放兑现；只有次日明显高于弱势预期并重新带动板块，才叫弱转强。",
      reason: `前期累计涨幅仍在，今日收跌${round1(Math.abs(currentPct))}%，但核心身份与关键结构尚未破坏`,
    };
    return {
      key: "weak_baseline",
      label: pattern.label,
      category: "weak",
      routeKey: "weak_to_strong",
      sourceTradeDate,
      reason: pattern.reason,
      evidence: unique([
        pattern.reason,
        rise10 !== null ? `近10日仍涨${round1(rise10)}%` : "",
        rise20 !== null ? `近20日仍涨${round1(rise20)}%` : "",
      ]),
      pattern,
    };
  }

  if (currentPct !== null && currentPct < 0) {
    return {
      key: "ordinary_weak",
      label: "普通走弱·无转强基线",
      category: "none",
      routeKey: "none",
      sourceTradeDate,
      reason: "今天没有发生紧邻T-1的烂板、炸板、断板或前期龙头大阴分歧",
      evidence: [],
      pattern: null,
    };
  }

  return {
    key: "no_clear_state",
    label: "没有形成预期差",
    category: "none",
    routeKey: "none",
    sourceTradeDate,
    reason: "今天既不是需要纠偏的弱势，也不是可验证强转强的分歧回封",
    evidence: [],
    pattern: null,
  };
}

function detectExpectationPattern(stock, payload = null) {
  const state = classifyPreviousDayState(stock, payload);
  return state && state.pattern || null;
}

function strongOnStrongBaseline(stock) {
  const currentPct = finite(stock && stock.changePct) || 0;
  const threshold = limitThreshold(stock);
  const boardFactor = threshold >= 29 ? 1.7 : threshold >= 19 ? 1.4 : 1;
  const closedAtLimit = isLimitUp(stock);
  let expectedLow = 1;
  let expectedHigh = 2.5;
  let overExpectedOpenPct = 4;
  if (closedAtLimit || currentPct >= threshold * 0.72) {
    expectedLow = 2.5;
    expectedHigh = 5;
    overExpectedOpenPct = 6;
  } else if (currentPct >= 3) {
    expectedLow = 1.5;
    expectedHigh = 3.5;
    overExpectedOpenPct = 4.8;
  }
  return {
    expectedOpenRangePct: [round1(expectedLow * boardFactor), round1(expectedHigh * boardFactor)],
    overExpectedOpenPct: round1(overExpectedOpenPct * boardFactor),
  };
}

function classifyExpectationPath(stock, payload, topicSupport = null) {
  const sector = topicSupport || findTopicSupport(stock, payload);
  const previousState = classifyPreviousDayState(stock, payload);
  const pattern = previousState.pattern;
  const leadership = stock && stock.leadership || {};
  const initiative = leadership.initiative || {};
  const structure = leadership.structure || {};
  const session = initiativeSession(stock);
  const market = marketWeaknessContext(payload);
  const currentPct = finite(stock && stock.changePct);
  const relativeStrength = finite(initiative.relativeStrength);
  const peerMedianChangePct = finite(initiative.peerMedianChangePct) !== null
    ? finite(initiative.peerMedianChangePct)
    : finite(sector.peerMedianChangePct);
  const retentionPct = finite(initiative.retentionPct);
  const flow = stock && stock.flowNature || {};
  const flowConfidence = finite(flow.confidence) || 0;
  const environmentWeak = market.weak || sector.weak;
  const mainRise = mainRiseContext(payload);
  const payloadTradingDate = tradingDateFromPayload(payload);
  const staleDailyState = Boolean(
    payloadTradingDate
    && previousState.sourceTradeDate
    && previousState.sourceTradeDate !== payloadTradingDate
  );
  const structureBroken = structure.breakdown === true
    || structure.frameworkIntact === false && currentPct !== null && currentPct <= -3;
  const independentUnderperformance = relativeStrength !== null && relativeStrength <= -2;
  const retentionCollapsed = retentionPct !== null && retentionPct < 35;
  const confirmedEscape = flow.key === "escape" && flowConfidence >= 0.68 && flow.conflict !== true;
  const flowEscapeBlocks = confirmedEscape && !(pattern && pattern.key === "limit_up_pullback_repair");
  const failedAgainstEnvironment = Boolean(
    pattern
    && !environmentWeak
    && currentPct !== null && currentPct <= -3
    && independentUnderperformance
  );
  const activeWeak = Boolean(
    flowEscapeBlocks
    || structureBroken && independentUnderperformance
    || independentUnderperformance && retentionCollapsed
    || failedAgainstEnvironment
  );
  const evidence = [];

  if (market.weak) evidence.push(`大盘偏弱：${market.evidence.join("，") || market.label}`);
  if (sector.weak) {
    if (sector.sectorChangePct !== null) evidence.push(`板块下跌${round1(Math.abs(sector.sectorChangePct))}%`);
    else if (sector.peerMedianChangePct !== null) evidence.push(`同方向中位涨幅${sector.peerMedianChangePct > 0 ? "+" : ""}${sector.peerMedianChangePct}%`);
  }
  if (relativeStrength !== null) {
    evidence.push(`个股相对方向${relativeStrength >= 0 ? "领先" : "落后"}${round1(Math.abs(relativeStrength))}个百分点`);
  } else if (currentPct !== null && peerMedianChangePct !== null) {
    const relative = currentPct - peerMedianChangePct;
    evidence.push(`个股相对方向${relative >= 0 ? "领先" : "落后"}${round1(Math.abs(relative))}个百分点`);
  }
  if (retentionPct !== null) evidence.push(`冲高强度保留${round1(retentionPct)}%`);
  if (structure.frameworkIntact === true) evidence.push("关键成本与筹码框架尚未破坏");
  if (initiative.proactive === true) evidence.push(`主动性${Math.round(Number(initiative.score || 0))}/100`);
  if (confirmedEscape && !flowEscapeBlocks) evidence.push("资金出逃仅作风险备注，不否决前板回撤观察");

  const activeWeakEvidence = [];
  if (flowEscapeBlocks) activeWeakEvidence.push("多维资金证据确认资金出逃");
  if (structureBroken) activeWeakEvidence.push("关键结构已经破坏");
  if (independentUnderperformance) activeWeakEvidence.push(`相对方向落后${round1(Math.abs(relativeStrength))}个百分点`);
  if (retentionCollapsed) activeWeakEvidence.push(`冲高强度只保留${round1(retentionPct)}%`);
  if (failedAgainstEnvironment) activeWeakEvidence.push("板块没有同步杀跌，个股却独立走弱");

  if (staleDailyState) {
    return {
      qualified: false,
      key: "stale_daily_state",
      label: "旧交易日状态·已过期",
      routeKey: "none",
      routeLabel: "不生成跨日预案",
      severity: 0,
      expectedOpenRangePct: null,
      overExpectedOpenPct: null,
      normalPath: "超预期基线只允许来自当前收盘交易日，不能继承更早交易日的强弱标签。",
      reason: `分时状态属于${previousState.sourceTradeDate}，当前快照属于${payloadTradingDate}`,
      evidence: unique(previousState.evidence),
      patternKey: pattern && pattern.key || null,
      patternLabel: pattern && pattern.label || null,
      environmentWeak,
      market,
    };
  }

  if (previousState.key === "stable_strong") {
    return {
      qualified: false,
      key: "stable_strong",
      label: "正常强势延续",
      routeKey: "normal_strong",
      routeLabel: "正常强势观察",
      severity: 0,
      expectedOpenRangePct: null,
      overExpectedOpenPct: null,
      normalPath: "今天本身就是主动强势，不存在需要从弱转强的负面预期差。",
      reason: previousState.reason,
      evidence: unique([...previousState.evidence, ...evidence]),
      patternKey: null,
      patternLabel: null,
      environmentWeak,
      market,
    };
  }

  if (activeWeak) {
    return {
      qualified: false,
      key: "active_weak",
      label: "主动弱·淘汰",
      routeKey: "none",
      routeLabel: "不做超预期预案",
      severity: 0,
      expectedOpenRangePct: null,
      overExpectedOpenPct: null,
      normalPath: "主动弱不是单纯被市场带下去，而是个股自身承接、结构或资金性质已经转差。",
      reason: activeWeakEvidence.join("；") || "个股自身弱于环境，不能等待市场替它纠偏",
      evidence: unique([...activeWeakEvidence, ...evidence]),
      patternKey: pattern && pattern.key || null,
      patternLabel: pattern && pattern.label || null,
      environmentWeak,
      market,
    };
  }

  if (previousState.key === "strong_reseal") {
    if (mainRise.active) {
      const baseline = previousState.baseline || strongOnStrongBaseline(stock);
      return {
        qualified: true,
        key: "main_rise_strong_reseal",
        label: "主升分歧回封·等强转强",
        routeKey: "strong_on_strong",
        routeLabel: "强转强路线",
        severity: clamp(Math.round(
          72
          + (initiative.proactive === true ? 10 : 0)
          + (retentionPct !== null && retentionPct >= 80 ? 8 : 0)
        ), 0, 100),
        expectedOpenRangePct: baseline.expectedOpenRangePct,
        overExpectedOpenPct: baseline.overExpectedOpenPct,
        normalPath: "今天虽然开过板，但快速回封且最终仍强；主升分歧后的正常预期约为中等高开，只有明显高于该区间并继续主动带动才叫强转强。",
        reason: `${previousState.reason}；${mainRise.cycle || mainRise.subPhase || "主升环境"}允许验证强转强`,
        evidence: unique([...previousState.evidence, ...evidence]),
        patternKey: "strong_reseal",
        patternLabel: "分歧秒回封",
        environmentWeak,
        market,
      };
    }
    return {
      qualified: false,
      key: "strong_reseal_watch",
      label: "分歧回封·仍属强势",
      routeKey: "normal_strong",
      routeLabel: "正常强势观察",
      severity: 0,
      expectedOpenRangePct: null,
      overExpectedOpenPct: null,
      normalPath: "回封质量本身不弱，但当前不是主升/主升分歧环境，不把它机械升级为强转强交易预案。",
      reason: previousState.reason,
      evidence: unique([...previousState.evidence, ...evidence]),
      patternKey: "strong_reseal",
      patternLabel: "分歧秒回封",
      environmentWeak,
      market,
    };
  }

  if (pattern) {
    const passive = environmentWeak;
    return {
      qualified: true,
      key: passive ? "passive_weak" : "divergence_weak",
      label: passive ? "被动弱·等纠偏" : "分歧弱·等弱转强",
      routeKey: "weak_to_strong",
      routeLabel: "弱转强路线",
      severity: pattern.severity,
      expectedOpenRangePct: pattern.expectedOpenRangePct,
      overExpectedOpenPct: pattern.overExpectedOpenPct,
      normalPath: passive
        ? `${pattern.normalPath} 但本次弱势与大盘或板块同步，次日重点看回流纠偏，而不是把下跌直接定性为个股走坏。`
        : pattern.normalPath,
      reason: passive
        ? `${pattern.label}发生在弱势环境中，且没有确认个股独立走坏`
        : `${pattern.label}形成负面基线，但尚未出现主动走坏证据`,
      evidence: unique([...(previousState.evidence || []), pattern.reason, ...evidence]),
      patternKey: pattern.key,
      patternLabel: pattern.label,
      environmentWeak,
      market,
    };
  }

  const inferredRelative = relativeStrength !== null
    ? relativeStrength
    : currentPct !== null && peerMedianChangePct !== null
      ? currentPct - peerMedianChangePct
      : null;
  const relativeLead = inferredRelative !== null && inferredRelative >= 2;
  const closingResilience = Boolean(
    currentPct !== null && currentPct >= 0
    || retentionPct !== null && retentionPct >= 55
    || initiative.proactive === true && Number(initiative.score || 0) >= 58
    || session && finite(session.currentChangePct) !== null && Number(session.currentChangePct) >= 0
  );
  const structureIntact = structure.frameworkIntact === true && structure.breakdown !== true;
  const weakMarketResilient = environmentWeak && relativeLead && closingResilience && structureIntact;

  if (weakMarketResilient) {
    const baseline = strongOnStrongBaseline(stock);
    const weakSide = [
      market.weak ? market.label : "",
      sector.weak ? `${sector.direction}走弱` : "",
    ].filter(Boolean).join("、") || "弱势环境";
    return {
      qualified: true,
      key: "weak_market_resilient",
      label: "弱市抗跌·等强转强",
      routeKey: "strong_on_strong",
      routeLabel: "强转强路线",
      severity: clamp(Math.round(
        62
        + Math.min(18, Math.max(0, inferredRelative) * 3)
        + (initiative.proactive === true ? 10 : 0)
        + (retentionPct !== null && retentionPct >= 70 ? 8 : 0)
      ), 0, 100),
      expectedOpenRangePct: baseline.expectedOpenRangePct,
      overExpectedOpenPct: baseline.overExpectedOpenPct,
      normalPath: "今天已经在弱势环境中证明不弱，明天普通翻红不算超预期；只有明显高开、接住抛压并继续主动带动，才算强转强。",
      reason: `${weakSide}时个股仍保持承接，并显著强于同方向`,
      evidence: unique(evidence),
      patternKey: null,
      patternLabel: null,
      environmentWeak,
      market,
    };
  }

  const reason = environmentWeak
    ? structureIntact
      ? "处在弱势环境中，但相对强度或收盘承接不足，尚不能定义为弱市抗跌"
      : "处在弱势环境中，但个股关键结构不完整，不能只因少跌或拉红进入强转强"
    : "今天既没有形成可纠偏的弱势预期，也没有弱市抗跌形成的强基础";
  return {
    qualified: false,
    key: "no_clear_path",
    label: "预期路径不清",
    routeKey: "none",
    routeLabel: "暂不制定超预期预案",
    severity: 0,
    expectedOpenRangePct: null,
    overExpectedOpenPct: null,
    normalPath: "没有清晰的正常预期，就无法判断明天究竟超出了什么。",
    reason,
    evidence: unique(evidence),
    patternKey: null,
    patternLabel: null,
    environmentWeak,
    market,
  };
}

function buildCandidate(stock, payload) {
  const core = buildCoreGate(stock);
  const sector = findTopicSupport(stock, payload);
  const expectation = classifyExpectationPath(stock, payload, sector);
  const leadership = stock && stock.leadership || {};
  const initiative = leadership.initiative || {};
  const structure = leadership.structure || {};
  const session = initiativeSession(stock);
  const stateSourceTradeDate = normalizeTradeDate(session && session.tradingDate)
    || tradingDateFromPayload(payload);
  const sectorPotentialPassed = sector.reflowPotential || Boolean(
    expectation.qualified
    && core.height >= 3
    && sector.hotConceptMatch
  );
  if (!core.passed || !expectation.qualified || !sectorPotentialPassed) {
    const fails = unique([
      ...core.fails,
      ...(!expectation.qualified ? [expectation.reason] : []),
      ...(!sectorPotentialPassed ? ["所属方向缺少板块支撑或回流预期"] : []),
    ]);
    const gates = [
      {
        key: "core",
        label: "核心地位",
        passed: core.passed,
        note: core.passed
          ? core.evidence.join("；") || "核心身份已验证"
          : core.fails.join("；") || "核心证据不足",
      },
      {
        key: "expectation",
        label: "今日强弱性质",
        passed: expectation.qualified,
        note: `${expectation.label}：${expectation.reason}`,
      },
      {
        key: "sector",
        label: "板块基础/回流",
        passed: sectorPotentialPassed,
        note: sectorPotentialPassed
          ? sector.passed ? sector.note : "方向仍有核心与回流基础，次日必须用实际响应确认"
          : sector.note,
      },
    ];
    return {
      qualified: false,
      screenedCore: Boolean(stock && stock.leadership && stock.leadership.coreIdentityQualified === true),
      code: codeOf(stock),
      name: clean(stock && stock.name) || codeOf(stock),
      direction: sector.direction || directionKeys(stock)[0] || "方向待确认",
      role: clean(stock && stock.role || stock && stock.leadership && stock.leadership.identity || "核心观察"),
      today: {
        changePct: finite(stock && stock.changePct),
        popularity: clean(stock && stock.popularity),
        boardHeight: core.height,
        stateSourceTradeDate,
        strengthNatureKey: expectation.key,
        strengthNatureLabel: expectation.label,
        strengthEvidence: expectation.evidence,
      },
      passedGateCount: gates.filter((gate) => gate.passed).length,
      gates,
      fails,
    };
  }

  const currentPct = finite(stock && stock.changePct);
  const referencePrice = finite(stock && (stock.price || stock.close || stock.lastPrice));
  const priorityScore = clamp(Math.round(
    0.34 * expectation.severity
    + 0.25 * sector.score
    + 0.18 * Number(initiative.score || 0)
    + 0.13 * Number(leadership.impactScore || 0)
    + 0.10 * (structure.frameworkIntact ? 100 : 45)
  ), 0, 100);
  const priority = priorityScore >= 82 ? "S" : priorityScore >= 68 ? "A" : "B";
  const overExpectedPrice = referencePrice !== null
    ? round1(referencePrice * (1 + expectation.overExpectedOpenPct / 100))
    : null;
  const strongOnStrong = expectation.routeKey === "strong_on_strong";

  return {
    qualified: true,
    code: codeOf(stock),
    name: clean(stock && stock.name) || codeOf(stock),
    direction: sector.direction,
    role: clean(stock && stock.role || leadership.identity || "核心"),
    priority,
    priorityScore,
    candidateState: `${expectation.routeLabel}·待验证`,
    today: {
      changePct: currentPct,
      price: referencePrice,
      boardHeight: core.height,
      stateSourceTradeDate,
      patternKey: expectation.patternKey,
      patternLabel: expectation.patternLabel,
      strengthNatureKey: expectation.key,
      strengthNatureLabel: expectation.label,
      strengthEvidence: expectation.evidence,
      reason: expectation.reason,
    },
    core: {
      identity: clean(leadership.identity || leadership.levelLabel || "核心身份"),
      level: clean(leadership.level || ""),
      initiativeScore: finite(initiative.score),
      impactScore: finite(leadership.impactScore),
      evidence: core.evidence,
    },
    sector: {
      ...sector,
      potentialPassed: sectorPotentialPassed,
      responsePending: !sector.passed,
      note: sector.passed
        ? sector.note
        : "方向仍有核心与回流基础，但今天尚未形成真实响应；次日必须看到同方向核心跟随，否则只算孤立脉冲。",
    },
    baseline: {
      routeKey: expectation.routeKey,
      routeLabel: expectation.routeLabel,
      sourceTradeDate: stateSourceTradeDate,
      validForTradeDate: null,
      validityRule: "next_trading_day_only",
      todayNatureKey: expectation.key,
      todayNatureLabel: expectation.label,
      expectedOpenRangePct: expectation.expectedOpenRangePct,
      overExpectedOpenPct: expectation.overExpectedOpenPct,
      overExpectedPrice,
      normalPath: expectation.normalPath,
      comparisonText: `明日正常预期${expectation.expectedOpenRangePct[0]}%～${expectation.expectedOpenRangePct[1]}%；若竞价不低于${expectation.overExpectedOpenPct > 0 ? "+" : ""}${expectation.overExpectedOpenPct}%才进入${expectation.routeLabel}验证。`,
    },
    nextDayChecks: strongOnStrong ? [
      {
        stage: "9:25 强竞价",
        condition: `开盘不低于+${expectation.overExpectedOpenPct}%，竞价量有效；普通红开不算超预期`,
      },
      {
        stage: "9:30—9:35 接住高开",
        condition: "不快速回补高开缺口，不跌回普通强势区；高开后仍有主动买盘承接",
      },
      {
        stage: "第一次分歧",
        condition: "回踩缩量且保留大部分强度，随后二次放量进攻；高开低走不算强转强",
      },
      {
        stage: "板块响应",
        condition: `观察${sector.corePeerNames.join("、") || sector.positivePeerNames.join("、") || "同方向核心"}是否被带动，确认个股仍有主动性而非独立冲高`,
      },
    ] : [
      {
        stage: "9:25 竞价",
        condition: `开盘不低于${expectation.overExpectedOpenPct > 0 ? "+" : ""}${expectation.overExpectedOpenPct}%，且竞价成交不是无量虚强`,
      },
      {
        stage: "9:30—9:35 承接",
        condition: "不快速补跌，能够翻红或收回关键位置；下杀后有真实承接",
      },
      {
        stage: "第一次回踩",
        condition: "缩量守住开盘价、昨收或分时均价中的有效支撑，再出现二次放量进攻",
      },
      {
        stage: "板块确认",
        condition: `观察${sector.corePeerNames.join("、") || sector.positivePeerNames.join("、") || "同方向核心"}是否同步转强，确认是主动带动而非孤立脉冲`,
      },
    ],
    invalidation: strongOnStrong
      ? "竞价只达到普通强势区、开盘快速回补高开缺口、板块核心不跟或个股失去主动性，立即取消强转强资格。"
      : "竞价直接落回正常弱势区、开盘快速补跌、板块核心不跟或个股失去主动性，立即取消弱转强资格。",
    risk: structure.overextended
      ? "当前处于高位加速区；即使次日超预期，也要防止加强直接转为高潮兑现。"
      : strongOnStrong
        ? "今天已经不弱，明天高开只是第一步；必须防止强转强变成高开兑现，不能只看竞价涨幅。"
      : structure.frameworkIntact
        ? "整体结构尚未严重破坏，但仍需次日确认资金承接。"
        : "核心身份成立但结构偏弱，超预期优先按修复处理，不直接当作新主升。",
  };
}

function rankCandidate(left, right) {
  if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore;
  if (right.today.boardHeight !== left.today.boardHeight) return right.today.boardHeight - left.today.boardHeight;
  return clean(left.code).localeCompare(clean(right.code), "zh-CN");
}

function actionPlan(nature, status, current, candidate) {
  const leadership = current && current.leadership || {};
  const initiative = leadership.initiative || {};
  const capacity = initiative.capacity === true;
  const height = reportedBoardHeight(current);
  const confirmed = status === "confirmed";
  const failed = status === "failed";
  const strongOnStrong = candidate && candidate.baseline
    && candidate.baseline.routeKey === "strong_on_strong";

  if (failed) {
    return {
      holder: {
        action: "超预期失效：减仓或退出",
        now: "不再按照超预期计划格局；先判断是个股掉队还是板块整体转弱。",
        addCondition: "禁止加仓。",
        sellCondition: "跌回正常弱势区、反抽不能收回关键承接位，或板块核心同步转弱时卖出。",
      },
      outsider: {
        action: "取消买入",
        preferredEntry: "无",
        routes: [],
        skipReason: "实际走势没有超过昨日正常预期，不能把普通反抽当作超预期。",
      },
    };
  }

  if (nature.key === "repair") {
    return {
      holder: {
        action: confirmed ? "持有观察，板块不跟则冲高兑现" : "先观察，不加仓",
        now: "当前更像负反馈后的修复，不把一次拉升直接定义为新行情。",
        addCondition: "只有板块核心同步转强、第一次回踩承接成功并二次主动进攻，才重新评估加仓。",
        sellCondition: "个股冲高但板块没有响应，或同板块核心更强而本票转为被动时，按强势兑现。",
      },
      outsider: {
        action: "不追第一波，只等回踩确认",
        preferredEntry: "首次回踩承接",
        routes: [{
          key: "pullback",
          label: "回踩承接",
          condition: "翻红后首次回踩缩量，不破有效支撑；二次放量进攻且板块开始跟随。",
        }],
        skipReason: "如果始终只有单票强、板块不跟，则只观察。",
      },
    };
  }

  if (nature.key === "acceleration") {
    return {
      holder: {
        action: "持有但停止加仓，开始观察兑现",
        now: "高位核心进入加速，强度最显眼但盈亏比已经下降。",
        addCondition: "原则上不再加仓；只有充分分歧换手后重新回封，才重新评估。",
        sellCondition: "反复炸板、跟随股掉队、板块高潮回落或回封失败时分批兑现。",
      },
      outsider: {
        action: "不追无换手加速",
        preferredEntry: "充分换手后的回封确认",
        routes: [{
          key: "reseal",
          label: "换手回封",
          condition: "炸板完成真实换手，抛压被承接，板块核心同步增强后再次回封。",
        }],
        skipReason: "直线秒板、无量封板或尾盘偷板一律放弃。",
      },
    };
  }

  const strengthening = nature.key === "strengthening";
  const outsiderRoutes = [];
  outsiderRoutes.push({
    key: "pullback",
    label: "首次回踩承接",
    condition: "竞价和开盘确认后，第一次回踩缩量守住有效支撑，再次放量向上。",
  });
  if (capacity) {
    outsiderRoutes.push({
      key: "breakout",
      label: "放量突破",
      condition: "放量突破明确压力位，板块容量票与核心同步增强，突破后不迅速跌回。",
    });
  }
  if (height >= 2) {
    outsiderRoutes.push({
      key: "reseal",
      label: "换手回封",
      condition: "充分换手后分歧转一致，回封时板块梯队完整且跟随没有掉队。",
    });
  }

  return {
    holder: {
      action: confirmed
        ? strengthening ? "继续持有，分歧承接后才加仓" : "继续持有，首次回踩确认后可加仓"
        : "保持原仓，等待板块确认",
      now: strengthening
        ? strongOnStrong
          ? "当前属于强势基线后的强转强；高开只是起点，守住强势区并继续带动才成立。"
          : "当前属于修复后的继续加强，普通震荡不构成卖点。"
        : "当前正在由负反馈修复向结构性转折验证。",
      addCondition: "第一次回踩缩量守住开盘价、昨收或分时均价，板块核心同步增强，二次放量进攻时才允许在原周期仓位上限内加仓。",
      sellCondition: "板块仍强但本票掉队、两次进攻失败，或个股与板块同时转弱时减仓或退出。",
    },
    outsider: {
      action: confirmed ? "允许按确认路径参与，不追第一口" : "等待确认，不抢竞价",
      preferredEntry: capacity ? "回踩承接 / 放量突破" : height >= 2 ? "回踩承接 / 换手回封" : "首次回踩承接",
      routes: outsiderRoutes,
      skipReason: "直接无量加速、板块不跟或买点出现时已接近高潮，宁可错过。",
    },
  };
}

function classifyNature(previousCandidate, current, payload, status) {
  const leadership = current && current.leadership || {};
  const structure = leadership.structure || {};
  const marketState = payload && payload.market && payload.market.state || {};
  const marketBigCycle = normalizeBigCycle(marketState.structuralCycle || marketState.cycle);
  const marketEmotion = payload && payload.marketEmotion || {};
  const previousLight = previousCandidate && previousCandidate.marketContext && previousCandidate.marketContext.light;
  const sector = findTopicSupport(current, payload);
  const height = reportedBoardHeight(current);
  const closedAtLimit = isLimitUp(current);
  const strongOnStrong = previousCandidate && previousCandidate.baseline
    && previousCandidate.baseline.routeKey === "strong_on_strong";

  if (!sector.passed) {
    return { key: "repair", label: "修复型超预期", note: "个股表现较强，但板块支撑不足，先按孤立修复处理。" };
  }
  if (
    status === "confirmed"
    && structure.overextended
    && height >= 4
    && closedAtLimit
    && marketBigCycle === "主升"
  ) {
    return { key: "acceleration", label: "加速型超预期", note: "高位核心继续加速，持仓观察兑现，空仓不追无换手一致。" };
  }
  if (status === "confirmed" && strongOnStrong) {
    return {
      key: "strengthening",
      label: "强转强型超预期",
      note: "昨日已经形成强势基线，今日高开后继续主动并获得板块响应，确认强转强。",
    };
  }
  if (
    status === "confirmed"
    && ["退潮", "冰点", "混沌", "震荡"].includes(clean(previousCandidate && previousCandidate.marketContext && previousCandidate.marketContext.cycle))
    && ["green", "yellow"].includes(clean(marketEmotion.light))
    && clean(marketEmotion.light) !== clean(previousLight)
  ) {
    return { key: "turn", label: "转折型超预期", note: "个股、板块与市场情绪同步改善，具备从修复升级为转折的条件。" };
  }
  if (status === "confirmed" && marketBigCycle === "主升") {
    return { key: "strengthening", label: "加强型超预期", note: "已有修复继续获得板块确认，按加强处理但不追无换手加速。" };
  }
  return { key: "repair", label: "修复型超预期", note: "目前只确认了强于悲观预期，尚未确认新一轮行情。" };
}

function buildValidation(previousCandidate, current, payload) {
  const session = initiativeSession(current);
  const initiative = current && current.leadership && current.leadership.initiative || {};
  const leadership = current && current.leadership || {};
  const sector = findTopicSupport(current, payload);
  const prevClose = finite(current && (current.prevClose || current.preClose));
  const openPrice = finite(current && (current.open || current.openPrice));
  const highPrice = finite(current && (current.high || current.highPrice));
  const lowPrice = finite(current && (current.low || current.lowPrice));
  const quoteOpenPct = prevClose && openPrice !== null ? ((openPrice - prevClose) / prevClose) * 100 : null;
  const quoteMaxPct = prevClose && highPrice !== null ? ((highPrice - prevClose) / prevClose) * 100 : null;
  const quoteMinPct = prevClose && lowPrice !== null ? ((lowPrice - prevClose) / prevClose) * 100 : null;
  const openPct = finite(session && session.openChangePct) !== null
    ? finite(session && session.openChangePct)
    : quoteOpenPct;
  const currentPct = finite(current && current.changePct);
  const maxPct = finite(session && session.maxChangePct) !== null
    ? finite(session && session.maxChangePct)
    : quoteMaxPct;
  const minPct = finite(session && session.minChangePct) !== null
    ? finite(session && session.minChangePct)
    : quoteMinPct;
  const baseline = previousCandidate.baseline || {};
  const threshold = finite(baseline.overExpectedOpenPct);
  const strongOnStrong = baseline.routeKey === "strong_on_strong";
  const auctionPassed = openPct !== null && threshold !== null && openPct >= threshold;
  const redPassed = currentPct !== null && currentPct > 0
    || finite(session && session.firstRedMinute) !== null;
  const boardPassed = sector.passed;
  const closeProxyActive = Boolean(
    !session
    && isLimitUp(current)
    && boardPassed
    && leadership.persistentRecognition === true
    && Number(initiative.score || 0) >= 55
    && (
      Number(current && current.turnoverRate || 0) >= 8
      || Number(current && current.amountYi || 0) >= 20
    )
  );
  const activePassed = initiative.proactive === true && Number(initiative.score || 0) >= 58
    || closeProxyActive;
  const retained = finite(initiative.retentionPct);
  const quoteRetention = currentPct !== null && maxPct !== null && maxPct > 0
    ? clamp((currentPct / maxPct) * 100, -100, 120)
    : null;
  const effectiveRetention = retained !== null ? retained : quoteRetention;
  const retentionPassed = effectiveRetention !== null && effectiveRetention >= 55;
  const expectedRange = Array.isArray(baseline.expectedOpenRangePct)
    ? baseline.expectedOpenRangePct
    : [];
  const continuationFloor = strongOnStrong
    ? Math.max(1, finite(expectedRange[0]) || 0)
    : 0;
  const pathPerformancePassed = strongOnStrong
    ? currentPct !== null && currentPct >= continuationFloor && retentionPassed
    : redPassed;

  let score = 0;
  if (auctionPassed) score += 25;
  if (pathPerformancePassed) score += 18;
  if (activePassed) score += 22;
  if (boardPassed) score += 20;
  if (retentionPassed) score += 10;
  if (isLimitUp(current)) score += 5;
  score = clamp(score, 0, 100);

  const expectedFloor = Array.isArray(baseline.expectedOpenRangePct)
    ? finite(baseline.expectedOpenRangePct[0])
    : null;
  const materiallyWeak = currentPct !== null
    && expectedFloor !== null
    && currentPct <= expectedFloor
    && !activePassed
    && !boardPassed;
  const status = materiallyWeak
    ? "failed"
    : score >= 75 && auctionPassed && boardPassed
      && (!strongOnStrong || activePassed && retentionPassed && pathPerformancePassed)
      ? "confirmed"
      : score >= 50
        ? "initial"
        : "waiting";
  const statusLabel = {
    failed: "超预期失效",
    confirmed: "超预期确认",
    initial: "初步超预期",
    waiting: "等待确认",
  }[status];
  const nature = classifyNature(previousCandidate, current, payload, status);
  const actions = actionPlan(nature, status, current, previousCandidate);

  return {
    code: previousCandidate.code,
    name: previousCandidate.name,
    direction: previousCandidate.direction,
    status,
    statusLabel,
    confirmationScore: score,
    nature,
    comparison: {
      routeKey: baseline.routeKey || "weak_to_strong",
      routeLabel: baseline.routeLabel || "弱转强路线",
      todayNatureLabel: baseline.todayNatureLabel || "预期性质待确认",
      expectedOpenRangePct: baseline.expectedOpenRangePct || null,
      overExpectedOpenPct: threshold,
      actualOpenPct: openPct,
      currentPct,
      maxPct,
      minPct,
    },
    checks: [
      { label: strongOnStrong ? "竞价达到强转强线" : "竞价超过正常预期", passed: auctionPassed, value: openPct === null ? "竞价数据待补" : `${openPct > 0 ? "+" : ""}${round1(openPct)}%` },
      {
        label: strongOnStrong ? "高开后守住强势区" : "开盘后转强/翻红",
        passed: pathPerformancePassed,
        value: strongOnStrong
          ? currentPct === null ? "待确认" : `${currentPct > 0 ? "+" : ""}${round1(currentPct)}% · 保留${effectiveRetention === null ? "待确认" : `${round1(effectiveRetention)}%`}`
          : session && session.firstRedTime || (currentPct !== null ? `${currentPct > 0 ? "+" : ""}${round1(currentPct)}%` : "待确认"),
      },
      { label: "个股保持主动性", passed: activePassed, value: Number.isFinite(Number(initiative.score)) ? `${Math.round(Number(initiative.score))}/100${closeProxyActive ? "（收盘代理）" : ""}` : "待确认" },
      { label: "板块核心同步确认", passed: boardPassed, value: sector.corePeerNames.join("、") || sector.positivePeerNames.join("、") || "尚无跟随" },
      { label: "冲高后强度保留", passed: retentionPassed, value: effectiveRetention === null ? "待确认" : `${round1(effectiveRetention)}%` },
    ],
    sector,
    holder: actions.holder,
    outsider: actions.outsider,
    invalidation: previousCandidate.invalidation,
  };
}

function previousCandidateRows(previousArchive) {
  const payload = previousArchive && previousArchive.payload
    ? previousArchive.payload
    : previousArchive;
  if (!payload || typeof payload !== "object") return [];
  const archiveDate = normalizeTradeDate(
    previousArchive && previousArchive.date
    || payload.superExpectation && payload.superExpectation.tradingDate
    || tradingDateFromPayload(payload),
  );
  const storedModelCurrent = Number(payload.superExpectation && payload.superExpectation.version) === SUPER_EXPECTATION_VERSION;
  const rows = storedModelCurrent && payload.superExpectation && Array.isArray(payload.superExpectation.candidates)
    ? payload.superExpectation.candidates.filter(Boolean)
    : buildCandidateStage(payload).candidates;
  return rows.map((candidate) => ({
    ...candidate,
    baseline: {
      ...(candidate.baseline || {}),
      sourceTradeDate: normalizeTradeDate(candidate.baseline && candidate.baseline.sourceTradeDate) || archiveDate,
      validityRule: candidate.baseline && candidate.baseline.validityRule || "next_trading_day_only",
    },
  }));
}

function buildCandidateStage(payload) {
  const rows = Array.isArray(payload && payload.candidates) ? payload.candidates.filter(Boolean) : [];
  const candidates = [];
  const rejected = [];
  rows.forEach((stock) => {
    const result = buildCandidate(stock, payload);
    if (result.qualified) candidates.push(result);
    else if (result.screenedCore) rejected.push(result);
  });
  candidates.sort(rankCandidate);
  const marketState = payload && payload.market && payload.market.state || {};
  const marketEmotion = payload && payload.marketEmotion || {};
  candidates.forEach((candidate) => {
    candidate.marketContext = {
      cycle: clean(marketState.cycle || "未知"),
      subPhase: clean(marketState.subPhase || "未知"),
      light: clean(marketEmotion.light || "yellow"),
      quality: clean(marketEmotion.quality || "待确认"),
    };
  });
  return {
    candidates: candidates.slice(0, 8),
    rejected,
  };
}

function buildSuperExpectationRadar(payload, previousArchive = null) {
  const candidateStage = buildCandidateStage(payload || {});
  const currentRows = Array.isArray(payload && payload.candidates) ? payload.candidates.filter(Boolean) : [];
  const currentByCode = new Map(currentRows.map((stock) => [codeOf(stock), stock]));
  const expectedSourceDate = previousTradingDateFromPayload(payload);
  const currentTradingDate = tradingDateFromPayload(payload);
  const previousRows = previousCandidateRows(previousArchive);
  const previousCandidates = previousRows
    .filter((candidate) => {
      const sourceDate = normalizeTradeDate(candidate && candidate.baseline && candidate.baseline.sourceTradeDate);
      return Boolean(expectedSourceDate && sourceDate === expectedSourceDate);
    })
    .map((candidate) => ({
      ...candidate,
      baseline: {
        ...(candidate.baseline || {}),
        validForTradeDate: currentTradingDate || null,
      },
    }));
  const expiredBaselineCount = previousRows.length - previousCandidates.length;
  const validations = previousCandidates.map((candidate) => {
    const current = currentByCode.get(clean(candidate.code));
    if (!current) {
      return {
        code: clean(candidate.code),
        name: clean(candidate.name),
        direction: clean(candidate.direction),
        status: "missing",
        statusLabel: "今日行情未覆盖",
        confirmationScore: null,
        nature: { key: "waiting", label: "等待数据", note: "当前热榜没有覆盖该票，不能把缺数据判断为超预期或失效。" },
        comparison: {
          expectedOpenRangePct: candidate.baseline && candidate.baseline.expectedOpenRangePct || null,
          overExpectedOpenPct: candidate.baseline && candidate.baseline.overExpectedOpenPct,
          actualOpenPct: null,
          currentPct: null,
        },
        checks: [],
        holder: {
          action: "等待完整行情，不执行模型动作",
          now: "缺少当日行情，不能生成持仓结论。",
          addCondition: "禁止因缺数据加仓。",
          sellCondition: "使用真实行情手动核对，不让缺数据替代判断。",
        },
        outsider: {
          action: "不买",
          preferredEntry: "无",
          routes: [],
          skipReason: "行情数据不完整。",
        },
        invalidation: candidate.invalidation,
      };
    }
    return buildValidation(candidate, current, payload);
  });

  const counts = {
    scannedCore: currentRows.filter((stock) => stock && stock.leadership && stock.leadership.coreIdentityQualified === true).length,
    candidates: candidateStage.candidates.length,
    validating: validations.length,
    confirmed: validations.filter((item) => item.status === "confirmed").length,
    initial: validations.filter((item) => item.status === "initial").length,
    failed: validations.filter((item) => item.status === "failed").length,
    expired: expiredBaselineCount,
  };
  const tradingDate = payload && payload.market && payload.market.limitStats
    && payload.market.limitStats.dates && payload.market.limitStats.dates.today
    || null;

  return {
    version: SUPER_EXPECTATION_VERSION,
    generatedAt: payload && (payload.fetchedAt || payload.updatedAt) || new Date().toISOString(),
    tradingDate,
    principle: "先确认当日最终状态：稳定强不冒充弱转强，紧邻T-1的有效弱基线看弱转强，主升分歧秒回封看强转强；超预期不自动等于买入。",
    counts,
    candidateStage: {
      title: "明日超预期候选池",
      note: "只保留核心身份、清晰预期路径和板块回流基础同时通过的股票；主动弱直接淘汰。",
      candidates: candidateStage.candidates,
      rejectedCoreCount: candidateStage.rejected.length,
      rejected: candidateStage.rejected,
    },
    validationStage: {
      title: "今日超预期验证与应对",
      note: "使用昨日冻结的预期基准，依次验证竞价、承接、主动性和板块共振。",
      validations,
    },
    candidates: candidateStage.candidates,
    degraded: false,
  };
}

module.exports = {
  SUPER_EXPECTATION_VERSION,
  finite,
  limitThreshold,
  reportedBoardHeight,
  buildCoreGate,
  findTopicSupport,
  marketWeaknessContext,
  classifyPreviousDayState,
  detectExpectationPattern,
  classifyExpectationPath,
  buildCandidateStage,
  buildValidation,
  buildSuperExpectationRadar,
};
