// Supplier communication outbox: idempotent, quiet-hours aware, honest about
// delivery. Email goes through SMTP only when configured; WhatsApp/SMS
// produce share links the user opens themselves.

import OutboxMessage from "../models/OutboxMessage.js";

const QUIET_START = 22; // 22:00 IST
const QUIET_END = 8; // 08:00 IST
const MAX_ATTEMPTS = 3;

export const smtpConfigured = () => Boolean(process.env.SMTP_URL || (process.env.SMTP_HOST && process.env.SMTP_FROM));

const istHour = (date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(date));

/** Next 08:00 IST at or after `date` if `date` falls in quiet hours, else null. */
export function quietHoursRelease(date = new Date()) {
  const hour = istHour(date);
  if (hour >= QUIET_END && hour < QUIET_START) return null;
  const ist = new Date(date.getTime() + 5.5 * 3600_000);
  const release = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), QUIET_END, 0, 0) - 5.5 * 3600_000);
  if (hour >= QUIET_START) release.setUTCDate(release.getUTCDate() + 1);
  return release;
}

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function shareLink(channel, to, body) {
  const digits = String(to).replace(/[^\d]/g, "");
  const number = digits.length === 10 ? `91${digits}` : digits; // Indian mobiles default to +91
  if (channel === "whatsapp") return `https://wa.me/${number}?text=${encodeURIComponent(body)}`;
  if (channel === "sms") return `sms:+${number}?body=${encodeURIComponent(body)}`;
  return null;
}

let transporter = null;
async function getTransport() {
  if (transporter) return transporter;
  const nodemailer = (await import("nodemailer")).default;
  transporter = process.env.SMTP_URL
    ? nodemailer.createTransport(process.env.SMTP_URL)
    : nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "1",
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });
  return transporter;
}

export async function deliverEmail(message) {
  const transport = await getTransport();
  const info = await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: message.to,
    subject: message.subject || "Message from your customer",
    text: message.body,
    html: `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(message.body)}</div>`,
  });
  return info.messageId;
}

/** Try to send one email message now; updates and returns the document. */
export async function attemptSend(message) {
  if (!smtpConfigured()) {
    message.status = "not_configured";
    message.lastError = "Email sending isn’t set up on this server (SMTP not configured).";
    await message.save();
    return message;
  }
  message.status = "sending";
  message.attempts += 1;
  await message.save();
  try {
    message.providerMessageId = await deliverEmail(message);
    message.status = "sent";
    message.sentAt = new Date().toISOString();
    message.lastError = undefined;
  } catch (error) {
    message.lastError = String(error?.message || error).slice(0, 300);
    if (message.attempts >= MAX_ATTEMPTS) message.status = "failed";
    else {
      message.status = "scheduled";
      message.scheduledFor = new Date(Date.now() + 2 ** message.attempts * 60_000).toISOString();
    }
  }
  await message.save();
  return message;
}

/** Background worker: releases scheduled emails when due. */
export function startOutboxWorker({ intervalMs = 60_000 } = {}) {
  const tick = async () => {
    try {
      const due = await OutboxMessage.find({ channel: "email", status: "scheduled", scheduledFor: { $lte: new Date().toISOString() } }).limit(20);
      for (const message of due) await attemptSend(message);
    } catch (error) {
      console.warn("[outbox] worker tick failed:", error?.message || error);
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
