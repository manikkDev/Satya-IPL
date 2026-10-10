import mongoose from "mongoose";

const erasureRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    ticketId: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ["received", "processing", "completed", "failed"], default: "received" },
    steps: [
      {
        step: String,
        status: { type: String, enum: ["done", "skipped", "failed"] },
        detail: String,
        at: { type: Date, default: Date.now },
      },
    ],
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export default mongoose.model("ErasureRequest", erasureRequestSchema);
