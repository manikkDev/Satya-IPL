import express from "express";

import ChatConversation from "../models/ChatConversation.js";
import { protect } from "../middleware/authMiddleware.js";
import { recordAudit } from "../utils/audit.js";

const router = express.Router();
const handle = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const allowedMode = (user) => user.role === "analyst" || user.role === "admin" ? "risk_analyst" : "risk_citizen";
const view = (conversation, includeMessages = false) => ({
  id: String(conversation._id),
  user_id: String(conversation.user),
  title: conversation.title,
  mode: conversation.mode,
  created_at: conversation.createdAt,
  updated_at: conversation.updatedAt,
  ...(includeMessages ? { messages: conversation.messages } : {}),
});

router.use(protect);

router.get("/", handle(async (req, res) => {
  const conversations = await ChatConversation.find({ user: req.user._id }).sort({ updatedAt: -1 }).limit(100).lean();
  res.json(conversations.map((conversation) => view(conversation)));
}));

router.post("/", handle(async (req, res) => {
  const mode = allowedMode(req.user);
  const conversation = await ChatConversation.create({
    user: req.user._id,
    title: String(req.body.title || "New risk conversation").slice(0, 120),
    mode,
  });
  await recordAudit({ req, action: "chat.create", target: conversation._id, meta: { mode } });
  res.status(201).json(view(conversation, true));
}));

router.get("/:id", handle(async (req, res) => {
  const conversation = await ChatConversation.findOne({ _id: req.params.id, user: req.user._id }).lean();
  if (!conversation) return res.status(404).json({ message: "Conversation not found" });
  res.json(view(conversation, true));
}));

router.post("/:id/messages", handle(async (req, res) => {
  const messages = Array.isArray(req.body.messages) ? req.body.messages.slice(0, 4) : [];
  if (!messages.length || messages.some((message) => !["user", "model", "assistant"].includes(message.role) || typeof message.content !== "string" || !message.content.trim())) {
    return res.status(400).json({ message: "Valid conversation messages are required" });
  }
  const mode = allowedMode(req.user);
  const normalized = messages.map((message) => ({
    role: message.role,
    content: message.content.slice(0, 100000),
    sources: Array.isArray(message.sources) ? message.sources : [],
    images: Array.isArray(message.images) ? message.images : [],
    videos: Array.isArray(message.videos) ? message.videos : [],
    charts: Array.isArray(message.charts) ? message.charts : [],
    excalidraw: Array.isArray(message.excalidraw) ? message.excalidraw : [],
    mode,
  }));
  const conversation = await ChatConversation.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id, mode },
    { $push: { messages: { $each: normalized } }, $set: { updatedAt: new Date() } },
    { new: true },
  ).lean();
  if (!conversation) return res.status(404).json({ message: "Conversation not found" });
  res.status(201).json({ ok: true, message_count: conversation.messages.length });
}));

router.delete("/:id", handle(async (req, res) => {
  const conversation = await ChatConversation.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!conversation) return res.status(404).json({ message: "Conversation not found" });
  await recordAudit({ req, action: "chat.delete", target: req.params.id });
  res.json({ success: true });
}));

export default router;
