"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  DEFAULT_ENGINE_LOCK_PATH,
  ENGINE_LOCK_AUTHORITY,
  ENGINE_LOCK_VERSION,
  fileEntries,
  lockHash,
  serverFunctionEntries,
} = require("./decision-engine-lock");

const root = path.resolve(__dirname, "..");
const sourceCommit = String(process.argv[2] || "").trim().toLowerCase();
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("source commit must be a full Git SHA");
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
}).trim();
if (head !== sourceCommit) throw new Error("engine lock must be created from exact HEAD");
if (fs.existsSync(DEFAULT_ENGINE_LOCK_PATH)) throw new Error("decision engine lock already exists");

const lock = {
  schemaVersion: 1,
  authority: ENGINE_LOCK_AUTHORITY,
  engineVersion: ENGINE_LOCK_VERSION,
  status: "frozen",
  sourceCommit,
  entrypoint: "quant-decision/decision-chain.js#runUnifiedDecisionChain",
  versions: {
    decisionChain: 3,
    marketCycleContract: 4,
    marketPhase: 5,
    emotionCycle: 4,
    unifiedQuantFactors: 6,
    stockFactorEngine: 4,
    tradingStylePreference: 3,
    sellStrategy: 7,
  },
  policy: {
    decisionLogicChangesRequireUserApproval: true,
    providerChangesMustNotChangeLockedHashes: true,
    serverFunctionsLockedIndividually: true,
    dataAdaptersCannotGrantExecution: true,
  },
  files: fileEntries(root),
  serverFunctions: serverFunctionEntries(fs.readFileSync(path.join(root, "server.js"))),
  integrity: { algorithm: "sha256", lineEndings: "lf", engineHash: null },
};
lock.integrity.engineHash = lockHash(lock);
fs.writeFileSync(DEFAULT_ENGINE_LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify({
  output: path.relative(root, DEFAULT_ENGINE_LOCK_PATH).replace(/\\/g, "/"),
  sourceCommit,
  engineHash: lock.integrity.engineHash,
  fileCount: lock.files.length,
  serverFunctionCount: lock.serverFunctions.length,
}, null, 2)}\n`);
