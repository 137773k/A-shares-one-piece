"use strict";
/**
 * sell-engine.js —— 全天卖出时间轴引擎 + 加仓/账户级风控
 * 对应《量化说明书》4.25(单/双逻辑分闸)、4.26(盘中动态)、4.27(全天时间轴)、
 * 3(弱转强加仓)、4.4(账户熔断)、5.5(板块集中度)。
 *
 * 设计:全部纯函数,不抓数据、不落盘;由调用方(server.js)喂入行情快照,
 * 返回 [{gate, action, portion, reason}] 动作列表。与 trading-rules.js 同风格,可独立 node 测试。
 */

// ============ 阈值配置(集中在这,回测/实盘统计后再调) ============
const SELL_CFG = {
  breakEvenArmPct: 3,        // 浮盈≥3% 后,保本线上移生效
  breakEvenExitPct: 0.5,     // 回落到成本+0.5%以内 → 触发保本离场
  pullbackNormalPct: 4,      // 分时高点回撤阈值(普通票)
  pullbackHighFlyerPct: 5.5, // 分时高点回撤阈值(高位妖股放宽)
  vwapBreakMinutes: 5,       // 破分时均价需持续N分钟才算"收不回"
  hardStopMainPct: -7,       // 硬止损:主板
  hardStop20cmPct: -12,      // 硬止损:20cm(创业板/科创板)
  addOnStopPct: -4.5,        // 加仓份额单独止损
  reflowWindow: ["14:00", "14:50"], // 回流判定窗口
  ma5DeadlineTime: "14:55",  // 五日线兜底判定时点
  auctionDeadline: "09:45",  // 竞价/开盘闸最晚判定时点(15-30分钟内)
};

const ACCOUNT_CFG = {
  circuitBreakerDrawdownPct: 15, // 账户从高点回撤>15% → 强制半仓
  maxPerSector: 2,               // 同板块最多持有只数
  maxSectorWeightPct: 50,        // 单板块总仓位上限%
};

const SELL_POSITION_STATE = Object.freeze({
  HOLD_STRONG: "HOLD_STRONG",
  NORMAL_REALIZATION: "NORMAL_REALIZATION",
  WEAK_PENDING: "WEAK_PENDING",
  WEAK_CONFIRMED: "WEAK_CONFIRMED",
  ESCAPE: "ESCAPE",
});

// ============ 小工具 ============
function t2m(hhmm) { // "14:05" → 845 分钟
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}
function pctFrom(base, price) {
  return base ? ((price - base) / base) * 100 : 0;
}
function act(gate, action, portion, reason) {
  return { gate, action, portion, reason };
}

/**
 * 核心:给定持仓 + 当前行情快照,输出应执行的卖出动作(按优先级,取第一条执行即可)
 *
 * pos = {
 *   costPrice,            // 成本价(底仓成本)
 *   addOnPrice,           // 加仓份额成本(没加仓则省略)
 *   board,                // "主板" | "20cm"
 *   dualLogic,            // 是否双逻辑(⚠️必须盘前写死;false=单逻辑)
 *   gambleSold,           // 双逻辑:博弈仓(第一笔)是否已卖
 *   isExpectedReflowDay,  // 今天是否盘前判定的"预期内回流日"
 *   isHighFlyer,          // 是否高位妖股(决定回撤阈值)
 *   peakGainArmed,        // 是否已给过≥3%浮盈(调用方维护,或由本函数返回提示后置位)
 * }
 * ctx = {
 *   time,                 // "HH:MM"
 *   price,                // 现价
 *   dayHigh,              // 当日盘中最高价
 *   auction,              // 竞价/开盘判定:"超预期"|"符合预期"|"不及预期"|null(未判)
 *   aboveVwap,            // 现价是否在分时均价上方
 *   vwapBrokenMinutes,    // 跌破分时均价已持续分钟数(在上方则0)
 *   ma5,                  // 五日线
 *   reflowConfirmed,      // 回流窗口内:板块回流是否确认 true/false/null(窗口外传null)
 * }
 */
function evaluateSellSignals(pos, ctx, cfg = SELL_CFG) {
  const actions = [];
  const now = t2m(ctx.time);
  const gainPct = pctFrom(pos.costPrice, ctx.price);
  const hardStop = pos.board === "20cm" ? cfg.hardStop20cmPct : cfg.hardStopMainPct;

  // ── 0. 硬止损:全天任意时刻,无条件,最高优先 ──
  if (gainPct <= hardStop) {
    actions.push(act("⑤硬止损", "一次清仓", "全部",
      `亏损${gainPct.toFixed(1)}%触及硬止损线${hardStop}%,不看逻辑不看板块`));
    return actions; // 硬止损后不再看其他
  }
  // 加仓份额单独止损
  if (pos.addOnPrice) {
    const addGain = pctFrom(pos.addOnPrice, ctx.price);
    if (addGain <= cfg.addOnStopPct) {
      actions.push(act("⑤硬止损(加仓份额)", "砍掉加仓份额", "加仓部分",
        `加仓份额亏${addGain.toFixed(1)}%触及${cfg.addOnStopPct}%,不牵连底仓`));
    }
  }

  // ── 1. 竞价/开盘闸(A闸):09:45前判,逻辑生死 ──
  if (now <= t2m(cfg.auctionDeadline) && ctx.auction === "不及预期") {
    if (!pos.dualLogic) {
      actions.push(act("①开盘不及预期", "一次清仓", "全部",
        "单逻辑票开盘证伪,立即清,不等五日线"));
      return actions;
    }
    if (!pos.gambleSold) {
      actions.push(act("①开盘不及预期", "卖出博弈仓", "1/2",
        "双逻辑:预期逻辑(A)死,砍赌预期的一半;底仓按回流逻辑(B)单独管"));
    }
  }

  // ── 2. 回流窗口闸(B闸):14:00–14:50,仅"预期内回流日"启用快线 ──
  const [w0, w1] = cfg.reflowWindow.map(t2m);
  if (pos.dualLogic && pos.isExpectedReflowDay && now >= w0 && now <= w1) {
    if (ctx.reflowConfirmed === false && now >= w1 - 5) {
      // 窗口将尽(14:45后)仍未确认 → 止损底仓,不拖尾盘
      actions.push(act("②回流没来止损", "止损底仓", "剩余",
        "预期内回流日,到14:50窗口将尽回流未至,B逻辑证伪"));
      return actions;
    }
    if (ctx.reflowConfirmed === true) {
      actions.push(act("④回流确认", "转格局仓·持有", "0",
        "回流到位,底仓转格局,交给中线技术线管"));
    }
  }

  // ── 3. 盘中动态(全程):保本线 + 分时高点回撤 ──
  const peakGain = pctFrom(pos.costPrice, ctx.dayHigh);
  const armed = pos.peakGainArmed || peakGain >= cfg.breakEvenArmPct;
  // 3a 保本线:给过≥3%浮盈后,不许赚变亏
  if (armed && gainPct <= cfg.breakEvenExitPct) {
    actions.push(act("⑥保本线", "清仓/大幅减仓", "全部或大半",
      `盘中曾浮盈${peakGain.toFixed(1)}%≥${cfg.breakEvenArmPct}%,现回落至成本附近——不许赚过钱的单变亏`));
    return actions;
  }
  // 3b 分时高点回撤:回撤够深 且 破分时均价收不回(两条件同时,防洗盘误杀)
  const pullback = pctFrom(ctx.dayHigh, ctx.price); // 负数
  const pbThreshold = pos.isHighFlyer ? cfg.pullbackHighFlyerPct : cfg.pullbackNormalPct;
  const vwapDead = !ctx.aboveVwap && (ctx.vwapBrokenMinutes || 0) >= cfg.vwapBreakMinutes;
  if (pullback <= -pbThreshold && vwapDead) {
    actions.push(act("⑥高点回撤", pos.dualLogic ? "博弈仓清/格局仓减半" : "减半",
      "1/2", `自日高回撤${Math.abs(pullback).toFixed(1)}%≥${pbThreshold}%且破分时均价${ctx.vwapBrokenMinutes}分钟收不回=真掉头`));
  } else if (pullback <= -pbThreshold && !vwapDead) {
    actions.push(act("观察", "不动", "0",
      "回撤虽深但仍在分时均价上方/刚破未确认=可能洗盘,拿住别被洗下车"));
  }

  // ── 4. 尾盘五日线兜底:14:55 ──
  if (now >= t2m(cfg.ma5DeadlineTime) && Number.isFinite(ctx.ma5) && ctx.price < ctx.ma5) {
    actions.push(act("③破五日线", "收盘清仓", "剩余",
      `14:55现价${ctx.price}<MA5(${ctx.ma5}),最终兜底闸`));
  }

  if (!actions.length) actions.push(act("—", "持有", "0", "无闸门触发"));
  return actions;
}

/**
 * 弱转强加仓判定(说明书第3节)——三条件全满足才允许加仓
 * input = {
 *   open5minBeyondExpectation, // 次日开盘5分钟明显超预期(高开快速拉升)
 *   sectorResonance,           // 板块共振同步走强
 *   reclaimedPrevHigh,         // 破均线有承接后,再次突破前高
 *   currentLayers,             // 当前已加层数
 *   maxLayers,                 // 上限(默认3)
 * }
 */
function addOnSignal(input) {
  const maxLayers = input.maxLayers || 3;
  const conds = [
    [input.open5minBeyondExpectation, "开盘5分钟超预期"],
    [input.sectorResonance, "板块共振"],
    [input.reclaimedPrevHigh, "承接后再破前高"],
  ];
  const missing = conds.filter(([ok]) => !ok).map(([, name]) => name);
  if (missing.length) {
    return { allow: false, reason: `弱转强条件缺:${missing.join("、")}` };
  }
  if ((input.currentLayers || 1) >= maxLayers) {
    return { allow: false, reason: `已达${maxLayers}层上限,极看好也封顶` };
  }
  return { allow: true, reason: "弱转强三条件齐,可加一层;加仓份额单独止损-4.5%" };
}

/**
 * 账户级熔断(说明书4.4):从高点回撤>15% → 强制半仓
 * equitySeries: 账户净值序列(或传 {peak, current})
 */
function accountCircuitBreaker(input, cfg = ACCOUNT_CFG) {
  let peak, current;
  if (Array.isArray(input)) {
    peak = Math.max(...input);
    current = input[input.length - 1];
  } else {
    ({ peak, current } = input || {});
  }
  if (!peak || !current) return { triggered: false, drawdownPct: 0, action: "—" };
  const dd = ((peak - current) / peak) * 100;
  const triggered = dd > cfg.circuitBreakerDrawdownPct;
  return {
    triggered,
    drawdownPct: Math.round(dd * 10) / 10,
    action: triggered ? "强制降至半仓,重新梳理;冷静期内禁止加仓" : "—",
  };
}

/**
 * 板块集中度检查(说明书5.5#1):同板块≤2只 / 单板块仓位≤50%
 * positions: [{sector, weightPct}], candidate: {sector, weightPct}
 */
function sectorConcentrationCheck(positions, candidate, cfg = ACCOUNT_CFG) {
  const same = (positions || []).filter((p) => p.sector && p.sector === candidate.sector);
  if (same.length >= cfg.maxPerSector) {
    return { allow: false, reason: `板块「${candidate.sector}」已持${same.length}只,达上限${cfg.maxPerSector}——4只同板块=满仓一个题材,是假分散` };
  }
  const weight = same.reduce((s, p) => s + (p.weightPct || 0), 0) + (candidate.weightPct || 0);
  if (weight > cfg.maxSectorWeightPct) {
    return { allow: false, reason: `买入后「${candidate.sector}」仓位${weight}%将超上限${cfg.maxSectorWeightPct}%` };
  }
  return { allow: true, reason: "板块集中度合规" };
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function firstFinite(...values) {
  for (const value of values) {
    const number = finiteOrNull(value);
    if (number !== null) return number;
  }
  return null;
}

function includesRiskText(values, pattern) {
  return (Array.isArray(values) ? values : [])
    .some((value) => pattern.test(String(value || "")));
}

/**
 * 收盘后的持仓强弱体检。
 *
 * 这里刻意不使用“综合评分低=弱仓”的捷径。弱仓必须先有个股层证据，
 * 再由板块/市场对照层确认；净流出、市场下跌、手填角色均不能单独触发。
 * 分时均价与方向实时中位数尚未接入收盘快照时，只能返回 WEAK_PENDING，
 * 由次日时间轴继续确认，不能伪装成已经触发卖点。
 */
function assessSellPosition(input = {}) {
  const snapshot = input.snapshot && typeof input.snapshot === "object" ? input.snapshot : null;
  const leadership = snapshot && snapshot.leadership && typeof snapshot.leadership === "object"
    ? snapshot.leadership
    : {};
  const initiative = leadership.initiative && typeof leadership.initiative === "object"
    ? leadership.initiative
    : {};
  const structure = leadership.structure && typeof leadership.structure === "object"
    ? leadership.structure
    : {};
  const kline = snapshot && snapshot.klineProfile && typeof snapshot.klineProfile === "object"
    ? snapshot.klineProfile
    : {};
  const hardGate = snapshot && snapshot.hardGate && typeof snapshot.hardGate === "object"
    ? snapshot.hardGate
    : {};
  const flow = snapshot && snapshot.flowNature && typeof snapshot.flowNature === "object"
    ? snapshot.flowNature
    : hardGate.metrics && hardGate.metrics.flowNature && typeof hardGate.metrics.flowNature === "object"
      ? hardGate.metrics.flowNature
      : {};
  const marketState = input.marketState && typeof input.marketState === "object" ? input.marketState : {};
  const dailyState = marketState.dailyState && typeof marketState.dailyState === "object" ? marketState.dailyState : {};
  const profitEffect = marketState.profitEffect && typeof marketState.profitEffect === "object" ? marketState.profitEffect : {};
  const lossEffect = marketState.lossEffect && typeof marketState.lossEffect === "object" ? marketState.lossEffect : {};

  const verifiedCore = leadership.coreIdentityQualified === true
    || snapshot && snapshot.coreIdentityQualified === true;
  const tradeQualified = leadership.tradeQualified === true
    || leadership.coreQualified === true
    || snapshot && snapshot.tradeQualified === true;
  const frameworkIntact = structure.frameworkIntact === true
    || (Object.keys(kline).length > 0 && kline.structureBreak !== true && kline.longBearBreak3d !== true);
  const gateFails = [
    ...(Array.isArray(hardGate.hardFails) ? hardGate.hardFails : []),
    ...(Array.isArray(leadership.hardFails) ? leadership.hardFails : []),
  ];
  const structureBroken = structure.breakdown === true
    || kline.structureBreak === true
    || kline.longBearBreak3d === true
    || includesRiskText(gateFails, /放量长阴|有效破位|跌破关键|结构破坏/);

  const changePct = firstFinite(snapshot && snapshot.changePct);
  const volumeRatio = firstFinite(snapshot && snapshot.volumeRatio);
  const relativeStrength = firstFinite(initiative.relativeStrength);
  const retentionPct = firstFinite(initiative.retentionPct);
  const initiativeScore = firstFinite(initiative.score, snapshot && snapshot.initiativeScore);
  const flowConfidence = firstFinite(flow.confidence) || 0;
  const flowEscape = flow.key === "escape" && flowConfidence >= 0.68 && flow.conflict !== true;
  const flowRealization = flow.key === "realization" && flowConfidence >= 0.6 && flow.conflict !== true;

  const individualEvidence = [];
  const relativeWeak = relativeStrength !== null && relativeStrength <= -2;
  if (relativeWeak) {
    individualEvidence.push(`相对方向中位涨幅落后${Math.abs(round1(relativeStrength))}个百分点（弱线为落后2个百分点）`);
  }
  const retentionWeak = retentionPct !== null && retentionPct < 45;
  if (retentionWeak) {
    individualEvidence.push(`主动进攻保留度仅${round1(retentionPct)}%（弱线为低于45%）`);
  }
  const volumeWeak = changePct !== null && changePct <= -3 && volumeRatio !== null && volumeRatio >= 1.2;
  if (volumeWeak) {
    individualEvidence.push(`收盘跌${Math.abs(round1(changePct))}%且量比${round1(volumeRatio)}，属于放量走弱`);
  }
  if (structureBroken) individualEvidence.push("K线/筹码结构已经出现明确破坏");
  if (flowEscape) individualEvidence.push("多维资金证据确认资金出逃（不是普通净流出）");

  const concept = input.concept && typeof input.concept === "object" ? input.concept : {};
  const sectorChangePct = firstFinite(concept.sectorChangePct);
  const boardSupport = concept.sameMain === true
    || concept.hotCore === true
    || concept.sameFamily === true
    || concept.boardCore === true
    || (sectorChangePct !== null && sectorChangePct > 0);
  const boardWeak = concept.explicitWeak === true
    || (sectorChangePct !== null && sectorChangePct <= -2);
  const boardEvidence = [];
  if (sectorChangePct !== null) {
    boardEvidence.push(`板块涨跌${sectorChangePct >= 0 ? "+" : ""}${round1(sectorChangePct)}%`);
  }
  if (boardSupport) boardEvidence.push(`仍属于${String(concept.relation || "当前强势方向")}`);
  if (boardWeak) boardEvidence.push("板块跌幅达到-2%弱线");
  if (!boardEvidence.length) boardEvidence.push("板块实时强弱数据不足，暂不据此判弱");

  const profitScore = firstFinite(profitEffect.score);
  const lossScore = firstFinite(lossEffect.score);
  const lossSpread = profitScore !== null && lossScore !== null ? lossScore - profitScore : null;
  const retreatCandidate = dailyState.retreatCandidate === true || dailyState.key === "retreat_candidate";
  const marketPanic = retreatCandidate
    || (lossScore !== null && lossScore >= 65 && (lossSpread === null || lossSpread >= 20 || marketState.cycle === "退潮"));
  const marketSupport = dailyState.key === "healthy_divergence"
    || /修复|回暖|健康分化/.test(String(dailyState.label || marketState.subPhase || ""))
    || lossEffect.trend === "improving";
  const marketEvidence = [];
  if (dailyState.label || marketState.subPhase) marketEvidence.push(`今日状态：${dailyState.label || marketState.subPhase}`);
  if (profitScore !== null) marketEvidence.push(`赚钱效应${round1(profitScore)}分`);
  if (lossScore !== null) marketEvidence.push(`亏钱效应${round1(lossScore)}分`);
  if (marketPanic) marketEvidence.push("市场负反馈达到恐慌确认线");
  else if (marketSupport) marketEvidence.push("市场仍有修复/承接，不按恐慌处理");
  if (!marketEvidence.length) marketEvidence.push("市场层数据不足，暂不单独判弱");

  const ordinaryWeakCount = Number(relativeWeak) + Number(retentionWeak) + Number(volumeWeak);
  const contextWeak = boardWeak || marketPanic || (boardSupport && relativeWeak);
  const hardWeak = flowEscape || (structureBroken && contextWeak);
  const weakConfirmed = hardWeak || (ordinaryWeakCount >= 2 && contextWeak);
  const missingIntraday = ["分时均价下持续时间", "是否收回次日零轴", "方向实时中位涨幅"];
  const dataNotes = [];
  if (!snapshot) dataNotes.push("未匹配到该股最新快照");
  if (!Object.keys(kline).length && Object.keys(structure).length === 0) dataNotes.push("K线结构数据缺失");
  dataNotes.push(`盘后尚不能确认：${missingIntraday.join("、")}`);

  let state = SELL_POSITION_STATE.HOLD_STRONG;
  let label = "结构承接仍在";
  let tone = "hold";
  let summary = "收盘证据没有确认弱仓；明日仍要通过分时均价、零轴和方向相对强弱复核。";
  if (flowEscape) {
    state = SELL_POSITION_STATE.ESCAPE;
    label = "资金出逃";
    tone = "hard-exit";
    summary = "多维资金证据已经确认出逃，不再按普通兑现等待回流。";
  } else if (weakConfirmed) {
    state = SELL_POSITION_STATE.WEAK_CONFIRMED;
    label = "收盘弱仓已确认";
    tone = "exit";
    summary = "个股弱项已达到门槛，并得到板块或市场对照层确认。";
  } else if (flowRealization && !structureBroken && !marketPanic) {
    state = SELL_POSITION_STATE.NORMAL_REALIZATION;
    label = "正常兑现（非出逃）";
    tone = "hold";
    summary = "净流出已经被结构、方向和市场承接解释为兑现；不因净流出机械卖出。";
  } else if (ordinaryWeakCount > 0 || structureBroken || !snapshot || !Object.keys(kline).length) {
    state = SELL_POSITION_STATE.WEAK_PENDING;
    label = "弱仓待确认（当前未触发）";
    tone = "trim";
    summary = "目前只有单点弱项或关键数据不足，必须等明日盘中满足“个股2项+对照1层”后才卖。";
  }

  let weakSellPct = 50;
  if (verifiedCore && frameworkIntact) weakSellPct = 33;
  else if (!verifiedCore && (/后排|补涨|观察/.test(String(input.role || snapshot && snapshot.role || "")) || initiativeScore !== null && initiativeScore < 60)) weakSellPct = 67;
  if (!verifiedCore && boardWeak && marketPanic) weakSellPct = 100;
  if (state === SELL_POSITION_STATE.ESCAPE) weakSellPct = 100;

  const positionPct = firstFinite(input.positionPct);
  const portfolioPctToSell = positionPct !== null ? round1(positionPct * weakSellPct / 100) : null;
  const portfolioPctLeft = positionPct !== null ? round1(Math.max(0, positionPct - portfolioPctToSell)) : null;

  return {
    state,
    label,
    tone,
    summary,
    verifiedCore,
    tradeQualified,
    frameworkIntact,
    structureBroken,
    flowKey: String(flow.key || "uncertain"),
    flowLabel: String(flow.label || "资金性质待确认"),
    individualWeakCount: ordinaryWeakCount + Number(structureBroken) + Number(flowEscape),
    ordinaryWeakCount,
    weakConfirmed,
    relativeWeak,
    retentionWeak,
    volumeWeak,
    boardSupport,
    boardWeak,
    marketPanic,
    marketSupport,
    individualEvidence: individualEvidence.length ? individualEvidence : ["收盘未发现明确个股弱项"],
    board: {
      state: boardWeak ? "weak" : boardSupport ? "support" : "unknown",
      label: boardWeak ? "板块偏弱" : boardSupport ? "板块有承接" : "板块待确认",
      evidence: boardEvidence,
    },
    market: {
      state: marketPanic ? "panic" : marketSupport ? "support" : "neutral",
      label: marketPanic ? "市场恐慌" : marketSupport ? "市场有承接" : "市场中性/待确认",
      evidence: marketEvidence,
    },
    dataNotes,
    weakRule: {
      headline: "弱仓=个股3项中至少2项 + 对照层至少1项",
      individual: [
        "低于分时均价持续至少5分钟",
        "开盘后仍未收回次日零轴（今日收盘价）",
        "涨幅落后所属方向实时中位数至少2个百分点",
      ],
      context: [
        "板块/核心已经修复而它不跟（个股独弱）",
        "或板块与市场至少一层同步转弱",
      ],
      exclusions: "单独低开、单独净流出、非核心/后排身份，都不能独立判成弱仓。",
    },
    weakSellPct,
    portfolioPctToSell,
    portfolioPctLeft,
  };
}

function buildSellReferenceLevels(input = {}) {
  const snapshot = input.snapshot && typeof input.snapshot === "object" ? input.snapshot : {};
  const kline = snapshot.klineProfile && typeof snapshot.klineProfile === "object" ? snapshot.klineProfile : {};
  const zeroAxis = firstFinite(input.currentPrice, snapshot.price, snapshot.close, snapshot.lastPrice);
  const ma5 = firstFinite(kline.ma5);
  const ma10 = firstFinite(kline.ma10);
  const auctionWeakPct = input.verifiedCore ? -2 : -1.5;
  const auctionWatch = zeroAxis !== null ? round1(zeroAxis * (1 + auctionWeakPct / 100)) : null;
  return [
    { key: "zero", label: "次日零轴（今日收盘）", value: zeroAxis, note: "9:35仍收不回，计一个个股弱项" },
    { key: "auction", label: `竞价预警线（${auctionWeakPct}%）`, value: auctionWatch, note: "只标记待确认，不凭低开直接卖" },
    { key: "ma5", label: "MA5结构线", value: ma5, note: "14:55仍失守才作为尾盘兜底" },
    { key: "ma10", label: "MA10硬防守线", value: ma10, note: "放量跌破并叠加方向转弱，按结构破坏处理" },
  ];
}

function buildSellAdvisorTimeline(input = {}) {
  const assessment = input.assessment || assessSellPosition(input);
  const levels = buildSellReferenceLevels({
    snapshot: input.snapshot,
    currentPrice: input.currentPrice,
    verifiedCore: assessment.verifiedCore,
  });
  const zero = levels.find((item) => item.key === "zero");
  const ma5 = levels.find((item) => item.key === "ma5");
  const priceText = zero && zero.value !== null ? Number(zero.value).toFixed(2) : "今日收盘价";
  const ma5Text = ma5 && ma5.value !== null ? Number(ma5.value).toFixed(2) : "MA5（数据待补）";
  const weakPct = assessment.weakSellPct;
  const positionImpact = assessment.portfolioPctToSell !== null
    ? `若弱仓确认：当前总仓位${round1(input.positionPct)}%，卖当前持仓${weakPct}% = 减总仓位${assessment.portfolioPctToSell}个百分点，剩${assessment.portfolioPctLeft}%`
    : `若弱仓确认：卖“当前持仓”的${weakPct}%，不是卖总账户的${weakPct}%`;
  const holderLine = String(input.holderLine || "").trim();
  const tradeSell = String(input.tradeSell || "").trim();

  if (assessment.state === SELL_POSITION_STATE.ESCAPE) {
    return {
      levels,
      currentAction: "出逃已确认：清仓",
      positionImpact: assessment.portfolioPctToSell !== null
        ? `当前总仓位${round1(input.positionPct)}%，清掉后该仓位降至0%`
        : "清掉当前持仓的100%",
      timeline: [{
        title: "硬规则 · 不等早盘确认",
        trigger: "flowNature 已由个股、方向、市场多维证据确认资金出逃",
        action: "清掉当前持仓100%，不再把出逃解释成普通兑现",
        nextCheck: "当日不回补；重新进入必须等新的买入逻辑重新成立",
      }],
    };
  }

  return {
    levels,
    currentAction: assessment.state === SELL_POSITION_STATE.WEAK_CONFIRMED
      ? `弱仓已确认：按规则卖当前持仓${weakPct}%`
      : "当前不执行机械卖出，等待明日条件触发",
    positionImpact,
    timeline: [
      {
        title: "9:25 · 只预警，不下单",
        trigger: "竞价相对所属方向落后≥2个百分点，只记为待确认；单独低开不等于弱仓",
        action: "先不卖。只有跌停封单/重大硬风险，并且板块与市场同步弱，才预设开盘清仓",
        nextCheck: `以${priceText}为次日零轴，对照板块核心和方向中位涨幅`,
      },
      {
        title: `9:30–9:35 · 弱仓首判（满足后卖${weakPct}%）`,
        trigger: "个股三项中至少两项：均价下≥5分钟、未收回零轴、落后方向中位≥2个百分点；并且板块/市场至少一层确认",
        action: `条件不够=0%；条件成立=${positionImpact}`,
        nextCheck: "板块核心回流而本票不跟=个股独弱；站回均价和零轴且相对差≤1个百分点=取消弱仓标签",
      },
      {
        title: "9:40–10:00 · 区分正常兑现与真转弱",
        trigger: "真转弱：均价下≥10分钟、反抽不过开盘前5分钟高点、仍落后方向≥2个百分点；正常兑现：高位/浮盈厚+自日高回撤≥4%+均价下≥5分钟+板块不跟",
        action: `真转弱按弱仓比例执行；正常兑现只卖当前持仓20%–33%，净流出本身不触发卖点`,
        nextCheck: "重新站回均价并保持5分钟且方向改善，停止继续卖；不因一次反抽立刻买回",
      },
      {
        title: "10:50 · 三层最终定性",
        trigger: "市场和板块已修复，本票仍在均价下且落后方向≥2个百分点=个股独弱；个股+板块+市场三弱或资金出逃=全清",
        action: "三层修复=停止卖；市场弱但本票主动带动且板块同步强=保留核心；三层共振弱=清仓",
        nextCheck: holderLine || tradeSell || "只看能否收回均价、零轴并重新强于所属方向",
      },
      {
        title: "14:45 / 14:55 · 回流与结构兜底",
        trigger: `预期回流日到14:45仍无回流，或14:55仍低于${ma5Text}`,
        action: "回流逻辑证伪则处理剩余博弈仓；尾盘仍破MA5则按结构线处理剩余仓位",
        nextCheck: tradeSell || "回补必须重新满足板块回流、核心回流、个股收复三项，不接弱反弹",
      },
    ],
  };
}

/**
 * 给页面使用的简明卖出主线。
 *
 * 复杂证据仍由 assessSellPosition 计算，但执行只保留四个容易复盘的节点：
 * 预期弱 -> 第一卖点 -> 确认转弱 -> 清仓线。单纯净流出或一次低开不触发卖点。
 */
function buildSimpleSellPlan(input = {}) {
  const assessment = input.assessment || assessSellPosition(input);
  const positionPct = firstFinite(input.positionPct);
  const boardCoreStrong = assessment.boardSupport === true || assessment.board?.state === "support";
  const passiveAgainstCore = boardCoreStrong && (
    assessment.relativeWeak === true
    || assessment.retentionWeak === true
    || assessment.ordinaryWeakCount > 0
  );
  const hardExit = assessment.state === SELL_POSITION_STATE.ESCAPE
    || assessment.structureBroken === true;

  const halfPosition = positionPct === null ? null : round1(positionPct / 2);
  const halfImpact = halfPosition === null
    ? "卖当前持仓的1/2"
    : `当前总仓位${round1(positionPct)}%，先减${halfPosition}个百分点，剩${round1(positionPct - halfPosition)}%`;

  let current = {
    key: "WAIT_COMPARE",
    label: "等待明早对照",
    tone: "hold",
    action: "先不卖，开盘后只比较板块核心与本票强弱",
    reason: "收盘数据不能代替明日分时，先看核心走强时本票是否主动跟随。",
  };

  if (hardExit) {
    current = {
      key: "CLEAR",
      label: "清仓线已触发",
      tone: "hard-exit",
      action: "卖出全部剩余持仓",
      reason: assessment.state === SELL_POSITION_STATE.ESCAPE
        ? "多维证据确认资金出逃，不再当成普通兑现等待回流。"
        : "个股自身结构已经破坏，原买入逻辑失效。",
    };
  } else if (assessment.state === SELL_POSITION_STATE.WEAK_CONFIRMED) {
    current = {
      key: "CONFIRMED_WEAK",
      label: "确认转弱",
      tone: "exit",
      action: "卖出全部剩余持仓",
      reason: "个股弱势已经得到板块或市场对照确认，不再等待第二次修复。",
    };
  } else if (passiveAgainstCore) {
    current = {
      key: "EXPECTED_WEAK",
      label: "预期弱",
      tone: "trim",
      action: "当前只标记，明早第一次反抽仍不跟再卖1/2",
      reason: "板块/核心有承接，但本票表现偏被动，先进入卖出观察。",
    };
  } else if (assessment.state === SELL_POSITION_STATE.NORMAL_REALIZATION) {
    current = {
      key: "NORMAL_REALIZATION",
      label: "正常兑现",
      tone: "hold",
      action: "不因资金流出机械卖出",
      reason: "结构和板块承接仍在，兑现不等于资金出逃。",
    };
  } else if (assessment.state === SELL_POSITION_STATE.HOLD_STRONG) {
    current = {
      key: "HOLD",
      label: "继续持有",
      tone: "hold",
      action: "同步核心走强，不卖",
      reason: "没有出现相对被动或结构转弱，继续让强势持仓运行。",
    };
  }

  return {
    principle: "先看板块核心，再看自己的票；核心强、自己不跟，才进入卖出流程。",
    current,
    halfImpact,
    steps: [
      {
        key: "expected",
        label: "预期弱",
        signal: "同板块核心走强，本票明显不跟、冲高更慢或回落更快。",
        action: "先标记，不因一瞬间落后立刻卖；等第一次反抽确认。",
      },
      {
        key: "first_sell",
        label: "第一卖点",
        signal: "核心继续强，本票第一次反抽仍不过分时均价，并且仍落后板块核心。",
        action: `${halfImpact}。`,
      },
      {
        key: "confirmed_weak",
        label: "确认转弱",
        signal: "减仓后仍收不回分时均价/昨日收盘价，或跌破早盘低点，而核心仍强。",
        action: "卖完剩余持仓，不再等第二次修复。",
      },
      {
        key: "cancel",
        label: "撤销卖点",
        signal: "本票重新站回分时均价，并跟上或反超板块核心。",
        action: "停止卖出，剩余仓位继续观察；不追回已经卖出的仓位。",
      },
    ],
    hardLine: "个股结构破位或确认资金出逃，直接卖完；单纯低开、净流出、市场下跌都不能单独触发。",
  };
}

function sellPeerChange(peer) {
  return firstFinite(peer && peer.changePct) ?? 0;
}

function sellPeerAmount(peer) {
  return firstFinite(peer && peer.amountYi, peer && peer.amount) ?? 0;
}

function sellPeerInitiative(peer) {
  return firstFinite(
    peer && peer.initiativeScore,
    peer && peer.leadership && peer.leadership.initiative && peer.leadership.initiative.score,
  ) ?? 0;
}

function sellPeerIdentity(peer) {
  return String(peer && peer.leadership && peer.leadership.identity || peer && peer.identity || "");
}

function sellPeerBoards(peer) {
  const popularity = String(peer && peer.popularity || "");
  const match = popularity.match(/(\d+)天(\d+)板|连板(\d+)|([2-9])板/);
  if (!match) return sellPeerChange(peer) >= 9.5 ? 1 : 0;
  return Number(match[2] || match[3] || match[4] || 1);
}

function sellAnchorItem(peer) {
  return {
    code: String(peer && peer.code || ""),
    name: String(peer && peer.name || peer && peer.code || "--"),
    changePct: round1(sellPeerChange(peer)),
    amountYi: round1(sellPeerAmount(peer)),
    role: String(peer && peer.role || "观察"),
    identity: sellPeerIdentity(peer),
  };
}

function sellNegativeAnchorScore(peer, directionName) {
  const leadership = peer && peer.leadership && typeof peer.leadership === "object" ? peer.leadership : {};
  const initiative = leadership.initiative && typeof leadership.initiative === "object" ? leadership.initiative : {};
  const history = leadership.history && typeof leadership.history === "object" ? leadership.history : {};
  const concepts = Array.isArray(peer && peer.concepts) ? peer.concepts.map(String) : [];
  const directConcept = concepts.includes(String(directionName || ""));
  return Number(leadership.coreIdentityQualified === true) * 50
    + Number(initiative.priceDiscovery && initiative.priceDiscovery.historicalImpact === true) * 40
    + Math.min(30, firstFinite(leadership.impactScore) ?? 0)
    + Number(sellPeerAmount(peer) >= 80) * 20
    + Number(directConcept) * 20
    + Math.min(16, (firstFinite(history.appearances) ?? 0) * 4)
    + Number(String(peer && peer.role || "").includes("龙头")) * 15
    + Math.min(12, sellPeerBoards(peer) * 4);
}

/**
 * 周期驱动的卖出计划：状态与动作严格分离。
 * 顺序固定为 市场周期 -> 方向状态 -> 持仓身份 -> 明日主预期 -> 情景卖法，
 * 但锚点与卖出动作根据当前持仓所在方向动态生成，不使用固定股票模板。
 */
function buildCycleAwareSellPlan(input = {}) {
  const assessment = input.assessment || assessSellPosition(input);
  const market = input.market && typeof input.market === "object" ? input.market : {};
  const holding = input.holding && typeof input.holding === "object"
    ? input.holding
    : input.snapshot && typeof input.snapshot === "object" ? input.snapshot : {};
  const direction = input.direction && typeof input.direction === "object" ? input.direction : {};
  const holdingCode = String(holding.code || "");
  const peers = (Array.isArray(direction.peers) ? direction.peers : [])
    .filter((peer) => peer && String(peer.code || ""));

  const capacityCandidates = peers
    .filter((peer) => String(peer.code || "") !== holdingCode)
    .filter((peer) => sellPeerAmount(peer) >= 20 && sellPeerChange(peer) > 0)
    .sort((left, right) => {
      const score = (peer) => Math.min(200, sellPeerAmount(peer)) * 0.4
        + Math.max(-10, Math.min(20, sellPeerChange(peer))) * 8
        + sellPeerInitiative(peer) * 0.6
        + Number(peer && peer.leadership && peer.leadership.initiative && peer.leadership.initiative.proactive === true) * 20;
      return score(right) - score(left);
    });
  const capacityAnchors = capacityCandidates.slice(0, 3).map(sellAnchorItem);

  const negativeCandidates = peers
    .filter((peer) => String(peer.code || "") !== holdingCode)
    .filter((peer) => sellPeerChange(peer) <= -3)
    .filter((peer) => /历史核心|情绪|龙头|中军/.test(`${sellPeerIdentity(peer)} ${String(peer.role || "")}`))
    .sort((left, right) => {
      const scoreGap = sellNegativeAnchorScore(right, direction.name) - sellNegativeAnchorScore(left, direction.name);
      return scoreGap || sellPeerChange(left) - sellPeerChange(right);
    });
  const negativeAnchors = negativeCandidates.slice(0, 2).map(sellAnchorItem);

  const emotionCandidates = peers
    .filter((peer) => sellPeerChange(peer) >= 9.5 || sellPeerBoards(peer) >= 2)
    .filter((peer) => {
      if (String(peer && peer.code || "") === holdingCode) return true;
      const leadership = peer && peer.leadership && typeof peer.leadership === "object" ? peer.leadership : {};
      const initiative = leadership.initiative && typeof leadership.initiative === "object" ? leadership.initiative : {};
      const priceDiscovery = initiative.priceDiscovery && typeof initiative.priceDiscovery === "object" ? initiative.priceDiscovery : {};
      if (priceDiscovery.noPriceDiscovery === true || priceDiscovery.limitUpDiscoveryUnverified === true) return false;
      return leadership.coreIdentityQualified === true
        || initiative.proactive === true
        || /龙头|情绪核心/.test(String(peer && peer.role || "") + String(leadership.identity || ""));
    })
    .sort((left, right) => {
      const score = (peer) => sellPeerChange(peer) * 5 + sellPeerBoards(peer) * 12 + Number(String(peer.role || "").includes("龙头")) * 10;
      return score(right) - score(left);
    });
  const emotionAnchors = emotionCandidates.slice(0, 2).map(sellAnchorItem);

  const dailyState = market.dailyState && typeof market.dailyState === "object" ? market.dailyState : {};
  const profitEffect = market.profitEffect && typeof market.profitEffect === "object" ? market.profitEffect : {};
  const lossEffect = market.lossEffect && typeof market.lossEffect === "object" ? market.lossEffect : {};
  const profitScore = firstFinite(profitEffect.score);
  const lossScore = firstFinite(lossEffect.score);
  const indexScore = firstFinite(market.metrics && market.metrics.indexScore);
  const marketWeak = dailyState.retreatCandidate === true
    || dailyState.key === "retreat_candidate"
    || (lossScore !== null && lossScore >= 65)
    || (indexScore !== null && indexScore <= 20);
  const marketLabel = `${String(market.cycle || "周期待确认")} · ${String(dailyState.label || market.subPhase || "日内状态待确认")}`;
  const marketFacts = [];
  if (profitScore !== null) marketFacts.push(`赚钱效应${round1(profitScore)}分`);
  if (lossScore !== null) marketFacts.push(`亏钱效应${round1(lossScore)}分`);
  if (Array.isArray(dailyState.reasons)) marketFacts.push(...dailyState.reasons.slice(0, 2).map(String));
  if (!marketFacts.length && Array.isArray(market.summary)) marketFacts.push(...market.summary.slice(0, 3).map(String));

  const holdingChange = firstFinite(holding.changePct) ?? 0;
  const holdingBoards = sellPeerBoards(holding);
  const directionNumbers = peers.map(sellPeerChange).filter(Number.isFinite);
  const directionPositiveCount = directionNumbers.filter((value) => value > 0).length;
  const directionNegativeCount = directionNumbers.filter((value) => value <= -3).length;
  const strongCapacityCount = capacityAnchors.filter((item) => item.changePct >= 3).length;
  const severeNegativeCount = negativeAnchors.filter((item) => item.changePct <= -5).length;
  const internalSplit = strongCapacityCount >= 2 && severeNegativeCount >= 1;
  const broadStrength = directionNumbers.length >= 3
    && directionPositiveCount / directionNumbers.length >= 0.6
    && strongCapacityCount >= 2
    && severeNegativeCount === 0;
  const returnMarker = holdingChange >= 9.5 && (
    holdingBoards >= 2
    || /龙头|方向标|核心/.test(String(holding.role || ""))
    || emotionAnchors.some((item) => item.code === holdingCode)
  );
  const counterTrendMarker = returnMarker && marketWeak;

  let directionLabel = "方向承接待确认";
  let directionSummary = `${String(direction.name || holding.mainConcept || "所属方向")}缺少足够同类票数据，明日先验证而不是预设。`;
  if (internalSplit) {
    directionLabel = "局部强回流 · 内部大分化";
    directionSummary = `容量端已有${strongCapacityCount}只明显走强，但仍有${severeNegativeCount}只老核心处于明显负反馈，不能当成全面修复。`;
  } else if (broadStrength) {
    directionLabel = "板块加强 · 赚钱效应扩散";
    directionSummary = "容量承接与上涨家数同步加强，方向已从单票回流升级为板块共振。";
  } else if (strongCapacityCount >= 1 || returnMarker) {
    directionLabel = "局部回流 · 承接待扩散";
    directionSummary = "已有辨识度个股或容量票回流，但赚钱效应尚未充分扩散。";
  }

  let identityLabel = String(holding.role || "方向内普通持仓");
  let identitySummary = "身份仍需由主动性、容量承接和方向带动性继续验证。";
  if (counterTrendMarker) {
    identityLabel = "逆势回流情绪锚点";
    identitySummary = `在弱市场中上涨${round1(holdingChange)}%，且已有${holdingBoards || 1}板辨识度；明日先按回流后的兑现与加强分支处理。`;
  } else if (returnMarker) {
    identityLabel = "方向回流情绪锚点";
    identitySummary = `上涨${round1(holdingChange)}%并具备连板/涨停辨识度，是方向情绪观察标，但不等于无条件持有。`;
  } else if (assessment.verifiedCore) {
    identityLabel = "系统确认主动核心";
    identitySummary = "主动性、持续辨识度和结构均通过验证，卖点容错高于普通跟随。";
  } else if (sellPeerAmount(holding) >= 50 && sellPeerInitiative(holding) >= 60) {
    identityLabel = "容量承接中军";
    identitySummary = "成交容量与主动性较强，主要用于验证方向资金是否继续承接。";
  } else if (assessment.relativeWeak === true) {
    identityLabel = "方向内被动跟随";
    identitySummary = "相对方向中位数明显落后，必须优先观察第一次反抽能否跟上。";
  }

  let expectationLabel = "明日先验证，再决定卖点";
  let expectationSummary = "先验证市场、方向和持仓身份是否延续，不用单一价格信号替代环境判断。";
  let expectationTone = "neutral";
  if (assessment.state === SELL_POSITION_STATE.ESCAPE || assessment.structureBroken) {
    expectationLabel = "主预期：原逻辑失效，先处理风险";
    expectationSummary = "结构破坏或资金出逃已经成立，不再等待板块修复。";
    expectationTone = "bad";
  } else if (counterTrendMarker) {
    expectationLabel = "主预期：先兑现，再看回流能否升级为板块加强";
    expectationSummary = "弱市场里的逆势涨停次日天然有兑现压力；只有容量锚点共振、老核心止跌且市场负反馈收敛，才把兑现预期升级为继续加强。";
    expectationTone = "warn";
  } else if (returnMarker && internalSplit) {
    expectationLabel = "主预期：分化兑现，次预期：板块加强";
    expectationSummary = "方向内部仍分化，先防高辨识度个股兑现，再看容量承接能否带动扩散。";
    expectationTone = "warn";
  } else if (broadStrength) {
    expectationLabel = "主预期：加强延续，首次分歧再兑现";
    expectationSummary = "方向已经共振加强，不预设开盘卖出；出现相对转弱后才进入卖出流程。";
    expectationTone = "good";
  }

  const capacityNames = capacityAnchors.map((item) => item.name).join("、") || "容量锚点待补";
  const negativeNames = negativeAnchors.map((item) => item.name).join("、") || "负反馈锚点待补";
  const mainAction = assessment.state === SELL_POSITION_STATE.ESCAPE || assessment.structureBroken
    ? "结构破坏或资金出逃已经确认，直接卖完剩余持仓，不等待方向回流。"
    : counterTrendMarker
    ? "出现预期内高开/冲高时先兑现当前持仓1/2；剩余仓位交给板块加强条件验证。"
    : "不预设固定卖出比例；等待环境与个股同时触发。";

  const scenarios = [
    {
      key: "realization",
      label: "主预期 · 回流兑现",
      condition: `${String(holding.name || holding.code || "本票")}高开或冲高，但${capacityNames}没有同步加强。`,
      action: mainAction,
      tone: "warn",
    },
    {
      key: "isolated",
      label: "风险分支 · 单票独强",
      condition: `${String(holding.name || holding.code || "本票")}维持强势，但${capacityNames}不跟，且${negativeNames}继续负反馈。`,
      action: "先卖当前持仓2/3；随后跌破分时均价且反抽不过，卖完剩余仓位。",
      tone: "bad",
    },
    {
      key: "strengthen",
      label: "超预期 · 板块加强",
      condition: `${capacityNames}至少两只继续加强，${negativeNames}止跌，同时市场亏钱效应收敛。`,
      action: "撤销开盘兑现预案，不机械卖；等本票第一次真正弱于容量锚点时再处理。",
      tone: "good",
    },
    {
      key: "below",
      label: "不及预期 · 回流失败",
      condition: `${String(holding.name || holding.code || "本票")}没有涨停溢价、反抽无力，同时容量锚点转弱。`,
      action: "直接处理剩余持仓，不等待第二次反抽。",
      tone: "bad",
    },
  ];

  const dataWarnings = [];
  if (market.dataQuality && Array.isArray(market.dataQuality.issues)) {
    dataWarnings.push(...market.dataQuality.issues.slice(0, 2).map(String));
  }
  const priceDiscovery = holding.leadership && holding.leadership.initiative && holding.leadership.initiative.priceDiscovery;
  if (priceDiscovery && priceDiscovery.noPriceDiscovery === true) {
    dataWarnings.push("当日分时价格发现不足，主动性与带动顺序必须在明日盘中复核");
  }

  return {
    tone: expectationTone,
    currentState: {
      market: { label: marketLabel, summary: marketFacts.join("；") || "市场证据待补" },
      direction: { label: directionLabel, summary: directionSummary, name: String(direction.name || holding.mainConcept || "所属方向") },
      holding: { label: identityLabel, summary: identitySummary },
    },
    anchors: {
      emotion: emotionAnchors,
      capacity: capacityAnchors,
      negative: negativeAnchors,
    },
    primaryExpectation: {
      label: expectationLabel,
      summary: expectationSummary,
      tone: expectationTone,
    },
    scenarios,
    dataWarnings,
    meta: {
      marketWeak,
      returnMarker,
      counterTrendMarker,
      internalSplit,
      broadStrength,
      strongCapacityCount,
      severeNegativeCount,
    },
  };
}

// ============ V7权威卖出状态机：上层日线许可 + 下层1分钟执行 ============
const V7_SELL_STRATEGY_VERSION = 1;
const V7_SELL_STRATEGY_AUTHORITY = "canonical_position_sell_strategy_v7";
const V7_SELL_STRATEGY_METHOD = "layered_upper_context_then_verified_1m_fail_closed_v1";
const V7_COMPARABLE_PRICE_AUTHORITY = "corporate_action_comparable_price_context_v1";
const V7_NEGATIVE_FEEDBACK_AUTHORITY = "canonical_unified_negative_feedback_v1";
const V7_SELL_CFG = Object.freeze({
  hardStopLossPct: 7,
  peakProfitKeepRatio: 0.7,
  limitBreakDrawdownPct: 3,
  limitBreakConfirmMinutes: 5,
  sealRemainingRatio: 0.3,
  sealWeakDurationSeconds: 30,
  sealPartialExitPct: 50,
  negativeFeedbackMa5BiasPct: 10,
  volumeStagnationChangeGapPct: 7,
  deadlineTime: "14:55",
});

function v7Finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function v7Round(value, digits = 4) {
  const number = v7Finite(value);
  if (number === null) return null;
  const scale = 10 ** digits;
  return Math.round(number * scale) / scale;
}

function v7Timestamp(value, tradingDate = "") {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "").trim();
  if (!text) return null;
  const normalized = /^\d{2}:\d{2}(?::\d{2})?$/.test(text)
    ? `${tradingDate || "1970-01-01"}T${text.length === 5 ? `${text}:00` : text}`
    : text.replace(" ", "T");
  const shanghaiLocal = normalized.match(
    /^(20\d{2})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?$/,
  );
  if (shanghaiLocal) {
    const milliseconds = Number(String(shanghaiLocal[7] || "0").padEnd(3, "0"));
    return Date.UTC(
      Number(shanghaiLocal[1]),
      Number(shanghaiLocal[2]) - 1,
      Number(shanghaiLocal[3]),
      Number(shanghaiLocal[4]) - 8,
      Number(shanghaiLocal[5]),
      Number(shanghaiLocal[6] || 0),
      milliseconds,
    );
  }
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function v7MinuteOf(value) {
  const match = String(value || "").match(/(?:T|\s|^)(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function v7BarObservedTimestamp(bar, timestampConvention) {
  const timestamp = v7Finite(bar && bar.timestamp);
  if (timestamp === null) return null;
  return timestamp + (timestampConvention === "BAR_START_ASIA_SHANGHAI" ? 60000 : 0);
}

function v7BarStartTimestamp(bar, timestampConvention) {
  const timestamp = v7Finite(bar && bar.timestamp);
  if (timestamp === null) return null;
  return timestamp - (timestampConvention === "BAR_END_ASIA_SHANGHAI" ? 60000 : 0);
}

function v7BarObservedMinute(bar, timestampConvention) {
  const minute = v7Finite(bar && bar.minute);
  if (minute === null) return null;
  return minute + (timestampConvention === "BAR_START_ASIA_SHANGHAI" ? 1 : 0);
}

function v7TradingDate(value) {
  const match = String(value || "").match(/(20\d{2})[-/]?(\d{2})[-/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function v7StableValue(value) {
  if (Array.isArray(value)) return value.map(v7StableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, v7StableValue(value[key])]));
}

function v7StableSha256(value) {
  if (typeof require !== "function") return null;
  try {
    const crypto = require("node:crypto");
    return crypto.createHash("sha256").update(JSON.stringify(v7StableValue(value))).digest("hex");
  } catch (_error) {
    return null;
  }
}

function v7AtPrice(left, right) {
  const a = v7Finite(left);
  const b = v7Finite(right);
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= Math.max(0.001, Math.abs(b) * 0.00005);
}

function normalizeV7MinuteEvidence(input = {}) {
  const source = input.minuteEvidence && typeof input.minuteEvidence === "object"
    ? input.minuteEvidence : {};
  const selected = source.selectedPriceEvidence && typeof source.selectedPriceEvidence === "object"
    ? source.selectedPriceEvidence : null;
  const blockers = [];
  if (source.authority !== "unified_minute_evidence_hierarchy_v1" || Number(source.version) !== 1) {
    blockers.push("minute_evidence_hierarchy_authority_invalid");
  }
  if (source.executionAuthority === true) blockers.push("minute_hierarchy_must_not_claim_execution_authority");
  if (!selected) blockers.push("minute_selected_evidence_missing");
  let assessment = null;
  try {
    if (typeof require !== "function") throw new Error("validator unavailable");
    const { validateMinutePriceEvidence } = require("./quant-decision/minute-evidence");
    const position = input.position && typeof input.position === "object" ? input.position : {};
    assessment = validateMinutePriceEvidence(selected, {
      code: position.securityId || position.code,
      tradingDate: input.tradingDate,
    });
  } catch (_error) {
    blockers.push("minute_evidence_validator_unavailable");
  }
  if (!assessment || assessment.validForV7 !== true) {
    blockers.push("minute_evidence_revalidation_failed");
    for (const blocker of assessment && Array.isArray(assessment.blockers) ? assessment.blockers : []) {
      blockers.push(`minute_evidence:${blocker}`);
    }
  }
  if (assessment && source.code !== undefined
    && String(source.code || "").match(/\d{6}/)?.[0] !== assessment.code) {
    blockers.push("minute_hierarchy_security_mismatch");
  }
  if (assessment && source.tradingDate !== undefined
    && v7TradingDate(source.tradingDate) !== assessment.tradingDate) {
    blockers.push("minute_hierarchy_trading_date_mismatch");
  }
  const bars = assessment && assessment.validForV7 === true ? assessment.bars : [];
  const timestampConvention = assessment && assessment.timestampConvention || "";
  const tradingDate = assessment && assessment.tradingDate || v7TradingDate(input.tradingDate) || "";
  const normalized = bars.map((bar) => ({
    ...bar,
    timestamp: v7Timestamp(bar.timestamp || bar.datetime || bar.dateTime || bar.time, tradingDate),
    minute: v7Finite(bar.minute) ?? v7MinuteOf(bar.timestamp || bar.datetime || bar.dateTime || bar.time),
    open: v7Finite(bar.open),
    high: v7Finite(bar.high),
    low: v7Finite(bar.low),
    close: v7Finite(bar.close),
    comparableOpen: v7Finite(bar.comparableOpen ?? bar.open),
    comparableHigh: v7Finite(bar.comparableHigh ?? bar.high),
    comparableLow: v7Finite(bar.comparableLow ?? bar.low),
    comparableClose: v7Finite(bar.comparableClose ?? bar.close),
    volume: v7Finite(bar.volume),
    amount: v7Finite(bar.amount ?? bar.money),
  })).filter((bar) => bar.timestamp !== null && bar.minute !== null);
  if (normalized.length !== bars.length) blockers.push("minute_bar_timestamp_invalid");
  if (normalized.some((bar) => [bar.open, bar.high, bar.low, bar.close]
    .some((value) => value === null || value <= 0))) blockers.push("minute_ohlc_invalid");
  const timestamps = normalized.map((bar) => bar.timestamp);
  if (new Set(timestamps).size !== timestamps.length) blockers.push("minute_bar_timestamp_duplicated");
  for (let index = 1; index < normalized.length; index += 1) {
    const gapMinutes = (normalized[index].timestamp - normalized[index - 1].timestamp) / 60000;
    if (!(gapMinutes === 1 || gapMinutes >= 60)) {
      blockers.push("minute_bar_interval_discontinuous");
      break;
    }
  }
  return {
    valid: blockers.length === 0,
    blockers: [...new Set(blockers)],
    bars: normalized,
    tradingDate,
    tier: assessment && assessment.tier || null,
    authority: assessment && assessment.source || null,
    timestampConvention,
  };
}

function detectV7SealDecay(input, highLimitPrice, tradingDate) {
  const evidence = input.sealEvidence && typeof input.sealEvidence === "object"
    ? input.sealEvidence : {};
  const snapshots = Array.isArray(evidence.snapshots) ? evidence.snapshots : [];
  if (!(evidence.verified === true || evidence.status === "verified") || !snapshots.length) {
    return { available: false, triggered: false, blockers: ["seal_tick_evidence_missing"] };
  }
  const maxAllowedGapSeconds = v7Finite(evidence.maxAllowedGapSeconds);
  if (maxAllowedGapSeconds === null || maxAllowedGapSeconds <= 0 || maxAllowedGapSeconds > 10) {
    return { available: false, triggered: false, blockers: ["seal_tick_continuity_policy_invalid"] };
  }
  const rows = snapshots.map((row) => ({
    timestamp: v7Timestamp(row.timestamp || row.time, tradingDate),
    bid1Price: v7Finite(row.bid1Price ?? row.b1_p),
    bid1Volume: v7Finite(row.bid1Volume ?? row.b1_v),
  })).filter((row) => row.timestamp !== null && row.bid1Price !== null && row.bid1Volume !== null)
    .sort((left, right) => left.timestamp - right.timestamp);
  let episodeStart = null;
  let fullMinuteEnd = null;
  let priorTimestamp = null;
  let initial = null;
  let initialIndex = -1;
  let initialEpisodeStart = null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const sealed = v7AtPrice(row.bid1Price, highLimitPrice) && row.bid1Volume > 0;
    const continuous = priorTimestamp === null
      || row.timestamp - priorTimestamp <= maxAllowedGapSeconds * 1000;
    if (!sealed || !continuous) {
      episodeStart = null;
      fullMinuteEnd = null;
      priorTimestamp = row.timestamp;
      if (!sealed) continue;
    }
    if (episodeStart === null) {
      episodeStart = row.timestamp;
      fullMinuteEnd = Math.ceil(row.timestamp / 60000) * 60000 + 60000;
    }
    priorTimestamp = row.timestamp;
    if (row.timestamp >= fullMinuteEnd) {
      initial = row;
      initialIndex = index;
      initialEpisodeStart = episodeStart;
      break;
    }
  }
  if (!initial) {
    return {
      available: false,
      triggered: false,
      blockers: ["seal_initial_full_minute_not_covered"],
      coverageStartTimestamp: rows[0] && rows[0].timestamp || null,
      coverageEndTimestamp: rows.at(-1) && rows.at(-1).timestamp || null,
    };
  }
  const threshold = initial.bid1Volume * V7_SELL_CFG.sealRemainingRatio;
  let weakStartedAt = null;
  let previousWeakTimestamp = null;
  for (const row of rows.slice(initialIndex + 1)) {
    const weak = v7AtPrice(row.bid1Price, highLimitPrice) && row.bid1Volume <= threshold;
    if (!weak) {
      weakStartedAt = null;
      previousWeakTimestamp = null;
      continue;
    }
    if (previousWeakTimestamp !== null
      && row.timestamp - previousWeakTimestamp > maxAllowedGapSeconds * 1000) {
      weakStartedAt = row.timestamp;
    }
    if (weakStartedAt === null) weakStartedAt = row.timestamp;
    previousWeakTimestamp = row.timestamp;
    if (row.timestamp - weakStartedAt >= V7_SELL_CFG.sealWeakDurationSeconds * 1000) {
      return {
        available: true,
        triggered: true,
        triggeredAt: row.timestamp,
        initialSealTimestamp: initial.timestamp,
        firstSealTimestamp: initialEpisodeStart,
        initialSealVolume: initial.bid1Volume,
        thresholdVolume: threshold,
        observedVolume: row.bid1Volume,
        blockers: [],
        coverageStartTimestamp: rows[0].timestamp,
        coverageEndTimestamp: rows.at(-1).timestamp,
      };
    }
  }
  return {
    available: true,
    triggered: false,
    initialSealTimestamp: initial.timestamp,
    firstSealTimestamp: initialEpisodeStart,
    initialSealVolume: initial.bid1Volume,
    thresholdVolume: threshold,
    blockers: [],
    coverageStartTimestamp: rows[0].timestamp,
    coverageEndTimestamp: rows.at(-1).timestamp,
  };
}

function v7Ma5(previousFourCloses, currentPrice) {
  const closes = Array.isArray(previousFourCloses)
    ? previousFourCloses.map(v7Finite).filter((value) => value !== null && value > 0) : [];
  return closes.length === 4 && currentPrice > 0
    ? (closes.reduce((sum, value) => sum + value, 0) + currentPrice) / 5
    : null;
}

function runV7SellPath(input, minute, options = {}) {
  const position = input.position && typeof input.position === "object" ? input.position : {};
  const daily = input.dailyContext && typeof input.dailyContext === "object" ? input.dailyContext : {};
  const upper = input.upperLayer && typeof input.upperLayer === "object" ? input.upperLayer : {};
  const upperPayload = upper.payload && typeof upper.payload === "object" ? upper.payload : {};
  const upperPayloadHash = v7StableSha256(upperPayload);
  const upperContextTimestamp = v7Timestamp(
    upperPayload.sourceTimestamp || upperPayload.asOf,
    minute.tradingDate,
  );
  const upperIdentityVerified = upper.authority === "canonical_sell_upper_context_v1"
    && upperPayloadHash !== null
    && upper.canonicalPayloadHash === upperPayloadHash
    && v7TradingDate(upperPayload.tradingDate) === minute.tradingDate
    && typeof upperPayload.generationId === "string"
    && upperPayload.generationId.trim().length > 0
    && /^[a-f0-9]{64}$/.test(String(upperPayload.sourceDecisionHash || ""))
    && upperContextTimestamp !== null;
  const priceBasis = position.priceBasis && typeof position.priceBasis === "object"
    ? position.priceBasis : {};
  const pricePayload = priceBasis.payload && typeof priceBasis.payload === "object"
    ? priceBasis.payload : {};
  const entryPrice = v7Finite(pricePayload.comparableEntryPrice);
  const entryFillTimestamp = v7Timestamp(pricePayload.entryFillTimestamp, minute.tradingDate);
  const highestPriceAsOf = v7Timestamp(
    pricePayload.comparableHighestPriceSinceEntryAsOf,
    minute.tradingDate,
  );
  const minutePriceMultiplier = v7Finite(pricePayload.minutePriceMultiplier);
  const highLimitPrice = v7Finite(daily.highLimitPrice);
  const lowLimitPrice = v7Finite(daily.lowLimitPrice);
  const rawPreviousClose = v7Finite(daily.previousClose);
  const previousClose = v7Finite(pricePayload.comparablePreviousClose);
  const previousDayVolume = v7Finite(daily.previousDayVolume);
  const twoDaysAgoVolume = v7Finite(daily.twoDaysAgoVolume);
  const previousDayChangePct = v7Finite(daily.previousDayChangePct);
  const previousTradingDate = v7TradingDate(daily.previousTradingDate);
  const blockers = [];
  const pricePayloadHash = v7StableSha256(pricePayload);
  const positionCode = (String(position.securityId || position.code || "").match(/\d{6}/) || [""])[0];
  const payloadCode = (String(pricePayload.securityId || "").match(/\d{6}/) || [""])[0];
  let fullSecurityIdentityAligned = false;
  try {
    if (typeof require !== "function") throw new Error("validator unavailable");
    const { securityIdentity } = require("./quant-decision/minute-evidence");
    const positionSecurity = securityIdentity(position.securityId || position.code);
    const priceSecurity = securityIdentity(pricePayload.securityId);
    fullSecurityIdentityAligned = positionSecurity.exchangeConsistent
      && priceSecurity.exchangeConsistent
      && positionSecurity.code === priceSecurity.code
      && positionSecurity.exchange === priceSecurity.exchange;
  } catch (_error) {
    fullSecurityIdentityAligned = false;
  }
  if (priceBasis.verified !== true
    || priceBasis.authority !== V7_COMPARABLE_PRICE_AUTHORITY
    || pricePayloadHash === null
    || priceBasis.canonicalPayloadHash !== pricePayloadHash
    || !/^[a-f0-9]{64}$/.test(String(pricePayload.sourceHash || ""))
    || v7TradingDate(pricePayload.tradingDate) !== minute.tradingDate
    || !String(pricePayload.generationId || "").trim()
    || pricePayload.generationId !== position.generationId
    || v7TradingDate(position.tradingDate) !== minute.tradingDate
    || !positionCode
    || payloadCode !== positionCode
    || !fullSecurityIdentityAligned
    || minutePriceMultiplier === null
    || minutePriceMultiplier <= 0) {
    blockers.push("comparable_price_context_invalid");
  }
  const firstBarStartTimestamp = minute.bars.length
    ? v7BarStartTimestamp(minute.bars[0], minute.timestampConvention) : null;
  const managementDeadlineTimestamp = v7Timestamp(
    `${minute.tradingDate} ${V7_SELL_CFG.deadlineTime}:00`,
  );
  const entryFillDate = v7TradingDate(pricePayload.entryFillTimestamp);
  if (entryFillTimestamp === null) blockers.push("entry_fill_timestamp_missing");
  if (highestPriceAsOf === null) blockers.push("highest_price_as_of_missing");
  if (entryFillTimestamp !== null && highestPriceAsOf !== null && highestPriceAsOf < entryFillTimestamp) {
    blockers.push("highest_price_as_of_precedes_entry_fill");
  }
  const hwmPointInTimeCutoff = entryFillDate === minute.tradingDate
    ? entryFillTimestamp : firstBarStartTimestamp;
  if (highestPriceAsOf !== null && hwmPointInTimeCutoff !== null
    && highestPriceAsOf > hwmPointInTimeCutoff) {
    blockers.push("highest_price_as_of_uses_current_session_future_data");
  }
  if (entryFillDate !== minute.tradingDate) {
    const previousSessionClose = previousTradingDate
      ? v7Timestamp(`${previousTradingDate} 15:00:00`) : null;
    if (!previousTradingDate) blockers.push("previous_trading_date_missing");
    if (highestPriceAsOf !== null && (
      v7TradingDate(pricePayload.comparableHighestPriceSinceEntryAsOf) !== previousTradingDate
      || previousSessionClose === null
      || highestPriceAsOf < previousSessionClose
    )) blockers.push("highest_price_history_not_covered_through_previous_session_close");
  }
  if (position.sellable === false && entryFillDate !== minute.tradingDate) {
    blockers.push("t1_entry_fill_date_mismatch");
  }
  if (position.sellable === false && entryFillTimestamp !== null
    && entryFillTimestamp > managementDeadlineTimestamp) {
    blockers.push("t1_entry_fill_after_management_deadline");
  }
  if (position.sellable !== false && entryFillDate === minute.tradingDate) {
    blockers.push("sellable_position_conflicts_with_same_day_entry");
  }
  if (entryPrice === null || entryPrice <= 0) blockers.push("entry_price_missing");
  if (rawPreviousClose === null || rawPreviousClose <= 0) blockers.push("raw_previous_close_missing");
  if (previousClose === null || previousClose <= 0) blockers.push("comparable_previous_close_missing");
  if (highLimitPrice === null || highLimitPrice <= 0) blockers.push("high_limit_price_missing");
  if (lowLimitPrice === null || lowLimitPrice <= 0) blockers.push("low_limit_price_missing");
  const previousFourCloses = Array.isArray(pricePayload.comparablePreviousFourCloses)
    ? pricePayload.comparablePreviousFourCloses : [];
  if (previousFourCloses.map(v7Finite).filter((value) => value !== null && value > 0).length !== 4) {
    blockers.push("previous_four_closes_missing");
  }
  if (blockers.length) {
    return {
      status: "unavailable",
      strategyVariant: options.variant,
      executionAuthority: false,
      blockers: [...new Set(blockers)],
      events: [],
      finalAction: "DATA_MISSING",
    };
  }

  const events = [];
  const actualRemainingPct = Math.max(0, Math.min(100, v7Finite(position.remainingPositionPct) ?? 100));
  let targetRemainingPct = actualRemainingPct;
  let highestPrice = Math.max(
    entryPrice,
    v7Finite(pricePayload.comparableHighestPriceSinceEntry) || entryPrice,
  );
  let hitLimit = false;
  let limitBreakStarted = false;
  let notResealedBars = 0;
  let sealApplied = position.sealHalfExitTaken === true;
  let cumulativeVolume = 0;
  const seal = options.seal || { available: false, triggered: false };
  const deadlineMinute = t2m(V7_SELL_CFG.deadlineTime);
  const applySealIntent = (bar) => {
    const observedTimestamp = v7BarObservedTimestamp(bar, minute.timestampConvention);
    if (sealApplied || !seal.triggered || observedTimestamp < seal.triggeredAt) return;
    const requestedExitPct = actualRemainingPct * (V7_SELL_CFG.sealPartialExitPct / 100);
    targetRemainingPct = Math.max(0, actualRemainingPct - requestedExitPct);
    sealApplied = true;
    events.push({
      key: "seal_decay_partial_exit",
      at: new Date(seal.triggeredAt).toISOString(),
      action: "CREATE_PARTIAL_EXIT_INTENT",
      requestedExitPct: v7Round(requestedExitPct),
      targetRemainingPct: v7Round(targetRemainingPct),
      fillRule: "NEXT_1M_BAR_OPEN_OR_EXIT_BLOCKED",
      reason: "涨停买一封单连续30秒不高于初始封单量30%，申请卖出当前仓位的一半",
    });
  };

  if (position.sellable === false) {
    const hardStopPrice = v7Round(entryPrice * (1 - V7_SELL_CFG.hardStopLossPct / 100), 6);
    const postFillBars = minute.bars.filter((bar) => (
      v7BarStartTimestamp(bar, minute.timestampConvention) >= entryFillTimestamp
    ));
    const lockedTrigger = postFillBars.find((bar) => (
      bar.low <= lowLimitPrice
      || v7AtPrice(bar.close, lowLimitPrice)
      || bar.low * minutePriceMultiplier <= hardStopPrice
    ));
    if (lockedTrigger) {
      events.push({
        key: "stop_triggered_while_t1_locked",
        at: new Date(v7BarObservedTimestamp(lockedTrigger, minute.timestampConvention)).toISOString(),
        action: "PERSIST_FULL_EXIT_INTENT",
        requestedExitPct: actualRemainingPct,
        targetRemainingPct: 0,
        triggerPrice: v7Round(hardStopPrice),
        reason: "买入日触发强制风险条件但受A股T+1约束，卖出意图持续到首个可卖时点",
      });
      return {
        status: "t1_locked_full_exit_pending",
        strategyVariant: options.variant,
        executionAuthority: false,
        blockers: [],
        events,
        finalAction: "PERSIST_FULL_EXIT_INTENT",
        actualRemainingPositionPct: actualRemainingPct,
        targetRemainingPositionPct: 0,
      };
    }
    return {
      status: "entry_day_t1_locked",
      strategyVariant: options.variant,
      executionAuthority: false,
      blockers: [],
      events,
      finalAction: "HOLD_LOCKED",
      actualRemainingPositionPct: actualRemainingPct,
      targetRemainingPositionPct: actualRemainingPct,
    };
  }

  for (const bar of minute.bars) {
    const observedTimestamp = v7BarObservedTimestamp(bar, minute.timestampConvention);
    const observedMinute = v7BarObservedMinute(bar, minute.timestampConvention);
    if (observedMinute > deadlineMinute) break;
    const highestBeforeBar = highestPrice;
    const comparableHigh = bar.high * minutePriceMultiplier;
    const comparableLow = bar.low * minutePriceMultiplier;
    const comparableClose = bar.close * minutePriceMultiplier;
    cumulativeVolume += Math.max(0, bar.volume || 0);

    if (bar.low <= lowLimitPrice || v7AtPrice(bar.close, lowLimitPrice)) {
      events.push({
        key: "limit_down_full_exit_order",
        at: new Date(observedTimestamp).toISOString(),
        action: "SUBMIT_FULL_EXIT",
        requestedExitPct: actualRemainingPct,
        targetRemainingPct: 0,
        executionStatus: "PENDING_OR_BLOCKED",
        reason: "触及权威跌停价，无条件提交卖出；未成交不得视为已退出",
      });
      return {
        status: "exit_order_submitted",
        strategyVariant: options.variant,
        executionAuthority: false,
        blockers: [],
        events,
        finalAction: "SUBMIT_FULL_EXIT",
        actualRemainingPositionPct: actualRemainingPct,
        targetRemainingPositionPct: 0,
        exitBlockedPossible: true,
      };
    }

    const hardStopPrice = v7Round(entryPrice * (1 - V7_SELL_CFG.hardStopLossPct / 100), 6);
    if (comparableLow <= hardStopPrice) {
      events.push({
        key: "hard_stop_full_exit",
        at: new Date(observedTimestamp).toISOString(),
        action: "CREATE_FULL_EXIT_INTENT",
        requestedExitPct: actualRemainingPct,
        targetRemainingPct: 0,
        triggerPrice: v7Round(hardStopPrice),
        fillRule: "NEXT_1M_BAR_OPEN_OR_EXIT_BLOCKED",
        reason: "相对实际成交价亏损达到7%，无条件止损",
      });
      return {
        status: "full_exit_intent_generated",
        strategyVariant: options.variant,
        executionAuthority: false,
        blockers: [],
        events,
        finalAction: "CREATE_FULL_EXIT_INTENT",
        actualRemainingPositionPct: actualRemainingPct,
        targetRemainingPositionPct: 0,
      };
    }

    const protectionActive = highestBeforeBar > entryPrice
      && (position.trendExtensionActive === true || hitLimit === true);
    const intradayProfitProtectionPrice = entryPrice
      + Math.max(0, highestBeforeBar - entryPrice) * V7_SELL_CFG.peakProfitKeepRatio;
    if (observedMinute < deadlineMinute
      && protectionActive
      && comparableLow <= intradayProfitProtectionPrice) {
      events.push({
        key: "peak_profit_70_intraday_exit",
        at: new Date(observedTimestamp).toISOString(),
        action: "CREATE_FULL_EXIT_INTENT",
        requestedExitPct: actualRemainingPct,
        targetRemainingPct: 0,
        triggerPrice: v7Round(intradayProfitProtectionPrice),
        profitProtectionPrice: v7Round(intradayProfitProtectionPrice),
        fillRule: "NEXT_1M_BAR_OPEN_OR_EXIT_BLOCKED",
        reason: "趋势仓或涨停仓盘中跌破持仓最高浮盈70%保护线",
      });
      return {
        status: "full_exit_intent_generated",
        strategyVariant: options.variant,
        executionAuthority: false,
        blockers: [],
        events,
        finalAction: "CREATE_FULL_EXIT_INTENT",
        actualRemainingPositionPct: actualRemainingPct,
        targetRemainingPositionPct: 0,
      };
    }

    const sealedNow = v7AtPrice(bar.close, highLimitPrice);
    const hitLimitBeforeBar = hitLimit;
    const limitBreakPercentagePoints = rawPreviousClose > 0
      ? (highLimitPrice - bar.low) / rawPreviousClose * 100 : null;
    const breakTriggeredThisBar = hitLimitBeforeBar
      && !limitBreakStarted
      && !sealedNow
      && limitBreakPercentagePoints >= V7_SELL_CFG.limitBreakDrawdownPct;
    if (breakTriggeredThisBar) {
      limitBreakStarted = true;
      notResealedBars = 0;
    } else if (limitBreakStarted) {
      if (sealedNow) {
        limitBreakStarted = false;
        notResealedBars = 0;
      } else notResealedBars += 1;
      if (notResealedBars >= V7_SELL_CFG.limitBreakConfirmMinutes) {
        const profitProtectionPrice = entryPrice + Math.max(0, highestBeforeBar - entryPrice)
          * V7_SELL_CFG.peakProfitKeepRatio;
        if (comparableClose < profitProtectionPrice) {
          events.push({
            key: "limit_break_protection_exit",
            at: new Date(observedTimestamp).toISOString(),
            action: "CREATE_FULL_EXIT_INTENT",
            requestedExitPct: actualRemainingPct,
            targetRemainingPct: 0,
            fillRule: "NEXT_1M_BAR_OPEN_OR_EXIT_BLOCKED",
            profitProtectionPrice: v7Round(profitProtectionPrice),
            reason: "涨停回落3个百分点后的5个完整一分钟均未回封，并跌破最高浮盈70%保护线",
          });
          return {
            status: "full_exit_intent_generated",
            strategyVariant: options.variant,
            executionAuthority: false,
            blockers: [],
            events,
            finalAction: "CREATE_FULL_EXIT_INTENT",
            actualRemainingPositionPct: actualRemainingPct,
            targetRemainingPositionPct: 0,
          };
        }
        limitBreakStarted = false;
        notResealedBars = 0;
        events.push({
          key: "limit_break_observed_above_protection",
          at: new Date(observedTimestamp).toISOString(),
          action: "WAIT_UNTIL_14_55",
          portionPct: 0,
          profitProtectionPrice: v7Round(profitProtectionPrice),
          reason: "炸板确认但仍在保护线上，转入14:55最终判定",
        });
      }
    }

    hitLimit = hitLimit || bar.high >= highLimitPrice || sealedNow;
    highestPrice = Math.max(highestPrice, comparableHigh);
    if (observedMinute < deadlineMinute) {
      applySealIntent(bar);
      continue;
    }
    const ma5 = v7Ma5(previousFourCloses, comparableClose);
    const profitProtectionPrice = entryPrice + Math.max(0, highestBeforeBar - entryPrice)
      * V7_SELL_CFG.peakProfitKeepRatio;
    const finalProtectionPrice = Math.max(ma5 || -Infinity, profitProtectionPrice);
    const gainPct = (comparableClose / entryPrice - 1) * 100;
    const ma5BiasPct = ma5 ? (comparableClose / ma5 - 1) * 100 : null;
    const todayChangePct = previousClose ? (comparableClose / previousClose - 1) * 100 : null;
    const volumeEvidenceAvailable = previousDayVolume !== null && previousDayVolume > 0
      && twoDaysAgoVolume !== null && twoDaysAgoVolume > 0 && previousDayChangePct !== null;
    const volumeStagnation = volumeEvidenceAvailable
      && cumulativeVolume > Math.max(previousDayVolume, twoDaysAgoVolume)
      && previousDayChangePct - todayChangePct >= V7_SELL_CFG.volumeStagnationChangeGapPct;
    const negativeFeedback = upper.negativeFeedback && typeof upper.negativeFeedback === "object"
      ? upper.negativeFeedback : {};
    const negativePayload = negativeFeedback.payload && typeof negativeFeedback.payload === "object"
      ? negativeFeedback.payload : {};
    const negativePayloadHash = v7StableSha256(negativePayload);
    const negativeFeedbackTimestamp = v7Timestamp(
      negativePayload.sourceTimestamp || negativePayload.asOf,
      minute.tradingDate,
    );
    const negativeFeedbackVerified = negativeFeedback.verified === true
      && negativeFeedback.authority === V7_NEGATIVE_FEEDBACK_AUTHORITY
      && negativePayloadHash !== null
      && negativeFeedback.canonicalPayloadHash === negativePayloadHash
      && v7TradingDate(negativePayload.tradingDate) === minute.tradingDate
      && typeof negativePayload.generationId === "string"
      && negativePayload.generationId.trim().length > 0
      && /^[a-f0-9]{64}$/.test(String(negativePayload.sourceDecisionHash || ""))
      && negativePayload.generationId === upperPayload.generationId
      && negativePayload.sourceDecisionHash === upperPayload.sourceDecisionHash
      && negativeFeedbackTimestamp !== null
      && negativeFeedbackTimestamp <= observedTimestamp;
    const negativeOverextended = negativeFeedbackVerified && negativePayload.active === true
      && ma5BiasPct !== null && ma5BiasPct > V7_SELL_CFG.negativeFeedbackMa5BiasPct;
    const upperVerified = upperIdentityVerified && upperContextTimestamp <= observedTimestamp;
    const trendQualified = upperVerified && upperPayload.trendQualified === true;
    const deadlineBlockers = [];
    if (!upperVerified) deadlineBlockers.push("sell_upper_context_invalid");
    if (!volumeEvidenceAvailable) deadlineBlockers.push("volume_stagnation_evidence_missing");
    if (!negativeFeedbackVerified) deadlineBlockers.push("negative_feedback_evidence_missing");
    if (deadlineBlockers.length) {
      events.push({
        key: "deadline_evidence_missing_defensive_exit",
        at: new Date(observedTimestamp).toISOString(),
        action: "CREATE_FULL_EXIT_INTENT",
        requestedExitPct: actualRemainingPct,
        targetRemainingPct: 0,
        fillRule: "NEXT_1M_BAR_OPEN_OR_EXIT_BLOCKED",
        reason: "14:55延长持有证据不完整，失败关闭并退出",
      });
      return {
        status: "incomplete_defensive_exit",
        strategyVariant: options.variant,
        executionAuthority: false,
        blockers: deadlineBlockers,
        events,
        finalAction: "CREATE_FULL_EXIT_INTENT",
        actualRemainingPositionPct: actualRemainingPct,
        targetRemainingPositionPct: 0,
      };
    }
    let exitKey = null;
    let exitReason = null;
    if (negativeOverextended) {
      exitKey = "negative_feedback_overextended_exit";
      exitReason = "权威负反馈出现且个股MA5正乖离超过10%";
    } else if (volumeStagnation) {
      exitKey = "volume_stagnation_exit";
      exitReason = "14:55累计成交量超过前两日最大值，且前一日涨幅领先当日不少于7个百分点";
    } else if (!trendQualified) {
      exitKey = "trend_extension_not_qualified";
      exitReason = "未取得强势趋势延长身份";
    } else if (!(gainPct > 0)) {
      exitKey = "floating_profit_lost_exit";
      exitReason = "趋势仓延长前提为仍有浮盈";
    } else if (comparableClose < ma5) {
      exitKey = "ma5_deadline_exit";
      exitReason = "14:55仍在个股MA5下方";
    } else if (comparableLow <= profitProtectionPrice) {
      exitKey = "peak_profit_70_protection_exit";
      exitReason = "跌破持仓最高浮盈70%保护价";
    }
    if (exitKey) {
      events.push({
        key: exitKey,
        at: new Date(observedTimestamp).toISOString(),
        action: "CREATE_FULL_EXIT_INTENT",
        requestedExitPct: actualRemainingPct,
        targetRemainingPct: 0,
        fillRule: "NEXT_1M_BAR_OPEN_OR_EXIT_BLOCKED",
        ma5: v7Round(ma5),
        ma5BiasPct: v7Round(ma5BiasPct),
        profitProtectionPrice: v7Round(profitProtectionPrice),
        reason: exitReason,
      });
      return {
        status: "full_exit_intent_generated",
        strategyVariant: options.variant,
        executionAuthority: false,
        blockers: [],
        events,
        finalAction: "CREATE_FULL_EXIT_INTENT",
        actualRemainingPositionPct: actualRemainingPct,
        targetRemainingPositionPct: 0,
      };
    }
    applySealIntent(bar);
    events.push({
      key: "trend_hold_above_ma5_and_profit_protection",
      at: new Date(observedTimestamp).toISOString(),
      action: "HOLD",
      portionPct: 0,
      ma5: v7Round(ma5),
      ma5BiasPct: v7Round(ma5BiasPct),
      profitProtectionPrice: v7Round(profitProtectionPrice),
      reason: "仍有浮盈，且14:55同时站在个股MA5和最高浮盈70%保护线上方",
    });
    return {
      status: "trend_hold",
      strategyVariant: options.variant,
      executionAuthority: false,
      blockers: [],
      events,
      finalAction: targetRemainingPct < actualRemainingPct ? "PARTIAL_EXIT_INTENT_AND_HOLD" : "HOLD",
      actualRemainingPositionPct: actualRemainingPct,
      targetRemainingPositionPct: v7Round(targetRemainingPct),
    };
  }
  return {
    status: "unavailable",
    strategyVariant: options.variant,
    executionAuthority: false,
    blockers: ["deadline_14_55_bar_missing"],
    events,
    finalAction: "DATA_MISSING",
    actualRemainingPositionPct: actualRemainingPct,
    targetRemainingPositionPct: v7Round(targetRemainingPct),
  };
}

function evaluateV7MinuteSell(input = {}) {
  const minute = normalizeV7MinuteEvidence(input);
  if (!minute.valid) {
    return {
      version: V7_SELL_STRATEGY_VERSION,
      authority: V7_SELL_STRATEGY_AUTHORITY,
      method: V7_SELL_STRATEGY_METHOD,
      status: "unavailable",
      executionAuthority: false,
      formalPerformanceEligible: false,
      authorityBindingStatus: "pending_validated_dataset_manifest_and_receipt_anchor",
      blockers: minute.blockers,
      upperLayer: { status: "not_executed" },
      lowerLayer: { core1m: null, full1mTick: null, combineMetrics: false },
    };
  }
  const position = input.position && typeof input.position === "object" ? input.position : {};
  const hierarchySeal = input.minuteEvidence && input.minuteEvidence.sealTickEvidence;
  const deadlineTimestamp = v7Timestamp(`${minute.tradingDate} ${V7_SELL_CFG.deadlineTime}:00`);
  let revalidatedSeal = null;
  const sealValidationBlockers = [];
  if (hierarchySeal && hierarchySeal.validForSealRule === true) {
    try {
      if (typeof require !== "function") throw new Error("validator unavailable");
      const { validateSealTickEvidence } = require("./quant-decision/minute-evidence");
      if (hierarchySeal.validationAuthority !== "unified_minute_evidence_hierarchy_v1"
        || hierarchySeal.evidenceType !== "seal_tick"
        || hierarchySeal.quoteChangesIncludedVerified !== true
        || hierarchySeal.executionAuthority !== false
        || hierarchySeal.proxyUsed !== false) {
        sealValidationBlockers.push("seal_tick_hierarchy_binding_invalid");
      } else {
        revalidatedSeal = validateSealTickEvidence({
          evidenceType: "seal_tick",
          source: hierarchySeal.source,
          code: hierarchySeal.code,
          tradingDate: hierarchySeal.tradingDate,
          quoteChangesIncluded: true,
          executionAuthority: hierarchySeal.executionAuthority,
          contentHash: hierarchySeal.contentHash,
          contentHashScope: hierarchySeal.contentHashScope,
          ticks: hierarchySeal.ticks,
        }, {
          code: position && (position.securityId || position.code),
          tradingDate: minute.tradingDate,
        });
        if (revalidatedSeal.validForSealRule !== true) {
          sealValidationBlockers.push("seal_tick_hierarchy_revalidation_failed");
          sealValidationBlockers.push(...revalidatedSeal.blockers);
        }
      }
    } catch (_error) {
      sealValidationBlockers.push("seal_tick_validator_unavailable");
    }
  }
  const sealEvidence = revalidatedSeal && revalidatedSeal.validForSealRule === true ? {
    status: "verified",
    verified: true,
    snapshots: (Array.isArray(revalidatedSeal.ticks) ? revalidatedSeal.ticks : []).filter((row) => {
      const timestamp = v7Timestamp(row && (row.timestamp || row.time), minute.tradingDate);
      return timestamp !== null && timestamp <= deadlineTimestamp;
    }),
    maxAllowedGapSeconds: revalidatedSeal.maxAllowedGapSeconds,
  } : null;
  const normalizedInput = { ...input, sealEvidence };
  const daily = input.dailyContext && typeof input.dailyContext === "object" ? input.dailyContext : {};
  const highLimitPrice = v7Finite(daily.highLimitPrice);
  const activeBars = minute.bars.filter((bar) => (
    v7BarObservedTimestamp(bar, minute.timestampConvention) <= deadlineTimestamp
  ));
  const firstLimitBar = highLimitPrice !== null
    ? activeBars.find((bar) => bar.high >= highLimitPrice) : null;
  let seal = detectV7SealDecay(normalizedInput, highLimitPrice, minute.tradingDate);
  if (firstLimitBar && seal.available) {
    const firstLimitIndex = activeBars.indexOf(firstLimitBar);
    const firstBreakBar = activeBars.slice(firstLimitIndex + 1)
      .find((bar) => !v7AtPrice(bar.close, highLimitPrice));
    const allowedGapMs = Math.max(1, v7Finite(sealEvidence && sealEvidence.maxAllowedGapSeconds) || 5) * 1000;
    const firstLimitWindowStart = minute.timestampConvention === "BAR_START_ASIA_SHANGHAI"
      ? firstLimitBar.timestamp : firstLimitBar.timestamp - 60000;
    const firstLimitWindowEnd = minute.timestampConvention === "BAR_START_ASIA_SHANGHAI"
      ? firstLimitBar.timestamp + 60000 : firstLimitBar.timestamp;
    const coverageStartsAtFirstSeal = seal.firstSealTimestamp !== null
      && seal.firstSealTimestamp >= firstLimitWindowStart - allowedGapMs
      && seal.firstSealTimestamp <= firstLimitWindowEnd + allowedGapMs;
    const requiredEndTimestamp = seal.triggered
      ? seal.triggeredAt
      : firstBreakBar
        ? v7BarObservedTimestamp(firstBreakBar, minute.timestampConvention)
        : deadlineTimestamp;
    const coverageEndsAfterResolution = seal.coverageEndTimestamp >= requiredEndTimestamp;
    if (!coverageStartsAtFirstSeal || !coverageEndsAfterResolution) {
      seal = {
        available: false,
        triggered: false,
        blockers: [
          !coverageStartsAtFirstSeal ? "seal_tick_does_not_cover_first_limit_touch" : null,
          !coverageEndsAfterResolution ? "seal_tick_coverage_ends_before_rule_resolution" : null,
        ].filter(Boolean),
      };
    }
  }
  const core1m = runV7SellPath(normalizedInput, minute, { variant: "CORE_1M", seal: null });
  const actualRemainingPct = Math.max(0, Math.min(100, v7Finite(position.remainingPositionPct) ?? 100));
  const sealRuleReachedWhileOpen = Boolean(
    position.sellable !== false && actualRemainingPct > 0 && firstLimitBar,
  );
  let full1mTick;
  if (sealRuleReachedWhileOpen && !seal.available) {
    full1mTick = {
      status: "unavailable",
      strategyVariant: "FULL_1M_TICK",
      executionAuthority: false,
      blockers: [...new Set([...sealValidationBlockers, ...seal.blockers])],
      events: [],
      finalAction: "DATA_MISSING",
      rule: "发生涨停时必须具备真实买一封单快照；一分钟成交量不得代理封单量",
    };
  } else {
    full1mTick = runV7SellPath(normalizedInput, minute, { variant: "FULL_1M_TICK", seal });
  }
  const coreIncomplete = core1m.status === "unavailable" || String(core1m.status || "").startsWith("incomplete");
  const fullUnavailable = full1mTick.status === "unavailable";
  const fullIncomplete = fullUnavailable || String(full1mTick.status || "").startsWith("incomplete");
  const status = core1m.status === "unavailable" ? "unavailable"
    : fullUnavailable
    ? coreIncomplete ? "incomplete_core_only" : "core_only"
    : coreIncomplete || fullIncomplete ? "incomplete" : "complete";
  const pathBlockers = [...new Set([
    ...(Array.isArray(core1m.blockers) ? core1m.blockers : []),
    ...(Array.isArray(full1mTick.blockers) ? full1mTick.blockers : []),
  ])];
  const upperContext = input.upperLayer && typeof input.upperLayer === "object" ? input.upperLayer : {};
  const upperPayload = upperContext.payload && typeof upperContext.payload === "object"
    ? upperContext.payload : {};
  const upperContextVerified = upperContext.authority === "canonical_sell_upper_context_v1"
    && upperContext.canonicalPayloadHash === v7StableSha256(upperPayload)
    && v7TradingDate(upperPayload.tradingDate) === minute.tradingDate
    && String(upperPayload.generationId || "").trim().length > 0
    && /^[a-f0-9]{64}$/.test(String(upperPayload.sourceDecisionHash || ""))
    && v7Timestamp(upperPayload.sourceTimestamp || upperPayload.asOf, minute.tradingDate) !== null
    && v7Timestamp(
      upperPayload.sourceTimestamp || upperPayload.asOf,
      minute.tradingDate,
    ) <= deadlineTimestamp;
  return {
    version: V7_SELL_STRATEGY_VERSION,
    authority: V7_SELL_STRATEGY_AUTHORITY,
    method: V7_SELL_STRATEGY_METHOD,
    status,
    executionAuthority: false,
    formalPerformanceEligible: false,
    authorityBindingStatus: "pending_validated_dataset_manifest_and_receipt_anchor",
    blockers: pathBlockers,
    upperLayer: {
      status: upperContextVerified ? "verified" : "invalid",
      trendQualified: Boolean(upperContextVerified && upperPayload.trendQualified === true),
      negativeFeedback: input.upperLayer && input.upperLayer.negativeFeedback || null,
    },
    evidence: {
      minuteTier: minute.tier,
      minuteAuthority: minute.authority,
      sealTickAvailable: seal.available,
      sealDecayTriggered: seal.triggered,
    },
    lowerLayer: {
      core1m,
      full1mTick,
      combineMetrics: false,
      rule: "CORE_1M与FULL_1M_TICK必须分别报告，禁止把缺盘口样本混入完整策略绩效",
    },
  };
}

const sellEngineApi = {
  SELL_CFG, ACCOUNT_CFG,
  SELL_POSITION_STATE,
  evaluateSellSignals, addOnSignal, accountCircuitBreaker, sectorConcentrationCheck,
  assessSellPosition, buildSellReferenceLevels, buildSellAdvisorTimeline, buildSimpleSellPlan, buildCycleAwareSellPlan,
  V7_SELL_STRATEGY_VERSION, V7_SELL_STRATEGY_AUTHORITY, V7_SELL_STRATEGY_METHOD, V7_SELL_CFG,
  V7_COMPARABLE_PRICE_AUTHORITY, V7_NEGATIVE_FEEDBACK_AUTHORITY,
  v7StableSha256, normalizeV7MinuteEvidence, detectV7SealDecay, evaluateV7MinuteSell,
};

if (typeof module !== "undefined" && module.exports) module.exports = sellEngineApi;
if (typeof window !== "undefined") window.SellExitEngine = sellEngineApi;
