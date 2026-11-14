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
import { ArrowLeft, ArrowRight, Check, FileDown, LoaderCircle, TriangleAlert, Plus, Trash2 } from "lucide-react";
import { useSession } from "@/components/v2/session";
import { mockEntities, mockSupplier } from "@/lib/mocks/flagship";
import { v2 } from "@/lib/api/v2";
const downloadDocumentPdf = async (...args: Parameters<typeof import("@/components/v2/po-pdf").downloadDocumentPdf>) =>
  (await import("@/components/v2/po-pdf")).downloadDocumentPdf(...args);
import { mocksEnabled } from "@/lib/flags";
import { formatMoney, formatDate, isoDateIst } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FadeIn, Btn, PageHeader, Callout, inputClass } from "@/components/ui/v2";
import { SearchField } from "@/components/pages/shared/search-field";

const STEPS = ["Buyer", "Supplier", "Items", "Terms", "Tax & totals", "Approval", "Issue"];
const STEP_HINT = ["Which of your companies is buying, and by when.", "Who you are buying from — this decides CGST + SGST or IGST.", "What you are buying. Pick the HSN code and the GST rate fills in.", "Payment, delivery and inspection terms printed on the order.", "Satya saves a draft and works out GST and totals on the server.", "Send it to the approver your company policy names for this amount.", "Issue the approved order and share it with the supplier."];

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

const inputCls = inputClass;
const labelCls = "mb-1.5 block text-[14px] font-medium text-[var(--ink)]";
const noteCls = "rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-3.5 py-2.5 text-[14px] leading-relaxed text-[var(--ink-2)]";

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
                className="w-full px-3 py-2 text-left text-[14px] hover:bg-[var(--accent-soft)]"
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
  const [supplierQuery, setSupplierQuery] = useState("");
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
  // Why "Continue" is disabled — said next to the button, not discovered.
  const blockedReason =
    step === 0 && !entity ? "Choose the buying company."
      : step === 1 && !supplier ? "Choose a supplier."
        : step === 2 && !linesValid ? "Each item needs a description, quantity and rate."
          : step === 4 && !compute ? "Work out the totals first."
            : null;

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
        <Link href="/app/orders" className="mb-4 inline-flex items-center gap-1 text-[14px] font-medium text-[var(--muted)] hover:text-[var(--ink)]">
          <ArrowLeft size={15} aria-hidden="true" /> Orders
        </Link>
        <PageHeader title="New purchase order" description="Seven short steps. GST and totals are worked out for you; nothing is sent to the supplier until you issue it." />

        {/* stepper */}
        <ol className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" aria-label="Steps">
          {STEPS.map((name, i) => (
            <li key={name} className="min-w-[72px] flex-1">
              <button
                type="button"
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                aria-current={i === step ? "step" : undefined}
                className={cn("group flex w-full flex-col gap-2 text-left", i < step && "cursor-pointer")}
              >
                <span className={cn("h-1 w-full rounded-full transition-colors", i <= step ? "bg-[var(--accent)]" : "bg-[var(--surface-3)]")} />
                <span className={cn("flex items-center gap-1.5 text-[13px] font-medium", i === step ? "text-[var(--ink)]" : i < step ? "text-[var(--accent-strong)] group-hover:underline dark:text-[var(--accent)]" : "text-[var(--muted)]")}>
                  {i < step ? <Check size={13} aria-hidden="true" /> : <span className="tnum">{i + 1}</span>}
                  {name}
                </span>
              </button>
            </li>
          ))}
        </ol>

        <div className="mt-6 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)] sm:p-6">
          <p className="mb-5 text-[15px] text-[var(--muted)]">{STEP_HINT[step]}</p>
          {step === 0 && (
            <fieldset>
              <legend className="sr-only">Who is buying?</legend>
              <div className="space-y-5">
                <div>
                  <label className={labelCls} htmlFor="entity">Buying company</label>
                  <select id="entity" value={entityId} onChange={(e) => setEntityId(e.target.value)} className={inputCls}>
                    {entities.length === 0 ? <option value="">Loading your entities…</option> : null}
                    {entities.map((e) => <option key={e.id} value={e.id}>{e.legalName}{e.gstin ? ` · ${e.gstin}` : ""}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls} htmlFor="cost">Cost centre <span className="font-normal text-[var(--muted)]">(optional)</span></label>
                  <input id="cost" value={costCentre} onChange={(e) => setCostCentre(e.target.value)} placeholder="e.g. Maintenance — Plant 2" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="reqby">Needed by <span className="font-normal text-[var(--muted)]">(optional)</span></label>
                  <input id="reqby" type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} className={inputCls} />
                </div>
                <p className={noteCls}>
                  The place of supply is your company’s state — it decides whether CGST + SGST or IGST applies.
                </p>
              </div>
            </fieldset>
          )}

          {step === 1 && (
            <fieldset>
              <legend className="sr-only">Who is the supplier?</legend>
              <div className="space-y-2.5">
                {!mocksEnabled() && suppliersLoading ? <p className="text-[15px] text-[var(--muted)]">Loading your suppliers…</p> : null}
                {!mocksEnabled() && !suppliersLoading && supplierList.length === 0 ? (
                  <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--line-strong)] px-4 py-6 text-center text-[15px] text-[var(--muted)]">
                    No suppliers in your master yet. <Link href="/app/suppliers" className="font-medium text-[var(--accent)] hover:underline">Open Suppliers</Link>
                  </p>
                ) : null}
                {supplierList.length > 6 ? (
                  <SearchField value={supplierQuery} onChange={setSupplierQuery} placeholder="Find a supplier by name or GSTIN" className="sm:w-full" />
                ) : null}
                <div className="max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
                  {supplierList
                    .filter((s) => !supplierQuery.trim() || s.id === supplierId || `${s.legalName} ${s.gstin ?? ""}`.toLowerCase().includes(supplierQuery.trim().toLowerCase()))
                    .map((s) => (
                      <label key={s.id} className={cn("flex cursor-pointer items-start gap-3 rounded-[var(--radius-sm)] border p-3.5 transition-colors", supplierId === s.id ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)] hover:bg-[var(--surface-2)]/60")}>
                        <input type="radio" name="supplier" checked={supplierId === s.id} onChange={() => setSupplierId(s.id)} className="mt-1 accent-[var(--accent)]" />
                        <span>
                          <span className="block text-[15px] font-medium text-[var(--ink)]">{s.legalName}</span>
                          <span className="mt-0.5 block text-[13px] text-[var(--muted)] tnum">{s.gstin ? `GSTIN ${s.gstin}` : "No GSTIN on file"}</span>
                          {s.udyam && (
                            <span className="mt-1.5 inline-block rounded-full bg-[var(--likely-soft)] px-2 py-0.5 text-[13px] font-medium text-[var(--likely)]" title="Micro and small enterprises must be paid within 45 days of acceptance.">
                              {s.udyam.category.charAt(0).toUpperCase() + s.udyam.category.slice(1)} enterprise · pay within 45 days
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                </div>
                <Link href="/app/suppliers" className="inline-block text-[14px] font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">Supplier missing? Open Suppliers →</Link>
                {supplier && (
                  <p className={noteCls}>
                    {intraState ? "Same state as your company — CGST + SGST will apply." : "Different state from your company — IGST will apply."}
                    {supplier.paymentTermsDays ? ` Their usual credit: ${supplier.paymentTermsDays} days.` : ""}
                  </p>
                )}
              </div>
            </fieldset>
          )}

          {step === 2 && (
            <fieldset>
              <legend className="sr-only">What are you buying?</legend>
              <div className="space-y-5">
                {lines.map((line, i) => (
                  <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--line)] p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[14px] font-semibold text-[var(--ink-2)]">Item {i + 1}</p>
                      {lines.length > 1 && (
                        <button type="button" onClick={() => setLines((prev) => prev.filter((_, x) => x !== i))} aria-label={`Remove item ${i + 1}`} className="grid h-8 w-8 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--sev-critical-soft)] hover:text-[var(--sev-critical)]">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <label className={labelCls}>Description</label>
                        <input value={line.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="e.g. Centrifugal pump 1 kW, model CP-100" className={inputCls} />
                      </div>
                      <div>
                        <HsnField value={line.hsn} onChange={(v) => setLine(i, { hsn: v, gstRate: "" })} onPick={(code, rate) => setLine(i, { hsn: code, gstRate: rate ?? "" })} />
                        {line.gstRate ? <p className="mt-1.5 text-[13px] text-[var(--muted)]">GST {line.gstRate}% from the HSN list — check it fits your item.</p> : null}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className={labelCls}>Qty</label>
                          <input value={line.qty} onChange={(e) => setLine(i, { qty: e.target.value })} inputMode="decimal" className={inputCls} />
                        </div>
                        <div>
                          <label className={labelCls}>Unit</label>
                          <select value={line.uom} onChange={(e) => setLine(i, { uom: e.target.value })} className={inputCls}>
                            {["NOS", "EA", "BOX", "SET", "M", "KG", "L", "PAIR", "ROLL", "LOT"].map((u) => <option key={u}>{u}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={labelCls}>Rate (₹)</label>
                          <input value={line.rate} onChange={(e) => setLine(i, { rate: e.target.value })} inputMode="decimal" className={inputCls} />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                <Btn variant="secondary" size="sm" icon={Plus} onClick={() => setLines((prev) => [...prev, emptyLine()])}>Add another item</Btn>
              </div>
            </fieldset>
          )}

          {step === 3 && (
            <fieldset>
              <legend className="sr-only">Commercial terms</legend>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Advance (% of order value)</label>
                  <input value={terms.advancePct} onChange={(e) => setTerms({ ...terms, advancePct: e.target.value })} inputMode="decimal" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Credit days for the balance</label>
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
              <p className={cn(noteCls, "mt-5")}>These are standard clauses — have your legal adviser review them once.</p>
            </fieldset>
          )}

          {step === 4 && (
            <fieldset>
              <legend className="sr-only">Tax and totals</legend>
              {!compute ? (
                <div>
                  <Btn onClick={runCompute} disabled={computing} icon={computing ? LoaderCircle : undefined} className={computing ? "[&>svg]:animate-spin" : undefined}>
                    {computing ? "Working out GST…" : "Work out GST and totals"}
                  </Btn>
                  {actionError ? <p className="mt-3 text-[14px] text-[var(--sev-critical)]">{actionError}</p> : null}
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-[14px] text-[var(--muted)]">Tax type: <span className="font-medium text-[var(--ink)]">{compute.taxType === "IGST" ? "IGST (different state)" : "CGST + SGST (same state)"}</span></p>
                  <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-[15px]">
                    <thead><tr className="border-b border-[var(--line)] text-right text-[13px] text-[var(--muted)]"><th className="py-2 text-left font-semibold">Item</th><th className="font-semibold">Taxable</th><th className="font-semibold">CGST</th><th className="font-semibold">SGST</th><th className="font-semibold">IGST</th><th className="font-semibold">Total</th></tr></thead>
                    <tbody className="tnum">
                      {compute.lines.map((line) => (
                        <tr key={line.lineNo} className="border-b border-[var(--line)] text-right text-[var(--ink-2)]">
                          <td className="py-2 text-left">{line.lineNo}</td><td>{formatMoney(line.taxableValue)}</td><td>{formatMoney(line.cgst)}</td><td>{formatMoney(line.sgst)}</td><td>{formatMoney(line.igst)}</td><td className="font-medium text-[var(--ink)]">{formatMoney(line.lineTotal)}</td>
                        </tr>
                      ))}
                      <tr className="text-right font-semibold text-[var(--ink)]">
                        <td className="py-2.5 text-left">Grand total</td><td>{formatMoney(compute.totals.taxable)}</td><td>{formatMoney(compute.totals.cgst)}</td><td>{formatMoney(compute.totals.sgst)}</td><td>{formatMoney(compute.totals.igst)}</td><td>{formatMoney(compute.totals.grand)}</td>
                      </tr>
                    </tbody>
                  </table></div>
                  <ul className="space-y-1.5">
                    {compute.warnings.map((warning) => (
                      <li key={warning.code} className="flex items-start gap-2 text-[14px] text-[var(--ink-2)]">
                        <TriangleAlert size={15} className="mt-0.5 shrink-0 text-[var(--sev-medium)]" /> {warning.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </fieldset>
          )}

          {step === 5 && (
            <fieldset>
              <legend className="sr-only">Approval</legend>
              <div className={noteCls}>
                <p>Satya sends this order{compute ? ` (${formatMoney(compute.totals.grand)})` : ""} to the approver your company’s approval policy names for this amount.</p>
                <p className="mt-1 text-[13px] text-[var(--muted)]">You can’t approve an order you created — someone else must sign off.</p>
              </div>
              {actionError && <p className="mt-3 text-[14px] text-[var(--sev-critical)]">{actionError}</p>}
              <div className="mt-6 flex justify-between border-t border-[var(--line)] pt-5">
                <Btn variant="ghost" onClick={() => setStep(4)}>Back</Btn>
                <Btn onClick={submitForApproval} disabled={!mocksEnabled() && !docId}>Send for approval <ArrowRight size={16} aria-hidden="true" /></Btn>
              </div>
            </fieldset>
          )}

          {step === 6 && (
            <fieldset>
              <legend className="sr-only">Issue and share</legend>
              {!issued ? (
                <div>
                  {mocksEnabled() || docStatus === "approved" ? (
                    <Callout tone="success" title="Approved — ready to issue" />
                  ) : (
                    <Callout
                      tone="warn"
                      title="Waiting for approval"
                      action={<Btn size="sm" variant="secondary" onClick={refreshStatus}>Check again</Btn>}
                    >
                      <p className="text-[14px]">An approver reviews it from the order page. You can issue it here once it is approved.{docId ? <> <Link href={`/app/orders/${docId}`} className="font-medium underline">Open the order</Link></> : null}</p>
                    </Callout>
                  )}
                  {actionError && <p className="mt-3 text-[14px] text-[var(--sev-critical)]">{actionError}</p>}
                  <Btn className="mt-5" onClick={issuePo} disabled={!mocksEnabled() && docStatus !== "approved"}>Issue purchase order</Btn>
                </div>
              ) : (
                <div className="space-y-4">
                  <Callout tone="success" title={`Issued as ${issued.number ?? "a purchase order"}`}>
                    {issued.verifyUrl ? <p className="text-[14px]">The supplier can check it is genuine at the verify link.</p> : null}
                  </Callout>
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
                      className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line-strong)] px-3 text-[14px] font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
                    >
                      <FileDown size={13} /> Download PDF
                    </button>
                    {issued.verifyUrl && (
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(issued.verifyUrl!).then(() => toast.success("Verify link copied"))}
                        className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--line-strong)] px-3 text-[14px] font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
                      >
                        Copy verify link
                      </button>
                    )}
                    <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--line-strong)] px-3 text-[14px] font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]">Print</button>
                  </div>
                  <Btn onClick={() => router.push(docId ? `/app/orders/${docId}` : "/app/orders")}>Done — open the order</Btn>
                </div>
              )}
            </fieldset>
          )}

          {/* nav */}
          {step < 5 && (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-5">
              <Btn variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>Back</Btn>
              <div className="flex items-center gap-3">
                {blockedReason ? <p className="hidden text-[14px] text-[var(--muted)] sm:block">{blockedReason}</p> : null}
                <Btn onClick={() => setStep((s) => s + 1)} disabled={!!blockedReason}>
                  Continue <ArrowRight size={16} aria-hidden="true" />
                </Btn>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* right: live preview */}
      <aside className="xl:col-span-2" aria-label="Document preview">
        <div className="sticky top-24 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)]">
          <p className="mb-3 text-[13px] font-semibold text-[var(--muted)]">Live preview</p>
          <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
            <div>
              <p className="font-semibold text-[var(--ink)]">{entity?.legalName ?? "—"}</p>
              <p className="text-[13px] text-[var(--muted)] tnum">{entity?.gstin ? `GSTIN ${entity.gstin}` : "GSTIN not set"}</p>
            </div>
            <p className="text-[13px] font-semibold text-[var(--muted)]">Purchase order · draft</p>
          </div>
          <dl className="mt-3 space-y-2 text-[14px]">
            <div className="flex justify-between"><dt className="text-[var(--muted)]">Supplier</dt><dd className="text-[var(--ink)]">{supplier?.legalName ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--muted)]">Needed by</dt><dd className="text-[var(--ink)]">{requiredBy ? formatDate(requiredBy) : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--muted)]">Cost centre</dt><dd className="text-[var(--ink)]">{costCentre || "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--muted)]">Payment terms</dt><dd className="text-[var(--ink)]">{terms.advancePct !== "0" ? `${terms.advancePct}% advance, ` : ""}{terms.creditDays} day{terms.creditDays === "1" ? "" : "s"} credit</dd></div>
          </dl>
          <table className="mt-4 w-full text-[14px]">
            <thead><tr className="border-y border-[var(--line)] text-[13px] text-[var(--muted)]"><th className="py-2 text-left font-semibold">Item</th><th className="text-right font-semibold">Qty</th><th className="text-right font-semibold">Rate</th></tr></thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="border-b border-[var(--line)] text-[var(--ink-2)]">
                  <td className="py-2 pr-2">{line.description || "—"}{line.hsn ? <span className="block text-[13px] text-[var(--muted)]">HSN {line.hsn}{line.gstRate ? ` · GST ${line.gstRate}%` : ""}</span> : null}</td>
                  <td className="tnum whitespace-nowrap text-right">{line.qty || "—"} {line.uom}</td>
                  <td className="tnum whitespace-nowrap text-right">{line.rate ? formatMoney(line.rate) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {compute && (
            <div className="mt-3 border-t border-[var(--line)] pt-3 text-right">
              <p className="text-[13px] text-[var(--muted)]">Grand total incl. GST</p>
              <p className="tnum text-xl font-semibold text-[var(--ink)]">{formatMoney(compute.totals.grand)}</p>
            </div>
          )}
          <p className="mt-4 flex items-center gap-1.5 border-t border-[var(--line)] pt-3 text-[13px] text-[var(--muted)]">
            <Check size={13} aria-hidden="true" /> Saved as a draft when the totals are worked out.
          </p>
        </div>
      </aside>
    </FadeIn>
  );
}
