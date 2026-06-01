"""workspaces (a.k.a. projects) — minimal reads the agent routes need."""
from __future__ import annotations

from typing import Any

from .. import pool as db


async def get_project(project_id: int) -> dict[str, Any] | None:
    return await db.fetch_one(
        "SELECT id, name, description FROM workspaces WHERE id = %s LIMIT 1",
        [project_id],
    )
