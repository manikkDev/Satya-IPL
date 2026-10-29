"use client";

// PO creation wizard (/app/orders/new) — docs/plan/06 §5.3. Guided question
// stepper with a live document preview. Tax/totals are never computed in JS:
// step 5 calls POST /documents/:id/compute (mocked here) and shows the
// "Calculating…" state while waiting.

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, FileDown, CircleCheck, LoaderCircle, TriangleAlert, Plus, Trash2 } from "lucide-react";
import { useSession } from "@/components/v2/session";
import { mockEntities, mockSupplier } from "@/lib/mocks/flagship";
import { v2 } from "@/lib/api/v2";
const downloadDocumentPdf = async (...args: Parameters<typeof import("@/components/v2/po-pdf").downloadDocumentPdf>) =>
  (await import("@/components/v2/po-pdf")).downloadDocumentPdf(...args);
import { mocksEnabled } from "@/lib/flags";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const STEPS = ["Who is buying?", "Who is the supplier?", "What are you buying?", "Commercial terms", "Tax & totals", "Approvals", "Issue & share"];

type Line = { description: string; hsn: string; qty: string; uom: string; rate: string };

type ComputeResult = {
  lines: { lineNo: number; taxableValue: string; gstRate: string; cgst: string; sgst: string; igst: string; lineTotal: string }[];
  totals: { taxable: string; cgst: string; sgst: string; igst: string; roundOff: string; grand: string };
  taxType: "CGST+SGST" | "IGST";
  warnings: { code: string; message: string }[];
  amountInWords: string;
};

const SUPPLIERS = [
  { ...mockSupplier, paymentTermsDays: 30 },
  { id: "sup_kaveri", legalName: "Kaveri Valves Pvt Ltd", tradeName: "Kaveri Valves", gstin: "29AAKCK4412P1Z8", udyam: { number: "UDYAM-KA-08-0099887", category: "micro" as const }, paymentTermsDays: 45 },
  { id: "sup_deccan", legalName: "Deccan Bearings & Tools", tradeName: "Deccan", gstin: "27AAFCD2210R1Z3", paymentTermsDays: 30 },
];

const stateOf = (gstin?: string) => (gstin ? gstin.slice(0, 2) : undefined);

// Mock of POST /documents/:id/compute — stands in for the engine's Decimal
// output. String math only for display; real builds call the API.
function mockCompute(lines: Line[], intraState: boolean): Promise<ComputeResult> {
  return new Promise((resolve) =>
    setTimeout(() => {
      const computed = lines.map((line, i) => {
        const qty = Number(line.qty || 0);
        const rate = Number(line.rate || 0);
        const taxable = qty * rate;
        const tax = taxable * 0.18;
        const half = tax / 2;
        return {
          lineNo: i + 1,
          taxableValue: taxable.toFixed(2),
          gstRate: "18",
          cgst: intraState ? half.toFixed(2) : "0.00",
          sgst: intraState ? half.toFixed(2) : "0.00",
          igst: intraState ? "0.00" : tax.toFixed(2),
          lineTotal: (taxable + tax).toFixed(2),
        };
      });
      const sum = (key: "taxableValue" | "cgst" | "sgst" | "igst" | "lineTotal") =>
        computed.reduce((acc, line) => acc + Number(line[key]), 0).toFixed(2);
      const warnings: { code: string; message: string }[] = [];
      if (Number(sum("lineTotal")) > 50000) warnings.push({ code: "EWAY_BILL", message: "E-way bill will be required (value over ₹50,000)." });
      warnings.push({ code: "HSN_CONFIRM", message: "GST rate comes from the HSN master — confirm it matches your item." });
      resolve({
        lines: computed,
        totals: { taxable: sum("taxableValue"), cgst: sum("cgst"), sgst: sum("sgst"), igst: sum("igst"), roundOff: "0.00", grand: sum("lineTotal") },
        taxType: intraState ? "CGST+SGST" : "IGST",
        warnings,
        amountInWords: "computed by the engine — shown here from POST /documents/:id/compute",
      });
    }, 600),
  );
}

const inputCls = "h-9 w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]";
const labelCls = "mb-1 block text-xs font-medium text-[var(--muted)]";

/** Debounced HSN picker — real /api/v2/hsn/search outside mocks, curated list inside. */
function HsnField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<{ code: string; description: string; rate?: string | null }[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(null);
  const MOCK_HSN = [
    { code: "8413", description: "Pumps for liquids", rate: "18" },
    { code: "8414", description: "Air/vacuum pumps, compressors", rate: "18" },
    { code: "8481", description: "Taps, cocks, valves", rate: "18" },
    { code: "7318", description: "Screws, bolts, nuts", rate: "18" },
    { code: "8501", description: "Electric motors and generators", rate: "18" },
  ];
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const search = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      if (mocksEnabled()) {
        setResults(MOCK_HSN.filter((h) => h.code.startsWith(q.trim()) || h.description.toLowerCase().includes(q.trim().toLowerCase())));
      } else {
        try {
          const { items } = await v2.hsnSearch(q.trim());
          setResults(items.map((i) => ({ code: i.code, description: i.description, rate: i.rate })));
        } catch { setResults([]); }
      }
      setOpen(true);
    }, 250);
  };
  return (
    <div className="relative">
      <label className={labelCls}>HSN code</label>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); search(e.target.value); }}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="e.g. 8413 or “pump”"
        aria-label="HSN code"
        role="combobox"
        aria-expanded={open}
        aria-controls="hsn-listbox"
        aria-autocomplete="list"
        className={inputCls}
      />
      {open && results.length > 0 && (
        <ul id="hsn-listbox" role="listbox" className="absolute z-20 mt-1 max-h-44 w-full overflow-auto rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-1)]">
          {results.map((r) => (
            <li key={r.code}>
              <button
                type="button"
                role="option"
                aria-selected={r.code === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(r.code); setOpen(false); }}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--accent-soft)]"
              >
                <span className="font-code font-medium text-[var(--ink)]">{r.code}</span>
                <span className="ml-2 text-[var(--muted)]">{r.description}</span>
                {r.rate != null && <span className="ml-2 text-[var(--accent-strong)]">· {r.rate}%</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function NewOrderPage() {
  const router = useRouter();
  const { entities, activeEntity } = useSession();
  const [step, setStep] = useState(0);
  const [entityId, setEntityId] = useState(activeEntity?.id ?? mockEntities[0].id);
  const [supplierId, setSupplierId] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [costCentre, setCostCentre] = useState("");
  const [lines, setLines] = useState<Line[]>([{ description: "", hsn: "", qty: "", uom: "NOS", rate: "" }]);
  const [terms, setTerms] = useState({ creditDays: "30", advancePct: "0", deliveryTerms: "FOR destination", inspection: "On receipt", warranty: "12" });
  const [compute, setCompute] = useState<ComputeResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [issued, setIssued] = useState<{ number?: string; verifyUrl?: string } | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: supplierPage } = useQuery({ queryKey: ["suppliers"], queryFn: () => v2.suppliers() });
  const supplierList = mocksEnabled() ? SUPPLIERS : supplierPage?.items?.length ? supplierPage.items : SUPPLIERS;
  const entity = entities.find((e) => e.id === entityId) ?? mockEntities[0];
  const supplier = supplierList.find((s) => s.id === supplierId);
  const intraState = supplier ? stateOf(supplier.gstin) === entity.stateCode : true;
  const canNext =
    (step === 0 && !!entityId) ||
    (step === 1 && !!supplierId) ||
    (step === 2 && lines.every((l) => l.description && l.qty && l.rate)) ||
    step >= 3;

  const runCompute = async () => {
    setComputing(true);
    setActionError(null);
    try {
      if (!mocksEnabled()) {
        // Real path: create the draft once, then compute via engine proxy.
        let id = docId;
        if (!id) {
          const draft = await v2.createDraft({
            type: "PO", entityId, supplierId,
            date: new Date().toISOString().slice(0, 10),
            lines: lines.map((l, i) => ({ lineNo: i + 1, description: l.description, hsn: l.hsn || undefined, qty: l.qty, uom: l.uom, rate: l.rate })),
            terms,
          });
          id = draft.id;
          setDocId(id);
        } else {
          await v2.patchDocument(id, {
            lines: lines.map((l, i) => ({ lineNo: i + 1, description: l.description, hsn: l.hsn || undefined, qty: l.qty, uom: l.uom, rate: l.rate })),
            terms,
          });
        }
        const result = (await v2.documentAction(id, "compute")) as {
          lines?: { lineNo: number; taxableValue: string; gstRate: string; cgst: string; sgst: string; igst: string; lineTotal: string }[];
          totals?: { taxable: string; cgst: string; sgst: string; igst: string; roundOff?: string; grand: string };
          taxType?: string; warnings?: { code: string; message: string }[];
        };
        setCompute({
          lines: result.lines ?? [],
          totals: {
            taxable: result.totals?.taxable ?? "0.00", cgst: result.totals?.cgst ?? "0.00",
            sgst: result.totals?.sgst ?? "0.00", igst: result.totals?.igst ?? "0.00",
            roundOff: result.totals?.roundOff ?? "0.00", grand: result.totals?.grand ?? "0.00",
          },
          taxType: (result.taxType === "IGST" ? "IGST" : "CGST+SGST") as ComputeResult["taxType"],
          warnings: result.warnings ?? [],
          amountInWords: "",
        });
      } else {
        setCompute(await mockCompute(lines, intraState));
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Compute failed");
    } finally {
      setComputing(false);
    }
  };

  const submitForApproval = async () => {
    if (mocksEnabled()) { setStep(6); return; }
    if (!docId) return;
    try {
      await v2.documentAction(docId, "submit");
      setStep(6);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Submit failed");
    }
  };

  const issuePo = async () => {
    if (mocksEnabled()) { setIssued({ number: `${entity.code}/PO/26-27/000127` }); return; }
    if (!docId) return;
    try {
      const result = (await v2.documentAction(docId, "issue")) as { number?: string; verifyUrl?: string };
      setIssued({ number: result.number, verifyUrl: result.verifyUrl });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Issue failed");
    }
  };

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((line, index) => (index === i ? { ...line, ...patch } : line)));

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
      {/* left: wizard */}
      <div className="xl:col-span-3">
        <button type="button" onClick={() => router.back()} className="mb-3 inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
          <ArrowLeft size={15} /> Back
        </button>
        <h1 className="text-[22px] font-semibold text-[var(--ink)]">New purchase order</h1>

        {/* stepper */}
        <ol className="mt-4 flex flex-wrap gap-1.5" aria-label="Progress">
          {STEPS.map((name, i) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => i < step && setStep(i)}
                aria-current={i === step ? "step" : undefined}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium",
                  i === step ? "bg-[var(--accent)] text-white" : i < step ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "bg-[var(--surface-2)] text-[var(--muted)]",
                )}
              >
                {i < step ? "✓ " : `${i + 1}. `}{name}
              </button>
            </li>
          ))}
        </ol>

        <div className="mt-5 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-6">
          {step === 0 && (
            <fieldset>
              <legend className="text-base font-semibold text-[var(--ink)]">Who is buying?</legend>
              <div className="mt-4 space-y-4">
                <div>
                  <label className={labelCls} htmlFor="entity">Entity (billing GSTIN)</label>
                  <select id="entity" value={entityId} onChange={(e) => setEntityId(e.target.value)} className={inputCls}>
                    {entities.map((e) => <option key={e.id} value={e.id}>{e.legalName} · {e.gstin}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls} htmlFor="cost">Cost centre</label>
                  <input id="cost" value={costCentre} onChange={(e) => setCostCentre(e.target.value)} placeholder="e.g. Maintenance — Plant 2" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="reqby">Required by</label>
                  <input id="reqby" type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} className={inputCls} />
                </div>
                <p className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--muted)]">
                  Place of supply comes from the ship-to state — it decides whether CGST+SGST or IGST applies.
                </p>
              </div>
            </fieldset>
          )}

          {step === 1 && (
            <fieldset>
              <legend className="text-base font-semibold text-[var(--ink)]">Who is the supplier?</legend>
              <div className="mt-4 space-y-2">
                {supplierList.map((s) => (
                  <label key={s.id} className={cn("flex cursor-pointer items-start gap-3 rounded-[var(--radius-sm)] border p-3", supplierId === s.id ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)]")}>
                    <input type="radio" name="supplier" checked={supplierId === s.id} onChange={() => setSupplierId(s.id)} className="mt-1 accent-[var(--accent)]" />
                    <span>
                      <span className="block text-sm font-medium text-[var(--ink)]">{s.legalName}</span>
                      <span className="mt-0.5 block font-code text-xs text-[var(--muted)]">GSTIN {s.gstin} · well-formed</span>
                      {s.udyam && (
                        <span className="mt-1 inline-block rounded-full bg-[var(--likely-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--likely)]" title="Micro, small or medium enterprise — payment within 45 days is a legal duty.">
                          {s.udyam.category} enterprise (Udyam {s.udyam.number})
                        </span>
                      )}
                    </span>
                  </label>
                ))}
                <button type="button" className="text-xs font-medium text-[var(--accent)]">+ Add a new supplier</button>
                {supplier && (
                  <p className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink-2)]">
                    {intraState ? "Same state as your entity — CGST + SGST will apply." : "Different state — IGST will apply."}
                    {" "}Default terms: {supplier.paymentTermsDays} days.
                  </p>
                )}
              </div>
            </fieldset>
          )}

          {step === 2 && (
            <fieldset>
              <legend className="text-base font-semibold text-[var(--ink)]">What are you buying?</legend>
              <div className="mt-4 space-y-4">
                {lines.map((line, i) => (
                  <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--line)] p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-[var(--muted)]">Line {i + 1}</p>
                      {lines.length > 1 && (
                        <button type="button" onClick={() => setLines((prev) => prev.filter((_, x) => x !== i))} aria-label={`Remove line ${i + 1}`} className="text-[var(--muted)] hover:text-[var(--sev-critical)]">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className={labelCls}>Description</label>
                        <input value={line.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="e.g. Centrifugal pump 1 kW, model CP-100" className={inputCls} />
                      </div>
                      <div>
                        <HsnField value={line.hsn} onChange={(v) => setLine(i, { hsn: v })} />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className={labelCls}>Qty</label>
                          <input value={line.qty} onChange={(e) => setLine(i, { qty: e.target.value })} inputMode="decimal" className={inputCls} />
                        </div>
                        <div>
                          <label className={labelCls}>UOM</label>
                          <select value={line.uom} onChange={(e) => setLine(i, { uom: e.target.value })} className={inputCls}>
                            {["NOS", "EA", "BOX", "SET", "M", "KG", "L", "PAIR", "ROLL", "LOT"].map((u) => <option key={u}>{u}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={labelCls}>Rate ₹</label>
                          <input value={line.rate} onChange={(e) => setLine(i, { rate: e.target.value })} inputMode="decimal" className={inputCls} />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => setLines((prev) => [...prev, { description: "", hsn: "", qty: "", uom: "NOS", rate: "" }])} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)]">
                  <Plus size={13} /> Add another item
                </button>
              </div>
            </fieldset>
          )}

          {step === 3 && (
            <fieldset>
              <legend className="text-base font-semibold text-[var(--ink)]">Commercial terms</legend>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Advance % (against PI)</label>
                  <input value={terms.advancePct} onChange={(e) => setTerms({ ...terms, advancePct: e.target.value })} inputMode="decimal" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Balance credit days</label>
                  <input value={terms.creditDays} onChange={(e) => setTerms({ ...terms, creditDays: e.target.value })} inputMode="numeric" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Delivery terms</label>
                  <select value={terms.deliveryTerms} onChange={(e) => setTerms({ ...terms, deliveryTerms: e.target.value })} className={inputCls}>
                    {["FOR destination", "Ex-works", "Other"].map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Inspection</label>
                  <select value={terms.inspection} onChange={(e) => setTerms({ ...terms, inspection: e.target.value })} className={inputCls}>
                    {["On receipt", "Pre-dispatch", "None"].map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Warranty (months)</label>
                  <input value={terms.warranty} onChange={(e) => setTerms({ ...terms, warranty: e.target.value })} inputMode="numeric" className={inputCls} />
                </div>
              </div>
              <p className="mt-4 rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--muted)]">
                These are sample clauses — review with your legal adviser.
              </p>
            </fieldset>
          )}

          {step === 4 && (
            <fieldset>
              <legend className="text-base font-semibold text-[var(--ink)]">Tax & totals</legend>
              {!compute ? (
                <div className="mt-4">
                  <p className="text-sm text-[var(--ink-2)]">
                    Totals are computed by the engine (POST /documents/:id/compute) — never in the browser.
                  </p>
                  <button
                    type="button"
                    onClick={runCompute}
                    disabled={computing}
                    className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {computing ? <LoaderCircle size={15} className="animate-spin" /> : null}
                    {computing ? "Calculating…" : "Compute tax & totals"}
                  </button>
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <p className="text-xs text-[var(--muted)]">Supply type: <span className="font-medium text-[var(--ink)]">{compute.taxType}</span> · amounts computed by the engine</p>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-[var(--muted)]"><th className="py-1">Line</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total</th></tr></thead>
                    <tbody className="tnum">
                      {compute.lines.map((line) => (
                        <tr key={line.lineNo} className="border-t border-[var(--line)] text-[var(--ink-2)]">
                          <td className="py-1.5">{line.lineNo}</td><td>{formatMoney(line.taxableValue)}</td><td>{formatMoney(line.cgst)}</td><td>{formatMoney(line.sgst)}</td><td>{formatMoney(line.igst)}</td><td className="font-medium text-[var(--ink)]">{formatMoney(line.lineTotal)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-[var(--ink)] font-semibold text-[var(--ink)]">
                        <td className="py-2">Grand total</td><td>{formatMoney(compute.totals.taxable)}</td><td>{formatMoney(compute.totals.cgst)}</td><td>{formatMoney(compute.totals.sgst)}</td><td>{formatMoney(compute.totals.igst)}</td><td>{formatMoney(compute.totals.grand)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <ul className="space-y-1.5">
                    {compute.warnings.map((warning) => (
                      <li key={warning.code} className="flex items-start gap-2 text-xs text-[var(--possible)]">
                        <TriangleAlert size={13} className="mt-0.5 shrink-0" /> {warning.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </fieldset>
          )}

          {step === 5 && (
            <fieldset>
              <legend className="text-base font-semibold text-[var(--ink)]">Approvals</legend>
              <div className="mt-4 rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-4 text-sm text-[var(--ink-2)]">
                {compute && Number(compute.totals.grand) > 1000000 ? (
                  <p>Needs approval from <strong>Plant Head</strong> because value is over ₹10 lakh (your delegation rules).</p>
                ) : (
                  <p>Needs approval from <strong>AP Manager</strong> per your delegation rules.</p>
                )}
                <p className="mt-1 text-xs text-[var(--muted)]">You cannot approve a purchase order you created — another approver must sign off.</p>
              </div>
              {actionError && <p className="mt-3 text-xs text-[var(--sev-critical)]">{actionError}</p>}
              <button
                type="button"
                onClick={submitForApproval}
                disabled={!mocksEnabled() && !docId}
                className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Submit for approval <ArrowRight size={15} />
              </button>
            </fieldset>
          )}

          {step === 6 && (
            <fieldset>
              <legend className="text-base font-semibold text-[var(--ink)]">Issue & share</legend>
              {!issued ? (
                <div className="mt-4">
                  <p className="flex items-center gap-2 text-sm text-[var(--confirmed)]"><CircleCheck size={16} /> Approved by AP Manager{!mocksEnabled() ? " (submitted)" : " (demo)"}</p>
                  {actionError && <p className="mt-3 text-xs text-[var(--sev-critical)]">{actionError}</p>}
                  <button
                    type="button"
                    onClick={issuePo}
                    className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
                  >
                    Issue purchase order
                  </button>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <p className="text-sm text-[var(--ink-2)]">Issued as <span className="font-code font-medium text-[var(--ink)]">{issued.number ?? `${entity.code}/PO/26-27/000127`}</span></p>
                  {issued.verifyUrl && <p className="text-xs text-[var(--muted)]">Verify: <span className="font-code">{issued.verifyUrl}</span></p>}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        const model = await v2.renderModel(docId ?? "doc_po1001");
                        await downloadDocumentPdf(model);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)]"
                    >
                      <FileDown size={13} /> Download PDF
                    </button>
                    {issued.verifyUrl && (
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(issued.verifyUrl!)}
                        className="rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)]"
                      >
                        Copy verify link
                      </button>
                    )}
                    <button type="button" onClick={() => window.print()} className="rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)]">Print</button>
                  </div>
                  <button type="button" onClick={() => router.push("/app/orders")} className="text-xs font-medium text-[var(--accent)]">Done — back to orders</button>
                </div>
              )}
            </fieldset>
          )}

          {/* nav */}
          {step < 5 && (
            <div className="mt-6 flex justify-between border-t border-[var(--line)] pt-4">
              <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="text-sm text-[var(--muted)] disabled:opacity-40">
                ← Previous
              </button>
              <button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                disabled={!canNext || (step === 4 && !compute)}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Next <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* right: live preview */}
      <aside className="xl:col-span-2" aria-label="Document preview">
        <div className="sticky top-20 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)]">
          <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
            <div>
              <p className="font-semibold text-[var(--ink)]">{entity.legalName}</p>
              <p className="font-code text-[10px] text-[var(--muted)]">GSTIN {entity.gstin}</p>
            </div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Purchase order · draft</p>
          </div>
          <dl className="mt-3 space-y-1.5 text-xs">
            <div className="flex justify-between"><dt className="text-[var(--muted)]">Supplier</dt><dd className="text-[var(--ink)]">{supplier?.legalName ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--muted)]">Required by</dt><dd className="text-[var(--ink)]">{requiredBy || "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--muted)]">Cost centre</dt><dd className="text-[var(--ink)]">{costCentre || "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--muted)]">Payment terms</dt><dd className="text-[var(--ink)]">{terms.advancePct !== "0" ? `${terms.advancePct}% advance, ` : ""}{terms.creditDays} days</dd></div>
          </dl>
          <table className="mt-3 w-full text-xs">
            <thead><tr className="border-y border-[var(--line)] text-left text-[var(--muted)]"><th className="py-1.5">Item</th><th>Qty</th><th>Rate</th></tr></thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="border-b border-[var(--line)] text-[var(--ink-2)]">
                  <td className="py-1.5">{line.description || "—"}{line.hsn ? <span className="block font-code text-[10px] text-[var(--muted)]">HSN {line.hsn}</span> : null}</td>
                  <td className="tnum">{line.qty || "—"} {line.uom}</td>
                  <td className="tnum">{line.rate ? `₹${line.rate}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {compute && (
            <div className="mt-3 border-t border-[var(--line)] pt-3 text-right">
              <p className="text-xs text-[var(--muted)]">{compute.taxType} · grand total</p>
              <p className="tnum text-xl font-semibold text-[var(--ink)]">{formatMoney(compute.totals.grand)}</p>
            </div>
          )}
          <p className="mt-4 flex items-center gap-1.5 border-t border-[var(--line)] pt-3 text-[10px] text-[var(--muted)]">
            <Check size={11} /> Autosaves as a draft — totals always come from the engine.
          </p>
        </div>
      </aside>
    </div>
  );
}
