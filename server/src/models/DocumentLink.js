import mongoose from "mongoose";

// document_links per 02 §4/§6.1 — immutable evidence edges between documents.
const linkSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    groupId: { type: String, required: true, index: true },
    fromId: { type: String, required: true, index: true },
    toId: { type: String, required: true, index: true },
    kind: {
      type: String,
      enum: ["FULFILS", "RECEIVES", "INSPECTS", "BILLS", "SETTLES", "ADJUSTS",
        "AMENDS", "RETURNS", "REPORTED_IN", "DUPLICATE_OF", "SAME_AS"],
      required: true,
    },
    lineRefs: { type: [{ fromLineNo: Number, toLineNo: Number }], default: [] },
    certainty: { type: String, default: "CONFIRMED" },
    confidence: String,
    amount: mongoose.Schema.Types.Mixed,
    qty: String,
    basis: { type: String, enum: ["reference", "reviewer", "model", "rule"], required: true },
    createdBy: String,
    decisionId: String,
  },
  { timestamps: true, minimize: false }
);

linkSchema.index({ groupId: 1, id: 1 }, { unique: true });
linkSchema.index({ groupId: 1, kind: 1 });

export default mongoose.model("DocumentLink", linkSchema);
