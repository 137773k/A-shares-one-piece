"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const modelRoot = __dirname;
const mobileRoot = path.resolve(modelRoot, "..", "a-share-trading-mobile");
const forbidden = /personal-logic-picker|personalLogicPicker|个人专用逻辑选股|personalLogic|direct-opportunity-personal-link/;

function read(root, relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

test("个人专用逻辑选股模型、页面、接口与双端发布接线均已移除", () => {
  for (const root of [modelRoot, mobileRoot]) {
    for (const relative of [
      "personal-logic-picker.js",
      "test-personal-logic-picker.js",
      "test-personal-logic-render.js",
      "test-personal-logic-theme-contract.js",
    ]) assert.equal(fs.existsSync(path.join(root, relative)), false, `${root} must not retain ${relative}`);

    for (const relative of ["index.html", "script.js", "server.js", "cloud-current-sync.js", "unified-quant-factors.js"]) {
      assert.doesNotMatch(read(root, relative), forbidden, `${relative} still contains removed picker wiring`);
    }
  }

  assert.doesNotMatch(read(modelRoot, "ui-refresh.css"), forbidden);
  assert.doesNotMatch(read(mobileRoot, "ui-refresh.css"), forbidden);
  assert.doesNotMatch(read(mobileRoot, "mobile-start.js"), forbidden);
  assert.doesNotMatch(read(mobileRoot, "cloud-sync-server.js"), forbidden);
  assert.doesNotMatch(read(mobileRoot, "package.json"), forbidden);
  assert.doesNotMatch(read(mobileRoot, path.join("deploy", "deploy-production.sh")), forbidden);
});

test("题材人工复核服务和核心观察模块不随窄范围删除", () => {
  for (const relative of ["theme-attribution-review.js", "post-close-opportunity.js", "quant-decision/decision-chain.js"]) {
    assert.equal(fs.existsSync(path.join(modelRoot, relative)), true, `${relative} must remain`);
  }
  assert.match(read(modelRoot, "index.html"), /data-view="auto-picker"/);
  assert.match(read(modelRoot, "server.js"), /themeAttributionReviewHandler/);
});
