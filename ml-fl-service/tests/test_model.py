import numpy as np
import pytest

from arth_fl.dp_accounting import epsilon_after_rounds, noise_for_target_epsilon
from models.calibrate import apply_temperature, fit_temperature
from models.metrics import expected_calibration_error
from models.torch_mlp import build_model, layer_sizes, pack_state, predict_logits, train_local, unpack_state

N_FEATURES = 15


def _toy_data(seed=0, n=800):
    rng = np.random.default_rng(seed)
    x = rng.normal(0, 1, (n, N_FEATURES)).astype(np.float32)
    logits = x[:, 0] * 2.5 - x[:, 1] * 1.5 + rng.normal(0, 0.3, n)
    y = (logits > np.median(logits)).astype(np.int8)
    return x, y


def test_pack_unpack_roundtrip():
    model = build_model(N_FEATURES, seed=7)
    vector = pack_state(model)
    restored = unpack_state(build_model(N_FEATURES, seed=99), vector)
    assert np.allclose(pack_state(restored), vector)
    expected = sum(p.numel() for p in build_model(N_FEATURES).parameters())
    assert vector.size == expected
    assert len(layer_sizes(N_FEATURES)) >= 3


def test_train_local_improves_ranking():
    from sklearn.metrics import roc_auc_score

    x, y = _toy_data()
    model = build_model(N_FEATURES, seed=0)
    global_vector = pack_state(model)

    def auc(vec):
        m = unpack_state(build_model(N_FEATURES, seed=0), vec)
        return roc_auc_score(y, predict_logits(m, x))

    update = train_local(x, y, global_vector, epochs=2, seed=0, lr=5e-3, batch_size=256)
    assert auc(global_vector + update) > auc(global_vector) + 0.05


def test_fedprox_proximal_term_shrinks_updates():
    x, y = _toy_data()
    global_vector = pack_state(build_model(N_FEATURES, seed=3))
    free = train_local(x, y, global_vector, epochs=2, seed=5, proximal_mu=0.0, lr=5e-3, batch_size=256)
    tied = train_local(x, y, global_vector, epochs=2, seed=5, proximal_mu=2.0, lr=5e-3, batch_size=256)
    # A strong proximal penalty must keep the local model closer to the global one.
    assert np.linalg.norm(tied) < np.linalg.norm(free)


def test_temperature_calibration_finite_and_reasonable():
    x, y = _toy_data(n=2000)
    model = build_model(N_FEATURES, seed=0)
    update = train_local(x, y, pack_state(model), epochs=2, seed=0)
    model = unpack_state(model, pack_state(model) + update)
    logits = predict_logits(model, x)
    temperature = fit_temperature(logits, y)
    assert np.isfinite(temperature) and 0 < temperature < 50
    calibrated = apply_temperature(logits, temperature)
    assert np.all((calibrated >= 0) & (calibrated <= 1))
    ece = expected_calibration_error(y, calibrated)
    assert np.isfinite(ece) and 0 <= ece <= 1


def test_noise_for_target_epsilon_roundtrip():
    for target in (3.0, 8.0, 20.0):
        noise = noise_for_target_epsilon(target, rounds=8)
        eps = epsilon_after_rounds(noise, 8)
        assert eps == pytest.approx(target, rel=0.15)
