"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, ClipboardList, Download, FilePlus2, MessageSquare, Plus, Printer, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import BusinessShell, { Panel, State } from "@/components/BusinessShell";
import ImportWorkspace, { ImportOutcome } from "@/components/ImportWorkspace";
import { useAuth } from "@/contexts/auth-context";
import { businessApi, money, waitForJob, type BusinessCase, type SourceRecord } from "@/lib/business-api";
import { downloadText, orderSubtotal, recordsCsv, validateOrderLines } from "@/lib/import-helpers";

type StoredOrder = BusinessCase & { recordIds?: string[]; inputRecords?: SourceRecord[] };
type OrderLine = { id: string; description: string; sku: string; quantity: string; unitPrice: string };
const tabs = ["Saved purchase orders", "Create a PO", "Import a PO"];
function indiaDate() {
  const parts = new Intl.DateTimeFormat("en", { timeZone:"Asia/Kolkata", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
const emptyLine = (id = "1"): OrderLine => ({ id, description:"", sku:"", quantity:"", unitPrice:"" });
function subtotal(lines: OrderLine[]) { try { return orderSubtotal(lines); } catch { return null; } }

function PurchaseOrderForm({ suppliers, onSaved }: { suppliers: string[]; onSaved: () => void }) {
  const { user } = useAuth();
  const [id, setId] = useState("");
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [title, setTitle] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [unit, setUnit] = useState("EA");
  const [orderDate, setOrderDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [lines, setLines] = useState<OrderLine[]>([emptyLine()]);
  const [confirmed, setConfirmed] = useState(false);
  const [example, setExample] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedCaseId, setSavedCaseId] = useState("");
  const [result, setResult] = useState<BusinessCase | null>(null);
  const locked = busy || !!savedCaseId;
  const total = subtotal(lines);
  const generateNumber = () => { const today = indiaDate(); setId(`PO-${today.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`); setObservedAt(new Date().toISOString()); setOrderDate(today); };
  useEffect(() => { const today = indiaDate(); setId(`PO-${today.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`); setObservedAt(new Date().toISOString()); setOrderDate(today); }, []);
  const useExample = () => { generateNumber(); setSupplier("Example Pump Supplier"); setReference(""); setTitle("Water pumps · sample purchase order"); setCurrency("INR"); setUnit("EA"); setDueDate(""); setLines([{ id:"1", description:"Water pump 1 kW", sku:"PUMP-1KW", quantity:"10", unitPrice:"1250.00" }]); setConfirmed(false); setExample(true); setError(""); };
  const createAnother = () => { generateNumber(); setSupplier(""); setReference(""); setTitle(""); setCurrency("INR"); setUnit("EA"); setDueDate(""); setLines([emptyLine()]); setConfirmed(false); setExample(false); setSavedCaseId(""); setResult(null); setError(""); };
  const updateLine = (lineId: string, change: Partial<OrderLine>) => setLines((previous) => previous.map((line) => line.id === lineId ? { ...line, ...change } : line));
  const build = (requireApproval = false): SourceRecord => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(id) || ["__proto__", "constructor", "prototype"].includes(id)) throw new Error("Use an order number starting with a letter or number, with up to 80 letters, numbers, dots, hyphens, underscores or colons.");
    if (!supplier.trim() || supplier.trim().length > 160) throw new Error("Add a supplier name of up to 160 characters.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate) || !Number.isFinite(Date.parse(`${orderDate}T12:00:00+05:30`))) throw new Error("Choose a valid order date.");
    if (dueDate && dueDate < orderDate) throw new Error("The expected delivery date cannot be before the order date.");
    if (requireApproval && !confirmed) throw new Error("Confirm that this purchase order has already been approved by your company before saving it.");
    const items = lines.map((line) => ({ id:line.id, description:line.description.trim(), ...(line.sku.trim() ? { sku:line.sku.trim() } : {}), quantity:line.quantity.trim(), unitPrice:line.unitPrice.trim(), uom:unit }));
    validateOrderLines(items);
    return { id, type:"PO", reference:reference.trim() || id, source:"purchase_order_form", supplier:supplier.trim(), currency, status:confirmed ? "approved" : "posted", occurredAt:`${orderDate}T12:00:00+05:30`, observedAt, provenance:"USER_PROVIDED", lines:items, ...{ coverage:"unknown", ...(dueDate ? { dueAt:`${dueDate}T23:59:00+05:30` } : {}) } };
  };
  const save = async () => {
    setError(""); setBusy(true);
    try {
      const record = build(true);
      const saved = await businessApi.import({ title:title.trim() || `Purchase order ${id} · ${supplier.trim()}`.slice(0, 160), poId:id, records:[record] });
      setSavedCaseId(saved.caseId);
      try { if (saved.job) await waitForJob(saved.job.id); setResult(await businessApi.case(saved.caseId)); }
      catch { setError("The purchase order was saved, but its checks could not be loaded. Open the investigation below to check progress."); }
      onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : "The purchase order could not be saved."); }
    finally { setBusy(false); }
  };
  const exportCsv = () => { setError(""); try { downloadText(`${id || "purchase-order"}.csv`, recordsCsv([build()])); } catch (error) { setError(error instanceof Error ? error.message : "Complete the order details before downloading."); } };
  if (user?.role === "auditor") return <Panel title="Purchase orders are read-only for your role"><p className="text-muted-foreground">An operations analyst or finance manager can create and import purchase orders.</p></Panel>;

  return <>
    <State error={error} />
    {savedCaseId && <><ImportOutcome caseId={savedCaseId} data={result} checking={busy} /><button className="satya-button secondary mb-5" disabled={busy} onClick={createAnother}><Plus size={17} />Create another purchase order</button></>}
    <div className="satya-po-layout"><div className="satya-po-builder"><form onSubmit={(event) => { event.preventDefault(); save(); }}>
      <Panel title="1. Purchase order details" detail="A purchase order records what you want to buy. It is not an invoice or a payment approval."><button className="satya-button secondary mb-5" type="button" disabled={locked} onClick={useExample}><FilePlus2 size={17} />Fill example values</button>{example && <div className="satya-notice">These are fictional example values. Replace them before recording your own purchase order.</div>}<div className="satya-form-grid"><div><label htmlFor="po-number">Order number</label><input id="po-number" className="satya-input" value={id} required disabled={locked} maxLength={80} placeholder="PO-20261010-NEW01" onChange={(event) => setId(event.target.value)} /><small>Generated for you. Keep it unique so records are not counted twice.</small></div><div><label htmlFor="po-supplier">Supplier</label><input id="po-supplier" className="satya-input" value={supplier} required disabled={locked} maxLength={160} list="po-suppliers" placeholder="Example: Example Pump Supplier" onChange={(event) => setSupplier(event.target.value)} /><datalist id="po-suppliers">{suppliers.map((value) => <option key={value} value={value} />)}</datalist></div><div><label htmlFor="po-date">Order date · India time</label><input id="po-date" className="satya-input" type="date" value={orderDate} required disabled={locked} onChange={(event) => setOrderDate(event.target.value)} /></div><div><label htmlFor="po-delivery-date">Expected delivery date · optional</label><input id="po-delivery-date" className="satya-input" type="date" value={dueDate} min={orderDate || undefined} disabled={locked} onChange={(event) => setDueDate(event.target.value)} /></div><div><label htmlFor="po-currency">Currency</label><select id="po-currency" className="satya-input" value={currency} disabled={locked} onChange={(event) => setCurrency(event.target.value)}><option value="INR">Indian rupees (INR)</option><option value="USD">US dollars (USD)</option><option value="EUR">Euros (EUR)</option></select></div><div><label htmlFor="po-unit">Quantity unit</label><select id="po-unit" className="satya-input" value={unit} disabled={locked} onChange={(event) => setUnit(event.target.value)}><option value="EA">Individual items (EA)</option><option value="BOX">Boxes (BOX)</option><option value="SET">Sets (SET)</option><option value="M">Metres (M)</option><option value="KG">Kilograms (KG)</option></select><small>All items use this unit. Split orders that need different units.</small></div></div><details className="mt-5"><summary>Optional reference and investigation name</summary><div className="satya-form-grid mt-4"><div><label htmlFor="po-reference">Printed document reference</label><input id="po-reference" className="satya-input" placeholder="Example: PO/2026/OCT/001" disabled={locked} maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} /><small>Leave blank to use the order number.</small></div><div><label htmlFor="po-title">Investigation name</label><input id="po-title" className="satya-input" placeholder="Example: Water pumps for October" disabled={locked} minLength={3} maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /><small>Leave blank for a name based on the order number and supplier.</small></div></div></details></Panel>
      <Panel title="2. What are you ordering?" detail="Enter quantity and unit price before tax. No tax rate or invoice amount is assumed.">{lines.map((line, index) => <div className="satya-po-item" key={line.id}><div className="satya-po-item-heading"><h3>Item {index + 1}</h3><button type="button" disabled={locked || lines.length === 1} aria-label={`Remove item ${index + 1}`} onClick={() => setLines((previous) => previous.filter((item) => item.id !== line.id))}><Trash2 size={17} /></button></div><div className="satya-form-grid"><div><label htmlFor={`po-description-${line.id}`}>Item description</label><input id={`po-description-${line.id}`} className="satya-input" value={line.description} required disabled={locked} maxLength={500} placeholder="Example: Water pump 1 kW" onChange={(event) => updateLine(line.id, { description:event.target.value })} /></div><div><label htmlFor={`po-sku-${line.id}`}>Product code · optional</label><input id={`po-sku-${line.id}`} className="satya-input" value={line.sku} disabled={locked} maxLength={80} placeholder="Example: PUMP-1KW" onChange={(event) => updateLine(line.id, { sku:event.target.value })} /></div><div><label htmlFor={`po-quantity-${line.id}`}>Quantity</label><input id={`po-quantity-${line.id}`} className="satya-input" inputMode="decimal" value={line.quantity} required disabled={locked} placeholder="Example: 10" onChange={(event) => updateLine(line.id, { quantity:event.target.value })} /></div><div><label htmlFor={`po-price-${line.id}`}>Price per unit · before tax</label><input id={`po-price-${line.id}`} className="satya-input" inputMode="decimal" value={line.unitPrice} required disabled={locked} placeholder="Example: 1250.00" onChange={(event) => updateLine(line.id, { unitPrice:event.target.value })} /></div></div></div>)}<button type="button" className="satya-button secondary" disabled={locked || lines.length >= 100} onClick={() => setLines((previous) => [...previous, emptyLine(crypto.randomUUID())])}><Plus size={17} />Add another item</button><div className="satya-po-total"><span>Total before tax</span><strong>{total === null ? "Add valid quantities and prices" : money(total, currency)}</strong></div><p className="text-xs text-muted-foreground">Calculated from the entered items, rounded to two decimal places. This is the order value, not an invoice balance.</p></Panel>
      <Panel title="3. Generate or save your order" detail="Download or print the order first, or record an already approved purchase order in your company workspace."><div className="satya-case-card-actions"><button type="button" className="satya-button secondary" disabled={busy} onClick={exportCsv}><Download size={17} />Download PO CSV</button><button type="button" className="satya-button secondary" disabled={busy || total === null || !supplier.trim()} onClick={() => window.print()}><Printer size={17} />Print / save as PDF</button></div><label className="satya-po-confirmation"><input type="checkbox" checked={confirmed} disabled={locked} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>This purchase order has already been approved by our company.</strong><br />This records an existing approval. It does not grant purchasing authority or approve a payment.</span></label><button className="satya-button" type="submit" disabled={locked || !confirmed || total === null}><ClipboardList size={17} />{busy ? "Saving purchase order…" : savedCaseId ? "Purchase order saved" : "Save PO & start investigation"}</button><p className="text-xs text-muted-foreground mt-3">No supplier message, delivery, invoice or payment is created. An unconfirmed CSV export is not marked approved and cannot be imported as an approved PO.</p></Panel>
    </form></div><div><Panel title="Purchase order preview" detail="Updates as you enter details. This preview is not sent to the supplier."><div className="satya-po-document"><span className="satya-tag">{confirmed ? "Approval recorded by you" : "Unconfirmed order preview"}</span><h2>Purchase order</h2><p>{id || "Order number is being generated…"}</p><h3>{supplier.trim() || "Your supplier’s name"}</h3><dl><dt>Order date</dt><dd>{orderDate || "Choose a date"}</dd><dt>Expected delivery</dt><dd>{dueDate || "Not specified"}</dd><dt>Currency / quantity unit</dt><dd>{currency} · {unit === "EA" ? "Individual items" : unit}</dd></dl>{lines.map((line, index) => <div className="satya-po-preview-item" key={line.id}><strong>{index + 1}. {line.description.trim() || "Item description"}</strong>{line.sku && <p>Product code: {line.sku}</p>}<p>{line.quantity || "—"} {unit === "EA" ? "items" : unit} × {line.unitPrice ? `${currency} ${line.unitPrice}` : "unit price"}</p></div>)}<div className="satya-po-total"><span>Before tax</span><strong>{total === null ? "—" : money(total, currency)}</strong></div><p>Tax, shipping, supplier acceptance and payment terms are not inferred. This is an internal purchase order record, not a tax invoice.</p></div></Panel><div className="satya-notice">Want to check deliveries, invoices and payments together? Download the PO CSV, then import it with the related files using <Link className="underline" href="/inbox">Import records</Link>. Save the full bundle together; immutable source IDs cannot be overwritten later.</div></div></div>
  </>;
}

export default function PurchaseOrdersPage() {
  const { user } = useAuth();
  const [cases, setCases] = useState<StoredOrder[] | null>(null);
  const [tab, setTab] = useState(tabs[0]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");
  const load = useCallback(() => { setError(""); businessApi.cases().then(setCases).catch((error) => setError(error.message)); }, []);
  useEffect(() => { load(); }, [load]);
  const visible = (cases || []).filter((item) => `${item.poId} ${item.title} ${item.supplier}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const suppliers = [...new Set((cases || []).map((item) => item.supplier).filter(Boolean))].sort();
  const exportOrder = async (item: StoredOrder) => {
    setDownloading(item.id); setError("");
    try { const data = await businessApi.case(item.id); const order = data.records.find((record) => record.id === data.poId && record.type === "PO"); if (!order) throw new Error("The original purchase order is not available for export."); downloadText(`${order.id}.csv`, recordsCsv([order])); }
    catch (error) { setError(error instanceof Error ? error.message : "The order could not be downloaded."); }
    finally { setDownloading(""); }
  };

  return <BusinessShell title="Purchase orders" subtitle="Create an order, import an existing PO and keep your saved orders linked to their investigations.">
    <div className="satya-tabs" role="tablist" aria-label="Purchase order actions">{tabs.filter((_, index) => index === 0 || user?.role !== "auditor").map((name, index) => <button key={name} id={`po-tab-${index}`} role="tab" aria-controls={`po-panel-${index}`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} className={tab === name ? "active" : ""} onClick={() => setTab(name)} onKeyDown={(event) => { const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : null; if (next !== null && user?.role !== "auditor") { event.preventDefault(); setTab(tabs[next]); document.getElementById(`po-tab-${next}`)?.focus(); } }}>{name}</button>)}</div>
    <div id="po-panel-0" role="tabpanel" aria-labelledby="po-tab-0" hidden={tab !== tabs[0]}><State error={error} loading={!cases && !error} /><div className="satya-filter-bar"><div className="satya-filter-field"><label htmlFor="saved-po-search">Find a saved purchase order</label><div className="satya-search-input"><Search size={18} /><input id="saved-po-search" className="satya-input" placeholder="Order number, supplier or title" value={filter} onChange={(event) => setFilter(event.target.value)} /></div></div>{user?.role !== "auditor" && <><button className="satya-button" onClick={() => setTab(tabs[1])}><Plus size={17} />Create a PO</button><button className="satya-button secondary" onClick={() => setTab(tabs[2])}><Upload size={17} />Import a PO</button></>}<button className="satya-button secondary" onClick={load} aria-label="Refresh saved purchase orders"><RefreshCw size={17} /></button></div><p className="satya-results-count" role="status">{visible.length} saved purchase orders{cases && cases.length >= 100 ? " · showing the first 100 workspace investigations" : ""}</p><div className="satya-case-grid">{visible.map((item) => { const recordCount = item.recordIds?.length || item.inputRecords?.length || 1; return <Panel key={item.id}><div className="satya-case-card-top"><span className="satya-eyebrow">{item.poId}</span><span className="satya-tag">{recordCount === 1 ? "PO only" : `${recordCount} related records`}</span></div><Link className="satya-case-card-title" href={`/cases/${encodeURIComponent(item.id)}`}>{item.title}</Link><p className="satya-case-supplier">{item.supplier}</p><dl className="satya-case-card-stats"><div><dt>Units ordered</dt><dd>{item.ledger?.ordered ?? "Checking…"}</dd></div><div><dt>Units recorded as delivered</dt><dd>{item.ledger?.received ?? "Checking…"}</dd></div></dl><div className="satya-case-card-actions"><Link href={`/cases/${encodeURIComponent(item.id)}`} className="satya-button">Investigate <ArrowUpRight size={17} /></Link><Link href={`/chat?case=${encodeURIComponent(item.id)}`} className="satya-button secondary"><MessageSquare size={16} />Ask Satya</Link><button className="satya-button secondary" disabled={!!downloading} onClick={() => exportOrder(item)}><Download size={16} />{downloading === item.id ? "Downloading…" : "PO CSV"}</button></div><p className="text-xs text-muted-foreground mt-4">{recordCount === 1 ? "Only the order is stored. No invoice or payment amount has been inferred." : `${item.findingCount} issues listed in the investigation. Review the records before taking action.`}</p></Panel>; })}</div>{cases && !visible.length && <Panel><div className="satya-empty-state"><ClipboardList size={36} /><h2>{filter ? "No matching purchase orders" : "No purchase orders saved yet"}</h2><p>{filter ? "Try another order number or supplier name." : "Create a PO or import an approved purchase order to get started."}</p>{filter ? <button className="satya-button secondary" onClick={() => setFilter("")}>Clear search</button> : user?.role !== "auditor" && <button className="satya-button" onClick={() => setTab(tabs[1])}>Create your first PO</button>}</div></Panel>}</div>
    <div id="po-panel-1" role="tabpanel" aria-labelledby="po-tab-1" hidden={tab !== tabs[1]}><PurchaseOrderForm suppliers={suppliers} onSaved={load} /></div>
    <div id="po-panel-2" role="tabpanel" aria-labelledby="po-tab-2" hidden={tab !== tabs[2]}><ImportWorkspace purchaseOrdersOnly onSaved={load} /></div>
  </BusinessShell>;
}
