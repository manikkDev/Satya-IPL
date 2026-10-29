"""Deterministic GST computation for a document.

Every output amount is a Decimal string rounded HALF_UP to 2 dp. Rates come
only from an explicit override or the reviewed HSN master; a missing or
conditional rate aborts with TaxInputError rather than guessing a slab.
"""
from decimal import Decimal, localcontext

from ..money import amount_in_words_inr, money, round_rupee
from ..contracts_v2 import TaxComputeRequest
from .fy import fy_of
from .gstin import validate_gstin
from .hsn_master import HsnMaster
from .states import state_for

ZERO = Decimal("0")
PCT = Decimal("100")
EWAYBILL_LIMIT = Decimal("50000")


class TaxInputError(ValueError):
    def __init__(self, message, fields=None):
        super().__init__(message)
        self.fields = fields or []


def _dec(value, name, *, allow_zero=True):
    amount = Decimal(str(value))
    if not amount.is_finite() or amount < 0 or (amount == 0 and not allow_zero):
        raise TaxInputError(f"{name} must be a non-negative decimal", [name])
    return amount


def _taxable(line):
    gross = _dec(line.qty, "qty", allow_zero=False) * _dec(line.rate, "rate")
    discount = Decimal("0")
    if line.discountPct is not None:
        pct = _dec(line.discountPct, "discountPct")
        if pct > 100:
            raise TaxInputError("discountPct cannot exceed 100", ["discountPct"])
        discount = gross * pct / PCT
    return money(gross - discount)


def _line_rate(line, master, doc_date):
    """Return (rate, cess_rate, rate_source, warnings)."""
    if line.gstRateOverride is not None:
        found = master.lookup(line.hsn, doc_date) if line.hsn else None
        cess = _dec(line.cessRateOverride, "cessRateOverride") if line.cessRateOverride else (
            Decimal(str(found["cessRate"])) if found and found.get("cessRate") else ZERO
        )
        return _dec(line.gstRateOverride, "gstRateOverride"), cess, "override", []
    found = master.lookup(line.hsn, doc_date)
    if found is None or found.get("rate") is None:
        if master.codes and line.hsn not in master.codes:
            raise TaxInputError(f"HSN {line.hsn} not in the verified master; cannot compute a safe rate", [f"lines.{line.lineNo}.hsn"])
        raise TaxInputError(
            f"No verified rate for HSN {line.hsn} effective {doc_date}"
            + (" (rule depends on product details)" if found else ""),
            [f"lines.{line.lineNo}.hsn"],
        )
    cess = Decimal(str(found["cessRate"])) if found.get("cessRate") else (
        _dec(line.cessRateOverride, "cessRateOverride") if line.cessRateOverride else ZERO
    )
    source = {"hsn": line.hsn, "effectiveFrom": found["effectiveFrom"], "notificationRef": found["notificationRef"]}
    return Decimal(str(found["rate"])), cess, source, []


def _split(taxable, rate_pct, cess_rate, inter_state, utgst):
    half = money(taxable * rate_pct / PCT / 2)
    return {
        "cgst": format(half, ".2f") if not inter_state else "0.00",
        "sgst": format(half, ".2f") if not inter_state and not utgst else "0.00",
        "utgst": format(half, ".2f") if not inter_state and utgst else "0.00",
        "igst": format(money(taxable * rate_pct / PCT), ".2f") if inter_state else "0.00",
        "cess": format(money(taxable * cess_rate / PCT), ".2f"),
    }


def _gstin_warnings(request, warnings):
    for role in ("seller", "buyer"):
        party = getattr(request, role)
        if not party.gstin:
            continue
        check = validate_gstin(party.gstin)
        if not (check["wellFormed"] and check["checksumValid"]):
            warnings.append({"code": "GSTIN_INVALID", "message": f"The {role} GSTIN is not well-formed or fails its checksum"})
        if party.stateCode and check["stateCode"] and check["stateCode"] != party.stateCode:
            warnings.append({"code": "GSTIN_STATE_MISMATCH", "message": f"The {role} GSTIN state code {check['stateCode']} differs from the declared state {party.stateCode}"})


def compute_tax(request: TaxComputeRequest, master: HsnMaster):
    if request.currency != "INR":
        raise TaxInputError("Only INR computation is supported by the GST engine", ["currency"])
    warnings = []
    _gstin_warnings(request, warnings)

    # Place of supply (CC-1 semantics): explicit > buyer state > seller state.
    if request.placeOfSupply:
        place = request.placeOfSupply
    elif request.buyer.stateCode:
        place = request.buyer.stateCode
    else:
        place = request.seller.stateCode
        warnings.append({"code": "PLACE_OF_SUPPLY_ASSUMED", "message": "Place of supply was assumed from the seller's state because neither it nor the buyer's state was supplied"})

    sez_or_export = request.supplyType in {"EXPWP", "EXPWOP", "SEZWP", "SEZWOP"}
    inter_state = sez_or_export or place != request.seller.stateCode
    utgst = bool(not inter_state and (state_for(place) or {}).get("utWithoutLegislature"))

    # LUT validity is tied to the document's own financial year.
    doc_fy = fy_of(request.docDate)
    lut_valid = bool(request.lut and request.lut.arn and request.lut.fy == doc_fy)
    wants_zero_rate = request.supplyType in {"EXPWOP", "SEZWOP"}
    if wants_zero_rate and not lut_valid:
        warnings.append({"code": "LUT_MISSING_OR_INVALID", "message": f"Supply type {request.supplyType} was invoiced without a LUT valid for FY {doc_fy}; tax was computed as payable rather than assumed zero-rated"})
    zero_rated = wants_zero_rate and lut_valid

    required_digits = {"<5cr": 4, "5-10cr": 6, ">=10cr": 6}
    policy = request.policy
    hsn_digits = required_digits.get(policy.aatoBand) if policy else None

    out_lines, summaries = [], {}
    consignment = Decimal("0")
    for line in request.lines:
        taxable = _taxable(line)
        rate_pct, cess_rate, rate_source, _ = _line_rate(line, master, request.docDate)
        if zero_rated:
            rate_pct, cess_rate = ZERO, ZERO
        taxes = _split(taxable, rate_pct, cess_rate, inter_state, utgst)
        line_total = taxable + sum(Decimal(taxes[key]) for key in taxes)
        for tax_key in ("cgst", "sgst", "utgst", "igst", "cess"):
            consignment += Decimal(taxes[tax_key])
        consignment += taxable
        if hsn_digits and (not line.hsn or not line.hsn.isdigit() or len(line.hsn) < hsn_digits):
            warnings.append({"code": "HSN_DIGITS_INSUFFICIENT", "message": f"Line {line.lineNo} requires a {hsn_digits}-digit HSN for the declared turnover band"})
        summary = summaries.setdefault((line.hsn or "", str(rate_pct)), {"taxable": Decimal("0"), "cgst": ZERO, "sgst": ZERO, "utgst": ZERO, "igst": ZERO, "cess": ZERO})
        summary["taxable"] += taxable
        for tax_key in taxes:
            summary[tax_key] += Decimal(taxes[tax_key])
        out_lines.append({
            "lineNo": line.lineNo,
            "taxableValue": format(taxable, ".2f"),
            "gstRate": str(rate_pct),
            "rateSource": rate_source,
            **taxes,
            "lineTotal": format(money(line_total), ".2f"),
        })

    out_charges = []
    for charge in request.charges or []:
        amount = money(charge.amount)
        if charge.gstRate is None:
            warnings.append({"code": "CHARGE_RATE_MISSING", "message": f"No tax rate was provided for charge '{charge.description}'; it was added without tax rather than guessed"})
            taxes = {key: "0.00" for key in ("cgst", "sgst", "utgst", "igst", "cess")}
            gst_rate = ZERO
        else:
            gst_rate = _dec(charge.gstRate, "charge.gstRate")
            taxes = _split(amount, ZERO if zero_rated else gst_rate, ZERO, inter_state, utgst)
        total = amount + sum(Decimal(v) for v in taxes.values())
        consignment += total
        out_charges.append({**charge.model_dump(exclude_none=True), "taxableValue": format(amount, ".2f"),
                            "gstRate": str(gst_rate), **taxes, "lineTotal": format(money(total), ".2f")})
        summary = summaries.setdefault((charge.hsnOrSac or "", str(gst_rate)), {"taxable": ZERO, "cgst": ZERO, "sgst": ZERO, "utgst": ZERO, "igst": ZERO, "cess": ZERO})
        summary["taxable"] += amount
        for tax_key in taxes:
            summary[tax_key] += Decimal(taxes[tax_key])

    payable_taxable = Decimal("0")
    payable = {key: ZERO for key in ("cgst", "sgst", "utgst", "igst", "cess")}
    for summary in summaries.values():
        payable_taxable += summary["taxable"]
        for tax_key in payable:
            payable[tax_key] += summary[tax_key]

    computed = payable_taxable + sum(payable.values())
    round_off = ZERO
    if request.roundOff:
        round_off = round_rupee(computed) - computed
    grand = payable_taxable + (Decimal("0") if request.reverseCharge else sum(payable.values())) + round_off

    # Flags are nullable: absence of required policy input -> null, never guessed.
    einvoice = (policy.einvoiceApplicable if policy and policy.einvoiceApplicable is not None
                else (True if policy and policy.aatoBand in {"5-10cr", ">=10cr"} else (False if policy else None)))
    tds_flag = None
    if policy and policy.tds194q:
        turnover = policy.tds194q.buyerTurnoverAbove10Cr
        if turnover is False:
            tds_flag = False
        elif turnover is True and policy.tds194q.supplierYtdPurchases is not None:
            tds_flag = Decimal(policy.tds194q.supplierYtdPurchases.amount) + payable_taxable > Decimal("5000000")
        elif turnover is None:
            tds_flag = None

    return {
        "lines": out_lines,
        "charges": out_charges,
        "taxSummary": [
            {"hsn": hsn, "gstRate": rate, "taxable": format(money(item["taxable"]), ".2f"),
             **{key: format(money(item[key]), ".2f") for key in ("cgst", "sgst", "utgst", "igst", "cess")}}
            for (hsn, rate), item in sorted(summaries.items())
        ],
        "totals": {
            "taxable": format(money(payable_taxable), ".2f"),
            **{key: format(money(payable[key]), ".2f") for key in ("cgst", "sgst", "utgst", "igst", "cess")},
            "roundOff": format(money(round_off), ".2f"),
            "grand": format(money(grand), ".2f"),
        },
        "amountInWords": amount_in_words_inr(grand),
        "warnings": warnings,
        "flags": {
            "ewayBillRequired": consignment > EWAYBILL_LIMIT,
            "einvoiceExpected": einvoice,
            "hsnDigitsRequired": hsn_digits,
            "tds194qApplicable": tds_flag,
        },
        "zeroRated": zero_rated,
        "payableBy": "recipient" if request.reverseCharge else "supplier",
    }
