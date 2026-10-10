from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def decimal_value(value):
    if not isinstance(value, (str, Decimal)):
        raise ValueError("Exact quantities and money must be decimal strings")
    try:
        number = Decimal(value)
    except InvalidOperation as error:
        raise ValueError("Invalid decimal") from error
    if not number.is_finite() or abs(number) > Decimal("1000000000000"):
        raise ValueError("Decimal outside permitted finite bounds")
    if number.as_tuple().exponent < -6:
        raise ValueError("At most six decimal places are supported")
    return str(value)


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Line(Contract):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_.:-]+$")
    description: str = Field(min_length=1, max_length=500)
    sku: Optional[str] = Field(None, max_length=80)
    quantity: str
    unitPrice: str = "0"
    uom: Literal["EA", "BOX", "SET", "M", "KG"] = "EA"
    acceptedQuantity: Optional[str] = None
    poLineId: Optional[str] = None
    packSize: Optional[str] = None

    @field_validator("quantity", "unitPrice", "acceptedQuantity", "packSize", mode="before")
    @classmethod
    def decimals(cls, value):
        return None if value is None else decimal_value(value)

    @model_validator(mode="after")
    def quantities(self):
        if Decimal(self.quantity) < 0 or Decimal(self.unitPrice) < 0:
            raise ValueError("Negative quantities/prices require an explicit credit/return record")
        if self.acceptedQuantity is not None and not Decimal("0") <= Decimal(self.acceptedQuantity) <= Decimal(self.quantity):
            raise ValueError("Accepted quantity must lie between zero and received quantity")
        if self.packSize is not None and Decimal(self.packSize) <= 0:
            raise ValueError("Pack size must be positive")
        return self


class Record(Contract):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_.:-]+$")
    type: Literal["PO", "INVOICE", "GRN", "PAYMENT", "CREDIT_NOTE", "PROFORMA", "RETURN"]
    source: str = Field(min_length=1, max_length=80)
    supplier: str = Field(min_length=1, max_length=160)
    reference: str = Field(min_length=1, max_length=120)
    occurredAt: datetime
    observedAt: datetime
    poId: Optional[str] = None
    invoiceId: Optional[str] = None
    currency: Literal["INR", "USD", "EUR"] = "INR"
    amount: Optional[str] = None
    netAmount: Optional[str] = None
    taxes: dict[str, str] = Field(default_factory=dict)
    lines: list[Line] = Field(default_factory=list, max_length=100)
    status: Literal["approved", "posted", "settled", "pending", "failed", "reversed"] = "posted"
    dueAt: Optional[datetime] = None
    matchingLevel: Literal["three_way", "four_way"] = "three_way"
    coverage: Literal["complete", "partial", "unknown"] = "complete"
    utr: Optional[str] = Field(None, max_length=120)
    gstin: Optional[str] = Field(None, max_length=40)
    irn: Optional[str] = Field(None, max_length=100)
    provenance: Literal["CONSTRUCTED", "USER_PROVIDED", "PUBLIC_REAL", "PUBLIC_SYNTHETIC"] = "USER_PROVIDED"

    @field_validator("id")
    @classmethod
    def safe_identifier(cls, value):
        if value in {"__proto__", "constructor", "prototype"}:
            raise ValueError("Reserved identifier")
        return value

    @field_validator("amount", "netAmount", mode="before")
    @classmethod
    def decimals(cls, value):
        return None if value is None else decimal_value(value)

    @field_validator("taxes", mode="before")
    @classmethod
    def tax_values(cls, value):
        if set(value) - {"CGST", "SGST", "IGST", "CESS"}:
            raise ValueError("Unsupported tax component")
        return {key: decimal_value(amount) for key, amount in value.items()}

    @field_validator("occurredAt", "observedAt", "dueAt")
    @classmethod
    def dates(cls, value):
        if value is not None and value.tzinfo is None:
            raise ValueError("Timestamp must have an explicit timezone")
        return value

    @model_validator(mode="after")
    def required_values(self):
        if self.type == "PO" and len({line.uom for line in self.lines}) > 1:
            raise ValueError("Mixed order units require separate case scopes in this initial engine")
        if self.type in {"PO", "INVOICE", "GRN", "RETURN"} and not self.lines:
            raise ValueError("This record requires line items")
        if self.type in {"PAYMENT", "INVOICE", "CREDIT_NOTE"} and self.amount is None:
            raise ValueError("This record requires an exact amount")
        if any(Decimal(amount) < 0 for amount in self.taxes.values()) or (self.amount is not None and Decimal(self.amount) < 0):
            raise ValueError("Use positive amounts with explicit record effect")
        if len({line.id for line in self.lines}) != len(self.lines):
            raise ValueError("Line identifiers must be unique inside a record")
        return self


class ReconcileRequest(Contract):
    caseId: str = Field(min_length=1, max_length=80)
    companyId: str = Field(min_length=1, max_length=80)
    poId: str = Field(min_length=1, max_length=80)
    records: list[Record] = Field(min_length=1, max_length=1000)
    observedBefore: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    occurredBefore: Optional[datetime] = None
    invoiceLinks: dict[str, str] = Field(default_factory=dict)
    confirmedDuplicates: dict[str, str] = Field(default_factory=dict)
    paymentAllocations: dict[str, str] = Field(default_factory=dict)

    @field_validator("observedBefore", "occurredBefore")
    @classmethod
    def dates(cls, value):
        if value is not None and value.tzinfo is None:
            raise ValueError("Cutoff must include timezone")
        return value

    @model_validator(mode="after")
    def unique_records(self):
        if sum(len(record.lines) for record in self.records) > 2000:
            raise ValueError("Split imports into case bundles with at most 2000 total lines")
        if len({record.id for record in self.records}) != len(self.records):
            raise ValueError("Repeated source record IDs are not separate observations")
        return self
