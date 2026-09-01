# 主线选择优先级修复补充说明

## 问题复现

修复聚类隔离后：
- hotConcepts[0]: 存储芯片 (limitCount: 9, resonance: null)
- hotConcepts[1]: 军工信息化 (limitCount: 6, resonance: true)

但buildTopicBoard的主线选择逻辑仍然选择了军工信息化，原因是：
- 原优先级：sustained > 共振+连板 > 纯连板高度
- 军工（6板+共振）满足 resonanceCandidates 条件
- 存储（9板无共振）只满足 limitCandidates 条件
- resonanceCandidates 优先级高于 limitCandidates

## 问题分析

这个优先级设置的本意是：
- 共振（板块指数同步上涨）代表资金共识强
- 有共振的6板可能比无共振的9板更有持续性

但实际情况是：
- 连板高度差距过大时（9 vs 6），应该优先看高度
- 存储芯片9板即使无板块共振，也说明个股强度极高
- 军工6板即使有共振，也不应压过9板的方向

## 解决方案

调整主线选择优先级：

```
旧优先级：
sustained > 共振+连板 > 纯连板高度

新优先级：
高连板(≥7) > sustained > 中连板(≥4) > 共振+连板
```

### 逻辑说明

1. **高连板(≥7板)**：绝对强势，无论是否共振都应优先选择
   - 存储芯片9板属于此类

2. **sustained（共振+梯队完整）**：板块结构完整，持续性强
   - 需要同时满足：共振 + count≥4 + limitCount≥2 + 龙头中军补涨齐全

3. **中连板(≥4板)**：有一定强度，按连板高度排序
   - 包含4-6板的方向

4. **共振+连板(≥2板)**：有共振但连板不高
   - 军工6板+共振会被存储9板压过

5. **兜底**：preferredItems[0] || items[0]

## 验证标准

修复后应该：
- 主线选择：存储芯片（limitCount: 9）✅
- 不应选择：军工信息化（limitCount: 6, resonance: true）
- 候选池：应有存储芯片相关票
- bestPicks：深科技等存储芯片核心票

## 配置建议

以下阈值可以根据实盘数据调整：

```javascript
const MAINLINE_THRESHOLDS = {
  veryHigh: 7,    // 高连板阈值
  medium: 4,      // 中连板阈值
  resonance: 2,   // 共振最低连板要求
};
```

当市场整体板数较低时（如冰点期），可以下调这些阈值。

## 相关文件

- [fix-mainline-issue-2026-07-11.md](fix-mainline-issue-2026-07-11.md) - 初次修复记录
- 本文档 - 优先级修复补充

---

更新时间：2026-07-11
