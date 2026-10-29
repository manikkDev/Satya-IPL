import { ContractAgreement, ContractObligation, SourceDocument } from "../models/Business.js";

/**
 * Evaluates legal clause contradictions and supersession between agreements and addenda.
 * Specifically handles the classic MOU contradiction pattern:
 * - Original MOU sets expiry (e.g. 30 Nov 2026)
 * - Addendum sets extended date (e.g. 31 March 2027)
 * - Checks signature validity, effective dates, and authority status.
 */
export async function evaluateContractContradictions(companyId) {
  const agreements = await ContractAgreement.find({ companyId }).lean();
  const obligations = await ContractObligation.find({ companyId }).lean();

  const contradictions = [];
  const graphEdges = [];
  const graphNodes = [];

  // Group agreements by counterparty / project family
  const byCounterparty = new Map();
  for (const ag of agreements) {
    graphNodes.push({
      id: ag.id,
      label: ag.agreementNumber,
      title: ag.title,
      type: ag.category,
      effectiveDate: ag.effectiveDate,
      expiryDate: ag.expiryDate,
      status: ag.status
    });

    const key = ag.counterparty.toLowerCase().trim();
    if (!byCounterparty.has(key)) byCounterparty.set(key, []);
    byCounterparty.get(key).push(ag);
  }

  for (const [counterparty, group] of byCounterparty.entries()) {
    const baseMous = group.filter(a => a.category === "MOU" || a.category === "FRAMEWORK_MSA");
    const addenda = group.filter(a => a.category === "ADDENDUM");

    for (const addendum of addenda) {
      const targetBase = baseMous.find(m => m.id === addendum.supersedesAgreementId || m.agreementNumber === addendum.supersedesAgreementId) || baseMous[0];

      if (targetBase) {
        // Document supersession edge
        graphEdges.push({
          id: `EDGE-SUP-${addendum.id}-${targetBase.id}`,
          source: addendum.id,
          target: targetBase.id,
          type: "DOCUMENT_SUPERSEDES_DOCUMENT",
          label: "Supersedes & Extends",
          status: addendum.status
        });

        // Check date contradiction
        const baseExpiry = new Date(targetBase.expiryDate);
        const addendumExpiry = new Date(addendum.expiryDate);

        const hasSignedBoth = addendum.signatures?.every(s => s.verified) && targetBase.signatures?.every(s => s.verified);

        if (baseExpiry.getTime() !== addendumExpiry.getTime()) {
          contradictions.push({
            id: `CONTRA-${targetBase.id}-${addendum.id}`,
            counterparty: targetBase.counterparty,
            topic: "Agreement Expiry & Operational Timeline",
            baseAgreement: {
              id: targetBase.id,
              number: targetBase.agreementNumber,
              expiryDate: targetBase.expiryDate,
              clauseRef: targetBase.clauses?.find(c => c.topic === "EXPIRY")?.clauseId || "Clause 12.1",
              clauseText: targetBase.clauses?.find(c => c.topic === "EXPIRY")?.text || "This MOU shall expire on 30 November 2026 unless renewed by mutual written agreement."
            },
            supersedingDocument: {
              id: addendum.id,
              number: addendum.agreementNumber,
              extendedExpiryDate: addendum.expiryDate,
              clauseRef: addendum.clauses?.find(c => c.topic === "EXPIRY_EXTENSION")?.clauseId || "Clause 2.1",
              clauseText: addendum.clauses?.find(c => c.topic === "EXPIRY_EXTENSION")?.text || "The operational validity period is hereby extended through 31 March 2027.",
              allSignaturesVerified: Boolean(hasSignedBoth)
            },
            status: hasSignedBoth ? "superseded_authoritative" : "disputed_signature_pending",
            recommendation: hasSignedBoth
              ? "Addendum #1 is authoritative. Effective deadline adjusted to 31 March 2027. Old 30 Nov deadline suppressed."
              : "Disputed Authority: Counterparty signature on Addendum #1 is pending verification. Both dates remain visible to auditors.",
            authoritativeExpiry: hasSignedBoth ? addendum.expiryDate : targetBase.expiryDate
          });
        }
      }
    }
  }

  // Link obligations to agreements
  for (const obl of obligations) {
    graphNodes.push({
      id: obl.id,
      label: obl.obligationId,
      title: obl.title,
      type: "OBLIGATION",
      dueDate: obl.dueDate,
      status: obl.status
    });

    graphEdges.push({
      id: `EDGE-OBL-${obl.agreementId}-${obl.id}`,
      source: obl.agreementId,
      target: obl.id,
      type: "AGREEMENT_CREATES_OBLIGATION",
      label: "Creates Obligation",
      status: obl.status
    });

    if (obl.caseId) {
      graphEdges.push({
        id: `EDGE-TASK-${obl.id}-${obl.caseId}`,
        source: obl.id,
        target: obl.caseId,
        type: "OBLIGATION_HAS_TASK",
        label: "Associated Case",
        status: "active"
      });
    }
  }

  return {
    agreements,
    obligations,
    contradictions,
    evidenceGraph: {
      nodes: graphNodes,
      edges: graphEdges
    }
  };
}

export async function seedContractObligations(companyId = "satya-demo") {
  console.log(`[ContractSeed] Seeding Contract & Legal MOU Intelligence for ${companyId}...`);

  const agreements = [
    {
      companyId,
      id: "AGR-BPCI-MOU-2026",
      agreementNumber: "BPCI-MOU-2026-ENG",
      title: "Master Memorandum of Understanding — Industrial Fluid Equipment Supply",
      category: "MOU",
      counterparty: "Meridian Pump Supply Ltd.",
      effectiveDate: new Date("2026-04-01T00:00:00+05:30"),
      expiryDate: new Date("2026-11-30T23:59:59+05:30"),
      status: "superseded",
      supersededByAgreementId: "AGR-ADDENDUM-2026-01",
      governingLaw: "Indian Contract Act & BPCI Public Procurement Guidelines",
      signatures: [
        { party: "Bharat Petroleum Infrastructure (BPCI)", signatory: "R. Venkatraman (General Manager Procurement)", date: new Date("2026-03-28"), verified: true },
        { party: "Meridian Pump Supply Ltd.", signatory: "A. K. Mehta (Managing Director)", date: new Date("2026-03-29"), verified: true }
      ],
      clauses: [
        { clauseId: "Clause 3.1", topic: "SCOPE", title: "Supply Scope", text: "Supplier agrees to manufacture, test, and supply centrifugal pumps and associated cooling auxiliaries as per BPCI technical specifications." },
        { clauseId: "Clause 8.4", topic: "THREE_WAY_MATCH", title: "Mandatory Reconciliation", text: "All invoices must undergo automated 3-Way Match against physical Goods Receipt Notes and approved PO rates prior to fund release." },
        { clauseId: "Clause 12.1", topic: "EXPIRY", title: "Term and Expiry", text: "This Memorandum of Understanding shall remain valid until 30 November 2026 unless extended by formal addendum." }
      ]
    },
    {
      companyId,
      id: "AGR-ADDENDUM-2026-01",
      agreementNumber: "ADDENDUM-BPCI-2026-01",
      title: "Addendum #1 to MOU — Timeline Extension & Winter Maintenance Scope",
      category: "ADDENDUM",
      counterparty: "Meridian Pump Supply Ltd.",
      effectiveDate: new Date("2026-10-15T00:00:00+05:30"),
      expiryDate: new Date("2027-03-31T23:59:59+05:30"),
      status: "active",
      supersedesAgreementId: "AGR-BPCI-MOU-2026",
      governingLaw: "Indian Contract Act & BPCI Public Procurement Guidelines",
      signatures: [
        { party: "Bharat Petroleum Infrastructure (BPCI)", signatory: "R. Venkatraman (General Manager Procurement)", date: new Date("2026-10-14"), verified: true },
        { party: "Meridian Pump Supply Ltd.", signatory: "A. K. Mehta (Managing Director)", date: new Date("2026-10-15"), verified: true }
      ],
      clauses: [
        { clauseId: "Clause 1.2", topic: "SCOPE_EXTENSION", title: "Extended Auxiliary Scope", text: "Scope extended to cover winter refinery cooling auxiliary spare pumps." },
        { clauseId: "Clause 2.1", topic: "EXPIRY_EXTENSION", title: "Operational Expiry Extension", text: "The operational validity period stipulated under Clause 12.1 of BPCI-MOU-2026-ENG is hereby extended through 31 March 2027." }
      ]
    },
    {
      companyId,
      id: "AGR-HELIOS-GRID-2026",
      agreementNumber: "BPCI-HELIOS-GRID-2026",
      title: "Telemetry Framework Agreement — Grid Substation Smart Metering",
      category: "FRAMEWORK_MSA",
      counterparty: "Helios Energy Systems",
      effectiveDate: new Date("2026-05-01T00:00:00+05:30"),
      expiryDate: new Date("2027-04-30T23:59:59+05:30"),
      status: "active",
      governingLaw: "Central Electricity Authority (CEA) Technical Standards & Indian Law",
      signatures: [
        { party: "Bharat Petroleum Infrastructure (BPCI)", signatory: "S. Swaminathan (Chief Electrical Engineer)", date: new Date("2026-04-25"), verified: true },
        { party: "Helios Energy Systems", signatory: "Dr. P. Roy (Director Grid Tech)", date: new Date("2026-04-26"), verified: true }
      ],
      clauses: [
        { clauseId: "Clause 4.2", topic: "QUALITY_SLA", title: "Quarterly Calibration Audit", text: "Vendor shall provide quarterly NABL-accredited meter calibration certificates for all installed substation nodes." }
      ]
    },
    {
      companyId,
      id: "AGR-APEX-VALVES-2026",
      agreementNumber: "BPCI-CTR-VALVES-4001",
      title: "High-Pressure Rotary Butterfly Valves Procurement Contract",
      category: "PURCHASE_AGREEMENT",
      counterparty: "Apex Fluid Controls Pvt Ltd",
      effectiveDate: new Date("2026-06-01T00:00:00+05:30"),
      expiryDate: new Date("2027-05-31T23:59:59+05:30"),
      status: "active",
      governingLaw: "Public Procurement (Preference to Make in India) Order 2017",
      signatures: [
        { party: "Bharat Petroleum Infrastructure (BPCI)", signatory: "K. Murali (Head Procurement - Pipelines)", date: new Date("2026-05-28"), verified: true },
        { party: "Apex Fluid Controls Pvt Ltd", signatory: "N. Sharma (Chief Operating Officer)", date: new Date("2026-05-30"), verified: true }
      ],
      clauses: [
        { clauseId: "Clause 6.1", topic: "STATUTORY_GST", title: "GST E-Way Bill Reconciliation", text: "Physical delivery must match GST portal E-Way bill IRN data prior to invoice clearance." }
      ]
    },
    {
      companyId,
      id: "AGR-POWERGRID-SLA-2026",
      agreementNumber: "BPCI-SLA-SUBSTATION-01",
      title: "SCADA Substation Automation 99.8% Availability SLA Agreement",
      category: "FRAMEWORK_MSA",
      counterparty: "PowerGrid Systems Ltd",
      effectiveDate: new Date("2026-07-01T00:00:00+05:30"),
      expiryDate: new Date("2027-06-30T23:59:59+05:30"),
      status: "active",
      governingLaw: "Indian Electricity Act & CERC Regulations",
      signatures: [
        { party: "Bharat Petroleum Infrastructure (BPCI)", signatory: "S. Swaminathan (Chief Electrical Engineer)", date: new Date("2026-06-25"), verified: true },
        { party: "PowerGrid Systems Ltd", signatory: "V. K. Nair (Executive Director Services)", date: new Date("2026-06-27"), verified: true }
      ],
      clauses: [
        { clauseId: "Clause 5.3", topic: "UPTIME_PENALTY", title: "Penalty for SCADA Outages", text: "Penalties of 1% monthly contract value apply per 0.1% uptime shortfall below 99.8%." }
      ]
    },
    {
      companyId,
      id: "AGR-MOPNG-UC-2026",
      agreementNumber: "BPCI-STATUTORY-UC-2026",
      title: "Ministry of Petroleum & Natural Gas Statutory Capital Grant Mandate",
      category: "MOU",
      counterparty: "Ministry of Petroleum & Natural Gas (MoPNG)",
      effectiveDate: new Date("2026-01-01T00:00:00+05:30"),
      expiryDate: new Date("2026-12-31T23:59:59+05:30"),
      status: "active",
      governingLaw: "General Financial Rules (GFR) 2017 - Rule 238(1)",
      signatures: [
        { party: "Bharat Petroleum Infrastructure (BPCI)", signatory: "T. C. Joshi (Director Finance)", date: new Date("2025-12-28"), verified: true },
        { party: "MoPNG Internal Audit Directorate", signatory: "Joint Secretary (Refineries)", date: new Date("2025-12-30"), verified: true }
      ],
      clauses: [
        { clauseId: "Clause 2.1", topic: "STATUTORY_UC", title: "Form GFR-12A Submission", text: "Statutory Utilization Certificate in Form GFR-12A must be verified and submitted annually." }
      ]
    }
  ];

  for (const ag of agreements) {
    await ContractAgreement.updateOne(
      { companyId, id: ag.id },
      { $set: { ...ag, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
  }

  const obligations = [
    {
      companyId,
      id: "OBL-EXPIRY-MOU",
      obligationId: "OBL-EXPIRY-MOU-1001",
      agreementId: "AGR-BPCI-MOU-2026",
      caseId: "pumps-1001",
      poId: "PO-1001",
      title: "MOU Expiry & Annual Performance Renewal",
      type: "EXPIRY_RENEWAL",
      dueDate: new Date("2026-11-30T23:59:59+05:30"),
      effectiveExpiry: new Date("2027-03-31T23:59:59+05:30"),
      status: "disputed_superseded",
      authorityStatus: "authoritative",
      disputeReason: "Addendum #1 formally extended term to 31 March 2027; original 30 Nov 2026 deadline superseded.",
      sourceClauseRef: "Clause 12.1 / Addendum Clause 2.1",
      assignedRole: "ap_manager",
      evidenceIds: ["ev:PO-1001:reference", "AGR-ADDENDUM-2026-01"]
    },
    {
      companyId,
      id: "OBL-RECON-3WAY",
      obligationId: "OBL-RECON-3WAY-1001",
      agreementId: "AGR-BPCI-MOU-2026",
      caseId: "pumps-1001",
      poId: "PO-1001",
      title: "Mandatory 3-Way Reconciliation Sign-Off Prior to Payment",
      type: "THREE_WAY_MATCH",
      dueDate: new Date("2026-10-30T18:00:00+05:30"),
      status: "pending",
      authorityStatus: "authoritative",
      disputeReason: "Blocked by duplicate invoice AP-992 and partial delivery shortfall (40 pumps open).",
      sourceClauseRef: "Clause 8.4",
      assignedRole: "ap_manager",
      evidenceIds: ["ev:PO-1001:reference", "ev:INV-041:reference"]
    },
    {
      companyId,
      id: "OBL-DELIV-PUMPS",
      obligationId: "OBL-DELIV-PUMPS-01",
      agreementId: "AGR-BPCI-MOU-2026",
      caseId: "pumps-1001",
      poId: "PO-1001",
      title: "Milestone 1 Physical Delivery & Inspection Certificate (60 Slurry Pumps)",
      type: "DELIVERY_MILESTONE",
      dueDate: new Date("2026-10-10T18:00:00+05:30"),
      status: "satisfied",
      authorityStatus: "authoritative",
      disputeReason: null,
      sourceClauseRef: "Clause 3.1 & PO-1001 Schedule",
      assignedRole: "ops_analyst",
      evidenceIds: ["GRN-A", "GRN-B"]
    },
    {
      companyId,
      id: "OBL-CALIBRATION-Q3",
      obligationId: "OBL-CALIB-Q3-2001",
      agreementId: "AGR-HELIOS-GRID-2026",
      caseId: "meters-2001",
      poId: "PO-2001",
      title: "NABL Third-Party Meter Calibration Certificate Submission",
      type: "AUDIT_REPORT",
      dueDate: new Date("2026-11-15T18:00:00+05:30"),
      status: "satisfied",
      authorityStatus: "authoritative",
      sourceClauseRef: "Clause 4.2",
      assignedRole: "ops_analyst",
      evidenceIds: ["INV-2001"]
    },
    {
      companyId,
      id: "OBL-LD-ASSESSMENT",
      obligationId: "OBL-LD-ASSESS-1001",
      agreementId: "AGR-BPCI-MOU-2026",
      caseId: "pumps-1001",
      poId: "PO-1001",
      title: "Liquidated Damages (0.5% per week) Assessment for Milestone 2 Shortfall",
      type: "LIQUIDATED_DAMAGES",
      dueDate: new Date("2026-11-05T18:00:00+05:30"),
      status: "pending",
      authorityStatus: "provisional",
      disputeReason: "40 units open beyond 15 Oct deadline; vendor claims supply-chain force majeure.",
      sourceClauseRef: "Clause 14.2 (Liquidated Damages)",
      assignedRole: "ap_manager",
      evidenceIds: ["PO-1001", "GRN-B"]
    },
    {
      companyId,
      id: "OBL-STATUTORY-UC",
      obligationId: "OBL-STATUTORY-UC-2026",
      agreementId: "AGR-MOPNG-UC-2026",
      caseId: "pumps-1001",
      poId: "PO-1001",
      title: "Statutory Utilization Certificate (Form GFR-12A) Sign-Off",
      type: "UTILIZATION_CERTIFICATE",
      dueDate: new Date("2026-12-31T18:00:00+05:30"),
      status: "pending",
      authorityStatus: "authoritative",
      disputeReason: "Requires physical verification of installed capital assets before submitting to ministry.",
      sourceClauseRef: "GFR 2017 Rule 238(1)",
      assignedRole: "ap_manager",
      evidenceIds: ["DOC-BPCI-CTR-1001"]
    },
    {
      companyId,
      id: "OBL-BG-EXTENSION",
      obligationId: "OBL-BG-EXT-4001",
      agreementId: "AGR-APEX-VALVES-2026",
      caseId: "valves-4001",
      poId: "PO-4001",
      title: "Bank Guarantee (BG) Validity Extension for Advance Mobilization",
      type: "BANK_GUARANTEE",
      dueDate: new Date("2026-11-20T18:00:00+05:30"),
      status: "satisfied",
      authorityStatus: "authoritative",
      disputeReason: null,
      sourceClauseRef: "Clause 7.1",
      assignedRole: "ap_manager",
      evidenceIds: ["PO-4001"]
    },
    {
      companyId,
      id: "OBL-EWAY-RECON",
      obligationId: "OBL-EWAY-RECON-4001",
      agreementId: "AGR-APEX-VALVES-2026",
      caseId: "valves-4001",
      poId: "PO-4001",
      title: "GST E-Way Bill Physical Movement Reconciliation for Valve Consignment",
      type: "STATUTORY_COMPLIANCE",
      dueDate: new Date("2026-11-02T18:00:00+05:30"),
      status: "satisfied",
      authorityStatus: "authoritative",
      disputeReason: null,
      sourceClauseRef: "Clause 6.1",
      assignedRole: "ops_analyst",
      evidenceIds: ["INV-4001"]
    }
  ];

  for (const obl of obligations) {
    await ContractObligation.updateOne(
      { companyId, id: obl.id },
      { $set: { ...obl, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
  }

  console.log(`[ContractSeed] Successfully seeded ${agreements.length} agreements and ${obligations.length} obligations.`);
}
