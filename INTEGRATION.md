# INTEGRATION.md —— 集成说明

> V7说明：下文的 `evaluateSellSignals` 与旧闸门示例只保留为历史观察模型。生产卖出评估统一走 `POST /api/sell-advisor/v7-evaluate`；V7定位为盘后完整一分钟回放，因此权威 `watchdog.runWatchCycle` 已关闭盘中卖出动作，也不会自动回退旧模型。旧行为仅可通过显式的 `runLegacyWatchCycle` 用于历史对照。

把《量化说明书》里项目缺的四块补进现有系统。新增 2 个文件、改 2 处旧代码。
新模块与 trading-rules.js 同风格:CommonJS、纯函数、可独立 `node test-sell-engine.js` 验证(18个场景已全部通过)。

---

## 一、新增文件(直接放到 server.js 同级目录)

| 文件 | 作用 |
|---|---|
| `sell-engine.js` | 全天卖出时间轴引擎(A闸/B闸/保本线/高点回撤/五日线)+ 弱转强加仓 + 账户熔断 + 板块集中度 |
| `journal.js` | 交易日志 JSON 存储 + 出口归因统计 + `/api/journal` 处理器 |
| `test-sell-engine.js` | 全部逻辑的回归测试(改阈值后跑一遍防改坏) |

## 二、server.js 改动(2处)

**① 顶部引入**(第7行 require trading-rules 的下面加):

```js
const { evaluateSellSignals, addOnSignal, accountCircuitBreaker, sectorConcentrationCheck } = require("./sell-engine");
const { createJournalHandler } = require("./journal");
const journalHandler = createJournalHandler({ sendJson }); // 复用你现有的 sendJson
```

**② handleApi 里挂路由**(在 `if (pathname !== "/api/hot-stocks")` 这个 404 判断**之前**插):

```js
if (await journalHandler(request, response, pathname)) return;
```

完成后即有三个新接口:

```bash
# 记一笔已平仓交易(exitGate 传 1-7 出口代号)
curl -X POST http://127.0.0.1:PORT/api/journal/add -H "Content-Type: application/json" -d '{
  "code":"001309","name":"德明利","sector":"存储芯片","dualLogic":true,
  "buyDate":"2025-09-15","buyPrice":100,"sellDate":"2025-09-18","sellPrice":112,
  "exitGate":"4","entryReason":"洗过的趋势票博回流","positionPct":20,"layers":2
}'
curl http://127.0.0.1:PORT/api/journal/trades   # 全部记录
curl http://127.0.0.1:PORT/api/journal/stats    # 胜率/盈亏比/最大回撤/各出口归因
```

## 三、trading-rules.js 补丁:hardGate 补「换手率分档」

现在 hardGate 只有成交额>5亿,缺说明书的换手分档(≤1000亿要求>12%、以上>8%)。
在 `hardGate` 的量比检查之前插入:

```js
  // 换手率分档(说明书第1节):小市值>12%,千亿以上>8%
  if (!Number.isFinite(stock.turnoverRate) || stock.turnoverRate === 0) {
    softFlags.push("换手率数据待确认");
  } else {
    const capYi = Number(stock.floatMktCapYi); // 流通市值(亿),调用方补喂
    const floor = Number.isFinite(capYi) && capYi > 1000 ? 8 : 12;
    if (stock.turnoverRate < floor) hardFails.push(`换手率${stock.turnoverRate}%不足${floor}%`);
  }
```

> 需要在 server.js 组装 stock 对象处补喂 `turnoverRate` 和 `floatMktCapYi` 两个字段(东财快照里都有,f8=换手率、f21=流通市值)。

## 四、sell-engine 的调用方式(接进你的实时链路)

`evaluateSellSignals(pos, ctx)` 是纯函数,喂持仓+行情快照,返回动作列表(取第一条执行):

```js
const actions = evaluateSellSignals(
  { costPrice: 100, board: "主板", dualLogic: true, gambleSold: false,
    isExpectedReflowDay: true, isHighFlyer: false },
  { time: "14:46", price: 99, dayHigh: 103, auction: "符合预期",
    aboveVwap: false, vwapBrokenMinutes: 6, ma5: 98, reflowConfirmed: false }
);
// → [{ gate:"②回流没来止损", action:"止损底仓", ... }]
```

字段说明都在 sell-engine.js 的 JSDoc 里。两个需要调用方(或人工)喂的判断:
- `auction`(竞价超/符合/不及预期)——第一版可人工在前端点选,后续再规则化
- `reflowConfirmed`(板块回流确认)——可先接你现有的 classifySubPhase/板块涨幅数据做粗判

持仓状态(dualLogic、isExpectedReflowDay)**必须盘前写死**,这是说明书4.25的铁律:双逻辑资格是盘前挣的,不许盘中补。

阈值全部集中在 `SELL_CFG` / `ACCOUNT_CFG` 两个对象,统计够30-50笔后按 `/api/journal/stats` 的出口归因回来调。

## 五、与现有模块的分工(避免打架)

- `stopProfitLoss`(旧):给**盘前计划**的止损止盈参考区间 → 保留,继续用于展示
- `evaluateSellSignals`(新):给**盘中执行**的分时点闸门信号 → 两者是计划vs执行的关系,不冲突
- 你已有的 runStockBacktest 回测的是**股票信号**;journal 统计的是**你自己的成交**——前者验证选股,后者验证执行,互补

## 六、验证

```bash
node test-sell-engine.js   # 应输出 18 个 ✓ + 全部测试通过
node test-archiver.js      # 归档模块 7 个 ✓
```

## 七、盘后落库 archiver.js(历史沉淀层)

独立脚本,不侵入 server.js。每个交易日收盘后跑一次:

```bash
node archiver.js                    # 从本机运行中的服务抓 /api/hot-stocks
node archiver.js --port 8000        # 指定端口
node archiver.js --file dump.json   # 离线:配合 node server.js --dump-data
```

产出三件套:
- `data/history/YYYY-MM-DD.json` 当日完整快照(原样归档)
- `data/history/index.json` 每日摘要索引(周期/涨停/炸板率/主线/候选,统计直接读它)
- `data/reports/YYYY-MM-DD.md` 复盘报告(自动标注周期切换、涨停环比,附明日待办清单)

定时方式二选一:
- crontab:`35 15 * * 1-5  cd /path/to/project && node archiver.js`
- 或 `npm i node-cron` 后接进 server.js 的 main()(代码见 archiver.js 文件底部注释,直接调 hotStocksPayload() 连 HTTP 都不走)

摘要提取做了字段名容错(camelCase/snake_case/常见别名都认),你 payload 结构以后改字段也不至于归档直接崩;实在取不到就标 null/未知,完整快照永远原样保底。

**攒数据的意义**:index.json 每天一行,一两个月后就能回答——标"退潮"的日子次日打板溢价是不是真的差、周期切换信号灵不灵。这是验证你系统地基(周期分类)的唯一途径。

## 八、盘前计划 preplan.js(sell-engine 的弹药库)

sell-engine 要求 dualLogic / isExpectedReflowDay / auction「盘前写死」,本模块就是承载处。

**挂载**(与 journal 完全同套路):
```js
const { createPreplanHandler } = require("./preplan");
const preplanHandler = createPreplanHandler({ sendJson });
// handleApi 404 之前加:
if (await preplanHandler(request, response, pathname)) return;
```

**四个接口:**
```bash
# 盘前(每晚复盘后)录一条预案;planDate=计划针对的交易日
curl -X POST .../api/preplan/add -d '{
  "planDate":"2026-07-03","code":"001309","name":"德明利","sector":"存储芯片","role":"龙头",
  "dualLogic":true,"logicA":"博竞价溢价","logicB":"存储板块回流",
  "isExpectedReflowDay":true,
  "yesterdayStrength":"strong","chengjie":"strong",
  "buyPlan":"竞价符合预期则开盘介入","firstPositionPct":20,
  "addOnPlan":"弱转强三条件齐加一层","board":"主板"
}'
curl .../api/preplan/today                         # 盘中查今日预案
curl -X POST .../api/preplan/judge -d '{"code":"001309","actualOpenPct":4.2}'
#   → 返回 判定(超/符合/不及/灰区) + 对应闸门动作,可直接作为 sell-engine 的 ctx.auction
curl .../api/preplan/review                        # 历史计划(与 archiver/journal 对账)
```

**内置纪律(代码强制,不可绕):**
- **09:15 锁定**:当天过点拒绝新增/修改——"双逻辑资格盘前挣,盘中不许补"
- 双逻辑必须写清 logicA + logicB,缺一条直接拒
- 无预案的票 judge 会返回"系统外操作,不该买"
- 当日超5只预案触发"乱枪打鸟"警告
- 历史计划永久锁定,保证回看数据真实

**竞价预期模型**(AUCTION_CFG,按实盘统计再调):
昨日强状态(带动性涨停+辨识度核心)→ 高开≥3%符合、>7%超预期、平/低开不及、0~3%灰区按不及处理;
弱一档(跟风/非带动)→ 基准下移至≥1.5%/>5%。承接档位(chengjie)再平移判定线:承接强=资金抢筹,正常预期本就更高→线上移+1%(高开4%才算符合身价);承接弱=没人接,平开是正常发挥→线下移-1%(2%即符合,低开1%以上才判不及)。

验证:`node test-preplan.js`(10 个 ✓)。

## 九、消息面 news-fetcher.js(东财 7×24 快讯 + 个股新闻)

端点移植自 [simonlin1212/a-stock-data](https://github.com/simonlin1212/a-stock-data)(Apache-2.0)的 SKILL 文档,用 Node 重写,零新增依赖。内置东财节流(串行、≥1s 间隔+随机抖动),失败安全返回 `[]` 不拖垮主流程。

**接入点(已接好):**
- `hotStocksPayload` 并发抓 40 条全球快讯 → `analyzeNewsRisk(thsRows, globalNews)`:外部风险的消息面判定从"热榜话题关键词"升级为真实新闻;快讯关键词做了抗噪——**同词出现在 ≥2 条不同标题才算命中**(关税/地缘类词几乎天天见报,单条=噪音)
- 入选票(selected)逐只挂 `newsFeed`(近期新闻前3条,东财节流串行约1秒/只,只做展示不参与打分);前端股票卡在炒作预期块下方渲染「消息面 · 近期新闻」
- payload 新增 `news.global`(前20条快讯,随归档一起沉淀进 data/history)
- 新路由 `GET /api/news` → 实时拉 50 条全球快讯

**公告 + 研报(炒作逻辑证据层):**
- `fetchAnnouncements(code)`:巨潮公告(orgId 动态映射表+硬编码兜底,独立0.5s节流队列不与东财排队)
- `fetchStockReports(code)`:东财研报(近180天,机构/评级/EPS预测,走东财1s节流)
- `enrichEvidence(profiled)`:**热度前80每只**挂 `evidence:{announcements,reports}`;`data/evidence-cache.json` 按日缓存——当日已抓的零开销,没抓的每轮最多现场抓 40 只(约1秒/只),两轮内全覆盖
- `buildSpeculation` 引用证据:炒作逻辑末尾自动追加「最新公告《…》」「近半年研报N篇,最新:机构「评级」」;**两样都没有则明确标"纯情绪/传闻驱动,逻辑证伪要快"**——这就是消息面准确性的落点:有据可查的炒作和讲故事的炒作分开
- 前端股票卡「消息面」块升级为 公告(橙)/研报(绿)/新闻(蓝) 三类标签合并展示;「外部环境与消息面」面板新增 7×24 快讯列表(前8条)

**已知特性:**
- 个股新闻接口对部分大陆住宅 IP 有间歇风控(只回股民资料无文章),代码安全返回空,隔几分钟自愈(上游 issue #18)
- 财联社快讯 2026-05 起 API 下线,全球快讯(np-weblist)就是它的免费替代(内容同源转发)

验证:`node test-news-fetcher.js`(9 组离线解析/抗噪测试 ✓)。

## 十、龙头筛选修复 leader-select.js(⚠️选股源头)

替换 server.js 的 roleContext / classifyRole / buildTotalLeader 及**全部** `changePct>=9.5` 与 `/板/.test` 判定。选股是全链源头,此处的错会污染下游一切。

**七项修复**(对照说明书第1节):
①`isLimitUp()` 真涨停:优先数据源涨停价(若有 `limitUpPrice` 字段),否则按板块规则从昨收(f18)推算(主板10%/20cm 20%/ST 5%/北交所30%)。**旧版9.5%线把20cm票+12%误记涨停——主做科技20cm票,此为核心失真**。⚠️集成时实测:东财 ulist 批量接口的 f51 **不是**涨停价(是金额类字段),故只喂 f18 走推算路径,勿喂 f51;
②`leaderPower()`:涨停=先决条件(无涨停-1000),连板高度×15主导,热度只做同档微调——旧版热度排名能压过真涨停、首板与6连板同分;
③`boardHeight()` 白名单 /(首板|N连板)/,炸板/地板=0——旧版 /板/ 给炸板票+20反向奖励;
④`pickZhongjun()`:市值锚必须当日不弱(红盘或跌<2%且成交≥35亿),修 floatMarketValue 缺失的 NaN 排序;可返回 null(全死鱼=无中军);
⑤`rankTier()` 排名分段(前10/30/60),黑盒榜单抖动不再主导;
⑥`buildTotalLeader()` 只在 selected 池内选,共识票被剔除则不认;全剔除返回 null(退潮期正常,server.js 侧包装为"暂无明确总龙头"展示对象);
⑦`attachScoreParts()`:scoreCandidate 的14个分项装进 stock.scoreParts 输出,archiver 落库后做单因子归因——不可归因的打分=不可优化的打分。

**已接入**(server.js):同名函数已替换;全文 `>= 9.5` 和 `/板/.test` 已逐处替换为 isLimitUp/boardHeight(含历史K线回测的涨停判定);行情组装已补喂 `prevClose`(f18)与 `limitUpPrice`(f51);scoreCandidate 已挂 attachScoreParts。四道闸结构、周期门槛(66/72/78/86/999)、setup 白名单、热度门槛保持不动——只修判定精度,不改架构。

**行为变化提示**:修复后候选会变少变严(假涨停/炸板票/死鱼中军被清出),部分方向可能"无龙头"——这是符合说明书"一定要有涨停板"的正确行为,不是bug。

验证:`node test-leader-select.js`(9 组 ✓)。

## 十一、盘中预警 watchdog.js(入库待部署)

sell-engine 是"有人问才答",盘中没人问闸门就是摆设——watchdog 是每分钟盯一轮、触发就吼的角色。纯逻辑模块,不抓数据不定时,由调用方喂输入。

**当前定位(用户拍板):不接盘中轮询、不加 setInterval**——自己盯盘;模块+测试入库,后续用途是"预案红线生成器"(录预案时把该票的硬止损/保本/回撤/五日线红线算好打印)。部署样板在文件底部注释(setInterval 60秒 + 钉钉推送插槽),回家跑服务时照抄。

核心接口:`runWatchCycle(state, inputs)` → 本轮新增预警(去重分级:red立即动手/orange准备动手/info提前提醒);`formatAlerts()` 输出带🚨的推送文本。

验证:`node test-watchdog.js`(9 组 ✓)。

## 十二、盘后消息面 news-digest.js(唯一消息面大脑)

**收敛原则(用户拍板)**:news-digest 是全仓库唯一的消息面大脑——过滤、聚合、组合提示、markdown 生成只在这里;news-fetcher.js 和 server.js 的抓取函数全部降级为数据供应商,只喂 `buildNewsSection` 入参,不许自己生成摘要。复盘报告里有且只有一节「消息面速览」。

**数据流(单条)**:
```
fetchExternalSnapshot(东财外围指数,已加 100.SOX 费半) ─┐
fetchGlobalNews(东财7×24,财联社替代)                  ├→ payload → archiver.assembleNewsInputs()
同花顺涨停池透传 limitStats.pool(reason_type)          │      → news-digest.buildNewsSection()
evidence.announcements(巨潮公告,预案票优先)           ─┘      → archive(payload, date, dirs, newsSection)
```
archiver CLI 已自动组装,`node archiver.js` 即出带消息面的复盘报告;报告插在"市场状态"之后。

**真实数据校验发现的三个格式坑(已修)**:
1. 同花顺涨停池**必须显式传 `field=` 参数**才返回 `reason_type`(涨停原因),默认响应没有该字段
2. 接口 **limit 上限 200**(传300报错连计数都拿不到),已按200透传(极端情绪日池子截断、计数不受影响)
3. 原因字段实测为半角 `+` 分隔("人形机器人+特斯拉+遮阳板龙头"),聚合正则已覆盖并补真实格式测试

五节内容:外围风向(纳指/费半±1.5%线)→ 组合提示(消息×情绪位置对照,如"高位分歧+科技利空=借利空杀筹码")→ 主线要闻(关键词族)→ 涨停原因聚合 → 预案票公告排雷(减持/问询/立案🔴置顶)。

验证:`node test-news-digest.js`(9 组 ✓,含真实 reason_type 格式用例);端到端实测 2026-07-03 真实报告:涨停原因聚合"人形机器人×23"居首、真实快讯命中、速览恰好一节。
