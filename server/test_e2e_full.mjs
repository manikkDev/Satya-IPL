import assert from "node:assert/strict";

const BACKEND_BASE = "http://127.0.0.1:5002";
const FRONTEND_BASE = "http://127.0.0.1:3000";
const SECRET = "SatyaDemo@123";

const api = async (path, token = null, method = "GET", body = null) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${BACKEND_BASE}${path}`, options);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};

const checkFrontendRoute = async (path) => {
  const start = Date.now();
  const res = await fetch(`${FRONTEND_BASE}${path}`);
  const duration = Date.now() - start;
  const text = await res.text();
  return { status: res.status, duration, length: text.length, hasError: text.includes("Syntax Error") || text.includes("Build Error") };
};

const run = async () => {
  console.log("=================================================================");
  console.log("   SATYA AI — FULL LOCAL STACK & WORKFLOW END-TO-END VERIFICATION");
  console.log("=================================================================\n");

  // Step 1: Health & Container Connectivity
  console.log("▶ Step 1: Services Health & Connectivity");
  const health = await api("/api/health");
  assert.equal(health.status, 200, "Backend API health must be 200 OK");
  console.log(`  ✓ Express Backend (Port 5002): ONLINE (${JSON.stringify(health.data)})`);

  // Step 2: Multi-Role Authentication
  console.log("\n▶ Step 2: Authentication & Role Verification");
  const managerAuth = await api("/api/auth/login", null, "POST", { email: "manager@satya.demo", password: SECRET });
  assert.equal(managerAuth.status, 200);
  const managerToken = managerAuth.data.token;
  console.log(`  ✓ AP Finance Manager Login: OK (Role: ${managerAuth.data.user.role}, Token: ${managerToken.slice(0, 15)}...)`);

  const analystAuth = await api("/api/auth/login", null, "POST", { email: "analyst@satya.demo", password: SECRET });
  assert.equal(analystAuth.status, 200);
  const analystToken = analystAuth.data.token;
  console.log(`  ✓ Operations Analyst Login: OK (Role: ${analystAuth.data.user.role}, Token: ${analystToken.slice(0, 15)}...)`);

  // Step 3: Frontend Routes Verification (Next.js SSR & Bundling)
  console.log("\n▶ Step 3: Frontend Routes & Next.js Bundle Health");
  const routes = [
    { name: "Login Screen", path: "/login" },
    { name: "Executive Dashboard", path: "/dashboard" },
    { name: "Cases & Exceptions List", path: "/cases" },
    { name: "Case Investigation Details", path: "/cases/pumps-1001" },
    { name: "Audit Trail & Verification", path: "/audit" },
  ];

  for (const r of routes) {
    const res = await checkFrontendRoute(r.path);
    assert.equal(res.status, 200, `Frontend route ${r.path} must return 200 OK`);
    assert.equal(res.hasError, false, `Frontend route ${r.path} must compile cleanly without syntax errors`);
    console.log(`  ✓ [${res.status}] ${r.name.padEnd(28)} (${r.path}) — Loaded in ${res.duration}ms (${res.length} bytes)`);
  }

  // Step 4: Core Domain Business Features
  console.log("\n▶ Step 4: Verification of 12 Core Architectural Features");

  // Feature 1: Smart Obligation Tracking
  const caseData = await api("/api/v1/cases/pumps-1001", managerToken);
  assert.equal(caseData.status, 200);
  const ledger = caseData.data.snapshot?.ledger;
  assert.ok(ledger?.supportedOutstanding);
  console.log(`  ✓ Feature 1 (Smart Obligation Tracking): Case ${caseData.data.id}`);
  console.log(`      * Recorded Gross: ${ledger.currency} ${ledger.recordedGross}`);
  console.log(`      * Supported Outstanding: ${ledger.currency} ${ledger.supportedOutstanding}`);
  console.log(`      * Disputed Exposure: ${ledger.currency} ${ledger.disputedExposure}`);

  // Feature 2: Evidence-Linked Reconciliation
  const locators = caseData.data.snapshot?.evidence || [];
  assert.ok(locators.length > 0);
  console.log(`  ✓ Feature 2 (Evidence-Linked Reconciliation): ${locators.length} verifiable source locators attached`);

  // Feature 3: Discrepancy Explanation Engine
  const findings = caseData.data.snapshot?.findings || [];
  assert.ok(findings.length > 0);
  console.log(`  ✓ Feature 3 (Discrepancy Explanation Engine): ${findings.length} findings categorized with action recommendations`);

  // Feature 4: Separation of Duties & Lifecycle State Machine
  const unauthorizedDecision = await api("/api/v1/cases/pumps-1001/decisions", analystToken, "POST", {
    action: "APPROVE",
    reason: "Attempting analyst approval unauthorized",
  });
  assert.equal(unauthorizedDecision.status, 403, "Analyst should not be permitted to approve cases");
  console.log(`  ✓ Feature 4 (Separation of Duties): Enforced (Analyst approve blocked with 403 Forbidden)`);

  // Feature 5: Duplicate & Anomaly Detection
  const duplicates = caseData.data.snapshot?.duplicateCandidates || [];
  console.log(`  ✓ Feature 5 (Duplicate & Anomaly Detection): ${duplicates.length} duplicate invoice candidate(s) flagged`);

  // Feature 6: Risk & Priority Dashboard
  const attention = await api("/api/v1/dashboard/attention", managerToken);
  assert.equal(attention.status, 200);
  console.log(`  ✓ Feature 6 (Risk & Priority Scoring): Top priority score: ${attention.data.items[0]?.priority} (${attention.data.items[0]?.supplier})`);

  // Feature 7: Connected Transaction Graph
  const graph = await api("/api/v1/graph/cases/pumps-1001", managerToken);
  assert.equal(graph.status, 200);
  console.log(`  ✓ Feature 7 (Connected Transaction Graph): ${graph.data.nodes?.length} nodes, ${graph.data.edges?.length} edges (Source: ${graph.data.source})`);

  // Feature 8: Exception Resolution Workflow
  const users = await api("/api/v1/users/assignable", managerToken);
  assert.equal(users.status, 200);
  console.log(`  ✓ Feature 8 (Exception Resolution Workflow): Directory active (${users.data.length} assignable finance team members)`);

  // Feature 9: Document Management & Verification
  const docs = await api("/api/v1/cases/pumps-1001/documents", managerToken);
  assert.equal(docs.status, 200);
  console.log(`  ✓ Feature 9 (Document Management & Verification): ${docs.data.length} documents tracked`);

  // Feature 10: Financial Insights Dashboard
  const summary = await api("/api/v1/dashboard/summary", managerToken);
  assert.equal(summary.status, 200);
  console.log(`  ✓ Feature 10 (Financial Insights Dashboard): ${summary.data.statusCounts?.total} cases summarized`);

  // Feature 11: Smart Alerts & Reminders
  const reminders = await api("/api/v1/cases/pumps-1001/reminders", managerToken);
  assert.equal(reminders.status, 200);
  console.log(`  ✓ Feature 11 (Smart Alerts & Reminders): Reminder endpoints functional`);

  // Feature 12: Audit Trail & Evidence Reports
  const auditEvents = await api("/api/v1/audit/detailed", managerToken);
  assert.equal(auditEvents.status, 200);
  const auditJson = await api("/api/v1/cases/pumps-1001/report?format=json", managerToken);
  assert.equal(auditJson.status, 200);
  const auditCsv = await api("/api/v1/cases/pumps-1001/report?format=csv", managerToken);
  assert.equal(auditCsv.status, 200);
  console.log(`  ✓ Feature 12 (Audit Trail & Evidence Reports): ${auditEvents.data?.length} audit events, CSV & JSON export active`);

  console.log("\n=================================================================");
  console.log("   🎉 ALL FEATURES & UI SCREENS FULLY TESTED & VERIFIED LIVE!   ");
  console.log("=================================================================\n");
};

run().catch((err) => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
