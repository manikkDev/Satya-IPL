import mongoose from "mongoose";

// 02 §4 policies: per-entity tolerances, delegation-of-authority (DoA),
// numbering series, MSME defaults, maker-checker flag and terms templates.
const doaSchema = new mongoose.Schema(
  { docType: String, maxAmount: String, roles: [String] },
  { _id: false }
);
const numberingSchema = new mongoose.Schema(
  { docType: String, pattern: String, nextSeq: { type: Number, default: 1 }, fy: String },
  { _id: false }
);
const termsSchema = new mongoose.Schema(
  { id: String, name: String, docType: String, clauses: [String], disclaimer: String },
  { _id: false }
);

const policySchema = new mongoose.Schema(
  {
    entityId: { type: String, required: true, unique: true },
    groupId: { type: String, required: true, index: true },
    tolerance: {
      priceAbs: { type: String, default: "100.00" },     // INR
      pricePct: { type: String, default: "2" },          // %
      qtyPctByUom: { type: mongoose.Schema.Types.Mixed, default: { EA: "0" } },
    },
    doa: { type: [doaSchema], default: [] },
    numbering: { type: [numberingSchema], default: [] },
    msme: { defaultDays: { type: Number, default: 45 } },
    approvals: { requireMakerChecker: { type: Boolean, default: true } },
    termsTemplates: { type: [termsSchema], default: [] },
    autoConfirmHighConfidence: { type: Boolean, default: false }, // ingestion: default OFF
  },
  { timestamps: true, minimize: false }
);

export default mongoose.model("Policy", policySchema);
