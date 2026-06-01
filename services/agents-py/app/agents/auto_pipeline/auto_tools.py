"""Shared tool factories for the auto-mode subagents.

All SQL goes through the same validators the other agents use
(`assert_select_only`, `assert_schema_scope`). Reads are scoped to the project's
raw + warehouse schemas; writes are limited to DROP-then-CREATE of `auto_`-
prefixed relations in the warehouse schema (reusing `transformations.run_create`).
"""
from __future__ import annotations

import logging
import re
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from ...db import pool as db
from ...db.introspection import columns_for_table, execute_warehouse_query
from ...db.repositories import transformations as tx_repo
from ...db.schemas import (
    list_raw_tables,
    list_warehouse_tables,
    quote_ident,
    raw_schema,
    warehouse_schema,
)
from ..shared.serde import dumps
from ..shared.validation import (
    SqlValidationError,
    assert_schema_scope,
    assert_select_only,
)

log = logging.getLogger("agents.auto_pipeline")

_NUMERIC_TYPE = re.compile(r"int|float|numeric|double|real|decimal|money|serial", re.IGNORECASE)


# --------------------------------------------------------------------------
# Introspection helpers (raw schema mirror of db/introspection.py)
# --------------------------------------------------------------------------

async def raw_tables_with_columns(project_id: int) -> list[dict[str, Any]]:
    schema = raw_schema(project_id)
    tables = await list_raw_tables(project_id)
    out: list[dict[str, Any]] = []
    for t in tables:
        cols = await columns_for_table(schema, str(t["tableName"]))
        out.append(
            {
                "tableName": t["tableName"],
                "rowCount": t["rowCount"],
                "columns": [{"name": c["name"], "type": c["type"], "nullable": c["nullable"]} for c in cols],
            }
        )
    return out


async def profile_table(project_id: int, schema: str, table: str) -> dict[str, Any]:
    """Row count + per-column null/distinct/min/max for a raw or warehouse table.

    Defensive: caps columns examined and sets a statement timeout so a huge table
    never stalls the pipeline."""
    cols = await columns_for_table(schema, table)
    qualified = f"{quote_ident(schema)}.{quote_ident(table)}"
    profile: dict[str, Any] = {"table": table, "schema": schema, "columns": []}

    async with db.get_pool().connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SET statement_timeout = 8000")
            await cur.execute(f"SELECT COUNT(*) AS n FROM {qualified}")
            row = await cur.fetchone()
            profile["rowCount"] = int(row["n"]) if row else 0

            for c in cols[:20]:
                col = quote_ident(c["name"])
                is_numeric = bool(_NUMERIC_TYPE.search(c["type"]))
                minmax = f", MIN({col})::text AS mn, MAX({col})::text AS mx" if is_numeric else ""
                try:
                    await cur.execute(
                        f"SELECT COUNT(*) FILTER (WHERE {col} IS NULL) AS nulls, "
                        f"COUNT(DISTINCT {col}) AS distinct{minmax} FROM {qualified}"
                    )
                    stat = await cur.fetchone() or {}
                except Exception as err:  # noqa: BLE001
                    profile["columns"].append({"name": c["name"], "type": c["type"], "error": str(err)})
                    continue
                entry = {
                    "name": c["name"],
                    "type": c["type"],
                    "nullable": c["nullable"],
                    "nullCount": int(stat.get("nulls", 0) or 0),
                    "distinctCount": int(stat.get("distinct", 0) or 0),
                }
                if is_numeric:
                    entry["min"] = stat.get("mn")
                    entry["max"] = stat.get("mx")
                profile["columns"].append(entry)
    return profile


def _sanitize_target(name: str) -> str:
    safe = re.sub(r"[^a-z0-9_]", "_", (name or "").strip().lower()).strip("_") or "table"
    if not safe.startswith("auto_"):
        safe = f"auto_{safe}"
    return safe[:60]


async def materialize(project_id: int, target_table: str, select_sql: str, kind: str = "table") -> dict[str, Any]:
    """Build `CREATE TABLE|VIEW warehouse.auto_<name> AS <select>` and run it
    transactionally (DROP-then-CREATE). The SELECT body is validated SELECT-only
    and scoped to the project's raw + warehouse schemas."""
    select = (select_sql or "").strip().rstrip(";")
    try:
        assert_select_only(select)
        assert_schema_scope(select, [raw_schema(project_id), warehouse_schema(project_id)])
    except SqlValidationError as err:
        return {"error": str(err)}

    target = _sanitize_target(target_table)
    wh = warehouse_schema(project_id)
    ddl = "VIEW" if str(kind).lower() == "view" else "TABLE"
    create_sql = f'CREATE {ddl} {quote_ident(wh)}.{quote_ident(target)} AS {select}'
    err = await tx_repo.run_create(project_id, target, create_sql)
    if err:
        return {"error": err}
    return {"status": "created", "table": target, "schema": wh, "kind": ddl.lower()}


# --------------------------------------------------------------------------
# Pydantic arg schemas
# --------------------------------------------------------------------------

class EmptyArgs(BaseModel):
    pass


class SqlArgs(BaseModel):
    sql: str = Field(description="Fully-qualified SELECT (or WITH ... SELECT). Returns up to 200 rows.")


class ProfileArgs(BaseModel):
    table: str = Field(description="Table name (no schema prefix) to profile.")


class MaterializeArgs(BaseModel):
    target_table: str = Field(description="Output table name; an 'auto_' prefix is added if missing.")
    select_sql: str = Field(description="The SELECT body only (no CREATE). May read raw + warehouse schemas.")
    kind: str = Field(default="table", description="'table' (default) or 'view'.")


class CatalogArgs(BaseModel):
    query: str | None = Field(default=None, description="Optional category or keyword to filter the catalog.")


# --------------------------------------------------------------------------
# Tool factories
# --------------------------------------------------------------------------

def make_list_raw_tool(project_id: int) -> StructuredTool:
    async def list_raw_tables_tool() -> str:
        return dumps(await raw_tables_with_columns(project_id))

    return StructuredTool.from_function(
        coroutine=list_raw_tables_tool, name="list_raw_tables", args_schema=EmptyArgs,
        description="List every table in the project's RAW schema with columns, types and row counts.",
    )


def make_list_warehouse_tool(project_id: int) -> StructuredTool:
    from ...db.introspection import warehouse_tables_with_columns

    async def list_warehouse_tables_tool() -> str:
        return dumps(await warehouse_tables_with_columns(project_id))

    return StructuredTool.from_function(
        coroutine=list_warehouse_tables_tool, name="list_warehouse_tables", args_schema=EmptyArgs,
        description="List every table/view in the project's WAREHOUSE schema with columns and types.",
    )


def make_profile_tool(project_id: int, *, layer: str = "raw") -> StructuredTool:
    schema = raw_schema(project_id) if layer == "raw" else warehouse_schema(project_id)

    async def profile_table_tool(table: str) -> str:
        try:
            return dumps(await profile_table(project_id, schema, table))
        except Exception as err:  # noqa: BLE001
            return dumps({"error": str(err)})

    return StructuredTool.from_function(
        coroutine=profile_table_tool, name="profile_table", args_schema=ProfileArgs,
        description=f"Profile a {layer} table: row count, and per-column null counts, distinct counts, min/max.",
    )


def make_read_sql_tool(project_id: int, *, include_raw: bool = True) -> StructuredTool:
    allowed = [warehouse_schema(project_id)]
    if include_raw:
        allowed.append(raw_schema(project_id))

    async def run_sql(sql: str) -> str:
        text = (sql or "").strip().rstrip(";")
        try:
            assert_select_only(text)
            assert_schema_scope(text, allowed)
        except SqlValidationError as err:
            return dumps({"error": str(err)})
        try:
            async with db.get_pool().connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute("SET statement_timeout = 8000")
                    await cur.execute(text)
                    rows = await cur.fetchall()
                    columns = [d.name for d in (cur.description or [])]
            return dumps({"columns": columns, "rows": rows[:200], "truncated": len(rows) > 200})
        except Exception as err:  # noqa: BLE001
            return dumps({"error": str(err)})

    scope = "raw + warehouse" if include_raw else "warehouse"
    return StructuredTool.from_function(
        coroutine=run_sql, name="run_sql", args_schema=SqlArgs,
        description=f"Run a read-only SELECT against the project's {scope} schema(s). Returns up to 200 rows.",
    )


def make_warehouse_query_tool(project_id: int) -> StructuredTool:
    async def run_sql(sql: str) -> str:
        try:
            return dumps(await execute_warehouse_query(project_id, (sql or "").strip().rstrip(";")))
        except Exception as err:  # noqa: BLE001
            return dumps({"error": str(err)})

    return StructuredTool.from_function(
        coroutine=run_sql, name="run_sql", args_schema=SqlArgs,
        description="Run a read-only SELECT against the project's WAREHOUSE schema. Returns up to 200 rows.",
    )


def make_materialize_tool(project_id: int) -> StructuredTool:
    async def materialize_table(target_table: str, select_sql: str, kind: str = "table") -> str:
        log.info("auto_pipeline materialize project=%s target=%s", project_id, target_table)
        return dumps(await materialize(project_id, target_table, select_sql, kind))

    return StructuredTool.from_function(
        coroutine=materialize_table, name="materialize_table", args_schema=MaterializeArgs,
        description="Create a warehouse table/view 'auto_<name>' from a SELECT (DROP-then-CREATE). "
                    "Use for cleansed tables and flat merged tables.",
    )


def make_catalog_tool() -> StructuredTool:
    from .catalog import lookup

    async def get_visuals_catalog(query: str | None = None) -> str:
        return dumps(lookup(query))

    return StructuredTool.from_function(
        coroutine=get_visuals_catalog, name="get_visuals_catalog", args_schema=CatalogArgs,
        description="Look up supported chart types in the visuals catalog (filter by category or keyword). "
                    "Returns when-to-use, data-needed and the dashboardChartType to emit.",
    )
