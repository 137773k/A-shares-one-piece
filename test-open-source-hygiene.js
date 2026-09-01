"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = __dirname;
const repositoryOnlyArtifacts = [
  ".hot-stocks-cache.json",
  ".eastmoney-market.json",
  ".cycle-state.json",
  "dist/data.json",
  ".eastmoney-center-list.html",
  ".eastmoney-debug.json",
  ".eastmoney-hshq.js",
  ".eastmoney-index.js",
  ".stock_shichang.js",
  "release-validation-output/windows-installer-validation.json",
  ".claude_task.txt",
  ".claude_task_theme.txt",
  ".claude_task_v11_asym.txt",
  ".claude_task_v11_p1.txt",
  ".claude_task_v11_p2.txt",
  ".claude_task_v11_theme.txt",
  "expo-app/.claude_task.txt",
  "expo-app/.codex_3d_task.txt",
  "expo-app/.codex_game_task.txt",
  "expo-app/.codex_pixel_task.txt",
  "expo-app/.codex_task.txt",
  "expo-app/expo-web.err.log",
  "expo-app/expo-web.out.log",
];

test("开源仓库不再跟踪本机缓存、调试抓包、日志或AI任务草稿", () => {
  const tracked = execFileSync("git", ["ls-files", "-z", "--", ...repositoryOnlyArtifacts], {
    cwd: root,
    encoding: "utf8",
  }).split("\0").filter(Boolean);
  assert.deepEqual(tracked, []);
});

test("开源仓库不跟踪可重建的桌面或Expo编译输出", () => {
  const tracked = execFileSync("git", ["ls-files", "-z", "--", "dist", "expo-app/_expo"], {
    cwd: root,
    encoding: "utf8",
  }).split("\0").filter(Boolean);
  assert.deepEqual(tracked, []);
});

test("Electron安装包只包含程序资源，不打包本机data、dist或运行时快照", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const files = packageJson.build && Array.isArray(packageJson.build.files)
    ? packageJson.build.files : [];
  const positiveRules = files.filter((rule) => typeof rule === "string" && !rule.startsWith("!"));
  assert.equal(positiveRules.some((rule) => rule === "data/**/*" || rule.startsWith("data/")), false);
  assert.equal(positiveRules.some((rule) => rule === "dist/**/*" || rule.startsWith("dist/")), false);
  assert.equal(positiveRules.includes("data-providers/**/*"), true);
  for (const snapshot of [".hot-stocks-cache.json", ".eastmoney-market.json", ".cycle-state.json"]) {
    assert.equal(positiveRules.includes(snapshot), false);
  }
  assert.equal(positiveRules.includes("LICENSE"), true);
});

test("本地生成物都有持久忽略规则", () => {
  const ignored = repositoryOnlyArtifacts.filter((relativePath) => {
    try {
      execFileSync("git", ["check-ignore", "--no-index", "-q", "--", relativePath], {
        cwd: root,
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  });
  assert.deepEqual(ignored, repositoryOnlyArtifacts);
});

test("当前受控文本文件不包含个人主目录绝对路径", () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  }).split("\0").filter(Boolean);
  const leaks = [];
  for (const relativePath of tracked) {
    const filePath = path.join(root, relativePath);
    let buffer;
    try {
      buffer = fs.readFileSync(filePath);
    } catch {
      continue;
    }
    if (buffer.includes(0)) continue;
    const content = buffer.toString("utf8");
    if (/[A-Za-z]:[\\/]Users[\\/][^\\/\r\n]+/i.test(content)
      || /\/(?:Users|home)\/[^/\r\n]+/.test(content)) {
      leaks.push(relativePath);
    }
  }
  assert.deepEqual(leaks, []);
});
