"use client";

// LUT — Letter of Undertaking: per company, is a valid LUT on file, and is
// every export billed without IGST covered by one on its invoice date.

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { History, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import { v2 } from "@/lib/api/v2";
import { mocksEnabled } from "@/lib/flags";
import {
  Money, StatusChip, ResponsiveTable, RowActions, InfoPanel, InfoList, EmptyState, ErrorState, TableSkeleton,
  SectionHeader, RelativeDue, type Column, type StatusTone,
} from "@/components/ui/v2";
import { formatDate } from "@/lib/format";
import { useSection, FieldModal, Modal, exportCsv, csvMoney, inputCls, labelCls, hintCls, type MoneyVal } from "./shared";
import { cn } from "@/lib/utils";

type LutEntry = { arn: string; fy: string; validFrom: string; validTo: string; daysLeft: number; status: "active" | "expiring" | "expired" };
type LutEntity = { entityId: string; code: string; legalName: string; status: "active" | "expiring" | "none"; currentArn?: string | null; validTo?: string | null; luts: LutEntry[] };
type ExportRow = { documentId: string; invoice: string; date: string; buyer: string; amount: MoneyVal; covered: boolean };

const ENTITY_STATUS: Record<LutEntity["status"], { tone: StatusTone; label: string }> = {
  active: { tone: "ok", label: "LUT active" },
  expiring: { tone: "warn", label: "Expiring soon" },
  none: { tone: "neutral", label: "No valid LUT" },
};

const EMPTY_FORM = { arn: "", fy: "", validFrom: "", validTo: "" };

export function LutPanel({ onView }: { onView: (id: string) => void }) {
  const { data, isLoading, error, refetch } = useSection("lut");
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState<LutEntity | null>(null);
  const [history, setHistory] = useState<LutEntity | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const mutation = useMutation({
    mutationFn: ({ entityId, entry }: { entityId: string; entry: typeof EMPTY_FORM }): Promise<{ entityId: string; lut: unknown[] }> => {
      if (mocksEnabled()) return Promise.resolve({ entityId, lut: [] });
      return v2.saveLut(entityId, entry);
    },
    onSuccess: () => {
      if (mocksEnabled()) toast.info("Demo data — change is not saved");
      else toast.success("LUT saved on the company");
      setAdding(null); setForm(EMPTY_FORM);
      queryClient.invalidateQueries({ queryKey: ["compliance", "lut"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Could not load"} onRetry={() => refetch()} />;

  const entities = (data?.entities ?? []) as LutEntity[];
  const exportsRows = (data?.exportInvoices ?? []) as ExportRow[];
  const hasExports = exportsRows.length > 0;

  const entityColumns: Column<LutEntity>[] = [
    {
      key: "company", header: "Company", primary: true,
      cell: (e) => (
        <span className="block min-w-0">
          <span className="block font-medium text-[var(--ink)]">{e.legalName}</span>
          <span className="block text-[13px] text-[var(--muted)]">{e.code}</span>
        </span>
      ),
    },
    {
      key: "status", header: "Status",
      cell: (e) => {
        const s = e.status === "none" && hasExports ? { tone: "critical" as const, label: "No valid LUT" } : ENTITY_STATUS[e.status];
        return <StatusChip tone={s.tone}>{s.label}</StatusChip>;
      },
    },
    { key: "arn", header: "ARN", cell: (e) => (e.currentArn ? <span className="font-code text-[14px]">{e.currentArn}</span> : <span className="text-[var(--muted)]">—</span>) },
    { key: "valid", header: "Valid until", cell: (e) => (e.validTo ? <RelativeDue date={e.validTo} /> : <span className="text-[var(--muted)]">—</span>) },
  ];

  const exportColumns: Column<ExportRow>[] = [
    {
      key: "invoice", header: "Invoice", primary: true,
      cell: (r) => <button type="button" onClick={() => onView(r.documentId)} className="whitespace-nowrap font-code text-[14px] font-medium text-[var(--ink)] underline-offset-4 hover:underline">{r.invoice}</button>,
    },
    { key: "buyer", header: "Buyer", cell: (r) => r.buyer },
    { key: "date", header: "Date", cell: (r) => formatDate(r.date) },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <Money value={r.amount} className="text-[var(--ink)]" /> },
    { key: "cover", header: "LUT cover", cell: (r) => (r.covered ? <StatusChip tone="ok">Covered</StatusChip> : <StatusChip tone="critical">Not covered</StatusChip>) },
  ];

  return (
    <div className="space-y-5">
      <InfoPanel storageKey="compliance.lut" summary="Exports billed without IGST need a Letter of Undertaking filed for that financial year.">
        <InfoList
          items={[
            { label: "The rule", value: "To export goods or services (or supply to an SEZ) without charging IGST, each company must file a Letter of Undertaking on the GST portal (form RFD-11) — once per financial year, before the first such invoice." },
            { label: "If it’s missed", value: "Zero-rated invoices raised without a valid LUT are treated as taxable: you owe the IGST with interest and claim a refund later." },
            { label: "How Satya checks", value: "Each company’s LUT dates are compared with the date of every outward invoice billed without IGST. Satya flags a LUT 30 days before it lapses." },
            { label: "Law", value: "IGST Act section 16(3) · CGST Rules, rule 96A" },
          ]}
        />
        <p className="mt-4 text-[14px] text-[var(--muted)]">
          Screening, not tax advice — confirm positions with your CA.{" "}
          <Link href={`/app/ask?about=${encodeURIComponent("LUT for exports")}`} className="font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">Ask Satya to explain</Link>
        </p>
      </InfoPanel>

      {isLoading || !data ? (
        <TableSkeleton rows={2} columns={4} />
      ) : (
        <>
          <ResponsiveTable
            caption="Letter of Undertaking by company"
            columns={entityColumns}
            rows={entities}
            rowKey={(e) => e.entityId}
            breakpoint="md"
            actions={(e) => (
              <RowActions
                label={e.legalName}
                primary={{ label: e.luts.length ? "Renew LUT" : "Add LUT", onSelect: () => { setAdding(e); setForm(EMPTY_FORM); } }}
                items={e.luts.length ? [{ label: `All LUTs (${e.luts.length})`, icon: History, onSelect: () => setHistory(e) }] : []}
              />
            )}
            empty={<EmptyState compact title="No companies to show" body="Add a company in Settings to track its Letter of Undertaking." actionLabel="Open Settings" actionHref="/app/settings" />}
          />

          <section aria-labelledby="lut-exports">
            <SectionHeader
              id="lut-exports"
              className="mt-8"
              title="Exports billed without IGST"
              description={hasExports ? "Each needs a LUT that covers its invoice date." : undefined}
              action={hasExports ? (
                <button
                  type="button"
                  onClick={() => exportCsv("lut-exports", ["Invoice", "Date", "Buyer", "Amount", "Covered by LUT"], exportsRows.map((r) => [r.invoice, r.date, r.buyer, csvMoney(r.amount), r.covered ? "Yes" : "No"]))}
                  className="text-[15px] font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]"
                >
                  Export CSV
                </button>
              ) : undefined}
            />
            <ResponsiveTable
              caption="Zero-rated outward invoices"
              columns={exportColumns}
              rows={exportsRows}
              rowKey={(r) => r.documentId}
              breakpoint="md"
              rowAccent={(r) => (r.covered ? null : "critical")}
              empty={<EmptyState compact tone="ok" icon={CircleCheck} title="No exports recorded" body="When you record an export or SEZ invoice billed without IGST, Satya checks it against your LUT dates." />}
            />
          </section>
        </>
      )}

      {history ? (
        <Modal title={`LUTs — ${history.legalName}`} onClose={() => setHistory(null)}>
          <ul className="divide-y divide-[var(--line)]">
            {history.luts.map((l) => (
              <li key={l.arn} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="min-w-0">
                  <span className="block font-code text-[14px] text-[var(--ink)]">{l.arn}</span>
                  <span className="block text-[13px] text-[var(--muted)]">FY {l.fy} · {formatDate(l.validFrom)} – {formatDate(l.validTo)}</span>
                </span>
                <StatusChip tone={l.status === "expired" ? "neutral" : l.status === "expiring" ? "warn" : "ok"}>
                  {l.status === "expired" ? "Expired" : l.status === "expiring" ? "Expiring soon" : "Active"}
                </StatusChip>
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}

      {adding ? (
        <FieldModal
          title={`${adding.luts.length ? "Renew" : "Add"} LUT — ${adding.legalName}`}
          submitLabel="Save LUT"
          busy={mutation.isPending}
          onClose={() => setAdding(null)}
          onSubmit={() => mutation.mutate({ entityId: adding.entityId, entry: form })}
        >
          <div>
            <label htmlFor="lut-arn" className={labelCls}>LUT ARN</label>
            <input id="lut-arn" className={cn(inputCls, "font-mono text-[14px]")} value={form.arn} onChange={(e) => setForm({ ...form, arn: e.target.value.toUpperCase() })} placeholder="e.g. AD270426000123F" />
            <p className={hintCls}>The reference on the GST portal acknowledgement for form RFD-11.</p>
          </div>
          <div>
            <label htmlFor="lut-fy" className={labelCls}>Financial year</label>
            <input id="lut-fy" className={inputCls} value={form.fy} onChange={(e) => setForm({ ...form, fy: e.target.value })} placeholder="2026-27" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="lut-from" className={labelCls}>Valid from</label>
              <input id="lut-from" className={inputCls} type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
            </div>
            <div>
              <label htmlFor="lut-to" className={labelCls}>Valid to</label>
              <input id="lut-to" className={inputCls} type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} />
            </div>
          </div>
        </FieldModal>
      ) : null}
    </div>
  );
}
