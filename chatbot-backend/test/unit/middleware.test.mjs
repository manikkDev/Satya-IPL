import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { rateLimit, userKey } from "../../src/middleware/rateLimit.js";
import { requireInternalToken } from "../../src/middleware/internalToken.js";
import { requestId } from "../../src/middleware/requestId.js";

let server;
let base;

before(async () => {
  process.env.NODE_INTERNAL_TOKEN = "int-secret";
  const app = express();
  app.use(requestId);
  app.get("/limited", rateLimit({ max: 3, keyFn: userKey }), (_req, res) => res.json({ ok: true }));
  app.get("/internal", requireInternalToken, (_req, res) => res.json({ ok: true }));
  app.get("/echo", (req, res) => res.json({ id: req.id }));
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => server?.close());

const auth = { authorization: "Bearer test-user-token" };

test("rate limiter allows up to max then 429s with contract shape", async () => {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${base}/limited`, { headers: auth });
    assert.equal(res.status, 200);
  }
  const blocked = await fetch(`${base}/limited`, { headers: auth });
  assert.equal(blocked.status, 429);
  const body = await blocked.json();
  assert.equal(body.error.code, "RATE_LIMITED");
  assert.ok(body.error.details.retryAfterMs > 0);
  assert.ok(blocked.headers.get("retry-after"));
});

test("different users get independent buckets", async () => {
  const res = await fetch(`${base}/limited`, { headers: { authorization: "Bearer other-user" } });
  assert.equal(res.status, 200);
});

test("internal token middleware rejects missing/wrong token, accepts correct", async () => {
  assert.equal((await fetch(`${base}/internal`)).status, 403);
  assert.equal((await fetch(`${base}/internal`, { headers: { "x-internal-token": "wrong" } })).status, 403);
  const res = await fetch(`${base}/internal`, { headers: { "x-internal-token": "int-secret" } });
  assert.equal(res.status, 200);
});

test("request id is generated and echoed; sane inbound ids are preserved", async () => {
  const res = await fetch(`${base}/echo`);
  const body = await res.json();
  assert.ok(/^[0-9a-f-]{36}$/.test(body.id));
  assert.equal(res.headers.get("x-request-id"), body.id);
  const res2 = await fetch(`${base}/echo`, { headers: { "x-request-id": "client-req-abc123" } });
  assert.equal((await res2.json()).id, "client-req-abc123");
});
