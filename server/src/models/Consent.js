import mongoose from "mongoose";

export const CONSENT_PURPOSES = [
  "risk_scoring",
  "fraud_monitoring",
  "model_training",
  "cross_institution_fl",
];

const consentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    purpose: { type: String, enum: CONSENT_PURPOSES, required: true },
    granted: { type: Boolean, required: true },
    institutionId: { type: Number, min: 0, max: 4, default: null },
    version: { type: String, default: "v1" },
    ip: String,
  },
  { timestamps: true },
);

consentSchema.index({ user: 1, purpose: 1, createdAt: -1 });

export default mongoose.model("Consent", consentSchema);
