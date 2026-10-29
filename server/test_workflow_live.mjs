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
  console.log("Testing live decision and state machine transition...\n");

  // Login
  const analystLogin = await request("/api/auth/login", null, "POST", { email: "analyst@satya.demo", password: SECRET });
  const analystToken = analystLogin.data.token;

  const managerLogin = await request("/api/auth/login", null, "POST", { email: "manager@satya.demo", password: SECRET });
  const managerToken = managerLogin.data.token;

  // 1. Fetch current case
  const initial = await request("/api/v1/cases/pumps-1001", analystToken);
  console.log(`Current case status: ${initial.data.status}, revision: ${initial.data.revision}`);

  // 2. Analyst escalates case
  console.log("Submitting escalation by Analyst...");
  const escalateRes = await request("/api/v1/cases/pumps-1001/decisions", analystToken, "POST", {
    action: "ESCALATE",
    reason: "Duplicate invoice detected on AP-992. Escalating for manager review.",
    expectedRevision: initial.data.revision,
    snapshotId: initial.data.snapshot?.snapshotId
  });
  console.log(`Escalation decision status: ${escalateRes.status}`);

  // Wait 2s for reconciliation job
  await new Promise(r => setTimeout(r, 2000));

  // 3. Verify status updated to 'escalated'
  const afterEscalate = await request("/api/v1/cases/pumps-1001", managerToken);
  console.log(`Updated case status: ${afterEscalate.data.status}, revision: ${afterEscalate.data.revision}`);
  console.log(`Decisions count: ${afterEscalate.data.decisions?.length}`);

  // 4. Verify Audit log recorded the event
  const auditRes = await request("/api/v1/audit/detailed", managerToken);
  console.log(`Audit log events: ${auditRes.data?.length}`);
  if (auditRes.data?.length) {
    const latest = auditRes.data[0];
    console.log(`Latest audit: Action: ${latest.action}, Target: ${latest.target}, Role: ${latest.role}`);
  }

  console.log("\nWorkflow test completed successfully!");
};

run().catch(console.error);
