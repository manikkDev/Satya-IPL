"use client";

// Payments (/app/payments) — allocation workbench per 06 §5.9.
// Real mode: every row is a stored payment document; Resolve opens the
// engine's subset-sum allocation workbench (GET /payments/:id/allocate),
// Allocate records a reviewer decision + SETTLES links + re-reconcile
// (POST /payments/:id/allocate). Import bank CSV → POST /import/bank-csv.

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UploadCloud, X, CheckCircle2, FileUp } from "lucide-react";
import { v2 } from "@/lib/api/v2";
import { mocksEnabled } from "@/lib/flags";
import { useSession } from "@/components/v2/session";
import { Money, DateText, CertaintyBadge, ErrorState, PageHeader, FadeIn, Card, Btn } from "@/components/ui/v2";
import type { Certainty } from "@/content/copy/vocabulary";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/* ---------- row normalization — mock and live shapes unified ---------- */
type Row = {
  id: string; amount?: string | { amount: string; currency: string }; utr?: string; date?: string; counterparty?: string;
  supplier?: string; status?: string; allocatedTotal?: string; mode?: string;
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

/* ---------- engine-suggested + manual allocation workbench ---------- */
function Workbench({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["pay-wb", paymentId], queryFn: () => v2.paymentWorkbench(paymentId) });
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [fail, setFail] = useState<string | null>(null);

  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;
  const wb = data as Record<string, unknown>;
  const payment = (wb.payment ?? {}) as { id?: string; amount?: string | { amount: string; currency: string }; remaining?: string; utr?: string };
  const remaining = payment.remaining ?? (typeof payment.amount === "string" ? payment.amount : "");
  const openInvoices = ((wb.openInvoices ?? []) as { id: string; number?: string; date?: string; openAmount: string; seller?: string; dueDate?: string }[]);
  const credits = ((wb.credits ?? []) as { id: string; amount: string; date?: string }[]);
  const suggestion = wb.suggestion as { solutions?: { allocations: { documentId: string; amount: { amount: string } }[]; residual?: { amount: string } }[]; unique?: boolean; certainty?: string } | null;
  const solutions = suggestion?.solutions ?? [];
  // mock-workbench compat shape
  const mockSolutions = (wb.solutions ?? []) as { id: string; label: string; certainty: string; allocations: { document: string; amount: { amount: string } }[]; why?: string }[];

  const pickSolution = (allocs: { documentId?: string; document?: string; amount: { amount: string } }[]) => {
    const next: Record<string, string> = {};
    for (const a of allocs) next[a.documentId || a.document || ""] = a.amount.amount;
    setPicked(next);
  };

  const chosenTotal = Object.values(picked).reduce((s, v) => s + (Number(v) || 0), 0);
  const remainingNum = Number(remaining || 0);
  const within = chosenTotal > 0 && chosenTotal <= remainingNum + 0.005;

  const allocate = async () => {
    setBusy(true); setFail(null);
    try {
      await v2.allocatePayment(paymentId, {
        allocations: Object.entries(picked).filter(([, a]) => Number(a) > 0).map(([documentId, amount]) => ({ documentId, amount: Number(amount).toFixed(2) })),
        reason,
      });
      await queryClient.invalidateQueries({ queryKey: ["payments"] });
      setDone(true);
      setTimeout(onClose, 1400);
    } catch (e) {
      setFail(e instanceof Error ? e.message : "Allocation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ink)]">Where does this payment belong?</h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            <Money value={remaining} /> unallocated{payment.utr ? <> · UTR <span className="font-code">{payment.utr}</span></> : " · no bank reference"} — pick invoices whose totals account for it.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--muted)] hover:text-[var(--ink)]"><X size={16} /></button>
      </div>

      {error ? <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} /> : null}

      {/* engine suggestions */}
      {(solutions.length > 0 || mockSolutions.length > 0) && (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
            Suggested by the engine {suggestion?.unique ? "— exact match" : `— ${solutions.length} possible split${solutions.length === 1 ? "" : "s"}`}
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {solutions.map((sol, i) => (
              <button key={i} type="button" onClick={() => pickSolution(sol.allocations)}
                className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)]/40 p-3 text-left transition-colors hover:border-[var(--accent)]/50">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-[var(--ink)]">Option {String.fromCharCode(65 + i)}</p>
                  {suggestion?.certainty && <CertaintyBadge certainty={suggestion.certainty as Certainty} short />}
                </div>
                <ul className="mt-2 space-y-1 text-xs text-[var(--ink-2)]">
                  {sol.allocations.map((a) => (
                    <li key={a.documentId} className="flex justify-between">
                      <span className="font-code">{openInvoices.find((o) => o.id === a.documentId)?.number || a.documentId}</span>
                      <Money value={a.amount.amount} />
                    </li>
                  ))}
                  {Number(sol.residual?.amount || 0) > 0.005 && <li className="flex justify-between text-[var(--muted)]"><span>Unaccounted</span><Money value={sol.residual!.amount} /></li>}
                </ul>
              </button>
            ))}
            {mockSolutions.map((sol) => (
              <button key={sol.id} type="button" onClick={() => pickSolution(sol.allocations as { documentId?: string; document?: string; amount: { amount: string } }[])}
                className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)]/40 p-3 text-left transition-colors hover:border-[var(--accent)]/50">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-[var(--ink)]">{sol.label}</p>
                  <CertaintyBadge certainty={sol.certainty as Certainty} short />
                </div>
                <p className="mt-2 text-xs text-[var(--ink-2)]">{sol.why}</p>
              </button>
            ))}
          </div>
        </div>
      )}
      {suggestion && solutions.length === 0 && (
        <p className="mt-3 rounded-[var(--radius-sm)] border border-[var(--possible)]/40 bg-[var(--possible-soft)] px-3 py-2 text-xs text-[var(--possible)]">
          No combination of open invoices sums to this amount. You can still allocate part of it by hand below.
        </p>
      )}

      {/* manual allocation table */}
      {openInvoices.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Open invoices in this entity</p>
          <table className="mt-2 w-full text-sm">
            <thead><tr className="border-b border-[var(--line)] text-left text-xs text-[var(--muted)]"><th className="py-2"></th><th>Invoice</th><th>Date</th><th>Supplier</th><th className="text-right">Open</th><th className="w-32 text-right">Allocate</th></tr></thead>
            <tbody>
              {openInvoices.map((inv) => (
                <tr key={inv.id} className="border-b border-[var(--line)] last:border-0 text-[var(--ink-2)]">
                  <td className="py-2 pr-2"><input type="checkbox" className="accent-[var(--accent)]" checked={inv.id in picked}
                    onChange={(e) => setPicked((prev) => { const next = { ...prev }; if (e.target.checked) next[inv.id] = inv.openAmount; else delete next[inv.id]; return next; })} /></td>
                  <td className="font-code text-xs">{inv.number || inv.id}</td>
                  <td>{inv.date ? <DateText value={inv.date} /> : "—"}</td>
                  <td className="text-xs">{inv.seller || "—"}</td>
                  <td className="text-right"><Money value={inv.openAmount} /></td>
                  <td className="w-32 text-right">
                    <input inputMode="decimal" value={picked[inv.id] ?? ""} disabled={!(inv.id in picked)} placeholder="0.00"
                      onChange={(e) => setPicked((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                      className="h-8 w-28 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)]/50 px-2 text-right text-xs tnum outline-none focus:border-[var(--accent)] disabled:opacity-40" />
                  </td>
                </tr>
              ))}
              {credits.map((c) => (
                <tr key={c.id} className="border-b border-[var(--line)] last:border-0 text-[var(--ink-2)]">
                  <td className="py-2 pr-2"><input type="checkbox" className="accent-[var(--accent)]" checked={c.id in picked}
                    onChange={(e) => setPicked((prev) => { const next = { ...prev }; if (e.target.checked) next[c.id] = c.amount; else delete next[c.id]; return next; })} /></td>
                  <td className="font-code text-xs">{c.id} <span className="text-[10px] text-[var(--accent)]">credit note</span></td>
                  <td>{c.date ? <DateText value={c.date} /> : "—"}</td><td className="text-xs">—</td>
                  <td className="text-right"><Money value={c.amount} /></td>
                  <td className="w-32 text-right">
                    <input inputMode="decimal" value={picked[c.id] ?? ""} disabled={!(c.id in picked)} placeholder="0.00"
                      onChange={(e) => setPicked((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      className="h-8 w-28 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)]/50 px-2 text-right text-xs tnum outline-none focus:border-[var(--accent)] disabled:opacity-40" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-4">
        <p className="text-xs text-[var(--ink-2)]">
          Allocating <Money value={chosenTotal.toFixed(2)} /> of <Money value={remaining} />
          {chosenTotal > remainingNum + 0.005 && <span className="ml-2 font-medium text-[var(--sev-critical)]">over the payment</span>}
        </p>
        {done ? (
          <span className="ml-auto inline-flex items-center gap-2 text-sm font-medium text-[var(--confirmed)]"><CheckCircle2 size={15} /> Allocated — reconciliation queued</span>
        ) : (
          <div className="ml-auto flex items-center gap-2">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this split? (required)" aria-label="Allocation reason"
              className="h-9 w-64 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)]/50 px-3 text-sm outline-none focus:border-[var(--accent)]" />
            <Btn disabled={!within || reason.trim().length < 5 || busy} onClick={allocate}>
              {busy ? "Allocating…" : "Allocate"}
            </Btn>
          </div>
        )}
      </div>
      {fail && <p className="mt-2 text-xs text-[var(--sev-critical)]">{fail}</p>}
      <p className="mt-2 text-[10px] text-[var(--muted)]">
        Amounts are checked by the engine — never guessed. If you recorded this payment, a colleague must allocate it (maker–checker).
      </p>
    </Card>
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

  const guess = (h: string[], want: string) =>
    h.find((x) => x.toLowerCase().includes(want)) ?? "";

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
      onDone();
    } catch (e) {
      setFail(e instanceof Error ? e.message : "Import failed");
    }
  };

  return (
    <Card>
      <div className="flex items-start justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]"><FileUp size={15} /> Import bank CSV</h3>
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
          <p className="text-xs text-[var(--muted)]">{rows.length} rows found. Tell Satya which columns mean what — rows without a valid UTR/date/amount are reported, not dropped silently.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(["date", "utr", "amount", "payeeName", "mode"] as const).map((field) => (
              <label key={field} className="text-[11px] text-[var(--muted)]">
                {field === "payeeName" ? "Payee" : field === "utr" ? "UTR / reference" : field[0].toUpperCase() + field.slice(1)}
                <select value={mapping[field]} onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                  className="mt-1 h-8 w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-2 text-xs text-[var(--ink)]">
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
        <p className="mt-3 text-sm text-[var(--ink-2)]">
          <CheckCircle2 size={14} className="mr-1 inline text-[var(--confirmed)]" />
          {result.created} payment{result.created === 1 ? "" : "s"} imported{result.deduped ? `, ${result.deduped} duplicate${result.deduped === 1 ? "" : "s"} skipped (same UTR)` : ""}{result.errors ? `, ${result.errors} row${result.errors === 1 ? "" : "s"} couldn't be read` : ""}.
        </p>
      )}
      <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])} />
    </Card>
  );
}

/* ---------- page ---------- */
export default function PaymentsPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["payments"], queryFn: () => v2.payments() });
  const { activeEntity } = useSession();
  const [workbench, setWorkbench] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const queryClient = useQueryClient();
  const items = useMemo(() => (data?.items ?? []) as Row[], [data]);
  const openCount = items.filter((i) => ["unallocated", "partial", "needs_evidence", "unclear"].includes(i.status || "")).length;

  return (
    <FadeIn className="space-y-5">
      <PageHeader
        title="Payments"
        description="Bank transfers matched to invoices. Unclear ones wait for your call — Satya never guesses."
        actions={
          <Btn variant="outline" icon={UploadCloud} onClick={() => setImporting((v) => !v)}>
            Import bank CSV
          </Btn>
        }
      />

      {importing && (mocksEnabled()
        ? <Card><p className="text-xs text-[var(--muted)]">Mock mode — import is disabled; rows would go to POST /api/v2/import/bank-csv.</p></Card>
        : <ImportCsv entityId={activeEntity?.id ?? ""} onDone={() => { queryClient.invalidateQueries({ queryKey: ["payments"] }); setImporting(false); }} />)}

      {workbench && <Workbench paymentId={workbench} onClose={() => setWorkbench(null)} />}

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : items.length === 0 ? (
        <Card><p className="text-sm text-[var(--muted)]">No payments yet — import a bank CSV or record a payment document.</p></Card>
      ) : (
        <>
          <p className="text-xs text-[var(--muted)]">{items.length} payment{items.length === 1 ? "" : "s"} · {openCount} need{openCount === 1 ? "s" : ""} attention</p>
          <ul className="space-y-2">
            {items.map((payment) => {
              const meta = STATUS_META[payment.status || ""] ?? STATUS_META.not_linked;
              const open = ["unallocated", "partial", "needs_evidence", "unclear", "not_linked"].includes(payment.status || "");
              return (
                <li key={payment.id}>
                  <button type="button" onClick={() => open && setWorkbench(payment.id)}
                    className={cn("flex w-full flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-left transition-colors",
                      open ? "hover:border-[var(--accent)]/50 hover:bg-[var(--surface-2)]/40" : "opacity-80")}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--ink)]"><Money value={amt(payment)} /> · {who(payment)}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {payment.date ? <DateText value={payment.date} /> : "—"}
                        {payment.utr ? <> · <span className="font-code">{payment.utr}</span></> : " · no bank reference"}
                        {payment.mode ? <> · {payment.mode}</> : ""}
                        {payment.status === "partial" && payment.allocatedTotal ? <> · <Money value={payment.allocatedTotal} /> allocated</> : ""}
                      </p>
                    </div>
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", meta.classes)}>{meta.label}</span>
                    {open && <span className="rounded-[var(--radius-sm)] border border-[var(--accent)]/50 px-3 py-1.5 text-xs font-medium text-[var(--accent-strong)]">Resolve</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </FadeIn>
  );
}
