import hashlib
import json
import re
from collections import defaultdict
from decimal import Decimal, getcontext, ROUND_HALF_UP

from .business_contracts import ReconcileRequest
from .business_matching import evaluation, line_suggestions

D = Decimal
ZERO = D("0")
RULE_VERSION = "satya-ledger-v2"
POLICY = {"version": "satya-demo-policy-v1", "unitPriceTolerance": "0.01", "rounding": "ROUND_HALF_UP", "taxValidation": "declared_components_only", "automaticApproval": False}


def money(value):
    return str(value.quantize(D("0.01"), rounding=ROUND_HALF_UP))


def quantity(value):
    return format(value.normalize(), "f")


def normalized(value):
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


def reconcile(request: ReconcileRequest):
    getcontext().prec = 60
    records = sorted((r for r in request.records if r.observedAt <= request.observedBefore and (request.occurredBefore is None or r.occurredAt <= request.occurredBefore)), key=lambda r: (r.occurredAt, r.id))
    lookup = {r.id: r for r in records}
    po = lookup.get(request.poId)
    if po is None or po.type != "PO" or po.status != "approved":
        raise ValueError("An approved purchase order visible at the cutoff is required")
    manifest = request.model_dump(mode="json")
    manifest["records"] = sorted(manifest["records"], key=lambda r: r["id"])
    manifest["ruleVersion"] = RULE_VERSION
    manifest["policy"] = POLICY
    model_report = evaluation()
    manifest["modelIdentity"] = {key: model_report.get(key) for key in ("ready", "modelVersion", "artifactSha256", "calibration")}
    digest = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
    snapshot_id = f"snap-{digest[:20]}"
    findings, evidence, links = [], {}, []

    def cite(record, field, value):
        identifier = f"ev:{record.id}:{field}"
        source_field = field.split("/")[0] in record.model_fields_set
        record_index = next(index for index, item in enumerate(request.records) if item.id == record.id)
        pointer_field = field
        if field.startswith("lines/"):
            _, line_id, name = field.split("/")
            line_index = next(index for index, item in enumerate(record.lines) if item.id == line_id)
            pointer_field = f"lines/{line_index}/{name}"
        evidence[identifier] = {"id": identifier, "recordId": record.id, "reference": record.reference, "source": record.source, "field": field, "rawValue": str(value) if source_field else None, "derivedValue": None if source_field else str(value), "locator": {"kind": "json_pointer" if source_field else "derivation", "pointer": f"/records/{record_index}/{pointer_field}" if source_field else None}, "observedAt": record.observedAt.isoformat(), "provenance": record.provenance, "quality": "schema_validated_not_issuer_verified" if source_field else "calculated_from_snapshot_inputs"}
        origin = record.fieldEvidence.get(field)
        if origin:
            evidence[identifier].update({"rawValue": origin.rawValue, "normalizedValue": str(value), "transform": origin.transform, "locator": {"kind": "csv_cell", "pointer": None, "documentId": origin.documentId, "row": origin.row, "column": origin.column}, "quality": "mapped_csv_field_not_issuer_verified"})
        return identifier

    def finding(kind, title, detail, refs, action="REQUEST_CLARIFICATION", severity="review", amount=None, certainty="proven_from_inputs"):
        identifier = f"finding-{len(findings) + 1}"
        findings.append({"id": identifier, "type": kind, "title": title, "detail": detail, "evidenceIds": refs, "action": action, "severity": severity, "certainty": certainty, "exposure": None if amount is None else {"amount": money(amount), "currency": po.currency, "kind": "pending_disputed_not_savings"}})
        return identifier

    def edge(source, target, kind, status="observed", **values):
        links.append({"id": f"{source}:{kind}:{target}:{len(links)}", "source": source, "target": target, "type": kind, "status": status, **values})

    for record in records:
        cite(record, "reference", record.reference)
        if record.amount is not None:
            cite(record, "amount", record.amount)
        if record.poId in lookup:
            edge(record.id, record.poId, "SOURCE_REFERENCES")
    po_lines = {line.id: line for line in po.lines}
    received, accepted = defaultdict(lambda: ZERO), defaultdict(lambda: ZERO)
    unknown_acceptance = False

    def line_quantity(record, line):
        target = po_lines.get(line.poLineId or line.id)
        if target is None or (line.sku and target.sku and normalized(line.sku) != normalized(target.sku)):
            finding("UNMATCHED_ITEM", "Item needs a reviewed match", "A line reference or equipment specification conflicts with this order.", [cite(record, f"lines/{line.id}/sku", line.sku or "unknown")])
            return None, None
        factor = D("1")
        if line.uom != target.uom:
            if line.uom == "BOX" and target.uom == "EA" and target.packSize is not None:
                factor = D(target.packSize)
            else:
                finding("UNKNOWN_UNIT_CONVERSION", "Packaging conversion is not established", "An approved item-specific pack size is required; no multiplier was guessed.", [cite(record, f"lines/{line.id}/uom", line.uom)])
                return None, None
        return target, factor

    for receipt in (r for r in records if r.type in {"GRN", "RETURN"} and r.poId == po.id and r.supplier == po.supplier and r.status != "reversed"):
        sign = D("-1") if receipt.type == "RETURN" else D("1")
        for line in receipt.lines:
            target, factor = line_quantity(receipt, line)
            if target is None:
                continue
            received[target.id] += sign * D(line.quantity) * factor
            if line.acceptedQuantity is not None:
                accepted[target.id] += sign * D(line.acceptedQuantity) * factor
            else:
                unknown_acceptance = True
            cite(receipt, f"lines/{line.id}/quantity", line.quantity)
            if line.acceptedQuantity is not None:
                cite(receipt, f"lines/{line.id}/acceptedQuantity", line.acceptedQuantity)
            edge(receipt.id, po.id, "RECEIVED_AGAINST", quantity=quantity(D(line.quantity) * factor))
    if any(value < 0 for value in received.values()) or any(value < 0 for value in accepted.values()):
        raise ValueError("Returns exceed recorded receipt/acceptance quantity")
    ordered = sum((D(line.quantity) for line in po.lines), ZERO)
    received_total = sum(received.values(), ZERO)
    accepted_total = sum(accepted.values(), ZERO)
    if po.matchingLevel == "four_way" and unknown_acceptance:
        finding("MISSING_ACCEPTANCE_EVIDENCE", "Inspection evidence is incomplete", "Only explicitly accepted units can support four-way approval.", [cite(po, "matchingLevel", po.matchingLevel)], "PLACE_ON_HOLD")
    invoices = [r for r in records if r.type == "INVOICE" and r.status != "reversed"]
    for invoice_id, target_id in request.invoiceLinks.items():
        invoice = lookup.get(invoice_id)
        if invoice is None:
            continue
        if invoice.type != 'INVOICE' or target_id != po.id or invoice.supplier != po.supplier:
            raise ValueError('Reviewed invoice link conflicts with the selected order or supplier')
        edge(invoice_id, po.id, 'CONFIRMED_MATCH', 'reviewer_confirmed')
    main = [r for r in invoices if (r.poId == po.id or request.invoiceLinks.get(r.id) == po.id) and r.supplier == po.supplier]
    duplicate_candidates = []
    groups = defaultdict(list)
    for invoice in main:
        groups[(invoice.supplier, normalized(invoice.reference), invoice.currency)].append(invoice)
    for group in groups.values():
        if len(group) > 1:
            original = group[0]
            for duplicate in group[1:]:
                if duplicate.id not in request.confirmedDuplicates:
                    duplicate_candidates.append({"recordId": duplicate.id, "candidateOriginalId": original.id, "confidenceKind": "reference_rule_not_probability"})
                    finding("SUSPECTED_DUPLICATE_CHARGE", "The same invoice reference appears twice", "Both AP postings are retained. Confirm whether this is one obligation or legitimate revised billing.", [cite(original, "reference", original.reference), cite(duplicate, "reference", duplicate.reference)], "PLACE_ON_HOLD", "high", D(duplicate.amount), "conditional")
                    edge(duplicate.id, original.id, "SUSPECTED_DUPLICATE_OF", "candidate")
    for duplicate_id, original_id in request.confirmedDuplicates.items():
        duplicate, original = lookup.get(duplicate_id), lookup.get(original_id)
        if duplicate is None or original is None:
            continue
        if duplicate.type != "INVOICE" or original.type != "INVOICE" or duplicate_id == original_id or original_id in request.confirmedDuplicates or duplicate.supplier != original.supplier or duplicate.currency != original.currency or request.invoiceLinks.get(duplicate.id, duplicate.poId) != request.invoiceLinks.get(original.id, original.poId) or duplicate.amount != original.amount:
            raise ValueError("Duplicate confirmation conflicts with source obligations")
        edge(duplicate_id, original_id, "REPRESENTATION_OF", "reviewer_confirmed")
    active_main = [r for r in main if r.id not in request.confirmedDuplicates]
    canonical_invoices = [r for r in invoices if r.id not in request.confirmedDuplicates]
    credits = defaultdict(lambda: ZERO)
    for credit in (r for r in records if r.type == "CREDIT_NOTE" and r.status != "reversed"):
        target_id = request.confirmedDuplicates.get(credit.invoiceId, credit.invoiceId)
        target = lookup.get(target_id)
        if target is None or target.type != "INVOICE" or credit.currency != target.currency or credit.supplier != target.supplier:
            finding("UNAPPLIED_CREDIT", "Credit requires an invoice reference", "The credit has not been subtracted from an arbitrary invoice.", [cite(credit, "amount", credit.amount)])
            continue
        credits[target_id] += D(credit.amount)
        edge(credit.id, target_id, "CREDITS", amount=credit.amount)
    settlements, allocations, unallocated = defaultdict(lambda: ZERO), [], []
    invoice_credits = {r.id: D(r.amount) - credits[r.id] for r in canonical_invoices}
    ambiguities = []
    payment_groups = defaultdict(list)
    for payment in (r for r in records if r.type == 'PAYMENT'):
        key = (payment.supplier, payment.currency, payment.utr.strip().upper()) if payment.utr else ('source_record', payment.id)
        payment_groups[key].append(payment)
    payment_records = []
    for group in payment_groups.values():
        original = group[0]
        latest_time = max(item.observedAt for item in group)
        latest = [item for item in group if item.observedAt == latest_time]
        conflict = any(D(item.amount) != D(original.amount) or item.invoiceId != original.invoiceId for item in group) or len({item.status for item in latest}) > 1
        if conflict:
            finding('PAYMENT_SOURCE_CONFLICT', 'Transfer observations disagree', 'The same transfer reference has conflicting amounts, invoice references or current statuses. None was counted as confirmed cash.', [cite(item, 'amount', item.amount) for item in group], 'REQUEST_CLARIFICATION', 'high')
            continue
        canonical = min(latest, key=lambda item: item.id)
        for item in group:
            if item.id != canonical.id:
                edge(item.id, canonical.id, 'TRANSFER_OBSERVATION_OF', 'source_reference_identity')
        if canonical.status == 'settled':
            payment_records.append(canonical)
    payment_records.sort(key=lambda item: (item.occurredAt, item.id))
    for payment in payment_records:
        manual = request.paymentAllocations.get(payment.id)
        target_id = manual or payment.invoiceId
        target_id = request.confirmedDuplicates.get(target_id, target_id)
        cash = D(payment.amount)
        if target_id:
            target = lookup.get(target_id)
            if target is None or target.type != "INVOICE" or target_id not in invoice_credits or target.currency != payment.currency or target.supplier != payment.supplier:
                if manual:
                    raise ValueError("Reviewer allocation requires a visible compatible invoice")
                finding("PAYMENT_REFERENCE_CONFLICT", "Payment reference cannot establish settlement", "Supplier, currency or invoice identity conflicts; this transfer remains unapplied.", [cite(payment, "invoiceId", target_id)])
            else:
                remaining = max(invoice_credits[target_id] - settlements[target_id], ZERO)
                applied = min(cash, remaining)
                if applied:
                    settlements[target_id] += applied
                    allocations.append({"paymentId": payment.id, "invoiceId": target_id, "amount": money(applied), "currency": payment.currency, "status": "reviewer_confirmed" if manual else "source_referenced"})
                    edge(payment.id, target_id, "SETTLES", "reviewer_confirmed" if manual else "source_referenced", amount=money(applied))
                    cash -= applied
        if cash:
            candidates = [r for r in canonical_invoices if r.supplier == payment.supplier and r.currency == payment.currency and invoice_credits[r.id] - settlements[r.id] > 0]
            unallocated.append({"paymentId": payment.id, "reference": payment.reference, "amount": money(cash), "currency": payment.currency, "candidateInvoiceIds": [r.id for r in candidates]})
            refs = [cite(payment, "amount", payment.amount)]
            finding("AMBIGUOUS_PAYMENT_ALLOCATION" if candidates else "UNALLOCATED_PAYMENT", "Settled money still needs allocation", "A matching amount alone does not prove which invoice this transfer settled.", refs)
            for candidate in candidates:
                edge(payment.id, candidate.id, "CANDIDATE_SETTLEMENT", "candidate", amount=money(cash))
            ambiguities.append({"id": f"ambiguity:{payment.id}", "scope": "invoice_settlement", "paymentId": payment.id, "alternatives": [r.id for r in candidates], "neededEvidence": "Supplier remittance advice naming the invoice and allocation amount", "certainty": "unresolved"})
    support_remaining = {line.id: accepted[line.id] if po.matchingLevel == "four_way" else received[line.id] for line in po.lines}
    invoice_results = []
    currency_conflict = False
    suspect_ids = {r["recordId"] for r in duplicate_candidates}
    for invoice in active_main:
        net = sum((D(line.quantity) * D(line.unitPrice) for line in invoice.lines), ZERO)
        computed = net + sum((D(amount) for amount in invoice.taxes.values()), ZERO)
        if D(money(computed)) != D(invoice.amount) or (invoice.netAmount is not None and D(invoice.netAmount) != D(money(net))):
            finding("HEADER_LINE_TOTAL_CONFLICT", "Invoice totals disagree with its lines", f"Line net plus declared tax is {money(computed)} {invoice.currency}; the source header is {invoice.amount}. No repair was guessed.", [cite(invoice, "amount", invoice.amount), cite(invoice, "computedGross", money(computed))], "PLACE_ON_HOLD", "high")
        if invoice.currency != po.currency:
            currency_conflict = True
            finding("CURRENCY_CONFLICT", "Invoice and order currencies differ", "No exchange rate or amendment was supplied. These currencies were not converted or summed.", [cite(po, "currency", po.currency), cite(invoice, "currency", invoice.currency)], "PLACE_ON_HOLD", "high")
        supported_net, billed_qty, supported_qty = ZERO, ZERO, ZERO
        for line in invoice.lines:
            target, factor = line_quantity(invoice, line)
            if target is None:
                continue
            billed = D(line.quantity) * factor
            if invoice.id in suspect_ids:
                billed_qty += billed
                continue
            supported = min(billed, max(support_remaining[target.id], ZERO))
            support_remaining[target.id] -= supported
            normalized_price = D(line.unitPrice) / factor
            price_difference = abs(normalized_price - D(target.unitPrice))
            supported_net += supported * (normalized_price if price_difference <= D(POLICY['unitPriceTolerance']) else D(target.unitPrice))
            billed_qty += billed
            supported_qty += supported
            if invoice.currency == po.currency and ZERO < price_difference <= D(POLICY['unitPriceTolerance']):
                finding('WITHIN_PRICE_TOLERANCE', 'Minor unit-price variance is within the prototype policy', f"Unit-price difference {quantity(price_difference)} is within {POLICY['unitPriceTolerance']} {po.currency}; the remaining balance was not written off.", [cite(invoice, f'lines/{line.id}/unitPrice', line.unitPrice), cite(po, f'lines/{target.id}/unitPrice', target.unitPrice)], 'NO_ACTION_REQUIRED', 'info')
            if invoice.currency == po.currency and price_difference > D(POLICY['unitPriceTolerance']):
                finding("UNIT_PRICE_VARIANCE", "Unit price differs from approved order", "Compare the approved PO price after the verified unit conversion; a reviewer must authorize a revision.", [cite(invoice, f"lines/{line.id}/unitPrice", line.unitPrice), cite(po, f"lines/{target.id}/unitPrice", target.unitPrice)], "REQUEST_CLARIFICATION", "high")
        if supported_qty < billed_qty and invoice.id not in suspect_ids:
            finding("BILLED_ABOVE_ACCEPTED" if po.matchingLevel == "four_way" else "BILLED_ABOVE_RECEIVED", "Billed quantity exceeds eligible receipt evidence", f"Only {quantity(supported_qty)} of {quantity(billed_qty)} billed units have available {'inspection acceptance' if po.matchingLevel == 'four_way' else 'buyer receipt'} support.", [cite(invoice, "billedQuantity", quantity(billed_qty)), cite(po, "eligibleQuantity", quantity(accepted_total if po.matchingLevel == "four_way" else received_total))], "PLACE_ON_HOLD", "high")
        supported_gross = ZERO
        if invoice.currency == po.currency and D(money(computed)) == D(invoice.amount) and net > ZERO:
            supported_gross = supported_net + sum((D(amount) * supported_net / net for amount in invoice.taxes.values()), ZERO)
            supported_gross = min(supported_gross, D(invoice.amount))
        outstanding = D(invoice.amount) - credits[invoice.id] - settlements[invoice.id]
        supported_outstanding = max(supported_gross - credits[invoice.id] - settlements[invoice.id], ZERO)
        invoice_results.append({"id": invoice.id, "reference": invoice.reference, "currency": invoice.currency, "gross": invoice.amount, "credit": money(credits[invoice.id]), "settled": money(settlements[invoice.id]), "outstanding": money(outstanding), "supportedGross": money(supported_gross), "supportedOutstanding": money(supported_outstanding), "billedQuantity": quantity(billed_qty), "supportedQuantity": quantity(supported_qty), "duplicateSuspected": invoice.id in suspect_ids})
    if received_total < ordered:
        refs = [cite(po, "orderedQuantity", quantity(ordered)), cite(po, "receivedQuantity", quantity(received_total))]
        if po.coverage != "complete":
            finding("SOURCE_COVERAGE_GAP", "Warehouse export coverage is not established", "Missing warehouse evidence does not establish that the supplier failed to deliver.", refs)
        elif po.dueAt is not None and po.dueAt < request.observedBefore:
            finding("OVERDUE_DELIVERY_SHORTFALL", "Delivery is incomplete after the promised date", f"The buyer has recorded {quantity(received_total)} of {quantity(ordered)} ordered units.", refs, "ESCALATE", "high")
        else:
            finding("EXPECTED_PARTIAL_FULFILLMENT", "Partial delivery is expected at this point", "The remaining units are not yet overdue. This alone is not an expensive error.", refs, "NO_ACTION_REQUIRED", "info")
    if not main:
        finding("MISSING_INVOICE_EVIDENCE", "No linked commercial invoice is established", "Visible unrelated invoices or a pro forma are not a confirmed bill for this order. Review the candidates or request a supplier PO reference.", [cite(po, "reference", po.reference)])
    same_currency_results = [r for r in invoice_results if r["currency"] == po.currency]
    recorded_gross = sum((D(r.amount) for r in main if r.currency == po.currency), ZERO)
    main_settled = sum((settlements[r.id] for r in active_main if r.currency == po.currency), ZERO)
    recorded_settled = sum((D(item["amount"]) for item in allocations if item["invoiceId"] in {r.id for r in main} and item["currency"] == po.currency), ZERO)
    supported_outstanding = sum((D(r["supportedOutstanding"]) for r in same_currency_results), ZERO)
    critical_unknown = any(f["type"] in {"HEADER_LINE_TOTAL_CONFLICT", "UNKNOWN_UNIT_CONVERSION", "UNMATCHED_ITEM", "PAYMENT_SOURCE_CONFLICT"} for f in findings)
    canonical_outstanding = None if not active_main or duplicate_candidates or currency_conflict or critical_unknown else money(sum((D(r["outstanding"]) for r in same_currency_results), ZERO))
    ledger = {"currency": po.currency, "ordered": quantity(ordered), "received": quantity(received_total), "accepted": quantity(accepted_total), "openDelivery": quantity(max(ordered - received_total, ZERO)), "recordedGross": money(recorded_gross), "recordedOutstanding": money(recorded_gross - recorded_settled), "settled": money(main_settled), "supportedOutstanding": money(supported_outstanding), "canonicalOutstanding": canonical_outstanding, "disputedExposure": money(sum((D(lookup[r["recordId"]].amount) for r in duplicate_candidates if lookup[r["recordId"]].currency == po.currency), ZERO)), "eligibleNet": money(sum((D(line.unitPrice) * min(D(line.quantity), received[line.id] if po.matchingLevel == "three_way" else accepted[line.id]) for line in po.lines), ZERO))}
    if currency_conflict:
        ledger["recordedGross"] = None
        ledger["recordedOutstanding"] = None
        ledger["supportedOutstanding"] = None
        ledger["recordedByCurrency"] = {currency: money(sum((D(invoice.amount) for invoice in main if invoice.currency == currency), ZERO)) for currency in sorted({invoice.currency for invoice in main})}
    for ambiguity in ambiguities:
        payment = next(p for p in unallocated if p["paymentId"] == ambiguity["paymentId"])
        if any(identifier in {r.id for r in active_main} for identifier in ambiguity["alternatives"]) and payment["currency"] == po.currency:
            ambiguity["balanceScenarios"] = {"minimum": money(max(supported_outstanding - D(payment["amount"]), ZERO)), "maximum": money(supported_outstanding), "currency": po.currency, "kind": "single_transfer_scenario_not_global_certified_bounds", "assumption": "Receipt-supported original obligation; suspected duplicate remains separately disputed."}
    nodes = [{"id": r.id, "label": r.reference, "type": r.type, "amount": r.amount, "currency": r.currency, "provenance": r.provenance} for r in records]
    return {"snapshotId": snapshot_id, "inputHash": digest, "caseId": request.caseId, "companyId": request.companyId, "poId": po.id, "ruleVersion": RULE_VERSION, "policy": POLICY, "observedBefore": request.observedBefore.isoformat(), "occurredBefore": request.occurredBefore.isoformat() if request.occurredBefore else None, "ledger": ledger, "invoices": invoice_results, "findings": findings, "evidence": list(evidence.values()), "paymentAllocations": allocations, "unallocatedPayments": unallocated, "duplicateCandidates": duplicate_candidates, "ambiguities": ambiguities, "graph": {"nodes": nodes, "edges": links}, "provenance": sorted({r.provenance for r in records}), "warnings": ["GST components are source declarations; no GST rate/IRN verification performed.", "Supported gross uses declared-tax pro-rata allocation; header freight/discounts are not supported by this schema."], "matchSuggestions": line_suggestions(records, po), "matchingTruncated": sum(len(invoice.lines) for invoice in invoices if invoice.supplier == po.supplier) * len(po.lines) > 500, "model": evaluation(), "capabilities": {"exactArithmetic": True, "learnedAutomaticApproval": False, "graphProjection": "pending"}}
