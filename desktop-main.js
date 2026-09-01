"use strict";

const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const PRODUCT_NAME = "A股短线模型";
const APP_ID = "com.ashare.tradingmodel";

let mainWindow = null;
let localUrl = "";
const startupLogFile = path.join(os.tmpdir(), "a-share-desktop-startup.log");

function logStage(message) {
  try {
    fs.appendFileSync(startupLogFile, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {}
}

function parsedUrl(value) {
  try {
    return new URL(String(value || ""));
  } catch {
    return null;
  }
}

function isTrustedLocalUrl(value, allowedBaseUrl) {
  const target = parsedUrl(value);
  const allowed = parsedUrl(allowedBaseUrl);
  return Boolean(target && allowed && target.origin === allowed.origin);
}

function openExternalHttps(value) {
  const target = parsedUrl(value);
  if (!target || target.protocol !== "https:") return false;
  shell.openExternal(target.toString()).catch(() => {});
  return true;
}

logStage(`main loaded: ${__dirname}`);
process.on("uncaughtException", (error) => logStage(`uncaughtException: ${error && error.stack ? error.stack : error}`));
process.on("unhandledRejection", (error) => logStage(`unhandledRejection: ${error && error.stack ? error.stack : error}`));

function canListen(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    // Match server.js (0.0.0.0) so a service already bound on any interface is detected.
    probe.listen(port, "0.0.0.0", () => {
      probe.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(start = 5173, attempts = 30) {
  for (let port = start; port < start + attempts; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error("未找到可用的本地端口（5173-5202）");
}

function copySeedData(sourceRoot, runtimeRoot) {
  fs.mkdirSync(runtimeRoot, { recursive: true });

  const sourceData = path.join(sourceRoot, "data");
  const runtimeData = path.join(runtimeRoot, "data");
  for (const directory of [runtimeData, path.join(runtimeData, "history"), path.join(runtimeData, "reports")]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.mkdirSync(path.join(runtimeData, "providers"), { recursive: true });

  const providerConfigExample = path.join(sourceRoot, "data-providers", "provider-config.example.json");
  const runtimeProviderConfigExample = path.join(runtimeData, "provider-config.example.json");
  if (fs.existsSync(providerConfigExample) && !fs.existsSync(runtimeProviderConfigExample)) {
    fs.copyFileSync(providerConfigExample, runtimeProviderConfigExample);
  }

  // Only seed current state. Historical cache trees are intentionally not copied
  // into every installation; the desktop app creates and retains its own history.
  for (const relativePath of ["core-watch.json", "evidence-cache.json", "preplans.json", "trade-journal.json"]) {
    const source = path.join(sourceData, relativePath);
    const target = path.join(runtimeData, relativePath);
    if (fs.existsSync(source) && !fs.existsSync(target)) fs.copyFileSync(source, target);
  }

  for (const fileName of [".hot-stocks-cache.json", ".eastmoney-market.json", ".cycle-state.json"]) {
    const source = path.join(sourceRoot, fileName);
    const target = path.join(runtimeRoot, fileName);
    if (fs.existsSync(source) && !fs.existsSync(target)) fs.copyFileSync(source, target);
  }
}

function waitForLocalServer(url, timeoutMs = 20000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      request.setTimeout(1500, () => request.destroy());
      request.on("error", retry);
    };

    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("本地数据服务启动超时"));
        return;
      }
      setTimeout(check, 250);
    };

    check();
  });
}

function installMenu(runtimeRoot) {
  const template = [
    {
      label: "软件",
      submenu: [
        {
          label: "打开数据目录",
          click: () => shell.openPath(runtimeRoot),
        },
        {
          label: "打开数据源目录",
          click: () => shell.openPath(path.join(runtimeRoot, "data", "providers")),
        },
        { type: "separator" },
        { role: "quit", label: "退出" },
      ],
    },
    {
      label: "页面",
      submenu: [
        { role: "reload", label: "刷新" },
        { role: "forceReload", label: "强制刷新" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "当前服务地址",
          click: () => dialog.showMessageBox({
            type: "info",
            title: PRODUCT_NAME,
            message: "本地服务正在运行",
            detail: localUrl,
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createDesktopApp() {
  logStage("createDesktopApp:start");
  const sourceRoot = __dirname;
  logStage("before app.getPath(userData)");
  const userDataRoot = app.getPath("userData");
  logStage(`userData root: ${userDataRoot}`);
  const runtimeRoot = path.join(userDataRoot, "runtime");
  logStage("before seed data");
  copySeedData(sourceRoot, runtimeRoot);
  logStage(`runtime ready: ${runtimeRoot}`);

  const port = await findAvailablePort();
  logStage(`port selected: ${port}`);
  process.env.PORT = String(port);
  process.env.A_SHARE_RUNTIME_DIR = runtimeRoot;
  process.env.ELECTRON_DESKTOP_APP = "1";

  const serverModule = require("./server.js");
  await serverModule.main();
  logStage("server module loaded");
  localUrl = `http://127.0.0.1:${port}/`;
  await waitForLocalServer(localUrl);
  logStage(`server ready: ${localUrl}`);

  installMenu(runtimeRoot);
  logStage("menu installed");

  mainWindow = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: "#f3f6f8",
    icon: path.join(__dirname, "expo-app", "assets", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  logStage("browser window created");

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedLocalUrl(url, localUrl)) mainWindow.loadURL(url).catch(() => {});
    else openExternalHttps(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedLocalUrl(url, localUrl)) {
      event.preventDefault();
      openExternalHttps(url);
    }
  });

  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.maximize();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(localUrl);
  logStage("page loaded");
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.setAppUserModelId(APP_ID);

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady()
    .then(createDesktopApp)
    .catch((error) => {
      logStage(`startup failed: ${error && error.stack ? error.stack : error}`);
      dialog.showErrorBox(`${PRODUCT_NAME}启动失败`, error && error.stack ? error.stack : String(error));
      app.quit();
    });

  app.on("window-all-closed", () => app.quit());
}
