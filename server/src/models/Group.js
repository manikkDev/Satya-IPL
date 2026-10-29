import mongoose from "mongoose";

// A customer tenant: a company group holding one or more GST-registered
// entities (02 §4). legacyCompanyId links the v1 companyId for migration.
const groupSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    legalName: { type: String, trim: true },
    plan: { type: String, enum: ["trial", "demo", "paid", "internal"], default: "trial" },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
    legacyCompanyId: { type: String, unique: true, sparse: true, index: true },
  },
  { timestamps: true, minimize: false }
);

export default mongoose.model("Group", groupSchema);
