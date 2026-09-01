"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function candidates() {
  const rows = [];
  const configured = String(process.env.A_SHARE_PYTHON || "").trim();
  if (configured) rows.push({ command: configured, prefix: [], source: "A_SHARE_PYTHON" });
  const localVenv = process.platform === "win32"
    ? path.join(__dirname, "data", ".venv-akshare", "Scripts", "python.exe")
    : path.join(__dirname, "data", ".venv-akshare", "bin", "python");
  if (fs.existsSync(localVenv)) rows.push({ command: localVenv, prefix: [], source: "project_venv" });
  if (process.platform === "win32") rows.push({ command: "py", prefix: ["-3"], source: "py_launcher" });
  rows.push({ command: "python", prefix: [], source: "PATH_python" });
  rows.push({ command: "python3", prefix: [], source: "PATH_python3" });
  return rows;
}

function resolvePython() {
  const failures = [];
  for (const candidate of candidates()) {
    const probe = spawnSync(candidate.command, [...candidate.prefix, "-c", "import sys; print(sys.executable)"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    });
    if (probe.status === 0) return candidate;
    failures.push(`${candidate.source}:${String(probe.error && probe.error.message || probe.stderr || `exit ${probe.status}`).trim()}`);
  }
  const error = new Error(
    "No usable Python interpreter found. Set A_SHARE_PYTHON or create data/.venv-akshare. "
    + failures.join(" | "),
  );
  error.code = "PYTHON_NOT_AVAILABLE";
  throw error;
}

function main(argv = process.argv.slice(2)) {
  if (!argv.length) throw new Error("Python arguments are required");
  const python = resolvePython();
  const child = spawnSync(python.command, [...python.prefix, ...argv], {
    cwd: __dirname,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (child.error) throw child.error;
  return Number.isInteger(child.status) ? child.status : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(String(error && error.message || error));
    process.exitCode = 1;
  }
}

module.exports = { candidates, resolvePython, main };
