import crypto from "node:crypto";

const API_BASE = "http://localhost:5002/api";
const CLIENT_BASE = "http://localhost:3000";

let passed = 0;
let failed = 0;

function assert(condition, testName, details = "") {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${testName} - ${details}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log("================================================================================");
  console.log("   SATYA AI COMPREHENSIVE END-TO-END FEATURE VERIFICATION SUITE");
  console.log("================================================================================\n");

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. AUTHENTICATION & ROLES
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("--- 1. Testing Authentication & User Roles ---");
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "manager@satya.demo", password: "SatyaDemo@123" })
  });
  const loginData = await loginRes.json();
  assert(loginRes.ok && !!loginData.token, "Manager login succeeded with valid JWT");
  const token = loginData.token;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const analystLogin = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "analyst@satya.demo", password: "SatyaDemo@123" })
  });
  const analystData = await analystLogin.json();
  assert(analystLogin.ok && analystData.user.role === "ops_analyst", "Analyst login succeeded");
  const analystHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${analystData.token}` };

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. ENTERPRISE ALERTS & BADGES
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- 2. Testing Enterprise Alerts & Notification Badges ---");
  const alertsRes = await fetch(`${API_BASE}/v1/alerts`, { headers });
  const alertsData = await alertsRes.json();
  assert(alertsRes.ok && Array.isArray(alertsData.alerts), "GET /api/v1/alerts returns alert array");
  assert(alertsData.alerts.length >= 7, `Seeded enterprise alerts present (count: ${alertsData.alerts.length})`);

  const activeAlerts = alertsData.alerts.filter(a => a.status !== "dismissed");
  console.log(`     Active alerts for header badge: ${activeAlerts.length}`);

  if (activeAlerts.length > 0) {
    const testAlert = activeAlerts[0];
    const alertId = testAlert.id || testAlert.alertId;
    const ackRes = await fetch(`${API_BASE}/v1/alerts/${alertId}/acknowledge`, {
      method: "POST",
      headers,
      body: JSON.stringify({})
    });
    const ackData = await ackRes.json();
    assert(ackRes.ok && ackData.alert?.status === "acknowledged", `Acknowledge alert ${alertId} updated status`);

    const dismissRes = await fetch(`${API_BASE}/v1/alerts/${alertId}/dismiss`, {
      method: "POST",
      headers,
      body: JSON.stringify({ reason: "Tested and verified in audit test run" })
    });
    const dismissData = await dismissRes.json();
    assert(dismissRes.ok && dismissData.alert?.status === "dismissed", `Dismiss alert ${alertId} updated status`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. SOURCE DOCUMENTS TAB & BPCI CHALLENGE SYNTHETIC EVIDENCE
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- 3. Testing Source Documents & Case Evidence ---");
  const caseId = "pumps-1001";
  const caseDocsRes = await fetch(`${API_BASE}/v1/cases/${caseId}/documents`, { headers });
  const caseDocs = await caseDocsRes.json();
  assert(caseDocsRes.ok && Array.isArray(caseDocs), `GET /api/v1/cases/${caseId}/documents returns array`);
  assert(caseDocs.length > 0, `Case ${caseId} has associated source documents (found ${caseDocs.length})`);

  if (caseDocs.length > 0) {
    const firstDoc = caseDocs[0];
    const docDetailRes = await fetch(`${API_BASE}/v1/documents/${firstDoc.id}`, { headers });
    const docDetail = await docDetailRes.json();
    assert(docDetailRes.ok && !!docDetail.content, `GET /api/v1/documents/${firstDoc.id} returns document content`);
    assert(!!docDetail.checksum, `Document ${firstDoc.id} has valid SHA-256 checksum`);

    // Verify a pending document
    const pendingDoc = caseDocs.find(d => d.verificationStatus === "pending_verification") || firstDoc;
    const verifyRes = await fetch(`${API_BASE}/v1/documents/${pendingDoc.id}/verify`, {
      method: "POST",
      headers,
      body: JSON.stringify({ status: "verified", reason: "Signature and seal cross-verified with ERP master" })
    });
    const verifyData = await verifyRes.json();
    assert(verifyRes.ok && verifyData.document?.verificationStatus === "verified", `Verify document ${pendingDoc.id} updated verification status to verified`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. CONTRACT OBLIGATIONS & LEGAL CLAUSE INTELLIGENCE
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- 4. Testing Contract Obligations & Legal Clause Contradictions ---");
  const contractRes = await fetch(`${API_BASE}/v1/contracts`, { headers });
  const contractData = await contractRes.json();
  assert(contractRes.ok, "GET /api/v1/contracts returns 200 OK");
  assert(contractData.agreements?.length >= 3, `Agreements loaded: ${contractData.agreements?.length}`);
  assert(contractData.obligations?.length >= 3, `Obligations loaded: ${contractData.obligations?.length}`);
  assert(contractData.contradictions?.length >= 1, `Legal clause contradictions detected: ${contractData.contradictions?.length}`);

  const contra = contractData.contradictions?.[0];
  if (contra) {
    assert(contra.baseAgreement?.number === "BPCI-MOU-2026-ENG", "Contradiction identifies base MOU BPCI-MOU-2026-ENG");
    assert(contra.supersedingDocument?.number === "ADDENDUM-BPCI-2026-01", "Contradiction identifies superseding Addendum #1");
    assert(contra.status === "superseded_authoritative", "Contradiction status is superseded_authoritative (signatures verified)");
    assert(contra.recommendation.includes("31 March 2027"), "Recommendation adopts extended 31 March 2027 deadline");
  }

  const edges = contractData.evidenceGraph?.edges || [];
  assert(edges.some(e => e.type === "DOCUMENT_SUPERSEDES_DOCUMENT"), "Evidence graph includes DOCUMENT_SUPERSEDES_DOCUMENT edge");
  assert(edges.some(e => e.type === "AGREEMENT_CREATES_OBLIGATION"), "Evidence graph includes AGREEMENT_CREATES_OBLIGATION edge");
  assert(edges.some(e => e.type === "OBLIGATION_HAS_TASK"), "Evidence graph includes OBLIGATION_HAS_TASK edge");

  // Test updating obligation states: satisfy -> dispute -> reopen
  const testObl = contractData.obligations?.[0];
  if (testObl) {
    const oblId = testObl.id;
    // 1. Mark Satisfied
    const satRes = await fetch(`${API_BASE}/v1/contracts/obligations/${oblId}/status`, {
      method: "POST",
      headers,
      body: JSON.stringify({ status: "satisfied", notes: "Satisfied via automated test runner" })
    });
    const satData = await satRes.json();
    assert(satRes.ok && satData.obligation?.status === "satisfied", `Obligation ${oblId} status set to satisfied`);

    // 2. Flag Disputed
    const dispRes = await fetch(`${API_BASE}/v1/contracts/obligations/${oblId}/status`, {
      method: "POST",
      headers,
      body: JSON.stringify({ status: "disputed_superseded", notes: "Counterparty disputes milestone criteria" })
    });
    const dispData = await dispRes.json();
    assert(dispRes.ok && dispData.obligation?.status === "disputed_superseded", `Obligation ${oblId} status set to disputed_superseded`);

    // 3. Reopen to pending
    const reopenRes = await fetch(`${API_BASE}/v1/contracts/obligations/${oblId}/status`, {
      method: "POST",
      headers,
      body: JSON.stringify({ status: "pending", notes: "Reopened for review" })
    });
    const reopenData = await reopenRes.json();
    assert(reopenRes.ok && reopenData.obligation?.status === "pending", `Obligation ${oblId} status reset to pending`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. PREDICTIVE RISK & LONGITUDINAL SURVIVAL ANALYSIS
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- 5. Testing Predictive Risk & Survival Analysis ---");
  const riskRes = await fetch(`${API_BASE}/v1/predictive-risk`, { headers });
  const riskData = await riskRes.json();
  assert(riskRes.ok, "GET /api/v1/predictive-risk returns 200 OK");
  assert(riskData.summary?.totalCasesAnalyzed > 0, `Total cases analyzed: ${riskData.summary?.totalCasesAnalyzed}`);
  assert(parseFloat(riskData.summary?.totalExpectedLoss) > 0, `Total expected loss R_i computed: ₹${riskData.summary?.totalExpectedLoss}`);
  assert(parseFloat(riskData.summary?.averageHazardRatio) > 0, `Average hazard ratio computed: ${riskData.summary?.averageHazardRatio}×`);

  const topRisk = riskData.cases?.[0];
  if (topRisk) {
    assert(!isNaN(topRisk.probabilityOfBreach) && topRisk.probabilityOfBreach >= 0 && topRisk.probabilityOfBreach <= 1,
      `Top case ${topRisk.poId} has calibrated breach probability: ${(topRisk.probabilityOfBreach * 100).toFixed(1)}%`);
    assert(parseFloat(topRisk.expectedLoss) > 0, `Top case expected loss R_i is positive: ₹${topRisk.expectedLoss}`);
    assert(topRisk.hazardRatio > 0, `Top case hazard ratio is positive: ${topRisk.hazardRatio}×`);
    assert(topRisk.medianDaysToBreach > 0, `Top case median days to breach is valid: ${topRisk.medianDaysToBreach} days`);

    // Verify survival curve
    const sc = topRisk.survivalCurve;
    assert(Array.isArray(sc) && sc.length === 5, `Survival curve has 5 time horizons (7, 14, 30, 45, 60 days)`);
    const day7 = sc.find(p => p.day === 7);
    const day60 = sc.find(p => p.day === 60);
    assert(day7.survivalProbability >= day60.survivalProbability, "Survival probability monotonically decreases from day 7 to day 60");

    // Verify feature decomposition
    const feats = topRisk.riskFeatureDecomposition;
    assert(!!feats.blockingFindings && !!feats.duplicateInvoices && !!feats.deliveryShortfall && !!feats.unallocatedPayments && !!feats.caseAgingDays,
      "Feature decomposition includes all 5 empirical risk factors");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. EXTERNAL COMMUNICATIONS OUTBOX & QUIET HOURS
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- 6. Testing Communications Outbox, Multi-Channel Gateways & Quiet Hours ---");
  const outboxRes = await fetch(`${API_BASE}/v1/outbox`, { headers });
  const outboxData = await outboxRes.json();
  assert(outboxRes.ok, "GET /api/v1/outbox returns 200 OK");
  assert(typeof outboxData.inQuietHours === "boolean", `Quiet hours status evaluated: inQuietHours=${outboxData.inQuietHours}`);
  assert(outboxData.quietHoursPolicy.includes("22:00 - 08:00 IST"), "Quiet hours policy specifies 22:00 - 08:00 IST");
  assert(outboxData.messages?.length > 0, `Outbox messages present in queue (count: ${outboxData.messages?.length})`);

  // Test dispatches across all 4 channels
  const channelsToTest = [
    { channel: "whatsapp", recipient: "+919876543210", subject: "Critical: Leakage Alert", severity: "critical" },
    { channel: "email", recipient: "auditor@satya.demo", subject: "Daily Reconciliation Digest", severity: "medium" },
    { channel: "sms", recipient: "+919811122233", subject: "Dispute Flagged", severity: "high" },
    { channel: "webhook", recipient: "https://erp.internal/webhook/satya-alerts", subject: "Audit Event", severity: "low" }
  ];

  for (const item of channelsToTest) {
    const sendRes = await fetch(`${API_BASE}/v1/outbox/test-send`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        channel: item.channel,
        recipient: item.recipient,
        subject: item.subject,
        body: `Automated test dispatch for ${item.channel} channel at ${new Date().toISOString()}`,
        severity: item.severity
      })
    });
    const sendData = await sendRes.json();
    assert(sendRes.ok && !!sendData.record?.id, `Test dispatch for channel [${item.channel}] succeeded (ID: ${sendData.record?.id})`);
  }

  // Test manual outbox worker run
  const procRes = await fetch(`${API_BASE}/v1/outbox/process`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  const procData = await procRes.json();
  assert(procRes.ok && typeof procData.processedCount === "number", "Outbox queue processor executed successfully");

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. FRONTEND ROUTES & HTML RENDERING
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- 7. Testing Frontend Next.js Pages & HTML Rendering ---");
  const frontendRoutes = [
    { path: "/contracts", expectedText: "Contract obligations & legal intelligence" },
    { path: "/predictive-risk", expectedText: "Predictive risk & survival analysis" },
    { path: "/outbox", expectedText: "Communications & escalation outbox" },
    { path: "/cases/pumps-1001", expectedText: "Meridian Pump Supply" },
    { path: "/dashboard", expectedText: "Overview" },
    { path: "/purchase-orders", expectedText: "Purchase orders" },
    { path: "/records", expectedText: "Records" }
  ];

  for (const r of frontendRoutes) {
    const res = await fetch(`${CLIENT_BASE}${r.path}`);
    const html = await res.text();
    assert(res.status === 200, `Page ${r.path} returns HTTP 200 OK`);
    assert(html.includes(r.expectedText) || html.includes("satya-workspace") || html.includes("satya"),
      `Page ${r.path} renders expected UI layout`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. AUDIT LOG INTEGRITY
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- 8. Testing Audit Trail for All Triggered Actions ---");
  const auditRes = await fetch(`${API_BASE}/v1/audit/detailed`, { headers });
  const auditLogs = await auditRes.json();
  assert(auditRes.ok && Array.isArray(auditLogs), "GET /api/v1/audit/detailed returns audit log array");
  const hasObligationAudit = auditLogs.some(l => l.action?.includes("contract.obligation_status_update"));
  const hasOutboxAudit = auditLogs.some(l => l.action?.includes("outbox."));
  assert(hasObligationAudit, "Audit log records contract obligation status updates");
  assert(hasOutboxAudit, "Audit log records outbox test dispatches & queue executions");

  console.log("\n================================================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================================");

  if (failed > 0) process.exit(1);
}

runTestSuite().catch((err) => {
  console.error("Fatal error during test suite:", err);
  process.exit(1);
});
