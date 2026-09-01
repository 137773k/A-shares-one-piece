"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "macos-dmg-validation.yml"), "utf8");
const iconBuilder = fs.readFileSync(path.join(root, "release-tools", "build-mac-icon.sh"), "utf8");
const dmgValidator = fs.readFileSync(path.join(root, "release-tools", "Test-MacDmg.sh"), "utf8");
const manifestBuilder = fs.readFileSync(path.join(root, "release-tools", "build-mac-release-manifest.mjs"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

test("1.2.2同时声明Apple Silicon与Intel的未签名DMG", () => {
  assert.equal(packageJson.version, "1.2.2");
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].version, packageJson.version);
  assert.deepEqual(packageJson.build.mac.target, ["dmg"]);
  assert.equal(packageJson.build.mac.identity, null);
  assert.equal(packageJson.build.mac.hardenedRuntime, false);
  assert.equal(packageJson.build.mac.category, "public.app-category.finance");
  assert.equal(packageJson.build.mac.icon, ".cache/mac-icon/app.icns");
  assert.equal(packageJson.build.mac.artifactName, "A-shares-one-piece-${version}-mac-${arch}.${ext}");
  assert.match(packageJson.scripts["desktop:dist:mac:arm64"], /--mac dmg --arm64 --publish never/);
  assert.match(packageJson.scripts["desktop:dist:mac:x64"], /--mac dmg --x64 --publish never/);
});

test("1024像素PNG通过macOS原生工具生成完整ICNS", () => {
  const png = fs.readFileSync(path.join(root, "expo-app", "assets", "icon.png"));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
  for (const pattern of [/mktemp -d/, /sips -z/, /icon_512x512@2x\.png/, /iconutil -c icns/]) {
    assert.match(iconBuilder, pattern);
  }
});

test("DMG验收覆盖架构、挂载、两次启动、云端隔离和历史隔离", () => {
  for (const pattern of [
    /hdiutil verify/,
    /hdiutil attach/,
    /hdiutil detach/,
    /CFBundleShortVersionString/,
    /CFBundleIdentifier/,
    /nativeArchitectureMatched/,
    /run_application 1/,
    /run_application 2/,
    /api\/cloud-current-sync\/status/,
    /privateHistoryCountZero/,
    /runtimePersistsAcrossRestart/,
  ]) assert.match(dmgValidator, pattern);
});

test("macOS工作流在原生arm64和Intel机器上验收且不持有发布权限", () => {
  for (const pattern of [
    /runner: macos-15\s/,
    /runner: macos-15-intel/,
    /arch: arm64/,
    /arch: x64/,
    /CSC_IDENTITY_AUTO_DISCOVERY: "false"/,
    /npm run test:quant-decision/,
    /npm test/,
    /Test-MacDmg\.sh/,
    /success\(\) && startsWith\(github\.ref, 'refs\/tags\/v'\)/,
    /macos-release-\$\{\{ github\.ref_name \}\}-\$\{\{ matrix\.arch \}\}/,
  ]) assert.match(workflow, pattern);
  assert.doesNotMatch(workflow, /contents:\s+write/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /GH_TOKEN/);
});

test("macOS清单固定记录未签名、未公证和逐架构SHA-256", () => {
  for (const pattern of [
    /macos-\$\{arch\}/,
    /developerIdSigned: false/,
    /notarized: false/,
    /unsigned-open-source-build/,
    /SHA256SUMS-macos-\$\{arch\}\.txt/,
  ]) assert.match(manifestBuilder, pattern);
});

test("README明确Mac架构选择、数据目录和Gatekeeper风险", () => {
  for (const pattern of [
    /A-shares-one-piece-1\.2\.2-mac-arm64\.dmg/,
    /A-shares-one-piece-1\.2\.2-mac-x64\.dmg/,
    /Apple Silicon/,
    /Intel/,
    /Library\/Application Support\/a-share-trading-model\/runtime/,
    /未签名且未经过Apple公证/,
    /隐私与安全/,
  ]) assert.match(readme, pattern);
});
