import gzip
import json
from datetime import date
from decimal import Decimal
from difflib import SequenceMatcher
from pathlib import Path
from typing import Annotated

from pydantic import Field, StringConstraints, model_validator

from ..contracts_v2 import Contract, DateOnly, DecimalString, OffsetDateTime

Code = Annotated[str, StringConstraints(pattern=r"^[0-9]{2}(?:[0-9]{2}){0,3}$")]
MAX_MASTER_BYTES = 32 * 1024 * 1024


class ReferenceSource(Contract):
    name: str
    url: str
    retrievedAt: OffsetDateTime
    sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]


class HsnCode(Contract):
    code: Code
    description: str = Field(min_length=1)
    chapter: Annotated[str, StringConstraints(pattern=r"^[0-9]{2}$")]


class RateRule(Contract):
    prefix: Code
    description: str
    rate: DecimalString
    cessRate: DecimalString | None = None
    schedule: str
    sNo: str
    effectiveFrom: DateOnly
    effectiveTo: DateOnly | None = None
    notificationRef: str
    conditional: bool = False
    sourceSha256: str | None = None
    sourceLocator: str | None = None

    @model_validator(mode="after")
    def valid_period(self):
        if Decimal(self.rate) < 0 or (self.cessRate is not None and Decimal(self.cessRate) < 0):
            raise ValueError("Reference rates must not be negative")
        if self.effectiveTo and self.effectiveTo <= self.effectiveFrom:
            raise ValueError("Rate effectiveTo must follow effectiveFrom (exclusive)")
        return self


class HsnArtifact(Contract):
    version: str
    builtAt: OffsetDateTime
    sources: list[ReferenceSource]
    codes: list[HsnCode] = Field(max_length=100000)
    rateRules: list[RateRule] = Field(max_length=100000)


class HsnMaster:
    def __init__(self, payload=None):
        self.artifact = HsnArtifact.model_validate(payload) if payload else None
        self.version = self.artifact.version if self.artifact else None
        self.codes = {item.code: item for item in self.artifact.codes} if self.artifact else {}
        if self.artifact and len(self.codes) != len(self.artifact.codes):
            raise ValueError("Duplicate HSN codes in master")

    @classmethod
    def load(cls, path):
        path = Path(path)
        if not path.is_file():
            return cls()
        with gzip.open(path, "rb") as stream:
            raw = stream.read(MAX_MASTER_BYTES + 1)
        if len(raw) > MAX_MASTER_BYTES:
            raise ValueError("HSN master exceeds decompressed size limit")
        return cls(json.loads(raw))

    def lookup(self, code, on_date):
        if code not in self.codes:
            return None
        when = on_date.isoformat() if isinstance(on_date, date) else date.fromisoformat(on_date).isoformat()
        rules = [
            rule for rule in self.artifact.rateRules
            if code.startswith(rule.prefix) and rule.effectiveFrom <= when
            and (rule.effectiveTo is None or when < rule.effectiveTo)
        ]
        if not rules:
            return None
        length = max(len(rule.prefix) for rule in rules)
        matches = [rule for rule in rules if len(rule.prefix) == length]
        conditional = any(rule.conditional for rule in matches)
        # Equal prefixes can have product-specific exceptions. Never select an
        # arbitrary first row, even if two rows happen to share the same rate.
        uncertain = conditional or len(matches) != 1
        chosen = matches[0]
        return {
            "rate": None if uncertain else chosen.rate,
            "cessRate": None if uncertain else chosen.cessRate,
            "effectiveFrom": chosen.effectiveFrom,
            "notificationRef": chosen.notificationRef,
            "conditional": uncertain, "matchedPrefix": chosen.prefix,
            **({"warning": "Rate depends on product details or overlapping rules - confirm against the notification",
                "candidates": [rule.model_dump(exclude_none=True) for rule in matches]} if uncertain else {}),
        }

    def search(self, query, limit=20):
        query = query.strip().lower()[:200]
        if not query:
            return []
        ranked = []
        for code, item in self.codes.items():
            description = item.description.lower()
            score = (2 if code.startswith(query) else 1 if query in description else
                     SequenceMatcher(None, query, description).ratio())
            if score >= 0.3:
                ranked.append((score, code, item))
        ranked.sort(key=lambda row: (-row[0], row[1]))
        return [item.model_dump() for _, _, item in ranked[:max(0, min(limit, 100))]]
