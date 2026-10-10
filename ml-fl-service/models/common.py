import json
from pathlib import Path

import numpy as np
import pandas as pd

from data.schema import SCHEMAS

TYPE_VOCAB = ["CASH_IN", "CASH_OUT", "DEBIT", "PAYMENT", "TRANSFER"]
MODEL_NUMERIC = ["amount", "amt_log", "amt_to_bal_ratio", "oldbalanceOrg", "oldbalanceDest",
                 "hour", "is_night", "orig_tx_count_24", "orig_amt_sum_24",
                 "dest_in_degree", "dest_out_degree", "orig_pagerank"]


def numeric_columns(schema):
    selected = [column for column in MODEL_NUMERIC if column in schema.numeric]
    return selected or schema.numeric


def model_columns(schema):
    return [*numeric_columns(schema), *["type_{}".format(value) for value in TYPE_VOCAB]]


def sample_frame(frame, target, maximum, seed=42):
    if maximum is None or maximum <= 0 or len(frame) <= maximum:
        return frame.reset_index(drop=True)
    return frame.sample(n=int(maximum), random_state=seed).reset_index(drop=True)


def frame_to_matrix(frame, schema, mean=None, scale=None):
    numeric = frame[numeric_columns(schema)].fillna(0).to_numpy(np.float32)
    categories = np.column_stack([(frame["type"] == value).to_numpy(np.float32) for value in TYPE_VOCAB]) if "type" in schema.categorical else np.empty((len(frame), 0), np.float32)
    matrix = np.column_stack([numeric, categories]).astype(np.float32)
    if mean is not None and scale is not None:
        matrix = np.clip((matrix - mean) / scale, -12, 12).astype(np.float32)
    return matrix


def xy(frame, key, mean=None, scale=None):
    schema = SCHEMAS[key]
    return frame_to_matrix(frame, schema, mean, scale), frame[schema.target].to_numpy(np.int8)


def load_client(root, client, split="train", maximum=None, seed=42):
    frame = pd.read_parquet(Path(root) / "client_{}".format(client) / "{}.parquet".format(split))
    return sample_frame(frame, "isFraud", maximum, seed + client)


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, default=float) + "\n")
