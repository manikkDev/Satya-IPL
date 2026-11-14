import express from "express";
import { z } from "zod";
import Supplier from "../../models/Supplier.js";
import { newId } from "../../lib/ids.js";
import { validateGstin } from "../../lib/gstin.js";
import { maskAccount, accountHash } from "../../services/bankAccounts.js";
import { requirePermission } from "../../auth/rbac.js";
import { fail, handle } from "./util.js";
import { supplierSummary } from "../../services/supplierSummary.js";

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
  addresses: z.array(z.object({
    label: z.string().max(60).optional(), line1: z.string().max(200).optional(), line2: z.string().max(200).optional(),
    city: z.string().max(80).optional(), state: z.string().max(80).optional(), stateCode: z.string().regex(/^\d{2}$/).optional(),
    pin: z.string().regex(/^\d{6}$/).optional(), country: z.string().max(60).optional(),
  }).strict()).max(10).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  aatoBand: z.enum(["<5cr", "5-10cr", ">=10cr"]).optional(),
  einvoiceApplicable: z.boolean().optional(),
  tdsSection: z.string().regex(/^19[0-9][A-Z]{0,2}$/i).optional(),
}).strict();

const bankAccountSchema = z.object({
  accountNo: z.string().regex(/^\d{9,18}$/, "9–18 digit account number"),
  ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC like SBIN0123456"),
  holderName: z.string().trim().max(120).optional(),
}).strict();

const invalidFields = (parsed) =>
  parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));

// Address shapes vary by source (seed `address{}`, master `addresses[]`,
// pincode vs pin, state name vs code) — normalise to the fields the client
// reads: {label, line1, line2, city, state, stateCode, pin, country}.
const normAddress = (a) => (a && typeof a === "object" ? {
  label: a.label ?? undefined, line1: a.line1 ?? a.address ?? a.street ?? undefined, line2: a.line2 ?? undefined,
  city: a.city ?? undefined, state: a.state ?? a.stateName ?? undefined, stateCode: a.stateCode ?? undefined,
  pin: a.pin ?? a.pincode ?? a.postalCode ?? undefined, country: a.country ?? "IN",
} : null);
const addressesOf = (s) => {
  const list = [...(Array.isArray(s.addresses) ? s.addresses : []), ...(s.address && !Array.isArray(s.address) ? [s.address] : [])].map(normAddress).filter(Boolean);
  return list;
};

const view = (s) => {
  const addresses = addressesOf(s);
  const primary = addresses[0] || null;
  return {
    id: s.id, legalName: s.legalName, tradeNames: s.tradeNames, gstins: s.gstins,
    pan: s.pan, udyam: s.udyam, msme: s.msme,
    // masked only — account numbers are never stored in clear
    bankAccounts: (s.bankAccounts || []).map((b) => ({ id: b.id, accountMasked: b.accountMasked, masked: b.accountMasked, ifsc: b.ifsc, holderName: b.holderName, accountHash: b.accountHash, status: b.status, proposedBy: b.proposedBy, approvedBy: b.approvedBy })),
    paymentTermsDays: s.paymentTermsDays, contacts: s.contacts || [], tags: s.tags,
    // additive
    addresses, address: primary,
    city: primary?.city ?? null, state: primary?.state ?? null, stateCode: primary?.stateCode ?? s.gstins?.[0]?.stateCode ?? null, pin: primary?.pin ?? null,
    gstin: s.gstins?.[0]?.gstin ?? null,
    aatoBand: s.aatoBand ?? null, einvoiceApplicable: s.einvoiceApplicable ?? null, tdsSection: s.tdsSection ?? null,
  };
};

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

// GET /suppliers/:id/summary?entityId — supplier 360 for the UI and copilot:
// what we ordered, received, were invoiced, paid and still owe, what is
// disputed, open findings, MSME position and aged payables. Exact paise
// money; scoped to the caller's entities (or one entity via ?entityId).
router.get("/:id/summary", handle(async (req, res) => {
  const supplier = await Supplier.findOne({ id: req.params.id, groupId: req.scope.groupId }).lean();
  if (!supplier) throw fail(404, "NOT_FOUND", "Supplier not found");
  let entityIds = req.scope.entityIds;
  if (req.query.entityId) {
    if (!entityIds.includes(String(req.query.entityId))) throw fail(404, "NOT_FOUND", "Entity not found");
    entityIds = [String(req.query.entityId)];
  }
  res.json(await supplierSummary(req.scope.groupId, entityIds, supplier, view(supplier)));
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
    { returnDocument: "after" }
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
