import math


def epsilon_after_rounds(noise_multiplier, rounds, sample_rate=1.0, delta=1e-5):
    if not noise_multiplier or rounds <= 0:
        return None
    try:
        from opacus.accountants import RDPAccountant
        accountant = RDPAccountant()
        for _ in range(rounds):
            accountant.step(noise_multiplier=float(noise_multiplier), sample_rate=float(sample_rate))
        return float(accountant.get_epsilon(delta=float(delta)))
    except ImportError:
        return float(sample_rate * math.sqrt(2 * rounds * math.log(1 / delta)) / noise_multiplier + rounds * sample_rate * sample_rate / (noise_multiplier * noise_multiplier))


def noise_for_target_epsilon(target_epsilon, rounds, sample_rate=1.0, delta=1e-5):
    """Smallest noise multiplier whose epsilon stays at or under the target."""
    try:
        from opacus.accountants.utils import get_noise_multiplier
        return float(get_noise_multiplier(target_epsilon=float(target_epsilon),
                                          target_delta=float(delta),
                                          sample_rate=float(sample_rate),
                                          steps=int(rounds)))
    except ImportError:
        low, high = 0.05, 50.0
        for _ in range(40):
            mid = (low + high) / 2
            if epsilon_after_rounds(mid, rounds, sample_rate, delta) <= target_epsilon:
                high = mid
            else:
                low = mid
        return high
