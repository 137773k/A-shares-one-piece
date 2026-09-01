"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, test } = require("node:test");

const ROOT = __dirname;
const POWERSHELL = "powershell.exe";

function read(name) {
  return fs.readFileSync(path.join(ROOT, name), "utf8");
}

function quotePowerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runPowerShell(script, { allowFailure = false, timeout = 30_000 } = {}) {
  const result = spawnSync(
    POWERSHELL,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
    {
      encoding: "utf8",
      timeout,
      windowsHide: true,
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (!allowFailure && result.status !== 0) {
    throw new Error(
      `PowerShell failed with exit code ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function reservePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForServer(url, predicate = () => true, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      const payload = await response.json();
      if (response.status === 200 && predicate(payload)) {
        return payload;
      }
      lastError = new Error(`unexpected response: ${response.status} ${JSON.stringify(payload)}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }

  throw new Error(`service did not become healthy at ${url}: ${lastError?.message ?? "timeout"}`);
}

async function waitForServerStop(url, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(500) });
    } catch {
      return;
    }
    await delay(200);
  }
  throw new Error(`service was still reachable after its scheduled task stopped: ${url}`);
}

test("installer keeps one long-running logon task without periodic launches", () => {
  const source = read("install-local-service-autostart.ps1");

  assert.match(
    source,
    /New-ScheduledTaskSettingsSet[\s\S]*?-DontStopOnIdleEnd/,
    "New-ScheduledTaskSettingsSet must include -DontStopOnIdleEnd",
  );
  assert.match(source, /-ExecutionTimeLimit\s*\(New-TimeSpan\s+-Seconds\s+0\)/);
  assert.match(source, /-MultipleInstances\s+IgnoreNew/);
  assert.match(source, /-RestartCount\s+10/);
  assert.match(source, /-RestartInterval\s*\(New-TimeSpan\s+-Minutes\s+1\)/);
  assert.match(source, /-Trigger\s+\$logonTrigger/);
  assert.match(source, /Get-Command\s+powershell\.exe\s+-ErrorAction\s+Stop/);
  assert.doesNotMatch(source, /RepetitionInterval|\$recoveryTrigger|Every1m/);
  assert.doesNotMatch(source, /Join-Path\s+\$PSHOME\s+["']powershell\.exe["']/);
});

test("keeper retains restart, port-safety, and diagnostic logging responsibilities", () => {
  const source = read("local-service-keeper.ps1");

  assert.match(source, /Test-ServerHealthy/);
  assert.match(source, /Test-LocalPortListening/);
  assert.match(source, /while\s*\(\s*\$true\s*\)/i);
  assert.match(source, /server\.js/);
  assert.match(source, /server exited with code=/);
  assert.match(source, /System\.Threading\.Mutex/);
  assert.match(source, /another keeper instance already owns/);
  assert.match(source, /local-service-keeper\.log/);
  assert.match(source, /local-service-server\.out\.log/);
  assert.match(source, /local-service-server\.err\.log/);
  assert.match(source, /Start-Process[\s\S]*?-WindowStyle\s+Hidden/);
  assert.match(source, /-RedirectStandardOutput\s+\$ServerOutLog/);
  assert.match(source, /-RedirectStandardError\s+\$ServerErrLog/);
  assert.doesNotMatch(source, /&\s*\$NodeExecutable\s+\$ServerScript/);
});

describe(
  "installed scheduled task lifecycle",
  { skip: process.platform !== "win32" ? "Windows Task Scheduler is required" : false },
  () => {
    const fixture = {};

    before(async () => {
      fixture.port = await reservePort();
      fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), "a-share-local-service-test-"));
      fixture.taskName = `A-Share-Local-Service-Test-${process.pid}-${Date.now()}`;
      fixture.url = `http://127.0.0.1:${fixture.port}/`;

      const keeper = read("local-service-keeper.ps1").replace(
        /\$Port\s*=\s*5173/,
        `$Port = ${fixture.port}`,
      );
      assert.match(keeper, new RegExp(`\\$Port\\s*=\\s*${fixture.port}`));

      fs.copyFileSync(
        path.join(ROOT, "install-local-service-autostart.ps1"),
        path.join(fixture.root, "install-local-service-autostart.ps1"),
      );
      fs.writeFileSync(path.join(fixture.root, "local-service-keeper.ps1"), keeper, "utf8");
      fs.writeFileSync(
        path.join(fixture.root, "server.js"),
        [
          '"use strict";',
          'const http = require("node:http");',
          `const port = ${fixture.port};`,
          "const server = http.createServer((_request, response) => {",
          '  response.writeHead(200, { "content-type": "application/json" });',
          "  response.end(JSON.stringify({ pid: process.pid }));",
          "});",
          'setInterval(() => console.error("recoverable fixture warning"), 250);',
          'server.listen(port, "127.0.0.1");',
          "",
        ].join("\n"),
        "utf8",
      );

      runPowerShell(
        `& ${quotePowerShellLiteral(path.join(fixture.root, "install-local-service-autostart.ps1"))} ` +
          `-TaskName ${quotePowerShellLiteral(fixture.taskName)} | Out-Null`,
      );
    });

    after(async () => {
      if (fixture.taskName) {
        runPowerShell(
          `$task = Get-ScheduledTask -TaskName ${quotePowerShellLiteral(fixture.taskName)} -ErrorAction SilentlyContinue; ` +
            "if ($null -ne $task) { " +
            `Stop-ScheduledTask -TaskName ${quotePowerShellLiteral(fixture.taskName)} -ErrorAction SilentlyContinue; ` +
            `Unregister-ScheduledTask -TaskName ${quotePowerShellLiteral(fixture.taskName)} -Confirm:$false ` +
            "}",
          { allowFailure: true },
        );
      }
      if (fixture.port) {
        runPowerShell(
          `$owners = Get-NetTCPConnection -LocalPort ${fixture.port} -State Listen -ErrorAction SilentlyContinue | ` +
            "Select-Object -ExpandProperty OwningProcess -Unique; " +
            "foreach ($ownerPid in $owners) { Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue }; " +
            "foreach ($ownerPid in $owners) { Wait-Process -Id $ownerPid -Timeout 5 -ErrorAction SilentlyContinue }",
          { allowFailure: true },
        );
      }
      if (fixture.root && path.dirname(fixture.root) === os.tmpdir()) {
        await delay(500);
        try {
          fs.rmSync(fixture.root, { force: true, maxRetries: 10, recursive: true, retryDelay: 300 });
        } catch (error) {
          process.stderr.write(`warning: could not remove test fixture ${fixture.root}: ${error.message}\n`);
        }
      }
    });

    test("exported task XML sets StopOnIdleEnd=false", () => {
      const stopOnIdleEnd = runPowerShell(
        `[xml]$taskXml = Export-ScheduledTask -TaskName ${quotePowerShellLiteral(fixture.taskName)}; ` +
          "$taskXml.Task.Settings.IdleSettings.StopOnIdleEnd",
      );

      assert.equal(
        stopOnIdleEnd.toLowerCase(),
        "false",
        "the registered task must remain running when Windows exits the idle state",
      );
    });

    test("exported task XML uses only the logon trigger and retains failure retries", () => {
      const triggerJson = runPowerShell(
        `[xml]$taskXml = Export-ScheduledTask -TaskName ${quotePowerShellLiteral(fixture.taskName)}; ` +
          "$triggers = @($taskXml.Task.Triggers.ChildNodes); " +
          "[pscustomobject]@{ " +
          "Count = $triggers.Count; " +
          "HasLogonTrigger = $null -ne $taskXml.Task.Triggers.LogonTrigger; " +
          "HasTimeTrigger = $null -ne $taskXml.Task.Triggers.TimeTrigger; " +
          "RestartCount = [int]$taskXml.Task.Settings.RestartOnFailure.Count; " +
          "RestartInterval = [string]$taskXml.Task.Settings.RestartOnFailure.Interval " +
          "} | ConvertTo-Json -Compress",
      );
      const triggers = JSON.parse(triggerJson);

      assert.equal(triggers.Count, 1);
      assert.equal(triggers.HasLogonTrigger, true);
      assert.equal(triggers.HasTimeTrigger, false);
      assert.equal(triggers.RestartCount, 10);
      assert.equal(triggers.RestartInterval, "PT1M");
    });

    test("starting the task makes the service root return HTTP 200", { timeout: 25_000 }, async () => {
      const payload = await waitForServer(fixture.url);
      assert.ok(Number.isInteger(payload.pid) && payload.pid > 0);
    });

    test("recoverable stderr output does not terminate the Node service", { timeout: 25_000 }, async () => {
      const first = await waitForServer(fixture.url);
      await delay(1_500);
      const second = await waitForServer(fixture.url);
      assert.equal(second.pid, first.pid);
      const stderrLog = fs.readFileSync(path.join(fixture.root, "output", "local-service-server.err.log"), "utf8");
      assert.match(stderrLog, /recoverable fixture warning/);
    });

    test("stopping and starting the task restores the service", { timeout: 35_000 }, async () => {
      const beforeStop = await waitForServer(fixture.url);
      runPowerShell(`Stop-ScheduledTask -TaskName ${quotePowerShellLiteral(fixture.taskName)}`);
      process.kill(beforeStop.pid);
      await waitForServerStop(fixture.url);

      runPowerShell(`Start-ScheduledTask -TaskName ${quotePowerShellLiteral(fixture.taskName)}`);
      const payload = await waitForServer(fixture.url, ({ pid }) => pid !== beforeStop.pid);
      assert.ok(Number.isInteger(payload.pid) && payload.pid > 0);
    });

    test("keeper restarts the Node service after an abnormal exit", { timeout: 35_000 }, async () => {
      const first = await waitForServer(fixture.url);
      process.kill(first.pid);

      const restarted = await waitForServer(fixture.url, ({ pid }) => pid !== first.pid);
      assert.notEqual(restarted.pid, first.pid);

      const keeperLog = fs.readFileSync(
        path.join(fixture.root, "output", "local-service-keeper.log"),
        "utf8",
      );
      assert.match(keeperLog, /server exited with code=/);
      assert.match(keeperLog, /starting server\.js/);
    });
  },
);
