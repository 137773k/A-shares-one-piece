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
const installerValidation = fs.readFileSync(
  path.join(root, "release-tools", "Test-WindowsInstaller.ps1"),
  "utf8",
);
const installerWorkflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "windows-installer-validation.yml"),
  "utf8",
);

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

test("Windows安装验收覆盖干净机、两次启动、数据隔离和卸载残留", () => {
  for (const pattern of [
    /clean Windows runner required/,
    /\/S/,
    /--user-data-dir=/,
    /api\/cloud-current-sync\/status/,
    /cloud\.sync\.configured -ne \$false/,
    /historyCount -ne 0/,
    /releaseManifestMatches/,
    /setupSha256/,
    /RunNumber 2/,
    /runtimePersistsAcrossRestart/,
    /Uninstall\*\.exe/,
    /installDirectoryRemoved/,
    /uninstallEntryRemoved/,
    /shortcutsRemoved/,
  ]) assert.match(installerValidation, pattern);
  assert.doesNotMatch(installerValidation, /ListenerProcessId\.Value/);
});

test("GitHub工作流以只读权限在临时Windows机器构建并执行安装验收", () => {
  for (const pattern of [
    /runs-on: windows-latest/,
    /timeout-minutes: 30/,
    /permissions:\s+contents: read/,
    /fetch-depth: 0/,
    /node-version: "22\.12\.0"/,
    /npm run test:quant-decision/,
    /npm test/,
    /npm run desktop:dist -- --publish never/,
    /Build-ReleaseManifest\.ps1/,
    /Test-WindowsInstaller\.ps1/,
    /actions\/checkout@[a-f0-9]{40} # v7\.0\.1/,
    /actions\/setup-node@[a-f0-9]{40} # v7\.0\.0/,
    /actions\/upload-artifact@[a-f0-9]{40} # v7\.0\.1/,
  ]) assert.match(installerWorkflow, pattern);
  assert.doesNotMatch(installerWorkflow, /secrets\./);
  assert.doesNotMatch(installerWorkflow, /GH_TOKEN/);
  assert.doesNotMatch(installerWorkflow, /uses:\s+actions\/.+@v\d+/);
});

test("只有通过标签验收的同批安装包才进入发布候选工件", () => {
  for (const pattern of [
    /Upload validated release packages/,
    /success\(\) && startsWith\(github\.ref, 'refs\/tags\/v'\)/,
    /name: windows-release-\$\{\{ github\.ref_name \}\}/,
    /compression-level: 0/,
    /release\/A股短线模型-Setup-\*-x64\.exe/,
    /release\/A股短线模型-Portable-\*-x64\.exe/,
    /release\/SHA256SUMS\.txt/,
    /release\/release-manifest\.json/,
  ]) assert.match(installerWorkflow, pattern);
  assert.doesNotMatch(installerWorkflow, /contents:\s+write/);
  assert.doesNotMatch(installerWorkflow, /gh release create/);
});
