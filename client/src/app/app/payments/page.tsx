"use client";

// Payments (/app/payments) — allocation workbench per 06 §5.9.
// Live rows from GET /api/v2/payments (search + status + sort + numbered
// paging server-side, scoped to the active entity). "Resolve" opens the
// allocation sheet: engine subset-sum options or hand-picked invoices →
// reason → POST /payments/:id/allocate with expectedRevision.
// Bank CSV → column-mapped /import/bank-csv.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  UploadCloud, X, CheckCircle2, Search, ChevronLeft, ChevronRight, ArrowDownUp, Landmark,
  CircleCheck, CircleDot, CircleDashed, CircleHelp, CircleAlert, Wallet, Loader2, type LucideIcon,
} from "lucide-react";
import { v2 } from "@/lib/api/v2";
import { mocksEnabled } from "@/lib/flags";
import { useSession } from "@/components/v2/session";
import { Money, DateText, ErrorState, EmptyState, PageHeader, FadeIn, Card, Btn } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { AllocationSheet } from "@/components/pages/payments/allocation-sheet";
import { cn } from "@/lib/utils";

/* ---------- row normalization — mock + live shapes ---------- */
type Row = {
  id: string; amount?: string | { amount: string; currency: string }; utr?: string; date?: string;
  counterparty?: string; supplier?: string; status?: string; allocatedTotal?: string; mode?: string; number?: string | null;
};
const amt = (r: Row): string => (typeof r.amount === "string" ? r.amount : r.amount?.amount ?? "");
const who = (r: Row): string => r.counterparty || r.supplier || "Counterparty not recorded";

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: LucideIcon }> = {
  allocated: { label: "Fully allocated", color: "var(--confirmed)", bg: "var(--confirmed-soft)", icon: CircleCheck },
  linked: { label: "Linked", color: "var(--confirmed)", bg: "var(--confirmed-soft)", icon: CircleCheck },
  partial: { label: "Part allocated", color: "var(--likely)", bg: "var(--likely-soft)", icon: CircleDot },
  unallocated: { label: "Not allocated", color: "var(--possible)", bg: "var(--possible-soft)", icon: CircleAlert },
  needs_evidence: { label: "Needs evidence", color: "var(--missing)", bg: "var(--missing-soft)", icon: CircleDashed },
  not_linked: { label: "Not linked", color: "var(--missing)", bg: "var(--missing-soft)", icon: CircleDashed },
  unclear: { label: "Needs your call", color: "var(--unclear)", bg: "var(--unclear-soft)", icon: CircleHelp },
};
const STATUS_FILTERS = [
  ["", "All"], ["needs_evidence", "Needs evidence"], ["unallocated", "Not allocated"],
  ["partial", "Part allocated"], ["allocated", "Fully allocated"],
];
const OPEN_STATUSES = new Set(["unallocated", "partial", "needs_evidence", "unclear", "not_linked"]);
const SORTS = [["date_desc", "Newest first"], ["date_asc", "Oldest first"], ["amount_desc", "Largest first"], ["amount_asc", "Smallest first"]];
const PAGE_SIZE = 10;

function StatusPill({ status }: { status?: string }) {
  const meta = STATUS_META[status || ""] ?? STATUS_META.not_linked;
  const Icon = meta.icon;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[13px] font-medium leading-none"
      style={{ color: meta.color, background: meta.bg, borderColor: `color-mix(in srgb, ${meta.color} 32%, transparent)` }}
    >
      <Icon size={12} aria-hidden="true" /> {meta.label}
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

  const FIELD_LABEL: Record<string, string> = { date: "Date", utr: "UTR / reference", amount: "Amount", payeeName: "Payee", mode: "Mode" };

  return (
    <Card className="rise">
      <div className="flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]"><Landmark size={15} aria-hidden="true" /> Import a bank statement</h2>
        <button type="button" onClick={onDone} aria-label="Close bank statement import" className="rounded-[var(--radius-sm)] p-1 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60">
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      {stage === "pick" && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="mt-3 flex w-full flex-col items-center rounded-[var(--radius-sm)] border-2 border-dashed border-[var(--line-strong)] px-4 py-8 text-sm text-[var(--muted)] transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60"
        >
          <UploadCloud size={20} className="text-[var(--accent)]" aria-hidden="true" />
          <span className="mt-2">Choose a bank statement CSV — up to 2 MB</span>
        </button>
      )}
      {stage === "map" && (
        <div className="mt-3 space-y-3">
          <p className="text-sm leading-relaxed text-[var(--muted)]"><span className="tnum">{rows.length}</span> rows found. Tell Satya which columns mean what — unreadable rows are reported, never silently dropped.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            {(["date", "utr", "amount", "payeeName", "mode"] as const).map((field) => (
              <label key={field} className="text-xs text-[var(--muted)]">
                {FIELD_LABEL[field]}{field === "date" || field === "utr" || field === "amount" ? " *" : ""}
                <select
                  value={mapping[field]}
                  onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                  className="mt-1 h-10 w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]"
                >
                  <option value="">— skip —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <Btn size="sm" onClick={submit} icon={busy ? Loader2 : undefined} disabled={busy || !mapping.date || !mapping.utr || !mapping.amount}>
            {busy ? "Importing…" : `Import ${rows.length} rows`}
          </Btn>
        </div>
      )}
      {stage === "result" && result && (
        <p className="mt-3 flex items-start gap-2 text-sm text-[var(--ink-2)]" role="status">
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

function ListSkeleton() {
  return (
    <ul className="space-y-2" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5">
          <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-2/5" /><Skeleton className="h-3 w-1/3" /></div>
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="hidden h-8 w-20 sm:block" />
        </li>
      ))}
    </ul>
  );
}

/* ---------- page ---------- */
export default function PaymentsPage() {
  const { activeEntity } = useSession();
  const entityId = activeEntity?.id ?? "";
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
  useEffect(() => setPage(1), [debounced, status, sort, entityId]);

  const mocks = mocksEnabled();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["payments", entityId, { q: debounced, status, sort, page }],
    queryFn: () => v2.payments({ q: debounced, status, sort, page: String(page), pageSize: String(PAGE_SIZE), ...(entityId ? { entityId } : {}) }),
    placeholderData: (prev) => prev,
  });
  const items = useMemo(() => (data?.items ?? []) as Row[], [data]);
  const total = (data as { total?: number })?.total ?? items.length;
  const pages = (data as { pages?: number })?.pages ?? 1;
  const windowStart = Math.max(1, Math.min(page - 2, pages - 4));
  const pageNumbers = Array.from({ length: Math.min(5, pages) }, (_, i) => windowStart + i);

  return (
    <FadeIn className="space-y-5">
      <PageHeader
        title="Payments"
        description="Money that left your bank, matched to the bills it paid. When a payment could belong to more than one bill, it waits for you to decide."
        actions={<Btn variant="secondary" icon={UploadCloud} onClick={() => setImporting((v) => !v)} aria-expanded={importing}>Import bank CSV</Btn>}
      />

      {importing ? (
        mocks
          ? <Card><p className="text-sm text-[var(--muted)]">Demo mode — bank import is disabled.</p></Card>
          : <ImportCsv entityId={entityId} onDone={() => { void queryClient.invalidateQueries({ queryKey: ["payments"] }); setImporting(false); }} />
      ) : null}

      {/* filter bar */}
      <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:items-center">
        <div className="relative md:w-64">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
          <input
            type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search supplier, UTR, number…" aria-label="Search payments"
            className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] pl-9 pr-3 text-sm text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
          />
        </div>
        <div className="-mx-1 overflow-x-auto px-1">
          <div role="group" aria-label="Filter by status" className="flex w-max items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] p-1">
            {STATUS_FILTERS.map(([value, label]) => (
              <button
                key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)}
                className={cn(
                  "whitespace-nowrap rounded-[calc(var(--radius-sm)-3px)] px-3 py-1.5 text-[14px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60",
                  status === value ? "bg-[var(--ink)] text-[var(--paper)]" : "text-[var(--ink-2)] hover:text-[var(--ink)]",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5 md:ml-auto">
          <ArrowDownUp size={13} className="text-[var(--muted)]" aria-hidden="true" />
          <select
            value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort payments"
            className="h-10 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-2 text-sm text-[var(--ink-2)] outline-none transition-colors focus:border-[var(--accent)]"
          >
            {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : isLoading ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        debounced || status ? (
          <EmptyState icon={Search} title="No payments match these filters" body="Try a different search or status." actionLabel="Clear filters" onAction={() => { setQuery(""); setStatus(""); }} />
        ) : (
          <EmptyState icon={Wallet} title="No payments yet" body="Import a bank statement CSV to bring in transfers, then link each one to the invoices it paid." actionLabel="Import bank CSV" onAction={() => setImporting(true)} />
        )
      ) : (
        <>
          <ul className={cn("rise-stagger space-y-2 transition-opacity", isFetching && "opacity-70")} aria-busy={isFetching}>
            {items.map((payment) => {
              const open = OPEN_STATUSES.has(payment.status || "");
              return (
                <li key={payment.id}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-[var(--ink)]">
                        <Money value={amt(payment)} className="font-semibold" />
                        <span className="truncate text-[var(--ink-2)]">{who(payment)}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {payment.date ? <DateText value={payment.date} /> : "No date"}
                        {payment.utr ? <> · UTR <span className="font-code">{payment.utr}</span></> : " · no bank reference"}
                        {payment.mode ? <> · {payment.mode}</> : ""}
                        {payment.status === "partial" && payment.allocatedTotal ? <> · <Money value={payment.allocatedTotal} /> allocated</> : ""}
                      </p>
                    </div>
                    <StatusPill status={payment.status} />
                    {open ? (
                      <Btn size="sm" variant="outline" onClick={() => setWorkbench(payment.id)} aria-label={`Resolve payment of ${amt(payment)} to ${who(payment)}`}>
                        Resolve
                      </Btn>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          <nav className="flex flex-wrap items-center justify-between gap-3 pt-1" aria-label="Payments pages">
            <p className="text-xs text-[var(--muted)]">
              Showing <span className="tnum">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}</span> of <span className="tnum">{total}</span>
            </p>
            {pages > 1 ? (
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} aria-label="Previous page"
                  className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] border border-[var(--line)] text-[var(--ink-2)] transition-colors hover:border-[var(--accent)]/50 disabled:opacity-40">
                  <ChevronLeft size={14} aria-hidden="true" />
                </button>
                {pageNumbers.map((n) => (
                  <button key={n} type="button" onClick={() => setPage(n)} aria-current={n === page ? "page" : undefined} aria-label={`Page ${n}`}
                    className={cn("tnum h-8 min-w-8 rounded-[var(--radius-sm)] border px-2 text-xs font-medium transition-colors",
                      n === page ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]" : "border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--accent)]/50")}>
                    {n}
                  </button>
                ))}
                <button type="button" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages} aria-label="Next page"
                  className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] border border-[var(--line)] text-[var(--ink-2)] transition-colors hover:border-[var(--accent)]/50 disabled:opacity-40">
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </nav>
        </>
      )}

      <AllocationSheet paymentId={workbench} onClose={() => setWorkbench(null)} />
    </FadeIn>
  );
}
