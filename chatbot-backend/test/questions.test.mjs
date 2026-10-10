import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion, resolveRecords, renderGroundedNarration } from '../src/helpers/businessQuestions.js';

const fixture = {
  id: 'pumps-1001', poId: 'PO-1001', supplier: 'Example supplier', title: 'Pump delivery',
  records: [
    { id: 'PO-1001', type: 'PO', reference: 'PO/2026/1001', supplier: 'Example supplier', currency: 'INR', lines: [{ id: '1', description: 'Pump', quantity: '100', uom: 'EA', unitPrice: '1000' }] },
    { id: 'GRN-A', type: 'GRN', reference: 'GRN/40', poId: 'PO-1001', status: 'posted', lines: [{ id: '1', quantity: '40', acceptedQuantity: '40', uom: 'EA', poLineId: '1' }] },
    { id: 'GRN-B', type: 'GRN', reference: 'GRN/20', poId: 'PO-1001', status: 'posted', lines: [{ id: '1', quantity: '20', acceptedQuantity: '20', uom: 'EA', poLineId: '1' }] },
    { id: 'INV-041', type: 'INVOICE', reference: 'INV-M-041', poId: 'PO-1001', amount: '70800.00', currency: 'INR', lines: [{ id: '1', quantity: '60', uom: 'EA' }] },
  ],
  snapshot: { snapshotId: 'snapshot-current', observedBefore: '2026-10-10T12:00:00+05:30', ledger: { currency: 'INR', ordered: '100', received: '60', accepted: '60', openDelivery: '40', supportedOutstanding: '20000.00', settled: '50800.00', canonicalOutstanding: null, disputedExposure: '70800.00', recordedOutstanding: '90800.00' }, findings: [{ id: 'dup', type: 'SUSPECTED_DUPLICATE_CHARGE', title: 'Duplicate invoice', detail: 'Needs confirmation', severity: 'high', action: 'PLACE_ON_HOLD', evidenceIds: ['ev-inv'] }], evidence: [{ id: 'ev-grn', recordId: 'GRN-A', reference: 'GRN/40', field: 'reference' }, { id: 'ev-po', recordId: 'PO-1001', reference: 'PO/2026/1001', field: 'reference' }, { id: 'ev-inv', recordId: 'INV-041', reference: 'INV-M-041', field: 'amount' }], paymentAllocations: [{ paymentId: 'T01', invoiceId: 'INV-041', amount: '30000.00', currency: 'INR' }, { paymentId: 'T02', invoiceId: 'INV-041', amount: '20800.00', currency: 'INR' }], unallocatedPayments: [{ paymentId: 'T03', reference: 'T03', amount: '15000.00', currency: 'INR', candidateInvoiceIds: ['INV-041'] }], duplicateCandidates: [{ recordId: 'AP-992', candidateOriginalId: 'INV-041' }], ambiguities: [] },
};

test('GRN40 resolves its actual receipt reference and answers the link question', () => {
  const result = answerQuestion(fixture, 'Where should the GRN40 be linked?');
  assert.equal(result.answerType, 'record_link');
  assert.match(result.content, /GRN\/40/);
  assert.match(result.content, /PO-1001/);
  assert.match(result.content, /40/);
  assert.equal(result.focusRecordIds[0], 'GRN-A');
  assert.ok(result.sources.some((source) => source.id === 'ev-grn'));
  assert.ok(!result.content.includes('Posting-based open balance'));
});
test('different PO questions no longer return identical summaries', () => {
  const link = answerQuestion(fixture, 'Where should GRN40 be linked?');
  const delivery = answerQuestion(fixture, 'What is still left to deliver?');
  const payment = answerQuestion(fixture, 'How much has been paid?');
  assert.notEqual(link.content, delivery.content);
  assert.notEqual(delivery.content, payment.content);
  assert.equal(delivery.answerType, 'delivery');
  assert.equal(payment.answerType, 'payments');
  assert.match(payment.content, /50800\.00/);
});
test('new snapshot values are read on the next question', () => {
  const updated = structuredClone(fixture);
  updated.snapshot.snapshotId = 'snapshot-new';
  updated.snapshot.ledger.received = '100'; updated.snapshot.ledger.openDelivery = '0';
  const answer = answerQuestion(updated, 'What is still left to deliver?');
  assert.equal(answer.snapshotId, 'snapshot-new');
  assert.match(answer.content, /0 units/);
});
test('unknown receipt IDs trigger clarification instead of fabricated links', () => {
  const answer = answerQuestion(fixture, 'Where should GRN999 be linked?');
  assert.equal(answer.answerType, 'clarification');
  assert.match(answer.content, /could not find/i);
});
test('follow-up pronouns use the previous cited record', () => {
  const answer = answerQuestion(fixture, 'And which order does it belong to?', [{ role: 'assistant', content: 'Earlier receipt question', sources: [{ recordId: 'GRN-B', caseId: 'pumps-1001' }] }]);
  assert.match(answer.content, /GRN\/20/);
});
test('ambiguous receipt references are not silently resolved', () => {
  const records = [...fixture.records, { ...fixture.records[1], id: 'GRN-C' }];
  assert.equal(resolveRecords('GRN40', records).length, 2);
});
test('LLM placeholders only render existing facts and record identities', () => {
  const context = { facts: { remaining: '40 units' }, records: { 'GRN-A': 'GRN/40' }, evidenceIds: ['ev-grn'] };
  assert.equal(renderGroundedNarration({ answer: '[[record:GRN-A]] records [[fact:remaining]].', evidenceIds: ['ev-grn'] }, context), 'GRN/40 records 40 units.');
  assert.equal(renderGroundedNarration({ answer: 'GRN40 is a receipt.', evidenceIds: ['ev-grn'] }, context), 'GRN/40 is a receipt.');
  assert.equal(renderGroundedNarration({ answer: 'Pay INR 999999 immediately.', evidenceIds: ['ev-grn'] }, context), null);
  assert.equal(renderGroundedNarration({ answer: '[[fact:missing]]', evidenceIds: ['invented'] }, context), null);
});
