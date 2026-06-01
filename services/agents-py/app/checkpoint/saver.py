"""LangGraph native Postgres checkpointer.

Replaces the hand-rolled `pipeline_checkpoints` save/load in the TS code. The
saver owns its own pool (autocommit + dict_row are required by
langgraph-checkpoint-postgres) and creates its `checkpoints*` tables via
`setup()` at boot.
"""
from __future__ import annotations

import logging

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

log = logging.getLogger("agents.checkpoint")

_pool: AsyncConnectionPool | None = None
_saver: AsyncPostgresSaver | None = None


async def open_saver(database_url: str) -> AsyncPostgresSaver:
    global _pool, _saver
    if _saver is not None:
        return _saver
    pool = AsyncConnectionPool(
        conninfo=database_url,
        min_size=1,
        max_size=5,
        open=False,
        kwargs={"autocommit": True, "row_factory": dict_row, "prepare_threshold": 0},
    )
    await pool.open()
    await pool.wait()
    saver = AsyncPostgresSaver(pool)
    await saver.setup()
    _pool = pool
    _saver = saver
    log.info("LangGraph PostgresSaver ready (checkpoint tables ensured).")
    return saver


async def close_saver() -> None:
    global _pool, _saver
    if _pool is not None:
        await _pool.close()
    _pool = None
    _saver = None


def get_saver() -> AsyncPostgresSaver:
    if _saver is None:
        raise RuntimeError("Checkpointer not initialised. Call open_saver() in the app lifespan.")
    return _saver
