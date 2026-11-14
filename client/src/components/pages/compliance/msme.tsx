"use client";

// MSME 45-day check: unpaid bills from micro and small suppliers, ranked by
// how close they are to the legal deadline. A bill with an open dispute is
// "On hold — resolve dispute" and its one action is "Review issue" (the case)
// — never "Record payment". Partly disputed bills offer paying only the
// undisputed part, from the overflow menu.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Eye, Mail, Landmark, MessageSquare, PauseCircle, Send, Download, CircleCheck } from "lucide-react";
import {
  Money, RelativeDue, StatusChip, ResponsiveTable, RowActions, FilterChips, InfoPanel, InfoList, EmptyState,
  ErrorState, TableSkeleton, Btn, type Column, type StatusTone,
} from "@/components/ui/v2";
import { formatDate, formatMoney, toPaise } from "@/lib/format";
import { findingTitle, plural } from "@/lib/humanize";
import {
  useSection, ReminderModal, reminderBody, BulkReminderDialog, TableToolbar, matches, exportCsv, csvMoney,
  type MoneyVal, type ReminderDraft,
} from "./shared";

type Finding = { id: string; code: string; severity: string; caseId: string | null };
export type MsmeRow = {
  documentId: string; invoice: string; date: string; supplier: string; supplierId?: string | null;
  category?: string | null; supplierEmail?: string | null;
  amount: MoneyVal; paidSoFar: MoneyVal; outstanding: MoneyVal; amountRecorded: boolean;
  agreedDays: number; legalDays?: number; dueDate: string; daysLeft: number; status: "overdue" | "due_soon" | "upcoming"; note: string;
  disputed?: MoneyVal; payable?: MoneyVal | null; onHold?: boolean; holdKind?: "full" | "partial" | null;
  caseId?: string | null; findings?: Finding[]; interestEstimate?: MoneyVal | null;
};

type Filter = "all" | "overdue" | "soon" | "upcoming" | "hold";

const bucket = (r: MsmeRow): Exclude<Filter, "all"> =>
  r.onHold ? "hold" : r.status === "overdue" ? "overdue" : r.status === "due_soon" ? "soon" : "upcoming";

const CATEGORY: Record<string, string> = { micro: "Micro", small: "Small", recorded: "Recorded as MSME", unverified: "Not verified" };

function statusOf(r: MsmeRow): { tone: StatusTone; label: string; icon?: typeof PauseCircle } {
  if (r.onHold) return { tone: "warn", label: "On hold — resolve dispute", icon: PauseCircle };
  if (r.status === "overdue") return { tone: "critical", label: "Overdue" };
  if (r.status === "due_soon") return { tone: "warn", label: "Due soon" };
  return { tone: "neutral", label: "Upcoming" };
}

const holdReason = (r: MsmeRow) => {
  const codes = (r.findings ?? []).map((f) => f.code);
  const main = codes.find((c) => c.startsWith("DUP")) ?? codes[0];
  return main ? findingTitle(main) : "Open dispute";
};

export function MsmePanel({ onView }: { onView: (id: string) => void }) {
  const { data, isLoading, error, refetch } = useSection("msme");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [remind, setRemind] = useState<MsmeRow | null>(null);
  const [bulk, setBulk] = useState<ReminderDraft[] | null>(null);

  const items = useMemo(() => ((data?.items ?? []) as MsmeRow[]), [data]);
  const counts = useMemo(() => {
    const c = { overdue: 0, soon: 0, upcoming: 0, hold: 0 };
    for (const r of items) c[bucket(r)] += 1;
    return c;
  }, [items]);
  const rows = items.filter((r) => (filter === "all" || bucket(r) === filter) && matches(q, r.invoice, r.supplier));

  const draftFor = (r: MsmeRow): ReminderDraft => ({
    key: `msme:${r.documentId}`, invoice: r.invoice, supplier: r.supplier, supplierId: r.supplierId, caseId: r.caseId, email: r.supplierEmail,
    subject: `Payment status — invoice ${r.invoice}`,
    body: reminderBody(r.invoice, `Our records show it is still unpaid and the MSME payment deadline is ${r.daysLeft < 0 ? `overdue by ${plural(-r.daysLeft, "day")}` : `${formatDate(r.dueDate)}`}. If you have already been paid, please share the payment reference so we can update our records.`),
  });

  const doExport = (list: MsmeRow[]) => exportCsv("msme-45-day", [
    "Invoice", "Invoice date", "Supplier", "MSME type", "Outstanding", "On hold", "Payable now", "Deadline", "Days left", "Status", "Interest estimate",
  ], list.map((r) => [
    r.invoice, r.date, r.supplier, CATEGORY[r.category ?? ""] ?? r.category ?? "", csvMoney(r.outstanding), csvMoney(r.disputed),
    csvMoney(r.onHold ? r.payable : r.outstanding), r.dueDate, r.daysLeft, statusOf(r).label, csvMoney(r.interestEstimate),
  ]));

  const columns: Column<MsmeRow>[] = [
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
    { key: "type", header: "Type", mobileLabel: "MSME type", cell: (r) => CATEGORY[r.category ?? ""] ?? "—" },
    {
      key: "amount", header: "Amount", align: "right", mobileLabel: "Unpaid",
      cell: (r) => r.amountRecorded ? (
        <span className="inline-flex flex-col items-end leading-snug">
          <Money value={r.outstanding} className="font-medium text-[var(--ink)]" />
          {r.holdKind === "partial" && r.payable ? <span className="text-[13px] text-[var(--muted)]">{formatMoney(r.payable)} payable</span> : null}
        </span>
      ) : <span className="text-[var(--muted)]">Not recorded</span>,
    },
    { key: "deadline", header: "Deadline", cell: (r) => <RelativeDue daysLeft={r.daysLeft} date={r.dueDate} /> },
    {
      key: "status", header: "Status",
      cell: (r) => {
        const s = statusOf(r);
        if (!r.onHold) return <StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip>;
        return (
          <span className="inline-flex flex-col items-start gap-1">
            <StatusChip tone="warn" icon={PauseCircle} title={`${holdReason(r)} · ${formatMoney(r.disputed)} disputed`}>On hold</StatusChip>
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

  const actions = (r: MsmeRow) => {
    const view = { label: "View invoice", icon: Eye, onSelect: () => onView(r.documentId) };
    const ask = { label: "Ask Satya about this", icon: MessageSquare, href: `/app/ask?about=${encodeURIComponent(`MSME deadline for invoice ${r.invoice}`)}` };
    if (r.onHold) {
      const pay = r.holdKind === "partial" && r.payable ? [{ label: `Pay only the undisputed ${formatMoney(r.payable)}`, icon: Landmark, href: "/app/payments" }] : [];
      return (
        <RowActions
          label={r.invoice}
          primary={{ label: "Review issue", href: r.caseId ? `/app/investigations/${r.caseId}` : "/app/investigations" }}
          items={[...pay, view, ask]}
        />
      );
    }
    return (
      <RowActions
        label={r.invoice}
        primary={{ label: "Record payment", href: "/app/payments" }}
        items={[{ label: "Send reminder", icon: Mail, onSelect: () => setRemind(r) }, view, ask]}
      />
    );
  };

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Could not load"} onRetry={() => refetch()} />;

  return (
    <div className="space-y-5">
      <InfoPanel storageKey="compliance.msme" summary="Pay micro and small suppliers within 45 days of accepting the goods.">
        <InfoList
          items={[
            { label: "The rule", value: "Micro and small enterprises must be paid within the credit period you agreed in writing — never more than 45 days from the day you accepted the goods, and 15 days if nothing was agreed." },
            { label: "If it’s missed", value: "Compound interest at three times the RBI bank rate runs from the due date, and the expense can’t be deducted from income tax until the year you actually pay." },
            { label: "How Satya checks", value: "The clock starts when the goods were accepted (goods receipt or quality check), or the invoice date if no acceptance is recorded. Paid bills drop off. A bill with an open dispute is shown on hold — resolve the dispute first; the legal clock keeps running." },
            { label: "Interest estimate", value: "Worked out at three times the RBI bank rate, compounded monthly, on the unpaid amount — an estimate, not a demand." },
            { label: "Law", value: "MSMED Act 2006, sections 15–16 · Income-tax Act, section 43B(h)" },
          ]}
        />
        <p className="mt-4 text-[14px] text-[var(--muted)]">
          Screening, not tax advice — confirm positions with your CA.{" "}
          <Link href={`/app/ask?about=${encodeURIComponent("MSME 45-day payment rule")}`} className="font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">Ask Satya to explain</Link>
        </p>
      </InfoPanel>

      {isLoading || !data ? (
        <TableSkeleton rows={5} columns={7} />
      ) : (
        <div>
          <TableToolbar
            filters={
              <FilterChips<Filter>
                label="Filter MSME bills"
                value={filter}
                onChange={(v) => { setFilter(v); setSelected(new Set()); }}
                options={[
                  { value: "all", label: "All", count: items.length },
                  { value: "overdue", label: "Overdue", count: counts.overdue, tone: "critical" },
                  { value: "soon", label: "Due in 7 days", count: counts.soon, tone: "warn" },
                  { value: "upcoming", label: "Upcoming", count: counts.upcoming },
                  { value: "hold", label: "On hold", count: counts.hold, tone: "warn" },
                ]}
              />
            }
            search={q}
            onSearch={setQ}
            onExport={() => doExport(rows)}
            selectedCount={selected.size}
            onClearSelection={() => setSelected(new Set())}
            bulk={
              <>
                <Btn size="sm" icon={Send} onClick={() => setBulk(items.filter((r) => selected.has(r.documentId)).map(draftFor))}>Send reminders</Btn>
                <Btn size="sm" variant="secondary" icon={Download} onClick={() => doExport(items.filter((r) => selected.has(r.documentId)))}>Export</Btn>
              </>
            }
          />
          <ResponsiveTable
            caption="Unpaid bills from micro and small suppliers"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.documentId}
            actions={actions}
            rowAccent={(r) => (r.onHold ? null : r.status === "overdue" ? "critical" : null)}
            selection={{
              selected,
              onChange: setSelected,
              isSelectable: (r) => !r.onHold,
              rowLabel: (r) => `Select ${r.invoice}${r.onHold ? " (on hold — reminders paused)" : ""}`,
            }}
            empty={
              items.length === 0 ? (
                <EmptyState compact tone="ok" icon={CircleCheck} title="No unpaid MSME bills" body="Nothing is owed to micro or small suppliers right now. New MSME bills show up here with their 45-day deadline." />
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
          subject={`Payment status — invoice ${remind.invoice}`}
          email={remind.supplierEmail}
          body={draftFor(remind).body}
          onClose={() => setRemind(null)}
        />
      ) : null}
      {bulk ? <BulkReminderDialog drafts={bulk} onClose={() => setBulk(null)} onDone={() => { setBulk(null); setSelected(new Set()); }} /> : null}
    </div>
  );
}
