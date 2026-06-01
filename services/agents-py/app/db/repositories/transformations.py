"""project_transformations repository + transactional apply primitives.

Ports the Drizzle queries used by `project-transformations/index.ts` and the
DB-side helpers from `data-engineer/executor.ts` (warehouse_table_exists,
find_producer, the transactional CREATE).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from psycopg.types.json import Jsonb

from .. import pool as db
from .. import mappers
from ..schemas import quote_ident, warehouse_schema

TABLE = "project_transformations"


async def list_by_project(project_id: int) -> list[dict[str, Any]]:
    rows = await db.fetch_all(
        f"SELECT * FROM {TABLE} WHERE project_id = %s ORDER BY created_at DESC",
        [project_id],
    )
    return [mappers.transformation(r) for r in rows]


async def list_proposed(project_id: int, limit: int = 20) -> list[dict[str, Any]]:
    rows = await db.fetch_all(
        f"SELECT * FROM {TABLE} WHERE project_id = %s AND status = 'proposed' "
        f"ORDER BY created_at DESC LIMIT %s",
        [project_id, limit],
    )
    return [mappers.transformation(r) for r in rows]


async def get_raw(project_id: int, tid: int) -> dict[str, Any] | None:
    return await db.fetch_one(
        f"SELECT * FROM {TABLE} WHERE id = %s AND project_id = %s LIMIT 1",
        [tid, project_id],
    )


async def insert_proposal(
    project_id: int,
    *,
    kind: str,
    title: str,
    description: str | None,
    source_tables: list[str],
    sql: str,
    target_table_name: str,
    agent_rationale: str | None,
) -> dict[str, Any]:
    row = await db.fetch_one(
        f"""
        INSERT INTO {TABLE}
          (project_id, kind, title, description, source_tables, sql, target_table_name, status, agent_rationale)
        VALUES (%s, %s, %s, %s, %s, %s, %s, 'proposed', %s)
        RETURNING *
        """,
        [project_id, kind, title, description, Jsonb(source_tables), sql, target_table_name, agent_rationale],
    )
    return mappers.transformation(row)  # type: ignore[arg-type]


async def update_status(project_id: int, tid: int, status: str) -> None:
    await db.execute(
        f"UPDATE {TABLE} SET status = %s WHERE id = %s AND project_id = %s",
        [status, tid, project_id],
    )


async def update_status_by_id(tid: int, status: str) -> None:
    await db.execute(f"UPDATE {TABLE} SET status = %s WHERE id = %s", [status, tid])


async def delete(project_id: int, tid: int) -> None:
    await db.execute(f"DELETE FROM {TABLE} WHERE id = %s AND project_id = %s", [tid, project_id])


async def find_producer(project_id: int, table_name: str) -> dict[str, Any] | None:
    """First proposed/accepted transformation that creates `table_name`."""
    rows = await db.fetch_all(
        f"SELECT * FROM {TABLE} WHERE project_id = %s AND target_table_name = %s",
        [project_id, table_name],
    )
    for r in rows:
        if r["status"] in ("proposed", "accepted"):
            return r
    return None


async def warehouse_table_exists(project_id: int, table_name: str) -> bool:
    row = await db.fetch_one(
        """
        SELECT EXISTS(
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = %s AND table_name = %s
        ) AS exists
        """,
        [warehouse_schema(project_id), table_name],
    )
    return bool(row and row["exists"])


async def run_create(project_id: int, target_table_name: str, exec_sql: str) -> str | None:
    """DROP-then-CREATE the target relation inside one transaction.

    Returns None on success, or an error message string on failure (the caller
    decides how to surface it — matching the TS try/catch behaviour)."""
    warehouse = warehouse_schema(project_id)
    qualified = f"{quote_ident(warehouse)}.{quote_ident(target_table_name)}"
    async with db.get_pool().connection() as conn:
        try:
            async with conn.transaction():
                async with conn.cursor() as cur:
                    await cur.execute(f"DROP VIEW IF EXISTS {qualified} CASCADE")
                    await cur.execute(f"DROP MATERIALIZED VIEW IF EXISTS {qualified} CASCADE")
                    await cur.execute(f"DROP TABLE IF EXISTS {qualified} CASCADE")
                    await cur.execute(exec_sql)
        except Exception as err:  # noqa: BLE001
            return str(err)
    return None


async def set_applied(tid: int, normalized_sql: str) -> None:
    await db.execute(
        f"UPDATE {TABLE} SET status = 'applied', applied_at = %s, sql = %s WHERE id = %s",
        [datetime.now(timezone.utc), normalized_sql, tid],
    )
