"use strict";
const assert = require("assert");
const { normalizeFastNews, parseStockNewsJsonp, normalizeAnnouncements, normalizeReports, newsKeywordHits, stripHtml, cninfoTsToDate } = require("./news-fetcher");

console.log("=== news-fetcher 测试(离线,纯解析) ===");

// 1. 全球快讯解析
const fastPayload = {
  data: {
    fastNewsList: [
      { title: "<em>央行</em>宣布降息10个基点", summary: "货币政策<b>宽松</b>信号……", showTime: "2026-07-02 09:00:00" },
      { title: "某国加征关税落地", summary: "", showTime: "2026-07-02 09:05:00" },
      { title: "", summary: "无标题应被过滤", showTime: "" },
    ],
  },
};
let rows = normalizeFastNews(fastPayload);
assert(rows.length === 2, "空标题被过滤");
assert(rows[0].title === "央行宣布降息10个基点", "HTML标签被剥离");
assert(rows[0].summary === "货币政策宽松信号……");
console.log("✓ 快讯解析:剥HTML/滤空标题/截摘要");

// 2. 快讯解析容错:空/畸形payload不崩
assert(Array.isArray(normalizeFastNews(null)) && normalizeFastNews(null).length === 0);
assert(normalizeFastNews({ data: {} }).length === 0);
assert(normalizeFastNews({ data: { fastNewsList: "not-array" } }).length === 0);
console.log("✓ 快讯容错:null/缺字段/类型错都返回[]");

// 3. 个股新闻 JSONP 解析
const jsonp = `jQuery_news({"result":{"cmsArticleWebOld":[
  {"title":"<em>德明利</em>获大单","content":"公司公告<b>中标</b>……","date":"2026-07-01 18:00","mediaName":"证券时报","url":"https://x.com/1"},
  {"title":"存储芯片行业景气上行","content":"","date":"2026-07-01 12:00","mediaName":"财联社","url":""}
]}})`;
rows = parseStockNewsJsonp(jsonp);
assert(rows.length === 2 && rows[0].title === "德明利获大单" && rows[0].source === "证券时报");
console.log("✓ 个股新闻:JSONP拆壳+剥HTML");

// 4. JSONP 容错:风控只回 passportWeb / 非法响应 → []
assert(parseStockNewsJsonp(`jQuery_news({"result":{"passportWeb":[{"x":1}]}})`).length === 0);
assert(parseStockNewsJsonp("not jsonp at all").length === 0);
assert(parseStockNewsJsonp("").length === 0);
console.log("✓ 个股新闻容错:被风控只回股民资料/畸形响应→[](已知#18)");

// 5. 关键词命中抗噪规则:≥2条标题同词才算
const news = [
  { title: "A国宣布对B国加征关税" },
  { title: "关税清单落地,出口链承压" },
  { title: "某公司卷入地缘冲突传闻" },
  { title: "央行释放降息信号" },
];
let hits = newsKeywordHits(news, ["关税", "地缘", "战争"]);
assert(hits.length === 1 && hits[0] === "关税", "关税2条命中;地缘仅1条不算;战争0条不算");
hits = newsKeywordHits(news, ["降息"], 1);
assert(hits.length === 1, "minTitles=1 时单条即命中");
assert(newsKeywordHits([], ["关税"]).length === 0);
console.log("✓ 抗噪:同词≥2条标题才命中,单条提及不触发风险分");

// 6. stripHtml
assert(stripHtml("<em>a</em>b<br/>") === "ab");
assert(stripHtml(null) === "");
console.log("✓ stripHtml 基础行为");

// 7. 巨潮公告解析(含毫秒时间戳转日期)
const annPayload = {
  announcements: [
    { announcementTitle: "关于<em>重大合同</em>中标的公告", announcementTypeName: "重大事项", announcementTime: 1782000000000, announcementId: "123456" },
    { announcementTitle: "", announcementTime: 1782000000000 },
  ],
};
let anns = normalizeAnnouncements(annPayload);
assert(anns.length === 1, "空标题被过滤");
assert(anns[0].title === "关于重大合同中标的公告" && anns[0].type === "重大事项");
assert(/^\d{4}-\d{2}-\d{2}$/.test(anns[0].date), "毫秒时间戳转为日期");
assert(anns[0].url.includes("annoId=123456"));
assert(normalizeAnnouncements(null).length === 0 && normalizeAnnouncements({}).length === 0);
console.log("✓ 公告解析:剥HTML/时间戳转日期/拼详情URL/容错");

// 8. cninfoTsToDate 边界
assert(cninfoTsToDate("2026-07-02 18:00:00") === "2026-07-02", "字符串时间截前10位");
assert(cninfoTsToDate(null) === "" && cninfoTsToDate(undefined) === "");
console.log("✓ 时间戳转换:数字/字符串/空值三态");

// 9. 东财研报解析
const rptPayload = {
  data: [
    { title: "存储量价齐升,业绩<b>超预期</b>", orgSName: "国信证券", emRatingName: "增持", publishDate: "2026-04-21 00:00:00.000", predictThisYearEps: "2.35" },
    { title: "", orgSName: "X" },
  ],
};
let rpts = normalizeReports(rptPayload);
assert(rpts.length === 1 && rpts[0].org === "国信证券" && rpts[0].rating === "增持");
assert(rpts[0].date === "2026-04-21" && rpts[0].epsThisYear === "2.35");
assert(rpts[0].title === "存储量价齐升,业绩超预期");
assert(normalizeReports(null).length === 0 && normalizeReports({ data: "x" }).length === 0);
console.log("✓ 研报解析:机构/评级/日期截断/EPS/容错");

console.log("\n全部测试通过 ✅");
