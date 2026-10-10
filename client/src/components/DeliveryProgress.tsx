"use client";

import { ClipboardList, Truck, PackageCheck, Clock3, ArrowUpRight, FileSearch, CalendarDays } from 'lucide-react';
import { Panel } from '@/components/BusinessShell';
import type { BusinessCase, BusinessLine, Snapshot } from '@/lib/business-api';

function sourceQuantity(lines: BusinessLine[] = []) {
  const scale = BigInt(1000000);
  const total = lines.reduce((sum, line) => {
    const text = line.quantity || '0';
    if (!/^\d+(?:\.\d{1,6})?$/.test(text)) return sum;
    const [whole, fraction = ''] = text.split('.');
    return sum + BigInt(whole) * scale + BigInt(fraction.padEnd(6, '0'));
  }, BigInt(0));
  const fraction = String(total % scale).padStart(6, '0').replace(/0+$/, '');
  return `${total / scale}${fraction ? `.${fraction}` : ''}`;
}
export default function DeliveryProgress({ businessCase, snapshot, onInspect }: { businessCase: BusinessCase; snapshot: Snapshot; onInspect: (id: string) => void }) {
  const ledger = snapshot.ledger;
  const po = businessCase.records.find((record) => record.id === businessCase.poId);
  const receipts = businessCase.records.filter((record) => ['GRN', 'RETURN'].includes(record.type) && record.poId === businessCase.poId && record.supplier === businessCase.supplier && record.status !== 'reversed' && Date.parse(record.observedAt) <= Date.parse(snapshot.observedBefore)).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id.localeCompare(b.id));
  const fulfilled = Math.min(100, Math.max(0, Number(ledger.received) / Math.max(Number(ledger.ordered), 1) * 100));
  const accepted = Math.min(fulfilled, Math.max(0, Number(ledger.accepted) / Math.max(Number(ledger.ordered), 1) * 100));
  const gap = snapshot.findings.some((finding) => ['SOURCE_COVERAGE_GAP', 'UNKNOWN_UNIT_CONVERSION'].includes(finding.type));
  const overdue = snapshot.findings.some((finding) => finding.type === 'OVERDUE_DELIVERY_SHORTFALL');
  const full = Number(ledger.openDelivery) === 0;
  const status = gap ? 'Evidence needs review' : overdue ? 'Delivery needs follow-up' : full ? 'Fully received' : 'Partially received';
  const date = (timestamp: string) => new Date(timestamp).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
  const circumference = 2 * Math.PI * 43;
  return <Panel><div className="satya-delivery-heading"><div><p className="satya-eyebrow">FULFILMENT · {businessCase.poId}</p><h2>From order to receiving evidence</h2><p>Follow the receipts behind each quantity.</p></div><span className={`satya-status ${full && !gap ? 'ok' : 'review'}`}>{status}</span></div><div className="satya-delivery-overview"><div className="satya-delivery-ring"><svg viewBox="0 0 112 112" role="img" aria-label={`${fulfilled.toFixed(0)} percent of ordered quantity received`}><circle cx="56" cy="56" r="43" fill="none" stroke="var(--muted)" strokeWidth="9" /><circle cx="56" cy="56" r="43" fill="none" stroke="var(--primary)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${circumference * fulfilled / 100} ${circumference}`} transform="rotate(-90 56 56)" /></svg><div><strong>{fulfilled.toFixed(0)}%</strong><span>received</span></div></div><div className="satya-delivery-context"><h3>{full ? 'Receiving is complete.' : `${ledger.openDelivery} ordered units still to arrive.`}</h3><p>{gap ? 'The supplied evidence or unit mapping is incomplete. Missing records are not proof of non-delivery.' : overdue ? 'The current check reports a delivery shortfall after the promised date. Review the warehouse evidence before escalating.' : full ? 'Receiving completion does not create a new invoice or authorize payment.' : 'A partial delivery is not automatically an error. Check the schedule, invoicing and receipt evidence separately.'}</p>{po?.dueAt && <span><CalendarDays size={15} />Promised delivery: {date(po.dueAt)}</span>}</div></div><div className="satya-delivery-metrics">{[
    { label: 'Ordered', value: ledger.ordered, detail: 'Approved PO quantity', icon: ClipboardList },
    { label: 'Received', value: ledger.received, detail: 'Net buyer receipts', icon: Truck },
    { label: 'Accepted', value: ledger.accepted, detail: 'Explicit acceptance evidence', icon: PackageCheck },
    { label: 'Open delivery', value: ledger.openDelivery, detail: 'Not received against order', icon: Clock3 },
  ].map(({ label, value, detail, icon: Icon }) => <div key={label}><span><Icon size={16} />{label}</span><strong>{value}</strong><small>{detail}</small></div>)}</div><div className="satya-delivery-track" role="progressbar" aria-label="Receiving progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fulfilled)}><i className="accepted" style={{ width: `${accepted}%` }} /><i className="received" style={{ width: `${fulfilled - accepted}%` }} /></div><div className="satya-delivery-track-key"><span><i className="accepted" />Acceptance evidenced</span><span><i className="received" />Received, no acceptance established</span><span><i />Not received</span></div><div className="satya-receipt-heading"><h3>Receiving trail</h3><span>{receipts.length} source observations</span></div>{receipts.length ? <ol className="satya-receipt-trail">{receipts.map((receipt, index) => <li key={receipt.id}><span className={`satya-receipt-dot ${receipt.type === 'RETURN' ? 'return' : ''}`}>{receipt.type === 'RETURN' ? 'R' : String(index + 1).padStart(2, '0')}</span><div><button className="satya-receipt-reference" onClick={() => onInspect(receipt.id)}>{receipt.reference}<ArrowUpRight size={14} /></button><p>{date(receipt.occurredAt)} · {receipt.source.replaceAll('_', ' ')}</p><small>{receipt.lines?.[0]?.description || 'Buyer receiving observation'}</small></div><div className="satya-receipt-quantity"><strong>{receipt.type === 'RETURN' ? '−' : '+'}{sourceQuantity(receipt.lines)} <small>{receipt.lines?.[0]?.uom || 'units'}</small></strong><button className="satya-evidence-chip" onClick={() => onInspect(receipt.id)}><FileSearch size={13} />View source</button></div></li>)}</ol> : <div className="satya-notice">No compatible buyer receipt is visible at this snapshot&apos;s knowledge cutoff.</div>}<div className="satya-delivery-footer"><span>These are source-backed quantities, not a payment approval.</span><button onClick={() => onInspect(businessCase.poId)}>Inspect purchase order <ArrowUpRight size={14} /></button></div></Panel>;
}
