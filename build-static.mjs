import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hotStocksPayload } from "./server.js";

const root = path.dirname(fileURLToPath(import.meta.url));

async function copyFile(name) {
  await fs.copyFile(path.join(root, name), path.join(root, "dist", name));
}

async function main() {
  await fs.rm(path.join(root, "dist"), { recursive: true, force: true });
  await fs.mkdir(path.join(root, "dist"), { recursive: true });

  const payload = await hotStocksPayload();
  if (payload.stale || payload.fetchError) {
    throw new Error(payload.fetchError || "hot stocks payload is stale");
  }
  await fs.writeFile(path.join(root, "dist", "data.json"), JSON.stringify(payload, null, 2), "utf8");

  for (const name of [
    "index.html",
    "favicon.ico",
    "sell-engine.js",
    "premarket-flow.js",
    "script.js",
    "styles.css",
    "ui-refresh.css",
  ]) {
    await copyFile(name);
  }

  const html = await fs.readFile(path.join(root, "dist", "index.html"), "utf8");
  const patched = html.replace(
    /<script src="\.\/script\.js(?:\?v=[^"]*)?"><\/script>/,
    '<script>window.PUBLIC_DATA_URL="./data.json?v=20260823-decision-v3";</script>\n    <script src="./script.js?v=20260823-decision-v3"></script>',
  );
  await fs.writeFile(path.join(root, "dist", "index.html"), patched, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
