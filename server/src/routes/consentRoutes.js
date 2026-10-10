import crypto from "crypto";
import express from "express";

import Consent, { CONSENT_PURPOSES } from "../models/Consent.js";
import AuditLog from "../models/AuditLog.js";
import ChatConversation from "../models/ChatConversation.js";
import ErasureRequest from "../models/ErasureRequest.js";
import User from "../models/User.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/requireRole.js";
import { recordAudit } from "../utils/audit.js";

const router = express.Router();

router.post("/", protect, async (req, res) => {
  try {
    const { purpose, granted } = req.body;
    if (!CONSENT_PURPOSES.includes(purpose) || typeof granted !== "boolean") {
      return res.status(400).json({ message: "A valid purpose and boolean granted value are required" });
    }
    const consent = await Consent.create({
      user: req.user._id,
      purpose,
      granted,
      institutionId: req.user.institutionId,
      ip: req.ip,
    });
    await recordAudit({
      req,
      action: granted ? "consent.grant" : "consent.revoke",
      target: purpose,
      meta: { version: consent.version },
    });
    return res.status(201).json({ ok: true, consent });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.get("/me", protect, async (req, res) => {
  try {
    const history = await Consent.find({ user: req.user._id }).sort({ createdAt: -1 }).lean();
    const purposes = Object.fromEntries(CONSENT_PURPOSES.map((purpose) => [purpose, false]));
    const seen = new Set();
    for (const entry of history) {
      if (!(entry.purpose in purposes) || seen.has(entry.purpose)) continue;
      purposes[entry.purpose] = entry.granted;
      seen.add(entry.purpose);
    }
    return res.json({ purposes, history });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// DPDP access right: machine-readable export of everything held about the user.
router.get("/export", protect, async (req, res) => {
  try {
    const history = await Consent.find({ user: req.user._id }).sort({ createdAt: -1 }).lean();
    const purposes = Object.fromEntries(CONSENT_PURPOSES.map((purpose) => [purpose, null]));
    const seen = new Set();
    for (const entry of history) {
      if (!(entry.purpose in purposes) || seen.has(entry.purpose)) continue;
      purposes[entry.purpose] = entry.granted;
      seen.add(entry.purpose);
    }
    const auditEntries = await AuditLog.find({ actor: req.user._id }).sort({ createdAt: -1 }).limit(200).lean();
    await recordAudit({ req, action: "data.export", target: req.user._id });
    return res.json({
      exported_at: new Date().toISOString(),
      subject: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        institutionId: req.user.institutionId,
        customerRef: req.user.customerRef,
      },
      purposes,
      consent_history: history,
      audit_entries: auditEntries,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// DPDP erasure right: real lifecycle — revoke every purpose, delete
// conversations, pseudonymise the account, and block future login.
// Synthetic PaySim training rows are not personal data and are unaffected;
// the response says so explicitly rather than implying their deletion.
router.post("/erase-request", protect, requireRole("citizen"), async (req, res) => {
  const ticketId = `erase_${crypto.randomUUID()}`;
  const ticket = await ErasureRequest.create({ user: req.user._id, ticketId, status: "processing" });
  const step = async (name, fn, detail) => {
    try {
      const extra = await fn();
      ticket.steps.push({ step: name, status: "done", detail: extra || detail });
      await recordAudit({ req, action: `data.erase.${name}`, target: ticketId });
    } catch (error) {
      ticket.steps.push({ step: name, status: "failed", detail: error.message });
      ticket.status = "failed";
    }
  };
  try {
    await recordAudit({ req, action: "data.erase_request", target: ticketId });
    await step("consent_revocation", async () => {
      const history = await Consent.find({ user: req.user._id }).sort({ createdAt: -1 });
      const seen = new Set();
      const toRevoke = [];
      for (const entry of history) {
        if (seen.has(entry.purpose)) continue;
        seen.add(entry.purpose);
        if (entry.granted !== false) toRevoke.push(entry.purpose);
      }
      for (const purpose of toRevoke) {
        await Consent.create({ user: req.user._id, purpose, granted: false, institutionId: req.user.institutionId, ip: req.ip });
      }
      return `${toRevoke.length} purpose(s) revoked`;
    });
    await step("conversation_deletion", async () => {
      const result = await ChatConversation.deleteMany({ user: req.user._id });
      return `${result.deletedCount} conversation(s) deleted`;
    });
    await step("account_pseudonymisation", async () => {
      await User.updateOne(
        { _id: req.user._id },
        {
          $set: {
            name: `Erased user ${ticketId.slice(-8)}`,
            email: `${ticketId}@erased.invalid`,
            password: crypto.randomBytes(32).toString("hex"),
            erasedAt: new Date(),
          },
          $unset: { customerRef: "" },
        },
      );
      return "name/email/customerRef pseudonymised; login disabled";
    });
    if (ticket.status !== "failed") {
      ticket.status = "completed";
      ticket.completedAt = new Date();
    }
    await ticket.save();
    return res.status(202).json({
      ok: ticket.status === "completed",
      ticketId,
      status: ticket.status,
      steps: ticket.steps,
      scope_note: "Synthetic PaySim training partitions are not personal data and are not affected by erasure; platform-held personal data was pseudonymised and consent revoked.",
    });
  } catch (error) {
    ticket.status = "failed";
    await ticket.save().catch(() => {});
    return res.status(500).json({ message: error.message, ticketId });
  }
});

// Erasure status: owner or admin may poll a ticket.
router.get("/erase-request/:ticketId", protect, async (req, res) => {
  try {
    const ticket = await ErasureRequest.findOne({ ticketId: req.params.ticketId }).lean();
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    const owner = String(ticket.user) === String(req.user._id);
    if (!owner && req.user.role !== "admin") return res.status(403).json({ message: "Not your erasure ticket" });
    return res.json({ ticketId: ticket.ticketId, status: ticket.status, steps: ticket.steps, completedAt: ticket.completedAt });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

export default router;
