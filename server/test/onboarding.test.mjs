// First-run setup routes (routes/v2/onboarding.js), exercised in-process
// against a throwaway database on MONGO_TEST_URI. Mounts the routers the way
// v2/index.js is expected to: publicRouter at /api/v2/auth (before auth), the
// default router at /api/v2/onboarding (after authenticateV2 + loadScope).
// Skipped when Mongo is unreachable so `npm test` stays usable offline.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import express from "express";

process.env.JWT_SECRET ||= "onboarding-test-secret";
process.env.RATE_LIMIT_AUTH ||= "1000";

const URI = process.env.MONGO_TEST_URI || "mongodb://localhost:27017";
const DB = `satya_onboarding_${process.pid}`;
let up = false;
let server;
let base;

before(async () => {
  try {
    await mongoose.connect(URI, { dbName: DB, serverSelectionTimeoutMS: 2000 });
    up = true;
  } catch { up = false; return; }
  const { default: onboarding, publicRouter } = await import("../src/routes/v2/onboarding.js");
  const { authenticateV2, loadScope } = await import("../src/auth/middleware.js");
  const { default: authRoutes } = await import("../src/routes/v2/auth.js");
  const app = express();
  app.use(express.json());
  app.use("/api/v2/auth", authRoutes);
  app.use("/api/v2/auth", publicRouter);
  app.use("/api/v2", authenticateV2, loadScope);
  app.use("/api/v2/onboarding", onboarding);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (up) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
});

const call = async (path, { token, body, method } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: method || (body !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await response.json(); } catch { /* empty */ }
  return { status: response.status, data };
};

const GSTIN_OK = "27AAPFU0939F1ZV";
const GSTIN_BAD_CHECKSUM = "27AAPFU0939F1ZA";

test("onboarding: new workspace → company → invite → accept", async (t) => {
  if (!up) return t.skip("mongo unavailable");

  const signup = await call("/api/v2/auth/signup", {
    body: { name: "Asha Rao", email: "asha@example.test", password: "a-strong-pass-42", groupName: "Rao Pumps", entityCode: "RAO" },
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.data));
  const owner = signup.data.token;

  await t.test("status starts empty and marks the workspace as new", async () => {
    const { status, data } = await call("/api/v2/onboarding/status", { token: owner });
    assert.equal(status, 200);
    assert.equal(data.isNew, true);
    assert.equal(data.completed, 0);
    assert.equal(data.total, 4);
    assert.equal(data.steps.company.done, false);
    assert.equal(data.canManage, true);
    assert.equal(data.canInvite, true);
  });

  await t.test("anonymous callers are rejected", async () => {
    assert.equal((await call("/api/v2/onboarding/status")).status, 401);
  });

  await t.test("company: GSTIN checksum and format are validated", async () => {
    const bad = await call("/api/v2/onboarding/company", { token: owner, method: "PATCH", body: { legalName: "Rao Pumps Pvt Ltd", gstin: GSTIN_BAD_CHECKSUM } });
    assert.equal(bad.status, 422);
    assert.match(bad.data.error.message, /doesn't match/);
    const shape = await call("/api/v2/onboarding/company", { token: owner, method: "PATCH", body: { legalName: "Rao Pumps Pvt Ltd", gstin: "NOTAGSTIN" } });
    assert.equal(shape.status, 422);
    const extra = await call("/api/v2/onboarding/company", { token: owner, method: "PATCH", body: { legalName: "Rao Pumps", gstin: GSTIN_OK, groupId: "x" } });
    assert.equal(extra.status, 422, "unknown keys are rejected");
  });

  await t.test("company: a valid GSTIN sets state + PAN and completes the step", async () => {
    const ok = await call("/api/v2/onboarding/company", {
      token: owner, method: "PATCH",
      body: { legalName: "Rao Pumps Pvt Ltd", gstin: GSTIN_OK.toLowerCase(), address: { line1: "Plot 4, MIDC Bhosari", city: "Pune", pin: "411026" } },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.entity.gstin, GSTIN_OK);
    assert.equal(ok.data.entity.stateCode, "27");
    assert.equal(ok.data.entity.stateName, "Maharashtra");
    assert.equal(ok.data.entity.pan, "AAPFU0939F");
    assert.equal(ok.data.entity.address.city, "Pune");
    const { data } = await call("/api/v2/onboarding/status", { token: owner });
    assert.equal(data.steps.company.done, true);
    assert.equal(data.completed, 1);
  });

  let inviteToken;
  await t.test("invites: roles are validated, platform_admin is never grantable", async () => {
    const bad = await call("/api/v2/onboarding/invites", { token: owner, body: { email: "x@example.test", role: "platform_admin" } });
    assert.equal(bad.status, 422);
    const ok = await call("/api/v2/onboarding/invites", { token: owner, body: { email: "Ravi@Example.test", role: "ap_manager" } });
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    assert.equal(ok.data.invite.email, "ravi@example.test");
    assert.match(ok.data.joinPath, /^\/signup\?invite=/);
    inviteToken = ok.data.token;
    const list = await call("/api/v2/onboarding/invites", { token: owner });
    assert.equal(list.data.invites.length, 1);
    assert.equal(list.data.members.length, 1);
    const { data } = await call("/api/v2/onboarding/status", { token: owner });
    assert.equal(data.steps.team.done, true, "a pending invite counts as inviting the team");
  });

  await t.test("invite lookup is public and reveals no token material", async () => {
    const { status, data } = await call(`/api/v2/auth/invites/${inviteToken}`);
    assert.equal(status, 200);
    assert.equal(data.email, "ravi@example.test");
    assert.equal(data.groupName, "Rao Pumps");
    assert.equal(data.hasAccount, false);
    assert.equal(data.tokenHash, undefined);
    assert.equal((await call("/api/v2/auth/invites/not-a-real-token-at-all-xyz")).status, 404);
  });

  await t.test("accept creates the account with the invited role, once", async () => {
    const weak = await call("/api/v2/auth/accept-invite", { body: { token: inviteToken, name: "Ravi", password: "short" } });
    assert.equal(weak.status, 422);
    const ok = await call("/api/v2/auth/accept-invite", { body: { token: inviteToken, name: "Ravi Kulkarni", password: "another-strong-1" } });
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    assert.ok(ok.data.token);
    assert.deepEqual(ok.data.memberships[0].roles, ["ap_manager"]);
    const again = await call("/api/v2/auth/accept-invite", { body: { token: inviteToken, name: "Ravi Kulkarni", password: "another-strong-1" } });
    assert.equal(again.status, 404, "single use");
    // the invitee is a manager, not an admin: no team management
    const me = await call("/api/v2/onboarding/status", { token: ok.data.token });
    assert.equal(me.status, 200);
    assert.equal(me.data.canInvite, false);
    assert.equal((await call("/api/v2/onboarding/invites", { token: ok.data.token })).status, 403);
    const { data } = await call("/api/v2/onboarding/status", { token: owner });
    assert.equal(data.steps.team.members, 2);
  });

  await t.test("re-inviting an existing member is a conflict", async () => {
    const { status } = await call("/api/v2/onboarding/invites", { token: owner, body: { email: "ravi@example.test", role: "auditor" } });
    assert.equal(status, 409);
  });

  await t.test("revoked invites cannot be accepted", async () => {
    const created = await call("/api/v2/onboarding/invites", { token: owner, body: { email: "meera@example.test", role: "auditor" } });
    assert.equal(created.status, 201);
    const revoked = await call(`/api/v2/onboarding/invites/${created.data.invite.id}`, { token: owner, method: "DELETE" });
    assert.equal(revoked.status, 200);
    const accept = await call("/api/v2/auth/accept-invite", { body: { token: created.data.token, name: "Meera", password: "meera-strong-pass" } });
    assert.equal(accept.status, 404);
  });

  await t.test("dismiss toggles the checklist flag", async () => {
    const off = await call("/api/v2/onboarding/dismiss", { token: owner, method: "PATCH", body: { dismissed: true } });
    assert.equal(off.status, 200);
    assert.ok(off.data.dismissedAt);
    const { data } = await call("/api/v2/onboarding/status", { token: owner });
    assert.ok(data.dismissedAt);
    const on = await call("/api/v2/onboarding/dismiss", { token: owner, method: "PATCH", body: { dismissed: false } });
    assert.equal(on.data.dismissedAt, null);
  });

  await t.test("a different workspace cannot see or touch these invites", async () => {
    const other = await call("/api/v2/auth/signup", {
      body: { name: "Other Owner", email: "other@example.test", password: "other-strong-pass", groupName: "Other Co" },
    });
    const list = await call("/api/v2/onboarding/invites", { token: other.data.token });
    assert.equal(list.status, 200);
    assert.equal(list.data.invites.length, 0);
    assert.equal(list.data.members.length, 1);
  });
});
