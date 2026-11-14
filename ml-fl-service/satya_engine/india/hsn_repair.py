"""Deterministic repairs for the extracted Notification 9/2025-CT(Rate) rate rules.

The PDF extraction behind the committed HSN master mislabelled schedule runs:
after Schedule II S.No. 95 a page break re-emitted the "Schedule I" label, so
Schedule II S.Nos. 96..640 (bearings 8482, valves 8481, motors 8501, panels
8537, fittings 7307, seals 8484, ACs, refrigerators, washing machines ...)
were stored at 5% instead of 18%. The same happened in Schedules III and VI.

The repair uses only structure present in the extraction itself:

* A schedule starts only where S.No. restarts at 1. A row whose label changes
  while its S.No. simply continues the previous run belongs to the previous
  run (the label is a page-header artefact).
* The rate is the schedule's total-GST rate (2 x the central-tax rate printed
  in the notification), re-derived from the corrected schedule.
* A 4-digit prefix whose description begins with sub-heading digit groups
  ("81 90 Hydraulic pumps ...") is extended to the full sub-heading when that
  code exists in the HSN directory.

RESTORED_RULES re-adds rows the extraction dropped (reviewed by hand against
the notification; each carries a sourceLocator saying so).
"""
import re

NOTIFICATION = "Notification 9/2025-CT(Rate)"
# total GST = 2 x CGST rate of each schedule of Notification 9/2025-CT(Rate)
SCHEDULE_RATES = {
    "Schedule I": "5", "Schedule II": "18", "Schedule III": "40", "Schedule IV": "3",
    "Schedule V": "0.25", "Schedule VI": "1.5", "Schedule VII": "28",
}

_LEADING_SUBHEADING = re.compile(r"^((?:\d{2})(?: \d{2}){0,1})\s+(?=[A-Za-z(\[])")

RESTORED_RULES = [
    # Schedule I S.No. 425: power driven pumps primarily designed for handling
    # water (centrifugal, deep tube-well turbine, submersible, axial and mixed
    # flow vertical). Mapped to the directory codes that name exactly those pumps.
    *[dict(prefix=code, description=desc, rate="5", schedule="Schedule I", sNo="425",
           effectiveFrom="2025-09-22", notificationRef=NOTIFICATION, conditional=False,
           sourceLocator="Schedule I sNo 425 (row dropped by extraction; restored on review)")
      for code, desc in [
          ("84137010", "Power driven centrifugal pumps primarily designed for handling water"),
          ("84135021", "Deep tube-well turbine pumps"),
          ("84138130", "Axial flow and mixed flow vertical pumps designed primarily for handling water"),
      ]],
]


def _sno(rule):
    head = str(rule.get("sNo", "")).split(".")[0].strip()
    return int(head) if head.isdigit() else None


def repair_rules(rules, codes=()):
    """Return repaired copies of `rules` (input is not mutated) + a change log."""
    known = set(codes)
    out, log = [], []
    current, prev_no = None, None
    for raw in rules:
        rule = dict(raw)
        if rule.get("notificationRef") != NOTIFICATION or rule.get("schedule") not in SCHEDULE_RATES:
            out.append(rule)
            continue
        no = _sno(rule)
        label = rule["schedule"]
        continues = current is not None and no is not None and prev_no is not None and no >= prev_no and no != 1
        if label != current and continues:
            log.append(f"sNo {rule['sNo']} {rule['prefix']}: {label} -> {current}")
            rule["schedule"] = current
            rule["sourceLocator"] = f"{current} sNo {rule['sNo']} (schedule label repaired)"
        else:
            current = label
        prev_no = no if no is not None else prev_no
        rate = SCHEDULE_RATES[rule["schedule"]]
        if rule.get("rate") != rate:
            rule["rate"] = rate
        m = _LEADING_SUBHEADING.match(rule.get("description", ""))
        if m and len(rule["prefix"]) == 4:
            extended = rule["prefix"] + m.group(1).replace(" ", "")
            if extended in known or any(c.startswith(extended) for c in known):
                log.append(f"sNo {rule['sNo']}: prefix {rule['prefix']} -> {extended}")
                rule["prefix"] = extended
        out.append(rule)
    have = {(r["prefix"], r.get("sNo"), r.get("schedule")) for r in out}
    for extra in RESTORED_RULES:
        if (extra["prefix"], extra["sNo"], extra["schedule"]) not in have and extra["prefix"] in known:
            out.append(dict(extra))
            log.append(f"restored {extra['schedule']} sNo {extra['sNo']} -> {extra['prefix']}")
    return out, log


def repair_artifact(payload, version_suffix="r1"):
    codes = [c["code"] for c in payload.get("codes", [])]
    rules, log = repair_rules(payload.get("rateRules", []), codes)
    repaired = dict(payload, rateRules=rules)
    if log and not str(payload.get("version", "")).endswith(f"-{version_suffix}"):
        repaired["version"] = f"{payload.get('version')}-{version_suffix}"
    return repaired, log
