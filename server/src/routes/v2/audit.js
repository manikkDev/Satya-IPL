import express from "express";
import mongoose from "mongoose";
import Audit from "../../models/Audit.js";
import { scopeAllows } from "../../auth/rbac.js";
import { verifyChain } from "../../services/audit.js";
import { fail, handle } from "./util.js";

const router = express.Router();
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// cursor = base64url("<createdAt ISO>|<_id>") of the last row returned
const encodeCursor = (row) => Buffer.from(`${new Date(row.createdAt).toISOString()}|${row._id}`).toString("base64url");
const decodeCursor = (cursor) => {
  try {
    const [at, id] = Buffer.from(String(cursor), "base64url").toString().split("|");
    const date = new Date(at);
    if (Number.isNaN(date.getTime()) || !mongoose.isValidObjectId(id)) return null;
    return { date, id: new mongoose.Types.ObjectId(id) };
  } catch {
    return null;
  }
};

// GET /audit?entityId&action&actor&from&to&limit&cursor — audit.read only.
// Newest first; nextCursor continues after the last row (stable on ties).
router.get("/", handle(async (req, res) => {
  if (!scopeAllows(req.scope, "audit.read")) throw fail(403, "FORBIDDEN", "Your role cannot read the audit log");
  const filter = { groupId: req.scope.groupId };
  if (req.query.entityId) {
    if (!req.scope.entityIds.includes(String(req.query.entityId))) throw fail(404, "NOT_FOUND", "Entity not found");
    filter.entityId = String(req.query.entityId);
  }
  if (req.query.action) filter.action = { $regex: escapeRe(req.query.action), $options: "i" };
  if (req.query.actor) filter.actor = String(req.query.actor);
  if (req.query.from || req.query.to) filter.createdAt = {
    ...(req.query.from ? { $gte: new Date(String(req.query.from)) } : {}),
    ...(req.query.to ? { $lte: new Date(String(req.query.to)) } : {}),
  };
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
  const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;
  if (req.query.cursor && !cursor) throw fail(422, "VALIDATION_FAILED", "Invalid cursor");
  const query = cursor
    ? { $and: [filter, { $or: [{ createdAt: { $lt: cursor.date } }, { createdAt: cursor.date, _id: { $lt: cursor.id } }] }] }
    : filter;
  const rows = await Audit.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
  const page = rows.slice(0, limit);
  res.json({ items: page, nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null });
}));

// GET /audit/verify — walk the hash chain and report integrity.
router.get("/verify", handle(async (req, res) => {
  if (!scopeAllows(req.scope, "audit.read")) throw fail(403, "FORBIDDEN", "Your role cannot verify the audit log");
  res.json(await verifyChain(req.scope.groupId));
}));

export default router;
