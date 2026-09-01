import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const modelRoot = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(modelRoot, "..", "a-share-trading-mobile");

const REQUIRED_NEW_FILES = [
  "cloud-current-sync.js",
  "cloud-history-sync.js",
  "core-emotion-lifecycle.js",
  "core-leadership.js",
  "emotion-cycle-engine.js",
  "emotion-core-evidence-contract.js",
  "fetch-evidence-quality.js",
  "index-cycle-regime.js",
  "market-cap-carrier.js",
  "market-cycle-engine.js",
  "market-phase-detail.js",
  "premarket-flow.js",
  "post-close-opportunity.js",
  "script.js",
  "sell-engine.js",
  "super-expectation.js",
  "theme-library.js",
  "theme-taxonomy.js",
  "tomorrow-decision-context.js",
  "tomorrow-index-path.js",
  "tomorrow-market-forecast.js",
  "tomorrow-profit-effect-forecast.js",
  "trading-rules.js",
  "trading-rules.test.js",
  "trading-style-preference.js",
  "unified-quant-factors.js",
  "test-core-emotion-lifecycle.js",
  "test-emotion-core-evidence-contract.js",
  "test-core-leadership.js",
  "test-decision-authority-lanes.js",
  "test-decision-direct.js",
  "test-execution-replay.js",
  "test-limit-up-pullback-repair.js",
  "test-index-cycle-regime.js",
  "test-index-structure-preservation.js",
  "test-market-cap-carrier.js",
  "test-market-cycle-engine.js",
  "test-market-cycle-contract.js",
  "test-market-phase-detail.js",
  "test-sell-advisor-context.js",
  "test-super-expectation.js",
  "test-theme-library.js",
  "test-premarket-flow.js",
  "test-post-close-opportunity.js",
  "test-post-close-opportunity-render.js",
  "test-selection-replay.js",
  "test-tomorrow-decision-context.js",
  "test-tomorrow-index-path.js",
  "test-tomorrow-market-forecast.js",
  "test-tomorrow-profit-effect-forecast.js",
  "test-trading-style-preference.js",
  "test-unified-decision-chain-frontend.js",
  "test-unified-decision-chain.js",
  "test-unified-quant-factors.js",
  "test-unified-quant-ranking.js",
  "test-unified-stock-factor-engine.js",
];

const SHARED_NON_JS_FILES = [
  "styles.css",
  "ui-refresh.css",
];

const REMOVED_FILES = [
  "personal-logic-picker.js",
  "test-personal-logic-picker.js",
  "test-personal-logic-render.js",
  "test-personal-logic-theme-contract.js",
];

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function sha256(file) {
  const bytes = await fs.readFile(file);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function copyAndVerify(relativeFile) {
  const source = path.join(modelRoot, relativeFile);
  const target = path.join(mobileRoot, relativeFile);
  if (!await exists(source)) throw new Error(`missing model source: ${relativeFile}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
  const [sourceHash, targetHash] = await Promise.all([sha256(source), sha256(target)]);
  if (sourceHash !== targetHash) throw new Error(`mobile parity check failed: ${relativeFile}`);
  return { file: relativeFile, sha256: sourceHash };
}

async function main() {
  if (!await exists(path.join(mobileRoot, "mobile-start.js"))) {
    throw new Error(`mobile runtime directory not found: ${mobileRoot}`);
  }

  // 只同步统一决策核心、前端正式投影和对应契约测试。手机端 server.js、
  // mobile-*、sw.js 与部署脚本含独立鉴权/状态/容错接线，禁止被桌面端
  // 同名文件整包覆盖；其决策链接线由发布契约测试逐项校验。
  const files = [...new Set([...REQUIRED_NEW_FILES, ...SHARED_NON_JS_FILES])].sort();
  const copied = [];
  for (const file of files) copied.push(await copyAndVerify(file));

  const removed = [];
  for (const file of REMOVED_FILES) {
    const target = path.join(mobileRoot, file);
    await fs.rm(target, { force: true });
    if (await exists(target)) throw new Error(`removed module still exists: ${file}`);
    removed.push(file);
  }

  const quantEntries = await fs.readdir(path.join(modelRoot, "quant-decision"), { withFileTypes: true });
  for (const entry of quantEntries) {
    if (!entry.isFile()) continue;
    copied.push(await copyAndVerify(path.join("quant-decision", entry.name)));
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    authority: "a-share-trading-model",
    target: mobileRoot,
    copiedFiles: copied.length,
    removedFiles: removed,
    decisionChainVersion: 3,
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
