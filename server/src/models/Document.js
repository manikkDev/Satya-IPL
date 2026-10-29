import mongoose from "mongoose";

// BusinessDocument per 02 §3. Nested payloads (lines, parties, terms, gst,
// payment) are validated by zod on write and stored as Mixed so the schema
// stays aligned with the engine contract without duplicate definitions.
const STATUSES = [
  "draft", "pending_approval", "approved", "issued", "acknowledged",
  "partially_fulfilled", "fulfilled", "short_closed", "cancelled",
  "posted", "reversed", "confirmed", "rejected",
];

const DOC_TYPES = [
  "PR", "RFQ", "QUOTATION", "PI_IN", "PI_OUT", "PO", "PO_AMENDMENT",
  "PO_ACK", "RELEASE_ORDER", "INVOICE_IN", "INVOICE_OUT",
  "CREDIT_NOTE_IN", "DEBIT_NOTE_OUT", "CREDIT_NOTE_OUT", "DEBIT_NOTE_IN",
  "DELIVERY_CHALLAN", "EWAY_BILL", "LR", "GRN", "QC", "RETURN",
  "PAYMENT_OUT", "PAYMENT_IN", "ADVANCE_OUT", "REMITTANCE_ADVICE",
  "TDS_ENTRY", "GSTR2B_ENTRY", "IMS_ACTION", "BANK_LINE", "SUPPLIER_STATEMENT_LINE",
];

const documentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    groupId: { type: String, required: true, index: true },
    entityId: { type: String, required: true, index: true },
    type: { type: String, enum: DOC_TYPES, required: true },
    number: { type: String, default: null },          // assigned at issue
    externalRef: String,
    date: { type: String, required: true },            // YYYY-MM-DD
    fy: { type: String, required: true },
    status: { type: String, enum: STATUSES, default: "draft" },
    revision: { type: Number, default: 0 },
    supersedes: String,
    seller: { type: mongoose.Schema.Types.Mixed, required: true },
    buyer: { type: mongoose.Schema.Types.Mixed, required: true },
    supplierId: { type: String, index: true },
    shipTo: mongoose.Schema.Types.Mixed,
    placeOfSupply: String,
    currency: { type: String, default: "INR" },
    fx: mongoose.Schema.Types.Mixed,
    lines: { type: [mongoose.Schema.Types.Mixed], default: [] },
    charges: { type: [mongoose.Schema.Types.Mixed], default: [] },
    totals: mongoose.Schema.Types.Mixed,
    payment: mongoose.Schema.Types.Mixed,
    gst: mongoose.Schema.Types.Mixed,
    terms: mongoose.Schema.Types.Mixed,
    taxSummary: { type: [mongoose.Schema.Types.Mixed], default: [] },
    taxWarnings: { type: [mongoose.Schema.Types.Mixed], default: [] },
    approvals: { type: [mongoose.Schema.Types.Mixed], default: [] }, // DoA trail
    requiredApprovers: { type: [String], default: [] },
    source: { type: mongoose.Schema.Types.Mixed, default: { channel: "created_in_satya" } },
    provenance: { type: String, default: "USER_PROVIDED" },
    observedAt: { type: String },
    contentHash: { type: String, index: true },
    issuedAt: { type: String },
    caseId: { type: String, index: true },
    createdBy: { type: String, required: true, index: true },
  },
  { timestamps: true, minimize: false }
);

documentSchema.index({ groupId: 1, entityId: 1, type: 1, date: -1 });
documentSchema.index({ groupId: 1, type: 1, number: 1 });
documentSchema.index({ groupId: 1, "seller.gstin": 1, number: 1, fy: 1 });
documentSchema.index({ "payment.utr": 1 }, { sparse: true });
documentSchema.index({ groupId: 1, id: 1 }, { unique: true });
documentSchema.index({ "lines.refs.poId": 1 }, { sparse: true });

export const DOC_TYPES_LIST = DOC_TYPES;
export default mongoose.model("Document", documentSchema);
