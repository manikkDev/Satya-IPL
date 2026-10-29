// index.js — the hybrid RAG engine (P2-C5): chunk → embed → store, then
// BM25 ∪ vector → Reciprocal Rank Fusion → top-k records with locators.
// The help corpus (rag/help/*.md) is indexed at startup as groupId "public".
// If AI is unavailable, chunks are still stored (no embedding) and can be
// backfilled later — never blocks ingestion.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chunkText } from "./chunk.js";
import { embedBatch, embedOne } from "./embed.js";
import { RagStore } from "./store.js";
import { Bm25Cache } from "./bm25.js";
import { rrf } from "./fuse.js";
import { initLlm } from "../llm/index.js";

const dir = dirname(fileURLToPath(import.meta.url));
const TOP_K = 8;
const FETCH_K = 16;

let ragSingleton = null;
let ragBuilding = null;

export class RagEngine {
  constructor({ store, bm25, llm }) {
    this.store = store;
    this.bm25 = bm25;
    this.llm = llm;
  }

  /**
   * Index a source's text (or per-page text) for a group.
   * @returns {Promise<{chunks:number, embedded:number}>}
   */
  async index({ groupId, sourceType, sourceId, text, pages, title }) {
    const input = pages || String(text || "");
    const chunks = chunkText(input);
    const texts = chunks.map((c) => c.text);
    let vectors = [];
    try {
      vectors = await embedBatch(this.llm, texts, "RETRIEVAL_DOCUMENT");
    } catch {
      vectors = texts.map(() => null);
    }
    let embedded = 0;
    for (const [i, chunk] of chunks.entries()) {
      const vector = vectors[i] || null;
      if (vector) embedded += 1;
      await this.store.put({ groupId, sourceType, sourceId, title, text: chunk.text, page: chunk.page, chunkIndex: chunk.chunkIndex, embedding: vector });
    }
    this.bm25.build(groupId, await this.store.forGroup(groupId));
    return { chunks: chunks.length, embedded };
  }

  /**
   * Hybrid search: BM25 + vector → RRF → top-k records with locators.
   */
  async search(groupId, query, { k = TOP_K } = {}) {
    if (!groupId) return [];
    if (!this.bm25.has(groupId)) {
      this.bm25.build(groupId, await this.store.forGroup(groupId));
    }
    const lexical = this.bm25.search(groupId, query, { k: FETCH_K }) || [];
    let vector = [];
    try {
      const q = await embedOne(this.llm, query, "RETRIEVAL_QUERY");
      if (q.ok) {
        const hits = await this.store.vectorSearch(groupId, q.vector, { k: FETCH_K });
        vector = hits.map((h) => h.id);
      }
    } catch {
      /* embeddings optional — lexical still works */
    }
    const fused = rrf(vector, lexical).slice(0, k);
    const chunks = new Map((await this.store.forGroup(groupId)).map((c) => [c.id, c]));
    return fused
      .map((id) => chunks.get(id))
      .filter(Boolean)
      .map((c) => ({
        id: c.id,
        sourceType: c.sourceType,
        sourceId: c.sourceId,
        documentId: c.sourceType === "document_text" ? c.sourceId : null,
        title: c.title,
        text: c.text.slice(0, 900),
        page: c.page,
        hasEmbedding: Boolean(c.embedding),
      }));
  }

  async searchHelp(query, opts) {
    return this.search("public", query, opts);
  }

  /** Backfill chunks stored while AI was unavailable. */
  async backfillEmbeddings(groupId, { limit = 32 } = {}) {
    const chunks = (await this.store.forGroup(groupId)).filter((c) => !c.embedding).slice(0, limit);
    let done = 0;
    for (const c of chunks) {
      const r = await embedOne(this.llm, c.text, "RETRIEVAL_DOCUMENT");
      if (!r.ok) break;
      c.embedding = r.vector;
      c.embeddingModel = "gemini-embedding-001";
      if (this.store.col) await this.store.col.updateOne({ id: c.id }, { $set: { embedding: r.vector, embeddingModel: c.embeddingModel } });
      this.store.mem.set(c.id, c);
      done += 1;
    }
    return done;
  }
}

/** Load help/*.md articles as chunked sources for groupId "public". */
export function helpSources() {
  let files = [];
  try {
    files = readdirSync(join(dir, "help")).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  return files.map((f) => {
    const raw = readFileSync(join(dir, "help", f), "utf8");
    const title = raw.split("\n").find((l) => l.startsWith("#"))?.replace(/^#+\s*/, "").trim() || f.replace(/\.md$/, "");
    return { sourceId: `help:${f}`, title, text: raw };
  });
}

export async function initRag() {
  if (ragSingleton) return ragSingleton;
  if (ragBuilding) return ragBuilding;
  ragBuilding = (async () => {
    const { gateway, db } = await initLlm();
    const rag = new RagEngine({ store: new RagStore(db), bm25: new Bm25Cache(), llm: gateway });
    // Help corpus: index at startup (best-effort; works even with no keys
    // because chunks persist and BM25 does not need embeddings).
    if (!rag.bm25.has("public")) {
      for (const src of helpSources()) {
        try {
          await rag.index({ groupId: "public", sourceType: "help", sourceId: src.sourceId, title: src.title, text: src.text });
        } catch (e) {
          console.warn(`[rag] help index skipped ${src.sourceId}: ${e.message}`);
        }
      }
    }
    ragSingleton = rag;
    return ragSingleton;
  })();
  try {
    return await ragBuilding;
  } finally {
    ragBuilding = null;
  }
}

export const getRag = () => initRag().catch((e) => (console.warn(`[rag] unavailable: ${e.message}`), null));
