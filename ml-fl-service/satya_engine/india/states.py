import json
from functools import lru_cache
from pathlib import Path

ASSET = Path(__file__).resolve().parents[2] / "assets" / "gst_state_codes.json"


@lru_cache(maxsize=1)
def _states():
    return {entry["code"]: entry for entry in json.loads(ASSET.read_text())["states"]}


def state_for(code):
    entry = _states().get(code)
    return dict(entry) if entry is not None else None
