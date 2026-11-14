import mongoose from "mongoose";

// link_suggestions: model-proposed document links (INVOICE_IN→PO BILLS,
// GRN→PO RECEIVES, PAYMENT_OUT→INVOICE_IN SETTLES) and the reviewer's
// verdict. Auto-zone proposals are written as DocumentLink rows
// (certainty PROBABLE, basis "model") and tracked here as "auto_linked" so a
// person can still reject them; review-zone proposals wait as "pending".
// Accept/reject verdicts are the training labels for the next model
// (label 1 / 0) — GET /api/v2/matching/labels exports them.
const linkSuggestionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    groupId: { type: String, required: true, index: true },
    entityId: { type: String, index: true },
    fromId: { type: String, required: true },
    toId: { type: String, required: true },
    kind: { type: String, enum: ["BILLS", "RECEIVES", "SETTLES"], required: true },
    score: { type: String, required: true },          // calibrated probability, "0.9731"
    zone: { type: String, enum: ["auto", "review"], required: true },
    status: { type: String, enum: ["pending", "auto_linked", "accepted", "rejected", "superseded"], default: "pending", index: true },
    reasons: { type: [String], default: [] },
    explanation: { type: [mongoose.Schema.Types.Mixed], default: [] }, // [{feature,text,direction,contribution}]
    lineRefs: { type: [{ fromLineNo: Number, toLineNo: Number, _id: false }], default: [] },
    amount: mongoose.Schema.Types.Mixed,              // SETTLES: cash applied, {amount, currency}
    modelVersion: { type: String, required: true },
    linkId: String,                                   // DocumentLink written for auto/accepted
    label: { type: Number, min: 0, max: 1, default: null }, // 1 accepted, 0 rejected
    decidedBy: String,
    decidedAt: Date,
    decisionReason: String,
    decisionId: String,
  },
  { timestamps: true, minimize: false }
);

linkSuggestionSchema.index({ groupId: 1, id: 1 }, { unique: true });
linkSuggestionSchema.index({ groupId: 1, fromId: 1, toId: 1, kind: 1 }, { unique: true });
linkSuggestionSchema.index({ groupId: 1, status: 1, kind: 1, createdAt: -1 });

export default mongoose.models.LinkSuggestion || mongoose.model("LinkSuggestion", linkSuggestionSchema);
