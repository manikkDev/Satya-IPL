import express from "express";
import { z } from "zod";
import { ensurePolicy } from "../../services/policies.js";
import { requirePermission } from "../../auth/rbac.js";
import { scopedFilter } from "../../auth/middleware.js";
import { fail, handle, assertPlainInput } from "./util.js";

const router = express.Router();

const policyPatchSchema = z.object({
  tolerance: z.object({
    priceAbs: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    pricePct: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/).optional(),
    qtyPctByUom: z.record(z.string(), z.string()).optional(),
  }).strict().optional(),
  msme: z.object({ defaultDays: z.number().int().min(1).max(365) }).strict().optional(),
  approvals: z.object({ requireMakerChecker: z.boolean() }).strict().optional(),
  autoConfirmHighConfidence: z.boolean().optional(),
}).strict();

// GET /api/v2/policies/:entityId — lazily seeds defaults on first read.
router.get("/:entityId", handle(async (req, res) => {
  if (!req.scope.wildcard && !req.scope.entityIds.includes(req.params.entityId)) {
    throw fail(404, "NOT_FOUND", "Entity not found");
  }
  const policy = await ensurePolicy(req.params.entityId, req.scope.groupId);
  res.json(policy.toObject());
}));

// PUT /api/v2/policies/:entityId — policy.manage only; guarded merges.
router.put("/:entityId", requirePermission("policy.manage"), handle(async (req, res) => {
  if (!req.scope.wildcard && !req.scope.entityIds.includes(req.params.entityId)) {
    throw fail(404, "NOT_FOUND", "Entity not found");
  }
  assertPlainInput(req.body);
  const parsed = policyPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    throw fail(422, "VALIDATION_FAILED", "Check the policy values", { fields: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
  }
  const policy = await ensurePolicy(req.params.entityId, req.scope.groupId);
  Object.assign(policy, parsed.data);
  await policy.save();
  res.json(policy.toObject());
}));

export default router;
