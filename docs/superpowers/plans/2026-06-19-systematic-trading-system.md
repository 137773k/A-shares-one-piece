# 系统化选股交易体系（优化版）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把三张方法论图（哲学/周期/硬筛选）织进现有 A 股短线模型，新增"硬筛选闸门 + 周期子标签 + 交易模式止盈止损"，形成做减法的完整选股交易体系。

**Architecture:** 所有新逻辑集中到一个独立纯函数模块 `trading-rules.js`（可单测），`server.js` 只在管线里调用并把结果挂到 stock/marketState 上，`script.js` 读取渲染。不动已验证的抓取/打分主路径，符合"优化不替代"。

**Tech Stack:** Node.js v18+（CommonJS，`require`/`module.exports`），内置 `node:test` + `node:assert`（无需新依赖），原生前端 JS。

## Global Constraints

- **第一原则：选股做减法**。候选池=热度前50，硬闸门越严越好，宁可留少；弱周期空仓是正确结果，不是故障。
- **优化不替代**：不重写抓取主路径、不改周期不可逆环（`server.js:138`）、不替换 `scoreCandidate`/`classifyMarket`，只扩展。
- **模块系统**：`trading-rules.js` 用 CommonJS（`module.exports = {...}`），与 `server.js` 一致。
- **不引入新依赖**：测试用内置 `node --test`。
- **数据现状**：`stock.volumeRatio`(f10)、`stock.mainInflowYi`(f62)、`stock.amountYi`(f6) 已在 clist 抓取（`server.js:924-929`）；MA5/10/20 需新算（从已取 K 线行，无新 API）。
- **主力净流入降级**：`mainInflowYi` 缺失或为 0 → 软标"待确认"不剔除；< 0（净流出）→ 硬剔除。量比同理：缺失→软标，存在且 ≤1.5→硬剔除。
- 改完每个涉及 server.js/script.js 的任务跑 `node --check`。

## 前置（可选）：初始化 git

本目录当前不是 git 仓库。若要版本化（推荐），先：

```bash
cd "/path/to/a-share-trading-model"
git init
printf "node_modules/\n.cache/\n*.log\n.*.err\n.*.out\n" >> .gitignore
git add -A && git commit -m "chore: snapshot before trading-system optimization"
```

若不用 git，跳过每个任务的 commit 步骤即可，其余步骤不变。

---

### Task 1: MA 画像纯函数 `computeMaProfile`

**Files:**
- Create: `trading-rules.js`
- Test: `trading-rules.test.js`

**Interfaces:**
- Produces: `computeMaProfile(rows) -> { ma5, ma10, ma20, ma5Rising, longBearBreak3d, avgAmount5Yi, lastClose } | null`
  - `rows`: K 线行数组（**旧→新**），每行 `{ open, close, high, low, amount, changePct, turnover }`（即 `parseKlineRows` 输出，`server.js:1123`）。
  - 行数 < 22 返回 `null`。

- [ ] **Step 1: Write the failing test**

创建 `trading-rules.test.js`：

```js
const test = require("node:test");
const assert = require("node:assert");
const { computeMaProfile } = require("./trading-rules");

// 构造 25 根递增收盘价的 K 线（多头排列、5日线向上）
function risingRows(n = 25) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const close = 10 + i * 0.5; // 持续上涨
    rows.push({ open: close - 0.2, close, high: close + 0.1, low: close - 0.3, amount: 6e8, changePct: 2, turnover: 5 });
  }
  return rows;
}

test("computeMaProfile: 上涨结构给出多头排列且5日线向上", () => {
  const p = computeMaProfile(risingRows());
  assert.ok(p, "应返回画像");
  assert.ok(p.ma5 > p.ma10 && p.ma10 > p.ma20, "应多头排列");
  assert.strictEqual(p.ma5Rising, true);
  assert.strictEqual(p.longBearBreak3d, false);
  assert.ok(p.avgAmount5Yi > 5, "5日均额应>5亿");
  assert.strictEqual(p.lastClose, 10 + 24 * 0.5);
});

test("computeMaProfile: 数据不足返回 null", () => {
  assert.strictEqual(computeMaProfile([{ close: 1, open: 1, amount: 1 }]), null);
});

test("computeMaProfile: 最近3日放量长阴破位被识别", () => {
  const rows = risingRows();
  const last = rows[rows.length - 1];
  // 把最后一根改成放量长阴、跌破MA10
  last.open = 22;
  last.close = 20; // 跌幅约 -9%
  last.amount = 6e8 * 3; // 放量
  const p = computeMaProfile(rows);
  assert.strictEqual(p.longBearBreak3d, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test trading-rules.test.js`
Expected: FAIL — `Cannot find module './trading-rules'`。

- [ ] **Step 3: Write minimal implementation**

创建 `trading-rules.js`：

```js
"use strict";

function avg(nums) {
  if (!nums.length) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}
function round2(x) { return Math.round(x * 100) / 100; }

function computeMaProfile(rows) {
  if (!Array.isArray(rows) || rows.length < 22) return null;
  const closes = rows.map((r) => Number(r.close));
  const amounts = rows.map((r) => Number(r.amount) || 0);
  const maAt = (n, offset) => {
    const end = closes.length - offset;
    const start = end - n;
    if (start < 0) return null;
    return avg(closes.slice(start, end));
  };
  const ma5 = maAt(5, 0);
  const ma10 = maAt(10, 0);
  const ma20 = maAt(20, 0);
  const ma5p1 = maAt(5, 1);
  const ma5p2 = maAt(5, 2);
  const ma5Rising = ma5 != null && ma5p1 != null && ma5p2 != null && ma5 > ma5p1 && ma5p1 > ma5p2;
  const avgAmount5Yi = avg(amounts.slice(-5)) / 1e8;

  let longBearBreak3d = false;
  const startIdx = rows.length - 3;
  for (let idx = Math.max(0, startIdx); idx < rows.length; idx++) {
    const r = rows[idx];
    const body = r.open ? ((Number(r.open) - Number(r.close)) / Number(r.open)) * 100 : 0; // 正=阴线
    const prev5Amount = avg(amounts.slice(Math.max(0, idx - 5), idx));
    const volUp = prev5Amount ? amounts[idx] >= prev5Amount * 1.45 : false;
    const ma10AtIdx = idx >= 9 ? avg(closes.slice(idx - 9, idx + 1)) : null;
    const brokeMa10 = ma10AtIdx != null ? Number(r.close) < ma10AtIdx : false;
    if (body >= 4 && volUp && brokeMa10) longBearBreak3d = true;
  }

  return {
    ma5: round2(ma5),
    ma10: round2(ma10),
    ma20: round2(ma20),
    ma5Rising,
    longBearBreak3d,
    avgAmount5Yi: round2(avgAmount5Yi),
    lastClose: closes[closes.length - 1],
  };
}

module.exports = { computeMaProfile, avg, round2 };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test trading-rules.test.js`
Expected: PASS（3 tests）。

- [ ] **Step 5: Commit**

```bash
git add trading-rules.js trading-rules.test.js
git commit -m "feat(trading-rules): add computeMaProfile with MA/slope/long-bear detection"
```

---

### Task 2: 硬筛选闸门 `hardGate`

**Files:**
- Modify: `trading-rules.js`
- Test: `trading-rules.test.js`

**Interfaces:**
- Consumes: `stock.klineProfile`（含 Task 1 的 `ma5/ma10/ma20/ma5Rising/longBearBreak3d/avgAmount5Yi/lastClose`）、`stock.volumeRatio`、`stock.mainInflowYi`。
- Produces: `hardGate(stock) -> { pass: boolean, hardFails: string[], softFlags: string[], metrics: object }`

- [ ] **Step 1: Write the failing test**

在 `trading-rules.test.js` 末尾追加：

```js
const { hardGate } = require("./trading-rules");

const goodKp = { ma5: 12, ma10: 11, ma20: 10, ma5Rising: true, longBearBreak3d: false, avgAmount5Yi: 8, lastClose: 12.5 };

test("hardGate: 全满足则通过", () => {
  const g = hardGate({ klineProfile: goodKp, volumeRatio: 2, mainInflowYi: 1.2 });
  assert.strictEqual(g.pass, true);
  assert.strictEqual(g.hardFails.length, 0);
});

test("hardGate: 均线非多头排列硬剔除", () => {
  const g = hardGate({ klineProfile: { ...goodKp, ma10: 13 }, volumeRatio: 2, mainInflowYi: 1 });
  assert.strictEqual(g.pass, false);
  assert.ok(g.hardFails.some((f) => f.includes("多头排列")));
});

test("hardGate: 量比缺失降级为软标不剔除", () => {
  const g = hardGate({ klineProfile: goodKp, volumeRatio: 0, mainInflowYi: 1 });
  assert.strictEqual(g.pass, true);
  assert.ok(g.softFlags.some((f) => f.includes("量比")));
});

test("hardGate: 主力净流出硬剔除，但缺失只软标", () => {
  const out = hardGate({ klineProfile: goodKp, volumeRatio: 2, mainInflowYi: -0.5 });
  assert.strictEqual(out.pass, false);
  const miss = hardGate({ klineProfile: goodKp, volumeRatio: 2, mainInflowYi: 0 });
  assert.strictEqual(miss.pass, true);
  assert.ok(miss.softFlags.some((f) => f.includes("主力净流入")));
});

test("hardGate: 缺K线直接不过", () => {
  const g = hardGate({ volumeRatio: 2, mainInflowYi: 1 });
  assert.strictEqual(g.pass, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test trading-rules.test.js`
Expected: FAIL — `hardGate is not a function`。

- [ ] **Step 3: Write minimal implementation**

在 `trading-rules.js` 的 `module.exports` 之前加入：

```js
function hardGate(stock) {
  const hardFails = [];
  const softFlags = [];
  const kp = stock && stock.klineProfile;
  if (!kp || kp.ma5 == null || kp.ma10 == null || kp.ma20 == null) {
    return { pass: false, hardFails: ["缺K线无法验证趋势结构"], softFlags: [], metrics: {} };
  }
  // 趋势结构（硬）
  if (!(kp.lastClose > kp.ma5)) hardFails.push("收盘价未站上5日线");
  if (!(kp.ma5 > kp.ma10 && kp.ma10 > kp.ma20)) hardFails.push("均线非多头排列(5>10>20)");
  if (!kp.ma5Rising) hardFails.push("5日线未持续向上");
  if (kp.longBearBreak3d) hardFails.push("近3日存在放量长阴破位");
  // 资金活跃度
  if (!(kp.avgAmount5Yi > 5)) hardFails.push(`5日均成交额${kp.avgAmount5Yi}亿不足5亿`);
  // 量比
  if (stock.volumeRatio == null || stock.volumeRatio === 0) {
    softFlags.push("量比数据待确认");
  } else if (!(stock.volumeRatio > 1.5)) {
    hardFails.push(`量比${stock.volumeRatio}不足1.5`);
  }
  // 主力净流入（当日）
  if (stock.mainInflowYi == null || stock.mainInflowYi === 0) {
    softFlags.push("主力净流入待确认");
  } else if (stock.mainInflowYi < 0) {
    hardFails.push(`主力净流出${stock.mainInflowYi}亿`);
  }
  return {
    pass: hardFails.length === 0,
    hardFails,
    softFlags,
    metrics: {
      ma5: kp.ma5, ma10: kp.ma10, ma20: kp.ma20,
      avgAmount5Yi: kp.avgAmount5Yi,
      volumeRatio: stock.volumeRatio == null ? null : stock.volumeRatio,
      mainInflowYi: stock.mainInflowYi == null ? null : stock.mainInflowYi,
    },
  };
}
```

并把 `hardGate` 加入导出：`module.exports = { computeMaProfile, hardGate, avg, round2 };`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test trading-rules.test.js`
Expected: PASS（全部）。

- [ ] **Step 5: Commit**

```bash
git add trading-rules.js trading-rules.test.js
git commit -m "feat(trading-rules): add hardGate with graceful degradation for capital data"
```

---

### Task 3: 周期子标签 `classifySubPhase`

**Files:**
- Modify: `trading-rules.js`
- Test: `trading-rules.test.js`

**Interfaces:**
- Consumes: `cycle`（字符串，如"主升"）、`limitStats`（含 `ztToday/ztPrev/ztHistory/dtToday`，`server.js` fetchLimitStats 返回）。
- Produces: `classifySubPhase(cycle, limitStats) -> { subPhase: string, reasons: string[] }`
  - 非"主升" → `subPhase === cycle`。主升 → "主升中" | "高潮加速" | "高位分歧"。

- [ ] **Step 1: Write the failing test**

追加：

```js
const { classifySubPhase } = require("./trading-rules");

test("classifySubPhase: 非主升周期子标签=周期本身", () => {
  assert.strictEqual(classifySubPhase("修复", {}).subPhase, "修复");
});

test("classifySubPhase: 涨停放大且炸板率低 = 高潮加速", () => {
  const r = classifySubPhase("主升", { ztToday: 110, ztPrev: 90, ztHistory: 118, dtToday: 3 });
  assert.strictEqual(r.subPhase, "高潮加速");
});

test("classifySubPhase: 炸板率高 = 高位分歧", () => {
  const r = classifySubPhase("主升", { ztToday: 70, ztPrev: 90, ztHistory: 110, dtToday: 6 });
  assert.strictEqual(r.subPhase, "高位分歧");
});

test("classifySubPhase: 平稳延续 = 主升中", () => {
  const r = classifySubPhase("主升", { ztToday: 92, ztPrev: 90, ztHistory: 100, dtToday: 4 });
  assert.strictEqual(r.subPhase, "主升中");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test trading-rules.test.js`
Expected: FAIL — `classifySubPhase is not a function`。

- [ ] **Step 3: Write minimal implementation**

加入：

```js
function classifySubPhase(cycle, limitStats) {
  if (cycle !== "主升") return { subPhase: cycle, reasons: [] };
  if (!limitStats || !limitStats.ztToday) {
    return { subPhase: "主升中", reasons: ["涨跌停数据缺失，默认主升中"] };
  }
  const zt = limitStats.ztToday;
  const ztPrev = limitStats.ztPrev || zt;
  const ztHistory = limitStats.ztHistory || zt;
  const dt = limitStats.dtToday || 0;
  const zbRate = ztHistory > 0 ? (ztHistory - zt) / ztHistory : 0; // 炸板率
  if (zbRate >= 0.25 || dt >= 10) {
    return { subPhase: "高位分歧", reasons: [`炸板率${Math.round(zbRate * 100)}%偏高/跌停${dt}抬头`] };
  }
  if (zt >= ztPrev * 1.1 && zbRate < 0.15) {
    return { subPhase: "高潮加速", reasons: [`涨停${ztPrev}→${zt}放大且炸板率${Math.round(zbRate * 100)}%低`] };
  }
  return { subPhase: "主升中", reasons: ["主升延续，未见加速或分歧"] };
}
```

导出补 `classifySubPhase`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test trading-rules.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add trading-rules.js trading-rules.test.js
git commit -m "feat(trading-rules): add classifySubPhase for 主升 climax/divergence sub-labels"
```

---

### Task 4: 交易模式 + 止盈止损 `tradeMode` / `stopProfitLoss`

**Files:**
- Modify: `trading-rules.js`
- Test: `trading-rules.test.js`

**Interfaces:**
- Produces:
  - `tradeMode({ role, ticketType, wave }) -> "打板" | "低吸" | "趋势"`
  - `stopProfitLoss(mode, marketState) -> { mode, stopLoss:{range:[lo,hi],basis}, takeProfit:{range:[lo,hi],basis}, position, riskReward }`
    - `marketState` 含 `cycle`、`subPhase`、`position`。

- [ ] **Step 1: Write the failing test**

追加：

```js
const { tradeMode, stopProfitLoss } = require("./trading-rules");

test("tradeMode: 容量票/二波=趋势，龙头=打板，其余=低吸", () => {
  assert.strictEqual(tradeMode({ ticketType: "容量票" }), "趋势");
  assert.strictEqual(tradeMode({ wave: "二波突破" }), "趋势");
  assert.strictEqual(tradeMode({ role: "龙头" }), "打板");
  assert.strictEqual(tradeMode({ role: "中军" }), "低吸");
});

test("stopProfitLoss: 打板基线区间正确", () => {
  const s = stopProfitLoss("打板", { cycle: "混沌", subPhase: "混沌", position: "20%-40%" });
  assert.deepStrictEqual(s.stopLoss.range, [-5, -3]);
  assert.strictEqual(s.position, "20%-40%");
  assert.ok(s.riskReward > 0);
});

test("stopProfitLoss: 主升放宽止盈、高潮收紧、分歧止损上移", () => {
  const up = stopProfitLoss("趋势", { cycle: "主升", subPhase: "主升中", position: "70%-100%" });
  const climax = stopProfitLoss("趋势", { cycle: "主升", subPhase: "高潮加速", position: "70%-100%" });
  const diverge = stopProfitLoss("打板", { cycle: "主升", subPhase: "高位分歧", position: "70%-100%" });
  assert.ok(up.takeProfit.range[1] > 25, "主升应放宽止盈上沿");
  assert.ok(climax.takeProfit.range[1] < 25, "高潮应收紧止盈");
  assert.deepStrictEqual(diverge.stopLoss.range, [-2, -1]);
});

test("stopProfitLoss: 退潮最紧止损优先空仓", () => {
  const s = stopProfitLoss("低吸", { cycle: "退潮", subPhase: "退潮", position: "0%" });
  assert.deepStrictEqual(s.stopLoss.range, [-3, -2]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test trading-rules.test.js`
Expected: FAIL — `tradeMode is not a function`。

- [ ] **Step 3: Write minimal implementation**

加入：

```js
function round1(x) { return Math.round(x * 10) / 10; }

function tradeMode(info) {
  const { role, ticketType, wave } = info || {};
  if (ticketType === "容量票" || wave === "二波突破" || wave === "三波/高位趋势") return "趋势";
  if (role === "龙头") return "打板";
  return "低吸";
}

const SPL_BASE = {
  打板: { sl: [-5, -3], slBasis: "跌破分时均价线或次日不及预期", tp: [5, 10], tpBasis: "次日冲高溢价兑现，分歧不接最后一棒" },
  低吸: { sl: [-4, -2], slBasis: "跌破买入参考(MA5/分时均价)", tp: [8, 15], tpBasis: "反包回封或到目标位分批" },
  趋势: { sl: [-8, -5], slBasis: "跌破MA5(趋势止损看MA10)", tp: [15, 25], tpBasis: "高潮加速分歧/MA5走平分批兑现" },
};

function stopProfitLoss(mode, marketState) {
  const base = SPL_BASE[mode] || SPL_BASE["低吸"];
  let sl = base.sl.slice();
  let tp = base.tp.slice();
  let slBasis = base.slBasis;
  let tpBasis = base.tpBasis;
  const cycle = marketState && marketState.cycle;
  const sub = marketState && marketState.subPhase;

  if (cycle === "主升" && sub !== "高潮加速" && sub !== "高位分歧") {
    tp = [tp[0], round1(tp[1] * 1.2)];
    tpBasis += "；主升进攻可放宽持有";
  }
  if (sub === "高潮加速") {
    tp = [round1(tp[0] * 0.7), round1(tp[1] * 0.7)];
    tpBasis = "高潮加速锁利，见好就收不接最后一棒";
  }
  if (sub === "高位分歧") {
    sl = [-2, -1];
    slBasis = "高位分歧止损上移至成本/分时均价，减仓为主";
  }
  if (cycle === "修复" || cycle === "混沌") {
    sl = [round1(sl[0] * 0.7), sl[1]];
    tp = [tp[0], round1(tp[1] * 0.8)];
    tpBasis += "；修复/混沌期小仓试错，区间收窄";
  }
  if (cycle === "退潮" || cycle === "冰点") {
    sl = [-3, -2];
    slBasis = "退潮/冰点破位即走，优先空仓";
    tp = [tp[0], round1(tp[1] * 0.6)];
  }
  const midSl = Math.abs((sl[0] + sl[1]) / 2);
  const midTp = (tp[0] + tp[1]) / 2;
  return {
    mode,
    stopLoss: { range: sl, basis: slBasis },
    takeProfit: { range: tp, basis: tpBasis },
    position: (marketState && marketState.position) || "—",
    riskReward: midSl ? round1(midTp / midSl) : null,
  };
}
```

导出补 `tradeMode, stopProfitLoss, round1`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test trading-rules.test.js`
Expected: PASS（全部）。

- [ ] **Step 5: Commit**

```bash
git add trading-rules.js trading-rules.test.js
git commit -m "feat(trading-rules): add tradeMode + stopProfitLoss by mode×cycle×subPhase"
```

---

### Task 5: 接入 `server.js` 管线

**Files:**
- Modify: `server.js`（顶部 require；`fetchKlineProfile` 返回；`classifyMarket` 返回；`scoreCandidate` 返回；`selectedLimit`）

**Interfaces:**
- Consumes: Task 1-4 的 `computeMaProfile / hardGate / classifySubPhase / tradeMode / stopProfitLoss`。
- Produces: `stock.hardGate`、`stock.stopLossPlan`、`marketState.subPhase`、`stock.klineProfile.{ma5,ma10,ma20,ma5Rising,longBearBreak3d,avgAmount5Yi,lastClose}`。

- [ ] **Step 1: 顶部引入模块**

在 `server.js` 第 6 行（`const WebSocket = require("ws");`）下一行加：

```js
const { computeMaProfile, hardGate, classifySubPhase, tradeMode, stopProfitLoss } = require("./trading-rules");
```

- [ ] **Step 2: `fetchKlineProfile` 暴露 MA 画像**

在 `fetchKlineProfile`（`server.js:1153`）的 `return {` 对象里，把 MA 画像并入。找到现有 return（约 `server.js:1192`），改为：

```js
    const maProfile = computeMaProfile(rows) || {};
    return {
      rise10: Math.round(rise10 * 10) / 10,
      rise20: Math.round(rise20 * 10) / 10,
      nearHigh20,
      volumeBreakout,
      pullbackDepth: Math.round(pullbackDepth * 10) / 10,
      wave,
      pctFromHigh,
      newHigh,
      chipComfort,
      ma5: maProfile.ma5,
      ma10: maProfile.ma10,
      ma20: maProfile.ma20,
      ma5Rising: maProfile.ma5Rising,
      longBearBreak3d: maProfile.longBearBreak3d,
      avgAmount5Yi: maProfile.avgAmount5Yi,
      lastClose: maProfile.lastClose,
    };
```

（保留原有字段不动，只追加 7 个 MA 字段。）

- [ ] **Step 3: `classifyMarket` 加 subPhase**

在 `classifyMarket`（`server.js:1519`）里，`cycle = applyCycleIrreversibility(...)` 之后、`return {` 之前加：

```js
  const { subPhase, reasons: subPhaseReasons } = classifySubPhase(cycle, limitStats);
```

并在该函数的 `return {` 对象里（`server.js:1599` 起）加两行：

```js
    cycle,
    subPhase,
    subPhaseReasons,
    operation,
```

（即在 `cycle,` 后插入 `subPhase,` 与 `subPhaseReasons,`。）

- [ ] **Step 4: `scoreCandidate` 加 hardGate 与 stopLossPlan**

在 `scoreCandidate`（`server.js:2875`）中，`const tradePlan = buildTradePlan(...)` 之后加：

```js
  const gate = hardGate(stock);
  if (!gate.pass) {
    for (const fail of gate.hardFails) rejects.push(`硬筛选未过：${fail}`);
  }
  const splMode = tradeMode({ role: roleInfo.role, ticketType: ticketType.type, wave: stock.klineProfile && stock.klineProfile.wave });
  const stopLossPlan = stopProfitLoss(splMode, marketState);
```

并在 `scoreCandidate` 的 `return {`（`server.js:3072`）对象里追加三个字段（放在 `tradePlan,` 附近）：

```js
    tradePlan,
    hardGate: gate,
    stopLossPlan,
    gamePlan,
```

> 说明：`hardGate` 失败会进 `rejects`，从而使该票 `selected=false`（已有逻辑 `!rejects.length`），落入剔除区——即"做减法"。软标 `softFlags` 不进 rejects。

- [ ] **Step 5: 收紧 `selectedLimit`（做减法）**

把 `server.js:3343-3344` 的：

```js
    const selectedLimit =
      marketState.cycle === "主升" ? 10 : marketState.cycle === "修复" ? 6 : marketState.cycle === "混沌" ? 4 : 2;
```

改为：

```js
    const selectedLimit =
      marketState.cycle === "主升" ? 6
      : marketState.cycle === "修复" ? 4
      : marketState.cycle === "混沌" ? 3
      : marketState.cycle === "冰点" ? 2
      : 0; // 退潮：不开放新仓，空仓
```

- [ ] **Step 6: 语法校验 + 单元测试**

Run: `node --check server.js && node --test trading-rules.test.js`
Expected: 无语法错误；单测全过。

- [ ] **Step 7: 端到端冒烟（手动确认数据流通）**

Run（后台起服务，抓一次 dump）：`node server.js --dump-data`
Expected: 进程正常退出/写出 `dist/data.json` 或缓存；用以下命令确认新字段已落地：

Run: `node -e "const d=require('./.hot-stocks-cache.json'); const s=(d.selected[0]||d.candidates[0]); console.log('subPhase=',d.market.state.subPhase); console.log('hardGate=',!!s.hardGate,'splPlan=',!!s.stopLossPlan,'ma5=',s.klineProfile&&s.klineProfile.ma5);"`
Expected: 打印出 `subPhase=` 非空、`hardGate= true`、`splPlan= true`、`ma5=` 数字。

> 若 `--dump-data` 因东财限流失败，重试一次或稍后再跑；逻辑正确性已由单测覆盖，此步只验证字段贯通。

- [ ] **Step 8: Commit**

```bash
git add server.js
git commit -m "feat(server): wire hardGate/subPhase/stopProfitLoss/MA into selection pipeline"
```

---

### Task 6: 前端展示（`script.js` + `styles.css`）

**Files:**
- Modify: `script.js`（`stockCard`、`renderMarketState`）
- Modify: `styles.css`

**Interfaces:**
- Consumes: `stock.hardGate`、`stock.stopLossPlan`、`market.state.subPhase`。

- [ ] **Step 1: stockCard 加硬筛选标签**

在 `stockCard`（`script.js` 内）的 `stock-tags` 块里，`<span>热榜 ${stock.combinedRank}</span>` 之后加：

```js
        ${
          stock.hardGate
            ? `<span class="gate-tag ${stock.hardGate.pass ? "gate-pass" : "gate-fail"}">${stock.hardGate.pass ? "硬筛选✓" : "硬筛选✗ " + (stock.hardGate.hardFails[0] || "")}</span>`
            : ""
        }
```

- [ ] **Step 2: stockCard 加止盈止损块**

在 `stock.tradePlan ? ...` 的 `trade-plan` 块（`<div><span>风险</span>...</div>` 那段）的 `</div>` 之前，插入止盈止损行；即把 `trade-plan` 模板改为：

```js
          ? `<div class="trade-plan">
              <div><span>买点</span><p>${stock.tradePlan.buy}</p></div>
              <div><span>次日</span><p>${stock.tradePlan.nextDay}</p></div>
              <div><span>卖点</span><p>${stock.tradePlan.sell}</p></div>
              <div><span>风险</span><p>${stock.tradePlan.risk}</p></div>
              ${
                stock.stopLossPlan
                  ? `<div class="spl-row">
                      <span class="spl-mode">${stock.stopLossPlan.mode}</span>
                      <span class="spl-loss">止损 ${stock.stopLossPlan.stopLoss.range[0]}%~${stock.stopLossPlan.stopLoss.range[1]}%</span>
                      <span class="spl-profit">止盈 +${stock.stopLossPlan.takeProfit.range[0]}%~+${stock.stopLossPlan.takeProfit.range[1]}%</span>
                      <span class="spl-rr">盈亏比 ${stock.stopLossPlan.riskReward}</span>
                      <span class="spl-pos">建议仓位 ${stock.stopLossPlan.position}</span>
                    </div>
                    <p class="spl-basis">止损依据：${stock.stopLossPlan.stopLoss.basis}；止盈依据：${stock.stopLossPlan.takeProfit.basis}</p>`
                  : ""
              }
            </div>`
```

- [ ] **Step 3: renderMarketState 显示子标签**

把 `script.js` 中 `document.querySelector("#marketCycle").textContent = state.cycle;` 改为：

```js
  document.querySelector("#marketCycle").textContent =
    state.subPhase && state.subPhase !== state.cycle ? `${state.cycle}·${state.subPhase}` : state.cycle;
```

- [ ] **Step 4: 加样式**

在 `styles.css` 末尾追加：

```css
/* 硬筛选标签 */
.gate-tag { padding: 2px 8px; border-radius: 6px; font-size: 12px; }
.gate-pass { background: rgba(46, 160, 67, 0.15); color: #2ea043; }
.gate-fail { background: rgba(248, 81, 73, 0.15); color: #f85149; }
/* 止盈止损行 */
.spl-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; font-size: 13px; align-items: center; }
.spl-mode { font-weight: 700; padding: 2px 8px; border-radius: 6px; background: rgba(110, 118, 129, 0.2); }
.spl-loss { color: #f85149; }
.spl-profit { color: #2ea043; }
.spl-rr, .spl-pos { color: #8b949e; }
.spl-basis { margin-top: 4px; font-size: 12px; color: #8b949e; }
```

- [ ] **Step 5: 语法校验 + 目视**

Run: `node --check script.js`
Expected: 无语法错误。
再 `node server.js`，浏览器开 http://localhost:5173，Ctrl+F5，确认：周期显示如"主升·高潮加速"；入选卡片有"硬筛选✓"、止损/止盈/盈亏比/建议仓位一行。

- [ ] **Step 6: Commit**

```bash
git add script.js styles.css
git commit -m "feat(frontend): show hardGate tag, stop-loss/take-profit band, cycle sub-phase"
```

---

### Task 7: 现有选股逻辑 bug 扫描校准

**Files:**
- 只读审查：`server.js`（`classifyMarket`、`scoreCandidate`、`applyCycleIrreversibility`、`fetchKlineProfile`）+ 新模块
- 产出：`docs/superpowers/reviews/2026-06-19-calibration-notes.md`

> 用户明确要求"检查代码是否有 bug 来校准"。本任务做一次聚焦审查，把发现写成笔记；确为 bug 的另开修复任务（每个 bug 一轮 TDD），不在本任务里夹带大改。

- [ ] **Step 1: 跑全部单测确认绿**

Run: `node --test`
Expected: 所有 `*.test.js` PASS。

- [ ] **Step 2: 聚焦审查清单（逐条核对并记录）**

逐项检查并把结论写入 `docs/superpowers/reviews/2026-06-19-calibration-notes.md`：

1. **MA 顺序假设**：`computeMaProfile` 假设 `rows` 旧→新。核对 `parseKlineRows`/东财 klines 实际顺序（东财 kline 默认旧→新）。若相反则 `ma5/longBear` 全错——务必确认。
2. **`avgAmount5` 口径**：`fetchKlineProfile` 原 `avgAmount5` 用 `slice(-6,-1)`（不含今日 5 日），新 `avgAmount5Yi` 用 `slice(-5)`（含今日）。确认门槛语义可接受，或统一口径。
3. **hardGate 与现有 rejects 叠加**：确认 hardGate 失败不会与"退潮不开新仓"等重复导致信息冗余；剔除区文案是否清晰。
4. **`selected` 收紧后空池**：退潮 `selectedLimit=0` 时前端 `selected` 区是否优雅显示"空仓观望"而非报错。
5. **`classifyMarket` 边界**：`heatConfirmed` 在 `limitStats` 为 null 时退回 `breadth>0.6`；`subPhase` 在非主升下=cycle，确认前端拼接不出现"修复·修复"。
6. **数值健壮性**：`volumeRatio/mainInflowYi` 为 `NaN`（`Number(undefined)`）时 hardGate 分支行为——`NaN == null` 为 false，`NaN > 1.5` 为 false → 会误判为硬失败。**核查 clist 缺字段时这些值是 `NaN` 还是 `0`/`undefined`**；若可能为 `NaN`，在 hardGate 用 `Number.isFinite` 加固。

- [ ] **Step 3: 如发现真 bug，逐个开 TDD 修复任务**

对每个确认的 bug：先在 `trading-rules.test.js` 或新测试里写复现用例（失败）→ 修复 → 测试转绿 → commit。**不批量改，一 bug 一提交。**

- [ ] **Step 4: Commit 审查笔记**

```bash
git add docs/superpowers/reviews/2026-06-19-calibration-notes.md
git commit -m "docs: calibration review notes for selection logic"
```

---

## Self-Review（计划对照 spec）

- **spec §2 哲学护栏** → 散落实现（hardGate=只做主线/资金合力；subPhase 高潮分歧 → stopProfitLoss 收紧=不接最后一棒；riskReward+position=胜率盈亏比仓位）。✅ 覆盖（无独立任务，按 spec 设计即护栏贯穿）。
- **spec §3 周期子标签** → Task 3 + Task 5 Step 3。✅
- **spec §4 硬筛选双层** → Task 1（MA）+ Task 2（hardGate）+ Task 5 Step 4（接入 rejects）。✅
- **spec §5 交易模式×出手时机** → 复用现有 `buildTradePlan`（buy/nextDay/sell）+ Task 4 `tradeMode`。✅
- **spec §6 止盈止损** → Task 4 + Task 5 + Task 6 Step 2。✅
- **spec §7 前端** → Task 6。✅
- **spec §8 工程质量/bug 校准** → 全程 TDD + Task 7。✅
- **spec §0 做减法** → Task 5 Step 5（收紧 selectedLimit）+ hardGate 严格剔除。✅
- **占位符扫描**：无 TBD/TODO，每步含真实代码与命令。✅
- **类型一致性**：`stopLossPlan.stopLoss.range`/`takeProfit.range`/`hardGate.hardFails`/`marketState.subPhase` 在 Task 4/5/6 中命名一致。✅

## Execution Handoff

见下方对话中的执行方式选择。
