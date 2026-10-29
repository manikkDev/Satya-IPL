"""One-to-one assignment via Hungarian algorithm on match probabilities.

Only assigns pairs inside the prediction set and at/above the threshold —
ambiguous cells are left unassigned rather than forced.
"""
import numpy as np
from scipy.optimize import linear_sum_assignment


def assign(prob_matrix, anchors, pool, threshold=0.7):
    """prob_matrix[i][j] = P(anchor_i matches pool_j) or None.

    Returns assignments [{anchorId, candidateId, probability}] — one-to-one,
    only where probability >= threshold.
    """
    anchors, pool = list(anchors), list(pool)
    if not anchors or not pool:
        return {"assignments": [], "unassigned_anchors": [a["id"] for a in anchors],
                "unassigned_pool": [p["id"] for p in pool]}
    cost = np.full((len(anchors), len(pool)), 10.0)  # effectively infinite
    probs = np.zeros_like(cost)
    for i, a in enumerate(anchors):
        for j, p in enumerate(pool):
            val = prob_matrix.get((a["id"], p["id"]))
            if val is not None and val >= threshold:
                cost[i, j] = -np.log(max(val, 1e-9))
                probs[i, j] = val
    rows, cols = linear_sum_assignment(cost)
    assignments = []
    used_rows, used_cols = set(), set()
    for i, j in zip(rows, cols):
        if probs[i, j] >= threshold:
            assignments.append({"anchorId": anchors[i]["id"],
                                "candidateId": pool[j]["id"],
                                "probability": str(round(float(probs[i, j]), 4))})
            used_rows.add(i)
            used_cols.add(j)
    return {"assignments": assignments,
            "unassigned_anchors": [anchors[i]["id"] for i in range(len(anchors)) if i not in used_rows],
            "unassigned_pool": [pool[j]["id"] for j in range(len(pool)) if j not in used_cols]}
