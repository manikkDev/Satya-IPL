"""Torch MLP shared across the federated runner, baselines and calibration.

Parameter convention: a deterministic flat vector packed from the model state
mapping in registration order. The saved artifact also records its architecture,
so legacy and residual models can be loaded without ambiguity.
"""
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

HIDDEN_LAYERS = (48, 24)
RESIDUAL_DIM = 64


def layer_sizes(n_features):
    return [n_features, *HIDDEN_LAYERS, 1]


class RiskMLP(nn.Module):
    def __init__(self, n_features, hidden=HIDDEN_LAYERS):
        super().__init__()
        sizes = layer_sizes(n_features)
        layers = []
        for index in range(len(sizes) - 1):
            layers.append(nn.Linear(sizes[index], sizes[index + 1]))
            if index < len(sizes) - 2:
                layers.append(nn.ReLU())
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x).squeeze(-1)


class ResidualBlock(nn.Module):
    def __init__(self, width, dropout=0.1):
        super().__init__()
        self.norm = nn.LayerNorm(width)
        self.layers = nn.Sequential(
            nn.Linear(width, width * 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(width * 2, width),
            nn.Dropout(dropout),
        )

    def forward(self, x):
        return x + self.layers(self.norm(x))


class ResidualRiskNet(nn.Module):
    def __init__(self, n_features, width=RESIDUAL_DIM, blocks=2, dropout=0.1):
        super().__init__()
        self.stem = nn.Sequential(nn.Linear(n_features, width), nn.LayerNorm(width), nn.GELU())
        self.blocks = nn.ModuleList([ResidualBlock(width, dropout) for _ in range(blocks)])
        self.head = nn.Sequential(
            nn.LayerNorm(width),
            nn.Linear(width, width // 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(width // 2, 1),
        )

    def forward(self, x):
        hidden = self.stem(x)
        for block in self.blocks:
            hidden = block(hidden)
        return self.head(hidden).squeeze(-1)


def build_model(n_features, seed=0, architecture="residual_mlp_v1"):
    torch.manual_seed(seed)
    if architecture == "legacy_mlp_v1":
        return RiskMLP(n_features)
    if architecture == "residual_mlp_v1":
        return ResidualRiskNet(n_features)
    raise ValueError("Unknown model architecture {}".format(architecture))


def pack_state(model):
    values = [tensor.detach().cpu().numpy().ravel() for tensor in model.state_dict().values()]
    return np.concatenate(values).astype(np.float64)


def unpack_state(model, vector):
    vector = np.asarray(vector, dtype=np.float64)
    restored = {}
    offset = 0
    for name, tensor in model.state_dict().items():
        count = tensor.numel()
        if offset + count > vector.size:
            raise ValueError("Model artifact is shorter than the selected architecture")
        restored[name] = torch.tensor(vector[offset : offset + count].reshape(tuple(tensor.shape)), dtype=tensor.dtype)
        offset += count
    if offset != vector.size:
        raise ValueError("Model artifact size does not match the selected architecture")
    model.load_state_dict(restored)
    return model


def unpack_legacy_state(model, vector):
    vector = np.asarray(vector, dtype=np.float64)
    layers = [layer for layer in model.net if isinstance(layer, nn.Linear)]
    offset = 0
    for layer in layers:
        count = layer.in_features * layer.out_features
        weight = vector[offset : offset + count].reshape(layer.in_features, layer.out_features)
        layer.weight.data = torch.tensor(weight.T, dtype=torch.float32)
        offset += count
    for layer in layers:
        count = layer.out_features
        layer.bias.data = torch.tensor(vector[offset : offset + count], dtype=torch.float32)
        offset += count
    if offset != vector.size:
        raise ValueError("Legacy model artifact size does not match its architecture")
    return model


def train_local(matrix, labels, global_vector, epochs, seed, proximal_mu=0.0,
                lr=3e-3, batch_size=512, pos_weight=None, architecture="residual_mlp_v1"):
    """One institution's local training. Returns the parameter *delta*.

    ``proximal_mu`` applies the true FedProx proximal term
    ``(mu / 2) * ||theta - theta_global||^2`` inside the loss.
    """
    torch.manual_seed(seed)
    model = unpack_state(build_model(matrix.shape[1], seed, architecture), global_vector)
    x = torch.tensor(matrix, dtype=torch.float32)
    y = torch.tensor(labels.astype(np.float32))
    loader = DataLoader(TensorDataset(x, y), batch_size=batch_size, shuffle=True,
                        generator=torch.Generator().manual_seed(seed))
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    if pos_weight is None:
        negative = max(1, int((labels == 0).sum()))
        positive = max(1, int((labels == 1).sum()))
        pos_weight = min(20.0, max(1.0, np.sqrt(negative / positive)))
    criterion = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(float(pos_weight)))
    global_params = [p.detach().clone() for p in model.parameters()]
    model.train()
    for _ in range(int(epochs)):
        for xb, yb in loader:
            loss = criterion(model(xb), yb)
            if proximal_mu:
                prox = sum(torch.sum((p - g) ** 2) for p, g in zip(model.parameters(), global_params))
                loss = loss + (proximal_mu / 2) * prox
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()
    return pack_state(model) - np.asarray(global_vector, dtype=np.float64)


def predict_logits(model, matrix):
    model.eval()
    with torch.no_grad():
        return model(torch.tensor(matrix, dtype=torch.float32)).numpy()


def predict_proba(model, matrix):
    return 1 / (1 + np.exp(-np.clip(predict_logits(model, matrix), -30, 30)))
