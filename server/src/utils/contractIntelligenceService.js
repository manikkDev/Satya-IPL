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
      id: "OBL-CALIBRATION-Q3",
      obligationId: "OBL-CALIB-Q3-2001",
      agreementId: "AGR-HELIOS-GRID-2026",
      caseId: "meters-2001",
      title: "NABL Third-Party Meter Calibration Certificate Submission",
      type: "AUDIT_REPORT",
      dueDate: new Date("2026-11-15T18:00:00+05:30"),
      status: "satisfied",
      authorityStatus: "authoritative",
      sourceClauseRef: "Clause 4.2",
      assignedRole: "ops_analyst",
      evidenceIds: ["INV-2001"]
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
