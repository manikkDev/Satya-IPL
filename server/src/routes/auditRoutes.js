import express from "express";

import AuditLog from "../models/AuditLog.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/requireRole.js";

const router = express.Router();

router.get("/", protect, requireRole("analyst", "admin"), async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const query = req.user.role === "admin" ? {} : { institutionId: req.user.institutionId };
    const logs = await AuditLog.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    return res.json(logs);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post("/internal", async (req, res) => {
  try {
    if (!process.env.NODE_INTERNAL_TOKEN || req.headers["x-internal-token"] !== process.env.NODE_INTERNAL_TOKEN) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const { actor, role, institutionId, action, target, meta } = req.body;
    if (!action) return res.status(400).json({ message: "action is required" });
    const log = await AuditLog.create({ actor: actor || null, role: role || "system", institutionId: institutionId ?? null, action, target: target || null, meta: meta || {}, ip: req.ip });
    return res.status(201).json({ ok: true, id: log._id });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

export default router;
