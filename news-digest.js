"use strict";
/**
 * news-digest.js —— 盘后消息面摘要(复盘报告的"消息面"一节)
 *
 * 定位:消息面在你的体系里不是资讯,是"情绪炒作的催化剂和借口"。
 * 本模块把原料自动收齐(外围/要闻/涨停原因/公告),并按你总结的模式
 * 生成「消息 × 情绪位置」组合提示——解读仍由你做,系统只负责摆上桌。
 *
 * 设计:纯逻辑(digest/combineHint)与数据获取分离;
 * 免费源偶尔抽风 → 取到多少展示多少,缺了标注"缺失",外围指数稳定源保底。
 *
 * ★ 全仓库消息面唯一大脑:过滤/聚合/组合提示/markdown 生成只允许在这里;
 *   news-fetcher.js 与 server.js 的抓取函数一律是数据供应商,只喂 buildNewsSection 入参。
 *
 * 用法:archiver 归档时调用 buildNewsSection(),并入当日复盘报告(archive 第4参)。
 */

// ============ 主线关键词(你给的:芯片/科技/AI,扩成覆盖实际打法的词族) ============
const NEWS_CFG = {
  keywords: [
    // 你点名的三类
    "芯片", "科技", "AI", "人工智能",
    // 你实际在做的细分(可随主线切换增删)
    "半导体", "存储", "CPO", "光模块", "算力", "液冷",
    "国产替代", "大模型", "GPU", "HBM", "先进封装", "消费电子",
  ],
  // 外围科技利空/利好的判定线(%)
  overseasDropPct: -1.5,   // 纳指/费半跌超此值 = 科技利空
  overseasJumpPct: 1.5,    // 涨超此值 = 科技顺风
  maxNewsItems: 12,        // 要闻最多展示条数
};

// ============ 纯逻辑 ============
/** 判定外围科技风向:输入指数涨跌幅,输出 利空/顺风/中性 */
function overseasTone(overseas, cfg = NEWS_CFG) {
  // overseas = { nasdaqPct, soxPct, spPct, dowPct } 允许部分缺失
  const tech = [overseas && overseas.nasdaqPct, overseas && overseas.soxPct]
    .filter((x) => Number.isFinite(x));
  if (!tech.length) return { tone: "未知", detail: "外围数据缺失" };
  const worst = Math.min(...tech);
  const best = Math.max(...tech);
  if (worst <= cfg.overseasDropPct) {
    return { tone: "科技利空", detail: `纳指${fmtPct(overseas.nasdaqPct)} 费半${fmtPct(overseas.soxPct)},科技承压` };
  }
  if (best >= cfg.overseasJumpPct) {
    return { tone: "科技顺风", detail: `纳指${fmtPct(overseas.nasdaqPct)} 费半${fmtPct(overseas.soxPct)},外围助攻` };
  }
  return { tone: "中性", detail: `纳指${fmtPct(overseas.nasdaqPct)} 费半${fmtPct(overseas.soxPct)}` };
}
function fmtPct(x) { return Number.isFinite(x) ? `${x > 0 ? "+" : ""}${x}%` : "?"; }

/**
 * 「消息 × 情绪位置」组合提示——你总结过的模式做成对照表。
 * 不替你判断,只把你自己的经验提醒出来。规则可继续加。
 */
function combineHint(cycleInfo, tone) {
  const cycle = (cycleInfo && cycleInfo.cycle) || "";
  const sub = (cycleInfo && cycleInfo.subPhase) || "";
  const rules = [
    {
      when: () => tone === "科技利空" && (sub.includes("分歧") || cycle === "退潮"),
      hint: "⚠️ 高位分歧/退潮 + 外围科技利空 = 大概率借利空杀场内筹码。明日谨慎按「分歧延续」预案对待,别急着接回流;竞价大低开的预案票严格走不及预期闸。",
    },
    {
      when: () => tone === "科技利空" && cycle === "主升" && !sub.includes("分歧"),
      hint: "主升中遇外围利空:大概率低开制造分歧,重点看核心票承接——扛得住反而是「分歧日抗跌」的加分项,盘前预期可下修1档但不必然离场。",
    },
    {
      when: () => tone === "科技顺风" && (cycle === "震荡" || cycle === "混沌"),
      hint: "震荡/混沌期 + 外围科技顺风 = 可能借外围点火,留意科技主线是否借势启动,竞价关注核心票是否超预期高开。",
    },
    {
      when: () => tone === "科技顺风" && sub.includes("加速"),
      hint: "⚠️ 高潮加速 + 外围再助攻 = 容易冲顶一日游。记住铁律:大涨末端顶格加速是止盈信号,不是加仓信号。",
    },
  ];
  const hit = rules.find((r) => r.when());
  return hit ? hit.hint : null;
}

/** 按关键词过滤要闻,命中词高亮 */
function filterNews(items, cfg = NEWS_CFG) {
  const out = [];
  for (const it of items || []) {
    const text = String(it.title || it.content || "");
    const hits = cfg.keywords.filter((k) => text.toUpperCase().includes(k.toUpperCase()));
    if (hits.length) out.push({ time: it.time || "", text: text.slice(0, 80), hits });
    if (out.length >= cfg.maxNewsItems) break;
  }
  return out;
}

/** 涨停原因聚合:哪个题材因什么消息涨停最多(消息→情绪的证据链) */
function aggregateZtReasons(ztPool) {
  const map = {};
  for (const r of ztPool || []) {
    const reason = String(r.reason || r.reason_type || r["涨停原因"] || "").trim();
    if (!reason) continue;
    // 原因字段实测为"题材A+题材B+题材C"格式(同花顺 reason_type,半角+分隔),拆开计数
    for (const part of reason.split(/[+＋、/|]/).map((s) => s.trim()).filter(Boolean)) {
      map[part] = (map[part] || 0) + 1;
    }
  }
  return Object.entries(map)
    .map(([theme, count]) => ({ theme, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

/** 预案票公告排雷:标题含风险词的标红 */
const RISK_WORDS = ["减持", "问询", "立案", "警示", "处罚", "质押", "诉讼", "终止", "股东计划减持"];
function flagAnnouncements(anns) {
  return (anns || []).map((a) => {
    const title = String(a.title || "");
    const risky = RISK_WORDS.some((w) => title.includes(w));
    return { code: a.code || "", name: a.name || "", title: title.slice(0, 60), risky };
  }).sort((a, b) => (b.risky ? 1 : 0) - (a.risky ? 1 : 0));
}

/** 汇总成 markdown 一节(供 archiver 并入复盘报告) */
function buildNewsSection(input, cfg = NEWS_CFG) {
  const tone = overseasTone(input.overseas, cfg);
  const hint = combineHint(input.cycleInfo, tone.tone);
  const news = filterNews(input.newsItems, cfg);
  const ztThemes = aggregateZtReasons(input.ztPool);
  const anns = flagAnnouncements(input.announcements);

  const L = [];
  L.push(`## 消息面速览`);
  L.push(`### 外围市场:${tone.tone}`);
  L.push(`- ${tone.detail}`);
  if (hint) { L.push(``); L.push(`> **组合提示**:${hint}`); }
  L.push(``);
  L.push(`### 主线要闻(关键词命中)`);
  L.push(news.length
    ? news.map((n) => `- ${n.time ? `[${n.time}] ` : ""}${n.text}(命中:${n.hits.join("/")})`).join("\n")
    : "(无命中或数据缺失)");
  L.push(``);
  L.push(`### 涨停原因聚合(消息→情绪证据链)`);
  L.push(ztThemes.length
    ? ztThemes.map((t, i) => `${i + 1}. ${t.theme} ×${t.count}`).join("\n")
    : "(数据缺失)");
  if (anns.length) {
    L.push(``);
    L.push(`### 预案票公告排雷`);
    L.push(anns.map((a) => `- ${a.risky ? "🔴 " : ""}${a.name}(${a.code}):${a.title}`).join("\n"));
  }
  return { markdown: L.join("\n"), tone: tone.tone, hint, ztThemes };
}

// ============ 数据来源(已接:全部由现有供应商喂入,本模块不抓数据) ============
/*
 * 外围指数:server.js fetchExternalSnapshot(东财全球指数,含纳指NDX/费半SOX)→ payload.market.externalRisk.indexes
 * 要闻:news-fetcher fetchGlobalNews(东财7×24,财联社电报的免费替代——cls官方API已下线)→ payload.news.global
 * 涨停原因:server.js 同花顺涨停池透传 reason_type(需显式field参数,实测"题材A+题材B"格式)→ payload.market.limitStats.pool
 * 公告:news-fetcher fetchAnnouncements(巨潮)→ 候选票 evidence.announcements(预案票/入选票)
 * 组装:archiver.js assembleNewsInputs(payload) —— 单源失败传 null/[],本模块自动标"缺失"。
 */

module.exports = {
  NEWS_CFG, overseasTone, combineHint, filterNews, aggregateZtReasons,
  flagAnnouncements, buildNewsSection, RISK_WORDS,
};
