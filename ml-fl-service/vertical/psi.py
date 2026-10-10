import hashlib
import secrets

P = 2**255 - 19


def hashed(value):
    return int.from_bytes(hashlib.sha256(str(value).encode()).digest(), "big") % P


class Party:
    def __init__(self, identifiers):
        self.identifiers = [str(value) for value in identifiers]
        self.secret = secrets.randbelow(P - 2) + 2

    def first_round(self):
        return [pow(hashed(value), self.secret, P) for value in self.identifiers]

    def second_round(self, values):
        return [pow(value, self.secret, P) for value in values]


def intersect(left, right):
    left_masked = left.first_round()
    right_masked = right.first_round()
    left_double = set(right.second_round(left_masked))
    right_double = left.second_round(right_masked)
    return [identifier for identifier, value in zip(right.identifiers, right_double) if value in left_double]


def intersect_many(parties):
    shared = set(parties[0].identifiers)
    for party in parties[1:]:
        shared &= set(intersect(Party(sorted(shared)), party))
    return sorted(shared)
