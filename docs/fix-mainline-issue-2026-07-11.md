# A股短线模型主线跑偏问题修复记录

## 问题描述

修复前系统表现：
- 页面显示"主升中的高位分歧"（实际应为"混沌"）
- 主线判定为"军工信息化"（实际应为"AI算力/存储芯片"）
- bestPicks显示"海兰信"（军工票，实际应为AI算力核心票）
- 候选池混入大量非主线票

## 根本原因

1. **题材聚类口径过宽**：`clusterHotConcepts()`的合并逻辑把"军工信息化"和"AI算力/存储芯片/CPO/先进封装"等合并成一个簇，导致军工票数+AI票数，总分最高
2. **主线选择逻辑单一**：`buildTopicBoard()`直接取`hotConcepts[0]`作为主线候选，被错误聚类结果带偏
3. **焦点概念传递混乱**：多处代码各自定义`focusConcept`，都基于`hotConcepts[0]`，形成连锁错误

## 修复方案

### 1. 修复题材聚类（clusterHotConcepts）

**位置**：server.js 第45000行附近

**修改内容**：
- 在`canMerge`函数前添加互斥规则
- 定义两个互斥组：
  - 军工组：军工信息化、军工、军民融合、商业航天、国防军工、航母、国产航母、卫星导航、海工装备
  - AI算力组：AI算力、存储芯片、CPO、先进封装、算力租赁、共封装光学(CPO)、光模块、光纤概念、服务器、液冷服务器、中国AI 50、东数西算(算力)、国家大基金持股、高端装备
- 跨组概念禁止合并

**效果**：
- 存储芯片：limitCount 9，成为独立簇
- 军工信息化：limitCount 6，成为独立簇
- 两者不再互相吞并

### 2. 修复主线选择（buildTopicBoard）

**位置**：server.js 第39618-39624行

**修改前**：
```javascript
const mainLine = preferredItems[0] || items[0] || null;
```

**修改后**：
```javascript
// 主线选择：优先考虑真实强度（sustained+连板高度+共振），而不是简单取聚类第一名
const strongCandidates = items.filter(item => item.sustained && item.limitCount >= 3);
const resonanceCandidates = items.filter(item => item.resonance && item.limitCount >= 2);
const limitCandidates = items.filter(item => item.limitCount >= 4);

let mainLine = null;
// 优先级：sustained+高连板 > 共振+连板 > 纯连板高度 > preferredItems[0] > items[0]
if (strongCandidates.length) {
  mainLine = strongCandidates.sort((a, b) => b.limitCount - a.limitCount || b.score - a.score)[0];
} else if (resonanceCandidates.length) {
  mainLine = resonanceCandidates.sort((a, b) => b.limitCount - a.limitCount || b.score - a.score)[0];
} else if (limitCandidates.length) {
  mainLine = limitCandidates.sort((a, b) => b.limitCount - a.limitCount || b.score - a.score)[0];
} else {
  mainLine = preferredItems[0] || items[0] || null;
}
```

**效果**：
- 主线选择不再被聚类排序误导
- 优先选择真正有连板高度+共振的方向
- 存储芯片（limitCount 9）成为主线

### 3. 禁用硬覆盖主线

**位置**：server.js 第70426行

**修改前**：
```javascript
if (["混沌", "修复", "冰点", "震荡"].includes(marketState.cycle) && topicBoard && Array.isArray(topicBoard.items) && topicBoard.items.length) {
  topicBoard.mainLine = topicBoard.items[0];
}
```

**修改后**：
```javascript
if (["混沌", "修复", "冰点", "震荡"].includes(marketState.cycle) && topicBoard && Array.isArray(topicBoard.items) && topicBoard.items.length) {
  // topicBoard.mainLine = topicBoard.items[0]; // 已禁用：混沌期应基于真实主线强度选择，不应硬覆盖为第一名
}
```

**效果**：
- 不再在混沌期强制覆盖buildTopicBoard已经正确选出的主线

### 4. 修复焦点概念传递

**位置1**：server.js 第70383行（hotStocksPayload中）
**位置2**：server.js 第56337行（scoreCandidate中）

**修改前**：
```javascript
const focusHotConcept = Array.isArray(hotConcepts) ? hotConcepts[0] : null;
const focusConcept = Array.isArray(hotConcepts) ? hotConcepts[0] : null;
```

**修改后**：
```javascript
const focusHotConcept = topicBoard && topicBoard.mainLine ? topicBoard.mainLine : (Array.isArray(hotConcepts) ? hotConcepts[0] : null);
const focusConcept = topicBoard && topicBoard.mainLine ? topicBoard.mainLine : (Array.isArray(hotConcepts) ? hotConcepts[0] : null);
```

**效果**：
- 焦点概念统一基于buildTopicBoard选出的主线
- 选股、过滤、排名全链路使用同一个主线判断

### 5. 修复scoreCandidate参数

**位置**：server.js 第56208行（函数签名）、70419行（调用点）

**修改**：
- 函数签名添加`topicBoard`参数
- 调用处传入`topicBoard`

**效果**：
- scoreCandidate可以访问正确的主线
- 混沌期焦点过滤基于正确主线

## 验收标准

✅ `marketState.cycle` 应为"混沌"
✅ `topicBoard.mainLine` 应为"存储芯片/AI算力"相关，不应为"军工信息化"
✅ `hotConcepts[0]` 应为"存储芯片"，`hotConcepts[1]` 应为"军工信息化"（分离）
✅ `selected` 候选池应有存储芯片核心票（如深科技、华天科技）
✅ `bestPicks` 不应为海兰信，应为AI算力/存储芯片核心票
✅ 页面显示"混沌期+AI算力/存储芯片主线"，不应再显示"主升高位分歧"

## 影响范围

- `clusterHotConcepts()`：题材聚类函数
- `buildTopicBoard()`：主线判断函数
- `scoreCandidate()`：个股打分函数
- `hotStocksPayload()`：主流程函数

## 回滚方案

如需回滚，恢复备份文件：
```bash
cp server.js.backup server.js
```

## 后续优化建议

1. 将互斥规则配置化，放到单独的配置文件
2. 主线选择逻辑可以增加更多维度（如成交额、持续天数）
3. 考虑添加主线切换的平滑过渡机制，避免单日剧烈切换
4. 建立主线判断的单元测试，防止回归

## 测试验证

运行验证脚本：
```bash
node verify-fix.js
```

预期输出：
- 周期判断：混沌 ✓
- 主线判断：存储芯片 ✓
- hotConcepts分离：军工和AI算力分开 ✓
- 候选池：有存储芯片核心票 ✓
- 明日最优解：AI算力相关票 ✓

## 修复日期

2026-07-11

## 修复人员

Claude (Kiro AI Assistant)
