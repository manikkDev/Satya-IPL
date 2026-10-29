import express from "express";
import { z } from "zod";
import Item from "../../models/Item.js";
import { newId } from "../../lib/ids.js";
import { requirePermission } from "../../auth/rbac.js";
import { fail, handle } from "./util.js";

const router = express.Router();

const itemSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9/_-]{1,20}$/),
  description: z.string().trim().min(2).max(300),
  specs: z.record(z.string().max(80), z.string().max(200)).optional(),
  hsn: z.string().regex(/^\d{4,8}$/).optional(),
  uom: z.string().max(10).optional(),
  defaultGstRate: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/).optional(),
  aliases: z.array(z.string().trim().max(200)).max(30).optional(),
}).strict();

const view = (i) => ({
  id: i.id, code: i.code, description: i.description, specs: i.specs,
  hsn: i.hsn, uom: i.uom, defaultGstRate: i.defaultGstRate, aliases: i.aliases,
});

router.get("/search", handle(async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) return res.json({ items: [] });
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const items = await Item.find({
    groupId: req.scope.groupId,
    $or: [
      { code: { $regex: `^${escaped}`, $options: "i" } },
      { description: { $regex: escaped, $options: "i" } },
      { aliases: { $regex: escaped, $options: "i" } },
    ],
  }).limit(25).lean();
  res.json({ items: items.map(view) });
}));

router.get("/", handle(async (req, res) => {
  const items = await Item.find({ groupId: req.scope.groupId }).sort({ code: 1 }).limit(200).lean();
  res.json({ items: items.map(view), nextCursor: null });
}));

router.post("/", requirePermission("master.manage"), handle(async (req, res) => {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) {
    throw fail(422, "VALIDATION_FAILED", "Check the item details", { fields: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
  }
  const code = parsed.data.code.toUpperCase();
  if (await Item.exists({ groupId: req.scope.groupId, code })) throw fail(409, "CONFLICT", `Item code ${code} already exists`);
  const item = await Item.create({ id: newId("itm"), groupId: req.scope.groupId, ...parsed.data, code });
  res.status(201).json(view(item));
}));

router.patch("/:id", requirePermission("master.manage"), handle(async (req, res) => {
  const parsed = itemSchema.partial().strict().safeParse(req.body);
  if (!parsed.success) throw fail(422, "VALIDATION_FAILED", "Check the item details");
  const item = await Item.findOneAndUpdate(
    { id: req.params.id, groupId: req.scope.groupId },
    { $set: parsed.data },
    { new: true }
  ).lean();
  if (!item) throw fail(404, "NOT_FOUND", "Item not found");
  res.json(view(item));
}));

export default router;
