"use client";

// Compliance (/app/compliance) — docs/plan/06 §5.9. Six statutory checks, each
// backed by live documents: MSME 45-day, GSTR-2B match, Rule 37 ITC reversal,
// TDS decisions, e-invoice & e-way coverage, and LUT validity. Every row has a
// real action — view the document, chase the supplier, or record the answer.
// Satya finds issues; it does not file returns or give tax advice.

import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Mail, Copy, Eye, CircleCheck, TriangleAlert, Info, FileUp,
  MessageSquare, Undo2, Landmark, FileCheck2, BadgeCheck, X, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { v2 } from "@/lib/api/v2";
import { mocksEnabled } from "@/lib/flags";
import { useSession } from "@/components/v2/session";
import {
  Money, DateText, ErrorState, Term, PageHeader, FadeIn, Btn, EmptyState,
} from "@/components/ui/v2";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { daysLeftText } from "@/lib/format";
import { cn } from "@/lib/utils";

const DocPreviewModal = dynamic(
  () => import("@/components/v2/doc-preview").then((m) => m.DocPreviewModal),
  { ssr: false },
);

type MoneyVal = { amount: string; currency: string };

/* ---------- shared bits ---------- */

type SectionKey = "msme" | "gstr2b" | "rule37" | "tds" | "eway" | "lut";

function useSection<S extends SectionKey>(section: S, params: Record<string, string> = {}) {
  return useQuery({
    queryKey: ["compliance", section, params],
    queryFn: () => v2.complianceSection(section, params),
  });
}

/** One plain-English line on the rule + a way to ask the copilot about it. */
function RuleLine({ children, ask }: { children: React.ReactNode; ask: string }) {
  return (
    <p className="mb-4 max-w-3xl text-xs leading-relaxed text-[var(--muted)]">
      {children}{" "}
      <Link href={`/app/ask?about=${encodeURIComponent(ask)}`} className="inline-flex items-center gap-1 font-medium text-[var(--accent)] hover:underline">
        <MessageSquare size={11} aria-hidden="true" /> Ask Satya to explain
      </Link>
    </p>
  );
}

function StatGrid({ items }: { items: { label: string; value: React.ReactNode; warn?: boolean }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item, i) => (
        <div key={i} className={cn(
          "rounded-[var(--radius-sm)] border p-3.5 transition-colors",
          item.warn ? "border-[var(--sev-medium)]/40 bg-[var(--sev-medium-soft)]" : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--ink-2)]/25",
        )}>
          <p className="text-[11px] text-[var(--muted)]">{item.label}</p>
          <p className="tnum mt-1 text-lg font-semibold tracking-tight text-[var(--ink)]">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function Row({ children, tone }: { children: React.ReactNode; tone?: "warn" | "bad" | "good" }) {
  return (
    <li className={cn(
      "flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border px-4 py-3",
      tone === "warn" && "border-[var(--possible)]/40 bg-[var(--possible-soft)]",
      tone === "bad" && "border-[var(--sev-critical)]/40 bg-[var(--sev-critical-soft)]",
      tone === "good" && "border-[var(--confirmed)]/30 bg-[var(--confirmed-soft)]/40",
      !tone && "border-[var(--line)] bg-[var(--surface)]",
    )}>
      {children}
    </li>
  );
}

function ChipLabel({ tone, children }: { tone: "bad" | "warn" | "good" | "muted"; children: React.ReactNode }) {
  const styles = {
    bad: "bg-[var(--sev-critical-soft)] text-[var(--sev-critical)]",
    warn: "bg-[var(--sev-medium-soft)] text-[var(--sev-medium)]",
    good: "bg-[var(--confirmed-soft)] text-[var(--confirmed)]",
    muted: "bg-[var(--surface-2)] text-[var(--ink-2)]",
  } as const;
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", styles[tone])}>{children}</span>;
}

/* ---------- small modal ---------- */

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-label={title}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cn("relative w-full rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--paper)] shadow-[var(--shadow-3)]", wide ? "max-w-2xl" : "max-w-lg")}>
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
          <p className="text-sm font-semibold text-[var(--ink)]">{title}</p>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-[var(--muted)] hover:text-[var(--ink)]"><X size={16} /></button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-[var(--muted)]";

/* ---------- supplier reminder ---------- */

function ReminderModal({ title, subject, body, email, onClose }: { title: string; subject: string; body: string; email?: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal title={title} onClose={onClose} wide>
      <p className="text-xs text-[var(--muted)]">
        {email ? <>Ready to send to <span className="font-medium text-[var(--ink)]">{email}</span> — or copy it and send from your own mail.</> : "No supplier email on record — copy the message and send it your usual way."}
      </p>
      <pre className="mt-3 whitespace-pre-wrap rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] p-3 font-sans text-xs leading-relaxed text-[var(--ink-2)]">{body}</pre>
      <div className="mt-4 flex flex-wrap gap-2">
        <Btn size="sm" variant="secondary" icon={copied ? CircleCheck : Copy} onClick={() => { navigator.clipboard.writeText(body).then(() => { setCopied(true); toast.success("Message copied"); }); }}>
          {copied ? "Copied" : "Copy message"}
        </Btn>
        {email ? (
          <a href={`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>
            <Btn size="sm" icon={Mail}>Open in mail</Btn>
          </a>
        ) : null}
        <Btn size="sm" variant="ghost" onClick={onClose}>Done</Btn>
      </div>
    </Modal>
  );
}

const reminderBody = (kind: string, invoice: string, extra: string) =>
  `Hello,\n\nThis is about invoice ${invoice}. ${extra}\n\nPlease reply with an update so we can keep our records clean.\n\nThank you.`;

/* ---------- generic record-field modal ---------- */

function FieldModal({ title, submitLabel, busy, onSubmit, onClose, children }: {
  title: string; submitLabel: string; busy: boolean;
  onSubmit: () => void; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">{children}</div>
      <div className="mt-5 flex gap-2">
        <Btn size="sm" onClick={onSubmit} disabled={busy} icon={busy ? Loader2 : FileCheck2}>
          {busy ? "Saving…" : submitLabel}
        </Btn>
        <Btn size="sm" variant="ghost" onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}

/* ================================================================
   MSME 45-day
   ================================================================ */

type MsmeRow = {
  documentId: string; invoice: string; date: string; supplier: string; supplierId?: string | null;
  category?: string | null; supplierEmail?: string | null;
  amount: MoneyVal; paidSoFar: MoneyVal; outstanding: MoneyVal; amountRecorded: boolean;
  agreedDays: number; dueDate: string; daysLeft: number; status: "overdue" | "due_soon" | "upcoming"; note: string;
};

function MsmeTab({ onView }: { onView: (id: string) => void }) {
  const { data, isLoading, error, refetch } = useSection("msme");
  const [remind, setRemind] = useState<MsmeRow | null>(null);
  if (error) return <ErrorState message={error instanceof Error ? error.message : "Could not load"} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-72 w-full" />;
  const items = (data.items ?? []) as MsmeRow[];
  const s = data.summary ?? {};

  return (
    <div className="space-y-4">
      <RuleLine ask="MSME 45-day payment rule">
        <Term of="MSME">Micro and small suppliers</Term> must be paid within 45 days of acceptance — late payment costs
        3× the RBI rate in compound interest, and the tax deduction is lost until paid. This list shows only what is still unpaid.
      </RuleLine>
      <StatGrid items={[
        { label: "Unpaid MSME invoices", value: s.open ?? 0 },
        { label: "Already overdue", value: s.overdue ?? 0, warn: (s.overdue ?? 0) > 0 },
        { label: "Due within 7 days", value: s.dueThisWeek ?? 0, warn: (s.dueThisWeek ?? 0) > 0 },
        { label: "Outstanding to MSMEs", value: <Money value={s.outstanding} /> },
      ]} />
      {items.length === 0 ? (
        <EmptyState icon={CircleCheck} title="Nothing unpaid to micro or small suppliers" body="When an unpaid MSME invoice is recorded, its payment deadline will show up here." />
      ) : (
        <ul className="space-y-2.5">
          {items.map((row) => (
            <Row key={row.documentId} tone={row.status === "overdue" ? "bad" : row.status === "due_soon" ? "warn" : undefined}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--ink)]">
                  {row.invoice} · {row.supplier}
                  {row.category ? <span className="ml-2 text-[11px] font-normal uppercase tracking-wide text-[var(--muted)]">{row.category}</span> : null}
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{row.note}{!row.amountRecorded ? " · invoice amount not recorded" : ""}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="tnum text-sm font-semibold text-[var(--ink)]">{row.amountRecorded ? <Money value={row.outstanding} /> : "—"}</p>
                  <p className={cn("text-xs", row.daysLeft <= 7 ? "font-medium text-[var(--sev-medium)]" : row.daysLeft < 0 ? "font-medium text-[var(--sev-critical)]" : "text-[var(--muted)]")}>
                    {daysLeftText(row.daysLeft)} · due <DateText value={row.dueDate} />
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Btn size="sm" variant="ghost" icon={Eye} onClick={() => onView(row.documentId)}>View</Btn>
                  <Btn size="sm" variant="secondary" icon={Mail} onClick={() => setRemind(row)}>Remind</Btn>
                  <Link href="/app/payments"><Btn size="sm" variant="outline" icon={Landmark}>Record payment</Btn></Link>
                </div>
              </div>
            </Row>
          ))}
        </ul>
      )}
      {remind ? (
        <ReminderModal
          title={`Remind ${remind.supplier}`}
          subject={`Payment status — invoice ${remind.invoice}`}
          email={remind.supplierEmail}
          body={reminderBody("msme", remind.invoice, `Our records show it is still unpaid and the 45-day MSMED deadline is ${remind.daysLeft < 0 ? `overdue by ${-remind.daysLeft} days` : `due on ${remind.dueDate}`}. If you have already been paid, please share the payment reference so we can update our records.`)}
          onClose={() => setRemind(null)}
        />
      ) : null}
    </div>
  );
}

/* ================================================================
   GSTR-2B match
   ================================================================ */

type G2bRow = {
  documentId: string; invoice: string; date?: string; supplier: string; supplierEmail?: string | null;
  amount: MoneyVal; tax?: MoneyVal; period?: string | null;
  reportedValue?: MoneyVal; reportedTax?: MoneyVal; difference?: MoneyVal;
};

function Gstr2bTab({ onView }: { onView: (id: string) => void }) {
  const [period, setPeriod] = useState<string>("");
  const { data, isLoading, error, refetch } = useSection("gstr2b", period ? { period } : {});
  const { activeEntity } = useSession();
  const queryClient = useQueryClient();
  const [remind, setRemind] = useState<G2bRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importPeriod, setImportPeriod] = useState("");
  const [importJson, setImportJson] = useState("");
  const [importBusy, setImportBusy] = useState(false);

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Could not load"} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-72 w-full" />;

  const missing = (data.missingIn2B ?? []) as G2bRow[];
  const missingBooks = (data.missingInBooks ?? []) as G2bRow[];
  const mismatched = (data.mismatched ?? []) as G2bRow[];
  const periods = (data.periods ?? []) as string[];

  const runImport = async () => {
    if (mocksEnabled()) { toast.info("Demo data — imports are not saved"); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(importJson); } catch { toast.error("That file is not valid JSON"); return; }
    if (!activeEntity?.id) { toast.error("Pick an entity first"); return; }
    setImportBusy(true);
    try {
      const result = await v2.importGstr2b(activeEntity.id, parsed, importPeriod || undefined);
      toast.success(`Imported ${result.created} entr${result.created === 1 ? "y" : "ies"}${result.deduped ? ` · ${result.deduped} already existed` : ""}`);
      setImportOpen(false); setImportJson("");
      queryClient.invalidateQueries({ queryKey: ["compliance"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally { setImportBusy(false); }
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    setImportJson(await file.text());
  };

  return (
    <div className="space-y-4">
      <RuleLine ask="GSTR-2B matching">
        Your GST credit counts only if the supplier reported the invoice in their return — it then appears in your{" "}
        <Term of="GSTR2B">GSTR-2B</Term>. Import the statement to see what is missing before you claim credit.
      </RuleLine>

      <div className="flex flex-wrap items-center gap-2">
        <Btn size="sm" variant="outline" icon={FileUp} onClick={() => { setImportPeriod(data.period || ""); setImportOpen(true); }}>Import GSTR-2B</Btn>
        {periods.length > 1 ? (
          <select className={cn(inputCls, "w-auto")} value={period || data.period} onChange={(e) => setPeriod(e.target.value)} aria-label="GSTR-2B period">
            {periods.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        ) : null}
        <span className="text-xs text-[var(--muted)]">{data.estimated ? "Showing suspected mismatches" : `Statement period ${data.period}`}</span>
      </div>

      {data.estimated ? (
        <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--likely)]/40 bg-[var(--likely-soft)] px-4 py-3 text-xs leading-relaxed text-[var(--ink-2)]">
          <Info size={14} className="mt-0.5 shrink-0 text-[var(--likely)]" aria-hidden="true" />
          No GSTR-2B file has been imported yet, so this is not a real portal match — the rows below are invoices flagged by open issues.
          Import your GSTR-2B JSON (GST portal → downloads) for an exact comparison.
        </div>
      ) : null}

      <StatGrid items={[
        { label: data.estimated ? "Invoices in books" : "Matched", value: data.matched ?? 0 },
        { label: "Missing in 2B", value: missing.length, warn: missing.length > 0 },
        { label: "Missing in books", value: missingBooks.length, warn: missingBooks.length > 0 },
        { label: "GST credit at risk", value: <Money value={data.itcAtRisk} />, warn: true },
      ]} />

      {missing.length === 0 && missingBooks.length === 0 && mismatched.length === 0 ? (
        <EmptyState icon={CircleCheck} title="Nothing missing" body={data.estimated ? "No open issues point at GSTR-2B mismatches." : "Every books invoice for this period is in your GSTR-2B."} />
      ) : null}

      {missing.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">In your books, not in GSTR-2B — ask the supplier to report</h3>
          <ul className="space-y-2">
            {missing.map((row) => (
              <Row key={row.documentId} tone="warn">
                <p className="text-sm leading-relaxed text-[var(--ink-2)]">
                  <span className="font-medium text-[var(--ink)]">{row.invoice}</span> · {row.supplier} · <Money value={row.amount} /> — not in GSTR-2B for {data.period}; <Money value={row.tax} /> of credit is at risk.
                </p>
                <div className="flex gap-1.5">
                  <Btn size="sm" variant="ghost" icon={Eye} onClick={() => onView(row.documentId)}>View</Btn>
                  <Btn size="sm" variant="secondary" icon={Mail} onClick={() => setRemind(row)}>Remind supplier</Btn>
                </div>
              </Row>
            ))}
          </ul>
        </section>
      )}

      {mismatched.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Reported, but the values differ</h3>
          <ul className="space-y-2">
            {mismatched.map((row) => (
              <Row key={row.documentId} tone="warn">
                <p className="text-sm leading-relaxed text-[var(--ink-2)]">
                  <span className="font-medium text-[var(--ink)]">{row.invoice}</span> · {row.supplier} · books <Money value={row.amount} /> vs 2B <Money value={row.reportedValue} /> — off by <Money value={row.difference} />.
                </p>
                <div className="flex gap-1.5">
                  <Btn size="sm" variant="ghost" icon={Eye} onClick={() => onView(row.documentId)}>View</Btn>
                  <Btn size="sm" variant="secondary" icon={Mail} onClick={() => setRemind(row)}>Ask supplier</Btn>
                </div>
              </Row>
            ))}
          </ul>
        </section>
      )}

      {missingBooks.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">In GSTR-2B, not in your books — record or dispute the invoice</h3>
          <ul className="space-y-2">
            {missingBooks.map((row) => (
              <Row key={row.documentId} tone="bad">
                <p className="text-sm leading-relaxed text-[var(--ink-2)]">
                  <span className="font-medium text-[var(--ink)]">{row.invoice}</span> · {row.supplier} · <Money value={row.amount} /> — reported by the supplier but missing from your records.
                </p>
                <div className="flex gap-1.5">
                  <Btn size="sm" variant="ghost" icon={Eye} onClick={() => onView(row.documentId)}>View</Btn>
                  <Link href="/app/documents"><Btn size="sm" variant="secondary" icon={FileUp}>Upload invoice</Btn></Link>
                </div>
              </Row>
            ))}
          </ul>
        </section>
      )}

      {remind ? (
        <ReminderModal
          title={`Remind ${remind.supplier}`}
          subject={`GSTR-2B — please report invoice ${remind.invoice}`}
          email={remind.supplierEmail}
          body={reminderBody("gstr2b", rowInvoice(remind), `It does not appear in our GSTR-2B for ${data.period}, so we cannot claim the GST credit of ${fmtMoney(remind.tax?.amount)} until you report it in your GSTR-1.`)}
          onClose={() => setRemind(null)}
        />
      ) : null}

      {importOpen ? (
        <Modal title="Import GSTR-2B" onClose={() => setImportOpen(false)} wide>
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-[var(--muted)]">
              Download the GSTR-2B JSON from the GST portal and drop it here — or paste it. Invoices are matched on supplier GSTIN + invoice number, and duplicates are skipped.
            </p>
            <div>
              <label className={labelCls}>Statement period (YYYY-MM)</label>
              <input className={inputCls} placeholder="2026-10" value={importPeriod} onChange={(e) => setImportPeriod(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>GSTR-2B JSON</label>
              <textarea className={cn(inputCls, "h-40 font-mono text-[11px]")} placeholder='{"data":{"doc_det":{"b2b":[…]}}} or {"invoices":[…]}' value={importJson} onChange={(e) => setImportJson(e.target.value)} />
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-[var(--accent)] hover:underline">
              <FileUp size={13} aria-hidden="true" /> Or pick a .json file
              <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <div className="mt-5 flex gap-2">
            <Btn size="sm" onClick={runImport} disabled={importBusy || !importJson.trim()} icon={importBusy ? Loader2 : FileUp}>{importBusy ? "Importing…" : "Import"}</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Btn>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

const rowInvoice = (r: G2bRow) => r.invoice;
const fmtMoney = (v?: string) => (v ? `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "₹0.00");

/* ================================================================
   Rule 37 — 180-day ITC reversal
   ================================================================ */

type Rule37Row = {
  documentId: string; invoice: string; date: string; supplier: string; supplierEmail?: string | null;
  daysWaiting: number; daysToBreach: number; state: "breached" | "approaching" | "reversed";
  itc: MoneyVal; paidSoFar: MoneyVal; outstanding: MoneyVal; interestEstimate?: MoneyVal | null;
  reversedAt?: string | null; reversedBy?: string | null;
};

function Rule37Tab({ onView }: { onView: (id: string) => void }) {
  const { data, isLoading, error, refetch } = useSection("rule37");
  const queryClient = useQueryClient();
  const [remind, setRemind] = useState<Rule37Row | null>(null);
  const mutation = useMutation({
    mutationFn: ({ id, reversed }: { id: string; reversed: boolean }): Promise<{ documentId: string; itcReversed: unknown }> => {
      if (mocksEnabled()) return Promise.resolve({ documentId: id, itcReversed: null });
      return v2.markItcReversed(id, reversed);
    },
    onSuccess: (_r, v) => {
      if (mocksEnabled()) toast.info("Demo data — change is not saved");
      else toast.success(v.reversed ? "Marked as reversed" : "Reversal undone");
      queryClient.invalidateQueries({ queryKey: ["compliance", "rule37"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Could not load"} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-72 w-full" />;
  const items = (data.items ?? []) as Rule37Row[];
  const s = data.summary ?? {};

  return (
    <div className="space-y-4">
      <RuleLine ask="Rule 37 ITC reversal">
        If a supplier invoice (value + tax) stays unpaid 180 days, the GST credit you claimed must be reversed with
        18% interest (CGST Rule 37). Pay before day 180, or reverse the credit in GSTR-3B and mark it here.
      </RuleLine>
      <StatGrid items={[
        { label: "Past 180 days", value: s.breached ?? 0, warn: (s.breached ?? 0) > 0 },
        { label: "Inside 150–180 days", value: s.approaching ?? 0 },
        { label: "ITC to reverse", value: <Money value={s.itcAtRisk} />, warn: (s.breached ?? 0) > 0 },
        { label: "Interest accruing (est.)", value: <Money value={s.interestAccruing} /> },
      ]} />
      {items.length === 0 ? (
        <EmptyState icon={CircleCheck} title="No 180-day risk" body="Invoices that stay unpaid past 150 days will appear here before the credit is at risk." />
      ) : (
        <ul className="space-y-2.5">
          {items.map((row) => (
            <Row key={row.documentId} tone={row.state === "breached" ? "bad" : row.state === "reversed" ? "good" : undefined}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--ink)]">
                  {row.invoice} · {row.supplier}{" "}
                  {row.state === "breached" ? <ChipLabel tone="bad"><TriangleAlert size={11} /> Reverse now</ChipLabel> : null}
                  {row.state === "approaching" ? <ChipLabel tone="warn">{row.daysToBreach} days to pay</ChipLabel> : null}
                  {row.state === "reversed" ? <ChipLabel tone="good"><BadgeCheck size={11} /> Reversed</ChipLabel> : null}
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  Unpaid {row.daysWaiting} days · ITC <Money value={row.itc} /> · outstanding <Money value={row.outstanding} />
                  {row.interestEstimate ? <> · est. interest <Money value={row.interestEstimate} /></> : null}
                  {row.state === "reversed" && row.reversedAt ? <> · reversed <DateText value={row.reversedAt} /></> : null}
                </p>
              </div>
              <div className="flex gap-1.5">
                <Btn size="sm" variant="ghost" icon={Eye} onClick={() => onView(row.documentId)}>View</Btn>
                {row.state !== "reversed" ? (
                  <>
                    <Btn size="sm" variant="secondary" icon={Mail} onClick={() => setRemind(row)}>Remind</Btn>
                    <Link href="/app/payments"><Btn size="sm" variant="outline" icon={Landmark}>Pay</Btn></Link>
                    <Btn size="sm" variant="danger" icon={CircleCheck} disabled={mutation.isPending} onClick={() => mutation.mutate({ id: row.documentId, reversed: true })}>Mark reversed</Btn>
                  </>
                ) : (
                  <Btn size="sm" variant="ghost" icon={Undo2} disabled={mutation.isPending} onClick={() => mutation.mutate({ id: row.documentId, reversed: false })}>Undo</Btn>
                )}
              </div>
            </Row>
          ))}
        </ul>
      )}
      {remind ? (
        <ReminderModal
          title={`Remind ${remind.supplier}`}
          subject={`Payment pending — invoice ${remind.invoice}`}
          email={remind.supplierEmail}
          body={reminderBody("rule37", remind.invoice, `It has been unpaid for ${remind.daysWaiting} days. We are arranging payment — if you have already received it, please share the payment reference.`)}
          onClose={() => setRemind(null)}
        />
      ) : null}
    </div>
  );
}

/* ================================================================
   TDS decisions
   ================================================================ */

type TdsRow = {
  documentId: string; payment: string; date: string; utr?: string | null; supplier: string;
  amount: MoneyVal; status: "check" | "recorded" | "waived";
  section?: string | null; tdsAmount?: MoneyVal; fyPaidToSupplier?: MoneyVal; note: string;
};

const TDS_SECTIONS = [
  { value: "194C", label: "194C — contractor works (1%/2%)", rate: "1" },
  { value: "194J", label: "194J — professional fees (10%)", rate: "10" },
  { value: "194I", label: "194I — rent (10%)", rate: "10" },
  { value: "194Q", label: "194Q — goods over ₹50L/yr (0.1%)", rate: "0.1" },
  { value: "GST-51", label: "GST sec 51 — notified entities (2%)", rate: "2" },
];

function TdsTab({ onView }: { onView: (id: string) => void }) {
  const { data, isLoading, error, refetch } = useSection("tds");
  const queryClient = useQueryClient();
  const [record, setRecord] = useState<TdsRow | null>(null);
  const [waive, setWaive] = useState<TdsRow | null>(null);
  const [section, setSection] = useState(TDS_SECTIONS[0].value);
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: (body: { paymentId: string; action: "record" | "waive"; section?: string; rate?: string; amount?: string; note?: string }): Promise<{ paymentId: string; tdsEntryId?: string }> => {
      if (mocksEnabled()) return Promise.resolve({ paymentId: body.paymentId });
      return v2.tdsDecision(body);
    },
    onSuccess: (_r, v) => {
      if (mocksEnabled()) toast.info("Demo data — change is not saved");
      else toast.success(v.action === "record" ? "TDS entry recorded" : "Marked as not applicable");
      setRecord(null); setWaive(null); setNote("");
      queryClient.invalidateQueries({ queryKey: ["compliance", "tds"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Could not load"} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-72 w-full" />;
  const items = (data.items ?? []) as TdsRow[];
  const s = data.summary ?? {};

  const chosen = TDS_SECTIONS.find((x) => x.value === section) ?? TDS_SECTIONS[0];
  const autoAmount = record ? (Number(record.amount.amount) * Number(chosen.rate) / 100).toFixed(2) : "0.00";

  return (
    <div className="space-y-4">
      <RuleLine ask="TDS on supplier payments">
        On some payments you must deduct <Term of="TDS">TDS</Term> before paying — the rate depends on the payment type
        (contract work 194C, professional fees 194J, goods over ₹50L/year 194Q). Satya flags payments worth a decision;
        your CA makes the call.
      </RuleLine>
      <StatGrid items={[
        { label: "Need a decision", value: s.needsDecision ?? 0, warn: (s.needsDecision ?? 0) > 0 },
        { label: "TDS recorded", value: s.recorded ?? 0 },
        { label: "Marked N/A", value: s.waived ?? 0 },
        { label: "Total deducted", value: <Money value={s.tdsDeducted} /> },
      ]} />

      {items.length === 0 ? (
        <EmptyState icon={CircleCheck} title="No TDS decisions pending" body="Payments that cross the screening bands will appear here." />
      ) : (
        <ul className="space-y-2.5">
          {items.map((row) => (
            <Row key={row.documentId} tone={row.status === "check" ? "warn" : undefined}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--ink)]">
                  {row.supplier} · <Money value={row.amount} /> · <DateText value={row.date} />
                  {row.status === "recorded" ? <ChipLabel tone="good"><BadgeCheck size={11} /> {row.section} · <Money value={row.tdsAmount} /></ChipLabel> : null}
                  {row.status === "waived" ? <ChipLabel tone="muted">N/A</ChipLabel> : null}
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{row.note}{row.utr ? ` · ${row.utr}` : ""}</p>
              </div>
              {row.status === "check" ? (
                <div className="flex gap-1.5">
                  <Btn size="sm" variant="ghost" icon={Eye} onClick={() => onView(row.documentId)}>View</Btn>
                  <Btn size="sm" variant="outline" onClick={() => { setRecord(row); setSection(TDS_SECTIONS[0].value); setNote(""); }}>Record TDS</Btn>
                  <Btn size="sm" variant="secondary" onClick={() => { setWaive(row); setNote(""); }}>Mark N/A</Btn>
                </div>
              ) : (
                <Btn size="sm" variant="ghost" icon={Eye} onClick={() => onView(row.documentId)}>View</Btn>
              )}
            </Row>
          ))}
        </ul>
      )}

      {record ? (
        <FieldModal
          title={`Record TDS — ${record.supplier}`}
          submitLabel="Save TDS entry"
          busy={mutation.isPending}
          onClose={() => setRecord(null)}
          onSubmit={() => mutation.mutate({ paymentId: record.documentId, action: "record", section, rate: chosen.rate, amount: autoAmount, note: note || undefined })}
        >
          <p className="text-xs text-[var(--muted)]">Payment of <Money value={record.amount} /> on <DateText value={record.date} />.</p>
          <div>
            <label className={labelCls}>Section</label>
            <select className={inputCls} value={section} onChange={(e) => setSection(e.target.value)}>
              {TDS_SECTIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>TDS amount ({chosen.rate}% of payment)</label>
            <input className={inputCls} value={autoAmount} readOnly aria-readonly />
          </div>
          <div>
            <label className={labelCls}>Note (optional)</label>
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. deducted against October payment" />
          </div>
        </FieldModal>
      ) : null}

      {waive ? (
        <FieldModal
          title={`Mark N/A — ${waive.supplier}`}
          submitLabel="Mark as not applicable"
          busy={mutation.isPending}
          onClose={() => setWaive(null)}
          onSubmit={() => mutation.mutate({ paymentId: waive.documentId, action: "waive", note: note || undefined })}
        >
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            Saying this payment needs no TDS — e.g. it is below the threshold or the section does not apply. The decision is saved on the payment.
          </p>
          <div>
            <label className={labelCls}>Why not applicable? (optional)</label>
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. goods purchase under 194Q limit" />
          </div>
        </FieldModal>
      ) : null}
    </div>
  );
}

/* ================================================================
   e-invoice & e-way
   ================================================================ */

type EwayRow = {
  documentId: string; invoice: string; date: string; supplier: string; supplierEmail?: string | null;
  amount: MoneyVal; irn?: string | null; ewb?: string | null; reason: string;
};

function EwayTab({ onView }: { onView: (id: string) => void }) {
  const { data, isLoading, error, refetch } = useSection("eway");
  const queryClient = useQueryClient();
  const [remind, setRemind] = useState<{ row: EwayRow; kind: "irn" | "ewb" } | null>(null);
  const [recordIrn, setRecordIrn] = useState<EwayRow | null>(null);
  const [recordEwb, setRecordEwb] = useState<EwayRow | null>(null);
  const [value, setValue] = useState("");

  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }): Promise<{ documentId: string; gst: Record<string, unknown> }> => {
      if (mocksEnabled()) return Promise.resolve({ documentId: id, gst: {} });
      return v2.saveGstMeta(id, body);
    },
    onSuccess: () => {
      if (mocksEnabled()) toast.info("Demo data — change is not saved");
      else toast.success("Saved on the invoice");
      setRecordIrn(null); setRecordEwb(null); setValue("");
      queryClient.invalidateQueries({ queryKey: ["compliance", "eway"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Could not load"} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-72 w-full" />;

  const einv = data.einvoice ?? { withIrn: 0, waived: 0, pct: 0, checks: [] };
  const eway = data.eway ?? { withEwb: 0, waived: 0, goodsInvoices: 0, checks: [] };
  const irnChecks = (einv.checks ?? []) as EwayRow[];
  const ewbChecks = (eway.checks ?? []) as EwayRow[];

  return (
    <div className="space-y-4">
      <RuleLine ask="e-invoice IRN and e-way bill">
        Suppliers above the e-invoice turnover band must register invoices with an <Term of="IRN">IRN</Term> — no IRN can
        put your credit at risk. Goods worth over ₹50,000 moving on the road need an e-way bill number. Record the values here to track coverage.
      </RuleLine>
      <StatGrid items={[
        { label: "Invoices carrying an IRN", value: `${einv.withIrn} (${einv.pct}%)` },
        { label: "IRN checks open", value: irnChecks.length, warn: irnChecks.length > 0 },
        { label: "E-way bills recorded", value: eway.withEwb },
        { label: "E-way checks open", value: ewbChecks.length, warn: ewbChecks.length > 0 },
      ]} />

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">e-invoice — high-value invoices with no IRN recorded</h3>
        {irnChecks.length === 0 ? (
          <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--line)] px-4 py-3 text-xs text-[var(--muted)]">
            Nothing flagged. Every invoice over ₹5 lakh carries an IRN or is marked not applicable.{einv.waived ? ` (${einv.waived} marked N/A)` : ""}
          </p>
        ) : (
          <ul className="space-y-2">
            {irnChecks.map((row) => (
              <Row key={row.documentId} tone="warn">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--ink)]">{row.invoice} · {row.supplier} · <Money value={row.amount} /></p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{row.reason}</p>
                </div>
                <div className="flex gap-1.5">
                  <Btn size="sm" variant="ghost" icon={Eye} onClick={() => onView(row.documentId)}>View</Btn>
                  <Btn size="sm" variant="secondary" icon={Mail} onClick={() => setRemind({ row, kind: "irn" })}>Ask supplier</Btn>
                  <Btn size="sm" variant="outline" onClick={() => { setRecordIrn(row); setValue(""); }}>Record IRN</Btn>
                  <Btn size="sm" variant="ghost" disabled={mutation.isPending} onClick={() => mutation.mutate({ id: row.documentId, body: { irnStatus: "not_applicable" } })}>N/A</Btn>
                </div>
              </Row>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">e-way bill — goods consignments over ₹50,000</h3>
        {ewbChecks.length === 0 ? (
          <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--line)] px-4 py-3 text-xs text-[var(--muted)]">
            Nothing flagged. Every goods invoice over ₹50,000 carries an e-way bill number or is marked not required.{eway.waived ? ` (${eway.waived} marked N/A)` : ""}
          </p>
        ) : (
          <ul className="space-y-2">
            {ewbChecks.map((row) => (
              <Row key={row.documentId} tone="warn">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--ink)]">{row.invoice} · {row.supplier} · <Money value={row.amount} /></p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{row.reason}</p>
                </div>
                <div className="flex gap-1.5">
                  <Btn size="sm" variant="ghost" icon={Eye} onClick={() => onView(row.documentId)}>View</Btn>
                  <Btn size="sm" variant="secondary" icon={Mail} onClick={() => setRemind({ row, kind: "ewb" })}>Ask supplier</Btn>
                  <Btn size="sm" variant="outline" onClick={() => { setRecordEwb(row); setValue(""); }}>Record e-way no.</Btn>
                  <Btn size="sm" variant="ghost" disabled={mutation.isPending} onClick={() => mutation.mutate({ id: row.documentId, body: { ewbStatus: "not_required" } })}>N/A</Btn>
                </div>
              </Row>
            ))}
          </ul>
        )}
      </section>

      {remind ? (
        <ReminderModal
          title={`Ask ${remind.row.supplier}`}
          subject={remind.kind === "irn" ? `e-invoice IRN for ${remind.row.invoice}` : `E-way bill for ${remind.row.invoice}`}
          email={remind.row.supplierEmail}
          body={reminderBody(remind.kind, remind.row.invoice, remind.kind === "irn"
            ? "We could not find an IRN (e-invoice registration number) for it. If your turnover requires e-invoicing, please share the IRN — without it the invoice is not valid for our GST credit."
            : "Please share the 12-digit e-way bill number for this consignment so we can complete our records.")}
          onClose={() => setRemind(null)}
        />
      ) : null}

      {recordIrn ? (
        <FieldModal
          title={`Record IRN — ${recordIrn.invoice}`}
          submitLabel="Save IRN"
          busy={mutation.isPending}
          onClose={() => setRecordIrn(null)}
          onSubmit={() => mutation.mutate({ id: recordIrn.documentId, body: { irn: value } })}
        >
          <div>
            <label className={labelCls}>IRN (64 characters, from the e-invoice QR or JSON)</label>
            <input className={cn(inputCls, "font-mono text-xs")} value={value} onChange={(e) => setValue(e.target.value)} placeholder="64-character IRN" maxLength={64} />
          </div>
        </FieldModal>
      ) : null}

      {recordEwb ? (
        <FieldModal
          title={`Record e-way bill — ${recordEwb.invoice}`}
          submitLabel="Save e-way bill no."
          busy={mutation.isPending}
          onClose={() => setRecordEwb(null)}
          onSubmit={() => mutation.mutate({ id: recordEwb.documentId, body: { ewb: value } })}
        >
          <div>
            <label className={labelCls}>E-way bill number (12 digits)</label>
            <input className={cn(inputCls, "font-mono text-xs")} value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 781234567890" maxLength={12} />
          </div>
        </FieldModal>
      ) : null}
    </div>
  );
}

/* ================================================================
   LUT — Letter of Undertaking
   ================================================================ */

type LutEntry = { arn: string; fy: string; validFrom: string; validTo: string; daysLeft: number; status: "active" | "expiring" | "expired" };
type LutEntity = { entityId: string; code: string; legalName: string; status: "active" | "expiring" | "none"; currentArn?: string | null; validTo?: string | null; luts: LutEntry[] };

function LutTab() {
  const { data, isLoading, error, refetch } = useSection("lut");
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState<LutEntity | null>(null);
  const [form, setForm] = useState({ arn: "", fy: "", validFrom: "", validTo: "" });

  const mutation = useMutation({
    mutationFn: ({ entityId, entry }: { entityId: string; entry: { arn: string; fy: string; validFrom: string; validTo: string } }): Promise<{ entityId: string; lut: unknown[] }> => {
      if (mocksEnabled()) return Promise.resolve({ entityId, lut: [] });
      return v2.saveLut(entityId, entry);
    },
    onSuccess: () => {
      if (mocksEnabled()) toast.info("Demo data — change is not saved");
      else toast.success("LUT saved on the entity");
      setAdding(null); setForm({ arn: "", fy: "", validFrom: "", validTo: "" });
      queryClient.invalidateQueries({ queryKey: ["compliance", "lut"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Could not load"} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-72 w-full" />;

  const entities = (data.entities ?? []) as LutEntity[];
  const exportsRows = (data.exportInvoices ?? []) as { documentId: string; invoice: string; date: string; buyer: string; amount: MoneyVal; covered: boolean }[];
  const s = data.summary ?? {};

  const statusMeta = (status: string) => status === "active"
    ? { tone: "good" as const, label: "LUT active" }
    : status === "expiring"
      ? { tone: "warn" as const, label: "Expiring soon" }
      : { tone: "bad" as const, label: "No valid LUT" };

  return (
    <div className="space-y-4">
      <RuleLine ask="LUT for exports">
        Export or SEZ supplies without charging IGST need a <Term of="LUT">Letter of Undertaking</Term>, filed once per
        financial year (GST RFD-11). Keep a valid ARN on each entity — a lapsed LUT means you must charge IGST.
      </RuleLine>
      <StatGrid items={[
        { label: "Entities", value: s.entities ?? 0 },
        { label: "Covered by a LUT", value: s.covered ?? 0, warn: (s.covered ?? 0) < (s.entities ?? 0) },
        { label: "Export invoices", value: exportsRows.length },
        { label: "Exports without cover", value: s.uncoveredExports ?? 0, warn: (s.uncoveredExports ?? 0) > 0 },
      ]} />

      <ul className="space-y-3">
        {entities.map((ent) => {
          const meta = statusMeta(ent.status);
          return (
            <li key={ent.entityId} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--ink)]">{ent.legalName} <span className="text-xs font-normal text-[var(--muted)]">({ent.code})</span></p>
                  <p className="mt-1 flex items-center gap-2 text-xs">
                    <ChipLabel tone={meta.tone}>{meta.label}</ChipLabel>
                    {ent.currentArn ? <span className="tnum text-[var(--muted)]">ARN {ent.currentArn} · valid to <DateText value={ent.validTo} /></span> : <span className="text-[var(--muted)]">File a LUT before raising zero-rated export invoices.</span>}
                  </p>
                </div>
                <Btn size="sm" variant="outline" onClick={() => { setAdding(ent); setForm({ arn: "", fy: "", validFrom: "", validTo: "" }); }}>
                  {ent.luts.length ? "Renew / add LUT" : "Add LUT"}
                </Btn>
              </div>
              {ent.luts.length > 0 ? (
                <ul className="mt-3 space-y-1.5 border-t border-[var(--line)] pt-3">
                  {ent.luts.map((lut) => (
                    <li key={lut.arn} className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ink-2)]">
                      <span className="tnum font-medium text-[var(--ink)]">{lut.arn}</span>
                      <span>FY {lut.fy} · <DateText value={lut.validFrom} /> → <DateText value={lut.validTo} /></span>
                      <ChipLabel tone={statusMeta(lut.status).tone}>{lut.status === "expired" ? "Expired" : lut.status === "expiring" ? `${lut.daysLeft} days left` : "Active"}</ChipLabel>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>

      {exportsRows.length > 0 ? (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Zero-rated outward supplies</h3>
          <ul className="space-y-2">
            {exportsRows.map((row) => (
              <Row key={row.documentId} tone={row.covered ? undefined : "bad"}>
                <p className="text-sm text-[var(--ink-2)]"><span className="font-medium text-[var(--ink)]">{row.invoice}</span> · {row.buyer} · <Money value={row.amount} /> · <DateText value={row.date} />{row.covered ? "" : " — no LUT covers this date"}</p>
              </Row>
            ))}
          </ul>
        </section>
      ) : null}

      {adding ? (
        <FieldModal
          title={`Add LUT — ${adding.legalName}`}
          submitLabel="Save LUT"
          busy={mutation.isPending}
          onClose={() => setAdding(null)}
          onSubmit={() => mutation.mutate({ entityId: adding.entityId, entry: form })}
        >
          <div>
            <label className={labelCls}>LUT ARN (from the GST portal acknowledgement)</label>
            <input className={cn(inputCls, "font-mono text-xs")} value={form.arn} onChange={(e) => setForm({ ...form, arn: e.target.value.toUpperCase() })} placeholder="e.g. AD270426000123F" />
          </div>
          <div>
            <label className={labelCls}>Financial year</label>
            <input className={inputCls} value={form.fy} onChange={(e) => setForm({ ...form, fy: e.target.value })} placeholder="2026-27" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Valid from</label>
              <input className={inputCls} type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Valid to</label>
              <input className={inputCls} type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} />
            </div>
          </div>
        </FieldModal>
      ) : null}
    </div>
  );
}

/* ================================================================
   Page
   ================================================================ */

export default function CompliancePage() {
  const [previewDoc, setPreviewDoc] = useState<string | null>(null);
  const onView = useMemo(() => (id: string) => setPreviewDoc(id), []);

  return (
    <FadeIn className="space-y-5">
      <PageHeader
        title="Compliance"
        description="Six statutory checks against your recorded documents — Satya finds issues and tracks what you did about them; it does not file returns or give tax advice."
      />

      <Tabs defaultValue="msme">
        <TabsList className="flex-wrap">
          <TabsTrigger value="msme"><Term of="MSME">MSME</Term> 45-day</TabsTrigger>
          <TabsTrigger value="gstr2b"><Term of="GSTR2B">GSTR-2B</Term> match</TabsTrigger>
          <TabsTrigger value="rule37">Rule 37</TabsTrigger>
          <TabsTrigger value="tds"><Term of="TDS">TDS</Term></TabsTrigger>
          <TabsTrigger value="eway">e-invoice & e-way</TabsTrigger>
          <TabsTrigger value="lut"><Term of="LUT">LUT</Term></TabsTrigger>
        </TabsList>

        <TabsContent value="msme" className="mt-5"><MsmeTab onView={onView} /></TabsContent>
        <TabsContent value="gstr2b" className="mt-5"><Gstr2bTab onView={onView} /></TabsContent>
        <TabsContent value="rule37" className="mt-5"><Rule37Tab onView={onView} /></TabsContent>
        <TabsContent value="tds" className="mt-5"><TdsTab onView={onView} /></TabsContent>
        <TabsContent value="eway" className="mt-5"><EwayTab onView={onView} /></TabsContent>
        <TabsContent value="lut" className="mt-5"><LutTab /></TabsContent>
      </Tabs>

      {previewDoc ? <DocPreviewModal documentId={previewDoc} onClose={() => setPreviewDoc(null)} /> : null}
    </FadeIn>
  );
}
