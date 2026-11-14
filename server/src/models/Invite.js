import mongoose from "mongoose";

// A pending invitation to join a group (first-run setup, "invite your team").
// Only the SHA-256 of the invite token is stored; the raw token is returned
// once to the inviter (as a join link) and never persisted. Roles are chosen
// by an admin holding user.manage — invitees can never pick their own.
const inviteSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    groupId: { type: String, required: true, index: true },
    entityId: { type: String, required: true, default: "*" }, // "*" = every entity in the group
    email: { type: String, required: true, lowercase: true, trim: true },
    roles: { type: [String], required: true },
    tokenHash: { type: String, required: true, unique: true },
    invitedBy: { type: String, required: true },
    invitedByName: { type: String },
    status: { type: String, enum: ["pending", "accepted", "revoked"], default: "pending", index: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    acceptedBy: { type: String, default: null },
  },
  { timestamps: true }
);

inviteSchema.index({ groupId: 1, email: 1, status: 1 });

export default mongoose.models.Invite || mongoose.model("Invite", inviteSchema);
