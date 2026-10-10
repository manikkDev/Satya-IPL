"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BusinessShell, { Panel, State } from "@/components/BusinessShell";
import { businessApi, waitForJob } from "@/lib/business-api";

export default function InboxPage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const commit = async () => {
    setBusy(true); setError("");
    try { const result = await businessApi.import(JSON.parse(text)); if (result.job) await waitForJob(result.job.id); router.push(`/cases/${result.caseId}`); }
    catch (error) { setError(error instanceof Error ? error.message : "Import failed"); }
    finally { setBusy(false); }
  };
  return <BusinessShell title="Import workspace" subtitle="Structured multi-source records first. Original values, exact decimal strings and explicit timezones."><div className="satya-two-column"><Panel title="Source bundle"><p className="mb-4 text-sm text-muted-foreground">Upload a JSON bundle containing a title, poId and records from procurement, supplier/AP, warehouse and bank exports. The entire bundle is validated before persistence. PDF OCR and column-mapped CSV are later phases.</p><label className="satya-button secondary cursor-pointer">Choose JSON file<input type="file" accept="application/json,.json" className="sr-only" onChange={async (event) => { const file = event.target.files?.[0]; if (file) { if (file.size > 1500000) { setError("Choose a source file smaller than 1.5 MB"); return; } setText(await file.text()); } }} /></label><textarea aria-label="Source JSON bundle" className="satya-input satya-code mt-4" rows={16} value={text} onChange={(event) => setText(event.target.value)} placeholder={'{\n  "title": "My procurement investigation",\n  "poId": "PO-NEW-1",\n  "records": [...]\n}'} /><button className="satya-button mt-4" disabled={busy || !text.trim()} onClick={commit}>{busy ? "Validating and reconciling…" : "Validate & import records"}</button><State error={error} /></Panel><div className="space-y-5"><Panel title="What Satya preserves"><ul className="satya-list"><li>Source record IDs, supplier and original references.</li><li>INR / currency and exact decimal string amounts.</li><li>Separate CGST, SGST, IGST or cess declarations.</li><li>Record and knowledge timestamps with timezone.</li><li>Settled versus pending/reversed bank observations.</li><li>Disputed source rows—not hidden duplicate deletion.</li></ul></Panel><Panel title="Schema example"><pre className="satya-code">{JSON.stringify({ id: "PO-NEW-1", type: "PO", reference: "PO/2026/NEW1", source: "procurement_export", supplier: "Fictional Supplier", currency: "INR", status: "approved", occurredAt: "2026-10-01T10:00:00+05:30", observedAt: "2026-10-01T10:00:00+05:30", lines: [{ id: "1", description: "Pump 1 kW", sku: "PUMP-1KW", quantity: "10", unitPrice: "1000", uom: "EA" }] }, null, 2)}</pre></Panel></div></div></BusinessShell>;
}
