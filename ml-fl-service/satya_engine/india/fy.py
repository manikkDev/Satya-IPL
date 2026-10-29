import re
from datetime import date, datetime
from zoneinfo import ZoneInfo


def fy_of(value):
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("A timestamp must carry an explicit timezone")
        value = value.astimezone(ZoneInfo("Asia/Kolkata")).date()
    elif isinstance(value, str):
        value = date.fromisoformat(value)
    if not isinstance(value, date):
        raise ValueError("Financial year requires a business date")
    year = value.year if value.month >= 4 else value.year - 1
    return f"{year:04d}-{(year + 1) % 100:02d}"


def fy_boundaries(fy):
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}", fy):
        raise ValueError("Use financial year YYYY-YY")
    year = int(fy[:4])
    if (year + 1) % 100 != int(fy[-2:]):
        raise ValueError("Financial year end must follow its start year")
    return date(year, 4, 1), date(year + 1, 4, 1)
