// embed.js — embeddings through the gateway (gemini-embedding-001, 768 dims).
// output_dimensionality truncates → vectors must be L2-normalised manually
// (verified fact, 05 §2). RETRIEVAL_DOCUMENT for indexing,
// RETRIEVAL_QUERY for search.

export const EMBED_DIMS = 768;

export function l2Normalize(vector) {
  const norm = Math.sqrt(vector.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? vector : vector.map((x) => x / norm);
}

export function cosine(a, b) {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // inputs are normalised → dot = cosine
}

/** Embed one text via the gateway; returns {ok, vector} (normalised). */
export async function embedOne(llm, text, taskType) {
  const out = await llm.embed([text], { taskType, outputDimensionality: EMBED_DIMS });
  if (!out.ok) return { ok: false, reason: out.reason };
  return { ok: true, vector: l2Normalize(out.vectors[0]) };
}

/**
 * Batch-embed with simple backpressure: sequential calls through the pool
 * (the pool already enforces ≤4 in-flight). Chunks that fail are returned
 * without vectors for later backfill (05 §P2-C5).
 */
export async function embedBatch(llm, texts, taskType = "RETRIEVAL_DOCUMENT") {
  const vectors = [];
  for (const text of texts) {
    const r = await embedOne(llm, text, taskType);
    vectors.push(r.ok ? r.vector : null);
  }
  return vectors;
}
