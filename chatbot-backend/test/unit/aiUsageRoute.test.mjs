import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";

// Route-level contract test. No Gemini keys are set in the test env → the
// pool is empty and the endpoint honestly reports evidence_only.
process.env.FEATURE_V2_AI_USAGE_METER = "1";
process.env.JWT_SECRET = "route-test-secret";

const { default: aiUsageRouter } = await import("../../src/routes/aiUsage.js");

let base;
let server;
before(async () => {
  const app = express();
  app.use("/api/v2/ai/usage", aiUsageRouter);
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  server?.close();
  const { _resetLlmForTests } = await import("../../src/llm/index.js");
  await _resetLlmForTests();
});

const token = (payload) => jwt.sign(payload, "route-test-secret");

test("usage endpoint requires a JWT", async () => {
  const res = await fetch(`${base}/api/v2/ai/usage`);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, "UNAUTHENTICATED");
});

test("usage endpoint returns contract shape for a signed-in user", async () => {
  const res = await fetch(`${base}/api/v2/ai/usage`, {
    headers: { authorization: `Bearer ${token({ id: "u1", role: "ap_clerk" })}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, "evidence_only"); // no keys in test env
  assert.ok(Array.isArray(body.models));
  assert.deepEqual(body.keys, { total: 0, active: 0, cooling: 0, exhausted: 0, invalid: 0 });
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(body.resetsAt));
  assert.equal(body.currentKeyAlias, undefined);
});

test("flag off → 404", async () => {
  process.env.FEATURE_V2_AI_USAGE_METER = "0";
  const res = await fetch(`${base}/api/v2/ai/usage`, {
    headers: { authorization: `Bearer ${token({ id: "u1", role: "ap_clerk" })}` },
  });
  assert.equal(res.status, 404);
  process.env.FEATURE_V2_AI_USAGE_METER = "1";
});
