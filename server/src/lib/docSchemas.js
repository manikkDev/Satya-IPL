import { z } from "zod";
import { isRealDate } from "./fy.js";

// Write-side zod validation for document drafts (02 §3 shapes; per-type
// requirements enforced in the route). Screening-grade, not tax advice:
// GST rates are restricted to the slabs in force (0, 0.1, 0.25, 1.5, 3, 5,
// 18, 40 after GST 2.0; 12 and 28 still appear on legacy documents and the
// 28% compensation-cess goods).
export const GST_SLABS = ["0", "0.1", "0.25", "1.5", "3", "5", "12", "18", "28", "40"];
const normaliseRate = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : String(v);
};

const moneyStr = z.string().regex(/^\d{1,13}(\.\d{1,6})?$/, "a non-negative decimal amount");
const signedMoneyStr = z.string().regex(/^-?\d{1,13}(\.\d{1,6})?$/, "a decimal amount");
const qtyStr = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, "quantity decimal string")
  .refine((v) => Number(v) > 0, "quantity must be greater than zero");
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").refine(isRealDate, "not a real calendar date");
const pct = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).refine((v) => Number(v) <= 100, "percentage must be 0–100");
export const gstRateStr = z.union([z.string(), z.number()])
  .transform((v) => normaliseRate(v))
  .refine((v) => GST_SLABS.includes(v), `GST rate must be one of ${GST_SLABS.join(", ")}%`);

export const partySchema = z.object({
  name: z.string().trim().min(1).max(200),
  gstin: z.string().regex(/^[0-9]{2}[0-9A-Z]{13}$/).optional(),
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
  discountPct: pct.optional(),
  gstRate: gstRateStr.optional(),
  scheduleDate: dateOnly.optional(),
  refs: z.object({
    poId: z.string().optional(), poLineNo: z.number().int().optional(),
    grnId: z.string().optional(), grnLineNo: z.number().int().optional(),
    invoiceId: z.string().optional(), invoiceLineNo: z.number().int().optional(),
  }).optional(),
  batch: z.string().max(60).optional(),
}).strict();

const linesSchema = z.array(lineSchema).min(1).max(200).superRefine((lines, ctx) => {
  const seen = new Set();
  lines.forEach((l, i) => {
    if (seen.has(l.lineNo)) ctx.addIssue({ code: "custom", path: [i, "lineNo"], message: "duplicate line number" });
    seen.add(l.lineNo);
  });
});
const chargesSchema = z.array(z.object({
  kind: z.enum(["freight", "packing", "insurance", "other"]),
  description: z.string().max(200),
  amount: moneyStr,
  hsnOrSac: z.string().regex(/^\d{4,8}$/).optional(),
  gstRate: gstRateStr.optional(),
}).strict()).max(10);
const termsSchema = z.object({
  paymentTerms: z.string().max(200).optional(),
  creditDays: z.number().int().min(0).max(365).optional(),
  advancePct: pct.optional(),
  deliveryTerms: z.string().max(200).optional(),
  inspection: z.string().max(200).optional(),
  warranty: z.string().max(200).optional(),
  penalty: z.string().max(300).optional(),
  validityDays: z.number().int().min(1).max(365).optional(),
  freeText: z.array(z.string().max(500)).max(20).optional(),
  templateId: z.string().optional(),
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
  lines: linesSchema,
  charges: chargesSchema.optional(),
  terms: termsSchema.optional(),
  externalRef: z.string().max(80).optional(),
}).strict();

export const patchSchema = z.object({
  expectedRevision: z.number().int().min(0).optional(),
  patch: z.object({
    date: dateOnly.optional(),
    seller: partySchema.optional(),
    buyer: partySchema.optional(),
    supplierId: z.string().optional(),
    shipTo: z.record(z.string(), z.any()).optional(),
    placeOfSupply: z.string().regex(/^\d{2}$/).optional(),
    lines: linesSchema.optional(),
    charges: chargesSchema.optional(),
    terms: termsSchema.optional(),
    externalRef: z.string().max(80).optional(),
  }).strict(),
}).strict();

// --- ingest confirm (extracted docs posted as-is) -------------------------
// Posted documents must carry a real number and date, sane lines, and totals
// whose grand equals taxable + taxes + round-off (within ₹1) — the old
// confirm accepted arbitrary totals and number:null.
export const ingestConfirmSchema = z.object({
  type: z.enum(["INVOICE_IN", "CREDIT_NOTE_IN", "DEBIT_NOTE_IN", "GRN", "QC", "PI_IN", "PO", "DELIVERY_CHALLAN", "PAYMENT_OUT", "PAYMENT_IN"]),
  number: z.string().trim().min(1, "document number is required").max(60),
  date: dateOnly,
  lines: z.array(z.object({
    qty: z.union([z.string(), z.number()]).transform(String).pipe(qtyStr),
    rate: z.union([z.string(), z.number()]).transform(String).pipe(moneyStr).optional(),
    gstRate: gstRateStr.optional(),
  }).passthrough()).max(2000).default([]),
  totals: z.object({
    taxable: z.union([z.string(), z.number()]).transform(String).pipe(moneyStr),
    cgst: z.union([z.string(), z.number()]).transform(String).pipe(moneyStr).default("0"),
    sgst: z.union([z.string(), z.number()]).transform(String).pipe(moneyStr).default("0"),
    igst: z.union([z.string(), z.number()]).transform(String).pipe(moneyStr).default("0"),
    cess: z.union([z.string(), z.number()]).transform(String).pipe(moneyStr).default("0"),
    roundOff: z.union([z.string(), z.number()]).transform(String).pipe(signedMoneyStr).default("0"),
    grand: z.union([z.string(), z.number()]).transform(String).pipe(moneyStr),
  }).passthrough().optional(),
}).passthrough();

export const PAYMENT_MODES = ["NEFT", "RTGS", "IMPS", "UPI", "CHEQUE", "OTHER"];
