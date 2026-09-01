"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "desktop-main.js"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));

test("Electron渲染器保持隔离、禁用Node并启用沙箱", () => {
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /webSecurity:\s*true/);
});

test("外部链接只允许HTTPS且本地导航按精确origin判断", () => {
  assert.match(source, /function isTrustedLocalUrl\(value, allowedBaseUrl\)/);
  assert.match(source, /target\.origin === allowed\.origin/);
  assert.match(source, /function openExternalHttps\(value\)/);
  assert.match(source, /target\.protocol !== "https:"/);
  assert.doesNotMatch(source, /shell\.openExternal\(url\)/);
});

test("桌面窗口拒绝网页权限、WebView和额外窗口", () => {
  assert.match(source, /setWindowOpenHandler[\s\S]*return \{ action: "deny" \}/);
  assert.match(source, /will-attach-webview[\s\S]*preventDefault/);
  assert.match(source, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(source, /setPermissionRequestHandler[\s\S]*callback\(false\)/);
});

test("发布包启用ASAR且只解包必要的行情子进程", () => {
  assert.equal(packageJson.build.asar, true);
  assert.deepEqual(packageJson.build.asarUnpack, ["eastmoney-fetcher.js"]);
});
