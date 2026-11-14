"use client";

// PO creation wizard (/app/orders/new) — docs/plan/06 §5.3. Guided question
// stepper with a live document preview. Tax/totals are never computed in JS:
// step 5 calls POST /documents/:id/compute (mocked here) and shows the
// "Calculating…" state while waiting.

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, FileDown, CircleCheck, LoaderCircle, TriangleAlert, Plus, Trash2 } from "lucide-react";
import { useSession } from "@/components/v2/session";
import { mockEntities, mockSupplier } from "@/lib/mocks/flagship";
import { v2 } from "@/lib/api/v2";
const downloadDocumentPdf = async (...args: Parameters<typeof import("@/components/v2/po-pdf").downloadDocumentPdf>) =>
  (await import("@/components/v2/po-pdf")).downloadDocumentPdf(...args);
import { mocksEnabled } from "@/lib/flags";
import { formatMoney, isoDateIst } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FadeIn } from "@/components/ui/v2";

const STEPS = ["Who is buying?", "Who is the supplier?", "What are you buying?", "Commercial terms", "Tax & totals", "Approvals", "Issue & share"];

type Line = { description: string; hsn: string; gstRate: string; qty: string; uom: string; rate: string };

const emptyLine = (): Line => ({ description: "", hsn: "", gstRate: "", qty: "", uom: "NOS", rate: "" });
const QTY_RE = /^\d+(\.\d{1,3})?$/;
const RATE_RE = /^\d+(\.\d{1,2})?$/;

type ComputeResult = {
  lines: { lineNo: number; taxableValue: string; gstRate: string; cgst: string; sgst: string; igst: string; lineTotal: string }[];
  totals: { taxable: string; cgst: string; sgst: string; igst: string; roundOff: string; grand: string };
  taxType: "CGST+SGST" | "IGST";
  warnings: { code: string; message: string }[];
  amountInWords: string;
};

// Mock-mode suppliers only (NEXT_PUBLIC_USE_MOCKS=1). Real mode lists the
// company's supplier master and never falls back to these.
const MOCK_SUPPLIERS = [{ ...mockSupplier, paymentTermsDays: 30 }];

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

const inputCls = "h-10 w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface-2)]/50 px-3 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)] focus:bg-[var(--surface)] placeholder:text-[var(--muted)]";
const labelCls = "mb-1 block text-xs font-medium text-[var(--muted)]";

/** Debounced HSN picker — real /api/v2/hsn/search outside mocks, curated list inside. */
function HsnField({ value, onChange, onPick }: { value: string; onChange: (v: string) => void; onPick?: (code: string, rate?: string | null) => void }) {
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
                onClick={() => { onChange(r.code); onPick?.(r.code, r.rate); setOpen(false); }}
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
  const [entityId, setEntityId] = useState(activeEntity?.id ?? (mocksEnabled() ? mockEntities[0].id : ""));
  useEffect(() => {
    if (!entityId && activeEntity?.id) setEntityId(activeEntity.id);
  }, [activeEntity?.id, entityId]);
  const [supplierId, setSupplierId] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [costCentre, setCostCentre] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [terms, setTerms] = useState({ creditDays: "30", advancePct: "0", deliveryTerms: "FOR destination", inspection: "On receipt", warranty: "12" });
  const [compute, setCompute] = useState<ComputeResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [issued, setIssued] = useState<{ number?: string; verifyUrl?: string } | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [docRevision, setDocRevision] = useState(0);
  const [docStatus, setDocStatus] = useState<string>("draft");
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: supplierPage, isLoading: suppliersLoading } = useQuery({ queryKey: ["suppliers", "wizard"], queryFn: () => v2.suppliers(), enabled: !mocksEnabled() });
  const supplierList = mocksEnabled() ? MOCK_SUPPLIERS : (supplierPage?.items ?? []);
  const entity = entities.find((e) => e.id === entityId) ?? (mocksEnabled() ? mockEntities[0] : undefined);
  const supplier = supplierList.find((s) => s.id === supplierId);
  const intraState = supplier && entity ? stateOf(supplier.gstin) === entity.stateCode : true;
  const linesValid = lines.every((l) => l.description.trim() && QTY_RE.test(l.qty) && Number(l.qty) > 0 && RATE_RE.test(l.rate));
  const canNext =
    (step === 0 && !!entity) ||
    (step === 1 && !!supplier) ||
    (step === 2 && linesValid) ||
    step >= 3;

  // Any edit after computing invalidates the totals — they must be recomputed.
  const inputsKey = JSON.stringify({ entityId, supplierId, lines, terms, requiredBy, costCentre });
  const computedFor = useRef<string | null>(null);
  useEffect(() => {
    if (compute && computedFor.current !== inputsKey) setCompute(null);
  }, [inputsKey, compute]);

  const draftBody = () => {
    const termsBody = {
      creditDays: Number.parseInt(terms.creditDays || "0", 10) || 0,
      advancePct: RATE_RE.test(terms.advancePct) ? terms.advancePct : "0",
      deliveryTerms: terms.deliveryTerms,
      inspection: terms.inspection,
      warranty: terms.warranty ? `${terms.warranty} months` : undefined,
      ...(costCentre.trim() ? { freeText: [`Cost centre: ${costCentre.trim()}`] } : {}),
    };
    return {
      date: isoDateIst(),
      seller: {
        name: supplier!.legalName,
        ...(supplier!.gstin ? { gstin: supplier!.gstin, stateCode: stateOf(supplier!.gstin) } : {}),
        supplierId: supplier!.id,
        ...(supplier!.udyam?.number && supplier!.udyam?.category ? { udyam: { number: supplier!.udyam.number, category: supplier!.udyam.category } } : {}),
      },
      buyer: {
        name: entity!.legalName,
        ...(entity!.gstin ? { gstin: entity!.gstin } : {}),
        ...(entity!.stateCode ? { stateCode: entity!.stateCode } : {}),
      },
      supplierId: supplier!.id,
      ...(entity!.stateCode ? { placeOfSupply: entity!.stateCode } : {}),
      lines: lines.map((l, i) => ({
        lineNo: i + 1,
        description: l.description.trim(),
        ...(l.hsn ? { hsn: l.hsn } : {}),
        ...(l.gstRate ? { gstRate: l.gstRate } : {}),
        qty: l.qty,
        uom: l.uom,
        rate: l.rate,
        ...(requiredBy ? { scheduleDate: requiredBy } : {}),
      })),
      terms: termsBody,
    };
  };

  const runCompute = async () => {
    setComputing(true);
    setActionError(null);
    try {
      if (!mocksEnabled()) {
        // Real path: create the draft once, then compute via engine proxy.
        let id = docId;
        const body = draftBody();
        if (!id) {
          const draft = await v2.createDraft({ type: "PO", entityId: entity!.id, ...body });
          id = draft.id;
          setDocId(id);
          setDocRevision(Number((draft as { revision?: number }).revision ?? 0));
        } else {
          const { date: _date, ...patch } = body;
          void _date;
          const updated = await v2.patchDocument(id, { expectedRevision: docRevision, patch });
          setDocRevision(Number((updated as { revision?: number }).revision ?? docRevision + 1));
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
        computedFor.current = inputsKey;
      } else {
        setCompute(await mockCompute(lines, intraState));
        computedFor.current = inputsKey;
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Totals couldn’t be computed. Check the lines and try again.");
    } finally {
      setComputing(false);
    }
  };

  const submitForApproval = async () => {
    if (mocksEnabled()) { setStep(6); return; }
    if (!docId) return;
    try {
      const result = (await v2.documentAction(docId, "submit")) as { status?: string };
      setDocStatus(result?.status ?? "submitted");
      setActionError(null);
      toast.success("Sent for approval");
      setStep(6);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Submit failed");
    }
  };

  const refreshStatus = async () => {
    if (!docId) return;
    try {
      const doc = await v2.document(docId);
      setDocStatus(String(doc.status));
    } catch {
      toast.error("Couldn’t refresh the approval status.");
    }
  };

  const issuePo = async () => {
    if (mocksEnabled()) { setIssued({ number: `${entity?.code ?? "DEMO"}/PO/26-27/000127` }); return; }
    if (!docId) return;
    try {
      const result = (await v2.documentAction(docId, "issue")) as { number?: string; verifyUrl?: string };
      setIssued({ number: result.number, verifyUrl: result.verifyUrl });
      toast.success(`Issued ${result.number ?? "purchase order"}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Issue failed");
    }
  };

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((line, index) => (index === i ? { ...line, ...patch } : line)));

  return (
    <FadeIn className="grid grid-cols-1 gap-6 xl:grid-cols-5">
      {/* left: wizard */}
      <div className="xl:col-span-3">
        <button type="button" onClick={() => router.back()} className="mb-3 inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
          <ArrowLeft size={15} /> Back
        </button>
        <h1 className="type-page-title">New purchase order</h1>

        {/* stepper */}
        <ol className="mt-4 flex flex-wrap gap-1.5" aria-label="Progress">
          {STEPS.map((name, i) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => i < step && setStep(i)}
                aria-current={i === step ? "step" : undefined}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[13px] font-medium transition-all",
                  i === step ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]" : i < step ? "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-strong)] cursor-pointer hover:border-[var(--accent)]/60" : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted)]",
                )}
              >
                {i < step ? "✓ " : `${i + 1}. `}{name}
              </button>
            </li>
          ))}
        </ol>

        <div className="mt-5 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--shadow-1)]">
          {step === 0 && (
            <fieldset>
              <legend className="text-base font-semibold text-[var(--ink)]">Who is buying?</legend>
              <div className="mt-4 space-y-4">
                <div>
                  <label className={labelCls} htmlFor="entity">Entity (billing GSTIN)</label>
                  <select id="entity" value={entityId} onChange={(e) => setEntityId(e.target.value)} className={inputCls}>
                    {entities.length === 0 ? <option value="">Loading your entities…</option> : null}
                    {entities.map((e) => <option key={e.id} value={e.id}>{e.legalName}{e.gstin ? ` · ${e.gstin}` : ""}</option>)}
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
                {!mocksEnabled() && suppliersLoading ? <p className="text-sm text-[var(--muted)]">Loading your suppliers…</p> : null}
                {!mocksEnabled() && !suppliersLoading && supplierList.length === 0 ? (
                  <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--line-strong)] px-4 py-6 text-center text-sm text-[var(--muted)]">
                    No suppliers in your master yet. <Link href="/app/suppliers" className="font-medium text-[var(--accent)] hover:underline">Open Suppliers</Link>
                  </p>
                ) : null}
                {supplierList.map((s) => (
                  <label key={s.id} className={cn("flex cursor-pointer items-start gap-3 rounded-[var(--radius-sm)] border p-3", supplierId === s.id ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)]")}>
                    <input type="radio" name="supplier" checked={supplierId === s.id} onChange={() => setSupplierId(s.id)} className="mt-1 accent-[var(--accent)]" />
                    <span>
                      <span className="block text-sm font-medium text-[var(--ink)]">{s.legalName}</span>
                      <span className="mt-0.5 block font-code text-xs text-[var(--muted)]">{s.gstin ? `GSTIN ${s.gstin}` : "No GSTIN on file"}</span>
                      {s.udyam && (
                        <span className="mt-1 inline-block rounded-full bg-[var(--likely-soft)] px-2 py-0.5 text-[13px] font-medium capitalize text-[var(--likely)]" title="Micro and small enterprises must be paid within 45 days of acceptance.">
                          {s.udyam.category} enterprise (Udyam {s.udyam.number})
                        </span>
                      )}
                    </span>
                  </label>
                ))}
                <Link href="/app/suppliers" className="inline-block text-xs font-medium text-[var(--accent)] hover:underline">Manage suppliers →</Link>
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
                        <HsnField value={line.hsn} onChange={(v) => setLine(i, { hsn: v, gstRate: "" })} onPick={(code, rate) => setLine(i, { hsn: code, gstRate: rate ?? "" })} />
                        {line.gstRate ? <p className="mt-1 text-xs text-[var(--muted)]">GST {line.gstRate}% from the HSN master — confirm it fits your item.</p> : null}
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
                <button type="button" onClick={() => setLines((prev) => [...prev, emptyLine()])} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)]">
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
                    Satya saves this as a draft and computes GST and totals on the server — never in the browser.
                  </p>
                  <button
                    type="button"
                    onClick={runCompute}
                    disabled={computing}
                    className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:opacity-50"
                  >
                    {computing ? <LoaderCircle size={15} className="animate-spin" /> : null}
                    {computing ? "Calculating…" : "Compute tax & totals"}
                  </button>
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <p className="text-xs text-[var(--muted)]">Supply type: <span className="font-medium text-[var(--ink)]">{compute.taxType}</span> · amounts computed by the engine</p>
                  <div className="table-scroll"><table className="w-full text-sm">
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
                  </table></div>
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
                <p>Submitting routes this order to the approver set by your company’s delegation-of-authority policy for {compute ? formatMoney(compute.totals.grand) : "this value"}.</p>
                <p className="mt-1 text-xs text-[var(--muted)]">You can’t approve an order you created — another approver must sign off.</p>
              </div>
              {actionError && <p className="mt-3 text-xs text-[var(--sev-critical)]">{actionError}</p>}
              <button
                type="button"
                onClick={submitForApproval}
                disabled={!mocksEnabled() && !docId}
                className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:opacity-50"
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
                  {mocksEnabled() || docStatus === "approved" ? (
                    <p className="flex items-center gap-2 text-sm text-[var(--confirmed)]"><CircleCheck size={16} /> Approved — ready to issue</p>
                  ) : (
                    <div className="rounded-[var(--radius-sm)] bg-[var(--possible-soft)] px-4 py-3 text-sm text-[var(--ink-2)]">
                      <p className="font-medium text-[var(--ink)]">Waiting for approval</p>
                      <p className="mt-1 text-xs">Status: {docStatus.replaceAll("_", " ")}. An approver reviews it from the order page; you can issue it once approved.</p>
                      <div className="mt-3 flex flex-wrap gap-3 text-xs font-medium">
                        <button type="button" onClick={refreshStatus} className="text-[var(--accent)] hover:underline">Check status</button>
                        {docId ? <Link href={`/app/orders/${docId}`} className="text-[var(--accent)] hover:underline">Open the order</Link> : null}
                      </div>
                    </div>
                  )}
                  {actionError && <p className="mt-3 text-xs text-[var(--sev-critical)]">{actionError}</p>}
                  <button
                    type="button"
                    onClick={issuePo}
                    disabled={!mocksEnabled() && docStatus !== "approved"}
                    className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:opacity-50"
                  >
                    Issue purchase order
                  </button>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <p className="text-sm text-[var(--ink-2)]">Issued as <span className="font-code font-medium text-[var(--ink)]">{issued.number ?? "—"}</span></p>
                  {issued.verifyUrl && <p className="text-xs text-[var(--muted)]">Verify: <span className="font-code">{issued.verifyUrl}</span></p>}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!docId}
                      onClick={async () => {
                        if (!docId) return;
                        try {
                          await downloadDocumentPdf(await v2.renderModel(docId));
                        } catch {
                          toast.error("The PDF couldn’t be generated right now.");
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)]"
                    >
                      <FileDown size={13} /> Download PDF
                    </button>
                    {issued.verifyUrl && (
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(issued.verifyUrl!).then(() => toast.success("Verify link copied"))}
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
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:opacity-50"
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
              <p className="font-semibold text-[var(--ink)]">{entity?.legalName ?? "—"}</p>
              <p className="font-code text-[13px] text-[var(--muted)]">{entity?.gstin ? `GSTIN ${entity.gstin}` : "GSTIN not set"}</p>
            </div>
            <p className="text-xs font-semiboldr text-[var(--muted)]">Purchase order · draft</p>
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
                  <td className="py-1.5">{line.description || "—"}{line.hsn ? <span className="block font-code text-[13px] text-[var(--muted)]">HSN {line.hsn}{line.gstRate ? ` · ${line.gstRate}%` : ""}</span> : null}</td>
                  <td className="tnum">{line.qty || "—"} {line.uom}</td>
                  <td className="tnum">{line.rate ? formatMoney(line.rate) : "—"}</td>
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
          <p className="mt-4 flex items-center gap-1.5 border-t border-[var(--line)] pt-3 text-[13px] text-[var(--muted)]">
            <Check size={11} /> Saved as a draft when you compute totals · GST is calculated on the server.
          </p>
        </div>
      </aside>
    </FadeIn>
  );
}
