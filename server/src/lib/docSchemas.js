import { z } from "zod";

// Write-side zod validation for document drafts (02 §3 shapes; per-type
// requirements enforced in the route).
const moneyStr = z.string().regex(/^-?\d+(\.\d{1,6})?$/, "decimal string");
const qtyStr = z.string().regex(/^\d+(\.\d{1,6})?$/, "quantity decimal string");
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const partySchema = z.object({
  name: z.string().trim().min(1).max(200),
  gstin: z.string().regex(/^[0-9A-Z]{15}$/).optional(),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/).optional(),
  stateCode: z.string().regex(/^\d{2}$/).optional(),
  address: z.record(z.string(), z.any()).optional(),
  supplierId: z.string().optional(),
  udyam: z.object({ number: z.string(), category: z.enum(["micro", "small", "medium"]) }).optional(),
}).strict();

export const lineSchema = z.object({
  lineNo: z.number().int().min(1),
  itemId: z.string().optional(),
  sku: z.string().max(60).optional(),
  description: z.string().trim().min(1).max(500),
  specs: z.record(z.string().max(80), z.string().max(200)).optional(),
  hsn: z.string().regex(/^\d{4,8}$/).optional(),
  uom: z.string().max(10).default("EA"),
  qty: qtyStr,
  rate: moneyStr.optional(),
  discountPct: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).optional(),
  gstRate: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/).optional(),
  scheduleDate: dateOnly.optional(),
  refs: z.object({
    poId: z.string().optional(), poLineNo: z.number().int().optional(),
    grnId: z.string().optional(), grnLineNo: z.number().int().optional(),
    invoiceId: z.string().optional(), invoiceLineNo: z.number().int().optional(),
  }).optional(),
  batch: z.string().max(60).optional(),
}).strict();

export const draftSchema = z.object({
  type: z.enum(["PO", "PI_OUT", "PI_IN", "PO_AMENDMENT"]),
  entityId: z.string().min(1),
  date: dateOnly,
  seller: partySchema,
  buyer: partySchema,
  supplierId: z.string().optional(),
  shipTo: z.record(z.string(), z.any()).optional(),
  placeOfSupply: z.string().regex(/^\d{2}$/).optional(),
  currency: z.literal("INR").default("INR"),
  lines: z.array(lineSchema).min(1).max(200),
  charges: z.array(z.object({
    kind: z.enum(["freight", "packing", "insurance", "other"]),
    description: z.string().max(200),
    amount: moneyStr,
    hsnOrSac: z.string().optional(),
    gstRate: z.string().optional(),
  }).strict()).max(10).optional(),
  terms: z.object({
    paymentTerms: z.string().max(200).optional(),
    creditDays: z.number().int().min(0).max(365).optional(),
    advancePct: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).optional(),
    deliveryTerms: z.string().max(200).optional(),
    inspection: z.string().max(200).optional(),
    warranty: z.string().max(200).optional(),
    penalty: z.string().max(300).optional(),
    validityDays: z.number().int().min(1).max(365).optional(),
    freeText: z.array(z.string().max(500)).max(20).optional(),
    templateId: z.string().optional(),
  }).strict().optional(),
  externalRef: z.string().max(80).optional(),
}).strict();

export const patchSchema = z.object({
  expectedRevision: z.number().int().min(0),
  patch: draftSchema.partial().omit({ type: true, entityId: true }),
}).strict();
