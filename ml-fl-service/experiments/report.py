import json
from pathlib import Path

from models.common import save_json
from models.inference import available_runs
from settings import settings


def build_report():
    root = Path(settings.RUNS_DIR)
    baseline = root / "baselines_paysim_banks.json"
    vfl = root / "vfl_demo" / "summary.json"
    payload = {
        "baselines": json.loads(baseline.read_text()) if baseline.exists() else None,
        "federated": [{key: value for key, value in run.items() if key != "mtime"} for run in available_runs()],
        "vfl": json.loads(vfl.read_text()) if vfl.exists() else None,
    }
    save_json(root / "summary.json", payload)
    return payload


if __name__ == "__main__":
    print(build_report())
