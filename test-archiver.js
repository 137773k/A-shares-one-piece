"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  extractSummary,
  buildReport,
  archive,
  loadArchiveIndex,
  rebuildArchiveIndex,
  prepareDecisionArchivePayload,
} = require("./archiver");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "arch-test-"));
process.on("exit", () => fs.rmSync(TMP, { recursive: true, force: true }));
const dirs = {
  hist: path.join(TMP, "history"),
  report: path.join(TMP, "reports"),
  revision: path.join(TMP, "history-revisions", "local"),
};

console.log("=== archiver 测试 ===");

// 模拟 day1:主升,涨停80炸板20%
const day1 = {
  marketState: { cycle: "主升", subPhase: "主升中", position: "6-8成" },
  limitStats: { ztToday: 80, ztHistory: 100, dtToday: 3 },
  hotConcepts: [{ name: "CPO" }, { name: "存储芯片" }, { name: "液冷" }],
  candidates: [
    { code: "001309", name: "德明利", role: "龙头", score: 92, concept: "存储芯片" },
    { code: "600601", name: "方正科技", role: "龙头", score: 88, concept: "CPO" },
  ],
};
// 模拟 day2:切到退潮,字段名故意换风格测容错
const day2 = {
  market_state: { cycle: "退潮", subPhase: "", position: "空仓/1成" },
  limit_stats: { zt_today: 35, zt_history: 60, dt_today: 12 },
  hot_concepts: [{ concept: "避险" }],
  rows: [{ symbol: "000001", name: "某防御", role: "容量票", totalScore: 70, sector: "银行" }],
};

// 1. 摘要提取(标准字段)
let s1 = extractSummary(day1, "2026-06-29");
assert(s1.cycle === "主升" && s1.ztToday === 80 && s1.zbRatePct === 20 && s1.topConcepts[0] === "CPO");
assert(s1.topCandidates[0].name === "德明利" && s1.topCandidates[0].score === 92);
console.log("✓ 摘要提取:周期/涨停/炸板率/题材/候选全部正确");

// 2. 摘要提取(变体字段名容错)
let s2 = extractSummary(day2, "2026-06-30");
assert(s2.cycle === "退潮" && s2.ztToday === 35 && s2.dtToday === 12);
assert(Math.abs(s2.zbRatePct - 41.7) < 0.1 && s2.topCandidates[0].code === "000001");
console.log("✓ 容错:snake_case/别名字段也能提取(炸板率41.7%)");

// 3. 空payload不崩
let s0 = extractSummary({}, "2026-06-28");
assert(s0.cycle === "未知" && s0.ztToday === null && Array.isArray(s0.topConcepts));
assert.strictEqual(s0.archivedAt, null);
console.log("✓ 容错:空快照不崩,标'未知'");

// 4. 归档时间来自快照元数据，重建时不会刷新
const archivedAt = "2026-06-29T07:35:00.000Z";
const fetchedAt = "2026-06-29T07:34:00.000Z";
const metaSummary = extractSummary({ ...day1, fetchedAt, archiveMeta: { archivedAt, fetchedAt: "older" } }, "2026-06-29");
assert.strictEqual(metaSummary.archivedAt, archivedAt);
assert.strictEqual(extractSummary({ ...day1, archiveMeta: { fetchedAt } }, "2026-06-29").archivedAt, fetchedAt);
assert.strictEqual(extractSummary({ ...day1, fetchedAt }, "2026-06-29").archivedAt, fetchedAt);
assert.strictEqual(extractSummary({ ...day1, fetchedAt, archiveMeta: { archivedAt: "" } }, "2026-06-29").archivedAt, fetchedAt);
console.log("✓ 时间稳定:archivedAt优先读取快照元数据，无元数据时不生成新时间");

// 5. 归档 day1 → 快照/索引/报告三件套落地
let out1 = archive(day1, "2026-06-29", dirs);
assert(fs.existsSync(out1.snapFile) && fs.existsSync(out1.idxFile) && fs.existsSync(out1.reportFile));
let idx = JSON.parse(fs.readFileSync(out1.idxFile, "utf8"));
assert(idx.length === 1 && idx[0].date === "2026-06-29");
console.log("✓ 归档:快照+索引+报告三件套生成");

// 6. 归档 day2 → 索引追加,报告含"周期切换"提醒
let out2 = archive(day2, "2026-06-30", dirs);
idx = JSON.parse(fs.readFileSync(out2.idxFile, "utf8"));
assert(idx.length === 2 && idx[1].cycle === "退潮");
const report2 = fs.readFileSync(out2.reportFile, "utf8");
assert(report2.includes("周期切换:主升 → 退潮"));
assert(report2.includes("环比昨日:涨停 -45"));
console.log("✓ 环比:报告自动标注'主升→退潮'切换 + 涨停-45家");

// 7. 同日相同内容重跑 → 不重写快照、不生成修订、索引不重复
const sameDayOut = archive(day2, "2026-06-30", dirs);
idx = JSON.parse(fs.readFileSync(out2.idxFile, "utf8"));
assert(idx.length === 2);
assert.strictEqual(sameDayOut.snapshotChanged, false);
assert.strictEqual(sameDayOut.revisionFile, null);
assert.strictEqual(fs.existsSync(path.join(dirs.revision, "2026-06-30")), false);
console.log("✓ 幂等:同日相同内容不重写、不生成修订，索引不膨胀");

// 8. 同日内容变化 → 旧快照原字节进入SHA-256修订目录，重复写不复制修订
const seededDate = "2026-07-01";
const seededFile = path.join(dirs.hist, `${seededDate}.json`);
fs.mkdirSync(dirs.hist, { recursive: true });
const originalBytes = Buffer.from(`{\"marketState\":{\"cycle\":\"原始\"},\"marker\":\"保留原字节\"}\n`, "utf8");
fs.writeFileSync(seededFile, originalBytes);
const changedPayload = { marketState: { cycle: "修订" }, marker: "新内容" };
const changedOut = archive(changedPayload, seededDate, dirs);
const originalSha = crypto.createHash("sha256").update(originalBytes).digest("hex");
const expectedRevision = path.join(dirs.revision, seededDate, `${originalSha}.json`);
assert.strictEqual(changedOut.revisionFile, expectedRevision);
assert.deepStrictEqual(fs.readFileSync(expectedRevision), originalBytes);
assert.deepStrictEqual(JSON.parse(fs.readFileSync(seededFile, "utf8")), changedPayload);
const repeatedOut = archive(changedPayload, seededDate, dirs);
assert.strictEqual(repeatedOut.revisionFile, null);
assert.strictEqual(fs.readdirSync(path.dirname(expectedRevision)).length, 1);
console.log("✓ 防覆盖:同日异内容先按SHA-256原字节留档，相同内容不重复修订");

// 9. 报告结构完整
assert(report2.includes("明日待办") && report2.includes("| 代码 |"));
console.log("✓ 报告:含市场状态/主线/候选表/明日待办");

// 10. provider日期与显式日期冲突时，在任何写入前拒绝
const providerDated = {
  ...day1,
  market: { limitStats: { dates: { today: "20260710", prev: "20260709" } } },
};
const providerOut = archive(providerDated, undefined, dirs);
assert.strictEqual(path.basename(providerOut.snapFile), "2026-07-10.json");
const beforeMismatchFiles = fs.readdirSync(dirs.hist).slice().sort();
assert.throws(() => archive(providerDated, "2026-07-11", dirs), /不一致/);
assert.deepStrictEqual(fs.readdirSync(dirs.hist).slice().sort(), beforeMismatchFiles);
assert.throws(() => archive({ ...day1 }, undefined, dirs), /交易日缺失/);
console.log("✓ 日期门禁:provider交易日与显式日期冲突时拒绝且不落盘");

// 11. index可由快照原子重建，且不会改动任何快照字节
const snapshotsBefore = new Map(
  fs.readdirSync(dirs.hist)
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .map((file) => [file, fs.readFileSync(path.join(dirs.hist, file))]),
);
fs.writeFileSync(path.join(dirs.hist, "index.json"), "not-json", "utf8");
const rebuilt = rebuildArchiveIndex(dirs.hist);
assert.strictEqual(rebuilt.length, snapshotsBefore.size);
assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dirs.hist, "index.json"), "utf8")), rebuilt);
for (const [file, bytes] of snapshotsBefore) {
  assert.deepStrictEqual(fs.readFileSync(path.join(dirs.hist, file)), bytes);
}
assert.strictEqual(fs.readdirSync(dirs.hist).some((file) => file.endsWith(".tmp")), false);
console.log("✓ 索引修复:原子重建index且快照原字节完全不变");

// 12. 文件名与provider/archiveMeta日期不一致时保留原件，但排除出正式索引
const mismatchedDate = "2026-07-12";
const mismatchedFile = path.join(dirs.hist, `${mismatchedDate}.json`);
const mismatchedBytes = Buffer.from(JSON.stringify({
  market: { limitStats: { dates: { today: "2026-07-10" } } },
  archiveMeta: { tradingDate: "2026-07-10" },
}), "utf8");
fs.writeFileSync(mismatchedFile, mismatchedBytes);
const staleIndex = JSON.parse(fs.readFileSync(path.join(dirs.hist, "index.json"), "utf8"));
staleIndex.push({ date: mismatchedDate, cycle: "不应出现" });
fs.writeFileSync(path.join(dirs.hist, "index.json"), JSON.stringify(staleIndex), "utf8");
assert.strictEqual(loadArchiveIndex(dirs.hist).some((row) => row.date === mismatchedDate), false);
assert.strictEqual(rebuildArchiveIndex(dirs.hist).some((row) => row.date === mismatchedDate), false);
assert.deepStrictEqual(fs.readFileSync(mismatchedFile), mismatchedBytes);
console.log("✓ 错档隔离:日期不一致的原文件保留，但不会进入或回流到正式索引");

// 13. 正式收盘归档必须有live_canonical凭证；兼容档只可保存unavailable
const incompleteClosing = {
  fetchedAt: "2026-07-13T07:20:00.000Z",
  market: { limitStats: { dates: { today: "20260713", prev: "20260710", verified: true } } },
};
assert.throws(
  () => prepareDecisionArchivePayload(incompleteClosing, "2026-07-13"),
  /正式收盘决策凭证不可用/,
);
const compatibilityPayload = prepareDecisionArchivePayload(incompleteClosing, "2026-07-13", {
  requireCanonicalDecisionReceipt: false,
  archivedAt: "2026-07-13T07:21:00.000Z",
});
assert.strictEqual(compatibilityPayload.decisionReceipt.status, "unavailable");
assert.strictEqual(compatibilityPayload.decisionReceipt.decision.result.selectedCount, 0);
const requiredWithoutReceipt = {
  ...incompleteClosing,
  archiveMeta: {
    tradingDate: "2026-07-13",
    snapshotKind: "closing",
    decisionReceiptRequired: true,
  },
};
assert.throws(() => archive(requiredWithoutReceipt, "2026-07-13", dirs), /缺少决策凭证/);
console.log("✓ 正式凭证门禁:收盘缺统一链拒绝，兼容档仅保留unavailable且0股票");

console.log("\n全部测试通过 ✅");
