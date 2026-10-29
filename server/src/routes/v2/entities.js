import express from "express";
import { z } from "zod";
import Entity from "../../models/Entity.js";
import { newId } from "../../lib/ids.js";
import { validateGstin } from "../../lib/gstin.js";
import { requirePermission } from "../../auth/rbac.js";
import { ensurePolicy } from "../../services/policies.js";
import { fail, handle } from "./util.js";

const router = express.Router();

const view = (e) => ({
  id: e.id, code: e.code, legalName: e.legalName, tradeName: e.tradeName,
  gstin: e.gstin, pan: e.pan, cin: e.cin, stateCode: e.stateCode,
  addresses: e.addresses, aatoBand: e.aatoBand, einvoiceApplicable: e.einvoiceApplicable,
  lut: e.lut, letterhead: e.letterhead, parentEntityId: e.parentEntityId ?? null,
});

const entitySchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9]{2,8}$/),
  legalName: z.string().trim().min(2).max(160),
  tradeName: z.string().trim().max(160).optional(),
  gstin: z.string().regex(/^[0-9A-Z]{15}$/).optional(),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/).optional(),
  cin: z.string().trim().max(21).optional(),
  stateCode: z.string().regex(/^\d{2}$/).optional(),
  addresses: z.object({ billing: z.record(z.string(), z.any()).optional(), shipping: z.array(z.record(z.string(), z.any())).max(10).optional() }).optional(),
  aatoBand: z.enum(["<5cr", "5-10cr", ">=10cr"]).optional(),
  einvoiceApplicable: z.boolean().optional(),
  parentEntityId: z.string().optional(),
}).strict();

const assertGstin = (gstin) => {
  const check = validateGstin(gstin);
  if (!check.wellFormed || !check.checksumValid) {
    throw fail(422, "VALIDATION_FAILED", `GSTIN ${gstin} is not a valid format`, { fields: ["gstin"] });
  }
};

router.get("/", handle(async (req, res) => {
  const entities = await Entity.find({ id: { $in: req.scope.entityIds } }).sort({ code: 1 }).lean();
  res.json({ items: entities.map(view) });
}));

router.get("/:id", handle(async (req, res) => {
  if (!req.scope.wildcard && !req.scope.entityIds.includes(req.params.id)) throw fail(404, "NOT_FOUND", "Entity not found");
  const entity = await Entity.findOne({ id: req.params.id, groupId: req.scope.groupId }).lean();
  if (!entity) throw fail(404, "NOT_FOUND", "Entity not found");
  res.json(view(entity));
}));

// Child entity creation: group_admin only, parentEntityId may point at any
// in-scope entity (parent -> child structure, 01 §3.1).
router.post("/", requirePermission("entity.manage"), handle(async (req, res) => {
  const parsed = entitySchema.safeParse(req.body);
  if (!parsed.success) {
    throw fail(422, "VALIDATION_FAILED", "Check the entity details", { fields: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
  }
  if (parsed.data.gstin) assertGstin(parsed.data.gstin);
  if (parsed.data.parentEntityId && !(await Entity.exists({ id: parsed.data.parentEntityId, groupId: req.scope.groupId }))) {
    throw fail(422, "VALIDATION_FAILED", "Parent entity is not in this group", { fields: ["parentEntityId"] });
  }
  const code = parsed.data.code.toUpperCase();
  if (await Entity.exists({ groupId: req.scope.groupId, code })) throw fail(409, "CONFLICT", `Entity code ${code} already exists`);
  const entity = await Entity.create({ id: newId("ent"), groupId: req.scope.groupId, ...parsed.data, code });
  await ensurePolicy(entity.id, req.scope.groupId);
  res.status(201).json(view(entity));
}));

router.patch("/:id", requirePermission("entity.manage"), handle(async (req, res) => {
  if (!req.scope.wildcard && !req.scope.entityIds.includes(req.params.id)) throw fail(404, "NOT_FOUND", "Entity not found");
  const parsed = entitySchema.partial().omit({ code: true, parentEntityId: true }).strict().safeParse(req.body);
  if (!parsed.success) throw fail(422, "VALIDATION_FAILED", "Check the entity details");
  if (parsed.data.gstin) assertGstin(parsed.data.gstin);
  const entity = await Entity.findOneAndUpdate(
    { id: req.params.id, groupId: req.scope.groupId },
    { $set: parsed.data },
    { new: true }
  ).lean();
  if (!entity) throw fail(404, "NOT_FOUND", "Entity not found");
  res.json(view(entity));
}));

export default router;
