import mongoose from "mongoose";

// Global read-only reference data (02 §4 hsn_master), seeded from the engine's
// hsn_master artifact by services/seed/hsn.js. `rates` holds rate rules whose
// `prefix` equals this code; longer-prefix rules win at lookup time.
const rateSchema = new mongoose.Schema(
  {
    prefix: String,
    rate: { type: String, required: true },
    cessRate: String,
    schedule: String,
    sNo: String,
    effectiveFrom: { type: String, required: true },
    effectiveTo: String,
    notificationRef: String,
    conditional: { type: Boolean, default: false },
  },
  { _id: false }
);

const hsnSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true }, // 4/6/8-digit (or 2 for chapters)
    description: { type: String, required: true },
    chapter: { type: String, match: /^\d{2}$/ },
    rates: { type: [rateSchema], default: [] },
    uqc: String,
    artifactVersion: String,
  },
  { timestamps: true, minimize: false }
);

hsnSchema.index({ description: "text" });

export default mongoose.model("HsnMaster", hsnSchema);
