import pandas as pd

from data.augment import smote_client
from data.schema import GMSC


def _training_frame():
    rows = 40
    frame = pd.DataFrame({column: [float(index % 7) for index in range(rows)] for column in GMSC.numeric})
    frame[GMSC.target] = [0] * 32 + [1] * 8
    frame[GMSC.record_col] = list(range(rows))
    frame[GMSC.id_col] = ["customer_{}".format(index) for index in range(rows)]
    frame[GMSC.client_col] = 0
    frame["is_synthetic"] = 0
    frame["source_split"] = "train"
    return frame


def test_smote_labels_generated_rows_without_mutating_input():
    original = _training_frame()
    augmented = smote_client(original, "gmsc", target_positive_rate=0.30, seed=7)
    assert original["is_synthetic"].eq(0).all()
    assert len(augmented) > len(original)
    synthetic = augmented[augmented["is_synthetic"] == 1]
    assert not synthetic.empty
    assert synthetic[GMSC.id_col].str.startswith("synthetic_customer_").all()
    assert augmented.iloc[: len(original)][GMSC.record_col].tolist() == original[GMSC.record_col].tolist()
