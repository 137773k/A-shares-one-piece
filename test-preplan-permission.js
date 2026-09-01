"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { createPreplanHandler, loadPlans } = require("./preplan");

function request(handler, body) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = "POST";
  let status = 0;
  let raw = "";
  const res = {
    writeHead(value) { status = value; },
    end(value) { raw = String(value || ""); },
  };
  return handler(req, res, "/api/preplan/add").then(() => ({
    status,
    payload: raw ? JSON.parse(raw) : {},
  }));
}

function tempFile(name) {
  return path.join(os.tmpdir(), `asking-${name}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
}

test("preplan add only accepts the exact code in the current executable plan", async (t) => {
  const file = tempFile("preplan-permission");
  t.after(() => { try { fs.unlinkSync(file); } catch {} });
  const handler = createPreplanHandler({
    file,
    authorizePlanCode: (code) => code === "ALLOW001",
  });

  const denied = await request(handler, {
    code: "BLOCK002",
    planDate: "2099-08-12",
    logicA: "manual bypass",
    dualLogic: false,
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.payload.ok, false);
  assert.equal(loadPlans(file).length, 0);

  const allowed = await request(handler, {
    code: "ALLOW001",
    name: "Allowed",
    planDate: "2099-08-12",
    logicA: "canonical plan",
    dualLogic: false,
    yesterdayStrength: "strong",
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.payload.ok, true);
  assert.deepEqual(loadPlans(file).map((plan) => plan.code), ["ALLOW001"]);
});

test("missing or failed canonical authorization fails closed", async (t) => {
  for (const [name, authorizePlanCode] of [
    ["missing", undefined],
    ["throws", () => { throw new Error("model unavailable"); }],
  ]) {
    const file = tempFile(`preplan-${name}`);
    t.after(() => { try { fs.unlinkSync(file); } catch {} });
    const handler = createPreplanHandler({ file, authorizePlanCode });
    const result = await request(handler, {
      code: "ALLOW001",
      planDate: "2099-08-12",
      logicA: "must not persist",
      dualLogic: false,
    });
    assert.equal(result.status, 403, name);
    assert.equal(loadPlans(file).length, 0, name);
  }
});

test("server wires preplan authorization to the current canonical flow", () => {
  const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  assert.match(source, /function isCurrentExecutablePreplanCode\(code\)/);
  assert.match(source, /const flow = buildPremarketFlow\(payload\)/);
  assert.match(source, /tradePlan\.status === "ready"/);
  assert.match(source, /tradePlan\.canIssueAdvice === true/);
  assert.match(source, /authorizePlanCode: isCurrentExecutablePreplanCode/);
});
