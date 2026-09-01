"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = __dirname;
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

test("1.2.0发布元数据、Node边界和安装包名称保持一致", () => {
  assert.equal(packageJson.version, "1.2.0");
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].version, packageJson.version);
  assert.equal(packageJson.engines.node, ">=22.12.0");
  assert.equal(packageJson.build.win.target.some((item) => item.target === "nsis"), true);
  assert.equal(packageJson.build.win.target.some((item) => item.target === "portable"), true);
  assert.match(packageJson.build.nsis.artifactName, /Setup-\$\{version\}-\$\{arch\}/);
  assert.match(packageJson.build.portable.artifactName, /Portable-\$\{version\}-\$\{arch\}/);
});

test("小白README明确免开发环境、云端边界、数据目录、哈希和投资风险", () => {
  for (const pattern of [
    /普通用户不需要安装 Git、Node\.js、npm、Python、AKShare/,
    /云端正式决策不是基础功能/,
    /%APPDATA%\\a-share-trading-model\\runtime/,
    /SHA256SUMS\.txt/,
    /不构成证券投资建议/,
    /自行承担全部交易风险/,
  ]) assert.match(readme, pattern);
});

test("发布清单脚本对Setup和Portable生成可复算SHA-256", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "a-share-release-manifest-"));
  try {
    const names = [
      `A股短线模型-Setup-${packageJson.version}-x64.exe`,
      `A股短线模型-Portable-${packageJson.version}-x64.exe`,
    ];
    names.forEach((name, index) => fs.writeFileSync(path.join(tempDir, name), `fixture-${index}\n`));
    const shell = process.platform === "win32" ? "pwsh.exe" : "pwsh";
    const result = spawnSync(shell, [
      "-NoProfile",
      "-File",
      path.join(root, "release-tools", "Build-ReleaseManifest.ps1"),
      "-ReleaseDir",
      tempDir,
    ], { cwd: root, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const manifest = JSON.parse(fs.readFileSync(path.join(tempDir, "release-manifest.json"), "utf8"));
    const checksumLines = fs.readFileSync(path.join(tempDir, "SHA256SUMS.txt"), "utf8").trim().split(/\r?\n/);
    assert.equal(manifest.version, packageJson.version);
    assert.equal(manifest.artifacts.length, 2);
    manifest.artifacts.forEach((artifact) => {
      const expected = crypto.createHash("sha256")
        .update(fs.readFileSync(path.join(tempDir, artifact.name)))
        .digest("hex");
      assert.equal(artifact.sha256, expected);
      assert(checksumLines.includes(`${expected}  ${artifact.name}`));
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
