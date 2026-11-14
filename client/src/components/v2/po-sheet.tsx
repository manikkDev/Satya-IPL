"use client";

// PoSheet — renders a document's render-model as a proper letterhead-style
// sheet (in the spirit of a real commercial PO: parties block, itemised
// table, tax totals, payment/delivery panels, T&C, signatories, verify
// footnote). Shared by the in-page overview and the preview modal.

import { ShieldCheck } from "lucide-react";
import type { RenderModel, DocView } from "@/lib/api/v2";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const inr = (v?: string | number | null) =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v?: string | null) => (v == null ? "—" : Number(v).toLocaleString("en-IN"));
const titleCase = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase()).trim();

const TERM_LABEL: Record<string, string> = {
  paymentTerms: "Payment terms", creditDays: "Credit days", advancePct: "Advance",
  deliveryTerms: "Delivery terms", expectedDelivery: "Expected delivery", inspection: "Inspection",
  warranty: "Warranty", packing: "Packing", ldClause: "Liquidated damages", freightTerms: "Freight",
};

const TERMS_FIXED = [
  "The bill and delivery challan must clearly mention this purchase order number.",
  "The invoice must state the applicable HSN/SAC codes as required under GST law.",
  "Original signed invoice and relevant documents must accompany the material at delivery.",
  "If nothing contrary is heard within 24 hours of receipt, this order is treated as accepted.",
];

function MetaCell({ label, value, code }: { label: string; value?: React.ReactNode; code?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">{label}</p>
      <p className={cn("mt-0.5 text-[13px] text-[var(--ink)]", code && "font-code")}>{value ?? "—"}</p>
    </div>
  );
}

function PartyBlock({ label, name, lines, foot }: { label: string; name?: string | null; lines: (string | null | undefined | false)[]; foot?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)]/40 p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">{label}</p>
      <p className="mt-1.5 text-sm font-semibold leading-snug text-[var(--ink)]">{name ?? "—"}</p>
      {lines.filter(Boolean).map((l, i) => (
        <p key={i} className="mt-0.5 text-xs leading-relaxed text-[var(--ink-2)]">{l}</p>
      ))}
      {foot}
    </div>
  );
}

export function PoSheet({ model }: { model: RenderModel }) {
  const doc = model.document as DocView;
  const entity = model.entity;
  const supplier = model.supplier;
  const terms = (model.terms ?? doc.terms ?? {}) as Record<string, unknown>;
  const billing = entity?.addresses?.billing;
  const supplierAddr = supplier?.addresses?.[0];
  const shipTo = doc.shipTo ?? entity?.addresses?.shipping?.[0];
  const gst = supplier?.gstins?.[0]?.gstin ?? doc.seller?.gstin;
  const taxRows: [string, string | undefined][] = [
    ["Taxable value", doc.totals?.taxable],
    Number(doc.totals?.igst ?? 0) > 0 ? ["IGST", doc.totals?.igst] : ["CGST", doc.totals?.cgst],
    ...(Number(doc.totals?.igst ?? 0) > 0 ? [] : [["SGST", doc.totals?.sgst] as [string, string | undefined]]),
    ...(Number(doc.totals?.cess ?? 0) > 0 ? [["Cess", doc.totals?.cess] as [string, string | undefined]] : []),
  ];
  const approver = [...(doc.approvals ?? [])].reverse().find((a) => a.action === "approve" || a.role);
  const termsList = Array.isArray(terms.termsList) ? (terms.termsList as string[]) : TERMS_FIXED;
  const paymentKeys = ["paymentTerms", "creditDays", "advancePct"];
  const deliveryKeys = ["deliveryTerms", "expectedDelivery", "inspection", "warranty", "packing", "ldClause", "freightTerms"];
  const pick = (keys: string[]) => keys.filter((k) => terms[k] !== undefined && terms[k] !== null && terms[k] !== "");
  const restTerms = Object.keys(terms).filter((k) => ![...paymentKeys, ...deliveryKeys, "termsList"].includes(k) && terms[k] !== "" && terms[k] != null);

  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-1)]">
      {/* letterhead */}
      <div className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-[var(--ink)]/80 px-6 py-5">
        <div className="min-w-0">
          <p className="text-lg font-semibold tracking-tight text-[var(--ink)]">
            {entity?.tradeName ?? entity?.legalName ?? "Your entity"}
          </p>
          {entity?.legalName && entity.legalName !== entity.tradeName && (
            <p className="mt-0.5 text-xs text-[var(--ink-2)]">{entity.legalName}</p>
          )}
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
            {[billing?.line1, billing?.city, billing?.state, billing?.pin].filter(Boolean).join(", ") || "Billing address not on file"}
          </p>
          <p className="font-code mt-1 text-[11px] text-[var(--muted)]">
            {entity?.gstin ? `GSTIN ${entity.gstin}` : ""}{entity?.pan ? ` · PAN ${entity.pan}` : ""}{entity?.cin ? ` · CIN ${entity.cin}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[13px] font-bold uppercase tracking-[0.16em] text-[var(--ink)]">{doc.type === "PO_AMENDMENT" ? "PO Amendment" : "Purchase Order"}</p>
          <p className="font-code mt-1 text-base font-semibold text-[var(--accent-strong)]">{doc.number ?? doc.externalRef ?? "Draft"}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Dated {formatDate(doc.date)}{doc.fy ? ` · FY ${doc.fy}` : ""}{doc.currency ? ` · ${doc.currency}` : " · INR"}
          </p>
          <p className="mt-0.5 text-xs capitalize text-[var(--muted)]">
            {doc.status?.replaceAll("_", " ")}{doc.revision ? ` · Rev R${doc.revision}` : ""}
          </p>
        </div>
      </div>

      {/* meta strip */}
      <div className="grid grid-cols-2 gap-4 border-b border-[var(--line)] px-6 py-3.5 sm:grid-cols-4">
        <MetaCell label="Ref no." value={doc.externalRef ?? "—"} code />
        <MetaCell label="PO date" value={formatDate(doc.date)} />
        <MetaCell label="Place of supply" value={doc.placeOfSupply ? `State code ${doc.placeOfSupply}` : "—"} />
        <MetaCell label="Payment terms" value={terms.paymentTerms ? String(terms.paymentTerms) : supplier?.paymentTermsDays ? `${supplier.paymentTermsDays} days` : "—"} />
      </div>

      {/* parties */}
      <div className="grid grid-cols-1 gap-3 px-6 pt-5 sm:grid-cols-3">
        <PartyBlock
          label="Supplier (from)"
          name={supplier?.legalName ?? doc.seller?.name}
          lines={[
            supplierAddr ? [supplierAddr.line1, supplierAddr.city, supplierAddr.pin].filter(Boolean).join(", ") : doc.seller?.address,
            gst ? `GSTIN ${gst}` : null,
            supplier?.pan ? `PAN ${supplier.pan}` : null,
          ]}
          foot={supplier?.udyam?.category ? (
            <p className="mt-2 inline-flex rounded-full bg-[var(--likely-soft)] px-2 py-0.5 text-[11px] font-medium capitalize text-[var(--likely)]">
              {supplier.udyam.category} enterprise · MSMED
            </p>
          ) : undefined}
        />
        <PartyBlock
          label="Buyer (bill to)"
          name={doc.buyer?.name ?? entity?.legalName}
          lines={[
            billing ? [billing.line1, billing.city, billing.state, billing.pin].filter(Boolean).join(", ") : null,
            doc.buyer?.gstin ?? entity?.gstin ? `GSTIN ${doc.buyer?.gstin ?? entity?.gstin}` : null,
          ]}
        />
        <PartyBlock
          label="Ship to"
          name={shipTo?.label ?? (shipTo ? "Delivery site" : "Same as billing")}
          lines={[
            shipTo ? [shipTo.line1, shipTo.city, shipTo.state, shipTo.pin].filter(Boolean).join(", ") : null,
            shipTo?.contact ?? null,
          ]}
        />
      </div>

      {/* lines */}
      <div className="px-6 pt-5">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-y border-[var(--line)] text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
              <th className="py-2 pr-2">#</th>
              <th className="pr-2">Particulars</th>
              <th className="pr-2">HSN</th>
              <th className="pr-2">UOM</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Rate</th>
              <th className="text-right">GST</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(doc.lines ?? []).map((l) => (
              <tr key={l.lineNo} className="border-b border-[var(--line)]/60 last:border-0 align-top">
                <td className="tnum py-2.5 pr-2 text-[var(--muted)]">{l.lineNo}</td>
                <td className="py-2.5 pr-2 text-[var(--ink)]">
                  {l.description}
                  {l.scheduleDate ? <span className="mt-0.5 block text-[11px] text-[var(--muted)]">Delivery by {formatDate(l.scheduleDate)}</span> : null}
                </td>
                <td className="font-code py-2.5 pr-2 text-xs text-[var(--ink-2)]">{l.hsn ?? "—"}</td>
                <td className="py-2.5 pr-2 text-[var(--ink-2)]">{l.uom ?? "—"}</td>
                <td className="tnum py-2.5 text-right text-[var(--ink)]">{num(l.qty)}</td>
                <td className="tnum py-2.5 text-right text-[var(--ink)]">{inr(l.rate)}</td>
                <td className="tnum py-2.5 text-right text-[var(--ink-2)]">{l.gstRate ? `${l.gstRate}%` : "—"}</td>
                <td className="tnum py-2.5 text-right font-medium text-[var(--ink)]">
                  {inr(l.lineTotal ?? l.taxableValue ?? (Number(l.qty ?? 0) * Number(l.rate ?? 0)))}
                </td>
              </tr>
            ))}
            {(doc.charges ?? []).map((c, i) => (
              <tr key={`ch-${i}`} className="border-b border-[var(--line)]/60 last:border-0 align-top">
                <td className="py-2.5 pr-2" />
                <td className="py-2.5 pr-2 text-[var(--ink-2)]" colSpan={6}>{c.label ?? "Additional charge"}</td>
                <td className="tnum py-2.5 text-right font-medium text-[var(--ink)]">{inr(c.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* totals + amount in words */}
      <div className="flex flex-wrap items-end justify-between gap-6 px-6 pb-5 pt-4">
        <div className="max-w-sm">
          {model.amountInWords ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Amount in words</p>
              <p className="mt-1 text-xs italic leading-relaxed text-[var(--ink-2)]">{model.amountInWords}</p>
            </>
          ) : null}
        </div>
        <div className="w-64 space-y-1 text-[13px]">
          {taxRows.filter(([, v]) => v != null).map(([label, v]) => (
            <div key={label} className="flex justify-between text-[var(--ink-2)]"><span>{label}</span><span className="tnum">{inr(v)}</span></div>
          ))}
          <div className="flex justify-between border-t-2 border-[var(--ink)]/70 pt-2 text-[15px] font-semibold text-[var(--ink)]">
            <span>Grand total</span><span className="tnum">{inr(doc.totals?.grand)}</span>
          </div>
        </div>
      </div>

      {/* payment + delivery panels */}
      {(pick(paymentKeys).length > 0 || pick(deliveryKeys).length > 0 || restTerms.length > 0 || supplier?.bankAccounts?.length) && (
        <div className="grid grid-cols-1 gap-3 px-6 pb-5 sm:grid-cols-2">
          <div className="rounded-[var(--radius-sm)] border border-[var(--line)] p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Payment details</p>
            <dl className="mt-2 space-y-1.5 text-xs">
              {pick(paymentKeys).map((k) => (
                <div key={k} className="flex justify-between gap-4"><dt className="text-[var(--muted)]">{TERM_LABEL[k] ?? titleCase(k)}</dt><dd className="text-right text-[var(--ink)]">{String(terms[k])}{k === "advancePct" ? "%" : k === "creditDays" ? " days" : ""}</dd></div>
              ))}
              {supplier?.bankAccounts?.[0] ? (
                <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Vendor bank</dt><dd className="text-right font-code text-[var(--ink)]">{supplier.bankAccounts[0].masked}{supplier.bankAccounts[0].ifsc ? ` · ${supplier.bankAccounts[0].ifsc}` : ""}</dd></div>
              ) : null}
            </dl>
          </div>
          <div className="rounded-[var(--radius-sm)] border border-[var(--line)] p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Delivery &amp; logistics</p>
            <dl className="mt-2 space-y-1.5 text-xs">
              {pick(deliveryKeys).map((k) => (
                <div key={k} className="flex justify-between gap-4"><dt className="text-[var(--muted)]">{TERM_LABEL[k] ?? titleCase(k)}</dt><dd className="text-right text-[var(--ink)]">{k === "warranty" && /^\d+$/.test(String(terms[k])) ? `${terms[k]} months` : String(terms[k])}</dd></div>
              ))}
              {restTerms.map((k) => (
                <div key={k} className="flex justify-between gap-4"><dt className="text-[var(--muted)]">{TERM_LABEL[k] ?? titleCase(k)}</dt><dd className="text-right text-[var(--ink)]">{String(terms[k])}</dd></div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {/* terms & conditions */}
      <div className="border-t border-[var(--line)] px-6 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Terms &amp; conditions</p>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-[var(--ink-2)]">
          {termsList.map((t, i) => <li key={i}>{t}</li>)}
        </ol>
      </div>

      {/* signatories + verify */}
      <div className="flex flex-wrap items-end justify-between gap-6 border-t border-[var(--line)] px-6 py-5">
        <div className="grid grid-cols-3 gap-8">
          <div className="w-36">
            <div className="h-10" />
            <p className="border-t border-[var(--line-strong)] pt-1.5 text-[11px] text-[var(--muted)]">Prepared by</p>
            <p className="mt-0.5 truncate text-[11px] text-[var(--ink-2)]">{doc.createdBy ?? "—"}</p>
          </div>
          <div className="w-36">
            <div className="h-10" />
            <p className="border-t border-[var(--line-strong)] pt-1.5 text-[11px] text-[var(--muted)]">Approved by</p>
            <p className="mt-0.5 truncate text-[11px] text-[var(--ink-2)]">{approver?.actor ?? "—"}</p>
          </div>
          <div className="w-44">
            <div className="grid h-10 place-items-center rounded-[var(--radius-sm)] border border-dashed border-[var(--line-strong)] text-[11px] text-[var(--muted)]">Stamp</div>
            <p className="mt-1.5 text-[11px] text-[var(--muted)]">For {entity?.legalName ?? "the entity"}</p>
            <p className="mt-0.5 text-[11px] font-medium text-[var(--ink-2)]">Authorised signatory</p>
          </div>
        </div>
      </div>

      {(model.verify?.url || entity?.letterhead?.footerText) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] bg-[var(--surface-2)]/40 px-6 py-3">
          {entity?.letterhead?.footerText ? <p className="text-[11px] text-[var(--muted)]">{entity.letterhead.footerText}</p> : <span />}
          {model.verify?.url ? (
            <p className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
              <ShieldCheck size={12} className="text-[var(--confirmed)]" aria-hidden="true" />
              Verify at <span className="font-code">{model.verify.url}</span>
              {model.verify.hash ? <span className="font-code">· {model.verify.hash.slice(0, 16)}…</span> : null}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
