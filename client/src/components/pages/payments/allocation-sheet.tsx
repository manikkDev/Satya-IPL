"use client";

// Allocation workbench — a Radix Sheet (focus trap, Escape, aria-modal,
// focus returns to the row that opened it). Engine options or hand-picked
// invoices; every amount is integer paise, capped at min(open amount,
// what is left of the payment). Sends expectedRevision so a stale screen
// can never overwrite someone else's allocation.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Wand2, Hand, CircleAlert, Wallet, ChevronRight, X } from "lucide-react";
import {
  paymentsApi, parsePaise, paiseOf, paiseToDecimal, sumPaise, minPaise, maxPaise, pctOf, ZERO,
  type Workbench,
} from "@/lib/api/v2-pages";
import { ApiError } from "@/lib/api/client";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Money, DateText, CertaintyBadge, ErrorState, Btn, Progress } from "@/components/ui/v2";
import type { Certainty } from "@/content/copy/vocabulary";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";

type Target = { id: string; label: string; sub: string; cap: bigint; credit: boolean; same: boolean; exact: boolean; date?: string };

const norm = (v?: string | null) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const inputBase =
  "h-10 w-32 rounded-[var(--radius-sm)] border bg-[var(--paper)] px-2.5 text-right text-[15px] tnum outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-40";

function Body({ paymentId, onDone }: { paymentId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["pay-wb", paymentId],
    queryFn: () => paymentsApi.workbench(paymentId),
  });
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [manual, setManual] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const wb: Workbench | undefined = data;
  const remaining = paiseOf(wb?.payment.remaining ?? wb?.payment.amount ?? "0");

  // Bills from the same supplier come first and an exact-amount bill is
  // flagged — the likely match is obvious before anyone ticks a box.
  const targets = useMemo<Target[]>(() => {
    if (!wb) return [];
    const payee = norm(wb.payment.counterparty);
    const left = paiseOf(wb.payment.remaining ?? wb.payment.amount ?? "0");
    const rows: Target[] = [
      ...wb.openInvoices.map((inv) => {
        const same = !!payee && norm(inv.seller) === payee;
        const cap = paiseOf(inv.openAmount);
        return {
          id: inv.id, label: inv.number || "Unnumbered bill", credit: false, cap, same, exact: same && cap === left, date: inv.date,
          sub: [inv.seller, inv.date ? formatDate(inv.date) : null].filter(Boolean).join(" · "),
        };
      }),
      ...wb.credits.map((c) => ({
        id: c.id, label: c.number || "Credit note", credit: true, cap: paiseOf(c.amount), same: false, exact: false, date: c.date,
        sub: ["Credit note", c.date ? formatDate(c.date) : null].filter(Boolean).join(" · "),
      })),
    ];
    return rows.sort((a, b) => Number(b.exact) - Number(a.exact) || Number(b.same) - Number(a.same) || String(a.date ?? "").localeCompare(String(b.date ?? "")));
  }, [wb]);
  const sameTargets = targets.filter((t) => t.same);
  const otherTargets = targets.filter((t) => !t.same);
  const byId = useMemo(() => new Map(targets.map((t) => [t.id, t])), [targets]);

  // Parse every picked amount once; collect per-row problems.
  const parsed = useMemo(() => {
    const rows = Object.entries(picked).map(([id, text]) => {
      const value = parsePaise(text);
      const cap = byId.get(id)?.cap ?? ZERO;
      const problem =
        value === null ? "Enter an amount like 12,500.00"
        : value <= ZERO ? "Must be more than ₹0"
        : value > cap ? `More than the open ${paiseToDecimal(cap)}`
        : null;
      return { id, value: value ?? ZERO, problem };
    });
    const total = sumPaise(rows.filter((r) => !r.problem).map((r) => r.value));
    return { rows, total, problems: Object.fromEntries(rows.filter((r) => r.problem).map((r) => [r.id, r.problem!])) };
  }, [picked, byId]);

  const over = parsed.total > remaining;
  const hasProblems = Object.keys(parsed.problems).length > 0;
  const disabler =
    Object.keys(picked).length === 0 ? "Pick an option or tick at least one bill"
    : hasProblems ? "Fix the highlighted amounts"
    : parsed.total <= ZERO ? "Pick an option or tick at least one bill"
    : over ? "The picks add up to more than what is left of the payment"
    : reason.trim().length < 5 ? "Say why — a few words, e.g. “paid after delivery”"
    : null;

  const toggle = (t: Target, on: boolean) =>
    setPicked((prev) => {
      const next = { ...prev };
      if (!on) {
        delete next[t.id];
        return next;
      }
      const used = sumPaise(Object.entries(prev).map(([id, text]) => (id === t.id ? ZERO : parsePaise(text) ?? ZERO)));
      const left = maxPaise(ZERO, remaining - used);
      next[t.id] = paiseToDecimal(minPaise(t.cap, left));
      return next;
    });

  const allocate = async () => {
    if (!wb || disabler) return;
    setBusy(true);
    try {
      await paymentsApi.allocate(paymentId, {
        allocations: parsed.rows.filter((r) => r.value > ZERO).map((r) => ({ documentId: r.id, amount: paiseToDecimal(r.value) })),
        reason: reason.trim(),
        ...(typeof wb.payment.revision === "number" ? { expectedRevision: wb.payment.revision } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.removeQueries({ queryKey: ["pay-wb", paymentId] });
      toast.success("Payment matched — Satya is re-checking the orders.");
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error("Someone else changed this payment. The latest figures are loaded — check and try again.");
        setPicked({});
        void refetch();
      } else {
        toast.error(e instanceof Error ? e.message : "Allocation failed — try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-24 text-center" aria-live="polite">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-[var(--accent-soft)]">
          <Loader2 size={22} className="animate-spin text-[var(--accent)] motion-reduce:animate-none" aria-hidden="true" />
        </span>
        <p className="mt-5 text-[17px] font-semibold text-[var(--ink)]">Finding the bills this could pay…</p>
        <p className="mt-1 text-[15px] text-[var(--muted)]">Nothing is guessed — only exact sums are suggested.</p>
      </div>
    );
  }
  if (error || !wb) {
    return <div className="p-5"><ErrorState message={error instanceof Error ? error.message : "Could not load the workbench."} onRetry={() => refetch()} /></div>;
  }
  if (done) {
    return (
      <div className="rise flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-[var(--confirmed-soft)]"><CheckCircle2 size={30} className="text-[var(--confirmed)]" aria-hidden="true" /></span>
        <p className="mt-5 text-[19px] font-semibold text-[var(--ink)]">Payment matched</p>
        <p className="mt-1 max-w-sm text-[15px] text-[var(--muted)]">Satya is re-checking the affected orders — balances and issues update on their own in a few seconds.</p>
        <Btn className="mt-6" onClick={onDone}>Back to payments</Btn>
      </div>
    );
  }

  const suggestion = wb.suggestion;
  const solutions = suggestion?.solutions ?? [];
  const openValue = sumPaise(wb.openInvoices.map((i) => paiseOf(i.openAmount)));
  const coverage = Math.min(100, pctOf(parsed.total, remaining));

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* payment summary */}
          <div className="space-y-4">
            <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
              <p className="text-[14px] font-medium text-[var(--muted)]">Left to match</p>
              <p className="mt-2 text-[26px] font-semibold tracking-tight text-[var(--ink)]"><Money value={paiseToDecimal(remaining)} /></p>
              <dl className="mt-3 space-y-2 text-[14px]">
                {wb.payment.amount ? <div className="flex justify-between gap-2"><dt className="text-[var(--muted)]">Payment amount</dt><dd><Money value={wb.payment.amount} className="text-[var(--ink)]" /></dd></div> : null}
                {wb.payment.counterparty ? <div className="flex justify-between gap-2"><dt className="text-[var(--muted)]">Paid to</dt><dd className="truncate text-[var(--ink)]">{wb.payment.counterparty}</dd></div> : null}
                <div className="flex justify-between gap-2"><dt className="text-[var(--muted)]">Date</dt><dd className="text-[var(--ink)]">{wb.payment.date ? <DateText value={wb.payment.date} /> : "—"}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-[var(--muted)]">Bank ref (UTR)</dt><dd className="tnum text-[var(--ink)]">{wb.payment.utr || "None"}</dd></div>
              </dl>
            </div>
            <dl className="grid grid-cols-2 gap-2.5 lg:grid-cols-1">
              <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] p-3">
                <dt className="text-[13px] text-[var(--muted)]">{sameTargets.length ? "Open bills from this supplier" : "Open bills (all suppliers)"}</dt>
                <dd className="tnum mt-1 text-lg font-semibold text-[var(--ink)]">{sameTargets.length || wb.openInvoices.length}</dd>
              </div>
              <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] p-3">
                <dt className="text-[13px] text-[var(--muted)]">Open value</dt>
                <dd className="mt-1 text-lg font-semibold text-[var(--ink)]"><Money value={paiseToDecimal(openValue)} /></dd>
              </div>
            </dl>
          </div>

          {/* options + manual picker */}
          <div className="min-w-0 space-y-4">
            {solutions.length > 0 ? (
              <section aria-labelledby="wb-options">
                <h3 id="wb-options" className="flex items-center gap-1.5 text-[15px] font-semibold text-[var(--ink)]">
                  <Wand2 size={15} className="text-[var(--accent)]" aria-hidden="true" />
                  {suggestion?.unique ? "Satya found an exact match" : `${solutions.length} ways the amount adds up exactly`}
                </h3>
                <div className="mt-2 space-y-2">
                  {solutions.map((sol, i) => {
                    const active = sol.allocations.length === Object.keys(picked).length &&
                      sol.allocations.every((a) => parsePaise(picked[a.documentId] ?? "") === paiseOf(a.amount.amount));
                    const residual = paiseOf(sol.residual?.amount);
                    return (
                      <button
                        key={i}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setPicked(Object.fromEntries(sol.allocations.map((a) => [a.documentId, paiseToDecimal(paiseOf(a.amount.amount))])))}
                        className={cn(
                          "w-full rounded-[var(--radius-md)] border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60",
                          active ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--accent)]/50",
                        )}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-[15px] font-semibold text-[var(--ink)]">Option {String.fromCharCode(65 + i)}</span>
                          {suggestion?.certainty ? <CertaintyBadge certainty={suggestion.certainty as Certainty} short /> : null}
                        </span>
                        <span className="mt-2 block space-y-1">
                          {sol.allocations.map((a) => (
                            <span key={a.documentId} className="flex items-baseline justify-between gap-3 text-[14px] text-[var(--ink-2)]">
                              <span className="truncate">{byId.get(a.documentId)?.label ?? "Bill"}</span>
                              <Money value={a.amount.amount} />
                            </span>
                          ))}
                          {residual > ZERO ? (
                            <span className="flex items-baseline justify-between text-[14px] text-[var(--muted)]"><span>Left over</span><Money value={paiseToDecimal(residual)} /></span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : suggestion ? (
              <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--possible)_40%,transparent)] bg-[var(--possible-soft)] p-3.5">
                <CircleAlert size={15} className="mt-0.5 shrink-0 text-[var(--possible)]" aria-hidden="true" />
                <p className="text-[15px] leading-relaxed text-[var(--ink-2)]">
                  No combination of open bills adds up to exactly <Money value={paiseToDecimal(remaining)} className="font-semibold" />. Pick bills by hand below — part payments are fine.
                </p>
              </div>
            ) : null}

            <section className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)]">
              <button
                type="button"
                aria-expanded={manual || solutions.length === 0}
                onClick={() => setManual((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]/60"
              >
                <span className="flex items-center gap-2 text-[15px] font-semibold text-[var(--ink)]"><Hand size={15} className="text-[var(--accent)]" aria-hidden="true" /> Pick bills by hand</span>
                <ChevronRight size={14} className={cn("text-[var(--muted)] transition-transform", (manual || solutions.length === 0) && "rotate-90")} aria-hidden="true" />
              </button>
              {manual || solutions.length === 0 ? (
                <ul className="border-t border-[var(--line)]">
                  {targets.length === 0 ? <li className="px-4 py-6 text-center text-[15px] text-[var(--muted)]">No open bills or credit notes for this company.</li> : null}
                  {sameTargets.length === 0 && otherTargets.length > 0 ? (
                    <li className="px-4 py-3 text-[14px] text-[var(--muted)]">No open bills from {wb.payment.counterparty ?? "this supplier"} — other suppliers’ bills are listed below.</li>
                  ) : null}
                  {(showOthers || sameTargets.length === 0 ? targets : sameTargets.concat(targets.filter((t) => !t.same && t.id in picked))).map((t) => {
                    const on = t.id in picked;
                    const problem = parsed.problems[t.id];
                    const inputId = `alloc-${t.id}`;
                    return (
                      <li key={t.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--line)] px-4 py-2.5 last:border-0", on && "bg-[var(--surface-2)]/40")}>
                        <input
                          type="checkbox"
                          id={`pick-${t.id}`}
                          className="h-4 w-4 accent-[var(--accent)]"
                          checked={on}
                          onChange={(e) => toggle(t, e.target.checked)}
                        />
                        <label htmlFor={`pick-${t.id}`} className="min-w-0 flex-1 basis-[calc(100%-2rem)] cursor-pointer sm:basis-0">
                          <span className="flex items-center gap-2 truncate text-[15px] text-[var(--ink)]">
                            {t.label}
                            {t.exact ? <span className="rounded-full bg-[var(--confirmed-soft)] px-2 py-0.5 text-[12px] font-medium text-[var(--confirmed)]">Exact amount</span> : null}
                          </span>
                          <span className={cn("block truncate text-[13px]", t.credit ? "text-[var(--accent)]" : "text-[var(--muted)]")}>{t.sub || "—"}</span>
                        </label>
                        <span className="ml-7 text-[14px] text-[var(--muted)] sm:ml-0">open <Money value={paiseToDecimal(t.cap)} /></span>
                        <div className="ml-auto flex flex-col items-end">
                          <label htmlFor={inputId} className="sr-only">Amount for {t.label}</label>
                          <input
                            id={inputId}
                            inputMode="decimal"
                            value={picked[t.id] ?? ""}
                            disabled={!on}
                            placeholder="0.00"
                            aria-invalid={Boolean(problem)}
                            aria-describedby={problem ? `${inputId}-err` : undefined}
                            onChange={(e) => setPicked((prev) => ({ ...prev, [t.id]: e.target.value }))}
                            className={cn(inputBase, problem ? "border-[var(--sev-critical)]" : "border-[var(--line)]")}
                          />
                          {problem ? <span id={`${inputId}-err`} className="mt-1 text-[13px] text-[var(--sev-critical)]">{problem}</span> : null}
                        </div>
                      </li>
                    );
                  })}
                  {sameTargets.length > 0 && otherTargets.length > 0 ? (
                    <li className="px-4 py-3">
                      <button type="button" onClick={() => setShowOthers((v) => !v)} className="text-[14px] font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">
                        {showOthers ? "Hide other suppliers’ bills" : `Show ${otherTargets.length} bill${otherTargets.length === 1 ? "" : "s"} from other suppliers`}
                      </button>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </section>
          </div>
        </div>
      </div>

      {/* footer — always visible */}
      <div className="border-t border-[var(--line)] bg-[var(--surface)] px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[15px] text-[var(--muted)]">
            Covering <Money value={paiseToDecimal(parsed.total)} className="font-semibold text-[var(--ink)]" /> of <Money value={paiseToDecimal(remaining)} />
          </p>
          {over ? (
            <p className="inline-flex items-center gap-1 text-[14px] font-medium text-[var(--sev-critical)]">
              <CircleAlert size={12} aria-hidden="true" /> Over by <Money value={paiseToDecimal(parsed.total - remaining)} />
            </p>
          ) : null}
        </div>
        <Progress className="mt-2" value={coverage} tone={over ? "var(--sev-critical)" : "var(--accent)"} />
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="alloc-reason" className="sr-only">Why this split?</label>
          <input
            id="alloc-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why these bills? e.g. supplier’s remittance advice"
            className="h-10 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--paper)] px-3 text-[15px] text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)]"
          />
          <Btn disabled={Boolean(disabler) || busy} onClick={allocate} icon={busy ? Loader2 : undefined}>
            {busy ? "Matching…" : "Match payment"}
          </Btn>
        </div>
        {disabler ? <p className="mt-2 text-[14px] text-[var(--muted)]" aria-live="polite">{disabler}</p> : null}
      </div>
    </>
  );
}

export function AllocationSheet({ paymentId, onClose }: { paymentId: string | null; onClose: () => void }) {
  // keep the id while the close animation runs
  const [shown, setShown] = useState<string | null>(paymentId);
  useEffect(() => {
    if (paymentId) setShown(paymentId);
  }, [paymentId]);

  return (
    <Sheet open={Boolean(paymentId)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full gap-0 border-[var(--line)] bg-[var(--paper)] p-0 text-[var(--ink)] sm:max-w-3xl lg:max-w-5xl [&>button:last-child]:hidden"
      >
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-4 sm:px-6">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--accent)]"><Wallet size={17} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-[17px] font-semibold text-[var(--ink)]">Match this payment to bills</SheetTitle>
            <SheetDescription className="text-[14px] text-[var(--muted)]">Nothing changes until you press Match payment.</SheetDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close allocation panel"
            className="rounded-[var(--radius-sm)] p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {shown ? <Body key={shown} paymentId={shown} onDone={onClose} /> : null}
      </SheetContent>
    </Sheet>
  );
}
