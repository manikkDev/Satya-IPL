"use client";

// Payments (/app/payments) — allocation workbench per 06 §5.9.
// Real mode: live rows from GET /api/v2/payments (search + status + sort +
// numbered paging server-side). "Resolve" opens a slide-in drawer: engine
// subset-sum suggestions → pick one or choose invoices by hand → reason →
// POST /payments/:id/allocate (writes splits, SETTLES links, decision,
// audit entry, re-reconcile). Bank CSV → column-mapped /import/bank-csv.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  UploadCloud, X, CheckCircle2, FileUp, Search, ChevronLeft, ChevronRight,
  ArrowDownUp, Wallet, Landmark, Loader2, Sparkles, Hand, CircleAlert,
} from "lucide-react";
import { v2 } from "@/lib/api/v2";
import { mocksEnabled } from "@/lib/flags";
import { useSession } from "@/components/v2/session";
import { Money, DateText, CertaintyBadge, ErrorState, PageHeader, FadeIn, Card, Btn } from "@/components/ui/v2";
import type { Certainty } from "@/content/copy/vocabulary";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/* ---------- row normalization — mock + live shapes ---------- */
type Row = {
  id: string; amount?: string | { amount: string; currency: string }; utr?: string; date?: string;
  counterparty?: string; supplier?: string; status?: string; allocatedTotal?: string; mode?: string;
};
const amt = (r: Row): string => (typeof r.amount === "string" ? r.amount : r.amount?.amount ?? "");
const who = (r: Row): string => r.counterparty || r.supplier || "Counterparty";

const STATUS_META: Record<string, { label: string; classes: string }> = {
  allocated: { label: "Fully allocated", classes: "bg-[var(--confirmed-soft)] text-[var(--confirmed)]" },
  partial: { label: "Part allocated", classes: "bg-[var(--likely-soft)] text-[var(--likely)]" },
  unallocated: { label: "Not allocated", classes: "bg-[var(--possible-soft)] text-[var(--possible)]" },
  needs_evidence: { label: "Needs evidence", classes: "bg-[var(--missing-soft)] text-[var(--missing)]" },
  unclear: { label: "Needs your call", classes: "bg-[var(--unclear-soft)] text-[var(--unclear)]" },
  linked: { label: "Linked", classes: "bg-[var(--confirmed-soft)] text-[var(--confirmed)]" },
  not_linked: { label: "Not linked", classes: "bg-[var(--missing-soft)] text-[var(--missing)]" },
};
const STATUS_FILTERS = [
  ["", "All"], ["needs_evidence", "Needs evidence"], ["unallocated", "Not allocated"],
  ["partial", "Part allocated"], ["allocated", "Fully allocated"],
];
const OPEN_STATUSES = new Set(["unallocated", "partial", "needs_evidence", "unclear", "not_linked"]);

const SORTS = [["date_desc", "Newest first"], ["date_asc", "Oldest first"], ["amount_desc", "Largest first"], ["amount_asc", "Smallest first"]];

const LOAD_STAGES = ["Reading the payment…", "Finding open invoices…", "Asking the engine for exact matches…"];

/* ---------- staged loader — replaces the bare pulsing rectangle ---------- */
function StagedLoader() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStage((s) => Math.min(s + 1, LOAD_STAGES.length - 1)), 900);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="relative">
        <motion.div
          className="absolute inset-0 rounded-full bg-[var(--accent)]/20"
          animate={{ scale: [1, 1.6, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="relative grid h-14 w-14 place-items-center rounded-full bg-[var(--accent-soft)]">
          <Loader2 size={22} className="animate-spin text-[var(--accent)]" />
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.p
          key={stage}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25 }}
          className="mt-5 text-sm font-medium text-[var(--ink-2)]"
        >
          {LOAD_STAGES[stage]}
        </motion.p>
      </AnimatePresence>
      <p className="mt-1 text-xs text-[var(--muted)]">Nothing is guessed — only exact sums come back.</p>
    </div>
  );
}

/* ---------- workbench drawer ---------- */
function Drawer({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["pay-wb", paymentId], queryFn: () => v2.paymentWorkbench(paymentId) });
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [manual, setManual] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [fail, setFail] = useState<string | null>(null);

  const wb = (data ?? {}) as Record<string, unknown>;
  const payment = (wb.payment ?? {}) as { id?: string; amount?: string; remaining?: string; utr?: string; date?: string };
  const remaining = payment.remaining ?? payment.amount ?? "0";
  const remainingNum = Number(remaining || 0);
  const openInvoices = ((wb.openInvoices ?? []) as { id: string; number?: string; date?: string; openAmount: string; seller?: string; dueDate?: string }[]);
  const credits = ((wb.credits ?? []) as { id: string; amount: string; date?: string }[]);
  const suggestion = wb.suggestion as { solutions?: { allocations: { documentId: string; amount: { amount: string } }[]; residual?: { amount: string } }[]; unique?: boolean; certainty?: string } | null;
  const solutions = suggestion?.solutions ?? [];
  const pickedIds = useMemo(() => new Set(Object.keys(picked)), [picked]);
  const chosenTotal = Object.values(picked).reduce((s, v) => s + (Number(v) || 0), 0);
  const canAllocate = chosenTotal > 0.005 && chosenTotal <= remainingNum + 0.005 && reason.trim().length >= 5 && !busy;
  const disabler = chosenTotal <= 0.005 ? "Pick an option or tick at least one invoice"
    : chosenTotal > remainingNum + 0.005 ? "The picks add up to more than the payment"
    : reason.trim().length < 5 ? "Say why — a few words, e.g. “paid after delivery”"
    : null;

  const allocate = async () => {
    setBusy(true); setFail(null);
    try {
      await v2.allocatePayment(paymentId, {
        allocations: Object.entries(picked).filter(([, a]) => Number(a) > 0).map(([documentId, amount]) => ({ documentId, amount: Number(amount).toFixed(2) })),
        reason,
      });
      await queryClient.invalidateQueries({ queryKey: ["payments"] });
      setDone(true);
      setTimeout(onClose, 1600);
    } catch (e) {
      setFail(e instanceof Error ? e.message : "Allocation failed — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="fixed inset-0 z-50" role="dialog" aria-label="Allocate payment" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <motion.aside
        className="absolute inset-y-0 right-0 flex w-full max-w-5xl flex-col border-l border-[var(--line)] bg-[var(--paper)] shadow-[var(--shadow-3)]"
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 340, damping: 34 }}
      >
        {/* header */}
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-6 py-4">
          <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--accent)]"><Wallet size={17} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-[var(--ink)]">Link this payment to invoices</h2>
            <p className="text-xs text-[var(--muted)]">Nothing changes until you press Allocate.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-[var(--radius-sm)] p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {isLoading ? <StagedLoader /> : error ? (
            <ErrorState message={error instanceof Error ? error.message : "Could not load the workbench."} onRetry={() => refetch()} />
          ) : done ? (
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center justify-center py-24 text-center">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 16, delay: 0.1 }}>
                <span className="grid h-16 w-16 place-items-center rounded-full bg-[var(--confirmed-soft)]"><CheckCircle2 size={30} className="text-[var(--confirmed)]" /></span>
              </motion.div>
              <p className="mt-5 text-base font-semibold text-[var(--ink)]">Allocated</p>
              <p className="mt-1 text-sm text-[var(--muted)]">Reconciliation is running — findings update on their own.</p>
            </motion.div>
          ) : (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid gap-5 lg:grid-cols-[280px_1fr]">
              {/* left rail — payment summary + stats */}
              <div className="space-y-4">
                <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">The payment</p>
                  <p className="tnum mt-2 text-3xl font-semibold tracking-tight text-[var(--ink)]"><Money value={remaining} /></p>
                  <dl className="mt-3 space-y-1.5 text-xs">
                    <div className="flex justify-between"><dt className="text-[var(--muted)]">Date</dt><dd className="text-[var(--ink)]">{payment.date ? <DateText value={payment.date} /> : "—"}</dd></div>
                    <div className="flex justify-between"><dt className="text-[var(--muted)]">Bank ref</dt><dd className="font-code text-[var(--ink)]">{payment.utr || "none"}</dd></div>
                    <div className="flex justify-between"><dt className="text-[var(--muted)]">Payment ID</dt><dd className="max-w-36 truncate font-code text-[var(--ink)]">{payment.id}</dd></div>
                  </dl>
                  <p className="mt-3 border-t border-[var(--line)] pt-3 text-xs leading-relaxed text-[var(--ink-2)]">
                    {payment.utr
                      ? "This transfer isn't tied to any invoice yet. Tell Satya which invoices it settled."
                      : "No bank reference yet — you can still record which invoices it was for."}
                  </p>
                </div>

                {/* stats */}
                <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-1">
                  {[
                    { label: "Open invoices", value: String(openInvoices.length), note: "in this entity" },
                    { label: "Open value", value: `₹${openInvoices.reduce((s, i) => s + Number(i.openAmount || 0), 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, note: "unpaid supplier bills" },
                    { label: "Picked", value: String(Object.keys(picked).length), note: "invoices selected" },
                    { label: "Coverage", value: `${remainingNum ? Math.min(100, Math.round((chosenTotal / remainingNum) * 100)) : 0}%`, note: "of the payment" },
                  ].map((s) => (
                    <div key={s.label} className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] p-3">
                      <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{s.label}</p>
                      <p className="tnum mt-1 text-lg font-semibold tracking-tight text-[var(--ink)]">{s.value}</p>
                      <p className="text-[10px] text-[var(--muted)]">{s.note}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* right — options + manual */}
              <div className="space-y-4">
              {/* step 2 — engine options */}
              {solutions.length > 0 && (
                <div>
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
                    <Sparkles size={12} className="text-[var(--accent)]" />
                    {suggestion?.unique ? "Exact match found" : `${solutions.length} possible splits`}
                  </p>
                  <div className="mt-2 space-y-2">
                    {solutions.map((sol, i) => (
                      <button key={i} type="button"
                        onClick={() => { const next: Record<string, string> = {}; for (const a of sol.allocations) next[a.documentId] = a.amount.amount; setPicked(next); }}
                        className={cn("w-full rounded-[var(--radius-md)] border p-3.5 text-left transition-all",
                          sol.allocations.every((a) => a.documentId in picked && picked[a.documentId] === a.amount.amount)
                            ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[var(--shadow-1)]"
                            : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--accent)]/50")}>
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-[var(--ink)]">Option {String.fromCharCode(65 + i)}</p>
                          {suggestion?.certainty && <CertaintyBadge certainty={suggestion.certainty as Certainty} short />}
                        </div>
                        <ul className="mt-2 space-y-1">
                          {sol.allocations.map((a) => (
                            <li key={a.documentId} className="flex items-baseline justify-between text-xs text-[var(--ink-2)]">
                              <span className="font-code">{openInvoices.find((o) => o.id === a.documentId)?.number || a.documentId}</span>
                              <Money value={a.amount.amount} />
                            </li>
                          ))}
                          {Number(sol.residual?.amount || 0) > 0.005 && (
                            <li className="flex items-baseline justify-between text-xs text-[var(--muted)]"><span>Left over</span><Money value={sol.residual!.amount} /></li>
                          )}
                        </ul>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {suggestion && solutions.length === 0 && (
                <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--possible)]/40 bg-[var(--possible-soft)] p-3.5">
                  <CircleAlert size={15} className="mt-0.5 shrink-0 text-[var(--possible)]" />
                  <p className="text-xs leading-relaxed text-[var(--possible)]">
                    No combination of open invoices sums to exactly <Money value={remaining} className="font-semibold" />. Tick invoices yourself below — part allocations are fine.
                  </p>
                </div>
              )}

              {/* manual picker — collapsible */}
              <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)]">
                <button type="button" onClick={() => setManual((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
                  <span className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]"><Hand size={13} className="text-[var(--accent)]" /> Choose by hand</span>
                  <ChevronRight size={14} className={cn("text-[var(--muted)] transition-transform", manual && "rotate-90")} />
                </button>
                {manual && (
                  <div className="border-t border-[var(--line)]">
                    {openInvoices.length === 0 && <p className="px-4 py-6 text-center text-xs text-[var(--muted)]">No open invoices in this entity.</p>}
                    {openInvoices.map((inv) => (
                      <label key={inv.id} className="flex cursor-pointer items-center gap-3 border-b border-[var(--line)] px-4 py-2.5 last:border-0 transition-colors hover:bg-[var(--surface-2)]/50">
                        <input type="checkbox" className="accent-[var(--accent)]" checked={pickedIds.has(inv.id)}
                          onChange={(e) => setPicked((prev) => { const next = { ...prev }; if (e.target.checked) next[inv.id] = inv.openAmount; else delete next[inv.id]; return next; })} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-code text-xs text-[var(--ink)]">{inv.number || inv.id}</span>
                          <span className="block text-[11px] text-[var(--muted)]">{inv.seller || ""}{inv.date ? ` · ${inv.date}` : ""}</span>
                        </span>
                        <span className="text-xs text-[var(--muted)]"><Money value={inv.openAmount} /></span>
                        <input inputMode="decimal" value={picked[inv.id] ?? ""} disabled={!pickedIds.has(inv.id)} placeholder="0.00"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setPicked((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                          className="h-8 w-24 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--paper)] px-2 text-right text-xs tnum outline-none focus:border-[var(--accent)] disabled:opacity-40" />
                      </label>
                    ))}
                    {credits.map((c) => (
                      <label key={c.id} className="flex cursor-pointer items-center gap-3 border-b border-[var(--line)] px-4 py-2.5 last:border-0 transition-colors hover:bg-[var(--surface-2)]/50">
                        <input type="checkbox" className="accent-[var(--accent)]" checked={pickedIds.has(c.id)}
                          onChange={(e) => setPicked((prev) => { const next = { ...prev }; if (e.target.checked) next[c.id] = c.amount; else delete next[c.id]; return next; })} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-code text-xs text-[var(--ink)]">{c.id}</span>
                          <span className="block text-[11px] text-[var(--accent)]">Credit note{c.date ? ` · ${c.date}` : ""}</span>
                        </span>
                        <span className="text-xs text-[var(--muted)]"><Money value={c.amount} /></span>
                        <input inputMode="decimal" value={picked[c.id] ?? ""} disabled={!pickedIds.has(c.id)} placeholder="0.00"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setPicked((prev) => ({ ...prev, [c.id]: e.target.value }))}
                          className="h-8 w-24 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--paper)] px-2 text-right text-xs tnum outline-none focus:border-[var(--accent)] disabled:opacity-40" />
                      </label>
                    ))}
                  </div>
                )}
              </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* footer — total + reason + action, always visible */}
        {!isLoading && !error && !done && (
          <div className="border-t border-[var(--line)] bg-[var(--surface)] px-5 py-4">
            <div className="flex items-baseline justify-between">
              <p className="text-xs text-[var(--muted)]">Covering <span className="tnum font-semibold text-[var(--ink)]">₹{chosenTotal.toFixed(2)}</span> of <span className="tnum">₹{remainingNum.toFixed(2)}</span></p>
              {chosenTotal > remainingNum + 0.005 && <p className="text-xs font-medium text-[var(--sev-critical)]">over the payment</p>}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
              <motion.div className={cn("h-full rounded-full", chosenTotal > remainingNum + 0.005 ? "bg-[var(--sev-critical)]" : "bg-[var(--accent)]")}
                animate={{ width: `${Math.min(100, remainingNum ? (chosenTotal / remainingNum) * 100 : 0)}%` }} transition={{ duration: 0.3 }} />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this split? e.g. paid after delivery" aria-label="Allocation reason"
                className="h-9 flex-1 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--paper)] px-3 text-sm outline-none transition-colors focus:border-[var(--accent)]" />
              <Btn disabled={!canAllocate} onClick={allocate} title={disabler ?? "Record the allocation"}>
                {busy ? "Allocating…" : "Allocate"}
              </Btn>
            </div>
            {disabler && !fail && <p className="mt-2 text-[11px] text-[var(--muted)]">{disabler}</p>}
            {fail && <p className="mt-2 text-xs font-medium text-[var(--sev-critical)]">{fail}</p>}
          </div>
        )}
      </motion.aside>
    </motion.div>
  );
}

/* ---------- bank CSV import ---------- */
function ImportCsv({ entityId, onDone }: { entityId: string; onDone: () => void }) {
  const [stage, setStage] = useState<"pick" | "map" | "result">("pick");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({ date: "", utr: "", amount: "", payeeName: "", mode: "" });
  const [result, setResult] = useState<{ created: number; deduped: number; errors: number } | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const guess = (h: string[], want: string) => h.find((x) => x.toLowerCase().includes(want)) ?? "";

  const parseFile = async (file: File) => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const heads = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    const data = lines.slice(1).map((line) => {
      const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      return Object.fromEntries(heads.map((h, i) => [h, cells[i] ?? ""]));
    });
    setHeaders(heads); setRows(data);
    setMapping({ date: guess(heads, "date") || heads[0], utr: guess(heads, "utr") || guess(heads, "ref"), amount: guess(heads, "amount") || guess(heads, "debit"), payeeName: guess(heads, "payee") || guess(heads, "name") || guess(heads, "narr"), mode: guess(heads, "mode") });
    setStage("map");
  };

  const submit = async () => {
    setFail(null);
    try {
      const r = await v2.importBankCsv(entityId, mapping, rows);
      setResult({ created: r.created, deduped: r.deduped, errors: r.errors });
      setStage("result");
    } catch (e) {
      setFail(e instanceof Error ? e.message : "Import failed");
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
      <Card>
        <div className="flex items-start justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]"><Landmark size={15} /> Import a bank statement</h3>
          <button type="button" onClick={onDone} aria-label="Close import" className="text-[var(--muted)] hover:text-[var(--ink)]"><X size={15} /></button>
        </div>
        {stage === "pick" && (
          <button type="button" onClick={() => input.current?.click()}
            className="mt-3 flex w-full flex-col items-center rounded-[var(--radius-sm)] border-2 border-dashed border-[var(--line)] px-4 py-8 text-sm text-[var(--muted)] transition-colors hover:border-[var(--accent)]">
            <UploadCloud size={20} className="text-[var(--accent)]" />
            <span className="mt-2">Choose a bank statement CSV — up to ~2&nbsp;MB</span>
          </button>
        )}
        {stage === "map" && (
          <div className="mt-3 space-y-3">
            <p className="text-xs leading-relaxed text-[var(--muted)]">{rows.length} rows found. Tell Satya which columns mean what — unreadable rows are reported, never silently dropped.</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {(["date", "utr", "amount", "payeeName", "mode"] as const).map((field) => (
                <label key={field} className="text-[11px] text-[var(--muted)]">
                  {field === "payeeName" ? "Payee" : field === "utr" ? "UTR / ref" : field[0].toUpperCase() + field.slice(1)}
                  <select value={mapping[field]} onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                    className="mt-1 h-8 w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-2 text-xs text-[var(--ink)] outline-none focus:border-[var(--accent)]">
                    <option value="">— skip —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Btn size="sm" onClick={submit} disabled={!mapping.date || !mapping.utr || !mapping.amount}>Import {rows.length} rows</Btn>
              {fail && <span className="text-xs text-[var(--sev-critical)]">{fail}</span>}
            </div>
          </div>
        )}
        {stage === "result" && result && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 text-sm text-[var(--ink-2)]">
            <CheckCircle2 size={14} className="mr-1 inline text-[var(--confirmed)]" />
            {result.created} payment{result.created === 1 ? "" : "s"} imported{result.deduped ? `, ${result.deduped} duplicate${result.deduped === 1 ? "" : "s"} skipped (same UTR)` : ""}{result.errors ? `, ${result.errors} row${result.errors === 1 ? "" : "s"} couldn't be read` : ""}.
          </motion.p>
        )}
        <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])} />
      </Card>
    </motion.div>
  );
}

/* ---------- page ---------- */
export default function PaymentsPage() {
  const { activeEntity } = useSession();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("date_desc");
  const [page, setPage] = useState(1);
  const [workbench, setWorkbench] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setPage(1), [debounced, status, sort]);

  const mocks = mocksEnabled();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["payments", { q: debounced, status, sort, page }],
    queryFn: () => v2.payments({ q: debounced, status, sort, page: String(page), pageSize: "10" }),
  });
  const items = useMemo(() => (data?.items ?? []) as Row[], [data]);
  const total = (data as { total?: number })?.total ?? items.length;
  const pages = (data as { pages?: number })?.pages ?? 1;

  return (
    <FadeIn className="space-y-5">
      <PageHeader
        title="Payments"
        description="Bank transfers matched to invoices. Unclear ones wait for your call — Satya never guesses."
        actions={<Btn variant="outline" icon={UploadCloud} onClick={() => setImporting((v) => !v)}>Import bank CSV</Btn>}
      />

      <AnimatePresence>{importing && (
        mocks
          ? <Card><p className="text-xs text-[var(--muted)]">Mock mode — import is disabled; rows would go to POST /api/v2/import/bank-csv.</p></Card>
          : <ImportCsv entityId={activeEntity?.id ?? ""} onDone={() => { queryClient.invalidateQueries({ queryKey: ["payments"] }); setImporting(false); }} />
      )}</AnimatePresence>

      {/* filter bar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search supplier, UTR, invoice no…" aria-label="Search payments"
            className="h-9 w-64 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] pl-9 pr-3 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)] placeholder:text-[var(--muted)]" />
        </div>
        <div className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] p-1">
          {STATUS_FILTERS.map(([value, label]) => (
            <button key={value} type="button" onClick={() => setStatus(value)}
              className={cn("rounded-[calc(var(--radius-sm)-3px)] px-2.5 py-1 text-xs font-medium transition-colors",
                status === value ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "text-[var(--muted)] hover:text-[var(--ink)]")}>
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <ArrowDownUp size={13} className="text-[var(--muted)]" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort payments"
            className="h-9 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-2 text-xs text-[var(--ink-2)] outline-none transition-colors focus:border-[var(--accent)]">
            {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : items.length === 0 ? (
        <Card><p className="py-8 text-center text-sm text-[var(--muted)]">
          {debounced || status ? "No payments match these filters." : "No payments yet — import a bank CSV or record a payment document."}
        </p></Card>
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((payment, i) => {
              const meta = STATUS_META[payment.status || ""] ?? STATUS_META.not_linked;
              const open = OPEN_STATUSES.has(payment.status || "");
              return (
                <motion.li key={payment.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, duration: 0.25 }}>
                  <button type="button" onClick={() => open && setWorkbench(payment.id)} disabled={!open}
                    className={cn("flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5 text-left transition-colors",
                      open ? "hover:border-[var(--accent)]/50 hover:bg-[var(--surface-2)]/40" : "cursor-default opacity-75")}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--ink)]"><Money value={amt(payment)} /> · {who(payment)}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {payment.date ? <DateText value={payment.date} /> : "—"}
                        {payment.utr ? <> · <span className="font-code">{payment.utr}</span></> : " · no bank reference"}
                        {payment.mode ? <> · {payment.mode}</> : ""}
                        {payment.status === "partial" && payment.allocatedTotal ? <> · <Money value={payment.allocatedTotal} /> allocated</> : ""}
                      </p>
                    </div>
                    <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", meta.classes)}>{meta.label}</span>
                    {open && <span className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--accent)]/50 px-3 py-1.5 text-xs font-medium text-[var(--accent-strong)]">Resolve</span>}
                  </button>
                </motion.li>
              );
            })}
          </ul>

          {/* numbered pagination */}
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-[var(--muted)]">
              Showing {(page - 1) * 10 + 1}–{Math.min(page * 10, total)} of {total}
            </p>
            {pages > 1 && (
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} aria-label="Previous page"
                  className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] border border-[var(--line)] text-[var(--ink-2)] transition-colors hover:border-[var(--accent)]/50 disabled:opacity-40">
                  <ChevronLeft size={14} />
                </button>
                {Array.from({ length: pages }, (_, i) => i + 1).slice(Math.max(0, page - 3), Math.max(0, page - 3) + Math.min(5, pages)).map((n) => (
                  <button key={n} type="button" onClick={() => setPage(n)} aria-current={n === page ? "page" : undefined}
                    className={cn("h-8 min-w-8 rounded-[var(--radius-sm)] border px-2 text-xs font-medium transition-colors",
                      n === page ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--accent)]/50")}>
                    {n}
                  </button>
                ))}
                <button type="button" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages} aria-label="Next page"
                  className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] border border-[var(--line)] text-[var(--ink-2)] transition-colors hover:border-[var(--accent)]/50 disabled:opacity-40">
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        </>
      )}

      <AnimatePresence>
        {workbench && <Drawer paymentId={workbench} onClose={() => setWorkbench(null)} />}
      </AnimatePresence>
    </FadeIn>
  );
}
