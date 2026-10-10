from vertical.psi import Party, intersect_many


def test_private_intersection_matches_plain_set_intersection():
    values = intersect_many([Party(["a", "b", "c", "d"]), Party(["b", "c", "e"]), Party(["c", "b", "f"])])
    assert values == ["b", "c"]
