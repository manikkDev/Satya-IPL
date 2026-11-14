// Case titles arrive as "PO SATYAD/PO/26-27/000029 — Meridian Pump Supply".
// Lists and headers read better as supplier first, order number second.

export function splitCaseTitle(title?: string | null, fallback = "Order check"): { supplier: string; reference: string } {
  const text = (title ?? "").trim();
  if (!text) return { supplier: fallback, reference: "" };
  const parts = text.split(/\s+[—–-]\s+/);
  if (parts.length >= 2) {
    const reference = parts[0].replace(/^PO\s+/i, "Order ");
    return { supplier: parts.slice(1).join(" — "), reference };
  }
  return { supplier: text, reference: "" };
}

/** "SATYAD/PO/26-27/000029" from a case title, if present. */
export function orderNumberFromTitle(title?: string | null): string | null {
  const m = (title ?? "").match(/^PO\s+(\S+)/i);
  return m ? m[1] : null;
}
