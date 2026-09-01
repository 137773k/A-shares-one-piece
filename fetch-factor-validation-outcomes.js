"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { _internals } = require("./server");
const {
  loadHistoricalSnapshots,
  buildExactT1Pairs,
} = require("./factor-effectiveness-validation");

function codeOf(stock) {
  return String(stock && (stock.code || stock.secCode) || "").trim();
}

function readCache(cachePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveCache(cachePath, cache) {
  const temporaryPath = `${cachePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, cachePath);
}

async function main() {
  const historyDir = path.join(__dirname, "data", "history");
  const cachePath = path.join(__dirname, "data", "factor-validation-outcomes.json");
  const loaded = loadHistoricalSnapshots(historyDir);
  const paired = buildExactT1Pairs(loaded.records);
  const requirements = new Map();

  paired.pairs.forEach((pair) => {
    (Array.isArray(pair.current.snapshot.candidates) ? pair.current.snapshot.candidates : [])
      .filter((stock) => stock && stock.selected === true)
      .forEach((stock) => {
        const code = codeOf(stock);
        if (!code) return;
        const current = requirements.get(code) || { code, name: String(stock.name || code), dates: new Set() };
        current.dates.add(pair.currentDate);
        current.dates.add(pair.nextDate);
        requirements.set(code, current);
      });
  });

  const existing = readCache(cachePath);
  const cache = {
    schemaVersion: 1,
    source: "tencent_qfq_daily_kline",
    endpointPolicy: "web.ifzq.gtimg.cn qfq day; outcome labels only; never used before T ranking is frozen",
    fetchedAt: new Date().toISOString(),
    series: existing && existing.series && typeof existing.series === "object" ? existing.series : {},
    failures: {},
  };
  const jobs = Array.from(requirements.values()).filter((requirement) => {
    const cached = cache.series[requirement.code];
    const dates = new Set(Array.isArray(cached && cached.rows) ? cached.rows.map((row) => String(row.date || "")) : []);
    return Array.from(requirement.dates).some((date) => !dates.has(date));
  });

  console.log(`需要结果序列 ${requirements.size} 只；本次抓取 ${jobs.length} 只。`);
  for (let index = 0; index < jobs.length; index += 4) {
    const batch = jobs.slice(index, index + 4);
    const results = await Promise.all(batch.map(async (requirement) => {
      const rows = await _internals.fetchTencentKlineRows({ code: requirement.code, secCode: requirement.code }, 260);
      return { requirement, rows };
    }));
    results.forEach(({ requirement, rows }) => {
      const availableDates = new Set(rows.map((row) => String(row.date || "")));
      const missingDates = Array.from(requirement.dates).filter((date) => !availableDates.has(date));
      if (rows.length && !missingDates.length) {
        cache.series[requirement.code] = {
          code: requirement.code,
          name: requirement.name,
          source: "tencent_qfq_daily_kline",
          fetchedAt: new Date().toISOString(),
          rows,
        };
        delete cache.failures[requirement.code];
      } else {
        cache.failures[requirement.code] = {
          code: requirement.code,
          name: requirement.name,
          requiredDates: Array.from(requirement.dates).sort(),
          missingDates,
          rowCount: rows.length,
          reason: rows.length ? "required_dates_missing" : "provider_request_failed_or_empty",
        };
      }
    });
    cache.fetchedAt = new Date().toISOString();
    saveCache(cachePath, cache);
    console.log(`已处理 ${Math.min(index + batch.length, jobs.length)}/${jobs.length}；成功缓存 ${Object.keys(cache.series).length} 只；失败 ${Object.keys(cache.failures).length} 只。`);
  }

  if (!jobs.length) saveCache(cachePath, cache);
  console.log(JSON.stringify({
    cachePath,
    requiredCodeCount: requirements.size,
    cachedCodeCount: Object.keys(cache.series).length,
    failureCount: Object.keys(cache.failures).length,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { main };
