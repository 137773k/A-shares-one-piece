const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const chromePaths = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const outFile = process.argv[2] || path.join(__dirname, ".eastmoney-market.json");
const debugFile = path.join(path.dirname(outFile), ".eastmoney-debug.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function parseMarketSnapshot(payload) {
  const text = String(payload?.text || "");
  const html = String(payload?.html || "");
  const combined = `${text}\n${html}`;
  const amountMatch =
    combined.match(/两市成交额\s*([\d.]+)\s*万亿/) ||
    combined.match(/两市成交额\s*([\d.]+)\s*亿/) ||
    combined.match(/成交额\s*([\d.]+)\s*万亿/) ||
    combined.match(/成交额\s*([\d.]+)\s*亿/);
  const amountYi = amountMatch
    ? combined.includes("万亿")
      ? Math.round(Number(amountMatch[1]) * 10000 * 100) / 100
      : Math.round(Number(amountMatch[1]) * 100) / 100
    : 0;
  const upDownText = text.match(/上涨\s*(\d+)\s*盘整\s*(\d+)\s*下跌\s*(\d+)/) || combined.match(/"OptionTitle":"上涨","OptionCounter":(\d+).*?"OptionTitle":"盘整","OptionCounter":(\d+).*?"OptionTitle":"下跌","OptionCounter":(\d+)/s);
  const upCount = upDownText ? Number(upDownText[1]) : 0;
  const flatCount = upDownText ? Number(upDownText[2]) : 0;
  const downCount = upDownText ? Number(upDownText[3]) : 0;
  if (!amountYi) return null;
  return {
    source: "eastmoney-page",
    shszAmountYi: amountYi,
    totalAmountYi: amountYi,
    upCount,
    downCount,
    flatCount,
    breadth: upCount + downCount ? upCount / (upCount + downCount) : 0.5,
    rawText: text,
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  const chromePath = chromePaths.find((candidate) => fs.existsSync(candidate));
  if (!chromePath) throw new Error("browser_not_found");

  const profileDir = path.join(os.tmpdir(), "eastmoney-fetcher-profile");
  fs.mkdirSync(profileDir, { recursive: true });
  const port = 9555;
  const browser = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--remote-debugging-port=" + port,
      "--user-data-dir=" + profileDir,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );

  try {
    for (let i = 0; i < 60; i += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (response.ok) break;
      } catch {}
      await sleep(200);
    }

    const listResponse = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await listResponse.json();
    const pageTarget = targets.find((target) => target.type === "page") || targets[0];
    if (!pageTarget || !pageTarget.webSocketDebuggerUrl) throw new Error("browser_target_missing");

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.on("message", (buffer) => {
      const message = JSON.parse(buffer.toString("utf8"));
      if (!message.id || !pending.has(message.id)) return;
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(message.error.message || "cdp_error"));
        return;
      }
      entry.resolve(message.result);
    });

    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const messageId = ++id;
        pending.set(messageId, { resolve, reject });
        ws.send(JSON.stringify({ id: messageId, method, params }));
      });

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Page.navigate", { url: "https://stock.eastmoney.com/shichang.html" });
    await sleep(15000);

    const payloadResult = await send("Runtime.evaluate", {
      expression: `(() => {
        const text = document.body ? document.body.innerText : "";
        const html = document.body ? document.body.innerHTML : "";
        return {
          text,
          html,
          href: location.href,
          resources: performance.getEntriesByType("resource").map((item) => item.name).filter((name) => name.includes("push2") || name.includes("eastmoney") || name.includes("vote")).slice(0, 200)
        };
      })()`,
      returnByValue: true,
    });

    const payload = payloadResult.result.value || {};
    fs.writeFileSync(debugFile, JSON.stringify(payload, null, 2), "utf8");

    const parsed = parseMarketSnapshot(payload);
    if (!parsed) {
      const fallback = readJson(outFile);
      if (fallback) {
        fs.writeFileSync(outFile, JSON.stringify({ ...fallback, stale: true, fetchError: "parse_failed" }, null, 2), "utf8");
        process.stdout.write(JSON.stringify({ ok: true, outFile, parsed: fallback, stale: true }, null, 2));
        await ws.close();
        return;
      }
      throw new Error("parse_failed");
    }

    fs.writeFileSync(outFile, JSON.stringify(parsed, null, 2), "utf8");
    process.stdout.write(JSON.stringify({ ok: true, outFile, parsed }, null, 2));
    await ws.close();
  } finally {
    try {
      browser.kill("SIGKILL");
    } catch {}
  }
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exit(1);
});
