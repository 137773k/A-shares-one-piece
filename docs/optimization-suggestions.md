# A股短线模型优化建议

> 历史方案声明：本文记录 2026-07-11 的题材/主线修复，不再定义当前选股或交易权限。当前唯一正式权威为 `unifiedDecisionChain v3`，见 `docs/量化因子统一说明.md`。

基于本次修复（2026-07-11）的经验，提出以下优化建议：

## 已完成的修复

### 1. 题材聚类隔离（✅ 已修复）
- **问题**：军工信息化吞并AI算力体系所有子概念
- **方案**：添加互斥规则，跨体系概念禁止合并
- **效果**：存储芯片和军工信息化正确分离

### 2. 主线选择优化（✅ 已修复）
- **问题**：主线单纯取聚类第一名，被错误聚类误导
- **方案**：基于真实强度（sustained+连板高度+共振）选主线
- **效果**：主线正确识别为存储芯片（limitCount: 10）

### 3. 焦点概念统一（✅ 已修复）
- **问题**：多处各自定义focusConcept，定义不一致
- **方案**：全链路统一基于topicBoard.mainLine
- **效果**：选股、过滤、排名使用同一主线

## 需要进一步优化的问题

### 1. 配置化不足

**现状**：
- 互斥规则硬编码在`clusterHotConcepts`中
- 各种阈值（limitCount >= 3, >= 4等）散落在代码各处

**建议**：
```javascript
// config/clustering-rules.js
module.exports = {
  exclusiveGroups: [
    {
      name: "军工体系",
      concepts: ["军工信息化", "军工", "军民融合", "商业航天", ...],
    },
    {
      name: "AI算力体系",
      concepts: ["AI算力", "存储芯片", "CPO", "先进封装", ...],
    },
  ],
  thresholds: {
    sustained: { minCount: 4, minLimitCount: 2, minRoleCoverage: 3 },
    watchable: { minCount: 3, minLimitCount: 1, minRoleCoverage: 2 },
    mainLine: { strongLimitCount: 3, resonanceLimitCount: 2, pureLimitCount: 4 },
  },
};
```

**收益**：
- 调整阈值无需改代码，降低回归风险
- 添加新的互斥组更方便
- 便于A/B测试不同参数组合

### 2. 主线切换平滑性

**现状**：
- 主线判断完全基于当日数据
- 可能导致单日剧烈切换（今天军工，明天AI，后天人形机器人）

**问题**：
- 用户昨天按主线A建仓，今天系统突然切换到主线B
- 卖出建议和持仓不匹配

**建议方案A（惯性加权）**：
```javascript
// 读取历史3天主线
const history = readMainLineHistory(3); // [{date, name, limitCount}, ...]

// 给历史主线加权
const candidates = [
  ...items.map(item => ({
    ...item,
    finalScore: item.limitCount * 10 + (history[0]?.name === item.name ? 5 : 0) + (history[1]?.name === item.name ? 3 : 0)
  }))
];

// 基于finalScore选主线
const mainLine = candidates.sort((a, b) => b.finalScore - a.finalScore)[0];
```

**建议方案B（确认机制）**：
```javascript
// 主线变化需要连续2天确认
if (newMainLine.name !== history[0]?.name) {
  // 第一天：标记为"候选主线"
  // 第二天：如果仍然是第一名，正式切换
  if (history[0]?.candidateMainLine === newMainLine.name) {
    return newMainLine; // 确认切换
  } else {
    return { ...newMainLine, status: "候选", confirmedMainLine: history[0]?.name };
  }
}
```

**收益**：
- 减少主线频繁切换
- 给用户更稳定的交易预期

### 3. 候选池数量控制

**现状**：
- 混沌期候选池可能只有1只（如当前的深科技）
- 主升期候选池可能有20+只

**问题**：
- 1只太少，缺少备选
- 20只太多，选择困难

**建议**：
```javascript
// 分层候选池
const candidates = {
  core: selected.filter(s => s.role === "龙头" && s.setup !== "剔除").slice(0, 3),
  zhongjun: selected.filter(s => s.role === "中军").slice(0, 5),
  backup: selected.filter(s => s.role === "补涨" && /首板|二板|低位/.test(s.setup)).slice(0, 7),
};

// 混沌期：核心3 + 中军2 + 备选3 = 8只左右
// 主升期：核心3 + 中军5 + 备选5 = 13只左右
```

**收益**：
- 有主有备，数量适中
- 按角色分层，便于用户理解

### 4. bestPicks策略细化

**现状**：
- bestPicks基于selected再压缩
- 混沌期可能只推荐1只

**问题**：
- 1只推荐过于绝对，用户没有备选
- 没有明确区分"执行级"和"观察级"

**建议**：
```javascript
const bestPicks = {
  execute: pool.slice(0, 3), // 明日可执行：3只
  watch: pool.slice(3, 8),   // 关注观察：5只
  reason: "...",
  risk: "...",
};
```

**收益**：
- 给用户更多选择余地
- 区分执行和观察，降低决策压力

### 5. 测试覆盖

**现状**：
- 没有自动化测试
- 每次修改靠手工验证

**建议**：
```javascript
// test/clustering.test.js
test("军工和AI算力不应合并", () => {
  const concepts = [
    { name: "军工信息化", count: 10, limitCount: 5 },
    { name: "存储芯片", count: 15, limitCount: 8 },
  ];
  const result = clusterHotConcepts(concepts, mockRows);
  expect(result[0].name).not.toBe(result[1].name);
});

// test/mainline.test.js
test("连板高度优先于聚类排序", () => {
  const concepts = [
    { name: "A", score: 500, limitCount: 3 },
    { name: "B", score: 400, limitCount: 9 },
  ];
  const topicBoard = buildTopicBoard(concepts, ...);
  expect(topicBoard.mainLine.name).toBe("B");
});
```

**收益**：
- 防止回归
- 快速验证修改
- 文档化预期行为

### 6. 混沌期策略专项优化

**现状**：
- 混沌期只保留焦点方向核心
- 过滤逻辑单一（focusConceptMatch）

**问题**：
- 某些"板块内低位首板试错票"被过滤掉
- 没有区分"核心票"和"试错票"

**建议**：
```javascript
if (marketState.cycle === "混沌") {
  // 保留条件更细化
  const keepConditions = [
    focusConceptMatch && /龙头|中军/.test(role), // 焦点方向核心
    focusConceptMatch && /首板|二板/.test(setup) && score >= 150, // 焦点方向试错
    !focusConceptMatch && /龙头/.test(role) && limitCount >= 3, // 非焦点龙头（连板高）
  ];

  if (!keepConditions.some(Boolean)) {
    rejects.push("混沌期聚焦策略：非主线或非核心/试错");
  }
}
```

**收益**：
- 保留更多有价值的试错机会
- 混沌期策略更接近实际交易逻辑

### 7. 监控和告警

**现状**：
- 主线判断错误只能事后发现
- 没有异常告警机制

**建议**：
```javascript
// utils/health-check.js
function checkMainLineHealth(topicBoard, hotConcepts) {
  const warnings = [];

  // 警告1：主线limitCount过低
  if (topicBoard.mainLine.limitCount < 3) {
    warnings.push({
      level: "warning",
      message: `主线${topicBoard.mainLine.name}连板数只有${topicBoard.mainLine.limitCount}，持续性存疑`,
    });
  }

  // 警告2：主线和hotConcepts[0]差异过大
  if (hotConcepts[0].name !== topicBoard.mainLine.name && hotConcepts[0].limitCount > topicBoard.mainLine.limitCount + 3) {
    warnings.push({
      level: "warning",
      message: `主线${topicBoard.mainLine.name}可能不是真正的最强方向，${hotConcepts[0].name}连板数更高`,
    });
  }

  // 警告3：候选池为空
  if (selected.length === 0) {
    warnings.push({
      level: "error",
      message: "候选池为空，主线过滤可能过严或数据异常",
    });
  }

  return warnings;
}
```

**收益**：
- 及时发现异常
- 便于调试和优化

## 优先级建议

### P0（本次修复已完成）
- ✅ 题材聚类隔离
- ✅ 主线选择优化
- ✅ 焦点概念统一

### P1（下一步优化）
1. 配置化（互斥规则、阈值）
2. 测试覆盖（防回归）
3. 监控告警（及时发现异常）

### P2（中长期优化）
4. 主线切换平滑性
5. 候选池数量控制
6. bestPicks策略细化
7. 混沌期策略专项

## 代码质量改进

### 可读性
- 当前server.js有15万行，函数职责不够清晰
- 建议拆分：clustering.js, mainline.js, scoring.js, filtering.js

### 可测试性
- 纯函数优先（输入→输出，无副作用）
- 依赖注入（传入配置，而非读取全局变量）

### 可维护性
- 添加JSDoc注释（函数用途、参数、返回值）
- 关键决策点添加注释（为什么这样做）
- 统一命名规范（concept vs theme vs topic vs family）

---

最后更新：2026-07-11
