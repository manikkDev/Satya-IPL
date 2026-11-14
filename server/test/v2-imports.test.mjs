// Integration: import hub against a running API (SERVER_URL, default :5002)
// with the curated demo data. Uses unique numbers per run so it can repeat.
import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.SERVER_URL || "http://localhost:5002";
const secret = process.env.DEMO_PASSWORD || "SatyaDemo@123";
const login = async (email) => (await (await fetch(`${BASE}/api/v2/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: secret }) })).json()).token;
const H = (t) => ({ authorization: `Bearer ${t}` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = async (token, entityId, source, name, text) => {
  const fd = new FormData();
  fd.append("file", new Blob([text]), name);
  fd.append("source", source);
  fd.append("entityId", entityId);
  const r = await fetch(`${BASE}/api/v2/import/preview`, { method: "POST", headers: H(token), body: fd });
  return { status: r.status, body: await r.json() };
};
const commit = async (token, id) => {
  const r = await fetch(`${BASE}/api/v2/import/runs/${id}/commit`, { method: "POST", headers: { ...H(token), "content-type": "application/json" }, body: "{}" });
  return { status: r.status, body: await r.json() };
};

test("import hub: template preview -> commit -> idempotent re-import -> auto-checks", async (t) => {
  const manager = await login("manager@satya.demo");
  const auditor = await login("auditor@satya.demo");
  const ents = await (await fetch(`${BASE}/api/v2/entities`, { headers: H(manager) })).json();
  const entityId = (ents.items || ents)[0].id;
  const tag = Date.now().toString(36).toUpperCase();
  const po = `PO/TEST/${tag}`;
  const csv = `PO number,PO date,Supplier GSTIN,Description,Quantity,Rate,GST %\n${po},10-11-2026,27AAHCS6742Q1ZJ,Test pump,2,1000,18\n${po},10-11-2026,27AAHCS6742Q1ZJ,Test seal,3,100,18\nBAD,99-99-2026,27AAHCS6742Q1ZX,Broken,0,x,17\n`;

  await t.test("auditor cannot import", async () => {
    const r = await preview(auditor, entityId, "template:purchase_orders", "po.csv", csv);
    assert.equal(r.status, 403);
  });

  let runId;
  await t.test("preview validates rows without writing", async () => {
    const r = await preview(manager, entityId, "template:purchase_orders", "po.csv", csv);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.summary.create, 1);
    assert.equal(r.body.summary.error, 1);
    assert.ok(r.body.issues.some((i) => i.severity === "error" && /checksum/.test(i.message)));
    runId = r.body.id;
    const docs = await (await fetch(`${BASE}/api/v2/documents?q=${encodeURIComponent(po)}`, { headers: H(manager) })).json();
    assert.equal(docs.items.length, 0, "preview must not create documents");
  });

  await t.test("commit creates the PO, a case and queues checks; second commit is idempotent", async () => {
    const c = await commit(manager, runId);
    assert.equal(c.status, 201);
    assert.equal(c.body.status, "committed");
    assert.equal(c.body.createdDocumentIds.length, 1);
    const again = await commit(manager, runId);
    assert.equal(again.status, 200);
    assert.equal(again.body.createdDocumentIds.length, 1);
    let detail;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      detail = await (await fetch(`${BASE}/api/v2/import/runs/${runId}`, { headers: H(manager) })).json();
      if (detail.checks?.at) break;
    }
    assert.ok(detail.checks?.at, "autocheck ran");
    assert.equal(detail.checks.casesCreated, 1);
    assert.equal(detail.documents[0].caseId?.startsWith("case_"), true);
  });

  await t.test("re-importing the same file creates nothing", async () => {
    const r = await preview(manager, entityId, "template:purchase_orders", "po.csv", csv);
    assert.equal(r.body.summary.create, 0);
    assert.equal(r.body.summary.duplicate, 1);
    assert.equal(r.body.canCommit, false);
    assert.ok(r.body.detected.previouslyCommitted);
  });

  await t.test("missing required columns are explained", async () => {
    const r = await preview(manager, entityId, "template:purchase_invoices", "inv.csv", "Foo,Bar\n1,2\n");
    assert.equal(r.status, 422);
    assert.match(r.body.error.message, /Missing required column/);
  });

  await t.test("templates download and history lists the run", async () => {
    const x = await fetch(`${BASE}/api/v2/import/templates/grns?format=xlsx`, { headers: H(manager) });
    assert.equal(x.status, 200);
    assert.equal(Buffer.from(await x.arrayBuffer()).subarray(0, 2).toString(), "PK");
    const runs = await (await fetch(`${BASE}/api/v2/import/runs?limit=5`, { headers: H(manager) })).json();
    assert.ok(runs.items.some((r) => r.id === runId));
  });

  await t.test("api keys: created once, listed by prefix, revocable; auditor forbidden", async () => {
    const r = await fetch(`${BASE}/api/v2/import/api-keys`, { method: "POST", headers: { ...H(manager), "content-type": "application/json" }, body: JSON.stringify({ name: `test ${tag}`, entityId }) });
    const k = await r.json();
    assert.equal(r.status, 201);
    assert.match(k.key, /^satk_[0-9a-f]{40}$/);
    const list = await (await fetch(`${BASE}/api/v2/import/api-keys`, { headers: H(manager) })).json();
    const listed = list.items.find((x) => x.id === k.id);
    assert.ok(listed && !("key" in listed) && !("hash" in listed));
    const del = await fetch(`${BASE}/api/v2/import/api-keys/${k.id}`, { method: "DELETE", headers: H(manager) });
    assert.ok((await del.json()).revokedAt);
    const a = await fetch(`${BASE}/api/v2/import/api-keys`, { method: "POST", headers: { ...H(auditor), "content-type": "application/json" }, body: JSON.stringify({ name: "x", entityId }) });
    assert.equal(a.status, 403);
  });

  await t.test("legacy bank-csv keeps its contract and auto-detects an HDFC layout", async () => {
    const utr = `HDFCN2631${String(Date.now()).slice(-7)}`;
    const rows = [{ Date: "13/11/26", Narration: `NEFT DR-XXXX0000001-SOME VENDOR-NETBANK MUM-${utr}-TEST`, "Chq./Ref.No.": `0000${utr}`, "Value Dt": "13/11/26", "Withdrawal Amt.": "1,234.00", "Deposit Amt.": "", "Closing Balance": "10,000.00" }];
    const r = await fetch(`${BASE}/api/v2/import/bank-csv`, { method: "POST", headers: { ...H(manager), "content-type": "application/json" }, body: JSON.stringify({ entityId, rows }) });
    const body = await r.json();
    assert.equal(r.status, 201, JSON.stringify(body));
    assert.equal(body.created, 1);
    assert.equal(body.detected.bank, "HDFC");
    const again = await fetch(`${BASE}/api/v2/import/bank-csv`, { method: "POST", headers: { ...H(manager), "content-type": "application/json" }, body: JSON.stringify({ entityId, rows }) });
    assert.equal((await again.json()).deduped, 1);
  });
});
