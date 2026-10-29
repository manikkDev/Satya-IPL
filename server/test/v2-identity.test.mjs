import { test } from "node:test";
import assert from "node:assert/strict";

// v2 identity contract: hybrid sessions, groups/entities/memberships, RBAC
// matrix and scope isolation (04 P1-B2). Runs against the live local server.
const BASE = process.env.SERVER_URL || "http://localhost:5002";
const secret = process.env.DEMO_PASSWORD || "SatyaDemo@123";

const call = async (path, token, body, method = "POST") => {
  const response = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { method, body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await response.json(); } catch { /* non-JSON */ }
  return { response, data };
};

const decode = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());

test("v2 identity: hybrid sessions, memberships, RBAC and scope isolation", async (t) => {
  let managerToken;
  await t.test("v1 login now issues a hybrid token with v2 claims", async () => {
    const { response, data } = await call("/api/auth/login", null, { email: "manager@satya.demo", password: secret });
    assert.equal(response.status, 200);
    managerToken = data.token;
    const claims = decode(managerToken);
    assert.equal(claims.domain, "satya-business-v1");
    assert.ok(claims.sub?.startsWith("usr_"), "v2 sub claim");
    assert.ok(claims.gid?.startsWith("grp_"), "v2 gid claim");
    assert.ok(Array.isArray(claims.mem) && claims.mem.length > 0, "v2 memberships claim");
    assert.equal(typeof claims.tv, "number");
  });

  await t.test("v1 routes keep working with the hybrid token", async () => {
    const { response, data } = await call("/api/v1/cases", managerToken);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(data));
  });

  await t.test("v2 login returns memberships, groups and activeGroup", async () => {
    const { response, data } = await call("/api/v2/auth/login", null, { email: "manager@satya.demo", password: secret });
    assert.equal(response.status, 200);
    assert.ok(data.activeGroup.startsWith("grp_"));
    assert.ok(data.groups.some((g) => g.id === data.activeGroup));
    assert.ok(data.memberships.some((m) => m.roles.includes("ap_manager")));
  });

  await t.test("/me resolves scope and permissions from the role matrix", async () => {
    const { response, data } = await call("/api/v2/me", managerToken, undefined, "GET");
    assert.equal(response.status, 200);
    assert.ok(data.activeGroup.id.startsWith("grp_"));
    assert.ok(data.entities.length >= 1);
    const perms = data.permissions["*"] || [];
    for (const perm of ["finding.decide", "payment.release.maker", "audit.read"]) assert.ok(perms.includes(perm), `manager has ${perm}`);
    assert.ok(!perms.includes("grn.record"), "manager lacks stores permission");
  });

  await t.test("anonymous and invalid tokens are rejected on v2 routes", async () => {
    assert.equal((await call("/api/v2/me")).response.status, 401);
    const { data: bad } = await call("/api/v2/me", "not-a-token", undefined, "GET");
    assert.ok(bad.error);
  });

  await t.test("lazy migration maps legacy roles correctly", async () => {
    const { data: analyst } = await call("/api/v2/auth/login", null, { email: "analyst@satya.demo", password: secret });
    const roles = analyst.memberships.flatMap((m) => m.roles);
    assert.ok(roles.includes("buyer") && roles.includes("ap_clerk"), "ops_analyst -> buyer+ap_clerk");
    const { data: auditor } = await call("/api/v2/auth/login", null, { email: "auditor@satya.demo", password: secret });
    assert.deepEqual(auditor.memberships.flatMap((m) => m.roles), ["auditor"]);
  });

  await t.test("scope isolation: foreign group sees only its own entities", async () => {
    const { data: isolated } = await call("/api/v2/auth/login", null, { email: "isolated@satya.demo", password: secret });
    const { data: me } = await call("/api/v2/me", isolated.token, undefined, "GET");
    assert.notEqual(me.activeGroup.id, (await call("/api/v2/me", managerToken, undefined, "GET")).data.activeGroup.id);
    assert.equal(me.entities.length, 1, "isolated group has exactly its own entity");
  });

  await t.test("signup creates a trial group and rejects privilege escalation", async () => {
    const email = `trial-${Date.now()}@example.test`;
    const bad = await call("/api/v2/auth/signup", null, { name: "Escalator", email, password: "strongpass1!", groupName: "Esc Inc", role: "platform_admin" });
    assert.equal(bad.response.status, 422);
    const { response, data } = await call("/api/v2/auth/signup", null, { name: "Trial Owner", email, password: "strongpass1!", groupName: "Trial Industries", entityCode: "TRIL", stateCode: "27" });
    assert.equal(response.status, 201);
    assert.equal(data.entity.code, "TRIL");
    assert.ok(data.memberships[0].roles.includes("group_admin"));
    const me = await call("/api/v2/me", data.token, undefined, "GET");
    assert.equal(me.data.activeGroup.name, "Trial Industries");
    assert.equal(me.data.entities[0].code, "TRIL");
  });

  await t.test("signup enforces the password policy", async () => {
    const { response } = await call("/api/v2/auth/signup", null, { name: "Weak", email: `weak-${Date.now()}@example.test`, password: "short", groupName: "Weak Inc" });
    assert.equal(response.status, 422);
  });

  await t.test("switch-group requires membership and re-issues the session", async () => {
    const { response } = await call("/api/v2/auth/switch-group", managerToken, { groupId: "grp_nonexistent" });
    assert.equal(response.status, 403);
    const { response: ok, data } = await call("/api/v2/auth/switch-group", managerToken, {});
    assert.equal(ok.status, 422);
  });
});
