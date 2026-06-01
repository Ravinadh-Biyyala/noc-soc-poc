"""Schema introspection + safe warehouse querying shared by several agents.

Ports the information_schema queries and `executeWarehouseQuery` from the TS
executors. All reads go through the master pool, filtered by the per-project
schema name.
"""
from __future__ import annotations

from typing import Any

from ..agents.shared.validation import assert_schema_scope, assert_select_only
from . import pool as db
from .schemas import warehouse_schema


async def columns_for_table(schema: str, table_name: str) -> list[dict[str, Any]]:
    rows = await db.fetch_all(
        """
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s
        ORDER BY ordinal_position
        """,
        [schema, table_name],
    )
    return [
        {"name": r["column_name"], "type": r["data_type"], "nullable": r["is_nullable"] == "YES"}
        for r in rows
    ]


async def warehouse_tables_with_columns(project_id: int) -> list[dict[str, Any]]:
    """[{tableName, rowCount, columns:[{name,type}]}] — used by route prompt-building."""
    from .schemas import list_warehouse_tables

    tables = await list_warehouse_tables(project_id)
    schema = warehouse_schema(project_id)
    out: list[dict[str, Any]] = []
    for t in tables:
        cols = await columns_for_table(schema, t["tableName"])
        out.append(
            {
                "tableName": t["tableName"],
                "rowCount": t["rowCount"],
                "columns": [{"name": c["name"], "type": c["type"]} for c in cols],
            }
        )
    return out


async def warehouse_columns_grouped(project_id: int) -> list[dict[str, Any]]:
    """[{tableName, columns:[{name,type}]}] — the shape list_warehouse_tables returns."""
    schema = warehouse_schema(project_id)
    rows = await db.fetch_all(
        """
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = %s
        ORDER BY table_name, ordinal_position
        """,
        [schema],
    )
    grouped: dict[str, list[dict[str, str]]] = {}
    for r in rows:
        grouped.setdefault(r["table_name"], []).append(
            {"name": r["column_name"], "type": r["data_type"]}
        )
    return [{"tableName": name, "columns": cols} for name, cols in grouped.items()]


async def execute_warehouse_query(project_id: int, sql_text: str) -> dict[str, Any]:
    """SELECT-only, schema-scoped, capped at 200 rows."""
    assert_select_only(sql_text)
    assert_schema_scope(sql_text, [warehouse_schema(project_id)])
    async with db.get_pool().connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql_text)
            rows = await cur.fetchall()
            columns = [d.name for d in (cur.description or [])]
    return {"columns": columns, "rows": rows[:200], "truncated": len(rows) > 200}
