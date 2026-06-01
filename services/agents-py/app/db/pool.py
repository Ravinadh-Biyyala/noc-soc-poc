"""Async psycopg connection pool over the shared Postgres DB.

Mirrors `lib/db/src/index.ts` (a single master pool). Connections use
``autocommit=True`` + ``dict_row`` so single statements execute immediately and
rows come back as dicts; atomic work (e.g. transformation apply) uses an
explicit ``async with conn.transaction()`` block.
"""
from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Sequence

from psycopg.rows import dict_row
from psycopg.types.json import set_json_dumps
from psycopg_pool import AsyncConnectionPool

_pool: AsyncConnectionPool | None = None


def _json_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def _safe_json_dumps(obj: Any) -> str:
    return json.dumps(obj, default=_json_default)


# Warehouse rows put into JSONB columns (chart config.data, KPI values) routinely
# contain Decimal / date values that the stdlib json encoder rejects. Register a
# tolerant dumper globally so every psycopg Jsonb() adapter uses it.
set_json_dumps(_safe_json_dumps)


async def open_pool(database_url: str) -> AsyncConnectionPool:
    global _pool
    if _pool is not None:
        return _pool
    pool = AsyncConnectionPool(
        conninfo=database_url,
        min_size=1,
        max_size=10,
        open=False,
        kwargs={"autocommit": True, "row_factory": dict_row, "prepare_threshold": 0},
    )
    await pool.open()
    await pool.wait()
    _pool = pool
    return pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_pool() -> AsyncConnectionPool:
    if _pool is None:
        raise RuntimeError("Connection pool is not open. Call open_pool() in the app lifespan.")
    return _pool


# ---------------------------------------------------------------------------
# Thin query helpers — the equivalent of masterPool.query(...) in the TS code.
# ---------------------------------------------------------------------------

async def fetch_all(query: str, params: Sequence[Any] | None = None) -> list[dict[str, Any]]:
    async with get_pool().connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(query, params or ())
            return await cur.fetchall()


async def fetch_one(query: str, params: Sequence[Any] | None = None) -> dict[str, Any] | None:
    async with get_pool().connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(query, params or ())
            return await cur.fetchone()


async def execute(query: str, params: Sequence[Any] | None = None) -> int:
    async with get_pool().connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(query, params or ())
            return cur.rowcount
