"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, CheckCircle2, Download, FileSpreadsheet, FolderOpen, MessageSquare, Play, RotateCcw, Trash2, Upload } from "lucide-react";
import { Panel, State, evidenceLabel } from "@/components/BusinessShell";
import { useAuth } from "@/contexts/auth-context";
import { businessApi, money, waitForJob, type BusinessCase, type SourceRecord } from "@/lib/business-api";
import { csvPayload, csvSource, downloadText, fieldLabels, orderCandidates, orderSubtotal, recordLabels, requiredFields, type CsvKind, type CsvSource } from "@/lib/import-helpers";
import { expectedSample, importSamples, purchaseOrderSample, sampleOrderId, sampleTitle } from "@/lib/import-samples";

type Preview = Awaited<ReturnType<typeof businessApi.previewImport>>;

export function ImportOutcome({ caseId, data, checking = false }: { caseId: string; data?: BusinessCase | null; checking?: boolean }) {
  const ledger = data?.snapshot?.ledger;
  const poOnly = data?.records?.every((record) => record.type === "PO");
  const findings = data?.snapshot?.findings.filter((finding) => finding.severity !== "info") || [];
  const order = data?.records?.find((record) => record.id === data.poId);
  return <Panel title={checking ? "Records saved · checking the order…" : "Your records are saved"} detail={data ? `${data.poId} · ${data.supplier}` : "Stored in your company workspace, not just in this browser."}>
    {checking && <State loading />}
    {ledger && <><div className="satya-notice"><CheckCircle2 size={18} className="inline mr-2" />{poOnly ? "Purchase order saved. No invoice, delivery or payment has been invented." : "The record checks are complete. These results come from the stored calculation."}</div><div className="satya-metric-grid satya-money-grid">{(poOnly ? [
      ["Units ordered", ledger.ordered, "From your purchase order"], ["Order value before tax", order?.lines ? money(orderSubtotal(order.lines), ledger.currency) : "Not available", "Not an invoice or an amount due"], ["Recorded deliveries", ledger.received, "No delivery record is created by saving a PO"], ["Records saved", String(data?.records.length || 0), "Original observations remain available"],
    ] : [["Units ordered", ledger.ordered, "From the purchase order"], ["Units delivered", ledger.received, `${ledger.openDelivery} still to arrive`], ["Linked payments", money(ledger.settled, ledger.currency), "Only settled, linked amounts"], ["Delivery-supported balance", money(ledger.supportedOutstanding, ledger.currency), "Not a payment approval"]]).map(([label, value, detail]) => <article className="satya-metric" key={label}><span>{label}</span><strong>{value}</strong><p>{detail}</p></article>)}</div>{poOnly ? <p className="text-muted-foreground mb-5">A PO records what you plan to buy. Import the PO together with its delivery, invoice and payment files in the full import workspace when you want to investigate those amounts. Existing records cannot be overwritten by reimporting their IDs.</p> : <><h3 className="satya-section-title">{findings.length ? `${findings.length} items need review` : "No blocking issues were listed"}</h3>{findings.slice(0, 4).map((finding) => <article className={`satya-finding ${finding.severity}`} key={finding.id}><h3>{evidenceLabel(finding.title)}</h3><p>{finding.detail}</p>{finding.exposure && <p><strong>Amount to review: {money(finding.exposure.amount, finding.exposure.currency)}</strong></p>}</article>)}</>}</>}
    <div className="satya-case-card-actions"><Link href={`/cases/${encodeURIComponent(caseId)}`} className="satya-button">Open investigation <ArrowUpRight size={17} /></Link><Link href={`/chat?case=${encodeURIComponent(caseId)}`} className="satya-button secondary"><MessageSquare size={17} />Ask about this order</Link><Link href="/purchase-orders" className="satya-button secondary">View saved purchase orders</Link></div>
  </Panel>;
}

function RecordsPreview({ records }: { records: SourceRecord[] }) {
  return <div className="satya-table-wrap"><table className="satya-table"><thead><tr><th>Record</th><th>Type</th><th>Supplier</th><th>Quantity / amount</th><th>Linked order / invoice</th></tr></thead><tbody>{records.slice(0, 30).map((record) => <tr key={record.id}><td><strong>{record.reference}</strong><span>{record.id}</span></td><td>{recordLabels[record.type as CsvKind] || record.type}</td><td>{record.supplier}</td><td>{record.amount ? money(record.amount, record.currency) : record.lines?.map((line) => `${line.quantity} ${line.uom === "EA" ? "items" : line.uom}`).join(" + ") || "Not supplied"}</td><td>{record.invoiceId || record.poId || "This is the purchase order"}</td></tr>)}</tbody></table>{records.length > 30 && <p className="text-sm text-muted-foreground mt-3">Showing the first 30 of {records.length} records. All validated records will be saved.</p>}</div>;
}

export default function ImportWorkspace({ purchaseOrdersOnly = false, onSaved }: { purchaseOrdersOnly?: boolean; onSaved?: () => void }) {
  const { user } = useAuth();
  const [mode, setMode] = useState("csv");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<CsvSource[]>([]);
  const [title, setTitle] = useState("");
  const [poId, setPoId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedCaseId, setSavedCaseId] = useState("");
  const [result, setResult] = useState<BusinessCase | null>(null);
  const [sample, setSample] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const outcome = useRef<HTMLDivElement>(null);
  const candidates = orderCandidates(files);
  const missing = files.some((file) => !file.recordType || requiredFields(file.recordType).some((field) => !file.mapping[field]));
  const locked = busy || !!savedCaseId;
  useEffect(() => { if (result) outcome.current?.scrollIntoView({ behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block:"start" }); }, [result]);

  const perform = async (operation: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await operation(); } catch (error) { setError(error instanceof Error ? error.message : "The import could not be completed. Please try again."); }
    finally { setBusy(false); }
  };
  const commit = async (payload: unknown) => {
    const saved = await businessApi.import(payload);
    setSavedCaseId(saved.caseId);
    try { if (saved.job) await waitForJob(saved.job.id); setResult(await businessApi.case(saved.caseId)); }
    catch { throw new Error("Your records were saved, but their checks could not be loaded. Open the investigation below to check progress or try the record check again."); }
    finally { onSaved?.(); }
  };
  const update = (index: number, change: Partial<CsvSource>) => {
    setFiles((previous) => previous.map((file, position) => position === index ? { ...file, ...change } : file));
    setPreview(null); setError(""); setSample(false);
  };
  const startAgain = () => { setFiles([]); setTitle(""); setPoId(""); setPreview(null); setError(""); setSavedCaseId(""); setResult(null); setText(""); setSample(false); };
  const useSample = () => {
    const examples = purchaseOrdersOnly ? [purchaseOrderSample] : importSamples;
    setFiles(examples.map((item) => csvSource(item.name, item.content, item.recordType)));
    setTitle(purchaseOrdersOnly ? "Sample purchase order · 10 water pumps" : sampleTitle);
    setPoId(purchaseOrdersOnly ? "DEMO-PO-6201" : sampleOrderId);
    setSample(true); setPreview(null); setError("");
  };
  const readFiles = async (selected: File[]) => {
    if (!selected.length) return;
    await perform(async () => {
      if (selected.length > 8 || selected.reduce((sum, file) => sum + file.size, 0) > 1500000) throw new Error("Choose up to 8 CSV files, no more than 1.5 MB in total.");
      const sources = await Promise.all(selected.map(async (file) => csvSource(file.name, await file.text(), purchaseOrdersOnly ? "PO" : undefined)));
      const orders = orderCandidates(sources);
      setFiles(sources); setPreview(null); setSample(false);
      setPoId(orders.length === 1 ? orders[0] : "");
      setTitle((previous) => previous || (orders.length === 1 ? `Review order ${orders[0]}` : ""));
    });
  };
  const jsonExample = () => {
    setText(JSON.stringify({ title:"Sample purchase order · JSON", poId:"DEMO-JSON-PO-6301", records:[{ id:"DEMO-JSON-PO-6301", type:"PO", reference:"DEMO/PO/6301", source:"example_json", supplier:"Example Pump Supplier", currency:"INR", status:"approved", occurredAt:"2026-10-01T10:00:00+05:30", observedAt:"2026-10-01T10:00:00+05:30", coverage:"unknown", lines:[{ id:"1", description:"Water pump 1 kW", sku:"PUMP-1KW", quantity:"10", unitPrice:"1250.00", uom:"EA" }] }] }, null, 2));
    setError("");
  };

  if (user?.role === "auditor") return <Panel title="You have read-only access"><p className="text-muted-foreground">You can review saved orders and investigations. An operations analyst or finance manager must import new records.</p><Link href="/purchase-orders" className="satya-button secondary mt-4">View purchase orders</Link></Panel>;

  return <div>
    <div className="satya-import-steps" aria-label="Import steps"><span className={!preview && !savedCaseId ? "active" : ""}>1. Choose records</span><span className={preview && !savedCaseId ? "active" : ""}>2. Review</span><span className={savedCaseId ? "active" : ""}>3. Save & see results</span></div>
    <State error={error} />
    {savedCaseId && <div ref={outcome} className="satya-import-outcome"><ImportOutcome caseId={savedCaseId} data={result} checking={busy} /><button className="satya-button secondary mb-5" disabled={busy} onClick={startAgain}><RotateCcw size={16} />Start another import</button></div>}
    <div className="satya-tabs" aria-label="Import format"><button disabled={locked} className={mode === "csv" ? "active" : ""} onClick={() => { setMode("csv"); setError(""); }}>CSV files · recommended</button><button disabled={locked} className={mode === "json" ? "active" : ""} onClick={() => { setMode("json"); setError(""); }}>JSON · advanced</button></div>
    {mode === "csv" ? <>
      <div className="satya-import-start"><Panel title="Not sure where to start?" detail={purchaseOrdersOnly ? "Load a ready-to-use purchase order. Change the file or use it to try the workflow." : "Load four ready-to-use files. The title, order number and column matching are filled in for you."}><div className="satya-case-card-actions"><button className="satya-button" disabled={locked} onClick={useSample}><Play size={17} />{purchaseOrdersOnly ? "Use sample purchase order" : "Use complete sample"}</button><button className="satya-button secondary" disabled={locked} onClick={() => upload.current?.click()}><Upload size={17} />Choose my CSV files</button></div><p className="text-xs text-muted-foreground mt-3">Samples are fictional. Loading them fills this form; nothing is saved until you click Save.</p></Panel><Panel title="Download the example CSVs" detail="The same files are in your project’s docs folder. Use one row per item, with a header row at the top."><div className="satya-sample-downloads">{(purchaseOrdersOnly ? [purchaseOrderSample] : importSamples).map((item) => <button key={item.name} className="satya-sample-download" onClick={() => downloadText(item.name, item.content)}><FileSpreadsheet size={18} /><span><strong>{item.label}</strong><small>{item.name}</small></span><Download size={16} /></button>)}</div></Panel></div>
      <input ref={upload} type="file" accept=".csv,text/csv" multiple={!purchaseOrdersOnly} className="sr-only" aria-label="Upload CSV files" disabled={locked} onChange={(event) => { const selected = Array.from(event.target.files || []); event.target.value = ""; readFiles(selected); }} />
      <Panel title="Which order are these records for?" detail={purchaseOrdersOnly ? "Import one purchase order at a time. A file can contain several items for that order." : "Pick all files for the same order together. We recognize the sample column names automatically."}><div className="satya-form-grid"><div><label htmlFor="import-title">Investigation name</label><input id="import-title" className="satya-input" placeholder="Example: October pump order review" value={title} disabled={locked} maxLength={160} onChange={(event) => { setTitle(event.target.value); setPreview(null); }} /><small>A short name that your team will recognize.</small></div><div><label htmlFor="import-po">Purchase order ID</label><input id="import-po" className="satya-input" list="import-order-options" placeholder={purchaseOrdersOnly ? "Example: DEMO-PO-6201" : "Example: DEMO-PO-6101"} value={poId} disabled={locked} maxLength={80} onChange={(event) => { setPoId(event.target.value); setPreview(null); }} /><datalist id="import-order-options">{candidates.map((id) => <option key={id} value={id} />)}</datalist><small>Use the value in the <strong>id</strong> column of the approved PO file.</small></div></div>{candidates.length > 1 && <div className="satya-notice warning">These files contain more than one approved order. Split them into separate imports so each investigation covers one purchase order.</div>}</Panel>
      {files.map((file, index) => {
        const needed = requiredFields(file.recordType);
        const missingFields = needed.filter((field) => !file.mapping[field]);
        const common = [...new Set([...needed, ...Object.keys(file.mapping)])];
        const mappingField = (field: string) => <div key={field}><label htmlFor={`map-${index}-${field}`}>{fieldLabels[field]}{needed.includes(field) && <span className="satya-required">Required</span>}</label><select id={`map-${index}-${field}`} className="satya-input" disabled={locked} value={file.mapping[field] || ""} onChange={(event) => { const mapping = { ...file.mapping }; if (event.target.value) mapping[field] = event.target.value; else delete mapping[field]; update(index, { mapping }); }}><option value="">Not supplied</option>{file.columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></div>;
        return <Panel key={`${file.name}-${index}`} title={file.name} detail={`${file.rows.length} data rows · ${file.columns.length} columns`}><div className="satya-import-file-meta"><div><label htmlFor={`type-${index}`}>What’s in this file?</label><select id={`type-${index}`} className="satya-input" value={file.recordType} disabled={locked} onChange={(event) => update(index, { recordType:event.target.value as CsvKind })}><option value="">Choose a record type</option>{Object.entries(recordLabels).filter(([value]) => !purchaseOrdersOnly || value === "PO").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><span className={`satya-status ${missingFields.length || !file.recordType ? "review" : "ok"}`}>{missingFields.length || !file.recordType ? "Check the column matching" : "Required columns matched"}</span><button className="satya-button secondary" disabled={locked} aria-label={`Remove ${file.name}`} onClick={() => { setFiles((previous) => previous.filter((_, position) => position !== index)); setPreview(null); setSample(false); }}><Trash2 size={16} />Remove file</button></div>{!!missingFields.length && <div className="satya-notice warning">Match these columns before reviewing: {missingFields.map((field) => fieldLabels[field]).join(", ")}.</div>}<details className="satya-chat-section" open={!!missingFields.length || !file.recordType}><summary>Advanced: check column matching and number format</summary><p className="text-sm text-muted-foreground my-3">Choose the column containing each value. We do not fill in missing currency, dates, quantities or approval status.</p><div className="satya-form-grid mb-4"><div><label htmlFor={`source-${index}`}>Source name</label><input id={`source-${index}`} className="satya-input" disabled={locked} maxLength={80} value={file.source} onChange={(event) => update(index, { source:event.target.value })} /></div><div><label htmlFor={`format-${index}`}>How are numbers written?</label><select id={`format-${index}`} className="satya-input" disabled={locked} value={file.numberFormat} onChange={(event) => update(index, { numberFormat:event.target.value as CsvSource["numberFormat"] })}><option value="plain">Plain numbers: 118000.00</option><option value="en-IN">Indian format: ₹1,18,000.00</option></select></div></div><div className="satya-form-grid">{common.map(mappingField)}</div><details className="mt-5"><summary>More optional fields</summary><div className="satya-form-grid mt-4">{Object.keys(fieldLabels).filter((field) => !common.includes(field)).map(mappingField)}</div></details></details></Panel>;
      })}
      {sample && !purchaseOrdersOnly && <Panel title="What this example should show" detail="Expected results for these unchanged fictional sample files. The actual results are calculated after saving."><div className="satya-sample-expectations"><span><strong>{expectedSample.ordered}</strong> pumps ordered</span><span><strong>{expectedSample.received}</strong> delivered</span><span><strong>{money(expectedSample.settled)}</strong> linked payments</span><span><strong>{money(expectedSample.supportedOutstanding)}</strong> delivery-supported balance</span></div><p className="text-sm text-muted-foreground mt-4">A possible {money(expectedSample.disputedExposure)} duplicate and an unlinked {money(expectedSample.unallocated)} payment require review. The final balance remains unconfirmed until those records are resolved.</p></Panel>}
      {files.length > 0 && <button className="satya-button mb-5" disabled={locked || title.trim().length < 3 || !poId.trim() || missing || candidates.length > 1} onClick={() => perform(async () => { setPreview(await businessApi.previewImport(csvPayload(title, poId, files))); })}><FolderOpen size={17} />{busy ? "Checking the files…" : "Review these records"}</button>}
      {preview && <Panel title={preview.canCommit ? "Ready to save · review these records" : "A few things need fixing"} detail={`${preview.totalRows} source rows · ${preview.acceptedRecords} accepted records · ${preview.issueCount} issues`}><div className={`satya-notice ${preview.canCommit ? "" : "warning"}`}>{preview.canCommit ? "Validation passed. Your company’s records have not changed yet. Check the references and amounts below, then save." : "Nothing will be saved while errors remain. Correct the listed values or column matching, then review again."}</div>{!!preview.issues.length && <div className="satya-table-wrap"><table className="satya-table"><thead><tr><th>File</th><th>Row</th><th>What to fix</th></tr></thead><tbody>{preview.issues.map((issue, index) => <tr key={index}><td>{issue.file}</td><td>{issue.row || "Whole import"}</td><td>{issue.message}</td></tr>)}</tbody></table></div>}<RecordsPreview records={preview.records} /><details className="mt-5"><summary>Technical record data</summary><pre className="satya-code mt-3">{JSON.stringify(preview.records, null, 2)}</pre></details><button className="satya-button mt-5" disabled={locked || !preview.canCommit} onClick={() => perform(() => commit({ previewId:preview.id }))}><CheckCircle2 size={17} />{busy ? "Saving and checking…" : savedCaseId ? "Saved" : "Save records & show results"}</button></Panel>}
    </> : <Panel title="Import a JSON bundle" detail="Advanced option. The bundle must contain a title, poId and source records."><button className="satya-button secondary mb-4" disabled={locked} onClick={jsonExample}><Play size={16} />Fill a valid JSON example</button><input type="file" accept="application/json,.json" aria-label="Upload JSON bundle" className="satya-input" disabled={locked} onChange={(event) => { const file = event.target.files?.[0]; if (file) perform(async () => { if (file.size > 1500000) throw new Error("Choose a JSON file smaller than 1.5 MB."); setText(await file.text()); }); }} /><textarea aria-label="Source JSON bundle" className="satya-input satya-code mt-4" rows={14} disabled={locked} value={text} onChange={(event) => setText(event.target.value)} placeholder={'Click “Fill a valid JSON example” above, or paste your complete JSON bundle here.'} /><button className="satya-button mt-4" disabled={locked || !text.trim()} onClick={() => perform(async () => { let body; try { body = JSON.parse(text); } catch { throw new Error("This is not valid JSON. Use the example above or check for missing commas and quotes."); } if (!body || typeof body.title !== "string" || body.title.trim().length < 3 || typeof body.poId !== "string" || !Array.isArray(body.records) || !body.records.length) throw new Error("Add an investigation title, a purchase order ID and at least one record. The example above shows the complete structure."); if (body.records.filter((record: { type?: string } | null) => record?.type === "PO").length !== 1) throw new Error("Include exactly one purchase order per import, with its items grouped inside that record."); if (purchaseOrdersOnly && body.records.some((record: { type?: string } | null) => record?.type !== "PO")) throw new Error("This section imports purchase orders only. Use Import records for deliveries, invoices and payments."); await commit(body); })}>{busy ? "Validating and saving…" : "Validate, save & show results"}</button></Panel>}
    <details className="satya-panel"><summary>What should I put in a CSV?</summary><div className="satya-glossary"><p className="mt-4">Use the downloadable files as templates. Keep the header row, then replace the example values with your own records.</p><ul className="satya-list mt-3"><li><strong>id:</strong> a unique source-record ID. Different invoice postings must have different IDs, even if they refer to the same invoice.</li><li><strong>reference:</strong> the number printed on the order, receipt or invoice.</li><li><strong>supplier and currency:</strong> the actual supplier name and INR, USD or EUR.</li><li><strong>Dates:</strong> include the time zone, for example 2026-10-01T10:00:00+05:30.</li><li><strong>quantity / unitPrice:</strong> plain numbers such as 10 and 1250.00. EA means individual items.</li><li><strong>status:</strong> approved for an already approved PO; posted for receipts and invoices; settled for payments only when settlement is confirmed by the source.</li><li><strong>poId / invoiceId:</strong> use the exact IDs of the linked order and invoice. Leave an unknown payment link blank; do not guess it.</li></ul><p className="text-sm text-muted-foreground mt-4">Import one order per bundle. Existing records are immutable; reimporting the unchanged sample returns the same investigation. Saving a different bundle with an existing record ID is blocked rather than overwriting evidence.</p></div></details>
    <div className="satya-notice">Original CSVs and their row/column references are retained when you save. No supplier is contacted and no payment is made. Tax and bank statuses are shown as supplied, not independently verified.</div>
  </div>;
}
