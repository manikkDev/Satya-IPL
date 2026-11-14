"use client";

import { FileSpreadsheet, FileCode2, Landmark, ReceiptIndianRupee, Users, Package, ClipboardList, PackageCheck, FileText, FileMinus2, Wallet, CircleCheck, CircleDot, CircleAlert, CircleX, CircleDashed, RefreshCw, type LucideIcon } from "lucide-react";
import type { ImportSource } from "@/lib/api/imports";
import { cn } from "@/lib/utils";

export type SourceMeta = { source: ImportSource; label: string; short: string; icon: LucideIcon; blurb: string; accept: string; group: "systems" | "templates" };

export const SOURCES: SourceMeta[] = [
  { source: "tally_xml", label: "TallyPrime XML", short: "Tally", icon: FileCode2, group: "systems", accept: ".xml", blurb: "Day Book or voucher export plus ledger and stock-item masters. Purchase orders, receipt notes, purchases, rejections, debit notes and payments." },
  { source: "bank_statement", label: "Bank statement", short: "Bank", icon: Landmark, group: "systems", accept: ".csv,.xlsx,.sta,.txt,.940", blurb: "CSV or Excel from HDFC, ICICI, SBI, Axis, Kotak and most banks — columns are detected for you. MT940 too." },
  { source: "gstr2b_json", label: "GSTR-2B JSON", short: "GSTR-2B", icon: ReceiptIndianRupee, group: "systems", accept: ".json", blurb: "From the GST portal (Returns › GSTR-2B › Download JSON). Matched to your purchase invoices automatically." },
  { source: "template:suppliers", label: "Suppliers", short: "Suppliers", icon: Users, group: "templates", accept: ".csv,.xlsx", blurb: "Vendor master with GSTIN, PAN, Udyam and payment terms." },
  { source: "template:items", label: "Items", short: "Items", icon: Package, group: "templates", accept: ".csv,.xlsx", blurb: "Material master with HSN and GST rate." },
  { source: "template:purchase_orders", label: "Purchase orders", short: "POs", icon: ClipboardList, group: "templates", accept: ".csv,.xlsx", blurb: "One row per PO line." },
  { source: "template:grns", label: "Goods receipts", short: "GRNs", icon: PackageCheck, group: "templates", accept: ".csv,.xlsx", blurb: "Received, accepted and rejected quantities against POs." },
  { source: "template:purchase_invoices", label: "Purchase invoices", short: "Invoices", icon: FileText, group: "templates", accept: ".csv,.xlsx", blurb: "One row per invoice line, with tax totals." },
  { source: "template:debit_credit_notes", label: "Debit / credit notes", short: "Notes", icon: FileMinus2, group: "templates", accept: ".csv,.xlsx", blurb: "Against the invoice they adjust." },
  { source: "template:payments", label: "Payments", short: "Payments", icon: Wallet, group: "templates", accept: ".csv,.xlsx", blurb: "Payments made, with the invoices each one settles." },
];
export const sourceMeta = (source: string): SourceMeta | undefined => SOURCES.find((s) => s.source === source);
export const sourceLabel = (source: string) =>
  sourceMeta(source)?.label ?? (source === "bank_csv_legacy" ? "Bank CSV (payments page)" : source === "gstr2b_legacy" ? "GSTR-2B (compliance page)" : source);

export const TYPE_LABEL: Record<string, string> = {
  supplier: "Suppliers", item: "Items", PO: "Purchase orders", GRN: "Goods receipts", QC: "Quality checks", INVOICE_IN: "Purchase invoices",
  RETURN: "Returns to supplier", DEBIT_NOTE_OUT: "Debit notes", CREDIT_NOTE_IN: "Credit notes", PAYMENT_OUT: "Payments made",
  PAYMENT_IN: "Money received", GSTR2B_ENTRY: "GSTR-2B entries",
};

export const ACTION_META: Record<string, { label: string; color: string; bg: string; icon: LucideIcon }> = {
  create: { label: "New", color: "var(--confirmed)", bg: "var(--confirmed-soft)", icon: CircleCheck },
  update: { label: "Updated", color: "var(--likely)", bg: "var(--likely-soft)", icon: RefreshCw },
  unchanged: { label: "Already up to date", color: "var(--missing)", bg: "var(--missing-soft)", icon: CircleDashed },
  duplicate: { label: "Already in Satya", color: "var(--missing)", bg: "var(--missing-soft)", icon: CircleDot },
  error: { label: "Needs fixing", color: "var(--sev-critical)", bg: "var(--sev-critical-soft)", icon: CircleX },
  warning: { label: "Check", color: "var(--sev-medium)", bg: "var(--sev-medium-soft)", icon: CircleAlert },
};

export function Pill({ tone, children, icon: Icon }: { tone: keyof typeof ACTION_META | "accent"; children: React.ReactNode; icon?: LucideIcon }) {
  const meta = tone === "accent" ? { color: "var(--accent)", bg: "var(--accent-soft)" } : ACTION_META[tone];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-xs font-medium leading-none"
      style={{ color: meta.color, background: meta.bg, borderColor: `color-mix(in srgb, ${meta.color} 30%, transparent)` }}
    >
      {Icon ? <Icon size={12} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function ActionPill({ action }: { action: string }) {
  const meta = ACTION_META[action] ?? ACTION_META.unchanged;
  return <Pill tone={(action in ACTION_META ? action : "unchanged") as keyof typeof ACTION_META} icon={meta.icon}>{meta.label}</Pill>;
}

/** Big-number tile used in previews and results. */
export function Count({ label, value, tone, hint }: { label: string; value: number | string; tone?: "good" | "warn" | "bad" | "muted"; hint?: string }) {
  const color = tone === "good" ? "var(--confirmed)" : tone === "warn" ? "var(--sev-medium)" : tone === "bad" ? "var(--sev-critical)" : tone === "muted" ? "var(--muted)" : "var(--ink)";
  return (
    <div className="min-w-0 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)]/50 px-4 py-3">
      <p className="text-[13px] text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tnum tracking-tight" style={{ color }}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}

export function Section({ step, title, children, className }: { step?: number; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)] sm:p-6", className)}>
      <h2 className="mb-4 flex items-center gap-2.5 text-base font-semibold tracking-tight text-[var(--ink)]">
        {step ? <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent-strong)]">{step}</span> : null}
        {title}
      </h2>
      {children}
    </section>
  );
}

export const icons = { FileSpreadsheet };

export const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

export const relTime = (iso?: string | null) => {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};
