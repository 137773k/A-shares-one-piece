# 统一量化决策目录

本目录是项目量化选股的唯一新增入口。业务顺序固定为：

1. 市场阶段；
2. 交易许可、交易价值、交易仓位权限；
3. 赚钱效应；
4. 题材；
5. 股票模式；
6. 个股硬门槛；
7. 输出结果股票，最多 5 只，允许 0 只；
8. 对结果股票输出参与价值和仓位配比。

`decision-chain.js` 是唯一正式执行器。生产服务只能通过 `executeUnifiedDecisionChain` 一次性生成盘前门禁、严格决策链和同源 `bestPicks`；禁止消费者自行重算或用旧字段补票。执行器只接受现有模型提供的证据，严格逐层失败关闭；上一层未通过，下一层不得生成交易结论。

`stock-factor-engine.js` 是正式个股因子的唯一计算器，权威标识为 `unified_stock_factor_engine_v4`。它统一生成个股硬门槛、参与价值、分级分时领导力、执行可行性、风险调整和最终分；根目录旧 `score`、`selected`、`bestPicks`和静态仓位不再具有因子或授权权力。

`execution-feasibility.js` 只负责执行层收紧：核验价格完整性、价格发现、成交容量、量比拥挤、换手、触发条件和取消条件。它不预测真实滑点，不允许反向打开任何上游权限。

`execution-replay.js` 是旧版验证专用的分钟成交回放器。缺机器触发规则或T+1分钟条时必须返回 `unavailable`；日线不能冒充可成交价。既有AKShare新浪不复权5分钟缓存只保留 `legacy_entry_validation_only` 身份。V7通过 `minute-evidence.js` 选择唯一权威1分钟源：JQData完整原始1分钟为Tier1，AKShare完整原始1分钟为Tier2，腾讯价格序列只能观察；同一证券同一交易日禁止跨源拼接。封单衰减必须使用独立Tick买一快照，缺失时返回不可评估，不允许由一分钟成交量代理。`factor-effectiveness-validation.js` 把当晚冻结凭证研究与当前引擎反事实回放分开，另负责Top1/Top3消融、相关性排查和70/30样本外阈值校准，所有输出均无执行权。

AKShare Python入口经过 `run-python-tool.js`；其中旧 `fetch_akshare_minute_outcomes.py` 继续固定为5分钟旧版入场验证，新的 `fetch_akshare_1m_outcomes.py` 才是Tier2免费新浪原始1分钟归档。Tier2只接受精确 `CODE@DATE` 或验证报告需求对，要求指定日期确实位于新浪滚动免费窗口并具备完整240根、OHLCV与成交额以及正日成交；窗口外、当前未收盘、提供方错误或任一质量失败都返回不可用，不取邻近日期、不跨源拼接。2026-08真实抽样中新浪完整交易日固定只返回238根并缺少14:58、14:59，因此当前会被严格标为审计性不可用，不补造分钟，也不冒充可用Tier2。JQData使用隔离入口 `run-jqdata-tool.js` 和 `data/.venv-jqdata`，依赖清单见 `requirements-jqdata.txt`。两者的凭证和运行缓存均不得进入Git；所有分钟抓取缓存只能写入已忽略的 `data/`，且始终不授予交易执行权。

`outcome-evidence.js` 是日线、分钟结果日期和价格完整性解析的唯一入口，生产侧车与因子有效性验证共用这一口径。

`v7-sell-decision.js` 是生产卖出决策入口：只读取固定的 JQData/AKShare 分钟缓存，通过 `outcome-evidence.js` 重建统一分钟证据，再调用V7上下层状态机。服务端入口为 `POST /api/sell-advisor/v7-evaluate`。持仓、日线与上层必须分别提供同证券、同交易日、同代次且哈希绑定的规范上下文；调用方不能塞入已经“选好”的分钟证据或手工Tick。当前没有可信Tick侧车时，FULL层保持不可用，CORE单独报告。旧 `evaluateSellSignals` 和 `runLegacyWatchCycle` 仅保留历史对照身份；权威 `watchdog.runWatchCycle` 明确关闭盘中动作，因为V7定位是盘后完整一分钟回放。

`decision-receipt.js` 只为显式收盘、同代统一链和统一因子生成 `live_canonical` 凭证，冻结正式结果、观察对象、仓位、机器触发规则和三层SHA-256。盘中、跨代、缺规则、非法仓位或旧字段兜底一律输出 `unavailable`。0只结果仍是完整现金决策凭证。

`decision-outcome.js` 按 `receiptId + decisionHash + 精确T+1` 结算现金、未触发、触发和数据不完整状态；`decision-ledger.js` 负责独立侧车的原子写入、修订留档和批量刷新。T+1结果禁止写回T日历史快照。`decision-receipt-audit.js` 只审计旧档，不补造当晚凭证。

`index.js` 是其他模块的统一读取入口，同时导出五态市场周期契约、量化因子登记表、统一投影、决策凭证和T+1账本。根目录的 `unified-quant-factors.js` 暂时保留为兼容入口，新增因子和新的决策规则不得再散落到其他目录。

关键约束：

- 大周期只允许混沌、主升、震荡、退潮、冰点五态；
- 修复、反弹、分歧、加强、加速只能进入过渡节点或小周期，不得改写大周期；
- 大周期、小周期保持两套算法，但必须共同进入市场阶段节点；
- 小周期只认结构化枚举键，不从标签或原因说明中匹配“主升、加强、修复”等关键词；
- 情绪阶段、分歧强度、分歧质量和承接状态分别输出，强度采用小分歧/中等分歧/大分歧三级；
- T-1 情绪只认精确上一交易日的同版本收盘 canonical 状态或相同引擎的确定性权威回放，缺失或未知时失败关闭；
- 个股排序必须使用同一 `generationId/tradingDate/asOf` 的 `marketPhaseDetail.decisionContext`，并在当代重算因子上下文；
- 正式候选必须携带 `factorDecision.authority=unified_stock_factor_engine_v4`，缺失或混入旧评分时失败关闭；
- `inspectAuthoritativeDecisionChain` 是所有消费者的共享准入检查，必须同时校验 v3 版本、权威、代次、严格顺序、结果股和仓位合计；
- 市场交易价值不读取个股评分；
- 参与价值不能反向打开交易许可；
- 旧 `selected` 不具备股票模式授权；
- 旧 `bestPicks`/情景候选不得反向改写情绪阶段或风格载体；leave-one-out 只接受显式 `selectedCandidateCode/excludedCandidateCodes`；
- 结果不足 5 只时不补票；
- 权限关闭、短线核心赚钱效应没有具名载体、题材与模式无交集或个股硬门槛失败时，结果为 0 只、仓位为 0%；
- 市值载体在有效性验证完成前仍为观察因子，不能单独开放交易权限。
- 量比低于 1.2 只在流动性参与价值中降分，不单项硬拒；1.2–3.0 是当前正常放量分区，过大量比也降分。
- 领导力总权重由大周期决定，领导力内部的主动性/周期身份/方向带动比例由小周期决定；分时未验证时质量分上限60。
- 分时领导力优先读取东财分钟线，失败后使用腾讯同交易日分钟线；两者使用独立于日K的熔断状态。真实分时证据按交易日和代码缓存，日期错配拒绝使用；东财完整OHLC、腾讯价格序列、盘中部分数据和收盘代理必须分级，盘中部分数据不能取得收盘交易资格。
- 正式授权关闭时可以输出 `observationCandidates`（最多5只），但每只必须是 `observationOnly=true/executable=false/executionAuthority=false`，且不得携带仓位或买点。
- 正式收盘归档必须带可复核的 `live_canonical decisionReceipt`；同日纠错必须写明supersedes谱系，旧字节进入修订目录。
- 真实历史效果只读取冻结凭证与绑定侧车；当前引擎重算旧档必须标记 `counterfactual_current_engine_replay/asDecided=false`。
- 现有无凭证旧档永久保持 `legacy_without_receipt`，禁止补造正式结果。

对外消费约束：

- `bestPicks.picks`、`tomorrowDecision.candidates`、个人逻辑选股、盘后明日机会和盘前预案的新开仓名单，都只能是 `unifiedDecisionChain.result.selectedCodes` 的同源投影；
- 交易授权关闭时，上述入口必须保留空集合和 0% 仓位；
- 持仓卖出是例外的风险管理入口：既有持仓无需出现在当日新开仓名单中，但市场阶段、组合仓位权限和主线上下文必须读取权威链，且只能收紧风险。
- `/api/personal-logic-picker/current` 只是观察投影，必须显式返回 `observationOnly=true`、`executionAuthority=false` 和权威链摘要；任何独立消费者都不得用该接口生成买入授权。

仓位权威：

- 正式结果股和正式计划只能读取 `unifiedDecisionChain.result.stocks[].positionAllocation`；其中 `initialPortfolioPct` 是初始组合仓位，`maximumPortfolioPct` 是单票在当前组合授权下的上限；
- 旧 `position`、`stopLossPlan.position`、`advice.position` 与计划卡中的文字仓位只能作为明确标识的历史观察，禁止装饰回 `bestPicks`、盘前直买或盘后严格计划；
- 股票代码即使属于统一链，旧仓位与 canonical allocation 冲突时也不得取旧值，正式消费者必须失败关闭或覆盖为同代码的 canonical allocation。

发布一致性：

- 主项目是量化决策唯一源，`npm run sync:mobile` 只将统一决策核心、前端正式投影和对应契约测试同步到手机端；手机端 `server.js`、`mobile-*`、`sw.js` 与部署脚本保留独立鉴权、状态和容错接线，不得被桌面同名文件整包覆盖；
- 静态版只能由 `npm run build` 生成，不手工编辑 `dist`；
- 发布前运行 `npm run test:release-parity`，校验主项目、`dist` 和手机端的前端投影与量化核心哈希一致，并检查手机服务同时接入统一执行器和移动鉴权。
