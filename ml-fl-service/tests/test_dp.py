from arth_fl.dp_accounting import epsilon_after_rounds


def test_epsilon_increases_with_rounds_and_decreases_with_noise():
    assert epsilon_after_rounds(2.0, 8) > epsilon_after_rounds(2.0, 4)
    assert epsilon_after_rounds(3.0, 8) < epsilon_after_rounds(2.0, 8)
