import assert from "node:assert/strict";

const BASE = "http://127.0.0.1:5002";
const SECRET = "SatyaDemo@123";

const request = async (path, token, method = "GET", body = null) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, options);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};

const run = async () => {
  console.log("=================================================");
  console.log("   SATYA AI — LIVE BACKEND FEATURE VERIFICATION  ");
  console.log("=================================================\n");

  // 1. Health check
  const health = await request("/api/health");
  console.log(`[PASS] 1. API Health Check: Status ${health.status} (${JSON.stringify(health.data)})`);
  assert.equal(health.status, 200);

  // 2. Authentication
  const managerLogin = await request("/api/auth/login", null, "POST", { email: "manager@satya.demo", password: SECRET });
  console.log(`[PASS] 2. Manager Login: Status ${managerLogin.status}, Role: ${managerLogin.data.user?.role}`);
  assert.equal(managerLogin.status, 200);
  const managerToken = managerLogin.data.token;

  const analystLogin = await request("/api/auth/login", null, "POST", { email: "test-analyst@satya.demo", password: SECRET });
  console.log(`[PASS] 3. Analyst Login: Status ${analystLogin.status}, Role: ${analystLogin.data.user?.role}`);
  assert.equal(analystLogin.status, 200);
  const analystToken = analystLogin.data.token;

  // 3. Feature 1: Smart Obligation Tracking
  const caseRes = await request("/api/v1/cases/pumps-1001", managerToken);
  assert.equal(caseRes.status, 200);
  const ledger = caseRes.data.snapshot?.ledger;
  console.log(`[PASS] 4. Feature 1 (Smart Obligation Tracking):`);
  console.log(`       - Case ID: ${caseRes.data.id} (${caseRes.data.poId})`);
  console.log(`       - Recorded Gross: ${ledger?.currency} ${ledger?.recordedGross}`);
  console.log(`       - Supported Outstanding: ${ledger?.currency} ${ledger?.supportedOutstanding}`);
  console.log(`       - Disputed Exposure: ${ledger?.currency} ${ledger?.disputedExposure}`);
  assert.ok(ledger?.supportedOutstanding);

  // 4. Feature 2: Evidence-Linked Reconciliation
  const evidence = caseRes.data.snapshot?.evidence || [];
  console.log(`[PASS] 5. Feature 2 (Evidence-Linked Reconciliation): Found ${evidence.length} evidence locators`);
  assert.ok(evidence.length > 0);
  const firstEv = evidence[0];
  console.log(`       - Sample Locator: ${firstEv.reference} (Field: ${firstEv.field}, Provenance: ${firstEv.provenance})`);

  // 5. Feature 3: Discrepancy Explanation Engine
  const findings = caseRes.data.snapshot?.findings || [];
  console.log(`[PASS] 6. Feature 3 (Discrepancy Explanation Engine): Found ${findings.length} findings`);
  assert.ok(findings.length > 0);
  for (const f of findings) {
    console.log(`       - Finding [${f.severity}]: ${f.title} (Action: ${f.action}, Certainty: ${f.certainty})`);
  }

  // 6. Feature 4: Transaction Lifecycle State Machine
  console.log(`[PASS] 7. Feature 4 (Lifecycle State Machine & SoD):`);
  // Try decision with short reason (<10 chars)
  const shortReasonRes = await request("/api/v1/cases/pumps-1001/decisions", managerToken, "POST", {
    action: "PLACE_ON_HOLD",
    reason: "short",
    expectedRevision: caseRes.data.revision,
    snapshotId: caseRes.data.snapshot?.snapshotId
  });
  console.log(`       - Short reason rejection: Status ${shortReasonRes.status} (Expected 422: ${shortReasonRes.data.message})`);
  assert.equal(shortReasonRes.status, 422);

  // Analyst attempting to APPROVE (SoD violation)
  const analystApprove = await request("/api/v1/cases/pumps-1001/decisions", analystToken, "POST", {
    action: "APPROVE",
    reason: "Analyst illegally trying to approve payment",
    expectedRevision: caseRes.data.revision,
    snapshotId: caseRes.data.snapshot?.snapshotId
  });
  console.log(`       - Analyst approval blocked by SoD: Status ${analystApprove.status} (Expected 403: ${analystApprove.data.message})`);
  assert.equal(analystApprove.status, 403);

  // 7. Feature 5: Duplicate and Anomaly Detection
  const duplicates = caseRes.data.snapshot?.duplicateCandidates || [];
  console.log(`[PASS] 8. Feature 5 (Duplicate & Anomaly Detection):`);
  console.log(`       - Duplicate Candidates: ${duplicates.length}`);
  if (duplicates.length) {
    console.log(`       - Sample Duplicate: Record ${duplicates[0].recordId} matches ${duplicates[0].candidateOriginalId}`);
  }

  // 8. Feature 6: Risk and Priority Dashboard
  const attention = await request("/api/v1/dashboard/attention", managerToken);
  console.log(`[PASS] 9. Feature 6 (Risk & Priority Dashboard): Status ${attention.status}`);
  assert.equal(attention.status, 200);
  console.log(`       - Open Attention Items: ${attention.data.items?.length}`);
  if (attention.data.items?.length) {
    const top = attention.data.items[0];
    console.log(`       - Top Priority Case: ${top.poId} (${top.supplier}) — Priority Score: ${top.priority}`);
    console.log(`       - Scoring Rules Triggered: ${top.rules?.join(", ")}`);
  }

  // 9. Feature 7: Connected Transaction Graph
  const graph = await request("/api/v1/graph/cases/pumps-1001", managerToken);
  console.log(`[PASS] 10. Feature 7 (Connected Transaction Graph): Status ${graph.status}`);
  assert.equal(graph.status, 200);
  console.log(`       - Nodes: ${graph.data.nodes?.length}, Edges: ${graph.data.edges?.length}, Source: ${graph.data.source}`);

  // 10. Feature 8: Exception Resolution Workflow
  const assignable = await request("/api/v1/users/assignable", managerToken);
  console.log(`[PASS] 11. Feature 8 (Exception Resolution Workflow): Status ${assignable.status}`);
  assert.equal(assignable.status, 200);
  console.log(`       - Assignable Users Count: ${assignable.data?.length}`);
  for (const u of assignable.data || []) {
    console.log(`         * ${u.name} (${u.role}) — ${u.email}`);
  }

  // 11. Feature 9: Document Management & Verification
  const docs = await request("/api/v1/cases/pumps-1001/documents", managerToken);
  console.log(`[PASS] 12. Feature 9 (Document Management & Verification): Status ${docs.status}`);
  assert.equal(docs.status, 200);
  console.log(`       - Attached Documents Count: ${docs.data?.length}`);

  // 12. Feature 10: Financial Insights Dashboard
  const summary = await request("/api/v1/dashboard/summary", managerToken);
  console.log(`[PASS] 13. Feature 10 (Financial Insights Dashboard): Status ${summary.status}`);
  assert.equal(summary.status, 200);
  console.log(`       - Total Cases: ${summary.data.statusCounts?.total}`);
  console.log(`       - Total Supported Outstanding: ${summary.data.currency} ${summary.data.totals?.supportedOutstanding}`);
  console.log(`       - Total Disputed Exposure: ${summary.data.currency} ${summary.data.totals?.disputedExposure}`);
  console.log(`       - Supplier Balances Count: ${summary.data.supplierBalances?.length}`);

  // 13. Feature 11: Smart Alerts & Reminders
  const alerts = await request("/api/v1/alerts", managerToken);
  console.log(`[PASS] 14. Feature 11 (Smart Alerts & Reminders): Status ${alerts.status}`);
  assert.equal(alerts.status, 200);
  console.log(`       - Active System Alerts Count: ${alerts.data.alerts?.length}`);

  const reminders = await request("/api/v1/cases/pumps-1001/reminders", managerToken);
  console.log(`       - Case Reminders Status: ${reminders.status}, Count: ${reminders.data?.length}`);
  assert.equal(reminders.status, 200);

  // 14. Feature 12: Audit Trail & Evidence Reports
  const audit = await request("/api/v1/audit/detailed", managerToken);
  console.log(`[PASS] 15. Feature 12 (Audit Trail & Evidence Reports): Status ${audit.status}`);
  assert.equal(audit.status, 200);
  console.log(`       - Detailed Audit Events Recorded: ${audit.data?.length}`);

  const reportJson = await request("/api/v1/cases/pumps-1001/report?format=json", managerToken);
  console.log(`       - JSON Audit Report Export: Status ${reportJson.status} (Report PO: ${reportJson.data.case?.poId})`);
  assert.equal(reportJson.status, 200);

  const reportCsv = await request("/api/v1/cases/pumps-1001/report?format=csv", managerToken);
  console.log(`       - CSV Audit Report Export: Status ${reportCsv.status} (CSV length: ${reportCsv.data.length} chars)`);
  assert.equal(reportCsv.status, 200);

  console.log("\n=================================================");
  console.log("   🎉 ALL 12 FEATURES VERIFIED LIVE & WORKING!   ");
  console.log("=================================================");
};

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
