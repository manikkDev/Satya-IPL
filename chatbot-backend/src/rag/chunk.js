// chunk.js — split document text into ~800-token chunks with ~100-token
// overlap, preserving page numbers when the input carries them.
// Approximation: 1 token ≈ 4 chars (English + numerals) — close enough for
// retrieval chunking; exact tokenization isn't needed to split well.

const CHARS_PER_TOKEN = 4;
const CHUNK_TOKENS = 800;
const OVERLAP_TOKENS = 100;
const CHUNK_CHARS = CHUNK_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

/**
 * @param {string|{page:number,text:string}[]} input full text or per-page text
 * @returns {{text:string,page:number|null,chunkIndex:number}[]}
 */
export function chunkText(input) {
  const pages = Array.isArray(input) ? input : [{ page: null, text: String(input || "") }];
  const chunks = [];
  let index = 0;
  for (const { page, text } of pages) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    if (clean.length <= CHUNK_CHARS) {
      chunks.push({ text: clean, page: page ?? null, chunkIndex: index++ });
      continue;
    }
    let start = 0;
    while (start < clean.length) {
      let end = Math.min(start + CHUNK_CHARS, clean.length);
      // prefer a sentence/word boundary inside the last 20% of the window
      if (end < clean.length) {
        const windowStart = start + Math.floor(CHUNK_CHARS * 0.8);
        const boundary = clean.slice(windowStart, end).search(/[.!?\n]\s/);
        if (boundary > 0) end = windowStart + boundary + 1;
      }
      chunks.push({ text: clean.slice(start, end).trim(), page: page ?? null, chunkIndex: index++ });
      if (end >= clean.length) break;
      start = Math.max(0, end - OVERLAP_CHARS);
    }
  }
  return chunks;
}
