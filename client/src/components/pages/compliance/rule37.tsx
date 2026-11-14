"use client";

// Rule 37 — 180-day GST credit: bills unpaid long enough that the credit you
// claimed must be added back with interest. Pay before day 180, or reverse
// the credit in GSTR-3B and mark it here. Disputed bills point at the case.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, Mail, Landmark, CircleCheck, PauseCircle, Undo2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { v2 } from "@/lib/api/v2";
import { mocksEnabled } from "@/lib/flags";
import {
  Money, RelativeDue, StatusChip, ResponsiveTable, RowActions, FilterChips, InfoPanel, InfoList, EmptyState,
  ErrorState, TableSkeleton, type Column, type StatusTone,
} from "@/components/ui/v2";
import { formatDate, toPaise } from "@/lib/format";
import { dayText } from "@/lib/humanize";
import {
  useSection, FieldModal, ReminderModal, reminderBody, TableToolbar, matches, exportCsv, csvMoney,
  inputCls, labelCls, hintCls, type MoneyVal,
} from "./shared";

type Rule37Row = {
  documentId: string; invoice: string; date: string; supplier: string; supplierEmail?: string | null;
  daysWaiting: number; daysToBreach: number; state: "breached" | "approaching" | "reversed";
  itc: MoneyVal; itcOnUnpaid?: MoneyVal; paidSoFar: MoneyVal; outstanding: MoneyVal; interestEstimate?: MoneyVal | null;
  reversedAt?: string | null; reversedBy?: string | null; reversalNote?: string | null; deadline?: string | null;
  onHold?: boolean; caseId?: string | null; disputed?: MoneyVal;
};
type Filter = "open" | "breached" | "approaching" | "hold" | "reversed";

const bucket = (r: Rule37Row): Exclude<Filter, "open"> =>
  r.state === "reversed" ? "reversed" : r.onHold ? "hold" : r.state;

function statusOf(r: Rule37Row): { tone: StatusTone; label: string; icon?: typeof PauseCircle } {
  if (r.state === "reversed") return { tone: "ok", label: "Credit reversed" };
  if (r.onHold) return { tone: "warn", label: "On hold — resolve dispute", icon: PauseCircle };
  if (r.state === "breached") return { tone: "critical", label: "Reverse credit now" };
  return { tone: "warn", label: `Pay within ${dayText(r.daysToBreach)}` };
}

export function Rule37Panel({ onView }: { onView: (id: string) => void }) {
  const { data, isLoading, error, refetch } = useSection("rule37");
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [remind, setRemind] = useState<Rule37Row | null>(null);
  const [confirmReverse, setConfirmReverse] = useState<Rule37Row | null>(null);
  const [reverseNote, setReverseNote] = useState("");

  const mutation = useMutation({
    mutationFn: ({ id, reversed, note }: { id: string; reversed: boolean; note?: string }): Promise<{ documentId: string; itcReversed: unknown }> => {
      if (mocksEnabled()) return Promise.resolve({ documentId: id, itcReversed: null });
      return v2.markItcReversed(id, reversed, note);
    },
    onSuccess: (_r, v) => {
      if (mocksEnabled()) toast.info("Demo data — change is not saved");
      else toast.success(v.reversed ? "Marked as reversed" : "Reversal undone");
      setConfirmReverse(null);
      setReverseNote("");
      queryClient.invalidateQueries({ queryKey: ["compliance", "rule37"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  const items = useMemo(() => ((data?.items ?? []) as Rule37Row[]), [data]);
  const counts = useMemo(() => {
    const c = { breached: 0, approaching: 0, hold: 0, reversed: 0 };
    for (const r of items) c[bucket(r)] += 1;
    return c;
  }, [items]);
  const rows = items.filter((r) => (filter === "open" ? r.state !== "reversed" : bucket(r) === filter) && matches(q, r.invoice, r.supplier));
  const credit = (r: Rule37Row) => r.itcOnUnpaid ?? r.itc;

  const doExport = (list: Rule37Row[]) => exportCsv("rule37-180-day", ["Invoice", "Invoice date", "Supplier", "Days unpaid", "Outstanding", "GST credit at risk", "Day 180", "Status", "Interest estimate", "Reversed on", "Reversal note"],
    list.map((r) => [r.invoice, r.date, r.supplier, r.daysWaiting, csvMoney(r.outstanding), csvMoney(credit(r)), r.deadline ?? "", statusOf(r).label, csvMoney(r.interestEstimate), r.reversedAt ?? "", r.reversalNote ?? ""]));

  const columns: Column<Rule37Row>[] = [
    {
      key: "invoice", header: "Invoice", primary: true,
      cell: (r) => (
        <span className="block min-w-0">
          <button type="button" onClick={() => onView(r.documentId)} className="whitespace-nowrap font-code text-[14px] font-medium text-[var(--ink)] underline-offset-4 hover:underline">{r.invoice}</button>
          <span className="block whitespace-nowrap text-[13px] text-[var(--muted)]">Billed {formatDate(r.date)}</span>
        </span>
      ),
    },
    { key: "supplier", header: "Supplier", width: "min-w-[150px]", cell: (r) => <span className="line-clamp-2 text-[var(--ink)]">{r.supplier}</span> },
    { key: "unpaid", header: "Unpaid for", align: "right", cell: (r) => dayText(r.daysWaiting) },
    { key: "outstanding", header: "Outstanding", align: "right", cell: (r) => <Money value={r.outstanding} className="text-[var(--ink)]" /> },
    { key: "credit", header: "GST credit", align: "right", cell: (r) => <Money value={credit(r)} className="font-medium text-[var(--ink)]" /> },
    {
      key: "deadline", header: "Day 180",
      cell: (r) => r.state === "reversed"
        ? <span className="text-[14px] text-[var(--muted)]">Reversed {r.reversedAt ? formatDate(r.reversedAt) : ""}</span>
        : <RelativeDue daysLeft={r.state === "breached" ? -(r.daysWaiting - 180) : r.daysToBreach} date={r.deadline ?? null} />,
    },
    {
      key: "status", header: "Status",
      cell: (r) => {
        const s = statusOf(r);
        if (!r.onHold || r.state === "reversed") return <StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip>;
        return (
          <span className="inline-flex flex-col items-start gap-1">
            <StatusChip tone="warn" icon={PauseCircle}>On hold</StatusChip>
            <span className="whitespace-nowrap text-[13px] text-[var(--muted)]">Resolve dispute first</span>
          </span>
        );
      },
    },
    {
      key: "interest", header: "Interest est.", align: "right",
      cell: (r) => r.interestEstimate && toPaise(r.interestEstimate.amount) > BigInt(0) ? <Money value={r.interestEstimate} /> : <span className="text-[var(--muted)]">—</span>,
    },
  ];

  const actions = (r: Rule37Row) => {
    const view = { label: "View invoice", icon: Eye, onSelect: () => onView(r.documentId) };
    const reverse = { label: "Mark credit reversed", icon: CircleCheck, danger: true, onSelect: () => { setConfirmReverse(r); setReverseNote(""); } };
    const remindItem = { label: "Send reminder", icon: Mail, onSelect: () => setRemind(r) };
    const pay = { label: "Record payment", icon: Landmark, href: "/app/payments" };
    const ask = { label: "Ask Satya about this", icon: MessageSquare, href: `/app/ask?about=${encodeURIComponent(`Rule 37 for invoice ${r.invoice}`)}` };
    if (r.state === "reversed") {
      return <RowActions label={r.invoice} primary={{ label: "Undo", icon: Undo2, onSelect: () => mutation.mutate({ id: r.documentId, reversed: false }), disabled: mutation.isPending }} items={[view]} />;
    }
    if (r.onHold) {
      return <RowActions label={r.invoice} primary={{ label: "Review issue", href: r.caseId ? `/app/investigations/${r.caseId}` : "/app/investigations" }} items={[view, ask, reverse]} />;
    }
    if (r.state === "breached") {
      return <RowActions label={r.invoice} primary={{ label: "Mark reversed", onSelect: reverse.onSelect, disabled: mutation.isPending }} items={[pay, remindItem, view, ask]} />;
    }
    return <RowActions label={r.invoice} primary={{ label: "Record payment", href: "/app/payments" }} items={[remindItem, view, ask, reverse]} />;
  };

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Could not load"} onRetry={() => refetch()} />;

  return (
    <div className="space-y-5">
      <InfoPanel storageKey="compliance.rule37" summary="Pay a supplier within 180 days of the invoice, or give back the GST credit with interest.">
        <InfoList
          items={[
            { label: "The rule", value: "If you don’t pay a supplier (value + tax) within 180 days of the invoice date, the GST credit you claimed on the unpaid part must be added back to your output tax." },
            { label: "If it’s missed", value: "Interest at 18% a year runs on the reversed credit. You can claim the credit again once you pay." },
            { label: "How Satya checks", value: "Bills appear here from day 150 (a month’s warning). Credit at risk is the GST on the part still unpaid. After you reverse it in GSTR-3B, mark it here — Satya records it; it doesn’t file anything." },
            { label: "Law", value: "CGST Act section 16(2), second proviso · CGST Rules, rule 37" },
          ]}
        />
        <p className="mt-4 text-[14px] text-[var(--muted)]">
          Screening, not tax advice — confirm positions with your CA.{" "}
          <Link href={`/app/ask?about=${encodeURIComponent("Rule 37 ITC reversal")}`} className="font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">Ask Satya to explain</Link>
        </p>
      </InfoPanel>

      {isLoading || !data ? (
        <TableSkeleton rows={4} columns={7} />
      ) : (
        <div>
          <TableToolbar
            filters={
              <FilterChips<Filter>
                label="Filter 180-day bills"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "open", label: "Open", count: items.length - counts.reversed },
                  { value: "breached", label: "Past day 180", count: counts.breached, tone: "critical" },
                  { value: "approaching", label: "Within 30 days", count: counts.approaching, tone: "warn" },
                  { value: "hold", label: "On hold", count: counts.hold, tone: "warn" },
                  { value: "reversed", label: "Reversed", count: counts.reversed },
                ]}
              />
            }
            search={q}
            onSearch={setQ}
            onExport={() => doExport(rows)}
          />
          <ResponsiveTable
            caption="Bills near or past the 180-day GST credit limit"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.documentId}
            actions={actions}
            rowAccent={(r) => (r.state === "breached" && !r.onHold ? "critical" : null)}
            empty={
              items.length === 0 ? (
                <EmptyState compact tone="ok" icon={CircleCheck} title="No bill is near day 180" body="Nothing has been unpaid for 150 days or more. Bills appear here a month before their GST credit would have to be reversed." />
              ) : (
                <EmptyState compact title="No bills match" body="Try another filter or clear the search." />
              )
            }
          />
        </div>
      )}

      {remind ? (
        <ReminderModal
          title={`Remind ${remind.supplier}`}
          subject={`Payment pending — invoice ${remind.invoice}`}
          email={remind.supplierEmail}
          body={reminderBody(remind.invoice, `It has been unpaid for ${dayText(remind.daysWaiting)}. We are arranging payment — if you have already received it, please share the payment reference.`)}
          onClose={() => setRemind(null)}
        />
      ) : null}
      {confirmReverse ? (
        <FieldModal
          title={`Mark GST credit reversed — ${confirmReverse.invoice}`}
          submitLabel="Yes, mark as reversed"
          danger
          busy={mutation.isPending}
          onClose={() => setConfirmReverse(null)}
          onSubmit={() => mutation.mutate({ id: confirmReverse.documentId, reversed: true, note: reverseNote.trim() || undefined })}
        >
          <p className="text-[15px] leading-relaxed text-[var(--ink-2)]">
            Only do this after you have added back <Money value={credit(confirmReverse)} className="font-semibold" /> of GST credit in GSTR-3B.
            It records that the reversal is done; it doesn’t file anything. You can undo it.
          </p>
          <div>
            <label htmlFor="rev-note" className={labelCls}>Where was it reversed? <span className="font-normal text-[var(--muted)]">(recommended)</span></label>
            <input id="rev-note" className={inputCls} value={reverseNote} onChange={(e) => setReverseNote(e.target.value)} placeholder="e.g. GSTR-3B for Oct 2026, table 4(B)(2)" />
            <p className={hintCls}>Saved with the reversal for your auditor.</p>
          </div>
        </FieldModal>
      ) : null}
    </div>
  );
}
