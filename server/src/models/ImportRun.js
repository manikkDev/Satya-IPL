import mongoose from "mongoose";

// One import attempt: preview (validated, nothing written) -> commit. The
// uploaded bytes live in GridFS (files collection) so commit re-reads the
// exact file the user previewed; the run keeps only the summary, a capped
// issue list and sample rows (never the whole payload — 16 MB doc limit).
const importRunSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    groupId: { type: String, required: true, index: true },
    entityId: { type: String, required: true },
    source: { type: String, required: true },          // tally_xml | bank_statement | gstr2b_json | template:<kind> | bank_csv_legacy | gstr2b_legacy
    format: String,                                     // csv | xlsx | xml | mt940 | json
    fileId: String,
    fileName: String,
    sha256: String,
    fingerprint: { type: String, index: true },         // sha256 + source + options
    options: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["previewed", "committing", "committed", "failed"], default: "previewed", index: true },
    canCommit: { type: Boolean, default: false },
    detected: mongoose.Schema.Types.Mixed,              // bank / layout / mapping detection
    summary: mongoose.Schema.Types.Mixed,               // counts per action/type
    issues: { type: [mongoose.Schema.Types.Mixed], default: [] },
    issueCount: { type: Number, default: 0 },
    sample: { type: [mongoose.Schema.Types.Mixed], default: [] },
    result: mongoose.Schema.Types.Mixed,                // created / deduped / linked / flagged
    createdDocumentIds: { type: [String], default: [] },
    caseIds: { type: [String], default: [] },
    checks: mongoose.Schema.Types.Mixed,                // auto-check outcome (links, suggestions, reconcile)
    error: String,
    via: { type: String, default: "ui" },               // ui | api_key | legacy
    createdBy: { type: String, required: true },
    committedAt: Date,
  },
  { timestamps: true, minimize: false }
);

importRunSchema.index({ groupId: 1, id: 1 }, { unique: true });
importRunSchema.index({ groupId: 1, createdAt: -1 });

export default mongoose.model("ImportRun", importRunSchema);
