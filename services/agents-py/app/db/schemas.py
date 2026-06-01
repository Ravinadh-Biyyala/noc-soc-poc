"""Per-project schema isolation helpers.

Direct port of `lib/db/src/project-schemas.ts`. Each workspace owns two Postgres
schemas inside the shared DB:

    proj_{id}_raw        — ingested landing zone (read-only to agents)
    proj_{id}_warehouse  — curated tables/views from accepted transformations
"""
from __future__ import annotations

from typing import Literal

from . import pool as db

SchemaLayer = Literal["raw", "warehouse"]


def assert_valid_project_id(project_id: int) -> None:
    if not isinstance(project_id, int) or isinstance(project_id, bool) or project_id <= 0:
        raise ValueError(f"Invalid projectId: {project_id}")


def raw_schema(project_id: int) -> str:
    assert_valid_project_id(project_id)
    return f"proj_{project_id}_raw"


def warehouse_schema(project_id: int) -> str:
    assert_valid_project_id(project_id)
    return f"proj_{project_id}_warehouse"


def get_project_schema_name(project_id: int, layer: SchemaLayer) -> str:
    return raw_schema(project_id) if layer == "raw" else warehouse_schema(project_id)


def quote_ident(name: str) -> str:
    """Quote a SQL identifier. Postgres does not parameterise identifiers; project
    ids are validated as ints and table/column names are sanitised at ingest."""
    return '"' + name.replace('"', '""') + '"'


async def create_project_schemas(project_id: int) -> dict[str, object]:
    raw = raw_schema(project_id)
    warehouse = warehouse_schema(project_id)

    exists_row = await db.fetch_one(
        "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = %s) AS exists",
        [raw],
    )
    already_exists = bool(exists_row and exists_row["exists"])

    await db.execute(f"CREATE SCHEMA IF NOT EXISTS {quote_ident(raw)}")
    await db.execute(f"CREATE SCHEMA IF NOT EXISTS {quote_ident(warehouse)}")

    return {"raw": raw, "warehouse": warehouse, "created": not already_exists}


async def _list_tables_in_schema(schema_name: str) -> list[dict[str, object]]:
    rows = await db.fetch_all(
        """
        SELECT c.relname AS table_name,
               COALESCE(c.reltuples, 0)::bigint AS row_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = %s
          AND c.relkind IN ('r', 'v', 'm')
        ORDER BY c.relname
        """,
        [schema_name],
    )
    return [{"tableName": r["table_name"], "rowCount": int(r["row_count"])} for r in rows]


async def list_raw_tables(project_id: int) -> list[dict[str, object]]:
    return await _list_tables_in_schema(raw_schema(project_id))


async def list_warehouse_tables(project_id: int) -> list[dict[str, object]]:
    return await _list_tables_in_schema(warehouse_schema(project_id))


async def count_warehouse_tables(project_id: int) -> int:
    return len(await list_warehouse_tables(project_id))
