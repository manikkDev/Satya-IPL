// memory.js — conversation persistence + working memory for the copilot.
// Owns the `conversations` collection (contract §4): id conv_ULID, groupId,
// userId, title, messages[{role,content,citations,toolCalls,usage}], summary.
// Working memory per turn = last 6 messages verbatim + rolling summary
// (flash-lite, ≤120 words, fire-and-forget) + focus entities.
// In-memory fallback keeps everything working without Mongo.

import { ulid } from "ulid";

const VERBATIM_TURNS = 6;
const SUMMARY_MAX_WORDS = 120;

export class ConversationStore {
  constructor(db = null) {
    this.col = db?.collection("conversations") || null;
    this.mem = new Map(); // id -> conversation
    this.ready = this.col
      ? this.col.createIndex({ groupId: 1, userId: 1, updatedAt: -1 }).catch(() => {})
      : Promise.resolve();
  }

  async get(id, { userId, groupId } = {}) {
    if (this.col) {
      await this.ready;
      const doc = await this.col.findOne({ id, userId, groupId });
      if (doc) return doc;
    }
    const c = this.mem.get(id);
    return c && c.userId === userId && c.groupId === groupId ? c : null;
  }

  async create({ userId, groupId, title }) {
    const now = new Date().toISOString();
    const conv = {
      id: `conv_${ulid()}`,
      userId,
      groupId,
      title: String(title || "New conversation").slice(0, 100),
      messages: [],
      summary: "",
      focusEntities: {},
      createdAt: now,
      updatedAt: now,
    };
    if (this.col) {
      await this.ready;
      await this.col.insertOne(conv);
    }
    this.mem.set(conv.id, conv);
    return conv;
  }

  async appendMessages(id, { userId, groupId }, messages) {
    const conv = await this.get(id, { userId, groupId });
    if (!conv) return null;
    conv.messages.push(...messages);
    conv.updatedAt = new Date().toISOString();
    if (this.col) await this.col.updateOne({ id }, { $push: { messages: { $each: messages } }, $set: { updatedAt: conv.updatedAt } });
    return conv;
  }

  async update(id, patch) {
    const conv = this.mem.get(id);
    if (conv) Object.assign(conv, patch, { updatedAt: new Date().toISOString() });
    if (this.col) await this.col.updateOne({ id }, { $set: { ...patch, updatedAt: new Date().toISOString() } });
  }

  async list({ userId, groupId, limit = 25 }) {
    if (this.col) {
      await this.ready;
      return this.col
        .find({ userId, groupId })
        .project({ id: 1, title: 1, updatedAt: 1, "messages.0": 1 })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .toArray();
    }
    return [...this.mem.values()]
      .filter((c) => c.userId === userId && c.groupId === groupId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async remove(id, { userId, groupId }) {
    if (this.col) await this.col.deleteOne({ id, userId, groupId });
    const c = this.mem.get(id);
    if (c && c.userId === userId && c.groupId === groupId) this.mem.delete(id);
    return true;
  }
}

/** Working memory sent to the understand/write stages. */
export function workingMemory(conversation) {
  const messages = conversation?.messages || [];
  return {
    summary: conversation?.summary || "",
    turns: messages.slice(-VERBATIM_TURNS).map((m) => ({ role: m.role, content: String(m.content).slice(0, 1200) })),
    focusEntities: conversation?.focusEntities || {},
  };
}

/**
 * Refresh the rolling summary (≤120 words) in the background after a turn.
 * Never blocks the response; silently skips when the LLM is unavailable.
 */
export async function refreshSummary(llm, store, conversation) {
  try {
    const recent = (conversation.messages || []).slice(-VERBATIM_TURNS * 2)
      .map((m) => `${m.role}: ${String(m.content).slice(0, 400)}`)
      .join("\n");
    if (!recent) return;
    const out = await llm.generate("summary", {
      systemInstruction: { parts: [{ text: `Summarise this procurement-chat history in at most ${SUMMARY_MAX_WORDS} words. Keep document references (PO/invoice/GRN numbers) and the user's current focus. Output plain text only.` }] },
      contents: [{ role: "user", parts: [{ text: `Previous summary: ${conversation.summary || "(none)"}\n\nRecent turns:\n${recent}` }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 220 },
    });
    if (out.ok && out.text?.trim()) {
      await store.update(conversation.id, { summary: out.text.trim().slice(0, 1200) });
    }
  } catch {
    /* summary is best-effort */
  }
}
