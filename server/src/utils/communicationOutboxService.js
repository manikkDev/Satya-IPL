import crypto from "node:crypto";
import { OutboxMessage } from "../models/Business.js";

// Quiet hours policy: 22:00 (10 PM) to 08:00 (8 AM) India Standard Time (UTC+5:30)
export function isWithinQuietHours(date = new Date()) {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(date.getTime() + istOffset);
  const hour = istTime.getUTCHours();
  return hour >= 22 || hour < 8;
}

export function getNextQuietHoursEnd(date = new Date()) {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(date.getTime() + istOffset);
  const next8am = new Date(istTime);
  if (istTime.getUTCHours() >= 22) {
    next8am.setUTCDate(next8am.getUTCDate() + 1);
  }
  next8am.setUTCHours(8, 0, 0, 0);
  return new Date(next8am.getTime() - istOffset);
}

/**
 * Dispatches an individual message across its designated channel (sandbox/simulated with production schema)
 */
async function dispatchMessageChannel(msg) {
  const startTime = Date.now();
  let status = "sent";
  let deliveryReceipt = {};
  let error = null;

  try {
    switch (msg.channel) {
      case "whatsapp": {
        // WhatsApp Business Cloud API payload
        deliveryReceipt = {
          provider: "Meta WhatsApp Cloud API (Sandbox)",
          messageId: `wamid.HBgL${crypto.randomBytes(8).toString("hex")}`,
          recipient: msg.recipient,
          template: "satya_enterprise_alert_v1",
          status: "delivered",
          timestamp: new Date().toISOString()
        };
        break;
      }
      case "email": {
        // SendGrid / Enterprise SMTP payload
        deliveryReceipt = {
          provider: "SendGrid / Enterprise SMTP Gateway",
          messageId: `<${crypto.randomBytes(12).toString("hex")}@mail.satya.ai>`,
          recipient: msg.recipient,
          subject: msg.subject || "Satya AI Alert",
          status: "accepted_202",
          timestamp: new Date().toISOString()
        };
        break;
      }
      case "sms": {
        // Twilio / DLT Compliant SMS payload
        deliveryReceipt = {
          provider: "Twilio SMS (DLT Header: SATYAI)",
          sid: `SM${crypto.randomBytes(16).toString("hex")}`,
          to: msg.recipient,
          encoding: "GSM-7",
          status: "delivered_carrier",
          timestamp: new Date().toISOString()
        };
        break;
      }
      case "webhook": {
        // Enterprise Webhook Dispatch with HMAC-SHA256 signature
        const secret = process.env.WEBHOOK_SECRET || "satya-webhook-secret-99";
        const signature = crypto.createHmac("sha256", secret).update(msg.body).digest("hex");
        deliveryReceipt = {
          provider: "Enterprise Webhook Gateway",
          targetUrl: msg.recipient,
          httpStatus: 200,
          signatureHeader: `sha256=${signature}`,
          latencyMs: Date.now() - startTime,
          timestamp: new Date().toISOString()
        };
        break;
      }
      default:
        throw new Error(`Unsupported communication channel: ${msg.channel}`);
    }
  } catch (err) {
    status = "failed";
    error = err.message;
  }

  return { status, deliveryReceipt, error };
}

/**
 * Processes queued outbox messages, enforcing quiet hours, retry backoff, and idempotent delivery.
 */
export async function processOutboxQueue(companyId) {
  const now = new Date();
  const inQuietHours = isWithinQuietHours(now);

  const pending = await OutboxMessage.find({
    companyId,
    status: { $in: ["queued", "quiet_hours_delayed", "failed"] },
    nextAttemptAt: { $lte: now },
    attempts: { $lt: 4 }
  }).sort({ createdAt: 1 }).limit(25);

  const results = [];

  for (const msg of pending) {
    // If inside quiet hours and NOT critical escalation, delay until 8 AM
    if (inQuietHours && msg.severity !== "critical_escalation") {
      const nextOpen = getNextQuietHoursEnd(now);
      await OutboxMessage.updateOne(
        { companyId, id: msg.id },
        {
          $set: {
            status: "quiet_hours_delayed",
            nextAttemptAt: nextOpen,
            lastError: "Message delivery paused during Quiet Hours (22:00 - 08:00 IST)"
          }
        }
      );
      results.push({ messageId: msg.messageId, status: "quiet_hours_delayed", nextAttemptAt: nextOpen });
      continue;
    }

    // Attempt dispatch
    const attempt = msg.attempts + 1;
    const { status, deliveryReceipt, error } = await dispatchMessageChannel(msg);

    if (status === "sent") {
      await OutboxMessage.updateOne(
        { companyId, id: msg.id },
        {
          $set: {
            status: "sent",
            attempts: attempt,
            lastAttemptAt: now,
            deliveredAt: now,
            deliveryReceipt,
            lastError: null
          }
        }
      );
      results.push({ messageId: msg.messageId, status: "sent", receipt: deliveryReceipt });
    } else {
      const backoffSeconds = Math.min(3600, Math.pow(2, attempt) * 30);
      const nextRetry = new Date(now.getTime() + backoffSeconds * 1000);
      const isExhausted = attempt >= msg.maxAttempts;

      await OutboxMessage.updateOne(
        { companyId, id: msg.id },
        {
          $set: {
            status: isExhausted ? "failed" : "queued",
            attempts: attempt,
            lastAttemptAt: now,
            nextAttemptAt: nextRetry,
            lastError: error
          }
        }
      );
      results.push({ messageId: msg.messageId, status: isExhausted ? "exhausted_failed" : "retrying", nextRetry });
    }
  }

  return {
    processedCount: pending.length,
    inQuietHours,
    results
  };
}

/**
 * Creates and queues a new transactional outbox message with idempotency deduplication.
 */
export async function queueNotificationMessage({
  companyId,
  channel,
  recipient,
  subject,
  body,
  severity = "medium",
  caseId = null,
  idempotencyKey
}) {
  const existing = await OutboxMessage.findOne({ companyId, idempotencyKey });
  if (existing) {
    return { deduplicated: true, message: existing };
  }

  const messageId = `MSG-${channel.toUpperCase()}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const now = new Date();
  const inQuietHours = isWithinQuietHours(now);
  const status = inQuietHours && severity !== "critical_escalation" ? "quiet_hours_delayed" : "queued";
  const nextAttemptAt = status === "quiet_hours_delayed" ? getNextQuietHoursEnd(now) : now;

  const msg = await OutboxMessage.create({
    companyId,
    id: messageId,
    messageId,
    channel,
    recipient,
    subject,
    body,
    severity,
    caseId,
    status,
    idempotencyKey,
    nextAttemptAt
  });

  return { deduplicated: false, message: msg };
}

export async function seedOutboxMessages(companyId = "satya-demo") {
  console.log(`[OutboxSeed] Seeding sample multi-channel communication records for ${companyId}...`);

  const samples = [
    {
      companyId,
      id: "MSG-WA-001",
      messageId: "MSG-WA-001",
      channel: "whatsapp",
      recipient: "+91 98200 12345 (A. K. Mehta - Meridian Director)",
      subject: "BPCI Dispute Escalation Notice",
      body: "Satya AI Alert: Case PO-1001 duplicate invoice submission AP-992 detected matching INV-041 (₹70,800.00). Please provide clarification via BPCI Vendor Portal.",
      severity: "high",
      caseId: "pumps-1001",
      status: "sent",
      idempotencyKey: "pumps-1001:escalation:whatsapp",
      attempts: 1,
      deliveredAt: new Date(Date.now() - 3600000),
      deliveryReceipt: {
        provider: "Meta WhatsApp Cloud API",
        messageId: "wamid.HBgLMjA4MDk3NzUxOTk",
        status: "read_by_recipient",
        timestamp: new Date(Date.now() - 3500000).toISOString()
      }
    },
    {
      companyId,
      id: "MSG-EM-002",
      messageId: "MSG-EM-002",
      channel: "email",
      recipient: "manager@satya.demo",
      subject: "[ACTION REQUIRED] PO-1001 3-Way Match Exception Clearance",
      body: "Order PO-1001 (Meridian Pump Supply) has 3 blocking discrepancy findings and 1 unallocated bank transfer (₹15,000.00). Manager review required prior to payout.",
      severity: "high",
      caseId: "pumps-1001",
      status: "sent",
      idempotencyKey: "pumps-1001:manager:email",
      attempts: 1,
      deliveredAt: new Date(Date.now() - 7200000),
      deliveryReceipt: {
        provider: "SendGrid Enterprise SMTP",
        messageId: "<msg-8938493@mail.satya.ai>",
        status: "delivered",
        timestamp: new Date(Date.now() - 7190000).toISOString()
      }
    },
    {
      companyId,
      id: "MSG-SMS-003",
      messageId: "MSG-SMS-003",
      channel: "sms",
      recipient: "+91 98190 54321 (Treasury Ops Lead)",
      subject: null,
      body: "SATYAI: Unallocated SBI NEFT transfer of Rs 15,000 (UTR: SBIN2026100703) requires invoice tagging in PO-1001. Open Satya App to resolve.",
      severity: "medium",
      caseId: "pumps-1001",
      status: "sent",
      idempotencyKey: "pumps-1001:treasury:sms",
      attempts: 1,
      deliveredAt: new Date(Date.now() - 10800000),
      deliveryReceipt: {
        provider: "Twilio SMS Gateway",
        sid: "SM892348923749823749",
        status: "delivered_carrier",
        timestamp: new Date(Date.now() - 10790000).toISOString()
      }
    },
    {
      companyId,
      id: "MSG-WH-004",
      messageId: "MSG-WH-004",
      channel: "webhook",
      recipient: "https://erp.bpci.internal/api/v2/satya-events",
      subject: "BPCI ERP Webhook Notification",
      body: JSON.stringify({
        event: "reconciliation.exception_escalated",
        caseId: "pumps-1001",
        poId: "PO-1001",
        supplier: "Meridian Pump Supply",
        disputedExposure: 70800.00,
        status: "escalated"
      }),
      severity: "high",
      caseId: "pumps-1001",
      status: "sent",
      idempotencyKey: "pumps-1001:erp:webhook",
      attempts: 1,
      deliveredAt: new Date(Date.now() - 5400000),
      deliveryReceipt: {
        provider: "Enterprise Webhook Dispatcher",
        targetUrl: "https://erp.bpci.internal/api/v2/satya-events",
        httpStatus: 200,
        latencyMs: 142,
        timestamp: new Date(Date.now() - 5399000).toISOString()
      }
    },
    {
      companyId,
      id: "MSG-QUEUED-005",
      messageId: "MSG-QUEUED-005",
      channel: "email",
      recipient: "auditor@satya.demo",
      subject: "Weekly Compliance & 3-Way Reconciliation Audit Pack",
      body: "Weekly audit report for 5 active industrial cases ready for inspection in Satya Audit Center.",
      severity: "medium",
      caseId: null,
      status: "queued",
      idempotencyKey: "audit:weekly:auditor",
      attempts: 0,
      nextAttemptAt: new Date()
    }
  ];

  for (const s of samples) {
    await OutboxMessage.updateOne(
      { companyId, id: s.id },
      { $set: { ...s, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
  }

  console.log(`[OutboxSeed] Successfully seeded ${samples.length} outbox communication messages.`);
}
