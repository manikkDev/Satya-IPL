export const summarizeCase = (businessCase) => {
  const snapshot = businessCase.snapshot;
  if (!snapshot) return { content: "This case has not completed reconciliation yet. Please run reconciliation in the workspace.", sources: [] };
  const { ledger } = snapshot;
  const content = [
    `${businessCase.title} — ${businessCase.supplier}`,
    `As known at ${snapshot.observedBefore}; snapshot ${snapshot.snapshotId}.`,
    `Ordered ${ledger.ordered} units; buyer receipts ${ledger.received}; accepted ${ledger.accepted}; remaining delivery ${ledger.openDelivery}.`,
    ledger.recordedOutstanding === null ? `Source AP spans conflicting currencies: ${Object.entries(ledger.recordedByCurrency || {}).map(([currency, amount]) => `${currency} ${amount}`).join('; ')}. No converted total was invented.` : `Posting-based open balance: ${ledger.currency} ${ledger.recordedOutstanding} (imported invoice postings less referenced settlements, not an independently imported general ledger).`,
    ledger.supportedOutstanding === null ? 'Receipt-supported outstanding cannot be established across conflicting currencies.' : `Receipt-supported outstanding: ${ledger.currency} ${ledger.supportedOutstanding}. Confirmed/source-referenced settled allocation: ${ledger.currency} ${ledger.settled}.`,
    ledger.canonicalOutstanding === null ? "The canonical outstanding balance is not confirmed: duplicate treatment or critical source evidence is unresolved." : `Reconstructed outstanding: ${ledger.currency} ${ledger.canonicalOutstanding}.`,
    ...snapshot.findings.map((finding) => `${finding.title}: ${finding.detail} Next step: ${finding.action.replaceAll("_", " ").toLowerCase()}.`),
    ...snapshot.unallocatedPayments.map((payment) => `${payment.reference}: ${payment.currency} ${payment.amount} remains unapplied. Candidate invoices: ${payment.candidateInvoiceIds.join(", ") || "none established"}. Ask for a remittance reference; do not subtract this from several invoices.`),
    "These are stored source observations and deterministic calculations, not a supplier fraud verdict. No money was sent and no supplier message was delivered.",
  ].join("\n\n");
  return { content, sources: snapshot.evidence.slice(0, 30).map((evidence) => ({ id: evidence.id, recordId: evidence.recordId, label: `${evidence.reference} · ${evidence.field}`, caseId: businessCase.id, snapshotId: snapshot.snapshotId })), caseId: businessCase.id, snapshotId: snapshot.snapshotId, facts: ledger, findings: snapshot.findings, ambiguities: snapshot.ambiguities, grounded: true, mode: "deterministic_evidence_rag" };
};

export const retrieveCases = (query, cases) => {
  const words = (query.toLowerCase().match(/[a-z0-9]+/g) || []).filter((word) => word.length > 2);
  return cases.map((item) => {
    const text = `${item.id} ${item.poId} ${item.title} ${item.supplier} ${item.sector}`.toLowerCase();
    return { item, score: words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0) };
  }).sort((a, b) => b.score - a.score).filter((result) => result.score > 0).slice(0, 5);
};
