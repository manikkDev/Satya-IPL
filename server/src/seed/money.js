// Integer-paise money helpers for the curated demo seed. Every amount is a
// BigInt count of paise internally and a 2-dp decimal string at the edges —
// never a float, so CGST + SGST always equals the tax total to the paisa.

const DEC = /^(-)?(\d+)(?:\.(\d{1,6}))?$/;

// "1234.5" -> 123450n (paise). Extra precision beyond 2 dp must be zero.
export const toPaise = (value) => {
  if (typeof value === "bigint") return value;
  const text = String(value).trim();
  const m = DEC.exec(text);
  if (!m) throw new Error(`Not a decimal amount: ${value}`);
  const frac = (m[3] || "").padEnd(6, "0");
  if (/[1-9]/.test(frac.slice(2))) throw new Error(`Amount has sub-paisa precision: ${value}`);
  const paise = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2));
  return m[1] ? -paise : paise;
};

// 123450n -> "1234.50"
export const fmt = (paise) => {
  const p = BigInt(paise);
  const neg = p < 0n;
  const abs = neg ? -p : p;
  return `${neg ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
};

export const sum = (values) => values.reduce((s, v) => s + toPaise(v), 0n);

// Round-half-up integer division for non-negative numerators.
export const divRoundHalfUp = (num, den) => {
  if (den <= 0n) throw new Error("Denominator must be positive");
  if (num < 0n) return -divRoundHalfUp(-num, den);
  return (num * 2n + den) / (2n * den);
};

// Quantities are whole units or up to 3 dp ("12", "2.5"); returns
// [numerator, scale] so qty × rate stays exact.
const qtyParts = (qty) => {
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(String(qty));
  if (!m) throw new Error(`Not a quantity: ${qty}`);
  const frac = (m[2] || "").padEnd(3, "0");
  return [BigInt(m[1]) * 1000n + BigInt(frac), 1000n];
};

// qty × rate (rate in rupees) -> paise, half-up at the paisa.
export const lineAmount = (qty, rate) => {
  const [q, scale] = qtyParts(qty);
  return divRoundHalfUp(q * toPaise(rate), scale);
};

// taxable × pct% -> paise, half-up. pct is a decimal string like "9" or "2.5".
export const percentOf = (paise, pct) => {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(pct));
  if (!m) throw new Error(`Not a percentage: ${pct}`);
  const hundredths = BigInt(m[1]) * 100n + BigInt((m[2] || "").padEnd(2, "0"));
  return divRoundHalfUp(BigInt(paise) * hundredths, 10000n);
};

// GST on one line. Intra-state: CGST and SGST are each computed on half the
// rate and the tax total is defined as their sum (so it always reconciles).
export const lineTax = (taxablePaise, gstRate, intraState) => {
  const rate = String(gstRate);
  if (intraState) {
    const half = halfRate(rate);
    const cgst = percentOf(taxablePaise, half);
    return { cgst, sgst: cgst, igst: 0n, tax: cgst * 2n };
  }
  const igst = percentOf(taxablePaise, rate);
  return { cgst: 0n, sgst: 0n, igst, tax: igst };
};

export const halfRate = (rate) => {
  const hundredths = toPaise(rate); // reuse 2-dp parser: "18" -> 1800n
  if (hundredths % 2n) throw new Error(`Rate ${rate} cannot be halved to 2 dp`);
  return fmt(hundredths / 2n).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
};

// Split `total` paise across weights (largest-remainder, deterministic) so
// the parts always sum to exactly `total`.
export const splitProRata = (total, weights) => {
  const t = BigInt(total);
  const w = weights.map((x) => BigInt(x));
  const W = w.reduce((s, x) => s + x, 0n);
  if (W === 0n) throw new Error("Cannot split across zero weights");
  const base = w.map((x) => (t * x) / W);
  let rest = t - base.reduce((s, x) => s + x, 0n);
  const order = w.map((x, i) => [(t * x) % W, i]).sort((a, b) => (b[0] > a[0] ? 1 : b[0] < a[0] ? -1 : a[1] - b[1]));
  for (const [, i] of order) { if (rest <= 0n) break; base[i] += 1n; rest -= 1n; }
  return base;
};
