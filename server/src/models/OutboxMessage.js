import mongoose from "mongoose";

// Supplier communication outbox. Email is really sent only when SMTP is
// configured; WhatsApp/SMS are share links the user opens on their own
// device — Satya never claims a delivery it cannot observe.
const outboxSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    groupId: { type: String, required: true, index: true },
    entityId: { type: String, index: true },
    caseId: { type: String, index: true },
    supplierId: { type: String, index: true },
    channel: { type: String, enum: ["email", "whatsapp", "sms"], required: true },
    to: { type: String, required: true },
    subject: { type: String, maxlength: 200 },
    body: { type: String, required: true, maxlength: 5000 },
    // queued → (scheduled for quiet hours) → sent | failed; link channels are link_ready;
    // email without SMTP is not_configured.
    status: {
      type: String,
      enum: ["queued", "scheduled", "sending", "sent", "failed", "link_ready", "not_configured", "cancelled"],
      default: "queued",
      index: true,
    },
    link: String,
    scheduledFor: String, // ISO
    attempts: { type: Number, default: 0 },
    lastError: String,
    providerMessageId: String,
    idempotencyKey: { type: String, required: true },
    createdBy: { type: String, required: true },
    sentAt: String,
  },
  { timestamps: true, minimize: false },
);
outboxSchema.index({ groupId: 1, id: 1 }, { unique: true });
outboxSchema.index({ groupId: 1, idempotencyKey: 1 }, { unique: true });
outboxSchema.index({ status: 1, scheduledFor: 1 });

export default mongoose.model("OutboxMessage", outboxSchema);
