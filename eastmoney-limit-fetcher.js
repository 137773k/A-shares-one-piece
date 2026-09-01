// 浏览器抓取涨跌停数据：用无头 Chrome 打开东财涨停板页，在页面内用 JSONP 调东财自己的接口，
// 走真实浏览器会话 + 东财页面同款取数方式，规避服务端直连被 IP 限流的问题。
// 输出 JSON：{ ztToday, dtToday, ztPrev, ztPrev2, dates }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 在页面上下文里执行的取数逻辑（JSONP，和东财涨停板页同款）
const PAGE_SCRIPT = `(async () => {
  const ut = "7eea3edcaed734bea9cbfc24409ed989";
  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cb = "__cb" + Math.random().toString(36).slice(2);
      const s = document.createElement("script");
      const timer = setTimeout(() => { cleanup(); reject(new Error("timeout")); }, 9000);
      function cleanup(){ clearTimeout(timer); try{ delete window[cb]; }catch(e){} if (s.parentNode) s.parentNode.removeChild(s); }
      window[cb] = (data) => { cleanup(); resolve(data); };
      s.onerror = () => { cleanup(); reject(new Error("script_error")); };
      s.src = url + (url.indexOf("?") >= 0 ? "&" : "?") + "cb=" + cb;
      document.body.appendChild(s);
    });
  }
  function ymd(d){ return d.getFullYear() + String(d.getMonth()+1).padStart(2,"0") + String(d.getDate()).padStart(2,"0"); }
  function priorDays(qd, n){
    const out=[]; const d=new Date(Number(qd.slice(0,4)), Number(qd.slice(4,6))-1, Number(qd.slice(6,8)));
    while(out.length<n){ d.setDate(d.getDate()-1); const w=d.getDay(); if(w!==0 && w!==6) out.push(ymd(d)); }
    return out;
  }
  async function zt(date){
    try{
      const r = await jsonp("https://push2ex.eastmoney.com/getTopicZTPool?ut="+ut+"&dpt=wz.ztzt&Pageindex=0&pagesize=10&sort=fbt:asc&date="+date);
      if (r && r.data) return { tc: Number(r.data.tc||0), qdate: String(r.data.qdate||date) };
    }catch(e){}
    return { tc: 0, qdate: date };
  }
  // 沪深京（含北交所）精确封板判定，与东财牛熊风向标同口径
  function isLU(code, name, pct){
    if (/ST|退|摘/.test(name)) return pct>=4.8 && pct<=5.6;
    if (/^(8|4|92|43|83|87)/.test(code)) return pct>=29.4;
    if (/^(30|68)/.test(code)) return pct>=19.5;
    return pct>=9.7 && pct<=10.6;
  }
  function isLD(code, name, pct){
    if (/ST|退|摘/.test(name)) return pct<=-4.8 && pct>=-5.6;
    if (/^(8|4|92|43|83|87)/.test(code)) return pct<=-29.4;
    if (/^(30|68)/.test(code)) return pct<=-19.5;
    return pct<=-9.7 && pct>=-10.6;
  }
  const FS = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048"; // 沪深京
  async function clist(po, pn){
    const r = await jsonp("https://push2.eastmoney.com/api/qt/clist/get?ut=bd1d9ddb04089700cf9c27f6f7426281&fs="+FS+"&pn="+pn+"&pz=100&po="+po+"&fid=f3&fltt=2&invt=2&fields=f3,f12,f14");
    return Object.values((r.data && r.data.diff) || {});
  }
  // 封涨停：按涨幅降序取顶部
  let up = 0, upOk = false;
  for (const pn of [1,2,3]){
    try{ const d = await clist(1, pn); if (d.length) upOk = true; let h=0; for (const x of d){ if (isLU(String(x.f12||""), String(x.f14||""), Number(x.f3||0))){ up++; h++; } } if (d.length<100 || (h===0 && Number(d[d.length-1] && d[d.length-1].f3) < 9)) break; }catch(e){}
  }
  // 封跌停：按涨幅升序取底部
  let dn = 0, dnOk = false;
  for (const pn of [1,2,3]){
    try{ const d = await clist(0, pn); if (d.length) dnOk = true; let h=0; for (const x of d){ if (isLD(String(x.f12||""), String(x.f14||""), Number(x.f3||0))){ dn++; h++; } } if (d.length<100 || (h===0 && Number(d[d.length-1] && d[d.length-1].f3) > -9)) break; }catch(e){}
  }
  const probe = await zt(ymd(new Date()));
  const pri = priorDays(probe.qdate, 2);
  const z1 = await zt(pri[0]);
  const z2 = await zt(pri[1]);
  return { ztToday: upOk ? up : probe.tc, dtToday: dnOk ? dn : null, ztPrev: z1.tc, ztPrev2: z2.tc, scope: "沪深京", dates: { today: probe.qdate, prev: pri[0], prev2: pri[1] } };
})()`;

async function main() {
  const chromePath = chromePaths.find((candidate) => fs.existsSync(candidate));
  if (!chromePath) throw new Error("browser_not_found");

  const profileDir = path.join(os.tmpdir(), "eastmoney-limit-profile");
  fs.mkdirSync(profileDir, { recursive: true });
  const port = 9556;
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
      if (message.error) entry.reject(new Error(message.error.message || "cdp_error"));
      else entry.resolve(message.result);
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
    await send("Page.navigate", { url: "https://quote.eastmoney.com/ztb/" });
    await sleep(6000); // 等页面建立东财会话

    const result = await send("Runtime.evaluate", {
      expression: PAGE_SCRIPT,
      returnByValue: true,
      awaitPromise: true,
    });

    const value = result.result && result.result.value;
    if (!value || typeof value.ztToday !== "number") throw new Error("no_value");
    process.stdout.write(JSON.stringify(value));
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
