import mongoose from "mongoose";

// 02 §4 suppliers: bank accounts are NEVER stored in clear — only masked +
// HMAC-SHA256 hash, and every change goes maker -> pending_change -> checker.
const bankSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    accountMasked: { type: String, required: true }, // "****1234"
    ifsc: { type: String, uppercase: true, trim: true },
    accountHash: { type: String, required: true },   // HMAC-SHA256, no reversal
    holderName: String,
    status: { type: String, enum: ["active", "pending_change", "inactive"], default: "pending_change" },
    approvedBy: { type: [String], default: [] },
    proposedBy: String,
  },
  { _id: false, timestamps: true }
);

const supplierSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    groupId: { type: String, required: true, index: true },
    legalName: { type: String, required: true, trim: true },
    tradeNames: { type: [String], default: [] },
    gstins: { type: [{ gstin: String, stateCode: String, status: String }], default: [] },
    pan: { type: String, uppercase: true, trim: true },
    udyam: {
      number: String,
      category: { type: String, enum: ["micro", "small", "medium"] },
      verifiedAt: String,
    },
    msme: { type: Boolean, default: false },
    bankAccounts: { type: [bankSchema], default: [] },
    paymentTermsDays: { type: Number, default: 30 },
    contacts: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // [{label, line1, line2, city, state, stateCode, pin, country}]
    addresses: { type: [mongoose.Schema.Types.Mixed], default: [] },
    tags: { type: [String], default: [] },
    // supplier's aggregate annual turnover band — drives e-invoice
    // applicability (>= ₹5 cr) in compliance screening; unset = unknown
    aatoBand: { type: String, enum: ["<5cr", "5-10cr", ">=10cr"] },
    einvoiceApplicable: { type: Boolean },
    // default TDS section for payments to this supplier ("194Q", "194C", "194J"...)
    tdsSection: { type: String, trim: true, uppercase: true },
  },
  { timestamps: true, minimize: false }
);

supplierSchema.index({ groupId: 1, id: 1 }, { unique: true });
supplierSchema.index({ groupId: 1, pan: 1 }, { sparse: true });
supplierSchema.index({ groupId: 1, "gstins.gstin": 1 }, { sparse: true });
supplierSchema.index({ legalName: "text", tradeNames: "text" });

export default mongoose.model("Supplier", supplierSchema);
