// store.js — rag_chunks persistence (C-owned, contract §4).
// Mongo when configured (Atlas $vectorSearch index `rag_vec` when
// RAG_VECTOR_INDEX is set; else in-process cosine over loaded chunks).
// In-memory fallback keeps the gateway functional without a DB.

import { ulid } from "ulid";
import { cosine } from "./embed.js";

const CHUNK_CAP_PER_GROUP = 5000;

export class RagStore {
  constructor(db = null, { vectorIndex = process.env.RAG_VECTOR_INDEX || "" } = {}) {
    this.col = db?.collection("rag_chunks") || null;
    this.vectorIndex = vectorIndex;
    this.mem = new Map(); // id -> chunk
    this.ready = this.col
      ? Promise.all([
          this.col.createIndex({ groupId: 1, sourceType: 1 }),
          this.col.createIndex({ groupId: 1, sourceId: 1 }),
        ]).catch(() => {})
      : Promise.resolve();
  }

  async put(chunk) {
    const doc = {
      id: `chk_${ulid()}`,
      groupId: chunk.groupId,
      sourceType: chunk.sourceType,
      sourceId: chunk.sourceId,
      title: chunk.title || null,
      text: chunk.text,
      page: chunk.page ?? null,
      chunkIndex: chunk.chunkIndex ?? 0,
      embedding: chunk.embedding || null,
      embeddingModel: chunk.embedding ? chunk.embeddingModel || "gemini-embedding-001" : null,
      createdAt: new Date().toISOString(),
    };
    if (this.col) {
      await this.ready;
      // replace previous chunks for the same source to keep index fresh
      if (doc.chunkIndex === 0) await this.col.deleteMany({ groupId: doc.groupId, sourceId: doc.sourceId });
      await this.col.insertOne(doc);
    }
    if (doc.chunkIndex === 0) {
      for (const [id, c] of this.mem) {
        if (c.groupId === doc.groupId && c.sourceId === doc.sourceId) this.mem.delete(id);
      }
    }
    this.mem.set(doc.id, doc);
    return doc;
  }

  /** All chunks for a group (BM25 index build + cosine fallback). */
  async forGroup(groupId, { cap = CHUNK_CAP_PER_GROUP } = {}) {
    const seen = new Map();
    if (this.col) {
      await this.ready;
      for await (const doc of this.col.find({ groupId }).limit(cap)) seen.set(doc.id, doc);
    }
    for (const c of this.mem.values()) if (c.groupId === groupId) seen.set(c.id, c);
    return [...seen.values()].slice(0, cap);
  }

  /** Vector search — Atlas $vectorSearch when configured, else cosine. */
  async vectorSearch(groupId, vector, { k = 16 } = {}) {
    if (this.col && this.vectorIndex) {
      await this.ready;
      try {
        const results = await this.col
          .aggregate([
            {
              $vectorSearch: {
                index: this.vectorIndex,
                path: "embedding",
                queryVector: vector,
                numCandidates: Math.max(k * 4, 40),
                limit: k,
                filter: { groupId },
              },
            },
            { $project: { embedding: 0 } },
          ])
          .toArray();
        if (results.length) return results;
      } catch {
        /* index missing or unsupported → cosine fallback */
      }
    }
    const chunks = (await this.forGroup(groupId)).filter((c) => c.embedding);
    return chunks
      .map((c) => ({ ...c, _score: cosine(vector, c.embedding) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, k);
  }

  async countMissingEmbeddings(groupId) {
    const chunks = await this.forGroup(groupId);
    return chunks.filter((c) => !c.embedding).length;
  }
}
