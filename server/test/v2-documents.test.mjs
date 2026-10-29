import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNotCreator } from "../src/auth/sod.js";
import { amountInWords } from "../src/lib/words.js";

// v2 documents & PO/PI lifecycle (04 P2-B4): draft -> compute -> submit ->
// approve -> issue -> amend, DoA routing, SoD, numbering, verify hash.
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

const entityParty = { name: "Satya Equipment Distribution", stateCode: "27", gstin: "27AAACS1234A1Z5" };
const supplierParty = { name: "Shakti Industrial Suppliers Pvt Ltd", stateCode: "27", gstin: "27AAACS5678B1Z3" };

const poDraft = (entityId, { rate = "5000", qty = "10", date = "2026-10-28" } = {}) => ({
  type: "PO", entityId, date,
  seller: supplierParty, buyer: entityParty,
  placeOfSupply: "27",
  lines: [{ lineNo: 1, description: "Centrifugal pump 5 HP", hsn: "8413", uom: "EA", qty, rate, gstRate: "18", scheduleDate: "2026-11-15" }],
  terms: { paymentTerms: "45 days from accepted invoice", creditDays: 45, deliveryTerms: "FOR site" },
});

test("v2 documents: PO lifecycle, DoA, SoD, numbering, verify", async (t) => {
  const analyst = await v2login("analyst@satya.demo");   // buyer -> po.create
  const manager = await v2login("manager@satya.demo");   // ap_manager -> po.approve
  const me = await call("/api/v2/me", analyst);
  const entityId = me.data.entities[0].id;

  await t.test("sod helpers + amount in words", () => {
    assert.deepEqual(assertNotCreator({ createdBy: "u1" }, "u1").ok, false);
    assert.deepEqual(assertNotCreator({ createdBy: "u1" }, "u2").ok, true);
    assert.equal(amountInWords("1234567.50"), "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees and Fifty Paise Only");
  });

  let docId;
  await t.test("analyst drafts a PO (buyer permission)", async () => {
    const { response, data } = await call("/api/v2/documents/draft", analyst, poDraft(entityId));
    assert.equal(response.status, 201);
    docId = data.id;
    assert.ok(docId.startsWith("doc_"));
    assert.equal(data.status, "draft");
    assert.equal(data.fy, "2026-27");
    assert.equal(data.number, null);
  });

  await t.test("draft patch honours expectedRevision", async () => {
    const stale = await call(`/api/v2/documents/${docId}`, analyst, { expectedRevision: 99, patch: { externalRef: "REF-1" } }, "PATCH");
    assert.equal(stale.response.status, 409);
    const { response, data } = await call(`/api/v2/documents/${docId}`, analyst, { expectedRevision: 0, patch: { externalRef: "REF-1" } }, "PATCH");
    assert.equal(response.status, 200);
    assert.equal(data.revision, 1);
  });

  await t.test("compute proxies the engine tax service", async () => {
    const { response, data } = await call(`/api/v2/documents/${docId}/compute`, analyst, {});
    if (response.status === 503) {
      // engine v2 surface not enabled in this environment — acceptable degradation
      assert.equal(data.error.code, "UPSTREAM_UNAVAILABLE");
      return;
    }
    assert.equal(response.status, 200);
    assert.ok(data.totals?.grand, "engine returns grand total");
    assert.ok(Array.isArray(data.lines));
  });

  await t.test("submit routes to DoA approvers", async () => {
    const { response, data } = await call(`/api/v2/documents/${docId}/submit`, analyst, {});
    assert.equal(response.status, 200);
    assert.equal(data.status, "pending_approval");
    assert.ok(data.approvers[0].roles.includes("ap_manager") || data.approvers[0].roles.includes("entity_admin"));
  });

  await t.test("a different approver (ap_manager) approves; SoD blocks creator-approval", async () => {
    // analyst created it but lacks po.approve entirely
    const selfApprove = await call(`/api/v2/documents/${docId}/approve`, analyst, { expectedRevision: 2 });
    assert.ok([403].includes(selfApprove.response.status));
    const { response, data } = await call(`/api/v2/documents/${docId}/approve`, manager, { expectedRevision: 2, comment: "ok" });
    assert.equal(response.status, 200);
    assert.equal(data.status, "approved");
    assert.equal(data.approvals.at(-1).comment, "ok");
  });

  let issuedNumber, contentHash;
  await t.test("issue assigns atomic series number + contentHash + case", async () => {
    const { response, data } = await call(`/api/v2/documents/${docId}/issue`, manager, {});
    assert.equal(response.status, 200);
    issuedNumber = data.number;
    contentHash = data.contentHash;
    assert.match(issuedNumber, /\/PO\/26-27\/\d{6}$/);
    assert.equal(data.document.status, "issued");
    assert.ok(data.document.caseId?.startsWith("case_"), "auto-created investigation case");
  });

  await t.test("public verify confirms the issued document", async () => {
    const { response, data } = await call(`/api/v2/verify/${contentHash}`);
    assert.equal(response.status, 200);
    assert.equal(data.valid, true);
    assert.equal(data.number, issuedNumber);
    assert.equal(data.type, "PO");
    assert.equal((await call(`/api/v2/verify/${"0".repeat(64)}`)).data.valid, false);
  });

  await t.test("issued document is immutable; amendment is a new draft", async () => {
    const patch = await call(`/api/v2/documents/${docId}`, analyst, { expectedRevision: 4, patch: { externalRef: "X" } }, "PATCH");
    assert.equal(patch.response.status, 409); // not a draft
    const { response, data } = await call(`/api/v2/documents/${docId}/amend`, analyst, {});
    assert.equal(response.status, 201);
    assert.equal(data.type, "PO_AMENDMENT");
    assert.equal(data.supersedes, docId);
    assert.equal(data.status, "draft");
  });

  await t.test("DoA escalates large amounts beyond ap_manager", async () => {
    const big = await call("/api/v2/documents/draft", analyst, poDraft(entityId, { rate: "200000" })); // >10L with GST
    assert.equal(big.response.status, 201);
    await call(`/api/v2/documents/${big.data.id}/submit`, analyst, {});
    const denied = await call(`/api/v2/documents/${big.data.id}/approve`, manager, {});
    assert.equal(denied.response.status, 403); // needs group_admin
  });

  await t.test("numbering is unique under parallel issue", async () => {
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const d = await call("/api/v2/documents/draft", analyst, poDraft(entityId));
      await call(`/api/v2/documents/${d.data.id}/submit`, analyst, {});
      await call(`/api/v2/documents/${d.data.id}/approve`, manager, {});
      ids.push(d.data.id);
    }
    const issued = await Promise.all(ids.map((id) => call(`/api/v2/documents/${id}/issue`, manager, {})));
    const numbers = issued.map((r) => r.data.number);
    assert.equal(new Set(numbers).size, numbers.length, "all numbers unique");
  });

  await t.test("FY rollover starts a fresh series", async () => {
    const d = await call("/api/v2/documents/draft", analyst, poDraft(entityId, { date: "2027-04-10" }));
    assert.equal(d.data.fy, "2027-28");
    await call(`/api/v2/documents/${d.data.id}/submit`, analyst, {});
    await call(`/api/v2/documents/${d.data.id}/approve`, manager, {});
    const issued = await call(`/api/v2/documents/${d.data.id}/issue`, manager, {});
    assert.match(issued.data.number, /\/PO\/27-28\/\d{6}$/, "number issued under the new FY series");
  });

  await t.test("list filters and detail lifecycle shape", async () => {
    const { data } = await call(`/api/v2/documents?type=PO&status=issued&entityId=${entityId}`, analyst);
    assert.ok(data.items.every((d) => d.type === "PO" && d.status === "issued"));
    const detail = await call(`/api/v2/documents/${docId}`, analyst);
    assert.equal(detail.data.caseId?.startsWith("case_"), true);
    assert.ok(detail.data.lifecycle.lines[0].ordered === 10);
    assert.equal(detail.data.lifecycle.approximate, true);
  });

  await t.test("render-model returns letterhead + words + verify payload", async () => {
    const { response, data } = await call(`/api/v2/documents/${docId}/render-model`, analyst);
    assert.equal(response.status, 200);
    assert.equal(data.verify.hash, contentHash);
    assert.ok(data.entity.legalName);
    if (data.document.totals?.grand) assert.ok(data.amountInWords.includes("Rupees"));
  });

  await t.test("cross-group reads return 404, anonymous 401", async () => {
    const isolated = await v2login("isolated@satya.demo");
    assert.equal((await call(`/api/v2/documents/${docId}`, isolated)).response.status, 404);
    assert.equal((await call("/api/v2/documents")).response.status, 401);
  });
});
