"""BPI 2019 -> Satya company artifact extractor.

Streams data/raw/bpi2019-random.xml (XES), reconstructs real procure-to-pay
history for ONE company cluster (the largest `Company` value), and emits
assets/bpi_company.jsonl.gz: {meta, companies, vendors, items, documents, links}.

Real events only — identities are assigned later by the seed layer (synthetic
names/GSTINs/bank details are the server's job, marked CONSTRUCTED_DEMO).
Bounded output: MAX_POS purchase documents, newest first.
"""
import gzip
import json
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

RAW = Path("data/raw/bpi2019-random.xml")
OUT = Path("assets/bpi_company.jsonl.gz")
MAX_POS = 500
MAX_VENDORS = 80

ACT_PO = {"SRM: Created", "Create Purchase Order Item", "SRM: Document Completed",
          "SRM: Complete", "SRM: In Transfer to Execution Syst.", "SRM: Awaiting Approval",
          "SRM: Ordered", "SRM: Change was Transmitted", "SRM: Deleted"}
ACT_GR = {"Record Goods Receipt"}
ACT_INV_IN = {"Vendor creates invoice", "Create Invoice"}
ACT_INV_REC = {"Record Invoice Receipt", "Record Invoice"}
ACT_CLEAR = {"Clear Invoice", "Clear Payment", "Vendor creates debit memo"}
ACT_BLOCK = {"Block invoice", "SRM: Blocked"}
ACT_UNBLOCK = {"Release invoice", "SRM: Released"}
ACT_CANCEL = {"Cancel Invoice Receipt", "Cancel Goods Receipt"}


def _attrs(elem):
    out = {}
    for attr in elem:
        key = attr.get("key")
        out[key] = attr.get("value")
    return out


def extract(path=RAW, out_path=OUT):
    traces = []
    company_counter = Counter()
    # pass 1: pick the dominant company cluster
    for _e, trace in ET.iterparse(path, events=("end",)):
        if trace.tag != "trace":
            continue
        a = _attrs(trace)
        company_counter[a.get("Company", "?")] += 1
        traces.append((a.get("concept:name"), a.get("Company")))
        trace.clear()
    company = company_counter.most_common(1)[0][0]
    wanted = {n for n, c in traces if c == company}
    del traces, company_counter

    # pass 2: collect full traces for that company only
    items = {}          # trace name -> dict
    pos = {}            # purchasing doc -> {items:[names], vendor, first_ts}
    vendors = {}
    for _e, trace in ET.iterparse(path, events=("end",)):
        if trace.tag != "trace":
            continue
        a = _attrs(trace)
        name = a.get("concept:name")
        if name not in wanted:
            trace.clear()
            continue
        events = []
        for event in trace.iter("event"):
            ea = _attrs(event)
            act, ts = ea.get("concept:name"), ea.get("time:timestamp")
            if act and ts:
                events.append({"act": act, "ts": ts,
                               "eur": ea.get("Cumulative net worth (EUR)")})
        events.sort(key=lambda x: x["ts"])
        doc_no = a.get("Purchasing Document")
        item = {
            "trace": name, "item": a.get("Item"), "doc": doc_no,
            "vendor": a.get("Vendor"), "vendorName": a.get("Name"),
            "company": a.get("Company"), "docType": a.get("Document Type"),
            "category": a.get("Item Category"), "itemType": a.get("Item Type"),
            "spend": a.get("Spend area text"), "subSpend": a.get("Sub spend area text"),
            "classification": a.get("Spend classification text"),
            "grBased": a.get("GR-Based Inv. Verif.") == "true",
            "goodsReceipt": a.get("Goods Receipt") == "true",
            "events": events,
            "value": events[0]["eur"] if events else None,
        }
        items[name] = item
        po = pos.setdefault(doc_no, {"items": [], "vendor": item["vendor"], "created": events[0]["ts"] if events else ""})
        po["items"].append(name)
        v = vendors.setdefault(item["vendor"], {"id": item["vendor"], "name": item["vendorName"], "pos": set(), "spends": Counter()})
        v["pos"].add(doc_no)
        v["spends"][item["spend"]] += 1
        trace.clear()

    # bound: newest MAX_POS POs
    ordered = sorted(pos.values(), key=lambda p: p["created"], reverse=True)[:MAX_POS]
    keep_names = {n for p in ordered for n in p["items"]}
    items = {n: i for n, i in items.items() if n in keep_names}
    vendors = {vid: v for vid, v in sorted(vendors.items(), key=lambda kv: -len(kv[1]["pos"]))[:MAX_VENDORS]}
    keep_vendors = set(vendors)
    ordered = [p for p in ordered if p["vendor"] in keep_vendors]
    keep_names = {n for p in ordered for n in p["items"]}
    items = {n: i for n, i in items.items() if n in keep_names}

    documents, links = [], []
    doc_id_of = {}
    for pi, po in enumerate(ordered, 1):
        po_id = f"po_{pi:05d}"
        vendor_id = po["vendor"]
        po_items = [items[n] for n in po["items"] if n in items]
        po_doc = {
            "id": po_id, "type": "PO", "bpiDoc": None, "vendor": vendor_id,
            "date": po["created"][:10], "status": "issued",
            "lines": [{"lineNo": j, "bpiItem": it["trace"], "itemType": it["itemType"],
                       "category": it["category"], "spend": it["spend"], "subSpend": it["subSpend"],
                       "qty": "1", "valueEUR": it["value"], "grBased": it["grBased"],
                       "goodsReceipt": it["goodsReceipt"]} for j, it in enumerate(po_items, 1)],
            "events": [{"act": e["act"], "ts": e["ts"]} for it in po_items for e in it["events"] if e["act"] in ACT_PO],
        }
        documents.append(po_doc)
        doc_id_of[po_id] = True
        # derive downstream docs per PO-item
        seen_gr = seen_inv = seen_clear = 0
        for it in po_items:
            for e in it["events"]:
                if e["act"] in ACT_GR:
                    seen_gr += 1
                    did = f"grn_{po_id}_{seen_gr}"
                    documents.append({"id": did, "type": "GRN", "po": po_id, "bpiItem": it["trace"],
                                      "vendor": vendor_id, "date": e["ts"][:10], "valueEUR": e["eur"]})
                    links.append({"from": did, "to": po_id, "kind": "RECEIVES", "certainty": "CONFIRMED", "basis": "reference"})
                elif e["act"] in ACT_INV_IN | ACT_INV_REC:
                    seen_inv += 1
                    did = f"inv_{po_id}_{seen_inv}"
                    documents.append({"id": did, "type": "INVOICE_IN", "po": po_id, "bpiItem": it["trace"],
                                      "vendor": vendor_id, "date": e["ts"][:10], "valueEUR": e["eur"],
                                      "blocked": any(ev["act"] in ACT_BLOCK for ev in it["events"]),
                                      "act": e["act"]})
                    links.append({"from": did, "to": po_id, "kind": "BILLS", "certainty": "CONFIRMED", "basis": "reference"})
                elif e["act"] in ACT_CLEAR:
                    seen_clear += 1
                    did = f"pay_{po_id}_{seen_clear}"
                    target = f"inv_{po_id}_{max(seen_inv,1)}"
                    documents.append({"id": did, "type": "PAYMENT_OUT", "po": po_id, "bpiItem": it["trace"],
                                      "vendor": vendor_id, "date": e["ts"][:10], "valueEUR": e["eur"]})
                    links.append({"from": did, "to": target if seen_inv else po_id, "kind": "SETTLES", "certainty": "CONFIRMED", "basis": "reference"})
                elif e["act"] in ACT_CANCEL:
                    did = f"cancel_{po_id}_{it['item']}"
                    documents.append({"id": did, "type": "CANCEL_EVENT", "po": po_id, "bpiItem": it["trace"],
                                      "vendor": vendor_id, "date": e["ts"][:10], "act": e["act"]})

    out = {
        "meta": {"source": "BPI Challenge 2019 (van Dongen), CC BY 4.0 — real events, identities synthetic",
                 "companyCluster": company, "poCount": len(ordered), "docCount": len(documents),
                 "linkCount": len(links)},
        "companies": [{"bpiId": company, "itemTraces": len(wanted)}],
        "vendors": [{"id": v["id"], "bpiName": v["name"], "poCount": len(v["pos"]),
                     "topSpend": v["spends"].most_common(1)[0][0] if v["spends"] else None}
                    for v in vendors.values()],
        "documents": documents,
        "links": links,
    }
    out_path.parent.mkdir(exist_ok=True)
    with gzip.open(out_path, "wt", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(json.dumps(out["meta"], indent=2))
    return out["meta"]


if __name__ == "__main__":
    extract()
