import { test } from "node:test";
import assert from "node:assert/strict";

// Live ML linking + public model card (needs a running server with the
// matching/modelCard routes mounted, an engine with committed artifacts,
// and the demo seed). SERVER_URL defaults to the local docker stack.
const BASE = process.env.SERVER_URL || "http://localhost:5002";
const secret = process.env.DEMO_PASSWORD || "SatyaDemo@123";

const login = async (email) => {
  const r = await fetch(`${BASE}/api/v2/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: secret }) });
  return (await r.json()).token;
};
const call = (method, path, token, body) => fetch(`${BASE}${path}`, {
  method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

test("public model card has the documented shape", async () => {
  const r = await call("GET", "/api/v2/meta/model-card");
  assert.equal(r.status, 200);
  const card = await r.json();
  for (const key of ["generatedAt", "models", "allocation", "extraction", "anomaly", "copilot", "references"]) assert.ok(key in card, key);
  assert.equal(card.models.length, 3);
  for (const m of card.models) {
    for (const key of ["id", "task", "title", "version", "trainedAt", "algorithm", "baseline", "data", "operatingPoint", "metrics", "reliability", "coverageCurve", "confusion", "bySource", "explanations", "limitations", "intendedUse"]) assert.ok(key in m, `${m.task}.${key}`);
    for (const key of ["precision", "recall", "f1", "prAuc", "rocAuc", "brier", "ece", "ci"]) assert.ok(key in m.metrics, `${m.task}.metrics.${key}`);
    assert.ok(m.data.sources.every((s) => s.provenance), "every source carries provenance");
    assert.equal(m.operatingPoint.targetPrecision, 0.99);
  }
});

test("matching routes: auth, run, list, decide", async (t) => {
  assert.equal((await call("GET", "/api/v2/matching/suggestions")).status, 401);
  const manager = await login("manager@satya.demo");
  const auditor = await login("auditor@satya.demo");

  await t.test("run returns the autoLink contract", async () => {
    const r = await call("POST", "/api/v2/matching/run", manager, {});
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(typeof body.linksCreated, "number");
    assert.ok(Array.isArray(body.suggestions));
    for (const s of body.suggestions) {
      assert.ok(["auto", "review"].includes(s.zone));
      assert.ok(s.score >= 0 && s.score <= 1);
      assert.ok(Array.isArray(s.reasons));
    }
  });

  await t.test("list + validation", async () => {
    assert.equal((await call("GET", "/api/v2/matching/suggestions?status=bogus", manager)).status, 422);
    const r = await call("GET", "/api/v2/matching/suggestions?status=auto_linked&limit=5", manager);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body.items) && typeof body.counts === "object");
  });

  await t.test("auditor cannot decide; manager reject records a label", async () => {
    const list = await (await call("GET", "/api/v2/matching/suggestions?status=pending&limit=1", manager)).json();
    const auto = await (await call("GET", "/api/v2/matching/suggestions?status=auto_linked&limit=1", manager)).json();
    const target = list.items[0] || auto.items[0];
    if (!target) return; // nothing to rule on in this dataset
    assert.equal((await call("POST", `/api/v2/matching/suggestions/${target.id}/reject`, auditor, {})).status, 403);
    const r = await call("POST", `/api/v2/matching/suggestions/${target.id}/reject`, manager, { reason: "test: different order" });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).status, "rejected");
    assert.equal((await call("POST", `/api/v2/matching/suggestions/${target.id}/reject`, manager, {})).status, 409);
    const labels = await (await call("GET", "/api/v2/matching/labels", manager)).json();
    assert.ok(labels.items.some((l) => l.fromId === target.fromId && l.toId === target.toId && l.label === 0));
  });

  await t.test("supplier duplicates", async () => {
    const r = await call("GET", "/api/v2/matching/supplier-duplicates", manager);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body.clusters) && Array.isArray(body.possible));
  });
});
