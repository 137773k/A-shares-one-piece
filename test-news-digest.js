"use strict";
const assert = require("assert");
const { overseasTone, combineHint, filterNews, aggregateZtReasons, flagAnnouncements, buildNewsSection } = require("./news-digest");

console.log("=== news-digest 测试 ===");

// 1. 外围风向三态
assert(overseasTone({ nasdaqPct: -2.3, soxPct: -3.1 }).tone === "科技利空");
assert(overseasTone({ nasdaqPct: 2.0, soxPct: 1.8 }).tone === "科技顺风");
assert(overseasTone({ nasdaqPct: 0.3, soxPct: -0.5 }).tone === "中性");
assert(overseasTone(null).tone === "未知");
console.log("✓ 外围风向:利空/顺风/中性/缺失四态");

// 2. 你举的例子:高位分歧 + 外围科技利空 = 借利空杀筹码
let h = combineHint({ cycle: "主升", subPhase: "高位分歧" }, "科技利空");
assert(h && h.includes("杀场内筹码"));
console.log("✓ 组合提示:分歧+外围利空→'借利空杀筹码'(你的原话模式)");

// 3. 主升中(非分歧)遇利空:提示看承接,不必然离场
h = combineHint({ cycle: "主升", subPhase: "主升中" }, "科技利空");
assert(h && h.includes("承接"));
// 高潮加速+顺风:提示别接最后一棒
h = combineHint({ cycle: "主升", subPhase: "高潮加速" }, "科技顺风");
assert(h && h.includes("止盈信号"));
// 无规则命中返回null
assert(combineHint({ cycle: "主升", subPhase: "主升中" }, "中性") === null);
console.log("✓ 组合提示:主升看承接/加速防一日游/无命中不硬凑");

// 4. 关键词过滤(含大小写AI/ai)
const news = filterNews([
  { time: "07:30", title: "国产芯片重大突破,存储涨价预期强化" },
  { time: "08:00", title: "某地文旅消费数据亮眼" },
  { time: "08:30", title: "海外ai大模型发布带动算力需求" },
]);
assert(news.length === 2 && news[0].hits.includes("芯片") && news[1].hits.some((k) => k.toUpperCase() === "AI"));
console.log("✓ 要闻过滤:命中芯片/存储/AI,无关文旅被滤掉");

// 5. 涨停原因聚合(拆'+'计数排序)
const themes = aggregateZtReasons([
  { reason: "CPO+算力" }, { reason: "CPO" }, { reason: "存储芯片" },
  { reason: "CPO+液冷" }, { reason: "存储芯片+国产替代" },
]);
assert(themes[0].theme === "CPO" && themes[0].count === 3);
assert(themes[1].theme === "存储芯片" && themes[1].count === 2);
console.log("✓ 涨停原因聚合:CPO×3居首=消息→情绪证据链");

// 5b. 真实字段格式(集成实测):同花顺涨停池字段名是 reason_type,半角+分隔
const realThemes = aggregateZtReasons([
  { code: "603580", name: "艾艾精工", reason_type: "摘帽+新能源电池配件+轻型输送带" },
  { code: "603730", name: "岱美股份", reason_type: "人形机器人+特斯拉+遮阳板龙头+北美扩产" },
  { code: "601086", name: "某某", reason_type: "人形机器人+资产注入预期" },
]);
assert(realThemes[0].theme === "人形机器人" && realThemes[0].count === 2, "真实reason_type字段可聚合");
console.log("✓ 真实格式:reason_type字段(同花顺实测)正确聚合,人形机器人×2居首");

// 6. 公告排雷:减持标红置顶
const anns = flagAnnouncements([
  { code: "001309", name: "德明利", title: "关于股东减持计划的公告" },
  { code: "600601", name: "方正科技", title: "投资者关系活动记录" },
]);
assert(anns[0].risky === true && anns[1].risky === false);
console.log("✓ 公告排雷:减持🔴置顶");

// 7. 汇总markdown:结构完整+组合提示嵌入
const sec = buildNewsSection({
  overseas: { nasdaqPct: -2.3, soxPct: -3.1 },
  cycleInfo: { cycle: "主升", subPhase: "高位分歧" },
  newsItems: [{ time: "07:30", title: "芯片巨头财报暴雷" }],
  ztPool: [{ reason: "CPO" }],
  announcements: anns,
});
assert(sec.markdown.includes("## 消息面速览"));
assert(sec.markdown.includes("组合提示") && sec.markdown.includes("杀场内筹码"));
assert(sec.markdown.includes("CPO ×1") && sec.markdown.includes("🔴"));
console.log("✓ markdown:外围/提示/要闻/聚合/排雷五节齐");

// 8. 全缺失容错:不崩,标注缺失
const empty = buildNewsSection({ overseas: null, cycleInfo: null, newsItems: [], ztPool: [], announcements: [] });
assert(empty.markdown.includes("未知") && empty.markdown.includes("缺失"));
console.log("✓ 容错:数据源全挂也能出报告,标'缺失'");

console.log("\n全部测试通过 ✅");
