"""Curated demo dataset (server/src/seed, CONSTRUCTED_DEMO) as a held-out sanity set.

The exported documents carry explicit references (lines[].refs.poId,
payment.allocations); those define the ground truth and are NOT visible to
the features (linking.docs ignores id references), so the model must
recover the links from party, items, quantities, amounts and dates alone.
Never used for training, model selection, calibration or thresholds.
"""
import json
from pathlib import Path

PATH = Path(__file__).resolve().parents[3] / "data" / "linking" / "demo_holdout.json"
KINDS = {"BILLS", "RECEIVES", "SETTLES"}


def world(path=PATH):
    data = json.loads(Path(path).read_text())
    docs = data["documents"]
    links = [{"fromId": l["fromId"], "toId": l["toId"], "kind": l["kind"]} for l in data["links"] if l["kind"] in KINDS]
    seen = {(l["fromId"], l["toId"], l["kind"]) for l in links}
    for d in docs:  # allocations without a persisted link still settle
        for a in (d.get("payment") or {}).get("allocations") or []:
            key = (d["id"], a["documentId"], "SETTLES")
            if key not in seen:
                seen.add(key)
                links.append({"fromId": d["id"], "toId": a["documentId"], "kind": "SETTLES"})
    return {"documents": docs, "links": links, "group": "demo", "source": "demo"}
