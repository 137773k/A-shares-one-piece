"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;
const archiveDir = path.join(root, "data", "cache-history", "hot-stocks-cache");
const outputFile = path.join(root, "data", "seed-kline-profiles.json");
const hotStocksOutputFile = path.join(root, "data", "seed-hot-stocks.json");

let best = null;
let latestComplete = null;

for (const entry of fs.readdirSync(archiveDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
  const filePath = path.join(archiveDir, entry.name);
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const rows = Array.isArray(payload.candidates) ? payload.candidates : [];
    const usable = rows.filter((item) => item && item.code && item.klineProfile);
    if (!best || usable.length > best.usable.length) best = { filePath, payload, usable };
    if (usable.length >= 40) {
      const stamp = Date.parse(payload.updatedAt || payload.fetchedAt || 0) || 0;
      if (!latestComplete || stamp > latestComplete.stamp) latestComplete = { filePath, payload, usable, stamp };
    }
  } catch {}
}

if (!best || !best.usable.length) throw new Error("No usable K-line profile archive found");

const profiles = Object.fromEntries(best.usable.map((item) => [String(item.code), item.klineProfile]));
const seed = {
  generatedAt: new Date().toISOString(),
  sourceUpdatedAt: best.payload.updatedAt || null,
  sourceFile: path.basename(best.filePath),
  profiles,
};

fs.writeFileSync(outputFile, JSON.stringify(seed, null, 2), "utf8");
const hotSeed = latestComplete || best;
fs.writeFileSync(hotStocksOutputFile, JSON.stringify(hotSeed.payload, null, 2), "utf8");
console.log(JSON.stringify({
  outputFile,
  profiles: Object.keys(profiles).length,
  sourceFile: seed.sourceFile,
  hotStocksOutputFile,
  hotStocksProfiles: hotSeed.usable.length,
  hotStocksSourceFile: path.basename(hotSeed.filePath),
}));
