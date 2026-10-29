import mongoose from "mongoose";

// extraction_drafts (02 §4): the human-review buffer between a raw upload and
// a committed BusinessDocument. Every extracted field keeps confidence +
// quote/page so reviewers verify before commit.
const draftSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    groupId: { type: String, required: true, index: true },
    entityId: { type: String, required: true, index: true },
    fileId: { type: String, required: true, index: true },
    status: { type: String, enum: ["queued", "parsing", "extracting", "needs_review", "confirmed", "failed"], default: "queued", index: true },
    detectedType: String,
    method: { type: String, enum: ["einvoice_qr", "text_layer", "vision_llm", "csv", "json", "failed"], default: "text_layer" },
    fields: { type: mongoose.Schema.Types.Mixed, default: {} },
    lines: { type: [mongoose.Schema.Types.Mixed], default: [] },
    issues: { type: [mongoose.Schema.Types.Mixed], default: [] },
    suggestions: { type: mongoose.Schema.Types.Mixed, default: {} },
    edits: { type: [mongoose.Schema.Types.Mixed], default: [] },
    aiUsage: mongoose.Schema.Types.Mixed,
    confirmedDocumentId: String,
    createdBy: String,
  },
  { timestamps: true, minimize: false }
);

draftSchema.index({ groupId: 1, id: 1 }, { unique: true });
draftSchema.index({ groupId: 1, status: 1 });

export default mongoose.model("ExtractionDraft", draftSchema);
