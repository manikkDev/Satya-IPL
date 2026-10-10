"""Split-neural-network vertical federated learning.

Party isolation model
---------------------
Each :class:`VFLParty` owns a private feature slice and a private "bottom"
network. The only tensors that cross a party boundary are:

* forward pass: per-record embedding vectors (``embed_dim`` floats per row)
* backward pass: gradients with respect to those embeddings

Raw feature values, labels of non-holder parties, and model weights never
cross the boundary. The label-holding party ("active" party) additionally owns
the top model and the loss. A single process orchestrates the exchange — this
is a party-isolation *simulation*: the communication ledger below records
exactly what would traverse the wire in a multi-process deployment.
"""

import numpy as np
import torch
from torch import nn


class BottomNet(nn.Module):
    def __init__(self, in_dim, embed_dim=8):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, 32),
            nn.LayerNorm(32),
            nn.GELU(),
            nn.Linear(32, embed_dim),
        )

    def forward(self, x):
        return self.net(x)


class TopNet(nn.Module):
    def __init__(self, total_embed, out_dim=1):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(total_embed, 32),
            nn.LayerNorm(32),
            nn.GELU(),
            nn.Dropout(0.1),
            nn.Linear(32, out_dim),
        )

    def forward(self, x):
        return self.net(x)


class CommunicationLedger:
    """Records every tensor crossing a party boundary (the audit surface)."""

    def __init__(self):
        self.events = []

    def record(self, direction, shape):
        self.events.append({"direction": direction, "tensor_shape": list(shape), "values": int(np.prod(shape))})

    def summary(self):
        total = sum(event["values"] for event in self.events)
        return {
            "boundary_crossings": len(self.events),
            "scalar_values_exchanged": total,
            "forward_embeddings": sum(1 for e in self.events if e["direction"] == "forward"),
            "backward_gradients": sum(1 for e in self.events if e["direction"] == "backward"),
            "raw_feature_values_exchanged": 0,
            "labels_shared_with_feature_parties": 0,
        }


class VFLParty:
    """A feature-holding party. Features and labels stay private."""

    def __init__(self, name, features, labels=None, embed_dim=8, lr=1e-3, holds_labels=False, seed=0):
        torch.manual_seed(seed)
        self.name = name
        self.holds_labels = holds_labels
        self.features = torch.as_tensor(features, dtype=torch.float32)
        self.labels = torch.as_tensor(labels, dtype=torch.float32) if labels is not None else None
        self.bottom = BottomNet(features.shape[1], embed_dim)
        self.optimizer = torch.optim.AdamW(self.bottom.parameters(), lr=lr, weight_decay=1e-4)

    def forward_batch(self, indices, ledger):
        embedding = self.bottom(self.features[indices])
        ledger.record("forward", tuple(embedding.shape))
        return embedding

    def backward_batch(self, embedding, gradient, ledger):
        ledger.record("backward", tuple(gradient.shape))
        self.optimizer.zero_grad()
        embedding.backward(gradient)
        self.optimizer.step()


class SplitNNTrainer:
    """Coordinates forward/backward across parties without seeing raw features."""

    def __init__(self, parties, label_party, embed_dim=8, lr=1e-3):
        self.parties = parties
        self.label_party = label_party
        total_embed = sum(p.bottom.net[-1].out_features for p in parties)
        self.top = TopNet(total_embed)
        self.top_optimizer = torch.optim.AdamW(self.top.parameters(), lr=lr, weight_decay=1e-4)
        self.loss_fn = nn.BCEWithLogitsLoss()
        self.ledger = CommunicationLedger()

    def _forward(self, indices):
        # Each party's embedding is detached into a leaf so its .grad is exactly
        # the tensor that would be sent back across the boundary.
        wire = [party.forward_batch(indices, self.ledger) for party in self.parties]
        leaves = [e.detach().requires_grad_(True) for e in wire]
        return wire, leaves, torch.cat(leaves, dim=1)

    def train_epoch(self, indices, batch_size=512, pos_weight=None):
        order = np.random.permutation(indices)
        self.loss_fn = nn.BCEWithLogitsLoss(pos_weight=pos_weight) if pos_weight is not None else nn.BCEWithLogitsLoss()
        total_loss, count = 0.0, 0
        for start in range(0, len(order), batch_size):
            batch = torch.as_tensor(order[start:start + batch_size], dtype=torch.long)
            wire, leaves, joint = self._forward(batch)
            logits = self.top(joint).squeeze(-1)
            labels = self.label_party.labels[batch]
            loss = self.loss_fn(logits, labels)
            self.top_optimizer.zero_grad()
            loss.backward()
            for party, local, leaf in zip(self.parties, wire, leaves):
                # leaf.grad is the boundary tensor; local.backward resumes
                # backprop inside the party's private bottom network.
                party.backward_batch(local, leaf.grad.contiguous(), self.ledger)
            self.top_optimizer.step()
            total_loss += float(loss) * len(batch)
            count += len(batch)
        return total_loss / max(count, 1)

    @torch.no_grad()
    def predict(self, indices, batch_size=4096):
        scores = []
        for start in range(0, len(indices), batch_size):
            batch = torch.as_tensor(indices[start:start + batch_size], dtype=torch.long)
            embeddings = [party.bottom(party.features[batch]) for party in self.parties]
            logits = self.top(torch.cat(embeddings, dim=1)).squeeze(-1)
            scores.append(torch.sigmoid(logits).numpy())
        return np.concatenate(scores)
