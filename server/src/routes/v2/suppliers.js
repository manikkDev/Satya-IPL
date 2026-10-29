import express from "express";
import { z } from "zod";
import Supplier from "../../models/Supplier.js";
import { newId } from "../../lib/ids.js";
import { validateGstin } from "../../lib/gstin.js";
import { maskAccount, accountHash } from "../../services/bankAccounts.js";
import { requirePermission } from "../../auth/rbac.js";
import { fail, handle } from "./util.js";

const router = express.Router();

const gstinSchema = z.string().regex(/^[0-9A-Z]{15}$/);
const supplierSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  tradeNames: z.array(z.string().trim().max(160)).max(10).optional(),
  gstins: z.array(z.object({ gstin: gstinSchema, stateCode: z.string().regex(/^\d{2}$/).optional() })).max(10).optional(),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/).optional(),
  udyam: z.object({
    number: z.string().max(30),
    category: z.enum(["micro", "small", "medium"]),
    verifiedAt: z.string().optional(),
  }).optional(),
  msme: z.boolean().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  contacts: z.array(z.object({ name: z.string().max(120), email: z.string().email().optional(), phone: z.string().max(20).optional() })).max(10).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
}).strict();

const bankAccountSchema = z.object({
  accountNo: z.string().regex(/^\d{9,18}$/, "9–18 digit account number"),
  ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC like SBIN0123456"),
  holderName: z.string().trim().max(120).optional(),
}).strict();

const invalidFields = (parsed) =>
  parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));

const view = (s) => ({
  id: s.id, legalName: s.legalName, tradeNames: s.tradeNames, gstins: s.gstins,
  pan: s.pan, udyam: s.udyam, msme: s.msme, bankAccounts: s.bankAccounts,
  paymentTermsDays: s.paymentTermsDays, contacts: s.contacts, tags: s.tags,
});

router.get("/", handle(async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const filter = { groupId: req.scope.groupId };
  if (q) filter.$or = [
    { legalName: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
    { tradeNames: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
    { "gstins.gstin": q.toUpperCase() },
  ];
  const items = await Supplier.find(filter).sort({ legalName: 1 }).limit(100).lean();
  res.json({ items: items.map(view), nextCursor: null });
}));

router.post("/", requirePermission("master.manage"), handle(async (req, res) => {
  const parsed = supplierSchema.safeParse(req.body);
  if (!parsed.success) throw fail(422, "VALIDATION_FAILED", "Check the supplier details", { fields: invalidFields(parsed) });
  for (const entry of parsed.data.gstins || []) {
    const check = validateGstin(entry.gstin);
    if (!check.wellFormed || !check.checksumValid) {
      throw fail(422, "VALIDATION_FAILED", `GSTIN ${entry.gstin} is not a valid format`, { fields: ["gstins"] });
    }
  }
  const supplier = await Supplier.create({ id: newId("sup"), groupId: req.scope.groupId, ...parsed.data });
  res.status(201).json(view(supplier));
}));

router.get("/:id", handle(async (req, res) => {
  const supplier = await Supplier.findOne({ id: req.params.id, groupId: req.scope.groupId }).lean();
  if (!supplier) throw fail(404, "NOT_FOUND", "Supplier not found");
  res.json(view(supplier));
}));

router.patch("/:id", requirePermission("master.manage"), handle(async (req, res) => {
  const parsed = supplierSchema.partial().safeParse(req.body);
  if (!parsed.success) throw fail(422, "VALIDATION_FAILED", "Check the supplier details", { fields: invalidFields(parsed) });
  for (const entry of parsed.data.gstins || []) {
    const check = validateGstin(entry.gstin);
    if (!check.wellFormed || !check.checksumValid) {
      throw fail(422, "VALIDATION_FAILED", `GSTIN ${entry.gstin} is not a valid format`, { fields: ["gstins"] });
    }
  }
  const supplier = await Supplier.findOneAndUpdate(
    { id: req.params.id, groupId: req.scope.groupId },
    { $set: parsed.data },
    { new: true }
  ).lean();
  if (!supplier) throw fail(404, "NOT_FOUND", "Supplier not found");
  res.json(view(supplier));
}));

// Bank-account maker-checker (01 §8): maker proposes -> pending_change;
// a DIFFERENT user with supplier.bank.checker activates it.
router.post("/:id/bank-accounts", requirePermission("supplier.bank.maker"), handle(async (req, res) => {
  const parsed = bankAccountSchema.safeParse(req.body);
  if (!parsed.success) throw fail(422, "VALIDATION_FAILED", "Check the bank details", { fields: invalidFields(parsed) });
  const { accountNo, ifsc, holderName } = parsed.data;
  const supplier = await Supplier.findOne({ id: req.params.id, groupId: req.scope.groupId });
  if (!supplier) throw fail(404, "NOT_FOUND", "Supplier not found");
  const hash = accountHash(accountNo, ifsc);
  const existing = supplier.bankAccounts.find((a) => a.accountHash === hash);
  if (existing && existing.status !== "inactive") {
    throw fail(409, "CONFLICT", "This bank account is already on record", { accountMasked: existing.accountMasked });
  }
  supplier.bankAccounts.push({
    id: newId("acc"),
    accountMasked: maskAccount(accountNo),
    ifsc,
    accountHash: hash,
    holderName,
    status: "pending_change",
    proposedBy: req.user.v2id || String(req.user._id),
  });
  await supplier.save();
  res.status(201).json(view(supplier));
}));

router.post("/:id/bank-accounts/:accId/approve", requirePermission("supplier.bank.checker"), handle(async (req, res) => {
  const supplier = await Supplier.findOne({ id: req.params.id, groupId: req.scope.groupId });
  if (!supplier) throw fail(404, "NOT_FOUND", "Supplier not found");
  const account = supplier.bankAccounts.find((a) => a.id === req.params.accId);
  if (!account) throw fail(404, "NOT_FOUND", "Bank account not found");
  const actor = req.user.v2id || String(req.user._id);
  if (account.proposedBy === actor) {
    return res.status(403).json({
      error: { code: "SOD_VIOLATION", message: "You proposed this bank account, so someone else must approve it", details: { reason: "maker != checker" }, requestId: req.id },
    });
  }
  account.status = "active";
  account.approvedBy.push(actor);
  await supplier.save();
  res.json(view(supplier));
}));

export default router;
