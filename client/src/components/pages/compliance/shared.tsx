"use client";

// Shared plumbing for the Compliance page: section queries, the small
// modals every check uses (reminder, record-a-value), CSV export (formula-
// injection safe via lib/api/v2-pages), bulk reminders through the supplier
// outbox, statutory dates, and the toolbar that sits above each table.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, Copy, CircleCheck, FileCheck2, Loader2, X, Search, Download, Send } from "lucide-react";
import { toast } from "sonner";
import { v2 } from "@/lib/api/v2";
import { workflow } from "@/lib/api/workflow";
import { downloadCsv } from "@/lib/api/v2-pages";
import { mocksEnabled } from "@/lib/flags";
import { useSession } from "@/components/v2/session";
import { Btn } from "@/components/ui/v2";
import { LinkBtn } from "@/components/pages/shared/link-btn";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { isoDateIst } from "@/lib/format";
import { plural } from "@/lib/humanize";
import { cn } from "@/lib/utils";

export type MoneyVal = { amount: string; currency: string };
export type SectionKey = "msme" | "gstr2b" | "rule37" | "tds" | "eway" | "lut";

/** Entity-scoped sections send the active entity; LUT lists every entity. */
export function useSection(section: SectionKey, params: Record<string, string> = {}) {
  const { activeEntity } = useSession();
  const entityId = section === "lut" ? "" : activeEntity?.id ?? "";
  const merged = entityId ? { ...params, entityId } : params;
  return useQuery({
    queryKey: ["compliance", section, entityId, params],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryFn: () => v2.complianceSection(section, merged) as Promise<any>,
  });
}

/* ---------------- statutory dates ---------------- */

const pad = (n: number) => String(n).padStart(2, "0");

/** The given day of the month after `yyyymm` ("2026-10" → "2026-11-20"). */
export function dayOfNextMonth(yyyymm: string, day: number): string {
  const [y, m] = yyyymm.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${pad(nm)}-${pad(day)}`;
}

/** Next monthly GSTR-3B due date (20th, monthly filers) on or after today. */
export function nextGstr3bDue(today = isoDateIst()): string {
  const thisMonth = `${today.slice(0, 7)}-20`;
  return today <= thisMonth ? thisMonth : dayOfNextMonth(today.slice(0, 7), 20);
}

/** Next TDS deposit date (7th of the following month; April 30 for March). */
export function nextTdsDeposit(today = isoDateIst()): string {
  const [y, m, d] = today.split("-").map(Number);
  if (m === 4) return `${y}-04-30`;
  if (d <= 7) return `${y}-${pad(m)}-07`;
  if (m === 3) return `${y}-04-30`;
  return dayOfNextMonth(today.slice(0, 7), 7);
}

/* ---------------- modals ---------------- */

/** Radix dialog: Escape closes, focus is trapped and returned on close. */
export function Modal({ title, description, onClose, children, wide }: { title: string; description?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn("gap-0 overflow-hidden rounded-[var(--radius-lg)] border-[var(--line)] bg-[var(--surface)] p-0 text-[var(--ink)] shadow-[var(--shadow-3)]", wide ? "sm:max-w-2xl" : "sm:max-w-lg")}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-6 py-4">
          <DialogTitle className="text-[17px] font-semibold text-[var(--ink)]">{title}</DialogTitle>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {description ? <DialogDescription className="sr-only">{description}</DialogDescription> : null}
        <div className="max-h-[80vh] overflow-y-auto px-6 py-5">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

export const inputCls =
  "block h-11 w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3.5 text-[15px] text-[var(--ink)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-3 focus:ring-[var(--accent-glow)]";
export const labelCls = "mb-1.5 block text-[14px] font-medium text-[var(--ink)]";
export const hintCls = "mt-1.5 text-[13px] leading-relaxed text-[var(--muted)]";

/** Record-a-value modal with one primary "save" and a cancel. */
export function FieldModal({ title, submitLabel, busy, onSubmit, onClose, children, danger }: {
  title: string; submitLabel: string; busy: boolean; danger?: boolean;
  onSubmit: () => void; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        className="space-y-4"
      >
        {children}
        <div className="flex flex-wrap gap-2 pt-1">
          <Btn type="submit" variant={danger ? "danger" : "primary"} disabled={busy} icon={busy ? Loader2 : FileCheck2}>
            {busy ? "Saving…" : submitLabel}
          </Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </form>
    </Modal>
  );
}

export const reminderBody = (invoice: string, extra: string) =>
  `Hello,\n\nThis is about invoice ${invoice}. ${extra}\n\nPlease reply with an update so we can keep our records clean.\n\nThank you.`;

/** A single supplier message: copy it, or open it in the mail app. */
export function ReminderModal({ title, subject, body, email, onClose }: { title: string; subject: string; body: string; email?: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal title={title} onClose={onClose} wide>
      <p className="text-[15px] text-[var(--muted)]">
        {email ? <>Ready to send to <span className="font-medium text-[var(--ink)]">{email}</span> — or copy it and send from your own mail.</> : "No supplier email on record — copy the message and send it your usual way."}
      </p>
      <pre className="mt-3 whitespace-pre-wrap rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] p-4 font-sans text-[14px] leading-relaxed text-[var(--ink-2)]">{body}</pre>
      <div className="mt-5 flex flex-wrap gap-2">
        {email ? (
          <LinkBtn href={`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`} variant="primary" size="md" icon={Mail}>Open in mail</LinkBtn>
        ) : null}
        <Btn variant="secondary" icon={copied ? CircleCheck : Copy} onClick={() => { navigator.clipboard.writeText(body).then(() => { setCopied(true); toast.success("Message copied"); }).catch(() => toast.error("Couldn’t copy — select the text instead")); }}>
          {copied ? "Copied" : "Copy message"}
        </Btn>
        <Btn variant="ghost" onClick={onClose}>Done</Btn>
      </div>
    </Modal>
  );
}

/* ---------------- bulk reminders ---------------- */

export type ReminderDraft = { key: string; invoice: string; supplier: string; supplierId?: string | null; caseId?: string | null; email?: string | null; subject: string; body: string };

/** Confirms, then queues one email per selected bill through the supplier
 *  outbox (POST /api/v2/workflow/outbox). Bills without an email on record
 *  are skipped and listed. Idempotent per bill per day. */
export function BulkReminderDialog({ drafts, onClose, onDone }: { drafts: ReminderDraft[]; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const sendable = drafts.filter((d) => d.email);
  const skipped = drafts.filter((d) => !d.email);
  const run = async () => {
    if (mocksEnabled()) { toast.info("Demo data — reminders are not sent"); onDone(); return; }
    setBusy(true);
    const day = isoDateIst();
    const results = await Promise.allSettled(sendable.map((d) => workflow.send({
      channel: "email", to: d.email as string, subject: d.subject, body: d.body,
      supplierId: d.supplierId ?? undefined, caseId: d.caseId ?? undefined, idempotencyKey: `compliance:${d.key}:${day}`,
    })));
    setBusy(false);
    const ok = results.filter((r) => r.status === "fulfilled");
    const sent = ok.filter((r) => (r as PromiseFulfilledResult<{ status: string }>).value.status === "sent").length;
    const queued = ok.length - sent;
    const failed = results.length - ok.length;
    if (ok.length) {
      toast.success(
        [sent ? `${plural(sent, "reminder")} sent` : null, queued ? `${plural(queued, "reminder")} saved to the outbox` : null].filter(Boolean).join(" · "),
        { description: skipped.length ? `${plural(skipped.length, "bill")} skipped — no supplier email on record.` : undefined },
      );
    }
    if (failed) {
      const reason = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      toast.error(`${plural(failed, "reminder")} couldn’t be sent`, { description: reason?.reason instanceof Error ? reason.reason.message : undefined });
    }
    onDone();
  };
  return (
    <Modal title={`Send ${plural(sendable.length, "reminder")}`} onClose={onClose}>
      <p className="text-[15px] leading-relaxed text-[var(--ink-2)]">
        Each supplier gets a short email about their bill from your workspace outbox. If email sending isn’t set up yet, the messages wait in the outbox and you’ll see that here.
      </p>
      {sendable.length ? (
        <ul className="mt-4 max-h-56 divide-y divide-[var(--line)] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--line)]">
          {sendable.map((d) => (
            <li key={d.key} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[14px]">
              <span className="min-w-0">
                <span className="block truncate text-[var(--ink)]">{d.supplier}</span>
                <span className="block truncate font-code text-[13px] text-[var(--muted)]">{d.invoice}</span>
              </span>
              <span className="shrink-0 truncate text-[13px] text-[var(--muted)]">{d.email}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {skipped.length ? (
        <p className="mt-3 text-[14px] text-[var(--muted)]">
          {plural(skipped.length, "bill")} will be skipped — no supplier email on record ({skipped.map((s) => s.invoice).slice(0, 3).join(", ")}{skipped.length > 3 ? "…" : ""}).
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-2">
        <Btn icon={busy ? Loader2 : Send} onClick={run} disabled={busy || !sendable.length}>
          {busy ? "Sending…" : `Send ${plural(sendable.length, "reminder")}`}
        </Btn>
        <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
      </div>
    </Modal>
  );
}

/* ---------------- toolbar ---------------- */

/** Above each table: filter chips (left), search + export (right); when rows
 *  are selected, a bulk bar replaces the right side. */
export function TableToolbar({
  filters,
  search,
  onSearch,
  searchLabel = "Search invoice or supplier",
  onExport,
  selectedCount = 0,
  bulk,
  onClearSelection,
}: {
  filters?: React.ReactNode;
  search?: string;
  onSearch?: (value: string) => void;
  searchLabel?: string;
  onExport?: () => void;
  selectedCount?: number;
  bulk?: React.ReactNode;
  onClearSelection?: () => void;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">{filters}</div>
      {selectedCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[var(--accent-soft)] px-3 py-1.5" role="region" aria-label="Bulk actions">
          <span className="tnum text-[14px] font-medium text-[var(--accent-strong)]">{selectedCount} selected</span>
          {bulk}
          <Btn size="sm" variant="ghost" onClick={onClearSelection}>Clear</Btn>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {onSearch ? (
            <label className="relative block w-full lg:w-64">
              <span className="sr-only">{searchLabel}</span>
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
              <input
                type="search"
                value={search ?? ""}
                onChange={(e) => onSearch(e.target.value)}
                placeholder={searchLabel}
                className={cn(inputCls, "h-10 pl-9")}
              />
            </label>
          ) : null}
          {onExport ? (
            <Btn size="md" variant="secondary" icon={Download} onClick={onExport} className="shrink-0">
              <span className="hidden sm:inline">Export CSV</span>
              <span className="sm:hidden">CSV</span>
            </Btn>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Case-insensitive match on any of the given fields. */
export const matches = (q: string, ...fields: (string | null | undefined)[]) => {
  const needle = q.trim().toLowerCase();
  return !needle || fields.some((f) => String(f ?? "").toLowerCase().includes(needle));
};

/** CSV download; cells are guarded against spreadsheet formula injection. */
export function exportCsv(name: string, headers: string[], rows: unknown[][]) {
  downloadCsv(`${name}-${isoDateIst()}.csv`, headers, rows);
  toast.success(`Exported ${plural(rows.length, "row")}`);
}

/** Money value → plain decimal for CSV ("12345.00"). */
export const csvMoney = (v: MoneyVal | string | null | undefined) => (v == null ? "" : typeof v === "string" ? v : v.amount);
