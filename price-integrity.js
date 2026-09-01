"use strict";

const roundPrice = (value) => Math.round(Number(value || 0) * 100) / 100;

const positiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const finiteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const relativeGapPct = (left, right) => {
  if (!(left > 0) || !(right > 0)) return null;
  return Math.abs(left - right) / right * 100;
};

/**
 * 明日价格线必须以当天最新收盘/现价为基准，不能以昨收为基准。
 * 数据源优先级：实时最新价 > 当日K线收盘 > 昨收按涨跌幅反推 > 昨收兜底。
 * 当“最新价”错误地等于昨收但涨跌幅不为0时，自动用K线或反推价纠正。
 */
function resolveDecisionPrice(stock = {}) {
  const currentPrice = positiveNumber(stock.price || stock.latestPrice || stock.currentPrice);
  const klineClose = positiveNumber(stock.klineProfile && stock.klineProfile.lastClose);
  const prevClose = positiveNumber(stock.prevClose || stock.previousClose);
  const changePct = finiteNumber(stock.changePct);
  const expectedPrice = prevClose > 0 && changePct !== null
    ? roundPrice(prevClose * (1 + changePct / 100))
    : 0;

  let price = currentPrice || klineClose || expectedPrice || prevClose;
  let source = currentPrice ? "latest-price" : klineClose ? "kline-close" : expectedPrice ? "derived-from-change" : prevClose ? "prev-close-fallback" : "missing";
  let repaired = false;
  const warnings = [];

  const nonZeroMove = changePct !== null && Math.abs(changePct) >= 0.05;
  const priceLooksLikePrevClose = price > 0 && prevClose > 0 && Math.abs(price - prevClose) < 0.005;
  if (nonZeroMove && priceLooksLikePrevClose) {
    if (klineClose > 0 && Math.abs(klineClose - prevClose) >= 0.005) {
      price = klineClose;
      source = "kline-close-repair";
      repaired = true;
    } else if (expectedPrice > 0 && Math.abs(expectedPrice - prevClose) >= 0.005) {
      price = expectedPrice;
      source = "derived-from-change-repair";
      repaired = true;
    }
    if (repaired) warnings.push("最新价误取昨收，已自动纠正");
  }

  const currentKlineGap = relativeGapPct(currentPrice, klineClose);
  if (currentPrice > 0 && klineClose > 0 && currentKlineGap !== null && currentKlineGap > 0.8) {
    const currentExpectedGap = relativeGapPct(currentPrice, expectedPrice);
    const klineExpectedGap = relativeGapPct(klineClose, expectedPrice);
    if (klineExpectedGap !== null && currentExpectedGap !== null && klineExpectedGap + 0.2 < currentExpectedGap) {
      price = klineClose;
      source = "kline-close-consensus";
      repaired = true;
    }
    warnings.push("最新价与K线末值不一致");
  }

  const deviationPct = relativeGapPct(price, expectedPrice);
  const consistent = price > 0 && (expectedPrice <= 0 || deviationPct === null || deviationPct <= 0.8);
  if (!consistent) warnings.push("价格与昨收/涨跌幅不一致");

  return {
    price: roundPrice(price),
    source,
    repaired,
    consistent,
    warnings,
    currentPrice: roundPrice(currentPrice),
    klineClose: roundPrice(klineClose),
    prevClose: roundPrice(prevClose),
    expectedPrice: roundPrice(expectedPrice),
    changePct,
    deviationPct: deviationPct === null ? null : Math.round(deviationPct * 100) / 100,
  };
}

function repriceAuctionLine(line, basePrice) {
  const text = String(line || "");
  if (!(basePrice > 0)) return text;
  const markerStart = text.indexOf("(");
  const markerEnd = text.indexOf(")", markerStart + 1);
  if (markerStart < 0 || markerEnd < 0) return text;
  const marker = text.slice(markerStart + 1, markerEnd);
  const percents = Array.from(marker.matchAll(/([+-]?\d+(?:\.\d+)?)%/g)).map((match) => Number(match[1]));
  if (!percents.length || percents.some((value) => !Number.isFinite(value))) return text;

  const prefix = text.slice(0, markerStart);
  const suffix = text.slice(markerStart);
  if (percents.length >= 2 && /\d+(?:\.\d+)?\s*~\s*\d+(?:\.\d+)?\s*$/.test(prefix)) {
    const first = roundPrice(basePrice * (1 + percents[0] / 100)).toFixed(2);
    const second = roundPrice(basePrice * (1 + percents[1] / 100)).toFixed(2);
    return `${prefix.replace(/\d+(?:\.\d+)?\s*~\s*\d+(?:\.\d+)?\s*$/, `${first} ~ ${second} `)}${suffix}`;
  }

  const price = roundPrice(basePrice * (1 + percents[0] / 100)).toFixed(2);
  return `${prefix.replace(/\d+(?:\.\d+)?\s*$/, `${price} `)}${suffix}`;
}

function applyBestPickPriceIntegrity(bestPicks, candidates) {
  if (!bestPicks || typeof bestPicks !== "object") return bestPicks;
  const candidateByCode = new Map((Array.isArray(candidates) ? candidates : [])
    .filter(Boolean)
    .map((stock) => [String(stock.code || stock.secCode || ""), stock])
    .filter(([code]) => code));
  let repairedCount = 0;
  const issues = [];

  const picks = (Array.isArray(bestPicks.picks) ? bestPicks.picks : []).map((originalPick) => {
    const pick = originalPick && typeof originalPick === "object" ? originalPick : {};
    const stock = candidateByCode.get(String(pick.code || ""));
    if (!stock) {
      issues.push(`${pick.code || "未知代码"}缺少候选行情，无法复核价格`);
      return pick;
    }

    const resolved = resolveDecisionPrice(stock);
    if (!(resolved.price > 0)) {
      issues.push(`${pick.name || pick.code}缺少有效最新价`);
      return { ...pick, priceIntegrity: resolved };
    }
    if (!resolved.consistent) issues.push(`${pick.name || pick.code}价格源仍不一致`);
    if (resolved.repaired || Math.abs(Number(pick.price || 0) - resolved.price) >= 0.005) repairedCount += 1;

    const buy = pick.buy && typeof pick.buy === "object" ? { ...pick.buy } : {};
    if (Array.isArray(buy.auctionLines)) {
      buy.auctionLines = buy.auctionLines.map((line) => repriceAuctionLine(line, resolved.price));
    }

    const sell = pick.sell && typeof pick.sell === "object" ? { ...pick.sell } : {};
    if (sell.hardStop && typeof sell.hardStop === "object") {
      const hardStop = { ...sell.hardStop };
      if (Array.isArray(hardStop.pctRange)) {
        hardStop.priceRange = hardStop.pctRange.map((pct) => roundPrice(resolved.price * (1 + Number(pct || 0) / 100)));
      }
      if (hardStop.note) {
        hardStop.note = String(hardStop.note).replace(/当前以\d+(?:\.\d+)?为参考/, `当前以${resolved.price.toFixed(2)}为参考`);
      }
      sell.hardStop = hardStop;
    }
    if (sell.breakEven && typeof sell.breakEven === "object") {
      const breakEven = { ...sell.breakEven };
      breakEven.price = roundPrice(resolved.price * (1 + Number(breakEven.pct || 3) / 100));
      sell.breakEven = breakEven;
    }

    if (!resolved.consistent) {
      buy.priceBlocked = true;
      buy.auctionLines = ["价格源校验未通过：暂停生成买点，请重新抓取市场数据"];
      if (sell.hardStop) sell.hardStop = { ...sell.hardStop, priceRange: null };
      if (sell.breakEven) sell.breakEven = { ...sell.breakEven, price: null };
    }

    return {
      ...pick,
      price: resolved.price,
      priceSource: resolved.source,
      priceIntegrity: resolved,
      buy,
      sell,
    };
  });

  return {
    ...bestPicks,
    picks,
    priceIntegrity: {
      status: issues.length ? "warn" : "pass",
      basis: "latest-close",
      checkedCount: picks.length,
      repairedCount,
      issues,
    },
  };
}

module.exports = {
  resolveDecisionPrice,
  repriceAuctionLine,
  applyBestPickPriceIntegrity,
};
