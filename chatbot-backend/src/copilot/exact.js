// exact.js — exact decimal arithmetic for every figure the copilot shows.
// Values are BigInt fixed-point with 12 decimal places; parsing accepts
// Indian money text ("₹2,07,400.50", "Rs 5 lakh", "1.2 crore", "18%").
// The calculator tool evaluates + − × ÷ %, parentheses and a few functions
// with this type, so arithmetic never goes through model prose or floats.

const SCALE = 12n;
const ONE = 10n ** SCALE;

const UNITS = { lakh: 100000n, lakhs: 100000n, lac: 100000n, lacs: 100000n, l: 100000n, crore: 10000000n, crores: 10000000n, cr: 10000000n, k: 1000n, thousand: 1000n };

/** Parse "₹2,07,400.50" / "-12.5" / "5 lakh" → fixed-point BigInt, or null. */
export function parseExact(input) {
  if (typeof input === "bigint") return input * ONE;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    input = String(input);
  }
  if (input && typeof input === "object" && "amount" in input) input = input.amount;
  const text = String(input ?? "").trim().toLowerCase().replace(/^(?:₹|rs\.?|inr)\s*/, "").replace(/,/g, "");
  const m = /^(-)?(\d+)(?:\.(\d+))?\s*(lakhs?|lacs?|crores?|cr|k|thousand|l)?$/.exec(text);
  if (!m) return null;
  const frac = (m[3] || "").slice(0, Number(SCALE)).padEnd(Number(SCALE), "0");
  let v = BigInt(m[2]) * ONE + BigInt(frac || "0");
  if (m[4]) v *= UNITS[m[4]];
  return m[1] ? -v : v;
}

const abs = (v) => (v < 0n ? -v : v);

/** Round fixed-point to `dp` decimals, half away from zero. */
export function roundTo(v, dp = 2) {
  const step = 10n ** (SCALE - BigInt(dp));
  const q = abs(v) / step;
  const r = abs(v) % step;
  const n = r * 2n >= step ? q + 1n : q;
  return (v < 0n ? -n : n) * step;
}

/** Fixed-point → plain decimal string. dp=null trims trailing zeros. */
export function formatExact(v, dp = null) {
  const value = dp == null ? v : roundTo(v, dp);
  const sign = value < 0n ? "-" : "";
  const a = abs(value);
  const whole = a / ONE;
  let frac = (a % ONE).toString().padStart(Number(SCALE), "0");
  if (dp == null) frac = frac.replace(/0+$/, "");
  else frac = frac.slice(0, dp);
  return `${sign}${whole}${frac ? `.${frac}` : ""}`;
}

export const add = (a, b) => a + b;
export const sub = (a, b) => a - b;
export const mul = (a, b) => (a * b) / ONE;
export function div(a, b) {
  if (b === 0n) throw new Error("division by zero");
  // half-away rounding at the 12th decimal
  const num = a * ONE * 2n;
  const q = num / b;
  return q >= 0n ? (q + 1n) / 2n : (q - 1n) / 2n;
}

/** Sum money-ish values exactly; returns a 2-dp string. */
export function sumMoney(values) {
  let total = 0n;
  for (const v of values) total += parseExact(v) ?? 0n;
  return formatExact(total, 2);
}

/** Indian digit grouping for a decimal string: 1234567.5 → 12,34,567.5 */
export function indianGroup(numericText) {
  const [whole, frac] = String(numericText).split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.length <= 3 ? digits : `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${digits.slice(-3)}`;
  return `${sign}${grouped}${frac != null && frac !== "" ? `.${frac}` : ""}`;
}

/** "₹2,07,400.00" from any money-ish input (amount object, string, number). */
export function inr(value, { paise = true } = {}) {
  const v = parseExact(value);
  if (v == null) return "—";
  const text = formatExact(v, 2);
  const [w, f] = text.split(".");
  return `₹${indianGroup(paise && f !== "00" ? `${w}.${f}` : w)}`;
}

/* ------------------------------------------------------------ calculator */

const FUNCS = {
  sum: (args) => args.reduce((s, v) => s + v, 0n),
  min: (args) => args.reduce((a, b) => (b < a ? b : a)),
  max: (args) => args.reduce((a, b) => (b > a ? b : a)),
  abs: ([a]) => abs(a),
  round: ([a, dp]) => roundTo(a, dp == null ? 2 : Number(formatExact(dp, 0))),
  avg: (args) => div(args.reduce((s, v) => s + v, 0n), BigInt(args.length) * ONE),
  pct: ([part, whole]) => mul(div(part, whole), 100n * ONE),
};

function tokenize(src) {
  const tokens = [];
  // grouped numbers only when the commas are real digit grouping (Indian or
  // western), so "sum(1,2,3)" keeps its argument commas
  const re = /\s*(?:(₹|rs\.?|inr)?\s*((?:\d{1,2}(?:,\d{2})*,\d{3}(?!\d)|\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr\b|k\b|thousand)?|([A-Za-z_]+)|(\*\*|[-+*/%(),×÷x^]))/giy;
  let m;
  let last = 0;
  while (last < src.length) {
    re.lastIndex = last;
    m = re.exec(src);
    if (!m || m.index !== last) {
      if (/^\s*$/.test(src.slice(last))) break;
      throw new Error(`can't read "${src.slice(last, last + 12)}"`);
    }
    last = re.lastIndex;
    if (m[2] != null) tokens.push({ t: "num", v: parseExact(`${m[2]}${m[3] ? ` ${m[3]}` : ""}`) });
    else if (m[4]) {
      const word = m[4].toLowerCase();
      if (word === "x") tokens.push({ t: "op", v: "*" });
      else if (word === "of") tokens.push({ t: "op", v: "of" });
      else tokens.push({ t: "id", v: word });
    } else if (m[5]) tokens.push({ t: "op", v: m[5] === "×" || m[5].toLowerCase() === "x" ? "*" : m[5] === "÷" ? "/" : m[5] });
  }
  return tokens;
}

/**
 * Evaluate an arithmetic expression exactly.
 * Supports + - * / (× ÷ x), parentheses, unary minus, "18%" (=0.18),
 * "18% of 250000", lakh/crore/k suffixes and sum/min/max/abs/round/avg/pct.
 * @returns {{value:string, rounded:string}} exact (trimmed) and 2-dp strings
 */
export function evaluate(expression) {
  const src = String(expression || "").slice(0, 500);
  if (!src.trim()) throw new Error("empty expression");
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const eat = (v) => {
    const tok = tokens[i];
    if (!tok || (v && tok.v !== v)) throw new Error(`expected ${v || "a value"}`);
    i += 1;
    return tok;
  };
  const primary = () => {
    const tok = peek();
    if (!tok) throw new Error("unexpected end");
    if (tok.t === "op" && tok.v === "-") { eat(); return -postfix(); }
    if (tok.t === "op" && tok.v === "+") { eat(); return postfix(); }
    if (tok.t === "op" && tok.v === "(") { eat("("); const v = expr(); eat(")"); return v; }
    if (tok.t === "num") { eat(); return tok.v; }
    if (tok.t === "id") {
      const fn = FUNCS[tok.v];
      if (!fn) throw new Error(`unknown function ${tok.v}`);
      eat();
      eat("(");
      const args = [expr()];
      while (peek()?.v === ",") { eat(","); args.push(expr()); }
      eat(")");
      return fn(args);
    }
    throw new Error(`unexpected "${tok.v}"`);
  };
  const postfix = () => {
    let v = primary();
    while (peek()?.v === "%") {
      eat("%");
      v = div(v, 100n * ONE);
      if (peek()?.v === "of") { eat("of"); v = mul(v, postfix()); }
    }
    return v;
  };
  const term = () => {
    let v = postfix();
    while (peek() && ["*", "/"].includes(peek().v)) {
      const op = eat().v;
      const r = postfix();
      v = op === "*" ? mul(v, r) : div(v, r);
    }
    return v;
  };
  function expr() {
    let v = term();
    while (peek() && ["+", "-"].includes(peek().v)) {
      const op = eat().v;
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  const value = expr();
  if (i < tokens.length) throw new Error(`unexpected "${tokens[i].v}"`);
  return { value: formatExact(value), rounded: formatExact(value, 2) };
}
