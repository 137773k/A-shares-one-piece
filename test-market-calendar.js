"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  parseFomcCalendarHtml,
  buildCffexSettlementEvents,
  fetchMarketCalendar,
  loadCachedMarketCalendar,
  mergeCalendarSources,
} = require("./market-calendar");

const fomcHtml = `
  <div class="panel panel-default"><div class="panel-heading"><h4><a id="2026">2026 FOMC Meetings</a></h4></div>
    <div class="row fomc-meeting">
      <div class="fomc-meeting__month"><strong>January</strong></div>
      <div class="fomc-meeting__date">27-28</div>
    </div>
    <div class="row fomc-meeting">
      <div class="fomc-meeting__month"><strong>March</strong></div>
      <div class="fomc-meeting__date">17-18*</div>
    </div>
    <div class="row fomc-meeting">
      <div class="fomc-meeting__month"><strong>April</strong></div>
      <div class="fomc-meeting__date">28-29</div>
    </div>
    <div class="row fomc-meeting">
      <div class="fomc-meeting__month"><strong>June</strong></div>
      <div class="fomc-meeting__date">16-17*</div>
    </div>
    <div class="row fomc-meeting">
      <div class="fomc-meeting__month"><strong>July</strong></div>
      <div class="fomc-meeting__date">28-29</div>
    </div>
    <div class="row fomc-meeting">
      <div class="fomc-meeting__month"><strong>September</strong></div>
      <div class="fomc-meeting__date">15-16*</div>
    </div>
    <div class="row fomc-meeting">
      <div class="fomc-meeting__month"><strong>October</strong></div>
      <div class="fomc-meeting__date">27-28</div>
    </div>
    <div class="row fomc-meeting">
      <div class="fomc-meeting__month"><strong>December</strong></div>
      <div class="fomc-meeting__date">8-9*</div>
    </div>
  </div>
  <div class="panel panel-default"><div class="panel-heading"><h4><a id="2027">2027 FOMC Meetings</a></h4></div>
    <div class="row fomc-meeting">
      <div class="fomc-meeting__month"><strong>January</strong></div>
      <div class="fomc-meeting__date">26-27</div>
    </div>
  </div>`;

async function main() {
  console.log("=== 短线风险日历测试 ===");

  const fomc = parseFomcCalendarHtml(fomcHtml);
  assert.strictEqual(fomc.length, 9);
  const julyMeeting = fomc.find((item) => item.calendarMeta.officialDate === "2026-07-29");
  const septemberMeeting = fomc.find((item) => item.calendarMeta.officialDate === "2026-09-16");
  assert.strictEqual(julyMeeting.calendarKind, "monetary-policy");
  assert.strictEqual(julyMeeting.eventDate, "2026-07-30", "美联储美国决议日需转换为A股次日观察日");
  assert.ok(septemberMeeting.summary.includes("经济预测摘要"));
  console.log("✓ 美联储官网日历解析与北京时间转换正确");

  const cffex = buildCffexSettlementEvents("2026-07-19T10:00:00+08:00", 2);
  const august = cffex.find((item) => item.eventDate === "2026-08-21");
  assert.ok(august, "2026年8月第三个星期五应为8月21日");
  assert.strictEqual(august.calendarKind, "market-structure");
  assert.ok(august.calendarMeta.sourceBasis.includes("当月通知"));
  console.log("✓ 中金所第三个星期五交割规则生成正确并保留顺延说明");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "market-calendar-test-"));
  const cacheFile = path.join(tempDir, "market-calendar.json");
  try {
    const live = await fetchMarketCalendar({
      cacheFile,
      now: "2026-07-19T10:00:00+08:00",
      forceRefresh: true,
      monthsAhead: 2,
      fetchImpl: async () => ({ ok: true, text: async () => fomcHtml }),
    });
    assert.ok(live.items.some((item) => item.eventDate === "2026-07-30"));
    assert.ok(live.items.some((item) => item.eventDate === "2026-08-21"));
    assert.strictEqual(live.statuses.find((item) => item.key === "federal-reserve-calendar").state, "live");
    assert.ok(fs.existsSync(cacheFile));

    const fallback = await fetchMarketCalendar({
      cacheFile,
      now: "2026-07-19T10:05:00+08:00",
      forceRefresh: true,
      monthsAhead: 2,
      fetchImpl: async () => { throw new Error("network down"); },
    });
    assert.strictEqual(fallback.statuses.find((item) => item.key === "federal-reserve-calendar").state, "stale-cache");
    assert.ok(fallback.items.some((item) => item.eventDate === "2026-07-30"));
    console.log("✓ 官网失败时自动使用已保存日历，交割规则仍持续生成");

    const restored = loadCachedMarketCalendar({ cacheFile, now: "2026-07-19T10:05:00+08:00", monthsAhead: 2 });
    assert.ok(restored.items.length >= 2);
    const combined = mergeCalendarSources(
      { items: [{ title: "美联储FOMC公布利率决议", eventDate: "2026-07-30", sourceProvider: "jiuyan" }], status: { key: "jiuyan", state: "live", servedAt: "2026-07-19T02:00:00.000Z" } },
      restored,
    );
    const sameEventSources = combined.items.filter((item) => item.title === "美联储FOMC公布利率决议" && item.eventDate === "2026-07-30");
    assert.strictEqual(sameEventSources.length, 2, "推演层需要保留独立来源用于交叉验证，不能在合并时误删");
    assert.ok(combined.statuses.length >= 3);
    console.log("✓ 多来源合并保留独立证据与来源状态");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log("\n全部测试通过 ✓");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
