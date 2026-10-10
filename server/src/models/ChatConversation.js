import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "model", "assistant", "system"], required: true },
    content: { type: String, required: true, maxlength: 100000 },
    sources: { type: [mongoose.Schema.Types.Mixed], default: [] },
    images: { type: [mongoose.Schema.Types.Mixed], default: [] },
    videos: { type: [mongoose.Schema.Types.Mixed], default: [] },
    charts: { type: [mongoose.Schema.Types.Mixed], default: [] },
    excalidraw: { type: [mongoose.Schema.Types.Mixed], default: [] },
    mode: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const conversationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    mode: { type: String, enum: ["risk_analyst", "risk_citizen"], required: true },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true },
);

conversationSchema.index({ user: 1, updatedAt: -1 });

export default mongoose.model("ChatConversation", conversationSchema);
