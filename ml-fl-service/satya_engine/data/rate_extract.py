"""Extract GST rate rules from Notification 9/2025-CT(Rate) text.

Schedules carry CENTRAL-tax rates; total GST = 2x (CGST+SGST) which equals the
IGST rate. Rows of the form `NN. CODE description` are parsed; exclusion marks
"(Except XXXX)" flag the rule as conditional rather than dropping it silently.
"""
import json
import re
from pathlib import Path

CT_RATES = {"I": "2.5", "II": "9", "III": "20", "IV": "1.5", "V": "0.125", "VI": "0.75", "VII": "14"}
TOTAL_RATES = {"I": "5", "II": "18", "III": "40", "IV": "3", "V": "0.25", "VI": "1.5", "VII": "28"}
ROW_RE = re.compile(r"^\s*(\d+)\.\s+(\d{4,8}|[A-Z]*Chapter[^,\d]*\d{2,4}[^\s,]*)\s+(.+)$", re.M)
SCHED_RE = re.compile(r"SCHEDULE\s*[-–]?\s*(I{1,3}V?|IV|V|VI{0,2})\b", re.I)


def extract(pdf_text, notification_ref="Notification 9/2025-CT(Rate)", effective_from="2025-09-22"):
    """Parse schedule sections into rateRules entries."""
    marks = [(m.start(), m.group(1).upper()) for m in SCHED_RE.finditer(pdf_text)]
    sections = []
    for i, (pos, sched) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(pdf_text)
        if sched in CT_RATES:
            sections.append((sched, pdf_text[pos:end]))

    rules = []
    for sched, body in sections:
        for match in ROW_RE.finditer(body):
            sno, raw_code, desc = match.groups()
            code = re.sub(r"\D", "", raw_code)
            if not (2 <= len(code) <= 8):
                continue
            # A rule is conditional when the row only covers part of a heading:
            # "(Except ...)", bracketed sub-codes "[8413 40 00]", enumerations
            # "(a) ... (b) ...", or "other than"/"only" exclusion language.
            conditional = bool(
                re.search(r"\(Except[^)]*\)", desc, re.I)
                or "[" in desc
                or re.match(r"^\s*\([a-z]\)", desc)
                or re.search(r"\bother than\b|\bonly\b", desc, re.I)
                or (len(code) < 8 and re.search(r"\d{4,8}", desc)))
            rules.append({
                "prefix": code,
                "description": re.sub(r"\s+", " ", desc).strip()[:200],
                "rate": TOTAL_RATES[sched],
                "schedule": f"Schedule {sched}",
                "sNo": sno,
                "effectiveFrom": effective_from,
                "notificationRef": notification_ref,
                "conditional": conditional,
            })
    return rules


def write_reviewed(pdf_path, pdf_text, out_path):
    rules = extract(pdf_text)
    import hashlib
    sha = hashlib.sha256(Path(pdf_path).read_bytes()).hexdigest()
    for rule in rules:
        rule["sourceSha256"] = sha
        rule["sourceLocator"] = f"{rule['schedule']} sNo {rule['sNo']}"
    return {
        "extractionReviewed": False,   # human must eyeball before this flips true
        "taxBasis": "total_gst",
        "sources": [{
            "name": "Notification 9/2025-Central Tax (Rate), 17 Sep 2025",
            "url": "https://taxinformation.cbic.gov.in/view-pdf/1010436/ENG/Notifications",
            "retrievedAt": "2026-10-29T19:33:00+05:30",
            "sha256": sha,
            "localPath": "09-2025-CTR-eng.pdf",
        }],
        "rateRules": rules,
    }
