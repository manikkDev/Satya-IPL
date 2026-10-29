import mongoose from "mongoose";

// decisions (02 §4): immutable reviewer rulings; stale-revision protected.
const decisionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    groupId: { type: String, required: true, index: true },
    caseId: { type: String, required: true, index: true },
    snapshotId: { type: String, index: true },
    findingId: String,
    action: { type: String, required: true },     // APPROVE|REQUEST_CLARIFICATION|ESCALATE|PLACE_ON_HOLD
    scope: mongoose.Schema.Types.Mixed,
    reason: String,
    review: mongoose.Schema.Types.Mixed,           // confirm_duplicate|allocate_payment|accept_variance|link_documents
    actor: { type: String, required: true },
    actorRole: String,
    expectedRevision: Number,
  },
  { timestamps: true, minimize: false }
);

decisionSchema.index({ groupId: 1, id: 1 }, { unique: true });

export default mongoose.model("Decision", decisionSchema);
