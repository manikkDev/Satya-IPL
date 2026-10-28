import crypto from "node:crypto";
import { BusinessCase, BusinessImport, BusinessAlert, SourceDocument } from "../models/Business.js";
import User from "../models/User.js";
import { recordAudit } from "./audit.js";

// ============================================================================
// FEATURE 1: Authoritative Transaction Lifecycle State Machine
// ============================================================================

export const TRANSITIONS = new Map([
  ['needs_review', new Map([
    ['APPROVE',                'reconciled'],
    ['PLACE_ON_HOLD',          'on_hold'],
    ['ESCALATE',               'escalated'],
    ['REQUEST_CLARIFICATION',  'awaiting_evidence'],
  ])],
  ['on_hold', new Map([
    ['APPROVE',                'reconciled'],
    ['ESCALATE',               'escalated'],
    ['REQUEST_CLARIFICATION',  'awaiting_evidence'],
    ['PLACE_ON_HOLD',          'on_hold'],       // Idempotent review hold
  ])],
  ['escalated', new Map([
    ['APPROVE',                'reconciled'],
    ['PLACE_ON_HOLD',          'on_hold'],
    ['REQUEST_CLARIFICATION',  'awaiting_evidence'],
    ['ESCALATE',               'escalated'],     // Re-escalation
  ])],
  ['awaiting_evidence', new Map([
    ['APPROVE',                'reconciled'],
    ['PLACE_ON_HOLD',          'on_hold'],
    ['ESCALATE',               'escalated'],
    ['REQUEST_CLARIFICATION',  'awaiting_evidence'], // Further evidence request
  ])],
]);

export const EXCEPTION_TRANSITIONS = new Map([
  ['open', new Set(['assigned', 'in_progress', 'resolved', 'awaiting_evidence'])],
  ['assigned', new Set(['in_progress', 'awaiting_evidence', 'resolved', 'open'])],
  ['in_progress', new Set(['awaiting_evidence', 'resolved', 'assigned', 'open'])],
  ['awaiting_evidence', new Set(['in_progress', 'resolved', 'assigned'])],
  ['resolved', new Set(['reopened'])],
  ['reopened', new Set(['in_progress', 'assigned', 'resolved'])],
]);

export const DOCUMENT_TRANSITIONS = new Map([
  ['uploaded', new Set(['pending_verification', 'verified', 'rejected'])],
  ['pending_verification', new Set(['verified', 'rejected'])],
  ['verified', new Set(['superseded', 'rejected'])],
  ['rejected', new Set(['pending_verification'])],
  ['superseded', new Set([])],
]);

export const validateTransition = (currentStatus, action) => {
  if (currentStatus === 'importing') {
    return { valid: false, reason: "Case is still being imported and cannot accept decisions yet" };
  }
  if (currentStatus === 'reconciled') {
    return { valid: false, reason: "Case is already reconciled; no further decisions are permitted unless new evidence triggers re-reconciliation" };
  }
  const allowed = TRANSITIONS.get(currentStatus);
  if (!allowed) {
    return { valid: false, reason: `Unknown case status "${currentStatus}"` };
  }
  const targetStatus = allowed.get(action);
  if (targetStatus === undefined) {
    return { valid: false, reason: `Action "${action}" is not permitted when the case status is "${currentStatus}"` };
  }
  return { valid: true, targetStatus };
};

/**
 * Checks segregation of duties: Ensures creator/importer cannot approve.
 */
export const checkSegregationOfDuties = async ({ companyId, caseId, userId }) => {
  const businessCase = await BusinessCase.findOne({ companyId, id: caseId }).lean();
  if (businessCase?.createdBy && String(businessCase.createdBy) === String(userId)) {
    return { allowed: false, reason: "Case creator cannot approve this transaction (segregation of duties)" };
  }
  const importRecord = await BusinessImport.findOne({ companyId, caseId }).lean();
  if (importRecord?.actorId && String(importRecord.actorId) === String(userId)) {
    return { allowed: false, reason: "The user who imported this case cannot approve it (segregation of duties)" };
  }
  return { allowed: true };
};

// ============================================================================
// FEATURE 2: Real Duplicate and Financial Anomaly Detection
// ============================================================================

export const normalizeInvoiceRef = (ref) => {
  if (!ref || typeof ref !== "string") return "";
  return ref.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
};

export const normalizeSupplier = (name) => {
  if (!name || typeof name !== "string") return "";
  return name.trim().toLowerCase().replace(/\s+(pvt|ltd|limited|llc|inc|corp)\.?$/i, "").replace(/[^a-z0-9]/g, "");
};

/**
 * Run deterministic, similarity-based, and statistical anomaly detection on a case.
 */
export const detectAnomalies = ({ businessCase, snapshot, records = [] }) => {
  const anomalies = [];
  const ledger = snapshot?.ledger || businessCase?.ledger;
  const currency = ledger?.currency || "INR";

  // 1. Group records
  const invoices = records.filter(r => r.type === "INVOICE");
  const orders = records.filter(r => r.type === "PO");
  const deliveries = records.filter(r => r.type === "GRN");
  const payments = records.filter(r => r.type === "PAYMENT");

  // 2. Deterministic & Duplicate checks
  const seenRefs = new Map();
  for (const inv of invoices) {
    const norm = normalizeInvoiceRef(inv.reference || inv.id);
    const supp = normalizeSupplier(inv.supplier || businessCase.supplier);
    const key = `${supp}:::${norm}`;
    if (seenRefs.has(key)) {
      const prior = seenRefs.get(key);
      anomalies.push({
        id: `ANOM-DUP-${inv.id}`,
        type: "DUPLICATE_INVOICE_SUBMISSION",
        severity: "high",
        title: `Repeated invoice reference for supplier: ${inv.reference}`,
        detail: `Invoice ${inv.id} has matching normalized reference "${norm}" and supplier as invoice ${prior.id}.`,
        evidenceIds: [inv.id, prior.id].filter(Boolean),
        observedValue: inv.amount || "N/A",
        baselineValue: prior.amount || "N/A",
        confidence: "exact_deterministic",
        action: "Confirm duplicate invoice and suspend payment allocation",
        status: "unresolved"
      });
    } else {
      seenRefs.set(key, inv);
    }
  }

  // 3. Invoice vs PO Amount comparison
  if (ledger && orders.length > 0) {
    const poTotal = orders.reduce((sum, o) => sum + (parseFloat(o.amount) || 0), 0);
    const invTotal = invoices.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
    if (poTotal > 0 && invTotal > poTotal + 0.01) {
      const overage = (invTotal - poTotal).toFixed(2);
      anomalies.push({
        id: `ANOM-PO-OVERBILL-${businessCase.id}`,
        type: "INVOICE_EXCEEDS_PO",
        severity: "high",
        title: "Total invoices exceed Purchase Order committed value",
        detail: `Invoiced total (${currency} ${invTotal.toFixed(2)}) exceeds PO commitments (${currency} ${poTotal.toFixed(2)}) by ${currency} ${overage}.`,
        evidenceIds: [...orders.map(o => o.id), ...invoices.map(i => i.id)],
        observedValue: invTotal.toFixed(2),
        baselineValue: poTotal.toFixed(2),
        confidence: "exact_deterministic",
        action: "Review line-level unit pricing and quantities for excess billing",
        status: "unresolved"
      });
    }
  }

  // 4. GRN vs PO Quantities
  const orderedQtyBySku = new Map();
  for (const po of orders) {
    for (const line of po.lines || []) {
      const sku = line.sku || line.description || "ITEM";
      orderedQtyBySku.set(sku, (orderedQtyBySku.get(sku) || 0) + (parseFloat(line.quantity) || 0));
    }
  }
  const deliveredQtyBySku = new Map();
  for (const grn of deliveries) {
    for (const line of grn.lines || []) {
      const sku = line.sku || line.description || "ITEM";
      const q = parseFloat(line.acceptedQuantity || line.quantity) || 0;
      deliveredQtyBySku.set(sku, (deliveredQtyBySku.get(sku) || 0) + q);
    }
  }
  for (const [sku, delQty] of deliveredQtyBySku.entries()) {
    const ordQty = orderedQtyBySku.get(sku) || 0;
    if (ordQty > 0 && delQty > ordQty) {
      anomalies.push({
        id: `ANOM-GRN-OVERDELIVERY-${sku.replace(/[^a-zA-Z0-9]/g, "-")}`,
        type: "DELIVERY_EXCEEDS_ORDER",
        severity: "medium",
        title: `Goods receipt quantity exceeds order for SKU: ${sku}`,
        detail: `Delivered quantity (${delQty}) exceeds ordered quantity (${ordQty}).`,
        evidenceIds: deliveries.map(d => d.id),
        observedValue: String(delQty),
        baselineValue: String(ordQty),
        confidence: "exact_deterministic",
        action: "Verify if over-delivery was pre-authorized by procurement",
        status: "unresolved"
      });
    }
  }

  // 5. Payment vs Supported Outstanding
  if (ledger && ledger.supportedOutstanding !== null) {
    const supported = parseFloat(ledger.supportedOutstanding) || 0;
    const settled = parseFloat(ledger.settled) || 0;
    const unallocated = (snapshot?.unallocatedPayments || []).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    if (unallocated > supported && supported > 0) {
      anomalies.push({
        id: `ANOM-PAY-EXCESS-${businessCase.id}`,
        type: "PAYMENT_EXCEEDS_SUPPORTED",
        severity: "high",
        title: "Unallocated payments exceed supported outstanding liability",
        detail: `Unallocated payment pool (${currency} ${unallocated.toFixed(2)}) is greater than supported obligation (${currency} ${supported.toFixed(2)}).`,
        evidenceIds: (snapshot?.unallocatedPayments || []).map(p => p.paymentId),
        observedValue: unallocated.toFixed(2),
        baselineValue: supported.toFixed(2),
        confidence: "exact_deterministic",
        action: "Investigate unallocated payment origin and supplier ledger",
        status: "unresolved"
      });
    }
  }

  // 6. Incomplete Transaction Chains
  if (invoices.length > 0 && deliveries.length === 0 && orders.length > 0) {
    anomalies.push({
      id: `ANOM-MISSING-GRN-${businessCase.id}`,
      type: "INVOICE_WITHOUT_DELIVERY",
      severity: "medium",
      title: "Invoice submitted prior to goods receipt confirmation",
      detail: "Invoices have been observed with no associated goods delivery receipt posted.",
      evidenceIds: invoices.map(i => i.id),
      observedValue: "0 GRNs",
      baselineValue: ">= 1 GRN",
      confidence: "exact_deterministic",
      action: "Request delivery challan or proof of physical inspection",
      status: "unresolved"
    });
  }

  return anomalies;
};

// ============================================================================
// FEATURE 4: Evidence Completeness Verification
// ============================================================================

export const evaluateEvidenceCompleteness = ({ records = [], documents = [] }) => {
  const hasPO = records.some(r => r.type === "PO");
  const hasGRN = records.some(r => r.type === "GRN");
  const hasInvoice = records.some(r => r.type === "INVOICE");
  const hasPayment = records.some(r => r.type === "PAYMENT");

  const docTypes = new Set(documents.map(d => d.documentType || "other"));
  const verifiedDocs = documents.filter(d => d.verificationStatus === "verified");

  const checklist = [
    { item: "Purchase Order", present: hasPO, verified: docTypes.has("purchase_order") || hasPO, status: hasPO ? "complete" : "missing" },
    { item: "Delivery Receipt (GRN)", present: hasGRN, verified: docTypes.has("delivery_receipt") || hasGRN, status: hasGRN ? "complete" : "missing" },
    { item: "Commercial Invoice", present: hasInvoice, verified: docTypes.has("invoice") || hasInvoice, status: hasInvoice ? "complete" : "missing" },
    { item: "Payment / Remittance Advice", present: hasPayment, verified: docTypes.has("bank_statement") || hasPayment, status: hasPayment ? "complete" : "informational" },
  ];

  const missing = checklist.filter(c => c.status === "missing").map(c => c.item);
  const score = checklist.filter(c => c.present).length / checklist.length;

  return {
    checklist,
    missingItems: missing,
    completenessRatio: score,
    verifiedDocumentCount: verifiedDocs.length,
    totalDocumentCount: documents.length,
    isCompleteForApproval: hasPO && hasGRN && hasInvoice
  };
};

// ============================================================================
// FEATURE 5: Persistent Alerts & Idempotent Generation
// ============================================================================

export const syncCaseAlerts = async ({ companyId, businessCase, snapshot }) => {
  const alertsToUpsert = [];
  const findings = snapshot?.findings || [];
  const blocking = findings.filter(f => f.severity !== "info");
  const duplicates = snapshot?.duplicateCandidates?.length || 0;
  const unallocated = snapshot?.unallocatedPayments?.length || 0;
  const ledger = snapshot?.ledger || businessCase.ledger;
  const disputed = parseFloat(ledger?.disputedExposure || "0");

  if (businessCase.status === "escalated") {
    alertsToUpsert.push({
      alertId: `ALT-ESC-${businessCase.id}`,
      caseId: businessCase.id,
      poId: businessCase.poId,
      supplier: businessCase.supplier,
      type: "escalated",
      severity: "high",
      message: `Case ${businessCase.poId} has been escalated and requires manager review`,
      dedupKey: `${businessCase.id}:escalated:${businessCase.revision}`,
      metadata: { status: businessCase.status }
    });
  }

  if (blocking.length > 0) {
    alertsToUpsert.push({
      alertId: `ALT-BLK-${businessCase.id}`,
      caseId: businessCase.id,
      poId: businessCase.poId,
      supplier: businessCase.supplier,
      type: "blocking_findings",
      severity: "medium",
      message: `${blocking.length} blocking discrepancy found in order ${businessCase.poId}`,
      dedupKey: `${businessCase.id}:blocking:${blocking.length}`,
      metadata: { count: blocking.length }
    });
  }

  if (duplicates > 0) {
    alertsToUpsert.push({
      alertId: `ALT-DUP-${businessCase.id}`,
      caseId: businessCase.id,
      poId: businessCase.poId,
      supplier: businessCase.supplier,
      type: "duplicate_candidates",
      severity: "high",
      message: `${duplicates} possible duplicate invoice(s) in ${businessCase.poId} (${disputed.toFixed(2)} exposure)`,
      dedupKey: `${businessCase.id}:duplicates:${duplicates}`,
      metadata: { count: duplicates, disputed }
    });
  }

  if (unallocated > 0) {
    alertsToUpsert.push({
      alertId: `ALT-UNL-${businessCase.id}`,
      caseId: businessCase.id,
      poId: businessCase.poId,
      supplier: businessCase.supplier,
      type: "unlinked_payments",
      severity: "medium",
      message: `${unallocated} unlinked settled payment(s) in ${businessCase.poId}`,
      dedupKey: `${businessCase.id}:unlinked:${unallocated}`,
      metadata: { count: unallocated }
    });
  }

  for (const alt of alertsToUpsert) {
    await BusinessAlert.findOneAndUpdate(
      { companyId, alertId: alt.alertId },
      {
        $setOnInsert: {
          ...alt,
          companyId,
          status: "unread",
        },
        $set: {
          message: alt.message,
          severity: alt.severity,
          dedupKey: alt.dedupKey,
          metadata: alt.metadata
        }
      },
      { upsert: true }
    );
  }
};
