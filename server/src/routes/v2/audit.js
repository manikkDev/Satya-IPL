import express from "express";
import Audit from "../../models/Audit.js";
import { scopeAllows } from "../../auth/rbac.js";
import { verifyChain } from "../../services/audit.js";
import { fail, handle } from "./util.js";

const router = express.Router();

// GET /audit?entityId&action&from&to — audit.read only (auditor + admins).
router.get("/", handle(async (req, res) => {
  if (!scopeAllows(req.scope, "audit.read")) throw fail(403, "FORBIDDEN", "Your role cannot read the audit log");
  const filter = { groupId: req.scope.groupId };
  if (req.query.entityId) filter.entityId = req.query.entityId;
  if (req.query.action) filter.action = { $regex: req.query.action };
  if (req.query.from || req.query.to) filter.createdAt = {
    ...(req.query.from ? { $gte: new Date(req.query.from) } : {}),
    ...(req.query.to ? { $lte: new Date(req.query.to) } : {}),
  };
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const items = await Audit.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({ items, nextCursor: null });
}));

// GET /audit/verify — walk the hash chain and report integrity.
router.get("/verify", handle(async (req, res) => {
  if (!scopeAllows(req.scope, "audit.read")) throw fail(403, "FORBIDDEN", "Your role cannot verify the audit log");
  res.json(await verifyChain(req.scope.groupId));
}));

export default router;
