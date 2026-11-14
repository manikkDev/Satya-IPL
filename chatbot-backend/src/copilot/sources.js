// sources.js — citation registry. Every record a tool returns gets a short
// ref ("S3") that the model cites as [S3]; the UI renders it as a chip that
// links to the record. A citation is valid only if a tool really returned
// that record in this turn.

const DOC_KIND = {
  PO: "Purchase order", INVOICE_IN: "Invoice", GRN: "Goods receipt", QC: "Quality check",
  PAYMENT_OUT: "Payment", ADVANCE_OUT: "Advance", CREDIT_NOTE_IN: "Credit note", DEBIT_NOTE_IN: "Debit note",
  GSTR2B_ENTRY: "GSTR-2B row", RETURN: "Return",
};

export const docLabel = (type) => DOC_KIND[type] || "Document";

/** App deep link for a record (kept in one place so the UI agent can align). */
export function hrefFor({ kind, id, type, caseId, number }) {
  const q = encodeURIComponent(number || id || "");
  switch (kind) {
    case "case": return `/app/investigations/${encodeURIComponent(id)}`;
    case "supplier": return `/app/suppliers/${encodeURIComponent(id)}`;
    case "finding": return caseId ? `/app/investigations/${encodeURIComponent(caseId)}?finding=${encodeURIComponent(id)}` : "/app/investigations";
    case "payment": return `/app/payments?q=${q}`;
    case "compliance": return `/app/compliance${id ? `?tab=${encodeURIComponent(id)}` : ""}`;
    case "report": return id || "/app";
    case "document":
    default:
      if (type === "PO") return `/app/orders/${encodeURIComponent(id)}`;
      if (type === "PAYMENT_OUT" || type === "ADVANCE_OUT") return `/app/payments?q=${q}`;
      if (caseId) return `/app/investigations/${encodeURIComponent(caseId)}?doc=${encodeURIComponent(id)}`;
      return `/app/documents?q=${q}`;
  }
}

export class SourceRegistry {
  constructor() {
    this.byKey = new Map(); // kind:id -> ref
    this.items = new Map(); // ref -> source
    this.n = 0;
  }

  /** Register a record; returns its ref ("S1"). Deduped by kind+id. */
  add({ kind = "document", id, label, type, caseId, number, href, tool }) {
    if (!id) return null;
    const key = `${kind}:${id}`;
    if (this.byKey.has(key)) return this.byKey.get(key);
    const ref = `S${++this.n}`;
    this.byKey.set(key, ref);
    this.items.set(ref, {
      ref,
      kind,
      id,
      type: type || null,
      label: String(label || number || id).slice(0, 120),
      href: href || hrefFor({ kind, id, type, caseId, number }),
      tool: tool || null,
    });
    return ref;
  }

  get(ref) {
    return this.items.get(ref) || null;
  }

  refs() {
    return [...this.items.keys()];
  }

  /** Citations actually used in `text`, in order of first use. */
  used(text) {
    const seen = new Set();
    const out = [];
    for (const m of String(text || "").matchAll(/\[S(\d+)\]/g)) {
      const ref = `S${m[1]}`;
      if (seen.has(ref) || !this.items.has(ref)) continue;
      seen.add(ref);
      out.push({ n: out.length + 1, ...this.items.get(ref) });
    }
    return out;
  }

  /** Top-N sources (answer fallback when the text cites nothing). */
  top(n = 6) {
    return [...this.items.values()].slice(0, n).map((s, i) => ({ n: i + 1, ...s }));
  }
}

/**
 * Wrap untrusted free text (document descriptions, notes, OCR/RAG text,
 * supplier-written content) so the model treats it as quoted data. The
 * NumberBank skips anything wrapped this way.
 */
export function untrusted(text, max = 400) {
  const clean = String(text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/<\/?untrusted[^>]*>/gi, "").slice(0, max);
  return { __untrusted: true, text: `<untrusted>${clean}</untrusted>` };
}
