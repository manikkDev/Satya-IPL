"""BPI 2019 lag-distribution extractor — streams the XES log, aggregates only.

Reads data/raw/bpi*.xml (XES/OpenXES format), computes per-flow timing
percentiles for the four real P2P flows. Raw log stays gitignored in
data/raw/; only the small aggregate JSON is kept.
"""
import json
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

FLOWS = {
    "po_to_grn": ("Create Purchase Order Item", "Record Goods Receipt"),
    "grn_to_invoice": ("Record Goods Receipt", "Record Invoice Receipt"),
    "invoice_to_clear": ("Record Invoice Receipt", "Clear Invoice"),
    "vendor_inv_to_receipt": ("Vendor creates invoice", "Record Invoice Receipt"),
}
PCTS = [10, 25, 50, 75, 90, 95, 99]


def _events_of(trace):
    for event in trace.iter("event"):
        activity = timestamp = None
        for attr in event:
            if attr.get("key") == "concept:name":
                activity = attr.get("value")
            elif attr.get("key") == "time:timestamp":
                timestamp = attr.get("value")
        if activity and timestamp:
            yield activity, timestamp


def _percentile(sorted_vals, p):
    if not sorted_vals:
        return None
    index = min(len(sorted_vals) - 1, round(p / 100 * (len(sorted_vals) - 1)))
    return round(sorted_vals[index], 2)


def extract(path, out_path):
    """Stream the log, return per-flow lag statistics (days)."""
    import math
    lag_days = {name: [] for name in FLOWS}
    traces = events = 0
    for _event_elem, trace in ET.iterparse(path, events=("end",)):
        if trace.tag != "trace":
            continue
        first_seen = {}
        for activity, ts in _events_of(trace):
            if activity not in first_seen:
                try:
                    first_seen[activity] = datetime.fromisoformat(ts)
                except ValueError:
                    continue
        for name, (a, b) in FLOWS.items():
            if a in first_seen and b in first_seen:
                days = (first_seen[b] - first_seen[a]).total_seconds() / 86400
                if days >= 0:
                    lag_days[name].append(days)
        traces += 1
        if traces % 20000 == 0:
            print(f"{traces} traces processed")
        trace.clear()
    result = {"source": "BPI Challenge 2019 (van Dongen), CC BY 4.0",
              "file": str(path), "traces": traces, "flows": {}}
    for name, days in lag_days.items():
        if not days:
            result["flows"][name] = {"count": 0}
            continue
        days.sort()
        result["flows"][name] = {
            "count": len(days),
            "meanDays": round(sum(days) / len(days), 2),
            "percentiles": {f"p{p}": _percentile(days, p) for p in PCTS},
        }
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(json.dumps(result, indent=2))
    return result
