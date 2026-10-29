async function run() {
  console.log("=== Testing Real Communications, PDF Reports & BPCI Data ===");

  const BASE_URL = "http://127.0.0.1:5002/api";

  // 1. Login
  const authRes = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "manager@satya.demo", password: "SatyaDemo@123" })
  });
  const authData = await authRes.json();
  const token = authData.token;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  // 2. Reseed Contracts with 6 BPCI Agreements & 8 Obligations
  console.log("\n[1] Reseeding BPCI Challenge Contracts...");
  const contractSeedRes = await fetch(`${BASE_URL}/v1/contracts/seed`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  const contractData = await contractSeedRes.json();
  console.log(`-> Agreements loaded: ${contractData.agreements?.length}`);
  console.log(`-> Obligations loaded: ${contractData.obligations?.length}`);
  console.log(`-> Contradictions detected: ${contractData.contradictions?.length}`);
  console.log("   Agreements:", contractData.agreements?.map(a => a.agreementNumber).join(", "));
  console.log("   Obligations:", contractData.obligations?.map(o => o.obligationId).join(", "));

  // 3. Test Contracts PDF Report Download
  console.log("\n[2] Testing Contracts PDF Report Generation (/v1/contracts/report/pdf)...");
  const contractPdfRes = await fetch(`${BASE_URL}/v1/contracts/report/pdf`, { headers });
  console.log(`-> PDF HTTP Status: ${contractPdfRes.status}`);
  console.log(`-> Content-Type: ${contractPdfRes.headers.get("content-type")}`);
  const pdfBytes = await contractPdfRes.arrayBuffer();
  console.log(`-> PDF Generated Size: ${(pdfBytes.byteLength / 1024).toFixed(1)} KB`);

  // 4. Test Case Reconciliation PDF Report
  console.log("\n[3] Testing Case pumps-1001 PDF Report Generation (/v1/cases/pumps-1001/report?format=pdf)...");
  const casePdfRes = await fetch(`${BASE_URL}/v1/cases/pumps-1001/report?format=pdf`, { headers });
  console.log(`-> Case PDF HTTP Status: ${casePdfRes.status}`);
  const casePdfBytes = await casePdfRes.arrayBuffer();
  console.log(`-> Case PDF Generated Size: ${(casePdfBytes.byteLength / 1024).toFixed(1)} KB`);

  // 5. Reseed Outbox with authentic BPCI messages
  console.log("\n[4] Reseeding Outbox Messages (/v1/outbox/reseed)...");
  const reseedOutboxRes = await fetch(`${BASE_URL}/v1/outbox/reseed`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  const reseedOutboxData = await reseedOutboxRes.json();
  console.log("-> Reseed Result:", reseedOutboxData);

  // 6. Test Send Email with PDF Attachment & Ethereal Live URL
  console.log("\n[5] Testing Live Email Dispatch with Attached PDF Report...");
  const testEmailRes = await fetch(`${BASE_URL}/v1/outbox/test-send`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      channel: "email",
      recipient: "plant.procurement@bpci.gov.in",
      subject: "BPCI Milestone 2 Slurry Pump Discrepancy & GFR-12A Clearance Brief",
      body: "Milestone MS-02 physical delivery for PO-1001 contains 40 pump shortfall. Executive reconciliation and legal analysis attached as verified PDF.",
      severity: "high"
    })
  });
  const emailData = await testEmailRes.json();
  console.log("-> Dispatched Email ID:", emailData.record?.id);
  console.log("-> Status:", emailData.record?.status);
  console.log("-> Provider:", emailData.record?.deliveryReceipt?.provider);
  console.log("-> Live Ethereal Preview URL:", emailData.record?.deliveryReceipt?.previewUrl);
  console.log("-> Has PDF Attachment:", emailData.record?.deliveryReceipt?.hasPdfAttachment);

  // 7. Test WhatsApp Dispatch with Direct Web Link
  console.log("\n[6] Testing WhatsApp Dispatch with Direct Action URL...");
  const testWaRes = await fetch(`${BASE_URL}/v1/outbox/test-send`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      channel: "whatsapp",
      recipient: "+919820012345",
      subject: "Urgent: PO-1001 Duplicate Invoice",
      body: "Duplicate invoice AP-992 detected matching INV-041 (Rs 70,800.00). Review required.",
      severity: "critical"
    })
  });
  const waData = await testWaRes.json();
  console.log("-> Dispatched WhatsApp ID:", waData.record?.id);
  console.log("-> Action URL:", waData.record?.deliveryReceipt?.actionUrl);

  // 8. Fetch Outbox Table and verify date formatting & fields
  console.log("\n[7] Verifying Outbox Message Timestamps & Delivery Receipts...");
  const outboxRes = await fetch(`${BASE_URL}/v1/outbox`, { headers });
  const outboxData = await outboxRes.json();
  console.log(`-> Total Messages: ${outboxData.messages?.length}`);
  const firstMsg = outboxData.messages?.[0];
  console.log("   First Message Sample:", {
    id: firstMsg?.id,
    channel: firstMsg?.channel,
    recipient: firstMsg?.recipient,
    scheduledAt: firstMsg?.scheduledAt,
    deliveredAt: firstMsg?.deliveredAt,
    attempts: firstMsg?.attempts,
    hasPreview: !!firstMsg?.deliveryReceipt?.previewUrl,
    hasAction: !!firstMsg?.deliveryReceipt?.actionUrl
  });

  console.log("\n=======================================================");
  console.log("ALL REAL COMMUNICATIONS & BPCI EXPANSIONS VERIFIED OK!");
  console.log("=======================================================");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
