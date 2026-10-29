import { test } from "node:test";
import assert from "node:assert/strict";
import { gstinChecksum, validateGstin } from "../src/lib/gstin.js";
import { can, permissionsFor } from "../src/auth/rbac.js";
import { fyOf } from "../src/lib/fy.js";

// v2 masters contract: suppliers/items/entities/policies/HSN (04 P1-B3).
const BASE = process.env.SERVER_URL || "http://localhost:5002";
const secret = process.env.DEMO_PASSWORD || "SatyaDemo@123";

const call = async (path, token, body, method = body !== undefined ? "POST" : "GET") => {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await response.json(); } catch { /* non-JSON */ }
  return { response, data };
};

const v2login = async (email) => {
  const { response, data } = await call("/api/v2/auth/login", null, { email, password: secret });
  assert.equal(response.status, 200, `v2 login failed for ${email}`);
  return data.token;
};

const fictionalGstin = (state, pan, suffix = "1Z") => `${state}${pan}${suffix}${gstinChecksum(`${state}${pan}${suffix}`)}`;

test("v2 masters: libs, suppliers, items, entities, policies, HSN", async (t) => {
  await t.test("gstin lib mirrors the engine validator", () => {
    const gstin = fictionalGstin("27", "AAACV1234A");
    const check = validateGstin(gstin);
    assert.equal(check.wellFormed, true);
    assert.equal(check.checksumValid, true);
    assert.equal(check.stateCode, "27");
    assert.equal(check.panEmbedded, "AAACV1234A");
    assert.equal(validateGstin(`${gstin.slice(0, -1)}0`).checksumValid, false);
    assert.equal(validateGstin("99AAACV1234A1Z5").wellFormed, false); // 99 is not a registration state
  });

  await t.test("rbac matrix matches 01 section 8", () => {
    assert.equal(can("ap_manager", "finding.decide"), true);
    assert.equal(can("ap_manager", "grn.record"), false);
    assert.equal(can("stores", "grn.record"), true);
    assert.equal(can("auditor", "doc.upload"), false);
    assert.equal(can("auditor", "evidence.export"), true);
    assert.equal(can("group_admin", "supplier.bank.maker"), true);
    assert.equal(can("group_admin", "supplier.bank.checker"), false); // maker != checker
    assert.ok(permissionsFor(["buyer"]).includes("po.create"));
  });

  await t.test("fyOf computes April-start Indian fiscal years", () => {
    assert.equal(fyOf("2026-10-29"), "2026-27");
    assert.equal(fyOf("2027-03-31"), "2026-27");
    assert.equal(fyOf("2027-04-01"), "2027-28");
  });

  const manager = await v2login("manager@satya.demo");
  let supplierId;

  await t.test("supplier create validates GSTIN checksum", async () => {
    const bad = await call("/api/v2/suppliers", manager, { legalName: "Bad GSTIN Co", gstins: [{ gstin: "27AAACV1234A1Z0" }] });
    assert.equal(bad.response.status, 422);
    const { response, data } = await call("/api/v2/suppliers", manager, {
      legalName: "Shakti Industrial Suppliers Pvt Ltd",
      gstins: [{ gstin: fictionalGstin("27", "AAACS5678B") }],
      pan: "AAACS5678B",
      udyam: { number: "UDYAM-MH-19-0001234", category: "small" },
      msme: true,
      paymentTermsDays: 45,
    });
    assert.equal(response.status, 201);
    supplierId = data.id;
    assert.ok(supplierId.startsWith("sup_"));
  });

  await t.test("supplier list/get are group-scoped", async () => {
    const { data } = await call("/api/v2/suppliers", manager);
    assert.ok(data.items.some((s) => s.id === supplierId));
    const isolated = await v2login("isolated@satya.demo");
    const { response } = await call(`/api/v2/suppliers/${supplierId}`, isolated);
    assert.equal(response.status, 404);
  });

  await t.test("bank account change needs maker then a different checker", async () => {
    // ap_manager is a checker, not a maker -> propose denied
    const denied = await call(`/api/v2/suppliers/${supplierId}/bank-accounts`, manager, { accountNo: "50100223344556", ifsc: "HDFC0001234" });
    assert.equal(denied.response.status, 403);
    // a fresh trial group_admin proposes (has maker permission)
    const email = `bank-owner-${Date.now()}@example.test`;
    const { data: owner } = await call("/api/v2/auth/signup", null, { name: "Bank Owner", email, password: "strongpass1!", groupName: "Bank Flow Ltd" });
    const sup = await call("/api/v2/suppliers", owner.token, { legalName: "Banked Supplier Ltd" });
    const proposed = await call(`/api/v2/suppliers/${sup.data.id}/bank-accounts`, owner.token, { accountNo: "50100223344556", ifsc: "HDFC0001234", holderName: "Banked Supplier Ltd" });
    assert.equal(proposed.response.status, 201);
    const pending = proposed.data.bankAccounts.at(-1);
    assert.equal(pending.status, "pending_change");
    assert.equal(pending.accountMasked, "****4556");
    // never stores the clear account number
    assert.ok(!JSON.stringify(proposed.data).includes("50100223344556"));
    // SoD: the maker cannot approve their own proposal
    const selfApprove = await call(`/api/v2/suppliers/${sup.data.id}/bank-accounts/${pending.id}/approve`, owner.token, {});
    assert.equal(selfApprove.response.status, 403);
  });

  await t.test("items create + alias search is scoped", async () => {
    const { response, data } = await call("/api/v2/items", manager, {
      code: `PMP-${String(Date.now()).slice(-6)}`, description: "Centrifugal pump 5 HP cast iron",
      hsn: "8413", uom: "EA", aliases: ["pump 5hp ci", "kirloskar type pump"],
    });
    assert.equal(response.status, 201);
    const found = await call(`/api/v2/items/search?q=${encodeURIComponent("kirloskar")}`, manager);
    assert.ok(found.data.items.some((i) => i.id === data.id));
  });

  await t.test("entities: trial group_admin adds a child entity", async () => {
    const email = `ent-${Date.now()}@example.test`;
    const { data: owner } = await call("/api/v2/auth/signup", null, { name: "Group Head", email, password: "strongpass1!", groupName: "Parent Industries", entityCode: "PIND", stateCode: "27" });
    const parent = owner.entity.id;
    const child = await call("/api/v2/entities", owner.token, { code: "CIND", legalName: "Child Industries Pvt Ltd", stateCode: "24", parentEntityId: parent, gstin: fictionalGstin("24", "AAACC9999C") });
    assert.equal(child.response.status, 201);
    assert.equal(child.data.parentEntityId, parent);
    const list = await call("/api/v2/entities", owner.token);
    assert.equal(list.data.items.length, 2);
  });

  await t.test("policies seed defaults; only policy.manage can change them", async () => {
    const me = await call("/api/v2/me", manager);
    const entityId = me.data.entities[0].id;
    const { data: policy } = await call(`/api/v2/policies/${entityId}`, manager);
    assert.equal(policy.msme.defaultDays, 45);
    assert.ok(policy.numbering.some((n) => n.docType === "PO"));
    assert.ok(policy.termsTemplates.some((t) => t.disclaimer?.includes("legal adviser")));
    const denied = await call(`/api/v2/policies/${entityId}`, manager, { msme: { defaultDays: 30 } }, "PUT");
    assert.equal(denied.response.status, 403); // ap_manager lacks policy.manage
  });

  await t.test("hsn search endpoint answers cleanly (master may be empty)", async () => {
    const { response, data } = await call("/api/v2/hsn/search?q=8413", manager);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(data.items));
  });
});
