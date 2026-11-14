// Display formatting + exact money helpers. Money arrives as decimal strings
// (sometimes as {amount}, occasionally as a number from older records). It is
// never added as a float: arithmetic uses integer paise (bigint).

export type Money = { amount: string; currency: string };
export type MoneyInput = string | number | Money | { amount?: string | number | null; currency?: string } | null | undefined;

const INR_GROUP = /\B(?=(\d{2})+(?!\d))/g;

/** Any money-ish input → canonical decimal string ("-1234.50"), or null. */
export function moneyString(value: MoneyInput): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return moneyString(value.amount as string | number | null | undefined);
  if (typeof value === "number") return Number.isFinite(value) ? value.toFixed(2) : null;
  const cleaned = String(value).replace(/[,₹\s]/g, "").replace(/^\+/, "");
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? cleaned : null;
}

/** Decimal string → integer paise, rounding half away from zero at 2 dp. */
export function toPaise(value: MoneyInput): bigint {
  const text = moneyString(value);
  if (text === null) return BigInt(0);
  const negative = text.startsWith("-");
  const [intPart, frac = ""] = text.replace(/^-/, "").split(".");
  let paise = BigInt(intPart || "0") * BigInt(100) + BigInt((frac + "00").slice(0, 2));
  if (Number(frac[2] ?? "0") >= 5) paise += BigInt(1);
  return negative ? -paise : paise;
}

/** Integer paise → "1234.50". */
export function fromPaise(paise: bigint): string {
  const negative = paise < BigInt(0);
  const abs = negative ? -paise : paise;
  const rupees = abs / BigInt(100);
  const rest = (abs % BigInt(100)).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${rupees}.${rest}`;
}

/** Exact sum of money values as a decimal string. */
export function sumMoney(values: MoneyInput[]): string {
  return fromPaise(values.reduce<bigint>((acc, v) => acc + toPaise(v), BigInt(0)));
}

function currencyOf(value: MoneyInput, currency?: string) {
  if (value && typeof value === "object" && "currency" in value && value.currency) return value.currency;
  return currency || "INR";
}

/** "70800" → "₹70,800.00" (Indian grouping, rounded to 2 dp). */
export function formatMoney(value: MoneyInput, currency?: string, fallback = "—"): string {
  const text = moneyString(value);
  if (text === null) return fallback;
  const canonical = fromPaise(toPaise(text));
  const code = currencyOf(value, currency);
  const [integer, fraction] = canonical.split(".");
  const negative = integer.startsWith("-") && canonical !== "-0.00";
  const absolute = integer.replace(/^-/, "");
  const tail = absolute.slice(-3);
  const head = absolute.slice(0, -3).replace(INR_GROUP, ",");
  const grouped = head ? `${head},${tail}` : tail;
  const symbol = code === "INR" ? "₹" : `${code} `;
  return `${negative ? "−" : ""}${symbol}${grouped}.${fraction}`;
}

/** Compact display for tight stat cards using lakh/crore (Indian convention),
 *  built by string slicing only — no arithmetic on the amount. */
export function formatMoneyCompact(value: MoneyInput, currency?: string, fallback = "—"): string {
  const text = moneyString(value);
  if (text === null) return fallback;
  const amount = fromPaise(toPaise(text));
  const code = currencyOf(value, currency);
  const symbol = code === "INR" ? "₹" : `${code} `;
  const negative = amount.startsWith("-") ? "−" : "";
  const intPart = amount.split(".")[0].replace(/^-/, "");
  if (intPart.length >= 8) {
    const whole = intPart.slice(0, -7);
    const frac = intPart.slice(-7, -5).replace(/0+$/, "");
    return `${negative}${symbol}${whole}${frac ? `.${frac}` : ""} crore`;
  }
  if (intPart.length >= 6) {
    const whole = intPart.slice(0, -5);
    const frac = intPart.slice(-5, -3).replace(/0+$/, "");
    return `${negative}${symbol}${whole}${frac ? `.${frac}` : ""} lakh`;
  }
  return formatMoney(amount, code);
}

/** "40.000" → "40"; "2.500" → "2.5". Trims only trailing zeros after a decimal point. */
export function formatQty(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (!value.includes(".")) return value;
  const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}

/** ISO/date-only → "30 Oct 2026" (business dates are plain YYYY-MM-DD). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00+05:30` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
}

/** ISO → "30 Oct 2026, 3:04 PM" in IST. */
export function formatDateTimeIst(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
  const time = date.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
  return `${day}, ${time}`;
}

/** Indian financial year, April start: 2026-10-01 → "2026-27". */
export function fyOf(dateIso: string): string {
  const day = dateIso.length === 10 ? dateIso : isoDateIst(new Date(dateIso));
  const [year, month] = day.split("-").map(Number);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Calendar date in India (YYYY-MM-DD) for a JS Date — not the UTC date. */
export function isoDateIst(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Whole days from today (IST) to a business date; negative when past. */
export function daysFromTodayIst(dateIso: string | null | undefined): number | null {
  if (!dateIso) return null;
  const target = Date.parse(`${dateIso.slice(0, 10)}T00:00:00+05:30`);
  const today = Date.parse(`${isoDateIst()}T00:00:00+05:30`);
  if (Number.isNaN(target)) return null;
  return Math.round((target - today) / 86_400_000);
}

/** Days-left phrasing: "in 5 days" / "today" / "3 days overdue". */
export function daysLeftText(days: number): string {
  if (days < 0) return `${-days} day${-days === 1 ? "" : "s"} overdue`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `${days} days left`;
}
