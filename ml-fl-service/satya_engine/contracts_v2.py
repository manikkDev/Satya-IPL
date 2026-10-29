"""Frozen domain types from docs/plan/02 sections 2, 3 and 5.6.

No untyped dict escape hatches for undefined endpoint contracts. Those are
published only when their nested structures have been agreed with Agent B.
"""
import re
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints


def business_date(value: str) -> str:
    date.fromisoformat(value)
    return value


def offset_timestamp(value: str) -> str:
    if not re.match(r"^\d{4}-\d{2}-\d{2}T", value):
        raise ValueError("Use an ISO timestamp with an explicit timezone offset")
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("Timestamp requires an explicit timezone offset")
    return value


DecimalString = Annotated[str, StringConstraints(strict=True, pattern=r"^-?\d{1,15}(\.\d{1,6})?$")]
DateOnly = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$"), AfterValidator(business_date)]
OffsetDateTime = Annotated[str, AfterValidator(offset_timestamp)]
FinancialYear = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}$")]
Certainty = Literal["CONFIRMED", "PROBABLE", "POSSIBLE", "AMBIGUOUS", "INSUFFICIENT_EVIDENCE"]
Action = Literal["APPROVE", "REQUEST_CLARIFICATION", "ESCALATE", "PLACE_ON_HOLD"]
DocType = Literal[
    "PR", "RFQ", "QUOTATION", "PI_IN", "PI_OUT", "PO", "PO_AMENDMENT", "PO_ACK",
    "RELEASE_ORDER", "INVOICE_IN", "INVOICE_OUT", "CREDIT_NOTE_IN", "DEBIT_NOTE_OUT",
    "CREDIT_NOTE_OUT", "DEBIT_NOTE_IN", "DELIVERY_CHALLAN", "EWAY_BILL", "LR",
    "GRN", "QC", "RETURN", "PAYMENT_OUT", "PAYMENT_IN", "ADVANCE_OUT",
    "REMITTANCE_ADVICE", "TDS_ENTRY", "GSTR2B_ENTRY", "IMS_ACTION", "BANK_LINE",
    "SUPPLIER_STATEMENT_LINE",
]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Money(Contract):
    amount: DecimalString
    currency: str


class Address(Contract):
    line1: str
    line2: str | None = None
    city: str
    stateCode: str
    pincode: str
    country: str


class Udyam(Contract):
    number: str
    category: Literal["micro", "small", "medium"]


class Party(Contract):
    name: str
    gstin: str | None = None
    pan: str | None = None
    stateCode: str | None = None
    address: Address | None = None
    udyam: Udyam | None = None
    supplierId: str | None = None


class LineRefs(Contract):
    poId: str | None = None
    poLineNo: int | None = None
    grnId: str | None = None
    grnLineNo: int | None = None
    invoiceId: str | None = None
    invoiceLineNo: int | None = None


class DocLine(Contract):
    lineNo: int
    itemId: str | None = None
    sku: str | None = None
    description: str
    specs: dict[str, str] | None = None
    hsn: str | None = None
    uom: str
    qty: DecimalString
    rate: DecimalString | None = None
    discountPct: DecimalString | None = None
    taxableValue: DecimalString | None = None
    gstRate: DecimalString | None = None
    cgst: DecimalString | None = None
    sgst: DecimalString | None = None
    igst: DecimalString | None = None
    cess: DecimalString | None = None
    lineTotal: DecimalString | None = None
    scheduleDate: DateOnly | None = None
    refs: LineRefs | None = None
    acceptedQty: DecimalString | None = None
    rejectedQty: DecimalString | None = None
    rejectReason: str | None = None
    batch: str | None = None


class Charge(Contract):
    kind: Literal["freight", "packing", "insurance", "other"]
    description: str
    amount: DecimalString
    hsnOrSac: str | None = None
    gstRate: DecimalString | None = None


class Totals(Contract):
    taxable: DecimalString
    cgst: DecimalString
    sgst: DecimalString
    igst: DecimalString
    cess: DecimalString
    roundOff: DecimalString
    grand: DecimalString


class PaymentAllocation(Contract):
    documentId: str
    amount: DecimalString
    basis: Literal["reference", "reviewer", "remittance"]


class Payment(Contract):
    amount: DecimalString
    utr: str | None = None
    mode: Literal["NEFT", "RTGS", "IMPS", "UPI", "CHEQUE", "OTHER"] | None = None
    valueDate: DateOnly | None = None
    bankAccountMasked: str | None = None
    allocations: list[PaymentAllocation] | None = None
    tdsAmount: DecimalString | None = None
    reversalOf: str | None = None


class SignedQr(Contract):
    verified: bool
    keyId: str | None = None
    fields: dict[str, str] | None = None


class Lut(Contract):
    arn: str
    fy: FinancialYear


class Gst(Contract):
    irn: str | None = None
    ackNo: str | None = None
    ackDate: OffsetDateTime | None = None
    signedQr: SignedQr | None = None
    ewayBillNo: str | None = None
    reverseCharge: bool | None = None
    lut: Lut | None = None
    supplyType: Literal["B2B", "EXPWP", "EXPWOP", "SEZWP", "SEZWOP"] | None = None


class Terms(Contract):
    paymentTerms: str | None = None
    creditDays: int | None = None
    advancePct: DecimalString | None = None
    deliveryTerms: str | None = None
    inspection: str | None = None
    warranty: str | None = None
    penalty: str | None = None
    validityDays: int | None = None
    freeText: list[str] | None = None


class Source(Contract):
    channel: Literal[
        "created_in_satya", "upload_pdf", "upload_image", "csv", "excel",
        "json", "einvoice_json", "bank_csv", "gstr2b_json", "api",
    ]
    fileId: str | None = None
    extractionDraftId: str | None = None
    sourceSystem: str | None = None


class Fx(Contract):
    rate: DecimalString
    source: str
    date: DateOnly


class BusinessDocument(Contract):
    id: str
    groupId: str
    entityId: str
    type: DocType
    number: str
    externalRef: str | None = None
    date: DateOnly
    fy: FinancialYear
    status: Literal[
        "draft", "pending_approval", "approved", "issued", "acknowledged",
        "partially_fulfilled", "fulfilled", "short_closed", "cancelled",
        "posted", "reversed", "confirmed", "rejected",
    ]
    revision: int
    supersedes: str | None = None
    seller: Party
    buyer: Party
    shipTo: Address | None = None
    placeOfSupply: str | None = None
    currency: str
    fx: Fx | None = None
    lines: list[DocLine] = Field(max_length=2000)
    charges: list[Charge] | None = None
    totals: Totals | None = None
    payment: Payment | None = None
    gst: Gst | None = None
    terms: Terms | None = None
    source: Source
    provenance: Literal["USER_PROVIDED", "SYSTEM_GENERATED", "EXTRACTED_REVIEWED", "CONSTRUCTED_DEMO"]
    observedAt: OffsetDateTime
    createdAt: OffsetDateTime
    createdBy: str
    updatedAt: OffsetDateTime


class Locator(Contract):
    kind: Literal["pdf_text", "pdf_region", "csv_cell", "json_path", "qr_field", "manual"]
    page: int | None = None
    row: int | None = None
    column: str | None = None
    path: str | None = None
    quote: str | None = None


class Evidence(Contract):
    id: str
    documentId: str
    documentType: DocType
    field: str
    value: str | None = None
    locator: Locator
    fileId: str | None = None
    observedAt: OffsetDateTime


class ExposureRange(Contract):
    min: Money
    max: Money


class CalculationStep(Contract):
    step: str
    formula: str | None = None
    value: str | None = None
    evidenceIds: list[str] | None = None


class Candidate(Contract):
    documentId: str
    score: DecimalString | None = None
    why: str


class ActionScope(Contract):
    holdAmount: Money | None = None
    approveAmount: Money | None = None


class Finding(Contract):
    id: str
    code: str
    title: str
    severity: Literal["info", "low", "medium", "high", "critical"]
    certainty: Certainty
    exposure: ExposureRange | Money | None = None
    documentIds: list[str]
    evidence: list[Evidence]
    explanation: str
    calculation: list[CalculationStep]
    candidates: list[Candidate] | None = None
    recommendedAction: Action
    actionScope: ActionScope | None = None
    whatResolvesIt: str
    detector: Literal["rule", "ml", "hybrid"]
    detectorVersion: str
    harmlessVariance: bool | None = None


class GraphNode(Contract):
    id: str
    type: DocType | Literal["SUPPLIER", "ENTITY", "ITEM", "FINDING"]
    label: str
    subtitle: str | None = None
    stage: Literal["order", "dispatch", "receipt", "inspection", "invoice", "payment", "tax", "party", "finding"]
    amount: Money | None = None
    qty: DecimalString | None = None
    date: DateOnly | None = None
    status: str | None = None
    severity: str | None = None
    documentId: str | None = None


class GraphEdge(Contract):
    id: str
    source: str
    target: str
    kind: str
    certainty: Certainty
    amount: Money | None = None
    qty: DecimalString | None = None
    label: str
    explanation: str
    evidenceIds: list[str]


class TimelineBucket(Contract):
    at: OffsetDateTime
    nodeIds: list[str]
    edgeIds: list[str]


class GraphPayload(Contract):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    timeline: list[TimelineBucket]
    source: Literal["neo4j", "snapshot"]


class TaxParty(Contract):
    gstin: str | None = None
    stateCode: str


class TaxLine(Contract):
    lineNo: int
    hsn: str
    qty: DecimalString
    rate: DecimalString
    discountPct: DecimalString | None = None
    uom: str
    gstRateOverride: DecimalString | None = None


class TaxComputeRequest(Contract):
    seller: TaxParty
    buyer: TaxParty
    placeOfSupply: str
    docDate: DateOnly
    supplyType: Literal["B2B", "EXPWP", "EXPWOP", "SEZWP", "SEZWOP"]
    reverseCharge: bool
    lut: Lut | None = None
    currency: str
    lines: list[TaxLine] = Field(min_length=1, max_length=2000)
    charges: list[Charge]
    roundOff: bool


class GstinValidateRequest(Contract):
    gstin: str


def schemas():
    """Each entry is a self-contained JSON Schema, including nested $defs."""
    return {model.__name__: model.model_json_schema() for model in (
        Money, Address, Party, DocLine, BusinessDocument, Evidence, Finding,
        GraphPayload, TaxComputeRequest, GstinValidateRequest,
    )}
