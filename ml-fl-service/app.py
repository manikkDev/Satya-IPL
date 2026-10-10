import asyncio
import json
from pathlib import Path
from typing import Literal, Optional

import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from arth_fl.dp_accounting import epsilon_after_rounds, noise_for_target_epsilon
from arth_fl.federated import jobs
from arth_fl.flower_runner import flower_jobs
from data.schema import SCHEMAS
from models.inference import available_runs, citizen_profile, customer_detail, customer_sample, fairness_report, resolve_run, score_frame
from settings import settings

app = FastAPI(title="Arth Saathi ML/FL Service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


def internal(x_internal_token: str = Header(default="")):
    if not settings.NODE_INTERNAL_TOKEN or x_internal_token != settings.NODE_INTERNAL_TOKEN:
        raise HTTPException(401, "Invalid internal token")


class FLStartRequest(BaseModel):
    dataset: Literal["paysim_banks", "gmsc"] = "paysim_banks"
    engine: Literal["local", "flower"] = "local"
    strategy: Literal["fedavg", "fedprox", "fedadam"] = "fedprox"
    model: Literal["residual_mlp_v1", "legacy_mlp_v1"] = "residual_mlp_v1"
    rounds: int = Field(8, ge=1, le=50)
    local_epochs: int = Field(1, ge=1, le=5)
    dp_enabled: bool = False
    dp_noise_multiplier: float = Field(0.45, gt=0)
    dp_clipping_norm: float = Field(2.0, gt=0)
    target_epsilon: Optional[float] = Field(None, gt=0)
    secagg_enabled: bool = True
    fraction_train: float = Field(1.0, gt=0, le=1.0)
    proximal_mu: float = Field(0.05, ge=0)
    server_lr: float = Field(0.05, gt=0)
    learning_rate: float = Field(3e-3, gt=0)
    batch_size: int = Field(512, ge=16, le=8192)
    client_sample_cap: int = Field(60000, ge=1000)
    val_sample_cap: int = Field(50000, ge=1000)
    run_id: Optional[str] = Field(None, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$")


class PredictRequest(BaseModel):
    run_id: Optional[str] = None
    dataset: str = "paysim_banks"
    rows: list[dict]
    explain: bool = False


@app.get("/")
def root():
    return {"service": "ml-fl-service", "status": "ready", "capabilities": ["baselines", "horizontal_fl", "flower_secagg_plus", "dp_accounting", "explainability", "fairness", "graph", "vfl_splitnn_showcase"]}


@app.get("/health")
def health():
    return {"ok": True, "service": "ml-fl-service", "phase": "demo-complete", "port": settings.PORT, "model_ready": bool(available_runs())}


@app.get("/datasets", dependencies=[Depends(internal)])
def datasets():
    root_path = Path(settings.PARTITIONS_DIR)
    output = []
    for key, schema in SCHEMAS.items():
        for partition in sorted((root_path / key).glob("hfl_*")):
            metadata = partition / "meta.json"
            if metadata.exists():
                output.append({"dataset": key, "task": schema.task, "partition": partition.name, "meta": json.loads(metadata.read_text())})
    return output


@app.post("/fl/start", dependencies=[Depends(internal)], status_code=202)
def start_federated(request: FLStartRequest):
    config = {
        "dataset": request.dataset,
        "strategy": request.strategy,
        "model": request.model,
        "num-server-rounds": request.rounds,
        "local-epochs": request.local_epochs,
        "dp-enabled": request.dp_enabled,
        "dp-noise-multiplier": request.dp_noise_multiplier,
        "dp-clipping-norm": request.dp_clipping_norm,
        "target-epsilon": request.target_epsilon,
        "secagg-enabled": request.secagg_enabled,
        "fraction-train": request.fraction_train,
        "proximal-mu": request.proximal_mu,
        "server-lr": request.server_lr,
        "learning-rate": request.learning_rate,
        "batch-size": request.batch_size,
        "client-sample-cap": request.client_sample_cap,
        "val-sample-cap": request.val_sample_cap,
        "run-id": request.run_id,
    }
    if request.engine == "flower":
        return {"run_id": flower_jobs.start(config), "status": "running", "engine": "flower"}
    return {"run_id": jobs.start(config), "status": "running", "engine": "local"}


@app.post("/fl/stop/{run_id}", dependencies=[Depends(internal)])
def stop_federated(run_id: str):
    if run_id in flower_jobs.jobs:
        return {"ok": flower_jobs.stop(run_id)}
    return {"ok": jobs.stop(run_id)}


@app.get("/fl/status/{run_id}", dependencies=[Depends(internal)])
def federated_status(run_id: str):
    flower_status = flower_jobs.status(run_id)
    status = flower_status if flower_status is not None else jobs.status(run_id)
    if status["status"] == "unknown":
        raise HTTPException(404, "run not found: {}".format(run_id))
    return status


@app.get("/fl/runs", dependencies=[Depends(internal)])
def federated_runs():
    return [{"run_id": item["run_id"], "config": item["config"], "final": item["final"], "privacy": item.get("privacy"), "status": "finished"} for item in available_runs()]


@app.get("/fl/stream/{run_id}", dependencies=[Depends(internal)])
async def federated_stream(run_id: str):
    path = Path(settings.RUNS_DIR) / run_id / "metrics.jsonl"
    async def events():
        position = 0
        while True:
            if path.exists():
                text = path.read_text()
                update = text[position:]
                position = len(text)
                for line in update.splitlines():
                    yield {"event": "progress", "data": line}
                    if '"event": "end"' in line or '"event":"end"' in line:
                        return
            flower_status = flower_jobs.status(run_id)
            status = (flower_status or jobs.status(run_id))["status"]
            if status in {"failed", "stopped"}:
                yield {"event": "progress", "data": json.dumps({"event": status, "run_id": run_id})}
                return
            await asyncio.sleep(1)
    return EventSourceResponse(events())


@app.get("/fl/summary", dependencies=[Depends(internal)])
def summary():
    runs_root = Path(settings.RUNS_DIR)
    baseline_path = runs_root / "baselines_paysim_banks.json"
    vfl_path = runs_root / "vfl_demo" / "summary.json"
    tradeoff_path = runs_root / "privacy_tradeoff.json"
    runs = available_runs()
    latest = None
    try:
        _, latest = resolve_run()
    except FileNotFoundError:
        latest = {key: value for key, value in runs[0].items() if key != "mtime"} if runs else None
    return {
        "baselines": json.loads(baseline_path.read_text()) if baseline_path.exists() else None,
        "federated": [{key: value for key, value in item.items() if key != "mtime"} for item in runs],
        "latest": latest,
        "vfl": json.loads(vfl_path.read_text()) if vfl_path.exists() else None,
        "privacy_tradeoff": json.loads(tradeoff_path.read_text()) if tradeoff_path.exists() else None,
    }


@app.get("/vfl/summary", dependencies=[Depends(internal)])
def vfl_summary():
    vfl_path = Path(settings.RUNS_DIR) / "vfl_demo" / "summary.json"
    if not vfl_path.exists():
        raise HTTPException(404, "VFL demo has not been seeded yet")
    return json.loads(vfl_path.read_text())


@app.get("/privacy/tradeoff", dependencies=[Depends(internal)])
def privacy_tradeoff():
    tradeoff_path = Path(settings.RUNS_DIR) / "privacy_tradeoff.json"
    if not tradeoff_path.exists():
        raise HTTPException(404, "Privacy tradeoff has not been seeded yet")
    return json.loads(tradeoff_path.read_text())


@app.get("/privacy/epsilon", dependencies=[Depends(internal)])
def privacy_epsilon(noise: float = 0.45, rounds: int = 8, delta: float = 1e-5,
                  fraction_train: float = 1.0, target_epsilon: Optional[float] = None):
    if target_epsilon is not None:
        noise = noise_for_target_epsilon(target_epsilon, rounds, fraction_train, delta)
    return {"epsilon": epsilon_after_rounds(noise, rounds, fraction_train, delta), "delta": delta,
            "noise_multiplier": noise, "rounds": rounds, "fraction_train": fraction_train,
            "scope": "client-update central DP estimate (RDP accountant)"}


def _not_found(error):
    raise HTTPException(404, str(error))


@app.post("/predict", dependencies=[Depends(internal)])
def predict(request: PredictRequest):
    frame = pd.DataFrame(request.rows)
    schema = SCHEMAS[request.dataset]
    for column in schema.numeric:
        if column not in frame:
            frame[column] = 0.0
    for column in schema.categorical:
        if column not in frame:
            frame[column] = "PAYMENT"
    frame[schema.target] = 0
    try:
        return score_frame(frame, request.run_id, request.dataset, request.explain)
    except FileNotFoundError as error:
        _not_found(error)


@app.get("/customers/{dataset}/{run_id}/sample", dependencies=[Depends(internal)])
def customers(dataset: str, run_id: str, n: int = 50, client_id: Optional[int] = None):
    try:
        return customer_sample(None if run_id == "latest" else run_id, dataset, n, client_id)
    except FileNotFoundError as error:
        _not_found(error)


@app.get("/customers/{dataset}/{run_id}/{customer_id}", dependencies=[Depends(internal)])
def customer(dataset: str, run_id: str, customer_id: str, client_id: Optional[int] = None):
    try:
        return customer_detail(customer_id, None if run_id == "latest" else run_id, dataset, client_id)
    except FileNotFoundError as error:
        _not_found(error)
    except LookupError as error:
        _not_found(error)


@app.get("/citizen/{customer_ref}", dependencies=[Depends(internal)])
def citizen(customer_ref: str, run_id: Optional[str] = None):
    try:
        return citizen_profile(customer_ref, run_id)
    except FileNotFoundError as error:
        _not_found(error)


@app.get("/fairness", dependencies=[Depends(internal)])
def fairness(run_id: Optional[str] = None):
    try:
        return fairness_report(run_id)
    except FileNotFoundError as error:
        _not_found(error)


@app.post("/graph/seed", dependencies=[Depends(internal)])
def seed_graph(run_id: Optional[str] = None, max_rows: int = 15000):
    from graph.ingest import ingest
    return ingest(run_id, max_rows)
