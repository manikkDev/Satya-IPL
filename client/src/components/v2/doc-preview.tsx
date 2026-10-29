"use client";

// Inline document preview — renders B's /documents/:id/render-model as a
// letterhead-style page inside a modal. No PDF download required; the real
// PDF is one click away via the same model.

import { useEffect, useState } from "react";
import { X, FileDown, ShieldCheck } from "lucide-react";
import { v2, type RenderModel } from "@/lib/api/v2";
import { Money, DateText } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";

export function DocPreviewModal({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const [model, setModel] = useState<RenderModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    v2.renderModel(documentId)
      .then((m) => alive && setModel(m))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Preview failed"));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      alive = false;
      window.removeEventListener("keydown", esc);
    };
  }, [documentId, onClose]);

  const doc = model?.document;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-label="Document preview">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--paper)] shadow-[var(--shadow-3)]">
        {/* toolbar */}
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[var(--ink)]">
              {doc ? `${doc.type} · ${doc.number ?? doc.externalRef ?? doc.id}` : "Loading preview…"}
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              if (!model) return;
              const { downloadDocumentPdf } = await import("@/components/v2/po-pdf");
              await downloadDocumentPdf(model);
            }}
            disabled={!model}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] hover:border-[var(--accent)]"
          >
            <FileDown size={13} /> PDF
          </button>
          <button type="button" onClick={onClose} aria-label="Close preview" className="rounded p-1 text-[var(--muted)] hover:text-[var(--ink)]">
            <X size={17} />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && <p className="text-sm text-[var(--sev-critical)]">{error}</p>}
          {!model && !error && <Skeleton className="h-[480px] w-full" />}
          {model && doc && (
            <div className="mx-auto max-w-2xl space-y-5">
              {/* letterhead */}
              <div className="flex items-start justify-between gap-6">
                <div>
                  <p className="text-lg font-semibold text-[var(--ink)]">{model.entity?.tradeName ?? model.entity?.legalName ?? "Your entity"}</p>
                  {model.entity?.legalName && model.entity.legalName !== model.entity.tradeName && (
                    <p className="text-xs text-[var(--muted)]">{model.entity.legalName}</p>
                  )}
                  {model.entity?.gstin && <p className="font-code mt-1 text-xs text-[var(--muted)]">GSTIN {model.entity.gstin}</p>}
                  {model.entity?.cin && <p className="font-code text-xs text-[var(--muted)]">CIN {model.entity.cin}</p>}
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wider text-[var(--muted)]">{doc.type}</p>
                  <p className="font-code text-base font-semibold text-[var(--ink)]">{doc.number ?? doc.externalRef ?? doc.id}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Dated <DateText value={doc.date} />{(doc as { fy?: string }).fy ? ` · FY ${(doc as { fy?: string }).fy}` : ""}
                  </p>
                  <p className="text-xs text-[var(--muted)] capitalize">{doc.status}</p>
                </div>
              </div>

              <div className="h-px bg-[var(--line)]" />

              {/* parties */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-[var(--radius-sm)] border border-[var(--line)] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">From (seller)</p>
                  <p className="mt-1 text-sm font-medium text-[var(--ink)]">
                    {doc.seller?.name ?? model.supplier?.legalName ?? "—"}
                  </p>
                  {(doc.seller?.gstin ?? model.supplier?.gstins?.[0]?.gstin) && (
                    <p className="font-code mt-0.5 text-xs text-[var(--muted)]">GSTIN {doc.seller?.gstin ?? model.supplier?.gstins?.[0]?.gstin}</p>
                  )}
                </div>
                <div className="rounded-[var(--radius-sm)] border border-[var(--line)] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">To (buyer)</p>
                  <p className="mt-1 text-sm font-medium text-[var(--ink)]">{doc.buyer?.name ?? model.entity?.legalName ?? "—"}</p>
                  {doc.buyer?.gstin && <p className="font-code mt-0.5 text-xs text-[var(--muted)]">GSTIN {doc.buyer.gstin}</p>}
                </div>
              </div>

              {/* lines */}
              {doc.lines?.length ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-[var(--line)] text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
                      <th className="py-2 pr-2">#</th>
                      <th className="pr-2">Description</th>
                      <th className="pr-2">HSN</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Rate</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.lines.map((l) => (
                      <tr key={l.lineNo} className="border-b border-[var(--line)] last:border-0">
                        <td className="tnum py-2 pr-2 text-[var(--muted)]">{l.lineNo}</td>
                        <td className="pr-2 text-[var(--ink)]">{l.description}</td>
                        <td className="font-code pr-2 text-xs text-[var(--muted)]">{l.hsn ?? "—"}</td>
                        <td className="tnum text-right">{l.qty} {l.uom}</td>
                        <td className="tnum text-right">{l.rate ?? "—"}</td>
                        <td className="tnum text-right font-medium text-[var(--ink)]">{l.lineTotal ?? l.taxableValue ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              {/* totals */}
              {doc.totals && (
                <div className="ml-auto w-64 space-y-1 text-sm">
                  {doc.totals.taxable && <div className="flex justify-between"><span className="text-[var(--muted)]">Taxable value</span><span className="tnum"><Money value={{ amount: doc.totals.taxable, currency: "INR" }} /></span></div>}
                  {doc.totals.cgst && doc.totals.cgst !== "0" && <div className="flex justify-between"><span className="text-[var(--muted)]">CGST</span><span className="tnum"><Money value={{ amount: doc.totals.cgst, currency: "INR" }} /></span></div>}
                  {doc.totals.sgst && doc.totals.sgst !== "0" && <div className="flex justify-between"><span className="text-[var(--muted)]">SGST</span><span className="tnum"><Money value={{ amount: doc.totals.sgst, currency: "INR" }} /></span></div>}
                  {doc.totals.igst && doc.totals.igst !== "0" && <div className="flex justify-between"><span className="text-[var(--muted)]">IGST</span><span className="tnum"><Money value={{ amount: doc.totals.igst, currency: "INR" }} /></span></div>}
                  {doc.totals.grand && (
                    <div className="flex justify-between border-t border-[var(--line)] pt-2 text-base font-semibold text-[var(--ink)]">
                      <span>Total</span><span className="tnum"><Money value={{ amount: doc.totals.grand, currency: "INR" }} /></span>
                    </div>
                  )}
                  {model.amountInWords && <p className="pt-1 text-right text-[11px] italic text-[var(--muted)]">{model.amountInWords}</p>}
                </div>
              )}

              {/* terms */}
              {model.terms && Object.keys(model.terms).length > 0 && (
                <div className="rounded-[var(--radius-sm)] bg-[var(--surface-2)]/50 p-3 text-xs leading-relaxed text-[var(--ink-2)]">
                  {Object.entries(model.terms).map(([k, v]) => (
                    <p key={k}><span className="font-medium capitalize">{k.replaceAll(/([A-Z])/g, " $1").trim()}:</span> {String(v)}</p>
                  ))}
                </div>
              )}

              {/* verify footer */}
              {model.verify?.url && (
                <p className="flex items-center justify-center gap-1.5 border-t border-[var(--line)] pt-3 text-[11px] text-[var(--muted)]">
                  <ShieldCheck size={12} className="text-[var(--confirmed)]" /> Verify this document at <span className="font-code">{model.verify.url}</span>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
