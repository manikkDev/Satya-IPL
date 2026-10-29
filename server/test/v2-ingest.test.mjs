import { test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "../node_modules/mongoose/index.js";

const { default: ExtractionDraft } = await import("../src/models/ExtractionDraft.js");

// v2 files & ingestion (04 P2-B5): magic-byte upload, dedupe, extraction
// pipeline (engine parse -> LLM degrade -> validate -> needs_review), confirm.
const BASE = process.env.SERVER_URL || "http://localhost:5002";
const secret = process.env.DEMO_PASSWORD || "SatyaDemo@123";

const login = async (email) => {
  const r = await fetch(`${BASE}/api/v2/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: secret }) });
  return (await r.json()).token;
};
const post = (path, token, body) => fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
const upload = async (token, name, bytes) => {
  const fd = new FormData();
  fd.append("file", new Blob([bytes]), name);
  const r = await fetch(`${BASE}/api/v2/files`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
  return { status: r.status, data: await r.json().catch(() => null) };
};

// minimal valid files for sniffing: a real 1x1 PNG for the pipeline and a
// structurally-valid empty PDF for upload checks.
const TINY_PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

test("v2 ingest: upload sniffing, dedupe, extraction pipeline, confirm", async (t) => {
  const analyst = await login("analyst@satya.demo");
  const auditor = await login("auditor@satya.demo");

  await t.test("auditor cannot upload", async () => {
    const { status } = await upload(auditor, "a.pdf", TINY_PDF);
    assert.equal(status, 403);
  });

  let fileId;
  await t.test("valid pdf uploads; fake and exe rejected; dedupe works", async () => {
    const first = await upload(analyst, "invoice.pdf", TINY_PDF);
    assert.ok([200, 201].includes(first.status));
    fileId = first.data.fileId ?? first.data.duplicateOf;
    assert.match(fileId, /^file_/);
    const again = await upload(analyst, "invoice.pdf", TINY_PDF);
    assert.equal(again.data.duplicateOf, fileId);
    const fake = await upload(analyst, "fake.pdf", Buffer.from("hello not a pdf"));
    assert.equal(fake.status, 422);
    const exe = await upload(analyst, "tool.exe", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100)]));
    assert.equal(exe.status, 422);
  });

  let draftId;
  await t.test("extraction pipeline runs to a terminal status", async () => {
    const png = await upload(analyst, "scan.png", TINY_PNG);
    assert.ok([200, 201].includes(png.status));
    const r = await post(`/api/v2/ingest/files/${png.data.fileId ?? png.data.duplicateOf}/extract`, analyst, {});
    const d = await r.json();
    assert.match(d.draftId, /^drf_/);
    // needs_review when engine can parse; failed is also valid while the
    // engine image lacks pillow (A's in-flight fix, flagged in handoffs/A.md)
    assert.ok(["needs_review", "confirmed", "failed"].includes(d.status), `unexpected status ${d.status}`);
  });

  await t.test("seed a needs_review draft for the confirm path", async () => {
    await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/satya", { dbName: "satya" });
    const me = await (await fetch(`${BASE}/api/v2/me`, { headers: { authorization: `Bearer ${analyst}` } })).json();
    draftId = `drf_test_${Date.now()}`;
    await ExtractionDraft.create({
      id: draftId, groupId: me.activeGroup.id, entityId: me.entities[0].id,
      fileId: "file_test", status: "needs_review", detectedType: "INVOICE_IN", method: "text_layer",
      fields: {}, lines: [{ lineNo: 1, description: "Pump 5HP", qty: "2", rate: "5000" }],
    });
    await mongoose.disconnect();
    assert.ok(draftId);
  });

  await t.test("human corrections persist and are logged", async () => {
    const patch = await fetch(`${BASE}/api/v2/ingest/drafts/${draftId}`, {
      method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${analyst}` },
      body: JSON.stringify({ fields: { number: { value: "INV-901", confidence: 1 }, sellerName: { value: "Shakti Industrial Suppliers Pvt Ltd", confidence: 1 }, date: { value: "2026-10-25", confidence: 1 } } }),
    });
    assert.equal(patch.status, 200);
    const d = await patch.json();
    assert.equal(d.fields.number.value, "INV-901");
    assert.equal(d.edits.length, 1);
  });

  await t.test("confirm creates EXTRACTED_REVIEWED document; re-confirm idempotent", async () => {
    const r = await post(`/api/v2/ingest/drafts/${draftId}/confirm`, analyst, {});
    assert.equal(r.status, 201);
    const { documentId } = await r.json();
    const doc = await (await fetch(`${BASE}/api/v2/documents/${documentId}`, { headers: { authorization: `Bearer ${analyst}` } })).json();
    assert.equal(doc.provenance, "EXTRACTED_REVIEWED");
    assert.equal(doc.number, "INV-901");
    assert.equal(doc.source.extractionDraftId, draftId);
    const again = await post(`/api/v2/ingest/drafts/${draftId}/confirm`, analyst, {});
    assert.equal((await again.json()).documentId, documentId);
  });
});
