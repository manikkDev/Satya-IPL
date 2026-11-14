// One money helper for every server-side money computation.
//
// Documents carry money in three historical shapes — a decimal string
// ("118000.00"), a Money object ({amount, currency}) and a plain number — and
// Number()-ing the object shape yields NaN, which silently made every invoice
// look unpaid. Everything here parses any of those shapes into integer paise
// (BigInt) so sums and comparisons are exact, then formats back to a 2-dp
// decimal string. Rounding to paise is half-up (away from zero).

const DECIMAL = /^([+-])?(\d+)(?:\.(\d+))?$/;

/** Raw amount out of any supported shape, or null when absent/unparseable. */
export const rawAmount = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    if (value._bsontype === "Decimal128") return value.toString();
    return rawAmount(value.amount);
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[₹,\s]/g, "").replace(/^INR/i, "");
    return cleaned === "" ? null : cleaned;
  }
  return null;
};

/** Any money shape -> BigInt paise, or null when missing/invalid. */
export const toPaiseOrNull = (value) => {
  const raw = rawAmount(value);
  if (raw === null) return null;
  if (typeof raw === "bigint") return raw * 100n;
  // numbers go through a fixed-point string so float artefacts never leak
  const text = typeof raw === "number" ? raw.toFixed(6) : String(raw);
  const m = DECIMAL.exec(text);
  if (!m) return null;
  const negative = m[1] === "-";
  const frac = (m[3] || "").padEnd(3, "0");
  let paise = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) paise += 1n; // half-up on the third decimal
  return negative ? -paise : paise;
};

/** Like toPaiseOrNull but missing/invalid counts as zero. */
export const toPaise = (value) => toPaiseOrNull(value) ?? 0n;

/** BigInt paise -> "1234.50". */
export const fromPaise = (paise) => {
  const p = BigInt(paise);
  const negative = p < 0n;
  const abs = negative ? -p : p;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
};

/** Any money shape -> 2-dp decimal string ("0.00" when absent). */
export const toDecimal = (value) => fromPaise(toPaise(value));
/** Money object for API responses. */
export const money = (value, currency = "INR") => ({ amount: toDecimal(value), currency });

export const add = (...values) => fromPaise(values.reduce((s, v) => s + toPaise(v), 0n));
export const sub = (a, b) => fromPaise(toPaise(a) - toPaise(b));
export const sumPaise = (values, pick = (v) => v) => values.reduce((s, v) => s + toPaise(pick(v)), 0n);
export const sum = (values, pick = (v) => v) => fromPaise(sumPaise(values, pick));
export const cmp = (a, b) => {
  const d = toPaise(a) - toPaise(b);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
};
export const isPositive = (value) => toPaise(value) > 0n;
export const max0 = (value) => (toPaise(value) < 0n ? "0.00" : toDecimal(value));

/** value × decimal factor (e.g. qty "2.5" or rate "0.001"), half-up to paise. */
export const mulRate = (value, rate) => {
  const paise = toPaise(value);
  const m = DECIMAL.exec(String(rate ?? "").trim());
  if (!m) return "0.00";
  const scale = (m[3] || "").length;
  const r = BigInt(`${m[2]}${m[3] || ""}`) * (m[1] === "-" ? -1n : 1n);
  const denom = 10n ** BigInt(scale);
  const product = paise * r;
  const neg = product < 0n;
  const abs = neg ? -product : product;
  let q = abs / denom;
  if ((abs % denom) * 2n >= denom) q += 1n;
  return fromPaise(neg ? -q : q);
};

/** Float for sorting/charts/percentages only — never for money arithmetic. */
export const toNumber = (value) => Number(toDecimal(value));

const qtyText = (q) => {
  const raw = rawAmount(q);
  return raw === null ? "0" : typeof raw === "number" ? String(raw) : String(raw);
};

/** Taxable value estimate from lines (qty × rate less discount) + charges. */
export const taxableEstimate = (doc) => {
  let total = 0n;
  for (const l of doc?.lines || []) {
    const explicit = toPaiseOrNull(l.taxableValue ?? l.amount);
    if (explicit !== null) { total += explicit; continue; }
    let line = toPaise(mulRate(l.rate, qtyText(l.qty)));
    const disc = rawAmount(l.discountPct);
    if (disc !== null && Number(disc) > 0) line -= toPaise(mulRate(fromPaise(line), (Number(disc) / 100).toFixed(6)));
    total += line;
  }
  for (const c of doc?.charges || []) total += toPaise(c.amount);
  return fromPaise(total);
};

/** Grand total: totals.grand in any shape, else the taxable line estimate. */
export const grandOf = (doc) => {
  const g = toPaiseOrNull(doc?.totals?.grand ?? doc?.totals?.grandTotal);
  if (g !== null && g !== 0n) return fromPaise(g);
  return taxableEstimate(doc);
};

/** Taxable value: totals.taxable when recorded, else the line estimate. */
export const taxableOf = (doc) => {
  const t = toPaiseOrNull(doc?.totals?.taxable);
  return t !== null && t !== 0n ? fromPaise(t) : taxableEstimate(doc);
};

/** GST (cgst+sgst+igst+cess); gst.itcAmount wins when recorded. */
export const taxOf = (doc) => {
  const itc = toPaiseOrNull(doc?.gst?.itcAmount);
  if (itc !== null && itc !== 0n) return fromPaise(itc);
  return fromPaise(["cgst", "sgst", "igst", "cess"].reduce((s, k) => s + toPaise(doc?.totals?.[k]), 0n));
};

/** Sum of a payment document's recorded allocations. */
export const allocatedOf = (paymentDoc) => sum(paymentDoc?.payment?.allocations || [], (a) => a.amount);
