import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.SERVER_URL || "http://localhost:5002";

const login = async (email, password) => {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `login failed for ${email}`);
  return (await response.json()).token;
};

test("public signup cannot self-assign an analyst role", async () => {
  const response = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Unauthorized Analyst", email: `analyst-escalation-${Date.now()}@example.test`, password: "SecurePass123!", role: "analyst", institutionId: 0 }),
  });
  assert.equal(response.status, 403);
});

test("unauthenticated requests are rejected", async () => {
  for (const path of ["/api/consent/me", "/api/audit", "/api/risk-graph/overview"]) {
    const response = await fetch(`${BASE}${path}`);
    assert.equal(response.status, 401, `${path} should require auth`);
  }
});

test("citizen role cannot reach analyst-only endpoints", async () => {
  const token = await login("citizen@arthsaathi.demo", "Citizen@123");
  const response = await fetch(`${BASE}/api/risk-graph/overview`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 403);
});

test("graph endpoints reject anonymous access", async () => {
  for (const path of ["/api/graph", "/api/graph/stream", "/api/risk-graph/meta", "/api/risk-graph/campaigns"]) {
    const response = await fetch(`${BASE}${path}`);
    assert.equal(response.status, 401, `${path} should require auth`);
  }
  const search = await fetch(`${BASE}/api/graph/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ term: "x" }),
  });
  assert.equal(search.status, 401);
});

test("citizens cannot reach any graph surface", async () => {
  const token = await login("citizen@arthsaathi.demo", "Citizen@123");
  const headers = { authorization: `Bearer ${token}` };
  for (const path of ["/api/graph", "/api/graph/stream", "/api/risk-graph/meta", "/api/risk-graph/campaigns", "/api/risk-graph/account/C1/neighbors"]) {
    const response = await fetch(`${BASE}${path}`, { headers });
    assert.equal(response.status, 403, `${path} should be analyst-only`);
  }
});

test("consent revoke persists and re-grant restores it", async (t) => {
  const token = await login("citizen@arthsaathi.demo", "Citizen@123");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  let response = await fetch(`${BASE}/api/consent`, {
    method: "POST",
    headers,
    body: JSON.stringify({ purpose: "risk_scoring", granted: false }),
  });
  assert.equal(response.status, 201);
  // The gateway enforces consent before calling the ML service — verified via
  // the chatbot backend; here we assert the persisted state flips.
  let me = await (await fetch(`${BASE}/api/consent/me`, { headers })).json();
  assert.equal(me.purposes.risk_scoring, false);

  response = await fetch(`${BASE}/api/consent`, {
    method: "POST",
    headers,
    body: JSON.stringify({ purpose: "risk_scoring", granted: true }),
  });
  assert.equal(response.status, 201);
  me = await (await fetch(`${BASE}/api/consent/me`, { headers })).json();
  assert.equal(me.purposes.risk_scoring, true);
});

test("citizen conversations persist in the authoritative store", async () => {
  const token = await login("citizen@arthsaathi.demo", "Citizen@123");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  let response = await fetch(`${BASE}/api/conversations`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Explain my score" }),
  });
  assert.equal(response.status, 201);
  const conversation = await response.json();
  assert.equal(conversation.mode, "risk_citizen");
  response = await fetch(`${BASE}/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ messages: [{ role: "user", content: "What does percentile mean?" }, { role: "model", content: "It is a relative rank." }] }),
  });
  assert.equal(response.status, 201);
  const stored = await (await fetch(`${BASE}/api/conversations/${conversation.id}`, { headers })).json();
  assert.equal(stored.messages.length, 2);
  assert.equal(stored.messages[0].content, "What does percentile mean?");
  response = await fetch(`${BASE}/api/conversations/${conversation.id}`, { method: "DELETE", headers });
  assert.equal(response.status, 200);
});

test("export returns consent history and audit trail", async () => {
  const token = await login("citizen@arthsaathi.demo", "Citizen@123");
  const response = await fetch(`${BASE}/api/consent/export`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  const bundle = await response.json();
  assert.ok(bundle.subject);
  assert.ok(Array.isArray(bundle.consent_history));
  assert.ok(Array.isArray(bundle.audit_entries));
});
