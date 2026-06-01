"""JSON serialisation for tool results.

Tools return JSON strings (like the TS executors). Warehouse rows can contain
Decimal / datetime / date values that the stdlib json encoder can't handle, so
we coerce them here.
"""
from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any


def _default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def dumps(obj: Any) -> str:
    return json.dumps(obj, default=_default)
