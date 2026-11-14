import mongoose from "mongoose";

// Per-user dismissals for derived notifications (the notifications themselves
// are computed from findings, reminders and assignments — never seeded).
const notificationStateSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true },
    userId: { type: String, required: true },
    key: { type: String, required: true },
    dismissedAt: { type: String, required: true },
  },
  { timestamps: false },
);
notificationStateSchema.index({ groupId: 1, userId: 1, key: 1 }, { unique: true });

export default mongoose.model("NotificationState", notificationStateSchema);
