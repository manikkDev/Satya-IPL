// ladder.js — task → ordered model list, filtered by live availability.
// Models come from env ladders (never a single hard-coded model) and are
// filtered once at startup by a models.list call (availability changes).

const csv = (value) =>
  String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Read model ladders from the environment.
 * Task names: chat (writing), understand (cheap JSON), extract (documents),
 * embed (embeddings), summary (conversation memory — reuses understand ladder).
 */
export function laddersFromEnv(env = process.env) {
  const fallbackChat = ["gemini-2.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"];
  const fallbackCheap = ["gemini-3.1-flash-lite", "gemini-2.5-flash-lite"];
  const chat = csv(env.GEMINI_MODEL_LADDER_CHAT);
  const extract = csv(env.GEMINI_MODEL_LADDER_EXTRACT);
  const understand = csv(env.GEMINI_MODEL_LADDER_UNDERSTAND);
  return {
    chat: chat.length ? chat : fallbackChat,
    extract: extract.length ? extract : fallbackChat,
    understand: understand.length ? understand : fallbackCheap,
    summary: csv(env.GEMINI_MODEL_LADDER_SUMMARY).length
      ? csv(env.GEMINI_MODEL_LADDER_SUMMARY)
      : understand.length
        ? understand
        : fallbackCheap,
    embed: csv(env.GEMINI_EMBED_MODEL).length ? csv(env.GEMINI_EMBED_MODEL) : ["gemini-embedding-001"],
  };
}

export class ModelLadders {
  constructor(ladders) {
    this.ladders = ladders;
    this.available = null; // null until models.list succeeds
  }

  /** Keep only models the project can actually see; keep order. */
  applyAvailability(modelNames) {
    this.available = new Set(modelNames);
    for (const task of Object.keys(this.ladders)) {
      const filtered = this.ladders[task].filter((m) => this.available.has(m));
      // Never empty a ladder purely from a list outage — keep last known entry.
      this.ladders[task] = filtered.length ? filtered : this.ladders[task];
    }
  }

  forTask(task) {
    return this.ladders[task] || this.ladders.chat;
  }

  allModels() {
    return [...new Set(Object.values(this.ladders).flat())];
  }
}
