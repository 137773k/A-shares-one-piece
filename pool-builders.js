"use strict";

// 5个独立选股池构建函数

function roleAuthority(stock) {
  const leadership = stock && stock.leadership && typeof stock.leadership === 'object' ? stock.leadership : {};
  const cycle = leadership.cycleIdentity && typeof leadership.cycleIdentity === 'object'
    ? leadership.cycleIdentity : {};
  const cycleLeader = cycle.identityEstablished === true
    && cycle.activePrimary === true
    && ['confirmed', 'retained'].includes(String(cycle.state || ''))
    || stock && stock.roleKind === 'cycleLeader' && stock.roleScope === 'cycle';
  const dailyHeight = !cycleLeader && Boolean(stock && (
    leadership.sessionIdentity && leadership.sessionIdentity.dailyHeight === true
    || stock.roleKind === 'dailyHeight'
    || stock.dailyRole === '当日高度'
    || stock.roleScope === 'session'
  ));
  const capacityCore = !dailyHeight && Boolean(stock
    && stock.roleKind === 'capacityCore' && stock.roleScope === 'rolling');
  return { cycleLeader, capacityCore, dailyHeight, coreAuthorized: cycleLeader || capacityCore };
}

// 池1：今日强度池（原打分逻辑）
function buildTodayStrongPool(candidates, strategy, baseScoreFunc) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  return candidates.map(stock => {
    const baseScore = baseScoreFunc ? baseScoreFunc(stock) : (stock.score || 0);
    const role = String(stock.role || '').trim();
    const setup = String(stock.setup || '').trim();

    let bonus = 0;
    // 应用策略加分
    const authority = roleAuthority(stock);
    for (const [r, b] of Object.entries(strategy.roleBonus || {})) {
      if ((r === '龙头' && authority.cycleLeader) || (r === '中军' && authority.capacityCore) || (r !== '龙头' && r !== '中军' && role.includes(r))) bonus += b;
    }
    for (const [s, b] of Object.entries(strategy.setupBonus || {})) {
      if (setup.includes(s)) bonus += b;
    }

    return {
      ...stock,
      poolType: 'todayStrong',
      poolScore: baseScore + bonus,
      poolReason: `今日强度${baseScore.toFixed(1)}+策略加分${bonus}`
    };
  }).sort((a, b) => b.poolScore - a.poolScore);
}

// 池2：回流预期池（昨强今弱结构在）
function buildReflowPoolStocks(candidates, yesterdaySnapshot, hotConcepts, strategy, buildReflowExpectation, calcReflowBonus) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  // 如果有昨日快照，用标准回流逻辑
  if (yesterdaySnapshot) {
    return candidates.filter(stock => {
      const concept = String(stock.mainConcept || stock.mainFamily || '').trim();
      const expectation = buildReflowExpectation(concept, candidates, yesterdaySnapshot, hotConcepts);
      return expectation !== null;
    }).map(stock => {
      const concept = String(stock.mainConcept || stock.mainFamily || '').trim();
      const expectation = buildReflowExpectation(concept, candidates, yesterdaySnapshot, hotConcepts);
      const reflowBonus = calcReflowBonus(stock, candidates, yesterdaySnapshot, hotConcepts);
      const role = String(stock.role || '').trim();
      const setup = String(stock.setup || '').trim();

      let strategyBonus = 0;
      const authority = roleAuthority(stock);
      for (const [r, b] of Object.entries(strategy.roleBonus || {})) {
        if ((r === '龙头' && authority.cycleLeader) || (r === '中军' && authority.capacityCore) || (r !== '龙头' && r !== '中军' && role.includes(r))) strategyBonus += b;
      }
      for (const [s, b] of Object.entries(strategy.setupBonus || {})) {
        if (setup.includes(s)) strategyBonus += b;
      }

      return {
        ...stock,
        poolType: 'reflow',
        poolScore: reflowBonus + strategyBonus,
        poolReason: expectation ? expectation.reason : '回流预期'
      };
    }).sort((a, b) => b.poolScore - a.poolScore);
  }

  // Fallback：没有昨日快照时，用今日数据推测回流预期
  // 逻辑：今天小幅回调或逆势涨停的龙头/中军，结构未破，有回流价值
  return candidates.filter(stock => {
    const role = String(stock.role || '').trim();
    const setup = String(stock.setup || '').trim();
    const changePct = Number(stock.changePct || 0);
    const kline = stock.klineProfile || {};
    const rise10 = Number(kline.rise10 || 0);

    // 回流候选条件：
    // 1. 龙头或中军角色（核心票，不是后排杂毛）
    // 2. 今天涨幅-3%~+15%之间（包含涨停板，核心票涨停是活口）
    // 3. 10日涨幅>8%（近期有过强势，不是一直弱）
    // 4. setup包含回流/承接/核心观察/分歧转强等回流相关特征
    const authority = roleAuthority(stock);
    const isLeaderOrZhongjun = authority.coreAuthorized;
    const isModerateMove = changePct >= -3 && changePct <= 15;
    const hasRecentStrength = rise10 > 8;
    const hasReflowSetup = /回流|承接|核心观察|分歧转强|弱转强/.test(setup);

    return isLeaderOrZhongjun && isModerateMove && hasRecentStrength && (hasReflowSetup || isLeaderOrZhongjun);
  }).map(stock => {
    const role = String(stock.role || '').trim();
    const setup = String(stock.setup || '').trim();
    const changePct = Number(stock.changePct || 0);
    const kline = stock.klineProfile || {};
    const rise10 = Number(kline.rise10 || 0);
    const isLimitUp = changePct >= 9.5; // 涨停判定

    // 评分逻辑：
    let reflowScore = 0;

    // 角色加分（龙头权重更高）
    const authority = roleAuthority(stock);
    if (authority.cycleLeader) reflowScore += 30;
    else if (authority.capacityCore) reflowScore += 20;

    // 今日涨跌幅加分（核心逻辑：活口 > 横盘 > 小回调 > 温和上涨）
    if (isLimitUp && authority.cycleLeader) {
      // 板块分歧中龙头涨停 = 活口，最高分
      reflowScore += 25;
    } else if (isLimitUp && authority.capacityCore) {
      // 中军涨停也是活口，但略低于龙头
      reflowScore += 18;
    } else if (changePct >= -1 && changePct <= 2) {
      // 横盘最稳
      reflowScore += 15;
    } else if (changePct >= -3 && changePct < -1) {
      // 小幅回调，结构守住
      reflowScore += 12;
    } else if (changePct > 2 && changePct <= 6) {
      // 温和上涨
      reflowScore += 8;
    } else if (changePct > 6 && changePct < 9.5) {
      // 大涨但未封板，可能明天兑现
      reflowScore += 5;
    }

    // 近期强度加分
    if (rise10 > 20) reflowScore += 10;
    else if (rise10 > 15) reflowScore += 8;
    else if (rise10 > 8) reflowScore += 5;

    // setup加分
    let strategyBonus = 0;
    for (const [r, b] of Object.entries(strategy.roleBonus || {})) {
      if ((r === '龙头' && authority.cycleLeader) || (r === '中军' && authority.capacityCore) || (r !== '龙头' && r !== '中军' && role.includes(r))) strategyBonus += b;
    }
    for (const [s, b] of Object.entries(strategy.setupBonus || {})) {
      if (setup.includes(s)) strategyBonus += b;
    }

    const reason = isLimitUp
      ? `活口：${role}涨停·10日${rise10.toFixed(0)}%`
      : `回流候选：${role}·${changePct.toFixed(1)}%·10日${rise10.toFixed(0)}%`;

    return {
      ...stock,
      poolType: 'reflow',
      poolScore: reflowScore + strategyBonus,
      poolReason: reason
    };
  }).sort((a, b) => b.poolScore - a.poolScore);
}

// 池3：主线核心池（当前主线的龙头中军）
function buildMainLinePool(candidates, topicBoard, strategy) {
  if (!Array.isArray(candidates) || candidates.length === 0 || !topicBoard) return [];

  const mainLineName = topicBoard.mainLine ? String(topicBoard.mainLine.displayName || topicBoard.mainLine.name || '').trim() : '';
  if (!mainLineName) return [];

  return candidates.filter(stock => {
    const concept = String(stock.mainConcept || stock.mainFamily || '').trim();
    return concept.includes(mainLineName) && roleAuthority(stock).coreAuthorized;
  }).map(stock => {
    const role = String(stock.role || '').trim();
    const setup = String(stock.setup || '').trim();

    let bonus = 0;
    const authority = roleAuthority(stock);
    for (const [r, b] of Object.entries(strategy.roleBonus || {})) {
      if ((r === '龙头' && authority.cycleLeader) || (r === '中军' && authority.capacityCore) || (r !== '龙头' && r !== '中军' && role.includes(r))) bonus += b;
    }
    for (const [s, b] of Object.entries(strategy.setupBonus || {})) {
      if (setup.includes(s)) bonus += b;
    }

    return {
      ...stock,
      poolType: 'mainLine',
      poolScore: (stock.score || 0) + bonus,
      poolReason: `主线${mainLineName}核心`
    };
  }).sort((a, b) => b.poolScore - a.poolScore);
}

// 池4：低位试错池（首二板+低位+启动形态）
function buildLowPositionPool(candidates, strategy) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  return candidates.filter(stock => {
    const setup = String(stock.setup || '').trim();
    const changePct = Number(stock.changePct || 0);
    const kline = stock.klineProfile || {};
    const rise10 = Number(kline.rise10 || 0);

    // 低位定义：首板/二板/低位，且10日涨幅<20%
    return (/首板|二板|低位/.test(setup) || changePct >= 9.5) && rise10 < 20;
  }).map(stock => {
    const role = String(stock.role || '').trim();
    const setup = String(stock.setup || '').trim();

    let bonus = 0;
    const authority = roleAuthority(stock);
    for (const [r, b] of Object.entries(strategy.roleBonus || {})) {
      if ((r === '龙头' && authority.cycleLeader) || (r === '中军' && authority.capacityCore) || (r !== '龙头' && r !== '中军' && role.includes(r))) bonus += b;
    }
    for (const [s, b] of Object.entries(strategy.setupBonus || {})) {
      if (setup.includes(s)) bonus += b;
    }

    return {
      ...stock,
      poolType: 'lowPosition',
      poolScore: (stock.score || 0) + bonus,
      poolReason: `低位试错：${setup}`
    };
  }).sort((a, b) => b.poolScore - a.poolScore);
}

// 池5：历史核心池（survivorBoard）
function buildSurvivorPoolStocks(candidates, survivorBoard, strategy) {
  if (!Array.isArray(candidates) || candidates.length === 0 || !survivorBoard) return [];

  const survivorItems = Array.isArray(survivorBoard.items) ? survivorBoard.items : [];
  const survivorCodes = new Set(survivorItems.map(item => String(item.code || '').trim()).filter(Boolean));

  return candidates.filter(stock => {
    const code = String(stock.code || '').trim();
    return survivorCodes.has(code);
  }).map(stock => {
    const role = String(stock.role || '').trim();
    const setup = String(stock.setup || '').trim();

    let bonus = 0;
    const authority = roleAuthority(stock);
    for (const [r, b] of Object.entries(strategy.roleBonus || {})) {
      if ((r === '龙头' && authority.cycleLeader) || (r === '中军' && authority.capacityCore) || (r !== '龙头' && r !== '中军' && role.includes(r))) bonus += b;
    }
    for (const [s, b] of Object.entries(strategy.setupBonus || {})) {
      if (setup.includes(s)) bonus += b;
    }

    return {
      ...stock,
      poolType: 'survivor',
      poolScore: (stock.score || 0) + bonus + 15, // 历史核心额外加分
      poolReason: '历史核心留存'
    };
  }).sort((a, b) => b.poolScore - a.poolScore);
}

// 池混合函数：按策略权重混合多个池
function mixPools(pools, weights) {
  const mixed = [];
  const addedCodes = new Set();

  // 按权重从高到低添加
  const sortedEntries = Object.entries(weights).sort((a, b) => b[1] - a[1]);

  for (const [poolName, weight] of sortedEntries) {
    if (weight === 0) continue;
    const pool = pools[poolName] || [];
    const takeCount = Math.max(3, Math.ceil(pool.length * weight)); // 至少取3个

    for (let i = 0; i < Math.min(takeCount, pool.length); i++) {
      const stock = pool[i];
      const code = String(stock.code || '').trim();
      if (!addedCodes.has(code)) {
        mixed.push(stock);
        addedCodes.add(code);
      }
    }
  }

  // 按poolScore重新排序
  return mixed.sort((a, b) => b.poolScore - a.poolScore);
}

module.exports = {
  buildTodayStrongPool,
  buildReflowPoolStocks,
  buildMainLinePool,
  buildLowPositionPool,
  buildSurvivorPoolStocks,
  mixPools
};
