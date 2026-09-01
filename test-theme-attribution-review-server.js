"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const server = require("./server");

test("server为人工题材核实提供只读同代上下文并挂载独立API", () => {
  const contextBuilder = server._internals && server._internals.themeAttributionReviewContext;
  assert.equal(typeof contextBuilder, "function");
  const decision = {
    generationId: "2026-08-15:2026-08-15T15:10:00.000Z",
    tradingDate: "2026-08-15",
    asOf: "2026-08-15T15:10:00.000Z",
    permission: { status: "blocked", allowNew: false },
    opportunityCount: 0,
  };
  const payload = {
    generationId: decision.generationId,
    tradingDate: decision.tradingDate,
    fetchedAt: decision.asOf,
    tomorrowDecision: decision,
    candidates: [{ code: "002428", name: "匿名样本", concepts: ["光纤概念"] }],
  };
  const before = structuredClone(payload);
  const context = contextBuilder(payload);

  assert.deepEqual(context.currentGeneration, {
    generationId: decision.generationId,
    tradingDate: decision.tradingDate,
    asOf: decision.asOf,
  });
  assert.equal(context.candidates.length, 1);
  assert.deepEqual(context.decision, decision);
  assert.deepEqual(payload, before, "构建人工复核上下文不得修改决策payload");

  const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  assert.match(source, /createThemeAttributionReviewHandler/);
  assert.match(source, /await themeAttributionReviewHandler\(request, response, pathname\)/);
});
