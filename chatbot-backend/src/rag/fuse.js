// fuse.js — Reciprocal Rank Fusion (k=60) over BM25 + vector rankings.

const RRF_K = 60;

/**
 * @param {string[][]} rankings ordered id lists, best first
 * @returns {string[]} fused ordered ids
 */
export function rrf(...rankings) {
  const scores = new Map(); // id -> score
  for (const list of rankings) {
    if (!list) continue;
    list.forEach((id, rank) => {
      scores.set(id, (scores.get(id) || 0) + 1 / (RRF_K + rank + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
