"use strict";
/**
 * leader-select.js —— 龙头与核心票筛选(修复优化版)
 * 替换 server.js 中 roleContext / classifyRole / buildTotalLeader 及相关判定。
 *
 * 修复清单(对照《量化说明书》第1节"逻辑正的主线板块龙头"):
 *   ①真涨停判定 isLimitUp:按板块规则用涨停价比较,替换全文 changePct>=9.5
 *     —— 你主做20cm科技票,旧判定把+12%没涨停记涨停、+15%炸板也算,核心失真
 *   ②龙头排序:涨停=先决条件(说明书:"一定要有涨停板"),连板高度=核心加分
 *     —— 旧版热度排名能压过涨停、首板与6连板同分,丢了梯队灵魂
 *   ③"板"字白名单 /(首板|\d+连?板)/ 且排除炸板/地板 —— 旧正则给炸板票+20反向奖励
 *   ④中军:市值锚 + 当日不弱(红盘或承接达标);修 floatMarketValue 缺失的 NaN 排序
 *   ⑤combinedRank 分段化(前10/前30/其余),不让黑盒榜单排序抖动主导判定
 *   ⑥buildTotalLeader 只在 selected 池内选 —— 旧版可能把"已剔除"的票封总龙头
 *   ⑦每只票输出 scoreParts 分项得分,供 archiver 落库做单因子归因(验证闭环)
 */

// ============ ① 真涨停判定 ============
const LIMIT_RULES = [
  { test: (s) => /ST|退/.test(s.name || ""), pct: 0.05 },
  { test: (s) => /^(30|68)/.test(String(s.code || "")), pct: 0.20 }, // 创业板/科创板
  { test: (s) => /^(4|8|92)/.test(String(s.code || "")), pct: 0.30 }, // 北交所
  { test: () => true, pct: 0.10 }, // 主板
];
const EPS = 0.011; // 涨停价四舍五入容差(分)

/** 真涨停:优先用行情自带涨停价;否则按板块规则从昨收推算 */
function isLimitUp(stock) {
  const price = Number(stock.price || stock.close || stock.lastPrice);
  if (!Number.isFinite(price) || price <= 0) return false;
  // 优先:数据源直给涨停价(东财快照 f51 / limitUp 字段)
  const given = Number(stock.limitUpPrice);
  if (Number.isFinite(given) && given > 0) return price >= given - EPS;
  // 兜底:昨收推算
  const prevClose = Number(stock.prevClose || stock.preClose);
  if (!Number.isFinite(prevClose) || prevClose <= 0) return false;
  const rule = LIMIT_RULES.find((r) => r.test(stock));
  const limit = Math.round(prevClose * (1 + rule.pct) * 100) / 100;
  return price >= limit - EPS;
}

// ============ ③ 连板解析:白名单 + 高度数值化 ============
/** 从 popularity 标签解析连板高度:首板=1,N连板=N,X天Y板=Y;炸板/地板=0(不奖励) */
function boardHeight(stock) {
  const tag = String(stock.popularity || "");
  if (/[炸地]板/.test(tag)) return 0;                 // 炸板/地板:白名单外,坚决不加分
  const m = tag.match(/(\d+)\s*连板/);
  if (m) return Math.min(Number(m[1]), 10);
  const m2 = tag.match(/(\d+)\s*天\s*(\d+)\s*板/);     // 同花顺实际格式:"4天3板"/"11天7板"(取板数)
  if (m2) return Math.min(Number(m2[2]), 10);
  if (/首板/.test(tag)) return 1;
  return isLimitUp(stock) ? 1 : 0;                     // 无标签但真涨停 → 按首板计
}

// ============ ⑤ 排名分段化 ============
function rankTier(combinedRank) {
  const r = Number(combinedRank);
  if (!Number.isFinite(r)) return 0;
  if (r <= 10) return 3;   // 双榜共识核心
  if (r <= 30) return 2;
  if (r <= 60) return 1;
  return 0;
}

// ============ 龙头强度分(②的核心:涨停先决,高度主导) ============
/**
 * 说明书对齐:"一定要有涨停板"=先决;梯队高度/辨识度=主导;热度只做同档内微调。
 * 权重结构:涨停通行证(无=直接-1000) + 连板高度×15 + 辨识度带动性 + 排名档位×4
 */
function leaderPower(stock) {
  const lifted = isLimitUp(stock);
  const height = boardHeight(stock);
  let power = 0;
  if (!lifted && height === 0) power -= 1000;          // ②涨停是先决条件,不是加分项
  power += height * 15;                                 // 连板高度主导:5板核心稳压首板跟风
  if (stock.isDriver) power += 12;                      // 带动性(板块内率先拉升带后排,外部可标)
  power += rankTier(stock.combinedRank) * 4;            // 热度只做同档内微调(旧版-rank线性压涨停的病根)
  const turnover = Number(stock.turnoverRate);
  if (Number.isFinite(turnover) && turnover >= 12) power += 3; // 换手达标(说明书硬条件的呼应)
  return power;
}

// ============ ④ 中军:市值锚 + 当日不弱 + NaN修复 ============
function mktValue(s) { // 统一取值,修 filter/sort 口径不一致导致的 NaN
  return Number(s.floatMarketValue || s.totalMarketValue || 0);
}
function pickZhongjun(members) {
  return members
    .filter((s) => mktValue(s) > 500e8)
    .filter((s) => {
      const pct = Number(s.changePct);
      const amt = Number(s.amountYi);
      // 当日不弱:红盘,或跌但成交额>=35亿(有承接);-2%以下死鱼不当锚
      return (Number.isFinite(pct) && pct >= 0) ||
             (Number.isFinite(pct) && pct > -2 && Number.isFinite(amt) && amt >= 35);
    })
    .sort((a, b) => mktValue(b) - mktValue(a))[0] || null;
}

// ============ roleContext(重写) ============
function roleContext(rows, hotConcepts) {
  const contexts = new Map();
  for (const entry of hotConcepts) {
    // 簇感知:方向可能是聚类结果(matchNames=主概念+别名),票命中任一名字都算方向成员
    const names = entry.matchNames || [entry.name];
    const members = rows
      .filter((item) => (item.concepts || []).some((c) => names.includes(c)))
      .sort((a, b) => (Number(a.combinedRank) || 999) - (Number(b.combinedRank) || 999));
    if (!members.length) continue;

    const sorted = members.slice().sort((a, b) => leaderPower(b) - leaderPower(a));
    // 龙头必须真涨停(说明书硬条件);全方向无涨停 → 该方向今日无龙头
    const top = sorted[0];
    // 这里判断的只是“当日高度”，必须由今天的真实涨停事实取得资格。
    // popularity 里的“X天Y板”只记录近期高度，不能把已经断板甚至跌停的股票
    // 继续冒充成今天的涨停股。
    const leader = top && isLimitUp(top) ? top : null;
    // 当日高度梯队可有多只；历史板数只用于当天真实涨停票之间的排序。
    const leaders = leader
      ? sorted
          .filter((s) => isLimitUp(s) && leaderPower(s) >= leaderPower(top) - 15)
          .slice(0, 3)
      : [];
    const zhongjun = pickZhongjun(members);

    contexts.set(entry.name, {
      members,
      leaderCode: leader ? leader.code : null,
      leaderCodes: leaders.map((s) => s.code),
      leaderHeight: leader ? boardHeight(leader) : 0,
      zhongjunCode: zhongjun ? zhongjun.code : null,
    });
  }
  return contexts;
}

// ============ classifyRole(重写,四档不变、判据修正) ============
function classifyRole(stock, concept, contexts) {
  const context = contexts.get(concept);
  if (!context) return { role: "后排观察", reason: "方向内地位不清晰" };

  if (context.leaderCode && stock.code === context.leaderCode) {
    return {
      role: "龙头",
      roleScope: "session",
      dailyRole: "当日高度",
      reason: `当日真实涨停，近期高度记录${context.leaderHeight}板，属于今天的高度代表`,
    };
  }
  // 龙头梯队并列:与榜首同档强度的票同样标龙头(方向多核时不强行只封一只)
  const tierIdx = (context.leaderCodes || []).indexOf(stock.code);
  if (tierIdx > 0) {
    return {
      role: "龙头",
      roleScope: "session",
      dailyRole: "当日高度",
      reason: `当日高度梯队#${tierIdx + 1}：真实涨停且与最高强度接近`,
    };
  }
  const isLargeCap = mktValue(stock) > 500e8;
  if ((context.zhongjunCode && stock.code === context.zhongjunCode) ||
      (isLargeCap && rankTier(stock.combinedRank) >= 2 && Number(stock.changePct) >= 0)) {
    return { role: "中军", reason: "方向内市值承接锚且当日不弱" };
  }
  const idx = context.members.findIndex((item) => item.code === stock.code);
  if (isLimitUp(stock) && boardHeight(stock) >= 1 && idx >= 0 && idx <= 4) {
    return { role: "补涨", reason: "同方向真涨停、强度次一级,偏补涨弹性" };
  }
  return { role: "后排观察", reason: "不是方向内最核心的龙头或中军" };
}

// ============ ⑥ buildTotalLeader(只在selected池内选) ============
function buildTotalLeader(candidates, topicBoard, marketState) {
  const rows = (candidates || []).filter(Boolean);
  const verifiedCycleCore = (stock) => {
    const identity = stock && stock.leadership && stock.leadership.cycleIdentity
      || stock && stock.cycleIdentity
      || {};
    const established = identity.identityEstablished === true
      && identity.activePrimary !== false
      && ["confirmed", "retained"].includes(String(identity.state || ""));
    if (established) return true;
    if (stock && (stock.roleKind === "dailyHeight" || stock.dailyRole === "当日高度" || stock.roleScope === "session")) return false;
    return Boolean(
      stock && stock.leadership && stock.leadership.coreIdentityQualified === true
      || stock && stock.roleKind === "cycleLeader"
      || stock && stock.roleScope === "cycle",
    );
  };
  const leadershipReady = rows.some((stock) => {
    const identity = stock && stock.leadership && stock.leadership.cycleIdentity
      || stock && stock.cycleIdentity
      || {};
    return Boolean(
      stock && stock.leadership && typeof stock.leadership.coreIdentityQualified === "boolean"
      || stock && (stock.roleKind || stock.roleScope || stock.dailyRole)
      || typeof identity.identityEstablished === "boolean",
    );
  });
  // 新版口径把“核心身份”和“可交易资格”拆开：总龙头/情绪锚只能来自
  // 已验证核心，不能因为旧 selected=true 或热榜/连板分高就强塞一只。
  // 旧缓存尚无 leadership 字段时才保留原 selected 池兼容。
  const eligible = leadershipReady
    ? rows.filter(verifiedCycleCore)
    : rows.filter((s) => s.selected && s.roleKind !== "dailyHeight" && s.roleScope !== "session");
  if (!eligible.length) return null;                               // 全被剔除=今日无总龙头(退潮期正常)

  const mainLine = (topicBoard && topicBoard.mainLine) || null;
  const mainLineName = mainLine ? mainLine.name : null;
  const consensusCode = mainLine && mainLine.leader ? mainLine.leader.code : null;
  const consensusCandidate = consensusCode
    ? eligible.find((s) => s.code === consensusCode) || null       // 非真实核心不认作共识锚
    : null;

  const pool = eligible.filter((s) => !mainLineName || s.mainConcept === mainLineName);
  const ranked = (pool.length ? pool : eligible).slice().sort((a, b) => {
    const sc = (s) =>
      (mainLineName && s.mainConcept === mainLineName ? 40 : 0) +
      (verifiedCycleCore(s) ? 55 : 0) + (s.inBothSources ? 12 : 0) +
      boardHeight(s) * 12 +                                        // 高度替代旧的粗糙9.5判定
      (s.gamePlan ? Math.min(10, Math.round((s.gamePlan.longStrength || 0) * 0.1)) : 0) +
      rankTier(s.combinedRank) * 3 + (s.score || 0);
    return sc(b) - sc(a);
  });
  return consensusCandidate || ranked[0] || null;
}

// ============ ⑦ 分项得分落库接口(归因闭环) ============
/**
 * 在 scoreCandidate 计算处,把各分项装进 scoreParts 一并输出:
 *   stock.scoreParts = { rankScore, sourceScore, conceptScore, momentumScore, boardScore,
 *     turnoverScore, popularityScore, crowdPenalty, resonanceBonus, capitalBonus,
 *     logicBonus, preferenceBonus, externalPenalty, chipBonus };
 * archiver 落库后,攒1-2个月做单因子归因:哪项在赚钱、哪项在坑,砍无效项。
 * (与 journal 按出口归因同一哲学:不可归因的打分=不可优化的打分)
 */
function attachScoreParts(stock, parts) {
  stock.scoreParts = parts;
  return stock;
}

module.exports = {
  isLimitUp, boardHeight, rankTier, leaderPower, pickZhongjun,
  roleContext, classifyRole, buildTotalLeader, attachScoreParts,
  LIMIT_RULES,
};
