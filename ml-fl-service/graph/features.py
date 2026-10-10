"""Per-institution graph features (plan §8.5).

Each bank computes dest_in_degree, dest_out_degree and orig_pagerank on ITS OWN
transaction subgraph only — raw counterparties never cross institutions. The
three placeholder columns in the processed frame are filled in place per client
partition, and on the global test split per-institution (each institution scores
its own test rows against its own graph).
"""
import argparse
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd

from data.schema import SCHEMAS
from settings import settings

GRAPH_COLUMNS = ["dest_in_degree", "dest_out_degree", "orig_pagerank"]


def _graph_lookup(frame, source_col="customer_id", target_col="counterparty_id"):
    graph = nx.DiGraph()
    graph.add_edges_from(frame[[source_col, target_col]].itertuples(index=False, name=None))
    return {
        "in_degree": dict(graph.in_degree()),
        "out_degree": dict(graph.out_degree()),
        "pagerank": nx.pagerank(graph) if graph.number_of_nodes() else {},
    }


def _apply_lookup(frame, lookup, source_col="customer_id", target_col="counterparty_id"):
    result = frame.copy()
    result["dest_in_degree"] = result[target_col].map(lookup["in_degree"]).fillna(0).astype(np.float32)
    result["dest_out_degree"] = result[target_col].map(lookup["out_degree"]).fillna(0).astype(np.float32)
    result["orig_pagerank"] = result[source_col].map(lookup["pagerank"]).fillna(0).astype(np.float32)
    return result


def fill_client(root, client, schema):
    directory = root / "client_{}".format(client)
    train = pd.read_parquet(directory / "train.parquet")
    validation = pd.read_parquet(directory / "val.parquet")
    # One institution derives its graph only from its local training ledger.
    lookup = _graph_lookup(train, schema.id_col, "counterparty_id")
    train = _apply_lookup(train, lookup, schema.id_col, "counterparty_id")
    validation = _apply_lookup(validation, lookup, schema.id_col, "counterparty_id")
    train.to_parquet(directory / "train.parquet", index=False)
    validation.to_parquet(directory / "val.parquet", index=False)
    return {"client": client, "train_rows": len(train), "validation_history": "train_only",
            "nonzero_dest_in_degree": float((train["dest_in_degree"] > 0).mean())}


def fill_test(root, schema):
    path = root / "test.parquet"
    test = pd.read_parquet(path)
    parts = []
    for institution, group in test.groupby(schema.client_col):
        directory = root / "client_{}".format(int(institution))
        history = pd.concat([pd.read_parquet(directory / "train.parquet"),
                             pd.read_parquet(directory / "val.parquet")], ignore_index=True)
        lookup = _graph_lookup(history, schema.id_col, "counterparty_id")
        parts.append(_apply_lookup(group, lookup, schema.id_col, "counterparty_id"))
    pd.concat(parts).sort_index().to_parquet(path, index=False)
    return {"test_rows": len(test), "test_graph_history": "client_train_and_validation_only"}


def run(key="paysim_banks", clients=5):
    schema = SCHEMAS[key]
    root = Path(settings.PARTITIONS_DIR) / key / "hfl_{}".format(clients)
    report = [fill_client(root, client, schema) for client in range(clients)]
    report.append(fill_test(root, schema))
    return {"dataset": key, "partitions": report}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="paysim_banks")
    parser.add_argument("--clients", type=int, default=5)
    arguments = parser.parse_args()
    print(run(arguments.dataset, arguments.clients))
