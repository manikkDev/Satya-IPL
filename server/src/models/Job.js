import mongoose from "mongoose";

// v2 jobs collection (02 §4): Mongo-backed queue with lease + backoff.
const jobSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    groupId: { type: String, index: true },
    kind: { type: String, required: true, index: true },   // "reconcile" | ...
    status: { type: String, enum: ["queued", "running", "completed", "failed", "dead"], default: "queued", index: true },
    progress: { type: Number, default: 0 },
    payload: mongoose.Schema.Types.Mixed,
    result: mongoose.Schema.Types.Mixed,
    error: String,
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    runAfter: { type: Date, default: Date.now, index: true },
    leaseUntil: Date,
    workerToken: String,
  },
  { timestamps: true, minimize: false }
);

jobSchema.index({ groupId: 1, id: 1 }, { unique: true });
jobSchema.index({ status: 1, runAfter: 1 });

export default mongoose.model("Job", jobSchema);
