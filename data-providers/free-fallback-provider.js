"use strict";

const { CAPABILITIES, PROVIDER_CONTRACT_VERSION } = require("./contracts");

const DEPENDENCY_BY_CAPABILITY = Object.freeze({
  [CAPABILITIES.HOT_RANK_EASTMONEY]: "fetchEastmoneyRank",
  [CAPABILITIES.HOT_RANK_THS]: "fetchThsHotList",
  [CAPABILITIES.MARKET_SNAPSHOT]: "fetchMarketSnapshot",
  [CAPABILITIES.EXTERNAL_SNAPSHOT]: "fetchExternalSnapshot",
  [CAPABILITIES.LIMIT_STATS]: "fetchLimitStats",
  [CAPABILITIES.GLOBAL_NEWS]: "fetchGlobalNews",
  [CAPABILITIES.EVENT_TIMELINE]: "fetchEventTimeline",
  [CAPABILITIES.MARKET_CALENDAR]: "fetchMarketCalendar",
  [CAPABILITIES.QUOTES]: "fetchQuotes",
  [CAPABILITIES.DAILY_KLINE]: "fetchDailyKline",
  [CAPABILITIES.SECTORS]: "fetchSectors",
  [CAPABILITIES.STOCK_EVIDENCE]: "fetchStockEvidence",
  [CAPABILITIES.INTRADAY_LEADERSHIP]: "fetchIntradayLeadership",
  [CAPABILITIES.STOCK_NEWS]: "fetchStockNews",
});

function createFreeFallbackProvider(dependencies = {}) {
  const capabilities = Object.entries(DEPENDENCY_BY_CAPABILITY)
    .filter(([, dependency]) => typeof dependencies[dependency] === "function")
    .map(([capability]) => capability);
  if (!capabilities.length) throw new Error("free fallback provider has no configured capabilities");
  return {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    id: "free-fallback",
    label: "现有免费保底数据源",
    kind: "community_free",
    priority: -100,
    capabilities,
    executionAuthority: false,
    async invoke(capability, ...args) {
      const dependency = DEPENDENCY_BY_CAPABILITY[capability];
      if (!dependency || typeof dependencies[dependency] !== "function") {
        throw new Error(`free fallback capability unavailable: ${capability}`);
      }
      return dependencies[dependency](...args);
    },
  };
}

module.exports = { DEPENDENCY_BY_CAPABILITY, createFreeFallbackProvider };
