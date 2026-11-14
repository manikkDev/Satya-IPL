"use client";

// TDS 194Q / 194C: payments that cross a screening band and need a decision —
// record the TDS you deducted, or mark it not applicable. Estimates come from
// the server only (GST-exclusive base, per-supplier FY totals, section).

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, Ban, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import { v2 } from "@/lib/api/v2";
import { mocksEnabled } from "@/lib/flags";
import {
  Money, StatusChip, ResponsiveTable, RowActions, FilterChips, InfoPanel, InfoList, EmptyState, ErrorState,
  TableSkeleton, InfoTip, type Column, type StatusTone,
} from "@/components/ui/v2";
import { formatDate, formatMoney } from "@/lib/format";
import { parsePaise, paiseToDecimal, ZERO } from "@/lib/api/v2-pages";
import { sanitizeEngineText } from "@/lib/humanize";
import { useSection, FieldModal, TableToolbar, matches, exportCsv, csvMoney, inputCls, labelCls, hintCls, type MoneyVal } from "./shared";
import { cn } from "@/lib/utils";

type TdsEstimate = { section?: string | null; rate?: string | null; amount?: MoneyVal | string | null; base?: MoneyVal | string | null; note?: string | null };
type TdsRow = {
  documentId: string; payment: string; date: string; utr?: string | null; supplier: string;
  amount: MoneyVal; status: "check" | "recorded" | "waived";
  section?: string | null; tdsAmount?: MoneyVal; fyPaidToSupplier?: MoneyVal; note: string;
  estimate?: TdsEstimate | null; suggested?: TdsEstimate | null; tdsEstimate?: TdsEstimate | MoneyVal | string | null;
  suggestedRate?: string | null; taxableBase?: MoneyVal | string | null;
};
type Filter = "check" | "recorded" | "waived" | "all";

const decimalOf = (v: MoneyVal | string | null | undefined): string | null =>
  v == null ? null : typeof v === "string" ? v : v.amount ?? null;

/** The server's screening estimate for a row, whatever key it arrives on. */
function tdsEstimateOf(row: TdsRow): { section: string | null; rate: string | null; amount: string | null; base: string | null } | null {
  const raw = row.estimate ?? row.suggested ?? row.tdsEstimate ?? null;
  if (!raw) return null;
  const est: TdsEstimate =
    typeof raw === "string" ? { amount: raw }
      : "currency" in raw && !("section" in raw) ? { amount: raw as MoneyVal }
        : (raw as TdsEstimate);
  const amount = decimalOf(est.amount);
  const parsed = amount !== null ? parsePaise(amount) : null;
  const base = decimalOf(est.base ?? row.taxableBase ?? null);
  const parsedBase = base !== null ? parsePaise(base) : null;
  return {
    section: est.section ?? row.section ?? null,
    rate: est.rate ?? row.suggestedRate ?? null,
    amount: parsed !== null ? paiseToDecimal(parsed) : null,
    base: parsedBase !== null ? paiseToDecimal(parsedBase) : null,
  };
}

const TDS_SECTIONS = [
  { value: "194Q", label: "194Q — purchase of goods (0.1% above ₹50 lakh a year per supplier)", rate: "0.1" },
  { value: "194C", label: "194C — contract work (1% individual/HUF, 2% others)", rate: "" },
  { value: "194J", label: "194J — professional or technical fees", rate: "" },
  { value: "194I", label: "194I — rent", rate: "" },
  { value: "GST-51", label: "GST section 51 — TDS by notified entities (2%)", rate: "2" },
];

function statusOf(r: TdsRow): { tone: StatusTone; label: string } {
  if (r.status === "recorded") return { tone: "ok", label: "TDS recorded" };
  if (r.status === "waived") return { tone: "neutral", label: "Not applicable" };
  return { tone: "warn", label: "Needs a decision" };
}

export function TdsPanel({ onView }: { onView: (id: string) => void }) {
  const { data, isLoading, error, refetch } = useSection("tds");
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("check");
  const [q, setQ] = useState("");
  const [record, setRecord] = useState<TdsRow | null>(null);
  const [waive, setWaive] = useState<TdsRow | null>(null);
  const [section, setSection] = useState(TDS_SECTIONS[0].value);
  const [note, setNote] = useState("");
  const [amountText, setAmountText] = useState("");

  const mutation = useMutation({
    mutationFn: (body: { paymentId: string; action: "record" | "waive"; section?: string; rate?: string; amount?: string; note?: string }): Promise<{ paymentId: string; tdsEntryId?: string }> => {
      if (mocksEnabled()) return Promise.resolve({ paymentId: body.paymentId });
      return v2.tdsDecision(body);
    },
    onSuccess: (_r, v) => {
      if (mocksEnabled()) toast.info("Demo data — change is not saved");
      else toast.success(v.action === "record" ? "TDS entry recorded" : "Marked as not applicable");
      setRecord(null); setWaive(null); setNote(""); setAmountText("");
      queryClient.invalidateQueries({ queryKey: ["compliance", "tds"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  const items = useMemo(() => ((data?.items ?? []) as TdsRow[]), [data]);
  const counts = { check: items.filter((r) => r.status === "check").length, recorded: items.filter((r) => r.status === "recorded").length, waived: items.filter((r) => r.status === "waived").length };
  const rows = items.filter((r) => (filter === "all" || r.status === filter) && matches(q, r.payment, r.supplier, r.utr));

  const chosen = TDS_SECTIONS.find((x) => x.value === section) ?? TDS_SECTIONS[0];
  const recordEstimate = record ? tdsEstimateOf(record) : null;
  const enteredPaise = parsePaise(amountText);
  const amountProblem = !amountText.trim()
    ? "Enter the TDS amount you actually deducted"
    : enteredPaise === null ? "Enter an amount like 5,400.00"
      : enteredPaise <= ZERO ? "Must be more than ₹0"
        : record && enteredPaise > (parsePaise(record.amount.amount) ?? ZERO) ? "More than the payment itself"
          : null;
  const openRecord = (row: TdsRow) => {
    const est = tdsEstimateOf(row);
    setRecord(row);
    setSection(est?.section && TDS_SECTIONS.some((x) => x.value === est.section) ? est.section : TDS_SECTIONS[0].value);
    setAmountText(est?.amount ?? "");
    setNote("");
  };

  const tdsCell = (r: TdsRow) => {
    if (r.status === "recorded") return <Money value={r.tdsAmount} className="font-medium text-[var(--ink)]" />;
    if (r.status === "waived") return <span className="text-[var(--muted)]">—</span>;
    const est = tdsEstimateOf(r);
    return est?.amount ? (
      <span className="inline-flex flex-col items-end leading-snug">
        <Money value={est.amount} className="text-[var(--ink)]" />
        <span className="text-[13px] text-[var(--muted)]">estimate</span>
      </span>
    ) : <span className="text-[var(--muted)]">—</span>;
  };

  const doExport = (list: TdsRow[]) => exportCsv("tds-decisions", ["Payment", "Date", "UTR", "Supplier", "Amount", "Section", "TDS (recorded or estimate)", "Status", "Basis"],
    list.map((r) => [r.payment, r.date, r.utr ?? "", r.supplier, csvMoney(r.amount), r.section ?? "", r.status === "recorded" ? csvMoney(r.tdsAmount) : tdsEstimateOf(r)?.amount ?? "", statusOf(r).label, r.note]));

  const columns: Column<TdsRow>[] = [
    {
      key: "payment", header: "Payment", primary: true,
      cell: (r) => (
        <span className="block min-w-0">
          <button type="button" onClick={() => onView(r.documentId)} className="whitespace-nowrap font-code text-[14px] font-medium text-[var(--ink)] underline-offset-4 hover:underline">{r.payment}</button>
          <span className="block text-[13px] text-[var(--muted)]">{formatDate(r.date)}{r.utr ? ` · UTR ${r.utr}` : ""}</span>
        </span>
      ),
    },
    { key: "supplier", header: "Supplier", width: "min-w-[150px]", cell: (r) => <span className="line-clamp-2 text-[var(--ink)]">{r.supplier}</span> },
    { key: "amount", header: "Amount paid", align: "right", cell: (r) => <Money value={r.amount} className="text-[var(--ink)]" /> },
    {
      key: "section", header: "Section",
      cell: (r) => (
        <span className="inline-flex items-center gap-1">
          {r.section ?? "—"}
          {r.status === "check" && r.note ? <InfoTip label={`Why ${r.section ?? "this section"}`}>{sanitizeEngineText(r.note)}</InfoTip> : null}
        </span>
      ),
    },
    { key: "tds", header: "TDS", align: "right", cell: tdsCell },
    { key: "status", header: "Status", cell: (r) => { const s = statusOf(r); return <StatusChip tone={s.tone}>{s.label}</StatusChip>; } },
  ];

  const actions = (r: TdsRow) => {
    const view = { label: "View payment", icon: Eye, onSelect: () => onView(r.documentId) };
    if (r.status !== "check") return <RowActions label={r.payment} primary={{ label: "View", onSelect: view.onSelect }} />;
    return (
      <RowActions
        label={r.payment}
        primary={{ label: "Record TDS", onSelect: () => openRecord(r) }}
        items={[{ label: "Mark not applicable", icon: Ban, onSelect: () => { setWaive(r); setNote(""); } }, view]}
      />
    );
  };

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Could not load"} onRetry={() => refetch()} />;

  return (
    <div className="space-y-5">
      <InfoPanel storageKey="compliance.tds" summary="Some supplier payments need tax deducted at source before you pay — decide each one.">
        <InfoList
          items={[
            { label: "The rule", value: "194Q: if your turnover was over ₹10 crore last year, deduct 0.1% on purchases of goods from one supplier above ₹50 lakh in the year. 194C: deduct 1% (individual/HUF) or 2% (others) on contract payments over ₹30,000 at once or ₹1 lakh in the year." },
            { label: "If it’s missed", value: "You become liable for the tax you didn’t deduct, with interest, and the expense can be disallowed. Deposit TDS by the 7th of the next month (30 April for March)." },
            { label: "How Satya checks", value: "Purchases are totalled per supplier for the financial year on the value before GST — TDS is never worked out on GST. Amounts shown are screening estimates; record what you actually deducted." },
            { label: "Law", value: "Income-tax Act sections 194Q and 194C" },
          ]}
        />
        <p className="mt-4 text-[14px] text-[var(--muted)]">
          Screening, not tax advice — your CA makes the call.{" "}
          <Link href={`/app/ask?about=${encodeURIComponent("TDS on supplier payments")}`} className="font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">Ask Satya to explain</Link>
        </p>
      </InfoPanel>

      {isLoading || !data ? (
        <TableSkeleton rows={4} columns={6} />
      ) : (
        <div>
          <TableToolbar
            filters={
              <FilterChips<Filter>
                label="Filter TDS decisions"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "check", label: "Needs a decision", count: counts.check, tone: "warn" },
                  { value: "recorded", label: "Recorded", count: counts.recorded },
                  { value: "waived", label: "Not applicable", count: counts.waived },
                  { value: "all", label: "All", count: items.length },
                ]}
              />
            }
            search={q}
            onSearch={setQ}
            searchLabel="Search payment, UTR or supplier"
            onExport={() => doExport(rows)}
          />
          <ResponsiveTable
            caption="Payments that need a TDS decision"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.documentId}
            actions={actions}
            empty={
              items.length === 0 ? (
                <EmptyState compact tone="ok" icon={CircleCheck} title="No payment needs a TDS decision" body={`${data.summary?.paymentsScanned ?? 0} payments checked — none crosses the 194Q or 194C bands this financial year.`} />
              ) : (
                <EmptyState compact title="Nothing here" body={filter === "check" ? "Every flagged payment has a decision." : "Try another filter or clear the search."} />
              )
            }
          />
        </div>
      )}

      {record ? (
        <FieldModal
          title={`Record TDS — ${record.supplier}`}
          submitLabel="Save TDS entry"
          busy={mutation.isPending}
          onClose={() => setRecord(null)}
          onSubmit={() => {
            if (amountProblem || enteredPaise === null) { toast.error(amountProblem ?? "Check the amount"); return; }
            mutation.mutate({
              paymentId: record.documentId, action: "record", section,
              rate: (recordEstimate?.section === section ? recordEstimate?.rate : null) ?? (chosen.rate || undefined),
              amount: paiseToDecimal(enteredPaise), note: note || undefined,
            });
          }}
        >
          <p className="text-[15px] text-[var(--muted)]">Payment of <Money value={record.amount} className="text-[var(--ink)]" /> on {formatDate(record.date)} (includes GST).</p>
          <div>
            <label htmlFor="tds-section" className={labelCls}>Section</label>
            <select id="tds-section" className={inputCls} value={section} onChange={(e) => setSection(e.target.value)}>
              {TDS_SECTIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="tds-amount" className={labelCls}>TDS amount deducted (₹)</label>
            <input
              id="tds-amount" inputMode="decimal" className={cn(inputCls, "tnum text-right", amountProblem && amountText ? "border-[var(--sev-critical)]" : "")}
              value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0.00"
              aria-invalid={Boolean(amountProblem && amountText)} aria-describedby="tds-amount-help"
            />
            <p id="tds-amount-help" className={hintCls}>
              {recordEstimate?.amount ? (
                <>Satya’s screening estimate is {formatMoney(recordEstimate.amount)}{recordEstimate.section ? ` under ${recordEstimate.section}` : ""}{recordEstimate.base ? ` on ${formatMoney(recordEstimate.base)} before GST` : ""} — confirm it with your CA before saving.</>
              ) : (
                <>Satya has no estimate for this payment. Enter the amount your CA confirmed — TDS is worked out on the value before GST, not on this payment total.</>
              )}
              {amountProblem && amountText ? <span className="mt-0.5 block text-[var(--sev-critical)]">{amountProblem}</span> : null}
            </p>
          </div>
          <div>
            <label htmlFor="tds-note" className={labelCls}>Note <span className="font-normal text-[var(--muted)]">(optional)</span></label>
            <input id="tds-note" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. deducted against October payment" />
          </div>
        </FieldModal>
      ) : null}

      {waive ? (
        <FieldModal
          title={`Mark not applicable — ${waive.supplier}`}
          submitLabel="Mark as not applicable"
          busy={mutation.isPending}
          onClose={() => setWaive(null)}
          onSubmit={() => mutation.mutate({ paymentId: waive.documentId, action: "waive", note: note || undefined })}
        >
          <p className="text-[15px] leading-relaxed text-[var(--muted)]">
            Records that this payment needs no TDS — for example it is below the threshold or the section doesn’t apply. The decision is saved on the payment.
          </p>
          <div>
            <label htmlFor="tds-waive-note" className={labelCls}>Why not applicable? <span className="font-normal text-[var(--muted)]">(optional)</span></label>
            <input id="tds-waive-note" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. turnover under ₹10 crore, 194Q doesn’t apply" />
          </div>
        </FieldModal>
      ) : null}
    </div>
  );
}
