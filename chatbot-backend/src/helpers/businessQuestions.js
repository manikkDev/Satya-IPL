import { summarizeCase } from './businessAnswer.js';

export const compact = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function sumQuantity(lines = []) {
  const scaled = lines.reduce((sum, line) => {
    const text = String(line.quantity || '0');
    if (!/^\d+(?:\.\d{1,6})?$/.test(text)) return sum;
    const [whole, fraction = ''] = text.split('.');
    return sum + BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  }, 0n);
  const fraction = String(scaled % 1000000n).padStart(6, '0').replace(/0+$/, '');
  return `${scaled / 1000000n}${fraction ? `.${fraction}` : ''}`;
}
export function resolveRecords(question, records = []) {
  const query = compact(question);
  const explicit = records.filter((record) => [record.id, record.reference, record.utr].some((value) => value && compact(value).length >= 4 && query.includes(compact(value))));
  if (explicit.length) return explicit;
  const receipt = question.match(/\bgrn\s*(?:of|for|with)?\s*[-/]?\s*(\d+)\b/i);
  if (receipt) return records.filter((record) => record.type === 'GRN' && sumQuantity(record.lines) === receipt[1]);
  return [];
}
const reference = (record) => `${record.reference || record.id} (record ${record.id})`;
const escape = (value) => String(value).replace(/[\\`*_[\]<>]/g, '\\$&');
export function renderGroundedNarration(response, context) {
  if (!response || typeof response.answer !== 'string' || response.answer.length > 6000 || !Array.isArray(response.evidenceIds) || response.evidenceIds.some((id) => !context.evidenceIds.includes(id))) return null;
  const aliases = new Map();
  for (const [id, label] of Object.entries(context.records)) {
    for (const alias of new Set([id, label, compact(label)])) {
      if (!/[a-z]/i.test(alias) || alias.length < 4) continue;
      const key = alias.toLowerCase();
      aliases.set(key, aliases.has(key) && aliases.get(key) !== id ? null : id);
    }
  }
  const patternEscape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalized = response.answer.split(/(\[\[(?:fact|record):[^\]]+\]\])/g).map((part) => {
    if (part.startsWith('[[')) return part;
    const names = [...aliases].filter(([, id]) => id).sort((a, b) => b[0].length - a[0].length).map(([alias]) => patternEscape(alias));
    if (!names.length) return part;
    return part.replace(new RegExp(`\\b(?:${names.join('|')})\\b`, 'gi'), (match) => `[[record:${aliases.get(match.toLowerCase())}]]`);
  }).join('');
  let invalid = false;
  const withoutTokens = normalized.replace(/\[\[(fact|record):([^\]]+)\]\]/g, (_token, kind, key) => {
    if (!Object.hasOwn(kind === 'fact' ? context.facts : context.records, key)) invalid = true;
    return '';
  });
  if (invalid || /\d|https?:\/\/|\[\[|\]\]/i.test(withoutTokens) || /\b(?:i|we)\s+(?:have\s+)?(?:sent|paid|approved|updated|deleted|linked|held|transferred)\b/i.test(withoutTokens)) return null;
  return normalized.replace(/\[\[(fact|record):([^\]]+)\]\]/g, (_token, kind, key) => escape((kind === 'fact' ? context.facts : context.records)[key]));
}

export function answerQuestion(businessCase, question, history = []) {
  if (!businessCase.snapshot) return { ...summarizeCase(businessCase), answerType: 'clarification', focusRecordIds: [] };
  const snapshot = businessCase.snapshot;
  const ledger = snapshot.ledger;
  const records = businessCase.records || [];
  let matches = resolveRecords(question, records);
  if ((!matches.length || matches.every((record) => record.type === 'PO')) && /\b(it|its|this|that|them|their)\b/i.test(question)) {
    const last = [...history].reverse().find((message) => ['assistant', 'model'].includes(message.role));
    const cited = last?.sources?.find((source) => source.caseId === businessCase.id && records.some((record) => record.id === source.recordId && record.type !== 'PO'));
    if (cited) matches = records.filter((record) => record.id === cited.recordId);
  }
  const target = matches.find((record) => record.type !== 'PO') || matches[0];
  const linkQuestion = /link|belong|mapped|match|connect|against|which (?:po|order|invoice)/i.test(question);
  let answerType = 'general', content = '', focus = [], selectedFindings = [], selectedAmbiguities = [];
  const explicitUnknown = /\b(?:GRN|INV|BANK|PAYMENT)\s*[-/]?\s*\d+\b/i.test(question) && !matches.length;
  if (explicitUnknown) {
    answerType = 'clarification';
    content = `I could not find that record in ${businessCase.poId}. Please give its exact source reference or select the correct investigation. I will not invent a link.`;
  } else if (matches.filter((record) => record.type !== 'PO').length > 1 && linkQuestion) {
    answerType = 'clarification';
    content = `More than one source observation matches: ${matches.map(reference).join('; ')}. Which record do you mean? These observations have not been merged.`;
    focus = matches.map((record) => record.id);
  } else if (target && target.type !== 'PO' && (linkQuestion || /\b(grn|receipt|invoice|bank|transfer)\b/i.test(question))) {
    answerType = linkQuestion ? 'record_link' : 'record_detail';
    focus = [target.id];
    if (target.type === 'GRN') {
      const targetOrder = target.poId || snapshot.graph?.edges?.find((edge) => edge.source === target.id && edge.type === 'CONFIRMED_MATCH')?.target;
      const lines = (target.lines || []).map((line) => line.poLineId || line.id).join(', ');
      content = targetOrder ? `**${reference(target)} belongs against ${targetOrder}${lines ? `, order line ${lines}` : ''}.**\n\nThe receipt records **${sumQuantity(target.lines)} ${(target.lines || [])[0]?.uom || 'units'}**. Its source order reference establishes that receiving link; chat has not changed any record.` : `**${reference(target)} has no established purchase-order link.** Request the buyer's PO/line reference before applying its quantity to an order.`;
      if (targetOrder === businessCase.poId) {
        const active = snapshot.invoices?.map((invoice) => invoice.id);
        const invoices = records.filter((record) => record.type === 'INVOICE' && record.poId === targetOrder && !(snapshot.duplicateCandidates || []).some((candidate) => candidate.recordId === record.id) && (!active || active.includes(record.id)));
        focus.push(businessCase.poId, ...invoices.map((record) => record.id));
        if (invoices.length) content += `\n\n${invoices.map(reference).join('; ')} bills against the same order. This GRN contributes to the order's receiving pool; the current snapshot records **${ledger.received} units received in total**. That does not prove a separate invoice-to-GRN allocation.`;
        if (snapshot.duplicateCandidates?.length) content += '\n\nDo not reuse this receiving quantity for a suspected duplicate posting. Review the duplicate independently and keep the original receipt as evidence.';
      }
    } else if (target.type === 'PAYMENT') {
      const applied = (snapshot.paymentAllocations || []).filter((allocation) => allocation.paymentId === target.id);
      const unapplied = (snapshot.unallocatedPayments || []).find((payment) => payment.paymentId === target.id);
      focus.push(...applied.map((allocation) => allocation.invoiceId));
      content = `**${reference(target)}**\n\n${applied.length ? applied.map((allocation) => `${allocation.currency} ${allocation.amount} is linked to ${allocation.invoiceId} (${allocation.status || 'recorded allocation'}).`).join('\n') : 'No settled invoice allocation is established for this transfer.'}`;
      if (unapplied) content += `\n\n${unapplied.currency} ${unapplied.amount} remains unapplied. Candidates: ${unapplied.candidateInvoiceIds.join(', ') || 'none established'}. Obtain remittance evidence; a matching amount alone is not a confirmed link.`;
    } else if (target.type === 'INVOICE') {
      const reviewed = snapshot.graph?.edges?.find((edge) => edge.source === target.id && edge.type === 'CONFIRMED_MATCH');
      const row = snapshot.invoices?.find((invoice) => invoice.id === target.id);
      focus.push(reviewed?.target || target.poId);
      content = `**${reference(target)}** ${reviewed ? `has a reviewed link to ${reviewed.target}` : target.poId ? `references ${target.poId} in its source` : 'has no established purchase-order reference'}.`;
      if (target.amount) content += `\n\nSource invoice amount: ${target.currency} ${target.amount}.`;
      if (row) content += ` Applied settlements: ${row.currency} ${row.settled}; invoice outstanding: ${row.currency} ${row.outstanding}.`;
      if (snapshot.duplicateCandidates?.some((candidate) => candidate.recordId === target.id || candidate.candidateOriginalId === target.id)) content += '\n\nA duplicate representation/posting is still disputed. Do not treat both observations as confirmed separate obligations.';
    } else content = `**${reference(target)}** is a ${target.type.toLowerCase().replaceAll('_', ' ')} observation. Its source references must be reviewed before it changes an obligation.`;
  } else if (/deliver|receiv|accept|fulfil|arriv|remaining units|quantity|how many/i.test(question)) {
    answerType = 'delivery';
    focus = records.filter((record) => ['PO', 'GRN', 'RETURN'].includes(record.type)).map((record) => record.id);
    content = `**${ledger.openDelivery} units are still to arrive for ${businessCase.poId}.**\n\nThe snapshot records ${ledger.ordered} ordered, ${ledger.received} received and ${ledger.accepted} explicitly accepted units.\n\n${records.filter((record) => record.type === 'GRN' && record.poId === businessCase.poId).map((record) => `- ${reference(record)}: ${sumQuantity(record.lines)} received units.`).join('\n')}\n\nA delivery completes receiving evidence; it does not create an invoice or authorize payment.`;
  } else if (/payment|paid|transfer|settle|remittance|utr/i.test(question)) {
    answerType = 'payments';
    focus = records.filter((record) => ['PAYMENT', 'INVOICE'].includes(record.type)).map((record) => record.id);
    content = `**${ledger.currency} ${ledger.settled} in settled allocations is linked to this order's invoices.**\n\n${(snapshot.paymentAllocations || []).map((allocation) => `- ${allocation.paymentId} → ${allocation.invoiceId}: ${allocation.currency} ${allocation.amount}.`).join('\n') || 'No settled allocations are recorded.'}\n\n${(snapshot.unallocatedPayments || []).map((payment) => `${payment.reference}: ${payment.currency} ${payment.amount} remains unapplied; obtain its remittance reference before choosing ${payment.candidateInvoiceIds.join(' or ') || 'an invoice'}.`).join('\n')}\n\nNo money was sent by Satya.`;
    selectedAmbiguities = snapshot.ambiguities || [];
  } else if (/balance|owe|outstanding|due amount|how much|amount due/i.test(question)) {
    answerType = 'balance';
    focus = records.filter((record) => ['INVOICE', 'PAYMENT', 'CREDIT_NOTE'].includes(record.type)).map((record) => record.id);
    content = ledger.supportedOutstanding === null ? '**A reliable comparable balance is not established.** Review the currency/source conflicts; no exchange rate was guessed.' : `**The delivery-supported outstanding is ${ledger.currency} ${ledger.supportedOutstanding}.**\n\nReferenced settled allocations total ${ledger.currency} ${ledger.settled}. ${ledger.canonicalOutstanding === null ? 'The final reconstructed balance is not confirmed while duplicate treatment or critical evidence remains unresolved.' : `The reconstructed outstanding is ${ledger.currency} ${ledger.canonicalOutstanding}.`}\n\n${ledger.disputedExposure !== '0.00' ? `${ledger.currency} ${ledger.disputedExposure} remains disputed duplicate exposure, not savings or an approved additional payment.` : 'No pending duplicate exposure is recorded.'}\n\nThis is not permission to pay.`;
  } else if (/hold|approv|escalat|next step|should.*pay|can.*pay/i.test(question)) {
    answerType = 'decision'; selectedFindings = (snapshot.findings || []).filter((finding) => finding.severity !== 'info');
    content = selectedFindings.length ? `**Do not approve the whole investigation while these blocking issues remain.**\n\n${selectedFindings.map((finding) => `- ${finding.title}: ${finding.detail} Next step: ${finding.action.replaceAll('_', ' ').toLowerCase()}.`).join('\n')}\n\nA finance manager must confirm evidence and record a reason. Chat does not approve, hold, send money or contact a supplier.` : '**No blocking findings are recorded in this snapshot.** A finance manager still needs to review the commercial invoice, payment terms and source evidence before approving an internal workflow. Chat cannot execute approval or payment.';
  } else if (/issue|duplicate|wrong|mismatch|flag|missing|evidence|clarif|why/i.test(question)) {
    answerType = 'issues'; selectedFindings = snapshot.findings || []; selectedAmbiguities = snapshot.ambiguities || [];
    if (/missing|needed|clarif/i.test(question)) selectedFindings = selectedFindings.filter((finding) => /MISSING|COVERAGE|AMBIGUOUS|UNALLOCATED|CONFLICT/.test(finding.type));
    content = `**${selectedFindings.length ? 'These are the relevant issues in the latest record check.' : 'No matching blocking issue is recorded; inspect the linked source evidence.'}**\n\n${selectedFindings.map((finding) => `- **${finding.title}:** ${finding.detail} Next step: ${finding.action.replaceAll('_', ' ').toLowerCase()}.`).join('\n')}\n\n${selectedAmbiguities.map((item) => item.neededEvidence).join('\n')}\n\nA discrepancy is not a supplier fraud verdict.`;
  } else if (/summari|overview|explain (?:this|the|my) (?:po|order|case)/i.test(question)) {
    return { ...summarizeCase(businessCase), answerType: 'overview', focusRecordIds: records.map((record) => record.id), queriedAt: new Date().toISOString() };
  } else {
    content = `I have the current records for ${businessCase.poId}. Ask about a receipt/invoice reference, delivery quantity, payment allocation, outstanding balance or a specific finding. I will use the current evidence, not guess a missing fact.`;
  }
  const focused = [...new Set(focus.filter(Boolean))];
  const evidence = snapshot.evidence || [];
  const relevantIds = new Set(selectedFindings.flatMap((finding) => finding.evidenceIds || []));
  const filtered = evidence.filter((item) => !focused.length || focused.includes(item.recordId) || relevantIds.has(item.id));
  filtered.sort((a, b) => (a.recordId === focused[0] ? -1 : 0) - (b.recordId === focused[0] ? -1 : 0));
  return { content, answerType, focusRecordIds: focused, sources: filtered.slice(0, 30).map((item) => ({ id: item.id, recordId: item.recordId, label: `${item.reference} · ${item.field}`, caseId: businessCase.id, snapshotId: snapshot.snapshotId })), caseId: businessCase.id, snapshotId: snapshot.snapshotId, facts: ledger, findings: selectedFindings, ambiguities: selectedAmbiguities, mode: 'live_evidence_tools', grounded: true, queriedAt: new Date().toISOString() };
}

export function groundingContext(businessCase, answer) {
  const ledger = businessCase.snapshot.ledger;
  const facts = Object.fromEntries(Object.entries(ledger).filter(([, value]) => typeof value === 'string').map(([key, value]) => [`ledger.${key}`, value]));
  const records = {};
  for (const record of (businessCase.records || []).slice(0, 60)) {
    records[record.id] = record.reference || record.id;
    if (record.amount) facts[`record.${record.id}.amount`] = `${record.currency} ${record.amount}`;
    if (record.poId) facts[`record.${record.id}.order`] = record.poId;
    if (record.lines?.length) {
      facts[`record.${record.id}.quantity`] = `${sumQuantity(record.lines)} ${record.lines[0].uom}`;
      facts[`record.${record.id}.lineIds`] = record.lines.map((line) => line.poLineId || line.id).join(', ');
    }
  }
  return { facts, records, evidenceIds: answer.sources.map((source) => source.id), currentAnswer: answer.content, answerType: answer.answerType, snapshotId: answer.snapshotId, recordDetails: (businessCase.records || []).slice(0, 60).map((record) => ({ id: record.id, type: record.type, reference: record.reference, poId: record.poId, invoiceId: record.invoiceId, status: record.status })), findings: answer.findings, ambiguities: answer.ambiguities };
}
