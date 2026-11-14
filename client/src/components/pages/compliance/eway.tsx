"use client";

// e-invoice & e-way bill: bills from suppliers in the e-invoicing band with
// no IRN, and goods consignments over ₹50,000 with no e-way bill number.
// Record the number, ask the supplier, or mark it not applicable.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, Mail, Ban, CircleCheck, Building2 } from "lucide-react";
import { toast } from "sonner";
import { v2 } from "@/lib/api/v2";
import { mocksEnabled } from "@/lib/flags";
import {
  Money, StatusChip, ResponsiveTable, RowActions, FilterChips, InfoPanel, InfoList, EmptyState, ErrorState,
  TableSkeleton, type Column, type StatusTone,
} from "@/components/ui/v2";
import { formatDate } from "@/lib/format";
import { plural } from "@/lib/humanize";
import { useSection, FieldModal, ReminderModal, reminderBody, TableToolbar, matches, exportCsv, csvMoney, inputCls, labelCls, hintCls, type MoneyVal } from "./shared";
import { cn } from "@/lib/utils";

type EwayRaw = {
  documentId: string; invoice: string; date: string; supplier: string; supplierEmail?: string | null;
  amount: MoneyVal; irn?: string | null; ewb?: string | null; reason: string;
};
type Kind = "irn" | "ewb" | "unknown";
type EwayRow = EwayRaw & { kind: Kind };
type Filter = "all" | Kind;
const keyOf = (r: EwayRow) => `${r.kind}:${r.documentId}`;

const MISSING: Record<Kind, string> = { irn: "e-invoice number (IRN)", ewb: "E-way bill number", unknown: "IRN — if required" };

function statusOf(r: EwayRow): { tone: StatusTone; label: string } {
  if (r.kind === "irn") return { tone: "warn", label: "IRN missing" };
  if (r.kind === "ewb") return { tone: "warn", label: "E-way bill missing" };
  return { tone: "info", label: "Supplier band unknown" };
}

export function EwayPanel({ onView }: { onView: (id: string) => void }) {
  const { data, isLoading, error, refetch } = useSection("eway");
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [remind, setRemind] = useState<EwayRow | null>(null);
  const [recording, setRecording] = useState<EwayRow | null>(null);
  const [value, setValue] = useState("");

  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }): Promise<{ documentId: string; gst: Record<string, unknown> }> => {
      if (mocksEnabled()) return Promise.resolve({ documentId: id, gst: {} });
      return v2.saveGstMeta(id, body);
    },
    onSuccess: () => {
      if (mocksEnabled()) toast.info("Demo data — change is not saved");
      else toast.success("Saved on the invoice");
      setRecording(null); setValue("");
      queryClient.invalidateQueries({ queryKey: ["compliance", "eway"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  const einv = data?.einvoice ?? { withIrn: 0, waived: 0, pct: 0, checks: [], unknownItems: [] };
  const eway = data?.eway ?? { withEwb: 0, waived: 0, goodsInvoices: 0, checks: [] };
  const all = useMemo<EwayRow[]>(() => [
    ...((data?.einvoice?.checks ?? []) as EwayRaw[]).map((r) => ({ ...r, kind: "irn" as const })),
    ...((data?.eway?.checks ?? []) as EwayRaw[]).map((r) => ({ ...r, kind: "ewb" as const })),
    ...((data?.einvoice?.unknownItems ?? []) as EwayRaw[]).map((r) => ({ ...r, kind: "unknown" as const })),
  ], [data]);
  const counts = { irn: all.filter((r) => r.kind === "irn").length, ewb: all.filter((r) => r.kind === "ewb").length, unknown: all.filter((r) => r.kind === "unknown").length };
  const rows = all.filter((r) => (filter === "all" ? r.kind !== "unknown" : r.kind === filter) && matches(q, r.invoice, r.supplier));

  const isIrn = (r: EwayRow) => r.kind !== "ewb";
  const valueProblem = !recording ? null
    : isIrn(recording) ? (/^[0-9a-f]{64}$/i.test(value.trim()) ? null : "An IRN is 64 letters and digits (0–9, a–f)")
      : (/^\d{12}$/.test(value.replace(/\s/g, "")) ? null : "An e-way bill number is 12 digits");

  const doExport = (list: EwayRow[]) => exportCsv("einvoice-eway", ["Invoice", "Invoice date", "Supplier", "Amount", "Missing", "Status", "Reason"],
    list.map((r) => [r.invoice, r.date, r.supplier, csvMoney(r.amount), MISSING[r.kind], statusOf(r).label, r.reason]));

  const columns: Column<EwayRow>[] = [
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
    { key: "amount", header: "Amount", align: "right", cell: (r) => <Money value={r.amount} className="text-[var(--ink)]" /> },
    { key: "missing", header: "Missing", cell: (r) => MISSING[r.kind] },
    { key: "status", header: "Status", cell: (r) => { const s = statusOf(r); return <StatusChip tone={s.tone}>{s.label}</StatusChip>; } },
  ];

  const actions = (r: EwayRow) => {
    const view = { label: "View invoice", icon: Eye, onSelect: () => onView(r.documentId) };
    const ask = { label: "Ask supplier", icon: Mail, onSelect: () => setRemind(r) };
    const na = {
      label: r.kind === "ewb" ? "Mark not required" : "Mark not applicable", icon: Ban,
      onSelect: () => mutation.mutate({ id: r.documentId, body: r.kind === "ewb" ? { ewbStatus: "not_required" } : { irnStatus: "not_applicable" } }),
      disabled: mutation.isPending,
    };
    const record = { label: r.kind === "ewb" ? "Record e-way no." : "Record IRN", onSelect: () => { setRecording(r); setValue(""); } };
    const extra = r.kind === "unknown" ? [{ label: "Set supplier’s turnover band", icon: Building2, href: "/app/suppliers" }] : [];
    return <RowActions label={r.invoice} primary={record} items={[ask, ...extra, view, na]} />;
  };

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Could not load"} onRetry={() => refetch()} />;

  return (
    <div className="space-y-5">
      <InfoPanel storageKey="compliance.eway" summary="Bills from larger suppliers need an e-invoice number; goods over ₹50,000 need an e-way bill.">
        <InfoList
          items={[
            { label: "The rule", value: "Suppliers with turnover of ₹5 crore or more must register every B2B invoice on the e-invoice portal, which gives it an IRN. Goods worth over ₹50,000 moving by road need an e-way bill." },
            { label: "If it’s missed", value: "An invoice that should have an IRN but doesn’t isn’t a valid tax invoice, so your GST credit on it is at risk. Goods moving without an e-way bill can be detained with a penalty." },
            { label: "How Satya checks", value: "E-invoicing depends on the supplier’s turnover band, not the bill value — suppliers with no band recorded are listed separately, never flagged as missing. Numbers you record are supplier-supplied; Satya doesn’t verify them on the portal." },
            { label: "Law", value: "CGST Rules 48(4) and 138 · Notification 10/2023-CT" },
          ]}
        />
        <p className="mt-4 text-[14px] text-[var(--muted)]">
          Screening, not tax advice — confirm positions with your CA.{" "}
          <Link href={`/app/ask?about=${encodeURIComponent("e-invoice IRN and e-way bill")}`} className="font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">Ask Satya to explain</Link>
        </p>
      </InfoPanel>

      {isLoading || !data ? (
        <TableSkeleton rows={3} columns={5} />
      ) : (
        <div>
          <p className="mb-4 text-[15px] text-[var(--muted)]">
            <span className="tnum font-medium text-[var(--ink)]">{einv.withIrn}</span> bills carry an IRN ({einv.pct}%)
            {einv.waived ? ` · ${einv.waived} marked not applicable` : ""} · <span className="tnum font-medium text-[var(--ink)]">{eway.withEwb}</span> e-way bills recorded on {plural(eway.goodsInvoices ?? 0, "goods bill")}
            {eway.waived ? ` · ${eway.waived} marked not required` : ""}
          </p>
          <TableToolbar
            filters={
              <FilterChips<Filter>
                label="Filter missing numbers"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All missing", count: counts.irn + counts.ewb },
                  { value: "irn", label: "IRN missing", count: counts.irn, tone: "warn" },
                  { value: "ewb", label: "E-way bill missing", count: counts.ewb, tone: "warn" },
                  { value: "unknown", label: "Band unknown", count: counts.unknown },
                ]}
              />
            }
            search={q}
            onSearch={setQ}
            onExport={() => doExport(rows)}
          />
          <ResponsiveTable
            caption="Bills missing an e-invoice number or e-way bill"
            columns={columns}
            rows={rows}
            rowKey={keyOf}
            actions={actions}
            empty={
              filter === "unknown" ? (
                <EmptyState compact tone="ok" icon={CircleCheck} title="Every supplier has a turnover band" body="Satya can tell which suppliers must issue e-invoices." />
              ) : counts.irn + counts.ewb === 0 ? (
                <EmptyState compact tone="ok" icon={CircleCheck} title="Nothing missing" body="Every bill that needs an IRN or an e-way bill has one, or is marked not applicable." />
              ) : (
                <EmptyState compact title="No bills match" body="Try another filter or clear the search." />
              )
            }
          />
          {filter === "unknown" && counts.unknown ? (
            <p className="mt-3 text-[14px] text-[var(--muted)]">These suppliers have no turnover band recorded, so Satya can’t tell whether they must issue e-invoices. Set the band on the supplier to check.</p>
          ) : null}
        </div>
      )}

      {remind ? (
        <ReminderModal
          title={`Ask ${remind.supplier}`}
          subject={remind.kind === "ewb" ? `E-way bill for ${remind.invoice}` : `e-invoice IRN for ${remind.invoice}`}
          email={remind.supplierEmail}
          body={reminderBody(remind.invoice, remind.kind === "ewb"
            ? "Please share the 12-digit e-way bill number for this consignment so we can complete our records."
            : "We could not find an IRN (e-invoice registration number) for it. If your turnover requires e-invoicing, please share the IRN — without it the invoice is not valid for our GST credit.")}
          onClose={() => setRemind(null)}
        />
      ) : null}

      {recording ? (
        <FieldModal
          title={`${isIrn(recording) ? "Record IRN" : "Record e-way bill"} — ${recording.invoice}`}
          submitLabel={isIrn(recording) ? "Save IRN" : "Save e-way bill no."}
          busy={mutation.isPending}
          onClose={() => setRecording(null)}
          onSubmit={() => {
            if (valueProblem) { toast.error(valueProblem); return; }
            mutation.mutate({ id: recording.documentId, body: isIrn(recording) ? { irn: value.trim() } : { ewb: value.replace(/\s/g, "") } });
          }}
        >
          <div>
            <label htmlFor="gst-meta-value" className={labelCls}>{isIrn(recording) ? "IRN" : "E-way bill number"}</label>
            <input
              id="gst-meta-value"
              className={cn(inputCls, "font-mono text-[14px]")}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={isIrn(recording) ? "64-character IRN" : "e.g. 781234567890"}
              maxLength={isIrn(recording) ? 64 : 14}
              aria-invalid={Boolean(value && valueProblem)}
              aria-describedby="gst-meta-help"
            />
            <p id="gst-meta-help" className={hintCls}>
              {isIrn(recording) ? "From the e-invoice QR code or JSON — 64 letters and digits." : "The 12-digit number on the e-way bill."}
              {value && valueProblem ? <span className="mt-0.5 block text-[var(--sev-critical)]">{valueProblem}</span> : null}
            </p>
          </div>
        </FieldModal>
      ) : null}
    </div>
  );
}
