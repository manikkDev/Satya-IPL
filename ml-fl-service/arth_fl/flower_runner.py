"""Launch real Flower runs as supervised subprocesses.

``flwr run`` spins up the SimulationEngine: every institution is a separate
Ray actor process that reads only its own partition, while this module just
supervises the run (start/stop/status) and surfaces the metrics.jsonl the
ServerApp writes — the same contract the in-process runner exposes, so the
existing ``/fl/status`` and ``/fl/stream`` endpoints work unchanged.
"""
import json
import os
import subprocess
import sys
import threading
import uuid
from pathlib import Path

from settings import settings

SERVICE_DIR = Path(__file__).resolve().parent.parent

FEDERATIONS = {5: "local-sim", 3: "local-sim-3", 2: "local-sim-2"}

RUN_CONFIG_KEYS = [
    "run-id", "dataset", "model", "strategy", "num-server-rounds", "local-epochs",
    "learning-rate", "batch-size", "proximal-mu", "server-lr", "fraction-train",
    "clients", "client-sample-cap", "val-sample-cap", "seed",
    "dp-enabled", "dp-noise-multiplier", "dp-clipping-norm", "dp-delta",
    "secagg-enabled", "num-shares", "reconstruction-threshold", "max-weight",
    "secagg-clipping-range", "secagg-quantization-range", "secagg-modulus-range",
    "secagg-timeout", "partitions-dir", "runs-dir", "norm-stats-file", "hfl-dir",
]


def _toml(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return '"{}"'.format(str(value).replace('"', '\\"'))


def _flower_python():
    """Interpreter for the Flower driver.

    Ray spawns workers through an unquoted ``bash -c 'exec <python> ...'``, so
    the interpreter path must not contain spaces. Order: FLOWER_PYTHON env →
    current interpreter (if already space-free) → known space-free venv
    mirrors → current interpreter (will fail loudly in flower.log).
    """
    if settings.FLOWER_PYTHON:
        return settings.FLOWER_PYTHON
    exe = str(sys.executable)
    if " " not in exe:
        return exe
    candidates = [
        SERVICE_DIR.parent / "flvenv" / "bin" / "python",
        Path.home() / "arth_link" / "flvenv" / "bin" / "python",
        Path("/tmp/flvenv/bin/python"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return exe


class FlowerJobs:
    def __init__(self):
        self.jobs = {}
        self.lock = threading.Lock()

    def start(self, config):
        run_id = config.get("run-id") or "flwr_{}".format(uuid.uuid4().hex[:8])
        config = {**config, "run-id": run_id,
                  "runs-dir": config.get("runs-dir") or settings.RUNS_DIR,
                  "partitions-dir": config.get("partitions-dir") or settings.PARTITIONS_DIR,
                  "progress-webhook": settings.PROGRESS_WEBHOOK}
        clients = int(config.get("clients", 5))
        overrides = " ".join(
            "{}={}".format(key, _toml(config[key]))
            for key in RUN_CONFIG_KEYS + ["progress-webhook"]
            if config.get(key) is not None
        )
        directory = Path(settings.RUNS_DIR) / run_id
        directory.mkdir(parents=True, exist_ok=True)
        log_handle = (directory / "flower.log").open("w")
        # Ray spawns workers through an unquoted `bash -c 'exec <python> ...'`;
        # when this venv lives under a path with spaces, FLOWER_PYTHON must point
        # at a space-free interpreter (e.g. an APFS clone of .venv). The
        # simulate.py driver additionally patches sys.executable to a generated
        # wrapper as a fallback.
        python = _flower_python()
        bin_dir = Path(python).parent
        env = {**os.environ, "PATH": "{}{}{}".format(bin_dir, os.pathsep, os.environ.get("PATH", ""))}
        num_supernodes = str(clients)
        process = subprocess.Popen(
            [python, "-m", "arth_fl.simulate", "--app", ".",
             "--num-supernodes", num_supernodes, "--run-config", overrides],
            cwd=str(SERVICE_DIR), stdout=log_handle, stderr=subprocess.STDOUT, env=env,
        )
        job = {"run_id": run_id, "status": "running", "config": config,
               "process": process, "log_handle": log_handle, "error": None, "engine": "flower"}
        with self.lock:
            self.jobs[run_id] = job

        def watch():
            code = process.wait()
            log_handle.close()
            summary = directory / "summary.json"
            if job["status"] == "stopped":
                return
            if code == 0 and summary.exists():
                job["status"] = "finished"
                try:
                    from arth_fl.finalize import finalize
                    finalize(run_id, dataset=config.get("dataset", "paysim_banks"), clients=clients)
                except Exception as error:  # artifact usable raw; flag it
                    job["error"] = "finalize failed: {}".format(error)
            elif code == 0:
                job["status"] = "failed"
                job["error"] = "flower exited cleanly but produced no summary; see flower.log"
            else:
                job["status"] = "failed"
                job["error"] = "flwr exited with code {}; see {}".format(code, directory / "flower.log")

        threading.Thread(target=watch, daemon=True).start()
        return run_id

    def stop(self, run_id):
        job = self.jobs.get(run_id)
        if not job or job["status"] != "running":
            return False
        job["status"] = "stopped"
        job["process"].terminate()
        try:
            job["process"].wait(timeout=10)
        except subprocess.TimeoutExpired:
            job["process"].kill()
        return True

    def status(self, run_id):
        job = self.jobs.get(run_id)
        if job:
            directory = Path(settings.RUNS_DIR) / run_id
            metrics = directory / "metrics.jsonl"
            events = [json.loads(line) for line in metrics.read_text().splitlines() if line.strip()] if metrics.exists() else []
            summary_path = directory / "summary.json"
            return {
                "run_id": run_id,
                "engine": "flower",
                "status": job["status"],
                "config": job["config"],
                "rounds": [event for event in events if event.get("event") == "round"],
                "final": json.loads(summary_path.read_text()) if summary_path.exists() else None,
                "error": job.get("error"),
            }
        return None


flower_jobs = FlowerJobs()
