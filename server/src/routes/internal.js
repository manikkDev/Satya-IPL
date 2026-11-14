import express from "express";
import crypto from "node:crypto";
import { writeAudit } from "../services/audit.js";

// Service-to-service endpoints (gateway -> API). Authenticated ONLY by the
// shared NODE_INTERNAL_TOKEN (x-internal-token), compared in constant time;
// disabled entirely when the token is unset.
const router = express.Router();

export const requireInternalToken = (req, res, next) => {
  const expected = process.env.NODE_INTERNAL_TOKEN || "";
  const got = String(req.headers["x-internal-token"] || "");
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Internal token required", requestId: req.id } });
  }
  return next();
};

const ACTIONS = new Set(["copilot_feedback"]);

// POST /api/internal/audit {groupId, actor, action, target, meta}
// Appends a hash-chained audit row on behalf of another Satya service
// (copilot answer feedback). Only whitelisted actions are accepted.
router.post("/audit", requireInternalToken, async (req, res) => {
  const { groupId, actor, action, target, meta } = req.body || {};
  if (!groupId || typeof groupId !== "string" || !ACTIONS.has(action)) {
    return res.status(422).json({ error: { code: "VALIDATION_FAILED", message: `groupId and an allowed action (${[...ACTIONS].join(", ")}) are required`, requestId: req.id } });
  }
  const ok = await writeAudit({
    groupId, actor: String(actor || "unknown").slice(0, 80), actorRole: "copilot_user",
    action: `copilot.${action}`,
    target: {
      id: String(target || "").slice(0, 120),
      meta: { rating: ["up", "down"].includes(meta?.rating) ? meta.rating : undefined, reason: meta?.reason ? String(meta.reason).slice(0, 500) : undefined, conversationId: meta?.conversationId ? String(meta.conversationId).slice(0, 80) : undefined },
    },
    statusCode: 202,
  }).catch(() => false);
  return res.status(ok ? 201 : 503).json({ ok });
});

export default router;
