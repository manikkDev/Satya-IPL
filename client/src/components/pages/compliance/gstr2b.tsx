"use client";

// GSTR-2B match: bills in your books vs what suppliers reported to GST.
// Import the GSTR-2B JSON for an exact match; without it the list is
// "suspected" gaps from open issues (said plainly, once).

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, FileUp, Loader2, Send, Download, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import { v2 } from "@/lib/api/v2";
import { mocksEnabled } from "@/lib/flags";
import { useSession } from "@/components/v2/session";
import {
  Money, StatusChip, ResponsiveTable, RowActions, FilterChips, InfoPanel, InfoList, EmptyState, ErrorState,
  TableSkeleton, Btn, Callout, type Column, type StatusTone,
} from "@/components/ui/v2";
import { formatDate, formatMoney } from "@/lib/format";
import {
  useSection, Modal, ReminderModal, reminderBody, BulkReminderDialog, TableToolbar, matches, exportCsv, csvMoney,
  inputCls, labelCls, hintCls, type MoneyVal, type ReminderDraft,
} from "./shared";
import { cn } from "@/lib/utils";

type G2bRaw = {
  documentId: string; invoice: string; date?: string; supplier: string; supplierEmail?: string | null; supplierId?: string | null;
  amount: MoneyVal; tax?: MoneyVal; period?: string | null;
  reportedValue?: MoneyVal; reportedTax?: MoneyVal; difference?: MoneyVal; taxDifference?: MoneyVal;
};
type Kind = "missing2b" | "mismatch" | "books";
type G2bRow = G2bRaw & { kind: Kind };
type Filter = "all" | Kind;
const keyOf = (r: G2bRow) => `${r.kind}:${r.documentId}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const periodLabel = (p?: string | null) => {
  if (!p || !/^\d{4}-\d{2}$/.test(p)) return p ?? "—";
  return `${MONTHS[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`;
};

export function Gstr2bPanel({ onView }: { onView: (id: string) => void }) {
  const [period, setPeriod] = useState<string>("");
  const { data, isLoading, error, refetch } = useSection("gstr2b", period ? { period } : {});
  const { activeEntity } = useSession();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [remind, setRemind] = useState<G2bRow | null>(null);
  const [bulk, setBulk] = useState<ReminderDraft[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importPeriod, setImportPeriod] = useState("");
  const [importJson, setImportJson] = useState("");
  const [importBusy, setImportBusy] = useState(false);

  const all = useMemo<G2bRow[]>(() => [
    ...((data?.missingIn2B ?? []) as G2bRaw[]).map((r) => ({ ...r, kind: "missing2b" as const })),
    ...((data?.mismatched ?? []) as G2bRaw[]).map((r) => ({ ...r, kind: "mismatch" as const })),
    ...((data?.missingInBooks ?? []) as G2bRaw[]).map((r) => ({ ...r, kind: "books" as const })),
  ], [data]);
  const estimated = Boolean(data?.estimated);
  const counts = { missing2b: all.filter((r) => r.kind === "missing2b").length, mismatch: all.filter((r) => r.kind === "mismatch").length, books: all.filter((r) => r.kind === "books").length };
  const rows = all.filter((r) => (filter === "all" || r.kind === filter) && matches(q, r.invoice, r.supplier));
  const periods = (data?.periods ?? []) as string[];
  const currentPeriod = String(data?.period ?? "");

  const statusOf = (r: G2bRow): { tone: StatusTone; label: string } =>
    r.kind === "books" ? { tone: "critical", label: "Not in your books" }
      : r.kind === "mismatch" ? { tone: "warn", label: "Values differ" }
        : estimated ? { tone: "info", label: "May be missing" } : { tone: "warn", label: "Not in GSTR-2B" };
  // Suspected rows carry no statement period: show the month they were billed.
  const periodOf = (r: G2bRow) => r.period ?? (estimated && r.date ? r.date.slice(0, 7) : currentPeriod);
  const atStake = (r: G2bRow) => (r.kind === "mismatch" ? r.taxDifference ?? r.difference : r.tax);

  const draftFor = (r: G2bRow): ReminderDraft => ({
    key: `gstr2b:${r.documentId}`, invoice: r.invoice, supplier: r.supplier, supplierId: r.supplierId, email: r.supplierEmail,
    subject: r.kind === "mismatch" ? `GSTR-1 values for invoice ${r.invoice}` : `GSTR-2B — please report invoice ${r.invoice}`,
    body: r.kind === "mismatch"
      ? reminderBody(r.invoice, `The value you reported in GSTR-1 (${formatMoney(r.reportedValue)}) differs from the invoice (${formatMoney(r.amount)}). Please correct it or send a credit/debit note so our GST credit matches.`)
      : reminderBody(r.invoice, `It does not appear in our GSTR-2B for ${periodLabel(currentPeriod)}, so we cannot claim the GST credit of ${formatMoney(r.tax ?? "0.00")} until you report it in your GSTR-1.`),
  });

  const runImport = async () => {
    if (mocksEnabled()) { toast.info("Demo data — imports are not saved"); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(importJson); } catch { toast.error("That file is not valid JSON"); return; }
    if (!activeEntity?.id) { toast.error("Pick a company first"); return; }
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
  const openImport = () => { setImportPeriod(currentPeriod); setImportOpen(true); };

  const doExport = (list: G2bRow[]) => exportCsv("gstr2b-match", ["Invoice", "Invoice date", "Supplier", "Period", "Invoice value", "GST at stake", "Reported value", "Status"],
    list.map((r) => [r.invoice, r.date ?? "", r.supplier, periodOf(r), csvMoney(r.amount), csvMoney(atStake(r)), csvMoney(r.reportedValue), statusOf(r).label]));

  const columns: Column<G2bRow>[] = [
    {
      key: "invoice", header: "Invoice", primary: true,
      cell: (r) => (
        <span className="block min-w-0">
          <button type="button" onClick={() => onView(r.documentId)} className="whitespace-nowrap font-code text-[14px] font-medium text-[var(--ink)] underline-offset-4 hover:underline">{r.invoice}</button>
          {r.date ? <span className="block whitespace-nowrap text-[13px] text-[var(--muted)]">Billed {formatDate(r.date)}</span> : null}
        </span>
      ),
    },
    { key: "supplier", header: "Supplier", width: "min-w-[150px]", cell: (r) => <span className="line-clamp-2 text-[var(--ink)]">{r.supplier}</span> },
    { key: "period", header: "Period", cell: (r) => <span className="whitespace-nowrap">{periodLabel(periodOf(r))}</span> },
    {
      key: "amount", header: "Invoice value", align: "right",
      cell: (r) => (
        <span className="inline-flex flex-col items-end leading-snug">
          <Money value={r.amount} className="text-[var(--ink)]" />
          {r.kind === "mismatch" && r.reportedValue ? <span className="text-[13px] text-[var(--muted)]">2B shows {formatMoney(r.reportedValue)}</span> : null}
        </span>
      ),
    },
    { key: "stake", header: "GST at stake", align: "right", cell: (r) => <Money value={atStake(r)} className="font-medium text-[var(--ink)]" /> },
    { key: "status", header: "Status", cell: (r) => { const s = statusOf(r); return <StatusChip tone={s.tone}>{s.label}</StatusChip>; } },
  ];

  const actions = (r: G2bRow) => {
    const view = { label: "View invoice", icon: Eye, onSelect: () => onView(r.documentId) };
    if (r.kind === "books") {
      return <RowActions label={r.invoice} primary={{ label: "Upload invoice", href: "/app/documents" }} items={[view]} />;
    }
    return <RowActions label={r.invoice} primary={{ label: r.kind === "mismatch" ? "Ask supplier" : "Remind supplier", onSelect: () => setRemind(r) }} items={[view]} />;
  };

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Could not load"} onRetry={() => refetch()} />;

  return (
    <div className="space-y-5">
      <InfoPanel storageKey="compliance.gstr2b" summary="You can claim GST credit only on bills your suppliers reported — they appear in your GSTR-2B.">
        <InfoList
          items={[
            { label: "The rule", value: "GST credit on a purchase is allowed only when the supplier has reported the bill in their GSTR-1, so it shows in your monthly GSTR-2B statement." },
            { label: "If it’s missed", value: "Credit claimed on bills missing from GSTR-2B is disallowed and has to be paid back with interest; bills you never recorded mean credit left unclaimed." },
            { label: "How Satya checks", value: "Your recorded bills are matched with the imported GSTR-2B on supplier GSTIN + invoice number; values more than ₹1 apart are flagged. Without an import, Satya lists bills tied to open issues as suspected gaps — not a portal match." },
            { label: "Deadline", value: "Claim the credit in GSTR-3B, due on the 20th of the following month for monthly filers." },
            { label: "Law", value: "CGST Act section 16(2)(aa) · CGST Rules, rule 36(4)" },
          ]}
        />
        <p className="mt-4 text-[14px] text-[var(--muted)]">
          Screening, not tax advice — confirm positions with your CA.{" "}
          <Link href={`/app/ask?about=${encodeURIComponent("GSTR-2B matching")}`} className="font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">Ask Satya to explain</Link>
        </p>
      </InfoPanel>

      {isLoading || !data ? (
        <TableSkeleton rows={5} columns={6} />
      ) : (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Btn size="md" variant="secondary" icon={FileUp} onClick={openImport}>Import GSTR-2B</Btn>
            {periods.length > 1 ? (
              <label className="flex items-center gap-2 text-[14px] text-[var(--muted)]">
                Statement
                <select className={cn(inputCls, "h-10 w-auto")} value={period || currentPeriod} onChange={(e) => setPeriod(e.target.value)}>
                  {periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
                </select>
              </label>
            ) : !estimated ? (
              <span className="text-[14px] text-[var(--muted)]">Statement for {periodLabel(currentPeriod)} · {data.matched ?? 0} matched</span>
            ) : null}
          </div>
          {estimated ? (
            <Callout tone="info" className="mb-4" title="No GSTR-2B imported yet">
              These are bills with open issues that may not reach your GSTR-2B — not a portal match. Import the JSON from the GST portal for an exact, bill-by-bill comparison.
            </Callout>
          ) : null}
          <TableToolbar
            filters={
              <FilterChips<Filter>
                label="Filter GSTR-2B results"
                value={filter}
                onChange={(v) => { setFilter(v); setSelected(new Set()); }}
                options={[
                  { value: "all", label: "All", count: all.length },
                  { value: "missing2b", label: estimated ? "May be missing" : "Not in 2B", count: counts.missing2b, tone: "warn" },
                  { value: "mismatch", label: "Values differ", count: counts.mismatch, tone: "warn" },
                  { value: "books", label: "Not in books", count: counts.books, tone: "critical" },
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
                <Btn size="sm" icon={Send} onClick={() => setBulk(all.filter((r) => selected.has(keyOf(r)) && r.kind !== "books").map(draftFor))}>Send reminders</Btn>
                <Btn size="sm" variant="secondary" icon={Download} onClick={() => doExport(all.filter((r) => selected.has(keyOf(r))))}>Export</Btn>
              </>
            }
          />
          <ResponsiveTable
            caption="Bills that don’t match GSTR-2B"
            columns={columns}
            rows={rows}
            rowKey={keyOf}
            actions={actions}
            rowAccent={(r) => (r.kind === "books" ? "critical" : null)}
            selection={{
              selected,
              onChange: setSelected,
              isSelectable: (r) => r.kind !== "books",
              rowLabel: (r) => `Select ${r.invoice}`,
            }}
            empty={
              all.length === 0 ? (
                estimated ? (
                  <EmptyState compact icon={FileUp} title="No GSTR-2B imported yet" body="No open issue points at a mismatch, but that isn’t a portal check. Import this month’s GSTR-2B JSON for an exact match." actionLabel="Import GSTR-2B" onAction={openImport} />
                ) : (
                  <EmptyState compact tone="ok" icon={CircleCheck} title="Everything matches" body={`Every bill in your books for ${periodLabel(currentPeriod)} is in GSTR-2B, and nothing in GSTR-2B is missing from your books.`} />
                )
              ) : (
                <EmptyState compact title="No bills match" body="Try another filter or clear the search." />
              )
            }
          />
        </div>
      )}

      {remind ? (
        <ReminderModal title={`Remind ${remind.supplier}`} subject={draftFor(remind).subject} email={remind.supplierEmail} body={draftFor(remind).body} onClose={() => setRemind(null)} />
      ) : null}
      {bulk ? <BulkReminderDialog drafts={bulk} onClose={() => setBulk(null)} onDone={() => { setBulk(null); setSelected(new Set()); }} /> : null}

      {importOpen ? (
        <Modal title="Import GSTR-2B" onClose={() => setImportOpen(false)} wide>
          <div className="space-y-4">
            <p className="text-[15px] leading-relaxed text-[var(--muted)]">
              Download the GSTR-2B JSON from the GST portal and pick the file — or paste it. Bills are matched on supplier GSTIN + invoice number; entries already imported are skipped.
            </p>
            <div>
              <label htmlFor="g2b-period" className={labelCls}>Statement period</label>
              <input id="g2b-period" className={inputCls} placeholder="2026-10" value={importPeriod} onChange={(e) => setImportPeriod(e.target.value)} />
              <p className={hintCls}>Year and month, like 2026-10.</p>
            </div>
            <div>
              <label htmlFor="g2b-json" className={labelCls}>GSTR-2B JSON</label>
              <textarea id="g2b-json" className={cn(inputCls, "h-40 py-2.5 font-mono text-[13px]")} placeholder='{"data":{"docdata":{"b2b":[…]}}}' value={importJson} onChange={(e) => setImportJson(e.target.value)} />
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-[14px] font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">
              <FileUp size={15} aria-hidden="true" /> Or pick a .json file
              <input type="file" accept=".json,application/json" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setImportJson(await f.text()); }} />
            </label>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Btn onClick={runImport} disabled={importBusy || !importJson.trim()} icon={importBusy ? Loader2 : FileUp}>{importBusy ? "Importing…" : "Import"}</Btn>
            <Btn variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Btn>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
