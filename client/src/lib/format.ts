// Display formatting only. Money arrives as decimal strings and is formatted
// with string operations — never parsed into floats, never added here.
// Any arithmetic on money happens in the engine; the client asks the API.

export type Money = { amount: string; currency: string };

const INR_GROUP = /\B(?=(\d{2})+(?!\d))/g;

/** "70800.00" → "₹70,800.00" (Indian grouping, 2 dp display). */
export function formatMoney(value: string | Money | null | undefined, currency?: string): string {
  if (value === null || value === undefined) return "Needs evidence";
  const amount = typeof value === "object" ? value.amount : value;
  const code = typeof value === "object" ? value.currency : currency || "INR";
  const [integer, fraction = "00"] = amount.split(".");
  const negative = integer.startsWith("-");
  const absolute = integer.replace(/^-/, "");
  const tail = absolute.slice(-3);
  const head = absolute.slice(0, -3).replace(INR_GROUP, ",");
  const grouped = head ? `${head},${tail}` : tail;
  const symbol = code === "INR" ? "₹" : `${code} `;
  return `${negative ? "−" : ""}${symbol}${grouped}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

/** Compact display for tight stat cards using lakh/crore (Indian convention),
 *  built by string slicing only — no arithmetic on the amount. */
export function formatMoneyCompact(value: string | Money | null | undefined, currency?: string): string {
  if (value === null || value === undefined) return "Needs evidence";
  const amount = typeof value === "object" ? value.amount : value;
  const code = typeof value === "object" ? value.currency : currency || "INR";
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
  return formatMoney(value, currency);
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
  const date = new Date(dateIso);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-based; April = 3
  const start = month >= 3 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Days-left phrasing: "in 5 days" / "today" / "3 days overdue". */
export function daysLeftText(days: number): string {
  if (days < 0) return `${-days} day${-days === 1 ? "" : "s"} overdue`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `${days} days left`;
}
