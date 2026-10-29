// bm25.js — lexical search over rag_chunks via minisearch, built lazily per
// group and LRU-cached (cap 5k chunks/group per 05 §P2-C5).

import MiniSearch from "minisearch";

const MAX_INDEXES = 20;

export class Bm25Cache {
  constructor() {
    this.indexes = new Map(); // groupId -> {index, builtAt, docs}
    this.access = new Map(); // groupId -> lastUsed ms
  }

  /** (Re)build the index for a group. */
  build(groupId, chunks) {
    const index = new MiniSearch({
      fields: ["text", "title"],
      storeFields: ["id"],
      searchOptions: { boost: { title: 2 }, prefix: true, fuzzy: 0.15 },
    });
    index.addAll(chunks.map((c, i) => ({ docid: i, id: c.id, text: c.text, title: c.title || "" })));
    this._evictIfNeeded();
    this.indexes.set(groupId, { index, builtAt: Date.now(), chunkIds: chunks.map((c) => c.id) });
    this.access.set(groupId, Date.now());
  }

  /** Search; returns ordered chunk ids (best first). Null when no index. */
  search(groupId, query, { k = 16 } = {}) {
    const entry = this.indexes.get(groupId);
    if (!entry) return null;
    this.access.set(groupId, Date.now());
    return entry.index.search(query).slice(0, k).map((r) => r.id);
  }

  has(groupId) {
    return this.indexes.has(groupId);
  }

  _evictIfNeeded() {
    if (this.indexes.size < MAX_INDEXES) return;
    const oldest = [...this.access.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest) {
      this.indexes.delete(oldest[0]);
      this.access.delete(oldest[0]);
    }
  }
}
