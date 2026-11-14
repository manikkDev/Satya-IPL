"use client";

// Payments (/app/payments) — "Which money left the bank without a bill to
// show for it?" Unmatched money is surfaced first with a one-click way into
// the allocation sheet (engine exact-sum options or hand-picked bills →
// reason → POST /payments/:id/allocate with expectedRevision). Status chips
// carry counts; the table keeps money right-aligned. Bank CSV →
// column-mapped /import/bank-csv.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  UploadCloud, X, CheckCircle2, Search, Landmark, Link2, Building2, Eye, MessageSquare,
  CircleCheck, CircleDot, CircleDashed, CircleHelp, CircleAlert, Wallet, Loader2, type LucideIcon,
} from "lucide-react";
import { Pager } from "@/components/pages/shared/pager";
import { v2 } from "@/lib/api/v2";
import { mocksEnabled } from "@/lib/flags";
import { useSession } from "@/components/v2/session";
import { Money, DateText, ErrorState, EmptyState, PageHeader, FadeIn, Card, Btn, Callout, FilterChips, ResponsiveTable, RowActions, TableSkeleton, type Column } from "@/components/ui/v2";
import { AllocationSheet } from "@/components/pages/payments/allocation-sheet";
import { SearchField, ListToolbar } from "@/components/pages/shared/search-field";
import { fromPaise, sumMoney, toPaise } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ---------- row normalization — mock + live shapes ---------- */
type Row = {
  id: string; amount?: string | { amount: string; currency: string }; utr?: string; date?: string;
  counterparty?: string; supplier?: string; status?: string; allocatedTotal?: string; mode?: string; number?: string | null;
  supplierId?: string | null;
};
const amt = (r: Row): string => (typeof r.amount === "string" ? r.amount : r.amount?.amount ?? "");
const who = (r: Row): string => r.counterparty || r.supplier || "Counterparty not recorded";

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: LucideIcon }> = {
  allocated: { label: "Matched", color: "var(--confirmed)", bg: "var(--confirmed-soft)", icon: CircleCheck },
  linked: { label: "Matched", color: "var(--confirmed)", bg: "var(--confirmed-soft)", icon: CircleCheck },
  partial: { label: "Part matched", color: "var(--likely)", bg: "var(--likely-soft)", icon: CircleDot },
  unallocated: { label: "Not matched", color: "var(--possible)", bg: "var(--possible-soft)", icon: CircleAlert },
  needs_evidence: { label: "Needs evidence", color: "var(--missing)", bg: "var(--missing-soft)", icon: CircleDashed },
  not_linked: { label: "Not linked", color: "var(--missing)", bg: "var(--missing-soft)", icon: CircleDashed },
  unclear: { label: "Needs your call", color: "var(--unclear)", bg: "var(--unclear-soft)", icon: CircleHelp },
};
const OPEN_STATUSES = new Set(["unallocated", "partial", "needs_evidence", "unclear", "not_linked"]);
const SORTS = [["date_desc", "Newest first"], ["date_asc", "Oldest first"], ["amount_desc", "Largest first"], ["amount_asc", "Smallest first"]];
const PAGE_SIZE = 15;

function StatusPill({ status }: { status?: string }) {
  const meta = STATUS_META[status || ""] ?? STATUS_META.not_linked;
  const Icon = meta.icon;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[13px] font-medium leading-none"
      style={{ color: meta.color, background: meta.bg, borderColor: `color-mix(in srgb, ${meta.color} 32%, transparent)` }}
    >
      <Icon size={14} aria-hidden="true" /> {meta.label}
    </span>
  );
}

/* ---------- tiny CSV parser (quoted fields, embedded commas) ---------- */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim()); cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

/* ---------- bank CSV import ---------- */
function ImportCsv({ entityId, onDone }: { entityId: string; onDone: () => void }) {
  const [stage, setStage] = useState<"pick" | "map" | "result">("pick");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({ date: "", utr: "", amount: "", payeeName: "", mode: "" });
  const [result, setResult] = useState<{ created: number; deduped: number; errors: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const guess = (h: string[], want: string) => h.find((x) => x.toLowerCase().includes(want)) ?? "";

  const parseFile = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      toast.error("That file is over 2 MB — split the statement by month and import each part.");
      return;
    }
    const table = parseCsv(await file.text());
    if (table.length < 2) {
      toast.error("No rows found — is this a CSV with a header row?");
      return;
    }
    const heads = table[0];
    const data = table.slice(1).map((cells) => Object.fromEntries(heads.map((h, i) => [h, cells[i] ?? ""])));
    setHeaders(heads);
    setRows(data);
    setMapping({
      date: guess(heads, "date") || heads[0],
      utr: guess(heads, "utr") || guess(heads, "ref"),
      amount: guess(heads, "amount") || guess(heads, "debit"),
      payeeName: guess(heads, "payee") || guess(heads, "name") || guess(heads, "narr"),
      mode: guess(heads, "mode"),
    });
    setStage("map");
  };

  const submit = async () => {
    setBusy(true);
    try {
      const r = await v2.importBankCsv(entityId, mapping, rows);
      setResult({ created: r.created, deduped: r.deduped, errors: r.errors });
      setStage("result");
      toast.success(`${r.created} payment${r.created === 1 ? "" : "s"} imported`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const FIELD_LABEL: Record<string, string> = { date: "Date", utr: "Bank reference (UTR)", amount: "Amount", payeeName: "Paid to", mode: "Mode" };

  return (
    <Card className="rise">
      <div className="flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold text-[var(--ink)]"><Landmark size={18} className="text-[var(--muted)]" aria-hidden="true" /> Import a bank statement</h2>
        <button type="button" onClick={onDone} aria-label="Close bank statement import" className="rounded-[var(--radius-sm)] p-1 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60">
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      {stage === "pick" && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="mt-4 flex w-full flex-col items-center rounded-[var(--radius-sm)] border-2 border-dashed border-[var(--line-strong)] px-4 py-8 text-[15px] text-[var(--muted)] transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60"
        >
          <UploadCloud size={20} className="text-[var(--accent)]" aria-hidden="true" />
          <span className="mt-2">Choose your bank’s statement export (CSV, up to 2 MB)</span>
        </button>
      )}
      {stage === "map" && (
        <div className="mt-3 space-y-3">
          <p className="text-[15px] leading-relaxed text-[var(--ink-2)]"><span className="tnum font-medium">{rows.length}</span> rows found. Tell Satya which column is which — rows it can’t read are reported, never silently dropped.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            {(["date", "utr", "amount", "payeeName", "mode"] as const).map((field) => (
              <label key={field} className="text-[14px] font-medium text-[var(--ink-2)]">
                {FIELD_LABEL[field]}{field === "date" || field === "utr" || field === "amount" ? " *" : ""}
                <select
                  value={mapping[field]}
                  onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                  className="mt-1.5 h-10 w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-2 text-[15px] text-[var(--ink)] outline-none focus:border-[var(--accent)]"
                >
                  <option value="">— skip —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <Btn onClick={submit} icon={busy ? Loader2 : undefined} disabled={busy || !mapping.date || !mapping.utr || !mapping.amount}>
            {busy ? "Importing…" : `Import ${rows.length} rows`}
          </Btn>
        </div>
      )}
      {stage === "result" && result && (
        <p className="mt-3 flex items-start gap-2 text-[15px] text-[var(--ink-2)]" role="status">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[var(--confirmed)]" aria-hidden="true" />
          <span>
            {result.created} payment{result.created === 1 ? "" : "s"} imported
            {result.deduped ? `, ${result.deduped} duplicate${result.deduped === 1 ? "" : "s"} skipped (same UTR)` : ""}
            {result.errors ? `, ${result.errors} row${result.errors === 1 ? "" : "s"} couldn’t be read` : ""}.
          </span>
        </p>
      )}
      <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { if (e.target.files?.[0]) void parseFile(e.target.files[0]); e.target.value = ""; }} />
    </Card>
  );
}

/* ---------- page ---------- */
type FilterKey = "" | "unallocated" | "partial" | "needs_evidence" | "unclear" | "allocated";
const FILTERS: { value: FilterKey; label: string; tone?: "warn" | "critical"; always?: boolean }[] = [
  { value: "unallocated", label: "Not matched", tone: "warn", always: true },
  { value: "partial", label: "Part matched", tone: "warn" },
  { value: "needs_evidence", label: "Needs evidence", tone: "warn" },
  { value: "unclear", label: "Needs your call", tone: "warn" },
  { value: "allocated", label: "Matched", always: true },
  { value: "", label: "All", always: true },
];

export default function PaymentsPage() {
  const { activeEntity } = useSession();
  const entityId = activeEntity?.id ?? "";
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState<FilterKey | null>(null);
  const [sort, setSort] = useState("date_desc");
  const [page, setPage] = useState(1);
  const [workbench, setWorkbench] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setPage(1), [debounced, status, sort, entityId]);

  const mocks = mocksEnabled();
  const scope: Record<string, string> = entityId ? { entityId } : {};

  // Unmatched money: every open payment (the list API caps at 500 rows).
  const open = useQuery({
    queryKey: ["payments", entityId, "open-summary"],
    queryFn: async () => {
      const pages = await Promise.all(
        [...OPEN_STATUSES].map((s) => v2.payments({ status: s, pageSize: "50", ...scope }).catch(() => ({ items: [], total: 0 }))),
      );
      const rows = pages.flatMap((p) => (p.items ?? []) as Row[]);
      const left = sumMoney(rows.map((r) => fromPaise(toPaise(amt(r)) - toPaise(r.allocatedTotal ?? "0"))));
      return { rows, left, total: pages.reduce((n, p) => n + ((p as { total?: number }).total ?? 0), 0) };
    },
    staleTime: 30_000,
  });
  const counts = useQuery({
    queryKey: ["payments", entityId, "counts", debounced],
    queryFn: async () => {
      const entries = await Promise.all(
        FILTERS.map(async (f) => {
          const r = (await v2.payments({ status: f.value, q: debounced, pageSize: "1", ...scope })) as { total?: number };
          return [f.value, r.total ?? 0] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<FilterKey, number>;
    },
    staleTime: 30_000,
  });
  const activeStatus: FilterKey = status ?? ((counts.data?.unallocated ?? 0) > 0 ? "unallocated" : "");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["payments", entityId, { q: debounced, status: activeStatus, sort, page }],
    queryFn: () => v2.payments({ q: debounced, status: activeStatus, sort, page: String(page), pageSize: String(PAGE_SIZE), ...scope }),
    placeholderData: (prev) => prev,
    enabled: status !== null || counts.isFetched || mocks,
  });
  const items = useMemo(() => (data?.items ?? []) as Row[], [data]);
  const total = (data as { total?: number })?.total ?? items.length;
  const pages = (data as { pages?: number })?.pages ?? 1;
  const filtered = !!debounced || activeStatus !== "";

  const columns: Column<Row>[] = [
    {
      key: "who", header: "Paid to", primary: true, className: "min-w-[220px]",
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-[var(--ink)]">{who(r)}</p>
          <p className="mt-0.5 truncate text-[13px] text-[var(--muted)] tnum">{r.utr ? `UTR ${r.utr}` : "No bank reference"}{r.mode ? ` · ${r.mode}` : ""}</p>
        </div>
      ),
    },
    { key: "date", header: "Date", cell: (r) => (r.date ? <DateText value={r.date} className="whitespace-nowrap" /> : <span className="text-[var(--muted)]">—</span>) },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <Money value={amt(r)} className="font-semibold text-[var(--ink)]" /> },
    {
      key: "left", header: "Not yet matched", align: "right",
      cell: (r) => {
        const left = toPaise(amt(r)) - toPaise(r.allocatedTotal ?? "0");
        return left > BigInt(0) ? <Money value={fromPaise(left)} className="font-medium text-[var(--sev-high)]" /> : <span className="text-[var(--muted)]">—</span>;
      },
    },
    { key: "status", header: "Status", cell: (r) => <StatusPill status={r.status} /> },
  ];

  const unmatchedCount = open.data?.total ?? 0;
  const oldestOpen = [...(open.data?.rows ?? [])].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")))[0];

  return (
    <FadeIn className="space-y-6">
      <PageHeader
        title="Payments"
        description="Money that left your bank, and the bills it paid. Anything not matched to a bill waits here for you."
        actions={<Btn variant="secondary" icon={UploadCloud} onClick={() => setImporting((v) => !v)} aria-expanded={importing}>Import bank statement</Btn>}
      />

      {importing ? (
        mocks
          ? <Card><p className="text-[15px] text-[var(--muted)]">Demo mode — bank import is disabled.</p></Card>
          : <ImportCsv entityId={entityId} onDone={() => { void queryClient.invalidateQueries({ queryKey: ["payments"] }); setImporting(false); }} />
      ) : null}

      {/* unmatched money — the one thing this page exists to resolve */}
      {open.data && unmatchedCount > 0 ? (
        <section aria-labelledby="unmatched-title" className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)] sm:p-6" style={{ boxShadow: "inset 3px 0 0 var(--sev-medium), var(--shadow-1)" }}>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[13px] font-semibold text-[var(--sev-medium)]">Unmatched money</p>
              <h2 id="unmatched-title" className="mt-1 text-[21px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
                <Money value={open.data.left} /> paid out but not linked to a bill
              </h2>
              <p className="mt-1 text-[15px] text-[var(--ink-2)]">
                {unmatchedCount === 1 ? "1 payment" : `${unmatchedCount} payments`}. Until each is matched, the supplier’s balance and any duplicate-payment checks can’t be trusted.
              </p>
            </div>
            {oldestOpen ? (
              <Btn className="shrink-0" icon={Link2} onClick={() => setWorkbench(oldestOpen.id)}>
                Match {unmatchedCount > 1 ? "the oldest" : "it"} now
              </Btn>
            ) : null}
          </div>
        </section>
      ) : open.data && !open.isFetching && !mocks ? (
        <Callout tone="success" title="Every payment is matched to a bill">
          <p className="text-[15px]">Import your latest bank statement to keep it that way.</p>
        </Callout>
      ) : null}

      <ListToolbar
        search={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort payments"
              className="h-10 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-[15px] text-[var(--ink-2)] outline-none focus:border-[var(--accent)]"
            >
              {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <SearchField value={query} onChange={setQuery} placeholder="Search supplier, UTR or number" className="sm:w-64" />
          </div>
        }
      >
        <FilterChips
          label="Filter payments"
          value={activeStatus}
          onChange={(v) => setStatus(v)}
          options={FILTERS.filter((f) => f.always || f.value === activeStatus || (counts.data?.[f.value] ?? 0) > 0).map((f) => ({
            value: f.value, label: f.label, count: counts.data?.[f.value], tone: f.tone,
          }))}
        />
      </ListToolbar>

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : isLoading || (!data && !mocks) ? (
        <TableSkeleton rows={6} columns={7} />
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState icon={Search} title={debounced ? "No payments match your search" : "Nothing in this group"} body="Try another search, or pick a different filter above." actionLabel="Show all payments" onAction={() => { setQuery(""); setStatus(""); }} />
        ) : (
          <EmptyState icon={Wallet} title="No payments yet" body="Import a bank statement to bring in transfers. Satya matches each one to the bills it paid and asks you about the rest." actionLabel="Import bank statement" onAction={() => setImporting(true)} />
        )
      ) : (
        <div className={cn("space-y-3 transition-opacity", isFetching && "opacity-70")} aria-busy={isFetching}>
          <ResponsiveTable
            caption="Payments"
            columns={columns}
            rows={items}
            rowKey={(r) => r.id}
            rowAccent={(r) => (OPEN_STATUSES.has(r.status || "") ? "warn" : null)}
            actions={(r) => {
              const isOpen = OPEN_STATUSES.has(r.status || "");
              return (
                <RowActions
                  label={`payment to ${who(r)}`}
                  primary={isOpen ? <Btn size="sm" onClick={() => setWorkbench(r.id)}>Match to bills</Btn> : null}
                  items={[
                    ...(r.supplierId ? [{ label: "Open the supplier", icon: Building2, href: `/app/suppliers/${r.supplierId}` }] : []),
                    { label: "Preview the payment", icon: Eye, href: `/app/documents/${r.id}` },
                    { label: "Ask Satya about it", icon: MessageSquare, href: `/app/ask?about=${encodeURIComponent(`payment ${r.utr ?? r.number ?? ""} to ${who(r)}`)}` },
                  ]}
                />
              );
            }}
          />
          <Pager page={page} pages={pages} total={total} pageSize={PAGE_SIZE} onPage={setPage} noun={total === 1 ? "payment" : "payments"} />
        </div>
      )}

      <AllocationSheet paymentId={workbench} onClose={() => setWorkbench(null)} />
    </FadeIn>
  );
}
