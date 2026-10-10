import argparse
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd
from neo4j import GraphDatabase

from models.inference import score_frame
from settings import settings


def chunks(frame, size=1000):
    for start in range(0, len(frame), size):
        yield frame.iloc[start : start + size].to_dict("records")


def ingest(run_id=None, max_rows=15000):
    import datetime
    source = pd.read_parquet(Path(settings.PARTITIONS_DIR) / "paysim_banks" / "hfl_5" / "test.parquet")
    frame = source.sample(min(max_rows, len(source)), random_state=42).copy()
    scored = score_frame(frame, run_id)
    frame["score"] = scored["risk_scores"]
    frame["band"] = scored["risk_band"]
    frame["flagged"] = (frame["score"] >= 0.95).astype(int)
    frame["_pagerank"] = frame["orig_pagerank"] if "orig_pagerank" in frame.columns else 0.0
    snapshot_id = "{}:{}".format(scored["run_id"], datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%S"))
    accounts = pd.concat([
        frame[["customer_id", "institution_id", "score", "band", "_pagerank"]].rename(columns={"customer_id": "pid"}),
        frame[["counterparty_id", "score", "band"]].assign(institution_id=-1, _pagerank=np.nan).rename(columns={"counterparty_id": "pid"}),
    ]).groupby("pid", as_index=False).agg(institution_id=("institution_id", "max"), score=("score", "max"), band=("band", "last"), pagerank=("_pagerank", "max"))
    accounts["pagerank"] = accounts["pagerank"].fillna(0.0)
    edges = frame.groupby(["customer_id", "counterparty_id"], as_index=False).agg(n_tx=("amount", "size"), total_amt=("amount", "sum"), max_amt=("amount", "max"), avg_risk=("score", "mean"), frac_flagged=("flagged", "mean")).rename(columns={"customer_id": "source", "counterparty_id": "target"})
    graph = nx.Graph()
    graph.add_weighted_edges_from((row.source, row.target, float(row.n_tx)) for row in edges.itertuples())
    communities = nx.community.louvain_communities(graph, weight="weight", seed=42)
    community_rows = [{"pid": pid, "cluster": cluster} for cluster, members in enumerate(communities) for pid in members]
    account_map = accounts.set_index("pid")["score"].to_dict()
    campaigns = []
    for cluster, members in enumerate(communities):
        scores = [account_map.get(pid, 0.0) for pid in members]
        campaigns.append({"id": cluster, "label": "Risk ring #{}".format(cluster + 1), "size": len(members), "avg_score": float(np.mean(scores)), "n_high": int(sum(score >= 0.95 for score in scores))})
    campaigns = sorted(campaigns, key=lambda item: (item["n_high"], item["avg_score"], item["size"]), reverse=True)[:25]
    campaign_ids = {item["id"] for item in campaigns}
    driver = GraphDatabase.driver(settings.NEO4J_URI, auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD))
    with driver.session() as session:
        session.run("CREATE CONSTRAINT acct_pid IF NOT EXISTS FOR (a:Account) REQUIRE a.pid IS UNIQUE")
        session.run("CREATE CONSTRAINT inst_id IF NOT EXISTS FOR (i:Institution) REQUIRE i.id IS UNIQUE")
        session.run("CREATE CONSTRAINT camp_id IF NOT EXISTS FOR (c:Campaign) REQUIRE c.id IS UNIQUE")
        session.run("CREATE INDEX acct_score IF NOT EXISTS FOR (a:Account) ON (a.risk_score)")
        # Provenance: wipe previous snapshots but keep their GraphSnapshot tombstones.
        session.run("MATCH (n:Account) DETACH DELETE n")
        session.run("MATCH (n:Campaign) DETACH DELETE n")
        session.run("UNWIND range(0,4) AS id MERGE (:Institution {id:id, name:'Bank ' + toString(id)})")
        session.run(
            "MERGE (s:GraphSnapshot {id:$sid}) SET s.run_id=$run_id, s.created_at=datetime(), "
            "s.source_split='official_test_uniform_sample', s.max_rows=$max_rows, s.label_blind_sample=true",
            sid=snapshot_id, run_id=scored["run_id"], max_rows=max_rows)
        for batch in chunks(accounts):
            session.run("UNWIND $rows AS row MERGE (account:Account {pid:row.pid}) SET account.risk_score=row.score, account.risk_band=row.band, account.institution_id=row.institution_id, account.pagerank=row.pagerank, account.snapshot_id=$sid WITH account,row WHERE row.institution_id >= 0 MATCH (institution:Institution {id:row.institution_id}) MERGE (account)-[:BELONGS_TO]->(institution)", rows=batch, sid=snapshot_id)
        for batch in chunks(edges):
            session.run("UNWIND $rows AS row MATCH (source:Account {pid:row.source}), (target:Account {pid:row.target}) MERGE (source)-[edge:TRANSFERRED_TO]->(target) SET edge.n_tx=row.n_tx, edge.total_amt=row.total_amt, edge.max_amt=row.max_amt, edge.avg_risk=row.avg_risk, edge.frac_flagged=row.frac_flagged, edge.snapshot_id=$sid", rows=batch, sid=snapshot_id)
        session.run("UNWIND $rows AS row MATCH (account:Account {pid:row.pid}) SET account.cluster_id=row.cluster", rows=community_rows)
        session.run("UNWIND $rows AS row MERGE (campaign:Campaign {id:row.id}) SET campaign.label=row.label, campaign.size=row.size, campaign.avg_score=row.avg_score, campaign.n_high=row.n_high, campaign.snapshot_id=$sid", rows=campaigns, sid=snapshot_id)
        session.run("MATCH (account:Account) WHERE account.cluster_id IN $ids MATCH (campaign:Campaign {id:account.cluster_id}) MERGE (account)-[:MEMBER_OF]->(campaign)", ids=list(campaign_ids))
        session.run("MATCH (s:GraphSnapshot {id:$sid}) SET s.account_count=$n_acc, s.edge_count=$n_edges, s.campaign_count=$n_camp",
                    sid=snapshot_id, n_acc=len(accounts), n_edges=len(edges), n_camp=len(campaigns))
    driver.close()
    return {"run_id": scored["run_id"], "snapshot_id": snapshot_id, "accounts": len(accounts),
            "edges": len(edges), "campaigns": len(campaigns),
            "selection": "uniform_without_target_labels", "raw_identifiers_written": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--max-rows", type=int, default=15000)
    arguments = parser.parse_args()
    print(ingest(arguments.run_id, arguments.max_rows))
