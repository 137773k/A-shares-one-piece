import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const releaseDir = path.resolve(process.argv[2] || path.join(root, "release"));
const arch = String(process.argv[3] || "").trim();
if (!new Set(["arm64", "x64"]).has(arch)) throw new Error("arch must be arm64 or x64");

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = String(packageJson.version || "");
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("package version is invalid");

function resolveArtifactName(template) {
  const value = String(template || "")
    .replace("${productName}", String(packageJson.build.productName || ""))
    .replace("${version}", version)
    .replace("${arch}", arch)
    .replace("${ext}", "dmg");
  if (/\$\{/.test(value) || path.basename(value) !== value) {
    throw new Error(`invalid mac artifact template: ${template}`);
  }
  return value;
}

const artifactName = resolveArtifactName(packageJson.build.mac.artifactName);
const artifactPath = path.join(releaseDir, artifactName);
const stat = fs.statSync(artifactPath);
if (!stat.isFile()) throw new Error("mac artifact must be a regular file");
const sha256 = crypto.createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
}).trim();
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("source commit is invalid");

const checksumName = `SHA256SUMS-macos-${arch}.txt`;
const manifestName = `release-manifest-macos-${arch}.json`;
fs.writeFileSync(path.join(releaseDir, checksumName), `${sha256}  ${artifactName}\n`, "utf8");

const manifest = {
  schemaVersion: 1,
  project: "A shares one piece",
  productName: String(packageJson.build.productName),
  version,
  sourceCommit,
  platform: `macos-${arch}`,
  generatedAt: new Date().toISOString(),
  artifact: {
    name: artifactName,
    sizeBytes: stat.size,
    sha256,
  },
  signing: {
    developerIdSigned: false,
    notarized: false,
    distribution: "unsigned-open-source-build",
  },
  disclaimer: "仅供学习研究，不构成投资建议；使用者自行承担交易风险。",
};
fs.writeFileSync(path.join(releaseDir, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ manifestName, checksumName, manifest }, null, 2)}\n`);
