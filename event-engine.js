"use strict";

const crypto = require("crypto");

const THEME_DEFINITIONS = [
  { key: "ai-compute", label: "AI算力", event: ["人工智能", "AI", "大模型", "算力", "太空算力", "数据中心", "服务器", "GPU", "昇腾", "超节点", "CPO", "光模块", "光纤", "共封装光学", "Meta"], stock: ["人工智能", "AI", "算力", "大模型", "数据中心", "服务器", "液冷", "CPO", "光模块", "共封装光学", "PCB", "高速连接", "GPU", "F5G"] },
  { key: "semiconductor", label: "半导体/存储", event: ["半导体", "芯片", "存储", "HBM", "晶圆", "封装", "光刻", "AMD", "英特尔", "长鑫", "长鑫科技"], stock: ["半导体", "芯片", "存储", "HBM", "先进封装", "封测", "晶圆", "光刻", "国家大基金"] },
  { key: "robot", label: "机器人", event: ["机器人", "具身智能", "人形机器人"], stock: ["机器人", "具身智能", "减速器", "伺服", "丝杠", "机器视觉"] },
  { key: "medicine", label: "创新药/医药", event: ["创新药", "医药", "新药", "疫苗", "临床", "药品", "医疗"], stock: ["创新药", "医药", "新药", "疫苗", "CRO", "细胞免疫", "医疗器械", "流感", "猴痘"] },
  { key: "low-altitude", label: "低空经济", event: ["低空", "eVTOL", "飞行汽车", "无人机"], stock: ["低空经济", "eVTOL", "飞行汽车", "无人机", "通用航空"] },
  { key: "automobile", label: "汽车/智能驾驶", event: ["汽车", "智能驾驶", "自动驾驶", "新能源车", "整车"], stock: ["汽车", "智能驾驶", "无人驾驶", "新能源车", "整车", "汽车零部件"] },
  { key: "consumer-electronics", label: "消费电子", event: ["苹果", "消费电子", "手机", "智能眼镜", "XR", "AR", "VR"], stock: ["消费电子", "苹果概念", "智能眼镜", "MR", "虚拟现实", "PCB"] },
  { key: "new-energy", label: "新能源", event: ["新能源", "电池", "光伏", "储能", "锂电", "充电桩"], stock: ["新能源", "电池", "光伏", "储能", "锂电", "固态电池", "充电桩"] },
  { key: "power-electronics", label: "电力电子/储能", event: ["测试电源", "电力电子", "储能变流器", "储能逆变器", "PCS", "充电桩", "盛弘股份", "爱科赛博"], stock: ["电力电子", "测试电源", "电源设备", "储能", "储能变流器", "储能逆变器", "PCS", "充电桩"] },
  { key: "military-space", label: "商业航天/卫星", event: ["军工", "航天", "太空", "卫星", "星座", "首星", "火箭", "发射", "SpaceX", "星舰", "国防"], stock: ["军工", "航天", "卫星", "商业航天", "卫星互联网", "太空算力", "国防"] },
  { key: "nuclear", label: "核能/可控核聚变", event: ["核能", "核电", "核聚变", "可控核聚变"], stock: ["核能", "核电", "核聚变", "可控核聚变"] },
  { key: "resources", label: "资源品", event: ["稀土", "有色", "黄金", "铜价", "铝价", "油价", "原油", "煤炭", "小金属", "矿山减产", "原料减产"], stock: ["稀土", "有色", "黄金", "铜", "铝", "石油", "煤炭", "小金属"] },
  { key: "finance", label: "金融/流动性", event: ["券商", "银行", "保险", "金融", "LPR", "FOMC", "美联储", "利率决议", "降息", "加息", "降准", "流动性"], stock: ["券商", "银行", "保险", "金融科技", "互联网金融", "房地产", "地产"] },
  { key: "gaming", label: "游戏/数字内容", event: ["游戏", "ChinaJoy", "数码互动娱乐", "游戏开发者大会", "版号"], stock: ["游戏", "网络游戏", "手机游戏", "云游戏", "电竞", "传媒"] },
  { key: "agriculture", label: "农业", event: ["农业", "种业", "粮食", "猪价", "养殖", "非洲猪瘟", "猪瘟"], stock: ["农业", "种业", "粮食", "猪肉", "养殖"] },
  { key: "market-microstructure", label: "市场结构/资金节点", event: ["股指交割", "交割日", "股指期货", "股指期权", "期指基差", "期权到期", "三巫日"], stock: [] },
];

const THEME_IMPACT_PROFILES = {
  "ai-compute": {
    sectors: ["算力基础设施", "CPO/光模块", "高速互连/PCB", "服务器/液冷"],
    transmission: "先验证算力资本开支是否上修，再看光模块、PCB、服务器等容量方向能否同步放量。",
  },
  semiconductor: {
    sectors: ["存储芯片/HBM", "先进封装", "半导体设备", "晶圆制造"],
    transmission: "海外财报、国产替代或供需变化先影响存储与封装预期，最终要由A股中军和板块成交确认。",
  },
  robot: {
    sectors: ["人形机器人", "减速器", "伺服/丝杠", "机器视觉"],
    transmission: "新品或大会先抬升产业预期，只有核心零部件与整机方向共同走强才算有效传导。",
  },
  medicine: {
    sectors: ["创新药", "CRO", "医疗器械", "疫苗/生物制品"],
    transmission: "政策、临床或授权信息先验证真实受益公司，再看医药板块能否形成持续扩散。",
  },
  "low-altitude": {
    sectors: ["低空经济", "eVTOL", "通用航空", "无人机/空管"],
    transmission: "展会和政策只能形成预期，需等待订单、适航或核心股放量确认，临近节点防兑现。",
  },
  automobile: {
    sectors: ["智能驾驶", "汽车零部件", "整车", "车路云"],
    transmission: "论坛或新品先影响智能驾驶与零部件预期，整车和中军不共振时按局部轮动处理。",
  },
  "consumer-electronics": {
    sectors: ["消费电子", "苹果链", "智能眼镜/XR", "PCB"],
    transmission: "新品预期先传导至核心供应链，发布日前若已连续加速，要优先识别兑现而非继续追高。",
  },
  "new-energy": {
    sectors: ["储能", "锂电池", "光伏", "充电桩"],
    transmission: "价格、订单或政策变化先看产业链利润改善，再看容量核心与板块广度是否同步修复。",
  },
  "power-electronics": {
    sectors: ["测试电源", "储能PCS", "充电桩", "电力电子"],
    transmission: "产品涨价先验证是否改善利润和订单，而不是把所有涨价信息都归为资源品行情。",
  },
  "military-space": {
    sectors: ["商业航天", "卫星互联网", "航天电子", "太空算力"],
    transmission: "发射节点主要验证产业进度，核心股和卫星互联网板块未提前共振时只作日历观察。",
  },
  nuclear: {
    sectors: ["核电设备", "可控核聚变", "核材料", "电力运营"],
    transmission: "大会催化必须落到技术进展、订单或政策，单纯会议召开不能直接定义为买点。",
  },
  resources: {
    sectors: ["有色金属", "黄金", "小金属", "油气/煤炭"],
    transmission: "资源品主要看价格和供给约束，期货、现货与A股核心未共振时不确认趋势。",
  },
  finance: {
    sectors: ["银行", "券商", "地产链", "高估值成长"],
    transmission: "利率事件的方向取决于是否超预期：宽松利好风险偏好，偏鹰则压制高估值，不能预设必涨。",
  },
  agriculture: {
    sectors: ["养殖", "种业", "粮食", "动物疫苗"],
    transmission: "供给或疫情事件先看商品价格与国内产业链传导，没有价格反应时不升级。",
  },
  gaming: {
    sectors: ["游戏", "传媒", "AI应用", "游戏出海"],
    transmission: "大会和展会只提供题材窗口，版号、产品流水或核心公司业绩才是更强验证。",
  },
  "market-microstructure": {
    sectors: ["指数权重", "券商/期货", "高流动性核心资产", "期现基差"],
    transmission: "交割与展期不预设方向；只有期指基差、指数权重、尾盘量能和市场广度同时异常，才把短线波动归因为资金结构影响。",
  },
};

const MACRO_IMPACT_RULES = [
  {
    key: "domestic-liquidity",
    pattern: /LPR|人民银行|央行|降准|国内.{0,6}利率/,
    sectors: ["银行", "券商", "地产链", "高估值成长"],
    transmission: "先比较实际结果与市场预期；超预期宽松才可能抬升风险偏好，不及预期反而可能兑现。",
  },
  {
    key: "fomc",
    pattern: /FOMC|美联储|美国.{0,6}利率决议/,
    sectors: ["黄金/有色", "高估值科技", "外资敏感资产", "人民币汇率相关"],
    transmission: "通过美元、美债收益率和全球风险偏好传导；重点看结果与指引是否比市场定价更鹰或更鸽。",
  },
  {
    key: "macro-data",
    pattern: /PMI|GDP|CPI|PPI|非农|就业|通胀/,
    sectors: ["顺周期", "消费", "资源品", "指数权重"],
    transmission: "宏观数据本身不是方向，关键是数据相对预期的偏差以及市场此前已经交易了多少。",
  },
  {
    key: "index-settlement",
    pattern: /股指.{0,8}交割|交割日|股指期货|股指期权|期权到期|期指基差|三巫日/,
    sectors: ["指数权重", "券商/期货", "高流动性核心资产", "期现基差"],
    transmission: "交割和移仓可能放大盘中及尾盘波动，但不天然代表利空；重点核对期指基差、权重成交与涨跌家数是否同步异常。",
  },
];

const JUNK_PATTERNS = [
  /首富|身家|财富榜|财富排名|中一签能赚多少|股价能涨多少/,
  /投资者.{0,8}(信心|兴趣)|继续看好|观点认为|专家表示|机构人士表示/,
  /盘点|回顾|一文看懂|十大新闻|今日热议|网友热议/,
  /早报|晚报|晨报|盘前热点|每日要闻|今日要闻|要闻汇总|消息汇总/,
];
const RUMOR_PATTERNS = [/传闻|网传|据悉|消息称|知情人士|或将|未经证实|市场消息/];
const MATERIAL_PATTERNS = [
  /发布|印发|宣布|批准|获批|通过|签署|中标|订单|量产|投产|扩产|减产|涨价|降价/,
  /制裁|禁运|关税|出口管制|调查|处罚|召回|停产|破产|裁员|并购|重组/,
  /发布会|大会|峰会|论坛|会议|听证会|博览会|展览会|展会|首展|召开|举行|发射|试飞|财报|业绩|上市|IPO|调价窗口|CPI|PPI|GDP|PMI|非农|就业|通胀|LPR|利率决议|议息会议|降息|加息|降准|股指交割|交割日|股指期货|股指期权|期权到期|三巫日/,
  /冲突|战争|袭击|空袭|熔断|大跌|暴跌|死亡|事故|地震|疫情|猪瘟|技术突破|新产品|新模型|新一代/,
];
const OFFICIAL_ACTORS = ["国务院", "中共中央", "工信部", "发改委", "财政部", "商务部", "证监会", "交易所", "中金所", "中国金融期货交易所", "央行", "人民银行", "美联储", "欧盟委员会", "卫生部", "国防部", "外交部", "美军中央司令部", "公司公告", "官方"];
const OFFICIAL_ACTIONS = ["发布", "印发", "宣布", "决定", "批准", "通过", "公告", "召开", "举行", "签署", "发表", "通报", "正式"];
const POSITIVE_PATTERNS = [/支持|鼓励|补贴|降息|降准|获批|中标|订单|量产|扩产|突破|增长|上调|合作/];
const NEGATIVE_PATTERNS = [/制裁|禁运|关税|出口管制|处罚|召回|停产|破产|裁员|下调|冲突|战争|袭击|空袭|熔断|大跌|暴跌|死亡|受伤|疫情|猪瘟|严峻|风险|减持/];

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function average(values) {
  const rows = values.map(Number).filter(Number.isFinite);
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : 0;
}

function normalizeText(value) {
  return String(value || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function normalizeNow(value) {
  const date = new Date(value || Date.now());
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function containsAny(text, words) {
  const upper = normalizeText(text).toUpperCase();
  return words.some((word) => upper.includes(String(word).toUpperCase()));
}

function parseEventDate(text, nowValue) {
  const source = normalizeText(text);
  const now = new Date(nowValue || Date.now());
  const iso = source.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
  const cn = source.match(/(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日/);
  const hit = iso || cn;
  if (!hit) return null;
  const year = Number(hit[1] || now.getFullYear());
  const month = Number(hit[2]);
  const day = Number(hit[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysUntil(dateText, nowValue) {
  if (!dateText) return null;
  const now = new Date(nowValue || Date.now());
  const target = new Date(`${dateText}T00:00:00+08:00`);
  const today = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)}T00:00:00+08:00`);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function sourceAssessment(item, fullText) {
  const declared = normalizeText(item.source || item.publisher || "");
  const provider = normalizeText(item.sourceProvider || declared || "unknown");
  if (item.sourceType === "official" || /政府|交易所|公司公告|监管机构/.test(declared)) {
    return { level: "S", score: 25, label: "官方原始来源", reason: declared || "明确标注官方原始来源", origin: declared, provider };
  }
  if (RUMOR_PATTERNS.some((pattern) => pattern.test(fullText))) {
    return { level: "C", score: 0, label: "传闻待核实", reason: "含传闻或匿名消息表述，不能进入决策", origin: declared, provider };
  }
  const actor = OFFICIAL_ACTORS.find((word) => fullText.includes(word));
  const action = OFFICIAL_ACTIONS.find((word) => fullText.includes(word));
  if (actor && action) {
    return { level: "A", score: 22, label: "官方信息转述", reason: `${actor}${action}，由快讯二次转述`, origin: declared, provider };
  }
  return { level: "B", score: 14, label: "专业媒体线索", reason: declared ? `来源：${declared}` : "快讯聚合信息，需独立交叉验证", origin: declared, provider };
}

function classifyCategory(text, eventDate) {
  if (/战争|冲突|袭击|空袭|死亡|疫情|猪瘟|制裁|禁运|关税|出口管制|金融危机|大跌|暴跌|熔断|重大事故/.test(text)) return { code: "systemic", label: "系统性风险" };
  if (/股指.{0,8}交割|交割日|股指期货|股指期权|期权到期|期指基差|三巫日/.test(text)) return { code: "market-structure", label: "市场结构/资金节点" };
  if (/国务院|中共中央|工信部|发改委|财政部|商务部|证监会|央行|美联储|政策|规划|CPI|PPI|GDP|PMI|非农|就业|通胀|LPR|利率决议|议息会议|降息|降准|加息/.test(text)) return { code: "policy", label: "宏观/政策" };
  if (/涨价|降价|缺货|库存|减产|扩产|订单|中标|供需/.test(text)) return { code: "supply", label: "供需/价格" };
  if (eventDate && /发布会|大会|峰会|会议|论坛|博览会|展览会|展会|首展|召开|举行|发射|试飞|财报|调价/.test(text)) return { code: "scheduled", label: "固定日期事件" };
  if (/发布会|大会|新产品|新模型|技术突破|量产|投产|芯片|人工智能|机器人/.test(text)) return { code: "industry", label: "产业/技术催化" };
  if (/公司|股份|业绩|财报|上市|IPO|并购|重组|回购|减持|裁员/.test(text)) return { code: "company", label: "公司级事件" };
  return { code: "other", label: "其他事件" };
}

function classifyDirection(text) {
  const positive = POSITIVE_PATTERNS.filter((pattern) => pattern.test(text)).length;
  const negative = NEGATIVE_PATTERNS.filter((pattern) => pattern.test(text)).length;
  if (positive && negative) return { code: "mixed", label: "影响偏复杂" };
  if (negative) return { code: "negative", label: "偏负面" };
  if (positive) return { code: "positive", label: "偏正面" };
  return { code: "neutral", label: "方向待验证" };
}

function matchThemes(text) {
  return THEME_DEFINITIONS.filter((theme) => containsAny(text, theme.event));
}

function uniqueStrings(values, limit = 12) {
  const seen = new Set();
  const rows = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = normalizeText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    rows.push(text);
    if (rows.length >= limit) break;
  }
  return rows;
}

function impactAssessment(themeDefs, fullText, direction) {
  const themeProfiles = themeDefs
    .map((theme) => THEME_IMPACT_PROFILES[theme.key])
    .filter(Boolean);
  const macroProfiles = MACRO_IMPACT_RULES.filter((rule) => rule.pattern.test(fullText));
  const sectors = uniqueStrings([
    ...themeProfiles.flatMap((profile) => profile.sectors || []),
    ...macroProfiles.flatMap((profile) => profile.sectors || []),
  ]);
  const transmissionPaths = uniqueStrings([
    ...macroProfiles.map((profile) => profile.transmission),
    ...themeProfiles.map((profile) => profile.transmission),
  ], 4);
  const directionNote = direction.code === "negative"
    ? "先按负面传导观察，只有A股对应板块止跌并出现承接，风险约束才允许解除。"
    : direction.code === "positive"
      ? "正面事件也必须比较预期差；若市场已经提前上涨，临近节点优先防兑现。"
      : "事件结果尚未落地，不预设涨跌；最终看结果相对预期以及A股核心股的价格反馈。";
  return {
    sectors,
    transmissionPaths,
    directionNote,
    mapped: sectors.length > 0,
  };
}

function candidateText(candidate) {
  const evidence = candidate && candidate.evidence || {};
  return [
    candidate && candidate.name,
    candidate && candidate.mainConcept,
    candidate && candidate.mainFamily,
    candidate && candidate.topic,
    ...((candidate && candidate.concepts) || []),
    ...(evidence.announcements || []).slice(0, 4).map((item) => item.title),
    ...(evidence.reports || []).slice(0, 4).map((item) => item.title),
  ].map(normalizeText).filter(Boolean).join(" ");
}

function mapCandidate(candidate, themes, eventText) {
  const concepts = [candidate.mainConcept, candidate.mainFamily, candidate.topic, ...(candidate.concepts || [])].map(normalizeText).filter(Boolean);
  const conceptText = concepts.join(" ");
  const evidence = candidate.evidence || {};
  const evidenceText = [...(evidence.announcements || []), ...(evidence.reports || [])].map((item) => normalizeText(item.title)).join(" ");
  const matchedThemes = themes.filter((theme) => containsAny(conceptText, theme.stock));
  if (!matchedThemes.length) return null;
  const evidenceMatched = matchedThemes.some((theme) => containsAny(evidenceText, [...theme.event, ...theme.stock]));
  const eventTermMatched = matchedThemes.some((theme) => containsAny(eventText, theme.event));
  const directness = clamp(18 + matchedThemes.length * 5 + (eventTermMatched ? 4 : 0), 0, 30);
  return { candidate, themes: matchedThemes, directness, evidenceMatched, text: candidateText(candidate) };
}

function anchorScore(mapped) {
  const stock = mapped.candidate;
  const kline = stock.klineProfile;
  const amount = Number(stock.amountYi);
  if (!stock.code || !stock.name || !kline || !Number.isFinite(amount) || amount < 2) return null;
  const role = normalizeText(stock.role);
  const recognition = /龙头/.test(role) ? 15 : /中军|核心/.test(role) ? 12 : /补涨/.test(role) ? 7 : 4;
  const materiality = mapped.evidenceMatched ? 20 : stock.evidence && stock.evidence.checked ? 9 : 5;
  const leadership = (stock.inBothSources ? 8 : 3) + (Number(stock.score) >= 100 ? 7 : Number(stock.score) >= 70 ? 4 : 1);
  const liquidity = amount >= 80 ? 10 : amount >= 30 ? 8 : amount >= 10 ? 6 : 3;
  const sensitivity = clamp((Math.max(0, Number(stock.changePct) || 0) / 5) * 4 + (Math.max(0, Number(kline.rise10) || 0) / 15) * 6, 0, 10);
  const data = 5;
  const score = Math.round(clamp(Math.min(25, mapped.directness) + materiality + recognition + leadership + liquidity + sensitivity + data));
  const type = mapped.evidenceMatched ? "基本面锚点" : /龙头|中军|核心/.test(role) ? "市场情绪锚点" : "辅助验证标的";
  return {
    code: stock.code,
    name: stock.name,
    type,
    score,
    role: role || "观察",
    concept: mapped.themes.map((theme) => theme.label).join("/") || stock.mainConcept || "事件映射",
    changePct: Number.isFinite(Number(stock.changePct)) ? Number(stock.changePct) : null,
    amountYi: amount,
    rise10: Number.isFinite(Number(kline.rise10)) ? Number(kline.rise10) : null,
    rise20: Number.isFinite(Number(kline.rise20)) ? Number(kline.rise20) : null,
    newHigh: Boolean(kline.newHigh),
    evidenceLevel: mapped.evidenceMatched ? "有公告/研报交叉证据" : "概念映射待基本面复核",
  };
}

function buildAnchors(mappedCandidates, themeLabels) {
  const items = mappedCandidates.map(anchorScore).filter(Boolean).filter((item) => item.score >= 55).sort((a, b) => b.score - a.score).slice(0, 5);
  const fundamental = items.filter((item) => item.type === "基本面锚点").length;
  const sentiment = items.filter((item) => item.type === "市场情绪锚点").length;
  const sector = {
    type: "板块确认锚点",
    name: `${themeLabels.join("/") || "事件方向"}等权观察组`,
    sampleCount: mappedCandidates.length,
    positiveCount: mappedCandidates.filter((item) => Number(item.candidate.changePct) > 0).length,
  };
  return {
    items,
    fundamentalCount: fundamental,
    sentimentCount: sentiment,
    sector,
    confirmedDimensions: Number(fundamental > 0) + Number(sentiment > 0) + Number(sector.sampleCount >= 3 && sector.positiveCount >= 2),
    rule: "基本面锚点、市场情绪锚点、板块确认锚点至少两项有效，才允许事件方向进入买入验证。",
  };
}

function buildImpactStocks(mappedCandidates, anchors) {
  const anchorByCode = new Map((anchors && Array.isArray(anchors.items) ? anchors.items : []).map((item) => [String(item.code), item]));
  const seen = new Set();
  return mappedCandidates
    .map((mapped) => {
      const stock = mapped && mapped.candidate || {};
      const code = normalizeText(stock.code || stock.secCode);
      const name = normalizeText(stock.name);
      if (!code || !name || seen.has(code)) return null;
      seen.add(code);
      const anchor = anchorByCode.get(code) || null;
      const amountYi = Number(stock.amountYi);
      const hasQuoteData = Boolean(stock.klineProfile) && Number.isFinite(amountYi);
      const qualified = Boolean(anchor);
      const mappingThemes = uniqueStrings((mapped.themes || []).map((theme) => theme.label), 4);
      let reason = "进入当日候选池，但尚未通过核心验证门槛。";
      if (!hasQuoteData) reason = "缺少完整行情或K线数据，只保留产业映射。";
      else if (amountYi < 2) reason = "成交额低于2亿元，流动性不足，不能作为核心锚点。";
      else if (!qualified) reason = "有板块映射，但辨识度、真实受益证据或综合分尚未过线。";
      else reason = anchor.evidenceLevel || "已通过真实映射、流动性和辨识度验证。";
      return {
        code,
        name,
        status: qualified ? "核心验证" : hasQuoteData ? "方向候选" : "映射待验证",
        qualified,
        score: qualified ? anchor.score : null,
        marketScore: Number.isFinite(Number(stock.score)) ? Number(stock.score) : null,
        role: normalizeText(stock.role || stock.ticketType) || "观察",
        concept: mappingThemes.join("/") || normalizeText(stock.mainConcept || stock.mainFamily) || "事件映射",
        changePct: Number.isFinite(Number(stock.changePct)) ? Number(stock.changePct) : null,
        amountYi: Number.isFinite(amountYi) ? amountYi : null,
        reason,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (
      Number(right.qualified) - Number(left.qualified)
      || Number(right.score || right.marketScore || 0) - Number(left.score || left.marketScore || 0)
      || Number(right.amountYi || 0) - Number(left.amountYi || 0)
    ))
    .slice(0, 6);
}

function priceComponentScore(mappedCandidates, eventDate, nowValue) {
  const rows = mappedCandidates.map((item) => item.candidate).filter((stock) => stock.klineProfile && Number(stock.amountYi) >= 2);
  if (!rows.length) return { score: 0, recognitionScore: 0, label: "无法判断", evidence: ["没有合格的A股行情验证样本"], sampleCount: 0 };
  const rise10 = average(rows.map((stock) => stock.klineProfile.rise10));
  const rise20 = average(rows.map((stock) => stock.klineProfile.rise20));
  const rise2 = average(rows.map((stock) => stock.klineProfile.rise2));
  const today = average(rows.map((stock) => stock.changePct));
  const positiveRatio = rows.filter((stock) => Number(stock.changePct) > 0).length / rows.length;
  const newHighRatio = rows.filter((stock) => stock.klineProfile.newHigh).length / rows.length;
  const nearHighRatio = rows.filter((stock) => stock.klineProfile.nearHigh20 || Number(stock.klineProfile.pctFromHigh) <= 3).length / rows.length;
  const volumeRatio = rows.filter((stock) => stock.klineProfile.volumeBreakout).length / rows.length;
  const days = daysUntil(eventDate, nowValue);

  const performance = rise20 >= 35 || rise10 >= 25 ? 20 : rise20 >= 20 || rise10 >= 15 ? 16 : rise20 >= 10 || rise10 >= 8 ? 11 : rise20 > 0 || rise10 > 0 ? 6 : 1;
  const height = clamp(newHighRatio * 12 + nearHighRatio * 8 + (rise20 >= 30 ? 5 : rise20 >= 15 ? 3 : 0), 0, 20);
  const breadth = clamp((rows.length >= 5 ? 7 : rows.length >= 3 ? 5 : rows.length >= 2 ? 3 : 1) + positiveRatio * 8, 0, 15);
  const crowding = clamp((rise2 >= 10 ? 8 : rise2 >= 5 ? 5 : rise2 > 0 ? 2 : 0) + volumeRatio * 7, 0, 15);
  const timing = days == null ? 2 : days < 0 ? 10 : days <= 2 ? 10 : days <= 7 ? 7 : days <= 30 ? 4 : 1;
  const sensitivity = clamp((today >= 5 ? 10 : today >= 2 ? 7 : today > 0 ? 4 : 0) + newHighRatio * 6 + volumeRatio * 4, 0, 20);
  let score = Math.round(clamp(performance + height + breadth + crowding + timing + sensitivity));
  if (rows.length === 1) score = Math.min(score, 45);
  const recognitionScore = Math.round(clamp(
    (rows.length >= 5 ? 20 : rows.length >= 3 ? 15 : rows.length >= 2 ? 10 : 5)
    + positiveRatio * 25
    + (rows.some((stock) => /龙头|中军|核心/.test(normalizeText(stock.role))) ? 20 : 5)
    + (average(rows.map((stock) => stock.amountYi)) >= 80 ? 20 : average(rows.map((stock) => stock.amountYi)) >= 30 ? 14 : 7)
    + volumeRatio * 15,
  ));
  const label = score >= 81 ? "高度拥挤" : score >= 61 ? "充分交易" : score >= 41 ? "部分交易" : score >= 21 ? "轻度预热" : "基本未交易";
  return {
    score,
    recognitionScore,
    label,
    sampleCount: rows.length,
    evidence: [
      `映射样本${rows.length}只，近10日平均${rise10.toFixed(1)}%，近20日平均${rise20.toFixed(1)}%`,
      `今日上涨样本占${Math.round(positiveRatio * 100)}%，创新高占${Math.round(newHighRatio * 100)}%`,
      eventDate ? `距离事件节点${days == null ? "未知" : days >= 0 ? `${days}天` : `已过去${Math.abs(days)}天`}` : "事件没有明确落地日期，时间维度暂不加分",
    ],
  };
}

function lifecycleFromPricing(pricing, eventDate, nowValue, riskOnly = false) {
  const days = daysUntil(eventDate, nowValue);
  if (riskOnly) return { code: "P5", label: "风险传导验证", reason: "事件已经发生，当前只验证A股是否继续跟随或开始承接" };
  if (days != null && days < -3) return { code: "P6", label: "影响衰减", reason: "事件落地已超过三个交易观察日，不再按新催化处理" };
  if (days != null && days < 0 && days >= -3) return { code: "P5", label: "落地验证", reason: "事件已经落地，观察内容与资金承接是否匹配" };
  if (days != null && days <= 2 && pricing.score >= 60) return { code: "P4", label: "兑现窗口", reason: "临近事件节点且预期交易较充分，优先防高开兑现" };
  if (pricing.score >= 75) return { code: "P3", label: "拥挤期", reason: "核心高度、扩散和成交拥挤度均偏高" };
  if (pricing.score >= 50) return { code: "P2", label: "发酵期", reason: "核心与板块已经出现一定共振" };
  if (pricing.score >= 21) return { code: "P1", label: "预热期", reason: "少数验证标的开始反应，尚未充分扩散" };
  return { code: "P0", label: "潜伏/未认可", reason: "价格尚未明显反应，需要区分未发现与不认可" };
}

function hasSystemicTransmission(fullText, themes, mappedCandidates) {
  if (themes.length || mappedCandidates.length) return true;
  return /A股|港股|美股|韩股|股市|交易所|指数|熔断|汇率|美元|人民币|利率|美联储|原油|石油|天然气|黄金|有色|航运|霍尔木兹|台海|关税|制裁|禁运|出口管制|供应链/.test(fullText);
}

function importanceAssessment(source, category, themes, mappedCount, eventDate, fullText) {
  const transmission = category.code === "systemic" ? 20 : themes.length ? clamp(10 + mappedCount * 3, 0, 20) : 0;
  const impact = category.code === "systemic" || category.code === "policy" || category.code === "market-structure" ? 15 : category.code === "industry" || category.code === "scheduled" || category.code === "supply" ? 12 : category.code === "company" ? 8 : 4;
  const novelty = source.level === "C" ? 2 : /正式|首次|突破|批准|宣布|发布|突发/.test(fullText) ? 15 : eventDate ? 10 : 6;
  const persistence = category.code === "policy" ? 10 : ["industry", "scheduled", "supply", "market-structure"].includes(category.code) ? 9 : category.code === "systemic" ? 8 : 5;
  const verifiability = clamp((mappedCount ? 5 : 0) + (eventDate ? 3 : 0) + (["S", "A"].includes(source.level) ? 2 : 0), 0, 10);
  const timeClarity = eventDate ? 5 : 2;
  const score = Math.round(clamp(source.score + transmission + impact + novelty + persistence + verifiability + timeClarity));
  const grade = score >= 85 ? "E4" : score >= 70 ? "E3" : score >= 55 ? "E2" : score >= 40 ? "E1" : "E0";
  const label = { E4: "核心事件", E3: "重要事件", E2: "跟踪事件", E1: "普通信息", E0: "无效信息" }[grade];
  return { score, grade, label };
}

function tradingAssessment({ pricing, marketState, marketEmotion, direction, anchors, eventDate, nowValue, eligible }) {
  const light = marketEmotion && marketEmotion.light || "yellow";
  const marketCapacity = light === "green" ? 20 : light === "red" ? 3 : 12;
  const expectationGap = (100 - pricing.score) * 0.25;
  const room = (100 - pricing.score) * 0.2;
  const confirmation = pricing.recognitionScore * 0.25;
  const days = daysUntil(eventDate, nowValue);
  const timing = pricing.score >= 80 ? 0 : days != null && days <= 2 ? 3 : days != null && days <= 7 ? 6 : 10;
  let score = Math.round(clamp(marketCapacity + expectationGap + room + confirmation + timing));
  const weakPositive = direction.code === "positive" && (light === "red" || /退潮|冰点/.test(normalizeText(marketState && marketState.cycle)));
  if (weakPositive && pricing.recognitionScore < 60) score = Math.min(score, 59);
  if (pricing.score >= 80) score = Math.min(score, 39);
  if (!eligible || (!anchors.items.length && direction.code !== "negative")) score = Math.min(score, 39);
  const grade = score >= 75 ? "T3" : score >= 60 ? "T2" : score >= 40 ? "T1" : "T0";
  const label = { T3: "高优先级验证", T2: "条件观察", T1: "弱相关/待确认", T0: "无主动交易价值" }[grade];
  return { score, grade, label, weakPositive };
}

function scenarioSet(event) {
  const riskOnly = event.direction.code === "negative" || event.category.code === "systemic";
  if (riskOnly) {
    return [
      { type: "risk-spread", label: "风险扩散路径", condition: "外围继续走弱，A股对应板块、核心股与市场广度同步恶化，继续收紧或延后买入。" },
      { type: "absorb", label: "承接消化路径", condition: "A股低开后不再扩大跌幅，核心率先止跌、板块回流且市场广度修复，风险约束才允许逐步解除。" },
      { type: "weak-link", label: "弱传导路径", condition: "外围冲击存在，但A股只短暂反应且核心不跟跌，保留提醒，不把外部事件升级成国内退潮。" },
      { type: "invalidation", label: "风险解除条件", condition: "新增利空不再推动下跌，核心与指数形成连续承接，才确认风险已被价格消化。" },
    ];
  }
  return [
    { type: "strengthen", label: "加强路径", condition: "市场总开关不恶化，基本面锚点、情绪锚点和板块锚点至少两项同步转强。" },
    { type: "weak-repair", label: "弱修复路径", condition: "只有单个情绪核心上涨、板块扩散不足，只能观察，不能按主线加强处理。" },
    { type: "cashout", label: "兑现路径", condition: event.pricing.score >= 60 ? "当前预期交易已较充分；临近节点若高开低走或放量不创新高，按兑现处理。" : "若后续快速加速并临近事件节点，重新计算交易度并防范兑现。" },
    { type: "invalidation", label: "失效路径", condition: "核心锚点转弱、板块无扩散，或新增利好无法推动价格，取消事件驱动逻辑。" },
  ];
}

function marketIntegration(event, marketState, marketEmotion) {
  const cycle = normalizeText(marketState && marketState.cycle) || "未知周期";
  const light = marketEmotion && marketEmotion.light || "yellow";
  if (event.calendarRole === "short-term-risk") {
    return {
      mode: "observe",
      marketNote: `当前${cycle}周期保持不变；该日历节点只提高短线风险观察优先级，不反向修改情绪周期。`,
      directionNote: event.category.code === "market-structure"
        ? "观察期指基差、指数权重、尾盘量能与市场广度是否同步异常，不把交割日预设成利空或利好。"
        : "观察海外资产对结果与预期差的真实定价，再验证A股指数、板块和核心股的承接。",
      entryGate: "短线风险日历不直接生成买点，也不因日期临近自动减仓；只在价格与市场广度出现共振时升级风险提示。",
      invalidation: "若相关资产、指数权重和市场广度均无异常反馈，则保留记录但不把当日波动强行归因于该节点。",
    };
  }
  const riskOnly = event.direction.code === "negative" || event.category.code === "systemic";
  const marketNote = event.direction.code === "positive" && (light === "red" || /退潮|冰点/.test(cycle))
    ? `当前${cycle}且市场承载偏弱，事件只能定义为潜在修复催化，不能改变周期。`
    : riskOnly
      ? `当前${cycle}周期保持不变；该事件只作为外部风险约束，不能反向定义A股周期。`
      : `事件结论只辅助方向与验证，不改变当前${cycle}周期判定。`;
  const entryGate = riskOnly
    ? "负面系统事件只收紧或延后买入权限，不生成反向买点；风险未被A股承接前，禁止因跌幅大而抄底。"
    : ["T3", "T2"].includes(event.trading.grade)
      ? `事件方向获得观察资格；次日仍需三锚至少两项确认，且市场买入总开关通过后才能执行。`
      : "事件只进入观察或风险提示，不生成无条件买点。";
  return {
    mode: riskOnly ? "risk" : ["T3", "T2"].includes(event.trading.grade) ? "conditional" : "observe",
    marketNote,
    directionNote: riskOnly
      ? "先观察A股指数、对应板块与核心股是否止跌承接；风险尚未被价格消化前，不做利空出尽假设。"
      : event.themes.length ? `关注${event.themes.join("/")}的A股传导，优先看验证锚点而不是新闻标题。` : "暂无清晰A股产业映射，只观察系统性影响。",
    entryGate,
    invalidation: riskOnly
      ? "A股对应板块不再跟跌、核心率先止跌且市场广度修复，才视为外部风险被承接；否则风险约束继续有效。"
      : "单票独强、边缘股乱涨、核心高开低走或新增利好不再推动价格，均视为传导失败或兑现。",
  };
}

function shingles(text) {
  const clean = normalizeText(text).replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "");
  const set = new Set();
  for (let index = 0; index < clean.length - 1; index += 1) set.add(clean.slice(index, index + 2));
  return set;
}

function similarTitle(left, right) {
  const a = shingles(left);
  const b = shingles(right);
  if (!a.size || !b.size) return false;
  let hit = 0;
  for (const value of a) if (b.has(value)) hit += 1;
  return hit / Math.min(a.size, b.size) >= 0.62;
}

function clusterNews(rows) {
  const clusters = [];
  for (const row of rows) {
    const found = clusters.find((cluster) => {
      const leftDate = normalizeText(cluster[0] && cluster[0].eventDate);
      const rightDate = normalizeText(row && row.eventDate);
      if (leftDate && rightDate && leftDate !== rightDate) return false;
      return similarTitle(cluster[0].title, row.title);
    });
    if (found) found.push(row);
    else clusters.push([row]);
  }
  return clusters;
}

function eventId(title, date) {
  return crypto.createHash("sha1").update(`${normalizeText(title)}|${date || ""}`).digest("hex").slice(0, 12);
}

function buildOneEvent(cluster, input) {
  const row = cluster.find((item) => item && item.sourceType === "official") || cluster[0];
  const calendarRow = cluster.find((item) => item && item.calendarRole) || row;
  const title = normalizeText(row.title);
  const summary = normalizeText(row.summary || row.content);
  const sourceThemes = Array.isArray(row.themes) ? row.themes.map(normalizeText).filter(Boolean) : [];
  const fullText = `${title} ${summary} ${sourceThemes.join(" ")}`;
  const eventDate = parseEventDate(row.eventDate, input.now) || parseEventDate(fullText, input.now);
  const source = sourceAssessment(row, fullText);
  const category = classifyCategory(fullText, eventDate);
  const direction = classifyDirection(fullText);
  const themeDefs = matchThemes(fullText);
  const mappedCandidates = (input.candidates || []).map((candidate) => mapCandidate(candidate, themeDefs, fullText)).filter(Boolean);
  const importance = importanceAssessment(source, category, themeDefs, mappedCandidates.length, eventDate, fullText);
  const providers = [...new Set(cluster.map((item) => normalizeText(item && (item.sourceProvider || item.source || item.publisher)) || "unknown"))];
  const corroboration = providers.length;
  const sourcePass = ["S", "A"].includes(source.level) || (source.level === "B" && corroboration >= 2);
  const anchors = buildAnchors(mappedCandidates, themeDefs.map((theme) => theme.label));
  const impact = impactAssessment(themeDefs, fullText, direction);
  const impactStocks = buildImpactStocks(mappedCandidates, anchors);
  const calendarRole = normalizeText(calendarRow && calendarRow.calendarRole) || null;
  const calendarOnly = calendarRole === "short-term-risk";
  const riskOnly = category.code === "systemic" && direction.code !== "positive";
  const riskTransmissionPass = riskOnly && hasSystemicTransmission(fullText, themeDefs, mappedCandidates);
  const anchorPass = anchors.items.length > 0 || riskTransmissionPass;
  const eligible = !calendarOnly && importance.score >= 70 && sourcePass && anchorPass;
  const pricing = priceComponentScore(mappedCandidates, eventDate, input.now);
  const lifecycle = lifecycleFromPricing(pricing, eventDate, input.now, riskOnly);
  const dayDistance = daysUntil(eventDate, input.now);
  const event = {
    id: eventId(title, eventDate),
    title,
    summary,
    firstSeenAt: row.time || null,
    eventDate,
    daysUntil: dayDistance,
    horizon: dayDistance == null ? "undated" : dayDistance >= 0 ? "future" : "landed",
    category,
    direction,
    source: {
      ...source,
      corroboration,
      providers,
      providerGrade: row.sourceGradeLabel || null,
      providerGradeValue: Number.isFinite(Number(row.sourceGrade)) ? Number(row.sourceGrade) : null,
      sourceUrl: row.sourceUrl || null,
    },
    importance,
    lifecycle,
    pricing,
    trading: null,
    themes: themeDefs.map((theme) => theme.label),
    impact,
    impactStocks,
    anchors,
    calendarRole,
    calendarKind: normalizeText(calendarRow && calendarRow.calendarKind) || null,
    calendarMeta: calendarRow && calendarRow.calendarMeta && typeof calendarRow.calendarMeta === "object" ? calendarRow.calendarMeta : null,
    eligibleForSystem: eligible,
    eligibility: {
      sourcePass,
      importancePass: importance.score >= 70,
      anchorPass,
      riskOnly,
      riskTransmissionPass,
      calendarOnly,
    },
  };
  event.trading = tradingAssessment({
    pricing,
    marketState: input.market && input.market.state,
    marketEmotion: input.marketEmotion,
    direction,
    anchors,
    eventDate,
    nowValue: input.now,
    eligible,
  });
  if (riskOnly) {
    const riskLabels = { T3: "高优先级风险约束", T2: "风险约束", T1: "风险观察", T0: "无新增风险" };
    event.trading.label = riskLabels[event.trading.grade] || "风险观察";
  }
  event.scenarios = scenarioSet(event);
  event.systemIntegration = marketIntegration(event, input.market && input.market.state, input.marketEmotion);
  return event;
}

function filterReason(row) {
  if (!row || typeof row !== "object") return "消息格式无效";
  const text = `${normalizeText(row.title)} ${normalizeText(row.summary || row.content)}`;
  if (!normalizeText(row.title)) return "无标题";
  if (JUNK_PATTERNS.some((pattern) => pattern.test(text))) return "观点、财富或盘点类信息，无新增可交易事实";
  if (!MATERIAL_PATTERNS.some((pattern) => pattern.test(text))) return "没有政策、产品、订单、价格或明确时间节点";
  return null;
}

function hasEventDistance(event) {
  return Boolean(event)
    && event.daysUntil !== null
    && event.daysUntil !== undefined
    && Number.isFinite(Number(event.daysUntil));
}

function isFutureMajorEvent(event) {
  if (!hasEventDistance(event) || Number(event.daysUntil) < 0) return false;
  const grade = event.importance && event.importance.grade;
  const sourceGrade = Number(event.source && event.source.providerGradeValue);
  const markedByCalendar = sourceGrade === 1 || sourceGrade === 3;
  const highImportance = grade === "E4" || grade === "E3";
  const mappedScheduled = grade === "E2"
    && ["policy", "scheduled"].includes(event.category && event.category.code)
    && Boolean(event.impact && event.impact.mapped);
  return markedByCalendar || highImportance || mappedScheduled;
}

function futureEventSort(left, right) {
  const dayDiff = Number(left.daysUntil) - Number(right.daysUntil);
  if (dayDiff) return dayDiff;
  const leftGrade = Number(left.source && left.source.providerGradeValue) || 99;
  const rightGrade = Number(right.source && right.source.providerGradeValue) || 99;
  if (leftGrade !== rightGrade) return leftGrade - rightGrade;
  return Number(right.importance && right.importance.score || 0) - Number(left.importance && left.importance.score || 0);
}

function watchEventSort(left, right) {
  const horizonRank = (event) => hasEventDistance(event)
    ? Number(event.daysUntil) >= 0 ? 0 : 2
    : 1;
  const rankDiff = horizonRank(left) - horizonRank(right);
  if (rankDiff) return rankDiff;
  if (horizonRank(left) === 0) return futureEventSort(left, right);
  if (horizonRank(left) === 2) return Number(right.daysUntil) - Number(left.daysUntil);
  return Number(right.importance && right.importance.score || 0) - Number(left.importance && left.importance.score || 0);
}

function buildEventInference(options = {}) {
  const input = {
    newsItems: Array.isArray(options.newsItems) ? options.newsItems : [],
    candidates: Array.isArray(options.candidates) ? options.candidates.filter((item) => item && typeof item === "object") : [],
    market: options.market || {},
    marketEmotion: options.marketEmotion || null,
    sourceStatuses: Array.isArray(options.sourceStatuses) ? options.sourceStatuses : [],
    now: normalizeNow(options.now),
  };
  const acceptedRows = [];
  const filtered = [];
  for (const row of input.newsItems) {
    const reason = filterReason(row);
    if (reason) filtered.push({ title: normalizeText(row && row.title) || "无标题", reason });
    else acceptedRows.push(row);
  }
  const events = clusterNews(acceptedRows).map((cluster) => buildOneEvent(cluster, input));
  const qualifiedEvents = events.filter((event) => event.eligibleForSystem).sort((a, b) => b.importance.score - a.importance.score || b.trading.score - a.trading.score);
  const futureMajorEvents = events.filter(isFutureMajorEvent).sort(futureEventSort);
  const landedEvents = events
    .filter((event) => hasEventDistance(event) && Number(event.daysUntil) < 0)
    .sort((left, right) => Number(right.daysUntil) - Number(left.daysUntil));
  const watchEvents = events.filter((event) => {
    if (event.eligibleForSystem || event.source.level === "C" || event.importance.score < 55) return false;
    if (event.category.code === "systemic") {
      return event.eligibility.riskTransmissionPass || event.themes.length > 0 || event.anchors.items.length > 0;
    }
    return event.themes.length > 0
      || event.anchors.items.length > 0
      || ["policy", "supply", "scheduled"].includes(event.category.code);
  }).sort(watchEventSort);
  const rejectedEvents = events.filter((event) => !event.eligibleForSystem && !watchEvents.includes(event));
  for (const event of rejectedEvents) {
    const noTransmission = event.category.code === "systemic" && !event.eligibility.riskTransmissionPass && !event.themes.length && !event.anchors.items.length;
    filtered.push({
      title: event.title,
      reason: event.source.level === "C"
        ? event.source.reason
        : noTransmission
          ? "没有明确的A股、资产价格或供应链传导路径"
          : `${event.importance.grade}，未达到E2事件门槛`,
    });
  }
  const state = input.market && input.market.state || {};
  const top = qualifiedEvents[0] || null;
  const summaryTop = top || futureMajorEvents[0] || watchEvents[0] || null;
  return {
    version: "event-inference-v2",
    generatedAt: new Date(input.now).toISOString(),
    sourceNote: "事件来自东财7×24、韭研时间轴、美联储官方日历与中金所交割规则；产业线索必须通过来源、重要性与A股锚点门槛，短线风险日历只作观察，不直接生成买点。",
    sources: input.sourceStatuses,
    marketContext: {
      cycle: state.cycle || "未知",
      subPhase: state.subPhase || "未知",
      light: input.marketEmotion && input.marketEmotion.light || "yellow",
      note: "市场环境用于放大、削弱或取消事件交易价值，但事件不能反向篡改情绪周期。",
    },
    summary: qualifiedEvents.length
      ? `发现${qualifiedEvents.length}个合格事件；最高优先级为${top.title}，当前${top.lifecycle.label}、${top.trading.label}。`
      : futureMajorEvents.length
        ? `未来${futureMajorEvents.length}个重大节点已进入作战日历；最近是${summaryTop.title}，当前均需等待板块与核心股验证。`
        : watchEvents.length
          ? `暂无可接入决策的E3/E4事件，${watchEvents.length}个事件保留观察。`
        : `本轮没有通过严格门槛的事件，已过滤${filtered.length}条普通或低质量信息。`,
    qualifiedEvents,
    futureMajorEvents,
    futureEventCount: events.filter((event) => hasEventDistance(event) && Number(event.daysUntil) >= 0).length,
    landedEvents,
    watchEvents,
    filteredCount: filtered.length,
    filtered: filtered.slice(0, 20),
    topEventId: top && top.id || null,
  };
}

module.exports = {
  THEME_DEFINITIONS,
  buildEventInference,
  parseEventDate,
  classifyCategory,
  classifyDirection,
  sourceAssessment,
};
