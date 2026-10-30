// facts.js — the facts + evidence registry every answer is built from.
// Rule (00 §4.1): LLM output never produces a number shown to a user —
// numbers exist only as {{F#}} placeholders filled from tool results here.
// Also owns Indian display formatting (₹1,23,456.00, lakh grouping) and the
// [E#] citation map.

/** Indian digit grouping: 1234567.89 → "12,34,567.89". Input stays a string. */
export function indianGroup(numericText) {
  const [whole, frac] = String(numericText).split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  if (digits.length <= 3) return `${sign}${digits}${frac != null ? `.${frac}` : ""}`;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${sign}${rest},${last3}${frac != null ? `.${frac}` : ""}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Render one fact value for the user. Unit drives formatting. */
export function renderFactValue({ value, unit }) {
  if (value == null) return "";
  const text = String(value);
  switch (unit) {
    case "INR":
      return `₹${indianGroup(text.includes(".") ? text : `${text}.00`)}`;
    case "PCT":
      return `${text}%`;
    case "DATE": {
      const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return text;
      return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
    }
    case "DAYS":
      return `${text} day${text === "1" ? "" : "s"}`;
    case "QTY":
    case "COUNT":
      return text;
    default:
      // unit may be a UOM code (NOS, KG, SET, BOX, M, L, PAIR, ROLL, LOT, EA)
      return unit ? `${text} ${unit}` : text;
  }
}

const FACT_RE = /\{\{F(\d+)\}\}/g;
const CITE_RE = /\[E(\d+)\]/g;

export class FactRegistry {
  constructor() {
    this.facts = new Map(); // "F7" -> {id,label,value,unit,certainty,evidenceIds,documentIds}
    this.evidence = new Map(); // "E3" -> {n,evidenceId,label,documentId,href}
    this._f = 0;
    this._e = 0;
  }

  /**
   * Register a numeric/factual claim. Tools call this for every value the
   * answer may cite. Returns the assigned id ("F1", "F2", …).
   */
  addFact({ label = "fact", value, unit = null, certainty = "CONFIRMED", evidenceIds = [], documentIds = [] }) {
    label = label || "fact";
    const id = `F${++this._f}`;
    this.facts.set(id, { id, label, value, unit, certainty, evidenceIds, documentIds });
    return id;
  }

  addEvidence({ evidenceId, label, documentId, locator, href }) {
    // De-dupe by evidenceId so repeated cites share one number.
    for (const e of this.evidence.values()) {
      if (e.evidenceId === evidenceId) return `E${e.n}`;
    }
    const n = ++this._e;
    this.evidence.set(`E${n}`, { n, evidenceId, label, documentId, locator, href });
    return `E${n}`;
  }

  hasFact(id) {
    return this.facts.has(id);
  }

  hasEvidence(id) {
    return this.evidence.has(id);
  }

  factIds() {
    return [...this.facts.keys()];
  }

  evidenceIds() {
    return [...this.evidence.keys()];
  }

  /** Substitute {{F#}} placeholders with display values (Indian formats). */
  render(text) {
    return String(text || "").replace(FACT_RE, (_m, n) => {
      const fact = this.facts.get(`F${n}`);
      return fact ? renderFactValue(fact) : `F${n}`;
    });
  }

  /** [E#] → citation objects for the SSE answer event (contract §7). */
  citations(text) {
    const used = new Set();
    const out = [];
    for (const m of String(text || "").matchAll(CITE_RE)) {
      const key = `E${m[1]}`;
      if (used.has(key)) continue;
      used.add(key);
      const e = this.evidence.get(key);
      if (e) out.push({ n: e.n, evidenceId: e.evidenceId, label: e.label, documentId: e.documentId, href: e.href });
    }
    return out;
  }

  /** Weakest certainty among the given facts (or INSUFFICIENT when empty). */
  weakestCertainty(ids = this.factIds()) {
    const order = ["CONFIRMED", "PROBABLE", "POSSIBLE", "AMBIGUOUS", "INSUFFICIENT_EVIDENCE"];
    let weakest = "CONFIRMED";
    for (const id of ids) {
      const c = this.facts.get(id)?.certainty;
      if (c && order.indexOf(c) > order.indexOf(weakest)) weakest = c;
    }
    return ids.length ? weakest : "INSUFFICIENT_EVIDENCE";
  }

  /** Compact fact map for the write prompt and the answer event. */
  asPromptMap() {
    return Object.fromEntries(
      [...this.facts.values()].map((f) => [
        f.id,
        { label: f.label, unit: f.unit, certainty: f.certainty, evidenceIds: f.evidenceIds },
      ]),
    );
  }

  /** Facts for the answer event payload (values rendered, labels kept). */
  forAnswer() {
    return Object.fromEntries(
      [...this.facts.values()].map((f) => [
        f.id,
        { label: f.label, value: renderFactValue(f), unit: f.unit, certainty: f.certainty, documentIds: f.documentIds },
      ]),
    );
  }
}
