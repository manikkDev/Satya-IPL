"""Exact, explicit rounding and Indian currency words; no float inputs."""
from decimal import Decimal, ROUND_HALF_EVEN, ROUND_HALF_UP, localcontext

from pydantic import TypeAdapter

from .contracts_v2 import DecimalString

_DECIMAL = TypeAdapter(DecimalString)
_ONES = (
    "Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve "
    "Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen"
).split()
_TENS = "Zero Ten Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety".split()


def exact(value):
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("Money must be finite")
        _DECIMAL.validate_python(format(value, "f"))
        return value
    if not isinstance(value, str):
        raise TypeError("Money must be an exact decimal string or Decimal")
    return Decimal(_DECIMAL.validate_python(value))


def quantize(value, quantum, *, rounding=ROUND_HALF_UP):
    if rounding not in {ROUND_HALF_UP, ROUND_HALF_EVEN}:
        raise ValueError("Unsupported rounding policy")
    with localcontext() as context:
        context.prec = 50
        return exact(value).quantize(quantum, rounding=rounding)


def money(value, *, rounding=ROUND_HALF_UP):
    return quantize(value, Decimal("0.01"), rounding=rounding)


def round_rupee(value, *, rounding=ROUND_HALF_UP):
    return quantize(value, Decimal("1"), rounding=rounding)


def _words(number):
    if number < 20:
        return _ONES[number]
    if number < 100:
        return _TENS[number // 10] + (f" {_ONES[number % 10]}" if number % 10 else "")
    for divisor, unit in ((10000000, "Crore"), (100000, "Lakh"), (1000, "Thousand"), (100, "Hundred")):
        if number >= divisor:
            quotient, remainder = divmod(number, divisor)
            return f"{_words(quotient)} {unit}" + (f" {_words(remainder)}" if remainder else "")
    raise ValueError("Cannot spell amount")


def amount_in_words_inr(value):
    amount = money(value)
    sign = "Minus " if amount < 0 else ""
    with localcontext() as context:
        context.prec = 50
        paise_total = int(abs(amount) * 100)
    rupees, paise = divmod(paise_total, 100)
    text = f"{sign}Rupees {_words(rupees)}"
    if paise:
        text += f" and {_words(paise)} {'Paisa' if paise == 1 else 'Paise'}"
    return text + " Only"
