"""Post-hoc temperature scaling for the federated model (plan §5.4).

Fit a single scalar T on pooled client validation logits so predicted
probabilities carry a meaningful confidence interpretation.
"""
import numpy as np
import torch


def fit_temperature(logits, labels, iters=200, lr=0.05):
    """Return the scalar T minimising NLL on validation logits."""
    logits_t = torch.tensor(np.asarray(logits), dtype=torch.float32)
    labels_t = torch.tensor(np.asarray(labels), dtype=torch.float32)
    temperature = torch.ones(1, requires_grad=True)
    optimizer = torch.optim.LBFGS([temperature], lr=lr, max_iter=iters)

    def closure():
        optimizer.zero_grad()
        loss = torch.nn.functional.binary_cross_entropy_with_logits(
            logits_t / temperature, labels_t)
        loss.backward()
        return loss

    optimizer.step(closure)
    return float(temperature.item())


def apply_temperature(logits, temperature):
    logits = np.asarray(logits, dtype=np.float64) / max(float(temperature), 1e-3)
    return 1 / (1 + np.exp(-np.clip(logits, -30, 30)))
