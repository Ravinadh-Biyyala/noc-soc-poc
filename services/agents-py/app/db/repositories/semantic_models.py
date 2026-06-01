"""project_semantic_models repository."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from psycopg.types.json import Jsonb

from .. import mappers
from .. import pool as db

TABLE = "project_semantic_models"


async def list_by_project(project_id: int) -> list[dict[str, Any]]:
    rows = await db.fetch_all(
        f"SELECT * FROM {TABLE} WHERE workspace_id = %s ORDER BY created_at DESC",
        [project_id],
    )
    return [mappers.semantic_model(r) for r in rows]


async def latest_raw(project_id: int) -> dict[str, Any] | None:
    return await db.fetch_one(
        f"SELECT * FROM {TABLE} WHERE workspace_id = %s ORDER BY created_at DESC LIMIT 1",
        [project_id],
    )


async def get_proposed(project_id: int) -> dict[str, Any] | None:
    row = await db.fetch_one(
        f"SELECT * FROM {TABLE} WHERE workspace_id = %s AND status = 'proposed' "
        f"ORDER BY created_at DESC LIMIT 1",
        [project_id],
    )
    return mappers.semantic_model(row) if row else None


async def get_applied_raw(project_id: int) -> dict[str, Any] | None:
    return await db.fetch_one(
        f"SELECT * FROM {TABLE} WHERE workspace_id = %s AND status = 'applied' "
        f"ORDER BY created_at DESC LIMIT 1",
        [project_id],
    )


async def delete_proposed(project_id: int) -> None:
    await db.execute(
        f"DELETE FROM {TABLE} WHERE workspace_id = %s AND status = 'proposed'", [project_id]
    )


async def insert_proposed(project_id: int, graph_definition: dict[str, Any], rationale: str) -> dict[str, Any]:
    row = await db.fetch_one(
        f"INSERT INTO {TABLE} (workspace_id, status, graph_definition, agent_rationale) "
        f"VALUES (%s, 'proposed', %s, %s) RETURNING *",
        [project_id, Jsonb(graph_definition), rationale],
    )
    return mappers.semantic_model(row)  # type: ignore[arg-type]


async def demote_applied(project_id: int) -> None:
    await db.execute(
        f"UPDATE {TABLE} SET status = 'rejected', updated_at = %s "
        f"WHERE workspace_id = %s AND status = 'applied'",
        [datetime.now(timezone.utc), project_id],
    )


async def set_status(project_id: int, sm_id: int, status: str) -> dict[str, Any] | None:
    row = await db.fetch_one(
        f"UPDATE {TABLE} SET status = %s, updated_at = %s WHERE id = %s AND workspace_id = %s RETURNING *",
        [status, datetime.now(timezone.utc), sm_id, project_id],
    )
    return mappers.semantic_model(row) if row else None


async def delete(project_id: int, sm_id: int) -> None:
    await db.execute(f"DELETE FROM {TABLE} WHERE id = %s AND workspace_id = %s", [sm_id, project_id])
