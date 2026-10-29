import csv
import hashlib
import io
import json
import re
from datetime import datetime, timezone
from typing import Literal

from pydantic import Field, ValidationError

from .business_contracts import Contract, Record, decimal_value

HEADERS = {"id", "reference", "supplier", "currency", "occurredAt", "observedAt", "poId", "invoiceId", "amount", "netAmount", "status", "dueAt", "coverage", "matchingLevel", "utr", "gstin", "irn"}
LINES = {"description", "sku", "quantity", "unitPrice", "uom", "acceptedQuantity", "poLineId", "packSize"}
TAXES = {"taxCGST": "CGST", "taxSGST": "SGST", "taxIGST": "IGST", "taxCESS": "CESS"}
NUMBERS = {"amount", "netAmount", "quantity", "unitPrice", "acceptedQuantity", "packSize", *TAXES}


class CsvFile(Contract):
    name: str = Field(min_length=1, max_length=160)
    recordType: Literal["PO", "INVOICE", "GRN", "PAYMENT", "CREDIT_NOTE", "PROFORMA", "RETURN"]
    source: str = Field(min_length=1, max_length=80)
    content: str = Field(max_length=1500000)
    mapping: dict[str, str] = Field(max_length=40)
    numberFormat: Literal["plain", "en-IN"] = "plain"


class PreviewRequest(Contract):
    title: str = Field(min_length=3, max_length=160)
    poId: str = Field(min_length=1, max_length=80)
    files: list[CsvFile] = Field(min_length=1, max_length=8)
    ingestedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


def numeric(raw, mode, currency):
    value = raw.strip()
    if mode == "en-IN":
        if currency == "INR":
            value = re.sub(r"^(?:₹|INR\s+)", "", value).strip()
        if "," in value:
            if not re.fullmatch(r"[+-]?(?:\d{1,3},\d{3}|\d{1,2}(?:,\d{2})+,\d{3})(?:\.\d+)?", value):
                raise ValueError("Invalid declared Indian thousands grouping")
            value = value.replace(",", "")
    return decimal_value(value)


def preview(request: PreviewRequest):
    records, documents, issues = [], [], []
    seen_files, seen_records = set(), set()
    total_rows, issue_count, duplicates = 0, 0, 0

    def issue(name, row, message):
        nonlocal issue_count
        issue_count += 1
        if len(issues) < 300:
            issues.append({"file": name, "row": row, "message": str(message)[:350]})

    for file in request.files:
        digest = hashlib.sha256((file.source + file.recordType + file.content).encode()).hexdigest()
        if digest in seen_files:
            duplicates += 1
            continue
        seen_files.add(digest)
        document_id = f"doc-{digest}"
        documents.append({"id": document_id, "name": file.name, "source": file.source, "mediaType": "text/csv", "checksum": hashlib.sha256(file.content.encode()).hexdigest(), "content": file.content})
        reader = csv.DictReader(io.StringIO(file.content.lstrip("\ufeff")), strict=True)
        try:
            headers = reader.fieldnames or []
        except csv.Error as error:
            issue(file.name, 1, error)
            continue
        if not headers or len(headers) > 50 or len(set(headers)) != len(headers):
            issue(file.name, 1, "CSV needs unique headers, at most 50 columns")
            continue
        invalid_mapping = [key for key, column in file.mapping.items() if key not in HEADERS | LINES | set(TAXES) | {"lineId"} or column not in headers]
        if invalid_mapping:
            issue(file.name, 1, f"Missing/unsupported mapping columns: {', '.join(invalid_mapping)}")
            continue
        grouped, bad = {}, set()
        try:
            for row_number, row in enumerate(reader, 2):
                total_rows += 1
                if total_rows > 2000:
                    issue(file.name, row_number, "At most 2000 source rows per preview; split the export")
                    break
                if None in row or any(value is None for value in row.values()):
                    issue(file.name, row_number, "Row column count differs from the header")
                    continue
                mapped = {key: row[column].strip() for key, column in file.mapping.items() if row[column].strip()}
                identifier = mapped.get("id")
                if not identifier:
                    issue(file.name, row_number, "A source observation/AP posting ID is required, not a guessed invoice identity")
                    continue
                currency = mapped.get("currency", "").upper()
                try:
                    converted = {key: numeric(value, file.numberFormat, currency) if key in NUMBERS else value for key, value in mapped.items()}
                    if currency:
                        converted["currency"] = currency
                except ValueError as error:
                    bad.add(identifier)
                    issue(file.name, row_number, error)
                    continue
                header = {key: value for key, value in converted.items() if key in HEADERS}
                header.setdefault("observedAt", request.ingestedAt.isoformat())
                header.setdefault("coverage", "unknown")
                taxes = {TAXES[key]: value for key, value in converted.items() if key in TAXES}
                signature = {**header, "taxes": taxes}
                if identifier in grouped and grouped[identifier]["signature"] != signature:
                    bad.add(identifier)
                    issue(file.name, row_number, "Conflicting header values for one source record; do not silently merge")
                    continue
                if identifier not in grouped:
                    grouped[identifier] = {"signature": signature, "record": {**header, "taxes": taxes, "type": file.recordType, "source": file.source, "provenance": "USER_PROVIDED", "lines": [], "fieldEvidence": {}}, "row": row_number}
                record = grouped[identifier]["record"]
                line_id = converted.get("lineId", f"row-{row_number}")
                line = {key: value for key, value in converted.items() if key in LINES}
                if line:
                    record["lines"].append({"id": line_id, **line})
                for key, column in file.mapping.items():
                    if key not in mapped or key == "lineId":
                        continue
                    path = f"lines/{line_id}/{key}" if key in LINES else f"taxes/{TAXES[key]}" if key in TAXES else key
                    record["fieldEvidence"].setdefault(path, {"documentId": document_id, "row": row_number, "column": column, "rawValue": row[column], "transform": f"decimal_{file.numberFormat}" if key in NUMBERS else "explicit_csv_mapping"})
        except csv.Error as error:
            issue(file.name, reader.line_num, error)
            bad.update(grouped)
        for identifier, group in grouped.items():
            if identifier in bad:
                continue
            if identifier in seen_records:
                issue(file.name, group["row"], "Source record ID appears in distinct files; resolve observation identity first")
                continue
            try:
                validated = Record.model_validate(group["record"])
                records.append(group["record"])
                seen_records.add(validated.id)
            except ValidationError as error:
                for detail in error.errors(include_input=False, include_context=False, include_url=False):
                    issue(file.name, group["row"], f"{'/'.join(map(str, detail['loc']))}: {detail['msg']}")
    if not any(record["id"] == request.poId and record["type"] == "PO" and record.get("status") == "approved" for record in records):
        issue("bundle", 0, "Map an approved purchase order matching the selected PO ID")
    file_identities = sorted({json.dumps(file.model_dump(exclude={'name'}), sort_keys=True) for file in request.files})
    fingerprint = hashlib.sha256(json.dumps({'poId': request.poId, 'files': file_identities, 'adapter': 'satya-csv-v1'}, sort_keys=True).encode()).hexdigest()
    return {"sourceFingerprint": fingerprint, "records": records, "documents": documents, "issues": issues, "issueCount": issue_count, "totalRows": total_rows, "acceptedRecords": len(records), "duplicateFilesIgnored": duplicates, "canCommit": issue_count == 0 and bool(records), "adapterVersion": "satya-csv-v1"}
