// Display formatting for the assistant (Indian grouping, IST dates). Values
// arrive as exact decimal strings from the API — never parsed into floats
// for money.

import type { ColumnFormat } from "@/lib/api/copilot";

export function indianGroup(numericText: string): string {
  const [whole, frac] = numericText.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.length <= 3 ? digits : `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${digits.slice(-3)}`;
  return `${sign}${grouped}${frac ? `.${frac}` : ""}`;
}

export function inr(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const raw = typeof value === "object" && value && "amount" in value ? String((value as { amount: unknown }).amount) : String(value);
  if (!/^-?\d+(\.\d+)?$/.test(raw.trim())) return raw;
  const [w, f = ""] = raw.trim().split(".");
  const paise = f.padEnd(2, "0").slice(0, 2);
  return `₹${indianGroup(paise === "00" ? w : `${w}.${paise}`)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(value: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(value ?? "—");
}

export function formatCell(value: unknown, format?: ColumnFormat): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (format) {
    case "inr":
      return inr(value);
    case "date":
      return shortDate(value);
    case "int":
      return String(value);
    case "pct":
      return `${value}%`;
    default:
      if (typeof value === "object") return JSON.stringify(value);
      return String(value).replaceAll("_", " ");
  }
}

/** "0.4s", "1.2s", "12s" */
export function duration(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  if (ms < 100) return "0.1s";
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

/** Time-of-day greeting in IST. */
export function greeting(name?: string | null): string {
  const hour = new Date(Date.now() + 330 * 60000).getUTCHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const first = (name || "").trim().split(/[\s@]+/)[0];
  return first ? `${part}, ${first[0].toUpperCase()}${first.slice(1)}` : part;
}

/** Bucket for the history rail. */
export function dayBucket(iso?: string): "Today" | "Yesterday" | "Previous 7 days" | "Older" {
  if (!iso) return "Older";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Older";
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= start) return "Today";
  if (t >= start - 86400000) return "Yesterday";
  if (t >= start - 7 * 86400000) return "Previous 7 days";
  return "Older";
}

export function relativeTime(iso?: string): string {
  if (!iso) return "";
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return "";
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d ago` : shortDate(iso.slice(0, 10));
}
