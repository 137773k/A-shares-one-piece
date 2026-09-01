# 选股逻辑校准笔记 2026-06-19

审查范围：`trading-rules.js`、`trading-rules.test.js`、`server.js`（`fetchKlineProfile`、`parseKlineRows`、`classifyMarket`、`scoreCandidate`、clist 字段映射约 920-930 行）

---

## 1. K线行顺序假设

**VERDICT: NOT A BUG**

`parseKlineRows`（server.js:1124）直接 `.map()` 东财 `/kline/get` 接口返回的 `klines` 字符串数组，
东财该接口参数 `end=20500101&lmt=120` 默认按日期升序（旧→新）返回，与 `computeMaProfile` 的假设完全一致。

`computeMaProfile` 通过 `maAt(n, offset)` 用 `closes.length - offset` 从末尾（最新）往前切片，
`longBearBreak3d` 同样遍历 `rows.length - 3` 到末尾（最新3根）。

若顺序相反，`ma5 > ma10 > ma20` 在上涨序列中会成立相反方向——现有测试 `computeMaProfile: 上涨结构给出多头排列且5日线向上` 已覆盖并通过，证实顺序正确。

---

## 2. avgAmount5 口径分歧

**VERDICT: ACCEPTABLE DIVERGENCE**

- `fetchKlineProfile`（server.js:1170）：`avgAmount5 = rows.slice(-6,-1)` —— 过去5个完整交易日均额（不含当日），用于计算 `volumeBreakout`（与当日放量对比）。
- `computeMaProfile`（trading-rules.js:26）：`avgAmount5Yi = avg(amounts.slice(-5)) / 1e8` —— 最近5日含今日，是 `hardGate` 所读的入池门槛指标。

两者语义不同：前者是基准参照（不含今日以便对比），后者是入池门槛（含今日的近期成交活跃度）。
`hardGate` 只依赖 `klineProfile.avgAmount5Yi`（来自 `computeMaProfile`），口径内部一致。
无需统一，但若需要完全一致可在未来统一，当前行为可接受。

---

## 3. NaN 在 hardGate 中（量比/主力净流入）

**VERDICT: REAL BUG — FIXED**
**Commit: `36447af`**

### 问题路径

`fetchEastmoneyQuotes`（server.js:927）：
```js
volumeRatio: Number(item.f10),   // 若 f10 缺失 → Number(undefined) === NaN
```
`moneyYi`（server.js:698-700）使用 `Number(value || 0)` 所以 `mainInflowYi` 安全（返回 0）。
但 `volumeRatio` 裸用 `Number(item.f10)`，字段缺失时为 `NaN`。

### hardGate 误判路径

```js
if (stock.volumeRatio == null || stock.volumeRatio === 0) {
    // NaN == null → false，NaN === 0 → false → 跳过软标分支
} else if (!(stock.volumeRatio > 1.5)) {
    // !(NaN > 1.5) → !(false) → true → 推入 hardFails ← BUG
    hardFails.push(`量比${stock.volumeRatio}不足1.5`);
}
```

### mainInflowYi 的补充防御

`moneyYi` 函数已将 undefined→0，实际不会产生 NaN。
但若调用者直接赋 NaN（未来代码路径或测试），同样 bug。
一并修复保持语义一致。

### 修复

将 `== null || === 0` 换为 `Number.isFinite()` 检测有效性：
```js
// trading-rules.js:66-75 (after fix)
if (!Number.isFinite(stock.volumeRatio) || stock.volumeRatio === 0) {
    softFlags.push("量比数据待确认");
} else if (!(stock.volumeRatio > 1.5)) {
    hardFails.push(`量比${stock.volumeRatio}不足1.5`);
}
if (!Number.isFinite(stock.mainInflowYi) || stock.mainInflowYi === 0) {
    softFlags.push("主力净流入待确认");
} else if (stock.mainInflowYi < 0) {
    hardFails.push(`主力净流出${stock.mainInflowYi}亿`);
}
```

新增测试 2 条（均先 RED 后 GREEN）：
- `hardGate: volumeRatio为NaN时应软标而非硬拒`
- `hardGate: mainInflowYi为NaN时应软标而非硬拒`

最终：18/18 通过。

---

## 4. 退潮空池前端渲染

**VERDICT: NOT A BUG**

`selectedLimit = 0` 时 `candidates.filter(...).slice(0, 0)` 返回空数组 `[]`。

`script.js:81`：`const all = payload.selected || [];`
`script.js:90-92`：
```js
selectedStocks.innerHTML = keep.length
  ? keep.map((stock) => stockCard(stock)).join("")
  : `<div class="empty-state">有预期的核心票都被透支/兑现做减法剔除了，...</div>`;
```

空数组时优雅显示 empty-state 文案，不会 crash。
`deriveAnchorSymbols`（server.js:3396）也处理了 `cache.selected.length` 为 0 的情形。

---

## 5. subPhase 字符串拼接

**VERDICT: NOT A BUG**

`script.js:571`：
```js
state.subPhase && state.subPhase !== state.cycle
  ? `${state.cycle}·${state.subPhase}`
  : state.cycle;
```
非主升时 `classifySubPhase` 返回 `subPhase === cycle`（如修复→修复），
`state.subPhase !== state.cycle` 为 false，不拼接，不会出现"修复·修复"。

`subPhaseReasons` 在 `classifyMarket` 中通过解构赋值获得：
```js
const { subPhase, reasons: subPhaseReasons } = classifySubPhase(cycle, limitStats);
```
`classifySubPhase` 在所有分支均返回 `{ subPhase, reasons: [] }` 或带数组，
`subPhaseReasons` 永远是数组，不会是 undefined。

---

## 6. classifyMarket heatConfirmed null-limitStats

**VERDICT: NOT A BUG**

`server.js:1548-1550`：
```js
const heatConfirmed = limitStats
  ? limitStats.ztToday >= 60 && limitStats.ztPrev >= 45 && limitStats.ztToday >= limitStats.ztPrev * 0.8
  : breadth > 0.6;
```

`limitStats` 为 null 时走 `breadth > 0.6` 退路，不访问 null 字段，不会 throw。

---

## 总结

| # | 检查项 | 结论 |
|---|--------|------|
| 1 | K线行顺序 | 正确（旧→新），非 bug |
| 2 | avgAmount5 口径分歧 | 语义不同，可接受 |
| 3 | hardGate NaN防御 | **实际 bug，已修复**（commit 36447af）|
| 4 | 退潮空池前端 | 优雅处理，非 bug |
| 5 | subPhase 拼接 | 有守卫，非 bug |
| 6 | heatConfirmed null | 有退路，非 bug |

最终测试结果：**18/18 pass**
