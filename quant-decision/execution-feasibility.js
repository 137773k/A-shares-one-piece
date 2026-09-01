"use strict";

const EXECUTION_FEASIBILITY_VERSION = 1;
const EXECUTION_FEASIBILITY_AUTHORITY = "unified_execution_feasibility_v1";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function unique(values) {
  return Array.from(new Set((values || []).map(clean).filter(Boolean)));
}

function buildExecutionFeasibility(stock = {}, options = {}) {
  const priceIntegrity = isObject(options.priceIntegrity) ? options.priceIntegrity
    : isObject(stock.priceIntegrity) ? stock.priceIntegrity : {};
  const leadership = isObject(stock.leadership) ? stock.leadership : {};
  const initiative = isObject(leadership.initiative) ? leadership.initiative : {};
  const priceDiscovery = isObject(initiative.priceDiscovery) ? initiative.priceDiscovery : {};
  const structure = isObject(leadership.structure) ? leadership.structure : {};
  const liquidity = isObject(stock.hardGate && stock.hardGate.metrics && stock.hardGate.metrics.liquidity)
    ? stock.hardGate.metrics.liquidity : {};
  const execution = isObject(stock.tomorrowExecution) ? stock.tomorrowExecution : {};
  const kline = isObject(stock.klineProfile) ? stock.klineProfile : {};
  const price = finite(priceIntegrity.price) ?? finite(stock.price) ?? finite(stock.close)
    ?? finite(kline.lastClose) ?? finite(kline.close);
  const changePct = finite(stock.changePct);
  const volumeRatio = finite(stock.volumeRatio);
  const turnoverRate = finite(stock.turnoverRate);
  const amountYi = finite(stock.amountYi);
  const blockers = [];
  const cautions = [];
  let riskPenalty = 0;

  if (priceIntegrity.valid === false || priceIntegrity.consistent === false) blockers.push("价格源完整性未通过");
  if (price === null || price <= 0) blockers.push("缺少可核验的最新价格");
  if (priceDiscovery.noPriceDiscovery === true) blockers.push("一字或锁价状态缺少真实价格发现");
  if (liquidity.status === "insufficient") blockers.push("成交活跃度不足，无法支持计划仓位执行");

  if (volumeRatio === null) cautions.push("量比缺失，无法估计成交拥挤度");
  if (amountYi === null) cautions.push("成交额缺失，无法估计执行容量");
  if (execution.tomorrowEntryQualified !== true) cautions.push("次日入场触发尚未成立");
  if (!Array.isArray(execution.triggers) || !execution.triggers.length) cautions.push("盘中入场触发条件缺失或尚未生成");
  if (!Array.isArray(execution.cancelConditions) || !execution.cancelConditions.length) cautions.push("取消条件缺失或尚未生成");

  if (volumeRatio !== null && volumeRatio > 3) {
    riskPenalty -= changePct !== null && changePct >= 7 ? 6 : 3;
    cautions.push(`量比${volumeRatio.toFixed(2)}偏热，成交拥挤与追价滑点风险上升`);
  }
  if (turnoverRate !== null && turnoverRate > 30) {
    riskPenalty -= 4;
    cautions.push(`换手${turnoverRate.toFixed(2)}%偏高，次日筹码分歧风险上升`);
  }
  if (structure.overextended === true) {
    riskPenalty -= 6;
    cautions.push("价格偏离近期成本区，次日追价赔率下降");
  }
  if (structure.chipPressure === true) {
    riskPenalty -= 3;
    cautions.push("上方筹码压力偏重，成交可行性需要更强承接确认");
  }

  const status = blockers.length ? "blocked"
    : cautions.length || riskPenalty < 0 ? "conditional" : "ready";
  const slippageRisk = blockers.length ? "unavailable"
    : riskPenalty <= -8 ? "high"
      : riskPenalty < 0 ? "elevated" : "normal";
  return {
    version: EXECUTION_FEASIBILITY_VERSION,
    authority: EXECUTION_FEASIBILITY_AUTHORITY,
    status,
    executableNow: false,
    canGrantExecution: false,
    onlyTightens: true,
    riskPenalty,
    slippageRisk,
    blockers: unique(blockers),
    cautions: unique(cautions),
    evidence: {
      price,
      priceIntegrityStatus: clean(priceIntegrity.status || priceIntegrity.grade) || "unknown",
      priceDiscoveryVerified: priceDiscovery.noPriceDiscovery === false,
      amountYi,
      volumeRatio,
      turnoverRate,
      tomorrowEntryQualified: execution.tomorrowEntryQualified === true,
      triggerCount: Array.isArray(execution.triggers) ? execution.triggers.length : 0,
      cancelConditionCount: Array.isArray(execution.cancelConditions) ? execution.cancelConditions.length : 0,
    },
    rule: "执行可行性只允许收紧或否决，不能反向打开市场、题材、模式或个股交易权限；真实成交价与滑点必须在盘中再次校验",
  };
}

module.exports = {
  EXECUTION_FEASIBILITY_VERSION,
  EXECUTION_FEASIBILITY_AUTHORITY,
  buildExecutionFeasibility,
};
