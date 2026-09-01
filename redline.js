"use strict";
/**
 * redline.js —— 预案红线清单生成器(纯函数)
 *
 * 解决的问题:preplan 里的红线全是百分比(高开≥3%、硬止损-7%、尾盘破MA5清),
 * 盘中根本没时间心算。本模块把预案红线换算成【具体价格】,预案保存后立刻出一张
 * "红线卡",供截图/手抄贴在屏幕边上——盘中只对价格,不做任何计算。
 *
 * 输入全部由调用方喂(昨收/MA5/预案参数),本模块不做 IO、不轮询行情。
 * 板别识别复用 leader-select 的 LIMIT_RULES(ST5%/创科20%/北交30%/主板10%),不重写。
 *
 * 红线卡六条:
 *   1. 竞价判定线 —— 用预案锁定的 auctionExpectation 百分比换算开盘价区间
 *   2. 硬止损价   —— 主板-6~-7% / 20cm·北交-10~-12% / ST贴跌停前-4~-5%,不可谈判
 *   3. 保本武装线 —— +3% 对应价格,浮盈过线后武装保本
 *   4. 分时回撤   —— 规则文字(高点回撤3-5%,妖股5.5-6%,且破分时均价≥5分钟)
 *   5. 尾盘线     —— 14:55 现价 < MA5 → 收盘清,展示MA5具体价格
 *   6. B闸窗口    —— 双逻辑+预期回流日:14:00-14:50,14:45未回流止损底仓
 */

const { LIMIT_RULES } = require("./leader-select");

function round2(x) { return Math.round(x * 100) / 100; }
/** 百分比 → 价格(两位小数,A股最小变动0.01) */
function pctPrice(base, pct) { return round2(base * (1 + pct / 100)); }

/** 板别识别:复用 leader-select 的 LIMIT_RULES,返回涨跌幅限制与标签 */
function classifyBoard(stock) {
  const rule = LIMIT_RULES.find((r) => r.test(stock));
  const pct = rule.pct;
  const label = pct === 0.05 ? "ST(5cm)" : pct === 0.30 ? "北交(30cm)" : pct === 0.20 ? "20cm" : "主板(10cm)";
  return { limitPct: pct, label };
}

/** 硬止损档位:主板-6~-7%;20cm/北交-10~-12%;ST涨跌停仅5%,-6%不存在,贴跌停前-4~-5% */
function hardStopRange(limitPct) {
  if (limitPct >= 0.20) return [-10, -12];
  if (limitPct <= 0.05) return [-4, -5];
  return [-6, -7];
}

/**
 * 生成红线卡。
 * @param input {
 *   code, name,
 *   prevClose?: number,        // 昨收(缺则价格线为null并入missing)
 *   ma5?: number,              // 5日线(缺则尾盘线为null并入missing)
 *   buyPrice?: number,         // 实际买入价(可选;有则止损/保本按它换算,更准)
 *   auctionExpectation?: { meetPct, beyondPct, failBelowPct }, // 预案锁定的三段线
 *   dualLogic?: boolean, isExpectedReflowDay?: boolean,
 * }
 */
function buildRedlineCard(input = {}) {
  const code = String(input.code || "");
  const name = String(input.name || "");
  const prevClose = Number(input.prevClose);
  const ma5 = Number(input.ma5);
  const buyPrice = Number(input.buyPrice);
  const hasPrev = Number.isFinite(prevClose) && prevClose > 0;
  const hasMa5 = Number.isFinite(ma5) && ma5 > 0;
  const hasBuy = Number.isFinite(buyPrice) && buyPrice > 0;

  const missing = [];
  if (!hasPrev) missing.push("昨收");
  if (!hasMa5) missing.push("MA5");

  const boardInfo = classifyBoard({ code, name });
  const board = {
    ...boardInfo,
    limitUpPrice: hasPrev ? round2(prevClose * (1 + boardInfo.limitPct)) : null,
    limitDownPrice: hasPrev ? round2(prevClose * (1 - boardInfo.limitPct)) : null,
  };

  // 1. 竞价判定线:预案锁定的百分比 → 开盘价区间(以昨收为基准)
  const e = input.auctionExpectation || null;
  const auction = e && hasPrev
    ? {
        meetPct: e.meetPct, beyondPct: e.beyondPct, failBelowPct: e.failBelowPct,
        beyondPrice: pctPrice(prevClose, e.beyondPct),
        meetPrice: pctPrice(prevClose, e.meetPct),
        failPrice: pctPrice(prevClose, e.failBelowPct),
        grayZone: [pctPrice(prevClose, e.failBelowPct), pctPrice(prevClose, e.meetPct)],
        lines: [
          `开盘价 > ${pctPrice(prevClose, e.beyondPct).toFixed(2)} (+${e.beyondPct}%) → 超预期:不卖,观察弱转强加仓`,
          `开盘价 ≥ ${pctPrice(prevClose, e.meetPct).toFixed(2)} (+${e.meetPct}%) → 符合:持有,交给盘中闸门`,
          `${pctPrice(prevClose, e.failBelowPct).toFixed(2)} ~ ${pctPrice(prevClose, e.meetPct).toFixed(2)} (${e.failBelowPct}%~${e.meetPct}%) → 灰区:按不及处理,可人工复核`,
          `开盘价 < ${pctPrice(prevClose, e.failBelowPct).toFixed(2)} (${e.failBelowPct}%) → 不及预期:${input.dualLogic ? "砍博弈仓1/2,底仓看回流" : "一次清仓,不等五日线"}`,
        ],
      }
    : null;

  // 2/3. 硬止损与保本:有买入价按买入价换算(浮亏浮盈的真实基准),否则以昨收作参考
  const basisPrice = hasBuy ? buyPrice : hasPrev ? prevClose : null;
  const basisNote = hasBuy ? "按实际买入价换算" : "以昨收为基准参考,实际买入后按买入价重算";
  const stopPcts = hardStopRange(boardInfo.limitPct);
  const hardStop = {
    pctRange: stopPcts,
    priceRange: basisPrice ? [pctPrice(basisPrice, stopPcts[0]), pctPrice(basisPrice, stopPcts[1])] : null,
    note: `${boardInfo.label} 硬止损 ${stopPcts[0]}%~${stopPcts[1]}%——不可谈判,触线即走;${basisNote}`,
  };
  const breakEven = {
    pct: 3,
    price: basisPrice ? pctPrice(basisPrice, 3) : null,
    rule: `浮盈站上此价后武装保本(止损上移至成本);${basisNote}`,
  };

  // 4. 分时回撤:规则文字,不算价(基准=当日盘中高点,盘前无法预知)
  const intradayPullback =
    "从当日高点回撤 3-5%(高位妖股放宽至 5.5-6%),且同时跌破分时均价持续≥5分钟 → 执行减仓/清仓;单破一条不动作";

  // 5. 尾盘线
  const closeLine = {
    ma5: hasMa5 ? round2(ma5) : null,
    rule: hasMa5
      ? `14:55 现价 < ${round2(ma5).toFixed(2)} (MA5) → 收盘清`
      : "14:55 现价 < MA5 → 收盘清(⚠️MA5数据缺失待补,盘前手查五日线)",
  };

  // 6. B闸窗口:资格盘前挣——双逻辑+预期回流日才有
  const bGate = input.dualLogic && input.isExpectedReflowDay
    ? { window: "14:00-14:50", rule: "B闸窗口 14:00-14:50 验证板块回流;14:45 仍未回流 → 止损底仓" }
    : null;

  return {
    code, name, board,
    basis: { prevClose: hasPrev ? round2(prevClose) : null, buyPrice: hasBuy ? round2(buyPrice) : null, used: hasBuy ? "buyPrice" : "prevClose" },
    missing,
    auction, hardStop, breakEven, intradayPullback, closeLine, bGate,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { classifyBoard, hardStopRange, buildRedlineCard, pctPrice, round2 };
