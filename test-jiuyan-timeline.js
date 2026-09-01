"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  createRequestToken,
  normalizeTimelineResponse,
  fetchJiuyanTimeline,
} = require("./jiuyan-timeline");
const { buildEventInference } = require("./event-engine");

function apiPayload() {
  const item = {
    article_id: "article-waic",
    title: "2026世界人工智能大会（WAIC 2026）",
    content: "大会将于上海举行，集中发布人工智能和算力基础设施成果。",
    timeline: {
      timeline_id: "timeline-waic",
      date: "2026-07-25",
      grade: 3,
      source: 1,
      create_time: "2026-07-06 18:11:38",
      theme_list: [{ timeline_theme_id: "theme-ai", name: "人工智能" }],
    },
  };
  return {
    msg: "",
    errCode: 0,
    serverTime: 1784450000000,
    data: [
      { date: "2026-07-25", list: [item] },
      { date: "2026-07-25", list: [item] },
    ],
  };
}

function candidate(code, name, role) {
  return {
    code,
    name,
    concepts: ["人工智能", "算力"],
    mainConcept: "人工智能",
    role,
    amountYi: 60,
    changePct: 2.5,
    inBothSources: true,
    score: 110,
    klineProfile: {
      rise2: 3,
      rise10: 7,
      rise20: 10,
      nearHigh20: false,
      newHigh: false,
      volumeBreakout: true,
      pctFromHigh: 8,
    },
    evidence: {
      checked: true,
      announcements: [],
      reports: [{ title: "人工智能算力业务增长" }],
    },
  };
}

async function main() {
  console.log("=== 韭研时间轴测试 ===");

  const timestamp = "1784450000000";
  const expected = crypto.createHash("md5").update(`Uu0KfOB8iUP69d3c:${timestamp}`).digest("hex");
  assert.strictEqual(createRequestToken(timestamp), expected);
  console.log("✓ 请求签名与官网前端算法一致");

  const normalized = normalizeTimelineResponse(apiPayload());
  assert.strictEqual(normalized.length, 1, "同一timeline_id必须去重");
  assert.strictEqual(normalized[0].eventDate, "2026-07-25");
  assert.strictEqual(normalized[0].sourceProvider, "jiuyan");
  assert.deepStrictEqual(normalized[0].themes, ["人工智能"]);
  console.log("✓ 返回结构校验、字段归一化和去重通过");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jiuyan-timeline-test-"));
  const cacheFile = path.join(tempDir, "timeline-cache.json");
  try {
    let calls = 0;
    const live = await fetchJiuyanTimeline({
      cacheFile,
      now: "2026-07-19T10:00:00+08:00",
      monthOffsets: [0],
      forceRefresh: true,
      retries: 0,
      fetchImpl: async () => {
        calls += 1;
        return {
          ok: true,
          headers: { get: () => "Sun, 19 Jul 2026 02:00:00 GMT" },
          json: async () => apiPayload(),
        };
      },
    });
    assert.strictEqual(calls, 1);
    assert.strictEqual(live.status.state, "live");
    assert.strictEqual(live.items.length, 1);
    assert.ok(fs.existsSync(cacheFile), "成功数据必须落盘");
    console.log("✓ 实时抓取成功后自动持久化");

    const fallback = await fetchJiuyanTimeline({
      cacheFile,
      now: "2026-07-19T10:05:00+08:00",
      monthOffsets: [0],
      forceRefresh: true,
      retries: 0,
      fetchImpl: async () => { throw new Error("network down"); },
    });
    assert.strictEqual(fallback.status.state, "stale-cache");
    assert.strictEqual(fallback.items.length, 1);
    assert.ok(fallback.status.message.includes("上次成功保存"));
    console.log("✓ 接口失败时自动回退上次成功缓存");
  } finally {
    if (tempDir.startsWith(os.tmpdir())) fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const timelineRow = normalized[0];
  const baseOptions = {
    candidates: [
      candidate("300001", "AI龙头", "龙头"),
      candidate("300002", "AI中军", "中军"),
      candidate("300003", "AI核心", "核心"),
    ],
    market: { state: { cycle: "混沌", subPhase: "混沌中期" } },
    marketEmotion: { light: "yellow" },
    now: "2026-07-19T10:00:00+08:00",
  };
  let inference = buildEventInference({ newsItems: [timelineRow], ...baseOptions });
  assert.strictEqual(inference.qualifiedEvents.length, 0, "单一专业日历来源不得直接进入系统");
  assert.ok(inference.watchEvents.length >= 1);

  inference = buildEventInference({
    newsItems: [
      timelineRow,
      {
        title: "2026世界人工智能大会WAIC即将举行",
        summary: "大会将集中发布人工智能和算力基础设施成果。",
        time: "2026-07-19 09:00:00",
        source: "东方财富7×24",
        sourceProvider: "eastmoney-news",
      },
    ],
    sourceStatuses: [
      { key: "jiuyan", label: "韭研公社时间轴", state: "live", itemCount: 1 },
      { key: "eastmoney-news", label: "东财7×24", state: "live", itemCount: 1 },
    ],
    ...baseOptions,
  });
  assert.strictEqual(inference.qualifiedEvents.length, 1, "独立来源交叉验证后才可进入严格准入判断");
  assert.strictEqual(inference.qualifiedEvents[0].eventDate, "2026-07-25");
  assert.strictEqual(inference.qualifiedEvents[0].source.corroboration, 2);
  assert.strictEqual(inference.sources.length, 2);
  console.log("✓ 单一韭研线索只观察，独立来源交叉验证后才可能准入");

  console.log("\n全部测试通过 ✅");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
