"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BusinessShell, { Panel, State } from "@/components/BusinessShell";
import { businessApi, waitForJob } from "@/lib/business-api";

const fields = ["id", "reference", "supplier", "currency", "occurredAt", "observedAt", "status", "poId", "invoiceId", "amount", "netAmount", "lineId", "description", "sku", "quantity", "unitPrice", "uom", "acceptedQuantity", "poLineId", "packSize", "taxCGST", "taxSGST", "taxIGST", "taxCESS", "utr", "coverage", "matchingLevel", "dueAt", "gstin", "irn"];
type CsvSource = { name: string; content: string; recordType: string; source: string; numberFormat: string; mapping: Record<string, string>; columns: string[] };
type Preview = Awaited<ReturnType<typeof businessApi.previewImport>>;
function columnsOf(content: string) {
  const result: string[] = []; let field = "", quoted = false;
  for (const character of content.replace(/^\ufeff/, "").split(/\r?\n/)[0]) {
    if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { result.push(field); field = ""; }
    else field += character;
  }
  result.push(field); return result;
}
export default function InboxPage() {
  const router = useRouter();
  const [mode, setMode] = useState("csv");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<CsvSource[]>([]);
  const [title, setTitle] = useState("");
  const [poId, setPoId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await operation(); } catch (error) { setError(error instanceof Error ? error.message : "Import failed"); }
    finally { setBusy(false); }
  };
  const commit = async (payload: unknown) => {
    const result = await businessApi.import(payload);
    if (result.job) await waitForJob(result.job.id);
    router.push(`/cases/${result.caseId}`);
  };
  const update = (index: number, change: Partial<CsvSource>) => { setFiles((previous) => previous.map((file, position) => position === index ? { ...file, ...change } : file)); setPreview(null); };
  return <BusinessShell title="Import records" subtitle="Map CSV exports or add a JSON bundle. Review validation before records affect the investigation."><div className="satya-tabs"><button className={mode === 'csv' ? 'active' : ''} onClick={() => setMode('csv')}>CSV exports</button><button className={mode === 'json' ? 'active' : ''} onClick={() => setMode('json')}>JSON bundle</button></div><State error={error} />{mode === 'csv' ? <><Panel title="1. Select the source exports" detail="One row per item line. Use unique source observation/AP posting IDs—not invoice numbers as posting IDs."><div className="grid md:grid-cols-2 gap-4 mb-5"><div><label htmlFor="import-title" className="text-xs">Investigation title</label><input id="import-title" className="satya-input mt-2" value={title} onChange={(event) => { setTitle(event.target.value); setPreview(null); }} maxLength={160} /></div><div><label htmlFor="import-po" className="text-xs">Approved purchase order source ID</label><input id="import-po" className="satya-input mt-2" value={poId} onChange={(event) => { setPoId(event.target.value); setPreview(null); }} maxLength={80} /></div></div><label className="satya-button secondary cursor-pointer">Choose CSV exports<input type="file" accept=".csv,text/csv" multiple className="sr-only" onChange={async (event) => {
    const selected = Array.from(event.target.files || []);
    if (selected.length > 8 || selected.reduce((sum, file) => sum + file.size, 0) > 1500000) { setError('Use up to 8 files totaling less than 1.5 MB'); return; }
    const sources = await Promise.all(selected.map(async (file) => {
      const content = await file.text(); const columns = columnsOf(content);
      const mapping = Object.fromEntries(fields.filter((field) => columns.includes(field)).map((field) => [field, field]));
      return { name: file.name, content, columns, mapping, recordType: 'PO', source: file.name.replace(/\.csv$/i, '').slice(0, 80), numberFormat: 'plain' };
    })); setFiles(sources); setPreview(null); setError('');
  }} /></label><p className="text-xs text-muted-foreground mt-4">Amounts stay decimal strings. Currency and units must be explicit. Dates require ISO timestamps with a timezone, such as 2026-10-01T10:00:00+05:30. Unmapped warehouse coverage is unknown.</p></Panel>{files.map((file, index) => <Panel key={`${file.name}-${index}`} title={`2. Map ${file.name}`}><div className="grid md:grid-cols-3 gap-4 mb-5"><div><label className="text-xs" htmlFor={`type-${index}`}>Record family</label><select id={`type-${index}`} className="satya-input mt-2" value={file.recordType} onChange={(event) => update(index, { recordType: event.target.value })}>{['PO', 'GRN', 'INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'RETURN', 'PROFORMA'].map((type) => <option key={type}>{type}</option>)}</select></div><div><label className="text-xs" htmlFor={`source-${index}`}>Source system</label><input id={`source-${index}`} className="satya-input mt-2" maxLength={80} value={file.source} onChange={(event) => update(index, { source: event.target.value })} /></div><div><label className="text-xs" htmlFor={`format-${index}`}>Declared numeric format</label><select id={`format-${index}`} className="satya-input mt-2" value={file.numberFormat} onChange={(event) => update(index, { numberFormat: event.target.value })}><option value="plain">Plain decimals · 118000.00</option><option value="en-IN">Indian grouping · ₹1,18,000.00</option></select></div></div><details><summary className="cursor-pointer text-sm text-primary">Review column mapping ({Object.keys(file.mapping).length} mapped fields)</summary><div className="grid md:grid-cols-3 gap-3 mt-4">{fields.map((field) => <div key={field}><label className="text-xs text-muted-foreground" htmlFor={`map-${index}-${field}`}>{field}</label><select id={`map-${index}-${field}`} className="satya-input mt-1" value={file.mapping[field] || ''} onChange={(event) => { const mapping = { ...file.mapping }; if (event.target.value) mapping[field] = event.target.value; else delete mapping[field]; update(index, { mapping }); }}><option value="">Not supplied</option>{file.columns.map((column, position) => <option key={`${column}-${position}`} value={column}>{column}</option>)}</select></div>)}</div></details></Panel>)}{files.length > 0 && <button className="satya-button mb-5" disabled={busy || title.length < 3 || !poId} onClick={() => perform(async () => setPreview(await businessApi.previewImport({ title, poId, files: files.map((file) => ({ name: file.name, recordType: file.recordType, source: file.source, content: file.content, mapping: file.mapping, numberFormat: file.numberFormat })) })))}>{busy ? 'Validating source rows…' : '3. Preview & validate'}</button>}{preview && <Panel title="Validation preview" detail={`${preview.totalRows} source rows · ${preview.acceptedRecords} accepted records · ${preview.issueCount} blocking issues`}><div className={`satya-notice ${preview.canCommit ? '' : 'warning'}`}>{preview.canCommit ? 'Validated for import. No company ledger has changed yet. Review the normalized observations below before committing.' : 'Commit is blocked. Correct the mapping/source errors; invalid rows will not be silently discarded.'}</div>{preview.issues.length > 0 && <div className="satya-table-wrap"><table className="satya-table"><thead><tr><th>File</th><th>Logical row</th><th>Issue</th></tr></thead><tbody>{preview.issues.map((issue, index) => <tr key={index}><td>{issue.file}</td><td>{issue.row || 'Bundle'}</td><td>{issue.message}</td></tr>)}</tbody></table></div>}<details><summary className="text-sm cursor-pointer">Inspect normalized record preview</summary><pre className="satya-code mt-4">{JSON.stringify(preview.records, null, 2)}</pre></details><button className="satya-button mt-5" disabled={busy || !preview.canCommit} onClick={() => perform(() => commit({ previewId: preview.id }))}>{busy ? 'Importing and reconciling…' : '4. Commit validated preview'}</button></Panel>}</> : <Panel title="Structured JSON source bundle"><p className="text-sm text-muted-foreground mb-4">Supply title, poId and records. Use the documented record contract; exact decimals, currency, units and timezone-aware dates are required.</p><label className="satya-button secondary cursor-pointer">Choose JSON file<input type="file" accept="application/json,.json" className="sr-only" onChange={async (event) => { const file = event.target.files?.[0]; if (file && file.size <= 1500000) setText(await file.text()); else if (file) setError('Choose a source file smaller than 1.5 MB'); }} /></label><textarea aria-label="Source JSON bundle" className="satya-input satya-code mt-4" rows={16} value={text} onChange={(event) => setText(event.target.value)} placeholder={'{\n  "title": "My procurement investigation",\n  "poId": "PO-NEW-1",\n  "records": [...]\n}'} /><button className="satya-button mt-4" disabled={busy || !text.trim()} onClick={() => perform(() => commit(JSON.parse(text)))}>{busy ? 'Validating and reconciling…' : 'Validate & import JSON'}</button></Panel>}<div className="satya-notice">Original CSV files and row/column evidence are stored on commit in your company scope. GST amounts and bank statuses are source declarations—not portal, signature or bank verification. PDF OCR is outside this time-boxed slice.</div></BusinessShell>;
}
