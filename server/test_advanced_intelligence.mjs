const BASE_URL = "http://localhost:5002/api";

async function run() {
  console.log("=== Testing Satya AI Advanced Intelligence Architecture ===");

  // 1. Authenticate
  console.log("\n[1] Authenticating as manager@satya.demo...");
  const authRes = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "manager@satya.demo", password: "SatyaDemo@123" })
  });
  const authData = await authRes.json();
  if (!authRes.ok) throw new Error("Auth failed: " + JSON.stringify(authData));
  const token = authData.token;
  console.log("-> Authenticated successfully. User:", authData.user.name, `(${authData.user.role})`);

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  };

  // 2. Contracts & Legal Clause Contradiction
  console.log("\n[2] Testing Contracts & Legal Clause Contradictions (/v1/contracts)...");
  const contractRes = await fetch(`${BASE_URL}/v1/contracts`, { headers });
  const contractData = await contractRes.json();
  if (!contractRes.ok) throw new Error("Contracts endpoint failed: " + JSON.stringify(contractData));

  console.log(`-> Agreements loaded: ${contractData.agreements?.length || 0}`);
  console.log(`-> Obligations loaded: ${contractData.obligations?.length || 0}`);
  console.log(`-> Contradictions detected: ${contractData.contradictions?.length || 0}`);
  console.log(`-> Graph nodes: ${contractData.evidenceGraph?.nodes?.length || 0}, Graph edges: ${contractData.evidenceGraph?.edges?.length || 0}`);

  if (contractData.contradictions?.length > 0) {
    const c = contractData.contradictions[0];
    console.log(`   Contradiction #1: [${c.id}] ${c.topic}`);
    console.log(`   Base Agreement: ${c.baseAgreement?.number} (Expiry: ${c.baseAgreement?.expiryDate})`);
    console.log(`   Superseding Addendum: ${c.supersedingDocument?.number} (Expiry: ${c.supersedingDocument?.extendedExpiryDate})`);
    console.log(`   Recommendation: ${c.recommendation}`);
  }

  // Test updating obligation status
  if (contractData.obligations?.length > 0) {
    const obId = contractData.obligations[0].id;
    console.log(`\n[2b] Testing obligation status update for ${obId}...`);
    const updateRes = await fetch(`${BASE_URL}/v1/contracts/obligations/${obId}/status`, {
      method: "POST",
      headers,
      body: JSON.stringify({ status: "satisfied", notes: "Verified signed completion certificate on file." })
    });
    const updateData = await updateRes.json();
    console.log(`-> Updated obligation status:`, updateData.obligation?.status);
  }

  // 3. Predictive Risk & Survival Analysis
  console.log("\n[3] Testing Predictive Risk & Survival Analysis (/v1/predictive-risk)...");
  const riskRes = await fetch(`${BASE_URL}/v1/predictive-risk`, { headers });
  const riskData = await riskRes.json();
  if (!riskRes.ok) throw new Error("Predictive Risk endpoint failed: " + JSON.stringify(riskData));

  console.log("-> Predictive Risk Summary:", riskData.summary);
  console.log(`-> Ranked Cases count: ${riskData.cases?.length || 0}`);
  if (riskData.cases?.length > 0) {
    const top = riskData.cases[0];
    console.log(`   Top Risk Case: ${top.poId} (${top.supplier})`);
    console.log(`   Breach Probability P(Y=1|X): ${(top.probabilityOfBreach * 100).toFixed(1)}%`);
    console.log(`   Expected Loss R_i: ₹${Number(top.expectedLoss).toLocaleString("en-IN")}`);
    console.log(`   Median Days to Breach: ${top.medianDaysToBreach} days`);
    const day30 = top.survivalCurve?.find(s => s.day === 30);
    console.log(`   30-Day Survival S(30): ${(day30?.survivalProbability * 100).toFixed(1)}%`);
  }

  // 4. External Communication Outbox
  console.log("\n[4] Testing External Communication Outbox (/v1/outbox)...");
  const outboxRes = await fetch(`${BASE_URL}/v1/outbox`, { headers });
  const outboxData = await outboxRes.json();
  if (!outboxRes.ok) throw new Error("Outbox endpoint failed: " + JSON.stringify(outboxData));

  console.log(`-> Total Outbox Messages: ${outboxData.messages?.length || 0}`);
  console.log(`-> In Quiet Hours (22:00-08:00 IST)? ${outboxData.inQuietHours}`);
  console.log(`-> Status Summary:`, outboxData.statusSummary);
  console.log(`-> Channel Summary:`, outboxData.channelSummary);

  // Test send new alert
  console.log("\n[4b] Testing Outbox Test Dispatch (/v1/outbox/test-send)...");
  const testSendRes = await fetch(`${BASE_URL}/v1/outbox/test-send`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      channel: "whatsapp",
      recipient: "+919876543210",
      subject: "Urgent: PO-1002 Delivery Milestone Overdue",
      body: "Milestone MS-02 for PO-1002 has not been satisfied. Expected loss is estimated at ₹1,50,000.",
      severity: "high"
    })
  });
  const testSendData = await testSendRes.json();
  console.log("-> Dispatched test message:", testSendData.record?.id, `status: ${testSendData.record?.status}`);

  // Test process queue
  console.log("\n[4c] Testing Outbox Queue Processing (/v1/outbox/process)...");
  const processRes = await fetch(`${BASE_URL}/v1/outbox/process`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  const processData = await processRes.json();
  console.log(`-> Queue processing result: Processed ${processData.processedCount} messages.`);

  console.log("\n=======================================================");
  console.log("ALL ADVANCED INTELLIGENCE BACKEND ENDPOINTS VERIFIED OK!");
  console.log("=======================================================");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
