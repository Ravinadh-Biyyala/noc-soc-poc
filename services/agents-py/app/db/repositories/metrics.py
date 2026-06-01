"""project_metrics repository."""
from __future__ import annotations

from typing import Any

from psycopg.types.json import Jsonb

from .. import mappers
from .. import pool as db

TABLE = "project_metrics"


async def list_by_project(project_id: int) -> list[dict[str, Any]]:
    rows = await db.fetch_all(
        f"SELECT * FROM {TABLE} WHERE workspace_id = %s ORDER BY created_at DESC", [project_id]
    )
    return [mappers.metric(r) for r in rows]


async def list_proposed(project_id: int, limit: int = 40) -> list[dict[str, Any]]:
    rows = await db.fetch_all(
        f"SELECT * FROM {TABLE} WHERE workspace_id = %s AND status = 'proposed' "
        f"ORDER BY created_at DESC LIMIT %s",
        [project_id, limit],
    )
    return [mappers.metric(r) for r in rows]


async def existing_summaries(project_id: int) -> list[dict[str, Any]]:
    rows = await db.fetch_all(
        f"SELECT metric_name, sql_formula, status FROM {TABLE} WHERE workspace_id = %s "
        f"ORDER BY created_at DESC",
        [project_id],
    )
    return [
        {"metricName": r["metric_name"], "sqlFormula": r["sql_formula"], "status": r["status"]}
        for r in rows
    ]


async def get_by_name(project_id: int, metric_name: str) -> dict[str, Any] | None:
    return await db.fetch_one(
        f"SELECT * FROM {TABLE} WHERE workspace_id = %s AND metric_name = %s LIMIT 1",
        [project_id, metric_name],
    )


async def insert(
    project_id: int, *, metric_name: str, description: str | None, sql_formula: str,
    depends_on_tables: list[str], agent_rationale: str | None,
) -> dict[str, Any]:
    row = await db.fetch_one(
        f"INSERT INTO {TABLE} "
        f"(workspace_id, metric_name, description, sql_formula, depends_on_tables, status, agent_rationale) "
        f"VALUES (%s, %s, %s, %s, %s, 'proposed', %s) RETURNING *",
        [project_id, metric_name, description, sql_formula, Jsonb(depends_on_tables), agent_rationale],
    )
    return mappers.metric(row)  # type: ignore[arg-type]


async def update_definition(
    metric_id: int, *, description: str | None, sql_formula: str,
    depends_on_tables: list[str], agent_rationale: str | None,
) -> dict[str, Any]:
    row = await db.fetch_one(
        f"UPDATE {TABLE} SET description = %s, sql_formula = %s, depends_on_tables = %s, "
        f"agent_rationale = %s, status = 'proposed' WHERE id = %s RETURNING *",
        [description, sql_formula, Jsonb(depends_on_tables), agent_rationale, metric_id],
    )
    return mappers.metric(row)  # type: ignore[arg-type]


async def set_status(project_id: int, mid: int, status: str) -> dict[str, Any] | None:
    row = await db.fetch_one(
        f"UPDATE {TABLE} SET status = %s WHERE id = %s AND workspace_id = %s RETURNING *",
        [status, mid, project_id],
    )
    return mappers.metric(row) if row else None


async def patch(project_id: int, mid: int, updates: dict[str, Any]) -> dict[str, Any] | None:
    if not updates:
        row = await db.fetch_one(
            f"SELECT * FROM {TABLE} WHERE id = %s AND workspace_id = %s", [mid, project_id]
        )
        return mappers.metric(row) if row else None

    cols: list[str] = []
    vals: list[Any] = []
    for key, value in updates.items():
        cols.append(f"{key} = %s")
        vals.append(Jsonb(value) if key == "depends_on_tables" else value)
    vals.extend([mid, project_id])
    row = await db.fetch_one(
        f"UPDATE {TABLE} SET {', '.join(cols)} WHERE id = %s AND workspace_id = %s RETURNING *",
        vals,
    )
    return mappers.metric(row) if row else None


async def delete(project_id: int, mid: int) -> None:
    await db.execute(f"DELETE FROM {TABLE} WHERE id = %s AND workspace_id = %s", [mid, project_id])
