import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.SERVER_URL || "http://localhost:5002";
const secret = process.env.DEMO_PASSWORD || "SatyaDemo@123";
const call = async (path, token, body) => {
  const response = await fetch(`${BASE}${path}`, { headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  return { response, data };
};
const login = async (email) => { const result = await call("/api/auth/login", null, { email, password: secret }); assert.equal(result.response.status, 200); return result.data.token; };

let manager;
test("business contract: authentication, immutable evidence, graph, replay and decisions", async (t) => {
  manager = await login("manager@satya.demo");
  await t.test("anonymous business requests are rejected", async () => {
    for (const path of ["/api/v1/cases", "/api/v1/records", "/api/v1/graph/cases/pumps-1001", "/api/conversations"]) assert.equal((await call(path)).response.status, 401);
  });
  await t.test("privileged public signup is rejected", async () => {
    assert.equal((await call("/api/auth/signup", null, { name: "Uninvited", email: "uninvited@example.test", password: "LongTestPassword", role: "admin" })).response.status, 403);
  });
  await t.test("golden case retains exact balance and ambiguity", async () => {
    const { data } = await call("/api/v1/cases/pumps-1001", manager);
    assert.equal(data.snapshot.ledger.supportedOutstanding, "20000.00");
    assert.equal(data.snapshot.ledger.recordedOutstanding, "90800.00");
    assert.equal(data.snapshot.unallocatedPayments[0].amount, "15000.00");
    assert.ok(data.snapshot.evidence.every((item) => item.id && item.recordId));
  });
  await t.test("Neo4j projection uses actual case relationships", async () => {
    const { data } = await call("/api/v1/graph/cases/pumps-1001", manager);
    assert.equal(data.source, "neo4j");
    assert.ok(data.edges.some((edge) => edge.type === "SETTLES"));
    assert.ok(data.edges.some((edge) => edge.type === "CANDIDATE_SETTLEMENT"));
  });
  await t.test("other company cannot read guessed case/snapshot/graph IDs", async () => {
    const isolated = await login("isolated@satya.demo");
    const current = (await call("/api/v1/cases/pumps-1001", manager)).data;
    for (const path of ["/api/v1/cases/pumps-1001", "/api/v1/graph/cases/pumps-1001", `/api/v1/snapshots/${current.snapshot.snapshotId}`]) assert.equal((await call(path, isolated)).response.status, 404);
    assert.deepEqual((await call("/api/v1/cases", isolated)).data, []);
  });
  await t.test("auditor cannot mutate or reconcile", async () => {
    const auditor = await login("auditor@satya.demo");
    assert.equal((await call("/api/v1/cases/pumps-1001/reconcile", auditor, {})).response.status, 403);
    assert.equal((await call("/api/v1/cases/pumps-1001/decisions", auditor, { action: "APPROVE" })).response.status, 403);
  });
  await t.test("stale revision cannot authorize a decision", async () => {
    assert.equal((await call("/api/v1/cases/pumps-1001/decisions", manager, { action: "PLACE_ON_HOLD", reason: "Review duplicate evidence", expectedRevision: -1, snapshotId: "old" })).response.status, 409);
  });
  await t.test("early replay cannot see future receipts", async () => {
    const replay = await call("/api/v1/cases/pumps-1001/replay", manager, { observedBefore: "2026-10-02T23:59:00+05:30" });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.data.ledger.received, "0");
    assert.equal(replay.data.ledger.recordedGross, "0.00");
    assert.equal(replay.data.simulation, true);
  });
  await t.test("what-if delivery does not mutate live sources", async () => {
    const before = (await call("/api/v1/cases/pumps-1001", manager)).data;
    const record = { id: `WHATIF-${Date.now()}`, type: "GRN", reference: "Test hypothetical delivery", source: "scenario_test", supplier: before.supplier, currency: before.snapshot.ledger.currency, poId: before.poId, occurredAt: before.snapshot.observedBefore, observedAt: before.snapshot.observedBefore, lines: [{ id: "1", description: "Centrifugal pump CP-100 1 kW", sku: "CP100-1KW", quantity: "40", acceptedQuantity: "40", unitPrice: "1000", uom: "EA", poLineId: "1" }] };
    const preview = await call("/api/v1/cases/pumps-1001/scenario", manager, { record });
    assert.equal(preview.data.ledger.received, "100");
    assert.equal(preview.data.ledger.supportedOutstanding, "20000.00");
    const after = (await call("/api/v1/cases/pumps-1001", manager)).data;
    assert.equal(after.snapshot.snapshotId, before.snapshot.snapshotId);
    assert.equal(after.records.length, before.records.length);
  });
  await t.test("company conversations persist with business mode", async () => {
    const created = await call("/api/conversations", manager, { title: "Business contract test" });
    assert.equal(created.response.status, 201);
    assert.equal(created.data.mode, "business_ops");
    const appended = await call(`/api/conversations/${created.data.id}/messages`, manager, { messages: [{ role: "user", content: "Explain PO-1001 evidence" }] });
    assert.equal(appended.response.status, 201);
    assert.equal((await call(`/api/conversations/${created.data.id}`, manager)).data.messages.length, 1);
  });
  await t.test("validated import is idempotent and a reviewed duplicate keeps recorded AP", async () => {
    const tester = await login("tester@satya.demo");
    const suffix = Date.now();
    const poId = `PO-TEST-${suffix}`;
    const invoiceId = `INV-TEST-${suffix}`;
    const duplicateId = `AP-TEST-${suffix}`;
    const timestamp = new Date(Date.now() - 3600000).toISOString();
    const line = { id: '1', description: 'Pump 1 kW', sku: 'PUMP-1KW', quantity: '10', unitPrice: '1000', uom: 'EA', poLineId: '1' };
    const base = { supplier: 'Test Supplier', occurredAt: timestamp, observedAt: timestamp, source: 'contract_test', currency: 'INR' };
    const payload = { title: 'Contract test duplicate investigation', poId, records: [
      { ...base, id: poId, type: 'PO', reference: poId, status: 'approved', lines: [line] },
      { ...base, id: `GRN-${suffix}`, type: 'GRN', reference: 'Test receipt', poId, lines: [{ ...line, acceptedQuantity: '10' }] },
      { ...base, id: invoiceId, type: 'INVOICE', reference: `SUP/INV/${suffix}`, poId, amount: '10000.00', netAmount: '10000.00', lines: [line] },
      { ...base, id: duplicateId, type: 'INVOICE', reference: `SUP INV ${suffix}`, poId, amount: '10000.00', netAmount: '10000.00', lines: [line] },
    ] };
    const imported = await call('/api/v1/imports', tester, payload);
    assert.equal(imported.response.status, 201);
    const awaitJob = async (id) => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const job = (await call(`/api/v1/jobs/${id}`, tester)).data;
        if (job.status === 'completed') return;
        if (job.status === 'failed') throw new Error(job.error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error('Test reconciliation timed out');
    };
    await awaitJob(imported.data.job.id);
    const repeated = await call('/api/v1/imports', tester, payload);
    assert.equal(repeated.data.caseId, imported.data.caseId);
    assert.equal(repeated.data.idempotent, true);
    const current = (await call(`/api/v1/cases/${imported.data.caseId}`, tester)).data;
    assert.equal(current.records.length, 4);
    const candidate = current.snapshot.duplicateCandidates[0];
    assert.ok(candidate);
    const decision = await call(`/api/v1/cases/${current.id}/decisions`, tester, { expectedRevision: current.revision, snapshotId: current.snapshot.snapshotId, action: 'PLACE_ON_HOLD', reason: 'Supplier confirmation identifies one invoice represented by two AP postings.', review: { kind: 'confirm_duplicate', recordId: candidate.recordId, originalId: candidate.candidateOriginalId } });
    assert.equal(decision.response.status, 201);
    await awaitJob(decision.data.job.id);
    const reviewed = (await call(`/api/v1/cases/${current.id}`, tester)).data;
    assert.equal(reviewed.snapshot.ledger.recordedOutstanding, '20000.00');
    assert.equal(reviewed.snapshot.ledger.canonicalOutstanding, '10000.00');
    assert.equal(reviewed.decisions.length, 1);
    assert.equal(reviewed.status, 'on_hold');
    assert.equal(reviewed.decisions[0].effect, 'internal_workflow_only_no_transfer_or_message');
    assert.equal((await call(`/api/v1/cases/${current.id}`, manager)).response.status, 404);
  });
  await t.test('CSV preview commits source-row provenance without guessing currency', async () => {
    const tester = await login('tester@satya.demo');
    const id = `CSV-PO-${Date.now()}`;
    const content = `id,reference,supplier,currency,occurredAt,status,lineId,description,quantity,unitPrice,uom\n${id},CSV/ORDER/0001,Example Supplier,INR,2026-10-01T10:00:00+05:30,approved,1,Pump 1 kW,10,1000,EA\n`;
    const mapping = Object.fromEntries(['id','reference','supplier','currency','occurredAt','status','lineId','description','quantity','unitPrice','uom'].map((field) => [field, field]));
    const payload = { title: 'CSV contract test', poId: id, files: [{ name: 'orders.csv', recordType: 'PO', source: 'procurement_csv', content, mapping, numberFormat: 'plain' }] };
    const validation = await call('/api/v1/imports/preview', tester, payload);
    assert.equal(validation.response.status, 200);
    assert.equal(validation.data.canCommit, true);
    const committed = await call('/api/v1/imports', tester, { previewId: validation.data.id });
    assert.equal(committed.response.status, 201);
    for (let attempt = 0; attempt < 30; attempt++) {
      const job = (await call(`/api/v1/jobs/${committed.data.job.id}`, tester)).data;
      if (job.status === 'completed') break;
      if (job.status === 'failed') throw new Error(job.error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const imported = (await call(`/api/v1/cases/${committed.data.caseId}`, tester)).data;
    const evidence = imported.snapshot.evidence.find((item) => item.locator.kind === 'csv_cell');
    assert.equal(evidence.locator.row, 2);
    const original = await call(`/api/v1/documents/${evidence.locator.documentId}`, tester);
    assert.equal(original.data.content, content);
    assert.equal((await call(`/api/v1/documents/${evidence.locator.documentId}`, manager)).response.status, 404);
    const again = await call('/api/v1/imports/preview', tester, payload);
    const repeated = await call('/api/v1/imports', tester, { previewId: again.data.id });
    assert.equal(repeated.data.caseId, committed.data.caseId);
    assert.equal(repeated.data.idempotent, true);
    const invalid = await call('/api/v1/imports/preview', tester, { ...payload, files: [{ ...payload.files[0], content: content.replace(',INR,', ',,') }] });
    assert.equal(invalid.data.canCommit, false);
    assert.equal((await call('/api/v1/imports', tester, { previewId: invalid.data.id })).response.status, 422);
  });
  await t.test("analyst escalates a case forward; only a manager can approve", async () => {
    const analyst = await login("test-analyst@satya.demo");
    const tester = await login("tester@satya.demo");
    const suffix = Date.now();
    const poId = `PO-HANDOFF-${suffix}`;
    const timestamp = new Date(Date.now() - 3600000).toISOString();
    const line = { id: '1', description: 'Pump 1 kW', sku: 'PUMP-1KW', quantity: '5', unitPrice: '1000', uom: 'EA', poLineId: '1' };
    const base = { supplier: 'Handoff Supplier', occurredAt: timestamp, observedAt: timestamp, source: 'contract_test', currency: 'INR' };
    const imported = await call('/api/v1/imports', analyst, { title: 'Approval handoff investigation', poId, records: [
      { ...base, id: poId, type: 'PO', reference: poId, status: 'approved', lines: [line] },
      { ...base, id: `GRN-HO-${suffix}`, type: 'GRN', reference: 'Handoff receipt', poId, lines: [{ ...line, acceptedQuantity: '5' }] },
      { ...base, id: `INV-HO-${suffix}`, type: 'INVOICE', reference: `HO/INV/${suffix}`, poId, amount: '5000.00', netAmount: '5000.00', lines: [line] },
    ] });
    assert.equal(imported.response.status, 201);
    const awaitJob = async (id, token) => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const job = (await call(`/api/v1/jobs/${id}`, token)).data;
        if (job.status === 'completed') return;
        if (job.status === 'failed') throw new Error(job.error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error('Test reconciliation timed out');
    };
    await awaitJob(imported.data.job.id, analyst);
    const current = () => call(`/api/v1/cases/${imported.data.caseId}`, analyst).then((result) => result.data);
    let businessCase = await current();
    assert.equal((await call(`/api/v1/cases/${businessCase.id}/decisions`, analyst, { expectedRevision: businessCase.revision, snapshotId: businessCase.snapshot.snapshotId, action: 'APPROVE', reason: 'An analyst must not approve payments' })).response.status, 403);
    assert.equal((await call(`/api/v1/cases/${businessCase.id}/decisions`, analyst, { expectedRevision: businessCase.revision, snapshotId: businessCase.snapshot.snapshotId, action: 'ESCALATE', reason: 'Escalating with a fake review payload', review: { kind: 'confirm_duplicate', recordId: 'x', originalId: 'y' } })).response.status, 403);
    const escalated = await call(`/api/v1/cases/${businessCase.id}/decisions`, analyst, { expectedRevision: businessCase.revision, snapshotId: businessCase.snapshot.snapshotId, action: 'ESCALATE', reason: 'Checks are complete; sending forward for finance approval.' });
    assert.equal(escalated.response.status, 201);
    assert.equal(escalated.data.decision.actorRole, 'ops_analyst');
    await awaitJob(escalated.data.job.id, analyst);
    businessCase = await current();
    assert.equal(businessCase.status, 'escalated');
    const approved = await call(`/api/v1/cases/${businessCase.id}/decisions`, tester, { expectedRevision: businessCase.revision, snapshotId: businessCase.snapshot.snapshotId, action: 'APPROVE', reason: 'Records reconcile; eligible balance approved for the payment workflow.' });
    assert.equal(approved.response.status, 201);
    await awaitJob(approved.data.job.id, tester);
    businessCase = await current();
    assert.equal(businessCase.status, 'reconciled');
    assert.equal(businessCase.decisions.length, 2);
    assert.equal(businessCase.decisions[0].actorRole, 'ops_analyst');
    assert.equal(businessCase.decisions[1].actorRole, 'ap_manager');
  });
  await t.test("retired domain endpoints are not mounted", async () => {
    for (const path of ["/api/consent/me", "/api/risk-graph/overview", "/api/fl/progress"]) assert.equal((await fetch(`${BASE}${path}`)).status, 404);
  });
});
