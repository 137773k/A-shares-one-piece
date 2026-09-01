"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function candidates(environment = process.env) {
  const rows = [];
  const configured = String(environment.A_SHARE_JQDATA_PYTHON || "").trim();
  if (configured) rows.push({ command: configured, prefix: [], source: "A_SHARE_JQDATA_PYTHON" });
  const localVenv = process.platform === "win32"
    ? path.join(__dirname, "data", ".venv-jqdata", "Scripts", "python.exe")
    : path.join(__dirname, "data", ".venv-jqdata", "bin", "python");
  if (fs.existsSync(localVenv)) rows.push({ command: localVenv, prefix: [], source: "project_jqdata_venv" });
  if (process.platform === "win32") rows.push({ command: "py", prefix: ["-3"], source: "py_launcher" });
  rows.push({ command: "python", prefix: [], source: "PATH_python" });
  rows.push({ command: "python3", prefix: [], source: "PATH_python3" });
  return rows;
}

function sanitizedProbeEnvironment(environment = process.env) {
  const result = { ...environment };
  delete result.JQDATA_USER;
  delete result.JQDATA_PASSWORD;
  return result;
}

function resolvePython(options = {}) {
  const spawn = options.spawnSync || spawnSync;
  const environment = options.env || process.env;
  const probeEnvironment = sanitizedProbeEnvironment(environment);
  const failures = [];
  for (const candidate of candidates(environment)) {
    const probe = spawn(candidate.command, [...candidate.prefix, "-c", [
      "import importlib.util,sys",
      "assert importlib.util.find_spec('jqdatasdk') is not None",
      "print(sys.executable)",
    ].join("; ")], {
      encoding: "utf8",
      env: probeEnvironment,
      windowsHide: true,
      timeout: 10_000,
    });
    if (probe.status === 0) return candidate;
    failures.push(`${candidate.source}:${String(probe.error && probe.error.message || probe.stderr || `exit ${probe.status}`).trim()}`);
  }
  const error = new Error(
    "No Python interpreter with jqdatasdk found. Set A_SHARE_JQDATA_PYTHON "
    + "or create data/.venv-jqdata from requirements-jqdata.txt. "
    + failures.join(" | "),
  );
  error.code = "JQDATA_PYTHON_NOT_AVAILABLE";
  throw error;
}

function main(argv = process.argv.slice(2), options = {}) {
  if (!argv.length) throw new Error("JQData Python arguments are required");
  const spawn = options.spawnSync || spawnSync;
  const environment = options.env || process.env;
  const python = resolvePython({ spawnSync: spawn, env: environment });
  const child = spawn(python.command, [...python.prefix, ...argv], {
    cwd: __dirname,
    env: environment,
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

module.exports = { candidates, sanitizedProbeEnvironment, resolvePython, main };
