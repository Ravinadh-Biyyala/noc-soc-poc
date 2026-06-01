"""project_relationship_links repository — join edges discovered by the
auto-mode Data Merging agent when it chooses metadata over a flat table.

The table is created by `pnpm db:push` (see
lib/db/src/schema/project-relationship-links.ts). Callers should wrap reads in
the route-level migration guard so a not-yet-pushed table degrades gracefully.
"""
from __future__ import annotations

from typing import Any

from .. import pool as db

TABLE = "project_relationship_links"


async def replace_for_project(project_id: int, links: list[dict[str, Any]]) -> int:
    """Delete any prior links for the project, then insert the new set.

    Each link dict: {fromTable, fromColumn, toTable, toColumn, cardinality, rationale}.
    Returns the number of rows inserted.
    """
    async with db.get_pool().connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cur:
                await cur.execute(f"DELETE FROM {TABLE} WHERE workspace_id = %s", [project_id])
                for ln in links:
                    await cur.execute(
                        f"INSERT INTO {TABLE} "
                        "(workspace_id, from_table, from_column, to_table, to_column, cardinality, rationale) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                        [
                            project_id,
                            ln["fromTable"],
                            ln["fromColumn"],
                            ln["toTable"],
                            ln["toColumn"],
                            ln.get("cardinality") or "N:1",
                            ln.get("rationale"),
                        ],
                    )
    return len(links)


async def list_for_project(project_id: int) -> list[dict[str, Any]]:
    rows = await db.fetch_all(
        f"SELECT * FROM {TABLE} WHERE workspace_id = %s ORDER BY id ASC",
        [project_id],
    )
    return [
        {
            "id": r["id"],
            "fromTable": r["from_table"],
            "fromColumn": r["from_column"],
            "toTable": r["to_table"],
            "toColumn": r["to_column"],
            "cardinality": r["cardinality"],
            "rationale": r["rationale"],
        }
        for r in rows
    ]
