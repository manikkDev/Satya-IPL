"""Regular, PAN-based GSTIN syntax/checksum only; never registry status."""
import re

from .states import state_for

ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
REGULAR = re.compile(r"[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]")
PAN = re.compile(r"[A-Z]{5}[0-9]{4}[A-Z]")
ENTITY_HINTS = {
    "A": "association of persons", "B": "body of individuals", "C": "company",
    "F": "firm", "G": "government", "H": "Hindu undivided family",
    "J": "artificial juridical person", "L": "local authority", "P": "individual",
    "T": "trust",
}


def checksum(first_fourteen):
    if not re.fullmatch(r"[0-9A-Z]{14}", first_fourteen):
        raise ValueError("GSTIN checksum requires fourteen uppercase alphanumeric characters")
    total = 0
    for index, character in enumerate(first_fourteen):
        product = ALPHABET.index(character) * (1 if index % 2 == 0 else 2)
        total += product // 36 + product % 36
    return ALPHABET[(36 - total % 36) % 36]


def validate_gstin(gstin):
    shape = isinstance(gstin, str) and REGULAR.fullmatch(gstin) is not None
    state = state_for(gstin[:2]) if shape else None
    well_formed = bool(shape and state and state["registrationState"])
    return {
        "wellFormed": well_formed,
        "checksumValid": bool(shape and checksum(gstin[:14]) == gstin[-1]),
        "stateCode": gstin[:2] if shape else None,
        "panEmbedded": gstin[2:12] if shape else None,
        "entityTypeHint": ENTITY_HINTS.get(gstin[5], "unknown") if shape else None,
    }


def make_fictional_gstin(state, pan_stub):
    """Demo only. A checksummed synthetic ID is NOT proof it is unissued."""
    entry = state_for(state)
    if not entry or not entry["registrationState"] or not PAN.fullmatch(pan_stub):
        raise ValueError("Demo GSTIN requires a known registration state and PAN-shaped stub")
    prefix = f"{state}{pan_stub}1Z"
    return prefix + checksum(prefix)
