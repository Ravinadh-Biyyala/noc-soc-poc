"""user_dashboards + dashboard_charts repository (project-scoped dashboards)."""
from __future__ import annotations

from typing import Any

from psycopg.types.json import Jsonb

from .. import pool as db


async def insert_dashboard(
    *, name: str, flat_table_name: str, agent_log: str
) -> dict[str, Any]:
    return await db.fetch_one(  # type: ignore[return-value]
        "INSERT INTO user_dashboards (name, flat_table_name, source_dataset_ids, row_count, status, agent_log) "
        "VALUES (%s, %s, %s, 0, 'ready', %s) RETURNING *",
        [name, flat_table_name, Jsonb([]), agent_log],
    )


async def insert_charts(charts: list[dict[str, Any]]) -> None:
    if not charts:
        return
    async with db.get_pool().connection() as conn:
        async with conn.cursor() as cur:
            for c in charts:
                await cur.execute(
                    "INSERT INTO dashboard_charts (dashboard_id, title, chart_type, config, position, col_span) "
                    "VALUES (%s, %s, %s, %s, %s, %s)",
                    [c["dashboard_id"], c["title"], c["chart_type"], Jsonb(c["config"]),
                     c["position"], c.get("col_span", 1)],
                )


async def charts_for_dashboard(dashboard_id: int) -> list[dict[str, Any]]:
    return await db.fetch_all(
        "SELECT * FROM dashboard_charts WHERE dashboard_id = %s ORDER BY position ASC",
        [dashboard_id],
    )


async def list_project_dashboards(project_id: int) -> list[dict[str, Any]]:
    rows = await db.fetch_all(
        "SELECT id, name, created_at, updated_at FROM user_dashboards "
        "WHERE flat_table_name LIKE %s ORDER BY created_at DESC",
        [f"proj_{project_id}_dash_%"],
    )
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "createdAt": r["created_at"].isoformat(),
            "updatedAt": r["updated_at"].isoformat(),
        }
        for r in rows
    ]


async def get_dashboard(project_id: int, dash_id: int) -> dict[str, Any] | None:
    return await db.fetch_one(
        "SELECT * FROM user_dashboards WHERE id = %s AND flat_table_name LIKE %s LIMIT 1",
        [dash_id, f"proj_{project_id}_dash_%"],
    )


async def delete_dashboard(project_id: int, dash_id: int) -> None:
    await db.execute(
        "DELETE FROM user_dashboards WHERE id = %s AND flat_table_name LIKE %s",
        [dash_id, f"proj_{project_id}_dash_%"],
    )
