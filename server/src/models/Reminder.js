import mongoose from "mongoose";

// Follow-up reminders on an investigation (ported from the teammate's v1
// BusinessReminder, now group/entity scoped for v2).
const reminderSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    groupId: { type: String, required: true, index: true },
    entityId: { type: String, index: true },
    caseId: { type: String, required: true, index: true },
    dueDate: { type: String, required: true }, // YYYY-MM-DD (IST business date)
    note: { type: String, required: true, maxlength: 500 },
    assignee: String,
    createdBy: { type: String, required: true },
    status: { type: String, enum: ["open", "done"], default: "open", index: true },
    doneAt: String,
    doneBy: String,
  },
  { timestamps: true, minimize: false },
);
reminderSchema.index({ groupId: 1, id: 1 }, { unique: true });
reminderSchema.index({ groupId: 1, status: 1, dueDate: 1 });

export default mongoose.model("Reminder", reminderSchema);
