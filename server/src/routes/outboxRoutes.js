import express from "express";
import { OutboxMessage } from "../models/Business.js";
import { processOutboxQueue, queueNotificationMessage, isWithinQuietHours, seedOutboxMessages } from "../utils/communicationOutboxService.js";
import { generateExecutiveReportPdf } from "../utils/pdfReportService.js";
import { protect } from "../middleware/authMiddleware.js";
import { recordAudit } from "../utils/audit.js";

const router = express.Router();
router.use(protect);

const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

router.get("/report/pdf", handle(async (req, res) => {
  const pdfBuffer = await generateExecutiveReportPdf({
    title: "Satya AI Communications & Breach Escalation Brief",
    subtitle: "Transactional Outbox & Multi-Channel Delivery Digest · BPCI Procurement",
    companyName: req.user.companyId === "satya-demo" ? "Bharat Petroleum Procurement & Infrastructure (BPCI)" : req.user.companyId
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="BPCI_Outbox_Escalation_Report_${Date.now()}.pdf"`);
  res.send(pdfBuffer);
}));

router.get("/", handle(async (req, res) => {
  const companyId = req.user.companyId;
  const count = await OutboxMessage.countDocuments({ companyId });
  if (count === 0) {
    await seedOutboxMessages(companyId);
  }

  const rawMessages = await OutboxMessage.find({ companyId }).sort({ createdAt: -1 }).limit(100).lean();
  const now = new Date();
  const inQuietHours = isWithinQuietHours(now);

  const messages = rawMessages.map(m => ({
    ...m,
    scheduledAt: m.scheduledAt || m.createdAt || new Date(),
    deliveredAt: m.deliveredAt || (m.status === "sent" ? (m.updatedAt || m.createdAt) : null),
    attempts: typeof m.attempts === "number" ? m.attempts : 1
  }));

  const statusSummary = {
    queued: messages.filter(m => m.status === "queued").length,
    quiet_hours_delayed: messages.filter(m => m.status === "quiet_hours_delayed").length,
    sent: messages.filter(m => m.status === "sent").length,
    failed: messages.filter(m => m.status === "failed").length
  };

  const channelSummary = {
    whatsapp: messages.filter(m => m.channel === "whatsapp").length,
    email: messages.filter(m => m.channel === "email").length,
    sms: messages.filter(m => m.channel === "sms").length,
    webhook: messages.filter(m => m.channel === "webhook").length
  };

  res.json({
    messages,
    inQuietHours,
    quietHoursPolicy: "22:00 - 08:00 IST (Indian Standard Time)",
    statusSummary,
    channelSummary
  });
}));

router.post("/reseed", handle(async (req, res) => {
  const companyId = req.user.companyId;
  await seedOutboxMessages(companyId);
  const messages = await OutboxMessage.find({ companyId }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ message: "Outbox re-seeded with BPCI challenge communications", count: messages.length });
}));

router.post("/process", handle(async (req, res) => {
  const companyId = req.user.companyId;
  const dispatchResult = await processOutboxQueue(companyId);
  await recordAudit({ req, action: "outbox.manual_process", target: companyId, meta: dispatchResult });
  res.json(dispatchResult);
}));

router.post("/test-send", handle(async (req, res) => {
  const companyId = req.user.companyId;
  const { channel, recipient, subject, body, severity } = req.body;

  if (!["whatsapp", "email", "sms", "webhook"].includes(channel)) {
    return res.status(422).json({ message: "Invalid communication channel" });
  }
  if (!recipient || !body) {
    return res.status(422).json({ message: "Recipient and body are required" });
  }

  const idempotencyKey = `manual:${channel}:${Date.now()}`;
  const result = await queueNotificationMessage({
    companyId,
    channel,
    recipient,
    subject: subject || "Satya AI Test Dispatch",
    body,
    severity: severity || "medium",
    idempotencyKey
  });

  // Attempt immediate processing
  await processOutboxQueue(companyId);

  const fresh = await OutboxMessage.findOne({ companyId, idempotencyKey }).lean();
  const formatted = fresh ? {
    ...fresh,
    scheduledAt: fresh.scheduledAt || fresh.createdAt || new Date(),
    deliveredAt: fresh.deliveredAt || (fresh.status === "sent" ? new Date() : null),
    attempts: typeof fresh.attempts === "number" ? fresh.attempts : 1
  } : null;

  await recordAudit({ req, action: "outbox.test_send", target: fresh?.id, meta: { channel, recipient } });
  res.status(201).json({ message: "Notification queued and dispatched", record: formatted });
}));

export default router;
