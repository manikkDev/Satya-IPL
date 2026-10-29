import crypto from "node:crypto";
import { SourceDocument, BusinessAlert, BusinessCase } from "./models/Business.js";

const checksum = (str) => crypto.createHash("sha256").update(str).digest("hex");

export default async function seedDocumentsAndAlerts(companyId = "satya-demo") {
  console.log(`[Seed] Seeding Source Documents & Business Alerts for company: ${companyId}...`);

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. SOURCE DOCUMENTS (BPCI CHALLENGE & REALISTIC RECONCILIATION DATA)
  // ─────────────────────────────────────────────────────────────────────────────
  const sampleDocuments = [
    // ── Case 1: pumps-1001 (Meridian Pump Supply) ──────────────────────────────
    {
      companyId,
      id: "PO-1001",
      caseId: "pumps-1001",
      name: "BPCI-PO-2026-1001-Meridian-Pumps.csv",
      source: "procurement_erp",
      mediaType: "text/csv",
      documentType: "purchase_order",
      verificationStatus: "verified",
      verifiedBy: "Finance Manager",
      verifiedAt: new Date("2026-10-01T11:00:00+05:30"),
      version: 1,
      content: `PO_NUMBER,SUPPLIER,BUYER,GSTIN,DATE,ITEM_DESCRIPTION,SKU,QTY,UNIT_PRICE,CGST_9,SGST_9,TOTAL_AMOUNT
PO-1001,Meridian Pump Supply,Bharat Petroleum Infrastructure (BPCI),27AABCU9603R1ZM,2026-10-01,Water pump 1 kW Centrifugal Industrial Grade,PUMP-1KW,100,1000.00,9000.00,9000.00,118000.00
`
    },
    {
      companyId,
      id: "GRN-A",
      caseId: "pumps-1001",
      name: "GRN-1001-A-Yard3-Gate-Receipt.csv",
      source: "warehouse_wms",
      mediaType: "text/csv",
      documentType: "delivery_receipt",
      verificationStatus: "verified",
      verifiedBy: "Finance Manager",
      verifiedAt: new Date("2026-10-03T15:00:00+05:30"),
      version: 1,
      content: `GRN_NUMBER,PO_REFERENCE,RECEIVING_LOCATION,RECEIVED_DATE,SKU,RECEIVED_QTY,ACCEPTED_QTY,REJECTED_QTY,INSPECTOR
GRN-A,PO-1001,BPCI Central Depot - Gate 3,2026-10-02,PUMP-1KW,40,40,0,K. Sharma (QC Lead)
`
    },
    {
      companyId,
      id: "GRN-B",
      caseId: "pumps-1001",
      name: "GRN-1001-B-Yard3-Gate-Receipt.csv",
      source: "warehouse_wms",
      mediaType: "text/csv",
      documentType: "delivery_receipt",
      verificationStatus: "verified",
      verifiedBy: "Finance Manager",
      verifiedAt: new Date("2026-10-05T10:00:00+05:30"),
      version: 1,
      content: `GRN_NUMBER,PO_REFERENCE,RECEIVING_LOCATION,RECEIVED_DATE,SKU,RECEIVED_QTY,ACCEPTED_QTY,REJECTED_QTY,INSPECTOR
GRN-B,PO-1001,BPCI Central Depot - Gate 3,2026-10-03,PUMP-1KW,20,20,0,K. Sharma (QC Lead)
`
    },
    {
      companyId,
      id: "INV-041",
      caseId: "pumps-1001",
      name: "INV-M-041-Original-Tax-Invoice.csv",
      source: "vendor_portal",
      mediaType: "text/csv",
      documentType: "invoice",
      verificationStatus: "verified",
      verifiedBy: "Finance Manager",
      verifiedAt: new Date("2026-10-04T12:00:00+05:30"),
      version: 1,
      content: `INVOICE_NO,DATE,PO_REF,VENDOR_NAME,VENDOR_GSTIN,BUYER_GSTIN,BASE_AMOUNT,CGST_9,SGST_9,TOTAL_INR,IRN_HASH
INV-041,2026-10-04,PO-1001,Meridian Pump Supply,27AABCU9603R1ZM,27AAACB0000A1Z5,60000.00,5400.00,5400.00,70800.00,e8f2a1b9c3d4e5f67890123456789abcdef0123456789abcdef0123456789abc
`
    },
    {
      companyId,
      id: "AP-992",
      caseId: "pumps-1001",
      name: "AP-992-Duplicate-Submission-Scan.csv",
      source: "accounts_payable_feed",
      mediaType: "text/csv",
      documentType: "invoice",
      verificationStatus: "pending_verification",
      verifiedBy: null,
      version: 1,
      content: `ENTRY_ID,ENTRY_SOURCE,ORIGINAL_REF,CLAIMED_AMOUNT,STATUS,NOTES
AP-992,AP_PORTAL_RESUBMISSION,INV-041,70800.00,FLAGGED_DUPLICATE,Automated integrity check detected duplicate billing against invoice INV-041
`
    },
    {
      companyId,
      id: "INV-042",
      caseId: "pumps-1001",
      name: "INV-M-042-Secondary-Billing.csv",
      source: "accounts_payable_feed",
      mediaType: "text/csv",
      documentType: "invoice",
      verificationStatus: "pending_verification",
      verifiedBy: null,
      version: 1,
      content: `INVOICE_NO,DATE,PO_REF,VENDOR_NAME,VENDOR_GSTIN,BASE_AMOUNT,TAX,TOTAL_INR,STATUS
INV-042,2026-10-05,PO-1001,Meridian Pump Supply,27AABCU9603R1ZM,20000.00,3600.00,23600.00,PENDING_VERIFICATION
`
    },
    {
      companyId,
      id: "BANK-T01",
      caseId: "pumps-1001",
      name: "SBI-Settlement-Advice-T01.csv",
      source: "sbi_corporate_banking",
      mediaType: "text/csv",
      documentType: "bank_statement",
      verificationStatus: "verified",
      verifiedBy: "Finance Manager",
      verifiedAt: new Date("2026-10-05T16:00:00+05:30"),
      version: 1,
      content: `UTR_NUMBER,TRANSACTION_DATE,PAYER_ACC,BENEFICIARY,AMOUNT_INR,INVOICE_TAG,CLEARING_STATUS
SBIN2026100501,2026-10-05,BPCI-TREASURY-0199,Meridian Pump Supply,30000.00,INV-041,SETTLED_NEFT
`
    },
    {
      companyId,
      id: "BANK-T02",
      caseId: "pumps-1001",
      name: "SBI-Settlement-Advice-T02.csv",
      source: "sbi_corporate_banking",
      mediaType: "text/csv",
      documentType: "bank_statement",
      verificationStatus: "verified",
      verifiedBy: "Finance Manager",
      verifiedAt: new Date("2026-10-06T17:00:00+05:30"),
      version: 1,
      content: `UTR_NUMBER,TRANSACTION_DATE,PAYER_ACC,BENEFICIARY,AMOUNT_INR,INVOICE_TAG,CLEARING_STATUS
SBIN2026100602,2026-10-06,BPCI-TREASURY-0199,Meridian Pump Supply,20800.00,INV-041,SETTLED_RTGS
`
    },
    {
      companyId,
      id: "BANK-T03",
      caseId: "pumps-1001",
      name: "SBI-Unallocated-Transfer-T03.csv",
      source: "sbi_corporate_banking",
      mediaType: "text/csv",
      documentType: "bank_statement",
      verificationStatus: "pending_verification",
      verifiedBy: null,
      version: 1,
      content: `UTR_NUMBER,TRANSACTION_DATE,PAYER_ACC,BENEFICIARY,AMOUNT_INR,INVOICE_TAG,CLEARING_STATUS
SBIN2026100703,2026-10-07,BPCI-TREASURY-0199,Meridian Pump Supply,15000.00,MISSING_REFERENCE,UNALLOCATED_SUSPENSE
`
    },
    {
      companyId,
      id: "DOC-BPCI-CTR-1001",
      caseId: "pumps-1001",
      name: "BPCI-Procurement-Master-Agreement.pdf",
      source: "legal_repository",
      mediaType: "application/pdf",
      documentType: "contract",
      verificationStatus: "verified",
      verifiedBy: "Finance Manager",
      verifiedAt: new Date("2026-10-01T09:00:00+05:30"),
      version: 2,
      content: `================================================================================
BHARAT PETROLEUM & CHEMICALS INFRASTRUCTURE (BPCI)
FRAMEWORK PROCUREMENT AGREEMENT #BPCI-MSA-2026-PUMPS
================================================================================
Buyer: Bharat Petroleum & Chemicals Infrastructure Ltd. (Central PSU)
Supplier: Meridian Pump Supply Ltd., Industrial Area Phase-II, Navi Mumbai
Equipment: Industrial Submersible & Centrifugal Water Pumps (1 kW)
Scope: Supply for Refinery Cooling Towers and Fluid Distribution Systems

Mandatory Terms:
1. 3-Way Reconciliation (PO + GRN + Tax Invoice) required prior to payment release.
2. Payment Cycle: 30 days upon verified Quality Inspection at Central Yard 3.
3. Liquidated Damages: 0.5% per week for delayed delivery beyond promised date.
4. GST Compliance: E-Invoice IRN QR code validation mandatory for all submissions.
================================================================================`
    },

    // ── Case 2: meters-2001 (Helios Energy Systems) ────────────────────────────
    {
      companyId,
      id: "PO-2001",
      caseId: "meters-2001",
      name: "BPCI-PO-2001-Digital-Telemetry-Meters.csv",
      source: "procurement_erp",
      mediaType: "text/csv",
      documentType: "purchase_order",
      verificationStatus: "verified",
      verifiedBy: "Finance Manager",
      version: 1,
      content: `PO_NUMBER,SUPPLIER,BUYER,DATE,ITEM_DESCRIPTION,QTY,UNIT_PRICE,TOTAL_INR
PO-2001,Helios Energy Systems,BPCI Telemetry Division,2026-09-15,Digital Smart Energy Meters 3-Phase,50,2000.00,118000.00
`
    },
    {
      companyId,
      id: "GRN-2001",
      caseId: "meters-2001",
      name: "GRN-2001-Helios-Depot-Receipt.csv",
      source: "warehouse_wms",
      mediaType: "text/csv",
      documentType: "delivery_receipt",
      verificationStatus: "verified",
      verifiedBy: "Finance Manager",
      version: 1,
      content: `GRN_NUMBER,PO_REF,LOCATION,DATE,RECEIVED_QTY,ACCEPTED_QTY,STATUS
GRN-2001,PO-2001,BPCI Grid Substation Yard,2026-09-20,50,50,PASSED_INSPECTION
`
    },
    {
      companyId,
      id: "INV-2001",
      caseId: "meters-2001",
      name: "INV-2001-Helios-Tax-Invoice.csv",
      source: "vendor_portal",
      mediaType: "text/csv",
      documentType: "invoice",
      verificationStatus: "verified",
      verifiedBy: "Finance Manager",
      version: 1,
      content: `INVOICE_NO,PO_REF,VENDOR,DATE,AMOUNT,TAX_CGST,TAX_SGST,NET_TOTAL
INV-2001,PO-2001,Helios Energy Systems,2026-09-22,100000.00,9000.00,9000.00,118000.00
`
    },
    {
      companyId,
      id: "BANK-2001",
      caseId: "meters-2001",
      name: "HDFC-RTGS-Settlement-2001.csv",
      source: "hdfc_corporate_banking",
      mediaType: "text/csv",
      documentType: "bank_statement",
      verificationStatus: "verified",
      verifiedBy: "Finance Manager",
      version: 1,
      content: `UTR_NUMBER,DATE,PAYER,BENEFICIARY,AMOUNT,INVOICE_REF,STATUS
HDFCR20260925001,2026-09-25,BPCI-TREASURY,Helios Energy Systems,118000.00,INV-2001,SETTLED_FULL
`
    },

    // ── Case 3: balances-3001 (Vortex Aero Turbines) ───────────────────────────
    {
      companyId,
      id: "PO-3001",
      caseId: "balances-3001",
      name: "BPCI-PO-3001-High-Pressure-Turbine-Blades.csv",
      source: "procurement_erp",
      mediaType: "text/csv",
      documentType: "purchase_order",
      verificationStatus: "verified",
      verifiedBy: "Finance Manager",
      version: 1,
      content: `PO_NUMBER,SUPPLIER,DATE,ITEM,QTY,UNIT_PRICE,TOTAL_INR
PO-3001,Vortex Aero Turbines,2026-09-10,Titanium Turbine Blade Set,20,50000.00,1180000.00
`
    },
    {
      companyId,
      id: "GRN-3001",
      caseId: "balances-3001",
      name: "GRN-3001-Partial-Delivery-Turbines.csv",
      source: "warehouse_wms",
      mediaType: "text/csv",
      documentType: "delivery_receipt",
      verificationStatus: "verified",
      verifiedBy: "Finance Manager",
      version: 1,
      content: `GRN_NUMBER,PO_REF,DATE,RECEIVED_QTY,ACCEPTED_QTY,REMARK
GRN-3001,PO-3001,2026-09-28,10,10,PARTIAL_DELIVERY_BATCH_1
`
    },
    {
      companyId,
      id: "INV-3001",
      caseId: "balances-3001",
      name: "INV-3001-Vortex-Commercial-Invoice.csv",
      source: "vendor_portal",
      mediaType: "text/csv",
      documentType: "invoice",
      verificationStatus: "pending_verification",
      version: 1,
      content: `INVOICE_NO,PO_REF,DATE,BILLED_QTY,AMOUNT_INR,STATUS
INV-3001,PO-3001,2026-10-01,10,590000.00,PENDING_MATCHING
`
    },

    // ── Case 4: valves-4001 (Apex Copper & Cables) ────────────────────────────
    {
      companyId,
      id: "PO-4001",
      caseId: "valves-4001",
      name: "BPCI-PO-4001-Armored-HV-Power-Cables.csv",
      source: "procurement_erp",
      mediaType: "text/csv",
      documentType: "purchase_order",
      verificationStatus: "verified",
      verifiedBy: "Finance Manager",
      version: 1,
      content: `PO_NUMBER,SUPPLIER,DATE,ITEM,QTY_METERS,RATE_PER_METER,TOTAL_INR
PO-4001,Apex Copper & Cables,2026-09-01,Armored 33kV Copper Cable,500,400.00,236000.00
`
    },
    {
      companyId,
      id: "GRN-4001",
      caseId: "valves-4001",
      name: "GRN-4001-Cable-Drums-Yard4-Receipt.csv",
      source: "warehouse_wms",
      mediaType: "text/csv",
      documentType: "delivery_receipt",
      verificationStatus: "verified",
      verifiedBy: "Finance Manager",
      version: 1,
      content: `GRN_NUMBER,PO_REF,DATE,DRUMS_RECEIVED,METERS_ACCEPTED,INSPECTOR
GRN-4001,PO-4001,2026-09-18,2,500,M. Deshmukh
`
    },
    {
      companyId,
      id: "INV-4001",
      caseId: "valves-4001",
      name: "INV-4001-Apex-Price-Variance-Invoice.csv",
      source: "vendor_portal",
      mediaType: "text/csv",
      documentType: "invoice",
      verificationStatus: "pending_verification",
      version: 1,
      content: `INVOICE_NO,PO_REF,DATE,BILLED_RATE,TOTAL_INR,VARIANCE_NOTE
INV-4001,PO-4001,2026-09-22,430.00,253700.00,Raw material copper index escalation claimed by vendor
`
    },

    // ── Case 5: switches-5001 (OmniSense Metering) ────────────────────────────
    {
      companyId,
      id: "PO-5001",
      caseId: "switches-5001",
      name: "BPCI-PO-5001-Digital-Substation-Switches.csv",
      source: "procurement_erp",
      mediaType: "text/csv",
      documentType: "purchase_order",
      verificationStatus: "verified",
      verifiedBy: "Finance Manager",
      version: 1,
      content: `PO_NUMBER,SUPPLIER,DATE,ITEM,QTY,UNIT_PRICE,TOTAL_INR
PO-5001,OmniSense Metering,2026-09-12,Ethernet Substation Switch IP67,15,8000.00,141600.00
`
    },
    {
      companyId,
      id: "INV-5001",
      caseId: "switches-5001",
      name: "INV-5001-OmniSense-Advance-Invoice.csv",
      source: "vendor_portal",
      mediaType: "text/csv",
      documentType: "invoice",
      verificationStatus: "pending_verification",
      version: 1,
      content: `INVOICE_NO,PO_REF,DATE,BILLED_AMOUNT,NOTE
INV-5001,PO-5001,2026-09-25,141600.00,Invoice submitted before physical delivery; awaiting warehouse GRN
`
    }
  ];

  for (const doc of sampleDocuments) {
    const docChecksum = checksum(doc.content);
    await SourceDocument.updateOne(
      { companyId, id: doc.id },
      {
        $set: {
          ...doc,
          checksum: docChecksum,
          updatedAt: new Date()
        },
        $setOnInsert: {
          createdAt: new Date()
        }
      },
      { upsert: true }
    );
  }
  console.log(`[Seed] Successfully seeded ${sampleDocuments.length} source documents.`);

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. ENTERPRISE BUSINESS ALERTS (PERSISTENT ACTIONABLE NOTIFICATIONS)
  // ─────────────────────────────────────────────────────────────────────────────
  const sampleAlerts = [
    {
      companyId,
      alertId: "ALT-DUP-pumps-1001",
      caseId: "pumps-1001",
      poId: "PO-1001",
      supplier: "Meridian Pump Supply",
      type: "duplicate_candidates",
      severity: "high",
      message: "Duplicate invoice submission detected: AP-992 claims identical amount (INR 70,800.00) and items as INV-041 in order PO-1001",
      dedupKey: "pumps-1001:duplicate:AP-992",
      status: "unread",
      metadata: { disputedExposure: 70800.00, candidateId: "AP-992", originalId: "INV-041" }
    },
    {
      companyId,
      alertId: "ALT-ESC-pumps-1001",
      caseId: "pumps-1001",
      poId: "PO-1001",
      supplier: "Meridian Pump Supply",
      type: "escalated",
      severity: "high",
      message: "Order PO-1001 escalated by Operations Analyst: Incomplete delivery and duplicate invoice conflict require Manager decision",
      dedupKey: "pumps-1001:escalated:active",
      status: "unread",
      metadata: { previousStatus: "needs_review", currentStatus: "escalated" }
    },
    {
      companyId,
      alertId: "ALT-BLK-pumps-1001",
      caseId: "pumps-1001",
      poId: "PO-1001",
      supplier: "Meridian Pump Supply",
      type: "blocking_findings",
      severity: "high",
      message: "3 blocking discrepancy findings prevent 3-way match clearance in PO-1001 (Meridian Pump Supply)",
      dedupKey: "pumps-1001:blocking:3",
      status: "unread",
      metadata: { count: 3 }
    },
    {
      companyId,
      alertId: "ALT-UNL-pumps-1001",
      caseId: "pumps-1001",
      poId: "PO-1001",
      supplier: "Meridian Pump Supply",
      type: "unlinked_payments",
      severity: "medium",
      message: "Unallocated Treasury Transfer: INR 15,000.00 settled via SBI NEFT (UTR: SBIN2026100703) has no invoice tag in PO-1001",
      dedupKey: "pumps-1001:unlinked:BANK-T03",
      status: "unread",
      metadata: { amount: 15000.00, utr: "SBIN2026100703" }
    },
    {
      companyId,
      alertId: "ALT-MISS-switches-5001",
      caseId: "switches-5001",
      poId: "PO-5001",
      supplier: "OmniSense Metering",
      type: "missing_evidence",
      severity: "high",
      message: "Missing Goods Receipt Note: Commercial Invoice INV-5001 submitted by OmniSense Metering without warehouse delivery confirmation in PO-5001",
      dedupKey: "switches-5001:missing_grn",
      status: "unread",
      metadata: { invoiceId: "INV-5001", missingRecord: "GRN" }
    },
    {
      companyId,
      alertId: "ALT-PRIC-valves-4001",
      caseId: "valves-4001",
      poId: "PO-4001",
      supplier: "Apex Copper & Cables",
      type: "price_variance",
      severity: "medium",
      message: "Unit price variance detected: Billed rate (INR 430.00/m) exceeds agreed PO contract terms (INR 400.00/m) in PO-4001",
      dedupKey: "valves-4001:price_variance",
      status: "unread",
      metadata: { expectedRate: 400.00, billedRate: 430.00 }
    },
    {
      companyId,
      alertId: "ALT-BPCI-COMPLIANCE",
      caseId: "pumps-1001",
      poId: "PO-1001",
      supplier: "Meridian Pump Supply",
      type: "compliance_risk",
      severity: "medium",
      message: "BPCI Energy Procurement Compliance: Mandatory 3-Way match certificate and QC inspection sign-off required prior to settlement payout",
      dedupKey: "bpci:compliance:audit-q3",
      status: "unread",
      metadata: { regulatoryStandard: "BPCI-PROC-2026" }
    }
  ];

  for (const alt of sampleAlerts) {
    await BusinessAlert.updateOne(
      { companyId, alertId: alt.alertId },
      {
        $set: {
          ...alt,
          id: alt.alertId,
          updatedAt: new Date()
        },
        $setOnInsert: {
          createdAt: new Date()
        }
      },
      { upsert: true }
    );
  }
  console.log(`[Seed] Successfully seeded ${sampleAlerts.length} business alerts.`);
}
