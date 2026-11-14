"use client";

// Document register — every recorded bill, goods receipt, payment, QC and
// credit note, filterable by type with counts. This is what people expect
// "Invoices & documents" to show; uploads waiting for review sit in their
// own view on the same page.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { Eye, ListChecks, MessageSquare, FileText } from "lucide-react";
import { Pager } from "@/components/pages/shared/pager";
import { v2, type DocView } from "@/lib/api/v2";
import { Money, DateText, StatusBadge, ErrorState, EmptyState, FilterChips, ResponsiveTable, RowActions, TableSkeleton, type Column } from "@/components/ui/v2";
import { SearchField, ListToolbar } from "@/components/pages/shared/search-field";
import { docTypeLabel } from "@/components/pages/documents/labels";

const DocPreviewModal = dynamic(() => import("@/components/v2/doc-preview").then((m) => m.DocPreviewModal), { ssr: false });

const TYPES = [
  { value: "INVOICE_IN", label: "Supplier bills" },
  { value: "GRN", label: "Goods receipts" },
  { value: "PAYMENT_OUT", label: "Payments" },
  { value: "QC", label: "Quality checks" },
  { value: "CREDIT_NOTE_IN", label: "Credit notes" },
  { value: "DEBIT_NOTE_OUT", label: "Debit notes" },
] as const;
type TypeKey = (typeof TYPES)[number]["value"];

const PAGE_SIZE = 20;
const cursorOf = (offset: number) =>
  offset <= 0 ? "" : btoa(String(offset)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

type Row = DocView & { caseId?: string | null; payment?: { utr?: string; mode?: string } };

export function DocumentRegister() {
  const [type, setType] = useState<TypeKey>("INVOICE_IN");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setPage(1), [type, debounced]);

  const params = useMemo(
    () => ({ type, limit: String(PAGE_SIZE), ...(page > 1 ? { cursor: cursorOf((page - 1) * PAGE_SIZE) } : {}), ...(debounced ? { q: debounced } : {}) }),
    [type, page, debounced],
  );
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["doc-register", params],
    queryFn: () => v2.documents(params),
    placeholderData: (prev) => prev,
  });
  const counts = useQuery({
    queryKey: ["doc-register-counts", debounced],
    queryFn: async () => {
      const entries = await Promise.all(
        TYPES.map(async (t) => [t.value, (await v2.documents({ type: t.value, limit: "1", ...(debounced ? { q: debounced } : {}) })).total ?? 0] as const),
      );
      return Object.fromEntries(entries) as Record<TypeKey, number>;
    },
    staleTime: 60_000,
  });

  const rows = (data?.items ?? []) as Row[];
  const total = data?.total ?? 0;

  const columns: Column<Row>[] = [
    {
      key: "doc", header: "Document", primary: true, className: "min-w-[220px]",
      cell: (d) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-[var(--ink)]">{d.number || d.externalRef || "Unnumbered"}</p>
          <p className="mt-0.5 truncate text-[13px] text-[var(--muted)]">{d.seller?.name ?? docTypeLabel(d.type)}</p>
        </div>
      ),
    },
    { key: "date", header: "Date", cell: (d) => <DateText value={d.date} className="whitespace-nowrap" /> },
    // the type is already the active filter — only payments get an extra column
    ...(type === "PAYMENT_OUT"
      ? [{ key: "ref", header: "Bank reference (UTR)", cell: (d: Row) => <span className="tnum text-[14px]">{d.payment?.utr ?? "—"}</span> }]
      : []),
    {
      key: "amount", header: "Amount", align: "right",
      cell: (d) => (d.totals?.grand ? <Money value={d.totals.grand} className="font-medium text-[var(--ink)]" /> : <span className="text-[var(--muted)]">—</span>),
    },
    { key: "status", header: "Status", cell: (d) => <StatusBadge status={d.status} /> },
  ];

  return (
    <div className="space-y-4">
      <ListToolbar search={<SearchField value={query} onChange={setQuery} placeholder="Search number or supplier" />}>
        <FilterChips
          label="Document type"
          value={type}
          onChange={setType}
          options={TYPES.filter((t) => t.value === type || (counts.data?.[t.value] ?? 1) > 0).map((t) => ({ value: t.value, label: t.label, count: counts.data?.[t.value] }))}
        />
      </ListToolbar>

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={8} columns={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={debounced ? "Nothing matches your search" : `No ${TYPES.find((t) => t.value === type)?.label.toLowerCase()} yet`}
          body={debounced ? "Try another number or supplier name." : "Upload documents or import them from Tally — they appear here once recorded."}
        />
      ) : (
        <div className={isFetching ? "space-y-3 opacity-70 transition-opacity" : "space-y-3 transition-opacity"}>
          <ResponsiveTable
            caption="Recorded documents"
            columns={columns}
            rows={rows}
            rowKey={(d) => d.id}
            actions={(d) => (
              <RowActions
                label={d.number ?? "this document"}
                primary={{ label: "Preview", icon: Eye, onSelect: () => setPreview(d.id) }}
                items={[
                  { label: "Open full page", icon: FileText, href: `/app/documents/${d.id}` },
                  ...(d.caseId ? [{ label: "Open its order check", icon: ListChecks, href: `/app/investigations/${d.caseId}` }] : []),
                  { label: "Ask Satya about it", icon: MessageSquare, href: `/app/ask?about=${encodeURIComponent(`${docTypeLabel(d.type)} ${d.number ?? ""}`.trim())}` },
                ]}
              />
            )}
          />
          <Pager page={page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} pageSize={PAGE_SIZE} onPage={setPage} noun="documents" />
        </div>
      )}
      {preview ? <DocPreviewModal documentId={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}
