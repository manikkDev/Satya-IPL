import mongoose from "mongoose";

// Per-group API keys for machine imports (Tally connector, scripts). Only a
// SHA-256 of the secret is stored; the plaintext is shown once at creation.
// Scope is deliberately narrow: "import" lets a key push files into the
// import pipeline of ONE entity — no reads of business data, no decisions.
const apiKeySchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    groupId: { type: String, required: true, index: true },
    entityId: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    prefix: { type: String, required: true },          // shown in lists, e.g. "satk_3f9a1c"
    hash: { type: String, required: true, unique: true },
    scopes: { type: [String], default: ["import"] },
    createdBy: { type: String, required: true },
    lastUsedAt: Date,
    revokedAt: Date,
    revokedBy: String,
  },
  { timestamps: true, minimize: false }
);

apiKeySchema.index({ groupId: 1, id: 1 }, { unique: true });

export default mongoose.model("ApiKey", apiKeySchema);
