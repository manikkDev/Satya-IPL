import json
import time
from pathlib import Path

import httpx


class Progress:
    def __init__(self, runs_dir, run_id, webhook="", token=""):
        self.directory = Path(runs_dir) / run_id
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / "metrics.jsonl"
        self.webhook = webhook
        self.token = token

    def emit(self, payload):
        event = {"ts": time.time(), **payload}
        with self.path.open("a") as handle:
            handle.write(json.dumps(event, default=float) + "\n")
        if self.webhook:
            try:
                httpx.post(self.webhook, json=event, headers={"x-internal-token": self.token}, timeout=2)
            except Exception:
                pass
        return event
